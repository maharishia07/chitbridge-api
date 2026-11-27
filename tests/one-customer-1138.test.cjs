/**
 * one-customer-1138.test.cjs - ONE-CUSTOMER (28 Nov 2026): "is X a customer of this shop" has ONE reader, lib/customer-groups (CUSTOMER_ROLE_SQL, receiverBecomesCustomer, SALES_BILLS).
 * Part 1 the reader's answers with hand cases (the send step, db stubbed). Part 2 THE GUARD: no module outside the reader writes its own supplier/customer predicate on
 * customer_list / supplier_list, and the send step files customers through the reader only. A principle needs one enforcer and a guard.
 * Run: node tests/one-customer-1138.test.cjs
 */
'use strict';
const fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? '   ok   ' : '   FAIL ') + name + (ok ? '' : '\n          got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want))); };
const G = require(path.join(API, 'lib', 'customer-groups'));

/* part 1: hand cases. R = a receiver; the db stub answers the supplier look */
const ask = async (state, isSupplier) => G.receiverBecomesCustomer({ query: async () => ({ rows: isSupplier ? [{ one: 1 }] : [] }) }, Object.assign({ sender_id: 'S' }, state), 'R');
(async () => {
  eq('a non-supplier receiver of an invoice is a customer', await ask({ purpose: 'invoice' }, false), true);
  eq('a supplier receiving an invoice, credit note or debit note is a customer too', [await ask({ purpose: 'invoice' }, true), await ask({ purpose: 'credit_note' }, true), await ask({ purpose: 'debit_note' }, true)], [true, true, true]);
  eq('a supplier receiving an order, a payment advice or a receipt is not', [await ask({ purpose: 'order' }, true), await ask({ purpose: 'payment_advice' }, true), await ask({ purpose: 'receipt' }, true)], [false, false, false]);
  eq('the chit direction still wins: a buyer\'s order never makes its seller a customer, even for a non-supplier', await ask({ purpose: 'order', orderLike: true, sellerId: 'R', sender_id: 'S' }, false), false);
  eq('the SQL names the sales bills from the one list', G.CUSTOMER_ROLE_SQL.includes("'invoice', 'credit_note', 'debit_note'") && G.SALES_BILLS.length === 3, true);

  /* part 2: the guard. Comments are cut first; the reader itself and its test are the only homes */
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const files = [];
  for (const dir of ['lib', 'routes', 'middleware', 'src']) {
    const walk = (d) => { for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(js|cjs|mjs)$/.test(e.name)) files.push(p); } };
    walk(path.join(API, dir));
  }
  const READER = path.join(API, 'lib', 'customer-groups.js').toLowerCase();
  const own = [], gate = [];
  for (const f of files) {
    if (f.toLowerCase() === READER) continue;
    const text = strip(fs.readFileSync(f, 'utf8')), rel = path.relative(API, f).split(path.sep).join('/');
    /* a customer decision made by comparing the two lists: supplier_entity_id against a customer id (either way round), or the old reader's name */
    if (/supplier_entity_id\s*=\s*\w*\.?customer_identity_id|customer_identity_id\s*=\s*\w+\.supplier_entity_id|NOT_A_SUPPLIER_SQL/.test(text)) own.push(rel);
    /* the send path files customers through the reader only: it never reads supplier_list itself, and never asks rail-actions the customer gate on its own */
    if (/^(lib\/chits-send-bill|routes\/chits|lib\/chits-till-send)\.js$/.test(rel) && /supplier_list|receiverIsCustomer/.test(text)) gate.push(rel);
  }
  eq('no module outside lib/customer-groups writes its own supplier-versus-customer predicate', own, []);
  eq('the send path (chits-send-bill, routes/chits, chits-till-send) never reads supplier_list or asks the customer gate itself', gate, []);
  console.log('\n   ' + pass + ' checks passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
