/**
 * CRM-45: a PATCH on a customer or supplier names EVERY field it saved in party.changed: segment_override, and the supplier's own nickname, category, notes, preferred, supply_kind - first,
 * then the party fields (phone, e-mail ...) - one answer shape { message, party: { changed } }. Before: "Segment updated" with nothing named, and the party's changed[] dropped when sent together.
 * No database: db and auth are stubbed; the route and lib/party-fields are the real ones (the harness of tests/party-contact-patch.test.cjs).
 * Run: node tests/crm-45-changed-named.test.cjs
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'test';

const SHOP = '11111111-1111-4111-8111-111111111111',
  PRIYA = '22222222-2222-4222-8222-222222222222';
const CUST = 'cccccccc-cccc-4ccc-8ccc-000000000001',
  SUPP = '5555cccc-cccc-4ccc-8ccc-000000000001';
const ids = { [PRIYA]: { otp_contact: null, email: null, parent_entity_id: SHOP } };
const tx = {
  query: async (sql, args) => {
    const s = String(sql);
    if (/FROM customer_list WHERE customer_list_id/.test(s)) return { rows: [{ customer_identity_id: PRIYA }] };
    if (/FROM supplier_list WHERE supplier_list_id/.test(s)) return { rows: [{ supplier_entity_id: PRIYA }] };
    if (/SELECT i\.otp_contact, .* AS email, i\.parent_entity_id FROM identities i/.test(s)) return { rows: [Object.assign({}, ids[args[0]])] };
    if (/FROM identities i\s+WHERE i\.parent_entity_id/.test(s)) return { rows: [] };
    if (/^\s*UPDATE customer_list SET segment_override/.test(s)) return { rows: [{ customer_list_id: args[1] }] };
    if (/^\s*UPDATE supplier_list SET/.test(s)) return { rows: [{ supplier_list_id: args[args.length - 2] }] };
    const set = /UPDATE identities SET (otp_contact|email) = \$2/.exec(s);
    if (set) ids[args[0]][set[1]] = args[1];
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
require(path.join(API, 'lib', 'party-fields')).ensureNo = async () => 'P-0042';

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
  const named = (r, list) => r.status === 200 && r.body.party && r.body.party.changed.join() === list;

  const seg = await patch('/customers/' + CUST, { segment_override: 'regular' });
  ok('segment_override alone: 200 and named', named(seg, 'segment_override'), JSON.stringify(seg));

  const both = await patch('/customers/' + CUST, { segment_override: 'high_value', phone: '9000000001' });
  ok('segment_override with a party field: both named, the party answer not dropped', named(both, 'segment_override,phone'), JSON.stringify(both));

  const sup = await patch('/suppliers/' + SUPP, { nickname: 'Corner', notes: 'pays late', category: 'tools', preferred: true, supply_kind: 'own_use' });
  ok("the supplier's own fields are all named", named(sup, 'nickname,category,notes,preferred,supply_kind'), JSON.stringify(sup));

  const supBoth = await patch('/suppliers/' + SUPP, { nickname: 'Corner 2', phone: '9000000005' });
  ok('a supplier own field with a party field: both named', named(supBoth, 'nickname,phone'), JSON.stringify(supBoth));

  srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
