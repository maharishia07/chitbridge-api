/* bill-row.cjs — THE CUSTOMER'S COPY OF A COUNTER BILL READS AS A BILL (Athi, 2026-10-01)
 *
 * The send route writes the customer's copy as purpose 'invoice' with summary_json.bill_received { from, no, total }. In the
 * app's list it must read "Bill from Tally Test Shop · ₹481.65 · to accept" — not as a task — and the move that accepts it
 * reads "Goods received · bill accepted" and sends the SAME PUT /status the ledger listens for: `accepted`. A task keeps its
 * own words (Open · Act · Close → pending · in_progress · completed).
 * The functions are taken from public/app.html itself (no copy), with the app's formatters stubbed. No browser, no server.
 * Run: node e2e/bill-row.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
/* app.html, and accounts-shell.js where a function MOVED to be shared with accounts.html (statusWordFor · billUseChoiceHTML — 2026-10-02) */
const src = ['app.html', 'app/accounts-shell.js'].map((f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8')).join('\n');
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(78) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

/** the source of `function name(…){…}` in app.html — braces counted, strings and comments are plain enough here */
function fnSource(name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) return null;
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) { const ch = src[i]; if (ch === '{') depth++; else if (ch === '}') { depth--; if (!depth) return src.slice(at, i + 1); } }
  return null;
}
const ctx = { fmtMoney: (n, cur, empty) => (empty !== undefined && (n == null || n === '' || !isFinite(Number(n))) ? empty : '₹' + Number(n).toFixed(2)), tx: (s) => s, txf: (s, v) => String(s).replace(/\{(\w+)\}/g, (_, k) => v[k]) };
vm.createContext(ctx);
/* ACC-206 D1: the list row's amount is read through helpers.js billTotalOf (the page loads helpers.js before app.html's script) */
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'helpers.js'), 'utf8'), ctx);
vm.runInContext("var BILL_USES=[['resale','For resale'],['use','For the shop'],['asset','An asset']];", ctx);
for (const n of ['billRowOf', 'statusOptsFor', 'statusWordFor', 'mapApiChit', 'billUseChoiceHTML']) {
  const s = fnSource(n);
  if (!s) { say('app.html defines ' + n + '()', false, 'not found'); continue; }
  vm.runInContext(s + '\nthis.' + n + ' = ' + n + ';', ctx);
}

const bill = (status) => ({ chit_id: 'c1', purpose: 'invoice', current_status: status, sender_entity_display_name: 'Tally Test Shop',
  manual_subject: 'Bill C2/26-27/0002 from Tally Test Shop', all_recipients: [{ role: 'sender', display_name: 'Tally Test Shop' }, { role: 'receiver', display_name: 'Chola Auto Care' }],
  summary_json: { purpose: 'invoice', currency_code: 'INR', bill_received: { from: 'Tally Test Shop', no: 'C2/26-27/0002', total: 481.65 } } });
const task = { chit_id: 't1', purpose: 'order', current_status: 'pending', manual_subject: 'Counter sale C2/26-27/0002', all_recipients: [], summary_json: { purpose: 'order' } };

if (!bad) {
  say('a received counter bill, to accept: "Bill from Tally Test Shop · ₹481.65 · to accept"', ctx.billRowOf(bill('pending')) === 'Bill from Tally Test Shop · ₹481.65 · to accept', ctx.billRowOf(bill('pending')));
  say('…once accepted it is still the bill, no longer "to accept"', ctx.billRowOf(bill('accepted')) === 'Bill from Tally Test Shop · ₹481.65', ctx.billRowOf(bill('accepted')));
  say('a task (the shop\'s own counter sale, an order) is not a bill row', ctx.billRowOf(task) === null, String(ctx.billRowOf(task)));
  /* ACC-252: the server answers total null for a bill it has no figure for — unknown stays unknown, never ₹0.00 */
  const unknown = bill('pending'); unknown.summary_json.bill_received.total = null;
  say('a bill with no known total reads "Bill from Tally Test Shop · — · to accept", never ₹0.00', ctx.billRowOf(unknown) === 'Bill from Tally Test Shop · — · to accept', ctx.billRowOf(unknown));
  const row = ctx.mapApiChit(bill('pending')), trow = ctx.mapApiChit(task);
  say('the list row of the bill carries those words, and knows it is a bill received', row.code === 'Bill from Tally Test Shop · ₹481.65 · to accept' && row.billRx === true && row.kind === 'invoice', JSON.stringify([row.code, row.billRx, row.kind]));
  say('…a task\'s row keeps its subject and is not a bill', trow.code === 'Counter sale C2/26-27/0002' && !trow.billRx, JSON.stringify([trow.code, trow.billRx]));
  const ob = ctx.statusOptsFor([row]), ot = ctx.statusOptsFor([trow]), om = ctx.statusOptsFor([row, trow]);
  say('the move for a bill reads "Goods received · bill accepted"', ob[1][1] === 'Goods received · bill accepted', JSON.stringify(ob));
  say('…a task keeps Open · Act · Close; a mixed selection too', ot.map((x) => x[1]).join('|') === 'Open|Act|Close' && om[1][1] === 'Act', JSON.stringify([ot, om[1]]));
  say('…and it sends the one transition the ledger listens for: accepted (a task\'s Act stays in_progress)', ctx.statusWordFor('act', row) === 'accepted' && ctx.statusWordFor('act', trow) === 'in_progress'
    && ctx.statusWordFor('open', row) === 'pending' && ctx.statusWordFor('close', row) === 'completed', [ctx.statusWordFor('act', row), ctx.statusWordFor('act', trow)].join(' / '));
  /* ⭐ what the goods are for — one tap before Accept, only for bills (lib/bill-use on the server) */
  const ch = ctx.billUseChoiceHTML([row]);
  say('a bill\'s picker offers the one-tap choice: For resale · For the shop · An asset', /data-use="resale"[^>]*>For resale</.test(ch) && /data-use="use"[^>]*>For the shop</.test(ch) && /data-use="asset"[^>]*>An asset</.test(ch) && /your catalogue decides/.test(ch),
    (ch.match(/>[^<]+<\/button>/g) || []).join(' '));
  say('…a task\'s picker does not', ctx.billUseChoiceHTML([trow]) === '' && ctx.billUseChoiceHTML([row, trow]) === '', 'empty');
  const src2 = fnSource('confirmStatus') || '';
  say('…and the choice rides the SAME call as the acceptance it decides (QA-131: one call per record, with from and a step key)', !/api\("billUse"/.test(src2) && /statusStepBody\(/.test(src2) && /idemKey: /.test(src2) && /body\.use = goodsUse/.test(fnSource('statusStepBody') || '') && /body\.from = row\._status/.test(fnSource('statusStepBody') || ''), 'one call in confirmStatus');
}
console.log('\n' + (bad ? '✗ ' + bad + ' FAILED' : '✓ all passed') + '\n');
process.exit(bad ? 1 : 0);
