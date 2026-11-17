/**
 * e2e/rep-19-mis-overdue-words.test.cjs — REP-19 (proof 2026-11-14): the Reports tab (MIS) has an OVERDUE figure that NAMES ITS THRESHOLD.
 * @type regression
 * OWNS      the proof, on the REAL public/app/cap-mis.js run whole in a vm sandbox, that: the server's answer { overdue_days: 14, all: { overdue: 3 } } paints
 *           (1) the notice "Stuck = open for more than 14 days. Change it under Settings › Policy." (and "1 day" for 1: the threshold is named in words),
 *           (2) a row labelled "Stuck" carrying the server's 3 (received 1, sent 2) with no sum worked out in the browser, opening CRM › Chits › Stuck,
 *           (3) the row's next-level words "Open for longer than your stuck rule allows. Your own notes to yourself are never stuck."
 *           Engines tests/receivables.test.js covers the OVERDUE engine; this covers the MIS WORDS (the open item of REP-19).
 * CALLED BY .github/workflows/ci.yml (Offline guards). No browser, no network.
 * FLOW      server answer (stand-in) → FM.r → fmHead / fmRows / fmNext → the words
 *   node e2e/rep-19-mis-overdue-words.test.cjs
 */
'use strict';
const { loadScript } = require('./lib/lift-fn.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (info ? '\n          ' + String(info).slice(0, 300) : '')); } };

const sb = loadScript('public/app/cap-mis.js', {
  tx: (s) => s,
  txn: (one, many, n) => (Number(n) === 1 ? one : many).split('{count}').join(String(n)),
  esc: (s) => String(s), api: async () => ({}), trOn: () => false, trLoad() {}, ftNav() {}, CBList: {}, CBLocale: {}, FIN: {}, EP: {}
});
const answer = (days) => ({ overdue_days: days, all: { count: 10, open: 6, overdue: 3 }, received: { overdue: 1 }, sent: { overdue: 2 } });
sb.FM.state = 'ready';

/* hand-computed: threshold 14 → "14 days" (plural), threshold 1 → "1 day" (singular) */
sb.FM.r = answer(14);
let head = sb.fmHead();
let rule = head.notices.find((n) => n.tid === 'fm-rule');
ok('the threshold is named: "Stuck = open for more than 14 days. Change it under Settings › Policy."', !!rule && rule.text === 'Stuck = open for more than 14 days. Change it under Settings › Policy.', rule && rule.text);
sb.FM.r = answer(1);
rule = sb.fmHead().notices.find((n) => n.tid === 'fm-rule');
ok('a one-day threshold reads "1 day", not "1 days"', !!rule && rule.text === 'Stuck = open for more than 1 day. Change it under Settings › Policy.', rule && rule.text);
sb.FM.state = 'loading';
ok('while loading there is no rule line (no threshold is invented before the server answers)', !sb.fmHead().notices.some((n) => n.tid === 'fm-rule'));
sb.FM.state = 'ready';

sb.FM.r = answer(14);
const rows = sb.fmRows();
const stuck = rows.find((r) => r.key === 'overdue');
ok('the Stuck row exists, labelled "Stuck"', !!stuck && stuck.label === 'Stuck', JSON.stringify(stuck));
ok('it carries the server\'s figures untouched: all 3, received 1, sent 2 (no browser sum: 1 + 2 is not recomputed, all is the server\'s 3)', !!stuck && stuck.all === 3 && stuck.received === 1 && stuck.sent === 2, JSON.stringify(stuck));
ok('a figure is a door into CRM › Chits › Stuck', !!stuck && stuck.opens === 'CRM › Chits › Stuck' && stuck.door && stuck.door.all === '/crm.html#/chits?tab=stuck', JSON.stringify(stuck && stuck.door));
const next = sb.fmNext(stuck);
ok('its next-level words say what Stuck means and that your own notes are never stuck', next.includes('Open for longer than your stuck rule allows. Your own notes to yourself are never stuck.'), next);
sb.FM.r = { overdue_days: 14, all: { count: 10 } };
ok('an absent figure is a dash (null), never a 0 the server did not send', sb.fmRows().find((r) => r.key === 'overdue').all === null);

console.log('\n' + pass + ' ok, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
