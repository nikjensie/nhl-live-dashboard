// Veckoschema: antal matcher och motståndare per lag, för innevarande vecka (idag–söndag)
// eller nästa vecka (måndag–söndag). Datum räknas i amerikansk östkusttid (NHL:s matchdag).
import { addDays } from './nhl.js';

const txt = (v) => (v && typeof v === 'object' ? v.default ?? '' : v ?? '');

/** { start, end } för 'current' (idag–söndag) eller 'next' (måndag–söndag veckan efter). */
export function weekRange(today, which = 'current') {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = sön … 6 = lör
  const toSunday = (7 - dow) % 7;
  if (which === 'next') {
    const start = addDays(today, toSunday + 1);
    return { start, end: addDays(start, 6) };
  }
  return { start: today, end: addDays(today, toSunday) };
}

function stateOf(gs) {
  if (gs === 'LIVE' || gs === 'CRIT') return 'live';
  if (gs === 'OVER' || gs === 'FINAL' || gs === 'OFF') return 'final';
  return 'pre';
}

/**
 * Bygg veckan ur NHL:s schema (/schedule/{start}, ev. flera sidor) och lagtabellen (/standings/now).
 * Uppskjutna/inställda matcher räknas inte. Lag utan matcher kommer med (antal 0).
 */
export function buildWeek(scheduleWeeks, standings, start, end, historyPages = []) {
  const days = [];
  const teams = new Map();
  const team = (abbrev, info = {}) => {
    if (!teams.has(abbrev)) {
      teams.set(abbrev, { abbrev, name: info.name || abbrev, place: info.place || '', logo: info.logo || null, count: 0, games: [] });
    }
    const t = teams.get(abbrev);
    if (!t.logo && info.logo) t.logo = info.logo;
    if (t.name === abbrev && info.name) t.name = info.name;
    return t;
  };

  for (const s of standings || []) {
    const ab = txt(s.teamAbbrev);
    if (ab) team(ab, { name: txt(s.teamCommonName) || txt(s.teamName), place: txt(s.placeName), logo: s.teamLogo });
  }

  const seenDates = new Set();
  for (const page of scheduleWeeks || []) {
    for (const d of page?.gameWeek || []) {
      if (d.date < start || d.date > end || seenDates.has(d.date)) continue;
      seenDates.add(d.date);
      const games = (d.games || []).filter((g) => (g.gameScheduleState ?? 'OK') === 'OK' && g.gameType !== 1);
      days.push({ date: d.date, dayAbbrev: d.dayAbbrev || null, count: games.length });
      for (const g of games) {
        const a = g.awayTeam || {};
        const h = g.homeTeam || {};
        const info = (t) => ({ name: txt(t.commonName), place: txt(t.placeName), logo: t.logo });
        const base = { id: g.id, date: d.date, startTimeUTC: g.startTimeUTC, state: stateOf(g.gameState) };
        const at = team(a.abbrev, info(a));
        const ht = team(h.abbrev, info(h));
        at.games.push({ ...base, opp: h.abbrev, home: false });
        ht.games.push({ ...base, opp: a.abbrev, home: true });
        at.count++;
        ht.count++;
      }
    }
  }
  days.sort((x, y) => x.date.localeCompare(y.date));

  // Vilka dagar varje lag spelar (även dagarna före perioden), för att se om motståndaren spelade dagen innan
  const playDays = new Map();
  for (const page of [...(historyPages || []), ...(scheduleWeeks || [])]) {
    for (const d of page?.gameWeek || []) {
      for (const g of d.games || []) {
        if ((g.gameScheduleState ?? 'OK') !== 'OK') continue;
        for (const ab of [g.awayTeam?.abbrev, g.homeTeam?.abbrev]) {
          if (!ab) continue;
          if (!playDays.has(ab)) playDays.set(ab, new Set());
          playDays.get(ab).add(d.date);
        }
      }
    }
  }
  // Fyll ut dagar utan matcher så att kolumnerna alltid täcker hela perioden
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (!days.some((x) => x.date === d)) days.push({ date: d, dayAbbrev: null, count: 0 });
  }
  days.sort((x, y) => x.date.localeCompare(y.date));

  const list = [...teams.values()]
    .filter((t) => t.abbrev)
    .map((t) => {
      t.games.sort((x, y) => x.date.localeCompare(y.date));
      // B2B: motståndaren spelade dagen innan (fördel för laget i raden)
      for (const g of t.games) g.oppB2b = !!playDays.get(g.opp)?.has(addDays(g.date, -1));
      t.played = t.games.filter((g) => g.state === 'final').length;
      return t;
    })
    .sort((x, y) => y.count - x.count || x.name.localeCompare(y.name));
  return { start, end, days, teams: list };
}

/**
 * Formindex per lag, byggt på måtten i jordanpolischuk/nhl_trend_tracker (fact_team_day):
 * senaste 10 avgjorda matcher (poäng, mål för/emot) och aktuell vinst-/förlustrad (win_streak).
 *
 *   index = 100 · (0,40·P + 0,35·M + 0,25·R)
 *   P = (poängprocent − 0,5) · 2        poängprocent = (2·V + Fö) / (2·matcher)
 *   M = clamp(målskillnad per match, ±2) / 2
 *   R = clamp(win_streak, ±5) / 5       + raka vinster, − raka förluster (även förl./straffar)
 *
 * trend: 'up' vid index ≥ +35, 'down' vid ≤ −35 (minst 5 matcher), annars null.
 */
export const FORM = { games: 10, minGames: 5, threshold: 35, weights: { points: 0.40, goalDiff: 0.35, streak: 0.25 } };

export function computeForm(schedulePages, opts = FORM) {
  const seen = new Set();
  const results = new Map(); // abbrev -> [{ t, r, gf, ga }]
  const push = (ab, row) => { if (!results.has(ab)) results.set(ab, []); results.get(ab).push(row); };
  for (const page of schedulePages || []) {
    for (const d of page?.gameWeek || []) {
      for (const g of d.games || []) {
        if (seen.has(g.id) || g.gameType === 1) continue;
        if (!['OFF', 'FINAL', 'OVER'].includes(g.gameState)) continue;
        const a = g.awayTeam, h = g.homeTeam;
        if (a?.score == null || h?.score == null || a.score === h.score) continue;
        seen.add(g.id);
        const extra = ['OT', 'SO'].includes(g.gameOutcome?.lastPeriodType ?? g.periodDescriptor?.periodType);
        const t = g.startTimeUTC || d.date;
        const awayWon = a.score > h.score;
        // Vid straffar räknas inte straffmålet i målskillnaden (NHL: 1 mål till vinnaren); använd matchresultatet minus 1
        const so = (g.gameOutcome?.lastPeriodType ?? g.periodDescriptor?.periodType) === 'SO';
        const as = so && awayWon ? a.score - 1 : a.score;
        const hs = so && !awayWon ? h.score - 1 : h.score;
        push(a.abbrev, { t, r: awayWon ? 'W' : extra ? 'OTL' : 'L', gf: as, ga: hs });
        push(h.abbrev, { t, r: awayWon ? (extra ? 'OTL' : 'L') : 'W', gf: hs, ga: as });
      }
    }
  }
  const clamp = (x, m) => Math.max(-m, Math.min(m, x));
  const out = new Map();
  for (const [ab, list] of results) {
    list.sort((x, y) => y.t.localeCompare(x.t)); // nyast först
    const last = list.slice(0, opts.games);
    const gp = last.length;
    const w = last.filter((x) => x.r === 'W').length;
    const otl = last.filter((x) => x.r === 'OTL').length;
    const l = gp - w - otl;
    const gf = last.reduce((n, x) => n + x.gf, 0);
    const ga = last.reduce((n, x) => n + x.ga, 0);
    // win_streak: + raka vinster, − raka förluster (från senaste matchen)
    let streak = 0;
    for (const x of list) {
      const win = x.r === 'W';
      if (streak === 0) streak = win ? 1 : -1;
      else if ((streak > 0) === win) streak += win ? 1 : -1;
      else break;
    }
    // goal_diff_streak: matcher i rad med positiv målskillnad
    let gdStreak = 0;
    for (const x of list) { if (x.gf > x.ga) gdStreak++; else break; }
    let index = null, trend = null;
    if (gp >= opts.minGames) {
      const P = ((2 * w + otl) / (2 * gp) - 0.5) * 2;
      const M = clamp((gf - ga) / gp, 2) / 2;
      const R = clamp(streak, 5) / 5;
      const { points, goalDiff, streak: ws } = opts.weights;
      index = Math.round(100 * (points * P + goalDiff * M + ws * R));
      if (index >= opts.threshold) trend = 'up';
      else if (index <= -opts.threshold) trend = 'down';
    }
    out.set(ab, { trend, index, gp, w, l, otl, gf, ga, streak, gdStreak, last: last.slice(0, 5).map((x) => x.r) });
  }
  return out;
}
