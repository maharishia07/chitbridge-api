'use strict';
// @type: unit
/**
 * ui-codes-authority-forms.test.cjs - the Authority forms page (authority-forms.html) wears ITS identity codes (UX-137 utility page authority-forms, screen DOC001).
 *
 * OWNS      the proof that authority-forms.html tags its nine controls with DOC001-<kind><nn> (B button, I input, S select, C chip), that the
 *           letter is the tag's own kind, that the named controls wear THEIR code (a swap fails), that no code is on two tags, and that the
 *           stamp only added attributes (strip them and the source still carries every control id).
 * CALLED BY by hand and the QA gate: node e2e/ui-codes-authority-forms.test.cjs   (AUTHFORMS_ID_MUTATE=swap or remove must fail it)
 * FLOW      UX-137 step 3 (utility page authority-forms.html); the rows are written by the docs stamp run (toolset/ui-identity/ui-stamp.cjs, hand lines ui-stamp/authority-forms.json).
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 * Register  looked up in UIID_REG, else ../chitbridge-docs/SCREENS.json, else C:/dev/SCREENS.json: a code not there yet is printed as pending
 *           (the docs PR lands the rows), a code the register calls retired fails.
 */
const fs = require('fs'), path = require('path');
const mutate = process.env.AUTHFORMS_ID_MUTATE || '';
let src = fs.readFileSync(path.join(__dirname, '..', 'public', 'authority-forms.html'), 'utf8').split('\r\n').join('\n');
if (mutate === 'remove') src = src.split('data-cbsid="DOC001-B01"').join('');
if (mutate === 'swap') src = src.split('DOC001-B01').join('SWAPX').split('DOC001-B02').join('DOC001-B01').split('SWAPX').join('DOC001-B02');
let failures = 0;
const check = (c, m) => { console.log((c ? '  ok ' : '  FAIL ') + m); if (!c) failures++; };

const KIND = { button: 'B', input: 'I', select: 'S', textarea: 'T', span: 'C', a: 'C', div: 'C' };
const tags = [...src.matchAll(/<(button|input|select|textarea|span|a|div)\b([^>]*?data-cbsid="(DOC001-[A-Z][0-9]{2})"[^>]*)>/g)];
const codes = tags.map((t) => t[3]);
check(codes.length === 9, 'the authority forms page has 9 tagged elements, found ' + codes.length);
check(new Set(codes).size === codes.length, 'no code is on two tags');
const wrong = tags.filter((t) => KIND[t[1]] !== t[3].charAt(7));
check(wrong.length === 0, 'every code letter is its tag kind' + (wrong.length ? ' (' + wrong.map((t) => t[3]).join(',') + ')' : ''));

/** the attribute each control is found by -> the code its tag must wear */
const WANT = [
  ['id="issueBtn"', 'DOC001-B01'],
  ['onclick="resolve()"', 'DOC001-B02'],
  ['onclick="window.print()"', 'DOC001-B04'],
  ['onclick="attach(', 'DOC001-B06'],
];
for (const [needle, code] of WANT) {
  const tag = tags.filter((t) => t[2].indexOf(needle) >= 0)[0];
  check(!!tag && tag[3] === code, needle + ' wears ' + code);
}
/** the stamp is the only change: strip every attribute it writes and the control ids are all still in the source */
const bare = src.replace(/ data-cbsid="DOC001-[A-Z][0-9]{2}"/g, '');
check(bare.indexOf('id="issueBtn"') > 0 && bare.indexOf('id="signErr"') > 0 && !/data-cbsid="DOC001-/.test(bare), 'stripped: the ids stay and no DOC001 code is left');

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
