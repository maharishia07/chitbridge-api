/**
 * products-scenes.cjs — the named scenarios of tests/api-problem-products.test.cjs: an answer the generic worlds cannot reach (a refusal inside a handler, a success to prove byte for byte).
 *
 * OWNS      the extras: one scenario per refusal of routes/products.js, and one per success answer, each with the stand-in rows it needs.
 * CALLED BY tests/api-problem-products.test.cjs. Not a test itself.
 * FLOW      extras(tools) → [{ id, route, expect, setup: { sqlRows, who, db }, patch, body, url }] → the harness runs each one against the real route
 * CARD      qa/offline-guards
 */
'use strict';
const path = require('path');
const xlsxWrite = require(path.join(__dirname, '..', '..', 'lib', 'xlsx-write'));

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const WORKBOOK = (rows) => xlsxWrite.workbook([{ name: 'Products', rows }]).toString('base64');
const SHEET_ROWS = [['sku', 'name', 'unit', 'price'], ['A1', 'Tea', 'kg', 10]];
const CSV = 'sku,name,unit,price\nA1,Tea,kg,10\n';
const DECIDED = ['sku', 'name', 'unit', 'price'].map((incoming) => ({ incoming, action: 'map', field: incoming }));
const P = '/api/products';
const SHOP = '11111111-1111-4111-8111-111111111111';
const SOMEDAY = '2026-12-01T00:00:00Z';
const boom = async () => {
  throw new Error('x');
};
const crash = () => {
  throw new Error('x');
};

/** the tools a scene is built from: the harness's own stand-ins and the product row the shelf answers with */
function extras(tools) {
  const { PARTY, STAFF, answering, raising, firstOf } = tools;
  const ITEM = (data) => ({ item_id: PARTY, entity_id: SHOP, is_active: true, schema_id: null, item_data: Object.assign({ name: 'Tea', unit: 'kg', price: { amount: 10, currency: 'INR' } }, data) });
  const money = answering(/FROM identities WHERE identity_id/, [{ currency_code: 'INR', country: 'IN' }]);
  const written = answering(/^\s*(INSERT INTO catalogue_items|UPDATE catalogue_items)/, [ITEM()]);
  const own = answering(/SELECT item_data FROM catalogue_items WHERE item_id/, [{ item_data: ITEM().item_data }]);
  const shelf = firstOf(money, written, own);
  const X = (id, route, expect, more) => Object.assign({ id, route, expect, setup: {} }, more);
  const withRows = (answer) => ({ sqlRows: answer });
  const failing = { db: 'fail' };
  const requiredName = firstOf(
    answering(/SELECT schema_id FROM entity_schemas/, [{ schema_id: PARTY }]),
    answering(/FROM schema_fields WHERE schema_id/, [{ field_key: 'name', field_name: 'Name', field_type: 'text', required: true }]),
    shelf
  );
  const storeWith = (change) => ({ store: Object.assign({ available: async () => true, objectKey: (entity, mid) => entity + '/2026/10/' + mid, put: async () => undefined, get: async () => PNG, del: async () => undefined }, change) });
  const storeOn = storeWith({});
  const scheduleOn = { schema: { hasTable: async () => true } };
  const body = (more) => Object.assign({ item_data: { name: 'Tea' } }, more);
  const manyOf = (n, one) => Array.from({ length: n }, () => one);
  const mediaRow = (more) => answering(/SELECT entity_id, item_data FROM catalogue_items/, [{ entity_id: SHOP, item_data: { media: [Object.assign({ id: PARTY, key: SHOP + '/2026/10/' + PARTY, mime: 'image/png' }, more)] } }]);
  const counts = answering(/count\(\*\)::int AS n FROM catalogue_items/, [{ n: 0 }]);
  const listRows = firstOf(counts, answering(/FROM catalogue_items WHERE/, [ITEM()]));
  const costBlind = { who: STAFF };
  const markedOut = (rows) => answering(/^s*UPDATE catalogue_items/, rows.map((row) => Object.assign({ item_data: ITEM({ status: 'unavailable' }).item_data }, row)));
  const withMedia = (media) => firstOf(answering(/^s*UPDATE catalogue_items/, [{ item_data: ITEM({ media }).item_data }]), shelf);
  const costHidden = { cost: { canReadSafe: async () => false } };
  const importBody = (more) => Object.assign({ csv: CSV, decisions: DECIDED, confirm: true }, more);
  return [
    /* POST / */
    X('item-data-a-list', 'POST ' + P, 400, { body: { item_data: [] } }),
    X('db-fails-with-an-item', 'POST ' + P, 500, { body: body(), setup: failing }),
    X('product-added', 'POST ' + P, 200, { body: body(), setup: withRows(shelf) }),
    X('product-refused-by-the-rules', 'POST ' + P, 400, { body: { item_data: { unit: 'kg' } }, setup: withRows(requiredName) }),
    X('server-owned-key', 'POST ' + P, 400, { body: { item_data: { name: 'Tea', media: [{ id: 'm1' }] } }, setup: withRows(shelf) }),
    X('price-below-zero', 'POST ' + P, 422, { body: { item_data: { name: 'Tea', price: 'abc' } }, setup: withRows(shelf) }),
    X('rate-owner-only', 'POST ' + P, 403, { body: { item_data: { name: 'Tea', gst_rate: 18 } }, setup: costBlind }),
    /* CAT-235 part 2: a cost-blind co-assist creates items, never a cost key at any depth (`after`: main created it with the cost) */
    X('create-cost-blind', 'POST ' + P, 403, { after: true, body: { item_data: { name: 'Tea', modifiers: [{ options: [{ name: 'L', cost: 4 }] }] } }, setup: costBlind }),
    /* POST /bulk */
    X('bulk-rate-owner-only', 'POST ' + P + '/bulk', 403, { body: { items: [{ name: 'Tea', gst_rate: 18 }] }, setup: costBlind }),
    X('bulk-cost-blind', 'POST ' + P + '/bulk', 403, { after: true, body: { items: [{ name: 'Tea', cost: 4 }] }, setup: costBlind }),
    X('too-many-products', 'POST ' + P + '/bulk', 400, { body: { items: manyOf(201, { name: 'Tea' }) } }),
    X('an-item-is-not-an-object', 'POST ' + P + '/bulk', 400, { body: { items: ['tea'] } }),
    X('bulk-refused-by-the-rules', 'POST ' + P + '/bulk', 400, { body: { items: [{ unit: 'kg' }] }, setup: withRows(requiredName) }),
    X('bulk-added', 'POST ' + P + '/bulk', 200, { body: { items: [{ name: 'Tea' }] }, setup: withRows(shelf) }),
    X('bulk-db-fails', 'POST ' + P + '/bulk', 500, { body: { items: [{ name: 'Tea' }] }, setup: failing }),
    /* POST /status/bulk */
    X('too-many-ids', 'POST ' + P + '/status/bulk', 400, { body: { ids: manyOf(201, PARTY), status: 'available' } }),
    X('an-id-is-not-text', 'POST ' + P + '/status/bulk', 400, { body: { ids: [5], status: 'available' } }),
    X('retired-is-not-bulk', 'POST ' + P + '/status/bulk', 400, { body: { ids: [PARTY], status: 'retired' } }),
    X('bulk-status-set', 'POST ' + P + '/status/bulk', 200, { body: { ids: [PARTY], status: 'unavailable' }, setup: withRows(answering(/^\s*UPDATE catalogue_items/, [{ item_id: PARTY, item_data: ITEM().item_data }])) }),
    /* the item reads as out of stock (reads_as a sentence, not null) · one id the shop does not hold (missed names it) */
    X('bulk-status-marked-out', 'POST ' + P + '/status/bulk', 200, { body: { ids: [PARTY, 'no-such-id'], status: 'unavailable' }, setup: withRows(markedOut([{ item_id: PARTY }])) }),
    X('bulk-status-db-fails', 'POST ' + P + '/status/bulk', 500, { body: { ids: [PARTY], status: 'unavailable' }, setup: failing }),
    X('bulk-status-ids-and-status-wrong', 'POST ' + P + '/status/bulk', 400, { body: { ids: 'x', status: 5 } }),
    X('bulk-status-status-missing', 'POST ' + P + '/status/bulk', 400, { body: { ids: [PARTY] } }),
    /* POST /bulk-update */
    X('edit-rate-owner-only', 'POST ' + P + '/bulk-update', 403, { body: { items: [{ id: PARTY, item_data: { name: 'Tea', gst_rate: 18 } }] }, setup: costBlind }),
    /* CAT-235: a cost-blind co-assist's bulk edit replaces each record, so even a status-only one is refused, naming the shelf's keys it would erase (`after`: main answered 200 and wiped the row) */
    X('edits-cost-blind', 'POST ' + P + '/bulk-update', 403, { after: true, body: { items: [{ id: PARTY, item_data: { status: 'unavailable' } }] }, setup: { who: STAFF, sqlRows: firstOf(answering(/SELECT item_id, item_data FROM catalogue_items/, [{ item_id: PARTY, item_data: ITEM().item_data }]), shelf) }, patch: costHidden }),
    X('too-many-edits', 'POST ' + P + '/bulk-update', 400, { body: { items: manyOf(201, { id: PARTY, item_data: { name: 'Tea' } }) } }),
    X('an-edit-has-the-wrong-shape', 'POST ' + P + '/bulk-update', 400, { body: { items: [{ id: PARTY }] } }),
    X('an-edit-is-refused-by-the-rules', 'POST ' + P + '/bulk-update', 400, { body: { items: [{ id: PARTY, item_data: { unit: 'kg' } }] }, setup: withRows(requiredName) }),
    X('edits-written', 'POST ' + P + '/bulk-update', 200, { body: { items: [{ id: PARTY, item_data: { name: 'Tea' } }] }, setup: withRows(shelf) }),
    X('edits-db-fails', 'POST ' + P + '/bulk-update', 500, { body: { items: [{ id: PARTY, item_data: { name: 'Tea' } }] }, setup: failing }),
    /* GET / */
    X('list-answers', 'GET ' + P, 200, { setup: withRows(listRows) }),
    X('list-by-text', 'GET ' + P, 200, { url: P + '?q=tea&limit=10&offset=0', setup: withRows(listRows) }),
    X('list-by-status', 'GET ' + P, 200, { url: P + '?status=not-available', setup: withRows(counts) }),
    X('list-status-unknown', 'GET ' + P, 400, { url: P + '?status=sold' }),
    X('list-db-fails', 'GET ' + P, 500, { setup: failing }),
    /* downloads */
    X('workbook', 'GET ' + P + '/workbook.xlsx', 200, { setup: withRows(shelf) }),
    X('csv-export', 'GET ' + P + '/export.csv', 200, { setup: withRows(answering(/SELECT item_data FROM catalogue_items/, [{ item_data: ITEM().item_data }])) }),
    X('template', 'GET ' + P + '/template', 200, {}),
    /* the import */
    X('preflight-reads-a-csv', 'POST ' + P + '/import/preflight', 200, { body: { csv: CSV } }),
    X('preflight-reads-a-workbook', 'POST ' + P + '/import/preflight', 200, { body: { xlsx: WORKBOOK(SHEET_ROWS) } }),
    X('preflight-reads-a-row-as-headings', 'POST ' + P + '/import/preflight', 200, { body: { csv: 'title\nsku,name,unit,price\nA1,Tea,kg,10\n', header_row: 2 } }),
    X('preflight-row-past-the-end', 'POST ' + P + '/import/preflight', 400, { body: { csv: CSV, header_row: 40 } }),
    X('preflight-workbook-unreadable', 'POST ' + P + '/import/preflight', 400, { body: { xlsx: Buffer.from('not a workbook').toString('base64') } }),
    X('preflight-header-row-zero', 'POST ' + P + '/import/preflight', 400, { body: { csv: CSV, header_row: 0 } }),
    X('preflight-file-not-text', 'POST ' + P + '/import/preflight', 400, { body: { csv: 5 } }),
    X('preflight-db-fails', 'POST ' + P + '/import/preflight', 500, { body: { csv: CSV }, setup: failing }),
    X('import-not-confirmed', 'POST ' + P + '/import', 400, { body: { csv: CSV, decisions: [] } }),
    X('import-nothing-to-import', 'POST ' + P + '/import', 400, { body: { decisions: [], confirm: true } }),
    X('import-file-unreadable', 'POST ' + P + '/import', 400, { body: { xlsx: Buffer.from('not a workbook').toString('base64'), decisions: [], confirm: true } }),
    X('import-no-product-name', 'POST ' + P + '/import', 400, { body: { csv: 'sku\nA1\n', decisions: [], confirm: true } }),
    X('import-choices-do-not-hold', 'POST ' + P + '/import', 400, { body: importBody({ decisions: [{ incoming: 'name', action: 'map', field: 'sku' }, { incoming: 'sku', action: 'map', field: 'sku' }] }) }),
    X('import-too-many-rows', 'POST ' + P + '/import', 413, { body: importBody({ csv: 'sku,name\n' + Array.from({ length: 2001 }, (v, i) => 'S' + i + ',Tea').join('\n') + '\n', decisions: [] }) }),
    X('import-a-row-has-a-problem', 'POST ' + P + '/import', 409, { body: importBody({ csv: 'sku,name,unit,price\nA1,Tea,kg,not-a-number\n' }), setup: withRows(shelf) }),
    X('import-done', 'POST ' + P + '/import', 200, { body: importBody(), setup: withRows(shelf) }),
    X('import-rate-owner-only', 'POST ' + P + '/import', 403, { body: importBody({ csv: 'sku,name,unit,price,gst_rate' + String.fromCharCode(10) + 'A1,Tea,kg,5,18' + String.fromCharCode(10), decisions: DECIDED.concat([{ incoming: 'gst_rate', action: 'map', field: 'gst_rate' }]) }), setup: { who: STAFF, sqlRows: firstOf(answering(/SELECT schema_id FROM entity_schemas/, [{ schema_id: PARTY }]), answering(/FROM schema_fields WHERE schema_id/, [{ field_key: 'name', field_name: 'Name', field_type: 'text' }, { field_key: 'gst_rate', field_name: 'GST rate', field_type: 'number' }]), shelf) } }),
    X('import-cost-blind', 'POST ' + P + '/import', 403, { after: true, body: importBody({ csv: 'sku,name,unit,price,cost' + String.fromCharCode(10) + 'A1,Tea,kg,5,3' + String.fromCharCode(10), decisions: DECIDED.concat([{ incoming: 'cost', action: 'create', field: 'cost' }]) }), setup: { who: STAFF, sqlRows: firstOf(answering(/SELECT schema_id FROM entity_schemas/, [{ schema_id: PARTY }]), answering(/FROM schema_fields WHERE schema_id/, [{ field_key: 'name', field_name: 'Name', field_type: 'text' }]), shelf) } }),
    X('import-db-fails', 'POST ' + P + '/import', 500, { body: importBody({ decisions: [] }), setup: failing }),
    X('import-decisions-not-a-list', 'POST ' + P + '/import', 400, { body: importBody({ decisions: 'all' }) }),
    /* starter columns */
    X('starter-list', 'GET ' + P + '/starter-columns', 200, { url: P + '/starter-columns?vertical=gold' }),
    X('starter-list-bare', 'GET ' + P + '/starter-columns', 200, {}),
    X('starter-list-unknown-trade', 'GET ' + P + '/starter-columns', 200, { url: P + '/starter-columns?vertical=nope' }),
    X('starter-list-fails', 'GET ' + P + '/starter-columns', 500, { patch: { starter: { list: crash } } }),
    X('starter-unknown-trade', 'POST ' + P + '/starter-columns', 400, { body: { vertical: 'nope' } }),
    X('starter-no-definition', 'POST ' + P + '/starter-columns', 500, { body: { vertical: 'gold' }, patch: { boot: { ensureDefaultSchema: async () => ({}) } } }),
    X('starter-adopted', 'POST ' + P + '/starter-columns', 200, { body: { vertical: 'gold', custom: [{ field_name: 'Bar serial', field_type: 'text' }, { field_name: 'Odd', field_type: 'weird' }] }, setup: withRows(firstOf(answering(/SELECT schema_id FROM entity_schemas/, [{ schema_id: PARTY }]), answering(/MAX\(display_order\)/, [{ m: 0 }]))) }),
    X('starter-db-fails', 'POST ' + P + '/starter-columns', 500, { body: { vertical: 'gold' }, setup: failing }),
    /* PATCH /:id */
    X('edit-item-data-missing', 'PATCH ' + P + '/:id', 400, { body: {} }),
    X('edit-db-fails', 'PATCH ' + P + '/:id', 500, { body: body(), setup: failing }),
    X('edit-cost-blind', 'PATCH ' + P + '/:id', 403, { body: { item_data: { price: 5 } }, setup: costBlind, patch: costHidden }),
    X('edit-rate-owner-only', 'PATCH ' + P + '/:id', 403, { body: { merge: true, item_data: { gst_rate: 18 } }, setup: { who: STAFF, sqlRows: firstOf(answering(/can_see_costs FROM identities/, [{ can_see_costs: true }]), shelf) } }),
    X('edit-not-found', 'PATCH ' + P + '/:id', 404, { body: body(), setup: withRows(money) }),
    X('edit-merge-not-found', 'PATCH ' + P + '/:id', 404, { body: { merge: true, item_data: { name: 'Tea' } }, setup: withRows(money) }),
    X('edit-refused-by-the-rules', 'PATCH ' + P + '/:id', 400, { body: { item_data: { unit: 'kg' } }, setup: withRows(requiredName) }),
    X('edit-server-owned-key', 'PATCH ' + P + '/:id', 400, { body: { item_data: { name: 'Tea', image: 'x' } }, setup: withRows(firstOf(own, money)) }),
    X('edit-written', 'PATCH ' + P + '/:id', 200, { body: body(), setup: withRows(shelf) }),
    X('edit-merged', 'PATCH ' + P + '/:id', 200, { body: { merge: true, item_data: { unit: 'g' } }, setup: withRows(shelf) }),
    /* CAT-234/236: a cost-blind co-assist flips status (merge:true) and gets the row back WITHOUT its cost at any depth (the shelf holds cost: 3, cost_x and an option cost) */
    X('edit-status-cost-blind', 'PATCH ' + P + '/:id', 200, { body: { merge: true, item_data: { status: 'unavailable' } }, setup: { who: STAFF, sqlRows: firstOf(money, answering(/^\s*UPDATE catalogue_items/, [ITEM({ cost: 3, cost_x: 1, modifiers: [{ name: 'Size', options: [{ name: 'L', price: 12, cost: 2 }] }] })]), answering(/SELECT item_data FROM catalogue_items WHERE item_id/, [{ item_data: ITEM({ cost: 3, cost_x: 1, modifiers: [{ name: 'Size', options: [{ name: 'L', price: 12, cost: 2 }] }] }).item_data }])) }, patch: costHidden }),
    /* CAT-237: the same flip WITHOUT merge:true would replace the row with {status}: refused, naming the shelf's keys it would erase (`after`: main answered 200 and wiped the row, so nothing was frozen) */
    X('edit-status-cost-blind-replace', 'PATCH ' + P + '/:id', 403, { after: true, body: { item_data: { status: 'unavailable' } }, setup: { who: STAFF, sqlRows: shelf }, patch: costHidden }),
    X('edit-currency-clash', 'PATCH ' + P + '/:id', 409, { body: { item_data: { name: 'Tea', price: { amount: 3, currency: 'USD' } } }, setup: withRows(shelf) }),
    /* schedule */
    X('schedule-read', 'GET ' + P + '/:id/schedule', 200, { patch: scheduleOn }),
    /* CAT-234: a parked change the owner made carries a cost; a cost-blind co-assist reads the list without it */
    X('schedule-read-cost-blind', 'GET ' + P + '/:id/schedule', 200, { setup: costBlind, patch: { schema: scheduleOn.schema, schedule: { pending: async () => [{ schedule_id: PARTY, item_id: PARTY, effective_at: SOMEDAY, patch: { status: 'unavailable', cost: 3 }, created_at: SOMEDAY }] }, cost: costHidden.cost } }),
    X('schedule-read-fails', 'GET ' + P + '/:id/schedule', 500, { patch: { schedule: { pending: boom } } }),
    X('schedule-needs-both', 'POST ' + P + '/:id/schedule', 400, { body: { effective_at: SOMEDAY } }),
    X('schedule-cost-blind', 'POST ' + P + '/:id/schedule', 403, { body: { effective_at: SOMEDAY, item_data: { price: 5 } }, setup: costBlind, patch: costHidden }),
    X('schedule-server-owned-key', 'POST ' + P + '/:id/schedule', 400, { body: { effective_at: SOMEDAY, item_data: { image: 'x' } } }),
    X('schedule-item-not-found', 'POST ' + P + '/:id/schedule', 404, { body: { effective_at: SOMEDAY, item_data: { name: 'Tea' } }, setup: withRows(money) }),
    X('schedule-not-enabled', 'POST ' + P + '/:id/schedule', 409, { body: { effective_at: SOMEDAY, item_data: { name: 'Tea2' } }, setup: withRows(shelf) }),
    X('schedule-bad-time', 'POST ' + P + '/:id/schedule', 400, { body: { effective_at: 'someday', item_data: { name: 'Tea2' } }, setup: withRows(shelf), patch: scheduleOn }),
    X('schedule-nothing-changed', 'POST ' + P + '/:id/schedule', 400, { body: { effective_at: SOMEDAY, item_data: { name: 'Tea' } }, setup: withRows(shelf), patch: scheduleOn }),
    X('schedule-parked', 'POST ' + P + '/:id/schedule', 200, { body: { effective_at: SOMEDAY, item_data: { name: 'Tea2' } }, setup: withRows(firstOf(answering(/INSERT INTO catalogue_item_schedule/, [{ schedule_id: PARTY, item_id: PARTY }]), shelf)), patch: scheduleOn }),
    X('schedule-db-fails', 'POST ' + P + '/:id/schedule', 500, { body: { effective_at: SOMEDAY, item_data: { name: 'Tea2' } }, setup: failing }),
    X('schedule-cancelled', 'DELETE ' + P + '/:id/schedule/:sid', 200, { patch: scheduleOn, setup: withRows(answering(/UPDATE catalogue_item_schedule/, [{ schedule_id: PARTY }])) }),
    X('schedule-cancel-fails', 'DELETE ' + P + '/:id/schedule/:sid', 500, { patch: { schedule: { cancel: boom } } }),
    /* availability */
    X('availability-bulk-none', 'POST ' + P + '/availability/bulk', 400, { body: { items: [] } }),
    X('availability-bulk-too-many', 'POST ' + P + '/availability/bulk', 400, { body: { items: manyOf(2001, { item_id: PARTY, qty: 1 }) } }),
    X('availability-bulk-written', 'POST ' + P + '/availability/bulk', 200, { body: { items: [{ item_id: PARTY, qty: 3 }, { code: 'zz', qty: 1 }, { item_id: PARTY, qty: -1 }] }, setup: withRows(firstOf(answering(/SELECT item_id, item_data->>'code' AS code/, [{ item_id: PARTY, code: 'A1', sku: null }]), shelf)) }),
    X('availability-bulk-db-fails', 'POST ' + P + '/availability/bulk', 500, { body: { items: [{ item_id: PARTY, qty: 3 }] }, setup: failing }),
    X('availability-qty-missing', 'PUT ' + P + '/:id/availability', 400, { body: {} }),
    X('availability-source-not-text', 'PUT ' + P + '/:id/availability', 400, { body: { qty: 3, source: 5 } }),
    X('availability-qty-negative', 'PUT ' + P + '/:id/availability', 400, { body: { qty: -3 } }),
    X('availability-item-not-found', 'PUT ' + P + '/:id/availability', 404, { body: { qty: 3 } }),
    X('availability-set', 'PUT ' + P + '/:id/availability', 200, { body: { qty: 3, source: 'erp', as_of: '2026-10-01' }, setup: withRows(shelf) }),
    X('availability-db-fails', 'PUT ' + P + '/:id/availability', 500, { body: { qty: 3 }, setup: failing }),
    /* status */
    X('status-missing', 'PUT ' + P + '/:id/status', 400, { body: {} }),
    X('status-item-not-found', 'PUT ' + P + '/:id/status', 404, { body: { status: 'unavailable' } }),
    X('status-unknown-word', 'PUT ' + P + '/:id/status', 400, { body: { status: 'sold' }, setup: withRows(shelf) }),
    X('status-set', 'PUT ' + P + '/:id/status', 200, { body: { status: 'unavailable' }, setup: withRows(shelf) }),
    X('status-marked-out', 'PUT ' + P + '/:id/status', 200, { body: { status: 'unavailable' }, setup: withRows(markedOut([{ item_id: PARTY }])) }),
    X('status-db-fails', 'PUT ' + P + '/:id/status', 500, { body: { status: 'unavailable' }, setup: failing }),
    /* DELETE /:id */
    X('removed', 'DELETE ' + P + '/:id', 200, { setup: withRows(shelf) }),
    /* media */
    X('media-store-off', 'GET ' + P + '/media/:item_id/:mid', 503, {}),
    X('media-item-not-found', 'GET ' + P + '/media/:item_id/:mid', 404, { patch: storeOn }),
    X('media-not-listed', 'GET ' + P + '/media/:item_id/:mid', 404, { patch: storeOn, setup: withRows(answering(/SELECT entity_id, item_data FROM catalogue_items/, [{ entity_id: SHOP, item_data: { media: [] } }])) }),
    X('media-served', 'GET ' + P + '/media/:item_id/:mid', 200, { patch: storeOn, setup: withRows(mediaRow()) }),
    X('media-key-outside-the-shop', 'GET ' + P + '/media/:item_id/:mid', 404, { patch: storeWith({ get: async () => { throw Object.assign(new Error('no'), { code: 'NOT_OWNER' }); } }), setup: withRows(mediaRow()) }),
    X('media-read-fails', 'GET ' + P + '/media/:item_id/:mid', 500, { patch: storeWith({ get: boom }), setup: withRows(mediaRow()) }),
    X('media-link-not-a-video', 'POST ' + P + '/:id/media', 400, { body: { url: 'https://example.com/x' } }),
    X('media-link-item-not-found', 'POST ' + P + '/:id/media', 404, { body: { url: 'https://youtu.be/abcdef123' } }),
    X('media-video-linked', 'POST ' + P + '/:id/media', 200, { body: { url: 'https://youtu.be/abcdef123', name: 'Tour' }, setup: withRows(shelf) }),
    X('media-video-linked-lists-media', 'POST ' + P + '/:id/media', 200, { body: { url: 'https://youtu.be/abcdef123', name: 'Tour' }, setup: withRows(withMedia([{ id: PARTY, kind: 'video' }])) }),
    X('media-name-and-bytes-needed', 'POST ' + P + '/:id/media', 400, { body: { name: 'a.png' } }),
    X('media-store-not-configured', 'POST ' + P + '/:id/media', 503, { body: { name: 'a.png', data_base64: PNG.toString('base64') } }),
    X('media-empty', 'POST ' + P + '/:id/media', 400, { body: { name: 'a.png', data_base64: '!' }, patch: storeOn }),
    X('media-too-large', 'POST ' + P + '/:id/media', 413, { body: { name: 'a.bin', data_base64: Buffer.alloc(8 * 1024 * 1024 + 1).toString('base64') }, patch: storeOn }),
    X('media-upload-item-not-found', 'POST ' + P + '/:id/media', 404, { body: { name: 'a.png', mime: 'image/png', data_base64: PNG.toString('base64') }, patch: storeOn }),
    X('media-uploaded', 'POST ' + P + '/:id/media', 200, { body: { name: 'a.png', mime: 'image/png', data_base64: 'data:image/png;base64,' + PNG.toString('base64') }, patch: storeOn, setup: withRows(shelf) }),
    X('media-uploaded-lists-media', 'POST ' + P + '/:id/media', 200, { body: { name: 'a.png', mime: 'image/png', data_base64: PNG.toString('base64') }, patch: storeOn, setup: withRows(withMedia([{ id: PARTY, kind: 'image' }])) }),
    X('media-upload-fails', 'POST ' + P + '/:id/media', 500, { body: { name: 'a.png', mime: 'image/png', data_base64: PNG.toString('base64') }, patch: storeWith({ put: boom }) }),
    X('media-removed', 'DELETE ' + P + '/:id/media/:mid', 200, { patch: storeOn, setup: withRows(answering(/SELECT item_data FROM catalogue_items WHERE item_id = \$1 AND entity_id = \$2/, [{ item_data: { media: [{ id: PARTY, key: 'k', kind: 'image' }] } }])) }),
    X('media-removed-one-stays', 'DELETE ' + P + '/:id/media/:mid', 200, { patch: storeOn, setup: withRows(answering(/SELECT item_data FROM catalogue_items WHERE item_id = \$1 AND entity_id = \$2/, [{ item_data: { media: [{ id: PARTY, key: 'k', kind: 'image' }, { id: 'm2', name: 'tour', kind: 'video' }] } }])) }),
    X('media-remove-key-outside-the-shop', 'DELETE ' + P + '/:id/media/:mid', 200, { patch: storeWith({ del: async () => { throw Object.assign(new Error('no'), { code: 'NOT_OWNER' }); } }), setup: withRows(answering(/SELECT item_data FROM catalogue_items WHERE item_id = \$1 AND entity_id = \$2/, [{ item_data: { media: [{ id: PARTY, key: 'k', kind: 'image' }] } }])) }),
    /* versions */
    X('versions-bad-date', 'GET ' + P + '/:id/versions', 400, { url: P + '/' + PARTY + '/versions?at=yesterday' }),
    X('versions-not-migrated', 'GET ' + P + '/:id/versions', 503, { setup: withRows(raising(/SELECT item_id FROM catalogue_items/, '42P01')) }),
    X('versions-listed', 'GET ' + P + '/:id/versions', 200, { setup: withRows(firstOf(answering(/SELECT item_id FROM catalogue_items/, [{ item_id: PARTY }]), answering(/FROM catalogue_item_version v/, [{ version_no: 1, valid_to: null, snapshot: { cost: 3 } }]))) }),
    X('versions-as-of', 'GET ' + P + '/:id/versions', 200, { url: P + '/' + PARTY + '/versions?at=2026-10-01T00:00:00.123Z', setup: withRows(firstOf(answering(/SELECT item_id FROM catalogue_items/, [{ item_id: PARTY }]), answering(/FROM catalogue_item_version/, [{ version_no: 1, snapshot: { cost: 3 } }]))) }),
    /* versions: no row at that moment (version null) · a history with no open version (current null) · no history at all */
    X('versions-as-of-no-row', 'GET ' + P + '/:id/versions', 200, { url: P + '/' + PARTY + '/versions?at=2026-10-01T00:00:00.123Z', setup: withRows(answering(/SELECT item_id FROM catalogue_items/, [{ item_id: PARTY }])) }),
    X('versions-none-open', 'GET ' + P + '/:id/versions', 200, { setup: withRows(firstOf(answering(/SELECT item_id FROM catalogue_items/, [{ item_id: PARTY }]), answering(/FROM catalogue_item_version v/, [{ version_no: 1, valid_to: '2026-10-01T00:00:00.000Z', snapshot: { name: 'Tea' } }]))) }),
    X('versions-no-history', 'GET ' + P + '/:id/versions', 200, { setup: withRows(answering(/SELECT item_id FROM catalogue_items/, [{ item_id: PARTY }])) }),
    /* the lists */
    X('lists-db-fails', 'GET ' + P + '/lists', 200, { setup: failing }),
    X('lists-trade-unreadable', 'GET ' + P + '/lists', 500, { patch: { gov: { verticalOf: boom } } }),
    X('lists-shown', 'GET ' + P + '/lists', 200, { setup: withRows(firstOf(money, answering(/FROM catalogue_items WHERE entity_id/, [{ name: 'Tea', unit: 'kg', price: { amount: 10, currency: 'INR' }, is_active: true }]))) }),
    /* the trade opens on a list (pick) · a trade no list fits (pick null, vertical named) · a shop with no stated trade (vertical null) */
    X('lists-for-a-grocer', 'GET ' + P + '/lists', 200, { patch: { gov: { verticalOf: async () => ({ key: 'kirana' }) } }, setup: withRows(money) }),
    X('lists-for-an-unlisted-trade', 'GET ' + P + '/lists', 200, { patch: { gov: { verticalOf: async () => ({ key: 'gold' }) } }, setup: withRows(money) }),
    X('lists-adopt-list-missing', 'POST ' + P + '/lists/adopt', 400, { body: {} }),
    X('lists-adopt-unknown-list', 'POST ' + P + '/lists/adopt', 400, { body: { list: 'nope' } }),
    X('lists-adopt-nothing-selected', 'POST ' + P + '/lists/adopt', 200, { body: { list: 'veg', names: [{ name: 'no such product', unit: 'kg' }] }, setup: withRows(money) }),
    X('lists-adopt-done', 'POST ' + P + '/lists/adopt', 200, { body: { list: 'veg', names: [{ name: 'Tomato (country)', unit: 'kg', price: 40 }], status: 'available' }, setup: withRows(firstOf(money, answering(/INSERT INTO catalogue_items/, [ITEM()]))) }),
    X('lists-adopt-a-row-with-a-picture', 'POST ' + P + '/lists/adopt', 400, { body: { list: 'veg', names: [{ name: 'Tomato', unit: 'kg' }] }, setup: withRows(money) }),
    X('lists-adopt-categories-fail', 'POST ' + P + '/lists/adopt', 500, { body: { list: 'veg' }, patch: { cats: { ensureCategories: boom } }, setup: withRows(money) }),
    X('lists-adopt-db-fails', 'POST ' + P + '/lists/adopt', 500, { body: { list: 'veg' }, setup: failing })
  ];
}

module.exports = { extras };
