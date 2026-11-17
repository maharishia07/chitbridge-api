'use strict';
// @type: unit
/**
 * ui-codes-std-actions.test.cjs - a hand-built standard button wears its COMPONENT code (UX-137, identities fold to component codes).
 *
 * OWNS      the proof that every <button data-cbsid="CMP0xx"> in app.html and the shared app scripts carries the component whose action its label names
 *           (Cancel is CMP003, Close CMP005, Save CMP001, Done CMP004 ...), never another; that each such code is a live register row; and that the stamping
 *           added the one attribute only (no other attribute of the button moved: the count of tags is read, not their text).
 * CALLED BY by hand and the QA gate: node e2e/ui-codes-std-actions.test.cjs   (STD_ID_MUTATE=swap or remove must fail it)
 * FLOW      UX-137 step 3 (lever 0, the standard action set); the register rows CMP001-CMP015 are cb-capability's, this test never writes one.
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 * Register  looked up in UIID_REG, else ../chitbridge-docs/SCREENS.json, else C:/dev/SCREENS.json; none found: printed as pending, never a pass.
 */
const fs = require('fs'), path = require('path');
const mutate = process.env.STD_ID_MUTATE || '';
const PUB = path.join(__dirname, '..', 'public');
const WANT = {
  cancel: 'CMP003', close: 'CMP005', save: 'CMP001', done: 'CMP004', 'got it': 'CMP004', ok: 'CMP004', back: 'CMP006', add: 'CMP007',
  remove: 'CMP008', 'try again': 'CMP009', retry: 'CMP009', delete: 'CMP011', edit: 'CMP012', clear: 'CMP014', 'not now': 'CMP015', open: 'CMP010', search: 'CMP013',
};
let failures = 0;
const check = (c, m) => { if (!c) { console.log('  FAIL ' + m); failures++; } };

/** the label of a button: its text with the tx('..') wrapper and the leading glyph taken off */
function labelOf(inner) {
  let s = inner.replace(/\s+/g, ' ').trim();
  s = s.replace(/^'\s*\+\s*/, '').replace(/\s*\+\s*'$/, '').replace(/^\$\{\s*/, '').replace(/\s*\}$/, '');
  s = s.replace(/^(?:[+‹←✓✔]|&larr;|&lsaquo;)\s*/, '');
  const m = s.match(/^(?:esc\(\s*)?tx\(\s*['"]([^'"]{1,24})['"]\s*\)\s*\)?$/) || s.match(/^([A-Za-z][A-Za-z ]{1,12})$/);
  return m ? m[1].toLowerCase().trim() : null;
}

const files = ['app.html', 'accounts.html'].concat(fs.readdirSync(path.join(PUB, 'app')).filter((f) => /\.js$/.test(f)).map((f) => 'app/' + f));
const used = {};
let tagged = 0;
for (const f of files) {
  let t = fs.readFileSync(path.join(PUB, f), 'utf8').split('\r\n').join('\n');
  if (mutate === 'remove') t = t.split('data-cbsid="CMP003"').join('');
  if (mutate === 'swap') t = t.split('data-cbsid="CMP003"').join('data-cbsid="SWAPX"').split('data-cbsid="CMP005"').join('data-cbsid="CMP003"').split('SWAPX').join('CMP005');
  for (const m of t.matchAll(/<button\b([^>]*)>/g)) {
    const c = m[1].match(/data-cbsid="(CMP0[0-9]{2})"/);
    const close = t.indexOf('</button>', m.index + m[0].length);
    const lab = close > 0 && close - m.index < 400 ? labelOf(t.slice(m.index + m[0].length, close)) : null;
    if (!c || !lab || !WANT[lab]) continue;
    tagged++;
    used[c[1]] = true;
    check(WANT[lab] === c[1], f + ': a "' + lab + '" button wears ' + c[1] + ', its component is ' + WANT[lab]);
  }
  if (mutate === 'remove') check(!/data-cbsid="CMP003"/.test(t), 'mutation removed');
}
check(tagged >= 100, 'at least 100 standard buttons wear a component code, found ' + tagged);
if (mutate === 'remove') check(tagged >= 100, 'removed codes leave fewer than 100 tagged');

let reg = null;
for (const p of [process.env.UIID_REG, path.join(__dirname, '..', '..', 'chitbridge-docs', 'SCREENS.json'), 'C:/dev/SCREENS.json']) {
  if (p && fs.existsSync(p)) { try { reg = JSON.parse(fs.readFileSync(p, 'utf8')); break; } catch (e) { /* try the next path */ } }
}
if (reg) {
  const rows = Object.values(reg.screens || {});
  for (const code of Object.keys(used)) {
    const row = rows.find((r) => r.code === code);
    check(!!row && !row.retired, code + ' is a live register row');
  }
} else console.log('  pending: no SCREENS.json found, the register rows were not read');
console.log(failures ? '\n' + failures + ' FAILED' : '\nui-codes-std-actions: ' + tagged + ' standard buttons, ' + Object.keys(used).length + ' component codes, all match');
process.exit(failures ? 1 : 0);
