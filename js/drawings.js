/* =========================================================
   drawings.js – project drawings (floor plans) and snag pins.

   - Import PDF drawings (each page becomes an image) or images.
   - Mark a snag's location on a drawing (pinch / +/- to zoom,
     drag to move, tap to place the marker).
   - Make a zoomed "snippet" of the drawing around a pin for the
     snag screen and the PDF report.

   PDF pages are converted ONCE, when imported, using pdf.js
   (js/lib/pdf.min.js). It is only loaded when you import a PDF.
   ========================================================= */

const Drawings = (() => {
  // Drawing images: long edge up to 4000 px, but never more than ~14 million
  // pixels (iPhone's canvas limit is 16.7 million). JPEG 0.85 keeps thin lines
  // readable at roughly 1–4 MB per drawing.
  const MAX_DIM = 4000;
  const MAX_PIXELS = 14000000;
  const QUALITY = 0.85;
  const THUMB_DIM = 240;
  const MAX_PDF_PAGES = 30;   // per import, to protect phone memory

  // ---------- pdf.js loading ----------
  let pdfjsPromise = null;
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (!pdfjsPromise) {
      pdfjsPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'js/lib/pdf.min.js';
        s.onload = () => {
          if (!window.pdfjsLib) { pdfjsPromise = null; reject(new Error('The PDF reader failed to start.')); return; }
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/lib/pdf.worker.min.js';
          resolve(window.pdfjsLib);
        };
        s.onerror = () => {
          pdfjsPromise = null;
          reject(new Error('The PDF reader could not be loaded. Open the app once while online, then try again.'));
        };
        document.head.appendChild(s);
      });
    }
    return pdfjsPromise;
  }

  // ---------- Converting to stored images ----------
  /** Turn a finished canvas into { dataUrl, thumb, width, height } and free its memory. */
  function canvasToDrawing(canvas) {
    const width = canvas.width, height = canvas.height;
    const dataUrl = canvas.toDataURL('image/jpeg', QUALITY);
    const scale = THUMB_DIM / Math.max(width, height);
    const t = document.createElement('canvas');
    t.width = Math.max(1, Math.round(width * scale));
    t.height = Math.max(1, Math.round(height * scale));
    const tctx = t.getContext('2d');
    tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(canvas, 0, 0, t.width, t.height);
    const thumb = t.toDataURL('image/jpeg', 0.75);
    canvas.width = canvas.height = t.width = t.height = 0;
    return { dataUrl, thumb, width, height };
  }

  function fitScale(w, h) {
    let scale = MAX_DIM / Math.max(w, h);
    if (w * scale * h * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (w * h));
    return scale;
  }

  async function renderPdfPage(pdf, pageNo) {
    const page = await pdf.getPage(pageNo);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: fitScale(base.width, base.height) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    page.cleanup();
    return canvasToDrawing(canvas);
  }

  async function imageFileToDrawing(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await Utils.loadImage(url);
      const scale = Math.min(1, fitScale(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvasToDrawing(canvas);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** Save one drawing (name/thumbnail + full image) in a single transaction. */
  function saveDrawing(projectId, name, img, sourceName, page) {
    const id = Utils.uid();
    const meta = { id, projectId, name, thumb: img.thumb, width: img.width, height: img.height, sourceName, page, createdAt: Utils.nowStamp() };
    return DB.run(['drawings', 'drawingImages'], 'readwrite', s => {
      s.drawings.put(meta);
      s.drawingImages.put({ id, projectId, dataUrl: img.dataUrl });
    });
  }

  /** Parse "1, 3-5" into sorted unique page numbers within 1..max (null if invalid). */
  function parsePages(text, max) {
    const pages = new Set();
    for (const part of String(text).split(',').map(s => s.trim()).filter(Boolean)) {
      const m = /^(\d+)\s*(?:-\s*(\d+))?$/.exec(part);
      if (!m) return null;
      const a = +m[1], b = m[2] ? +m[2] : a;
      if (a < 1 || b > max || a > b) return null;
      for (let p = a; p <= b; p++) pages.add(p);
    }
    return pages.size ? [...pages].sort((x, y) => x - y) : null;
  }

  /** Ask which pages of a multi-page PDF to import. Resolves with page numbers or null. */
  function choosePages(fileName, numPages) {
    return Utils.modal({
      title: 'Which pages?',
      message: `"${fileName}" has ${numPages} pages. Each page you import becomes a separate drawing.`,
      bodyHtml: `
        <div class="choice">
          ${numPages <= MAX_PDF_PAGES ? `<label><input type="radio" name="pg" value="all" checked> All ${numPages} pages</label>` : ''}
          <label><input type="radio" name="pg" value="some" ${numPages > MAX_PDF_PAGES ? 'checked' : ''}> Only these pages:</label>
        </div>
        <div class="field mt"><input type="text" id="pg-list" placeholder="e.g. 1, 3-5" inputmode="numeric" autocomplete="off"></div>`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'Import', value: 'ok', className: 'primary' }],
      onOpen: el => {
        el.querySelector('#pg-list').addEventListener('focus', () => { el.querySelector('input[value="some"]').checked = true; });
      },
      getValue: el => {
        if (el.querySelector('input[name="pg"]:checked').value === 'all') {
          return Array.from({ length: numPages }, (_, i) => i + 1);
        }
        const input = el.querySelector('#pg-list');
        const pages = parsePages(input.value, numPages);
        if (!pages || pages.length > MAX_PDF_PAGES) {
          input.closest('.field').classList.add('invalid');
          Utils.toast(pages ? `Maximum ${MAX_PDF_PAGES} pages at a time` : `Enter page numbers between 1 and ${numPages}`);
          return undefined;
        }
        return pages;
      }
    });
  }

  /** Pick PDF/image files and add them to a project. Resolves with the number added. */
  async function addDrawings(projectId) {
    const files = await Utils.pickFiles({ accept: 'application/pdf,.pdf,image/*', multiple: true });
    if (!files) return 0;
    let added = 0;
    try {
      for (const file of files) {
        const baseName = file.name.replace(/\.[^.]+$/, '') || 'Drawing';
        const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
        if (isPdf) {
          Utils.showLoading('Opening PDF…');
          const pdfjs = await loadPdfJs();
          const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
          try {
            let pages = [1];
            if (pdf.numPages > 1) {
              Utils.hideLoading();
              pages = await choosePages(file.name, pdf.numPages);
              if (!pages) continue;
            }
            for (let i = 0; i < pages.length; i++) {
              Utils.showLoading(`Converting page ${pages[i]}${pages.length > 1 ? ` (${i + 1} of ${pages.length})` : ''}…`);
              const img = await renderPdfPage(pdf, pages[i]);
              const name = pdf.numPages > 1 ? `${baseName} - p${pages[i]}` : baseName;
              await saveDrawing(projectId, name, img, file.name, pages[i]);
              added++;
            }
          } finally {
            pdf.destroy();
          }
        } else {
          Utils.showLoading('Processing drawing…');
          const img = await imageFileToDrawing(file);
          await saveDrawing(projectId, baseName, img, file.name, 1);
          added++;
        }
      }
    } catch (err) {
      Utils.hideLoading();
      const quota = err && (err.name === 'QuotaExceededError' || /quota/i.test(err.message || ''));
      await Utils.alert('Drawing not added', quota
        ? 'The device storage for this app is full.'
        : `${err && err.name === 'PasswordException' ? 'This PDF is password-protected.' : (err.message || String(err))}${added ? `\n\n${added} drawing(s) were added before the problem.` : ''}`);
    }
    Utils.hideLoading();
    if (added) Utils.toast(`${added} drawing${added === 1 ? '' : 's'} added`);
    return added;
  }

  /** Drawings of a project (names and thumbnails only), sorted by name. */
  async function listForProject(projectId) {
    const list = await DB.getAllByIndex('drawings', 'projectId', projectId);
    return list.sort((a, b) => Utils.naturalCompare(a.name, b.name));
  }

  async function loadImageFor(drawingId) {
    const rec = await DB.get('drawingImages', drawingId);
    if (!rec) throw new Error('This drawing image is missing.');
    return Utils.loadImage(rec.dataUrl);
  }

  /** Tap a drawing in the project screen: view, rename or delete. Resolves true if something changed. */
  async function manage(drawing) {
    const pinned = (await DB.getAllByIndex('snags', 'projectId', drawing.projectId))
      .filter(s => s.pin && s.pin.drawingId === drawing.id).length;
    const rec = await DB.get('drawingImages', drawing.id);
    const action = await Utils.modal({
      title: 'Drawing',
      bodyHtml: `
        ${rec ? `<div class="photo-viewer"><img src="${rec.dataUrl}" alt=""></div>` : ''}
        <div class="field mt"><label for="dw-name">Name</label>
          <input type="text" id="dw-name" value="${Utils.esc(drawing.name)}" autocapitalize="words"></div>
        <p class="small muted" style="margin:0">${pinned} snag${pinned === 1 ? '' : 's'} marked on this drawing.</p>`,
      buttons: [
        { label: 'Delete', value: 'delete', className: 'danger' },
        { label: 'Save', value: 'save', className: 'primary' }
      ],
      getValue: (el, v) => ({ action: v, name: el.querySelector('#dw-name').value.trim() })
    });
    if (!action) return false;
    if (action.action === 'save') {
      if (!action.name || action.name === drawing.name) return false;
      await DB.put('drawings', { ...drawing, name: action.name });
      return true;
    }
    const ok = await Utils.confirm({
      title: 'Delete drawing?',
      message: `"${drawing.name}" will be deleted.` + (pinned ? `\n\n${pinned} snag(s) are marked on it – their markers will be removed (their typed area/location is kept).` : ''),
      confirmLabel: 'Delete', danger: true
    });
    if (!ok) return false;
    // Delete the drawing and clear pins that point at it, in one transaction
    await DB.run(['drawings', 'drawingImages', 'snags'], 'readwrite', s => {
      s.drawings.delete(drawing.id);
      s.drawingImages.delete(drawing.id);
      const req = s.snags.index('projectId').openCursor(IDBKeyRange.only(drawing.projectId));
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return;
        if (cur.value.pin && cur.value.pin.drawingId === drawing.id) cur.update({ ...cur.value, pin: null });
        cur.continue();
      };
    });
    Utils.toast('Drawing deleted');
    return true;
  }

  // ---------- Marker ----------
  /** Red ring with an X – drawn with a white outline so it shows on any drawing. */
  function drawMarker(ctx, x, y, r) {
    ctx.save();
    ctx.lineCap = 'round';
    const shape = (color, width) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      const d = r * 0.5;
      ctx.beginPath();
      ctx.moveTo(x - d, y - d); ctx.lineTo(x + d, y + d);
      ctx.moveTo(x + d, y - d); ctx.lineTo(x - d, y + d);
      ctx.stroke();
    };
    shape('rgba(255,255,255,0.95)', r * 0.45);
    shape('#e11d2a', r * 0.22);
    ctx.restore();
  }

  /**
   * Make a zoomed-in snippet of a drawing around a pin, with the marker.
   * Returns { dataUrl, width, height }.
   */
  function cropAround(img, pin, { outW, aspect = 2, frac = 0.38 } = {}) {
    // The snippet covers ~38% of the drawing's long side: enough to show the
    // surrounding rooms and their names, while staying readable when printed.
    const W = img.naturalWidth, H = img.naturalHeight;
    let cw = Math.min(W, Math.max(W, H) * frac);
    let ch = cw / aspect;
    if (ch > H) { ch = H; cw = Math.min(W, ch * aspect); }
    if (!outW) outW = Math.round(Math.min(cw, 1600));   // no needless downscaling (keeps text sharp)
    const px = pin.x * W, py = pin.y * H;
    const cx = Math.min(Math.max(0, px - cw / 2), W - cw);
    const cy = Math.min(Math.max(0, py - ch / 2), H - ch);
    const outH = Math.round(outW * ch / cw);
    const c = document.createElement('canvas');
    c.width = outW;
    c.height = outH;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, outW, outH);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, cx, cy, cw, ch, 0, 0, outW, outH);
    drawMarker(ctx, (px - cx) / cw * outW, (py - cy) / ch * outH, outW * 0.028);
    const dataUrl = c.toDataURL('image/jpeg', 0.85);
    c.width = c.height = 0;
    return { dataUrl, width: outW, height: outH };
  }

  // ---------- Mark location (full-screen) ----------
  /**
   * Let the user place a marker on one of the project's drawings.
   * Resolves with { drawingId, x, y }, 'remove' (if they removed an existing pin), or null (cancel).
   */
  async function pickLocation({ projectId, pin }) {
    const drawings = await listForProject(projectId);
    if (!drawings.length) {
      await Utils.alert('No drawings yet', 'Add drawings on the project screen first (PDF or image).');
      return null;
    }
    let current = drawings.find(d => pin && d.id === pin.drawingId) || drawings[0];
    let point = pin && pin.drawingId === current.id ? { x: pin.x, y: pin.y } : null;
    let img = null;

    // View transform in CSS pixels: screen = offset + imagePixel * scale
    let scale = 1, ox = 0, oy = 0, fit = 1;

    const el = document.createElement('div');
    el.className = 'markup';
    el.innerHTML = `
      <div class="markup-top">
        <button type="button" class="btn dark" data-act="cancel">Cancel</button>
        <span class="markup-title">Mark location</span>
        <button type="button" class="btn primary" data-act="done">Done</button>
      </div>
      ${drawings.length > 1 ? `
        <div style="padding:0 12px 8px">
          <select id="dw-select" aria-label="Drawing">
            ${drawings.map(d => `<option value="${Utils.esc(d.id)}" ${d.id === current.id ? 'selected' : ''}>${Utils.esc(d.name)}</option>`).join('')}
          </select>
        </div>` : `<div class="markup-hint" style="padding-bottom:6px">${Utils.esc(current.name)}</div>`}
      <div class="markup-stage" style="padding:0;overflow:hidden"><canvas></canvas></div>
      <div class="markup-tools">
        <div class="markup-row">
          <button type="button" class="btn dark sm" data-act="out" aria-label="Zoom out">−</button>
          <button type="button" class="btn dark sm" data-act="in" aria-label="Zoom in">+</button>
          <button type="button" class="btn dark sm" data-act="fit">Fit</button>
          <span style="flex:1"></span>
          ${pin ? '<button type="button" class="btn dark sm" data-act="remove" style="color:#ff8a80">Remove marker</button>' : ''}
        </div>
        <div class="markup-hint">Tap to place the marker. Pinch or use + / − to zoom, drag to move.</div>
      </div>`;
    document.body.appendChild(el);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const stage = el.querySelector('.markup-stage');
    const canvas = el.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    let cssW = 0, cssH = 0;

    function layout() {
      const dpr = window.devicePixelRatio || 1;
      cssW = stage.clientWidth;
      cssH = stage.clientHeight;
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      requestDraw();
    }

    function fitView() {
      if (!img) return;
      fit = Math.min(cssW / img.naturalWidth, cssH / img.naturalHeight) * 0.96;
      scale = fit;
      ox = (cssW - img.naturalWidth * scale) / 2;
      oy = (cssH - img.naturalHeight * scale) / 2;
      requestDraw();
    }

    /** Zoom by `factor`, keeping the screen point (sx, sy) fixed. */
    function zoomAt(factor, sx, sy) {
      const newScale = Math.min(Math.max(scale * factor, fit * 0.8), Math.max(fit * 16, 3));
      const ix = (sx - ox) / scale, iy = (sy - oy) / scale;
      scale = newScale;
      ox = sx - ix * scale;
      oy = sy - iy * scale;
      requestDraw();
    }

    let drawQueued = false;
    function requestDraw() {
      if (drawQueued) return;
      drawQueued = true;
      requestAnimationFrame(() => { drawQueued = false; draw(); });
    }
    function draw() {
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#3a3a3c';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (!img) return;
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0);
      if (point) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawMarker(ctx, ox + point.x * img.naturalWidth * scale, oy + point.y * img.naturalHeight * scale, 15);
      }
    }

    async function showDrawing(d) {
      current = d;
      img = null;
      requestDraw();
      Utils.showLoading('Loading drawing…');
      try {
        img = await loadImageFor(d.id);
      } catch (err) {
        Utils.hideLoading();
        Utils.alert('Drawing not available', err.message || String(err));
        return;
      }
      Utils.hideLoading();
      if (point) {
        // Start zoomed in on the existing marker
        fitView();
        const sx = ox + point.x * img.naturalWidth * scale, sy = oy + point.y * img.naturalHeight * scale;
        zoomAt(4, sx, sy);
        ox += cssW / 2 - (ox + point.x * img.naturalWidth * scale);
        oy += cssH / 2 - (oy + point.y * img.naturalHeight * scale);
      } else {
        fitView();
      }
    }

    // ----- Touch / mouse: drag = move, pinch = zoom, tap = place marker -----
    const pointers = new Map();
    let gesture = null;
    const local = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

    canvas.addEventListener('pointerdown', e => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, local(e));
      if (pointers.size === 1) {
        const p = local(e);
        gesture = { type: 'pan', sx: p.x, sy: p.y, ox, oy, moved: false };
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        gesture = { type: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, ox, oy };
      }
    });
    canvas.addEventListener('pointermove', e => {
      if (!pointers.has(e.pointerId) || !gesture) return;
      e.preventDefault();
      pointers.set(e.pointerId, local(e));
      if (gesture.type === 'pinch' && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const target = Math.min(Math.max(gesture.scale * dist / gesture.dist, fit * 0.8), Math.max(fit * 16, 3));
        // Keep the image point that was under the starting midpoint under the current midpoint
        const ix = (gesture.mid.x - gesture.ox) / gesture.scale, iy = (gesture.mid.y - gesture.oy) / gesture.scale;
        scale = target;
        ox = mid.x - ix * scale;
        oy = mid.y - iy * scale;
        requestDraw();
      } else if (gesture.type === 'pan') {
        const p = pointers.get(e.pointerId);
        const dx = p.x - gesture.sx, dy = p.y - gesture.sy;
        if (Math.hypot(dx, dy) > 8) gesture.moved = true;
        if (gesture.moved) {
          ox = gesture.ox + dx;
          oy = gesture.oy + dy;
          requestDraw();
        }
      }
    });
    const end = e => {
      if (!pointers.has(e.pointerId)) return;
      const p = local(e);
      // A tap (one finger, no movement) places the marker
      if (gesture && gesture.type === 'pan' && !gesture.moved && pointers.size === 1 && img) {
        const x = (p.x - ox) / scale / img.naturalWidth, y = (p.y - oy) / scale / img.naturalHeight;
        if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
          point = { x, y };
          requestDraw();
        }
      }
      pointers.delete(e.pointerId);
      if (pointers.size === 1) {
        // Continue as a drag with the remaining finger (never a tap)
        const q = [...pointers.values()][0];
        gesture = { type: 'pan', sx: q.x, sy: q.y, ox, oy, moved: true };
      } else if (pointers.size === 0) {
        gesture = null;
      }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const p = local(e);
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, p.x, p.y);
    }, { passive: false });

    window.addEventListener('resize', layout);
    layout();
    await showDrawing(current);

    return new Promise(resolve => {
      function close(result) {
        window.removeEventListener('resize', layout);
        document.body.style.overflow = prevOverflow;
        el.remove();
        resolve(result);
      }
      const select = el.querySelector('#dw-select');
      if (select) select.addEventListener('change', () => {
        const d = drawings.find(x => x.id === select.value);
        point = pin && pin.drawingId === d.id ? { x: pin.x, y: pin.y } : null;
        showDrawing(d);
      });
      el.addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        switch (b.dataset.act) {
          case 'in': zoomAt(1.6, cssW / 2, cssH / 2); break;
          case 'out': zoomAt(1 / 1.6, cssW / 2, cssH / 2); break;
          case 'fit': fitView(); break;
          case 'cancel': close(null); break;
          case 'remove': close('remove'); break;
          case 'done':
            if (!point) { Utils.toast('Tap the drawing to place the marker'); return; }
            close({ drawingId: current.id, x: point.x, y: point.y });
            break;
        }
      });
    });
  }

  return { addDrawings, listForProject, manage, pickLocation, loadImageFor, cropAround };
})();
