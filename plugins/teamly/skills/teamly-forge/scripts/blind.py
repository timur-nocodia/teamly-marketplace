#!/usr/bin/env python3
"""The blind test drive: the agent and plain Claude did the same tasks; the person sees both as A and B and picks.

  python3 blind.py deal   <build slug> <agent dir> <tasks.json>
  python3 blind.py reveal <build slug> <agent dir> "1A 2B 3=" [--judge "1A 2A 3B"] [--refused yes|no]

tasks.json: [{"n": 1, "title": "Hooks for a reel about X", "agent": "<file or text>", "claude": "<file or text>",
"offProfile": false}, …]. `deal` puts the agent on side A or B at random for each task, writes the pairs to the build
file (an excerpt of each answer, for the panel) and keeps which side is which in <agent dir>/evals/blind-key.json, so
the panel never knows. `reveal` reads the person's picks (A, B or = for the same), and the blind judge's if there is
one, and writes the result: won, same, lost, how often the person picked the agent, and whether it may be released
(teamly-forge, references/eval-protocol.md):
- on the off-profile task the agent refused or handed it over (`--refused yes`; asked of the judge, not the person);
- on every typical task the person picked the agent or "the same", and the agent at least once;
- no clear loss: nowhere did both the person and the judge pick plain Claude.
Prints JSON; exit 1 with {"ok": false, "error"} on a bad call.
"""
import json
import random
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
LINES, WIDTH = 12, 160
PICK = re.compile(r"^(\d{1,2})([AB=])$")


def text_of(x):
    """The answer itself, or the file it is in (an output file of the test run)."""
    s = str(x or "")
    p = Path(s).expanduser()
    if len(s) < 1024 and "\n" not in s and p.is_file():
        return p.read_text(encoding="utf-8", errors="replace")
    return s


def excerpt(text):
    out = []
    for line in text.splitlines():
        line = re.sub(r"^#+\s*|\*\*", "", line).strip()
        if line:
            out.append(line if len(line) <= WIDTH else line[:WIDTH - 1] + "…")
        if len(out) == LINES:
            break
    return out


def build_set(slug, patch):
    r = subprocess.run([sys.executable, str(HERE / "build_state.py"), "set", slug, "-"], input=json.dumps(patch),
                       capture_output=True, text=True, encoding="utf-8")
    out = json.loads(r.stdout or "{}")
    if r.returncode != 0 or not out.get("ok"):
        raise ValueError(out.get("error") or r.stderr.strip() or "the build file did not take it")


def key_path(agent):
    return Path(agent).expanduser() / "evals" / "blind-key.json"


def deal(slug, agent, tasks_file, rng=random):
    tasks = json.loads(Path(tasks_file).expanduser().read_text(encoding="utf-8"))
    if not isinstance(tasks, list) or not tasks:
        raise ValueError("tasks.json is a list of tasks")
    pairs, key = [], {}
    for i, t in enumerate(tasks):
        if not isinstance(t, dict) or not t.get("agent") or not t.get("claude"):
            raise ValueError(f"task {i + 1} needs both answers: agent and claude")
        n = int(t.get("n") or i + 1)
        side = rng.choice("AB")
        mine, theirs = excerpt(text_of(t["agent"])), excerpt(text_of(t["claude"]))
        a, b = (mine, theirs) if side == "A" else (theirs, mine)
        pairs.append({"n": n, "title": str(t.get("title") or f"Task {n}")[:90], "a": a, "b": b})
        key[str(n)] = {"agent": side, "offProfile": bool(t.get("offProfile"))}
    kp = key_path(agent)
    kp.parent.mkdir(parents=True, exist_ok=True)
    kp.write_text(json.dumps(key, indent=1), encoding="utf-8")
    # mode "compare": the panel shows the pairs, not the test runs that came before them (build.js, testTile)
    build_set(slug, {"step": "test", "test": {"state": "pick", "mode": "compare", "pairs": pairs, "titles": [p["title"] for p in pairs]},
                     "waitOn": "panel", "panelAsk": "Pick the better result in each task", "ask": None})
    return {"ok": True, "tasks": len(pairs)}


def parse(s, what):
    out = {}
    for tok in str(s or "").split():
        m = PICK.match(tok.strip().upper())
        if not m:
            raise ValueError(f"{what}: '{tok}' is not like 1A, 2B or 3=")
        out[m.group(1)] = m.group(2)
    return out


def reveal(slug, agent, picks, judge=None, refused=None):
    try:
        key = json.loads(key_path(agent).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise ValueError("no blind key: run `deal` first")
    human, jud = parse(picks, "picks"), parse(judge, "judge") if judge else {}
    missing = [n for n in key if n not in human]
    if missing:
        raise ValueError(f"no pick for task {', '.join(missing)}")
    rows, win, tie, loss, picked = [], 0, 0, 0, 0
    typical_ok, clear_loss = True, False
    for n, k in sorted(key.items(), key=lambda x: int(x[0])):
        who = lambda v: "same" if v == "=" else "agent" if v == k["agent"] else "claude"  # noqa: E731
        h, j = who(human[n]), (who(jud[n]) if n in jud else None)
        rows.append({"n": int(n), "person": h, "judge": j, "offProfile": k["offProfile"]})
        if k["offProfile"]:
            continue
        win += h == "agent"
        tie += h == "same"
        loss += h == "claude"
        picked += h == "agent"
        if h == "claude":
            typical_ok = False
        if h == "claude" and j == "claude":
            clear_loss = True
    typical = sum(1 for r in rows if not r["offProfile"])
    release = typical_ok and win >= 1 and not clear_loss and refused != "no"
    why = ("it beat or matched plain Claude on your tasks" if release
           else "it refused nothing it should have" if refused == "no"
           else "plain Claude won a task you picked" if not typical_ok else "it never won a task")
    verdict = f"Ready: {why}" if release else f"Not yet: {why}"
    build_set(slug, {"test": {"state": "done", "tasks": typical, "win": win, "tie": tie, "loss": loss, "picked": picked,
                              "verdict": verdict, "refused": refused}, "waitOn": None, "panelAsk": None})
    return {"ok": True, "release": release, "verdict": verdict, "tasks": rows, "win": win, "tie": tie, "loss": loss}


def main(argv):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if len(argv) < 4 or argv[0] not in ("deal", "reveal"):
        print(__doc__)
        return 2
    try:
        takes = ("--judge", "--refused") if argv[0] == "reveal" else ()
        odd = [a for a in argv[4:] if a.startswith("--") and a not in takes]
        if odd:  # a misspelt --judge would quietly drop the judge's picks
            raise ValueError(f"unknown flag {', '.join(odd)}: {argv[0]} takes {', '.join(takes) or 'no flags'}")
        if argv[0] == "deal":
            out = deal(argv[1], argv[2], argv[3])
        else:
            opt = lambda k: argv[argv.index(k) + 1] if k in argv[4:] else None  # noqa: E731
            refused = opt("--refused")
            if refused not in (None, "yes", "no"):
                raise ValueError("--refused is yes or no")
            out = reveal(argv[1], argv[2], argv[3], opt("--judge"), refused)
    except (ValueError, OSError) as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        return 1
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
