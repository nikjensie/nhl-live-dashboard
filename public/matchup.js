// Matchup-vyn: inklistrade Yahoo-trupper (mitt lag + motståndaren) och veckans kategorier live
// ur NHL:s statistik (/api/fstats per dag, måndag–söndag östkusttid).
import { parsePaste, deltaStats, statIndex, sumLines, teamTotals, comparePoints, fantasyPoints, catValue, fmtCat, CATS, POINTS, DEFAULT_SK, DEFAULT_G } from './roster.js';

const KEY = { me: 'rs.roster.me', opp: 'rs.roster.opp' };
const etToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const addDays = (ymd, n) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const sgn = (x) => `${x < 0 ? '−' : '+'} ${Math.abs(x).toFixed(1)}`;
const dayFmt = new Intl.DateTimeFormat('sv-SE', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' });

export function weekOf(today) {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = sön
  const start = addDays(today, -((dow + 6) % 7));
  return { start, end: addDays(start, 6) };
}

export function initMatchup({ store, esc, onChange }) {
  const root = document.querySelector('#matchupView');
  const m = {
    rosters: { me: store.get(KEY.me, null), opp: store.get(KEY.opp, null) },
    editing: { me: false, opp: false },
    days: new Map(), // date -> { at, data }
    remaining: null, // lag -> matcher kvar denna vecka
    timer: null,
    msg: { me: '', opp: '' },
  };

  const visible = () => document.body.dataset.view === 'matchup';
  const cats = () => {
    const src = m.rosters.me?.skCats?.length ? m.rosters.me : m.rosters.opp;
    const sk = src?.skCats?.length ? src.skCats : DEFAULT_SK;
    const gs = (m.rosters.me?.gCats?.length ? m.rosters.me : m.rosters.opp)?.gCats;
    return [...sk, ...(gs?.length ? gs : DEFAULT_G)];
  };

  function save(side, roster) {
    m.rosters[side] = roster;
    store.set(KEY[side], roster);
    onChange(m.rosters);
  }

  function handlePaste(side, text) {
    const teams = parsePaste(text);
    if (!teams.length) {
      m.msg[side] = 'Hittade inga spelare. Kopiera hela matchup-sidan eller lagsidan på Yahoo (markera allt, kopiera) och klistra in igen.';
      render();
      return;
    }
    const stamp = { pastedAt: new Date().toISOString(), week: weekOf(etToday()).start };
    const summary = (r) => {
      const g = r.players.filter((p) => p.goalie).length;
      return `${r.players.length} spelare inlästa (${r.players.length - g} utespelare, ${g} målvakter)${r.total != null ? ` · Yahoo ${r.total.toFixed(2)} p` : ''}.`;
    };
    if (teams.length >= 2) {
      // Matchup-sidan: båda lagen på en gång. Ditt lag står först – om inte namnet säger annat.
      let [a, b] = teams;
      if (m.rosters.me?.team && b.team === m.rosters.me.team) [a, b] = [b, a];
      save('me', { ...a, ...stamp }); save('opp', { ...b, ...stamp });
      m.editing.me = m.editing.opp = false;
      m.msg.me = summary(a); m.msg.opp = summary(b);
    } else {
      save(side, { ...teams[0], ...stamp });
      m.editing[side] = false;
      m.msg[side] = summary(teams[0]);
    }
    render();
    load();
  }

  // Yahoos siffror gäller bara veckan de klistrades in
  const hasBase = (r) => r && r.total != null && r.week === weekOf(etToday()).start;
  /** Statistik som ska räknas för spelaren: allt (utan Yahoo-bas) eller bara det som hänt efter inklistringen. */
  const counted = (r, p, s) => (hasBase(r) ? (p.stats ? deltaStats(p, s) : s) : s);
  /** Spelarens poäng för veckan. */
  function playerFp(r, p, s) {
    if (hasBase(r) && p.fp != null) return Math.round((p.fp + (s ? fantasyPoints(counted(r, p, s), p.goalie) : 0)) * 100) / 100;
    return s ? fantasyPoints(s, p.goalie) : null;
  }

  // ---- Data ----
  async function fetchDay(date, force) {
    const c = m.days.get(date);
    const today = etToday();
    const fresh = c && (date < today ? Date.now() - c.at < 30 * 60_000 : Date.now() - c.at < 45_000);
    if (c && fresh && !force) return c.data;
    const r = await fetch(`/api/fstats?date=${date}`);
    if (!r.ok) throw new Error(r.status);
    const data = await r.json();
    m.days.set(date, { at: Date.now(), data });
    return data;
  }

  async function load() {
    if (!m.rosters.me && !m.rosters.opp) return;
    const today = etToday();
    const { start, end } = weekOf(today);
    const dates = [];
    for (let d = start; d <= end && d <= today; d = addDays(d, 1)) dates.push(d);
    try {
      await Promise.all(dates.map((d) => fetchDay(d)));
      m.error = null;
    } catch {
      m.error = 'Kunde inte hämta statistiken just nu. Försöker igen om en stund.';
    }
    if (!m.remaining) loadRemaining();
    if (visible()) render();
    clearTimeout(m.timer);
    const live = m.days.get(today)?.data?.players?.some((p) => p.live);
    if (visible()) m.timer = setTimeout(load, live ? 30_000 : 120_000);
  }

  async function loadRemaining() {
    try {
      const r = await fetch('/api/week?week=current');
      const w = await r.json();
      m.remaining = new Map(w.teams.map((t) => [t.abbrev, t.games.filter((g) => g.state !== 'final').length]));
      if (visible()) render();
    } catch { m.remaining = new Map(); }
  }

  // ---- Rendering ----
  function statsFor() {
    const { start } = weekOf(etToday());
    const days = [...m.days.entries()].filter(([d]) => d >= start).map(([, v]) => v.data);
    const lines = sumLines(days);
    const idx = statIndex(lines);
    const byId = new Map(lines.map((l) => [l.id, l]));
    const map = new Map();
    for (const side of ['me', 'opp']) {
      for (const p of m.rosters[side]?.players || []) {
        const id = idx.find(p.team, p.name);
        if (id) map.set(p, byId.get(id));
      }
    }
    return map;
  }

  function line(p, s, list) {
    if (!s) return '<span class="mu-none">Ingen match än</span>';
    const parts = [];
    for (const cat of list) {
      const c = CATS[cat];
      if (!!c.goalie !== p.goalie || c.ratio) continue;
      const v = catValue(cat, s);
      if (v) parts.push(`<b>${cat === '+/-' && v > 0 ? '+' : ''}${v}</b> ${esc(cat)}`);
    }
    if (p.goalie && s.sa) parts.push(`<b>${fmtCat(s.sv / s.sa, 3)}</b> SV%`);
    const gp = `${s.gp} ${s.gp === 1 ? 'match' : 'matcher'}`;
    return `${s.live ? '<span class="dot" title="Spelar nu"></span>' : ''}<span class="mu-gp">${gp}</span>${parts.length ? ' · ' + parts.join(' · ') : ''}`;
  }

  function teamCard(side, stats, list) {
    const r = m.rosters[side];
    const label = side === 'me' ? 'Mitt lag' : 'Motståndaren';
    const msg = m.msg[side] ? `<p class="mu-msg">${esc(m.msg[side])}</p>` : '';
    if (!r || m.editing[side]) {
      return `<section class="mu-team ${side}">
        <header><span class="mu-dot"></span><h3>${label}</h3>${r ? `<button class="mu-btn ghost" data-cancel="${side}">Avbryt</button>` : ''}</header>
        ${msg}
        <textarea class="mu-paste" data-paste="${side}" rows="6" placeholder="Klistra in matchup-sidan från Yahoo (fyller i båda lagen) – eller ${side === 'me' ? 'din' : 'motståndarens'} lagsida."></textarea>
        <p class="mu-hint">Inläsningen sker direkt när du klistrar in.</p>
      </section>`;
    }
    const rows = r.players.map((p) => {
      const left = m.remaining?.get(p.team);
      const s = stats.get(p);
      const fp = playerFp(r, p, s);
      return `<li class="${p.active ? '' : 'bench'}">
        <span class="mu-slot">${esc(p.slot || '–')}</span>
        <div class="mu-p">
          <div class="mu-n">${esc(p.name)} <span class="mu-tm">${esc(p.team)} · ${esc(p.pos.join(','))}</span>${p.status ? ` <span class="mu-st">${esc(p.status)}</span>` : ''}</div>
          <div class="mu-l">${p.slot === '--' ? '<span class="mu-none">Släppt – poängen räknas för tiden i laget</span>' : line(p, s, list)}</div>
        </div>
        <div class="mu-r">${fp != null ? `<b class="mu-fp${fp < 0 ? ' neg' : ''}" title="Fantasypoäng denna vecka">${fp.toFixed(1)}</b>` : ''}${left != null ? `<span class="mu-left" title="Matcher kvar denna vecka">${left} kvar</span>` : ''}</div>
      </li>`;
    }).join('');
    const pasted = new Date(r.pastedAt);
    const when = `inklistrad ${pasted.toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'numeric' })} ${pasted.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}`;
    const stale = r.week && r.week !== weekOf(etToday()).start
      ? '<p class="mu-msg warn">Truppen är från en tidigare vecka – klistra in veckans matchup.</p>' : '';
    return `<section class="mu-team ${side}">
      <header><span class="mu-dot"></span><div class="mu-tt"><h3>${esc(r.team || label)}</h3><span>${label} · ${when}</span></div>
        <button class="mu-btn" data-edit="${side}">Klistra in nytt</button>
        <button class="mu-btn ghost" data-clear="${side}">Rensa</button></header>
      ${stale}${msg}
      <ul class="mu-list">${rows}</ul>
    </section>`;
  }

  function render() {
    const { start, end } = weekOf(etToday());
    const list = cats();
    const stats = statsFor();
    const has = m.rosters.me && m.rosters.opp;
    let board = '';
    if (has) {
      const eff = (r) => new Map([...stats].filter(([p]) => r.players.includes(p)).map(([p, s]) => [p, counted(r, p, s)]));
      const rm = m.rosters.me, ro = m.rosters.opp;
      const me = teamTotals(rm, eff(rm)), opp = teamTotals(ro, eff(ro));
      const { rows, total: live } = comparePoints(POINTS, me, opp);
      const bm = hasBase(rm) ? rm.total : 0, bo = hasBase(ro) ? ro.total : 0;
      const total = { me: Math.round((bm + live.me) * 100) / 100, opp: Math.round((bo + live.opp) * 100) / 100 };
      const based = hasBase(rm) || hasBase(ro);
      const at = (r) => new Date(r.pastedAt).toLocaleTimeString('sv-SE', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
      const lead = total.me > total.opp ? 'me' : total.opp > total.me ? 'opp' : '';
      board = `<section class="mu-board">
        <div class="mu-score"><div><span>${esc(m.rosters.me.team || 'Mitt lag')}</span><b class="me${lead === 'me' ? ' lead' : ''}">${total.me.toFixed(1)}</b></div>
          <i>poäng</i>
          <div><b class="opp${lead === 'opp' ? ' lead' : ''}">${total.opp.toFixed(1)}</b><span>${esc(m.rosters.opp.team || 'Motståndaren')}</span></div></div>
        ${based ? `<p class="mu-base"><span>Yahoo ${bm.toFixed(2)} <b>${sgn(live.me)}</b></span><span>live sedan ${esc(at(rm))}</span><span>Yahoo ${bo.toFixed(2)} <b>${sgn(live.opp)}</b></span></p>` : ''}
        ${based ? '<h4 class="mu-sub">Sedan inklistringen</h4>' : ''}
        <table class="mu-cats"><tbody>${rows.map((x) => `<tr class="${x.pa === x.pb ? '' : (x.pa > x.pb ? 'w' : 'l')}">
          <td class="a">${fmtCat(x.a, 0)}<small>${x.pa ? x.pa.toFixed(1) : ''}</small></td>
          <th>${esc(x.cat)}<small>${x.w > 0 ? '+' : ''}${x.w}</small></th>
          <td class="b"><small>${x.pb ? x.pb.toFixed(1) : ''}</small>${fmtCat(x.b, 0)}</td></tr>`).join('')}</tbody></table>
        <p class="mu-note">${based
          ? 'Utgår från Yahoos poäng när matchup-sidan klistrades in och lägger till det som hänt sedan dess för spelare på aktiva platser (inte BN/IR). Klistra in igen när du ändrar laguppställningen – då stämmer det exakt med Yahoo igen.'
          : 'Bara spelare på aktiva platser räknas (inte BN/IR/NA), enligt den senast inklistrade truppen. Klistra in matchup-sidan för att utgå från Yahoos egna poäng.'}</p>
      </section>`;
    }
    root.innerHTML = `
      <div class="wk-head"><h2>Matchup</h2></div>
      <p class="wk-sub">Vecka ${dayFmt.format(new Date(`${start}T12:00:00Z`))} – ${dayFmt.format(new Date(`${end}T12:00:00Z`))} · statistik från NHL, uppdateras live${m.error ? ` · <span class="mu-err">${esc(m.error)}</span>` : ''}</p>
      <div class="mu-grid">${board}${teamCard('me', stats, list)}${teamCard('opp', stats, list)}</div>`;
  }

  // ---- Händelser ----
  root.addEventListener('paste', (e) => {
    const ta = e.target.closest('[data-paste]');
    if (!ta) return;
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') || '';
    handlePaste(ta.dataset.paste, text);
  });
  root.addEventListener('input', (e) => {
    // Inklistring via mobilens meny eller dra-och-släpp ger inte alltid ett paste-event
    const ta = e.target.closest('[data-paste]');
    if (ta && ta.value.length > 40) handlePaste(ta.dataset.paste, ta.value);
  });
  root.addEventListener('click', (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) { m.editing[ed.dataset.edit] = true; m.msg[ed.dataset.edit] = ''; render(); root.querySelector(`[data-paste="${ed.dataset.edit}"]`)?.focus(); return; }
    const cl = e.target.closest('[data-clear]');
    if (cl) {
      const side = cl.dataset.clear;
      save(side, null); store.set(KEY[side], null);
      m.msg[side] = 'Laget är rensat – klistra in ett nytt.';
      render();
      root.querySelector(`[data-paste="${side}"]`)?.focus();
      return;
    }
    const ca = e.target.closest('[data-cancel]');
    if (ca) { m.editing[ca.dataset.cancel] = false; m.msg[ca.dataset.cancel] = ''; render(); }
  });

  return {
    rosters: () => m.rosters,
    show() { render(); load(); },
    hide() { clearTimeout(m.timer); },
  };
}
