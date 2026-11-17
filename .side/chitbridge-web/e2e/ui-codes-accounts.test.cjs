'use strict';
// @type: unit
/**
 * ui-codes-accounts.test.cjs - the Accounts page wears ITS identity codes (UX-137 stamp 7, screens BKS001, BKS007, BKS014, BKS016, BKS024, BKS025).
 *
 * OWNS      the proof that accounts.html and the scripts only it loads (cap-period, cap-period-accruals, cap-bank, cap-bank-rows, cap-move-in, cap-compare, cap-fx)
 *           carry the 67 data-cbsid codes of their own screens, that a named control wears ITS code (a swap of two codes fails), that no code is
 *           written on two element definitions, and that each code is a live row in the register. A builder tag drawn for many callers
 *           (peInput, peSel, peBtn, the menu items, the tabs) is ONE element definition and ONE code.
 * CALLED BY by hand and the QA gate: node e2e/ui-codes-accounts.test.cjs   (ACC_ID_MUTATE=swap or remove must fail it)
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 * Register  codes are looked up in UIID_REG, else ../chitbridge-docs/SCREENS.json, else C:/dev/SCREENS.json: a code not there yet is printed
 *           as pending (the docs PR lands the rows), a code the register calls retired fails.
 */
const fs = require('fs'), path = require('path');
const mutate = process.env.ACC_ID_MUTATE || '';
const PUB = path.join(__dirname, '..', 'public');
const SET = {
  'accounts.html': 'BKS001-B01 BKS001-B02 BKS001-B03 BKS001-B04 BKS001-B05 BKS001-B06 BKS001-B07',
  'app/cap-period.js': 'BKS016-B01 BKS016-I01 BKS016-S01 BKS016-B02 BKS016-B03 BKS016-B10 BKS016-B05 BKS016-B06 BKS016-B07 BKS016-B08 BKS016-B09 BKS016-I02',
  'app/cap-period-accruals.js': 'BKS016-B04',
  'app/cap-bank.js': 'BKS014-I01 BKS014-S01 BKS014-B09 BKS014-B26 BKS014-B02 BKS014-B19 BKS014-B01 BKS014-B22 BKS014-B25 BKS014-B24 BKS014-B18 BKS014-B23 BKS014-B21 BKS014-B27 BKS014-B29 BKS014-B28',
  'app/cap-bank-rows.js': 'BKS014-T01 BKS014-B03 BKS014-B04 BKS014-B05 BKS014-B06 BKS014-B07',
  'app/cap-bank-store.js': 'BKS014-B08',
  'app/cap-bank-home.js': 'BKS014-B49 BKS014-B50 BKS014-B51 BKS014-B53 BKS014-B48 BKS014-B52 BKS014-B44 BKS014-B47 BKS014-B46',
  'app/cap-bank-sheet.js': 'BKS014-B17 BKS014-B16 BKS014-B60 BKS014-B61 BKS014-B62 BKS014-B63 BKS014-B64',
  'app/cap-bank-statements.js': 'BKS014-B41 BKS014-B45 BKS014-B42 BKS014-B43',
  'app/cap-bank-statements-add.js': 'BKS014-I12 BKS014-I13',
  'app/cap-move-in.js': 'BKS024-S01 BKS024-I01 BKS024-I02 BKS024-S02 BKS024-B01 BKS024-B02',
  'app/cap-compare.js': 'BKS007-S01 BKS007-B01 BKS007-B02 BKS007-B03 BKS007-B04 BKS007-B05 BKS007-B06 BKS007-B07 BKS007-S02 BKS007-I01 BKS007-B08 BKS007-I02 BKS007-I03 BKS007-I04 BKS007-S03',
  'app/cap-fx.js': 'BKS025-B01 BKS025-I01 BKS025-I02 BKS025-I03 BKS025-I04 BKS025-S01 BKS025-I05 BKS025-B02 BKS025-B03 BKS025-B04'
};
/** [file, marker the tag carries within 6 lines of its code, the code it must wear] */
const NEAR = [
  ['accounts.html', 'id="toggleNav"', 'BKS001-B01'], ['accounts.html', 'acc-switch-on', 'BKS001-B07'], ['accounts.html', 'close-first-go', 'BKS001-B06'],
  ['app/cap-period.js', 'data-testid="py-close"', 'BKS016-B09'], ['app/cap-period.js', 'data-testid="py-lodged"', 'BKS016-I02'], ['app/cap-period.js', 'id="pdp_run"', 'BKS016-B03'],
  ['app/cap-bank.js', 'data-testid="bank-file"', 'BKS014-I01'], ['app/cap-bank.js', 'bank-brs-download', 'BKS014-B02'], ['app/cap-bank-rows.js', 'id="bk_note"', 'BKS014-T01'], ['app/cap-bank-store.js', 'bank-signoff', 'BKS014-B08'], ['app/cap-bank-statements-add.js', 'data-testid="bank-stmts-file"', 'BKS014-I13'], ['app/cap-bank-statements.js', 'data-testid="bank-stmts-read"', 'BKS014-B42'],
  ['app/cap-move-in.js', 'id="mi-asat"', 'BKS024-I01'], ['app/cap-move-in.js', 'data-testid="mi-again"', 'BKS024-B02'],
  ['app/cap-compare.js', 'data-testid="cmp-pick"', 'BKS007-S01'], ['app/cap-compare.js', 'data-testid="cmp-new"', 'BKS007-B08'], ['app/cap-compare.js', 'id="cmp-label"', 'BKS007-I02'],
  ['app/cap-fx.js', 'data-testid="fx-add"', 'BKS025-B01'], ['app/cap-fx.js', 'id="fx_cur"', 'BKS025-I02'], ['app/cap-fx.js', 'data-testid="lk-fx-revalue"', 'BKS025-B04']
];
const read = (f) => {
  let t = fs.readFileSync(path.join(PUB, f), 'utf8').split('\r\n').join('\n');
  if (mutate === 'remove') t = t.split('data-cbsid="BKS001-B04"').join('');
  if (mutate === 'swap') t = t.split('BKS001-B04').join('SWAPX').split('BKS001-B05').join('BKS001-B04').split('SWAPX').join('BKS001-B05');
  return t;
};
let failures = 0;
const check = (c, m) => { console.log((c ? '  ok ' : '  FAIL ') + m); if (!c) failures++; };
const src = {}; Object.keys(SET).forEach((f) => (src[f] = read(f)));
const CODE = /data-cbsid="((?:BKS)\d{3}-[A-Z]\d{2})"/g;

const all = {};
for (const f of Object.keys(SET)) {
  const found = [...src[f].matchAll(CODE)].map((m) => m[1]);
  found.forEach((c) => (all[c] = (all[c] || 0) + 1));
  check(found.join(' ') === SET[f], f + ' carries its codes in reading order (' + found.length + ' of ' + SET[f].split(' ').length + ')');
}
const dup = Object.keys(all).filter((c) => all[c] > 1);
check(dup.length === 0, 'no code is written on two element definitions' + (dup.length ? ' (' + dup.join(',') + ')' : ''));
check(Object.keys(all).length === 96, 'the page has 96 coded element definitions: ' + Object.keys(all).length);

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
