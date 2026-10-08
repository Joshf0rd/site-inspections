/* =========================================================
   db.js – local database (IndexedDB)

   Object stores ("tables"):
     settings  { key: 'main', ...settings }
     projects  { id, name, number, client, site, mainContractor, notes, createdAt, modifiedAt }
     visits    { id, projectId, date ('YYYY-MM-DD'), title, inspector, discipline, notes,
                 counters: { E: 7, M: 2 }, createdAt, modifiedAt }
     snags     { id, visitId, projectId, number, area, category, observation, action,
                 contractor, status, closedDate, photos: [{ id, kind, thumb, width, height }],
                 createdAt, modifiedAt }
     photos    { id, snagId, visitId, projectId, kind ('issue'|'closeout'),
                 dataUrl (full-size JPEG), width, height, createdAt }

   Full-size photos live in their own store so lists only load small thumbnails.
   Multi-step changes (e.g. deleting a project and everything under it) run in a
   single transaction: either everything succeeds or nothing changes.
   ========================================================= */

const DB = (() => {
  const DB_NAME = 'site-inspections';
  const DB_VERSION = 1;
  const ALL_STORES = ['settings', 'projects', 'visits', 'snags', 'photos'];
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('This browser does not support local storage (IndexedDB).'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('projects')) {
          db.createObjectStore('projects', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('visits')) {
          const s = db.createObjectStore('visits', { keyPath: 'id' });
          s.createIndex('projectId', 'projectId');
        }
        if (!db.objectStoreNames.contains('snags')) {
          const s = db.createObjectStore('snags', { keyPath: 'id' });
          s.createIndex('visitId', 'visitId');
          s.createIndex('projectId', 'projectId');
          s.createIndex('visitStatus', ['visitId', 'status']);
          s.createIndex('projectStatus', ['projectId', 'status']);
        }
        if (!db.objectStoreNames.contains('photos')) {
          const s = db.createObjectStore('photos', { keyPath: 'id' });
          s.createIndex('snagId', 'snagId');
          s.createIndex('visitId', 'visitId');
          s.createIndex('projectId', 'projectId');
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // If another tab upgrades the database, close this connection cleanly.
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Database is blocked. Close other tabs of this app and try again.'));
    });
    return dbPromise;
  }

  /**
   * Run `work(stores)` inside one transaction. `work` must only issue IndexedDB
   * requests synchronously (no awaiting other promises), otherwise the transaction
   * would auto-commit early. Resolves when the transaction has fully committed.
   * If `work` returns an IDBRequest, the promise resolves with that request's result.
   */
  async function run(storeNames, mode, work) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeNames, mode);
      const stores = {};
      [].concat(storeNames).forEach(n => { stores[n] = tx.objectStore(n); });
      let out;
      try {
        out = work(stores, tx);
      } catch (err) {
        try { tx.abort(); } catch (e) { /* already finished */ }
        reject(err);
        return;
      }
      tx.oncomplete = () => resolve(out instanceof IDBRequest ? out.result : out);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Database transaction was cancelled.'));
    });
  }

  // ---------- Simple helpers ----------
  const get = (store, key) => run(store, 'readonly', s => s[store].get(key));
  const getAll = (store) => run(store, 'readonly', s => s[store].getAll());
  const getAllByIndex = (store, index, value) =>
    run(store, 'readonly', s => s[store].index(index).getAll(value));
  const countByIndex = (store, index, value) =>
    run(store, 'readonly', s => s[store].index(index).count(value));
  const put = (store, obj) => run(store, 'readwrite', s => { s[store].put(obj); return obj; });

  /** Delete every record in `store` whose `index` equals `value` (inside an open transaction). */
  function deleteByIndex(storeObj, index, value) {
    const req = storeObj.index(index).openCursor(IDBKeyRange.only(value));
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) { cursor.delete(); cursor.continue(); }
    };
  }

  // ---------- Cascading deletes ----------
  function deleteProject(projectId) {
    return run(['projects', 'visits', 'snags', 'photos'], 'readwrite', s => {
      deleteByIndex(s.photos, 'projectId', projectId);
      deleteByIndex(s.snags, 'projectId', projectId);
      deleteByIndex(s.visits, 'projectId', projectId);
      s.projects.delete(projectId);
    });
  }

  function deleteVisit(visitId) {
    return run(['visits', 'snags', 'photos'], 'readwrite', s => {
      deleteByIndex(s.photos, 'visitId', visitId);
      deleteByIndex(s.snags, 'visitId', visitId);
      s.visits.delete(visitId);
    });
  }

  function deleteSnag(snagId) {
    return run(['snags', 'photos'], 'readwrite', s => {
      deleteByIndex(s.photos, 'snagId', snagId);
      s.snags.delete(snagId);
    });
  }

  /**
   * Save a snag together with its photo changes and the visit's number counter,
   * all in ONE transaction (so a half-saved snag is impossible).
   */
  function saveSnag({ snag, newPhotos, removedPhotoIds, visit }) {
    return run(['snags', 'photos', 'visits'], 'readwrite', s => {
      removedPhotoIds.forEach(id => s.photos.delete(id));
      newPhotos.forEach(p => s.photos.put(p));
      s.snags.put(snag);
      if (visit) s.visits.put(visit);
      return snag;
    });
  }

  // ---------- Backup support ----------
  /** Read everything (used by Export Backup). */
  function exportAll() {
    return run(ALL_STORES, 'readonly', s => {
      const out = {};
      ALL_STORES.forEach(name => {
        const req = s[name].getAll();
        req.onsuccess = () => { out[name] = req.result; };
      });
      return out;
    });
  }

  /**
   * Replace ALL data with the given data, in a single transaction.
   * If anything fails, the transaction aborts and the existing data is untouched.
   */
  function replaceAll(data) {
    return run(ALL_STORES, 'readwrite', s => {
      ALL_STORES.forEach(name => s[name].clear());
      ALL_STORES.forEach(name => (data[name] || []).forEach(rec => s[name].put(rec)));
    });
  }

  return {
    open, run, get, getAll, getAllByIndex, countByIndex, put,
    deleteProject, deleteVisit, deleteSnag, saveSnag,
    exportAll, replaceAll, ALL_STORES
  };
})();
