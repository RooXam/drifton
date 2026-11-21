// My library: what I keep from one visit to the next, on this device only.
//
// Uses IndexedDB, the browser's built-in database (much roomier than localStorage, and it
// stores binary files like MIDI as they are). Every page of the site shares it.
// An item: { id, kind, name, updated, ...whatever the page needs }
//   kind "midi":   a MIDI file for Piano score       ({ data: ArrayBuffer })
//   kind "song":   a song pasted in the Songbook      ({ text, title, artist })
//   kind "progression": chords found in my MIDI files by Progressions
//                       ({ roman, whole, tonic, minor, per, repeats })
// Nothing leaves the device. Export / Import move it to a file (backup, other device).
//
// IndexedDB works with callbacks ("request.onsuccess"); the small `ask` helper turns them
// into Promises so the pages can simply `await Library.get(id)`.

const Library = (() => {
  const DB = "drifton", STORE = "items";
  let memory = null; // fallback when the browser refuses IndexedDB: kept until the page closes

  const ready = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { memory = new Map(); resolve(null); };
    } catch {
      memory = new Map();
      resolve(null);
    }
  });

  const ask = (req) => new Promise((ok, fail) => { req.onsuccess = () => ok(req.result); req.onerror = () => fail(req.error); });

  async function store(mode) {
    const db = await ready;
    return db ? db.transaction(STORE, mode).objectStore(STORE) : null;
  }

  async function put(item) {
    const full = { ...item, updated: Date.now() };
    const s = await store("readwrite");
    if (s) await ask(s.put(full)); else memory.set(full.id, full);
    return full;
  }

  async function get(id) {
    const s = await store("readonly");
    return s ? (await ask(s.get(id))) || null : memory.get(id) || null;
  }

  async function list(kind) {
    const s = await store("readonly");
    const all = s ? await ask(s.getAll()) : [...memory.values()];
    return all.filter((x) => !kind || x.kind === kind).sort((a, b) => b.updated - a.updated);
  }

  async function remove(id) {
    const s = await store("readwrite");
    if (s) await ask(s.delete(id)); else memory.delete(id);
  }

  // Ask the browser not to clear this data on its own (Safari may, after a week away).
  function persist() {
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch {}
  }

  // ---- Export / Import: one JSON file; binary data written as base64 text ----

  const toBase64 = (buf) => {
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  const fromBase64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;

  async function exportFile() {
    const items = (await list()).map((x) => (x.data instanceof ArrayBuffer ? { ...x, data: { base64: toBase64(x.data) } } : x));
    const text = JSON.stringify({ drifton: 1, exported: new Date().toISOString(), items });
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `drifton-library-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return items.length;
  }

  // Adds (or replaces, same id) every item of an exported file. Returns how many.
  async function importFile(file) {
    const json = JSON.parse(await file.text());
    if (!json || !Array.isArray(json.items)) throw new Error("Not a Drifton library file.");
    let n = 0;
    for (const x of json.items) {
      if (!x || typeof x.id !== "string" || typeof x.kind !== "string") continue;
      const item = x.data && x.data.base64 ? { ...x, data: fromBase64(x.data.base64) } : x;
      const s = await store("readwrite");
      if (s) await ask(s.put(item)); else memory.set(item.id, item);
      n++;
    }
    return n;
  }

  return { ready, put, get, list, remove, persist, exportFile, importFile, get available() { return !memory; } };
})();
