import { nhlFetch } from '../lib/nhl.js';
import { query, sendJson } from '../lib/http.js';

// GET /api/boxscore?gameId=2026020218 – NHL:s officiella spelarstatistik för matchen (utespelare).
const txt = (v) => (v && typeof v === 'object' ? v.default ?? '' : v ?? '');
const secs = (t) => { const m = /^(\d+):(\d{2})$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : 0; };

export function normalizeBoxscore(d) {
  const team = (side) => {
    const t = d[side] || {};
    const st = d.playerByGameStats?.[side] || {};
    const skaters = [...(st.forwards || []), ...(st.defense || [])].map((p) => ({
      id: p.playerId,
      num: p.sweaterNumber ?? null,
      name: txt(p.name),
      pos: p.position || null,
      g: p.goals ?? 0,
      a: p.assists ?? 0,
      p: p.points ?? (p.goals ?? 0) + (p.assists ?? 0),
      pm: p.plusMinus ?? 0,
      sog: p.sog ?? 0,
      toi: p.toi || null,
      toiSec: secs(p.toi),
    }));
    return { abbrev: t.abbrev, skaters };
  };
  return { gameId: d.id, state: d.gameState, away: team('awayTeam'), home: team('homeTeam') };
}

export default async function handler(req, res) {
  const gameId = query(req).get('gameId');
  if (!/^\d{10}$/.test(gameId || '')) return sendJson(res, 400, { error: 'Ogiltigt gameId' });
  try {
    const d = await nhlFetch(`/gamecenter/${gameId}/boxscore`);
    const out = normalizeBoxscore(d);
    const final = ['OFF', 'FINAL'].includes(d.gameState);
    sendJson(res, 200, out, {
      'Cache-Control': final ? 'public, s-maxage=3600, stale-while-revalidate=600' : 'public, s-maxage=10, stale-while-revalidate=10',
    });
  } catch (err) {
    sendJson(res, 502, { error: 'Kunde inte hämta boxscore', detail: String(err.message || err) });
  }
}
