'use strict';
// @type: unit
/**
 * ui-codes-sweep.test.cjs - UX-137 sweep (15 Nov): the controls the census still listed after every open wave-2 PR now wear their identity codes.
 *
 * OWNS      the proof that 13 controls of app.html, app/cap-workforce.js, app/pick.js and app/shortcuts.js carry their data-cbsid, each INSIDE the tag of the control it names
 *           (a removed code, a code moved to another kind of tag, or a swap of two codes whose handlers differ fails it), that the codes of one file stand in FILE ORDER
 *           (the numbers the stamp tool mints follow reading order, so a number that runs against the file means a hand edit), that no code sits on two elements,
 *           and that every code (these 13 and the 18 the books-access and network scripts already wore) is a live row in the register UIID_REG names.
 * CALLED BY by hand and the QA gate: node e2e/ui-codes-sweep.test.cjs   (SWEEP_MUTATE=remove or swap must fail it)
 * FLOW      read each script, find each code, read from the '<' before it to the next '>' and compare with the marker of the control it names, then order, then the register
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 * Register  codes are looked up in UIID_REG, else ../chitbridge-docs/SCREENS.json, else C:/dev/SCREENS.json; with UIID_REG set a missing code FAILS, otherwise it is printed as pending.
 */
const fs = require('fs'), path = require('path');
const mutate = process.env.SWEEP_MUTATE || '';
const PUB = path.join(__dirname, '..', 'public');

/** [file, code, the tag it must sit in, a marker that tag carries]; the order inside one file IS the file order */
const CODES = [
  ['app.html', 'BUS001-I01', 'input', 'id="cu_add"'],
  ['app.html', 'BUS001-I02', 'input', 'id="cu_add_phone"'],
  ['app.html', 'CAT001-B23', 'button', 'class="badd"'],
  ['app.html', 'RAL002-B29', 'button', 'chitUnpay('],
  ['app.html', 'RAL002-B30', 'button', 'archiveSelected()'],
  ['app.html', 'RAL002-B31', 'button', 'confirmDelete()'],
  ['app.html', 'DTL001-B60', 'button', "amdView('main')"],
  ['app.html', 'DTL001-B61', 'button', 'amdStep(1)'],
  ['app/cap-workforce.js', 'BUS005-I10', 'input', 'class="inp"'],
  ['app/cap-workforce.js', 'BUS005-S06', 'select', 'class="inp"'],
  ['app/cap-workforce.js', 'BUS005-B23', 'button', 'awNext()'],
  ['app/pick.js', 'CMP003', 'button', 'CBPick.cancel()'],
  ['app/shortcuts.js', 'CMP005', 'button', 'class="pri"']
];
/** codes the books-access and network scripts already wore on the element; this PR gave them their register rows */
const ROWS_ONLY = [
  ['app/books-grant-member.js', ['NET004-B03', 'NET004-B04', 'NET004-B05', 'NET004-B06', 'NET004-B07', 'NET004-B08', 'NET004-B09', 'NET004-I01', 'NET004-I02', 'NET004-I03', 'NET004-I04', 'NET004-I05', 'NET004-S01']],
  ['app/books-grant-view.js', ['NET005-B01', 'NET005-B02', 'NET005-B10']],
  ['app/books-grant-reports.js', ['NET005-I01']],
  ['app/books-grant-drill.js', ['NET005-B04', 'NET005-B05']],
  ['app/network-app.js', ['NET001-B05']],
  ['app/network-books.js', ['NET001-B04']]
];

const read = (f) => {
  /* a code inside a double-quoted JS string is written escaped (data-cbsid=\"X\"): read the source as the tag it draws */
  let t = fs.readFileSync(path.join(PUB, f), 'utf8').split('\r\n').join('\n').split('\\"').join('"');
  if (mutate === 'remove') t = t.split('data-cbsid="BUS001-I01"').join('');
  if (mutate === 'swap') t = t.split('RAL002-B30').join('SWAPX').split('RAL002-B31').join('RAL002-B30').split('SWAPX').join('RAL002-B31');
  return t;
};
let failures = 0;
const check = (c, m) => { console.log((c ? '  ok ' : '  FAIL ') + m); if (!c) failures++; };
const src = {};
const text = (f) => (src[f] = src[f] || read(f));

/** the open tag around a code: from the '<' before it to the first '>' after it */
function tagAround(f, code) {
  const t = text(f), at = t.indexOf('data-cbsid="' + code + '"');
  if (at < 0) return null;
  const open = t.lastIndexOf('<', at), end = t.indexOf('>', at);
  return { name: (t.slice(open + 1, at).match(/^[a-z]+/) || [''])[0], body: t.slice(open, end + 1), at };
}
for (const [f, code, tag, marker] of CODES) {
  const found = tagAround(f, code);
  check(!!found && found.name === tag && found.body.indexOf(marker) >= 0, f + ' ' + code + ' sits in its own <' + tag + '> (' + marker + ')');
}
/* FILE ORDER: the codes of one file, in the order the file holds them, are the order of this list */
for (const f of [...new Set(CODES.map((c) => c[0]))]) {
  const want = CODES.filter((c) => c[0] === f).map((c) => c[1]);
  const got = want.map((code) => [code, (tagAround(f, code) || { at: -1 }).at]).filter((p) => p[1] >= 0).sort((a, b) => a[1] - b[1]).map((p) => p[0]);
  check(got.join() === want.join(), f + ' holds its codes in file order (' + want.join(' ') + ')');
  const byKind = {};
  want.filter((c) => /-[A-Z]\d{2}$/.test(c)).forEach((c) => { const k = c.slice(0, c.length - 2); (byKind[k] = byKind[k] || []).push(+c.slice(-2)); });
  check(Object.keys(byKind).every((k) => byKind[k].every((n, i, a) => i === 0 || n > a[i - 1])), f + ' numbers rise with the file position inside each screen and kind');
}
const seen = {};
for (const f of [...new Set(CODES.map((c) => c[0]).concat(ROWS_ONLY.map((r) => r[0])))]) {
  for (const m of text(f).matchAll(/data-cbsid="([A-Z]{3}\d{3}(?:-[A-Z]\d{2})?)"/g)) seen[m[1]] = (seen[m[1]] || 0) + 1;
}
for (const [f, codes] of ROWS_ONLY) codes.forEach((code) => check(!!tagAround(f, code), f + ' still carries ' + code + ' on its element'));
const dup = Object.keys(seen).filter((c) => seen[c] > 1 && !/^CMP/.test(c));
check(dup.length === 0, 'no screen code is written on two element definitions' + (dup.length ? ' (' + dup.join(',') + ')' : ''));

/** the register */
let reg = null;
for (const p of [process.env.UIID_REG, path.join(__dirname, '..', '..', 'chitbridge-docs', 'SCREENS.json'), 'C:/dev/SCREENS.json']) {
  if (p && fs.existsSync(p)) { try { reg = JSON.parse(fs.readFileSync(p, 'utf8')); break; } catch (e) { console.log('  register ' + p + ' not readable: ' + e.message); } }
}
if (reg) {
  const rows = {}; Object.values(reg.screens || {}).forEach((r) => { if (r.code) rows[r.code] = r; });
  const codes = CODES.map((c) => c[1]).concat([].concat(...ROWS_ONLY.map((r) => r[1]))), missing = codes.filter((c) => !rows[c]), retired = codes.filter((c) => rows[c] && rows[c].retired);
  console.log('  register: ' + (codes.length - missing.length) + ' of ' + codes.length + ' codes found' + (missing.length ? ' (pending until the docs PR lands: ' + missing.length + ')' : ''));
  if (process.env.UIID_REG) check(!missing.length, 'every code is in the register UIID_REG names (' + missing.length + ' missing)');
  check(retired.length === 0, 'no code is retired in the register');
}
console.log(failures ? failures + ' FAILED' : 'ALL PASS');
process.exit(failures ? 1 : 0);
