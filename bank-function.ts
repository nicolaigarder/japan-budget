// Supabase Edge Function "bank"
// Henter Nicolais og Alex' posteringer via Enable Banking (kun læseadgang) og lægger dem ind som udgifter.
// Hver person har sin egen bankforbindelse, beskyttet af en personlig bankkode (ud over jeres fælles kode).
// Secrets: EB_PRIVATE_KEY (Nicolais .pem). Valgfrit for Alex' egen app: EB_APP_ID_ALEX + EB_PRIVATE_KEY_ALEX.
// "Verify JWT" skal være slået FRA – funktionen tjekker selv fælles kode, bankkode og cron-hemmelighed.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const APP_ID = '151cb802-55c9-4318-a57d-7c65c66dec83';
const API = 'https://api.enablebanking.com';
const REDIRECT = 'https://nicolaigarder.github.io/japan-budget/bank.html';
const PEOPLE = ['nicolai', 'alex'];
const MAX_CONSENT_S = 180 * 24 * 3600;
const MAX_FAILS = 5, LOCK_MIN = 15;
// Nicolai: kun denne konto bruges (SHA-256 af IBAN, så kontonummeret ikke står i den offentlige kode)
const ONLY_IBAN_SHA256: Record<string, string> = { nicolai: 'f6a830f8092028125f56dc2c777e122d1cce8ad9a4bcd63eeca12b5b7e734029' };

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

/* ---------- JWT (RS256), én Enable Banking-app pr. person (Alex falder tilbage til Nicolais) ---------- */
const enc = new TextEncoder();
const b64url = (data: Uint8Array | string) => {
  const bytes = typeof data === 'string' ? enc.encode(data) : data;
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const concat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const derLen = (n: number) => { if (n < 128) return [n]; const b: number[] = []; while (n > 0) { b.unshift(n & 255); n >>= 8; } return [0x80 | b.length, ...b]; };
const der = (tag: number, c: Uint8Array) => concat(new Uint8Array([tag, ...derLen(c.length)]), c);
const pkcs1ToPkcs8 = (k: Uint8Array) => der(0x30, concat(
  new Uint8Array([0x02, 0x01, 0x00]),
  new Uint8Array([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]),
  der(0x04, k),
));
const appFor = (person: string) => {
  const P = person.toUpperCase();
  const own = Deno.env.get(`EB_APP_ID_${P}`) && Deno.env.get(`EB_PRIVATE_KEY_${P}`);
  return own
    ? { id: Deno.env.get(`EB_APP_ID_${P}`)!, pem: Deno.env.get(`EB_PRIVATE_KEY_${P}`)! }
    : { id: APP_ID, pem: Deno.env.get('EB_PRIVATE_KEY') || '' };
};
const keys = new Map<string, Promise<CryptoKey>>();
function signingKey(app: { id: string; pem: string }) {
  if (!keys.has(app.id)) {
    if (!app.pem) throw new Error('Privat nøgle mangler i Supabase secrets');
    const body = app.pem.replace(/-----[^-]+-----/g, '').replace(/\\n/g, '').replace(/[^A-Za-z0-9+/=]/g, '');
    let derBytes = Uint8Array.from(atob(body), c => c.charCodeAt(0));
    if (/RSA PRIVATE KEY/.test(app.pem)) derBytes = pkcs1ToPkcs8(derBytes);
    keys.set(app.id, crypto.subtle.importKey('pkcs8', derBytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']));
  }
  return keys.get(app.id)!;
}
async function jwt(person: string) {
  const app = appFor(person);
  const now = Math.floor(Date.now() / 1000);
  const h = b64url(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: app.id }));
  const p = b64url(JSON.stringify({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp: now + 3600 }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await signingKey(app), enc.encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(new Uint8Array(sig))}`;
}
async function eb(person: string, path: string, init: RequestInit = {}) {
  const r = await fetch(API + path, { ...init, headers: { Authorization: 'Bearer ' + await jwt(person), 'Content-Type': 'application/json' } });
  const text = await r.text();
  let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) throw new Error(`Enable Banking ${r.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`.slice(0, 600));
  return data;
}

/* ---------- Hjælpere ---------- */
async function getLink(person: string) {
  const { data, error } = await db.from('bank_link').select('*').eq('person', person).single();
  if (error) throw error;
  return data;
}
async function setLink(person: string, patch: Record<string, unknown>) {
  const { error } = await db.from('bank_link').update({ ...patch, updated_at: new Date().toISOString() }).eq('person', person);
  if (error) throw error;
}
async function sha(s: string) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
  return 'h' + Array.from(h.slice(0, 12)).map(b => b.toString(16).padStart(2, '0')).join('');
}
const CAT_RULES: [RegExp, string][] = [
  [/h[æa]vning|\batm\b|kontant|cash|seven bank/i, 'andet'],
  [/karaoke|\bbar\b|\bpub\b|club|beer|\bhub\b/i, 'byen'],
  [/7-?eleven|seven-?eleven|family ?mart|lawson|ministop|yamazaki|ramen|sushi|sukiya|matsuya|yoshinoya|mcdonald|starbucks|doutor|tully|restaurant|cafe|coffee|kfc|burger|bento|izakaya|gyoza|udon|soba|yakiniku|saizeriya|gusto|coco ?ichi|supermarket|aeon|seiyu|ito ?yokado|maruetsu|summit|uber ?eats|wolt|demae|food/i, 'mad'],
  [/\bjr\b|east japan|suica|pasmo|metro|tokyu|odakyu|keikyu|toei|keisei|seibu|tobu|railway|shinkansen|taxi|\buber\b|airline|\bana\b|\bjal\b|peach|jetstar|skyliner/i, 'transport'],
  [/museum|temple|shrine|ticket|teamlab|disney|universal studios|onsen|klook|kkday|tour/i, 'oplevelser'],
  [/uniqlo|don quijote|donki|muji|loft|hands|bic camera|yodobashi|amazon|daiso|3coins|zara|h&m|apple|parco|lumine|\bshop|\bstore\b/i, 'shopping'],
];
const guessCat = (t: string) => (CAT_RULES.find(([re]) => re.test(t)) || [null, 'andet'])[1] as string;
function parseJpy(t: string): number | null {
  const m = t.match(/JPY\s*([\d.,]+)/i) || t.match(/([\d.,]+)\s*JPY/i);
  if (!m) return null;
  const v = Number(m[1].replace(/[.,]\d{1,2}$/, '').replace(/[.,]/g, ''));
  return v > 0 ? v : null;
}
const cleanText = (t: string) => t.replace(/\s+/g, ' ')
  .replace(/^((mc|mastercard|visa|dankort|kortk[øo]b|k[øo]b|debit|nota)\b\s*[:\-]?\s*)+/i, '')
  .replace(/\b(JPY|USD|EUR|SEK|NOK)\b.*$/i, '')
  .replace(/(\s+[\d.,\/]+)+\s*$/, '')
  .trim().slice(0, 60);
const hex = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))).map(b => b.toString(16).padStart(2, '0')).join('');

/* ---------- Synkronisering ---------- */
async function sync(person: string) {
  const link = await getLink(person);
  if (!link.session_id) return { ok: false, error: 'Ikke koblet til banken endnu' };
  const accounts = (link.accounts || []).filter((a: any) => a.enabled === true);
  if (!accounts.length) return { ok: false, error: 'Vælg hvilken konto der skal hentes fra' };
  const { data: st } = await db.from('settings').select('data').eq('id', 1).single();
  const lockin: string = st?.data?.lockin || '2026-11-03';
  let from = lockin;
  if (link.last_sync) { const d = new Date(link.last_sync); d.setUTCDate(d.getUTCDate() - 10); const s = d.toISOString().slice(0, 10); if (s > from) from = s; }
  // Banken accepterer ikke en startdato i fremtiden (fx før lock-in er begyndt)
  const todayUtc = new Date().toISOString().slice(0, 10);
  if (from > todayUtc) from = todayUtc;
  const patterns: RegExp[] = (link.exclude_patterns || []).filter(Boolean).map((p: string) => { try { return new RegExp(p, 'i'); } catch { return new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); } });
  const { data: ign } = await db.from('bank_ignored').select('bank_ref');
  const ignored = new Set((ign || []).map((r: any) => r.bank_ref));
  const rows: any[] = [], skipped: any[] = [];
  for (const acc of accounts) {
    let ck: string | null = null, guard = 0;
    do {
      const q = new URLSearchParams({ date_from: from });
      if (ck) q.set('continuation_key', ck);
      const r = await eb(person, `/accounts/${encodeURIComponent(acc.uid)}/transactions?${q}`);
      for (const t of r.transactions || []) {
        if (t.status && t.status !== 'BOOK') continue;
        const rawAmt = parseFloat(t.transaction_amount?.amount);
        const ind = t.credit_debit_indicator || (rawAmt < 0 ? 'DBIT' : 'CRDT');
        if (ind !== 'DBIT') continue;
        const amt = Math.abs(rawAmt);
        if (!(amt > 0)) continue;
        const day = String(t.transaction_date || t.value_date || t.booking_date || '').slice(0, 10);
        if (!day || day < lockin) continue;
        const raw = [t.creditor?.name, ...(Array.isArray(t.remittance_information) ? t.remittance_information : [t.remittance_information]), t.note]
          .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
        const ref = t.entry_reference || t.transaction_id || await sha(`${acc.uid}|${day}|${amt}|${raw}`);
        if (ignored.has(ref)) continue;
        if (patterns.some(p => p.test(raw))) { skipped.push({ day, amount: amt, text: raw.slice(0, 80) }); continue; }
        const isCash = /h[æa]vning|\batm\b|kontant|cash/i.test(raw);
        const jpy = parseJpy(raw);
        rows.push({
          person, day, amount_dkk: Math.round(amt * 100) / 100,
          amount_orig: jpy ?? Math.round(amt * 100) / 100, currency: jpy ? 'JPY' : 'DKK',
          rate: jpy ? amt / jpy : null, category: guessCat(raw),
          note: isCash ? 'Kontanthævning' : (cleanText(raw) || 'Kortkøb'),
          source: 'bank', bank_ref: String(ref),
        });
      }
      ck = r.continuation_key || null; guard++;
    } while (ck && guard < 20);
  }
  let inserted: any[] = [];
  if (rows.length) {
    const { data, error } = await db.from('entries').upsert(rows, { onConflict: 'bank_ref', ignoreDuplicates: true }).select('day, amount_dkk, note');
    if (error) throw error;
    inserted = data || [];
  }
  const result = { ok: true, at: new Date().toISOString(), from, imported: inserted.length, imported_list: inserted.slice(0, 40), skipped: skipped.slice(0, 40) };
  await setLink(person, { last_sync: result.at, last_result: result });
  return result;
}
async function safeSync(person: string) {
  try { return await sync(person); }
  catch (e) { const r = { ok: false, at: new Date().toISOString(), error: String((e as Error).message || e) }; await setLink(person, { last_result: r }); return r; }
}

async function status(person: string) {
  const l = await getLink(person);
  const days = l.valid_until ? Math.floor((new Date(l.valid_until).getTime() - Date.now()) / 864e5) : null;
  return {
    person, linked: !!l.session_id, aspsp: l.aspsp, valid_until: l.valid_until, days_left: days,
    last_sync: l.last_sync, last_result: l.last_result, exclude_patterns: l.exclude_patterns,
    accounts: (l.accounts || []).map((a: any) => ({ uid: a.uid, name: a.name, last4: a.last4, enabled: a.enabled === true })),
  };
}

/* ---------- Personlig bankkode (med spærring efter for mange forkerte forsøg) ---------- */
async function checkCode(person: string, code: string): Promise<Response | null> {
  const l = await getLink(person);
  if (!l.code_hash) return json({ error: 'Ingen bankkode valgt endnu', need_code_setup: true }, 403);
  if (l.locked_until && new Date(l.locked_until).getTime() > Date.now()) {
    const min = Math.ceil((new Date(l.locked_until).getTime() - Date.now()) / 60000);
    return json({ error: `For mange forkerte forsøg – prøv igen om ${min} min.`, locked: true }, 429);
  }
  const { data: ok, error } = await db.rpc('jb_bank_code_ok', { p_person: person, p_code: code });
  if (error) throw error;
  if (!ok) {
    const fails = (l.fail_count || 0) + 1;
    if (fails >= MAX_FAILS) await setLink(person, { fail_count: 0, locked_until: new Date(Date.now() + LOCK_MIN * 60000).toISOString() });
    else await setLink(person, { fail_count: fails });
    return json({ error: 'Forkert bankkode', bad_code: true, tries_left: Math.max(0, MAX_FAILS - fails) }, 403);
  }
  if (l.fail_count || l.locked_until) await setLink(person, { fail_count: 0, locked_until: null });
  return null;
}

/* ---------- HTTP ---------- */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'status');

    // Automatisk hentning (pg_cron) – henter for alle koblede personer
    const cronSecret = req.headers.get('x-cron-secret');
    if (cronSecret) {
      const { data: c } = await db.from('bank_link').select('cron_secret').eq('id', 1).single();
      if (!c?.cron_secret || cronSecret !== c.cron_secret || action !== 'sync') return json({ error: 'forbidden' }, 403);
      const out: Record<string, unknown> = {};
      for (const p of PEOPLE) { const l = await getLink(p); if (l.session_id) out[p] = await safeSync(p); }
      return json(out);
    }

    const { data: pinOk, error: pinErr } = await db.rpc('jb_pin_ok', { p_pin: String(body.pin || '') });
    if (pinErr) throw pinErr;
    if (!pinOk) return json({ error: 'Forkert kode' }, 403);

    const person = String(body.person || '');
    if (!PEOPLE.includes(person)) return json({ error: 'Ukendt person' }, 400);
    const code = String(body.bank_code || '');

    // Uden bankkode: kun om der er valgt en kode
    if (action === 'code_state') {
      const l = await getLink(person);
      return json({ has_code: !!l.code_hash, locked: !!(l.locked_until && new Date(l.locked_until).getTime() > Date.now()) });
    }
    if (action === 'set_code') {
      const l = await getLink(person);
      if (l.code_hash) return json({ error: 'Der er allerede valgt en bankkode' }, 409);
      if (code.length < 4) return json({ error: 'Bankkoden skal være mindst 4 tegn' }, 400);
      const { error } = await db.rpc('jb_bank_code_set', { p_person: person, p_code: code });
      if (error) throw error;
      return json(await status(person));
    }

    // Alt andet kræver personens bankkode
    const denied = await checkCode(person, code);
    if (denied) return denied;

    if (action === 'status') return json(await status(person));

    if (action === 'change_code') {
      const nc = String(body.new_code || '');
      if (nc.length < 4) return json({ error: 'Bankkoden skal være mindst 4 tegn' }, 400);
      const { error } = await db.rpc('jb_bank_code_set', { p_person: person, p_code: nc });
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === 'banks') {
      const d = await eb(person, '/aspsps?country=DK');
      return json({ banks: (d.aspsps || []).map((a: any) => a.name).sort((a: string, b: string) => a.localeCompare(b, 'da')) });
    }

    if (action === 'auth') {
      const d = await eb(person, '/aspsps?country=DK');
      const list = d.aspsps || [];
      const want = String(body.bank || '');
      const a = list.find((x: any) => want ? x.name === want : /l[åa]n\s*(&|og)\s*spar/i.test(x.name));
      if (!a) return json({ error: 'Fandt ikke banken hos Enable Banking', banks: list.map((x: any) => x.name) }, 404);
      const secs = Math.min(Number(a.maximum_consent_validity) || MAX_CONSENT_S, MAX_CONSENT_S) - 3600;
      const state = crypto.randomUUID();
      const r = await eb(person, '/auth', {
        method: 'POST',
        body: JSON.stringify({
          access: { valid_until: new Date(Date.now() + secs * 1000).toISOString() },
          aspsp: { name: a.name, country: 'DK' }, state, redirect_url: REDIRECT, psu_type: 'personal',
        }),
      });
      await setLink(person, { pending_state: state, aspsp: a.name });
      return json({ url: r.url });
    }

    if (action === 'session') {
      const l = await getLink(person);
      if (!body.code) return json({ error: 'Mangler code' }, 400);
      if (!l.pending_state || body.state !== l.pending_state) return json({ error: 'Ugyldig state – start koblingen forfra' }, 400);
      const s = await eb(person, '/sessions', { method: 'POST', body: JSON.stringify({ code: body.code }) });
      const only = ONLY_IBAN_SHA256[person];
      const raw = s.accounts || [];
      const accounts = [];
      for (const a of raw) {
        const iban = String(a.account_id?.iban || '').replace(/\s/g, '').toUpperCase();
        const enabled = only ? (iban ? (await hex(iban)) === only : false) : raw.length === 1;
        accounts.push({ uid: a.uid, name: a.name || a.product || a.details || 'Konto', last4: String(iban || a.account_id?.other?.identification || '').slice(-4), enabled });
      }
      if (only && accounts.length && !accounts.some(a => a.enabled)) throw new Error('Den valgte konto var ikke med i samtykket – vælg den, når du godkender med MitID');
      await setLink(person, { session_id: s.session_id, accounts, valid_until: s.access?.valid_until || null, pending_state: null });
      const syncResult = accounts.some(a => a.enabled) ? await safeSync(person) : { ok: false, error: 'Vælg hvilken konto der skal hentes fra' };
      return json({ ...(await status(person)), sync: syncResult });
    }

    if (action === 'sync') {
      const r = await safeSync(person);
      return json(r, (r as any).ok === false && (r as any).at ? 502 : 200);
    }

    if (action === 'settings') {
      const l = await getLink(person);
      const patch: Record<string, unknown> = {};
      if (Array.isArray(body.exclude_patterns)) patch.exclude_patterns = body.exclude_patterns.map((x: unknown) => String(x).trim()).filter(Boolean).slice(0, 100);
      if (Array.isArray(body.enabled)) patch.accounts = (l.accounts || []).map((a: any) => ({ ...a, enabled: body.enabled.includes(a.uid) }));
      await setLink(person, patch);
      return json(await status(person));
    }

    if (action === 'unlink') {
      const l = await getLink(person);
      if (l.session_id) { try { await eb(person, `/sessions/${encodeURIComponent(l.session_id)}`, { method: 'DELETE' }); } catch { /* allerede udløbet */ } }
      await setLink(person, { session_id: null, accounts: [], valid_until: null, pending_state: null });
      return json(await status(person));
    }

    return json({ error: 'Ukendt action' }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
