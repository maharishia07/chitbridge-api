/**
 * CRM-43 (gorilla pack 4, Q10): PATCH /api/relationships/customers|suppliers/:id { merged_into } names only a party of THIS shop that is not the party itself,
 * not the shop, and not already merged away; and a party others are merged into cannot itself be merged away (no chains, no loops). A stranger's id answers
 * 404 like an unknown party. No database: a small in-memory pair of lists behind the stubbed db; the route and lib/party-fields are the real ones.
 * Run: node tests/party-merge-target.test.cjs
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'test';
const u = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const SHOP = u(1), PRIYA = u(2), BOB = u(3), CAROL = u(4), DAN = u(5), SUPP = u(6), STRANGER = u(99);
const customers = {
  'CL-1': { customer_list_id: 'CL-1', owner_entity_id: SHOP, customer_identity_id: PRIYA, merged_into: null },
  'CL-2': { customer_list_id: 'CL-2', owner_entity_id: SHOP, customer_identity_id: BOB, merged_into: null },
  'CL-3': { customer_list_id: 'CL-3', owner_entity_id: SHOP, customer_identity_id: CAROL, merged_into: BOB },
  'CL-4': { customer_list_id: 'CL-4', owner_entity_id: SHOP, customer_identity_id: DAN, merged_into: null },
  'CL-5': { customer_list_id: 'CL-5', owner_entity_id: SHOP, customer_identity_id: u(7), merged_into: DAN }
};
const suppliers = { 'SL-1': { supplier_list_id: 'SL-1', owner_entity_id: SHOP, supplier_entity_id: SUPP, merged_into: null } };
const tx = {
  query: async (sql, args) => {
    const s = String(sql);
    if (/SELECT \* FROM customer_list WHERE customer_list_id/.test(s)) return { rows: customers[args[0]] && args[1] === SHOP ? [Object.assign({}, customers[args[0]])] : [] };
    if (/SELECT \* FROM supplier_list WHERE supplier_list_id/.test(s)) return { rows: suppliers[args[0]] && args[1] === SHOP ? [Object.assign({}, suppliers[args[0]])] : [] };
    let m = /FROM (customer_list|supplier_list) l WHERE l\.(\w+) = \$1 AND l\.owner_entity_id = \$2/.exec(s);
    if (m) return { rows: Object.values(m[1] === 'customer_list' ? customers : suppliers).filter((r) => r[m[2]] === args[0] && r.owner_entity_id === args[1]).map((r) => ({ merged_into: r.merged_into })) };
    m = /FROM (customer_list|supplier_list) l WHERE to_jsonb\(l\)->>'merged_into' = \$1/.exec(s);
    if (m) return { rows: Object.values(m[1] === 'customer_list' ? customers : suppliers).filter((r) => r.merged_into === args[0] && r.owner_entity_id === args[1]).map(() => ({ '?column?': 1 })) };
    m = /UPDATE customer_list SET merged_into = \$3 WHERE customer_list_id = \$1/.exec(s);
    if (m) customers[args[0]].merged_into = args[2];
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
  const J = (x) => JSON.stringify(x);

  const stranger = await patch('/customers/CL-1', { merged_into: STRANGER });
  ok('a party not on this shop list: 404, nothing written', stranger.status === 404 && customers['CL-1'].merged_into === null, J(stranger));
  ok('the 404 does not echo or confirm the id', !J(stranger.body).includes(STRANGER), J(stranger));
  const shop = await patch('/customers/CL-1', { merged_into: SHOP });
  ok("the shop's OWN entity: 400, nothing written", shop.status === 400 && customers['CL-1'].merged_into === null, J(shop));
  const self = await patch('/customers/CL-1', { merged_into: PRIYA });
  ok('the party itself: 400', self.status === 400 && customers['CL-1'].merged_into === null, J(self));
  const chain = await patch('/customers/CL-1', { merged_into: CAROL });
  ok('a party already merged into another: 409, no chain', chain.status === 409 && customers['CL-1'].merged_into === null, J(chain));
  const loop = await patch('/customers/CL-2', { merged_into: CAROL });
  ok('merging the survivor into its own folded party: 409, no loop', loop.status === 409 && customers['CL-2'].merged_into === null, J(loop));
  const parent = await patch('/customers/CL-4', { merged_into: BOB });
  ok('a party others are merged into cannot be merged away: 409', parent.status === 409 && customers['CL-4'].merged_into === null, J(parent));
  const good = await patch('/customers/CL-1', { merged_into: BOB });
  ok('a real party of this shop: 200 and written', good.status === 200 && customers['CL-1'].merged_into === BOB, J(good));
  const supp = await patch('/suppliers/SL-1', { merged_into: BOB });
  ok('a supplier may merge into a party on the shop list: 200', supp.status === 200, J(supp));
  const clear = await patch('/customers/CL-1', { merged_into: null });
  ok('null un-merges (no target to check)', clear.status === 200 && customers['CL-1'].merged_into === null, J(clear));

  srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
