/* match-money.test.cjs — OPS-83 (web twin of api fix/ops-83-match-money-2026-11-13): the Match screen paints "Received" tax in, beside "Invoiced" (tax in),
 * from the api's received_with_tax, and words the money note from money_code.
 * OWNS      matchReceivedFig · matchGapNote · matchDetail of public/app/cap-match.js, taken from the file itself (no copy), app formatters stubbed. No browser, no server.
 * CALLED BY npm test list (e2e/*.test.cjs) · CI.
 * Hand-computed: S7-4 = 12 x 10.00 = 120 + 6 tax = 126 against an invoice of 126: before the fix the screen read Received 120, Invoiced 126, "They billed 6 more".
 * Run: node e2e/match-money.test.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'cap-match.js'), 'utf8');
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(96) + (ok ? 'OK' : (bad++, '✗ FAILED ' + d))); };
function fnSource(name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) return null;
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) { const ch = src[i]; if (ch === '{') depth++; else if (ch === '}') { depth--; if (!depth) return src.slice(at, i + 1); } }
  return null;
}
const ctx = {
  esc: (x) => String(x == null ? '' : x), tx: (s) => s, txf: (s, v) => s.replace(/\{(\w+)\}/g, (_m, k) => v[k]),
  myCur: () => 'INR', fmtMoney: (n, _c, empty) => (n == null ? empty : '₹' + Number(n).toFixed(2)), inr: (n) => '₹' + Number(n).toFixed(2)
};
vm.createContext(ctx);
for (const n of ['matchFig', 'matchReceivedFig', 'matchGapNote', 'matchOtherUnits', 'matchDiffWords', 'matchDiffCell', 'matchBilledWords', 'matchReceivedCell', 'matchBilledUnmatched', 'matchDetail']) {
  const s = fnSource(n);
  if (!s) { say('cap-match.js defines ' + n + '()', false, 'not found'); continue; }
  vm.runInContext(s + '\nthis.' + n + ' = ' + n + ';', ctx);
}
const closedLine = { name: 'Rice', ordered: 12, unit: 'kg', received: 12, difference: 0, state: 'agreed' };
const order = (over) => Object.assign({ lines: [closedLine], receipts: [], ordered_total: 120, received_total: 120, received_with_tax: 126, invoiced_total: 126, invoiced_from: 'their invoice',
  money_gap: 0, money_code: 'agrees', verdict: 'agreed' }, over);
const html = (o) => ctx.matchDetail(o, {});
const fig = (h, label) => { const m = h.match(new RegExp(label + '</div><div[^>]*>([^<]*)<')); return m ? m[1] : null; };

if (!bad) {
  let h = html(order());
  say('S7-4: Received is the tax-in 126.00 (not the pre-tax 120.00), beside Invoiced 126.00', fig(h, 'Received') === '₹126.00' && fig(h, 'Invoiced') === '₹126.00', JSON.stringify([fig(h, 'Received'), fig(h, 'Invoiced')]));
  say('…and says tax in', h.indexOf('what your own door counted, tax in') >= 0, 'caption');
  say('…agreed: no gap note (before: "They billed ₹6.00 more")', h.indexOf('match-gap') < 0, 'a note was painted');

  h = html(order({ received_with_tax: null, money_gap: null, money_code: 'no_tax_figure' }));
  say('an old receipt (no carried tax): the pre-tax count stands and SAYS before tax; no gap note', fig(h, 'Received') === '₹120.00' && h.indexOf('before tax') >= 0 && h.indexOf('match-gap') < 0, fig(h, 'Received'));

  h = html(order({ received_with_tax: 126, invoiced_total: 131, money_gap: -5, money_code: 'apart', verdict: 'differs' }));
  say('apart, lines closed: "They billed ₹5.00 more than you counted."', h.indexOf('They billed ₹5.00 more than you counted.') >= 0, 'note');

  h = html(order({ lines: [Object.assign({}, closedLine, { received: 6, difference: -6, state: 'short' })], received_with_tax: 63, money_gap: -63, money_code: 'apart', verdict: 'differs' }));
  say('lines still open (6 of 12): the money note waits, the figures stay', h.indexOf('match-gap') < 0 && fig(h, 'Received') === '₹63.00', 'banner shown');

  h = html(order({ invoiced_total: 126.4, money_gap: -0.4, money_code: 'round_off' }));
  say('round-off: a calm "their round-off" line, not "They billed more"', h.indexOf('their round-off') >= 0 && h.indexOf('They billed') < 0 && h.indexOf('var(--grey)') >= 0, 'round-off wording');

  h = html(order({ money_gap: null, money_code: 'currency_mismatch', verdict: 'differs' }));
  say('their bill in another currency: said, never compared', h.indexOf('another currency') >= 0, 'mismatch wording');

  h = html(order({ lines: [Object.assign({}, closedLine, { state: 'short', difference: -6 })], money_gap: null, money_code: 'currency_mismatch' }));
  say('…said even while lines are open (it is not a gap)', h.indexOf('another currency') >= 0, 'mismatch while open');

  const len = (() => { const at = src.indexOf('function matchDetail('); const end = src.indexOf('\n}\n', at); return src.slice(at, end).split('\n').length + 1; })();
  say('readability ratchet: matchDetail stays at or under its main length (93 lines)', len <= 93, String(len));
}
console.log(bad ? '\n' + bad + ' FAILED' : '\nall ok');
process.exit(bad ? 1 : 0);
