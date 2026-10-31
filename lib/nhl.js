// NHL:s öppna API (api-web.nhle.com) – hämtning och normalisering.

const NHL = 'https://api-web.nhle.com/v1';

export async function nhlFetch(path) {
  const r = await fetch(NHL + path, { headers: { 'User-Agent': 'nhl-live-dashboard' } });
  if (!r.ok) throw new Error(`NHL ${r.status} ${path}`);
  return r.json();
}

const txt = (v) => (v && typeof v === 'object' ? v.default ?? '' : v ?? '');

/**
 * situationCode är fyra siffror: [bortamålvakt, bortautespelare, hemmautespelare, hemmamålvakt].
 * Ex. "1551" = 5 mot 5, "1451" = hemmalaget i powerplay, "0651" = bortalaget har tagit ut målvakten.
 */
export function parseSituation(code, away, home) {
  if (!code || !/^\d{4}$/.test(String(code))) return null;
  const [ag, as, hs, hg] = String(code).split('').map(Number);
  const awayPulled = ag === 0;
  const homePulled = hg === 0;
  // Extra utespelare för uttagen målvakt räknas inte som numerärt överläge.
  const aEff = as - (awayPulled ? 1 : 0);
  const hEff = hs - (homePulled ? 1 : 0);

  const s = {
    code: String(code),
    awaySkaters: as,
    homeSkaters: hs,
    strength: `${as} mot ${hs}`,
    type: 'EV',
    ppTeam: null,
    shTeam: null,
    emptyNet: [awayPulled && away, homePulled && home].filter(Boolean),
  };
  if (aEff > hEff) Object.assign(s, { type: 'PP', ppTeam: away, shTeam: home });
  else if (hEff > aEff) Object.assign(s, { type: 'PP', ppTeam: home, shTeam: away });
  return s;
}

function stateOf(gameState) {
  if (gameState === 'LIVE' || gameState === 'CRIT') return 'live';
  if (gameState === 'FINAL' || gameState === 'OFF') return 'final';
  return 'pre';
}

function secs(mmss) {
  const m = /^(\d+):(\d{2})$/.exec(mmss || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Ungefärlig väggklocketid för ett mål: start + (period-1)·(35 min spel + 18 min paus) + speltid·1,75. */
function estimateGoalTime(startUTC, period, timeInPeriod) {
  const start = Date.parse(startUTC);
  const el = secs(timeInPeriod);
  if (!start || el === null) return null;
  const minutes = 7 + (period - 1) * (35 + 18) + (el / 60) * 1.75;
  return new Date(start + minutes * 60000).toISOString();
}

function team(t) {
  return {
    id: t.id,
    abbrev: t.abbrev,
    name: txt(t.name),
    logo: t.logo,
    score: t.score ?? null,
    sog: t.sog ?? null,
  };
}

export function normalizeGame(g, pbp) {
  const away = team(g.awayTeam);
  const home = team(g.homeTeam);
  const state = stateOf(g.gameState);
  const sitRaw = g.situation || pbp?.situation || null;
  const lastCode = pbp?.plays?.length ? pbp.plays[pbp.plays.length - 1].situationCode : null;
  const situation = state === 'live'
    ? parseSituation(sitRaw?.situationCode || lastCode, away.abbrev, home.abbrev)
    : null;
  if (situation && sitRaw?.timeRemaining) situation.timeRemaining = sitRaw.timeRemaining;
  if (situation && sitRaw?.secondsRemaining != null) situation.secondsRemaining = sitRaw.secondsRemaining;

  const clock = g.clock || pbp?.clock || null;
  const pd = g.periodDescriptor || pbp?.periodDescriptor || {};

  const goals = (g.goals || [])
    .filter((x) => (x.periodDescriptor?.periodType || 'REG') !== 'SO')
    .map((x) => {
      const period = x.periodDescriptor?.number ?? x.period;
      const assists = (x.assists || []).map((a) => ({
        name: txt(a.name) || `${txt(a.firstName)} ${txt(a.lastName)}`.trim(),
        total: a.assistsToDate ?? null,
      }));
      return {
        id: `${g.id}-${period}-${x.timeInPeriod}-${x.playerId}`,
        gameId: g.id,
        period,
        periodType: x.periodDescriptor?.periodType || 'REG',
        timeInPeriod: x.timeInPeriod,
        team: x.teamAbbrev?.default ?? x.teamAbbrev,
        scorer: `${txt(x.firstName)} ${txt(x.lastName)}`.trim() || txt(x.name),
        scorerTotal: x.goalsToDate ?? null,
        mugshot: x.mugshot || null,
        assists,
        strength: (x.strength || 'ev').toLowerCase(),
        modifier: x.goalModifier && x.goalModifier !== 'none' ? x.goalModifier : null,
        awayScore: x.awayScore,
        homeScore: x.homeScore,
        away: away.abbrev,
        home: home.abbrev,
        clip: x.highlightClipSharingUrl || null,
        estTime: estimateGoalTime(g.startTimeUTC, period, x.timeInPeriod),
      };
    });

  return {
    id: g.id,
    state,
    gameState: g.gameState,
    startTimeUTC: g.startTimeUTC,
    venue: txt(g.venue),
    away,
    home,
    period: pd.number ?? g.period ?? null,
    periodType: pd.periodType || 'REG',
    outcome: g.gameOutcome?.lastPeriodType || null,
    clock: clock
      ? {
          timeRemaining: clock.timeRemaining,
          secondsRemaining: clock.secondsRemaining,
          running: !!clock.running,
          inIntermission: !!clock.inIntermission,
        }
      : null,
    situation,
    goals,
    gameCenter: g.gameCenterLink ? `https://www.nhl.com${g.gameCenterLink}` : null,
  };
}
