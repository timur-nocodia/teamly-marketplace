#!/usr/bin/env python3
"""Teamly Forge: mine a person's Claude Code / Codex history for ONE task.

Finds the sessions about the task, prints what the person asked for and — most valuable — their
corrections and rejections (marked ⚑), which become the agent's rules. Keys and tokens are cut out
(same redaction as analyze.py). Reads local files only; nothing is sent anywhere.

Usage: python3 mine.py --query "reels, рилс, монтаж" [--days 30] [--top 8] [--asks 15]
"""
import glob
import json
import os
import re
import sys
import time
from pathlib import Path


def teamly_root():
    """The teamly-v2 skill folder: one level above forge/ when forge is that folder (or a link to it),
    else ~/.claude/skills/teamly-v2 when teamly-forge was installed as its own copy (Windows, the tester archive)."""
    here = Path(__file__).resolve().parent
    for cand in (here.parents[1], Path.home() / ".claude" / "skills" / "teamly-v2"):
        if (cand / "server.py").is_file() and (cand / "panel").is_dir():
            return cand
    return here.parents[1]


sys.path.insert(0, str(teamly_root()))  # analyze.py lives in the teamly-v2 skill folder
from analyze import CLAUDE_GLOB, CODEX_GLOB, clean, user_texts_claude  # noqa: E402

CORRECTION = re.compile(
    r"^(нет|не\s|стоп|подожди|почему|зачем|ужас|плохо|опять|снова)|переделай|переделать|убери|не так|не нужно|не надо|"
    r"хуйн|хуев|ебан|долж(ен|на|но|ны)|лучше (сделай|бы)|ты (опять|снова)|wrong|instead|don't|do not|stop",
    re.IGNORECASE,
)


def session_asks(src, path):
    title, cwd, first_ts, asks = None, None, None, []
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            if src == "claude":
                if '"type":"user"' not in line and '"custom-title"' not in line:
                    continue
                try:
                    d = json.loads(line)
                except ValueError:
                    continue
                if d.get("type") == "custom-title":
                    title = d.get("customTitle") or title
                    continue
                if d.get("isSidechain") or d.get("isMeta"):
                    continue
                cwd = cwd or d.get("cwd")
                first_ts = first_ts or d.get("timestamp")
                for raw in user_texts_claude(d.get("message") or {}):
                    t = clean(raw, 400)
                    if t:
                        asks.append(t)
            else:
                if '"session_meta"' not in line and '"role":"user"' not in line:
                    continue
                try:
                    d = json.loads(line)
                except ValueError:
                    continue
                p = d.get("payload") or {}
                first_ts = first_ts or d.get("timestamp")
                if d.get("type") == "session_meta":
                    cwd = p.get("cwd")
                elif p.get("type") == "message" and p.get("role") == "user":
                    for b in p.get("content") or []:
                        t = clean(b.get("text", "") if isinstance(b, dict) else "", 400)
                        if t:
                            asks.append(t)
    return {"src": src, "path": path, "title": title, "cwd": cwd, "date": (first_ts or "")[:10], "asks": asks}


def main(argv):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # quotes from chats are Cyrillic; Windows consoles default to cp1252
    def arg(name, default):
        return argv[argv.index(name) + 1] if name in argv else default

    query = arg("--query", "")
    days, top, max_asks = int(arg("--days", 30)), int(arg("--top", 8)), int(arg("--asks", 15))
    words = [w.strip().lower() for w in re.split(r"[,\s]+", query) if len(w.strip()) >= 3]
    if not words:
        print("usage: mine.py --query \"keywords\"", file=sys.stderr)
        sys.exit(2)
    since = time.time() - days * 86400
    files = [("claude", f) for f in glob.glob(CLAUDE_GLOB) if os.path.getmtime(f) >= since]
    files += [("codex", f) for f in glob.glob(CODEX_GLOB, recursive=True) if os.path.getmtime(f) >= since]

    scored, seen = [], set()
    for src, f in files:
        try:
            s = session_asks(src, f)
        except OSError:
            continue
        if not s["asks"]:
            continue
        key = (s["cwd"], s["asks"][0][:120])  # forks repeat the parent's first message
        if key in seen:
            continue
        seen.add(key)
        hay = " ".join([s["title"] or ""] + s["asks"]).lower()
        score = sum(hay.count(w) for w in words)
        if score:
            s["score"] = score
            scored.append(s)
    scored.sort(key=lambda s: -s["score"])

    out = [f"# Mine: «{query}» — {len(scored)} sessions match, top {min(top, len(scored))} shown ({days} days)", ""]
    for s in scored[:top]:
        project = Path(s["cwd"]).name if s["cwd"] else "?"
        corr = [a for a in s["asks"] if CORRECTION.search(a)]
        title = clean(s["title"], 120) if s["title"] else "—"  # a session's title is the person's words too: keys cut
        out.append(f"## {s['date']} · {project} · {s['src']} · «{title}» · score {s['score']} · {len(s['asks'])} asks, {len(corr)} corrections")
        shown = s["asks"][:max_asks]
        for a in shown:
            out.append(f"- {'⚑ ' if CORRECTION.search(a) else ''}{a}")
        rest = [a for a in corr if a not in shown]
        if rest:
            out.append("- …more corrections:")
            out.extend(f"  - ⚑ {a}" for a in rest[:10])
        out.append("")
    text = "\n".join(out)
    print(text[:60000])


if __name__ == "__main__":
    main(sys.argv[1:])
