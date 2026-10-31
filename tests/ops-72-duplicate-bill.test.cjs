#!/usr/bin/env node
// @type: contract
/**
 * ops-72-duplicate-bill.test.cjs — OPS-72: POST /api/supplies/purchase must say what really happened to a bill number used before.
 *
 * OWNS      the proof that the same bill sent again is "already recorded" (nothing counted twice), that the same supplier's bill number with other lines is refused
 *           in words (409 SUPPLY_BILL_DIFFERS, the count untouched), that another supplier's bill with the same number is a bill of its own (both count), and that a fresh bill is unchanged.
 * CALLED BY scripts/guards.cjs · CI. No database: the real route and stores over a stand-in that keeps rows in memory and holds the real unique key
 *           (uq_stock_movement_once, migrations/000_baseline_2026-10-21.sql: entity, ref, line_ref, reason, lot — where ref is not null).
 * FLOW      POST /api/supplies/purchase → supply-store.purchase → stock-store.movesOfRef / post → stand-in rows → the answer's words and the count
 * CARD      13-inventory-stock-and-traceability/on-hand-and-movements
 */
'use strict';
const path = require('path');
const { harness, OWNER } = require('./lib/problem-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const lab = harness({ here: HERE, mounts: ['/api/supplies'], routeFiles: { '/api/supplies': 'routes/supplies.js' } });
const { check, world } = lab;

/** the stand-in database: supplies, the movement log with its unique key, and the balances — answered by the shape of the statement */
function standIn() {
  const items = new Map(); /* name key → row */
  const moves = new Map(); /* the unique key → row */
  const balance = new Map(); /* item_id → { qty, value } */
  world.sqlRows = (sql, p) => {
    if (/INSERT INTO supply_item/.test(sql)) {
      p[1].forEach((name, i) => {
        const k = name.trim().toLowerCase();
        if (!items.has(k)) items.set(k, { supply_item_id: 'item-' + (items.size + 1), name, unit: p[2][i], sku: null, keep_stock: p[4][i] });
      });
      return { rows: [], rowCount: 0 };
    }
    if (/lower\(btrim\(name\)\) AS k/.test(sql)) return { rows: p[1].map((k) => Object.assign({ k }, items.get(k))), rowCount: p[1].length };
    if (/SELECT item_id, line_ref, qty FROM stock_movement/.test(sql)) {
      const rows = [...moves.values()].filter((m) => m.ref === p[1] && m.reason === p[2]);
      return { rows, rowCount: rows.length };
    }
    if (/INSERT INTO stock_balance/.test(sql)) {
      if (!balance.has(p[1])) balance.set(p[1], { qty: 0, value: 0, avg_cost: 0, unit: null });
      return { rows: [], rowCount: 0 };
    }
    if (/SELECT qty, value, avg_cost, unit FROM stock_balance/.test(sql) || /SELECT qty, value, avg_cost, unit, last_at, moves FROM stock_balance/.test(sql)) return { rows: [balance.get(p[1])], rowCount: 1 };
    if (/INSERT INTO stock_movement/.test(sql)) {
      const key = [p[0], p[8], p[9], p[7], p[10] || ''].join('|');
      if (p[8] != null && moves.has(key)) return { rows: [], rowCount: 0 }; /* ON CONFLICT DO NOTHING */
      moves.set(key, { item_id: p[1], line_ref: p[9], qty: p[3], ref: p[8], reason: p[7] });
      return { rows: [{ movement_id: 'mv-' + moves.size, at: new Date().toISOString() }], rowCount: 1 };
    }
    if (/UPDATE stock_balance/.test(sql)) {
      Object.assign(balance.get(p[1]), { qty: p[3], value: p[4], avg_cost: p[5], unit: p[7] });
      return { rows: [], rowCount: 1 };
    }
    return null;
  };
  return { onHand: (name) => (balance.get(items.get(name.toLowerCase()).supply_item_id) || { qty: 0 }).qty };
}

(async () => {
  world.who = OWNER;
  lab.installStubs();
  const db = standIn();
  const router = require(path.join(HERE, 'routes', 'supplies.js'));
  const server = lab.appOf([{ mount: '/api/supplies', router }]).listen(0);
  const port = server.address().port;
  const buy = (ref, from, qty, name) => lab.send(port, 'POST', '/api/supplies/purchase', { ref, from, lines: [{ name: name || 'Tape', qty, cost: 10, keep_stock: true }] });
  const say = (a) => String((a.json && (a.json.says || a.json.message || a.json.detail)) || '');
  console.log('ops-72-duplicate-bill');

  const fresh = await buy('F1', 'Acme', 3, 'Glue');
  check('a fresh bill is recorded and says counted', fresh.status === 200 && /1 counted/.test(say(fresh)) && fresh.json.stocked === 1, fresh);
  check('a fresh bill moves the count', db.onHand('Glue') === 3);

  const first = await buy('B1', 'Acme', 5);
  check('B1 Tape 5 is counted', first.status === 200 && /1 counted/.test(say(first)) && db.onHand('Tape') === 5, first);
  const again = await buy('B1', 'Acme', 5);
  check('the same bill again answers 200', again.status === 200, again);
  check('the same bill again says already recorded', /already recorded/i.test(say(again)), say(again));
  check('the same bill again says 0 counted and stocks 0', /0 counted/.test(say(again)) && again.json.stocked === 0, again.json);
  check('the same bill again leaves the count at 5', db.onHand('Tape') === 5);

  const changed = await buy('B1', 'Acme', 7);
  check('the same supplier, same number, other lines: 409', changed.status === 409, changed);
  check('the 409 carries a registered code and says why in words', changed.json && changed.json.code === 'SUPPLY_BILL_DIFFERS' && /B1 from Acme is already recorded with different lines/.test(say(changed)), changed.json);
  check('the 409 leaves the count at 5', db.onHand('Tape') === 5);

  const other = await buy('B1', 'Beta Traders', 7);
  check('another supplier with the same number is counted', other.status === 200 && /1 counted/.test(say(other)) && !/already/.test(say(other)), other);
  check('both suppliers\' bills count: 12', db.onHand('Tape') === 12, db.onHand('Tape'));

  const noSupplier = await buy('N1', null, 2, 'Rope');
  const noSupplierAgain = await buy('N1', null, 2, 'Rope');
  check('no supplier named: the bill still counts once', noSupplier.status === 200 && /1 counted/.test(say(noSupplier)) && /already recorded/.test(say(noSupplierAgain)) && db.onHand('Rope') === 2);

  /* a bill recorded before the supplier was part of the ref sits under the bare number: seeded by a purchase that names no supplier */
  await buy('L1', null, 4, 'Nails');
  const legacySame = await buy('L1', 'Acme', 4, 'Nails');
  check('legacy bill, same lines, sent with a supplier: already recorded, 0 counted', legacySame.status === 200 && /already recorded/.test(say(legacySame)) && /0 counted/.test(say(legacySame)) && legacySame.json.stocked === 0, legacySame.json);
  check('legacy bill sent again does not double the count', db.onHand('Nails') === 4);
  const legacyDiffers = await buy('L1', 'Acme', 9, 'Nails');
  check('legacy bill, other lines, sent with a supplier: 409 SUPPLY_BILL_DIFFERS', legacyDiffers.status === 409 && legacyDiffers.json.code === 'SUPPLY_BILL_DIFFERS' && db.onHand('Nails') === 4, legacyDiffers.json);
  const noLegacy = await buy('L2', 'Acme', 6, 'Nails');
  check('no legacy bill under that number: counts', noLegacy.status === 200 && /1 counted/.test(say(noLegacy)) && db.onHand('Nails') === 10, noLegacy.json);

  server.close();
  const total = lab.count.passed + lab.count.failed;
  console.log(total + ' checks' + (lab.count.failed ? ' · ' + lab.count.failed + ' FAILED' : ''));
  process.exit(lab.count.failed ? 1 : 0);
})();
