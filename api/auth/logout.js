import { clearSessionCookie } from '../../lib/session.js';
import { redirect } from '../../lib/http.js';

export default function handler(req, res) {
  redirect(res, '/', [clearSessionCookie(req)]);
}
