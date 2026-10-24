/**
 * supplies-scenes.cjs — the named scenarios of tests/api-problem-supplies.test.cjs: an answer the generic worlds cannot reach (a refusal inside a handler, a success to prove byte for byte).
 *
 * OWNS      the extras: one scenario per answer of the 5 routes of routes/supplies.js (what a shop buys to use: the list, add, edit, a purchase, an issue), each with the stand-in rows it
 *           needs, answered by the SHAPE of the statement so the same facts meet the old code and the new. Also the stand-in a foreign-id play uses (rows only to their owning shop).
 * CALLED BY tests/api-problem-supplies.test.cjs. Not a test itself.
 * FLOW      extras(tools) → [{ id, route, expect, setup: { sqlRows, who, db }, body, url }] → the harness runs each one against the real route
 * CARD      16-finance/supplies-routes
 * Every name below is an obviously made-up sundry ("Floor cleaner", "Corner Hardware"); there is no person's data in this file.
 */
'use strict';

const SUP = '/api/supplies';
const STRANGER_ID = '66666666-6666-4666-8666-666666666666';
const ITEM = '77777777-7777-4777-8777-777777777777';
const UNKNOWN_ITEM = '88888888-8888-4888-8888-888888888888';

const LISTED = { supply_item_id: ITEM, name: 'Floor cleaner', unit: 'bottle', sku: null, keep_stock: true, last_cost: '42.50', last_from: 'Corner Hardware', note: null, last_at: '2026-10-01T00:00:00.000Z', retired_at: null };
const KEPT = { supply_item_id: ITEM, name: 'Floor cleaner', unit: 'bottle', sku: null, keep_stock: true };
const EXPENSED = { supply_item_id: ITEM, name: 'Floor cleaner', unit: 'bottle', sku: null, keep_stock: false };
const EDITED = { supply_item_id: ITEM, name: 'Floor cleaner 5L', unit: 'bottle', sku: null, keep_stock: true, note: null, retired_at: null };
const BALANCE = { qty: '10', value: '100', avg_cost: '10', unit: 'bottle' };

/** the tools a scene is built from: the harness's own stand-ins */
function extras(tools) {
  const { STAFF, SECRET_SQL, answering, raising, firstOf } = tools;
  const X = (id, route, expect, more) => Object.assign({ id, route, expect, setup: {} }, more);
  const failing = { db: 'fail' };
  const at = (tail) => SUP + (tail || '');
  const lines = (...items) => ({ ref: 'BILL-1', from: 'Corner Hardware', lines: items });

  /* the statements the store runs, answered by their shape */
  const listRows = answering(/FROM supply_item s/, [LISTED]);
  const byName = (one) => answering(/FROM supply_item\s+WHERE entity_id = \$1 AND lower\(btrim\(name\)\) = \$2/, [one]);
  /* ensureMany asks once for all the lines: one row per asked name key, so the key it reads back (k) always matches */
  const manyRows = (one) => (sql, params) => (/lower\(btrim\(name\)\) AS k/.test(sql) ? { rows: params[1].map((key) => Object.assign({ k: key }, one, { name: key })), rowCount: params[1].length } : null);
  const edited = answering(/UPDATE supply_item\s+SET name/, [EDITED]);
  const looked = (one) => answering(/SELECT name, keep_stock, unit FROM supply_item/, [one]);
  const stock = (balance) => firstOf(answering(/SELECT qty, value, avg_cost, unit FROM stock_balance/, [balance || BALANCE]), answering(/INSERT INTO stock_movement/, [{ movement_id: '99999999-9999-4999-8999-999999999999', at: '2026-10-02T00:00:00.000Z' }]));
  const sqlState = (code) => () => { throw Object.assign(new Error('pg ' + code), { code }); };

  const reads = [
    X('list-read', 'GET ' + at(), 200, { setup: { sqlRows: listRows } }),
    X('list-all', 'GET ' + at(), 200, { url: at('?all=1'), setup: { sqlRows: listRows } }),
    X('list-asked-twice', 'GET ' + at(), 200, { url: at('?all=1&all=1'), setup: { sqlRows: listRows } }),
    X('list-of-staff', 'GET ' + at(), 200, { setup: { who: STAFF, sqlRows: listRows } }),
    X('list-empty', 'GET ' + at(), 200, {}),
    X('list-not-switched-on', 'GET ' + at(), 200, { setup: { sqlRows: raising(/FROM supply_item s/, '42P01') } }),
    X('list-db-fails', 'GET ' + at(), 500, { setup: failing }),
    X('list-fails-leaks-nothing', 'GET ' + at(), 500, { setup: { sqlRows: () => { throw new Error(SECRET_SQL); } } })
  ];

  const adds = [
    X('add-needs-a-name', 'POST ' + at(), 400, { body: {} }),
    X('add-name-is-spaces', 'POST ' + at(), 400, { body: { name: '   ' } }),
    X('add-body-a-list', 'POST ' + at(), 400, { body: [] }),
    X('add-not-created', 'POST ' + at(), 400, { body: { name: 'Floor cleaner' } }),
    X('add-made', 'POST ' + at(), 200, { body: { name: 'Floor cleaner', unit: 'bottle', note: 'for the shop floor' }, setup: { sqlRows: byName(KEPT) } }),
    X('add-made-and-counted', 'POST ' + at(), 200, { body: { name: 'Floor cleaner', unit: 'bottle', sku: 'FC-1', keep_stock: true }, setup: { sqlRows: byName(KEPT) } }),
    X('add-keep-stock-not-true', 'POST ' + at(), 200, { body: { name: 'Floor cleaner', keep_stock: 'yes' }, setup: { sqlRows: byName(EXPENSED) } }),
    X('add-unknown-key', 'POST ' + at(), 200, { body: { name: 'Floor cleaner', price: 99, visible: true }, setup: { sqlRows: byName(EXPENSED) } }),
    X('add-not-ready', 'POST ' + at(), 503, { body: { name: 'Floor cleaner' }, setup: { sqlRows: raising(/INSERT INTO supply_item/, '42P01') } }),
    X('add-fails', 'POST ' + at(), 500, { body: { name: 'Floor cleaner' }, setup: { sqlRows: raising(/INSERT INTO supply_item/, '23505') } }),
    X('add-fails-leaks-nothing', 'POST ' + at(), 500, { body: { name: 'Floor cleaner' }, setup: { sqlRows: () => { throw new Error(SECRET_SQL); } } })
  ];

  const edits = [
    X('edit-saved', 'PATCH ' + at('/:id'), 200, { url: at('/' + ITEM), body: { name: 'Floor cleaner 5L' }, setup: { sqlRows: edited } }),
    X('edit-retired', 'PATCH ' + at('/:id'), 200, { url: at('/' + ITEM), body: { retired: true }, setup: { sqlRows: edited } }),
    X('edit-nothing-sent', 'PATCH ' + at('/:id'), 200, { url: at('/' + ITEM), body: {}, setup: { sqlRows: edited } }),
    X('edit-unknown-key', 'PATCH ' + at('/:id'), 200, { url: at('/' + ITEM), body: { price: 99 }, setup: { sqlRows: edited } }),
    X('edit-not-found', 'PATCH ' + at('/:id'), 404, { url: at('/' + UNKNOWN_ITEM), body: { name: 'x' } }),
    X('edit-fails', 'PATCH ' + at('/:id'), 500, { url: at('/' + ITEM), body: { name: 'x' }, setup: { sqlRows: raising(/UPDATE supply_item/, '23505') } }),
    X('edit-table-missing-is-a-500', 'PATCH ' + at('/:id'), 500, { url: at('/' + ITEM), body: { name: 'x' }, setup: { sqlRows: raising(/UPDATE supply_item/, '42P01') } }),
    X('edit-fails-leaks-nothing', 'PATCH ' + at('/:id'), 500, { url: at('/' + ITEM), body: { name: 'x' }, setup: { sqlRows: () => { throw new Error(SECRET_SQL); } } })
  ];

  const kept = firstOf(manyRows(KEPT), stock());
  const expensed = manyRows(EXPENSED);
  const buys = [
    X('buy-no-lines', 'POST ' + at('/purchase'), 400, { body: { ref: 'BILL-1' } }),
    X('buy-lines-empty', 'POST ' + at('/purchase'), 400, { body: { ref: 'BILL-1', lines: [] } }),
    X('buy-no-reference', 'POST ' + at('/purchase'), 400, { body: { lines: [{ name: 'Floor cleaner', qty: 1 }] } }),
    X('buy-reference-is-spaces', 'POST ' + at('/purchase'), 400, { body: { ref: '   ', lines: [{ name: 'Floor cleaner', qty: 1 }] } }),
    X('buy-body-a-list', 'POST ' + at('/purchase'), 400, { body: [] }),
    X('buy-expensed-one', 'POST ' + at('/purchase'), 200, { body: lines({ name: 'Floor cleaner', qty: 2, cost: 40 }), setup: { sqlRows: expensed } }),
    X('buy-expensed-many', 'POST ' + at('/purchase'), 200, { body: lines({ name: 'Floor cleaner', qty: 2, cost: 40 }, { name: 'Dusters', qty: 6, cost: 12 }), setup: { sqlRows: expensed } }),
    X('buy-counted-one', 'POST ' + at('/purchase'), 200, { body: lines({ name: 'Floor cleaner', qty: 2, cost: 40, unit: 'bottle' }), setup: { sqlRows: kept } }),
    X('buy-counted-without-cost', 'POST ' + at('/purchase'), 200, { body: lines({ name: 'Floor cleaner', qty: 2 }), setup: { sqlRows: kept } }),
    X('buy-a-line-with-no-name', 'POST ' + at('/purchase'), 200, { body: lines({ qty: 2, cost: 40 }, { name: 'Floor cleaner', qty: 1, cost: 40 }), setup: { sqlRows: expensed } }),
    X('buy-a-line-of-nothing', 'POST ' + at('/purchase'), 200, { body: lines({ name: 'Floor cleaner', qty: 0, cost: 40 }), setup: { sqlRows: expensed } }),
    X('buy-an-id-in-the-body-is-not-read', 'POST ' + at('/purchase'), 200, { body: lines({ name: 'Floor cleaner', supply_item_id: UNKNOWN_ITEM, qty: 1, cost: 40 }), setup: { sqlRows: expensed } }),
    X('buy-unit-differs-from-the-balance', 'POST ' + at('/purchase'), 200, { body: lines({ name: 'Floor cleaner', qty: 2, cost: 40, unit: 'carton' }), setup: { sqlRows: firstOf(manyRows(KEPT), stock()) } }),
    X('buy-not-ready', 'POST ' + at('/purchase'), 503, { body: lines({ name: 'Floor cleaner', qty: 1 }), setup: { sqlRows: raising(/INSERT INTO supply_item/, '42P01') } }),
    X('buy-fails', 'POST ' + at('/purchase'), 500, { body: lines({ name: 'Floor cleaner', qty: 1 }), setup: { sqlRows: raising(/INSERT INTO supply_item/, '23505') } }),
    X('buy-fails-leaks-nothing', 'POST ' + at('/purchase'), 500, { body: lines({ name: 'Floor cleaner', qty: 1 }), setup: { sqlRows: () => { throw new Error(SECRET_SQL); } } }),
    X('buy-counted-line-fails-leaks-nothing', 'POST ' + at('/purchase'), 500, { body: lines({ name: 'Floor cleaner', qty: 2, cost: 40 }), setup: { sqlRows: firstOf(manyRows(KEPT), (sql) => { if (/stock_balance/.test(sql)) throw new Error(SECRET_SQL); return null; }) } })
  ];

  const issues = [
    X('issue-recorded', 'POST ' + at('/:id/issue'), 200, { url: at('/' + ITEM + '/issue'), body: { qty: 2, ref: 'USE-1' }, setup: { sqlRows: firstOf(looked(KEPT), stock()) } }),
    X('issue-recorded-without-a-ref', 'POST ' + at('/:id/issue'), 200, { url: at('/' + ITEM + '/issue'), body: { qty: 2 }, setup: { sqlRows: firstOf(looked(KEPT), stock()) } }),
    X('issue-no-such-supply', 'POST ' + at('/:id/issue'), 400, { url: at('/' + UNKNOWN_ITEM + '/issue'), body: { qty: 2 } }),
    X('issue-expensed-supply', 'POST ' + at('/:id/issue'), 400, { url: at('/' + ITEM + '/issue'), body: { qty: 2 }, setup: { sqlRows: looked(EXPENSED) } }),
    X('issue-nothing', 'POST ' + at('/:id/issue'), 400, { url: at('/' + ITEM + '/issue'), body: {}, setup: { sqlRows: looked(KEPT) } }),
    X('issue-not-a-number', 'POST ' + at('/:id/issue'), 400, { url: at('/' + ITEM + '/issue'), body: { qty: 'lots' }, setup: { sqlRows: looked(KEPT) } }),
    X('issue-negative', 'POST ' + at('/:id/issue'), 400, { url: at('/' + ITEM + '/issue'), body: { qty: -3 }, setup: { sqlRows: looked(KEPT) } }),
    X('issue-unit-differs-from-the-balance', 'POST ' + at('/:id/issue'), 400, { url: at('/' + ITEM + '/issue'), body: { qty: 2 }, setup: { sqlRows: firstOf(looked(Object.assign({}, KEPT, { unit: 'carton' })), stock()) } }),
    X('issue-fails', 'POST ' + at('/:id/issue'), 500, { url: at('/' + ITEM + '/issue'), body: { qty: 2 }, setup: { sqlRows: raising(/FROM supply_item/, '23505') } }),
    X('issue-table-missing-is-a-500', 'POST ' + at('/:id/issue'), 500, { url: at('/' + ITEM + '/issue'), body: { qty: 2 }, setup: { sqlRows: sqlState('42P01') } }),
    X('issue-fails-leaks-nothing', 'POST ' + at('/:id/issue'), 500, { url: at('/' + ITEM + '/issue'), body: { qty: 2 }, setup: { sqlRows: () => { throw new Error(SECRET_SQL); } } })
  ];

  return [].concat(reads, adds, edits, buys, issues);
}

/**
 * the stand-in for a foreign-id play: the supply exists for the owning shop only (as RLS and `WHERE entity_id = $1` make it), so shop B asking for shop A's id meets exactly what an unknown id meets.
 * `owner` is the id of the shop that owns the row; the statement's first parameter is the shop asking.
 */
const ownedBy = (owner, planted) => (sql, params) => {
  if (!planted || !params || params[0] !== owner || params[1] !== ITEM) return null;
  if (/UPDATE supply_item\s+SET name/.test(sql)) return { rows: [EDITED], rowCount: 1 };
  if (/SELECT name, keep_stock, unit FROM supply_item/.test(sql)) return { rows: [KEPT], rowCount: 1 };
  if (/SELECT qty, value, avg_cost, unit FROM stock_balance/.test(sql)) return { rows: [BALANCE], rowCount: 1 };
  if (/INSERT INTO stock_movement/.test(sql)) return { rows: [{ movement_id: '99999999-9999-4999-8999-999999999999', at: '2026-10-02T00:00:00.000Z' }], rowCount: 1 };
  return null;
};

module.exports = { extras, ownedBy, ITEM, UNKNOWN_ITEM, STRANGER_ID, BALANCE };
