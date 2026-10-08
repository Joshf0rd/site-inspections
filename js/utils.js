/* =========================================================
   utils.js – shared helpers
   - IDs, dates, HTML escaping
   - Image compression
   - Saving/sharing files
   - UI: modal dialogs, toast messages, loading overlay
   ========================================================= */

const Utils = (() => {

  // ---------- IDs ----------
  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    // Fallback for older browsers
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  // ---------- Dates ----------
  // Calendar dates (e.g. site visit date) are stored as plain 'YYYY-MM-DD' strings.
  // They are NEVER converted through Date objects/UTC, so they can't shift a day
  // because of time zones. Timestamps (created/modified) are stored as ISO strings.

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  function pad(n, len = 2) { return String(n).padStart(len, '0'); }

  /** Today's LOCAL calendar date as 'YYYY-MM-DD'. */
  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /** Current moment as an ISO timestamp (for created/modified fields). */
  function nowStamp() { return new Date().toISOString(); }

  /** Local calendar date ('YYYY-MM-DD') of an ISO timestamp. */
  function stampToDate(stamp) {
    if (!stamp) return '';
    const d = new Date(stamp);
    if (isNaN(d)) return '';
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function parseISODate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return null;
    return { y: +m[1], m: +m[2], d: +m[3] };
  }

  /** '2026-10-07' -> '7 October 2026' */
  function formatDate(iso) {
    const p = parseISODate(iso);
    if (!p) return iso || '';
    return `${p.d} ${MONTHS[p.m - 1]} ${p.y}`;
  }

  /** '2026-10-07' -> '7 Oct 2026' */
  function formatDateShort(iso) {
    const p = parseISODate(iso);
    if (!p) return iso || '';
    return `${p.d} ${MONTHS[p.m - 1].slice(0, 3)} ${p.y}`;
  }

  /** ISO timestamp -> '7 October 2026, 14:32' (local time) */
  function formatStamp(stamp) {
    if (!stamp) return '';
    const d = new Date(stamp);
    if (isNaN(d)) return '';
    return `${formatDate(stampToDate(stamp))}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // ---------- Text ----------
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Make a string safe for use in a file name. */
  function safeFileName(text) {
    return String(text || '')
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 60) || 'Report';
  }

  /** Natural sort compare, so E-2 comes before E-10. */
  function naturalCompare(a, b) {
    return String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' });
  }

  // ---------- Images ----------
  // Phone photos are 3000–5000px and 3–6 MB. We rescale so the LONG edge is at
  // most 1600px and save as JPEG quality 0.75:
  //  - 1600px across a ~180mm wide PDF photo is ~225 dpi: sharp when printed.
  //  - Each photo ends up roughly 200–400 KB instead of several MB.
  //  - Quality 0.75 is visually close to the original; below ~0.6 artefacts appear.
  const PHOTO_MAX_DIM = 1600;
  const PHOTO_QUALITY = 0.75;
  const THUMB_MAX_DIM = 240;   // thumbnails for lists (about 10 KB each)
  const THUMB_QUALITY = 0.7;

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('This image could not be read. Try a JPEG or PNG photo.'));
      img.src = src;
    });
  }

  /** Draw an image onto a canvas at a maximum size and return a data URL. */
  function drawScaled(img, maxDim, mime, quality) {
    const w0 = img.naturalWidth, h0 = img.naturalHeight;
    const scale = Math.min(1, maxDim / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (mime === 'image/jpeg') {   // JPEG has no transparency; use a white background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL(mime, quality);
    canvas.width = canvas.height = 0;   // release memory promptly (important on iPhone)
    return { dataUrl, width: w, height: h };
  }

  /**
   * Compress a photo File from the camera/library.
   * Returns { dataUrl, thumb, width, height }.
   * Modern browsers (incl. iOS Safari 13.4+) apply the photo's EXIF rotation automatically.
   */
  async function compressPhoto(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const full = drawScaled(img, PHOTO_MAX_DIM, 'image/jpeg', PHOTO_QUALITY);
      const thumb = drawScaled(img, THUMB_MAX_DIM, 'image/jpeg', THUMB_QUALITY);
      return { dataUrl: full.dataUrl, thumb: thumb.dataUrl, width: full.width, height: full.height };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** Compress a company logo (keeps PNG transparency). */
  async function compressLogo(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const isPng = file.type === 'image/png';
      return drawScaled(img, 600, isPng ? 'image/png' : 'image/jpeg', 0.9);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // ---------- Files ----------
  /**
   * Show a "file ready" dialog with Share (iPhone share sheet, when supported)
   * and Download buttons. A dialog is used because iPhone only allows the share
   * sheet to open directly after a tap – not after a long PDF/backup generation.
   * Resolves true if the file was shared or downloaded at least once.
   */
  async function offerFile(blob, fileName, { title, message = '' }) {
    const file = new File([blob], fileName, { type: blob.type });
    let canShareFiles = false;
    try { canShareFiles = !!(navigator.share && navigator.canShare && navigator.canShare({ files: [file] })); } catch (e) { /* no */ }

    let delivered = false;
    for (;;) {
      const buttons = [{ label: delivered ? 'Done' : 'Close', value: null }];
      buttons.push({ label: 'Download', value: 'download', className: canShareFiles ? '' : 'primary' });
      if (canShareFiles) buttons.push({ label: 'Share / Save', value: 'share', className: 'primary' });
      const choice = await modal({
        title,
        message: `${message ? message + '\n\n' : ''}${fileName}\n${formatBytes(blob.size)}`,
        buttons
      });
      if (!choice) return delivered;
      if (choice === 'download') {
        downloadBlob(blob, fileName);
        delivered = true;
        toast('Download started');
      } else {
        try {
          await navigator.share({ files: [file], title: fileName });
          delivered = true;
        } catch (err) {
          if (!err || err.name !== 'AbortError') {
            toast('Sharing failed – try Download instead');
          }
        }
      }
    }
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  /** Open a hidden file picker and resolve with the chosen FileList (or null). */
  function pickFiles({ accept = '*/*', multiple = false } = {}) {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.multiple = multiple;
      input.style.display = 'none';
      input.addEventListener('change', () => {
        resolve(input.files && input.files.length ? Array.from(input.files) : null);
        input.remove();
      });
      document.body.appendChild(input);
      input.click();
    });
  }

  // ---------- UI: toast ----------
  let toastTimer = null;
  function toast(message, ms = 2200) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

  // ---------- UI: loading overlay ----------
  function showLoading(message = 'Working…') {
    hideLoading();
    const el = document.createElement('div');
    el.className = 'loading';
    el.id = 'loading-overlay';
    el.innerHTML = `<div class="spinner"></div><div class="loading-msg">${esc(message)}</div>`;
    document.body.appendChild(el);
  }
  function updateLoading(message) {
    const el = document.querySelector('#loading-overlay .loading-msg');
    if (el) el.textContent = message;
  }
  function hideLoading() {
    const el = document.getElementById('loading-overlay');
    if (el) el.remove();
  }

  // ---------- UI: modal ----------
  /**
   * Generic modal. `buttons` = [{ label, value, className }].
   * Resolves with the clicked button's value (or null if dismissed).
   * `onOpen(modalEl)` can wire up extra content; `getValue(modalEl, value)` can
   * transform the result (e.g. read a selected radio).
   */
  function modal({ title, message = '', bodyHtml = '', buttons, onOpen, getValue, dismissible = true }) {
    return new Promise(resolve => {
      const root = document.getElementById('modal-root');
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true">
          <h2>${esc(title)}</h2>
          ${message ? `<p>${esc(message)}</p>` : ''}
          ${bodyHtml}
          <div class="modal-actions">
            ${buttons.map((b, i) => `<button type="button" class="btn ${b.className || ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}
          </div>
        </div>`;
      const modalEl = backdrop.querySelector('.modal');

      function close(value) {
        backdrop.remove();
        resolve(value);
      }
      backdrop.addEventListener('click', e => {
        if (e.target === backdrop && dismissible) close(null);
      });
      backdrop.querySelectorAll('.modal-actions button').forEach(btn => {
        btn.addEventListener('click', () => {
          const b = buttons[+btn.dataset.i];
          if (b.value === null || !getValue) return close(b.value);
          const v = getValue(modalEl, b.value);
          if (v !== undefined) close(v);   // getValue returns undefined to keep the dialog open
        });
      });
      root.appendChild(backdrop);
      if (onOpen) onOpen(modalEl, close);
    });
  }

  /** Yes/No confirmation. Resolves true/false. */
  async function confirm({ title, message, confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false }) {
    const v = await modal({
      title, message,
      buttons: [
        { label: cancelLabel, value: false },
        { label: confirmLabel, value: true, className: danger ? 'danger-solid' : 'primary' }
      ]
    });
    return v === true;
  }

  /**
   * Strong confirmation for destructive actions: user must type a word (e.g. DELETE).
   */
  async function confirmTyped({ title, message, word = 'DELETE', confirmLabel = 'Delete' }) {
    const v = await modal({
      title, message,
      bodyHtml: `<div class="field confirm-input"><label for="confirm-word">Type ${esc(word)} to confirm</label>
        <input type="text" id="confirm-word" autocomplete="off" autocapitalize="characters" spellcheck="false"></div>`,
      buttons: [
        { label: 'Cancel', value: null },
        { label: confirmLabel, value: true, className: 'danger-solid' }
      ],
      getValue: (el) => {
        const input = el.querySelector('#confirm-word');
        if (input.value.trim().toUpperCase() !== word) {
          input.closest('.field').classList.add('invalid');
          input.focus();
          return undefined;
        }
        return true;
      }
    });
    return v === true;
  }

  function alert(title, message) {
    return modal({ title, message, buttons: [{ label: 'OK', value: true, className: 'primary' }] });
  }

  /** Radio choice dialog. options = [{ value, label }]. Resolves chosen value or null. */
  function choose({ title, message, options, initial, confirmLabel = 'OK' }) {
    const name = 'choice-' + Date.now();
    return modal({
      title, message,
      bodyHtml: `<div class="choice">${options.map(o => `
        <label><input type="radio" name="${name}" value="${esc(o.value)}" ${o.value === initial ? 'checked' : ''}> ${esc(o.label)}</label>`).join('')}
      </div>`,
      buttons: [
        { label: 'Cancel', value: null },
        { label: confirmLabel, value: 'ok', className: 'primary' }
      ],
      getValue: el => {
        const checked = el.querySelector(`input[name="${name}"]:checked`);
        return checked ? checked.value : undefined;
      }
    });
  }

  // ---------- Misc ----------
  function formatBytes(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  return {
    uid, todayISO, nowStamp, stampToDate, formatDate, formatDateShort, formatStamp, pad,
    esc, safeFileName, naturalCompare,
    compressPhoto, compressLogo, loadImage,
    offerFile, downloadBlob, pickFiles,
    toast, showLoading, updateLoading, hideLoading,
    modal, confirm, confirmTyped, alert, choose, formatBytes
  };
})();

/* ---------- Shared constants ---------- */
const CATEGORIES = [
  { name: 'Electrical', prefix: 'E' },
  { name: 'Mechanical', prefix: 'M' },
  { name: 'Structural', prefix: 'S' },
  { name: 'Civil', prefix: 'C' },
  { name: 'Architectural', prefix: 'A' },
  { name: 'General', prefix: 'G' }
];
const DISCIPLINES = CATEGORIES.map(c => c.name).concat(['Multi-disciplinary']);
const STATUS = { OPEN: 'Open', CLOSED: 'Closed' };
const MAX_PHOTOS_PER_SNAG = 6;

/** Snag number prefix for a category. Custom categories use their first letter. */
function categoryPrefix(category) {
  const c = CATEGORIES.find(x => x.name.toLowerCase() === String(category || '').toLowerCase());
  if (c) return c.prefix;
  const letter = String(category || '').trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(letter) ? letter : 'G';
}

/**
 * HTML for a <select> with preset options plus "Other…" which reveals a text box.
 * Use with wireSelectOther() after rendering.
 */
function selectWithOther(id, options, value) {
  const isPreset = !value || options.includes(value);
  return `
    <select id="${id}">
      ${options.map(o => `<option value="${Utils.esc(o)}" ${o === value ? 'selected' : ''}>${Utils.esc(o)}</option>`).join('')}
      <option value="__other" ${!isPreset ? 'selected' : ''}>Other…</option>
    </select>
    <input type="text" id="${id}-other" class="mt" placeholder="Type custom value"
      value="${!isPreset ? Utils.esc(value) : ''}" ${isPreset ? 'hidden' : ''}>`;
}
function wireSelectOther(id, onChange) {
  const sel = document.getElementById(id);
  const other = document.getElementById(id + '-other');
  sel.addEventListener('change', () => {
    other.hidden = sel.value !== '__other';
    if (!other.hidden) other.focus();
    if (onChange) onChange();
  });
  other.addEventListener('input', () => { if (onChange) onChange(); });
}
function readSelectOther(id) {
  const sel = document.getElementById(id);
  return sel.value === '__other' ? document.getElementById(id + '-other').value.trim() : sel.value;
}
