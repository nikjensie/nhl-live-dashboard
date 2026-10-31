// Vilka utespelare var på isen vid varje mål, och vem fick + respektive −.
// Källor: play-by-play (mål, situationCode, rosterSpots med positioner) och shiftcharts (byten).
import { nhlFetch } from './nhl.js';

const STATS = 'https://api.nhle.com/stats/rest/en';

export async function fetchShifts(gameId) {
  const r = await fetch(`${STATS}/shiftcharts?cayenneExp=gameId=${gameId}`, {
    headers: { 'User-Agent': 'nhl-live-dashboard' },
  });
  if (!r.ok) throw new Error(`NHL shiftcharts ${r.status}`);
  return (await r.json()).data || [];
}

export const fetchPbp = (gameId) => nhlFetch(`/gamecenter/${gameId}/play-by-play`);

const txt = (v) => (v && typeof v === 'object' ? v.default ?? '' : v ?? '');
const fixEncoding = (s) => (/Ã|Â/.test(s) ? Buffer.from(s, 'latin1').toString('utf8') : s);
const secs = (mmss) => {
  const m = /^(\d+):(\d{2})$/.exec(mmss || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * Regler för +/-: utespelare på isen får + (målgörande lag) eller − (andra laget) när målet görs
 * i lika numerär eller i boxplay. Powerplaymål och straffslagsmål ger inget +/-.
 * Mål med uttagen målvakt (extra utespelare) räknas – utom om laget även hade numerärt överläge.
 */
export function computeOnIce(pbp, shifts) {
  const gameId = pbp.id;
  const awayId = pbp.awayTeam?.id;
  const homeId = pbp.homeTeam?.id;
  const abbrev = { [awayId]: pbp.awayTeam?.abbrev, [homeId]: pbp.homeTeam?.abbrev };

  const goalies = new Set();
  const roster = new Map();
  for (const p of pbp.rosterSpots || []) {
    if (p.positionCode === 'G') goalies.add(p.playerId);
    roster.set(p.playerId, { num: p.sweaterNumber ?? null, pos: p.positionCode, name: txt(p.lastName) });
  }

  // Bara riktiga byten (typeCode 517), grupperade per period
  const byPeriod = new Map();
  for (const s of shifts) {
    if (s.typeCode !== 517 || goalies.has(s.playerId)) continue;
    const start = secs(s.startTime);
    if (start === null) continue;
    const end = secs(s.endTime);
    const list = byPeriod.get(s.period) || [];
    list.push({
      id: s.playerId,
      teamId: s.teamId,
      start,
      end: end ?? Infinity,
      name: `${s.lastName || ''}`.trim(),
      first: `${s.firstName || ''}`.trim(),
    });
    byPeriod.set(s.period, list);
  }

  const goals = {};
  for (const play of pbp.plays || []) {
    if (play.typeDescKey !== 'goal') continue;
    const pd = play.periodDescriptor || {};
    if (pd.periodType === 'SO') continue;
    const d = play.details || {};
    const period = pd.number;
    const t = secs(play.timeInPeriod);
    const scorerTeam = d.eventOwnerTeamId;
    const otherTeam = scorerTeam === awayId ? homeId : awayId;
    const id = `${gameId}-${period}-${play.timeInPeriod}-${d.scoringPlayerId}`;

    // situationCode: [bortamålvakt, bortautespelare, hemmautespelare, hemmamålvakt]
    const code = String(play.situationCode || '');
    let applies = true;
    let expected = null;
    if (/^\d{4}$/.test(code)) {
      const [ag, as, hs, hg] = code.split('').map(Number);
      const eff = { [awayId]: as - (ag === 0 ? 1 : 0), [homeId]: hs - (hg === 0 ? 1 : 0) };
      expected = { [awayId]: as, [homeId]: hs };
      if (as <= 1 || hs <= 1) applies = false; // straffslag
      else if (eff[scorerTeam] > eff[otherTeam]) applies = false; // powerplaymål
    }

    // På isen: bytet började före målet och slutade vid eller efter målet
    const on = (byPeriod.get(period) || []).filter((s) => s.start < t && s.end >= t);
    const uniq = (teamId) => {
      const seen = new Map();
      for (const s of on) if (s.teamId === teamId && !seen.has(s.id)) {
        // Namn från rosterlistan i första hand (bytesdatan har ibland fel teckenkodning, t.ex. Ã¥ för å)
        seen.set(s.id, { id: s.id, name: roster.get(s.id)?.name || fixEncoding(s.name), num: roster.get(s.id)?.num ?? null });
      }
      return [...seen.values()].sort((a, b) => (a.num ?? 99) - (b.num ?? 99));
    };
    const scoring = uniq(scorerTeam);
    const conceding = uniq(otherTeam);
    const complete = expected
      ? scoring.length >= expected[scorerTeam] && conceding.length >= expected[otherTeam]
      : scoring.length >= 3 && conceding.length >= 3;

    goals[id] = {
      applies,
      complete,
      scoringTeam: abbrev[scorerTeam],
      otherTeam: abbrev[otherTeam],
      scoring,
      conceding,
    };
  }
  return goals;
}
