#!/usr/bin/env node
// @type: unit
/**
 * rail-30-meter-chit-send.test.cjs — RAIL-30 (cb-rail): "Meter the events (chit.send first)": a SENT chit writes one usage_ledger row 'chit.send' carrying its basis, after the
 * work and unable to fail the send; a draft writes none. Written 2026-11-14 (proof pass). No database: the send step is lifted out of routes/chits.js and run with the meter
 * stood in; lib/meter.js is run with db.withEntity stood in.
 *   1  sendMeter (routes/chits.js): a sent chit → exactly one meter(sender_id, 'chit.send', { detail: chit_id, quantity: 1, basis: total_value, currency }); a draft → none;
 *      a meter that rejects, or throws, never rejects the send (and raises no unhandled rejection); it sits AFTER sendWrite in the send steps.
 *   2  lib/meter.js: the row is INSERT INTO usage_ledger with the meter name, the chit id as detail, the basis and its currency in meta; a failed insert answers false and
 *      warns, never rejects; no entity or no name = false and no insert.
 * HAND-COMPUTED: sent chit total 1250.50 INR → one call, basis 1250.5, currency INR; draft → 0 calls.
 * RUN       node tests/rail-30-meter-chit-send.test.cjs     (tests/rail-sec-db-proofs.red.cjs breaks each line and shows this go red)
 * CARD      28-platform-and-operations/usage-metering
 */
'use strict';
const path = require('path');
const P = require('./lib-proof-mutate.cjs');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';

let failed = 0;
const check = (label, ok, detail) => { if (!ok) failed++; console.log((ok ? 'ok   ' : 'FAIL ') + label + (ok ? '' : ' :: ' + detail)); };
const unhandled = [];
process.on('unhandledRejection', (e) => unhandled.push(e));

(async () => {
  const chits = P.read('routes/chits.js');
  const src = P.lift(chits, 'sendMeter');
  const calls = [];
  let mode = 'ok';
  const fakeMeter = { meter: (...a) => { calls.push(a); if (mode === 'reject') return Promise.reject(new Error('ledger down')); if (mode === 'throw') throw new Error('sync boom'); return Promise.resolve(true); } };
  const swallowed = [];
  const cbLog = { orElse: () => () => { swallowed.push('orElse'); }, fellBack: () => { swallowed.push('fellBack'); } };
  const sendMeter = new Function('require', 'cbLog', src + '\nreturn sendMeter;')((id) => (/meter/.test(id) ? fakeMeter : {}), cbLog);

  const state = { sender_id: 'ent-1', purpose: 'order', is_draft: false, chit_id: 'chit-9', summary: { total_value: 1250.5 }, summary_json: { currency_code: 'INR' } };
  await sendMeter(state, { id: 'rid-1' }, {});
  check('a sent chit meters exactly once', calls.length === 1, String(calls.length));
  check('…as chit.send for the SENDER entity, the chit id as detail, quantity 1', calls[0] && calls[0][0] === 'ent-1' && calls[0][1] === 'chit.send' && calls[0][2].detail === 'chit-9' && calls[0][2].quantity === 1, JSON.stringify(calls[0]));
  check('…carrying its basis (1250.5) and the currency it was in (INR), at send', calls[0] && calls[0][2].basis === 1250.5 && calls[0][2].currency === 'INR' && calls[0][2].rid === 'rid-1', JSON.stringify(calls[0] && calls[0][2]));

  calls.length = 0;
  await sendMeter({ ...state, is_draft: true }, { id: 'rid-2' }, {});
  check('a draft is not metered (nothing was sent, nobody received a copy)', calls.length === 0, String(calls.length));

  mode = 'reject';
  let threw = null;
  try { await sendMeter(state, { id: 'rid-3' }, {}); await new Promise((r) => setTimeout(r, 30)); } catch (e) { threw = e; }
  check('a meter that REJECTS cannot fail the send and raises no unhandled rejection', !threw && unhandled.length === 0, String(threw || unhandled[0]));
  mode = 'throw';
  threw = null;
  try { await sendMeter(state, { id: 'rid-4' }, {}); } catch (e) { threw = e; }
  check('a meter that THROWS cannot fail the send either (it falls back and carries on)', !threw && swallowed.includes('fellBack'), String(threw));

  const steps = chits.slice(chits.indexOf('sendStock,') - 600, chits.indexOf('sendStock,') + 60);
  check('the send runs sendMeter AFTER sendWrite (after the work, never before)', steps.indexOf('sendWrite') >= 0 && steps.indexOf('sendMeter') > steps.indexOf('sendWrite'), steps.replace(/\s+/g, ' '));

  /* 2 · lib/meter.js with withEntity stood in */
  const dbId = require.resolve(path.join(P.ROOT, 'db'));
  const inserted = [];
  let failInsert = false;
  const stubDb = { ...require(dbId), withEntity: async (entity, fn) => fn({ query: async (sql, params) => { if (failInsert) throw new Error('ledger down'); inserted.push({ entity, sql, params }); return { rows: [] }; } }) };
  require.cache[dbId] = { id: dbId, filename: dbId, loaded: true, exports: stubDb };
  const logId = require.resolve(path.join(P.ROOT, 'lib', 'logger'));
  const warns = [];
  const realLog = require(logId);
  require.cache[logId].exports = Object.assign(Object.create(realLog), { warn: (...a) => warns.push(a) });
  const { meter } = P.load('lib/meter.js');

  const ok = await meter('ent-1', 'chit.send', { detail: 'chit-9', quantity: 1, basis: 1250.5, currency: 'INR', rid: 'rid-5' });
  check('meter() answers true and writes ONE usage_ledger row for the entity', ok === true && inserted.length === 1 && /INSERT INTO usage_ledger/.test(inserted[0].sql) && inserted[0].entity === 'ent-1', JSON.stringify(inserted));
  const row = inserted[0] ? inserted[0].params : [];
  check('…named chit.send, the chit id as detail, quantity 1', row[1] === 'chit.send' && row[2] === 'chit-9' && row[3] === 1, JSON.stringify(row));
  const stamp = JSON.parse(row[5] || '{}');
  check('…the row explains itself: the basis 1250.5, its currency INR and the rate that applied', stamp.basis === 1250.5 && stamp.basis_currency === 'INR' && stamp.rate !== undefined, JSON.stringify(stamp));

  failInsert = true;
  let rejected = false;
  const failed1 = await meter('ent-1', 'chit.send', { detail: 'chit-9' }).catch(() => { rejected = true; });
  check('a failed insert answers false, never rejects, and says so at warn (not silent)', failed1 === false && !rejected && warns.length === 1 && /not metered/.test(String(warns[0][0])), JSON.stringify({ failed1, rejected, warns }));
  failInsert = false;
  inserted.length = 0;
  check('no entity → false and no row; no meter name → false and no row', (await meter('', 'chit.send')) === false && (await meter('ent-1', '')) === false && inserted.length === 0, JSON.stringify(inserted));

  console.log(failed ? '\n' + failed + ' FAILED' : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('FAIL the test itself threw :: ' + e.stack); process.exit(1); });
