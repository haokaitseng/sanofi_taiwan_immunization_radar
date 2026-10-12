# Taiwan Immunization Radar

English · [中文說明](#中文說明)

A public, self-updating dashboard of vaccine **policy** and **public conversation** in Taiwan for flu (general,
enhanced, adjuvanted, high-dose), RSV (including infant antibodies such as nirsevimab), Tdap/pertussis and
COVID-19 vaccines (Moderna and Novavax XFG).

**Live dashboard:** https://haokaitseng.github.io/sanofi_taiwan_immunization_radar/

Independent portfolio project. Not affiliated with or endorsed by any company or agency named. Not medical advice.

## What's on the dashboard

Four tabs plus the Sanofi lens, all in English and Traditional Chinese (switch at the top right). Every chart has a
table view, and every AI-written sentence links to the sources it rests on.

### Common to the pages

- **Header (every page):** last update time, GitHub link, light/dark theme and the EN / 中文 switch. On the
  dashboard, a strip of status lights shows whether each data source collected successfully.
- **Filters (Today, Policy and Social listening),** in one row above the content they scope:
  - date range (7, 30 or 90 days) and vaccines (Flu, Enhanced, Adjuvanted, High-dose, RSV, Tdap, COVID-19);
  - **Who pays:** publicly funded (公費), self-pay (自費), both or not stated;
  - **COVID-19 brand:** Moderna, Novavax, both or not stated;
  - **Place:** one of Taiwan's 22 cities and counties.

  The filters combine freely. Items about a specific city or county carry a place badge; national items have none.

### Today

- **Daily brief:** the 4-6 most important developments of the last 72 hours, ranked for a vaccine public-affairs
  lead. Each is marked as policy, media or social signal and has a confidence level, "why it matters", sources and
  who-pays / brand badges. Next to it: a watch list of upcoming dates and three questions a public-affairs lead
  would ask today.
- **Headline figures:** mentions, official actions, share of hesitant or opposed posts, rising narratives and the
  self-pay share of the conversation, most compared with the previous period.
- **Conversation volume and policy moments:** daily mentions per vaccine (7-day average) with numbered markers for
  Taiwan CDC and TFDA actions.
- **Who pays:** each vaccine's mentions split into publicly funded, self-pay, both and not stated, plus a publicly
  funded vs self-pay trend.
- **COVID-19 brands:** which brands COVID-19 mentions name (Moderna, Novavax, both, neither) and each brand over
  time.
- **Stance and issues:** stance toward vaccination on a scale adapted from the WHO SAGE hesitancy continuum, and
  how much each vaccine's conversation touches eligibility, cost, safety, effectiveness, supply and outbreaks.
- **Emerging and rising narratives:** storylines gaining momentum, each with a link or two to original articles or
  posts for cross-checking.

### Policy

A timeline of official actions from Taiwan CDC and TFDA only: press releases, letters to physicians,
clarifications, announcements, drug-safety notices and rumour rebuttals. Each shows the original Chinese title,
an AI summary and why it matters, with a link to the original notice. Beside it are the watch list and a count by
type.

### Social listening

- **Where the conversation happens:** mentions by channel (news, PTT, Threads, comments on public Facebook pages).
- **Where in Taiwan:** a map of mentions about each city or county, switchable to per 100,000 residents (places
  with fewer than 10 mentions are marked as too few to rate). Beside it, the top places with their leading vaccine
  and issue. Click a county or a row to filter the whole page to that place.
- **Public attention:** Wikipedia pageviews, a proxy for curiosity.
- **Narrative explorer:** every tracked storyline with trend, change and net stance.
- **Spike alerts:** days well above the 28-day baseline.
- **Misinformation watch:** recurring misleading claims with a suggested response level, plus official rebuttals.
- **What people are saying:** representative posts, paraphrased and without usernames.

### Methodology

The daily pipeline, every source with its live status, definitions (vaccine groups, COVID-19 brands, who pays,
place, stance scale, evidence tiers, issues), limitations, and the privacy, compliance and AI-use rules.

### Sanofi lens

An unlisted page, linked from the purple banner on the dashboard. It holds independent strategy notes on what the
week's signals could mean for four products: Beyfortus, high-dose flu vaccine (Efluelda), Tdap booster and Novavax
(Nuvaxovid) COVID-19 vaccine. Each card covers the signal, the implication, a suggested public-affairs action,
stakeholders to engage and a risk level. The page also has issues to prepare for in the next 30 days, a self-pay
market watch and compliance guardrails. It contains no product claims and no promotional messaging.

## How it works

```
04:00 Taipei, daily (GitHub Actions; scheduled runs can start late)
  collect   Taiwan CDC · TFDA · Google News · PTT (local runs) · Threads + Facebook page comments (Apify) · Wikipedia
  tag       Claude Haiku 5.5: relevance, vaccine, who pays (公費 / 自費), COVID-19 brand, city or county, issue, stance,
            speaker, storyline, English and Traditional Chinese summaries
  scrub     verbatim social text deleted; only paraphrase, tags and link stay
  analyse   Claude Opus 5.5: daily brief, notes on official actions, narratives, misinformation, analyst lens
  translate Claude Opus 5.5: Traditional Chinese version of the analysis (only new text is sent)
  build     data/items/*.jsonl  ->  site/data/latest.json (+ lens.json)
  publish   commit data (git history = archive) and deploy site/ to GitHub Pages
```

- Each source runs in isolation; a broken scraper turns its status light amber and the run carries on.
- Google News gives headlines only, but its search matches the full article. Each article records which searches
  found it, so a vaccine type (佐劑 / 高劑量), a COVID-19 brand or 公費 / 自費 named only in the body still counts. One term per
  search: the zh-TW feed silently drops most results for `OR` queries.
- If the AI steps fail, yesterday's analysis is reused and the site still publishes.
- Only new items are sent to the tagger, so each item is paid for once.
- The site computes its charts in the browser from coded, text-free rows in `latest.json`, which is why the filters
  combine.

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
- Map boundaries: Ministry of the Interior (data.gov.tw, Open Government Data License), simplified from
  [taiwan-atlas](https://github.com/dkaoster/taiwan-atlas) (MIT). Population for per-100,000 rates: Ministry of the
  Interior, end of July 2026.
- The Sanofi lens (`site/lens/`) is linked from the dashboard's top banner. It is independent analysis, not
  affiliated with Sanofi, and marked `noindex` so search engines don't list it.

## Layout

```
pipeline/   config, collectors, tagger, analyst, build, CLI (python -m pipeline.run)
site/       static dashboard (index.html, app.js, style.css) and lens/ page
data/       items per day, status.json, attention.json, analysis.json
```

---

## 中文說明

**台灣疫苗接種雷達**是一個每天自動更新的公開儀表板，追蹤台灣的疫苗政策與社群輿情。涵蓋流感（含加強型、佐劑、
高劑量）、RSV、Tdap（百日咳）與 COVID-19疫苗（Moderna、Novavax）。

**儀表板網址：** https://haokaitseng.github.io/sanofi_taiwan_immunization_radar/ （右上角可切換中文）

獨立作品集專案，與文中提及的任何公司或機關均無隸屬或背書關係。非醫療建議。

### 頁面功能

- **今日**
  - 每日簡報：AI 整理近 72 小時最重要的動態，附「為何重要」與來源。
  - 關注清單，以及公共事務主管今天會問的三個問題。
  - 關鍵指標與討論聲量趨勢，並標出官方行動的時間點。
  - 公費與自費討論、COVID-19疫苗廠牌（Moderna 與 Novavax）。
  - 民眾立場、議題熱度，以及升溫中的敘事；每則敘事附原文連結可供查證。
- **政策：** 疾管署與食藥署的官方行動時間軸，包括新聞稿、致醫界通函、澄清、公告、藥品安全資訊與闢謠。每則附原始
  標題、摘要與「為何重要」。
- **社群輿情：** 新聞、PTT、Threads 與 Facebook 公開粉專留言的討論量、維基百科瀏覽量、敘事總覽、聲量暴增警示、
  假訊息監測，以及具代表性的貼文。貼文均經改寫，不含使用者名稱。
  - 台灣各縣市地圖：顯示各縣市的相關提及數，可切換為每10萬人比率，旁邊列出提及最多的縣市。點選縣市即可篩選整頁。
- **方法：** 資料流程、各資料來源的即時狀態、名詞定義、限制，以及隱私與 AI 使用原則。
- **Sanofi 視角：** 由首頁上方紫色橫幅進入。針對 Beyfortus、高劑量流感疫苗、Tdap 追加劑與 Novavax COVID-19疫苗
  四項產品的獨立策略筆記，另有未來 30 天需預先準備的議題與自費市場觀察。不含產品宣稱，也不是行銷宣傳。

今日、政策與社群輿情頁面上方可依期間、疫苗、費用來源（公費／自費）、COVID-19 廠牌與縣市篩選，各篩選可以自由組合。
每張圖表都可切換成表格檢視。

### 運作方式

每天清晨，GitHub Actions 會自動完成以下步驟：

1. 收集疾管署、食藥署、Google 新聞、PTT、Threads、Facebook 公開粉專留言與維基百科的資料。
2. 由 Claude Haiku 為每則資料標註疫苗、費用來源、縣市、立場與議題。
3. 由 Claude Opus 撰寫每日簡報與分析，再譯成繁體中文。
4. 自動發布到網站。

如果某個來源當天失敗，其他部分照常更新。

### 隱私

社群貼文只保留數量、標籤與 AI 改寫內容。原文在標註後即刪除，不保存任何使用者名稱或個人資料。只收集公開頁面與
獲許可的資料來源。
