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
        </div>
        ${thumb ? `<img class="snag-thumb" src="${thumb}" alt="">` : `<div class="snag-thumb none">No photo</div>`}
      </a>`;
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
