/**
 * R14 (24 Oct walk): a party's phone and e-mail sent to PATCH /api/relationships/customers|suppliers/:id are KEPT (identities.otp_contact / identities.email
 * of the party this shop minted; the e-mail in party_contact since SEC-130, b839) or REFUSED in words - never a 200 "Customer updated" with changed: []. An unknown key on the customer PATCH is refused naming it.
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
const TAKEN = 'taken@local.test'; /* an address another account signs in with: it saves like any other (SEC-130 residual) */
const pcon = {}; /* party_contact for this shop: party id → e-mail */
const tx = {
  query: async (sql, args) => {
    const s = String(sql);
    if (/FROM customer_list WHERE customer_list_id/.test(s)) return { rows: [{ customer_identity_id: args[0] === 'cccccccc-cccc-4ccc-8ccc-0000000000ff' ? OTHER : PRIYA }] };
    if (/FROM supplier_list WHERE supplier_list_id/.test(s)) return { rows: [{ supplier_entity_id: PRIYA }] };
    if (/SELECT i\.otp_contact, .* AS email, i\.parent_entity_id FROM identities i/.test(s)) return { rows: [ids[args[0]] ? Object.assign({}, ids[args[0]], { email: pcon[args[0]] || ids[args[0]].email }) : undefined].filter(Boolean) };
    if (/FROM identities i\s+WHERE i\.parent_entity_id/.test(s)) return { rows: [] };
    if (/^\s*INSERT INTO party_contact/.test(s)) { pcon[args[1]] = args[2]; return { rows: [] }; }
    if (/^\s*DELETE FROM party_contact/.test(s)) { delete pcon[args[1]]; return { rows: [] }; }
    const set = /UPDATE identities SET (otp_contact|email) = \$2/.exec(s);
    if (set) {
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
const schemaPath = require.resolve(path.join(API, 'lib', 'schema'));
require.cache[schemaPath] = { id: schemaPath, filename: schemaPath, loaded: true, exports: { hasTable: async () => true, hasColumn: async () => true, hasColumns: async () => true, has: async () => true } };
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

  const a = await patch('/customers/cccccccc-cccc-4ccc-8ccc-000000000001', { phone: '9000000001', email: 'Priya@Local.test' });
  ok('phone and e-mail: 200 and both named as changed', a.status === 200 && a.body.party && a.body.party.changed.join() === 'phone,email', JSON.stringify(a));
  ok('phone kept in identities.otp_contact (the reader lib/crm.js uses)', ids[PRIYA].otp_contact === '9000000001' || /9000000001$/.test(ids[PRIYA].otp_contact || ''), String(ids[PRIYA].otp_contact));
  ok('e-mail kept lower-case in party_contact, none on identities', pcon[PRIYA] === 'priya@local.test' && ids[PRIYA].email === null, String(pcon[PRIYA]));

  const same = await patch('/customers/cccccccc-cccc-4ccc-8ccc-000000000001', { email: 'priya@local.test' });
  ok('the same value again: 200, nothing to change, not an error', same.status === 200 && same.body.party.changed.length === 0, JSON.stringify(same));

  const clear = await patch('/customers/cccccccc-cccc-4ccc-8ccc-000000000001', { email: null });
  ok('null clears the e-mail', clear.status === 200 && pcon[PRIYA] === undefined && clear.body.party.changed.join() === 'email', JSON.stringify(clear));

  const unk = await patch('/customers/cccccccc-cccc-4ccc-8ccc-000000000001', { phone_number: '9000000002', mobile: 'x' });
  ok('unknown keys: 400 UNKNOWN_FIELD naming both, nothing 200', unk.status === 400 && unk.body.code === 'UNKNOWN_FIELD' && unk.body.fields.join() === 'phone_number,mobile' && /phone_number/.test(unk.body.message), JSON.stringify(unk));

  const badPhone = await patch('/customers/cccccccc-cccc-4ccc-8ccc-000000000001', { phone: 'abc' });
  ok('a phone that is not a phone: 400 in words', badPhone.status === 400 && /phone number/.test(badPhone.body.message), JSON.stringify(badPhone));

  const badMail = await patch('/customers/cccccccc-cccc-4ccc-8ccc-000000000001', { email: 'not-an-email' });
  ok('an e-mail that is not an e-mail: 400 in words', badMail.status === 400 && /e-mail/.test(badMail.body.message), JSON.stringify(badMail));

  /* CRM-42: the shape check once lost its escapes and refused any address with an "s" */
  for (const good of ['sam@shop.com', 'sam+orders@shop.com', 'sales@mail.shop.co.in', 's.s@ss.ss', 'first.last@sub.domain.example']) {
    const r = await patch('/customers/cccccccc-cccc-4ccc-8ccc-000000000001', { email: good });
    ok('a real address is kept: ' + good, r.status === 200 && pcon[PRIYA] === good, JSON.stringify(r));
  }
  for (const wrong of ['a b@x.yz', 'sam@shop', 'sam@@shop.com', 'sam@shop..com', 'sam@.shop.com', 'sam@shop.com.', '@shop.com', 'sam@shop com.in']) {
    const r = await patch('/customers/cccccccc-cccc-4ccc-8ccc-000000000001', { email: wrong });
    ok('a wrong shape is refused in words: ' + wrong, r.status === 400 && /e-mail/.test(r.body.message), JSON.stringify(r));
  }

  const real = await patch('/customers/cccccccc-cccc-4ccc-8ccc-0000000000ff', { phone: '9000000003' });
  ok('a real ChitBridge business: 403 in words, contact untouched', real.status === 403 && ids[OTHER].otp_contact === '+919000000009', JSON.stringify(real));

  const taken = await patch('/customers/cccccccc-cccc-4ccc-8ccc-000000000001', { email: TAKEN });
  ok('an e-mail another account signs in with: saved like any other, nothing said about who else has it', taken.status === 200 && pcon[PRIYA] === TAKEN && !/another account|identities/.test(JSON.stringify(taken.body)), JSON.stringify(taken));

  const sup = await patch('/suppliers/5555cccc-cccc-4ccc-8ccc-000000000001', { phone: '9000000004' });
  ok('a supplier keeps a phone the same way', sup.status === 200 && /9000000004$/.test(ids[PRIYA].otp_contact || ''), JSON.stringify(sup));

  const seg = await patch('/customers/cccccccc-cccc-4ccc-8ccc-000000000001', { segment_override: 'regular' });
  ok('segment_override still passes the key check (reaches its own write)', seg.status !== 400 || seg.body.code !== 'UNKNOWN_FIELD', JSON.stringify(seg));

  srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
