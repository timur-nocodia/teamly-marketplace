#!/usr/bin/env python3
"""Teamly v2 local server: serves the panel and gives it live data from this computer.

Read-only (live data):
- GET  /api/health                 -> {"ok": true}
- GET  /api/state                  -> key status (masked), installed agents, catalog, teams, active task
- GET  /api/file?path=<abs path>   -> a file from an active task folder, saved edits, or the demo reel

Writes (a web page can't make them: same Origin + X-Teamly-Panel header; a program on this computer can, since every
account shares 127.0.0.1 — a per-person panel token is the next step):
- POST   /api/key    {"key"}                  -> ~/.teamly/credentials.json (0600)
- DELETE /api/key                             -> removes the key
- POST   /api/connect {"key","state"}         -> the key the site sent back after sign-in (panel/connect.html), taken
                                               only with the state of the sign-in this panel opened
- POST   /api/hire   {"slug"}                 -> copies agents/<slug>/ into the skills dir as teamly-<slug>/
- POST   /api/fire   {"slug"}                 -> removes that agent (only ones this server installed)
- POST   /api/rating {"task","rating","blocker","agents"} -> appends to ~/.teamly/panel/ratings.jsonl
- POST   /api/edit   {"task","file","text"}   -> saves an edited step file to ~/.teamly/panel/edits/ (task folder untouched)
- POST   /api/offices {"name", "setup"}       -> opens an office (building); setup: the floor being set up moves into it
- POST   /api/offices/place {"team", "office"} -> moves a floor to another office
- POST   /api/offices/next {"office"}          -> the next floor goes to this office
- GET/POST/DELETE /api/ui                     -> ~/.teamly/ui.json: the panel's own state (screen, filters, demo wallet),
                                               so it survives reloads, server restarts and other chats' panels
- POST   /api/feedback {"kind","text","context"} -> ~/.teamly/feedback/<time>-<kind>.md (local until the Teamly API exists)
- POST   /api/open-chat {"session"}           -> brings that team chat up in Claude desktop (only chats named in team records; macOS, Windows)
- POST   /api/open-url {"which": "topup"|"key"} -> the Teamly site's top-up page, or its sign-in page with a fresh
                                               one-time state, in the person's browser (Teamly hosts only)
- POST   /api/shutdown                       -> stops this server (after an update the coordinator starts the new code)
- POST   /api/wallet/refresh                 -> asks Teamly for the balance and tool calls now (at most every 5 s)

The key: saved by the panel, or TEAMLY_API_KEY / ~/.env. A `tly_data_…` key is checked against the Teamly API
(/wallet/balance answers for both; base in ~/.teamly/config.json or TEAMLY_API_BASE); other keys are demo keys.
Getting one: Sign in to Teamly in the panel opens the site; after sign-in it redirects to
http://127.0.0.1:4319/connect.html#key=…&state=… and that page posts both to /api/connect.

Prototype rule: agents are installed into .sandbox/skills, not ~/.claude/skills.
Pass --skills-dir ~/.claude/skills when it is time to install for real.

Updates: every few hours the running server reads latest.json from the marketplace repository (update.py;
TEAMLY_UPDATE_URL or ~/.teamly/config.json "updateUrl", "off" = never) and the panel shows a newer version.

Stdlib only. Binds 127.0.0.1. CLI: python3 server.py [--port 4319] [--skills-dir DIR] [--status | --check | --stop]
"""
import contextlib
import hashlib
import hmac
import http.client
import json
import math
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
import unicodedata
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urljoin, urlparse

VERSION = "0.6.2"
HERE = Path(__file__).resolve().parent
PANEL_DIR = HERE / "panel"
CATALOG_DIR = HERE / "agents"   # legacy v1 agents (mark, riley, james)
LIBRARY_DIR = HERE / "library"  # agents shipped inside the skill: none since 0.5.5 (the shared library has them)
APPROACHES_DIR = HERE / "approaches"  # goals.json + <slug>.json: ways other people reach a goal, built from library agents
TEAMLY_DIR = Path.home() / ".teamly"
DATA_DIR = TEAMLY_DIR / "panel"    # what the panel itself writes (ratings, edited step files): kept across updates
MY_LIBRARY_DIR = TEAMLY_DIR / "library"   # agents the person published (package_agent.py publish): kept across updates
OLD_DATA_DIR = HERE / ".data"      # where 0.5.2 and older kept it: inside the skill folder that updates replace
CREDENTIALS = TEAMLY_DIR / "credentials.json"
TEAMS_DIR = TEAMLY_DIR / "teams"
DEMO_REEL = Path.home() / "ugc-system/reels/2026-10-12/019_graphify_RU/out/019_graphify_RU_v2.mp4"
SKILL_PREFIX = "teamly-"
MARKER = ".teamly-agent"
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
FILE_RE = re.compile(r"^[0-9]-[A-Za-z0-9._-]{1,80}$")
DEFAULT_PORT = 4319

SKILLS_DIR = HERE / ".sandbox" / "skills"  # replaced by --skills-dir


# ---------- key ----------
def mask(key):
    return "••••" if len(key) <= 9 else f"{key[:5]}••••{key[-4:]}"


def clean_key(text):
    """The key out of whatever was pasted or written: quotes, `TEAMLY_API_KEY=`, a JSON object, spaces around it."""
    text = str(text or "").strip()
    real = re.search(r"tly_data_[A-Za-z0-9_-]+", text)
    if real:
        return real.group(0)
    text = re.sub(r"^(?:export\s+)?TEAMLY_API_KEY\s*=\s*", "", text).strip().strip("'\"").strip()
    return text or None


def key_and_source():
    """The key saved by the panel, else TEAMLY_API_KEY (the site tells people to put it there), else that line in ~/.env.
    credentials.json may be {"key": …} (what the panel writes) or just the key: a coordinator may write either."""
    try:
        raw = read_text_any(CREDENTIALS)  # Notepad's UTF-16 or a BOM must not take the panel down
        try:
            data = json.loads(raw)
        except ValueError:
            data = raw
        k = clean_key(next((data.get(x) for x in ("key", "apiKey", "TEAMLY_API_KEY") if data.get(x)), None)
                      if isinstance(data, dict) else data if isinstance(data, str) else None)
        if k:
            return k, "~/.teamly/credentials.json"
    except OSError:
        pass
    if clean_key(os.environ.get("TEAMLY_API_KEY")):
        return clean_key(os.environ["TEAMLY_API_KEY"]), "TEAMLY_API_KEY"
    try:
        found = None
        for line in (Path.home() / ".env").read_text(encoding="utf-8", errors="replace").splitlines():
            m = re.match(r"""^\s*(?:export\s+)?TEAMLY_API_KEY\s*=\s*['"]?([^'"\s#]+)""", line)
            if m:
                found = m.group(1)  # the last one wins, as in the shell and in dotenv
        if found:
            return found, "~/.env"
    except OSError:
        pass
    return None, None


def read_key():
    return key_and_source()[0]


# ---------- Teamly API: is the key real, how many Teamly Dollars are on it ----------
API_BASE = "https://teamly-v2.fly.dev/v1"                    # the Teamly v2 API (api/ in timur-nocodia/teamly-v2)
KEY_PAGE = "https://teamly-pivot.fly.dev/app/connect"        # sign in there: the site sends the key back to this panel
CONNECT_STATE = TEAMLY_DIR / "connect.json"                  # the sign-in this panel opened: {"state", "until"}, one use
CONNECT_FOR = 600                                            # seconds a sign-in may take
LIBRARY_URL = "https://teamly-library.fly.dev/v1"            # the shared library: config.json "libraryUrl" or TEAMLY_LIBRARY_URL, "off"
CONFIG = TEAMLY_DIR / "config.json"                          # {"apiBase": …, "keyPage": …} to point at another server
OPENABLE = re.compile(r"^(teamly-v2\.fly\.dev|teamly-pivot\.fly\.dev|teamly-harness20\.fly\.dev|(?:[\w-]+\.)*teamly\.to)$")
REAL_KEY = "tly_data_"
API = {"key": None, "who": None, "wallet": None, "runs": None, "walletError": None, "checkedAt": 0, "walletAt": 0, "forcedAt": 0,
       "busy": False}
API_LOCK = threading.Lock()


def api_config():
    c = read_json(CONFIG) or {}
    base = os.environ.get("TEAMLY_API_BASE") or c.get("apiBase") or API_BASE
    return str(base).rstrip("/"), str(c.get("keyPage") or KEY_PAGE)


def api_get(path, key, timeout=8):
    """GET from the Teamly API with the key. (status, json); status 0 = Teamly can't be reached from here."""
    url = api_config()[0] + path
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {key}", "Accept": "application/json",
                                               "User-Agent": f"Teamly-v2/{VERSION}"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read(200_000) or b"null")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read(20_000) or b"null")
        except ValueError:
            return e.code, None
    except (urllib.error.URLError, OSError, ValueError, http.client.HTTPException) as e:  # HTTPException: an answer cut off
        if isinstance(e, socket.timeout) or isinstance(getattr(e, "reason", None), socket.timeout):
            return 0, None  # Teamly answered too slowly: curl would wait as long again, the person is already waiting
    # python.org Python on macOS often has no certificates; curl uses the system ones (key via stdin, not argv)
    if shutil.which("curl"):
        try:
            r = subprocess.run(["curl", "-s", "-m", str(timeout), "-w", "\n%{http_code}", "-K", "-", url],
                               input=f'header = "Authorization: Bearer {key}"\nheader = "Accept: application/json"\n',
                               capture_output=True, text=True, timeout=timeout + 3)
            body, _, code = r.stdout.rpartition("\n")
            if code.isdigit() and int(code):
                try:
                    return int(code), json.loads(body or "null")
                except ValueError:
                    return int(code), None
        except (subprocess.SubprocessError, OSError):
            pass
    return 0, None


def num(v, default=None):
    """A finite number from an API answer or a file, else default: "NaN", 1e999 or a word never become a number."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    return f if math.isfinite(f) else default


SURROGATE = re.compile("[\ud800-\udfff]")


def json_safe(v):
    """What JSON and UTF-8 can carry: NaN and Infinity become null, half an emoji (a lone surrogate) becomes \ufffd.
    Any file or API answer can hold them, and one of them must not take the whole panel down."""
    if isinstance(v, float):
        return v if math.isfinite(v) else None
    if isinstance(v, str):
        return SURROGATE.sub("\ufffd", v)
    if isinstance(v, dict):
        return {json_safe(k): json_safe(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [json_safe(x) for x in v]
    return v


def who_from(code):
    if code == 200:
        return {"verified": True, "reason": None}
    if code in (401, 403):
        return {"verified": False, "reason": "rejected"}  # wrong, revoked, expired, or not a Data API key
    return {"verified": None, "reason": "offline" if code == 0 else "server"}


def key_status(key):
    """verified True (Teamly knows it) / False (rejected, or a demo key) / None (not checked yet, or Teamly unreachable)."""
    if not key:
        return {"verified": None, "reason": None}
    if not key.startswith(REAL_KEY):
        return {"verified": False, "reason": "demo"}
    with API_LOCK:
        if API["key"] == key and API["who"]:
            return dict(API["who"])
    return {"verified": None, "reason": "checking"}


def refresh_api(key, force=False):
    """Checks the key (every 10 min) and the balance (every minute) in the background: /api/state never waits on the network."""
    if not key or not key.startswith(REAL_KEY):
        return
    now = time.time()
    with API_LOCK:
        if API["key"] != key:
            API.update(key=key, who=None, wallet=None, runs=None, walletError=None, checkedAt=0, walletAt=0)
        # a definite answer about the key holds for 10 minutes; "can't reach Teamly" is asked again every minute
        stale_who = force or not API["who"] or now - API["checkedAt"] > (600 if API["who"].get("verified") is not None else 60)
        stale_wallet = force or now - API["walletAt"] > 60
        if API["busy"] or not (stale_who or stale_wallet):
            return
        API["busy"] = True

    def work():
        with API_LOCK:
            who, wallet, runs, error = API["who"], API["wallet"], API["runs"], API["walletError"]
        try:
            # the balance answer is also Teamly's answer about the key; a revoked key is said now, not in ten minutes
            code, body = api_get("/wallet/balance", key)
            if stale_who or code in (200, 401, 403):
                who = who_from(code)
            if who and who["verified"] is False:  # Teamly said no to the key: the old balance is not its money any more
                wallet, runs, error = None, None, None
            else:
                fresh = parse_wallet(body) if code == 200 else None
                # a failed or unknown answer keeps the last balance (with its time) and says Teamly answered badly
                wallet, error = (fresh, None) if fresh else (wallet, {"code": code, "at": int(time.time())})
                if who and who["verified"]:
                    code, body = api_get("/runs?limit=20", key)  # the tool calls this key paid for, newest first
                    if code == 200 and isinstance(body, dict) and isinstance(body.get("items"), list):
                        runs = [r for r in map(run_item, body["items"][:20]) if r]
        except Exception:  # one strange answer must not stop the checks: the next ones run on the usual cadence
            pass
        finally:
            with API_LOCK:
                if API["key"] == key:
                    API.update(who=who, wallet=wallet, runs=runs, walletError=error, walletAt=time.time(),
                               **({"checkedAt": time.time()} if stale_who else {}))
                API["busy"] = False
    threading.Thread(target=work, daemon=True).start()


def parse_wallet(body):
    """The balance answer of the Teamly API, or None when it is not in the shape we know: never a made-up $0."""
    if not isinstance(body, dict) or not isinstance(body.get("balance"), dict):
        return None
    b, h, t = body["balance"], body.get("held"), body.get("topup")
    value = num(b.get("value"))
    if value is None:
        return None
    return {"balance": value, "currency": str(b.get("currency") or "USD")[:8],
            "held": num(h.get("value"), 0.0) if isinstance(h, dict) else 0.0,
            "topup": t.get("dashboard") if isinstance(t, dict) and isinstance(t.get("dashboard"), str) else None,
            "at": int(time.time())}


def run_item(r):
    """One tool call from the Teamly API (GET /runs): which service, its status, what it cost, when."""
    if not isinstance(r, dict):
        return None
    cost = r.get("cost") if isinstance(r.get("cost"), dict) else {}
    value = num(cost.get("value"))
    return {"provider": str(r.get("provider") or "")[:60], "endpoint": str(r.get("endpoint") or "")[:120],
            "status": str(r.get("status") or "")[:24], "cost": value, "at": str(r.get("createdAt") or "")[:40]}


def save_key(key):
    """A real key is asked about once, while the person waits: a key Teamly rejects is never saved."""
    key = clean_key(key) or ""   # pasted with its quotes or as TEAMLY_API_KEY=…: the key itself
    if len(key) < 8 or re.search(r"\s", key):
        raise ValueError("that does not look like a Teamly key")
    who = {"verified": False, "reason": "demo"}
    if key.startswith(REAL_KEY):
        who = who_from(api_get("/wallet/balance", key)[0])
        if who["verified"] is False:
            raise ValueError("Teamly doesn't recognize this key: press Sign in to Teamly instead")
    write_key(key)
    with API_LOCK:
        API.update(key=key, who=who if who["verified"] else None, wallet=None, runs=None, walletError=None,  # nothing of the old key
                   checkedAt=time.time() if who["verified"] else 0, walletAt=0)
    refresh_api(key, force=True)
    return {"connected": True, "masked": mask(key), **who}


def connect_page():
    """The site's sign-in page with a fresh one-time state: the site sends the key back to /connect.html with it, and
    only a key carrying it is taken (another site can't hand this panel its own key). A new sign-in replaces the old."""
    state = secrets.token_urlsafe(32)
    write_private(CONNECT_STATE, {"state": state, "until": int(time.time()) + CONNECT_FOR})
    page = api_config()[1]
    return f"{page}{'&' if '?' in page else '?'}state={state}"


def connect(key, state):
    """The key the site sent back after the person signed in (panel/connect.html)."""
    saved = read_json(CONNECT_STATE) or {}
    expected = saved.get("state") if isinstance(saved, dict) else None
    if not (isinstance(expected, str) and state and hmac.compare_digest(expected, state)
            and time.time() <= (num(saved.get("until"), 0) or 0)):
        raise ValueError("this sign-in is not from this panel or is too old: press Sign in to Teamly again")
    if not (clean_key(key) or "").startswith(REAL_KEY):
        raise ValueError("the site sent something that is not a Teamly key: press Sign in to Teamly again")
    CONNECT_STATE.unlink(missing_ok=True)
    return save_key(key)


def open_url(which):
    """The site's top-up page, or its sign-in page, in the person's own browser (the panel's pane has no Teamly login)."""
    _, page = api_config()
    with API_LOCK:
        wallet = API.get("wallet") or {}
    url = (wallet.get("topup") or page) if which == "topup" else connect_page() if which == "key" else None
    host = urlparse(url or "").hostname or ""
    if not url or urlparse(url).scheme != "https" or not OPENABLE.match(host):
        raise ValueError("not a Teamly page")
    if sys.platform == "darwin":
        subprocess.run(["open", url], check=True, timeout=5)
    elif sys.platform == "win32":
        os.startfile(url)
    else:
        raise ValueError("opening pages from the panel works on macOS and Windows")
    return {"opened": url}


def write_private(path, data):
    """JSON only this user can read (0600), written whole or not at all."""
    TEAMLY_DIR.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f)
    os.replace(tmp, path)


def write_key(key):
    write_private(CREDENTIALS, {"key": key, "savedAt": int(time.time())})


# ---------- agents ----------
def agent_dir(slug):
    for base in (LIBRARY_DIR, MY_LIBRARY_DIR, CATALOG_DIR):
        d = base / slug
        if (d / "SKILL.md").is_file():
            return d
    return None


def catalog():
    out = []
    for base in (LIBRARY_DIR, MY_LIBRARY_DIR, CATALOG_DIR):
        if base.is_dir():
            out += [d.name for d in sorted(base.iterdir()) if (d / "SKILL.md").is_file() and SLUG_RE.match(d.name) and d.name not in out]
    return out


def approaches():
    goals = []
    try:
        goals = json.loads((APPROACHES_DIR / "goals.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        pass
    items = []
    if APPROACHES_DIR.is_dir():
        for f in sorted(APPROACHES_DIR.glob("*.json")):
            if f.name == "goals.json":
                continue
            try:
                items.append(json.loads(f.read_text(encoding="utf-8")))
            except ValueError:
                continue
    return {"goals": goals, "items": items}


FOUNDER = HERE / "founder.json"          # who answers feedback: the founder's contacts, shown in the panel
FEEDBACK_DIR = TEAMLY_DIR / "feedback"


def save_feedback(body):
    kind = str(body.get("kind") or "other")
    if kind not in ("bug", "idea", "other"):
        raise ValueError("kind must be bug, idea or other")
    text = str(body.get("text") or "").strip()[:8000]
    if not text:
        raise ValueError("write what happened")
    FEEDBACK_DIR.mkdir(parents=True, exist_ok=True)
    ctx = body.get("context")
    if not isinstance(ctx, dict):  # a context sent as text is kept as one line, never dropped
        ctx = {"context": " ".join(str(ctx).split())} if ctx not in (None, "", [], {}) else {}
    lines = [f"# {kind} · {time.strftime('%Y-%m-%d %H:%M')}", "", text, "", "## Context"]
    lines += [f"- {k}: {str(v)[:300]}" for k, v in ctx.items()] + [f"- panel: {VERSION}", "- status: saved, not sent yet"]
    stamp = time.strftime("%Y%m%d-%H%M%S")
    for n in range(1, 1000):  # two reports in one second: the second gets -2, never overwrites the first
        path = FEEDBACK_DIR / (f"{stamp}-{kind}.md" if n == 1 else f"{stamp}-{kind}-{n}.md")
        try:
            with open(path, "x", encoding="utf-8") as f:
                f.write("\n".join(lines) + "\n")
            return {"saved": str(path)}
        except FileExistsError:
            continue
    raise ValueError("too many reports this second: try again")


# The test funnel: when this person first reached each step (local; they send it to the founder from the panel).
class FileLock:
    """Two panel servers can share ~/.teamly (the app may start a second one on another port): a lock file keeps their
    read-change-write of one file apart. Best effort: after `wait` seconds the write goes ahead anyway."""

    def __init__(self, path, wait=2.0):
        self.path, self.wait, self.held = Path(path), wait, False

    def __enter__(self):
        end = time.time() + self.wait
        while True:
            try:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                os.close(os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY))
                self.held = True
                return self
            except FileExistsError:
                try:
                    if time.time() - self.path.stat().st_mtime > 30:  # left by a process that died holding it
                        self.path.unlink()
                        continue
                except OSError:
                    pass
                if time.time() > end:
                    return self
                time.sleep(0.02)
            except OSError:  # no lock possible here (a read-only folder): go ahead
                return self

    def __exit__(self, *exc):
        if self.held:
            try:
                self.path.unlink()
            except OSError:
                pass


def write_atomic(path, text):
    """Whole or not at all, and two writers never share a temporary file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


FUNNEL = TEAMLY_DIR / "funnel.json"
EVENTS = TEAMLY_DIR / "events.jsonl"
MILESTONES = [("key", "Key connected"), ("onboarding", "Started setting up a floor"), ("floor", "First floor built"),
              ("agents", "Agents on a floor"), ("task", "First task started"), ("task_done", "First task done"),
              ("rating", "First rating"), ("share_ready", "An agent ready to share"), ("published", "An agent published"),
              ("feedback", "First feedback written")]


def track_funnel(key_ok, ob, teams):
    """Marks each milestone the first time it is true; counts what the person has now. Writes only on change."""
    tasks = [x for t in teams for x in t.get("tasks", [])]
    agents = [a for t in teams for a in t.get("agents", [])]
    stars = []
    if RATINGS.is_file():
        for line in RATINGS.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                stars.append(int(json.loads(line).get("stars", 0)))
            except (ValueError, TypeError, AttributeError):
                continue
    stars = [x for x in stars if 1 <= x <= 5]
    facts = {
        "key": key_ok, "onboarding": bool(ob), "floor": bool(teams), "agents": bool(agents), "task": bool(tasks),
        "task_done": any(x.get("complete") for x in tasks), "rating": bool(stars),
        "share_ready": any((a.get("share") or {}).get("ready") for a in agents),
        "published": any(a.get("shared") or ((a.get("share") or {}).get("draft") or {}).get("publishedAt") for a in agents),
        "feedback": FEEDBACK_DIR.is_dir() and any(FEEDBACK_DIR.iterdir()),
    }
    with FileLock(FUNNEL.with_suffix(".lock")):
        return funnel_update(facts, teams, agents, tasks, stars)


def funnel_update(facts, teams, agents, tasks, stars):
    data = read_json(FUNNEL) or {"milestones": {}}
    if not isinstance(data.get("milestones"), dict):
        data["milestones"] = {}
    before = json.dumps(data, sort_keys=True)
    now = int(time.time())
    for mid, _ in MILESTONES:
        if facts.get(mid) and mid not in data["milestones"]:
            data["milestones"][mid] = now
            try:
                TEAMLY_DIR.mkdir(parents=True, exist_ok=True)
                with open(EVENTS, "a", encoding="utf-8") as f:
                    f.write(json.dumps({"ts": now, "event": mid}) + "\n")
            except OSError:
                pass
    data["counts"] = {"floors": len(teams), "agents": len(agents), "tasks": len(tasks),
                      "tasksDone": sum(1 for x in tasks if x.get("complete")),
                      "ratings": len(stars), "avgStars": round(sum(stars) / len(stars), 2) if stars else None}
    if json.dumps(data, sort_keys=True) != before:
        try:
            data["updatedAt"] = now
            write_atomic(FUNNEL, json.dumps(data, indent=1))
        except OSError:
            pass
    data["steps"] = [{"id": mid, "label": label, "at": data["milestones"].get(mid)} for mid, label in MILESTONES]
    return data


UI_FILE = TEAMLY_DIR / "ui.json"


def save_ui(body):
    if not isinstance(body, dict):
        raise ValueError("ui state must be an object")
    keep = {k: body[k] for k in ("ui", "wallet", "screens") if isinstance(body.get(k), dict)}
    keep["savedAt"] = int(time.time())
    with FileLock(UI_FILE.with_suffix(".lock")):
        write_atomic(UI_FILE, json.dumps(keep, ensure_ascii=False))  # a half-written file never loses the state
    return {"saved": True}


RATINGS = TEAMLY_DIR / "ratings.jsonl"  # written by the coordinator after each task: one line per rated agent
WEEK = 7 * 24 * 3600


def stamp(ts):
    """Unix seconds from a number or an ISO date; 0 when it is neither."""
    try:
        return float(ts or 0)
    except (TypeError, ValueError):
        pass
    try:
        from datetime import datetime
        d = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        return d.timestamp() if d.tzinfo else time.mktime(d.timetuple())
    except ValueError:
        return 0.0


def rating_index(skip=()):
    """Stars per library agent from ~/.teamly/ratings.jsonl: a fork's rating counts for its original (upstream).
    skip: hashes of lines already sent to the shared library, whose stars come back counted there."""
    idx = {}
    if not RATINGS.is_file():
        return idx
    now = time.time()
    for line in read_text_any(RATINGS).splitlines():
        if skip and line_hash(line) in skip:
            continue
        try:  # one odd line (a list, an ISO time, a dict upstream) is skipped, never breaks the panel
            r = json.loads(line)
            stars = int(num(r.get("stars"), 0.0)) if abs(num(r.get("stars"), 0.0)) < 10 else 0
            slug = r["upstream"].split("@")[0] if isinstance(r.get("upstream"), str) and r["upstream"] else r.get("agent")  # slug@1.0.0
            if not 1 <= stars <= 5 or not isinstance(slug, str) or not slug:
                continue
        except (ValueError, TypeError, AttributeError):
            continue
        recent = now - stamp(r.get("ts")) < WEEK
        e = idx.setdefault(slug, {"sum": 0, "count": 0, "week": 0})
        e["sum"] += stars
        e["count"] += 1
        e["week"] += 1 if recent else 0
    return idx


def line_hash(line):
    return hashlib.sha256(line.strip().encode("utf-8")).hexdigest()[:20]


RATINGS_SENT = TEAMLY_DIR / "ratings-sent.json"   # {"sent": [line hashes]}: ratings that already reached the library
# error: why the last sending stopped ({"at", "code", "pending", "agent"}; code 0 = the library can't be reached), None
# once everything went. The panel shows it: stars that never leave this computer are counted only here.
SYNC = {"at": 0.0, "busy": False, "error": None}


def sent_ratings():
    v = (read_json(RATINGS_SENT) or {}).get("sent")
    return {x for x in v if isinstance(x, str)} if isinstance(v, list) else set()


def sync_ratings(key):
    """Ratings the coordinator wrote go to the shared library, so the stars everyone sees are everyone's. What goes:
    the library agent, the stars and a hash of the task; the note, the folder and the team's name stay here."""
    url = library_url()
    if not url or not key or not key.startswith(REAL_KEY) or not RATINGS.is_file():
        return
    with REMOTE_LOCK:
        if SYNC["busy"] or time.time() - SYNC["at"] < 120:
            return
        SYNC["busy"] = True
    threading.Thread(target=send_ratings, args=(url, key), daemon=True).start()


def send_ratings(url, key):
    wait = 120
    try:
        known = {c.get("slug") for c in remote_cards() if isinstance(c, dict)}
        if not known:
            wait = 10  # the catalog isn't here yet (a fresh start): try again in a few seconds
            return
        sent = sent_ratings()
        before = len(sent)
        todo = []
        for line in read_text_any(RATINGS).splitlines():
            h = line_hash(line)
            if not line.strip() or h in sent:
                continue
            try:
                r = json.loads(line)
                stars = r.get("stars")
                up = r["upstream"].split("@")[0] if isinstance(r.get("upstream"), str) and r["upstream"] else None
                slug = up if up in known else r.get("agent") if r.get("agent") in known else None
            except (ValueError, TypeError, AttributeError):
                continue
            if not slug or isinstance(stars, bool) or not isinstance(stars, int) or not 1 <= stars <= 5:
                continue  # the person's own agent, not in the library: its stars stay on this computer
            task = hashlib.sha256(f"{r.get('team')}/{r.get('task')}".encode("utf-8")).hexdigest()[:16]
            todo.append((h, {"agent": slug, "stars": stars, "task": task}))
        error = None
        for i, (h, body) in enumerate(todo):
            code = post_json(f"{url}/ratings", body, key)
            if code in (200, 400, 404):  # taken, or the library will never take it: either way it's done
                sent.add(h)
            else:  # offline or the key isn't accepted: the next try sends the rest
                error = {"at": time.time(), "code": code, "pending": len(todo) - i, "agent": body["agent"]}
                break
        with REMOTE_LOCK:
            SYNC["error"] = error
        if len(sent) != before:
            write_atomic(RATINGS_SENT, json.dumps({"sent": sorted(sent)}))
            with REMOTE_LOCK:
                REMOTE["at"] = 0.0  # the stars now come back from the library: ask it again on the next look
    except Exception:  # noqa: BLE001  a strange line or answer never stops the panel
        pass
    finally:
        with REMOTE_LOCK:
            SYNC["busy"] = False
            SYNC["at"] = time.time() - 120 + wait


def post_json(url, body, key, timeout=10):
    """POST JSON with the key. The answer's status; 0 = it can't be reached from here."""
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST", headers={
        "Authorization": f"Bearer {key}", "Content-Type": "application/json", "User-Agent": f"Teamly-v2/{VERSION}"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except (urllib.error.URLError, OSError, http.client.HTTPException):
        pass
    if shutil.which("curl"):  # no certificates in python.org Python on macOS: curl, the key through stdin, not argv
        try:
            r = subprocess.run(["curl", "-s", "-m", str(timeout), "-o", os.devnull, "-w", "%{http_code}", "-K", "-", url],
                               input=f'header = "Authorization: Bearer {key}"\nheader = "Content-Type: application/json"\n'
                                     f'data-binary = "{json.dumps(body).replace(chr(92), chr(92) * 2).replace(chr(34), chr(92) + chr(34))}"\n',
                               capture_output=True, text=True, timeout=timeout + 3)
            return int(r.stdout) if r.stdout.strip().isdigit() else 0
        except (subprocess.SubprocessError, OSError, ValueError):
            pass
    return 0


def with_rating(c, idx):
    """Card's published rating (from the Teamly library) plus the ratings given on this computer."""
    own = c.get("rating") if isinstance(c.get("rating"), dict) else {}
    loc = idx.get(c["slug"], {})
    count = int(max(0.0, min(num(own.get("count"), 0.0), 1e9)))  # a received card can hold anything here
    n = count + loc.get("count", 0)
    total = max(0.0, min(num(own.get("avg"), 0.0), 5.0)) * count + loc.get("sum", 0)
    c["rating"] = {"avg": round(total / n, 2), "count": n} if n else None
    c["week"] = int(max(0.0, min(num(c.get("week"), 0.0), 1e9))) + loc.get("week", 0)
    return c


LIBRARY_CACHE = TEAMLY_DIR / "library-cache.json"   # the last catalog: the Library still shows it when Teamly can't be reached
REMOTE = {"url": None, "cards": None, "at": 0.0, "busy": False}
REMOTE_LOCK = threading.Lock()


def library_url():
    """The shared Teamly library's address (https; 127.0.0.1 for tests), or None when the person turned it off."""
    c = read_json(CONFIG) or {}
    url = str(os.environ.get("TEAMLY_LIBRARY_URL") or (c.get("libraryUrl") if isinstance(c, dict) else None) or LIBRARY_URL)
    url = url.strip().rstrip("/")
    ok = re.match(r"^https://[\w.-]+(:\d+)?(/|$)", url) or re.match(r"^http://(127\.0\.0\.1|localhost)(:\d+)?(/|$)", url)
    return url if ok and url.lower() != "off" else None


def get_json(url, timeout=10, limit=5_000_000):
    """GET a public JSON answer. (status, json); status 0 = it can't be reached from here."""
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": f"Teamly-v2/{VERSION}"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read(limit) or b"null")
    except urllib.error.HTTPError as e:
        return e.code, None
    except (urllib.error.URLError, OSError, ValueError, http.client.HTTPException):
        pass
    if shutil.which("curl"):  # python.org Python on macOS often has no certificates; curl uses the system ones
        try:
            r = subprocess.run(["curl", "-s", "-m", str(timeout), "--max-filesize", str(limit), "-w", "\n%{http_code}", url],
                               capture_output=True, text=True, timeout=timeout + 3)
            body, _, code = r.stdout.rpartition("\n")
            if code.isdigit() and int(code) == 200:
                return 200, json.loads(body or "null")
            return (int(code) if code.isdigit() else 0), None
        except (subprocess.SubprocessError, OSError, ValueError):
            pass
    return 0, None


def remote_cards():
    """The shared library's catalog, asked in the background every 10 minutes while a panel is open (a minute after a
    failure). The last answer is kept on disk, so the Library is never empty only because Teamly can't be reached."""
    url = library_url()
    if not url:
        return []
    with REMOTE_LOCK:
        if REMOTE["url"] != url:
            cached = read_json(LIBRARY_CACHE) or {}
            REMOTE.update(url=url, at=0.0, cards=cached.get("agents") if cached.get("url") == url and isinstance(cached.get("agents"), list) else None)
        start = not REMOTE["busy"] and time.time() - REMOTE["at"] > 600
        if start:
            REMOTE["busy"] = True
        cards = list(REMOTE["cards"] or [])
    if start:
        threading.Thread(target=fetch_library, args=(url,), daemon=True).start()
    return cards


def fetch_library(url):
    got = None
    try:
        code, body = get_json(url + "/agents")
        if code == 200 and isinstance(body, dict) and isinstance(body.get("agents"), list):
            got = [c for c in body["agents"] if isinstance(c, dict)]
            write_atomic(LIBRARY_CACHE, json.dumps({"url": url, "at": int(time.time()), "agents": got}, ensure_ascii=False))
    except Exception:  # noqa: BLE001  a strange answer never stops the panel: the next try comes on the usual cadence
        pass
    finally:
        with REMOTE_LOCK:
            REMOTE["busy"] = False
            REMOTE["at"] = time.time() - (0 if got is not None else 540)
            if got is not None and REMOTE["url"] == url:
                REMOTE["cards"] = got


def library():
    """Library cards for the panel: agents on this computer first (the skill's own, the person's published ones), then
    the shared Teamly library (remote: true, with everyone's stars and counts)."""
    cards, seen = [], set()
    idx = rating_index()
    for base in (LIBRARY_DIR, MY_LIBRARY_DIR):
        if not base.is_dir():
            continue
        for d in sorted(base.iterdir()):
            card = d / "card.json"
            if d.name in seen or not card.is_file() or not (d / "SKILL.md").is_file():
                continue
            try:
                c = json.loads(card.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if not isinstance(c, dict):
                continue
            c = clean_card(c)
            if not isinstance(c.get("slug"), str) or not SLUG_RE.match(c["slug"]):
                c["slug"] = d.name
            c["path"] = str(d)
            c["hasOntology"] = (d / "ontology.md").is_file()
            c["hasEvals"] = (d / "evals" / "evals.json").is_file()
            cards.append(with_rating(c, idx))
            seen.add(d.name)
    base = library_url()
    unsent = rating_index(sent_ratings())
    for c in remote_cards():
        c = clean_card(dict(c))
        slug = c.get("slug")
        if not isinstance(slug, str) or not SLUG_RE.match(slug) or slug in seen:
            continue
        c.pop("path", None)
        if isinstance(c.get("download"), str):
            c["download"] = urljoin(base + "/", c["download"])
        c["remote"] = True
        cards.append(with_rating(c, unsent))
        seen.add(slug)
    return cards


def installed():
    """Agents present in the skills dir as teamly-<slug>/SKILL.md (base skill `teamly` excluded)."""
    if not SKILLS_DIR.is_dir():
        return []
    out = []
    for d in sorted(SKILLS_DIR.iterdir()):
        slug = d.name[len(SKILL_PREFIX):]
        if d.name.startswith(SKILL_PREFIX) and (d / "SKILL.md").is_file() and SLUG_RE.match(slug):
            out.append({"slug": slug, "ours": (d / MARKER).is_file()})
    return out


def hire(slug):
    if not SLUG_RE.match(slug) or slug not in catalog():
        raise ValueError(f"unknown agent: {slug}")
    dst = SKILLS_DIR / f"{SKILL_PREFIX}{slug}"
    if dst.exists() and not (dst / MARKER).is_file():
        raise ValueError(f"{dst.name} already exists and was not installed by Teamly")
    SKILLS_DIR.mkdir(parents=True, exist_ok=True)
    tmp = SKILLS_DIR / f".{dst.name}.tmp"
    shutil.rmtree(tmp, ignore_errors=True)
    shutil.copytree(agent_dir(slug), tmp)
    (tmp / MARKER).write_text(json.dumps({"slug": slug, "installedAt": int(time.time())}), encoding="utf-8")
    shutil.rmtree(dst, ignore_errors=True)
    os.replace(tmp, dst)
    return {"slug": slug, "path": str(dst)}


def fire(slug):
    dst = SKILLS_DIR / f"{SKILL_PREFIX}{slug}"
    if not SLUG_RE.match(slug) or not (dst / MARKER).is_file():
        raise ValueError(f"{slug} was not installed by Teamly")
    shutil.rmtree(dst)
    return {"slug": slug}


# ---------- teams and tasks (read-only) ----------
def local_path(p):
    """A coordinator in Git Bash may write /c/Users/…; Python on Windows needs C:/Users/…"""
    if os.name == "nt" and isinstance(p, str):
        m = re.match(r"^/([a-zA-Z])/(.*)$", p)
        if m:
            return f"{m.group(1).upper()}:/{m.group(2)}"
    return p


def read_teams():
    out = []
    if TEAMS_DIR.is_dir():
        for f in sorted(TEAMS_DIR.glob("*.json")):
            try:
                st = f.stat()
                t = json.loads(f.read_bytes())  # a BOM or UTF-16 from a Windows editor reads too
            except OSError:
                continue
            except ValueError as e:  # broken by a hand edit: the floor stays, saying so, instead of vanishing
                t = {"slug": f.stem, "name": f.stem, "broken": f"{f.name} can't be read: {str(e)[:120]}"}
            if not isinstance(t, dict):
                t = {"slug": f.stem, "name": f.stem, "broken": f"{f.name} is not a team record"}
            if not isinstance(t.get("slug"), str) or not t["slug"].strip():  # the floor opens by slug: the file's name then
                t["slug"] = f.stem
            t["_file"] = f.stem
            if not isinstance(t.get("created"), (int, float)):  # floor order: oldest at the bottom
                # creation time: st_birthtime on macOS (and Windows on Python 3.12+), st_ctime on older Windows
                t["created"] = getattr(st, "st_birthtime", None) or (st.st_ctime if os.name == "nt" else st.st_mtime)
            for k in ("folder", "pack", "active_task"):
                if t.get(k):
                    t[k] = local_path(t[k])
            for k in ("agents", "goals", "tasks", "chain"):  # a list written as text or as one object is still a list
                if k in t and not isinstance(t[k], list):
                    t[k] = [t[k]] if isinstance(t[k], (str, dict)) else []
            for g in t.get("goals") or []:
                if isinstance(g, dict) and "chain" in g and not isinstance(g["chain"], list):
                    g["chain"] = [g["chain"]] if isinstance(g["chain"], (str, dict)) else []
            if isinstance(t.get("agents"), list):
                t["agents"] = [{**a, "path": local_path(a["path"])} if isinstance(a, dict) and isinstance(a.get("path"), str) and a["path"] else a
                               for a in t["agents"]]
            out.append(t)
    # two records with one slug (a Finder copy "reels copy.json"): the one in <slug>.json keeps it, the other opens as
    # its own floor under its file's name, so neither hides the other
    taken = {t["slug"] for t in out if t["_file"] == t["slug"]}
    seen = set()
    for t in out:
        if t["_file"] != t["slug"] and (t["slug"] in taken or t["slug"] in seen):
            t["duplicateOf"], t["slug"] = t["slug"], t["_file"]
        seen.add(t["slug"])
    for t in out:
        t.pop("_file", None)
    return out


# ---------------------------------------------------------------- offices (buildings)
# One office = a building of up to 5 floors; one floor = one team. An office is also a place of its own: a team made for
# another person or another business goes to its own office, so its floors, plan and reports stay apart.
# ~/.teamly/offices.json: {"offices": [{"id", "name"}], "place": {<team slug>: {"office", "folder"}}, "next": {"office", "at"}}.
# A pin belongs to the team in that folder: a new team that later gets the same slug in another folder isn't pinned by it.
# "place" keeps where each floor stands (a floor being set up is pinned to its office as soon as it has a slug, and the
# panel or the coordinator can move one); "next" is the office the next floor goes to (an office was just opened, or
# "New floor" was pressed in it). A team with neither takes the first free floor, in the order teams were created.
FLOORS_PER_OFFICE = 5
OFFICES = TEAMLY_DIR / "offices.json"
OFFICE_LOCK = threading.Lock()


def is_id(v):
    return isinstance(v, int) and not isinstance(v, bool) and v > 0


def office_name(name, nid):
    return re.sub(r"\s+", " ", str(name or "")).strip()[:40] or ("My office" if nid == 1 else f"Office {nid}")


def read_book():
    """offices.json, cleaned: the offices, where floors stand, where the next floor goes."""
    data = read_json(OFFICES) or {}
    offices, seen = [], set()
    for o in data.get("offices") if isinstance(data.get("offices"), list) else []:
        if isinstance(o, dict) and is_id(o.get("id")) and o["id"] not in seen:
            seen.add(o["id"])
            offices.append({"id": o["id"], "name": office_name(o.get("name"), o["id"])})
    # "pins" (0.5.3+) keeps each pin with its folder; "place" keeps the office alone, which 0.5.2 can read and keeps
    place = data.get("pins") if isinstance(data.get("pins"), dict) else data.get("place") if isinstance(data.get("place"), dict) else {}
    nxt = data.get("next") if isinstance(data.get("next"), dict) else {}
    at = nxt.get("at") if isinstance(nxt.get("at"), (int, float)) and not isinstance(nxt.get("at"), bool) else 0
    pins = {}
    for k, v in place.items():
        if isinstance(k, str) and is_id(v):  # 0.5.2 wrote the office id alone
            pins[k] = {"office": v, "folder": None}
        elif isinstance(k, str) and isinstance(v, dict) and is_id(v.get("office")):
            pins[k] = {"office": v["office"], "folder": v["folder"] if isinstance(v.get("folder"), str) else None}
            if isinstance(v.get("at"), (int, float)) and not isinstance(v.get("at"), bool):
                pins[k]["at"] = v["at"]
    return {"offices": offices or [{"id": 1, "name": office_name("", 1)}],
            "place": pins,
            "next": {"office": nxt["office"], "at": at} if is_id(nxt.get("office")) else None}


def norm_folder(p):
    """One spelling of a folder, for comparing only: C:/Users/…, C:\\Users\\… and /c/Users/… (Git Bash) are the same
    place on Windows; a name typed (NFC) and the same name from Finder (NFD), or in another letter case, are one folder
    on a Mac too (its disks ignore case unless formatted otherwise)."""
    p = unicodedata.normalize("NFC", str(p or "")).replace("\\", "/").rstrip("/")
    m = re.match(r"^/([a-zA-Z])/(.*)$", p)
    if m:
        p = f"{m.group(1)}:/{m.group(2)}"
    return p.lower() if re.match(r"^[a-zA-Z]:/", p) or sys.platform == "darwin" else p


def save_book(book):
    data = {"offices": [{"id": o["id"], "name": o["name"]} for o in book["offices"]],
            "place": {k: v["office"] for k, v in book["place"].items()}, "pins": book["place"], "next": book["next"]}
    if OFFICES.exists() and read_json(OFFICES) is None:  # broken by hand: kept aside before it is written over
        try:
            shutil.copy2(OFFICES, OFFICES.with_name(time.strftime("offices.broken-%Y%m%d-%H%M%S.json")))
        except OSError:
            pass
    write_atomic(OFFICES, json.dumps(data, ensure_ascii=False, indent=1))


@contextlib.contextmanager
def offices_locked():
    """This process's lock and the lock file every panel server on this ~/.teamly shares."""
    with OFFICE_LOCK, FileLock(OFFICES.with_suffix(".lock")):
        yield


def in_setup(ob):
    """The floor being set up from onboarding.json: (is one being set up, its team slug or None)."""
    slug = ob_team_slug(ob)
    return bool(ob) and ob.get("step") not in (None, "started"), slug if isinstance(slug, str) and slug else None


def place_teams(teams, book, ob=None):
    """Gives every team an office id; offices that fill up get a next one (kept once something is saved).
    ob = onboarding.json. Returns the office of the floor being set up while it has no team record yet (or None), and
    whether the book changed (the floor being set up got pinned to its office)."""
    offices, place = book["offices"], book["place"]
    count = {o["id"]: 0 for o in offices}
    room = lambda oid: oid in count and count[oid] < FLOORS_PER_OFFICE  # noqa: E731
    building, slug = in_setup(ob)
    record = next((t for t in teams if slug and t.get("slug") == slug), None)
    ob_folder = (record or {}).get("folder") or (ob or {}).get("folder")
    ob_folder = ob_folder if isinstance(ob_folder, str) else None
    def pin_of(s, folder, created=None):
        """The pin of team s in this folder. A pin whose folder is gone follows its team to where it moved (SKILL.md 0.3
        rewrites the record's folder) when the record is older than the pin; a team made after the pin with the same slug
        is someone new. A pin whose folder is still there belongs to another team with that slug."""
        pin = place.get(s) if s in place else None
        if not pin or pin["folder"] is None or norm_folder(pin["folder"]) == norm_folder(folder):
            return pin
        if folder and not Path(local_path(pin["folder"])).exists() and created is not None and created <= pin.get("at", float("inf")):
            pin["folder"] = folder
            nonlocal changed
            changed = True
            return pin
        return None
    nxt, changed = book["next"], False
    # the floor being set up (or just finished, if "next" was chosen before that) goes to the office it was meant for
    if slug and not pin_of(slug, ob_folder) and nxt and nxt["office"] in count and (building or nxt["at"] <= stamp((ob or {}).get("updatedAt"))):
        place[slug] = {"office": nxt["office"], "folder": ob_folder, "at": int(time.time())}
        book["next"] = nxt = None
        changed = True
    loose = []
    for t in sorted(teams, key=lambda t: t.get("created") or 0):
        s = t.get("slug") if isinstance(t.get("slug"), str) else None
        if s and s not in place and t.get("setupPending") and nxt and nxt["office"] in count and stamp(t.get("created")) >= nxt["at"] - 60:
            # a team installed from a file after an office was opened for it: that is where it goes
            place[s] = {"office": nxt["office"], "folder": t.get("folder") if isinstance(t.get("folder"), str) else None, "at": int(time.time())}
            book["next"] = nxt = None
            changed = True
        pin = pin_of(s, t.get("folder") if isinstance(t.get("folder"), str) else None, stamp(t.get("created")))
        if pin and pin["folder"] is None and isinstance(t.get("folder"), str):  # a 0.5.2 pin: it belongs to this team's folder
            pin["folder"] = t["folder"]
            changed = True
        want = pin["office"] if pin else t.get("office") if is_id(t.get("office")) else None
        if room(want):
            t["office"] = want
            count[want] += 1
        else:
            loose.append(t)

    def free():
        for o in offices:
            if count[o["id"]] < FLOORS_PER_OFFICE:
                return o["id"]
        nid = max(count) + 1
        offices.append({"id": nid, "name": office_name("", nid)})
        count[nid] = 0
        return nid

    for t in loose:
        t["office"] = free()
        count[t["office"]] += 1
    setup = None
    if building and not record:
        pin = pin_of(slug, ob_folder) if slug else None
        setup = pin["office"] if pin and room(pin["office"]) else nxt["office"] if nxt and room(nxt["office"]) else free()
        count[setup] += 1
    if building and slug and not pin_of(slug, ob_folder):  # pinned where it stands: "New floor" pressed elsewhere won't move it
        place[slug] = {"office": record["office"] if record else setup, "folder": ob_folder, "at": int(time.time())}
        changed = True
    for o in offices:
        o["floors"] = count[o["id"]]
    return setup, changed


def office_book():
    """The book with every team placed: (book, teams, onboarding.json). Saves it when a floor got pinned."""
    book, teams, ob = read_book(), shown_teams(), read_json(ONBOARDING) or {}
    if place_teams(teams, book, ob)[1]:
        save_book(book)
    return book, teams, ob


def office_by_id(book, oid):
    return next((o for o in book["offices"] if is_id(oid) and o["id"] == oid), None)


def new_office(name="", setup=False):
    """Opens an office (any time: for another person or business, or when the floors are full). setup: the floor being
    set up now moves into it. With no floor being set up, the next floor goes there: you open an office to build in it."""
    with offices_locked():
        book, teams, ob = office_book()
        same = next((o for o in book["offices"] if str(name or "").strip() and o["name"].strip().lower() == str(name).strip().lower()), None)
        nid = same["id"] if same else max(o["id"] for o in book["offices"]) + 1  # a second "Yan" is the same office
        name = same["name"] if same else office_name(name, nid)
        if not same:
            book["offices"].append({"id": nid, "name": name})
        building, slug = in_setup(ob)
        if building and setup and slug:
            record = next((t for t in teams if t.get("slug") == slug), None)
            folder = (record or {}).get("folder") or ob.get("folder")
            book["place"][slug] = {"office": nid, "folder": folder if isinstance(folder, str) else None, "at": int(time.time())}
        elif not building or setup:
            book["next"] = {"office": nid, "at": time.time()}
        save_book(book)
        return {"id": nid, "name": name}


def move_team(slug, office):
    """Moves a floor to another office (the coordinator, when the person asks)."""
    with offices_locked():
        book, teams, ob = office_book()
        team = next((t for t in teams if isinstance(slug, str) and t.get("slug") == slug), None)
        if not team and not (isinstance(slug, str) and slug == in_setup(ob)[1]):
            raise ValueError("no such team")
        o = office_by_id(book, office)
        if not o:
            raise ValueError("no such office")
        if (team or {}).get("office") != office and o["floors"] >= FLOORS_PER_OFFICE:
            raise ValueError(f"{o['name']} is full: {FLOORS_PER_OFFICE} floors")
        folder = (team or {}).get("folder") or ob.get("folder")
        book["place"][slug] = {"office": office, "folder": folder if isinstance(folder, str) else None, "at": int(time.time())}
        save_book(book)
        return {"team": slug, "office": office}


def next_office(office):
    """The next floor goes to this office ("New floor" pressed in it)."""
    with offices_locked():
        book = office_book()[0]
        if not office_by_id(book, office):
            raise ValueError("no such office")
        book["next"] = {"office": office, "at": time.time()}
        save_book(book)
        return {"next": office}


SESSION_RE = re.compile(r"local_[A-Za-z0-9-]{1,64}")


def open_chat(session):
    """The Browser pane can't follow claude:// links, so the server hands the app's own session link to macOS.
    Only chats a team record names (coordinator or agent) can be opened."""
    session = str(session or "")
    if not SESSION_RE.fullmatch(session):
        raise ValueError("not a chat id")
    known = set()
    for t in read_teams():
        known.add(t.get("coordinator_session"))
        for group in ("agents", "hiring"):  # an agent being hired has its chat before it joins agents (SKILL.md 3.5)
            rows = t.get(group) if isinstance(t.get(group), list) else []
            known.update(a.get("session") for a in rows if isinstance(a, dict))
    if session not in known:
        raise ValueError("this chat is not one of your teams")
    link = f"claude://claude.ai/epitaxy/{session}"
    if sys.platform == "darwin":
        subprocess.run(["open", link], check=True, timeout=5)
    elif sys.platform == "win32":
        os.startfile(link)  # Windows hands the claude:// link to the Claude app the same way (not yet verified on a real machine)
    else:
        raise ValueError("opening a chat from the panel works on macOS and Windows")
    return {"opened": session}


SPRITE_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def clean_card(c):
    """Cards come from other people: fields the panel puts into HTML attributes or counts get a strict shape."""
    if not isinstance(c.get("sprite"), str) or not SPRITE_RE.match(c["sprite"]):
        c.pop("sprite", None)
    if "results" in c:
        n = num(c["results"])  # 1e999 or Infinity is no count
        if n is None:
            c.pop("results")
        else:
            c["results"] = int(max(0.0, min(n, 1e9)))
    for k in ("tags", "costBreakdown", "setup"):  # lists the panel walks: never text or an object in their place
        if k in c and not isinstance(c[k], list):
            c[k] = [c[k]] if isinstance(c[k], (str, dict)) else []
    if "job" in c and not isinstance(c["job"], dict):
        c["job"] = None
    for k in ("steps", "deliverables"):
        job = c.get("job")
        if isinstance(job, dict) and k in job and not isinstance(job[k], list):
            job[k] = [job[k]] if isinstance(job[k], str) else []
    return c


def read_card(d):
    try:
        c = json.loads((Path(d) / "card.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return clean_card(c) if isinstance(c, dict) else {}


sys.path.insert(0, str(HERE / "forge" / "scripts"))
try:
    import package_agent  # readiness for the library: the same rules the coordinator packages by
except ImportError:  # the forge folder is missing: the panel just won't show "Ready to share"
    package_agent = None
sys.path.insert(0, str(HERE))
try:
    import update as updater  # update.py: the update channel (latest.json in the marketplace repository)
except Exception:  # the panel works without it, it just never says a new version is out
    updater = None

UPDATE = {"status": None}
UPDATE_CACHE = TEAMLY_DIR / "update-check.json"   # one check every few hours, kept across restarts
CHECK_EVERY = 6 * 3600   # a fix reaches people the same day


def update_status():
    """For the panel: a newer version is out (available), or this one is below minVersion (required)."""
    st = UPDATE["status"]
    if isinstance(st, dict) and st.get("current") == VERSION:
        return {k: st.get(k) for k in ("current", "latest", "available", "required", "notes", "date")}
    return {"current": VERSION, "available": False, "required": False}


def check_updates_forever():
    while True:
        wait = CHECK_EVERY
        try:
            cache = read_json(UPDATE_CACHE) or {}
            age = time.time() - num(cache.get("checkedAt"), 0.0)
            st = cache.get("status") if cache.get("for") == VERSION and isinstance(cache.get("status"), dict) else None
            # "you must update" is asked again every hour: the site may have fixed a wrong minVersion
            keep = (3600 if st and st.get("required") else CHECK_EVERY) if st else 0
            if st and 0 <= age < keep:
                UPDATE["status"], wait = st, keep - age
            else:
                st = updater.status(updater.fetch_manifest(), VERSION)
                UPDATE["status"] = st
                TEAMLY_DIR.mkdir(parents=True, exist_ok=True)
                UPDATE_CACHE.write_text(json.dumps({"checkedAt": int(time.time()), "for": VERSION, "status": st},
                                                   ensure_ascii=False) + "\n", encoding="utf-8")
                wait = 3600 if st.get("required") else CHECK_EVERY
        except Exception:  # offline, no update file on the site yet, a cut answer: try again in an hour, never stop
            wait = 3600
        time.sleep(max(60, wait))


def start_update_checks():
    if updater is not None and updater.manifest_url():
        threading.Thread(target=check_updates_forever, daemon=True).start()


REPLACED_CHECK = float(os.environ.get("TEAMLY_REPLACED_CHECK") or 20)  # seconds between looks at the folder on disk


def disk_version():
    try:
        m = re.search(r'^VERSION = "([^"]+)"', (HERE / "server.py").read_text(encoding="utf-8"), re.MULTILINE)
    except OSError:
        return None
    return m.group(1) if m else None


RESTART = threading.Event()  # Windows: the new version runs as this process's child (see restart_when_replaced)


def restart_when_replaced(srv):
    """An update or a rollback put another version into this folder: this process (and any other panel server sharing
    ~/.teamly, e.g. a second one on 4320) starts again on it, in place: same process, same port.
    On Windows execv starts a new process and ends this one, and whoever started the panel would see it exit: there
    this process frees the port, runs the new version as its child and waits for it (main() does that)."""
    while True:
        time.sleep(REPLACED_CHECK)
        on_disk = disk_version()
        if on_disk and on_disk != VERSION:
            print(f"Teamly {on_disk} is in place of {VERSION}: the panel starts again on it", file=sys.stderr, flush=True)
            if os.name == "nt":
                RESTART.set()
                srv.shutdown()
                return
            os.execv(sys.executable, [sys.executable, str(HERE / "server.py"), *sys.argv[1:]])


def exit_with_parent(pid):
    """Windows: a panel started by an older one as its child ends when that parent is killed, so the port is not left
    taken by a process nobody started."""
    import ctypes
    kernel32 = ctypes.windll.kernel32
    handle = kernel32.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE
    if not handle:
        return
    kernel32.WaitForSingleObject(handle, 0xFFFFFFFF)  # INFINITE
    os._exit(0)


def move_old_data():
    """Ratings and edits made in the panel by 0.5.2 and older lived inside the skill folder: bring them to ~/.teamly.
    After a stay on an old version again, a newer edit there wins and its rating lines join the ones here."""
    if not OLD_DATA_DIR.is_dir():
        return
    for f in OLD_DATA_DIR.rglob("*"):
        if not f.is_file():
            continue
        dst = DATA_DIR / f.relative_to(OLD_DATA_DIR)
        try:
            dst.parent.mkdir(parents=True, exist_ok=True)
            if f.suffix == ".jsonl" and dst.exists():
                have = set(dst.read_text(encoding="utf-8", errors="replace").splitlines())
                new = [line for line in f.read_text(encoding="utf-8", errors="replace").splitlines() if line.strip() and line not in have]
                if new:
                    with open(dst, "a", encoding="utf-8") as out:
                        out.write("\n".join(new) + "\n")
            elif not dst.exists() or f.stat().st_mtime > dst.stat().st_mtime:
                shutil.copy2(f, dst)
        except OSError:
            pass


def share_info(path, team_slug, pack):
    """Is this agent ready for the library, and what does its draft package (team/outbox/<slug>) say."""
    if not package_agent or not path:
        return None
    try:
        info = package_agent.readiness(path, team_slug)
    except Exception:  # a broken ratings line must never break the panel
        return None
    m = read_json(Path(pack) / "outbox" / Path(path).name / "manifest.json") if pack else None
    if m:
        info["draft"] = {k: m.get(k) for k in ("slug", "name", "draftAt", "public", "private", "setupQuestions", "defaults", "privacy", "needs", "zip", "publishedAt")}
    return info


def enrich_team(t):
    """Normalise a team record for the panel: area, goals, agents (with cards), tasks found in the team folder."""
    t.setdefault("area", t.get("name"))
    pack = Path(t["pack"]) if t.get("pack") else (Path(t["folder"]) / "team" if t.get("folder") else None)
    team_json = read_json(pack / "team.json") if pack else None
    if not t.get("goals"):
        g = (team_json or {}).get("goal")
        t["goals"] = [g] if isinstance(g, dict) else []
    agents = []
    for a in t.get("agents") or []:
        if isinstance(a, str):
            a = {"slug": a}
        if not isinstance(a, dict):
            continue
        slug = a.get("slug") if isinstance(a.get("slug"), str) else None
        path = a.get("path") or (str(pack / "agents" / slug) if pack and (pack / "agents" / slug).is_dir() else None)
        if not path:
            d = agent_dir(slug) if slug else None
            path = str(d) if d else None
        card = read_card(path) if path else {}
        agents.append({**a, "path": path, "card": card, "share": share_info(path, t.get("slug"), pack),
                       "hasOntology": bool(path) and (Path(path) / "ontology.md").is_file(),
                       "hasChanges": bool(path) and (Path(path) / "CHANGES.md").is_file(),
                       "hasEvals": bool(path) and (Path(path) / "evals" / "evals.json").is_file()})
    t["agents"] = agents
    tasks = []
    folder = Path(local_path(t["folder"])) if isinstance(t.get("folder"), str) and t["folder"] else None
    t["folderMissing"] = bool(folder) and not folder.is_dir()  # moved, renamed or deleted: the panel says so
    if folder and folder.is_dir():
        for d in sorted(folder.iterdir()):
            st = d / "STATUS.md"
            if d.is_dir() and st.is_file():
                full = read_task(d)
                rows = (full.get("status") or {}).get("rows", [])
                files = {f["name"] for f in full["files"]}
                # the panel's rule too: steps = agent steps; one is done when its status says so, or when its file is there
                # and the status says nothing else (failed, working, waiting for you win over the file).
                # The task is complete only when the person's own steps are done as well.
                agent_rows = [r for r in rows if not HUMAN_RE.search(r["who"])]
                done = sum(1 for r in agent_rows if DONE_RE.match(r["status"]) or (file_there(r["file"], files) and not OPEN_RE.search(r["status"])))
                complete = bool(rows) and done == len(agent_rows) and all(DONE_RE.match(r["status"]) for r in rows if HUMAN_RE.search(r["who"]))
                said = next((x.get("status") for x in t.get("tasks") or [] if isinstance(x, dict)
                             and d.name in (x.get("slug"), Path(str(x.get("folder") or "")).name)), None)
                complete = complete or str(said or "").lower() in ("done", "skipped", "cancelled")  # the record closed it
                tasks.append({**full, "slug": d.name, "title": (full.get("status") or {}).get("title") or d.name,
                              "now": (full.get("status") or {}).get("now", ""), "steps": len(agent_rows), "done": done, "complete": complete,
                              "active": str(d) == t.get("active_task"), "mtime": int(st.stat().st_mtime)})
    tasks.sort(key=lambda x: -x["mtime"])
    t["tasks"] = tasks
    t["reportFiles"] = report_files(folder)
    if not isinstance(t.get("reports"), dict):
        t.pop("reports", None)


REPORT_NAME = re.compile(r"^(\d{4}-\d{2}-\d{2})[\w.-]*\.md$")


def report_files(folder, limit=8):
    """The team's reports (<team folder>/reports/<date>[-task].md), newest first: date, title, path."""
    d = folder / "reports" if folder else None
    if not d or not d.is_dir():
        return []
    out = []
    for f in d.iterdir():
        m = REPORT_NAME.match(f.name)
        if not m or not f.is_file():
            continue
        try:
            with f.open(encoding="utf-8", errors="replace") as fh:
                first = next((ln.strip() for ln in fh if ln.strip()), "")
        except OSError:
            continue
        out.append({"name": f.name, "date": m.group(1), "title": first.lstrip("#").strip()[:120] or f.name,
                    "path": str(f), "mtime": int(f.stat().st_mtime)})
    return sorted(out, key=lambda r: (r["date"], r["mtime"]), reverse=True)[:limit]


def file_there(pattern, files):
    """A step's file is there: "2-script.md", or "4-final.*" for a step whose file type isn't known in advance."""
    pattern = str(pattern or "").strip("` ")
    if not pattern or pattern in ("—", "-"):
        return False
    return any(n.startswith(pattern.split("*")[0]) for n in files) if "*" in pattern else pattern in files


HUMAN_RE = re.compile(r"^\s*(ты|you|игорь|дубль|take)(?=[\s(:,.—-]|$)", re.IGNORECASE)  # the person's row ("Client Intake" is an agent)
OPEN_RE = re.compile(r"waiting for you|ждёт тебя|ждет тебя|в работе|работает|working|ошибка|не готово|failed|^paused|^пауза", re.IGNORECASE)
DONE_RE = re.compile(r"^\W*(готово|done|сделано|выполнено|completed?)", re.IGNORECASE)  # "✅ done", «сделано»


COLUMN = {"step": re.compile(r"^(#|№|шаг|step|n)$", re.I), "who": re.compile(r"кто|who|агент|agent|исполнитель", re.I),
          "file": re.compile(r"файл|file|результат|output|итог", re.I), "status": re.compile(r"статус|status|состояние|state", re.I)}


def parse_status(text):
    """STATUS.md written by the coordinator: header lines, a | step | who | file | status | table, Сейчас/Дальше.
    Columns are found by the header row when there is one (any order, a table without a file column); a row whose
    Who is empty goes on the step of the row above it."""
    rows, now, nxt, started = [], "", "", ""
    cols = {"step": 0, "who": 1, "file": 2, "status": 3}
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("|") and not re.match(r"^\|[\s:|-]+\|$", s):
            cells = [c.strip() for c in s.strip("|").split("|")]
            if not re.match(r"^\d+\.?$", cells[0]):  # a header row: where each column is
                found = {k: next((i for i, c in enumerate(cells) if rx.search(c)), None) for k, rx in COLUMN.items()}
                if found["who"] is not None and found["status"] is not None:
                    cols = {k: v for k, v in found.items() if v is not None}
                continue
            cell = lambda k: cells[cols[k]] if k in cols and cols[k] < len(cells) else ""  # noqa: E731
            if len(cells) >= 3:
                who = cell("who") or (rows[-1]["who"] if rows else "")
                rows.append({"step": int(cells[0].rstrip(".")), "who": who, "file": cell("file"), "status": cell("status")})
        elif s.lower().startswith("сейчас:") or s.lower().startswith("now:"):
            now = s.split(":", 1)[1].strip()
        elif s.lower().startswith("дальше:") or s.lower().startswith("next:"):
            nxt = s.split(":", 1)[1].strip()
        elif s.lower().startswith("старт:") or s.lower().startswith("started:"):
            started = s.split(":", 1)[1].strip()
    title = text.splitlines()[0].lstrip("# ").strip() if text.strip() else ""
    return {"title": title, "rows": rows, "now": now, "next": nxt, "started": started}


def read_task(folder):
    p = Path(folder)
    if not p.is_dir():
        return None
    files = []
    for f in sorted(p.iterdir()):
        if f.is_file() and not f.name.startswith("."):
            st = f.stat()
            files.append({"name": f.name, "path": str(f), "size": st.st_size, "mtime": int(st.st_mtime)})
    status_file = p / "STATUS.md"
    status = parse_status(read_text_any(status_file)) if status_file.is_file() else None  # PowerShell writes UTF-16
    edits_dir = DATA_DIR / "edits" / p.name
    edits = [{"name": f.name, "path": str(f)} for f in sorted(edits_dir.iterdir())] if edits_dir.is_dir() else []
    return {"name": p.name, "folder": str(p), "files": files, "status": status, "edits": edits}


ONBOARDING = TEAMLY_DIR / "onboarding.json"
ANALYSIS_DIGEST = TEAMLY_DIR / "analysis" / "digest.json"


def read_json(path):
    """A JSON object from disk, or None: missing, unreadable, or not an object (every caller expects an object).
    Bytes go to json.loads, which reads a UTF-8 BOM, UTF-16 and UTF-32 as Windows editors and PowerShell write them."""
    try:
        v = json.loads(Path(path).read_bytes())
    except (OSError, ValueError):
        return None
    return v if isinstance(v, dict) else None


def read_text_any(path):
    """A text file in UTF-8, with or without a BOM, or UTF-16 (PowerShell's default): never an exception for its bytes."""
    raw = Path(path).read_bytes()
    for bom, enc in ((b"\xef\xbb\xbf", "utf-8-sig"), (b"\xff\xfe", "utf-16"), (b"\xfe\xff", "utf-16")):
        if raw.startswith(bom):
            return raw.decode(enc, errors="replace")
    return raw.decode("utf-8", errors="replace")


def ob_team_slug(ob):
    team = (ob or {}).get("team")
    return team.get("slug") if isinstance(team, dict) else None


def read_hidden():
    teams = (read_json(HIDDEN) or {}).get("teams")
    return {x for x in teams if isinstance(x, str)} if isinstance(teams, list) else set()


def shown_teams():
    hidden = read_hidden()
    return [t for t in read_teams() if not (isinstance(t.get("slug"), str) and t["slug"] in hidden)]


def onboarding():
    """What the coordinator wrote while onboarding in the chat, plus the packaged team if there is one."""
    ob = read_json(ONBOARDING)
    if not ob:
        return None
    if isinstance(ob.get("pack"), str) and ob["pack"]:  # the coordinator writes this file: any field can have a wrong type
        ob["packTeam"] = read_json(Path(ob["pack"]) / "team.json")
    t = (read_json(ANALYSIS_DIGEST) or {}).get("totals")
    if isinstance(t, dict) and not ob.get("totals"):
        ob["totals"] = {"sessions": t.get("sessions"), "messages": t.get("turns"), "days": t.get("days")}
    as_list = lambda v: v if isinstance(v, list) else [v] if isinstance(v, (str, dict)) else []  # noqa: E731
    for k in ("approaches", "forks", "picked", "candidates", "jobs", "match", "chain"):  # the panel walks these as lists
        if k in ob:
            ob[k] = as_list(ob[k])
    for x in ob.get("approaches") or []:
        if isinstance(x, dict) and "chain" in x:
            x["chain"] = as_list(x["chain"])
    if isinstance(ob.get("ontology"), dict):
        for k in ("steps", "rules", "quality", "stops", "evidence", "objects", "actions"):
            if k in ob["ontology"]:
                ob["ontology"][k] = as_list(ob["ontology"][k])
    return ob


PARKED = TEAMLY_DIR / "onboarding"  # <slug>.json: each team's onboarding as it was last seen


def keep_onboarding(ob):
    """A copy of the onboarding in progress under its team's slug. When another chat starts a new team (and writes over
    onboarding.json), this one can go on from where it was (SKILL.md 0.3); a finished one leaves no copy."""
    slug = in_setup(ob)[1]
    if not slug or not SLUG_RE.match(slug):
        return
    dst = PARKED / f"{slug}.json"
    if ob.get("step") == "started":
        rec = read_json(TEAMS_DIR / f"{slug}.json") or {}
        if rec.get("agents") or rec.get("pack"):  # a team really came out of it; a stray "started" alone isn't the end
            dst.unlink(missing_ok=True)
        return
    raw = {k: v for k, v in ob.items() if k not in ("packTeam", "totals")}  # what the coordinator wrote, not what we added
    if read_json(dst) != raw:
        PARKED.mkdir(parents=True, exist_ok=True)
        tmp = dst.with_name(f".{slug}.{os.getpid()}.{threading.get_ident()}.tmp")
        tmp.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, dst)


HIDDEN = TEAMLY_DIR / "v2-hidden.json"  # {"teams": [slug, ...]}: teams the v2 panel leaves out (e.g. v1 teams for a clean run)


def state():
    key, key_src = key_and_source()
    refresh_api(key)
    sync_ratings(key)
    teams = shown_teams()
    for i, t in enumerate(teams):
        try:
            t["task"] = read_task(t["active_task"]) if t.get("active_task") else None
            enrich_team(t)
        except Exception as e:  # a broken record shows as an empty floor instead of breaking the whole panel
            teams[i] = {k: t.get(k) for k in ("slug", "name", "area", "folder", "office", "created")}
            teams[i].update({"agents": [], "tasks": [], "goals": [], "task": None, "broken": f"{type(e).__name__}: {e}"[:200]})
    try:
        ob = onboarding()
        if ob:
            keep_onboarding(ob)
    except Exception:  # a broken onboarding.json loses the floor being built, never the whole panel
        ob = None
    with offices_locked():
        book = read_book()
        try:
            setup_office, changed = place_teams(teams, book, ob)
        except Exception:
            book = read_book()
            setup_office, changed = place_teams(teams, book, None)
        if changed:
            save_book(book)
    offices = book["offices"]
    try:
        funnel = track_funnel(bool(key), ob, teams)
    except Exception:  # the funnel must never break the panel
        funnel = None
    return {
        "version": VERSION,
        "update": update_status(),
        "key": {"connected": bool(key), "masked": mask(key) if key else None, "source": key_src, "keyPage": api_config()[1],
                **key_status(key)},
        "wallet": wallet_for(key),
        "walletError": wallet_error_for(key),
        "librarySync": library_sync_error(),
        "runs": runs_for(key),
        "skillsDir": str(SKILLS_DIR),
        "sandbox": SKILLS_DIR.resolve() != (Path.home() / ".claude" / "skills").resolve(),
        "installed": installed(),
        "catalog": catalog(),
        "library": library(),
        "approaches": approaches(),
        "teams": teams,
        "founder": read_json(FOUNDER),
        "funnel": funnel,
        "offices": offices,
        "setupOffice": setup_office,
        "onboarding": ob,
        "demoReel": str(DEMO_REEL) if DEMO_REEL.is_file() else None,
    }


def wallet_for(key):
    with API_LOCK:
        return dict(API["wallet"]) if key and API["key"] == key and API["wallet"] else None


def wallet_error_for(key):
    with API_LOCK:
        return dict(API["walletError"]) if key and API["key"] == key and API["walletError"] else None


def library_sync_error():
    with REMOTE_LOCK:
        return dict(SYNC["error"]) if SYNC["error"] else None


def runs_for(key):
    with API_LOCK:
        return list(API["runs"]) if key and API["key"] == key and API["runs"] is not None else None


def allowed_file(path):
    """Files the panel may open: anything inside a team's active task folder, our saved edits, the demo reel."""
    try:
        p = Path(path).resolve(strict=True)
    except (OSError, RuntimeError):
        return None
    teams = read_teams()
    places = [t.get(k) for t in teams for k in ("active_task", "folder", "pack")]  # team folders: agents, ontology, tasks
    places.append((read_json(ONBOARDING) or {}).get("pack"))
    roots = [Path(x).resolve() for x in places if isinstance(x, str) and x]
    roots.append((DATA_DIR / "edits").resolve())
    roots.append(LIBRARY_DIR.resolve())
    roots.append(MY_LIBRARY_DIR.resolve())
    if DEMO_REEL.is_file() and p == DEMO_REEL.resolve():
        return p
    home = Path.home().resolve()
    roots = [r for r in roots if r != home and r not in home.parents]  # a team made in ~ must not open all of ~
    for r in roots:
        if p.is_file() and (p == r or r in p.parents):
            # hidden files (.env, .git, keys) are never shown, even inside a team folder; hired agents live in .claude
            if any(part.startswith(".") and part != ".claude" for part in p.relative_to(r).parts):
                return None
            return p
    return None


# What /api/file shows as itself: pictures, sound and video the panel draws. Anything that can carry script or markup
# (html, svg, xml, js) goes out as plain text and the rest as a download, so a file that came with someone else's
# agent never runs as a page of the panel, with the panel's powers.
INLINE = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
          ".avif": "image/avif", ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
          ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".ogg": "audio/ogg"}
AS_TEXT = {".md", ".txt", ".json", ".jsonl", ".csv", ".tsv", ".yaml", ".yml", ".toml", ".log", ".html", ".htm", ".xhtml",
           ".svg", ".xml", ".js", ".mjs", ".css", ".py", ".sh"}


# ---------- small writes ----------
def save_rating(body):
    rating = int(body.get("rating", 0))
    if not 1 <= rating <= 5:
        raise ValueError("rating must be 1-5")
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    rec = {
        "at": int(time.time()),
        "task": str(body.get("task", ""))[:200],
        "rating": rating,
        "blocker": str(body.get("blocker", ""))[:2000],
        "agents": [str(a)[:64] for a in body.get("agents", [])][:10],
    }
    with open(DATA_DIR / "ratings.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    return rec


def save_edit(body):
    task = str(body.get("task", ""))
    name = str(body.get("file", ""))
    text = str(body.get("text", ""))
    if not re.match(r"^[A-Za-z0-9._-]{1,80}$", task) or not FILE_RE.match(name):
        raise ValueError("bad task or file name")
    d = DATA_DIR / "edits" / task
    d.mkdir(parents=True, exist_ok=True)
    (d / name).write_text(text[:200_000], encoding="utf-8")
    return {"path": str(d / name)}


# ---------- http ----------
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PANEL_DIR), **kwargs)

    def log_message(self, fmt, *args):  # keep the background log quiet
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _json(self, code, body):
        data = json.dumps(json_safe(body), ensure_ascii=False, allow_nan=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _host_ok(self):
        """A page on another site can point its own name at 127.0.0.1 (DNS rebinding); its requests then carry
        that name in Host. Only our own names pass."""
        port = self.server.server_address[1]
        return self.headers.get("Host", "") in (f"127.0.0.1:{port}", f"localhost:{port}")

    def _from_panel(self):
        origin = self.headers.get("Origin")
        host = self.headers.get("Host", "")
        same = self._host_ok() and origin in (f"http://{host}", None) and self.headers.get("X-Teamly-Panel") == "1"
        return same

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 400_000:
            raise ValueError("body too large")
        return json.loads(self.rfile.read(n) or b"{}")

    def _send_file(self, p):
        suffix = p.suffix.lower()
        ctype = INLINE.get(suffix) or ("text/plain; charset=utf-8" if suffix in AS_TEXT else "application/octet-stream")
        size = p.stat().st_size
        rng = self.headers.get("Range")
        start, end = 0, size - 1
        m = re.match(r"bytes=(\d*)-(\d*)", rng or "")
        if m and (m.group(1) or m.group(2)):
            if m.group(1):
                start = int(m.group(1))
                end = int(m.group(2)) if m.group(2) else size - 1
            else:
                start = max(0, size - int(m.group(2)))
            end = min(end, size - 1)
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        else:
            self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "sandbox; default-src 'none'")  # opened as a page: no script, no panel
        if ctype == "application/octet-stream":
            self.send_header("Content-Disposition", "attachment")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        with open(p, "rb") as f:
            f.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = f.read(min(1 << 16, left))
                if not chunk:
                    break
                self.wfile.write(chunk)
                left -= len(chunk)

    def do_GET(self):
        url = urlparse(self.path)
        if not self._host_ok():
            return self._json(403, {"error": "open the panel at 127.0.0.1 or localhost"})
        if url.path == "/api/health":
            return self._json(200, {"ok": True, "version": VERSION})
        if url.path == "/api/state":
            return self._json(200, state())
        if url.path == "/api/ui":
            return self._json(200, read_json(UI_FILE) or {})
        if url.path == "/api/file":
            p = allowed_file((parse_qs(url.query).get("path") or [""])[0])
            if not p:
                return self._json(404, {"error": "not found"})
            try:
                return self._send_file(p)
            except (BrokenPipeError, ConnectionResetError):
                return None
        if url.path.startswith("/api/"):
            return self._json(404, {"error": "unknown endpoint"})
        return super().do_GET()

    def _mutate(self, method):
        if not self._from_panel():
            return self._json(403, {"error": "only the Teamly panel can do this"})
        path = urlparse(self.path).path
        try:
            body = self._body() if method == "POST" else {}
            if path == "/api/key" and method == "POST":
                return self._json(200, save_key(str(body.get("key", "")).strip()))
            if path == "/api/connect" and method == "POST":
                return self._json(200, connect(str(body.get("key", "")).strip(), str(body.get("state", ""))))
            if path == "/api/open-url" and method == "POST":
                return self._json(200, open_url(str(body.get("which", ""))))
            if path == "/api/key" and method == "DELETE":
                CREDENTIALS.unlink(missing_ok=True)
                key, src = key_and_source()  # a key from TEAMLY_API_KEY or ~/.env is still there: say where it comes from
                return self._json(200, {"connected": bool(key), "source": src})
            if path == "/api/hire" and method == "POST":
                return self._json(200, hire(str(body.get("slug", ""))))
            if path == "/api/fire" and method == "POST":
                return self._json(200, fire(str(body.get("slug", ""))))
            if path == "/api/rating" and method == "POST":
                return self._json(200, save_rating(body))
            if path == "/api/edit" and method == "POST":
                return self._json(200, save_edit(body))
            if path == "/api/feedback" and method == "POST":
                return self._json(200, save_feedback(body))
            if path == "/api/ui" and method == "POST":
                return self._json(200, save_ui(body))
            if path == "/api/ui" and method == "DELETE":
                UI_FILE.unlink(missing_ok=True)
                return self._json(200, {"saved": False})
            if path == "/api/offices" and method == "POST":
                return self._json(200, new_office(body.get("name", ""), body.get("setup") is True))
            if path == "/api/offices/place" and method == "POST":
                return self._json(200, move_team(body.get("team"), body.get("office")))
            if path == "/api/offices/next" and method == "POST":
                return self._json(200, next_office(body.get("office")))
            if path == "/api/open-chat" and method == "POST":
                return self._json(200, open_chat(body.get("session")))
            if path == "/api/wallet/refresh" and method == "POST":  # the panel opened the wallet or came back after a top up
                key = key_and_source()[0]
                with API_LOCK:
                    fresh = time.time() - API["forcedAt"] >= 5
                    if fresh:
                        API["forcedAt"] = time.time()
                if key and fresh:
                    refresh_api(key, force=True)
                return self._json(200, {"ok": True, "refreshing": bool(key and fresh and key.startswith(REAL_KEY))})
            if path == "/api/shutdown" and method == "POST":  # the coordinator restarts the panel after an update
                self._json(200, {"ok": True, "version": VERSION})  # the whole answer goes out before the server stops
                self.wfile.flush()
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                return None
            return self._json(404, {"error": "unknown endpoint"})
        except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError, http.client.HTTPException) as e:
            return self._json(400, {"error": str(e)})

    def do_POST(self):
        self._mutate("POST")

    def do_DELETE(self):
        self._mutate("DELETE")


def check():
    """Install self-test: the files the panel needs are here, Python can read the library, ~/.teamly is writable."""
    need = ["SKILL.md", "panel/index.html", "panel/app.js", "panel/vendor/tailwindcss-browser-4.1.18.js",
            "panel/vendor/fonts/fonts.css", "panel/assets/building/lobby.webp", "approaches/goals.json"]
    missing = [p for p in need if not (HERE / p).exists()]
    try:
        TEAMLY_DIR.mkdir(parents=True, exist_ok=True)
        probe = TEAMLY_DIR / ".write-test"
        probe.write_text("ок", encoding="utf-8")
        writable = probe.read_text(encoding="utf-8") == "ок"
        probe.unlink()
    except OSError:
        writable = False
    s = state()
    ok = not missing and writable and sys.version_info >= (3, 9)
    print(json.dumps({"ok": ok, "version": VERSION, "python": sys.version.split()[0], "platform": sys.platform,
                      "folder": str(HERE), "teamlyDir": str(TEAMLY_DIR), "writable": writable, "missing": missing,
                      "library": len(s["library"]), "packaging": package_agent is not None,
                      "keyConnected": s["key"]["connected"], "teams": len(s["teams"])}, ensure_ascii=False, indent=1))
    return 0 if ok else 1


def port_busy(port):
    try:
        socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
        return True
    except OSError:
        return False


def stop(port):
    """Asks the panel server on this port to stop, the way the panel would, and waits until the port is free."""
    req = urllib.request.Request(f"http://127.0.0.1:{port}/api/shutdown", data=b"{}", method="POST",
                                 headers={"Origin": f"http://127.0.0.1:{port}", "X-Teamly-Panel": "1",
                                          "Content-Type": "application/json"})
    was = None
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            try:
                was = json.loads(r.read() or b"{}").get("version")
            except (ValueError, http.client.HTTPException):
                was = "?"  # it answered and is going down; only the answer got cut
    except urllib.error.HTTPError as e:  # a Teamly older than 0.5.0 has no /api/shutdown: close the Claude app to stop it
        print(json.dumps({"ok": False, "port": port, "error": f"the server on port {port} answered {e.code}: it is older than "
                          "0.5.0 or not Teamly. Close the Claude app (that stops it), open it again"}))
        return 1
    except (urllib.error.URLError, OSError, http.client.HTTPException):
        if not port_busy(port):
            print(json.dumps({"ok": True, "port": port, "stopped": None, "note": "nothing was running"}))
            return 0
        was = "?"
    for _ in range(50):
        if not port_busy(port):
            break
        time.sleep(0.1)
    if port_busy(port):
        print(json.dumps({"ok": False, "port": port, "error": f"the server on port {port} is still running"}))
        return 1
    print(json.dumps({"ok": True, "port": port, "stopped": was}))
    return 0


def main(argv):
    global SKILLS_DIR
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # --status prints Cyrillic; Windows consoles default to cp1252
    port = DEFAULT_PORT
    if "--port" in argv:
        port = int(argv[argv.index("--port") + 1])
    if "--skills-dir" in argv:
        SKILLS_DIR = Path(os.path.expanduser(argv[argv.index("--skills-dir") + 1]))
    if "--status" in argv:
        print(json.dumps(json_safe(state()), ensure_ascii=False, indent=2, allow_nan=False), flush=True)
        # state() may have started the key check in a daemon thread; Python 3.12 can segfault at a normal exit while
        # that thread is inside a network call (exit code -11 after a complete answer), so leave without finalizing
        os._exit(0)
    if "--check" in argv:
        sys.exit(check())
    if "--stop" in argv:
        sys.exit(stop(port))
    try:
        srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    except OSError as e:
        print(f"Port {port} is taken by another program ({e.strerror}). If it is not Teamly, close it or start with --port {port + 1}.",
              file=sys.stderr, flush=True)
        sys.exit(2)
    print(f"Teamly v2 panel {VERSION}: http://127.0.0.1:{port}/  (skills dir: {SKILLS_DIR})", flush=True)
    move_old_data()
    start_update_checks()
    threading.Thread(target=restart_when_replaced, args=(srv,), daemon=True).start()
    parent = os.environ.get("TEAMLY_PANEL_PARENT")
    if os.name == "nt" and parent and parent.isdigit():
        threading.Thread(target=exit_with_parent, args=(int(parent),), daemon=True).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    if RESTART.is_set():
        srv.server_close()
        env = {**os.environ, "TEAMLY_PANEL_PARENT": str(os.getpid())}
        sys.exit(subprocess.call([sys.executable, str(HERE / "server.py"), *sys.argv[1:]], env=env))


if __name__ == "__main__":
    main(sys.argv[1:])
