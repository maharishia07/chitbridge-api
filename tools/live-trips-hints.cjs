'use strict';
/**
 * OWNS      what a person must tell tools/live-trips.cjs where the route's own schema cannot: fixed path values (params), a body (routes[].body, a value or a function), a query, or a skip with its reason.
 * CALLED BY tools/live-trips.cjs. Tests/tooling only. Every body carries the lt- prefix so what the harness made stays identifiable on the load shop.
 * CARD      speed · round trips
 */
const crypto = require('crypto');
const u = () => crypto.randomBytes(3).toString('hex');
const day = () => new Date().toISOString().slice(0, 10);
/** a setup call that must answer 2xx: returns the answer body or throws with the sentence (so a broken fixture says why in the results) */
async function must(api, method, url, body) {
  const r = await api.call(method, url, body);
  if (r.status < 200 || r.status >= 300) throw new Error(method + ' ' + url + ' → ' + r.status + ' ' + JSON.stringify(r.body || r.text).slice(0, 160));
  return r.body;
}
/** the fixture can't be made: the route is unreached with this reason */
const cannot = (group, reason) => ({ unreached: [group, reason] });
/** a customer party of the load shop (read only: Load Customer A) */
async function customerId(api) {
  if (!api.seeds.customer) { const b = await must(api, 'GET', '/api/crm/parties'); api.seeds.customer = (b.parties.find((x) => x.roles && x.roles.customer) || {}).party_id; }
  return api.seeds.customer;
}
/** a supplier party of the load shop */
async function supplierId(api) {
  if (!api.seeds.supplier) { const b = await must(api, 'GET', '/api/crm/parties'); api.seeds.supplier = (b.parties.find((x) => x.roles && x.roles.supplier) || {}).party_id; }
  return api.seeds.supplier;
}
/** an lt- cash payment received (a books_payment row to propose/confirm against) */
async function newPayment(api) {
  const out = await must(api, 'POST', '/api/books/payments', { party_id: await customerId(api), direction: 'in', amount: 1 + Math.floor(Math.random() * 9000) / 100, mode: 'cash', client_ref: 'lt-pay-' + u() });
  return out.payment.payment_id;
}
const OLD_FY = '2026-27'; /* the load shop's first document is in November 2026; April 2026 (period 1) holds no entry: the old empty month the tool may lock and close */
module.exports = {
  params: {},
  routes: {
    'POST /api/books/accruals/:ref/reverse': { fresh: true, make: async (api) => { const ref = 'lt-ACC-' + u(); await must(api, 'POST', '/api/books/accruals', { ref, kind: 'outstanding', class: 'electricity', amount: 100, date: '2026-09-15', narration: 'lt- live-trips' }); return { params: { ref }, body: { client_ref: 'lt-' + u() } }; } },
    'POST /api/books/assets/:id/dispose': { fresh: true, make: async (api) => { const a = await must(api, 'POST', '/api/books/assets', { name: 'lt-asset-' + u(), class: 'furniture', cost: 1000, date: day(), how: 'cash' }); const id = a.asset_id || (a.asset && a.asset.asset_id); return { params: { id }, body: { date: day(), proceeds: 0, client_ref: 'lt-' + u() } }; } },
    'POST /api/books/loans/:ref/emi': { fresh: true, make: async (api) => { const ref = 'lt-LOAN-' + u(); await must(api, 'POST', '/api/books/loans', { ref, lender: 'lt-bank', amount: 1000, into: 'bank', rate: 10, date: day() }); return { params: { ref }, body: { principal: 10, interest: 1, date: day(), client_ref: 'lt-' + u() } }; } },
    'POST /api/books/payments/:id/propose': { make: async (api) => ({ params: { id: await newPayment(api) }, body: {} }) },
    'POST /api/books/payments/:id/confirm': { skip: ['fixture', 'allocates a payment to an open bill; a manual journal bill (Dr 1300 with the party) is refused as "there is no bill" by the confirm route (3 tries): needs a bill made by a real sale (counter/invoice chit), not a journal'] },
    'POST /api/books/recurring/:id/post': { fresh: true, make: async (api) => { const t = await must(api, 'POST', '/api/books/recurring', { name: 'lt-rec-' + u(), event: { kind: 'expense', class: 'rent', amount: 100, how: 'cash' }, frequency: 'monthly', next_on: '2026-11-01' }); return { params: { id: t.recurring_id }, body: {} }; } },
    'POST /api/books/recurring/:id/skip': { fresh: true, make: async (api) => { const t = await must(api, 'POST', '/api/books/recurring', { name: 'lt-rec-' + u(), event: { kind: 'expense', class: 'rent', amount: 100, how: 'cash' }, frequency: 'monthly', next_on: '2026-11-01' }); return { params: { id: t.recurring_id }, body: {} }; } },
    'POST /api/books/write-off': { fresh: true, make: async (api) => ({ body: { party_id: await customerId(api), amount: 1, reason: 'lt- live-trips probe', client_ref: 'lt-wo-' + u() } }) },
    'POST /api/books/gst/close': { make: async () => ({ body: { fy: OLD_FY, period: 1 } }) },
    'POST /api/books/gst/pay': { skip: ['precondition', 'a challan can only pay tax OWED (422: more than the tax owed - CGST owed 0); the old empty period 2026-27/1 owes nothing and a period with tax owed is not an empty one (no tax posted on the load shop before November)'] },
    'POST /api/books/periods/:fy/:p/:act': { make: async () => ({ params: { fy: OLD_FY, p: '1', act: 'lock' }, body: { reason: 'lt- live-trips (unlocked again after the run)' } }) },
    'GET /api/books/packs/:id/file': { make: async (api) => { if (!api.seeds.pack) api.seeds.pack = (await must(api, 'POST', '/api/books/packs', { kind: 'month', fiscal_year: OLD_FY, period: 1 })).pack.pack_id; return { params: { id: api.seeds.pack } }; } },
    'GET /api/assist/resolve': { query: '?region=IN' },
    'POST /api/books/accruals': { body: () => ({ ref: 'lt-ELEC-' + u(), kind: 'outstanding', class: 'electricity', amount: 100, date: day(), narration: 'lt- live-trips' }) },
    'POST /api/books/assets': { body: () => ({ name: 'lt-asset-' + u(), class: 'furniture', cost: 1000, date: day(), how: 'cash' }) },
    'POST /api/books/closing-stock': { body: () => ({ date: day(), value: 1000 + Math.floor(Math.random() * 1e6), method: 'manual', client_ref: 'lt-' + u() }) },
    'POST /api/books/contra': { body: () => ({ from: 'cash', to: 'bank', amount: 1, date: day(), client_ref: 'lt-' + u() }) },
    'POST /api/books/depreciation/run': { body: () => ({ fy: '2025-26', client_ref: 'lt-' + u() }) },
    'POST /api/books/loans': { body: () => ({ ref: 'lt-LOAN-' + u(), lender: 'lt-bank', amount: 1000, into: 'bank', rate: 10, date: day() }) },
    'POST /api/combo-templates': { body: () => ({ name: 'lt-combo-' + u(), definition: [{ name: 'lt-group', min: 1, max: 1, options: [{ name: 'lt-option' }] }] }) },
    'POST /api/quick-keys/groups': { body: () => ({ name: 'lt-group-' + u() }) },
    'POST /api/capture/stores': { body: () => ({ phone: '+9190000' + String(Math.floor(Math.random() * 90000) + 10000), display_name: 'lt-store-' + u() }) },
    'POST /api/testing/changes': { body: () => ({ summary: 'lt- live-trips probe ' + u(), backout: 'lt- nothing to undo: test shop' }) },
    'POST /api/testing/releases': { skip: ['fixture', 'needs the id of a testing change (definition) to carry; the testing board is its own shop and the load shop holds none'] },
    'PATCH /api/combo-templates/:id': { body: () => ({ name: 'lt-combo-' + u() }) },
    'PATCH /api/quick-keys/groups/:id': { body: () => ({ name: 'lt-group-' + u() }) },
    'PUT /api/assist/container': { body: () => ({ container_id: 'lt/' + u(), name: 'lt-container' }) },
    'POST /api/integrations/profile': { body: () => ({ source: 'lt-live-trips', as_of: day(), fields: { legal_name: 'lt- shop' } }) },
  }
};
