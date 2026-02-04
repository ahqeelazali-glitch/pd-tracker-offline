// ---- IndexedDB helpers ----
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

async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const result = fn(store);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
  });
}

function uid() {
  // reasonably unique for local usage
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random().toString(16).slice(2);
}

async function addEntry(entry) {
  await tx("readwrite", (store) => store.add(entry));
}

async function getAllEntries() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, "readonly");
    const store = t.objectStore(STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function deleteEntry(id) {
  await tx("readwrite", (store) => store.delete(id));
}

async function clearAll() {
  await tx("readwrite", (store) => store.clear());
}

// ---- UI ----
const els = {
  date: document.getElementById("date"),
  tag: document.getElementById("tag"),
  note: document.getElementById("note"),
  saveBtn: document.getElementById("saveBtn"),
  exportBtn: document.getElementById("exportBtn"),
  importFile: document.getElementById("importFile"),
  search: document.getElementById("search"),
  clearBtn: document.getElementById("clearBtn"),
  list: document.getElementById("list"),
};

function fmt(ts) {
  try { return new Date(ts).toLocaleString(); } catch { return String(ts); }
}

function escapeHtml(s) {
  return (s ?? "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

async function render() {
  const q = (els.search.value || "").trim().toLowerCase();
  let entries = await getAllEntries();
  entries.sort((a,b) => b.ts - a.ts);

  if (q) {
    entries = entries.filter(e =>
      (e.tag || "").toLowerCase().includes(q) ||
      (e.text || "").toLowerCase().includes(q)
    );
  }

  els.list.innerHTML = entries.map(e => `
    <div class="card entry">
      <div style="flex:1;">
        <div class="muted">${escapeHtml(fmt(e.ts))} ${e.tag ? `• <span class="pill">${escapeHtml(e.tag)}</span>` : ""}</div>
        <div style="margin-top:8px; white-space:pre-wrap;">${escapeHtml(e.text)}</div>
      </div>
      <button data-del="${escapeHtml(e.id)}">Delete</button>
    </div>
  `).join("") || `<div class="muted">No entries yet.</div>`;

  document.querySelectorAll("button[data-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      await deleteEntry(btn.getAttribute("data-del"));
      await render();
    });
  });
}

function setDefaultDateNow() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  els.date.value = d.toISOString().slice(0,16);
}

els.saveBtn.addEventListener("click", async () => {
  const ts = els.date.value ? new Date(els.date.value).getTime() : Date.now();
  const tag = (els.tag.value || "").trim();
  const text = (els.note.value || "").trim();
  if (!text) return alert("Write something first.");

  const entry = { id: uid(), ts, tag, text };
  await addEntry(entry);

  els.note.value = "";
  setDefaultDateNow();
  await render();
});

els.search.addEventListener("input", render);

els.clearBtn.addEventListener("click", async () => {
  if (!confirm("This will delete ALL entries on this device. Continue?")) return;
  await clearAll();
  await render();
});

els.exportBtn.addEventListener("click", async () => {
  const entries = await getAllEntries();
  const blob = new Blob([JSON.stringify({ exportedAt: Date.now(), entries }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `pd-tracker-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

els.importFile.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  let data;
  try { data = JSON.parse(text); } catch { return alert("Invalid JSON file."); }
  const entries = Array.isArray(data.entries) ? data.entries : [];
  // merge import (don’t wipe existing)
  for (const ent of entries) {
    if (!ent?.id) continue;
    // put = upsert
    await tx("readwrite", (store) => store.put(ent));
  }
  alert(`Imported ${entries.length} entries.`);
  await render();
});

(async function init() {
  setDefaultDateNow();
  await render();

  // Register service worker for offline
  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("./service-worker.js"); }
    catch (e) { console.warn("SW register failed", e); }
  }
})();
