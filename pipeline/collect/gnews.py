"""Google News search RSS (Taiwan, Traditional Chinese edition)."""
from __future__ import annotations

import re
import time
from datetime import date, timedelta

import requests

from .. import config
from ..common import Item, get, keyword_vaccines, rfc822_to_date, rss_items, today

FEED = "https://news.google.com/rss/search"


def _search(q: str, patient: bool = True) -> list[dict]:
    """Google throttles cloud IP ranges now and then (503); back off 30 s, 60 s, 90 s before giving up.
    Once throttling has defeated one search, later ones get a single attempt (patient=False)."""
    params = {"q": q, "hl": "zh-TW", "gl": "TW", "ceid": "TW:zh-Hant"}
    attempts = 4 if patient else 1
    for attempt in range(attempts):
        try:
            return rss_items(get(FEED, params=params, min_interval=4.0).content)
        except requests.RequestException:
            if attempt == attempts - 1:
                raise
            time.sleep(30 * (attempt + 1))
    return []


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


def _add(items: dict[str, Item], row: dict, key: str, since: date) -> None:
    """One search result into the per-run collection; repeat hits only add their search key to found_by."""
    outlet = row["source"]
    # Google appends " - Outlet" to every headline.
    title = re.sub(rf"\s+-\s+{re.escape(outlet)}\s*$", "", row["title"]) if outlet else row["title"]
    day = rfc822_to_date(row["pubDate"])
    if not day or day < since.isoformat() or (outlet and _NON_TW.search(outlet)):
        return
    vac, basis = keyword_vaccines(title), "keyword"
    if not vac and _BROAD.search(title):
        vac, basis = ([key] if key in config.VACCINES else ["flu"]), "query"   # funding searches are about flu
    if not vac:
        return
    it = Item(source="gnews", kind="media", channel="News", url=row["link"], title=title, published=day,
              outlet=outlet, subtype="news", vaccines=vac, vaccine_basis=basis, found_by=[key])
    prev = items.get(it.id)
    if prev is None:
        items[it.id] = it
        return
    prev.found_by = sorted(set(prev.found_by) | {key})
    if prev.vaccine_basis == "query" and basis == "query":
        prev.vaccines = sorted(set(prev.vaccines) | set(vac), key=list(config.VACCINES).index)


def collect(since: date, backfill: bool = False) -> list[Item]:
    items: dict[str, Item] = {}
    done, failures, in_a_row = 0, 0, 0
    for query, key in config.GNEWS_QUERIES:
        for window in _windows(since, backfill):
            if in_a_row >= 3:      # throttled for good: keep what the earlier searches found
                break
            done += 1
            try:
                rows = _search(f"{query} {window}", patient=failures == 0)
            except requests.RequestException as e:
                failures += 1
                in_a_row += 1
                print(f"[gnews] '{query}' {window}: {e}", flush=True)
                continue
            in_a_row = 0
            for row in rows:
                _add(items, row, key, since)
    if in_a_row >= 3:
        print(f"[gnews] stopped early after {in_a_row} failed searches in a row", flush=True)
    if failures and failures == done:
        raise RuntimeError(f"all {failures} Google News searches failed")
    return list(items.values())
