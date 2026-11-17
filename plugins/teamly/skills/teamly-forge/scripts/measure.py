#!/usr/bin/env python3
"""Teamly: count views of the person's own videos for the week, from public pages: no login, no key, no money.

  python3 measure.py views --youtube <channel link or @handle> [--days 7] [--shorts]
  python3 measure.py views --urls <video link> [<video link> ...]          TikTok and YouTube videos
  … --record --team <slug> --agent <slug> [--slot result|agent]           also writes the number (metrics.py add)

YouTube: the channel's public feed (the last 15 uploads with their views); the number is the average views of the
uploads published in the last --days days (--shorts: Shorts only). TikTok: each video's public page.
Instagram has no public route: this script says so and asks for the person's own number (an Insights screenshot);
it never calls anything paid. Output: JSON {"value", "n", "posts", "source", "errors"}.
"""
import json
import os
import re
import statistics
import subprocess
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

YOUTUBE = os.environ.get("TEAMLY_MEASURE_YOUTUBE") or "https://www.youtube.com"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
INSTAGRAM = ("Instagram has no public numbers without login: ask the person for a weekly Insights screenshot or the "
             "number. A paid count with the Teamly key is not offered until it has been checked live.")


def get(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def channel_id(page):
    m = re.search(r'"externalId":"(UC[A-Za-z0-9_-]{22})"', page) or re.search(r"channel_id=(UC[A-Za-z0-9_-]{22})", page)
    return m.group(1) if m else None


def feed_entries(xml):
    out = []
    for e in re.findall(r"<entry>(.*?)</entry>", xml, re.S):
        vid, link = re.search(r"<yt:videoId>([^<]+)</yt:videoId>", e), re.search(r'<link rel="alternate" href="([^"]+)"', e)
        views, published = re.search(r'views="(\d+)"', e), re.search(r"<published>([^<]+)</published>", e)
        if vid and published:
            out.append({"id": vid.group(1), "url": link.group(1) if link else None, "shorts": bool(link and "/shorts/" in link.group(1)),
                        "published": published.group(1), "views": int(views.group(1)) if views else None})
    return out


def youtube_channel(handle, days, shorts_only, now=None):
    if re.fullmatch(r"UC[A-Za-z0-9_-]{22}", handle):
        cid = handle
    else:
        h = handle.strip()
        path = urllib.parse.urlparse(h).path if h.startswith("http") else (h if h.startswith("@") else f"@{h}")
        cid = channel_id(get(f"{YOUTUBE}/{path.lstrip('/')}"))
        if not cid:
            raise ValueError("no channel id on that page: send the channel link (youtube.com/@name)")
    since = (now or datetime.now(timezone.utc)) - timedelta(days=days)
    posts = []
    for x in feed_entries(get(f"{YOUTUBE}/feeds/videos.xml?channel_id={cid}")):
        try:
            when = datetime.fromisoformat(x["published"].replace("Z", "+00:00"))
        except ValueError:
            continue
        if when >= since and x["views"] is not None and (x["shorts"] or not shorts_only):
            posts.append({"url": x["url"], "published": x["published"][:10], "views": x["views"]})
    return posts, f"YouTube channel feed, public, last {days} days{' · Shorts' if shorts_only else ''}"


def tiktok_from_html(html):
    m = re.search(r'<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(.*?)</script>', html, re.S)
    if not m:
        raise ValueError("TikTok page without data (blocked or login)")
    item = (json.loads(m.group(1)).get("__DEFAULT_SCOPE__", {}).get("webapp.video-detail") or {}).get("itemInfo", {}).get("itemStruct")
    if not item:
        raise ValueError("TikTok changed its page: no video data")
    return {"published": datetime.fromtimestamp(int(item["createTime"]), timezone.utc).date().isoformat(),
            "views": int((item.get("stats") or {}).get("playCount") or 0)}


def youtube_video(url):
    m = re.search(r"(?:v=|youtu\.be/|/shorts/)([A-Za-z0-9_-]{11})", url)
    if not m:
        raise ValueError("no video id in the link")
    meta = json.loads(get(f"{YOUTUBE}/oembed?format=json&url=" + urllib.parse.quote(f"https://www.youtube.com/watch?v={m.group(1)}")))
    cid = channel_id(get(meta["author_url"]))
    me = next((x for x in feed_entries(get(f"{YOUTUBE}/feeds/videos.xml?channel_id={cid}")) if x["id"] == m.group(1)), None) if cid else None
    if not me or me["views"] is None:
        raise ValueError("not among the channel's last 15 uploads: no public number for it")
    return {"published": me["published"][:10], "views": me["views"]}


def by_urls(urls):
    posts, errors = [], []
    for u in urls:
        host = urllib.parse.urlparse(u).netloc.lower()
        try:
            if "instagram.com" in host:
                raise ValueError(INSTAGRAM)
            if "tiktok.com" in host:
                row = tiktok_from_html(get(u))
            elif "youtube.com" in host or "youtu.be" in host:
                row = youtube_video(u)
            else:
                raise ValueError("only TikTok and YouTube links have public numbers")
            posts.append({"url": u, **row})
        except Exception as e:  # network, a changed page, a private video: said per link, never guessed
            errors.append(f"{u}: {e}")
    return posts, "public video pages", errors


def main(argv):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if not argv or argv[0] != "views":
        print(__doc__)
        return 2
    flags = {a for a in argv if a in ("--shorts", "--record")}
    rest, opts, urls = [a for a in argv[1:] if a not in flags], {}, []
    while rest:
        a = rest.pop(0)
        if a == "--urls":
            while rest and not rest[0].startswith("--"):
                urls.append(rest.pop(0))
        elif a.startswith("--") and rest:
            opts[a[2:]] = rest.pop(0)
    errors = []
    takes = ("youtube", "days", "urls", "shorts", "record", "team", "agent", "slot")
    odd = [a for a in argv[1:] if a.startswith("--") and a[2:] not in takes]
    try:
        if odd:  # a misspelt flag is said, never skipped
            raise ValueError(f"unknown flag {', '.join(odd)}: views takes {', '.join('--' + k for k in takes)}")
        if opts.get("youtube"):
            posts, source = youtube_channel(opts["youtube"], int(opts.get("days", 7)), "--shorts" in flags)
        elif urls:
            posts, source, errors = by_urls(urls)
        else:
            raise ValueError("views needs --youtube <channel> or --urls <links>")
    except Exception as e:  # offline, no such channel, a changed page
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        return 1
    value = round(statistics.mean(p["views"] for p in posts)) if posts else None
    out = {"ok": value is not None, "value": value, "n": len(posts), "posts": posts, "source": source,
           "errors": errors + ([] if posts else ["no posts with public views in this window: nothing to record"])}
    if "--record" in flags and value is not None:
        slot = opts.get("slot", "result")
        r = subprocess.run([sys.executable, str(Path(__file__).with_name("metrics.py")), "add", "--team", opts.get("team", ""),
                            "--agent", opts.get("agent", ""), f"--{slot}-value", str(value),
                            "--source", f"{source}, {len(posts)} posts", "--note", f"average of {len(posts)}"],
                           capture_output=True, text=True, encoding="utf-8")
        out["recorded"] = r.returncode == 0
        if r.returncode:
            out["errors"].append(r.stdout.strip()[-300:])
    print(json.dumps(out, ensure_ascii=False, indent=1))
    return 0 if out["ok"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
