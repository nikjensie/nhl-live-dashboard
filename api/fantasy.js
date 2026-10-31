import { readSession, sessionCookie, clearSessionCookie } from '../lib/session.js';
import {
  yf, refreshToken, parseUserLeagues, parseUserTeamKeys, parseStatCategories, parseScoreboard,
} from '../lib/yahoo.js';
import { sendJson } from '../lib/http.js';

// GET /api/fantasy – nuvarande matchup i alla NHL-ligor för inloggad Yahoo-användare.
export default async function handler(req, res) {
  const headers = { 'Cache-Control': 'private, no-store' };
  let session = readSession(req);
  if (!session?.refresh_token) {
    return sendJson(res, 200, { loggedIn: false, configured: !!process.env.YAHOO_CLIENT_ID }, headers);
  }

  const setCookies = [];
  try {
    if (!session.access_token || session.expires_at < Date.now() + 60_000) {
      session = await refreshToken(req, session.refresh_token);
      setCookies.push(sessionCookie(req, session));
    }
    const token = session.access_token;

    const [leaguesJson, teamsJson] = await Promise.all([
      yf(token, '/users;use_login=1/games;game_keys=nhl/leagues'),
      yf(token, '/users;use_login=1/games;game_keys=nhl/teams'),
    ]);
    const leagues = parseUserLeagues(leaguesJson);
    const myKeys = parseUserTeamKeys(teamsJson);

    const results = await Promise.all(
      leagues.map(async (lg) => {
        const base = {
          key: lg.league_key,
          name: lg.name,
          url: lg.url,
          logo: lg.logo_url || null,
          scoringType: lg.scoring_type,
          currentWeek: lg.current_week,
        };
        try {
          const [sb, settings] = await Promise.all([
            yf(token, `/league/${lg.league_key}/scoreboard`),
            yf(token, `/league/${lg.league_key}/settings`),
          ]);
          return { ...base, ...parseScoreboard(sb, myKeys, parseStatCategories(settings)) };
        } catch (err) {
          return { ...base, error: String(err.message || err) };
        }
      })
    );

    if (setCookies.length) res.setHeader('Set-Cookie', setCookies);
    sendJson(res, 200, { loggedIn: true, fetchedAt: new Date().toISOString(), leagues: results }, headers);
  } catch (err) {
    if (err.status === 401 || /token-fel/.test(err.message)) {
      res.setHeader('Set-Cookie', clearSessionCookie(req));
      return sendJson(res, 200, { loggedIn: false, configured: true, expired: true }, headers);
    }
    if (setCookies.length) res.setHeader('Set-Cookie', setCookies);
    sendJson(res, 502, { loggedIn: true, error: String(err.message || err), status: err.status || null }, headers);
  }
}
