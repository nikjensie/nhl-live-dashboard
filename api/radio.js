import { nhlFetch } from '../lib/nhl.js';
import { query, sendJson } from '../lib/http.js';

// GET /api/radio?gameId=2026020228 – lagens radiosändningar (HLS) för en match.
// NHL lägger ut länkarna (`radioLink`) i matchdetaljerna medan matchen pågår.
const ALLOWED = /^https:\/\/[a-z0-9.-]+\.cloudfront\.net\/[a-z]{2,4}\/\d{8}\/[a-z]{2,4}-radio\.m3u8$/i;

export default async function handler(req, res) {
  const gameId = query(req).get('gameId');
  if (!/^\d{10}$/.test(gameId || '')) return sendJson(res, 400, { error: 'Ogiltigt gameId' });
  try {
    const d = await nhlFetch(`/gamecenter/${gameId}/landing`);
    const side = (t) => {
      const url = typeof t?.radioLink === 'string' && ALLOWED.test(t.radioLink) ? t.radioLink : null;
      return { abbrev: t?.abbrev, name: t?.commonName?.default || t?.abbrev, url };
    };
    sendJson(res, 200, { gameId: Number(gameId), state: d.gameState, away: side(d.awayTeam), home: side(d.homeTeam) },
      { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=120' });
  } catch (err) {
    sendJson(res, 502, { error: 'Kunde inte hämta radiolänkar', detail: String(err.message || err) });
  }
}
