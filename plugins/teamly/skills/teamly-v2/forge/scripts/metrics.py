#!/usr/bin/env python3
"""Teamly: the numbers that show an agent works (~/.teamly/metrics/<team>/<agent>.json).

  python3 metrics.py set  --team <slug> --agent <slug> [--agent-metric '<json>'] [--result '<json>']
  python3 metrics.py add  --team <slug> --agent <slug> [--agent-value N] [--result-value N] [--source "..."] [--at YYYY-MM-DD] [--note "..."] [--baseline]
  python3 metrics.py show --team <slug> --agent <slug>

Two numbers per agent, both optional:
  agent   what the agent itself moves (minutes you spend fixing its script, minutes to pick what to film, replies to its messages).
          Only this one proves the agent: the share threshold and the proof on its library card use it.
  result  your business number the agent feeds (views per reel, replies, sales). Shown as context: it also depends on
          the topic, timing and the algorithm, so it never decides whether the agent works.
A metric: {"name", "unit", "better": "higher"|"lower", "how": "auto"|"manual", "where", "source", "cost", "every",
"ask", "target", "by"}. --baseline marks the count before the agent (what it took without it): the agent is proven only
against that (the rule is at PROVEN_* below). Lives outside the agent's folder: it never travels with the agent.
An unknown flag is refused, never skipped: a misspelt one would save nothing and still answer ok.
"""
import json
import os
import re
import sys
import time
from datetime import date, datetime
from pathlib import Path

METRICS = Path.home() / ".teamly" / "metrics"
SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
SLOTS = ("agent", "result")
# Proven by its own number (research 03.11, a simulation of agents that change nothing): one start and "the middle of
# the last 3 is 20% better" called such an agent proven 27-69% of the time. Now: 3 counts WITHOUT the agent (add
# --baseline), then a window of 6 counts with it, over a week or more; proven when 5 of the 6 beat the BEST count
# without it. Judged twice only, never after every count: false proofs stay near 5%. The first look is at the first
# count that has both 6 counts with the agent and a week since the start (its last 6), the second at the 6 after it:
# counted weekly that is the 6th and the 12th count, and an agent that counts every run (several a day) still gets
# its two looks once the week is there.
PROVEN_BASELINES = 3
PROVEN_VALUES = 6
PROVEN_BETTER = 5
PROVEN_DAYS = 7
try:  # a short test can ask for fewer days: ~/.teamly/config.json {"numberMinDays": 3}
    PROVEN_DAYS = int((json.loads((Path.home() / ".teamly" / "config.json").read_bytes()) or {}).get("numberMinDays", PROVEN_DAYS))
except (OSError, ValueError, TypeError, AttributeError):
    pass


def path_of(team, agent):
    for s in (team, agent):
        if not SLUG.match(s or ""):
            raise ValueError(f"not a slug: {s!r}")
    return METRICS / team / f"{agent}.json"


def read(team, agent):
    try:
        v = json.loads(path_of(team, agent).read_bytes())
    except (OSError, ValueError):
        return None
    return v if isinstance(v, dict) else None


def write(team, agent, data):
    p = path_of(team, agent)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(f".{agent}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, p)


def number(v):
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return n if n == n and abs(n) != float("inf") else None


def day_of(s):
    try:
        return datetime.strptime(str(s)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def summary(data):
    """For the panel and the share threshold: per slot the baseline, now, change in the better direction, the series."""
    if not isinstance(data, dict):
        return None
    rows = [r for r in data.get("rows") or [] if isinstance(r, dict)]
    out = {}
    for slot in SLOTS:
        m = data.get(slot)
        if not isinstance(m, dict) or not m.get("name"):
            continue
        pts = [(r.get("at"), number(r.get(slot)), r.get("baseline") is True) for r in rows]
        pts = [(at, v, b) for at, v, b in pts if v is not None]
        lower = m.get("better") == "lower"
        marks = [i for i, (_, _, b) in enumerate(pts) if b]  # the counts before the agent, if there are any
        marked = marks[0] if marks else None
        start = marked if marked is not None else 0
        before = [pts[i][1] for i in marks]
        # "before" is the best count without the agent: the agent has to beat the start's good day, not its bad one
        base = (min(before) if lower else max(before)) if before else (pts[0][1] if pts else None)
        now = pts[-1][1] if pts else None
        # a vs b, in the better direction; a start of 0 (no findings used before the agent) is beaten by any gain
        better = lambda a, b: ((b - a) if lower else (a - b)) / max(abs(b), 1)  # noqa: E731
        change = round(better(now, base), 3) if base is not None and now is not None else None
        days = (day_of(pts[-1][0]) - day_of(pts[start][0])).days if len(pts) > 1 and day_of(pts[start][0]) and day_of(pts[-1][0]) else 0
        s = {k: m.get(k) for k in ("name", "short", "unit", "better", "how", "where", "source", "cost", "every", "ask", "target", "by")
             if m.get(k) not in (None, "")}
        s.update({"baseline": base, "now": now, "change": change, "count": len(pts), "days": days, "baselineWithout": marked is not None,
                  "since": pts[start][0] if pts else None, "last": pts[-1][0] if pts else None, "series": [v for _, v, _ in pts][-12:]})
        scale, labels = m.get("scale"), m.get("labels")
        if isinstance(scale, list) and isinstance(labels, list) and len(scale) == len(labels):
            # answered with buttons: what each button said ("over 30"), never a number the person didn't give
            s["labels"] = {f"{number(v):g}": str(t) for v, t in zip(scale, labels) if number(v) is not None}
        if slot == "agent":
            after = [(at, v) for at, v, b in pts[marks[-1] + 1:] if not b] if marks else []
            span = lambda at: (day_of(at) - day_of(pts[start][0])).days if day_of(at) and day_of(pts[start][0]) else 0  # noqa: E731
            first = next((i + 1 for i in range(PROVEN_VALUES - 1, len(after)) if span(after[i][0]) >= PROVEN_DAYS), None)
            looks = (after[first - PROVEN_VALUES:first], after[first:first + PROVEN_VALUES]) if first else ()
            proven, mid = False, None
            for w in looks:  # the first count with 6 counts and a week, then the 6 after it
                if len(w) < PROVEN_VALUES or len(before) < PROVEN_BASELINES:
                    break
                if sum(1 for _, v in w if better(v, base) > 0) >= PROVEN_BETTER and span(w[-1][0]) >= PROVEN_DAYS:
                    proven, mid = True, sorted(v for _, v in w)[len(w) // 2]
                    break
            s["proven"] = proven
            s["proved"] = mid  # what the proof stands on (the middle of the window), not the last count
            s["baselines"] = len(before)
            s["need"] = {"before": max(0, PROVEN_BASELINES - len(before)), "after": max(0, PROVEN_VALUES - len(after))} if not proven else None
        out[slot] = s
    return out or None


def summary_for(team, agent):
    try:
        return summary(read(team, agent))
    except ValueError:
        return None


def metric_arg(raw):
    m = json.loads(raw)
    if not isinstance(m, dict) or not str(m.get("name") or "").strip():
        raise ValueError("a metric is a JSON object with a name: '{\"name\": \"Minutes per script\", \"better\": \"lower\"}'")
    if m.get("better", "higher") not in ("higher", "lower"):
        raise ValueError("better is higher or lower")
    if m.get("how", "manual") not in ("auto", "manual"):
        raise ValueError("how is auto (a tool counts it) or manual (the person tells)")
    if "scale" in m and not (isinstance(m["scale"], list) and m["scale"] and all(number(x) is not None for x in m["scale"])):
        raise ValueError("scale is the list of values the answer buttons stand for: [3, 10, 22, 40]")
    if "labels" in m and not (isinstance(m["labels"], list) and len(m["labels"]) == len(m.get("scale") or [])):
        raise ValueError("labels are the buttons' words, one per scale value: [\"under 5\", \"5 to 15\", \"15 to 30\", \"over 30\"]")
    return m


def on_scale(m, v):
    """A metric answered with buttons ("scale": what each button stands for) keeps every value on that scale, the start
    too: a start typed as 60 against buttons that top out at 40 would read as better with nothing changed."""
    scale = [number(x) for x in (m or {}).get("scale") or [] if number(x) is not None]
    return min(scale, key=lambda x: abs(x - v)) if scale else v


FLAGS = {"set": ("team", "agent", "agent-metric", "result"),
         "add": ("team", "agent", "agent-value", "result-value", "source", "at", "note", "baseline"),
         "show": ("team", "agent")}


def main(argv):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if not argv or argv[0] not in ("set", "add", "show"):
        print(__doc__)
        return 2
    baseline = "--baseline" in argv
    cmd, rest, opts = argv[0], [a for a in argv[1:] if a != "--baseline"], {}
    while rest:
        k = rest.pop(0)
        if k.startswith("--") and rest:
            opts[k[2:]] = rest.pop(0)
    team, agent = opts.get("team"), opts.get("agent")
    odd = sorted({a[2:] for a in argv[1:] if a.startswith("--")} - set(FLAGS[cmd]))
    try:
        if odd:  # `set --metric '{…}'` used to answer ok and save nothing
            raise ValueError(f"unknown flag {', '.join('--' + k for k in odd)}: {cmd} takes {', '.join('--' + k for k in FLAGS[cmd])}")
        data = read(team, agent) if path_of(team, agent) else None
        if cmd == "set":
            data = data or {"team": team, "agent": agent, "rows": []}
            for slot, key in (("agent", "agent-metric"), ("result", "result")):
                if key in opts:
                    data[slot] = metric_arg(opts[key])
            data["updatedAt"] = int(time.time())
            write(team, agent, data)
        elif cmd == "add":
            if not data:
                raise ValueError("no metric for this agent yet: set it first")
            row = {"at": opts.get("at") or date.today().isoformat()}
            if not day_of(row["at"]):
                raise ValueError("--at is a date: 2026-11-03")
            for slot in SLOTS:
                v = opts.get(f"{slot}-value")
                if v is not None:
                    if number(v) is None:
                        raise ValueError(f"--{slot}-value is a number")
                    row[slot] = on_scale(data.get(slot), number(v))
            if not any(s in row for s in SLOTS):
                raise ValueError("add needs --agent-value or --result-value")
            for k in ("source", "note"):
                if opts.get(k):
                    row[k] = opts[k][:200]
            if baseline:
                row["baseline"] = True
            data.setdefault("rows", []).append(row)
            data["updatedAt"] = int(time.time())
            write(team, agent, data)
        elif not data:
            raise ValueError("no metric for this agent")
    except ValueError as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        return 1
    print(json.dumps({"ok": True, "metrics": data, "summary": summary(data)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
