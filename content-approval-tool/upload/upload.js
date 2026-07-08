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

/* ===================== CLOUDINARY ===================== */
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

/* ===================== SUBMIT ===================== */
submitBtn.addEventListener('click', async ()=>{
  clearStatus();

  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET){
    setStatus('error', 'Cloudinary isn\'t configured yet — see the note above.');
    return;
  }

  const category = categorySelect.value;
  const format = formatSelect.value;
  const caption = captionInput.value.trim();
  const files = Array.from(fileInput.files);
  let batchId = batchSelect.value;
  const isNewBatch = batchId === '__new__';
  const newName = newBatchName.value.trim();

  if (isNewBatch && !newName){ setStatus('error', 'Type a name for the new batch.'); return; }
  if (!files.length){ setStatus('error', 'Pick at least one photo or video.'); return; }

  submitBtn.disabled = true;
  try{
    if (isNewBatch){
      setStatus('info', 'Creating batch...');
      const { data: batch, error } = await sb.from('batches').insert({ name: newName }).select().single();
      if (error) throw new Error(error.message);
      batchId = batch.id;
    }

    const uploaded = [];
    for (let i = 0; i < files.length; i++){
      setStatus('info', `Uploading ${i+1}/${files.length} to Cloudinary...`);
      uploaded.push(await uploadToCloudinary(files[i]));
    }

    let mediaType, mediaUrl = null, media = null;
    if (format === 'carousel' && uploaded.length > 1){
      mediaType = 'carousel';
      media = uploaded;
    } else {
      mediaType = uploaded[0].type;
      mediaUrl = uploaded[0].url;
    }

    setStatus('info', 'Saving to the batch...');
    const { data: item, error: itemErr } = await sb.from('content_items')
      .insert({ batch_id: batchId, category, format }).select().single();
    if (itemErr) throw new Error(itemErr.message);

    const { error: revErr } = await sb.from('revisions').insert({
      content_item_id: item.id, revision_number: 1,
      media_type: mediaType, media_url: mediaUrl, media, caption
    });
    if (revErr) throw new Error(revErr.message);

    setStatus('success', `Added! ${CATEGORY_LABELS[category]} · IG ${format} — reviewers will see it now.`);
    addToRecent(category, format, caption);

    captionInput.value = '';
    fileInput.value = '';
    newBatchRow.style.display = 'none';
    newBatchName.value = '';
    await loadBatches();
    if (isNewBatch) batchSelect.value = batchId;
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
