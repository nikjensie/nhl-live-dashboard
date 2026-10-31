// Krypterad session-cookie (AES-256-GCM) för Yahoo-token.
// Inga token lagras i webbläsarens JavaScript-åtkomliga storage – cookien är HttpOnly.
import crypto from 'node:crypto';
import { cookie, parseCookies, isSecure } from './http.js';

const NAME = 'yh_session';
const MAX_AGE = 60 * 60 * 24 * 60; // 60 dagar (refresh token håller länge)

function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) throw new Error('SESSION_SECRET saknas eller är för kort (minst 16 tecken)');
  return crypto.createHash('sha256').update(secret).digest();
}

export function seal(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64url');
}

export function unseal(str) {
  try {
    const buf = Buffer.from(str, 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
  } catch {
    return null;
  }
}

export function readSession(req) {
  const raw = parseCookies(req)[NAME];
  return raw ? unseal(raw) : null;
}

export function sessionCookie(req, data) {
  return cookie(NAME, seal(data), { maxAge: MAX_AGE, secure: isSecure(req) });
}

export function clearSessionCookie(req) {
  return cookie(NAME, '', { maxAge: 0, secure: isSecure(req) });
}
