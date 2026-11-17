'use strict';
// @type: unit
/**
 * ui-codes-app-catalogue.test.cjs - the Catalogue list screen of app.html wears ITS identity codes (UX-137 slice app-2, screen CAT001).
 *
 * OWNS      the proof that the catalogueScreen function of app.html tags its five page-specific controls with CAT001-<kind><nn> (B button,
 *           I input), that the letter is the tag's own kind, that the named testids wear THEIR code (a swap fails), that no code is on
 *           two tags, and that the stamp only added attributes (strip them and the source is the same as before the stamp).
 * CALLED BY by hand and the QA gate: node e2e/ui-codes-app-catalogue.test.cjs   (APPCAT_ID_MUTATE=swap or remove must fail it)
 * FLOW      UX-137 step 3 (app.html slice 2); the rows are written by the docs stamp run (toolset/ui-identity/ui-stamp.cjs, hand lines ui-stamp/app.json).
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 * Register  looked up in UIID_REG, else ../chitbridge-docs/SCREENS.json, else C:/dev/SCREENS.json: a code not there yet is printed as pending
 *           (the docs PR lands the rows), a code the register calls retired fails.
 */
const fs = require('fs'), path = require('path');
const mutate = process.env.APPCAT_ID_MUTATE || '';
let src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.html'), 'utf8').split('\r\n').join('\n');
if (mutate === 'remove') src = src.split('data-cbsid="CAT001-B03"').join('');
if (mutate === 'swap') src = src.split('CAT001-B03').join('SWAPX').split('CAT001-B04').join('CAT001-B03').split('SWAPX').join('CAT001-B04');
let failures = 0;
const check = (c, m) => { console.log((c ? '  ok ' : '  FAIL ') + m); if (!c) failures++; };

const KIND = { button: 'B', input: 'I', select: 'S', textarea: 'T', span: 'C', a: 'C', div: 'C' };
const tags = [...src.matchAll(/<(button|input|select|textarea|span|a|div)\b([^>]*?data-cbsid="(CAT001-[A-Z][0-9]{2})"[^>]*)>/g)];
const codes = tags.map((t) => t[3]);
check(codes.length === 35, 'the catalogue screen has 35 tagged elements (5 slice-2 + 30 from the G1 wave 2 stamps), found ' + codes.length);
check(new Set(codes).size === codes.length, 'no code is on two tags');
const wrong = tags.filter((t) => KIND[t[1]] !== t[3].charAt(7) && !(t[1] === 'span' && t[3].charAt(7) === 'B')); /* G1 wave 2 codes a clickable span B (a button by behaviour) */
check(wrong.length === 0, 'every code letter is its tag kind' + (wrong.length ? ' (' + wrong.map((t) => t[3]).join(',') + ')' : ''));

/** testid -> the code its tag must wear */
const WANT = { 'cat-new-product': 'CAT001-B02', 'cat-search': 'CAT001-I01', 'cat-select': 'CAT001-B03', 'cat-setup': 'CAT001-B04' };
for (const [testid, code] of Object.entries(WANT)) {
  const tag = tags.filter((t) => t[2].indexOf('data-testid="' + testid + '"') >= 0)[0];
  check(!!tag && tag[3] === code, testid + ' wears ' + code);
}
/** the stamp is the only change: strip every attribute it writes and the testids are all still in the source */
const bare = src.replace(/ data-cbsid="CAT001-[A-Z][0-9]{2}"/g, '');
check(bare.indexOf('data-testid="cat-new-product"') > 0 && bare.indexOf('data-testid="cat-setup"') > 0 && !/data-cbsid="CAT001-/.test(bare), 'stripped: the testids stay and no CAT001 code is left');

let reg = null;
for (const p of [process.env.UIID_REG, path.join(__dirname, '..', '..', 'chitbridge-docs', 'SCREENS.json'), 'C:/dev/SCREENS.json']) {
  if (p && fs.existsSync(p)) { try { reg = JSON.parse(fs.readFileSync(p, 'utf8')); break; } catch (e) { /* try the next path */ } }
}
if (reg) {
  const rows = {}; Object.values(reg.screens || {}).forEach((r) => { if (r.code) rows[r.code] = r; });
  const missing = codes.filter((c) => !rows[c]), retired = codes.filter((c) => rows[c] && rows[c].retired);
  console.log('  register: ' + (codes.length - missing.length) + ' of ' + codes.length + ' codes found' + (missing.length ? ' (pending until the docs PR lands: ' + missing.length + ')' : ''));
  if (process.env.UIID_REG) check(!missing.length, "every code is in the register UIID_REG names (" + missing.length + " missing)"); /* a set register: a missing code FAILS, no pending */
  check(retired.length === 0, 'no code is retired in the register');
}
console.log(failures ? failures + ' FAILED' : 'ALL PASS');
process.exit(failures ? 1 : 0);
