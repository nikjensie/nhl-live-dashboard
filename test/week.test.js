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

import { computeTrends } from '../lib/week.js';
test('computeTrends: tre raka vinster = upp, tre raka förluster (inkl. förl./straffar) = ned', () => {
  let id = 0;
  const game = (date, away, as, home, hs, extra = 'REG', state = 'OFF') => ({
    id: ++id, gameType: 2, gameState: state, startTimeUTC: `${date}T23:00:00Z`,
    awayTeam: { abbrev: away, score: as }, homeTeam: { abbrev: home, score: hs }, gameOutcome: { lastPeriodType: extra },
  });
  const pages = [{ gameWeek: [
    { date: '2026-10-28', games: [game('2026-10-28', 'TOR', 1, 'BOS', 4), game('2026-10-28', 'EDM', 2, 'CGY', 1)] },
    { date: '2026-10-30', games: [game('2026-10-30', 'TOR', 3, 'MTL', 2), game('2026-10-30', 'EDM', 2, 'VAN', 3, 'OT')] },
    { date: '2026-11-01', games: [game('2026-11-01', 'OTT', 1, 'TOR', 5), game('2026-11-01', 'SEA', 4, 'EDM', 1)] },
    { date: '2026-11-03', games: [game('2026-11-03', 'TOR', 4, 'BUF', 3, 'SO'), game('2026-11-03', 'EDM', 2, 'NJD', 3, 'SO'),
      game('2026-11-03', 'BOS', 0, 'MTL', 0, 'REG', 'FUT')] },
  ] }];
  // Samma sida två gånger ska inte dubbelräkna
  const t = computeTrends([...pages, ...pages]);
  assert.deepEqual(t.get('TOR'), { trend: 'up', last: ['W', 'W', 'W'] });
  assert.deepEqual(t.get('EDM'), { trend: 'down', last: ['OTL', 'L', 'OTL'] });
  assert.equal(t.get('BOS').trend, null); // bara en avgjord match
  assert.deepEqual(t.get('BUF').last, ['OTL']);
});

test('buildWeek: B2B när motståndaren spelade dagen före perioden (historik)', () => {
  const sched = [{ gameWeek: [{ date: '2026-11-05', games: [g(1, 'TOR', 'MTL')] }] }];
  const hist = [{ gameWeek: [{ date: '2026-11-04', games: [g(9, 'MTL', 'OTT')] }] }];
  const w = buildWeek(sched, [], '2026-11-05', '2026-11-05', hist);
  assert.equal(w.teams.find((t) => t.abbrev === 'TOR').games[0].oppB2b, true);  // MTL spelade i går
  assert.equal(w.teams.find((t) => t.abbrev === 'MTL').games[0].oppB2b, false); // TOR vilade
});
