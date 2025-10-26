// spectatorChat.js — spectator-only (presence-gated) chat + buzz list
// - Spectators post raw guesses (correct:false)
// - Host-side processor (or Cloud Function) writes sanitized correct:true messages

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, updateDoc, collection, addDoc,
  onSnapshot, serverTimestamp, deleteDoc, query, orderBy, where, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/* -------------------- Firebase init (guard duplicate) -------------------- */
const firebaseConfig = {
  apiKey: "AIzaSyDOrok6tfuLqymYsADST7Pck9RavUx2Sfc",
  authDomain: "scoopygames-60456.firebaseapp.com",
  projectId: "scoopygames-60456",
  storageBucket: "scoopygames-60456.firebasestorage.app",
  messagingSenderId: "562779988237",
  appId: "1:562779988237:web:e4ad36fbe1cc926f015044"
};
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* -------------------- DOM refs (defensive) -------------------- */
const chatPanel = document.getElementById('chatPanel');
const chatList = document.getElementById('chatList');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const spectatorSummary = document.getElementById('spectatorSummary');
const spectatorCorrectCountEl = document.getElementById('spectatorCorrectCount');
const spectatorCountEl = document.getElementById('spectatorCount');
const roomValEl = document.getElementById('roomVal');
const buzzerBtn = document.getElementById('buzzerBtn'); // hidden for spectators
const buzzListEl = document.getElementById('buzzList');

/* -------------------- session / URL -------------------- */
const url = new URL(location.href);
let room = (url.searchParams.get('room') || '').toUpperCase().trim();
let name = url.searchParams.get('name') || localStorage.getItem('playerName') || 'Spectator';
const mode = (url.searchParams.get('mode') || '').toLowerCase();

if (!name || !name.trim()) name = 'Spectator';
localStorage.setItem('playerName', name);

// if room param missing, try HUD room value
if (!room && roomValEl && roomValEl.textContent && roomValEl.textContent.trim() !== '—') {
  room = (roomValEl.textContent || '').toUpperCase().trim();
}

/* -------------------- helpers -------------------- */
function normalizeGuess(s){
  return (s||'').toString().toLowerCase().trim()
    .replace(/[^a-z0-9 ]+/gi,'')
    .replace(/\s+/g,' ')
    .trim();
}

const PALETTE = ['#7C5CFF','#4FB6FF','#FF6EA0','#FFD36B','#6DD3FF','#59E1A5','#FF9B6B','#CFE4FF','#A78BFA','#F472B6'];
function colorForKey(key){
  if (!key) key = Math.random().toString(36);
  let h=0;
  for (let i=0;i<key.length;i++){ h = (h<<5) - h + key.charCodeAt(i); h |= 0; }
  return PALETTE[Math.abs(h) % PALETTE.length];
}
function createNameSpan(displayName, key){
  const span = document.createElement('span');
  span.textContent = displayName;
  span.style.color = colorForKey(key || displayName);
  span.style.fontWeight = '800';
  span.style.marginRight = '6px';
  return span;
}

function toast(text, ms=2500){
  let t = document.getElementById('specToast');
  if(!t){
    t = document.createElement('div');
    t.id = 'specToast';
    t.style.position = 'fixed';
    t.style.bottom = '22px';
    t.style.left = '50%';
    t.style.transform = 'translateX(-50%)';
    t.style.padding = '10px 14px';
    t.style.borderRadius = '8px';
    t.style.zIndex = 9999;
    t.style.fontWeight = '800';
    t.style.background = 'linear-gradient(90deg, rgba(10,12,20,0.95), rgba(10,12,20,0.9))';
    t.style.color = '#fff';
    document.body.appendChild(t);
  }
  t.textContent = text;
  t.style.display = 'block';
  clearTimeout(t._timer);
  t._timer = setTimeout(()=> t.style.display = 'none', ms);
}

/* -------------------- unsub handles at module scope (safe cleanup export) -------------------- */
let spectatorChatUnsub = null;
let roomUnsub = null;
let spectatorsUnsub = null;
let buzzUnsub = null;

/* Exported cleanup is safe to call even if we never subscribed */
export function spectatorCleanup() {
  try { if (spectatorChatUnsub) spectatorChatUnsub(); } catch(_) {}
  try { if (roomUnsub) roomUnsub(); } catch(_) {}
  try { if (spectatorsUnsub) spectatorsUnsub(); } catch(_) {}
  try { if (buzzUnsub) buzzUnsub(); } catch(_) {}
}

/* -------------------- STOP here for non-spectator modes -------------------- */
if (mode !== 'spectator') {
  // Player/host chat is handled by game.js
  // Make sure the spectator UI stays hidden/disabled
  if (chatForm) chatForm.style.display = 'none';
  if (chatInput) chatInput.disabled = true;
  if (spectatorSummary) spectatorSummary.style.display = 'none';
  // nothing else to do in this file
} else {
/* ==================== SPECTATOR MODE ONLY ==================== */

  /* -------------------- state -------------------- */
  let myUid = null;
  let mySpectatorDocRef = null;
  let currentFrameIndex = null;
  let currentMovieName = null;
  // add this with the other state vars
let currentRoundIndex = null;


  let _sending = false;
  let spectatorReady = false; // presence created & visible to rules

  /* -------------------- chat UI helpers -------------------- */
  function clearChatUI() { if (chatList) chatList.innerHTML = ''; }
  function clearBuzzUI() { if (buzzListEl) buzzListEl.innerHTML = ''; }

  function appendChatMessage({ uid, name: displayName, text, correct }) {
    if (!chatList) return;
    if (typeof displayName === 'string' && displayName.includes('::')) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'msg';
    if (correct) wrapper.classList.add('correct');

    const nameSpan = createNameSpan(displayName || 'Spectator', uid || displayName);
    wrapper.appendChild(nameSpan);

    const textNode = document.createElement('span');
    textNode.textContent = correct ? ' guessed the movie correct' : `: ${text}`;
    wrapper.appendChild(textNode);

    chatList.appendChild(wrapper);
    chatList.scrollTop = chatList.scrollHeight;
  }

  /* -------------------- buzz list (read-only for spectators) -------------------- */
  async function attachBuzzListenerForFrame(roomCode, frameIndex) {
    if (buzzUnsub) { try{ buzzUnsub(); } catch(_){} buzzUnsub = null; }
    clearBuzzUI();

    if (frameIndex == null) return;
    try {
      const buzzesCol = collection(db, 'rooms', roomCode, 'frames', String(frameIndex), 'buzzes');
      const qy = query(buzzesCol, orderBy('ts','asc'));
      buzzUnsub = onSnapshot(qy, snap => {
        clearBuzzUI();
        if (!snap.size) {
          const p = document.createElement('div');
          p.textContent = 'No buzzes yet';
          p.style.color = '#cfe4ff';
          p.style.padding = '6px 8px';
          if (buzzListEl) buzzListEl.appendChild(p);
          return;
        }
        snap.forEach(docSnap => {
          const data = docSnap.data() || {};
          const li = document.createElement('li');
          li.style.display = 'flex';
          li.style.alignItems = 'center';
          li.style.gap = '8px';

          const initial = document.createElement('div');
          initial.textContent = (data.name || 'P').charAt(0).toUpperCase();
          initial.style.width = '32px';
          initial.style.height = '32px';
          initial.style.borderRadius = '999px';
          initial.style.display = 'flex';
          initial.style.alignItems = 'center';
          initial.style.justifyContent = 'center';
          initial.style.background = colorForKey(data.uid || data.name || 'x');
          initial.style.color = '#08121a';
          initial.style.fontWeight = '900';
          li.appendChild(initial);

          const nameText = document.createElement('div');
          nameText.textContent = `${data.name || 'Player'}`;
          nameText.style.fontWeight = '800';
          li.appendChild(nameText);

          if (buzzListEl) buzzListEl.appendChild(li);
        });
      });
    } catch (e) {
      console.warn('attachBuzzListenerForFrame failed', e);
    }
  }

  /* -------------------- chat subscription (spectator full feed) -------------------- */
  function subscribeChatForFrameSpectator(roomCode, frameIdx, roundIdx) {
  if (!spectatorReady) {
    console.log('subscribeChatForFrameSpectator: spectator not ready — deferring subscription');
    return;
  }
  if (spectatorChatUnsub) { try{ spectatorChatUnsub(); } catch(_){} spectatorChatUnsub = null; }
  if (!roomCode || frameIdx == null || roundIdx == null) { clearChatUI(); return; }

  try {
    const chatsCol = collection(db, 'rooms', roomCode, 'spectatorChats');
    // ✅ strict filter: only messages for THIS frame AND THIS round
    const qy = query(
      chatsCol,
      where('frame', '==', frameIdx),
      where('roundIndex', '==', roundIdx)
    );

    spectatorChatUnsub = onSnapshot(qy, snap => {
      if (!chatList) { console.warn('subscribeChatForFrameSpectator: chatList element not found'); return; }

      const docs = [];
      snap.forEach(d => docs.push({ id: d.id, data: d.data() || {} }));

      docs.sort((a,b) => {
        const ta = a.data.ts && typeof a.data.ts.toMillis === 'function' ? a.data.ts.toMillis() : (a.data.ts || 0);
        const tb = b.data.ts && typeof b.data.ts.toMillis === 'function' ? b.data.ts.toMillis() : (b.data.ts || 0);
        return ta - tb;
      });

      chatList.innerHTML = '';
      if (!docs.length) {
        const placeholder = document.createElement('div');
        placeholder.style.color = '#cfe4ff';
        placeholder.style.padding = '6px 8px';
        placeholder.textContent = 'No chat messages for this frame yet.';
        chatList.appendChild(placeholder);
      } else {
        docs.forEach(docObj => {
          const m = docObj.data || {};
          if (typeof m.name === 'string' && m.name.includes('::')) return;

          const normMovie = normalizeGuess(currentMovieName || '');
          const normText  = normalizeGuess(m.text || '');
          const computedCorrect = !!m.correct || (!!normMovie && normText && normText === normMovie);

          appendChatMessage({
            uid: m.uid,
            name: m.name || 'Spectator',
            text: computedCorrect ? '' : (m.text || ''),
            correct: computedCorrect
          });
        });
      }

      if (chatPanel && chatPanel.classList.contains('hidden')) chatPanel.classList.remove('hidden');
      chatList.scrollTop = chatList.scrollHeight;
    }, (err) => {
      console.warn('spectator chat subscription error', err);
      clearChatUI();
    });

    console.log('Subscribed (spectator) to spectatorChats for frame', frameIdx, 'round', roundIdx);
  } catch (err) {
    console.warn('subscribeChatForFrameSpectator failed', err);
    clearChatUI();
  }
}

  /* -------------------- Disable chat UI until auth/presence ready -------------------- */
  if (chatForm) chatForm.style.display = 'none';
  if (chatInput) chatInput.disabled = true;

  /* Ensure anonymous sign-in is attempted (await) */
  async function ensureAnonymousSignIn() {
    try {
      await signInAnonymously(auth);
      console.log('signInAnonymously: requested');
    } catch (err) {
      console.error('ensureAnonymousSignIn failed', err);
      toast('Authentication failed — chat disabled');
    }
  }
  ensureAnonymousSignIn();

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      console.warn('onAuthStateChanged: no user');
      if (chatForm) chatForm.style.display = 'none';
      if (chatInput) chatInput.disabled = true;
      return;
    }

    myUid = user.uid;
    console.log('Signed in as', myUid);

    if (!room) {
      console.log('No room specified; skipping presence setup');
      return;
    }

    // read room doc early so we have hostUid and index
    const roomRef = doc(db, 'rooms', room);
    let roomSnap = null;
    let roomData = {};
    try {
      roomSnap = await getDoc(roomRef);
      roomData = roomSnap.exists() ? roomSnap.data() : {};
    } catch (e) {
      console.warn('Failed to read room doc during auth flow', e);
    }

    // Host should not create spectator doc
    if (roomData && roomData.hostUid === myUid) {
      console.log('Detected host login — skipping spectator presence creation');
      try {
        const maybeSpecRef = doc(db, 'rooms', room, 'spectators', myUid);
        const maybeSnap = await getDoc(maybeSpecRef);
        if (maybeSnap.exists()) {
          try { await deleteDoc(maybeSpecRef); console.log('Deleted stray spectator doc for host', myUid); } catch(_) {}
        }
      } catch (e) {
        console.warn('Could not cleanup host spectator doc', e);
      }
      spectatorReady = false; // host is not a spectator
    } else {
      // prepare spectator doc ref if room present (non-host)
      mySpectatorDocRef = doc(db, 'rooms', room, 'spectators', myUid);

      try {
        const existing = await getDoc(mySpectatorDocRef);

        if (!existing.exists()) {
          await setDoc(
            mySpectatorDocRef,
            {
              name,
              joinedAt: serverTimestamp(),
              lastCorrectFrame: -1,
              correctCount: 0,
              lastGuessedFrame: -1,
              lastSeenAt: serverTimestamp(),
            },
            { merge: false }
          );
          console.log('Presence doc created for spectator', myUid);
        } else {
          await setDoc(
            mySpectatorDocRef,
            { name, lastSeenAt: serverTimestamp() },
            { merge: true }
          );
          console.log('Presence doc updated for spectator', myUid);
        }

        spectatorReady = true;

      } catch (e) {
        spectatorReady = false;
        console.warn('Could not create/update spectator presence', e);
        toast('Permission or network issue creating presence');
      }
    }

    // spectators count (live)
    try {
      spectatorsUnsub = onSnapshot(collection(db, 'rooms', room, 'spectators'), snap => {
        if (spectatorCountEl) spectatorCountEl.textContent = String(snap.size || 0);
      });
    } catch (e) {
      console.warn('spectatorsUnsub failed', e);
    }

    // room state (for frame index + movie name + counts)
   try {
  roomUnsub = onSnapshot(roomRef, snap => {
    const d = snap.data() || {};
    const newIdx = d.index ?? 0;
    const newRoundIndex = d.roundIndex ?? 0;

    // detect if frame OR round changed
    const frameChanged = (currentFrameIndex !== null && newIdx !== currentFrameIndex);
    const roundChanged = (currentRoundIndex !== null && newRoundIndex !== currentRoundIndex);

    if (frameChanged || roundChanged) {
      console.log(
        `[Spectator] Detected ${roundChanged ? "round" : "frame"} change — clearing old data.`
      );

      // Unsubscribe previous chat listener & clear old data
      if (spectatorChatUnsub) {
        try { spectatorChatUnsub(); } catch (_) {}
        spectatorChatUnsub = null;
      }
      clearChatUI();
      clearBuzzUI();

      // Enable chat box again (new frame, new guesses allowed)
      if (chatInput) chatInput.disabled = false;
    }

    // Update our tracking vars
    currentFrameIndex = newIdx;
    currentRoundIndex = newRoundIndex;

    // Determine current movie for local correctness check
    const pl = d.playlist || [];
    const item = pl[currentFrameIndex];
    currentMovieName = item && typeof item !== 'string' ? (item.name || '') : '';

    // Attach buzz list for this frame
    attachBuzzListenerForFrame(room, currentFrameIndex);

    // Subscribe to the spectator chat for this frame + round
    if (spectatorReady) {
      subscribeChatForFrameSpectator(room, currentFrameIndex, currentRoundIndex);
    } else {
      console.log('room snapshot: spectator-mode but spectator not ready yet; waiting for presence');
    }

    // Update live spectator correct count in UI
    if (spectatorCorrectCountEl)
      spectatorCorrectCountEl.textContent = String(d.spectatorCorrectCount || 0);

  }, (err) => {
    console.warn('room snapshot error', err);
  });
} catch (e) {
  console.warn('roomUnsub failed', e);
}


    // If presence was created after we already had a currentFrameIndex, ensure we subscribe now
    if (spectatorReady && currentFrameIndex != null) {
      subscribeChatForFrameSpectator(room, currentFrameIndex);
    }

    // cleanup presence on unload/visibility
    const cleanupPresence = async () => {
      try { if (mySpectatorDocRef) await deleteDoc(mySpectatorDocRef); } catch (_) {}
    };
    window.addEventListener('beforeunload', cleanupPresence);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'unloading') cleanupPresence();
    });

    // enable spectator chat UI (not for host)
    if (roomData && roomData.hostUid === myUid) {
      console.log('Host viewing page; not enabling spectator UI');
    } else {
      document.body.classList.add('spectator-view');
      if (chatPanel) chatPanel.classList.remove('hidden');
      if (buzzerBtn) buzzerBtn.style.display = 'none'; // spectators don't buzz

      if (chatForm) chatForm.style.display = 'block';
      if (chatInput) chatInput.disabled = !spectatorReady;
    }
  });

  /* -------------------- chat submit handler (guarded) -------------------- */
  chatForm?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (_sending) return;

    // Block if not authenticated or presence not ready
    if (!auth.currentUser || !mySpectatorDocRef || !spectatorReady) {
      toast('Not ready — connecting...');
      return;
    }
    myUid = auth.currentUser.uid;

    const raw = (chatInput?.value || '').trim();
    if (!raw) return;

    const safeName = (name || 'Spectator').slice(0, 40);
    const safeText = raw.slice(0, 120);

    if (chatInput) chatInput.value = '';

    try {
      _sending = true;
      if (chatInput) chatInput.disabled = true;

      const specSnap = await getDoc(mySpectatorDocRef);
      const specData = specSnap.exists() ? (specSnap.data() || {}) : {};
      const lastGuessedFrame = Number(specData.lastGuessedFrame ?? -1);

      const roomRef = doc(db, 'rooms', room);
      const roomSnap = await getDoc(roomRef);
      const d = roomSnap.exists() ? roomSnap.data() : {};
      const idx = d.index ?? 0;
      const roundIdx = d.roundIndex ?? 0; // <-- add this


      if (lastGuessedFrame === idx) {
        toast("You already guessed this frame!");
        return;
      }

      const pl = d.playlist || [];
      const item = pl[idx];
      const movieName = item && typeof item !== 'string' ? (item.name || '') : '';
      const normGuess = normalizeGuess(safeText);
      const normMovie = normalizeGuess(movieName);

      // FIRST mark they used their guess for this frame
      try {
        await setDoc(mySpectatorDocRef, { lastGuessedFrame: idx, lastSeenAt: serverTimestamp() }, { merge: true });
      } catch (e) {
        console.error('Failed to update spectator presence before posting chat', e);
        if (e.code === 'permission-denied') {
          toast('Permissions error — please sign in or contact admin');
          return;
        }
        toast('Network or permission issue — try again');
        return;
      }

      // Always create chat with correct:false (spectator's raw guess)
      const payload = { uid: myUid, name: safeName, text: safeText, ts: serverTimestamp(), frame: idx,  roundIndex: roundIdx,      // <-- add this
 correct: false };
      try {
        await addDoc(collection(db, 'rooms', room, 'spectatorChats'), payload);
      } catch (e) {
        console.error('addDoc spectatorChats failed', e);
        if (e.code === 'permission-denied') {
          toast('Permission denied — presence not ready or rules disallow posting. Try reloading.');
        } else {
          toast('Network error — try again');
        }
        return;
      }

      // If locally correct, update only spectator presence (host processor adjusts room counters)
      if (normMovie && normGuess && normGuess === normMovie) {
        try {
          const specSnap2 = await getDoc(mySpectatorDocRef);
          const lastCorrectFrame = specSnap2.exists() ? (specSnap2.data().lastCorrectFrame ?? -1) : -1;
          const prevCount = specSnap2.exists() ? (specSnap2.data().correctCount || 0) : 0;

          if (lastCorrectFrame !== idx) {
            await setDoc(mySpectatorDocRef, {
              lastCorrectFrame: idx,
              correctCount: prevCount + 1
            }, { merge: true });
          }
        } catch (e) {
          console.error('Client-side correct-guess presence update failed', e);
        }
      }

    } catch (e) {
      console.warn('Failed to send spectator chat (outer)', e);
      toast("Permission or network issue — try again");
    } finally {
      _sending = false;
      if (chatInput) chatInput.disabled = false;
    }
  });

/* ==================== END SPECTATOR MODE ==================== */
}
