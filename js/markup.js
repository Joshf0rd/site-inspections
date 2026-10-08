/* =========================================================
   markup.js – draw arrows and circles on a snag photo.

   Shapes are stored as simple data, with positions as fractions
   of the photo's width/height (0–1), e.g.
     { type: 'arrow',  color: '#e11d2a', x1, y1, x2, y2 }
     { type: 'circle', color: '#facc15', x1, y1, x2, y2 }  (circle fits the dragged box)

   The ORIGINAL photo is always kept, so markings can be edited
   later without the photo losing quality each time. On "Done" a
   new JPEG is made with the markings drawn in – that is the image
   used in lists and in the PDF report.
   ========================================================= */

const Markup = (() => {
  const COLORS = [
    { name: 'Red', value: '#e11d2a' },
    { name: 'Yellow', value: '#facc15' },
    { name: 'White', value: '#ffffff' }
  ];
  const OUTPUT_QUALITY = 0.8;   // JPEG quality of the marked-up photo
  const THUMB_MAX_DIM = 240;

  // Remembered between uses while the app is open
  let lastTool = 'arrow';
  let lastColor = COLORS[0].value;

  /** Line thickness in image pixels (scales with photo size). */
  function lineWidthFor(w, h) {
    return Math.max(4, Math.round(Math.max(w, h) * 0.008));
  }

  /** Draw one shape on a canvas that is W×H pixels. */
  function drawShape(ctx, s, W, H, lw) {
    const x1 = s.x1 * W, y1 = s.y1 * H, x2 = s.x2 * W, y2 = s.y2 * H;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const pass = (color, width) => {
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = width;
      if (s.type === 'circle') {
        ctx.beginPath();
        ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2,
          Math.max(1, Math.abs(x2 - x1) / 2), Math.max(1, Math.abs(y2 - y1) / 2), 0, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // Arrow: line from start to end, filled head at the end (where you lifted your finger)
        const ang = Math.atan2(y2 - y1, x2 - x1);
        const head = lw * 4.5;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2 - Math.cos(ang) * head * 0.8, y2 - Math.sin(ang) * head * 0.8);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - head * Math.cos(ang - 0.45), y2 - head * Math.sin(ang - 0.45));
        ctx.lineTo(x2 - head * Math.cos(ang + 0.45), y2 - head * Math.sin(ang + 0.45));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    };
    // A soft dark outline first, so markings stay visible on light AND dark backgrounds
    pass('rgba(0,0,0,0.45)', lw + Math.max(2, lw * 0.6));
    pass(s.color, lw);
  }

  /** Render photo + shapes at full photo resolution. Returns { dataUrl, thumb, width, height }. */
  function renderFinal(img, shapes, baseDataUrl) {
    const W = img.naturalWidth, H = img.naturalHeight;
    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const ctx = out.getContext('2d');
    ctx.drawImage(img, 0, 0, W, H);
    const lw = lineWidthFor(W, H);
    shapes.forEach(s => drawShape(ctx, s, W, H, lw));
    // No markings -> keep the original JPEG untouched (no extra compression)
    const dataUrl = shapes.length ? out.toDataURL('image/jpeg', OUTPUT_QUALITY) : baseDataUrl;

    const scale = Math.min(1, THUMB_MAX_DIM / Math.max(W, H));
    const t = document.createElement('canvas');
    t.width = Math.max(1, Math.round(W * scale));
    t.height = Math.max(1, Math.round(H * scale));
    t.getContext('2d').drawImage(out, 0, 0, t.width, t.height);
    const thumb = t.toDataURL('image/jpeg', 0.7);

    out.width = out.height = t.width = t.height = 0;   // free memory (important on iPhone)
    return { dataUrl, thumb, width: W, height: H };
  }

  /**
   * Open the full-screen editor.
   * Resolves with { dataUrl, thumb, width, height, shapes } on Done, or null on Cancel.
   */
  async function open({ baseDataUrl, shapes: initialShapes = [] }) {
    const img = await Utils.loadImage(baseDataUrl);
    let shapes = initialShapes.map(s => ({ ...s }));
    const history = [];           // previous versions of `shapes`, for Undo
    let drawing = null;           // shape currently being dragged
    let tool = lastTool;
    let color = lastColor;

    const el = document.createElement('div');
    el.className = 'markup';
    el.innerHTML = `
      <div class="markup-top">
        <button type="button" class="btn dark" data-act="cancel">Cancel</button>
        <span class="markup-title">Mark up photo</span>
        <button type="button" class="btn primary" data-act="done">Done</button>
      </div>
      <div class="markup-stage"><canvas></canvas></div>
      <div class="markup-tools">
        <div class="segmented" data-role="tool">
          <button type="button" data-tool="arrow">➜ Arrow</button>
          <button type="button" data-tool="circle">◯ Circle</button>
        </div>
        <div class="markup-row">
          ${COLORS.map(c => `<button type="button" class="swatch" data-color="${c.value}" style="background:${c.value}" aria-label="${c.name}"></button>`).join('')}
          <span style="flex:1"></span>
          <button type="button" class="btn dark sm" data-act="undo">Undo</button>
          <button type="button" class="btn dark sm" data-act="clear">Clear</button>
        </div>
        <div class="markup-hint">Drag on the photo to draw. Arrows point to where you lift your finger.</div>
      </div>`;
    document.body.appendChild(el);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const stage = el.querySelector('.markup-stage');
    const canvas = el.querySelector('canvas');
    const ctx = canvas.getContext('2d');

    // ----- Sizing: fit the photo inside the stage, sharp on Retina screens -----
    function layout() {
      const pad = 16;
      const maxW = Math.max(50, stage.clientWidth - pad);
      const maxH = Math.max(50, stage.clientHeight - pad);
      const ratio = img.naturalWidth / img.naturalHeight;
      let w = maxW, h = w / ratio;
      if (h > maxH) { h = maxH; w = h * ratio; }
      const dpr = window.devicePixelRatio || 1;
      canvas.style.width = Math.round(w) + 'px';
      canvas.style.height = Math.round(h) + 'px';
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      redraw();
    }

    function redraw() {
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(img, 0, 0, W, H);
      const lw = lineWidthFor(img.naturalWidth, img.naturalHeight) * (W / img.naturalWidth);
      shapes.forEach(s => drawShape(ctx, s, W, H, lw));
      if (drawing) drawShape(ctx, drawing, W, H, lw);
      el.querySelector('[data-act="undo"]').disabled = history.length === 0;
      el.querySelector('[data-act="clear"]').disabled = shapes.length === 0;
    }

    function drawToolbar() {
      el.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
      el.querySelectorAll('[data-color]').forEach(b => b.classList.toggle('active', b.dataset.color === color));
    }

    // ----- Drawing with finger / mouse -----
    function toFraction(e) {
      const r = canvas.getBoundingClientRect();
      return {
        x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
        y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
      };
    }
    canvas.addEventListener('pointerdown', e => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      const p = toFraction(e);
      drawing = { type: tool, color, x1: p.x, y1: p.y, x2: p.x, y2: p.y };
      redraw();
    });
    canvas.addEventListener('pointermove', e => {
      if (!drawing) return;
      e.preventDefault();
      const p = toFraction(e);
      drawing.x2 = p.x;
      drawing.y2 = p.y;
      redraw();
    });
    const finish = () => {
      if (!drawing) return;
      const r = canvas.getBoundingClientRect();
      const dx = (drawing.x2 - drawing.x1) * r.width, dy = (drawing.y2 - drawing.y1) * r.height;
      if (Math.hypot(dx, dy) > 10) {        // ignore accidental taps
        history.push(shapes.map(s => ({ ...s })));
        shapes.push(drawing);
      }
      drawing = null;
      redraw();
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);

    window.addEventListener('resize', layout);

    // ----- Buttons -----
    return new Promise(resolve => {
      function close(result) {
        window.removeEventListener('resize', layout);
        document.body.style.overflow = prevOverflow;
        el.remove();
        resolve(result);
      }

      el.addEventListener('click', async e => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.tool) { tool = lastTool = b.dataset.tool; drawToolbar(); return; }
        if (b.dataset.color) { color = lastColor = b.dataset.color; drawToolbar(); return; }
        switch (b.dataset.act) {
          case 'undo':
            if (history.length) shapes = history.pop();
            redraw();
            break;
          case 'clear':
            history.push(shapes.map(s => ({ ...s })));
            shapes = [];
            redraw();
            break;
          case 'cancel':
            if (history.length) {
              const ok = await Utils.confirm({ title: 'Discard markings?', message: 'Your changes to this photo will be lost.', confirmLabel: 'Discard', danger: true });
              if (!ok) return;
            }
            close(null);
            break;
          case 'done': {
            const res = renderFinal(img, shapes, baseDataUrl);
            close({ ...res, shapes });
            break;
          }
        }
      });

      drawToolbar();
      layout();
    });
  }

  return { open };
})();
