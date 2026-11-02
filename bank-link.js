// Tilføjer bank-knap, "fra banken"-mærke og påmindelse om fornyelse til budget-siden.
(() => {
  const root = document.getElementById('root');
  if (!root) return;
  let S = null; try { S = JSON.parse(localStorage.getItem('jb_session')); } catch { /* ignore */ }
  const CFG = window.JB_CONFIG || {};
  let status = null;
  const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10h18L12 4z"/><path d="M5 10v7M9.5 10v7M14.5 10v7M19 10v7M3 20h18"/></svg>';

  function decorate() {
    const top = root.querySelector('.top');
    if (top && !top.querySelector('.bank-btn')) {
      const a = document.createElement('a');
      a.href = 'bank.html'; a.className = 'icon-btn bank-btn'; a.setAttribute('aria-label', 'Bankforbindelse'); a.innerHTML = ICON;
      top.insertBefore(a, top.querySelector('[data-act="settings"]'));
    }
    const app = root.querySelector('.app');
    if (app && status && !app.querySelector('.bank-banner')) {
      let msg = '';
      const err = status.last_result && status.last_result.error;
      if (status.linked && status.days_left != null && status.days_left <= 14) msg = `Bankforbindelsen udløber om ${Math.max(0, status.days_left)} dage – tryk for at forny med MitID`;
      else if (status.linked && err) msg = 'Seneste bank-hentning fejlede – tryk for detaljer';
      if (msg) {
        const b = document.createElement('a');
        b.href = 'bank.html'; b.className = 'banner bank-banner'; b.style.display = 'block'; b.style.textDecoration = 'none'; b.textContent = msg;
        const tabs = app.querySelector('.tabs'); app.insertBefore(b, tabs);
      }
    }
    let cache = null; try { cache = JSON.parse(localStorage.getItem('jb_cache')); } catch { /* ignore */ }
    const ids = new Set(((cache && cache.entries) || []).filter(e => e.source === 'bank').map(e => String(e.id)));
    if (ids.size) root.querySelectorAll('.entry[data-edit]').forEach(btn => {
      if (ids.has(btn.dataset.edit) && !btn.querySelector('.bank-tag')) {
        const sp = btn.querySelector('.tx span'); if (sp) sp.insertAdjacentHTML('beforeend', ' · <span class="bank-tag">🏦 bank</span>');
      }
    });
  }
  new MutationObserver(decorate).observe(root, { childList: true, subtree: true });
  decorate();

  if (S && S.pin && CFG.supabaseUrl) {
    fetch(CFG.supabaseUrl.replace(/\/$/, '') + '/functions/v1/bank', {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseKey },
      body: JSON.stringify({ action: 'status', pin: S.pin }),
    }).then(r => r.ok ? r.json() : null).then(d => { if (d && !d.error) { status = d; decorate(); } }).catch(() => {});
  }
})();
