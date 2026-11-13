// Enkel ligainloggning: en liga nås via en hemlig länk (id), varje medlem gör anspråk på ett
// lag med en PIN. Lagen (trupper + Yahoos poäng) sparas i ligan så att alla kan se varandras matchups.
import crypto from 'node:crypto';

const secret = () => {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.VERCEL) throw new Error('SESSION_SECRET saknas');
  return 'dev-secret-endast-lokalt-0123456789';
};

export const MAX_FAILS = 8;
export const LOCK_MS = 15 * 60_000;

export const newId = (bytes = 9) => crypto.randomBytes(bytes).toString('base64url');
export const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
export const validPin = (p) => /^\d{4,8}$/.test(String(p || ''));

/** PIN hashas med serverhemligheten (HMAC) – går inte att knäcka utan den, även om ligafilen läcker. */
export function hashPin(leagueId, memberId, pin) {
  return crypto.createHmac('sha256', secret()).update(`pin|${leagueId}|${memberId}|${pin}`).digest('base64url');
}

export function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', secret()).update(`tok|${body}`).digest('base64url');
  return `${body}.${mac}`;
}

export function verifyToken(tok) {
  const [body, mac] = String(tok || '').split('.');
  if (!body || !mac) return null;
  const want = crypto.createHmac('sha256', secret()).update(`tok|${body}`).digest('base64url');
  const a = Buffer.from(mac), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
}

/** Ligan som den visas för klienten: inga PIN-hashar eller spärrinfo. */
export function publicLeague(lg) {
  return {
    id: lg.id, name: lg.name, createdAt: lg.createdAt,
    members: Object.values(lg.members || {}).map((m) => ({ id: m.id, team: m.team, manager: m.manager, opp: m.opp || null, updatedAt: m.updatedAt || null })),
    rosters: lg.rosters || {},
  };
}

/** Begränsa storleken på det som sparas (skydd mot skräp). */
export function cleanRoster(r) {
  if (!r || typeof r !== 'object' || !Array.isArray(r.players)) return null;
  const str = (v, n = 60) => String(v ?? '').slice(0, n);
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const stats = (o) => (o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).slice(0, 40).filter(([, v]) => num(v) !== undefined).map(([k, v]) => [str(k, 8), v])) : undefined);
  return {
    team: str(r.team), manager: str(r.manager), record: str(r.record, 30),
    total: num(r.total) ?? null, week: str(r.week, 10), pastedAt: str(r.pastedAt, 30),
    skCats: (r.skCats || []).slice(0, 30).map((c) => str(c, 8)), gCats: (r.gCats || []).slice(0, 15).map((c) => str(c, 8)),
    players: r.players.slice(0, 60).map((p) => ({
      id: num(p.id), slot: str(p.slot, 6), name: str(p.name), team: str(p.team, 4), pos: (p.pos || []).slice(0, 4).map((x) => str(x, 3)),
      goalie: !!p.goalie, status: str(p.status, 8), active: !!p.active, fp: num(p.fp),
      stats: stats(p.stats), from: stats(p.from), to: stats(p.to), wasActive: p.wasActive ? true : undefined,
      prevSlot: p.prevSlot ? str(p.prevSlot, 6) : undefined, addedAt: p.addedAt ? str(p.addedAt, 30) : undefined, droppedAt: p.droppedAt ? str(p.droppedAt, 30) : undefined,
    })),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Spara en medlems matchup: hans eget lag och motståndaren. Motståndarens trupp skrivs bara
 * om den är nyare än den som finns (motståndaren kan själv vara medlem och ha klistrat in senare).
 */
export function applySave(lg, member, me, opp) {
  lg.rosters ||= {};
  const key = (r) => slug(r.team);
  if (me) {
    me.team ||= member.team;
    lg.rosters[member.id] = me;
  }
  if (opp && opp.team) {
    const owner = Object.values(lg.members).find((m) => m.id !== member.id && slug(m.team) === key(opp));
    const k = owner ? owner.id : `t:${key(opp)}`;
    const cur = lg.rosters[k];
    if (!cur || !owner || (cur.pastedAt || '') <= (opp.pastedAt || '')) lg.rosters[k] = opp;
    member.opp = k;
    // Motståndaren är medlem utan inlagd motståndare: samma matchup gäller åt andra hållet
    if (owner && !owner.opp) owner.opp = member.id;
  } else if (opp === null) {
    member.opp = null;
  }
  member.updatedAt = new Date().toISOString();
  return lg;
}
