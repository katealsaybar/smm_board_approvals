/* ===================== CONFIG ===================== */
const SUPABASE_URL = 'https://qyojrknmgwkfjrdhtxhk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_rsz9t8fPuF_leH5KwRUeKA__ZiwO9CP';

const CLOUDINARY_CLOUD_NAME = 'dj7chrw4z';
const CLOUDINARY_UPLOAD_PRESET = 'b0pb9erf';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const CATEGORY_LABELS = {
  transformation:'Transformation', education:'Education', bts:'BTS & Culture',
  clientstories:'Client Stories', foundersvoice:"Founder's Voice"
};

/* ===================== DOM ===================== */
const batchSelect = document.getElementById('batchSelect');
const newBatchRow = document.getElementById('newBatchRow');
const newBatchName = document.getElementById('newBatchName');
const newBatchCancel = document.getElementById('newBatchCancel');
const categorySelect = document.getElementById('categorySelect');
const formatSelect = document.getElementById('formatSelect');
const captionInput = document.getElementById('captionInput');
const fileInput = document.getElementById('fileInput');
const singleFileField = document.getElementById('singleFileField');
const carouselField = document.getElementById('carouselField');
const carouselGrid = document.getElementById('carouselGrid');
const addSlideBtn = document.getElementById('addSlideBtn');
const modeSelect = document.getElementById('modeSelect');
const newContentFields = document.getElementById('newContentFields');
const revisionTargetField = document.getElementById('revisionTargetField');
const revisionSelect = document.getElementById('revisionSelect');
const submitBtn = document.getElementById('submitBtn');
const statusBox = document.getElementById('statusBox');
const recentBox = document.getElementById('recentBox');
const recentList = document.getElementById('recentList');
const cloudinaryWarning = document.getElementById('cloudinaryWarning');

if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET){
  cloudinaryWarning.style.display = 'block';
}

function setStatus(kind, message){
  statusBox.className = `status show ${kind}`;
  statusBox.textContent = message;
}
function clearStatus(){
  statusBox.className = 'status';
  statusBox.textContent = '';
}

/* ===================== BATCH LIST ===================== */
async function loadBatches(){
  const { data: batches, error } = await sb.from('batches').select('*').order('created_at', { ascending:false });
  if (error){
    setStatus('error', `Couldn't load batches: ${error.message}`);
  }
  // Always offer "+ Create new batch" even if the fetch failed or returned none —
  // otherwise there'd be no way to create the very first batch.
  batchSelect.innerHTML =
    (batches || []).map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('') +
    `<option value="__new__">+ Create new batch</option>`;
}

batchSelect.addEventListener('change', ()=>{
  if (batchSelect.value === '__new__'){
    newBatchRow.style.display = 'flex';
    newBatchName.focus();
  } else {
    newBatchRow.style.display = 'none';
  }
});
newBatchCancel.addEventListener('click', ()=>{
  newBatchRow.style.display = 'none';
  batchSelect.selectedIndex = 0;
});

function escapeHtml(str){
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

/* ===================== REVISION TARGETS ===================== */
// Mirrors the status logic in ../view/app.js (itemStatus) so "needs revision" here
// means the same thing it does in the review tool: Tara's word is final; absent
// that, any revision request from Kate/Emma counts.
const FINAL_SAY = 'Tara';
function computeItemStatus(reviews){
  if (!reviews.length) return 'forreview';
  const tara = [...reviews].reverse().find(r => r.reviewer === FINAL_SAY);
  if (tara) return tara.decision === 'approved' ? 'approved' : 'forrevision';
  if (reviews.some(r => r.decision === 'revision')) return 'forrevision';
  return reviews.some(r => r.decision === 'approved') ? 'approved' : 'forreview';
}

let revisableItems = [];

async function loadRevisableItems(){
  const [{ data: batches }, { data: items }, { data: revisions }, { data: reviews }] = await Promise.all([
    sb.from('batches').select('*'),
    sb.from('content_items').select('*'),
    sb.from('revisions').select('*').order('revision_number'),
    sb.from('reviews').select('*')
  ]);
  const batchNameById = Object.fromEntries((batches || []).map(b => [b.id, b.name]));

  revisableItems = (items || []).map(item => {
    const itemRevisions = (revisions || []).filter(r => r.content_item_id === item.id);
    if (!itemRevisions.length) return null;
    const latest = itemRevisions[itemRevisions.length - 1];
    const latestReviews = (reviews || []).filter(rv => rv.revision_id === latest.id);
    return {
      id: item.id,
      batchId: item.batch_id,
      batchName: batchNameById[item.batch_id] || 'Unknown batch',
      category: item.category,
      format: item.format,
      latestRevisionNumber: latest.revision_number,
      captionPreview: (latest.caption || '(no caption)').slice(0, 60),
      status: computeItemStatus(latestReviews)
    };
  }).filter(Boolean).filter(i => i.status === 'forrevision');

  renderRevisionOptions();
}

function renderRevisionOptions(){
  revisionSelect.innerHTML = revisableItems.length
    ? revisableItems.map(i =>
        `<option value="${i.id}">${escapeHtml(i.batchName)} · ${CATEGORY_LABELS[i.category]} · IG ${i.format} — "${escapeHtml(i.captionPreview)}"</option>`
      ).join('')
    : `<option value="">Nothing is currently flagged for revision</option>`;
}

function currentRevisionTarget(){
  return revisableItems.find(i => i.id === revisionSelect.value) || null;
}

modeSelect.addEventListener('change', ()=>{
  const isRevision = modeSelect.value === 'revision';
  newContentFields.style.display = isRevision ? 'none' : '';
  revisionTargetField.style.display = isRevision ? 'block' : 'none';
  toggleUploadMode();
});
revisionSelect.addEventListener('change', toggleUploadMode);

/* ===================== CAROUSEL SLOTS ===================== */
const MAX_CAROUSEL_SLOTS = 10;
const INITIAL_CAROUSEL_SLOTS = 4;
let carouselFiles = [];

function initCarouselSlots(){
  carouselFiles = Array(INITIAL_CAROUSEL_SLOTS).fill(null);
  renderCarouselSlots();
}

function renderCarouselSlots(){
  carouselGrid.innerHTML = '';
  carouselFiles.forEach((file, i)=>{
    const slot = document.createElement('div');
    slot.className = 'carousel-slot' + (file ? ' filled' : '');

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*';
    input.hidden = true;
    input.addEventListener('change', ()=>{
      carouselFiles[i] = input.files[0] || null;
      renderCarouselSlots();
    });

    const box = document.createElement('div');
    box.className = 'slot-box';
    box.addEventListener('click', ()=> input.click());
    box.appendChild(input);

    const number = document.createElement('span');
    number.className = 'slot-number';
    number.textContent = i + 1;
    box.appendChild(number);

    if (file){
      if (file.type.startsWith('video')){
        const tag = document.createElement('div');
        tag.className = 'slot-video-tag';
        tag.textContent = `🎥 ${file.name}`;
        box.appendChild(tag);
      } else {
        const img = document.createElement('img');
        img.className = 'slot-thumb';
        img.src = URL.createObjectURL(file);
        box.appendChild(img);
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'slot-remove';
      remove.textContent = '×';
      remove.addEventListener('click', (e)=>{
        e.stopPropagation();
        carouselFiles[i] = null;
        renderCarouselSlots();
      });
      box.appendChild(remove);
    } else {
      const empty = document.createElement('div');
      empty.className = 'slot-empty';
      empty.textContent = '+ Upload';
      box.appendChild(empty);
    }

    slot.appendChild(box);
    carouselGrid.appendChild(slot);
  });

  addSlideBtn.style.display = carouselFiles.length >= MAX_CAROUSEL_SLOTS ? 'none' : 'inline-block';
}

addSlideBtn.addEventListener('click', ()=>{
  if (carouselFiles.length < MAX_CAROUSEL_SLOTS){
    carouselFiles.push(null);
    renderCarouselSlots();
  }
});

function toggleUploadMode(){
  const format = modeSelect.value === 'revision'
    ? (currentRevisionTarget() ? currentRevisionTarget().format : null)
    : formatSelect.value;
  if (format === 'carousel'){
    singleFileField.style.display = 'none';
    carouselField.style.display = 'block';
    if (!carouselFiles.length) initCarouselSlots();
  } else {
    singleFileField.style.display = 'block';
    carouselField.style.display = 'none';
  }
}
formatSelect.addEventListener('change', toggleUploadMode);
toggleUploadMode();

/* ===================== CLOUDINARY ===================== */
function sanitizeForFolder(str){
  return (str || 'untitled').replace(/[\/\\]/g, '-').trim() || 'untitled';
}

async function uploadToCloudinary(file, folder){
  const resourceType = file.type.startsWith('video') ? 'video' : 'image';
  const form = new FormData();
  form.append('file', file);
  form.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  if (folder) form.append('folder', folder);
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

/* ===================== SUBMIT ===================== */
submitBtn.addEventListener('click', async ()=>{
  clearStatus();

  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET){
    setStatus('error', 'Cloudinary isn\'t configured yet — see the note above.');
    return;
  }

  const isRevision = modeSelect.value === 'revision';
  const caption = captionInput.value.trim();

  let category, format, batchId, batchName, isNewBatch = false, newName = '', revisionTarget = null;

  if (isRevision){
    revisionTarget = currentRevisionTarget();
    if (!revisionTarget){ setStatus('error', 'Pick which content this fix belongs to.'); return; }
    category = revisionTarget.category;
    format = revisionTarget.format;
    batchId = revisionTarget.batchId;
    batchName = revisionTarget.batchName;
  } else {
    category = categorySelect.value;
    format = formatSelect.value;
    batchId = batchSelect.value;
    isNewBatch = batchId === '__new__';
    newName = newBatchName.value.trim();
    batchName = isNewBatch ? newName : (batchSelect.options[batchSelect.selectedIndex]?.text || '');
    if (isNewBatch && !newName){ setStatus('error', 'Type a name for the new batch.'); return; }
  }

  const files = format === 'carousel' ? carouselFiles.filter(Boolean) : (fileInput.files[0] ? [fileInput.files[0]] : []);
  if (!files.length){ setStatus('error', format === 'carousel' ? 'Upload at least one slide.' : 'Pick a photo or video.'); return; }
  if (format === 'carousel' && files.length < 2){ setStatus('error', 'A carousel needs at least 2 slides.'); return; }

  submitBtn.disabled = true;
  try{
    if (!isRevision && isNewBatch){
      setStatus('info', 'Creating batch...');
      const { data: batch, error } = await sb.from('batches').insert({ name: newName }).select().single();
      if (error) throw new Error(error.message);
      batchId = batch.id;
    }

    const folder = `TRS-Content/${sanitizeForFolder(batchName)}/${category}`;
    const uploaded = [];
    for (let i = 0; i < files.length; i++){
      setStatus('info', `Uploading ${i+1}/${files.length} to Cloudinary...`);
      uploaded.push(await uploadToCloudinary(files[i], folder));
    }

    let mediaType, mediaUrl = null, media = null;
    if (format === 'carousel'){
      mediaType = 'carousel';
      media = uploaded;
    } else {
      mediaType = uploaded[0].type;
      mediaUrl = uploaded[0].url;
    }

    setStatus('info', 'Saving...');
    if (isRevision){
      const { error: revErr } = await sb.from('revisions').insert({
        content_item_id: revisionTarget.id,
        revision_number: revisionTarget.latestRevisionNumber + 1,
        media_type: mediaType, media_url: mediaUrl, media, caption
      });
      if (revErr) throw new Error(revErr.message);
      setStatus('success', `New version added — reviewers will see it as v${revisionTarget.latestRevisionNumber + 1} on the same card.`);
    } else {
      const { data: item, error: itemErr } = await sb.from('content_items')
        .insert({ batch_id: batchId, category, format }).select().single();
      if (itemErr) throw new Error(itemErr.message);

      const { error: revErr } = await sb.from('revisions').insert({
        content_item_id: item.id, revision_number: 1,
        media_type: mediaType, media_url: mediaUrl, media, caption
      });
      if (revErr) throw new Error(revErr.message);

      setStatus('success', `Added! ${CATEGORY_LABELS[category]} · IG ${format} — reviewers will see it now.`);
    }
    addToRecent(category, format, caption);

    captionInput.value = '';
    fileInput.value = '';
    if (format === 'carousel') initCarouselSlots();
    newBatchRow.style.display = 'none';
    newBatchName.value = '';
    await loadBatches();
    if (!isRevision && isNewBatch) batchSelect.value = batchId;
    if (isRevision) await loadRevisableItems();
  }catch(err){
    console.error(err);
    setStatus('error', err.message || 'Something went wrong.');
  }finally{
    submitBtn.disabled = false;
  }
});

function addToRecent(category, format, caption){
  recentBox.style.display = 'block';
  const div = document.createElement('div');
  div.className = 'recent-item';
  div.innerHTML = `<b>${CATEGORY_LABELS[category]}</b> · IG ${format} — ${escapeHtml(caption).slice(0,70)}${caption.length>70?'…':''}`;
  recentList.prepend(div);
}

loadBatches();
loadRevisableItems();
