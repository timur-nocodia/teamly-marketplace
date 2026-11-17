#!/usr/bin/env python3
"""Teamly's own steps, for the founder's numbers (14.11, Igor's checklist, block 9).

What is recorded: an event name, a time and a few short facts (a version, a Builder step, where an agent came from).
Never chat text, file contents, names of people, agents or teams, or keys. Each event is one line of
~/.teamly/events.jsonl; the panel server sends new lines to the Teamly API (POST /v1/events) with a random install id
(~/.teamly/install.json), the plugin version and the system. With the person's key, so the founder sees which account
it is; without one, the install alone.

Off: ~/.teamly/config.json {"events": false}, or TEAMLY_EVENTS_URL=off. Nothing is sent then; the log stays on this
computer. Where it goes: TEAMLY_EVENTS_URL, else the API base + /events.

  python3 events.py log <event> [key=value ...]    one event (scripts and the coordinator)
  python3 events.py off | on | status              the person's choice
"""
import json
import os
import platform
import sys
import time
import urllib.request
import uuid
from pathlib import Path

BATCH = 200
EPOCH_STEP = 1_000_000  # a log that was cut or removed starts a new range of numbers, so its lines are not taken for old ones


def home():
    return Path.home() / ".teamly"


def log_path():
    return home() / "events.jsonl"


def _read(path):
    try:
        v = json.loads(path.read_text(encoding="utf-8"))
        return v if isinstance(v, dict) else {}
    except (OSError, ValueError):
        return {}


def _write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(data), encoding="utf-8")
    os.replace(tmp, path)


def enabled():
    if (os.environ.get("TEAMLY_EVENTS_URL") or "").strip().lower() == "off":
        return False
    return _read(home() / "config.json").get("events") is not False


def set_enabled(on):
    path = home() / "config.json"
    c = _read(path)
    c["events"] = bool(on)
    _write(path, c)


def log(event, **props):
    """One line in the log. Never raises: an event must not break what it records."""
    clean = {k: v for k, v in props.items() if isinstance(v, (str, int, float, bool)) and v is not None}
    try:
        home().mkdir(parents=True, exist_ok=True)
        with open(log_path(), "a", encoding="utf-8") as f:
            f.write(json.dumps({"ts": int(time.time()), "event": event, **({"props": clean} if clean else {})}) + "\n")
    except OSError:
        pass


def system():
    return {"darwin": "mac", "win32": "windows"}.get(sys.platform, sys.platform)[:20]


def install(version):
    """The install id, made on the first start. Logs "installed" then, and "updated" when the version changed."""
    path = home() / "install.json"
    info = _read(path)
    changed = False
    if not isinstance(info.get("id"), str):
        # Teamly was here before events existed (its funnel or teams are on disk): an update, not a new install
        before = (home() / "funnel.json").is_file() or (home() / "teams").is_dir()
        info = {"id": uuid.uuid4().hex, "createdAt": int(time.time()), "version": version}
        if before:
            log("updated", fromVersion="unknown", toVersion=version)
        else:
            log("installed", version=version, os=system())
        changed = True
    elif info.get("version") != version:
        log("updated", fromVersion=str(info.get("version") or "unknown")[:20], toVersion=version)
        info["version"] = version
        changed = True
    if changed:
        try:
            _write(path, info)
        except OSError:
            pass
    return info


def active_today():
    """An "active" event once a day the panel is used: who comes back on day 2 and day 7."""
    path = home() / "install.json"
    info = _read(path)
    today = time.strftime("%Y-%m-%d", time.gmtime())
    if not info.get("id") or info.get("activeDay") == today:
        return False
    info["activeDay"] = today
    try:
        _write(path, info)
    except OSError:
        return False
    log("active")
    return True


def pending():
    """(lines not sent yet as (seq, event), the cursor to save after they went)."""
    sent_path = home() / "events-sent.json"
    cur = _read(sent_path)
    line, epoch = int(cur.get("line") or 0), int(cur.get("epoch") or 0)
    try:
        lines = log_path().read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        lines = []
    if len(lines) < line:  # the log was cut or removed: start again, numbered apart from what was sent
        line, epoch = 0, epoch + 1
    out = []
    for i in range(line, min(len(lines), line + BATCH)):
        try:
            e = json.loads(lines[i])
        except ValueError:
            continue
        if isinstance(e, dict) and isinstance(e.get("event"), str) and isinstance(e.get("ts"), int):
            out.append({"seq": epoch * EPOCH_STEP + i, "ts": e["ts"], "event": e["event"],
                        **({"props": e["props"]} if isinstance(e.get("props"), dict) else {})})
    return out, {"line": min(len(lines), line + BATCH), "epoch": epoch}


def send(api_base, version, key=None, timeout=8):
    """Sends what is new, one batch. How many went; 0 when off, nothing new, or Teamly could not be reached."""
    if not enabled():
        return 0
    url = (os.environ.get("TEAMLY_EVENTS_URL") or "").strip() or f"{api_base.rstrip('/')}/events"
    info = install(version)
    batch, cursor = pending()
    if not batch and cursor == _read(home() / "events-sent.json"):
        return 0
    body = json.dumps({"install": info["id"], "version": version, "os": system(), "events": batch}).encode("utf-8")
    headers = {"Content-Type": "application/json", "User-Agent": f"teamly-plugin/{version}"}
    if key and key.startswith("tly_data_"):
        headers["Authorization"] = f"Bearer {key}"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=body, headers=headers, method="POST"), timeout=timeout) as r:
            ok = 200 <= r.status < 300
    except Exception:  # offline, Teamly down, an older API without /events: the lines wait for the next try
        return 0
    if ok:
        try:
            _write(home() / "events-sent.json", cursor)
        except OSError:
            return 0
    return len(batch) if ok else 0


def main(argv):
    if not argv or argv[0] not in ("log", "off", "on", "status"):
        print(__doc__)
        return 2
    if argv[0] == "log" and len(argv) > 1:
        props = dict(a.split("=", 1) for a in argv[2:] if "=" in a)
        log(argv[1], **props)
    elif argv[0] in ("off", "on"):
        set_enabled(argv[0] == "on")
    print(json.dumps({"events": enabled()}))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
