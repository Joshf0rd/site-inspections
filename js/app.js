/* =========================================================
   app.js – starts the app, routes between screens, registers
   the service worker.

   Screens are addressed with the URL hash, e.g.
     #/                          Projects (home)
     #/project/new               New project
     #/project/<id>              Project details + site visits
     #/project/<id>/edit         Edit project
     #/project/<id>/visit/new    New site visit
     #/visit/<id>                Site visit + snag list
     #/visit/<id>/edit           Edit site visit
     #/visit/<id>/snag/new       Add snag
     #/snag/<id>                 Edit / close snag
     #/settings                  Settings, backup & restore
   ========================================================= */

const App = (() => {
  const APP_VERSION = '1.3.0';

  const routes = [
    [/^\/?$/, () => Projects.renderList()],
    [/^\/project\/new$/, () => Projects.renderForm(null)],
    [/^\/project\/([^/]+)\/edit$/, id => Projects.renderForm(id)],
    [/^\/project\/([^/]+)\/visit\/new$/, pid => Visits.renderForm(null, pid)],
    [/^\/project\/([^/]+)$/, id => Projects.renderDetail(id)],
    [/^\/visit\/([^/]+)\/edit$/, id => Visits.renderForm(id)],
    [/^\/visit\/([^/]+)\/snag\/new$/, vid => Snags.renderForm(null, vid)],
    [/^\/visit\/([^/]+)$/, id => Visits.renderDetail(id)],
    [/^\/snag\/([^/]+)$/, id => Snags.renderForm(id)],
    [/^\/settings$/, () => Settings.render()]
  ];

  // ---------- Unsaved-changes guard ----------
  // A form screen can register a function that returns true when it has unsaved edits.
  let dirtyCheck = null;
  let currentHash = null;
  let ignoreNextHashChange = false;

  function setDirtyCheck(fn) { dirtyCheck = fn; }
  function isDirty() { return !!(dirtyCheck && dirtyCheck()); }

  async function onHashChange() {
    if (ignoreNextHashChange) { ignoreNextHashChange = false; return; }
    const target = location.hash;
    if (isDirty()) {
      // Go back to the form while we ask
      ignoreNextHashChange = true;
      location.hash = currentHash;
      const discard = await Utils.confirm({
        title: 'Discard changes?',
        message: 'You have unsaved changes on this screen.',
        confirmLabel: 'Discard', cancelLabel: 'Keep editing', danger: true
      });
      if (!discard) return;
      dirtyCheck = null;
      location.hash = target;   // triggers hashchange again, now without the guard
      return;
    }
    route();
  }

  /** Navigate to a route, e.g. App.go('/project/abc'). */
  function go(path) {
    const hash = '#' + path;
    if (location.hash === hash) route();
    else location.hash = hash;
  }

  /** Navigate without the unsaved-changes prompt (used after a successful save). */
  function goNoGuard(path) {
    dirtyCheck = null;
    go(path);
  }

  async function route() {
    dirtyCheck = null;
    currentHash = location.hash || '#/';
    const path = (location.hash || '#/').slice(1).split('?')[0];
    for (const [pattern, handler] of routes) {
      const m = pattern.exec(path);
      if (m) {
        try {
          await handler(...m.slice(1).map(decodeURIComponent));
        } catch (err) {
          console.error(err);
          renderError(err);
        }
        window.scrollTo(0, 0);
        return;
      }
    }
    go('/');
  }

  // ---------- Page shell ----------
  const ICONS = {
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    camera: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>'
  };

  /**
   * Render a full screen.
   *  title      – top bar title
   *  back       – route to go back to (shows a back arrow), or null on home
   *  right      – HTML for the right side of the top bar
   *  body       – main content HTML
   *  actions    – HTML for the fixed bottom action bar (optional)
   */
  function render({ title, back = null, backLabel = 'Back', right = '', body, actions = '', homeTitle = false }) {
    document.getElementById('app').innerHTML = `
      <header class="topbar">
        <div class="topbar-inner">
          ${back !== null ? `<button type="button" class="icon-btn" id="nav-back" aria-label="${Utils.esc(backLabel)}">${ICONS.back}<span class="small">${Utils.esc(backLabel)}</span></button>` : ''}
          <div class="topbar-title ${homeTitle ? 'home' : ''}">${Utils.esc(title)}</div>
          ${right}
        </div>
      </header>
      <main class="page">${body}</main>
      ${actions ? `<div class="actionbar"><div class="actionbar-inner">${actions}</div></div>` : ''}`;
    const backBtn = document.getElementById('nav-back');
    if (backBtn) backBtn.addEventListener('click', () => go(back));
    document.title = homeTitle ? 'Site Inspections' : `${title} – Site Inspections`;
  }

  function renderError(err) {
    render({
      title: 'Something went wrong',
      back: '/',
      body: `<div class="empty"><p><strong>${Utils.esc(err && err.message ? err.message : String(err))}</strong></p>
        <p>Your saved data has not been changed.</p></div>`
    });
  }

  function notFound(what) {
    render({ title: 'Not found', back: '/', backLabel: 'Home',
      body: `<div class="empty">This ${Utils.esc(what)} no longer exists. It may have been deleted.</div>` });
  }

  // ---------- Service worker & updates ----------
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    // Service workers only run on https:// or http://localhost
    navigator.serviceWorker.register('service-worker.js').then(reg => {
      // A new version has been downloaded and is waiting to take over
      const showUpdate = (worker) => showUpdateBanner(worker);
      if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdate(nw);
        });
      });
    }).catch(err => console.warn('Service worker registration failed:', err));

    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    });
  }

  function showUpdateBanner(worker) {
    if (document.getElementById('update-banner')) return;
    const div = document.createElement('div');
    div.id = 'update-banner';
    div.className = 'banner info';
    div.style.cssText = 'position:fixed;left:12px;right:12px;top:calc(64px + env(safe-area-inset-top,0px));z-index:50;max-width:796px;margin:0 auto;';
    div.innerHTML = `<span>A new version of the app is available.</span>
      <button type="button" class="btn sm primary">Update</button>`;
    div.querySelector('button').addEventListener('click', async () => {
      if (isDirty()) {
        const ok = await Utils.confirm({ title: 'Update now?', message: 'You have unsaved changes on this screen. Updating reloads the app and those changes will be lost.', confirmLabel: 'Update', danger: true });
        if (!ok) return;
      }
      dirtyCheck = null;
      worker.postMessage({ type: 'SKIP_WAITING' });
    });
    document.body.appendChild(div);
  }

  // ---------- Start ----------
  async function start() {
    try {
      await DB.open();
      await Settings.load();
    } catch (err) {
      renderError(err);
      return;
    }
    // Ask the browser to keep our storage (reduces the chance of eviction).
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persisted().then(p => { if (!p) navigator.storage.persist().catch(() => {}); }).catch(() => {});
    }
    window.addEventListener('hashchange', onHashChange);
    window.addEventListener('beforeunload', e => {
      if (isDirty()) { e.preventDefault(); e.returnValue = ''; }
    });
    route();
    registerServiceWorker();
  }

  return { start, go, goNoGuard, render, notFound, setDirtyCheck, ICONS, APP_VERSION };
})();

document.addEventListener('DOMContentLoaded', App.start);
