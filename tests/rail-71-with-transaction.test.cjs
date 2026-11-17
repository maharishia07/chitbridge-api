#!/usr/bin/env node
// @type: unit
/**
 * rail-71-with-transaction.test.cjs — RAIL-71 (cb-rail): withTransaction(fn) exists in db/index.js and the critical multi-writes of the rail run inside it:
 * the /send two-copy fan-out and the dispute creation. Written 2026-11-14 (proof pass); the claim's line numbers moved (chits.js:217 / 916 are now sendLegacyWrite and
 * POST /:chit_id/disputes → withEntity → recordRaise), the CLAIM did not.
 *   1  BEHAVIOUR (fake pg, no database): a good transaction is BEGIN · work · COMMIT, one client, released; a failing one is BEGIN · work · ROLLBACK, never COMMIT, the cause
 *      reaches the caller, the client is released. withEntity is withTransaction (one transaction + the entity binding).
 *   2  WHERE: the legacy /send fan-out runs in withTransaction; the b50 fan-out (mint.deliver) and the dispute's recordRaise run in withEntity(…, client => …) — the
 *      transaction primitive — and write on `client`, never on the pool's query.
 * HAND-COMPUTED: good path = [BEGIN, work, work, COMMIT]; failing path = [BEGIN, work, boom, ROLLBACK].
 * RUN       node tests/rail-71-with-transaction.test.cjs     (tests/rail-sec-db-proofs.red.cjs breaks each line and shows this go red)
 * CARD      01-rail-core-the-chit/send-mint-a-chit
 */
'use strict';
const EventEmitter = require('events');
const P = require('./lib-proof-mutate.cjs');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://u:p@127.0.0.1:1/none';

const seen = { clients: [] };
class Client extends EventEmitter {
  constructor() { super(); this.sql = []; this.released = false; }
  connect() { return Promise.resolve(); }
  end() { return Promise.resolve(); }
  query(sql) {
    this.sql.push(String(sql));
    if (/boom/.test(sql)) return Promise.reject(new Error('boom: the second write failed'));
    return Promise.resolve({ rows: [], rowCount: 0 });
  }
  release() { this.released = true; }
}
class Pool extends EventEmitter { connect(cb) {
    const c = new Client();
    c.release = () => { c.released = true; };
    if (cb) { cb(null, c, c.release); return undefined; }   /* db/index.js tryConnect uses the callback form once, at boot */
    seen.clients.push(c);
    return Promise.resolve(c);
  } end() { return Promise.resolve(); } }
const fakePg = { Pool, Client, escapeLiteral: (s) => "'" + s + "'", defaults: {}, types: { getTypeParser: () => (v) => v, setTypeParser() {} } };
require.cache[require.resolve('pg')] = { id: 'pg', filename: 'pg', loaded: true, exports: fakePg };

let failed = 0;
const check = (label, ok, detail) => { if (!ok) failed++; console.log((ok ? 'ok   ' : 'FAIL ') + label + (ok ? '' : ' :: ' + detail)); };
const kinds = (c) => c.sql.map((s) => (/^\s*BEGIN/i.test(s) ? 'BEGIN' : /^\s*COMMIT/i.test(s) ? 'COMMIT' : /^\s*ROLLBACK/i.test(s) ? 'ROLLBACK' : /boom/.test(s) ? 'boom' : /work/.test(s) ? 'work' : 'other'));

(async () => {
  const db = P.load('db/index.js');
  check('withTransaction is exported by db/index.js', typeof db.withTransaction === 'function' && typeof db.withEntity === 'function', typeof db.withTransaction);

  const out = await db.withTransaction(async (c) => { await c.query('work-1'); await c.query('work-2'); return 'done'; });
  const good = seen.clients[0];
  check('a good transaction returns what fn returned', out === 'done', String(out));
  check('…BEGIN first, COMMIT last, the two writes between, no ROLLBACK', kinds(good)[0] === 'BEGIN' && kinds(good).slice(-1)[0] === 'COMMIT' && kinds(good).filter((k) => k === 'work').length === 2 && !kinds(good).includes('ROLLBACK'), kinds(good).join());
  check('…and the client went back to the pool', good.released === true, String(good.released));

  let caught = null;
  try { await db.withTransaction(async (c) => { await c.query('work-1'); await c.query('boom'); await c.query('work-never'); }); } catch (e) { caught = e; }
  const bad = seen.clients[1];
  check('a failing write rejects the caller with the cause', caught && /boom: the second write failed/.test(caught.message), caught && caught.message);
  check('…the transaction is ROLLED BACK and never committed', kinds(bad).includes('ROLLBACK') && !kinds(bad).includes('COMMIT'), kinds(bad).join());
  check('…the write after the failure never ran, and the client was released', !bad.sql.some((s) => /work-never/.test(s)) && bad.released === true, bad.sql.join('|'));

  const viaEntity = await db.withEntity('11111111-1111-1111-1111-111111111111', async (c) => { await c.query('work-e'); return 7; });
  const ent = seen.clients[2];
  check('withEntity is ONE transaction (BEGIN … COMMIT) with the entity bound inside it', viaEntity === 7 && kinds(ent)[0] === 'BEGIN' && kinds(ent).slice(-1)[0] === 'COMMIT' && ent.sql.some((s) => /current_entity/.test(s)), kinds(ent).join() + ' :: ' + ent.sql.join('|').slice(0, 160));
  let caughtE = null;
  try { await db.withEntity('11111111-1111-1111-1111-111111111111', (c) => c.query('boom')); } catch (e) { caughtE = e; }
  check('…and a failing withEntity rolls back', caughtE && kinds(seen.clients[3]).includes('ROLLBACK') && !kinds(seen.clients[3]).includes('COMMIT'), kinds(seen.clients[3]).join());

  /* 2 · WHERE the critical multi-writes sit */
  const chits = P.read('routes/chits.js');
  const legacy = P.lift(chits, 'sendLegacyWrite');
  check('the legacy /send fan-out (sender four rows + every receiver) runs inside withTransaction', /await withTransaction\(async \(client\) =>/.test(legacy) && /sendLegacySenderRows\(client/.test(legacy) && /sendLegacyReceiverRows\(client/.test(legacy), legacy.slice(0, 200));
  check('…its writes go through the transaction client, not the pool', !/\bawait query\(/.test(legacy), 'pool query inside sendLegacyWrite');
  check('the b50 /send fan-out (mint.deliver) runs inside withEntity with the transaction client', /await withEntity\(sender_id, async \(entityClient\) => \{[\s\S]{0,700}?mint\.deliver\(sender_id, chit_id, copies, \{[^}]*client: entityClient/.test(chits), 'mint.deliver is not in withEntity(sender_id, entityClient)');
  check('dispute creation (recordRaise: copies, timeline rows, notices, reason message) runs inside withEntity with the transaction client', /await withEntity\(entity_id, \(client\) =>\s*recordRaise\(client,/.test(chits), 'recordRaise is not inside withEntity');
  const raise = P.lift(chits, 'recordRaise');
  check('…and recordRaise writes only on that client (no pool query between the copies and the notices)', !/\bawait query\(/.test(raise) && (raise.match(/await client\.query\(/g) || []).length >= 3, 'pool query inside recordRaise');
  console.log(failed ? '\n' + failed + ' FAILED' : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('FAIL the test itself threw :: ' + e.stack); process.exit(1); });
