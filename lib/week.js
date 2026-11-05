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
export function buildWeek(scheduleWeeks, standings, start, end) {
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
  // Fyll ut dagar utan matcher så att kolumnerna alltid täcker hela perioden
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (!days.some((x) => x.date === d)) days.push({ date: d, dayAbbrev: null, count: 0 });
  }
  days.sort((x, y) => x.date.localeCompare(y.date));

  const list = [...teams.values()]
    .filter((t) => t.abbrev)
    .map((t) => {
      t.games.sort((x, y) => x.date.localeCompare(y.date));
      // Back-to-back: match även föregående dag
      for (let i = 1; i < t.games.length; i++) {
        if (addDays(t.games[i - 1].date, 1) === t.games[i].date) t.games[i].b2b = true;
      }
      t.played = t.games.filter((g) => g.state === 'final').length;
      return t;
    })
    .sort((x, y) => y.count - x.count || x.name.localeCompare(y.name));
  return { start, end, days, teams: list };
}
