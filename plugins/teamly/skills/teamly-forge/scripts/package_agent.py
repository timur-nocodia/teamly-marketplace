#!/usr/bin/env python3
"""Teamly: package an agent that proved useful into a draft for the shared library.

  python3 package_agent.py status  <agent dir> [--team <slug>]            readiness from ~/.teamly/ratings.jsonl (JSON)
  python3 package_agent.py draft   <agent dir> [--team <slug>] [--author "Name"] [--slug s] [--name "N"]
                                   -> <team>/team/outbox/<slug>/ : the package + manifest.json (what is public / private)
  python3 package_agent.py zip     <draft dir>      privacy check + ≥3 tests, then ~/.teamly/outbox/<slug>-<version>.zip
  python3 package_agent.py publish <draft dir>      same checks, then the local library (stand-in for the Teamly portal)

The Teamly library (https://teamly-library.fly.dev/v1; ~/.teamly/config.json "libraryUrl" or TEAMLY_LIBRARY_URL for another):
  python3 package_agent.py get     <slug> --pack <team pack> [--version 1.2.0] [--accept-risks] [--replace] [--as <slug>]
                                   -> downloads the agent, checks its sha256 and safety, installs it like an archive

Someone else's archive (sharing without a portal: the author sends the zip, the person installs it):
  python3 package_agent.py inspect   <zip>                         what is inside, who made it, safety check (JSON)
  python3 package_agent.py install   <zip> --pack <team pack> [--accept-risks] [--replace]
                                     -> <team pack>/agents/<slug>/ ; refuses "danger" findings unless the person said yes
  python3 package_agent.py configure <agent dir> --answers <json>  the person's answers into Config (`<your …>` lines)

The draft is mechanical: personal Config values become setup questions for the next person, values with paths are
dropped as private, numbers stay as defaults. The coordinator then sorts the rules (craft / taste / private), tunes
the card and the questions, runs the tests vs plain Claude (and vs the original for a fork), and only then zips.
Nothing leaves the computer here: "publish" copies into the local library folder and writes the archive.
"""
import hashlib
import json
import re
import shutil
import os
import subprocess
import sys
import tempfile
import time
import unicodedata
import urllib.error
import urllib.request
import zipfile
from datetime import datetime
from pathlib import Path

def teamly_root():
    """The teamly-v2 skill folder: one level above forge/ when forge is that folder (or a link to it),
    else ~/.claude/skills/teamly-v2 when teamly-forge was installed as its own copy (Windows, the tester archive)."""
    here = Path(__file__).resolve().parent
    for cand in (here.parents[1], Path.home() / ".claude" / "skills" / "teamly-v2"):
        if (cand / "server.py").is_file() and (cand / "panel").is_dir():
            return cand
    return here.parents[1]


HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from safety_check import decode_text, scan as safety_scan  # noqa: E402  same folder: what a shared agent could do
from share_check import private_names  # noqa: E402  the names the person listed as private (Config `private:`)

ROOT = teamly_root()
LIBRARY = ROOT / "library"   # agents shipped inside the skill: none since 0.5.5, the shared Teamly library has them
TEAMLY = Path.home() / ".teamly"
MY_LIBRARY = TEAMLY / "library"   # agents the person published: outside the skill folder, which every update replaces
RATINGS = TEAMLY / "ratings.jsonl"
OUTBOX = TEAMLY / "outbox"
LIBRARY_URL = "https://teamly-library.fly.dev/v1"   # the shared Teamly library: catalog and archives, no key needed to read

# When an agent has earned a place in the library: several good tasks on different days, nothing bad lately.
MIN_TASKS, MIN_DAYS, MIN_AVG, LAST_N = 3, 2, 4.3, 3
try:  # a one-day test can lower the "different days" rule: ~/.teamly/config.json {"shareMinDays": 1}
    MIN_DAYS = int((json.loads((Path.home() / ".teamly" / "config.json").read_bytes()) or {}).get("shareMinDays", MIN_DAYS))
except (OSError, ValueError, TypeError, AttributeError):
    pass
SKIP = {".teamly-agent", "manifest.json", ".DS_Store", "Thumbs.db", "desktop.ini"}
JUNK = ("manifest.json", ".DS_Store", "._*", "Thumbs.db", "desktop.ini", "__MACOSX", "runs")   # never inside an archive
# ("runs": test runs and task history. The eval protocol writes evals/runs/ into the draft itself; they never ship.)
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
VERSION_RE = re.compile(r"^\d{1,4}\.\d{1,4}\.\d{1,6}$")
SKIP_DIRS = {"config", "data", "__pycache__", "runs", "outbox"}
PATHLIKE = re.compile(r"(?:~/|/Users/|/home/|/Volumes/|/mnt/|/media/|\b[A-Za-z]:[\\/])")  # any disk, not only the home folder
# a default that tells nothing about the author: a number, a flag, one short word, a list of short words. A handle with
# dots or underscores, a client's name, several words — anything else becomes a setup question for the next person.
PLAIN = re.compile(r"^(?:[\d.,\s%$€₽-]{1,20}|true|false|yes|no|null|none|[a-z][a-z-]{0,19}|\[[a-z\s,-]{1,80}\])$")
PERSONAL_KEY = re.compile(r"(?i)instagram|telegram|tiktok|youtube|twitter|linkedin|channel|handle|account|client|customer|"
                          r"company|brand|business|name|email|phone|site|domain|url|city|address")


def stamp(ts):
    """Unix seconds from a number or an ISO time (a coordinator writes either); 0 when it is neither."""
    try:
        return float(ts or 0)
    except (TypeError, ValueError):
        pass
    try:
        return datetime.fromisoformat(str(ts).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def stars_of(r):
    """1–5 stars of a rating line, 0 for anything else ("five", a list, a cut line)."""
    try:
        n = int(r.get("stars", 0) or 0)
    except (TypeError, ValueError, AttributeError):
        return 0
    return n if 1 <= n <= 5 else 0


def ratings_for(slug, team=None):
    """Ratings of an agent, oldest first. A line cut by a full disk, a list or an ISO time never breaks the count."""
    rows = []
    if RATINGS.is_file():
        for line in (decode_text(RATINGS.read_bytes()) or "").splitlines():  # a BOM or UTF-16 from a Windows tool too
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if isinstance(r, dict) and r.get("agent") == slug and (team is None or r.get("team") in (None, team)):
                rows.append({**r, "ts": stamp(r.get("ts"))})
    return sorted(rows, key=lambda r: r["ts"])


def readiness(agent_dir, team=None):
    d = Path(agent_dir)
    slug = d.name
    rows = [r for r in ratings_for(slug, team) if stars_of(r)]
    stars = [stars_of(r) for r in rows]
    tasks = len({r.get("task") for r in rows})
    days = len({datetime.fromtimestamp(float(r.get("ts", 0) or 0)).date() for r in rows})
    avg = round(sum(stars) / len(stars), 2) if stars else None
    last = stars[-LAST_N:]
    card = read_json(d / "card.json") or {}
    from_archive = (read_json(d / ".teamly-source.json") or {}).get("from") in ("archive", "library")
    changed = (d / "CHANGES.md").is_file() or (not from_archive and (card.get("source") == "built" or not card.get("upstream")))
    checks = [
        {"id": "tasks", "ok": tasks >= MIN_TASKS, "label": f"{MIN_TASKS}+ rated tasks", "value": tasks},
        {"id": "days", "ok": days >= MIN_DAYS, "label": f"on {MIN_DAYS}+ different days", "value": days},
        {"id": "avg", "ok": avg is not None and avg >= MIN_AVG, "label": f"average {MIN_AVG}★ or more", "value": avg},
        {"id": "recent", "ok": bool(last) and min(last) >= 3, "label": f"no 1–2★ in the last {LAST_N}", "value": last},
        {"id": "changed", "ok": changed, "label": "your version differs from the library one", "value": changed},
    ]
    return {"slug": slug, "ready": all(c["ok"] for c in checks), "checks": checks,
            "proof": {"tasks": tasks, "days": days, "avg": avg, "ratings": len(stars),
                      "since": datetime.fromtimestamp(float(rows[0]["ts"])).date().isoformat() if rows else None}}


CYRILLIC = dict(zip("абвгдеёжзийклмнопрстуфхцчшщъыьэюя", ["a", "b", "v", "g", "d", "e", "e", "zh", "z", "i", "y", "k", "l", "m", "n",
                   "o", "p", "r", "s", "t", "u", "f", "kh", "ts", "ch", "sh", "shch", "", "y", "", "e", "yu", "ya"]))


def latin(text):
    """A name in Latin letters for a file or a slug: Анна → anna, Игорь → igor (other scripts stay as they are)."""
    return "".join(CYRILLIC.get(c, CYRILLIC.get(c.lower(), c).capitalize() if c.isupper() else c) for c in str(text))


def read_json(p):
    try:
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


CONFIG_HEAD = re.compile(r"^#{2,}\s*Config", re.IGNORECASE)
DASH_KEY = re.compile(r"^- `?([^:`\n]+?)`?:\s*(.*)$")                # - key: value  /  - `key`: value  /  - key (k): value
# key: value  # note, inside a ```yaml block; a quoted value keeps its own "#"
YAML_KEY = re.compile(r"""^(\s*)([\w.\-]+):\s*("(?:[^"\\]|\\.)*"|'[^']*'|[^#]*?)\s*(#.*)?$""")
EMPTY = re.compile(r"^(?:|null|none|nil|~|\[\]|\{\}|\"\"|''|true|false|yes|no|[\d.,\s%$€₽–-]+)$", re.IGNORECASE)
CONTACT = re.compile(r"https?://|www\.|t\.me/|wa\.me/|(?<![\w])@[\w.]{3,}|[\w.+-]+@[\w-]+\.[\w.]+|\+\d[\d\s()-]{7,}")


def config_entries(lines):
    """Every setting of the Config section and where it is. The library writes three ways: `- key: value`,
    ``- `key`: value`` and a ```yaml block (nested keys become dotted: cta.payload)."""
    out, inside, in_yaml, stack = [], False, False, []
    for i, line in enumerate(lines):
        if re.match(r"^#{2,}\s", line):
            inside, in_yaml, stack = bool(CONFIG_HEAD.match(line)), False, []
        elif inside and line.strip().startswith("```"):
            in_yaml, stack = (not in_yaml) and line.strip()[3:].strip().lower() in ("yaml", "yml", ""), []
        elif inside and in_yaml:
            m = YAML_KEY.match(line)
            if m and not line.strip().startswith(("#", "- ")) and not any(i in e.get("nested", []) for e in out[-1:]):
                indent = len(m.group(1))
                while stack and stack[-1][0] >= indent:
                    stack.pop()
                items = []
                for j in range(i + 1, len(lines)):  # `key:` followed by "- item" lines is a list, not a parent
                    if re.match(rf"^{re.escape(m.group(1))}\s+- ", lines[j]):
                        items.append(j)
                    elif lines[j].strip():
                        break
                if m.group(3) == "" and items:
                    out.append({"i": i, "key": ".".join([k for _, k in stack] + [m.group(2)]), "kind": "yaml", "indent": m.group(1),
                                "name": m.group(2), "note": m.group(4) or "", "nested": items,
                                "value": "[" + ", ".join(lines[j].strip()[2:] for j in items) + "]"})
                elif m.group(3) == "":  # a parent of nested keys
                    stack.append((indent, m.group(2)))
                else:
                    out.append({"i": i, "key": ".".join([k for _, k in stack] + [m.group(2)]), "value": m.group(3), "kind": "yaml",
                                "indent": m.group(1), "name": m.group(2), "note": m.group(4) or ""})
        elif inside:
            m = DASH_KEY.match(line)
            if m:
                nested = []
                for j in range(i + 1, len(lines)):  # a value that goes on over indented lines
                    if not re.match(r"^\s{2,}\S", lines[j]):
                        break
                    nested.append(j)
                out.append({"i": i, "key": m.group(1), "value": m.group(2).strip(), "kind": "dash", "nested": nested,
                            "tick": line.startswith("- `")})
    return out


def config_line(e, value, note=True, raw=False):
    """The setting's line with another value, in the format it was written in. raw: the value goes in as written (a kept
    yaml value is never re-quoted); note=False drops the `# note` that came with it."""
    if e["kind"] == "yaml":
        v = value if raw else json.dumps(value, ensure_ascii=False)
        return f'{e["indent"]}{e["name"]}: {v}' + (f'  {e["note"]}' if note and e["note"] else "")
    return f'- `{e["key"]}`: {value}' if e["tick"] else f'- {e["key"]}: {value}'


def upstream_config(src, slug):
    """The Config the agent started from: what came in the archive it was installed from, else the library's agent with
    that slug. Values equal to it are already public; the person's own changes are what must not travel."""
    got = read_json(Path(src) / ".teamly-source.json") or {}
    if isinstance(got.get("config"), dict):
        return got["config"]
    for d in ([LIBRARY / slug, MY_LIBRARY / slug, library_copy(slug)] if slug else []):
        if d and (d / "ontology.md").is_file():
            return {e["key"]: e["value"] for e in config_entries((d / "ontology.md").read_text(encoding="utf-8").splitlines())}
    return None


def strip_note(v):
    """A dash setting's value without its "(note)" at the end: "ru (у автора en)" → "ru"."""
    return re.sub(r"\s*\(.*\)\s*$", "", str(v)).strip()


def personal(key, value, upstream):
    """Is this setting the author's own? A link, a handle, an address or a phone always is. For an agent that started
    from another one, a value it changed is (a number, a flag or one word is a tweak of craft, not a person); for an agent
    built from scratch, a free-text value under a personal key is (a client, a channel, a brand)."""
    v = value.strip()
    if "<your " in v:  # a question nobody answered yet: the next person gets it too
        return True
    if ("<" in v and ">" in v) or EMPTY.match(v):
        return False
    if CONTACT.search(v):
        return True
    if upstream is not None and key in upstream:
        return " ".join(strip_note(v).split()) != " ".join(strip_note(upstream[key]).split()) and not PLAIN.match(strip_note(v))
    return bool(PERSONAL_KEY.search(key.split(".")[-1])) and not PLAIN.match(v)


def config_to_questions(text, upstream=None, names=(), hidden=None):
    """The Config section of ontology.md for sharing: the author's own values -> `<your …>` + a setup question, values
    that point to the author's files -> private, the rest stays as the default. A note that names the author (a link, a
    handle, a path, one of their private names) is dropped from a setting that stays. A Config line this can't read is
    reported (unread), never passed as clean. hidden: a list that gets each replaced value with its placeholder."""
    lines = text.splitlines()
    entries = config_entries(lines)
    questions, private, keep, drop = [], [], [], set()
    own = re.compile("|".join(re.escape(n) for n in names), re.IGNORECASE) if names else None
    for e in entries:
        key, value = e["key"], e["value"]
        bare = strip_note(value) if e["kind"] == "dash" else value
        note = value[len(bare):].strip() if e["kind"] == "dash" else e["note"]
        nested = " ".join(lines[j] for j in e.get("nested", []))
        human = key.replace("_", " ").replace(".", " ")
        if key.split(".")[-1].lower() == "private":
            lines[e["i"]] = config_line(e, "<names only you know — stay on your computer>", note=False)
            drop.update(e.get("nested", []))
            private.append({"key": key, "why": "private names"})
        elif PATHLIKE.search(" ".join([bare, nested])):
            lines[e["i"]] = config_line(e, f"<your {human}>", note=False)
            drop.update(e.get("nested", []))
            private.append({"key": key, "why": "points to files on the author's computer"})
            if hidden is not None:
                hidden.append((bare, f"<your {human}>"))
            questions.append({"key": key, "ask": f"Your {human} (a file or folder on your computer)?"})
        elif personal(key, bare, upstream) or (nested and CONTACT.search(nested)) or (own and own.search(bare)):
            lines[e["i"]] = config_line(e, f"<your {human}>", note=False)
            drop.update(e.get("nested", []))
            questions.append({"key": key, "ask": f"Your {human}?"})
            if hidden is not None:
                hidden.append((bare, f"<your {human}>"))
        else:
            if note and (PATHLIKE.search(note) or CONTACT.search(note) or (own and own.search(note))):
                # the note is the author's own example (their handle, file, client): the default stays, the note doesn't
                lines[e["i"]] = config_line(e, bare, note=False, raw=True)
                private.append({"key": key, "why": "the note with it named the author's own things"})
            keep.append({"key": key, "default": bare})
    inside, unread = False, False
    for i, line in enumerate(lines):  # a "- …" setting line that none of the three formats could read
        if re.match(r"^#{2,}\s", line):
            inside = bool(CONFIG_HEAD.match(line))
        elif inside and line.startswith("- ") and ":" in line and not any(e["i"] == i for e in entries) and i not in drop:
            unread = True
    unread = unread or (bool(re.search(r"^#{2,}\s*Config", text, re.MULTILINE | re.IGNORECASE)) and not entries)
    out = [line for i, line in enumerate(lines) if i not in drop]
    return "\n".join(out) + ("\n" if text.endswith("\n") else ""), questions, private, keep, unread


def cmd_status(agent_dir, team):
    print(json.dumps(readiness(agent_dir, team), ensure_ascii=False, indent=1))
    return 0


def upstream_of(src, card):
    """Who this agent came from: an archive someone sent (that author), else the card's upstream in this library."""
    up = card.get("upstream")
    got = read_json(Path(src) / ".teamly-source.json") or {}
    if got.get("from") in ("archive", "library"):  # installed from someone's archive or the library: that author is the original
        up = {"slug": got.get("slug"), "version": got.get("version"), "author": got.get("author")}
    up_slug = (up.split("@")[0] if isinstance(up, str) else (up or {}).get("slug")) or None  # "trend-radar@1.0.0" or {"slug": …}
    if got.get("from") in ("archive", "library"):  # the archive is the truth, even if this library has an agent with the same slug
        up_card = {"slug": up_slug, "version": up.get("version"), "author": up.get("author"), "name": card.get("name")}
    else:
        up_card = (read_json(LIBRARY / up_slug / "card.json") or read_json(MY_LIBRARY / up_slug / "card.json")
                   or read_json((library_copy(up_slug) or MY_LIBRARY / up_slug) / "card.json")) if up_slug else None
    return up_slug, up_card


def next_version(previous_card):
    """A package made again from the same agent or team gets the next patch version, so people can tell which is newer."""
    v = str((previous_card or {}).get("version") or "")
    if not VERSION_RE.match(v):
        return "1.0.0"
    major, minor, patch = (int(x) for x in v.split("."))
    return f"{major}.{minor}.{patch + 1}"


def package_files(src, dst, upstream=None):
    """Copy an agent for sharing: no data, history, local settings or hidden files; Config values -> setup questions.
    upstream: the Config the agent started from (upstream_config): values equal to it stay as defaults."""
    if dst.exists():
        shutil.rmtree(dst)
    included, excluded = [], []
    for f in sorted(src.rglob("*")):
        rel = f.relative_to(src)
        if f.is_dir():
            continue
        if f.name in SKIP or any(p in SKIP_DIRS for p in rel.parts[:-1]) or f.suffix == ".jsonl":
            excluded.append({"path": str(rel), "why": "your data, history or local settings"})
            continue
        if any(p.startswith(".") for p in rel.parts):
            excluded.append({"path": str(rel), "why": "a hidden settings file (like .env): stays on your computer"})
            continue
        (dst / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, dst / rel)
        included.append(str(rel))
    questions, private, keep, hidden = [], [], [], []
    onto = dst / "ontology.md"
    if onto.is_file():
        text, questions, private, keep, unread = config_to_questions(onto.read_text(encoding="utf-8"), upstream, private_names(src),
                                                                     hidden)
        onto.write_text(text, encoding="utf-8")
        if unread:  # never pass settings nobody looked at: the person checks them by hand
            private.append({"key": "Config", "why": "settings in a form the packager can't read: check them by hand"})
    scrub_changes(dst, hidden)
    return included, excluded, questions, private, keep


def scrub_changes(dst, hidden):
    """CHANGES.md is written while the agent is set up and may repeat its settings ("handle: @maria_cuts"): a value
    that became `<your …>` in Config becomes the same placeholder there too. Short or number-only values stay: they
    are not personal and would hit ordinary words ("step 5")."""
    pairs = sorted(((v.strip().strip("\"'`"), ph) for v, ph in hidden), key=lambda x: -len(x[0]))
    pairs = [(v, ph) for v, ph in pairs if len(v) >= 4 and re.search(r"[^\d\s.,]", v)]
    if not pairs:
        return
    for name in ("CHANGES.md", "CHANGES.upstream.md"):
        f = dst / name
        if not f.is_file():
            continue
        text = decode_text(f.read_bytes())
        if text is None:
            continue
        new = text
        for v, ph in pairs:
            new = re.sub(rf"(?<!\w){re.escape(v)}(?!\w)", lambda _m, ph=ph: ph, new, flags=re.IGNORECASE)
        if new != text:
            f.write_text(new, encoding="utf-8")


def cmd_draft(agent_dir, team, author, slug, name):
    src = Path(agent_dir).expanduser().resolve()
    card = read_json(src / "card.json") or {}
    own_upstream = card.get("upstream")  # as its author wrote it (the team record of a received agent names the archive)
    if not card.get("upstream") and team:  # hire step 3.5 also writes the origin into the team record
        rec = read_json(TEAMLY / "teams" / f"{team}.json") or {}
        a = next((x for x in rec.get("agents") or [] if isinstance(x, dict) and x.get("slug") == src.name), {})
        if isinstance(a.get("upstream"), (str, dict)) and a.get("upstream"):
            card = {**card, "upstream": a["upstream"]}
    up_slug, up_card = upstream_of(src, card)
    got = read_json(src / ".teamly-source.json") or {}
    passing_on = got.get("from") in ("archive", "library") and not (src / "CHANGES.md").is_file()
    if passing_on:  # received as a file and not changed here: it goes on as its author's agent, never under a new name
        author, slug, name = got.get("author") or card.get("author") or "?", slug or got.get("slug") or card.get("slug"), name or card.get("name")
        up_slug, up_card = None, None
    author = author or card.get("author") or "?"
    first = re.sub(r"[^a-z0-9]+", "-", latin(author.split()[0]).lower()).strip("-") or "me"
    slug = slug or (f"{up_slug}-by-{first}" if up_slug else re.sub(r"[^a-z0-9-]+", "-", src.name.lower()).strip("-"))
    if not SLUG_RE.match(slug):
        print(f"Bad slug {slug!r}: lowercase letters, digits and hyphens only")
        return 1
    name = name or (f"{(up_card or {}).get('name', card.get('name', src.name))} · {author.split()[0]}'s version" if up_slug else card.get("name", src.name))
    team_pack = src.parent.parent if src.parent.name == "agents" else src.parent
    dst = team_pack / "outbox" / src.name
    version = next_version(read_json(dst / "card.json")) if (dst / "card.json").is_file() else "1.0.0"
    if passing_on:
        version = str(got.get("version") or card.get("version") or "1.0.0")  # the author's own version, unchanged
    names = private_names(src)  # read before the copy turns the `private:` line into a placeholder
    included, excluded, questions, private, keep = package_files(src, dst, upstream_config(src, up_slug or card.get("slug") or src.name))
    (dst / "manifest.json").write_text(json.dumps({"privateNames": names}, ensure_ascii=False) + "\n", encoding="utf-8")
    ready = readiness(src, team)
    new_card = {
        **{k: v for k, v in (up_card or {}).items() if k in ("job", "runtime", "tags", "interfaces", "functionType", "costBreakdown", "tools", "time", "sprite")},
        **{k: v for k, v in card.items() if k not in ("results", "rating", "week", "sharedAt", "path")},
        "slug": slug, "name": name, "author": author, "authorKind": "practitioner", "version": version,
        "upstream": {"slug": up_slug, "version": (up_card or {}).get("version"), "author": (up_card or {}).get("author")} if up_slug
                    else own_upstream if passing_on else None,  # passed on unchanged: the original stays in the chain
        "setup": questions, "proof": ready["proof"], "evalWin": card.get("evalWin"), "evalVsUpstream": card.get("evalVsUpstream"),
        "results": 0, "sharedAt": None, "draftAt": datetime.now().isoformat(timespec="seconds"),
        # which agent of which author this is, as an opaque id: two of one author's forks on two floors never mix
        "lineage": __import__("hashlib").sha256(f"{author}|{src}".encode()).hexdigest()[:12],
    }
    (dst / "card.json").write_text(json.dumps(new_card, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    privacy = run_share_check(dst)
    needs = []
    if not new_card.get("evalWin"):
        needs.append("tests vs plain Claude (teamly-forge, step 8)")
    if up_slug and not new_card.get("evalVsUpstream"):
        needs.append(f"tests vs the original {up_slug} — a new version has to beat it")
    if not privacy["ok"]:
        needs.append("fix the privacy findings")
    if not ready["ready"]:
        needs.append("not proven yet: " + ", ".join(c["label"] for c in ready["checks"] if not c["ok"]))
    manifest = {
        "slug": slug, "name": name, "from": src.name, "draft": str(dst), "draftAt": new_card["draftAt"],
        "public": included, "private": excluded + [{"path": f"Config · {p['key']}", "why": p["why"]} for p in private],
        "setupQuestions": questions, "defaults": keep, "privacy": privacy, "proof": ready, "needs": needs,
        "zip": None, "publishedAt": None, "privateNames": names,
    }
    (dst / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(json.dumps({"draft": str(dst), "slug": slug, "needs": needs, "setupQuestions": len(questions), "private": len(manifest["private"])}, ensure_ascii=False, indent=1))
    return 0


def run_share_check(d):
    r = subprocess.run([sys.executable, str(HERE / "share_check.py"), str(d)], capture_output=True, text=True,
                       encoding="utf-8", errors="replace", env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    findings = [l.strip() for l in r.stdout.splitlines() if l.strip().startswith("✗")]
    return {"ok": r.returncode == 0, "findings": findings[:30]}


def checked(draft):
    d = Path(draft).expanduser().resolve()
    m = read_json(d / "manifest.json") or {}
    privacy = run_share_check(d)
    m["privacy"] = privacy
    card = read_json(d / "card.json") or {}
    slug, version = card.get("slug", d.name), card.get("version", "1.0.0")
    if not isinstance(slug, str) or not SLUG_RE.match(slug) or not isinstance(version, str) or not VERSION_RE.match(version):
        print(f"Not packaged — card.json needs a slug like my-agent and a version like 1.0.0 (has {slug!r}, {version!r})")
        return None, None, None
    safety = safety_scan(d)
    m["safety"] = safety
    problems = privacy["findings"] if not privacy["ok"] else []
    problems += [f"!! {x['kind']}: {x['file']}:{x['line']} {x['text']}" for x in safety["findings"] if x["level"] == "danger"]
    if problems:
        (d / "manifest.json").write_text(json.dumps(m, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print("Not packaged — fix first:\n  " + "\n  ".join(problems))
        return None, None, None
    return d, m, card


def make_zip(d, card):
    OUTBOX.mkdir(parents=True, exist_ok=True)
    base = OUTBOX / f"{card.get('slug', d.name)}-{card.get('version', '1.0.0')}"
    tmp = Path(tempfile.mkdtemp())
    shutil.copytree(d, tmp / card.get("slug", d.name), ignore=shutil.ignore_patterns(*JUNK))
    path = shutil.make_archive(str(base), "zip", tmp)
    shutil.rmtree(tmp)
    return path


def cmd_zip(draft):
    d, m, card = checked(draft)
    if not d:
        return 1
    m["zip"] = make_zip(d, card)
    (d / "manifest.json").write_text(json.dumps(m, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(json.dumps({"zip": m["zip"]}, ensure_ascii=False))
    return 0


def cmd_publish(draft):
    d, m, card = checked(draft)
    if not d:
        return 1
    slug = card.get("slug", d.name)

    def other(x):  # a different agent already has this name: another author, or another of this author's agents
        c = read_json(x / "card.json") or {}
        return x.exists() and (c.get("author") != card.get("author") or (c.get("lineage") and card.get("lineage") and c["lineage"] != card["lineage"]))
    target, n = MY_LIBRARY / slug, 2
    while other(LIBRARY / slug) or other(target):
        slug = f"{card.get('slug', d.name)}-{n}"
        target, n = MY_LIBRARY / slug, n + 1
    card["slug"] = slug
    card["sharedAt"] = datetime.now().isoformat(timespec="seconds")
    (d / "card.json").write_text(json.dumps(card, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    m["zip"] = make_zip(d, card)  # the archive first: if it fails, nothing lands in the library half-done
    if target.exists():
        shutil.rmtree(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(d, target, ignore=shutil.ignore_patterns(*JUNK))
    m["publishedAt"] = card["sharedAt"]
    m["library"] = str(target)
    m["teamly"] = upload(m["zip"])  # the person said yes to "publish to the Teamly library": everyone sees it from here
    (d / "manifest.json").write_text(json.dumps(m, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(json.dumps({"library": str(target), "zip": m["zip"], "slug": slug, "teamly": m["teamly"]}, ensure_ascii=False))
    return 0


# ---------- someone else's archive ----------
MAX_FILES, MAX_BYTES = 2000, 60_000_000


def member_name(i):
    """A file's name as its author wrote it. Finder and many zip tools store UTF-8 names without the flag that says
    so; Python then reads them as cp437 and «заметки.md» turns into ╨╖╨░╨╝╨╡╤é╨║╨╕.md."""
    name = i.filename
    if not i.flag_bits & 0x800:
        try:
            name = name.encode("cp437").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
    return unicodedata.normalize("NFC", name).replace("\\", "/")


def safe_extract(zip_path, dest):
    """Unpack only what stays inside dest: no absolute or ../ paths, no links, no zip bombs; names as written."""
    dest = Path(dest)
    with zipfile.ZipFile(zip_path) as z:
        infos = z.infolist()
        if len(infos) > MAX_FILES or sum(i.file_size for i in infos) > MAX_BYTES:
            raise ValueError("the archive is too big for an agent")
        for i in infos:
            name = member_name(i)
            parts = [x for x in name.split("/") if x]
            if name.startswith("/") or ".." in parts or (parts and ":" in parts[0]):
                raise ValueError(f"unsafe path in the archive: {i.filename}")
            if (i.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError(f"a link in the archive: {i.filename}")
        for i in infos:
            target = dest.joinpath(*[x for x in member_name(i).split("/") if x])
            if i.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with z.open(i) as src, open(target, "wb") as out:
                shutil.copyfileobj(src, out)


def agent_root(folder):
    """The agent folder inside an unpacked archive: SKILL.md at the top, or in its only top folder."""
    folder = Path(folder)
    if (folder / "SKILL.md").is_file():
        return folder
    tops = [p for p in folder.iterdir() if p.is_dir() and not p.name.startswith(("__MACOSX", "."))]
    if len(tops) == 1 and (tops[0] / "SKILL.md").is_file():
        return tops[0]
    raise ValueError("not a Teamly agent: no SKILL.md inside")


def open_archive(zip_path):
    """Unpack to a temp folder, check the format and safety. Returns (temp dir, agent dir, card, report)."""
    zp = Path(zip_path).expanduser().resolve()
    if not zp.is_file():
        raise ValueError(f"no such file: {zp}")
    tmp = Path(tempfile.mkdtemp(prefix="teamly-agent-"))
    try:
        safe_extract(zp, tmp)
        root = agent_root(tmp)
        card = read_json(root / "card.json")
        if not isinstance(card, dict):
            raise ValueError("card.json is missing or broken")
        slug, version = card.get("slug") or root.name, card.get("version") or "1.0.0"
        if not isinstance(slug, str) or not SLUG_RE.match(slug) or not isinstance(version, str) or not VERSION_RE.match(version):
            raise ValueError(f"card.json needs a slug like my-agent and a version like 1.0.0 (has {slug!r}, {version!r})")
    except Exception:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    safety = safety_scan(root)
    job = card.get("job") if isinstance(card.get("job"), dict) else {}
    scripts = sorted(p.relative_to(root).as_posix() for p in root.rglob("*")
                     if p.is_file() and p.suffix.lower() in {".py", ".sh", ".js", ".mjs", ".ts", ".ps1", ".bat", ".cmd"})
    report = {
        "archive": zp.name, "sha256": __import__("hashlib").sha256(zp.read_bytes()).hexdigest(),
        "slug": slug, "name": card.get("name") or slug, "role": card.get("role"), "author": card.get("author") or "?",
        "version": version, "upstream": card.get("upstream"), "owns": job.get("owns"), "give": job.get("give"),
        "get": job.get("get"), "runtime": card.get("runtime"), "costBreakdown": card.get("costBreakdown") or [],
        "setup": card.get("setup") or [], "hasOntology": (root / "ontology.md").is_file(),
        "files": sum(1 for p in root.rglob("*") if p.is_file()), "scripts": scripts, "safety": safety,
    }
    return tmp, root, card, report


def cmd_inspect(zip_path):
    try:
        tmp, _, _, report = open_archive(zip_path)
    except (ValueError, OSError, zipfile.BadZipFile, RuntimeError, NotImplementedError) as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        return 1
    shutil.rmtree(tmp, ignore_errors=True)
    print(json.dumps({"ok": True, **report}, ensure_ascii=False, indent=1))
    return 0


def received_config(dest):
    """The Config as it arrived: when the person shares the agent on, values still equal to these are not theirs."""
    onto = Path(dest) / "ontology.md"
    if not onto.is_file():
        return {}
    return {e["key"]: e["value"] for e in config_entries(onto.read_text(encoding="utf-8", errors="replace").splitlines())}


def keep_as_theirs(dest):
    """The author's CHANGES.md stays readable as theirs: a CHANGES.md of the receiver's own means they changed the agent.
    A fork of a fork keeps every author's changes: the newest come on top of the earlier ones."""
    changes, upstream = Path(dest) / "CHANGES.md", Path(dest) / "CHANGES.upstream.md"
    if changes.is_file():
        earlier = upstream.read_text(encoding="utf-8", errors="replace") if upstream.is_file() else ""
        upstream.write_text(changes.read_text(encoding="utf-8", errors="replace").rstrip() + ("\n\n" + earlier if earlier else "\n"),
                            encoding="utf-8")
        changes.unlink()


def put_agent(root, dest, report, accept_risks, pack, origin=None):
    """The new version is made next to its place and moved in at the end, so a failure half-way leaves the old agent
    untouched. The person's own state (.env, settings, data, runs) comes along; the old version goes to team/backup."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=f".{report['slug']}-installing-", dir=dest.parent))
    replaced = None
    try:
        new = stage / report["slug"]
        shutil.copytree(root, new, ignore=shutil.ignore_patterns(*JUNK))  # ._* = Finder junk
        keep_as_theirs(new)
        if dest.exists():  # a run that died earlier may have left a half agent: then its state is in the newest whole backup
            backups = sorted((pack / "backup").glob(f"{report['slug']}-*"), key=lambda p: p.stat().st_mtime, reverse=True) if (pack / "backup").is_dir() else []
            state = dest if (dest / "SKILL.md").is_file() else next((b for b in backups if (b / "SKILL.md").is_file()), dest)
            for name in (".env", "config", "data", "runs"):
                old = state / name
                if old.exists() and not (new / name).exists():
                    (shutil.copytree if old.is_dir() else shutil.copy2)(old, new / name)
        source = {"from": "archive", "archive": report["archive"], "sha256": report["sha256"], "slug": report["slug"],
                  "version": report["version"], "author": report["author"], "installedAt": int(time.time()),
                  "safety": report["safety"]["verdict"], "acceptedRisks": bool(accept_risks), "config": received_config(new),
                  **(origin or {})}
        (new / ".teamly-source.json").write_text(json.dumps(source, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        if dest.exists():
            replaced = pack / "backup" / f"{report['slug']}-{time.strftime('%Y%m%d-%H%M%S')}"
            n = 2
            while replaced.exists():
                replaced, n = replaced.with_name(f"{report['slug']}-{time.strftime('%Y%m%d-%H%M%S')}-{n}"), n + 1
            replaced.parent.mkdir(parents=True, exist_ok=True)
            os.rename(dest, replaced)
        os.rename(new, dest)
    except BaseException:
        if replaced and replaced.exists() and not dest.exists():
            os.rename(replaced, dest)  # the old agent goes back where it was
        raise
    finally:
        shutil.rmtree(stage, ignore_errors=True)
    return replaced


def cmd_install(zip_path, pack, accept_risks, replace=False, as_slug=None, origin=None):
    if not pack:
        print(json.dumps({"ok": False, "error": "--pack <team pack folder> is required"}))
        return 1
    try:
        tmp, root, card, report = open_archive(zip_path)
    except (ValueError, OSError, zipfile.BadZipFile, RuntimeError, NotImplementedError) as e:  # RuntimeError: a password
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        return 1
    try:
        if report["safety"]["verdict"] == "danger" and not accept_risks:
            print(json.dumps({"ok": False, "error": "danger", "safety": report["safety"]}, ensure_ascii=False, indent=1))
            return 2
        if as_slug:  # a different agent with a taken name goes in as a second one
            if not SLUG_RE.match(as_slug):
                raise ValueError(f"--as needs a name like {report['slug']}-2")
            report = {**report, "slug": as_slug}
        dest = Path(pack).expanduser().resolve() / "agents" / report["slug"]
        if dest.exists() and not replace:
            have = read_json(dest / "card.json") or {}
            same = have.get("author") == report["author"] and (not have.get("lineage") or not card.get("lineage") or have["lineage"] == card["lineage"])
            print(json.dumps({"ok": False, "error": "exists", "path": str(dest), "version": have.get("version"), "author": have.get("author"),
                              "sameAgent": same,
                              "hint": "a newer version of the same agent: --replace (the old one goes to backup)" if same
                              else f"another author's agent with the same name: --as {report['slug']}-2 puts it in as a second one"},
                             ensure_ascii=False))
            return 3
        replaced = put_agent(root, dest, report, accept_risks, Path(pack).expanduser().resolve(), origin)
        if as_slug:
            c = read_json(dest / "card.json") or {}
            (dest / "card.json").write_text(json.dumps({**c, "slug": as_slug}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except (OSError, shutil.Error, ValueError) as e:
        print(json.dumps({"ok": False, "error": f"could not install: {e}. The agent that was on the floor stays as it was."}, ensure_ascii=False))
        return 1
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    agent = {"slug": report["slug"], "name": report["name"], "role": report["role"], "source": (origin or {}).get("from", "archive"), "path": str(dest),
             "upstream": {"slug": report["slug"], "version": report["version"], "author": report["author"]}}
    print(json.dumps({"ok": True, "path": str(dest), "agent": agent, "setup": report["setup"],
                      "safety": report["safety"]["verdict"], "replaced": str(replaced) if replaced else None}, ensure_ascii=False, indent=1))
    return 0


def cmd_configure(agent_dir, answers_file):
    """Fills the `<your …>` settings of the Config section with the person's answers, in whichever format the agent
    writes them (`- key:`, ``- `key`:``, a ```yaml block); reports what is still empty."""
    d = Path(agent_dir).expanduser().resolve()
    onto = d / "ontology.md"
    answers = read_json(answers_file) if answers_file else None
    if not onto.is_file() or not isinstance(answers, dict):
        print(json.dumps({"ok": False, "error": "need <agent dir>/ontology.md and --answers <json object>"}))
        return 1
    lines, filled = onto.read_text(encoding="utf-8").splitlines(), []
    for e in config_entries(lines):
        if e["key"] in answers:
            lines[e["i"]] = config_line(e, " ".join(str(answers[e["key"]]).split())[:300])
            filled.append(e["key"])
    onto.write_text("\n".join(lines) + "\n", encoding="utf-8")
    empty = [e["key"] for e in config_entries(lines) if "<your " in e["value"]]
    print(json.dumps({"ok": True, "filled": filled, "stillEmpty": empty}, ensure_ascii=False))
    return 0


# ---------- the Teamly library ----------
def library_url():
    """Where the Teamly library is: https only (127.0.0.1 for tests); None when the person turned it off."""
    try:
        cfg = json.loads((TEAMLY / "config.json").read_bytes())  # bytes: a BOM or UTF-16 from Windows reads too
    except (OSError, ValueError):
        cfg = {}
    url = str(os.environ.get("TEAMLY_LIBRARY_URL") or (cfg.get("libraryUrl") if isinstance(cfg, dict) else None) or LIBRARY_URL)
    url = url.strip().rstrip("/")
    if url.lower() == "off":
        return None
    if not re.match(r"^https://[\w.-]+(:\d+)?(/|$)", url) and not re.match(r"^http://(127\.0\.0\.1|localhost)(:\d+)?(/|$)", url):
        raise ValueError(f"the library address must be https: {url}")
    return url


def install_id():
    """A random id of this Teamly install: the library counts a download once a day per install, and learns nothing else."""
    f = TEAMLY / "install-id"
    try:
        v = f.read_text(encoding="utf-8").strip()
        if re.fullmatch(r"[0-9a-f]{32}", v):
            return v
    except OSError:
        pass
    v = os.urandom(16).hex()
    try:
        TEAMLY.mkdir(parents=True, exist_ok=True)
        f.write_text(v + "\n", encoding="utf-8")
    except OSError:
        pass
    return v


def download(url, dest, limit, headers=None):
    """https download with a size cap; python.org Python on macOS often lacks certificates, so curl gets a second try.
    A server that answers with an error is not asked twice: its own words come back."""
    req = urllib.request.Request(url, headers={"User-Agent": "Teamly/2", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=60) as r, open(dest, "wb") as f:
            n = 0
            while chunk := r.read(1 << 16):
                n += len(chunk)
                if n > limit:
                    raise ValueError("the file is too big for an agent or a team")
                f.write(chunk)
    except urllib.error.HTTPError as e:
        try:
            said = json.loads(e.read(20_000)).get("error")
        except (ValueError, AttributeError, OSError):
            said = None
        raise ValueError(said or f"download failed: {e.code}")
    except urllib.error.URLError as e:
        if not shutil.which("curl"):
            raise ValueError(f"download failed: {e.reason}")
        cmd = ["curl", "-fsSL", "--max-filesize", str(limit), "-A", "Teamly/2", "-o", str(dest)]
        for k, v in (headers or {}).items():
            cmd += ["-H", f"{k}: {v}"]
        r = subprocess.run(cmd + [url], capture_output=True, text=True, timeout=180)
        if r.returncode != 0:
            raise ValueError(f"download failed: {(r.stderr.strip() or str(e.reason))[:200]}")


def teamly_key():
    """The person's Teamly key where the panel looks for it: ~/.teamly/credentials.json, TEAMLY_API_KEY, ~/.env."""
    try:
        raw = (decode_text((TEAMLY / "credentials.json").read_bytes()) or "").strip()
        try:
            data = json.loads(raw)
        except ValueError:
            data = raw
        k = next((data.get(x) for x in ("key", "apiKey", "TEAMLY_API_KEY") if data.get(x)), None) if isinstance(data, dict) else data
        if isinstance(k, str) and k.strip():
            return k.strip()
    except OSError:
        pass
    if (os.environ.get("TEAMLY_API_KEY") or "").strip():
        return os.environ["TEAMLY_API_KEY"].strip()
    found = None
    try:
        for line in (Path.home() / ".env").read_text(encoding="utf-8", errors="replace").splitlines():
            m = re.match(r"""^\s*(?:export\s+)?TEAMLY_API_KEY\s*=\s*['"]?([^'"\s#]+)""", line)
            found = m.group(1) if m else found
    except OSError:
        pass
    return found


def upload(zip_path):
    """The archive into the shared Teamly library as the person whose key this is: {"uploaded": true, "slug", "version",
    "findings"} or {"uploaded": false, "why"}. The library runs the same safety and privacy checks before it takes it."""
    try:
        base = library_url()
    except ValueError as e:
        return {"uploaded": False, "why": str(e)}
    if not base:
        return {"uploaded": False, "why": "the Teamly library is turned off on this computer"}
    key = teamly_key()
    if not key or not key.startswith("tly_data_"):
        return {"uploaded": False, "why": "no Teamly key on this computer: connect it in the panel, then publish again"}
    req = urllib.request.Request(f"{base}/agents", data=Path(zip_path).read_bytes(), method="POST", headers={
        "Authorization": f"Bearer {key}", "Content-Type": "application/zip", "User-Agent": "Teamly/2"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            code, body = r.status, r.read(200_000)
    except urllib.error.HTTPError as e:
        with e:
            code, body = e.code, e.read(200_000)
    except (urllib.error.URLError, OSError) as e:  # no certificates in python.org Python on macOS: curl, the key via stdin
        if not shutil.which("curl"):
            return {"uploaded": False, "why": f"the library can't be reached: {getattr(e, 'reason', e)}"}
        r = subprocess.run(["curl", "-s", "-m", "120", "-w", "\n%{http_code}", "-K", "-", "--data-binary", f"@{zip_path}", f"{base}/agents"],
                           input=f'header = "Authorization: Bearer {key}"\nheader = "Content-Type: application/zip"\n',
                           capture_output=True, text=True, timeout=150)
        text, _, status = r.stdout.rpartition("\n")
        code, body = (int(status) if status.isdigit() else 0), text.encode("utf-8")
    try:
        ans = json.loads(body or b"{}")
    except ValueError:
        ans = {}
    if code == 201:
        return {"uploaded": True, **{k: ans.get(k) for k in ("slug", "version", "sha256", "findings")}}
    if code == 0:
        return {"uploaded": False, "why": "the library can't be reached from this computer"}
    return {"uploaded": False, "code": code, "why": ans.get("error") or f"the library answered {code}",
            **({"safety": ans["safety"]} if isinstance(ans.get("safety"), dict) else {})}


def library_copy(slug):
    """The Teamly library's agent with this slug as a folder on this computer (its newest version, downloaded once and
    checked against the catalog's sha256), for comparing a fork with its original. None when there is no such agent
    or the library can't be reached."""
    if not isinstance(slug, str) or not SLUG_RE.match(slug):
        return None
    try:
        info = library_json(f"/agents/{slug}")
        version = (info.get("agent") or {}).get("version")
        row = next((v for v in info.get("versions") or [] if isinstance(v, dict) and v.get("version") == version), None)
        if not row or not VERSION_RE.match(str(version)):
            return None
        home = TEAMLY / "cache" / "library" / f"{slug}-{version}"
        if not (home / "card.json").is_file():
            zp = TEAMLY / "cache" / "library" / f"{slug}-{version}.zip"
            zp.parent.mkdir(parents=True, exist_ok=True)
            if not zp.is_file() or hashlib.sha256(zp.read_bytes()).hexdigest() != row.get("sha256"):
                download(f"{library_url()}/agents/{slug}/download?version={version}", zp, MAX_BYTES, {"X-Teamly-Install": install_id()})
            if hashlib.sha256(zp.read_bytes()).hexdigest() != row.get("sha256"):
                return None
            tmp = Path(tempfile.mkdtemp(prefix=f".{slug}-", dir=zp.parent))
            try:
                safe_extract(zp, tmp)
                shutil.rmtree(home, ignore_errors=True)
                os.replace(agent_root(tmp), home)
            finally:
                shutil.rmtree(tmp, ignore_errors=True)
        return home if (home / "card.json").is_file() else None
    except (ValueError, OSError, zipfile.BadZipFile, AttributeError, TypeError):
        return None


def library_json(path):
    """A JSON answer of the Teamly library (an agent's catalog entry and versions)."""
    base = library_url()
    if not base:
        raise ValueError("the Teamly library is turned off (~/.teamly/config.json \"libraryUrl\": \"off\")")
    tmp = Path(tempfile.mkdtemp(prefix="teamly-library-"))
    try:
        download(base + path, tmp / "answer.json", 2_000_000)
        return json.loads((tmp / "answer.json").read_bytes())
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def cmd_get(slug, pack, version=None, accept_risks=False, replace=False, as_slug=None):
    """An agent from the Teamly library onto a floor: the archive its catalog names, checked against the catalog's
    sha256, then the same safety check and install as a file someone sent."""
    if not isinstance(slug, str) or not SLUG_RE.match(slug):
        print(json.dumps({"ok": False, "error": f"not an agent name: {slug!r}"}, ensure_ascii=False))
        return 1
    if not pack:
        print(json.dumps({"ok": False, "error": "--pack <team pack folder> is required"}))
        return 1
    try:
        info = library_json(f"/agents/{slug}")
        newest = (info.get("agent") or {}).get("version") if isinstance(info, dict) else None
        want = version or newest
        row = next((v for v in (info.get("versions") or []) if isinstance(v, dict) and v.get("version") == want), None)
        if not row or not re.fullmatch(r"[0-9a-f]{64}", str(row.get("sha256") or "")):
            raise ValueError(f"{slug} {want} is not in the Teamly library" if want else f"{slug} is not in the Teamly library")
        cache = TEAMLY / "cache" / "library"
        cache.mkdir(parents=True, exist_ok=True)
        zp = cache / f"{slug}-{want}.zip"
        download(f"{library_url()}/agents/{slug}/download?version={want}", zp, MAX_BYTES, {"X-Teamly-Install": install_id()})
        if hashlib.sha256(zp.read_bytes()).hexdigest() != row["sha256"]:
            zp.unlink()
            raise ValueError("the file from the library doesn't match its checksum: nothing was installed")
    except (ValueError, OSError) as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        return 1
    return cmd_install(zp, pack, accept_risks, replace, as_slug, origin={"from": "library", "library": library_url()})


def main(argv):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # ★ and ✓ in the output; Windows consoles default to cp1252
    if len(argv) < 2 or argv[0] not in ("status", "draft", "zip", "publish", "inspect", "install", "configure", "get"):
        print(__doc__)
        return 2
    opts = {}
    rest = [a for a in argv[2:] if a not in ("--accept-risks", "--replace")]
    while rest:
        k = rest.pop(0)
        if k.startswith("--") and rest:
            opts[k[2:]] = rest.pop(0)
    if argv[0] == "inspect":
        return cmd_inspect(argv[1])
    if argv[0] == "install":
        return cmd_install(argv[1], opts.get("pack"), "--accept-risks" in argv, "--replace" in argv, opts.get("as"))
    if argv[0] == "get":
        return cmd_get(argv[1], opts.get("pack"), opts.get("version"), "--accept-risks" in argv, "--replace" in argv, opts.get("as"))
    if argv[0] == "configure":
        return cmd_configure(argv[1], opts.get("answers"))
    if argv[0] == "status":
        return cmd_status(argv[1], opts.get("team"))
    if argv[0] == "draft":
        return cmd_draft(argv[1], opts.get("team"), opts.get("author"), opts.get("slug"), opts.get("name"))
    if argv[0] == "zip":
        return cmd_zip(argv[1])
    return cmd_publish(argv[1])


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
