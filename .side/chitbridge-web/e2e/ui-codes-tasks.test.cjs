'use strict';
// @type: unit
/**
 * ui-codes-tasks.test.cjs - the Tasks & Orders page wears ITS identity codes (UX-137, web-done "tagged" pass, screens TSK003, TSK006, TSK007).
 *
 * OWNS      the proof that cap-tasks.js, cap-dispute.js and cap-assist.js (scripts only tasks.html loads) tag every control with a data-cbsid
 *           code of screens TSK003 (board), TSK006 (disputes), TSK007 (assist), that each testid / id wears ITS code (a swap of two codes fails), that a code is never used by two
 *           element definitions, and that CBTasks.actRow (the one builder of the greyed-when-refused action) writes the code its caller passes
 *           and nothing else about the button changed (id, testid, title, disabled stay as before).
 * CALLED BY by hand and the QA gate: node e2e/ui-codes-tasks.test.cjs   (TASKS_ID_MUTATE=swap or remove must fail it)
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 * Register  codes are looked up in UIID_REG, else ../chitbridge-docs/SCREENS.json, else C:/dev/SCREENS.json: a code not there yet is printed
 *           as pending (the docs PR lands the rows), a code the register calls retired fails.
 */
const fs = require('fs'), path = require('path');
const mutate = process.env.TASKS_ID_MUTATE || '';
const FILES = ['cap-tasks.js', 'cap-dispute.js', 'cap-assist.js'];
const read = (f) => {
  let t = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', f), 'utf8').split('\r\n').join('\n');
  if (mutate === 'remove') t = t.split('data-cbsid="TSK007-B01"').join('');
  if (mutate === 'swap') t = t.split('TSK007-B01').join('SWAPX').split('TSK007-B02').join('TSK007-B01').split('SWAPX').join('TSK007-B02');
  return t;
};
let failures = 0;
const check = (c, m) => { console.log((c ? '  ok ' : '  FAIL ') + m); if (!c) failures++; };
const src = {}; FILES.forEach((f) => (src[f] = read(f)));

/** marker (testid or id) -> the code the tag that carries it must wear */
const WANT = {
  'cap-tasks.js': { 'tk-retry': 'TSK003-B01', 'tk-view': 'TSK003-S01', 'tk-new"': 'TSK003-B02', 'id="tk_x"': 'TSK003-B03', 'id="tk_sheet_retry"': 'TSK003-B04',
    'tk-reason"': 'TSK003-I01', 'tk-reason-go': 'TSK003-B11', 'id="tk_who_sel"': 'TSK003-S02', 'id="tk_who_go"': 'TSK003-B12', 'tk-deliver-qty': 'TSK003-I02',
    'tk-deliver-go': 'TSK003-B13', 'tk-new-what': 'TSK003-I03', 'tk-new-go': 'TSK003-B14' },
  'cap-dispute.js': { 'id="adv_disp"': 'TSK006-I01', 'dispute-category': 'TSK006-S03', 'dispute-reason"': 'TSK006-T01', 'dispute-raise': 'TSK006-B10',
    'dispute-resolve-note': 'TSK006-T02', 'dispute-resolve-submit': 'TSK006-B12', 'dp-retry': 'TSK006-B13', 'dp-prev': 'TSK006-B14', 'dp-next': 'TSK006-B15',
    'id="dp_cat"': 'TSK006-S04', 'id="dp_reason"': 'TSK006-T03', 'dp-raise-go': 'TSK006-B18', 'id="dp_sheet_retry"': 'TSK006-B19', 'dp-rwho': 'TSK006-S05',
    'dp-rnote': 'TSK006-T04', 'dp-rgo': 'TSK006-B21' },
  'cap-assist.js': { 'ca-retry': 'TSK007-B01', 'id="ca_q"': 'TSK007-I01', 'ca-draft': 'TSK007-B02', 'id="ca_a"': 'TSK007-T01', 'id="ca_c"': 'TSK007-I02', 'ca-reject': 'TSK007-B04' }
};
/** the helper call sites pass their code as the last argument of actRow */
const CALLS = { 'cap-tasks.js': ['TSK003-B05', 'TSK003-B06', 'TSK003-B07', 'TSK003-B08', 'TSK003-B09', 'TSK003-B10'], 'cap-dispute.js': ['TSK006-B16', 'TSK006-B20'], 'cap-assist.js': ['TSK007-B03'] };

for (const f of FILES) {
  for (const [marker, code] of Object.entries(WANT[f])) {
    const tag = src[f].split('\n').filter((l) => l.indexOf(marker) >= 0 && l.indexOf('<') >= 0)[0] || '';
    check(tag.indexOf('data-cbsid="' + code + '"') >= 0, f + ' ' + marker.replace(/"/g, '') + ' wears ' + code);
  }
  for (const code of CALLS[f]) check(src[f].indexOf("'" + code + "'") >= 0, f + ' passes ' + code + ' to actRow');
}

/** every literal code of the three files is of the three TSK screens, written once per element definition */
const all = {};
for (const f of FILES) {
  for (const m of src[f].matchAll(/data-cbsid="(TSK00[367]-[A-Z][0-9]{2})"/g)) (all[m[1]] = all[m[1]] || []).push(f);
  for (const c of CALLS[f]) (all[c] = all[c] || []).push(f);
}
const dup = Object.keys(all).filter((c) => all[c].length > 1);
check(dup.length === 0, 'no code is used by two element definitions' + (dup.length ? ' (' + dup.join(',') + ')' : ''));
check(Object.keys(all).length === 60, 'the page has 60 tagged elements, counted by code: ' + Object.keys(all).length);
check(src['cap-tasks.js'].indexOf('function actRow(id, label, verdict, extra, className, stampCode)') >= 0, 'actRow takes the stamp code as its 6th parameter');
check(src['cap-dispute.js'].indexOf('root.CBTasks.actRow(id, label, verdict, extra, className, stampCode)') >= 0, 'the dispute wrapper hands the code on');

/** actRow itself: drawn with stubs, the code is on the button and the rest of the button is what it was */
const body = src['cap-tasks.js'].slice(src['cap-tasks.js'].indexOf('function actRow('), src['cap-tasks.js'].indexOf('/* ── the list (O2C step 3'));
const actRow = new Function('esc', 'sayOf', body + '; return actRow;')((s) => String(s), (v) => (v && v.say) || '');
const okRow = actRow('tk_x1', 'Assign', { ok: true }, '', '', 'TSK003-B06');
check(okRow.indexOf('<button data-cbsid="TSK003-B06" type="button" class="act quiet" id="tk_x1" data-testid="tk_x1"') > 0, 'an allowed action: code, class, id and testid as drawn before');
const noRow = actRow('tk_x2', 'Assign', { ok: false, say: 'Not yours' }, '', '', 'TSK003-B06');
check(/aria-disabled="true" disabled title="Not yours"/.test(noRow) && noRow.indexOf('data-testid="tk_x2-why"') > 0, 'a refused action: still greyed, the why still shown');

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
