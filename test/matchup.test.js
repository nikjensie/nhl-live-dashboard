import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRoster, cleanName, statIndex, sumLines, teamTotals, compare } from '../public/roster.js';
import { gameStats, goalStrength } from '../lib/fstats.js';

const paste = readFileSync(new URL('./fixtures/yahoo-roster.txt', import.meta.url), 'utf8');

test('cleanName: tar bort Yahoos notiser och skadestatus', () => {
  assert.deepEqual(cleanName('Nick SuzukiNew Player Note'), { name: 'Nick Suzuki', status: '' });
  assert.deepEqual(cleanName('Linus UllmarkDTDPlayer Note'), { name: 'Linus Ullmark', status: 'DTD' });
  assert.deepEqual(cleanName('Simon EdvinssonIR-NRNo new player Notes'), { name: 'Simon Edvinsson', status: 'IR-NR' });
  assert.deepEqual(cleanName('J.T. MillerPlayer Note'), { name: 'J.T. Miller', status: '' });
});

test('parseRoster: spelare, platser, lag och kategorier ur inklistrad Yahoo-sida', () => {
  const r = parseRoster(paste);
  assert.equal(r.team, 'Big Chill');
  assert.equal(r.date, '2026-11-12');
  assert.deepEqual(r.skCats, ['G', 'A', 'P', '+/-', 'PPG', 'PPA', 'SHG', 'SHA', 'GWG', 'SOG', 'FW', 'FL', 'HIT', 'BLK']);
  assert.deepEqual(r.gCats, ['W', 'L', 'GA', 'SV', 'SHO']);
  assert.equal(r.players.length, 10);
  const meier = r.players.find((p) => p.name === 'Timo Meier');
  assert.equal(meier.team, 'NJD');
  assert.deepEqual(meier.pos, ['LW', 'RW']);
  assert.equal(r.players.find((p) => p.name === 'J.T. Miller').active, false);
  const ull = r.players.find((p) => p.name === 'Linus Ullmark');
  assert.equal(ull.goalie, true); assert.equal(ull.status, 'DTD'); assert.equal(ull.active, false);
});

test('parseRoster: tabbseparerad inklistring (dator)', () => {
  const r = parseRoster('Pos\tForwards\tPre-Season\tG\tA\nC\tNick Suzuki\tMTL - C\t1:00 am @ BOS\nBN\tJesper Bratt\tNJ - LW,RW\t-');
  assert.deepEqual(r.players.map((p) => [p.slot, p.name, p.team, p.active]), [['C', 'Nick Suzuki', 'MTL', true], ['BN', 'Jesper Bratt', 'NJD', false]]);
  assert.deepEqual(r.skCats, ['G', 'A']);
});

test('statIndex + totaler + jämförelse', () => {
  const r = parseRoster(paste);
  const lines = sumLines([
    { players: [{ id: 1, name: 'Nick Suzuki', team: 'MTL', g: 1, a: 0, p: 1, gp: 1 }, { id: 3, name: 'J.T. Miller', team: 'NYR', g: 2, p: 2, gp: 1 }] },
    { players: [{ id: 1, name: 'Nick Suzuki', team: 'MTL', g: 1, a: 1, p: 2, gp: 1 }] },
  ]);
  const idx = statIndex(lines);
  const byId = new Map(lines.map((l) => [l.id, l]));
  const stats = new Map(r.players.map((p) => [p, byId.get(idx.find(p.team, p.name))]).filter(([, s]) => s));
  assert.equal(stats.get(r.players.find((p) => p.name === 'Nick Suzuki')).g, 2);
  assert.ok(stats.get(r.players.find((p) => p.name === 'J.T. Miller')));
  const me = teamTotals(r, stats);
  assert.equal(me.sk.g, 2); // Miller sitter på bänken och räknas inte
  const opp = { sk: { ...me.sk, g: 3, fl: 1 }, gl: me.gl };
  const { rows, score } = compare(['G', 'A', 'FL'], me, opp);
  assert.deepEqual(rows.map((x) => x.res), ['l', 't', 'w']); // FL: färre är bättre
  assert.deepEqual(score, { w: 1, l: 1, t: 1 });
});

test('goalStrength: PP/SH/EV, uttagen målvakt räknas inte som överläge', () => {
  assert.equal(goalStrength('1451', true), 'PP');
  assert.equal(goalStrength('1451', false), 'SH');
  assert.equal(goalStrength('1551', true), 'EV');
  assert.equal(goalStrength('0651', false), 'EV'); // bortalaget 6 mot 5 med tom bur
  assert.equal(goalStrength('1560', true), 'EV');  // hemmalaget med extra utespelare gör mål
});

test('gameStats: PPA, SHG, GWG, tekningar och hållen nolla', () => {
  const box = {
    gameState: 'OFF',
    homeTeam: { id: 10, abbrev: 'MTL', score: 2 }, awayTeam: { id: 20, abbrev: 'BOS', score: 0 },
    playerByGameStats: {
      homeTeam: {
        forwards: [{ playerId: 1, position: 'C', name: { default: 'N. Suzuki' }, goals: 1, assists: 1, points: 2, plusMinus: 1, hits: 2, blockedShots: 1, sog: 3, pim: 0 },
          { playerId: 2, position: 'RW', name: { default: 'C. Caufield' }, goals: 1, assists: 1, points: 2, plusMinus: 0, sog: 4 }],
        defense: [], goalies: [{ playerId: 3, name: { default: 'S. Montembeault' }, toi: '60:00', starter: true, decision: 'W', goalsAgainst: 0, saves: 30, shotsAgainst: 30 }],
      },
      awayTeam: { forwards: [{ playerId: 4, position: 'C', name: { default: 'E. Lindholm' }, goals: 0 }], defense: [], goalies: [{ playerId: 5, toi: '58:00', decision: 'L', goalsAgainst: 2, saves: 20, shotsAgainst: 22, starter: true }] },
    },
  };
  const pbp = {
    rosterSpots: [{ playerId: 1, firstName: { default: 'Nick' }, lastName: { default: 'Suzuki' } }, { playerId: 2, firstName: { default: 'Cole' }, lastName: { default: 'Caufield' } }],
    gameOutcome: { lastPeriodType: 'REG' },
    plays: [
      { typeDescKey: 'faceoff', details: { winningPlayerId: 1, losingPlayerId: 4 } },
      { typeDescKey: 'goal', situationCode: '1451', periodDescriptor: { periodType: 'REG' }, details: { eventOwnerTeamId: 10, scoringPlayerId: 2, assist1PlayerId: 1 } },
      { typeDescKey: 'goal', situationCode: '1541', periodDescriptor: { periodType: 'REG' }, details: { eventOwnerTeamId: 10, scoringPlayerId: 1, assist1PlayerId: 2 } },
    ],
  };
  const s = Object.fromEntries(gameStats(box, pbp).map((p) => [p.id, p]));
  assert.equal(s[1].name, 'Nick Suzuki');
  assert.equal(s[2].ppg, 1); assert.equal(s[1].ppa, 1);
  assert.equal(s[1].shg, 1); assert.equal(s[2].sha, 1);
  assert.equal(s[2].gwg, 1); // första målet gjorde det till 1–0 (förloraren 0 mål)
  assert.equal(s[1].fw, 1); assert.equal(s[4].fl, 1);
  assert.equal(s[3].sho, 1); assert.equal(s[3].w, 1);
  assert.equal(s[5].l, 1); assert.equal(s[5].sho, 0);
});
