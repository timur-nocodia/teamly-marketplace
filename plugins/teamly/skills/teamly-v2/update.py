#!/usr/bin/env python3
"""Teamly v2 updates: is a newer version out, install it, roll back.

The channel is one file on the Teamly site, https://teamly.to/skill/latest.json (tools/build_release.py writes it):
  {"version": "0.5.1", "minVersion": "0.4.0", "url": "https://teamly.to/skill/teamly-v2-0.5.1.zip",
   "sha256": "<64 hex>", "size": 8457004, "notes": {"en": "…", "ru": "…"}, "date": "2026-10-26"}
Only https addresses on teamly.to are trusted (127.0.0.1 and localhost too, for tests). The archive must match the
sha256 and carry the version the manifest names. Installing runs the new version's own install.py: it puts the new
copy in place only once it is complete, the old copy goes to ~/.teamly/backup/skills-<time>/, teams and data in
~/.teamly stay. One update at a time (~/.teamly/update.lock); installs and rollbacks share ~/.teamly/install.lock.
Every command prints one JSON answer, whatever happens. Another address: TEAMLY_UPDATE_URL or
~/.teamly/config.json "updateUrl"; "off" turns the checks off.
Usage: python3 update.py check        JSON: current, latest, available, required, notes
       python3 update.py install      download, check, install; JSON with from / to / backup
       python3 update.py rollback     put the previous version back (the current one goes to backup)
After install or rollback the panel server still runs the old code: python3 server.py --stop, then start it again.
"""
import hashlib
import http.client
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
import zipfile
from pathlib import Path
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from install import WORK_PREFIX, Busy, Lock, files_of, keep_old, recover, swap, write_json  # noqa: E402  (same package)
# the channel is a file in the public repository of the marketplace: the publish script writes it next to the plugin
DEFAULT_URL = "https://raw.githubusercontent.com/timur-nocodia/teamly-marketplace/main/latest.json"
MARKETPLACE_PATH = "/timur-nocodia/teamly-marketplace/"
VERSION_RE = re.compile(r"^\d{1,4}\.\d{1,4}\.\d{1,6}$")
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
MAX_MANIFEST, MAX_ZIP = 64_000, 150_000_000
MAX_FILES, MAX_BYTES = 5000, 300_000_000   # the package is ~240 files, ~10 MB unpacked
NAMES = ("teamly-v2", "teamly-forge")


def teamly_dir():
    return Path.home() / ".teamly"


def skills_dir():
    return Path.home() / ".claude" / "skills"


def version_of(folder):
    """The VERSION line of a package's server.py (None when the folder isn't a Teamly v2 package)."""
    try:
        m = re.search(r'^VERSION = "([^"]+)"', (Path(folder) / "server.py").read_text(encoding="utf-8"), re.MULTILINE)
    except OSError:
        return None
    return m.group(1) if m and VERSION_RE.match(m.group(1)) else None


def vtuple(v):
    return tuple(int(x) for x in v.split("."))


def manifest_url():
    """Where to look for new versions; None when the person (or a test) turned the checks off."""
    try:
        config = json.loads((teamly_dir() / "config.json").read_bytes())  # bytes: a BOM or UTF-16 from Windows reads too
    except (OSError, ValueError):
        config = {}
    url = os.environ.get("TEAMLY_UPDATE_URL") or (config.get("updateUrl") if isinstance(config, dict) else None) or DEFAULT_URL
    return None if str(url).strip().lower() == "off" else str(url).strip()


def trusted(url):
    """https on teamly.to (and its subdomains) and the marketplace repository; http(s) on this computer for tests.
    Nothing else is ever downloaded."""
    u = urlparse(url or "")
    host = (u.hostname or "").lower()
    if host in ("127.0.0.1", "localhost"):
        return u.scheme in ("http", "https")
    if host == "raw.githubusercontent.com":
        return u.scheme == "https" and u.path.startswith(MARKETPLACE_PATH)
    return u.scheme == "https" and (host == "teamly.to" or host.endswith(".teamly.to"))


def http_get(url, limit, timeout=15, version=None):
    """Bytes from a trusted address, at most `limit`. Redirects must stay trusted too."""
    if not trusted(url):
        raise ValueError(f"not a Teamly address: {url}")
    req = urllib.request.Request(url, headers={"User-Agent": f"Teamly-v2/{version or version_of(HERE) or '?'}"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            if not trusted(r.geturl()):
                raise ValueError(f"the download was sent to another address: {r.geturl()}")
            data = r.read(limit + 1)
    except urllib.error.HTTPError as e:
        raise ValueError(f"{url} answered {e.code}")
    except http.client.HTTPException:  # the answer was cut off on the way
        raise ValueError(f"the download from {url} was cut off: try again")
    except (urllib.error.URLError, OSError) as e:
        data = curl_get(url, limit, timeout, e)
    if len(data) > limit:
        raise ValueError(f"{url} is bigger than expected")
    return data


def curl_get(url, limit, timeout, first_error):
    # python.org Python on macOS often has no certificates; curl uses the system ones
    if not shutil.which("curl") or urlparse(url).scheme != "https":
        raise ValueError(f"can't reach {url}: {getattr(first_error, 'reason', first_error)}")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "body"
        r = subprocess.run(["curl", "-sS", "-f", "-L", "--proto", "=https", "--proto-redir", "=https", "--max-filesize",
                            str(limit), "-m", str(timeout * 4), "-o", str(out), "-w", "%{url_effective}", url],
                           capture_output=True, text=True, timeout=timeout * 4 + 5)
        if r.returncode or not out.is_file():
            raise ValueError(f"can't reach {url}: {(r.stderr or '').strip()[:200] or getattr(first_error, 'reason', first_error)}")
        if not trusted(r.stdout.strip()):
            raise ValueError(f"the download was sent to another address: {r.stdout.strip()}")
        return out.read_bytes()


def clean_text(s, n=300):
    """Release notes are text from a web page: no control characters, short."""
    return re.sub(r"[\x00-\x08\x0b-\x1f\x7f​-‏‪-‮⁠]", "", str(s))[:n].strip()


def fetch_manifest(url=None):
    url = url or manifest_url()
    if not url:
        raise ValueError("update checks are turned off")
    raw = http_get(url, MAX_MANIFEST)
    try:
        m = json.loads(raw)
    except ValueError:
        m = None
    if not isinstance(m, dict):
        raise ValueError(f"{url} is not a Teamly update file")
    version, minimum = str(m.get("version", "")), str(m.get("minVersion") or "0.0.0")
    if not VERSION_RE.match(version) or not VERSION_RE.match(minimum):
        raise ValueError("the update file has no proper version")
    # a release of the plugin is installed by Claude (claude plugin update): its file has no archive, only the version
    archive = str(m.get("url") or "")
    if archive and (not trusted(archive) or not archive.endswith(".zip")):
        raise ValueError("the update file points outside teamly.to")
    if archive and not SHA_RE.match(str(m.get("sha256", ""))):
        raise ValueError("the update file has no sha256")
    notes = m.get("notes")
    notes = {k: clean_text(v) for k, v in notes.items() if k in ("en", "ru") and isinstance(v, str)} if isinstance(notes, dict) \
        else ({"en": clean_text(notes)} if isinstance(notes, str) else {})
    size = m.get("size")
    return {"version": version, "minVersion": minimum, "url": archive or None, "sha256": m.get("sha256") if archive else None, "notes": notes,
            "size": size if isinstance(size, int) and 0 < size <= MAX_ZIP else None, "date": clean_text(m.get("date") or "", 20)}


def status(manifest, current):
    # a minVersion above the release itself is a typo: it would ask for an update nobody can install, so it is ignored
    floor = vtuple(manifest["minVersion"]) if vtuple(manifest["minVersion"]) <= vtuple(manifest["version"]) else (0, 0, 0)
    return {"current": current, "latest": manifest["version"], "available": vtuple(manifest["version"]) > vtuple(current),
            "required": vtuple(current) < floor, "notes": manifest["notes"], "date": manifest["date"]}


def safe_extract(zip_path, dest):
    """The release archive holds one folder, teamly-v2/: nothing outside it, no absolute or ../ paths, no links."""
    with zipfile.ZipFile(zip_path) as z:
        infos = z.infolist()
        if len(infos) > MAX_FILES or sum(i.file_size for i in infos) > MAX_BYTES:
            raise ValueError("the update archive is too big")
        for i in infos:
            name = i.filename.replace("\\", "/")
            parts = [x for x in name.split("/") if x]
            if name.startswith("/") or ".." in parts or (parts and ":" in parts[0]) or not parts or parts[0] != "teamly-v2":
                raise ValueError(f"unexpected path in the update archive: {i.filename}")
            if (i.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError(f"a link in the update archive: {i.filename}")
        z.extractall(dest)


def out(ok, code=None, **info):
    print(json.dumps({"ok": ok, **info}, ensure_ascii=False, indent=1))
    return code if code is not None else (0 if ok else 1)


def developer_link():
    return next((str(skills_dir() / n) for n in NAMES if (skills_dir() / n).is_symlink()), None)


def cmd_check():
    current = version_of(HERE)
    try:
        return out(True, **status(fetch_manifest(), current))
    except ValueError as e:
        return out(False, current=current, error=str(e))


def cmd_install(force=False):
    try:
        m = fetch_manifest()
    except ValueError as e:
        return out(False, current=version_of(HERE), error=str(e))
    try:
        with Lock(teamly_dir() / "update.lock"):
            return install_version(m, force)
    except Busy:
        return out(False, busy=True, current=version_of(HERE),
                   error="another chat is updating Teamly right now: wait a minute, then check the version again")


def install_version(m, force):
    current = version_of(HERE)  # read under the lock: another chat may have just updated
    st = status(m, current)
    if not st["available"] and not force:
        return out(True, upToDate=True, **st)
    link = developer_link()
    if link:
        return out(False, error=f"{link} is a developer link: update that folder with git", **st)
    if not m["url"]:
        return out(False, error="this release has no archive: Teamly installed as a Claude plugin is updated with "
                                "`claude plugin update teamly@teamly`", **st)
    run = teamly_dir() / "updates" / f"{m['version']}-{os.getpid()}"  # this run's own folder
    zp, unpacked = run / f"teamly-v2-{m['version']}.zip", run / "unpacked"
    try:
        run.mkdir(parents=True, exist_ok=True)
        data = http_get(m["url"], MAX_ZIP, timeout=60, version=current)
        if hashlib.sha256(data).hexdigest() != m["sha256"]:
            raise ValueError("the downloaded archive doesn't match the update file (sha256): nothing was changed")
        zp.write_bytes(data)
        safe_extract(zp, unpacked)
        got = version_of(unpacked / "teamly-v2")
        if got != m["version"]:
            raise ValueError(f"the archive holds version {got}, not {m['version']}: nothing was changed")
        r = subprocess.run([sys.executable, str(unpacked / "teamly-v2" / "install.py")], capture_output=True, text=True,
                           encoding="utf-8", errors="replace", env={**os.environ, "PYTHONIOENCODING": "utf-8"}, timeout=300)
        try:
            res = json.loads(r.stdout)
        except ValueError:
            raise ValueError(f"the installer of {m['version']} failed: {(r.stdout + r.stderr)[-600:]}")
    except (ValueError, OSError, zipfile.BadZipFile, subprocess.SubprocessError) as e:
        return out(False, error=str(e), **st)
    finally:
        shutil.rmtree(run, ignore_errors=True)
    if not isinstance(res, dict) or res.get("check") is None:  # it stopped before putting anything in place
        return out(False, error=f"the installer of {m['version']} failed: {res.get('error') if isinstance(res, dict) else res}",
                   installed=current, **st)
    if not res.get("ok"):
        return out(False, error="the new version installed, but its self-check failed", installer=res, **st)
    if res.get("backup"):
        write_json(teamly_dir() / "update.json", {"from": current, "to": m["version"], "at": int(time.time()), "backup": res["backup"]})
    return out(True, **{"from": current, "to": m["version"], "backup": res.get("backup"), "notes": m["notes"],
                        "next": "restart the panel: server.py --stop, then start teamly-v2 again; re-read SKILL.md"})


def read_update_record():
    try:
        rec = json.loads((teamly_dir() / "update.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return rec if isinstance(rec, dict) else {}


def cmd_rollback():
    link = developer_link()
    if link:
        return out(False, error=f"{link} is a developer link: change that folder with git")
    try:
        with Lock(teamly_dir() / "install.lock"):
            return roll_back()
    except Busy:
        return out(False, busy=True, error="a Teamly install or rollback is running right now: try again in a minute")


def roll_back():
    skills = skills_dir()
    recover(skills, list(NAMES))
    current = version_of(skills / "teamly-v2")
    backups = sorted((p for p in (teamly_dir() / "backup").glob("skills-*") if version_of(p / "teamly-v2")),
                     key=lambda p: p.stat().st_mtime, reverse=True) if (teamly_dir() / "backup").is_dir() else []
    last = read_update_record().get("backup")
    candidates = ([Path(last)] if isinstance(last, str) and last else []) + backups
    # the version before this one: the backup the last install made, else the newest backup of another version
    src = next((p for p in candidates if version_of(p / "teamly-v2") and version_of(p / "teamly-v2") != current), None)
    if not src:
        return out(False, error="there is no previous version to go back to")
    work = Path(tempfile.mkdtemp(prefix=WORK_PREFIX, dir=skills))
    names = [n for n in NAMES if (src / n).is_dir()]  # a part the backup doesn't have stays as it is
    try:
        staged = {}
        for name in names:
            staged[name] = work / "new" / name
            shutil.copytree(src / name, staged[name])
            if files_of(staged[name]) != files_of(src / name):
                raise OSError(f"the copy of {name} came out incomplete (is the disk full?)")
        swap(skills, staged, work)
    except (OSError, shutil.Error) as e:
        shutil.rmtree(work, ignore_errors=True)
        return out(False, error=f"could not go back: {e}. Nothing was changed.", current=current)
    keep = keep_old(work, "rolledback")
    shutil.rmtree(src, ignore_errors=True)  # it is live now; what was live is kept in `keep`
    (teamly_dir() / "update.json").unlink(missing_ok=True)
    return out(True, **{"from": current, "to": version_of(skills / "teamly-v2"), "backup": str(keep) if keep else None,
                        "next": "restart the panel: server.py --stop, then start teamly-v2 again; re-read SKILL.md"})


def main(argv):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    cmd = argv[0] if argv else ""
    try:
        if cmd == "check":
            return cmd_check()
        if cmd == "install":
            return cmd_install(force="--force" in argv)
        if cmd == "rollback":
            return cmd_rollback()
    except Exception as e:  # one JSON answer whatever happens: the coordinator reads it
        return out(False, error=f"{type(e).__name__}: {e}")
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
