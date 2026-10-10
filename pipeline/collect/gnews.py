"""Google News search RSS (Taiwan, Traditional Chinese edition)."""
from __future__ import annotations

import re
from datetime import date, timedelta

from .. import config
from ..common import Item, get, keyword_vaccines, rfc822_to_date, rss_items, today

FEED = "https://news.google.com/rss/search"


def _search(q: str) -> list[dict]:
    params = {"q": q, "hl": "zh-TW", "gl": "TW", "ceid": "TW:zh-Hant"}
    return rss_items(get(FEED, params=params, min_interval=1.5).content)


def _windows(since: date, backfill: bool) -> list[str]:
    """Search operators per request. Each request returns at most 100 results, so backfill goes a week at a time."""
    if not backfill:
        return [f"when:{config.DAILY_LOOKBACK_DAYS}d"]
    out, start, end = [], since, today() + timedelta(days=1)
    while start < end:
        stop = min(start + timedelta(days=7), end)
        out.append(f"after:{start.isoformat()} before:{stop.isoformat()}")
        start = stop
    return out


_BROAD = re.compile(config.BROAD_HEALTH)
_NON_TW = re.compile(config.NON_TAIWAN_OUTLETS, re.I)


def collect(since: date, backfill: bool = False) -> list[Item]:
    items: dict[str, Item] = {}
    for query, hint in config.GNEWS_QUERIES:
        for window in _windows(since, backfill):
            for row in _search(f"{query} {window}"):
                outlet = row["source"]
                # Google appends " - Outlet" to every headline.
                title = re.sub(rf"\s+-\s+{re.escape(outlet)}\s*$", "", row["title"]) if outlet else row["title"]
                day = rfc822_to_date(row["pubDate"])
                if not day or day < since.isoformat() or (outlet and _NON_TW.search(outlet)):
                    continue
                vac, basis = keyword_vaccines(title), "keyword"
                if not vac and _BROAD.search(title):
                    vac, basis = list(hint), "query"
                if not vac:
                    continue
                it = Item(source="gnews", kind="media", channel="News", url=row["link"], title=title, published=day,
                          outlet=outlet, subtype="news", vaccines=vac, vaccine_basis=basis)
                prev = items.get(it.id)
                if prev and prev.vaccine_basis == "query" and basis == "query":
                    prev.vaccines = sorted(set(prev.vaccines) | set(vac), key=list(config.VACCINES).index)
                else:
                    items.setdefault(it.id, it)
    return list(items.values())
