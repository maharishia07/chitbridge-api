#!/usr/bin/env node
// @type: unit
/**
 * rail-173-assign.test.cjs — RAIL-173: a bill the books took back stays rejected / cancelled when someone pulls or pushes it (PUT /api/actors/assign/:chit_id).
 * The real route, lib/assign-chit and lib/rail-status statusGate over the in-memory books (tests/support/books-harness) and a small chit_status stand-in.
 * Hand-computed: a purchase posted (IN, INR 118) and then cancelled / rejected leaves 1 entry + 1 reversal; a refused pull or push writes NOTHING (no holder, no status, no task count, no log row)
 * and answers 409 `taken_back`; a rejected bill that never posted is pulled to pending as before (holder written, status pending, count +1).
 * RUN  BOOKS_ENGINES_SRC=<engines>/src node tests/rail-173-assign.test.cjs   (RAIL173_RAIL_STATUS=<lib path> swaps in a statusGate without the guard: rail-173-mutation.test.cjs)
 * CARD 01-rail-core-the-chit/assign
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

const SHOP = '11111111-1111-4111-8111-111111111111', SUPP = '33333333-3333-4333-8333-333333333333', STAFF = '55555555-5555-4555-8555-555555555555', OLD = '66666666-6666-4666-8666-666666666666';
const ID = { cancelled: { pull: 'a1111111-0000-4000-8000-000000000001', held: 'a1111111-0000-4000-8000-000000000002' }, rejected: { pull: 'a1111111-0000-4000-8000-000000000003', held: 'a1111111-0000-4000-8000-000000000004' } };
const NV = 'a1111111-0000-4000-8000-000000000005';
const AT = '2026-10-15T05:00:00Z';
const INVOICE = { currency: 'INR', ItemList: [{ GstRt: 18, AssAmt: 100, CgstAmt: 9, SgstAmt: 9, IgstAmt: 0, CesAmt: 0 }], ValDtls: { TotInvVal: 118 } };

(async () => {
  const X = H.load();
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why + '\n\n0 checks'); return; }
  const real = require.resolve(path.join(H.API, 'lib', 'rail-status'));
  if (process.env.RAIL173_RAIL_STATUS) require.cache[real] = { id: real, filename: real, loaded: true, exports: require(path.join(H.API, process.env.RAIL173_RAIL_STATUS)) };
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const TC = require(path.join(H.API, 'lib', 'tax-copy'));
  const world = { copy: null, entry: null };
  TC.copyOf = async () => world.copy; TC.entryFor = async () => world.entry;
  X.T.identities.push({ identity_id: SHOP, gstn: '33ABCDE1234F1Z5', display_name: 'IN shop', country: 'IN', policy_flags: { gst_registration: 'regular' } });
  X.T.parties.push({ owner: SHOP, party_id: SUPP, party_no: 'P-00002', name: 'Kumar Traders', supplier: true, credit_days: 15 });
  const setting = { enabled: true, walkin_grain: 'day', country: 'IN', functional_currency: 'INR' };
  await X.store.saveSetting(X.db, SHOP, setting);
  await X.B.enable(X.db, SHOP, { by: SHOP, today: '2026-10-15' }); K.forget(SHOP);
  const buyEntry = { sells: false, seller: { entity_id: SUPP, LglNm: 'Kumar Traders' }, me: { entity_id: SHOP }, invoice: INVOICE };
  const rec = (id, st) => ({ chit_id: id, purpose: 'invoice', created_at: AT, current_status: st, sender_entity_id: SUPP, business_json: { invoice_no: 'KT/' + id } });
  const use = (copy) => { world.copy = copy; world.entry = buyEntry; };
  const entriesOf = (id) => X.T.entries.filter((e) => e.entity_id === SHOP && e.source_ref === 'chit:' + id);
  const reversalsOf = (e) => X.T.entries.filter((x) => x.reverses_entry_id === e.entry_id);

  /* the stand-in chit_status + the writes the route makes */
  let STATUS = [], WRITES = [];
  const one = (s) => String(s).replace(/\s+/g, ' ').trim();
  const q = async (sql, p) => {
    const s = one(sql); p = p || [];
    if (/^SELECT cs\.\*, i\.display_name as actor_name FROM chit_status cs/.test(s)) { const r = STATUS.find((x) => x.chit_id === p[0] && x.entity_id === p[1]); return { rows: r ? [Object.assign({ actor_name: null }, r)] : [], rowCount: r ? 1 : 0 }; }
    if (/^SELECT current_status FROM chit_status/.test(s)) { const dir = (s.match(/direction = '(received|sent)'/) || [])[1]; const r = STATUS.filter((x) => x.chit_id === p[0] && x.entity_id === p[1] && x.direction === dir); return { rows: r.map((x) => ({ current_status: x.current_status })), rowCount: r.length }; }
    if (/^UPDATE chit_status SET assigned_to_actor_id = \$1/.test(s)) { WRITES.push('holder'); const r = STATUS.find((x) => x.chit_id === p[3] && x.entity_id === p[4]); if (r) r.assigned_to_actor_id = p[0]; return { rows: [], rowCount: r ? 1 : 0 }; }
    if (/^UPDATE chit_status SET current_status = \$1/.test(s)) { WRITES.push('status'); const r = STATUS.filter((x) => x.chit_id === p[1] && x.entity_id === p[2] && x.current_status === p[3]); r.forEach((x) => { x.current_status = p[0]; }); return { rows: r.map((x) => ({ chit_id: x.chit_id })), rowCount: r.length }; }
    if (/^SELECT identity_id, display_name, current_task_count, max_tasks FROM identities/.test(s)) return { rows: [{ identity_id: STAFF, display_name: 'Meena', current_task_count: 0, max_tasks: 10 }], rowCount: 1 };
    if (/^UPDATE identities SET current_task_count/.test(s)) { WRITES.push('count'); return { rows: [], rowCount: 1 }; }
    if (/^INSERT INTO state_log/.test(s)) { WRITES.push('log'); return { rows: [], rowCount: 1 }; }
    try { return await X.db.query(sql, p); } catch (e) { if (/ran real SQL/.test(e.message)) return { rows: [], rowCount: 0 }; throw e; }
  };
  const tx = { query: q };
  Object.assign(X.dbStub, { query: q, pool: { query: q, connect: async () => Object.assign({ release() {} }, tx) }, withEntity: async (id, fn) => fn(tx), withTransaction: async (fn) => fn(tx), onEntity: async (id, db, fn) => fn(tx), readBatch: async () => ({}) });
  const sc = require(path.join(H.API, 'lib', 'schema')); sc.hasColumn = async () => false; sc.hasTable = async () => false;
  const authPath = require.resolve(path.join(H.API, 'middleware', 'auth'));
  const auth = (req, res, next) => { req.identity = { identity_id: SHOP, display_name: 'Owner', identity_type: 'entity', hat: 'manager' }; next(); };
  auth.entityOf = (req) => req.identity.identity_id;
  require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: auth };
  const origErr = console.error; console.error = () => {};
  const app = express(); app.use(express.json()); app.use('/api/actors', require(path.join(H.API, 'routes', 'actors')));
  const server = app.listen(0); const port = server.address().port;
  const put = (id, body) => new Promise((done, bad) => {
    const data = JSON.stringify(body);
    const r = http.request({ port, path: '/api/actors/assign/' + id, method: 'PUT', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => { let t = ''; res.on('data', (c) => (t += c)); res.on('end', () => { let b = null; try { b = JSON.parse(t); } catch (e) { b = t; } done({ code: res.statusCode, body: b }); }); });
    r.on('error', bad); r.end(data);
  });
  const statusOf = (id) => STATUS.find((x) => x.chit_id === id).current_status;
  /* accepted + posted, then cancelled / rejected: the books hold the reversal (hand: 1 entry, 1 reversal) */
  const taken = async (id, how) => {
    STATUS = [{ chit_id: id, entity_id: SHOP, direction: 'received', current_status: 'accepted', assigned_to_actor_id: id === ID[how].held ? OLD : null }];
    use(rec(id, 'accepted')); await K.postChit(SHOP, id, {});
    use(rec(id, how)); STATUS[0].current_status = how;
    if (how === 'cancelled') await K.takeBackCancelled(SHOP, id, 'u1'); else await K.postChit(SHOP, id, {});
    const e = entriesOf(id)[0];
    return [entriesOf(id).length, reversalsOf(e).length];
  };

  for (const how of ['cancelled', 'rejected']) {
    for (const [action, id, body] of [['pull', ID[how].pull, { action: 'pull' }], ['push', ID[how].held, { action: 'push', target_actor_id: STAFF }]]) {
      const books = await taken(id, how);
      WRITES = [];
      const r = await put(id, body);
      const words = (r.body && (r.body.message || r.body.detail)) || '';
      eq('RAIL-173 /assign ' + action + ' (' + how + ' after post; books 1 entry + 1 reversal): 409 taken_back, in words', [books, r.code, r.body && r.body.code, /^This bill was .* after it was booked/.test(words), /send it again as a new bill/.test(words)], [[1, 1], 409, 'taken_back', true, true]);
      eq('RAIL-173 /assign ' + action + ' (' + how + '): status stays ' + how + ', nothing written (no holder, no status, no task count, no log row), previous holder kept', [statusOf(id), WRITES, STATUS[0].assigned_to_actor_id], [how, [], id === ID[how].held ? OLD : null]);
    }
  }
  /* never posted: a rejected bill nobody booked is pulled to pending as before */
  STATUS = [{ chit_id: NV, entity_id: SHOP, direction: 'received', current_status: 'rejected', assigned_to_actor_id: null }]; WRITES = [];
  const nv = await put(NV, { action: 'pull' });
  eq('RAIL-173 /assign pull (rejected but NEVER posted): 200, holder written, status pending, count +1', [nv.code, statusOf(NV), WRITES.filter((w) => w !== 'log')], [200, 'pending', ['holder', 'status', 'count']]);
  server.close(); console.error = origErr;
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n\n' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
