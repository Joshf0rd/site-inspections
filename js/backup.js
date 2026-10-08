/* =========================================================
   backup.js – Export / Import of ALL app data as one JSON file.

   File format:
   {
     "app": "site-inspections",
     "format": 1,
     "exportedAt": "2026-10-07T12:00:00.000Z",
     "counts": { "projects": 2, ... },
     "data": { "settings": [...], "projects": [...], "visits": [...],
               "snags": [...], "photos": [...] }      // photos as JPEG data URLs
   }

   Import is "replace everything" and runs in a single database
   transaction: if anything fails, the existing data is left untouched.
   ========================================================= */

const Backup = (() => {
  const APP_ID = 'site-inspections';
  const FORMAT = 1;

  // ---------- Export ----------
  async function exportBackup() {
    let blob, fileName, counts;
    try {
      Utils.showLoading('Preparing backup…');
      const data = await DB.exportAll();
      counts = {};
      DB.ALL_STORES.forEach(n => { counts[n] = (data[n] || []).length; });

      // Build the JSON in pieces so we never hold one enormous string in memory.
      const parts = [];
      parts.push(`{"app":"${APP_ID}","format":${FORMAT},"exportedAt":${JSON.stringify(Utils.nowStamp())},` +
        `"appVersion":${JSON.stringify(App.APP_VERSION)},"counts":${JSON.stringify(counts)},"data":{`);
      DB.ALL_STORES.forEach((name, i) => {
        parts.push((i ? ',' : '') + JSON.stringify(name) + ':[');
        (data[name] || []).forEach((rec, j) => parts.push((j ? ',' : '') + JSON.stringify(rec)));
        parts.push(']');
      });
      parts.push('}}');
      blob = new Blob(parts, { type: 'application/json' });
      const d = new Date();
      fileName = `SiteInspections_Backup_${Utils.todayISO()}_${Utils.pad(d.getHours())}${Utils.pad(d.getMinutes())}.json`;
    } catch (err) {
      Utils.hideLoading();
      Utils.alert('Backup failed', err.message || String(err));
      return;
    } finally {
      Utils.hideLoading();
    }

    const delivered = await Utils.offerFile(blob, fileName, {
      title: 'Backup ready',
      message: `${counts.projects} project(s), ${counts.visits} site visit(s), ${counts.snags} snag(s), ${counts.photos} photo(s).\n\nOn iPhone tap "Share / Save" then "Save to Files" (e.g. iCloud Drive or OneDrive).`
    });
    if (!delivered) { Utils.toast('Backup not saved'); return; }
    await Settings.save({ lastBackupAt: Utils.nowStamp() });
    Utils.toast('Backup exported');
  }

  // ---------- Validation ----------
  /** Throws an Error describing the first problem found; returns the data object if valid. */
  function validate(obj) {
    const fail = msg => { throw new Error(msg); };
    if (!obj || typeof obj !== 'object') fail('The file is not a valid backup.');
    if (obj.app !== APP_ID) fail('This file is not a Site Inspections backup.');
    if (typeof obj.format !== 'number' || obj.format > FORMAT) fail('This backup was made by a newer version of the app.');
    const data = obj.data;
    if (!data || typeof data !== 'object') fail('Backup contains no data section.');
    // Backups made before drawings existed (v1.2 and earlier) have no drawing lists
    if (data.drawings === undefined) data.drawings = [];
    if (data.drawingImages === undefined) data.drawingImages = [];
    DB.ALL_STORES.forEach(n => {
      if (!Array.isArray(data[n])) fail(`Backup is missing the "${n}" list.`);
    });

    const isStr = v => typeof v === 'string' && v.length > 0;
    const projectIds = new Set();
    data.projects.forEach((p, i) => {
      if (!isStr(p.id) || typeof p.name !== 'string') fail(`Project #${i + 1} is damaged.`);
      projectIds.add(p.id);
    });
    const visitIds = new Set();
    data.visits.forEach((v, i) => {
      if (!isStr(v.id) || !projectIds.has(v.projectId)) fail(`Site visit #${i + 1} is damaged or has no project.`);
      visitIds.add(v.id);
    });
    const snagIds = new Set();
    data.snags.forEach((s, i) => {
      if (!isStr(s.id) || !visitIds.has(s.visitId) || !projectIds.has(s.projectId)) fail(`Snag #${i + 1} is damaged or has no site visit.`);
      if (s.status !== STATUS.OPEN && s.status !== STATUS.CLOSED) fail(`Snag ${s.number || '#' + (i + 1)} has an invalid status.`);
      if (!Array.isArray(s.photos)) fail(`Snag ${s.number || '#' + (i + 1)} has damaged photo information.`);
      snagIds.add(s.id);
    });
    data.photos.forEach((p, i) => {
      if (!isStr(p.id) || !snagIds.has(p.snagId)) fail(`Photo #${i + 1} is damaged or has no snag.`);
      if (typeof p.dataUrl !== 'string' || !p.dataUrl.startsWith('data:image/')) fail(`Photo #${i + 1} has no valid image data.`);
    });
    const drawingIds = new Set();
    data.drawings.forEach((d, i) => {
      if (!isStr(d.id) || !projectIds.has(d.projectId)) fail(`Drawing #${i + 1} is damaged or has no project.`);
      drawingIds.add(d.id);
    });
    data.drawingImages.forEach((d, i) => {
      if (!isStr(d.id) || !drawingIds.has(d.id)) fail(`Drawing image #${i + 1} belongs to no drawing.`);
      if (typeof d.dataUrl !== 'string' || !d.dataUrl.startsWith('data:image/')) fail(`Drawing image #${i + 1} has no valid image data.`);
    });
    data.settings.forEach(s => { if (!s || s.key !== 'main') fail('Settings section is damaged.'); });
    return data;
  }

  // ---------- Import ----------
  async function importBackup() {
    const files = await Utils.pickFiles({ accept: '.json,application/json' });
    if (!files) return;
    const file = files[0];

    let data;
    try {
      Utils.showLoading('Checking backup file…');
      const text = await file.text();
      let obj;
      try { obj = JSON.parse(text); } catch (e) { throw new Error('The file is not valid JSON – it may be incomplete or corrupted.'); }
      data = validate(obj);
      data._exportedAt = obj.exportedAt;
    } catch (err) {
      Utils.hideLoading();
      await Utils.alert('Backup not imported', `${err.message}\n\nNothing has been changed.`);
      return;
    }
    Utils.hideLoading();

    const existing = await DB.exportAll();
    const ok = await Utils.confirmTyped({
      title: 'Replace all data?',
      message:
        `Backup file: ${file.name}\n` +
        `Created: ${data._exportedAt ? Utils.formatStamp(data._exportedAt) : 'unknown'}\n` +
        `Contains: ${data.projects.length} project(s), ${data.visits.length} visit(s), ${data.snags.length} snag(s), ${data.photos.length} photo(s).\n\n` +
        `ALL data currently on this device (${existing.projects.length} project(s), ${existing.snags.length} snag(s)) will be permanently replaced.\n\n` +
        `If unsure, cancel and export a backup of the current data first.`,
      word: 'REPLACE',
      confirmLabel: 'Replace data'
    });
    if (!ok) return;

    try {
      Utils.showLoading('Restoring data…');
      delete data._exportedAt;
      await DB.replaceAll(data);
      await Settings.load();
      Utils.hideLoading();
      await Utils.alert('Restore complete', `${data.projects.length} project(s) and ${data.snags.length} snag(s) restored.`);
      App.goNoGuard('/');
    } catch (err) {
      Utils.hideLoading();
      Utils.alert('Restore failed', `${err.message || err}\n\nYour previous data has been kept.`);
    }
  }

  return { exportBackup, importBackup, validate };
})();
