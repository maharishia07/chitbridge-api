/**
 * detail-chip-errwords.test.cjs - two small fixes from the SIT crawl of 11 Nov 2026.
 *
 * 1. errWords(): an answer whose message slot holds an OBJECT (RFC 9457 problem, {code,message}) must read as words, never
 *    "[object Object]" (Work > Intake). core.js apiOnce, cap-attach, cap-testing and the two CSV exports use it.
 * 2. The five detail screens (CAT005, BUS006, BUS007, BUS008, BUS009) name THEMSELVES through the one path the detail pane
 *    stamps with: screenInfo() -> codeScreenKey() -> the register. The register row must also say sub:true with the parent.
 * Run: node e2e/detail-chip-errwords.test.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const pub = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(pub, 'app.html'), 'utf8');
const core = fs.readFileSync(path.join(pub, 'app', 'core.js'), 'utf8');
let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL ') + m); if (!c) bad++; };
const grab = (src, name) => {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error(name + ' not found');
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && !--d) break; }
  return src.slice(i, j + 1);
};

/* 1 · error words */
const w = { }; vm.createContext(w); vm.runInContext(grab(core, 'errWords') + '\nthis.f = errWords;', w);
const f = w.f;
ok(f('plain') === 'plain', 'a string stays as it is');
ok(f({ detail: 'No intake table', title: 'Not migrated' }) === 'No intake table', 'RFC 9457: detail first');
ok(f({ title: 'Not migrated' }) === 'Not migrated', 'RFC 9457: title when no detail');
ok(f({ code: 'X', message: 'Could not read it' }) === 'Could not read it', '{code,message} reads its message');
ok(f({ error: { message: 'deep' } }) === 'deep', 'nested error reads through');
ok(f({ code: 'X' }) === '' && f(null) === '', 'nothing readable gives empty, so the caller falls back to its own sentence');
ok(f({ message: { detail: 'x' } }).indexOf('[object') < 0, 'never "[object Object]"');
ok(core.indexOf("msg = answerWords(j)") > 0, "apiOnce routes the body through answerWords");

/* 2 · the five detail chips */
const s = { window: {} }; vm.createContext(s);
vm.runInContext(fs.readFileSync(path.join(pub, 'app', 'screens.js'), 'utf8'), s);
s.cbScreenCode = s.window.cbScreenCode;
vm.runInContext(['navScreenKey', 'codeScreenKey', 'screenInfo', '_fineScreen'].map((n) => grab(html, n)).join('\n'), s);
const code = (ui) => { s.UI = ui; return vm.runInContext('screenInfo().code', s); };
const cases = [
  ['CAT005 product detail', { nav: 'catalogue', prodSel: 'p1' }, 'CAT005', 'CAT001'],
  ['BUS006 ERP cockpit', { nav: 'coassists', acSel: 'a', _connMap: { a: 'erp' } }, 'BUS006', 'BUS005'],
  ['BUS007 IoT cockpit', { nav: 'coassists', acSel: 'a', _connMap: { a: 'iot' } }, 'BUS007', 'BUS005'],
  ['BUS008 co-assist cockpit', { nav: 'coassists', acSel: 'a' }, 'BUS008', 'BUS005'],
  ['BUS009 supplier detail', { nav: 'suppliers', supSel: 's' }, 'BUS009', 'BUS002'],
  ['BUS009 with the certificates tab left on', { nav: 'suppliers', supSel: 's', supReq: true }, 'BUS009', 'BUS012']
];
for (const [n, ui, want, parent] of cases) {
  const got = code(ui);
  ok(got === want && got !== parent, n + ' shows ' + got + ' (not the list ' + parent + ')');
}
ok(code({ nav: 'suppliers' }) === 'BUS002', 'the Suppliers list keeps its own code');
console.log(bad ? '\n' + bad + ' FAILED' : '\nall passed');
process.exit(bad ? 1 : 0);
