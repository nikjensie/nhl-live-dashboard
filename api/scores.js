import { nhlFetch, normalizeGame } from '../lib/nhl.js';
import { query, sendJson } from '../lib/http.js';
import { goalWallTimes } from '../lib/espn.js';

// GET /api/scores[?date=YYYY-MM-DD]
// Matcher + alla mål för dagen. Pågående matcher berikas med play-by-play
// när poänglistan saknar spelsituation.
export default async function handler(req, res) {
  try {
    const date = query(req).get('date');
    const path = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `/score/${date}` : '/score/now';
    const data = await nhlFetch(path);
    const games = data.games || [];

    const needPbp = games.filter(
      (g) => (g.gameState === 'LIVE' || g.gameState === 'CRIT') && !g.situation?.situationCode
    );
    const pbps = await Promise.allSettled(
      needPbp.map((g) => nhlFetch(`/gamecenter/${g.id}/play-by-play`))
    );
    const pbpById = new Map(
      needPbp.map((g, i) => [g.id, pbps[i].status === 'fulfilled' ? pbps[i].value : null])
    );

    const normalized = games.map((g) => normalizeGame(g, pbpById.get(g.id)));
    const allGoals = normalized.flatMap((g) => g.goals);

    // Riktiga klockslag från ESPN där de finns; annars ligger den uppskattade tiden kvar
    const wall = await goalWallTimes(data.currentDate, normalized, allGoals);
    for (const g of allGoals) g.wallTime = wall.get(g.id) || null;

    const when = (g) => g.wallTime || g.estTime || '';
    const goals = allGoals.slice().sort((a, b) => when(a).localeCompare(when(b)));

    sendJson(
      res,
      200,
      {
        date: data.currentDate,
        prevDate: data.prevDate,
        nextDate: data.nextDate,
        fetchedAt: new Date().toISOString(),
        games: normalized.map(({ goals, ...g }) => ({
          ...g,
          lastGoal: goals.length ? goals[goals.length - 1] : null,
          goalCount: goals.length,
        })),
        goals,
      },
      { 'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=10' }
    );
  } catch (err) {
    sendJson(res, 502, { error: 'Kunde inte hämta NHL-data', detail: String(err.message || err) });
  }
}
