#!/usr/bin/env python3
"""What an agent's integrations cost: a run, a month, the test, and how far the person's balance goes.

  python3 forecast.py estimate  <plan.json> [--balance 1.00] [--hold 0.30] [--build <build slug>]
  python3 forecast.py calibrate <plan.json> <journal.jsonl> [--write]

plan.json — the agent's integrations, as the Builder shows them, with the volume of every paid step:
  {"runsPerWeek": 1, "testTasks": 3, "items": [
    {"id": "web", "kind": "builtin", "name": "Web search", "gives": "Finds this week's posts"},
    {"id": "ig", "kind": "paid", "name": "Instagram reels", "tool": "<provider>:<endpoint>",
     "gives": "Exact views of 60 reels by your 3 hashtags", "lose": "Without it: views are approximate",
     "price": <the price object from `data_api.py inspect`, or {"type": "PER_RESULT", "usd": 0.00253, "flatUsd": 0}>,
     "volume": {"calls": 1, "queries": 3, "perQuery": 20, "fill": 0.8, "retry": 0.1}}]}
  kind: builtin | app (the person's connector) | paid (through the Teamly key) | ownkey (the person's own key).

Per paid step (teamly-forge, «Интеграции»; prices from `inspect` already carry Teamly's multiplier):
  max = flat × calls + price × queries × perQuery        (a hard bound: a paid step without a limit is refused)
  exp = (1 + retry) × (flat × calls + price × queries × perQuery × fill)
  min = flat × calls + price × queries × perQuery × 0.3   (until real runs say otherwise)
  PER_CALL: price × calls, exact. PER_UNIT_MATRIX: its dearest variant.
A month is runs a week × 52 / 12. Runs the balance covers: floor((balance − hold + last call) / run), 0 below the
hold (the server holds `hold` for a per-result call before it runs). Suggested limits: a run = max × 1.25 rounded up
to 5 cents, a month = the month's max rounded up to a dollar. `calibrate` blends the fill each step really got
(journal lines {"item", "requested", "returned"}) with the plan's, k = 3 (Bühlmann): the plan weighs as 3 runs.
Prints JSON; exit 1 with {"ok": false, "error"} on a bad plan.
"""
import json
import math
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FILL_MIN, RETRY, SAFETY, K = 0.3, 0.1, 1.25, 3
KINDS = ("builtin", "app", "paid", "ownkey")


def usd(x):
    if isinstance(x, dict):
        x = x.get("value")
    return float(x) if isinstance(x, (int, float)) and math.isfinite(x) and x >= 0 else None


def price_of(p):
    """(type, unit price, flat fee) from inspect's price object or the short form."""
    if not isinstance(p, dict):
        return None
    kind = str(p.get("type") or "PER_RESULT").upper()
    if kind == "PER_UNIT_MATRIX" and isinstance(p.get("variants"), list):
        options = [price_of(v.get("price") if isinstance(v, dict) else None) for v in p["variants"]]
        options = [o for o in options if o]
        if not options:
            return None
        return max(options, key=lambda o: (o[1], o[2]))
    unit = usd(p.get("usd")) if "usd" in p else usd(p.get("amount"))
    flat = usd(p.get("flatUsd")) if "flatUsd" in p else usd(p.get("flatFee")) or 0.0
    return (kind, unit, flat or 0.0) if unit is not None else None


def step_cost(item):
    pr = price_of(item.get("price"))
    if not pr:
        raise ValueError(f"{item.get('name') or item.get('id')}: no price; take it from `data_api.py inspect`")
    kind, unit, flat = pr
    v = item.get("volume") if isinstance(item.get("volume"), dict) else {}
    calls = max(1, int(v.get("calls") or 1))
    if kind == "PER_CALL":
        c = unit * calls + flat * calls
        return {"min": c, "exp": c, "max": c}
    q, lim = v.get("queries") or 1, v.get("perQuery")
    if not isinstance(lim, (int, float)) or lim <= 0:
        raise ValueError(f"{item.get('name') or item.get('id')}: a paid step needs a limit per query (volume.perQuery)")
    fill = min(1.0, max(0.0, float(v.get("fill", 0.8))))
    retry = max(0.0, float(v.get("retry", RETRY)))
    units = q * lim
    return {"min": flat * calls + unit * units * min(FILL_MIN, fill), "exp": (1 + retry) * (flat * calls + unit * units * fill),
            "max": flat * calls + unit * units}


def r2(x):
    return round(x + 1e-12, 3) if x >= 0.01 else round(x + 1e-12, 4)


def up(x, step):
    return round(math.ceil(x / step - 1e-9) * step, 2)


def estimate(plan, balance=None, hold=0.30):
    items = plan.get("items") if isinstance(plan.get("items"), list) else []
    if not items:
        raise ValueError("the plan has no items")
    run = {"min": 0.0, "exp": 0.0, "max": 0.0}
    last = None
    out_items = []
    for it in items:
        if not isinstance(it, dict) or not it.get("name"):
            raise ValueError("every item needs a name")
        kind = it.get("kind") or "builtin"
        if kind not in KINDS:
            raise ValueError(f"{it['name']}: kind is one of {', '.join(KINDS)}")
        row = {k: it[k] for k in ("id", "kind", "name", "status", "gives", "lose", "optional", "tool", "price", "volume") if k in it}
        row["kind"] = kind
        if kind == "paid":
            c = step_cost(it)
            row["perRun"] = {k: r2(v) for k, v in c.items()}
            row.setdefault("status", "paid")
            for k in run:
                run[k] += c[k]
            last = c
        else:
            row.setdefault("status", {"builtin": "ready", "app": "connected", "ownkey": "connected"}[kind])
        out_items.append(row)
    w = float(plan.get("runsPerWeek") or 0)
    n = w * 52 / 12
    month = {k: r2(run[k] * n) for k in run}
    tasks = int(plan.get("testTasks") or 0)
    paid = run["max"] > 0
    res = {"ok": True, "items": out_items, "perRun": {k: r2(v) for k, v in run.items()}, "runsPerWeek": w,
           "perMonth": month, "test": {"tasks": tasks, "exp": r2(run["exp"] * tasks), "max": r2(run["max"] * tasks)},
           "holdUsd": hold if paid else 0, "lastCall": {k: r2(v) for k, v in last.items()} if last else None,
           "budget": {"perRunUsd": up(run["max"] * SAFETY, 0.05), "perMonthUsd": up(run["max"] * n, 1.0)} if paid else None,
           "basis": plan.get("basis") or "prices"}
    if balance is not None and paid:
        a = float(balance)
        lo = 0 if a < hold else math.floor((a - hold + last["max"]) / run["max"])
        hi = 0 if a < hold else math.floor((a - hold + last["exp"]) / run["exp"])
        need = max(5.0, run["max"] * n + hold - a)
        s = next((x for x in (5, 10, 20, 50, 100) if x >= need), up(need, 5))
        res["wallet"] = {"available": r2(a), "runsLeft": {"low": lo, "high": max(lo, hi)},
                         "state": "short" if lo == 0 else "low" if a < run["max"] * n + hold else "ok",
                         "topupUsd": s if a < run["max"] * n + hold else None}
    return res


def calibrate(plan, journal_lines):
    by = {}
    for line in journal_lines:
        try:
            r = json.loads(line)
        except ValueError:
            continue
        if isinstance(r, dict) and r.get("item") and (r.get("requested") or 0) > 0 and r.get("returned") is not None:
            by.setdefault(r["item"], []).append(min(1.0, max(0.0, r["returned"] / r["requested"])))
    changed = []
    for it in plan.get("items") or []:
        f = by.get(it.get("id"))
        v = it.get("volume") if isinstance(it.get("volume"), dict) else None
        if not f or v is None:
            continue
        prior = float(v.get("fill", 0.8))
        n = len(f)
        v["fill"] = round((n * (sum(f) / n) + K * prior) / (n + K), 3)
        v["fillFrom"] = f"{n} run{'s' if n > 1 else ''}"
        changed.append({"id": it["id"], "fill": v["fill"], "runs": n})
    plan["basis"] = "yours" if changed else plan.get("basis") or "prices"
    return {"ok": True, "changed": changed, "plan": plan}


def to_build(slug, est):
    patch = {"integrations": {k: est[k] for k in ("items", "perRun", "perMonth", "runsPerWeek", "test", "holdUsd", "lastCall", "budget", "basis")}}
    r = subprocess.run([sys.executable, str(HERE / "build_state.py"), "set", slug, "-"], input=json.dumps(patch),
                       capture_output=True, text=True, encoding="utf-8")
    out = json.loads(r.stdout or "{}")
    if r.returncode != 0 or not out.get("ok"):
        raise ValueError(out.get("error") or "the build file did not take it")


def main(argv):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if len(argv) < 2 or argv[0] not in ("estimate", "calibrate"):
        print(__doc__)
        return 2
    opt = lambda k: argv[argv.index(k) + 1] if k in argv[2:] and argv.index(k) + 1 < len(argv) else None  # noqa: E731
    try:
        takes = ("--balance", "--hold", "--build") if argv[0] == "estimate" else ("--write",)
        odd = [a for a in argv[2:] if a.startswith("--") and a not in takes]
        if odd:  # a misspelt --build would leave the panel without the price
            raise ValueError(f"unknown flag {', '.join(odd)}: {argv[0]} takes {', '.join(takes)}")
        plan_path = Path(argv[1]).expanduser()
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        if not isinstance(plan, dict):
            raise ValueError("plan.json is an object with items")
        if argv[0] == "estimate":
            bal = opt("--balance")
            out = estimate(plan, float(bal) if bal is not None else None, float(opt("--hold") or 0.30))
            if opt("--build"):
                to_build(opt("--build"), out)
        else:
            if len(argv) < 3:
                raise ValueError("calibrate needs the journal of runs")
            out = calibrate(plan, Path(argv[2]).expanduser().read_text(encoding="utf-8").splitlines())
            if "--write" in argv:
                plan_path.write_text(json.dumps(out["plan"], ensure_ascii=False, indent=1), encoding="utf-8")
    except (ValueError, OSError, TypeError) as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        return 1
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
