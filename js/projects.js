/* =========================================================
   projects.js – Projects list (home), project details,
   new/edit project form, delete project.
   ========================================================= */

const Projects = (() => {
  let searchText = '';   // remembered while the app is open

  // ---------- Home: list of projects ----------
  async function renderList() {
    const projects = await DB.getAll('projects');
    projects.sort((a, b) => (b.modifiedAt || '').localeCompare(a.modifiedAt || ''));

    // Counts for each card (cheap index counts, no photos loaded)
    const stats = await Promise.all(projects.map(async p => ({
      open: await DB.countByIndex('snags', 'projectStatus', [p.id, STATUS.OPEN]),
      visits: await DB.countByIndex('visits', 'projectId', p.id)
    })));

    const settings = Settings.get();
    const daysSinceBackup = settings.lastBackupAt
      ? (Date.now() - new Date(settings.lastBackupAt).getTime()) / 86400000 : Infinity;
    const showBackupReminder = projects.length > 0 && daysSinceBackup > 7;

    App.render({
      title: 'Site Inspections',
      homeTitle: true,
      right: `<button type="button" class="icon-btn" id="btn-settings" aria-label="Settings">${App.ICONS.settings}</button>`,
      body: `
        ${showBackupReminder ? `
          <div class="banner">
            <span>${settings.lastBackupAt ? `Last backup was ${Math.floor(daysSinceBackup)} days ago.` : 'You have not exported a backup yet.'}</span>
            <button type="button" class="btn sm" id="btn-backup-now">Back up</button>
          </div>` : ''}
        ${projects.length > 3 ? `
          <input type="search" id="project-search" placeholder="Search projects, references, clients…" value="${Utils.esc(searchText)}" autocomplete="off">` : ''}
        <div class="section-title">Projects <span>${projects.length || ''}</span></div>
        <div id="project-list">
          ${projects.length === 0 ? `
            <div class="empty">
              <p><strong>No projects yet</strong></p>
              <p>Tap <strong>+ New Project</strong> to get started.<br>Set your name and company in Settings (gear icon) for your reports.</p>
            </div>` :
            projects.map((p, i) => projectCard(p, stats[i])).join('')}
          <div class="empty" id="no-results" hidden>No projects match your search.</div>
        </div>`,
      actions: `<button type="button" class="btn primary lg" id="btn-new-project">+ New Project</button>`
    });

    document.getElementById('btn-settings').addEventListener('click', () => App.go('/settings'));
    document.getElementById('btn-new-project').addEventListener('click', () => App.go('/project/new'));
    const bk = document.getElementById('btn-backup-now');
    if (bk) bk.addEventListener('click', () => Backup.exportBackup());

    const search = document.getElementById('project-search');
    if (search) {
      const apply = () => {
        searchText = search.value;
        const q = searchText.trim().toLowerCase();
        let shown = 0;
        document.querySelectorAll('#project-list .project-card').forEach(card => {
          const match = !q || card.dataset.search.includes(q);
          card.hidden = !match;
          if (match) shown++;
        });
        document.getElementById('no-results').hidden = shown > 0;
      };
      search.addEventListener('input', apply);
      apply();
    }
  }

  function projectCard(p, st) {
    const searchKey = [p.name, p.number, p.client, p.site, p.mainContractor].join(' ').toLowerCase();
    return `
      <a class="card project-card" href="#/project/${encodeURIComponent(p.id)}" data-search="${Utils.esc(searchKey)}">
        <div class="card-title">${Utils.esc(p.name)}</div>
        <div class="card-sub">${Utils.esc([p.number, p.client].filter(Boolean).join(' · ') || '—')}</div>
        <div class="card-meta">
          <span><strong style="color:${st.open ? 'var(--open)' : 'inherit'}">${st.open}</strong> open snag${st.open === 1 ? '' : 's'}</span>
          <span><strong>${st.visits}</strong> site visit${st.visits === 1 ? '' : 's'}</span>
        </div>
      </a>`;
  }

  // ---------- Project details + site visits ----------
  async function renderDetail(id) {
    const project = await DB.get('projects', id);
    if (!project) return App.notFound('project');

    const visits = await DB.getAllByIndex('visits', 'projectId', id);
    // Newest visit first; same date -> most recently created first
    visits.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
    const counts = await Promise.all(visits.map(async v => ({
      open: await DB.countByIndex('snags', 'visitStatus', [v.id, STATUS.OPEN]),
      closed: await DB.countByIndex('snags', 'visitStatus', [v.id, STATUS.CLOSED])
    })));

    const row = (label, value) => value ? `<dt>${label}</dt><dd>${Utils.esc(value)}</dd>` : '';

    App.render({
      title: project.name,
      back: '/',
      backLabel: 'Projects',
      body: `
        <div class="card info-card">
          <div class="card-title">${Utils.esc(project.name)}</div>
          <dl>
            ${row('Project no.', project.number)}
            ${row('Client', project.client)}
            ${row('Site', project.site)}
            ${row('Main contractor', project.mainContractor)}
            ${row('Notes', project.notes)}
          </dl>
          <div class="info-actions">
            <button type="button" class="btn sm" id="btn-edit">Edit project</button>
          </div>
        </div>

        <div class="section-title">Site visits <span>${visits.length || ''}</span></div>
        ${visits.length === 0 ? `<div class="empty">No site visits yet.<br>Tap <strong>+ New Site Visit</strong> when you arrive on site.</div>` :
          visits.map((v, i) => {
            const c = counts[i];
            const total = c.open + c.closed;
            return `
              <a class="card" href="#/visit/${encodeURIComponent(v.id)}">
                <div class="card-sub"><strong style="color:var(--text)">${Utils.esc(Utils.formatDateShort(v.date))}</strong>${v.discipline ? ' · ' + Utils.esc(v.discipline) : ''}</div>
                <div class="card-title" style="margin-top:2px">${Utils.esc(v.title || 'Site visit')}</div>
                <div class="card-meta">
                  <span><strong>${total}</strong> snag${total === 1 ? '' : 's'}</span>
                  ${total ? `<span><strong style="color:var(--open)">${c.open}</strong> open / <strong style="color:var(--closed)">${c.closed}</strong> closed</span>` : ''}
                </div>
              </a>`;
          }).join('')}`,
      actions: `<button type="button" class="btn primary lg" id="btn-new-visit">+ New Site Visit</button>`
    });

    document.getElementById('btn-edit').addEventListener('click', () => App.go(`/project/${id}/edit`));
    document.getElementById('btn-new-visit').addEventListener('click', () => App.go(`/project/${id}/visit/new`));
  }

  // ---------- New / edit project ----------
  async function renderForm(id) {
    const isEdit = !!id;
    const project = isEdit ? await DB.get('projects', id) : {};
    if (isEdit && !project) return App.notFound('project');

    const field = (key, label, opts = {}) => `
      <div class="field">
        <label for="p-${key}">${label}${opts.required ? ' <span class="req">*</span>' : ''}</label>
        ${opts.textarea
          ? `<textarea id="p-${key}" rows="3">${Utils.esc(project[key] || '')}</textarea>`
          : `<input type="text" id="p-${key}" value="${Utils.esc(project[key] || '')}" placeholder="${opts.placeholder || ''}" autocapitalize="${opts.caps || 'words'}">`}
      </div>`;

    App.render({
      title: isEdit ? 'Edit Project' : 'New Project',
      back: isEdit ? `/project/${id}` : '/',
      backLabel: 'Cancel',
      body: `
        <div class="form-card">
          ${field('name', 'Project name', { required: true, placeholder: 'e.g. Klein Windhoek Office Development' })}
          ${field('number', 'Project number / reference', { placeholder: 'e.g. WCE-2026-014', caps: 'characters' })}
          ${field('client', 'Client')}
          ${field('site', 'Site / location')}
          ${field('mainContractor', 'Main contractor')}
          ${field('notes', 'Notes (optional)', { textarea: true })}
        </div>
        ${isEdit ? `
          <div class="danger-zone">
            <button type="button" class="btn danger block" id="btn-delete">Delete project…</button>
          </div>` : ''}`,
      actions: `
        <button type="button" class="btn" id="btn-cancel">Cancel</button>
        <button type="button" class="btn primary grow2" id="btn-save">${isEdit ? 'Update Project' : 'Save Project'}</button>`
    });

    const keys = ['name', 'number', 'client', 'site', 'mainContractor', 'notes'];
    const read = () => Object.fromEntries(keys.map(k => [k, document.getElementById('p-' + k).value.trim()]));
    const initial = JSON.stringify(read());
    App.setDirtyCheck(() => JSON.stringify(read()) !== initial);

    document.getElementById('btn-cancel').addEventListener('click', () => App.go(isEdit ? `/project/${id}` : '/'));

    document.getElementById('btn-save').addEventListener('click', async () => {
      const values = read();
      if (!values.name) {
        document.getElementById('p-name').closest('.field').classList.add('invalid');
        document.getElementById('p-name').focus();
        Utils.toast('Project name is required');
        return;
      }
      const now = Utils.nowStamp();
      const record = isEdit
        ? { ...project, ...values, modifiedAt: now }
        : { id: Utils.uid(), ...values, createdAt: now, modifiedAt: now };
      await DB.put('projects', record);
      Utils.toast(isEdit ? 'Project updated' : 'Project created');
      App.goNoGuard(`/project/${record.id}`);
    });

    if (isEdit) {
      document.getElementById('btn-delete').addEventListener('click', async () => {
        const visitCount = await DB.countByIndex('visits', 'projectId', id);
        const snagCount = await DB.countByIndex('snags', 'projectId', id);
        const ok = await Utils.confirmTyped({
          title: 'Delete project?',
          message: `"${project.name}" will be permanently deleted together with ${visitCount} site visit(s), ${snagCount} snag(s) and all their photos.\n\nThis cannot be undone.`,
          word: 'DELETE',
          confirmLabel: 'Delete project'
        });
        if (!ok) return;
        await DB.deleteProject(id);
        Utils.toast('Project deleted');
        App.goNoGuard('/');
      });
    } else {
      document.getElementById('p-name').focus();
    }
  }

  return { renderList, renderDetail, renderForm };
})();
