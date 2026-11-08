import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planFor, zonedTime, openTime } from '../api/predictions.js';
import { parseStandings, parseMeetings, parseProbables, parseInjuries, parseClubStats } from '../lib/predict-data.js';

const start = '2026-11-06T00:00:00Z';
const T = Date.parse(start);
const min = 60_000;
const game = (state = 'pre') => ({ startTimeUTC: start, state });

test('planFor: räkna om var 30:e minut, lås 30 min före nedsläpp, aldrig i efterhand', () => {
  assert.equal(planFor(game(), null, T - 5 * 3600_000), 'compute');            // första prognosen (ingen öppningstid)
  const fresh = { updatedAt: new Date(T - 3 * 3600_000).toISOString() };
  assert.equal(planFor(game(), fresh, T - 3 * 3600_000 + 10 * min), 'keep');  // nyss räknad
  assert.equal(planFor(game(), fresh, T - 3 * 3600_000 + 31 * min), 'compute'); // > 30 min gammal
  const old = { updatedAt: new Date(T - 2 * 3600_000).toISOString() };
  assert.equal(planFor(game(), old, T - 29 * min), 'keep');                    // låst
  assert.equal(planFor(game('live'), old, T + 20 * min), 'keep');              // behålls under match
  assert.equal(planFor(game('final'), old, T + 4 * 3600_000), 'keep');         // och efteråt
  assert.equal(planFor(game(), { ...old, locked: true }, T - 3 * 3600_000), 'keep');
  assert.equal(planFor(game(), null, T - 10 * min), 'compute');                // sen men före start
  assert.equal(planFor(game('live'), null, T + 5 * min), 'none');              // ingen efterhandsprognos
  assert.equal(planFor(game('final'), null, T + 4 * 3600_000), 'none');
});

test('parseStandings: lagrader och ligasnitt', () => {
  const r = parseStandings([
    { teamAbbrev: { default: 'DET' }, gamesPlayed: 10, goalFor: 32, goalAgainst: 28 },
    { teamAbbrev: { default: 'VGK' }, gamesPlayed: 10, goalFor: 28, goalAgainst: 32 },
  ]);
  assert.deepEqual(r.standings.DET, { gp: 10, gf: 32, ga: 28 });
  assert.equal(r.leagueAvg, 3);
});

test('parseMeetings: bara avgjorda möten mellan lagen före matchdagen', () => {
  const sched = { games: [
    { gameType: 2, gameState: 'OFF', gameDate: '2025-11-04', awayTeam: { abbrev: 'DET', score: 0 }, homeTeam: { abbrev: 'VGK', score: 1 }, gameOutcome: { lastPeriodType: 'REG' } },
    { gameType: 2, gameState: 'OFF', gameDate: '2025-12-01', awayTeam: { abbrev: 'DET', score: 3 }, homeTeam: { abbrev: 'BOS', score: 1 } },
    { gameType: 1, gameState: 'OFF', gameDate: '2025-09-25', awayTeam: { abbrev: 'VGK', score: 5 }, homeTeam: { abbrev: 'DET', score: 1 } },
    { gameType: 2, gameState: 'FUT', gameDate: '2026-02-15', awayTeam: { abbrev: 'DET' }, homeTeam: { abbrev: 'VGK' } },
  ] };
  const m = parseMeetings(sched, 'DET', 'VGK', '2026-11-05');
  assert.equal(m.length, 1);
  assert.deepEqual(m[0], { date: '2025-11-04', home: 'VGK', away: 'DET', homeScore: 1, awayScore: 0, ot: false, so: false });
});

test('parseProbables och parseInjuries: ESPN-format till NHL-förkortningar', () => {
  const ev = { competitions: [{ competitors: [
    { team: { abbreviation: 'NJ' }, probables: [{ athlete: { fullName: 'Connor Hellebuyck' }, status: { name: 'Confirmed', type: 'confirmed' } }] },
    { team: { abbreviation: 'STL' }, probables: [{ athlete: { fullName: 'Joel Hofer' }, status: { name: 'Expected', type: 'expected' } }] },
  ] }] };
  assert.deepEqual(parseProbables(ev), {
    NJD: { name: 'Connor Hellebuyck', confirmed: true, status: 'Confirmed' },
    STL: { name: 'Joel Hofer', confirmed: false, status: 'Expected' },
  });
  const inj = parseInjuries({ injuries: [
    { team: { abbreviation: 'DET' }, injuries: [{ status: 'Day-To-Day', athlete: { displayName: 'John Gibson' }, details: { returnDate: '2026-11-05' } }] },
  ] });
  assert.deepEqual(inj, { DET: [{ name: 'John Gibson', status: 'Day-To-Day', returnDate: '2026-11-05' }] });
});

test('parseClubStats: utespelare och målvakter', () => {
  const r = parseClubStats({
    skaters: [{ firstName: { default: 'Dylan' }, lastName: { default: 'Larkin' }, gamesPlayed: 10, points: 12 }],
    goalies: [{ firstName: { default: 'John' }, lastName: { default: 'Gibson' }, gamesPlayed: 11, gamesStarted: 11, savePercentage: 0.86 }],
  });
  assert.deepEqual(r.skaters[0], { name: 'Dylan Larkin', gp: 10, points: 12 });
  assert.deepEqual(r.goalies[0], { name: 'John Gibson', gp: 11, gs: 11, sv: 0.86 });
});

test('öppningstid: första prognosen kl. 15:00 svensk tid på matchdagen', () => {
  // Vintertid (UTC+1) och sommartid (UTC+2)
  assert.equal(new Date(zonedTime('2026-11-05', 17)).toISOString(), '2026-11-05T16:00:00.000Z');
  assert.equal(new Date(zonedTime('2027-04-10', 17)).toISOString(), '2027-04-10T15:00:00.000Z');
  const openAt = openTime('2026-11-05');
  assert.equal(new Date(openAt).toISOString(), '2026-11-05T14:00:00.000Z'); // 15:00 svensk vintertid
  const start = Date.parse('2026-11-06T00:00:00Z'); // 01:00 svensk tid natten efter
  const g = { startTimeUTC: '2026-11-06T00:00:00Z', state: 'pre' };
  assert.equal(planFor(g, null, openAt - 60_000, openAt), 'none');      // 14:59 – inte än
  assert.equal(planFor(g, null, openAt, openAt), 'compute');            // 15:00 – första prognosen
  const s1 = { updatedAt: new Date(openAt).toISOString() };
  assert.equal(planFor(g, s1, openAt + 29 * 60_000, openAt), 'keep');
  assert.equal(planFor(g, s1, openAt + 30 * 60_000, openAt), 'compute'); // 15:30
  assert.equal(planFor(g, s1, start - 30 * 60_000, openAt), 'keep');     // 00:30 – låst
  // Eftermiddagsmatch kl. 18:00 svensk tid: prognos 15:00, uppdateras 15:30 … 17:00, låst 17:30
  const early = { startTimeUTC: '2026-11-05T17:00:00Z', state: 'pre' };
  assert.equal(planFor(early, null, openAt, openAt), 'compute');
  const e1 = { updatedAt: new Date(openAt + 2 * 3600_000).toISOString() };       // senast 17:00
  assert.equal(planFor(early, e1, openAt + 2.5 * 3600_000, openAt), 'keep');   // 17:30 – låst
});
