// Yahoo OAuth 2.0 + Fantasy Sports API.
import { origin } from './http.js';

const AUTH = 'https://api.login.yahoo.com/oauth2';
const API = 'https://fantasysports.yahooapis.com/fantasy/v2';

export function redirectUri(req) {
  return (process.env.YAHOO_REDIRECT_URI || '').trim() || `${origin(req)}/api/auth/callback`;
}

function creds() {
  // trim(): ett mellanslag eller radbrytning från kopiering får Yahoo att avvisa begäran
  const id = (process.env.YAHOO_CLIENT_ID || '').trim();
  const secret = (process.env.YAHOO_CLIENT_SECRET || '').trim();
  if (!id || !secret) throw new Error('YAHOO_CLIENT_ID / YAHOO_CLIENT_SECRET saknas');
  return { id, secret };
}

export function authorizeUrl(req, state) {
  const p = new URLSearchParams({
    client_id: creds().id,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    language: 'en-us',
    // Be uttryckligen om Fantasy Sports-läsrätt; utan detta kan Yahoo ge en token som API:et nekar (403)
    scope: 'fspt-r',
    state,
  });
  return `${AUTH}/request_auth?${p}`;
}

/** Yahoos Client ID är base64 av "v=..&i=..&d=<base64 'ai=APPID&pj=0'>&s=..". App ID är inte hemligt. */
export function appIdFromClientId(id) {
  try {
    const outer = Buffer.from(id, 'base64').toString();
    const d = /(?:^|&)d=([^&]+)/.exec(outer)?.[1];
    if (!d) return null;
    const inner = Buffer.from(d.replace(/-/g, '='), 'base64').toString();
    return /(?:^|&)ai=([^&]+)/.exec(inner)?.[1] || null;
  } catch {
    return null;
  }
}

async function tokenRequest(params) {
  const { id, secret } = creds();
  const r = await fetch(`${AUTH}/get_token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Yahoo token-fel: ${j.error_description || j.error || r.status}`);
  // Diagnostik utan hemligheter: vilken app (App ID ur Client ID), grant-typ och ev. scope
  const appId = appIdFromClientId(id);
  console.log(`Yahoo token (${params.grant_type}) app=${appId || '?'} scope=${j.scope ?? '(saknas i svaret)'} expires_in=${j.expires_in}`);
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: Date.now() + (Number(j.expires_in) || 3600) * 1000,
    issued_at: Date.now(),
  };
}

export const exchangeCode = (req, code) =>
  tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(req) });

export const refreshToken = (req, refresh_token) =>
  tokenRequest({ grant_type: 'refresh_token', refresh_token, redirect_uri: redirectUri(req) });

export async function yf(token, path) {
  const url = `${API}${path}${path.includes('?') ? '&' : '?'}format=json`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 401) {
    const e = new Error('unauthorized');
    e.status = 401;
    throw e;
  }
  if (!r.ok) {
    // Yahoo skickar en förklaring i svaret (JSON eller XML) – ta med den i felet
    const body = await r.text().catch(() => '');
    let why = '';
    try { why = JSON.parse(body)?.error?.description || ''; } catch {}
    if (!why) why = /<description>([^<]*)<\/description>/i.exec(body)?.[1] || '';
    console.error(`Yahoo API ${r.status} ${path}: ${body.slice(0, 500)}`);
    const e = new Error(why ? `Yahoo ${r.status}: ${why}` : `Yahoo API ${r.status} ${path}`);
    e.status = r.status;
    throw e;
  }
  return r.json();
}

// ---- Tolkning av Yahoos säregna JSON (numrerade nycklar + arrayer av objekt) ----

/** {"0": x, "1": y, "count": 2} -> [x, y] */
export function list(obj) {
  if (!obj || typeof obj !== 'object') return [];
  if (Array.isArray(obj)) return obj;
  return Object.keys(obj)
    .filter((k) => /^\d+$/.test(k))
    .sort((a, b) => a - b)
    .map((k) => obj[k]);
}

/** [{a:1}, [{b:2}, {c:3}], {d:4}] -> {a:1, b:2, c:3, d:4} */
export function flat(x) {
  const out = {};
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.assign(out, v);
  };
  walk(x);
  return out;
}

export function parseUserLeagues(json) {
  const user = flat(list(json?.fantasy_content?.users)[0]?.user);
  const out = [];
  for (const g of list(user.games)) {
    const game = flat(g.game);
    for (const l of list(game.leagues)) {
      const league = flat(l.league);
      if (league.league_key) out.push(league);
    }
  }
  return out;
}

export function parseUserTeamKeys(json) {
  const user = flat(list(json?.fantasy_content?.users)[0]?.user);
  const keys = new Set();
  for (const g of list(user.games)) {
    for (const t of list(flat(g.game).teams)) {
      const team = flat(t.team);
      if (team.team_key) keys.add(team.team_key);
    }
  }
  return keys;
}

export function parseStatCategories(json) {
  const league = flat(json?.fantasy_content?.league);
  const settings = flat(league.settings);
  const map = new Map();
  for (const s of list(settings.stat_categories?.stats)) {
    const st = s.stat || s;
    if (st.stat_id == null) continue;
    map.set(String(st.stat_id), {
      name: st.display_name || st.abbr || st.name,
      displayOnly: String(st.is_only_display_stat) === '1',
      lowerIsBetter: st.sort_order === '0' || st.sort_order === 0,
    });
  }
  return map;
}

function teamInfo(t) {
  const team = flat(t.team);
  const logos = list(team.team_logos).map((x) => x.team_logo || x);
  const stats = {};
  for (const s of list(team.team_stats?.stats)) {
    const st = s.stat || s;
    stats[String(st.stat_id)] = st.value;
  }
  return {
    key: team.team_key,
    name: team.name,
    logo: logos[0]?.url || null,
    manager: list(team.managers).map((m) => (m.manager || m).nickname).filter(Boolean)[0] || null,
    points: team.team_points?.total != null ? Number(team.team_points.total) : null,
    projected: team.team_projected_points?.total != null ? Number(team.team_projected_points.total) : null,
    stats,
    url: team.url || null,
  };
}

export function parseScoreboard(json, myKeys, cats) {
  const league = flat(json?.fantasy_content?.league);
  const sb = flat(league.scoreboard);
  const week = sb.week ?? league.current_week ?? null;
  const matchups = list(list(sb)[0]?.matchups ?? sb.matchups).map((m) => m.matchup || m);

  for (const m of matchups) {
    const teams = list(m['0']?.teams ?? m.teams).map(teamInfo);
    const meIdx = teams.findIndex((t) => myKeys.has(t.key));
    if (meIdx < 0 || teams.length < 2) continue;
    const me = teams[meIdx];
    const opp = teams[1 - meIdx];

    const winners = new Map();
    for (const w of list(m.stat_winners)) {
      const sw = w.stat_winner || w;
      winners.set(String(sw.stat_id), String(sw.is_tied) === '1' ? 'tie' : sw.winner_team_key);
    }
    const categories = [];
    let wins = 0, losses = 0, ties = 0;
    for (const [id, cat] of cats) {
      if (cat.displayOnly) continue;
      const w = winners.get(id);
      const result = w === 'tie' ? 'tie' : w === me.key ? 'me' : w === opp.key ? 'opp' : null;
      if (result === 'me') wins++;
      else if (result === 'opp') losses++;
      else if (result === 'tie') ties++;
      categories.push({ id, name: cat.name, me: me.stats[id] ?? '-', opp: opp.stats[id] ?? '-', result });
    }

    return {
      week: m.week ?? week,
      status: m.status || null,
      isPlayoffs: String(m.is_playoffs) === '1',
      weekStart: m.week_start || null,
      weekEnd: m.week_end || null,
      me: strip(me),
      opp: strip(opp),
      categories,
      record: winners.size ? { wins, losses, ties } : null,
    };
  }
  return { week, status: null, me: null, opp: null, categories: [], record: null };
}

function strip({ stats, ...t }) {
  return t;
}
