"""PTT (批踢踢) board search: public web pages, fetched politely (one request per second)."""
from __future__ import annotations

import re
from datetime import date, datetime

from bs4 import BeautifulSoup

from .. import config
from ..common import Item, clean, get, keyword_vaccines

BASE = "https://www.ptt.cc"
COOKIES = {"over18": "1"}           # Gossiping and some boards ask for age confirmation
_POST_TIME = re.compile(r"/M\.(\d{9,10})\.A\.")   # post ids embed a Unix timestamp


def _post_day(href: str) -> str | None:
    m = _POST_TIME.search(href)
    return datetime.fromtimestamp(int(m.group(1)), config.TZ).date().isoformat() if m else None


def _search(board: str, keyword: str, page: int) -> list[tuple[str, str]]:
    r = get(f"{BASE}/bbs/{board}/search", params={"q": keyword, "page": page}, cookies=COOKIES, min_interval=1.0)
    soup = BeautifulSoup(r.text, "lxml")
    out = []
    for ent in soup.select("div.r-ent"):
        a = ent.select_one("div.title a")
        if a and a.get("href"):
            out.append((a["href"], a.get_text(strip=True)))
    return out


def _post(href: str) -> tuple[str, int]:
    """Main text (without the header block) and net pushes (推 minus 噓)."""
    soup = BeautifulSoup(get(BASE + href, cookies=COOKIES, min_interval=1.0).text, "lxml")
    main = soup.select_one("#main-content")
    if not main:
        return "", 0
    pushes = main.select("div.push span.push-tag")
    net = sum(1 for p in pushes if "推" in p.text) - sum(1 for p in pushes if "噓" in p.text)
    for tag in main.select("div.article-metaline, div.article-metaline-right, div.push, span.f2"):
        tag.decompose()
    return clean(main.get_text(" ")), net


def collect(since: date, backfill: bool = False) -> list[Item]:
    found: dict[str, tuple[str, str, str]] = {}
    max_pages = 5 if backfill else 1
    for board in config.PTT_BOARDS:
        for kw in config.PTT_KEYWORDS:
            for page in range(1, max_pages + 1):
                rows = _search(board, kw, page)
                if not rows:
                    break
                days = []
                for href, title in rows:
                    day = _post_day(href)
                    if day:
                        days.append(day)
                        if day >= since.isoformat():
                            found.setdefault(href, (title, day, board))
                if not days or min(days) < since.isoformat():
                    break
    items = []
    for href, (title, day, board) in found.items():
        body, net = _post(href)
        vac = keyword_vaccines(f"{title} {body[:1500]}")
        if vac:
            items.append(Item(source="ptt", kind="social", channel="PTT", url=BASE + href, title=title, published=day,
                              text=body, outlet=board, subtype="post", engagement=net, vaccines=vac))
    return items
