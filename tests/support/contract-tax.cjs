/**
 * tests/support/contract-tax.cjs — the reads the Tax Lab makes (TAX-SRV1): POST /api/tax/compute and GET /api/facts/tax-lab, through the REAL routers over
 * one stubbed shop (tests/support/tax-stub.cjs). Used by tests/web-api-contract.test.cjs. An Indian shop that prices inclusive (an item_id line priced
 * by the shelf beside a priced line), an Australian one exclusive, and each refusal the screen branches on (`code`).
 */
'use strict';
const X = require('./tax-stub.cjs');

async function captureTax() {
  const got = {};
  const keep = (m, key, r) => { let k = m + ' ' + key; if (got[k] && got[k].status !== r.status) k += ' #' + r.status; got[k] = got[k] || { status: r.status, bodies: [] }; got[k].bodies.push(r.body); return r; };
  await X.start();
  try {
    X.SHOP.row = X.shopRow({ gstin: '33AAAAA0000A1Z5', name: 'Ponni Stores', country: 'IN', policy: { price_includes_tax: 'yes' } });
    X.SHOP.items = [{ item_id: 'P1', item_data: { name: 'Ponni Rice', price: 118, gst_rate: 18 } }, { item_id: 'P2', item_data: { name: 'Ink' } }];
    keep('POST', '/api/tax/compute', await X.call('POST', '/api/tax/compute', { lines: [{ item_id: 'P1', qty: 2 }, { name: 'Milk', qty: 1, price: 30, gst_rate: 0 }] }));
    keep('GET', '/api/facts/tax-lab', await X.call('GET', '/api/facts/tax-lab'));
    X.SHOP.row = X.shopRow({ gstin: '51824753556', name: 'Milk Bar', country: 'AU', policy: { price_includes_tax: 'no' } });
    keep('POST', '/api/tax/compute', await X.call('POST', '/api/tax/compute', { lines: [{ name: 'Flat white', qty: 1, price: 5, gst_rate: 10 }] }));
    keep('POST', '/api/tax/compute', await X.call('POST', '/api/tax/compute', { lines: [{ name: 'A', qty: 0, price: 1 }] }));
    keep('POST', '/api/tax/compute', await X.call('POST', '/api/tax/compute', { lines: [{ item_id: 'NOPE', qty: 1 }] }));
  } finally { X.stop(); }
  return got;
}
module.exports = { captureTax };
