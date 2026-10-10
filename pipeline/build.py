"""Aggregate stored items into site/data/latest.json (public) and site/data/lens.json (unlisted page).

Everything the dashboard draws comes from these two files. Works with keyword tags only; when the LLM
tagger and analyst have run, stance, issues, narratives, the brief and the lens are filled in too.
"""
from __future__ import annotations

import json
import math
import re
from collections import Counter, defaultdict
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

SOURCE_INFO = [  # display metadata for the status strip and the Methodology table
    ("cdc", "Taiwan CDC", "Policy", "Press releases, letters to physicians, clarifications", "List pages + RSS"),
    ("tfda", "TFDA", "Policy", "News, announcements, drug-safety notices, rumour rebuttals", "RSS + list pages"),
    ("gnews", "Google News", "Media", "zh-TW news matching the vaccine keyword set", "RSS search"),
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


def _pct_mix(counter: Counter, keys: list[str]) -> list[float] | None:
    total = sum(counter[k] for k in keys)
    return [round(counter[k] / total, 4) for k in keys] if total >= 5 else None


def _spikes(dates: list[str], series: dict[str, list[int]]) -> list[dict]:
    """Days in the last 30 where a vaccine's volume ran well above its trailing 28-day baseline."""
    out = []
    for vac, vals in series.items():
        for i in range(len(vals) - 30, len(vals)):
            base = vals[max(0, i - 28):i]
            if len(base) < 14:
                continue
            mean = sum(base) / len(base)
            sd = math.sqrt(sum((v - mean) ** 2 for v in base) / len(base)) or 1.0
            z = (vals[i] - mean) / sd
            if z >= 2.5 and vals[i] >= 5 and vals[i] >= 2 * max(mean, 1):
                out.append({"date": dates[i], "vaccine": vac, "z": round(z, 1), "mult": round(vals[i] / max(mean, 1), 1), "count": vals[i]})
    return sorted(out, key=lambda s: s["date"], reverse=True)[:12]


STANCE_SCORE = {"opposed": -1.0, "hesitant": -0.5, "neutral": 0.0, "accepting": 0.5, "advocating": 1.0}
SPEAKERS = {  # speaker tag -> (label, map type)
    "government": ("Government agencies", "gov"), "health_professional": ("Doctors, pharmacists, nurses", "hcp"),
    "medical_society": ("Medical societies", "hcp"), "media": ("News media", "pub"), "kol": ("Health influencers", "pub"),
    "parent": ("Parents", "pub"), "older_adult_or_carer": ("Older adults & carers", "pub"),
    "general_public": ("General public", "pub"), "industry": ("Industry", "pub"),
}


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
        out.append({"id": n["id"], "title": n["title"], "vaccines": n["vaccines"], "status": n["status"], "para": n["para"],
                    "channels": channels, "net": net, "series": series, "mentions": len(mine)})
    return [n for n in out if n["mentions"]]


def _stakeholders(conv: list[dict], since: str) -> list[dict]:
    agg: dict[str, dict] = {}
    for it in conv:
        t = it.get("tags") or {}
        sp = t.get("speaker")
        if it["published"] < since or sp not in SPEAKERS or t.get("stance") not in STANCE_SCORE:
            continue
        a = agg.setdefault(sp, {"n": 0, "eng": 0, "score": 0.0})
        a["n"] += 1
        a["eng"] += max(0, it.get("engagement", 0))
        a["score"] += STANCE_SCORE[t["stance"]]
    pts = [(sp, a) for sp, a in agg.items() if a["n"] >= 3]
    if not pts:
        return []
    weight = {sp: a["n"] + a["eng"] / 10 for sp, a in pts}
    top = max(weight.values())
    return [{"label": SPEAKERS[sp][0], "type": SPEAKERS[sp][1], "stance": round(a["score"] / a["n"], 2),
             "influence": round(10 + 85 * math.sqrt(weight[sp] / top)), "mentions": a["n"]}
            for sp, a in sorted(pts, key=lambda p: -weight[p[0]])]


def build(analysis: dict | None = None) -> dict:
    end = today()
    dates = [(end - timedelta(days=back)).isoformat() for back in range(WINDOW - 1, -1, -1)]
    index = {d: i for i, d in enumerate(dates)}
    items = _load_items(end)
    conv = [it for it in items if it["kind"] != "policy"]          # conversation = media + social

    series = {v: [0] * WINDOW for v in config.VACCINES}
    for it in conv:
        for v in it["_vaccines"]:
            series[v][index[it["published"]]] += 1

    channels, stance, stance_prior, issues = {}, {}, {}, {}
    for r in RANGES:
        lo, prior_lo = dates[-r], dates[-2 * r] if 2 * r <= WINDOW else dates[0]
        cur = [it for it in conv if it["published"] >= lo]
        pri = [it for it in conv if prior_lo <= it["published"] < lo]
        channels[str(r)], stance[str(r)], stance_prior[str(r)], issues[str(r)] = {}, {}, {}, {}
        for v in config.VACCINES:
            mine = [it for it in cur if v in it["_vaccines"]]
            channels[str(r)][v] = dict(Counter(it["channel"] for it in mine))
            stance[str(r)][v] = _pct_mix(Counter(it["tags"].get("stance") for it in mine if it.get("tags")), STANCES)
            stance_prior[str(r)][v] = _pct_mix(Counter(it["tags"].get("stance") for it in pri if v in it["_vaccines"] and it.get("tags")), STANCES)
            tagged = [it for it in mine if it.get("tags", {}).get("issues") is not None]
            issues[str(r)][v] = ([round(100 * sum(1 for it in tagged if i in it["tags"]["issues"]) / len(tagged)) for i in ISSUES]
                                 if len(tagged) >= 5 else None)

    analysis = analysis or {}
    notes = {n["id"]: n for n in analysis.get("policy_notes", [])}
    policy = []
    for it in items:     # the whole window, so "vs prior 90 days" has something to compare against
        if it["kind"] == "policy":
            t = it.get("tags", {})
            policy.append({
                "id": it["id"], "date": it["published"], "source": it["source"], "vaccines": it["_vaccines"],
                "type": POLICY_TYPES.get(it["subtype"], it["subtype"]), "title_zh": it["title"],
                "title_en": t.get("title_en", ""), "summary": t.get("summary_en", ""),
                "why": notes.get(it["id"], {}).get("why", ""), "url": it["url"],
                "marker": it["id"] in notes and notes[it["id"]].get("marker", False),
            })
    policy.sort(key=lambda p: p["date"], reverse=True)
    if not notes:   # no analyst run yet: mark the latest press releases on the volume chart
        for p in [p for p in policy if p["type"] == "Press release"][:8]:
            p["marker"] = True

    # Newest news headlines, shown on the Today view until the AI brief exists. News only: no social posts verbatim.
    headlines = [{"date": it["published"], "title": it["title"], "title_en": it.get("tags", {}).get("title_en", ""),
                  "outlet": it["outlet"], "url": it["url"], "vaccines": it["_vaccines"]}
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
        sources.append({"id": sid, "name": name, "type": kind, "what": what, "how": how, "status": state,
                        "last_success": (st or {}).get("last_success"), "error": (st or {}).get("last_error") if state != "ok" else None})

    day_files = sorted(p.stem for p in config.ITEMS_DIR.glob("*.jsonl"))
    coverage_start = max(day_files[0], (end - timedelta(days=config.BACKFILL_DAYS)).isoformat()) if day_files else end.isoformat()

    latest = {
        "generated_at": datetime.now(config.TZ).isoformat(timespec="seconds"),
        "as_of": end.isoformat(),
        "coverage_start": coverage_start,   # earlier days are zero because nothing was collected, not because nothing happened
        "dates": dates,
        "vaccines": [{"key": k, **v} for k, v in config.VACCINES.items()],
        "series": series,
        "channels": channels,
        "stance": stance,
        "stance_prior": stance_prior,
        "issues": issues,
        "policy": policy,
        "headlines": headlines,
        "spikes": _spikes(dates, series),
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
            "date": analysis.get("date", end.isoformat()), "model": "Claude Opus 5.5",
            "items": analysis.get("items_considered", 0),
            "entries": [{**{k: v for k, v in e.items() if k != "source_ids"}, "sources": _refs(e["source_ids"], by_id)}
                        for e in b["entries"]],
            "watch": b.get("watch", []), "qa": b.get("qa", []),
        }
        latest["narratives"] = _narratives(analysis, conv, index)
        latest["misinfo"] = [{**{k: v for k, v in m.items() if k != "source_ids"}, "sources": _refs(m["source_ids"], by_id)}
                             for m in analysis.get("misinfo", [])]
        latest["voices"] = [{"channel": it["channel"], "vaccine": (it["tags"].get("vaccines") or it["vaccines"])[0],
                             "stance": it["tags"].get("stance"), "text": it["tags"].get("summary_en", ""), "url": it["url"]}
                            for it in (by_id[i] for i in analysis.get("voices_ids", []) if i in by_id)
                            if it["kind"] == "social" and it.get("tags")]
        if analysis.get("lens"):
            lens = {
                "title": "Analyst lens: Sanofi vaccines in Taiwan", "date": analysis.get("date", end.isoformat()),
                "products": [{**{k: v for k, v in p.items() if k != "source_ids"}, "sources": _refs(p["source_ids"], by_id)}
                             for p in analysis["lens"].get("products", [])],
                "issues": analysis["lens"].get("issues", []),
                "stakeholders": _stakeholders(conv, dates[-30]),
            }

    config.SITE_DATA_DIR.mkdir(parents=True, exist_ok=True)
    (config.SITE_DATA_DIR / "latest.json").write_text(json.dumps(latest, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    if lens:
        (config.SITE_DATA_DIR / "lens.json").write_text(json.dumps(lens, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return latest
