#!/usr/bin/env python3
"""Tasks on the floor's board: the panel shows a team's work only through them.

The board is built from task folders only: a direct subfolder of the team folder with a STATUS.md, listed in the team
record. Written by hand, that is easy to skip in a long chat (after a compaction the skill text is gone) and the board
stays empty while agents work. So the coordinator runs one command per move:

  python3 task.py new "<team folder>" --title "Reel 09.11" --step "Trend Radar=1-trends.md" --step "Reel Script=2-script.md" --step "You"
                  [--goal <goal id>] [--slug <slug>] [--working "<what step 1 does now>"] [--today] [--plan "<one line>"]
  python3 task.py step "<task folder>" <n> "<status>" [--now "<one line>"] [--next "<one line>"]
  python3 task.py check "<team folder>"

new    makes <team folder>/<date>-<slug>/STATUS.md in the panel's format and writes the task into the team record
       (~/.teamly/teams/<slug>.json): `tasks`, `active_task`, and with --today the day plan (`today`).
step   sets one row's status. "done: <gist>" gets the time (done 14:09: <gist>), "waiting for you: <what>" gets
       "since HH:MM". When every row is done, the record marks the task done. The task folder may be given by its
       name alone, as the panel's `Teamly: done — <task> (<name>), step N` gives it.
check  what the board can't show: tasks without STATUS.md, STATUS.md too deep, statuses the panel can't read, no plan
       for today; and a CLAUDE.md block older than references/workspace.md (it carries the task rule through
       compactions). Exit 1 when something is wrong.

Stdlib only. Prints one JSON line. Reads STATUS.md and team records with the panel's own code (server.py), so the two
never disagree.
"""
import argparse
import json
import re
import sys
import time
import unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import server as panel  # noqa: E402  (the panel's own rules for STATUS.md and team records)

KNOWN = re.compile(r"^(done \d{1,2}:\d{2}\b|working: \S|waiting for you: \S|waiting$|failed: \S|paused: \S)", re.IGNORECASE)
SKIP = {"team", "reports", ".claude", ".git", "node_modules", "__pycache__"}
# The markers on lines of their own: references/workspace.md also names them inside a sentence, and that is not the block.
BLOCK = re.compile(r"^[ \t]*<!-- teamly:begin -->[ \t]*$.*?^[ \t]*<!-- teamly:end -->[ \t]*$", re.S | re.M)


def workspace_block():
    """The CLAUDE.md block of this version (references/workspace.md): a team folder with an older one gets it again."""
    ref = HERE / "references" / "workspace.md"
    m = BLOCK.search(ref.read_text(encoding="utf-8")) if ref.is_file() else None
    return m.group(0) if m else None


def out(ok, **fields):
    print(json.dumps({"ok": ok, **fields}, ensure_ascii=False))
    return 0 if ok else 1


def hm():
    return time.strftime("%H:%M")


def fwd(p):
    return str(p).replace("\\", "/")  # full paths with forward slashes in JSON, C:/Users/… on Windows


def team_record(folder=None, slug=None):
    """(file, record) of the team whose folder is this one (or whose slug is given)."""
    want = panel.norm_folder(folder) if folder else None
    if panel.TEAMS_DIR.is_dir():
        for f in sorted(panel.TEAMS_DIR.glob("*.json")):
            rec = panel.read_json(f)
            if not rec:
                continue
            if slug and slug in (rec.get("slug"), f.stem):
                return f, rec
            if want and isinstance(rec.get("folder"), str) and panel.norm_folder(panel.local_path(rec["folder"])) == want:
                return f, rec
    return None, None


def save_record(f, rec):
    panel.write_atomic(f, json.dumps(rec, ensure_ascii=False, indent=2) + "\n")


def slugify(text):
    s = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:48].strip("-")


def one_line(text):
    return " ".join(str(text or "").split()).replace("|", "/")  # a pipe would cut the table row


def normalize(status):
    """The status the panel reads, with the time added where the skill asks for it."""
    s = one_line(status)
    low = s.lower()
    if re.match(r"^done\b", low) and not re.match(r"^done \d{1,2}:\d{2}\b", low):
        rest = s[4:].lstrip(" :—-")
        s = f"done {hm()}" + (f": {rest}" if rest else "")
    elif low.startswith("waiting for you") and " since " not in low and "(in its cloud chat)" not in low:
        s = f"{s} since {hm()}"
    return s


def is_person(who):
    return bool(panel.HUMAN_RE.search(who or ""))


def complete(task_dir, parsed):
    """The panel's rule (server.py enrich_team): every agent row done (or its file there and nothing open), and the
    person's rows done too."""
    rows = parsed.get("rows") or []
    files = {f.name for f in task_dir.iterdir() if f.is_file()}
    agents = [r for r in rows if not is_person(r["who"])]
    done = sum(1 for r in agents if panel.DONE_RE.match(r["status"])
               or (panel.file_there(r["file"], files) and not panel.OPEN_RE.search(r["status"])))
    return bool(rows) and done == len(agents) and all(panel.DONE_RE.match(r["status"]) for r in rows if is_person(r["who"]))


def cmd_new(a):
    folder = Path(panel.local_path(a.folder)).expanduser()
    if not folder.is_dir():
        return out(False, error=f"no team folder {fwd(folder)}")
    f, rec = team_record(folder=folder, slug=a.team)
    if not rec:
        return out(False, error=f"no team record with folder {fwd(folder)} in ~/.teamly/teams: the board shows only teams from there")
    steps = []
    for s in a.step:
        who, _, file = s.partition("=")
        who, file = one_line(who), one_line(file)
        if not who:
            return out(False, error=f"--step {s!r}: who is empty (\"Agent=1-file.md\" or \"You\")")
        steps.append((who, file or "—"))
    if not steps:
        return out(False, error="at least one --step")
    day = time.strftime("%Y-%m-%d")
    base = a.slug or f"{day}-{slugify(a.title) or 'task'}"
    if not panel.SLUG_RE.match(base):
        return out(False, error=f"slug {base!r}: lowercase latin letters, digits and dashes")
    slug, n = base, 2
    while (folder / slug).exists():
        slug, n = f"{base}-{n}", n + 1
    goals = [g for g in rec.get("goals") or [] if isinstance(g, dict)]
    goal = next((g for g in goals if g.get("id") == a.goal), None) if a.goal else (goals[0] if len(goals) == 1 else None)
    chain = " → ".join("you" if is_person(w) else w for w, _ in steps)
    rows = []
    for i, (who, file) in enumerate(steps, 1):
        status = f"working: {one_line(a.working)}" if i == 1 and a.working else "waiting"
        rows.append(f"| {i} | {who} | {file} | {status} |")
    first = steps[0][0]
    second = steps[1][0] if len(steps) > 1 else None
    now = one_line(a.now) or (f"{first}: {one_line(a.working)}" if a.working else f"{first} starts step 1")
    nxt = one_line(a.next) or ((("you check the result" if is_person(second) else f"{second} takes step 2") if second else "the result"))
    text = "\n".join([
        f"# Task: {one_line(a.title)}", "",
        f"Team: {one_line(rec.get('name') or rec.get('slug'))} · Goal: {one_line((goal or {}).get('title') or a.goal or '—')} · Chain: {chain}",
        f"Started: {day} {hm()}", "",
        "| Step | Who | File | Status |", "|---|---|---|---|", *rows, "",
        f"Now: {now}", f"Next: {nxt}", ""])
    task_dir = folder / slug
    task_dir.mkdir()
    panel.write_atomic(task_dir / "STATUS.md", text)
    tasks = [t for t in rec.get("tasks") or [] if isinstance(t, dict)]
    tasks.append({"slug": slug, "title": one_line(a.title), "folder": fwd(task_dir), "goal": (goal or {}).get("id") or a.goal,
                  "status": "in progress"})
    rec["tasks"] = tasks
    rec["active_task"] = fwd(task_dir)
    if a.today:
        today = rec.get("today") if isinstance(rec.get("today"), dict) and rec["today"].get("date") == day else {"date": day, "plan": "", "tasks": []}
        today["tasks"] = [*[t for t in today.get("tasks") or [] if t != fwd(task_dir)], fwd(task_dir)]
        today["plan"] = one_line(a.plan) or today.get("plan") or one_line(a.title)
        rec["today"] = today
    save_record(f, rec)
    return out(True, task=fwd(task_dir), status=fwd(task_dir / "STATUS.md"), team=rec.get("slug"), today=bool(a.today))


def rewrite_row(text, n, status):
    """The same table, row n's status replaced. Columns are found by the header row, as the panel finds them."""
    cols = {"step": 0, "who": 1, "file": 2, "status": 3}
    lines, hit = text.splitlines(), False
    for i, line in enumerate(lines):
        s = line.strip()
        if not s.startswith("|") or re.match(r"^\|[\s:|-]+\|$", s):
            continue
        cells = [c.strip() for c in s.strip("|").split("|")]
        if not re.match(r"^\d+\.?$", cells[0]):
            found = {k: next((j for j, c in enumerate(cells) if rx.search(c)), None) for k, rx in panel.COLUMN.items()}
            if found["who"] is not None and found["status"] is not None:
                cols = {k: v for k, v in found.items() if v is not None}
            continue
        if int(cells[0].rstrip(".")) == n and not hit and cols["status"] < len(cells):
            cells[cols["status"]] = status
            lines[i] = "| " + " | ".join(cells) + " |"
            hit = True
    return "\n".join(lines) + "\n", hit


def set_line(text, key, value):
    pat = re.compile(rf"(?mi)^({key}|{'Сейчас' if key == 'Now' else 'Дальше'}):.*$")
    line = f"{key}: {one_line(value)}"
    return pat.sub(line, text, count=1) if pat.search(text) else text.rstrip("\n") + f"\n{line}\n"


def find_task(name):
    """A task folder from a path, or from its name alone (the panel's `Teamly: done — … (<name>)` gives the name):
    the team folder this chat is in first, then any team's."""
    p = Path(panel.local_path(name)).expanduser()
    if (p / "STATUS.md").is_file() or "/" in name or "\\" in name:
        return p
    here = panel.norm_folder(Path.cwd())
    hits = []
    for f in sorted(panel.TEAMS_DIR.glob("*.json")) if panel.TEAMS_DIR.is_dir() else []:
        folder = (panel.read_json(f) or {}).get("folder")
        if isinstance(folder, str) and (Path(panel.local_path(folder)) / name / "STATUS.md").is_file():
            hits.append((panel.norm_folder(panel.local_path(folder)) != here, str(Path(panel.local_path(folder)) / name)))
    return Path(sorted(hits)[0][1]) if hits else p


def cmd_step(a):
    task_dir = find_task(a.task)
    st = task_dir / "STATUS.md"
    if not st.is_file():
        return out(False, error=f"no STATUS.md in {fwd(task_dir)}: start the task with `task.py new` first")
    status = normalize(a.status)
    text, hit = rewrite_row(panel.read_text_any(st), a.n, status)
    if not hit:
        return out(False, error=f"no step {a.n} in {fwd(st)}")
    if a.now:
        text = set_line(text, "Now", a.now)
    if a.next:
        text = set_line(text, "Next", a.next)
    panel.write_atomic(st, text)
    warn = None if KNOWN.match(status) else "the panel reads statuses that start with done HH:MM / working: / waiting for you: / waiting / failed: / paused:"
    finished = complete(task_dir, panel.parse_status(text))
    if finished:
        f, rec = team_record(folder=task_dir.parent)
        if rec:
            for t in rec.get("tasks") or []:
                if isinstance(t, dict) and (t.get("slug") == task_dir.name or Path(str(t.get("folder") or "")).name == task_dir.name):
                    t["status"] = "done"
            save_record(f, rec)
    return out(True, task=fwd(task_dir), step=a.n, status=status, complete=finished, **({"warning": warn} if warn else {}))


def cmd_check(a):
    folder = Path(panel.local_path(a.folder)).expanduser()
    problems, notes = [], []
    if not folder.is_dir():
        return out(False, problems=[f"no team folder {fwd(folder)}"], notes=[])
    f, rec = team_record(folder=folder, slug=a.team)
    if not rec:
        return out(False, problems=[f"no team record with folder {fwd(folder)}: the panel doesn't know this team"], notes=[])
    on_disk = {d.name: d for d in folder.iterdir() if d.is_dir() and (d / "STATUS.md").is_file()}
    open_tasks = []
    for name, d in sorted(on_disk.items()):
        parsed = panel.parse_status(panel.read_text_any(d / "STATUS.md"))
        if not parsed["rows"]:
            problems.append(f"{name}/STATUS.md has no step table: the board shows no card for it")
        for r in parsed["rows"]:
            if not KNOWN.match(r["status"].strip()):
                problems.append(f"{name}, step {r['step']} ({r['who']}): status {r['status']!r} isn't one the panel reads")
        if not complete(d, parsed):
            open_tasks.append(name)
    listed = set()
    for t in rec.get("tasks") or []:
        if not isinstance(t, dict):
            continue
        p = Path(panel.local_path(str(t.get("folder") or ""))) if t.get("folder") else folder / str(t.get("slug") or "")
        listed.add(p.name)
        if not (p / "STATUS.md").is_file() and str(t.get("status") or "").lower() not in ("done", "skipped", "cancelled"):
            problems.append(f"task {t.get('slug') or p.name}: {fwd(p)} has no STATUS.md, the board can't show it")
    for name in sorted(set(on_disk) - listed):
        notes.append(f"{name}: on the board but not in the record's tasks")
    act = rec.get("active_task")
    if act and not (Path(panel.local_path(act)) / "STATUS.md").is_file():
        problems.append(f"active_task {act} has no STATUS.md")
    for depth in ("*/*/STATUS.md", "*/*/*/STATUS.md"):
        for p in folder.glob(depth):
            if not SKIP.intersection(p.relative_to(folder).parts):
                problems.append(f"{fwd(p)} is too deep: the board reads only <team folder>/<task>/STATUS.md")
    block = workspace_block()
    mine = BLOCK.search(panel.read_text_any(folder / "CLAUDE.md")) if (folder / "CLAUDE.md").is_file() else None
    if block and (not mine or " ".join(mine.group(0).split()) != " ".join(block.split())):
        problems.append("CLAUDE.md: the Teamly block is missing or older than this version: put it by references/workspace.md")
    today = time.strftime("%Y-%m-%d")
    if not (isinstance(rec.get("today"), dict) and rec["today"].get("date") == today):
        notes.append("no plan for today: the board says «No plan for today yet» (task.py new … --today)")
    if not open_tasks:
        notes.append("no open task on the board: if agents are working, start their task with task.py new")
    return out(not problems, team=rec.get("slug"), open=open_tasks, problems=problems, notes=notes)


def main(argv=None):
    p = argparse.ArgumentParser(description="Tasks on the floor's board (see the top of this file).")
    sub = p.add_subparsers(dest="cmd", required=True)
    n = sub.add_parser("new", help="a task folder with STATUS.md, written into the team record")
    n.add_argument("folder", help="the team folder")
    n.add_argument("--title", required=True, help="in English: the panel's language")
    n.add_argument("--step", action="append", default=[], help='"Agent Name=1-file.md", in chain order; the person: "You"')
    n.add_argument("--goal", help="goal id from the team record (default: the team's only goal)")
    n.add_argument("--slug", help="default: <YYYY-MM-DD>-<title>")
    n.add_argument("--working", help="step 1 starts right away: what it does now")
    n.add_argument("--now")
    n.add_argument("--next")
    n.add_argument("--today", action="store_true", help="also put it into today's plan")
    n.add_argument("--plan", help="today's plan, one line in English")
    n.add_argument("--team", help="team slug, when the folder alone doesn't find the record")
    s = sub.add_parser("step", help="set one step's status")
    s.add_argument("task", help="the task folder")
    s.add_argument("n", type=int, help="step number")
    s.add_argument("status", help='"working: …", "done: <gist>", "waiting for you: <what>", "failed: … · fix: …", "paused: …"')
    s.add_argument("--now")
    s.add_argument("--next")
    c = sub.add_parser("check", help="what the board can't show")
    c.add_argument("folder", help="the team folder")
    c.add_argument("--team", help="team slug, when the folder alone doesn't find the record")
    a = p.parse_args(argv)
    return {"new": cmd_new, "step": cmd_step, "check": cmd_check}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
