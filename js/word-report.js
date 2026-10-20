/* =========================================================
   word-report.js – the snag report as an editable Word (.docx) file.

   Same content as the PDF report:
     cover details, summary, snag register, then one block per
     snag (photos, location on drawing, observation, action,
     contractor / status / date). Logo + company in the page
     header, "Page X of Y" in the footer.

   Uses docx.js (js/lib/docx.umd.js, MIT licence), loaded only
   when a Word report is generated. Works offline.
   ========================================================= */

const WordReport = (() => {
  // ---------- Loading the library ----------
  let libPromise = null;
  function loadLib() {
    if (window.docx && window.docx.Document) return Promise.resolve(window.docx);
    if (!libPromise) {
      libPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'js/lib/docx.umd.js';
        s.onload = () => window.docx ? resolve(window.docx) : reject(new Error('The Word library failed to start.'));
        s.onerror = () => { libPromise = null; reject(new Error('The Word library could not be loaded. Open the app once while online, then try again.')); };
        document.head.appendChild(s);
      });
    }
    return libPromise;
  }

  // ---------- Units & colours ----------
  const MM_TWIP = 56.7;                    // Word measures layout in twips (1/20 pt)
  const mmPx = mm => Math.round(mm * 96 / 25.4);   // image sizes are in pixels at 96 dpi
  const tw = mm => Math.round(mm * MM_TWIP);
  const CONTENT_MM = 180;                  // A4 width 210 mm minus 15 mm margins
  const C = {
    text: '1A2129', muted: '5F6B77', accent: '1F4E79', line: 'D2D8DE',
    fill: 'F3F5F7', open: 'B54708', closed: '157F3D', white: 'FFFFFF'
  };

  /** 'data:image/jpeg;base64,...' -> { data: Uint8Array, type: 'jpg' | 'png' } */
  function imageData(dataUrl) {
    const comma = dataUrl.indexOf(',');
    const bin = atob(dataUrl.slice(comma + 1));
    const data = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
    return { data, type: dataUrl.startsWith('data:image/png') ? 'png' : 'jpg' };
  }

  /** Fit an image (w x h px) inside a box (mm), keeping its proportions. Returns mm. */
  function fitBox(w, h, maxW, maxH) {
    const ratio = (w && h) ? w / h : 4 / 3;
    let bw = maxW, bh = bw / ratio;
    if (bh > maxH) { bh = maxH; bw = bh * ratio; }
    return { w: bw, h: bh };
  }

  // =========================================================
  async function build({ project, visit, snags, scope, totals }) {
    const d = await loadLib();
    const {
      Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, Header, Footer,
      AlignmentType, WidthType, BorderStyle, ShadingType, TabStopType, PageNumber, VerticalAlign
    } = d;

    const settings = Settings.get();
    const generated = Utils.todayISO();
    const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };
    const thin = color => ({ style: BorderStyle.SINGLE, size: 4, color });
    const RIGHT_TAB = [{ type: TabStopType.RIGHT, position: tw(CONTENT_MM) }];

    // ----- Small helpers -----
    const run = (text, o = {}) => new TextRun({ text: String(text == null ? '' : text), font: 'Arial', size: (o.pt || 10) * 2, bold: !!o.bold, italics: !!o.italic, color: o.color || C.text });

    /** Paragraph; multi-line text becomes line breaks. o.keep = keep with the next paragraph. */
    function para(text, o = {}) {
      const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
      const children = [];
      lines.forEach((ln, i) => {
        children.push(new TextRun({ text: ln, font: 'Arial', size: (o.pt || 10) * 2, bold: !!o.bold, italics: !!o.italic, color: o.color || C.text, break: i ? 1 : 0 }));
      });
      return new Paragraph({
        children, alignment: o.align, keepNext: !!o.keep, keepLines: true,
        spacing: { before: o.before || 0, after: o.after == null ? 60 : o.after },
        border: o.border, shading: o.shading, tabStops: o.tabs, pageBreakBefore: !!o.pageBreak
      });
    }
    const label = (text, keep = true) => para(text.toUpperCase(), { pt: 7.5, bold: true, color: C.accent, before: 120, after: 40, keep });

    function cell(children, o = {}) {
      return new TableCell({
        children, width: o.widthMm ? { size: tw(o.widthMm), type: WidthType.DXA } : undefined,
        shading: o.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: o.fill } : undefined,
        borders: o.borders || { top: NONE, bottom: NONE, left: NONE, right: NONE },
        margins: { top: tw(1.2), bottom: tw(1.2), left: tw(1.5), right: tw(1.5) },
        verticalAlign: o.vAlign || VerticalAlign.TOP
      });
    }

    function image(dataUrl, wMm, hMm) {
      const img = imageData(dataUrl);
      return new ImageRun({ type: img.type, data: img.data, transformation: { width: mmPx(wMm), height: mmPx(hMm) } });
    }

    // ----- Page header: logo + company (left), report title + ref/date (right) -----
    const headerChildren = [];
    const top = [];
    if (settings.logoDataUrl) {
      try {
        const img = await Utils.loadImage(settings.logoDataUrl);
        const box = fitBox(img.naturalWidth, img.naturalHeight, 45, 12);
        top.push(image(settings.logoDataUrl, box.w, box.h), run('   '));
      } catch (e) { /* no logo */ }
    }
    if (settings.company) top.push(run(settings.company, { pt: 10, bold: true }));
    top.push(new TextRun({ text: '\tSITE INSPECTION / SNAG REPORT', font: 'Arial', size: 16, bold: true, color: C.accent }));
    headerChildren.push(new Paragraph({ children: top, tabStops: RIGHT_TAB, spacing: { after: 0 } }));
    headerChildren.push(new Paragraph({
      children: [new TextRun({ text: '\t' + [project.number, Utils.formatDate(visit.date)].filter(Boolean).join('  |  '), font: 'Arial', size: 16, color: C.muted })],
      tabStops: RIGHT_TAB, border: { bottom: thin(C.line) }, spacing: { after: 120 }
    }));

    // ----- Page footer: reference + "Page X of Y" -----
    const footerText = [project.number || project.name, visit.title, `Generated ${Utils.formatDate(generated)}`].filter(Boolean).join('  |  ');
    const footer = new Footer({
      children: [new Paragraph({
        tabStops: RIGHT_TAB, border: { top: thin(C.line) }, spacing: { before: 80 },
        children: [
          new TextRun({ text: footerText, font: 'Arial', size: 15, color: C.muted }),
          new TextRun({ children: ['\tPage ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], font: 'Arial', size: 15, color: C.muted })
        ]
      })]
    });

    const body = [];

    // =====================================================
    // Cover: title, details, summary, register
    // =====================================================
    body.push(para('SITE INSPECTION / SNAG REPORT', { pt: 18, bold: true, color: C.accent, after: 60 }));
    body.push(para(visit.title, { pt: 12, color: C.muted, after: 200 }));

    const scopeText = { all: 'All snags', open: 'Open snags only', closed: 'Closed snags only' }[scope];
    const inspectorText = [visit.inspector, settings.jobTitle && visit.inspector === settings.name ? settings.jobTitle : ''].filter(Boolean).join(', ');
    const details = [
      ['Project', project.name], ['Project Number', project.number], ['Client', project.client],
      ['Site', project.site], ['Main Contractor', project.mainContractor],
      ['Inspection Date', Utils.formatDate(visit.date)], ['Inspector', inspectorText],
      ['Company', settings.company], ['Discipline', visit.discipline],
      ['Report Scope', scopeText], ['Report Generated', Utils.formatDate(generated)]
    ].filter(r => r[1]);
    const rowBorders = { top: NONE, left: NONE, right: NONE, bottom: thin(C.line) };
    body.push(new Table({
      width: { size: tw(CONTENT_MM), type: WidthType.DXA }, borders: NO_BORDERS,
      columnWidths: [tw(42), tw(CONTENT_MM - 42)],
      rows: details.map(([k, v]) => new TableRow({
        cantSplit: true,
        children: [
          cell([para(k.toUpperCase(), { pt: 9, bold: true, color: C.muted, after: 0 })], { widthMm: 42, borders: rowBorders }),
          cell([para(v, { pt: 10, after: 0 })], { widthMm: CONTENT_MM - 42, borders: rowBorders })
        ]
      }))
    }));
    if (visit.notes) {
      body.push(label('Notes'));
      body.push(para(visit.notes));
    }

    // Summary boxes
    body.push(para('SUMMARY (ALL SNAGS RECORDED ON THIS VISIT)', { pt: 8, bold: true, color: C.muted, before: 240, after: 80, keep: true }));
    const box = (value, text, color) => cell([
      para(String(value), { pt: 16, bold: true, color, align: AlignmentType.CENTER, after: 0 }),
      para(text.toUpperCase(), { pt: 7.5, bold: true, color: C.muted, align: AlignmentType.CENTER, after: 0 })
    ], { widthMm: CONTENT_MM / 3, fill: C.fill, borders: { top: thin(C.white), bottom: thin(C.white), left: thin(C.white), right: thin(C.white) } });
    body.push(new Table({
      width: { size: tw(CONTENT_MM), type: WidthType.DXA }, borders: NO_BORDERS,
      columnWidths: [tw(60), tw(60), tw(60)],
      rows: [new TableRow({ cantSplit: true, children: [box(totals.all, 'Total Snags', C.text), box(totals.open, 'Open', C.open), box(totals.closed, 'Closed', C.closed)] })]
    }));
    if (scope !== 'all') body.push(para(`This report includes ${scopeText.toLowerCase()} (${snags.length}).`, { pt: 9, color: C.muted, before: 80 }));

    // Snag register (header row repeats on each page)
    body.push(para('SNAG REGISTER', { pt: 11, bold: true, color: C.accent, before: 280, after: 80, keep: true }));
    const regCols = [22, 98, 34, 26];
    const headCell = (t, i, right) => cell([para(t, { pt: 8, bold: true, color: C.white, after: 0, align: right ? AlignmentType.RIGHT : undefined })], { widthMm: regCols[i], fill: C.accent });
    const regRows = [new TableRow({ tableHeader: true, cantSplit: true, children: [headCell('NO.', 0), headCell('AREA / LOCATION', 1), headCell('CATEGORY', 2), headCell('STATUS', 3, true)] })];
    snags.forEach((s, i) => {
      const closed = s.status === STATUS.CLOSED;
      const fill = i % 2 ? C.fill : undefined;
      regRows.push(new TableRow({
        cantSplit: true,
        children: [
          cell([para(s.number, { pt: 9, bold: true, after: 0 })], { widthMm: regCols[0], fill }),
          cell([para(s.area || '-', { pt: 9, after: 0 })], { widthMm: regCols[1], fill }),
          cell([para(s.category || '', { pt: 9, after: 0 })], { widthMm: regCols[2], fill }),
          cell([para(closed ? 'CLOSED' : 'OPEN', { pt: 8.5, bold: true, color: closed ? C.closed : C.open, after: 0, align: AlignmentType.RIGHT })], { widthMm: regCols[3], fill })
        ]
      }));
    });
    body.push(new Table({ width: { size: tw(CONTENT_MM), type: WidthType.DXA }, borders: { ...NO_BORDERS, bottom: thin(C.line) }, columnWidths: regCols.map(tw), rows: regRows }));

    // =====================================================
    // Snag details – one block per snag
    // =====================================================
    body.push(para('SNAG DETAILS', { pt: 11, bold: true, color: C.accent, pageBreak: true, after: 120, keep: true }));

    const drawingCache = new Map();
    for (let i = 0; i < snags.length; i++) {
      Utils.updateLoading(`Adding snag ${i + 1} of ${snags.length}…`);
      const s = snags[i];
      const { photos, location } = await Reports.loadSnagMedia(s, drawingCache);
      const closed = s.status === STATUS.CLOSED;
      const statusColor = closed ? C.closed : C.open;

      // Each snag is ONE single-column table, one row per part. Every paragraph is
      // "keep with next", which Word reliably honours between table rows – so a snag
      // stays together on one page whenever it fits.
      const blockRows = [];
      const addRow = (children, o = {}) => blockRows.push(new TableRow({
        cantSplit: !!o.cantSplit,   // only for rows of limited height (photos, header, status)
        children: [cell(children, { widthMm: CONTENT_MM, fill: o.fill, borders: o.borders })]
      }));
      const INNER_TAB = [{ type: TabStopType.RIGHT, position: tw(CONTENT_MM - 4) }];

      // Header bar: number, category ........ STATUS
      addRow([new Paragraph({
        keepNext: true, keepLines: true, tabStops: INNER_TAB, spacing: { before: 20, after: 20 },
        children: [
          new TextRun({ text: s.number || '', font: 'Arial', size: 26, bold: true, color: C.accent }),
          new TextRun({ text: '   ' + (s.category || ''), font: 'Arial', size: 18, color: C.muted }),
          new TextRun({ text: '\t' + (closed ? 'CLOSED' : 'OPEN'), font: 'Arial', size: 18, bold: true, color: statusColor })
        ]
      })], { cantSplit: true, fill: C.fill, borders: { top: NONE, bottom: NONE, right: NONE, left: { style: BorderStyle.SINGLE, size: 36, color: statusColor } } });

      const areaParas = [para((s.area || 'Area not recorded').toUpperCase(), { pt: 9.5, bold: true, keep: true, before: 60, after: 40 })];
      if (s.carriedFrom) areaParas.push(para(`Brought forward from site visit of ${Utils.formatDate(s.carriedFrom.visitDate)}${s.previousNumber ? ` (previously ${s.previousNumber})` : ''}`, { pt: 8.5, italic: true, color: C.accent, keep: true }));
      if (s.carriedForwardTo) areaParas.push(para(`Carried forward to site visit of ${Utils.formatDate(s.carriedForwardDate)}`, { pt: 8.5, italic: true, color: C.accent, keep: true }));
      addRow(areaParas, { cantSplit: true });

      // Photos in rows (1, 2 or 3 across), each with a caption
      if (photos.length) {
        const n = photos.length;
        const perRow = n === 1 ? 1 : (n === 2 || n === 4) ? 2 : 3;
        const innerMm = CONTENT_MM - 3;   // inside the block's cell margins
        const cellMm = innerMm / perRow;
        const maxH = location ? (perRow === 1 ? 75 : perRow === 2 ? 58 : 45) : (perRow === 1 ? 95 : perRow === 2 ? 68 : 52);
        const captions = Reports.photoCaptions(photos);
        for (let r = 0; r < n; r += perRow) {
          const cells = [];
          for (let c = 0; c < perRow; c++) {
            const p = photos[r + c];
            if (!p) { cells.push(cell([para('', { keep: true })], { widthMm: cellMm })); continue; }
            const b = fitBox(p.width, p.height, cellMm - 4, maxH);
            cells.push(cell([
              new Paragraph({ keepNext: true, keepLines: true, alignment: perRow === 1 ? AlignmentType.CENTER : AlignmentType.LEFT, spacing: { after: 20 }, children: [image(p.dataUrl, b.w, b.h)] }),
              para(captions[r + c], { pt: 7.5, color: p.kind === 'closeout' ? C.closed : C.muted, keep: true, after: 0, align: perRow === 1 ? AlignmentType.CENTER : undefined })
            ], { widthMm: cellMm }));
          }
          // One row of photos = a small borderless table inside this block row
          addRow([
            new Table({ width: { size: tw(innerMm), type: WidthType.DXA }, borders: NO_BORDERS, columnWidths: Array(perRow).fill(tw(cellMm)), rows: [new TableRow({ cantSplit: true, children: cells })] }),
            para('', { keep: true, after: 0, pt: 2 })
          ], { cantSplit: true });
        }
      }

      // Location on drawing
      if (location) {
        const b = fitBox(location.width, location.height, 120, 75);
        addRow([
          new Paragraph({
            keepNext: true, keepLines: true, spacing: { before: 100, after: 40 },
            children: [
              new TextRun({ text: 'LOCATION ON DRAWING   ', font: 'Arial', size: 15, bold: true, color: C.accent }),
              new TextRun({ text: location.name, font: 'Arial', size: 17, color: C.muted })
            ]
          }),
          new Paragraph({ keepNext: true, keepLines: true, spacing: { after: 40 }, children: [image(location.dataUrl, b.w, b.h)] })
        ], { cantSplit: true });
      }

      // Text (these rows may break across pages if very long, so no text is ever hidden)
      addRow([label('Observation'), para(s.observation || '-', { keep: true })]);
      addRow([label('Required action'), para(s.action || '-', { keep: true, after: 80 })]);

      // Contractor / status / date – final row of the block
      const statusText = closed ? `CLOSED${s.closedDate ? ' - ' + Utils.formatDate(s.closedDate) : ''}` : 'OPEN';
      const recorded = Utils.formatDate(s.firstRecorded || Utils.stampToDate(s.createdAt));
      const metaW = (CONTENT_MM - 3) / 3;
      const metaCell = (title, value, color, bold) => cell([
        para(title, { pt: 7.5, bold: true, color: C.accent, after: 20, keep: true }),
        para(value || '-', { pt: 9.5, bold, color: color || C.text, after: 0 })
      ], { widthMm: metaW, borders: { top: thin(C.line), bottom: { style: BorderStyle.SINGLE, size: 12, color: C.accent }, left: NONE, right: NONE } });
      addRow([
        new Table({
          width: { size: tw(CONTENT_MM - 3), type: WidthType.DXA }, borders: NO_BORDERS,
          columnWidths: [tw(metaW), tw(metaW), tw(metaW)],
          rows: [new TableRow({ cantSplit: true, children: [
            metaCell('RESPONSIBLE CONTRACTOR', s.contractor),
            metaCell('STATUS', statusText, statusColor, true),
            metaCell('DATE RECORDED', recorded)
          ] })]
        }),
        para('', { after: 0, pt: 2 })   // last paragraph: NOT "keep with next" – the block ends here
      ], { cantSplit: true });

      body.push(new Table({ width: { size: tw(CONTENT_MM), type: WidthType.DXA }, borders: NO_BORDERS, columnWidths: [tw(CONTENT_MM)], rows: blockRows }));
      body.push(para('', { after: 200, pt: 6 }));   // space before the next snag

      await new Promise(r => setTimeout(r, 0));   // let the screen update between snags
    }

    // =====================================================
    const doc = new Document({
      creator: settings.name || 'Site Inspections',
      title: `Snag Report - ${project.name}`,
      description: visit.title || '',
      styles: { default: { document: { run: { font: 'Arial', size: 20, color: C.text } } } },
      sections: [{
        properties: {
          page: {
            size: { width: tw(210), height: tw(297) },
            margin: { top: tw(12), bottom: tw(15), left: tw(15), right: tw(15), header: tw(8), footer: tw(8) }
          }
        },
        headers: { default: new Header({ children: headerChildren }) },
        footers: { default: footer },
        children: body
      }]
    });
    const blob = await Packer.toBlob(doc);
    return new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  return { build };
})();
