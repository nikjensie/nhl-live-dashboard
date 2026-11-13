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

test('fantasyPoints: ligans poängsättning', async () => {
  const { fantasyPoints, comparePoints } = await import('../public/roster.js');
  // 1 mål i PP (2+1), 1 assist (1), +1 (1), 4 skott (0,4), 5 FW (0,5), 3 FL (−0,3), 2 HIT (0,2), 1 BLK (0,2) = 6
  const sk = { g: 1, a: 1, p: 2, pm: 1, ppg: 1, ppa: 0, shg: 0, sha: 0, gwg: 0, sog: 4, fw: 5, fl: 3, hit: 2, blk: 1 };
  assert.equal(fantasyPoints(sk, false), 6);
  // Vinst (4) med nolla (5), 30 räddningar (3), 0 insläppta
  assert.equal(fantasyPoints({ w: 1, l: 0, otl: 0, ga: 0, sv: 30, sho: 1 }, true), 12);
  assert.equal(fantasyPoints({ w: 0, l: 1, otl: 0, ga: 4, sv: 20, sho: 0 }, true), -1);
  const t = comparePoints({ G: 2, W: 4 }, { sk: { g: 3 }, gl: { w: 1 } }, { sk: { g: 1 }, gl: { w: 2 } });
  assert.deepEqual(t.total, { me: 10, opp: 10 });
});

test('parsePaste: matchup-sidan ger båda lagen med Yahoos poäng och statistik', async () => {
  const { parsePaste, deltaStats, fantasyPoints } = await import('../public/roster.js');
  const t = parsePaste(readFileSync(new URL('./fixtures/yahoo-matchup.txt', import.meta.url), 'utf8'));
  assert.equal(t.length, 2);
  assert.deepEqual([t[0].team, t[0].manager, t[0].total], ['Big Chill', 'Niklas', 49.6]);
  assert.deepEqual([t[1].team, t[1].total], ['Tomen HC', 57.3]);
  const suzuki = t[0].players.find((p) => p.name === 'Nick Suzuki');
  assert.equal(suzuki.fp, 4.7);
  assert.equal(suzuki.stats.FW, 13);
  assert.equal(t[0].players.find((p) => p.name === 'Matty Beniers').stats, undefined); // inga matcher än
  const frost = t[0].players.find((p) => p.name === 'Morgan Frost');
  assert.equal(frost.slot, '--'); assert.equal(frost.active, false);
  // Yahoos poäng per spelare stämmer med ligans poängsättning
  for (const p of t.flatMap((x) => x.players).filter((p) => p.stats)) {
    const keyed = { g: 0, a: 0, p: 0, pm: 0, ppg: 0, ppa: 0, shg: 0, sha: 0, gwg: 0, sog: 0, fw: 0, fl: 0, hit: 0, blk: 0, w: 0, l: 0, otl: 0, ga: 0, sv: 0, sho: 0 };
    const map = { G: p.goalie ? null : 'g', A: 'a', P: 'p', '+/-': 'pm', PPG: 'ppg', PPA: 'ppa', SHG: 'shg', SHA: 'sha', GWG: 'gwg', SOG: 'sog', FW: 'fw', FL: 'fl', HIT: 'hit', BLK: 'blk', W: 'w', L: 'l', GA: 'ga', SV: 'sv', SHO: 'sho' };
    for (const [c, v] of Object.entries(p.stats)) if (map[c]) keyed[map[c]] = v;
    assert.equal(fantasyPoints(keyed, p.goalie), p.fp, p.name);
  }
  // Ny statistik efter inklistringen: ett mål till
  const nhl = { g: 2, a: 0, p: 2, pm: 1, ppg: 0, ppa: 0, shg: 0, sha: 0, gwg: 0, sog: 4, fw: 13, fl: 2, hit: 1, blk: 1 };
  assert.equal(fantasyPoints(deltaStats(suzuki, nhl), false), 2.1);
  // NHL-datan ligger efter (färre skott än Yahoo): inget extra räknas
  assert.equal(fantasyPoints(deltaStats(suzuki, { ...nhl, g: 1, sog: 2 }), false), 0);
});

test('plock och släpp: bara statistiken medan spelaren är i laget räknas', async () => {
  const { countedStats, snapshot, fantasyPoints, counts, teamTotals } = await import('../public/roster.js');
  const before = { g: 1, a: 0, p: 1, pm: 0, sog: 3, fw: 0, fl: 0, hit: 0, blk: 0, gp: 1 };
  const after = { ...before, g: 2, p: 2, sog: 5, gp: 2 };
  // Plockad efter första matchen: bara andra matchen räknas (mål 2 p + 2 skott 0,2)
  const added = { active: true, from: snapshot(before) };
  assert.equal(fantasyPoints(countedStats(added, after, false), false), 2.2);
  // Släppt efter första matchen: andra matchen räknas inte
  const dropped = { active: false, wasActive: true, to: snapshot(before) };
  assert.equal(fantasyPoints(countedStats(dropped, after, false), false), 2.3);
  assert.ok(counts(dropped));
  assert.ok(!counts({ active: false, wasActive: false, to: {} }));
  // Släppt från bänken räknas inte i lagets total
  const roster = { players: [dropped, { active: false, wasActive: false, to: snapshot(before) }] };
  const st = new Map(roster.players.map((p) => [p, countedStats(p, after, false)]));
  assert.equal(teamTotals(roster, st).sk.g, 1);
});

test('rosterPlayers: NHL-trupp till spelarlista', async () => {
  const { rosterPlayers } = await import('../api/players.js');
  const list = rosterPlayers('BOS', { forwards: [{ id: 1, firstName: { default: 'David' }, lastName: { default: 'Pastrnak' }, positionCode: 'R' }], defensemen: [], goalies: [{ id: 2, firstName: { default: 'Jeremy' }, lastName: { default: 'Swayman' }, positionCode: 'G' }] });
  assert.deepEqual(list, [{ id: 1, name: 'David Pastrnak', team: 'BOS', pos: 'RW' }, { id: 2, name: 'Jeremy Swayman', team: 'BOS', pos: 'G' }]);
});
