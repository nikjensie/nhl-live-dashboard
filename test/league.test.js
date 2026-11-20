import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPin, signToken, verifyToken, publicLeague, applySave, cleanRoster, slug, validPin } from '../lib/league.js';

test('PIN och token', () => {
  assert.ok(validPin('1234')); assert.ok(!validPin('12a4')); assert.ok(!validPin('123'));
  assert.equal(hashPin('L', 'm', '1234'), hashPin('L', 'm', '1234'));
  assert.notEqual(hashPin('L', 'm', '1234'), hashPin('L', 'm2', '1234'));
  const t = signToken({ l: 'L', m: 'm' });
  assert.deepEqual(verifyToken(t), { l: 'L', m: 'm' });
  assert.equal(verifyToken(t.slice(0, -2) + 'xx'), null);
  assert.equal(verifyToken('skräp'), null);
});

test('publicLeague visar aldrig PIN', () => {
  const lg = { id: 'L', name: 'Liga', members: { a: { id: 'a', team: 'Big Chill', pin: 'hemligt', fails: 2 } }, rosters: {} };
  const out = JSON.stringify(publicLeague(lg));
  assert.ok(!out.includes('hemligt')); assert.ok(!out.includes('fails'));
});

test('applySave: motståndaren som är medlem skrivs bara över av nyare inklistring', () => {
  const lg = { id: 'L', members: { a: { id: 'a', team: 'Big Chill' }, b: { id: 'b', team: 'Tomen HC' } }, rosters: {} };
  const r = (team, at) => cleanRoster({ team, pastedAt: at, players: [{ name: 'X', team: 'BOS', pos: ['C'], active: true }] });
  applySave(lg, lg.members.b, r('Tomen HC', '2026-11-13T18:00'), r('Big Chill', '2026-11-13T18:00'));
  assert.equal(lg.members.b.opp, 'a');
  applySave(lg, lg.members.a, r('Big Chill', '2026-11-13T17:00'), r('Tomen HC', '2026-11-13T17:00'));
  assert.equal(lg.members.a.opp, 'b');
  assert.equal(lg.rosters.b.pastedAt, '2026-11-13T18:00'); // äldre inklistring skrev inte över
  // Motståndare som inte är medlem lagras under sitt namn
  applySave(lg, lg.members.a, null, r('Ny Rival', '2026-11-13T19:00'));
  assert.equal(lg.members.a.opp, `t:${slug('Ny Rival')}`);
});

test('cleanRoster tål skräp och begränsar storlek', () => {
  assert.equal(cleanRoster(null), null);
  const r = cleanRoster({ team: 'x'.repeat(500), players: Array.from({ length: 200 }, () => ({ name: 'A', stats: { G: 1, evil: 'x' } })) });
  assert.equal(r.team.length, 60); assert.equal(r.players.length, 60);
  assert.deepEqual(r.players[0].stats, { G: 1 });
});

test('parseStandings läser säsongspoäng och spelade veckor', async () => {
  const { parseStandings } = await import('../lib/yleague.js');
  const html = `<table id="standingstable"><tbody>
    <tr class="Linkable" data-target="/hockey/10098/8"><td><span>1</span></td><td><a href="/hockey/10098/8">Scott Foster's</a></td><td>6-1-0</td><td>.857</td><td>993.90</td><td>6</td><td>34</td></tr>
    <tr class="Linkable" data-target="/hockey/10098/11"><td><span>10</span></td><td><a>Tomen HC</a></td><td>0-7-0</td><td>.000</td><td>782.50</td><td>7</td><td>6</td></tr>
  </tbody></table>`;
  const s = parseStandings(html, '10098');
  assert.deepEqual(s[8], { points: 993.9, played: 7 });
  assert.deepEqual(s[11], { points: 782.5, played: 7 });
});
