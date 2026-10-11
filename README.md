# Taiwan Immunization Radar

A public, self-updating dashboard of vaccine **policy** and **public conversation** in Taiwan for flu (general,
enhanced, adjuvanted, high-dose), RSV (including infant antibodies such as nirsevimab) and Tdap/pertussis.

Independent portfolio project. Not affiliated with or endorsed by any company or agency named. Not medical advice.

## How it works

```
04:00 Taipei, daily (GitHub Actions; scheduled runs can start late)
  collect   Taiwan CDC · TFDA · Google News · PTT (local runs) · Threads + Facebook page comments (Apify) · Wikipedia
  tag       Claude Haiku 5.5: relevance, vaccine, who pays (公費 / 自費), issue, stance, speaker, storyline,
            English and Traditional Chinese summaries
  scrub     verbatim social text deleted; only paraphrase, tags and link stay
  analyse   Claude Opus 5.5: daily brief, notes on official actions, narratives, misinformation, analyst lens
  translate Claude Opus 5.5: Traditional Chinese version of the analysis (only new text is sent)
  build     data/items/*.jsonl  ->  site/data/latest.json (+ lens.json)
  publish   commit data (git history = archive) and deploy site/ to GitHub Pages
```

- Each source runs in isolation; a broken scraper turns its status light amber and the run carries on.
- Google News gives headlines only, but its search matches the full article. Each article records which searches
  found it, so a vaccine type (佐劑 / 高劑量) or 公費 / 自費 named only in the body still counts. One term per
  search: the zh-TW feed silently drops most results for `OR` queries.
- If the AI steps fail, yesterday's analysis is reused and the site still publishes.
- Only new items are sent to the tagger, so each item is paid for once.

## Run locally

```bash
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt        # macOS/Linux: .venv/bin/pip
cp .env.example .env                                  # then paste your own keys into .env
.venv/Scripts/python -m pipeline.run collect --backfill   # first run: last 90 days
.venv/Scripts/python -m pipeline.run tag
.venv/Scripts/python -m pipeline.run analyze
.venv/Scripts/python -m pipeline.run build
python -m http.server 8766 --directory site           # open http://localhost:8766
```

`--only cdc,ptt` limits collection to some sources; `--dry-run` prints prompts without calling the API.
After changing the tagging rules, `pipeline.run retag` re-tags news and official items (social posts keep their
tags, since their text is gone by then).

## Configuration

| Secret | Used for |
|---|---|
| `ANTHROPIC_API_KEY` | tagging (Haiku 5.5) and the daily analysis (Opus 5.5) |
| `APIFY_TOKEN` | Threads and comments on public Facebook pages (hard USD cap per run) |

Locally they live in `.env` (git-ignored); on GitHub in *Settings → Secrets and variables → Actions*.
Keywords, sources and the vaccine taxonomy are in `pipeline/config.py`.

## Data and privacy

- Social posts are kept as counts, tags and AI paraphrases. Verbatim text is deleted right after tagging
  (`pipeline.run scrub`), and usernames or profile data are never stored, so nothing personal lands in this repo.
- Dcard is not covered: no reliable, permitted collector is available.
- Only public pages and permitted APIs are collected, politely rate-limited.
- The Sanofi lens (`site/lens/`) is linked from the dashboard's top banner. It is independent analysis, not
  affiliated with Sanofi, and marked `noindex` so search engines don't list it.

## Layout

```
pipeline/   config, collectors, tagger, analyst, build, CLI (python -m pipeline.run)
site/       static dashboard (index.html, app.js, style.css) and lens/ page
data/       items per day, status.json, attention.json, analysis.json
```
