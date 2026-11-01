// TILLFÄLLIG: kontrollerar CORS och innehåll för en NHL-radioström. Tas bort efter kontroll.
import { sendJson } from '../lib/http.js';

export default async function handler(req, res) {
  const url = 'https://d2igy0yla8zi0u.cloudfront.net/min/20262027/min-radio.m3u8';
  const out = {};
  try {
    const r = await fetch(url, { headers: { Origin: 'https://nhl-live-dashboard.vercel.app' } });
    out.status = r.status;
    out.acao = r.headers.get('access-control-allow-origin');
    out.type = r.headers.get('content-type');
    const body = await r.text();
    out.head = body.slice(0, 400);
    const sub = body.split('\n').find((l) => l && !l.startsWith('#'));
    if (sub) {
      const subUrl = new URL(sub, url).href;
      const r2 = await fetch(subUrl, { headers: { Origin: 'https://nhl-live-dashboard.vercel.app' } });
      out.sub = { url: subUrl.replace(/\?.*/, ''), status: r2.status, acao: r2.headers.get('access-control-allow-origin'), head: (await r2.text()).slice(0, 300) };
    }
  } catch (e) { out.error = String(e.message); }
  sendJson(res, 200, out, { 'Cache-Control': 'no-store' });
}
