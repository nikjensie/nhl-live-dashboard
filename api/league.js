import { readJson, writeJson } from '../lib/store.js';
import { query, sendJson } from '../lib/http.js';
import {
  newId, slug, validPin, hashPin, signToken, verifyToken, publicLeague, cleanRoster, applySave, MAX_FAILS, LOCK_MS,
} from '../lib/league.js';

// /api/league – ligainloggning för Matchup-vyn.
//   GET  ?id=…                                   ligan (lag och trupper, inga PIN-koder)
//   POST {action:'create', name}                 ny liga -> { id }
//   POST {action:'join', id, team, manager, pin} nytt lag i ligan -> { token }
//   POST {action:'login', id, member, pin}       logga in på befintligt lag -> { token }
//   POST {action:'save', id, me, opp}            spara min matchup (Authorization: Bearer <token>)
//   POST {action:'pin', id, pin, newPin}         byt PIN
const path = (id) => `leagues/${id}.json`;
const noStore = { 'Cache-Control': 'private, no-store' };
const validId = (id) => /^[A-Za-z0-9_-]{8,20}$/.test(String(id || ''));

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  let size = 0;
  for await (const c of req) { size += c.length; if (size > 400_000) throw new Error('för stor'); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const id = query(req).get('id');
      if (!validId(id)) return sendJson(res, 400, { error: 'Ogiltig liga' }, noStore);
      const lg = await readJson(path(id));
      if (!lg) return sendJson(res, 404, { error: 'Ligan finns inte' }, noStore);
      return sendJson(res, 200, publicLeague(lg), noStore);
    }
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Metoden stöds inte' }, noStore);

    const body = await readBody(req);
    const { action } = body;

    if (action === 'create') {
      const name = String(body.name || '').trim().slice(0, 60);
      if (!name) return sendJson(res, 400, { error: 'Ange ett namn på ligan' }, noStore);
      const id = newId();
      await writeJson(path(id), { id, name, createdAt: new Date().toISOString(), members: {}, rosters: {} });
      return sendJson(res, 200, { id }, noStore);
    }

    if (!validId(body.id)) return sendJson(res, 400, { error: 'Ogiltig liga' }, noStore);
    const lg = await readJson(path(body.id));
    if (!lg) return sendJson(res, 404, { error: 'Ligan finns inte' }, noStore);
    lg.members ||= {};

    if (action === 'join') {
      const team = String(body.team || '').trim().slice(0, 60);
      const manager = String(body.manager || '').trim().slice(0, 40);
      if (!team) return sendJson(res, 400, { error: 'Ange lagets namn' }, noStore);
      if (!validPin(body.pin)) return sendJson(res, 400, { error: 'PIN ska vara 4–8 siffror' }, noStore);
      if (Object.values(lg.members).some((m) => slug(m.team) === slug(team))) {
        return sendJson(res, 409, { error: 'Laget finns redan i ligan – logga in med lagets PIN i stället' }, noStore);
      }
      if (Object.keys(lg.members).length >= 30) return sendJson(res, 400, { error: 'Ligan är full' }, noStore);
      const mid = newId(6);
      lg.members[mid] = { id: mid, team, manager, pin: hashPin(lg.id, mid, body.pin), createdAt: new Date().toISOString(), fails: 0 };
      // Lag som någon redan klistrat in som motståndare tas över av den nya medlemmen
      const t = `t:${slug(team)}`;
      if (lg.rosters?.[t]) {
        lg.rosters[mid] = lg.rosters[t];
        delete lg.rosters[t];
        // …och motståndaren blir den som klistrade in matchupen
        for (const m of Object.values(lg.members)) if (m.opp === t) { m.opp = mid; lg.members[mid].opp ||= m.id; }
      }
      await writeJson(path(lg.id), lg);
      return sendJson(res, 200, { token: signToken({ l: lg.id, m: mid }), member: mid, league: publicLeague(lg) }, noStore);
    }

    if (action === 'login') {
      const m = lg.members[body.member];
      if (!m) return sendJson(res, 404, { error: 'Laget finns inte' }, noStore);
      if (m.lockedUntil && Date.now() < m.lockedUntil) {
        return sendJson(res, 429, { error: `För många felaktiga försök – vänta ${Math.ceil((m.lockedUntil - Date.now()) / 60000)} min` }, noStore);
      }
      if (hashPin(lg.id, m.id, String(body.pin || '')) !== m.pin) {
        m.fails = (m.fails || 0) + 1;
        if (m.fails >= MAX_FAILS) { m.lockedUntil = Date.now() + LOCK_MS; m.fails = 0; }
        await writeJson(path(lg.id), lg);
        return sendJson(res, 403, { error: 'Fel PIN' }, noStore);
      }
      m.fails = 0; delete m.lockedUntil;
      await writeJson(path(lg.id), lg);
      return sendJson(res, 200, { token: signToken({ l: lg.id, m: m.id }), member: m.id, league: publicLeague(lg) }, noStore);
    }

    // Resten kräver inloggning
    const tok = verifyToken(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
    const member = tok && tok.l === lg.id ? lg.members[tok.m] : null;
    if (!member) return sendJson(res, 401, { error: 'Inte inloggad' }, noStore);

    if (action === 'save') {
      const me = body.me === null ? null : cleanRoster(body.me);
      const opp = body.opp === null ? null : cleanRoster(body.opp);
      if (body.me === null) delete lg.rosters?.[member.id];
      applySave(lg, member, me, body.opp === undefined ? undefined : opp);
      await writeJson(path(lg.id), lg);
      return sendJson(res, 200, { ok: true, league: publicLeague(lg) }, noStore);
    }

    if (action === 'pin') {
      if (hashPin(lg.id, member.id, String(body.pin || '')) !== member.pin) return sendJson(res, 403, { error: 'Fel nuvarande PIN' }, noStore);
      if (!validPin(body.newPin)) return sendJson(res, 400, { error: 'PIN ska vara 4–8 siffror' }, noStore);
      member.pin = hashPin(lg.id, member.id, body.newPin);
      await writeJson(path(lg.id), lg);
      return sendJson(res, 200, { ok: true }, noStore);
    }

    return sendJson(res, 400, { error: 'Okänd åtgärd' }, noStore);
  } catch (err) {
    sendJson(res, 500, { error: 'Något gick fel', detail: String(err.message || err) }, noStore);
  }
}
