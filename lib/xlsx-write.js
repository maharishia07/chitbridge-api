// @stage tested
// @stage-note Writes a multi-sheet .xlsx. The counterpart of lib/xlsx-read, and ours for the same reason:
// @stage-note the npm readers were not safe to take. No dependencies beyond zlib.
'use strict';
/**
 * xlsx-write.js — A WORKBOOK A SHOP CAN OPEN, EDIT AND BRING BACK ([TILL-115]).
 *
 * Athi, 2026-09-19: *"now do the masters into the workbook, download first"* — and, earlier, the reason:
 * *"upload should not be a primary motive, get it streamlined off the database is the motive."*
 *
 * ⭐⭐ THAT IS WHAT "DOWNLOAD FIRST" MEANS. The database is the source of truth; the workbook is generated FROM
 * it and carries the shop's own masters as sheets. A category cell then becomes a CHOICE FROM ITS OWN LIST
 * rather than free text somebody retypes — which is how one shop stops ending up with "Vegetables",
 * "vegetables" and "Veg" as three categories.
 *
 * ── ⚠️⚠️ WHAT A FILE NEEDS BEFORE EXCEL WILL OPEN IT ─────────────────────────────────────────────────────────
 *
 * Measured, not guessed: a real workbook Excel wrote carries fifteen parts. Most are optional — theme,
 * calcChain, docProps, sharedStrings. The five that are NOT, plus styles which some versions of Excel demand
 * before it will stop offering to "repair" the file:
 *
 *     [Content_Types].xml        every part's media type, or Excel refuses the whole file
 *     _rels/.rels                the root relationship, pointing at the workbook
 *     xl/workbook.xml            the sheet names, in order
 *     xl/_rels/workbook.xml.rels each sheet's target, by the r:id the workbook cites
 *     xl/worksheets/sheetN.xml   the cells
 *
 * ⚠️ tests/xlsx-fixture.cjs omits two of those. It did not matter — lib/xlsx-read does not check them — and it
 * WOULD have mattered the first time a shopkeeper double-clicked one. A fixture that only our own reader
 * accepts is not evidence about Excel.
 *
 * ── ⭐ INLINE STRINGS, DELIBERATELY ──────────────────────────────────────────────────────────────────────────
 * Text goes in the cell as `<is><t>`, not through a shared-string table. A shared table is smaller on a file
 * with much repetition and is a second index to keep consistent; a catalogue is hundreds of rows, the
 * difference is kilobytes, and an index that can disagree with its cells is a class of bug we do not need.
 */
const zlib = require('zlib');

/* ── the zip ───────────────────────────────────────────────────────────────────────────────────────────── */

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ -1) >>> 0; };
})();

/**
 * ⚠️ EVERY ENTRY IS DEFLATED AND CARRIES ITS CRC AND BOTH SIZES IN THE LOCAL HEADER. A writer may defer those
 * to a data descriptor instead; readers that walk the central directory cope, and some that do not, do not.
 * Writing them twice costs nothing and removes the question.
 * ⚠️ BIT 11 (0x800) SAYS THE NAME IS UTF-8. Every name here is ASCII, so it changes nothing today — and it is
 * the flag that stops a non-ASCII sheet file name being read in the system codepage later.
 */
function zip(files) {
  const locals = [], central = [];
  let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.from(f.text, 'utf8');
    const body = zlib.deflateRawSync(data);
    const crc = CRC(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6);
    lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, body);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x800, 8);
    cd.writeUInt16LE(8, 10); cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20); cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(off, 42);
    central.push(cd, name);
    off += 30 + name.length + body.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cdBuf, eocd]);
}

/* ── the xml ───────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * ⚠️⚠️ AND CONTROL CHARACTERS ARE STRIPPED, not escaped. XML 1.0 cannot carry most of them at all — not even as
 * a numeric entity — so a product name that picked one up (from a bad paste, or a CSV read in the wrong
 * encoding) would produce a file Excel calls corrupt. Losing an invisible character beats losing the workbook.
 */
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 1 → A, 27 → AA — how a spreadsheet names a column */
function colName(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; }
  return s;
}

/**
 * ⚠️ A NUMBER IS ONLY A NUMBER IF IT IS ONE. A code like "0070" is text — written as a number it loses its
 * leading zero and a barcode stops scanning. So only a real JS number, finite, becomes a numeric cell;
 * everything else is text, including numeric-looking strings.
 */
function cellXml(ref, v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number' && Number.isFinite(v)) return '<c r="' + ref + '"><v>' + v + '</v></c>';
  return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
}

function sheetXml(rows) {
  const body = (rows || []).map((row, ri) => {
    const cells = (row || []).map((v, ci) => cellXml(colName(ci + 1) + (ri + 1), v)).join('');
    return cells ? '<row r="' + (ri + 1) + '">' + cells + '</row>' : '';
  }).join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<sheetData>' + body + '</sheetData></worksheet>';
}

/**
 * ⚠️ EXCEL RESTRICTS A SHEET NAME: 31 characters, and none of : \ / ? * [ ]. A name it will not accept makes
 * the whole workbook unopenable, so it is corrected here rather than refused — a shop should not be told its
 * category cannot be a sheet.
 */
function safeSheetName(name, taken) {
  let s = String(name == null ? '' : name).replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let n = 1;
  while (taken.has(s.toLowerCase())) { const suffix = ' (' + (++n) + ')'; s = s.slice(0, 31 - suffix.length) + suffix; }
  taken.add(s.toLowerCase());
  return s;
}

/**
 * ── ⭐⭐⭐ workbook([{ name, rows }]) → Buffer ────────────────────────────────────────────────────────────────
 *
 * `rows` is an array of arrays. A cell is a string, a finite number, or null for blank.
 *
 * ⚠️ THE ORDER OF THE PARTS DOES NOT MATTER TO A READER, but the relationships do: the workbook cites each
 * sheet by an r:id that must exist in xl/_rels/workbook.xml.rels, and every part must have a content type.
 * Get either wrong and Excel offers to repair the file rather than open it.
 */
function workbook(sheets) {
  const list = (Array.isArray(sheets) ? sheets : []).filter(Boolean);
  if (!list.length) throw new Error('a workbook needs at least one sheet');

  const taken = new Set();
  const named = list.map((s, i) => ({ name: safeSheetName(s.name || ('Sheet' + (i + 1)), taken), rows: s.rows || [] }));

  const files = [];

  files.push({ name: '[Content_Types].xml',
    text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + named.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1)
          + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + '</Types>' });

  files.push({ name: '_rels/.rels',
    text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"'
      + ' Target="xl/workbook.xml"/></Relationships>' });

  files.push({ name: 'xl/workbook.xml',
    text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
      + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
      + named.map((s, i) => '<sheet name="' + esc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('')
      + '</sheets></workbook>' });

  files.push({ name: 'xl/_rels/workbook.xml.rels',
    text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + named.map((s, i) => '<Relationship Id="rId' + (i + 1)
          + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"'
          + ' Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('')
      /* ⚠️ styles gets the id AFTER the sheets, or it collides with one and the workbook opens the wrong part */
      + '<Relationship Id="rId' + (named.length + 1)
      + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
      + '</Relationships>' });

  /* ⚠️ THE MINIMUM STYLES PART. Nothing here is styling — it is the empty set of fonts, fills, borders and
     formats that some builds of Excel insist on finding before they will open a workbook without "repairing"
     it. Cheaper to include than to field the support call. */
  files.push({ name: 'xl/styles.xml',
    text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
      + '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>'
      + '<borders count="1"><border/></borders>'
      + '<cellStyleXfs count="1"><xf/></cellStyleXfs>'
      + '<cellXfs count="1"><xf xfId="0"/></cellXfs>'
      + '</styleSheet>' });

  named.forEach((s, i) => files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', text: sheetXml(s.rows) }));

  return zip(files);
}

module.exports = { workbook, colName, safeSheetName, esc };
