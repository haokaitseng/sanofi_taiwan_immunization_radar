"""Threads (keyword search) and comments on public Facebook pages, via Apify actors.

Every run carries a hard spending cap. Usernames and commenter names are never stored; post text is kept only
until the tagger has paraphrased it (see common.scrub_social).
"""
from __future__ import annotations

import os
from datetime import date, datetime, timedelta
from decimal import Decimal

from .. import config
from ..common import Item, NotConfigured, keyword_vaccines


def _client():
    token = os.environ.get("APIFY_TOKEN")
    if not token:
        raise NotConfigured("APIFY_TOKEN is not set")
    from apify_client import ApifyClient
    return ApifyClient(token)


def _run(actor: str, run_input: dict, cap_usd: float, max_items: int) -> list[dict]:
    run = _client().actor(actor).call(run_input=run_input, max_items=max_items,
                                      max_total_charge_usd=Decimal(str(cap_usd)), run_timeout=timedelta(minutes=15))
    if run is None:
        raise RuntimeError(f"{actor}: run did not finish")
    dataset_id = getattr(run, "default_dataset_id", None) or (run.get("defaultDatasetId") if isinstance(run, dict) else None)
    return list(_client().dataset(dataset_id).iterate_items(clean=True))


def _first(d: dict, *keys, default=None):
    for k in keys:
        v = d.get(k)
        if v not in (None, ""):
            return v
    return default


def _day(value) -> str | None:
    if value in (None, ""):
        return None
    try:
        if isinstance(value, (int, float)) or str(value).isdigit():
            ts = float(value) / (1000 if float(value) > 1e11 else 1)
            return datetime.fromtimestamp(ts, config.TZ).date().isoformat()
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(config.TZ).date().isoformat()
    except (ValueError, OSError):
        return None


def threads(since: date, backfill: bool = False) -> list[Item]:
    a = config.APIFY["threads"]
    rows = _run(a["actor"], {
        "mode": "search", "keywords": a["keywords"], "search_filter": "recent", "search_language": "chinese",
        "max_posts": a["max_posts_backfill" if backfill else "max_posts"], "start_date": since.isoformat(),
    }, cap_usd=a["cap_usd_backfill" if backfill else "cap_usd"], max_items=len(a["keywords"]) * a["max_posts_backfill" if backfill else "max_posts"])
    return parse_threads(rows, since)


def parse_threads(rows: list[dict], since: date) -> list[Item]:
    items: dict[str, Item] = {}
    for r in rows:
        if r.get("is_repost"):
            continue
        text = _first(r, "text_content", "text", "caption", "content", default="")
        url = _first(r, "url", "post_url", "postUrl", "link")
        day = _day(_first(r, "created_at", "createdAt", "taken_at", "timestamp", "date"))
        vac = keyword_vaccines(text)
        if not url or not day or day < since.isoformat() or not vac:
            continue
        engagement = sum(int(_first(r, k, default=0) or 0) for k in ("like_count", "likes", "reply_count", "replies", "repost_count", "reposts"))
        it = Item(source="threads", kind="social", channel="Threads", url=url, title=text[:80], published=day,
                  text=text, outlet="", subtype="post", engagement=engagement, vaccines=vac)
        items.setdefault(it.id, it)
    return list(items.values())


def facebook(since: date, backfill: bool = False) -> list[Item]:
    a = config.APIFY["facebook"]
    newer = f"{(date.today() - since).days} days"
    posts = _run("apify/facebook-posts-scraper", {
        "startUrls": [{"url": u} for u in a["pages"]], "resultsLimit": a["posts_per_page"], "onlyPostsNewerThan": newer,
    }, cap_usd=a["cap_usd"] / 2, max_items=a["posts_per_page"] * len(a["pages"]))
    relevant = []
    for p in posts:
        text = _first(p, "text", "message", default="")
        if keyword_vaccines(text) and _first(p, "url", "postUrl"):
            relevant.append((p, text))
    if not relevant:
        return []
    comments = _run("apify/facebook-comments-scraper", {
        "startUrls": [{"url": _first(p, "url", "postUrl")} for p, _ in relevant],
        "resultsLimit": a["comments_per_post"], "includeNestedComments": False, "viewOption": "RANKED_UNFILTERED",
    }, cap_usd=a["cap_usd"] / 2, max_items=a["comments_per_post"] * len(relevant))
    post_vac = {_first(p, "url", "postUrl"): keyword_vaccines(t) for p, t in relevant}
    page_name = {_first(p, "url", "postUrl"): _first(p, "pageName", "user", default="") for p, _ in relevant}
    items: dict[str, Item] = {}
    for c in comments:
        text = _first(c, "text", "message", default="")
        url = _first(c, "commentUrl", "url")
        post_url = _first(c, "facebookUrl", "postUrl", "inputUrl", default="")
        day = _day(_first(c, "date", "created_time", "timestamp"))
        if not text or not url or not day or day < since.isoformat():
            continue
        vac = keyword_vaccines(text) or post_vac.get(post_url, [])   # a reply on a flu-vaccine post is about that vaccine
        if not vac:
            continue
        outlet = page_name.get(post_url) if isinstance(page_name.get(post_url), str) else ""
        it = Item(source="facebook", kind="social", channel="Facebook", url=url, title=text[:80], published=day, text=text,
                  outlet=f"Comments on {outlet}" if outlet else "Page comments", subtype="comment",
                  engagement=int(_first(c, "likesCount", "likes", default=0) or 0), vaccines=vac,
                  vaccine_basis="keyword" if keyword_vaccines(text) else "query")
        items.setdefault(it.id, it)
    return list(items.values())
