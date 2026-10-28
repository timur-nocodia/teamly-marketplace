#!/usr/bin/env python3
"""Teamly: share a whole team (one floor) as one archive, and install a team someone sent — from a file or a link.

  python3 package_team.py draft   --team <slug> [--author "Name"] [--without a,b]
                                    -> <team pack>/outbox/team-<slug>/ + manifest.json; every agent of the team goes,
                                       or the draft stops and names the ones it can't find (--without leaves them out)
  python3 package_team.py zip     <team draft dir>                    privacy + safety, then ~/.teamly/outbox/team-<slug>-<ver>.zip
  python3 package_team.py fetch   <link>                              the shared archive into ~/Downloads (Dropbox, Google Drive,
                                                                      Yandex Disk and GitHub links are made direct)
  python3 package_team.py inspect <zip or link>                       a team or a single agent: who, what, safety (JSON)
  python3 package_team.py install <zip or link> --folder <dir> [--accept-risks] [--update]
                                    -> <dir>/team/ with its agents + ~/.teamly/teams/<slug>.json: a new floor, setup pending

What goes: the agents (each like a shared agent: no data, history or hidden files; personal Config values become setup
questions for the next person), the area, the goals as examples, who passes work to whom.
What stays on this computer: tasks and their results, ratings, chats, folder paths, the key.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import package_agent as pa  # noqa: E402  same folder: one agent's packaging, safe unpacking
from safety_check import scan as safety_scan  # noqa: E402

TEAMLY = Path.home() / ".teamly"
TEAMS = TEAMLY / "teams"
OUTBOX = TEAMLY / "outbox"
DOWNLOADS = Path.home() / "Downloads"
MAX_DOWNLOAD = 60_000_000
KIND, FORMAT = "teamly-team", 1
STAYS = ["tasks and their results (except the examples and tests you put into the agents)", "ratings", "chats", "folder paths", "the Teamly key"]


def out(obj, code=0):
    print(json.dumps(obj, ensure_ascii=False, indent=1))
    return code


# ---------- the author's side ----------
def local_path(p):
    """A coordinator in Git Bash may write /c/Users/…; Python on Windows needs C:/Users/… (the same rule as server.py)."""
    if os.name == "nt" and isinstance(p, str):
        m = re.match(r"^/([a-zA-Z])/(.*)$", p)
        if m:
            return f"{m.group(1).upper()}:/{m.group(2)}"
    return p


def team_pack(rec):
    if isinstance(rec.get("pack"), str) and rec["pack"]:
        return Path(local_path(rec["pack"]))
    return Path(local_path(rec["folder"])) / "team" if isinstance(rec.get("folder"), str) and rec["folder"] else None


def agent_source(rec, a):
    """The agent's own folder. The library original stands in only for an agent hired from the library as it is: a
    fork, or an agent built for this team, is never swapped for something else."""
    pack = team_pack(rec)
    own = [a.get("path"), pack / "agents" / a["slug"] if pack else None]
    library = [pa.LIBRARY / a["slug"], pa.MY_LIBRARY / a["slug"]] if a.get("source") in (None, "library") else []
    for cand in own + library + ([pa.library_copy(a["slug"])] if library else []):
        if isinstance(cand, (str, Path)) and str(cand) and (Path(local_path(str(cand))) / "SKILL.md").is_file():
            return Path(local_path(str(cand)))
    return None


def chain_link(c, built):
    """One step of a chain as it travels: an agent's slug or "you"; a step to build ({"create": role}) becomes the agent
    that was built for it, or stays a step to build; the person's veto step stays as it is. Anything else is dropped."""
    if isinstance(c, str) and c:
        return c
    if isinstance(c, dict) and isinstance(c.get("create"), str) and c["create"].strip():
        return built.get(c["create"].strip().lower(), {"create": c["create"].strip()[:80]})
    if isinstance(c, dict) and c.get("who") == "you":
        return {k: c[k] for k in ("who", "mode", "window") if isinstance(c.get(k), str)}
    return None


def clean_chain(chain, built=None, without=()):
    links = [chain_link(c, built or {}) for c in chain] if isinstance(chain, list) else []
    return [x for x in links if x is not None and x not in without]


def link_text(c):
    return c if isinstance(c, str) else f"(new: {c['create']})" if "create" in c else f"you ({c.get('mode') or 'check'})"


def privacy_check(folder):
    r = subprocess.run([sys.executable, str(HERE / "share_check.py"), str(folder), "--privacy-only"], capture_output=True,
                       text=True, encoding="utf-8", errors="replace", env={**__import__("os").environ, "PYTHONIOENCODING": "utf-8"})
    return {"ok": r.returncode == 0, "findings": [l.strip() for l in r.stdout.splitlines() if l.strip().startswith("✗")][:30]}


def team_md(team):
    lines = [f"# {team['name']}", "", f"{team.get('area') or ''} · by {team['author']} · v{team['version']}".strip(" ·"), "", "## Agents"]
    for a in team["agents"]:
        up = a.get("upstream") or {}
        role = " (" + a["role"] + ")" if a.get("role") else ""
        owns = " — " + a["owns"] if a.get("owns") else ""
        origin = " · based on " + str(up.get("slug")) + " by " + str(up.get("author")) if up.get("slug") and up.get("author") not in (None, team["author"]) else ""
        lines.append("- **" + a["name"] + "**" + role + owns + origin)
    if team["goals"]:
        lines += ["", "## Goals (examples: set your own)"] + [f"- {g['title']}" for g in team["goals"]]
    if team.get("chain"):
        lines += ["", "## How the work moves", " → ".join(link_text(c) for c in team["chain"])]
    lines += ["", "## When you install it", "The coordinator checks every agent, asks a few setup questions and puts the team on a new floor."]
    return "\n".join(lines) + "\n"


def cmd_draft(slug, author, without=()):
    rec = pa.read_json(TEAMS / f"{slug}.json")
    if not isinstance(rec, dict):
        return out({"ok": False, "error": f"no team {slug!r} in ~/.teamly/teams"}, 1)
    pack = team_pack(rec)
    if not pack:
        return out({"ok": False, "error": "the team record has no folder"}, 1)
    if not pack.is_dir():
        return out({"ok": False, "error": f"the team's folder is not where its record says: {pack}"}, 1)
    author = author or rec.get("author") or "?"
    record_agents = [{"slug": a} if isinstance(a, str) else a for a in rec.get("agents") or []]
    record_agents = [a for a in record_agents if isinstance(a, dict) and isinstance(a.get("slug"), str) and pa.SLUG_RE.match(a["slug"])
                     and a["slug"] not in without]
    # an agent a chain names but the record doesn't list still has to travel, or the receiver's chain names nobody
    named = {c for g in (rec.get("goals") if isinstance(rec.get("goals"), list) else []) if isinstance(g, dict)
             for c in (g.get("chain") if isinstance(g.get("chain"), list) else []) if isinstance(c, str)}
    named |= {c for c in (rec.get("chain") if isinstance(rec.get("chain"), list) else []) if isinstance(c, str)}
    for c in sorted(named - {"you"} - {a["slug"] for a in record_agents} - set(without)):
        if pa.SLUG_RE.match(c):
            record_agents.append({"slug": c, "name": c, "source": "library"})
    sources = {a["slug"]: agent_source(rec, a) for a in record_agents}
    missing = [s for s, src in sources.items() if not src]
    if missing:  # a team that arrives without some of its agents can't do its work: say so instead of shipping it short
        return out({"ok": False, "error": "some agents of this team can't be found", "missing": missing,
                    "hint": "find their folders (agents[].path in the team record), or share the team without them: --without "
                            + ",".join(missing)}, 1)
    # a step to build ({"create": role}) travels as the agent that was built for it
    built = {}
    for a in record_agents:
        for label in (a.get("role"), a.get("name")):
            if isinstance(label, str) and label.strip() and a.get("source") in ("built", "fork", None):
                built.setdefault(label.strip().lower(), a["slug"])
    dst = pack / "outbox" / f"team-{slug}"
    version = pa.next_version(pa.read_json(dst / "team.json")) if (dst / "team.json").is_file() else "1.0.0"
    if dst.exists():
        shutil.rmtree(dst)
    (dst / "agents").mkdir(parents=True)
    agents, per_agent, ratings, names = [], [], [], set()
    for a in record_agents:
        src = sources[a["slug"]]
        names.update(pa.private_names(src))  # read before the copy turns the `private:` line into a placeholder
        card = pa.read_json(src / "card.json") or {}
        own_upstream = card.get("upstream")  # as its author wrote it (the record of a received agent names the archive)
        if not card.get("upstream") and isinstance(a.get("upstream"), (str, dict)) and a.get("upstream"):
            card = {**card, "upstream": a["upstream"]}  # a fork keeps its origin in the team record (hire, step 3.5)
        up_slug, up_card = pa.upstream_of(src, card)
        included, excluded, questions, private, keep = pa.package_files(src, dst / "agents" / a["slug"],
                                                                        pa.upstream_config(src, up_slug or card.get("slug") or a["slug"]))
        changed = (src / "CHANGES.md").is_file()  # the person made it their own: they are the author of this version
        # received as a file and not changed here: it goes on with the origin its author wrote, not "based on" itself
        passing_on = not changed and (pa.read_json(src / ".teamly-source.json") or {}).get("from") in ("archive", "library")
        job = card.get("job") if isinstance(card.get("job"), dict) else {}
        new_card = {k: v for k, v in card.items() if k not in ("results", "rating", "week", "sharedAt", "path", "proof", "draftAt")}
        new_card.update({
            "slug": a["slug"], "name": card.get("name") or a.get("name") or a["slug"], "setup": questions,
            "author": author if changed or not card.get("author") else card["author"],
            "version": card["version"] if pa.VERSION_RE.match(str(card.get("version") or "")) else "1.0.0",
            "upstream": own_upstream if passing_on else
                        {"slug": up_slug, "version": (up_card or {}).get("version"), "author": (up_card or {}).get("author")}
                        if up_slug else card.get("upstream"),
        })
        (dst / "agents" / a["slug"] / "card.json").write_text(json.dumps(new_card, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        agents.append({"slug": a["slug"], "name": new_card["name"], "role": a.get("role") or card.get("role"), "owns": job.get("owns"),
                       "upstream": new_card.get("upstream"), "runtime": card.get("runtime"), "setupQuestions": len(questions)})
        per_agent.append({"slug": a["slug"], "public": included,
                          "private": excluded + [{"path": f"Config · {p['key']}", "why": p["why"]} for p in private],
                          "setupQuestions": questions, "defaults": keep})
        ratings += [pa.stars_of(r) for r in pa.ratings_for(a["slug"], slug) if pa.stars_of(r)]
    goals = [{"title": str(g["title"])[:200], "example": True, "chain": clean_chain(g.get("chain"), built, without),
              "approach": g.get("approach") if isinstance(g.get("approach"), str) else None}
             for g in rec.get("goals") or [] if isinstance(g, dict) and g.get("title")] if isinstance(rec.get("goals"), list) else []
    chain = clean_chain(rec.get("chain"), built, without) or (goals[0]["chain"] if goals else [])
    team = {"kind": KIND, "format": FORMAT, "slug": slug, "name": rec.get("name") or slug, "area": rec.get("area") or rec.get("name"),
            "author": author, "version": version, "draftAt": datetime.now().isoformat(timespec="seconds"),
            "agents": agents, "goals": goals, "chain": chain,
            "proof": {"ratings": len(ratings), "avgStars": round(sum(ratings) / len(ratings), 2) if ratings else None}}
    (dst / "team.json").write_text(json.dumps(team, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    (dst / "TEAM.md").write_text(team_md(team), encoding="utf-8")
    (dst / "manifest.json").write_text(json.dumps({"privateNames": sorted(names)}, ensure_ascii=False) + "\n", encoding="utf-8")
    privacy, safety = privacy_check(dst), safety_scan(dst)
    manifest = {"team": slug, "draft": str(dst), "agents": per_agent, "stays": STAYS, "missing": [], "without": sorted(without),
                "privacy": privacy, "safety": safety, "zip": None, "privateNames": sorted(names)}
    (dst / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return out({"ok": True, "draft": str(dst), "agents": [x["slug"] for x in agents], "missing": [], "without": sorted(without),
                "setupQuestions": sum(x["setupQuestions"] for x in agents), "stays": STAYS,
                "privacy": privacy, "safety": safety["verdict"]})


def cmd_zip(draft):
    d = Path(draft).expanduser().resolve()
    team = pa.read_json(d / "team.json") or {}
    if team.get("kind") != KIND or not pa.SLUG_RE.match(str(team.get("slug") or "")) or not pa.VERSION_RE.match(str(team.get("version") or "")):
        return out({"ok": False, "error": "not a team draft (team.json with kind, slug and version)"}, 1)
    privacy, safety = privacy_check(d), safety_scan(d)
    m = pa.read_json(d / "manifest.json") or {}
    m.update({"privacy": privacy, "safety": safety})
    problems = privacy["findings"] if not privacy["ok"] else []
    if m.get("missing"):  # a draft made by an older Teamly that let missing agents through
        problems.append("agents missing from the team: " + ", ".join(map(str, m["missing"])) + " (make the draft again)")
    problems += [f"!! {x['kind']}: {x['file']}:{x['line']} {x['text']}" for x in safety["findings"] if x["level"] == "danger"]
    if problems:
        (d / "manifest.json").write_text(json.dumps(m, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        return out({"ok": False, "error": "fix first", "problems": problems}, 1)
    OUTBOX.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp())
    shutil.copytree(d, tmp / f"team-{team['slug']}", ignore=shutil.ignore_patterns(*pa.JUNK))
    path = shutil.make_archive(str(OUTBOX / f"team-{team['slug']}-{team['version']}"), "zip", tmp)
    shutil.rmtree(tmp)
    m["zip"] = path
    (d / "manifest.json").write_text(json.dumps(m, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return out({"ok": True, "zip": path})


# ---------- the receiver's side ----------
download = pa.download  # https with a size cap, curl when Python has no certificates


def direct_url(url):
    """Share links of common file hosts -> a link that gives the file itself."""
    u = urllib.parse.urlparse(url)
    host = u.netloc.lower()
    if host.endswith("dropbox.com"):
        q = urllib.parse.parse_qs(u.query)
        q["dl"] = ["1"]
        return urllib.parse.urlunparse(u._replace(query=urllib.parse.urlencode(q, doseq=True)))
    if host == "drive.google.com":
        m = re.match(r"^/file/d/([\w-]+)", u.path)
        fid = m.group(1) if m else (urllib.parse.parse_qs(u.query).get("id") or [None])[0]
        if fid:
            return f"https://drive.google.com/uc?export=download&id={fid}"
    if host == "github.com" and "/blob/" in u.path:
        return f"https://raw.githubusercontent.com{u.path.replace('/blob/', '/', 1)}"
    if host in ("disk.yandex.ru", "disk.yandex.com", "yadi.sk", "disk.360.yandex.ru"):
        tmp = Path(tempfile.mkdtemp()) / "href.json"
        download("https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=" + urllib.parse.quote(url, safe=""), tmp, 100_000)
        href = (pa.read_json(tmp) or {}).get("href")
        shutil.rmtree(tmp.parent, ignore_errors=True)
        if href:
            return href
    return url


def fetch(url):
    if not re.match(r"^https://", url) and not re.match(r"^http://(127\.0\.0\.1|localhost)(:\d+)?/", url):
        raise ValueError("only https:// links")
    name = re.sub(r"[^\w.\-]+", "-", Path(urllib.parse.urlparse(url).path).name) or "teamly-shared"
    name = name if name.lower().endswith(".zip") else f"{name}.zip"
    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    dest, n = DOWNLOADS / name, 1
    while dest.exists():
        dest, n = DOWNLOADS / f"{Path(name).stem}-{n}.zip", n + 1
    download(direct_url(url), dest, MAX_DOWNLOAD)
    if not zipfile.is_zipfile(dest):
        page = dest.read_bytes()[:400].lower()
        dest.unlink()
        if b"<html" in page or b"<!doctype" in page:
            raise ValueError("the link opens a web page, not the file: open it in the browser, download the .zip and install that file")
        raise ValueError("the link does not give a .zip file")
    return dest


def source_path(arg):
    return fetch(arg) if re.match(r"^https?://", arg) else Path(arg).expanduser().resolve()


def open_team(zp):
    """Unpack a team archive to a temp folder and check it. None when the archive is a single agent."""
    tmp = Path(tempfile.mkdtemp(prefix="teamly-team-"))
    try:
        pa.safe_extract(zp, tmp)
        tops = [p for p in tmp.iterdir() if p.is_dir() and not p.name.startswith(("__MACOSX", "."))]
        root = tmp if (tmp / "team.json").is_file() else tops[0] if len(tops) == 1 and (tops[0] / "team.json").is_file() else None
        if root is None:
            shutil.rmtree(tmp, ignore_errors=True)
            return None
        team = pa.read_json(root / "team.json") or {}
        if team.get("kind") != KIND or not pa.SLUG_RE.match(str(team.get("slug") or "")) or not pa.VERSION_RE.match(str(team.get("version") or "")):
            raise ValueError("team.json is not a Teamly team (kind, slug, version)")
        agents = []
        for d in sorted((root / "agents").iterdir()) if (root / "agents").is_dir() else []:
            card = pa.read_json(d / "card.json")
            if not d.is_dir() or not (d / "SKILL.md").is_file() or not isinstance(card, dict) or not pa.SLUG_RE.match(str(card.get("slug") or d.name)):
                raise ValueError(f"agents/{d.name} is not a Teamly agent")
            job = card.get("job") if isinstance(card.get("job"), dict) else {}
            agents.append({"slug": card.get("slug") or d.name, "dir": d, "name": card.get("name") or d.name, "role": card.get("role"),
                           "author": card.get("author") or "?", "version": card.get("version") or "1.0.0", "owns": job.get("owns"),
                           "runtime": card.get("runtime"), "costBreakdown": card.get("costBreakdown") or [], "setup": card.get("setup") or [],
                           "upstream": card.get("upstream")})
        if not agents:
            raise ValueError("the team has no agents")
        slugs = [a["slug"] for a in agents]
        if len(set(slugs)) != len(slugs):
            raise ValueError("two agents of the team have the same name (slug)")
        if not isinstance(team.get("goals") or [], list) or not all(isinstance(g, dict) for g in team.get("goals") or []):
            raise ValueError("team.json: goals must be a list of goals")
        team["goals"] = [{**g, "title": str(g.get("title") or "")[:200], "chain": clean_chain(g.get("chain"))}
                         for g in team.get("goals") or [] if str(g.get("title") or "").strip()]
        team["chain"] = clean_chain(team.get("chain"))
    except Exception:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    safety = safety_scan(root)
    scripts = sorted(p.relative_to(root).as_posix() for p in (root / "agents").rglob("*")
                     if p.is_file() and p.suffix.lower() in {".py", ".sh", ".js", ".mjs", ".ts", ".ps1", ".bat", ".cmd", ".html", ".svg"})
    report = {"kind": "team", "archive": zp.name, "scripts": scripts, "sha256": hashlib.sha256(zp.read_bytes()).hexdigest(), "slug": team["slug"],
              "name": team.get("name") or team["slug"], "area": team.get("area"), "author": team.get("author") or "?",
              "version": team["version"], "goals": team.get("goals") or [], "chain": team.get("chain") or [], "proof": team.get("proof"),
              "agents": [{k: v for k, v in a.items() if k != "dir"} for a in agents], "safety": safety}
    return tmp, root, team, agents, report


def cmd_fetch(url):
    try:
        return out({"ok": True, "path": str(fetch(url))})
    except (ValueError, OSError, subprocess.SubprocessError) as e:
        return out({"ok": False, "error": str(e)}, 1)


def cmd_inspect(arg):
    try:
        zp = source_path(arg)
        opened = open_team(zp)
        if opened is None:  # a single agent: the same check as package_agent.py inspect
            tmp, _, _, report = pa.open_archive(zp)
            shutil.rmtree(tmp, ignore_errors=True)
            return out({"ok": True, "kind": "agent", "path": str(zp), **report})
        tmp, _, _, _, report = opened
        shutil.rmtree(tmp, ignore_errors=True)
        return out({"ok": True, "path": str(zp), **report})
    except (ValueError, OSError, zipfile.BadZipFile, subprocess.SubprocessError, RuntimeError, NotImplementedError) as e:
        return out({"ok": False, "error": str(e)}, 1)


def cmd_install(arg, folder, accept_risks, update=False):
    if not folder:
        return out({"ok": False, "error": "--folder <the new team's folder> is required"}, 1)
    try:
        zp = source_path(arg)
        opened = open_team(zp)
    except (ValueError, OSError, zipfile.BadZipFile, subprocess.SubprocessError, RuntimeError, NotImplementedError) as e:
        return out({"ok": False, "error": str(e)}, 1)
    if opened is None:
        return out({"ok": False, "error": "agent", "hint": "this archive is one agent: package_agent.py install <zip> --pack <team>/team"}, 1)
    tmp, root, team, agents, report = opened
    try:
        if report["safety"]["verdict"] == "danger" and not accept_risks:
            return out({"ok": False, "error": "danger", "safety": report["safety"]}, 2)
        if update:
            return update_team(zp, Path(folder).expanduser().resolve(), team, agents, report, accept_risks)
        return put_team(zp, Path(folder).expanduser().resolve(), root, team, agents, report, accept_risks)
    except Exception as e:  # one JSON answer whatever happens: the coordinator reads it
        return out({"ok": False, "error": f"{type(e).__name__}: {e}"}, 1)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def update_team(zp, folder, team, agents, report, accept_risks):
    """A newer version of a team that is already on this floor: each agent is replaced the safe way (the person's .env,
    settings and data come along, the old one goes to team/backup), new agents join, and the record keeps the person's
    goals and progress and learns the new version."""
    rec_file = next((f for f in TEAMS.glob("*.json") if (pa.read_json(f) or {}).get("folder") == str(folder)), None) if TEAMS.is_dir() else None
    rec = pa.read_json(rec_file) if rec_file else None
    if not isinstance(rec, dict) or (rec.get("installedFrom") or {}).get("team") != team["slug"]:
        return out({"ok": False, "error": "this folder doesn't hold this team: --update puts a new version of the same team on its floor"}, 1)
    pack = Path(rec.get("pack") or folder / "team")
    now, updated = int(time.time()), []
    have = {a.get("slug"): a for a in rec.get("agents") or [] if isinstance(a, dict)}
    for a in agents:
        pa.put_agent(a["dir"], pack / "agents" / a["slug"], {"archive": zp.name, "sha256": report["sha256"], "slug": a["slug"],
                     "version": a["version"], "author": a["author"], "safety": report["safety"]}, accept_risks, pack)
        entry = {"slug": a["slug"], "name": a["name"], "role": a["role"], "source": "archive", "path": str(pack / "agents" / a["slug"]),
                 "upstream": {"slug": a["slug"], "version": a["version"], "author": a["author"]}}
        have[a["slug"]] = {**have.get(a["slug"], {}), **entry}
        updated.append(a["slug"])
    rec["agents"] = list(have.values())
    rec["installedFrom"] = {**(rec.get("installedFrom") or {}), "archive": zp.name, "version": team["version"], "sha256": report["sha256"], "at": now}
    tmp_rec = rec_file.with_name(f".{rec_file.name}.tmp")
    tmp_rec.write_text(json.dumps(rec, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    os.replace(tmp_rec, rec_file)
    return out({"ok": True, "updated": updated, "version": team["version"], "record": str(rec_file), "safety": report["safety"]["verdict"],
                "kept": "the person's goals, progress, tasks and each agent's .env, settings and data"})


def put_team(zp, folder, root, team, agents, report, accept_risks):
    """The team is built next to its place and moved in at the end: a failure half-way leaves nothing behind."""
    pack = folder / "team"
    taken = [f for f in TEAMS.glob("*.json") if (pa.read_json(f) or {}).get("folder") == str(folder)] if TEAMS.is_dir() else []
    if (pack / "team.json").is_file() or taken:
        return out({"ok": False, "error": "this folder is already a team", "folder": str(folder)}, 3)
    slug, n = team["slug"], 2
    while (TEAMS / f"{slug}.json").exists():  # the person may already have a team with this name
        slug, n = f"{team['slug']}-{n}", n + 1
    folder.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix=".team-installing-", dir=folder))
    moved = None
    try:
        now = int(time.time())
        installed = []
        for a in agents:
            dest = work / "agents" / a["slug"]
            shutil.copytree(a["dir"], dest, ignore=shutil.ignore_patterns(*pa.JUNK))  # ._* = Finder junk
            pa.keep_as_theirs(dest)
            (dest / ".teamly-source.json").write_text(json.dumps({
                "from": "archive", "team": team["slug"], "archive": zp.name, "sha256": report["sha256"], "slug": a["slug"],
                "version": a["version"], "author": a["author"], "installedAt": now, "safety": report["safety"]["verdict"],
                "acceptedRisks": bool(accept_risks), "config": pa.received_config(dest)}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
            installed.append({"slug": a["slug"], "name": a["name"], "role": a["role"], "source": "archive",
                              "path": str(pack / "agents" / a["slug"]),
                              "upstream": {"slug": a["slug"], "version": a["version"], "author": a["author"]}})
        chain = report["chain"] or [a["slug"] for a in agents]
        record = {"slug": slug, "name": team.get("name") or slug, "area": team.get("area"), "folder": str(folder), "pack": str(pack),
                  "coordinator_session": None, "repo": None, "created": now,
                  "goals": [{"id": f"g{i + 1}", "title": g["title"], "example": True, "chain": g.get("chain") or chain,
                             "approach": g.get("approach") if isinstance(g.get("approach"), str) else None}
                            for i, g in enumerate(report["goals"])],
                  "agents": installed,
                  "installedFrom": {"archive": zp.name, "team": team["slug"], "author": report["author"], "version": team["version"],
                                    "sha256": report["sha256"], "at": now, "acceptedRisks": bool(accept_risks)},
                  "setupPending": True}
        (work / "team.json").write_text(json.dumps(record, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        if (root / "TEAM.md").is_file():
            shutil.copy2(root / "TEAM.md", work / "TEAM.md")
        if pack.exists():  # a "team" folder with no team in it (a run that died, or the person's own): kept aside
            moved = folder / time.strftime("team-before-install-%Y%m%d-%H%M%S")
            os.rename(pack, moved)
        os.rename(work, pack)
    except BaseException:
        shutil.rmtree(work, ignore_errors=True)
        if moved and not pack.exists():
            os.rename(moved, pack)
        raise
    TEAMS.mkdir(parents=True, exist_ok=True)
    tmp_rec = TEAMS / f".{slug}.json.tmp"
    tmp_rec.write_text(json.dumps(record, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    os.replace(tmp_rec, TEAMS / f"{slug}.json")
    return out({"ok": True, "slug": slug, "name": record["name"], "folder": str(folder), "record": str(TEAMS / f"{slug}.json"),
                "agents": [{"slug": a["slug"], "name": a["name"], "path": str(pack / "agents" / a["slug"]), "setup": a["setup"]} for a in agents],
                "goals": record["goals"], "safety": report["safety"]["verdict"], "keptAside": str(moved) if moved else None})


def main(argv):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    cmds = ("draft", "zip", "fetch", "inspect", "install")
    if not argv or argv[0] not in cmds or (argv[0] != "draft" and len(argv) < 2):
        print(__doc__)
        return 2
    opts, rest = {}, [a for a in argv[1:] if a not in ("--accept-risks", "--update")]
    pos = []
    while rest:
        k = rest.pop(0)
        if k.startswith("--") and rest:
            opts[k[2:]] = rest.pop(0)
        else:
            pos.append(k)
    if argv[0] == "draft":
        without = tuple(x.strip() for x in (opts.get("without") or "").split(",") if x.strip())
        return cmd_draft(opts.get("team") or (pos[0] if pos else ""), opts.get("author"), without)
    if argv[0] == "zip":
        return cmd_zip(pos[0])
    if argv[0] == "fetch":
        return cmd_fetch(pos[0])
    if argv[0] == "inspect":
        return cmd_inspect(pos[0])
    return cmd_install(pos[0], opts.get("folder"), "--accept-risks" in argv, "--update" in argv)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
