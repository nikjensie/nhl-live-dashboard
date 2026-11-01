import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchEvents, pairGoals } from '../lib/espn.js';

const games = [
  { id: 1, home: { name: 'Bruins', abbrev: 'BOS' }, away: { name: 'Blackhawks', abbrev: 'CHI' } },
  { id: 2, home: { name: 'Golden Knights', abbrev: 'VGK' }, away: { name: 'Devils', abbrev: 'NJD' } },
  { id: 3, home: { name: 'Kings', abbrev: 'LAK' }, away: { name: 'Lightning', abbrev: 'TBL' } },
];
const comp = (home, away) => ({
  competitions: [{ competitors: [
    { homeAway: 'home', team: home }, { homeAway: 'away', team: away },
  ] }],
});

test('matchEvents: parar via lagnamn och via avvikande förkortningar', () => {
  const sb = { events: [
    { id: 'a', ...comp({ name: 'Bruins', abbreviation: 'BOS' }, { name: 'Blackhawks', abbreviation: 'CHI' }), status: { type: { completed: true } } },
    { id: 'b', ...comp({ name: 'Knights', abbreviation: 'VGK' }, { name: 'X', abbreviation: 'NJ' }) },
    { id: 'c', ...comp({ name: 'Kings', abbreviation: 'LA' }, { name: 'Lightning', abbreviation: 'TB' }) },
  ] };
  const m = matchEvents(games, sb);
  assert.deepEqual(m.get(1), { id: 'a', final: true });
  assert.equal(m.get(2).id, 'b');
  assert.equal(m.get(3).id, 'c');
});

const nhlGoals = [
  { id: 'g1', period: 1, timeInPeriod: '13:05', scorer: 'David Pastrnak' },
  { id: 'g2', period: 2, timeInPeriod: '03:31', scorer: 'Anton Frondell' },
  { id: 'g3', period: 2, timeInPeriod: '15:10', scorer: 'Connor Bedard' },
];
const play = (period, wallclock, text, extra = {}) => ({ scoringPlay: true, period: { number: period }, wallclock, text, type: { text: 'Goal' }, ...extra });

test('pairGoals: parar per period i tidsordning', () => {
  const summary = { plays: [
    play(1, '2026-10-31T17:31:10Z', 'David Pastrnak Goal (5) Wrist Shot'),
    { scoringPlay: false, period: { number: 2 }, wallclock: '2026-10-31T18:00:00Z', text: 'Shot' },
    play(2, '2026-10-31T18:40:00Z', 'Connor Bedard Goal (4)'),
    play(2, '2026-10-31T18:05:00Z', 'Anton Frondell Goal (2)'),
  ] };
  const r = pairGoals(nhlGoals, summary);
  assert.equal(r.get('g1'), '2026-10-31T17:31:10.000Z');
  assert.equal(r.get('g2'), '2026-10-31T18:05:00.000Z');
  assert.equal(r.get('g3'), '2026-10-31T18:40:00.000Z');
});

test('pairGoals: hoppar över en period där antalet mål inte stämmer', () => {
  const summary = { plays: [
    play(1, '2026-10-31T17:31:10Z', 'David Pastrnak Goal'),
    play(2, '2026-10-31T18:05:00Z', 'Anton Frondell Goal'),
  ] };
  const r = pairGoals(nhlGoals, summary);
  assert.ok(r.has('g1'));
  assert.ok(!r.has('g2') && !r.has('g3'));
});

test('pairGoals: hoppar över när målgöraren inte stämmer', () => {
  const summary = { plays: [play(1, '2026-10-31T17:31:10Z', 'Brad Marchand Goal')] };
  assert.equal(pairGoals(nhlGoals, summary).has('g1'), false);
});

test('pairGoals: straffläggning och saknat klockslag ignoreras', () => {
  const summary = { plays: [
    play(1, '2026-10-31T17:31:10Z', 'David Pastrnak Goal'),
    play(5, '2026-10-31T19:40:00Z', 'Pastrnak shootout goal', { type: { text: 'Shootout' } }),
    play(2, null, 'Anton Frondell Goal'),
  ] };
  const r = pairGoals(nhlGoals, summary);
  assert.equal(r.size, 1);
});

test('pairGoals: tom eller saknad sammanfattning ger tom karta', () => {
  assert.equal(pairGoals(nhlGoals, null).size, 0);
  assert.equal(pairGoals(nhlGoals, {}).size, 0);
});
