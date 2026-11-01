// Demodata för ?demo – visar alla lägen (PP, SH, tom bur, paus, mål) utan pågående NHL-matcher.
const T0 = Date.now();
const logo = (a) => `https://assets.nhle.com/logos/nhl/svg/${a}_light.svg`;
const team = (abbrev, name, score, sog) => ({ abbrev, name, logo: logo(abbrev), score, sog });
const iso = (minAgo) => new Date(T0 - minAgo * 60000).toISOString();

function goal(gameId, away, home, n, period, t, tm, scorer, tot, assists, aS, hS, strength = 'ev', modifier = null, minAgo = 60) {
  return {
    id: `${gameId}-${n}`, gameId, period, periodType: period > 3 ? 'OT' : 'REG', timeInPeriod: t, team: tm,
    scorer, scorerTotal: tot, mugshot: null, assists: assists.map(([name, total]) => ({ name, total })),
    strength, modifier, awayScore: aS, homeScore: hS, away, home, clip: null, estTime: iso(minAgo),
  };
}

export function demoScores() {
  const el = (Date.now() - T0) / 1000;
  const g1goals = [
    goal(1, 'TOR', 'BOS', 1, 1, '04:12', 'TOR', 'William Nylander', 9, [['A. Matthews', 11], ['M. Rielly', 8]], 1, 0, 'ev', null, 95),
    goal(1, 'TOR', 'BOS', 2, 1, '15:40', 'BOS', 'David Pastrnak', 12, [['E. Lindholm', 6]], 1, 1, 'pp', null, 72),
    goal(1, 'TOR', 'BOS', 3, 2, '08:03', 'TOR', 'Auston Matthews', 14, [['M. Marner', 15], ['W. Nylander', 10]], 2, 1, 'ev', null, 38),
  ];
  const g2goals = [
    goal(2, 'EDM', 'COL', 1, 1, '02:55', 'COL', 'Nathan MacKinnon', 10, [['C. Makar', 17], ['M. Rantanen', 12]], 0, 1, 'ev', null, 120),
    goal(2, 'EDM', 'COL', 2, 2, '11:21', 'EDM', 'Leon Draisaitl', 13, [['C. McDavid', 21]], 1, 1, 'pp', null, 75),
    goal(2, 'EDM', 'COL', 3, 3, '09:47', 'COL', 'Gabriel Landeskog', 4, [['N. MacKinnon', 19], ['D. Toews', 9]], 1, 2, 'ev', null, 18),
  ];
  const g3goals = [];
  const g4goals = [
    goal(4, 'NYR', 'DET', 1, 1, '06:10', 'DET', 'Lucas Raymond', 8, [['M. Seider', 9]], 0, 1, 'ev', null, 200),
    goal(4, 'NYR', 'DET', 2, 2, '13:58', 'NYR', 'Mika Zibanejad', 6, [['A. Panarin', 14], ['A. Fox', 13]], 1, 1, 'sh', null, 170),
    goal(4, 'NYR', 'DET', 3, 4, '02:31', 'NYR', 'Artemi Panarin', 9, [['V. Trocheck', 10]], 2, 1, 'ev', null, 140),
  ];

  // Simulerade nya mål efter några sekunder
  if (el > 8) g3goals.push(goal(3, 'VGK', 'SEA', 1, 1, '11:02', 'VGK', 'Jack Eichel', 11, [['M. Stone', 9], ['S. Theodore', 12]], 1, 0, 'pp', null, 0.1));
  let awayTor = 2;
  if (el > 25) { g1goals.push(goal(1, 'TOR', 'BOS', 4, 2, '14:40', 'BOS', 'Brad Marchand', 7, [['C. McAvoy', 10]], 2, 2, 'sh', null, 0.05)); }

  const g1 = {
    id: 1, state: 'live', gameState: 'LIVE', startTimeUTC: iso(110), venue: 'TD Garden',
    away: team('TOR', 'Maple Leafs', awayTor, 24), home: team('BOS', 'Bruins', el > 25 ? 2 : 1, 21),
    period: 2, periodType: 'REG', outcome: null,
    clock: { timeRemaining: '06:12', secondsRemaining: 372, running: true, inIntermission: false },
    situation: { code: '1451', awaySkaters: 4, homeSkaters: 5, strength: '4 mot 5', type: 'PP', ppTeam: 'BOS', shTeam: 'TOR', emptyNet: [], timeRemaining: '01:34', secondsRemaining: 94 },
  };
  const g2 = {
    id: 2, state: 'live', gameState: 'LIVE', startTimeUTC: iso(150), venue: 'Ball Arena',
    away: team('EDM', 'Oilers', 1, 31), home: team('COL', 'Avalanche', 2, 27),
    period: 3, periodType: 'REG', outcome: null,
    clock: { timeRemaining: '01:48', secondsRemaining: 108, running: true, inIntermission: false },
    situation: { code: '0651', awaySkaters: 6, homeSkaters: 5, strength: '6 mot 5', type: 'EV', ppTeam: null, shTeam: null, emptyNet: ['EDM'] },
  };
  const g3 = {
    id: 3, state: 'live', gameState: 'LIVE', startTimeUTC: iso(30), venue: 'Climate Pledge Arena',
    away: team('VGK', 'Golden Knights', el > 8 ? 1 : 0, 9), home: team('SEA', 'Kraken', 0, 7),
    period: 1, periodType: 'REG', outcome: null,
    clock: { timeRemaining: '08:58', secondsRemaining: 538, running: true, inIntermission: false },
    situation: { code: '1551', awaySkaters: 5, homeSkaters: 5, strength: '5 mot 5', type: 'EV', ppTeam: null, shTeam: null, emptyNet: [] },
  };
  const g5 = {
    id: 5, state: 'live', gameState: 'LIVE', startTimeUTC: iso(55), venue: 'Amerant Bank Arena',
    away: team('WPG', 'Jets', 0, 12), home: team('FLA', 'Panthers', 0, 14),
    period: 1, periodType: 'REG', outcome: null,
    clock: { timeRemaining: '12:40', secondsRemaining: 760, running: false, inIntermission: true },
    situation: null,
  };
  const g4 = {
    id: 4, state: 'final', gameState: 'OFF', startTimeUTC: iso(240), venue: 'Little Caesars Arena',
    away: team('NYR', 'Rangers', 2, 29), home: team('DET', 'Red Wings', 1, 33),
    period: 4, periodType: 'OT', outcome: 'OT', clock: null, situation: null,
  };
  const g6 = {
    id: 6, state: 'pre', gameState: 'FUT', startTimeUTC: new Date(T0 + 50 * 60000).toISOString(), venue: 'Crypto.com Arena',
    away: team('CHI', 'Blackhawks', null, null), home: team('LAK', 'Kings', null, null),
    period: null, periodType: 'REG', outcome: null, clock: null, situation: null,
  };

  const all = [[g1, g1goals], [g2, g2goals], [g3, g3goals], [g5, []], [g4, g4goals], [g6, []]];
  const games = all.map(([g, gl]) => ({ ...g, lastGoal: gl[gl.length - 1] || null, goalCount: gl.length }));
  const goals = all.flatMap(([, gl]) => gl).sort((a, b) => a.estTime.localeCompare(b.estTime));
  return { date: new Date(T0).toISOString().slice(0, 10), prevDate: null, nextDate: null, fetchedAt: new Date().toISOString(), games, goals };
}

export function demoFantasy() {
  return {
    loggedIn: true,
    leagues: [
      {
        key: 'demo.l.1', name: 'Göteborgs Hockeyliga', url: '#', scoringType: 'head', week: 4, isPlayoffs: false,
        me: { name: 'Frölunda Fanatics', manager: 'Niklas', logo: null }, opp: { name: 'Slottsskogen Snipers', manager: 'Erik', logo: null },
        record: { wins: 6, losses: 3, ties: 1 },
        categories: [['G', 14, 11, 'me'], ['A', 22, 25, 'opp'], ['+/-', 6, 2, 'me'], ['PIM', 18, 18, 'tie'], ['PPP', 9, 5, 'me'], ['SOG', 141, 129, 'me'], ['HIT', 58, 71, 'opp'], ['W', 3, 2, 'me'], ['GAA', '2.41', '2.88', 'me'], ['SV%', '.912', '.920', 'opp']]
          .map(([name, me, opp, result]) => ({ name, me, opp, result })),
      },
      {
        key: 'demo.l.2', name: 'Jobbligan', url: '#', scoringType: 'headpoint', week: 4, isPlayoffs: false,
        me: { name: 'Powerplay Pirates', manager: 'Niklas', logo: null, points: 312.4, projected: 545.1 },
        opp: { name: 'Zamboni Drivers', manager: 'Sara', logo: null, points: 334.9, projected: 528.7 },
        record: null, categories: [],
      },
    ],
  };
}

// Påhittade femmor för demoläget
const LINES = {
  TOR: [[34, 'Matthews'], [16, 'Marner'], [88, 'Nylander'], [44, 'Rielly'], [8, 'Ekman-Larsson']],
  BOS: [[88, 'Pastrnak'], [28, 'Lindholm'], [63, 'Marchand'], [73, 'McAvoy'], [27, 'Lohrei']],
  EDM: [[97, 'McDavid'], [29, 'Draisaitl'], [18, 'Hyman'], [2, 'Bouchard'], [25, 'Nurse'], [93, 'Nugent-Hopkins']],
  COL: [[29, 'MacKinnon'], [8, 'Makar'], [92, 'Landeskog'], [16, 'Toews'], [49, 'Girard']],
  VGK: [[9, 'Eichel'], [61, 'Stone'], [27, 'Theodore'], [7, 'Pietrangelo'], [26, 'Hertl']],
  SEA: [[10, 'Beniers'], [7, 'Eberle'], [6, 'Dunn'], [4, 'Larsson'], [20, 'Schwartz']],
  NYR: [[93, 'Zibanejad'], [10, 'Panarin'], [23, 'Fox'], [16, 'Trocheck'], [79, 'Miller']],
  DET: [[23, 'Raymond'], [53, 'Seider'], [71, 'Larkin'], [39, 'Copp'], [24, 'Chiarot']],
};

export function demoOnIce(scores, gameId) {
  const out = {};
  for (const g of scores.goals.filter((x) => x.gameId === gameId)) {
    const other = g.team === g.away ? g.home : g.away;
    const five = (abbr, n) => (LINES[abbr] || []).slice(0, n).map(([num, name]) => ({ id: null, num, name, short: name }));
    const pp = g.strength === 'pp';
    out[g.id] = {
      applies: !pp,
      complete: !(gameId === 3), // matchen med "nytt" mål väntar på bytesdata
      scoringTeam: g.team,
      otherTeam: other,
      scoring: five(g.team, g.modifier === 'empty-net' ? 6 : 5),
      conceding: five(other, pp || g.strength === 'sh' ? 4 : 5),
    };
  }
  return out;
}
