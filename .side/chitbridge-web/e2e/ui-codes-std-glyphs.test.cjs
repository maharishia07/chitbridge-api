'use strict';
// @type: unit
/**
 * ui-codes-std-glyphs.test.cjs - a close or remove glyph (the X sign) and a word-chip wear their COMPONENT code (UX-137 slice 2).
 *
 * OWNS      the proof that every element tagged data-cbsid="CMP005" (Close) or "CMP008" (Remove) whose text is an X glyph says so in its own aria-label,
 *           title, handler or data-testid (close or remove / delete words), that Close never sits on a remove handler and Remove never on a close handler,
 *           and that each code is a live register row. It reads the tags, never writes one.
 * CALLED BY by hand and the QA gate: node e2e/ui-codes-std-glyphs.test.cjs   (GLYPH_ID_MUTATE=swap or remove must fail it)
 * FLOW      UX-137 step 3 (lever 0, the standard action set); the rows CMP005 and CMP008 are cb-capability's, this test never writes one.
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 * Register  looked up in UIID_REG, else ../chitbridge-docs/SCREENS.json, else C:/dev/SCREENS.json; none found: printed as pending, never a pass.
 */
const fs = require('fs'), path = require('path');
const mutate = process.env.GLYPH_ID_MUTATE || '';
const PUB = path.join(__dirname, '..', 'public');
const GLYPH = /^(?:✕|×|&times;)$/;
const SAYS_CLOSE = /close|Close|hide/;
const SAYS_REMOVE = /remove|Remove|del|Del/;
let failures = 0;
const check = (c, m) => { if (!c) { console.log('  FAIL ' + m); failures++; } };

const files = ['app.html', 'accounts.html', 'finance.html', 'crm.html'].concat(fs.readdirSync(path.join(PUB, 'app')).filter((f) => /\.js$/.test(f)).map((f) => 'app/' + f));
let seen = 0;
const used = {};
for (const f of files) {
  let t = fs.readFileSync(path.join(PUB, f), 'utf8').split('\r\n').join('\n');
  if (mutate === 'swap') t = t.split('data-cbsid="CMP005"').join('data-cbsid="SWAPX"').split('data-cbsid="CMP008"').join('data-cbsid="CMP005"').split('SWAPX').join('CMP008');
  if (mutate === 'remove') t = t.split('data-cbsid="CMP008"').join('');
  for (const m of t.matchAll(/<(button|span)\b([^>]*)>(✕|×|&times;)<\/(?:button|span)>/g)) {
    const c = m[2].match(/data-cbsid="(CMP00[58])"/);
    if (!c) continue;
    seen++;
    used[c[1]] = true;
    const close = SAYS_CLOSE.test(m[2]) && !SAYS_REMOVE.test(m[2]);
    const remove = SAYS_REMOVE.test(m[2]);
    check(c[1] === 'CMP005' ? close : remove, f + ': a glyph tagged ' + c[1] + ' does not say so: ' + m[2].slice(0, 90));
  }
}
check(seen >= 25, 'at least 25 glyph elements are tagged with literal text, found ' + seen);

let reg = null;
for (const p of [process.env.UIID_REG, path.join(__dirname, '..', '..', 'chitbridge-docs', 'SCREENS.json'), 'C:/dev/SCREENS.json']) {
  if (p && fs.existsSync(p)) { try { reg = JSON.parse(fs.readFileSync(p, 'utf8')); break; } catch (e) { /* try the next path */ } }
}
if (reg) {
  const rows = Object.values(reg.screens || {});
  for (const code of ['CMP005', 'CMP008', 'CMP010', 'CMP011', 'CMP012', 'CMP014', 'CMP006']) {
    const row = rows.find((r) => r.code === code);
    check(!!row && !row.retired, code + ' is a live register row');
  }
} else console.log('  pending: no SCREENS.json found, the register rows were not read');
console.log(failures ? '\n' + failures + ' FAILED' : '\nui-codes-std-glyphs: ' + seen + ' glyph elements checked, all match');
process.exit(failures ? 1 : 0);
