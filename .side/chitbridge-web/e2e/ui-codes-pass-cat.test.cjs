'use strict';
// @type: unit
/**
 * ui-codes-pass-cat.test.cjs - the shared catalogue, entry and folders scripts wear THEIR identity codes (UX-137, pass-cat).
 *
 * OWNS      the proof that cap-catalogue.js (CTG001 Items · CTG002 Categories · CTG003 Import), cap-entry.js (SCR022, the Entry sheet), cap-folders.js (SCR004),
 *           cap-shop.js (ACC002-B25, the vault copy button) and avatar.js (CMP048-B01, the account menu) carry the code INSIDE the tag they belong to:
 *           each pin is a code followed by the start of its own tag (a testid, a class, an onclick), so a code moved to another tag or swapped with a
 *           neighbour fails. Also: no code of these screens is retired in the register, and the counts per file hold.
 * CALLED BY by hand and the web job in ci.yml: node e2e/ui-codes-pass-cat.test.cjs   (PASSCAT_MUTATE=remove or swap must fail it)
 * FLOW      read each script -> apply the mutation (remove: take out data-cbsid of SCR022-B01, SCR004-C01, CTG001-*, CTG003-*, ACC002-B25, CMP048-B01;
 *           swap: exchange the first two codes of each file) -> every pin must be found -> counts -> register check
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 * Register  codes are looked up in UIID_REG, else ../chitbridge-docs/SCREENS.json, else C:/dev/SCREENS.json: a code not there yet is printed as pending.
 */
const fs = require('fs'), path = require('path');
const mutate = process.env.PASSCAT_MUTATE || '';
const APP = path.join(__dirname, '..', 'public', 'app');
const read = (f) => fs.readFileSync(path.join(APP, f + '.js'), 'utf8').split('\r\n').join('\n');
let failures = 0;
const check = (c, m) => { console.log((c ? '  ok ' : '  FAIL ') + m); if (!c) failures++; };

/** file -> [code (with its mount when it has one), the first characters that follow it in the same line] */
const PINS = {
  "cap-catalogue": [
    ["CTG001-I01"," class=\"inp\" id=\"ct_${k}\" data-tes"],
    ["CTG001-I02"," class=\"inp\" id=\"ct_f_${esc(k)}\" d"],
    ["CTG001-B01"," type=\"button\" class=\"ctcatg' + (o"],
    ["CTG001-B02"," type=\"button\" class=\"ctcatg add\""],
    ["CTG003-S01"," data-cfcol=\"' +"],
    ["CTG001-B03"," type=\"button\" class=\"act\" data-te"],
    ["CTG001-I03"," class=\"inp\" id=\"ct_price\" data-te"],
    ["CTG001-T01"," class=\"inp\" id=\"ct_desc\" data-tes"],
    ["CMP012 data-cbmount=\"CTG001-U112\""," type=\"button\" class=\"act\" data-te"],
    ["CTG001-B04"," type=\"button\" class=\"act quiet\" d"],
    ["CTG001-B05"," type=\"button\" class=\"act\" data-te"],
    ["CMP003 data-cbmount=\"CTG001-U103\""," type=\"button\" class=\"act quiet\" d"],
    ["CTG002-B19"," type=\"button\" class=\"act\" data-te"],
    ["CTG002-I07"," class=\"inp\" id=\"catg_name\" data-t"],
    ["CTG002-S03"," class=\"inp\" id=\"catg_parent\" data"],
    ["CTG002-I08"," class=\"inp\" id=\"catg_note\" data-t"],
    ["CTG002-B20"," type=\"button\" class=\"act\" data-te"],
    ["CMP003 data-cbmount=\"CTG002-U103\""," type=\"button\" class=\"act quiet\" d"],
    ["CTG003-B01"," type=\"button\" class=\"act quiet\" d"],
    ["CTG003-I01"," type=\"file\" id=\"cf_file\" accept=\""],
    ["CTG003-T01"," class=\"inp mono\" id=\"cf_text\" dat"],
    ["CTG003-B02"," type=\"button\" class=\"act\" data-te"],
    ["CTG003-B03"," type=\"button\" class=\"act quiet\" i"]
  ],
  "cap-entry": [
    ["CMP003"," class=\"en-btn\" onclick=\"enClose()"],
    ["CMP006 data-cbmount=\"SCR022-U106\""," class=\"en-btn\" data-testid=\"en-ba"],
    ["SCR022-B01"," class=\"en-btn pri\" data-testid=\"e"],
    ["SCR022-B02"," type=\"button\" class=\"en-tile\" dat"],
    ["SCR022-S01","' + (testid ? ' data-testid=\"' + t"],
    ["SCR022-I01"," data-testid=\"' + tid + '\" value=\""],
    ["SCR022-I02"," data-testid=\"' + tid + '\" type=\"d"],
    ["SCR022-I03"," data-testid=\"en-f-cheque_no\" valu"],
    ["SCR022-I04"," data-testid=\"en-f-cheque_date\" ty"],
    ["SCR022-I05"," data-testid=\"' + tid + '\" type=\"f"],
    ["SCR022-I06"," data-testid=\"' + tid + '\" value=\""],
    ["SCR022-S02"," data-testid=\"' +"],
    ["SCR022-S03"," data-testid=\"en-line-side-' +"],
    ["SCR022-B03"," type=\"button\" class=\"en-btn\" data"],
    ["SCR022-I07"," data-testid=\"en-item-' + key + '-"],
    ["SCR022-B04"," type=\"button\" class=\"en-btn\" data"],
    ["SCR022-B05"," type=\"button\" data-testid=\"en-fix"],
    ["SCR022-B06"," type=\"button\" data-testid=\"en-wfi"],
    ["SCR022-B07"," class=\"en-btn\" data-testid=\"en-re"],
    ["SCR022-I08"," class=\"inp\" id=\"en_reason\" data-t"]
  ],
  "cap-folders": [
    ["SCR004-C01","' +"],
    ["SCR004-C02"," style=\"font-size:var(--fs-2);colo"],
    ["SCR004-C03"," onclick=\"' +"],
    ["SCR004-C04"," style=\"margin-inline-start:auto;f"],
    ["SCR004-C05"," style=\"display:flex;gap:11px;padd"],
    ["SCR004-C06"," style=\"font-size:var(--fs-1);colo"],
    ["SCR004-C07"," data-testid=\"folder-tab-' +"],
    ["SCR004-C08"," style=\"padding:9px 12px;border-bo"],
    ["SCR004-C09"," style=\"padding:10px 12px;color:va"],
    ["SCR004-B01"," type=\"button\" class=\"mv-btn\" ' +"],
    ["SCR004-C10"," onclick=\"gsScope(' +"],
    ["SCR004-C11"," onclick=\"gsToggle(' +"],
    ["SCR004-I01"," type=\"checkbox\" data-testid=\"rule"],
    ["SCR004-B02"," class=\"composebtn\" data-testid=\"r"],
    ["SCR004-I02"," class=\"inp\" data-testid=\"rule-nam"],
    ["SCR004-S01"," class=\"inp\" data-testid=\"rule-ter"],
    ["SCR004-I03"," class=\"inp\" data-testid=\"rule-val"],
    ["SCR004-B03"," data-testid=\"rule-preview\" onclic"],
    ["SCR004-B04"," class=\"composebtn\" data-testid=\"r"],
    ["CMP003"," onclick=\"ruleDraftCancel()\" style"]
  ]
};
/** ACC002-B25 in cap-shop.js and CMP048-B01 in avatar.js: one pin each */
const EXTRA = { 'cap-shop': [['ACC002-B25', ' type="button" data-testid="vault-copy"']], avatar: [['CMP048-B01', '']] };
const REMOVED = /^(SCR022-B01|SCR004-C01|CTG001-|CTG003-|ACC002-B25|CMP048-B01)/;

const srcOf = {};
for (const file of Object.keys(PINS).concat(Object.keys(EXTRA))) {
  let src = read(file);
  const codes = (PINS[file] || []).concat(EXTRA[file] || []).map((p) => p[0]);
  if (mutate === 'remove') codes.filter((c) => REMOVED.test(c)).forEach((c) => { src = src.split('data-cbsid="' + c + '"').join(''); });
  if (mutate === 'swap' && codes.length > 1) src = src.split('"' + codes[0] + '"').join('"SWAPX"').split('"' + codes[1] + '"').join('"' + codes[0] + '"').split('"SWAPX"').join('"' + codes[1] + '"');
  srcOf[file] = src;
}
for (const file of Object.keys(srcOf)) {
  const pins = (PINS[file] || []).concat(EXTRA[file] || []);
  let found = 0;
  for (const [code, rest] of pins) {
    const needle = 'data-cbsid="' + code.replace(' data-cbmount', '" data-cbmount') + (code.indexOf(' data-cbmount') < 0 ? '"' : '') + rest;
    if (srcOf[file].indexOf(needle) >= 0) found++;
    else console.log('  FAIL ' + file + ': ' + code + ' is not in front of its own tag');
  }
  check(found === pins.length, file + '.js: ' + found + ' of ' + pins.length + ' codes sit in their own tag');
}
const own = (file, re) => (srcOf[file].match(re) || []).length;
check(own('cap-catalogue', /data-cbsid="CTG001-[A-Z][0-9]{2}"/g) === 9 && own('cap-catalogue', /data-cbsid="CTG003-[A-Z][0-9]{2}"/g) === 6, 'cap-catalogue.js: 9 Items and 6 Import codes (the Categories ones are the 5 CTG002 beside them)');
check(own('cap-entry', /data-cbsid="SCR022-B[0-9]{2}"|data-cbsid="SCR022-[ISBT][0-9]{2}"/g) === 18, 'cap-entry.js: 18 Entry codes of SCR022 (none of BKS002)');
check(srcOf['cap-entry'].indexOf('BKS002') < 0, 'cap-entry.js: no leftover BKS002 code');
check(own('cap-folders', /data-cbsid="SCR004-[A-Z][0-9]{2}"/g) === 19, 'cap-folders.js: 19 Folders codes of SCR004');

let reg = null;
for (const p of [process.env.UIID_REG, path.join(__dirname, '..', '..', 'chitbridge-docs', 'SCREENS.json'), 'C:/dev/SCREENS.json']) {
  if (p && fs.existsSync(p)) { try { reg = JSON.parse(fs.readFileSync(p, 'utf8')); break; } catch (e) { /* next */ } }
}
if (reg) {
  const rows = {}; Object.values(reg.screens || {}).forEach((r) => { if (r.code) rows[r.code] = r; });
  const all = [];
  for (const file of Object.keys(PINS)) PINS[file].forEach((p) => { const c = p[0].split(' ')[0]; if (/^(CTG|SCR)/.test(c)) all.push(c); });
  const missing = all.filter((c) => !rows[c]), retired = all.filter((c) => rows[c] && rows[c].retired);
  console.log('  register: ' + (all.length - missing.length) + ' of ' + all.length + ' codes found' + (missing.length ? ' (pending until the docs PR lands: ' + missing.length + ')' : ''));
  if (process.env.UIID_REG) check(!missing.length, "every code is in the register UIID_REG names (" + missing.length + " missing)"); /* a set register: a missing code FAILS, no pending */
  check(retired.length === 0, 'no code is retired in the register');
}
console.log(failures ? failures + ' FAILED' : 'ALL PASS');
process.exit(failures ? 1 : 0);
