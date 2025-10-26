// Admin.js (module) - updated with Edit / Delete / Update (in-place edit) features
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInAnonymously, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// --- CONFIG (use your project's config) ---
const firebaseConfig = {
  apiKey: "AIzaSyDOrok6tfuLqymYsADST7Pck9RavUx2Sfc",
  authDomain: "scoopygames-60456.firebaseapp.com",
  databaseURL: "https://scoopygames-60456-default-rtdb.firebaseio.com",
  projectId: "scoopygames-60456",
  storageBucket: "scoopygames-60456.firebasestorage.app",
  messagingSenderId: "562779988237",
  appId: "1:562779988237:web:e4ad36fbe1cc926f015044"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- DOM ---
const roundSelect = document.getElementById("roundSelect");
const imgUrl = document.getElementById("imgUrl");
const movieName = document.getElementById("movieName");
const addBtn = document.getElementById("addBtn");
const previewList = document.getElementById("previewList");
const savePackBtn = document.getElementById("savePackBtn");
const loadPackBtn = document.getElementById("loadPackBtn");
const clearListBtn = document.getElementById("clearListBtn");
const statusBar = document.getElementById("statusBar");
const adminUid = document.getElementById("adminUid");
const navLogout = document.getElementById("nav-logout");

// local state
let buffer = []; // array of { url, name }
let editIndex = -1; // -1 => adding new; >=0 => editing buffer[editIndex]

function setStatus(msg, isError = false, ms = 3000) {
  statusBar.textContent = msg || "";
  statusBar.style.color = isError ? "#ffb4b4" : "";
  if (ms > 0) {
    clearTimeout(setStatus._timer);
    setStatus._timer = setTimeout(() => {
      statusBar.textContent = "";
    }, ms);
  }
}

// sign in anonymously
async function ensureAuth() {
  try {
    await signInAnonymously(auth);
  } catch (e) {
    console.warn("Auth failed", e);
    setStatus("Auth failed: " + (e.message || e.code), true);
  }
}
ensureAuth();

// auth UI
onAuthStateChanged(auth, (u) => {
  if (u) {
    adminUid.textContent = u.uid;
  } else {
    adminUid.textContent = "—";
  }
});

// helpers
function resetFormAndEditState() {
  imgUrl.value = "";
  movieName.value = "";
  editIndex = -1;
  addBtn.textContent = "Add to list";
  addBtn.classList.remove("primary");
}

function renderPreview() {
  previewList.innerHTML = "";
  if (!buffer.length) {
    const li = document.createElement("li");
    li.className = "preview-item";
    li.textContent = "No items in list.";
    previewList.appendChild(li);
    return;
  }

  buffer.forEach((it, idx) => {
    const li = document.createElement("li");
    li.className = "preview-item";

    const thumb = document.createElement("div");
    thumb.className = "preview-thumb";
    const img = document.createElement("img");
    img.src = it.url;
img.alt = it.name || `Frame ${idx + 1}`;
    img.onerror = () => {
      // fallback placeholder if image fails
      img.src = "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='80'%3E%3Crect width='100%25' height='100%25' fill='%23061220'/%3E%3Ctext x='50%25' y='50%25' fill='%23ffffff' font-size='10' text-anchor='middle' dominant-baseline='central'%3EPreview%20not%20available%3C/text%3E%3C/svg%3E";
    };
    thumb.appendChild(img);

    const meta = document.createElement("div");
    meta.className = "preview-meta";
    const b = document.createElement("b");
b.textContent = it.name || `Frame ${idx + 1}`;
    const small = document.createElement("div");
    small.className = "muted";
    small.textContent = it.url;
    meta.appendChild(b);
    meta.appendChild(small);

    const actions = document.createElement("div");
    actions.className = "preview-actions";

    const edit = document.createElement("button");
    edit.className = "btn";
    edit.textContent = "Edit";
    edit.addEventListener("click", (ev) => {
      ev.preventDefault();
      enterEditMode(idx);
    });

    const remove = document.createElement("button");
    remove.className = "btn";
    remove.textContent = "Delete";
    remove.addEventListener("click", (ev) => {
      ev.preventDefault();
      if (!confirm("Remove this item from the list?")) return;
      buffer.splice(idx, 1);
      renderPreview();
      setStatus("Item removed.");
      // if we were editing this index, reset form
      if (editIndex === idx) resetFormAndEditState();
    });

    // optional: move up/down controls to reorder
    const up = document.createElement("button");
    up.className = "btn";
    up.textContent = "▲";
    up.title = "Move up";
    up.addEventListener("click", (ev) => {
      ev.preventDefault();
      if (idx <= 0) return;
      const tmp = buffer[idx - 1];
      buffer[idx - 1] = buffer[idx];
      buffer[idx] = tmp;
      // preserve editing index if affected
      if (editIndex === idx) editIndex = idx - 1;
      else if (editIndex === idx - 1) editIndex = idx;
      renderPreview();
    });

    const down = document.createElement("button");
    down.className = "btn";
    down.textContent = "▼";
    down.title = "Move down";
    down.addEventListener("click", (ev) => {
      ev.preventDefault();
      if (idx >= buffer.length - 1) return;
      const tmp = buffer[idx + 1];
      buffer[idx + 1] = buffer[idx];
      buffer[idx] = tmp;
      if (editIndex === idx) editIndex = idx + 1;
      else if (editIndex === idx + 1) editIndex = idx;
      renderPreview();
    });

    actions.appendChild(edit);
    actions.appendChild(remove);
    actions.appendChild(up);
    actions.appendChild(down);

    li.appendChild(thumb);
    li.appendChild(meta);
    li.appendChild(actions);
    previewList.appendChild(li);
  });
}

// add to buffer or save edit
addBtn.addEventListener("click", (e) => {
  e.preventDefault();
  const url = (imgUrl.value || "").trim();
  const name = (movieName.value || "").trim() || "Unknown";
  if (!url) {
    setStatus("Please enter an image URL.", true);
    return;
  }

  if (editIndex >= 0 && editIndex < buffer.length) {
    // update
    buffer[editIndex] = { url, name };
    setStatus("Item updated in the list.");
    resetFormAndEditState();
  } else {
    // add new
    buffer.push({ url, name });
    setStatus("Added to list.");
  }
  renderPreview();
});

// helper to enter edit mode
function enterEditMode(idx) {
  if (idx < 0 || idx >= buffer.length) return;
  editIndex = idx;
  imgUrl.value = buffer[idx].url || "";
  movieName.value = buffer[idx].name || "";
  addBtn.textContent = "Save changes";
  addBtn.classList.add("primary");
  setStatus("Editing item " + (idx + 1) + ". Make changes and click Save changes.");
  // scroll inputs into view (UX)
  imgUrl.scrollIntoView({ behavior: "smooth", block: "center" });
}

// clear list
clearListBtn.addEventListener("click", () => {
  if (!confirm("Clear the entire list?")) return;
  buffer = [];
  renderPreview();
  resetFormAndEditState();
  setStatus("List cleared.");
});

// save to Firestore (overwrite pack)
savePackBtn.addEventListener("click", async () => {
  const roundId = roundSelect.value;
  if (!roundId) return;
  if (!buffer.length) {
    setStatus("No items to save.", true);
    return;
  }

  setStatus("Saving pack...");
  try {
    const packRef = doc(db, "packs", roundId);
    // store files array as objects { url, name }
    await setDoc(packRef, { files: buffer }, { merge: false });
    setStatus("Pack saved to packs/" + roundId);
  } catch (e) {
    console.error(e);
    setStatus("Save failed: " + (e.message || e.code), true);
  }
});

// load existing pack
loadPackBtn.addEventListener("click", async () => {
  const roundId = roundSelect.value;
  if (!roundId) return;
  setStatus("Loading pack...");
  try {
    const packRef = doc(db, "packs", roundId);
    const snap = await getDoc(packRef);
    if (!snap.exists()) {
      buffer = [];
      renderPreview();
      resetFormAndEditState();
      setStatus("No pack found. You can create one.");
      return;
    }
    const data = snap.data() || {};
    const files = data.files || [];
    // Normalize to { url, name }
    buffer = files.map((f, i) => (typeof f === "string" ? { url: f, name: "Unknown" } : { url: f.url || f, name: f.name || ("Frame " + (i + 1)) }));
    renderPreview();
    resetFormAndEditState();
    setStatus("Loaded " + buffer.length + " items from packs/" + roundId);
  } catch (e) {
    console.error(e);
    setStatus("Load failed: " + (e.message || e.code), true);
  }
});

// sign out / refresh
navLogout.addEventListener("click", async () => {
  try {
    await signOut(auth);
    setStatus("Signed out (refresh to sign in again).");
    adminUid.textContent = "—";
  } catch (e) {
    setStatus("Sign out failed: " + (e.message || e.code), true);
  }
});

// initial render
renderPreview();
setStatus("Ready.", false, 1800);