import crypto from 'node:crypto';
import { authorizeUrl } from '../../lib/yahoo.js';
import { cookie, isSecure, redirect, sendJson } from '../../lib/http.js';

export default function handler(req, res) {
  try {
    const state = crypto.randomBytes(16).toString('hex');
    redirect(res, authorizeUrl(req, state), [
      cookie('yh_state', state, { maxAge: 600, secure: isSecure(req) }),
    ]);
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
}
