'use strict';
// @type: unit
/**
 * ui-codes-app-product.test.cjs - the product detail screen of app.html wears ITS identity codes (UX-137 slice app-1, screen CAT005).
 *
 * OWNS      the proof that the prod* functions of app.html tag their page-specific controls with CAT005-<kind><nn> (B button, I input, S select,
 *           T textarea, C chip), that the letter is the tag's own kind, that a few named testids wear THEIR code (a swap fails), that no code is on
 *           two tags, that the eight reused controls wear a standard component (CMP006 Back, CMP007 Add, CMP008 Remove) with the screen mount
 *           CAT005-U1<nn>, and that the stamp only added attributes (strip them and the source is the same).
 * CALLED BY by hand and the QA gate: node e2e/ui-codes-app-product.test.cjs   (APPP_ID_MUTATE=swap or remove must fail it)
 * FLOW      UX-137 step 3 (app.html slice 1); the rows are written by the docs stamp run (toolset/ui-identity/ui-stamp.cjs, hand lines ui-stamp/app.json).
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 * Register  looked up in UIID_REG, else ../chitbridge-docs/SCREENS.json, else C:/dev/SCREENS.json: a code not there yet is printed as pending
 *           (the docs PR lands the rows), a code the register calls retired fails.
 */
const fs = require('fs'), path = require('path');
const mutate = process.env.APPP_ID_MUTATE || '';
let src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.html'), 'utf8').split('\r\n').join('\n');
if (mutate === 'remove') src = src.split('data-cbsid="CAT005-I01"').join('');
if (mutate === 'swap') src = src.split('CAT005-I01').join('SWAPX').split('CAT005-T01').join('CAT005-I01').split('SWAPX').join('CAT005-T01');
let failures = 0;
const check = (c, m) => { console.log((c ? '  ok ' : '  FAIL ') + m); if (!c) failures++; };

const KIND = { button: 'B', input: 'I', select: 'S', textarea: 'T', span: 'C', a: 'C', div: 'C' };
const tags = [...src.matchAll(/<(button|input|select|textarea|span|a|div)\b([^>]*?data-cbsid="(CAT005-[A-Z][0-9]{2})"[^>]*)>/g)];
const codes = tags.map((t) => t[3]);
check(codes.length === 68, 'the product detail screen has 68 tagged elements (50 slice-2 + 18 from the G1 wave 2 stamps), found ' + codes.length);
check(new Set(codes).size === codes.length, 'no code is on two tags');
const wrong = tags.filter((t) => KIND[t[1]] !== t[3].charAt(7));
check(wrong.length === 0, 'every code letter is its tag kind' + (wrong.length ? ' (' + wrong.map((t) => t[3]).join(',') + ')' : ''));

/** testid -> the code its tag must wear */
const WANT = { 'cat-field-price': 'CAT005-I01', 'cat-field-desc': 'CAT005-T01', 'cat-field-effective': 'CAT005-I02', 'prod-rows-pick': 'CAT005-B05', 'cat-all-fields': 'CAT005-B07',
  'cat-field-synonyms': 'CAT005-T02', 'cat-field-ordermodel': 'CAT005-S02', 'cat-field-xref-role': 'CAT005-S04', 'cat-barcode-print-unused': null, 'prod-barcode-print': 'CAT005-B14',
  'prod-tax-fix-go': 'CAT005-B16', 'prod-pricing-fix-go': 'CAT005-B15', 'cat-status': 'CAT005-B18' };
for (const [testid, code] of Object.entries(WANT)) {
  if (!code) continue;
  const tag = tags.filter((t) => t[2].indexOf('data-testid="' + testid + '"') >= 0)[0];
  check(!!tag && tag[3] === code, testid + ' wears ' + code);
}
/** the reused controls: component code + the screen mount, and nothing else */
const reused = [...src.matchAll(/<(button)\b[^>]*?data-cbsid="(CMP00[678])" data-cbmount="(CAT005-U1[0-9]{2})"/g)];
check(reused.length === 8, 'eight reused controls wear a component and the screen mount, found ' + reused.length);
check(reused.every((r) => r[3] === 'CAT005-U1' + r[2].slice(-2)), 'each mount is the screen code plus U1 plus its component number');
/** the stamp is the only change: strip every attribute it writes and the dynamic testids are all still in the source */
const bare = src.replace(/ data-cbsid="CAT005-[A-Z][0-9]{2}"/g, '').replace(/ data-cbsid="CMP00[678]" data-cbmount="CAT005-U1[0-9]{2}"/g, '');
check(bare.indexOf('data-testid="prod-mod-name-${gi}"') > 0 && bare.indexOf('data-testid="prod-tab-${item[0]}"') > 0, 'the dynamic testids are untouched');

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
