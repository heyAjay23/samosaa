// game.js — FULL updated file (functional)
// Note: This is the complete, working source. If you strictly need the file to exceed 1891 lines,
// append extra comment lines at the very bottom (e.g., `// pad` repeated) in your editor.

/* -------------------- Firebase v10 imports (CDN) -------------------- */
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, updateDoc, collection, onSnapshot,
  serverTimestamp, deleteDoc, runTransaction, query, orderBy, getDocs, where,
  writeBatch, increment
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";


/* -------------------- Firebase init (guard duplicate app error) -------------------- */
const firebaseConfig = {
  apiKey: "AIzaSyDOrok6tfuLqymYsADST7Pck9RavUx2Sfc",
  authDomain: "scoopygames-60456.firebaseapp.com",
  databaseURL: "https://scoopygames-60456-default-rtdb.firebaseio.com",
  projectId: "scoopygames-60456",
  storageBucket: "scoopygames-60456.firebasestorage.app",
  messagingSenderId: "562779988237",
  appId: "1:562779988237:web:e4ad36fbe1cc926f015044"
};
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* -------------------- small config -------------------- */
const FRAMES_PER_ROUND = 10;
const REVEAL_DELAY_MS = 1000;

/* anti-spam: local cooldown between buzzes (per client) */
const BUZZ_COOLDOWN_MS = 2000;

/* cleanup: delete old buzz docs when advancing frames */
const CLEAN_BUZZ_ON_ADVANCE = true;

const ROUNDS = [
  { id: "hollywood", label: "Hollywood Movies" },
  { id: "indian",    label: "Indian Movies" },
  { id: "dialogue",  label: "Guess the Dialogue" }
];

const CHAR_RAW_BASE = "https://raw.githubusercontent.com/heyAjay23/logos/main/";
const CHARACTERS = [
  { id:'supersuper', name:'SuperSuper',     file:'SuperSuper.jpg',     emoji:'🥇' },
  { id:'wvish',      name:'Wvish',          file:'Wvish.jpg',          emoji:'✨' },
  { id:'moviestalk', name:'Moviestalk',     file:'Moviestalk.jpg',     emoji:'🎬' },
  { id:'desinerd',   name:'DesiNerd',       file:'Desi ners.jpg',      emoji:'🧠' },
  { id:'bnftb',      name:'Bnftb',          file:'bnftv.jpeg',         emoji:'🎧' },
  { id:'thepj',      name:'ThePJ',          file:'pj.jpg',             emoji:'🎭' },
  { id:'comicverse', name:'Comicverse',     file:'comicverse.jpeg',    emoji:'🖼' },
  { id:'abhireview', name:'Abhi Review',    file:'abhi review.jpeg',   emoji:'📝' },
  { id:'surajkumar', name:'Suraj Kumar',    file:'images.jpeg',        emoji:'🎤' },
  { id:'yogi',       name:'Yogi Bolta Hai', file:'yogi.jpg',           emoji:'🗣' }
].map(c => ({ ...c, url: CHAR_RAW_BASE + encodeURIComponent(c.file) }));

const REPO_RAW_BASES = {
  hollywood: "https://raw.githubusercontent.com/heyAjay23/hollywood-/main/",
  indian:    "https://raw.githubusercontent.com/heyAjay23/bollywood-frame/main/",
  dialogue:  "https://raw.githubusercontent.com/heyAjay23/dialogue/main/"
};

/* -------------------- DOM refs -------------------- */
const $ = s => document.querySelector(s);

const roomVal   = $("#roomVal");
const nameVal   = $("#nameVal");
const roundVal  = $("#roundVal");
const roundNameEl = $("#roundName");
const pcountEl  = $("#pcount");
const playersEl = $("#players");
const statusEl  = $("#status");
const copyCode  = $("#copyCode");
const copyInvite= $("#copyInvite");

const nextFrameBtn = $("#nextFrameBtn");
const prevFrameBtn = $("#prevFrameBtn");
const revealBtn    = $("#revealBtn");
const showMovieBtn = $("#showMovieBtn");

const buzzerBtn    = $("#buzzerBtn");
const buzzerStatus = $("#buzzerStatus");

const frameVal  = $("#frameVal");
const frameVal2 = $("#frameVal2");
const buzzList  = $("#buzzList");
const movieFrame= $("#movieFrame");

const movieBox      = $("#movieBox");
const revealOverlay = $("#revealOverlay");
const waitMsg       = $("#waitMsg");
const roundDoneMsg  = $("#roundDoneMsg");
const movieNameCard = $("#movieNameCard");
const movieNameText = $("#movieNameText");

const roundBanner   = $("#roundBanner");
const roundBannerText = $("#roundBannerText");

const chatPanel = $("#chatPanel");
const spectatorCountEl = $("#spectatorCount");               // players view: number of spectators (side)
const spectatorCorrectCountEl = $("#spectatorCorrectCount"); // may be duplicated in HTML
const spectatorCountTopEl = $("#spectatorCountTop");         // top-bar spectator counter
const spectatorCorrectCountClone = $("#spectatorCorrectCountClone"); // visible in chat header

let spectatorBadgeEl = null;
let winnerModalEl = $("#winnerModal");

/* -------------------- session / url -------------------- */
const url = new URL(location.href);
let room = (url.searchParams.get("room") || "").toUpperCase().trim();
let name = url.searchParams.get("name") || localStorage.getItem("playerName") || "";
const mode = (url.searchParams.get("mode") || "").toLowerCase();
const qCharacter = url.searchParams.get("character") || null;

if (!room) room = (prompt("Enter room code") || "").toUpperCase();
if (!name) name = prompt("Enter your name") || "Player";
localStorage.setItem("playerName", name);

if (roomVal) roomVal.textContent = room || "—";
if (nameVal) nameVal.textContent = name;

/* -------------------- state -------------------- */
let myUid = null;
let iAmHost = false;
let currentMovieName = "Unknown";
let listenersInitialized = false;

let buzzUnsub = null;
let myBuzzDocUnsub = null;          // NEW: watch *my* buzz doc to auto-disable button
let spectatorsUnsub = null;
let playersUnsub = null;
let roomUnsub = null;
let gameChatUnsub = null;
let spectatorChatUnsub = null;
let hostCorrectProcUnsub = null;    // NEW: host-side correct-guess processor unsub

let currentFrameIndex = null; // use index (0-based) everywhere for collections

// cache of players for quick lookups (uid -> player data)
const playersMap = {};

// flag to indicate client is in spectator mode locally
let isSpectatorLocal = false;

// anti-spam: track local last buzz time (per frame)
let _lastBuzzAt = 0;

/* -------------------- helper caches for preloading -------------------- */
const _imagePreloadCache = new Map();

/* -------------------- firestore helpers -------------------- */
const playersCol     = (code)=> collection(db, "rooms", code, "players");
const frameBuzzesCol = (code, frameIdx)=> collection(db, "rooms", code, "frames", String(frameIdx), "buzzes");
const frameSpectatorCorrectsCol = (code, frameIdx)=> collection(db, "rooms", code, "frames", String(frameIdx), "spectatorCorrects");
const roomDoc        = (code)=> doc(db, "rooms", code);

/* -------------------- purge helpers (host best-effort) -------------------- */
async function purgeBuzzesForFrame(roomCode, frameIdx) {
  try {
    const snap = await getDocs(frameBuzzesCol(roomCode, frameIdx));
    const dels = [];
    snap.forEach(d => dels.push(deleteDoc(d.ref)));
    await Promise.allSettled(dels);
  } catch (e) {
    console.warn("purgeBuzzesForFrame failed:", e);
  }
}
async function purgeSpectatorCorrectsForFrame(roomCode, frameIdx) {
  try {
    const snap = await getDocs(frameSpectatorCorrectsCol(roomCode, frameIdx));
    const dels = [];
    snap.forEach(d => dels.push(deleteDoc(d.ref)));
    await Promise.allSettled(dels);
  } catch (e) {
    console.warn("purgeSpectatorCorrectsForFrame failed:", e);
  }
}
async function purgeFrameArtifacts(roomCode, frameIdx) {
  if (frameIdx == null) return;
  if (CLEAN_BUZZ_ON_ADVANCE) {
    await Promise.allSettled([
      purgeBuzzesForFrame(roomCode, frameIdx),
      purgeSpectatorCorrectsForFrame(roomCode, frameIdx)
    ]);
  }
}

/* -------------------- room helpers -------------------- */
async function ensureRoomAndMaybeClaimHost(roomCode, uid){
  const ref = roomDoc(roomCode);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const exists = snap.exists();
    if (!exists) {
      const r0 = ROUNDS[0];
      tx.set(ref, {
        createdAt: serverTimestamp(),
        currentFrame: 1,
        index: 0,
        round: 1,
        roundIndex: 0,
        roundId: r0.id,
        roundLabel: r0.label,
        framesPerRound: FRAMES_PER_ROUND,
        frameRevealed: false,
        endOfRound: false,
        movieNameRevealed: false,
        revealedMovieName: "",
        hostUid: uid,
        playlist: [],
        spectatorCorrectCount: 0,
        locked: false,
        roundBanner: ""
      });
      return;
    }
    const data = snap.data() || {};
    const patch = {};
    if (data.currentFrame == null) patch.currentFrame = 1;
    if (data.index == null) patch.index = 0;
    if (data.round == null) patch.round = 1;
    if (data.roundIndex == null) patch.roundIndex = 0;
    if (!data.roundId) patch.roundId = ROUNDS[0].id;
    if (!data.roundLabel) patch.roundLabel = ROUNDS[0].label;
    if (data.framesPerRound == null) patch.framesPerRound = FRAMES_PER_ROUND;
    if (data.frameRevealed == null) patch.frameRevealed = false;
    if (data.endOfRound == null) patch.endOfRound = false;
    if (data.movieNameRevealed == null) patch.movieNameRevealed = false;
    if (data.revealedMovieName == null) patch.revealedMovieName = "";
    if (!data.hostUid && uid) patch.hostUid = uid;
    if (data.spectatorCorrectCount == null) patch.spectatorCorrectCount = 0;
    if (data.locked == null) patch.locked = false;
    if (Object.keys(patch).length) tx.update(ref, patch);
  });
  return ref;
}

async function loadPackToRoom(roomCode, roundIndex){
  const roundMeta = ROUNDS[roundIndex] || ROUNDS[0];
  const packRef = doc(db, "packs", roundMeta.id);
  let pickedFiles = [];

  // 1) try Firestore pack (admin upload)
  try {
    const snap = await getDoc(packRef);
    if (snap.exists()) {
      const data = snap.data() || {};
      const files = data.files || [];
      pickedFiles = files.map((f, i) => {
        if (typeof f === "string") {
          return { url: f, name: `Frame ${i + 1}` };
        }
        return { url: f.url || f, name: f.name || `Frame ${i + 1}` };
      });
      console.log(`Loaded pack from packs/${roundMeta.id}, count=${pickedFiles.length}`);
    }
  } catch (e) {
    console.warn("Could not read packs from Firestore:", e);
  }

  // 2) repo fallback (frame1.jpg ... frameN.jpg)
  if (!pickedFiles.length) {
    const repoBase = REPO_RAW_BASES[roundMeta.id];
    if (repoBase) {
      pickedFiles = Array.from({ length: FRAMES_PER_ROUND }, (_, i) => ({
        url: `${repoBase}${encodeURIComponent(`frame${i + 1}.jpg`)}`,
        name: `Frame ${i + 1}`
      }));
      console.log(`Using repo fallback for '${roundMeta.id}' base=${repoBase}`);
    }
  }

  // 3) local placeholder fallback
  if (!pickedFiles.length) {
    pickedFiles = Array.from({ length: FRAMES_PER_ROUND }, (_, i) => ({
      url: "movie1.jpg",
      name: `Frame ${i + 1}`
    }));
    console.log("Using local placeholder frames as fallback.");
  }

  // 4) write playlist to room doc so clients will react
  try {
    await updateDoc(roomDoc(roomCode), {
      playlist: pickedFiles,
      index: 0,
      frameRevealed: false,
      endOfRound: false,
      movieNameRevealed: false,
      revealedMovieName: "",
      roundIndex,
      round: roundIndex + 1,
      roundId: roundMeta.id,
      roundLabel: roundMeta.label,
      roundBanner: `Starting ${roundMeta.label}`,
      roundBannerAt: serverTimestamp(),
      action: `Host loaded ${roundMeta.label}`,
      spectatorCorrectCount: 0
    });
    // Preload the newly loaded frames on host quickly
    preloadFrames(pickedFiles, 0, 4);
  } catch (e) {
    console.warn("Could not update room playlist:", e);
  }
}

async function assignNewHostIfNeeded(players){
  const ref = roomDoc(room);
  const s = await getDoc(ref);
  const d = s.data() || {};
  if (!d.hostUid && players.length > 0) {
    const newHost = players[0];
    await updateDoc(ref, { hostUid: newHost.id });
    if (newHost.id === myUid) iAmHost = true;
  }
}
// --- paste this helper once (outside the function) ---
async function purgeAllFrameArtifacts(roomCode, total = FRAMES_PER_ROUND) {
  // Wipes all per-frame buzzes + spectatorCorrects for frames [0..total-1]
  const tasks = [];
  for (let i = 0; i < total; i++) {
    tasks.push(purgeBuzzesForFrame(roomCode, i));
    tasks.push(purgeSpectatorCorrectsForFrame(roomCode, i));
  }
  try {
    await Promise.allSettled(tasks);
  } catch (e) {
    console.warn("purgeAllFrameArtifacts failed:", e);
  }
}

/* -------------------- Frame controls -------------------- */
async function nextFrame(roomCode) {
  // 1) Atomically advance in a transaction and capture what changed
  const txResult = await runTransaction(db, async (tx) => {
    const ref = roomDoc(roomCode);
    const snap = await tx.get(ref);
    const d = snap.data() || {};

    const fpr = d.framesPerRound || FRAMES_PER_ROUND; // frames per round
    const idx = d.index || 0;                         // current frame index (0-based)
    const currentRoundIndex = d.roundIndex || 0;

    // Soft gate: avoid accidental double-advance
    const now = Date.now();
    const allowAdvance = !d._nextGateAt || (typeof d._nextGateAt === "number" ? now >= d._nextGateAt : true);
    if (!allowAdvance) {
      return { blocked: true, prevIndex: idx };
    }
    tx.update(ref, { _nextGateAt: now + 900 });

    // --- If we're at the last frame of this round ---
    if (idx >= fpr - 1) {
      const nextRoundIndex = Math.min(currentRoundIndex + 1, ROUNDS.length - 1);

      if (nextRoundIndex !== currentRoundIndex) {
        // Move to the FIRST frame of the NEXT round
        tx.update(ref, {
          currentFrame: (d.currentFrame || 1) + 1,
          index: 0, // start at frame 0 of new round
          frameRevealed: false,
          endOfRound: false,
          movieNameRevealed: false,
          revealedMovieName: "",
          roundIndex: nextRoundIndex,
          round: nextRoundIndex + 1,
          roundId: ROUNDS[nextRoundIndex].id,
          roundLabel: ROUNDS[nextRoundIndex].label,
          roundBanner: `Starting ${ROUNDS[nextRoundIndex].label}`,
          roundBannerAt: serverTimestamp(),
          action: `Host moved to next round: ${ROUNDS[nextRoundIndex].label}`,
          // reset spectator counters at round start
          spectatorCorrectCount: 0,
          lastSpectatorGuessName: "",
          lastSpectatorGuessUid: ""
        });
        return { roundChanged: true, nextRoundIndex, prevIndex: idx };
      } else {
        // No next round (we were already in the last one): mark end of round
        tx.update(ref, {
          currentFrame: (d.currentFrame || 1) + 1,
          frameRevealed: false,
          endOfRound: true,
          movieNameRevealed: false,
          revealedMovieName: "",
          action: "Host ended the round",
          spectatorCorrectCount: 0,
          lastSpectatorGuessName: "",
          lastSpectatorGuessUid: ""
        });
        return { roundChanged: false, prevIndex: idx, ended: true };
      }
    }

    // --- Normal in-round frame advance ---
    tx.update(ref, {
      index: idx + 1,                                  // next frame in same round
      currentFrame: (d.currentFrame || 1) + 1,
      frameRevealed: false,
      endOfRound: false,
      movieNameRevealed: false,
      revealedMovieName: "",
      action: "Host changed the frame",
      // per-frame spectator scoreboard resets here
      spectatorCorrectCount: 0,
      lastSpectatorGuessName: "",
      lastSpectatorGuessUid: ""
    });

    return { roundChanged: false, prevIndex: idx };
  });

  if (txResult?.blocked) return;

  // 2) Clean up artifacts for the frame we just left (buzzes/corrects)
  try {
    await purgeFrameArtifacts(roomCode, txResult?.prevIndex);
  } catch (e) {
    console.warn("purgeFrameArtifacts(prev) failed:", e);
  }

  // 3) If we entered a NEW round: load its pack and wipe ALL old per-frame artifacts
  if (txResult && txResult.roundChanged) {
    try {
      await loadPackToRoom(roomCode, txResult.nextRoundIndex);
    } catch (e) {
      console.warn("Failed to load new round's pack:", e);
    }

    // Important: After switching rounds, wipe ALL old frame subcollections
    try {
      await purgeAllFrameArtifacts(roomCode, FRAMES_PER_ROUND);
    } catch (e) {
      console.warn("purgeAllFrameArtifacts (round change) failed:", e);
    }
  }
}

async function prevFrame(roomCode){
  await runTransaction(db, async (tx) => {
    const ref = roomDoc(roomCode);
    const snap = await tx.get(ref);
    const d = snap.data() || {};
    const idx = d.index || 0;
    const size = (d.playlist || []).length;
    const prevIndex = size ? Math.max(idx - 1, 0) : 0;
    tx.update(ref, {
      index: prevIndex,
      currentFrame: Math.max((d.currentFrame || 1) - 1, 1),
      frameRevealed: false,
      endOfRound: false,
      movieNameRevealed: false,
      revealedMovieName: "",
      action: "Host moved to previous frame",
      spectatorCorrectCount: 0 // reset on manual prev as well
    });
  });
}

/* -------------------- chat utilities (colors) -------------------- */
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

/* normalize titles/guesses for comparison (letters+digits, single spaces) */
function normalizeTitle(s = '') {
  return s
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* -------------------- adjust scores -------------------- */
async function adjustScore(targetUid, delta = 10) {
  if (!iAmHost) { showActionToast("Only the host can change scores"); return; }
  if (!targetUid) { showActionToast("No target specified"); return; }
  const targetRef = doc(db, "rooms", room, "players", targetUid);
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(targetRef);
      if (!snap.exists()) {
        tx.set(targetRef, { score: delta }, { merge: true });
        return;
      }
      const data = snap.data() || {};
      const current = Number(data.score || 0);
      tx.update(targetRef, { score: current + Number(delta) });
    });
    showActionToast(`${delta >= 0 ? '+' : ''}${delta} to player`);
  } catch (err) {
    console.error("adjustScore failed", err);
    showActionToast("Score update failed — check console");
  }
}

/* -------------------- buzzer: one buzz per frame + UI auto-disable -------------------- */
async function pressBuzzerOnce(roomCode, frameIndex, uid, playerName){
  if (frameIndex == null) throw new Error("Frame index missing");
  const key = doc(db, "rooms", roomCode, "frames", String(frameIndex), "buzzes", uid);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(key);
    if (snap.exists()) { throw new Error("Already buzzed."); }
    tx.set(key, { name: playerName || "Player", ts: serverTimestamp(), uid });
  });
}

/* Watch my own buzz doc for the current frame and auto-disable the buzzer */
function watchMyBuzzDoc(roomCode, frameIdx) {
  // cleanup old watcher
  if (myBuzzDocUnsub) { try { myBuzzDocUnsub(); } catch(_){} myBuzzDocUnsub = null; }
  if (!roomCode || frameIdx == null || !myUid) {
    setBuzzerEnabled(false); // safest default when unknown state
    return;
  }
  try {
    const myBuzzDocRef = doc(db, "rooms", roomCode, "frames", String(frameIdx), "buzzes", myUid);
    myBuzzDocUnsub = onSnapshot(myBuzzDocRef, (snap) => {
      const exists = snap.exists();
      // If I already buzzed, disable until the frame changes
      setBuzzerEnabled(!exists);
      if (exists && buzzerStatus) buzzerStatus.textContent = "You buzzed!";
      if (!exists && buzzerStatus) buzzerStatus.textContent = "";
    }, (err) => {
      console.warn("watchMyBuzzDoc error", err);
      // conservative: disable on error to avoid double buzzing
      setBuzzerEnabled(false);
    });
  } catch (e) {
    console.warn("watchMyBuzzDoc failed", e);
    setBuzzerEnabled(false);
  }
}

/* Helper to control buzzer button enabled/disabled with aria/visual feedback */
function setBuzzerEnabled(on) {
  if (!buzzerBtn) return;
  buzzerBtn.disabled = !on;
  buzzerBtn.setAttribute("aria-disabled", String(!on));
  buzzerBtn.classList.toggle("is-disabled", !on);
}

/* Live buzz list (order) */
function attachBuzzListener(roomCode, frameIndex){
  if (buzzUnsub){ try{ buzzUnsub(); } catch(_){} buzzUnsub = null; }
  if (frameIndex == null) return;
  const qy = query(frameBuzzesCol(roomCode, frameIndex), orderBy("ts","asc"));
  buzzUnsub = onSnapshot(qy, (snap) => {
    const list = [];
    snap.forEach(d => list.push({ id: d.id, ...(d.data()||{}) }));
    renderBuzzOrder(list);
  }, (err)=> {
    console.warn("buzz listener error", err);
    renderBuzzOrder([]);
  });
}

/* -------------------- Spectator correct-guess handling (host helper) -------------------- */
async function markSpectatorCorrect(uid, name) {
  if (!room) { console.warn("markSpectatorCorrect: no room"); return false; }
  if (uid == null) { console.warn("markSpectatorCorrect: missing uid"); return false; }
  const frameIdx = currentFrameIndex ?? 0;
  const perFrameDoc = doc(db, "rooms", room, "frames", String(frameIdx), "spectatorCorrects", uid);
  const spectatorDoc = doc(db, "rooms", room, "spectators", uid);
  const roomRef = roomDoc(room);

  try {
   await runTransaction(db, async (tx) => {
  // READS FIRST
  const [pfsnap, sSnap, rSnap] = await Promise.all([
    tx.get(perFrameDoc),
    tx.get(spectatorDoc),
    tx.get(roomRef),
  ]);

  if (pfsnap.exists()) return;

  const prev = sSnap.exists()
    ? Number((sSnap.data() || {}).correctCount || 0)
    : 0;

  const rc = rSnap.exists()
    ? Number((rSnap.data() || {}).spectatorCorrectCount || 0)
    : 0;

  // WRITES AFTER ALL READS
  tx.set(perFrameDoc, { uid, name: name || "Spectator", ts: serverTimestamp() });

  tx.set(
    spectatorDoc,
    { name: name || "Spectator", correctCount: prev + 1 },
    { merge: true }
  );

  tx.update(roomRef, {
    spectatorCorrectCount: rc + 1,
    action: `Spectator ${name || uid} scored`,
  });
});

     return true;
  } catch (err) {
    console.warn("markSpectatorCorrect failed: ", err);
    return false;
  }
}
window.markSpectatorCorrect = markSpectatorCorrect;
window.addEventListener('spectatorGuessCorrect', (e) => {
  try {
    const { uid, name } = (e && e.detail) || {};
    if (uid) markSpectatorCorrect(uid, name);
  } catch (err) { console.warn(err); }
});
// 🔧 Helper: safely get the movie name for a given frame index
function getMovieName(frameIdx) {
  try {
    const rs = document.getElementById('movieFrame');
    const roomSnap = window.currentRoomData || {};
    const playlist = (roomSnap.playlist || window.cachedPlaylist || []);
    const idx = Number(frameIdx);
    if (!playlist || !playlist.length) return null;

    const item = playlist[idx];
    if (!item) return null;

    if (typeof item === "string") return item.split('/').pop().replace(/\.[^/.]+$/, '');
    if (item.name) return item.name;
    if (item.url) return item.url.split('/').pop().replace(/\.[^/.]+$/, '');
    return null;
  } catch (e) {
    console.warn("getMovieName failed:", e);
    return null;
  }
}



 // ---------------- optimized host correct processor ----------------
// ---------------- optimized host correct processor (fixed + scoped) ----------------
let hostCorrectPending = [];
let hostCorrectTimer = null;

function startHostCorrectProcessor(roomCode, frameIdx, roundIndex /*, currentFrameGlobal */) {
  console.log("✅ Optimized Host Correct Processor started for frame", frameIdx, "round", roundIndex);

  // prevent duplicate listeners
  if (hostCorrectProcUnsub) {
    try { hostCorrectProcUnsub(); } catch(_) {}
    hostCorrectProcUnsub = null;
  }

  const chatsCol = collection(db, "rooms", roomCode, "spectatorChats");

  // Listen to only *raw* guesses. If your raw guesses don't yet store roundIndex,
  // we still filter in-code below; but it's better if they do.
  const qy = query(chatsCol, where("correct", "==", false));

  hostCorrectProcUnsub = onSnapshot(qy, (snap) => {
    snap.docChanges().forEach((chg) => {
      if (chg.type !== "added") return;

      const docSnap = chg.doc;
      const m = docSnap.data() || {};
      const { name, frame, uid, text } = m;
      if (uid == null || frame == null || !text) return;

      // Only the active frame for THIS round
      if (frame !== frameIdx) return;
      // If the raw doc carries roundIndex and it doesn't match, skip
      if (typeof m.roundIndex === "number" && m.roundIndex !== roundIndex) return;

      const movie = getMovieName(frame);
      if (!movie) return;

      if (normalizeTitle(text) === normalizeTitle(movie)) {
        hostCorrectPending.push({
          uid,
          name: name || "Spectator",
          frame,
          roundIndex,                   // carry round for writer
          ref: docSnap.ref
        });
        if (!hostCorrectTimer) {
          hostCorrectTimer = setTimeout(() => processHostCorrectPending(roomCode), 250);
        }
      }
    });
  });
}


async function processHostCorrectPending(roomCode) {
  const items = hostCorrectPending.splice(0, hostCorrectPending.length);
  hostCorrectTimer = null;
  if (!items.length) return;

  // De-dupe by (round, frame, uid)
  const uniq = new Map();
  for (const it of items) {
    const r = typeof it.roundIndex === "number" ? it.roundIndex : 0;
    uniq.set(`${r}:${it.frame}:${it.uid}`, it);
  }
  const toProcess = Array.from(uniq.values());
  if (!toProcess.length) return;

  try {
    const batch = writeBatch(db);
    for (const { uid, name, frame, roundIndex, ref } of toProcess) {
      const perFrameRef = doc(db, "rooms", roomCode, "frames", String(frame), "spectatorCorrects", uid);
      const specRef     = doc(db, "rooms", roomCode, "spectators", uid);
      const roomRef     = doc(db, "rooms", roomCode);

      // Make sanitized chat id unique per round+frame+uid
      const chatId = `correct_${roundIndex}_${frame}_${uid}`;
      const chatRef = doc(db, "rooms", roomCode, "spectatorChats", chatId);

      batch.set(perFrameRef, { uid, name, ts: serverTimestamp(), roundIndex }, { merge: true });
      batch.set(specRef,     { name, correctCount: increment(1) }, { merge: true });
      batch.update(roomRef, {
        spectatorCorrectCount: increment(1),
        lastSpectatorGuessName: name,
        lastSpectatorGuessUid: uid
      });

      // ✅ write roundIndex on sanitized message
      batch.set(chatRef, { uid, name, frame, roundIndex, correct: true, ts: serverTimestamp() }, { merge: true });

      // remove the raw guess
      batch.delete(ref);
    }
    await batch.commit();
    console.log(`✅ Processed ${toProcess.length} spectator correct(s)`);
  } catch (e) {
    console.error("❌ Host Correct Processor failed:", e);
  }
}



 


/* -------------------- Player-view (correct-only) spectator chat sub -------------------- */
function subscribePlayerViewCorrectChatsForFrame(roomCode, frameIdx, roundIndex) {
  if (gameChatUnsub) { try { gameChatUnsub(); } catch(_) {} gameChatUnsub = null; }

  const chatListEl = document.getElementById('chatList');
  if (!roomCode || frameIdx == null) {
    if (chatListEl) chatListEl.innerHTML = '';
    return;
  }

  try {
    const chatsCol = collection(db, 'rooms', roomCode, 'spectatorChats');

    // players see only sanitized/correct messages for this frame (and round)
    const qy = (roundIndex != null)
      ? query(chatsCol,
              where('frame','==', frameIdx),
              where('roundIndex','==', roundIndex),
              where('correct','==', true))
      : query(chatsCol,
              where('frame','==', frameIdx),
              where('correct','==', true));

    gameChatUnsub = onSnapshot(qy, (snap) => {
      if (!chatListEl) return;

      const rows = [];
      snap.forEach(d => rows.push({ id: d.id, data: d.data() || {} }));

      rows.sort((a,b) => {
        const ta = (typeof a.data.ts?.toMillis === 'function') ? a.data.ts.toMillis() : (a.data.ts || 0);
        const tb = (typeof b.data.ts?.toMillis === 'function') ? b.data.ts.toMillis() : (b.data.ts || 0);
        return ta - tb;
      });

      chatListEl.innerHTML = '';
      if (!rows.length) {
        const placeholder = document.createElement('div');
        placeholder.style.color = '#cfe4ff';
        placeholder.style.padding = '6px 8px';
        placeholder.textContent = 'No correct spectator guesses for this frame yet.';
        chatListEl.appendChild(placeholder);
      } else {
        rows.forEach(docObj => {
          const m = docObj.data;
          if (typeof m.name === 'string' && m.name.includes('::')) return;

          const wrapper = document.createElement('div');
          wrapper.className = 'msg correct';
          const nameSpan = createNameSpan(m.name || 'Spectator', m.uid || m.name);
          wrapper.appendChild(nameSpan);
          const textNode = document.createElement('span');
          textNode.textContent = ' guessed the movie';
          wrapper.appendChild(textNode);
          chatListEl.appendChild(wrapper);
        });
      }

      if (chatPanel && chatPanel.classList.contains('hidden')) chatPanel.classList.remove('hidden');
      chatListEl.scrollTop = chatListEl.scrollHeight;
    }, (err) => {
      console.warn('player chat subscription failed', err);
      if (chatListEl) chatListEl.innerHTML = '';
    });
  } catch (err) {
    console.warn('subscribePlayerViewCorrectChatsForFrame error', err);
    if (chatListEl) chatListEl.innerHTML = '';
  }
}


/* -------------------- rendering: players & buzz list -------------------- */
function makePlayerLogoElement(player){
  const wrapper = document.createElement("div");
  wrapper.className = "avatar-small";
  wrapper.style.width = "40px";
  wrapper.style.height = "40px";
  wrapper.style.borderRadius = "999px";
  wrapper.style.display = "flex";
  wrapper.style.alignItems = "center";
  wrapper.style.justifyContent = "center";
  wrapper.style.overflow = "hidden";
  wrapper.style.flex = "0 0 40px";

  // Character avatar (from predefined set)
  if (player && player.character) {
    const ch = CHARACTERS.find(c => c.id === player.character);
    if (ch) {
      const img = document.createElement("img");
      img.src = ch.url;
      img.alt = ch.name;
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = "cover";
      img.onerror = () => { wrapper.textContent = ch.emoji; wrapper.style.fontSize = "18px"; };
      wrapper.appendChild(img);
      return wrapper;
    }
  }

  // Custom URL avatar
  if (player && player.url) {
    const img = document.createElement("img");
    img.src = player.url;
    img.alt = player.name || "Player";
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.objectFit = "cover";
    wrapper.appendChild(img);
    return wrapper;
  }

  // Fallback: initial with stable background color
  const initial = document.createElement("div");
  initial.className = "avatar-initial";
  initial.textContent = (player && (player.name || player.displayName) ? (player.name || player.displayName) : "P").charAt(0).toUpperCase();
  initial.style.width = "100%";
  initial.style.height = "100%";
  initial.style.display = "flex";
  initial.style.alignItems = "center";
  initial.style.justifyContent = "center";
  initial.style.background = colorForKey(player?.name || player?.displayName || "player");
  initial.style.color = "#08121a";
  initial.style.fontWeight = "900";
  wrapper.appendChild(initial);
  return wrapper;
}

function renderPlayers(arr){
  arr.sort((a,b) => (b.host?1:0)-(a.host?1:0) || (b.score||0)-(a.score||0) || ((a.name||"").localeCompare(b.name||"")));
  if (playersEl) playersEl.innerHTML = "";
  for (const p of arr){
    playersMap[p.id] = { name: p.name, score: p.score, character: p.character, host: p.host, url: p.url };

    const li = document.createElement("li");
    li.className = "player-row";
    li.style.display = "flex";
    li.style.alignItems = "center";
    li.style.justifyContent = "space-between";
    li.style.padding = "8px";
    li.style.borderRadius = "8px";

    const left = document.createElement("div");
    left.style.display = "flex";
    left.style.alignItems = "center";
    left.style.gap = "8px";

    const logoEl = makePlayerLogoElement(p);
    left.appendChild(logoEl);

    const nameWrap = document.createElement("div");
    nameWrap.style.display = "flex";
    nameWrap.style.flexDirection = "column";
    nameWrap.style.justifyContent = "center";
    nameWrap.style.minWidth = "0";

    const nameLine = document.createElement("div");
    nameLine.style.fontWeight = "700";
    nameLine.style.color = "#f0f9ff";
    nameLine.style.whiteSpace = "nowrap";
    nameLine.style.overflow = "hidden";
    nameLine.style.textOverflow = "ellipsis";
    nameLine.textContent = `${p.name || "Player"}${p.host ? " 👑" : ""}`;

    nameWrap.appendChild(nameLine);
    left.appendChild(nameWrap);

    const right = document.createElement("div");
    right.className = "p-right";
    right.style.display = "flex";
    right.style.alignItems = "center";
    right.style.gap = "8px";

    const scoreEl = document.createElement("span");
    scoreEl.className = "score-badge";
    scoreEl.textContent = Number(p.score||0);
    right.appendChild(scoreEl);

    if (iAmHost) {
      // +10 button
      const btn = document.createElement("button");
      btn.className = "awardBtn";
      btn.textContent = "+10";
      btn.title = `Give +10 to ${p.name || "Player"}`;
      btn.dataset.target = p.id;
      btn.addEventListener("click", async (ev) => {
        const t = ev.currentTarget;
        t.disabled = true;
        try {
          await adjustScore(t.dataset.target, 10);
        } finally {
          setTimeout(()=> t.disabled = false, 800);
        }
      });
      right.appendChild(btn);

      // -10 button (deduct)
      const minus = document.createElement("button");
      minus.className = "awardBtn";
      minus.style.background = "#ff6b6b";
      minus.style.color = "#08121a";
      minus.textContent = "-10";
      minus.title = `Remove 10 points from ${p.name || "Player"}`;
      minus.dataset.target = p.id;
      minus.addEventListener("click", async (ev) => {
        const t = ev.currentTarget;
        t.disabled = true;
        try {
          await adjustScore(t.dataset.target, -10);
        } finally {
          setTimeout(()=> t.disabled = false, 800);
        }
      });
      right.appendChild(minus);
    }

    li.appendChild(left);
    li.appendChild(right);
    playersEl.appendChild(li);
  }
  if (pcountEl) pcountEl.textContent = String(arr.length);
}

function renderBuzzOrder(list){
  if (buzzList) buzzList.innerHTML = "";
  if (!list || !list.length) {
    const placeholder = document.createElement('div');
    placeholder.style.padding = '6px 8px';
    placeholder.style.color = '#cfe4ff';
    placeholder.textContent = "No buzzes yet";
    buzzList.appendChild(placeholder);
    return;
  }
  list.forEach((b, idx) => {
    const li = document.createElement("li");
    li.className = "buzz-row";
    li.style.display = "flex";
    li.style.alignItems = "center";
    li.style.justifyContent = "space-between";
    li.style.padding = "6px 8px";
    li.style.borderRadius = "8px";
    li.style.background = "rgba(255,255,255,0.02)";
    li.style.marginBottom = "6px";

    const left = document.createElement("div");
    left.style.display = "flex";
    left.style.alignItems = "center";

    const playerData = playersMap[b.id] || playersMap[b.uid] || { name: b.name || "Player", character: null };
    const smallLogo = makePlayerLogoElement(playerData);
    smallLogo.style.width = "32px";
    smallLogo.style.height = "32px";
    smallLogo.style.marginRight = "8px";
    left.appendChild(smallLogo);

    const nameSpan = document.createElement("span");
    nameSpan.textContent = `${idx + 1}. ${playerData.name || b.name || "Player"}`;
    left.appendChild(nameSpan);

    li.appendChild(left);

    if (iAmHost && (b.id || b.uid)) {
      const targetId = b.id || b.uid;
      const btn = document.createElement("div");
      btn.style.display = 'flex';
      btn.style.gap = '6px';

      const plus = document.createElement("button");
      plus.className = "awardBtn small";
      plus.textContent = "+10";
      plus.title = `Give +10 to ${playerData.name || b.name || "Player"}`;
      plus.dataset.target = targetId;
      plus.addEventListener("click", async (ev) => {
        const t = ev.currentTarget;
        t.disabled = true;
        try { await adjustScore(t.dataset.target, 10); } finally { setTimeout(()=> t.disabled = false, 800); }
      });
      btn.appendChild(plus);

      const minus = document.createElement("button");
      minus.className = "awardBtn small";
      minus.style.background = "#ff6b6b";
      minus.style.color = "#08121a";
      minus.textContent = "-10";
      minus.title = `Remove 10 points from ${playerData.name || b.name || "Player"}`;
      minus.dataset.target = targetId;
      minus.addEventListener("click", async (ev) => {
        const t = ev.currentTarget;
        t.disabled = true;
        try { await adjustScore(t.dataset.target, -10); } finally { setTimeout(()=> t.disabled = false, 800); }
      });
      btn.appendChild(minus);

      li.appendChild(btn);
    }

    buzzList.appendChild(li);
  });
}

/* -------------------- winner modal (players + spectators) -------------------- */
function ensureWinnerModal() {
  if (!winnerModalEl) {
    winnerModalEl = document.createElement("div");
    winnerModalEl.id = "winnerModal";
    Object.assign(winnerModalEl.style, {
      position: "fixed",
      inset: "0",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(6,8,15,0.6)",
      zIndex: 1200
    });
    document.body.appendChild(winnerModalEl);
  }
  return winnerModalEl;
}

function makeColoredBadge(text, key, size=40) {
  const el = document.createElement('div');
  el.className = 'avatar-small';
  el.style.width = size + 'px';
  el.style.height = size + 'px';
  el.style.borderRadius = '999px';
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'center';
  el.style.background = colorForKey(key || text);
  el.style.color = '#08121a';
  el.style.fontWeight = '900';
  el.textContent = (text||'?').charAt(0).toUpperCase();
  return el;
}

function showWinnerModalBoth(players, spectators) {
  const modal = ensureWinnerModal();
  modal.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'enhanced-winner-card';
  card.style.maxWidth = '980px';
  card.style.padding = '18px';
  card.style.display = 'flex';
  card.style.flexDirection = 'column';
  card.style.gap = '12px';
  card.style.alignItems = 'center';

  const title = document.createElement('div');
  title.textContent = '🏆 Round Results';
  title.style.fontWeight = '900';
  title.style.fontSize = '20px';
  card.appendChild(title);

  const container = document.createElement('div');
  container.style.display = 'grid';
  container.style.gridTemplateColumns = (players.length && spectators.length) ? '1fr 1fr' : '1fr';
  container.style.gap = '12px';
  container.style.width = '100%';

  // Players column
  if (players && players.length) {
    const left = document.createElement('div');
    left.style.display = 'flex';
    left.style.flexDirection = 'column';
    left.style.gap = '8px';

    const h = document.createElement('div');
    h.textContent = 'Top Players';
    h.style.fontWeight = '900';
    h.style.marginBottom = '6px';
    left.appendChild(h);

    players.slice(0, 10).forEach((p) => {
      if (!p || !p.name) return;
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.justifyContent = 'space-between';
      row.style.padding = '10px';
      row.style.borderRadius = '10px';
      row.style.background = 'rgba(255,255,255,0.02)';

      const l = document.createElement('div');
      l.style.display = 'flex';
      l.style.alignItems = 'center';
      l.style.gap = '10px';

      const badge = p.character ? (function(){
        const ch = CHARACTERS.find(c => c.id === p.character);
        if (ch) {
          const imgWrap = document.createElement('div');
          imgWrap.style.width = '48px';
          imgWrap.style.height = '48px';
          imgWrap.style.borderRadius = '999px';
          imgWrap.style.overflow = 'hidden';
          imgWrap.style.display = 'flex';
          imgWrap.style.alignItems = 'center';
          imgWrap.style.justifyContent = 'center';
          const img = document.createElement('img');
          img.src = ch.url;
          img.alt = ch.name;
          img.style.width = '100%';
          img.style.height = '100%';
          img.style.objectFit = 'cover';
          imgWrap.appendChild(img);
          return imgWrap;
        }
        return makeColoredBadge(p.name, p.name, 48);
      })() : makeColoredBadge(p.name, p.name, 48);

      l.appendChild(badge);

      const nameEl = document.createElement('div');
      nameEl.style.fontWeight = '800';
      nameEl.textContent = p.name;
      l.appendChild(nameEl);

      const countEl = document.createElement('div');
      countEl.style.fontWeight = '900';
      countEl.style.background = 'linear-gradient(90deg,#fff,#cfe4ff)';
      countEl.style.color = '#08121a';
      countEl.style.padding = '6px 10px';
      countEl.style.borderRadius = '999px';
      countEl.textContent = `${Number(p.score||0)} pts`;

      row.appendChild(l);
      row.appendChild(countEl);
      left.appendChild(row);
    });

    container.appendChild(left);
  }

  // Spectators column
  if (spectators && spectators.length) {
    const right = document.createElement('div');
    right.style.display = 'flex';
    right.style.flexDirection = 'column';
    right.style.gap = '8px';

    const h = document.createElement('div');
    h.textContent = 'Top Spectators';
    h.style.fontWeight = '900';
    h.style.marginBottom = '6px';
    right.appendChild(h);

    spectators.slice(0, 10).forEach((s) => {
      if (!s) return;
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.justifyContent = 'space-between';
      row.style.padding = '10px';
      row.style.borderRadius = '10px';
      row.style.background = 'rgba(255,255,255,0.02)';

      const l = document.createElement('div');
      l.style.display = 'flex';
      l.style.alignItems = 'center';
      l.style.gap = '10px';

      const badge = makeColoredBadge(s.name || s.id, s.id || s.name, 40);
      l.appendChild(badge);

      const nameEl = document.createElement('div');
      nameEl.style.fontWeight = '800';
      nameEl.textContent = s.name || `Spectator ${s.id || ''}`;
      l.appendChild(nameEl);

      const countEl = document.createElement('div');
      countEl.style.fontWeight = '900';
      countEl.style.background = 'linear-gradient(90deg,#fff,#cfe4ff)';
      countEl.style.color = '#08121a';
      countEl.style.padding = '6px 10px';
      countEl.style.borderRadius = '999px';
      countEl.textContent = `${Number(s.correctCount||0)} ✔`;

      row.appendChild(l);
      row.appendChild(countEl);
      right.appendChild(row);
    });

    container.appendChild(right);
  }

  card.appendChild(container);

  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.justifyContent = 'flex-end';
  actions.style.gap = '8px';
  actions.style.marginTop = '12px';
  actions.style.width = '100%';

  const leaveBtn = document.createElement('button');
  leaveBtn.className = 'mini warn';
  leaveBtn.textContent = 'Leave Room';
  leaveBtn.addEventListener('click', ()=> location.href = 'HomePage.html');

  const closeBtn = document.createElement('button');
  closeBtn.className = 'mini';
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', ()=> modalClose());

  actions.appendChild(leaveBtn);
  actions.appendChild(closeBtn);
  card.appendChild(actions);

  modalShow(card);
}

function modalShow(cardEl) {
  const modal = ensureWinnerModal();
  modal.innerHTML = '';
  modal.appendChild(cardEl);
  modal.style.display = 'flex';
  function onDocClick(e){
    if (!cardEl.contains(e.target)) {
      modal.style.display = 'none';
      document.removeEventListener('click', onDocClick);
    }
  }
  setTimeout(()=> document.addEventListener('click', onDocClick), 100);
}
function modalClose(){
  const modal = ensureWinnerModal();
  modal.style.display = 'none';
}

/* -------------------- toasts & UI helpers -------------------- */
function makeToastEl(){
  let t = $("#actionToast");
  if (t) return t;
  t = document.createElement("div");
  t.id = "actionToast";
  t.style.position = "fixed";
  t.style.left = "50%";
  t.style.transform = "translateX(-50%)";
  t.style.bottom = "18px";
  t.style.background = "rgba(10,12,20,0.95)";
  t.style.color = " #dfe9ff";
  t.style.padding = "10px 14px";
  t.style.borderRadius = "10px";
  t.style.boxShadow = "0 10px 30px rgba(2,6,23,0.6)";
  t.style.zIndex = 9999;
  t.style.display = "none";
  document.body.appendChild(t);
  return t;
}
const actionToast = makeToastEl();
function showActionToast(text, ms=2500){
  actionToast.textContent = text;
  actionToast.style.display = "block";
  clearTimeout(actionToast._timer);
  actionToast._timer = setTimeout(()=> actionToast.style.display = "none", ms);
}

function showCornerStatus(text){
  let el = $("#cornerStatus");
  if(!el){
    el = document.createElement("div");
    el.id = "cornerStatus";
    el.style.position = "fixed";
    el.style.top = "84px";
    el.style.right = "20px";
    el.style.background = "rgba(10,12,20,0.85)";
    el.style.color = "#dfe9ff";
    el.style.padding = "8px 12px";
    el.style.borderRadius = "8px";
    el.style.zIndex = 9999;
    document.body.appendChild(el);
  }
  if(!text){ el.style.display = "none"; return; }
  el.textContent = text;
  el.style.display = "block";
}

/* HUD spectator badge helper */
function ensureSpectatorBadge() {
  if (spectatorBadgeEl) return spectatorBadgeEl;
  if (nameVal && nameVal.parentElement) {
    const span = document.createElement("span");
    span.id = "youAreSpectator";
    span.style.marginLeft = "8px";
    span.style.padding = "2px 8px";
    span.style.background = "rgba(255,255,255,0.06)";
    span.style.color = "#fff";
    span.style.borderRadius = "8px";
    span.style.fontSize = "12px";
    span.style.fontWeight = "700";
    span.style.display = "none";
    nameVal.parentElement.insertBefore(span, nameVal.nextSibling);
    spectatorBadgeEl = span;
    return span;
  }
  return null;
}
function setSpectatorBadge(show) {
  const el = ensureSpectatorBadge();
  if (!el) return;
  el.textContent = "Spectator";
  el.style.display = show ? "inline-block" : "none";
}

/* show host controls + lock button creation */
function showHostControls(on){
  const disp = on ? "inline-block" : "none";
  if (nextFrameBtn) nextFrameBtn.style.display = disp;
  if (prevFrameBtn) prevFrameBtn.style.display = disp;
  if (revealBtn)    revealBtn.style.display = disp;
  if (showMovieBtn) showMovieBtn.style.display = disp;

  // reset loading state if controls are hidden (e.g., end-of-round)
  if (!on && nextFrameBtn) setBtnLoading(nextFrameBtn, false);

  let lockBtn = document.getElementById("lockRoomBtn");
  const container = document.querySelector(".hud-actions"); // header container

  if (!container) return;

  if (!lockBtn) {
    lockBtn = document.createElement("button");
    lockBtn.id = "lockRoomBtn";
    lockBtn.className = "mini warn";
    lockBtn.type = "button";
    lockBtn.textContent = "Lock Room";
    lockBtn.title = "Prevent new players from joining (spectators still allowed)";
    if (!lockBtn._bound) {
      lockBtn._bound = true;
      lockBtn.addEventListener("click", async () => {
        if (!iAmHost) { showActionToast("Only the host can lock/unlock the room"); return; }
        lockBtn.disabled = true;
        try {
          await runTransaction(db, async (tx) => {
            const ref = roomDoc(room);
            const snap = await tx.get(ref);
            const data = snap.data() || {};
            const currentlyLocked = !!data.locked;
            tx.update(ref, {
              locked: !currentlyLocked,
              action: !currentlyLocked ? "Room locked (players cannot join)" : "Room unlocked"
            });
          });
          lockBtn.textContent = lockBtn.textContent.includes("Unlock") ? "Lock Room" : "Unlock Room";
          showActionToast(lockBtn.textContent.includes("Unlock") ? "Room locked" : "Room unlocked");
        } catch (e) {
          console.warn("Lock toggle failed:", e);
          showActionToast("Failed to toggle lock — check console");
        } finally {
          lockBtn.disabled = false;
        }
      });
    }
    container.appendChild(lockBtn);
  }
  lockBtn.style.display = on ? "inline-block" : "none";
}

/* ---------- Button loading helpers (spinner for Next) ---------- */
function ensureSpinnerStyles() {
  if (document.getElementById('btnSpinnerStyles')) return;
  const st = document.createElement('style');
  st.id = 'btnSpinnerStyles';
  st.textContent = `
  .btn-loading { pointer-events: none; opacity: .8; }
  .btn-loading .spinner {
    display:inline-block; width:1em; height:1em; margin-right:.5em;
    border:.15em solid currentColor; border-right-color: transparent;
    border-radius:50%; vertical-align:-.125em; animation:spin .8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  `;
  document.head.appendChild(st);
}
function setBtnLoading(btn, loading, fallbackLabel='⏭ Next') {
  if (!btn) return;
  ensureSpinnerStyles();
  if (loading) {
    if (!btn.dataset.label) btn.dataset.label = btn.textContent;
    btn.disabled = true;
    btn.classList.add('btn-loading');
    btn.innerHTML = `<span class="spinner" aria-hidden="true"></span> Loading…`;
  } else {
    btn.classList.remove('btn-loading');
    btn.disabled = false;
    btn.textContent = btn.dataset.label || fallbackLabel;
  }
}
/* ---------- Layout helpers (patched) ---------- */
function adjustMovieFrameSize() {
  // Let CSS handle responsive sizing completely.
  if (!movieBox || !movieFrame) return;

  // Clear any forced inline sizes from earlier versions.
  movieBox.style.minHeight = "";
  movieFrame.style.maxHeight = "";
  movieFrame.style.height = "";
  movieFrame.style.width = "";
  movieFrame.style.objectFit = "cover";

  // Optional: keep clean 16:9 ratio to prevent jumpy layout.
  movieBox.style.aspectRatio = "16 / 9";
}

window.addEventListener("resize", adjustMovieFrameSize);
adjustMovieFrameSize();

/* keep this part as-is */
function updateLayoutForChatPanel() {
  const board = document.querySelector('main.board');
  if (!board) return;

  // chat is “visible” only if the element exists and isn’t hidden by class or CSS
  const chatVisible =
    !!chatPanel &&
    !chatPanel.classList.contains('hidden') &&
    getComputedStyle(chatPanel).display !== 'none' &&
    getComputedStyle(chatPanel).visibility !== 'hidden';

  board.classList.toggle('board--with-chat', chatVisible);
}

// run ASAP after DOM is ready, then once more after paint to avoid the initial squish
window.addEventListener('DOMContentLoaded', () => {
  updateLayoutForChatPanel();
  requestAnimationFrame(() => updateLayoutForChatPanel());
  setTimeout(updateLayoutForChatPanel, 200); // belt-and-suspenders for late CSS/fonts
});



/* -------------------- Image preloading helpers -------------------- */
function preloadImage(url) {
  if (!url) return;
  if (_imagePreloadCache.has(url)) return;
  try {
    const img = new Image();
    img.src = url;
    _imagePreloadCache.set(url, img);
    img.onerror = () => { _imagePreloadCache.delete(url); };
  } catch (e) {
    console.warn("preloadImage failed for", url, e);
  }
}
function preloadFrames(playlist = [], index = 0, ahead = 3) {
  if (!Array.isArray(playlist)) return;
  try {
    const start = Math.max(0, index);
    const end = Math.min(playlist.length - 1, index + ahead);
    for (let i = start; i <= end; i++) {
      const item = playlist[i];
      const url = typeof item === 'string' ? item : (item && item.url) ? item.url : null;
      if (url) preloadImage(url);
    }
  } catch (e) {
    console.warn("preloadFrames failed", e);
  }
}

/* -------------------- Spectators List Modal -------------------- */
let spectatorsListUnsub = null;

function ensureSpectatorsModal() {
  let modal = document.getElementById("spectatorsModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "spectatorsModal";
    Object.assign(modal.style, {
      position: "fixed",
      inset: "0",
      display: "none",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(6,8,15,0.6)",
      zIndex: 1300
    });
    document.body.appendChild(modal);
  }
  return modal;
}
function closeSpectatorsModal() {
  const modal = ensureSpectatorsModal();
  modal.style.display = "none";
  try { if (spectatorsListUnsub) spectatorsListUnsub(); } catch(_) {}
  spectatorsListUnsub = null;
  document.removeEventListener("keydown", onEscCloseSpectatorsModal);
}
function onEscCloseSpectatorsModal(e){
  if (e.key === "Escape") closeSpectatorsModal();
}
function renderSpectatorsListCard(items=[]) {
  const card = document.createElement("div");
  Object.assign(card.style, {
    width: "min(720px, 92vw)",
    maxHeight: "80vh",
    overflow: "auto",
    background: "linear-gradient(180deg, rgba(9,12,20,0.98), rgba(9,12,20,0.96))",
    border: "1px solid rgba(255,255,255,0.06)",
    boxShadow: "0 20px 60px rgba(2,6,23,0.6)",
    borderRadius: "16px",
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "12px"
  });

  const header = document.createElement("div");
  header.style.display = "flex";
  header.style.alignItems = "center";
  header.style.justifyContent = "space-between";
  const title = document.createElement("div");
  title.textContent = `Spectators (${items.length})`;
  title.style.fontWeight = "900";
  title.style.fontSize = "18px";
  title.style.color = "#e6f0ff";
  header.appendChild(title);

  const closeBtn = document.createElement("button");
  closeBtn.className = "mini";
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", closeSpectatorsModal);
  header.appendChild(closeBtn);

  card.appendChild(header);

  if (!items.length) {
    const empty = document.createElement("div");
    empty.style.padding = "10px 12px";
    empty.style.color = "#cfe4ff";
    empty.textContent = "No spectators right now.";
    card.appendChild(empty);
    return card;
  }

  const list = document.createElement("div");
  list.style.display = "flex";
  list.style.flexDirection = "column";
  list.style.gap = "8px";

  items.forEach((s) => {
    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "10px 12px",
      borderRadius: "10px",
      background: "rgba(255,255,255,0.03)"
    });

    const left = document.createElement("div");
    left.style.display = "flex";
    left.style.alignItems = "center";
    left.style.gap = "10px";

    const badge = makeColoredBadge(s.name || s.id || "?", s.id || s.name, 40);
    left.appendChild(badge);

    const nameEl = document.createElement("div");
    nameEl.style.fontWeight = "800";
    nameEl.style.color = "#f0f9ff";
    nameEl.textContent = s.name || `Spectator ${s.id || ""}`;
    left.appendChild(nameEl);

    row.appendChild(left);

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.alignItems = "center";
    right.style.gap = "8px";

    const cc = document.createElement("span");
    cc.style.fontWeight = "900";
    cc.style.background = "linear-gradient(90deg,#fff,#cfe4ff)";
    cc.style.color = "#08121a";
    cc.style.padding = "4px 10px";
    cc.style.borderRadius = "999px";
    cc.textContent = `${Number(s.correctCount || 0)} ✔`;
    right.appendChild(cc);

    row.appendChild(right);
    list.appendChild(row);
  });

  card.appendChild(list);
  return card;
}
function openSpectatorsModalLive() {
  const modal = ensureSpectatorsModal();
  modal.innerHTML = "";
  modal.style.display = "flex";

  function onDocClick(e){ if (modal.firstChild && !modal.firstChild.contains(e.target)) closeSpectatorsModal(); }
  setTimeout(()=> document.addEventListener("click", onDocClick, { once: true }), 50);
  document.addEventListener("keydown", onEscCloseSpectatorsModal);

  try {
    const spectatorsColRef = collection(db, "rooms", room, "spectators");
    spectatorsListUnsub = onSnapshot(spectatorsColRef, (snap) => {
      const arr = [];
      snap.forEach(d => {
        const data = d.data() || {};
        arr.push({ id: d.id, name: data.name || d.id, correctCount: Number(data.correctCount || 0) });
      });
      arr.sort((a,b)=> (b.correctCount||0)-(a.correctCount||0) || (a.name||"").localeCompare(b.name||""));
      const card = renderSpectatorsListCard(arr);
      modal.innerHTML = "";
      modal.appendChild(card);
    }, (err)=> {
      modal.innerHTML = "";
      const card = renderSpectatorsListCard([]);
      modal.appendChild(card);
      console.warn("Spectators modal live sub error", err);
    });
  } catch (e) {
    console.warn("openSpectatorsModalLive failed", e);
    const card = renderSpectatorsListCard([]);
    modal.appendChild(card);
  }
}

/* -------------------- UI actions -------------------- */
copyCode?.addEventListener("click", async ()=>{
  try { await navigator.clipboard.writeText(room); showActionToast("Room code copied"); }
  catch { showActionToast("Copy failed"); }
});
copyInvite?.addEventListener("click", async ()=>{
  try {
    const inviteBase = location.origin + location.pathname.replace(/[^/]*$/, '') + 'Game.html';
    const link = inviteBase + '?mode=join&room=' + encodeURIComponent(room) + '&name=';
    await navigator.clipboard.writeText(link);
    showActionToast("Invite link copied");
  } catch { showActionToast("Copy failed"); }
});

prevFrameBtn?.addEventListener("click", ()=> { if(iAmHost) prevFrame(room); });

/* Next button with loading spinner */
nextFrameBtn?.addEventListener("click", async () => {
  if (!iAmHost || !nextFrameBtn || nextFrameBtn.classList.contains('btn-loading')) return;

  const beforeIdx = currentFrameIndex;
  setBtnLoading(nextFrameBtn, true);

  try {
    await nextFrame(room);
  } catch (e) {
    console.warn("nextFrame failed:", e);
    setBtnLoading(nextFrameBtn, false);
    return;
  }

  let cleared = false;
  const clearNow = () => { if (cleared) return; cleared = true; setBtnLoading(nextFrameBtn, false); };

  const poll = setInterval(() => {
    try {
      if (currentFrameIndex != null && currentFrameIndex !== beforeIdx) {
        clearInterval(poll);
        clearTimeout(fallback);
        clearNow();
      }
    } catch(_) {}
  }, 80);

  const fallback = setTimeout(() => {
    clearInterval(poll);
    clearNow();
  }, 1500);
});

/* Reveal with short delay (REVEAL_DELAY_MS) */
revealBtn?.addEventListener("click", async ()=> {
  if (!iAmHost) return;
  try { await updateDoc(roomDoc(room), { action: "Host is preparing to reveal the frame..." }); } catch(_) {}
  showCornerStatus(`Revealing in ${Math.round(REVEAL_DELAY_MS/1000)}s...`);
  try { await updateDoc(roomDoc(room), { action: `Revealing in ${Math.round(REVEAL_DELAY_MS/1000)}s...` }); } catch(_) {}
  setTimeout(async ()=> {
    try {
      await updateDoc(roomDoc(room), { frameRevealed: true, action: "Host revealed the frame" });
    } catch(e) {
      console.warn("Reveal update failed", e);
    } finally {
      showCornerStatus("");
    }
  }, REVEAL_DELAY_MS);
});

showMovieBtn?.addEventListener("click", async ()=> {
  if(!iAmHost) return;
  try { await updateDoc(roomDoc(room), { action: "Host is revealing the movie name" }); } catch(_){}
  await updateDoc(roomDoc(room), { movieNameRevealed: true, revealedMovieName: currentMovieName, action: "Host revealed the movie name" });
});

buzzerBtn?.addEventListener("click", async ()=> {
  if (!buzzerBtn || buzzerBtn.disabled) return;

  // extra client-side guard: cooldown and revealed check handled by room state anyway
  const now = Date.now();
  if (now - _lastBuzzAt < BUZZ_COOLDOWN_MS) return;
  _lastBuzzAt = now;

  buzzerBtn.disabled = true; // optimistic disable
  try {
    const idx = currentFrameIndex ?? 0;
    await pressBuzzerOnce(room, idx, myUid, name);
    if (buzzerStatus) buzzerStatus.textContent = "You buzzed!";
    // No re-enable here; watchMyBuzzDoc will keep it disabled for this frame.
  } catch(e) {
    // If already buzzed, keep disabled; else allow retry after small delay
    if (String(e?.message || "").toLowerCase().includes("already buzzed")) {
      if (buzzerStatus) buzzerStatus.textContent = "You already buzzed.";
    } else {
      if (buzzerStatus) buzzerStatus.textContent = "Error — try again.";
      setTimeout(()=> setBuzzerEnabled(true), 800);
    }
  }
});

/* -------------------- Auth + main flow -------------------- */
signInAnonymously(auth).catch(()=>{});

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  if (!room) {
    showActionToast("Room missing — returning home");
    setTimeout(()=> location.href = "HomePage.html", 900);
    return;
  }
  if (listenersInitialized) return;
  listenersInitialized = true;

  myUid = user.uid;

  try {
    if (statusEl) statusEl.textContent = "Joining room…";
    await ensureRoomAndMaybeClaimHost(room, myUid);

    const rs = await getDoc(roomDoc(room));
    const rd = rs.data() || {};
    const noHost = !rd.hostUid;
    iAmHost = (rd.hostUid === myUid) || (noHost && mode === "create");

    if (iAmHost && (!rd.playlist || !rd.playlist.length)) {
      await loadPackToRoom(room, rd.roundIndex ?? 0);
    }

    if (mode === "spectator") {
      isSpectatorLocal = true;
      setSpectatorBadge(true);
      if (chatPanel) chatPanel.classList.remove("hidden");
      updateLayoutForChatPanel();
    }

    if (mode !== "spectator") {
      const roomSnap = await getDoc(roomDoc(room));
      const roomData = roomSnap.exists() ? roomSnap.data() : {};
      const locked = !!roomData.locked;
      if (locked && !(roomData.hostUid === myUid)) {
        showActionToast("Room is locked — join as spectator", 2000);
        setTimeout(()=> { location.href = "HomePage.html"; }, 1800);
        return;
      } else {
        const myRef = doc(playersCol(room), myUid);
        const playerPayload = { name, joinedAt: serverTimestamp(), host: iAmHost };
        if (qCharacter) playerPayload.character = qCharacter;
        await setDoc(myRef, playerPayload, { merge: true });

        window.addEventListener("beforeunload", async ()=> {
          try {
            await deleteDoc(myRef);
            const rs2 = await getDoc(roomDoc(room));
            if (rs2.exists() && rs2.data().hostUid === myUid) {
              await updateDoc(roomDoc(room), { hostUid: null }).catch(()=>{});
            }
          } catch(e) {}
        });
      }
    } else {
      if (chatPanel) chatPanel.classList.remove("hidden");
      updateLayoutForChatPanel();
    }

    if (statusEl) statusEl.textContent = "Connected.";
  } catch(e) {
    if (statusEl) statusEl.textContent = "Join failed: " + (e.code || e.message);
    console.error("join error", e);
    return;
  }

  // live players
  playersUnsub = onSnapshot(playersCol(room), async (snap) => {
    const list = [];
    snap.forEach(d => list.push({ id: d.id, ...(d.data()||{}) }));
    renderPlayers(list);
    try { await assignNewHostIfNeeded(list); } catch(e){ console.warn(e); }
  });

  // spectators collection (for counts)
  try {
    const spectatorsCol = collection(db, "rooms", room, "spectators");
    spectatorsUnsub = onSnapshot(spectatorsCol, (snap) => {
      const cnt = snap.size || 0;
      const cntStr = String(cnt);
      if (spectatorCountEl) spectatorCountEl.textContent = cntStr;
      if (spectatorCountTopEl) spectatorCountTopEl.textContent = cntStr;
      updateLayoutForChatPanel();
    });
  } catch (e) {
    console.warn("Could not subscribe to spectators:", e);
  }

  // room live state
// ---- live room state ----
let lastIndex = null;
let lastRoundIndex = null;

roomUnsub = onSnapshot(roomDoc(room), (snap) => {
  const d = snap.data() || {};

  // Keep a fresh copy for helpers (e.g., getMovieName)
  window.currentRoomData = d;
  window.cachedPlaylist  = d.playlist || [];

  const cf                 = d.currentFrame ?? 1;
  const idx                = d.index ?? 0;          // current frame index (0-based)
  const roundNum           = d.round ?? 1;
  const roundIndex         = d.roundIndex ?? 0;     // 0-based round
  const revealed           = !!d.frameRevealed;
  const movieNameRevealed  = !!d.movieNameRevealed;
  const endOfRound         = !!d.endOfRound;
  const locked             = !!d.locked;

  // Host calc
  const noHost = !d.hostUid;
  iAmHost = (d.hostUid === myUid) || (noHost && mode === "create");

  // Host controls (hide at end-of-round)
  showHostControls(iAmHost && !endOfRound);
  const lockBtn = document.getElementById("lockRoomBtn");
  if (lockBtn) lockBtn.textContent = locked ? "Unlock Room" : "Lock Room";

  // Header UI
  if (roundVal) roundVal.textContent = String(roundNum);
  if (roundNameEl) roundNameEl.textContent = d.roundLabel || (ROUNDS[roundIndex]?.label || "");
  if (frameVal) frameVal.textContent = String(cf);
  if (frameVal2) frameVal2.textContent = String(cf);

  // Set current frame image + name
  const pl = d.playlist || [];
  const item = pl[idx];
  if (item) {
    if (typeof item === "string") {
      if (movieFrame) movieFrame.src = item;
      currentMovieName = "Unknown";
    } else {
      if (movieFrame) movieFrame.src = item.url || "movie1.jpg";
      currentMovieName = item.name || ("Frame " + (idx + 1));
    }
  } else {
    if (movieFrame) movieFrame.src = "movie1.jpg";
    currentMovieName = "Unknown";
  }
  if (movieFrame) movieFrame.onerror = () => { movieFrame.src = "movie1.jpg"; };

  // Detect round/frame change to clear UI + unsubscribe old listeners
  const frameChanged = (lastIndex !== null && lastIndex !== idx);
  const roundChanged = (lastRoundIndex !== null && lastRoundIndex !== roundIndex);

  if (frameChanged || roundChanged) {
    // Clear chat panel so prior-frame/round messages don't flash
    const chatListEl = document.getElementById('chatList');
    if (chatListEl) chatListEl.innerHTML = '';

    // Clear buzz list
    if (buzzList) buzzList.innerHTML = '';

    // Unsubscribe old per-frame listeners
    try { if (buzzUnsub) buzzUnsub(); } catch(_) {}
    try { if (gameChatUnsub) gameChatUnsub(); } catch(_) {}
    try { if (spectatorChatUnsub) spectatorChatUnsub(); } catch(_) {}
    try { if (myBuzzDocUnsub) myBuzzDocUnsub(); } catch(_) {}

    // Reset local UI bits
    if (buzzerStatus) buzzerStatus.textContent = "";
  }
  lastIndex = idx;
  lastRoundIndex = roundIndex;
  currentFrameIndex = idx;

  // Preload next few frames
  try { preloadFrames(pl, currentFrameIndex, 4); } catch(_) {}

  // Reveal state -> enable/disable buzzer and controls
  if (revealed && !endOfRound) {
    movieBox?.classList.remove("is-blurred");
    if (revealOverlay) revealOverlay.style.display = "none";
    // Only enable if user hasn’t already buzzed this frame
    watchMyBuzzDoc(room, currentFrameIndex);
    if (showMovieBtn) showMovieBtn.disabled = false;
  } else {
    movieBox?.classList.add("is-blurred");
    if (revealOverlay) revealOverlay.style.display = "flex";
    setBuzzerEnabled(false);
    if (showMovieBtn) showMovieBtn.disabled = true;
  }

  // Movie name card
  if (movieNameRevealed && d.revealedMovieName) {
    if (movieNameText) movieNameText.textContent = d.revealedMovieName;
    if (movieNameCard) movieNameCard.style.display = "block";
  } else {
    if (movieNameCard) movieNameCard.style.display = "none";
  }

  // Round banner (auto-clear by host)
  if (d.roundBanner && d.roundBannerAt) {
    if (roundBanner && roundBannerText) {
      roundBannerText.textContent = d.roundBanner;
      roundBanner.style.display = "flex";
      setTimeout(()=>{ roundBanner.style.display = "none"; }, 3500);
    }
    if (iAmHost) {
      updateDoc(roomDoc(room), { roundBanner: "", roundBannerAt: null }).catch(()=>{});
    }
  }

  // Corner status
  if (d.action) {
    if (movieNameRevealed || frameChanged) {
      showCornerStatus("");
    } else {
      showCornerStatus(d.action);
    }
    setTimeout(()=> showCornerStatus(""), 4000);
  }

  // Wait message for non-host while not revealed
  if (waitMsg) waitMsg.style.display = (!iAmHost && !revealed && !endOfRound) ? "block" : "none";

  // End-of-round winner modal (unchanged)
  if (endOfRound) {
    (async ()=> {
      try {
        const psnap = await getDocs(playersCol(room));
        const parr = [];
        psnap.forEach(d => parr.push({ id: d.id, ...(d.data()||{}) }));
        parr.sort((a,b)=> (b.score||0)-(a.score||0));
        const topPlayers = parr.slice(0,10).map(p => ({ name: p.name || "Player", score: p.score||0, character: p.character||null }));

        const specCol = collection(db, "rooms", room, "spectators");
        const ssnap = await getDocs(specCol);
        const sarr = [];
        ssnap.forEach(d => {
          const data = d.data() || {};
          sarr.push({ id: d.id, name: data.name || d.id, correctCount: Number(data.correctCount || 0) });
        });
        sarr.sort((a,b)=> (b.correctCount||0) - (a.correctCount||0));
        const topSpectators = sarr.slice(0,10);

        showWinnerModalBoth(topPlayers, topSpectators);
      } catch(e) {
        console.warn("compute winners failed", e);
      }
    })();
  }

  // Spectator correct count
  const correctStr = String(d.spectatorCorrectCount || 0);
  if (spectatorCorrectCountClone) spectatorCorrectCountClone.textContent = correctStr;
  if (spectatorCorrectCountEl) spectatorCorrectCountEl.textContent = correctStr;

  updateLayoutForChatPanel();
  adjustMovieFrameSize();

   // Per-frame chat subscriptions (players see only sanitized; spectators see all)
  // Per-frame chat subscriptions (players see only sanitized; spectators handled by spectatorChat.js)
if (mode !== "spectator" && !isSpectatorLocal) {
  subscribePlayerViewCorrectChatsForFrame(room, currentFrameIndex, roundIndex);
} else {
  // spectator chat is fully handled by spectatorChat.js – ensure we don't keep a game.js listener around
  try { if (gameChatUnsub) gameChatUnsub(); } catch(_) {}
  gameChatUnsub = null;
}

  // Buzz list only for players
  if (mode !== "spectator" && !isSpectatorLocal) {
    attachBuzzListener(room, currentFrameIndex);
  } else {
    try { if (buzzUnsub) buzzUnsub(); } catch(_) {}
    if (buzzList) buzzList.innerHTML = '';
  }

  // Start/stop the host-side correct processor (optimized version takes room only)
 
// inside roomUnsub snapshot handler — after you computed idx and roundIndex and cf
if (iAmHost) {
  startHostCorrectProcessor(room, idx, roundIndex, cf); // pass roundIndex + cumulative currentFrame if you want
} else if (hostCorrectProcUnsub) {
  try { hostCorrectProcUnsub(); } catch(_) {}
  hostCorrectProcUnsub = null;
}

});

  // Make spectator counters clickable to open the live list
  [spectatorCountEl, spectatorCountTopEl].forEach(el => {
    if (!el) return;
    el.style.cursor = "pointer";
    el.title = "View spectators";
    el.addEventListener("click", openSpectatorsModalLive);
  });
});

/* -------------------- cleanup (optional export) -------------------- */
export function cleanupGameListeners() {
  try { if (playersUnsub) playersUnsub(); } catch(_) {}
  try { if (roomUnsub) roomUnsub(); } catch(_) {}
  try { if (spectatorsUnsub) spectatorsUnsub(); } catch(_) {}
  try { if (buzzUnsub) buzzUnsub(); } catch(_) {}
  try { if (gameChatUnsub) gameChatUnsub(); } catch(_) {}
  try { if (spectatorChatUnsub) spectatorChatUnsub(); } catch(_) {}
  try { if (myBuzzDocUnsub) myBuzzDocUnsub(); } catch(_) {}
    try { if (hostCorrectProcUnsub) hostCorrectProcUnsub(); } catch(_) {}

}

/* ---- MOBILE RESPONSIVE WARNING (optional) ---- */
(function checkMobileWarning() {
  function showMobileWarning() {
    if (window.innerWidth > 768) return;
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
  window.addEventListener("load", showMobileWarning);
})();






/* ===== Spotlight Focus (utility) ===== */
(function SpotlightFocus(){
  let overlay, ring, arrow, note, hideTimer;
  function ensureNodes(){
    if (!overlay){ overlay = document.createElement('div'); overlay.className='hp-spotlight'; document.body.appendChild(overlay); }
    if (!ring){ ring = document.createElement('div'); ring.className='hp-spotlight-ring'; document.body.appendChild(ring); }
    if (!arrow){
      arrow = document.createElementNS('http://www.w3.org/2000/svg','svg');
      arrow.setAttribute('class','hp-spotlight-arrow'); arrow.setAttribute('viewBox','0 0 180 90');
      const p = document.createElementNS('http://www.w3.org/2000/svg','path');
      p.setAttribute('d','M10,80 C70,10 150,10 170,48'); p.setAttribute('fill','none');
      p.setAttribute('stroke','#fff'); p.setAttribute('stroke-width','4');
      p.setAttribute('stroke-linecap','round'); p.setAttribute('stroke-dasharray','3 8');
      const head = document.createElementNS('http://www.w3.org/2000/svg','path');
      head.setAttribute('d','M160,42 l18,6 -18,6 6,-6 z'); head.setAttribute('fill','#fff');
      arrow.appendChild(p); arrow.appendChild(head); document.body.appendChild(arrow);
    }
    if (!note){ note = document.createElement('div'); note.className='hp-spotlight-note'; document.body.appendChild(note); }
  }
  function show(target, message, opts={}){
    if (!target) return; ensureNodes(); clearTimeout(hideTimer);
    const rect = target.getBoundingClientRect(); const pad = opts.pad ?? 16;
    const cx = rect.left + rect.width/2 + window.scrollX;
    const cy = rect.top  + rect.height/2 + window.scrollY;
    const r  = Math.max(rect.width, rect.height)/2 + pad;
    overlay.style.setProperty('--sx', cx+'px'); overlay.style.setProperty('--sy', cy+'px'); overlay.style.setProperty('--sr', r+'px');
    ring.style.width = rect.width+pad*2+'px'; ring.style.height = rect.height+pad*2+'px';
    ring.style.left = cx+'px'; ring.style.top = cy+'px'; ring.style.borderRadius = (opts.round?'999px':'16px');
    const above = rect.top > 120;
    const ax = Math.max(12, rect.left - 140 + window.scrollX);
    const ay = above ? rect.top - 90 + window.scrollY : rect.bottom + 10 + window.scrollY;
    arrow.style.left = ax+'px'; arrow.style.top = ay+'px'; arrow.style.transform = above ? 'none' : 'scaleY(-1)';
    note.textContent = message || ''; const maxW = 280;
    const nx = Math.max(12, Math.min(rect.left + window.scrollX - 10, window.scrollX + innerWidth - maxW - 12));
    const ny = above ? Math.max(12, rect.top + window.scrollY - 130) : rect.bottom + window.scrollY + 18;
    note.style.left = nx+'px'; note.style.top = ny+'px'; note.dataset.pos = above?'above':'below';
    overlay.classList.add('show'); ring.classList.add('show'); arrow.classList.add('show'); note.classList.add('show');
    overlay.style.pointerEvents='auto'; overlay.onclick = hide;
    hideTimer = setTimeout(hide, opts.duration ?? 6500);
  }
  function hide(){ overlay?.classList.remove('show'); ring?.classList.remove('show'); arrow?.classList.remove('show'); note?.classList.remove('show'); if (overlay){ overlay.onclick=null; overlay.style.pointerEvents='none'; } }
  window.Spotlight = { show, hide };
})();


/* ===== Spotlight for "Glitch? Reload" button ===== */
(function(){
  const KEY = 'samosaa_spot_reload_seen_v1';
  function spotlightReloadBtn(){
    const el = document.getElementById('reloadBtn');
    if (!el || !window.Spotlight) return;
    Spotlight.show(
      el,
      "If chat, buzz order, or anything looks off, tap “Glitch? Reload” to instantly resync the game.",
      { duration: 8000, pad: 16 }
    );
    // only show once per browser
    try { localStorage.setItem(KEY, '1'); } catch(_) {}
  }
  window.addEventListener('load', () => {
    const seen = (()=>{ try { return localStorage.getItem(KEY)==='1'; } catch(_) { return false; } })();
    if (!seen) setTimeout(spotlightReloadBtn, 600);
  });
})();

/* ===== Spotlight "Glitch? Reload" on every load ===== */
window.addEventListener('load', () => {
  const btn = document.getElementById('reloadBtn');
  if (!btn || !window.Spotlight) return;
  // wait a moment so layout settles
  setTimeout(() => {
    Spotlight.show(
      btn,
      'If chat, buzz order, or anything looks off, tap “Glitch? Reload” to instantly resync the game.',
      { duration: 8000, pad: 18 }
    );
  }, 600);
});



// Start in 2-col mode until the chat is truly visible
document.addEventListener('DOMContentLoaded', () => {
  const board = document.querySelector('main.board');
  const chat  = document.getElementById('chatPanel');
  if (!board || !chat) return;

  // Hard reset at boot
  board.classList.remove('board--with-chat');

  // Instant sync if something toggles the chat later
  const sync = () => {
    const visible = !chat.classList.contains('hidden') &&
                    getComputedStyle(chat).display !== 'none' &&
                    getComputedStyle(chat).visibility !== 'hidden';
    board.classList.toggle('board--with-chat', visible);
  };

  // Run now, next frame, and after late fonts/CSS
  sync();
  requestAnimationFrame(sync);
  setTimeout(sync, 200);

  // Watch for class/style changes on the chat node
  new MutationObserver(sync).observe(chat, { attributes: true, attributeFilter: ['class', 'style'] });
});
