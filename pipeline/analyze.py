"""Daily analyst run with Claude Opus 5.5: brief, notes on official actions, narratives, misinformation, Sanofi lens.

Input is a compact digest of tagged items (never raw usernames). Output is a JSON schema-constrained object saved
to data/analysis.json, which build.py turns into the dashboard files. Every claim must cite item ids, which
build.py resolves to links.
"""
from __future__ import annotations

import json
import os
from collections import Counter, defaultdict
from datetime import timedelta

from . import config
from .common import days_ago, load_day, today

MODEL = "claude-opus-5-5"
VACCINE_KEYS = list(config.VACCINES)
ANALYSIS_FILE = config.DATA_DIR / "analysis.json"
# Plain string arrays (not enums): the full schema with enums exceeds the structured-output grammar limit.
# Values are checked in _clean() instead.
VAC_ARRAY = {"type": "array", "items": {"type": "string"}}

SYSTEM = """You are the analyst behind a public dashboard that tracks Taiwan's vaccine policy and public conversation
for flu (general, enhanced-type-not-stated, adjuvanted, high-dose), RSV (incl. infant antibodies such as
nirsevimab/Beyfortus) and Tdap/pertussis. Readers are public-affairs and brand professionals at vaccine
companies, plus anyone curious. You receive a digest of items already collected and tagged today.

Write like a sharp public-affairs analyst: concrete, sourced, no hype.
- Every brief entry, lens card and note must rest on the items provided; cite them by id in source_ids.
  Never invent numbers, dates, quotes, organisations or events that are not in the digest.
- Social posts are signals, not facts: say "posts", "parents ask", "users report", never present them as verified.
- Official notices (Taiwan CDC, TFDA) are facts about what the agency said.
- No medical advice and no product claims (no efficacy comparisons in your own voice). Taiwan restricts
  advertising prescription medicines to the public; keep all lens content to strategy and stakeholder
  engagement, never consumer messaging.
- Write for the dashboard reader: never mention "the digest", item ids or how the data was assembled.
- Use English. Keep headlines under 16 words and "why" text to 1-2 sentences.

Sections
1. brief: 4-6 entries ranking what changed in the last 72 hours by importance to a vaccine public-affairs lead.
   type = policy (official notice), media (news coverage) or signal (social conversation). For policy entries
   put the original Chinese title in zh. confidence: High (official/multiple outlets), Medium, Low (thin social signal).
   watch: up to 3 dated things to watch next (dates only if stated in the digest or clearly scheduled).
   qa: 3 questions a public-affairs lead would ask today, with short evidence-based answers.
2. policy_notes: for each official item in the digest, one sentence on why it matters; set marker=true for at
   most 3 of the most significant (they become markers on the volume chart).
3. narratives: group the storyline labels into 4-12 narratives (merge near-duplicates). Keep ids stable across
   days by reusing the previous narratives' ids when the storyline continues. status: emerging (new in the
   last ~7 days), rising, steady or fading, judged from the counts given. para = one-sentence paraphrase.
4. misinfo: recurring false or misleading claims visible in the digest (items flagged misinformation), with
   level monitor / watch / respond and a one-line note on the suggested response. Empty list if none.
5. voices_ids: up to 6 social items that best represent different stances and vaccines (ids only).
6. lens: an unlisted analyst lens for Sanofi's portfolio in Taiwan: exactly three products in this order:
   Beyfortus (nirsevimab; vaccine rsv), high-dose influenza vaccine (vaccine hd), Tdap booster (vaccine tdap).
   For each: what this week's signal is, the implication, a suggested public-affairs action (stakeholder
   engagement, evidence preparation, issue readiness; never promotion), stakeholders to engage, risk level.
   If the digest has little on a product, say so plainly rather than inventing a signal.
   issues: up to 3 issues to prepare for in the next 30 days."""

_entry = {
    "type": "object",
    "properties": {
        "type": {"type": "string", "enum": ["policy", "media", "signal"]},
        "vaccines": VAC_ARRAY,
        "headline": {"type": "string"}, "zh": {"type": "string"}, "why": {"type": "string"},
        "source_ids": {"type": "array", "items": {"type": "string"}},
        "confidence": {"type": "string", "enum": ["High", "Medium", "Low"]},
    },
    "required": ["type", "vaccines", "headline", "zh", "why", "source_ids", "confidence"], "additionalProperties": False,
}
SCHEMA = {
    "type": "object",
    "properties": {
        "brief": {
            "type": "object",
            "properties": {
                "entries": {"type": "array", "items": _entry},
                "watch": {"type": "array", "items": {"type": "object", "properties": {"when": {"type": "string"}, "text": {"type": "string"}},
                                                      "required": ["when", "text"], "additionalProperties": False}},
                "qa": {"type": "array", "items": {"type": "object", "properties": {"q": {"type": "string"}, "a": {"type": "string"}},
                                                   "required": ["q", "a"], "additionalProperties": False}},
            },
            "required": ["entries", "watch", "qa"], "additionalProperties": False,
        },
        "policy_notes": {"type": "array", "items": {"type": "object", "properties": {
            "id": {"type": "string"}, "why": {"type": "string"}, "marker": {"type": "boolean"}},
            "required": ["id", "why", "marker"], "additionalProperties": False}},
        "narratives": {"type": "array", "items": {"type": "object", "properties": {
            "id": {"type": "string"}, "title": {"type": "string"},
            "vaccines": VAC_ARRAY,
            "status": {"type": "string", "enum": ["emerging", "rising", "steady", "fading"]},
            "para": {"type": "string"}, "storylines": {"type": "array", "items": {"type": "string"}}},
            "required": ["id", "title", "vaccines", "status", "para", "storylines"], "additionalProperties": False}},
        "misinfo": {"type": "array", "items": {"type": "object", "properties": {
            "claim": {"type": "string"}, "vaccine": {"type": "string"},
            "level": {"type": "string", "enum": ["monitor", "watch", "respond"]}, "note": {"type": "string"},
            "source_ids": {"type": "array", "items": {"type": "string"}}},
            "required": ["claim", "vaccine", "level", "note", "source_ids"], "additionalProperties": False}},
        "voices_ids": {"type": "array", "items": {"type": "string"}},
        "lens": {"type": "object", "properties": {
            "products": {"type": "array", "items": {"type": "object", "properties": {
                "name": {"type": "string"}, "sub": {"type": "string"}, "vaccine": {"type": "string"},
                "risk": {"type": "string", "enum": ["low", "medium", "high"]},
                "signal": {"type": "string"}, "implication": {"type": "string"}, "action": {"type": "string"},
                "who": {"type": "array", "items": {"type": "string"}}, "source_ids": {"type": "array", "items": {"type": "string"}}},
                "required": ["name", "sub", "vaccine", "risk", "signal", "implication", "action", "who", "source_ids"],
                "additionalProperties": False}},
            "issues": {"type": "array", "items": {"type": "object", "properties": {
                "when": {"type": "string"}, "title": {"type": "string"}, "likelihood": {"type": "string", "enum": ["Low", "Medium", "High"]},
                "impact": {"type": "string", "enum": ["Low", "Medium", "High"]}, "note": {"type": "string"}},
                "required": ["when", "title", "likelihood", "impact", "note"], "additionalProperties": False}}},
            "required": ["products", "issues"], "additionalProperties": False},
    },
    "required": ["brief", "policy_notes", "narratives", "misinfo", "voices_ids", "lens"],
    "additionalProperties": False,
}


PARTS = [("brief", "policy_notes", "misinfo", "voices_ids"), ("narratives", "lens")]


def _items(days: int) -> list[dict]:
    out = []
    for back in range(days - 1, -1, -1):
        out += [it for it in load_day(days_ago(back).isoformat()).values()
                if it.get("tags") and it["tags"].get("relevant")]
    return out


def digest() -> dict:
    """Compact, privacy-safe input for the analyst."""
    end = today()
    items30 = _items(30)
    recent_cut = (end - timedelta(days=3)).isoformat()
    week_cut = (end - timedelta(days=7)).isoformat()
    prior_cut = (end - timedelta(days=14)).isoformat()

    def brief_row(it):
        t = it["tags"]
        return {"id": it["id"], "date": it["published"], "kind": it["kind"], "channel": it["channel"],
                "outlet": it["outlet"] if it["kind"] != "social" else it["channel"],
                "title_en": t.get("title_en"), "summary_en": t.get("summary_en"), "vaccines": t.get("vaccines"),
                "issues": t.get("issues"), "stance": t.get("stance"), "speaker": t.get("speaker"),
                "storyline": t.get("storyline"), "misinformation": t.get("misinformation"),
                "pa_relevance": t.get("pa_relevance"), "engagement": it.get("engagement", 0)}

    policy = [dict(brief_row(it), title_zh=it["title"]) for it in items30
              if it["kind"] == "policy" and it["published"] >= prior_cut]
    recent = sorted((it for it in items30 if it["kind"] != "policy" and it["published"] >= recent_cut),
                    key=lambda it: (it["tags"].get("pa_relevance", 0), it.get("engagement", 0)), reverse=True)[:80]

    counts = {}
    for v in VACCINE_KEYS:
        cur = sum(1 for it in items30 if v in it["tags"]["vaccines"] and it["published"] >= week_cut)
        pri = sum(1 for it in items30 if v in it["tags"]["vaccines"] and prior_cut <= it["published"] < week_cut)
        counts[v] = {"last_7_days": cur, "previous_7_days": pri}

    lines = defaultdict(lambda: {"count_30d": 0, "count_7d": 0, "count_prev_7d": 0, "vaccines": Counter(), "first_seen": None})
    for it in items30:
        s = (it["tags"].get("storyline") or "").strip().lower()
        if not s:
            continue
        rec = lines[s]
        rec["count_30d"] += 1
        rec["count_7d"] += it["published"] >= week_cut
        rec["count_prev_7d"] += prior_cut <= it["published"] < week_cut
        rec["vaccines"].update(it["tags"]["vaccines"])
        rec["first_seen"] = min(rec["first_seen"] or it["published"], it["published"])
    storylines = sorted(({"label": k, **{kk: vv for kk, vv in v.items() if kk != "vaccines"},
                          "vaccines": [x for x, _ in v["vaccines"].most_common(3)]} for k, v in lines.items()),
                        key=lambda r: r["count_30d"], reverse=True)[:120]

    previous = json.loads(ANALYSIS_FILE.read_text(encoding="utf-8")) if ANALYSIS_FILE.exists() else {}
    return {
        "today": end.isoformat(),
        "volume_by_vaccine": counts,
        "official_items_last_14_days": policy,
        "top_items_last_72_hours": [brief_row(it) for it in recent],
        "storylines_last_30_days": storylines,
        "previous_narratives": [{"id": n["id"], "title": n["title"], "status": n["status"]} for n in previous.get("narratives", [])],
    }


def _clean(result: dict) -> dict:
    """Keep only known vaccine keys (the schema can't enforce them without exceeding the grammar limit)."""
    ok = lambda vs: [v for v in vs if v in VACCINE_KEYS]
    for e in result["brief"]["entries"]:
        e["vaccines"] = ok(e["vaccines"])
    for n in result["narratives"]:
        n["vaccines"] = ok(n["vaccines"])
    result["narratives"] = [n for n in result["narratives"] if n["vaccines"]]
    result["misinfo"] = [m for m in result["misinfo"] if m["vaccine"] in VACCINE_KEYS]
    result["lens"]["products"] = [p for p in result["lens"]["products"] if p["vaccine"] in VACCINE_KEYS]
    return result


def analyze(dry_run: bool = False) -> dict:
    d = digest()
    payload = "Today's digest (JSON):\n" + json.dumps(d, ensure_ascii=False)
    if dry_run:
        print(f"[analyze] digest: {len(d['official_items_last_14_days'])} official, {len(d['top_items_last_72_hours'])} recent, "
              f"{len(d['storylines_last_30_days'])} storylines, ~{len(payload) // 2} chars/2")
        return {}
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise RuntimeError("ANTHROPIC_API_KEY is not set (put it in .env locally or in GitHub secrets)")

    import anthropic
    client = anthropic.Anthropic()
    # Server-side fallback: if Opus declines on a safety classifier, the API reruns the request on the
    # recommended fallback model inside the same call.
    # Two calls: the whole schema in one request exceeds the structured-output grammar limit.
    result, usage, model = {}, {"input_tokens": 0, "output_tokens": 0}, MODEL
    for part in PARTS:
        schema = {"type": "object", "properties": {k: SCHEMA["properties"][k] for k in part},
                  "required": list(part), "additionalProperties": False}
        with client.beta.messages.stream(
            model=MODEL,
            max_tokens=32000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            system=SYSTEM,
            messages=[{"role": "user", "content": payload + f"\n\nIn this response, return only these sections: {', '.join(part)}."}],
            output_config={"effort": "high", "format": {"type": "json_schema", "schema": schema}},
        ) as stream:
            msg = stream.get_final_message()
        if msg.stop_reason in ("refusal", "max_tokens"):
            raise RuntimeError(f"analyst run stopped: {msg.stop_reason}")
        result.update(json.loads(next(b.text for b in msg.content if b.type == "text")))
        usage["input_tokens"] += msg.usage.input_tokens
        usage["output_tokens"] += msg.usage.output_tokens
        model = msg.model
    result = _clean(result)

    # Keep notes on older official items from previous runs; today's run only sees the last 14 days.
    previous = json.loads(ANALYSIS_FILE.read_text(encoding="utf-8")) if ANALYSIS_FILE.exists() else {}
    notes = {n["id"]: n for n in previous.get("policy_notes", [])}
    notes.update({n["id"]: n for n in result["policy_notes"]})
    result["policy_notes"] = list(notes.values())
    result["date"] = d["today"]
    result["model"] = model
    result["usage"] = usage
    result["items_considered"] = len(d["top_items_last_72_hours"]) + len(d["official_items_last_14_days"])
    ANALYSIS_FILE.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    return result
