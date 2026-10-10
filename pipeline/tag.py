"""Tag new items with Claude Haiku 5.5: relevance, vaccines, issues, stance, speaker, storyline, and an English
and a Traditional Chinese title/summary for the bilingual site.

Only items without tags are sent, in batches, so each item is paid for once. Results are written back into
data/items/*.jsonl. Structured output (a JSON schema) guarantees parseable, enum-valid answers.
zh_backfill() adds the Chinese fields to items tagged before the site became bilingual.
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
  adj = adjuvanted influenza vaccine (佐劑, e.g. Fluad). hd = high-dose influenza vaccine (高劑量, e.g. Efluelda).
  If an item names both adjuvanted and high-dose, tag both adj and hd (not enh).
  rsv = RSV infant antibodies (e.g. nirsevimab/Beyfortus, clesrovimab), maternal or older-adult RSV vaccines, RSV disease.
  tdap = Tdap / pertussis (百日咳) vaccines or pertussis disease.
  Use [] when relevant is false.
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
                "required": ["id", "relevant", "vaccines", "issues", "stance", "speaker", "misinformation",
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


def _payload(batch: list[dict]) -> str:
    rows = [{"id": it["id"], "channel": it["channel"], "outlet": it["outlet"], "date": it["published"],
             "title": it["title"], "text": it["text"][:600], "keyword_vaccines": it["vaccines"]} for it in batch]
    return "Tag these items. Return exactly one record per id.\n\n" + json.dumps(rows, ensure_ascii=False)


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
                records[i]["tags"] = ({**records[i].get("tags", {}), **results[i]} if merge
                                      else {**results[i], "model": MODEL})
        with (config.ITEMS_DIR / f"{day}.jsonl").open("w", encoding="utf-8", newline="\n") as f:
            for d in sorted(records.values(), key=lambda x: (x["source"], x["id"])):
                f.write(json.dumps(d, ensure_ascii=False) + "\n")
    return sum(len(v) for v in by_day.values())
