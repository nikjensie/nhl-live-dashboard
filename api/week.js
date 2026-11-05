import { nhlFetch, etDate, addDays } from '../lib/nhl.js';
import { weekRange, buildWeek } from '../lib/week.js';
import { query, sendJson } from '../lib/http.js';

// GET /api/week?week=current|next – matcher per lag för innevarande vecka (idag–sön) eller nästa (mån–sön).
export default async function handler(req, res) {
  const which = query(req).get('week') === 'next' ? 'next' : 'current';
  try {
    const { start, end } = weekRange(etDate(), which);
    // /schedule/{datum} ger sju dagar framåt; hämta en sida till om perioden skulle sträcka sig längre
    const pages = [nhlFetch(`/schedule/${start}`)];
    if (addDays(start, 7) <= end) pages.push(nhlFetch(`/schedule/${addDays(start, 7)}`));
    const [standings, ...schedule] = await Promise.all([
      nhlFetch('/standings/now').then((d) => d.standings).catch(() => []),
      ...pages,
    ]);
    sendJson(res, 200, { which, ...buildWeek(schedule, standings, start, end) },
      { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' });
  } catch (err) {
    sendJson(res, 502, { error: 'Kunde inte hämta schemat', detail: String(err.message || err) });
  }
}
