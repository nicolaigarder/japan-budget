// Supabase Edge Function "bank"
// Henter Nicolais posteringer fra Lån & Spar via Enable Banking (kun læseadgang) og lægger dem ind som udgifter.
// Kræver secret: EB_PRIVATE_KEY (indholdet af .pem-filen fra Enable Banking).
// "Enforce JWT verification" skal være slået FRA – funktionen tjekker selv jeres fælles kode / cron-hemmelighed.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const APP_ID = '151cb802-55c9-4318-a57d-7c65c66dec83';
const API = 'https://api.enablebanking.com';
const REDIRECT = 'https://nicolaigarder.github.io/japan-budget/bank.html';
const PERSON = 'nicolai';
const MAX_CONSENT_S = 180 * 24 * 3600;
// Kun denne konto bruges (SHA-256 af IBAN, så kontonummeret ikke står i den offentlige kode)
const ONLY_IBAN_SHA256 = 'f6a830f8092028125f56dc2c777e122d1cce8ad9a4bcd63eeca12b5b7e734029';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

/* ---------- JWT (RS256) ---------- */
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
let keyP: Promise<CryptoKey> | null = null;
function signingKey() {
  if (!keyP) {
    const pem = Deno.env.get('EB_PRIVATE_KEY') || '';
    if (!pem) throw new Error('EB_PRIVATE_KEY mangler i Supabase secrets');
    const body = pem.replace(/-----[^-]+-----/g, '').replace(/\\n/g, '').replace(/[^A-Za-z0-9+/=]/g, '');
    let derBytes = Uint8Array.from(atob(body), c => c.charCodeAt(0));
    if (/RSA PRIVATE KEY/.test(pem)) derBytes = pkcs1ToPkcs8(derBytes);
    keyP = crypto.subtle.importKey('pkcs8', derBytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  }
  return keyP;
}
async function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const h = b64url(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: APP_ID }));
  const p = b64url(JSON.stringify({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp: now + 3600 }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await signingKey(), enc.encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(new Uint8Array(sig))}`;
}
async function eb(path: string, init: RequestInit = {}) {
  const r = await fetch(API + path, { ...init, headers: { Authorization: 'Bearer ' + await jwt(), 'Content-Type': 'application/json' } });
  const text = await r.text();
  let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) throw new Error(`Enable Banking ${r.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`.slice(0, 600));
  return data;
}

/* ---------- Hjælpere ---------- */
async function getLink() {
  const { data, error } = await db.from('bank_link').select('*').eq('id', 1).single();
  if (error) throw error;
  return data;
}
async function setLink(patch: Record<string, unknown>) {
  const { error } = await db.from('bank_link').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', 1);
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

/* ---------- Synkronisering ---------- */
async function sync() {
  const link = await getLink();
  if (!link.session_id) return { ok: false, error: 'Ikke koblet til banken endnu' };
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
  const accounts = (link.accounts || []).filter((a: any) => a.enabled !== false);
  for (const acc of accounts) {
    let ck: string | null = null, guard = 0;
    do {
      const q = new URLSearchParams({ date_from: from });
      if (ck) q.set('continuation_key', ck);
      const r = await eb(`/accounts/${encodeURIComponent(acc.uid)}/transactions?${q}`);
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
          person: PERSON, day, amount_dkk: Math.round(amt * 100) / 100,
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
  await setLink({ last_sync: result.at, last_result: result });
  return result;
}

async function status() {
  const l = await getLink();
  const days = l.valid_until ? Math.floor((new Date(l.valid_until).getTime() - Date.now()) / 864e5) : null;
  return {
    linked: !!l.session_id, aspsp: l.aspsp, valid_until: l.valid_until, days_left: days,
    last_sync: l.last_sync, last_result: l.last_result, exclude_patterns: l.exclude_patterns,
    accounts: (l.accounts || []).map((a: any) => ({ uid: a.uid, name: a.name, last4: a.last4, enabled: a.enabled !== false })),
  };
}

/* ---------- HTTP ---------- */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'status');
    const cronSecret = req.headers.get('x-cron-secret');
    let isCron = false;
    if (cronSecret) {
      const l = await getLink();
      isCron = !!l.cron_secret && cronSecret === l.cron_secret;
      if (!isCron) return json({ error: 'forbidden' }, 403);
      if (action !== 'sync') return json({ error: 'forbidden' }, 403);
    } else {
      const { data: ok, error } = await db.rpc('jb_pin_ok', { p_pin: String(body.pin || '') });
      if (error) throw error;
      if (!ok) return json({ error: 'Forkert kode' }, 403);
    }

    if (action === 'status') return json(await status());

    if (action === 'banks') {
      const d = await eb('/aspsps?country=DK');
      return json({ banks: (d.aspsps || []).map((a: any) => a.name) });
    }

    if (action === 'auth') {
      const d = await eb('/aspsps?country=DK');
      const list = d.aspsps || [];
      const want = String(body.bank || '');
      const a = list.find((x: any) => want ? x.name === want : /l[åa]n\s*(&|og)\s*spar/i.test(x.name));
      if (!a) return json({ error: 'Fandt ikke Lån & Spar hos Enable Banking', banks: list.map((x: any) => x.name) }, 404);
      const secs = Math.min(Number(a.maximum_consent_validity) || MAX_CONSENT_S, MAX_CONSENT_S) - 3600;
      const state = crypto.randomUUID();
      const r = await eb('/auth', {
        method: 'POST',
        body: JSON.stringify({
          access: { valid_until: new Date(Date.now() + secs * 1000).toISOString() },
          aspsp: { name: a.name, country: 'DK' }, state, redirect_url: REDIRECT, psu_type: 'personal',
        }),
      });
      await setLink({ pending_state: state, aspsp: a.name });
      return json({ url: r.url });
    }

    if (action === 'session') {
      const l = await getLink();
      if (!body.code) return json({ error: 'Mangler code' }, 400);
      if (!l.pending_state || body.state !== l.pending_state) return json({ error: 'Ugyldig state – start koblingen forfra' }, 400);
      const s = await eb('/sessions', { method: 'POST', body: JSON.stringify({ code: body.code }) });
      const accounts = [];
      for (const a of s.accounts || []) {
        const iban = String(a.account_id?.iban || '').replace(/\s/g, '').toUpperCase();
        const ibanHash = iban ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(iban)))).map(b => b.toString(16).padStart(2, '0')).join('') : '';
        accounts.push({
          uid: a.uid, name: a.name || a.product || a.details || 'Konto',
          last4: String(iban || a.account_id?.other?.identification || '').slice(-4),
          enabled: ibanHash === ONLY_IBAN_SHA256,
        });
      }
      if (accounts.length && !accounts.some(a => a.enabled)) throw new Error('Den valgte konto (··6649) var ikke med i samtykket – vælg den, når du godkender med MitID');
      await setLink({ session_id: s.session_id, accounts, valid_until: s.access?.valid_until || null, pending_state: null });
      let syncResult: unknown = null;
      try { syncResult = await sync(); } catch (e) { syncResult = { ok: false, error: String((e as Error).message || e) }; await setLink({ last_result: syncResult }); }
      return json({ ...(await status()), sync: syncResult });
    }

    if (action === 'sync') {
      try { return json(await sync()); }
      catch (e) { const r = { ok: false, at: new Date().toISOString(), error: String((e as Error).message || e) }; await setLink({ last_result: r }); return json(r, 502); }
    }

    if (action === 'settings') {
      const l = await getLink();
      const patch: Record<string, unknown> = {};
      if (Array.isArray(body.exclude_patterns)) patch.exclude_patterns = body.exclude_patterns.map((x: unknown) => String(x).trim()).filter(Boolean).slice(0, 100);
      if (Array.isArray(body.enabled)) patch.accounts = (l.accounts || []).map((a: any) => ({ ...a, enabled: body.enabled.includes(a.uid) }));
      await setLink(patch);
      return json(await status());
    }

    if (action === 'unlink') {
      const l = await getLink();
      if (l.session_id) { try { await eb(`/sessions/${encodeURIComponent(l.session_id)}`, { method: 'DELETE' }); } catch { /* allerede udløbet */ } }
      await setLink({ session_id: null, accounts: [], valid_until: null, pending_state: null });
      return json(await status());
    }

    return json({ error: 'Ukendt action' }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
