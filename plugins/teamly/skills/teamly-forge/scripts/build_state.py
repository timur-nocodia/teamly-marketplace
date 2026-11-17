#!/usr/bin/env python3
"""Teamly Builder: what the panel shows while an agent is being built (~/.teamly/builds/<slug>.json).

  python3 build_state.py start <slug> --name "Reel Writer" --role "..." [--team <team slug>] [--path full|fast|fork] [--chat <id>]
                                 [--upstream <slug>@<version>]   a fork: your version of a library agent, every step
  python3 build_state.py set   <slug> '<json patch>'     merged into the file (objects merge, lists and values replace)
  python3 build_state.py set   <slug> -                  the patch from stdin (long texts, quotes)
  python3 build_state.py show  <slug>
  python3 build_state.py pick  <slug> '{"<find name>": {"use": "tool", "why": "..."}}'
                                 marks scout's finds (research.github.found) by name; only use and why change

A patch {"test": {"run": {"n": 2, ...}}} puts that test run into test.runs by its number (the test chat writes its own
run without overwriting the others). --chat is the chat that builds the agent: the panel sends its buttons there.

The forge writes it at every step; the panel (server.py → /api/state → "builds") draws the Builder screen from it.
Steps, in order: job → metric → research → ontology → integrations → test → launch → done ("money", the old name of
the integrations step, still works). The file holds only what the
panel shows (counts, names, short lines in English): never chat text, keys or the person's private names.
"""
import json
import os
import re
import sys
import time
from pathlib import Path

BUILDS = Path.home() / ".teamly" / "builds"


def teamly_root():
    """The teamly-v2 skill folder, where events.py lives: forge's parent in the repo, the sibling skills/teamly-v2 in the
    installed plugin (15.11: the Builder's steps never reached the founder's numbers there), else ~/.claude/skills/teamly-v2."""
    here = Path(__file__).resolve().parent
    for cand in (here.parents[1], here.parents[1] / "teamly-v2", Path.home() / ".claude" / "skills" / "teamly-v2"):
        if (cand / "events.py").is_file():
            return cand
    return here.parents[1]


sys.path.insert(0, str(teamly_root()))
try:
    import events  # noqa: E402  Teamly's steps for the founder's numbers (only the step's name goes)
except Exception:
    events = None
SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
STEPS = ["job", "metric", "research", "ontology", "integrations", "test", "launch", "done"]
ALIAS = {"money": "integrations"}
START_FLAGS = ("name", "role", "team", "path", "chat", "upstream")


def path_of(slug):
    if not SLUG.match(slug or ""):
        raise ValueError(f"not a slug: {slug!r} (latin letters, digits and dashes)")
    return BUILDS / f"{slug}.json"


def read(slug):
    try:
        v = json.loads(path_of(slug).read_bytes())
    except (OSError, ValueError):
        return None
    return v if isinstance(v, dict) else None


def merge(base, patch):
    for k, v in patch.items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            merge(base[k], v)
        else:
            base[k] = v
    return base


def write(slug, data):
    BUILDS.mkdir(parents=True, exist_ok=True)
    data["updatedAt"] = int(time.time())
    p = path_of(slug)
    tmp = p.with_name(f".{slug}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, p)
    return data


def cmd_start(slug, opts):
    path = opts.get("path") or "full"
    if path not in ("full", "fast", "fork"):
        raise ValueError("--path is full (a new agent), fast (a library agent you hire) or fork (your version of one)")
    if path == "fork" and not opts.get("upstream"):
        raise ValueError("a fork names its original: --upstream <slug>@<version>")
    old = read(slug) or {}
    data = {"slug": slug, "name": opts.get("name") or old.get("name") or slug, "role": opts.get("role") or old.get("role") or "",
            "team": opts.get("team") or old.get("team"), "chat": opts.get("chat") or old.get("chat"), "path": path,
            "step": "metric" if path == "fast" else "job", "startedAt": int(time.time())}
    if path == "fork":
        data["upstream"] = opts["upstream"]
    if events is not None and not old:
        events.log("builder_started", path=path)
    return write(slug, data)


def cmd_set(slug, raw):
    patch = json.loads(sys.stdin.read() if raw == "-" else raw)
    if not isinstance(patch, dict):
        raise ValueError("the patch is a JSON object: '{\"step\": \"research\"}'")
    if patch.get("step") in ALIAS:
        patch["step"] = ALIAS[patch["step"]]
    if "step" in patch and patch["step"] not in STEPS:
        raise ValueError(f"step is one of {', '.join(STEPS)}")
    data = read(slug)
    if data is None:
        raise ValueError(f"no build {slug}: start it first")
    run = patch.get("test", {}).pop("run", None) if isinstance(patch.get("test"), dict) else None
    if run is not None:
        if not isinstance(run, dict) or not isinstance(run.get("n"), int):
            raise ValueError('a test run is {"n": <number>, ...}')
        test = data.setdefault("test", {}) if isinstance(data.get("test"), dict) else data.setdefault("test", {})
        runs = [r for r in (test.get("runs") or []) if isinstance(r, dict) and r.get("n") != run["n"]]
        test["runs"] = sorted(runs + [run], key=lambda r: r.get("n", 0))
        test.pop("mode", None)  # a new run after a blind comparison (blind.py deal): the panel shows the runs again
    step_before = data.get("step")
    out = write(slug, merge(data, patch))
    if events is not None and out.get("step") != step_before:
        events.log("builder_step", step=out.get("step"), path=out.get("path") or "full")
        if out.get("step") == "launch":  # launch comes only after the test drive passed (forge SKILL.md, step 6)
            events.log("builder_test_passed")
    return out


PICKABLE = {"use", "why"}


def cmd_pick(slug, raw):
    marks = json.loads(sys.stdin.read() if raw == "-" else raw)
    if not isinstance(marks, dict) or not all(isinstance(v, dict) for v in marks.values()):
        raise ValueError('pick takes {"<find name>": {"use": "tool", "why": "..."}}')
    odd = sorted({k for v in marks.values() for k in v} - PICKABLE)
    if odd:
        raise ValueError(f"only use and why can change, not {', '.join(odd)}: the rest is what scout found")
    data = read(slug)
    if data is None:
        raise ValueError(f"no build {slug}: start it first")
    found = (((data.get("research") or {}).get("github") or {}).get("found")) or []
    names = {x.get("name") for x in found if isinstance(x, dict)}
    for x in found:
        if isinstance(x, dict) and x.get("name") in marks:
            x.update(marks[x["name"]])
    return write(slug, data), sorted(k for k in marks if k not in names)


def main(argv):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if len(argv) < 2 or argv[0] not in ("start", "set", "show", "pick"):
        print(__doc__)
        return 2
    cmd, slug, rest = argv[0], argv[1], argv[2:]
    try:
        if cmd == "show":
            data = read(slug)
            if data is None:
                raise ValueError(f"no build {slug}")
        elif cmd == "set":
            if not rest:
                raise ValueError("set needs a JSON patch or - for stdin")
            data = cmd_set(slug, rest[0])
        elif cmd == "pick":
            if not rest:
                raise ValueError("pick needs a JSON object or - for stdin")
            data, missing = cmd_pick(slug, rest[0])
            print(json.dumps({"ok": True, "missing": missing, "build": data}, ensure_ascii=False))
            return 0
        else:
            opts = {}
            odd = [a for a in rest if a.startswith("--") and a[2:] not in START_FLAGS]
            if odd:  # a misspelt flag is said, never skipped
                raise ValueError(f"unknown flag {', '.join(odd)}: start takes {', '.join('--' + k for k in START_FLAGS)}")
            while rest:
                k = rest.pop(0)
                if k.startswith("--") and rest:
                    opts[k[2:]] = rest.pop(0)
            data = cmd_start(slug, opts)
    except ValueError as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        return 1
    print(json.dumps({"ok": True, "build": data}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
