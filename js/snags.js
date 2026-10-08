/* =========================================================
   snags.js – Add / edit / close snag screen, photos,
   automatic snag numbering.

   NUMBERING
   Each site visit keeps a counter per prefix, e.g. { E: 7, M: 2 }.
   The next number is (highest number ever issued for that prefix
   in this visit) + 1, so deleting E-007 never makes E-007 reappear.
   Manually typed numbers (e.g. E-020) also move the counter on.
   ========================================================= */

const Snags = (() => {

  // ---------- Numbering ----------
  /** Split 'E-012' into { prefix: 'E', num: 12 }. Returns null if not in that form. */
  function parseNumber(number) {
    const m = /^\s*([A-Za-z]{1,4})\s*-?\s*(\d{1,6})\s*$/.exec(number || '');
    return m ? { prefix: m[1].toUpperCase(), num: parseInt(m[2], 10) } : null;
  }

  function formatNumber(prefix, num) {
    return `${prefix}-${String(num).padStart(3, '0')}`;
  }

  /** Next free number for `prefix` in this visit. */
  function nextNumber(visit, visitSnags, prefix) {
    let max = (visit.counters && visit.counters[prefix]) || 0;
    visitSnags.forEach(s => {
      const p = parseNumber(s.number);
      if (p && p.prefix === prefix && p.num > max) max = p.num;
    });
    return formatNumber(prefix, max + 1);
  }

  /** Sort helper shared with the visit screen and the report. */
  function sortSnags(list, sort) {
    if (sort === 'newest') list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    else if (sort === 'oldest') list.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    else list.sort((a, b) => Utils.naturalCompare(a.number, b.number));
    return list;
  }

  // ---------- Add / edit screen ----------
  async function renderForm(snagId, visitIdForNew) {
    const isEdit = !!snagId;
    let snag;
    if (isEdit) {
      snag = await DB.get('snags', snagId);
      if (!snag) return App.notFound('snag');
    }
    const visitId = isEdit ? snag.visitId : visitIdForNew;
    const visit = await DB.get('visits', visitId);
    if (!visit) return App.notFound('site visit');
    const project = await DB.get('projects', visit.projectId);
    const visitSnags = await DB.getAllByIndex('snags', 'visitId', visitId);
    const projectSnags = await DB.getAllByIndex('snags', 'projectId', visit.projectId);

    const categoryNames = CATEGORIES.map(c => c.name);
    if (!isEdit) {
      // Default category: the last one used in this visit, otherwise the visit's discipline
      const latest = visitSnags.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
      const category = latest ? latest.category
        : (categoryNames.includes(visit.discipline) ? visit.discipline : 'General');
      snag = {
        number: nextNumber(visit, visitSnags, categoryPrefix(category)),
        area: '', category, observation: '', action: '',
        contractor: '', status: STATUS.OPEN, photos: []
      };
    }

    // Working copy of photos: existing ones have only a thumbnail loaded;
    // new ones also carry the full-size dataUrl until saved.
    let photos = (snag.photos || []).map(p => ({ ...p, isNew: false }));
    const removedPhotoIds = [];
    let numberEdited = isEdit;
    let photoEdits = 0;   // counts mark-up changes, so unsaved markings trigger the "Discard changes?" warning
    let status = snag.status || STATUS.OPEN;

    // Suggestions for quick entry (areas & contractors already used in this project)
    const unique = arr => [...new Set(arr.filter(Boolean).map(s => s.trim()))].sort(Utils.naturalCompare);
    const areas = unique(projectSnags.map(s => s.area));
    const contractors = unique(projectSnags.map(s => s.contractor).concat(project ? [project.mainContractor] : []));

    const backTo = `/visit/${visitId}`;

    App.render({
      title: isEdit ? `Snag ${snag.number}` : 'Add Snag',
      back: backTo,
      backLabel: 'Cancel',
      body: `
        <div class="form-card">
          <div class="row">
            <div class="field" style="flex:0 0 38%">
              <label for="f-number">Snag no. <span class="req">*</span></label>
              <input type="text" id="f-number" value="${Utils.esc(snag.number)}" autocapitalize="characters" autocomplete="off" spellcheck="false">
            </div>
            <div class="field">
              <label for="f-category">Category</label>
              ${selectWithOther('f-category', categoryNames, snag.category)}
            </div>
          </div>
          <div class="field">
            <label for="f-area">Area / location</label>
            <input type="text" id="f-area" list="area-list" value="${Utils.esc(snag.area)}" placeholder="e.g. Ground Floor – Electrical Room" autocapitalize="words" autocomplete="off">
            <datalist id="area-list">${areas.map(a => `<option value="${Utils.esc(a)}">`).join('')}</datalist>
          </div>
        </div>

        <div class="form-card">
          <span class="label" style="font-weight:650;font-size:14px">Photos <span class="muted small" id="photo-count"></span></span>
          <div class="photo-grid" id="photo-grid"></div>
          <div class="photo-buttons mt" id="photo-buttons"></div>
        </div>

        <div class="form-card">
          <div class="field">
            <label for="f-obs">Observation <span class="req">*</span></label>
            <textarea id="f-obs" rows="5" autocapitalize="sentences" placeholder="Describe the defect. Tip: tap the keyboard microphone to dictate.">${Utils.esc(snag.observation)}</textarea>
          </div>
          <div class="field">
            <label for="f-action">Required corrective action</label>
            <textarea id="f-action" rows="4" autocapitalize="sentences" placeholder="What must be done to close this snag?">${Utils.esc(snag.action)}</textarea>
          </div>
          <div class="field">
            <label for="f-contractor">Responsible contractor</label>
            <input type="text" id="f-contractor" list="contractor-list" value="${Utils.esc(snag.contractor)}" autocapitalize="words" autocomplete="off">
            <datalist id="contractor-list">${contractors.map(c => `<option value="${Utils.esc(c)}">`).join('')}</datalist>
          </div>
        </div>

        <div class="form-card">
          <span class="label" style="display:block;font-weight:650;font-size:14px;margin-bottom:6px">Status</span>
          <div class="segmented status large" id="f-status">
            <button type="button" data-value="Open">Open</button>
            <button type="button" data-value="Closed">Closed</button>
          </div>
          ${isEdit && snag.closedDate ? `<div class="hint small muted mt">Closed on ${Utils.esc(Utils.formatDate(snag.closedDate))}</div>` : ''}
        </div>

        ${isEdit ? `
          <p class="small muted" style="margin:0 2px">Created ${Utils.esc(Utils.formatStamp(snag.createdAt))}${snag.modifiedAt && snag.modifiedAt !== snag.createdAt ? ` · Modified ${Utils.esc(Utils.formatStamp(snag.modifiedAt))}` : ''}</p>
          <div class="danger-zone"><button type="button" class="btn danger block" id="btn-delete">Delete snag…</button></div>` : ''}`,
      actions: `
        <button type="button" class="btn" id="btn-cancel">Cancel</button>
        <button type="button" class="btn primary grow2" id="btn-save">${isEdit ? 'UPDATE SNAG' : 'SAVE SNAG'}</button>`
    });

    const numberInput = document.getElementById('f-number');

    // ----- Category change -> renumber (only while number not manually edited) -----
    numberInput.addEventListener('input', () => { numberEdited = true; });
    wireSelectOther('f-category', () => {
      if (numberEdited) return;
      const cat = readSelectOther('f-category');
      numberInput.value = nextNumber(visit, visitSnags, categoryPrefix(cat));
    });

    // ----- Status -----
    const statusEl = document.getElementById('f-status');
    function drawStatus() {
      statusEl.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.value === status));
      drawPhotos();
    }
    statusEl.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      status = b.dataset.value;
      drawStatus();
    });

    // ----- Photos -----
    function drawPhotos() {
      const grid = document.getElementById('photo-grid');
      grid.innerHTML = photos.map((p, i) => `
        <button type="button" class="photo-tile" data-i="${i}" aria-label="View photo ${i + 1}">
          <img src="${p.thumb}" alt="">
          ${p.kind === 'closeout' ? '<span class="tag">CLOSE-OUT</span>' : ''}
        </button>`).join('');
      grid.hidden = photos.length === 0;
      document.getElementById('photo-count').textContent = photos.length ? `(${photos.length} of ${MAX_PHOTOS_PER_SNAG})` : '';

      const full = photos.length >= MAX_PHOTOS_PER_SNAG;
      const btns = document.getElementById('photo-buttons');
      btns.innerHTML = full
        ? `<p class="small muted" style="margin:0">Maximum of ${MAX_PHOTOS_PER_SNAG} photos reached. Tap a photo to delete or replace it.</p>`
        : `<button type="button" class="btn photo" id="btn-add-photo">${App.ICONS.camera} ${photos.length ? 'Add Another Photo' : 'Take Photo / Add Photo'}</button>
           ${status === STATUS.CLOSED ? `<button type="button" class="btn photo" id="btn-add-closeout" style="color:var(--closed);border-color:var(--closed);background:var(--closed-soft)">${App.ICONS.camera} Add Close-out Photo</button>` : ''}`;
      const add = document.getElementById('btn-add-photo');
      if (add) add.addEventListener('click', () => addPhotos('issue'));
      const addC = document.getElementById('btn-add-closeout');
      if (addC) addC.addEventListener('click', () => addPhotos('closeout'));
    }

    document.getElementById('photo-grid').addEventListener('click', e => {
      const tile = e.target.closest('.photo-tile');
      if (tile) viewPhoto(+tile.dataset.i);
    });

    async function processFile(file, kind) {
      const res = await Utils.compressPhoto(file);
      return { id: Utils.uid(), kind, thumb: res.thumb, dataUrl: res.dataUrl, width: res.width, height: res.height, isNew: true };
    }

    async function addPhotos(kind) {
      // On iPhone, this offers "Take Photo", "Photo Library" or "Choose File".
      const files = await Utils.pickFiles({ accept: 'image/*', multiple: true });
      if (!files) return;
      const room = MAX_PHOTOS_PER_SNAG - photos.length;
      const toProcess = files.slice(0, room);
      try {
        for (let i = 0; i < toProcess.length; i++) {
          Utils.showLoading(toProcess.length > 1 ? `Processing photo ${i + 1} of ${toProcess.length}…` : 'Processing photo…');
          photos.push(await processFile(toProcess[i], kind));
        }
      } catch (err) {
        Utils.hideLoading();
        Utils.alert('Photo not added', err.message || String(err));
      }
      Utils.hideLoading();
      if (files.length > room) Utils.toast(`Only ${room} more photo(s) allowed per snag`);
      drawPhotos();
    }

    async function viewPhoto(index) {
      const p = photos[index];
      // Saved photos only have a thumbnail in memory: load the full record once
      if (!p.dataUrl) {
        const rec = await DB.get('photos', p.id);
        if (rec) {
          p.dataUrl = rec.dataUrl;
          p.originalDataUrl = rec.originalDataUrl || '';
          p.markup = rec.markup || [];
          p.createdAt = rec.createdAt;
        }
      }
      const src = p.dataUrl || p.thumb;
      const action = await Utils.modal({
        title: `Photo ${index + 1}${p.kind === 'closeout' ? ' (close-out)' : ''}`,
        bodyHtml: `<div class="photo-viewer"><img src="${src}" alt=""></div>
          <button type="button" class="btn primary block mt" id="btn-markup">✎ Mark up – arrows &amp; circles</button>`,
        buttons: [
          { label: 'Delete', value: 'delete', className: 'danger' },
          { label: 'Replace', value: 'replace' },
          { label: 'Close', value: null }
        ],
        onOpen: (modalEl, close) => {
          modalEl.querySelector('#btn-markup').addEventListener('click', () => close('markup'));
        }
      });
      if (action === 'markup') {
        if (!p.dataUrl) { Utils.alert('Photo not available', 'This photo could not be loaded.'); return; }
        // Always draw on the original photo, so re-editing never loses quality
        const base = p.originalDataUrl || p.dataUrl;
        let res;
        try {
          res = await Markup.open({ baseDataUrl: base, shapes: p.markup || [] });
        } catch (err) {
          Utils.alert('Mark-up failed', err.message || String(err));
          return;
        }
        if (!res) return;
        p.dataUrl = res.dataUrl;
        p.thumb = res.thumb;
        p.width = res.width;
        p.height = res.height;
        p.markup = res.shapes;
        p.originalDataUrl = res.shapes.length ? base : '';
        if (!p.isNew) p.changed = true;
        photoEdits++;
        drawPhotos();
        return;
      }
      if (action === 'delete') {
        const ok = await Utils.confirm({ title: 'Remove this photo?', message: 'The photo is removed when you save the snag.', confirmLabel: 'Remove', danger: true });
        if (!ok) return;
        if (!p.isNew) removedPhotoIds.push(p.id);
        photos.splice(index, 1);
        drawPhotos();
      } else if (action === 'replace') {
        const files = await Utils.pickFiles({ accept: 'image/*' });
        if (!files) return;
        try {
          Utils.showLoading('Processing photo…');
          const np = await processFile(files[0], p.kind);
          if (!p.isNew) removedPhotoIds.push(p.id);
          photos[index] = np;
        } catch (err) {
          Utils.alert('Photo not replaced', err.message || String(err));
        } finally {
          Utils.hideLoading();
        }
        drawPhotos();
      }
    }

    drawStatus();

    // ----- Unsaved changes detection -----
    const read = () => ({
      number: numberInput.value.trim().toUpperCase(),
      category: readSelectOther('f-category') || 'General',
      area: document.getElementById('f-area').value.trim(),
      observation: document.getElementById('f-obs').value.trim(),
      action: document.getElementById('f-action').value.trim(),
      contractor: document.getElementById('f-contractor').value.trim(),
      status
    });
    const snapshot = () => JSON.stringify(read()) + photos.map(p => p.id).join(',') + '#' + photoEdits;
    const initial = snapshot();
    App.setDirtyCheck(() => snapshot() !== initial);

    // ----- Buttons -----
    document.getElementById('btn-cancel').addEventListener('click', () => App.go(backTo));

    const saveBtn = document.getElementById('btn-save');
    saveBtn.addEventListener('click', async () => {
      const values = read();
      if (!values.number) { Utils.toast('Snag number is required'); numberInput.focus(); return; }
      if (!values.observation) { Utils.toast('Please enter an observation'); document.getElementById('f-obs').focus(); return; }

      const duplicate = visitSnags.find(s => s.id !== snag.id && (s.number || '').toUpperCase() === values.number);
      if (duplicate) {
        const ok = await Utils.confirm({
          title: 'Duplicate snag number',
          message: `${values.number} is already used in this site visit. Save anyway?`,
          confirmLabel: 'Save anyway'
        });
        if (!ok) return;
      }

      saveBtn.disabled = true;
      try {
        const now = Utils.nowStamp();
        const id = isEdit ? snag.id : Utils.uid();

        // Close-out date: set when first closed, cleared if re-opened
        let closedDate = snag.closedDate || '';
        if (values.status === STATUS.CLOSED && snag.status !== STATUS.CLOSED) closedDate = Utils.todayISO();
        if (values.status === STATUS.OPEN) closedDate = '';

        const record = {
          ...(isEdit ? snag : {}),
          ...values,
          id,
          visitId,
          projectId: visit.projectId,
          closedDate,
          photos: photos.map(p => ({
            id: p.id, kind: p.kind, thumb: p.thumb, width: p.width, height: p.height,
            marked: !!(p.markup && p.markup.length)
          })),
          createdAt: isEdit ? snag.createdAt : now,
          modifiedAt: now
        };

        // New photos, plus existing photos whose markings changed, are written to the database
        const newPhotos = photos.filter(p => p.isNew || p.changed).map(p => ({
          id: p.id, snagId: id, visitId, projectId: visit.projectId, kind: p.kind,
          dataUrl: p.dataUrl, width: p.width, height: p.height,
          markup: p.markup || [], originalDataUrl: p.originalDataUrl || '',
          createdAt: p.createdAt || now
        }));

        // Move the visit's counter forward so numbers are never reused
        const parsed = parseNumber(values.number);
        let updatedVisit = null;
        if (parsed) {
          const counters = { ...(visit.counters || {}) };
          if ((counters[parsed.prefix] || 0) < parsed.num) {
            counters[parsed.prefix] = parsed.num;
            updatedVisit = { ...visit, counters };
          }
        }

        await DB.saveSnag({ snag: record, newPhotos, removedPhotoIds, visit: updatedVisit });
        await Visits.touchProject(visit.projectId);
        Utils.toast(isEdit ? `${record.number} updated` : `${record.number} saved`);
        App.goNoGuard(backTo);
      } catch (err) {
        saveBtn.disabled = false;
        const quota = err && (err.name === 'QuotaExceededError' || /quota/i.test(err.message || ''));
        Utils.alert('Snag NOT saved', quota
          ? 'The device storage for this app is full. Export a backup, then delete old projects or photos.'
          : (err.message || String(err)));
      }
    });

    if (isEdit) {
      document.getElementById('btn-delete').addEventListener('click', async () => {
        const ok = await Utils.confirm({
          title: `Delete snag ${snag.number}?`,
          message: 'The snag and its photos will be permanently deleted. Its number will not be reused.',
          confirmLabel: 'Delete', danger: true
        });
        if (!ok) return;
        // Make sure the counter covers this number so it is never reissued
        const parsed = parseNumber(snag.number);
        if (parsed && ((visit.counters || {})[parsed.prefix] || 0) < parsed.num) {
          await DB.put('visits', { ...visit, counters: { ...(visit.counters || {}), [parsed.prefix]: parsed.num } });
        }
        await DB.deleteSnag(snag.id);
        Utils.toast(`${snag.number} deleted`);
        App.goNoGuard(backTo);
      });
    }
  }

  return { renderForm, sortSnags, parseNumber, nextNumber };
})();
