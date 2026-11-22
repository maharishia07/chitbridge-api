#!/usr/bin/env node
// @type: unit
/**
 * be-1129.test.cjs — WALK BE (India, 22 Nov): the counter's Earlier bills.
 * OWNS      BE-F-07 words half: a bill with no Return button is explained ONCE, in a line that is shown (not behind a click): only bills of the last 30 days rung on this
 *           counter can be returned there; a seat that cannot take returns says so; no line when every bill can be returned. Run on the till master's own function.
 * NOT OWNED the back-office "Credit note" door on a bill (the screen half): see the lane report (no web door composes a credit note; the api takes one as a chit).
 * CALLED BY CI (T1). No database.
 * FLOW      till master text -> earlierNoReturn lifted by name -> asserts
 * CARD      09-counter/README
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8');
const at = src.indexOf('function earlierNoReturn('), body = src.slice(at, src.indexOf('\n}\n', at) + 3);
assert.ok(at > 0, 'earlierNoReturn is in the till master');
const run = (can, rows, held) => {
  const sb = { RET_DAYS: 30, retCanIssue: () => can, isReturnRow: (b) => b.kind === 'credit_note', isExpenseRow: (b) => b.kind === 'expense' };
  vm.createContext(sb);
  vm.runInContext(body + '\nthis.out = earlierNoReturn(ROWS, HELD);', Object.assign(sb, { ROWS: rows, HELD: held }));
  return sb.out;
};
const rows = [{ no: 'A1' }, { no: 'A2' }, { no: 'A3' }, { no: 'CN1', kind: 'credit_note' }, { no: 'X1', kind: 'expense' }];
const three = run(true, rows, { A1: true });
assert.ok(/data-testid="till-earlier-noreturn"/.test(three) && /2 bills have no Return button/.test(three) && /last 30 days that were rung on this counter/.test(three), three);
assert.strictEqual((three.match(/no Return button/g) || []).length, 1, 'said once, not per row');
console.log('  ok  two bills the counter does not hold: one shown line says why (a credit note and an expense are not counted)');
assert.ok(/^<div[^>]*>1 bill has no Return/.test(run(true, rows.slice(0, 2), { A1: true })));
console.log('  ok  one bill reads in the singular');
assert.strictEqual(run(true, rows.slice(0, 2), { A1: true, A2: true }), '');
console.log('  ok  every bill returnable: no line');
assert.ok(/cannot take a return/.test(run(false, rows, {})));
console.log('  ok  a counter that cannot issue returns says so');
console.log('4 checks passed');
