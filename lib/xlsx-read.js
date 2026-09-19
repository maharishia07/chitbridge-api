// @stage tested
// @stage-note Reads ONE sheet of an .xlsx into the same { headers, rows } a CSV parses to, so the import path
// @stage-note downstream is untouched. Pure apart from zlib — no disk, no network, no dependencies.
'use strict';
/**
 * xlsx-read.js — AN EXCEL FILE, READ INTO THE SHAPE A CSV ALREADY MAKES ([TILL-109]).
 *
 * Athi, 2026-09-19: *"xlsx support, most shops will have excel files."* He is right, and "save it as CSV
 * first" is exactly the kind of instruction that stops a shop opening today.
 *
 * ── ⚠️⚠️⚠️ WHY THIS IS OURS AND NOT A LIBRARY, WHICH IS AGAINST THE USUAL RULE ───────────────────────────────
 *
 * "Adopt, don't reinvent" is the motto and it lost this argument on evidence:
 *   · **`xlsx` (SheetJS) on npm is 0.18.5** — the version carrying CVE-2023-30533, prototype pollution. The
 *     fixed releases are not published to npm at all, so `npm i xlsx` installs the vulnerable one and cannot
 *     be upgraded through npm. This parses FILES UPLOADED BY STRANGERS.
 *   · **`exceljs` brings nine direct dependencies** — including `tmp`, which writes to disk, and TWO separate
 *     zip implementations — to read one sheet of a small catalogue.
 *
 * ⭐ AND WHAT A CATALOGUE NEEDS IS A SMALL, STATEABLE SUBSET: the first sheet, headers on row 1, cells that are
 * text or numbers. That is a thing we can own, the way this codebase already owns money, units, docnumber and
 * jurisdiction — rather than carrying a general-purpose spreadsheet engine for it.
 *
 * ── ⚠️⚠️ THE SAFETY PROPERTY THAT MAKES THAT DEFENSIBLE: IT REFUSES LOUDLY ───────────────────────────────────
 *
 * A narrow reader is only safe if it KNOWS it is narrow. Everything outside the subset throws with a sentence a
 * shopkeeper can act on — never a half-read sheet, never a silent blank. A wrong price imported quietly is far
 * worse than a file we decline to read. [[feedback-silence-is-the-bug]]
 *
 * ⚠️ AND IT IS BOUNDED. A zip bomb is a few kilobytes that inflates to gigabytes, so every entry is capped
 * before it is inflated and the total is capped as well.
 */
const zlib = require('zlib');

/* ⚠️ bounds, stated. A catalogue is small; anything near these is not one. */
const MAX_FILE = 8 * 1024 * 1024;        /* the .xlsx itself */
const MAX_ENTRY = 64 * 1024 * 1024;      /* one inflated part — sharedStrings is the big one */
const MAX_TOTAL = 96 * 1024 * 1024;      /* everything we inflate, together */
const MAX_CELLS = 400000;                /* a hard stop on the grid, whatever the sheet claims */

/** a refusal a person can act on, never a stack trace */
function refuse(msg) { const e = new Error(msg); e.userMessage = msg; e.code = 'XLSX_UNREADABLE'; return e; }

/* ── ⭐ THE ZIP, ONLY AS MUCH AS IS NEEDED ─────────────────────────────────────────────────────────────── */

/**
 * ⚠️ READ THE CENTRAL DIRECTORY, not the local headers in sequence. A local header may declare sizes of 0 and
 * defer them to a data descriptor after the data — which is exactly what streaming writers do, and Excel is
 * one. The central directory always carries the true sizes.
 */
function entries(buf) {
  /* the End of Central Directory record, searched from the back because a trailing comment may follow it */
  let eocd = -1;
  const from = Math.max(0, buf.length - 66 * 1024);
  for (let i = buf.length - 22; i >= from; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw refuse('That file is not a readable Excel workbook — it has no zip directory. If it was saved as .xls (the older format), open it in Excel and use "Save As" → .xlsx.');

  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) break;
    const method = buf.readUInt16LE(at + 10);
    const csize = buf.readUInt32LE(at + 20);
    const usize = buf.readUInt32LE(at + 24);
    const nlen = buf.readUInt16LE(at + 28);
    const elen = buf.readUInt16LE(at + 30);
    const clen = buf.readUInt16LE(at + 32);
    const lho = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nlen);
    out.set(name, { method, csize, usize, lho });
    at += 46 + nlen + elen + clen;
  }
  return out;
}

function readEntry(buf, e, budget) {
  if (!e) return null;
  /* ⚠️ THE DECLARED SIZE IS CHECKED BEFORE ANYTHING IS INFLATED — that is what stops a zip bomb */
  if (e.usize > MAX_ENTRY) throw refuse('That workbook has a part too large to read safely. A product list should be a few hundred kilobytes.');
  if (budget.used + e.usize > MAX_TOTAL) throw refuse('That workbook is too large to read safely.');
  if (e.lho + 30 > buf.length || buf.readUInt32LE(e.lho) !== 0x04034b50) throw refuse('That workbook is damaged and cannot be read.');
  const nlen = buf.readUInt16LE(e.lho + 26), elen = buf.readUInt16LE(e.lho + 28);
  const start = e.lho + 30 + nlen + elen;
  const raw = buf.subarray(start, start + e.csize);
  let out;
  if (e.method === 0) out = raw;
  else if (e.method === 8) { try { out = zlib.inflateRawSync(raw, { maxOutputLength: MAX_ENTRY }); } catch (_) { throw refuse('That workbook is damaged and cannot be read.'); } }
  else throw refuse('That workbook uses a compression this reader does not support. Re-saving it from Excel will fix it.');
  budget.used += out.length;
  return out.toString('utf8');
}

/* ── ⭐ THE XML, only the parts a catalogue uses ───────────────────────────────────────────────────────── */

const XML_ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function unxml(s) {
  return String(s == null ? '' : s).replace(/&(#x?[0-9A-Fa-f]+|[a-z]+);/g, (m, g) => {
    if (g[0] === '#') { const n = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return XML_ENT[g] !== undefined ? XML_ENT[g] : m;
  });
}

/**
 * the shared string table. ⚠️ A cell's text may be split across several <t> runs when part of it is styled —
 * "Basmati **Rice**" is one string in two runs, and taking only the first would import "Basmati".
 */
function sharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  const si = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g;
  let m;
  while ((m = si.exec(xml))) {
    const inner = m[1] || '';
    let text = '';
    const t = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let tm;
    while ((tm = t.exec(inner))) text += tm[1];
    out.push(unxml(text));
  }
  return out;
}

/** "BC12" → { col: 55, row: 12 } — 1-based column, as a spreadsheet counts */
function refToXY(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(String(ref || '').toUpperCase());
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col, row: Number(m[2]) };
}

/* ── ⭐⭐ THE SHEET ─────────────────────────────────────────────────────────────────────────────────────── */

/**
 * sheetRows(buffer, opts) → { headers, rows, sheet, sheets, headerRow, preview, truncated }
 *
 * `opts.headerRow` forces which SPREADSHEET row holds the column headings ([TILL-110]). Left out, the first
 * row with anything in it is used — right for a machine-written file, wrong for one that opens with the
 * shop's name. `preview` carries the first few rows with their real row numbers so a person can point at the
 * right one instead of counting.
 *
 * `rows` are objects keyed by header, exactly as lib/csv.parseCSV returns — so every caller downstream is
 * unchanged and the preflight sees the same shape whichever kind of file arrived.
 *
 * ⚠️ WHAT IT DELIBERATELY DOES NOT DO, each of which would be a guess:
 *   · dates — a serial number with a display format. A catalogue has prices, not dates, and inventing one is
 *     worse than leaving the number. The raw value travels and the preflight judges it.
 *   · formulas — the CACHED value is used, which is what the sheet last showed. A file saved without cached
 *     values has no value to read, and the cell is empty rather than wrong.
 *   · anything past the first sheet, unless asked. Named below so a person can choose.
 */
function sheetRows(buffer, opts) {
  const o = opts || {};
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (!buf.length) throw refuse('That file is empty.');
  if (buf.length > MAX_FILE) throw refuse('That file is larger than 8 MB. A product list should be far smaller — if it is a whole year of data, send just the product sheet.');
  /* ⚠️ "PK" or it is not a zip, and .xls (the 1997 format) is the common way to arrive here by mistake */
  if (!(buf[0] === 0x50 && buf[1] === 0x4b)) {
    throw refuse('That is not an .xlsx file. If it is an older .xls, open it in Excel and use "Save As" → "Excel Workbook (.xlsx)".');
  }

  const zip = entries(buf);
  const budget = { used: 0 };

  /* which sheets there are, and which one is first IN THE WORKBOOK'S OWN ORDER */
  const wb = readEntry(buf, zip.get('xl/workbook.xml'), budget);
  if (!wb) throw refuse('That workbook has no readable contents.');
  const rels = readEntry(buf, zip.get('xl/_rels/workbook.xml.rels'), budget) || '';
  const relTarget = new Map();
  let rm;
  const relRe = /<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g;
  while ((rm = relRe.exec(rels))) relTarget.set(rm[1], rm[2]);

  const sheets = [];
  const shRe = /<sheet\b[^>]*\bname="([^"]*)"[^>]*?(?:r:id|r:Id)="([^"]+)"[^>]*\/?>/g;
  let sm;
  while ((sm = shRe.exec(wb))) sheets.push({ name: unxml(sm[1]), rid: sm[2] });
  if (!sheets.length) throw refuse('That workbook has no sheets in it.');

  const wanted = o.sheet
    ? sheets.find((s) => s.name.toLowerCase() === String(o.sheet).toLowerCase())
    : sheets[0];
  if (!wanted) throw refuse('That workbook has no sheet called "' + o.sheet + '". It has: ' + sheets.map((s) => s.name).join(', ') + '.');

  let target = relTarget.get(wanted.rid) || 'worksheets/sheet1.xml';
  target = String(target).replace(/^\/?xl\//, '').replace(/^\//, '');
  const sheetXml = readEntry(buf, zip.get('xl/' + target), budget)
    || readEntry(buf, zip.get('xl/worksheets/sheet1.xml'), budget);
  if (!sheetXml) throw refuse('The sheet "' + wanted.name + '" could not be read from that workbook.');

  const strings = sharedStrings(readEntry(buf, zip.get('xl/sharedStrings.xml'), budget));

  /* the grid: sparse, because a spreadsheet is */
  const grid = new Map();     /* row → Map(col → text) */
  let maxCol = 0, maxRow = 0, cells = 0, truncated = false;

  const cellRe = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let cm;
  while ((cm = cellRe.exec(sheetXml))) {
    if (++cells > MAX_CELLS) { truncated = true; break; }
    const attrs = cm[1] || '', inner = cm[2] || '';
    const rMatch = /\br="([A-Z]+\d+)"/i.exec(attrs);
    if (!rMatch) continue;
    const xy = refToXY(rMatch[1]);
    if (!xy) continue;
    const tMatch = /\bt="([^"]+)"/.exec(attrs);
    const type = tMatch ? tMatch[1] : 'n';

    let text = '';
    if (type === 'inlineStr') {
      const t = /<t\b[^>]*>([\s\S]*?)<\/t>/g; let tm2;
      while ((tm2 = t.exec(inner))) text += tm2[1];
      text = unxml(text);
    } else {
      /* ⚠️ <v> is the value; for a formula cell it is the CACHED result, which is what the sheet last showed */
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
      const raw = v ? unxml(v[1]) : '';
      if (type === 's') {
        const i = Number(raw);
        /* ⚠️ a shared-string index that is not in the table means the file disagrees with itself */
        text = (Number.isInteger(i) && i >= 0 && i < strings.length) ? strings[i] : '';
      } else if (type === 'b') text = raw === '1' ? 'TRUE' : 'FALSE';
      else if (type === 'e') text = '';       /* #REF!, #N/A — an error is not a value, and must not become one */
      else text = raw;                        /* n, str, d — the raw text, judged downstream */
    }

    if (text === '') continue;
    if (!grid.has(xy.row)) grid.set(xy.row, new Map());
    grid.get(xy.row).set(xy.col, text);
    if (xy.col > maxCol) maxCol = xy.col;
    if (xy.row > maxRow) maxRow = xy.row;
  }

  if (!grid.size) throw refuse('The sheet "' + wanted.name + '" is empty.');

  /**
   * ⚠️⚠️ THE HEADER ROW IS THE FIRST ROW THAT HAS ANYTHING IN IT, not literally row 1. Real sheets begin with
   * a title, a blank line, sometimes a logo — and taking row 1 regardless would make the headers "Anbu
   * Vegetables", "", "" and place nothing.
   */
  const rowNums = [...grid.keys()].sort((a, b) => a - b);

  /**
   * ⭐ THE FIRST FEW ROWS AS THEY REALLY ARE, with their real numbers ([TILL-110]). The screen offers these so
   * a shopkeeper recognises their own headings rather than counting lines — and it is built BEFORE a header row
   * is chosen, because its whole job is to let somebody choose a different one.
   */
  const preview = rowNums.slice(0, 8).map((rn) => {
    const m = grid.get(rn), cells = [];
    for (let c = 1; c <= Math.min(maxCol, 12); c++) cells.push(String(m.get(c) || ''));
    while (cells.length && !cells[cells.length - 1]) cells.pop();
    return { row: rn, cells };
  });

  /**
   * ⚠️⚠️ ASKED FOR A ROW THAT IS NOT THERE, IT SAYS SO rather than falling back silently. Falling back
   * would import the wrong row as headings while the screen said the person's choice had been honoured, which
   * is the worst of both. [[feedback-silence-is-the-bug]]
   */
  let headRow;
  if (o.headerRow != null && String(o.headerRow) !== '') {
    const want = Number(o.headerRow);
    if (!Number.isInteger(want) || !grid.has(want)) {
      throw refuse('Row ' + o.headerRow + ' of "' + wanted.name + '" is empty, so it cannot be the headings.'
        + ' The rows with anything in them are: ' + rowNums.slice(0, 12).join(', ') + '.');
    }
    headRow = want;
  } else {
    headRow = rowNums[0];
  }
  const headMap = grid.get(headRow);
  const headers = [];
  for (let c = 1; c <= maxCol; c++) headers.push(String(headMap.get(c) || '').trim());
  /* trailing empty columns are not columns */
  while (headers.length && !headers[headers.length - 1]) headers.pop();
  if (!headers.length) throw refuse('The first row of "' + wanted.name + '" has no column headings, so there is no way to tell what the columns mean.');

  /**
   * ⚠️ A NAMELESS COLUMN IS NAMED, not dropped. Dropping it would silently shift every value after it into the
   * wrong field; a placeholder lets the preflight report it and a person leave it out on purpose.
   */
  const seen = new Map();
  const finalHeaders = headers.map((h, i) => {
    let name = h || ('Column ' + String.fromCharCode(65 + (i % 26)));
    /* ⚠️ and a DUPLICATE heading is disambiguated rather than collapsed — two "Price" columns are two columns */
    if (seen.has(name)) { const n = seen.get(name) + 1; seen.set(name, n); name = name + ' (' + n + ')'; }
    else seen.set(name, 1);
    return name;
  });

  const rows = [];
  for (const rn of rowNums) {
    if (rn <= headRow) continue;
    const src = grid.get(rn);
    const obj = {};
    let any = false;
    finalHeaders.forEach((h, i) => {
      const v = src.get(i + 1);
      obj[h] = v === undefined ? '' : v;
      if (v !== undefined && String(v).trim() !== '') any = true;
    });
    if (any) rows.push(obj);      /* a blank line in the middle of a sheet is not a product */
  }

  return { headers: finalHeaders, rows, sheet: wanted.name,
           sheets: sheets.map((s) => s.name),
           /* ⭐ which row was used, and what the person could pick instead ([TILL-110]) */
           headerRow: headRow, preview: preview, truncated };
}

module.exports = { sheetRows, refToXY, sharedStrings, unxml, MAX_FILE, MAX_CELLS };
