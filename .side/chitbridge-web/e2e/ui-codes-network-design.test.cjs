'use strict';
// @type: unit
/**
 * ui-codes-network-design.test.cjs - the Network Lab page (network-design.html) (network-design.html) wears ITS identity codes (UX-137 stamp 12, screen NLB001).
 *
 * OWNS      the proof that every control of public/network-design.html carries a data-cbsid code of screen NLB001, that each code sits on ITS element
 *           (a marker that only that element carries must follow the code before the next code starts: a swap of two codes fails), that no code is
 *           written twice, that the page has exactly 23 coded elements, and that the codes are in the register and none is retired.
 *           A tag drawn by a map or a row builder (the lab rows, the step rail) wears ONE code for all its rows.
 * CALLED BY by hand and the QA gate: node e2e/ui-codes-network-design.test.cjs   (NETDESIGN_ID_MUTATE=swap or remove must fail it)
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 * Register  codes are looked up in UIID_REG, else ../chitbridge-docs/SCREENS.json, else C:/dev/SCREENS.json: a code not there yet is printed
 *           as pending (the docs PR lands the rows), a code the register calls retired fails.
 */
const fs = require('fs'), path = require('path');
const mutate = process.env.NETDESIGN_ID_MUTATE || '';
const BS = String.fromCharCode(92);
const PAGE = path.join(__dirname, '..', 'public', 'network-design.html');
const WINDOW = 400; /* how far after a code its own marker may sit when no other code starts first */

let src = fs.readFileSync(PAGE, 'utf8').split('\r\n').join('\n');
/* the code is written plain, or escaped (a backslash before each quote) inside a double-quoted JS string */
const literal = (code, escaped) => (escaped ? 'data-cbsid=' + BS + '"' + code + BS + '"' : 'data-cbsid="' + code + '"');
const cut = (code, escaped) => src.split(literal(code, escaped)).join('');
if (mutate === 'remove') src = cut('NLB001-B01', false);
if (mutate === 'swap') src = src.split('NLB001-B01').join('SWAPX').split('NLB001-B02').join('NLB001-B01').split('SWAPX').join('NLB001-B02');

let failures = 0;
const check = (ok, msg) => { console.log((ok ? '  ok ' : '  FAIL ') + msg); if (!ok) failures++; };

/** code -> a marker only its element carries (an id, a handler, or the label it is drawn with) */
const WANT = {
  'NLB001-I01': "class=\"nm\"",
  'NLB001-I02': "their handle",
  'NLB001-B01': "LAB.splice(",
  'NLB001-B02': "labAdd(true)",
  'NLB001-B03': "labAdd(false)",
  'NLB001-B04': "id=\"labGo\"",
  'NLB001-I03': "class=\"lsrch\"",
  'NLB001-C01': "id=\"ov\"",
  'NLB001-C02': "id=\"cartov\"",
  'NLB001-C03': "st0",
  'NLB001-C04': "openOv()\"><b>",
  'NLB001-C05': "item.n",
  'NLB001-I04': "class=\"srch\"",
  'NLB001-I05': "type=\"date\"",
  'NLB001-I06': "S.addr",
  'NLB001-I07': "S.note",
  'NLB001-C06': "go(0)",
  'NLB001-C07': "go(1)",
  'NLB001-B05': "closeOv()",
  'NLB001-B06': "S.step - 1",
  'NLB001-B07': "Store details",
  'NLB001-B08': "Save draft",
  'NLB001-B09': "class=\"pri\""
};

/** the text from a code up to the next code of the page (at most WINDOW characters): the tag it sits in */
function tagAfter(code) {
  const plain = src.indexOf(literal(code, false)), esc = src.indexOf(literal(code, true)), at = plain >= 0 ? plain : esc;
  if (at < 0) return null;
  const rest = src.slice(at + 12);
  const next = rest.search(/data-cbsid=/);
  return rest.slice(0, next >= 0 ? Math.min(next, WINDOW) : WINDOW);
}

for (const [code, marker] of Object.entries(WANT)) {
  const tag = tagAfter(code);
  check(tag !== null && tag.indexOf(marker) >= 0, code + ' sits on the element with ' + marker);
}

/** every code is written once; the page has exactly the 23 coded elements */
const written = [...src.matchAll(new RegExp('data-cbsid=' + BS + BS + '?"(NLB001-[A-Z][0-9]{2})' + BS + BS + '?"', 'g'))].map((m) => m[1]);
const dup = written.filter((c, i) => written.indexOf(c) !== i);
check(dup.length === 0, 'no code is written on two elements' + (dup.length ? ' (' + dup.join(',') + ')' : ''));
check(written.length === 23 && Object.keys(WANT).length === 23, 'the page has 23 coded elements, counted by code: ' + written.length + ' written, ' + Object.keys(WANT).length + ' expected');
check(!/data-cbsid="(?!NLB001-)/.test(src), 'no code of another screen is written on this page');


/** §7 minimums of a mock page: AA contrast of the page's own text colours, and no request that could fail unannounced */
const lum = (hex) => { const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const tok = (name) => (src.match(new RegExp('--' + name + ':(#[0-9a-fA-F]{6})')) || [])[1];
[['ink', '#ffffff', 'text on a card'], ['grey', '#ffffff', 'quiet text on a card']].forEach(([name, bg, what]) => {
  const fg = tok(name);
  check(!!fg && contrast(fg, bg) >= 4.5, 'AA contrast 4.5:1 for ' + what + ' (--' + name + ' ' + fg + ' on ' + bg + ' = ' + (fg ? contrast(fg, bg).toFixed(2) : 'n/a') + ')');
});
check(contrast('#ffffff', tok('blue')) >= 4.5, 'AA contrast 4.5:1 for white on the blue buttons and the current step');
check(src.indexOf("Could not check") > 0 && /catch[(]function [(]e[)]/.test(src), 'a check that could not reach the server says so in words on the page (Could not check - try again), not silence');

/** the register */
let reg = null;
for (const p of [process.env.UIID_REG, path.join(__dirname, '..', '..', 'chitbridge-docs', 'SCREENS.json'), 'C:/dev/SCREENS.json']) {
  if (p && fs.existsSync(p)) { try { reg = JSON.parse(fs.readFileSync(p, 'utf8')); break; } catch (e) { console.log('  note: register ' + p + ' did not parse (' + e.message + ')'); } }
}
if (reg) {
  const rows = {}; Object.values(reg.screens || {}).forEach((r) => { if (r.code) rows[r.code] = r; });
  const all = Object.keys(WANT), missing = all.filter((c) => !rows[c]), retired = all.filter((c) => rows[c] && rows[c].retired);
  console.log('  register: ' + (all.length - missing.length) + ' of ' + all.length + ' codes found' + (missing.length ? ' (pending until the docs PR lands: ' + missing.length + ')' : ''));
  if (process.env.UIID_REG) check(!missing.length, "every code is in the register UIID_REG names (" + missing.length + " missing)"); /* a set register: a missing code FAILS, no pending */
  check(retired.length === 0, 'no code is retired in the register');
}
console.log(failures ? failures + ' FAILED' : 'ALL PASS');
process.exit(failures ? 1 : 0);
