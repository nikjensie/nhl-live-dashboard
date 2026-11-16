// Enkel profil (namn + PIN) som tar med inställningar, ligor och valt lag mellan enheter.
// Inställningarna sparas på servern (/api/league, action profile-*) och i webbläsaren som vanligt.

export const SYNC_KEYS = ['rs.yleagues', 'rs.showFantasy', 'rs.preds', 'rs.results', 'rs.theme', 'rs.sound',
  'rs.weekSort', 'rs.onlyMine', 'rs.goalOrderAsc'];

export function initProfile({ store, esc }) {
  const btn = document.querySelector('#profileBtn');
  const dlg = document.querySelector('#profileDlg');
  const body = document.querySelector('#profileBody');
  let me = store.get('rs.profile', null); // { name, token }
  let mode = 'login'; // 'login' | 'create'
  let msg = '';
  let busy = false;
  let lastName = '';
  let timer = null;

  const snapshot = () => Object.fromEntries(SYNC_KEYS.map((k) => [k, store.get(k, null)]).filter(([, v]) => v !== null));

  async function api(payload) {
    const r = await fetch('/api/league', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(me?.token ? { Authorization: `Bearer ${me.token}` } : {}) },
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || `Fel ${r.status}`), { status: r.status });
    return j;
  }

  /** Lägg in serverns inställningar lokalt. Returnerar true om något ändrades. */
  function apply(settings) {
    let changed = false;
    for (const k of SYNC_KEYS) {
      if (!(k in (settings || {}))) continue;
      if (JSON.stringify(store.get(k, null)) !== JSON.stringify(settings[k])) { store.set(k, settings[k]); changed = true; }
    }
    return changed;
  }

  function renderBtn() {
    if (!btn) return;
    btn.classList.toggle('on', !!me);
    btn.title = me ? `Inloggad som ${me.name}` : 'Logga in – ta med inställningar och ligor mellan enheter';
    btn.setAttribute('aria-label', btn.title);
    btn.innerHTML = me
      ? `<span class="pf-initial">${esc(me.name.slice(0, 1).toUpperCase())}</span>`
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>';
  }

  function render() {
    if (!body) return;
    if (me) {
      body.innerHTML = `<h2>Inloggad som ${esc(me.name)}</h2>
        <p>Dina inställningar, Yahoo-ligor och valda lag sparas i profilen och följer med när du loggar in på en annan enhet.</p>
        ${msg ? `<p class="pf-msg">${esc(msg)}</p>` : ''}
        <div class="pf-actions"><button class="btn" data-pf-sync ${busy ? 'disabled' : ''}>Hämta från profilen</button>
        <button class="mu-btn ghost" data-pf-logout>Logga ut</button><button class="mu-btn ghost" data-pf-close>Stäng</button></div>`;
      return;
    }
    const create = mode === 'create';
    body.innerHTML = `<h2>${create ? 'Skapa profil' : 'Logga in'}</h2>
      <p>${create ? 'Välj ett namn och en PIN. Dina nuvarande inställningar, ligor och valda lag sparas i profilen.' : 'Logga in för att hämta dina inställningar, ligor och valda lag till den här enheten.'}</p>
      <form data-pf-form class="pf-form">
        <input name="name" placeholder="Namn" maxlength="30" required autocomplete="username" autocapitalize="off" value="${esc(lastName)}">
        <input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" placeholder="PIN (4–8 siffror)" required autocomplete="${create ? 'new-password' : 'current-password'}">
        ${msg ? `<p class="pf-msg">${esc(msg)}</p>` : ''}
        <div class="pf-actions"><button class="btn" ${busy ? 'disabled' : ''}>${create ? 'Skapa' : 'Logga in'}</button>
          <button type="button" class="mu-btn ghost" data-pf-mode>${create ? 'Har redan profil' : 'Skapa profil'}</button>
          <button type="button" class="mu-btn ghost" data-pf-close>Stäng</button></div>
      </form>`;
  }

  async function submit(f) {
    const v = Object.fromEntries(new FormData(f));
    lastName = v.name || '';
    busy = true; msg = ''; render();
    try {
      const create = mode === 'create';
      const j = await api({ action: create ? 'profile-create' : 'profile-login', name: v.name, pin: v.pin, settings: create ? snapshot() : undefined });
      me = { name: j.name, token: j.token };
      store.set('rs.profile', me);
      renderBtn();
      if (!create && apply(j.settings)) { location.reload(); return; }
      if (!create && !Object.keys(j.settings || {}).length) await api({ action: 'profile-save', settings: snapshot() });
      msg = create ? 'Profilen är skapad.' : 'Inloggad.';
    } catch (e) {
      msg = e.message;
    } finally {
      busy = false;
      render();
    }
  }

  async function pull(reloadOnChange) {
    if (!me) return;
    try {
      const j = await api({ action: 'profile-get' });
      if (apply(j.settings) && reloadOnChange) location.reload();
    } catch (e) {
      if (e.status === 401) { me = null; store.set('rs.profile', null); renderBtn(); }
    }
  }

  btn?.addEventListener('click', () => { msg = ''; render(); dlg?.showModal(); dlg?.querySelector('input')?.focus(); });
  dlg?.addEventListener('click', (e) => {
    if (e.target === dlg || e.target.closest('[data-pf-close]')) { dlg.close(); return; }
    if (e.target.closest('[data-pf-mode]')) { mode = mode === 'create' ? 'login' : 'create'; msg = ''; render(); return; }
    if (e.target.closest('[data-pf-logout]')) { me = null; store.set('rs.profile', null); renderBtn(); msg = ''; render(); return; }
    if (e.target.closest('[data-pf-sync]')) { busy = true; render(); pull(true).finally(() => { busy = false; msg = 'Inställningarna är hämtade.'; render(); }); }
  });
  dlg?.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-pf-form]');
    if (!f) return;
    e.preventDefault();
    submit(f);
  });

  renderBtn();
  // Vid start: hämta senaste inställningarna från profilen (laddar om om något ändrats på annan enhet)
  pull(true);

  return {
    /** Anropas när en inställning ändras – sparas till profilen efter en kort stund. */
    changed(key) {
      if (!me || !SYNC_KEYS.includes(key)) return;
      clearTimeout(timer);
      timer = setTimeout(() => api({ action: 'profile-save', settings: snapshot() }).catch(() => {}), 800);
    },
  };
}
