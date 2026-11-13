import { nhlFetch } from '../lib/nhl.js';
import { sendJson } from '../lib/http.js';

// GET /api/players – alla spelare i NHL:s aktuella trupper (för spelarväljaren i Matchup-vyn).
// 32 trupper hämtas parallellt och svaret cachas länge på Vercels edge.
export const TEAMS = ['ANA', 'BOS', 'BUF', 'CAR', 'CBJ', 'CGY', 'CHI', 'COL', 'DAL', 'DET', 'EDM', 'FLA', 'LAK', 'MIN', 'MTL', 'NJD',
  'NSH', 'NYI', 'NYR', 'OTT', 'PHI', 'PIT', 'SEA', 'SJS', 'STL', 'TBL', 'TOR', 'UTA', 'VAN', 'VGK', 'WPG', 'WSH'];
const txt = (v) => (v && typeof v === 'object' ? v.default ?? '' : v ?? '');
const POS = { L: 'LW', R: 'RW', C: 'C', D: 'D', G: 'G' };

export function rosterPlayers(team, r) {
  return [...(r.forwards || []), ...(r.defensemen || []), ...(r.goalies || [])].map((p) => ({
    id: p.id, name: `${txt(p.firstName)} ${txt(p.lastName)}`.trim(), team, pos: POS[p.positionCode] || p.positionCode,
  }));
}

export default async function handler(req, res) {
  const results = await Promise.allSettled(TEAMS.map(async (t) => rosterPlayers(t, await nhlFetch(`/roster/${t}/current`))));
  const players = results.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value);
  if (!players.length) return sendJson(res, 502, { error: 'Kunde inte hämta trupperna' });
  sendJson(res, 200, { players, teams: results.filter((r) => r.status === 'fulfilled').length },
    { 'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=86400' });
}
