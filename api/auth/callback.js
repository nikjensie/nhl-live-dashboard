import { exchangeCode } from '../../lib/yahoo.js';
import { sessionCookie } from '../../lib/session.js';
import { cookie, isSecure, parseCookies, query, redirect } from '../../lib/http.js';

export default async function handler(req, res) {
  const q = query(req);
  const clearState = cookie('yh_state', '', { maxAge: 0, secure: isSecure(req) });
  const expected = parseCookies(req).yh_state;

  if (q.get('error')) return redirect(res, `/?auth=denied`, [clearState]);
  if (!q.get('code') || !expected || q.get('state') !== expected) {
    return redirect(res, `/?auth=invalid`, [clearState]);
  }
  try {
    const tokens = await exchangeCode(req, q.get('code'));
    redirect(res, '/?auth=ok', [clearState, sessionCookie(req, tokens)]);
  } catch (err) {
    console.error(err);
    redirect(res, `/?auth=error`, [clearState]);
  }
}
