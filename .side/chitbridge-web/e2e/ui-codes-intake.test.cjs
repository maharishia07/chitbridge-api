'use strict';
// @type: unit
/**
 * ui-codes-intake.test.cjs - the Intake inbox page (intake.html) wears ITS identity codes (UX-137 utility page intake, screen WRK003).
 *
 * OWNS      the proof that intake.html tags its ten controls with WRK003-<kind><nn> (B button, I input, S select, T textarea), that the
 *           letter is the tag's own kind, that the named testids wear THEIR code (a swap fails), that no code is on two tags, and that
 *           the stamp only added attributes (strip them and the source still carries every testid).
 * CALLED BY by hand and the QA gate: node e2e/ui-codes-intake.test.cjs   (INTAKE_ID_MUTATE=swap or remove must fail it)
 * FLOW      UX-137 step 3 (utility page intake.html); the rows are written by the docs stamp run (toolset/ui-identity/ui-stamp.cjs, hand lines ui-stamp/intake.json).
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 * Register  looked up in UIID_REG, else ../chitbridge-docs/SCREENS.json, else C:/dev/SCREENS.json: a code not there yet is printed as pending
 *           (the docs PR lands the rows), a code the register calls retired fails.
 */
const fs = require('fs'), path = require('path');
const mutate = process.env.INTAKE_ID_MUTATE || '';
let src = fs.readFileSync(path.join(__dirname, '..', 'public', 'intake.html'), 'utf8').split('\r\n').join('\n');
if (mutate === 'remove') src = src.split('data-cbsid="WRK003-B02"').join('');
if (mutate === 'swap') src = src.split('WRK003-B02').join('SWAPX').split('WRK003-B03').join('WRK003-B02').split('SWAPX').join('WRK003-B03');
let failures = 0;
const check = (c, m) => { console.log((c ? '  ok ' : '  FAIL ') + m); if (!c) failures++; };

const KIND = { button: 'B', input: 'I', select: 'S', textarea: 'T', span: 'C', a: 'C', div: 'C' };
const tags = [...src.matchAll(/<(button|input|select|textarea|span|a|div)\b([^>]*?data-cbsid="(WRK003-[A-Z][0-9]{2})"[^>]*)>/g)];
const codes = tags.map((t) => t[3]);
check(codes.length === 10, 'the intake page has 10 tagged elements, found ' + codes.length);
check(new Set(codes).size === codes.length, 'no code is on two tags');
const wrong = tags.filter((t) => KIND[t[1]] !== t[3].charAt(7));
check(wrong.length === 0, 'every code letter is its tag kind' + (wrong.length ? ' (' + wrong.map((t) => t[3]).join(',') + ')' : ''));

/** the attribute each control is found by -> the code its tag must wear */
const WANT = [
  ['data-testid="cap-channel"', 'WRK003-S01'],
  ['data-testid="cap-from"', 'WRK003-I03'],
  ['data-testid="cap-text"', 'WRK003-T01'],
  ['data-testid="cap-simulate"', 'WRK003-B02'],
  ['data-testid="cap-structure"', 'WRK003-B03'],
  ['data-testid="cap-create-chit"', 'WRK003-B05'],
];
for (const [needle, code] of WANT) {
  const tag = tags.filter((t) => t[2].indexOf(needle) >= 0)[0];
  check(!!tag && tag[3] === code, needle.replace('data-testid="', '').replace('"', '') + ' wears ' + code);
}
/** the stamp is the only change: strip every attribute it writes and the testids are all still in the source */
const bare = src.replace(/ data-cbsid="WRK003-[A-Z][0-9]{2}"/g, '');
check(bare.indexOf('data-testid="cap-channel"') > 0 && bare.indexOf('data-testid="cap-create-chit"') > 0 && !/data-cbsid="WRK003-/.test(bare), 'stripped: the testids stay and no WRK003 code is left');

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
