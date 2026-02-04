// ========= IndexedDB (offline storage) =========
const DB_NAME = "pd_tracker_db";
const STORE = "entries";
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("ts", "ts");
        store.createIndex("tag", "tag");
        store.createIndex("text", "text");
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random().toString(16).slice(2);
}

async function getAllEntries() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function addEntry(entry) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.add(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteEntry(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function clearAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ========= Helpers =========
function fmt(ts) {
  try { return new Date(ts).toLocaleString(); } catch { return String(ts); }
}
function escapeHtml(s) {
  return (s ?? "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}
function setDefaultDateNow(els) {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  if (els.date) els.date.value = d.toISOString().slice(0,16);
}

// ========= Elements =========
const els = {
  date: document.getElementById("date"),
  tag: document.getElementById("tag"),
  note: document.getElementById("note"),
  saveBtn: document.getElementById("saveBtn"),

  journalList: document.getElementById("journalList"),
  search: document.getElementById("search"),
  searchList: document.getElementById("searchList"),

  exportBtn: document.getElementById("exportBtn"),
  importFile: document.getElementById("importFile"),
  clearBtn: document.getElementById("clearBtn"),
};

// ========= Rendering =========
async function renderTo(targetEl, queryText) {
  if (!targetEl) return;

  const q = (queryText || "").trim().toLowerCase();
  let entries = await getAllEntries();
  entries.sort((a,b) => b.ts - a.ts);

  if (q) {
    entries = entries.filter(e =>
      (e.tag || "").toLowerCase().includes(q) ||
      (e.text || "").toLowerCase().includes(q)
    );
  }

  targetEl.innerHTML = entries.length ? entries.map(e => `
    <div class="entry">
      <div style="flex:1;">
        <div class="entryMeta">
          <span>${escapeHtml(fmt(e.ts))}</span>
          ${e.tag ? `<span class="pill">${escapeHtml(e.tag)}</span>` : ""}
        </div>
        <div class="entryText">${escapeHtml(e.text)}</div>
      </div>
      <button class="smallBtn" data-del="${escapeHtml(e.id)}">Delete</button>
    </div>
  `).join("") : `<div class="empty">No entries yet.</div>`;

  targetEl.querySelectorAll("button[data-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      await deleteEntry(btn.getAttribute("data-del"));
      await renderAll();
    });
  });
}

async function renderAll() {
  await renderTo(els.journalList, "");
  await renderTo(els.searchList, els.search?.value || "");
}
window.renderAll = renderAll;

// ========= Events =========
els.saveBtn?.addEventListener("click", async () => {
  const ts = els.date?.value ? new Date(els.date.value).getTime() : Date.now();
  const tag = (els.tag?.value || "").trim();
  const text = (els.note?.value || "").trim();
  if (!text) return alert("Write something first.");

  const entry = { id: uid(), ts, tag, text };
  await addEntry(entry);

  if (els.note) els.note.value = "";
  setDefaultDateNow(els);

  await renderAll();
  // After saving, you can tap the 📓 tab to see it in Journal
});

els.search?.addEventListener("input", renderAll);

els.clearBtn?.addEventListener("click", async () => {
  if (!confirm("This will delete ALL entries on this device. Continue?")) return;
  await clearAll();
  await renderAll();
});

els.exportBtn?.addEventListener("click", async () => {
  const entries = await getAllEntries();
  const blob = new Blob([JSON.stringify({ exportedAt: Date.now(), entries }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `pd-tracker-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

els.importFile?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  let data;
  try { data = JSON.parse(await file.text()); }
  catch { return alert("Invalid JSON file."); }

  const entries = Array.isArray(data.entries) ? data.entries : [];
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const ent of entries) {
      if (ent?.id) store.put(ent); // upsert
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  alert(`Imported ${entries.length} entries.`);
  await renderAll();
});

// ========= Init =========
(async function init(){
  setDefaultDateNow(els);
  await renderAll();

  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("./service-worker.js"); }
    catch (e) { console.warn("SW register failed", e); }
  }
})();



