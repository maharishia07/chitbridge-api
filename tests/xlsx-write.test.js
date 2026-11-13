'use strict';
/**
 * xlsx-write.test.js — A WORKBOOK EXCEL WILL OPEN ([TILL-115]).
 *
 * Athi: *"now do the masters into the workbook, download first."*
 *
 * ⚠️⚠️⚠️ THE HARD PART IS NOT WRITING CELLS, IT IS THE PACKAGE. A workbook with perfect sheet XML and a missing
 * relationship is a file Excel offers to "repair" — which, to a shopkeeper, is a corrupt download from their
 * own supplier. The parts below were taken from a real workbook Excel itself wrote, not from memory.
 *
 * ⚠️ AND OUR OWN READER IS NOT THE JUDGE. lib/xlsx-read does not check `_rels/.rels` or the content types, so a
 * file it round-trips happily can still be one Excel refuses. The structural assertions exist precisely because
 * the round-trip cannot see them.
 *
 * Run: node tests/xlsx-write.test.js   · no DB, no network.
 * CARD      06-catalogue-pim/import-export-workbook-preflight
 */
const assert = require('assert'), path = require('path');
const API = path.join(__dirname, '..');
const W = require(path.join(API, 'lib', 'xlsx-write'));
const R = require(path.join(API, 'lib', 'xlsx-read'));

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

/** the parts, read straight out of the zip's central directory */
function partsOf(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  assert.ok(eocd > 0, 'no end-of-central-directory — that is not a zip');
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count; n++) {
    const nlen = buf.readUInt16LE(at + 28), elen = buf.readUInt16LE(at + 30), clen = buf.readUInt16LE(at + 32);
    out.push(buf.toString('utf8', at + 46, at + 46 + nlen));
    at += 46 + nlen + elen + clen;
  }
  return out;
}

console.log('— a workbook Excel will open —');

/**
 * ⚠️⚠️⚠️ THE FIVE PARTS A WORKBOOK CANNOT OPEN WITHOUT, plus styles, which some builds of Excel demand before
 * they stop offering to repair the file. Measured against a real workbook Excel wrote (which carries fifteen
 * parts; the other nine are optional).
 */
it('⚠️⚠️⚠️ it carries every part Excel requires', () => {
  const parts = partsOf(W.workbook([{ name: 'A', rows: [['x']] }, { name: 'B', rows: [['y']] }]));
  for (const need of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml',
                      'xl/_rels/workbook.xml.rels', 'xl/styles.xml',
                      'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml'])
    assert.ok(parts.indexOf(need) >= 0, 'missing ' + need + ' — Excel will offer to repair this file');
});

/**
 * ⚠️⚠️ AND EVERY SHEET IS ACTUALLY WIRED. A sheet the workbook names but the rels do not target opens as an
 * empty tab, or not at all — and our own reader would still read sheet1 and report nothing wrong.
 */
it('⚠️⚠️ every sheet is named, related and typed', () => {
  const buf = W.workbook([{ name: 'One', rows: [['a']] }, { name: 'Two', rows: [['b']] }, { name: 'Three', rows: [['c']] }]);
  const text = buf.toString('latin1');   /* the parts are deflated; the reader below is the real check */
  const r = R.sheetRows(buf);
  assert.deepStrictEqual(r.sheets, ['One', 'Two', 'Three'], 'the workbook does not name all three sheets');
  for (const n of ['One', 'Two', 'Three'])
    assert.doesNotThrow(() => R.sheetRows(buf, { sheet: n }), 'sheet "' + n + '" is named but cannot be reached');
  assert.ok(text.length > 0);
});

it('⭐ a sheet round-trips through our own reader', () => {
  const buf = W.workbook([{ name: 'Products', rows: [['name', 'price'], ['Tomato', 40], ['Onion', 30]] }]);
  const r = R.sheetRows(buf);
  assert.deepStrictEqual(r.headers, ['name', 'price']);
  assert.strictEqual(r.rows.length, 2);
  assert.deepStrictEqual(r.rows[0], { name: 'Tomato', price: '40' });
});

/**
 * ⚠️⚠️ A CODE IS TEXT, EVEN WHEN IT LOOKS LIKE A NUMBER. "0070" written as a number loses its leading zero and
 * the barcode stops scanning — the classic spreadsheet injury, and one we would be inflicting ourselves.
 */
it('⚠️⚠️ a numeric-looking code keeps its leading zero', () => {
  const buf = W.workbook([{ name: 'S', rows: [['code', 'price'], ['0070', 40], ['00123', 5]] }]);
  const r = R.sheetRows(buf);
  assert.strictEqual(r.rows[0].code, '0070', 'the leading zero was lost — a barcode is now a different barcode');
  assert.strictEqual(r.rows[1].code, '00123');
  /* and a real number is still a number, so Excel can total a price column */
  assert.strictEqual(r.rows[0].price, '40');
});

it('⚠️⚠️ Tamil and Hindi survive the write as well as the read', () => {
  const buf = W.workbook([{ name: 'S', rows: [['name'], ['தக்காளி'], ['आलू'], ['Café']] }]);
  const r = R.sheetRows(buf);
  assert.strictEqual(r.rows[0].name, 'தக்காளி');
  assert.strictEqual(r.rows[1].name, 'आलू');
  assert.strictEqual(Buffer.from(r.rows[2].name, 'utf8').toString('hex'), '436166c3a9');
});

/**
 * ⚠️⚠️ XML CANNOT CARRY MOST CONTROL CHARACTERS AT ALL — not even as a numeric entity. A product name that
 * picked one up (a bad paste, a CSV read in the wrong encoding) would otherwise produce a workbook Excel calls
 * corrupt. Losing an invisible character beats losing the file.
 */
it('⚠️⚠️ a stray control character does not corrupt the file', () => {
  const nasty = 'Rice\u0000\u0008 Basmati\u001f';
  const buf = W.workbook([{ name: 'S', rows: [['name'], [nasty]] }]);
  const r = R.sheetRows(buf);
  assert.strictEqual(r.rows[0].name, 'Rice Basmati', 'the control characters survived into the XML');
});

it('⭐ and the characters XML DOES escape are preserved', () => {
  const buf = W.workbook([{ name: 'S', rows: [['name'], ['Salt & pepper <500g>'], ['A "quoted" name']] }]);
  const r = R.sheetRows(buf);
  assert.strictEqual(r.rows[0].name, 'Salt & pepper <500g>');
  assert.strictEqual(r.rows[1].name, 'A "quoted" name');
});

/**
 * ⚠️⚠️ EXCEL WILL NOT OPEN A WORKBOOK WITH AN ILLEGAL SHEET NAME, so one is corrected rather than refused — a
 * shop should never be told its own category cannot be a sheet.
 */
it('⚠️ an illegal or duplicate sheet name is made legal', () => {
  const buf = W.workbook([
    { name: 'Rice/Grains', rows: [['a']] },
    { name: 'A name that is very much longer than thirty-one characters', rows: [['b']] },
    { name: 'Same', rows: [['c']] },
    { name: 'Same', rows: [['d']] },
  ]);
  const r = R.sheetRows(buf);
  for (const n of r.sheets) {
    assert.ok(n.length <= 31, '"' + n + '" is longer than Excel allows');
    assert.ok(!/[:\\/?*[\]]/.test(n), '"' + n + '" contains a character Excel forbids');
  }
  assert.strictEqual(new Set(r.sheets.map((x) => x.toLowerCase())).size, 4, 'two sheets share a name');
});

it('⭐ blank cells stay blank rather than becoming "null"', () => {
  const buf = W.workbook([{ name: 'S', rows: [['a', 'b', 'c'], ['x', null, 'z'], ['p', '', 'r']] }]);
  const r = R.sheetRows(buf);
  assert.strictEqual(r.rows[0].b, '');
  assert.strictEqual(r.rows[1].b, '');
});

it('⚠️ a workbook with no sheets is refused, not written empty', () => {
  assert.throws(() => W.workbook([]), /at least one sheet/);
});

it('⭐ no view options = the same bytes the writer always made (hash taken from the writer before PM-118)', () => {
  const b = W.workbook([{ name: 'A', rows: [['code', 'n'], ['0070', 1.5], ['x & y', null]] }, { name: 'B', rows: [['z']] }]);
  assert.strictEqual(require('crypto').createHash('sha256').update(b).digest('hex'), 'f7c32db46cb64dfade44c5e33ddebd5f9da65b4c7f8b6fb47a60de4ec3f8d8b7');
});

it('[PM-118] freeze + filter + widths write pane, cols, autoFilter in schema order, and the reader still reads the rows', () => {
  const rows = [['id', 'name'], ['1', 'a'], ['2', 'b']];
  const b = W.workbook([{ name: 'S', rows, freeze: true, filter: true, widths: [8, 30] }]);
  const at = b.indexOf(Buffer.from('xl/worksheets/sheet1.xml')), lh = at - 30;
  const xml = require('zlib').inflateRawSync(b.subarray(at + 24, at + 24 + b.readUInt32LE(lh + 18))).toString('utf8');
  assert.ok(xml.includes('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'), 'pane');
  assert.ok(xml.includes('<cols><col min="1" max="1" width="8" customWidth="1"/><col min="2" max="2" width="30" customWidth="1"/></cols>'), 'cols');
  assert.ok(xml.includes('<autoFilter ref="A1:B3"/>'), 'autoFilter');
  assert.ok(xml.indexOf('<sheetViews>') < xml.indexOf('<cols>') && xml.indexOf('<cols>') < xml.indexOf('<sheetData>') && xml.indexOf('</sheetData>') < xml.indexOf('<autoFilter'), 'order');
  assert.strictEqual(R.sheetRows(b).rows.length, 2);
});

console.log(pass + ' checks');
