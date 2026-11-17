// @type: unit
/**
 * tb-change.test.cjs — F3 (Fable RC walk 17 Nov): the trial balance's Change and % read on the account's OWN side, so the TB and the P&L agree for the same account.
 * OWNS      the proof of public/app/tb-change.js (CBTbChange.read) on the rows the api sends (net = debit − credit, change = now − last year, % of |last year|)
 * CALLED BY .github/workflows/ci.yml (Offline guards).  node e2e/tb-change.test.cjs
 * CARD      14-accounting/statements-tb-pandl-bs-party-statement
 * HAND FIGURES (paper first, Seed E Client 001, as at 17 Nov 2026): Sales 4000 credit 5,474,000 now, 5,937,500 a year ago: the credit FELL 463,500 = 7.81% → reads −463,500 −7.8% (the P&L says the same);
 *           Client 006 FY 2025-26: Sales credit 15,993,000 now vs 1,145,000: ROSE 14,848,000 = 1296.8% → reads +14,848,000 +1296.8% Cr.
 */
'use strict';
const assert = require('assert');
const root = {};
new Function('window', require('fs').readFileSync(__dirname + '/../public/app/tb-change.js', 'utf8'))(root);
const read = root.CBTbChange.read;
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('  ok   ' + name); };
ok('credit account, balance fell: the server sent +463500 / +781 (debit-positive); it reads −463500 / −781 Cr', () => {
  const r = read({ dr_minor: 0, cr_minor: 5474000, prior_net_minor: -5937500, change_minor: 463500, change_bp: 781 });
  assert.deepStrictEqual([r.change_minor, r.change_bp, r.side], ['-463500', '-781', 'Cr']);
});
ok('credit account, balance rose (Client 006): the server sent −14848000 / −129680; it reads +14848000 / +129680 Cr', () => {
  const r = read({ dr_minor: 0, cr_minor: 15993000, prior_net_minor: -1145000, change_minor: -14848000, change_bp: -129680 });
  assert.deepStrictEqual([r.change_minor, r.change_bp, r.side], ['14848000', '129680', 'Cr']);
});
ok('debit account is as the server sent it, with Dr', () => {
  const r = read({ dr_minor: 811000, cr_minor: 0, prior_net_minor: 1000000, change_minor: -189000, change_bp: -1890 });
  assert.deepStrictEqual([r.change_minor, r.change_bp, r.side], [-189000, -1890, 'Dr']);
});
ok('a nil balance now takes its side from last year; a nil change says no side; null stays null', () => {
  assert.strictEqual(read({ dr_minor: 0, cr_minor: 0, prior_net_minor: -22000, change_minor: 22000, change_bp: -10000 }).side, 'Cr');
  assert.strictEqual(read({ dr_minor: 0, cr_minor: 70000000, prior_net_minor: -70000000, change_minor: 0, change_bp: 0 }).side, '');
  assert.strictEqual(read({ dr_minor: 0, cr_minor: 5, prior_net_minor: -5, change_minor: 0, change_bp: 0 }).change_bp, '0');
  const r = read({ dr_minor: 0, cr_minor: 5, change_minor: null, change_bp: null });
  assert.deepStrictEqual([r.change_minor, r.change_bp, r.side], [null, null, '']);
});
console.log('tb-change: ' + n + ' of 4 passed');
