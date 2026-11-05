// Datainsamling för matchprognoser (NHL + ESPN) och tolkning till predictGame-format.
import { nhlFetch, addDays } from './nhl.js';
import { matchEvents, ABBR as ESPN_ABBR } from './espn.js';
import { computeForm } from './week.js';

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl';
const txt = (v) => (v && typeof v === 'object' ? v.default ?? '' : v ?? '');
const espnToNhl = (ab) => { const u = String(ab || '').toUpperCase(); return ESPN_ABBR[u] || u; };

// Kort minnescache per varm funktionsinstans
const cache = new Map();
async function cached(key, ttlMs, fn) {
  const c = cache.get(key);
  if (c && Date.now() - c.at < ttlMs) return c.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function espnJson(path) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch(`${ESPN}${path}`, { signal: ctrl.signal, headers: { 'User-Agent': 'nhl-live-dashboard' } });
    if (!r.ok) throw new Error(`ESPN ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

// ---- Tolkning (rena funktioner, testas separat) ----

export function parseStandings(rows) {
  const out = {};
  let gf = 0, gp = 0;
  for (const s of rows || []) {
    const ab = txt(s.teamAbbrev);
    if (!ab) continue;
    out[ab] = { gp: s.gamesPlayed || 0, gf: s.goalFor || 0, ga: s.goalAgainst || 0 };
    gf += s.goalFor || 0; gp += s.gamesPlayed || 0;
  }
  return { standings: out, leagueAvg: gp ? gf / gp : 3.0 };
}

export function parseClubStats(d) {
  return {
    skaters: (d?.skaters || []).map((p) => ({ name: `${txt(p.firstName)} ${txt(p.lastName)}`.trim(), gp: p.gamesPlayed || 0, points: p.points || 0 })),
    goalies: (d?.goalies || []).map((g) => ({
      name: `${txt(g.firstName)} ${txt(g.lastName)}`.trim(), gp: g.gamesPlayed || 0, gs: g.gamesStarted || g.gamesPlayed || 0, sv: g.savePercentage ?? null,
    })),
  };
}

/** Avgjorda möten mellan två lag ur ett lags säsongsschema. */
export function parseMeetings(clubSchedule, a, b, beforeDate) {
  return (clubSchedule?.games || [])
    .filter((g) => (g.gameType === 2 || g.gameType === 3) && ['OFF', 'FINAL'].includes(g.gameState))
    .filter((g) => g.gameDate < beforeDate)
    .filter((g) => {
      const t = [g.awayTeam?.abbrev, g.homeTeam?.abbrev];
      return t.includes(a) && t.includes(b);
    })
    .map((g) => ({
      date: g.gameDate, home: g.homeTeam.abbrev, away: g.awayTeam.abbrev,
      homeScore: g.homeTeam.score, awayScore: g.awayTeam.score,
      ot: g.gameOutcome?.lastPeriodType === 'OT', so: g.gameOutcome?.lastPeriodType === 'SO',
    }));
}

/** ESPN-scoreboard -> { espnEventId, starters: { NHLABBR: { name, confirmed } } } per NHL-match. */
export function parseProbables(event) {
  const starters = {};
  for (const c of event?.competitions?.[0]?.competitors || []) {
    const ab = espnToNhl(c.team?.abbreviation);
    const pr = (c.probables || []).find((p) => p.athlete?.fullName || p.athlete?.displayName);
    if (!ab || !pr) continue;
    const st = String(pr.status?.type || pr.status?.name || '').toLowerCase();
    starters[ab] = { name: pr.athlete.fullName || pr.athlete.displayName, confirmed: st === 'confirmed', status: pr.status?.name || null };
  }
  return starters;
}

/** ESPN-summary -> { NHLABBR: [{ name, status, returnDate }] } */
export function parseInjuries(summary) {
  const out = {};
  for (const t of summary?.injuries || []) {
    const ab = espnToNhl(t.team?.abbreviation);
    if (!ab) continue;
    out[ab] = (t.injuries || []).map((i) => ({
      name: i.athlete?.displayName || i.athlete?.fullName || '',
      status: i.status || i.type?.description || '',
      returnDate: i.details?.returnDate || null,
    })).filter((x) => x.name);
  }
  return out;
}

const seasonOf = (date) => {
  const [y, m] = date.split('-').map(Number);
  const start = m >= 8 ? y : y - 1;
  return `${start}${start + 1}`;
};
const prevSeason = (s) => `${Number(s.slice(0, 4)) - 1}${s.slice(0, 4)}`;

/**
 * Samla allt som behövs för prognoserna en dag. games: normaliserade NHL-matcher
 * ({ id, home: { abbrev, name }, away: { abbrev, name } }) som ska räknas.
 */
export async function gatherContext(date, games) {
  const season = seasonOf(date);
  const teams = [...new Set(games.flatMap((g) => [g.home.abbrev, g.away.abbrev]))];

  const [standingsRows, formPages, espnBoard, ...clubStats] = await Promise.all([
    cached('standings', 10 * 60_000, () => nhlFetch('/standings/now').then((d) => d.standings).catch(() => [])),
    cached(`form:${date}`, 30 * 60_000, () => Promise.all([28, 21, 14, 7].map((n) => nhlFetch(`/schedule/${addDays(date, -n)}`).catch(() => null)))),
    espnJson(`/scoreboard?dates=${date.replace(/-/g, '')}`).catch(() => null),
    ...teams.map((t) => cached(`club:${t}`, 30 * 60_000, () => nhlFetch(`/club-stats/${t}/now`).catch(() => null))),
  ]);
  const { standings, leagueAvg } = parseStandings(standingsRows);
  const formMap = computeForm(formPages);
  const form = Object.fromEntries([...formMap].map(([k, v]) => [k, v]));
  const yesterday = addDays(date, -1);
  const playedYesterday = {};
  for (const page of formPages || []) {
    for (const d of page?.gameWeek || []) {
      if (d.date !== yesterday) continue;
      for (const g of d.games || []) { playedYesterday[g.awayTeam?.abbrev] = true; playedYesterday[g.homeTeam?.abbrev] = true; }
    }
  }
  const stats = Object.fromEntries(teams.map((t, i) => [t, parseClubStats(clubStats[i])]));

  // ESPN: koppla matcher, startmålvakter och skadelistor
  const events = espnBoard ? matchEvents(games, espnBoard) : new Map();
  const byId = new Map((espnBoard?.events || []).map((e) => [e.id, e]));
  const summaries = await Promise.all(games.map((g) => {
    const ev = events.get(g.id);
    return ev ? espnJson(`/summary?event=${ev.id}`).catch(() => null) : null;
  }));

  // Inbördes möten: hemmalagets schema denna och förra säsongen
  const homes = [...new Set(games.map((g) => g.home.abbrev))];
  const schedules = await Promise.all(homes.flatMap((t) => [
    cached(`sched:${t}:${season}`, 30 * 60_000, () => nhlFetch(`/club-schedule-season/${t}/${season}`).catch(() => null)),
    cached(`sched:${t}:${prevSeason(season)}`, 24 * 3600_000, () => nhlFetch(`/club-schedule-season/${t}/${prevSeason(season)}`).catch(() => null)),
  ]));
  const schedByTeam = Object.fromEntries(homes.map((t, i) => [t, [schedules[2 * i], schedules[2 * i + 1]]]));

  return games.map((g, i) => {
    const H = g.home.abbrev, A = g.away.abbrev;
    const ev = events.get(g.id);
    const starters = ev ? parseProbables(byId.get(ev.id)) : {};
    const injuries = parseInjuries(summaries[i]);
    const meetings = (schedByTeam[H] || []).flatMap((s) => parseMeetings(s, H, A, date));
    return {
      gameId: g.id,
      ctx: {
        home: H, away: A, gameDate: date, leagueAvg, standings,
        form: { [H]: form[H] || null, [A]: form[A] || null },
        meetings,
        injuries: { [H]: injuries[H] || [], [A]: injuries[A] || [] },
        skaters: { [H]: stats[H]?.skaters || [], [A]: stats[A]?.skaters || [] },
        goalies: { [H]: stats[H]?.goalies || [], [A]: stats[A]?.goalies || [] },
        starters,
        playedYesterday: { [H]: !!playedYesterday[H], [A]: !!playedYesterday[A] },
      },
      sources: { espn: !!ev, injuries: !!summaries[i], starters: Object.keys(starters).length },
    };
  });
}
