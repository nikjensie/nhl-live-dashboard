import { test } from 'node:test';
import assert from 'node:assert/strict';
import { teamStrength, headToHead, injuryImpact, goalieFactor, outcome, predictGame } from '../lib/predict.js';

test('teamStrength: relativt ligasnitt med regression tidigt på säsongen', () => {
  const s = teamStrength({ gp: 10, gf: 40, ga: 20 }, 3);
  // anfall 4/3 = 1,333 -> (1,333·10 + 10)/20 = 1,167 ; försvar 2/3 -> 0,833
  assert.ok(Math.abs(s.att - 1.1667) < 0.001);
  assert.ok(Math.abs(s.def - 0.8333) < 0.001);
  assert.deepEqual(teamStrength(null, 3), { att: 1, def: 1, gp: 0 });
});

test('headToHead: ur hemmalagets perspektiv, straffmål räknas bort', () => {
  const r = headToHead([
    { date: '2026-01-10', home: 'DET', away: 'VGK', homeScore: 4, awayScore: 1 },
    { date: '2025-11-04', home: 'VGK', away: 'DET', homeScore: 1, awayScore: 0 },
    { date: '2025-03-01', home: 'DET', away: 'VGK', homeScore: 3, awayScore: 2, so: true }, // 2–2 + straffar
  ], 'DET');
  assert.equal(r.n, 3);
  assert.equal(r.wins, 2);
  assert.ok(Math.abs(r.avgDiff - (3 - 1 + 0) / 3) < 1e-9);
  assert.equal(headToHead([], 'DET').n, 0);
});

test('injuryImpact: saknade och återkommande spelare viktas efter poäng per match', () => {
  const skaters = [
    { name: 'Dylan Larkin', gp: 10, points: 12 }, { name: 'Lucas Raymond', gp: 10, points: 10 },
    { name: 'Mason Appleton', gp: 10, points: 3 }, { name: 'Ben Chiarot', gp: 10, points: 1 },
  ];
  const r = injuryImpact([
    { name: 'Dylan Larkin', status: 'Injured Reserve', returnDate: '2026-11-20' },
    { name: 'Mason Appleton', status: 'Day-To-Day', returnDate: '2026-11-05' },
    { name: 'Okänd Spelare', status: 'Out' },
  ], skaters, '2026-11-05');
  assert.deepEqual(r.out.map((x) => x.name), ['Dylan Larkin', 'Okänd Spelare']);
  assert.deepEqual(r.back.map((x) => x.name), ['Mason Appleton']);
  assert.ok(Math.abs(r.missShare - 12 / 26) < 1e-9);
  assert.ok(Math.abs(r.backShare - 3 / 26) < 1e-9);
});

test('goalieFactor: bättre startmålvakt än lagsnittet sänker motståndarens mål', () => {
  const goalies = [{ name: 'John Gibson', gp: 11, gs: 11, sv: 0.86 }, { name: 'Cam Talbot', gp: 5, gs: 5, sv: 0.92 }];
  const talbot = goalieFactor({ name: 'Cam Talbot', confirmed: true }, goalies);
  const gibson = goalieFactor({ name: 'John Gibson', confirmed: false }, goalies);
  assert.ok(talbot.factor < 1);
  assert.ok(gibson.factor > 1);
  assert.equal(talbot.goalie.confirmed, true);
  assert.equal(goalieFactor(null, goalies).factor, 1);
  assert.equal(goalieFactor({ name: 'Ny Målvakt' }, goalies).factor, 1);
});

test('outcome: sannolikheter summerar till 1 och favoriten vinner prognosen', () => {
  const o = outcome(3.4, 2.4);
  assert.ok(Math.abs(o.homeWin + o.awayWin - 1) < 1e-9);
  assert.equal(o.winner, 'home');
  assert.ok(o.score.home > o.score.away);
  const even = outcome(2.8, 2.8);
  assert.ok(Math.abs(even.homeWin - 0.5) < 1e-9);
});

const base = {
  home: 'DET', away: 'VGK', gameDate: '2026-11-05', leagueAvg: 3,
  standings: { DET: { gp: 15, gf: 48, ga: 45 }, VGK: { gp: 15, gf: 45, ga: 45 } },
};

test('predictGame: alla faktorer drar åt rätt håll', () => {
  const p0 = predictGame(base);
  assert.ok(p0.homeWin > 0.5, 'hemmafördel + bättre anfall');
  // Stark form för bortalaget
  const pForm = predictGame({ ...base, form: { VGK: { index: 80 }, DET: { index: -60 } } });
  assert.ok(pForm.homeWin < p0.homeWin);
  // Hemmalaget saknar sin bästa spelare
  const pInj = predictGame({ ...base,
    injuries: { DET: [{ name: 'Dylan Larkin', status: 'Out' }] },
    skaters: { DET: [{ name: 'Dylan Larkin', gp: 15, points: 18 }, { name: 'Lucas Raymond', gp: 15, points: 10 }] } });
  assert.ok(pInj.homeWin < p0.homeWin);
  assert.ok(pInj.factors.some((f) => f.text.includes('Larkin')));
  // Hemmalaget spelade i går
  const pB2b = predictGame({ ...base, playedYesterday: { DET: true } });
  assert.ok(pB2b.homeWin < p0.homeWin);
  // Bortalaget har klart bättre startmålvakt
  const pG = predictGame({ ...base,
    goalies: { VGK: [{ name: 'Adin Hill', gp: 8, gs: 8, sv: 0.93 }, { name: 'Carter Hart', gp: 8, gs: 8, sv: 0.88 }] },
    starters: { VGK: { name: 'Adin Hill', confirmed: true } } });
  assert.ok(pG.homeWin < p0.homeWin);
  assert.equal(pG.goalies.VGK.confirmed, true);
});
