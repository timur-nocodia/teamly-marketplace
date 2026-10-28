#!/usr/bin/env python3
"""Where a team's work waits for the person, measured from what the team already wrote: every "You" step of every task
(STATUS.md), how often it comes, how long the chain waited for it, whether the person then changed the result (edits
in the panel, rating notes). The numbers the optimize skill starts from: measured, not guessed.

  python3 touchpoints.py --team <slug> [--days 30]
      JSON: tasks looked at, touches per task, touchpoints ranked by how much the chain waits on them,
      the chain's "you" steps, edits, rating notes.

How long a step waited: from the moment the step before it was done (its "done HH:MM") to the person's "done HH:MM";
a step still open counts from its "since HH:MM". Times are read within the task's day; a span that can't be read
stays unknown rather than guessed.
"""
import json
import re
import statistics
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]   # the teamly-v2 skill folder
sys.path.insert(0, str(ROOT))
import server  # noqa: E402  the same reading of team records and STATUS.md as the panel

DONE_AT = re.compile(r"^\W*(?:done|готово|сделано|выполнено)\s+(\d{1,2})[:.](\d{2})", re.IGNORECASE)
SINCE = re.compile(r"since\s+(\d{1,2})[:.](\d{2})", re.IGNORECASE)
WAITING = re.compile(r"waiting for you\s*:?\s*(.*?)(?:\s+since\s+\d{1,2}[:.]\d{2})?\s*$", re.IGNORECASE)
GOAL = re.compile(r"Goal:\s*([^·|\n]+)", re.IGNORECASE)


def minutes(m):
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None


def task_day(started, folder):
    """The task's day: its Started line, else the folder's own date (2026-10-26-reel), else today."""
    for text in (started or "", folder.name):
        m = re.search(r"(\d{4})-(\d{2})-(\d{2})", text)
        if m:
            return m.group(0)
    return time.strftime("%Y-%m-%d")


def what_of(status):
    """(what was asked, what came of it): "waiting for you: pick 2 topics since 10:00" / "done 12:30: picked 2 topics"."""
    m = WAITING.search(status or "")
    if m and m.group(1).strip():
        return m.group(1).strip(), ""
    done = re.sub(r"^\W*(?:done|готово|сделано|выполнено)\s+\d{1,2}[:.]\d{2}\s*:?\s*", "", status or "", flags=re.IGNORECASE)
    return "", done.strip() if done != status else ""


def team_tasks(rec, days):
    folder = Path(server.local_path(rec["folder"])) if isinstance(rec.get("folder"), str) and rec["folder"] else None
    if not folder or not folder.is_dir():
        return []
    cutoff = time.time() - days * 86400
    return [d for d in sorted(folder.iterdir()) if (d / "STATUS.md").is_file() and (d / "STATUS.md").stat().st_mtime >= cutoff]


def chain_you_steps(rec):
    out = []
    for g in rec.get("goals") or []:
        if not isinstance(g, dict):
            continue
        for i, s in enumerate(g.get("chain") or []):
            you = (isinstance(s, str) and s.strip().lower() in ("you", "ты")) or (isinstance(s, dict) and str(s.get("who", "")).lower() in ("you", "ты"))
            if you:
                out.append({"goal": g.get("title"), "position": i + 1, "mode": s.get("mode") if isinstance(s, dict) else None,
                            "window": s.get("window") if isinstance(s, dict) else None})
    return out


def ratings_of(slug, task_names):
    rows = []
    if not server.RATINGS.is_file():
        return rows
    for line in server.read_text_any(server.RATINGS).splitlines():
        try:
            r = json.loads(line)
        except ValueError:
            continue
        if isinstance(r, dict) and r.get("team") in (slug, None) and r.get("task") in task_names:
            rows.append(r)
    return rows


def measure(slug, days=30):
    rec = next((t for t in server.read_teams() if t.get("slug") == slug), None)
    if not rec:
        return {"ok": False, "error": f"no team {slug!r} in ~/.teamly/teams"}
    tasks = team_tasks(rec, days)
    now_min = datetime.now().hour * 60 + datetime.now().minute
    today = time.strftime("%Y-%m-%d")
    points, touches = {}, 0
    for d in tasks:
        text = server.read_text_any(d / "STATUS.md")
        st = server.parse_status(text)
        goal = (GOAL.search(text).group(1).strip() if GOAL.search(text) else "") or "—"
        day = task_day(st.get("started"), d)
        prev_done = None
        for row in st["rows"]:
            done = minutes(DONE_AT.match(row["status"] or ""))
            if server.HUMAN_RE.search(row["who"] or ""):
                touches += 1
                key = (goal, row["step"])
                p = points.setdefault(key, {"goal": goal, "step": row["step"], "asked": {}, "results": {}, "count": 0, "waits": [],
                                            "open": 0, "now": [], "tasks": []})
                p["count"] += 1
                p["tasks"].append(d.name)
                asked, result = what_of(row["status"])
                for label, bag in ((asked, p["asked"]), (result, p["results"])):
                    if label:
                        bag[label] = bag.get(label, 0) + 1
                since = minutes(SINCE.search(row["status"] or ""))
                if done is not None and prev_done is not None and done >= prev_done:
                    p["waits"].append(done - prev_done)
                elif done is None and re.search(r"waiting for you", row["status"] or "", re.I):
                    p["open"] += 1  # waiting right now: how long so far, apart from the finished waits
                    if since is not None and day == today and now_min >= since:
                        p["now"].append(now_min - since)
            if done is not None:
                prev_done = done
    names = [d.name for d in tasks]
    edits_dir = server.DATA_DIR / "edits"
    edited = {n: len([f for f in (edits_dir / n).iterdir() if f.is_file()]) for n in names if (edits_dir / n).is_dir()}
    rated = ratings_of(slug, set(names))
    stars = [r.get("stars") for r in rated if isinstance(r.get("stars"), int) and 1 <= r["stars"] <= 5]
    ranked = []
    for p in points.values():
        waits = sorted(p["waits"])
        ranked.append({
            "goal": p["goal"], "step": p["step"],
            "label": max(p["asked"], key=p["asked"].get) if p["asked"] else (max(p["results"], key=p["results"].get) if p["results"] else ""),
            "count": p["count"], "perTask": round(p["count"] / max(1, len(tasks)), 2),
            "waitMinutes": {"median": int(statistics.median(waits)) if waits else None, "total": sum(waits), "max": waits[-1] if waits else None,
                            "measured": len(waits)},
            "openNow": p["open"], "waitingNowMinutes": max(p["now"]) if p["now"] else None,
            "afterEdits": sum(edited.get(t, 0) for t in p["tasks"]),
            "tasks": p["tasks"][-5:],
        })
    ranked.sort(key=lambda p: (p["waitMinutes"]["total"], p["count"]), reverse=True)
    return {
        "ok": True, "team": slug, "days": days, "tasks": len(tasks),
        "touchesPerTask": round(touches / len(tasks), 2) if tasks else 0,
        "touchpoints": ranked,
        "chainYouSteps": chain_you_steps(rec),
        "edits": {"tasks": len(edited), "files": sum(edited.values())},
        "ratings": {"count": len(stars), "avg": round(sum(stars) / len(stars), 2) if stars else None,
                    "low": sum(1 for s in stars if s <= 2),
                    "notes": [{"task": r.get("task"), "agent": r.get("agent"), "stars": r.get("stars"), "note": str(r.get("note"))[:300]}
                              for r in rated if r.get("note")][-10:]},
        "enough": len(tasks) >= 3,
    }


def main(argv):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if "--team" not in argv:
        print(__doc__)
        return 2
    slug = argv[argv.index("--team") + 1]
    days = int(argv[argv.index("--days") + 1]) if "--days" in argv else 30
    res = measure(slug, days)
    print(json.dumps(res, ensure_ascii=False, indent=1))
    return 0 if res.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
