'use strict';
// @type: unit
/**
 * ui-codes-crm.test.cjs - the CRM page wears ITS identity codes (UX-137 stamp 6, screens CRM001, CRM004, CRM005, CRM006, CRM008, CRM010, MKT003).
 *
 * OWNS      the proof that crm.html and the seven scripts only it loads (cap-crm, cap-crm-record, -privacy, -calls, -leads, -groups, cap-marketing)
 *           carry the 85 data-cbsid (CRM006-B07 retired by 2664a890, CRM UX l16: the Next band is the one place for Add phone or e-mail) codes of their own screens, that a named control wears ITS code (a swap of two codes fails), that no code is
 *           written on two element definitions, and that each code is a live row in the register. A builder tag drawn for many callers
 *           (crmViewOnlyBtn, btn, off, seg, mktPageBtn, crmConsentBtn, the preset chips) is ONE element definition and ONE code.
 * CALLED BY by hand and the QA gate: node e2e/ui-codes-crm.test.cjs   (CRM_ID_MUTATE=swap or remove must fail it)
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 * Register  codes are looked up in UIID_REG, else ../chitbridge-docs/SCREENS.json, else C:/dev/SCREENS.json: a code not there yet is printed
 *           as pending (the docs PR lands the rows), a code the register calls retired fails.
 */
const fs = require('fs'), path = require('path');
const mutate = process.env.CRM_ID_MUTATE || '';
const PUB = path.join(__dirname, '..', 'public');
const SET = {
  'crm.html': 'CRM001-B01 CRM001-B02',
  'app/cap-crm.js': 'CRM001-B03 CRM001-B04 CRM001-B05 CRM001-B06 CRM001-B07 CRM001-I01 CRM001-B08 CRM001-B09 CRM001-B10 CRM001-B11 CRM001-I02 CRM001-I03 CRM001-I04 CRM001-B12 CRM001-S01 CRM001-B13',
  'app/cap-crm-record.js': 'CRM006-B01 CRM006-B02 CRM006-B03 CRM006-B04 CRM006-B08 CRM006-B05 CRM006-B06 CRM006-B09 CRM006-B10 CRM006-B11 CRM006-B12 CRM006-B13 CRM006-B14 CRM006-B15 CRM006-B16 CRM006-B17 CRM006-B18 CRM006-C01 CRM006-B20 CRM006-T01 CRM006-I01 CRM006-I02 CRM006-I03 CRM006-B21',
  'app/cap-crm-timeline.js': 'CRM006-B19',
  'app/cap-crm-privacy.js': 'CRM010-B01 CRM010-B02 CRM010-I03 CRM010-B08 CRM010-B09',
  'app/cap-crm-privacy-register.js': 'CRM010-B03 CRM010-B04 CRM010-B05 CRM010-I01 CRM010-S01 CRM010-I02 CRM010-B06 CRM010-S02 CRM010-T01 CRM010-B07',
  'app/cap-crm-calls.js': 'CRM005-B01 CRM005-B02 CRM005-I01',
  'app/cap-crm-leads.js': 'CRM004-B01 CRM004-I01 CRM004-I02 CRM004-S01 CRM004-B02 CRM004-B03 CRM004-B04 CRM004-I03 CRM004-S02',
  'app/cap-crm-groups.js': 'CRM008-B01',
  'app/cap-crm-groups-sheet.js': 'CRM008-I01 CRM008-I02 CRM008-I03',
  'app/cap-crm-groups-send.js': 'CRM008-T01 CRM008-B02 CRM008-B03',
  'app/cap-crm-groups-window.js': 'CRM008-B04 CRM008-B05 CRM008-I04 CRM008-B06 CRM008-B07 CRM008-B08',
  'app/cap-marketing.js': 'MKT003-B01 MKT003-B02'
};
/** [file, marker the tag carries within 6 lines of its code, the code it must wear] */
const NEAR = [
  ['crm.html', 'id="toggleNav"', 'CRM001-B01'], ['crm.html', 'close-first-go', 'CRM001-B02'],
  ['app/cap-crm.js', 'data-testid="crm-add"', 'CRM001-B04'], ['app/cap-crm.js', 'data-testid="crm-fu-add"', 'CRM001-B05'], ['app/cap-crm.js', 'id="crm_addq"', 'CRM001-I01'],
  ['app/cap-crm.js', 'crm-add-role-customer', 'CRM001-B08'], ['app/cap-crm.js', 'id="crm_fu_who"', 'CRM001-S01'],
  ['app/cap-crm-record.js', 'crm-more-remove', 'CRM006-B04'], ['app/cap-crm-record.js', 'crm-act-more', 'CRM006-B17'], ['app/cap-crm-record.js', 'id="crm_log_body"', 'CRM006-T01'],
  ['app/cap-crm-record.js', 'crm-ledger-on', 'CRM006-B18'], ['app/cap-crm-record.js', 'crm-terms-go', 'CRM006-C01'],
  ['app/cap-crm-privacy-register.js', 'id="crm_prv_who"', 'CRM010-I01'], ['app/cap-crm-privacy-register.js', 'id="crm_prv_out"', 'CRM010-S02'], ['app/cap-crm-privacy-register.js', 'crm-prv-prev', 'CRM010-B04'],
  ['app/cap-crm-calls.js', 'id="crm_call_day"', 'CRM005-I01'],
  ['app/cap-crm-leads.js', 'id="crm_lead_stage"', 'CRM004-S01'], ['app/cap-crm-leads.js', 'crm-lead-import', 'CRM004-B04'],
  ['app/cap-crm-groups-sheet.js', 'id="crm_grp_name"', 'CRM008-I01'], ['app/cap-crm-groups-send.js', 'id="crm_send_text"', 'CRM008-T01'], ['app/cap-crm-groups-window.js', 'crm-sc-copy', 'CRM008-B04'],
  ['app/cap-marketing.js', 'data-crm="mktpage"', 'MKT003-B01']
];
const read = (f) => {
  let t = fs.readFileSync(path.join(PUB, f), 'utf8').split('\r\n').join('\n');
  if (mutate === 'remove') t = t.split('data-cbsid="CRM001-B04"').join('');
  if (mutate === 'swap') t = t.split('CRM001-B04').join('SWAPX').split('CRM001-B05').join('CRM001-B04').split('SWAPX').join('CRM001-B05');
  return t;
};
let failures = 0;
const check = (c, m) => { console.log((c ? '  ok ' : '  FAIL ') + m); if (!c) failures++; };
const src = {}; Object.keys(SET).forEach((f) => (src[f] = read(f)));
const CODE = /data-cbsid="((?:CRM|MKT)\d{3}-[A-Z]\d{2})"/g;

const all = {};
for (const f of Object.keys(SET)) {
  const found = [...src[f].matchAll(CODE)].map((m) => m[1]);
  found.forEach((c) => (all[c] = (all[c] || 0) + 1));
  check(found.join(' ') === SET[f], f + ' carries its codes in reading order (' + found.length + ' of ' + SET[f].split(' ').length + ')');
}
const dup = Object.keys(all).filter((c) => all[c] > 1);
check(dup.length === 0, 'no code is written on two element definitions' + (dup.length ? ' (' + dup.join(',') + ')' : ''));
check(Object.keys(all).length === 85, 'the page has 85 coded element definitions: ' + Object.keys(all).length);

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
