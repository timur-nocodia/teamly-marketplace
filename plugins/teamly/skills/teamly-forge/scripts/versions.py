#!/usr/bin/env python3
"""Versions of an agent the person built: Keep saves one, Redo and Restore never lose one.

  python3 versions.py save    <agent dir> [--note "what changed"]   → .versions/v<N>/ and versions.json
  python3 versions.py list    <agent dir>
  python3 versions.py restore <agent dir> <vN>                     the current state is saved first, then vN comes back
  python3 versions.py diff    <agent dir> <vN>                     files added, changed and removed since vN

A version is a full copy of the agent folder (without .versions itself) in <agent dir>/.versions/vN/. Packages skip
dot folders, so versions never leave with the agent. Saving the same content twice makes no new version.
Prints JSON; exit 1 with {"ok": false, "error"} on a bad call.
"""
import hashlib
import json
import os
import re
import shutil
import sys
import time
from pathlib import Path

VERSIONS = ".versions"
JUNK = {".DS_Store", "Thumbs.db", "desktop.ini", "__pycache__"}
V_RE = re.compile(r"^v([1-9]\d{0,4})$")


def files_of(root):
    """Relative paths of the agent's own files: not its versions, not Finder junk."""
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        rel = Path(dirpath).relative_to(root)
        dirnames[:] = sorted(d for d in dirnames if d not in JUNK and not (rel == Path(".") and d == VERSIONS))
        out += [rel / f for f in sorted(filenames) if f not in JUNK and not f.startswith("._")]
    return out


def digest(root):
    h = hashlib.sha256()
    for rel in files_of(root):
        h.update(rel.as_posix().encode())
        h.update(b"\0")
        h.update(hashlib.sha256((root / rel).read_bytes()).digest())
    return h.hexdigest()[:16]


def index_of(agent):
    p = agent / VERSIONS / "versions.json"
    try:
        v = json.loads(p.read_text(encoding="utf-8"))
        return v if isinstance(v, dict) and isinstance(v.get("list"), list) else {"list": []}
    except (OSError, ValueError):
        return {"list": []}


def write_index(agent, idx):
    p = agent / VERSIONS / "versions.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(f".versions.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(idx, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, p)


def copy_tree(src, dst):
    for rel in files_of(src):
        (dst / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src / rel, dst / rel)


def save(agent, note=""):
    idx = index_of(agent)
    h = digest(agent)
    if idx["list"] and idx["list"][-1].get("hash") == h:
        return {"ok": True, "version": idx["list"][-1]["v"], "new": False, "note": "nothing changed since it"}
    n = 1 + max([int(V_RE.match(x.get("v", "")).group(1)) for x in idx["list"] if V_RE.match(x.get("v", ""))] or [0])
    v = f"v{n}"
    dst = agent / VERSIONS / v
    if dst.exists():
        shutil.rmtree(dst)
    copy_tree(agent, dst)
    idx["list"].append({"v": v, "at": int(time.time()), "note": note[:200], "hash": h, "files": len(files_of(dst))})
    write_index(agent, idx)
    return {"ok": True, "version": v, "new": True}


def restore(agent, v):
    if not V_RE.match(v) or not (agent / VERSIONS / v).is_dir():
        raise ValueError(f"no version {v}: see `list`")
    before = save(agent, note=f"before going back to {v}")
    for rel in files_of(agent):
        (agent / rel).unlink()
    for d in sorted((p for p in agent.rglob("*") if p.is_dir() and VERSIONS not in p.relative_to(agent).parts), reverse=True):
        try:
            d.rmdir()
        except OSError:
            pass
    copy_tree(agent / VERSIONS / v, agent)
    return {"ok": True, "restored": v, "saved": before["version"]}


def diff(agent, v):
    old = agent / VERSIONS / v
    if not V_RE.match(v) or not old.is_dir():
        raise ValueError(f"no version {v}: see `list`")
    a, b = set(files_of(old)), set(files_of(agent))
    changed = [r for r in sorted(a & b) if (old / r).read_bytes() != (agent / r).read_bytes()]
    return {"ok": True, "since": v, "added": [r.as_posix() for r in sorted(b - a)],
            "changed": [r.as_posix() for r in changed], "removed": [r.as_posix() for r in sorted(a - b)]}


def main(argv):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if len(argv) < 2 or argv[0] not in ("save", "list", "restore", "diff"):
        print(__doc__)
        return 2
    cmd, agent = argv[0], Path(argv[1]).expanduser()
    try:
        takes = ("--note",) if cmd == "save" else ()
        odd = [a for a in argv[2:] if a.startswith("--") and a not in takes]
        if odd:  # a misspelt flag is said, never skipped
            raise ValueError(f"unknown flag {', '.join(odd)}: {cmd} takes {', '.join(takes) or 'no flags'}")
        if not (agent / "SKILL.md").is_file():
            raise ValueError(f"not an agent folder (no SKILL.md): {agent}")
        if cmd == "save":
            note = argv[argv.index("--note") + 1] if "--note" in argv[2:] else ""
            out = save(agent, note)
        elif cmd == "list":
            out = {"ok": True, "versions": [{k: x.get(k) for k in ("v", "at", "note", "files")} for x in index_of(agent)["list"]]}
        elif len(argv) < 3:
            raise ValueError(f"{cmd} needs a version: v1, v2…")
        elif cmd == "restore":
            out = restore(agent, argv[2])
        else:
            out = diff(agent, argv[2])
    except (ValueError, OSError) as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        return 1
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
