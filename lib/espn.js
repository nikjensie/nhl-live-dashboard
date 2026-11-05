// Riktiga klockslag för mål från ESPN:s öppna API (fältet `wallclock` på varje händelse).
// NHL:s API saknar väggklocketid, så utan detta får målen bara en uppskattad tid.

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl';
const TIMEOUT_MS = 4000;

// Avslutade matcher ändras inte – behåll dem i minnet så länge funktionen är varm
const finalCache = new Map(); // espnEventId -> Map(goalKey -> iso)

// ESPN-förkortningar som skiljer sig från NHL:s
export const ABBR = { NJ: 'NJD', TB: 'TBL', LA: 'LAK', SJ: 'SJS', UTAH: 'UTA', WAS: 'WSH', MON: 'MTL', CLB: 'CBJ', LV: 'VGK', VGS: 'VGK' };
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');

async function getJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'nhl-live-dashboard' } });
    if (!r.ok) throw new Error(`ESPN ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

/** Para ihop NHL-matcher med ESPN-händelser via lagnamn (t.ex. "Bruins") eller förkortning. */
export function matchEvents(games, scoreboard) {
  const out = new Map(); // nhlGameId -> espn event
  const events = scoreboard?.events || [];
  for (const ev of events) {
    const comps = ev.competitions?.[0]?.competitors || [];
    const side = (ha) => comps.find((c) => c.homeAway === ha)?.team || {};
    const eh = side('home');
    const ea = side('away');
    const key = (t) => [norm(t.name || t.shortDisplayName), ABBR[t.abbreviation] || t.abbreviation];
    const [ehName, ehAbbr] = key(eh);
    const [eaName, eaAbbr] = key(ea);
    const g = games.find((x) =>
      (norm(x.home.name) === ehName || x.home.abbrev === ehAbbr) &&
      (norm(x.away.name) === eaName || x.away.abbrev === eaAbbr));
    if (g) out.set(g.id, { id: ev.id, final: ev.status?.type?.completed === true });
  }
  return out;
}

/**
 * Plocka ut målens klockslag ur ESPN:s matchsammanfattning och para ihop dem med NHL:s mål.
 * Paras per period i tidsordning – bara när antalet mål i perioden stämmer, annars hoppas perioden
 * över (då behåller målen sin uppskattade tid). Efternamnet på målgöraren kontrolleras också.
 */
export function pairGoals(nhlGoals, summary) {
  const plays = (summary?.plays || []).filter((p) =>
    p.scoringPlay && p.wallclock && !/shootout/i.test(p.type?.text || '') && !/shootout/i.test(p.period?.displayValue || ''));
  const byPeriod = (list, per) => {
    const m = new Map();
    for (const x of list) {
      const k = per(x);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(x);
    }
    return m;
  };
  const espnP = byPeriod(plays, (p) => p.period?.number);
  const nhlP = byPeriod(nhlGoals, (g) => g.period);
  const result = new Map();
  for (const [period, goals] of nhlP) {
    const ep = (espnP.get(period) || []).slice().sort((a, b) => a.wallclock.localeCompare(b.wallclock));
    if (ep.length !== goals.length) continue;
    const ng = goals.slice().sort((a, b) => a.timeInPeriod.localeCompare(b.timeInPeriod));
    const lastOk = ng.every((g, i) => {
      const last = norm(String(g.scorer).split(' ').pop());
      return !last || norm(ep[i].text || '').includes(last);
    });
    if (!lastOk) continue;
    ng.forEach((g, i) => result.set(g.id, new Date(ep[i].wallclock).toISOString()));
  }
  return result;
}

/** Returnerar Map(nhlGoalId -> ISO-klockslag). Fel hos ESPN ger bara en tom karta. */
export async function goalWallTimes(dateYmd, games, goals) {
  const out = new Map();
  const withGoals = games.filter((g) => g.state !== 'pre' && goals.some((x) => x.gameId === g.id));
  if (!withGoals.length || !dateYmd) return out;
  try {
    const sb = await getJson(`${ESPN}/scoreboard?dates=${dateYmd.replace(/-/g, '')}`);
    const events = matchEvents(withGoals, sb);
    await Promise.allSettled(withGoals.map(async (g) => {
      const ev = events.get(g.id);
      if (!ev) return;
      let times = finalCache.get(ev.id);
      const gameGoals = goals.filter((x) => x.gameId === g.id);
      if (!times || gameGoals.some((x) => !times.has(x.id))) {
        times = pairGoals(gameGoals, await getJson(`${ESPN}/summary?event=${ev.id}`));
        if (ev.final && times.size === gameGoals.length) finalCache.set(ev.id, times);
      }
      for (const [id, iso] of times) out.set(id, iso);
    }));
  } catch (err) {
    console.error('ESPN-klockslag:', err.message || err);
  }
  return out;
}
