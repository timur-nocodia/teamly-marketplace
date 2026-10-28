#!/usr/bin/env python3
"""Teamly: check an agent folder before it goes to the shared library.

Finds what must never leave the person's machine: API keys and tokens, emails, phone numbers, card numbers,
IBANs, personal file paths, and private names listed in ontology.md (`private: Имя, Компания, …` in the Config section).
Reads every file: text of any size up to 100 MB, and the text inside Word, Excel, PowerPoint and OpenDocument files.
A file it can't read (a PDF, an old .doc, a file over 100 MB) is a finding "not checked": it is never called clean.
After the person opened such a file and confirmed nothing private is in it, the packager lists it in the draft's
manifest.json under "checkedByHand" and the check passes it; a finding the person confirmed is not personal (a service's
support address) is listed there as "file:line".
Also checks that the package has what the library needs (SKILL.md, ontology.md, evals with ≥3 tasks, card.json).

Usage: python3 share_check.py <agent folder> [--privacy-only]      exit code 0 = clean, 1 = fix before sharing
       --privacy-only: only what must not leave the computer (a team folder has no SKILL.md or tests of its own)
"""
import json
import re
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from safety_check import decode_text, pdf_text  # noqa: E402  same folder: one way to read text in any encoding

# Known key/token shapes. One alternative per provider so a real secret is caught by its own prefix, not by looking
# "random" — a long hash or a base64 font blob is not a secret and must not be reported.
KEY_PREFIX = re.compile(
    r"\bsk-ant-[A-Za-z0-9_-]{20,}"                         # Anthropic
    r"|\bsk-proj-[A-Za-z0-9_-]{20,}"                        # OpenAI (project)
    r"|\bsk-(?:svcacct|admin)-[A-Za-z0-9_-]{20,}"            # OpenAI (service account / admin)
    r"|\bsk-or-v1-[A-Za-z0-9]{20,}"                         # OpenRouter
    r"|\bsk_[0-9a-f]{32,}"                                  # ElevenLabs
    r"|\bhf_[A-Za-z0-9]{30,}"                               # Hugging Face
    r"|\br8_[A-Za-z0-9]{30,}"                               # Replicate
    r"|\bgsk_[A-Za-z0-9]{40,}"                              # Groq
    r"|\bxai-[A-Za-z0-9]{40,}|\bpplx-[A-Za-z0-9]{40,}"       # xAI, Perplexity
    r"|\bglpat-[A-Za-z0-9_-]{20,}"                          # GitLab
    r"|\bsk-[A-Za-z0-9]{32,}"                               # OpenAI (classic): 32+ unbroken alnum, so sk-01-foo is not a key
    r"|\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"                       # AWS access key id
    r"|\b\d{6,12}:AA[A-Za-z0-9_-]{30,40}\b|\b\d{8,10}:[A-Za-z0-9_-]{35}\b"   # Telegram bot token (ids of any length, "AA…")
    r"|\bapify_api_[A-Za-z0-9]{20,}"                        # Apify
    r"|\b[srp]k_live_[A-Za-z0-9]{16,}"                      # Stripe live secret / restricted / publishable
    r"|\bAIza[0-9A-Za-z_-]{35}\b"                           # Google API key
    r"|\bghp_[A-Za-z0-9]{36}\b|\bgho_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{22,}"  # GitHub PAT (classic / oauth / fine-grained)
    r"|\bxox[baprs]-[A-Za-z0-9-]{10,}"                      # Slack
    r"|\bsecret_[A-Za-z0-9]{40,}|\bntn_[A-Za-z0-9]{40,}"    # Notion
    r"|\bpolar_[A-Za-z0-9_]{12,}|\btmly_[A-Za-z0-9_]{8,}"   # Polar, Teamly (old demo keys)
    r"|\btly_data_[A-Za-z0-9_-]{20,}"                       # Teamly Data API key
    r"|-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----")             # PEM private key
JWT = re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b")   # header.payload.signature (all three)
# a high-entropy value only when it is plainly assigned to a secret-ish name (api_key = "…", "token": "…")
KEY_CONTEXT = re.compile(r"(?i)(?:secret|token|api[_-]?key|access[_-]?key|private[_-]?key|password|passwd|bearer|ключ|токен|пароль)\b['\"]?\s*[:=]\s*['\"]?([A-Za-z0-9+/_-]{16,})")
# a key written in words ("my key is …", "ключ: …") that has no known prefix: long, letters and digits mixed
KEY_WORDS = re.compile(r"(?i)\b(?:api\s*key|key|token|secret|ключ|токен|пароль|password)\b\s*(?:is|это|—|-|:|=)?\s*['\"«]?(?=[A-Za-z0-9+/_-]{20,})(?=[^\s]*\d)(?=[^\s]*[A-Za-z])([A-Za-z0-9+/_-]{20,})")
# a key named a few words before it, in prose ("my DeepL key: …", "вот ключ DeepL — …", "Twilio auth token is …"):
# letters and digits mixed, 20+ long. Code is left to the shapes above: identifiers like token_count_v2_large sit
# next to such words there.
KEY_NEAR = re.compile(r"(?i)\b(?:api\s*key|keys?|tokens?|secrets?|ключ\w*|токен\w*|парол\w*|password|pat|oauth|auth)\b[^\n]{0,40}?"
                      r"(?<![A-Za-z0-9+/_-])(?=[A-Za-z0-9+/_-]*\d)(?=[A-Za-z0-9+/_-]*[A-Za-z])([A-Za-z0-9+/_-]{20,})")
PROSE = {".md", ".markdown", ".txt", ".json", ".csv", ".yaml", ".yml", ".html", ".htm", ""}
NO_LINKS = re.compile(r"https?://\S+|data:[^\s)'\"]+")
AUTH_HEADER = re.compile(r"(?i)\bAuthorization\s*:\s*(?:Bearer|Basic|Token)\s+([A-Za-z0-9._~+/=-]{16,})")  # curl -H examples
URLSECRET = re.compile(r"(?i)[?&](?:api[_-]?key|access[_-]?token|auth[_-]?token|token|key|secret|password|sig)=([^&\s'\"<>]{8,})")  # secret in a URL query

NOISE = re.compile(r"https?://\S+|data:[^\s)'\"]+|[A-Za-z0-9+/]{60,}={0,2}")   # URLs, inline data: blobs, long base64/hex runs: no personal data
EMAIL = re.compile(r"\b[\w.+-]+@[A-Za-z0-9-]+\.(?:[A-Za-z0-9-]+\.)*[A-Za-z]{2,}\b")  # last label is letters, so pkg@1.2.3 is not an email
PHONE = re.compile(r"(?<![\w+])\+\d[\d\s()\-]{7,}\d"                                  # +7 905 123 45 67 / +1 (555) 123-4567; not U+0030-0039 or 1e+10
                   r"|\b8[\s(\-]\d{3}[\s)\-]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}\b")        # Russian 8 (900) 123-45-67 — needs a separator after 8
# a path with someone's user name in it (~/… names nobody, so it may stay): /Users/<name>, /home/<name>, C:\Users\<name>,
# C:/Users/<name> as Windows coordinators write it, /c/Users/<name> from Git Bash, also C:\\Users\\… inside JSON/TOML
PATH = re.compile(r"(?:/Users/[^\s`'\"]+|/home/[^\s`'\"]+|/[a-z]/Users/[^\s`'\"]+|\b[A-Za-z]:[\\/]{1,2}(?:Users|Documents and Settings)[\\/]{1,2}[^\s`'\"]+)")
# a card number as a person writes one: four-digit groups split by space/dash (13–19 digits total), confirmed by Luhn.
# A bare contiguous run is not matched — minified code and coordinate data are full of Luhn-valid 16-digit integers.
CARD = re.compile(r"\b\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{1,7}\b|\b\d{4}[ -]\d{6}[ -]\d{5}\b")
IBAN = re.compile(r"\b[A-Z]{2}\d{2}[A-Za-z0-9]{11,30}\b")  # confirmed by the ISO mod-97 check below
MAX_SCAN = 100_000_000  # bytes; every file that reads as text is scanned whole, whatever its extension
MEDIA = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico", ".mp3", ".mp4", ".m4a", ".wav", ".mov", ".webm", ".ttf", ".otf",
         ".woff", ".woff2", ".avif"}   # pictures, sound, video and fonts: no text a person typed
OFFICE = {".docx", ".xlsx", ".pptx", ".odt", ".ods", ".odp"}   # zip archives of XML: their text is read
JUNK = {".DS_Store", "Thumbs.db", "desktop.ini"}   # written by Finder or Explorer: never shipped, never reported
VENDORED = {"node_modules", ".venv", "venv", "site-packages", "vendor", ".git", ".tox", "__pycache__"}


def luhn(digits):
    s, alt = 0, False
    for d in map(int, reversed(digits)):
        d = d * 2 - 9 if alt and d * 2 > 9 else d * 2 if alt else d
        s, alt = s + d, not alt
    return s % 10 == 0


def iban_ok(s):
    s = s[4:] + s[:4]
    n = "".join(str(int(c, 36)) for c in s)   # letters → 10..35
    return int(n) % 97 == 1


def phone_like(text):
    """+7 905 123 45 67 is a phone; "+1 500 000 views" is a number with thousands spaced out."""
    digits = re.sub(r"\D", "", text)
    return len(digits) >= 9 and not re.fullmatch(r"\+\d{1,3}(?:[ ,.]\d{3})+", text.strip())


def office_text(f):
    """The text inside a Word, Excel, PowerPoint or OpenDocument file. Word splits one word over several runs
    (<w:t>ivan</w:t>…<w:t>@mail.ru</w:t>): runs are joined as they read, paragraphs and cells become lines."""
    out = []
    with zipfile.ZipFile(f) as z:
        for i in z.infolist():
            if i.filename.endswith(".xml") and i.file_size <= MAX_SCAN:
                xml = z.read(i).decode("utf-8", errors="replace")
                xml = re.sub(r"</(?:w:p|a:p|text:p|text:h|c|si|row|table:table-cell)>|<w:br/>|<w:tab/>", "\n", xml)
                out.append(re.sub(r"<[^>]+>", "", xml))
    return "\n".join(out)


def photo_meta(raw):
    """What a photo carries besides the picture: the printable text in its metadata (EXIF, XMP, PNG text), and whether
    its EXIF holds a location (GPS). Only the start of the file: that is where cameras and phones write it."""
    head = raw[:262_144]
    text = "\n".join(m.decode("latin-1") for m in re.findall(rb"[ -~]{6,}", head))
    gps = False
    i = 2 if head.startswith(b"\xff\xd8") else -1
    while 0 <= i < len(head) - 4 and head[i] == 0xFF:  # JPEG segments: APP1 "Exif" holds the EXIF directory
        marker, size = head[i + 1], int.from_bytes(head[i + 2:i + 4], "big")
        seg = head[i + 4:i + 2 + size]
        if marker == 0xE1 and seg.startswith(b"Exif") and (b"\x88\x25" in seg or b"\x25\x88" in seg):
            gps = True
        if marker == 0xDA:  # the picture itself starts here
            break
        i += 2 + size
    return text, gps


def read_text(f):
    """The text of a file, or None when it can't be read (then it is "not checked", never clean)."""
    suffix = f.suffix.lower()
    if f.stat().st_size > MAX_SCAN:
        return None
    if suffix in OFFICE:
        try:
            return office_text(f)
        except (zipfile.BadZipFile, OSError, KeyError, RuntimeError):
            return None
    if suffix == ".pdf":  # its text, read the simple way; a PDF it can't read stays "not checked"
        return pdf_text(f.read_bytes())
    return decode_text(f.read_bytes())  # UTF-16 from PowerShell, cp1251, a BOM: read as text; binary data is None


def hand_checked(root):
    """Files the person opened and confirmed (manifest.json "checkedByHand"): their "not checked" finding goes away."""
    try:
        m = json.loads((root / "manifest.json").read_bytes())  # bytes: a BOM or UTF-16 from a Windows editor reads too
    except (OSError, ValueError):
        return set()
    done = m.get("checkedByHand") if isinstance(m, dict) else None
    return {str(x).replace("\\", "/") for x in done} if isinstance(done, list) else set()


def private_names(root):
    """The names the person listed as private: the Config `private:` line of ontology.md, and for a draft the list the
    packager saved in manifest.json before it turned that line into a placeholder (a team draft: every agent's)."""
    root = Path(root)
    names = []
    o = root / "ontology.md"
    if o.is_file():  # `- private: a, b`, ``- `private`: a, b``, `private: [a, b]`, or a YAML list of "- name" lines under it
        lines = (decode_text(o.read_bytes()) or "").splitlines()
        for i, line in enumerate(lines):
            m = re.match(r"^(\s*)(-\s*)?`?private`?\s*:[ \t]*(.*)$", line, re.IGNORECASE)
            if not m:
                continue
            raw = re.sub(r"(^|\s)#.*$", "", m.group(3)).strip()
            chunks = [raw.strip("[]")] if raw else []
            for nxt in lines[i + 1:] if not raw else []:
                item = re.match(r"^(\s*)-\s+(.+)$", nxt)
                deeper = item and (len(item.group(1)) > len(m.group(1)) or (not m.group(2) and len(item.group(1)) == len(m.group(1))))
                if deeper and not re.match(r"^`?[\w.\-]+`?\s*:", item.group(2)):  # "- other_key: …" is the next setting
                    chunks.append(re.sub(r"\s#.*$", "", item.group(2)))
                elif nxt.strip():
                    break
            for chunk in chunks:
                names += [w.strip().strip("'\"") for w in chunk.split(",") if len(w.strip().strip("'\"")) >= 3 and "<" not in w]
            break
    try:
        saved = json.loads((root / "manifest.json").read_bytes()).get("privateNames")
    except (OSError, ValueError, AttributeError):
        saved = None
    names += [str(x).strip() for x in saved if len(str(x).strip()) >= 3] if isinstance(saved, list) else []
    return sorted(set(names))


def main(argv):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # ✓/✗ in the output; Windows pipes default to cp1252
    if not argv:
        print(__doc__)
        return 2
    root = Path(argv[0]).expanduser().resolve()
    self_paths = {Path(__file__).resolve(), (Path(__file__).resolve().parent / "safety_check.py")}
    findings, names, flagged, by_hand = [], private_names(root), set(), hand_checked(root)
    for f in sorted(root.rglob("*")):
        # manifest.json is the packager's own notes (it quotes the findings) and never ships with the agent
        rel_parts = f.relative_to(root).parts
        if not f.is_file() or "evals/runs" in f.relative_to(root).as_posix() or f.name == "manifest.json":
            continue
        if f.name in JUNK or f.name.startswith("._"):   # Finder/Explorer leftovers: the zip leaves them out
            continue
        hid = next((i for i, p in enumerate(rel_parts) if p.startswith(".") or p in VENDORED), None)
        if hid is not None:   # hidden file (like .env) or a bundled dependency: never ships — note the top of it once
            key = "/".join(rel_parts[:hid + 1])
            if key not in flagged:
                flagged.add(key)
                findings.append((key, "hidden file" if rel_parts[hid].startswith(".") else "vendored deps", "local settings / deps never ship"))
            continue
        try:
            if f.resolve() in self_paths:  # our own source lists these patterns as string literals
                continue
        except OSError:
            pass
        if f.suffix.lower() in MEDIA:
            if f.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".avif"}:  # a photo's metadata: names, mail, place
                try:
                    meta, gps = photo_meta(f.read_bytes())
                except OSError:
                    continue
                rel = f.relative_to(root).as_posix()
                if gps and rel not in by_hand:
                    findings.append((rel, "photo location", "the photo says where it was taken (GPS): strip its metadata"))
                for m in EMAIL.finditer(meta):
                    findings.append((rel, "email", m.group(0)[:60]))
                for m in KEY_PREFIX.finditer(meta):
                    findings.append((rel, "key/token", m.group(0)[:60]))
            continue
        try:
            text = read_text(f)
        except OSError:
            text = None
        if text is None:
            rel = f.relative_to(root).as_posix()
            if rel not in by_hand:
                findings.append((rel, "not checked", "can't be read here: open it and confirm nothing private is inside"))
            continue
        for n, line in enumerate(text.splitlines(), 1):
            rel = f"{f.relative_to(root).as_posix()}:{n}"  # forward slashes on Windows too, as checkedByHand writes them
            bare = NOISE.sub(" ", line)   # drop URLs and data: blobs before the personal-data checks
            for m in KEY_PREFIX.finditer(line):
                findings.append((rel, "key/token", m.group(0)[:60]))
            for m in JWT.finditer(line):
                findings.append((rel, "key/token", m.group(0)[:60]))
            for m in KEY_CONTEXT.finditer(bare):
                findings.append((rel, "key/token", m.group(1)[:60]))
            for m in URLSECRET.finditer(line):
                findings.append((rel, "key/token", m.group(1)[:60]))
            for m in AUTH_HEADER.finditer(line):
                findings.append((rel, "key/token", m.group(1)[:60]))
            for m in KEY_WORDS.finditer(line):
                findings.append((rel, "key/token", m.group(1)[:60]))
            if f.suffix.lower() in PROSE:
                for m in KEY_NEAR.finditer(NO_LINKS.sub(" ", line)):
                    findings.append((rel, "key/token", m.group(1)[:60]))
            for m in EMAIL.finditer(bare):
                if m.group(0).lower().endswith((".png", ".jpg", ".example", "@example.com", ".example.com")):
                    continue
                findings.append((rel, "email", m.group(0)[:60]))
            for m in PHONE.finditer(bare):
                if phone_like(m.group(0)):
                    findings.append((rel, "phone", m.group(0)[:60]))
            for m in PATH.finditer(bare):
                findings.append((rel, "personal path", m.group(0)[:60]))
            for m in CARD.finditer(bare):
                digits = re.sub(r"\D", "", m.group(0))
                if 13 <= len(digits) <= 19 and luhn(digits):
                    findings.append((rel, "card number", m.group(0).strip()[:60]))
            for m in IBAN.finditer(bare.replace(" ", "")):
                try:
                    if iban_ok(m.group(0)):
                        findings.append((rel, "IBAN", m.group(0)[:60]))
                except ValueError:
                    pass
            for name in names:
                if re.search(re.escape(name), line, re.IGNORECASE) and "<names only you know" not in line:
                    findings.append((rel, "private name", name))
    findings = [x for x in dict.fromkeys(findings) if x[0] not in by_hand]  # one per value; "file:line" confirmed by hand goes
    missing = [] if "--privacy-only" in argv else [x for x in ("SKILL.md", "ontology.md", "card.json") if not (root / x).is_file()]
    evals = root / "evals" / "evals.json"
    n_tasks = 0
    if evals.is_file():
        try:
            n_tasks = len(json.loads(evals.read_bytes()).get("tasks", []))
        except (ValueError, AttributeError):
            pass
    if n_tasks < 3 and "--privacy-only" not in argv:
        missing.append(f"evals/evals.json with ≥3 tasks (found {n_tasks})")

    print(f"Share check: {root.name}")
    for rel, label, val in findings[:80]:
        print(f"  ✗ {label:13} {rel}  {val}")
    for m in missing:
        print(f"  ✗ missing      {m}")
    if not findings and not missing:
        print("  ✓ clean: no known key shapes, emails, phones, personal paths or private names; package complete")
        return 0
    print(f"  {len(findings)} findings, {len(missing)} missing — fix before sharing")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
