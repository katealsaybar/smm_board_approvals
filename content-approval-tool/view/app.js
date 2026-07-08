/* ===================== CONFIG ===================== */
const SUPABASE_URL = 'https://qyojrknmgwkfjrdhtxhk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_rsz9t8fPuF_leH5KwRUeKA__ZiwO9CP';
const CLOUDINARY_CLOUD_NAME = 'dj7chrw4z'; // same account ../upload/upload.html uses
const CLOUDINARY_UPLOAD_PRESET = 'b0pb9erf'; // unsigned upload preset name
const GROQ_API_KEY = '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'; // enables voice-note transcription
const GROQ_MODEL = 'whisper-large-v3-turbo';
/* NOTE on GROQ_API_KEY: this is a static page with no backend, so calling Groq
   directly from the browser means anyone who views source can read the key.
   Acceptable for a small trusted-team dry run; once Supabase Edge Functions are
   in use, move this call server-side so the key never reaches the browser.
   Also: microphone recording (getUserMedia) needs a secure context — opening
   this file directly as file:// may block mic access in some browsers, so
   serve it locally (e.g. `npx serve`) or host it to test recording. */

/* Supabase schema lives in ../supabase-schema.sql (run once in the SQL Editor for
   this project). Publishable key is safe to ship in client code by design —
   RLS now requires a signed-in, allowlisted Google account (see ALLOWED_REVIEWERS
   below and the matching policies in supabase-schema.sql). */
const sb = (SUPABASE_URL && SUPABASE_ANON_KEY)
  ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const REVIEWERS = ['Jules', 'Kate', 'Coach Emma', 'Tara'];
const REVIEWER_INITIALS = { 'Jules':'J', 'Kate':'K', 'Coach Emma':'E', 'Tara':'T' };
const FINAL_SAY = 'Tara'; // matches existing SMM approval doctrine: Tara's decision is final

// Identity now comes from Google Sign-In, not a manual dropdown — this is the
// only mapping between "who's logged in" and "which reviewer name to attach".
const ALLOWED_REVIEWERS = {
  'kate@tararosesalon.com': 'Kate',
  'socials@tararosesalon.com': 'Jules',
  'tara@tararosesalon.com': 'Tara',
  'emma-louise@tararosesalon.com': 'Coach Emma'
};

const CATEGORY_LABELS = {
  transformation:'Transformation', education:'Education', bts:'BTS & Culture',
  clientstories:'Client Stories', foundersvoice:"Founder's Voice"
};
const CATEGORY_CLASS = {
  transformation:'cat-transformation', education:'cat-education', bts:'cat-bts',
  clientstories:'cat-clientstories', foundersvoice:'cat-foundersvoice'
};

const STATUS_LABELS = {
  draft:'Draft', forreview:'For Review', approved:'Approved',
  forrevision:'For Revision', uploaded:'Uploaded'
};

/* ===================== SAMPLE DATA (dry run only) =====================
   Used only when Supabase isn't configured (SUPABASE_URL/KEY null).
   Using Cloudinary's public demo assets so video/photo previews actually play. */
const SAMPLE = {
  batches: [
    {
      id:'batch-1',
      name:'Batch 1 — July 2026 Reels & Stories',
      items:[
        {
          id:'item-1', category:'transformation', format:'reel',
          revisions:[
            { revisionNumber:1, mediaType:'video',
              mediaUrl:'https://res.cloudinary.com/demo/video/upload/dog.mp4',
              caption:'From flat to full 💫 3-visit transformation, Khalifa City A branch. #TaraRoseSalon',
              reviews:[] }
          ]
        },
        {
          id:'item-2', category:'education', format:'story',
          revisions:[
            { revisionNumber:1, mediaType:'image',
              mediaUrl:'https://res.cloudinary.com/demo/image/upload/sample.jpg',
              caption:'Swipe up: why your hair feels "dirty" when it\'s actually just coated 👆',
              reviews:[{reviewer:'Coach Emma', decision:'revision', comment:'Can we soften the opening line? Feels a bit clinical for a Story.', date:'2026-07-06T10:12:00'}] }
          ]
        },
        {
          id:'item-3', category:'clientstories', format:'static',
          revisions:[
            { revisionNumber:1, mediaType:'image',
              mediaUrl:'https://res.cloudinary.com/demo/image/upload/sample.jpg',
              caption:'"I finally trust someone with my colour." — real client, real result. Motor City branch.',
              reviews:[
                {reviewer:'Coach Emma', decision:'approved', comment:'Love this one.', date:'2026-07-06T09:00:00'},
                {reviewer:'Tara', decision:'approved', comment:'Beautiful, go ahead.', date:'2026-07-06T14:30:00'}
              ] }
          ]
        },
        {
          id:'item-4', category:'bts', format:'carousel',
          revisions:[
            { revisionNumber:1, mediaType:'carousel',
              media:[
                { type:'image', url:'https://res.cloudinary.com/demo/image/upload/sample.jpg' },
                { type:'video', url:'https://res.cloudinary.com/demo/video/upload/dog.mp4' },
                { type:'image', url:'https://res.cloudinary.com/demo/image/upload/sample.jpg' }
              ],
              caption:'A day at Saadiyat branch, behind the chair 💇‍♀️ swipe for the full transformation.',
              reviews:[] }
          ]
        }
      ]
    }
  ]
};

/* ===================== STATE ===================== */
async function loadState(){
  if (!sb){
    const saved = localStorage.getItem('trs_content_approval_state');
    return saved ? JSON.parse(saved) : JSON.parse(JSON.stringify(SAMPLE));
  }
  const [{ data: batches }, { data: items }, { data: revisions }, { data: reviews }] = await Promise.all([
    sb.from('batches').select('*').order('created_at'),
    sb.from('content_items').select('*').order('created_at'),
    sb.from('revisions').select('*').order('revision_number'),
    sb.from('reviews').select('*').order('created_at')
  ]);
  const batchNameById = Object.fromEntries((batches || []).map(b => [b.id, b.name]));

  return {
    batches: (batches || []).map(b => ({
      id: b.id,
      name: b.name,
      items: (items || []).filter(i => i.batch_id === b.id).map(i => ({
        id: i.id,
        category: i.category,
        format: i.format,
        revisions: (revisions || []).filter(r => r.content_item_id === i.id).map(r => ({
          id: r.id,
          revisionNumber: r.revision_number,
          mediaType: r.media_type,
          mediaUrl: r.media_url,
          media: r.media,
          caption: r.caption,
          smmNotes: r.smm_notes,
          movedFromBatchName: r.moved_from_batch_id ? (batchNameById[r.moved_from_batch_id] || 'Unknown batch') : null,
          movedToBatchName: r.moved_to_batch_id ? (batchNameById[r.moved_to_batch_id] || 'Unknown batch') : null,
          reviews: (reviews || []).filter(rv => rv.revision_id === r.id).map(rv => ({
            reviewer: rv.reviewer,
            decision: rv.decision,
            comment: rv.comment,
            voiceNote: rv.voice_note_url ? { dataUrl: rv.voice_note_url, transcript: rv.voice_note_transcript } : null,
            date: rv.created_at
          }))
        }))
      }))
    }))
  };
}
function saveState(){
  // Only used in the localStorage fallback path (no Supabase configured).
  localStorage.setItem('trs_content_approval_state', JSON.stringify(state));
}
async function refreshState(){ state = await loadState(); }
let state = { batches: [] };
const selectedItems = new Set();

/* ===================== AUTH (temporarily open — manual picker) =====================
   Google Sign-In is paused per Tara's call to consolidate on Metricool instead of a
   custom approval system. Reviewer identity is a plain local picker until then. */
let currentReviewer = localStorage.getItem('trs_reviewer') || '';

function getReviewer(){ return currentReviewer; }

const authGate = document.getElementById('authGate');
const appShell = document.getElementById('appShell');
const authPanel = document.getElementById('authPanel');

function renderAuthPanel(){
  const needsPick = !currentReviewer;
  authPanel.innerHTML = `
    ${needsPick ? '<span class="pick-name-nudge">👆 Pick your name!</span>' : ''}
    <select id="reviewerSelect" class="${needsPick ? 'needs-pick' : ''}">
      <option value="">Who are you?</option>
      ${REVIEWERS.map(r => `<option value="${r}" ${r === currentReviewer ? 'selected' : ''}>${r}</option>`).join('')}
    </select>`;
  document.getElementById('reviewerSelect').addEventListener('change', (e)=>{
    currentReviewer = e.target.value;
    localStorage.setItem('trs_reviewer', currentReviewer);
    renderAuthPanel();
    render();
  });
}

async function refreshAuthGate(){
  authGate.style.display = 'none';
  appShell.style.display = '';
  renderAuthPanel();
  return true;
}

let currentView = localStorage.getItem('trs_view_mode') || 'grid'; // 'grid' | 'list' | 'scroll'
function setView(view){
  currentView = view;
  localStorage.setItem('trs_view_mode', view);
  render();
}
function populateViewSwitcher(){
  document.querySelectorAll('.view-btn').forEach(b=>{
    b.classList.toggle('active', b.dataset.view === currentView);
  });
}
document.querySelectorAll('.view-btn').forEach(b=>{
  b.addEventListener('click', ()=> setView(b.dataset.view));
});

let igTheme = localStorage.getItem('trs_ig_theme') || 'light'; // 'light' | 'dark' — Instagram's own light/dark mode
function toggleIgTheme(){
  igTheme = igTheme === 'light' ? 'dark' : 'light';
  localStorage.setItem('trs_ig_theme', igTheme);
  render();
}
function igDarkClass(){ return igTheme === 'dark' ? 'ig-dark' : ''; }
function updateIgThemeButton(){
  const btn = document.getElementById('igThemeToggle');
  if (!btn) return;
  btn.textContent = igTheme === 'light' ? '🌙 IG Dark' : '☀️ IG Light';
}
document.getElementById('igThemeToggle').addEventListener('click', toggleIgTheme);

/* ===================== RENDER ===================== */
const main = document.getElementById('main');

function latestRevision(item){ return item.revisions[item.revisions.length-1]; }

function itemStatus(item){
  const rev = latestRevision(item);
  if (!rev.reviews.length) return 'forreview';
  const tara = [...rev.reviews].reverse().find(r=>r.reviewer===FINAL_SAY);
  if (tara) return tara.decision === 'approved' ? 'approved' : 'forrevision';
  const anyRevision = rev.reviews.some(r=>r.decision==='revision');
  if (anyRevision) return 'forrevision';
  const anyApproved = rev.reviews.some(r=>r.decision==='approved');
  return anyApproved ? 'approved' : 'forreview';
}

function verdictFor(item, reviewer){
  const rev = latestRevision(item);
  const entries = rev.reviews.filter(r=>r.reviewer===reviewer);
  if (!entries.length) return 'pending';
  return entries[entries.length-1].decision;
}

function getMediaList(rev){
  if (Array.isArray(rev.media) && rev.media.length) return rev.media;
  return [{ type: rev.mediaType, url: rev.mediaUrl }];
}

// Diffs the latest revision against the one before it so reviewers can see exactly
// what changed on a resubmission, instead of re-checking every slide from scratch.
function changedSlideIndices(item){
  if (item.revisions.length < 2) return new Set();
  const prevMedia = getMediaList(item.revisions[item.revisions.length - 2]);
  const currMedia = getMediaList(item.revisions[item.revisions.length - 1]);
  const changed = new Set();
  for (let i = 0; i < Math.max(prevMedia.length, currMedia.length); i++){
    if (!prevMedia[i] || !currMedia[i] || prevMedia[i].url !== currMedia[i].url) changed.add(i);
  }
  return changed;
}

function captionChanged(item){
  if (item.revisions.length < 2) return false;
  const prev = item.revisions[item.revisions.length - 2];
  const curr = item.revisions[item.revisions.length - 1];
  return (prev.caption || '').trim() !== (curr.caption || '').trim();
}

function captionBadge(item){
  return captionChanged(item) ? ' <span class="updated-pill inline">Edited</span>' : '';
}

// Long captions get clamped to 2 lines with a real-IG-style "more"/"less" toggle
// instead of stretching the card to fit the whole thing.
function captionHtml(item, rev){
  const text = escapeHtml(rev.caption) + captionBadge(item);
  if (!rev.caption || rev.caption.length <= 80) return text;
  return `<span class="ig-caption-text clamped">${text}</span><span class="caption-more" onclick="toggleCaptionClamp(this)"> more</span>`;
}
function toggleCaptionClamp(el){
  const span = el.previousElementSibling;
  const clamped = span.classList.toggle('clamped');
  el.textContent = clamped ? ' more' : ' less';
}

// Phone-recorded .mov/HEVC files often play audio but show a black frame in
// Chrome (no decode support) — request Cloudinary's transcoded mp4 instead,
// which it generates on the fly regardless of the originally uploaded format.
function toWebVideoUrl(url){
  if (typeof url === 'string' && url.includes('res.cloudinary.com') && /\.(mov|avi|mkv|wmv)$/i.test(url)){
    return url.replace(/\.(mov|avi|mkv|wmv)$/i, '.mp4');
  }
  return url;
}

// Autoplay requires muted, so every review preview starts silent like a real IG
// Reel/Story would. Native controls give play/pause, seek, and unmute in one
// standard bar instead of a custom tap-to-unmute hint.
function videoTag(url, cls=''){
  url = toWebVideoUrl(url);
  return `<video class="${cls}" src="${url}" muted loop autoplay playsinline controls></video>`;
}

function renderIgMock(item, rev, format){
  const mediaTag = rev.mediaType === 'video'
    ? videoTag(rev.mediaUrl)
    : `<img src="${rev.mediaUrl}" alt="">`;

  if (format === 'carousel'){
    const mediaList = getMediaList(rev);
    const idx = carouselIndex[item.id] || 0;
    const current = mediaList[idx] || mediaList[0];
    const changed = changedSlideIndices(item);
    const isChangedSlide = changed.has(idx);
    const slideTag = current.type === 'video'
      ? videoTag(current.url, 'ig-media')
      : `<img class="ig-media" src="${current.url}" alt="">`;
    const dots = mediaList.map((_,i)=>`<span class="ig-carousel-dot ${i===idx?'active':''} ${changed.has(i)?'dot-updated':''}"></span>`).join('');
    return `
      <div class="ig-phone" id="carousel-${item.id}"><div class="ig-post ${igDarkClass()}">
        <div class="ig-post-header">
          <div class="ig-avatar"></div>
          <span class="ig-username">tararosesalon</span>
          <span class="dots">⋯</span>
        </div>
        <div class="ig-carousel-media">
          ${mediaList.length > 1 ? `<button class="ig-carousel-arrow left" onclick="carouselSlide('${item.id}',-1)">‹</button>` : ''}
          <div class="carousel-slide-wrap ${isChangedSlide ? 'slide-updated' : ''}">
            ${isChangedSlide ? '<span class="updated-pill">Updated</span>' : ''}
            ${slideTag}
          </div>
          ${mediaList.length > 1 ? `<button class="ig-carousel-arrow right" onclick="carouselSlide('${item.id}',1)">›</button>` : ''}
          ${mediaList.length > 1 ? `<div class="ig-carousel-counter">${idx+1}/${mediaList.length}</div>` : ''}
        </div>
        ${mediaList.length > 1 ? `<div class="ig-carousel-dots">${dots}</div>` : ''}
        <div class="ig-icons-row">❤️ 💬 ✈️<span class="spacer"></span>🔖</div>
        <div class="ig-likes">1,284 likes</div>
        <div class="ig-caption"><b>tararosesalon</b> ${captionHtml(item, rev)}</div>
        <div class="ig-viewcomments">View all 42 comments</div>
      </div></div>`;
  }

  if (format === 'reel'){
    return `
      <div class="ig-phone"><div class="ig-reel">
        ${mediaTag}
        <div class="ig-reel-top">
          <div class="ig-avatar" style="width:22px;height:22px;"></div>
          <span class="ig-username">tararosesalon</span>
          <span class="ig-follow">Follow</span>
        </div>
        <div class="ig-reel-bottom">${captionHtml(item, rev)}<br><span style="opacity:.8;">♪ original audio — tararosesalon</span></div>
        <div class="ig-reel-rail">
          <div>❤️<div class="count">2.4k</div></div>
          <div>💬<div class="count">184</div></div>
          <div>✈️<div class="count">Share</div></div>
          <div>⋯</div>
        </div>
      </div></div>`;
  }
  if (format === 'story'){
    return `
      <div class="ig-phone"><div class="ig-story">
        ${mediaTag}
        <div class="ig-story-bars"><div class="active"></div><div></div><div></div></div>
        <div class="ig-story-head">
          <div class="ig-avatar" style="width:24px;height:24px;"></div>
          <span class="ig-username">tararosesalon</span>
          <span class="time">2h</span>
        </div>
        <div class="ig-story-reply">Send message</div>
      </div></div>`;
  }
  // static -> feed post
  return `
    <div class="ig-phone"><div class="ig-post ${igDarkClass()}">
      <div class="ig-post-header">
        <div class="ig-avatar"></div>
        <span class="ig-username">tararosesalon</span>
        <span class="dots">⋯</span>
      </div>
      ${rev.mediaType === 'video' ? videoTag(rev.mediaUrl, 'ig-media') : `<img class="ig-media" src="${rev.mediaUrl}" alt="">`}
      <div class="ig-icons-row">❤️ 💬 ✈️<span class="spacer"></span>🔖</div>
      <div class="ig-likes">1,284 likes</div>
      <div class="ig-caption"><b>tararosesalon</b>${escapeHtml(rev.caption)}${captionBadge(item)}</div>
      <div class="ig-viewcomments">View all 42 comments</div>
    </div></div>`;
}

function escapeHtml(str){
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function timeAgo(iso){
  const d = new Date(iso);
  return d.toLocaleDateString(undefined,{month:'short',day:'numeric'}) + ' · ' +
         d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
}

function renderThread(rev){
  if (!rev.reviews.length) return `<div class="thread"><div class="thread-item" style="color:var(--dim);">No feedback yet.</div></div>`;
  return `<div class="thread">` + rev.reviews.map(r=>`
    <div class="thread-item decision-${r.decision}">
      <span class="who">${r.reviewer}${r.reviewer===FINAL_SAY?' ⭐':''}</span>
      ${r.decision==='approved' ? '✅ approved' : '❌ requested revision'}
      ${r.comment ? ' — ' + escapeHtml(r.comment) : ''}
      <span class="thread-time">${timeAgo(r.date)}</span>
      ${renderVoiceNote(r.voiceNote)}
    </div>`).join('') + `</div>`;
}

function renderVoiceNote(voiceNote){
  if (!voiceNote || !voiceNote.dataUrl) return '';
  return `
    <div class="voice-note">
      <audio controls src="${voiceNote.dataUrl}"></audio>
      ${voiceNote.transcript
        ? `<span class="voice-transcript-toggle" onclick="this.nextElementSibling.classList.toggle('open')">View transcript</span>
           <div class="voice-transcript">${escapeHtml(voiceNote.transcript)}</div>`
        : `<div class="vp-status">No transcript available.</div>`}
    </div>`;
}

function renderRevisionHistory(item){
  if (item.revisions.length < 2) return '';
  const older = item.revisions.slice(0, -1);
  return `
    <span class="rev-history-toggle" onclick="this.nextElementSibling.classList.toggle('open')">
      Revision history (${older.length})
    </span>
    <div class="rev-history">
      ${older.map(r=>{
        const moveNote = r.movedFromBatchName ? ` · moved ${escapeHtml(r.movedFromBatchName)} → ${escapeHtml(r.movedToBatchName)}` : '';
        return `<div>v${r.revisionNumber}: ${escapeHtml(r.caption).slice(0,60)}${r.caption.length>60?'…':''} — ${r.reviews.map(rv=>`${rv.reviewer} ${rv.decision==='approved'?'✅':'❌'}`).join(', ') || 'no feedback'}${moveNote}</div>`;
      }).join('')}
    </div>`;
}

function renderSmmNotesBox(rev){
  if (!rev.smmNotes && !rev.movedFromBatchName) return '';
  return `
    <div class="smm-notes">
      ${rev.movedFromBatchName ? `<div class="smm-notes-move">↪ Moved from <b>${escapeHtml(rev.movedFromBatchName)}</b> → <b>${escapeHtml(rev.movedToBatchName)}</b></div>` : ''}
      ${rev.smmNotes ? `<div class="smm-notes-label">SMM's Notes</div><div class="smm-notes-text">${escapeHtml(rev.smmNotes)}</div>` : ''}
    </div>`;
}

function verdictChipsHtml(item){
  return REVIEWERS.map(name=>{
    const v = verdictFor(item, name);
    const cls = v==='pending' ? 'v-pending' : (v==='approved' ? 'v-approved' : 'v-revision');
    const final = name===FINAL_SAY ? 'v-final' : '';
    return `<div class="verdict-chip ${cls} ${final}" title="${name}: ${v}">${REVIEWER_INITIALS[name]}</div>`;
  }).join('');
}

function renderItemDetailBody(item){
  const rev = latestRevision(item);

  return `
    <div class="ig-wrap">${renderIgMock(item, rev, item.format)}</div>
    <div class="review-panel">
      <div class="verdicts">${verdictChipsHtml(item)}</div>
      ${renderRevisionHistory(item)}
      ${renderSmmNotesBox(rev)}
      ${renderThread(rev)}
      <div class="review-actions">
        <textarea placeholder="Add a comment (optional for approve, encouraged for revision)..."></textarea>
        <div class="btn-row">
          <button class="btn btn-approve" onclick="handleDecision('${item.id}','approved',this)">✅ Approve</button>
          <button class="btn btn-revision" onclick="handleDecision('${item.id}','revision',this)">❌ Request Revision</button>
          <button class="btn btn-record" id="rec-btn-${item.id}" onclick="toggleRecording('${item.id}', this)" title="Record a voice note">🎙️</button>
        </div>
        <div class="voice-pending" id="voice-pending-${item.id}"></div>
      </div>
    </div>`;
}

function renderItem(item){
  const rev = latestRevision(item);
  const status = itemStatus(item);

  return `
    <div class="item-card" data-item="${item.id}">
      <div class="item-meta-row">
        <input type="checkbox" class="item-select" data-item="${item.id}" ${selectedItems.has(item.id) ? 'checked' : ''} onclick="toggleItemSelect('${item.id}')">
        <span class="category-chip ${CATEGORY_CLASS[item.category]}">${CATEGORY_LABELS[item.category]}</span>
        <span class="format-badge">IG ${item.format}</span>
        <span class="rev-badge">v${rev.revisionNumber}</span>
        <span class="status-pill status-${status}">${STATUS_LABELS[status]}</span>
        <button class="btn-delete" title="Delete this item" onclick="deleteItem('${item.id}', event)">🗑</button>
      </div>
      ${renderItemDetailBody(item)}
    </div>`;
}

const carouselIndex = {}; // itemId -> current slide index

function carouselSlide(itemId, delta){
  const item = findItem(itemId);
  const rev = latestRevision(item);
  const mediaList = getMediaList(rev);
  const changed = changedSlideIndices(item);
  const next = ((carouselIndex[itemId] || 0) + delta + mediaList.length) % mediaList.length;
  carouselIndex[itemId] = next;

  const wrap = document.getElementById(`carousel-${itemId}`);
  if (!wrap) return;
  const current = mediaList[next];
  const isChangedSlide = changed.has(next);
  const slideWrap = wrap.querySelector('.carousel-slide-wrap');
  if (slideWrap){
    slideWrap.classList.toggle('slide-updated', isChangedSlide);
    const mediaTag = current.type === 'video'
      ? videoTag(current.url, 'ig-media')
      : `<img class="ig-media" src="${current.url}" alt="">`;
    slideWrap.innerHTML = (isChangedSlide ? '<span class="updated-pill">Updated</span>' : '') + mediaTag;
  }
  wrap.querySelectorAll('.ig-carousel-dot').forEach((d,i)=> {
    d.classList.toggle('active', i===next);
    d.classList.toggle('dot-updated', changed.has(i));
  });
  const counter = wrap.querySelector('.ig-carousel-counter');
  if (counter) counter.textContent = `${next+1}/${mediaList.length}`;
}

function renderItemRow(item){
  const rev = latestRevision(item);
  const status = itemStatus(item);
  const thumbMedia = getMediaList(rev)[0];
  const thumb = thumbMedia.type === 'video'
    ? `<video src="${toWebVideoUrl(thumbMedia.url)}" muted></video>`
    : `<img src="${thumbMedia.url}" alt="">`;

  return `
    <div class="item-row" data-item="${item.id}">
      <div class="item-row-head" onclick="toggleItemRow('${item.id}')">
        <input type="checkbox" class="item-select" data-item="${item.id}" ${selectedItems.has(item.id) ? 'checked' : ''} onclick="event.stopPropagation(); toggleItemSelect('${item.id}')">
        <div class="item-row-thumb">${thumb}</div>
        <div class="item-row-body">
          <div class="item-row-top">
            <span class="format-badge">IG ${item.format}</span>
            <span class="rev-badge">v${rev.revisionNumber}</span>
            <span class="status-pill status-${status}">${STATUS_LABELS[status]}</span>
          </div>
          <div class="item-row-caption">${escapeHtml(rev.caption).slice(0,90)}${rev.caption.length>90?'…':''}</div>
          <div class="verdicts">${verdictChipsHtml(item)}</div>
        </div>
        <button class="btn-delete" title="Delete this item" onclick="deleteItem('${item.id}', event)">🗑</button>
        <span class="chevron">▾</span>
      </div>
      <div class="item-row-detail">${renderItemDetailBody(item)}</div>
    </div>`;
}

function toggleItemRow(id){
  const el = document.querySelector(`.item-row[data-item="${id}"]`);
  el.classList.toggle('expanded');
}

function batchProgress(batch){
  const total = batch.items.length;
  const approved = batch.items.filter(i=>itemStatus(i)==='approved').length;
  const revision = batch.items.filter(i=>itemStatus(i)==='forrevision').length;
  const pending = total - approved - revision;
  return {total, approved, revision, pending};
}

function renderBatch(batch){
  const p = batchProgress(batch);
  const itemRenderer = currentView === 'list' ? renderItemRow : renderItem;

  // Grid view: one flat multi-column grid across all categories (so items actually
  // sit side by side) — each card carries its own category chip instead of a header.
  // List/scroll views keep the category-grouped sections since those read top-to-bottom.
  let bodyHtml;
  if (currentView === 'grid'){
    bodyHtml = `<div class="items-grid view-grid">${batch.items.map(itemRenderer).join('')}</div>`;
  } else {
    const byCategory = {};
    batch.items.forEach(it=>{
      byCategory[it.category] = byCategory[it.category] || [];
      byCategory[it.category].push(it);
    });
    bodyHtml = Object.keys(byCategory).map(cat=>`
      <div class="category">
        <span class="category-tag ${CATEGORY_CLASS[cat]}">${CATEGORY_LABELS[cat]}</span>
        <div class="items-grid view-${currentView}">
          ${byCategory[cat].map(itemRenderer).join('')}
        </div>
      </div>`).join('');
  }

  return `
    <div class="batch" data-batch="${batch.id}">
      <div class="batch-head" onclick="toggleBatch('${batch.id}')">
        <div>
          <h2>${escapeHtml(batch.name)}</h2>
          <div class="sub">${p.total} item${p.total===1?'':'s'} in this batch</div>
        </div>
        <div class="batch-progress">
          <span><b>${p.approved}</b> approved</span>
          <span><b>${p.revision}</b> needs revision</span>
          <span><b>${p.pending}</b> pending</span>
          <button class="btn-delete" title="Delete this whole batch" onclick="deleteBatch('${batch.id}', event)">🗑</button>
          <span class="chevron">▾</span>
        </div>
      </div>
      <div class="batch-body">
        ${batch.items.length ? bodyHtml : '<div class="empty">Nothing in this batch yet. Use "+ Add Content" to add the first item.</div>'}
      </div>
    </div>`;
}

function render(){
  if (!state.batches.length){
    main.innerHTML = `<div class="empty">No batches yet. Create one to start reviewing.</div>`;
  } else {
    main.innerHTML = state.batches.map(renderBatch).join('');
  }
  populateModalBatchSelect();
  populateViewSwitcher();
  updateIgThemeButton();
  updateBulkBar();
}

function allItemIds(){
  return state.batches.flatMap(b => b.items.map(i => i.id));
}

function updateBulkBar(){
  const btn = document.getElementById('deleteSelectedBtn');
  const selectAll = document.getElementById('selectAllCheckbox');
  if (!btn) return;
  // Prune stale ids so a batch-level or single delete elsewhere doesn't leave
  // the count/checkbox out of sync with what's actually on screen.
  const validIds = new Set(allItemIds());
  Array.from(selectedItems).forEach(id => { if (!validIds.has(id)) selectedItems.delete(id); });
  btn.textContent = `🗑 Delete selected (${selectedItems.size})`;
  btn.disabled = selectedItems.size === 0;
  const ids = allItemIds();
  if (selectAll) selectAll.checked = ids.length > 0 && ids.every(id => selectedItems.has(id));
}

function toggleItemSelect(itemId){
  if (selectedItems.has(itemId)) selectedItems.delete(itemId);
  else selectedItems.add(itemId);
  updateBulkBar();
}

function handleSelectAllToggle(checked){
  const ids = allItemIds();
  if (checked) ids.forEach(id => selectedItems.add(id));
  else selectedItems.clear();
  document.querySelectorAll('.item-select').forEach(cb => { cb.checked = checked; });
  updateBulkBar();
}

async function deleteSelectedItems(){
  if (!selectedItems.size) return;
  if (!confirm(`Delete ${selectedItems.size} selected item(s) for everyone? This cannot be undone.`)) return;
  const ids = Array.from(selectedItems);
  if (sb){
    await sb.from('content_items').delete().in('id', ids);
    await refreshState();
  } else {
    state.batches.forEach(b => { b.items = b.items.filter(i => !selectedItems.has(i.id)); });
  }
  selectedItems.clear();
  render();
}

/* ===================== INTERACTIONS ===================== */
function toggleBatch(id){
  const el = document.querySelector(`.batch[data-batch="${id}"]`);
  el.classList.toggle('collapsed');
}

function findItem(id){
  for (const b of state.batches){
    const item = b.items.find(i=>i.id===id);
    if (item) return item;
  }
  return null;
}

async function deleteItem(itemId, event){
  if (event) event.stopPropagation();
  if (!confirm('Delete this item for everyone? This cannot be undone.')) return;
  selectedItems.delete(itemId);
  if (sb){
    await sb.from('content_items').delete().eq('id', itemId);
    await refreshState();
  } else {
    state.batches.forEach(b => { b.items = b.items.filter(i => i.id !== itemId); });
  }
  render();
}

async function deleteBatch(batchId, event){
  if (event) event.stopPropagation();
  if (!confirm('Delete this whole batch and everything in it? This cannot be undone.')) return;
  if (sb){
    await sb.from('batches').delete().eq('id', batchId);
    await refreshState();
  } else {
    state.batches = state.batches.filter(b => b.id !== batchId);
  }
  render();
}

async function handleDecision(itemId, decision, btn){
  const reviewer = getReviewer();
  if (!reviewer){
    alert('Pick your name from the dropdown at the top first! 👆');
    document.getElementById('reviewerSelect')?.focus();
    return;
  }
  const item = findItem(itemId);
  const rev = latestRevision(item);
  const textarea = btn.closest('.review-actions').querySelector('textarea');
  const comment = textarea.value.trim();
  const voiceNote = pendingVoiceNotes[itemId] || null;

  if (sb){
    await sb.from('reviews').insert({
      revision_id: rev.id,
      reviewer, decision, comment,
      voice_note_url: voiceNote ? voiceNote.dataUrl : null,
      voice_note_transcript: voiceNote ? voiceNote.transcript : null
    });
    delete pendingVoiceNotes[itemId];
    await refreshState();
  } else {
    rev.reviews.push({ reviewer, decision, comment, voiceNote, date: new Date().toISOString() });
    delete pendingVoiceNotes[itemId];
    saveState();
  }
  render();
}

/* ===================== VOICE NOTES ===================== */
let activeRecorder = null; // { itemId, mediaRecorder, stream }
const pendingVoiceNotes = {}; // itemId -> { dataUrl, mimeType, transcript }

async function toggleRecording(itemId, btn){
  if (activeRecorder && activeRecorder.itemId === itemId){
    activeRecorder.mediaRecorder.stop();
    return;
  }
  if (activeRecorder){ alert('Finish the recording already in progress first.'); return; }

  let stream;
  try{
    stream = await navigator.mediaDevices.getUserMedia({ audio:true });
  }catch(err){
    alert('Could not access microphone: ' + err.message);
    return;
  }

  const mediaRecorder = new MediaRecorder(stream);
  const chunks = [];
  mediaRecorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  mediaRecorder.onstop = () => {
    stream.getTracks().forEach(t=>t.stop());
    const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
    activeRecorder = null;
    btn.textContent = '🎙️';
    btn.classList.remove('recording');
    handleVoiceNoteRecorded(itemId, blob);
  };

  activeRecorder = { itemId, mediaRecorder, stream };
  mediaRecorder.start();
  btn.textContent = '⏹';
  btn.classList.add('recording');
}

function handleVoiceNoteRecorded(itemId, blob){
  const reader = new FileReader();
  reader.onload = () => {
    pendingVoiceNotes[itemId] = { dataUrl: reader.result, mimeType: blob.type, transcript: '' };
    renderPendingVoiceNote(itemId, 'Transcribing…');
    transcribeVoiceNote(itemId, blob);
  };
  reader.readAsDataURL(blob);
}

function renderPendingVoiceNote(itemId, status){
  const el = document.getElementById(`voice-pending-${itemId}`);
  if (!el) return;
  const note = pendingVoiceNotes[itemId];
  if (!note){ el.classList.remove('show'); el.innerHTML=''; return; }
  el.classList.add('show');
  el.innerHTML = `
    <audio controls src="${note.dataUrl}"></audio>
    <div class="vp-status">${status || (note.transcript ? '"' + escapeHtml(note.transcript) + '"' : 'No transcript yet.')}</div>`;
}

async function transcribeVoiceNote(itemId, blob){
  if (!GROQ_API_KEY){
    renderPendingVoiceNote(itemId, '(no transcript — add a Groq API key to enable)');
    return;
  }
  try{
    const form = new FormData();
    form.append('file', blob, 'voice-note.webm');
    form.append('model', GROQ_MODEL);
    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method:'POST',
      headers:{ 'Authorization': `Bearer ${GROQ_API_KEY}` },
      body: form
    });
    if (!res.ok) throw new Error(`Groq returned ${res.status}`);
    const data = await res.json();
    if (pendingVoiceNotes[itemId]) pendingVoiceNotes[itemId].transcript = data.text || '';
    renderPendingVoiceNote(itemId);
  }catch(err){
    console.error('Groq transcription failed', err);
    renderPendingVoiceNote(itemId, '(transcription failed — ' + err.message + ')');
  }
}

/* ---- New batch modal ---- */
const batchModal = document.getElementById('batchModal');
document.getElementById('newBatchBtn').onclick = ()=> batchModal.classList.add('open');
document.getElementById('batchModalCancel').onclick = ()=> batchModal.classList.remove('open');
document.getElementById('batchModalSubmit').onclick = async ()=>{
  const name = document.getElementById('newBatchName').value.trim();
  if (!name) return;

  if (sb){
    await sb.from('batches').insert({ name });
    await refreshState();
  } else {
    state.batches.push({ id: 'batch-' + Date.now(), name, items: [] });
    saveState();
  }
  document.getElementById('newBatchName').value = '';
  batchModal.classList.remove('open');
  render();
};

/* ---- Add content modal ---- */
const addModal = document.getElementById('addModal');
document.getElementById('addContentFab').onclick = ()=> addModal.classList.add('open');
document.getElementById('modalCancel').onclick = ()=> addModal.classList.remove('open');

function populateModalBatchSelect(){
  const sel = document.getElementById('modalBatch');
  sel.innerHTML = state.batches.map(b=>`<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
}

async function uploadToCloudinary(file){
  const resourceType = file.type.startsWith('video') ? 'video' : 'image';
  const form = new FormData();
  form.append('file', file);
  form.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`, {
    method: 'POST',
    body: form
  });
  if (!res.ok){
    const errBody = await res.text().catch(()=> '');
    throw new Error(`Cloudinary upload failed (${res.status}): ${errBody.slice(0,200)}`);
  }
  const data = await res.json();
  return { type: resourceType, url: data.secure_url };
}

document.getElementById('modalSubmit').onclick = async ()=>{
  const batchId = document.getElementById('modalBatch').value;
  const category = document.getElementById('modalCategory').value;
  const format = document.getElementById('modalFormat').value;
  const caption = document.getElementById('modalCaption').value.trim();
  const files = Array.from(document.getElementById('modalFile').files);
  if (!batchId || !files.length) { alert('Pick a batch and at least one media file.'); return; }

  const submitBtn = document.getElementById('modalSubmit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Uploading...';
  try{
    let mediaType, mediaUrl = null, media = null;
    if (CLOUDINARY_CLOUD_NAME && CLOUDINARY_UPLOAD_PRESET){
      // Real upload — every reviewer sees this, not just this browser tab.
      if (format === 'carousel' && files.length > 1){
        mediaType = 'carousel';
        media = [];
        for (const f of files) media.push(await uploadToCloudinary(f));
      } else {
        const uploaded = await uploadToCloudinary(files[0]);
        mediaType = uploaded.type;
        mediaUrl = uploaded.url;
      }
    } else {
      // Fallback only if Cloudinary isn't configured — local-tab-only preview.
      if (format === 'carousel' && files.length > 1){
        mediaType = 'carousel';
        media = files.map(f => ({ type: f.type.startsWith('video') ? 'video' : 'image', url: URL.createObjectURL(f) }));
      } else {
        const file = files[0];
        mediaType = file.type.startsWith('video') ? 'video' : 'image';
        mediaUrl = URL.createObjectURL(file);
      }
    }

    if (sb){
      const { data: item } = await sb.from('content_items').insert({ batch_id: batchId, category, format }).select().single();
      await sb.from('revisions').insert({ content_item_id: item.id, revision_number: 1, media_type: mediaType, media_url: mediaUrl, media, caption });
      await refreshState();
    } else {
      const batch = state.batches.find(b=>b.id===batchId);
      const revision = mediaType === 'carousel'
        ? { revisionNumber:1, mediaType, media, caption, reviews: [] }
        : { revisionNumber:1, mediaType, mediaUrl, caption, reviews: [] };
      batch.items.push({ id: 'item-' + Date.now(), category, format, revisions: [revision] });
    }

    document.getElementById('modalCaption').value = '';
    document.getElementById('modalFile').value = '';
    addModal.classList.remove('open');
    render();
  }catch(err){
    console.error(err);
    alert(err.message || 'Upload failed.');
  }finally{
    submitBtn.disabled = false;
    submitBtn.textContent = 'Add for review';
  }
};

async function init(){
  state = await loadState();
  render();
}

(async function boot(){
  if (await refreshAuthGate()) await init();
})();
