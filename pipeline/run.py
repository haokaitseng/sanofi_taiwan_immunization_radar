"""Pipeline entry point.

    python -m pipeline.run collect                 # daily: last 7 days from every keyless source
    python -m pipeline.run collect --backfill      # first run: last 90 days
    python -m pipeline.run collect --only cdc,ptt  # a subset, for testing

Each source runs in isolation: one failing collector is recorded in data/status.json and the rest carry on.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback
from datetime import datetime

from . import config
from .collect import SOURCES, wiki
from .common import NotConfigured, days_ago, save_items, scrub_social, today

STATUS_FILE = config.DATA_DIR / "status.json"
ATTENTION_FILE = config.DATA_DIR / "attention.json"


def _now() -> str:
    return datetime.now(config.TZ).isoformat(timespec="seconds")


def _load(path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def _dump(path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")


def collect(backfill: bool, only: set[str] | None) -> int:
    since = days_ago(config.BACKFILL_DAYS if backfill else config.DAILY_LOOKBACK_DAYS)
    status = _load(STATUS_FILE, {})
    failures = 0
    for name, module in SOURCES.items():
        if only and name not in only:
            continue
        if name in config.LOCAL_ONLY_SOURCES and os.environ.get("GITHUB_ACTIONS") == "true":
            status[name] = {**status.get(name, {}), "local_only": True}
            print(f"[{name}] skipped on cloud runners (local runs only)", flush=True)
            continue
        if name in ("threads", "facebook") and not only and not backfill and today().weekday() not in config.APIFY_WEEKDAYS:
            print(f"[{name}] skipped today (paid source; runs on weekdays {config.APIFY_WEEKDAYS})", flush=True)
            continue
        t0 = time.monotonic()
        print(f"[{name}] collecting since {since} ...", flush=True)
        try:
            items = [i for i in module.collect(since, backfill=backfill) if i.vaccines]
            added = save_items(items)
            status[name] = {"status": "ok", "last_success": _now(), "items": len(items),
                            "new": sum(added.values()), "seconds": round(time.monotonic() - t0, 1)}
            print(f"[{name}] {len(items)} items, {sum(added.values())} new ({status[name]['seconds']}s)", flush=True)
        except NotConfigured as e:
            status[name] = {"status": "pending", "note": str(e)}
            print(f"[{name}] not configured: {e}", flush=True)
        except Exception as e:  # noqa: BLE001 - isolation is the point
            failures += 1
            status[name] = {**status.get(name, {}), "status": "failed", "failed_at": _now(),
                            "last_error": f"{type(e).__name__}: {e}"[:300]}
            print(f"[{name}] FAILED: {e}", file=sys.stderr, flush=True)
            traceback.print_exc()
    if not only or "wiki" in only:
        try:
            attention = _load(ATTENTION_FILE, {})
            attention.update(wiki.collect(since))
            _dump(ATTENTION_FILE, attention)
            status["wiki"] = {"status": "ok", "last_success": _now(), "items": len(attention)}
        except Exception as e:  # noqa: BLE001
            failures += 1
            status["wiki"] = {**status.get("wiki", {}), "status": "failed", "failed_at": _now(),
                              "last_error": f"{type(e).__name__}: {e}"[:300]}
    _dump(STATUS_FILE, status)
    return failures


def build_site() -> None:
    from .build import build
    analysis = _load(config.DATA_DIR / "analysis.json", None)
    latest = build(analysis)
    print(f"[build] latest.json: {latest['counts']} | sources: "
          + ", ".join(f"{s['id']}={s['status']}" for s in latest["sources"]), flush=True)


def _ai_step(name: str, fn) -> bool:
    """Run tagger/analyst; on failure keep the previous output and record it, so the site still publishes."""
    status = _load(STATUS_FILE, {})
    t0 = time.monotonic()
    try:
        info = fn()
        status[name] = {"status": "ok", "last_success": _now(), "seconds": round(time.monotonic() - t0, 1),
                        **({k: v for k, v in info.items() if isinstance(v, (int, float, str))} if isinstance(info, dict) else {})}
        ok = True
    except Exception as e:  # noqa: BLE001
        status[name] = {**status.get(name, {}), "status": "failed", "failed_at": _now(), "last_error": f"{type(e).__name__}: {e}"[:300]}
        print(f"[{name}] FAILED: {e}", file=sys.stderr, flush=True)
        traceback.print_exc()
        ok = False
    _dump(STATUS_FILE, status)
    return ok


def tag_step(limit: int | None, dry_run: bool) -> bool:
    from .tag import tag_pending
    def run():
        stats = tag_pending(limit=limit, dry_run=dry_run)
        print(f"[tag] {stats}", flush=True)
        return stats
    return _ai_step("tagger", run) if not dry_run else bool(run() or True)


def analyze_step(dry_run: bool) -> bool:
    from .analyze import analyze
    def run():
        result = analyze(dry_run=dry_run)
        if result:
            print(f"[analyze] {len(result['brief']['entries'])} brief entries, {len(result['narratives'])} narratives, "
                  f"usage {result['usage']}", flush=True)
        return result.get("usage", {}) if result else {}
    return _ai_step("analyst", run) if not dry_run else bool(run() or True)


def zh_step() -> bool:
    """Chinese title/summary for tagged items that lack them (catch-up; new items get them from the tagger)."""
    from .tag import zh_backfill
    def run():
        stats = zh_backfill()
        print(f"[zh] {stats}", flush=True)
        return stats
    return _ai_step("zh_items", run)


def translate_step() -> bool:
    """Traditional Chinese version of the analysis; only untranslated fields are sent."""
    from .translate import translate
    def run():
        stats = translate()
        print(f"[translate] {stats}", flush=True)
        return stats
    return _ai_step("translator", run)


def main(argv: list[str] | None = None) -> int:
    from dotenv import load_dotenv
    load_dotenv(config.ROOT / ".env")   # local runs; in GitHub Actions the variables come from secrets
    p = argparse.ArgumentParser(prog="pipeline.run")
    p.add_argument("step", choices=["collect", "tag", "zh", "analyze", "translate", "scrub", "build", "daily"])
    p.add_argument("--backfill", action="store_true", help=f"collect the last {config.BACKFILL_DAYS} days")
    p.add_argument("--only", default="", help="comma-separated source names")
    p.add_argument("--limit", type=int, default=None, help="tag at most N items (testing)")
    p.add_argument("--dry-run", action="store_true", help="build prompts without calling the API")
    args = p.parse_args(argv)
    only = {s.strip() for s in args.only.split(",") if s.strip()} or None
    if args.step == "collect":
        failures = collect(args.backfill, only)
        # Partial failure is normal (a scraper breaks); the run only fails if every source failed.
        return 1 if failures and failures >= len(only or SOURCES) + (0 if only else 1) else 0
    if args.step == "tag":
        return 0 if tag_step(args.limit, args.dry_run) else 1
    if args.step == "analyze":
        return 0 if analyze_step(args.dry_run) else 1
    if args.step == "zh":
        return 0 if zh_step() else 1
    if args.step == "translate":
        return 0 if translate_step() else 1
    if args.step == "scrub":
        print(f"[scrub] {scrub_social()} social records reduced to paraphrase + tags", flush=True)
        return 0
    if args.step == "build":
        build_site()
        return 0
    if args.step == "daily":
        collect(args.backfill, only)
        tag_step(None, False)
        zh_step()
        print(f"[scrub] {scrub_social()} social records reduced to paraphrase + tags", flush=True)
        analyze_step(False)
        translate_step()  # only fields without a Chinese version are sent
        build_site()      # always publish: yesterday's analysis is reused if today's AI steps failed
    return 0


if __name__ == "__main__":
    sys.exit(main())
