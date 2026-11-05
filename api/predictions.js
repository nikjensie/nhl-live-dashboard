import { nhlFetch, normalizeGame, etDate, addDays } from '../lib/nhl.js';
import { predictGame } from '../lib/predict.js';
import { gatherContext } from '../lib/predict-data.js';
import { readJson, writeJson } from '../lib/store.js';
import { query, sendJson } from '../lib/http.js';

// GET /api/predictions?date=YYYY-MM-DD
// Prognoser för dagens matcher. Räknas om var 30:e minut och låses 30 minuter före nedsläpp;
// därefter ändras de aldrig (visas även under och efter matchen). Sparas i Vercel Blob.
const REFRESH_MS = 30 * 60_000;
const LOCK_BEFORE_MS = 30 * 60_000;
const OPEN_HOUR_SE = 17; // första preliminära prognosen kl. 17:00 svensk tid på matchdagen

/** UTC-tid (ms) för en lokal klocktid i en tidszon, t.ex. 17:00 i Europe/Stockholm. */
export function zonedTime(ymd, hour, minute = 0, tz = 'Europe/Stockholm') {
  const [y, m, d] = ymd.split('-').map(Number);
  let t = Date.UTC(y, m - 1, d, hour, minute);
  for (let i = 0; i < 2; i++) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(t)).map((p) => [p.type, p.value]));
    const shown = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
    t += Date.UTC(y, m - 1, d, hour, minute) - shown;
  }
  return t;
}
export const openTime = (date) => zonedTime(date, OPEN_HOUR_SE);

/** Vad ska göras med en match just nu? 'keep' | 'compute' | 'none'. openAt = tidigaste första prognos. */
export function planFor(game, stored, now, openAt = 0) {
  const start = Date.parse(game.startTimeUTC);
  const lockAt = start - LOCK_BEFORE_MS;
  if (stored) {
    if (stored.locked || now >= lockAt) return 'keep';
    return now - Date.parse(stored.updatedAt) >= REFRESH_MS ? 'compute' : 'keep';
  }
  // Ingen sparad prognos: först från kl. 17 svensk tid, och aldrig efter att matchen börjat
  return game.state === 'pre' && now >= openAt && now < start ? 'compute' : 'none';
}

export default async function handler(req, res) {
  const q = query(req).get('date');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(q || '') ? q : etDate();
  const now = Date.now();
  try {
    const path = `predictions/${date}.json`;
    const [scores, stored] = await Promise.all([
      nhlFetch(`/score/${date}`),
      readJson(path).catch((e) => { console.error('Blob-läsning:', e.message); return null; }),
    ]);
    const games = (scores.games || []).map((g) => normalizeGame(g));
    const store = stored || { date, games: {} };

    // Räkna bara för dagar nära i tid (inte långt fram eller bakåt)
    const canCompute = date >= addDays(etDate(), -1) && date <= addDays(etDate(), 2);
    const openAt = openTime(date);
    const todo = canCompute ? games.filter((g) => planFor(g, store.games[g.id], now, openAt) === 'compute') : [];

    if (todo.length) {
      const contexts = await gatherContext(date, todo);
      for (const { gameId, ctx, sources } of contexts) {
        const g = todo.find((x) => x.id === gameId);
        const lockAt = Date.parse(g.startTimeUTC) - LOCK_BEFORE_MS;
        store.games[gameId] = {
          updatedAt: new Date(now).toISOString(),
          lockAt: new Date(lockAt).toISOString(),
          // Räknad först efter låstiden (ingen tidigare prognos fanns) -> låst direkt
          locked: now >= lockAt,
          sources,
          prediction: predictGame(ctx),
          matchup: `${ctx.away} @ ${ctx.home}`,
        };
      }
      store.updatedAt = new Date(now).toISOString();
      await writeJson(path, store).catch((e) => console.error('Blob-skrivning:', e.message));
    }

    // Markera låsta i svaret (låsningen bestäms av tiden, så ingen extra skrivning behövs)
    const out = {};
    for (const g of games) {
      const s = store.games[g.id];
      if (!s) continue;
      out[g.id] = { ...s, locked: s.locked || now >= Date.parse(s.lockAt) };
    }
    sendJson(res, 200, { date, generatedAt: new Date(now).toISOString(), opensAt: new Date(openAt).toISOString(), computed: todo.length, games: out },
      { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' });
  } catch (err) {
    sendJson(res, 502, { error: 'Kunde inte ta fram prognoser', detail: String(err.message || err) });
  }
}
