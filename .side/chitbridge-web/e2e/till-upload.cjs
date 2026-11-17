/* till-upload.cjs — A PRODUCT LIST, READ BEFORE IT BECOMES DATA ([TILL-108])
 *
 * Athi: *"do the upload screen with the preflight report."*
 *
 * ⚠️⚠️ THE REPORT IS THE FEATURE. csv-preflight exists because the old import regex-matched two columns and
 * took every other header verbatim — so `Rate`, `Price (INR)`, `Unit Price` and `price` became four different
 * fields on four different products. A screen that mapped silently would rebuild that bug behind a progress
 * bar, so what is asserted here is mostly what the screen ASKS and what it REFUSES.
 *
 * ⭐ THE FIXTURE IS NOT HAND-WRITTEN. The report injected below is produced by running the real
 * lib/csv-preflight over a real messy sheet, so this harness cannot drift into testing a shape the server
 * stopped returning.
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const SHOTS = process.argv.includes('--shots');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log(String(l).padEnd(28) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

/* ⚠️ a spreadsheet as the world writes one: Tally's words, a rupee prefix, a column we have never heard of,
   and two rows that cannot be sold. */
const SHEET = [
  'Particulars,Rate (INR),UOM,Group,Fridge shelf',
  'Tomato,40,Kg,Vegetables,A1',
  'Onion,Rs 30,kg,Vegetables,A2',
  ',55,kg,Vegetables,A3',          /* no name */
  'Beans,abc,kg,Vegetables,A4',    /* not a number */
].join('\n');

/* the REAL report, from the real module — never a shape invented here */
const PF = require(path.join(__dirname, '..', '..', 'chitbridge-api', 'lib', 'csv-preflight'));
const CSVLIB = require(path.join(__dirname, '..', '..', 'chitbridge-api', 'lib', 'csv'));
function reportFor(text) {
  const parsed = CSVLIB.parseCSV(text);
  const rows = parsed.rows.map((r) => parsed.headers.map((h) => r[h]));
  const template = { columns: ['name', 'price', 'unit', 'category', 'sku'], optional: ['category', 'sku'] };
  return { ok: true, accepted: template.columns, dry_run: true,
    report: PF.preflight({ headers: parsed.headers, rows, template,
      labels: { name: 'Name', price: 'Price', unit: 'Unit', category: 'Category', sku: 'Code' },
      required: ['name', 'price'] }) };
}

(async () => {
  const srv = http.createServer((q, r) => {
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const f = path.join(ROOT, rel);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, r));
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await p.goto('http://127.0.0.1:' + srv.address().port + '/till.html');
  await p.waitForFunction(() => typeof window.screenSet === 'function', null, { timeout: 30000 });

  const dirty = reportFor(SHEET);
  /**
   * ⭐ the two readings of the SAME titled file, both from the real preflight: once as the reader takes it
   * (the title as headings) and once told the headings are on row 3.
   */
  const TITLED_TEXT = ['Anbu Vegetables — price list', 'as at 19 September',
                       'Particulars,Rate (INR),UOM', 'Tomato,40,Kg', 'Onion,Rs 30,kg'].join('\n');
  const headReport1 = Object.assign(reportFor(TITLED_TEXT), { header_row: 1, preview: [
    { row: 1, cells: ['Anbu Vegetables — price list'] }, { row: 2, cells: ['as at 19 September'] },
    { row: 3, cells: ['Particulars', 'Rate (INR)', 'UOM'] }, { row: 4, cells: ['Tomato', '40', 'Kg'] } ] });
  const headReport3 = Object.assign(
    reportFor(['Particulars,Rate (INR),UOM', 'Tomato,40,Kg', 'Onion,Rs 30,kg'].join('\n')),
    { header_row: 3, preview: headReport1.preview });
  console.log('  (the real preflight found ' + dirty.report.summary.errors + ' bad rows of '
    + dirty.report.summary.rows + ', and could not place ' + (dirty.report.unmatched || []).length + ' column)');

  await p.evaluate(() => {
    window.S = { shop: { name: 'A new shop', currency: 'INR', country: 'IN' }, items: [], offers: [], at: new Date().toISOString() };
    setMode('sell'); applyLook();
  });

  /* ══ the file is read and the report is shown ═════════════════════════════════════════════════════════ */
  console.log('\n── a messy spreadsheet ' + '─'.repeat(38));
  const shown = await p.evaluate(async ({ text, rep }) => {
    window.HOST.tillPost = async (pathname, body) => {
      window.__sent = { pathname, body };
      return pathname.indexOf('preflight') >= 0 ? rep : { ok: true, message: '2 products added' };
    };
    await upRead(new File([text], 'shop.csv', { type: 'text/csv' }));
    const sels = [...document.querySelectorAll('#upbody select')].map((s) => ({
      inc: s.getAttribute('data-inc'), val: s.value, ask: s.classList.contains('ask') }));
    return {
      open: document.getElementById('updlg').open,
      head: (document.querySelector('[data-testid="till-upload-head"]') || { innerText: '' }).innerText,
      sels,
      rows: (document.querySelector('[data-testid="till-upload-rows"]') || { innerText: '' }).innerText,
      go: document.getElementById('upgo').disabled,
      sayText: document.getElementById('upsay').innerText,
      sentTo: (window.__sent || {}).pathname,
    };
  }, { text: SHEET, rep: dirty });

  say('it reads the file', shown.open && shown.sentTo === '/api/products/import/preflight',
    'sent to ' + shown.sentTo);
  /* ⭐ the headline is what will HAPPEN, not a status code */
  say('the headline is plain', /2 of 4 rows can be added/.test(shown.head.replace(/\s+/g, ' ')),
    '"' + shown.head.replace(/\s+/g, ' ') + '"');

  /* ⚠️⚠️ THE MAPPING IS SHOWN IN FULL, including the confident ones — hiding those is how a wrong confident
     match goes unnoticed, which is the bug csv-preflight was written for. */
  const byInc = {};
  shown.sels.forEach((s) => { byInc[s.inc] = s; });
  say('every column is shown', shown.sels.length === 5, shown.sels.map((s) => s.inc + '→' + (s.val || '·')).join('  '));
  say('Tally\'s words are placed', byInc['Particulars'].val === 'name' && byInc['Rate (INR)'].val === 'price'
    && byInc['Group'].val === 'category' && byInc['UOM'].val === 'unit', 'Particulars · Rate (INR) · UOM · Group');
  /* ⭐ AND THE ONE WE CANNOT PLACE IS A QUESTION, not a silent drop */
  say('the unknown one is asked', byInc['Fridge shelf'].val === '' && byInc['Fridge shelf'].ask,
    '"Fridge shelf" is marked for an answer rather than dropped');

  /* ══ and it refuses to import half a file ═════════════════════════════════════════════════════════════ */
  say('bad rows are named', /Row 4/.test(shown.rows) && /Row 5/.test(shown.rows),
    '"' + shown.rows.replace(/\s+/g, ' ').slice(0, 90) + '"');
  /**
   * ⚠️⚠️⚠️ THE WHOLE FILE GOES IN OR NONE OF IT DOES. The route refuses while any row is in error, on purpose —
   * *"rather than importing 'the good ones' and leaving a person to work out which lines are missing."*
   */
  say('it will not add a part', shown.go === true, 'the button is disabled: "' + shown.sayText + '"');

  /* ══ a clean file, and the axiom still gates it ═══════════════════════════════════════════════════════ */
  console.log('\n── a clean spreadsheet ' + '─'.repeat(38));
  const CLEAN = ['Particulars,Rate (INR),UOM,Group', 'Tomato,40,Kg,Vegetables', 'Onion,Rs 30,kg,Vegetables'].join('\n');
  const clean = reportFor(CLEAN);
  const ok2 = await p.evaluate(async ({ text, rep }) => {
    window.HOST.tillPost = async (pathname, body) => {
      window.__sent = { pathname, body };
      return pathname.indexOf('preflight') >= 0 ? rep : { ok: true, message: '2 products added' };
    };
    await upRead(new File([text], 'clean.csv', { type: 'text/csv' }));
    const before = document.getElementById('upgo').disabled;
    /* ⚠️ now take the PRICE away and watch it refuse — the axiom is a gate, not a suggestion */
    const sel = document.querySelector('#upbody select[data-inc="Rate (INR)"]');
    sel.value = ''; upDecide(sel);
    return { before, afterDropPrice: document.getElementById('upgo').disabled,
             said: document.getElementById('upsay').innerText };
  }, { text: CLEAN, rep: clean });
  say('a clean file may go in', ok2.before === false, 'the button is live');
  say('the axiom is a gate', ok2.afterDropPrice === true && /price/i.test(ok2.said),
    'dropping the price column disables it: "' + ok2.said + '"');

  /* ══ what is actually sent ════════════════════════════════════════════════════════════════════════════ */
  console.log('\n── committing ' + '─'.repeat(47));
  const sent = await p.evaluate(async () => {
    const sel = document.querySelector('#upbody select[data-inc="Rate (INR)"]');
    sel.value = 'price'; upDecide(sel);
    await upCommit();
    return { sent: window.__sent, open: document.getElementById('updlg').open };
  });
  const body = (sent.sent || {}).body || {};
  say('it commits to the import', (sent.sent || {}).pathname === '/api/products/import', (sent.sent || {}).pathname);
  /* ⚠️ THE FILE AND THE DECISIONS TRAVEL, never the page's parsed rows — the route re-reads it itself because
     "the client's report is a display artifact and is never trusted". */
  say('it sends the file itself', typeof body.csv === 'string' && body.csv.indexOf('Particulars') === 0,
    'the raw csv, so the server re-reads it');
  say('and a decision per column', Array.isArray(body.decisions) && body.decisions.length === 4
    && body.decisions.every((d) => d.incoming && d.action), JSON.stringify(body.decisions));
  say('no parsed rows are sent', !body.products && !body.rows && !body.items, 'the page never decides what a row means');
  /* ⚠️ the route refuses anything that is not explicitly confirmed */
  say('it is explicitly confirmed', body.confirm === true, 'confirm:true');
  say('the dialog closes', !sent.open, 'the shopkeeper is returned to the counter');

  /* ══ ⭐⭐⭐ AN EXCEL FILE, THE SAME WAY ([TILL-109]) ══════════════════════════════ */
  console.log('\n── the same list as a workbook ' + '─'.repeat(33));
  /**
   * ⚠️ A REAL .xlsx, built byte by byte by the SAME fixture the reader's own test uses. There is no
   * spreadsheet library in this project — that is the point of lib/xlsx-read — so the fixture is shared
   * rather than written twice.
   */
  const XBOOK = require(path.join(__dirname, '..', '..', 'chitbridge-api', 'tests', 'xlsx-fixture.cjs')).book([
    ['Particulars', 'Rate (INR)', 'UOM', 'Group'],
    ['Tomato', 40, 'Kg', 'Vegetables'],
    ['தக்காளி', 45, 'kg', 'Vegetables'],
  ], { sheets: ['Products', 'Notes'] });

  const xl = await p.evaluate(async ({ b64 }) => {
    window.HOST.tillPost = async (pathname, body) => {
      window.__sent = { pathname, body };
      if (pathname.indexOf('preflight') < 0) return { ok: true, message: '2 products added' };
      return { ok: true, accepted: ['name', 'price', 'unit', 'category'],
        sheet: 'Products', sheets: ['Products', 'Notes'],
        report: { summary: { rows: 2, importable: 2, errors: 0, warnings: 0 }, issues: [], ready: true,
          mapping: [{ incoming: 'Particulars', canonical: 'name', why: 'a common name for name' },
                    { incoming: 'Rate (INR)', canonical: 'price', why: 'a common name for price' },
                    { incoming: 'UOM', canonical: 'unit', why: 'a common name for unit' },
                    { incoming: 'Group', canonical: 'category', why: 'a common name for category' }] } };
    };
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const f = new File([bin], 'prices.xlsx',
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await upRead(f);
    return { sent: window.__sent, go: document.getElementById('upgo').disabled,
             sheetNote: (document.querySelector('[data-testid="till-upload-sheet"]') || { innerText: '' }).innerText,
             head: (document.querySelector('[data-testid="till-upload-head"]') || { innerText: '' }).innerText };
  }, { b64: XBOOK.toString('base64') });

  /**
   * ⚠️⚠️ A WORKBOOK IS BINARY. Reading it with .text() the way a .csv is read would mangle it past
   * recognition and the server would report a damaged file — so it must travel as base64, and the CSV must
   * keep travelling as text.
   */
  say('a workbook goes as base64', !!(xl.sent && xl.sent.body && xl.sent.body.xlsx && !xl.sent.body.csv),
    xl.sent && xl.sent.body ? ('keys: ' + Object.keys(xl.sent.body).join(', ')) : 'nothing was sent');
  /* ⚠️ and it must ARRIVE INTACT — base64 that decodes to something else is the silent version of this bug */
  const back = Buffer.from(String((xl.sent.body || {}).xlsx || ''), 'base64');
  say('and it arrives intact', back.length === XBOOK.length && back[0] === 0x50 && back[1] === 0x4b,
    back.length + ' bytes, same as the file, starting PK');
  say('the report is shown', /2 of 2 rows can be added/.test(xl.head.replace(/\s+/g, ' ')),
    '"' + xl.head.trim() + '"');
  /* ⭐ a workbook with more than one sheet says WHICH it read, and what else was in there */
  say('it names the sheet read', /Products/.test(xl.sheetNote) && /Notes/.test(xl.sheetNote),
    '"' + xl.sheetNote.replace(/\s+/g, ' ').slice(0, 84) + '"');
  /* ══ ⭐⭐⭐ "MY HEADINGS ARE ON ROW ___" ([TILL-110]) ═════════════════════════════ */
  console.log('\n── a list that opens with the shop name ' + '─'.repeat(24));
  const TITLED = ['Anbu Vegetables — price list', 'as at 19 September',
                  'Particulars,Rate (INR),UOM', 'Tomato,40,Kg', 'Onion,Rs 30,kg'].join('\n');

  const head = await p.evaluate(async ({ text, first, second }) => {
    const seen = [];
    window.HOST.tillPost = async (pathname, body) => {
      seen.push(body);
      if (pathname.indexOf('preflight') < 0) return { ok: true, message: '2 products added' };
      /* ⚠️ the server answers differently depending on the row asked for — which is the whole point */
      return Number(body.header_row) === 3 ? second : first;
    };
    await upRead(new File([text], 'list.csv', { type: 'text/csv' }));
    const before = [...document.querySelectorAll('#upbody select[data-inc]')].map((s) => s.getAttribute('data-inc'));
    const pick = document.querySelector('[data-testid="till-headrow"]');
    const options = [...pick.options].map((o) => o.text);
    pick.value = '3';
    await upHeadRow('3');
    const after = [...document.querySelectorAll('#upbody select[data-inc]')].map((s) => s.getAttribute('data-inc'));
    await upCommit();
    return { options, before, after, seen, selected: (document.querySelector('[data-testid="till-headrow"]') || {}).value };
  }, { text: TITLED, first: headReport1, second: headReport3 });

  /* ⭐ the rows are offered AS THEY READ, not as a number to count to */
  say('the rows are offered', head.options.length >= 3 && /Anbu Vegetables/.test(head.options[0]),
    '"' + head.options.slice(0, 2).join('" / "') + '"');
  say('it read the title first', head.before.indexOf('Anbu Vegetables — price list') >= 0,
    'columns were: ' + head.before.join(', '));
  /* ⚠️⚠️ picking a row RE-READS THE FILE on the server — the page holds no parse of its own */
  say('picking a row re-reads it', head.seen.length >= 2 && Number(head.seen[1].header_row) === 3,
    'the second request carried header_row ' + (head.seen[1] || {}).header_row);
  say('and the columns change', head.after.indexOf('Particulars') >= 0 && head.after.indexOf('Anbu Vegetables — price list') < 0,
    'columns are now: ' + head.after.join(', '));
  /**
   * ⚠️⚠️⚠️ AND THE COMMIT CARRIES IT. Without header_row on the commit the server would re-read from row 1
   * and import against headings nobody approved — a silent mismatch between the report and what was written.
   */
  const committed = head.seen[head.seen.length - 1] || {};
  say('the commit sends the row', Number(committed.header_row) === 3 && committed.confirm === true,
    'header_row ' + committed.header_row + ', confirm ' + committed.confirm);

  if (SHOTS) {
    /* ⭐ the titled file, so the picture shows the heading-row control doing its job ([TILL-110]) */
    await p.evaluate(async ({ text, rep }) => {
      window.HOST.tillPost = async () => rep;
      await upRead(new File([text], 'price list.csv', { type: 'text/csv' }));
    }, { text: TITLED_TEXT, rep: headReport1 });
    const out = path.join(__dirname, '..', 'png', 'Upload.png');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await p.screenshot({ path: out });
    console.log('  shot                        · png/Upload.png');
  }

  await b.close(); srv.close();
  console.log(bad ? '\n' + bad + ' failed' : '\nthe file is read, the report is approved, and only then is anything added');
  process.exit(bad ? 1 : 0);
})();
