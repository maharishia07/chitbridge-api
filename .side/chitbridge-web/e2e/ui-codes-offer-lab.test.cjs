'use strict';
// @type: unit
/**
 * ui-codes-offer-lab.test.cjs - the Offer Lab page wears ITS identity codes (UX-137 stamp 9, screen OLB001; the combo mode OLB002 is the same file).
 *
 * OWNS      the proof that offer-lab-next.html (one file, its scripts are inline) carries the 86 data-cbsid codes of screen OLB001, that a named
 *           control wears ITS code (a swap of two codes fails), that no code is written on two element definitions, and that each code is a live row
 *           in the register. A builder tag drawn for many callers (the overlay chips, the loyalty switches, the tier fields) is ONE element definition
 *           and ONE code. One tag sits inside a double-quoted JS string, so its attribute is written with escaped quotes.
 * CALLED BY by hand and the QA gate: node e2e/ui-codes-offer-lab.test.cjs   (OLB_ID_MUTATE=swap or remove must fail it)
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 * Register  codes are looked up in UIID_REG, else ../chitbridge-docs/SCREENS.json, else C:/dev/SCREENS.json: a code not there yet is printed
 *           as pending (the docs PR lands the rows), a code the register calls retired fails.
 */
const fs = require('fs'), path = require('path');
const mutate = process.env.OLB_ID_MUTATE || '';
const FILE = path.join(__dirname, '..', 'public', 'offer-lab-next.html');
const BS = String.fromCharCode(92);
/* B06-B09 (the four overlay corners) are the library's CMP005 Close since web-controls-1: e2e/walk-ui-library-offer-lab.test.cjs proves them */
const WANT = 'OLB001-B01 OLB001-C01 OLB001-B02 OLB001-B03 OLB001-B04 OLB001-I01 OLB001-B05 OLB001-C02 OLB001-I02 OLB001-I03 OLB001-C03 OLB001-B10 OLB001-B11 OLB001-B12 OLB001-I04 OLB001-I05 OLB001-B13 OLB001-B14 OLB001-B15 OLB001-B16 OLB001-B17 OLB001-B18 OLB001-B19 OLB001-B20 OLB001-C04 OLB001-B21 OLB001-I06 OLB001-B22 OLB001-B23 OLB001-I07 OLB001-B24 OLB001-I08 OLB001-B25 OLB001-B26 OLB001-B27 OLB001-B28 OLB001-B29 OLB001-I09 OLB001-B30 OLB001-B31 OLB001-I10 OLB001-I11 OLB001-B32 OLB001-B33 OLB001-B34 OLB001-I12 OLB001-I13 OLB001-I14 OLB001-B35 OLB001-I15 OLB001-I16 OLB001-I17 OLB001-I18 OLB001-I19 OLB001-I20 OLB001-I21 OLB001-I22 OLB001-I23 OLB001-I24 OLB001-I25 OLB001-B36 OLB001-B37 OLB001-I26 OLB001-I27 OLB001-B38 OLB001-B39 OLB001-I28 OLB001-I29 OLB001-I30 OLB001-B40 OLB001-B41 OLB001-B42 OLB001-B43 OLB001-B44 OLB001-B45 OLB001-B46 OLB001-B47 OLB001-B48 OLB001-S01 OLB001-B49 OLB001-B50 OLB001-B51';
/** [marker the tag carries on the line of its code, the code it must wear] */
const NEAR = [
  ['id="toolMenuBtn"', 'OLB001-B01'], ['openPriceOverlay()', 'OLB001-B02'], ['id="labImportFile"', 'OLB001-I01'], ['id="ovlSearch"', 'OLB001-I02'],
  ['id="modLabSearch"', 'OLB001-I03'], ['id="workSave"', 'OLB001-B10'], ['data-testid="reach-pick"', 'OLB001-B30'], ['data-testid="all-types"', 'OLB001-B32'],
  ['data-testid="cart-edit"', 'OLB001-B44'], ['data-testid="cart-group-pick"', 'OLB001-S01'], ['data-testid="cart-row"', 'OLB001-B48']
];
let t = fs.readFileSync(FILE, 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
if (mutate === 'remove') t = t.split('data-cbsid="OLB001-B01"').join('');
if (mutate === 'swap') t = t.split('OLB001-B01').join('SWAPX').split('OLB001-B02').join('OLB001-B01').split('SWAPX').join('OLB001-B02');
let failures = 0;
const check = (c, m) => { console.log((c ? '  ok ' : '  FAIL ') + m); if (!c) failures++; };
const CODE = new RegExp('data-cbsid=' + BS + BS + '?"(OLB[0-9]{3}-[A-Z][0-9]{2})' + BS + BS + '?"', 'g');
const found = [...t.matchAll(CODE)].map((m) => m[1]);
check(found.join(' ') === WANT, 'offer-lab-next.html carries its codes in reading order (' + found.length + ' of ' + WANT.split(' ').length + ')');
const count = {}; found.forEach((c) => (count[c] = (count[c] || 0) + 1));
const dup = Object.keys(count).filter((c) => count[c] > 1);
check(dup.length === 0, 'no code is written on two element definitions' + (dup.length ? ' (' + dup.join(',') + ')' : ''));
check(Object.keys(count).length === 82, 'the page has 82 coded element definitions: ' + Object.keys(count).length);
const lines = t.split(String.fromCharCode(10));
for (const [marker, code] of NEAR) {
  const line = lines.find((l) => l.indexOf(marker) >= 0 && l.indexOf('data-cbsid=') >= 0) || '';
  check(line.indexOf(code) >= 0, marker.replace(/"/g, '') + ' wears ' + code);
}
let reg = null;
for (const p of [process.env.UIID_REG, path.join(__dirname, '..', '..', 'chitbridge-docs', 'SCREENS.json'), 'C:/dev/SCREENS.json']) {
  if (p && fs.existsSync(p)) { try { reg = JSON.parse(fs.readFileSync(p, 'utf8')); break; } catch (e) { /* next */ } }
}
if (reg) {
  const rows = {}; Object.values(reg.screens || {}).forEach((r) => { if (r.code) rows[r.code] = r; });
  const missing = Object.keys(count).filter((c) => !rows[c]), retired = Object.keys(count).filter((c) => rows[c] && rows[c].retired);
  console.log('  register: ' + (Object.keys(count).length - missing.length) + ' of ' + Object.keys(count).length + ' codes found' + (missing.length ? ' (pending until the docs PR lands: ' + missing.length + ')' : ''));
  if (process.env.UIID_REG) check(!missing.length, "every code is in the register UIID_REG names (" + missing.length + " missing)"); /* a set register: a missing code FAILS, no pending */
  check(retired.length === 0, 'no code is retired in the register');
}
console.log(failures ? failures + ' FAILED' : 'ALL PASS');
process.exit(failures ? 1 : 0);
