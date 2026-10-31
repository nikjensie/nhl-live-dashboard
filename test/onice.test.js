import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeOnIce } from '../lib/onice.js';

const AWAY = 16, HOME = 6;
const skaters = (team, ids) => ids.map((id) => ({ teamId: team, playerId: id, positionCode: 'C', sweaterNumber: id % 100 }));
const pbpBase = {
  id: 2026020217,
  awayTeam: { id: AWAY, abbrev: 'CHI' },
  homeTeam: { id: HOME, abbrev: 'BOS' },
  rosterSpots: [
    ...skaters(AWAY, [101, 102, 103, 104, 105, 106, 107]),
    ...skaters(HOME, [201, 202, 203, 204, 205, 206, 207]),
    { teamId: AWAY, playerId: 199, positionCode: 'G', sweaterNumber: 1 },
    { teamId: HOME, playerId: 299, positionCode: 'G', sweaterNumber: 30 },
  ],
};
const shift = (teamId, playerId, period, start, end) => ({
  typeCode: 517, teamId, playerId, period, startTime: start, endTime: end, lastName: `P${playerId}`, firstName: 'X',
});
const goal = (period, time, team, scorer, code) => ({
  typeDescKey: 'goal', periodDescriptor: { number: period, periodType: 'REG' }, timeInPeriod: time,
  situationCode: code, details: { eventOwnerTeamId: team, scoringPlayerId: scorer },
});

// P1: första femman på isen 00:00–01:00, andra femman 01:00–02:00. Målvakter hela perioden.
const shifts = [
  ...[101, 102, 103, 104, 105].map((id) => shift(AWAY, id, 1, '00:00', '01:00')),
  ...[201, 202, 203, 204, 205].map((id) => shift(HOME, id, 1, '00:00', '01:00')),
  ...[106, 107, 101, 102, 103].map((id) => shift(AWAY, id, 1, '01:00', '02:00')),
  ...[206, 207, 201, 202, 203].map((id) => shift(HOME, id, 1, '01:00', '02:00')),
  shift(AWAY, 199, 1, '00:00', '20:00'),
  shift(HOME, 299, 1, '00:00', '20:00'),
];

test('mål i lika numerär: rätt spelare får + och −, målvakter exkluderas', () => {
  const r = computeOnIce({ ...pbpBase, plays: [goal(1, '00:40', HOME, 201, '1551')] }, shifts);
  const g = r['2026020217-1-00:40-201'];
  assert.equal(g.applies, true);
  assert.equal(g.complete, true);
  assert.equal(g.scoringTeam, 'BOS');
  assert.deepEqual(g.scoring.map((p) => p.id), [201, 202, 203, 204, 205]);
  assert.deepEqual(g.conceding.map((p) => p.id), [101, 102, 103, 104, 105]);
});

test('mål exakt vid byte: den femma som gick av vid måltiden räknas, inte den som kom in', () => {
  const r = computeOnIce({ ...pbpBase, plays: [goal(1, '01:00', AWAY, 101, '1551')] }, shifts);
  const g = r['2026020217-1-01:00-101'];
  assert.deepEqual(g.scoring.map((p) => p.id), [101, 102, 103, 104, 105]);
  assert.deepEqual(g.conceding.map((p) => p.id), [201, 202, 203, 204, 205]);
});

test('powerplaymål ger inget +/-', () => {
  const r = computeOnIce({ ...pbpBase, plays: [goal(1, '00:40', HOME, 201, '1451')] }, shifts);
  assert.equal(r['2026020217-1-00:40-201'].applies, false);
});

test('boxplaymål ger +/-', () => {
  const r = computeOnIce({ ...pbpBase, plays: [goal(1, '00:40', AWAY, 101, '1451')] }, shifts);
  const g = r['2026020217-1-00:40-101'];
  assert.equal(g.applies, true);
  assert.equal(g.complete, true);
});

test('mål med extra utespelare (tom bur) ger +/-', () => {
  const r = computeOnIce({ ...pbpBase, plays: [goal(1, '00:40', AWAY, 101, '0651')] }, shifts);
  assert.equal(r['2026020217-1-00:40-101'].applies, true);
});

test('bytesdata saknas ännu: markeras som ofullständigt', () => {
  const r = computeOnIce({ ...pbpBase, plays: [goal(1, '05:00', AWAY, 101, '1551')] }, shifts);
  const g = r['2026020217-1-05:00-101'];
  assert.equal(g.complete, false);
  assert.equal(g.scoring.length, 0);
});

test('straffmål i straffläggning ignoreras', () => {
  const so = { ...goal(5, '00:00', AWAY, 101, '1010'), periodDescriptor: { number: 5, periodType: 'SO' } };
  assert.deepEqual(computeOnIce({ ...pbpBase, plays: [so] }, shifts), {});
});
