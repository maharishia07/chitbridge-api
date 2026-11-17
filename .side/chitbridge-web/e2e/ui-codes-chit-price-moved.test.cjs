'use strict';
// @type: unit
/**
 * ui-codes-chit-price-moved.test.cjs - the "Prices have moved" popup of a draft wears ITS identity codes (CTR-245, screen RAL001 Compose, popup RAL001-D01).
 *
 * OWNS      the proof that public/app/chit-price-moved.js tags its two own buttons with RAL001-D01-B01 (Use the new prices) and RAL001-D01-B02 (Send as drafted), that Back is the shared
 *           component CMP003, that the letter is the tag's own kind, that the named testids wear THEIR code (a swap fails), that no code is on two tags, and that data-cbsid is the LAST
 *           attribute of each tag.
 * CALLED BY by hand and the QA gate: node e2e/ui-codes-chit-price-moved.test.cjs   (PMOVED_ID_MUTATE=swap or remove must fail it)
 * FLOW      CTR-245 (web); the register rows are written by the docs stamp run (toolset/ui-identity/ui-stamp.cjs). The popup is a native dialog over the compose modal because ui.dialog replaces the
 *           modal host and would lose the compose form: cb-ux-locale is asked to widen the library (a dialog that opens over a modal) before this is folded into it.
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 * Register  looked up in UIID_REG, else ../chitbridge-docs/SCREENS.json, else C:/dev/SCREENS.json: a code not there yet is printed as pending (the docs PR lands the rows), a retired code fails.
 */
const fs = require('fs'), path = require('path');
const mutate = process.env.PMOVED_ID_MUTATE || '';
let src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'chit-price-moved.js'), 'utf8').split('\r\n').join('\n');
if (mutate === 'remove') src = src.split('RAL001-D01-B01').join('');
if (mutate === 'swap') src = src.split('RAL001-D01-B01').join('SWAPX').split('RAL001-D01-B02').join('RAL001-D01-B01').split('SWAPX').join('RAL001-D01-B02');
let failures = 0;
const check = (c, m) => { console.log((c ? '  ok ' : '  FAIL ') + m); if (!c) failures++; };

/** the module draws its buttons through two helpers that take the code as an argument, so the codes are read from the constants and the helper calls */
const consts = Object.fromEntries([...src.matchAll(/var (CODE_[A-Z]+) = '([A-Z0-9-]+)';/g)].map((m) => [m[1], m[2]]));
check(consts.CODE_NEW === 'RAL001-D01-B01' && consts.CODE_DRAFTED === 'RAL001-D01-B02' && consts.CODE_BACK === 'CMP003', 'the three codes: new B01, as drafted B02, Back is the shared component CMP003 (' + JSON.stringify(consts) + ')');
const calls = [...src.matchAll(/(quietButton|primaryButton)\((CODE_[A-Z]+), '([a-z-]+)'/g)].map((m) => ({ fn: m[1], code: consts[m[2]], testid: m[3] }));
check(calls.length === 3, 'three buttons are drawn, found ' + calls.length);
const WANT = { 'price-moved-new': 'RAL001-D01-B01', 'price-moved-drafted': 'RAL001-D01-B02', 'price-moved-back': 'CMP003' };
for (const [testid, code] of Object.entries(WANT)) {
  const call = calls.filter((c) => c.testid === testid)[0];
  check(!!call && call.code === code, testid + ' wears ' + code);
}
const own = calls.map((c) => c.code).filter((c) => /^RAL001-/.test(c));
check(new Set(own).size === own.length, 'no RAL001 code is on two buttons');
check(own.every((c) => /^RAL001-D01-B[0-9]{2}$/.test(c)), 'every own code is a button (B) of the popup RAL001-D01');
/** data-cbsid is the last attribute of a tag: the markup of both helpers ends the tag with it */
const markup = [...src.matchAll(/'<button type="button" data-testid="' \+ testid \+ '" style="'[^>]*?data-cbsid="' \+ code \+ '">'/g)];
check(markup.length === 2, 'both button helpers write data-cbsid as the LAST attribute of the tag, found ' + markup.length);
check(/esc\(wordsOf\(label\)\)/.test(src), 'the button words are the label, translated and escaped');

let reg = null;
for (const p of [process.env.UIID_REG, path.join(__dirname, '..', '..', 'chitbridge-docs', 'SCREENS.json'), 'C:/dev/SCREENS.json']) {
  if (p && fs.existsSync(p)) { try { reg = JSON.parse(fs.readFileSync(p, 'utf8')); break; } catch (e) { /* try the next path */ } }
}
if (reg) {
  const rows = {}; Object.values(reg.screens || {}).forEach((r) => { if (r.code) rows[r.code] = r; });
  const codes = [...own, 'CMP003'];
  const missing = codes.filter((c) => !rows[c] && !Object.values(reg.screens || {}).some((r) => r.code === c)), retired = codes.filter((c) => rows[c] && rows[c].retired);
  console.log('  register: ' + (codes.length - missing.length) + ' of ' + codes.length + ' codes found' + (missing.length ? ' (pending until the docs PR lands: ' + missing.join(', ') + ')' : ''));
  check(retired.length === 0, 'no code is retired in the register');
}
console.log(failures ? failures + ' FAILED' : 'ALL PASS');
process.exit(failures ? 1 : 0);
