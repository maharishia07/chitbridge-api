/**
 * pe-gst-still.test.cjs: ACC-336. The pay form after a month or return close asks only for what is STILL to pay.
 * CARD 14-accounting/period-end · owns: the proof of cap-period.js peGstStillMinor / peGstStillTotal / peGstRcmStill · called by: npm run check
 *
 * The server (api lib/books-period.js paidFigures) sends still_to_pay_minor per forward head and still_to_pay_total_minor
 * (reverse charge included), never a per-head still for reverse charge. Asserted, each with the failure it prevents:
 *   1. forward heads default to still_to_pay_minor, not the owed-before-payments figure
 *   2. reverse charge defaults to what is left of the total after the forward heads, never above what the head owes
 *   3. reverse charge fully paid (total covers only the forward heads) offers no reverse-charge field
 *   4. an older server (no still keys) keeps the owed figures as before
 *   5. a new server with every head paid answers total 0: no pay form
 *
 * Run: node e2e/pe-gst-still.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'cap-period.js'), 'utf8');
const cut = (from, to) => {
  const i = src.indexOf(from),
    j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error('block not found in cap-period.js: ' + from);
  return src.slice(i, j);
};
const code =
  cut('/** the heads this close answered', 'const peHeadWord') + cut('/** ACC-336: the amounts a pay form may ask for', "/** the close's answer painted");
const sandbox = { peHeads: ['cgst', 'sgst', 'igst', 'cess'] };
vm.createContext(sandbox);
vm.runInContext(code + '\nthis.still = peGstStillMinor; this.total = peGstStillTotal; this.rcm = peGstRcmStill;', sandbox);

let failed = 0;
const ok = (cond, what) => {
  console.log((cond ? '  ok   ' : '  FAIL ') + what);
  if (!cond) failed++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const closed = {
  payable_minor: { cgst_minor: 10000, sgst_minor: 4200 },
  rcm_minor: { cgst: 900, sgst: 500 },
  pay_total_minor: 15600,
  still_to_pay_minor: { cgst_minor: 0, sgst_minor: 4200 },
  still_to_pay_total_minor: 4200 + 1000,
};
ok(same(sandbox.still(closed), closed.still_to_pay_minor), 'forward heads default to still_to_pay_minor, not payable_minor');
ok(same(sandbox.rcm(closed), { cgst: 900, sgst: 100 }), 'reverse charge default is what is left of the total after the forward heads, capped per head');
ok(same(sandbox.rcm(Object.assign({}, closed, { still_to_pay_total_minor: 4200 })), { cgst: 0, sgst: 0 }), 'reverse charge paid in full: nothing left to prefill');
const old = { payable_minor: { cgst_minor: 10000 }, rcm_minor: { cgst: 900 }, pay_total_minor: 10900 };
ok(same(sandbox.still(old), old.payable_minor) && same(sandbox.rcm(old), { cgst: 900 }) && sandbox.total(old) === 10900, 'an older server (no still keys) keeps the owed figures');
ok(sandbox.total({ pay_total_minor: 5000, still_to_pay_total_minor: 0 }) === 0, 'every head paid: still total 0, no pay form');

console.log(failed ? '\n  ' + failed + ' failed' : '\n  all passed');
process.exit(failed ? 1 : 0);
