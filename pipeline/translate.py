"""Translate the day's analysis (brief, notes, narratives, misinformation, lens) into Taiwan Traditional Chinese.

Every translatable string is flattened into a numbered list, so the structured-output schema stays tiny, and
each translation is written back next to its source as <field>_zh. Missing translations fall back to English
on the site. Uses Claude Opus 5.5, like the analysis it translates.
"""
from __future__ import annotations

import json
import os

from . import config

MODEL = "claude-opus-5-5"
ANALYSIS_FILE = config.DATA_DIR / "analysis.json"

# Which fields of analysis.json to translate. "who" is a list of strings.
FIELDS = {
    ("brief", "entries"): ["headline", "why"],
    ("brief", "watch"): ["when", "text"],
    ("brief", "qa"): ["q", "a"],
    ("policy_notes",): ["why"],
    ("narratives",): ["title", "para"],
    ("misinfo",): ["claim", "note"],
    ("lens", "products"): ["name", "sub", "signal", "implication", "action", "who"],
    ("lens", "issues"): ["when", "title", "note"],
    ("lens", "self_pay"): ["title", "note"],
}

SYSTEM = """You translate a vaccine public-affairs dashboard from English into Traditional Chinese for readers in
Taiwan (public-affairs, medical and brand professionals).
- Natural, concise, professional Taiwanese usage: 疫苗接種, 公費, 自費, 衛福部, 疾管署 (for Taiwan CDC),
  食藥署 (for TFDA), 預防接種諮詢委員會 or ACIP. Never Mainland vocabulary or Simplified characters.
- Keep these in English: product and brand names (Beyfortus, nirsevimab, Efluelda, Fluad...), RSV, Tdap, ACIP,
  platform names (PTT, Threads, Facebook, LINE), model names, and any acronym commonly used in English in Taiwan.
- Translate meaning faithfully: do not add, drop or soften facts, hedges, numbers or dates. Keep numbers and
  dates as written (e.g. 2026-11-02, NT$1,950, 1.91 million -> 191萬).
- Short labels (when, names, stakeholder lists) stay short. Return one translation per id."""

SCHEMA = {
    "type": "object",
    "properties": {"items": {"type": "array", "items": {
        "type": "object", "properties": {"id": {"type": "string"}, "zh": {"type": "string"}},
        "required": ["id", "zh"], "additionalProperties": False}}},
    "required": ["items"],
    "additionalProperties": False,
}


def _containers(analysis: dict):
    for path, keys in FIELDS.items():
        node = analysis
        for p in path:
            node = node.get(p, {}) if isinstance(node, dict) else {}
        if isinstance(node, list):
            for obj in node:
                if isinstance(obj, dict):
                    yield path, obj, keys


def translate(force: bool = False) -> dict:
    if not ANALYSIS_FILE.exists():
        return {"strings": 0}
    analysis = json.loads(ANALYSIS_FILE.read_text(encoding="utf-8"))
    strings: dict[str, str] = {}
    targets: dict[str, tuple[dict, str, int | None]] = {}
    for path, obj, keys in _containers(analysis):
        for key in keys:
            if not force and obj.get(f"{key}_zh"):
                continue            # already translated (policy notes accumulate across days)
            value = obj.get(key)
            items = value if isinstance(value, list) else [value]
            for i, text in enumerate(items):
                if isinstance(text, str) and text.strip():
                    sid = f"s{len(strings)}"
                    strings[sid] = text
                    targets[sid] = (obj, key, i if isinstance(value, list) else None)
    if not strings:
        return {"strings": 0}
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise RuntimeError("ANTHROPIC_API_KEY is not set (put it in .env locally or in GitHub secrets)")

    import anthropic
    client = anthropic.Anthropic()
    payload = "Translate each item. Return exactly one record per id.\n\n" + json.dumps(
        [{"id": k, "en": v} for k, v in strings.items()], ensure_ascii=False)
    with client.beta.messages.stream(
        model=MODEL,
        max_tokens=32000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        system=SYSTEM,
        messages=[{"role": "user", "content": payload}],
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
    ) as stream:
        msg = stream.get_final_message()
    if msg.stop_reason in ("refusal", "max_tokens"):
        raise RuntimeError(f"translation stopped: {msg.stop_reason}")
    done = {r["id"]: r["zh"] for r in json.loads(next(b.text for b in msg.content if b.type == "text"))["items"]}

    for sid, zh in done.items():
        if sid not in targets or not zh.strip():
            continue
        obj, key, i = targets[sid]
        if i is None:
            obj[f"{key}_zh"] = zh
        else:
            lst = obj.setdefault(f"{key}_zh", list(obj[key]))   # untranslated entries keep the English
            lst[i] = zh
    analysis.setdefault("usage_translate", {})
    analysis["usage_translate"] = {"input_tokens": msg.usage.input_tokens, "output_tokens": msg.usage.output_tokens}
    ANALYSIS_FILE.write_text(json.dumps(analysis, ensure_ascii=False, indent=1), encoding="utf-8")
    return {"strings": len(strings), "translated": len(done), **analysis["usage_translate"]}
