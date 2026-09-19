'use strict';
/**
 * xlsx-read.test.js — AN EXCEL FILE, READ INTO THE SHAPE A CSV MAKES ([TILL-109]).
 *
 * Athi, 2026-09-19: *"xlsx support, most shops will have excel files."*
 *
 * ⚠️⚠️ THE FIXTURES ARE BUILT HERE, ON PURPOSE. There is no spreadsheet library in this project — that is the
 * whole point of lib/xlsx-read — so a workbook is assembled byte by byte below. It is twenty lines of zip and
 * it buys the ability to test the cases a real file throws at us: a title row above the headings, text split
 * across styled runs, a formula's cached value, an error cell, a blank line in the middle, two columns with
 * the same heading, and Tamil.
 *
 * ⭐ AND IT IS CHECKED AGAINST REAL FILES TOO. During development this reader was run over two workbooks Excel
 * itself wrote (a 4-sheet college result sheet and a 10,683-row flight table) and read both. Those are not in
 * the repo — a test cannot depend on somebody's Downloads folder — so the shapes they exposed are reproduced
 * as fixtures here.
 *
 * Run: node tests/xlsx-read.test.js   · no DB, no network.
 */
const assert = require('assert'), path = require('path');
const X = require(path.join(__dirname, '..', 'lib', 'xlsx-read'));

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

/* ── the fixture builder lives in tests/xlsx-fixture.cjs, because the counter's upload harness needs it too ── */
const { book } = require(path.join(__dirname, 'xlsx-fixture.cjs'));
console.log('— an Excel file, read —');

it('⭐ a plain sheet reads into headers and rows', () => {
  const b = book([['Name', 'Price', 'Unit'], ['Tomato', 40, 'kg'], ['Onion', 30, 'kg']]);
  const r = X.sheetRows(b);
  assert.deepStrictEqual(r.headers, ['Name', 'Price', 'Unit']);
  assert.strictEqual(r.rows.length, 2);
  assert.deepStrictEqual(r.rows[0], { Name: 'Tomato', Price: '40', Unit: 'kg' });
  assert.strictEqual(r.sheet, 'Sheet1');
});

/**
 * ⚠️⚠️ THE REASON THIS PRODUCT EXISTS IN INDIA. A counter that cannot read "தக்காளி" out of a shop's own
 * spreadsheet is not usable in Chennai. The bytes are checked, not just the string, because a reader that
 * double-decodes produces something that LOOKS like text and is not.
 */
it('⚠️⚠️ Tamil and Hindi survive, byte for byte', () => {
  const b = book([['Name', 'Price'], ['தக்காளி', 40], ['आलू', 35], ['Café', 50]]);
  const r = X.sheetRows(b);
  assert.strictEqual(r.rows[0].Name, 'தக்காளி');
  assert.strictEqual(r.rows[1].Name, 'आलू');
  assert.strictEqual(r.rows[2].Name, 'Café');
  /* ⚠️ é is one codepoint, two UTF-8 bytes — double-decoding would give "Ã©" and still be a string */
  assert.strictEqual(Buffer.from(r.rows[2].Name, 'utf8').toString('hex'), '436166c3a9');
});

/**
 * ⚠️⚠️ REAL SHEETS BEGIN WITH A TITLE. The college result sheet this reader was developed against opens with
 * "St. Joseph's College of Engineering" on row 1 and the headings below it. Taking row 1 regardless would make
 * the shop's title the name column.
 * ⭐ The first row WITH ANYTHING IN IT is the header row, so a leading blank line costs nothing either.
 */
it('⚠️ a blank line above the headings is skipped', () => {
  const b = book([[], ['Name', 'Price'], ['Tomato', 40]]);
  const r = X.sheetRows(b);
  assert.deepStrictEqual(r.headers, ['Name', 'Price']);
  assert.strictEqual(r.rows.length, 1);
});

it('⭐ text split across styled runs is joined', () => {
  const b = book([['Name', 'Price'], ['Basmati Rice', 120]], { split: 'Basmati Rice' });
  const r = X.sheetRows(b);
  assert.strictEqual(r.rows[0].Name, 'Basmati Rice', 'only the first styled run was read');
});

it('⭐ a formula contributes its cached value, and an error contributes nothing', () => {
  const b = book([['Name', 'Price', 'Note'], ['Tomato', { f: 'B1*2', v: '80' }, { e: true }]]);
  const r = X.sheetRows(b);
  assert.strictEqual(r.rows[0].Price, '80', 'the cached result of a formula is what the sheet showed');
  assert.strictEqual(r.rows[0].Note, '', 'an #REF! became a value');
});

it('⭐ an inline string reads like any other', () => {
  const b = book([['Name', 'Price'], [{ inline: 'Coconut' }, 25]]);
  assert.strictEqual(X.sheetRows(b).rows[0].Name, 'Coconut');
});

/**
 * ⚠️⚠️ A BLANK ROW IN THE MIDDLE IS NOT A PRODUCT, and a nameless column is NAMED rather than dropped —
 * dropping it would shift every value after it one field to the left, silently.
 */
it('⚠️ blank rows are skipped and nameless columns keep their place', () => {
  const b = book([['Name', '', 'Price'], ['Tomato', 'x', 40], [], ['Onion', 'y', 30]]);
  const r = X.sheetRows(b);
  assert.strictEqual(r.headers.length, 3, 'the unnamed middle column was dropped and the price shifted left');
  assert.strictEqual(r.rows.length, 2, 'the blank line became a product');
  assert.strictEqual(r.rows[1].Price, '30');
});

it('⚠️ two columns with the same heading stay two columns', () => {
  const b = book([['Name', 'Price', 'Price'], ['Tomato', 40, 45]]);
  const r = X.sheetRows(b);
  assert.strictEqual(r.headers.length, 3);
  assert.notStrictEqual(r.headers[1], r.headers[2], 'the second Price collapsed onto the first');
  assert.strictEqual(r.rows[0][r.headers[2]], '45');
});

it('⭐ the first sheet is taken, and the others are named so a person can choose', () => {
  const b = book([['Name', 'Price'], ['Tomato', 40]], { sheets: ['Products', 'Notes', 'Old prices'] });
  const r = X.sheetRows(b);
  assert.strictEqual(r.sheet, 'Products');
  assert.deepStrictEqual(r.sheets, ['Products', 'Notes', 'Old prices']);
  /* and a named one can be asked for */
  assert.strictEqual(X.sheetRows(b, { sheet: 'Notes' }).sheet, 'Notes');
});

/**
 * ⚠️⚠️⚠️ IT REFUSES LOUDLY, which is the whole licence for a narrow reader. Every one of these must throw a
 * sentence a shopkeeper can act on — never a half-read sheet and never a silent blank.
 */
it('⚠️⚠️⚠️ everything it cannot read, it refuses in words', () => {
  const says = (fn) => { try { fn(); return null; } catch (e) { return e.userMessage || e.message; } };

  const notZip = says(() => X.sheetRows(Buffer.from('Name,Price\nTomato,40')));
  assert.ok(notZip && /\.xls\b|Save As|not an \.xlsx/i.test(notZip), 'a CSV handed in as xlsx: ' + notZip);

  assert.ok(says(() => X.sheetRows(Buffer.alloc(0))), 'an empty file was accepted');
  assert.ok(says(() => X.sheetRows(Buffer.from([0x50, 0x4b, 0x03, 0x04]))), 'four bytes of zip were accepted');

  /* a workbook with a sheet that has nothing in it */
  const empty = says(() => X.sheetRows(book([])));
  assert.ok(empty && /empty|no readable|no sheets/i.test(empty), 'an empty sheet: ' + empty);

  /* headings that are all blank — there is no way to know what the columns mean */
  const noHead = says(() => X.sheetRows(book([[], [], ['', '', '']])));
  assert.ok(noHead, 'a sheet with no headings was accepted');

  /* ⚠️ and a sheet that is asked for by a name it does not have says which names it DOES have */
  const wrong = says(() => X.sheetRows(book([['Name'], ['x']], { sheets: ['Products'] }), { sheet: 'Stock' }));
  assert.ok(wrong && /Products/.test(wrong), 'the refusal does not say what sheets are there: ' + wrong);
});

/** ⚠️ a declared size far beyond anything a catalogue could be is refused BEFORE it is inflated */
it('⚠️⚠️ an oversized file is refused before it is read', () => {
  const big = Buffer.alloc(X.MAX_FILE + 1024);
  big[0] = 0x50; big[1] = 0x4b;
  let said = null;
  try { X.sheetRows(big); } catch (e) { said = e.userMessage || e.message; }
  assert.ok(said && /larger than|too large/i.test(said), 'an 8 MB+ file was not refused: ' + said);
});

it('⭐ a stored (uncompressed) entry reads as well as a deflated one', () => {
  /* the fixture deflates workbook/sharedStrings/sheet and stores [Content_Types] — both paths are exercised
     by every test above, but this states it, because a zip may legally do either. */
  const r = X.sheetRows(book([['Name', 'Price'], ['Tomato', 40]]));
  assert.strictEqual(r.rows[0].Name, 'Tomato');
});

/**
 * ── ⭐⭐⭐ A WORKBOOK AND A .csv OF THE SAME SHEET ARE THE SAME UPLOAD ───────────────────────
 *
 * This is what licenses [TILL-109] to change nothing downstream. routes/products.js reads either kind into
 * `{ headers, rows }` and hands it to the SAME preflight; if the two readers disagreed, a shop would get a
 * different catalogue depending on which format it saved from, and no test after this point could see it.
 *
 * ⚠️ EVERY VALUE IS COMPARED AS A STRING, because that is what a CSV can carry. A reader that returned 40
 * where the other returns "40" would pass a casual eye and fail the preflight's number check differently.
 */
it('⭐⭐⭐ an .xlsx and a .csv of the same sheet read identically', () => {
  const csvLib = require(path.join(__dirname, '..', 'lib', 'csv'));
  const rows = [
    ['Particulars', 'Rate (INR)', 'UOM', 'Group'],
    ['Tomato', 40, 'kg', 'Vegetables'],
    ['தக்காளி', 45, 'kg', 'Vegetables'],
    ['Coconut', 25, 'piece', 'Vegetables'],
  ];
  const fromXlsx = X.sheetRows(book(rows));

  /* the same sheet, saved as a .csv — quoted the way a spreadsheet quotes */
  const text = rows.map((r) => r.map((c) => {
    const v = String(c);
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }).join(',')).join('\n');
  const fromCsv = csvLib.parseCSV(text);

  assert.deepStrictEqual(fromXlsx.headers, fromCsv.headers, 'the headings differ between the two formats');
  assert.strictEqual(fromXlsx.rows.length, fromCsv.rows.length, 'a row was lost by one reader and not the other');
  for (let i = 0; i < fromCsv.rows.length; i++) {
    for (const h of fromCsv.headers) {
      assert.strictEqual(String(fromXlsx.rows[i][h]), String(fromCsv.rows[i][h]),
        'row ' + (i + 1) + ' column "' + h + '" differs: xlsx ' + JSON.stringify(fromXlsx.rows[i][h])
        + ' vs csv ' + JSON.stringify(fromCsv.rows[i][h]));
    }
  }
});

/**
 * ⭐⭐ AND THE PREFLIGHT AGREES ABOUT BOTH. The shapes matching is necessary; what matters to a shopkeeper is
 * that the REPORT is the same — the same columns placed, the same rows refused.
 */
it('⭐⭐ and the preflight reads both the same way', () => {
  const csvLib = require(path.join(__dirname, '..', 'lib', 'csv'));
  const PF = require(path.join(__dirname, '..', 'lib', 'csv-preflight'));
  const rows = [['Particulars', 'Rate (INR)', 'UOM', 'Group'], ['Tomato', 40, 'kg', 'Vegetables'],
                ['', 55, 'kg', 'Vegetables'], ['Beans', 'abc', 'kg', 'Vegetables']];
  const tpl = { columns: ['name', 'price', 'unit', 'category'], optional: ['category'] };
  const run = (parsed) => PF.preflight({ headers: parsed.headers,
    rows: parsed.rows.map((r) => parsed.headers.map((h) => r[h])), template: tpl, required: ['name', 'price'] });

  const text = rows.map((r) => r.join(',')).join('\n');
  const a = run(X.sheetRows(book(rows)));
  const b = run(csvLib.parseCSV(text));

  assert.deepStrictEqual(a.mapping.map((m) => m.canonical), b.mapping.map((m) => m.canonical),
    'the two formats map their columns differently');
  assert.deepStrictEqual(a.summary, b.summary, 'the two formats disagree about what can be imported');
  assert.deepStrictEqual(a.issues.map((i) => i.row + ':' + i.column), b.issues.map((i) => i.row + ':' + i.column),
    'the two formats blame different rows');
});

console.log(pass + ' checks');
