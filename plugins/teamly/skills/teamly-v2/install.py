#!/usr/bin/env python3
"""Installs this Teamly v2 build for Claude Code (macOS and Windows).

Copies this folder to ~/.claude/skills/teamly-v2 and its forge/ to ~/.claude/skills/teamly-forge: copies, not links,
so it works the same on Windows. Nothing live is touched until the new copy is complete: it is made and checked next
to the skills first (a hidden folder, so Claude Code never sees it as a skill), then old and new swap places with
renames, and any failure puts the old copy back. The old copy then goes to ~/.teamly/backup/skills-<time>/ (outside
the skills folder, so Claude Code never sees two skills with one name) and ~/.teamly/update.json records it for
`update.py rollback`. Running it from an installed copy is a repair: the copy is made before anything moves.
A developer link (the folder is a symlink) is left alone. One install or rollback at a time (~/.teamly/install.lock).
Then runs the panel server's self-check and prints one JSON result, whatever happens.
Usage: python3 install.py [--skills-dir DIR]          install, update or repair
       python3 install.py --uninstall [--skills-dir DIR]  remove the two skills (moved to ~/.teamly/backup; your data in ~/.teamly stays)
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

SRC = Path(__file__).resolve().parent
SKIP = shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store")
WORK_PREFIX = ".teamly-install-"   # hidden folders next to the skills while an install or rollback runs
LOCK_STALE = 15 * 60               # a lock older than this was left by a run that died


def result(ok, **info):
    print(json.dumps({"ok": ok, **info}, ensure_ascii=False, indent=1))
    return 0 if ok else 1


def teamly_dir():
    return Path.home() / ".teamly"


def version_of(folder):
    """The VERSION line of a package's server.py (None when the folder isn't a Teamly v2 package)."""
    try:
        m = re.search(r'^VERSION = "([^"]+)"', (Path(folder) / "server.py").read_text(encoding="utf-8"), re.MULTILINE)
    except OSError:
        return None
    return m.group(1) if m else None


def holder_alive(lock):
    """Is the process that took the lock still running? An app quit mid-update leaves the lock behind: then no."""
    try:
        pid = int(lock.read_text(encoding="utf-8").strip() or 0)
    except (OSError, ValueError):
        return True  # can't tell: trust the lock's age
    if pid <= 0:
        return True
    if os.name == "nt":  # Windows: ask the system whether that process still runs
        try:
            import ctypes
            handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
            if not handle:
                return False
            code = ctypes.c_ulong()
            ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
            ctypes.windll.kernel32.CloseHandle(handle)
            return code.value == 259  # STILL_ACTIVE
        except (OSError, AttributeError):
            return True
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except OSError:
        return True
    return True


class Busy(Exception):
    """Another install or rollback holds the lock."""


class Lock:
    """One run at a time: a lock file made with O_EXCL. A lock older than 15 minutes was left by a run that died."""

    def __init__(self, path):
        self.path = Path(path)

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        for _ in range(3):
            try:
                fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            except FileExistsError:
                try:
                    if time.time() - self.path.stat().st_mtime < LOCK_STALE and holder_alive(self.path):
                        raise Busy(str(self.path))
                    self.path.unlink()
                except FileNotFoundError:
                    pass
                continue
            os.write(fd, str(os.getpid()).encode())
            os.close(fd)
            return self
        raise Busy(str(self.path))

    def __exit__(self, *exc):
        try:
            self.path.unlink()
        except OSError:
            pass


def write_json(path, data):
    """Written whole or not at all: a temporary file, then a rename."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def files_of(folder):
    """Every file of a tree with its size, the way copytree with SKIP copies it."""
    folder = Path(folder)
    out = {}
    for p in folder.rglob("*"):
        if p.is_file() and "__pycache__" not in p.parts and p.suffix != ".pyc" and p.name != ".DS_Store":
            out[p.relative_to(folder).as_posix()] = p.stat().st_size
    return out


def unique(path):
    """path, or path-2, path-3…: two runs in one second never share a backup folder."""
    n, p = 1, path
    while p.exists():
        n += 1
        p = path.with_name(f"{path.name}-{n}")
    return p


def recover(skills, names):
    """A run killed between its two renames left the old copy in a hidden work folder: put it back, then tidy up."""
    for work in skills.glob(WORK_PREFIX + "*"):
        for name in names:
            old = work / "old" / name
            if old.is_dir() and not (skills / name).exists():
                os.rename(old, skills / name)
        shutil.rmtree(work, ignore_errors=True)


def swap(skills, staged, work):
    """Puts the staged folders in place with renames; on any failure every rename is undone. Returns what was moved out."""
    done = []  # (from, to), undone in reverse
    (work / "old").mkdir(parents=True, exist_ok=True)
    try:
        for name, new in staged.items():
            live = skills / name
            if live.exists():
                os.rename(live, work / "old" / name)
                done.append((live, work / "old" / name))
            os.rename(new, live)
            done.append((new, live))
    except BaseException:
        for a, b in reversed(done):
            try:
                os.rename(b, a)
            except OSError:
                pass
        raise
    return [name for name in staged if (work / "old" / name).exists()]


def keep_old(work, kind):
    """The copies that were live go to ~/.teamly/backup/<kind>-<time>; if that move fails they stay in the hidden folder."""
    old = work / "old"
    if not old.is_dir() or not any(old.iterdir()):
        shutil.rmtree(work, ignore_errors=True)
        return None
    backup = unique(teamly_dir() / "backup" / time.strftime(f"{kind}-%Y%m%d-%H%M%S"))
    try:
        backup.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(old), str(backup))  # not live any more: a copy across disks is fine here
    except (OSError, shutil.Error):
        return old
    shutil.rmtree(work, ignore_errors=True)
    return backup


def keep_published(old_library, new_library):
    """0.5.2 and older published the person's own agents into the skill's library/: an update must not take them away.
    Agents the new build doesn't have move to ~/.teamly/library, where publishing goes now."""
    if not old_library.is_dir():
        return
    mine = teamly_dir() / "library"
    for d in old_library.iterdir():
        try:  # only agents the person published (publish stamps sharedAt); an agent a release dropped stays dropped
            published = bool(json.loads((d / "card.json").read_bytes()).get("sharedAt"))
        except (OSError, ValueError, AttributeError):
            published = False
        if published and (d / "SKILL.md").is_file() and not (new_library / d.name).exists() and not (mine / d.name).exists():
            mine.mkdir(parents=True, exist_ok=True)
            shutil.copytree(d, mine / d.name, ignore=SKIP)


def panel_ports():
    """Where panel servers listen: 4319 and the next ports the app picks when it is taken (TEAMLY_PANEL_PORTS: "a-b" or "")."""
    spec = os.environ.get("TEAMLY_PANEL_PORTS", "4319-4329").strip()
    if not spec:
        return []
    lo, _, hi = spec.partition("-")
    return list(range(int(lo), int(hi or lo) + 1))


def ask_panel(port, path):
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", headers={"Host": f"127.0.0.1:{port}"})
    with urllib.request.urlopen(req, timeout=1.5) as r:
        return json.loads(r.read())


def stop_old_panels(skills, version):
    """A panel server still running an older Teamly of these skills serves the new files against its old code, and
    0.5.2 and older can't restart themselves: stop it (the app or the coordinator starts it again on the new code).
    Servers of other skills folders (another home, a developer copy) are never touched."""
    stopped = []
    for port in panel_ports():
        try:
            health = ask_panel(port, "/api/health")
            older = str(health.get("version") or "") if isinstance(health, dict) else ""
            # 0.5.3 and newer restart themselves on the new code within a minute: only the older ones are stopped
            if not re.fullmatch(r"\d+\.\d+\.\d+", older) or tuple(map(int, older.split("."))) >= (0, 5, 3):
                continue
            state = ask_panel(port, "/api/state")  # its skills dir is <its own folder>/.sandbox/skills unless it was given one
            ours = {(skills / "teamly-v2" / ".sandbox" / "skills").resolve(), skills.resolve()}
            if Path(str(state.get("skillsDir") or "")).resolve() not in ours:
                continue
        except (OSError, ValueError, AttributeError):
            continue
        subprocess.run([sys.executable, str(skills / "teamly-v2" / "server.py"), "--stop", "--port", str(port)],
                       capture_output=True, text=True, timeout=30)
        stopped.append(port)
    return stopped


def uninstall(skills, names):
    for name in names:
        if (skills / name).is_symlink():
            return result(False, error=f"{skills / name} is a developer link: remove it yourself")
    present = [n for n in names if (skills / n).exists()]
    if not present:
        return result(True, removed=[], backup=None)
    work = Path(tempfile.mkdtemp(prefix=WORK_PREFIX, dir=skills))
    (work / "old").mkdir()
    for name in present:
        os.rename(skills / name, work / "old" / name)
    backup = keep_old(work, "removed")
    return result(True, removed=present, backup=str(backup) if backup else None,
                  kept="your teams, ratings and key in ~/.teamly stay; delete that folder to remove everything")


def install(skills, targets):
    old_version = version_of(skills / "teamly-v2")
    skills.mkdir(parents=True, exist_ok=True)
    recover(skills, list(targets))
    work = Path(tempfile.mkdtemp(prefix=WORK_PREFIX, dir=skills))  # same disk as the skills: the swap is two renames
    staged = {}
    try:
        for name, src in targets.items():
            staged[name] = work / "new" / name
            shutil.copytree(src, staged[name], ignore=SKIP)
            if files_of(staged[name]) != files_of(src):
                raise OSError(f"the copy of {name} came out incomplete (is the disk full?)")
            old_data = skills / name / ".data"  # 0.5.2 and older kept panel edits and ratings here: they come along
            if name == "teamly-v2" and old_data.is_dir() and not (staged[name] / ".data").exists():
                shutil.copytree(old_data, staged[name] / ".data")
            if name == "teamly-v2":
                keep_published(skills / name / "library", staged[name] / "library")
        moved = swap(skills, staged, work)
    except (OSError, shutil.Error) as e:
        shutil.rmtree(work, ignore_errors=True)
        return result(False, error=f"could not install: {e}. Nothing was changed: the version that was there stays.",
                      kept=old_version)
    backup = keep_old(work, "skills") if moved else None
    if not moved:
        shutil.rmtree(work, ignore_errors=True)
    if backup:
        write_json(teamly_dir() / "update.json", {"from": old_version, "to": version_of(skills / "teamly-v2"),
                                                   "at": int(time.time()), "backup": str(backup)})
    run = subprocess.run([sys.executable, str(skills / "teamly-v2" / "server.py"), "--check"], capture_output=True,
                         text=True, encoding="utf-8", errors="replace", env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    try:
        check = json.loads(run.stdout)
    except ValueError:
        check = {"ok": False, "output": (run.stdout + run.stderr)[-1500:]}
    stopped = stop_old_panels(skills, version_of(skills / "teamly-v2")) if moved and check.get("ok") else []
    return result(bool(check.get("ok")), installed=[str(skills / n) for n in targets], python=sys.executable,
                  backup=str(backup) if backup else None, check=check, stoppedPanels=stopped)


def main(argv):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if sys.version_info < (3, 9):
        return result(False, error=f"Python {sys.version.split()[0]} is too old: Teamly needs 3.9 or newer")
    skills = Path(argv[argv.index("--skills-dir") + 1]).expanduser() if "--skills-dir" in argv else Path.home() / ".claude" / "skills"
    targets = {"teamly-v2": SRC, "teamly-forge": SRC / "forge"}
    if "--uninstall" not in argv and (not (SRC / "SKILL.md").is_file() or not (SRC / "forge" / "SKILL.md").is_file()):
        return result(False, error=f"{SRC} is not a Teamly v2 package (SKILL.md or forge/ missing)")
    for name in targets:
        if (skills / name).is_symlink() and "--uninstall" not in argv:
            return result(False, error=f"{skills / name} is a developer link to {(skills / name).resolve()}: not replacing it")
    try:
        with Lock(teamly_dir() / "install.lock"):
            return uninstall(skills, list(targets)) if "--uninstall" in argv else install(skills, targets)
    except Busy:
        return result(False, busy=True, error="another Teamly install or rollback is running: try again in a minute")
    except Exception as e:  # whatever happens, one JSON answer: the coordinator reads it
        return result(False, error=f"{type(e).__name__}: {e}")


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
