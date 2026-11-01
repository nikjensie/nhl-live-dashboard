// TILLFÄLLIG: letar efter radio-/ljudfält i NHL:s live-data. Tas bort efter kontroll.
import { nhlFetch } from '../lib/nhl.js';
import { sendJson } from '../lib/http.js';

function find(obj, path = '', out = []) {
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      const p = path ? `${path}.${k}` : k;
      if (/radio|audio|m3u8|listen/i.test(k) || (typeof v === 'string' && /radio|\.m3u8/i.test(v))) out.push([p, v]);
      if (out.length < 60) find(v, p, out);
    }
  }
  return out;
}

export default async function handler(req, res) {
  const day = await nhlFetch('/score/2026-11-01');
  const result = {};
  for (const g of day.games || []) {
    const entry = { state: g.gameState, score: find(g) };
    if (['LIVE', 'CRIT', 'PRE'].includes(g.gameState)) {
      for (const ep of ['landing', 'right-rail', 'play-by-play']) {
        try { entry[ep] = find(await nhlFetch(`/gamecenter/${g.id}/${ep}`)).slice(0, 15); } catch (e) { entry[ep] = String(e.message); }
      }
    }
    result[`${g.id} ${g.awayTeam.abbrev}@${g.homeTeam.abbrev}`] = entry;
  }
  sendJson(res, 200, result, { 'Cache-Control': 'no-store' });
}
