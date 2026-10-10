"""Shared pieces: the Item record, a polite HTTP session, parsing helpers, the keyword tagger and storage."""
from __future__ import annotations

import hashlib
import html
import json
import re
import time
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timedelta
from email.utils import parsedate_to_datetime
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from . import config


class NotConfigured(Exception):
    """A source that needs a key nobody has provided yet (shown as 'not connected', not as a failure)."""


@dataclass
class Item:
    source: str              # collector id: cdc, tfda, gnews, gdelt, ptt, threads, dcard, facebook
    kind: str                # evidence tier: policy | media | social
    channel: str             # display channel: Taiwan CDC, TFDA, News, PTT, Threads, Dcard, Facebook
    url: str
    title: str
    published: str           # ISO date in Asia/Taipei, YYYY-MM-DD
    lang: str = "zh"
    text: str = ""           # snippet or first part of the body
    outlet: str = ""         # publisher, PTT board, page name
    subtype: str = ""        # press, letter, clarification, news, announcement, drug_safety, rumor, post
    engagement: int = 0      # PTT pushes, reactions, comments where available
    vaccines: list[str] = field(default_factory=list)
    vaccine_basis: str = "keyword"           # keyword | query (provisional: the search's vaccine; LLM confirms)
    found_by: list[str] = field(default_factory=list)   # keys of the news searches that returned it (config.GNEWS_QUERIES)
    tags: dict = field(default_factory=dict)  # filled by the LLM tagger
    id: str = ""

    def __post_init__(self):
        self.url = canonical_url(self.url)
        if not self.id:
            self.id = hashlib.sha1(self.url.encode("utf-8")).hexdigest()[:16]
        self.title = clean(self.title)
        # Official notices are long and name vaccine types late in the text; posts are deleted after tagging anyway.
        self.text = clean(self.text)[:4000 if self.kind == "policy" else 1200]

    def to_dict(self) -> dict:
        return asdict(self)


# ------------------------------------------------------------------ HTTP
_session: requests.Session | None = None
_last_call: dict[str, float] = {}


def session() -> requests.Session:
    global _session
    if _session is None:
        s = requests.Session()
        s.headers.update({"User-Agent": config.USER_AGENT, "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8"})
        retry = Retry(total=3, backoff_factor=1.5, status_forcelist=(429, 500, 502, 503, 504), allowed_methods=("GET",))
        s.mount("https://", HTTPAdapter(max_retries=retry))
        s.mount("http://", HTTPAdapter(max_retries=retry))
        _session = s
    return _session


def get(url: str, *, params: dict | None = None, min_interval: float = 0.0, timeout: int = 30, **kw) -> requests.Response:
    """GET with retries. min_interval spaces out calls to the same host (politeness / rate limits)."""
    host = urlsplit(url).netloc
    wait = _last_call.get(host, 0) + min_interval - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    try:
        r = session().get(url, params=params, timeout=timeout, **kw)
    finally:
        _last_call[host] = time.monotonic()
    r.raise_for_status()
    return r


# ------------------------------------------------------------------ parsing
_TRACKING = {"utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid"}


def canonical_url(url: str) -> str:
    parts = urlsplit(url.strip())
    query = urlencode([(k, v) for k, v in parse_qsl(parts.query) if k.lower() not in _TRACKING])
    return urlunsplit((parts.scheme.lower() or "https", parts.netloc.lower(), parts.path, query, ""))


def clean(s: str | None) -> str:
    return re.sub(r"\s+", " ", html.unescape(s or "")).strip()


def html_text(markup: str, selector: str | None = None) -> str:
    soup = BeautifulSoup(markup, "lxml")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    node = soup.select_one(selector) if selector else None
    return clean((node or soup).get_text(" "))


def rss_items(xml_bytes: bytes) -> list[dict]:
    """Minimal RSS 2.0 reader (title, link, pubDate, description, source)."""
    root = ET.fromstring(xml_bytes)
    out = []
    for it in root.iter("item"):
        src = it.find("source")
        out.append({
            "title": it.findtext("title") or "",
            "link": it.findtext("link") or "",
            "pubDate": it.findtext("pubDate"),
            "description": it.findtext("description") or "",
            "source": (src.text or "") if src is not None else "",
            "source_url": src.get("url", "") if src is not None else "",
        })
    return out


def rfc822_to_date(s: str | None) -> str | None:
    if not s:
        return None
    try:
        return parsedate_to_datetime(s).astimezone(config.TZ).date().isoformat()
    except (TypeError, ValueError):
        return None


def today() -> date:
    return datetime.now(config.TZ).date()


def days_ago(n: int) -> date:
    return today() - timedelta(days=n)


# ------------------------------------------------------------------ keyword tagger
_RULES = {k: [re.compile(p, re.I) for p in v] for k, v in config.KEYWORDS.items()}
_BRANDS = {k: [re.compile(p, re.I) for p in v] for k, v in config.ENHANCED_BRANDS.items()}
_FLU_CONTEXT = re.compile(config.FLU_CONTEXT, re.I)
_EXCLUDE = re.compile(config.EXCLUDE, re.I)
_ENHANCED_PHRASE = re.compile(r"(?:加強型|高劑量|佐劑(?:型)?)流感疫苗|(?:high[- ]dose|adjuvanted|enhanced) (?:influenza|flu) vaccines?", re.I)


def keyword_vaccines(text: str) -> list[str]:
    """Vaccine groups mentioned in text, by rule. Enhanced types need flu context unless a brand is named."""
    if not text:
        return []
    found = set()
    flu_ctx = bool(_FLU_CONTEXT.search(text))
    for key in ("enh", "adj", "hd"):
        if any(p.search(text) for p in _BRANDS.get(key, [])) or (flu_ctx and any(p.search(text) for p in _RULES[key])):
            found.add(key)
    # "Flu" means flu vaccination in general: ignore matches that only come from an enhanced-type phrase.
    general = _ENHANCED_PHRASE.sub(" ", text)
    if any(p.search(general) for p in _RULES["flu"]):
        found.add("flu")
    for key in ("rsv", "tdap"):
        if any(p.search(text) for p in _RULES[key]):
            found.add(key)
    if _EXCLUDE.search(text):      # animal influenza (e.g. 禽流感疫苗) is out of scope; the LLM tagger refines edge cases
        found.discard("flu")
    return [k for k in config.VACCINES if k in found]


# ------------------------------------------------------------------ storage
def _shares_run(a: str, b: str, n: int) -> bool:
    """True if a and b share a run of at least n characters (whitespace ignored)."""
    a, b = re.sub(r"\s+", "", a), re.sub(r"\s+", "", b)
    if len(a) < n or len(b) < n:
        return False
    grams = {b[i:i + n] for i in range(len(b) - n + 1)}
    return any(a[i:i + n] in grams for i in range(len(a) - n + 1))


def scrub_social() -> int:
    """The repository is public, so verbatim social text never stays in it.

    Tagged social items keep only the English paraphrase (tags.title_en / summary_en), tags, date, channel and
    link; untagged ones lose title and text too. Run after tagging, before every commit.
    """
    changed = 0
    for path in sorted(config.ITEMS_DIR.glob("*.jsonl")):
        records = [json.loads(line) for line in path.open(encoding="utf-8") if line.strip()]
        dirty = False
        for d in records:
            if d["kind"] != "social":
                continue
            tags = d.get("tags") or {}
            original = f"{d.get('title', '')} {d.get('text', '')}"
            for key in ("title_zh", "summary_zh"):      # a "paraphrase" that copies the post is dropped
                if tags.get(key) and _shares_run(tags[key], original, 12):
                    tags[key] = ""
                    dirty = True
            new_title = tags.get("title_en", "")
            if d.get("text") or d.get("title") != new_title:
                d["text"], d["title"] = "", new_title
                dirty = True
                changed += 1
        if dirty:
            with path.open("w", encoding="utf-8") as f:
                for d in records:
                    f.write(json.dumps(d, ensure_ascii=False) + "\n")
    return changed


EVIDENCE_KEYS = {"enh", "adj", "hd", *config.FUNDING_KEYS}


def load_day(day: str) -> dict[str, dict]:
    path = config.ITEMS_DIR / f"{day}.jsonl"
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as f:
        return {d["id"]: d for d in (json.loads(line) for line in f if line.strip())}


def save_items(items: list[Item]) -> dict[str, int]:
    """Merge items into per-day JSONL files; existing records keep their LLM tags. Returns new-item counts per day."""
    by_day: dict[str, list[Item]] = {}
    for it in items:
        by_day.setdefault(it.published, []).append(it)
    added: dict[str, int] = {}
    config.ITEMS_DIR.mkdir(parents=True, exist_ok=True)
    for day, day_items in by_day.items():
        existing = load_day(day)
        n_new = 0
        for it in day_items:
            d = it.to_dict()
            if it.id in existing:
                old = existing[it.id]
                d["tags"] = old.get("tags") or d["tags"]
                d["engagement"] = max(old.get("engagement", 0), d["engagement"])
                before = set(old.get("found_by", []))
                d["found_by"] = sorted(before | set(d["found_by"]))
                # A type or funding search found an already-tagged article: tag it again with the new evidence.
                if d["tags"] and (set(d["found_by"]) - before) & EVIDENCE_KEYS:
                    d["tags"] = {}
            else:
                n_new += 1
            existing[it.id] = d
        path = config.ITEMS_DIR / f"{day}.jsonl"
        with path.open("w", encoding="utf-8") as f:
            for d in sorted(existing.values(), key=lambda x: (x["source"], x["id"])):
                f.write(json.dumps(d, ensure_ascii=False) + "\n")
        added[day] = n_new
    return added
