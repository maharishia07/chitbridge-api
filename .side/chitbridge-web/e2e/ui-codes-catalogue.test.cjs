'use strict';
// @type: unit
/**
 * ui-codes-catalogue.test.cjs - the Catalogue (categories) page wears ITS identity codes (UX-137, web-done "tagged" pass, screen CTG002).
 *
 * OWNS      the proof that cap-categories.js (the script only catalogue.html loads) tags every control with a data-cbsid code of screen CTG002,
 *           that each testid wears ITS code (a swap of two codes fails), that a code is never used by two element definitions, and that
 *           the tag was only added: the page's testids and handlers are untouched (every stamped tag still carries what it carried).
 * CALLED BY by hand and the QA gate: node e2e/ui-codes-catalogue.test.cjs   (CAT_ID_MUTATE=swap or remove must fail it)
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 * Register  codes are looked up in UIID_REG, else ../chitbridge-docs/SCREENS.json, else C:/dev/SCREENS.json: a code not there yet is printed
 *           as pending (the docs PR lands the rows), a code the register calls retired fails.
 */
const fs = require('fs'), path = require('path');
const mutate = process.env.CAT_ID_MUTATE || '';
let src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'cap-categories.js'), 'utf8').split('\r\n').join('\n');
if (mutate === 'remove') src = src.split('data-cbsid="CTG002-B03"').join('');
if (mutate === 'swap') src = src.split('CTG002-B03').join('SWAPX').split('CTG002-B04').join('CTG002-B03').split('SWAPX').join('CTG002-B04');
let failures = 0;
const check = (c, m) => { console.log((c ? '  ok ' : '  FAIL ') + m); if (!c) failures++; };

/** testid -> the code the tag that carries it must wear */
const WANT = { 'catg-sort': 'CTG002-S01', 'catg-seed-all': 'CTG002-B03', 'catg-seed-none': 'CTG002-B04', 'catg-seed-own': 'CTG002-I02', 'catg-seed-go': 'CTG002-B06',
  'catg-name': 'CTG002-I03', 'catg-save': 'CTG002-B08', 'catg-relive': 'CTG002-B11', 'catg-edit': 'CTG002-B12', 'catg-retire': 'CTG002-B13',
  'catg-prod-search': 'CTG002-I05', 'catg-uncat': 'CTG002-B16', 'catg-parent': 'CTG002-S02', 'catg-new': 'CTG002-B17', 'catg-seed"': 'CTG002-B18', 'catg-search': 'CTG002-I06' };
for (const [marker, code] of Object.entries(WANT)) {
  const needle = 'data-testid="' + marker.replace('"', '') + (marker.endsWith('"') ? '"' : '');
  const tag = src.split('\n').filter((l) => l.indexOf(needle) >= 0 && l.indexOf('data-cbsid') >= 0)[0] || '';
  check(tag.indexOf('data-cbsid="' + code + '"') >= 0 && tag.indexOf(needle) > tag.indexOf('data-cbsid="' + code + '"'), marker.replace(/"/g, '') + ' wears ' + code);
}
const all = {};
for (const m of src.matchAll(/data-cbsid="(CTG002-[A-Z][0-9]{2})"/g)) all[m[1]] = (all[m[1]] || 0) + 1;
const dup = Object.keys(all).filter((c) => all[c] > 1);
check(dup.length === 0, 'no code is used by two element definitions' + (dup.length ? ' (' + dup.join(',') + ')' : ''));
check(Object.keys(all).length === 31, 'the page has 31 tagged elements, counted by code: ' + Object.keys(all).length);
/** the stamp is the only change: with every data-cbsid attribute taken out, the dynamic testids of the page are all still in the source */
const bare = src.replace(/ data-cbsid="CTG002-[A-Z][0-9]{2}"/g, '');
check(bare.indexOf('data-testid="catg-seed-\' +') > 0 && bare.indexOf('data-testid="catg-etab-\' +') > 0 && bare.indexOf('data-testid="catg-offer-\' +') > 0 && bare.indexOf('data-testid="catg-row-\' +') > 0, 'the dynamic testids (seed set, editor tab, offer, row) are unchanged');

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
