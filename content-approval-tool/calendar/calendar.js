/* Content Calendar, inside Post Approvals (Kate, 12 Nov 2026).
   Every post we made on Instagram, Facebook and TikTok, on a calendar, with what worked and a plan for next month.
   No login, like the rest of Post Approvals (Kate, 12 Nov 2026). It reads content_calendar_posts(), which answers the public key and returns only what
   anyone can already see on a post (caption, picture, link, time, likes, comments, plays on reels and videos, shares), never reach, saves or impressions.
   The plan (one action, one owner, one date) is kept by content_plan_* in the same database (migrations/content_calendar_open.sql in the dashboard repo).
   The calendar part (scal*) is the dashboard's social-calendar.js; the helpers it expects from the dashboard are defined just below. */
'use strict';

// The dashboard's own project and its publishable key (public by design, the same one the dashboard pages carry). Tables are closed to it; only the content_* functions answer.
const CAL_URL = 'https://gvijxenafoowajqktqvd.supabase.co';
const CAL_KEY = 'sb_publishable_e5o0vPayb-6552oARTeu7Q_KoqfT7xO';
const sb = supabase.createClient(CAL_URL, CAL_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

// Helpers the dashboard calendar expects.
const mkIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const mkD = s => new Date(s + 'T00:00:00');
const mkEsc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SOC_NETS = { instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook', youtube: 'YouTube' };
const calDark = () => { const t = document.documentElement.getAttribute('data-theme'); return t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches; };
const socCols = () => calDark()
  ? { instagram: '#E58BD0', facebook: '#8FB4F0', tiktok: '#6FE0DA', youtube: '#FF9B94' }
  : { instagram: '#A23B8C', facebook: '#2F62B5', tiktok: '#0E7C78', youtube: '#B8322A' };
const calSafeUrl = u => /^https?:\/\//i.test(String(u || '')) ? String(u) : '';
// Kate, 12 Nov 2026, "remove crossed out box for now": the plan form in the post panel (What did you notice? / Try it again / Add to next month's plan) and the
// Next month's plan list below the calendar are off. Set this to true to bring both back; the database side (content_plan_*) is untouched.
const CAL_PLAN_ON = false;

// Embedded in the dashboard (Kate, 12 Nov 2026): the dashboard's Content Calendar page shows this page in a frame, so the main sidebar stays. ?embed=1 hides this
// page's own logo bar, and the page follows the dashboard's light or dark (?theme= at the start, then a trs-theme message from the dashboard).
const calParams = new URLSearchParams(location.search);
const calEmbedded = calParams.get('embed') === '1' && window.parent !== window;
if (calEmbedded) {
  document.documentElement.classList.add('embedded');
  const th0 = calParams.get('theme'); if (th0 === 'dark' || th0 === 'light') document.documentElement.setAttribute('data-theme', th0);
  // The dashboard sends two things, and only the page that holds this frame is listened to (e.source is the parent):
  //   trs-theme  { theme: 'dark' | 'light' }
  //   trs-cal-cmd { cmd: 'prev' | 'next' | 'today' | 'view', value }   the buttons of the dashboard's masthead bar (Kate, 12 Nov 2026: month or week, Today, Week | Month | List moved up there)
  // and this page answers with trs-cal-state (scalPostState, below).
  window.addEventListener('message', e => {
    if (e.source !== window.parent || !e.data) return;
    if (e.data.type === 'trs-theme' && (e.data.theme === 'dark' || e.data.theme === 'light')) {
      document.documentElement.setAttribute('data-theme', e.data.theme);
      if (typeof scalPaint === 'function' && document.getElementById('scalRoot') && document.getElementById('scalRoot').children.length) scalPaint();
    } else if (e.data.type === 'trs-cal-stories' && typeof scal !== 'undefined') {
      scalGotStats(e.data);
    } else if (e.data.type === 'trs-cal-cmd' && typeof scal !== 'undefined' && scal.ws) {
      const c = e.data.cmd;
      if (c === 'prev') scalNav(-1);
      else if (c === 'next') scalNav(1);
      else if (c === 'today') scalToToday();
      else if (c === 'view' && SCAL_VIEWS.includes(e.data.value)) scalView(e.data.value);
    }
  });
}

// ──────────────────────────────────────────────────────────────────────────────────────
// The calendar (from the dashboard's social-calendar.js)
// ──────────────────────────────────────────────────────────────────────────────────────
// Social, Calendar tab (Kate, 11 Nov 2026): every post we made on Instagram, Facebook and TikTok on a calendar, so the content plan starts from
// what was really posted and how it did. Three views of the same posts: Week (hours down the side, a column a day), Month, and List.
// One platform shows by itself; two or more show together, one colour each.
//
// Where it reads from: the same social_report() the other Social tabs use (migrations/metricool_report_tabs.sql), asked a month at a time and
// kept for the visit, so moving between weeks inside a month costs nothing. Posts come from metricool_posts (nightly), and the blue behind the
// hours is Metricool's own "best time to post" for the last 30 days (metricool_snapshots, kind besttime, Dubai time). Level 3 and above, like the
// rest of Social.
//
// What is NOT here yet, and why (nothing is faked):
//   YouTube     Metricool gives YouTube daily totals only, no list of videos. The chip is there and says so.
//   Clicks      Metricool's post feed has no clicks per post; only the account-level website clicks, and Instagram returns none.
//   Tagged      the post feed has no tagged accounts.
//   Playing     we keep the post's picture and its link, not the video. The panel opens the post on its own app.
// A line a platform has no number for is left out of the panel, not shown as a dash.
//
// Prefix scal-, one global state object. Drawn from social.js (socPaint), after marketing-chart.js (mk* helpers) and social.js (socCols, SOC_NETS).
const SCAL_NETS = ['instagram', 'facebook', 'tiktok'];
const SCAL_CODE = { instagram: 'IG', facebook: 'FB', tiktok: 'TT', youtube: 'YT' };
// The first month Metricool holds posts for, a platform at a time (see project notes: FB Jan 2025, IG Aug 2025, TikTok Jun 2026).
const SCAL_START = { instagram: '2025-08', facebook: '2025-01', tiktok: '2026-06' };
const SCAL_FIRST = '2025-01';
const SCAL_KIND = { reel: 'reel', post: 'post', video: 'video', photo: 'photo post' };
const SCAL_VIEWS = ['day', 'week', 'month', 'list'];
const SCAL_MONTHS_NAMED = { '2025-01': 'January 2025', '2025-08': 'August 2025', '2026-06': 'June 2026' };

const scal = { view: 'week', ws: null, dd: null, sstats: {}, statsOk: false, sasked: {}, month: null, scope: 'month', on: { instagram: true, facebook: true, tiktok: true }, sel: null, stories: false, sday: null, q: '', sort: 'new', open: null, busy: false, err: false };
const scalCache = {};            // 'YYYY-MM' -> [post]
let scalSnaps = null, scalSync = null;
try {
  const s = JSON.parse(localStorage.getItem('trs-approvals-scal') || '{}');
  if (SCAL_VIEWS.includes(s.view)) scal.view = s.view;
  scal.stories = s.stories === true;
  if (s.on) SCAL_NETS.forEach(n => { if (typeof s.on[n] === 'boolean') scal.on[n] = s.on[n]; });
  if (!SCAL_NETS.some(n => scal.on[n])) SCAL_NETS.forEach(n => { scal.on[n] = true; });
} catch (e) {}
const scalSave = () => { try { localStorage.setItem('trs-approvals-scal', JSON.stringify({ view: scal.view, on: scal.on, stories: scal.stories })); } catch (e) {} };

// ── Dates (all Dubai days, as ISO strings) ────────────────────────────────────────
const scalToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
const scalAdd = (iso, n) => { const d = mkD(iso); d.setDate(d.getDate() + n); return mkIso(d); };
const scalMon = iso => { const d = mkD(iso); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return mkIso(d); };
const scalMonthEnd = key => { const [y, m] = key.split('-').map(Number); return key + '-' + String(new Date(y, m, 0).getDate()).padStart(2, '0'); };
const scalShiftMonth = (key, n) => { const [y, m] = key.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
const scalLong = iso => mkD(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const scalShort = iso => mkD(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const scalMonthName = key => mkD(key + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
function scalTimeParts(iso) {
  if (!iso) return null;
  try {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(new Date(iso));
    const g = t => Number((p.find(x => x.type === t) || {}).value);
    return { h: g('hour') % 24, m: g('minute') };
  } catch (e) { return null; }
}
const scalClock = (t, short) => { if (!t) return ''; const h = t.h % 12 || 12, ap = t.h >= 12 ? (short ? 'p' : 'pm') : (short ? 'a' : 'am'); return h + ':' + String(t.m).padStart(2, '0') + ap; };
const scalHour = h => (h % 12 || 12) + (h >= 12 ? 'pm' : 'am');
const scalN = v => (v === null || v === undefined || !isFinite(v)) ? null : Number(v);
const scalFmt = v => v === null ? 'n/a' : v >= 10000 ? (Math.round(v / 100) / 10) + 'k' : Math.round(v).toLocaleString('en-GB');
const scalHue = id => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return h % 360; };

// ── Posts ─────────────────────────────────────────────────────────────────────────
function scalPost(p, i, key) {
  const net = p.network, kind = SCAL_KIND[p.kind] ? p.kind : 'post';
  const reposts = net === 'instagram' ? scalN(p.extra && p.extra.reposts) : scalN(p.shares);
  return { id: key + '#' + i, net, kind, date: String(p.post_date || '').slice(0, 10), at: p.posted_at, t: scalTimeParts(p.posted_at),
    cap: String(p.caption || '').trim(), url: p.url || '', img: p.image_url || '',
    views: scalN(p.views), reach: scalN(p.reach), likes: scalN(p.likes), comments: scalN(p.comments), reposts, saves: scalN(p.saves),
    // Facebook posts report impressions in the views field; its reels and the other apps report plays.
    viewLabel: net === 'facebook' && kind === 'post' ? 'Impressions' : 'Views',
    repostLabel: net === 'instagram' ? 'Reposts' : 'Shares' };
}
const scalIsVideo = p => p.kind === 'reel' || p.kind === 'video';

async function scalLoad(key) {
  if (scalCache[key]) return;
  const { data, error } = await sb.rpc('content_calendar_posts', { p_from: key + '-01', p_to: scalMonthEnd(key) });
  if (error || !data) throw error || new Error('no data');
  scalCache[key] = (data.posts || []).filter(p => SCAL_NETS.includes(p.network)).map((p, i) => scalPost(p, i, key))
    .sort((a, b) => (a.at || a.date) < (b.at || b.date) ? -1 : 1);
  scalSnaps = data.snapshots || scalSnaps;
  scalSync = data.sync || scalSync;
}

// The period on screen: a week (Week view, or the List opened from a week's count) or a month.
function scalPeriod() {
  if (scal.view === 'day' || (scal.view === 'list' && scal.scope === 'day')) {
    const d = scal.dd, label = mkD(d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return { kind: 'day', from: d, to: d, label, months: [d.slice(0, 7)] };
  }
  const week = scal.view === 'week' || (scal.view === 'list' && scal.scope === 'week');
  if (week) {
    const from = scal.ws, to = scalAdd(from, 6), a = from.slice(0, 7), b = to.slice(0, 7);
    const d1 = mkD(from), d2 = mkD(to);
    const label = a === b ? `${d1.getDate()} to ${d2.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`
      : `${d1.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} to ${d2.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    return { kind: 'week', from, to, label, months: a === b ? [a] : [a, b] };
  }
  return { kind: 'month', from: scal.month + '-01', to: scalMonthEnd(scal.month), label: scalMonthName(scal.month), months: [scal.month] };
}
const scalPosts = per => per.months.flatMap(k => scalCache[k] || []).filter(p => p.date >= per.from && p.date <= per.to && scal.on[p.net]);
const scalFind = id => { for (const k in scalCache) { const f = scalCache[k].find(p => p.id === id); if (f) return f; } return null; };

function scalEdges(per, today) {
  if (per.kind === 'day') return { atMin: scal.dd <= SCAL_FIRST + '-01', atMax: scal.dd >= today };
  if (per.kind === 'week') return { atMin: scal.ws <= scalMon(SCAL_FIRST + '-01'), atMax: scal.ws >= scalMon(today) };
  return { atMin: scal.month <= SCAL_FIRST, atMax: scal.month >= today.slice(0, 7) };
}

async function scalEnsurePosts() {
  if (!scal.ws) { const t = scalToday(); scal.ws = scalMon(t); scal.month = t.slice(0, 7); scal.dd = t; }
  const per = scalPeriod(), need = per.months.filter(k => !scalCache[k]);
  if (!need.length) { scal.busy = false; scal.err = false; scalPaint(); return; }
  scal.busy = true; scalPaint();
  try { await Promise.all(need.map(scalLoad)); scal.err = false; }
  catch (e) { console.error(e); scal.err = true; }
  scal.busy = false; scalPaint();
}

// ── Best times: Metricool's last 30 days, summed over the platforms on show ─────────
function scalBest() {
  const nets = SCAL_NETS.filter(n => scal.on[n] && scalSnaps && scalSnaps[n] && scalSnaps[n].besttime && scalSnaps[n].besttime.v);
  if (!nets.length) return null;
  const sum = {};
  nets.forEach(n => { const v = scalSnaps[n].besttime.v, mx = Math.max(...Object.values(v).map(Number), 0) || 1;
    Object.entries(v).forEach(([k, x]) => { sum[k] = (sum[k] || 0) + Number(x) / mx; }); });
  // Key is '<day 1 Mon..7 Sun>-<hour 0..23>'. Metricool scores almost every daytime hour, so the shades are by rank, not by size:
  // the best tenth of the hours of the week is the darkest, the next quarter a middle shade, the next third a light one, the rest none.
  const all = Object.values(sum).sort((a, b) => b - a), at = f => all[Math.min(all.length - 1, Math.floor(all.length * f))];
  const c3 = at(.10), c2 = at(.35), c1 = at(.70);
  return (dow, h) => { const v = sum[(dow + 1) + '-' + h] || 0; return v >= c3 && v > 0 ? 3 : v >= c2 && v > 0 ? 2 : v >= c1 && v > 0 ? 1 : 0; };
}

// ── Little pieces ─────────────────────────────────────────────────────────────────
function scalBadgeFg(hex) { const n = parseInt(hex.slice(1), 16), l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; return l > .6 ? '#1A1A1A' : '#FFFFFF'; }
const scalStyle = (p, cols) => `--c:${cols[p.net]};--bf:${scalBadgeFg(cols[p.net])};--g:linear-gradient(155deg,hsl(${scalHue(p.id)} 45% 62%),hsl(${(scalHue(p.id) + 30) % 360} 35% 38%))`;
const SCAL_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const scalImg = (p, panel) => p.img ? `<img src="${mkEsc(p.img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()"${panel ? ' onload="scalFit(this)"' : ''}>` : '';
const scalLabel = p => `${SOC_NETS[p.net]} ${SCAL_KIND[p.kind]}, ${scalClock(p.t) || 'time not known'}, ${p.cap.slice(0, 80)}, ${scalFmt(p.likes)} likes`;
const scalCap = p => mkEsc(p.cap || '(no caption)');
const scalStats = p => `<b>${scalFmt(p.likes)}</b> likes · <b>${scalFmt(p.comments)}</b> comments`;

function scalTile(p, cols, cls) {
  const cur = scal.sel === p.id ? ' aria-current="true"' : '';
  return `<button type="button" class="scal-${cls}" data-id="${mkEsc(p.id)}" style="${scalStyle(p, cols)}" aria-label="${mkEsc(scalLabel(p))}"${cur} onclick="scalOpen(this.dataset.id)">
    <span class="scal-th">${scalImg(p)}${scalIsVideo(p) ? SCAL_PLAY : ''}</span>
    ${cls === 'wc' ? '<span class="bd">' : ''}<span class="scal-r1"><span class="scal-bb" aria-hidden="true">${SCAL_CODE[p.net]}</span>${scalClock(p.t) || 'Time not known'}</span>
    <span class="scal-cp">${scalCap(p)}</span><span class="scal-st">${scalStats(p)}</span>${cls === 'wc' ? '</span>' : ''}</button>`;
}

// ── The tab ───────────────────────────────────────────────────────────────────────
function socCalHtml() { return '<div id="scalRoot" class="scal"></div>'; }
function socCalMount() { scalEnsure(); }

function scalPaint() {
  const root = document.getElementById('scalRoot'); if (!root) return;
  const cols = socCols(), per = scalPeriod(), posts = scalPosts(per), today = scalToday();
  const nOn = SCAL_NETS.filter(n => scal.on[n]).length, allOn = nOn === SCAL_NETS.length;
  const best = posts.length ? posts.reduce((a, b) => (b.likes || 0) > (a.likes || 0) ? b : a) : null;
  const { atMin, atMax } = scalEdges(per, today);
  const late = SCAL_NETS.filter(n => scal.on[n] && per.from.slice(0, 7) < SCAL_START[n]);
  const stale = !scalSync || !scalSync.last_ok_at;
  const synced = scalSync && scalSync.last_ok_at ? new Date(scalSync.last_ok_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;

  const chips = `<button type="button" class="scal-plat all" aria-pressed="${allOn}" onclick="scalPlat('all')">Show all</button>` +
    SCAL_NETS.map(n => `<button type="button" class="scal-plat" style="--c:${cols[n]};--bf:${scalBadgeFg(cols[n])}" aria-pressed="${!!scal.on[n]}" onclick="scalPlat('${n}')"><span class="scal-b" aria-hidden="true">${SCAL_CODE[n]}</span>${SOC_NETS[n]}</button>`).join('') +
    scalStoriesChip(cols) + `<span class="scal-plat off" title="YouTube is not on the calendar yet. Metricool gives us daily totals for it, not a list of videos."><span class="scal-b" aria-hidden="true">YT</span>YouTube <em>not yet</em></span>`;

  let answer;
  if (scal.busy && !posts.length) answer = 'Loading the posts…';
  else if (scal.err) answer = 'The posts did not load. Refresh to try again.';
  else if (!posts.length) answer = `No posts in <b>${mkEsc(per.label)}</b> with these platforms.`;
  else answer = `<b>${mkEsc(per.label)}</b>: <button type="button" class="scal-link" onclick="scalShowList()">${posts.length} post${posts.length === 1 ? '' : 's'}</button>. Best one: the ${SOC_NETS[best.net]} ${SCAL_KIND[best.kind]} on ${scalShort(best.date)}, ${scalFmt(best.likes)} likes.${scalStoryNote(per)}`;

  const hint = nOn === 1 ? 'Showing one platform. Tap another to add it.' : allOn ? 'Showing everything. Tap one platform to see just that one.' : `Showing ${nOn} platforms together, one colour each.`;
  const viewBtns = [['day', 'Daily'], ['week', 'Week'], ['month', 'Month'], ['list', 'List']].map(([k, l]) => `<button type="button" class="${scal.view === k ? 'on' : ''}" aria-pressed="${scal.view === k}" onclick="scalView('${k}')">${l}</button>`).join('');

  let body = '';
  if (scal.view === 'day') body = scalDayHtml(posts, cols, per, today);
  else if (scal.view === 'week') body = scalWeekHtml(posts, cols, per, today);
  else if (scal.view === 'month') body = scalMonthHtml(posts, cols, per, today);
  else body = scalListHtml(posts, cols, per);

  root.innerHTML = `
    <div class="scal-bar">
      <div class="scal-month">
        <button type="button" class="scal-icon" aria-label="Previous" onclick="scalNav(-1)" ${atMin ? 'disabled' : ''}>‹</button>
        <h3>${mkEsc(per.label)}</h3>
        <button type="button" class="scal-icon" aria-label="Next" onclick="scalNav(1)" ${atMax ? 'disabled' : ''}>›</button>
        <button type="button" class="sc-btn" onclick="scalToToday()">Today</button>
        <div class="sc-seg scal-seg" role="group" aria-label="View">${viewBtns}</div>
      </div>
      <div class="scal-plats" role="group" aria-label="Platforms">${chips}</div>
    </div>
    <p class="scal-hint">${hint}</p>
    <section class="scal-answer" aria-live="polite"><div>${answer}</div><div class="scal-actions">${best ? `<button type="button" class="sc-btn primary" data-id="${mkEsc(best.id)}" onclick="scalOpen(this.dataset.id)">See that post</button>` : ''}${posts.length ? `<button type="button" class="sc-btn" onclick="scalDownload('xlsx')">Download XLSX</button><button type="button" class="sc-btn" onclick="scalDownload('csv')">Download CSV</button>` : ''}</div></section>
    ${late.length ? `<p class="scal-note">${late.map(n => `${SOC_NETS[n]} has no posts on record before ${SCAL_MONTHS_NAMED[SCAL_START[n]] || SCAL_START[n]}`).join('. ')}.</p>` : ''}
    <div class="scal-layout${scal.sel || scal.sday ? ' open' : ''}">
      <div class="scal-cal">${body}</div>
      ${scal.sday ? scalStoryPanelHtml(cols) : scal.sel ? scalPanelHtml(scalFind(scal.sel), cols, posts) : ''}
    </div>
    <p class="slv-muted">Posts from Metricool, updated nightly${synced ? ', last ' + mkEsc(synced) : ''}${stale ? ' (no update recorded yet)' : ''}. The apps report a day or two late, so the last days can be thin. Instagram, Facebook and TikTok only for now; stories show when the Stories chip is on, as a picture and the time (${scal.statsOk ? 'their numbers show because you are signed in to the dashboard' : 'story numbers are private, so none are shown'}). Only the numbers anyone can see on a post are shown (likes, comments, shares, and plays on reels and videos).</p>`;
  if (scal.sel) { const c = root.querySelector('.scal-close'); if (c && scal.focusPanel) { c.focus(); scal.focusPanel = false; } }
}

// Week: hours down the side, a column a day. Posts in the same hour stack inside their cell, so nothing is squashed side by side.
function scalWeekHtml(posts, cols, per, today) {
  const best = scalBest(), days = Array.from({ length: 7 }, (_, i) => scalAdd(per.from, i));
  const known = posts.filter(p => p.t), unknown = posts.filter(p => !p.t);
  const hrs = known.map(p => p.t.h), h0 = Math.min(8, ...hrs), h1 = Math.max(22, ...hrs);
  const cell = {}; known.forEach(p => { (cell[p.date + '|' + p.t.h] = cell[p.date + '|' + p.t.h] || []).push(p); });
  let g = '<div class="scal-dh c0"></div>' + days.map(d => `<div class="scal-dh${d === today ? ' today' : ''}"><b>${mkD(d).toLocaleDateString('en-GB', { weekday: 'short' })}</b><span class="n">${mkD(d).getDate()}</span></div>`).join('');
  if (unknown.length) g += '<div class="scal-hl">Time not known</div>' + days.map(d => `<div class="scal-hc l0">${unknown.filter(p => p.date === d).map(p => scalTile(p, cols, 'tc')).join('')}</div>`).join('');
  if (scal.stories) g += scalStoryRow(days, cols);
  for (let h = h0; h <= h1; h++) {
    g += `<div class="scal-hl">${scalHour(h)}</div>` + days.map((d, i) => `<div class="scal-hc l${best ? best(i, h) : 0}">${(cell[d + '|' + h] || []).map(p => scalTile(p, cols, 'tc')).join('')}</div>`).join('');
  }
  // Phone: one block a day, no hour grid.
  const stacked = days.map(d => { const list = posts.filter(p => p.date === d);
    return `<div class="scal-wcol${d > today ? ' future' : ''}${d === today ? ' today' : ''}"><div class="scal-wh"><b>${mkD(d).toLocaleDateString('en-GB', { weekday: 'short' })}</b><span class="n">${mkD(d).getDate()}</span></div>${scalStoryPills(d, cols)}${list.length ? list.map(p => scalTile(p, cols, 'wc')).join('') : `<div class="scal-empty">${d > today ? 'Not yet' : 'No posts'}</div>`}</div>`; }).join('');
  const legend = best ? '<p class="scal-legend"><span>Blue behind the hours:</span><i class="a"></i><i class="b"></i><i class="c"></i><span>darker is a better time to post, from Metricool, last 30 days.</span></p>' : '';
  return `${legend}<div class="scal-tgrid">${g}</div><div class="scal-wstack">${stacked}</div>`;
}

// Daily (Kate, 13 Nov 2026): one day, hours down the side with the posts in their hour, the stories of the day above them (a picture, the time, and their numbers when they are sent in).
function scalDayHtml(posts, cols, per, today) {
  const d = per.from, best = scalBest(), dow = (mkD(d).getDay() + 6) % 7;
  const known = posts.filter(p => p.t), unknown = posts.filter(p => !p.t);
  const stories = scalStoriesOf(d).slice().sort((a, b) => (a.at || '') < (b.at || '') ? -1 : 1);
  const stHtml = scal.stories ? `<div class="scal-dstories"><div class="scal-sec">Stories${stories.length ? ', ' + stories.length : ''}</div>${stories.length ? scalStoryTotals(stories) + '<div class="scal-sgrid row">' + stories.map(s => scalStoryCard(s, cols)).join('') + '</div>' : '<div class="scal-empty">No stories this day.</div>'}${scalStoryCaption()}</div>` : '';
  if (!posts.length) return stHtml + `<div class="scal-empty" style="padding:20px 4px">${d > today ? 'Not yet.' : 'No posts this day with these platforms.'}</div>`;
  const hrs = known.map(p => p.t.h), h0 = Math.min(8, ...hrs), h1 = Math.max(22, ...hrs);
  const cell = {}; known.forEach(p => { (cell[p.t.h] = cell[p.t.h] || []).push(p); });
  let g = '';
  if (unknown.length) g += '<div class="scal-hl">Time not known</div><div class="scal-hc l0">' + unknown.map(p => scalTile(p, cols, 'tc')).join('') + '</div>';
  for (let h = h0; h <= h1; h++) g += `<div class="scal-hl">${scalHour(h)}</div><div class="scal-hc l${best ? best(dow, h) : 0}">${(cell[h] || []).map(p => scalTile(p, cols, 'tc')).join('')}</div>`;
  const stacked = `<div class="scal-wcol${d === today ? ' today' : ''}">${posts.map(p => scalTile(p, cols, 'wc')).join('')}</div>`;
  return `${stHtml}<div class="scal-tgrid day">${g}</div><div class="scal-wstack">${stacked}</div>`;
}

// Month: a pill a post for two or more platforms, a picture a post for one. On a phone, dots and the chosen day's list underneath.
function scalMonthHtml(posts, cols, per, today) {
  const first = mkD(per.from), lead = (first.getDay() + 6) % 7, nd = mkD(per.to).getDate(), total = Math.ceil((lead + nd) / 7) * 7;
  const solo = SCAL_NETS.filter(n => scal.on[n]).length === 1, by = {};
  posts.forEach(p => { (by[p.date] = by[p.date] || []).push(p); });
  const pill = p => { const cur = scal.sel === p.id ? ' aria-current="true"' : '';
    return solo
      ? `<button type="button" class="scal-tile" data-id="${mkEsc(p.id)}" style="${scalStyle(p, cols)}" aria-label="${mkEsc(scalLabel(p))}"${cur} onclick="scalOpen(this.dataset.id)"><span class="scal-th">${scalImg(p)}${scalIsVideo(p) ? SCAL_PLAY : ''}</span><span class="tm">${scalClock(p.t, true)}</span></button>`
      : `<button type="button" class="scal-pill" data-id="${mkEsc(p.id)}" style="${scalStyle(p, cols)}" aria-label="${mkEsc(scalLabel(p))}"${cur} onclick="scalOpen(this.dataset.id)"><span class="scal-bb" aria-hidden="true">${SCAL_CODE[p.net]}</span><span class="t">${scalClock(p.t, true)}</span>${scalIsVideo(p) ? `<span class="k" title="${SCAL_KIND[p.kind]}" aria-hidden="true">▶</span>` : ''}<span class="c">${scalCap(p)}</span></button>`; };
  let cells = '';
  for (let i = 0; i < total; i++) {
    const day = i - lead + 1, inM = day >= 1 && day <= nd, iso = inM ? per.from.slice(0, 8) + String(day).padStart(2, '0') : '';
    const list = inM ? (by[iso] || []) : [], max = solo ? 4 : 3, open = scal.open === iso, shown = open ? list : list.slice(0, max);
    cells += `<div class="scal-cell${inM ? '' : ' out'}${inM && iso > today ? ' future' : ''}${iso === today ? ' today' : ''}${iso && scal.day === iso ? ' sel' : ''}" ${iso ? `data-day="${iso}" onclick="scalDay('${iso}')"` : ''}>
      <div class="scal-dn">${inM ? day : ''}</div>
      ${solo ? `<div class="scal-tiles">${shown.map(pill).join('')}</div>` : shown.map(pill).join('')}
      ${iso ? scalStoryPills(iso, cols) : ''}
      ${!open && list.length > max ? `<button type="button" class="scal-more" onclick="event.stopPropagation();scalMore('${iso}')">+${list.length - max} more</button>` : ''}
      <div class="scal-dots">${list.map(p => `<span class="dot" style="--c:${cols[p.net]}"></span>`).join('')}</div></div>`;
  }
  const dayList = scal.day && scal.day.slice(0, 7) === per.from.slice(0, 7) ? (by[scal.day] || []) : null;
  return `<div class="scal-dow">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div>${d}</div>`).join('')}</div><div class="scal-grid">${cells}</div>
    <div class="scal-agenda">${scal.day ? `<h4>${scalLong(scal.day)}</h4>${scalStoryPills(scal.day, cols)}${dayList && dayList.length ? dayList.map(p => scalTile(p, cols, 'wc')).join('') : '<div class="scal-empty">No posts this day.</div>'}` : '<div class="scal-empty">Tap a day to see its posts.</div>'}</div>`;
}

// List: the same posts as rows, to search and sort. Numbers read across.
function scalListRowsHtml(posts, cols) {
  const q = scal.q.toLowerCase().trim();
  let l = posts.filter(p => !q || p.cap.toLowerCase().includes(q));
  const f = scal.sort === 'likes' ? (a, b) => (b.likes || 0) - (a.likes || 0) : scal.sort === 'views' ? (a, b) => (b.views || 0) - (a.views || 0) : (a, b) => (b.at || b.date) < (a.at || a.date) ? -1 : 1;
  l = l.slice().sort(f);
  return `<div class="scal-lcount">${l.length} post${l.length === 1 ? '' : 's'}${q ? ` match “${mkEsc(scal.q.trim())}”` : ''}</div>` + (l.length ? l.map(p => {
    const cur = scal.sel === p.id ? ' aria-current="true"' : '';
    return `<button type="button" class="scal-lrow" data-id="${mkEsc(p.id)}" style="${scalStyle(p, cols)}" aria-label="${mkEsc(scalLabel(p))}"${cur} onclick="scalOpen(this.dataset.id)">
      <span class="d"><b>${scalShort(p.date)}</b><span>${scalClock(p.t) || 'Time not known'}</span></span>
      <span class="pc"><span class="scal-th">${scalImg(p)}${scalIsVideo(p) ? SCAL_PLAY : ''}</span><span class="tx"><span class="cp">${scalCap(p)}</span><span class="mini">${SOC_NETS[p.net]} · ${scalFmt(p.likes)} likes · ${scalFmt(p.comments)} comments</span></span></span>
      <span class="pl"><span class="scal-bb" aria-hidden="true">${SCAL_CODE[p.net]}</span>${SOC_NETS[p.net]} · ${SCAL_KIND[p.kind]}</span>
      <span class="n">${scalFmt(p.likes)}</span><span class="n">${scalFmt(p.reposts)}</span><span class="n">${scalFmt(p.comments)}</span><span class="n">${scalFmt(p.views)}</span></button>`;
  }).join('') : '<div class="scal-empty" style="padding:16px 4px">No posts match.</div>');
}
function scalListHtml(posts, cols, per) {
  return `<div class="scal-list">
    <div class="scal-ltool">
      <input type="search" id="scalQ" placeholder="Search captions" aria-label="Search captions" value="${mkEsc(scal.q)}" oninput="scalSearch(this.value)">
      <select id="scalSort" aria-label="Sort by" onchange="scalSortBy(this.value)">${[['new', 'Newest first'], ['likes', 'Most likes'], ['views', 'Most views']].map(([k, l]) => `<option value="${k}"${scal.sort === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
      ${scal.view === 'list' && scal.scope !== 'month' ? `<button type="button" class="sc-btn" onclick="scalWholeMonth()">Show the whole month</button>` : ''}
    </div>
    <div class="scal-lh"><span>Date</span><span>Post</span><span>Platform</span><span class="r">Likes</span><span class="r">Reposts</span><span class="r">Comments</span><span class="r">Views or impressions</span></div>
    <div id="scalRows">${scalListRowsHtml(posts, cols)}</div></div>`;
}

// The panel: one post. Verdict first, then the picture and the numbers it has.
function scalPanelHtml(p, cols, posts) {
  if (!p) return '';
  const mates = posts.filter(x => x.net === p.net && x.likes !== null), avg = mates.length >= 3 ? mates.reduce((a, x) => a + x.likes, 0) / mates.length : 0;
  let verdict = '';
  if (avg && p.likes !== null) { const r = p.likes / avg;
    verdict = r >= 1.5 ? `<div class="scal-verdict up">Did well: ${(Math.round(r * 10) / 10)} times the usual likes for ${SOC_NETS[p.net]} in this period.</div>`
      : r >= .8 ? `<div class="scal-verdict">About the usual likes for ${SOC_NETS[p.net]} in this period.</div>`
      : `<div class="scal-verdict down">Quieter than usual for ${SOC_NETS[p.net]} in this period.</div>`; }
  const nums = [['Likes', p.likes], ['Comments', p.comments], [p.repostLabel, p.reposts], ['Plays', p.views]].filter(([, v]) => v !== null);
  const verb = p.net === 'instagram' ? 'Instagram' : p.net === 'facebook' ? 'Facebook' : 'TikTok';
  return `<aside class="scal-panel" role="dialog" aria-label="Post details" style="${scalStyle(p, cols)}">
    <div class="scal-ph"><span class="scal-b" aria-hidden="true">${SCAL_CODE[p.net]}</span>
      <div class="when"><b>${scalLong(p.date)}${p.t ? ', ' + scalClock(p.t) : ''}</b><span>${SOC_NETS[p.net]} ${SCAL_KIND[p.kind]}</span></div>
      <button type="button" class="scal-icon scal-close" aria-label="Close" onclick="scalClose()">×</button></div>
    <div class="scal-pb">
      ${verdict}
      <div class="scal-pic" ${p.img ? '' : 'style="min-height:160px"'}>${scalImg(p, true)}${(scalIsVideo(p) || scalEmbedUrl(p)) ? `<button type="button" class="scal-vid" data-id="${mkEsc(p.id)}" onclick="scalPlay(this.dataset.id)" aria-label="${scalIsVideo(p) ? 'Play' : 'Show'} this ${SCAL_KIND[p.kind]} here">${SCAL_PLAY}</button>` : ''}</div>
      ${calSafeUrl(p.url) ? `<a class="sc-btn scal-open" href="${mkEsc(calSafeUrl(p.url))}" target="_blank" rel="noopener noreferrer">${scalIsVideo(p) ? 'Watch' : 'Open'} on ${verb}</a>` : ''}
      <p class="scal-pcap">${scalCap(p)}</p>
      <div><div class="scal-sec">How it did</div><div class="scal-nums">${nums.map(([l, v]) => `<div class="scal-num"><div class="v">${scalFmt(v)}</div><div class="l">${l}</div></div>`).join('')}</div></div>
      ${scalTryHtml(p)}
    </div></aside><div class="scal-scrim" onclick="scalClose()"></div>`;
}

// ── Doing things ──────────────────────────────────────────────────────────────────
function scalOpen(id) { scal.sday = null; scal.sel = id; scal.focusPanel = true; scalPaint(); }
function scalClose() { scal.sel = null; scal.sday = null; scalPaint(); }
function scalPlat(n) {
  const allOn = SCAL_NETS.every(x => scal.on[x]);
  if (n === 'all') SCAL_NETS.forEach(x => { scal.on[x] = true; });
  else if (allOn) SCAL_NETS.forEach(x => { scal.on[x] = x === n; });
  else { const cnt = SCAL_NETS.filter(x => scal.on[x]).length; if (scal.on[n] && cnt === 1) return; scal.on[n] = !scal.on[n]; }
  scal.sel = null; scalSave(); scalPaint();
}
function scalView(v) {
  if (v === scal.view) return;
  const from = scal.view, per0 = scalPeriod(), t0 = scalToday();
  // The day a Daily view opens on: today when it is in the stretch on show, else the first day of it.
  const anchor = per0.kind === 'day' ? scal.dd : (per0.from <= t0 && t0 <= per0.to ? t0 : per0.from);
  if (v === 'day') scal.dd = anchor;
  else if (v === 'week') scal.ws = from === 'day' ? scalMon(scal.dd) : (scal.month === scalToday().slice(0, 7) ? scalMon(scalToday()) : scalMon(scal.month + '-01'));
  else if (from === 'week') scal.month = scalAdd(scal.ws, 3).slice(0, 7);
  else if (from === 'day') scal.month = scal.dd.slice(0, 7);
  scal.scope = 'month'; scal.view = v; scal.sel = null; scal.sday = null; scal.day = null; scal.open = null; scalSave(); scalEnsure();
}
function scalNav(d) {
  const k = scalPeriod().kind;
  if (k === 'day') { scal.dd = scalAdd(scal.dd, d); scal.ws = scalMon(scal.dd); scal.month = scal.dd.slice(0, 7); }
  else if (k === 'week') scal.ws = scalAdd(scal.ws, 7 * d); else scal.month = scalShiftMonth(scal.month, d);
  scal.sel = null; scal.sday = null; scal.day = null; scal.open = null; scalEnsure();
}
function scalToToday() { const t = scalToday(); scal.ws = scalMon(t); scal.month = t.slice(0, 7); scal.dd = t; scal.sel = null; scal.sday = null; scal.day = null; scal.open = null; scalEnsure(); }
// The post count opens the posts behind it, for the same stretch of time.
function scalShowList() { scal.scope = scalPeriod().kind; scal.view = 'list'; scal.sel = null; scalSave(); scalEnsure(); }
function scalWholeMonth() { const per = scalPeriod(); scal.month = per.from.slice(0, 7); scal.scope = 'month'; scalEnsure(); }
function scalDay(iso) { scal.day = iso; scalPaint(); }
function scalMore(iso) { scal.open = iso; scalPaint(); }
function scalSearch(v) {
  scal.q = v; const per = scalPeriod(), el = document.getElementById('scalRows');
  if (el) el.innerHTML = scalListRowsHtml(scalPosts(per), socCols());
}
function scalSortBy(v) { scal.sort = v; scalPaint(); }

// The page redraws for a theme change through socRepaint; the colours are read at draw time, so nothing else is needed here.
document.addEventListener('keydown', e => { if (e.key === 'Escape' && (scal.sel || scal.sday) && document.getElementById('scalRoot')) scalClose(); });


// ──────────────────────────────────────────────────────────────────────────────────────
// Stories (Kate, 12 Nov 2026). Off by default: a Stories chip turns them on. Instagram and Facebook post 4 to 17 a day, so the calendar shows a summary a day (a pill per
// network with the count) and a click opens that day's pictures in the panel. content_calendar_stories() sends only the network, the time and the picture: story numbers
// (views, reach, replies, taps) are private and this page has no login, and a story's own link dies after 24 hours.
// ──────────────────────────────────────────────────────────────────────────────────────
const scalStoryCache = {};       // 'YYYY-MM' -> [{ net, date, at, t, img }]
async function scalLoadStories(key) {
  if (scalStoryCache[key]) return;
  const { data, error } = await sb.rpc('content_calendar_stories', { p_from: key + '-01', p_to: scalMonthEnd(key) });
  if (error) throw error;
  scalStoryCache[key] = (data || []).map(s => ({ net: s.network, date: String(s.post_date).slice(0, 10), at: s.posted_at, t: scalTimeParts(s.posted_at), img: s.image_url || '' }));
}
async function scalEnsureStories() {
  if (!scal.stories) return;
  const need = scalPeriod().months.filter(k => !scalStoryCache[k]);
  if (!need.length) { scalAskStats(); return; }
  if (!need.length) return;
  try { await Promise.all(need.map(scalLoadStories)); scal.serr = false; } catch (e) { console.error(e); scal.serr = true; }
  scalAskStats();
  scalPaint();
}
// The posts first (as before), then the stories when the chip is on.
async function scalEnsure() { await scalEnsurePosts(); await scalEnsureStories(); }

const scalStoriesOf = (date, net) => scal.stories ? (scalStoryCache[date.slice(0, 7)] || []).filter(s => s.date === date && scal.on[s.net] && (!net || s.net === net)) : [];
function scalStoriesChip(cols) {
  return `<button type="button" class="scal-plat" style="--c:#B7791F;--bf:#FFFFFF" aria-pressed="${!!scal.stories}" onclick="scalToggleStories()" title="Stories: a picture and the time, no numbers"><span class="scal-b" aria-hidden="true">ST</span>Stories</button>`;
}
function scalToggleStories() { scal.stories = !scal.stories; scal.sday = null; scalSave(); if (scal.stories) { scalPaint(); scalEnsureStories(); } else scalPaint(); }
function scalStoryPills(date, cols) {
  if (!scal.stories) return '';
  return ['instagram', 'facebook'].map(n => {
    const k = scalStoriesOf(date, n).length; if (!k) return '';
    return `<button type="button" class="scal-spill" style="--c:${cols[n]};--bf:${scalBadgeFg(cols[n])}" onclick="event.stopPropagation();scalStoryOpen('${date}','${n}')" aria-label="${SOC_NETS[n]} stories on ${scalLong(date)}, ${k}"><span class="scal-bb" aria-hidden="true">${SCAL_CODE[n]}</span>${k} ${k === 1 ? 'story' : 'stories'}</button>`;
  }).join('');
}
function scalStoryRow(days, cols) {
  return '<div class="scal-hl">Stories</div>' + days.map(d => `<div class="scal-hc l0">${scalStoryPills(d, cols)}</div>`).join('');
}
function scalStoryNote(per) {
  if (!scal.stories) return '';
  if (scal.serr) return ' The stories did not load.';
  const all = [];
  per.months.forEach(k => (scalStoryCache[k] || []).forEach(s => { if (s.date >= per.from && s.date <= per.to && scal.on[s.net]) all.push(s); }));
  const ig = all.filter(s => s.net === 'instagram').length, fb = all.filter(s => s.net === 'facebook').length;
  const parts = [];
  if (ig) parts.push(ig + ' on Instagram');
  if (fb) parts.push(fb + ' on Facebook');
  return all.length ? ' Stories: ' + parts.join(', ') + '.' : ' No stories in this stretch.';
}
// Story numbers (Kate, 13 Nov 2026). The public call sends no numbers, so none come from this page's own database call. When this page is held in the dashboard,
// the dashboard (signed in, Level 3 and up) answers a trs-cal-need-stats request with trs-cal-stories, and only the page that holds this frame is listened to.
const SCAL_SFIELDS = [['views', 'Views'], ['reach', 'Reach'], ['replies', 'Replies'], ['reactions', 'Reactions'], ['taps_forward', 'Taps forward'], ['taps_back', 'Taps back'], ['exits', 'Exits']];
const scalStatOf = s => scal.sstats[s.net + '|' + s.at] || null;
function scalAskStats() {
  if (!calEmbedded || !scal.stories || !scal.ws) return;
  const per = scalPeriod(), key = per.from + '|' + per.to;
  if (scal.sasked[key]) return;
  scal.sasked[key] = true;
  try { window.parent.postMessage({ type: 'trs-cal-need-stats', from: per.from, to: per.to }, '*'); } catch (e) {}
}
function scalGotStats(d) {
  if (!d || !Array.isArray(d.rows) || d.rows.length > 5000) return;
  d.rows.forEach(r => {
    if (!r || !SCAL_NETS.includes(r.network) || typeof r.posted_at !== 'string') return;
    const o = { url: calSafeUrl(r.url) };
    SCAL_SFIELDS.forEach(([k]) => { o[k] = scalN(r[k]); });
    scal.sstats[r.network + '|' + r.posted_at] = o;
  });
  if (d.rows.length) scal.statsOk = true;
  scalPaint();
}
function scalStatLines(st) {
  const items = SCAL_SFIELDS.filter(([k]) => st[k] !== null && st[k] !== undefined).map(([k, l]) => `<div><dt>${l}</dt><dd>${scalFmt(st[k])}</dd></div>`).join('');
  return items ? `<dl class="scal-sstats">${items}</dl>` : '';
}
function scalStoryCard(s, cols) {
  const st = scalStatOf(s), c = cols[s.net];
  return `<figure class="scal-story" style="--c:${c};--bf:${scalBadgeFg(c)}"><div class="scal-sth">${s.img ? `<img src="${mkEsc(s.img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</div>
    <figcaption><b><span class="scal-bb" aria-hidden="true">${SCAL_CODE[s.net]}</span>${mkEsc(scalClock(s.t) || '')}</b>${st ? scalStatLines(st) : (scal.statsOk ? '<span class="scal-snone">No numbers kept for this story</span>' : '')}${st && st.url ? `<a class="scal-slink" href="${mkEsc(st.url)}" target="_blank" rel="noopener noreferrer" title="Works for 24 hours after it was posted">Open on ${SOC_NETS[s.net]}</a>` : ''}</figcaption></figure>`;
}
function scalStoryTotals(list) {
  const tot = {}, got = list.map(scalStatOf).filter(Boolean);
  if (!got.length) return '';
  SCAL_SFIELDS.forEach(([k]) => { const v = got.map(x => x[k]).filter(x => x !== null && x !== undefined); if (v.length) tot[k] = v.reduce((a, b) => a + b, 0); });
  return `<div class="scal-stot"><span>All ${list.length} stories</span>${scalStatLines(tot)}</div>`;
}
function scalStoryCaption() {
  return scal.statsOk
    ? '<p class="scal-pcap">Story numbers come from Metricool and show here because you are signed in to the dashboard. Instagram and Facebook do not offer a player for stories, so a story shows as its picture; the link opens it while it is still live, for 24 hours.</p>'
    : '<p class="scal-pcap">Pictures and times only. Story numbers (views, reach, replies, taps) are private, so they are not shown on this page.</p>';
}
function scalStoryOpen(date, net) { scal.sel = null; scal.sday = { date, net }; scal.focusPanel = true; scalPaint(); }
function scalStoryPanelHtml(cols) {
  const { date, net } = scal.sday, list = scalStoriesOf(date, net).slice().sort((a, b) => (a.at || '') < (b.at || '') ? -1 : 1);
  const tiles = list.map(s => scalStoryCard(s, cols)).join('');
  return `<aside class="scal-panel" role="dialog" aria-label="Stories" style="--c:${cols[net]};--bf:${scalBadgeFg(cols[net])}">
    <div class="scal-ph"><span class="scal-b" aria-hidden="true">${SCAL_CODE[net]}</span>
      <div class="when"><b>${scalLong(date)}</b><span>${SOC_NETS[net]} stories, ${list.length}</span></div>
      <button type="button" class="scal-icon scal-close" aria-label="Close" onclick="scalClose()">×</button></div>
    <div class="scal-pb">${list.length ? scalStoryTotals(list) + `<div class="scal-sgrid${scal.statsOk ? ' row' : ''}">${tiles}</div>` : '<div class="scal-empty">No stories this day.</div>'}
      ${scalStoryCaption()}</div></aside><div class="scal-scrim" onclick="scalClose()"></div>`;
}

// ──────────────────────────────────────────────────────────────────────────────────────
// Reflect and try: one action, one owner, one date (the plan)
// ──────────────────────────────────────────────────────────────────────────────────────
let calPlan = [], calPlanErr = false, calSaving = false;
const calNextMonday = () => scalAdd(scalMon(scalToday()), 7);

function scalTryHtml(p) {
  if (!CAL_PLAN_ON) return '';
  return `<div class="scal-try"><div><label for="scalNotice">What did you notice?</label><input id="scalNotice" type="text" maxlength="500" placeholder="One line is plenty"></div>
    <div class="scal-sec" style="margin:0">Try it again</div>
    <div class="row"><div><label for="scalOwner">Who posts it</label><input id="scalOwner" type="text" maxlength="80" placeholder="Name"></div>
    <div><label for="scalWhen">By when</label><input id="scalWhen" type="date" value="${calNextMonday()}"></div></div>
    <button class="sc-btn primary" id="scalAddBtn" type="button" onclick="scalAddPlan()">Add to next month's plan</button></div>`;
}

function calToast(msg) {
  const t = document.getElementById('toast'); if (!t) return;
  t.textContent = msg; t.hidden = false; clearTimeout(calToast.t); calToast.t = setTimeout(() => { t.hidden = true; }, 3400);
}

async function scalAddPlan() {
  if (calSaving) return;
  const p = scalFind(scal.sel); if (!p) return;
  const notice = document.getElementById('scalNotice').value.trim(), owner = document.getElementById('scalOwner').value.trim(), when = document.getElementById('scalWhen').value;
  if (!owner) { calToast('Add who posts it first.'); document.getElementById('scalOwner').focus(); return; }
  if (!when) { calToast('Add a date first.'); document.getElementById('scalWhen').focus(); return; }
  calSaving = true; const btn = document.getElementById('scalAddBtn'); if (btn) btn.disabled = true;
  const { error } = await sb.rpc('content_plan_add', { p_owner: owner, p_due: when, p_notice: notice || null, p_network: p.net, p_post_date: p.date || null, p_post_url: calSafeUrl(p.url) || null, p_caption: p.cap.slice(0, 300) || null });
  calSaving = false; if (btn) btn.disabled = false;
  if (error) { console.error(error); calToast('That did not save: ' + (error.message || 'try again') + '.'); return; }
  calToast(`Added. ${owner} posts a new take by ${scalShort(when)}.`);
  document.getElementById('scalNotice').value = ''; document.getElementById('scalOwner').value = '';
  await calPlanLoad();
  const pl = document.getElementById('planSection'); if (pl) pl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

async function calPlanLoad() {
  const { data, error } = await sb.rpc('content_plan_list');
  if (error) { console.error(error); calPlanErr = true; } else { calPlan = data || []; calPlanErr = false; }
  calPlanPaint();
}
function calPlanPaint() {
  const ul = document.getElementById('planList'), em = document.getElementById('planEmpty'); if (!ul) return;
  ul.innerHTML = calPlan.map(x => `<li class="${x.done ? 'done' : ''}"><span><b>${mkEsc(x.owner_name)}</b> posts a new take on “${mkEsc((x.post_caption || 'a post').slice(0, 90))}”${x.post_network ? ' (' + mkEsc(SOC_NETS[x.post_network] || x.post_network) + ')' : ''} by ${mkEsc(scalShort(x.due))}.${x.notice ? ' Noticed: ' + mkEsc(x.notice) : ''}</span>
    <span class="acts"><button type="button" data-done="${mkEsc(x.id)}" data-to="${x.done ? '0' : '1'}">${x.done ? 'Not done' : 'Done'}</button><button type="button" data-rm="${mkEsc(x.id)}">Remove</button></span></li>`).join('');
  em.hidden = calPlan.length > 0 || calPlanErr;
  em.textContent = calPlanErr ? '' : 'Nothing added yet.';
  document.getElementById('planErr').hidden = !calPlanErr;
}
document.addEventListener('click', async e => {
  const d = e.target.closest('[data-done]'), r = e.target.closest('[data-rm]');
  if (d) { const { error } = await sb.rpc('content_plan_done', { p_id: d.dataset.done, p_done: d.dataset.to === '1' }); if (error) calToast('That did not save.'); await calPlanLoad(); }
  else if (r) { if (!confirm('Remove this from the plan?')) return; const { error } = await sb.rpc('content_plan_remove', { p_id: r.dataset.rm }); if (error) calToast('That did not remove.'); await calPlanLoad(); }
});

// ──────────────────────────────────────────────────────────────────────────────────────
// Download the posts on screen: CSV, or XLSX (SheetJS, loaded only when asked)
// ──────────────────────────────────────────────────────────────────────────────────────
function scalTable() {
  const per = scalPeriod(), posts = scalPosts(per).slice().sort((a, b) => (a.at || a.date) < (b.at || b.date) ? -1 : 1);
  if (!posts.length) return null;
  const head = ['Date', 'Time (Dubai)', 'Platform', 'Type', 'Caption', 'Likes', 'Comments', 'Reposts or shares', 'Plays (reels and videos)', 'Link'];
  const rows = posts.map(p => [p.date, scalClock(p.t) || '', SOC_NETS[p.net], SCAL_KIND[p.kind], p.cap.replace(/\s+/g, ' ').slice(0, 300), p.likes, p.comments, p.reposts, p.views, calSafeUrl(p.url)]);
  return { name: ['social-posts', per.from, 'to', per.to].join('-'), head, rows };
}
// A cell that starts with = + - or @ would run as a formula in a spreadsheet; a leading apostrophe keeps it as text.
const calCell = v => { if (v === null || v === undefined) return ''; const s = String(v); return /^[=+\-@\t\r]/.test(s) && isNaN(Number(s)) ? "'" + s : s; };
function calSave(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
async function scalDownload(kind) {
  const t = scalTable(); if (!t) { calToast('No posts to download for this stretch.'); return; }
  if (kind === 'csv') {
    const q = v => '"' + calCell(v).replace(/"/g, '""') + '"';
    calSave(new Blob(['﻿' + [t.head, ...t.rows].map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), t.name + '.csv'); return;
  }
  try {
    if (!window.XLSX) await new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
    const ws = XLSX.utils.aoa_to_sheet([t.head, ...t.rows.map(r => r.map(calCell))]); ws['!cols'] = t.head.map((h, i) => ({ wch: i === 4 ? 60 : i === 9 ? 40 : 16 }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Posts'); XLSX.writeFile(wb, t.name + '.xlsx');
  } catch (e) { console.error(e); calToast('The XLSX file did not build. CSV still works.'); }
}

// ──────────────────────────────────────────────────────────────────────────────────────
// Start-up and theme
// ──────────────────────────────────────────────────────────────────────────────────────
// Embedded (Kate, 12 Nov 2026): tell the dashboard where the calendar is (the stretch on show, the view, whether Previous or Next can go further) after every draw,
// so its masthead bar can show it. The dashboard's buttons send trs-cal-cmd back (head.js). Only a label and a few flags go out, so the target is any parent.
function scalPostState() {
  if (!calEmbedded || !scal.ws) return;
  const per = scalPeriod(), today = scalToday();
  const { atMin, atMax } = scalEdges(per, today);
  try { window.parent.postMessage({ type: 'trs-cal-state', label: per.label, view: scal.view, atMin, atMax }, '*'); } catch (e) {}
}
const scalPaintInner = scalPaint;
scalPaint = function () { scalPaintInner(); scalPostState(); };

const calEl = id => document.getElementById(id);
calEl('theme').addEventListener('click', () => {
  const next = calDark() ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('trs-approvals-theme', next); } catch (e) {}
  calEl('theme').textContent = next === 'dark' ? 'Light mode' : 'Dark mode';
  scalPaint();
});
if (!calEmbedded) { try { const th = localStorage.getItem('trs-approvals-theme'); if (th === 'light' || th === 'dark') document.documentElement.setAttribute('data-theme', th); } catch (e) {} }
calEl('theme').textContent = calDark() ? 'Light mode' : 'Dark mode';

calEl('scalRoot').innerHTML = '<p class="slv-muted">Loading the posts…</p>';
scalEnsure();
if (CAL_PLAN_ON) calPlanLoad(); else { const ps = calEl('planSection'); if (ps) ps.hidden = true; }

// Some pictures arrive small (Facebook gives about 130 pixels wide). Stretched to the panel's width they turn to mush, so they show at about their own size, with a note.
function scalFit(img) {
  const w = img.naturalWidth, box = img.parentElement; if (!box || !w || w >= 300) return;
  box.style.maxWidth = Math.round(Math.max(w * 1.6, 160)) + 'px';
  if (!box.nextElementSibling || !box.nextElementSibling.classList.contains('scal-small')) {
    const n = document.createElement('p'); n.className = 'scal-small'; n.textContent = 'This is the small preview the app gives us. Open the post to see it in full.';
    box.insertAdjacentElement('afterend', n);
  }
}

// Play it here (Kate, 12 Nov 2026): the picture's play sign loads the platform's own player, from the post's link, only when it is pressed (nothing from Instagram,
// Facebook or TikTok loads before that). A post with no link the player understands opens on its own app instead.
function scalEmbedUrl(p) {
  const u = calSafeUrl(p.url); if (!u) return null;
  try {
    const x = new URL(u), host = x.hostname.replace(/^www\./, '');
    if (p.net === 'instagram' && host === 'instagram.com') { const m = x.pathname.match(/^\/(reel|p|tv)\/([A-Za-z0-9_-]+)/); return m ? { src: 'https://www.instagram.com/' + m[1] + '/' + m[2] + '/embed/', h: 600 } : null; }
    if (p.net === 'facebook' && host === 'facebook.com') return scalIsVideo(p) ? { src: 'https://www.facebook.com/plugins/video.php?show_text=false&width=380&href=' + encodeURIComponent(u), h: 520 } : { src: 'https://www.facebook.com/plugins/post.php?show_text=true&width=380&href=' + encodeURIComponent(u), h: 560 };
    if (p.net === 'tiktok' && host === 'tiktok.com') { const m = x.pathname.match(/\/video\/(\d+)/); return m ? { src: 'https://www.tiktok.com/embed/v2/' + m[1], h: 620 } : null; }
  } catch (e) {}
  return null;
}
function scalPlay(id) {
  const p = scalFind(id); if (!p) return;
  const e = scalEmbedUrl(p), pic = document.querySelector('.scal-pic');
  if (!e || !pic) { if (calSafeUrl(p.url)) window.open(calSafeUrl(p.url), '_blank', 'noopener'); return; }
  const f = document.createElement('iframe');
  f.src = e.src; f.title = 'Play this ' + SCAL_KIND[p.kind]; f.className = 'scal-player'; f.style.height = e.h + 'px';
  f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'; f.allowFullscreen = true; f.referrerPolicy = 'strict-origin-when-cross-origin';
  pic.replaceWith(f);
}
