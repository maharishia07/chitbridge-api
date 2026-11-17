'use strict';
// @type: unit
/**
 * ui-codes-finance.test.cjs - the Finance page wears ITS identity codes (UX-137 stamp 8, screens FIN001 to FIN008).
 *
 * OWNS      the proof that finance.html and the nine scripts only it loads (cap-finance, -pay, -cash, -terms, -cheques, -returns, cap-repeat, cap-mis, cap-mis-trend)
 *           carry the 47 data-cbsid codes of their own screens, that a named control wears ITS code (a swap of two codes fails), that no code is
 *           written on two element definitions, and that each code is a live row in the register. A builder tag drawn for many callers
 *           (rpBtn, the terms field, the tabs) is ONE element definition and ONE code.
 * CALLED BY by hand and the QA gate: node e2e/ui-codes-finance.test.cjs   (FIN_ID_MUTATE=swap or remove must fail it)
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 * Register  codes are looked up in UIID_REG, else ../chitbridge-docs/SCREENS.json, else C:/dev/SCREENS.json: a code not there yet is printed
 *           as pending (the docs PR lands the rows), a code the register calls retired fails.
 */
const fs = require('fs'), path = require('path');
const mutate = process.env.FIN_ID_MUTATE || '';
const PUB = path.join(__dirname, '..', 'public');
const SET = {
  'finance.html': 'FIN001-B01 FIN001-B02',
  'app/cap-finance.js': 'FIN001-B03 FIN001-C01 FIN001-B04 FIN001-B05',
  'app/cap-finance-pay.js': 'FIN002-B01 FIN002-B02 FIN002-B03 FIN002-I01',
  'app/cap-finance-cash.js': 'FIN003-B01',
  'app/cap-finance-terms.js': 'FIN004-I01 FIN004-I02 FIN004-B01 FIN004-B02',
  'app/cap-repeat.js': 'FIN005-B01 FIN005-B02 FIN005-C01 FIN005-I01 FIN005-S01 FIN005-I02 FIN005-I03 FIN005-I04 FIN005-I05 FIN005-I06 FIN005-I07 FIN005-I08 FIN005-I09 FIN005-I10 FIN005-I11 FIN005-S02 FIN005-I12 FIN005-I13 FIN005-B03 FIN005-I14 FIN005-B04',
  'app/cap-finance-cheques.js': 'FIN006-B01 FIN006-I01 FIN006-I02 FIN006-B02 FIN006-B03 FIN006-B04',
  'app/cap-finance-returns.js': 'FIN007-S01 FIN007-B01 FIN007-B02',
  'app/cap-mis.js': 'FIN008-B02',
  'app/cap-mis-trend.js': 'FIN008-B01',
  'app/cap-mis-pictures.js': 'FIN008-B04 FIN008-B03'
};
/** [file, marker the tag carries within 6 lines of its code, the code it must wear] */
const NEAR = [
  ['finance.html', 'id="toggleNav"', 'FIN001-B01'], ['finance.html', 'close-first-go', 'FIN001-B02'],
  ['app/cap-finance.js', 'id="fin_on"', 'FIN001-B03'], ['app/cap-finance.js', 'fin-queue-go-', 'FIN001-B04'],
  ['app/cap-finance-pay.js', 'fp-hold-', 'FIN002-B01'], ['app/cap-finance-pay.js', 'fp-release-', 'FIN002-B03'], ['app/cap-finance-pay.js', 'id="fp_hold_note"', 'FIN002-I01'],
  ['app/cap-finance-cash.js', 'fc-days-', 'FIN003-B01'],
  ['app/cap-finance-terms.js', 'data-testid="ft-undo"', 'FIN004-B02'],
  ['app/cap-repeat.js', 'data-testid="rp-run-due"', 'FIN005-B02'], ['app/cap-repeat.js', 'id="rp_every"', 'FIN005-I01'], ['app/cap-repeat.js', 'id="rp_c_note"', 'FIN005-I13'], ['app/cap-repeat.js', 'data-testid="rp-c-send"', 'FIN005-B03'],
  ['app/cap-finance-cheques.js', 'data-testid="fq-switch"', 'FIN006-B01'], ['app/cap-finance-cheques.js', 'id="fq_days"', 'FIN006-I02'],
  ['app/cap-finance-returns.js', 'id="fr_month"', 'FIN007-S01'], ['app/cap-finance-returns.js', 'data-testid="fr-gstr1"', 'FIN007-B01'],
  ['app/cap-mis.js', 'fm-period-', 'FIN008-B02'], ['app/cap-mis-trend.js', 'tr-tab-', 'FIN008-B01'],
  ['app/cap-mis-pictures.js', 'pc-tab-', 'FIN008-B03'], ['app/cap-mis-pictures.js', 'table-btn', 'FIN008-B04']
];
const read = (f) => {
  let t = fs.readFileSync(path.join(PUB, f), 'utf8').split('\r\n').join('\n');
  if (mutate === 'remove') t = t.split('data-cbsid="FIN001-B04"').join('');
  if (mutate === 'swap') t = t.split('FIN001-B04').join('SWAPX').split('FIN001-B05').join('FIN001-B04').split('SWAPX').join('FIN001-B05');
  return t;
};
let failures = 0;
const check = (c, m) => { console.log((c ? '  ok ' : '  FAIL ') + m); if (!c) failures++; };
const src = {}; Object.keys(SET).forEach((f) => (src[f] = read(f)));
const CODE = /data-cbsid="((?:FIN)\d{3}-[A-Z]\d{2})"/g;

const all = {};
for (const f of Object.keys(SET)) {
  const found = [...src[f].matchAll(CODE)].map((m) => m[1]);
  found.forEach((c) => (all[c] = (all[c] || 0) + 1));
  check(found.join(' ') === SET[f], f + ' carries its codes in reading order (' + found.length + ' of ' + SET[f].split(' ').length + ')');
}
const dup = Object.keys(all).filter((c) => all[c] > 1);
check(dup.length === 0, 'no code is written on two element definitions' + (dup.length ? ' (' + dup.join(',') + ')' : ''));
check(Object.keys(all).length === 49, 'the page has 49 coded element definitions: ' + Object.keys(all).length);

for (const [f, marker, code] of NEAR) {
  const lines = src[f].split('\n'), at = lines.findIndex((l) => l.indexOf('data-cbsid="' + code + '"') >= 0);
  const win = at < 0 ? '' : lines.slice(at, at + 7).join('\n');
  check(win.indexOf(marker) >= 0, f + ' ' + marker.replace(/"/g, '') + ' wears ' + code);
}

/** the register */
let reg = null;
for (const p of [process.env.UIID_REG, path.join(__dirname, '..', '..', 'chitbridge-docs', 'SCREENS.json'), 'C:/dev/SCREENS.json']) {
  if (p && fs.existsSync(p)) { try { reg = JSON.parse(fs.readFileSync(p, 'utf8')); break; } catch (e) { /* next */ } }
}
if (reg) {
  const rows = {}; Object.values(reg.screens || {}).forEach((r) => { if (r.code) rows[r.code] = r; });
  const missing = Object.keys(all).filter((c) => !rows[c]), retired = Object.keys(all).filter((c) => rows[c] && rows[c].retired);
  console.log('  register: ' + (Object.keys(all).length - missing.length) + ' of ' + Object.keys(all).length + ' codes found' + (missing.length ? ' (pending until the docs PR lands: ' + missing.length + ')' : ''));
  if (process.env.UIID_REG) check(!missing.length, "every code is in the register UIID_REG names (" + missing.length + " missing)"); /* a set register: a missing code FAILS, no pending */
  check(retired.length === 0, 'no code is retired in the register');
}
console.log(failures ? failures + ' FAILED' : 'ALL PASS');
process.exit(failures ? 1 : 0);
