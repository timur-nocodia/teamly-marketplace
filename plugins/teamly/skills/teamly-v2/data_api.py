#!/usr/bin/env python3
"""Teamly Data API for the coordinator and the agents: thousands of data tools (scrapers, search, enrichment, media)
behind the person's Teamly key, paid from their Teamly Dollars. The key is read where the panel keeps it and is never
printed. Every command prints one JSON answer; a tool's output goes to a file, never into the chat.

  python3 data_api.py balance                                    what is left in the wallet
  python3 data_api.py discover "instagram posts" [--limit 5]     find tools by a short noun phrase (free)
  python3 data_api.py inspect <provider> <endpoint> [--out f]    the tool's input schema and price (free)
  python3 data_api.py run <provider> <endpoint> --input <file.json> --yes [--out <file.json>] [--wait 120]
                                                                 run it; paid, so --yes = the person agreed to the price
  python3 data_api.py status <runId> [--out <file.json>]         a slow run's state, cost and result
  python3 data_api.py runs [--limit 10]                          recent runs and what each cost
  python3 data_api.py stop <runId>                               stop a run that says it is stoppable

--input is {"pathParams": {…}, "queryParams": {…}, "body": …}: exactly what inspect shows, nothing guessed.
The base address: TEAMLY_API_BASE or ~/.teamly/config.json "apiBase" (the Teamly v2 API, teamly-v2.fly.dev, by default).
Exit code: 0 done, 1 the API or the input said no, 2 usage.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

API_BASE = "https://teamly-v2.fly.dev/v1"
TEAMLY = Path.home() / ".teamly"
DONE = {"COMPLETED", "FAILED", "BLOCKED", "STOPPED", "TIMED_OUT"}
POLL = float(os.environ.get("TEAMLY_DATA_POLL") or 5)   # seconds between looks at a slow run (the API asks for 5-10)
SAID = {  # what an error means, in words a person can act on (the API's own message is added after it)
    400: "the input doesn't fit the tool: inspect it again and fix the field named (free)",
    401: "the Teamly key is missing or not accepted: press Sign in to Teamly in the panel",
    402: "not enough Teamly Dollars: top up on the Teamly site",
    403: "this tool isn't available with this key, or it costs more than one call may: pick another one",
    404: "no such tool or run",
    422: "the price isn't known right now, so the run didn't start: pick another tool",
    429: "too many requests: wait and try again",
    502: "Teamly or the tool's provider is having a moment: try again in a minute",
    503: "Teamly or the tool's provider is having a moment: try again in a minute",
}


def out(obj, code=0):
    print(json.dumps(obj, ensure_ascii=False, indent=1))
    return code


def config():
    try:
        c = json.loads((TEAMLY / "config.json").read_bytes())  # bytes: a BOM or UTF-16 from Windows reads too
    except (OSError, ValueError):
        return {}
    return c if isinstance(c, dict) else {}


def base():
    return str(os.environ.get("TEAMLY_API_BASE") or config().get("apiBase") or API_BASE).rstrip("/")


def key():
    """The person's key where the panel looks for it: ~/.teamly/credentials.json, TEAMLY_API_KEY, the line in ~/.env."""
    try:
        raw = (TEAMLY / "credentials.json").read_bytes()
        try:
            data = json.loads(raw)
        except ValueError:
            data = raw.decode("utf-8", "replace").strip()
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


def call(method, path, body=None, timeout=60):
    """(status, answer, headers). Status 0: the API can't be reached from here."""
    k = key()
    url = base() + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Authorization": f"Bearer {k}", "Accept": "application/json", "User-Agent": "Teamly-v2-data/1"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, parse(r.read()), dict(r.headers)
    except urllib.error.HTTPError as e:
        with e:
            return e.code, parse(e.read()), dict(e.headers or {})
    except (urllib.error.URLError, OSError):
        pass
    if not shutil.which("curl"):  # python.org Python on macOS often has no certificates: curl uses the system ones
        return 0, None, {}
    tmp = Path(tempfile.mkdtemp(prefix="teamly-data-"))
    try:
        cmd = ["curl", "-s", "-m", str(timeout), "-X", method, "-w", "\n%{http_code}", "-K", "-", url]
        if data is not None:
            (tmp / "body.json").write_bytes(data)
            cmd[-1:-1] = ["--data-binary", f"@{tmp / 'body.json'}"]
        conf = f'header = "Authorization: Bearer {k}"\nheader = "Accept: application/json"\n' + \
               ('header = "Content-Type: application/json"\n' if data is not None else "")
        r = subprocess.run(cmd, input=conf, capture_output=True, text=True, timeout=timeout + 5)
        text, _, status = r.stdout.rpartition("\n")
        return (int(status) if status.isdigit() else 0), parse(text.encode("utf-8")), {}
    except (subprocess.SubprocessError, OSError):
        return 0, None, {}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def parse(raw):
    try:
        return json.loads(raw or b"null")
    except ValueError:
        return None


def failed(status, answer, headers=None):
    msg = answer.get("message") if isinstance(answer, dict) else None
    words = SAID.get(status) or ("Teamly can't be reached from this computer" if status == 0 else f"the API answered {status}")
    res = {"ok": False, "code": status, "error": words + (f" ({msg})" if msg else "")}
    wait = (headers or {}).get("Retry-After")
    if status == 429 and wait:
        res["retryAfter"] = wait
    return out(res, 1)


def save(obj, path):
    p = Path(path).expanduser()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return str(p.resolve())


def summary(run, path):
    """What a finished (or still running) run says, without its output: that is in the file."""
    run = run if isinstance(run, dict) else {}
    provider = run.get("providerResponse") if isinstance(run.get("providerResponse"), dict) else {}
    cost = run.get("cost") if isinstance(run.get("cost"), dict) else {}
    return {"ok": run.get("status") == "COMPLETED" and provider.get("httpStatus", 200) == 200, "runId": run.get("runId"),
            "status": run.get("status"), "httpStatus": provider.get("httpStatus"), "cost": cost.get("value"),
            "currency": cost.get("currency"), "stoppable": run.get("stoppable"), "out": path}


def opts(args):
    o, rest = {}, []
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--yes":
            o["yes"] = True
        elif a.startswith("--") and i + 1 < len(args):
            o[a[2:]] = args[i + 1]
            i += 1
        else:
            rest.append(a)
        i += 1
    return o, rest


def main(argv):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if not argv or argv[0] not in ("balance", "discover", "inspect", "run", "status", "runs", "stop"):
        print(__doc__)
        return 2
    cmd, (o, rest) = argv[0], opts(argv[1:])
    k = key()
    if not k or not k.startswith("tly_data_"):
        return out({"ok": False, "code": 401, "error": SAID[401]}, 1)

    if cmd == "balance":
        status, a, h = call("GET", "/wallet/balance")
        if status != 200 or not isinstance(a, dict):
            return failed(status, a, h)
        bal, held = a.get("balance") or {}, a.get("held") or {}
        return out({"ok": True, "balance": bal.get("value"), "held": held.get("value"), "currency": bal.get("currency", "USD")})

    if cmd == "discover":
        if not rest:
            return out({"ok": False, "error": 'usage: discover "<what you need, a short noun phrase>" [--limit 5]'}, 2)
        body = {"query": " ".join(rest), "limit": int(o.get("limit", 5))}
        if "min-score" in o:
            body["minScore"] = float(o["min-score"])
        status, a, h = call("POST", "/discover", body)
        if status != 200:
            return failed(status, a, h)
        return out({"ok": True, **a} if isinstance(a, dict) else {"ok": True, "results": a})

    if cmd == "inspect":
        if len(rest) < 2:
            return out({"ok": False, "error": "usage: inspect <provider> <endpoint>"}, 2)
        status, a, h = call("POST", "/inspect", {"provider": rest[0], "endpoint": rest[1]})
        if status != 200:
            return failed(status, a, h)
        if o.get("out"):
            return out({"ok": True, "out": save(a, o["out"])})
        return out({"ok": True, **a} if isinstance(a, dict) else {"ok": True, "answer": a})

    if cmd == "run":
        if len(rest) < 2 or "input" not in o:
            return out({"ok": False, "error": "usage: run <provider> <endpoint> --input <file.json> --yes [--out <file.json>]"}, 2)
        if not o.get("yes"):
            return out({"ok": False, "error": "a run is paid: show the person the price from inspect, ask, then run again with --yes"}, 1)
        try:
            payload = json.loads(Path(o["input"]).expanduser().read_bytes())
        except (OSError, ValueError) as e:
            return out({"ok": False, "error": f"--input must be a JSON file with pathParams / queryParams / body: {e}"}, 1)
        if not isinstance(payload, dict) or not set(payload) <= {"pathParams", "queryParams", "body"}:
            return out({"ok": False, "error": "--input holds only pathParams, queryParams and body, as inspect shows them"}, 1)
        status, a, h = call("POST", "/run", {"provider": rest[0], "endpoint": rest[1], "input": payload}, timeout=150)
        if status not in (200, 201, 202) or not isinstance(a, dict):
            return failed(status, a, h)
        wait_until = time.time() + float(o.get("wait", 120))
        while a.get("status") not in DONE and a.get("runId") and time.time() < wait_until:
            time.sleep(POLL)
            s2, a2, h2 = call("GET", f"/runs/{a['runId']}")
            if s2 == 200 and isinstance(a2, dict):
                a = a2
            elif s2 != 0:
                return failed(s2, a2, h2)
        path = save(a, o.get("out") or f"data-api-{a.get('runId') or int(time.time())}.json")
        res = summary(a, path)
        if a.get("status") not in DONE:
            res["next"] = f"still {a.get('status')}: python3 data_api.py status {a.get('runId')} --out {path}"
        return out(res, 0 if res["ok"] or a.get("status") not in DONE else 1)

    if cmd == "status":
        if not rest:
            return out({"ok": False, "error": "usage: status <runId> [--out <file.json>]"}, 2)
        status, a, h = call("GET", f"/runs/{rest[0]}")
        if status != 200 or not isinstance(a, dict):
            return failed(status, a, h)
        return out(summary(a, save(a, o["out"]) if o.get("out") else None))

    if cmd == "runs":
        status, a, h = call("GET", f"/runs?limit={int(o.get('limit', 10))}")
        if status != 200 or not isinstance(a, dict):
            return failed(status, a, h)
        rows = []
        for r in a.get("items") or []:
            if isinstance(r, dict):
                cost = r.get("cost") if isinstance(r.get("cost"), dict) else {}
                rows.append({k2: r.get(k2) for k2 in ("runId", "provider", "endpoint", "status", "createdAt")} | {"cost": cost.get("value")})
        return out({"ok": True, "runs": rows})

    if not rest:
        return out({"ok": False, "error": "usage: stop <runId>"}, 2)
    status, a, h = call("POST", f"/runs/{rest[0]}/stop")
    return out({"ok": True, **(a if isinstance(a, dict) else {})}) if status in (200, 202) else failed(status, a, h)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
