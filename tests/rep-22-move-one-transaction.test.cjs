/**
 * tests/rep-22-move-one-transaction.test.cjs — REP-22 (proof 2026-11-14): a status move reads, validates and writes in ONE transaction.
 * @type regression
 * OWNS      the proof that lib/chit-move.js moveStatus opens exactly ONE withEntity transaction for the first half of a move, and that the status read
 *           (SELECT current_status FROM chit_status), the header read (SELECT ... FROM chit_header) and the write (UPDATE chit_status SET current_status)
 *           all run inside it. Before REP-22 the status read was its own transaction (four trips across the Pacific to learn one word).
 *           Budget, hand-computed: transactions opened before the status UPDATE = 1; statements in that transaction >= 3 (read, header, write).
 *           (lib/chit-move.js moveStatus -> readThenWriteMove; cites drifted from routes/chits.js:3803)
 * CALLED BY scripts/guards.cjs · CI. No database: real lib/chit-move.js and lib/rail-status.js over a stand-in db that numbers each transaction.
 * FLOW      moveStatus(pending -> accepted) -> withEntity opens -> statements tagged with their transaction number -> assertions
 *   node tests/rep-22-move-one-transaction.test.cjs
 */
'use strict';
const path = require('path');
const { API, ok, done } = require('./lib/cat-proof-kit.cjs');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';

const R = 'bbbbbbbb-0000-4000-8000-00000000000b', S = 'aaaaaaaa-0000-4000-8000-00000000000a', C1 = '0000c417-0000-4000-8000-0000000000c1';
const LOG = []; /* { tx, sql } in the order sent */
let opens = 0, status = 'pending';
const one = (s) => String(s).split(/\s+/).join(' ').trim();
function answer(sql, p) {
  const s = one(sql);
  if (s.startsWith('SELECT current_status FROM chit_status')) return [{ current_status: status }];
  if (s.startsWith('UPDATE chit_status SET current_status')) { status = p[0]; return [{ chit_id: C1 }]; }
  if (s.includes('FROM chit_header')) return [{ sender_entity_id: S, purpose: 'order', business_json: {}, all_recipients: [] }];
  return [];
}
const clientOf = (tx) => ({ query: async (sql, p) => { LOG.push({ tx, sql: one(sql) }); const rows = answer(sql, p || []); return { rows, rowCount: rows.length }; } });
const withEntity = async (id, fn) => { opens++; return fn(clientOf(opens)); };
const dbPath = require.resolve(path.join(API, 'db'));
const base = clientOf(0);
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: base.query, pool: { query: base.query, connect: async () => Object.assign({ release() {} }, clientOf(0)) },
  withEntity, withTransaction: async (fn) => fn(clientOf(0)), onEntity: async (id, db, fn) => fn(clientOf(0)), readBatch: async () => [], trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } } } };
const sc = require(path.join(API, 'lib', 'schema'));
sc.hasColumn = async () => false; sc.hasTable = async () => false;
try { require(path.join(API, 'lib', 'books-hooks')).afterChit = () => Promise.resolve({}); } catch (_) {}
try { require(path.join(API, 'lib', 'whatsapp-out')).notifyChitStatus = async () => null; } catch (_) {}
const origErr = console.error; console.error = () => {};
const { moveStatus } = require(path.join(API, 'lib', 'chit-move'));

(async () => {
  const mv = await moveStatus(R, C1, 'accepted', { id: R, name: 'R' }, '', { level: 'editor' });
  console.error = origErr;
  ok('the move went through (200) and the status is now accepted', mv.code === 200 && status === 'accepted', JSON.stringify(mv).slice(0, 200));
  const iUpdate = LOG.findIndex((x) => x.sql.startsWith('UPDATE chit_status SET current_status'));
  const iRead = LOG.findIndex((x) => x.sql.startsWith('SELECT current_status FROM chit_status'));
  const iHeader = LOG.findIndex((x) => x.sql.includes('FROM chit_header'));
  ok('the status read, the header read and the status write were all sent', iRead >= 0 && iHeader >= 0 && iUpdate >= 0, JSON.stringify(LOG.map((x) => x.tx + ':' + x.sql.slice(0, 40))));
  ok('the status read and the write ran in the SAME transaction', iRead >= 0 && iUpdate >= 0 && LOG[iRead].tx === LOG[iUpdate].tx, iRead + '/' + iUpdate + ' ' + JSON.stringify(LOG.map((x) => x.tx)));
  ok('the header read ran in that transaction too (validation + copy for the freeze)', iHeader >= 0 && iUpdate >= 0 && LOG[iHeader].tx === LOG[iUpdate].tx);
  const firstTx = iRead >= 0 ? LOG[iRead].tx : -1;
  ok('budget: exactly ONE transaction is opened before the status write (the read is not its own)', iUpdate >= 0 && new Set(LOG.slice(0, iUpdate + 1).map((x) => x.tx)).size === 1 && LOG[0].tx === firstTx, JSON.stringify(LOG.slice(0, iUpdate + 1).map((x) => x.tx)));
  ok('that transaction holds at least the 3 statements (read, header, write)', LOG.filter((x) => x.tx === firstTx).length >= 3, String(LOG.filter((x) => x.tx === firstTx).length));
  done();
})().catch((e) => { console.error = origErr; console.error(e); process.exit(1); });
