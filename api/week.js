import { nhlFetch, etDate, addDays } from '../lib/nhl.js';
import { weekRange, buildWeek, computeTrends } from '../lib/week.js';
import { query, sendJson } from '../lib/http.js';

// GET /api/week?week=current|next – matcher per lag för innevarande vecka (idag–sön) eller nästa (mån–sön).
export default async function handler(req, res) {
  const which = query(req).get('week') === 'next' ? 'next' : 'current';
  try {
    const today = etDate();
    const { start, end } = weekRange(today, which);
    // /schedule/{datum} ger sju dagar framåt; hämta en sida till om perioden skulle sträcka sig längre
    const pages = [nhlFetch(`/schedule/${start}`)];
    if (addDays(start, 7) <= end) pages.push(nhlFetch(`/schedule/${addDays(start, 7)}`));
    // Historik för trenden: de senaste 14 dagarna (+ idag, som redan ingår när veckan börjar idag)
    const hist = [addDays(today, -14), addDays(today, -7)];
    if (start !== today) hist.push(today);
    const [standings, histPages, ...schedule] = await Promise.all([
      nhlFetch('/standings/now').then((d) => d.standings).catch(() => []),
      Promise.all(hist.map((d) => nhlFetch(`/schedule/${d}`).catch(() => null))),
      ...pages,
    ]);
    const week = buildWeek(schedule, standings, start, end, histPages);
    const trends = computeTrends([...histPages, ...schedule]);
    for (const t of week.teams) Object.assign(t, trends.get(t.abbrev) || { trend: null, last: [] });
    sendJson(res, 200, { which, ...week },
      { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' });
  } catch (err) {
    sendJson(res, 502, { error: 'Kunde inte hämta schemat', detail: String(err.message || err) });
  }
}
