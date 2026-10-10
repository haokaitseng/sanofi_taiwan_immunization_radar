"""GDELT DOC 2.0 article search, limited to Taiwanese outlets. GDELT allows one request every 5 seconds."""
from __future__ import annotations

import time
from datetime import date, datetime, timedelta, timezone

import requests

from .. import config
from ..common import Item, keyword_vaccines, today

API = "https://api.gdeltproject.org/api/v2/doc/doc"
_last = 0.0


def _articles(query: str, start: date, end: date) -> list[dict]:
    """One search, spaced 6 s from the previous one; a 429 backs off 20 s, 40 s, 60 s (the shared session's fast retries would only extend the block)."""
    global _last
    params = {
        "query": query, "mode": "ArtList", "format": "json", "maxrecords": 250, "sort": "DateDesc",
        "startdatetime": start.strftime("%Y%m%d000000"), "enddatetime": end.strftime("%Y%m%d235959"),
    }
    for attempt in range(4):
        time.sleep(max(0.0, _last + 6.0 - time.monotonic()))
        r = requests.get(API, params=params, headers={"User-Agent": config.USER_AGENT}, timeout=60)
        _last = time.monotonic()
        if r.status_code == 429 and attempt < 3:
            time.sleep(20 * (attempt + 1))
            continue
        r.raise_for_status()
        if "json" not in r.headers.get("content-type", ""):
            raise RuntimeError(f"GDELT returned non-JSON: {r.text[:120]}")
        return r.json().get("articles", []) if r.text.strip() else []
    return []


def collect(since: date, backfill: bool = False) -> list[Item]:
    items: dict[str, Item] = {}
    end = today()
    # GDELT's article search covers roughly the last three months; split backfill into monthly chunks.
    chunks, start = [], since
    while start <= end:
        stop = min(start + timedelta(days=30), end)
        chunks.append((start, stop))
        start = stop + timedelta(days=1)
    for query in config.GDELT_QUERIES:
        for a, b in chunks:
            for art in _articles(query, a, b):
                seen = datetime.strptime(art["seendate"], "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
                day = seen.astimezone(config.TZ).date().isoformat()
                title = art.get("title", "")
                vac = keyword_vaccines(title)
                if day < since.isoformat() or not vac:
                    continue
                lang = "zh" if art.get("language", "").lower().startswith("chinese") else "en"
                it = Item(source="gdelt", kind="media", channel="News", url=art["url"], title=title, published=day,
                          lang=lang, outlet=art.get("domain", ""), subtype="news", vaccines=vac)
                items.setdefault(it.id, it)
    return list(items.values())
