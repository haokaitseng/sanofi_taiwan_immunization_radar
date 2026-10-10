"""Taiwan CDC (衛生福利部疾病管制署): press releases, letters to physicians, clarifications."""
from __future__ import annotations

import re
from datetime import date

from .. import config
from ..common import Item, get, html_text, keyword_vaccines, rfc822_to_date, rss_items

OUTLET = "衛生福利部疾病管制署"
# Press-release list rows carry the date as "2026 - 10" plus a day number.
_ROW = re.compile(
    r'<a href="(/Bulletin/Detail/[^"]+)"\s+title="([^"]+)"\s*>.*?'
    r'<p class="icon-year">\s*(\d{4})\s*-\s*(\d{1,2})\s*</p>\s*<p class="icon-date">\s*(\d{1,2})\s*</p>', re.S)
_PUBLISHED = re.compile(r"發佈日期[:：]\s*(\d{4}-\d{2}-\d{2})")
# Titles worth opening during backfill (daily runs open every new release).
_BROAD = re.compile(r"疫苗|接種|流感|呼吸道|百日咳|RSV|長者|嬰|孕", re.I)


def _detail(path_or_url: str) -> tuple[str | None, str]:
    url = path_or_url if path_or_url.startswith("http") else config.CDC["base"] + path_or_url
    page = get(url, min_interval=0.5).text
    m = _PUBLISHED.search(page)
    text = html_text(page, ".news-v3-in")
    body = _PUBLISHED.split(text, maxsplit=1)[-1] if _PUBLISHED.search(text) else text  # drop title/share-button boilerplate
    return (m.group(1) if m else None), body.strip()


def _press(since: date, backfill: bool) -> list[Item]:
    items, max_pages = [], 40 if backfill else 2
    for page in range(1, max_pages + 1):
        html = get(config.CDC["press_list"], params={"page": page}, min_interval=0.5).text
        rows = _ROW.findall(html)
        if not rows:
            break
        oldest = None
        for path, title, y, mth, d in rows:
            day = date(int(y), int(mth), int(d))
            oldest = day if oldest is None else min(oldest, day)
            if day < since or (backfill and not _BROAD.search(title)):
                continue
            _, body = _detail(path)
            vac = keyword_vaccines(f"{title} {body}")
            if vac:
                items.append(Item(source="cdc", kind="policy", channel="Taiwan CDC", url=config.CDC["base"] + path,
                                  title=title, published=day.isoformat(), text=body, outlet=OUTLET,
                                  subtype="press", vaccines=vac))
        if oldest and oldest < since:
            break
    return items


def _feed(url: str, subtype: str, since: date) -> list[Item]:
    items = []
    for row in rss_items(get(url, min_interval=0.5).content):
        title = row["title"]
        if not keyword_vaccines(f"{title} {row['description']}") and not _BROAD.search(title):
            continue
        day = rfc822_to_date(row["pubDate"])
        body = row["description"]
        if row["link"] and "/Bulletin/Detail/" in row["link"]:
            published, body = _detail(row["link"])
            day = day or published
        if not day or day < since.isoformat():
            continue
        vac = keyword_vaccines(f"{title} {body}")
        if vac:
            items.append(Item(source="cdc", kind="policy", channel="Taiwan CDC", url=row["link"] or config.CDC["base"],
                              title=title, published=day, text=body, outlet=OUTLET, subtype=subtype, vaccines=vac))
    return items


def collect(since: date, backfill: bool = False) -> list[Item]:
    return (_press(since, backfill)
            + _feed(config.CDC["letters_rss"], "letter", since)
            + _feed(config.CDC["clarify_rss"], "clarification", since))
