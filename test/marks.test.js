import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, splitName, leagueTag, nhlAbbr, summarize } from '../public/marks.js';
import { parseRoster } from '../lib/yahoo.js';

const fantasy = {
  leagues: [
    {
      key: 'l1', name: 'Göteborgs Hockeyliga',
      me: { players: [
        { name: 'Luke Hughes', first: 'Luke', last: 'Hughes', team: 'NJ' },
        { name: 'Auston Matthews', first: 'Auston', last: 'Matthews', team: 'TOR' },
        { name: 'Lucas Raymond', first: 'Lucas', last: 'Raymond', team: 'DET', active: false },
        { name: 'James van Riemsdyk', first: 'James', last: 'van Riemsdyk', team: 'CBJ' },
        { name: 'Tim Stützle', first: 'Tim', last: 'Stützle', team: 'OTT' },
      ] },
      opp: { players: [
        { name: 'Jack Hughes', first: 'Jack', last: 'Hughes', team: 'NJ' },
        { name: 'Sebastian Aho', first: 'Sebastian', last: 'Aho', team: 'CAR' },
      ] },
    },
    {
      key: 'l2', name: 'Jobbligan',
      me: { players: [{ name: 'Jack Hughes', first: 'Jack', last: 'Hughes', team: 'NJ' }] },
      opp: { players: [] },
    },
  ],
};

test('splitName hanterar fullt namn, initial och bara efternamn', () => {
  assert.deepEqual(splitName('Luke Hughes'), { init: 'l', last: 'hughes' });
  assert.deepEqual(splitName('L. Hughes'), { init: 'l', last: 'hughes' });
  assert.deepEqual(splitName('Hughes'), { init: '', last: 'hughes' });
  assert.deepEqual(splitName('J. van Riemsdyk'), { init: 'j', last: 'vanriemsdyk' });
});

test('lagförkortningar och ligataggar', () => {
  assert.equal(nhlAbbr('NJ'), 'NJD');
  assert.equal(nhlAbbr('tor'), 'TOR');
  assert.equal(leagueTag('Göteborgs Hockeyliga'), 'GH');
  assert.equal(leagueTag('Jobbligan'), 'JOB');
});

test('lookup skiljer bröder i samma lag via initial', () => {
  const ix = buildIndex(fantasy);
  assert.equal(summarize(ix.lookup('NJD', 'L. Hughes')).side, 'me');
  const jack = ix.lookup('NJD', 'Jack Hughes');
  assert.equal(jack.length, 2);               // motståndare i liga 1, min i liga 2
  assert.equal(summarize(jack).side, 'me');   // egen spelare vinner färgen
  assert.deepEqual(jack.map((h) => h.tag).sort(), ['GH', 'JOB']);
});

test('lookup kräver rätt lag (namnkrock mellan lag)', () => {
  const ix = buildIndex(fantasy);
  assert.equal(ix.lookup('CAR', 'S. Aho').length, 1);
  assert.equal(ix.lookup('NYI', 'S. Aho').length, 0);
});

test('bara efternamn: träff bara om det är entydigt', () => {
  const ix = buildIndex(fantasy);
  assert.equal(ix.lookup('TOR', 'Matthews').length, 1);
  assert.equal(ix.lookup('NJD', 'Hughes').length, 0); // två olika Hughes
});

test('accenter och efternamn med mellanslag', () => {
  const ix = buildIndex(fantasy);
  assert.equal(ix.lookup('OTT', 'T. Stutzle').length, 1);
  assert.equal(ix.lookup('OTT', 'Tim Stützle').length, 1);
  assert.equal(ix.lookup('CBJ', 'J. van Riemsdyk').length, 1);
});

test('bänkspelare markeras som inaktiva', () => {
  const ix = buildIndex(fantasy);
  assert.equal(summarize(ix.lookup('DET', 'L. Raymond')).active, false);
});

test('tomt svar ger tomt index', () => {
  const ix = buildIndex({ loggedIn: false });
  assert.equal(ix.size, 0);
  assert.deepEqual(ix.lookup('TOR', 'A. Matthews'), []);
});

test('parseRoster tolkar Yahoos trupp-JSON', () => {
  const pl = (key, full, first, last, team, slot) => ({
    player: [
      [{ player_key: key }, { player_id: '1' }, { name: { full, first, last } }, { editorial_team_abbr: team }, { display_position: 'C' }],
      { selected_position: [{ coverage_type: 'date', date: '2026-11-01' }, { position: slot }] },
    ],
  });
  const json = { fantasy_content: { team: [
    [{ team_key: '465.l.1.t.3' }],
    { roster: { coverage_type: 'date', date: '2026-11-01', 0: { players: {
      0: pl('465.p.1', 'Auston Matthews', 'Auston', 'Matthews', 'Tor', 'C'),
      1: pl('465.p.2', 'Lucas Raymond', 'Lucas', 'Raymond', 'Det', 'BN'),
      count: 2,
    } } } },
  ] } };
  const r = parseRoster(json);
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], { key: '465.p.1', name: 'Auston Matthews', first: 'Auston', last: 'Matthews', team: 'TOR', pos: 'C', slot: 'C', active: true });
  assert.equal(r[1].active, false);
  assert.equal(r[1].slot, 'BN');
});
