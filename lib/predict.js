// Matchprognos: förväntade mål per lag (Poisson) utifrån säsongsstyrka, justerad för
// form, inbördes möten, skador/återkomster, startmålvakt och back-to-back.
// Allt här är rena funktioner – datahämtningen sker i api/predictions.js.

export const MODEL = {
  homeIce: 1.04,          // hemmafördel på förväntade mål
  shrinkGames: 10,        // regression mot ligasnittet tidigt på säsongen
  formWeight: 0.08,       // formindex ±100 -> ±8 % egna mål
  formDefWeight: 0.05,    // motståndarens form påverkar insläppta mål
  h2hWeight: 0.02,        // per mål i genomsnittlig målskillnad i inbördes möten (max ±3)
  h2hMax: 5,              // antal senaste möten
  injuryWeight: 0.5,      // andel av lagets poängproduktion som saknas -> minskade mål
  injuryMax: 0.25,
  returnWeight: 0.3,      // återvändande spelare: ökning
  goalieShrink: 10,       // målvaktens räddningsprocent mot ligasnitt
  goalieClamp: [0.85, 1.15],
  b2bOwn: 0.96,           // lag som spelade i går gör färre mål …
  b2bOpp: 1.03,           // … och släpper in fler
  maxGoals: 10,
};

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
export const lastName = (full) => norm(String(full || '').trim().split(/\s+/).slice(1).join(' ') || full);

/** Lagstyrka ur tabellen: anfall/försvar relativt ligasnittet, med regression mot 1,0. */
export function teamStrength(standingsRow, leagueAvg, shrink = MODEL.shrinkGames) {
  const gp = standingsRow?.gp || 0;
  if (!gp || !leagueAvg) return { att: 1, def: 1, gp };
  const att = (standingsRow.gf / gp) / leagueAvg;
  const def = (standingsRow.ga / gp) / leagueAvg;
  return { att: (att * gp + shrink) / (gp + shrink), def: (def * gp + shrink) / (gp + shrink), gp };
}

/** Inbördes möten ur hemmalagets perspektiv: genomsnittlig målskillnad (straffmål exkluderade). */
export function headToHead(meetings, home, max = MODEL.h2hMax) {
  const list = (meetings || [])
    .filter((m) => m.home && m.away && m.homeScore != null && m.awayScore != null)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, max);
  if (!list.length) return { n: 0, avgDiff: 0, wins: 0, losses: 0, list: [] };
  let diff = 0, wins = 0;
  for (const m of list) {
    let hs = m.homeScore, as = m.awayScore;
    if (m.so) { if (hs > as) hs--; else as--; }
    const d = m.home === home ? hs - as : as - hs;
    diff += d;
    const won = m.home === home ? m.homeScore > m.awayScore : m.awayScore > m.homeScore;
    if (won) wins++;
  }
  return { n: list.length, avgDiff: diff / list.length, wins, losses: list.length - wins, list };
}

/**
 * Skador: vilka som saknas och vilka som återkommer till matchen.
 * injuries: [{ name, status, returnDate }] (ESPN). skaters: [{ name, gp, points }] (NHL).
 * En spelare räknas som återkommande om förväntat återkomstdatum är matchdagen eller tidigare.
 */
export function injuryImpact(injuries, skaters, gameDate) {
  const ppg = new Map();
  let total = 0;
  for (const s of skaters || []) {
    if (!s.gp || s.gp < 3) continue;
    const v = s.points / s.gp;
    ppg.set(lastName(s.name) + '|' + norm(s.name)[0], { v, name: s.name });
    total += v;
  }
  const lookup = (name) => ppg.get(lastName(name) + '|' + norm(name)[0]);
  const out = [], back = [];
  for (const inj of injuries || []) {
    const st = String(inj.status || '').toLowerCase();
    if (!st || st.includes('active')) continue;
    const returning = inj.returnDate && inj.returnDate <= gameDate;
    const p = lookup(inj.name);
    const share = p && total ? p.v / total : 0;
    (returning ? back : out).push({ name: inj.name, status: inj.status, share });
  }
  const missShare = out.reduce((n, x) => n + x.share, 0);
  const backShare = back.reduce((n, x) => n + x.share, 0);
  return { out, back, missShare, backShare };
}

/** Målvaktsfaktor för motståndarens mål: startmålvaktens räddningsprocent mot lagets snitt. */
export function goalieFactor(starter, goalies, leagueSv = 0.9, shrink = MODEL.goalieShrink) {
  const list = (goalies || []).filter((g) => g.gp > 0 && g.sv != null);
  if (!starter || !list.length) return { factor: 1, goalie: null };
  const g = list.find((x) => lastName(x.name) === lastName(starter.name) && norm(x.name)[0] === norm(starter.name)[0])
    || list.find((x) => lastName(x.name) === lastName(starter.name));
  if (!g) return { factor: 1, goalie: { name: starter.name, confirmed: starter.confirmed, sv: null } };
  const starts = list.reduce((n, x) => n + (x.gs || x.gp), 0);
  const teamSv = list.reduce((n, x) => n + x.sv * (x.gs || x.gp), 0) / starts;
  const svAdj = (g.sv * g.gp + leagueSv * shrink) / (g.gp + shrink);
  const teamAdj = (teamSv * starts + leagueSv * shrink) / (starts + shrink);
  const factor = clamp((1 - svAdj) / (1 - teamAdj), ...MODEL.goalieClamp);
  return { factor, goalie: { name: g.name, confirmed: !!starter.confirmed, sv: g.sv, gp: g.gp } };
}

function poisson(k, l) {
  let p = Math.exp(-l);
  for (let i = 1; i <= k; i++) p *= l / i;
  return p;
}

/** Sannolikheter och mest troliga resultat ur förväntade mål. */
export function outcome(lh, la, max = MODEL.maxGoals) {
  let pH = 0, pA = 0, pD = 0;
  const grid = [];
  for (let h = 0; h <= max; h++) {
    for (let a = 0; a <= max; a++) {
      const p = poisson(h, lh) * poisson(a, la);
      grid.push({ h, a, p });
      if (h > a) pH += p; else if (a > h) pA += p; else pD += p;
    }
  }
  // Normalisera (rutnätet klipper vid max mål)
  const tot = pH + pA + pD;
  pH /= tot; pA /= tot; pD /= tot;
  // Oavgjort efter 60 min avgörs i förlängning/straffar – fördelas efter relativ styrka
  const share = lh / (lh + la);
  const homeWin = pH + pD * share;
  const winner = homeWin >= 0.5 ? 'home' : 'away';
  // Mest troliga slutresultat där den favoriserade vinner; går det oftast till förlängning anges det
  const decided = grid.filter((x) => (winner === 'home' ? x.h > x.a : x.a > x.h)).sort((x, y) => y.p - x.p)[0];
  const tie = grid.filter((x) => x.h === x.a).sort((x, y) => y.p - x.p)[0];
  let score = { home: decided.h, away: decided.a, ot: false };
  if (tie && tie.p > decided.p) {
    score = winner === 'home' ? { home: tie.h + 1, away: tie.a, ot: true } : { home: tie.h, away: tie.a + 1, ot: true };
  }
  return { homeWin, awayWin: 1 - homeWin, regulationTie: pD, winner, score };
}

/**
 * Hela prognosen för en match.
 * ctx = { home, away, gameDate, leagueAvg, standings: {abbr: {gp,gf,ga}}, form: {abbr: {index}},
 *         meetings, injuries: {abbr: [...]}, skaters: {abbr: [...]}, goalies: {abbr: [...]},
 *         starters: {abbr: {name, confirmed}}, playedYesterday: {abbr: bool}, leagueSv }
 */
export function predictGame(ctx, m = MODEL) {
  const { home: H, away: A } = ctx;
  const G = ctx.leagueAvg || 3.0;
  const sh = teamStrength(ctx.standings?.[H], G);
  const sa = teamStrength(ctx.standings?.[A], G);
  let lh = G * sh.att * sa.def * m.homeIce;
  let la = G * sa.att * sh.def * (2 - m.homeIce);
  const factors = [];
  const note = (team, text, effect) => factors.push({ team, text, effect: Math.round(effect * 1000) / 10 });

  // Form (index −100…+100)
  const fh = (ctx.form?.[H]?.index ?? 0) / 100;
  const fa = (ctx.form?.[A]?.index ?? 0) / 100;
  lh *= (1 + m.formWeight * fh) * (1 - m.formDefWeight * fa);
  la *= (1 + m.formWeight * fa) * (1 - m.formDefWeight * fh);
  if (ctx.form?.[H]?.index != null) note(H, `Form ${ctx.form[H].index > 0 ? '+' : ''}${ctx.form[H].index}`, m.formWeight * fh);
  if (ctx.form?.[A]?.index != null) note(A, `Form ${ctx.form[A].index > 0 ? '+' : ''}${ctx.form[A].index}`, m.formWeight * fa);

  // Inbördes möten
  const h2h = headToHead(ctx.meetings, H);
  if (h2h.n) {
    const d = clamp(h2h.avgDiff, -3, 3);
    lh *= 1 + m.h2hWeight * d;
    la *= 1 - m.h2hWeight * d;
    note(d >= 0 ? H : A, `Inbördes ${h2h.n} senaste: ${H} ${h2h.wins}–${h2h.losses} ${A}`, m.h2hWeight * Math.abs(d));
  }

  // Skador och återkomster
  const inj = {};
  for (const T of [H, A]) {
    const r = injuryImpact(ctx.injuries?.[T], ctx.skaters?.[T], ctx.gameDate);
    inj[T] = r;
    const down = Math.min(m.injuryMax, m.injuryWeight * r.missShare);
    const up = m.returnWeight * r.backShare;
    const f = (1 - down) * (1 + up);
    if (T === H) lh *= f; else la *= f;
    const key = r.out.filter((x) => x.share >= 0.04).map((x) => x.name);
    if (down >= 0.01) note(T, `Saknar ${key.length ? key.join(', ') : `${r.out.length} spelare`}`, -down);
    if (r.back.length) note(T, `Tillbaka från skada: ${r.back.map((x) => x.name).join(', ')}`, up);
  }

  // Startmålvakter (påverkar motståndarens mål)
  const gH = goalieFactor(ctx.starters?.[H], ctx.goalies?.[H], ctx.leagueSv);
  const gA = goalieFactor(ctx.starters?.[A], ctx.goalies?.[A], ctx.leagueSv);
  la *= gH.factor;
  lh *= gA.factor;
  if (gH.goalie?.sv != null && Math.abs(gH.factor - 1) >= 0.02) note(H, `Målvakt ${gH.goalie.name} (${(gH.goalie.sv * 100).toFixed(1)} %)`, 1 - gH.factor);
  if (gA.goalie?.sv != null && Math.abs(gA.factor - 1) >= 0.02) note(A, `Målvakt ${gA.goalie.name} (${(gA.goalie.sv * 100).toFixed(1)} %)`, 1 - gA.factor);

  // Back-to-back
  if (ctx.playedYesterday?.[H]) { lh *= m.b2bOwn; la *= m.b2bOpp; note(H, 'Spelade i går (back-to-back)', m.b2bOwn - 1); }
  if (ctx.playedYesterday?.[A]) { la *= m.b2bOwn; lh *= m.b2bOpp; note(A, 'Spelade i går (back-to-back)', m.b2bOwn - 1); }

  const o = outcome(lh, la, m.maxGoals);
  return {
    xg: { home: Math.round(lh * 100) / 100, away: Math.round(la * 100) / 100 },
    homeWin: Math.round(o.homeWin * 1000) / 1000,
    awayWin: Math.round(o.awayWin * 1000) / 1000,
    otChance: Math.round(o.regulationTie * 1000) / 1000,
    winner: o.winner === 'home' ? H : A,
    score: o.score,
    goalies: { [H]: gH.goalie, [A]: gA.goalie },
    injuries: Object.fromEntries([H, A].map((T) => [T, {
      out: inj[T].out.map((x) => x.name), back: inj[T].back.map((x) => x.name),
    }])),
    h2h: { n: h2h.n, wins: h2h.wins, losses: h2h.losses, games: h2h.list.map((x) => ({ date: x.date, home: x.home, away: x.away, hs: x.homeScore, as: x.awayScore, so: !!x.so, ot: !!x.ot })) },
    factors: factors.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect)),
  };
}
