// Ligans veckomatchups från Yahoos publika ligasida (hockey.fantasysports.yahoo.com/hockey/<id>).
// Fungerar bara för ligor som är publika hos Yahoo. Sidans uppbyggnad kan ändras – parsern
// letar därför efter länkarna "matchup?week=…&mid1=…&mid2=…" och läser text och siffror runt dem.

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export const decode = (s) => String(s).replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENT[e.toLowerCase()] ?? m;
});
export const textTokens = (html) => decode(String(html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, '\n'))
  .split('\n').map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);

const MATCHUP = /matchup\?week=(\d+)&(?:amp;)?mid1=(\d+)&(?:amp;)?mid2=(\d+)/g;
const RECORD = /^(\d+-\d+-\d+)\s*\|\s*(\d+(?:st|nd|rd|th))$/i;
const NUM = /^-?\d+\.\d{2}$/;

export function parseLeaguePage(html, leagueId) {
  const page = String(html || '');
  // Ligans namn ur <title> ("Trades R Us | Yahoo Fantasy Hockey" eller liknande)
  const title = decode((/<title>([^<]*)<\/title>/i.exec(page) || [])[1] || '').split('|')[0].trim();

  // Första förekomsten av matchup-länken för varje par
  const hits = [];
  const seen = new Set();
  for (const m of page.matchAll(MATCHUP)) {
    const key = `${m[2]}-${m[3]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({ week: +m[1], mid1: +m[2], mid2: +m[3], at: m.index });
  }
  const teamName = (seg, mid) => {
    const re = new RegExp(`<a[^>]+href="[^"]*/hockey/${leagueId}/${mid}"[^>]*>([\\s\\S]*?)</a>`, 'gi');
    for (const m of seg.matchAll(re)) {
      const t = textTokens(m[1]).join(' ').trim();
      if (t && !/^view/i.test(t)) return t;
    }
    return '';
  };
  const matchups = hits.map((h, i) => {
    const end = i + 1 < hits.length ? hits[i + 1].at : h.at + 8000;
    const own = page.slice(h.at, end);
    const toks = textTokens(own);
    const nums = toks.filter((t) => NUM.test(t)).map(Number);
    const recs = toks.map((t) => RECORD.exec(t)).filter(Boolean);
    const team = (mid, k) => ({
      id: mid, name: teamName(own, mid), record: recs[k]?.[1] || '', rank: recs[k]?.[2] || '',
      points: nums[k * 2] ?? null, proj: nums[k * 2 + 1] ?? null,
    });
    return {
      week: h.week,
      url: `https://hockey.fantasysports.yahoo.com/hockey/${leagueId}/matchup?week=${h.week}&mid1=${h.mid1}&mid2=${h.mid2}`,
      teams: [team(h.mid1, 0), team(h.mid2, 1)],
    };
  });
  const standings = parseStandings(page, leagueId);
  for (const m of matchups) for (const t of m.teams) {
    const st = standings[t.id];
    if (st) t.season = st.points;
    if (st) t.played = st.played;
  }
  return { id: String(leagueId), name: title, week: matchups[0]?.week ?? null, matchups };
}

/** Standings-tabellen: lag-ID -> säsongens totalpoäng (Pts) och antal spelade veckor. */
export function parseStandings(html, leagueId) {
  const out = {};
  const page = String(html || '');
  const start = page.search(/id="standingstable"/);
  if (start < 0) return out;
  const end = page.indexOf('</table>', start);
  const table = page.slice(start, end < 0 ? undefined : end);
  const rowRe = new RegExp(`<tr[^>]*data-target="/hockey/${leagueId}/(\\d+)"[^>]*>([\\s\\S]*?)</tr>`, 'gi');
  for (const m of table.matchAll(rowRe)) {
    const toks = textTokens(m[2]);
    const rec = toks.find((t) => /^\d+-\d+-\d+$/.test(t));
    const pts = toks.find((t) => NUM.test(t));
    if (pts == null) continue;
    out[+m[1]] = { points: Number(pts), played: rec ? rec.split('-').reduce((a, b) => a + +b, 0) : null };
  }
  return out;
}

export async function fetchLeaguePage(leagueId, teamId) {
  const r = await fetch(`https://hockey.fantasysports.yahoo.com/hockey/${leagueId}${teamId ? `/${teamId}` : ''}`, {
    headers: { Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' },
    redirect: 'follow',
  });
  return { status: r.status, url: r.url, html: await r.text() };
}
