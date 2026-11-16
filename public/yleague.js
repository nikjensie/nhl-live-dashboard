// Fantasy-kolumnen: veckans matchups i en eller två Yahoo-ligor, lästa från Yahoos publika
// ligasidor via /api/league?yahoo=<id> (cachas 5 min). Väljer man sitt lag hämtas lagets och
// motståndarens trupper (/api/league?yahoo=<id>&team=<n>) och spelarna markeras i appen:
// liga 1 orange/ljusblå, liga 2 röd/mörkblå.

const REFRESH_MS = 5 * 60_000;
const MAX = 2;

export function initYLeague({ store, esc, onRosters }) {
  const el = document.querySelector('#fantasy');

  // Sparade ligor: [{ id, team }]. Flytta över det gamla formatet (en liga).
  let saved = store.get('rs.yleagues', null);
  if (!Array.isArray(saved)) {
    const id = store.get('rs.yleague', '10098');
    saved = id ? [{ id: String(id), team: store.get('rs.yteam', null) }] : [];
  }
  const y = {
    leagues: saved.slice(0, MAX).map((l) => ({ id: String(l.id), team: l.team ?? null, data: null, error: '', rosters: null })),
    form: null, // null | 'add' | index som byts
    timer: null,
  };
  const persist = () => store.set('rs.yleagues', y.leagues.map(({ id, team }) => ({ id, team })));

  const myMatchup = (L) => L.data?.matchups.find((m) => m.teams.some((t) => String(t.id) === String(L.team)));

  function emit() {
    const leagues = y.leagues.map((L, i) => L.rosters && {
      key: `y${L.id}`, name: L.data?.name || `Liga ${L.id}`, alt: i === 1, me: { players: L.rosters.me }, opp: { players: L.rosters.opp },
    }).filter(Boolean);
    onRosters(leagues.length ? { loggedIn: true, leagues } : null);
  }

  async function fetchJson(url) {
    const r = await fetch(url);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.status);
    return j;
  }

  async function loadRosters(L) {
    const mu = myMatchup(L);
    if (!mu) { L.rosters = null; emit(); return; }
    const me = mu.teams.find((t) => String(t.id) === String(L.team));
    const opp = mu.teams.find((t) => t !== me);
    try {
      const [a, b] = await Promise.all([
        fetchJson(`/api/league?yahoo=${L.id}&team=${me.id}`), fetchJson(`/api/league?yahoo=${L.id}&team=${opp.id}`),
      ]);
      L.rosters = { me: a.players, opp: b.players };
    } catch (e) {
      L.error = `Kunde inte läsa trupperna: ${e.message}`;
    }
    emit();
    render();
  }

  async function loadLeague(L) {
    try {
      L.data = await fetchJson(`/api/league?yahoo=${L.id}`);
      L.error = '';
    } catch (e) {
      L.error = `Kunde inte hämta ligan från Yahoo: ${e.message}`;
    }
    render();
    if (L.team) loadRosters(L);
  }

  async function load() {
    clearTimeout(y.timer);
    await Promise.all(y.leagues.map(loadLeague));
    render();
    y.timer = setTimeout(load, REFRESH_MS);
  }

  const pts = (n) => (n == null ? '–' : n.toFixed(2));
  function teamRow(L, i, t, other, mu, top) {
    const mine = mu.teams.some((x) => String(x.id) === String(L.team));
    const side = String(t.id) === String(L.team) ? 'me' : mine ? 'opp' : '';
    const has = t.points != null && other.points != null && t.points !== other.points;
    const res = has ? (t.points > other.points ? ' win' : ' lose') : '';
    return `<div class="yl-team ${side}${side && i === 1 ? ' alt' : ''}${res}">
      <div class="yl-name"><b>${esc(t.name)}</b><span>${esc(t.record)}${t.rank ? ` · ${esc(t.rank)}` : ''}</span></div>
      <div class="yl-pts"><b>${t.points != null && t.points === top ? '<span class="yl-star" title="Veckans högsta poäng i ligan">⭐</span>' : ''}${pts(t.points)}</b><span title="Yahoos prognos">${pts(t.proj)}</span></div>
    </div>`;
  }

  function form(kind, value = '') {
    return `<form class="yl-form" data-yl-form="${kind}">
      <label>${kind === 'add' ? 'Lägg till Yahoo-liga – ID' : 'Yahoo-ligans ID'}<input name="league" inputmode="numeric" pattern="[0-9]+" value="${esc(value)}" placeholder="t.ex. 10098" required></label>
      <p>Ligan måste vara publik hos Yahoo. ID:t är siffrorna i adressen, t.ex. hockey.fantasysports.yahoo.com/hockey/<b>10098</b>.</p>
      <div class="yl-actions"><button class="btn">${kind === 'add' ? 'Lägg till' : 'Visa ligan'}</button>${y.leagues.length ? '<button type="button" class="mu-btn ghost" data-yl-cancel>Avbryt</button>' : ''}</div></form>`;
  }

  function section(L, i) {
    if (y.form === i) return form(i, L.id);
    const head = (name, week) => `<div class="yl-head">
        <div><b><i class="yl-dot${i === 1 ? ' alt' : ''}"></i>${esc(name)}</b><span>${week}</span></div>
        ${L.data ? `<label class="yl-pick">Mitt lag <select data-yl-team="${i}"><option value="">Välj…</option>${
          L.data.matchups.flatMap((m) => m.teams).sort((a, b) => a.name.localeCompare(b.name, 'sv'))
            .map((t) => `<option value="${t.id}" ${String(t.id) === String(L.team) ? 'selected' : ''}>${esc(t.name)}</option>`).join('')
        }</select></label>` : ''}
      </div>`;
    if (!L.data) {
      return `<section class="yl-league">${head(`Liga ${L.id}`, L.error ? '' : 'Hämtar…')}
        ${L.error ? `<p class="mu-msg">${esc(L.error)}</p>` : ''}
        <p class="yl-foot"><button class="textbtn" data-yl-edit="${i}">Byt liga</button> · <button class="textbtn" data-yl-remove="${i}">Ta bort</button></p></section>`;
    }
    const mine = myMatchup(L);
    const list = [...L.data.matchups].sort((a, b) => (b === mine) - (a === mine));
    // Veckans högsta poäng i ligan får en stjärna (alla vid delad topp)
    const all = L.data.matchups.flatMap((m) => m.teams.map((t) => t.points)).filter((n) => n != null && n > 0);
    const top = all.length ? Math.max(...all) : null;
    const at = new Date(L.data.fetchedAt).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
    return `<section class="yl-league">${head(L.data.name || 'Ligan', `Vecka ${L.data.week ?? '–'}`)}
      ${L.error ? `<p class="mu-msg">${esc(L.error)}</p>` : ''}
      ${list.map((m) => `<a class="yl-mu${m === mine ? ` mine${i === 1 ? ' alt' : ''}` : ''}" href="${esc(m.url)}" target="_blank" rel="noopener">
        ${teamRow(L, i, m.teams[0], m.teams[1], m, top)}${teamRow(L, i, m.teams[1], m.teams[0], m, top)}</a>`).join('')}
      <p class="yl-foot">Från Yahoo kl. ${at} · <button class="textbtn" data-yl-edit="${i}">Byt liga</button>${y.leagues.length > 1 ? ` · <button class="textbtn" data-yl-remove="${i}">Ta bort</button>` : ''}</p>
    </section>`;
  }

  function render() {
    if (!el) return;
    if (!y.leagues.length) { el.innerHTML = form('add'); return; }
    el.innerHTML = y.leagues.map(section).join('')
      + (y.form === 'add' ? form('add')
        : y.leagues.length < MAX ? '<p class="yl-foot yl-add"><button class="textbtn" data-yl-add>+ Lägg till liga</button></p>' : '')
      + '<p class="yl-foot">Uppdateras var 5:e minut · stor siffra = poäng, liten = Yahoos prognos</p>';
  }

  el?.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-yl-team]');
    if (!sel) return;
    const L = y.leagues[+sel.dataset.ylTeam];
    L.team = sel.value || null;
    L.rosters = null;
    persist();
    emit();
    render();
    if (L.team) loadRosters(L);
  });
  el?.addEventListener('click', (e) => {
    const t = e.target.closest('[data-yl-edit],[data-yl-remove],[data-yl-add],[data-yl-cancel]');
    if (!t) return;
    e.preventDefault();
    if (t.dataset.ylEdit != null) y.form = +t.dataset.ylEdit;
    else if (t.dataset.ylAdd != null) y.form = 'add';
    else if (t.dataset.ylCancel != null) y.form = null;
    else if (t.dataset.ylRemove != null) { y.leagues.splice(+t.dataset.ylRemove, 1); persist(); emit(); }
    render();
    el.querySelector('form input')?.focus();
  });
  el?.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-yl-form]');
    if (!f) return;
    e.preventDefault();
    const id = String(new FormData(f).get('league') || '').trim();
    if (!/^\d+$/.test(id)) return;
    const kind = f.dataset.ylForm;
    if (y.leagues.some((L, i) => L.id === id && String(i) !== kind)) { y.form = null; render(); return; } // redan med
    let L;
    if (kind === 'add') {
      if (y.leagues.length >= MAX) return;
      L = { id, team: null, data: null, error: '', rosters: null };
      y.leagues.push(L);
    } else {
      L = y.leagues[+kind];
      if (L.id !== id) Object.assign(L, { id, team: null, data: null, error: '', rosters: null });
    }
    y.form = null;
    persist();
    emit();
    render();
    loadLeague(L);
  });

  return {
    start: load,
    refresh() {
      const stale = y.leagues.some((L) => !L.data || Date.now() - Date.parse(L.data.fetchedAt) > REFRESH_MS);
      if (stale) load();
    },
  };
}
