#!/usr/bin/env python3
"""Teamly onboarding analyser: what does this person do over and over in Claude Code and Codex?

Reads the local session history (never sends it anywhere), keeps only what a person asked for and which
tools/skills were used, and writes a compact digest the coordinator reads to suggest agents and teams.

  ~/.claude/projects/*/*.jsonl        Claude Code sessions (CLI and the desktop app)
  ~/.codex/sessions/**/*.jsonl        Codex sessions

Output (~/.teamly/analysis/):
  progress.json   {"done", "total", "phase"}             — the panel shows it while the scan runs
  digest.md       one line per session, grouped by project — what the coordinator reads
  digest.json     the same, structured, plus totals        — for the panel

Usage: python3 analyze.py [--days 30] [--out ~/.teamly/analysis]
"""
import glob
import json
import os
import re
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

HOME = Path.home()
CLAUDE_GLOB = str(HOME / ".claude/projects/*/*.jsonl")
CODEX_GLOB = str(HOME / ".codex/sessions/**/*.jsonl")
SKIP_PREFIXES = ("<", "Caveat:", "This session is being continued", "[Request interrupted", "# AGENTS.md", "[Image")
TAG_RE = re.compile(r"</?[a-zA-Z_-]+(?:\s[^>]*)?>")
# Keys and tokens people paste into chats must never reach the digest.
SECRET_RE = re.compile(r"(?:\b(?:sk|pk|rk)[-_][A-Za-z0-9_\-]{8,}|\bpolar_[A-Za-z0-9_]{8,}|\bgh[pousr]_[A-Za-z0-9]{8,}|\bxox[abpr]-[A-Za-z0-9\-]{8,}|\bAIza[A-Za-z0-9_\-]{10,}|\bAQ\.[A-Za-z0-9_\-\.]{10,}|\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-\.]+|\b[A-Za-z0-9_\-]{32,}\b)")
try:  # the same key and token shapes the privacy check knows, when the forge sits next to this skill
    sys.path.insert(0, str(Path(__file__).resolve().parent / "forge" / "scripts"))
    import share_check as _sc  # noqa: E402
    SHARE_KEYS = [_sc.KEY_PREFIX, _sc.JWT, _sc.KEY_CONTEXT, _sc.URLSECRET, _sc.AUTH_HEADER, _sc.KEY_WORDS,
                  re.compile(r"://[^/\s:@]+:([^@\s/]+)@"), re.compile(r"hooks\.slack\.com/services/\S+|discord(?:app)?\.com/api/webhooks/\S+"),
                  re.compile(r"\b(?:AWS_SECRET_ACCESS_KEY|aws_secret_access_key)\s*[:=]\s*['\"]?([A-Za-z0-9/+=]{30,})")]
except Exception:
    SHARE_KEYS = []
PATH_RE = re.compile(r'@?"?(?:/Users|~)/[^"\s]*/([^/"\s]+)"?')


def clean(text, limit):
    """A person's own words, one line. Pasted blocks keep their text, system/command wrappers are dropped."""
    if not isinstance(text, str):
        return ""
    t = text.strip()
    if t.startswith("<pasted_content"):
        t = TAG_RE.sub(" ", t)
    elif t.startswith(SKIP_PREFIXES):
        return ""
    t = re.sub(r"\s+", " ", t).strip()
    t = PATH_RE.sub(lambda m: f"[file {m.group(1)[:40]}]", t)
    t = SECRET_RE.sub("[secret]", t)
    for rx in SHARE_KEYS:  # the privacy check's own key shapes: GitLab, AWS, PEM, `password=…`, secrets in links
        t = rx.sub(lambda m: m.group(0).replace(m.group(m.lastindex or 0), "[secret]") if m.lastindex else "[secret]", t)
    return t[:limit] + ("…" if len(t) > limit else "")


def short_tool(name):
    if not name:
        return ""
    if name.startswith("mcp__"):
        parts = name.split("__")
        return f"mcp:{parts[1][:18]}" if len(parts) > 1 else name
    return name


def user_texts_claude(msg):
    content = msg.get("content")
    if isinstance(content, str):
        return [content]
    out = []
    for b in content or []:
        if isinstance(b, dict) and b.get("type") == "text":
            out.append(b.get("text", ""))
    return out


def scan_claude(path, since):
    s = {"src": "claude", "path": path, "title": None, "asks": [], "turns": 0, "tools": Counter(), "skills": Counter(),
         "commands": Counter(), "cwd": None, "first_ts": None, "last_ts": None}
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            # cheap filter: the big service lines (api blobs, snapshots, attachments) are never parsed
            if '"type":"user"' not in line and '"type":"assistant"' not in line and '"custom-title"' not in line:
                continue
            try:
                d = json.loads(line)
            except ValueError:
                continue
            t = d.get("type")
            if t == "custom-title":
                s["title"] = d.get("customTitle") or s["title"]
                continue
            if d.get("isSidechain"):
                continue  # subagents' internal turns
            ts = d.get("timestamp")
            if ts:
                s["first_ts"] = s["first_ts"] or ts
                s["last_ts"] = ts
            s["cwd"] = s["cwd"] or d.get("cwd")
            msg = d.get("message") or {}
            if t == "user" and not d.get("isMeta"):
                for raw in user_texts_claude(msg):
                    m = re.search(r"<command-name>/?([^<]+)</command-name>", raw or "")
                    if m:
                        s["commands"][m.group(1).strip()] += 1
                    txt = clean(raw, 260)
                    if txt:
                        s["turns"] += 1
                        if len(s["asks"]) < 4:
                            s["asks"].append(txt)
            elif t == "assistant":
                for b in msg.get("content") or []:
                    if isinstance(b, dict) and b.get("type") == "tool_use":
                        name = b.get("name")
                        if name == "Skill":
                            s["skills"][(b.get("input") or {}).get("skill", "?")] += 1
                        else:
                            s["tools"][short_tool(name)] += 1
    return s


def scan_codex(path, since):
    s = {"src": "codex", "path": path, "title": None, "asks": [], "turns": 0, "tools": Counter(), "skills": Counter(),
         "commands": Counter(), "cwd": None, "first_ts": None, "last_ts": None}
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            if '"session_meta"' not in line and '"response_item"' not in line:
                continue
            try:
                d = json.loads(line)
            except ValueError:
                continue
            p = d.get("payload") or {}
            ts = d.get("timestamp")
            if ts:
                s["first_ts"] = s["first_ts"] or ts
                s["last_ts"] = ts
            if d.get("type") == "session_meta":
                s["cwd"] = p.get("cwd")
                continue
            if p.get("type") == "message" and p.get("role") == "user":
                for b in p.get("content") or []:
                    txt = clean(b.get("text", "") if isinstance(b, dict) else "", 260)
                    if txt:
                        s["turns"] += 1
                        if len(s["asks"]) < 4:
                            s["asks"].append(txt)
            elif p.get("type") in ("function_call", "custom_tool_call"):
                s["tools"][short_tool(p.get("name"))] += 1
    return s


def parse_ts(ts):
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        return None


def main(argv):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # Cyrillic in the digest; Windows consoles default to cp1252
    days = int(argv[argv.index("--days") + 1]) if "--days" in argv else 30
    out = Path(os.path.expanduser(argv[argv.index("--out") + 1])) if "--out" in argv else HOME / ".teamly/analysis"
    out.mkdir(parents=True, exist_ok=True)
    since = time.time() - days * 86400
    files = [("claude", f) for f in glob.glob(CLAUDE_GLOB) if os.path.getmtime(f) >= since]
    files += [("codex", f) for f in glob.glob(CODEX_GLOB, recursive=True) if os.path.getmtime(f) >= since]
    files.sort(key=lambda x: os.path.getmtime(x[1]))
    total = len(files)

    def progress(done, phase):
        (out / "progress.json").write_text(json.dumps({"done": done, "total": total, "phase": phase, "at": int(time.time())}), encoding="utf-8")

    progress(0, "scanning")
    started = time.time()
    sessions = []
    for i, (src, f) in enumerate(files, 1):
        try:
            s = scan_claude(f, since) if src == "claude" else scan_codex(f, since)
        except OSError:
            continue
        if s["turns"]:
            sessions.append(s)
        if i % 10 == 0 or i == total:
            progress(i, "scanning")

    # ---------- forks repeat the parent's first messages: keep the longest copy, count the rest
    best = {}
    for s in sessions:
        key = ((s["cwd"] or "?"), (s["asks"][0] if s["asks"] else "")[:120])
        if key not in best or s["turns"] > best[key][0]["turns"]:
            best[key] = (s, best.get(key, (None, 0))[1] + 1)
        else:
            best[key] = (best[key][0], best[key][1] + 1)
    sessions = []
    for s, copies in best.values():
        s["copies"] = copies
        sessions.append(s)

    # ---------- digest
    rows = []
    for s in sessions:
        a, b = parse_ts(s["first_ts"]), parse_ts(s["last_ts"])
        project = Path(s["cwd"]).name if s["cwd"] else "?"
        rows.append({
            "src": s["src"], "date": a.strftime("%Y-%m-%d") if a else "?", "project": project,
            "title": s["title"], "turns": s["turns"], "copies": s.get("copies", 1),
            "minutes": int((b - a).total_seconds() // 60) if a and b else None,
            "asks": s["asks"],
            "skills": [k for k, _ in s["skills"].most_common(4)],
            "commands": [k for k, _ in s["commands"].most_common(3)],
            "tools": [k for k, _ in s["tools"].most_common(5)],
        })
    by_project = Counter(r["project"] for r in rows)
    skills = Counter(k for s in sessions for k in s["skills"].elements())
    tools = Counter(k for s in sessions for k in s["tools"].elements())
    totals = {
        "sessions": len(rows), "claude": sum(r["src"] == "claude" for r in rows), "codex": sum(r["src"] == "codex" for r in rows),
        "days": days, "turns": sum(r["turns"] for r in rows), "projects": by_project.most_common(20),
        "skills": skills.most_common(25), "tools": tools.most_common(20),
        "scanSeconds": round(time.time() - started, 1), "scannedFiles": total,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    (out / "digest.json").write_text(json.dumps({"totals": totals, "sessions": rows}, ensure_ascii=False, indent=1), encoding="utf-8")

    lines = [f"# Digest: {totals['sessions']} sessions in {days} days ({totals['claude']} Claude Code, {totals['codex']} Codex)",
             f"Top skills: " + ", ".join(f"{k} {v}" for k, v in totals["skills"][:15]),
             f"Top tools: " + ", ".join(f"{k} {v}" for k, v in totals["tools"][:12]), ""]
    grouped = defaultdict(list)
    for r in rows:
        grouped[r["project"]].append(r)
    for project, items in sorted(grouped.items(), key=lambda kv: -len(kv[1])):
        lines.append(f"## {project} — {len(items)} sessions")
        for r in sorted(items, key=lambda r: r["date"]):
            meta = [r["date"], r["src"], f"{r['turns']} asks"] + ([f"{r['copies']} forks"] if r["copies"] > 1 else [])
            if r["minutes"]:
                meta.append(f"{r['minutes']} min")
            if r["skills"] or r["commands"]:
                meta.append("skills: " + ",".join(r["skills"] + ["/" + c for c in r["commands"]]))
            head = f"«{SECRET_RE.sub('[secret]', r['title'])}» " if r["title"] else ""
            asks = " → ".join(a[:160] for a in r["asks"][:3])
            lines.append(f"- {' · '.join(meta)} · {head}{asks}")
        lines.append("")
    (out / "digest.md").write_text("\n".join(lines), encoding="utf-8")
    progress(total, "done")
    print(json.dumps({k: totals[k] for k in ("sessions", "claude", "codex", "turns", "scanSeconds")}, ensure_ascii=False))
    print(f"digest: {out / 'digest.md'} ({(out / 'digest.md').stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main(sys.argv[1:])
