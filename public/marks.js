// Markering av fantasyspelare: kopplar Yahoo-trupperna till NHL-namnen i appen.
// Yahoo och NHL har olika spelar-ID, så kopplingen görs på lag + efternamn + förnamnsinitial.

// Yahoo-förkortningar som skiljer sig från NHL:s
const ABBR = {
  NJ: 'NJD', TB: 'TBL', LA: 'LAK', SJ: 'SJS', UTAH: 'UTA', UTH: 'UTA', WAS: 'WSH',
  MON: 'MTL', CLS: 'CBJ', CLB: 'CBJ', LV: 'VGK', VEG: 'VGK', VGS: 'VGK', NAS: 'NSH', CAL: 'CGY', WIN: 'WPG',
};
export const nhlAbbr = (a) => { const u = String(a || '').toUpperCase(); return ABBR[u] || u; };

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');

/** "Luke Hughes" | "L. Hughes" | "Hughes" -> { init: 'l' | '', last: 'hughes' } */
export function splitName(name) {
  const s = String(name || '').trim();
  const m = /^([A-Za-zÀ-ÿ])[A-Za-zÀ-ÿ'-]*\.?\s+(.+)$/.exec(s);
  if (m) return { init: norm(m[1]), last: norm(m[2]) };
  return { init: '', last: norm(s) };
}

/** Förkortning av liganamn: "Göteborgs Hockeyliga" -> "GH" */
export function leagueTag(name) {
  const words = String(name || '').split(/\s+/).filter((w) => /[A-Za-zÅÄÖåäö0-9]/.test(w));
  const tag = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] || '?').slice(0, 3);
  return tag.slice(0, 3).toUpperCase();
}

/**
 * Bygg index från /api/fantasy-svaret.
 * Returnerar { size, leagues: number, lookup(team, name) -> [{ side, league, tag, active }] }.
 */
export function buildIndex(fantasy) {
  const byFull = new Map(); // team|init|last
  const byLast = new Map(); // team|last
  let size = 0;
  const leagues = (fantasy?.leagues || []).filter((l) => l.me?.players?.length || l.opp?.players?.length);
  const tags = new Map();
  for (const l of leagues) {
    let t = leagueTag(l.name);
    while ([...tags.values()].includes(t)) t += '·';
    tags.set(l.key, t);
  }
  const push = (map, k, v) => { if (!map.has(k)) map.set(k, []); map.get(k).push(v); };
  for (const l of leagues) {
    for (const side of ['me', 'opp']) {
      for (const p of l[side]?.players || []) {
        const team = nhlAbbr(p.team);
        const first = p.first || String(p.name).split(' ')[0];
        const last = p.last || String(p.name).split(' ').slice(1).join(' ');
        const entry = { side, league: l.name, tag: tags.get(l.key), active: p.active !== false, name: p.name };
        push(byFull, `${team}|${norm(first)[0] || ''}|${norm(last)}`, entry);
        push(byLast, `${team}|${norm(last)}`, entry);
        size++;
      }
    }
  }
  function lookup(team, name) {
    if (!size || !name) return [];
    const t = nhlAbbr(team);
    const { init, last } = splitName(name);
    if (init) {
      const hit = byFull.get(`${t}|${init}|${last}`);
      if (hit) return hit;
      // "Luke Hughes" där Yahoo har efternamn med mellanslag: prova hela strängen som efternamn
    }
    const cands = byLast.get(`${t}|${last}`) || [];
    // Bara efternamn: godta om alla träffar gäller samma spelare
    const names = new Set(cands.map((c) => c.name));
    if (!init && names.size === 1) return cands;
    if (init && names.size === 1 && cands.every((c) => norm(c.name.split(' ')[0])[0] === init)) return cands;
    return [];
  }
  return { size, leagues: leagues.length, lookup };
}

/** Sammanfatta träffar: vilken färg (me vinner över opp) och vilka ligor. */
export function summarize(hits) {
  if (!hits.length) return null;
  const side = hits.some((h) => h.side === 'me') ? 'me' : 'opp';
  const active = hits.some((h) => h.active);
  return { side, active, hits };
}
