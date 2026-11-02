// Engangs-ændringer af de gemte indstillinger i databasen (kører én gang, styret af settings.migrations).
(async () => {
  const CFG = window.JB_CONFIG || {};
  let session = null;
  try { session = JSON.parse(localStorage.getItem('jb_session')); } catch { /* ignore */ }
  if (!CFG.supabaseUrl || !session || !session.pin) return;

  const rpc = async (fn, args) => {
    const headers = { 'Content-Type': 'application/json', apikey: CFG.supabaseKey };
    if (!CFG.supabaseKey.startsWith('sb_')) headers.Authorization = 'Bearer ' + CFG.supabaseKey;
    const r = await fetch(CFG.supabaseUrl.replace(/\/$/, '') + '/rest/v1/rpc/' + fn, {
      method: 'POST', headers, body: JSON.stringify({ p_pin: session.pin, ...args }),
    });
    if (!r.ok) throw new Error(fn + ' ' + r.status);
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  };

  try {
    const data = await rpc('jb_load', {});
    const s = data && data.settings;
    if (!s || !s.people || !s.people.nicolai) return; // ikke oprettet endnu – kører ved næste besøg
    s.migrations = s.migrations || {};
    let changed = false;

    // 2026-11-02: Nicolais lån (500 kr/md) flyttes fra dagligt forbrug til faste udgifter.
    if (!s.migrations.nicolaiLoan) {
      const N = s.people.nicolai;
      N.fixed = N.fixed || [];
      if (!N.fixed.some(f => /lån/i.test(f.label || ''))) {
        N.fixed.push({ label: 'Afbetaling lån (500 kr/md)', amount: 3000, paid: 1500 });
      }
      N.preSpent = (+N.preSpent || 0) - 1500;
      s.migrations.nicolaiLoan = true;
      changed = true;
    }

    if (changed) {
      await rpc('jb_save_settings', { p_data: s });
      try { localStorage.removeItem('jb_cache'); } catch { /* ignore */ }
      if (!sessionStorage.getItem('jb_mig_reload')) { sessionStorage.setItem('jb_mig_reload', '1'); location.reload(); }
    }
  } catch (e) { console.warn('Migration fejlede', e); }
})();
