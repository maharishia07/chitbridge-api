/**
 * books-statement-term.test.cjs — l16-country: the balance sheet's Current / Non-current groups come from the shop's COUNTRY PACK, and India alone has the Schedule III ageing schedule.
 * OWNS      the proof on N.termGroups and books-statement-ageing.rowsOf, with every figure hand-worked (minor units), on the real AU / IN / AE packs.
 * CALLED BY node tests/books-statement-term.test.cjs (offline, no server, no database)
 *
 * Hand figures: assets plant 100000 (non-current) + cash 30000 (current) → current 30000 · non-current 100000; liabilities overdraft 20000 (current) + loan 50000 (no term) → current 20000 · unclassified 50000;
 * a month ago cash 10000, a year ago none (null prior stays null on the group).
 * India's receivables ageing: 5 buckets of six: not due 1000 + 200 disputed; 6m-1y 300 → total 1500; the payable side has five buckets.
 */
'use strict';
const N = require('../lib/books-statement-notes');
const A = require('../lib/books-statement-ageing');
const B = require('../lib/books');
let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };

const assets = [{ amount_minor: 100000, term: 'non_current', prior_month_minor: 100000, prior_year_minor: null }, { amount_minor: 30000, term: 'current', prior_month_minor: 10000, prior_year_minor: null }];
const g = N.termGroups(assets, (x) => x.term);
ok(g.map((x) => x.term).join() === 'current,non_current', 'current first, then non-current: ' + g.map((x) => x.term));
ok(g[0].amount_minor === 30000 && g[1].amount_minor === 100000, 'sub-totals 30000 and 100000');
ok(g[0].prior_month_minor === 10000 && g[0].prior_year_minor === null, 'a missing prior stays null, never 0');
const liab = N.termGroups([{ amount_minor: 20000, term: 'current' }, { amount_minor: 50000, term: null }], (x) => x.term);
ok(liab.map((x) => x.term + ':' + x.amount_minor).join() === 'current:20000,unclassified:50000', 'a ledger with no term is unclassified, said so: ' + JSON.stringify(liab));
ok(N.termGroups([], () => null).length === 0, 'no rows, no groups');

['AU', 'IN', 'AE'].forEach((id) => {
  const p = B.packOf({ country: id }).presentation;
  ok(typeof p.termCite === 'string' && p.termCite.length > 10, id + ': the pack cites its standard for the term: ' + p.termCite);
});
const IN = B.packOf({ country: 'IN' }).presentation;
const aged = { buckets: { undisputed: { not_due: 1000, m6_1y: 300 }, disputed: { not_due: 200 } } };
const r = A.rowsOf(IN.ageing.receivable, IN.statementAgeing.receivable, aged);
ok(r.rows.length === 6 && r.total_minor === 1500, 'India receivables: six buckets, total 1500: ' + r.rows.length + ' / ' + r.total_minor);
ok(r.rows[0].label === 'Not due' && r.rows[0].undisputed_minor === 1000 && r.rows[0].disputed_minor === 200 && r.rows[0].total_minor === 1200, 'not due 1000 + 200 disputed = 1200');
ok(A.rowsOf(IN.ageing.payable, IN.statementAgeing.payable, { buckets: { undisputed: {}, disputed: {} } }).rows.length === 5, 'India payables: five buckets');
ok(!B.packOf({ country: 'AU' }).presentation.statementAgeing && !B.packOf({ country: 'AE' }).presentation.statementAgeing, 'AU and AE have no statement ageing note');
A.statementAgeing(null, null, [], B.packOf({ country: 'AU' }), '2026-07-01', 0).then((v) => { ok(v === null, 'a pack without the note: no schedule, no read'); process.exitCode = bad ? 1 : 0; });
