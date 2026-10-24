/**
 * R14 (24 Oct walk): a party's phone and e-mail sent to PATCH /api/relationships/customers|suppliers/:id are KEPT (identities.otp_contact / identities.email
 * of the party this shop minted) or REFUSED in words - never a 200 "Customer updated" with changed: []. An unknown key on the customer PATCH is refused naming it.
 * No database: db and auth are stubbed with a one-row identities store; the route and lib/party-fields are the real ones.
 * Run: node tests/party-contact-patch.test.cjs
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'test';

const SHOP = '11111111-1111-4111-8111-111111111111',
  PRIYA = '22222222-2222-4222-8222-222222222222',
  OTHER = '33333333-3333-4333-8333-333333333333';
const ids = { [PRIYA]: { otp_contact: null, email: null, parent_entity_id: SHOP }, [OTHER]: { otp_contact: '+919000000009', email: 'x@y.com', parent_entity_id: null } };
const TAKEN = 'taken@local.test';
const tx = {
  query: async (sql, args) => {
    const s = String(sql);
    if (/FROM customer_list WHERE customer_list_id/.test(s)) return { rows: [{ customer_identity_id: args[0] === 'CL-OTHER' ? OTHER : PRIYA }] };
    if (/FROM supplier_list WHERE supplier_list_id/.test(s)) return { rows: [{ supplier_entity_id: PRIYA }] };
    if (/SELECT otp_contact, email, parent_entity_id FROM identities/.test(s)) return { rows: [ids[args[0]] ? Object.assign({}, ids[args[0]]) : undefined].filter(Boolean) };
    const set = /UPDATE identities SET (otp_contact|email) = \$2/.exec(s);
    if (set) {
      if (set[1] === 'email' && args[1] === TAKEN) throw Object.assign(new Error('duplicate key identities_email_key'), { code: '23505' });
      ids[args[0]][set[1]] = args[1];
    }
    return { rows: [] };
  }
};
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: { query: async () => ({ rows: [] }), withEntity: async (id, fn) => fn(tx), withTransaction: async (fn) => fn(tx), onEntity: async (id, db, fn) => fn(tx),
    trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } } }
};
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: Object.assign((req, res, next) => { req.identity = { identity_id: SHOP, identity_type: 'entity' }; next(); },
    { entityOf: (req) => req.identity.identity_id, requireScope: () => (q, s, n) => n(), userOf: (req) => req.identity })
};
const pf = require(path.join(API, 'lib', 'party-fields'));
pf.ensureNo = async () => 'P-0042';

const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/relationships', require(path.join(API, 'routes', 'relationships')));

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

(async () => {
  const srv = app.listen(0);
  const base = 'http://127.0.0.1:' + srv.address().port + '/api/relationships';
  const patch = async (url, body) => {
    const r = await fetch(base + url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };

  const a = await patch('/customers/CL-1', { phone: '9000000001', email: 'Priya@Local.test' });
  ok('phone and e-mail: 200 and both named as changed', a.status === 200 && a.body.party && a.body.party.changed.join() === 'phone,email', JSON.stringify(a));
  ok('phone kept in identities.otp_contact (the reader lib/crm.js uses)', ids[PRIYA].otp_contact === '9000000001' || /9000000001$/.test(ids[PRIYA].otp_contact || ''), String(ids[PRIYA].otp_contact));
  ok('e-mail kept lower-case in identities.email', ids[PRIYA].email === 'priya@local.test', String(ids[PRIYA].email));

  const same = await patch('/customers/CL-1', { email: 'priya@local.test' });
  ok('the same value again: 200, nothing to change, not an error', same.status === 200 && same.body.party.changed.length === 0, JSON.stringify(same));

  const clear = await patch('/customers/CL-1', { email: null });
  ok('null clears the e-mail', clear.status === 200 && ids[PRIYA].email === null && clear.body.party.changed.join() === 'email', JSON.stringify(clear));

  const unk = await patch('/customers/CL-1', { phone_number: '9000000002', mobile: 'x' });
  ok('unknown keys: 400 UNKNOWN_FIELD naming both, nothing 200', unk.status === 400 && unk.body.code === 'UNKNOWN_FIELD' && unk.body.fields.join() === 'phone_number,mobile' && /phone_number/.test(unk.body.message), JSON.stringify(unk));

  const badPhone = await patch('/customers/CL-1', { phone: 'abc' });
  ok('a phone that is not a phone: 400 in words', badPhone.status === 400 && /phone number/.test(badPhone.body.message), JSON.stringify(badPhone));

  const badMail = await patch('/customers/CL-1', { email: 'not-an-email' });
  ok('an e-mail that is not an e-mail: 400 in words', badMail.status === 400 && /e-mail/.test(badMail.body.message), JSON.stringify(badMail));

  const real = await patch('/customers/CL-OTHER', { phone: '9000000003' });
  ok('a real ChitBridge business: 403 in words, contact untouched', real.status === 403 && ids[OTHER].otp_contact === '+919000000009', JSON.stringify(real));

  const taken = await patch('/customers/CL-1', { email: TAKEN });
  ok('an e-mail another account holds: 409, words never name the holder', taken.status === 409 && !/taken@|identities/.test(JSON.stringify(taken.body)), JSON.stringify(taken));

  const sup = await patch('/suppliers/SL-1', { phone: '9000000004' });
  ok('a supplier keeps a phone the same way', sup.status === 200 && /9000000004$/.test(ids[PRIYA].otp_contact || ''), JSON.stringify(sup));

  const seg = await patch('/customers/CL-1', { segment_override: 'regular' });
  ok('segment_override still passes the key check (reaches its own write)', seg.status !== 400 || seg.body.code !== 'UNKNOWN_FIELD', JSON.stringify(seg));

  srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
