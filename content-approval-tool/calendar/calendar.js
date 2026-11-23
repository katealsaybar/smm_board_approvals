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
    } else if (e.data.type === 'trs-cal-post-stats' && typeof scal !== 'undefined') {
      scalGotPostStats(e.data);
    } else if (e.data.type === 'trs-cal-attached' && typeof scal !== 'undefined') {
      scalGotAttached(e.data);
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
// The platform badge shows the app's own mark (Kate, 23 Nov 2026), not two letters. Each is drawn in the badge's text colour (--bf) on the platform colour (--c),
// so it follows the light and dark themes. Letters stay as the accessible name.
const SCAL_ICO = {
  instagram: '<path fill="none" stroke="currentColor" stroke-width="2.2" d="M8.2 3h7.6A5.2 5.2 0 0 1 21 8.2v7.6a5.2 5.2 0 0 1-5.2 5.2H8.2A5.2 5.2 0 0 1 3 15.8V8.2A5.2 5.2 0 0 1 8.2 3z"/><circle cx="12" cy="12" r="4.1" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="17.4" cy="6.6" r="1.35" fill="currentColor"/>',
  facebook: '<path fill="currentColor" d="M13.5 21.5v-8.3h2.8l.5-3.3h-3.3V7.8c0-.9.4-1.7 1.8-1.7h1.6V3.3c-.3 0-1.3-.2-2.5-.2-2.5 0-4.2 1.5-4.2 4.3v2.5H7.4v3.3h2.8v8.3h3.3z"/>',
  tiktok: '<path fill="currentColor" d="M12.5.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/>',
  youtube: '<path fill="currentColor" d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1c.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8zM9.6 15.6V8.4l6.2 3.6-6.2 3.6z"/>'
};
const scalIco = n => SCAL_ICO[n] ? `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${SCAL_ICO[n]}</svg>` : (SCAL_CODE[n] || '');
// The first month Metricool holds posts for, a platform at a time (see project notes: FB Jan 2025, IG Aug 2025, TikTok Jun 2026).
const SCAL_START = { instagram: '2025-08', facebook: '2025-01', tiktok: '2026-06' };
const SCAL_FIRST = '2025-01';
const SCAL_KIND = { reel: 'reel', post: 'post', video: 'video', photo: 'photo post', carousel: 'carousel' };
const SCAL_VIEWS = ['day', 'week', 'month', 'list'];
const SCAL_MONTHS_NAMED = { '2025-01': 'January 2025', '2025-08': 'August 2025', '2026-06': 'June 2026' };

const scal = { view: 'week', src: 'all', kinds: { post: true, carousel: true, reel: true }, fopen: false, ws: null, dd: null, sstats: {}, statsOk: false, sasked: {}, pstats: {}, pasked: {}, month: null, scope: 'month', on: { instagram: true, facebook: true, tiktok: true }, sel: null, stories: false, sday: null, q: '', sort: 'new', open: null, busy: false, err: false };
const scalCache = {};            // 'YYYY-MM' -> [post]
let scalSnaps = null, scalSync = null;
try {
  const s = JSON.parse(localStorage.getItem('trs-approvals-scal') || '{}');
  if (SCAL_VIEWS.includes(s.view)) scal.view = s.view;
  scal.stories = s.stories === true;
  if (['all', 'manual', 'metricool'].includes(s.src)) scal.src = s.src;
  if (s.kinds) ['post', 'carousel', 'reel'].forEach(k => { if (typeof s.kinds[k] === 'boolean') scal.kinds[k] = s.kinds[k]; });
  if (s.on) SCAL_NETS.forEach(n => { if (typeof s.on[n] === 'boolean') scal.on[n] = s.on[n]; });
  if (!SCAL_NETS.some(n => scal.on[n])) SCAL_NETS.forEach(n => { scal.on[n] = true; });
} catch (e) {}
const scalSave = () => { try { localStorage.setItem('trs-approvals-scal', JSON.stringify({ view: scal.view, on: scal.on, stories: scal.stories, src: scal.src, kinds: scal.kinds })); } catch (e) {} };

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
  const net = p.network, kind = p.carousel === true ? 'carousel' : (SCAL_KIND[p.kind] ? p.kind : 'post');
  const reposts = net === 'instagram' ? scalN(p.extra && p.extra.reposts) : scalN(p.shares);
  return { id: key + '#' + i, net, kind, source: (p.source === 'manual' || p.source === 'metricool') ? p.source : null, slides: scalN(p.slides), date: String(p.post_date || '').slice(0, 10), at: p.posted_at, t: scalTimeParts(p.posted_at),
    cap: String(p.caption || '').trim(), url: p.url || '', img: p.image_url || '',
    views: scalN(p.views), reach: scalN(p.reach), likes: scalN(p.likes), comments: scalN(p.comments), reposts, saves: scalN(p.saves),
    // Facebook posts report impressions in the views field; its reels and the other apps report plays.
    viewLabel: net === 'facebook' && kind === 'post' ? 'Impressions' : 'Views',
    repostLabel: net === 'instagram' ? 'Reposts' : 'Shares' };
}
const scalIsVideo = p => p.kind === 'reel' || p.kind === 'video';
// Manual or Scheduled (Kate, 13 Nov 2026): Hanneh posts most things by hand, the rest is scheduled in Metricool. Amber is Manual, green is Scheduled.
const scalSrcBadge = p => p.source ? `<span class="scal-src ${p.source === 'manual' ? 'man' : 'sch'}" title="${p.source === 'manual' ? 'Posted by hand' : 'Scheduled in Metricool'}">${p.source === 'manual' ? 'Manual' : 'Scheduled'}</span>` : '';
const SCAL_STACK = '<svg class="scal-stack" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="3" width="13" height="13" rx="2.5"></rect><path d="M5 8v10a3 3 0 0 0 3 3h10" fill="none"></path></svg>';
function scalSrcNote(posts) {
  const m = posts.filter(p => p.source === 'manual').length, c = posts.filter(p => p.source === 'metricool').length;
  return m + c ? ` By hand: ${m}, scheduled in Metricool: ${c}.` : '';
}
function scalSrc(k) { scal.src = k; scal.sel = null; scalSave(); scalPaint(); }

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
const scalKindKey = p => p.kind === 'carousel' ? 'carousel' : (p.kind === 'reel' || p.kind === 'video') ? 'reel' : 'post';
const scalPostsRaw = per => per.months.flatMap(k => scalCache[k] || []).filter(p => p.date >= per.from && p.date <= per.to);
const scalPosts = per => per.months.flatMap(k => scalCache[k] || []).filter(p => p.date >= per.from && p.date <= per.to && scal.on[p.net] && scal.kinds[scalKindKey(p)] && (scal.src === 'all' || p.source === scal.src));
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
    <span class="scal-th">${scalImg(p)}${scalIsVideo(p) ? SCAL_PLAY : (p.kind === 'carousel' ? SCAL_STACK : '')}</span>
    ${cls === 'wc' ? '<span class="bd">' : ''}<span class="scal-r1"><span class="scal-bb" aria-hidden="true">${scalIco(p.net)}</span>${scalClock(p.t) || 'Time not known'}${scalSrcBadge(p)}</span>
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

  const srcBtns = [['all', 'Everything'], ['manual', 'Posted by hand'], ['metricool', 'Scheduled in Metricool']].map(([k, l]) => `<button type="button" class="${scal.src === k ? 'on' : ''}" aria-pressed="${scal.src === k}" data-f="src-${k}" onclick="scalSrc('${k}');scalFocus('src-${k}')">${l}</button>`).join('');
  let answer;
  if (scal.busy && !posts.length) answer = 'Loading the posts…';
  else if (scal.err) answer = 'The posts did not load. Refresh to try again.';
  else if (!posts.length) answer = `No posts in <b>${mkEsc(per.label)}</b> with these platforms.`;
  else answer = `<b>${mkEsc(per.label)}</b>: <button type="button" class="scal-link" onclick="scalShowList()">${posts.length} post${posts.length === 1 ? '' : 's'}</button>. Best one: the ${SOC_NETS[best.net]} ${SCAL_KIND[best.kind]} on ${scalShort(best.date)}, ${scalFmt(best.likes)} likes.${scalSrcNote(posts)}${scalStoryNote(per)}`;

  const filterBar = scalFilterBar(cols, per);
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
    </div>
    ${filterBar}
    <section class="scal-answer" aria-live="polite"><div>${answer}</div><div class="scal-actions">${best ? `<button type="button" class="sc-btn primary" data-id="${mkEsc(best.id)}" onclick="scalOpen(this.dataset.id)">See that post</button>` : ''}${posts.length ? `<button type="button" class="sc-btn" onclick="scalDownload('xlsx')">Download XLSX</button><button type="button" class="sc-btn" onclick="scalDownload('csv')">Download CSV</button>` : ''}</div></section>
    ${late.length ? `<p class="scal-note">${late.map(n => `${SOC_NETS[n]} has no posts on record before ${SCAL_MONTHS_NAMED[SCAL_START[n]] || SCAL_START[n]}`).join('. ')}.</p>` : ''}
    <div class="scal-layout${scal.sel || scal.sday ? ' open' : ''}">
      <div class="scal-cal">${body}</div>
      ${scal.sday ? scalStoryPanelHtml(cols) : scal.sel ? scalPanelHtml(scalFind(scal.sel), cols, posts) : ''}
    </div>
    <p class="slv-muted">Posts from Metricool, updated nightly${synced ? ', last ' + mkEsc(synced) : ''}${stale ? ' (no update recorded yet)' : ''}. The apps report a day or two late, so the last days can be thin. Instagram, Facebook and TikTok only for now; stories show when the Stories chip is on, as a picture and the time (${scal.statsOk ? 'their numbers show because you are signed in to the dashboard' : 'story numbers are private, so none are shown'}). Only the numbers anyone can see on a post are shown (likes, comments, shares, and plays on reels and videos).</p>`;
  if (scal.sel) { const c = root.querySelector('.scal-close'); if (c && scal.focusPanel) { c.focus(); scal.focusPanel = false; } }
  scalLbTell(); scalReportHeight(); scalCueInit();
}

// A pop-up taller than the window scrolls inside itself (Kate, 23 Nov 2026). The bar is drawn in the brand colour and a soft fade with "Scroll for more" sits
// at the bottom edge while there is more below, then goes once the end is reached. data-more on the panel drives it.
function scalCue(el) { if (el) el.dataset.more = el.scrollHeight - el.clientHeight - el.scrollTop > 8 ? '1' : '0'; }
function scalCueInit() {
  const el = document.querySelector('.scal-panel'); if (!el) return;
  scalCue(el);
  el.querySelectorAll('img,video').forEach(m => m.addEventListener('load', () => scalCue(el), { once: true }));
  if (window.ResizeObserver) { const ro = new ResizeObserver(() => scalCue(el)); ro.observe(el); const pb = el.querySelector('.scal-pb'); if (pb) ro.observe(pb); }
}
document.addEventListener('scroll', e => { const t = e.target; if (t && t.classList && t.classList.contains('scal-panel')) scalCue(t); }, true);

// Week: hours down the side, a column a day. Posts in the same hour stack inside their cell, so nothing is squashed side by side.
function scalWeekHtml(posts, cols, per, today) {
  const best = scalBest(), days = Array.from({ length: 7 }, (_, i) => scalAdd(per.from, i));
  const known = posts.filter(p => p.t), unknown = posts.filter(p => !p.t);
  // Stories (Kate, 13 Nov 2026): each one is placed in the hour it was uploaded, so the day reads in order. Not one row of them under the header.
  const stor = scal.stories ? days.flatMap(d => scalStoriesOf(d)) : [], sKnown = stor.filter(x => x.t), sUnknown = stor.filter(x => !x.t);
  const hrs = known.map(p => p.t.h).concat(sKnown.map(x => x.t.h)), h0 = Math.min(8, ...hrs), h1 = Math.max(22, ...hrs);
  const cell = {}; known.forEach(p => { (cell[p.date + '|' + p.t.h] = cell[p.date + '|' + p.t.h] || []).push(p); });
  const scell = {}; sKnown.forEach(x => { (scell[x.date + '|' + x.t.h] = scell[x.date + '|' + x.t.h] || []).push(x); });
  let g = '<div class="scal-dh c0"></div>' + days.map(d => `<div class="scal-dh${d === today ? ' today' : ''}"><b>${mkD(d).toLocaleDateString('en-GB', { weekday: 'short' })}</b><span class="n">${mkD(d).getDate()}</span></div>`).join('');
  if (unknown.length || sUnknown.length) g += '<div class="scal-hl">Time not known</div>' + days.map(d => `<div class="scal-hc l0">${unknown.filter(p => p.date === d).map(p => scalTile(p, cols, 'tc')).join('')}${scalStoryChips(sUnknown.filter(x => x.date === d), cols)}</div>`).join('');
  for (let h = h0; h <= h1; h++) {
    g += `<div class="scal-hl">${scalHour(h)}</div>` + days.map((d, i) => `<div class="scal-hc l${best ? best(i, h) : 0}">${(cell[d + '|' + h] || []).map(p => scalTile(p, cols, 'tc')).join('')}${scalStoryChips(scell[d + '|' + h] || [], cols)}</div>`).join('');
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
  const stories = scalStoriesOf(d).slice().sort((a, b) => (a.at || '') < (b.at || '') ? -1 : 1), sKnown = stories.filter(x => x.t), sUnknown = stories.filter(x => !x.t);
  const head = scal.stories ? (stories.length ? `<div class="scal-dstories">${scalStoryTotals(stories)}</div>` : '') : '';
  if (!posts.length && !stories.length) return `<div class="scal-empty" style="padding:20px 4px">${d > today ? 'Not yet.' : 'No posts this day with these platforms.'}</div>`;
  const hrs = known.map(p => p.t.h).concat(sKnown.map(x => x.t.h)), h0 = Math.min(8, ...hrs), h1 = Math.max(22, ...hrs);
  const cell = {}, scell = {};
  known.forEach(p => { (cell[p.t.h] = cell[p.t.h] || []).push(p); });
  sKnown.forEach(x => { (scell[x.t.h] = scell[x.t.h] || []).push(x); });
  let g = '';
  if (unknown.length || sUnknown.length) g += '<div class="scal-hl">Time not known</div><div class="scal-hc l0">' + unknown.map(p => scalTile(p, cols, 'tc')).join('') + sUnknown.map(x => scalStoryCard(x, cols)).join('') + '</div>';
  for (let h = h0; h <= h1; h++) g += `<div class="scal-hl">${scalHour(h)}</div><div class="scal-hc l${best ? best(dow, h) : 0}">${(cell[h] || []).map(p => scalTile(p, cols, 'tc')).join('')}${(scell[h] || []).map(x => scalStoryCard(x, cols)).join('')}</div>`;
  // Phone: the day in time order, posts and stories mixed, no hour grid.
  const mixed = posts.map(p => ({ at: p.at || p.date, html: scalTile(p, cols, 'wc') })).concat(stories.map(x => ({ at: x.at || x.date, html: scalStoryCard(x, cols) }))).sort((a, b) => a.at < b.at ? -1 : 1);
  const stacked = `<div class="scal-wcol${d === today ? ' today' : ''}">${mixed.map(m => m.html).join('')}</div>`;
  return `${head}<div class="scal-tgrid day">${g}</div><div class="scal-wstack">${stacked}</div>${scal.stories ? scalStoryCaption() : ''}`;
}

// Month: a pill a post for two or more platforms, a picture a post for one. On a phone, dots and the chosen day's list underneath.
function scalMonthHtml(posts, cols, per, today) {
  const first = mkD(per.from), lead = (first.getDay() + 6) % 7, nd = mkD(per.to).getDate(), total = Math.ceil((lead + nd) / 7) * 7;
  const solo = SCAL_NETS.filter(n => scal.on[n]).length === 1, by = {};
  posts.forEach(p => { (by[p.date] = by[p.date] || []).push(p); });
  const pill = p => { const cur = scal.sel === p.id ? ' aria-current="true"' : '';
    return solo
      ? `<button type="button" class="scal-tile" data-id="${mkEsc(p.id)}" style="${scalStyle(p, cols)}" aria-label="${mkEsc(scalLabel(p))}"${cur} onclick="scalOpen(this.dataset.id)"><span class="scal-th">${scalImg(p)}${scalIsVideo(p) ? SCAL_PLAY : (p.kind === 'carousel' ? SCAL_STACK : '')}</span><span class="tm">${scalClock(p.t, true)}</span></button>`
      : `<button type="button" class="scal-pill" data-id="${mkEsc(p.id)}" style="${scalStyle(p, cols)}" aria-label="${mkEsc(scalLabel(p))}"${cur} onclick="scalOpen(this.dataset.id)"><span class="scal-bb" aria-hidden="true">${scalIco(p.net)}</span><span class="t">${scalClock(p.t, true)}</span>${p.source === 'manual' ? '<span class="scal-sd" title="Posted by hand"></span>' : ''}${scalIsVideo(p) ? `<span class="k" title="${SCAL_KIND[p.kind]}" aria-hidden="true">▶</span>` : ''}<span class="c">${scalCap(p)}</span></button>`; };
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
      <span class="pc"><span class="scal-th">${scalImg(p)}${scalIsVideo(p) ? SCAL_PLAY : (p.kind === 'carousel' ? SCAL_STACK : '')}</span><span class="tx"><span class="cp">${scalCap(p)}</span><span class="mini">${SOC_NETS[p.net]} · ${scalFmt(p.likes)} likes · ${scalFmt(p.comments)} comments</span></span></span>
      <span class="pl"><span class="scal-bb" aria-hidden="true">${scalIco(p.net)}</span>${SOC_NETS[p.net]} · ${SCAL_KIND[p.kind]}${scalSrcBadge(p)}</span>
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
    <div class="scal-ph"><span class="scal-b" aria-hidden="true">${scalIco(p.net)}</span>
      <div class="when"><b>${scalLong(p.date)}${p.t ? ', ' + scalClock(p.t) : ''}</b><span>${SOC_NETS[p.net]} ${SCAL_KIND[p.kind]}${p.kind === 'carousel' && p.slides ? ', ' + p.slides + ' slides' : ''} ${scalSrcBadge(p)}</span></div>
      <button type="button" class="scal-icon scal-close" aria-label="Close" onclick="scalClose()">×</button></div>
    <div class="scal-pb">
      ${verdict}
      ${p.source ? `<p class="scal-srcline">${p.source === 'manual' ? 'Posted by hand, not scheduled in Metricool.' : 'Scheduled in Metricool.'}</p>` : ''}
      <div class="scal-pic" ${p.img ? '' : 'style="min-height:160px"'}>${scalImg(p, true)}${(scalIsVideo(p) || scalEmbedUrl(p)) ? `<button type="button" class="scal-vid" data-id="${mkEsc(p.id)}" onclick="scalPlay(this.dataset.id)" aria-label="${scalIsVideo(p) ? 'Play' : 'Show'} this ${SCAL_KIND[p.kind]} here">${SCAL_PLAY}</button>` : ''}</div>
      ${calSafeUrl(p.url) ? `<a class="sc-btn scal-open" href="${mkEsc(calSafeUrl(p.url))}" target="_blank" rel="noopener noreferrer">${scalIsVideo(p) ? 'Watch' : 'Open'} on ${verb}</a>` : ''}
      <div><div class="scal-sec">Caption</div><p class="scal-pcap full">${scalCap(p)}</p></div>
      <div class="scal-stot"><span>How it did</span><dl class="scal-sstats">${nums.map(([l, v]) => `<div><dt>${l}</dt><dd>${scalFmt(v)}</dd></div>`).join('')}</dl></div>
      ${scalGraphHtml(p)}
      ${scalPrivateNums(p)}
      ${scalTryHtml(p)}
    </div><div class="scal-cue" aria-hidden="true"><span>Scroll for more</span></div></aside><div class="scal-scrim" onclick="scalScrimClick(event)"></div>`;
}

// ── Doing things ──────────────────────────────────────────────────────────────────
function scalOpen(id) { scal.sday = null; scal.sel = id; scal.focusPanel = true; scalPaint(); }
function scalClose() { scal.sel = null; scal.sday = null; scalPaint(); }
// A click outside the window closes it, and when it landed on something in the calendar (a post, a story, a day) that opens too: no need to close first (Kate, 13 Nov 2026).
function scalScrimClick(e) {
  const x = e.clientX, y = e.clientY;
  scalClose();
  const el = document.elementFromPoint(x, y), b = el && el.closest('button,[onclick]');
  if (b && b.closest('.scal-cal') && !b.closest('.scal-panel')) b.click();
}
// Filters (Kate, 13 Nov 2026, option A of docs/mockups/content-calendar-filters-v2.html): one button, its panel asks Where (platform), What (kind of content) and How it was posted,
// and what was chosen shows as tags under it. The number on the button is how many things are hidden or narrowed. Stories are off until ticked, as before.
function scalFocus(id) { const el = document.querySelector('[data-f="' + id + '"]'); if (el) el.focus(); }
function scalFilterBar(cols, per) {
  const raw = scalPostsRaw(per);
  const KINDS = [['post', 'Posts'], ['carousel', 'Carousels'], ['reel', 'Reels and videos']];
  const nHidden = SCAL_NETS.filter(n => !scal.on[n]).length + KINDS.filter(([k]) => !scal.kinds[k]).length + (scal.src !== 'all' ? 1 : 0);
  const storyN = per.months.flatMap(m => scalStoryCache[m] || []).filter(x => x.date >= per.from && x.date <= per.to).length;
  const opt = (id, checked, click, dot, label, count, extra) => `<label class="scal-opt"><input type="checkbox" data-f="${id}" ${checked ? 'checked' : ''} onchange="${click}">${dot ? `<span class="scal-od" style="--c:${dot}"></span>` : ''}${label}${count !== '' ? ` <span class="scal-oc">${count}</span>` : ''}${extra || ''}</label>`;
  const where = SCAL_NETS.map(n => opt('p-' + n, scal.on[n], `scalPlatSet('${n}',this.checked)`, cols[n], SOC_NETS[n], raw.filter(p => p.net === n).length)).join('')
    + `<label class="scal-opt na"><input type="checkbox" disabled><span class="scal-od" style="--c:var(--muted2)"></span>YouTube <span class="scal-soon" title="Metricool gives us daily totals for YouTube, not a list of videos.">Not yet</span></label>`;
  const what = KINDS.map(([k, l]) => opt('k-' + k, scal.kinds[k], `scalKindSet('${k}',this.checked)`, '', l, raw.filter(p => scalKindKey(p) === k).length)).join('')
    + opt('k-story', scal.stories, `scalStoriesSet(this.checked)`, '', 'Stories', scal.stories ? storyN : '');
  const srcBtns = [['all', 'Everything'], ['manual', 'Posted by hand'], ['metricool', 'Scheduled in Metricool']].map(([k, l]) => `<button type="button" aria-pressed="${scal.src === k}" data-f="src-${k}" onclick="scalSrc('${k}');scalFocus('src-${k}')">${l}</button>`).join('');
  const tags = [];
  SCAL_NETS.filter(n => !scal.on[n]).forEach(n => tags.push(`<span class="scal-tag">Hiding ${SOC_NETS[n]}<button type="button" aria-label="Show ${SOC_NETS[n]}" onclick="scalPlatSet('${n}',true)">×</button></span>`));
  KINDS.filter(([k]) => !scal.kinds[k]).forEach(([k, l]) => tags.push(`<span class="scal-tag">Hiding ${l.toLowerCase()}<button type="button" aria-label="Show ${l}" onclick="scalKindSet('${k}',true)">×</button></span>`));
  if (scal.src !== 'all') tags.push(`<span class="scal-tag">${scal.src === 'manual' ? 'Posted by hand only' : 'Scheduled in Metricool only'}<button type="button" aria-label="Remove" onclick="scalSrc('all')">×</button></span>`);
  if (scal.stories) tags.push(`<span class="scal-tag">Stories shown<button type="button" aria-label="Hide stories" onclick="scalStoriesSet(false)">×</button></span>`);
  return `<div class="scal-fbar"><span class="scal-srclbl">Show</span>
    <div class="scal-fwrap"><button type="button" class="scal-fbtn" aria-expanded="${scal.fopen}" aria-haspopup="true" onclick="scalFToggle()">Filters${nHidden ? `<span class="scal-fn">${nHidden}</span>` : ''}</button>
      <div class="scal-fpanel${scal.fopen ? ' open' : ''}" role="group" aria-label="Filters">
        <div class="scal-fsec"><h4>Where</h4><div class="scal-opts">${where}</div></div>
        <div class="scal-fsec"><h4>What</h4><div class="scal-opts">${what}</div></div>
        <div class="scal-fsec"><h4>How it was posted</h4><div class="sc-seg scal-seg">${srcBtns}</div><p class="scal-fhint">Stories are posted live in the app, so they count as posted by hand.</p></div>
        <div class="scal-ffoot"><button type="button" class="scal-fclear" onclick="scalClearFilters()">Clear all filters</button><button type="button" class="scal-fdone" onclick="scalFToggle()">Done</button></div>
      </div></div>
    <div class="scal-ftags">${tags.join('')}${nHidden ? '<button type="button" class="scal-fclear" onclick="scalClearFilters()">Clear all</button>' : ''}</div></div>`;
}
function scalFToggle() { scal.fopen = !scal.fopen; scalPaint(); if (scal.fopen) { const f = document.querySelector('.scal-fpanel input:not([disabled])'); if (f) f.focus(); } }
function scalPlatSet(n, v) {
  if (!v && SCAL_NETS.filter(x => scal.on[x]).length === 1) { scalPaint(); return; }
  scal.on[n] = v; scal.sel = null; scalSave(); scalPaint(); scalFocus('p-' + n);
}
function scalKindSet(k, v) { scal.kinds[k] = v; scal.sel = null; scalSave(); scalPaint(); scalFocus('k-' + k); }
function scalStoriesSet(v) { if (!!scal.stories !== !!v) scalToggleStories(); else scalPaint(); scalFocus('k-story'); }
function scalClearFilters() { SCAL_NETS.forEach(n => { scal.on[n] = true; }); scal.kinds = { post: true, carousel: true, reel: true }; scal.src = 'all'; scal.sel = null; scalSave(); scalPaint(); }
document.addEventListener('click', e => { if (scal.fopen && !e.target.closest('.scal-fwrap')) { scal.fopen = false; scalPaint(); } });
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
document.addEventListener('keydown', e => { if (e.key === 'Escape' && scal.fopen) { scal.fopen = false; scalPaint(); scalFocus('x'); return; } if (e.key === 'Escape' && (scal.sel || scal.sday) && document.getElementById('scalRoot')) scalClose(); });


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
async function scalEnsure() { await scalEnsurePosts(); await scalEnsureStories(); scalAskPostStats(); }

const scalStoriesOf = (date, net) => scal.stories ? (scalStoryCache[date.slice(0, 7)] || []).filter(s => s.date === date && scal.on[s.net] && (!net || s.net === net) && (scal.src === 'all' || scal.src === 'manual')) : [];
function scalStoriesChip(cols) {
  return `<button type="button" class="scal-plat" style="--c:#B7791F;--bf:#FFFFFF" aria-pressed="${!!scal.stories}" onclick="scalToggleStories()" title="Stories: a picture and the time, no numbers"><span class="scal-b" aria-hidden="true">ST</span>Stories</button>`;
}
function scalToggleStories() { scal.stories = !scal.stories; scal.sday = null; scalSave(); if (scal.stories) { scalPaint(); scalEnsureStories(); } else scalPaint(); }
function scalStoryPills(date, cols) {
  if (!scal.stories) return '';
  return ['instagram', 'facebook'].map(n => {
    const k = scalStoriesOf(date, n).length; if (!k) return '';
    return `<button type="button" class="scal-spill" style="--c:${cols[n]};--bf:${scalBadgeFg(cols[n])}" onclick="event.stopPropagation();scalStoryOpen('${date}','${n}')" aria-label="${SOC_NETS[n]} stories on ${scalLong(date)}, ${k}"><span class="scal-bb" aria-hidden="true">${scalIco(n)}</span>${k} ${k === 1 ? 'story' : 'stories'}</button>`;
  }).join('');
}
// A story in the week grid: a small picture and its time, in the hour it went up. It opens that day's stories for the network, with this one marked.
function scalStoryChips(list, cols) {
  if (!list.length) return '';
  return '<div class="scal-schips">' + list.slice().sort((a, b) => (a.at || '') < (b.at || '') ? -1 : 1).map(x => {
    const c = cols[x.net], st = scalStatOf(x), tip = SOC_NETS[x.net] + ' story (posted by hand), ' + (scalClock(x.t) || 'time not known') + (st && st.views != null ? ', ' + scalFmt(st.views) + ' views' : '');
    return `<button type="button" class="scal-schip" data-s="${mkEsc(x.net + '|' + x.at)}" style="--c:${c};--bf:${scalBadgeFg(c)}" title="${mkEsc(tip)}" aria-label="${mkEsc(tip)}" onclick="event.stopPropagation();scalStoryOpen('${x.date}','${x.net}','${x.at || ''}')"><span class="scal-sth">${x.img ? `<img src="${mkEsc(x.img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</span><span class="tm"><span class="scal-bb" aria-hidden="true">${scalIco(x.net)}</span>${scalClock(x.t, true)}<span class="scal-sd" aria-hidden="true"></span></span></button>`;
  }).join('') + '</div>';
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
// Post numbers (Kate, 13 Nov 2026): reach, saves, views, shares, interactions and watch time are private insights, so the public call never sends them. Held in the dashboard, this page asks it
// (trs-cal-need-post-stats, two dates) and the signed-in dashboard (Level 3 and up) answers with trs-cal-post-stats. On its own address nothing is asked and nothing is shown.
function scalAskPostStats() {
  if (!calEmbedded || !scal.ws) return;
  const per = scalPeriod(), key = per.months.join(',');
  if (scal.pasked[key]) return;
  scal.pasked[key] = true;
  const from = per.months[0] + '-01', to = scalMonthEnd(per.months[per.months.length - 1]);
  try { window.parent.postMessage({ type: 'trs-cal-need-post-stats', from, to }, '*'); } catch (e) {}
}
function scalGotPostStats(d) {
  if (!d || !Array.isArray(d.rows) || d.rows.length > 5000) return;
  d.rows.forEach(r => {
    if (!r || !SCAL_NETS.includes(r.network) || typeof r.posted_at !== 'string') return;
    scal.pstats[r.network + '|' + r.posted_at] = { views: scalN(r.views), reach: scalN(r.reach), saves: scalN(r.saves), shares: scalN(r.shares), interactions: scalN(r.interactions), avgWatch: scalN(r.avg_watch), skip: scalN(r.skip_rate) };
  });
  scalPaint();
}
// What the views led to (Kate, 23 Nov 2026, from the story graph mockup): the same look as the story viewer's "What the viewers did". One list of numbers feeds the lead line,
// the bar, the rows and the answer cards, so the sentences cannot disagree with the figures. The whole is the post's views (plays, or impressions on a Facebook post); the parts
// are the reactions the app counted, and the rest is "No reaction counted". Saves come only from the private numbers. A part that is 0 is not drawn and is named in the foot.
function scalGraphHtml(p) {
  const total = p.views; if (total === null || total === undefined || !(total > 0)) return '';
  const st = scal.pstats[p.net + '|' + p.at] || {};
  const unit = p.viewLabel === 'Impressions' ? 'impressions' : (scalIsVideo(p) ? 'plays' : 'views');
  const rep = p.net === 'instagram';
  const defs = [
    { k: 'like', c: 'var(--gr-like)', name: 'Liked', plural: 'Likes', sub: 'pressed like', n: p.likes, says: 'They pressed like.' },
    { k: 'com', c: 'var(--gr-com)', name: 'Commented', plural: 'Comments', sub: 'left a comment', n: p.comments, says: 'They left a comment.' },
    { k: 'shr', c: 'var(--gr-shr)', name: rep ? 'Reposted' : 'Shared', plural: p.repostLabel, sub: rep ? 'reposted it to their own page' : 'sent it on to someone', n: p.reposts, says: rep ? 'They reposted it to their own page.' : 'They sent it on to someone.' },
    { k: 'sav', c: 'var(--gr-sav)', name: 'Saved', plural: 'Saves', sub: 'kept it for later', n: st.saves, says: 'They kept it to come back to.' }
  ].filter(d => d.n !== null && d.n !== undefined);
  const sum = defs.reduce((a, d) => a + d.n, 0);
  if (!sum || sum > total) return '';
  const pct = n => n > 0 && n * 100 / total < 0.5 ? 0 : Math.round(n * 100 / total);
  const pctTxt = n => n > 0 && n * 100 / total < 0.5 ? '<1%' : pct(n) + '%';
  const parts = defs.filter(d => d.n > 0).concat([{ k: 'non', c: 'var(--gr-non)', name: 'No reaction counted', sub: 'watched and moved on', n: total - sum, says: 'No like, comment, share or save was counted for these.' }]).filter(d => d.n > 0);
  const zero = defs.filter(d => d.n === 0).map(d => d.plural);
  const sayOf = d => `<b>${mkEsc(d.name)}</b>${scalFmt(d.n)} of ${scalFmt(total)} ${unit}, ${pct(d.n) ? pct(d.n) + ' in every 100' : 'fewer than 1 in every 100'}. ${mkEsc(d.says)}`;
  const reacted = pct(sum);
  const lead = `<b>${reacted ? reacted + ' in every 100' : 'Fewer than 1 in every 100'}</b> ${unit} ended in a reaction: a like, a comment, a share${st.saves !== null && st.saves !== undefined ? ' or a save' : ''}.`;
  const head = `What the ${scalFmt(total)} ${unit} led to`;
  return `<section class="scal-gr" aria-label="${mkEsc(head)}">
    <div class="scal-grh">${mkEsc(head)}</div>
    <p class="scal-grlead">${lead}</p>
    <div class="scal-gstack" role="img" aria-label="${mkEsc(head)}">${parts.map(d => `<span class="scal-gseg" data-k="${d.k}" style="--n:${d.n};--c:${d.c}"></span>`).join('')}</div>
    <div class="scal-gans" role="status" aria-live="polite">Hover or tap a part of the bar.</div>
    <ul class="scal-glegend">${parts.map(d => `<li class="scal-grrow" data-k="${d.k}" tabindex="0" style="--c:${d.c}" data-say="${mkEsc(sayOf(d))}"><span class="dot"></span><span class="nm">${mkEsc(d.name)}<small>${mkEsc(d.sub)}</small></span><span class="n">${scalFmt(d.n)}</span><span class="pc">${pctTxt(d.n)}</span></li>`).join('')}</ul>
    <p class="scal-grfoot">Out of ${scalFmt(total)} ${unit}. Someone who liked and shared is counted in both.${zero.length ? ` ${zero.join(' and ')} are 0, so they are not shown as a bar.` : ''}</p>
  </section>`;
}
// Hover, focus or tap a part of the bar or a row and both light up; on a computer the answer fills the card under the bar, on a phone it opens inside the tapped row.
const scalGrTouch = () => matchMedia('(hover:none)').matches || innerWidth <= 720;
function scalGrHide(sec) {
  sec.querySelectorAll('.lit').forEach(e => e.classList.remove('lit'));
  sec.querySelectorAll('.scal-hovc').forEach(x => x.remove());
  const a = sec.querySelector('.scal-gans'); if (a) { a.classList.remove('on'); a.textContent = 'Hover or tap a part of the bar.'; }
}
function scalGrShow(el) {
  const sec = el.closest('.scal-gr'), k = el.dataset.k, row = sec.querySelector('.scal-grrow[data-k="' + k + '"]'); if (!row) return;
  sec.querySelectorAll('.lit').forEach(e => e.classList.remove('lit'));
  sec.querySelectorAll('[data-k="' + k + '"]').forEach(e => e.classList.add('lit'));
  const c = row.style.getPropertyValue('--c');
  if (scalGrTouch()) {
    sec.querySelectorAll('.scal-hovc').forEach(x => x.remove());
    const d = document.createElement('div'); d.className = 'scal-hovc'; d.style.setProperty('--c', c); d.innerHTML = row.dataset.say; row.appendChild(d);
    clearTimeout(sec._t); sec._t = setTimeout(() => scalGrHide(sec), 5000);
  } else {
    const a = sec.querySelector('.scal-gans'); a.style.setProperty('--c', c); a.innerHTML = row.dataset.say; a.classList.add('on');
  }
}
const scalGrPart = e => e.target && e.target.closest ? e.target.closest('.scal-gr [data-k]') : null;
document.addEventListener('mouseover', e => { const t = scalGrPart(e); if (t && !scalGrTouch()) scalGrShow(t); });
document.addEventListener('mouseout', e => { const t = scalGrPart(e); if (t && !scalGrTouch() && !(e.relatedTarget && t.contains(e.relatedTarget))) scalGrHide(t.closest('.scal-gr')); });
document.addEventListener('focusin', e => { const t = scalGrPart(e); if (t && t.classList.contains('scal-grrow')) scalGrShow(t); });
document.addEventListener('focusout', e => { const t = scalGrPart(e); if (t && t.classList.contains('scal-grrow')) scalGrHide(t.closest('.scal-gr')); });
document.addEventListener('click', e => { const t = scalGrPart(e); if (t && scalGrTouch()) scalGrShow(t); });

// The private block of the pop-up, only when the dashboard sent the numbers. Facebook's views are impressions.
function scalPrivateNums(p) {
  const st = scal.pstats[p.net + '|' + p.at]; if (!st) return '';
  const items = [[p.viewLabel === 'Impressions' ? 'Impressions' : (scalIsVideo(p) ? 'Plays' : 'Views'), st.views], ['Reach', st.reach], ['Saves', st.saves], [p.repostLabel, st.shares], ['Interactions', st.interactions]]
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([l, v]) => `<div><dt>${l}</dt><dd>${scalFmt(v)}</dd></div>`);
  if (st.avgWatch !== null && st.avgWatch !== undefined) items.push(`<div><dt>Average watch time</dt><dd>${Math.round(st.avgWatch * 10) / 10}s</dd></div>`);
  if (st.skip !== null && st.skip !== undefined) items.push(`<div><dt>Skipped early</dt><dd>${Math.round(st.skip)}%</dd></div>`);
  return items.length ? `<div class="scal-stot"><span>Private numbers <em class="scal-priv">only you can see these, signed in</em></span><dl class="scal-sstats">${items.join('')}</dl></div>` : '';
}
function scalGotStats(d) {
  if (!d || !Array.isArray(d.rows) || d.rows.length > 5000) return;
  d.rows.forEach(r => {
    if (!r || !SCAL_NETS.includes(r.network) || typeof r.posted_at !== 'string') return;
    const o = { url: calSafeUrl(r.url), media: calSafeUrl(r.media_url), isVideo: r.is_video === true, noFile: r.no_file === true };
    SCAL_SFIELDS.forEach(([k]) => { o[k] = scalN(r[k]); });
    scal.sstats[r.network + '|' + r.posted_at] = o;
  });
  if (d.rows.length) scal.statsOk = true;
  if (scalImp && scalImp.waitStats && d.from === scalImp.waitStats.from && d.to === scalImp.waitStats.to) { const w = scalImp.waitStats; scalImp.waitStats = null; w.res(); }
  scalPaint();
  if (scalLb) scalLbPaint();   // an open viewer picks up a file that was just attached
}
function scalStatLines(st) {
  const items = SCAL_SFIELDS.filter(([k]) => st[k] !== null && st[k] !== undefined).map(([k, l]) => `<div><dt>${l}</dt><dd>${scalFmt(st[k])}</dd></div>`).join('');
  return items ? `<dl class="scal-sstats">${items}</dl>` : '';
}
// What the viewers of a story did (Kate, 23 Nov 2026): one thin bar split into tapped forward, left the stories, tapped back and other, out of the views. Every part of the bar and
// every row lifts and glows on hover, tap or focus, and the answer is written in a reserved slot under the bar, so it never covers a row. The sentences are built from the same numbers
// as the bar. It only draws when views and all three tap numbers came from the dashboard.
function scalFlowHtml(st) {
  if (!st) return '';
  const v = st.views, f = st.taps_forward, b = st.taps_back, x = st.exits;
  if ([v, f, b, x].some(n => n === null || n === undefined) || !(v > 0)) return '';
  const sum = f + b + x, over = sum > v, D = over ? sum : v, oth = over ? 0 : v - sum;
  const pct = n => Math.round(n * 100 / D);
  const parts = [
    { k: 'fwd', c: '#e58ad0', name: 'Tapped forward', n: f, says: 'They moved on to the next story.' },
    { k: 'exit', c: '#ff9d7a', name: 'Left the stories', n: x, says: 'They closed it or swiped to another account.' },
    { k: 'back', c: '#8fb8ff', name: 'Tapped back', n: b, says: 'They went back to watch the one before.' },
    { k: 'oth', c: '#8a8a98', name: 'Other', n: oth, says: 'No tap was counted for these.' }
  ].filter(p => p.k !== 'oth' || p.n > 0);
  const of = over ? 'taps and exits' : 'views';
  const say = p => p.n + ' of ' + D + ' ' + of + ', ' + pct(p.n) + ' in every 100. ' + p.says;
  const seg = parts.filter(p => p.n > 0).map(p => `<span class="scal-lbg-seg" data-k="${p.k}" data-nm="${p.name}" data-say="${mkEsc(say(p))}" style="--n:${p.n};--g:${p.c}"></span>`).join('');
  const rows = parts.map(p => `<li class="scal-lbg-row" data-k="${p.k}" data-nm="${p.name}" data-say="${mkEsc(say(p))}" tabindex="0" style="--g:${p.c}"><i aria-hidden="true"></i><span>${p.name}</span><b>${scalFmt(p.n)}</b><em>${pct(p.n)}%</em></li>`).join('');
  return `<div class="scal-lbg" aria-label="What the ${scalFmt(D)} viewers did"><h4>What the ${scalFmt(D)} viewers did</h4>
    <p class="scal-lbg-lead"><b>${pct(f)} in every 100</b> tapped forward. <b>${pct(x)} in every 100</b> left.</p>
    <div class="scal-lbg-bar" role="img" aria-label="Tapped forward ${f}, left ${x}, tapped back ${b}${oth ? ', other ' + oth : ''}">${seg}</div>
    <div class="scal-lbg-ans" aria-live="polite">Hover or tap a part of the bar.</div><ul class="scal-lbg-rows">${rows}</ul>
    ${over ? '<p class="scal-lbg-foot">Some people tapped more than once, so this is out of all taps and exits.</p>' : ''}</div>`;
}
function scalFlowOn(el) {
  const g = el.closest('.scal-lbg'); if (!g) return;
  const k = el.dataset.k, ans = g.querySelector('.scal-lbg-ans');
  g.querySelectorAll('[data-k]').forEach(e => e.classList.toggle('lit', e.dataset.k === k));
  g.style.setProperty('--g', el.style.getPropertyValue('--g'));
  ans.classList.add('on'); ans.textContent = '';
  const b = document.createElement('b'); b.textContent = el.dataset.nm; ans.appendChild(b); ans.appendChild(document.createTextNode(el.dataset.say));
}
function scalFlowOff(g) {
  if (!g) return;
  g.querySelectorAll('.lit').forEach(e => e.classList.remove('lit'));
  const ans = g.querySelector('.scal-lbg-ans'); ans.classList.remove('on'); ans.textContent = 'Hover or tap a part of the bar.';
}
['mouseover', 'focusin', 'click'].forEach(ev => document.addEventListener(ev, e => { const el = e.target.closest && e.target.closest('.scal-lbg [data-k]'); if (el) scalFlowOn(el); }));
['mouseout', 'focusout'].forEach(ev => document.addEventListener(ev, e => {
  const el = e.target.closest && e.target.closest('.scal-lbg [data-k]'); if (!el) return;
  const to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest('.scal-lbg [data-k]') : null;
  if (!to) scalFlowOff(el.closest('.scal-lbg'));
}));
function scalStoryCard(s, cols) {
  const st = scalStatOf(s), c = cols[s.net], cur = scal.sday && scal.sday.at && scal.sday.at === s.at && scal.sday.net === s.net;
  return `<figure class="scal-story${cur ? ' cur' : ''}" data-s="${mkEsc(s.net + '|' + s.at)}" style="--c:${c};--bf:${scalBadgeFg(c)}" onclick="scalLbOpenStory(this.dataset.s)"><div class="scal-sth"><button type="button" class="scal-splay" aria-label="Watch this story" onclick="event.stopPropagation();scalLbOpenStory(this.closest('[data-s]').dataset.s)">${SCAL_PLAY}</button>${s.img ? `<img src="${mkEsc(s.img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</div>
    <figcaption><b><span class="scal-bb" aria-hidden="true">${scalIco(s.net)}</span>${mkEsc(scalClock(s.t) || '')} ${scalSrcBadge({ source: 'manual' })}</b>${st && st.noFile ? `<span class="scal-snone scal-snote">Picture only: ${SOC_NETS[s.net]} gave no video file</span>` : ''}${st ? scalStatLines(st) : (scal.statsOk ? '<span class="scal-snone">No numbers kept for this story</span>' : '')}${st && st.url ? `<a class="scal-slink" href="${mkEsc(st.url)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" title="Works for 24 hours after it was posted">Open on ${SOC_NETS[s.net]}</a>` : ''}</figcaption></figure>`;
}
function scalStoryTotals(list) {
  const tot = {}, got = list.map(scalStatOf).filter(Boolean);
  if (!got.length) return '';
  SCAL_SFIELDS.forEach(([k]) => { const v = got.map(x => x[k]).filter(x => x !== null && x !== undefined); if (v.length) tot[k] = v.reduce((a, b) => a + b, 0); });
  return `<div class="scal-stot"><span>All ${list.length} stories</span>${scalStatLines(tot)}</div>`;
}
function scalStoryCaption() {
  return scal.statsOk
    ? '<p class="scal-pcap">Story numbers come from Metricool and show here because you are signed in to the dashboard. Stories saved since 12 Nov 2026 play here. Earlier ones, and stories with copyrighted music, show as a picture because Instagram and Facebook keep a story for 24 hours and hand over no file for music; the link opens a story while it is still live. Open a story and use Attach video to add its file from the archive.</p>'
    : '<p class="scal-pcap">Pictures and times only. Story numbers (views, reach, replies, taps) are private, so they are not shown on this page.</p>';
}
// The viewer (Kate, 13 Nov 2026): double-click a story or a post (or press the play sign on a story) and it opens in its own window in the Instagram story style:
// progress bars, the account on top, the picture or video in a tall frame, arrows and the keys left and right to go to the next one without closing it.
// A story plays as a video only when the dashboard sends its file (media_url). Instagram keeps a story for 24 hours, so older ones are a picture and the viewer says so.
let scalLb = null;
const scalByAt = (a, b) => (a.at || '') < (b.at || '') ? -1 : 1;
function scalFindStory(key) { return Object.values(scalStoryCache).flat().find(x => x.net + '|' + x.at === key) || null; }
function scalLbOpenStory(key) {
  const s0 = scalFindStory(key); if (!s0) return;
  const list = scalStoriesOf(s0.date, s0.net).slice().sort(scalByAt);
  scalLbStart(list.map(x => ({ k: 'story', s: x })), Math.max(0, list.findIndex(x => x.at === s0.at)));
}
function scalLbOpenPost(p) {
  const list = scalPosts(scalPeriod()).slice().sort(scalByAt).filter(x => x.img || scalEmbedUrl(x));
  const i = list.findIndex(x => x.id === p.id);
  if (i < 0) { if (calSafeUrl(p.url)) window.open(calSafeUrl(p.url), '_blank', 'noopener'); return; }
  scalLbStart(list.map(x => ({ k: 'post', p: x })), i);
}
// The viewer sits inside the dashboard's frame, and that frame is taller than the screen, so a viewer centred in it ran off the bottom of the window
// (Kate, 18 Nov 2026). While it is open the page tells the dashboard (trs-cal-lb), which stretches the frame over the whole window and puts it back on close.
// A page opened on its own has no parent to tell; an older dashboard ignores the message and the viewer behaves as before.
// Whether the frame must cover the window is worked out here, not passed in: a viewer, the import window, or a day or post panel (all fixed to the frame's own viewport) need it; the plain calendar does not.
let scalTold = false, scalHSent = 0, scalHRaf = 0;
function scalLbTell() {
  let want = false;
  try { want = !!(scalLb || scalImp || (typeof scal !== 'undefined' && (scal.sel || scal.sday))); } catch (e) { want = !!scalLb; }
  if (want === scalTold) return; scalTold = want;
  try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'trs-cal-lb', open: want }, '*'); } catch (e) {}
}
// The frame's height follows the calendar (Kate, 18 Nov 2026), so the dashboard's own page scrolls and the whole month shows, not a short box with a second scroll inside it.
// The page tells the dashboard how tall its content is (trs-cal-h); the dashboard sets the frame to that. On its own address nothing is sent.
function scalReportHeight() {
  if (!calEmbedded || scalHRaf) return;
  scalHRaf = setTimeout(() => {   // a timer, not requestAnimationFrame: that one never runs while the tab is in the background
    scalHRaf = 0; const w = document.querySelector('.wrap'); if (!w) return;
    const h = Math.ceil(w.getBoundingClientRect().height); if (h === scalHSent || h < 200) return;
    scalHSent = h; try { window.parent.postMessage({ type: 'trs-cal-h', h }, '*'); } catch (e) {}
  }, 40);
}
if (calEmbedded && window.ResizeObserver) { const w = document.querySelector('.wrap'); if (w) new ResizeObserver(scalReportHeight).observe(w); }
// Kate, 23 Nov 2026: while a pop-up is open the dashboard stretches this frame to the height of the window (trs-cal-lb), so the page here is taller than the frame and its own scroll starts at the top: the
// calendar behind the pop-up jumped up, and back down when it closed. Once the frame is stretched the dashboard says how far down the calendar was showing (trs-cal-scroll) and the page scrolls there.
window.addEventListener('message', e => {
  if (!calEmbedded || e.source !== window.parent || !e.data || e.data.type !== 'trs-cal-scroll') return;
  const y = Number(e.data.y); if (!isFinite(y) || y < 0) return;
  window.scrollTo(0, y); requestAnimationFrame(() => window.scrollTo(0, y)); setTimeout(() => window.scrollTo(0, y), 60);
});
function scalLbStart(items, i) { scalLbStop(); scalLb = { items, i, el: 0, dur: 5000, paused: false, timer: null }; scalLbTell(true); scalLbPaint(); }
function scalLbStop() { if (scalLb && scalLb.timer) clearInterval(scalLb.timer); }
function scalLbClose() { scalLbStop(); scalLb = null; const r = document.getElementById('scalLb'); if (r) r.remove(); scalLbTell(false); }
function scalLbGo(d) {
  if (!scalLb) return;
  const n = scalLb.i + d;
  if (n < 0) return;
  if (n >= scalLb.items.length) { scalLbClose(); return; }
  scalLbStop(); scalLb.i = n; scalLb.el = 0; scalLbPaint();
}
// Attach a story's file by hand (Kate, 18 Nov 2026). Stories before 12 Nov were never copied, and Instagram gives no file for a story with copyrighted music, but the account's own
// Stories Archive still has them. In the viewer, a story with no video shows Attach video (only when the dashboard sent its numbers, so a signed-in Level 3 or higher): the file goes to
// the dashboard (trs-cal-attach), which saves it and ties it to this story, answers trs-cal-attached, and the numbers are asked again so the video plays at once.
// Download a story's file (Kate, 20 Nov 2026). The button saves what the viewer is showing: the saved video, or the picture when there is no video.
function scalDlHtml(s, st) {
  const url = (st && st.media) || s.img; if (!url) return '';
  const vid = !!(st && st.media && st.isVideo);
  return `<button type="button" class="scal-lbdl" onclick="scalSaveStory(this)"><span class="ic" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="M7 11l5 5 5-5"/><path d="M5 20h14"/></svg></span><span class="tx">Download ${vid ? 'video' : 'picture'}</span></button>`;
}
async function scalSaveStory(btn) {
  const L = scalLb, it = L && L.items[L.i]; if (!it || it.k !== 'story' || btn.disabled) return;
  const s = it.s, st = scalStatOf(s), url = (st && st.media) || s.img; if (!url) return;
  const tx = btn.querySelector('.tx'), was = tx.textContent, pad = n => String(n).padStart(2, '0');
  const name = 'tararosesalon-' + s.net + '-story-' + s.date + (s.t ? '-' + pad(s.t.h) + pad(s.t.m) : '');
  btn.disabled = true; tx.textContent = 'Saving...';
  try {
    const r = await fetch(url, { referrerPolicy: 'no-referrer' }); if (!r.ok) throw new Error('http ' + r.status);
    const b = await r.blob(), mt = (b.type || '').toLowerCase();
    const ext = /mp4/.test(mt) ? 'mp4' : /quicktime/.test(mt) ? 'mov' : /webm/.test(mt) ? 'webm' : /png/.test(mt) ? 'png' : /webp/.test(mt) ? 'webp' : /jpe?g/.test(mt) ? 'jpg' : (st && st.isVideo ? 'mp4' : 'jpg');
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name + '.' + ext; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    tx.textContent = 'Saved';
  } catch (e) {
    // The file's host will not let the page read it (a Metricool picture): open it instead, so it can be saved from there.
    const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; document.body.appendChild(a); a.click(); a.remove();
    calToast('Opened in a new tab. Right-click it and choose Save image as.');
    tx.textContent = was;
  }
  setTimeout(() => { if (btn.isConnected) { btn.disabled = false; tx.textContent = was; } }, 1800);
}
function scalAttachHtml(s, st, L) {
  if (!calEmbedded || !scal.statsOk || !st || L.video) return '';
  const a = scal.attach && scal.attach.id === s.net + '|' + s.at ? scal.attach : null;
  if (a && a.state === 'up') return '<div class="scal-lbat"><span class="scal-lbat-h">Uploading. Keep this window open.</span></div>';
  if (a && a.state === 'ok') return '<div class="scal-lbat"><span class="scal-lbat-h">Saved. Loading the video.</span></div>';
  const err = a && a.state === 'err';
  return `<div class="scal-lbat"><label class="scal-lbbtn" onclick="if(scalLb)scalLb.paused=true">Attach video<input type="file" accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp" onchange="scalAttach(this)"></label><span class="scal-lbat-h${err ? ' err' : ''}">${err ? mkEsc(a.msg) : 'From the story archive or the phone it was filmed on. MP4, MOV or WebM, up to 60 MB.'}</span></div>`;
}
// Kate, 20 Nov 2026: Attach video said "Failed to fetch". The picked File was sent to the dashboard still pointing at the file on disk, and the dashboard (another site) then had to read it
// itself. The frame now reads the bytes first and sends an in-memory copy, so nothing depends on the disk file or on this frame's file box any more.
async function scalMemFile(f) { return new Blob([await f.arrayBuffer()], { type: f.type }); }
async function scalAttach(inp) {
  const f = inp.files && inp.files[0], bytes = f ? scalMemFile(f) : null; inp.value = '';
  const L = scalLb, it = L && L.items[L.i]; if (!f || !it || it.k !== 'story') return;
  const s = it.s, st = scalStatOf(s), id = s.net + '|' + s.at;
  const fail = msg => { scal.attach = { id, state: 'err', msg }; scalLbPaint(); };
  if (!/^(video\/(mp4|quicktime|webm)|image\/(jpeg|png|webp))$/.test(f.type)) return fail('Use an MP4, MOV or WebM video, or a JPG, PNG or WebP picture.');
  if (f.size > 60 * 1024 * 1024) return fail('That file is over 60 MB. Trim or compress it first.');
  const key = ((st && st.url || '').match(/\/stories\/[^/]+\/(\d+)/) || [])[1] || null;
  scal.attach = { id, state: 'up' }; scalLbPaint();
  let blob; try { blob = await bytes; } catch (e) { return fail('That file could not be read. Copy it to the Desktop and pick it from there.'); }
  try { window.parent.postMessage({ type: 'trs-cal-attach', net: s.net, at: s.at, key, file: blob }, '*'); } catch (e) { fail('Could not send the file to the dashboard.'); }
}
function scalGotAttached(d) {
  if (scalImp && scalImp.wait && d && d.net + '|' + d.at === scalImp.wait.id) { const w = scalImp.wait; scalImp.wait = null; w.res(d); return; }
  if (!d || !scal.attach) return;
  const id = d.net + '|' + d.at;
  if (scal.attach.id !== id) return;
  if (d.ok === true) { scal.attach = { id, state: 'ok' }; scal.sasked = {}; scalAskStats(); }
  else scal.attach = { id, state: 'err', msg: typeof d.error === 'string' ? d.error.slice(0, 160) : 'Could not save it.' };
  scalLbPaint();
}
// Import many stories from an archive (Kate, 18 Nov 2026). The account's Instagram "Download your information" (JSON) lists every story with its time (stories.json: uri and creation_timestamp, in
// seconds) beside the media files. The person picks the unzipped folder; nothing leaves the browser until Import is pressed. Each file is matched to the story posted within 2 minutes of its time (the
// same window the database uses), only a story with no file yet is filled, and every file goes through the same trs-cal-attach as the single Attach video button, one at a time, with the dashboard's checks.
let scalImp = null;
const SCAL_IMP_MAX = 60 * 1024 * 1024;
const scalImpType = n => /\.(mp4|m4v)$/i.test(n) ? 'video/mp4' : /\.mov$/i.test(n) ? 'video/quicktime' : /\.webm$/i.test(n) ? 'video/webm' : /\.jpe?g$/i.test(n) ? 'image/jpeg' : /\.png$/i.test(n) ? 'image/png' : /\.webp$/i.test(n) ? 'image/webp' : '';
const scalImpDubai = ms => new Date(ms + 4 * 3600e3).toISOString();
const scalImpWhen = ms => scalImpDubai(ms).replace('T', ' ').slice(0, 16);
// A name like 1731750000.mp4 or story_1731750000123.mp4 carries its own time; used only for a file the JSON does not list.
const scalImpNameTime = n => { const m = String(n).match(/(?:^|[^0-9])(1[5-9]\d{8}|1[5-9]\d{11})(?:[^0-9]|$)/); if (!m) return null; const v = Number(m[1]); return v > 1e12 ? v : v * 1000; };
function scalImpOpen() { scalImp = { net: scal.sday ? scal.sday.net : 'instagram', step: 'pick', msg: '' }; scalLbTell(true); scalImpPaint(); }
function scalImpClose() { if (scalImp) scalImp.stop = true; scalImp = null; const r = document.getElementById('scalImp'); if (r) r.remove(); scalLbTell(false); scalPaint(); }
// Every object with a media uri and a time, wherever it sits in the JSON (the export's layout changes between versions).
function scalImpFind(node, out, depth) {
  if (!node || typeof node !== 'object' || depth > 8) return;
  if (Array.isArray(node)) { node.forEach(x => scalImpFind(x, out, depth + 1)); return; }
  const uri = typeof node.uri === 'string' ? node.uri : null;
  const t = [node.creation_timestamp, node.taken_at, node.timestamp].find(v => typeof v === 'number' && v > 1e9);
  if (uri && t && scalImpType(uri)) out.push({ uri, ms: t > 1e12 ? t : t * 1000 });
  Object.keys(node).forEach(k => { if (node[k] && typeof node[k] === 'object') scalImpFind(node[k], out, depth + 1); });
}
// Which stories a list of {file, ms} lands on: the nearest story of that network within 2 minutes; one file per story.
function scalImpMatch(entries, net) {
  const res = { ready: [], has: [], none: [], big: [], dup: [] }, claimed = new Set();
  entries.slice().sort((a, b) => a.ms - b.ms).forEach(e => {
    const m = scalImpDubai(e.ms).slice(0, 7), label = scalImpWhen(e.ms) + ' ' + e.file.name;
    let best = null, gap = 120001;
    (scalStoryCache[m] || []).forEach(s => { if (s.net !== net) return; const g = Math.abs(Date.parse(s.at) - e.ms); if (g < gap) { gap = g; best = s; } });
    if (!best) { res.none.push({ label, ms: e.ms }); return; }
    const st = scalStatOf(best);
    if (st && st.media) { res.has.push({ label, s: best }); return; }
    if (claimed.has(best.at)) { res.dup.push({ label, s: best }); return; }
    if (e.file.size > SCAL_IMP_MAX) { res.big.push({ label, size: e.file.size }); return; }
    claimed.add(best.at); res.ready.push({ label, s: best, file: e.file, ms: e.ms });
  });
  return res;
}
function scalImpStats(m) {
  return new Promise(res => {
    const from = m + '-01', to = scalMonthEnd(m); let done = false; const fin = () => { if (!done) { done = true; res(); } };
    if (scalImp) scalImp.waitStats = { from, to, res: fin };
    try { window.parent.postMessage({ type: 'trs-cal-need-stats', from, to }, '*'); } catch (e) { fin(); }
    setTimeout(fin, 15000);
  });
}
async function scalImpPick(inp) {
  const files = [...(inp.files || [])]; inp.value = ''; const I = scalImp; if (!I || !files.length) return;
  I.step = 'read'; I.msg = 'Reading ' + files.length + ' files'; scalImpPaint();
  try {
    const rel = f => (f.webkitRelativePath || f.name).replace(/\\/g, '/').toLowerCase();
    const media = files.filter(f => scalImpType(f.name)), raw = [];
    for (const f of files.filter(f => /\.json$/i.test(f.name) && /stor/i.test(f.name) && f.size < 300 * 1024 * 1024)) { try { scalImpFind(JSON.parse(await f.text()), raw, 0); } catch (e) { /* not a story list */ } }
    const entries = [], used = new Set();
    raw.forEach(r => {
      const u = r.uri.replace(/\\/g, '/').toLowerCase(), base = u.split('/').pop();
      const f = media.find(x => rel(x) === u || rel(x).endsWith('/' + u)) || media.find(x => x.name.toLowerCase() === base);
      if (f && !used.has(f)) { used.add(f); entries.push({ file: f, ms: r.ms }); }
    });
    media.filter(f => !used.has(f)).forEach(f => { const ms = scalImpNameTime(f.name); if (ms) entries.push({ file: f, ms }); });
    I.found = entries.length; I.files = files.length;
    if (!entries.length) { I.step = 'pick'; I.msg = 'No stories with a time were found in those ' + files.length + ' files. Pick the folder that holds stories.json (usually your_instagram_activity/media) or the whole unzipped download.'; scalImpPaint(); return; }
    const months = [...new Set(entries.map(e => scalImpDubai(e.ms).slice(0, 7)))].sort();
    for (let i = 0; i < months.length; i++) {
      if (scalImp !== I) return;
      I.msg = 'Matching to the calendar: ' + months[i] + ' (' + (i + 1) + ' of ' + months.length + ')'; scalImpPaint();
      try { await scalLoadStories(months[i]); } catch (e) { /* that month stays unmatched */ }
      await scalImpStats(months[i]);
    }
    if (scalImp !== I) return;
    I.res = scalImpMatch(entries, I.net); I.step = 'review'; I.msg = ''; scalImpPaint();
  } catch (e) { I.step = 'pick'; I.msg = 'Could not read those files: ' + String((e && e.message) || e).slice(0, 120); scalImpPaint(); }
}
async function scalImpRun() {
  const I = scalImp; if (!I || I.running || !I.res || !I.res.ready.length) return;
  I.running = true; I.step = 'run'; I.done = 0; I.fail = []; scalImpPaint();
  for (const it of I.res.ready) {
    if (scalImp !== I || I.stop) break;
    const st = scalStatOf(it.s), id = it.s.net + '|' + it.s.at, key = ((st && st.url || '').match(/\/stories\/[^/]+\/(\d+)/) || [])[1] || null;
    const r = await new Promise(res => {
      I.wait = { id, res }; const to = setTimeout(() => { if (I.wait && I.wait.id === id) { I.wait = null; res({ ok: false, error: 'No answer from the dashboard in 90 seconds.' }); } }, 90000);
      const fin = res; I.wait.res = x => { clearTimeout(to); fin(x); };
      scalMemFile(it.file).then(blob => { window.parent.postMessage({ type: 'trs-cal-attach', net: it.s.net, at: it.s.at, key, file: blob }, '*'); })
        .catch(() => { I.wait = null; clearTimeout(to); res({ ok: false, error: 'Could not read or send the file.' }); });
    });
    if (r && r.ok) I.done++; else I.fail.push(it.label + ': ' + ((r && r.error) || 'failed'));
    scalImpPaint();
  }
  if (scalImp !== I) return;
  I.running = false; I.step = 'done'; scal.sasked = {}; scalAskStats(); scalImpPaint();
}
function scalImpPaint() {
  const I = scalImp; if (!I) return;
  let root = document.getElementById('scalImp');
  if (!root) { root = document.createElement('div'); root.id = 'scalImp'; root.className = 'scal-imp'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Import stories from an archive'); document.body.appendChild(root); }
  const R = I.res, n = k => R ? R[k].length : 0, bar = I.step === 'run' && I.res ? Math.round(100 * (I.done + I.fail.length) / Math.max(1, R.ready.length)) : 0;
  const close = `<button type="button" class="scal-lbx scal-impx" aria-label="Close" onclick="scalImpClose()">×</button>`;
  let body = '';
  if (I.step === 'pick') body = `<h3>Import stories from an archive</h3>
    <p>Which account is the archive from?
      <label class="scal-impr"><input type="radio" name="scalImpNet" value="instagram" ${I.net === 'instagram' ? 'checked' : ''} onchange="scalImp.net='instagram'"> Instagram</label>
      <label class="scal-impr"><input type="radio" name="scalImpNet" value="facebook" ${I.net === 'facebook' ? 'checked' : ''} onchange="scalImp.net='facebook'"> Facebook</label></p>
    <p class="scal-imph">Instagram: Accounts Center, Your information and permissions, Download your information, choose Instagram, Stories only, format JSON, all time. Unzip what you get, then pick the unzipped folder here. Nothing is sent until you press Import.</p>
    ${I.msg ? `<p class="scal-imperr">${mkEsc(I.msg)}</p>` : ''}
    <label class="scal-lbbtn">Pick the folder<input type="file" webkitdirectory multiple onchange="scalImpPick(this)"></label>`;
  else if (I.step === 'read') body = `<h3>Reading the archive</h3><p>${mkEsc(I.msg)}</p>`;
  else if (I.step === 'review') {
    const rows = R.ready.slice(0, 40).map(x => `<li>${mkEsc(scalImpWhen(x.ms))} Dubai <span>${mkEsc(x.file.type || scalImpType(x.file.name))}, ${Math.max(1, Math.round(x.file.size / 1048576))} MB</span></li>`).join('');
    body = `<h3>Ready to import</h3>
      <p class="scal-impn"><b>${n('ready')}</b> ready to attach &nbsp; <span>${n('has')} already have a file</span> &nbsp; <span>${n('none')} match no story</span>${n('big') ? ` &nbsp; <span>${n('big')} over 60 MB</span>` : ''}${n('dup') ? ` &nbsp; <span>${n('dup')} second file for a story</span>` : ''}</p>
      ${rows ? `<ul class="scal-impl">${rows}${n('ready') > 40 ? `<li>and ${n('ready') - 40} more</li>` : ''}</ul>` : ''}
      <p class="scal-imph">A file goes to the story posted within 2 minutes of its time. Stories that already have a file are left alone.</p>
      <div class="scal-impa"><button type="button" class="scal-lbbtn" ${n('ready') ? '' : 'disabled'} onclick="scalImpRun()">Import ${n('ready')} file${n('ready') === 1 ? '' : 's'}</button><button type="button" class="scal-impg" onclick="scalImpClose()">Cancel</button></div>`;
  } else if (I.step === 'run') body = `<h3>Importing</h3><p>${I.done + I.fail.length} of ${R.ready.length}. Keep this window open.</p><div class="scal-impp"><i style="width:${bar}%"></i></div>${I.fail.length ? `<p class="scal-imperr">${I.fail.length} could not be saved</p>` : ''}<div class="scal-impa"><button type="button" class="scal-impg" onclick="scalImp.stop=true">Stop after this one</button></div>`;
  else body = `<h3>${I.stop ? 'Stopped' : 'Done'}</h3><p><b>${I.done}</b> story file${I.done === 1 ? '' : 's'} attached${I.fail.length ? `, ${I.fail.length} could not be saved` : ''}. Open a story to watch it.</p>
      ${I.fail.length ? `<ul class="scal-impl err">${I.fail.slice(0, 12).map(x => `<li>${mkEsc(x)}</li>`).join('')}${I.fail.length > 12 ? `<li>and ${I.fail.length - 12} more</li>` : ''}</ul>` : ''}
      <div class="scal-impa"><button type="button" class="scal-lbbtn" onclick="scalImpClose()">Close</button></div>`;
  root.innerHTML = `<div class="scal-impbox">${I.running ? '' : close}${body}</div>`;
}
document.addEventListener('keydown', e => { if (scalImp && !scalImp.running && e.key === 'Escape') { e.stopImmediatePropagation(); scalImpClose(); } }, true);
function scalLbPaint() {
  const L = scalLb; if (!L) return;
  let root = document.getElementById('scalLb');
  if (!root) { root = document.createElement('div'); root.id = 'scalLb'; root.className = 'scal-lb'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Viewer');
    root.addEventListener('click', e => { if (e.target === root) scalLbClose(); }); document.body.appendChild(root); }
  const it = L.items[L.i], cols = socCols(), last = L.items.length - 1;
  let inner = '';
  if (it.k === 'story') {
    const s = it.s, st = scalStatOf(s), c = cols[s.net], when = scalClock(s.t) + ', ' + scalShort(s.date);
    const media = st && st.media && st.isVideo ? `<video src="${mkEsc(st.media)}" autoplay playsinline controls controlsList="nodownload" referrerpolicy="no-referrer"></video>`
      : (st && st.media ? `<img src="${mkEsc(st.media)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : (s.img ? `<img src="${mkEsc(s.img)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''));
    L.video = !!(st && st.media && st.isVideo);
    const flow = scalFlowHtml(st);
    inner = `<div class="scal-lbframe story${flow ? ' hasg' : ''}" style="--c:${c};--bf:${scalBadgeFg(c)}">
      <div class="scal-lbbars">${L.items.map((_, j) => `<i class="${j < L.i ? 'done' : j === L.i ? 'cur' : ''}"><b></b></i>`).join('')}</div>
      <div class="scal-lbhd"><span class="scal-bb" aria-hidden="true">${scalIco(s.net)}</span><b>tararosesalon</b><span>${mkEsc(when)}</span></div>
      <div class="scal-lbmedia">${media}</div>
      <button type="button" class="scal-lbtap l" aria-label="Previous" onclick="scalLbGo(-1)"></button><button type="button" class="scal-lbtap r" aria-label="Next" onclick="scalLbGo(1)"></button>
      <div class="scal-lbft">${L.video ? '' : `<div class="scal-lbnote">${st && st.noFile ? 'No video for this story: it has copyrighted music (or shared content), so ' + SOC_NETS[s.net] + ' does not hand over the file, even for a business account. Only the picture is kept.' : (s.date < '2026-11-13' ? 'A picture only: this story went up before we started saving videos (13 Nov 2026), and ' + SOC_NETS[s.net] + ' only keeps a story for 24 hours.' : 'A picture only: this story was not saved as a video.')}</div>`}${st ? scalStatLines(st) : ''}${flow}${scalDlHtml(s, st)}${scalAttachHtml(s, st, L)}</div></div>`;
  } else {
    const p = it.p, e = scalEmbedUrl(p), c = cols[p.net];
    inner = `<div class="scal-lbframe post" style="--c:${c};--bf:${scalBadgeFg(c)}">
      <div class="scal-lbhd"><span class="scal-bb" aria-hidden="true">${scalIco(p.net)}</span><b>${SOC_NETS[p.net]} ${SCAL_KIND[p.kind]}</b><span>${mkEsc(scalClock(p.t))}, ${scalShort(p.date)}</span></div>
      <div class="scal-lbmedia">${e ? `<iframe src="${mkEsc(e.src)}" title="Play this ${SCAL_KIND[p.kind]}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>` : scalImg(p, false)}</div>
      <div class="scal-lbft"><div class="scal-lbcap">${scalCap(p)}</div><div>${scalStats(p)}</div>${calSafeUrl(p.url) ? `<a class="scal-slink" href="${mkEsc(calSafeUrl(p.url))}" target="_blank" rel="noopener noreferrer">Open on ${SOC_NETS[p.net]}</a>` : ''}</div></div>`;
  }
  root.innerHTML = `<button type="button" class="scal-lbx" aria-label="Close" onclick="scalLbClose()">×</button>
    <button type="button" class="scal-lbn prev" aria-label="Previous" ${L.i ? '' : 'disabled'} onclick="scalLbGo(-1)">‹</button>${inner}
    <button type="button" class="scal-lbn next" aria-label="Next" ${L.i < last ? '' : 'disabled'} onclick="scalLbGo(1)">›</button>
    <div class="scal-lbcount" aria-live="polite">${L.i + 1} of ${L.items.length}</div>`;
  if (it.k !== 'story') return;
  // Progress: a picture runs 5 seconds, a video runs its own length; hovering the frame holds it, Space holds it too.
  const bar = root.querySelector('.scal-lbbars i.cur b'), v = root.querySelector('video'), frame = root.querySelector('.scal-lbframe');
  if (v) { v.ontimeupdate = () => { if (bar && v.duration) bar.style.width = (100 * v.currentTime / v.duration) + '%'; }; v.onended = () => scalLbGo(1); return; }
  frame.onmouseenter = () => { L.paused = true; }; frame.onmouseleave = () => { L.paused = false; };
  L.timer = setInterval(() => { if (L.paused || (scal.attach && scal.attach.state === 'up')) return; L.el += 50; if (bar) bar.style.width = Math.min(100, 100 * L.el / L.dur) + '%'; if (L.el >= L.dur) scalLbGo(1); }, 50);
}
document.addEventListener('keydown', e => {
  if (!scalLb) return;
  if (e.key === 'Escape') { e.stopImmediatePropagation(); scalLbClose(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); scalLbGo(1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); scalLbGo(-1); }
  else if (e.key === ' ' && !scalLb.video) { e.preventDefault(); scalLb.paused = !scalLb.paused; }
}, true);
document.addEventListener('dblclick', e => {
  const root = document.getElementById('scalRoot'); if (!root || scalLb) return;
  const sc = e.target.closest('[data-s]');
  if (sc && root.contains(sc)) { e.preventDefault(); scalLbOpenStory(sc.dataset.s); return; }
  const pc = e.target.closest('[data-id]');
  if (pc && root.contains(pc)) { const p = scalFind(pc.dataset.id); if (p) { e.preventDefault(); scalLbOpenPost(p); } }
});
function scalStoryOpen(date, net, at) { scal.sel = null; scal.sday = { date, net, at: at || '' }; scal.focusPanel = true; scalPaint(); }
function scalStoryPanelHtml(cols) {
  const { date, net } = scal.sday, list = scalStoriesOf(date, net).slice().sort((a, b) => (a.at || '') < (b.at || '') ? -1 : 1);
  const tiles = list.map(s => scalStoryCard(s, cols)).join('');
  return `<aside class="scal-panel" role="dialog" aria-label="Stories" style="--c:${cols[net]};--bf:${scalBadgeFg(cols[net])}">
    <div class="scal-ph"><span class="scal-b" aria-hidden="true">${scalIco(net)}</span>
      <div class="when"><b>${scalLong(date)}</b><span>${SOC_NETS[net]} stories, ${list.length} ${scalSrcBadge({ source: 'manual' })}</span></div>
      <button type="button" class="scal-icon scal-close" aria-label="Close" onclick="scalClose()">×</button></div>
    <div class="scal-pb">${list.length ? scalStoryTotals(list) + `<div class="scal-sgrid${scal.statsOk ? ' row' : ''}">${tiles}</div>` : '<div class="scal-empty">No stories this day.</div>'}
      ${scalStoryCaption()}${scal.statsOk && calEmbedded ? '<p><button type="button" class="scal-impbtn" onclick="scalImpOpen()">Import many from an archive</button></p>' : ''}</div><div class="scal-cue" aria-hidden="true"><span>Scroll for more</span></div></aside><div class="scal-scrim" onclick="scalScrimClick(event)"></div>`;
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
  const head = ['Date', 'Time (Dubai)', 'Platform', 'Type', 'Caption', 'Likes', 'Comments', 'Reposts or shares', 'Plays (reels and videos)', 'Posted how', 'Link'];
  const rows = posts.map(p => [p.date, scalClock(p.t) || '', SOC_NETS[p.net], SCAL_KIND[p.kind], p.cap.replace(/\s+/g, ' ').slice(0, 300), p.likes, p.comments, p.reposts, p.views, p.source === 'manual' ? 'Manual' : p.source === 'metricool' ? 'Scheduled in Metricool' : '', calSafeUrl(p.url)]);
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
