"""TFDA (衛生福利部食品藥物管理署): news, announcements, drug-safety notices and rumour rebuttals."""
from __future__ import annotations

import re
from datetime import date
from urllib.parse import urljoin

from .. import config
from ..common import Item, clean, get, html_text, keyword_vaccines, rfc822_to_date, rss_items

OUTLET = "衛生福利部食品藥物管理署"
BASE = "https://www.fda.gov.tw/TC/"
_PREFILTER = re.compile(config.TFDA_PREFILTER, re.I)
# List rows: <a href="newsContent.aspx?cid=4&id=31743" title="..."> ... </td><td>2026-10-06</td>
_ROW = re.compile(r'<a href="(newsContent\.aspx\?[^"]+)"\s+title="([^"]*)".*?(\d{4}-\d{2}-\d{2})', re.S)


def _item(url: str, title: str, day: str, subtype: str) -> Item | None:
    page = get(url, min_interval=0.5).text
    body = html_text(page, ".edit")
    vac = keyword_vaccines(f"{title} {body}")
    if not vac:
        return None
    return Item(source="tfda", kind="policy", channel="TFDA", url=url, title=title, published=day,
                text=body, outlet=OUTLET, subtype=subtype, vaccines=vac)


def _feeds(since: date) -> list[Item]:
    items = []
    for subtype, url in config.TFDA["rss"].items():
        for row in rss_items(get(url, min_interval=0.5).content):
            day = rfc822_to_date(row["pubDate"])
            if not day or day < since.isoformat() or not _PREFILTER.search(f"{row['title']} {row['description']}"):
                continue
            it = _item(row["link"], row["title"], day, subtype)
            if it:
                items.append(it)
    return items


def _lists(since: date) -> list[Item]:
    items = []
    for subtype, url in config.TFDA["lists"].items():
        for pn in range(1, 30):
            rows = _ROW.findall(get(url, params={"pn": pn}, min_interval=0.5).text)
            if not rows:
                break
            for href, title, day in rows:
                if day >= since.isoformat() and _PREFILTER.search(clean(title)):
                    it = _item(urljoin(BASE, href), clean(title), day, subtype)
                    if it:
                        items.append(it)
            if min(r[2] for r in rows) < since.isoformat():
                break
    return items


def collect(since: date, backfill: bool = False) -> list[Item]:
    # RSS holds the latest 20 per channel; the paginated lists reach further back for the first run.
    return _feeds(since) + (_lists(since) if backfill else [])
