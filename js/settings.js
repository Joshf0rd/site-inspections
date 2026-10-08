/* =========================================================
   settings.js – report settings (name, company, logo…) and
   the Settings screen (which also hosts Backup / Restore).
   ========================================================= */

const Settings = (() => {
  const DEFAULTS = {
    key: 'main',
    name: '',
    jobTitle: '',
    company: '',
    defaultDiscipline: 'Electrical',
    logoDataUrl: '',        // optional company logo (PNG/JPEG data URL)
    lastBackupAt: ''        // ISO timestamp of last successful backup export
  };
  let current = { ...DEFAULTS };

  async function load() {
    const saved = await DB.get('settings', 'main');
    current = { ...DEFAULTS, ...(saved || {}) };
    return current;
  }

  function get() { return current; }

  async function save(changes) {
    current = { ...current, ...changes, key: 'main' };
    await DB.put('settings', current);
    return current;
  }

  // ---------- Settings screen ----------
  async function render() {
    const s = await load();
    let logo = s.logoDataUrl;

    let storageInfo = '';
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const est = await navigator.storage.estimate();
        const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
        storageInfo = `Using ${Utils.formatBytes(est.usage)} of local storage` +
          (persisted ? ' · storage marked as persistent' : '');
      } catch (e) { /* not available */ }
    }

    App.render({
      title: 'Settings',
      back: '/',
      body: `
        <div class="section-title">Report details</div>
        <div class="form-card">
          <div class="field"><label for="s-name">Your name</label>
            <input type="text" id="s-name" value="${Utils.esc(s.name)}" autocomplete="name" placeholder="e.g. Joshua Ford"></div>
          <div class="field"><label for="s-title">Job title</label>
            <input type="text" id="s-title" value="${Utils.esc(s.jobTitle)}" placeholder="e.g. Electrical Engineer"></div>
          <div class="field"><label for="s-company">Company name</label>
            <input type="text" id="s-company" value="${Utils.esc(s.company)}" autocomplete="organization"></div>
          <div class="field"><label for="s-disc">Default discipline for new site visits</label>
            ${selectWithOther('s-disc', DISCIPLINES, s.defaultDiscipline)}</div>
          <div class="field"><span class="label">Company logo (optional)</span>
            <div id="logo-area"></div>
            <div class="hint">Shown at the top of each PDF page. PNG with a transparent background looks best.</div>
          </div>
        </div>

        <div class="section-title">Backup &amp; restore</div>
        <div class="form-card">
          <p class="small" style="margin-top:0">All data is stored only on this device. Export a backup regularly
            and keep it somewhere safe (e.g. iCloud Drive, OneDrive, email to yourself).</p>
          <p class="small muted">Last backup: <strong>${s.lastBackupAt ? Utils.esc(Utils.formatStamp(s.lastBackupAt)) : 'never'}</strong></p>
          <div class="stack">
            <button type="button" class="btn primary block" id="btn-export">Export backup</button>
            <button type="button" class="btn block" id="btn-import">Import backup…</button>
          </div>
          ${storageInfo ? `<p class="small muted" style="margin-bottom:0">${Utils.esc(storageInfo)}</p>` : ''}
        </div>

        <p class="small muted" style="text-align:center">Site Inspections v${App.APP_VERSION} · works offline · data stays on this device</p>`,
      actions: `<button type="button" class="btn primary lg" id="btn-save">Save settings</button>`
    });

    function renderLogo() {
      document.getElementById('logo-area').innerHTML = logo
        ? `<img src="${logo}" class="logo-preview" alt="Company logo">
           <div class="photo-buttons"><button type="button" class="btn sm" id="logo-change">Change logo</button>
           <button type="button" class="btn sm danger" id="logo-remove">Remove logo</button></div>`
        : `<button type="button" class="btn sm" id="logo-change">Upload logo</button>`;
      document.getElementById('logo-change').addEventListener('click', pickLogo);
      const rm = document.getElementById('logo-remove');
      if (rm) rm.addEventListener('click', () => { logo = ''; renderLogo(); });
    }

    async function pickLogo() {
      const files = await Utils.pickFiles({ accept: 'image/png,image/jpeg' });
      if (!files) return;
      try {
        const res = await Utils.compressLogo(files[0]);
        logo = res.dataUrl;
        renderLogo();
      } catch (err) {
        Utils.alert('Logo not added', err.message);
      }
    }

    renderLogo();
    wireSelectOther('s-disc');

    const readForm = () => ({
      name: document.getElementById('s-name').value.trim(),
      jobTitle: document.getElementById('s-title').value.trim(),
      company: document.getElementById('s-company').value.trim(),
      defaultDiscipline: readSelectOther('s-disc') || 'General',
      logoDataUrl: logo
    });
    const initial = JSON.stringify(readForm());
    App.setDirtyCheck(() => JSON.stringify(readForm()) !== initial);

    document.getElementById('btn-save').addEventListener('click', async () => {
      await save(readForm());
      Utils.toast('Settings saved');
      App.goNoGuard('/');
    });
    document.getElementById('btn-export').addEventListener('click', () => Backup.exportBackup());
    document.getElementById('btn-import').addEventListener('click', () => Backup.importBackup());
  }

  return { load, get, save, render };
})();
