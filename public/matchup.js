// Matchup-vyn: inklistrade Yahoo-trupper (mitt lag + motståndaren) och veckans kategorier live
// ur NHL:s statistik (/api/fstats per dag, måndag–söndag östkusttid).
import { parsePaste, countedStats, counts, snapshot, statIndex, sumLines, teamTotals, comparePoints, fantasyPoints, catValue, fmtCat, CATS, POINTS, DEFAULT_SK, DEFAULT_G } from './roster.js';

const KEY = { me: 'rs.roster.me', opp: 'rs.roster.opp' };
const etToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const addDays = (ymd, n) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const sgn = (x) => `${x < 0 ? '−' : '+'} ${Math.abs(x).toFixed(1)}`;
const dayFmt = new Intl.DateTimeFormat('sv-SE', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' });

export function weekOf(today) {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = sön
  const start = addDays(today, -((dow + 6) % 7));
  return { start, end: addDays(start, 6) };
}

export function initMatchup({ store, esc, onChange }) {
  const root = document.querySelector('#matchupView');
  const m = {
    rosters: { me: store.get(KEY.me, null), opp: store.get(KEY.opp, null) }, // det som visas
    local: { me: store.get(KEY.me, null), opp: store.get(KEY.opp, null) }, // utan liga (sparas i webbläsaren)
    lg: store.get('rs.league', null), // { id, token, member }
    data: null, // ligan från servern
    viewing: null, // medlem vars matchup visas (annan än jag)
    form: null, // 'create' | 'join' | 'login:<id>'
    lmsg: '',
    busy: false,
    readonly: false,
    editing: { me: false, opp: false },
    days: new Map(), // date -> { at, data }
    remaining: null, // lag -> matcher kvar denna vecka
    timer: null,
    msg: { me: '', opp: '' },
    picking: { me: false, opp: false }, // spelarväljaren öppen
    query: { me: '', opp: '' },
    pool: null, // alla NHL-spelare (/api/players)
  };

  const visible = () => document.body.dataset.view === 'matchup';

  // Delad ligalänk: /?liga=<id>
  let openOnStart = false;
  const qp = new URLSearchParams(location.search).get('liga');
  if (qp && /^[A-Za-z0-9_-]{8,20}$/.test(qp)) {
    if (m.lg?.id !== qp) { m.lg = { id: qp }; store.set('rs.league', m.lg); }
    const u = new URL(location.href);
    u.searchParams.delete('liga');
    history.replaceState(null, '', u.pathname + u.search + u.hash);
    openOnStart = true;
  }
  const cats = () => {
    const src = m.rosters.me?.skCats?.length ? m.rosters.me : m.rosters.opp;
    const sk = src?.skCats?.length ? src.skCats : DEFAULT_SK;
    const gs = (m.rosters.me?.gCats?.length ? m.rosters.me : m.rosters.opp)?.gCats;
    return [...sk, ...(gs?.length ? gs : DEFAULT_G)];
  };

  // ---- Liga ----
  const loggedIn = () => !!(m.lg?.token && m.lg?.member && m.data?.members?.some((x) => x.id === m.lg.member));
  const memberOf = (id) => m.data?.members?.find((x) => x.id === id);
  /** Mina lag: från ligan när jag är inloggad, annars de lokalt sparade. */
  function myRosters() {
    if (loggedIn()) {
      const me = memberOf(m.lg.member);
      return { me: m.data.rosters?.[me.id] || null, opp: (me.opp && m.data.rosters?.[me.opp]) || null };
    }
    return m.local;
  }
  function deriveRosters() {
    if (m.viewing && m.data && m.viewing !== m.lg?.member) {
      const mem = memberOf(m.viewing);
      m.rosters = { me: m.data.rosters?.[m.viewing] || null, opp: (mem?.opp && m.data.rosters?.[mem.opp]) || null };
      m.readonly = true;
    } else {
      m.viewing = null;
      m.rosters = { ...myRosters() };
      m.readonly = false;
    }
  }

  async function api(body) {
    const r = await fetch('/api/league', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(m.lg?.token ? { Authorization: `Bearer ${m.lg.token}` } : {}) },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || `Fel ${r.status}`), { status: r.status });
    return j;
  }

  async function loadLeague() {
    if (!m.lg?.id) return;
    try {
      const r = await fetch(`/api/league?id=${encodeURIComponent(m.lg.id)}`);
      if (r.status === 404) { m.lmsg = 'Ligan finns inte längre.'; m.lg = null; store.set('rs.league', null); }
      else if (r.ok) m.data = await r.json();
    } catch { /* behåll det vi har */ }
    deriveRosters();
    onChange(myRosters());
    if (visible()) render();
  }

  function setLeague(lg) {
    m.lg = lg;
    store.set('rs.league', lg);
  }

  let syncTimer = null;
  function syncSoon() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
      try {
        const j = await api({ action: 'save', id: m.lg.id, me: m.rosters.me, opp: m.rosters.opp });
        m.data = j.league;
        m.lmsg = '';
      } catch (e) {
        m.lmsg = e.status === 401 ? 'Du är utloggad – logga in igen för att spara.' : `Kunde inte spara: ${e.message}`;
        if (e.status === 401) setLeague({ id: m.lg.id });
        if (visible()) render();
      }
    }, 400);
  }

  function save(side, roster) {
    if (m.readonly) return;
    m.rosters[side] = roster;
    if (loggedIn()) {
      // Uppdatera den lokala kopian av ligan direkt och spara på servern
      const me = memberOf(m.lg.member);
      m.data.rosters ||= {};
      if (side === 'me') m.data.rosters[me.id] = roster;
      else { me.opp ||= `t:local`; m.data.rosters[me.opp] = roster; }
      syncSoon();
    } else {
      m.local[side] = roster;
      store.set(KEY[side], roster);
    }
    onChange(myRosters());
  }

  function leagueBar() {
    const link = m.lg?.id ? `${location.origin}/?liga=${m.lg.id}` : '';
    const msg = m.lmsg ? `<p class="mu-msg">${esc(m.lmsg)}</p>` : '';
    if (!m.lg?.id) {
      if (m.form === 'create') {
        return `<section class="mu-league"><form data-form="create" class="mu-form">
          <b>Ny liga</b><input name="name" placeholder="Ligans namn" maxlength="60" required>
          <button class="mu-btn" ${m.busy ? 'disabled' : ''}>Skapa</button><button type="button" class="mu-btn ghost" data-lform="">Avbryt</button></form>${msg}</section>`;
      }
      return `<section class="mu-league"><div class="mu-lrow"><span>Spela med ligan: skapa en liga och dela länken, så kan alla lägga in sina lag och se varandras matchups.</span>
        <button class="mu-btn" data-lform="create">Skapa liga</button></div>${msg}</section>`;
    }
    const name = m.data?.name || 'Ligan';
    const members = m.data?.members || [];
    if (loggedIn()) {
      const me = memberOf(m.lg.member);
      const opts = members.map((x) => `<option value="${esc(x.id)}" ${(m.viewing || m.lg.member) === x.id ? 'selected' : ''}>${esc(x.team)}${x.id === m.lg.member ? ' (jag)' : ''}</option>`).join('');
      return `<section class="mu-league"><div class="mu-lrow">
        <div class="mu-lname"><b>${esc(name)}</b><span>Inloggad som ${esc(me.team)} · ${members.length} lag</span></div>
        <label class="mu-view">Visa <select data-view-member>${opts}</select></label>
        <button class="mu-btn" data-copy="${esc(link)}">Kopiera länk</button>
        <button class="mu-btn ghost" data-logout>Logga ut</button></div>${msg}</section>`;
    }
    // Liga vald men inte inloggad
    const local = m.local.me?.team || '';
    let form = '';
    if (m.form === 'join') {
      form = `<form data-form="join" class="mu-form"><b>Nytt lag i ligan</b>
        <input name="team" placeholder="Lagets namn (som i Yahoo)" value="${esc(local)}" maxlength="60" required>
        <input name="manager" placeholder="Ditt namn" maxlength="40">
        <input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" placeholder="Välj PIN (4–8 siffror)" required autocomplete="new-password">
        <button class="mu-btn" ${m.busy ? 'disabled' : ''}>Gå med</button><button type="button" class="mu-btn ghost" data-lform="">Avbryt</button></form>`;
    } else if (m.form?.startsWith('login:')) {
      const mem = memberOf(m.form.slice(6));
      form = `<form data-form="login" data-member="${esc(mem?.id || '')}" class="mu-form"><b>Logga in som ${esc(mem?.team || '')}</b>
        <input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" placeholder="PIN" required autocomplete="current-password">
        <button class="mu-btn" ${m.busy ? 'disabled' : ''}>Logga in</button><button type="button" class="mu-btn ghost" data-lform="">Avbryt</button></form>`;
    }
    const chips = members.map((x) => `<button class="mu-chip" data-lform="login:${esc(x.id)}" title="Logga in som ${esc(x.team)}">${esc(x.team)}${x.manager ? ` <small>${esc(x.manager)}</small>` : ''}</button>`).join('');
    return `<section class="mu-league"><div class="mu-lrow">
        <div class="mu-lname"><b>${esc(name)}</b><span>${members.length ? 'Välj ditt lag och logga in med din PIN – eller lägg till ditt lag.' : 'Inga lag än – lägg till ditt.'}</span></div>
        <button class="mu-btn" data-lform="join">+ Mitt lag</button>
        <button class="mu-btn ghost" data-copy="${esc(link)}">Kopiera länk</button>
        <button class="mu-btn ghost" data-leave title="Lämna ligan på den här enheten">Lämna</button></div>
      ${members.length ? `<div class="mu-chips">${chips}</div>` : ''}${form}${msg}</section>`;
  }

  async function submitForm(f) {
    const v = Object.fromEntries(new FormData(f));
    m.busy = true; m.lmsg = ''; render();
    try {
      if (f.dataset.form === 'create') {
        const { id } = await api({ action: 'create', name: v.name });
        setLeague({ id });
        m.form = 'join';
        m.lmsg = 'Ligan är skapad. Lägg till ditt lag och dela sedan länken med ligan.';
        await loadLeague();
      } else if (f.dataset.form === 'join' || f.dataset.form === 'login') {
        const body = f.dataset.form === 'join'
          ? { action: 'join', id: m.lg.id, team: v.team, manager: v.manager, pin: v.pin }
          : { action: 'login', id: m.lg.id, member: f.dataset.member, pin: v.pin };
        const j = await api(body);
        setLeague({ id: m.lg.id, token: j.token, member: j.member });
        m.data = j.league;
        m.form = null;
        // Första gången: ta med de lokalt inlagda lagen till ligan
        const mine = j.league.rosters?.[j.member];
        if (!mine && m.local.me) {
          await api({ action: 'save', id: m.lg.id, me: m.local.me, opp: m.local.opp }).then((r) => { m.data = r.league; }).catch(() => {});
        }
        m.lmsg = f.dataset.form === 'join' ? 'Du är med i ligan. Dina lag sparas nu i ligan och syns på alla dina enheter.' : '';
        deriveRosters();
        onChange(myRosters());
        load();
      }
    } catch (e) {
      m.lmsg = e.message;
    } finally {
      m.busy = false;
      render();
    }
  }


  function handlePaste(side, text) {
    const teams = parsePaste(text);
    if (!teams.length) {
      m.msg[side] = 'Hittade inga spelare. Kopiera hela matchup-sidan eller lagsidan på Yahoo (markera allt, kopiera) och klistra in igen.';
      render();
      return;
    }
    const stamp = { pastedAt: new Date().toISOString(), week: weekOf(etToday()).start };
    const summary = (r) => {
      const g = r.players.filter((p) => p.goalie).length;
      return `${r.players.length} spelare inlästa (${r.players.length - g} utespelare, ${g} målvakter)${r.total != null ? ` · Yahoo ${r.total.toFixed(2)} p` : ''}.`;
    };
    if (teams.length >= 2) {
      // Matchup-sidan: båda lagen på en gång. Ditt lag står först – om inte namnet säger annat.
      let [a, b] = teams;
      if (m.rosters.me?.team && b.team === m.rosters.me.team) [a, b] = [b, a];
      save('me', { ...a, ...stamp }); save('opp', { ...b, ...stamp });
      m.editing.me = m.editing.opp = false;
      m.msg.me = summary(a); m.msg.opp = summary(b);
    } else {
      save(side, { ...teams[0], ...stamp });
      m.editing[side] = false;
      m.msg[side] = summary(teams[0]);
    }
    render();
    load();
  }

  // Yahoos siffror gäller bara veckan de klistrades in
  const hasBase = (r) => r && r.total != null && r.week === weekOf(etToday()).start;
  /** Statistik som ska räknas för spelaren: allt (utan Yahoo-bas) eller bara det som hänt efter inklistringen. */
  const counted = (r, p, s) => countedStats(p, s, hasBase(r));
  /** Spelarens poäng för veckan. */
  function playerFp(r, p, s) {
    const c = counted(r, p, s);
    if (hasBase(r) && p.fp != null) return Math.round((p.fp + (c ? fantasyPoints(c, p.goalie) : 0)) * 100) / 100;
    return c ? fantasyPoints(c, p.goalie) : null;
  }

  // ---- Data ----
  async function fetchDay(date, force) {
    const c = m.days.get(date);
    const today = etToday();
    const fresh = c && (date < today ? Date.now() - c.at < 30 * 60_000 : Date.now() - c.at < 45_000);
    if (c && fresh && !force) return c.data;
    const r = await fetch(`/api/fstats?date=${date}`);
    if (!r.ok) throw new Error(r.status);
    const data = await r.json();
    m.days.set(date, { at: Date.now(), data });
    return data;
  }

  async function load() {
    if (!m.rosters.me && !m.rosters.opp) return;
    const today = etToday();
    const { start, end } = weekOf(today);
    const dates = [];
    for (let d = start; d <= end && d <= today; d = addDays(d, 1)) dates.push(d);
    try {
      await Promise.all(dates.map((d) => fetchDay(d)));
      m.error = null;
    } catch {
      m.error = 'Kunde inte hämta statistiken just nu. Försöker igen om en stund.';
    }
    if (!m.remaining) loadRemaining();
    if (visible()) render();
    clearTimeout(m.timer);
    const live = m.days.get(today)?.data?.players?.some((p) => p.live);
    if (visible()) m.timer = setTimeout(load, live ? 30_000 : 120_000);
  }

  async function loadRemaining() {
    try {
      const r = await fetch('/api/week?week=current');
      const w = await r.json();
      m.remaining = new Map(w.teams.map((t) => [t.abbrev, t.games.filter((g) => g.state !== 'final').length]));
      if (visible()) render();
    } catch { m.remaining = new Map(); }
  }

  // ---- Rendering ----
  function statsFor() {
    const { start } = weekOf(etToday());
    const days = [...m.days.entries()].filter(([d]) => d >= start).map(([, v]) => v.data);
    const lines = sumLines(days);
    const idx = statIndex(lines);
    const byId = new Map(lines.map((l) => [l.id, l]));
    const map = new Map();
    for (const side of ['me', 'opp']) {
      for (const p of m.rosters[side]?.players || []) {
        const id = p.id && byId.has(p.id) ? p.id : idx.find(p.team, p.name);
        if (id) map.set(p, byId.get(id));
      }
    }
    return map;
  }

  function line(p, s, list) {
    if (!s) return '<span class="mu-none">Ingen match än</span>';
    const parts = [];
    for (const cat of list) {
      const c = CATS[cat];
      if (!!c.goalie !== p.goalie || c.ratio) continue;
      const v = catValue(cat, s);
      if (v) parts.push(`<b>${cat === '+/-' && v > 0 ? '+' : ''}${v}</b> ${esc(cat)}`);
    }
    if (p.goalie && s.sa) parts.push(`<b>${fmtCat(s.sv / s.sa, 3)}</b> SV%`);
    const gp = `${s.gp} ${s.gp === 1 ? 'match' : 'matcher'}`;
    return `${s.live ? '<span class="dot" title="Spelar nu"></span>' : ''}<span class="mu-gp">${gp}</span>${parts.length ? ' · ' + parts.join(' · ') : ''}`;
  }

  const hhmm = (iso) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString('sv-SE', { weekday: 'short' })} ${d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}`;
  };

  // ---- Spelarväljare ----
  function picker(side) {
    if (!m.picking[side]) return '';
    return `<div class="mu-picker">
      <div class="mu-search"><input type="search" data-q="${side}" value="${esc(m.query[side])}" placeholder="Sök spelare eller lag (t.ex. Pastrnak, BOS)" autocomplete="off" enterkeyhint="search">
        <button class="mu-btn ghost" data-pickclose="${side}">Stäng</button></div>
      <ul class="mu-results" data-results="${side}">${results(side)}</ul>
    </div>`;
  }

  const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  function results(side) {
    if (!m.pool) return '<li class="mu-none">Hämtar spelare…</li>';
    const q = norm(m.query[side]).trim();
    if (q.length < 2) return '<li class="mu-none">Skriv minst två bokstäver.</li>';
    const taken = new Set(['me', 'opp'].flatMap((x) => (m.rosters[x]?.players || []).filter((p) => !p.to && p.slot !== '--').map((p) => `${p.team}|${norm(p.name)}`)));
    const words = q.split(/\s+/);
    const hits = m.pool.filter((p) => { const h = norm(`${p.name} ${p.team}`); return words.every((w) => h.includes(w)); }).slice(0, 12);
    if (!hits.length) return '<li class="mu-none">Ingen träff.</li>';
    return hits.map((p) => {
      const has = taken.has(`${p.team}|${norm(p.name)}`);
      return `<li><div class="mu-p"><div class="mu-n">${esc(p.name)} <span class="mu-tm">${esc(p.team)} · ${esc(p.pos)}</span></div></div>
        ${has ? '<span class="mu-none">I ett lag</span>' : `<button class="mu-btn" data-add="${side}:${p.id}:1">Aktiv</button><button class="mu-btn ghost" data-add="${side}:${p.id}:0">Bänk</button>`}</li>`;
    }).join('');
  }

  async function loadPool() {
    if (m.pool) return;
    try {
      const r = await fetch('/api/players');
      if (!r.ok) throw new Error(r.status);
      m.pool = (await r.json()).players;
    } catch { m.pool = null; m.error = 'Kunde inte hämta spelarlistan.'; }
    for (const side of ['me', 'opp']) {
      const el = root.querySelector(`[data-results="${side}"]`);
      if (el) el.innerHTML = results(side);
    }
  }

  /** Ögonblicksbild av spelarens veckostatistik just nu (eller nollor om han inte spelat). */
  function nowStats(p) {
    const s = statsFor().get(p);
    return snapshot(s || {});
  }

  function addPlayer(side, id, active) {
    const src = m.pool?.find((p) => p.id === id);
    if (!src) return;
    let r = m.rosters[side];
    if (!r) r = { team: '', players: [], skCats: [], gCats: [], pastedAt: new Date().toISOString(), week: weekOf(etToday()).start };
    const goalie = src.pos === 'G';
    const p = { id: src.id, name: src.name, team: src.team, pos: [src.pos], goalie, status: '',
      slot: active ? (goalie ? 'G' : src.pos) : 'BN', active: !!active, addedAt: new Date().toISOString() };
    // Bara det som händer efter att spelaren plockats räknas
    p.from = nowStats(p);
    r = { ...r, players: [...r.players, p] };
    save(side, r);
    m.msg[side] = `${src.name} tillagd${active ? '' : ' på bänken'}.`;
    render();
    root.querySelector(`[data-q="${side}"]`)?.focus();
  }

  function dropPlayer(side, i) {
    const r = m.rosters[side];
    const p = r?.players[i];
    if (!p) return;
    const to = nowStats(p);
    const np = { ...p, to, wasActive: p.active, prevSlot: p.slot, slot: '--', active: false, droppedAt: new Date().toISOString() };
    save(side, { ...r, players: r.players.map((x, k) => (k === i ? np : x)) });
    m.msg[side] = `${p.name} släppt – poängen hittills står kvar.`;
    render();
  }

  function undropPlayer(side, i) {
    const r = m.rosters[side];
    const p = r?.players[i];
    if (!p?.to) return;
    const { to, wasActive, prevSlot, droppedAt, ...rest } = p;
    save(side, { ...r, players: r.players.map((x, k) => (k === i ? { ...rest, slot: prevSlot, active: !!wasActive } : x)) });
    m.msg[side] = `${p.name} är tillbaka i laget.`;
    render();
  }

  function deletePlayer(side, i) {
    const r = m.rosters[side];
    const p = r?.players[i];
    if (!p) return;
    save(side, { ...r, players: r.players.filter((_, k) => k !== i) });
    m.msg[side] = `${p.name} borttagen.`;
    render();
  }

  function teamCard(side, stats, list) {
    const r = m.rosters[side];
    const label = m.readonly ? (side === 'me' ? 'Lag' : 'Motståndare') : side === 'me' ? 'Mitt lag' : 'Motståndaren';
    const msg = m.msg[side] ? `<p class="mu-msg">${esc(m.msg[side])}</p>` : '';
    if (!r || m.editing[side]) {
      return `<section class="mu-team ${side}">
        <header><span class="mu-dot"></span><h3>${label}</h3>${r ? `<button class="mu-btn ghost" data-cancel="${side}">Avbryt</button>` : ''}</header>
        ${msg}
        <textarea class="mu-paste" data-paste="${side}" rows="6" placeholder="Klistra in matchup-sidan från Yahoo (fyller i båda lagen) – eller ${side === 'me' ? 'din' : 'motståndarens'} lagsida."></textarea>
        <p class="mu-hint">Inläsningen sker direkt när du klistrar in. ${r ? '' : `Eller <button class="textbtn" data-pick="${side}">välj spelare själv</button>.`}</p>
        ${r ? '' : picker(side)}
      </section>`;
    }
    const rows = r.players.map((p) => {
      const left = m.remaining?.get(p.team);
      const s = stats.get(p);
      const fp = playerFp(r, p, s);
      const i = r.players.indexOf(p);
      const tag = p.to ? `<span class="mu-tag">Släppt ${esc(hhmm(p.droppedAt))}</span>` : p.from ? `<span class="mu-tag add">Plockad ${esc(hhmm(p.addedAt))}</span>` : '';
      const act = p.to
        ? `<button class="mu-x" data-undrop="${side}:${i}" title="Ångra släppet">↺</button><button class="mu-x" data-del="${side}:${i}" title="Ta bort helt (t.ex. om spelaren lades till av misstag)">🗑</button>`
        : p.slot === '--' ? '' : `<button class="mu-x" data-drop="${side}:${i}" title="Släpp spelaren – poängen hittills står kvar">×</button>`;
      return `<li class="${p.active ? '' : 'bench'}${p.to || p.slot === '--' ? ' dropped' : ''}">
        <span class="mu-slot">${esc(p.slot || '–')}</span>
        <div class="mu-p">
          <div class="mu-n">${esc(p.name)} <span class="mu-tm">${esc(p.team)} · ${esc(p.pos.join(','))}</span>${p.status ? ` <span class="mu-st">${esc(p.status)}</span>` : ''} ${tag}</div>
          <div class="mu-l">${p.slot === '--' && !p.to ? '<span class="mu-none">Släppt – poängen räknas för tiden i laget</span>' : line(p, s, list)}</div>
        </div>
        <div class="mu-r">${fp != null ? `<b class="mu-fp${fp < 0 ? ' neg' : ''}" title="Fantasypoäng denna vecka">${fp.toFixed(1)}</b>` : ''}${left != null && !p.to && p.slot !== '--' ? `<span class="mu-left" title="Matcher kvar denna vecka">${left} kvar</span>` : ''}</div>
        ${act}
      </li>`;
    }).join('');
    const pasted = new Date(r.pastedAt);
    const when = `inklistrad ${pasted.toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'numeric' })} ${pasted.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}`;
    const stale = r.week && r.week !== weekOf(etToday()).start
      ? '<p class="mu-msg warn">Truppen är från en tidigare vecka – klistra in veckans matchup.</p>' : '';
    return `<section class="mu-team ${side}">
      <header><span class="mu-dot"></span><div class="mu-tt"><h3>${esc(r.team || label)}</h3><span>${label} · ${when}</span></div>
        <button class="mu-btn" data-pick="${side}">+ Spelare</button>
        <button class="mu-btn" data-edit="${side}">Klistra in nytt</button>
        <button class="mu-btn ghost" data-clear="${side}">Rensa</button></header>
      ${stale}${msg}${picker(side)}
      <ul class="mu-list">${rows}</ul>
    </section>`;
  }

  function render() {
    deriveRosters();
    const { start, end } = weekOf(etToday());
    const list = cats();
    const stats = statsFor();
    const has = m.rosters.me && m.rosters.opp;
    let board = '';
    if (has) {
      const eff = (r) => new Map(r.players.map((p) => [p, counted(r, p, stats.get(p))]).filter(([, c]) => c));
      const rm = m.rosters.me, ro = m.rosters.opp;
      const me = teamTotals(rm, eff(rm)), opp = teamTotals(ro, eff(ro));
      const { rows, total: live } = comparePoints(POINTS, me, opp);
      const bm = hasBase(rm) ? rm.total : 0, bo = hasBase(ro) ? ro.total : 0;
      const total = { me: Math.round((bm + live.me) * 100) / 100, opp: Math.round((bo + live.opp) * 100) / 100 };
      const based = hasBase(rm) || hasBase(ro);
      const at = (r) => new Date(r.pastedAt).toLocaleTimeString('sv-SE', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
      const lead = total.me > total.opp ? 'me' : total.opp > total.me ? 'opp' : '';
      board = `<section class="mu-board">
        <div class="mu-score"><div><span>${esc(m.rosters.me.team || 'Mitt lag')}</span><b class="me${lead === 'me' ? ' lead' : ''}">${total.me.toFixed(1)}</b></div>
          <i>poäng</i>
          <div><b class="opp${lead === 'opp' ? ' lead' : ''}">${total.opp.toFixed(1)}</b><span>${esc(m.rosters.opp.team || 'Motståndaren')}</span></div></div>
        ${based ? `<p class="mu-base"><span>Yahoo ${bm.toFixed(2)} <b>${sgn(live.me)}</b></span><span>live sedan ${esc(at(rm))}</span><span>Yahoo ${bo.toFixed(2)} <b>${sgn(live.opp)}</b></span></p>` : ''}
        ${based ? '<h4 class="mu-sub">Sedan inklistringen</h4>' : ''}
        <table class="mu-cats"><tbody>${rows.map((x) => `<tr class="${x.pa === x.pb ? '' : (x.pa > x.pb ? 'w' : 'l')}">
          <td class="a">${fmtCat(x.a, 0)}<small>${x.pa ? x.pa.toFixed(1) : ''}</small></td>
          <th>${esc(x.cat)}<small>${x.w > 0 ? '+' : ''}${x.w}</small></th>
          <td class="b"><small>${x.pb ? x.pb.toFixed(1) : ''}</small>${fmtCat(x.b, 0)}</td></tr>`).join('')}</tbody></table>
        <p class="mu-note">${based
          ? 'Utgår från Yahoos poäng när matchup-sidan klistrades in och lägger till det som hänt sedan dess för spelare på aktiva platser (inte BN/IR). Klistra in igen när du ändrar laguppställningen – då stämmer det exakt med Yahoo igen.'
          : 'Bara spelare på aktiva platser räknas (inte BN/IR/NA), enligt den senast inklistrade truppen. Klistra in matchup-sidan för att utgå från Yahoos egna poäng.'}</p>
      </section>`;
    }
    root.innerHTML = `
      <div class="wk-head"><h2>Matchup</h2></div>
      ${leagueBar()}
      ${m.readonly ? `<p class="mu-msg">Du tittar på ${esc(memberOf(m.viewing)?.team || '')}s matchup.</p>` : ''}
      <p class="wk-sub">Vecka ${dayFmt.format(new Date(`${start}T12:00:00Z`))} – ${dayFmt.format(new Date(`${end}T12:00:00Z`))} · statistik från NHL, uppdateras live${m.error ? ` · <span class="mu-err">${esc(m.error)}</span>` : ''}</p>
      <div class="mu-grid${m.readonly ? ' mu-ro' : ''}">${board}${teamCard('me', stats, list)}${teamCard('opp', stats, list)}</div>`;
  }

  // ---- Händelser ----
  root.addEventListener('paste', (e) => {
    const ta = e.target.closest('[data-paste]');
    if (!ta) return;
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') || '';
    handlePaste(ta.dataset.paste, text);
  });
  root.addEventListener('input', (e) => {
    const q = e.target.closest('[data-q]');
    if (q) {
      m.query[q.dataset.q] = q.value;
      const el = root.querySelector(`[data-results="${q.dataset.q}"]`);
      if (el) el.innerHTML = results(q.dataset.q);
      return;
    }
    // Inklistring via mobilens meny eller dra-och-släpp ger inte alltid ett paste-event
    const ta = e.target.closest('[data-paste]');
    if (ta && ta.value.length > 40) handlePaste(ta.dataset.paste, ta.value);
  });
 root.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-form]');
    if (!f) return;
    e.preventDefault();
    submitForm(f);
  });
  root.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-view-member]');
    if (!sel) return;
    m.viewing = sel.value === m.lg?.member ? null : sel.value;
    render();
  });
  root.addEventListener('click', (e) => {
    const lf = e.target.closest('[data-lform]');
    if (lf) { m.form = lf.dataset.lform || null; m.lmsg = ''; render(); root.querySelector('.mu-form input')?.focus(); return; }
    const cp = e.target.closest('[data-copy]');
    if (cp) {
      const url = cp.dataset.copy;
      (navigator.share && matchMedia('(pointer: coarse)').matches
        ? navigator.share({ title: m.data?.name || 'Liga', url }).catch(() => {})
        : navigator.clipboard?.writeText(url).then(() => { m.lmsg = 'Länken är kopierad – dela den med ligan.'; render(); }, () => { m.lmsg = url; render(); }));
      return;
    }
    if (e.target.closest('[data-logout]')) {
      setLeague({ id: m.lg.id }); m.viewing = null; m.lmsg = 'Utloggad.'; render(); onChange(myRosters()); return;
    }
    if (e.target.closest('[data-leave]')) {
      setLeague(null); m.data = null; m.viewing = null; m.form = null; m.lmsg = ''; render(); onChange(myRosters()); return;
    }
    const arg = (attr) => { const el = e.target.closest(`[${attr}]`); return el ? el.getAttribute(attr).split(':') : null; };
    let a;
    if ((a = arg('data-pick'))) {
      m.picking[a[0]] = true; render(); loadPool();
      root.querySelector(`[data-q="${a[0]}"]`)?.focus();
      return;
    }
    if ((a = arg('data-pickclose'))) { m.picking[a[0]] = false; m.query[a[0]] = ''; render(); return; }
    if ((a = arg('data-add'))) { addPlayer(a[0], Number(a[1]), a[2] === '1'); return; }
    if ((a = arg('data-drop'))) { dropPlayer(a[0], Number(a[1])); return; }
    if ((a = arg('data-undrop'))) { undropPlayer(a[0], Number(a[1])); return; }
    if ((a = arg('data-del'))) { deletePlayer(a[0], Number(a[1])); return; }
    const ed = e.target.closest('[data-edit]');
    if (ed) { m.editing[ed.dataset.edit] = true; m.msg[ed.dataset.edit] = ''; render(); root.querySelector(`[data-paste="${ed.dataset.edit}"]`)?.focus(); return; }
    const cl = e.target.closest('[data-clear]');
    if (cl) {
      const side = cl.dataset.clear;
      save(side, null);
      m.msg[side] = 'Laget är rensat – klistra in ett nytt.';
      render();
      root.querySelector(`[data-paste="${side}"]`)?.focus();
      return;
    }
    const ca = e.target.closest('[data-cancel]');
    if (ca) { m.editing[ca.dataset.cancel] = false; m.msg[ca.dataset.cancel] = ''; render(); }
  });

  return {
    rosters: () => myRosters(),
    openOnStart,
    init() { if (m.lg?.id) loadLeague(); },
    show() { render(); load(); loadLeague(); },
    hide() { clearTimeout(m.timer); },
  };
}
