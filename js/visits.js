/* =========================================================
   visits.js – Site visit screen (snag list, filters, report
   button) and the new/edit site visit form.
   ========================================================= */

const Visits = (() => {
  // Filter / sort choices are remembered per site visit while the app is open
  const viewState = {};

  /** Mark a project as recently active so it appears at the top of the home list. */
  async function touchProject(projectId) {
    const p = await DB.get('projects', projectId);
    if (p) { p.modifiedAt = Utils.nowStamp(); await DB.put('projects', p); }
  }

  // ---------- Site visit screen ----------
  async function renderDetail(id) {
    const visit = await DB.get('visits', id);
    if (!visit) return App.notFound('site visit');
    const project = await DB.get('projects', visit.projectId);
    const snags = await DB.getAllByIndex('snags', 'visitId', id);

    const state = viewState[id] || (viewState[id] = { filter: 'All', sort: 'number' });
    const openCount = snags.filter(s => s.status === STATUS.OPEN).length;
    const closedCount = snags.length - openCount;
    const carryable = await findCarryable(visit);

    App.render({
      title: visit.title || 'Site visit',
      back: `/project/${visit.projectId}`,
      backLabel: 'Project',
      body: `
        <div class="card info-card">
          <div class="card-sub">${Utils.esc(project ? project.name : '')}</div>
          <div class="card-title" style="margin:2px 0 10px">${Utils.esc(visit.title || 'Site visit')}</div>
          <dl>
            <dt>Date</dt><dd>${Utils.esc(Utils.formatDate(visit.date))}</dd>
            ${visit.inspector ? `<dt>Inspector</dt><dd>${Utils.esc(visit.inspector)}</dd>` : ''}
            ${visit.discipline ? `<dt>Discipline</dt><dd>${Utils.esc(visit.discipline)}</dd>` : ''}
            ${visit.notes ? `<dt>Notes</dt><dd>${Utils.esc(visit.notes)}</dd>` : ''}
          </dl>
          <div class="info-actions">
            <button type="button" class="btn sm" id="btn-edit">Edit visit</button>
            <button type="button" class="btn sm" id="btn-report" ${snags.length ? '' : 'disabled'}>Generate Report</button>
          </div>
        </div>

        ${carryable.length ? `
          <div class="banner info">
            <span><strong>${carryable.length} open snag${carryable.length === 1 ? '' : 's'}</strong> from earlier visits can be brought forward to this visit.</span>
            <button type="button" class="btn sm primary" id="btn-carry">Review</button>
          </div>` : ''}

        <div class="counters">
          <div class="counter"><b>${snags.length}</b><span>Total</span></div>
          <div class="counter open"><b>${openCount}</b><span>Open</span></div>
          <div class="counter closed"><b>${closedCount}</b><span>Closed</span></div>
        </div>

        ${snags.length ? `
          <div class="toolbar">
            <div class="segmented" id="filter">
              ${['All', 'Open', 'Closed'].map(f => `<button type="button" data-value="${f}" class="${state.filter === f ? 'active' : ''}">${f}</button>`).join('')}
            </div>
            <select id="sort" aria-label="Sort snags">
              <option value="number" ${state.sort === 'number' ? 'selected' : ''}>Snag no.</option>
              <option value="newest" ${state.sort === 'newest' ? 'selected' : ''}>Newest</option>
              <option value="oldest" ${state.sort === 'oldest' ? 'selected' : ''}>Oldest</option>
            </select>
          </div>` : ''}
        <div id="snag-list"></div>`,
      actions: `<button type="button" class="btn primary lg" id="btn-add-snag">+ ADD SNAG</button>`
    });

    function drawList() {
      let list = snags.slice();
      if (state.filter !== 'All') list = list.filter(s => s.status === state.filter);
      Snags.sortSnags(list, state.sort);
      const el = document.getElementById('snag-list');
      if (!snags.length) {
        el.innerHTML = `<div class="empty">No snags recorded yet.<br>Tap <strong>+ ADD SNAG</strong> to record the first one.</div>`;
      } else if (!list.length) {
        el.innerHTML = `<div class="empty">No ${state.filter.toLowerCase()} snags.</div>`;
      } else {
        el.innerHTML = list.map(snagCard).join('');
      }
    }

    drawList();

    document.getElementById('btn-add-snag').addEventListener('click', () => App.go(`/visit/${id}/snag/new`));
    document.getElementById('btn-edit').addEventListener('click', () => App.go(`/visit/${id}/edit`));
    document.getElementById('btn-report').addEventListener('click', () => Reports.start(id));
    const carryBtn = document.getElementById('btn-carry');
    if (carryBtn) carryBtn.addEventListener('click', () => reviewCarryForward(visit, carryable));
    const filter = document.getElementById('filter');
    if (filter) {
      filter.addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        state.filter = b.dataset.value;
        filter.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
        drawList();
      });
      document.getElementById('sort').addEventListener('change', e => { state.sort = e.target.value; drawList(); });
    }
  }

  const NOTE_STYLE = 'font-size:12px;font-weight:600;color:var(--accent);margin-top:4px';

  function snagCard(s) {
    const thumb = s.photos && s.photos.length ? s.photos[0].thumb : '';
    const closed = s.status === STATUS.CLOSED;
    return `
      <a class="card snag-card" href="#/snag/${encodeURIComponent(s.id)}">
        <div class="snag-body">
          <div class="snag-head">
            <span class="snag-no">${Utils.esc(s.number || '—')}</span>
            <span class="badge ${closed ? 'closed' : 'open'}">${closed ? 'Closed' : 'Open'}</span>
          </div>
          <div class="snag-area">${Utils.esc(s.area || 'No area recorded')}</div>
          <div class="snag-obs">${Utils.esc(s.observation || '')}</div>
          ${s.carriedForwardTo ? `<div style="${NOTE_STYLE}">➜ Carried forward to ${Utils.esc(Utils.formatDateShort(s.carriedForwardDate))} visit</div>` : ''}
          ${s.carriedFrom ? `<div style="${NOTE_STYLE}">↩ Brought forward from ${Utils.esc(Utils.formatDateShort(s.carriedFrom.visitDate))} visit</div>` : ''}
        </div>
        ${thumb ? `<img class="snag-thumb" src="${thumb}" alt="">` : `<div class="snag-thumb none">No photo</div>`}
      </a>`;
  }

  // ---------- Bring forward open snags from earlier visits ----------
  // The earlier visit keeps its snag unchanged (so its report stays a true record),
  // but it is marked "carried forward" and no longer counts as open on the project.
  // A copy – same number, text and photos – is created in this visit to be closed out.

  /** Open snags in earlier visits of the same project that haven't been carried forward yet. */
  async function findCarryable(visit) {
    const projectVisits = await DB.getAllByIndex('visits', 'projectId', visit.projectId);
    const visitsById = Object.fromEntries(projectVisits.map(v => [v.id, v]));
    const open = await DB.getAllByIndex('snags', 'projectStatus', [visit.projectId, STATUS.OPEN]);
    return open
      .filter(s => s.visitId !== visit.id && !s.carriedForwardTo && visitsById[s.visitId]
        && (visitsById[s.visitId].date || '') <= (visit.date || ''))
      .map(s => ({ snag: s, fromVisit: visitsById[s.visitId] }))
      .sort((a, b) => (a.fromVisit.date || '').localeCompare(b.fromVisit.date || '') || Utils.naturalCompare(a.snag.number, b.snag.number));
  }

  async function reviewCarryForward(visit, carryable) {
    const selected = await Utils.modal({
      title: 'Bring forward open snags',
      message: 'Ticked snags are copied into this visit with their numbers, descriptions and photos, ready to close out. The earlier visits keep their records.',
      bodyHtml: `<div class="choice carry-list">${carryable.map(({ snag: s, fromVisit: v }) => `
        <label>
          <input type="checkbox" value="${Utils.esc(s.id)}" checked>
          <span><strong>${Utils.esc(s.number)}</strong> · ${Utils.esc(s.area || 'No area')}
            <span class="small muted" style="display:block;font-weight:400">${Utils.esc(Utils.formatDateShort(v.date))} · ${Utils.esc(v.title || 'Site visit')}</span></span>
        </label>`).join('')}</div>`,
      buttons: [
        { label: 'Cancel', value: null },
        { label: 'Bring forward', value: 'ok', className: 'primary' }
      ],
      getValue: el => Array.from(el.querySelectorAll('.carry-list input:checked')).map(i => i.value)
    });
    if (!selected || !selected.length) return;
    const items = carryable.filter(c => selected.includes(c.snag.id));
    await carryForward(visit, items);
    App.go(`/visit/${visit.id}`);
  }

  async function carryForward(visit, items) {
    const existing = await DB.getAllByIndex('snags', 'visitId', visit.id);
    const usedNumbers = new Set(existing.map(s => (s.number || '').toUpperCase()));
    // All snags in the project – a replacement number must not repeat one used in any visit
    const projectSnags = await DB.getAllByIndex('snags', 'projectId', visit.projectId);
    const counters = { ...(visit.counters || {}) };
    let done = 0;
    try {
      for (const { snag: old, fromVisit } of items) {
        Utils.showLoading(`Bringing forward ${done + 1} of ${items.length}…`);

        // Keep the original number; only if it's already used in this visit, give the
        // next number not used anywhere in the project (shown as "previously E-001")
        let number = old.number;
        let previousNumber = '';
        if (usedNumbers.has((number || '').toUpperCase())) {
          previousNumber = old.number;
          number = Snags.nextNumber({ counters }, projectSnags, categoryPrefix(old.category));
        }

        // Copy the photos (each visit owns its own photos, so deleting one never affects the other)
        const now = Utils.nowStamp();
        const newId = Utils.uid();
        const newPhotos = [];
        const newPhotoMeta = [];
        for (const meta of (old.photos || [])) {
          const rec = await DB.get('photos', meta.id);
          if (!rec) continue;
          const pid = Utils.uid();
          newPhotos.push({ ...rec, id: pid, snagId: newId, visitId: visit.id, projectId: visit.projectId });
          newPhotoMeta.push({ ...meta, id: pid });
        }

        const newSnag = {
          ...old,
          id: newId,
          visitId: visit.id,
          number,
          previousNumber,
          status: STATUS.OPEN,
          closedDate: '',
          photos: newPhotoMeta,
          carriedForwardTo: '',
          carriedForwardDate: '',
          carriedForwardSnagId: '',
          carriedFrom: { snagId: old.id, visitId: fromVisit.id, visitDate: fromVisit.date },
          firstRecorded: old.firstRecorded || Utils.stampToDate(old.createdAt),
          createdAt: now,
          modifiedAt: now
        };
        const updatedOld = { ...old, carriedForwardTo: visit.id, carriedForwardDate: visit.date, carriedForwardSnagId: newId };

        // One transaction per snag: the copy and the "carried forward" mark are saved together
        await DB.run(['snags', 'photos'], 'readwrite', s => {
          newPhotos.forEach(p => s.photos.put(p));
          s.snags.put(newSnag);
          s.snags.put(updatedOld);
        });

        existing.push(newSnag);
        projectSnags.push(newSnag);
        usedNumbers.add(number.toUpperCase());
        const parsed = Snags.parseNumber(number);
        if (parsed && (counters[parsed.prefix] || 0) < parsed.num) counters[parsed.prefix] = parsed.num;
        done++;
      }
    } catch (err) {
      Utils.hideLoading();
      await Utils.alert('Not all snags brought forward', `${done} of ${items.length} were brought forward before an error occurred:\n${err.message || err}`);
    } finally {
      // Make sure new snags in this visit continue numbering after the brought-forward ones
      const fresh = await DB.get('visits', visit.id);
      if (fresh) {
        const merged = { ...(fresh.counters || {}) };
        Object.keys(counters).forEach(k => { merged[k] = Math.max(merged[k] || 0, counters[k]); });
        await DB.put('visits', { ...fresh, counters: merged });
      }
      await touchProject(visit.projectId);
      Utils.hideLoading();
    }
    if (done === items.length) Utils.toast(`${done} snag${done === 1 ? '' : 's'} brought forward`);
  }

  // ---------- New / edit site visit ----------
  async function renderForm(id, projectIdForNew) {
    const isEdit = !!id;
    let visit;
    if (isEdit) {
      visit = await DB.get('visits', id);
      if (!visit) return App.notFound('site visit');
    } else {
      const s = Settings.get();
      visit = {
        projectId: projectIdForNew,
        date: Utils.todayISO(),
        title: s.defaultDiscipline ? `${s.defaultDiscipline} Site Inspection` : 'Site Inspection',
        inspector: s.name,
        discipline: s.defaultDiscipline,
        notes: ''
      };
    }
    const project = await DB.get('projects', visit.projectId);
    if (!project) return App.notFound('project');

    const backTo = isEdit ? `/visit/${id}` : `/project/${visit.projectId}`;

    App.render({
      title: isEdit ? 'Edit Site Visit' : 'New Site Visit',
      back: backTo,
      backLabel: 'Cancel',
      body: `
        <p class="muted small" style="margin:0 2px 10px">${Utils.esc(project.name)}</p>
        <div class="form-card">
          <div class="field"><label for="v-date">Visit date <span class="req">*</span></label>
            <input type="date" id="v-date" value="${Utils.esc(visit.date)}"></div>
          <div class="field"><label for="v-title">Report / site visit title <span class="req">*</span></label>
            <input type="text" id="v-title" value="${Utils.esc(visit.title)}" autocapitalize="words"></div>
          <div class="field"><label for="v-inspector">Inspector / engineer</label>
            <input type="text" id="v-inspector" value="${Utils.esc(visit.inspector)}" autocapitalize="words"></div>
          <div class="field"><label for="v-disc">Discipline</label>
            ${selectWithOther('v-disc', DISCIPLINES, visit.discipline)}</div>
          <div class="field"><label for="v-notes">Notes (optional)</label>
            <textarea id="v-notes" rows="3" placeholder="e.g. weather, attendees, areas not accessible">${Utils.esc(visit.notes)}</textarea></div>
        </div>
        ${isEdit ? `<div class="danger-zone"><button type="button" class="btn danger block" id="btn-delete">Delete site visit…</button></div>` : ''}`,
      actions: `
        <button type="button" class="btn" id="btn-cancel">Cancel</button>
        <button type="button" class="btn primary grow2" id="btn-save">${isEdit ? 'Update Visit' : 'Save Visit'}</button>`
    });

    // Keep the title in step with the discipline while the user hasn't typed their own
    const titleInput = document.getElementById('v-title');
    let titleTouched = isEdit;
    titleInput.addEventListener('input', () => { titleTouched = true; });
    wireSelectOther('v-disc', () => {
      const d = readSelectOther('v-disc');
      if (!titleTouched) titleInput.value = d ? `${d} Site Inspection` : 'Site Inspection';
    });

    const read = () => ({
      date: document.getElementById('v-date').value,
      title: titleInput.value.trim(),
      inspector: document.getElementById('v-inspector').value.trim(),
      discipline: readSelectOther('v-disc'),
      notes: document.getElementById('v-notes').value.trim()
    });
    const initial = JSON.stringify(read());
    App.setDirtyCheck(() => JSON.stringify(read()) !== initial);

    document.getElementById('btn-cancel').addEventListener('click', () => App.go(backTo));

    document.getElementById('btn-save').addEventListener('click', async () => {
      const values = read();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date)) { Utils.toast('Please choose a visit date'); return; }
      if (!values.title) { Utils.toast('Please enter a title'); titleInput.focus(); return; }
      const now = Utils.nowStamp();
      const record = isEdit
        ? { ...visit, ...values, modifiedAt: now }
        : { id: Utils.uid(), projectId: visit.projectId, counters: {}, ...values, createdAt: now, modifiedAt: now };
      await DB.put('visits', record);
      await touchProject(record.projectId);
      Utils.toast(isEdit ? 'Site visit updated' : 'Site visit created');
      App.goNoGuard(`/visit/${record.id}`);
    });

    if (isEdit) {
      document.getElementById('btn-delete').addEventListener('click', async () => {
        const n = await DB.countByIndex('snags', 'visitId', id);
        const ok = await Utils.confirm({
          title: 'Delete site visit?',
          message: `"${visit.title}" (${Utils.formatDate(visit.date)}) will be permanently deleted with ${n} snag(s) and their photos.\n\nThis cannot be undone.`,
          confirmLabel: 'Delete', danger: true
        });
        if (!ok) return;
        await DB.deleteVisit(id);
        Utils.toast('Site visit deleted');
        App.goNoGuard(`/project/${visit.projectId}`);
      });
    }
  }

  return { renderDetail, renderForm, touchProject };
})();
