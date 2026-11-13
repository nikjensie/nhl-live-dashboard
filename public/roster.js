// Matchup utan Yahoo-API: tolka en inklistrad Yahoo-trupp (kopierad från lagsidan) och
// räkna fantasykategorier ur NHL:s statistik. Rena funktioner – används av app.js och testerna.
import { nhlAbbr, splitName } from './marks.js';

// Yahoos kategorier. k = fält i /api/fstats, f = beräknat, low = lägre är bättre.
export const CATS = {
  G: { k: 'g' }, A: { k: 'a' }, P: { k: 'p' }, '+/-': { k: 'pm' }, PIM: { k: 'pim' },
  PPG: { k: 'ppg' }, PPA: { k: 'ppa' }, PPP: { f: (s) => s.ppg + s.ppa },
  SHG: { k: 'shg' }, SHA: { k: 'sha' }, SHP: { f: (s) => s.shg + s.sha },
  GWG: { k: 'gwg' }, SOG: { k: 'sog' }, FW: { k: 'fw' }, FL: { k: 'fl', low: true },
  HIT: { k: 'hit' }, BLK: { k: 'blk' },
  GP: { k: 'gp', goalie: true }, GS: { k: 'gs', goalie: true }, W: { k: 'w', goalie: true },
  L: { f: (s) => s.l + s.otl, low: true, goalie: true }, // Yahoo räknar förlust efter förlängning som L
  GA: { k: 'ga', low: true, goalie: true }, SV: { k: 'sv', goalie: true }, SA: { k: 'sa', goalie: true },
  SHO: { k: 'sho', goalie: true },
  GAA: { f: (s) => (s.toi ? (s.ga * 3600) / s.toi : null), low: true, goalie: true, ratio: 2 },
  'SV%': { f: (s) => (s.sa ? s.sv / s.sa : null), goalie: true, ratio: 3 },
};
// Poängsättning i ligan (H2H Points). Kategorier utan vikt ger 0 poäng.
export const POINTS = {
  G: 2, A: 1, P: 0, '+/-': 1, PPG: 1, PPA: 1, SHG: 3, SHA: 2, GWG: 1, SOG: 0.1, FW: 0.1, FL: -0.1, HIT: 0.1, BLK: 0.2,
  W: 4, L: -1, GA: -0.5, SV: 0.1, SHO: 5,
};
const r1 = (x) => Math.round(x * 100) / 100;

/** Fantasypoäng för en statistikrad (spelare eller lagtotal). */
export function fantasyPoints(s, goalie, weights = POINTS) {
  if (!s) return 0;
  let t = 0;
  for (const [cat, w] of Object.entries(weights)) {
    if (!w || !CATS[cat] || !!CATS[cat].goalie !== !!goalie) continue;
    t += (catValue(cat, s) || 0) * w;
  }
  return r1(t);
}

/** Poäng per kategori och totalt för båda lagen. */
export function comparePoints(weights, me, opp) {
  const rows = Object.entries(weights).filter(([cat, w]) => w && CATS[cat]).map(([cat, w]) => {
    const g = CATS[cat].goalie;
    const a = catValue(cat, g ? me.gl : me.sk) || 0, b = catValue(cat, g ? opp.gl : opp.sk) || 0;
    return { cat, w, a, b, pa: r1(a * w), pb: r1(b * w) };
  });
  const total = { me: r1(rows.reduce((t, r) => t + r.pa, 0)), opp: r1(rows.reduce((t, r) => t + r.pb, 0)) };
  return { rows, total };
}

export const DEFAULT_SK = ['G', 'A', '+/-', 'PPP', 'SOG', 'HIT', 'BLK'];
export const DEFAULT_G = ['W', 'GAA', 'SV%', 'SHO'];

const SLOT = /^(C|LW|RW|F|W|D|Util|UTIL|G|BN|IR\+?|IL\+?|NA|SK|P|--)$/;
const TEAMPOS = /^([A-Z]{2,4})\s*-\s*([A-Z]{1,2}(?:\s*,\s*[A-Z]{1,2})*)$/;
const BENCH = new Set(['BN', 'IR', 'IR+', 'IL', 'IL+', 'NA', '--']); // -- = släppt från laget

/** "Nick SuzukiNew Player Note" / "Linus UllmarkDTDPlayer Note" -> { name, status } */
export function cleanName(raw) {
  let s = String(raw || '').replace(/\s*(No new player Notes?|New Player Notes?|Player Notes?)\s*$/i, '').trim();
  let status = '';
  const m = /(?<=[a-zà-ÿ.'’])(DTD|IR-LT|IR-NR|IR|O|NA|SUSP|GTD|Q)$/.exec(s);
  if (m) { status = m[1]; s = s.slice(0, m.index).trim(); }
  return { name: s, status };
}

/**
 * Tolka text kopierad från Yahoo: lagsidan (ett lag) eller matchup-sidan (båda lagen, med
 * Yahoos poäng och veckostatistik per spelare). Returnerar en lista med lag.
 * Fungerar med radbrytningar (mobil) och tabbar (dator) mellan cellerna.
 */
export function parsePaste(text) {
  const tok = String(text || '').split(/\r?\n|\t/).map((t) => t.replace(/\u00a0/g, ' ').replace(/[\u200b-\u200f\u2060\ufeff\ue000-\uf8ff]/g, '').trim()).filter(Boolean);
  const teams = [];
  const skCats = [], gCats = [];
  let cur = null;
  const newTeam = (o = {}) => { cur = { team: '', manager: '', record: '', total: null, date: '', players: [], ...o }; teams.push(cur); return cur; };
  let header = []; // kandidater till kategorirubriker: { cat, i }
  let inHeader = true;
  let sectionCats = [];

  for (let i = 0; i < tok.length; i++) {
    const t = tok[i];
    // Matchup-sidan: "logo  49.60" följt av lagnamn, manager och "4-2-0 | 3rd"
    const logo = /^logo\s+(-?\d+(?:\.\d+)?)$/i.exec(t);
    if (logo) {
      newTeam({ total: Number(logo[1]), team: tok[i + 1] || '', manager: tok[i + 2] || '', record: /\|/.test(tok[i + 3] || '') ? tok[i + 3] : '' });
      i += cur.record ? 3 : 2;
      inHeader = true; header = [];
      continue;
    }
    const title = /^(.+?)['’]s\s.*roster for (\d{4}-\d{2}-\d{2})/i.exec(t);
    if (title) { const c = cur || newTeam(); c.team ||= title[1].trim(); c.date ||= title[2]; continue; }
    if (/^Starting Lineup Totals/i.test(t) || t === 'Pos') { inHeader = true; header = []; continue; }
    const tp = TEAMPOS.exec(t);
    if (tp && i >= 1) {
      const slot = i >= 2 && SLOT.test(tok[i - 2]) ? tok[i - 2] : '';
      const { name, status } = cleanName(tok[i - 1]);
      if (!name || SLOT.test(name)) continue;
      const pos = tp[2].replace(/\s/g, '').split(',');
      const goalie = pos.includes('G');
      if (inHeader) {
        // Rubrikerna slutar där första spelaren (plats + namn) börjar
        sectionCats = header.filter((h) => h.i < i - (slot ? 2 : 1)).map((h) => h.cat);
        const into = goalie ? gCats : skCats;
        for (const c of sectionCats) if (!into.includes(c)) into.push(c);
        inHeader = false;
      }
      const p = { slot: slot.toUpperCase() === 'UTIL' ? 'Util' : slot, name, team: nhlAbbr(tp[1]), pos, goalie, status,
        active: !BENCH.has(slot.toUpperCase()) };
      // Matchup-sidan: Yahoos poäng ("4.70") och veckans statistik i kategoriernas ordning
      for (let j = i + 1; j <= i + 3 && j < tok.length; j++) {
        if (/^-?\d+\.\d{2}$/.test(tok[j])) {
          p.fp = Number(tok[j]);
          const vals = tok.slice(j + 1, j + 1 + sectionCats.length);
          // Bara streck = ingen match spelad än i veckan -> ingen Yahoo-statistik att utgå från
          if (vals.length === sectionCats.length && vals.every((v) => /^(-?\d+(\.\d+)?|-)$/.test(v)) && vals.some((v) => v !== '-')) {
            p.stats = Object.fromEntries(sectionCats.map((c, k) => [c, vals[k] === '-' ? 0 : Number(vals[k])]));
          }
          break;
        }
        if (TEAMPOS.test(tok[j]) || SLOT.test(tok[j])) break;
      }
      (cur || newTeam()).players.push(p);
      continue;
    }
    if (inHeader && CATS[t]) header.push({ cat: t, i });
  }
  const out = teams.filter((x) => x.players.length).map((x) => ({ ...x, skCats, gCats }));
  return out;
}

export function parseRoster(text) {
  return parsePaste(text)[0] || { team: '', date: '', players: [], skCats: [], gCats: [] };
}

const STAT_KEYS = ['g', 'a', 'p', 'pm', 'pim', 'ppg', 'ppa', 'shg', 'sha', 'gwg', 'sog', 'fw', 'fl', 'hit', 'blk',
  'gp', 'gs', 'w', 'l', 'otl', 'ga', 'sv', 'sa', 'sho', 'toi'];

/** Ögonblicksbild av en statistikrad (bara siffrorna) – sparas när en spelare plockas eller släpps. */
export function snapshot(s) {
  const o = {};
  for (const k of STAT_KEYS) if (typeof s?.[k] === 'number') o[k] = s[k];
  return o;
}

/** Yahoos kategorier (G, A, +/- …) som NHL-fält (g, a, pm …). L = förluster inkl. förlängning. */
export function yahooKeyed(stats) {
  const o = {};
  for (const [cat, v] of Object.entries(stats || {})) {
    if (cat === 'L') { o.l = v; o.otl = 0; o.lAll = true; continue; }
    const c = CATS[cat];
    if (c?.k) o[c.k] = v;
  }
  return o;
}

/**
 * Statistik i cur minus en startpunkt (Yahoos siffror vid inklistringen eller en ögonblicksbild).
 * Räknestatistik kan inte minska: ligger NHL-datan efter (dag saknas, rättelse) räknas inget
 * extra för spelaren, så att Yahoos siffra står kvar i stället för att dras ned.
 */
export function diffStats(cur, start) {
  const d = { ...cur };
  let short = false;
  for (const [k, v] of Object.entries(start)) {
    if (k === 'lAll' || k === 'otl' && start.lAll) continue;
    const have = k === 'l' && start.lAll ? (cur.l || 0) + (cur.otl || 0) : cur[k] || 0;
    const diff = have - v;
    if (k !== 'pm' && diff < 0) short = true;
    d[k] = diff;
    if (k === 'l' && start.lAll) d.otl = 0;
  }
  if (short) for (const k of STAT_KEYS) if (typeof d[k] === 'number') d[k] = 0;
  return d;
}

/**
 * Statistik som räknas för spelaren:
 * - från: Yahoos siffror vid inklistringen (useBase) eller ögonblicksbilden när spelaren plockades
 * - till: nu, eller ögonblicksbilden när spelaren släpptes
 */
export function countedStats(p, s, useBase) {
  const cur = p.to || s;
  if (!cur) return null;
  const start = p.from || (useBase && p.stats ? yahooKeyed(p.stats) : null);
  return start ? diffStats(cur, start) : cur;
}

/** Bakåtkompatibel: NHL-statistik minus Yahoos statistik vid inklistringen. */
export function deltaStats(p, s) {
  if (!s) return null;
  return p.stats ? diffStats(s, yahooKeyed(p.stats)) : s;
}

/** Räknas spelaren i lagets total? Aktiv plats, eller släppt av dig efter att ha stått på aktiv plats. */
export const counts = (p) => p.active || (p.to && p.wasActive);

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');

/** Index över veckans statistikrader: lag + förnamnsinitial + efternamn (som markeringarna). */
export function statIndex(lines) {
  const byKey = new Map(), byLast = new Map();
  for (const l of lines) {
    const t = nhlAbbr(l.team);
    const { init, last } = splitName(l.name);
    const k = `${t}|${init}|${last}`;
    if (!byKey.has(k)) byKey.set(k, new Set());
    byKey.get(k).add(l.id);
    const kl = `${t}|${last}`;
    if (!byLast.has(kl)) byLast.set(kl, new Set());
    byLast.get(kl).add(l.id);
  }
  return {
    find(team, name) {
      const t = nhlAbbr(team);
      const { init, last } = splitName(name);
      const hit = byKey.get(`${t}|${init}|${last}`);
      if (hit?.size === 1) return [...hit][0];
      const alt = byLast.get(`${t}|${last}`) || byLast.get(`${t}|${norm(name.split(' ').slice(-1)[0])}`);
      return alt?.size === 1 ? [...alt][0] : null;
    },
  };
}

/** Summera dagsrader (från /api/fstats) per spelar-ID. */
export function sumLines(days) {
  const by = new Map();
  for (const l of days.flatMap((d) => d.players || [])) {
    const cur = by.get(l.id);
    if (!cur) { by.set(l.id, { ...l, live: !!l.live }); continue; }
    for (const [k, v] of Object.entries(l)) if (typeof v === 'number' && k !== 'id' && k !== 'gameId') cur[k] = (cur[k] || 0) + v;
    cur.live ||= !!l.live;
    cur.team = l.team; // senaste laget (byten mitt i veckan)
  }
  return [...by.values()];
}

export function catValue(cat, s) {
  const c = CATS[cat];
  if (!c || !s) return null;
  if (c.f) return c.f(s);
  return s[c.k] ?? 0;
}

const ZERO_SK = { g: 0, a: 0, p: 0, pm: 0, pim: 0, ppg: 0, ppa: 0, shg: 0, sha: 0, gwg: 0, sog: 0, fw: 0, fl: 0, hit: 0, blk: 0, gp: 0 };
const ZERO_G = { gp: 0, gs: 0, w: 0, l: 0, otl: 0, ga: 0, sv: 0, sa: 0, sho: 0, toi: 0 };

/** Lagets totaler: bara spelare på aktiva platser (inte BN/IR/NA). */
export function teamTotals(roster, stats) {
  const sk = { ...ZERO_SK }, gl = { ...ZERO_G };
  for (const p of roster.players) {
    const s = stats.get(p);
    if (!s || !counts(p)) continue;
    const into = p.goalie ? gl : sk;
    for (const k of Object.keys(into)) into[k] += s[k] || 0;
  }
  return { sk, gl };
}

/** Jämför kategori för kategori. Returnerar rader och ställningen { w, l, t } sett från mig. */
export function compare(cats, me, opp) {
  const rows = cats.map((cat) => {
    const c = CATS[cat];
    const a = catValue(cat, c.goalie ? me.gl : me.sk);
    const b = catValue(cat, c.goalie ? opp.gl : opp.sk);
    let res = null;
    if (a != null && b != null) {
      const ra = c.ratio ? +a.toFixed(c.ratio) : a, rb = c.ratio ? +b.toFixed(c.ratio) : b;
      res = ra === rb ? 't' : (ra > rb) !== !!c.low ? 'w' : 'l';
    } else if (a != null || b != null) {
      // Kvotkategori där bara ena laget har spelat: ingen ställning ännu
      res = null;
    }
    return { cat, a, b, res, low: !!c.low, ratio: c.ratio || 0 };
  });
  const score = { w: 0, l: 0, t: 0 };
  for (const r of rows) if (r.res) score[r.res]++;
  return { rows, score };
}

export function fmtCat(v, ratio) {
  if (v == null) return '–';
  if (ratio === 3) return v.toFixed(3).replace(/^0/, '');
  if (ratio) return v.toFixed(ratio);
  return String(v);
}
