import { nhlFetch, stateOf, etDate } from '../lib/nhl.js';
import { gameStats } from '../lib/fstats.js';
import { query, sendJson } from '../lib/http.js';
import { playersHandler } from '../lib/players.js';

// GET /api/fstats?date=YYYY-MM-DD – fantasystatistik per spelare för dagens pågående/avslutade matcher.
// Används av Matchup-vyn, som summerar veckans dagar och kopplar ihop med inklistrade trupper.
export default async function handler(req, res) {
  if (query(req).get('list') === 'players') return playersHandler(req, res);
  const q = query(req).get('date');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(q || '') ? q : etDate();
  try {
    const sc = await nhlFetch(`/score/${date}`);
    const games = (sc.games || []).filter((g) => stateOf(g.gameState, g.period) !== 'pre');
    const results = await Promise.allSettled(games.map(async (g) => {
      const [box, pbp] = await Promise.all([
        nhlFetch(`/gamecenter/${g.id}/boxscore`),
        nhlFetch(`/gamecenter/${g.id}/play-by-play`),
      ]);
      return { id: g.id, state: stateOf(g.gameState, g.period), players: gameStats(box, pbp) };
    }));
    const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    const live = ok.some((g) => g.state === 'live') || ok.length < games.length;
    const pending = (sc.games || []).some((g) => stateOf(g.gameState, g.period) !== 'final');
    const done = date < etDate() && !live && !pending;
    sendJson(res, 200, {
      date,
      games: ok.map((g) => ({ id: g.id, state: g.state })),
      players: ok.flatMap((g) => g.players.map((p) => ({ ...p, gameId: g.id, live: g.state === 'live' }))),
    }, {
      'Cache-Control': live ? 'public, s-maxage=20, stale-while-revalidate=20'
        : done ? 'public, s-maxage=21600, stale-while-revalidate=3600'
        : 'public, s-maxage=60, stale-while-revalidate=60',
    });
  } catch (err) {
    sendJson(res, 502, { error: 'Kunde inte hämta statistik', detail: String(err.message || err) });
  }
}
