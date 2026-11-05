import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekRange, buildWeek } from '../lib/week.js';

test('weekRange: innevarande vecka till söndag, nästa vecka mån–sön', () => {
  // 2026-11-05 är en torsdag
  assert.deepEqual(weekRange('2026-11-05', 'current'), { start: '2026-11-05', end: '2026-11-08' });
  assert.deepEqual(weekRange('2026-11-05', 'next'), { start: '2026-11-09', end: '2026-11-15' });
  // Söndag: innevarande vecka är bara idag, nästa börjar imorgon
  assert.deepEqual(weekRange('2026-11-08', 'current'), { start: '2026-11-08', end: '2026-11-08' });
  assert.deepEqual(weekRange('2026-11-08', 'next'), { start: '2026-11-09', end: '2026-11-15' });
  // Måndag: hela veckan
  assert.deepEqual(weekRange('2026-11-09', 'current'), { start: '2026-11-09', end: '2026-11-15' });
  // Över månadsskifte
  assert.deepEqual(weekRange('2026-11-27', 'next'), { start: '2026-11-30', end: '2026-12-06' });
});

const g = (id, away, home, extra = {}) => ({
  id, gameType: 2, gameState: 'FUT', gameScheduleState: 'OK', startTimeUTC: '2026-11-06T00:00:00Z',
  awayTeam: { abbrev: away, commonName: { default: away + 'n' } }, homeTeam: { abbrev: home, commonName: { default: home + 'n' } },
  ...extra,
});

test('buildWeek: räknar matcher, motståndare, hemma/borta och back-to-back', () => {
  const schedule = [{ gameWeek: [
    { date: '2026-11-04', games: [g(1, 'TOR', 'BOS')] }, // före perioden – ignoreras
    { date: '2026-11-05', dayAbbrev: 'THU', games: [g(2, 'TOR', 'MTL', { gameState: 'OFF' }), g(3, 'EDM', 'CGY')] },
    { date: '2026-11-06', dayAbbrev: 'FRI', games: [g(4, 'BOS', 'TOR')] },
    { date: '2026-11-07', dayAbbrev: 'SAT', games: [g(5, 'TOR', 'OTT', { gameScheduleState: 'PPD' })] },
    { date: '2026-11-08', dayAbbrev: 'SUN', games: [] },
    { date: '2026-11-09', dayAbbrev: 'MON', games: [g(6, 'TOR', 'BUF')] }, // efter perioden
  ] }];
  const standings = [
    { teamAbbrev: { default: 'TOR' }, teamCommonName: { default: 'Maple Leafs' }, teamLogo: 'tor.svg' },
    { teamAbbrev: { default: 'SEA' }, teamCommonName: { default: 'Kraken' }, teamLogo: 'sea.svg' },
  ];
  const w = buildWeek(schedule, standings, '2026-11-05', '2026-11-08');
  assert.deepEqual(w.days.map((d) => [d.date, d.count]), [['2026-11-05', 2], ['2026-11-06', 1], ['2026-11-07', 0], ['2026-11-08', 0]]);
  const tor = w.teams.find((t) => t.abbrev === 'TOR');
  assert.equal(tor.name, 'Maple Leafs');
  assert.equal(tor.count, 2); // uppskjuten match räknas inte
  // B2B gäller motståndaren: MTL spelade inte 4/11, BOS spelade 4/11 men inte 5/11
  assert.deepEqual(tor.games.map((x) => [x.opp, x.home, x.oppB2b, x.state]), [['MTL', false, false, 'final'], ['BOS', true, false, 'pre']]);
  // BOS möter TOR 6/11 och TOR spelade 5/11 -> B2B hos BOS
  assert.equal(w.teams.find((t) => t.abbrev === 'BOS').games[0].oppB2b, true);
  assert.equal(tor.played, 1);
  const sea = w.teams.find((t) => t.abbrev === 'SEA');
  assert.equal(sea.count, 0); // lag utan matcher kommer med
  assert.equal(w.teams[0].abbrev, 'TOR'); // flest matcher först
  assert.equal(w.teams.at(-1).count, 0);
});

import { computeForm } from '../lib/week.js';
test('computeForm: index ur senaste 10 (poäng, målskillnad) och aktuell rad', () => {
  let id = 0;
  const pages = [{ gameWeek: [] }];
  const day = (n) => `2026-10-${String(n).padStart(2, '0')}`;
  const add = (n, away, as, home, hs, extra = 'REG') => {
    pages[0].gameWeek.push({ date: day(n), games: [{
      id: ++id, gameType: 2, gameState: 'OFF', startTimeUTC: `${day(n)}T23:00:00Z`,
      awayTeam: { abbrev: away, score: as }, homeTeam: { abbrev: home, score: hs }, gameOutcome: { lastPeriodType: extra },
    }] });
  };
  // TOR: 8 vinster, 1 förlust, 1 förlust efter förlängning – 4 raka vinster på slutet
  add(1, 'TOR', 4, 'AAA', 1); add(2, 'TOR', 3, 'AAA', 2); add(3, 'TOR', 1, 'AAA', 4); add(4, 'TOR', 5, 'AAA', 2);
  add(5, 'TOR', 2, 'AAA', 3, 'OT'); add(6, 'TOR', 4, 'AAA', 0); add(7, 'TOR', 3, 'AAA', 1); add(8, 'TOR', 5, 'AAA', 1);
  add(9, 'TOR', 4, 'AAA', 2); add(10, 'TOR', 4, 'AAA', 3, 'SO');
  // Äldre match (utanför senaste 10) ska inte påverka
  add(0, 'TOR', 0, 'AAA', 9);
  const f = computeForm([...pages, ...pages]); // dubbletter ignoreras
  const tor = f.get('TOR');
  assert.equal(tor.gp, 10);
  assert.deepEqual([tor.w, tor.l, tor.otl], [8, 1, 1]);
  assert.equal(tor.streak, 5);           // 4 raka + straffvinsten sist
  assert.deepEqual([tor.gf, tor.ga], [34, 19]); // straffmålet räknas inte: 4–3 SO blir 3–3
  assert.equal(tor.index, 79);                   // 100·(0,4·0,7 + 0,35·0,75 + 0,25·1)
  assert.equal(tor.trend, 'up');
  assert.ok(tor.index >= 35);
  const aaa = f.get('AAA');
  assert.equal(aaa.trend, 'down');
  assert.equal(aaa.streak, -5);          // förlust efter straffar räknas som förlust i raden
  assert.equal(aaa.index, -71);                  // 100·(0,4·−0,5 + 0,35·−0,75 + 0,25·−1)
});

test('computeForm: för få matcher ger inget index', () => {
  const pages = [{ gameWeek: [{ date: '2026-10-10', games: [{
    id: 1, gameType: 2, gameState: 'OFF', startTimeUTC: '2026-10-10T23:00:00Z',
    awayTeam: { abbrev: 'X', score: 5 }, homeTeam: { abbrev: 'Y', score: 0 }, gameOutcome: { lastPeriodType: 'REG' },
  }] }] }];
  const f = computeForm(pages);
  assert.equal(f.get('X').index, null);
  assert.equal(f.get('X').trend, null);
  assert.equal(f.get('X').streak, 1);
});

test('buildWeek: B2B när motståndaren spelade dagen före perioden (historik)', () => {
  const sched = [{ gameWeek: [{ date: '2026-11-05', games: [g(1, 'TOR', 'MTL')] }] }];
  const hist = [{ gameWeek: [{ date: '2026-11-04', games: [g(9, 'MTL', 'OTT')] }] }];
  const w = buildWeek(sched, [], '2026-11-05', '2026-11-05', hist);
  assert.equal(w.teams.find((t) => t.abbrev === 'TOR').games[0].oppB2b, true);  // MTL spelade i går
  assert.equal(w.teams.find((t) => t.abbrev === 'MTL').games[0].oppB2b, false); // TOR vilade
});
