/**
 * e2e/ux-122-timeline-status-words.test.cjs — UX-122 (proof 2026-11-14): the chit timeline shows status WORDS, never raw codes like In_progress.
 * @type regression
 * OWNS      the proof, on the REAL statusWord / plainStatuses (public/app/helpers.js), statusLabel / statusEv (the full page's timeline, public/app.html) and
 *           histWord / histRowHTML (the chit sheet's history, public/app/chit-sheet.js), all lifted into vm sandboxes, that a state_log row on the LOCAL path
 *           ({ action: 'status_in_progress', detail: 'Status changed from pending to in_progress by Asha' }, lib/chit-move.js timelineDetail) and on the CTP path
 *           (the same shape written by lib/ctpreturn.js for another installation's party: 'status_on_hold', 'Status changed from accepted to on_hold by Far Co')
 *           renders "In progress" / "On hold", the detail "from Accepted to On hold", and NO snake_case code anywhere in the text. hand-computed words:
 *           in_progress → "In progress", on_hold → "On hold", partial → "Part done", completed → "Done"; an unknown code "waiting_for_stock" → "Waiting for stock".
 * CALLED BY .github/workflows/ci.yml (Offline guards). No browser, no network.
 * FLOW      state_log row → statusLabel + statusEv (page) / histRowHTML (sheet) → text → assertions
 *   node e2e/ux-122-timeline-status-words.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { liftFns } = require('./lib/lift-fn.cjs');
const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (info ? '\n          ' + String(info).slice(0, 400) : '')); } };
const between = (src, a, b) => { const i = src.indexOf(a); if (i < 0) throw new Error('not found: ' + a); const j = src.indexOf(b, i); return src.slice(i, j + b.length); };
const text = (h) => String(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const hasCode = (s) => /\b[a-z]+_[a-z_]+\b/i.test(s); /* a snake_case word: in_progress, On_hold, waiting_for_stock */

/* helpers.js: the one mapping */
const helpers = pub('app/helpers.js');
const wordsCode = between(helpers, 'var STATUS_WORDS = {', '\n};') + '\n' + liftFns('public/app/helpers.js', ['statusWord', 'plainStatuses']);
const H = vm.createContext({ tx: (s) => s }); vm.runInContext(wordsCode, H);
const word = (c) => vm.runInContext('statusWord(' + JSON.stringify(c) + ')', H), plain = (s) => vm.runInContext('plainStatuses(' + JSON.stringify(s) + ')', H);
ok('statusWord: in_progress → "In progress", on_hold → "On hold", partial → "Part done", completed → "Done"', word('in_progress') === 'In progress' && word('on_hold') === 'On hold' && word('partial') === 'Part done' && word('completed') === 'Done', [word('in_progress'), word('on_hold'), word('partial'), word('completed')].join('|'));
ok('statusWord: an unknown code is spaced and capitalised, never shown with its underscore ("waiting_for_stock" → "Waiting for stock"); mixed case is read ("In_Progress" → "In progress")', word('waiting_for_stock') === 'Waiting for stock' && word('In_Progress') === 'In progress' && word('') === '' && word(null) === '');
ok('plainStatuses turns the codes after from / to / → into words and leaves prose alone', plain('Status changed from pending to in_progress by Asha') === 'Status changed from Pending to In progress by Asha' && plain('already read it') === 'already read it', plain('Status changed from pending to in_progress by Asha'));

/* the full page: app.html statusLabel + statusEv */
const pageCode = liftFns('public/app.html', ['statusLabel', 'statusEv']);
const P = vm.createContext({ tx: (s) => s, esc: (s) => String(s), fmtLogTime: () => '10:32', statusWord: (c) => word(c), plainStatuses: (s) => plain(s) }); vm.runInContext(pageCode, P);
const rows = [
  { path: 'local', e: { action: 'status_in_progress', new_status: 'in_progress', action_by_display_name: 'Asha', created_at: '2026-11-14T05:00:00Z', detail: 'Status changed from pending to in_progress by Asha' }, label: 'Status → In progress', detail: 'Status changed from Pending to In progress by Asha' },
  { path: 'CTP', e: { action: 'status_on_hold', new_status: 'on_hold', action_by_display_name: 'Far Co', created_at: '2026-11-14T05:01:00Z', detail: 'Status changed from accepted to on_hold by Far Co' }, label: 'Status → On hold', detail: 'Status changed from Accepted to On hold by Far Co' },
  { path: 'old row with only new_status', e: { action: 'moved', new_status: 'in_progress', action_by_display_name: 'Asha', created_at: '2026-11-14T05:02:00Z' }, label: 'moved → In progress', detail: '' }
];
rows.forEach((r) => {
  const label = P.statusLabel(r.e), ev = text(P.statusEv(r.e));
  ok('page timeline (' + r.path + '): label "' + r.label + '" and no raw code in the row', label === r.label && !hasCode(ev) && (!r.detail || ev.includes(r.detail)), label + ' | ' + ev);
});

/* the chit sheet: histWord + histRowHTML inside the IIFE at indent 2 */
const sheet = pub('app/chit-sheet.js');
const sheetCode = between(sheet, '  var STEP = {', '\n  };') + '\n' + between(sheet, '  var LOGWORD = {', '\n  };') + '\n' + liftFns('public/app/chit-sheet.js', ['histWord', 'histRowHTML'], '  ');
const S = vm.createContext({ T: (s) => s, tf: (s, v) => s.replace('{what}', v.what).replace('{who}', v.who), esc: (s) => String(s), when: () => '10:32', statusWord: (c) => word(c) }); vm.runInContext(sheetCode, S);
const sheetRows = [
  { path: 'local', e: { action: 'status_in_progress', action_by_display_name: 'Asha', created_at: 't' }, said: 'In progress by Asha' },
  { path: 'CTP', e: { action: 'status_on_hold', action_by_display_name: 'Far Co', created_at: 't' }, said: 'On hold by Far Co' },
  { path: 'a status with no action word (new_status only)', e: { action: '', new_status: 'partial', created_at: 't' }, said: 'Part done' },
  { path: 'a verb the sheet owns', e: { action: 'status_pending', action_by_display_name: 'Asha', created_at: 't' }, said: 'To accept by Asha' }
];
sheetRows.forEach((r) => {
  const row = text(S.histRowHTML(r.e, 0));
  ok('sheet history (' + r.path + '): "' + r.said + '", no raw code', row.includes(r.said) && !hasCode(row), row);
});
const allCodes = ['pending', 'delivered', 'read', 'accepted', 'in_progress', 'partial', 'completed', 'cancelled', 'rejected', 'on_hold', 'disputed', 'draft'];
ok('every status code of the rail reads as words on both timelines (no underscore, no lower-case code)', allCodes.every((c) => !hasCode(P.statusLabel({ action: 'status_' + c })) && !hasCode(S.histWord({ action: 'status_' + c })) && /^[A-Z]/.test(S.histWord({ action: 'status_' + c }))), allCodes.map((c) => S.histWord({ action: 'status_' + c })).join(' · '));

console.log('\n' + pass + ' ok, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
