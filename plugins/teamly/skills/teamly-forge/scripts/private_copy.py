#!/usr/bin/env python3
"""A closed copy of an agent the person built, for Teamly's server: queued here, sent by the panel's server.

  python3 private_copy.py queue <agent dir> --team <team slug>
  python3 private_copy.py list

`queue` packs the agent without anything personal into ~/.teamly/outbox/private/<slug>/<hash>.zip with a
meta.json: no config/ (the person's settings), no data/ (its runs and their numbers), no evals/ (tests come from the
person's real work), no versions, no hidden files, no logs, no list of private names. The privacy check runs first:
a key, an address or a private name anywhere in what would go (rules, examples, scripts) stops it. The same content is queued once. Nothing leaves this
computer here: the panel's server (server.py, «closed copies») sends a queued copy only after the person said yes to
closed copies in the panel, with the person's Teamly key, and keeps it queued while Teamly can't take it.
Prints JSON; exit 1 with {"ok": false, "error"} on a bad call.
"""
import hashlib
import io
import json
import os
import re
import sys
import time
import zipfile
from pathlib import Path

OUT = Path.home() / ".teamly" / "outbox" / "private"
SKIP_DIRS = {"config", "data", "evals", "runs", "outbox", "__pycache__", "node_modules"}
SKIP_FILES = {".teamly-agent", "manifest.json", ".DS_Store", "Thumbs.db", "desktop.ini"}
MAX_BYTES = 20 * 1024 * 1024
SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")


def files_of(agent):
    out = []
    for dirpath, dirnames, filenames in os.walk(agent):
        rel = Path(dirpath).relative_to(agent)
        dirnames[:] = sorted(d for d in dirnames if not d.startswith(".") and d not in SKIP_DIRS)
        for f in sorted(filenames):
            if f.startswith(".") or f in SKIP_FILES or f.endswith((".jsonl", ".log", ".env")):
                continue
            out.append(rel / f)
    return out


PRIVATE_LINE = re.compile(rb"^[ \t>*-]*private:.*$", re.MULTILINE | re.IGNORECASE)


def private_findings(agent):
    """What the privacy check (share_check.py --privacy-only) finds in the files that would go, except the list of
    private names itself (ontology.md, «private: …»): that line is cut from the copy."""
    import shutil
    import subprocess
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        dst = Path(tmp) / agent.name
        for rel in files_of(agent):
            (dst / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(agent / rel, dst / rel)
        r = subprocess.run([sys.executable, str(Path(__file__).resolve().parent / "share_check.py"), str(dst), "--privacy-only"],
                           capture_output=True, text=True, encoding="utf-8")
        onto = (dst / "ontology.md").read_text(encoding="utf-8", errors="replace").splitlines() if (dst / "ontology.md").is_file() else []
    keep = []
    for line in r.stdout.splitlines():
        line = line.strip()
        if not line.startswith("\u2717"):
            continue
        m = re.search(r"\s(ontology\.md):(\d+)\s", line)
        if m and 0 < int(m.group(2)) <= len(onto) and re.match(r"^[ \t>*-]*private:", onto[int(m.group(2)) - 1], re.IGNORECASE):
            continue
        keep.append(line.lstrip("\u2717 ").strip())
    return keep


def pack(agent):
    buf = io.BytesIO()
    h = hashlib.sha256()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for rel in files_of(agent):
            data = (agent / rel).read_bytes()
            if rel.as_posix() == "ontology.md":
                data = PRIVATE_LINE.sub(b"", data)  # the private names stay on this computer
            h.update(rel.as_posix().encode() + b"\0" + hashlib.sha256(data).digest())
            info = zipfile.ZipInfo(rel.as_posix(), date_time=(2026, 1, 1, 0, 0, 0))  # same content, same archive
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data)
    return buf.getvalue(), h.hexdigest()[:16]


def queue(agent, team):
    agent = Path(agent).expanduser().resolve()
    if not (agent / "SKILL.md").is_file():
        raise ValueError(f"not an agent folder (no SKILL.md): {agent}")
    slug = agent.name
    if not SLUG.match(slug) or (team and not SLUG.match(team)):
        raise ValueError("the agent folder and the team are latin slugs")
    found = private_findings(agent)
    if found:
        raise ValueError("personal data would go with the copy, move it into config/ first: " + "; ".join(found[:3])
                         + (f" (+{len(found) - 3} more)" if len(found) > 3 else ""))
    data, h = pack(agent)
    if len(data) > MAX_BYTES:
        raise ValueError(f"the agent is {len(data) // 1024 // 1024} MB without its data; a closed copy holds up to 20 MB")
    d = OUT / slug
    zp = d / f"{h}.zip"
    if zp.exists():
        return {"ok": True, "queued": False, "slug": slug, "hash": h, "note": "this version is already queued or sent"}
    d.mkdir(parents=True, exist_ok=True)
    try:
        card = json.loads((agent / "card.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        card = {}
    try:
        versions = json.loads((agent / ".versions" / "versions.json").read_text(encoding="utf-8")).get("list") or []
    except (OSError, ValueError, AttributeError):
        versions = []
    meta = {"slug": slug, "team": team, "hash": h, "bytes": len(data), "files": len(files_of(agent)), "at": int(time.time()),
            "version": (versions[-1].get("v") if versions and isinstance(versions[-1], dict) else None) or card.get("version"),
            "name": card.get("name") or slug, "sent": None}
    tmp = zp.with_suffix(".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, zp)
    (d / f"{h}.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    return {"ok": True, "queued": True, "slug": slug, "hash": h, "bytes": len(data)}


def listing():
    items = []
    for m in sorted(OUT.glob("*/*.json")):
        try:
            items.append(json.loads(m.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            continue
    return {"ok": True, "copies": items}


def main(argv):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if not argv or argv[0] not in ("queue", "list"):
        print(__doc__)
        return 2
    try:
        if argv[0] == "list":
            out = listing()
        else:
            if len(argv) < 2:
                raise ValueError("queue needs the agent folder")
            odd = [a for a in argv[2:] if a.startswith("--") and a != "--team"]
            if odd:  # a misspelt flag is said, never skipped
                raise ValueError(f"unknown flag {', '.join(odd)}: queue takes --team")
            team = argv[argv.index("--team") + 1] if "--team" in argv[2:] else None
            out = queue(argv[1], team)
    except (ValueError, OSError) as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        return 1
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
