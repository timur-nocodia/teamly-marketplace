#!/usr/bin/env python3
"""Teamly: is someone else's agent safe to run on this computer?

Reads every file of an agent folder and reports what its scripts could do and what its texts tell the model to do:
network calls (with hosts), deleting files, reading keys and passwords, running downloaded code, starting at login,
changing Claude Code's own settings, programs it ships that can't be read, and hidden instructions to the model.
  danger — the person sees it and says yes before the agent is installed (or the author fixes it before sharing)
  notice — shown in the summary: normal for many agents (a script that calls an API), but the person should know

Usage: python3 safety_check.py <agent folder> [--json]       exit code 0 clean · 1 notices only · 2 danger
"""
import io
import json
import re
import sys
import zipfile
import zlib
from pathlib import Path

CODE = {".py", ".sh", ".bash", ".zsh", ".js", ".mjs", ".cjs", ".ts", ".rb", ".pl", ".php", ".ps1", ".psm1", ".bat", ".cmd",
        ".applescript", ".command", ".vbs"}
MEDIA = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico", ".mp3", ".mp4", ".m4a", ".wav", ".mov", ".webm",
         ".ttf", ".otf", ".woff", ".woff2", ".avif"}   # .svg is a page that can carry script; .pdf is a text the model reads
# what each kind of media file starts with: a "picture" that doesn't is something else wearing a picture's name
MAGIC = {".png": (b"\x89PNG",), ".jpg": (b"\xff\xd8\xff",), ".jpeg": (b"\xff\xd8\xff",), ".gif": (b"GIF8",),
         ".webp": (b"RIFF",), ".ico": (b"\x00\x00\x01\x00",), ".mp3": (b"ID3", b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"),
         ".wav": (b"RIFF",), ".webm": (b"\x1a\x45\xdf\xa3",), ".ttf": (b"\x00\x01\x00\x00", b"true"), ".otf": (b"OTTO",),
         ".woff": (b"wOFF",), ".woff2": (b"wOF2",)}
FTYP = {".mp4", ".m4a", ".mov", ".avif"}   # ISO media: "ftyp" (or an early "moov"/"wide"/"mdat" box) at byte 4
UNREADABLE = {".exe", ".dll", ".so", ".dylib", ".app", ".bin", ".msi", ".pkg", ".dmg", ".pyc", ".pyo", ".class", ".jar",
              ".wasm", ".dex"}
PAGES = {".html", ".htm", ".xhtml", ".svg", ".xml"}
PROGRAM_MAGIC = (b"MZ", b"\x7fELF", b"\xcf\xfa\xed\xfe", b"\xce\xfa\xed\xfe", b"\xca\xfe\xba\xbe", b"\xfe\xed\xfa")
# dependency folders a shared agent shouldn't carry: noted once, their contents not scanned (nothing runs either way)
VENDORED = {"node_modules", ".venv", "venv", "site-packages", "vendor", ".git", ".tox", "__pycache__"}
MAX_READ = 100_000_000   # every byte up to this is read; a bigger file can't be checked and says so

# (level, kind, pattern) — code: scripts and anything that starts with #!  (what the agent's programs actually do)
CODE_RULES = [
    ("danger", "runs code assembled at runtime",  # build a call out of pieces or run native/pickled code a reader can't follow
     r"__import__\s*\(\s*['\"]os['\"]\s*\)\s*\.\s*(system|popen)|"
     r"getattr\s*\(\s*os\s*,[^)\n]*\)\s*\(|"                               # getattr(os, 'sys'+'tem')(…)
     r"\b(pickle|cPickle|marshal)\.loads\s*\(|"                            # loads() runs whatever bytes it is given
     r"import\s+ctypes|\bctypes\.(CDLL|WinDLL|windll|cdll)|"
     r"\bos\.exec[lv]\w*\s*\(|\bos\.spawn\w*\s*\(|\bpty\.spawn\s*\("),
    ("danger", "reads keys or passwords", r"\.ssh\b|id_rsa|id_ed25519|\.aws[/\\]credentials|\.netrc|\.pypirc|"
                                          r"\.git-credentials|\.npmrc\b|_authToken|\.config[/\\]gh[/\\]hosts\.yml|"
                                          r"\.docker[/\\]config\.json|\.kube[/\\]config\b|"
                                          r"\bKeychain\b|security\s+(find|dump)-(generic|internet|keychain)|"   # macOS Keychain CLI
                                          r"\bcmdkey\b|\bvaultcmd\b|"                                            # Windows Credential Manager
                                          r"\.teamly[/\\]credentials|\.claude[/\\]\.credentials"),
    ("danger", "reads private app data (logins, cookies, chat history)",   # reach into another app's store, incl. Claude's own
     r"[/\\]Login Data\b|[/\\]Cookies\b|[/\\]Local State\b|cookies\.sqlite|key4\.db|logins\.json|"  # Chrome/Edge/Firefox/Safari
     r"[/\\]Library[/\\]Application Support[/\\](Google[/\\]Chrome|Firefox|Claude)\b|"
     r"%APPDATA%\\(Claude|Mozilla|Google)|AppData\\(Roaming|Local)\\(Claude|Google|Mozilla)|"
     r"\.claude[/\\]projects\b|\.config[/\\]Claude\b"),
    ("danger", "starts itself at login", r"\bcrontab\b|\blaunchctl\b|LaunchAgents|LaunchDaemons|\bschtasks\b|CurrentVersion\\\\?Run|"
                                         r"reg(\.exe)?\s+add\b[^\n]*\\Run\b|systemctl\s+enable|"             # Windows Run key / systemd unit
                                         r">>\s*~?[/\\]?\.(bashrc|zshrc|bash_profile|profile|zprofile)\b"),  # append to a login shell file
    ("danger", "deletes outside its folder", r"rm\s+-[a-zA-Z]*[rR][a-zA-Z]*\s+(-[a-zA-Z-]+\s+)*[\"']?"
                                             r"(/(?!tmp\b|private/tmp\b|var/folders\b)|~|\$HOME|\$\{HOME\}|\*|\.\.)|"
                                             r"shutil\.rmtree\(\s*(Path\.home|os\.path\.expanduser|[\"'](/|~))|"
                                             r"\bmkfs\b|diskutil\s+erase|\bformat\s+[a-zA-Z]:"),
    ("danger", "changes Claude Code settings or permissions", r"dangerously-skip-permissions|bypassPermissions|"
                                                              r"\.claude[/\\]settings(\.local)?\.json"),
    ("danger", "watches the screen, clipboard, keyboard, mic or camera",   # surveillance of the person at the machine
     r"\bscreencapture\b|ImageGrab\.grab|"
     r"\bpbpaste\b|pyperclip\.(paste|copy)|clipboard\.(paste|read)|"
     r"import\s+pynput|from\s+pynput|pynput\.keyboard|keyboard\.(on_press|hook|add_hotkey)|"   # keyloggers
     r"sounddevice\.(rec|InputStream)|pyaudio[^\n]*input\s*=\s*True|cv2\.VideoCapture\s*\(|AVCaptureSession|"
     r"ffmpeg\b[^\n]*-f\s+(avfoundation|gdigrab|x11grab|dshow)"),
    ("notice", "runs other programs", r"\bsubprocess\.|\bos\.system\(|\bos\.popen\(|shell\s*=\s*True|child_process|"
                                      r"\bexecSync\b|\bspawn\(|Start-Process"),
    ("notice", "installs software", r"(brew|npm|pnpm|yarn|pip3?|pipx|winget|choco|apt|apt-get)\s+(install|add)\b|"
                                    r"python3?\s+-m\s+(pip|venv|virtualenv)\b"),   # ordinary for many agents, but worth knowing
    ("notice", "evaluates code", r"(?<![\w.])(eval|exec)\s*\("),
    ("notice", "deletes files", r"\brm\s+-[a-zA-Z]*[rR]|shutil\.rmtree|Remove-Item\b[^\n]*-Recurse|\bdel\s+/[sq]"),
    ("notice", "reads environment secrets", r"(os\.environ|process\.env|getenv)[^\n]{0,40}(KEY|TOKEN|SECRET|PASSWORD)"),
]
NETWORK = re.compile(r"\brequests\.(get|post|put|delete|request)|urllib\.request|http\.client|\bfetch\(|\baxios\b|"
                     r"\bcurl\s|\bwget\s|Invoke-WebRequest|Invoke-RestMethod|\bsocket\.|\bhttpx\.")
URL = re.compile(r"https?://([A-Za-z0-9.-]+\.[A-Za-z]{2,})")

# texts the model reads: SKILL.md, references, ontology, cards (and comments in code). These run on EVERY file —
# the first three below are command shapes that never appear in an honest agent, in code or in prose, so flag anywhere.
TEXT_RULES = [
    ("danger", "runs code it downloads",   # pull a script off the network and run it straight away
     r"(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(sh|bash|zsh|python3?|node|perl|ruby)\b|(bash|sh|source|\.)\s+<\(\s*(curl|wget)|"
     r"\b(iex|Invoke-Expression)\b[^\n]*(iwr|irm|Invoke-WebRequest|Invoke-RestMethod|DownloadString|DownloadFile)|"
     r"\b(iwr|irm|Invoke-WebRequest|Invoke-RestMethod|DownloadString)\b[^\n]*\|\s*(iex|Invoke-Expression)\b|"   # irm … | iex
     r"\b(bash|sh|zsh|eval)\b[^\n]*(\$\(|`)\s*(curl|wget)\b|"                                              # bash -c "$(curl …)"
     r"(curl|wget)\b[^\n]*\s(-o|-O|--output)\s*\S*[^\n]*(&&|;)\s*(sudo\s+)?(bash|sh|zsh|python3?|node|\./|chmod\s+\+x)|"
     r"New-Object\s+Net\.WebClient|\bStart-BitsTransfer\b|"
     r"certutil(\.exe)?\b[^\n]*-(urlcache|decode|f\b)|bitsadmin(\.exe)?\b[^\n]*/transfer|"   # Windows download LOLbins
     r"\bmshta(\.exe)?\b[^\n]*(http|vbscript|javascript):|"
     r"\brundll32(\.exe)?\b[^\n]*(url\.dll|javascript:|http)|\bregsvr32(\.exe)?\b[^\n]*(/i:\s*http|scrobj)"),
    ("danger", "runs hidden (encoded) code",   # encoded command lines / decode-then-run hide what is executed
     r"(powershell|pwsh)(\.exe)?\b[^\n]*\s-(enc|e|ec|encodedcommand)\b|"
     r"FromBase64String[^\n]*(iex|Invoke-Expression)|"
     r"(exec|eval)\s*\(\s*(base64|codecs|zlib|marshal|bytes\.fromhex|atob)\b|(exec|eval)\s*\([^)\n]*b64decode|"
     r"(base64\s+(-d|-D|--decode)|xxd\s+-r|openssl\s+(base64|enc)\s+-d)\b[^\n]*\|\s*(sudo\s+)?(sh|bash|zsh|python3?|perl|node)\b|"
     r"(subprocess\.\w+|os\.system|os\.popen|Popen)\s*\([^\n]*(b64decode|fromhex|codecs\.decode|zlib\.decompress)|"
     r"\b(exec|eval)\s*\(\s*(__import__|compile)\s*\(|"
     r"\b(new\s+)?Function\s*\([^\n]*\batob\s*\(|\beval\s*\(\s*atob\b"),
    ("danger", "runs a command when the skill loads",   # !`cmd` in a skill runs before the model even reads the text
     r"(^|\s)!`[^`\n]+`"),
    ("danger", "opens a remote shell",   # a shell that talks back to an attacker
     r"/dev/tcp/|\bbash\s+-i\b[^\n]*(/dev/tcp|>&|\d{1,3}(\.\d{1,3}){3})|"
     r"\bn(c|cat)\b[^\n]*\s-e\b|\bn(c|cat)\b[^\n]*--sh-exec|\bsocat\b[^\n]*\bexec\s*:|"
     r"New-Object\s+System\.Net\.Sockets\.TCPClient"),
    ("danger", "tells the model to ignore its rules",
     r"ignore\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|earlier|system)\s+(instructions|rules|prompts?)|"
     r"disregard\s+(all\s+|the\s+)?(previous|above|system|earlier)|forget\s+(everything|all)\s+(above|before)|"
     r"you\s+are\s+now\s+(in\s+)?(developer|dan|jailbreak)|^\s*SYSTEM\s*:\s*(ignore|disregard|forget|you\s+are\s+now)|"
     r"your\s+new\s+task\s+is\b[^\n]*\b(send|e-?mail|upload|post|forward|delete|download|ignore|exfiltrat)|"   # not "…your new task is the hook"
     r"тво[яё]\s+нов(ая|ое)\s+задача?[^\n]*(перешл|пересл|отправ|загрузи|выгрузи|удали|игнорир)|"
     r"игнорируй\s+(все\s+|предыдущие\s+|прошлые\s+|системные\s+)*(инструкции|правила)|забудь\s+(вс[её]\s+)?(выше|что выше|инструкции|правила)|"
     # the same said other ways: "forget your safety rules", "set aside your earlier guidelines", "bypass your guardrails"
     r"\b(forget|ignore|disregard|drop|abandon|set\s+aside|put\s+aside|override|bypass|suspend|turn\s+off|disable)\s+"
     r"(all\s+|any\s+)?(of\s+)?(your|its|the|claude'?s)\s+(own\s+)?(earlier\s+|previous\s+|prior\s+|usual\s+|original\s+)?"
     r"(safety\s+)?(rules|guidelines|guardrails|instructions|restrictions|policies|safety\s+(rules|guidelines|checks|guardrails))\b|"
     r"(забудь|отбрось|отключи|обойди|отмени)\s+(сво[иё]\s+|все\s+)*(правила|ограничения|инструкции|правила\s+безопасности)"),
    ("danger", "tells the model to hide things from the person",
     r"(do\s+not|don't|never)\s+(tell|inform|let)\s+(the\s+)?(user|person|human|them)\s+(know|that|what|about|anything)|"
     r"(send|upload|post|delete|forward|e-?mail)\s+[^\n]{0,25}(silently|secretly|quietly|without\s+telling)|"  # move data, hiding it
     r"(run|execute|install|download)\s+[^\n]{0,25}(secretly|without\s+telling)|"  # "run the export quietly" is just quiet
     r"without\s+(telling|informing)\s+(the\s+)?(user|person|human|them|anyone)|without\s+the\s+(user|person|human)\s+knowing|"
     r"не\s+(говори|сообщай|рассказывай)\s+(об\s+этом\s+)?(пользователю|человеку)|без\s+ведома\s+(пользовател|человек)|незаметно\s+(выполни|сделай|запусти)"),
    ("danger", "tells the model to skip confirmations",   # push it past the checks that protect the person (not a --flag doc)
     r"(approve|confirm|accept)\s+(everything|all\s+(tool\s+)?(actions|commands|requests|permissions))\s+(automatically|without\s+asking)|"
     r"\bauto[-\s]?(approve|confirm)\s+(all|every|everything)\b|"
     r"skip\s+(the\s+)?(confirmation|approval|permission)s?\s+(step|and|before|so|then|when\s+you)|"  # a directive, not `--force: skip confirmation prompt`
     r"\bproceed\s+without\s+(asking|confirmation|confirming|permission|approval)|"
     r"\b(never|don'?t|do\s+not)\s+ask\s+(the\s+)?(user|person|human)\s+(for\s+)?(confirmation|permission|approval)|"
     r"(подтвержда\w+|одобря\w+)\s+(все\s+)?автоматически|без\s+подтвержд\w+\s+(выполн|запуск|действ|команд)"),
    ("danger", "tells the model to send data out",
     r"(send|upload|post|exfiltrat\w*|forward)\s+(all\s+|the\s+|their\s+|user'?s?\s+)*(keys?|tokens?|credentials|"   # secrets, not work files
     r"passwords?|chat\s+history|transcripts?|cookies)\s+(to|into)\b|"
     r"(отправ|загрузи|перешли|выгрузи)\w*\s+(все\s+|его\s+|их\s+)*(ключи|токены|пароли|историю\s+чата|переписку)\s+(на|в)\b|"
     r"curl\b[^\n]*(-d|--data[\w-]*|-F)\s*@"),
    ("danger", "tells the model to read secrets or chat history",   # point it at the files it must never open
     r"(read|open|cat|send|copy|upload|exfiltrat\w*)\s+[^\n]{0,40}(~/\.ssh|id_rsa|\.aws[/\\]credentials|~/\.claude|\.claude[/\\]projects|keychain)|"
     r"(send|upload|post|exfiltrat\w*)\s+[^\n]{0,30}(\.env\b|chat\s+history)|"          # exfiltration, not `copy .env.example`
     r"(прочит|считай|открой)\w*\s+[^\n]{0,40}(~/\.ssh|id_rsa|\.aws|keychain|~/\.claude)|"
     r"(отправ|выгрузи|перешли)\w*\s+[^\n]{0,30}(~/\.ssh|\.env\b|ключи\s|истори\w+\s+чата)"),
    ("danger", "tells the model to change Claude Code settings or skip permissions",
     r"dangerously-skip-permissions|bypassPermissions|(edit|change|modify|write\s+to)\s+[^\n]{0,30}settings(\.local)?\.json|"
     r"(измени|поменяй|отредактируй)\s+[^\n]{0,30}settings(\.local)?\.json"),
]
INJECT = re.compile(  # the instruction shapes above, for judging whether a hidden comment is carrying a prompt injection
    r"ignore\s+(previous|prior|above|all|system)|disregard\s+(the\s+)?(previous|above|system)|forget\s+(everything|all)\s+(above|before)|"
    r"you\s+are\s+now|your\s+new\s+task|system\s*:|</?system>|do\s+not\s+tell\s+the\s+(user|person)|without\s+(telling|informing)|"
    r"skip\s+(the\s+)?(confirmation|permission)|auto[-\s]?(approve|confirm)|proceed\s+without\s+asking|"
    r"(forget|set\s+aside|override|bypass)\s+(all\s+)?(your|its|the)\s+(\w+\s+)?(rules|guidelines|guardrails)|"
    r"игнорир|забудь\s+(вс[её]|выше)|тво[яё]\s+нов\w+\s+задач|не\s+сообщай|без\s+подтвержд|без\s+ведома", re.IGNORECASE)
ZERO_WIDTH = re.compile("[\u200b\u200c\u200d\u2060\u202e]")
HTML_COMMENT = re.compile(r"<!--([\s\S]*?)-->")
BLOB = re.compile(r"[A-Za-z0-9+/]{240,}={0,2}")


ACTIVE = re.compile(r"<script\b|\bon[a-z]+\s*=\s*[\"']|javascript:", re.IGNORECASE)   # a page that runs code when opened
NEGATED = re.compile(r"(never|don't|do\s+not|не)\s+\S*\s*$", re.IGNORECASE)   # "never skip the confirmation" protects the person
EMOJI_JOIN = re.compile("(?<=[\U0001F000-\U0001FAFF\u2600-\u27BF\uFE0F])\u200d(?=[\U0001F000-\U0001FAFF\u2600-\u27BF\u2640\u2642])")


TEXTLIKE = {".md", ".txt", ".json", ".jsonl", ".yml", ".yaml", ".toml", ".ini", ".cfg", ".csv", ".tsv", ".html", ".htm",
            ".xhtml", ".svg", ".xml", ".rtf", ".log"}   # read by people or the model: never skipped as "not text"
BOMS = ((b"\xef\xbb\xbf", "utf-8-sig"), (b"\xff\xfe\x00\x00", "utf-32"), (b"\x00\x00\xfe\xff", "utf-32"),
        (b"\xff\xfe", "utf-16"), (b"\xfe\xff", "utf-16"))


def decode_text(raw):
    """A file's text whatever its encoding, or None for binary data (pictures, archives, programs).
    A BOM (UTF-8, UTF-16, UTF-32, as Windows tools write) and UTF-16 without one are read as such. Anything else that
    isn't UTF-8 (cp1251, one stray byte) is read two lenient ways at once, Windows-1252 and UTF-8 with replacements, so
    an instruction in plain ASCII is still seen: the sender chooses the encoding, the check must not depend on it."""
    for bom, enc in BOMS:
        if raw.startswith(bom):
            try:
                return raw.decode(enc)
            except UnicodeDecodeError:
                break
    head = raw[:4096]
    if b"\x00" in head:
        nul_even, nul_odd, half = head[0::2].count(0), head[1::2].count(0), max(1, len(head) // 2)
        enc = "utf-16-le" if nul_odd > half // 3 and nul_even < half // 20 else "utf-16-be" if nul_even > half // 3 and nul_odd < half // 20 else None
        if not enc:
            return None
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            return None
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("cp1252", errors="replace") + "\n" + raw.decode("utf-8", errors="replace")


def is_code(path, text):
    return path.suffix.lower() in CODE or text.startswith("#!")


def looks_like(suffix, head):
    """Does a media file start the way files of its kind do?"""
    if suffix in FTYP:
        return head[4:8] in (b"ftyp", b"moov", b"wide", b"mdat", b"free", b"skip")
    return any(head.startswith(m) for m in MAGIC.get(suffix, (head[:4],)))


def pdf_text(raw):
    """The text a PDF shows, read the simple way: its streams (inflated when compressed) and the strings in them.
    Fonts with their own encodings come out as noise: then this returns None and the PDF counts as unread."""
    parts = []
    for m in re.finditer(rb"stream\r?\n(.*?)\r?\n?endstream", raw, re.S):
        data = m.group(1)
        try:
            data = zlib.decompress(data)
        except zlib.error:
            pass
        parts += [x.decode("latin-1") for x in re.findall(rb"\(((?:\\.|[^\\)])*)\)", data)]
    text = re.sub(r"\\([()\\])", r"\1", " ".join(parts))
    return text if sum(c.isalpha() for c in text) >= 20 else None


SECRET_VAR = re.compile(r"(?:os\.environ(?:\.get)?\s*[\[(]\s*['\"]|process\.env\.|process\.env\[\s*['\"]|getenv\s*\(\s*['\"]|\$\{?|\$env:)"
                        r"([A-Z][A-Z0-9]*_[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?)[A-Z0-9_]*)")
DOWNLOAD_TO = re.compile(r"(?:\b(?:curl|wget)\b[^\n]*\s(?:-o|-O|--output|--output-document)\s*['\"]?|-OutFile\s+['\"]?|DownloadFile\([^,\n]+,\s*['\"])"
                         r"([^\s'\")]+)")
FETCH_RUN = re.compile(  # code that fetches something and runs it, in Python and JavaScript
    r"\b(exec|eval)\s*\(\s*(requests|urllib|httpx|urlopen)\b|\b(exec|eval)\s*\([^)\n]*\.(text|content|read\(\))|"
    r"\beval\s*\(\s*(await\s+)?\(?\s*(await\s+)?(fetch|axios|got)\b|\beval\s*\(\s*Buffer\.from\s*\(|"
    r"\bnew\s+Function\s*\([^)\n]*(fetch|responseText|\.text\(\)|Buffer\.from)|\.then\s*\(\s*\w+\s*=>\s*eval\s*\(|"
    r"\b(?:vm\.runIn\w*Context|vm\.Script)\s*\([^)\n]*(fetch|body|data)", re.IGNORECASE)


def runs_what_it_downloads(text):
    """A file downloaded on one line and run (or made runnable) on another, the way a short install script does it."""
    for name in {m.group(1) for m in DOWNLOAD_TO.finditer(text)}:
        base = re.escape(name.split("/")[-1])
        if re.search(rf"(\b(bash|sh|zsh|python3?|node|source|chmod\s+\+x|Start-Process|&)\s+['\"]?\S*{base}|\./{base})", text):
            return name
    return None


def sends_secrets(text, hosts):
    """Reads a key from the environment and talks to the internet. The Teamly key is never an agent's business; another
    key going only to places that aren't its own service (or to an address built in code) is how keys get stolen."""
    names = {m.group(1) for m in SECRET_VAR.finditer(text)}
    if re.search(r"TEAMLY_API_KEY|tly_data_", text):
        return "the Teamly key"
    if not names or not hosts:
        return None
    for name in sorted(names):
        provider = name.split("_")[0].lower()
        if len(provider) >= 3 and not any(provider in h.lower() for h in hosts if h != "(address built in code)"):
            return f"{name} (sent to {', '.join(sorted(hosts))[:120]})"
    return None



def texts_of(root):
    """The agent's own texts (what the model reads): to know whether they send the model to some file."""
    out = []
    for f in Path(root).rglob("*.md"):
        try:
            out.append(f.read_text(encoding="utf-8", errors="replace"))
        except OSError:
            pass
    return out


def scan_text(rel, text, code, hosts, page=False):
    """Every rule over one file's text; the network hosts a script talks to are added to `hosts`."""
    findings, own_hosts = [], set()
    rules = (CODE_RULES + TEXT_RULES) if code else TEXT_RULES
    for n, line in enumerate(text.splitlines(), 1):
        for level, kind, rx in rules:
            m = re.search(rx, line, re.IGNORECASE | re.MULTILINE)
            if m and not (kind == "tells the model to skip confirmations" and NEGATED.search(line[:m.start()])):
                findings.append({"level": level, "kind": kind, "file": rel, "line": n, "text": line.strip()[:160]})
        if page and ACTIVE.search(line):
            findings.append({"level": "notice", "kind": "a page with scripts", "file": rel, "line": n, "text": line.strip()[:160]})
        if code and NETWORK.search(line):
            for h in URL.findall(line) or ["(address built in code)"]:
                hosts.setdefault(h, f"{rel}:{n}")
                own_hosts.add(h)
        if FETCH_RUN.search(line):
            findings.append({"level": "danger", "kind": "runs code it downloads", "file": rel, "line": n, "text": line.strip()[:160]})
        if ZERO_WIDTH.search(EMOJI_JOIN.sub("", line.lstrip("\ufeff"))):  # the joiner inside 👩‍💻 or ❤️‍🔥 is part of the emoji
            findings.append({"level": "danger", "kind": "invisible characters in the text", "file": rel, "line": n,
                             "text": ZERO_WIDTH.sub("\u27e8?\u27e9", line.strip())[:160]})
        if BLOB.search(line):
            findings.append({"level": "notice", "kind": "a long encoded block", "file": rel, "line": n, "text": line.strip()[:80] + "\u2026"})
    if code:  # URLs on lines without the call (base URL constants) still tell where the script talks to
        for h in URL.findall(text):
            hosts.setdefault(h, rel)
            own_hosts.add(h)
    ran = runs_what_it_downloads(text)
    if ran:
        findings.append({"level": "danger", "kind": "runs code it downloads", "file": rel, "line": 0, "text": f"downloads {ran}, then runs it"})
    leak = sends_secrets(text, own_hosts) if code and own_hosts else (sends_secrets(text, set()) if code else None)
    if leak:
        findings.append({"level": "danger", "kind": "reads a key and sends it out", "file": rel, "line": 0, "text": leak})
    for m in HTML_COMMENT.finditer(text):   # a comment carrying an instruction is hidden from the rendered page
        body = " ".join(m.group(1).split())
        if INJECT.search(body):
            n = text[:m.start()].count("\n") + 1
            findings.append({"level": "danger", "kind": "hidden comment with instructions", "file": rel, "line": n, "text": body[:160]})
    return findings


def scan(root):
    root = Path(root)
    self_paths = {Path(__file__).resolve(), (Path(__file__).resolve().parent / "share_check.py")}  # don't scan our own source
    findings, hosts, vendored = [], {}, set()
    for f in sorted(p for p in root.rglob("*") if p.is_file()):
        rel = f.relative_to(root).as_posix()
        # Finder leftovers (.DS_Store, ._name, __MACOSX/) are never installed; everything else is read: it gets installed
        if f.name == ".DS_Store" or f.name.startswith("._") or "__MACOSX" in f.relative_to(root).parts:
            continue
        top = next((p for p in f.relative_to(root).parts[:-1] if p in VENDORED), None)
        if top:  # bundled dependency: record it once, don't read inside (it wouldn't ship from a real package anyway)
            vendored.add(top)
            continue
        try:
            if f.resolve() in self_paths:  # the scanner scanning itself would match every rule in its own rule table
                continue
        except OSError:
            pass
        try:
            size = f.stat().st_size
            with open(f, "rb") as fh:
                head = fh.read(64)
        except OSError:
            continue
        suffix = f.suffix.lower()
        # a program wearing a picture's name is still a program: the magic bytes are checked before the media skip
        if head.startswith(PROGRAM_MAGIC) or suffix in UNREADABLE:
            findings.append({"level": "danger", "kind": "ships a program that can't be read", "file": rel, "line": 0, "text": f.name})
            continue
        if suffix in MEDIA:
            if looks_like(suffix, head):
                continue
            findings.append({"level": "danger", "kind": f"isn't the {suffix[1:]} its name says (a script dressed as one?)",
                             "file": rel, "line": 0, "text": f.name})
        if size > MAX_READ:
            findings.append({"level": "danger", "kind": "too big to check", "file": rel, "line": 0, "text": f"{f.name}: {size // 1_000_000} MB"})
            continue
        try:
            raw = f.read_bytes()
        except OSError:
            continue
        if suffix == ".pdf":
            text = pdf_text(raw)
            if text is None:  # the model may still read it: say so, loudly if the agent's texts point it there
                pointed = any(f.name in t for t in texts_of(root))
                findings.append({"level": "danger" if pointed else "notice", "file": rel, "line": 0, "text": f.name,
                                 "kind": "a PDF the agent's texts send the model to, which this check can't read" if pointed
                                 else "a PDF this check can't read"})
                continue
            findings += scan_text(rel, text, False, hosts)
            continue
        if suffix == ".zip":  # an archive inside the archive: what is in it gets read too (one level)
            try:
                with zipfile.ZipFile(io.BytesIO(raw)) as z:
                    for i in z.infolist():
                        if i.is_dir() or i.file_size > MAX_READ:
                            continue
                        inner = z.read(i)
                        name = f"{rel}/{i.filename}"
                        if inner[:64].startswith(PROGRAM_MAGIC) or Path(i.filename).suffix.lower() in UNREADABLE | {".zip", ".tar", ".gz", ".tgz", ".7z", ".rar"}:
                            findings.append({"level": "danger", "kind": "an archive inside with something that can't be checked", "file": name, "line": 0, "text": i.filename})
                            continue
                        t = decode_text(inner)
                        if t is not None:
                            findings += scan_text(name, t, is_code(Path(i.filename), t), hosts)
            except (zipfile.BadZipFile, RuntimeError, OSError):
                findings.append({"level": "danger", "kind": "an archive inside that can't be opened", "file": rel, "line": 0, "text": f.name})
            continue
        if suffix in {".tar", ".gz", ".tgz", ".7z", ".rar", ".bz2", ".xz"}:
            findings.append({"level": "danger", "kind": "an archive inside that this check can't open", "file": rel, "line": 0, "text": f.name})
            continue
        text = decode_text(raw)
        if text is None:
            if f.suffix.lower() in CODE | TEXTLIKE:  # a script or a text that can't be read: what it says was not checked
                findings.append({"level": "danger", "kind": "a text file that can't be read, so it wasn't checked", "file": rel,
                                 "line": 0, "text": f.name})
            else:
                findings.append({"level": "notice", "kind": "a file that isn't text", "file": rel, "line": 0, "text": f.name})
            continue
        findings += scan_text(rel, text, is_code(f, text), hosts, page=f.suffix.lower() in PAGES)
    if vendored:
        # Teamly's own packaging never ships these folders, so an archive that has them was made by hand: what is inside
        # (a vendored script, .git/hooks that run on the next git command) can't be checked here — the person decides
        findings.append({"level": "danger", "kind": "ships code that can't be checked (vendored dependencies, .git)", "file": "", "line": 0,
                         "text": ", ".join(sorted(vendored))})
    if hosts:
        findings.append({"level": "notice", "kind": "talks to the internet", "file": "", "line": 0,
                         "text": ", ".join(sorted(hosts)), "hosts": hosts})
    # one line per kind and file is enough for a person to read
    seen, out = set(), []
    for x in findings:
        k = (x["level"], x["kind"], x["file"], x["text"])
        if k not in seen:
            seen.add(k)
            out.append(x)
    verdict = "danger" if any(x["level"] == "danger" for x in out) else "notice" if out else "clean"
    return {"verdict": verdict, "findings": out}


def main(argv):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if not argv or argv[0].startswith("-"):
        print(__doc__)
        return 64
    res = scan(Path(argv[0]).expanduser())
    if "--json" in argv:
        print(json.dumps(res, ensure_ascii=False, indent=1))
    else:
        print(f"Safety check: {Path(argv[0]).name} — {res['verdict']}")
        for x in res["findings"]:
            where = f"{x['file']}:{x['line']}" if x["line"] else x["file"]
            print(f"  {'!!' if x['level'] == 'danger' else ' ·'} {x['kind']:40} {where}  {x['text']}")
    return {"clean": 0, "notice": 1, "danger": 2}[res["verdict"]]


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
