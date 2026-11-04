(() => {
'use strict';

/* ---------- Konstanter ---------- */
const CFG = window.JB_CONFIG || {};
const REMOTE = !!(CFG.supabaseUrl && CFG.supabaseKey);
const PEOPLE = ['nicolai', 'alex'];
const CATS = [
  { id: 'mad', label: 'Mad', icon: '🍜' },
  { id: 'transport', label: 'Transport', icon: '🚃' },
  { id: 'oplevelser', label: 'Oplevelser', icon: '⛩️' },
  { id: 'byen', label: 'Byen', icon: '🍻' },
  { id: 'shopping', label: 'Shopping', icon: '🛍️' },
  { id: 'andet', label: 'Andet', icon: '📦' },
];
const DAY_CAT = { id: 'dag', label: 'Hele dagen', icon: '📅' };
const catOf = id => CATS.find(c => c.id === id) || (id === 'dag' ? DAY_CAT : CATS[CATS.length - 1]);

const DEFAULTS = {
  version: 1,
  lockin: '2026-11-03',
  fallbackRate: 0.042,
  people: {
    nicolai: {
      name: 'Nicolai', arrival: '2026-08-25', departure: '2027-02-06', preSpent: 57698,
      budgets: [{ from: '2026-11-03', amount: 400 }],
      fixed: [
        { label: 'Husleje', amount: 34000, paid: 19800 },
        { label: 'Forsikring', amount: 2300, paid: 2300 },
        { label: 'Flybillet', amount: 4200, paid: 4200 },
      ],
    },
    alex: {
      name: 'Alex', arrival: '2026-09-17', departure: '2027-02-26', preSpent: 24700,
      budgets: [{ from: '2026-11-03', amount: 400 }],
      fixed: [
        { label: 'Husleje', amount: 34000, paid: 19800 },
        { label: 'Flybilletter', amount: 10000, paid: 10000 },
        { label: 'Forsikring', amount: 3000, paid: 3000 },
        { label: 'Vacciner', amount: 500, paid: 500 },
      ],
    },
  },
};

/* ---------- Hjælpere ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sum = (arr, f = x => x) => arr.reduce((a, x) => a + (+f(x) || 0), 0);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lsGet = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
const lsDel = k => { try { localStorage.removeItem(k); } catch { /* ignore */ } };
const clone = o => JSON.parse(JSON.stringify(o));

const nf = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 0 });
const kr = n => nf.format(Math.round(n)).replace('-', '−') + ' kr';
const krSigned = n => (Math.round(n) > 0 ? '+' : Math.round(n) < 0 ? '−' : '') + nf.format(Math.abs(Math.round(n))) + ' kr';
const yen = n => '¥' + new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 }).format(Math.round(n));
const kShort = n => {
  const a = Math.abs(n);
  if (a >= 1000) return (n < 0 ? '−' : '') + new Intl.NumberFormat('da-DK', { maximumFractionDigits: a >= 10000 ? 0 : 1 }).format(a / 1000) + 'k';
  return (n < 0 ? '−' : '') + nf.format(a);
};

const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return iso(d); };
const diffDays = (a, b) => Math.round((parseD(b) - parseD(a)) / 864e5);
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const WDAYS = ['søn', 'man', 'tir', 'ons', 'tor', 'fre', 'lør'];
const fmtDate = s => { const d = parseD(s); return `${d.getDate()}. ${MONTHS[d.getMonth()]}`; };
const fmtDay = s => {
  const T = today();
  if (s === T) return 'I dag';
  if (s === addDays(T, -1)) return 'I går';
  const d = parseD(s); return `${WDAYS[d.getDay()]} ${d.getDate()}. ${MONTHS[d.getMonth()]}`;
};
const QS = new URLSearchParams(location.search);
const today = () => (/^\d{4}-\d{2}-\d{2}$/.test(QS.get('today') || '') ? QS.get('today') : iso(new Date()));

function parseAmount(str, cur) {
  if (!str) return NaN;
  const parts = String(str).split('+').map(p => p.trim()).filter(Boolean);
  if (!parts.length) return NaN;
  let total = 0;
  for (let p of parts) {
    p = p.replace(/\s|kr|¥|yen/gi, '');
    if (cur === 'JPY') p = p.replace(/[.,]/g, '');
    else {
      if (p.includes(',')) p = p.replace(/\./g, '').replace(',', '.');
      else if ((p.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(p)) p = p.replace(/\./g, '');
    }
    const v = Number(p);
    if (!isFinite(v)) return NaN;
    total += v;
  }
  return total;
}

/* ---------- State ---------- */
const state = {
  session: lsGet('jb_session'),       // {me, pin}
  view: lsGet('jb_view') || null,     // 'nicolai' | 'alex' | 'both'
  entries: [],
  settings: clone(DEFAULTS),
  rate: lsGet('jb_rate'),
  loaded: false,
  histLimit: 25,
  chartRange: lsGet('jb_range') || 14,
  lastCur: lsGet('jb_cur') || 'JPY',
  selDay: null,                       // valgt dag i dagsvisningen (null = i dag)
};
const cache = lsGet('jb_cache');
if (cache && cache.settings) { state.settings = mergeSettings(cache.settings).settings; state.entries = (cache.entries || []).map(norm); }
applyTheme(lsGet('jb_theme') || 'auto');
document.head.insertAdjacentHTML('beforeend', `<style>
  .daynav { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
  .daynav .icon-btn { width: 38px; height: 38px; flex: none; }
  .daynav .icon-btn:disabled { opacity: .3; }
  .daynav-label { flex: 1; text-align: center; line-height: 1.2; }
  .daynav-label b { display: block; font-size: 15px; }
  .daynav-label span { font-size: 12px; color: var(--muted); }
  .day-ents { margin-top: 8px; }
  .day-ents .entry:first-child { border-top: 1px solid var(--border); }
</style>`);

function norm(e) {
  return { ...e, amount_dkk: +e.amount_dkk, amount_orig: +e.amount_orig, rate: e.rate == null ? null : +e.rate, day: String(e.day).slice(0, 10) };
}
function mergeSettings(s) {
  const d = clone(DEFAULTS);
  if (!s || !s.people) return { settings: d, fresh: true };
  const out = { ...d, ...s, people: {} };
  for (const p of PEOPLE) out.people[p] = { ...d.people[p], ...(s.people[p] || {}) };
  return { settings: out, fresh: false };
}
const rate = () => (state.rate && state.rate.value > 0 ? state.rate.value : +state.settings.fallbackRate || 0.042);

/* ---------- Backend ---------- */
const Local = {
  db() { return lsGet('jb_local_db') || { entries: [], settings: null }; },
  put(db) { lsSet('jb_local_db', db); },
  async load() { return this.db(); },
  async add(e) {
    const db = this.db();
    const r = { ...e, id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())), created_at: new Date().toISOString() };
    db.entries.push(r); this.put(db); return r;
  },
  async update(e) { const db = this.db(); db.entries = db.entries.map(x => x.id === e.id ? { ...x, ...e } : x); this.put(db); return e; },
  async del(id) { const db = this.db(); db.entries = db.entries.filter(x => x.id !== id); this.put(db); },
  async saveSettings(s) { const db = this.db(); db.settings = s; this.put(db); return s; },
};
const Remote = {
  async rpc(fn, args) {
    const url = CFG.supabaseUrl.replace(/\/$/, '') + '/rest/v1/rpc/' + fn;
    const headers = { 'Content-Type': 'application/json', apikey: CFG.supabaseKey };
    if (!CFG.supabaseKey.startsWith('sb_')) headers.Authorization = 'Bearer ' + CFG.supabaseKey;
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ p_pin: state.session && state.session.pin, ...args }) });
    const text = await r.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!r.ok) { const err = new Error((data && data.message) || r.statusText || 'Fejl'); err.code = data && data.code; throw err; }
    return data;
  },
  load() { return this.rpc('jb_load', {}); },
  add(e) {
    return this.rpc('jb_add', { p_person: e.person, p_day: e.day, p_amount_dkk: e.amount_dkk, p_amount_orig: e.amount_orig, p_currency: e.currency, p_rate: e.rate, p_category: e.category, p_note: e.note });
  },
  update(e) {
    return this.rpc('jb_update', { p_id: e.id, p_day: e.day, p_amount_dkk: e.amount_dkk, p_amount_orig: e.amount_orig, p_currency: e.currency, p_rate: e.rate, p_category: e.category, p_note: e.note });
  },
  del(id) { return this.rpc('jb_delete', { p_id: id }); },
  saveSettings(s) { return this.rpc('jb_save_settings', { p_data: s }); },
};
const db = REMOTE ? Remote : Local;
const isAuthErr = e => e && (e.code === '28000' || /Forkert kode/i.test(e.message || ''));

function setSync(s) { const el = $('#sync'); if (el) el.className = 'sync ' + s; state.syncState = s; }

async function sync(quiet) {
  if (!state.session) return;
  setSync('busy');
  try {
    const data = await db.load();
    const { settings, fresh } = mergeSettings(data && data.settings);
    state.settings = settings;
    state.entries = ((data && data.entries) || []).map(norm);
    if (fresh) await db.saveSettings(settings);
    lsSet('jb_cache', { entries: state.entries, settings });
    state.loaded = true;
    setSync('ok');
    render();
  } catch (e) {
    setSync('err');
    if (isAuthErr(e)) { logout('Koden er forkert eller blevet ændret.'); return; }
    if (!quiet) toast('Kunne ikke synkronisere – viser gemte data');
  }
}

async function loadRate() {
  const T = today();
  if (state.rate && state.rate.fetched === T) return;
  const sources = [
    async () => { const j = await (await fetch('https://api.frankfurter.dev/v1/latest?base=JPY&symbols=DKK')).json(); return { value: j.rates.DKK, asOf: j.date, src: 'ECB via Frankfurter' }; },
    async () => { const j = await (await fetch('https://open.er-api.com/v6/latest/JPY')).json(); return { value: j.rates.DKK, asOf: (j.time_last_update_utc || '').slice(5, 16), src: 'ExchangeRate-API' }; },
  ];
  for (const s of sources) {
    try {
      const r = await s();
      if (r.value > 0) { state.rate = { ...r, fetched: T }; lsSet('jb_rate', state.rate); updateRateHints(); return; }
    } catch { /* prøv næste */ }
  }
}

/* ---------- Beregninger ---------- */
function budgetOn(P, day) {
  const bs = [...(P.budgets || [])].sort((a, b) => (a.from < b.from ? -1 : 1));
  let amt = bs.length ? +bs[0].amount : 400;
  for (const b of bs) if (b.from <= day) amt = +b.amount;
  return amt;
}
function sumBudget(P, from, to) { let s = 0; for (let d = from; d <= to; d = addDays(d, 1)) s += budgetOn(P, d); return s; }

function calc(p) {
  const S = state.settings, P = S.people[p], L = S.lockin, T = today(), last = P.departure;
  const ents = state.entries.filter(e => e.person === p);
  const byDay = {};
  for (const e of ents) byDay[e.day] = (byDay[e.day] || 0) + e.amount_dkk;
  const spentOn = d => byDay[d] || 0;

  const preDays = Math.max(1, diffDays(P.arrival, L));
  const preTotal = (+P.preSpent || 0) + sum(ents.filter(e => e.day < L), e => e.amount_dkk);
  const preAvg = preTotal / preDays;

  const postDays = diffDays(L, last) + 1;
  const started = T >= L;
  const ended = T > last;
  const elapsed = started ? Math.min(postDays, diffDays(L, T) + 1) : 0;   // inkl. i dag
  const completed = started ? Math.min(postDays, diffDays(L, T)) : 0;     // hele dage før i dag
  const postEnts = ents.filter(e => e.day >= L);
  const postSpent = sum(postEnts, e => e.amount_dkk);
  const completedSpent = sum(postEnts.filter(e => e.day < T), e => e.amount_dkk);
  const todaySpent = spentOn(T);
  const todayBudget = budgetOn(P, started ? T : L);
  const currentBudget = todayBudget;
  const budgetToDate = elapsed ? sumBudget(P, L, ended ? last : T) : 0;
  const buffer = budgetToDate - postSpent;
  const planPost = sumBudget(P, L, last);

  const fixed = (P.fixed || []).map(f => ({ label: f.label, amount: +f.amount || 0, paid: f.paid == null || f.paid === '' ? +f.amount || 0 : +f.paid }));
  const fixedTotal = sum(fixed, f => f.amount);
  const fixedUnpaid = sum(fixed, f => Math.max(0, f.amount - f.paid));

  const avgPost = completed > 0 ? completedSpent / completed : null;
  const avg = avgPost != null ? avgPost : preAvg;
  const avgBasis = avgPost != null ? 'post' : 'pre';
  const remaining = postDays - completed; // inkl. i dag

  let projBudget, projAvg;
  if (!started) {
    projBudget = preTotal + fixedTotal + planPost;
    projAvg = preTotal + fixedTotal + avg * postDays;
  } else if (ended) {
    projBudget = projAvg = preTotal + fixedTotal + postSpent;
  } else {
    const after = T < last ? sumBudget(P, addDays(T, 1), last) : 0;
    projBudget = preTotal + fixedTotal + completedSpent + Math.max(todaySpent, todayBudget) + after;
    projAvg = preTotal + fixedTotal + completedSpent + avg * remaining;
  }
  const allowance = remaining > 0 ? (planPost - completedSpent) / remaining : 0;

  let daysUnder = 0, streak = 0, streakOpen = true;
  for (let i = completed - 1; i >= 0; i--) {
    const d = addDays(L, i);
    const ok = spentOn(d) <= budgetOn(P, d);
    if (ok) daysUnder++;
    if (streakOpen) { if (ok) streak++; else streakOpen = false; }
  }

  const cats = {};
  for (const e of postEnts) cats[e.category || 'andet'] = (cats[e.category || 'andet'] || 0) + e.amount_dkk;

  // Kumulative serier: position k = slut på dag k (k=0 er start)
  const budgetCum = [0], actualCum = [0];
  for (let k = 1; k <= postDays; k++) {
    const d = addDays(L, k - 1);
    budgetCum.push(budgetCum[k - 1] + budgetOn(P, d));
    if (k <= elapsed) actualCum.push(actualCum[k - 1] + spentOn(d));
  }
  const projCum = [];
  for (let k = completed; k <= postDays; k++) projCum.push([k, (actualCum[completed] || 0) + avg * (k - completed)]);

  return {
    P, L, T, last, byDay, spentOn, preDays, preTotal, preAvg, postDays, started, ended, elapsed, completed,
    postSpent, completedSpent, todaySpent, todayBudget, currentBudget, budgetToDate, buffer, planPost,
    fixed, fixedTotal, fixedUnpaid, avgPost, avg, avgBasis, remaining, projBudget, projAvg, allowance,
    daysUnder, streak, cats, budgetCum, actualCum, projCum, ents,
    daysToGo: diffDays(T, last),
  };
}

/* ---------- Render ---------- */
const root = $('#root');
const ICON = {
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
};

function render() {
  if (!state.session) return renderLogin();
  if (!state.view) state.view = state.session.me;
  const v = state.view;
  const S = state.settings;
  root.innerHTML = `
    <div class="app">
      <header class="top">
        <div class="logo"><span class="sun"></span><div>Japan Budget<small>予算 · ${esc(S.people.nicolai.name)} & ${esc(S.people.alex.name)}</small></div></div>
        <div class="spacer"></div>
        <button class="add-top" data-act="add">${ICON.plus}Tilføj udgift</button>
        <span id="sync" class="sync ${state.syncState || ''}" title="Synkronisering"></span>
        <button class="icon-btn" data-act="refresh" aria-label="Opdater">${ICON.refresh}</button>
        <button class="icon-btn" data-act="settings" aria-label="Indstillinger">${ICON.gear}</button>
      </header>
      ${REMOTE ? '' : '<div class="banner">Lokal test-tilstand: data gemmes kun i denne browser. Tilføj Supabase i <code>config.js</code> for at synkronisere.</div>'}
      <nav class="tabs" role="tablist">
        ${PEOPLE.map(p => `<button role="tab" aria-selected="${v === p}" data-view="${p}"><span class="dot ${p}"></span>${esc(S.people[p].name)}</button>`).join('')}
        <button role="tab" aria-selected="${v === 'both'}" data-view="both">Begge</button>
      </nav>
      <main id="view">${v === 'both' ? bothView() : personView(v)}</main>
    </div>
    <button class="fab" data-act="add">${ICON.plus}Tilføj udgift</button>`;
  drawCharts();
}

function timelineHtml(c) {
  const parts = [];
  if (!c.started) parts.push(`<span>Lock-in starter <b>${diffDays(c.T, c.L) === 1 ? 'i morgen' : fmtDate(c.L)}</b></span>`);
  else if (!c.ended) parts.push(`<span>Lock-in dag <b>${c.elapsed}</b> af ${c.postDays}</span>`);
  else parts.push('<span><b>Hjemme igen</b></span>');
  if (!c.ended) parts.push(`<span><b>${c.daysToGo}</b> dage til hjemrejse (${fmtDate(c.last)})</span>`);
  return `<div class="timeline">${parts.join('')}</div>`;
}

function statusChip(ok, text) {
  return `<span class="chip ${ok == null ? 'neutral' : ok ? 'good' : 'bad'}"><span class="ic">${ok == null ? '–' : ok ? '✓' : '!'}</span>${text}</span>`;
}

/* ---------- Dagsvisning (bladre mellem dage) ---------- */
function dayBounds(ents) {
  const T = today(), L = state.settings.lockin;
  let min = L;
  for (const e of ents) if (e.day < min) min = e.day;
  return { min: min > T ? T : min, max: T };
}
function selectedDay(ents) {
  const { min, max } = dayBounds(ents);
  const d = state.selDay || max;
  return d < min ? min : d > max ? max : d;
}
function dayTitle(d) {
  const T = today();
  if (d === T) return 'I dag';
  if (d === addDays(T, -1)) return 'I går';
  if (d === addDays(T, -2)) return 'I forgårs';
  return ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'][parseD(d).getDay()];
}
function dayNav(D, ents) {
  const { min, max } = dayBounds(ents);
  const L = state.settings.lockin;
  return `<div class="daynav">
    <button class="icon-btn" data-day="-1" ${D <= min ? 'disabled' : ''} aria-label="Forrige dag">${ICON.left}</button>
    <div class="daynav-label"><b>${dayTitle(D)}</b><span>${WDAYS[parseD(D).getDay()]} ${fmtDate(D)}${D < L ? ' · pre lock-in' : ''}</span></div>
    <button class="icon-btn" data-day="1" ${D >= max ? 'disabled' : ''} aria-label="Næste dag">${ICON.right}</button>
  </div>`;
}
function dayCard(c, p) {
  const color = `var(--${p})`;
  const D = selectedDay(c.ents);
  const isToday = D === c.T, isPost = D >= c.L;
  const spent = c.spentOn(D), budget = budgetOn(c.P, isPost ? D : c.L);
  const left = budget - spent, over = left < 0;
  const pct = budget ? clamp(spent / budget * 100, 0, 100) : 0;
  const dayEnts = c.ents.filter(e => e.day === D).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  let foot;
  if (over) foot = `<b class="neg">${kr(-left)}</b> over ${isToday ? 'dagens ' : ''}budget`;
  else if (isToday) foot = `<b>${kr(left)}</b> tilbage <span class="muted">≈ ${yen(left / rate())}</span>`;
  else foot = `<b class="pos">${kr(left)}</b> under budget`;
  return `<section class="card daycard o1" data-swipe="day">
      ${dayNav(D, c.ents)}
      <div class="hero-num">${kr(spent)} <span class="of">/ ${kr(budget)}</span></div>
      <div class="bar ${over ? 'over' : ''}"><span style="width:${pct}%;background:${color}"></span></div>
      <div class="hero-foot">
        <div class="sub">${foot}</div>
        ${isPost ? statusChip(!over, over ? 'Over budget' : 'På budget') : statusChip(null, 'Tæller som pre')}
      </div>
      <div class="day-ents">${dayEnts.length ? dayEnts.map(e => entryHtml(e, false)).join('') : `<div class="sub muted" style="padding:10px 2px 0">Ingen udgifter ${isToday ? 'endnu i dag' : 'denne dag'}</div>`}</div>
      ${isToday ? '' : '<button class="link-btn" data-day="today" style="margin-top:6px">Gå til i dag →</button>'}
    </section>`;
}

function personView(p) {
  const c = calc(p);
  const color = `var(--${p})`;
  const diffPct = c.avgPost != null && c.preAvg ? (c.avgPost / c.preAvg - 1) * 100 : null;

  return `
    ${timelineHtml(c)}
    <div class="dcol dcol-a">
    ${dayCard(c, p)}

    <section class="card o2">
      <h2>Siden lock-in</h2>
      ${c.started ? `
      <div class="stats">
        <div class="stat"><div class="k">Brugt</div><div class="v">${kr(c.postSpent)}</div><div class="s">af ${kr(c.budgetToDate)} budget</div></div>
        <div class="stat"><div class="k">Buffer</div><div class="v ${c.buffer >= 0 ? 'pos' : 'neg'}">${krSigned(c.buffer)}</div><div class="s">${c.buffer >= 0 ? 'under budget' : 'over budget'}</div></div>
        <div class="stat"><div class="k">Råd til pr. dag</div><div class="v">${kr(c.allowance)}</div><div class="s">resten af tiden (${c.remaining} dage)</div></div>
        <div class="stat"><div class="k">Dage på budget</div><div class="v">${c.daysUnder}<span class="muted" style="font-size:15px;font-weight:500"> / ${c.completed}</span></div><div class="s">${c.streak > 1 ? `${c.streak} dage i træk` : 'hele dage'}</div></div>
      </div>` : `<div class="stats">
        <div class="stat"><div class="k">Dagligt budget</div><div class="v">${kr(c.currentBudget)}</div><div class="s">fra ${fmtDate(c.L)}</div></div>
        <div class="stat"><div class="k">Budgetramme</div><div class="v">${kr(c.planPost)}</div><div class="s">${c.postDays} dage</div></div>
      </div>`}
    </section>

    <section class="card o8 hist">
      <h2>Historik</h2>
      ${historyHtml(c.ents, false)}
    </section>
    </div>
    <div class="dcol dcol-b">
    <section class="card o4">
      <h2>Pre vs. post lock-in</h2>
      <div class="vs">
        <div class="stat"><div class="k">Pre lock-in</div><div class="v">${kr(c.preAvg)}</div><div class="s">pr. dag · ${c.preDays} dage<br>${kr(c.preTotal)} i alt</div></div>
        <div class="arrow ${diffPct == null ? '' : diffPct <= 0 ? 'pos' : 'neg'}">${diffPct == null ? '→' : (diffPct <= 0 ? '↓ ' : '↑ ') + Math.abs(Math.round(diffPct)) + '%'}</div>
        <div class="stat"><div class="k">Post lock-in</div><div class="v">${c.avgPost != null ? kr(c.avgPost) : '–'}</div><div class="s">pr. dag · ${c.completed} hele dage<br>${kr(c.postSpent)} i alt</div></div>
      </div>
    </section>

    <section class="card o5 grow">
      <h2>Forbrug vs. budget <span class="right sub">kumulativt</span></h2>
      <div class="legend">
        <span><i style="border-color:${color}"></i>Brugt</span>
        <span><i class="dash" style="border-color:${color}"></i>Prognose (snit)</span>
        <span><i class="dash" style="border-color:var(--muted)"></i>Budget</span>
      </div>
      <div class="chart" data-chart="cum" data-person="${p}"></div>
    </section>

    <section class="card o6 grow">
      <h2>Dag for dag
        <span class="right seg">${[14, 30].map(n => `<button data-range="${n}" aria-pressed="${state.chartRange === n}">${n} d</button>`).join('')}<button data-range="0" aria-pressed="${state.chartRange === 0}">Alt</button></span>
      </h2>
      ${c.started ? `<div class="legend"><span><i class="box" style="background:${color}"></i>Brugt</span><span><i class="dash" style="border-color:var(--muted)"></i>Dagligt budget</span></div>
      <div class="chart" data-chart="daily" data-person="${p}"></div>` : `<div class="empty">Starter ${fmtDate(c.L)} når lock-in begynder</div>`}
    </section>

    </div>
    <div class="dcol dcol-c">
    <section class="card o3">
      <h2>Hele turen · total</h2>
      <div class="proj">
        <div class="stat"><div class="k">Holder du budgettet</div><div class="v">${kr(c.projBudget)}</div><div class="s">${kr(c.currentBudget)}/dag resten</div></div>
        <div class="stat"><div class="k">Med nuværende snit</div><div class="v ${c.projAvg > c.projBudget + 1 ? 'neg' : 'pos'}">${kr(c.projAvg)}</div><div class="s">${kr(c.avg)}/dag ${c.avgBasis === 'post' ? '(post)' : '(pre-snit)'}</div></div>
      </div>
      <table class="breakdown">
        <tr><td>Forbrug pre lock-in</td><td>${kr(c.preTotal)}</td></tr>
        <tr><td>Faste udgifter</td><td>${kr(c.fixedTotal)}</td></tr>
        ${c.fixed.map(f => `<tr class="indent"><td>${esc(f.label)}${f.paid < f.amount ? ` <span class="muted">· mangler ${kr(f.amount - f.paid)}</span>` : ''}</td><td>${kr(f.amount)}</td></tr>`).join('')}
        <tr><td>Post lock-in (budget)</td><td>${kr(c.projBudget - c.preTotal - c.fixedTotal)}</td></tr>
        <tr class="indent"><td>Heraf brugt indtil nu</td><td>${kr(c.postSpent)}</td></tr>
        <tr class="total"><td>Total ved budget</td><td>${kr(c.projBudget)}</td></tr>
      </table>
      ${c.fixedUnpaid > 0 ? `<div class="sub" style="margin-top:10px">Faste udgifter der mangler at blive betalt: <b>${kr(c.fixedUnpaid)}</b></div>` : ''}
    </section>

    ${catsHtml(c, color)}


    </div>`;
}

function catsHtml(c, color) {
  const rows = Object.entries(c.cats).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return '';
  const max = rows[0][1] || 1;
  return `<section class="card o7"><h2>Kategorier <span class="right sub">post lock-in</span></h2><div class="cats">
    ${rows.map(([id, v]) => { const ct = catOf(id); return `<div class="cat-row"><span>${ct.icon} ${ct.label}</span><div class="track"><span style="width:${v / max * 100}%;background:${color}"></span></div><span class="amt">${kr(v)}</span></div>`; }).join('')}
  </div></section>`;
}

function entryHtml(e, showPerson) {
  const ct = catOf(e.category);
  return `
        <button class="entry" data-edit="${esc(e.id)}">
          <span class="em">${ct.icon}</span>
          <span class="tx"><b>${esc(e.note || ct.label)}</b><span>${showPerson ? `<span class="dot ${e.person}"></span> ${esc(state.settings.people[e.person].name)} · ` : ''}${ct.label}</span></span>
          <span class="am">${kr(e.amount_dkk)}${e.currency === 'JPY' ? `<small>${yen(e.amount_orig)}</small>` : ''}</span>
        </button>`;
}

function historyHtml(ents, showPerson) {
  if (!ents.length) return '<div class="empty">Ingen udgifter endnu – tryk på <b>Tilføj udgift</b></div>';
  const sorted = [...ents].sort((a, b) => (a.day === b.day ? (b.created_at || '').localeCompare(a.created_at || '') : b.day.localeCompare(a.day)));
  const shown = sorted.slice(0, state.histLimit);
  const groups = [];
  for (const e of shown) { const g = groups[groups.length - 1]; if (g && g.day === e.day) g.items.push(e); else groups.push({ day: e.day, items: [e] }); }
  const daySum = d => sum(ents.filter(e => e.day === d), e => e.amount_dkk);
  return groups.map(g => `<div class="day-group">
      <div class="day-head"><span>${fmtDay(g.day)}${g.day < state.settings.lockin ? ' · pre' : ''}</span><span>${kr(daySum(g.day))}</span></div>
      ${g.items.map(e => entryHtml(e, showPerson)).join('')}
    </div>`).join('') + (sorted.length > shown.length ? `<button class="more" data-act="more">Vis flere (${sorted.length - shown.length})</button>` : '');
}

function bothView() {
  const cs = Object.fromEntries(PEOPLE.map(p => [p, calc(p)]));
  const c0 = cs.nicolai;
  const tl = [];
  if (!c0.started) tl.push(`<span>Lock-in starter <b>${diffDays(c0.T, c0.L) === 1 ? 'i morgen' : fmtDate(c0.L)}</b></span>`);
  else tl.push(`<span>Lock-in dag <b>${c0.elapsed}</b></span>`);
  for (const p of PEOPLE) if (!cs[p].ended) tl.push(`<span><span class="dot ${p}"></span> ${esc(cs[p].P.name)} hjem om <b>${cs[p].daysToGo}</b> dage</span>`);

  const D = selectedDay(state.entries);
  const col = p => { const c = cs[p]; const isPost = D >= c.L; const sp = c.spentOn(D); const left = budgetOn(c.P, isPost ? D : c.L) - sp; return `<div class="col">
    <div class="name"><span class="dot ${p}"></span>${esc(c.P.name)}</div>
    <div class="big">${kr(sp)}</div>
    <div class="sub" style="margin-bottom:8px">${left >= 0 ? `${kr(left)} ${D === c.T ? 'tilbage' : 'under'}` : `<span class="neg">${kr(-left)} over</span>`}</div>
    <div class="row"><span>Buffer</span><span class="${c.buffer >= 0 ? 'pos' : 'neg'}">${c.started ? krSigned(c.buffer) : '–'}</span></div>
    <div class="row"><span>Snit pre</span><span>${kr(c.preAvg)}</span></div>
    <div class="row"><span>Snit post</span><span>${c.avgPost != null ? kr(c.avgPost) : '–'}</span></div>
    <div class="row"><span>På budget</span><span>${c.daysUnder}/${c.completed}</span></div>
    <div class="row"><span>Total v. budget</span><span>${kShort(c.projBudget)}</span></div>
    <div class="row"><span>Total v. snit</span><span>${kShort(c.projAvg)}</span></div>
  </div>`; };

  const all = state.entries;
  const totB = cs.nicolai.projBudget + cs.alex.projBudget, totA = cs.nicolai.projAvg + cs.alex.projAvg;
  return `
    <div class="timeline">${tl.join('')}</div>
    <div class="dcol dcol-a">
    <section class="card daycard o1" data-swipe="day">${dayNav(D, state.entries)}<div class="duo">${PEOPLE.map(col).join('')}</div>
      ${D === c0.T ? '' : '<button class="link-btn" data-day="today" style="margin-top:8px">Gå til i dag →</button>'}</section>
    <section class="card o3">
      <h2>Jer begge · hele turen</h2>
      <div class="proj">
        <div class="stat"><div class="k">Holder I budgettet</div><div class="v">${kr(totB)}</div></div>
        <div class="stat"><div class="k">Med nuværende snit</div><div class="v">${kr(totA)}</div></div>
      </div>
      <div class="sub">Inkl. pre lock-in forbrug og faste udgifter (husleje, fly, forsikring m.m.).</div>
    </section>
    </div>
    <div class="dcol dcol-b">
    <section class="card o2 grow">
      <h2>Buffer over tid <span class="right sub">+ = under budget</span></h2>
      ${c0.started ? `<div class="legend">${PEOPLE.map(p => `<span><i style="border-color:var(--${p})"></i>${esc(cs[p].P.name)}</span>`).join('')}</div>
      <div class="chart" data-chart="buffer"></div>` : `<div class="empty">Starter ${fmtDate(c0.L)} når lock-in begynder</div>`}
    </section>
    </div>
    <div class="dcol dcol-c">
    <section class="card o4 hist"><h2>Seneste udgifter</h2>${historyHtml(all, true)}</section>
    </div>`;
}

/* ---------- Charts ---------- */
function niceScale(min, max, count = 4) {
  if (max - min < 1) max = min + 1;
  const raw = (max - min) / count, mag = 10 ** Math.floor(Math.log10(raw)), n = raw / mag;
  const step = (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks = []; for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
  return { lo, hi, ticks };
}
const NS = 'http://www.w3.org/2000/svg';

function drawCharts() {
  $$('[data-chart]').forEach(el => {
    const t = el.dataset.chart;
    if (t === 'cum') cumChart(el, calc(el.dataset.person), el.dataset.person);
    if (t === 'daily') dailyChart(el, calc(el.dataset.person), el.dataset.person);
    if (t === 'buffer') bufferChart(el);
  });
}

function monthTicks(L, n, xs) {
  const ticks = [];
  for (let k = 0; k <= n; k++) {
    const d = addDays(L, k); // start af dag k+1 = slut på dag k
    if (d.endsWith('-01')) ticks.push({ x: xs(k), label: MONTHS[parseD(d).getMonth()] });
  }
  return ticks;
}

function setupTip(el, svg, W, H, M, n, xs, onIndex) {
  const tip = document.createElement('div'); tip.className = 'tip hidden'; el.appendChild(tip);
  const guide = document.createElementNS(NS, 'line');
  guide.setAttribute('y1', M.t); guide.setAttribute('y2', H - M.b);
  guide.setAttribute('stroke', 'var(--text-2)'); guide.setAttribute('stroke-width', '1'); guide.setAttribute('opacity', '0');
  svg.appendChild(guide);
  const dots = document.createElementNS(NS, 'g'); svg.appendChild(dots);
  const move = ev => {
    const r = svg.getBoundingClientRect();
    const px = (ev.clientX - r.left) * (W / r.width);
    let best = 0, bd = Infinity;
    for (let k = 0; k <= n; k++) { const dd = Math.abs(xs(k) - px); if (dd < bd) { bd = dd; best = k; } }
    const res = onIndex(best);
    if (!res) return hide();
    const x = xs(best);
    guide.setAttribute('x1', x); guide.setAttribute('x2', x); guide.setAttribute('opacity', '.35');
    dots.innerHTML = res.points.map(pt => `<circle cx="${x}" cy="${pt.y}" r="4.5" fill="${pt.color}" stroke="var(--surface)" stroke-width="2"/>`).join('');
    tip.innerHTML = res.html; tip.classList.remove('hidden');
    const cx = x * (r.width / W), tw = tip.offsetWidth;
    tip.style.left = clamp(cx, tw / 2 + 2, r.width - tw / 2 - 2) + 'px';
    tip.style.top = (Math.min(...res.points.map(p => p.y), H) * (r.height / H)) + 'px';
  };
  const hide = () => { tip.classList.add('hidden'); guide.setAttribute('opacity', '0'); dots.innerHTML = ''; };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', ev => { if (ev.pointerType === 'mouse') hide(); });
  el._hide = hide;
}

const isDesk = () => window.matchMedia('(min-width: 1100px)').matches;
function chartH(el, def) {
  if (!isDesk()) return def;
  el.innerHTML = '';
  const h = Math.round(el.clientHeight);
  return h >= 140 ? h : def;
}
function baseSvg(el, H) {
  el.innerHTML = '';
  const W = Math.max(280, Math.round(el.clientWidth || 320));
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('height', H);
  svg.setAttribute('role', 'img');
  el.appendChild(svg);
  return { svg, W };
}

function axes(svg, W, H, M, sc, ys, xTicks) {
  let g = '';
  for (const v of sc.ticks) {
    const y = ys(v);
    g += `<line x1="${M.l}" x2="${W - M.r}" y1="${y}" y2="${y}" stroke="var(--grid)" stroke-width="1" ${v === 0 ? 'stroke="var(--text-2)" opacity=".5"' : ''}/>`;
    g += `<text x="${M.l - 6}" y="${y + 4}" text-anchor="end">${kShort(v)}</text>`;
  }
  for (const t of xTicks) g += `<text x="${t.x}" y="${H - M.b + 16}" text-anchor="middle">${t.label}</text>`;
  svg.insertAdjacentHTML('beforeend', g);
}
const pathOf = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');

function cumChart(el, c, p) {
  const H = chartH(el, 230), M = { t: 14, r: 14, b: 26, l: 42 };
  const { svg, W } = baseSvg(el, H);
  const n = c.postDays;
  const projEnd = c.projCum.length ? c.projCum[c.projCum.length - 1][1] : 0;
  const sc = niceScale(0, Math.max(c.budgetCum[n], projEnd, c.actualCum[c.actualCum.length - 1] || 0));
  const xs = k => M.l + (W - M.l - M.r) * (k / n);
  const ys = v => M.t + (H - M.t - M.b) * (1 - (v - sc.lo) / (sc.hi - sc.lo));
  axes(svg, W, H, M, sc, ys, monthTicks(c.L, n, xs));
  svg.setAttribute('aria-label', `Kumulativt forbrug for ${c.P.name} mod budget`);
  const color = `var(--${p})`;
  const budgetPts = c.budgetCum.map((v, k) => [xs(k), ys(v)]);
  const actualPts = c.actualCum.map((v, k) => [xs(k), ys(v)]);
  const projPts = c.projCum.map(([k, v]) => [xs(k), ys(v)]);
  let g = `<path d="${pathOf(budgetPts)}" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="4 4"/>`;
  if (!c.ended) g += `<path d="${pathOf(projPts)}" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="2 5" stroke-linecap="round" opacity=".85"/>`;
  if (actualPts.length > 1) {
    g += `<path d="${pathOf(actualPts)} L${actualPts[actualPts.length - 1][0]},${ys(0)} L${actualPts[0][0]},${ys(0)}Z" fill="${color}" opacity=".08"/>`;
    g += `<path d="${pathOf(actualPts)}" fill="none" stroke="${color}" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"/>`;
    const lp = actualPts[actualPts.length - 1];
    g += `<circle cx="${lp[0]}" cy="${lp[1]}" r="4" fill="${color}" stroke="var(--surface)" stroke-width="2"/>`;
  }
  // slutlabels
  const bEnd = budgetPts[n], pEnd = projPts[projPts.length - 1];
  const bBelow = pEnd && pEnd[1] < bEnd[1];
  g += `<text class="lbl" x="${bEnd[0]}" y="${bBelow ? bEnd[1] + 16 : bEnd[1] - 7}" text-anchor="end">${kShort(c.budgetCum[n])}</text>`;
  if (pEnd && !c.ended && (bBelow || Math.abs(pEnd[1] - bEnd[1]) > 14)) g += `<text class="lbl" x="${pEnd[0]}" y="${pEnd[1] - 7}" text-anchor="end">${kShort(projEnd)}</text>`;
  svg.insertAdjacentHTML('beforeend', g);

  setupTip(el, svg, W, H, M, n, xs, k => {
    const pts = [{ y: ys(c.budgetCum[k]), color: 'var(--muted)' }];
    const date = k === 0 ? `Start ${fmtDate(c.L)}` : `${fmtDate(addDays(c.L, k - 1))}`;
    let html = `<div><b>${date}</b></div><div class="row">Budget: <b>${kr(c.budgetCum[k])}</b></div>`;
    if (k < c.actualCum.length) { html += `<div class="row">Brugt: <b>${kr(c.actualCum[k])}</b></div>`; pts.push({ y: ys(c.actualCum[k]), color }); }
    else { const pr = c.projCum.find(x => x[0] === k); if (pr) { html += `<div class="row">Prognose: <b>${kr(pr[1])}</b></div>`; pts.push({ y: ys(pr[1]), color }); } }
    return { html, points: pts };
  });
}

function dailyChart(el, c, p) {
  const H = chartH(el, 200), M = { t: 14, r: 10, b: 26, l: 42 };
  const { svg, W } = baseSvg(el, H);
  const endDay = c.ended ? c.last : c.T;
  const total = diffDays(c.L, endDay) + 1;
  const range = state.chartRange || total;
  const nDays = Math.min(total, range);
  const start = addDays(endDay, -(nDays - 1));
  const days = []; for (let i = 0; i < nDays; i++) { const d = addDays(start, i); days.push({ d, v: c.spentOn(d), b: budgetOn(c.P, d) }); }
  const sc = niceScale(0, Math.max(...days.map(x => Math.max(x.v, x.b))));
  const iw = W - M.l - M.r, slot = iw / nDays;
  const xs = i => M.l + slot * (i + 0.5);
  const ys = v => M.t + (H - M.t - M.b) * (1 - (v - sc.lo) / (sc.hi - sc.lo));
  const every = nDays <= 10 ? 1 : nDays <= 16 ? 2 : nDays <= 35 ? 7 : 14;
  const xt = days.map((x, i) => ({ i, x })).filter(({ i }) => (nDays - 1 - i) % every === 0).map(({ i, x }) => ({ x: xs(i), label: String(parseD(x.d).getDate()) }));
  axes(svg, W, H, M, sc, ys, xt);
  svg.setAttribute('aria-label', `Dagligt forbrug for ${c.P.name}`);
  const color = `var(--${p})`;
  const bw = Math.max(2, Math.min(26, slot - 2));
  const r = Math.min(4, bw / 2);
  let g = '';
  const sel = selectedDay(c.ents);
  days.forEach((x, i) => {
    if (x.d === sel) g += `<rect x="${M.l + slot * i + 1}" y="${M.t}" width="${slot - 2}" height="${H - M.t - M.b}" rx="4" fill="var(--text)" opacity=".07"/>`;
    if (x.v <= 0) return;
    const x0 = xs(i) - bw / 2, y0 = ys(x.v), yb = ys(0), h = yb - y0, rr = Math.min(r, h);
    g += `<path d="M${x0},${yb} V${y0 + rr} Q${x0},${y0} ${x0 + rr},${y0} H${x0 + bw - rr} Q${x0 + bw},${y0} ${x0 + bw},${y0 + rr} V${yb} Z" fill="${color}" opacity="${x.d === c.T ? 0.6 : 1}"/>`;
  });
  // budget-trappe
  let bp = '';
  days.forEach((x, i) => { const xa = M.l + slot * i, xb = xa + slot, y = ys(x.b); bp += `${i ? 'L' : 'M'}${xa},${y} L${xb},${y} `; });
  g += `<path d="${bp}" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="4 4"/>`;
  svg.insertAdjacentHTML('beforeend', g);
  setupTip(el, svg, W, H, M, nDays - 1, xs, i => {
    const x = days[i]; if (!x) return null;
    const diff = x.b - x.v;
    return {
      html: `<div><b>${fmtDay(x.d)}</b></div><div class="row">Brugt: <b>${kr(x.v)}</b></div><div class="row">${diff >= 0 ? `${kr(diff)} under budget` : `${kr(-diff)} over budget`}</div><div class="row" style="opacity:.7">Tryk for at se dagen</div>`,
      points: [{ y: ys(x.v), color }],
    };
  });
  svg.addEventListener('click', ev => {
    const r = svg.getBoundingClientRect();
    const i = clamp(Math.floor(((ev.clientX - r.left) * (W / r.width) - M.l) / slot), 0, nDays - 1);
    if (!days[i]) return;
    state.selDay = days[i].d === c.T ? null : days[i].d;
    render();
    const card = $('.daycard'); if (card && !isDesk()) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function bufferChart(el) {
  const H = chartH(el, 210), M = { t: 14, r: 14, b: 26, l: 46 };
  const { svg, W } = baseSvg(el, H);
  const cs = PEOPLE.map(p => ({ p, c: calc(p) }));
  const series = cs.map(({ p, c }) => ({ p, c, vals: c.actualCum.map((v, k) => c.budgetCum[k] - v) }));
  const n = Math.max(1, ...series.map(s => s.vals.length - 1));
  const allV = series.flatMap(s => s.vals);
  const sc = niceScale(Math.min(0, ...allV), Math.max(0, ...allV, 100));
  const xs = k => M.l + (W - M.l - M.r) * (k / n);
  const ys = v => M.t + (H - M.t - M.b) * (1 - (v - sc.lo) / (sc.hi - sc.lo));
  const L = state.settings.lockin;
  const every = Math.max(1, Math.ceil(n / 6));
  const xt = []; for (let k = 0; k <= n; k += every) xt.push({ x: xs(k), label: k === 0 ? fmtDate(L) : String(parseD(addDays(L, k - 1)).getDate()) });
  axes(svg, W, H, M, sc, ys, xt);
  svg.setAttribute('aria-label', 'Buffer i forhold til budget for begge');
  let g = `<line x1="${M.l}" x2="${W - M.r}" y1="${ys(0)}" y2="${ys(0)}" stroke="var(--text-2)" stroke-width="1" opacity=".6"/>`;
  for (const s of series) {
    const pts = s.vals.map((v, k) => [xs(k), ys(v)]);
    g += `<path d="${pathOf(pts)}" fill="none" stroke="var(--${s.p})" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"/>`;
    const lp = pts[pts.length - 1];
    g += `<circle cx="${lp[0]}" cy="${lp[1]}" r="4" fill="var(--${s.p})" stroke="var(--surface)" stroke-width="2"/>`;
  }
  svg.insertAdjacentHTML('beforeend', g);
  setupTip(el, svg, W, H, M, n, xs, k => {
    const date = k === 0 ? `Start ${fmtDate(L)}` : fmtDay(addDays(L, k - 1));
    let html = `<div><b>${date}</b></div>`; const points = [];
    for (const s of series) if (k < s.vals.length) {
      html += `<div class="row"><span class="dot ${s.p}"></span>${esc(s.c.P.name)}: <b>${krSigned(s.vals[k])}</b></div>`;
      points.push({ y: ys(s.vals[k]), color: `var(--${s.p})` });
    }
    return points.length ? { html, points } : null;
  });
}

/* ---------- Sheets ---------- */
function openSheet(html, onMount) {
  closeSheet(true);
  const bd = document.createElement('div'); bd.className = 'backdrop'; bd.id = 'backdrop';
  const sh = document.createElement('div'); sh.className = 'sheet'; sh.id = 'sheet'; sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true');
  sh.innerHTML = `<div class="grab"></div>${html}`;
  document.body.append(bd, sh);
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => { bd.classList.add('show'); sh.classList.add('show'); });
  bd.addEventListener('click', () => closeSheet());
  $$('[data-close]', sh).forEach(b => b.addEventListener('click', () => closeSheet()));
  if (onMount) onMount(sh);
}
function closeSheet(instant) {
  const bd = $('#backdrop'), sh = $('#sheet');
  document.body.style.overflow = '';
  if (!sh) return;
  if (instant) { bd && bd.remove(); sh.remove(); return; }
  bd.classList.remove('show'); sh.classList.remove('show');
  setTimeout(() => { bd.remove(); sh.remove(); }, 280);
}

function entrySheet(existing) {
  const S = state.settings;
  const e = existing || {};
  const person = e.person || (state.view !== 'both' ? state.view : state.session.me);
  let cur = e.currency || state.lastCur;
  let mode = e.category === 'dag' ? 'day' : 'item';
  let cat = e.category && e.category !== 'dag' ? e.category : 'mad';
  let who = person;
  const amountStr = e.amount_orig != null ? (e.currency === 'JPY' ? String(Math.round(e.amount_orig)) : String(e.amount_orig).replace('.', ',')) : '';
  const minDay = S.people.nicolai.arrival < S.people.alex.arrival ? S.people.nicolai.arrival : S.people.alex.arrival;

  openSheet(`
    <h3>${existing ? 'Rediger udgift' : 'Ny udgift'}<button class="icon-btn x" data-close aria-label="Luk">${ICON.x}</button></h3>
    <div class="field"><span class="lab">Hvem</span><div class="pills" id="f-who">
      ${PEOPLE.map(p => `<button class="pill" data-who="${p}" aria-pressed="${who === p}" ${existing ? 'disabled' : ''}><span class="dot ${p}"></span>${esc(S.people[p].name)}</button>`).join('')}
    </div></div>
    <div class="field"><span class="lab">Type</span><div class="pills" id="f-mode">
      <button class="pill" data-mode="item" aria-pressed="${mode === 'item'}">Enkelt køb</button>
      <button class="pill" data-mode="day" aria-pressed="${mode === 'day'}">📅 Hele dagen</button>
    </div></div>
    <div class="field"><label for="f-amt">Beløb</label>
      <div class="amount-wrap">
        <input id="f-amt" class="input" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(amountStr)}">
        <div class="cur" id="f-cur"><button data-cur="JPY" aria-pressed="${cur === 'JPY'}">¥</button><button data-cur="DKK" aria-pressed="${cur === 'DKK'}">kr</button></div>
      </div>
      <div class="hint" id="f-hint"></div>
    </div>
    <div class="field" id="f-cat-wrap"><span class="lab">Kategori</span><div class="pills" id="f-cat">
      ${CATS.map(ct => `<button class="pill" data-cat="${ct.id}" aria-pressed="${cat === ct.id}">${ct.icon} ${ct.label}</button>`).join('')}
    </div></div>
    <div class="row2">
      <div class="field"><label for="f-note">Note</label><input id="f-note" class="input" placeholder="fx Ramen" value="${esc(e.note || '')}" maxlength="80"></div>
      <div class="field"><label for="f-day">Dato</label><input id="f-day" class="input" type="date" value="${e.day || state.selDay || today()}" min="${minDay}" max="${addDays(today(), 1)}"></div>
    </div>
    <div class="btns">
      <button class="btn" id="f-save">${existing ? 'Gem ændringer' : 'Tilføj'}</button>
      ${existing ? '<button class="btn danger" id="f-del">Slet udgift</button>' : ''}
    </div>`, sh => {
    const amt = $('#f-amt', sh), hint = $('#f-hint', sh);
    const upd = () => {
      $('#f-cat-wrap', sh).classList.toggle('hidden', mode === 'day');
      $$('[data-mode]', sh).forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === mode));
      $$('[data-cur]', sh).forEach(b => b.setAttribute('aria-pressed', b.dataset.cur === cur));
      $$('[data-cat]', sh).forEach(b => b.setAttribute('aria-pressed', b.dataset.cat === cat));
      $$('[data-who]', sh).forEach(b => b.setAttribute('aria-pressed', b.dataset.who === who));
      const v = parseAmount(amt.value, cur);
      const r = existing && existing.currency === 'JPY' && cur === 'JPY' && existing.rate ? existing.rate : rate();
      if (!amt.value) hint.textContent = cur === 'JPY' ? `Kurs: 1 kr = ${yen(1 / r)} · tip: skriv 1200+850 for flere ting` : 'Tip: skriv 45+120 for at lægge flere ting sammen';
      else if (isNaN(v)) hint.textContent = 'Ugyldigt beløb';
      else hint.textContent = cur === 'JPY' ? `= ${kr(v * r)}` : `= ${yen(v / r)}`;
      hint.dataset.rate = r;
    };
    sh.addEventListener('click', ev => {
      const b = ev.target.closest('button'); if (!b) return;
      if (b.dataset.mode) { mode = b.dataset.mode; upd(); }
      if (b.dataset.cur) { cur = b.dataset.cur; upd(); amt.focus(); }
      if (b.dataset.cat) { cat = b.dataset.cat; upd(); }
      if (b.dataset.who && !existing) { who = b.dataset.who; upd(); }
    });
    amt.addEventListener('input', upd);
    upd();
    if (!existing) setTimeout(() => amt.focus(), 300);
    amt.addEventListener('keydown', ev => { if (ev.key === 'Enter') $('#f-save', sh).click(); });

    $('#f-save', sh).addEventListener('click', async ev => {
      const v = parseAmount(amt.value, cur);
      if (!(v > 0)) { amt.focus(); hint.textContent = 'Indtast et beløb'; return; }
      const r = +hint.dataset.rate || rate();
      const rec = {
        ...(existing || {}),
        person: who,
        day: $('#f-day', sh).value || today(),
        amount_orig: Math.round(v * 100) / 100,
        currency: cur,
        rate: r,
        amount_dkk: Math.round((cur === 'JPY' ? v * r : v) * 100) / 100,
        category: mode === 'day' ? 'dag' : cat,
        note: $('#f-note', sh).value.trim() || null,
      };
      ev.target.disabled = true;
      state.lastCur = cur; lsSet('jb_cur', cur);
      try {
        if (existing) await db.update(rec); else await db.add(rec);
        closeSheet();
        toast(existing ? 'Gemt' : `${kr(rec.amount_dkk)} tilføjet til ${S.people[who].name}`);
        await sync(true);
      } catch (err) {
        ev.target.disabled = false;
        if (isAuthErr(err)) return logout('Koden er forkert.');
        toast('Kunne ikke gemme – tjek forbindelsen');
      }
    });
    const del = $('#f-del', sh);
    if (del) del.addEventListener('click', async () => {
      if (del.dataset.confirm !== '1') { del.dataset.confirm = '1'; del.textContent = 'Tryk igen for at slette'; return; }
      try { await db.del(existing.id); closeSheet(); toast('Slettet'); await sync(true); } catch { toast('Kunne ikke slette'); }
    });
  });
}

function settingsSheet() {
  const S = clone(state.settings);
  const T = today();
  const eff = T < S.lockin ? S.lockin : T;
  const theme = lsGet('jb_theme') || 'auto';
  const personBlock = p => {
    const P = S.people[p];
    const curB = budgetOn(P, eff);
    const hist = [...P.budgets].sort((a, b) => (a.from < b.from ? -1 : 1)).map(b => `${kr(b.amount)} fra ${fmtDate(b.from)}`).join(' · ');
    return `<div class="set-person" data-p="${p}">
      <h4><span class="dot ${p}"></span>${esc(P.name)}</h4>
      <div class="field"><label>Dagligt budget (kr) – gælder fra ${eff === T ? 'i dag' : fmtDate(eff)}</label><input class="input" data-k="budget" inputmode="numeric" value="${curB}"><div class="budget-hist">${hist}</div></div>
      <div class="row2">
        <div class="field"><label>Ankomst</label><input class="input" type="date" data-k="arrival" value="${P.arrival}"></div>
        <div class="field"><label>Hjemrejse</label><input class="input" type="date" data-k="departure" value="${P.departure}"></div>
      </div>
      <div class="field"><label>Dagligt forbrug før lock-in (kr)</label><input class="input" data-k="preSpent" inputmode="numeric" value="${P.preSpent}"></div>
      <span class="lab">Faste udgifter (ikke i dagligt snit)</span>
      <div class="fixed-head"><span>Post</span><span>Total kr</span><span>Betalt kr</span><span></span></div>
      <div class="fixed-list">${P.fixed.map(f => fixedRow(f)).join('')}</div>
      <button class="link-btn" data-addfixed>+ Tilføj fast udgift</button>
    </div>`;
  };
  openSheet(`
    <h3>Indstillinger<button class="icon-btn x" data-close aria-label="Luk">${ICON.x}</button></h3>
    ${PEOPLE.map(personBlock).join('')}
    <div class="set-person">
      <h4>Generelt</h4>
      <div class="row2">
        <div class="field"><label>Lock-in start</label><input class="input" type="date" id="s-lockin" value="${S.lockin}"></div>
        <div class="field"><label>Reservekurs (kr pr. ¥)</label><input class="input" id="s-rate" inputmode="decimal" value="${String(S.fallbackRate).replace('.', ',')}"></div>
      </div>
      <div class="sub" style="margin:-4px 0 12px">Live kurs: ${state.rate && state.rate.value ? `1 kr = ${yen(1 / state.rate.value)} (${esc(state.rate.src)}, ${esc(state.rate.asOf || '')})` : 'ikke hentet – bruger reservekurs'}</div>
      <div class="field"><span class="lab">Jeg er</span><div class="pills">${PEOPLE.map(p => `<button class="pill" data-me="${p}" aria-pressed="${state.session.me === p}"><span class="dot ${p}"></span>${esc(S.people[p].name)}</button>`).join('')}</div></div>
      <div class="field"><span class="lab">Tema</span><div class="pills">${[['auto', 'Auto'], ['light', 'Lys'], ['dark', 'Mørk']].map(([k, l]) => `<button class="pill" data-theme="${k}" aria-pressed="${theme === k}">${l}</button>`).join('')}</div></div>
    </div>
    <div class="btns">
      <button class="btn" id="s-save">Gem indstillinger</button>
      <button class="btn ghost" id="s-csv">Eksportér CSV</button>
      <button class="btn danger" id="s-logout">Log ud</button>
    </div>`, sh => {
    sh.addEventListener('click', ev => {
      const b = ev.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-addfixed')) b.previousElementSibling.insertAdjacentHTML('beforeend', fixedRow({ label: '', amount: '', paid: '' }));
      if (b.classList.contains('rm')) b.closest('.fixed-row').remove();
      if (b.dataset.me) { state.session.me = b.dataset.me; lsSet('jb_session', state.session); $$('[data-me]', sh).forEach(x => x.setAttribute('aria-pressed', x === b)); }
      if (b.dataset.theme) { applyTheme(b.dataset.theme); lsSet('jb_theme', b.dataset.theme); $$('[data-theme]', sh).forEach(x => x.setAttribute('aria-pressed', x === b)); drawCharts(); }
    });
    $('#s-logout', sh).addEventListener('click', () => { closeSheet(); logout(); });
    $('#s-csv', sh).addEventListener('click', exportCsv);
    $('#s-save', sh).addEventListener('click', async ev => {
      const out = clone(state.settings);
      for (const p of PEOPLE) {
        const blk = $(`.set-person[data-p="${p}"]`, sh), P = out.people[p];
        const val = k => $(`[data-k="${k}"]`, blk).value;
        P.arrival = val('arrival') || P.arrival;
        P.departure = val('departure') || P.departure;
        P.preSpent = parseAmount(val('preSpent'), 'DKK') || 0;
        const nb = parseAmount(val('budget'), 'DKK');
        if (nb > 0 && nb !== budgetOn(P, eff)) P.budgets = [...P.budgets.filter(b => b.from < eff), { from: eff, amount: nb }];
        P.fixed = $$('.fixed-row', blk).map(r => {
          const [l, a, pd] = $$('input', r).map(i => i.value);
          const amount = parseAmount(a, 'DKK');
          return { label: l.trim(), amount: amount || 0, paid: pd === '' ? (amount || 0) : (parseAmount(pd, 'DKK') || 0) };
        }).filter(f => f.label || f.amount);
      }
      out.lockin = $('#s-lockin', sh).value || out.lockin;
      const fr = parseAmount($('#s-rate', sh).value, 'DKK'); if (fr > 0) out.fallbackRate = fr;
      ev.target.disabled = true;
      try { await db.saveSettings(out); state.settings = out; closeSheet(); toast('Indstillinger gemt'); await sync(true); render(); }
      catch (err) { ev.target.disabled = false; if (isAuthErr(err)) return logout('Koden er forkert.'); toast('Kunne ikke gemme'); }
    });
  });
}
const fixedRow = f => `<div class="fixed-row"><input class="input" value="${esc(f.label)}" placeholder="Post"><input class="input" inputmode="numeric" value="${f.amount}" placeholder="0"><input class="input" inputmode="numeric" value="${f.paid ?? ''}" placeholder="= total"><button class="rm" aria-label="Fjern">×</button></div>`;

function exportCsv() {
  const rows = [['person', 'dato', 'kr', 'beloeb', 'valuta', 'kurs', 'kategori', 'note']];
  for (const e of [...state.entries].sort((a, b) => a.day.localeCompare(b.day))) rows.push([e.person, e.day, e.amount_dkk, e.amount_orig, e.currency, e.rate, e.category, e.note || '']);
  const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  a.download = `japan-budget-${today()}.csv`; a.click();
}

function updateRateHints() { const amt = $('#f-amt'); if (amt) amt.dispatchEvent(new Event('input')); }

/* ---------- Login ---------- */
function renderLogin(msg) {
  let who = (lsGet('jb_last_me')) || null;
  root.innerHTML = `<div class="login"><div class="login-box">
    <div class="sun-big"></div>
    <h1>Japan Budget</h1>
    <p>Hold styr på det daglige forbrug under udvekslingen.</p>
    <div class="who">${PEOPLE.map(p => `<button data-who="${p}" aria-pressed="${who === p}"><span class="dot ${p}"></span>${esc(state.settings.people[p].name)}</button>`).join('')}</div>
    ${REMOTE ? '<div class="field"><input id="l-pin" class="input" type="password" placeholder="Fælles kode" autocomplete="current-password"></div>' : ''}
    <button class="btn" id="l-go" ${who ? '' : 'disabled'}>Fortsæt</button>
    <div class="err-msg" id="l-err">${esc(msg || '')}</div>
  </div></div>`;
  $$('.who button').forEach(b => b.addEventListener('click', () => {
    who = b.dataset.who; $$('.who button').forEach(x => x.setAttribute('aria-pressed', x === b)); $('#l-go').disabled = false;
    const pin = $('#l-pin'); if (pin) pin.focus();
  }));
  const go = async () => {
    if (!who) return;
    const pin = REMOTE ? $('#l-pin').value.trim() : 'local';
    if (!pin) { $('#l-err').textContent = 'Indtast jeres fælles kode'; return; }
    $('#l-go').disabled = true; $('#l-err').textContent = '';
    state.session = { me: who, pin };
    try {
      await db.load();
      lsSet('jb_session', state.session); lsSet('jb_last_me', who);
      state.view = who; lsSet('jb_view', who);
      render(); sync();
    } catch (e) {
      state.session = null;
      $('#l-go').disabled = false;
      $('#l-err').textContent = isAuthErr(e) ? 'Forkert kode' : 'Kunne ikke forbinde – prøv igen';
    }
  };
  $('#l-go').addEventListener('click', go);
  const pinEl = $('#l-pin'); if (pinEl) pinEl.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
}
function logout(msg) { lsDel('jb_session'); lsDel('jb_cache'); state.session = null; closeSheet(true); renderLogin(msg); }

/* ---------- Diverse ---------- */
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2400); }
function applyTheme(t) {
  if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
}

root.addEventListener('click', ev => {
  const b = ev.target.closest('button');
  if (!ev.target.closest('.chart')) $$('.chart').forEach(c => c._hide && c._hide());
  if (!b) return;
  if (b.dataset.view) { state.view = b.dataset.view; lsSet('jb_view', state.view); state.histLimit = 25; render(); window.scrollTo({ top: 0 }); }
  if (b.dataset.edit) { const e = state.entries.find(x => String(x.id) === b.dataset.edit); if (e) entrySheet(e); }
  if (b.dataset.day) { stepDay(b.dataset.day); return; }
  if (b.dataset.range != null) { state.chartRange = +b.dataset.range; lsSet('jb_range', state.chartRange); render(); }
  const act = b.dataset.act;
  if (act === 'add') entrySheet();
  if (act === 'settings') settingsSheet();
  if (act === 'refresh') { sync(); loadRate(); }
  if (act === 'more') { state.histLimit += 50; render(); }
});
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeSheet(); });
function stepDay(how) {
  const ents = state.view === 'both' ? state.entries : state.entries.filter(e => e.person === state.view);
  const { min, max } = dayBounds(ents);
  if (how === 'today') state.selDay = null;
  else { let d = addDays(selectedDay(ents), +how); d = d < min ? min : d > max ? max : d; state.selDay = d === max ? null : d; }
  render();
}
let swipeX = null, swipeY = null;
root.addEventListener('touchstart', ev => { if (!ev.target.closest('[data-swipe="day"]')) { swipeX = null; return; } swipeX = ev.touches[0].clientX; swipeY = ev.touches[0].clientY; }, { passive: true });
root.addEventListener('touchend', ev => {
  if (swipeX == null) return;
  const dx = ev.changedTouches[0].clientX - swipeX, dy = ev.changedTouches[0].clientY - swipeY; swipeX = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) stepDay(dx > 0 ? '-1' : '1');
}, { passive: true });

let rT;
window.addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(drawCharts, 150); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { sync(true); loadRate(); } });
setInterval(() => { if (document.visibilityState === 'visible' && state.session && !$('#sheet')) sync(true); }, 45000);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', drawCharts);

// Start
render();
if (state.session) sync(!!cache);
loadRate();
})();
