'use strict';
/**
 * OWNS      what a person must tell tools/live-trips.cjs where the route's own schema cannot: fixed path values (params), a body (routes[].body, a value or a function), a query, or a skip with its reason.
 * CALLED BY tools/live-trips.cjs. Tests/tooling only. Every body carries the lt- prefix so what the harness made stays identifiable on the load shop.
 * CARD      speed · round trips
 */
const crypto = require('crypto');
const u = () => crypto.randomBytes(3).toString('hex');
const day = () => new Date().toISOString().slice(0, 10);
module.exports = {
  params: {},
  routes: {
    'GET /api/assist/resolve': { query: '?region=IN' },
    'POST /api/books/accruals': { body: () => ({ ref: 'lt-ELEC-' + u(), kind: 'outstanding', class: 'electricity', amount: 100, date: day(), narration: 'lt- live-trips' }) },
    'POST /api/books/assets': { body: () => ({ name: 'lt-asset-' + u(), class: 'furniture', cost: 1000, date: day(), how: 'cash' }) },
    'POST /api/books/closing-stock': { body: () => ({ date: day(), value: 1000, method: 'manual', client_ref: 'lt-' + u() }) },
    'POST /api/books/contra': { body: () => ({ from: 'cash', to: 'bank', amount: 1, date: day(), client_ref: 'lt-' + u() }) },
    'POST /api/books/depreciation/run': { body: () => ({ fy: '2026-27', client_ref: 'lt-' + u() }) },
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
    'POST /api/books/gst/close': { skip: ['precondition', 'closes a GST period of the load shop (a one-way books act); needs Athi/cb-accounting to say which period may be closed on sit-in'] },
    'POST /api/books/gst/pay': { skip: ['precondition', 'posts a GST challan payment against a closed period; needs a closed period first (see gst/close)'] },
    'POST /api/books/write-off': { skip: ['fixture', 'needs a customer party with an open balance (a lt- credit sale) to write off'] }
  }
};
