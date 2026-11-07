// Rinkside – frontend. Inga beroenden.
import { demoScores, demoFantasy, demoOnIce, demoPredictions } from './demo.js';
import { unlock, isUnlocked, playHorn } from './horn.js';
import { buildIndex, summarize } from './marks.js';
import * as radio from './radio.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');
// Yahoo-delen är dold tills Yahoo godkänt appen för Fantasy-API:et. Visa den med ?fantasy
const FANTASY = params.has('fantasy');
if (!FANTASY) document.body.classList.add('no-fantasy');

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
  asc: store.get('rs.goalOrderAsc', false), // standard: senaste först
  tab: 'games',
  marks: buildIndex(null),   // fantasyspelare (Yahoo-trupper)
  onlyMine: store.get('rs.onlyMine', false),
  onice: new Map(),
  preds: null,               // { date, games: { id: {...} } }
  showPreds: store.get('rs.preds', true),
  boxData: new Map(),        // gameId -> { at, data, loading } – NHL:s officiella boxscore
  boxAll: false,             // visa alla utespelare i boxscoren         // gameId -> { goals, at, loading, failed }
};

// ---------- Format ----------
const timeFmt = new Intl.DateTimeFormat('sv-SE', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' });
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, '0')}`;
const toSecs = (t) => { const m = /^(\d+):(\d{2})$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
// NHL har loggor för mörk (_dark) och ljus (_light) bakgrund – välj efter aktivt tema
const isLight = () => document.documentElement.dataset.theme === 'light';
const darkLogo = (url) => (isLight()
  ? (url || '').replace(/_dark\.svg$/, '_light.svg')
  : (url || '').replace(/_light\.svg$/, '_dark.svg'));

const LONG_BREAK_SECS = 20 * 60; // pausklocka längre än så visas som förlängt uppehåll

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
  const forDate = state.date;
  try {
    let data;
    if (DEMO) data = demoScores();
    else {
      const r = await fetch(`/api/scores${state.date ? `?date=${state.date}` : ''}`, { cache: 'no-store' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
      data = await r.json();
    }
    if (forDate !== state.date) return; // användaren har bytt dag under tiden
    if (!state.date) state.today = data.date;
    // Standardvyn har bytt matchdag medan sidan var öppen: behandla den nya dagens mål som redan sedda
    if (state.scores && data.date !== state.scores.date) state.seen = null;
    detectNewGoals(data);
    state.scores = data;
    state.fetchedAt = Date.now();
    renderAll();
    refreshOnIce();
    fetchPreds();
  } catch (err) {
    console.error(err);
    $('#updated').textContent = 'Kunde inte uppdatera – försöker igen';
  } finally {
    clearTimeout(fetchScores.t);
    const live = state.scores?.games?.some((g) => g.state === 'live');
    fetchScores.t = setTimeout(fetchScores, DEMO ? 4_000 : live ? 10_000 : 60_000);
  }
}

// Spelare på isen / +/- per mål. Bytesdata publiceras med några minuters fördröjning,
// så matcher med ofullständiga mål hämtas om (var 30:e s live, varannan minut annars).
// +/- visas för mål i lika numerär och i boxplay – inte för PP- eller straffslagsmål (NHL:s regler)
const showsPlusMinus = (g) => g.strength !== 'pp' && g.modifier !== 'penalty-shot';

async function refreshOnIce() {
  const data = state.scores;
  if (!data) return;
  const now = Date.now();
  const due = data.games.filter((g) => {
    if (!g.goalCount || g.state === 'pre') return false;
    if (!data.goals.some((x) => x.gameId === g.id && showsPlusMinus(x))) return false;
    const c = state.onice.get(g.id);
    if (!c) return true;
    if (c.loading) return false;
    const incomplete = data.goals.some((x) => x.gameId === g.id && showsPlusMinus(x) && !c.goals?.[x.id]?.complete);
    if (!incomplete) return false;
    return now - c.at > (g.state === 'live' ? 30_000 : 120_000);
  });
  if (!due.length) return;
  await Promise.all(due.slice(0, 8).map(async (g) => {
    const prev = state.onice.get(g.id);
    state.onice.set(g.id, { ...prev, loading: true });
    try {
      let goals;
      if (DEMO) goals = demoOnIce(data, g.id);
      else {
        const r = await fetch(`/api/onice?gameId=${g.id}`);
        if (!r.ok) throw new Error(r.status);
        goals = (await r.json()).goals;
      }
      state.onice.set(g.id, { goals, at: Date.now(), loading: false });
    } catch {
      state.onice.set(g.id, { goals: prev?.goals, at: Date.now(), loading: false, failed: true });
    }
  }));
  if (data === state.scores) { renderGoals(); renderBox(); }
}

async function fetchFantasy() {
  try {
    if (DEMO) state.fantasy = demoFantasy();
    else {
      const d = state.date || state.scores?.date;
      const r = await fetch(`/api/fantasy${d ? `?date=${d}` : ''}`, { cache: 'no-store', credentials: 'same-origin' });
      state.fantasy = await r.json();
    }
  } catch (err) {
    state.fantasy = { loggedIn: false, error: String(err) };
  }
  state.marks = buildIndex(state.fantasy?.loggedIn ? state.fantasy : null);
  renderAccount();
  renderFantasy();
  if (state.scores) renderAll();
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
  if (isToday && fresh.length) goalHorn();
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
  renderBox();
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
  $('#dateText').textContent = !state.date ? 'Idag' : dayFmt.format(new Date(`${d.date}T12:00:00`));
  $('#datePick').value = d.date;
  $('#todayBtn').hidden = !state.date;
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
    // En vanlig paus är 18 min. Längre pausklocka = NHL har lagt in ett förlängt uppehåll (t.ex. isproblem).
    const longBreak = c?.inIntermission && secs != null && secs > LONG_BREAK_SECS;
    top = c?.inIntermission
      ? longBreak
        ? `<span class="intermission" title="NHL anger ${mmss(secs)} kvar av pausen">Förlängt uppehåll efter ${esc(periodLabel(g.period, g.periodType))}</span>`
        : `<span class="intermission">Paus efter ${esc(periodLabel(g.period, g.periodType))}</span>${secs != null ? `<span class="clock stopped" data-clock>${mmss(secs)}</span>` : ''}`
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
    const ast = lg.assists.length ? ` (${lg.assists.map((a) => pn(lg.team, a.name)).join(', ')})` : '';
    foot = `<div class="g-last"><span class="gl-ico"></span><span>Senast: <b>${pn(lg.team, lg.scorer)}</b>${ast} · ${esc(lg.team)} ${esc(periodLabel(lg.period, lg.periodType))} ${esc(lg.timeInPeriod)}</span></div>`;
  }

  // Länk till matchen på NHL.com (NHL-loggan, med text som reserv om bilden inte laddas)
  const gcUrl = g.gameCenter || `https://www.nhl.com/gamecenter/${g.id}`;
  // Lagens radiosändningar (finns medan matchen pågår, ofta en stund innan)
  const now = radio.nowPlaying()?.key;
  const rbtn = (t, side) => {
    const key = `${g.id}-${side}`;
    return `<button class="rbtn ${now === key ? 'on' : ''}" data-radio="${g.id}" data-side="${side}" title="${now === key ? 'Stäng' : 'Lyssna på'} ${esc(t.name)}s radiosändning" aria-label="Radio ${esc(t.abbrev)}">
      <img src="${esc(darkLogo(t.logo))}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'${esc(t.abbrev)}'}))">
      <svg class="wave" viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 4.5a3.5 3.5 0 0 0 0 3M8.5 4.5a3.5 3.5 0 0 1 0 3M1.8 3a6 6 0 0 0 0 6M10.2 3a6 6 0 0 1 0 6"/><circle cx="6" cy="6" r="1.1"/></svg>
    </button>`;
  };
  const radioBtns = g.state === 'final' ? '' : `<span class="g-radio">${rbtn(g.away, 'away')}${rbtn(g.home, 'home')}</span>`;

  const nhl = `<a class="g-nhl" href="${esc(gcUrl)}" target="_blank" rel="noopener" title="Öppna matchen på NHL.com" aria-label="Öppna matchen på NHL.com">
      <img src="https://assets.nhle.com/logos/nhl/svg/NHL_${isLight() ? 'light' : 'dark'}.svg" alt="" onerror="this.hidden=true;this.nextElementSibling.hidden=false">
      <span hidden>NHL.com</span><svg class="ext" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5h5v5M9.5 2.5l-7 7"/></svg></a>`;

  const fl = state.flash.get(g.id);
  let banner = '';
  if (fl && fl.until > Date.now()) {
    const a = fl.goal.assists.map((x) => esc(x.name)).join(', ');
    banner = `<div class="goal-banner"><div class="big">MÅL!</div><div class="who">${esc(fl.goal.scorer)} · ${esc(fl.goal.team)}</div>${a ? `<div class="ast">Assist: ${a}</div>` : '<div class="ast">Framspelning saknas</div>'}</div>`;
    setTimeout(() => { if (state.flash.get(g.id) === fl) { state.flash.delete(g.id); renderGames(); } }, fl.until - Date.now() + 50);
  }

  return `
    <article class="game ${g.state} ${banner ? 'goal-flash' : ''} ${predFor(g) ? 'has-pred' : ''}" data-id="${g.id}" ${g.state !== 'pre' || predFor(g) ? `tabindex="0" role="button" aria-label="${g.state === 'pre' ? 'Visa prognos' : 'Visa boxscore'}"` : ''}>
      <div class="g-top">${top}${radioBtns}${nhl}</div>
      <div class="g-teams">${teamRow(g.away, g.home, g)}${teamRow(g.home, g.away, g)}</div>
      ${predCard(g)}${sit}${foot}${banner}
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
  // 1) Riktigt klockslag från ESPN, 2) när sidan själv såg målet, 3) uppskattning
  if (g.wallTime) { const ms = Date.parse(g.wallTime); return { ms, label: timeFmt.format(new Date(ms)), exact: true }; }
  const seen = state.firstSeen[g.id];
  if (seen) return { ms: seen, label: timeFmt.format(new Date(seen)), exact: true };
  if (g.estTime) { const ms = Date.parse(g.estTime); return { ms, label: `~${timeFmt.format(new Date(ms))}`, exact: false }; }
  return { ms: 0, label: '', exact: false };
}

function renderGoals() {
  if (!state.scores) return;
  const logos = {};
  for (const g of state.scores.games) { logos[g.away.abbrev] = g.away.logo; logos[g.home.abbrev] = g.home.logo; }
  const marked = state.marks.size > 0;
  $('#fLegend').hidden = !marked;
  $('#onlyMine').hidden = !marked;
  $('#onlyMine').setAttribute('aria-pressed', String(state.onlyMine));
  const filterOn = marked && state.onlyMine;
  const goals = state.scores.goals
    .filter((g) => !filterOn || involvesFantasy(g))
    .map((g) => ({ ...g, wall: goalWallTime(g) }));
  goals.sort((a, b) => a.wall.ms - b.wall.ms || a.id.localeCompare(b.id));
  if (!state.asc) goals.reverse();
  $('#sortGoals').textContent = state.asc ? 'Äldst först' : 'Senaste först';

  if (!goals.length) {
    $('#goals').innerHTML = filterOn
      ? `<li class="empty">Inga mål för dina fantasyspelare eller motståndarens än.</li>`
      : `<li class="empty">Inga mål än. Nya mål dyker upp här direkt.</li>`;
    return;
  }
  const el = $('#goals');
  const keep = el.scrollTop; // behåll läget – listan ska aldrig scrolla av sig själv
  el.innerHTML = goals.map((g) => {
    const sc = `${esc(g.away)} ${g.awayScore}–${g.homeScore} ${esc(g.home)}`;
    const ast = g.assists.length
      ? `Assist: ${g.assists.map((a) => `<b>${pn(g.team, a.name)}</b>${a.total != null ? ` (${a.total})` : ''}`).join(', ')}`
      : 'Utan assist';
    return `
      <li class="goal ${state.newGoals.has(g.id) ? 'new' : ''}">
        <div class="gimg">
          ${g.mugshot ? `<img class="mug" src="${esc(g.mugshot)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : '<div class="mug"></div>'}
          <img class="tlogo" src="${esc(darkLogo(logos[g.team]))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        </div>
        <div class="meta">
          <span class="wall" title="${g.wallTime ? 'Klockslag då målet gjordes' : g.wall.exact ? 'Tid då målet dök upp här' : 'Uppskattad tid'}">${esc(g.wall.label)}</span><span class="sep">·</span>
          <span>${esc(periodLabel(g.period, g.periodType))} ${esc(g.timeInPeriod)}</span><span class="sep">·</span>
          <span>${esc(g.away)} @ ${esc(g.home)}</span>
        </div>
        <div class="scorer">${pn(g.team, g.scorer)}${g.scorerTotal != null ? ` <span class="tot">(${g.scorerTotal})</span>` : ''} ${goalTags(g)}</div>
        <div class="assists">${ast}</div>
        ${onIceHtml(g)}
        <div class="scoreline"><span class="sc">${sc}</span>${g.clip ? `<a href="${esc(g.clip)}" target="_blank" rel="noopener">Klipp ↗</a>` : ''}</div>
      </li>`;
  }).join('');
  el.scrollTop = keep;
}

// ---------- Fantasymarkering ----------
/** Namn med orange (min spelare) eller ljusblå (motståndarens) markering. display = text som visas. */
function pn(team, name, display = name) {
  const m = summarize(state.marks.lookup(team, name));
  if (!m) return esc(display);
  const multi = state.marks.leagues > 1;
  const title = m.hits.map((h) => `${h.side === 'me' ? 'Ditt lag' : 'Motståndare'} – ${h.league}${h.active ? '' : ' (bänk/IR)'}`).join('\n');
  const tags = multi ? `<sup class="ft">${m.hits.map((h) => `<i class="${h.side}">${esc(h.tag)}</i>`).join('')}</sup>` : '';
  return `<span class="fp ${m.side}${m.active ? '' : ' bench'}" title="${esc(title)}">${esc(display)}</span>${tags}`;
}

/** Berör målet någon av mina eller motståndarens spelare (målgörare, assist eller på isen)? */
function involvesFantasy(g) {
  const hit = (name) => state.marks.lookup(g.team, name).length > 0;
  if (hit(g.scorer) || g.assists.some((a) => hit(a.name))) return true;
  const c = state.onice.get(g.gameId)?.goals?.[g.id];
  if (c?.complete && showsPlusMinus(g)) {
    return c.scoring.some((p) => state.marks.lookup(c.scoringTeam, p.short || p.name).length)
      || c.conceding.some((p) => state.marks.lookup(c.otherTeam, p.short || p.name).length);
  }
  return false;
}

function onIceHtml(g) {
  if (!showsPlusMinus(g)) return '';
  const entry = state.onice.get(g.gameId);
  if (!entry) return '';
  const c = entry.goals?.[g.id];
  if (!c || !c.complete) {
    return entry.failed && !c ? '' : '<div class="pm pending">+/- väntar på bytesdata…</div>';
  }
  const names = (list, team) => list.map((p) => `<span class="pn">${p.num != null ? `<i>${p.num}</i>` : ''}${pn(team, p.short || p.name, p.name)}</span>`).join('');
  const row = (cls, sign, team, list) =>
    `<div class="pm-row ${cls}"><b>${sign}</b><span class="pt">${esc(team)}</span><span class="pl">${names(list, team)}</span></div>`;
  return `<div class="pm">${row('plus', '+', c.scoringTeam, c.scoring)}${row('minus', '−', c.otherTeam, c.conceding)}</div>`;
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
  if (f.error) {
    const hint = f.status === 403
      ? '<p>Yahoo nekade åtkomst. Kontrollera att din Yahoo-app har behörigheten <b>Fantasy Sports – Read</b>, logga sedan ut och in igen.</p>'
      : '';
    el.innerHTML = `<div class="login-card"><p>Kunde inte hämta fantasydata: ${esc(f.error)}</p>${hint}<a class="btn ghost" href="/api/auth/logout">Logga ut</a></div>`;
    return;
  }
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

// ---------- Boxscore ----------
let boxReturnFocus = null;

function openBox(id) {
  state.boxId = id;
  boxReturnFocus = document.activeElement;
  $('#box').hidden = false;
  document.body.classList.add('box-open');
  renderBox();
  $('.box-close').focus();
}

async function ensureBoxData(g) {
  if ((DEMO && !params.has('boxtest')) || g.state === 'pre') return;
  const c = state.boxData.get(g.id);
  const stale = !c || (!c.loading && (g.state === 'live' ? Date.now() - c.at > 20_000 : !c.data && Date.now() - c.at > 20_000));
  if (!stale) return;
  state.boxData.set(g.id, { ...c, at: Date.now(), loading: true });
  try {
    const r = await fetch(`/api/boxscore?gameId=${g.id}`);
    if (!r.ok) throw new Error(r.status);
    state.boxData.set(g.id, { at: Date.now(), data: await r.json(), loading: false });
  } catch {
    state.boxData.set(g.id, { at: Date.now(), data: c?.data, loading: false });
  }
  if (state.boxId === g.id) renderBox();
}

function closeBox() {
  state.boxId = null;
  $('#box').hidden = true;
  document.body.classList.remove('box-open');
  boxReturnFocus?.focus?.();
}

function renderBox() {
  if (!state.boxId || !state.scores) return;
  const g = state.scores.games.find((x) => x.id === state.boxId);
  if (!g) { closeBox(); return; }
  if (g.state === 'pre') { renderPredBox(g); return; }
  const goals = state.scores.goals
    .filter((x) => x.gameId === g.id)
    .sort((a, b) => a.period - b.period || a.timeInPeriod.localeCompare(b.timeInPeriod));
  const logo = (t) => `<img src="${esc(darkLogo(t.logo))}" alt="" onerror="this.style.visibility='hidden'">`;

  // Status
  let status;
  if (g.state === 'final') {
    status = g.outcome === 'SO' ? 'Slut efter straffar' : g.outcome === 'OT' ? 'Slut efter förlängning' : 'Slut';
  } else if (g.clock?.inIntermission) {
    status = (g.clock.secondsRemaining ?? 0) > LONG_BREAK_SECS
      ? `Förlängt uppehåll efter ${periodLabel(g.period, g.periodType)}`
      : `Paus efter ${periodLabel(g.period, g.periodType)}`;
  } else {
    const secs = liveSecs(g.clock?.secondsRemaining, g.clock?.running);
    status = `${periodLabel(g.period, g.periodType)} · ${secs != null ? mmss(secs) : esc(g.clock?.timeRemaining || '')}`;
  }

  // Resultat per period
  const shootout = g.outcome === 'SO' || g.periodType === 'SO';
  // Straffläggningen har eget periodnummer hos NHL – visa den som egen kolumn, inte som extra förlängning
  const lastPeriod = shootout ? 4 : Math.max(3, g.period || 0, ...goals.map((x) => x.period));
  const periods = Array.from({ length: lastPeriod }, (_, i) => i + 1);
  const perGoals = (abbr, p) => goals.filter((x) => x.team === abbr && x.period === p).length;
  const played = (p) => g.state === 'final' ? p <= lastPeriod && (p <= 3 || goals.some((x) => x.period === p) || shootout || g.outcome === 'OT') : p <= (g.period || 0);
  const soWin = (t) => shootout && g.state === 'final' ? Math.max(0, (t.score ?? 0) - goals.filter((x) => x.team === t.abbrev).length) : null;
  const lineRow = (t) => `
    <tr>
      <th>${logo(t)}<span>${esc(t.abbrev)}</span></th>
      ${periods.map((p) => `<td>${played(p) ? perGoals(t.abbrev, p) : '–'}</td>`).join('')}
      ${shootout ? `<td>${soWin(t) ?? '–'}</td>` : ''}
      <td class="tot">${t.score ?? 0}</td>
      <td class="sog">${t.sog ?? '–'}</td>
    </tr>`;
  const line = `
    <table class="line">
      <thead><tr><th></th>${periods.map((p) => `<th>${p > 3 ? (p === 4 ? 'OT' : `${p - 3}OT`) : p}</th>`).join('')}${shootout ? '<th>Str</th>' : ''}<th class="tot">T</th><th class="sog">Skott</th></tr></thead>
      <tbody>${lineRow(g.away)}${lineRow(g.home)}</tbody>
    </table>`;

  // Mål per period
  const teamLogo = { [g.away.abbrev]: g.away, [g.home.abbrev]: g.home };
  const periodsWithPlay = periods.filter(played);
  const goalList = periodsWithPlay.map((p) => {
    const pg = goals.filter((x) => x.period === p);
    const items = pg.length ? pg.map((x) => `
      <li>
        <span class="bt">${esc(x.timeInPeriod)}</span>
        ${logo(teamLogo[x.team] || {})}
        <div class="bg">
          <div class="bs"><b>${pn(x.team, x.scorer)}</b>${x.scorerTotal != null ? ` <span class="tot">(${x.scorerTotal})</span>` : ''} ${goalTags(x)}</div>
          <div class="ba">${x.assists.length ? x.assists.map((a) => `${pn(x.team, a.name)}${a.total != null ? ` (${a.total})` : ''}`).join(', ') : 'Utan assist'}</div>
        </div>
        <span class="bsc">${x.awayScore}–${x.homeScore}</span>
      </li>`).join('') : '<li class="none">Inga mål</li>';
    const name = p > 3 ? (p === 4 ? 'Förlängning' : `Förlängning ${p - 3}`) : `${{ 1: '1:a', 2: '2:a', 3: '3:e' }[p]} perioden`;
    return `<h3>${name}</h3><ol class="bgoals">${items}</ol>`;
  }).join('');

  // Poängliga per lag, med +/- från bytesdatan (samma källa som målkolumnen)
  const pts = new Map();
  // Nyckel: spelar-ID om det finns, annars efternamn (demo/äldre data)
  const keyOf = (team, id, name) => `${team}|${id ?? String(name).split(' ').pop().toLowerCase()}`;
  const row = (team, id, name) => {
    const k = keyOf(team, id, name);
    if (!pts.has(k)) pts.set(k, { team, name, g: 0, a: 0, pm: 0, hasPm: false });
    return pts.get(k);
  };
  for (const x of goals) {
    // Samma namnform som assistnamnen ("A. Matthews"), så att spelaren hamnar på en rad
    const short = x.scorerShort || x.scorer.replace(/^(\S)\S*\s+/, '$1. ');
    row(x.team, x.scorerId, short).g++;
    for (const a of x.assists) row(x.team, a.playerId, a.name).a++;
  }
  const oi = state.onice.get(g.id)?.goals || {};
  let pmGoals = 0, pmMissing = 0;
  for (const x of goals) {
    if (!showsPlusMinus(x)) continue;
    pmGoals++;
    const c = oi[x.id];
    if (!c?.complete || !c.applies) { pmMissing++; continue; }
    for (const p of c.scoring) { const r = row(c.scoringTeam, p.id, p.short || p.name); r.pm++; r.hasPm = true; }
    for (const p of c.conceding) { const r = row(c.otherTeam, p.id, p.short || p.name); r.pm--; r.hasPm = true; }
  }
  const showPm = pmGoals > 0 && pmMissing < pmGoals;
  const fmtPm = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
  const ptsTable = (t) => {
    const rows = [...pts.values()].filter((r) => r.team === t.abbrev && (r.g + r.a > 0 || (showPm && r.pm !== 0)))
      .sort((a, b) => (b.g + b.a) - (a.g + a.a) || b.g - a.g || b.pm - a.pm || a.name.localeCompare(b.name));
    return `
      <div class="pts">
        <div class="pts-h">${logo(t)}<span>${esc(t.name)}</span></div>
        ${rows.length ? `<table><thead><tr><th></th><th>M</th><th>A</th><th>P</th>${showPm ? '<th>+/-</th>' : ''}</tr></thead><tbody>
          ${rows.map((r) => `<tr><td>${pn(r.team, r.name)}</td><td>${r.g}</td><td>${r.a}</td><td class="p">${r.g + r.a}</td>${showPm
            ? `<td class="pm ${r.pm > 0 ? 'pos' : r.pm < 0 ? 'neg' : ''}">${fmtPm(r.pm)}</td>` : ''}</tr>`).join('')}
        </tbody></table>` : '<div class="none">Inga poäng</div>'}
      </div>`;
  };
  const pmNote = pmGoals === 0 ? ''
    : pmMissing === pmGoals ? '<p class="pm-foot">+/- visas när NHL:s bytesdata finns (några minuters fördröjning).</p>'
    : pmMissing ? `<p class="pm-foot">+/- saknar ännu ${pmMissing} mål – bytesdata kommer med några minuters fördröjning.</p>` : '';

  // NHL:s officiella spelarstatistik (plusMinus, istid, skott). Egen uträkning ovan används som reserv.
  ensureBoxData(g);
  const official = state.boxData.get(g.id)?.data;
  const officialTable = (t, side) => {
    const sk = official[side]?.skaters || [];
    const rows = sk.filter((p) => state.boxAll || p.p > 0 || p.pm !== 0)
      .sort((a, b) => b.p - a.p || b.g - a.g || b.pm - a.pm || b.toiSec - a.toiSec);
    return `
      <div class="pts">
        <div class="pts-h">${logo(t)}<span>${esc(t.name)}</span></div>
        ${rows.length ? `<table class="off"><thead><tr><th></th><th>M</th><th>A</th><th>P</th><th>+/-</th><th class="c-sog">S</th><th class="c-toi">Istid</th></tr></thead><tbody>
          ${rows.map((r) => `<tr><td>${r.num != null ? `<i class="num">${r.num}</i>` : ''}${pn(t.abbrev, r.name)}</td><td>${r.g}</td><td>${r.a}</td><td class="p">${r.p}</td>
            <td class="pm ${r.pm > 0 ? 'pos' : r.pm < 0 ? 'neg' : ''}">${fmtPm(r.pm)}</td><td class="c-sog">${r.sog}</td><td class="c-toi">${esc(r.toi || '–')}</td></tr>`).join('')}
        </tbody></table>` : '<div class="none">Inga poäng eller +/- än</div>'}
      </div>`;
  };
  const ptsHtml = official
    ? `${officialTable(g.away, 'away')}${officialTable(g.home, 'home')}`
    : `${ptsTable(g.away)}${ptsTable(g.home)}`;
  const total = official ? (official.away?.skaters?.length || 0) + (official.home?.skaters?.length || 0) : 0;
  const footNote = official
    ? `<p class="pm-foot">Officiell statistik från NHL. <button class="textbtn" data-boxall>${state.boxAll ? 'Visa bara spelare med poäng eller +/-' : `Visa alla ${total} utespelare`}</button></p>`
    : pmNote;

  const gcUrl = g.gameCenter || `https://www.nhl.com/gamecenter/${g.id}`;
  $('#boxBody').innerHTML = `
    <header class="box-head">
      <div class="bh-team">${logo(g.away)}<div><b>${esc(g.away.abbrev)}</b><span>${esc(g.away.name)}</span></div></div>
      <div class="bh-score">
        <div class="sc" id="boxTitle">${g.away.score ?? 0}<span>–</span>${g.home.score ?? 0}</div>
        <div class="st ${g.state === 'live' ? 'live' : ''}">${g.state === 'live' ? '<span class="dot"></span>' : ''}${status}</div>
      </div>
      <div class="bh-team home"><div><b>${esc(g.home.abbrev)}</b><span>${esc(g.home.name)}</span></div>${logo(g.home)}</div>
    </header>
    ${line}
    ${predFor(g) ? predDetails(g, true) : ''}
    <section class="box-goals">${goalList || '<p class="none">Inga mål än.</p>'}</section>
    <section class="box-pts">${ptsHtml}</section>
    ${footNote}
    <a class="box-gc" href="${esc(gcUrl)}" target="_blank" rel="noopener">Hela matchen på NHL.com ↗</a>`;
}

// ---------- Prognoser ----------
async function fetchPreds() {
  const s = state.scores;
  if (!s || !state.showPreds) return;
  const date = s.date;
  if (state.preds?.date === date && Date.now() - state.preds.at < 5 * 60_000) return;
  if (fetchPreds.busy) return;
  fetchPreds.busy = true;
  try {
    let data;
    if (DEMO) data = demoPredictions(s);
    else {
      const r = await fetch(`/api/predictions?date=${date}`);
      if (!r.ok) throw new Error(r.status);
      data = await r.json();
    }
    if (state.scores?.date !== date) return;
    state.preds = { date, at: Date.now(), games: data.games || {}, opensAt: data.opensAt };
    renderGames();
    renderBox();
  } catch {
    state.preds = { date, at: Date.now() - 4 * 60_000, games: state.preds?.date === date ? state.preds.games : {} };
  } finally {
    fetchPreds.busy = false;
  }
}

function predFor(g) {
  if (!state.showPreds) return null;
  return state.preds?.games?.[g.id]?.prediction ? state.preds.games[g.id] : null;
}

const pct = (x) => `${Math.round(x * 100)} %`;
const hm = (iso) => (iso ? timeFmt.format(new Date(iso)) : '');

function predScoreText(g, p) {
  const s = p.score;
  return `${esc(g.away.abbrev)} ${s.away}–${s.home} ${esc(g.home.abbrev)}${s.ot ? ' (förl.)' : ''}`;
}

/** Utfall för avslutad match: rätt vinnare, exakt resultat. */
/**
 * Utfall för avslutad match:
 * - SPOT ON!            samma slutresultat och samma avgörande (ordinarie tid resp. förlängning/straffar)
 * - PROGNOSIS POSITIVE  rätt lag vann med rätt avgörande (ordinarie tid resp. förlängning/straffar)
 * - PROGNOSIS NEGATIVE  fel lag vann, eller avgörandet stämde inte (förlängning mot ordinarie tid)
 */
function predResult(g, p) {
  if (g.state !== 'final') return null;
  const winner = g.home.score > g.away.score ? g.home.abbrev : g.away.abbrev;
  const extra = g.outcome === 'OT' || g.outcome === 'SO';
  const how = g.outcome === 'SO' ? 'efter straffar' : g.outcome === 'OT' ? 'efter förlängning' : 'i ordinarie tid';
  const rightTeam = p.winner === winner;
  const exact = p.score.home === g.home.score && p.score.away === g.away.score && !!p.score.ot === extra;
  const v = (cls, label, title) => ({ cls, label, title, exact: cls === 'hit', right: cls !== 'miss' });
  if (exact) return v('hit', 'SPOT ON!', `Exakt rätt resultat – ${winner} vann ${how}`);
  if (!rightTeam) return v('miss', 'PROGNOSIS NEGATIVE', `${winner} vann ${how} – prognosen sa ${p.winner}`);
  if (extra && p.score.ot) return v('ok', 'PROGNOSIS POSITIVE', `${winner} vann ${how}, som prognosen sa`);
  if (extra) return v('miss', 'PROGNOSIS NEGATIVE', `${winner} vann, men ${how} – prognosen sa avgörande i ordinarie tid`);
  if (p.score.ot) return v('miss', 'PROGNOSIS NEGATIVE', `${winner} vann, men i ordinarie tid – prognosen sa förlängning`);
  return v('ok', 'PROGNOSIS POSITIVE', `${winner} vann i ordinarie tid, som prognosen sa`);
}
const verdictBadge = (r) => (r ? `<span class="gp-v ${r.cls}" title="${esc(r.title)}">${r.label}</span>` : '');

function predBar(g, p) {
  return `<div class="pbar" role="img" aria-label="Vinstchans ${esc(g.away.abbrev)} ${pct(p.awayWin)}, ${esc(g.home.abbrev)} ${pct(p.homeWin)}">
    <span class="pa ${p.winner === g.away.abbrev ? 'fav' : ''}" style="width:${(p.awayWin * 100).toFixed(1)}%">${esc(g.away.abbrev)} ${pct(p.awayWin)}</span>
    <span class="ph ${p.winner === g.home.abbrev ? 'fav' : ''}" style="width:${(p.homeWin * 100).toFixed(1)}%">${pct(p.homeWin)} ${esc(g.home.abbrev)}</span>
  </div>`;
}

function predCard(g) {
  const e = predFor(g);
  if (!e) return '';
  const p = e.prediction;
  const conf = Object.values(p.goalies || {}).filter(Boolean);
  const allConfirmed = conf.length === 2 && conf.every((x) => x.confirmed);
  if (g.state === 'pre') {
    const status = e.locked ? `Låst ${hm(e.lockAt)}` : `Prel. ${hm(e.updatedAt)} · låses ${hm(e.lockAt)}`;
    return `<div class="g-pred">
      <div class="gp-top"><span class="gp-l">Prognos</span><b class="gp-s">${predScoreText(g, p)}</b>
        <span class="gp-gk ${allConfirmed ? 'ok' : ''}" title="${allConfirmed ? 'Båda startmålvakterna bekräftade' : 'Startmålvakter ej bekräftade än'}">${allConfirmed ? 'Målvakter ✓' : 'Målvakter ?'}</span></div>
      ${predBar(g, p)}
      <div class="gp-meta">${status}</div>
    </div>`;
  }
  const r = predResult(g, p);
  const verdict = verdictBadge(r);
  return `<div class="g-pred compact"><span class="gp-l">Prognos</span><b class="gp-s">${predScoreText(g, p)}</b>
    <span class="gp-p">${esc(p.winner)} ${pct(Math.max(p.homeWin, p.awayWin))}</span>${verdict}</div>`;
}

function predDetails(g, compact = false) {
  const e = predFor(g);
  if (!e) return '';
  const p = e.prediction;
  const teams = [g.away, g.home];
  const gk = (t) => {
    const x = p.goalies?.[t.abbrev];
    if (!x) return '<span class="none">ej känd</span>';
    return `${esc(x.name)}${x.sv != null ? ` <span class="dim">(${(x.sv * 100).toFixed(1)} %)</span>` : ''} <span class="gk-st ${x.confirmed ? 'ok' : ''}">${x.confirmed ? 'bekräftad' : 'trolig'}</span>`;
  };
  const inj = (t) => {
    const x = p.injuries?.[t.abbrev] || { out: [], back: [] };
    const parts = [];
    if (x.out.length) parts.push(`<span class="dim">Saknas:</span> ${x.out.map(esc).join(', ')}`);
    if (x.back.length) parts.push(`<span class="back">Tillbaka:</span> ${x.back.map(esc).join(', ')}`);
    return parts.join('<br>') || '<span class="none">Inga kända skador</span>';
  };
  const h2h = p.h2h?.n
    ? `<ul class="h2h">${p.h2h.games.map((m) => `<li><span class="dim">${esc(m.date)}</span> ${esc(m.away)} ${m.as}–${m.hs} ${esc(m.home)}${m.so ? ' (str)' : m.ot ? ' (förl.)' : ''}</li>`).join('')}</ul>`
    : '<span class="none">Inga möten de två senaste säsongerna</span>';
  const fac = (p.factors || []).slice(0, 8).map((f) => `<li><span class="ft-team">${esc(f.team)}</span> ${esc(f.text)} <span class="eff ${f.effect > 0 ? 'pos' : f.effect < 0 ? 'neg' : ''}">${f.effect > 0 ? '+' : ''}${f.effect} %</span></li>`).join('');
  const r = predResult(g, p);
  const status = e.locked ? `Låst ${hm(e.lockAt)} (30 min före nedsläpp)` : `Preliminär, uppdaterad ${hm(e.updatedAt)} · nästa uppdatering inom 30 min · låses ${hm(e.lockAt)}`;
  return `<section class="box-pred ${compact ? 'compact' : ''}">
    <div class="bp-head"><h3>Prognos</h3><span class="bp-st">${status}</span></div>
    <div class="bp-score"><b>${predScoreText(g, p)}</b>${r ? ' ' + verdictBadge(r) : ''}
      <span class="dim">Förväntade mål ${p.xg.away.toFixed(2)}–${p.xg.home.toFixed(2)} · förlängning ${pct(p.otChance)}</span></div>
    ${predBar(g, p)}
    <div class="bp-grid">
      <div><h4>Startmålvakter</h4>${teams.map((t) => `<div class="bp-row"><b>${esc(t.abbrev)}</b> ${gk(t)}</div>`).join('')}</div>
      <div><h4>Skador</h4>${teams.map((t) => `<div class="bp-row"><b>${esc(t.abbrev)}</b> <span>${inj(t)}</span></div>`).join('')}</div>
      <div><h4>Inbördes möten</h4>${h2h}</div>
      <div><h4>Det som väger mest</h4><ul class="fac">${fac || '<li class="none">Jämnt – inga tydliga faktorer</li>'}</ul></div>
    </div>
    <p class="pm-foot">Statistisk prognos (Poisson) på säsongsstyrka, formindex, inbördes möten, skador, startmålvakter och back-to-back. Inte spelråd.</p>
  </section>`;
}

function renderPredBox(g) {
  const logo = (t) => `<img src="${esc(darkLogo(t.logo))}" alt="" onerror="this.style.visibility='hidden'">`;
  $('#boxBody').innerHTML = `
    <header class="box-head">
      <div class="bh-team">${logo(g.away)}<div><b>${esc(g.away.abbrev)}</b><span>${esc(g.away.name)}</span></div></div>
      <div class="bh-score"><div class="sc" id="boxTitle" style="font-size:30px">${esc(timeFmt.format(new Date(g.startTimeUTC)))}</div><div class="st">${esc(g.venue || '')}</div></div>
      <div class="bh-team home"><div><b>${esc(g.home.abbrev)}</b><span>${esc(g.home.name)}</span></div>${logo(g.home)}</div>
    </header>
    ${predDetails(g) || '<p class="none">Ingen prognos än – första prognosen läggs kl. 17:00 svensk tid på matchdagen.</p>'}`;
}

const predToggle = $('#predToggle');
predToggle.checked = state.showPreds;
predToggle.addEventListener('change', () => {
  state.showPreds = predToggle.checked;
  store.set('rs.preds', state.showPreds);
  if (state.showPreds) fetchPreds();
  if (state.scores) { renderGames(); renderBox(); }
});

// ---------- Tema ----------
const THEMES = ['auto', 'light', 'dark'];
const THEME_LABEL = { auto: 'Auto (följer enheten)', light: 'Ljust', dark: 'Mörkt' };
const THEME_ICON = {
  auto: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path class="fill" d="M12 4a8 8 0 0 1 0 16z"/></svg>',
  light: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>',
  dark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
};
let themePref = store.get('rs.theme', 'auto');
const mqLight = window.matchMedia?.('(prefers-color-scheme: light)');

function applyTheme() {
  const light = themePref === 'light' || (themePref === 'auto' && !!mqLight?.matches);
  const changed = isLight() !== light;
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#ffffff' : '#0b0f14');
  const b = $('#themeBtn');
  b.innerHTML = THEME_ICON[themePref];
  b.title = `Tema: ${THEME_LABEL[themePref]}`;
  b.setAttribute('aria-label', b.title);
  if (changed && state.scores) renderAll();
  if (changed && radio.nowPlaying()) $('#rbLogo').src = darkLogo(radio.nowPlaying().logo);
}
$('#themeBtn').addEventListener('click', () => {
  themePref = THEMES[(THEMES.indexOf(themePref) + 1) % THEMES.length];
  store.set('rs.theme', themePref);
  applyTheme();
});
mqLight?.addEventListener?.('change', () => { if (themePref === 'auto') applyTheme(); });
applyTheme();

// ---------- Radio ----------
const radioLinks = new Map(); // gameId -> { at, data }

function notice(msg) {
  const d = document.createElement('div');
  d.className = 'toast';
  d.innerHTML = `<div class="t2">${esc(msg)}</div>`;
  $('#toasts').append(d);
  setTimeout(() => d.remove(), 5000);
}

async function handleRadio(gameId, side) {
  const key = `${gameId}-${side}`;
  if (radio.nowPlaying()?.key === key) { radio.stop(); return; }
  const g = state.scores?.games.find((x) => x.id === gameId);
  if (!g) return;
  const team = g[side];
  radio.prime(); // lås upp ljudet inom klicket, innan vi väntar på nätet
  try {
    let c = radioLinks.get(gameId);
    if (!c || Date.now() - c.at > 120_000) {
      const r = await fetch(`/api/radio?gameId=${gameId}`);
      if (!r.ok) throw new Error();
      c = { at: Date.now(), data: await r.json() };
      radioLinks.set(gameId, c);
    }
    const url = c.data[side]?.url;
    if (!url) { notice(`Ingen radiosändning för ${team.name} just nu – den brukar starta strax före nedsläpp.`); return; }
    radio.play({ key, url, logo: team.logo, title: `${team.name} radio`, sub: `${g.away.abbrev} @ ${g.home.abbrev}` });
  } catch {
    notice('Kunde inte hämta radiolänken. Försök igen.');
  }
}

function renderRadio(cur, audio) {
  const bar = $('#radioBar');
  bar.hidden = !cur;
  document.body.classList.toggle('radio-on', !!cur);
  for (const b of document.querySelectorAll('.rbtn')) {
    b.classList.toggle('on', !!cur && cur.key === `${b.dataset.radio}-${b.dataset.side}`);
  }
  if (!cur) return;
  $('#rbLogo').src = darkLogo(cur.logo);
  $('#rbTitle').textContent = cur.title;
  const paused = !audio || audio.paused;
  $('#rbSub').textContent = cur.error ? cur.error : cur.loading ? 'Ansluter…' : paused ? `Pausad · ${cur.sub}` : `Live · ${cur.sub}`;
  bar.classList.toggle('playing', !paused && !cur.loading && !cur.error);
  bar.classList.toggle('err', !!cur.error);
  const t = $('#rbToggle');
  t.innerHTML = paused
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
  t.setAttribute('aria-label', paused ? 'Spela' : 'Pausa');
}
radio.onChange(renderRadio);
$('#rbToggle').addEventListener('click', () => radio.toggle());
$('#rbStop').addEventListener('click', () => radio.stop());

// ---------- Målhorn ----------
let soundOn = store.get('rs.sound', false);
let lastHorn = 0;

function renderSoundBtn() {
  const b = $('#soundBtn');
  const blocked = soundOn && !isUnlocked();
  b.setAttribute('aria-pressed', String(soundOn));
  b.classList.toggle('blocked', blocked);
  b.title = !soundOn ? 'Slå på målhorn' : blocked ? 'Tryck för att aktivera ljudet' : 'Stäng av målhorn';
}

function goalHorn() {
  if (!soundOn) return;
  if (Date.now() - lastHorn < 4000) return; // flera mål i samma uppdatering: ett horn räcker
  if (playHorn()) lastHorn = Date.now();
}

$('#soundBtn').addEventListener('click', async () => {
  if (soundOn && isUnlocked()) {
    soundOn = false;
  } else {
    soundOn = true;
    if (await unlock()) playHorn({ duration: 1.2, volume: 0.4 }); // kort provtut
  }
  store.set('rs.sound', soundOn);
  renderSoundBtn();
});
// Ljud som var påslaget vid förra besöket måste låsas upp med ett tryck någonstans på sidan
document.addEventListener('pointerdown', async () => {
  if (soundOn && !isUnlocked()) { await unlock(); renderSoundBtn(); }
}, { capture: true });
renderSoundBtn();

// ---------- Toast ----------
function toast(g, data) {
  const game = data.games.find((x) => x.id === g.gameId);
  const logo = game ? (game.away.abbrev === g.team ? game.away.logo : game.home.logo) : '';
  const div = document.createElement('div');
  div.className = 'toast';
  div.innerHTML = `
    <img src="${esc(darkLogo(logo))}" alt="">
    <div><div class="t1">MÅL ${esc(g.team)}</div>
    <div class="t2">${pn(g.team, g.scorer)} ${goalTags(g)}</div>
    <div class="t3">${g.assists.length ? 'Assist: ' + g.assists.map((a) => pn(g.team, a.name)).join(', ') : 'Utan assist'} · ${esc(g.away)} ${g.awayScore}–${g.homeScore} ${esc(g.home)}</div></div>`;
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
  setView(tab === 'week' ? 'week' : 'live', false);
  for (const b of document.querySelectorAll('.tabbar button')) b.classList.toggle('active', b.dataset.tab === tab);
  if (tab === 'goals') { state.unseenBadge = 0; if (state.scores) renderHeader(); }
  window.scrollTo({ top: 0 });
}

// ---------- Veckoschema ----------
const week = { which: 'current', sort: store.get('rs.weekSort', 'count'), cache: new Map() };
const wkDay = new Intl.DateTimeFormat('sv-SE', { weekday: 'short', timeZone: 'UTC' });
const wkDate = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'numeric', timeZone: 'UTC' });
const ymdDate = (ymd) => new Date(`${ymd}T12:00:00Z`);

function setView(view, syncTab = true) {
  document.body.dataset.view = view;
  for (const b of document.querySelectorAll('.viewnav button')) b.classList.toggle('on', b.dataset.view === view);
  if (syncTab && window.matchMedia('(max-width: 900px)').matches) {
    // Håll mobilens flikrad i synk om vyn byts via desktop-växeln
    const tab = view === 'week' ? 'week' : (state.tab === 'week' ? 'games' : state.tab);
    if (tab !== state.tab) { setTab(tab); return; }
  }
  if (view === 'week') loadWeek();
}

async function loadWeek() {
  const which = week.which;
  const c = week.cache.get(which);
  if (c?.data) renderWeek(c.data);
  else $('#wkTable').innerHTML = '<div class="empty">Laddar schema…</div>';
  if (c && (c.loading || Date.now() - c.at < 5 * 60_000)) return;
  week.cache.set(which, { ...c, loading: true });
  try {
    const r = await fetch(`/api/week?week=${which}`);
    if (!r.ok) throw new Error(r.status);
    const data = await r.json();
    week.cache.set(which, { at: Date.now(), data, loading: false });
    if (week.which === which && document.body.dataset.view === 'week') renderWeek(data);
  } catch {
    week.cache.set(which, { ...c, at: Date.now(), loading: false });
    if (!c?.data) $('#wkTable').innerHTML = '<div class="empty">Kunde inte hämta schemat. Försök igen om en stund.</div>';
  }
}

function renderWeek(w) {
  for (const b of document.querySelectorAll('[data-week]')) b.classList.toggle('on', b.dataset.week === week.which);
  for (const b of document.querySelectorAll('[data-sort]')) b.classList.toggle('on', b.dataset.sort === week.sort);
  const first = ymdDate(w.start), last = ymdDate(w.end);
  const games = w.days.reduce((n, d) => n + d.count, 0);
  $('#wkSub').textContent = `${wkDay.format(first)} ${wkDate.format(first)} – ${wkDay.format(last)} ${wkDate.format(last)} · ${games} matcher`;

  const teams = [...w.teams];
  if (week.sort === 'name') teams.sort((a, b) => a.abbrev.localeCompare(b.abbrev));
  const counts = teams.map((t) => t.count);
  const max = Math.max(...counts), min = Math.min(...counts);
  const today = w.which === 'current' ? w.start : null; // perioden börjar idag (östkustdatum)
  const logos = Object.fromEntries(w.teams.map((t) => [t.abbrev, t.logo]));
  // Motståndarens form (index ur senaste 10 + aktuell rad): ▲ stark form, ▼ svag form
  const fmtSigned = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
  const formOf = Object.fromEntries(w.teams.map((t) => {
    const f = t.form;
    const txt = f && f.gp ? `form ${fmtSigned(f.index ?? 0)} (senaste ${f.gp}: ${f.w}–${f.l}–${f.otl}, mål ${f.gf}–${f.ga}, ${f.streak > 0 ? `${f.streak} raka vinster` : `${-f.streak} raka förluster`})` : '';
    return [t.abbrev, { trend: f?.trend || null, txt }];
  }));
  const arrow = (ab) => {
    const f = formOf[ab];
    if (f?.trend === 'up') return '<span class="tr up" aria-label="stark form">▲</span>';
    if (f?.trend === 'down') return '<span class="tr down" aria-label="svag form">▼</span>';
    return '';
  };
  const lg = (url) => url ? `<img src="${esc(darkLogo(url))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : '';

  const head = w.days.map((d) => {
    const dt = ymdDate(d.date);
    return `<th class="${d.date === today ? 'today' : ''}"><span class="wd">${wkDay.format(dt)}</span><span class="dd">${wkDate.format(dt)}</span><span class="dn" title="${d.count} matcher den dagen">${d.count}</span></th>`;
  }).join('');
  const rows = teams.map((t) => {
    const byDate = new Map(t.games.map((g) => [g.date, g]));
    const cls = max !== min && t.count === max ? 'hi' : max !== min && t.count === min ? 'lo' : '';
    const cells = w.days.map((d) => {
      const g = byDate.get(d.date);
      if (!g) return `<td class="${d.date === today ? 'today' : ''}"></td>`;
      const title = `${g.home ? 'Hemma mot' : 'Borta mot'} ${g.opp}${g.state === 'final' ? ' (spelad)' : g.state === 'live' ? ' (pågår)' : ''}${g.oppB2b ? ` · ${g.opp} spelade dagen innan` : ''}${formOf[g.opp]?.txt ? ` · ${g.opp} ${formOf[g.opp].txt}` : ''}`;
      return `<td class="g ${g.state} ${d.date === today ? 'today' : ''}" title="${esc(title)}">
        <span class="opp">${lg(logos[g.opp])}<b>${g.home ? '' : '@'}${esc(g.opp)}${arrow(g.opp)}</b></span>${g.oppB2b ? '<i class="b2b">B2B</i>' : ''}</td>`;
    }).join('');
    return `<tr><th class="tm"><span class="tmi">${lg(t.logo)}<span class="ab">${esc(t.abbrev)}</span><span class="nm">${esc(t.name)}</span></span></th>
      <td class="cnt ${cls}"><span>${t.count}</span></td>${cells}</tr>`;
  }).join('');
  $('#wkTable').innerHTML = `
    <table class="wk">
      <thead><tr><th class="tm">Lag</th><th class="cnt">Antal</th>${head}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="wk-note"><b>@</b> = bortamatch · <i class="b2b">B2B</i> = motståndaren spelade dagen innan · gråa rutor är redan spelade · <span class="tr up">▲</span>/<span class="tr down">▼</span> = motståndaren är i stark/svag form (formindex ur senaste 10 matcherna och aktuell rad – håll muspekaren över en match för detaljer).</p>`;
}

for (const b of document.querySelectorAll('.viewnav button')) b.addEventListener('click', () => setView(b.dataset.view));
$('#weekView').addEventListener('click', (e) => {
  const wb = e.target.closest('[data-week]');
  if (wb && wb.dataset.week !== week.which) { week.which = wb.dataset.week; loadWeek(); }
  const sb = e.target.closest('[data-sort]');
  if (sb && sb.dataset.sort !== week.sort) {
    week.sort = sb.dataset.sort; store.set('rs.weekSort', week.sort);
    const c = week.cache.get(week.which); if (c?.data) renderWeek(c.data);
  }
});

function go(date) {
  if (!date || date === state.today) date = null;
  state.date = date;
  state.seen = null;
  state.scores = null;
  state.preds = null;
  $('#games').innerHTML = `<div class="empty">Laddar…</div>`;
  $('#goals').innerHTML = '';
  $('#goalTotal').textContent = '';
  $('#dateText').textContent = date ? dayFmt.format(new Date(`${date}T12:00:00`)) : 'Idag';
  $('#todayBtn').hidden = !date;
  fetchScores();
  if (FANTASY || DEMO) fetchFantasy(); // trupperna för den valda dagen
}

document.querySelector('.tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (b) setTab(b.dataset.tab);
});
$('#prevDate').addEventListener('click', () => state.scores && go(state.scores.prevDate));
$('#nextDate').addEventListener('click', () => state.scores && go(state.scores.nextDate));
$('#todayBtn').addEventListener('click', () => go(null));
const picker = $('#datePick');
// Öppna kalendern direkt vid klick (desktop-Chrome öppnar annars bara via ikonen)
picker.addEventListener('click', () => { try { picker.showPicker?.(); } catch {} });
picker.addEventListener('change', () => { if (picker.value) go(picker.value); });
// Öppna boxscore vid tryck på ett matchkort (inte på NHL-länken)
$('#games').addEventListener('click', (e) => {
  const rb = e.target.closest('.rbtn');
  if (rb) { e.stopPropagation(); handleRadio(Number(rb.dataset.radio), rb.dataset.side); return; }
  if (e.target.closest('a')) return;
  const card = e.target.closest('.game[data-id]');
  if (card && (!card.classList.contains('pre') || card.classList.contains('has-pred'))) openBox(Number(card.dataset.id));
});
$('#games').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  if (e.target.closest('.rbtn, a')) return;
  const card = e.target.closest('.game[data-id]');
  if (card && (!card.classList.contains('pre') || card.classList.contains('has-pred'))) { e.preventDefault(); openBox(Number(card.dataset.id)); }
});
$('#box').addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) closeBox();
  else if (e.target.closest('[data-boxall]')) { state.boxAll = !state.boxAll; renderBox(); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.boxId) closeBox(); });

$('#onlyMine').addEventListener('click', () => { state.onlyMine = !state.onlyMine; store.set('rs.onlyMine', state.onlyMine); renderGoals(); });
$('#sortGoals').addEventListener('click', () => { state.asc = !state.asc; store.set('rs.goalOrderAsc', state.asc); renderGoals(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { fetchScores(); if (FANTASY || DEMO) fetchFantasy(); } });

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
if (FANTASY || DEMO) fetchFantasy();
setInterval(tick, 1000);
