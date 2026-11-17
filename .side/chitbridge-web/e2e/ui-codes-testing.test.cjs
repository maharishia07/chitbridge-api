'use strict';
// @type: unit
/**
 * ui-codes-testing.test.cjs - the Test board page (testing.html) wears ITS identity codes (UX-137 stamp 10, screen OWN003).
 *
 * OWNS      the proof that every control of public/testing.html carries a data-cbsid code of screen OWN003, that each code sits on ITS element
 *           (a marker that only that element carries must follow the code before the next code starts: a swap of two codes fails), that no code is
 *           written twice, that the page has exactly 64 coded elements, and that the codes are in the register and none is retired.
 *           A tag drawn by a map or a row builder (the example buttons, the Pass / Fail row, the summary switch) wears ONE code for all its rows.
 * CALLED BY by hand and the QA gate: node e2e/ui-codes-testing.test.cjs   (TESTING_ID_MUTATE=swap or remove must fail it)
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 * Register  codes are looked up in UIID_REG, else ../chitbridge-docs/SCREENS.json, else C:/dev/SCREENS.json: a code not there yet is printed
 *           as pending (the docs PR lands the rows), a code the register calls retired fails.
 */
const fs = require('fs'), path = require('path');
const mutate = process.env.TESTING_ID_MUTATE || '';
const BS = String.fromCharCode(92);
const PAGE = path.join(__dirname, '..', 'public', 'testing.html');
const WINDOW = 400; /* how far after a code its own marker may sit when no other code starts first */

let src = fs.readFileSync(PAGE, 'utf8').split('\r\n').join('\n');
/* the code is written plain, or escaped (a backslash before each quote) inside a double-quoted JS string */
const literal = (code, escaped) => (escaped ? 'data-cbsid=' + BS + '"' + code + BS + '"' : 'data-cbsid="' + code + '"');
const cut = (code, escaped) => src.split(literal(code, escaped)).join('');
if (mutate === 'remove') src = cut('OWN003-B01', false);
if (mutate === 'swap') src = src.split('OWN003-B01').join('SWAPX').split('OWN003-B02').join('OWN003-B01').split('SWAPX').join('OWN003-B02');

let failures = 0;
const check = (ok, msg) => { console.log((ok ? '  ok ' : '  FAIL ') + msg); if (!ok) failures++; };

/** code -> a marker only its element carries (an id, a handler, or the label it is drawn with) */
const WANT = {
  'OWN003-B01': "setView('cases')", 'OWN003-B02': "setView('summary')", 'OWN003-B03': "setView('report')", 'OWN003-B04': "setView('reliability')", 'OWN003-B05': "setView('try')",
  'OWN003-S01': 'id="f_pview"', 'OWN003-B06': 'textSize(-1)', 'OWN003-B07': 'textSize(1)', 'OWN003-S02': 'id="f_type"', 'OWN003-S03': 'id="f_area"',
  'OWN003-I01': 'id="f_q"', 'OWN003-B08': 'id="f_clear"', 'OWN003-S04': 'id="p_rows"', 'OWN003-S05': 'id="p_cols"', 'OWN003-S06': 'id="f_kind"',
  'OWN003-I02': 'id="f_run"', 'OWN003-I03': 'id="f_proj"', 'OWN003-I04': 'id="f_who"', 'OWN003-B09': 'newRun()', 'OWN003-B10': 'onclick="seed()"',
  'OWN003-B11': 'exportFeature()', 'OWN003-B12': "getElementById('f_file').click()", 'OWN003-I05': 'id="f_file"', 'OWN003-B13': "getElementById('f_res').click()",
  'OWN003-I06': 'id="f_res"', 'OWN003-B14': 'title="Dismiss"', 'OWN003-B15': 'Load the test cases', 'OWN003-C01': 'setState(',
  'OWN003-B16': 'chipTo(', 'OWN003-I07': 'id="tm_amt"', 'OWN003-S07': 'id="tm_cur"', 'OWN003-S08': 'id="tm_send"', 'OWN003-S09': 'id="tm_recv"',
  'OWN003-B17': 'tryMoney()">Run', 'OWN003-B18': "setVal('tm_amt'", 'OWN003-I08': 'id="tn_text"', 'OWN003-I09': 'id="tn_qty"', 'OWN003-B19': 'tryNums()">Run',
  'OWN003-B20': "setVal('tn_text'", 'OWN003-I10': 'id="td_cty"', 'OWN003-I11': 'id="td_till"', 'OWN003-I12': 'id="td_seq"', 'OWN003-B21': 'tryDoc()">Run',
  'OWN003-B22': "setVal('td_cty'", 'OWN003-B23': 'window.print()', 'OWN003-B24': 'Summary</button></div>', 'OWN003-C02': 'big clickable', 'OWN003-C03': 'item.k',
  'OWN003-C04': 'tnode', 'OWN003-B25': "SUMVIEW === 'table'", 'OWN003-B26': "SUMVIEW === 'tree'", 'OWN003-B27': "SUMVIEW === 'folder'", 'OWN003-B28': "SUMVIEW === 'menu'",
  'OWN003-B29': 'Back to the summary', 'OWN003-B30': 'foldAll(true)', 'OWN003-B31': 'foldAll(false)', 'OWN003-C05': 'class="chead"', 'OWN003-B32': 'runCase(',
  'OWN003-I13': 'id="n_', 'OWN003-B33': "'pass')", 'OWN003-B34': "'fail')", 'OWN003-B35': "'blocked')", 'OWN003-B36': "'skipped')", 'OWN003-B37': 'caseHistory('
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

/** every code is written once; the page has exactly the 64 coded elements */
const written = [...src.matchAll(new RegExp('data-cbsid=' + BS + BS + '?"(OWN003-[A-Z][0-9]{2})' + BS + BS + '?"', 'g'))].map((m) => m[1]);
const dup = written.filter((c, i) => written.indexOf(c) !== i);
check(dup.length === 0, 'no code is written on two elements' + (dup.length ? ' (' + dup.join(',') + ')' : ''));
check(written.length === 64 && Object.keys(WANT).length === 64, 'the page has 64 coded elements, counted by code: ' + written.length + ' written, ' + Object.keys(WANT).length + ' expected');
check(!/data-cbsid="(?!OWN003-)/.test(src), 'no code of another screen is written on this page');

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
