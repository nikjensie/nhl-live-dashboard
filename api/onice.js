import { fetchPbp, fetchShifts, computeOnIce } from '../lib/onice.js';
import { query, sendJson } from '../lib/http.js';

// GET /api/onice?gameId=2026020214 – spelare på isen och +/- för varje mål i matchen.
export default async function handler(req, res) {
  const gameId = query(req).get('gameId');
  if (!/^\d{10}$/.test(gameId || '')) return sendJson(res, 400, { error: 'Ogiltigt gameId' });
  try {
    const [pbp, shifts] = await Promise.all([fetchPbp(gameId), fetchShifts(gameId)]);
    const final = pbp.gameState === 'FINAL' || pbp.gameState === 'OFF';
    const goals = computeOnIce(pbp, shifts);
    const allComplete = Object.values(goals).every((g) => g.complete);
    // Avslutad och komplett: cacha länge. Annars kort, eftersom bytesdata kommer med fördröjning.
    const cache = final && allComplete
      ? 'public, s-maxage=86400, stale-while-revalidate=3600'
      : 'public, s-maxage=30, stale-while-revalidate=30';
    sendJson(res, 200, { gameId: Number(gameId), final, goals }, { 'Cache-Control': cache });
  } catch (err) {
    sendJson(res, 502, { error: 'Kunde inte hämta bytesdata', detail: String(err.message || err) });
  }
}
