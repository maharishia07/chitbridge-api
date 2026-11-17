'use strict';
/* sec-61-row-escaping.test.cjs — SEC-61: THE CHIT LIST'S ROW CELLS ESCAPE WHAT THE API SENDS (subject code · party / sender · kind).
 * OWNS      the web half of SEC-61 (stored XSS in the row renderer). The old rowHTML in app.html is gone; the list rows are drawn by CBList (public/app/list-ctl.js:
 *           cellOf → esc unless a column says html:true) from the columns app.html's LISTCOLS hands it. The backlog's "CBCatUI.rowHTML app.html:11384" is the cart's
 *           catalogue row, a different renderer; this test names the real one. Runs the REAL esc (helpers.js), the REAL cellOf and the REAL LISTCOLS in a vm sandbox.
 * CALLED BY .github/workflows/ci.yml (web guards) · e2e/sec-proofs.red.cjs (mutants)
 * FLOW      lift esc · cellOf · LISTCOLS → feed <img onerror> / <script> / <svg onload> / "> through code · party · sender · via · kind → no raw tag in the HTML
 * Run: node e2e/sec-61-row-escaping.test.cjs */
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let n = 0;
const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };

function lift(src, startRe, endMarker, label) {
  const s = src.search(startRe);
  assert(s >= 0, label + ': start not found');
  const e = src.indexOf(endMarker, s);
  assert(e > s, label + ': end not found');
  return src.slice(s, e + endMarker.length);
}
const esc = lift(read('public/app/helpers.js'), /^function esc\(/m, '\n}\n', 'esc');
const cellOf = lift(read('public/app/list-ctl.js'), /^ {2}function cellOf\(/m, '\n  }\n', 'cellOf');
const listcols = lift(read('public/app.html'), /^const LISTCOLS = \[/m, '\n];\n', 'LISTCOLS').replace(/^const LISTCOLS/, 'var LISTCOLS');

const cx = vm.createContext({
  console, UI: { folder: 'inbox' }, tx: (s) => s, safe: (f, d) => { try { return f(); } catch (e) { return d; } },
  attnFlag: () => '', cancelFlag: () => '', billChipHTML: () => '', statusChip: () => '', priChip: () => '', fmtMoney: (v) => String(v), lcDate: (v) => String(v), cap: (s) => s
});
vm.runInContext(esc + '\n' + cellOf + '\n' + listcols, cx);
const cols = vm.runInContext('LISTCOLS', cx);
const col = (k) => cols.find((c) => c.key === k);
const BAD = /<(img|script|svg|iframe|u|style)\b|["']\s*on\w+\s*=|<\/script/i;   /* a live tag, or a quote that lets an on*= attribute out ("onerror=" as inert text is fine) */
const P = { img: '<img src=x onerror=alert(1)>', script: '<script>alert(2)</script>', svg: '<svg onload=alert(3)>', brk: '"><iframe src=javascript:1>" onmouseover="1', u: '<u>' };

ok(cols.length >= 15 && col('subject') && col('from') && col('type'), 'LISTCOLS lifted from app.html: ' + cols.length + ' columns incl. from, subject, type');
const row = { code: P.img, party: P.u + 'Acme', sender: P.script, kind: P.svg, via: { channel: 'whatsapp', from_name: P.brk, sender_verified: false }, unread: true, isDraft: true };

cx.UI.folder = 'inbox';
let h = col('subject').cell(row);
ok(!BAD.test(h) && h.includes('&lt;img src=x onerror=alert(1)&gt;'), 'subject cell: the code is text — <img onerror> arrives as &lt;img…&gt;, no live tag');
h = col('from').cell(row);
ok(!BAD.test(h) && h.includes('&quot;&gt;&lt;iframe'), 'from cell (a channel chit): the sender name is text — "><iframe is escaped');
h = col('from').cell(Object.assign({}, row, { via: null }));
ok(!BAD.test(h) && h.includes('&lt;script&gt;'), 'from cell (own chit): the sender is text — <script> is escaped');
cx.UI.folder = 'order';
h = col('from').cell(row);
ok(!BAD.test(h) && h.includes('&lt;u&gt;Acme'), 'from cell (order folder): the party name is text — <u> is escaped');
h = col('type').cell(row);
ok(!BAD.test(h) && h === '&lt;svg onload=alert(3)&gt;', 'type cell: the kind is text — <svg onload> is escaped');

/* CBList's own cell reader: a column that does not say html:true is escaped even if its cell() forgot to */
cx.col = { cell: () => P.img }; cx.col2 = { cell: () => P.img, html: true }; cx.row = {};
const plain = vm.runInContext('cellOf(null, col, row)', cx), trusted = vm.runInContext('cellOf(null, col2, row)', cx);
ok(!BAD.test(plain) && plain.startsWith('&lt;img'), 'CBList cellOf: a plain column is escaped by the renderer itself (second line of defence)');
ok(trusted === P.img, 'CBList cellOf: only html:true passes markup through (by design — the cell then owns esc)');
console.log('\n' + n + ' checks, all ok');
