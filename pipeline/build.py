"""Aggregate stored items into site/data/latest.json (public) and site/data/lens.json (unlisted page).

Everything the dashboard draws comes from these two files. Works with keyword tags only; when the LLM
tagger and analyst have run, stance, issues, funding, COVID-19 brand, narratives, the brief and the lens are
filled in too. Conversation items are published as compact coded rows (no text), so the site computes its
charts in the browser and its filters (who pays, COVID-19 brand) combine freely.
"""
from __future__ import annotations

import json
import re
from collections import Counter
from datetime import date, datetime, timedelta

from . import config
from .common import load_day, today

WINDOW = 180                      # days kept in the series (90 shown + 90 for "vs prior period")
RANGES = (7, 30, 90)
STANCES = ["opposed", "hesitant", "neutral", "accepting", "advocating"]
ISSUES = ["eligibility", "cost", "safety", "effectiveness", "supply", "outbreak"]
CHANNELS = ["News", "PTT", "Threads", "Dcard", "Facebook"]
POLICY_TYPES = {"press": "Press release", "letter": "Letter to physicians", "clarification": "Clarification",
                "news": "News", "announcement": "Announcement", "drug_safety": "Drug safety", "rumor": "Rumour rebuttal"}
FUNDING = ["public", "self_pay", "both", "not_stated"]
FUND_CODE = {"public": "p", "self_pay": "s", "both": "b", "not_stated": "n"}
BRANDS = config.BRANDS
BRAND_CODE = {"moderna": "m", "novavax": "v", "both": "b", "not_stated": "n"}
VAC_ORDER = list(config.VACCINES)
PLACE_ORDER = list(config.COUNTIES)
STANCE_CODE = {"opposed": "o", "hesitant": "h", "neutral": "n", "accepting": "a", "advocating": "v"}

SOURCE_ZH = {  # Chinese display metadata: (name, what is collected, method)
    "cdc": ("疾管署", "新聞稿、致醫界通函、澄清專區", "列表頁＋RSS"),
    "tfda": ("食藥署", "新聞、公告、藥品安全資訊、闢謠專區", "RSS＋列表頁"),
    "gnews": ("Google 新聞", "以疫苗、類型（佐劑、高劑量）、COVID-19 廠牌與公費／自費關鍵字搜尋的台灣中文新聞", "RSS 搜尋"),
    "ptt": ("PTT", "親子、健康與綜合看板的貼文", "公開網頁、低頻率擷取；僅限本機執行（雲端主機被封鎖）"),
    "threads": ("Threads", "符合關鍵字的公開貼文", "Apify 擷取程式"),
    "facebook": ("Facebook", "公部門公開粉專疫苗貼文下的留言", "Apify 擷取程式"),
    "wiki": ("維基百科", "中英文疫苗條目的每日瀏覽量", "Pageviews API"),
}

SOURCE_INFO = [  # display metadata for the status strip and the Methodology table
    ("cdc", "Taiwan CDC", "Policy", "Press releases, letters to physicians, clarifications", "List pages + RSS"),
    ("tfda", "TFDA", "Policy", "News, announcements, drug-safety notices, rumour rebuttals", "RSS + list pages"),
    ("gnews", "Google News", "Media", "zh-TW news from vaccine, vaccine-type (adjuvanted, high-dose), COVID-19 brand and public / self-pay searches", "RSS search"),
    ("ptt", "PTT", "Social", "Posts on parenting, health and general boards", "Public pages, polite crawl; local runs only (blocks cloud servers)"),
    ("threads", "Threads", "Social", "Public posts matching the keyword set", "Apify actor"),
    ("facebook", "Facebook", "Social", "Comments on vaccine posts of public institutional pages", "Apify actors"),
    ("wiki", "Wikipedia", "Attention", "Daily pageviews of zh and en vaccine articles", "Pageviews API"),
]


def _title_key(title: str) -> str:
    return re.sub(r"\W+", "", title.lower())[:40]


_NON_TW = re.compile(config.NON_TAIWAN_OUTLETS, re.I)


def _load_items(end: date) -> list[dict]:
    """Items from the last WINDOW days, minus near-duplicate headlines, non-Taiwan outlets and items the tagger marked irrelevant."""
    items, seen = [], set()
    for back in range(WINDOW - 1, -1, -1):
        day = (end - timedelta(days=back)).isoformat()
        for it in sorted(load_day(day).values(), key=lambda d: (d["kind"] != "policy", d["source"])):
            if it.get("tags", {}).get("relevant") is False:
                continue
            if it["kind"] == "media" and _NON_TW.search(it.get("outlet", "")):
                continue
            # Once the AI tagger has seen an item, its vaccine list wins (keyword tags can be provisional).
            vaccines = it["tags"].get("vaccines", []) if it.get("tags") else it["vaccines"]
            if not vaccines:
                continue
            key = _title_key(it["title"])
            if it["kind"] != "policy" and key in seen:      # same story syndicated by several outlets
                continue
            seen.add(key)
            it["_vaccines"] = vaccines
            items.append(it)
    return items


def _fund(it: dict) -> str:
    return (it.get("tags") or {}).get("funding") or "not_stated"


def _brand(it: dict) -> str:
    """COVID-19 brand named by a COVID-19 item; "" for items that are not about COVID-19."""
    if "covid" not in it.get("_vaccines", (it.get("tags") or {}).get("vaccines", [])):
        return ""
    return (it.get("tags") or {}).get("covid_brand") or "not_stated"


def _model_name(model_id: str) -> str:
    """claude-haiku-5-5 -> Claude Haiku 5.5 (the brief says which model wrote it)."""
    parts = model_id.split("-")
    return f"Claude {parts[1].title()} {'.'.join(parts[2:])}" if len(parts) >= 3 and parts[0] == "claude" else "Claude"


def _places(it: dict) -> list[str]:
    """Cities/counties an item is about, in official order; [] for national items."""
    named = set((it.get("tags") or {}).get("places") or [])
    return [p for p in PLACE_ORDER if p in named]


def _place_bits(it: dict) -> int:
    return sum(1 << PLACE_ORDER.index(p) for p in _places(it))


def _brand_union(items: list[dict]) -> str:
    """Brand of something written from several items: "" when none of them is about COVID-19."""
    named, covid = set(), False
    for it in items:
        b = _brand(it)
        covid |= bool(b)
        named |= {"moderna": {"moderna"}, "novavax": {"novavax"}, "both": {"moderna", "novavax"}}.get(b, set())
    if not covid:
        return ""
    return "both" if len(named) == 2 else (next(iter(named)) if named else "not_stated")


def _row(it: dict, index: dict) -> list[int]:
    """One conversation item as codes: [day, vaccine bits, channel, stance, issue bits, funding, brand, place bits];
    -1 = none (place bits 0 = no city or county)."""
    t = it.get("tags") or {}
    issues = t.get("issues") if t else None
    brand = _brand(it)
    return [index[it["published"]],
            sum(1 << VAC_ORDER.index(v) for v in it["_vaccines"] if v in VAC_ORDER),
            CHANNELS.index(it["channel"]) if it["channel"] in CHANNELS else -1,
            STANCES.index(t["stance"]) if t.get("stance") in STANCES else -1,
            sum(1 << ISSUES.index(i) for i in issues if i in ISSUES) if issues is not None else -1,
            FUNDING.index(_fund(it)),
            BRANDS.index(brand) if brand else -1,
            _place_bits(it)]


def _fund_union(items: list[dict]) -> str:
    """Funding of something written from several items (a brief entry, a claim): 'both' if both appear."""
    said = set()
    for it in items:
        said |= {"public": {"public"}, "self_pay": {"self_pay"}, "both": {"public", "self_pay"}}.get(_fund(it), set())
    return "both" if len(said) == 2 else (next(iter(said)) if said else "not_stated")


def _source_ref(it: dict) -> dict:
    if it["kind"] == "policy":
        label = {"cdc": "Taiwan CDC", "tfda": "TFDA"}.get(it["source"], it["source"])
    elif it["kind"] == "social":
        label = f"{it['channel']} · {it['outlet']}" if it.get("outlet") else it["channel"]
    else:
        label = it.get("outlet") or "News"
    return {"label": label, "url": it["url"]}


def _refs(ids: list[str], by_id: dict) -> list[dict]:
    out, seen = [], set()
    for i in ids:
        if i in by_id and i not in seen:
            seen.add(i)
            out.append(_source_ref(by_id[i]))
    return out


def _example(it: dict) -> dict:
    """A link for cross-checking a narrative: news keep their original headline, posts their paraphrase."""
    t = it.get("tags") or {}
    if it["kind"] == "social":
        label, t_en = it["channel"], t.get("title_en") or t.get("summary_en") or ""
        t_zh = t.get("title_zh") or t.get("summary_zh") or t_en
    else:
        label, t_en, t_zh = it.get("outlet") or "News", t.get("title_en") or it["title"], it["title"]
    return {"label": label, "url": it["url"], "date": it["published"], "t_en": t_en, "t_zh": t_zh, "funding": _fund(it),
            "brand": _brand(it), "kind": it["kind"], "places": _places(it)}


def _narratives(analysis: dict, conv: list[dict], index: dict) -> list[dict]:
    out = []
    for n in analysis.get("narratives", []):
        labels = {s.strip().lower() for s in n.get("storylines", [])}
        mine = [it for it in conv if (it.get("tags", {}).get("storyline") or "").strip().lower() in labels]
        series = [0] * WINDOW
        for it in mine:
            series[index[it["published"]]] += 1
        stances = Counter(it["tags"].get("stance") for it in mine)
        total = sum(stances.values()) or 1
        net = round(100 * (stances["accepting"] + stances["advocating"] - stances["hesitant"] - stances["opposed"]) / total)
        channels = [c for c, _ in Counter(it["channel"] for it in mine).most_common(2)]
        # A pool of candidate links, newest first, covering each funding x brand combination present; the site
        # shows the first one or two that match its filters.
        newest = sorted((it for it in mine if it.get("url")), key=lambda it: it["published"], reverse=True)
        pool, seen = [], set()
        for it in [next((x for x in newest if (_fund(x), _brand(x)) == combo), None)
                   for combo in sorted({(_fund(x), _brand(x)) for x in newest})] + newest:
            if it is not None and it["id"] not in seen and len(pool) < 8:
                seen.add(it["id"])
                pool.append(it)
        examples = [_example(it) for it in sorted(pool, key=lambda it: it["published"], reverse=True)]
        out.append({"id": n["id"], "title": n["title"], "title_zh": n.get("title_zh", ""), "vaccines": n["vaccines"],
                    "status": n["status"], "para": n["para"], "para_zh": n.get("para_zh", ""),
                    "channels": channels, "net": net, "series": series, "mentions": len(mine),
                    # one mark per item [day, funding, stance, brand]: lets the site re-count under its filters
                    "marks": [[index[it["published"]], FUND_CODE[_fund(it)], STANCE_CODE.get(it["tags"].get("stance"), ""),
                               BRAND_CODE.get(_brand(it), ""), _place_bits(it)] for it in mine],
                    "examples": examples})
    return [n for n in out if n["mentions"]]


def _voice(it: dict) -> dict:
    t = it["tags"]
    return {"channel": it["channel"], "vaccine": (t.get("vaccines") or it["vaccines"])[0], "stance": t.get("stance"),
            "text": t.get("summary_en", ""), "text_zh": t.get("summary_zh", ""), "url": it["url"], "funding": _fund(it),
            "brand": _brand(it), "places": _places(it)}


def _fallback_voices(conv: list[dict], since: str, n: int = 6) -> list[dict]:
    """When the analyst picks no examples: the most relevant recent social posts, one per stance first."""
    recent = sorted((it for it in conv if it["kind"] == "social" and it.get("tags") and it["published"] >= since),
                    key=lambda it: (it["tags"].get("pa_relevance", 0), it.get("engagement", 0)), reverse=True)
    picked, stances = [], set()
    for it in recent:                      # first pass: variety of stances
        if it["tags"].get("stance") not in stances:
            picked.append(it)
            stances.add(it["tags"].get("stance"))
    picked += [it for it in recent if it not in picked]   # then fill by relevance
    return [_voice(it) for it in picked[:n]]


def _cited(rows: list[dict], by_id: dict) -> list[dict]:
    """Analyst rows with source_ids resolved to links, and the funding of the items they rest on."""
    out = []
    for r in rows:
        cited = [by_id[i] for i in r["source_ids"] if i in by_id]
        out.append({**{k: v for k, v in r.items() if k != "source_ids"}, "sources": _refs(r["source_ids"], by_id),
                    "funding": _fund_union(cited), "brand": _brand_union(cited),
                    "places": [p for p in PLACE_ORDER if any(p in _places(c) for c in cited)]})
    return out


def build(analysis: dict | None = None) -> dict:
    end = today()
    dates = [(end - timedelta(days=back)).isoformat() for back in range(WINDOW - 1, -1, -1)]
    index = {d: i for i, d in enumerate(dates)}
    items = _load_items(end)
    conv = [it for it in items if it["kind"] != "policy"]          # conversation = media + social

    analysis = analysis or {}
    notes = {n["id"]: n for n in analysis.get("policy_notes", [])}
    policy = []
    for it in items:     # the whole window, so "vs prior 90 days" has something to compare against
        if it["kind"] == "policy":
            t = it.get("tags", {})
            policy.append({
                "id": it["id"], "date": it["published"], "source": it["source"], "vaccines": it["_vaccines"],
                "type": POLICY_TYPES.get(it["subtype"], it["subtype"]), "title_zh": it["title"],
                "title_en": t.get("title_en", ""), "summary": t.get("summary_en", ""), "summary_zh": t.get("summary_zh", ""),
                "why": notes.get(it["id"], {}).get("why", ""), "why_zh": notes.get(it["id"], {}).get("why_zh", ""), "url": it["url"],
                "marker": it["id"] in notes and notes[it["id"]].get("marker", False), "funding": _fund(it), "brand": _brand(it),
                "places": _places(it),
            })
    policy.sort(key=lambda p: p["date"], reverse=True)
    if not notes:   # no analyst run yet: mark the latest press releases on the volume chart
        for p in [p for p in policy if p["type"] == "Press release"][:8]:
            p["marker"] = True

    # Newest news headlines, shown on the Today view until the AI brief exists. News only: no social posts verbatim.
    headlines = [{"date": it["published"], "title": it["title"], "title_en": it.get("tags", {}).get("title_en", ""),
                  "outlet": it["outlet"], "url": it["url"], "vaccines": it["_vaccines"], "funding": _fund(it), "brand": _brand(it),
                  "places": _places(it)}
                 for it in sorted((i for i in conv if i["kind"] == "media"), key=lambda i: i["published"], reverse=True)[:15]]

    attention_raw = json.loads((config.DATA_DIR / "attention.json").read_text(encoding="utf-8")) if (config.DATA_DIR / "attention.json").exists() else {}
    attention = {v: [attention_raw.get(d, {}).get(v) for d in dates] for v in config.WIKI_ARTICLES}

    status = json.loads((config.DATA_DIR / "status.json").read_text(encoding="utf-8")) if (config.DATA_DIR / "status.json").exists() else {}
    sources = []
    for sid, name, kind, what, how in SOURCE_INFO:
        st = status.get(sid)
        if st is None or st.get("status") == "pending":
            state = "pending"
        elif sid in config.LOCAL_ONLY_SOURCES and st.get("last_success"):
            state = "local"
        elif st.get("status") == "ok":
            state = "ok"
        else:
            state = "stale" if st.get("last_success") else "failed"
        zh = SOURCE_ZH.get(sid, (name, what, how))
        sources.append({"id": sid, "name": name, "type": kind, "what": what, "how": how, "status": state,
                        "name_zh": zh[0], "what_zh": zh[1], "how_zh": zh[2],
                        "last_success": (st or {}).get("last_success"), "error": (st or {}).get("last_error") if state != "ok" else None})

    day_files = sorted(p.stem for p in config.ITEMS_DIR.glob("*.jsonl"))
    coverage_start = max(day_files[0], (end - timedelta(days=config.BACKFILL_DAYS)).isoformat()) if day_files else end.isoformat()

    latest = {
        "generated_at": datetime.now(config.TZ).isoformat(timespec="seconds"),
        "as_of": end.isoformat(),
        "coverage_start": coverage_start,   # earlier days are zero because nothing was collected, not because nothing happened
        "dates": dates,
        "vaccines": [{"key": k, **v} for k, v in config.VACCINES.items()],
        # The conversation as coded rows; the site computes volume, stance, issue, channel, funding and brand views.
        "keys": {"vaccines": VAC_ORDER, "channels": CHANNELS, "stance": STANCES, "issues": ISSUES,
                 "funding": FUNDING, "brands": BRANDS, "places": PLACE_ORDER},
        "counties": [{"code": k, **v} for k, v in config.COUNTIES.items()],
        "rows": [_row(it, index) for it in conv],
        "policy": policy,
        "headlines": headlines,
        "attention": attention,
        "sources": sources,
        "counts": {"items": len(items), "conversation": len(conv), "policy": len(policy),
                   "tagged": sum(1 for it in items if it.get("tags"))},
        "brief": None, "narratives": [], "misinfo": [], "voices": [],
    }

    lens = None
    if analysis.get("brief"):
        by_id = {it["id"]: it for it in items}
        b = analysis["brief"]
        latest["brief"] = {
            "date": analysis.get("date", end.isoformat()), "model": _model_name(analysis.get("model", "")),
            "items": analysis.get("items_considered", 0),
            "entries": _cited(b["entries"], by_id),
            "watch": b.get("watch", []), "qa": b.get("qa", []),
        }
        latest["narratives"] = _narratives(analysis, conv, index)
        latest["misinfo"] = _cited(analysis.get("misinfo", []), by_id)
        latest["voices"] = [_voice(it) for it in (by_id[i] for i in analysis.get("voices_ids", []) if i in by_id)
                            if it["kind"] == "social" and it.get("tags")]
        if not latest["voices"]:
            latest["voices"] = _fallback_voices(conv, dates[-14])
        if analysis.get("lens"):
            lens = {
                "title": "Analyst lens: Sanofi vaccines in Taiwan", "date": analysis.get("date", end.isoformat()),
                "products": _cited(analysis["lens"].get("products", []), by_id),
                "issues": analysis["lens"].get("issues", []),
                "self_pay": _cited(analysis["lens"].get("self_pay", []), by_id),
            }

    config.SITE_DATA_DIR.mkdir(parents=True, exist_ok=True)
    (config.SITE_DATA_DIR / "latest.json").write_text(json.dumps(latest, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    if lens:
        (config.SITE_DATA_DIR / "lens.json").write_text(json.dumps(lens, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return latest
