// Fantasy-statistik per spelare och match, byggd ur NHL:s boxscore + play-by-play.
// Täcker Yahoos vanliga kategorier: G, A, P, +/-, PIM, PPG/PPA/PPP, SHG/SHA/SHP, GWG, SOG,
// FW/FL, HIT, BLK samt för målvakter GP, GS, W, L, OTL, GA, SV, SA, SHO och istid (för GAA/SV%).

const txt = (v) => (v && typeof v === 'object' ? v.default ?? '' : v ?? '');
const secs = (t) => { const m = /^(\d+):(\d{2})$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : 0; };
const FINAL = new Set(['OFF', 'FINAL', 'OVER']);

const SKATER = ['g', 'a', 'p', 'pm', 'pim', 'ppg', 'ppa', 'shg', 'sha', 'gwg', 'sog', 'fw', 'fl', 'hit', 'blk'];
const GOALIE = ['gs', 'w', 'l', 'otl', 'ga', 'sv', 'sa', 'sho', 'toi'];

/**
 * Styrka för målgörande laget ur situationCode [bortamålvakt, bortautespelare, hemmautespelare, hemmamålvakt].
 * Uttagen målvakt (extra utespelare) räknas inte som numerärt överläge.
 */
export function goalStrength(code, scorerIsHome) {
  const c = String(code || '');
  if (!/^\d{4}$/.test(c)) return 'EV';
  const [ag, as, hs, hg] = c.split('').map(Number);
  const own = scorerIsHome ? hs - (hg === 0 ? 1 : 0) : as - (ag === 0 ? 1 : 0);
  const opp = scorerIsHome ? as - (ag === 0 ? 1 : 0) : hs - (hg === 0 ? 1 : 0);
  return own > opp ? 'PP' : own < opp ? 'SH' : 'EV';
}

export function gameStats(box, pbp) {
  const home = box.homeTeam || {}, away = box.awayTeam || {};
  const abbrevOf = { [home.id]: home.abbrev, [away.id]: away.abbrev };
  const names = new Map();
  for (const r of pbp?.rosterSpots || []) names.set(r.playerId, { first: txt(r.firstName), last: txt(r.lastName) });

  const players = new Map();
  const get = (id, team, pos, short) => {
    if (!players.has(id)) {
      const n = names.get(id);
      const first = n?.first || '', last = n?.last || String(short || '').replace(/^\S+\.\s*/, '');
      const goalie = pos === 'G';
      const base = { id, team, pos, goalie, name: `${first} ${last}`.trim(), first, last, gp: 0 };
      for (const k of goalie ? GOALIE : SKATER) base[k] = 0;
      players.set(id, base);
    }
    return players.get(id);
  };

  for (const side of ['awayTeam', 'homeTeam']) {
    const team = box[side]?.abbrev;
    const st = box.playerByGameStats?.[side] || {};
    for (const p of [...(st.forwards || []), ...(st.defense || [])]) {
      const s = get(p.playerId, team, p.position, txt(p.name));
      s.gp = 1;
      s.g = p.goals ?? 0; s.a = p.assists ?? 0; s.p = p.points ?? s.g + s.a;
      s.pm = p.plusMinus ?? 0; s.pim = p.pim ?? 0; s.sog = p.sog ?? 0;
      s.hit = p.hits ?? 0; s.blk = p.blockedShots ?? 0;
    }
    const used = (st.goalies || []).filter((p) => secs(p.toi) > 0);
    for (const p of used) {
      const s = get(p.playerId, team, 'G', txt(p.name));
      s.gp = 1;
      s.gs = p.starter ? 1 : 0;
      s.w = p.decision === 'W' ? 1 : 0;
      s.l = p.decision === 'L' ? 1 : 0;
      s.otl = p.decision === 'O' ? 1 : 0;
      s.ga = p.goalsAgainst ?? 0;
      s.sv = p.saves ?? Math.max(0, (p.shotsAgainst ?? 0) - s.ga);
      s.sa = p.shotsAgainst ?? s.sv + s.ga;
      s.toi = secs(p.toi);
      // Hållen nolla: vinst, inga insläppta och ensam målvakt i laget
      s.sho = s.w && s.ga === 0 && used.length === 1 ? 1 : 0;
    }
  }

  // Play-by-play: tekningar och målens styrka (PP/SH) för målgörare och assist
  const goals = [];
  for (const play of pbp?.plays || []) {
    const d = play.details || {};
    if (play.typeDescKey === 'faceoff') {
      if (players.has(d.winningPlayerId)) players.get(d.winningPlayerId).fw++;
      if (players.has(d.losingPlayerId)) players.get(d.losingPlayerId).fl++;
    } else if (play.typeDescKey === 'goal' && play.periodDescriptor?.periodType !== 'SO') {
      const isHome = d.eventOwnerTeamId === home.id;
      const str = goalStrength(play.situationCode, isHome);
      goals.push({ team: abbrevOf[d.eventOwnerTeamId], scorer: d.scoringPlayerId });
      const sc = players.get(d.scoringPlayerId);
      const assists = [d.assist1PlayerId, d.assist2PlayerId].filter(Boolean).map((id) => players.get(id)).filter(Boolean);
      if (str === 'PP') { if (sc) sc.ppg++; for (const a of assists) a.ppa++; }
      if (str === 'SH') { if (sc) sc.shg++; for (const a of assists) a.sha++; }
    }
  }

  // Matchavgörande mål: vinnarlagets mål nummer (förlorarens slutsiffra + 1). Inte vid straffar.
  const outcome = pbp?.gameOutcome?.lastPeriodType || box.gameOutcome?.lastPeriodType;
  if (FINAL.has(box.gameState) && outcome !== 'SO' && home.score !== away.score) {
    const win = home.score > away.score ? home : away;
    const lose = win === home ? away : home;
    const g = goals.filter((x) => x.team === win.abbrev)[lose.score];
    if (g && players.has(g.scorer)) players.get(g.scorer).gwg = 1;
  }

  return [...players.values()];
}
