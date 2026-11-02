import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSituation, normalizeGame, stateOf } from '../lib/nhl.js';
import { parseUserLeagues, parseUserTeamKeys, parseStatCategories, parseScoreboard } from '../lib/yahoo.js';

test('situationCode: 5 mot 5', () => {
  const s = parseSituation('1551', 'TOR', 'BOS');
  assert.equal(s.type, 'EV');
  assert.equal(s.strength, '5 mot 5');
  assert.deepEqual(s.emptyNet, []);
});

test('situationCode: hemmalaget i powerplay', () => {
  const s = parseSituation('1451', 'TOR', 'BOS');
  assert.equal(s.type, 'PP');
  assert.equal(s.ppTeam, 'BOS');
  assert.equal(s.shTeam, 'TOR');
});

test('situationCode: bortalaget i powerplay 5 mot 3', () => {
  const s = parseSituation('1531', 'TOR', 'BOS');
  assert.equal(s.ppTeam, 'TOR');
});

test('situationCode: tom bur 6 mot 5 är inte powerplay', () => {
  const s = parseSituation('0651', 'EDM', 'COL');
  assert.equal(s.type, 'EV');
  assert.deepEqual(s.emptyNet, ['EDM']);
});

test('situationCode: PP-lag tar ut målvakten (6 mot 4)', () => {
  // Bortalaget i PP (5 mot 4) och tar ut målvakten -> 6 mot 4
  const s = parseSituation('0641', 'EDM', 'COL');
  assert.equal(s.type, 'PP');
  assert.equal(s.ppTeam, 'EDM');
  assert.deepEqual(s.emptyNet, ['EDM']);
});

test('situationCode: 4 mot 4 och 3 mot 3', () => {
  assert.equal(parseSituation('1441', 'A', 'B').type, 'EV');
  assert.equal(parseSituation('1331', 'A', 'B').strength, '3 mot 3');
});

test('situationCode: ogiltig', () => {
  assert.equal(parseSituation(undefined, 'A', 'B'), null);
  assert.equal(parseSituation('15', 'A', 'B'), null);
});

const sampleGame = {
  id: 2026020214, gameState: 'LIVE', startTimeUTC: '2026-10-31T02:00:00Z', venue: { default: 'T-Mobile Arena' },
  awayTeam: { id: 1, name: { default: 'Devils' }, abbrev: 'NJD', score: 2, sog: 20, logo: 'https://assets.nhle.com/logos/nhl/svg/NJD_light.svg' },
  homeTeam: { id: 54, name: { default: 'Golden Knights' }, abbrev: 'VGK', score: 1, sog: 18, logo: 'x' },
  clock: { timeRemaining: '12:01', secondsRemaining: 721, running: true, inIntermission: false },
  period: 2, periodDescriptor: { number: 2, periodType: 'REG' },
  situation: {
    homeTeam: { abbrev: 'VGK', situationDescriptions: ['PP'], strength: 5 },
    awayTeam: { abbrev: 'NJD', strength: 4 },
    situationCode: '1451', timeRemaining: '01:12', secondsRemaining: 72,
  },
  goals: [
    {
      period: 1, periodDescriptor: { number: 1, periodType: 'REG' }, timeInPeriod: '05:38', playerId: 8481559,
      name: { default: 'L. Hughes' }, firstName: { default: 'Luke' }, lastName: { default: 'Hughes' },
      goalModifier: 'none', assists: [{ playerId: 1, name: { default: 'N. Hischier' }, assistsToDate: 5 }],
      teamAbbrev: 'NJD', goalsToDate: 3, awayScore: 1, homeScore: 0, strength: 'ev',
    },
    {
      period: 2, periodDescriptor: { number: 2, periodType: 'REG' }, timeInPeriod: '02:10', playerId: 2,
      name: { default: 'J. Eichel' }, firstName: { default: 'Jack' }, lastName: { default: 'Eichel' },
      goalModifier: 'empty-net', assists: [], teamAbbrev: 'VGK', goalsToDate: 7, awayScore: 1, homeScore: 1, strength: 'sh',
    },
  ],
};

test('normalizeGame: live med situation, mål och assist', () => {
  const g = normalizeGame(sampleGame);
  assert.equal(g.state, 'live');
  assert.equal(g.situation.ppTeam, 'VGK');
  assert.equal(g.situation.secondsRemaining, 72);
  assert.equal(g.goals.length, 2);
  assert.equal(g.goals[0].scorer, 'Luke Hughes');
  assert.equal(g.goals[0].assists[0].name, 'N. Hischier');
  assert.equal(g.goals[0].assists[0].total, 5);
  assert.equal(g.goals[1].modifier, 'empty-net');
  assert.equal(g.goals[1].strength, 'sh');
  assert.ok(g.goals[0].estTime < g.goals[1].estTime);
});

test('normalizeGame: situation från play-by-play när poänglistan saknar den', () => {
  const { situation, ...noSit } = sampleGame;
  const g = normalizeGame(noSit, { plays: [{ situationCode: '1551' }, { situationCode: '1541' }] });
  assert.equal(g.situation.ppTeam, 'NJD');
});

test('normalizeGame: avslutad match har ingen situation, straffmål filtreras', () => {
  const g = normalizeGame({
    ...sampleGame, gameState: 'OFF',
    goals: [...sampleGame.goals, { ...sampleGame.goals[0], periodDescriptor: { number: 5, periodType: 'SO' } }],
  });
  assert.equal(g.state, 'final');
  assert.equal(g.situation, null);
  assert.equal(g.goals.length, 2);
});

// ---- Yahoo (struktur enligt Yahoo Fantasy API:s JSON-format) ----
const usersLeagues = {
  fantasy_content: {
    users: {
      0: {
        user: [
          { guid: 'ABC' },
          {
            games: {
              0: {
                game: [
                  { game_key: '465', code: 'nhl', season: '2026' },
                  {
                    leagues: {
                      0: { league: [{ league_key: '465.l.111', name: 'Liga A', url: 'https://hockey.fantasysports.yahoo.com/hockey/111', scoring_type: 'head', current_week: 4 }] },
                      1: { league: [{ league_key: '465.l.222', name: 'Liga B', url: 'u', scoring_type: 'headpoint', current_week: 4 }] },
                      count: 2,
                    },
                  },
                ],
              },
              count: 1,
            },
          },
        ],
      },
      count: 1,
    },
  },
};

const usersTeams = {
  fantasy_content: {
    users: {
      0: {
        user: [
          { guid: 'ABC' },
          {
            games: {
              0: {
                game: [
                  { game_key: '465' },
                  {
                    teams: {
                      0: { team: [[{ team_key: '465.l.111.t.3' }, { team_id: '3' }, { name: 'Mitt lag' }]] },
                      1: { team: [[{ team_key: '465.l.222.t.7' }, { name: 'Mitt andra lag' }]] },
                      count: 2,
                    },
                  },
                ],
              },
              count: 1,
            },
          },
        ],
      },
      count: 1,
    },
  },
};

const settings = {
  fantasy_content: {
    league: [
      { league_key: '465.l.111' },
      {
        settings: [
          {
            stat_categories: {
              stats: [
                { stat: { stat_id: 1, display_name: 'G', sort_order: '1' } },
                { stat: { stat_id: 2, display_name: 'A', sort_order: '1' } },
                { stat: { stat_id: 23, display_name: 'GAA', sort_order: '0' } },
                { stat: { stat_id: 22, display_name: 'GA', sort_order: '0', is_only_display_stat: '1' } },
              ],
            },
          },
        ],
      },
    ],
  },
};

const teamObj = (key, name, stats, points) => ({
  team: [
    [{ team_key: key }, { team_id: '1' }, { name }, { url: 'u' }, { team_logos: [{ team_logo: { size: 'large', url: `https://logo/${key}` } }] }, { managers: [{ manager: { nickname: 'Nick' } }] }],
    { team_stats: { coverage_type: 'week', week: '4', stats: stats.map(([id, v]) => ({ stat: { stat_id: String(id), value: v } })) }, team_points: { coverage_type: 'week', week: '4', total: points } },
  ],
});

const scoreboard = {
  fantasy_content: {
    league: [
      { league_key: '465.l.111', current_week: 4 },
      {
        scoreboard: {
          0: {
            matchups: {
              0: {
                matchup: {
                  week: '4', status: 'midevent', is_playoffs: '0',
                  stat_winners: [
                    { stat_winner: { stat_id: '1', winner_team_key: '465.l.111.t.3' } },
                    { stat_winner: { stat_id: '2', winner_team_key: '465.l.111.t.9' } },
                    { stat_winner: { stat_id: '23', is_tied: 1 } },
                  ],
                  0: { teams: { 0: teamObj('465.l.111.t.9', 'Motståndare', [[1, '5'], [2, '9'], [23, '2.50']], '1'), 1: teamObj('465.l.111.t.3', 'Mitt lag', [[1, '7'], [2, '8'], [23, '2.50']], '1'), count: 2 } },
                },
              },
              1: { matchup: { week: '4', 0: { teams: { 0: teamObj('465.l.111.t.1', 'X', [], '0'), 1: teamObj('465.l.111.t.2', 'Y', [], '0'), count: 2 } } } },
              count: 2,
            },
          },
          week: '4',
        },
      },
    ],
  },
};

test('Yahoo: ligor och egna lag', () => {
  const leagues = parseUserLeagues(usersLeagues);
  assert.deepEqual(leagues.map((l) => l.league_key), ['465.l.111', '465.l.222']);
  const keys = parseUserTeamKeys(usersTeams);
  assert.ok(keys.has('465.l.111.t.3') && keys.has('465.l.222.t.7'));
});

test('Yahoo: scoreboard hittar min matchup och räknar kategorier', () => {
  const cats = parseStatCategories(settings);
  assert.equal(cats.get('23').name, 'GAA');
  const r = parseScoreboard(scoreboard, new Set(['465.l.111.t.3']), cats);
  assert.equal(r.me.name, 'Mitt lag');
  assert.equal(r.opp.name, 'Motståndare');
  assert.equal(r.me.logo, 'https://logo/465.l.111.t.3');
  assert.equal(r.me.manager, 'Nick');
  assert.deepEqual(r.record, { wins: 1, losses: 1, ties: 1 });
  assert.equal(r.categories.length, 3); // GA är bara visningsstatistik
  assert.equal(r.categories.find((c) => c.name === 'G').me, '7');
  assert.equal(r.status, 'midevent');
});

test('Yahoo: ingen matchup för mitt lag', () => {
  const r = parseScoreboard(scoreboard, new Set(['nope']), new Map());
  assert.equal(r.me, null);
});

test('stateOf: OVER (strax efter slutsignalen) räknas som avslutad, inte kommande', () => {
  assert.equal(stateOf('OVER', 3), 'final');
  assert.equal(stateOf('FINAL', 3), 'final');
  assert.equal(stateOf('OFF', 3), 'final');
  assert.equal(stateOf('LIVE', 2), 'live');
  assert.equal(stateOf('CRIT', 3), 'live');
  assert.equal(stateOf('FUT'), 'pre');
  assert.equal(stateOf('PRE', 1), 'pre');
  assert.equal(stateOf('NAGOT_NYTT', 2), 'live');
  assert.equal(stateOf('NAGOT_NYTT'), 'pre');
});

import { normalizeBoxscore } from '../api/boxscore.js';
test('normalizeBoxscore: officiell +/-, istid och skott per utespelare, målvakter exkluderade', () => {
  const d = {
    id: 2026020218, gameState: 'OFF',
    awayTeam: { abbrev: 'STL' }, homeTeam: { abbrev: 'DET' },
    playerByGameStats: {
      awayTeam: {
        forwards: [{ playerId: 1, sweaterNumber: 21, name: { default: 'J. Snuggerud' }, position: 'R', goals: 1, assists: 1, points: 2, plusMinus: 2, sog: 1, toi: '18:59' }],
        defense: [{ playerId: 2, sweaterNumber: 6, name: { default: 'P. Broberg' }, position: 'D', goals: 0, assists: 0, points: 0, plusMinus: -1, sog: 2, toi: '22:10' }],
        goalies: [{ playerId: 3, name: { default: 'J. Binnington' } }],
      },
      homeTeam: { forwards: [], defense: [], goalies: [] },
    },
  };
  const b = normalizeBoxscore(d);
  assert.equal(b.away.abbrev, 'STL');
  assert.equal(b.away.skaters.length, 2);
  assert.deepEqual(b.away.skaters[0], { id: 1, num: 21, name: 'J. Snuggerud', pos: 'R', g: 1, a: 1, p: 2, pm: 2, sog: 1, toi: '18:59', toiSec: 1139 });
  assert.equal(b.away.skaters[1].pm, -1);
  assert.equal(b.home.skaters.length, 0);
});

import { etDate, addDays, chooseDefaultDay } from '../lib/nhl.js';
test('dagsbyte: östkustdatum och gårdagens pågående matcher', () => {
  // 05:30 svensk vintertid = 23:30 östkust föregående dag
  assert.equal(etDate(new Date('2026-11-03T04:30:00Z')), '2026-11-02');
  assert.equal(etDate(new Date('2026-11-03T05:30:00Z')), '2026-11-03');
  assert.equal(addDays('2026-11-01', -1), '2026-10-31');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(chooseDefaultDay([{ gameState: 'OFF' }, { gameState: 'LIVE' }]), 'prev');
  assert.equal(chooseDefaultDay([{ gameState: 'OFF' }, { gameState: 'CRIT' }]), 'prev');
  assert.equal(chooseDefaultDay([{ gameState: 'OFF' }, { gameState: 'OVER' }]), 'today');
  assert.equal(chooseDefaultDay([{ gameState: 'FINAL' }]), 'today');
  assert.equal(chooseDefaultDay([]), 'today');
  // Uppskjuten match ska inte låsa kvar gårdagen
  assert.equal(chooseDefaultDay([{ gameState: 'LIVE', gameScheduleState: 'PPD' }]), 'today');
});
