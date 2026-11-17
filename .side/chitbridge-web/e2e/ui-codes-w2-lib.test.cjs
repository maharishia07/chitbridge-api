'use strict';
// @type: unit
/**
 * ui-codes-w2-lib.test.cjs - the shared library scripts and the Standards page wear their identity codes (UX-137, queue 359 lane w2-lib).
 *
 * OWNS      the proof that 23 elements drawn by shared scripts carry a data-cbsid code, that each code sits INSIDE its own tag (a marker only that
 *           element carries must follow the code before the next code starts, or sit just before it), that no code is written twice, and that
 *           the choice component's three tags in ui.js carry CMP025-B01 as a literal (a census could not see it while it came through a list).
 *           Screens: STD001 Standards (standards.html + its register script), SCR038 Helpers, SCR039 Step flow, SCR040 Attach, SCR041 List legacy,
 *           SCR042 Lab kit, SCR043 Kural, SCR044 Sides.
 * CALLED BY by hand and the QA gate: node e2e/ui-codes-w2-lib.test.cjs   (W2LIB_MUTATE=remove or swap must fail it)
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 * Register  codes are looked up in UIID_REG, else ../chitbridge-docs/SCREENS.json, else C:/dev/SCREENS.json: a code not there yet is printed
 *           as pending (the docs PR lands the rows), a code the register calls retired fails.
 */
const fs = require('fs'), path = require('path');
const mutate = process.env.W2LIB_MUTATE || '';
const BS = String.fromCharCode(92);
const PUB = path.join(__dirname, '..', 'public');
const WINDOW = 400; /* how far after a code its own marker may sit when no other code starts first */
const BEFORE = 200; /* how far before a code a marker may sit (two tags that differ only by what precedes them) */

const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8').split('\r\n').join('\n');
const SRC = {};
['standards.html', 'app/cap-standards.js', 'app/helpers.js', 'app/step-flow.js', 'app/attach-ui.js', 'app/list-legacy.js', 'app/lab-kit.js', 'app/kural.js', 'app/sides.js', 'app/ui.js'].forEach((f) => { SRC[f] = read(f); });

/* the code is written plain, or escaped (a backslash before each quote) inside a double-quoted JS string */
const literal = (code, escaped) => (escaped ? 'data-cbsid=' + BS + '"' + code + BS + '"' : 'data-cbsid="' + code + '"');
if (mutate === 'remove') SRC['standards.html'] = SRC['standards.html'].split(literal('STD001-B01', false)).join('');
if (mutate === 'swap') SRC['app/step-flow.js'] = SRC['app/step-flow.js'].split('SCR039-B01').join('SWAPX').split('SCR039-B02').join('SCR039-B01').split('SWAPX').join('SCR039-B02');

let failures = 0;
const check = (ok, msg) => { console.log((ok ? '  ok ' : '  FAIL ') + msg); if (!ok) failures++; };

/** code -> [file, marker after the code, marker before it (optional)] */
const WANT = {
  'STD001-B01': ['standards.html', 'role="columnheader"'],
  'STD001-B02': ['standards.html', 'role="rowheader"'],
  'STD001-B03': ['standards.html', 'role="gridcell"'],
  'STD001-B04': ['standards.html', 'std-open-why'],
  'STD001-B05': ['standards.html', 'std-open-record'],
  'STD001-B06': ['app/cap-standards.js', 'style="font:inherit'],
  'SCR038-B01': ['app/helpers.js', 'empty-act'],
  'SCR039-B01': ['app/step-flow.js', 'tidBack'],
  'SCR039-B02': ['app/step-flow.js', 'tidDraft'],
  'SCR039-B03': ['app/step-flow.js', 'class="pri"'],
  'SCR040-C01': ['app/attach-ui.js', 'cb-attach-item'],
  'SCR040-B01': ['app/attach-ui.js', 'cb-attach-btn'],
  'SCR041-I01': ['app/list-legacy.js', 'listctl-search-'],
  'SCR041-S01': ['app/list-legacy.js', 'listctl-filter-'],
  'SCR041-S02': ['app/list-legacy.js', 'listctl-sort-'],
  'SCR041-B01': ['app/list-legacy.js', 'lazyReveal', 'end of list'],
  'SCR041-B02': ['app/list-legacy.js', 'lazyReveal', 'sent.innerHTML'],
  'SCR042-B01': ['app/lab-kit.js', 'lk-confirm-ok'],
  'SCR042-B02': ['app/lab-kit.js', 'lk-more-'],
  'SCR043-B01': ['app/kural.js', 'kural-show'],
  'SCR043-B02': ['app/kural.js', 'kural-hide'],
  'SCR044-B01': ['app/sides.js', 'cbsd-fix'],
  'SCR044-B02': ['app/sides.js', 'sides-who-btn']
};

/** the text from a code up to the next code of the file (at most WINDOW characters): the tag it sits in */
function around(file, code) {
  const src = SRC[file], plain = src.indexOf(literal(code, false)), esc = src.indexOf(literal(code, true)), at = plain >= 0 ? plain : esc;
  if (at < 0) return null;
  const rest = src.slice(at + 12), next = rest.search(/data-cbsid=/);
  return { after: rest.slice(0, next >= 0 ? Math.min(next, WINDOW) : WINDOW), before: src.slice(Math.max(0, at - BEFORE), at) };
}

for (const [code, [file, marker, beforeMarker]] of Object.entries(WANT)) {
  const near = around(file, code);
  const ok = near !== null && near.after.indexOf(marker) >= 0 && (!beforeMarker || near.before.indexOf(beforeMarker) >= 0);
  check(ok, code + ' sits on the element with ' + marker + (beforeMarker ? ' (after "' + beforeMarker + '")' : ''));
}

/** every code is written once; each file holds exactly its own codes */
const written = [];
Object.keys(SRC).filter((f) => f !== 'app/ui.js').forEach((f) => {
  [...SRC[f].matchAll(new RegExp('data-cbsid=' + BS + BS + '?"((?:STD|SCR)0[0-9]{2}-[A-Z][0-9]{2})' + BS + BS + '?"', 'g'))].forEach((m) => written.push(m[1]));
});
const dup = written.filter((c, i) => written.indexOf(c) !== i);
check(dup.length === 0, 'no code is written on two elements' + (dup.length ? ' (' + dup.join(',') + ')' : ''));
check(written.length === 23 && Object.keys(WANT).length === 23, 'the files hold 23 coded elements, counted by code: ' + written.length + ' written, ' + Object.keys(WANT).length + ' expected');

/** ui.js: the three choice tags write the component code as a literal, none of them through the attribute list */
const choiceTags = SRC['app/ui.js'].split("'<button data-cbsid=" + '"CMP025-B01"' + " ' + attributeList(").length - 1;
check(choiceTags === 3, 'ui.js: three choice tags (radio item, menu option, phone trigger) write CMP025-B01 in the tag: ' + choiceTags);
check(SRC['app/ui.js'].indexOf("['data-cbsid', 'CMP025-B01']") < 0, 'ui.js: the choice attribute list no longer carries the code a second time');

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
