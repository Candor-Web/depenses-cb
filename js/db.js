/**
 * Stockage local (IndexedDB). Rien ne sort du téléphone.
 * Stores : expenses (dépenses), photos (blobs JPEG), bank (lignes de relevé), meta (réglages).
 */

const DB_NAME = 'depenses-cb';
const DB_VERSION = 1;

let _db = null;

function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('expenses')) {
        const s = db.createObjectStore('expenses', { keyPath: 'id' });
        s.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('bank')) {
        const s = db.createObjectStore('bank', { keyPath: 'id' });
        s.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' });
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const uid = () =>
  Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

/* ---------- dépenses ---------- */
export const putExpense = e => tx('expenses', 'readwrite', s => s.put(e));
export const getExpense = id => tx('expenses', 'readonly', s => s.get(id));
export const delExpense = id => tx('expenses', 'readwrite', s => s.delete(id));

export async function allExpenses() {
  const rows = await tx('expenses', 'readonly', s => s.getAll());
  return (rows || []).sort((a, b) =>
    b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
}

/* ---------- photos ---------- */
export const putPhoto = (id, blob) => tx('photos', 'readwrite', s => s.put({ id, blob }));
export const delPhoto = id => tx('photos', 'readwrite', s => s.delete(id));
export async function getPhoto(id) {
  if (!id) return null;
  const r = await tx('photos', 'readonly', s => s.get(id));
  return r ? r.blob : null;
}
export const allPhotoIds = () => tx('photos', 'readonly', s => s.getAllKeys());

/* ---------- relevé bancaire ---------- */
export const putBank = row => tx('bank', 'readwrite', s => s.put(row));
export const allBank = () => tx('bank', 'readonly', s => s.getAll());
export const clearBank = () => tx('bank', 'readwrite', s => s.clear());

/* ---------- réglages / mémoire ---------- */
export async function getMeta(k, def = null) {
  const r = await tx('meta', 'readonly', s => s.get(k));
  return r ? r.v : def;
}
export const setMeta = (k, v) => tx('meta', 'readwrite', s => s.put({ k, v }));

/* ---------- maintenance ---------- */
export async function wipeAll() {
  const db = await open();
  await new Promise((res, rej) => {
    const t = db.transaction(['expenses', 'photos', 'bank', 'meta'], 'readwrite');
    ['expenses', 'photos', 'bank', 'meta'].forEach(n => t.objectStore(n).clear());
    t.oncomplete = res;
    t.onerror = () => rej(t.error);
  });
}

/** Supprime les photos qui ne sont plus rattachées à une dépense. */
export async function gcPhotos() {
  const [exp, ids] = await Promise.all([allExpenses(), allPhotoIds()]);
  const used = new Set(exp.map(e => e.photoId).filter(Boolean));
  let n = 0;
  for (const id of ids || []) if (!used.has(id)) { await delPhoto(id); n++; }
  return n;
}

export async function storageEstimate() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  try { return await navigator.storage.estimate(); } catch { return null; }
}
