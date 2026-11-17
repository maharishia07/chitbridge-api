#!/usr/bin/env node
/**
 * ctr-96-line-delivery-timestamp.test.cjs — CTR-96 (proof 2026-11-14): chit_line_delivery records item-level completion WITH a timestamp, so per-item time-to-ready falls out of it.
 * @type regression
 * OWNS      three halves: (1) the table's DDL (migrations/archive/b144_line_delivery.sql) gives every row delivered_at timestamptz NOT NULL DEFAULT now(), so a row cannot exist without its time;
 *           (2) the writer (lib/deliverline.recordMine) names no timestamp column, so the database stamps it and a client cannot back-date; (3) the reader (deliverline.progress) hands each delivery event
 *           its row's time as `at`: a line ordered 3, delivered 2 at 09:30:00Z and 1 at 11:45:00Z, answers events [09:30, 11:45] and the elapsed time between them is 135 minutes.
 * CALLED BY scripts/guards.cjs · CI. No database, no network.
 * FLOW      migration text · INSERT text from a stand-in db · progress() over hand-made rows
 *   node tests/ctr-96-line-delivery-timestamp.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { API, ok, done, mock, standInDb } = require('./lib/cat-proof-kit.cjs');

const ddl = fs.readFileSync(path.join(API, 'migrations', 'archive', 'b144_line_delivery.sql'), 'utf8');
const table = (ddl.match(/CREATE TABLE IF NOT EXISTS chit_line_delivery \(([\s\S]*?)\n\);/) || [])[1] || '';
ok('the table says delivered_at timestamptz NOT NULL DEFAULT now()', /delivered_at\s+timestamptz\s+NOT NULL\s+DEFAULT now\(\)/.test(table), table.slice(-200));

const L0 = '33333333-3333-4333-8333-333333333333';
const { db, calls } = standInDb((sql) => (/FROM chit_line WHERE/.test(sql) ? { rows: [{ line_id: L0, unit: 'plate' }] } : { rows: [{ display_name: 'Kaveri Mess' }], rowCount: 1 }));
mock('db', db); mock('db/index', db);
const deliverline = require(path.join(API, 'lib', 'deliverline.js'));
const E = '11111111-1111-4111-8111-111111111111', C = '22222222-2222-4222-8222-222222222222', L = '33333333-3333-4333-8333-333333333333';
const base = { chit_id: C, line_id: L, particulars: 'Idli', ordered: 3, ordered_unit: 'plate', ordered_price: 40, removed: false, recorded_by_entity_id: E, recorded_by_name: 'Kaveri Mess', du: 'plate', dkind: null };
const T1 = new Date('2026-11-10T09:30:00.000Z'), T2 = new Date('2026-11-10T11:45:00.000Z');
const rows = [Object.assign({ delivery_id: 'd1', dq: 2, delivered_at: T1 }, base), Object.assign({ delivery_id: 'd2', dq: 1, delivered_at: T2 }, base)];

(async () => {
  const sql = String(deliverline.PROGRESS_SQL('l.chit_id = $2'));
  ok('the reader selects d.delivered_at and orders by it', /d\.delivered_at,/.test(sql) && /ORDER BY[^`]*d\.delivered_at/.test(sql), sql.slice(0, 300));
  const map = await deliverline.progress(E, C, null, rows);
  const line = map.get(L);
  ok('the line is 3 ordered, 3 delivered', line && line.ordered === 3 && line.delivered === 3, JSON.stringify(line && { o: line.ordered, d: line.delivered }));
  const at = ((line && line.events) || []).map((e) => new Date(e.at).toISOString());
  ok('each delivery event carries its own time: 09:30:00Z then 11:45:00Z', at.join() === T1.toISOString() + ',' + T2.toISOString(), at.join());
  ok('so time-to-ready between the two events is 135 minutes', at.length === 2 && (new Date(at[1]) - new Date(at[0])) / 60000 === 135, at.join());
  calls.length = 0;
  await deliverline.record(E, C, [{ line_id: L, quantity: 1 }], { private: true });
  const ins = calls.find((c) => /INSERT INTO chit_line_delivery/.test(c.sql));
  ok('the writer names no timestamp column, so the database stamps the row (no back-dating)', !!ins && !/delivered_at|created_at/.test(ins.sql.split('SELECT')[0]), ins ? ins.sql.slice(0, 200) : 'no INSERT reached (the private path is not taken by this call)');
  done();
})();
