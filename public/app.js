// Rinkside – frontend. Inga beroenden.
import { demoScores, demoFantasy } from './demo.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const state = {
  date: null,               // null = idag (NHL:s "now")
  scores: null,
  fetchedAt: 0,
  fantasy: null,
  seen: null,               // Set av mål-id vi redan visat
  firstSeen: store.get('rs.firstSeen', {}), // id -> ms när vi såg målet live
  flash: new Map(),         // gameId -> { until, goal }
  newGoals: new Set(),      // id:n som ska markeras som nya i feeden
  unseenBadge: 0,
  asc: store.get('rs.asc', true),
  tab: 'games',
};

// ---------- Format ----------
const timeFmt = new Intl.DateTimeFormat('sv-SE', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' });
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, '0')}`;
const toSecs = (t) => { const m = /^(\d+):(\d{2})$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
const darkLogo = (url) => (url || '').replace(/_light\.svg$/, '_dark.svg');

function periodLabel(n, type) {
  if (type === 'SO') return 'Straffar';
  if (type === 'OT') return n > 4 ? `${n - 3}OT` : 'OT';
  return n ? `P${n}` : '';
}

function liveSecs(base, running) {
  if (base == null) return null;
  if (!running) return base;
  return Math.max(0, base - (Date.now() - state.fetchedAt) / 1000);
}

// ---------- Data ----------
async function fetchScores() {
  try {
    let data;
    if (DEMO) data = demoScores();
    else {
      const r = await fetch(`/api/scores${state.date ? `?date=${state.date}` : ''}`, { cache: 'no-store' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
      data = await r.json();
    }
    detectNewGoals(data);
    state.scores = data;
    state.fetchedAt = Date.now();
    renderAll();
  } catch (err) {
    console.error(err);
    $('#updated').textContent = 'Kunde inte uppdatera – försöker igen';
  } finally {
    clearTimeout(fetchScores.t);
    const live = state.scores?.games?.some((g) => g.state === 'live');
    fetchScores.t = setTimeout(fetchScores, DEMO ? 4_000 : live ? 10_000 : 60_000);
  }
}

async function fetchFantasy() {
  try {
    if (DEMO) state.fantasy = demoFantasy();
    else {
      const r = await fetch('/api/fantasy', { cache: 'no-store', credentials: 'same-origin' });
      state.fantasy = await r.json();
    }
  } catch (err) {
    state.fantasy = { loggedIn: false, error: String(err) };
  }
  renderAccount();
  renderFantasy();
  clearTimeout(fetchFantasy.t);
  fetchFantasy.t = setTimeout(fetchFantasy, 60_000);
}

function detectNewGoals(data) {
  const ids = data.goals.map((g) => g.id);
  const isToday = !state.date;
  if (!state.seen) {
    // Första laddningen: allt som redan finns räknas som sett.
    state.seen = new Set(ids);
    return;
  }
  const fresh = data.goals.filter((g) => !state.seen.has(g.id));
  for (const g of fresh) {
    state.seen.add(g.id);
    if (!isToday) continue;
    state.firstSeen[g.id] = Date.now();
    state.newGoals.add(g.id);
    state.flash.set(g.gameId, { until: Date.now() + 6500, goal: g });
    if (state.tab !== 'goals') state.unseenBadge++;
    toast(g, data);
    setTimeout(() => { state.newGoals.delete(g.id); renderGoals(); }, 60_000);
  }
  if (fresh.length) {
    // Rensa gamla tidsstämplar (äldre än 2 dygn)
    const cutoff = Date.now() - 2 * 864e5;
    for (const [k, v] of Object.entries(state.firstSeen)) if (v < cutoff) delete state.firstSeen[k];
    store.set('rs.firstSeen', state.firstSeen);
  }
}

// ---------- Render: matcher ----------
function renderAll() {
  renderHeader();
  renderGames();
  renderGoals();
}

function renderHeader() {
  const d = state.scores;
  const live = d.games.filter((g) => g.state === 'live').length;
  const lc = $('#liveCount');
  lc.hidden = !live;
  lc.textContent = `${live} live`;
  $('#todayBtn').textContent = !state.date ? 'Idag' : dayFmt.format(new Date(`${d.date}T12:00:00`));
  $('#todayBtn').title = d.date;
  $('#updated').textContent = `Uppdaterad ${new Date(state.fetchedAt).toLocaleTimeString('sv-SE')}`;
  const total = d.goals.length;
  $('#goalTotal').textContent = total ? `(${total})` : '';
  const badge = $('#goalBadge');
  badge.hidden = !state.unseenBadge;
  badge.textContent = state.unseenBadge;
}

function renderGames() {
  const games = [...state.scores.games];
  const order = { live: 0, pre: 1, final: 2 };
  games.sort((a, b) => order[a.state] - order[b.state] || a.startTimeUTC.localeCompare(b.startTimeUTC));
  const titles = { live: 'Pågående', pre: 'Kommande', final: 'Avslutade' };
  let html = '';
  let last = null;
  for (const g of games) {
    if (g.state !== last && games.some((x) => x.state !== g.state)) html += `<div class="group-title">${titles[g.state]}</div>`;
    last = g.state;
    html += gameCard(g);
  }
  $('#games').innerHTML = html || `<div class="empty">Inga matcher den här dagen.</div>`;
}

function teamRow(t, other, g) {
  const s = g.situation;
  let tag = '';
  if (s?.type === 'PP') tag = s.ppTeam === t.abbrev ? '<span class="tsit pp">PP</span>' : '<span class="tsit sh">SH</span>';
  if (s?.emptyNet?.includes(t.abbrev)) tag += '<span class="tsit en">EN</span>';
  const lead = g.state !== 'pre' && t.score != null && other.score != null
    ? (t.score > other.score ? 'leading' : t.score < other.score ? 'trailing' : '') : '';
  return `
    <div class="trow ${lead}">
      <img src="${esc(darkLogo(t.logo))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
      <div class="tname"><div class="abbr">${esc(t.abbrev)}</div><div class="full">${esc(t.name)}${t.sog != null && g.state !== 'pre' ? ` · ${t.sog} skott` : ''}</div></div>
      <div>${tag}</div>
      <div class="tscore">${g.state === 'pre' ? '' : t.score ?? 0}</div>
    </div>`;
}

function gameCard(g) {
  const c = g.clock;
  let top;
  if (g.state === 'live') {
    const secs = liveSecs(c?.secondsRemaining, c?.running);
    const per = periodLabel(g.period, g.periodType);
    top = c?.inIntermission
      ? `<span class="intermission">Paus efter ${esc(periodLabel(g.period, g.periodType))}</span>${secs != null ? `<span class="clock stopped" data-clock>${mmss(secs)}</span>` : ''}`
      : `<span class="per">${esc(per)}</span><span class="clock ${c?.running ? '' : 'stopped'}" data-clock>${secs != null ? mmss(secs) : esc(c?.timeRemaining || '')}</span>`;
    top = `<div class="g-period" data-game="${g.id}">${top}</div><span class="g-state live"><span class="dot"></span>Live</span>`;
  } else if (g.state === 'final') {
    const suf = g.outcome && g.outcome !== 'REG' ? ` (${g.outcome === 'SO' ? 'straffar' : 'förl.'})` : '';
    top = `<div class="g-period"><span class="per">Slut${suf}</span></div><span class="g-state">${g.goalCount} mål</span>`;
  } else {
    top = `<div class="g-period"><span class="per">${esc(timeFmt.format(new Date(g.startTimeUTC)))}</span></div><span class="g-state">${esc(g.venue)}</span>`;
  }

  let sit = '';
  const s = g.situation;
  if (g.state === 'live' && s && !c?.inIntermission) {
    const ps = s.secondsRemaining ?? toSecs(s.timeRemaining);
    const cls = s.type === 'PP' ? 'pp' : s.emptyNet.length ? 'en' : 'ev';
    let lbl;
    if (s.type === 'PP') lbl = `Power Play · ${esc(s.ppTeam)}`;
    else if (s.emptyNet.length) lbl = `Tom bur · ${esc(s.emptyNet.join(', '))}`;
    else lbl = 'Even Strength';
    const extraEN = s.type === 'PP' && s.emptyNet.length ? ` <span class="tag en">EN ${esc(s.emptyNet.join(','))}</span>` : '';
    const run = c?.running;
    sit = `
      <div class="g-sit ${cls}">
        <span class="lbl">${lbl}${extraEN}</span>
        <span class="str">${esc(s.strength)}</span>
        ${s.type === 'PP' && ps != null ? `<span class="ptime" data-pp="${ps}" data-run="${run ? 1 : 0}">${mmss(liveSecs(ps, run))}</span>
          <span class="ppbar" style="width:${Math.min(100, (liveSecs(ps, run) / 120) * 100)}%"></span>` : ''}
      </div>`;
  }

  let foot = '';
  if (g.lastGoal && g.state !== 'pre') {
    const lg = g.lastGoal;
    const ast = lg.assists.length ? ` (${lg.assists.map((a) => esc(a.name)).join(', ')})` : '';
    foot = `<div class="g-last"><span class="gl-ico"></span><span>Senast: <b>${esc(lg.scorer)}</b>${ast} · ${esc(lg.team)} ${esc(periodLabel(lg.period, lg.periodType))} ${esc(lg.timeInPeriod)}</span></div>`;
  }

  const fl = state.flash.get(g.id);
  let banner = '';
  if (fl && fl.until > Date.now()) {
    const a = fl.goal.assists.map((x) => esc(x.name)).join(', ');
    banner = `<div class="goal-banner"><div class="big">MÅL!</div><div class="who">${esc(fl.goal.scorer)} · ${esc(fl.goal.team)}</div>${a ? `<div class="ast">Assist: ${a}</div>` : '<div class="ast">Framspelning saknas</div>'}</div>`;
    setTimeout(() => { if (state.flash.get(g.id) === fl) { state.flash.delete(g.id); renderGames(); } }, fl.until - Date.now() + 50);
  }

  return `
    <article class="game ${g.state} ${banner ? 'goal-flash' : ''}">
      <div class="g-top">${top}</div>
      <div class="g-teams">${teamRow(g.away, g.home, g)}${teamRow(g.home, g.away, g)}</div>
      ${sit}${foot}${banner}
    </article>`;
}

// ---------- Render: mål ----------
function goalTags(g) {
  let t = '';
  if (g.strength === 'pp') t += '<span class="tag pp">PP</span>';
  if (g.strength === 'sh') t += '<span class="tag sh">SH</span>';
  if (g.modifier === 'empty-net') t += '<span class="tag en">EN</span>';
  if (g.modifier === 'penalty-shot') t += '<span class="tag ps">Straff</span>';
  if (g.periodType === 'OT') t += '<span class="tag gwg">OT</span>';
  return t;
}

function goalWallTime(g) {
  const seen = state.firstSeen[g.id];
  if (seen) return { ms: seen, label: timeFmt.format(new Date(seen)), exact: true };
  if (g.estTime) { const ms = Date.parse(g.estTime); return { ms, label: `~${timeFmt.format(new Date(ms))}`, exact: false }; }
  return { ms: 0, label: '', exact: false };
}

function renderGoals() {
  if (!state.scores) return;
  const logos = {};
  for (const g of state.scores.games) { logos[g.away.abbrev] = g.away.logo; logos[g.home.abbrev] = g.home.logo; }
  const goals = state.scores.goals.map((g) => ({ ...g, wall: goalWallTime(g) }));
  goals.sort((a, b) => a.wall.ms - b.wall.ms || a.id.localeCompare(b.id));
  if (!state.asc) goals.reverse();
  $('#sortGoals').textContent = state.asc ? 'Äldst först' : 'Senaste först';

  if (!goals.length) {
    $('#goals').innerHTML = `<li class="empty">Inga mål än. Nya mål dyker upp här direkt.</li>`;
    return;
  }
  const el = $('#goals');
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  el.innerHTML = goals.map((g) => {
    const sc = `${esc(g.away)} ${g.awayScore}–${g.homeScore} ${esc(g.home)}`;
    const ast = g.assists.length
      ? `Assist: ${g.assists.map((a) => `<b>${esc(a.name)}</b>${a.total != null ? ` (${a.total})` : ''}`).join(', ')}`
      : 'Utan assist';
    return `
      <li class="goal ${state.newGoals.has(g.id) ? 'new' : ''}">
        <div class="gimg">
          ${g.mugshot ? `<img class="mug" src="${esc(g.mugshot)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : '<div class="mug"></div>'}
          <img class="tlogo" src="${esc(darkLogo(logos[g.team]))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        </div>
        <div class="meta">
          <span class="wall" title="${g.wall.exact ? 'Tid då målet dök upp' : 'Uppskattad tid'}">${esc(g.wall.label)}</span><span class="sep">·</span>
          <span>${esc(periodLabel(g.period, g.periodType))} ${esc(g.timeInPeriod)}</span><span class="sep">·</span>
          <span>${esc(g.away)} @ ${esc(g.home)}</span>
        </div>
        <div class="scorer">${esc(g.scorer)}${g.scorerTotal != null ? ` <span class="tot">(${g.scorerTotal})</span>` : ''} ${goalTags(g)}</div>
        <div class="assists">${ast}</div>
        <div class="scoreline"><span class="sc">${sc}</span>${g.clip ? `<a href="${esc(g.clip)}" target="_blank" rel="noopener">Klipp ↗</a>` : ''}</div>
      </li>`;
  }).join('');
  if (state.asc && atBottom) el.scrollTop = el.scrollHeight;
}

// ---------- Render: fantasy ----------
function renderAccount() {
  const f = state.fantasy;
  const el = $('#account');
  if (!f) { el.innerHTML = ''; return; }
  if (f.loggedIn) el.innerHTML = `<a class="btn ghost" href="${DEMO ? '#' : '/api/auth/logout'}">Logga ut</a>`;
  else if (f.configured) el.innerHTML = `<a class="btn" href="/api/auth/login">Logga in med Yahoo</a>`;
  else el.innerHTML = '';
}

function fmtPts(n) { return n == null ? '–' : Number.isInteger(n) ? n : n.toFixed(2); }

function renderFantasy() {
  const f = state.fantasy;
  const el = $('#fantasy');
  if (!f) { el.innerHTML = ''; return; }
  if (!f.loggedIn) {
    el.innerHTML = f.configured
      ? `<div class="login-card"><p>${f.expired ? 'Din Yahoo-session har gått ut.' : 'Logga in för att följa dina Fantasy Hockey-matchups i alla ligor.'}</p><a class="btn" href="/api/auth/login">Logga in med Yahoo</a></div>`
      : `<div class="login-card"><p>Yahoo-inloggning är inte konfigurerad. Lägg in YAHOO_CLIENT_ID, YAHOO_CLIENT_SECRET och SESSION_SECRET (se README).</p></div>`;
    return;
  }
  if (f.error) { el.innerHTML = `<div class="login-card"><p>Kunde inte hämta fantasydata: ${esc(f.error)}</p></div>`; return; }
  if (!f.leagues?.length) { el.innerHTML = `<div class="empty">Inga NHL-ligor hittades på ditt Yahoo-konto den här säsongen.</div>`; return; }

  el.innerHTML = f.leagues.map((lg) => {
    const head = `<div class="lg-head"><a class="lg-name" href="${esc(lg.url)}" target="_blank" rel="noopener">${esc(lg.name)}</a><span class="lg-week">${lg.week ? `Vecka ${esc(lg.week)}` : ''}${lg.isPlayoffs ? ' · Slutspel' : ''}</span></div>`;
    if (lg.error) return `<div class="lg">${head}<div class="err">${esc(lg.error)}</div></div>`;
    if (!lg.me) return `<div class="lg">${head}<div class="sub" style="color:var(--muted);font-size:12px">Ingen pågående matchup (rotisserie eller vilovecka).</div></div>`;

    const isCat = lg.record && lg.scoringType !== 'headpoint';
    const a = isCat ? lg.record.wins : lg.me.points;
    const b = isCat ? lg.record.losses : lg.opp.points;
    const row = (t, val, other, proj, isMe) => `
      <div class="mrow ${val > other ? 'ahead' : val < other ? 'behind' : ''} ${isMe ? 'mine' : ''}">
        ${t.logo ? `<img src="${esc(t.logo)}" alt="" loading="lazy" onerror="this.removeAttribute('src')">` : '<img alt="">'}
        <div class="mt"><div class="tn">${esc(t.name)}</div><div class="sub">${esc(t.manager || '')}${proj != null ? ` · prognos ${fmtPts(proj)}` : ''}</div></div>
        <div class="mscore">${isCat ? val : fmtPts(val)}</div>
      </div>`;
    const tieNote = isCat && lg.record.ties ? `<div class="proj">${lg.record.ties} kategori${lg.record.ties > 1 ? 'er' : ''} lika</div>` : '';
    const cats = isCat && lg.categories?.length
      ? `<div class="cats">${lg.categories.map((c) => `<div class="cat ${c.result || ''}"><div class="cn">${esc(c.name)}</div><div class="cv">${esc(c.me)}–${esc(c.opp)}</div></div>`).join('')}</div>` : '';
    return `<div class="lg">${head}<div class="mu">${row(lg.me, a, b, lg.me.projected, true)}${row(lg.opp, b, a, lg.opp.projected, false)}${tieNote}</div>${cats}</div>`;
  }).join('');
}

// ---------- Toast ----------
function toast(g, data) {
  const game = data.games.find((x) => x.id === g.gameId);
  const logo = game ? (game.away.abbrev === g.team ? game.away.logo : game.home.logo) : '';
  const div = document.createElement('div');
  div.className = 'toast';
  div.innerHTML = `
    <img src="${esc(darkLogo(logo))}" alt="">
    <div><div class="t1">MÅL ${esc(g.team)}</div>
    <div class="t2">${esc(g.scorer)} ${goalTags(g)}</div>
    <div class="t3">${g.assists.length ? 'Assist: ' + g.assists.map((a) => esc(a.name)).join(', ') : 'Utan assist'} · ${esc(g.away)} ${g.awayScore}–${g.homeScore} ${esc(g.home)}</div></div>`;
  $('#toasts').append(div);
  setTimeout(() => div.remove(), 7200);
}

// ---------- Klock-tick mellan hämtningar ----------
function tick() {
  if (!state.scores) return;
  for (const el of document.querySelectorAll('.g-period[data-game]')) {
    const g = state.scores.games.find((x) => String(x.id) === el.dataset.game);
    const clk = el.querySelector('[data-clock]');
    if (!g?.clock || !clk) continue;
    const s = liveSecs(g.clock.secondsRemaining, g.clock.running);
    if (s != null) clk.textContent = mmss(s);
  }
  for (const el of document.querySelectorAll('[data-pp]')) {
    const s = liveSecs(Number(el.dataset.pp), el.dataset.run === '1');
    el.textContent = mmss(s);
    const bar = el.parentElement.querySelector('.ppbar');
    if (bar) bar.style.width = `${Math.min(100, (s / 120) * 100)}%`;
  }
}

// ---------- Händelser ----------
function setTab(tab) {
  state.tab = tab;
  document.body.dataset.tab = tab;
  for (const b of document.querySelectorAll('.tabbar button')) b.classList.toggle('active', b.dataset.tab === tab);
  if (tab === 'goals') { state.unseenBadge = 0; if (state.scores) renderHeader(); }
  window.scrollTo({ top: 0 });
}

function go(date) {
  state.date = date;
  state.seen = null;
  state.scores = null;
  $('#games').innerHTML = `<div class="empty">Laddar…</div>`;
  fetchScores();
}

document.querySelector('.tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (b) setTab(b.dataset.tab);
});
$('#prevDate').addEventListener('click', () => state.scores && go(state.scores.prevDate));
$('#nextDate').addEventListener('click', () => state.scores && go(state.scores.nextDate));
$('#todayBtn').addEventListener('click', () => go(null));
$('#sortGoals').addEventListener('click', () => { state.asc = !state.asc; store.set('rs.asc', state.asc); renderGoals(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { fetchScores(); fetchFantasy(); } });

const auth = params.get('auth');
if (auth) {
  const msg = { ok: 'Inloggad med Yahoo', denied: 'Yahoo-inloggningen avbröts', invalid: 'Ogiltig inloggning, försök igen', error: 'Inloggningen misslyckades' }[auth];
  if (msg) {
    const d = document.createElement('div');
    d.className = 'toast'; d.innerHTML = `<div class="t2">${esc(msg)}</div>`;
    $('#toasts').append(d); setTimeout(() => d.remove(), 5000);
  }
  params.delete('auth');
  history.replaceState(null, '', location.pathname + (params.toString() ? `?${params}` : ''));
}

$('#games').innerHTML = `<div class="empty">Laddar…</div>`;
fetchScores();
fetchFantasy();
setInterval(tick, 1000);
