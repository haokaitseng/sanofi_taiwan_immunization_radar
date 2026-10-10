/* Taiwan Immunization Radar: renders data/latest.json (and data/lens.json on the unlisted lens page).
   Colours, marks and interaction follow the validated palette in style.css. */
(() => {
'use strict';

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
const compact = n => (n >= 10000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : fmt(n));
const pct = (x, d = 0) => (x * 100).toFixed(d) + '%';
const fmtDate = (d, o = { month: 'short', day: 'numeric' }) => d.toLocaleDateString('en-US', { ...o, timeZone: 'UTC' });
const asDate = iso => new Date(iso + 'T00:00:00Z');
const sum = a => a.reduce((s, v) => s + (v || 0), 0);
const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/* =========================================================
   Vocabulary
   ========================================================= */
const SHORT = { flu: 'Flu', enh: 'Enh.', adj: 'Adj.', hd: 'HD', rsv: 'RSV', tdap: 'Tdap' };
const STANCE = [
  { key: 'opposed', label: 'Opposed', v: '--st-opp' },
  { key: 'hesitant', label: 'Hesitant', v: '--st-hes' },
  { key: 'neutral', label: 'Neutral', v: '--st-neu' },
  { key: 'accepting', label: 'Accepting', v: '--st-acc' },
  { key: 'advocating', label: 'Advocating', v: '--st-adv' },
];
const STANCE_BY_KEY = Object.fromEntries(STANCE.map(s => [s.key, s]));
const ISSUES = [
  { short: 'Eligibility', long: 'Eligibility and access' },
  { short: 'Cost', long: 'Cost and self-pay' },
  { short: 'Safety', long: 'Safety and side effects' },
  { short: 'Evidence', long: 'Effectiveness and evidence' },
  { short: 'Supply', long: 'Supply and availability' },
  { short: 'Outbreaks', long: 'Disease risk and outbreaks' },
];
const CHANNELS = [
  { key: 'News', label: 'News' },
  { key: 'PTT', label: 'PTT' },
  { key: 'Threads', label: 'Threads' },
  { key: 'Facebook', label: 'Facebook pages' },
];
const NSTATUS = {
  emerging: { icon: '✦', label: 'Emerging' }, rising: { icon: '↗', label: 'Rising' },
  steady: { icon: '→', label: 'Steady' }, fading: { icon: '↘', label: 'Fading' },
};
const TYPES = {
  policy: { glyph: '▲', label: 'Policy', title: 'Official notice from Taiwan CDC or TFDA' },
  media: { glyph: '■', label: 'Media', title: 'News reporting' },
  signal: { glyph: '◆', label: 'Signal', title: 'Social-media signal: volume and narrative, not validated evidence' },
};
const SOURCE_STATUS = { ok: ['good', 'OK'], stale: ['warning', 'Stale'], failed: ['critical', 'Failed'], pending: ['pending', 'Not connected yet'], local: ['good', 'Local runs only'] };

/* =========================================================
   Data
   ========================================================= */
let D = null, LENS = null, N = 0, DATES = [], AVG = {}, VACCINES = [], VAC_KEYS = [], VAC = {};
const state = { view: 'today', range: 90, vac: new Set(), source: 'all', channel: 'all' };

function useData(data) {
  D = data;
  N = D.dates.length;
  DATES = D.dates.map(asDate);
  VACCINES = D.vaccines.map(v => ({ ...v, short: SHORT[v.key] || v.label }));
  VAC_KEYS = VACCINES.map(v => v.key);
  VAC = Object.fromEntries(VACCINES.map(v => [v.key, v]));
  AVG = Object.fromEntries(VAC_KEYS.map(k => {
    const a = D.series[k];
    return [k, a.map((_, i) => sum(a.slice(Math.max(0, i - 6), i + 1)) / Math.min(7, i + 1))];
  }));
  state.vac = new Set(VAC_KEYS);
}
const selKeys = () => VAC_KEYS.filter(k => state.vac.has(k));
const volume = (k, r, prior = false) => {
  const s = D.series[k];
  return prior ? sum(s.slice(Math.max(0, N - 2 * r), N - r)) : sum(s.slice(N - r));
};
const inRange = (iso, r = state.range) => iso >= D.dates[N - r];
const inPrior = (iso, r = state.range) => N - 2 * r >= 0 && iso >= D.dates[N - 2 * r] && iso < D.dates[N - r];
const rangeMix = (obj, k, r = state.range) => (obj && obj[String(r)] && obj[String(r)][k]) || null;
const policyTitle = p => p.title_en || p.title_zh;
const shortPolicyTitle = p => truncate(policyTitle(p), 60);
const sourceName = id => ({ cdc: 'Taiwan CDC', tfda: 'TFDA' }[id] || id);

function weekly(fn, weeks = 12) {
  const out = [];
  for (let wk = weeks; wk >= 1; wk--) { const b = N - (wk - 1) * 7; out.push(fn(Math.max(0, b - 7), b)); }
  return out;
}
function computeKpis() {
  const keys = selKeys(), r = state.range;
  const pol = D.policy.filter(p => p.vaccines.some(v => state.vac.has(v)));
  const cur = pol.filter(p => inRange(p.date, r)), pri = pol.filter(p => inPrior(p.date, r));
  const hes = prior => {
    let num = 0, den = 0;
    for (const k of keys) {
      const m = rangeMix(prior ? D.stance_prior : D.stance, k, r);
      if (!m) continue;
      const vol = volume(k, r, prior);
      num += vol * (m[0] + m[1]); den += vol;
    }
    return den ? num / den : null;
  };
  const narr = D.narratives.filter(n => n.vaccines.some(v => state.vac.has(v)));
  return {
    mentions: keys.reduce((s, k) => s + volume(k, r), 0),
    mentionsPrior: keys.reduce((s, k) => s + volume(k, r, true), 0),
    official: cur.length, officialPrior: pri.length,
    cdc: cur.filter(p => p.source === 'cdc').length, tfda: cur.filter(p => p.source === 'tfda').length,
    hes: hes(false), hesPrior: hes(true),
    narratives: narr.length,
    rising: narr.filter(n => n.status === 'emerging' || n.status === 'rising').length,
    emerging: narr.filter(n => n.status === 'emerging').length,
    spikes: D.spikes.filter(s => state.vac.has(s.vaccine) && inRange(s.date, r)).length,
    mentionsWeekly: weekly((a, b) => keys.reduce((s, k) => s + sum(D.series[k].slice(a, b)), 0)),
  };
}
const periodText = () => `vs prior ${state.range} days`;
// The prior period only counts if collection had started by then (the first run backfills 90 days).
const hasPrior = (r = state.range) => N - 2 * r >= 0 && D.coverage_start && D.dates[N - 2 * r] >= D.coverage_start;
const NO_PRIOR = { dir: 'flat', text: 'No earlier data to compare yet' };
function deltaPct(a, b) {
  if (!hasPrior()) return NO_PRIOR;
  if (!b) return a ? { dir: 'up', text: `new ${periodText()}` } : { dir: 'flat', text: `no change ${periodText()}` };
  const d = (a - b) / b;
  return { dir: Math.abs(d) < 0.005 ? 'flat' : d > 0 ? 'up' : 'down', text: `${Math.abs(d * 100).toFixed(0)}% ${periodText()}` };
}
function deltaAbs(a, b) {
  if (!hasPrior()) return NO_PRIOR;
  const d = a - b;
  return { dir: d === 0 ? 'flat' : d > 0 ? 'up' : 'down', text: `${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d)} ${periodText()}` };
}
function deltaPts(a, b) {
  if (!hasPrior()) return NO_PRIOR;
  const d = (a - b) * 100;
  return { dir: Math.abs(d) < 0.25 ? 'flat' : d > 0 ? 'up' : 'down', text: `${Math.abs(d).toFixed(1)} pts ${periodText()}` };
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
const statusLabel = s => h('span', { class: 'status' }, statusIcon(SOURCE_STATUS[s.status][0]), SOURCE_STATUS[s.status][1]);

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
      trend ? sparkline(trend, { w: 88, h: 30, label: `${label}: trend over the last 12 weeks` }) : null),
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
  const row = h('div', { class: 'filters', role: 'group', 'aria-label': 'Filters for this view' });
  const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Date range' });
  for (const r of [7, 30, 90]) seg.append(h('button', {
    type: 'button', role: 'radio', 'aria-checked': String(state.range === r), 'data-fkey': `range-${r}`,
    onclick: () => setState({ range: r }) }, `${r} days`));
  row.append(h('div', { class: 'filter' }, h('span', { class: 'filter-label' }, 'Range'), seg));
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Vaccines' },
    h('button', { type: 'button', class: 'chip', 'aria-pressed': String(state.vac.size === VAC_KEYS.length), 'data-fkey': 'vac-all',
      onclick: () => setState({ vac: new Set(VAC_KEYS) }) }, 'All'),
    VACCINES.map(v => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(state.vac.has(v.key)), 'data-fkey': `vac-${v.key}`,
      title: v.zh, onclick: () => toggleVac(v.key) }, h('span', { class: 'dot', style: `background:var(--s-${v.key})` }), v.label)));
  row.append(h('div', { class: 'filter' }, h('span', { class: 'filter-label' }, 'Vaccines'), chips));
  if (source) {
    const s2 = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Source' });
    for (const [k, label] of [['all', 'All'], ['cdc', 'Taiwan CDC'], ['tfda', 'TFDA']]) s2.append(h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(state.source === k), 'data-fkey': `src-${k}`,
      onclick: () => setState({ source: k }) }, label));
    row.append(h('div', { class: 'filter' }, h('span', { class: 'filter-label' }, 'Source'), s2));
  }
  if (channel) {
    const sel = h('select', { 'aria-label': 'Channel', 'data-fkey': 'channel', onchange: e => setState({ channel: e.target.value }) },
      h('option', { value: 'all' }, 'All channels'), CHANNELS.map(c => h('option', { value: c.key }, c.label)));
    sel.value = state.channel;
    row.append(h('div', { class: 'filter' }, h('span', { class: 'filter-label' }, 'Channel'), sel));
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
  const btn = h('button', { type: 'button', class: 'btn-ghost', 'aria-pressed': 'false' }, 'Table view');
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
  const svg = sv('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'chart', tabindex: 0, role: 'img',
    'aria-label': `Line chart of daily mentions, 7-day average, for ${series.map(s => s.label).join(', ')}, over ${n} days. Use the left and right arrow keys to read values.` });
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
    const badge = sv('g', { class: 'event-badge', tabindex: 0, role: 'img', 'aria-label': `Marker ${ev.n}, ${fmtDate(ev.date)}: ${ev.title} (${ev.source})` },
      sv('circle', { cx, cy, r: 9 }),
      sv('text', { x: cx, y: cy + 0.5, 'text-anchor': 'middle', 'dominant-baseline': 'middle', text: String(ev.n) }));
    hoverTip(badge, () => [{ value: ev.title, label: ev.source }], `${ev.n} · ${fmtDate(ev.date, { weekday: 'short', month: 'short', day: 'numeric' })}`);
    svg.append(badge);
  });
  for (const s of series) {
    const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    svg.append(sv('path', { d, class: 'line', style: `stroke:${s.color}` }));
  }
  for (const s of series) svg.append(sv('circle', { cx: x(n - 1), cy: y(s.values[n - 1]), r: 4, class: 'dot-ring', style: `fill:${s.color}` }));
  if (!narrow) {
    const lab = series.map(s => ({ s, y0: y(s.values[n - 1]) })).sort((a, b) => a.y0 - b.y0);
    const gap = 16, top = m.t + 4, bot = m.t + ph;
    lab.forEach((L, i) => { L.y = Math.max(L.y0, top, i ? lab[i - 1].y + gap : -Infinity); });
    if (lab.length && lab[lab.length - 1].y > bot) {
      lab[lab.length - 1].y = bot;
      for (let i = lab.length - 2; i >= 0; i--) lab[i].y = Math.min(lab[i].y, lab[i + 1].y - gap);
    }
    const ex = x(n - 1), lx = ex + 18;
    for (const L of lab) {
      if (Math.abs(L.y - L.y0) > 1.5) svg.append(sv('path', { d: `M${ex + 6},${L.y0}L${lx - 4},${L.y}`, class: 'leader', style: `stroke:${L.s.color}` }));
      svg.append(sv('text', { x: lx, y: L.y, class: 'end-label', 'dominant-baseline': 'middle' },
        sv('tspan', { class: 'end-name', text: L.s.label + ' ' }),
        sv('tspan', { class: 'end-val', text: fmtAvg(L.s.values[n - 1]) })));
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
      `${fmtDate(dates[i], { weekday: 'short', month: 'short', day: 'numeric' })} · 7-day average`);
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
  const svg = sv('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img',
    'aria-label': `Stance by vaccine. ${rows.map(r => r.mix ? `${r.label}: ${pct(r.mix[0] + r.mix[1])} hesitant or opposed, ${pct(r.mix[3] + r.mix[4])} accepting or advocating` : `${r.label}: not enough tagged mentions`).join('; ')}.` });
  for (const t of [-dom, -dom / 2, 0, dom / 2, dom]) {
    svg.append(sv('text', { x: x0 + t * sc, y: H - 6, class: 'tick', 'text-anchor': 'middle', text: t === 0 ? '0' : pct(Math.abs(t)) }));
  }
  svg.append(sv('line', { x1: x0, x2: x0, y1: m.t, y2: H - m.b + 2, class: 'axis-line' }));
  rows.forEach((r, i) => {
    const cy = m.t + i * rowH + (narrow ? rowH - barH / 2 - 6 : rowH / 2);
    svg.append(sv('text', { x: 0, y: narrow ? cy - barH / 2 - 7 : cy, class: 'row-label', 'dominant-baseline': narrow ? 'auto' : 'middle', text: r.label }));
    if (!r.mix) {
      svg.append(sv('text', { x: x0 + 8, y: cy, class: 'tick', 'dominant-baseline': 'middle', text: 'Not enough tagged mentions yet' }));
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
  const grid = h('div', { class: 'heat', role: 'table', 'aria-label': 'Issue intensity by vaccine',
    style: `grid-template-columns: minmax(${narrow ? 70 : 92}px, auto) repeat(${C.length}, minmax(${narrow ? 34 : 48}px, 1fr));${narrow ? 'min-width:0;font-size:12px' : ''}` });
  grid.append(h('div', { role: 'columnheader' }));
  C.forEach(c => grid.append(h('div', { class: 'heat-col', role: 'columnheader', title: c.long }, c.short)));
  R.forEach((label, i) => {
    grid.append(h('div', { class: 'heat-row', role: 'rowheader' }, label));
    C.forEach((_, j) => {
      const { v, vac, issue } = at(i, j);
      if (v == null) {
        grid.append(h('div', { class: 'heat-cell heat-empty', role: 'cell', title: `${vac}: not enough tagged mentions` }, '–'));
        return;
      }
      const b = binOf(v);
      const cell = h('div', { class: 'heat-cell', role: 'cell', tabindex: 0, 'aria-label': `${vac}, ${issue}: ${v}%`,
        style: `background:var(--seq-${b});color:var(--seq-ink-${b})` }, `${v}%`);
      hoverTip(cell, () => [{ key: `var(--seq-${b})`, value: `${v}%`, label: issue }], vac);
      grid.append(cell);
    });
  });
  const scale = h('div', { class: 'scale' }, h('span', null, '% of mentions'),
    h('div', { class: 'scale-steps', 'aria-hidden': 'true' }, BINS.map((t, i) =>
      h('div', { class: 'scale-step' }, h('span', { style: `background:var(--seq-${i})` }), i === BINS.length - 1 ? `${t}+` : String(t)))));
  const abbrKey = narrow && rows.some(r => ['enh', 'adj', 'hd'].includes(r.key))
    ? h('p', { class: 'chart-note' }, 'Enh. = enhanced, type not stated · Adj. = adjuvanted · HD = high-dose') : null;
  host.append(h('div', { class: 'heat-scroll' }, grid), scale);
  if (abbrKey) host.append(abbrKey);
}

/* Horizontal stacked bars: rows = channels, segments = vaccines */
function stackedBars(host, rows) {
  host.replaceChildren();
  const W = Math.max(280, Math.floor(host.clientWidth));
  const labelW = Math.min(132, Math.max(56, Math.max(...rows.map(r => r.label.length)) * 7.2 + 14));
  const rowH = 38, barH = 18;
  const m = { t: 2, r: 58, b: 2, l: labelW };
  const pw = W - m.l - m.r, H = m.t + rows.length * rowH + m.b;
  const max = Math.max(1, ...rows.map(r => r.parts.reduce((a, p) => a + p.v, 0)));
  const sc = pw / max;
  const svg = sv('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img',
    'aria-label': `Mentions by channel. ${rows.map(r => `${r.label}: ${fmt(r.parts.reduce((a, p) => a + p.v, 0))}`).join('; ')}.` });
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
      hoverTip(seg, () => [{ key: `var(--s-${p.key})`, value: fmt(p.v), label: `${VAC[p.key].label} · ${pct(p.v / total)} of ${r.label}` }], r.label);
      svg.append(seg);
    });
    svg.append(sv('text', { x: xx + 6, y: cy, class: 'bar-val', 'dominant-baseline': 'middle', text: compact(total) }));
  });
  host.append(svg);
}

/* Stakeholder map: stance x influence, shape = stakeholder type */
const STAKE_TYPES = { gov: 'Government', hcp: 'Health professionals', pub: 'Media & public' };
function shapeMark(type, cx, cy) {
  if (type === 'gov') return sv('circle', { cx, cy, r: 5.5, class: 'mark' });
  if (type === 'hcp') return sv('rect', { x: cx - 5, y: cy - 5, width: 10, height: 10, rx: 1.5, class: 'mark' });
  return sv('path', { d: `M${cx},${cy - 6.5}L${cx + 6},${cy + 4.5}L${cx - 6},${cy + 4.5}Z`, class: 'mark' });
}
function stakeholderMap(host, pts, keyEl) {
  host.replaceChildren();
  const W = Math.max(280, Math.floor(host.clientWidth));
  const narrow = W < 540;
  if (keyEl) keyEl.hidden = !narrow;
  const H = narrow ? 340 : 440;
  const m = { t: 26, r: 16, b: 50, l: 30 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const x = s => m.l + ((s + 1) / 2) * pw;
  const y = v => m.t + ph - (v / 100) * ph;
  const svg = sv('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img',
    'aria-label': 'Stakeholder map: stance on vaccination against influence on the conversation.' });
  svg.append(sv('rect', { x: m.l, y: m.t, width: pw, height: ph, fill: 'none', style: 'stroke:var(--grid)' }));
  svg.append(sv('line', { x1: x(0), x2: x(0), y1: m.t, y2: m.t + ph, class: 'axis-line' }));
  svg.append(sv('line', { x1: m.l, x2: m.l + pw, y1: y(50), y2: y(50), class: 'axis-line' }));
  const q = [
    { t: 'Influential sceptics', x: m.l + 2, y: m.t - 9, a: 'start' },
    { t: 'Champions', x: m.l + pw - 2, y: m.t - 9, a: 'end' },
    { t: 'Monitor', x: m.l + 2, y: m.t + ph + 17, a: 'start' },
    { t: 'Allies to activate', x: m.l + pw - 2, y: m.t + ph + 17, a: 'end' },
  ];
  for (const c of q) svg.append(sv('text', { x: c.x, y: c.y, class: 'quad-label', 'text-anchor': c.a, text: c.t }));
  svg.append(sv('text', { x: m.l + pw / 2, y: H - 6, class: 'axis-title', 'text-anchor': 'middle', text: 'Stance: opposed ← → supportive' }));
  svg.append(sv('text', { x: 12, y: m.t + ph / 2, class: 'axis-title', 'text-anchor': 'middle', transform: `rotate(-90 12 ${m.t + ph / 2})`, text: 'Influence →' }));
  pts.forEach((p, i) => {
    const cx = x(p.stance), cy = y(p.influence);
    const g = sv('g', { class: 'pt', tabindex: 0, role: 'img', 'aria-label': `${p.label} (${STAKE_TYPES[p.type]}): influence ${p.influence}, stance ${p.stance > 0 ? '+' : ''}${p.stance.toFixed(2)}` },
      sv('circle', { cx, cy, r: 14, class: 'hit' }), shapeMark(p.type, cx, cy));
    const right = p.lab !== 'l';
    g.append(sv('text', { x: cx + (right ? 10 : -10), y: cy, class: 'pt-label', 'data-cx': cx, 'text-anchor': right ? 'start' : 'end', 'dominant-baseline': 'middle', text: narrow ? String(i + 1) : p.label }));
    hoverTip(g, () => [{ value: `Influence ${p.influence}`, label: `stance ${p.stance > 0 ? '+' : ''}${p.stance.toFixed(2)}${p.mentions ? ` · ${fmt(p.mentions)} mentions` : ''}` }], `${p.label} · ${STAKE_TYPES[p.type]}`);
    svg.append(g);
  });
  host.append(svg);
  // Label placement: try right, left, then above/below the point; keep the first spot inside the plot that
  // overlaps neither an earlier label nor another point. Falls back to the right-hand spot.
  const pad = 2;
  const marks = [...svg.querySelectorAll('.pt .mark')].map(mk => mk.getBBox());
  const placed = [];
  const hits = (a, b) => a.x < b.x + b.width + pad && b.x < a.x + a.width + pad && a.y < b.y + b.height + pad && b.y < a.y + a.height + pad;
  svg.querySelectorAll('.pt-label').forEach((t, i) => {
    const cx = +t.dataset.cx, cy = +t.getAttribute('y');
    const spots = [[cx + 10, cy, 'start'], [cx - 10, cy, 'end'], [cx + 6, cy - 13, 'start'], [cx + 6, cy + 13, 'start'],
      [cx - 6, cy - 13, 'end'], [cx - 6, cy + 13, 'end']];
    let chosen = null;
    for (const [x, y, anchor] of spots) {
      t.setAttribute('x', x); t.setAttribute('y', y); t.setAttribute('text-anchor', anchor);
      const b = t.getBBox();
      const inside = b.x >= m.l + 2 && b.x + b.width <= m.l + pw - 2 && b.y >= m.t && b.y + b.height <= m.t + ph;
      if (inside && !placed.some(p => hits(b, p)) && !marks.some((mk, j) => j !== i && hits(b, mk))) { chosen = b; break; }
    }
    if (!chosen) { t.setAttribute('x', cx + 10); t.setAttribute('y', cy); t.setAttribute('text-anchor', 'start'); chosen = t.getBBox(); }
    placed.push(chosen);
  });
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
        h('h2', { class: 'card-title', id: 'brief-h', style: 'font-size:18px' }, 'Latest'),
        h('p', { class: 'card-sub' }, 'The AI-written daily brief appears after the first analyst run. Until then, the newest official notices and headlines.'))),
      h('ol', { class: 'brief-list' },
        latestPolicy.map(p => h('li', { class: 'brief-item' },
          h('div', { class: 'meta-row' }, typeBadge('policy', sourceName(p.source)), p.vaccines.map(vacChip), h('span', null, fmtDate(asDate(p.date)))),
          h('h3', { class: 'brief-h' }, extLink(p.url, policyTitle(p))),
          p.title_en ? h('p', { class: 'zh', lang: 'zh-TW' }, p.title_zh) : null)),
        heads.map(n => h('li', { class: 'brief-item' },
          h('div', { class: 'meta-row' }, typeBadge('media'), n.vaccines.map(vacChip), h('span', null, `${n.outlet} · ${fmtDate(asDate(n.date))}`)),
          h('h3', { class: 'brief-h' }, extLink(n.url, n.title_en || n.title)),
          n.title_en ? h('p', { class: 'zh', lang: 'zh-TW' }, n.title) : null))));
  }
  return h('section', { class: 'card brief', 'aria-labelledby': 'brief-h' },
    h('div', { class: 'card-head' },
      h('div', null,
        h('h2', { class: 'card-title', id: 'brief-h', style: 'font-size:18px' }, 'Daily brief'),
        h('p', { class: 'card-sub' }, `${fmtDate(asDate(b.date), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · written by ${b.model} from ${fmt(b.items)} new items · published automatically, without human review`))),
    h('div', { class: 'brief-body' },
      h('div', null,
        h('ol', { class: 'brief-list' }, b.entries.map(e => h('li', { class: 'brief-item' },
          h('div', { class: 'meta-row' }, typeBadge(e.type), e.vaccines.map(vacChip), h('span', null, `Confidence: ${e.confidence}`)),
          h('h3', { class: 'brief-h' }, e.headline),
          e.zh ? h('p', { class: 'zh', lang: 'zh-TW' }, e.zh) : null,
          h('p', { class: 'why' }, h('strong', null, 'Why it matters: '), e.why),
          e.sources && e.sources.length ? h('p', { class: 'src' }, 'Sources: ', e.sources.map((s, i) => [i ? ' · ' : '', extLink(s.url, s.label)])) : null,
          e.type === 'signal' ? h('p', { class: 'signal-note' }, '◆ Signal from social data, not validated evidence.') : null))),
        b.entries.length > 3 ? h('button', { type: 'button', class: 'btn-ghost brief-more',
          onclick: e => e.currentTarget.closest('.brief').classList.add('expanded') }, `Show ${b.entries.length - 3} more items`) : null),
      h('aside', { class: 'brief-aside' },
        b.watch && b.watch.length ? h('div', { class: 'watch' }, h('h3', null, 'Watch next'),
          h('ul', null, b.watch.map(w => h('li', null, h('span', { class: 'watch-when' }, w.when), ' · ', w.text)))) : null,
        b.qa && b.qa.length ? h('div', null, h('h3', null, 'Questions a public-affairs lead would ask today'),
          b.qa.map(x => h('details', null, h('summary', null, x.q), h('p', null, x.a)))) : null)));
}

function kpiRow() {
  const k = computeKpis();
  const hasNarr = D.narratives.length > 0;
  return h('div', { class: 'kpis' },
    kpiTile({ label: `Mentions, last ${state.range} days`, value: compact(k.mentions), delta: deltaPct(k.mentions, k.mentionsPrior),
      trend: k.mentionsWeekly, sub: 'News and social, selected vaccines' }),
    kpiTile({ label: `Official actions, last ${state.range} days`, value: String(k.official), delta: deltaAbs(k.official, k.officialPrior),
      sub: `Taiwan CDC ${k.cdc} · TFDA ${k.tfda}` }),
    k.hes == null
      ? kpiTile({ label: 'Hesitant or opposed', value: '–', sub: 'Appears once AI stance tagging has run' })
      : kpiTile({ label: 'Hesitant or opposed', value: pct(k.hes), delta: k.hesPrior == null ? null : deltaPts(k.hes, k.hesPrior), goodWhen: 'down', sub: 'Share of all mentions' }),
    hasNarr
      ? kpiTile({ label: 'Rising narratives', value: String(k.rising), sub: `${k.emerging} emerging · ${k.narratives} tracked for these vaccines` })
      : kpiTile({ label: `Spike days, last ${state.range} days`, value: String(k.spikes), sub: 'Days well above the 28-day baseline' }));
}

function volumeCard() {
  const r = state.range, lo = N - r, dates = DATES.slice(lo);
  const sel = VACCINES.filter(v => state.vac.has(v.key));
  const series = sel.map(v => ({ key: v.key, label: v.label, color: `var(--s-${v.key})`, values: AVG[v.key].slice(lo) }));
  const events = D.policy.filter(p => p.marker && p.date >= D.dates[lo] && p.vaccines.some(v => state.vac.has(v)))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((p, j) => ({ n: j + 1, i: D.dates.indexOf(p.date) - lo, date: asDate(p.date), title: shortPolicyTitle(p), source: sourceName(p.source), url: p.url }))
    .filter(e => e.i >= 0);
  const legend = h('div', { class: 'legend' }, sel.map(v => h('span', { class: 'legend-item' },
    h('span', { class: 'key-line', style: `background:var(--s-${v.key})` }), v.label)));
  const evList = events.length ? h('ol', { class: 'event-list', 'aria-label': 'Policy markers' }, events.map(e => h('li', null,
    h('span', { class: 'ev-n', 'aria-hidden': 'true' }, String(e.n)),
    h('span', null, h('span', { class: 'ev-date' }, fmtDate(e.date)), ' ', extLink(e.url, e.title), ` · ${e.source}`)))) : null;
  const evAt = i => events.filter(e => e.i === i).map(e => `${e.n}. ${e.title}`).join('; ');
  return chartCard({
    title: 'Conversation volume and policy moments',
    subtitle: 'Daily mentions across news and social, 7-day average. Numbered markers are official actions by Taiwan CDC or TFDA.',
    legend,
    draw: host => lineChart(host, { dates, series, events }),
    table: () => dataTable(['Date', ...series.map(s => s.label), 'Official action'],
      dates.map((d, i) => [fmtDate(d), ...series.map(s => fmt(D.series[s.key][lo + i])), evAt(i)]), series.map((_, k) => k + 1)),
    after: evList,
  });
}

function stanceCard() {
  const rows = VACCINES.filter(v => state.vac.has(v.key)).map(v => ({ label: v.label, mix: rangeMix(D.stance, v.key) }));
  const legend = h('div', { class: 'legend' },
    STANCE.map(s => h('span', { class: 'legend-item' }, h('span', { class: 'key-rect', style: `background:var(${s.v})` }), s.label)));
  return chartCard({
    title: 'Stance toward vaccination',
    subtitle: `Share of AI-tagged mentions by stance, last ${state.range} days. Bars are centred on neutral; end labels show hesitant + opposed and accepting + advocating.`,
    legend,
    draw: host => likertChart(host, rows),
    table: () => dataTable(['Vaccine', ...STANCE.map(s => s.label)], rows.map(r => [r.label, ...(r.mix ? r.mix.map(v => pct(v)) : STANCE.map(() => '–'))]), [1, 2, 3, 4, 5]),
  });
}

function heatCard() {
  const rows = VACCINES.filter(v => state.vac.has(v.key));
  const values = rows.map(v => rangeMix(D.issues, v.key));
  return chartCard({
    title: 'What people are talking about',
    subtitle: `Share of each vaccine’s AI-tagged mentions that touch an issue, last ${state.range} days. One mention can touch several issues.`,
    draw: host => heatmap(host, rows, values),
    table: () => dataTable(['Vaccine', ...ISSUES.map(c => c.long)], rows.map((r, i) => [r.label, ...(values[i] ? values[i].map(v => `${v}%`) : ISSUES.map(() => '–'))]), [1, 2, 3, 4, 5, 6]),
  });
}

function narrativesCard({ top = 0, risingOnly = false } = {}) {
  let list = D.narratives.filter(n => n.vaccines.some(v => state.vac.has(v)));
  if (state.channel !== 'all') list = list.filter(n => (n.channels || []).includes(state.channel));
  if (risingOnly) list = list.filter(n => n.status === 'emerging' || n.status === 'rising');
  const r = state.range;
  let rows = list.map(n => ({ n, cur: sum(n.series.slice(N - r)), prior: sum(n.series.slice(Math.max(0, N - 2 * r), N - r)) }));
  rows.sort(risingOnly ? (a, b) => (b.cur / Math.max(b.prior, 1)) - (a.cur / Math.max(a.prior, 1)) : (a, b) => b.cur - a.cur);
  if (top) rows = rows.slice(0, top);
  const change = row => ((row.prior < 5 || row.cur > row.prior * 8) ? 'New' : `${row.cur >= row.prior ? '+' : '−'}${Math.abs((row.cur - row.prior) / row.prior * 100).toFixed(0)}%`);
  const netText = n => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`;
  const statusEl = s => h('span', { class: 'status' }, h('span', { 'aria-hidden': 'true' }, NSTATUS[s].icon), NSTATUS[s].label);
  const cards = h('ul', { class: 'narr-cards' }, rows.map(row => h('li', null,
    h('div', { class: 'meta-row' }, row.n.vaccines.map(vacChip), statusEl(row.n.status), h('span', null, `${fmt(row.cur)} mentions · ${change(row)}`)),
    h('div', { class: 'narr-title' }, row.n.title),
    h('div', { class: 'narr-para' }, row.n.para),
    h('div', { class: 'narr-foot' },
      sparkline(row.n.series.slice(N - r), { w: 96, h: 24, label: `${row.n.title}: daily mentions` }),
      h('span', { class: 'net' }, netBar(row.n.net), `Net ${netText(row.n.net)}`),
      h('span', { class: 'narr-ch' }, (row.n.channels || []).join(' · '))))));
  const body = rows.length ? h('div', null, h('div', { class: 'table-wrap narr-wide' }, h('table', { class: 'data-table narr-table' },
    h('thead', null, h('tr', null,
      h('th', { scope: 'col' }, 'Narrative'), h('th', { scope: 'col' }, 'Vaccine'), h('th', { scope: 'col' }, `Trend, ${r} days`),
      h('th', { scope: 'col', class: 'num' }, 'Mentions'), h('th', { scope: 'col', class: 'num' }, 'Change'),
      h('th', { scope: 'col' }, 'Net stance'), h('th', { scope: 'col' }, 'Status'))),
    h('tbody', null, rows.map(row => h('tr', null,
      h('th', { scope: 'row' }, h('div', { class: 'narr-title' }, row.n.title), h('div', { class: 'narr-para' }, row.n.para),
        h('div', { class: 'narr-ch' }, (row.n.channels || []).join(' · '))),
      h('td', null, h('span', { class: 'chips-inline' }, row.n.vaccines.map(vacChip))),
      h('td', null, sparkline(row.n.series.slice(N - r), { w: 96, h: 26, label: `${row.n.title}: daily mentions` })),
      h('td', { class: 'num' }, fmt(row.cur)),
      h('td', { class: 'num' }, change(row)),
      h('td', null, h('span', { class: 'net' }, netBar(row.n.net), netText(row.n.net))),
      h('td', null, statusEl(row.n.status))))))), cards)
    : emptyState(D.narratives.length ? 'No narratives match these filters.' : 'Narratives appear after the AI analyst runs.',
      D.narratives.length ? 'Include more vaccines or choose another channel.' : 'The analyst groups tagged posts into storylines once a day.');
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', null,
      h('h3', { class: 'card-title' }, risingOnly ? 'Emerging and rising narratives' : 'Narrative explorer'),
      h('p', { class: 'card-sub' }, risingOnly
        ? 'Storylines gaining momentum, ranked by growth against the prior period. Paraphrased; no usernames.'
        : `All tracked storylines, ranked by mentions in the last ${r} days. Net stance = supportive share minus hesitant/opposed share.`))),
    body);
}

function renderToday(root) {
  root.replaceChildren(
    briefCard(),
    filterRow(),
    kpiRow(),
    volumeCard(),
    h('div', { class: 'grid-2' }, stanceCard(), heatCard()),
    narrativesCard({ top: 5, risingOnly: true }));
}

function renderPolicy(root) {
  const items = D.policy.filter(p => inRange(p.date) && p.vaccines.some(v => state.vac.has(v))
    && (state.source === 'all' || p.source === state.source));
  const counts = {};
  items.forEach(p => { counts[p.type] = (counts[p.type] || 0) + 1; });
  const watch = (D.brief && D.brief.watch) || [];
  root.replaceChildren(
    viewHead('Official actions', 'Taiwan CDC (衛福部疾管署) and TFDA (食藥署) only: press releases, letters to physicians, clarifications, announcements, drug-safety notices and rumour rebuttals.'),
    filterRow({ source: true }),
    h('div', { class: 'grid-policy' },
      h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('div', null,
          h('h3', { class: 'card-title' }, `${items.length} ${items.length === 1 ? 'action' : 'actions'} in the last ${state.range} days`),
          h('p', { class: 'card-sub' }, 'Newest first. English summaries come from the AI tagger; the original Chinese title is always shown.'))),
        items.length ? h('ol', { class: 'timeline' }, items.map(p => h('li', { class: 'tl-item' },
          h('div', { class: 'tl-date' }, h('time', { datetime: p.date }, fmtDate(asDate(p.date)))),
          h('div', null,
            h('div', { class: 'meta-row' }, typeBadge('policy', sourceName(p.source)), h('span', { class: 'tag' }, p.type), p.vaccines.map(vacChip)),
            h('h4', { class: 'tl-title' }, policyTitle(p)),
            p.title_en ? h('p', { class: 'zh', lang: 'zh-TW' }, p.title_zh) : null,
            p.summary ? h('p', { class: 'why' }, p.summary) : null,
            p.why ? h('p', { class: 'why' }, h('strong', null, 'Why it matters: '), p.why) : null,
            h('p', { class: 'src' }, extLink(p.url, 'Original notice'))))))
          : emptyState('No official actions match these filters.', 'Try a longer range, another source or more vaccines.')),
      h('div', { class: 'stack' },
        watch.length ? h('section', { class: 'card' },
          h('h3', { class: 'card-title' }, 'Watch list'),
          h('p', { class: 'card-sub', style: 'margin-bottom:12px' }, 'Dates and decisions coming up, from today’s brief.'),
          h('ul', { class: 'watch-list' }, watch.map(w => h('li', null, h('strong', null, w.when), h('span', null, w.text))))) : null,
        h('section', { class: 'card' },
          h('h3', { class: 'card-title', style: 'margin-bottom:12px' }, 'By type'),
          Object.keys(counts).length
            ? h('ul', { class: 'count-list' }, Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([t, c]) =>
              h('li', null, h('span', null, t), h('span', { class: 'num' }, String(c)))))
            : h('p', { class: 'muted small' }, 'Nothing in this range.')))));
}

function channelCard() {
  const keys = selKeys(), r = state.range;
  const chans = state.channel === 'all' ? CHANNELS : CHANNELS.filter(c => c.key === state.channel);
  const rows = chans.map(c => ({ label: c.label, parts: keys.map(k => ({ key: k, v: (rangeMix(D.channels, k, r) || {})[c.key] || 0 })) }));
  const legend = h('div', { class: 'legend' }, keys.map(k => h('span', { class: 'legend-item' },
    h('span', { class: 'key-rect', style: `background:var(--s-${k})` }), VAC[k].label)));
  const social = D.sources.filter(s => ['threads', 'facebook', 'ptt'].includes(s.id) && !['ok', 'local'].includes(s.status));
  return chartCard({
    title: 'Where the conversation happens',
    subtitle: `Mentions by channel and vaccine, last ${r} days.`,
    legend,
    draw: host => stackedBars(host, rows),
    table: () => dataTable(['Channel', ...keys.map(k => VAC[k].label), 'Total'],
      rows.map(rw => [rw.label, ...rw.parts.map(p => fmt(p.v)), fmt(rw.parts.reduce((a, p) => a + p.v, 0))]), keys.map((_, i) => i + 1).concat(keys.length + 1)),
    after: social.length ? h('p', { class: 'chart-note' }, statusIcon(social.some(s => s.status === 'stale') ? 'warning' : 'pending'),
      `${social.map(s => `${s.name}: ${SOURCE_STATUS[s.status][1].toLowerCase()}`).join(' · ')}. Their bars stay empty until the source is connected.`) : null,
  });
}

function attentionRow() {
  const r = state.range;
  const keys = selKeys().filter(k => D.attention[k] && D.attention[k].some(v => v != null));
  if (!keys.length) return null;
  return h('div', null,
    h('div', { class: 'card-head', style: 'margin-bottom:10px' }, h('div', null,
      h('h3', { class: 'card-title' }, 'Public attention: Wikipedia pageviews'),
      h('p', { class: 'card-sub' }, `zh and en articles, last ${r} days. A proxy for curiosity, separate from conversation volume. No dedicated articles exist for the enhanced types.`))),
    h('div', { class: 'attn' }, keys.map(k => {
      const a = D.attention[k];
      const cur = sum(a.slice(N - r)), pri = sum(a.slice(Math.max(0, N - 2 * r), N - r));
      return kpiTile({ label: VAC[k].label, value: compact(cur), delta: deltaPct(cur, pri),
        trend: weekly((x, y) => sum(a.slice(x, y))), sub: 'Pageviews' });
    })));
}

function renderSocial(root) {
  const keys = selKeys();
  const spikes = D.spikes.filter(s => state.vac.has(s.vaccine) && inRange(s.date));
  const rebuttals = D.policy.filter(p => ['Clarification', 'Rumour rebuttal'].includes(p.type) && inRange(p.date) && p.vaccines.some(v => state.vac.has(v)));
  const mis = D.misinfo.filter(x => state.vac.has(x.vaccine));
  const voices = D.voices.filter(v => state.vac.has(v.vaccine) && (state.channel === 'all' || v.channel === state.channel));
  const LEVEL = { monitor: ['good', 'Monitor'], watch: ['warning', 'Watch'], respond: ['serious', 'Respond'] };
  root.replaceChildren(
    viewHead('Social listening', 'Aggregated public conversation on PTT, Threads and comments on public Facebook pages, plus news coverage. Posts are paraphrased and no usernames are stored.'),
    filterRow({ channel: true }),
    channelCard(),
    attentionRow() || '',
    narrativesCard(),
    h('div', { class: 'grid-2' },
      h('section', { class: 'card' },
        h('h3', { class: 'card-title' }, 'Spike alerts'),
        h('p', { class: 'card-sub', style: 'margin-bottom:12px' }, 'Days when a vaccine’s mentions ran well above their trailing 28-day average.'),
        spikes.length ? h('ul', { class: 'feed' }, spikes.map(s => h('li', null,
          h('div', { class: 'meta-row' }, h('strong', { style: 'color:var(--text-1)' }, `${s.mult}× baseline`), h('span', null, `+${s.z}σ · ${fmtDate(asDate(s.date))}`)),
          h('div', null, vacChip(s.vaccine), ` ${fmt(s.count)} mentions that day`))))
          : emptyState('No spikes in this range.', keys.length < VAC_KEYS.length ? 'Include more vaccines or widen the range.' : 'Widen the range.')),
      h('section', { class: 'card' },
        h('h3', { class: 'card-title' }, 'Misinformation watch'),
        h('p', { class: 'card-sub', style: 'margin-bottom:12px' }, 'Recurring false or misleading claims with a suggested response level, plus official rebuttals.'),
        mis.length || rebuttals.length ? h('ul', { class: 'feed' },
          mis.map(x => h('li', null,
            h('strong', null, x.claim),
            h('div', { class: 'meta-row' }, vacChip(x.vaccine), x.mentions != null ? h('span', null, `${x.mentions} mentions in 7 days`) : null, x.trend ? h('span', null, x.trend) : null,
              h('span', { class: 'status' }, statusIcon((LEVEL[x.level] || LEVEL.monitor)[0]), (LEVEL[x.level] || LEVEL.monitor)[1])),
            x.note ? h('div', { class: 'muted small' }, x.note) : null)),
          rebuttals.map(p => h('li', null,
            h('div', { class: 'meta-row' }, typeBadge('policy', `${sourceName(p.source)} rebuttal`), p.vaccines.map(vacChip), h('span', null, fmtDate(asDate(p.date)))),
            extLink(p.url, policyTitle(p)))))
          : emptyState('No claims or rebuttals for these vaccines in this range.'))),
    h('section', { class: 'card' },
      h('h3', { class: 'card-title' }, 'What people are saying'),
      h('p', { class: 'card-sub', style: 'margin-bottom:12px' }, 'Representative posts, paraphrased by the AI tagger. Links open the public post.'),
      voices.length ? h('div', { class: 'voices' }, voices.map(v => h('article', { class: 'voice' },
        h('div', { class: 'meta-row' }, h('strong', { style: 'color:var(--text-1)' }, v.channel), vacChip(v.vaccine), stanceChip(v.stance)),
        h('p', null, v.text),
        v.url ? h('p', { class: 'small' }, extLink(v.url, 'View post')) : null)))
        : emptyState('Paraphrased examples appear after the AI tagger runs.')));
}

function renderMethod() {
  $('#sources-table').replaceChildren(dataTable(['Source', 'Type', 'What is collected', 'Method', 'Status'],
    D.sources.map(s => [s.name, s.type, s.what, s.how, statusLabel(s)])));
}

function renderLens(root) {
  if (!LENS) {
    root.replaceChildren(viewHead('Analyst lens', 'This page fills in after the AI analyst has run.'));
    return;
  }
  const pts = LENS.stakeholders || [];
  const legend = h('div', { class: 'legend' }, Object.entries(STAKE_TYPES).map(([k, label]) => {
    const s = sv('svg', { width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': 'true', class: 'chart' }, shapeMark(k, 7, 7.5));
    return h('span', { class: 'legend-item' }, s, label);
  }));
  const ptKey = h('ol', { class: 'pt-key', hidden: true, 'aria-label': 'Stakeholder key' },
    pts.map((p, i) => h('li', null, h('b', null, String(i + 1)), p.label)));
  const RISK = { low: ['good', 'Low'], medium: ['warning', 'Medium'], high: ['serious', 'High'] };
  root.replaceChildren(
    h('div', { class: 'lens-banner', role: 'note' },
      h('span', null, h('strong', null, 'Independent analysis'), ' by Hao-Kai Tseng · not affiliated with or endorsed by Sanofi · strategy notes for public-affairs planning, not promotional messaging.'),
      h('a', { href: '../' }, '← Public dashboard')),
    viewHead(LENS.title || 'Analyst lens: Sanofi vaccines in Taiwan', `What this week’s policy and social signals could mean for three products, and the public-affairs moves they suggest. Strategy notes, not promotional messaging. Generated ${LENS.date || ''}.`),
    h('div', { class: 'grid-3' }, (LENS.products || []).map(p => h('section', { class: 'card product' },
      h('div', { class: 'product-head' },
        h('div', null, h('h3', { class: 'card-title' }, p.name), h('p', { class: 'card-sub' }, p.sub)),
        h('span', { class: 'status' }, statusIcon((RISK[p.risk] || RISK.medium)[0]), `Risk: ${(RISK[p.risk] || RISK.medium)[1]}`)),
      h('div', { style: 'margin-top:8px' }, vacChip(p.vaccine)),
      h('dl', null,
        h('div', null, h('dt', null, 'Signal this week'), h('dd', null, p.signal)),
        h('div', null, h('dt', null, 'Implication'), h('dd', null, p.implication)),
        h('div', null, h('dt', null, 'Suggested PA action'), h('dd', null, p.action)),
        h('div', null, h('dt', null, 'Stakeholders to engage'), h('dd', null, h('span', { class: 'who' }, (p.who || []).map(w => h('span', { class: 'pill' }, w)))))),
      p.sources && p.sources.length ? h('p', { class: 'basis' }, 'Based on: ', p.sources.map((s, i) => [i ? ' · ' : '', extLink(s.url, s.label)])) : null))),
    h('div', { class: 'grid-lens' },
      pts.length ? chartCard({
        title: 'Stakeholder map',
        subtitle: 'Stance and influence in the last 30 days, from AI-tagged speakers (influence = share of mentions and engagement).',
        legend,
        draw: host => stakeholderMap(host, pts, ptKey),
        table: () => dataTable(['#', 'Stakeholder', 'Type', 'Stance', 'Influence', 'Mentions'],
          pts.map((p, i) => [String(i + 1), p.label, STAKE_TYPES[p.type], `${p.stance > 0 ? '+' : ''}${p.stance.toFixed(2)}`, String(p.influence), fmt(p.mentions || 0)]), [3, 4, 5]),
        after: ptKey,
      }) : h('section', { class: 'card' }, emptyState('Stakeholder map needs more AI-tagged mentions.')),
      h('div', { class: 'stack' },
        h('section', { class: 'card' },
          h('h3', { class: 'card-title' }, 'Issues to prepare for'),
          h('p', { class: 'card-sub', style: 'margin-bottom:12px' }, 'Next 30 days.'),
          (LENS.issues || []).length ? h('ul', { class: 'feed' }, LENS.issues.map(x => h('li', null,
            h('div', { class: 'meta-row' }, h('strong', { style: 'color:var(--text-1)' }, x.when), h('span', null, `Likelihood ${x.likelihood} · Impact ${x.impact}`)),
            h('strong', null, x.title),
            h('div', { class: 'muted small' }, x.note)))) : emptyState('Nothing flagged.')),
        h('section', { class: 'card' },
          h('h3', { class: 'card-title' }, 'Compliance guardrails'),
          h('p', { class: 'small muted', style: 'margin-top:6px' }, 'Strategy notes only. No product claims, comparative-efficacy statements or messages for the public. Advertising prescription medicines to the public is restricted in Taiwan, and any external use of this analysis would need medical, legal and regulatory review.')))));
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
   Shell: header, status strip, tabs, theme, resize
   ========================================================= */
function renderShell() {
  const gen = new Date(D.generated_at);
  const when = gen.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Taipei' });
  const anyFailed = D.sources.some(s => s.status === 'failed' || s.status === 'stale');
  $('#updated').replaceChildren(statusIcon(anyFailed ? 'warning' : 'good'),
    h('span', null, 'Updated ', h('time', { datetime: D.generated_at }, when), ' Taipei', h('span', { class: 'hide-sm' }, ' · runs daily at 05:17')));
  const strip = $('#status-strip');
  if (strip) {
    strip.replaceChildren(h('span', { class: 'strip-label' }, 'Sources'),
      ...D.sources.map(s => h('span', { class: 'src-chip', role: 'listitem',
        title: `${s.name}: ${SOURCE_STATUS[s.status][1]}${s.last_success ? ` · last success ${s.last_success.replace('T', ' ').slice(0, 16)}` : ''}${s.error ? ` · ${s.error}` : ''}` },
        statusIcon(SOURCE_STATUS[s.status][0]), s.name,
        s.status === 'ok' ? null : h('span', { class: 'src-stale' }, SOURCE_STATUS[s.status][1].toLowerCase()))));
  }
  const meta = $('#footer-meta');
  if (meta) meta.textContent = `Data as of ${D.as_of} · ${fmt(D.counts.items)} items in the last ${N} days · ${fmt(D.counts.tagged)} AI-tagged`;
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
let theme = 'auto';
try { theme = localStorage.getItem('radar-theme') || 'auto'; } catch (e) { /* storage unavailable */ }
function applyTheme() {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  const b = $('#theme-btn');
  if (!b) return;
  b.textContent = `Theme: ${theme[0].toUpperCase()}${theme.slice(1)}`;
  b.setAttribute('aria-label', `Colour theme: ${theme}. Select to change.`);
}

async function boot() {
  applyTheme();
  const btn = $('#theme-btn');
  if (btn) btn.addEventListener('click', () => {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    try { localStorage.setItem('radar-theme', theme); } catch (e) { /* storage unavailable */ }
    applyTheme();
  });
  const isLens = document.body.dataset.page === 'lens';
  const base = isLens ? '../' : '';
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
