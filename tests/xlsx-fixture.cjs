'use strict';
/**
 * xlsx-fixture.cjs — A WORKBOOK, BUILT BYTE BY BYTE, FOR TESTS ONLY ([TILL-109]).
 *
 * ⚠️ THERE IS NO SPREADSHEET LIBRARY IN THIS PROJECT, deliberately — see the header of lib/xlsx-read for why
 * (the npm `xlsx` is pinned at a version carrying CVE-2023-30533, and `exceljs` brings nine dependencies to
 * read one sheet). So a fixture workbook is assembled here, and it is assembled ONCE: tests/xlsx-read.test.js
 * and chitbridge-web/e2e/till-upload.cjs both require it, because two zip writers would be two sets of
 * assumptions about the format and they would drift.
 *
 * ⚠️ IT IS NOT A PRODUCT FILE. It writes the small subset lib/xlsx-read reads, which is exactly what makes it
 * useful as a fixture and useless as a feature.
 */
const zlib = require('zlib');
/* ── a minimal .xlsx writer, for fixtures only ─────────────────────────────────────────────────────────── */

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ -1) >>> 0; };
})();

/** @param files {name, text, deflate?}[] */
function zip(files) {
  const locals = [], central = [];
  let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.from(f.text, 'utf8');
    const body = f.deflate ? zlib.deflateRawSync(data) : data;
    const method = f.deflate ? 8 : 0;
    const crc = CRC(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6);
    lh.writeUInt16LE(method, 8); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, body);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x800, 8);
    cd.writeUInt16LE(method, 10); cd.writeUInt32LE(crc, 16);
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

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const COL = (n) => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; } return s; };

/**
 * build a workbook. `rows` is an array of arrays; a cell is a string (shared), a number, or
 * { f:'A1*2', v:'80' } for a formula with a cached value, or { e:true } for an error cell.
 */
function book(rows, opts) {
  const o = opts || {};
  const shared = [];
  const idx = (s) => { const i = shared.indexOf(s); if (i >= 0) return i; shared.push(s); return shared.length - 1; };
  const xmlRows = rows.map((r, ri) => {
    const cells = r.map((c, ci) => {
      if (c === null || c === undefined || c === '') return '';
      const ref = COL(ci + 1) + (ri + 1);
      if (typeof c === 'object' && c.e) return '<c r="' + ref + '" t="e"><v>#REF!</v></c>';
      if (typeof c === 'object' && c.f) return '<c r="' + ref + '"><f>' + esc(c.f) + '</f><v>' + esc(c.v) + '</v></c>';
      if (typeof c === 'object' && c.inline) return '<c r="' + ref + '" t="inlineStr"><is><t>' + esc(c.inline) + '</t></is></c>';
      if (typeof c === 'number') return '<c r="' + ref + '"><v>' + c + '</v></c>';
      return '<c r="' + ref + '" t="s"><v>' + idx(String(c)) + '</v></c>';
    }).join('');
    return '<row r="' + (ri + 1) + '">' + cells + '</row>';
  }).join('');

  const sheetXml = '<?xml version="1.0"?><worksheet><sheetData>' + xmlRows + '</sheetData></worksheet>';
  /* ⭐ a shared string may be split into runs when part of it is styled — Excel does this constantly */
  const ss = '<?xml version="1.0"?><sst count="' + shared.length + '">'
    + shared.map((s) => {
        if (o.split && s === o.split) { const h = Math.ceil(s.length / 2);
          return '<si><r><t>' + esc(s.slice(0, h)) + '</t></r><r><t>' + esc(s.slice(h)) + '</t></r></si>'; }
        return '<si><t>' + esc(s) + '</t></si>';
      }).join('') + '</sst>';

  const names = o.sheets || ['Sheet1'];
  const wb = '<?xml version="1.0"?><workbook><sheets>'
    + names.map((n, i) => '<sheet name="' + esc(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('')
    + '</sheets></workbook>';
  const rels = '<?xml version="1.0"?><Relationships>'
    + names.map((n, i) => '<Relationship Id="rId' + (i + 1) + '" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('')
    + '</Relationships>';

  const files = [
    { name: '[Content_Types].xml', text: '<?xml version="1.0"?><Types/>' },
    { name: 'xl/workbook.xml', text: wb, deflate: true },
    { name: 'xl/_rels/workbook.xml.rels', text: rels },
    { name: 'xl/sharedStrings.xml', text: ss, deflate: true },
    { name: 'xl/worksheets/sheet1.xml', text: sheetXml, deflate: true },
  ];
  /* other sheets exist but are empty, so "the first one" can be told from "the only one" */
  for (let i = 1; i < names.length; i++)
    files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml',
      text: '<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>other</t></is></c></row></sheetData></worksheet>' });
  return zip(files);
}


module.exports = { zip, book, COL };
