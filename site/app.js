/* Taiwan Immunization Radar: renders data/latest.json (and data/lens.json on the unlisted lens page).
   Colours, marks and interaction follow the validated palette in style.css.
   Two languages: interface strings are written as tr(English, 繁體中文) and data fields carry a _zh twin.
   Static markup holds both versions (data-lang) and CSS hides the inactive one. */
(() => {
'use strict';

/* =========================================================
   Language
   ========================================================= */
const LANG_KEY = 'radar-lang';
let LANG = 'en';
try { LANG = new URLSearchParams(location.search).get('lang') || localStorage.getItem(LANG_KEY) || 'en'; } catch (e) { /* storage unavailable */ }
if (LANG !== 'zh') LANG = 'en';
const ZH = () => LANG === 'zh';
const tr = (en, zh) => (LANG === 'zh' ? zh : en);
// A data field in the current language; English where no translation exists.
const L = (o, k) => (o ? (LANG === 'zh' && o[k + '_zh']) || o[k] || '' : '');
// Properties that read in the current language: loc({ key: 'x' }, { label: ['Opposed', '反對'] }).
function loc(base, pairs) {
  for (const [k, [en, zh]] of Object.entries(pairs)) Object.defineProperty(base, k, { get: () => tr(en, zh), enumerable: true });
  return base;
}

/* =========================================================
   Helpers
   ========================================================= */
const $ = (s, r = document) => r.querySelector(s);

// Builds DOM with text nodes only, so text from data is never parsed as HTML.
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c instanceof Node ? c : String(c));
  return e;
}
const NS = 'http://www.w3.org/2000/svg';
function sv(tag, attrs, ...kids) {
  const e = document.createElementNS(NS, tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c);
  return e;
}
const nf = new Intl.NumberFormat('en-US');
const fmt = n => nf.format(Math.round(n));
const fmtAvg = v => (v < 10 ? v.toFixed(1) : fmt(v));
const compact = n => (n < 10000 ? fmt(n) : ZH()
  ? (n / 10000).toFixed(1).replace(/\.0$/, '') + '萬'
  : (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K');
const pct = (x, d = 0) => (x * 100).toFixed(d) + '%';
const fmtDate = (d, o = { month: 'short', day: 'numeric' }) => d.toLocaleDateString(ZH() ? 'zh-TW' : 'en-US', { ...o, timeZone: 'UTC' });
const asDate = iso => new Date(iso + 'T00:00:00Z');
const sum = a => a.reduce((s, v) => s + (v || 0), 0);
const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
// Rough label width in px at 13px: CJK characters are about twice as wide as Latin ones.
const textWidth = s => [...s].reduce((w, c) => w + (/[⺀-鿿＀-￯]/.test(c) ? 13 : 7.2), 0);

/* =========================================================
   Vocabulary
   ========================================================= */
const VAC_TEXT = {
  flu: { label: ['Flu', '流感'], short: ['Flu', '流感'] },
  enh: { label: ['Enhanced', '加強型'], short: ['Enh.', '加強型'] },
  adj: { label: ['Adjuvanted', '佐劑'], short: ['Adj.', '佐劑'] },
  hd: { label: ['High-dose', '高劑量'], short: ['HD', '高劑量'] },
  rsv: { label: ['RSV', 'RSV'], short: ['RSV', 'RSV'] },
  tdap: { label: ['Tdap', 'Tdap'], short: ['Tdap', 'Tdap'] },
  covid: { label: ['COVID-19', 'COVID-19'], short: ['COVID', 'COVID'] },
};
const STANCE = [
  loc({ key: 'opposed', v: '--st-opp' }, { label: ['Opposed', '反對'] }),
  loc({ key: 'hesitant', v: '--st-hes' }, { label: ['Hesitant', '猶豫'] }),
  loc({ key: 'neutral', v: '--st-neu' }, { label: ['Neutral', '中立'] }),
  loc({ key: 'accepting', v: '--st-acc' }, { label: ['Accepting', '接受'] }),
  loc({ key: 'advocating', v: '--st-adv' }, { label: ['Advocating', '倡議'] }),
];
const STANCE_BY_KEY = Object.fromEntries(STANCE.map(s => [s.key, s]));
const ISSUES = [
  loc({}, { short: ['Eligibility', '資格'], long: ['Eligibility and access', '接種資格與可近性'] }),
  loc({}, { short: ['Cost', '費用'], long: ['Cost and self-pay', '費用與自費'] }),
  loc({}, { short: ['Safety', '安全'], long: ['Safety and side effects', '安全性與副作用'] }),
  loc({}, { short: ['Evidence', '效果'], long: ['Effectiveness and evidence', '效果與科學證據'] }),
  loc({}, { short: ['Supply', '供應'], long: ['Supply and availability', '供應與取得'] }),
  loc({}, { short: ['Outbreaks', '疫情'], long: ['Disease risk and outbreaks', '疾病風險與疫情'] }),
];
const CHANNELS = [
  loc({ key: 'News' }, { label: ['News', '新聞'] }),
  loc({ key: 'PTT' }, { label: ['PTT', 'PTT'] }),
  loc({ key: 'Threads' }, { label: ['Threads', 'Threads'] }),
  loc({ key: 'Facebook' }, { label: ['Facebook pages', 'Facebook 粉專'] }),
];
const channelShort = k => (k === 'News' ? tr('News', '新聞') : k);
const NSTATUS = {
  emerging: loc({ icon: '✦' }, { label: ['Emerging', '新興'] }),
  rising: loc({ icon: '↗' }, { label: ['Rising', '升溫'] }),
  steady: loc({ icon: '→' }, { label: ['Steady', '持平'] }),
  fading: loc({ icon: '↘' }, { label: ['Fading', '退燒'] }),
};
const TYPES = {
  policy: loc({ glyph: '▲' }, { label: ['Policy', '政策'], title: ['Official notice from Taiwan CDC or TFDA', '疾管署或食藥署的官方公告'] }),
  media: loc({ glyph: '■' }, { label: ['Media', '媒體'], title: ['News reporting', '新聞報導'] }),
  signal: loc({ glyph: '◆' }, { label: ['Signal', '社群訊號'], title: ['Social-media signal: volume and narrative, not validated evidence', '社群媒體訊號：反映聲量與敘事，並非經驗證的證據'] }),
};
const SRC_STATUS = {
  ok: ['good', 'OK', '正常'], stale: ['warning', 'Stale', '資料過期'], failed: ['critical', 'Failed', '失敗'],
  pending: ['pending', 'Not connected yet', '尚未連線'], local: ['good', 'Local runs only', '僅限本機執行'],
};
const srcLevel = st => (SRC_STATUS[st] || SRC_STATUS.pending)[0];
const srcLabel = st => { const s = SRC_STATUS[st] || SRC_STATUS.pending; return tr(s[1], s[2]); };
const SRC_TYPE_ZH = { Policy: '政策', Media: '媒體', Social: '社群', Attention: '關注度' };
const POLICY_TYPE_ZH = { 'Press release': '新聞稿', 'Letter to physicians': '致醫界通函', Clarification: '澄清', News: '新聞',
  Announcement: '公告', 'Drug safety': '藥品安全', 'Rumour rebuttal': '闢謠' };
const policyType = t => tr(t, POLICY_TYPE_ZH[t] || t);
const LEVEL_ZH = { high: '高', medium: '中', low: '低' };
const hml = v => tr(v, LEVEL_ZH[String(v).toLowerCase()] || v);   // High / Medium / Low
// Who pays (公費 / 自費). Exclusive labels per item; the filter's 公費 and 自費 views also include "both".
const FUNDING = ['public', 'self_pay', 'both', 'not_stated'];
const FUND_TEXT = {
  public: loc({ v: '--f-pub' }, { label: ['Public', '公費'], badge: ['Publicly funded', '公費'] }),
  self_pay: loc({ v: '--f-self' }, { label: ['Self-pay', '自費'], badge: ['Self-pay', '自費'] }),
  both: loc({ v: '--f-both' }, { label: ['Both', '公費＋自費'], badge: ['Public + self-pay', '公費＋自費'] }),
  not_stated: loc({ v: '--f-ns' }, { label: ['Not stated', '未說明'], badge: ['Not stated', '未說明'] }),
};
const FUND_VIEWS = { public: ['public', 'both'], self_pay: ['self_pay', 'both'], both: ['both'], not_stated: ['not_stated'] };
const FUND_CODE = { p: 'public', s: 'self_pay', b: 'both', n: 'not_stated' };
const inFund = f => state.funding === 'all' || FUND_VIEWS[state.funding].includes(f || 'not_stated');
// COVID-19 brands. Exclusive label per COVID-19 item; the filter's Moderna and Novavax views also include "both".
const BRANDS = ['moderna', 'novavax', 'both', 'not_stated'];
const BRAND_TEXT = {
  moderna: loc({}, { label: ['Moderna', 'Moderna'], badge: ['Moderna', 'Moderna'] }),
  novavax: loc({}, { label: ['Novavax', 'Novavax'], badge: ['Novavax', 'Novavax'] }),
  both: loc({}, { label: ['Both', '兩者'], badge: ['Moderna + Novavax', 'Moderna＋Novavax'] }),
  not_stated: loc({}, { label: ['Not stated', '未說明'], badge: ['Brand not stated', '未說明廠牌'] }),
};
const BRAND_VIEWS = { moderna: ['moderna', 'both'], novavax: ['novavax', 'both'], both: ['both'], not_stated: ['not_stated'] };
const BRAND_CODE = { m: 'moderna', v: 'novavax', b: 'both', n: 'not_stated' };
// Items that are not about COVID-19 have no brand ('') and show only while the brand filter is off.
const inBrand = b => state.brand === 'all' || (!!b && BRAND_VIEWS[state.brand].includes(b));

/* =========================================================
   Data
   ========================================================= */
let D = null, LENS = null, N = 0, DATES = [], VACCINES = [], VAC_KEYS = [], VAC = {}, PLACES = [], PLACE_IDX = {}, DATA_BASE = '';
const state = { view: 'today', range: 90, vac: new Set(), source: 'all', channel: 'all', funding: 'all', brand: 'all',
  place: 'all', placeMetric: 'count' };

function useData(data) {
  D = data;
  N = D.dates.length;
  DATES = D.dates.map(asDate);
  VACCINES = D.vaccines.map(v => loc({ key: v.key, zh: v.zh }, VAC_TEXT[v.key] || { label: [v.label, v.label], short: [v.label, v.label] }));
  VAC_KEYS = VACCINES.map(v => v.key);
  VAC = Object.fromEntries(VACCINES.map(v => [v.key, v]));
  PLACES = D.counties || [];
  PLACE_IDX = Object.fromEntries(PLACES.map((c, i) => [c.code, i]));
  state.vac = new Set(VAC_KEYS);
}
// The conversation arrives as coded rows [day, vaccine bits, channel, stance, issue bits, funding, brand]
// (build.py _row; -1 = none). Charts are computed here, so the who-pays and brand filters combine freely.
const rowFund = r => D.keys.funding[r[5]];
const rowBrand = r => (r[6] >= 0 ? D.keys.brands[r[6]] : '');
const rowPlaces = r => r[7] || 0;
// Place filter: items about the chosen city or county. National items (no place) show only while it is off.
const inPlaceBits = bits => state.place === 'all' || !!(bits & (1 << PLACE_IDX[state.place]));
const inPlace = codes => state.place === 'all' || (codes || []).includes(state.place);
const shortEn = en => (/^(Hsinchu|Chiayi) /.test(en) ? en : en.replace(/ (City|County)$/, ''));
const placeOf = code => PLACES[PLACE_IDX[code]];
const placeName = code => (placeOf(code) ? tr(shortEn(placeOf(code).en), placeOf(code).zh) : code);
const placeLong = code => (placeOf(code) ? tr(placeOf(code).en, placeOf(code).zh) : code);
const mixOf = rows => {      // stance shares among tagged rows; null below 5, like the old server-side figures
  const c = [0, 0, 0, 0, 0];
  let t = 0;
  for (const r of rows) if (r[3] >= 0) { c[r[3]]++; t++; }
  return t >= 5 ? c.map(x => Math.round(x / t * 1e4) / 1e4) : null;
};
// Days in the last 30 where a vaccine's volume ran well above its trailing 28-day baseline.
function spikesOf(series) {
  const out = [];
  for (const [vac, vals] of Object.entries(series)) {
    for (let i = vals.length - 30; i < vals.length; i++) {
      const base = vals.slice(Math.max(0, i - 28), i);
      if (base.length < 14) continue;
      const mean = sum(base) / base.length;
      const sd = Math.sqrt(sum(base.map(v => (v - mean) ** 2)) / base.length) || 1;
      const z = (vals[i] - mean) / sd;
      if (z >= 2.5 && vals[i] >= 5 && vals[i] >= 2 * Math.max(mean, 1)) {
        out.push({ date: D.dates[i], vaccine: vac, z: Math.round(z * 10) / 10, mult: Math.round(vals[i] / Math.max(mean, 1) * 10) / 10, count: vals[i] });
      }
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
}
// Volume, channel, stance and issue views for the rows that pass `keep`, in the shape the charts read.
function aggregate(keep) {
  const V = D.keys.vaccines, rows = D.rows.filter(keep);
  const series = Object.fromEntries(V.map(v => [v, new Array(N).fill(0)]));
  for (const r of rows) V.forEach((v, j) => { if (r[1] & (1 << j)) series[v][r[0]]++; });
  const out = { series, channels: {}, stance: {}, stance_prior: {}, issues: {}, spikes: spikesOf(series) };
  for (const R of [7, 30, 90]) {
    const lo = N - R, plo = Math.max(0, N - 2 * R);
    for (const k of ['channels', 'stance', 'stance_prior', 'issues']) out[k][R] = {};
    V.forEach((v, j) => {
      const bit = 1 << j;
      const cur = rows.filter(r => (r[1] & bit) && r[0] >= lo);
      const pri = rows.filter(r => (r[1] & bit) && r[0] >= plo && r[0] < lo);
      const ch = {};
      for (const r of cur) if (r[2] >= 0) ch[D.keys.channels[r[2]]] = (ch[D.keys.channels[r[2]]] || 0) + 1;
      out.channels[R][v] = ch;
      out.stance[R][v] = mixOf(cur);
      out.stance_prior[R][v] = mixOf(pri);
      const tagged = cur.filter(r => r[4] >= 0);
      out.issues[R][v] = tagged.length >= 5
        ? D.keys.issues.map((_, k) => Math.round(100 * tagged.filter(r => r[4] & (1 << k)).length / tagged.length)) : null;
    });
  }
  return out;
}
const AGG_CACHE = new Map();
// Aggregates under the current filters (who pays, COVID-19 brand); the whole conversation when both are off.
function AGG() {
  const key = `${state.funding}|${state.brand}|${state.place}`;
  if (!AGG_CACHE.has(key)) AGG_CACHE.set(key, aggregate(r => inFund(rowFund(r)) && inBrand(rowBrand(r)) && inPlaceBits(rowPlaces(r))));
  return AGG_CACHE.get(key);
}
const avg7 = a => a.map((_, i) => sum(a.slice(Math.max(0, i - 6), i + 1)) / Math.min(7, i + 1));
const AVG_CACHE = {};
const avgOf = k => (AVG_CACHE[`${state.funding}|${state.brand}|${state.place}:${k}`] ||= avg7(AGG().series[k]));
const selKeys = () => VAC_KEYS.filter(k => state.vac.has(k));
const volume = (k, r, prior = false) => {
  const s = AGG().series[k];
  return prior ? sum(s.slice(Math.max(0, N - 2 * r), N - r)) : sum(s.slice(N - r));
};
// Who-pays views count one mention per vaccine group (like the volume figures) and honour the brand filter;
// brand views count each COVID-19 item once and honour the who-pays filter. Neither applies its own filter.
const fundKeep = row => inBrand(rowBrand(row)) && inPlaceBits(rowPlaces(row));
const brandKeep = row => row[6] >= 0 && inFund(rowFund(row)) && inPlaceBits(rowPlaces(row));
function fundByVaccine(lo, hi) {
  const out = Object.fromEntries(D.keys.vaccines.map(v => [v, [0, 0, 0, 0]]));
  for (const row of D.rows) {
    if (row[0] < lo || row[0] >= hi || !fundKeep(row)) continue;
    D.keys.vaccines.forEach((v, j) => { if (row[1] & (1 << j)) out[v][row[5]]++; });
  }
  return out;
}
// Funding counts over the selected vaccines for a range (or the period before it), keyed by label.
function fundingTotals(r = state.range, prior = false) {
  const by = prior ? fundByVaccine(Math.max(0, N - 2 * r), N - r) : fundByVaccine(N - r, N);
  const out = { public: 0, self_pay: 0, both: 0, not_stated: 0, total: 0 };
  for (const k of selKeys()) FUNDING.forEach((f, i) => { out[f] += by[k][i]; out.total += by[k][i]; });
  return out;
}
function fundDaily(cats) {
  const out = new Array(N).fill(0), bits = selKeys().map(k => 1 << D.keys.vaccines.indexOf(k));
  for (const row of D.rows) if (fundKeep(row) && cats.includes(rowFund(row))) out[row[0]] += bits.filter(b => row[1] & b).length;
  return out;
}
function brandCounts(lo, hi) {
  const out = Object.fromEntries(BRANDS.map(b => [b, 0]));
  for (const row of D.rows) if (row[0] >= lo && row[0] < hi && brandKeep(row)) out[rowBrand(row)]++;
  return out;
}
function brandDaily(cats) {
  const out = new Array(N).fill(0);
  for (const row of D.rows) if (brandKeep(row) && cats.includes(rowBrand(row))) out[row[0]]++;
  return out;
}
// A narrative's daily series and net stance under the filters, re-counted from its per-item marks.
function narrView(n) {
  if ((state.funding === 'all' && state.brand === 'all' && state.place === 'all') || !n.marks) return { series: n.series, net: n.net, total: n.mentions };
  const series = new Array(N).fill(0);
  let pos = 0, neg = 0, total = 0;
  for (const [i, f, s, b, pb] of n.marks) {
    if (!inFund(FUND_CODE[f]) || !inBrand(BRAND_CODE[b] || '') || !inPlaceBits(pb || 0)) continue;
    series[i]++; total++;
    if (s === 'a' || s === 'v') pos++;
    else if (s === 'o' || s === 'h') neg++;
  }
  return { series, net: total ? Math.round(100 * (pos - neg) / total) : 0, total };
}
const inRange = (iso, r = state.range) => iso >= D.dates[N - r];
const inPrior = (iso, r = state.range) => N - 2 * r >= 0 && iso >= D.dates[N - 2 * r] && iso < D.dates[N - r];
const rangeMix = (obj, k, r = state.range) => (obj && obj[String(r)] && obj[String(r)][k]) || null;
// In Chinese the official (original) title leads; in English the AI translation does.
const policyTitle = p => (ZH() ? p.title_zh || p.title_en : p.title_en || p.title_zh);
const shortPolicyTitle = p => truncate(policyTitle(p), ZH() ? 36 : 60);
const sourceName = id => ({ cdc: tr('Taiwan CDC', '疾管署'), tfda: tr('TFDA', '食藥署') }[id] || id);
// Citation labels are outlet or channel names; only the agencies and the generic channel have Chinese names.
const citeLabel = s => (ZH() ? { 'Taiwan CDC': '疾管署', TFDA: '食藥署', News: '新聞' }[s] || s : s);
const citations = list => list.map((s, i) => [i ? ' · ' : '', extLink(s.url, citeLabel(s.label))]);

function weekly(fn, weeks = 12) {
  const out = [];
  for (let wk = weeks; wk >= 1; wk--) { const b = N - (wk - 1) * 7; out.push(fn(Math.max(0, b - 7), b)); }
  return out;
}
function computeKpis() {
  const keys = selKeys(), r = state.range;
  const pol = D.policy.filter(p => p.vaccines.some(v => state.vac.has(v)) && inFund(p.funding) && inBrand(p.brand) && inPlace(p.places));
  const cur = pol.filter(p => inRange(p.date, r)), pri = pol.filter(p => inPrior(p.date, r));
  const hes = prior => {
    let num = 0, den = 0;
    for (const k of keys) {
      const m = rangeMix(prior ? AGG().stance_prior : AGG().stance, k, r);
      if (!m) continue;
      const vol = volume(k, r, prior);
      num += vol * (m[0] + m[1]); den += vol;
    }
    return den ? num / den : null;
  };
  const narr = D.narratives.filter(n => n.vaccines.some(v => state.vac.has(v)) && narrView(n).total > 0);
  return {
    mentions: keys.reduce((s, k) => s + volume(k, r), 0),
    mentionsPrior: keys.reduce((s, k) => s + volume(k, r, true), 0),
    official: cur.length, officialPrior: pri.length,
    cdc: cur.filter(p => p.source === 'cdc').length, tfda: cur.filter(p => p.source === 'tfda').length,
    hes: hes(false), hesPrior: hes(true),
    narratives: narr.length,
    rising: narr.filter(n => n.status === 'emerging' || n.status === 'rising').length,
    emerging: narr.filter(n => n.status === 'emerging').length,
    spikes: AGG().spikes.filter(s => state.vac.has(s.vaccine) && inRange(s.date, r)).length,
    mentionsWeekly: weekly((a, b) => keys.reduce((s, k) => s + sum(AGG().series[k].slice(a, b)), 0)),
    fund: fundingTotals(r), fundPrior: fundingTotals(r, true),
  };
}
const vsPrior = v => tr(`${v} vs prior ${state.range} days`, `${v}（較前 ${state.range} 天）`);
// The prior period only counts if collection had started by then (the first run backfills 90 days).
const hasPrior = (r = state.range) => N - 2 * r >= 0 && D.coverage_start && D.dates[N - 2 * r] >= D.coverage_start;
const noPrior = () => ({ dir: 'flat', text: tr('No earlier data to compare yet', '尚無更早的資料可比較') });
function deltaPct(a, b) {
  if (!hasPrior()) return noPrior();
  if (!b) return a ? { dir: 'up', text: vsPrior(tr('new', '新出現')) } : { dir: 'flat', text: vsPrior(tr('no change', '無變化')) };
  const d = (a - b) / b;
  return { dir: Math.abs(d) < 0.005 ? 'flat' : d > 0 ? 'up' : 'down', text: vsPrior(`${Math.abs(d * 100).toFixed(0)}%`) };
}
function deltaAbs(a, b) {
  if (!hasPrior()) return noPrior();
  const d = a - b;
  return { dir: d === 0 ? 'flat' : d > 0 ? 'up' : 'down', text: vsPrior(`${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d)}`) };
}
function deltaPts(a, b) {
  if (!hasPrior()) return noPrior();
  const d = (a - b) * 100;
  return { dir: Math.abs(d) < 0.25 ? 'flat' : d > 0 ? 'up' : 'down', text: vsPrior(tr(`${Math.abs(d).toFixed(1)} pts`, `${Math.abs(d).toFixed(1)} 個百分點`)) };
}

/* =========================================================
   Tooltip (values lead, labels follow; text via textContent)
   ========================================================= */
const tip = $('#tip');
function tipShow(x, y, rows, title) {
  tip.replaceChildren();
  if (title) tip.append(h('div', { class: 'tip-title' }, title));
  for (const r of rows) {
    tip.append(h('div', { class: 'tip-row' },
      r.key ? h('span', { class: 'tip-key', style: `background:${r.key}` }) : null,
      h('strong', null, r.value),
      r.label ? h('span', { class: 'tip-label' }, r.label) : null));
  }
  tip.hidden = false;
  const pad = 14, box = tip.getBoundingClientRect();
  let left = x + pad, top = y + pad;
  if (left + box.width > innerWidth - 8) left = x - box.width - pad;
  if (top + box.height > innerHeight - 8) top = y - box.height - pad;
  tip.style.left = Math.max(8, left) + 'px';
  tip.style.top = Math.max(8, top) + 'px';
}
const tipHide = () => { tip.hidden = true; };
const tipAtEl = (el, rows, title) => { const r = el.getBoundingClientRect(); tipShow(r.left + r.width / 2, r.top, rows, title); };
function hoverTip(el, rowsFn, title) {
  el.addEventListener('pointermove', e => tipShow(e.clientX, e.clientY, rowsFn(), title));
  el.addEventListener('pointerleave', tipHide);
  el.addEventListener('focus', () => tipAtEl(el, rowsFn(), title));
  el.addEventListener('blur', tipHide);
}

/* =========================================================
   Small components
   ========================================================= */
function statusIcon(level) {
  const s = sv('svg', { width: 12, height: 12, viewBox: '0 0 12 12', class: 'status-icon', 'aria-hidden': 'true' });
  if (level === 'good') s.append(sv('circle', { cx: 6, cy: 6, r: 6, style: 'fill:var(--good)' }),
    sv('path', { d: 'M3.3 6.2l1.8 1.8 3.6-3.8', style: 'fill:none;stroke:#fff;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round' }));
  else if (level === 'warning') s.append(sv('path', { d: 'M6 .8l5.4 10H.6z', style: 'fill:var(--warning)' }),
    sv('path', { d: 'M6 4.4v3', style: 'stroke:#0b0b0b;stroke-width:1.4;stroke-linecap:round' }), sv('circle', { cx: 6, cy: 9.1, r: 0.8, style: 'fill:#0b0b0b' }));
  else if (level === 'serious') s.append(sv('path', { d: 'M6 .5l5.5 5.5L6 11.5.5 6z', style: 'fill:var(--serious)' }),
    sv('path', { d: 'M6 3.5v3', style: 'stroke:#0b0b0b;stroke-width:1.4;stroke-linecap:round' }), sv('circle', { cx: 6, cy: 8.4, r: 0.8, style: 'fill:#0b0b0b' }));
  else if (level === 'pending') s.append(sv('circle', { cx: 6, cy: 6, r: 5.2, style: 'fill:none;stroke:var(--text-3);stroke-width:1.4' }),
    sv('path', { d: 'M3.6 6h4.8', style: 'stroke:var(--text-3);stroke-width:1.4;stroke-linecap:round' }));
  else s.append(sv('circle', { cx: 6, cy: 6, r: 6, style: 'fill:var(--critical)' }),
    sv('path', { d: 'M4 4l4 4M8 4l-4 4', style: 'stroke:#fff;stroke-width:1.6;stroke-linecap:round' }));
  return s;
}
const typeBadge = (t, text) => h('span', { class: `type type-${t}`, title: TYPES[t].title },
  h('span', { class: 'glyph', 'aria-hidden': 'true' }, TYPES[t].glyph), text || TYPES[t].label);
const vacChip = k => (VAC[k] ? h('span', { class: 'vac', title: VAC[k].zh },
  h('span', { class: 'dot', style: `background:var(--s-${k})` }), VAC[k].label) : null);
const stanceChip = k => (STANCE_BY_KEY[k] ? h('span', { class: 'vac' },
  h('span', { class: 'key-rect', style: `background:var(${STANCE_BY_KEY[k].v});width:10px;height:10px` }), STANCE_BY_KEY[k].label) : null);
const extLink = (url, text) => (url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, text) : h('span', null, text));
const viewHead = (title, desc) => h('div', { class: 'view-head' }, h('h2', null, title), desc ? h('p', { class: 'muted' }, desc) : null);
const emptyState = (title, hint) => h('div', { class: 'empty' }, h('p', { class: 'empty-title' }, title), hint ? h('p', { class: 'muted small' }, hint) : null);
const statusLabel = s => h('span', { class: 'status' }, statusIcon(srcLevel(s.status)), srcLabel(s.status));
const whyLine = text => h('p', { class: 'why' }, h('strong', null, tr('Why it matters: ', '為何重要：')), text);
// Who-pays and COVID-19 brand badges for an item (text only: on this page a colour always means a vaccine);
// nothing when not stated.
const fundBadge = f => (FUND_TEXT[f] && f !== 'not_stated'
  ? h('span', { class: 'fund', title: tr('Who pays, as discussed by the item', '此項目談到的費用來源') }, FUND_TEXT[f].badge) : null);
const brandBadge = b => (BRAND_TEXT[b] && b !== 'not_stated'
  ? h('span', { class: 'fund', title: tr('COVID-19 vaccine brand named by the item', '此項目點名的 COVID-19 疫苗廠牌') }, BRAND_TEXT[b].badge) : null);
const placeBadge = codes => (codes && codes.length
  ? h('span', { class: 'fund', title: tr('City or county the item is about', '此項目談到的縣市') },
    codes.slice(0, 2).map(placeName).join(tr(', ', '、')) + (codes.length > 2 ? ` +${codes.length - 2}` : '')) : null);
const lineLegend = series => h('div', { class: 'legend' }, series.map(s => h('span', { class: 'legend-item' },
  h('span', { class: 'key-line', style: s.dash ? `background:repeating-linear-gradient(90deg,${s.color} 0 5px,transparent 5px 8px)` : `background:${s.color}` }),
  s.label)));

function dataTable(headers, rows, numeric = []) {
  return h('table', { class: 'data-table' },
    h('thead', null, h('tr', null, headers.map((t, i) => h('th', { scope: 'col', class: numeric.includes(i) ? 'num' : null }, t)))),
    h('tbody', null, rows.map(r => h('tr', null, r.map((c, i) =>
      h(i === 0 ? 'th' : 'td', { scope: i === 0 ? 'row' : null, class: numeric.includes(i) ? 'num' : null }, c))))));
}
function sparkline(values, { w = 96, h: ht = 26, label = '' } = {}) {
  const vals = values.map(v => v || 0);
  const max = Math.max(...vals), min = Math.min(...vals, 0);
  const x = i => 2 + (i / Math.max(1, vals.length - 1)) * (w - 6);
  const y = v => ht - 4 - ((v - min) / ((max - min) || 1)) * (ht - 8);
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return sv('svg', { width: w, height: ht, viewBox: `0 0 ${w} ${ht}`, class: 'spark', role: 'img', 'aria-label': label },
    sv('path', { d, class: 'spark-line' }),
    sv('circle', { cx: x(vals.length - 1), cy: y(vals[vals.length - 1]), r: 3, class: 'spark-end' }));
}
function netBar(net) {
  const w = 56, ht = 12, c = w / 2, len = Math.abs(net) / 100 * (c - 2);
  const s = sv('svg', { width: w, height: ht, class: 'netbar', 'aria-hidden': 'true' },
    sv('line', { x1: c, x2: c, y1: 0, y2: ht, style: 'stroke:var(--axis)' }));
  if (len > 0.5) s.append(sv('rect', { x: net >= 0 ? c + 1 : c - 1 - len, y: 3, width: len, height: ht - 6, rx: 2,
    style: `fill:var(${net >= 0 ? '--st-adv' : '--st-opp'})` }));
  return s;
}
function kpiTile({ label, value, delta, goodWhen, trend, sub }) {
  let cls = '';
  if (delta && goodWhen && delta.dir !== 'flat') cls = delta.dir === goodWhen ? 'good' : 'bad';
  return h('div', { class: 'card kpi' },
    h('div', { class: 'kpi-label' }, label),
    h('div', { class: 'kpi-row' },
      h('div', { class: 'kpi-value' }, value),
      trend ? sparkline(trend, { w: 88, h: 30, label: tr(`${label}: trend over the last 12 weeks`, `${label}：近 12 週趨勢`) }) : null),
    delta ? h('div', { class: `kpi-delta ${cls}` },
      h('span', { 'aria-hidden': 'true' }, delta.dir === 'up' ? '▲ ' : delta.dir === 'down' ? '▼ ' : '● '), delta.text) : null,
    sub ? h('div', { class: 'kpi-sub' }, sub) : null);
}

/* =========================================================
   Filters (one row above the content they scope)
   ========================================================= */
function setState(patch) { Object.assign(state, patch); renderCurrent(); }
function toggleVac(k) {
  const s = new Set(state.vac);
  if (s.has(k)) { if (s.size > 1) s.delete(k); } else s.add(k);
  setState({ vac: s });
}
function filterRow({ source = false, channel = false } = {}) {
  const row = h('div', { class: 'filters', role: 'group', 'aria-label': tr('Filters for this view', '此頁的篩選條件') });
  const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': tr('Date range', '日期範圍') });
  for (const r of [7, 30, 90]) seg.append(h('button', {
    type: 'button', role: 'radio', 'aria-checked': String(state.range === r), 'data-fkey': `range-${r}`,
    onclick: () => setState({ range: r }) }, tr(`${r} days`, `${r} 天`)));
  row.append(h('div', { class: 'filter' }, h('span', { class: 'filter-label' }, tr('Range', '期間')), seg));
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': tr('Vaccines', '疫苗') },
    h('button', { type: 'button', class: 'chip', 'aria-pressed': String(state.vac.size === VAC_KEYS.length), 'data-fkey': 'vac-all',
      onclick: () => setState({ vac: new Set(VAC_KEYS) }) }, tr('All', '全部')),
    VACCINES.map(v => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(state.vac.has(v.key)), 'data-fkey': `vac-${v.key}`,
      title: v.zh, onclick: () => toggleVac(v.key) }, h('span', { class: 'dot', style: `background:var(--s-${v.key})` }), v.label)));
  row.append(h('div', { class: 'filter' }, h('span', { class: 'filter-label' }, tr('Vaccines', '疫苗')), chips));
  const FUND_TIP = {
    public: tr('Items that discuss public funding, including those that also discuss self-pay', '談到公費的項目，含同時談到自費者'),
    self_pay: tr('Items that discuss self-pay, including those that also discuss public funding', '談到自費的項目，含同時談到公費者'),
    both: tr('Items that discuss both', '同時談到公費與自費的項目'),
    not_stated: tr('Items that mention neither', '未提及費用來源的項目'),
  };
  const fseg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': tr('Who pays', '費用來源') });
  for (const k of ['all', ...FUNDING]) fseg.append(h('button', {
    type: 'button', role: 'radio', 'aria-checked': String(state.funding === k), 'data-fkey': `fund-${k}`, title: FUND_TIP[k] || null,
    onclick: () => setState({ funding: k }) }, k === 'all' ? tr('All', '全部') : FUND_TEXT[k].label));
  row.append(h('div', { class: 'filter' }, h('span', { class: 'filter-label' }, tr('Who pays', '費用')), fseg));
  const BRAND_TIP = {
    moderna: tr('COVID-19 items that name Moderna, including those that also name Novavax', '點名 Moderna 的 COVID-19 項目，含同時點名 Novavax 者'),
    novavax: tr('COVID-19 items that name Novavax, including those that also name Moderna', '點名 Novavax 的 COVID-19 項目，含同時點名 Moderna 者'),
    both: tr('COVID-19 items that name both brands', '同時點名兩個廠牌的 COVID-19 項目'),
    not_stated: tr('COVID-19 items that name no brand', '未點名廠牌的 COVID-19 項目'),
  };
  const bseg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': tr('COVID-19 brand', 'COVID-19 廠牌') });
  for (const k of ['all', ...BRANDS]) bseg.append(h('button', {
    type: 'button', role: 'radio', 'aria-checked': String(state.brand === k), 'data-fkey': `brand-${k}`, title: BRAND_TIP[k] || null,
    onclick: () => setState({ brand: k }) }, k === 'all' ? tr('All', '全部') : BRAND_TEXT[k].label));
  row.append(h('div', { class: 'filter' }, h('span', { class: 'filter-label' }, tr('COVID-19 brand', 'COVID-19 廠牌')), bseg));
  if (PLACES.length) {
    const psel = h('select', { 'aria-label': tr('Place', '地區'), 'data-fkey': 'place', onchange: e => setState({ place: e.target.value }) },
      h('option', { value: 'all' }, tr('All places', '全部地區')), PLACES.map(c => h('option', { value: c.code }, placeLong(c.code))));
    psel.value = state.place;
    row.append(h('div', { class: 'filter' }, h('span', { class: 'filter-label' }, tr('Place', '地區')), psel));
  }
  if (source) {
    const s2 = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': tr('Source', '來源') });
    for (const [k, label] of [['all', tr('All', '全部')], ['cdc', sourceName('cdc')], ['tfda', sourceName('tfda')]]) s2.append(h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(state.source === k), 'data-fkey': `src-${k}`,
      onclick: () => setState({ source: k }) }, label));
    row.append(h('div', { class: 'filter' }, h('span', { class: 'filter-label' }, tr('Source', '來源')), s2));
  }
  if (channel) {
    const sel = h('select', { 'aria-label': tr('Channel', '管道'), 'data-fkey': 'channel', onchange: e => setState({ channel: e.target.value }) },
      h('option', { value: 'all' }, tr('All channels', '所有管道')), CHANNELS.map(c => h('option', { value: c.key }, c.label)));
    sel.value = state.channel;
    row.append(h('div', { class: 'filter' }, h('span', { class: 'filter-label' }, tr('Channel', '管道')), sel));
  }
  return row;
}

/* =========================================================
   Chart card: title, legend, chart, and its table-view twin
   ========================================================= */
let mounted = [];
function chartCard({ title, subtitle, legend, draw, table, after }) {
  const host = h('div', { class: 'chart-host' });
  const tableWrap = h('div', { class: 'table-wrap', hidden: true });
  let built = false;
  const btn = h('button', { type: 'button', class: 'btn-ghost', 'aria-pressed': 'false' }, tr('Table view', '表格檢視'));
  btn.addEventListener('click', () => {
    const on = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(on));
    if (on && !built) { tableWrap.append(table()); built = true; }
    host.hidden = on; tableWrap.hidden = !on;
    if (legend) legend.hidden = on;
    if (!on) draw(host);
  });
  mounted.push(() => { if (!host.hidden) draw(host); });
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', null, h('h3', { class: 'card-title' }, title), subtitle ? h('p', { class: 'card-sub' }, subtitle) : null),
      btn),
    legend || null, host, tableWrap, after || null);
}

/* =========================================================
   Charts (hand-drawn SVG)
   ========================================================= */
function niceTicks(max, count = 4) {
  const raw = max / count, mag = Math.pow(10, Math.floor(Math.log10(raw))), nrm = raw / mag;
  const stepV = (nrm <= 1 ? 1 : nrm <= 2 ? 2 : nrm <= 2.5 ? 2.5 : nrm <= 5 ? 5 : 10) * mag;
  const out = [];
  for (let v = 0; v <= Math.ceil(max / stepV) * stepV + 1e-9; v += stepV) out.push(+v.toFixed(6));
  return out;
}
function roundRect(x, y, w, ht, rL, rR) {
  return `M${x + rL},${y}H${x + w - rR}`
    + (rR ? `A${rR},${rR} 0 0 1 ${x + w},${y + rR}V${y + ht - rR}A${rR},${rR} 0 0 1 ${x + w - rR},${y + ht}` : `V${y + ht}`)
    + `H${x + rL}`
    + (rL ? `A${rL},${rL} 0 0 1 ${x},${y + ht - rL}V${y + rL}A${rL},${rL} 0 0 1 ${x + rL},${y}` : `V${y}`) + 'Z';
}

function lineChart(host, { dates, series, events }) {
  host.replaceChildren();
  const W = Math.max(280, Math.floor(host.clientWidth));
  const narrow = W < 560;
  const H = narrow ? 250 : 310;
  const m = { t: events.length ? 34 : 12, r: narrow ? 14 : 118, b: 28, l: 40 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b, n = dates.length;
  const ticks = niceTicks(Math.max(1, ...series.flatMap(s => s.values)), narrow ? 3 : 4);
  const yMax = ticks[ticks.length - 1];
  const x = i => m.l + (n === 1 ? pw / 2 : (i / (n - 1)) * pw);
  const y = v => m.t + ph - (v / yMax) * ph;
  const names = series.map(s => s.label).join(tr(', ', '、'));
  const svg = sv('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'chart', tabindex: 0, role: 'img',
    'aria-label': tr(`Line chart of daily mentions, 7-day average, for ${names}, over ${n} days. Use the left and right arrow keys to read values.`,
      `每日提及數折線圖（7 日平均），疫苗：${names}，共 ${n} 天。可用左右方向鍵讀取數值。`) });
  for (const t of ticks) {
    svg.append(sv('line', { x1: m.l, x2: m.l + pw, y1: y(t), y2: y(t), class: t === 0 ? 'axis-line' : 'grid-line' }));
    svg.append(sv('text', { x: m.l - 8, y: y(t), class: 'tick', 'text-anchor': 'end', 'dominant-baseline': 'middle', text: fmt(t) }));
  }
  let cand;
  if (n <= 7) cand = dates.map((_, i) => i);
  else if (n <= 31) cand = dates.map((d, i) => (d.getUTCDay() === 1 ? i : -1)).filter(i => i >= 0);
  else cand = dates.map((d, i) => ((d.getUTCDate() === 1 || d.getUTCDate() === 15) ? i : -1)).filter(i => i >= 0);
  let lastPx = -Infinity;
  for (const i of cand) {
    const px = x(i);
    if (px - lastPx < 56) continue;
    lastPx = px;
    const anchor = px - m.l < 18 ? 'start' : (m.l + pw) - px < 18 ? 'end' : 'middle';
    svg.append(sv('text', { x: px, y: m.t + ph + 18, class: 'tick', 'text-anchor': anchor, text: fmtDate(dates[i]) }));
  }
  // policy markers: hairline + numbered badge; badges nudged apart when dates are close
  const pos = events.map(e => x(e.i));
  const bx = [];
  pos.forEach((ex, k) => { bx[k] = k === 0 ? Math.max(ex, m.l) : Math.max(ex, bx[k - 1] + 21); });
  for (let k = bx.length - 1; k >= 0; k--) bx[k] = Math.min(bx[k], (k === bx.length - 1 ? W - 11 : bx[k + 1] - 21));
  events.forEach((ev, k) => {
    const ex = pos[k], cx = bx[k], cy = m.t - 18;
    svg.append(sv('line', { x1: ex, x2: ex, y1: m.t - 4, y2: m.t + ph, class: 'event-line' }));
    if (Math.abs(cx - ex) > 0.5) svg.append(sv('path', { d: `M${ex},${m.t - 4}L${cx},${cy + 9}`, class: 'event-link' }));
    const badge = sv('g', { class: 'event-badge', tabindex: 0, role: 'img',
      'aria-label': tr(`Marker ${ev.n}, ${fmtDate(ev.date)}: ${ev.title} (${ev.source})`, `標記 ${ev.n}，${fmtDate(ev.date)}：${ev.title}（${ev.source}）`) },
      sv('circle', { cx, cy, r: 9 }),
      sv('text', { x: cx, y: cy + 0.5, 'text-anchor': 'middle', 'dominant-baseline': 'middle', text: String(ev.n) }));
    hoverTip(badge, () => [{ value: ev.title, label: ev.source }], `${ev.n} · ${fmtDate(ev.date, { weekday: 'short', month: 'short', day: 'numeric' })}`);
    svg.append(badge);
  });
  for (const s of series) {
    const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    svg.append(sv('path', { d, class: 'line', style: `stroke:${s.color}${s.dash ? ';stroke-dasharray:6 4' : ''}` }));
  }
  for (const s of series) svg.append(sv('circle', { cx: x(n - 1), cy: y(s.values[n - 1]), r: 4, class: 'dot-ring', style: `fill:${s.color}` }));
  if (!narrow) {
    const lab = series.map(s => ({ s, y0: y(s.values[n - 1]) })).sort((a, b) => a.y0 - b.y0);
    const gap = 16, top = m.t + 4, bot = m.t + ph;
    lab.forEach((lb, i) => { lb.y = Math.max(lb.y0, top, i ? lab[i - 1].y + gap : -Infinity); });
    if (lab.length && lab[lab.length - 1].y > bot) {
      lab[lab.length - 1].y = bot;
      for (let i = lab.length - 2; i >= 0; i--) lab[i].y = Math.min(lab[i].y, lab[i + 1].y - gap);
    }
    const ex = x(n - 1), lx = ex + 18;
    for (const lb of lab) {
      if (Math.abs(lb.y - lb.y0) > 1.5) svg.append(sv('path', { d: `M${ex + 6},${lb.y0}L${lx - 4},${lb.y}`, class: 'leader', style: `stroke:${lb.s.color}` }));
      svg.append(sv('text', { x: lx, y: lb.y, class: 'end-label', 'dominant-baseline': 'middle' },
        sv('tspan', { class: 'end-name', text: lb.s.label + ' ' }),
        sv('tspan', { class: 'end-val', text: fmtAvg(lb.s.values[n - 1]) })));
    }
  }
  const cross = sv('line', { y1: m.t, y2: m.t + ph, class: 'crosshair', visibility: 'hidden' });
  const dotsG = sv('g', { visibility: 'hidden', 'pointer-events': 'none' });
  const dots = series.map(s => { const c = sv('circle', { r: 4, class: 'dot-ring', style: `fill:${s.color}` }); dotsG.append(c); return c; });
  const overlay = sv('rect', { x: m.l, y: m.t, width: pw, height: ph, fill: 'transparent' });
  let cur = null;
  const showAt = (i, cx, cy) => {
    const px = x(i);
    cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
    dotsG.setAttribute('visibility', 'visible');
    series.forEach((s, k) => { dots[k].setAttribute('cx', px); dots[k].setAttribute('cy', y(s.values[i])); });
    const box = svg.getBoundingClientRect();
    tipShow(cx ?? box.left + px, cy ?? box.top + m.t + 10,
      series.map(s => ({ key: s.color, value: fmtAvg(s.values[i]), label: s.label })),
      `${fmtDate(dates[i], { weekday: 'short', month: 'short', day: 'numeric' })} · ${tr('7-day average', '7 日平均')}`);
  };
  const hide = () => { cross.setAttribute('visibility', 'hidden'); dotsG.setAttribute('visibility', 'hidden'); tipHide(); };
  overlay.addEventListener('pointermove', e => {
    const box = svg.getBoundingClientRect();
    cur = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - box.left) - m.l) / pw * (n - 1))));
    showAt(cur, e.clientX, e.clientY);
  });
  overlay.addEventListener('pointerleave', hide);
  svg.addEventListener('focus', e => { if (e.target === svg) { cur = n - 1; showAt(cur); } });
  svg.addEventListener('blur', e => { if (e.target === svg) hide(); });
  svg.addEventListener('keydown', e => {
    if (e.target !== svg) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      cur = Math.max(0, Math.min(n - 1, (cur ?? n - 1) + (e.key === 'ArrowRight' ? 1 : -1)));
      showAt(cur);
    } else if (e.key === 'Escape') hide();
  });
  svg.append(cross, overlay, dotsG);
  host.append(svg);
}

/* Diverging stacked bars, centred on neutral; rows without enough tagged mentions say so */
function likertChart(host, rows) {
  host.replaceChildren();
  const W = Math.max(280, Math.floor(host.clientWidth));
  const narrow = W < 460;
  const labelW = narrow ? 0 : 92;
  const rowH = narrow ? 54 : 42, barH = 20;
  const m = { t: 6, r: 42, b: 24, l: labelW + 42 };
  const pw = W - m.l - m.r, H = m.t + rows.length * rowH + m.b;
  const ext = rows.filter(r => r.mix).map(r => Math.max(r.mix[0] + r.mix[1] + r.mix[2] / 2, r.mix[3] + r.mix[4] + r.mix[2] / 2));
  const dom = Math.max(0.2, Math.ceil(Math.max(0.2, ...ext) * 5) / 5);
  const x0 = m.l + pw / 2, sc = pw / 2 / dom;
  const rowText = r => (r.mix
    ? tr(`${r.label}: ${pct(r.mix[0] + r.mix[1])} hesitant or opposed, ${pct(r.mix[3] + r.mix[4])} accepting or advocating`,
      `${r.label}：猶豫或反對 ${pct(r.mix[0] + r.mix[1])}，接受或倡議 ${pct(r.mix[3] + r.mix[4])}`)
    : tr(`${r.label}: not enough tagged mentions`, `${r.label}：已標註的提及數不足`));
  const svg = sv('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img',
    'aria-label': tr(`Stance by vaccine. ${rows.map(rowText).join('; ')}.`, `各疫苗的立場分布。${rows.map(rowText).join('；')}。`) });
  for (const t of [-dom, -dom / 2, 0, dom / 2, dom]) {
    svg.append(sv('text', { x: x0 + t * sc, y: H - 6, class: 'tick', 'text-anchor': 'middle', text: t === 0 ? '0' : pct(Math.abs(t)) }));
  }
  svg.append(sv('line', { x1: x0, x2: x0, y1: m.t, y2: H - m.b + 2, class: 'axis-line' }));
  rows.forEach((r, i) => {
    const cy = m.t + i * rowH + (narrow ? rowH - barH / 2 - 6 : rowH / 2);
    svg.append(sv('text', { x: 0, y: narrow ? cy - barH / 2 - 7 : cy, class: 'row-label', 'dominant-baseline': narrow ? 'auto' : 'middle', text: r.label }));
    if (!r.mix) {
      svg.append(sv('text', { x: x0 + 8, y: cy, class: 'tick', 'dominant-baseline': 'middle', text: tr('Not enough tagged mentions yet', '已標註的提及數仍不足') }));
      return;
    }
    let c = x0 - (r.mix[0] + r.mix[1] + r.mix[2] / 2) * sc;
    const segs = r.mix.map((v, k) => { const g = { k, v, x: c, w: v * sc }; c += v * sc; return g; });
    segs.forEach((g, j) => {
      let x1 = g.x, x2 = g.x + g.w;
      if (j > 0) x1 += 1;
      if (j < segs.length - 1) x2 -= 1;            // 2px surface gap between segments
      const w = x2 - x1;
      if (w <= 0.5) return;
      const st = STANCE[g.k];
      const p = sv('path', { d: roundRect(x1, cy - barH / 2, w, barH, j === 0 ? Math.min(4, w / 2) : 0, j === segs.length - 1 ? Math.min(4, w / 2) : 0),
        class: 'seg-mark', style: `fill:var(${st.v})`, tabindex: 0, role: 'img', 'aria-label': `${r.label}, ${st.label}: ${pct(g.v)}` });
      hoverTip(p, () => [{ key: `var(${st.v})`, value: pct(g.v), label: st.label }], r.label);
      svg.append(p);
    });
    svg.append(sv('text', { x: segs[0].x - 6, y: cy, class: 'bar-val', 'text-anchor': 'end', 'dominant-baseline': 'middle', text: pct(r.mix[0] + r.mix[1]) }));
    svg.append(sv('text', { x: segs[4].x + segs[4].w + 6, y: cy, class: 'bar-val', 'dominant-baseline': 'middle', text: pct(r.mix[3] + r.mix[4]) }));
  });
  host.append(svg);
}

/* Heatmap (sequential blue; label ink chosen per step for contrast). Transposed on narrow screens. */
const BINS = [0, 6, 11, 16, 22, 30, 40];
const binOf = v => BINS.reduce((b, t, i) => (v >= t ? i : b), 0);
function heatmap(host, rows, values) {
  host.replaceChildren();
  const narrow = host.clientWidth < 520;
  const R = narrow ? ISSUES.map(c => c.short) : rows.map(r => r.label);
  const C = narrow ? rows.map(r => ({ short: r.short, long: r.label })) : ISSUES;
  const at = (i, j) => (narrow
    ? { v: values[j] ? values[j][i] : null, vac: rows[j].label, issue: ISSUES[i].long }
    : { v: values[i] ? values[i][j] : null, vac: rows[i].label, issue: ISSUES[j].long });
  const grid = h('div', { class: 'heat', role: 'table', 'aria-label': tr('Issue intensity by vaccine', '各疫苗的議題熱度'),
    style: `grid-template-columns: minmax(${narrow ? 70 : 92}px, auto) repeat(${C.length}, minmax(${narrow ? 34 : 48}px, 1fr));${narrow ? 'min-width:0;font-size:12px' : ''}` });
  grid.append(h('div', { role: 'columnheader' }));
  C.forEach(c => grid.append(h('div', { class: 'heat-col', role: 'columnheader', title: c.long }, c.short)));
  R.forEach((label, i) => {
    grid.append(h('div', { class: 'heat-row', role: 'rowheader' }, label));
    C.forEach((_, j) => {
      const { v, vac, issue } = at(i, j);
      if (v == null) {
        grid.append(h('div', { class: 'heat-cell heat-empty', role: 'cell', title: tr(`${vac}: not enough tagged mentions`, `${vac}：已標註的提及數不足`) }, '–'));
        return;
      }
      const b = binOf(v);
      const cell = h('div', { class: 'heat-cell', role: 'cell', tabindex: 0, 'aria-label': `${vac}, ${issue}: ${v}%`,
        style: `background:var(--seq-${b});color:var(--seq-ink-${b})` }, `${v}%`);
      hoverTip(cell, () => [{ key: `var(--seq-${b})`, value: `${v}%`, label: issue }], vac);
      grid.append(cell);
    });
  });
  const scale = h('div', { class: 'scale' }, h('span', null, tr('% of mentions', '佔提及數 %')),
    h('div', { class: 'scale-steps', 'aria-hidden': 'true' }, BINS.map((t, i) =>
      h('div', { class: 'scale-step' }, h('span', { style: `background:var(--seq-${i})` }), i === BINS.length - 1 ? `${t}+` : String(t)))));
  // Chinese short labels are already the full names, so only English needs the abbreviation key.
  const abbrKey = narrow && !ZH() && rows.some(r => ['enh', 'adj', 'hd'].includes(r.key))
    ? h('p', { class: 'chart-note' }, 'Enh. = enhanced, type not stated · Adj. = adjuvanted · HD = high-dose') : null;
  host.append(h('div', { class: 'heat-scroll' }, grid), scale);
  if (abbrKey) host.append(abbrKey);
}

/* Horizontal stacked bars: rows = channels, segments = vaccines */
function stackedBars(host, rows) {
  host.replaceChildren();
  const W = Math.max(280, Math.floor(host.clientWidth));
  const labelW = Math.min(132, Math.max(56, Math.max(...rows.map(r => textWidth(r.label))) + 14));
  const rowH = 38, barH = 18;
  const m = { t: 2, r: 58, b: 2, l: labelW };
  const pw = W - m.l - m.r, H = m.t + rows.length * rowH + m.b;
  const max = Math.max(1, ...rows.map(r => r.parts.reduce((a, p) => a + p.v, 0)));
  const sc = pw / max;
  const rowText = r => `${r.label}: ${fmt(r.parts.reduce((a, p) => a + p.v, 0))}`;
  const svg = sv('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img',
    'aria-label': tr(`Mentions by channel. ${rows.map(rowText).join('; ')}.`, `各管道的提及數。${rows.map(rowText).join('；')}。`) });
  rows.forEach((r, i) => {
    const cy = m.t + i * rowH + rowH / 2;
    svg.append(sv('text', { x: 0, y: cy, class: 'row-label', 'dominant-baseline': 'middle', text: r.label }));
    const parts = r.parts.filter(p => p.v > 0);
    const total = parts.reduce((a, p) => a + p.v, 0);
    let xx = m.l;
    parts.forEach((p, j) => {
      let x1 = xx, x2 = xx + p.v * sc;
      xx = x2;
      if (j > 0) x1 += 1;
      if (j < parts.length - 1) x2 -= 1;
      const w = x2 - x1;
      if (w <= 0.5) return;
      const seg = sv('path', { d: roundRect(x1, cy - barH / 2, w, barH, 0, j === parts.length - 1 ? Math.min(4, w) : 0),
        class: 'seg-mark', style: `fill:var(--s-${p.key})`, tabindex: 0, role: 'img', 'aria-label': `${r.label}, ${VAC[p.key].label}: ${fmt(p.v)}` });
      hoverTip(seg, () => [{ key: `var(--s-${p.key})`, value: fmt(p.v),
        label: tr(`${VAC[p.key].label} · ${pct(p.v / total)} of ${r.label}`, `${VAC[p.key].label} · 佔${r.label} ${pct(p.v / total)}`) }], r.label);
      svg.append(seg);
    });
    svg.append(sv('text', { x: xx + 6, y: cy, class: 'bar-val', 'dominant-baseline': 'middle', text: compact(total) }));
  });
  host.append(svg);
}

/* Who pays: 100% stacked bars per vaccine. Order 公費 | both | 自費 | not stated; "both" is a two-colour stripe. */
let patternSeq = 0;
function fundFill(svg, f) {
  if (f !== 'both') return `var(${FUND_TEXT[f].v})`;
  const id = `fund-both-${++patternSeq}`;
  svg.append(sv('defs', null, sv('pattern', { id, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
    sv('rect', { width: 6, height: 6, style: 'fill:var(--f-pub)' }), sv('rect', { width: 3, height: 6, style: 'fill:var(--f-self)' }))));
  return `url(#${id})`;
}
const MIX_ORDER = ['public', 'both', 'self_pay', 'not_stated'];
function mixBars(host, rows) {
  host.replaceChildren();
  const W = Math.max(280, Math.floor(host.clientWidth));
  const labelW = Math.min(110, Math.max(48, Math.max(...rows.map(r => textWidth(r.label))) + 12));
  const rowH = 38, barH = 18;
  const m = { t: 2, r: 46, b: 2, l: labelW };
  const pw = W - m.l - m.r, H = m.t + rows.length * rowH + m.b;
  const share = (r, f) => r.counts[FUNDING.indexOf(f)] / r.total;
  const rowText = r => (r.total < 5 ? tr(`${r.label}: not enough mentions`, `${r.label}：提及數不足`)
    : `${r.label}: ${MIX_ORDER.map(f => `${FUND_TEXT[f].label} ${pct(share(r, f))}`).join(', ')}`);
  const svg = sv('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img',
    'aria-label': tr(`Who pays, share of mentions by vaccine. ${rows.map(rowText).join('; ')}.`, `各疫苗討論的費用來源比例。${rows.map(rowText).join('；')}。`) });
  const both = fundFill(svg, 'both');
  rows.forEach((r, i) => {
    const cy = m.t + i * rowH + rowH / 2;
    svg.append(sv('text', { x: 0, y: cy, class: 'row-label', 'dominant-baseline': 'middle', text: r.label }));
    if (r.total < 5) {
      svg.append(sv('text', { x: m.l, y: cy, class: 'tick', 'dominant-baseline': 'middle', text: tr('Not enough mentions yet', '提及數仍不足') }));
      return;
    }
    const parts = MIX_ORDER.map(f => ({ f, v: r.counts[FUNDING.indexOf(f)] })).filter(p => p.v > 0);
    let xx = m.l;
    parts.forEach((p, j) => {
      let x1 = xx, x2 = xx + (p.v / r.total) * pw;
      xx = x2;
      if (j > 0) x1 += 1;
      if (j < parts.length - 1) x2 -= 1;
      const w = x2 - x1;
      if (w <= 0.5) return;
      const fill = p.f === 'both' ? both : `var(${FUND_TEXT[p.f].v})`;
      const seg = sv('path', { d: roundRect(x1, cy - barH / 2, w, barH, j === 0 ? Math.min(4, w / 2) : 0, j === parts.length - 1 ? Math.min(4, w / 2) : 0),
        class: 'seg-mark', style: `fill:${fill}`, tabindex: 0, role: 'img', 'aria-label': `${r.label}, ${FUND_TEXT[p.f].badge}: ${pct(p.v / r.total)} (${fmt(p.v)})` });
      hoverTip(seg, () => [{ key: p.f === 'both' ? 'repeating-linear-gradient(45deg,var(--f-pub) 0 3px,var(--f-self) 3px 6px)' : `var(${FUND_TEXT[p.f].v})`,
        value: pct(p.v / r.total), label: tr(`${FUND_TEXT[p.f].badge} · ${fmt(p.v)} mentions`, `${FUND_TEXT[p.f].badge} · ${fmt(p.v)} 則提及`) }], r.label);
      svg.append(seg);
    });
    svg.append(sv('text', { x: m.l + pw + 6, y: cy, class: 'bar-val', 'dominant-baseline': 'middle', text: compact(r.total) }));
  });
  host.append(svg);
}

/* One-colour horizontal bars of shares: a single series (parts of one whole), so one hue, labelled values. */
function shareBars(host, rows, color) {
  host.replaceChildren();
  const W = Math.max(280, Math.floor(host.clientWidth));
  const labelW = Math.min(150, Math.max(56, Math.max(...rows.map(r => textWidth(r.label))) + 14));
  const rowH = 34, barH = 16, m = { t: 2, r: 76, b: 2, l: labelW };
  const pw = W - m.l - m.r, H = m.t + rows.length * rowH + m.b;
  const max = Math.max(1e-9, ...rows.map(r => r.share));
  const svg = sv('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img',
    'aria-label': rows.map(r => `${r.label}: ${pct(r.share)} (${fmt(r.count)})`).join('; ') });
  rows.forEach((r, i) => {
    const cy = m.t + i * rowH + rowH / 2, w = r.share > 0 ? Math.max(2, r.share / max * pw) : 0;
    svg.append(sv('text', { x: 0, y: cy, class: 'row-label', 'dominant-baseline': 'middle', text: r.label }));
    if (w > 0) {
      const bar = sv('path', { d: roundRect(m.l, cy - barH / 2, w, barH, 0, Math.min(4, w / 2)), class: 'seg-mark', style: `fill:${color}`,
        tabindex: 0, role: 'img', 'aria-label': `${r.label}: ${pct(r.share)} (${fmt(r.count)})` });
      hoverTip(bar, () => [{ key: color, value: pct(r.share), label: tr(`${fmt(r.count)} mentions`, `${fmt(r.count)} 則提及`) }], r.label);
      svg.append(bar);
    }
    svg.append(sv('text', { x: m.l + w + 6, y: cy, class: 'bar-val', 'dominant-baseline': 'middle', text: `${pct(r.share)} · ${compact(r.count)}` }));
  });
  host.append(svg);
}

/* =========================================================
   Views
   ========================================================= */
function briefCard() {
  const b = D.brief;
  if (!b) {
    const latestPolicy = D.policy.slice(0, 3);
    const heads = (D.headlines || []).slice(0, 6);
    return h('section', { class: 'card brief', 'aria-labelledby': 'brief-h' },
      h('div', { class: 'card-head' }, h('div', null,
        h('h2', { class: 'card-title', id: 'brief-h', style: 'font-size:18px' }, tr('Latest', '最新動態')),
        h('p', { class: 'card-sub' }, tr('The AI-written daily brief appears after the first analyst run. Until then, the newest official notices and headlines.',
          '首次 AI 分析完成後，這裡會顯示每日簡報；在此之前先列出最新的官方公告與新聞標題。')))),
      h('ol', { class: 'brief-list' },
        latestPolicy.map(p => h('li', { class: 'brief-item' },
          h('div', { class: 'meta-row' }, typeBadge('policy', sourceName(p.source)), p.vaccines.map(vacChip), fundBadge(p.funding), brandBadge(p.brand), placeBadge(p.places), h('span', null, fmtDate(asDate(p.date)))),
          h('h3', { class: 'brief-h' }, extLink(p.url, policyTitle(p))),
          !ZH() && p.title_en ? h('p', { class: 'zh', lang: 'zh-TW' }, p.title_zh) : null)),
        heads.map(n => h('li', { class: 'brief-item' },
          h('div', { class: 'meta-row' }, typeBadge('media'), n.vaccines.map(vacChip), fundBadge(n.funding), brandBadge(n.brand), placeBadge(n.places), h('span', null, `${n.outlet} · ${fmtDate(asDate(n.date))}`)),
          h('h3', { class: 'brief-h' }, extLink(n.url, ZH() ? n.title : n.title_en || n.title)),
          !ZH() && n.title_en ? h('p', { class: 'zh', lang: 'zh-TW' }, n.title) : null))));
  }
  const day = fmtDate(asDate(b.date), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return h('section', { class: 'card brief', 'aria-labelledby': 'brief-h' },
    h('div', { class: 'card-head' },
      h('div', null,
        h('h2', { class: 'card-title', id: 'brief-h', style: 'font-size:18px' }, tr('Daily brief', '每日簡報')),
        h('p', { class: 'card-sub' }, tr(`${day} · written by ${b.model} from ${fmt(b.items)} new items · published automatically, without human review`,
          `${day} · 由 ${b.model} 根據 ${fmt(b.items)} 則新資料撰寫並譯為中文 · 自動發布，未經人工審閱`)))),
    h('div', { class: 'brief-body' },
      h('div', null,
        h('ol', { class: 'brief-list' }, b.entries.map(e => h('li', { class: 'brief-item' },
          h('div', { class: 'meta-row' }, typeBadge(e.type), e.vaccines.map(vacChip), fundBadge(e.funding), brandBadge(e.brand), placeBadge(e.places), h('span', null, tr(`Confidence: ${e.confidence}`, `可信度：${hml(e.confidence)}`))),
          h('h3', { class: 'brief-h' }, L(e, 'headline')),
          !ZH() && e.zh ? h('p', { class: 'zh', lang: 'zh-TW' }, e.zh) : null,
          whyLine(L(e, 'why')),
          e.sources && e.sources.length ? h('p', { class: 'src' }, tr('Sources: ', '來源：'), citations(e.sources)) : null,
          e.type === 'signal' ? h('p', { class: 'signal-note' }, tr('◆ Signal from social data, not validated evidence.', '◆ 來自社群資料的訊號，並非經驗證的證據。')) : null))),
        b.entries.length > 3 ? h('button', { type: 'button', class: 'btn-ghost brief-more',
          onclick: e => e.currentTarget.closest('.brief').classList.add('expanded') },
          tr(`Show ${b.entries.length - 3} more items`, `顯示其餘 ${b.entries.length - 3} 則`)) : null),
      h('aside', { class: 'brief-aside' },
        b.watch && b.watch.length ? h('div', { class: 'watch' }, h('h3', null, tr('Watch next', '接下來關注')),
          h('ul', null, b.watch.map(w => h('li', null, h('span', { class: 'watch-when' }, L(w, 'when')), ' · ', L(w, 'text'))))) : null,
        b.qa && b.qa.length ? h('div', null, h('h3', null, tr('Questions a public-affairs lead would ask today', '公共事務主管今天會問的問題')),
          b.qa.map(x => h('details', null, h('summary', null, L(x, 'q')), h('p', null, L(x, 'a'))))) : null)));
}

function kpiRow() {
  const k = computeKpis(), r = state.range;
  const hasNarr = D.narratives.length > 0;
  const hesLabel = tr('Hesitant or opposed', '猶豫或反對');
  return h('div', { class: 'kpis' },
    kpiTile({ label: tr(`Mentions, last ${r} days`, `近 ${r} 天提及數`), value: compact(k.mentions), delta: deltaPct(k.mentions, k.mentionsPrior),
      trend: k.mentionsWeekly, sub: tr('News and social, selected vaccines', '新聞與社群，所選疫苗') }),
    kpiTile({ label: tr(`Official actions, last ${r} days`, `近 ${r} 天官方行動`), value: String(k.official), delta: deltaAbs(k.official, k.officialPrior),
      sub: `${sourceName('cdc')} ${k.cdc} · ${sourceName('tfda')} ${k.tfda}` }),
    k.hes == null
      ? kpiTile({ label: hesLabel, value: '–', sub: tr('Appears once AI stance tagging has run', 'AI 立場標註完成後顯示') })
      : kpiTile({ label: hesLabel, value: pct(k.hes), delta: k.hesPrior == null ? null : deltaPts(k.hes, k.hesPrior), goodWhen: 'down', sub: tr('Share of all mentions', '佔所有提及的比例') }),
    hasNarr
      ? kpiTile({ label: tr('Rising narratives', '升溫中的敘事'), value: String(k.rising),
        sub: tr(`${k.emerging} emerging · ${k.narratives} tracked for these vaccines`, `${k.emerging} 則新興 · 這些疫苗共追蹤 ${k.narratives} 則`) })
      : kpiTile({ label: tr(`Spike days, last ${r} days`, `近 ${r} 天聲量暴增日`), value: String(k.spikes), sub: tr('Days well above the 28-day baseline', '明顯高於 28 日基準的天數') }),
    selfPayTile(k.fund, k.fundPrior));
}
// Share of all mentions (whatever the funding filter) that discuss 自費, including those that discuss both.
function selfPayTile(f, prior) {
  const label = tr('Self-pay share of mentions', '自費討論占比');
  if (!f.total) return kpiTile({ label, value: '–', sub: tr('Appears once AI funding tags exist', 'AI 費用標註完成後顯示') });
  const share = x => (x.self_pay + x.both) / x.total;
  return kpiTile({ label, value: pct(share(f)), delta: prior.total ? deltaPts(share(f), share(prior)) : noPrior(),
    sub: tr(`Publicly funded ${pct((f.public + f.both) / f.total)} · not stated ${pct(f.not_stated / f.total)}`,
      `公費 ${pct((f.public + f.both) / f.total)} · 未說明 ${pct(f.not_stated / f.total)}`) });
}

function volumeCard() {
  const r = state.range, lo = N - r, dates = DATES.slice(lo);
  const sel = VACCINES.filter(v => state.vac.has(v.key));
  const series = sel.map(v => ({ key: v.key, label: v.label, color: `var(--s-${v.key})`, values: avgOf(v.key).slice(lo) }));
  const events = D.policy.filter(p => p.marker && p.date >= D.dates[lo] && p.vaccines.some(v => state.vac.has(v)) && inFund(p.funding) && inBrand(p.brand) && inPlace(p.places))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((p, j) => ({ n: j + 1, i: D.dates.indexOf(p.date) - lo, date: asDate(p.date), title: shortPolicyTitle(p), source: sourceName(p.source), url: p.url }))
    .filter(e => e.i >= 0);
  const legend = h('div', { class: 'legend' }, sel.map(v => h('span', { class: 'legend-item' },
    h('span', { class: 'key-line', style: `background:var(--s-${v.key})` }), v.label)));
  const evList = events.length ? h('ol', { class: 'event-list', 'aria-label': tr('Policy markers', '政策標記') }, events.map(e => h('li', null,
    h('span', { class: 'ev-n', 'aria-hidden': 'true' }, String(e.n)),
    h('span', null, h('span', { class: 'ev-date' }, fmtDate(e.date)), ' ', extLink(e.url, e.title), ` · ${e.source}`)))) : null;
  const evAt = i => events.filter(e => e.i === i).map(e => `${e.n}. ${e.title}`).join('; ');
  return chartCard({
    title: tr('Conversation volume and policy moments', '討論聲量與政策時間點'),
    subtitle: tr('Daily mentions across news and social, 7-day average. Numbered markers are official actions by Taiwan CDC or TFDA.',
      '新聞與社群的每日提及數（7 日平均）。編號標記為疾管署或食藥署的官方行動。'),
    legend,
    draw: host => lineChart(host, { dates, series, events }),
    table: () => dataTable([tr('Date', '日期'), ...series.map(s => s.label), tr('Official action', '官方行動')],
      dates.map((d, i) => [fmtDate(d), ...series.map(s => fmt(AGG().series[s.key][lo + i])), evAt(i)]), series.map((_, k) => k + 1)),
    after: evList,
  });
}

function stanceCard() {
  const rows = VACCINES.filter(v => state.vac.has(v.key)).map(v => ({ label: v.label, mix: rangeMix(AGG().stance, v.key) }));
  const legend = h('div', { class: 'legend' },
    STANCE.map(s => h('span', { class: 'legend-item' }, h('span', { class: 'key-rect', style: `background:var(${s.v})` }), s.label)));
  return chartCard({
    title: tr('Stance toward vaccination', '對疫苗接種的立場'),
    subtitle: tr(`Share of AI-tagged mentions by stance, last ${state.range} days. Bars are centred on neutral; end labels show hesitant + opposed and accepting + advocating.`,
      `近 ${state.range} 天 AI 標註提及的立場比例。長條以中立為中心，兩端數字分別為「猶豫＋反對」與「接受＋倡議」。`),
    legend,
    draw: host => likertChart(host, rows),
    table: () => dataTable([tr('Vaccine', '疫苗'), ...STANCE.map(s => s.label)], rows.map(r => [r.label, ...(r.mix ? r.mix.map(v => pct(v)) : STANCE.map(() => '–'))]), [1, 2, 3, 4, 5]),
  });
}

function heatCard() {
  const rows = VACCINES.filter(v => state.vac.has(v.key));
  const values = rows.map(v => rangeMix(AGG().issues, v.key));
  return chartCard({
    title: tr('What people are talking about', '民眾在談什麼'),
    subtitle: tr(`Share of each vaccine’s AI-tagged mentions that touch an issue, last ${state.range} days. One mention can touch several issues.`,
      `近 ${state.range} 天各疫苗 AI 標註提及中觸及各議題的比例。一則提及可涉及多個議題。`),
    draw: host => heatmap(host, rows, values),
    table: () => dataTable([tr('Vaccine', '疫苗'), ...ISSUES.map(c => c.long)], rows.map((r, i) => [r.label, ...(values[i] ? values[i].map(v => `${v}%`) : ISSUES.map(() => '–'))]), [1, 2, 3, 4, 5, 6]),
  });
}

function fundingCards() {
  const r = state.range, lo = N - r, dates = DATES.slice(lo);
  const filtered = state.funding !== 'all' ? tr(' The Who pays filter does not apply to these two charts.', '「費用」篩選不適用於這兩張圖。') : '';
  const fundLegend = order => h('div', { class: 'legend' }, order.map(f => h('span', { class: 'legend-item' },
    h('span', { class: `key-rect fund-${f}` }), FUND_TEXT[f].badge)));
  const by = fundByVaccine(lo, N);
  const rows = VACCINES.filter(v => state.vac.has(v.key)).map(v => ({ key: v.key, label: v.label, counts: by[v.key], total: sum(by[v.key]) }));
  const mixCard = chartCard({
    title: tr('Who pays: publicly funded vs self-pay, by vaccine', '誰付費：各疫苗的公費與自費討論'),
    subtitle: tr(`Share of each vaccine’s mentions, last ${r} days, by the funding they discuss. “Both” means an item mentions public funding and self-pay.${filtered}`,
      `近 ${r} 天各疫苗提及中談到的費用來源比例。「公費＋自費」表示同一項目兩者都提到。${filtered}`),
    legend: fundLegend(MIX_ORDER),
    draw: host => mixBars(host, rows),
    table: () => dataTable([tr('Vaccine', '疫苗'), ...MIX_ORDER.map(f => FUND_TEXT[f].badge), tr('Mentions', '提及數')],
      rows.map(rw => [rw.label, ...MIX_ORDER.map(f => (rw.total ? `${pct(rw.counts[FUNDING.indexOf(f)] / rw.total)} (${fmt(rw.counts[FUNDING.indexOf(f)])})` : '–')), fmt(rw.total)]),
      [1, 2, 3, 4, 5]),
  });
  const pub = fundDaily(['public', 'both']), self = fundDaily(['self_pay', 'both']);
  const series = [
    { key: 'pub', label: FUND_TEXT.public.badge, color: 'var(--f-pub)', values: avg7(pub).slice(lo) },
    { key: 'self', label: FUND_TEXT.self_pay.badge, color: 'var(--f-self)', dash: true, values: avg7(self).slice(lo) },
  ];
  const trendCard = chartCard({
    title: tr('Publicly funded and self-pay conversation over time', '公費與自費討論趨勢'),
    subtitle: tr(`Daily mentions that discuss each, 7-day average, selected vaccines. Items that discuss both count in both lines.${filtered}`,
      `所選疫苗中談到公費或自費的每日提及數（7 日平均）。兩者都談到的項目兩條線都計入。${filtered}`),
    legend: lineLegend(series),
    draw: host => lineChart(host, { dates, series, events: [] }),
    table: () => dataTable([tr('Date', '日期'), FUND_TEXT.public.badge, FUND_TEXT.self_pay.badge],
      dates.map((d, i) => [fmtDate(d), fmt(pub[lo + i]), fmt(self[lo + i])]), [1, 2]),
  });
  return h('div', { class: 'grid-2' }, mixCard, trendCard);
}

// COVID-19 brand views: which brands COVID-19 mentions name, and each brand over time. Shown with COVID-19 selected.
function brandCards() {
  if (!state.vac.has('covid') || !D.rows) return null;
  const r = state.range, lo = N - r, dates = DATES.slice(lo);
  const filtered = state.brand !== 'all' ? tr(' The COVID-19 brand filter does not apply to these two charts.', '「COVID-19 廠牌」篩選不適用於這兩張圖。') : '';
  const counts = brandCounts(lo, N), total = sum(Object.values(counts));
  const rows = BRANDS.map(b => ({ label: BRAND_TEXT[b].badge, count: counts[b], share: total ? counts[b] / total : 0 }));
  const shareCard = chartCard({
    title: tr('COVID-19 brands: Moderna vs Novavax', 'COVID-19 廠牌：Moderna 與 Novavax'),
    subtitle: tr(`Share of the ${fmt(total)} COVID-19 mentions in the last ${r} days by the brands they name. “Moderna + Novavax” means both are named.${filtered}`,
      `近 ${r} 天 ${fmt(total)} 則 COVID-19 提及中點名的廠牌比例。「Moderna＋Novavax」表示兩者皆被提及。${filtered}`),
    draw: host => (total ? shareBars(host, rows, 'var(--s-covid)')
      : host.replaceChildren(emptyState(tr('No COVID-19 mentions in this range.', '此期間沒有 COVID-19 提及。')))),
    table: () => dataTable([tr('Brand', '廠牌'), tr('Share', '比例'), tr('Mentions', '提及數')], rows.map(x => [x.label, pct(x.share), fmt(x.count)]), [1, 2]),
  });
  const mod = brandDaily(['moderna', 'both']), nov = brandDaily(['novavax', 'both']);
  const series = [
    { key: 'moderna', label: 'Moderna', color: 'var(--s-covid)', values: avg7(mod).slice(lo) },
    { key: 'novavax', label: 'Novavax', color: 'var(--s-covid)', dash: true, values: avg7(nov).slice(lo) },
  ];
  const trendCard = chartCard({
    title: tr('Moderna and Novavax mentions over time', 'Moderna 與 Novavax 提及趨勢'),
    subtitle: tr(`Daily COVID-19 mentions naming each brand, 7-day average. Items naming both count in both lines.${filtered}`,
      `每日點名各廠牌的 COVID-19 提及數（7 日平均）。兩者皆提及的項目兩條線都計入。${filtered}`),
    legend: lineLegend(series),
    draw: host => lineChart(host, { dates, series, events: [] }),
    table: () => dataTable([tr('Date', '日期'), 'Moderna', 'Novavax'], dates.map((d, i) => [fmtDate(d), fmt(mod[lo + i]), fmt(nov[lo + i])]), [1, 2]),
  });
  return h('div', { class: 'grid-2' }, shareCard, trendCard);
}

/* Where in Taiwan: a choropleth of mentions about each city or county, with a top-places list. */
const MIN_RATED = 10;                     // below this, a per-100k rate is not shown: single-digit counts aren't comparable
const SMALL_PLACES = new Set(['TPE', 'KEE', 'HSZ', 'CYI', 'PEN']);   // get a larger invisible hit target
let GEO = null, GEO_LOADING = null;
const loadGeo = () => (GEO_LOADING ||= fetch(DATA_BASE + 'data/taiwan-counties.json', { cache: 'no-cache' })
  .then(r => (r.ok ? r.json() : null)).then(g => { GEO = g || false; }).catch(() => { GEO = false; }));

// Mentions about each place over the selected vaccines, under the who-pays and brand filters (not its own).
function placeStats(r = state.range) {
  const lo = N - r, plo = Math.max(0, N - 2 * r);
  const bits = selKeys().map(k => 1 << D.keys.vaccines.indexOf(k));
  const P = PLACES.map(c => ({ code: c.code, pop: c.pop, cur: 0, prior: 0, vac: {}, iss: D.keys.issues.map(() => 0), tagged: 0 }));
  let named = 0, total = 0;
  for (const row of D.rows) {
    if (row[0] < plo || !bits.some(b => row[1] & b) || !inFund(rowFund(row)) || !inBrand(rowBrand(row))) continue;
    const cur = row[0] >= lo, pb = rowPlaces(row);
    if (cur) total++;
    if (!pb) continue;
    if (cur) named++;
    P.forEach((s, i) => {
      if (!(pb & (1 << i))) return;
      if (!cur) { s.prior++; return; }
      s.cur++;
      D.keys.vaccines.forEach((v, j) => { if ((row[1] & (1 << j)) && state.vac.has(v)) s.vac[v] = (s.vac[v] || 0) + 1; });
      if (row[4] >= 0) { s.tagged++; D.keys.issues.forEach((_, k) => { if (row[4] & (1 << k)) s.iss[k]++; }); }
    });
  }
  for (const s of P) {
    s.rate = s.cur / s.pop * 1e5;
    s.topVac = Object.entries(s.vac).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const top = Math.max(0, ...s.iss);
    s.topIssue = top > 0 ? s.iss.indexOf(top) : -1;
  }
  return { P, named, total };
}
// Up to five classes from quantiles of the non-zero values, on the sequential blue ramp.
function classBreaks(values) {
  const v = values.filter(x => x > 0).sort((a, b) => a - b);
  const out = [];
  for (const q of [0.2, 0.4, 0.6, 0.8]) {
    const t = v.length ? v[Math.min(v.length - 1, Math.floor(q * v.length))] : 0;
    if (t > 0 && (!out.length || t > out[out.length - 1])) out.push(t);
  }
  if (out.length && v.length && out[out.length - 1] >= v[v.length - 1]) out.pop();
  return out;
}
const placeChange = s => (!hasPrior() ? '–' : s.prior === 0 ? (s.cur ? tr('New', '新') : '–')
  : `${s.cur >= s.prior ? '+' : '−'}${Math.abs(Math.round((s.cur - s.prior) / s.prior * 100))}%`);
const pickPlace = code => setState({ place: state.place === code ? 'all' : code });

function placeMapSvg(host, stats, metric) {
  host.replaceChildren();
  if (GEO === null) {
    host.append(h('p', { class: 'muted small' }, tr('Loading map…', '地圖載入中…')));
    loadGeo().then(() => { if (state.view === 'social') renderCurrent(); });
    return null;
  }
  if (!GEO) { host.append(emptyState(tr('The map could not be loaded.', '無法載入地圖。'))); return null; }
  const val = s => (metric === 'rate' ? (s.cur >= MIN_RATED ? s.rate : null) : s.cur);
  const breaks = classBreaks(stats.P.map(val).filter(x => x != null));
  const K = breaks.length + 1;
  const step = c => Math.round(1 + (c - 1) * 4 / Math.max(1, K - 1));      // spread the classes over seq-1..seq-5
  const cls = v => (v == null ? -1 : v <= 0 ? 0 : 1 + breaks.filter(b => v > b).length);
  const [vw, vh] = GEO.viewBox;
  const W = Math.min(Math.max(240, Math.floor(host.clientWidth)), 440), H = Math.round(W * vh / vw);
  const svg = sv('svg', { width: W, height: H, viewBox: `0 0 ${vw} ${vh}`, class: 'chart map', role: 'group',
    'aria-label': tr('Map of Taiwan by city and county. Use Tab to move between places and Enter to filter.', '台灣各縣市地圖。可用 Tab 鍵切換縣市，按 Enter 篩選。') });
  const pid = `hatch-${++patternSeq}`;
  svg.append(sv('defs', null, sv('pattern', { id: pid, width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
    sv('rect', { width: 5, height: 5, style: 'fill:var(--surface-2)' }), sv('rect', { width: 1.4, height: 5, style: 'fill:var(--text-3)' }))));
  const fillOf = s => {
    const c = cls(val(s));
    if (c < 0) return s.cur > 0 ? `url(#${pid})` : 'var(--surface-2)';
    return c === 0 ? 'var(--surface-2)' : `var(--seq-${step(c)})`;
  };
  const describe = s => tr(`${placeLong(s.code)}: ${fmt(s.cur)} mentions${s.cur >= MIN_RATED ? `, ${s.rate.toFixed(1)} per 100,000 residents` : ''}`,
    `${placeLong(s.code)}：${fmt(s.cur)} 則提及${s.cur >= MIN_RATED ? `，每10萬人 ${s.rate.toFixed(1)}` : ''}`);
  const bind = (el, s) => {
    hoverTip(el, () => [{ value: fmt(s.cur), label: tr('mentions', '則提及') },
      { value: s.cur >= MIN_RATED ? s.rate.toFixed(1) : '–', label: tr('per 100,000 residents', '每10萬人') },
      { value: placeChange(s), label: tr(`vs prior ${state.range} days`, `較前 ${state.range} 天`) }], placeLong(s.code));
    el.addEventListener('click', () => pickPlace(s.code));
  };
  for (const ins of GEO.insets || []) {       // Kinmen and Matsu: the whole inset box is the target
    const [x, y, w, hh] = ins.box, s = stats.P.find(p => p.code === ins.code);
    if (!s) continue;
    // the islands are specks at this size, so a colour chip beside the label carries the county's value
    const frame = sv('g', { class: 'map-inset', 'aria-hidden': 'true' },
      sv('rect', { x, y, width: w, height: hh, class: 'inset-frame' }),
      sv('rect', { x: x + 5, y: y + 4, width: 9, height: 9, rx: 2, class: 'inset-chip', style: `fill:${fillOf(s)}` }),
      sv('text', { x: x + 18, y: y + 11, class: 'inset-label', text: placeName(ins.code) }));
    bind(frame, s);
    svg.append(frame);
  }
  const order = [...stats.P].sort((a, b) => (a.code === state.place) - (b.code === state.place));
  for (const s of order) {
    const geo = GEO.counties[s.code];
    if (!geo) continue;
    const g = sv('g', { class: `map-county${state.place === s.code ? ' selected' : ''}`, tabindex: 0, role: 'button',
      'aria-pressed': String(state.place === s.code), 'aria-label': describe(s) }, sv('path', { d: geo.d, style: `fill:${fillOf(s)}` }));
    if (SMALL_PLACES.has(s.code)) g.append(sv('circle', { cx: geo.c[0], cy: geo.c[1], r: 9, class: 'hit' }));
    bind(g, s);
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickPlace(s.code); } });
    svg.append(g);
  }
  host.append(svg);
  return { breaks, step };
}
function placeLegend(res, metric) {
  if (!res) return null;
  const { breaks, step } = res, fmtV = v => (metric === 'rate' ? v.toFixed(1) : fmt(v));
  const items = [h('span', { class: 'legend-item' }, h('span', { class: 'key-rect', style: 'background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--grid)' }), tr('None', '無'))];
  const bounds = [metric === 'rate' ? 0 : 1, ...breaks];
  bounds.forEach((lo, i) => {
    const hi = breaks[i];
    let text;
    if (metric === 'rate') text = hi == null ? (i ? `> ${fmtV(lo)}` : tr('Any', '皆有')) : (i ? `${fmtV(lo)}–${fmtV(hi)}` : `≤ ${fmtV(hi)}`);
    else { const a = i ? lo + 1 : lo; text = hi == null ? `${fmt(a)}+` : a === hi ? fmt(a) : `${fmt(a)}–${fmt(hi)}`; }
    items.push(h('span', { class: 'legend-item' }, h('span', { class: 'key-rect', style: `background:var(--seq-${step(i + 1)})` }), text));
  });
  if (metric === 'rate') items.push(h('span', { class: 'legend-item' }, h('span', { class: 'key-rect key-hatch' }), tr(`Too few mentions (under ${MIN_RATED})`, `提及數太少（少於 ${MIN_RATED} 則）`)));
  return h('div', { class: 'legend map-legend' }, items);
}
function placeList(stats, metric) {
  const val = s => (metric === 'rate' ? (s.cur >= MIN_RATED ? s.rate : -1) : s.cur);
  const top = stats.P.filter(s => s.cur > 0).sort((a, b) => val(b) - val(a) || b.cur - a.cur).slice(0, 8);
  if (!top.length) return emptyState(tr('No mentions about a specific city or county in this range.', '此期間沒有與特定縣市有關的提及。'));
  return h('div', { class: 'table-wrap' }, h('table', { class: 'data-table place-table' },
    h('thead', null, h('tr', null, h('th', { scope: 'col' }, tr('Place', '縣市')), h('th', { scope: 'col', class: 'num' }, tr('Mentions', '提及數')),
      h('th', { scope: 'col', class: 'num' }, tr('Per 100k', '每10萬人')), h('th', { scope: 'col', class: 'num' }, tr('Change', '變化')),
      h('th', { scope: 'col' }, tr('Leading', '主要')))),
    h('tbody', null, top.map(s => h('tr', { class: state.place === s.code ? 'is-selected' : null },
      h('th', { scope: 'row' }, h('button', { type: 'button', class: 'linklike', 'aria-pressed': String(state.place === s.code),
        title: tr('Filter the page to this place', '以此縣市篩選整頁'), onclick: () => pickPlace(s.code) }, placeName(s.code))),
      h('td', { class: 'num' }, fmt(s.cur)),
      h('td', { class: 'num' }, s.cur >= MIN_RATED ? s.rate.toFixed(1) : '–'),
      h('td', { class: 'num' }, placeChange(s)),
      h('td', null, h('span', { class: 'chips-inline' }, s.topVac ? vacChip(s.topVac) : null,
        s.topIssue >= 0 ? h('span', { class: 'muted small' }, ISSUES[s.topIssue].short) : null)))))));
}
function placeCard() {
  if (!PLACES.length || !D.rows) return null;
  const r = state.range, stats = placeStats(r), metric = state.placeMetric;
  const share = stats.total ? stats.named / stats.total : 0;
  const filtered = state.place !== 'all' ? tr(' The Place filter does not apply to this map.', '「地區」篩選不適用於此地圖。') : '';
  const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': tr('Map shows', '地圖顯示') },
    [['count', tr('Mentions', '提及數')], ['rate', tr('Per 100,000 residents', '每10萬人')]].map(([k, label]) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(metric === k), 'data-fkey': `pmetric-${k}`, onclick: () => setState({ placeMetric: k }) }, label)));
  const selected = state.place !== 'all' ? h('button', { type: 'button', class: 'btn-ghost', onclick: () => setState({ place: 'all' }) },
    tr(`Showing ${placeName(state.place)} ✕`, `目前：${placeName(state.place)} ✕`)) : null;
  return chartCard({
    title: tr('Where in Taiwan', '台灣各地的討論'),
    subtitle: tr(`Mentions about each city or county, last ${r} days, under the other filters. ${pct(share)} of mentions are about a specific place; national items are not mapped. Click a county or a row to filter the page.${filtered}`,
      `近 ${r} 天各縣市的相關提及（套用其他篩選條件）。${pct(share)}的提及與特定縣市有關；全國性的項目不列入地圖。點選縣市或列表可篩選整頁。${filtered}`),
    legend: h('div', { class: 'map-controls' }, h('span', { class: 'filter-label' }, tr('Map shows', '地圖顯示')), seg, selected),
    draw: host => {
      host.replaceChildren();
      const mapEl = h('div', { class: 'map-svg' }), legendSlot = h('div');
      host.append(h('div', { class: 'map-wrap' },
        h('div', { class: 'map-col' }, legendSlot, mapEl),
        h('div', { class: 'map-side' }, h('h4', { class: 'map-side-title' }, metric === 'rate' ? tr('Top places per 100,000 residents', '每10萬人提及最多的縣市') : tr('Top places by mentions', '提及最多的縣市')),
          placeList(stats, metric))));
      const legend = placeLegend(placeMapSvg(mapEl, stats, metric), metric);
      if (legend) legendSlot.replaceWith(legend);
    },
    table: () => dataTable([tr('Place', '縣市'), tr('Mentions', '提及數'), tr('Per 100,000 residents', '每10萬人'), tr('Previous period', '前一期間'),
      tr('Leading vaccine', '主要疫苗'), tr('Leading issue', '主要議題')],
      [...stats.P].sort((a, b) => b.cur - a.cur).map(s => [placeLong(s.code), fmt(s.cur), s.cur >= MIN_RATED ? s.rate.toFixed(1) : '–', fmt(s.prior),
        s.topVac ? VAC[s.topVac].label : '–', s.topIssue >= 0 ? ISSUES[s.topIssue].long : '–']), [1, 2, 3]),
    after: h('div', null,
      metric === 'rate' ? h('p', { class: 'chart-note' }, tr(`Per-100,000 rates favour small counties, because local news covers them whatever their size; counties with fewer than ${MIN_RATED} mentions get no rate.`,
        `每10萬人比率較有利於人口少的縣市，因為地方新聞不論縣市大小都會報導；提及數少於 ${MIN_RATED} 則的縣市不計算比率。`)) : null,
      h('p', { class: 'chart-note' }, tr('Boundaries: Ministry of the Interior, via taiwan-atlas. Population: Ministry of the Interior, end of July 2026.',
        '縣市界線：內政部（經 taiwan-atlas 整理）。人口：內政部，2026年7月底。'))),
  });
}

// Links for cross-checking a narrative against its sources: up to two items under the current filters, newest
// article and newest post first. The link shows the source name only; the headline (or paraphrase) is the hover text.
function narrExamples(n) {
  const matches = (Array.isArray(n.examples) ? n.examples : []).filter(ex => inFund(ex.funding) && inBrand(ex.brand) && inPlace(ex.places));
  const list = [matches.find(ex => ex.kind === 'media'), matches.find(ex => ex.kind === 'social')].filter(Boolean);
  for (const ex of matches) if (list.length < 2 && !list.includes(ex)) list.push(ex);
  if (list.length === 2 && list[0].label === list[1].label) list.pop();
  if (!list.length) return null;
  return h('div', { class: 'narr-ex' }, h('span', { class: 'narr-ex-label' }, tr('Read: ', '原文：')),
    list.map((ex, i) => {
      const badges = [fundBadge(ex.funding), brandBadge(ex.brand), placeBadge(ex.places)].filter(Boolean);
      return h('span', { class: 'narr-ex-item' }, i ? h('span', { 'aria-hidden': 'true' }, ' · ') : null,
        h('a', { href: ex.url, target: '_blank', rel: 'noopener noreferrer', title: ZH() ? ex.t_zh : ex.t_en }, citeLabel(ex.label)),
        badges.map(b => [' ', b]));
    }));
}

function narrativesCard({ top = 0, risingOnly = false } = {}) {
  let list = D.narratives.filter(n => n.vaccines.some(v => state.vac.has(v)));
  if (state.channel !== 'all') list = list.filter(n => (n.channels || []).includes(state.channel));
  if (risingOnly) list = list.filter(n => n.status === 'emerging' || n.status === 'rising');
  const r = state.range;
  let rows = list.map(n => ({ n, v: narrView(n) })).filter(row => row.v.total > 0)
    .map(row => ({ ...row, cur: sum(row.v.series.slice(N - r)), prior: sum(row.v.series.slice(Math.max(0, N - 2 * r), N - r)) }));
  rows.sort(risingOnly ? (a, b) => (b.cur / Math.max(b.prior, 1)) - (a.cur / Math.max(a.prior, 1)) : (a, b) => b.cur - a.cur);
  if (top) rows = rows.slice(0, top);
  const change = row => ((row.prior < 5 || row.cur > row.prior * 8) ? tr('New', '新') : `${row.cur >= row.prior ? '+' : '−'}${Math.abs((row.cur - row.prior) / row.prior * 100).toFixed(0)}%`);
  const netText = n => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`;
  const statusEl = s => h('span', { class: 'status' }, h('span', { 'aria-hidden': 'true' }, NSTATUS[s].icon), NSTATUS[s].label);
  const chans = n => (n.channels || []).map(channelShort).join(' · ');
  const trendLabel = n => tr(`${L(n, 'title')}: daily mentions`, `${L(n, 'title')}：每日提及數`);
  const cards = h('ul', { class: 'narr-cards' }, rows.map(row => h('li', null,
    h('div', { class: 'meta-row' }, row.n.vaccines.map(vacChip), statusEl(row.n.status), h('span', null, tr(`${fmt(row.cur)} mentions · ${change(row)}`, `${fmt(row.cur)} 則提及 · ${change(row)}`))),
    h('div', { class: 'narr-title' }, L(row.n, 'title')),
    h('div', { class: 'narr-para' }, L(row.n, 'para')),
    h('div', { class: 'narr-foot' },
      sparkline(row.v.series.slice(N - r), { w: 96, h: 24, label: trendLabel(row.n) }),
      h('span', { class: 'net' }, netBar(row.v.net), tr(`Net ${netText(row.v.net)}`, `淨立場 ${netText(row.v.net)}`)),
      h('span', { class: 'narr-ch' }, chans(row.n))),
    narrExamples(row.n))));
  const body = rows.length ? h('div', null, h('div', { class: 'table-wrap narr-wide' }, h('table', { class: 'data-table narr-table' },
    h('thead', null, h('tr', null,
      h('th', { scope: 'col' }, tr('Narrative', '敘事')), h('th', { scope: 'col' }, tr('Vaccine', '疫苗')), h('th', { scope: 'col' }, tr(`Trend, ${r} days`, `近 ${r} 天趨勢`)),
      h('th', { scope: 'col', class: 'num' }, tr('Mentions', '提及數')), h('th', { scope: 'col', class: 'num' }, tr('Change', '變化')),
      h('th', { scope: 'col' }, tr('Net stance', '淨立場')), h('th', { scope: 'col' }, tr('Status', '狀態')))),
    h('tbody', null, rows.map(row => h('tr', null,
      h('th', { scope: 'row' }, h('div', { class: 'narr-title' }, L(row.n, 'title')), h('div', { class: 'narr-para' }, L(row.n, 'para')),
        h('div', { class: 'narr-ch' }, chans(row.n)), narrExamples(row.n)),
      h('td', null, h('span', { class: 'chips-inline' }, row.n.vaccines.map(vacChip))),
      h('td', null, sparkline(row.v.series.slice(N - r), { w: 96, h: 26, label: trendLabel(row.n) })),
      h('td', { class: 'num' }, fmt(row.cur)),
      h('td', { class: 'num' }, change(row)),
      h('td', null, h('span', { class: 'net' }, netBar(row.v.net), netText(row.v.net))),
      h('td', null, statusEl(row.n.status))))))), cards)
    : D.narratives.length
      ? emptyState(tr('No narratives match these filters.', '沒有符合篩選條件的敘事。'), tr('Include more vaccines, or choose another channel or Who pays option.', '請加入更多疫苗，或改選其他管道或費用選項。'))
      : emptyState(tr('Narratives appear after the AI analyst runs.', 'AI 分析完成後會顯示敘事。'), tr('The analyst groups tagged posts into storylines once a day.', 'AI 分析每天一次將已標註的貼文歸納為敘事主軸。'));
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', null,
      h('h3', { class: 'card-title' }, risingOnly ? tr('Emerging and rising narratives', '新興與升溫中的敘事') : tr('Narrative explorer', '敘事總覽')),
      h('p', { class: 'card-sub' }, risingOnly
        ? tr('Storylines gaining momentum, ranked by growth against the prior period. Paraphrased; no usernames. “Read” links open one or two original articles or posts for cross-checking.',
          '正在升溫的敘事主軸，依相較前期的成長幅度排序。內容經改寫，不含使用者名稱。「原文」連結可開啟一至兩則原始報導或貼文以供查證。')
        : tr(`All tracked storylines, ranked by mentions in the last ${r} days. Net stance = supportive share minus hesitant/opposed share. “Read” links open original articles or posts.`,
          `所有追蹤中的敘事主軸，依近 ${r} 天提及數排序。淨立場＝支持比例減去猶豫／反對比例。「原文」連結可開啟原始報導或貼文。`)))),
    body);
}

function renderToday(root) {
  root.replaceChildren(
    briefCard(),
    filterRow(),
    kpiRow(),
    volumeCard(),
    fundingCards(),
    brandCards(),
    h('div', { class: 'grid-2' }, stanceCard(), heatCard()),
    narrativesCard({ top: 5, risingOnly: true }));
}

function renderPolicy(root) {
  const items = D.policy.filter(p => inRange(p.date) && p.vaccines.some(v => state.vac.has(v))
    && (state.source === 'all' || p.source === state.source) && inFund(p.funding) && inBrand(p.brand) && inPlace(p.places));
  const counts = {};
  items.forEach(p => { counts[p.type] = (counts[p.type] || 0) + 1; });
  const watch = (D.brief && D.brief.watch) || [];
  const n = items.length, r = state.range;
  root.replaceChildren(
    viewHead(tr('Official actions', '官方行動'), tr('Taiwan CDC (衛福部疾管署) and TFDA (食藥署) only: press releases, letters to physicians, clarifications, announcements, drug-safety notices and rumour rebuttals.',
      '僅收錄衛福部疾管署與食藥署：新聞稿、致醫界通函、澄清、公告、藥品安全資訊與闢謠。')),
    filterRow({ source: true }),
    h('div', { class: 'grid-policy' },
      h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('div', null,
          h('h3', { class: 'card-title' }, tr(`${n} ${n === 1 ? 'action' : 'actions'} in the last ${r} days`, `近 ${r} 天共 ${n} 項官方行動`)),
          h('p', { class: 'card-sub' }, tr('Newest first. English summaries come from the AI tagger; the original Chinese title is always shown.',
            '由新到舊排列。標題為官方原文，摘要與說明由 AI 撰寫。')))),
        items.length ? h('ol', { class: 'timeline' }, items.map(p => h('li', { class: 'tl-item' },
          h('div', { class: 'tl-date' }, h('time', { datetime: p.date }, fmtDate(asDate(p.date)))),
          h('div', null,
            h('div', { class: 'meta-row' }, typeBadge('policy', sourceName(p.source)), h('span', { class: 'tag' }, policyType(p.type)), p.vaccines.map(vacChip), fundBadge(p.funding), brandBadge(p.brand), placeBadge(p.places)),
            h('h4', { class: 'tl-title' }, policyTitle(p)),
            !ZH() && p.title_en ? h('p', { class: 'zh', lang: 'zh-TW' }, p.title_zh) : null,
            L(p, 'summary') ? h('p', { class: 'why' }, L(p, 'summary')) : null,
            L(p, 'why') ? whyLine(L(p, 'why')) : null,
            h('p', { class: 'src' }, extLink(p.url, tr('Original notice', '原始公告')))))))
          : emptyState(tr('No official actions match these filters.', '沒有符合篩選條件的官方行動。'), tr('Try a longer range, another source, more vaccines or another Who pays option.', '請嘗試較長的期間、其他來源、更多疫苗或其他費用選項。'))),
      h('div', { class: 'stack' },
        watch.length ? h('section', { class: 'card' },
          h('h3', { class: 'card-title' }, tr('Watch list', '關注清單')),
          h('p', { class: 'card-sub', style: 'margin-bottom:12px' }, tr('Dates and decisions coming up, from today’s brief.', '來自今日簡報的近期重要日期與決策。')),
          h('ul', { class: 'watch-list' }, watch.map(w => h('li', null, h('strong', null, L(w, 'when')), h('span', null, L(w, 'text')))))) : null,
        h('section', { class: 'card' },
          h('h3', { class: 'card-title', style: 'margin-bottom:12px' }, tr('By type', '依類型')),
          Object.keys(counts).length
            ? h('ul', { class: 'count-list' }, Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([t, c]) =>
              h('li', null, h('span', null, policyType(t)), h('span', { class: 'num' }, String(c)))))
            : h('p', { class: 'muted small' }, tr('Nothing in this range.', '此期間沒有資料。'))))));
}

function channelCard() {
  const keys = selKeys(), r = state.range;
  const chans = state.channel === 'all' ? CHANNELS : CHANNELS.filter(c => c.key === state.channel);
  const rows = chans.map(c => ({ label: c.label, parts: keys.map(k => ({ key: k, v: (rangeMix(AGG().channels, k, r) || {})[c.key] || 0 })) }));
  const legend = h('div', { class: 'legend' }, keys.map(k => h('span', { class: 'legend-item' },
    h('span', { class: 'key-rect', style: `background:var(--s-${k})` }), VAC[k].label)));
  const social = D.sources.filter(s => ['threads', 'facebook', 'ptt'].includes(s.id) && !['ok', 'local'].includes(s.status));
  const socialText = social.map(s => tr(`${s.name}: ${srcLabel(s.status).toLowerCase()}`, `${L(s, 'name')}：${srcLabel(s.status)}`)).join(' · ');
  return chartCard({
    title: tr('Where the conversation happens', '討論發生在哪裡'),
    subtitle: tr(`Mentions by channel and vaccine, last ${r} days.`, `近 ${r} 天各管道與疫苗的提及數。`),
    legend,
    draw: host => stackedBars(host, rows),
    table: () => dataTable([tr('Channel', '管道'), ...keys.map(k => VAC[k].label), tr('Total', '合計')],
      rows.map(rw => [rw.label, ...rw.parts.map(p => fmt(p.v)), fmt(rw.parts.reduce((a, p) => a + p.v, 0))]), keys.map((_, i) => i + 1).concat(keys.length + 1)),
    after: social.length ? h('p', { class: 'chart-note' }, statusIcon(social.some(s => s.status === 'stale') ? 'warning' : 'pending'),
      tr(`${socialText}. Their bars stay empty until the source is connected.`, `${socialText}。來源連線前，長條會保持空白。`)) : null,
  });
}

function attentionRow() {
  const r = state.range;
  const keys = selKeys().filter(k => D.attention[k] && D.attention[k].some(v => v != null));
  if (!keys.length) return null;
  return h('div', null,
    h('div', { class: 'card-head', style: 'margin-bottom:10px' }, h('div', null,
      h('h3', { class: 'card-title' }, tr('Public attention: Wikipedia pageviews', '公眾關注度：維基百科瀏覽量')),
      h('p', { class: 'card-sub' }, tr(`zh and en articles, last ${r} days. A proxy for curiosity, separate from conversation volume. No dedicated articles exist for the enhanced types.`,
        `近 ${r} 天中、英文條目。反映好奇程度的代理指標，與討論聲量分開計算。加強型各類別沒有專屬條目。`),
        state.funding !== 'all' || state.brand !== 'all' ? tr(' Pageviews cannot be split by who pays or brand, so those filters do not apply here.', '瀏覽量無法依費用來源或廠牌區分，這兩個篩選不適用於此。') : ''))),
    h('div', { class: 'attn' }, keys.map(k => {
      const a = D.attention[k];
      const cur = sum(a.slice(N - r)), pri = sum(a.slice(Math.max(0, N - 2 * r), N - r));
      return kpiTile({ label: VAC[k].label, value: compact(cur), delta: deltaPct(cur, pri),
        trend: weekly((x, y) => sum(a.slice(x, y))), sub: tr('Pageviews', '瀏覽量') });
    })));
}

function renderSocial(root) {
  const keys = selKeys();
  const spikes = AGG().spikes.filter(s => state.vac.has(s.vaccine) && inRange(s.date));
  const rebuttals = D.policy.filter(p => ['Clarification', 'Rumour rebuttal'].includes(p.type) && inRange(p.date) && p.vaccines.some(v => state.vac.has(v)) && inFund(p.funding) && inBrand(p.brand) && inPlace(p.places));
  const mis = D.misinfo.filter(x => state.vac.has(x.vaccine) && inFund(x.funding) && inBrand(x.brand) && inPlace(x.places));
  const voices = D.voices.filter(v => state.vac.has(v.vaccine) && (state.channel === 'all' || v.channel === state.channel) && inFund(v.funding) && inBrand(v.brand) && inPlace(v.places));
  const LEVEL = { monitor: ['good', tr('Monitor', '持續監測')], watch: ['warning', tr('Watch', '密切關注')], respond: ['serious', tr('Respond', '需要回應')] };
  root.replaceChildren(
    viewHead(tr('Social listening', '社群輿情'), tr('Aggregated public conversation on PTT, Threads and comments on public Facebook pages, plus news coverage. Posts are paraphrased and no usernames are stored.',
      '彙整 PTT、Threads 與 Facebook 公開粉專留言中的公開討論，以及新聞報導。貼文均經改寫，不儲存任何使用者名稱。')),
    filterRow({ channel: true }),
    channelCard(),
    placeCard(),
    attentionRow() || '',
    narrativesCard(),
    h('div', { class: 'grid-2' },
      h('section', { class: 'card' },
        h('h3', { class: 'card-title' }, tr('Spike alerts', '聲量暴增警示')),
        h('p', { class: 'card-sub', style: 'margin-bottom:12px' }, tr('Days when a vaccine’s mentions ran well above their trailing 28-day average.', '某疫苗提及數明顯高於前 28 日平均的日子。')),
        spikes.length ? h('ul', { class: 'feed' }, spikes.map(s => h('li', null,
          h('div', { class: 'meta-row' }, h('strong', { style: 'color:var(--text-1)' }, tr(`${s.mult}× baseline`, `基準的 ${s.mult} 倍`)), h('span', null, `+${s.z}σ · ${fmtDate(asDate(s.date))}`)),
          h('div', null, vacChip(s.vaccine), tr(` ${fmt(s.count)} mentions that day`, ` 當天 ${fmt(s.count)} 則提及`)))))
          : emptyState(tr('No spikes in this range.', '此期間沒有聲量暴增。'), keys.length < VAC_KEYS.length ? tr('Include more vaccines or widen the range.', '請加入更多疫苗或拉長期間。') : tr('Widen the range.', '請拉長期間。'))),
      h('section', { class: 'card' },
        h('h3', { class: 'card-title' }, tr('Misinformation watch', '錯假訊息監測')),
        h('p', { class: 'card-sub', style: 'margin-bottom:12px' }, tr('Recurring false or misleading claims with a suggested response level, plus official rebuttals.', '反覆出現的錯誤或誤導性說法與建議回應層級，以及官方澄清。')),
        mis.length || rebuttals.length ? h('ul', { class: 'feed' },
          mis.map(x => h('li', null,
            h('strong', null, L(x, 'claim')),
            h('div', { class: 'meta-row' }, vacChip(x.vaccine), fundBadge(x.funding), brandBadge(x.brand), placeBadge(x.places), x.mentions != null ? h('span', null, tr(`${x.mentions} mentions in 7 days`, `7 天內 ${x.mentions} 則提及`)) : null, x.trend ? h('span', null, x.trend) : null,
              h('span', { class: 'status' }, statusIcon((LEVEL[x.level] || LEVEL.monitor)[0]), (LEVEL[x.level] || LEVEL.monitor)[1])),
            L(x, 'note') ? h('div', { class: 'muted small' }, L(x, 'note')) : null)),
          rebuttals.map(p => h('li', null,
            h('div', { class: 'meta-row' }, typeBadge('policy', tr(`${sourceName(p.source)} rebuttal`, `${sourceName(p.source)}澄清`)), p.vaccines.map(vacChip), fundBadge(p.funding), brandBadge(p.brand), placeBadge(p.places), h('span', null, fmtDate(asDate(p.date)))),
            extLink(p.url, policyTitle(p)))))
          : emptyState(tr('No claims or rebuttals for these vaccines in this range.', '此期間這些疫苗沒有假訊息或官方澄清。')))),
    h('section', { class: 'card' },
      h('h3', { class: 'card-title' }, tr('What people are saying', '民眾怎麼說')),
      h('p', { class: 'card-sub', style: 'margin-bottom:12px' }, tr('Representative posts, paraphrased by the AI tagger. Links open the public post.', '具代表性的貼文，由AI改寫。')),
      voices.length ? h('div', { class: 'voices' }, voices.map(v => h('article', { class: 'voice' },
        h('div', { class: 'meta-row' }, h('strong', { style: 'color:var(--text-1)' }, channelShort(v.channel)), vacChip(v.vaccine), stanceChip(v.stance), fundBadge(v.funding), brandBadge(v.brand), placeBadge(v.places)),
        h('p', null, L(v, 'text')),
        v.url ? h('p', { class: 'small' }, extLink(v.url, tr('View post', '查看貼文'))) : null)))
        : D.voices.length
          ? emptyState(tr('No posts match these filters.', '沒有符合篩選條件的貼文。'), tr('Include more vaccines, or choose another channel or Who pays option.', '請加入更多疫苗，或改選其他管道或費用選項。'))
          : emptyState(tr('Paraphrased examples appear after the AI tagger runs.', 'AI 標註完成後會顯示改寫範例。'))));
}

function renderMethod() {
  $('#sources-table').replaceChildren(dataTable(
    [tr('Source', '來源'), tr('Type', '類型'), tr('What is collected', '收集內容'), tr('Method', '方法'), tr('Status', '狀態')],
    D.sources.map(s => [L(s, 'name'), tr(s.type, SRC_TYPE_ZH[s.type] || s.type), L(s, 'what'), L(s, 'how'), statusLabel(s)])));
}

function renderLens(root) {
  if (!LENS) {
    root.replaceChildren(viewHead(tr('Analyst lens', '分析視角'), tr('This page fills in after the AI analyst has run.', 'AI 分析完成後，此頁會顯示內容。')));
    return;
  }
  const RISK = { low: ['good', tr('Low', '低')], medium: ['warning', tr('Medium', '中')], high: ['serious', tr('High', '高')] };
  const nProducts = (LENS.products || []).length, ZH_COUNT = { 2: '兩', 3: '三', 4: '四', 5: '五' };
  root.replaceChildren(
    h('div', { class: 'lens-banner', role: 'note' },
      h('span', null, h('strong', null, tr('Independent analysis', '獨立分析')),
        tr(' by Hao-Kai Tseng · not affiliated with or endorsed by Sanofi · strategy notes for public-affairs planning, not promotional messaging.',
          '・作者 曾皓楷・與 Sanofi 無隸屬或背書關係・供公共事務規劃參考的策略筆記，非行銷宣傳。')),
      h('a', { href: ZH() ? '../?lang=zh' : '../' }, tr('← Public dashboard', '← 公開儀表板'))),
    viewHead(tr(LENS.title || 'Analyst lens: Sanofi vaccines in Taiwan', '分析視角：Sanofi 在台疫苗'),
      tr(`What this week’s policy and social signals could mean for ${nProducts} products, and the public-affairs moves they suggest. Strategy notes, not promotional messaging. Generated ${LENS.date || ''}.`,
        `本週政策與社群訊號對${ZH_COUNT[nProducts] || nProducts}項產品可能代表的意義，以及據此建議的公共事務行動。策略筆記，非行銷宣傳。產生日期 ${LENS.date || ''}，中文由 AI 翻譯。`)),
    h('div', { class: nProducts % 2 === 0 ? 'grid-2' : 'grid-3' }, (LENS.products || []).map(p => h('section', { class: 'card product' },
      h('div', { class: 'product-head' },
        h('div', null, h('h3', { class: 'card-title' }, L(p, 'name')), h('p', { class: 'card-sub' }, L(p, 'sub'))),
        h('span', { class: 'status' }, statusIcon((RISK[p.risk] || RISK.medium)[0]), tr('Risk: ', '風險：') + (RISK[p.risk] || RISK.medium)[1])),
      h('div', { style: 'margin-top:8px' }, vacChip(p.vaccine)),
      h('dl', null,
        h('div', null, h('dt', null, tr('Signal this week', '本週訊號')), h('dd', null, L(p, 'signal'))),
        h('div', null, h('dt', null, tr('Implication', '意涵')), h('dd', null, L(p, 'implication'))),
        h('div', null, h('dt', null, tr('Suggested PA action', '建議的公共事務行動')), h('dd', null, L(p, 'action'))),
        h('div', null, h('dt', null, tr('Stakeholders to engage', '應溝通的利害關係人')), h('dd', null, h('span', { class: 'who' }, (L(p, 'who') || []).map(w => h('span', { class: 'pill' }, w)))))),
      p.sources && p.sources.length ? h('p', { class: 'basis' }, tr('Based on: ', '依據：'), citations(p.sources)) : null))),
    h('div', { class: 'grid-2' },
      h('section', { class: 'card' },
        h('h3', { class: 'card-title' }, tr('Issues to prepare for', '需預先準備的議題')),
        h('p', { class: 'card-sub', style: 'margin-bottom:12px' }, tr('Next 30 days.', '未來 30 天。')),
        (LENS.issues || []).length ? h('ul', { class: 'feed' }, LENS.issues.map(x => h('li', null,
          h('div', { class: 'meta-row' }, h('strong', { style: 'color:var(--text-1)' }, L(x, 'when')),
            h('span', null, tr(`Likelihood ${x.likelihood} · Impact ${x.impact}`, `可能性 ${hml(x.likelihood)} · 影響 ${hml(x.impact)}`))),
          h('strong', null, L(x, 'title')),
          h('div', { class: 'muted small' }, L(x, 'note'))))) : emptyState(tr('Nothing flagged.', '目前沒有需標記的議題。'))),
      h('section', { class: 'card' },
        h('h3', { class: 'card-title' }, tr('Self-pay market watch', '自費市場觀察')),
        h('p', { class: 'card-sub', style: 'margin-bottom:12px' }, tr('Clinic stock, prices and private demand outside the public programme.',
          '公費計畫以外的診所庫存、價格與自費需求。')),
        (LENS.self_pay || []).length ? h('ul', { class: 'feed' }, LENS.self_pay.map(x => h('li', null,
          h('strong', null, L(x, 'title')),
          h('div', { class: 'muted small' }, L(x, 'note')),
          x.sources && x.sources.length ? h('p', { class: 'src' }, tr('Sources: ', '來源：'), citations(x.sources)) : null)))
          : emptyState(tr('Appears after the next analyst run.', '下次 AI 分析後顯示。')))),
    h('section', { class: 'card' },
      h('h3', { class: 'card-title' }, tr('Compliance guardrails', '法規遵循原則')),
      h('p', { class: 'small muted', style: 'margin-top:6px' }, tr('Strategy notes only. No product claims, comparative-efficacy statements or messages for the public. Advertising prescription medicines to the public is restricted in Taiwan, and any external use of this analysis would need medical, legal and regulatory review.',
        '僅為策略筆記。不含產品宣稱、比較性療效陳述或對民眾的訊息。台灣限制對一般民眾刊登處方藥廣告，本分析若有任何對外使用，都需經醫學、法務與法規審查。'))));
}

const VIEWS = { today: renderToday, policy: renderPolicy, social: renderSocial, method: renderMethod, lens: renderLens };

function renderCurrent() {
  const fkey = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.fkey : null;
  mounted = [];
  tipHide();
  VIEWS[state.view]($('#view-' + state.view));
  requestAnimationFrame(() => {
    mounted.forEach(draw => draw());
    if (fkey) { const el = document.querySelector(`[data-fkey="${fkey}"]`); if (el) el.focus(); }
  });
}

/* =========================================================
   Shell: header, status strip, tabs, theme, language, resize
   ========================================================= */
function renderShell() {
  const gen = new Date(D.generated_at);
  const when = gen.toLocaleString(ZH() ? 'zh-TW' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Taipei' });
  const anyFailed = D.sources.some(s => s.status === 'failed' || s.status === 'stale');
  const time = h('time', { datetime: D.generated_at }, when);
  $('#updated').replaceChildren(statusIcon(anyFailed ? 'warning' : 'good'), ZH()
    ? h('span', null, time, ' 更新', h('span', { class: 'hide-sm' }, '（台北時間）· 每日自動更新'))
    : h('span', null, 'Updated ', time, ' Taipei', h('span', { class: 'hide-sm' }, ' · updates daily')));
  const strip = $('#status-strip');
  if (strip) {
    strip.replaceChildren(h('span', { class: 'strip-label' }, tr('Sources', '資料來源')),
      ...D.sources.map(s => h('span', { class: 'src-chip', role: 'listitem',
        title: `${L(s, 'name')}${tr(': ', '：')}${srcLabel(s.status)}${s.last_success ? ` · ${tr('last success', '上次成功')} ${s.last_success.replace('T', ' ').slice(0, 16)}` : ''}${s.error ? ` · ${s.error}` : ''}` },
        statusIcon(srcLevel(s.status)), L(s, 'name'),
        s.status === 'ok' ? null : h('span', { class: 'src-stale' }, ZH() ? srcLabel(s.status) : srcLabel(s.status).toLowerCase()))));
  }
  const meta = $('#footer-meta');
  if (meta) meta.textContent = tr(`Data as of ${D.as_of} · ${fmt(D.counts.items)} items in the last ${N} days · ${fmt(D.counts.tagged)} AI-tagged`,
    `資料截至 ${D.as_of} · 近 ${N} 天共 ${fmt(D.counts.items)} 則 · ${fmt(D.counts.tagged)} 則經 AI 標註`);
}

const TAB_VIEWS = ['today', 'policy', 'social', 'method'];
function route() {
  const v = (location.hash || '#today').slice(1);
  const prev = state.view;
  state.view = TAB_VIEWS.includes(v) ? v : 'today';
  for (const k of TAB_VIEWS) $('#view-' + k).hidden = k !== state.view;
  for (const k of TAB_VIEWS) {
    const t = $('#tab-' + k), on = k === state.view;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
  }
  renderCurrent();
  if (prev !== state.view) window.scrollTo(0, 0);
}

const THEMES = ['auto', 'light', 'dark'];
const THEME_TEXT = { auto: ['Auto', '自動'], light: ['Light', '淺色'], dark: ['Dark', '深色'] };
let theme = 'light';   // default for every visitor; a choice made with the theme button is remembered
try { theme = localStorage.getItem('radar-theme') || 'light'; } catch (e) { /* storage unavailable */ }
function applyTheme() {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  const b = $('#theme-btn');
  if (!b) return;
  const name = tr(...THEME_TEXT[theme]);
  b.textContent = tr(`Theme: ${name}`, `主題：${name}`);
  b.setAttribute('aria-label', tr(`Colour theme: ${name}. Select to change.`, `色彩主題：${name}。點選以切換。`));
}

// Static markup: both languages sit side by side (data-lang) and CSS shows the one matching <html lang>.
// Attributes are swapped here: data-aria-zh holds the Chinese aria-label, data-title-zh the page title.
function applyLang() {
  document.documentElement.lang = ZH() ? 'zh-Hant-TW' : 'en';
  const body = document.body;
  if (!body.dataset.titleEn) body.dataset.titleEn = document.title;
  document.title = ZH() && body.dataset.titleZh ? body.dataset.titleZh : body.dataset.titleEn;
  document.querySelectorAll('[data-aria-zh]').forEach(el => {
    if (el.dataset.ariaEn == null) el.dataset.ariaEn = el.getAttribute('aria-label') || '';
    el.setAttribute('aria-label', ZH() ? el.dataset.ariaZh : el.dataset.ariaEn);
  });
  document.querySelectorAll('[data-lang-set]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.langSet === LANG)));
  // Links between the dashboard and the lens page keep the chosen language.
  document.querySelectorAll('a[data-keep-lang]').forEach(a => {
    const base = a.getAttribute('href').split('?')[0];
    a.setAttribute('href', ZH() ? base + '?lang=zh' : base);
  });
  applyTheme();
}
function setLang(next) {
  if (next === LANG) return;
  LANG = next === 'zh' ? 'zh' : 'en';
  try { localStorage.setItem(LANG_KEY, LANG); } catch (e) { /* storage unavailable */ }
  try {   // shareable URL: ?lang=zh for Chinese, no parameter for English
    const u = new URL(location.href);
    if (ZH()) u.searchParams.set('lang', 'zh'); else u.searchParams.delete('lang');
    history.replaceState(history.state, '', u.href);
  } catch (e) { /* e.g. file:// */ }
  applyLang();
  if (D) { renderShell(); renderCurrent(); }
}

async function boot() {
  applyLang();
  const btn = $('#theme-btn');
  if (btn) btn.addEventListener('click', () => {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    try { localStorage.setItem('radar-theme', theme); } catch (e) { /* storage unavailable */ }
    applyTheme();
  });
  document.querySelectorAll('[data-lang-set]').forEach(b => b.addEventListener('click', () => setLang(b.dataset.langSet)));
  const isLens = document.body.dataset.page === 'lens';
  const base = isLens ? '../' : '';
  DATA_BASE = base;
  try {
    const res = await fetch(base + 'data/latest.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    useData(await res.json());
    if (isLens) {
      const lr = await fetch(base + 'data/lens.json', { cache: 'no-cache' });
      LENS = lr.ok ? await lr.json() : null;
    }
  } catch (e) {
    const err = $('#load-error');
    if (err) err.hidden = false;
    return;
  }
  renderShell();
  if (isLens) {
    state.view = 'lens';
    renderCurrent();
  } else {
    const tabs = document.querySelector('.tabs');
    tabs.addEventListener('click', e => {
      const b = e.target.closest('[role="tab"]');
      if (b) location.hash = '#' + b.dataset.view;
    });
    tabs.addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const i = TAB_VIEWS.indexOf(state.view);
      const next = TAB_VIEWS[(Math.max(0, i) + (e.key === 'ArrowRight' ? 1 : TAB_VIEWS.length - 1)) % TAB_VIEWS.length];
      location.hash = '#' + next;
      requestAnimationFrame(() => $('#tab-' + next).focus());
    });
    window.addEventListener('hashchange', route);
    loadGeo();          // map shapes for the Social listening card, fetched in the background
    route();
  }
  let lastW = 0, raf = 0;
  new ResizeObserver(entries => {
    const w = Math.round(entries[0].contentRect.width);
    if (w === lastW) return;
    lastW = w;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => mounted.forEach(draw => draw()));
  }).observe($('#main'));
}

boot();
})();
