'use strict';
// @type: unit
/**
 * ui-codes-refpages.test.cjs - the six reference and lab pages wear their identity codes (UX-137 one-pass, 14 Nov).
 *
 * OWNS      the proof that storefront-design, supplier-design, design-mock, screen-gallery, lifecycle-test and list-lab carry exactly the data-cbsid
 *           codes below (screen OWN005..OWN009 and LLB001, kind letters B I S C), each written once, none retired in the register.
 * CALLED BY by hand and the QA gate: node e2e/ui-codes-refpages.test.cjs   (REFPAGES_ID_MUTATE=remove must fail it)
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 * Register  codes are looked up in UIID_REG, else ../chitbridge-docs/SCREENS.json, else C:/dev/SCREENS.json: a code not there yet is printed as
 *           pending (the docs PR lands the rows), a code the register calls retired fails.
 */
const fs = require('fs'), path = require('path');
const WANT = { 'storefront-design': ['OWN005', 18], 'supplier-design': ['OWN006', 17], 'design-mock': ['OWN007', 13], 'screen-gallery': ['OWN008', 4], 'lifecycle-test': ['OWN009', 4], 'list-lab': ['LLB001', 4] };
const regPath = [process.env.UIID_REG, path.join(__dirname, '..', '..', 'chitbridge-docs', 'SCREENS.json'), 'C:/dev/SCREENS.json'].filter((p) => p && fs.existsSync(p))[0];
const reg = regPath ? JSON.parse(fs.readFileSync(regPath, 'utf8')).screens : {};
const rows = {}; Object.values(reg).forEach((s) => { rows[s.code] = s; });
let failures = 0;
const check = (ok, msg) => { console.log((ok ? '  ok ' : '  FAIL ') + msg); if (!ok) failures++; };
for (const [page, [screen, want]] of Object.entries(WANT)) {
  let src = fs.readFileSync(path.join(__dirname, '..', 'public', page + '.html'), 'utf8').split('\r\n').join('\n');
  if (process.env.REFPAGES_ID_MUTATE === 'remove') src = src.replace(/ data-cbsid=\S+/, '');
  const codes = [...src.matchAll(/data-cbsid=\\?"([A-Z]{3}[0-9]{3}-[A-Z][0-9]{2})\\?"/g)].map((m) => m[1]);
  check(codes.length === want, page + ' wears ' + want + ' codes (' + codes.length + ')');
  check(new Set(codes).size === codes.length, page + ' writes no code twice');
  check(codes.every((c) => c.indexOf(screen + '-') === 0), page + ' codes belong to screen ' + screen);
  check(codes.every((c) => !rows[c] || !rows[c].retired), page + ' has no retired code');
  const pending = codes.filter((c) => !rows[c]).length;
  if (pending) console.log('  pending: ' + pending + ' of ' + codes.length + ' codes not in the register yet (the docs PR lands the rows)');
}
console.log(failures ? 'FAILED ' + failures : 'ALL PASS');
process.exit(failures ? 1 : 0);
