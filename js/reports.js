/* =========================================================
   reports.js – PDF snag report (A4 portrait) using jsPDF.

   Layout:
     Page 1  : report title, project/visit details, summary,
               snag register (short list of all snags in the report)
     Page 2+ : one block per snag – header, photos, observation,
               required action, contractor / status / category
   Every page: header (logo/company) and footer (page X of Y).

   All measurements are in millimetres.
   ========================================================= */

const Reports = (() => {
  // ---------- Page geometry ----------
  const PAGE_W = 210, PAGE_H = 297;
  const M_LEFT = 15, M_RIGHT = 15;
  const CONTENT_W = PAGE_W - M_LEFT - M_RIGHT;        // 180 mm
  const CONTENT_TOP = 32;                              // below the page header
  const CONTENT_BOTTOM = PAGE_H - 18;                  // above the footer

  // ---------- Colours (RGB) ----------
  const C = {
    text: [26, 33, 41],
    muted: [95, 107, 119],
    accent: [31, 78, 121],
    line: [210, 216, 222],
    fill: [243, 245, 247],
    open: [181, 71, 8],
    closed: [21, 127, 61],
    white: [255, 255, 255]
  };

  /** Line height in mm for a font size in pt. */
  const lh = pt => pt * 0.3528 * 1.3;

  /**
   * The built-in PDF fonts only support Western European characters.
   * Replace "smart" punctuation from the iPhone keyboard and drop anything unsupported.
   */
  function clean(text) {
    return String(text == null ? '' : text)
      .replace(/[‘’‚′]/g, "'")
      .replace(/[“”„″]/g, '"')
      .replace(/[–—−]/g, '-')
      .replace(/…/g, '...')
      .replace(/•/g, '-')
      .replace(/[   ]/g, ' ')
      .replace(/\r\n?/g, '\n')
      .replace(/[^\n\x20-\x7E¡-ÿ]/g, '?');
  }

  // =========================================================
  // Entry point: called from the site visit screen
  // =========================================================
  async function start(visitId) {
    const visit = await DB.get('visits', visitId);
    const project = visit && await DB.get('projects', visit.projectId);
    if (!visit || !project) { Utils.alert('Report', 'Site visit not found.'); return; }
    const allSnags = await DB.getAllByIndex('snags', 'visitId', visitId);
    const nOpen = allSnags.filter(s => s.status === STATUS.OPEN).length;
    const nClosed = allSnags.length - nOpen;

    const scope = await Utils.choose({
      title: 'Generate report',
      message: 'Which snags should be included?',
      options: [
        { value: 'all', label: `All snags (${allSnags.length})` },
        { value: 'open', label: `Open snags only (${nOpen})` },
        { value: 'closed', label: `Closed snags only (${nClosed})` }
      ],
      initial: 'all',
      confirmLabel: 'Generate PDF'
    });
    if (!scope) return;

    const snags = allSnags.filter(s =>
      scope === 'all' || (scope === 'open' ? s.status === STATUS.OPEN : s.status === STATUS.CLOSED));
    if (!snags.length) {
      Utils.alert('Nothing to report', `There are no ${scope} snags in this site visit.`);
      return;
    }
    Snags.sortSnags(snags, 'number');

    let blob, fileName;
    try {
      Utils.showLoading('Generating PDF…');
      blob = await buildPdf({ project, visit, snags, scope, totals: { all: allSnags.length, open: nOpen, closed: nClosed } });
      fileName = makeFileName(project, visit, scope);
    } catch (err) {
      console.error(err);
      Utils.hideLoading();
      Utils.alert('Report failed', err.message || String(err));
      return;
    }
    Utils.hideLoading();

    await Utils.offerFile(blob, fileName, {
      title: 'Report ready',
      message: `${snags.length} snag(s) included.`
    });
  }

  /** e.g. WCE-2026-014_Electrical_Snag_Report_2026-10-07.pdf */
  function makeFileName(project, visit, scope) {
    const ref = Utils.safeFileName(project.number || project.name);
    const disc = Utils.safeFileName(visit.discipline || 'Site');
    const scopePart = scope === 'open' ? '_Open' : scope === 'closed' ? '_Closed' : '';
    return `${ref}_${disc}_Snag_Report${scopePart}_${visit.date}.pdf`;
  }

  // =========================================================
  // PDF construction
  // =========================================================
  async function buildPdf({ project, visit, snags, scope, totals }) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      throw new Error('PDF library failed to load. Reload the app while online once, then try again.');
    }
    const settings = Settings.get();
    const doc = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    doc.setProperties({
      title: `Snag Report - ${clean(project.name)}`,
      subject: clean(visit.title),
      author: clean(settings.name),
      creator: 'Site Inspections PWA'
    });

    // ----- Logo (optional) -----
    let logo = null;
    if (settings.logoDataUrl) {
      try {
        const img = await Utils.loadImage(settings.logoDataUrl);
        logo = {
          dataUrl: settings.logoDataUrl,
          format: settings.logoDataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG',
          ratio: img.naturalWidth / img.naturalHeight
        };
      } catch (e) { logo = null; }
    }

    const generated = Utils.todayISO();
    let y = CONTENT_TOP;

    // ----- Helpers -----
    function setFont(size, style = 'normal', color = C.text) {
      doc.setFont('helvetica', style);
      doc.setFontSize(size);
      doc.setTextColor(...color);
    }

    function drawHeader() {
      const top = 10;
      let textX = M_LEFT;
      if (logo) {
        let h = 13, w = h * logo.ratio;
        if (w > 50) { w = 50; h = w / logo.ratio; }
        doc.addImage(logo.dataUrl, logo.format, M_LEFT, top + (13 - h) / 2, w, h, 'company-logo', 'NONE');
        textX = M_LEFT + w + 5;
      }
      // Left: company name
      if (settings.company) {
        setFont(10, 'bold', C.text);
        doc.text(clean(settings.company), textX, top + 6, { maxWidth: PAGE_W - M_RIGHT - textX - 70 });
      }
      // Right: report type and project reference
      setFont(8, 'bold', C.accent);
      doc.text('SITE INSPECTION / SNAG REPORT', PAGE_W - M_RIGHT, top + 4, { align: 'right' });
      setFont(8, 'normal', C.muted);
      doc.text(clean([project.number, Utils.formatDate(visit.date)].filter(Boolean).join('  |  ')), PAGE_W - M_RIGHT, top + 8.5, { align: 'right' });
      doc.setDrawColor(...C.line);
      doc.setLineWidth(0.3);
      doc.line(M_LEFT, 26, PAGE_W - M_RIGHT, 26);
    }

    function newPage() {
      doc.addPage();
      drawHeader();
      y = CONTENT_TOP;
    }

    const spaceLeft = () => CONTENT_BOTTOM - y;
    const ensureSpace = h => { if (h > spaceLeft()) newPage(); };

    // =====================================================
    // PAGE 1: cover / details
    // =====================================================
    drawHeader();

    setFont(18, 'bold', C.accent);
    doc.text('SITE INSPECTION / SNAG REPORT', M_LEFT, y + 6);
    y += 10;
    setFont(12, 'normal', C.muted);
    const subtitleLines = doc.splitTextToSize(clean(visit.title), CONTENT_W);
    doc.text(subtitleLines, M_LEFT, y + 4);
    y += subtitleLines.length * lh(12) + 6;

    // ----- Details table -----
    const scopeText = { all: 'All snags', open: 'Open snags only', closed: 'Closed snags only' }[scope];
    const inspectorText = [visit.inspector, settings.jobTitle && visit.inspector === settings.name ? settings.jobTitle : '']
      .filter(Boolean).join(', ');
    const details = [
      ['Project', project.name],
      ['Project Number', project.number],
      ['Client', project.client],
      ['Site', project.site],
      ['Main Contractor', project.mainContractor],
      ['Inspection Date', Utils.formatDate(visit.date)],
      ['Inspector', inspectorText],
      ['Company', settings.company],
      ['Discipline', visit.discipline],
      ['Report Scope', scopeText],
      ['Report Generated', Utils.formatDate(generated)]
    ].filter(r => r[1]);

    const labelW = 42, valueW = CONTENT_W - labelW - 4;
    doc.setDrawColor(...C.line);
    doc.setLineWidth(0.2);
    doc.line(M_LEFT, y, M_LEFT + CONTENT_W, y);
    details.forEach(([label, value]) => {
      setFont(9.5, 'normal');
      const lines = doc.splitTextToSize(clean(value), valueW);
      const rowH = Math.max(1, lines.length) * lh(9.5) + 3.2;
      ensureSpace(rowH);
      setFont(9, 'bold', C.muted);
      doc.text(label.toUpperCase(), M_LEFT + 1, y + 4.6);
      setFont(9.5, 'normal', C.text);
      doc.text(lines, M_LEFT + labelW, y + 4.6);
      y += rowH;
      doc.line(M_LEFT, y, M_LEFT + CONTENT_W, y);
    });
    y += 6;

    // ----- Visit notes -----
    if (visit.notes) {
      setFont(9.5, 'normal');
      const lines = doc.splitTextToSize(clean(visit.notes), CONTENT_W);
      ensureSpace(6 + Math.min(lines.length, 3) * lh(9.5));
      setFont(8, 'bold', C.muted);
      doc.text('NOTES', M_LEFT, y + 3);
      y += 5;
      setFont(9.5, 'normal', C.text);
      lines.forEach(line => {
        ensureSpace(lh(9.5));
        doc.text(line, M_LEFT, y + 3.4);
        y += lh(9.5);
      });
      y += 5;
    }

    // ----- Summary boxes -----
    ensureSpace(30);
    setFont(8, 'bold', C.muted);
    doc.text('SUMMARY (ALL SNAGS RECORDED ON THIS VISIT)', M_LEFT, y + 3);
    y += 6;
    const boxW = (CONTENT_W - 8) / 3, boxH = 18;
    [['Total Snags', totals.all, C.text], ['Open', totals.open, C.open], ['Closed', totals.closed, C.closed]]
      .forEach(([label, value, color], i) => {
        const x = M_LEFT + i * (boxW + 4);
        doc.setFillColor(...C.fill);
        doc.setDrawColor(...C.line);
        doc.roundedRect(x, y, boxW, boxH, 1.5, 1.5, 'FD');
        setFont(16, 'bold', color);
        doc.text(String(value), x + boxW / 2, y + 9, { align: 'center' });
        setFont(7.5, 'bold', C.muted);
        doc.text(label.toUpperCase(), x + boxW / 2, y + 14.5, { align: 'center' });
      });
    y += boxH + 4;
    if (scope !== 'all') {
      setFont(9, 'normal', C.muted);
      doc.text(`This report includes ${scopeText.toLowerCase()} (${snags.length}).`, M_LEFT, y + 3);
      y += 6;
    }
    y += 4;

    // ----- Snag register -----
    const col = { no: M_LEFT + 2, area: M_LEFT + 24, cat: M_LEFT + 122, status: M_LEFT + CONTENT_W - 2 };
    const areaW = col.cat - col.area - 4;
    const drawRegisterHeader = () => {
      doc.setFillColor(...C.accent);
      doc.rect(M_LEFT, y, CONTENT_W, 7, 'F');
      setFont(8, 'bold', C.white);
      doc.text('NO.', col.no, y + 4.7);
      doc.text('AREA / LOCATION', col.area, y + 4.7);
      doc.text('CATEGORY', col.cat, y + 4.7);
      doc.text('STATUS', col.status, y + 4.7, { align: 'right' });
      y += 7;
    };
    ensureSpace(24);
    setFont(11, 'bold', C.accent);
    doc.text('SNAG REGISTER', M_LEFT, y + 4);
    y += 7;
    drawRegisterHeader();
    snags.forEach((s, i) => {
      setFont(9, 'normal');
      const areaLines = doc.splitTextToSize(clean(s.area || '-'), areaW);
      const rowH = areaLines.length * lh(9) + 3;
      if (rowH > spaceLeft()) { newPage(); drawRegisterHeader(); }
      if (i % 2 === 1) { doc.setFillColor(...C.fill); doc.rect(M_LEFT, y, CONTENT_W, rowH, 'F'); }
      setFont(9, 'bold', C.text);
      doc.text(clean(s.number), col.no, y + 4.3);
      setFont(9, 'normal', C.text);
      doc.text(areaLines, col.area, y + 4.3);
      doc.text(clean(s.category), col.cat, y + 4.3);
      const closed = s.status === STATUS.CLOSED;
      setFont(8.5, 'bold', closed ? C.closed : C.open);
      doc.text(closed ? 'CLOSED' : 'OPEN', col.status, y + 4.3, { align: 'right' });
      y += rowH;
    });
    doc.setDrawColor(...C.line);
    doc.line(M_LEFT, y, M_LEFT + CONTENT_W, y);

    // =====================================================
    // PAGE 2+: snag details
    // =====================================================
    newPage();
    setFont(11, 'bold', C.accent);
    doc.text('SNAG DETAILS', M_LEFT, y + 4);
    y += 9;

    for (let i = 0; i < snags.length; i++) {
      Utils.updateLoading(`Adding snag ${i + 1} of ${snags.length}…`);
      const snag = snags[i];
      // Load full-size photos for this snag only (keeps memory use low)
      const photos = [];
      for (const meta of (snag.photos || [])) {
        const rec = await DB.get('photos', meta.id);
        if (rec && rec.dataUrl) photos.push({ ...meta, dataUrl: rec.dataUrl, width: rec.width || meta.width, height: rec.height || meta.height });
      }
      const items = buildSnagItems(doc, snag, photos, setFont);
      placeItems(items);
      // Let the screen update between snags
      await new Promise(r => setTimeout(r, 0));
    }

    /**
     * Place a snag's items. Keep the whole snag on one page where possible;
     * if it is taller than a page, flow it item by item (never splitting a line
     * or a photo row) and keep the header with the first item after it.
     */
    function placeItems(items) {
      const total = items.reduce((sum, it) => sum + it.h, 0);
      const fullPage = CONTENT_BOTTOM - CONTENT_TOP;
      if (total > spaceLeft()) {
        if (total <= fullPage || y > CONTENT_TOP + 1) newPage();
      }
      items.forEach((it, idx) => {
        const needed = it.keepWithNext && items[idx + 1] ? it.h + items[idx + 1].h : it.h;
        if (needed > spaceLeft() && y > CONTENT_TOP + 1) newPage();
        it.draw(y);
        y += it.h;
      });
    }

    // ----- Footer on every page -----
    const pageCount = doc.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      doc.setDrawColor(...C.line);
      doc.setLineWidth(0.3);
      doc.line(M_LEFT, PAGE_H - 13, PAGE_W - M_RIGHT, PAGE_H - 13);
      setFont(7.5, 'normal', C.muted);
      const left = clean([project.number || project.name, visit.title, `Generated ${Utils.formatDate(generated)}`].filter(Boolean).join('  |  '));
      doc.text(left, M_LEFT, PAGE_H - 8.5, { maxWidth: CONTENT_W - 30 });
      doc.text(`Page ${p} of ${pageCount}`, PAGE_W - M_RIGHT, PAGE_H - 8.5, { align: 'right' });
    }

    return doc.output('blob');
  }

  // =========================================================
  // One snag -> list of drawable items { h, draw(y), keepWithNext }
  // =========================================================
  function buildSnagItems(doc, snag, photos, setFont) {
    const items = [];
    const closed = snag.status === STATUS.CLOSED;
    const statusColor = closed ? C.closed : C.open;

    // ----- Header bar: number | category ........ STATUS -----
    const barH = 10;
    setFont(9.5, 'bold');
    const areaLines = doc.splitTextToSize(clean((snag.area || 'Area not recorded').toUpperCase()), CONTENT_W - 4);
    // Carry-forward history note (e.g. "Brought forward from site visit of 7 October 2026")
    const historyNotes = [];
    if (snag.carriedFrom) {
      historyNotes.push(`Brought forward from site visit of ${Utils.formatDate(snag.carriedFrom.visitDate)}` +
        (snag.previousNumber ? ` (previously ${snag.previousNumber})` : ''));
    }
    if (snag.carriedForwardTo) {
      historyNotes.push(`Carried forward to site visit of ${Utils.formatDate(snag.carriedForwardDate)}`);
    }
    setFont(8.5, 'italic');
    const noteLines = historyNotes.length ? doc.splitTextToSize(clean(historyNotes.join('. ')), CONTENT_W - 4) : [];
    const headerH = barH + 2 + areaLines.length * lh(9.5) + noteLines.length * lh(8.5) + 3;
    items.push({
      h: headerH,
      keepWithNext: true,
      draw(y) {
        doc.setFillColor(...C.fill);
        doc.setDrawColor(...C.line);
        doc.setLineWidth(0.3);
        doc.rect(M_LEFT, y, CONTENT_W, barH, 'FD');
        doc.setFillColor(...statusColor);
        doc.rect(M_LEFT, y, 1.6, barH, 'F');              // coloured status strip
        setFont(13, 'bold', C.accent);
        doc.text(clean(snag.number), M_LEFT + 4.5, y + 6.8);
        const numW = doc.getTextWidth(clean(snag.number));
        setFont(9, 'normal', C.muted);
        doc.text(clean(snag.category || ''), M_LEFT + 4.5 + numW + 4, y + 6.6);
        // status pill
        const label = closed ? 'CLOSED' : 'OPEN';
        setFont(8, 'bold', C.white);
        const pillW = doc.getTextWidth(label) + 6;
        doc.setFillColor(...statusColor);
        doc.roundedRect(M_LEFT + CONTENT_W - pillW - 3, y + 2.4, pillW, 5.2, 2.6, 2.6, 'F');
        doc.text(label, M_LEFT + CONTENT_W - 3 - pillW / 2, y + 6, { align: 'center' });
        // area
        setFont(9.5, 'bold', C.text);
        doc.text(areaLines, M_LEFT + 1, y + barH + 2 + lh(9.5) * 0.8);
        if (noteLines.length) {
          setFont(8.5, 'italic', C.accent);
          doc.text(noteLines, M_LEFT + 1, y + barH + 2 + areaLines.length * lh(9.5) + lh(8.5) * 0.8);
        }
      }
    });

    // ----- Photos -----
    if (photos.length) {
      const n = photos.length;
      const perRow = n === 1 ? 1 : (n === 2 || n === 4) ? 2 : 3;
      const gap = 6;
      const cellW = (CONTENT_W - gap * (perRow - 1)) / perRow;
      const maxH = perRow === 1 ? 95 : perRow === 2 ? 68 : 52;
      const captionH = 5;
      let closeoutNo = 0, photoNo = 0;
      const labelled = photos.map(p => ({
        ...p,
        caption: p.kind === 'closeout' ? `Close-out photo ${++closeoutNo}` : `Photo ${++photoNo}`
      }));
      for (let r = 0; r < n; r += perRow) {
        const row = labelled.slice(r, r + perRow).map(p => {
          const ratio = (p.width && p.height) ? p.width / p.height : 4 / 3;
          let w = cellW, h = w / ratio;
          if (h > maxH) { h = maxH; w = h * ratio; }
          return { ...p, w, h };
        });
        const tallest = Math.max(...row.map(p => p.h));
        const rowH = tallest + captionH + 3;
        items.push({
          h: rowH,
          draw(y) {
            row.forEach((p, i) => {
              // Photos in a row share a bottom edge so captions line up
              const py = y + (tallest - p.h);
              const cellX = M_LEFT + i * (cellW + gap);
              const x = perRow === 1 ? M_LEFT + (CONTENT_W - p.w) / 2 : cellX + (cellW - p.w) / 2;
              doc.addImage(p.dataUrl, 'JPEG', x, py, p.w, p.h, 'photo-' + p.id, 'NONE');
              doc.setDrawColor(...C.line);
              doc.setLineWidth(0.2);
              doc.rect(x, py, p.w, p.h);
              setFont(7.5, 'normal', p.kind === 'closeout' ? C.closed : C.muted);
              doc.text(p.caption, x, y + tallest + 3.6);
            });
          }
        });
      }
    }

    // ----- Text sections (label kept with first line) -----
    function textSection(label, text, size = 10) {
      setFont(size, 'normal');
      const lines = doc.splitTextToSize(clean(text || '-'), CONTENT_W - 2);
      const lineH = lh(size);
      const labelH = 6;
      lines.forEach((line, i) => {
        const first = i === 0;
        const last = i === lines.length - 1;
        items.push({
          h: (first ? labelH : 0) + lineH + (last ? 2.5 : 0),
          draw(y) {
            let yy = y;
            if (first) {
              setFont(7.5, 'bold', C.accent);
              doc.text(label, M_LEFT + 1, yy + 4);
              yy += labelH;
            }
            setFont(size, 'normal', C.text);
            doc.text(line, M_LEFT + 1, yy + lineH * 0.78);
          }
        });
      });
    }
    textSection('OBSERVATION', snag.observation);
    textSection('REQUIRED ACTION', snag.action);

    // ----- Contractor / status / dates row -----
    setFont(9.5, 'normal');
    const colW = (CONTENT_W - 2) / 3;
    const contractorLines = doc.splitTextToSize(clean(snag.contractor || '-'), colW - 4);
    const statusText = closed
      ? `CLOSED${snag.closedDate ? ' - ' + Utils.formatDate(snag.closedDate) : ''}`
      : 'OPEN';
    const statusLines = doc.splitTextToSize(statusText, colW - 4);
    // For brought-forward snags this is the date the defect was FIRST recorded
    const recorded = Utils.formatDate(snag.firstRecorded || Utils.stampToDate(snag.createdAt));
    const metaH = 6 + Math.max(contractorLines.length, statusLines.length, 1) * lh(9.5) + 3;
    items.push({
      h: metaH + 8,                 // + spacing before the next snag
      draw(y) {
        doc.setDrawColor(...C.line);
        doc.setLineWidth(0.2);
        doc.line(M_LEFT, y, M_LEFT + CONTENT_W, y);
        const cols = [
          ['RESPONSIBLE CONTRACTOR', contractorLines, C.text, 'normal'],
          ['STATUS', statusLines, statusColor, 'bold'],
          ['DATE RECORDED', [recorded || '-'], C.text, 'normal']
        ];
        cols.forEach(([label, lines, color, style], i) => {
          const x = M_LEFT + 1 + i * colW;
          setFont(7.5, 'bold', C.accent);
          doc.text(label, x, y + 4.5);
          setFont(9.5, style, color);
          doc.text(lines, x, y + 6 + lh(9.5) * 0.85);
        });
        // Separator below the snag
        doc.setDrawColor(...C.accent);
        doc.setLineWidth(0.5);
        doc.line(M_LEFT, y + metaH, M_LEFT + CONTENT_W, y + metaH);
      }
    });

    return items;
  }

  return { start, buildPdf, makeFileName };
})();
