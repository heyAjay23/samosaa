// HomePage.js (module)

// Firebase v10 imports (CDN)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, serverTimestamp, collection, addDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// --- Firebase config (keep yours) ---
const firebaseConfig = {
  apiKey: "AIzaSyDOrok6tfuLqymYsADST7Pck9RavUx2Sfc",
  authDomain: "scoopygames-60456.firebaseapp.com",
  databaseURL: "https://scoopygames-60456-default-rtdb.firebaseio.com",
  projectId: "scoopygames-60456",
  storageBucket: "scoopygames-60456.firebasestorage.app",
  messagingSenderId: "562779988237",
  appId: "1:562779988237:web:e4ad36fbe1cc926f015044"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ---------- Cloudinary config ----------
const CLOUD_NAME = 'duzicq9km';
const UNSIGNED_PRESET = 'pending_frames_unsigned'; // change if needed

// DOM refs
const qs = s=>document.querySelector(s);
const createSection = qs('#createSection');
const joinSection   = qs('#joinSection');
const toggleHint    = qs('#toggleHint');
const nameCreateInp = qs('#nameCreate');
const nameJoinInp   = qs('#nameJoin');
const roomCodeInp   = qs('#roomCode');
const createBtn     = qs('#createBtn');
const joinBtn       = qs('#joinBtn');
const joinSpecBtn   = qs('#joinSpecBtn');

const pickCharCreate = qs('#pickCharCreate');
const pickCharJoin   = qs('#pickCharJoin');
const charPicker     = qs('#charPicker');
const charBackdrop   = qs('#charBackdrop');
const charListEl     = qs('#charList');
const charConfirmBtn = qs('#charConfirm');
const charCancelBtn  = qs('#charCancel');
const charCloseBtn   = qs('#charClose');

const charCardCreate = qs('#charCardCreate');
const charCircleCreate = qs('#charCircleCreate');
const charLabelCreate = qs('#charLabelCreate');

const charCardJoin = qs('#charCardJoin');
const charCircleJoin = qs('#charCircleJoin');
const charLabelJoin = qs('#charLabelJoin');

const whyBadge = qs('#whyBadge');

const loadingToast = qs('#loadingToast');
const loadingText = qs('#loadingText');

const joinModePlayerBtn = qs('#joinModePlayer');
const joinModeSpectatorBtn = qs('#joinModeSpectator');
const openJoinBtn = qs('#openJoin');
const openJoinSpecBtn = qs('#openJoinSpec');

// Upload FAB + modal elements
const uploadFAB = qs('#uploadFAB');
const uploadModal = qs('#uploadModal');
const uploadBackdrop = qs('#uploadBackdrop');
const uploadPanel = qs('#uploadPanel');
const uploadModalClose = qs('#uploadModalClose');
const movieNameUpload = qs('#movieNameUpload');
const frameFileUpload = qs('#frameFileUpload');
const uploadSubmitBtn = qs('#uploadSubmitBtn');
const uploadCancelBtn = qs('#uploadCancelBtn');
const uploadProgressSmall = qs('#uploadProgressSmall');

// Frame uploader helpers (for reuse)
const movieNameInp = qs('#movieName'); // optional reuse if present elsewhere
const frameFileInp = qs('#frameFile'); // optional reuse if present elsewhere
const uploadFrameBtn = qs('#uploadFrameBtn'); // not used in minimal setup
const clearFrameBtn = qs('#clearFrameBtn'); // not used
const uploadProgress = qs('#uploadProgress'); // not used in minimal setup

let joinMode = 'player'; // 'player' or 'spectator'

// Prefill name if saved
const savedName = localStorage.getItem('playerName') || '';
if (nameCreateInp) nameCreateInp.value = savedName;
if (nameJoinInp)   nameJoinInp.value   = savedName;

// Toggle helpers
function showJoin(){
  createSection.classList.add('hidden'); createSection.classList.remove('shown');
  joinSection.classList.add('shown');    joinSection.classList.remove('hidden');
  joinSection.setAttribute('aria-hidden','false'); createSection.setAttribute('aria-hidden','true');
  toggleHint.innerHTML = 'Going to create instead? <button type="button" id="openCreate">Create a room</button>';
  document.getElementById('openCreate').addEventListener('click', showCreate, {once:true});
  nameJoinInp?.focus();
}
function showCreate(){
  joinSection.classList.add('hidden'); joinSection.classList.remove('shown');
  createSection.classList.add('shown'); createSection.classList.remove('hidden');
  createSection.setAttribute('aria-hidden','false'); joinSection.setAttribute('aria-hidden','true');
  toggleHint.innerHTML = 'Have a room code? <button type="button" id="openJoin">Join one</button> or <button type="button" id="openJoinSpec">Join as a spectator</button>';
  document.getElementById('openJoin').addEventListener('click', showJoin, {once:true});
  document.getElementById('openJoinSpec').addEventListener('click', showJoinSpec, {once:true});
  nameCreateInp?.focus();
}
if (document.getElementById('openJoin')) document.getElementById('openJoin').addEventListener('click', showJoin, {once:true});

// Helpers
const trim = s=> (s||'').trim();
const makeCode = () => Math.random().toString(36).slice(2,7).toUpperCase();
function goToGame(params) {
  location.href = `Game.html?${new URLSearchParams(params)}`;
}

// Always create a brand-new room (no reuse)
async function createFreshRoom(name, uid, maxAttempts=6){
  for (let i=0;i<maxAttempts;i++){
    const code = makeCode();
    const ref  = doc(db, "rooms", code);
    const snap = await getDoc(ref);
    if (!snap.exists()){
      await setDoc(ref, {
        createdAt: serverTimestamp(),
        status: "lobby",
        hostUid: uid,
        hostName: name,
        currentFrame: 1,
        round: 1,
        framesPerRound: 10,
        frameRevealed: false,
        endOfRound: false,
        locked: false
      });
      return code;
    }
  }
  throw new Error("Could not allocate a room. Try again.");
}

async function verifyRoom(code){
  const snap = await getDoc(doc(db,"rooms",code));
  if(!snap.exists()) throw new Error("Room not found");
  return true;
}

// -------------------- Characters --------------------
const RAW_BASE = "https://raw.githubusercontent.com/heyAjay23/logos/main/";
const CHARACTERS = [
  { id:'supersuper', name:'SuperSuper', file:'SuperSuper.jpg', emoji:'🥇' },
  { id:'wvish',      name:'Wvish',      file:'Wvish.jpg', emoji:'✨' },
  { id:'moviestalk', name:'Moviestalk', file:'Moviestalk.jpg', emoji:'🎬' },
  { id:'desinerd',   name:'DesiNerd',   file:'Desi ners.jpg', emoji:'🧠' },
  { id:'bnftv',      name:'Bnftv',      file:'bnftv.jpeg', emoji:'🎧' },
  { id:'thepj',      name:'ThePJ',      file:'pj.jpg', emoji:'🎭' },
  { id:'comicverse', name:'Comicverse', file:'comicverse.jpeg', emoji:'🖼' },
  { id:'abhireview', name:'Abhi Review',file:'abhi review.jpeg', emoji:'📝' },
  { id:'surajkumar', name:'Suraj Kumar',file:'images.jpeg', emoji:'🎤' },
  { id:'yogi',       name:'Yogi Bolta Hai', file:'yogi.jpg', emoji:'🗣' }
].map(c => ({ ...c, url: RAW_BASE + encodeURIComponent(c.file) }));

let selectedChar = null;
let pickerTarget = 'create'; // 'create' or 'join'

// Render character list into modal
function renderCharList(){
  charListEl.innerHTML = '';
  CHARACTERS.forEach(c=>{
    const li = document.createElement('li');
    li.tabIndex = 0;
    li.className = 'char-item';

    const thumb = document.createElement('div');
    thumb.className = 'char-thumb-large';
    thumb.dataset.id = c.id;

    const img = document.createElement('img');
    img.src = c.url;
    img.alt = c.name;
    img.onerror = () => {
      img.style.display = 'none';
      thumb.textContent = c.emoji;
      thumb.style.fontSize = '48px';
      thumb.style.display = 'flex';
      thumb.style.alignItems = 'center';
      thumb.style.justifyContent = 'center';
    };
    thumb.appendChild(img);

    const meta = document.createElement('div');
    meta.className = 'char-meta';
    const n = document.createElement('div');
    n.className = 'char-name';
    n.textContent = c.name;
    const s = document.createElement('div');
    s.className = 'char-sub';
    s.textContent = 'Tap to select';
    meta.appendChild(n);
    meta.appendChild(s);

    li.appendChild(thumb);
    li.appendChild(meta);

    li.addEventListener('click', ()=>{
      document.querySelectorAll('.char-item').forEach(x=>x.classList.remove('selected'));
      li.classList.add('selected');
      selectedChar = c;
    });

    charListEl.appendChild(li);
  });
}

// Show preview in the create/join card and disable the input
function showCharPreviewFor(target){
  const card = (target === 'create') ? {wrap: charCardCreate, circle: charCircleCreate, label: charLabelCreate, input: nameCreateInp} : {wrap: charCardJoin, circle: charCircleJoin, label: charLabelJoin, input: nameJoinInp};
  if (!selectedChar){
    card.wrap.style.display = 'none';
    if (card.input) card.input.disabled = false;
    return;
  }

  card.circle.innerHTML = '';
  const img = document.createElement('img');
  img.src = selectedChar.url;
  img.alt = selectedChar.name;
  img.onload = ()=> { card.circle.appendChild(img); };
  img.onerror = ()=> {
    card.circle.textContent = selectedChar.emoji;
    card.circle.style.fontSize = '48px';
  };

  card.label.textContent = selectedChar.name;
  card.wrap.style.display = 'flex';

  if (card.input){
    card.input.value = selectedChar.name;
    card.input.disabled = true;
  }

  localStorage.setItem('selectedCharacter', selectedChar.id);
}

// Open/close picker (block for spectator join)
function openPicker(forTarget='create'){ 
  if (forTarget === 'join' && joinMode === 'spectator') {
    showActionToast("Spectators cannot pick characters.");
    return;
  }
  pickerTarget = forTarget; renderCharList(); charPicker.classList.remove('hidden'); charPicker.setAttribute('aria-hidden','false'); 
}
function closePicker(){ charPicker.classList.add('hidden'); charPicker.setAttribute('aria-hidden','true'); }

// Hook pick buttons
pickCharCreate?.addEventListener('click', ()=> openPicker('create'));
pickCharJoin?.addEventListener('click', ()=> openPicker('join'));
charBackdrop?.addEventListener('click', closePicker);
charCloseBtn?.addEventListener('click', closePicker);
charCancelBtn?.addEventListener('click', closePicker);

// Confirm selection — show preview for the target and disable editing
charConfirmBtn?.addEventListener('click', ()=>{
  if (!selectedChar) {
    showActionToast('Please select a character first.');
    return;
  }
  showCharPreviewFor(pickerTarget);
  if (pickerTarget === 'create') showCharPreviewFor('join');
  else showCharPreviewFor('create');
  closePicker();
});

// Restore selection from localStorage on load
const savedCharId = localStorage.getItem('selectedCharacter');
if (savedCharId){
  const found = CHARACTERS.find(c => c.id === savedCharId);
  if (found){
    selectedChar = found;
    showCharPreviewFor('create');
    showCharPreviewFor('join');
  }
}

// ---------- HOW TO PLAY (first-visit dialog, also opened by Why? badge) ----------
const howToModal     = qs('#howToModal');
const howToBackdrop  = qs('#howToBackdrop');
const howToClose     = qs('#howToClose');
const howToOk        = qs('#howToOk');
const howToLater     = qs('#howToLater');
const howToDontShow  = qs('#howToDontShow');

const HOWTO_KEY = 'samosaa_htp_seen_v1';

function openHowTo() {
  if (!howToModal) return;
  howToModal.classList.remove('hidden');
  howToModal.setAttribute('aria-hidden', 'false');
  // focus heading for SR/keyboard users
  document.querySelector('#howToLabel')?.focus?.();
}
function closeHowTo(saveChoice = false) {
  if (!howToModal) return;
  howToModal.classList.add('hidden');
  howToModal.setAttribute('aria-hidden', 'true');
  if (saveChoice || howToDontShow?.checked) {
    localStorage.setItem(HOWTO_KEY, '1');
  }
}

// Auto-open on desktop for first-time visitors
window.addEventListener('load', () => {
  const already = localStorage.getItem(HOWTO_KEY) === '1';
  const isMobile = window.innerWidth <= 768;
  if (!already && !isMobile) {
    setTimeout(openHowTo, 400);
  }
});

// Make the "Why?" badge open How to play
whyBadge?.addEventListener('click', openHowTo);

// Close handlers
howToBackdrop?.addEventListener('click', () => closeHowTo(false));
howToClose?.addEventListener('click', () => closeHowTo(false));
howToLater?.addEventListener('click', () => closeHowTo(false));
howToOk?.addEventListener('click', () => closeHowTo(true));

// Close with Esc
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && howToModal && !howToModal.classList.contains('hidden')) {
    closeHowTo(false);
  }
});

// Loading toast helpers
function showLoading(message){
  if (!loadingToast) return;
  loadingText.textContent = message || "Loading…";
  loadingToast.classList.remove('hidden');
}
function hideLoading(){
  if (!loadingToast) return;
  loadingToast.classList.add('hidden');
}

// Simple action toast used across the page
function makeActionToast(){
  let t = qs('#actionToast');
  if (t) return t;
  t = document.createElement('div');
  t.id = 'actionToast';
  t.style.position = 'fixed';
  t.style.left = '50%';
  t.style.transform = 'translateX(-50%)';
  t.style.bottom = '18px';
  t.style.background = 'rgba(10,12,20,0.95)';
  t.style.color = '#dfe9ff';
  t.style.padding = '10px 14px';
  t.style.borderRadius = '10px';
  t.style.boxShadow = '0 10px 30px rgba(2,6,23,0.6)';
  t.style.zIndex = 9999;
  t.style.display = 'none';
  document.body.appendChild(t);
  return t;
}
const actionToast = makeActionToast();
function showActionToast(text, ms=2400){
  if (!actionToast) return;
  actionToast.textContent = text;
  actionToast.style.display = 'block';
  clearTimeout(actionToast._timer);
  actionToast._timer = setTimeout(()=> actionToast.style.display = 'none', ms);
}

// Join mode toggles
function setJoinMode(mode){
  joinMode = mode;
  if (mode === 'player') {
    joinModePlayerBtn.classList.add('mode-active');
    joinModeSpectatorBtn.classList.remove('mode-active');
    pickCharJoin?.classList.remove('hidden');
    joinBtn.classList.remove('hidden');
    joinSpecBtn.classList.add('hidden');
    if (selectedChar) charCardJoin.style.display = 'flex';
  } else {
    joinModePlayerBtn.classList.remove('mode-active');
    joinModeSpectatorBtn.classList.add('mode-active');
    pickCharJoin?.classList.add('hidden');
    charCardJoin.style.display = 'none';
    joinBtn.classList.add('hidden');
    joinSpecBtn.classList.remove('hidden');
    if (nameJoinInp) nameJoinInp.disabled = false;
  }
}

// Hook join mode btns
joinModePlayerBtn?.addEventListener('click', ()=> setJoinMode('player'));
joinModeSpectatorBtn?.addEventListener('click', ()=> setJoinMode('spectator'));

// open join page in spectator mode (used by the inline hint button)
function showJoinSpec(){
  // open join section
  createSection.classList.add('hidden'); createSection.classList.remove('shown');
  joinSection.classList.add('shown');    joinSection.classList.remove('hidden');
  joinSection.setAttribute('aria-hidden','false'); createSection.setAttribute('aria-hidden','true');
  toggleHint.innerHTML = 'Going to create instead? <button type="button" id="openCreate">Create a room</button>';
  document.getElementById('openCreate').addEventListener('click', showCreate, {once:true});
  // force spectator mode
  setJoinMode('spectator');
  nameJoinInp?.focus();
}

// hook inline hint spectator button
openJoinSpecBtn?.addEventListener('click', showJoinSpec);

// also ensure openJoin still works as before
openJoinBtn?.addEventListener('click', showJoin);

// --- Auth + button handlers ---
signInAnonymously(auth).catch(console.error);

onAuthStateChanged(auth, (user)=>{
  // Create
  createBtn?.addEventListener('click', async ()=>{
    const raw = trim(nameCreateInp.value);
    if(!raw) return showActionToast("Please enter your name or choose a character.");
    const actualName = selectedChar ? selectedChar.name : raw;
    localStorage.setItem('playerName', actualName);
    try{
      showLoading('Creating room…');
      const uid  = user?.uid;
      if(!uid){ hideLoading(); showActionToast("Auth not ready. Try again."); return; }
      const room = await createFreshRoom(actualName, uid);
      const params = { mode:'create', name: actualName, room };
      if (selectedChar) params.character = selectedChar.id;
      hideLoading();
      goToGame(params);
    }catch(err){
      hideLoading();
      showActionToast(err.message||'Create failed');
    }
  });

  // Player Join (checks room locked state before redirect)
  joinBtn?.addEventListener('click', async ()=>{
    const name = trim(nameJoinInp.value);
    const room = trim(roomCodeInp.value).toUpperCase();
    if(!name) { showActionToast("Please enter your name."); return; }
    if(!room) { showActionToast("Please enter a room code."); return; }
    localStorage.setItem('playerName', name);

    try{
      showLoading('Checking room…');
      // verify room exists
      await verifyRoom(room);

      // check locked flag (spectators allowed regardless)
      const snap = await getDoc(doc(db, "rooms", room));
      const data = snap.exists() ? snap.data() : {};
      const locked = !!data.locked;
      const currentUid = user?.uid || (auth.currentUser && auth.currentUser.uid) || null;
      const isHost = currentUid && data.hostUid && (data.hostUid === currentUid);
      if (locked && !isHost) {
        hideLoading();
        showActionToast("Room is locked — cannot join as player. Join as spectator instead.");
        return;
      }

      // proceed to join as player
      const params = { mode:'join', name, room };
      if (selectedChar) params.character = selectedChar.id;
      hideLoading();
      goToGame(params);
    }catch(err){
      hideLoading();
      showActionToast(err.message||'Join failed');
    }
  });

  // Spectator Join
  joinSpecBtn?.addEventListener('click', async ()=>{
    const name = trim(nameJoinInp.value);
    const room = trim(roomCodeInp.value).toUpperCase();
    if(!name) { showActionToast("Please enter your name."); return; }
    if(!room) { showActionToast("Please enter a room code."); return; }
    localStorage.setItem('playerName', name);
    try{
      showLoading('Joining as spectator…');
      await verifyRoom(room);
      const params = { mode:'spectator', name, room };
      hideLoading();
      goToGame(params);
    }catch(err){
      hideLoading();
      showActionToast(err.message||'Join failed');
    }
  });
});

// Enter key quick submit
document.addEventListener('keydown', (e)=>{
  if(e.key === 'Enter'){
    const joining = getComputedStyle(joinSection).display !== 'none';
    if (joining) {
      if (joinMode === 'player') joinBtn.click();
      else joinSpecBtn.click();
    } else {
      createBtn.click();
    }
  }
});

// init join mode default
setJoinMode('player');

// ---------- Cloudinary uploader with client-side resize/compress ----------
// helper: convert dataURL to Blob
function dataURLToBlob(dataURL) {
  const arr = dataURL.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  return new Blob([u8arr], { type: mime });
}

// helper: resize image using canvas; tries to respect maxBytes by reducing quality in a loop
async function resizeAndCompressImage(file, maxWidth = 1280, targetBytes = 400 * 1024) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = async () => {
      const scale = Math.min(1, maxWidth / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);

      let quality = 0.92;
      let blob = null;
      for (let i = 0; i < 8; i++) {
        const dataURL = canvas.toDataURL('image/jpeg', quality);
        blob = dataURLToBlob(dataURL);
        if (blob.size <= targetBytes || quality <= 0.35) break;
        quality -= 0.12;
      }
      URL.revokeObjectURL(url);
      resolve(blob);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not load image for resize'));
    };
    img.src = url;
  });
}

// --- Floating upload button + modal logic (minimal) ---
function openUploadModal(){
  uploadModal.classList.remove('hidden');
  uploadModal.setAttribute('aria-hidden','false');
  setTimeout(()=> movieNameUpload?.focus(), 50);
}
function closeUploadModal(){
  uploadModal.classList.add('hidden');
  uploadModal.setAttribute('aria-hidden','true');
  uploadProgressSmall.textContent = '';
  movieNameUpload.value = '';
  frameFileUpload.value = '';
}

// open/close hooks
uploadFAB?.addEventListener('click', openUploadModal);
uploadModalClose?.addEventListener('click', closeUploadModal);
uploadCancelBtn?.addEventListener('click', closeUploadModal);
uploadBackdrop?.addEventListener('click', closeUploadModal);

// Upload handler
uploadSubmitBtn?.addEventListener('click', async () => {
  const movieName = trim(movieNameUpload.value);
  const file = frameFileUpload.files && frameFileUpload.files[0];
  const uploaderName = localStorage.getItem('playerName') || (auth.currentUser && auth.currentUser.uid) || 'anonymous';

  if (!file) { showActionToast('Please choose an image file.'); return; }
  if (!movieName) { showActionToast('Please enter the movie name.'); return; }

  if (!file.type.startsWith('image/')) { showActionToast('Please upload an image (jpg/png/webp).'); return; }
  if (file.size > 12 * 1024 * 1024) { showActionToast('File too large (>12MB).'); return; }

  try {
    showLoading('Preparing image…');

    const processedBlob = await resizeAndCompressImage(file, 1280, 400 * 1024);

    const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/upload`;
    const fd = new FormData();
    fd.append('file', processedBlob, file.name.replace(/\s+/g,'_'));
    fd.append('upload_preset', UNSIGNED_PRESET);
    fd.append('folder', 'pending_frames');

    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          uploadProgressSmall.textContent = `${Math.round((e.loaded/e.total)*100)}%`;
        }
      };
      xhr.onload = async () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const res = JSON.parse(xhr.responseText);
            const secureUrl = res.secure_url || res.url;
            const publicId = res.public_id || null;
            await addDoc(collection(db, 'pendingFrames'), {
              movieName,
              fileName: file.name,
              fileUrl: secureUrl,
              cloudinaryPublicId: publicId,
              uploaderName,
              uploaderUid: auth.currentUser ? auth.currentUser.uid : null,
              status: 'pending',
              createdAt: serverTimestamp()
            });
            resolve();
          } catch (err) {
            reject(err);
          }
        } else {
          reject(new Error('Upload failed: ' + xhr.status));
        }
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send(fd);
    });

    hideLoading();
    showActionToast('Frame submitted — thanks!');
    closeUploadModal();
  } catch (err) {
    hideLoading();
    console.error(err);
    showActionToast('Upload failed: ' + (err.message || err));
    uploadProgressSmall.textContent = '';
  }
});

// ---- MOBILE RESPONSIVE WARNING ---- //
(function checkMobileWarning() {
  function showMobileWarning() {
    // If already on desktop, do nothing
    if (window.innerWidth > 768) return;

    // Create overlay
    const overlay = document.createElement("div");
    overlay.id = "mobileWarningOverlay";
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(10, 10, 15, 0.97)";
    overlay.style.display = "flex";
    overlay.style.flexDirection = "column";
    overlay.style.justifyContent = "center";
    overlay.style.alignItems = "center";
    overlay.style.zIndex = "99999";
    overlay.style.textAlign = "center";
    overlay.style.padding = "20px";

    // Message box
    const msg = document.createElement("div");
    msg.style.color = "#fff";
    msg.style.fontSize = "18px";
    msg.style.fontWeight = "800";
    msg.innerHTML = `
      ⚠️ This website is <span style="color:#ff8e8e">not optimized</span> for mobile yet.<br>
      Please use a desktop or laptop for best experience.
    `;

    overlay.appendChild(msg);
    document.body.appendChild(overlay);
  }

  // Trigger on load
  window.addEventListener("load", showMobileWarning);
})();









/* ===== Spotlight Focus (JS) ===== */
(function SpotlightFocus(){
  let overlay, ring, arrow, note, hideTimer;

  function ensureNodes() {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'hp-spotlight';
      document.body.appendChild(overlay);
    }
    if (!ring) {
      ring = document.createElement('div');
      ring.className = 'hp-spotlight-ring';
      document.body.appendChild(ring);
    }
    if (!arrow) {
      arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      arrow.setAttribute('class', 'hp-spotlight-arrow');
      arrow.setAttribute('viewBox', '0 0 180 90');
      // curved path
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d','M10,80 C70,10 150,10 170,48');
      path.setAttribute('fill','none');
      path.setAttribute('stroke','#ffffff');
      path.setAttribute('stroke-width','4');
      path.setAttribute('stroke-linecap','round');
      path.setAttribute('stroke-dasharray','3 8');
      // arrow head
      const head = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      head.setAttribute('d','M160,42 l18,6 -18,6 6,-6 z');
      head.setAttribute('fill','#ffffff');
      arrow.appendChild(path); arrow.appendChild(head);
      document.body.appendChild(arrow);
    }
    if (!note) {
      note = document.createElement('div');
      note.className = 'hp-spotlight-note';
      document.body.appendChild(note);
    }
  }

  function show(target, message, opts = {}) {
    if (!target) return;
    ensureNodes();
    clearTimeout(hideTimer);

    // target rect
    const rect = target.getBoundingClientRect();
    const pad = opts.pad ?? 16;

    // center of target in page coords
    const cx = rect.left + rect.width/2 + window.scrollX;
    const cy = rect.top  + rect.height/2 + window.scrollY;

    // hole radius (largest half-dimension + pad)
    const r  = Math.max(rect.width, rect.height)/2 + pad;

    // apply CSS variables for the mask hole
    overlay.style.setProperty('--sx', cx + 'px');
    overlay.style.setProperty('--sy', cy + 'px');
    overlay.style.setProperty('--sr', r + 'px');

    // ring sized to element + pad
    ring.style.width  = rect.width  + pad*2 + 'px';
    ring.style.height = rect.height + pad*2 + 'px';
    ring.style.left   = cx + 'px';
    ring.style.top    = cy + 'px';
    ring.style.borderRadius = (opts.round ? '999px' : '16px');

    // arrow: place above-left if enough room; else below-left flipped
    const haveRoomAbove = rect.top > 120;
    const ax = Math.max(12, rect.left - 140 + window.scrollX);
    const ay = haveRoomAbove
      ? rect.top - 90 + window.scrollY
      : rect.bottom + 10 + window.scrollY;

    arrow.style.left = ax + 'px';
    arrow.style.top  = ay + 'px';
    arrow.style.transform = haveRoomAbove ? 'none' : 'scaleY(-1)';

    // note bubble near target
    note.textContent = message || '';
    const noteMaxW = 280;
    const nx = Math.max(12, Math.min(rect.left + window.scrollX - 10,
                   window.scrollX + window.innerWidth - noteMaxW - 12));
    const ny = haveRoomAbove
      ? Math.max(12, rect.top + window.scrollY - 130)
      : rect.bottom + window.scrollY + 18;

    note.style.left = nx + 'px';
    note.style.top  = ny + 'px';
    note.dataset.pos = haveRoomAbove ? 'above' : 'below';

    // show
    overlay.classList.add('show');
    ring.classList.add('show');
    arrow.classList.add('show');
    note.classList.add('show');

    // click anywhere to dismiss
    overlay.style.pointerEvents = 'auto';
    overlay.onclick = hide;

    hideTimer = setTimeout(hide, opts.duration ?? 6500);
  }

  function hide(){
    overlay?.classList.remove('show');
    ring?.classList.remove('show');
    arrow?.classList.remove('show');
    note?.classList.remove('show');
    if (overlay) { overlay.onclick = null; overlay.style.pointerEvents = 'none'; }
  }

  // Expose API
  window.Spotlight = { show, hide };
})();

/* ===== Triggers for your page ===== */
// 1) Focus the inline “Join as a spectator” link after load (or after How-To closes)
function spotlightHomeSpectatorLink() {
  const el = document.getElementById('openJoinSpec');
  if (!el || !window.Spotlight) return;
  Spotlight.show(
    el,
    "Want to spectate and still guess in chat? Use “Join as a spectator”.",
    { duration: 7000, pad: 18 }
  );
}
window.addEventListener('load', () => {
  const modal = document.getElementById('howToModal');
  const isOpen = modal && !modal.classList.contains('hidden');
  const arm = () => setTimeout(spotlightHomeSpectatorLink, 400);

  if (isOpen) {
    const runOnce = () => { arm(); cleanup(); };
    const cleanup = () => {
      document.getElementById('howToOk')?.removeEventListener('click', runOnce);
      document.getElementById('howToLater')?.removeEventListener('click', runOnce);
      document.getElementById('howToBackdrop')?.removeEventListener('click', runOnce);
      document.getElementById('howToClose')?.removeEventListener('click', runOnce);
    };
    document.getElementById('howToOk')?.addEventListener('click', runOnce);
    document.getElementById('howToLater')?.addEventListener('click', runOnce);
    document.getElementById('howToBackdrop')?.addEventListener('click', runOnce);
    document.getElementById('howToClose')?.addEventListener('click', runOnce);
  } else {
    arm();
  }
});

// 2) When Join opens, spotlight the “Join as spectator” tab button
function spotlightJoinSpectatorTab() {
  const el = document.getElementById('joinModeSpectator');
  if (!el || !window.Spotlight) return;
  Spotlight.show(
    el,
    "Tap this to enter Spectator mode — watch live and guess in chat.",
    { duration: 6500, pad: 16 }
  );
}

// Wrap your existing helpers so spotlight runs after they render the Join UI
if (typeof window.showJoin === 'function') {
  const _showJoin = window.showJoin;
  window.showJoin = function() {
    _showJoin();
    setTimeout(spotlightJoinSpectatorTab, 250);
  };
}
if (typeof window.showJoinSpec === 'function') {
  const _showJoinSpec = window.showJoinSpec;
  window.showJoinSpec = function() {
    _showJoinSpec();
    setTimeout(spotlightJoinSpectatorTab, 250);
  };
}
