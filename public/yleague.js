// Fantasy-kolumnen: veckans matchups i en Yahoo-liga, lästa från Yahoos publika ligasida
// via /api/league?yahoo=<id> (cachas 5 min). Väljer man sitt lag hämtas lagets och
// motståndarens trupper (/api/league?yahoo=<id>&team=<n>) och spelarna markeras i appen.

const REFRESH_MS = 5 * 60_000;

export function initYLeague({ store, esc, onRosters }) {
  const el = document.querySelector('#fantasy');
  const y = {
    league: store.get('rs.yleague', '10098'),
    team: store.get('rs.yteam', null), // Yahoo-lagets nummer i ligan
    data: null,
    error: '',
    rosters: null, // { me, opp } med spelare
    editing: false,
    timer: null,
  };

  const myMatchup = () => y.data?.matchups.find((m) => m.teams.some((t) => String(t.id) === String(y.team)));

  async function fetchRoster(id) {
    const r = await fetch(`/api/league?yahoo=${y.league}&team=${id}`);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
    return (await r.json()).players;
  }

  async function loadRosters() {
    const mu = myMatchup();
    if (!mu) { y.rosters = null; onRosters(null); return; }
    const me = mu.teams.find((t) => String(t.id) === String(y.team));
    const opp = mu.teams.find((t) => t !== me);
    try {
      const [a, b] = await Promise.all([fetchRoster(me.id), fetchRoster(opp.id)]);
      y.rosters = { me: { team: me.name, players: a }, opp: { team: opp.name, players: b } };
      onRosters({ loggedIn: true, leagues: [{ key: `y${y.league}`, name: y.data?.name || 'Yahoo', me: { players: a }, opp: { players: b } }] });
    } catch (e) {
      y.error = `Kunde inte läsa trupperna: ${e.message}`;
    }
    render();
  }

  async function load() {
    clearTimeout(y.timer);
    if (!y.league) { render(); return; }
    try {
      const r = await fetch(`/api/league?yahoo=${y.league}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.status);
      y.data = j;
      y.error = '';
    } catch (e) {
      y.error = `Kunde inte hämta ligan från Yahoo: ${e.message}`;
    }
    render();
    if (y.team) loadRosters();
    y.timer = setTimeout(load, REFRESH_MS);
  }

  const pts = (n) => (n == null ? '–' : n.toFixed(2));
  function teamRow(t, other, mu) {
    const side = String(t.id) === String(y.team) ? 'me' : mu.teams.some((x) => String(x.id) === String(y.team)) ? 'opp' : '';
    const has = t.points != null && other.points != null && t.points !== other.points;
    const res = has ? (t.points > other.points ? ' win' : ' lose') : '';
    return `<div class="yl-team ${side}${res}">
      <div class="yl-name"><b>${esc(t.name)}</b><span>${esc(t.record)}${t.rank ? ` · ${esc(t.rank)}` : ''}</span></div>
      <div class="yl-pts"><b>${pts(t.points)}</b><span title="Yahoos prognos">${pts(t.proj)}</span></div>
    </div>`;
  }

  function render() {
    if (!el) return;
    if (!y.league || y.editing) {
      el.innerHTML = `<form class="yl-form" data-yl-form>
        <label>Yahoo-ligans ID<input name="league" inputmode="numeric" pattern="[0-9]+" value="${esc(y.league || '')}" placeholder="t.ex. 10098" required></label>
        <p>Ligan måste vara publik hos Yahoo. ID:t är siffrorna i adressen, t.ex. hockey.fantasysports.yahoo.com/hockey/<b>10098</b>.</p>
        <button class="btn">Visa ligan</button></form>`;
      return;
    }
    if (!y.data) {
      el.innerHTML = y.error ? `<div class="login-card"><p>${esc(y.error)}</p><button class="mu-btn" data-yl-edit>Byt liga</button></div>` : '<div class="empty">Hämtar ligan…</div>';
      return;
    }
    const mine = myMatchup();
    const list = [...y.data.matchups].sort((a, b) => (b === mine) - (a === mine));
    const opts = y.data.matchups.flatMap((m) => m.teams).sort((a, b) => a.name.localeCompare(b.name, 'sv'))
      .map((t) => `<option value="${t.id}" ${String(t.id) === String(y.team) ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
    const at = new Date(y.data.fetchedAt).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
    el.innerHTML = `
      <div class="yl-head">
        <div><b>${esc(y.data.name || 'Ligan')}</b><span>Vecka ${y.data.week ?? '–'}</span></div>
        <label class="yl-pick">Mitt lag <select data-yl-team><option value="">Välj…</option>${opts}</select></label>
      </div>
      ${y.error ? `<p class="mu-msg">${esc(y.error)}</p>` : ''}
      ${list.map((m) => `<a class="yl-mu${m === mine ? ' mine' : ''}" href="${esc(m.url)}" target="_blank" rel="noopener">
        ${teamRow(m.teams[0], m.teams[1], m)}${teamRow(m.teams[1], m.teams[0], m)}</a>`).join('')}
      <p class="yl-foot">Från Yahoo kl. ${at}, uppdateras var 5:e minut · stor siffra = poäng, liten = Yahoos prognos ·
        <button class="textbtn" data-yl-edit>Byt liga</button></p>`;
  }

  el?.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-yl-team]');
    if (!sel) return;
    y.team = sel.value || null;
    store.set('rs.yteam', y.team);
    y.rosters = null;
    if (!y.team) onRosters(null);
    render();
    if (y.team) loadRosters();
  });
  el?.addEventListener('click', (e) => {
    if (e.target.closest('[data-yl-edit]')) { e.preventDefault(); y.editing = true; render(); el.querySelector('input')?.focus(); }
  });
  el?.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-yl-form]');
    if (!f) return;
    e.preventDefault();
    const id = String(new FormData(f).get('league') || '').trim();
    if (!/^\d+$/.test(id)) return;
    if (id !== y.league) { y.team = null; store.set('rs.yteam', null); onRosters(null); y.data = null; }
    y.league = id; store.set('rs.yleague', id);
    y.editing = false;
    load();
  });

  return {
    start: load,
    refresh() { if (!y.data || Date.now() - Date.parse(y.data.fetchedAt) > REFRESH_MS) load(); },
  };
}
