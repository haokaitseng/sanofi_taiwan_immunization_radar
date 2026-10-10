"""Tag new items with Claude Haiku 5.5: relevance, vaccines, funding (公費/自費), issues, stance, speaker, storyline,
and an English and a Traditional Chinese title/summary for the bilingual site.

Only items without tags are sent, in batches, so each item is paid for once. Results are written back into
data/items/*.jsonl. Structured output (a JSON schema) guarantees parseable, enum-valid answers.
News items arrive as headlines only; the news searches that found an article (found_by) stand in for its full
text, and _apply_evidence() turns that evidence into vaccine-type and funding tags.
zh_backfill() and funding_backfill() fill fields added after an item was tagged; retag() re-tags news and
official items when the tagging rules change (social posts keep their tags: their text is gone by then).
"""
from __future__ import annotations

import json
import os
import re

from . import config
from .common import load_day, days_ago

MODEL = "claude-haiku-5-5"
BATCH = 20
WORKERS = 4
VACCINE_KEYS = list(config.VACCINES)
ISSUES = ["eligibility", "cost", "safety", "effectiveness", "supply", "outbreak"]
STANCES = ["opposed", "hesitant", "neutral", "accepting", "advocating"]
SPEAKERS = ["government", "health_professional", "medical_society", "media", "kol", "parent", "older_adult_or_carer",
            "general_public", "industry", "other"]
FUNDING = ["public", "self_pay", "both", "not_stated"]

ZH_STYLE = ("Write natural Traditional Chinese as used in Taiwan (疫苗接種, 公費, 自費, 疾管署, 食藥署, 衛福部); never "
            "Mainland vocabulary or Simplified characters. Keep product names, RSV, Tdap, ACIP and platform names "
            "(PTT, Threads, Facebook) in English.")

SYSTEM = f"""You tag Taiwanese news, official notices and social posts about vaccination for a public-affairs
monitoring dashboard. Read each item (Traditional Chinese or English) and return one tag record per item.

Fields
- relevant: true only if the item is about HUMAN vaccination or the diseases below in a way a vaccine
  public-affairs team would track (programmes, eligibility, access, cost, safety, evidence, supply, disease
  risk, public sentiment). False for animal vaccines, unrelated business news, market-research spam, items
  that only mention a keyword in passing, and local news from Hong Kong, Macau or mainland China that is not
  written for a Taiwanese audience (international developments reported by Taiwanese outlets ARE relevant).
  Hong Kong cues: 甲型流感/乙型流感 (Taiwan says A型/B型流感), 衞生防護中心, 醫管局, 港元, "BB" meaning baby.
  Also false for items whose only vaccines are outside the list below (COVID-19, pneumococcal, shingles, HPV):
  if relevant is true, vaccines must not be empty.
- vaccines: any of {VACCINE_KEYS}.
  flu = influenza vaccination in general or standard-dose vaccines.
  enh = enhanced influenza vaccines (加強型) when the type is NOT stated.
  adj = adjuvanted influenza vaccine (佐劑, 含佐劑, MF59; brand FLUAD = 輔流禦流感疫苗).
  hd = high-dose influenza vaccine (高劑量, "4 倍抗原"; brand Efluelda = 菲優達高劑量三價流感疫苗, Fluzone High-Dose).
  If an item names both adjuvanted and high-dose, tag both adj and hd (not enh).
  Standard-dose brands are flu only, never enhanced: Vaxigrip (菲流達), Fluarix (伏流感), Flucelvax (輔流威護,
  cell-based), AdimFlu-S (安定伏), Fluvacgen (福喜健).
  rsv = RSV infant antibodies (e.g. nirsevimab/Beyfortus, clesrovimab), maternal or older-adult RSV vaccines, RSV disease.
  tdap = Tdap / pertussis (百日咳) vaccines or pertussis disease.
  Use [] when relevant is false.
- funding: who pays for the vaccination the item discusses. public = 公費 (the government-funded programme,
  free for eligible groups); self_pay = 自費 (paid out of pocket, e.g. clinics' own stock, private prices);
  both = the item mentions both, even in passing (e.g. "公費之外也可自費接種"); not_stated = neither is mentioned.
- search_matches (news items only): you see only the headline, but the full article matched these searches,
  so treat them as said in the article: hd = mentions high-dose (高劑量 / 菲優達 / Efluelda); adj = mentions an
  adjuvanted vaccine (佐劑 / 輔流禦 / FLUAD); enh = mentions 加強型流感疫苗; public = mentions 公費;
  self_pay = mentions 自費. They do not change relevance on their own.
- issues: any of {ISSUES} (eligibility and access; cost and self-pay; safety and side effects; effectiveness
  and evidence; supply and availability; disease risk and outbreaks).
- stance toward vaccination expressed by the item: opposed (rejects / anti-vaccine claims), hesitant (delays,
  doubts, asks for reassurance), neutral (news or information without a stance), accepting (has vaccinated or
  intends to), advocating (urges others to vaccinate). Official notices urging vaccination are advocating;
  plain news reports are usually neutral.
- speaker: who is speaking: {SPEAKERS}.
- misinformation: true if the item itself asserts a false or misleading health claim (not if it debunks one).
- storyline: a short English label (3-8 words) for the specific storyline, reusable across items, e.g.
  "Public flu vaccine stock-outs at clinics", "Infant RSV antibody self-pay cost". Lowercase except proper nouns.
- title_en: faithful English translation of the title (keep names; no added claims).
- summary_en: one neutral English sentence on what the item says. For social posts, paraphrase; never quote
  usernames or identifying details.
- title_zh: for news and official items, an empty string (the original title is kept separately). For social
  posts, a short Traditional Chinese headline in your own words. Never copy the post's wording.
- summary_zh: the same sentence as summary_en, in Traditional Chinese. For social posts, paraphrase; never quote.
  {ZH_STYLE}
- pa_relevance: 1-5, how much a vaccine public-affairs lead in Taiwan should care.

Be literal: tag only what the item says. Do not infer stance from the topic alone."""

SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "relevant": {"type": "boolean"},
                    "vaccines": {"type": "array", "items": {"type": "string", "enum": VACCINE_KEYS}},
                    "funding": {"type": "string", "enum": FUNDING},
                    "issues": {"type": "array", "items": {"type": "string", "enum": ISSUES}},
                    "stance": {"type": "string", "enum": STANCES},
                    "speaker": {"type": "string", "enum": SPEAKERS},
                    "misinformation": {"type": "boolean"},
                    "storyline": {"type": "string"},
                    "title_en": {"type": "string"},
                    "summary_en": {"type": "string"},
                    "title_zh": {"type": "string"},
                    "summary_zh": {"type": "string"},
                    "pa_relevance": {"type": "integer", "enum": [1, 2, 3, 4, 5]},
                },
                "required": ["id", "relevant", "vaccines", "funding", "issues", "stance", "speaker", "misinformation",
                             "storyline", "title_en", "summary_en", "title_zh", "summary_zh", "pa_relevance"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["items"],
    "additionalProperties": False,
}

ZH_SYSTEM = f"""You write the Traditional Chinese fields for items on a Taiwanese vaccine-monitoring dashboard.
For each item return:
- title_zh: for kind "social", a short headline paraphrased in your own words from summary_en (never a quote);
  for any other kind, an empty string.
- summary_zh: one neutral sentence with exactly the content of summary_en. Do not add or drop facts.
{ZH_STYLE}"""

ZH_SCHEMA = {
    "type": "object",
    "properties": {"items": {"type": "array", "items": {
        "type": "object",
        "properties": {"id": {"type": "string"}, "title_zh": {"type": "string"}, "summary_zh": {"type": "string"}},
        "required": ["id", "title_zh", "summary_zh"], "additionalProperties": False}}},
    "required": ["items"],
    "additionalProperties": False,
}


FUNDING_SYSTEM = """For each item from a Taiwanese vaccine-monitoring dashboard, say who pays for the vaccination
it discusses, judged from its English summary: public = 公費 (government-funded programme, free for eligible
groups); self_pay = 自費 (out of pocket, clinics' own stock, private prices); both = mentions both, even in
passing; not_stated = neither is mentioned. Be literal."""

FUNDING_SCHEMA = {
    "type": "object",
    "properties": {"items": {"type": "array", "items": {
        "type": "object",
        "properties": {"id": {"type": "string"}, "funding": {"type": "string", "enum": FUNDING}},
        "required": ["id", "funding"], "additionalProperties": False}}},
    "required": ["items"],
    "additionalProperties": False,
}


def _payload(batch: list[dict]) -> str:
    rows = []
    for it in batch:
        row = {"id": it["id"], "channel": it["channel"], "outlet": it["outlet"], "date": it["published"],
               "title": it["title"], "text": it["text"][:3000 if it["kind"] == "policy" else 600],
               "keyword_vaccines": it["vaccines"]}
        if it.get("found_by"):
            row["search_matches"] = it["found_by"]
        rows.append(row)
    return "Tag these items. Return exactly one record per id.\n\n" + json.dumps(rows, ensure_ascii=False)


def _funding_payload(batch: list[dict]) -> str:
    rows = [{"id": it["id"], "summary_en": it["tags"].get("summary_en", ""), "title_en": it["tags"].get("title_en", "")}
            for it in batch]
    return "Label these items. Return exactly one record per id.\n\n" + json.dumps(rows, ensure_ascii=False)


def _apply_evidence(record: dict, found_by: list[str]) -> dict:
    """Search evidence wins over a headline-only reading: a type search hit means the article names that type,
    and a funding search hit means it mentions that funding. Enhanced stays only when no type is named."""
    hits = set(found_by)
    if record.get("relevant"):
        vac = set(record.get("vaccines", [])) | (hits & {"adj", "hd"})
        if "enh" in hits and not vac & {"adj", "hd"}:
            vac.add("enh")
        if vac & {"adj", "hd"}:
            vac.discard("enh")
        record["vaccines"] = [v for v in VACCINE_KEYS if v in vac]
    said = {"public": {"public"}, "self_pay": {"self_pay"}, "both": {"public", "self_pay"}}.get(record.get("funding"), set())
    said |= hits & {"public", "self_pay"}
    record["funding"] = "both" if len(said) == 2 else (next(iter(said)) if said else "not_stated")
    return record


def _zh_payload(batch: list[dict]) -> str:
    rows = [{"id": it["id"], "kind": it["kind"], "summary_en": it["tags"].get("summary_en", "")} for it in batch]
    return "Write the Chinese fields for these items. Return exactly one record per id.\n\n" + json.dumps(rows, ensure_ascii=False)


def _scan(days: int, want) -> list[tuple[str, dict]]:
    out = []
    for back in range(days, -1, -1):
        day = days_ago(back).isoformat()
        out += [(day, it) for it in load_day(day).values() if want(it)]
    return out


def _run_batches(pending: list[tuple[str, dict]], system: str, schema: dict, payload, merge: bool,
                 batch_size: int, label: str) -> dict:
    """Send batches (a few in flight at once) and write each finished batch straight to disk."""
    stats = {"pending": len(pending), "tagged": 0, "input_tokens": 0, "output_tokens": 0, "batches": 0, "errors": 0}
    if not pending:
        return stats
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise RuntimeError("ANTHROPIC_API_KEY is not set (put it in .env locally or in GitHub secrets)")
    import anthropic
    from concurrent.futures import ThreadPoolExecutor, as_completed
    client = anthropic.Anthropic()
    day_of = {it["id"]: day for day, it in pending}
    batches = [[it for _, it in pending[s:s + batch_size]] for s in range(0, len(pending), batch_size)]

    def call(batch):
        return client.messages.create(
            model=MODEL,
            max_tokens=12000,
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": payload(batch)}],
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema}},
        )

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(call, b): n for n, b in enumerate(batches)}
        for fut in as_completed(futures):
            n = futures[fut]
            try:
                resp = fut.result()
            except anthropic.APIStatusError as e:
                stats["errors"] += 1
                print(f"[{label}] batch {n + 1} failed: {e.status_code} {e.message}", flush=True)
                continue
            except anthropic.APIConnectionError as e:
                stats["errors"] += 1
                print(f"[{label}] batch {n + 1} connection error: {e}", flush=True)
                continue
            stats["batches"] += 1
            stats["input_tokens"] += resp.usage.input_tokens + (resp.usage.cache_read_input_tokens or 0)
            stats["output_tokens"] += resp.usage.output_tokens
            if resp.stop_reason in ("refusal", "max_tokens"):
                stats["errors"] += 1
                print(f"[{label}] batch {n + 1} stopped: {resp.stop_reason}", flush=True)
                continue
            text = next((b.text for b in resp.content if b.type == "text"), "")
            results = {rec.pop("id"): rec for rec in json.loads(text).get("items", [])}
            stats["tagged"] += _write_back(results, day_of, merge)
            print(f"[{label}] batch {n + 1}/{len(batches)} done", flush=True)
    return stats


def tag_pending(days: int = config.BACKFILL_DAYS, limit: int | None = None, dry_run: bool = False) -> dict:
    """Tag every untagged item from the last `days` days. Returns counts and token usage."""
    non_tw = re.compile(config.NON_TAIWAN_OUTLETS, re.I)
    pending = _scan(days, lambda it: not it.get("tags") and not (it["kind"] == "media" and non_tw.search(it.get("outlet", ""))))
    if limit:
        pending = pending[:limit]
    if dry_run:
        if pending:
            print(_payload([it for _, it in pending[:2]])[:800])
        return {"pending": len(pending)}
    return _run_batches(pending, SYSTEM, SCHEMA, _payload, merge=False, batch_size=BATCH, label="tag")


def retag(days: int = config.BACKFILL_DAYS) -> dict:
    """Re-tag news and official items under the current rules. Social posts keep their tags (their text is gone)."""
    cleared = 0
    for back in range(days, -1, -1):
        day = days_ago(back).isoformat()
        records = load_day(day)
        hit = [d for d in records.values() if d["kind"] != "social" and d.get("tags")]
        if not hit:
            continue
        for d in hit:
            d["tags"] = {}
        cleared += len(hit)
        with (config.ITEMS_DIR / f"{day}.jsonl").open("w", encoding="utf-8", newline="\n") as f:
            for d in sorted(records.values(), key=lambda x: (x["source"], x["id"])):
                f.write(json.dumps(d, ensure_ascii=False) + "\n")
    return {"cleared": cleared, **tag_pending(days)}


def funding_backfill(days: int = config.BACKFILL_DAYS) -> dict:
    """Funding labels for items tagged before the field existed (social posts: judged from their paraphrase)."""
    pending = _scan(days, lambda it: (it.get("tags") or {}).get("relevant") and "funding" not in it["tags"])
    return _run_batches(pending, FUNDING_SYSTEM, FUNDING_SCHEMA, _funding_payload, merge=True, batch_size=60, label="funding")


def zh_backfill(days: int = config.BACKFILL_DAYS) -> dict:
    """Add title_zh / summary_zh to relevant items that were tagged before the site became bilingual."""
    pending = _scan(days, lambda it: (it.get("tags") or {}).get("relevant") and not it["tags"].get("summary_zh"))
    return _run_batches(pending, ZH_SYSTEM, ZH_SCHEMA, _zh_payload, merge=True, batch_size=40, label="zh")


def _write_back(results: dict[str, dict], day_of: dict[str, str], merge: bool = False) -> int:
    by_day: dict[str, list[str]] = {}
    for i in results:
        if i in day_of:
            by_day.setdefault(day_of[i], []).append(i)
    for day, ids in by_day.items():
        records = load_day(day)
        for i in ids:
            if i in records:
                rec = results[i] if merge else _apply_evidence(results[i], records[i].get("found_by", []))
                records[i]["tags"] = ({**records[i].get("tags", {}), **rec} if merge else {**rec, "model": MODEL})
        with (config.ITEMS_DIR / f"{day}.jsonl").open("w", encoding="utf-8", newline="\n") as f:
            for d in sorted(records.values(), key=lambda x: (x["source"], x["id"])):
                f.write(json.dumps(d, ensure_ascii=False) + "\n")
    return sum(len(v) for v in by_day.values())
