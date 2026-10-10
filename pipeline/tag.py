"""Tag new items with Claude Haiku 5.5: relevance, vaccines, issues, stance, speaker, storyline, English title.

Only items without tags are sent, in batches, so each item is paid for once. Results are written back into
data/items/*.jsonl. Structured output (a JSON schema) guarantees parseable, enum-valid answers.
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
                    "pa_relevance": {"type": "integer", "enum": [1, 2, 3, 4, 5]},
                },
                "required": ["id", "relevant", "vaccines", "issues", "stance", "speaker", "misinformation",
                             "storyline", "title_en", "summary_en", "pa_relevance"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["items"],
    "additionalProperties": False,
}


def _payload(batch: list[dict]) -> str:
    rows = [{"id": it["id"], "channel": it["channel"], "outlet": it["outlet"], "date": it["published"],
             "title": it["title"], "text": it["text"][:600], "keyword_vaccines": it["vaccines"]} for it in batch]
    return "Tag these items. Return exactly one record per id.\n\n" + json.dumps(rows, ensure_ascii=False)


def tag_pending(days: int = config.BACKFILL_DAYS, limit: int | None = None, dry_run: bool = False) -> dict:
    """Tag every untagged item from the last `days` days. Returns counts and token usage."""
    non_tw = re.compile(config.NON_TAIWAN_OUTLETS, re.I)
    pending: list[tuple[str, dict]] = []
    for back in range(days, -1, -1):
        day = days_ago(back).isoformat()
        pending += [(day, it) for it in load_day(day).values()
                    if not it.get("tags") and not (it["kind"] == "media" and non_tw.search(it.get("outlet", "")))]
    if limit:
        pending = pending[:limit]
    stats = {"pending": len(pending), "tagged": 0, "input_tokens": 0, "output_tokens": 0, "batches": 0, "errors": 0}
    if dry_run or not pending:
        if pending:
            print(_payload([it for _, it in pending[:2]])[:800])
        return stats
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise RuntimeError("ANTHROPIC_API_KEY is not set (put it in .env locally or in GitHub secrets)")

    import anthropic
    from concurrent.futures import ThreadPoolExecutor, as_completed
    client = anthropic.Anthropic()
    day_of = {it["id"]: day for day, it in pending}
    batches = [[it for _, it in pending[s:s + BATCH]] for s in range(0, len(pending), BATCH)]

    def call(batch):
        return client.messages.create(
            model=MODEL,
            max_tokens=12000,
            system=[{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": _payload(batch)}],
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
        )

    # A few batches in flight at once; each finished batch is written straight to disk, so a timeout loses little.
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(call, b): n for n, b in enumerate(batches)}
        for fut in as_completed(futures):
            n = futures[fut]
            try:
                resp = fut.result()
            except anthropic.APIStatusError as e:
                stats["errors"] += 1
                print(f"[tag] batch {n + 1} failed: {e.status_code} {e.message}", flush=True)
                continue
            except anthropic.APIConnectionError as e:
                stats["errors"] += 1
                print(f"[tag] batch {n + 1} connection error: {e}", flush=True)
                continue
            stats["batches"] += 1
            stats["input_tokens"] += resp.usage.input_tokens + (resp.usage.cache_read_input_tokens or 0)
            stats["output_tokens"] += resp.usage.output_tokens
            if resp.stop_reason in ("refusal", "max_tokens"):
                stats["errors"] += 1
                print(f"[tag] batch {n + 1} stopped: {resp.stop_reason}", flush=True)
                continue
            text = next((b.text for b in resp.content if b.type == "text"), "")
            results = {rec.pop("id"): rec for rec in json.loads(text).get("items", [])}
            stats["tagged"] += _write_back(results, day_of)
            print(f"[tag] batch {n + 1}/{len(batches)} done", flush=True)
    return stats


def _write_back(results: dict[str, dict], day_of: dict[str, str]) -> int:
    by_day: dict[str, list[str]] = {}
    for i in results:
        if i in day_of:
            by_day.setdefault(day_of[i], []).append(i)
    for day, ids in by_day.items():
        records = load_day(day)
        for i in ids:
            if i in records:
                records[i]["tags"] = {**results[i], "model": MODEL}
        with (config.ITEMS_DIR / f"{day}.jsonl").open("w", encoding="utf-8", newline="\n") as f:
            for d in sorted(records.values(), key=lambda x: (x["source"], x["id"])):
                f.write(json.dumps(d, ensure_ascii=False) + "\n")
    return sum(len(v) for v in by_day.values())
