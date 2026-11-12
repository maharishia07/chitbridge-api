#!/usr/bin/env node
// @type: unit
/**
 * reward-check.test.cjs — CAT-272: the numbers of a reward programme, by rule, hand-computed (lib/reward-check.js).
 *
 * OWNS      one case per rule: redeem points 0 / -1 / "abc" refused; money off with amount 0 / -1 refused; a named thing needs no amount; expires_months -1 / 1201 / 1e9 / "abc" refused,
 *           0 · blank · null · 12 · 1200 pass; nothing sent (no redeem list) is the engine's own business (null here). Fail-closed: a value that is not a number is refused, never read as 0.
 * CALLED BY scripts/guards.cjs · CI. No database, no network.
 * CARD      08-rewards-and-loyalty/README
 * Run: node tests/reward-check.test.cjs
 */
'use strict';
const { numbersRefusal, MAX_EXPIRES_MONTHS } = require('../lib/reward-check');

let failed = 0;
const check = (label, ok, detail) => {
  console.log((ok ? '  ok    ' : '  FAIL  ') + label + (ok ? '' : '  ' + JSON.stringify(detail)));
  if (!ok) failed += 1;
};
const money = (points, amount) => ({ redeem: [{ kind: 'money', points, amount }] });
const SPEND = /spend points needs points above 0/;
const EXPIRY = /0 to 1200 months/;

check('100 points = 1 passes', numbersRefusal(money(100, 1)) === null);
check('redeem points 0 refused', SPEND.test(numbersRefusal(money(0, 1))));
check('redeem points -1 refused', SPEND.test(numbersRefusal(money(-1, 1))));
check('redeem points "abc" refused (fail-closed, not read as 0)', SPEND.test(numbersRefusal(money('abc', 1))));
check('money off amount 0 refused', SPEND.test(numbersRefusal(money(100, 0))));
check('money off amount -1 refused (it added to the bill)', SPEND.test(numbersRefusal(money(100, -1))));
check('a named thing for 20,000 points needs no amount', numbersRefusal({ redeem: [{ kind: 'thing', points: 20000, name: 'a weekend away' }] }) === null);
check('one broken way among good ones is refused', SPEND.test(numbersRefusal({ redeem: [{ kind: 'money', points: 100, amount: 1 }, { kind: 'item', points: 0 }] })));
check('no redeem list: not this file\'s question (null)', numbersRefusal({}) === null);
for (const [months, refused] of [[-1, true], [1201, true], [1e9, true], ['abc', true], [0, false], ['', false], [null, false], [undefined, false], [12, false], ['12', false], [MAX_EXPIRES_MONTHS, false]]) {
  check('expires_months ' + JSON.stringify(months) + (refused ? ' refused' : ' passes'), refused === EXPIRY.test(numbersRefusal({ redeem: [], expires_months: months }) || ''));
}
console.log('\n' + (failed ? failed + ' failed' : 'all passed'));
process.exit(failed ? 1 : 0);
