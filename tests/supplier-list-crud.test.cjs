#!/usr/bin/env node
// @type: unit
/**
 * supplier-list-crud.test.cjs — QA no-proof wave 1 (6 Nov 2026): the supplier list's edit and remove, PATCH and DELETE /api/relationships/suppliers/:id.
 *
 * OWNS      the proof that (a) a PATCH writes only the owner-side fields to the caller's OWN list row (owner_entity_id in the WHERE), says 404 when that row is not theirs,
 *           refuses a key it does not know (UNKNOWN_FIELD) and an empty body in words, (b) a rename of a REAL (registered) business is refused 403 - its name is theirs,
 *           (c) a DELETE is the owner's alone (a co-assist is 403), 404 for a row not on the list, and for the owner calls the CRM's one remove (hide, never delete) on the supplier's id.
 *           supplier-list-scope.test.cjs already proves every statement runs inside withEntity; local-supplier.test.js the add.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/relationships.js over a stand-in sign-in and a recording db.
 * FLOW      recording db + switchable caller (owner or co-assist) → real router on an express app → request over http → status · code · the UPDATE asked · the remove called
 * CARD      12-suppliers-and-procurement/supplier-list
 * UNIT      12/Supplier list (add, edit, remove)
 * MUTATION  checked once: in routes/relationships.js delete `AND owner_entity_id = $${index}` from the PATCH's UPDATE (or the isOwner gate of DELETE) → "writes only the caller's own row" / "co-assist is 403" go red.
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const say = console.log.bind(console);
['log', 'warn', 'info', 'error'].forEach((k) => { console[k] = () => {}; });

const ROOT = path.join(__dirname, '..');
const SHOP = '11111111-1111-4111-8111-111111111111';
const ROW = '22222222-2222-4222-8222-222222222222';
const OTHER_ROW = '99999999-9999-4999-8999-999999999999';
const SUPPLIER = '33333333-3333-4333-8333-333333333333';
const world = { caller: { identity_id: SHOP, identity_type: 'entity' }, userId: 'bharatstores' };
const queries = [];
const params = [];

const stubDb = async (sql, args) => {
  const s = String(sql).replace(/\s+/g, ' ');
  queries.push(s);
  params.push(args || []);
  if (/UPDATE supplier_list SET/.test(s)) return { rows: args[args.length - 2] === ROW ? [{ supplier_list_id: ROW }] : [], rowCount: 1 };
  if (/FROM supplier_list sl JOIN identities i/.test(s)) return { rows: args[0] === ROW ? [{ identity_id: SUPPLIER, user_id: world.userId }] : [] };
  if (/SELECT supplier_entity_id FROM supplier_list WHERE supplier_list_id/.test(s)) return { rows: args[0] === ROW ? [{ supplier_entity_id: SUPPLIER }] : [] };
  return { rows: [], rowCount: 0 };
};
const dbPath = require.resolve(path.join(ROOT, 'db'));
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: { query: stubDb, withEntity: async (id, fn) => fn({ query: stubDb }), onEntity: async (id, db, fn) => (typeof db === 'function' ? db({ query: stubDb }) : fn({ query: stubDb })), withTransaction: async (fn) => fn({ query: stubDb }), pool: {} }
};
const authPath = require.resolve(path.join(ROOT, 'middleware', 'auth'));
const stubAuth = (req, res, next) => { req.identity = world.caller; next(); };
stubAuth.entityOf = (req) => (req.identity.parent_entity_id || req.identity.identity_id);
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: stubAuth };
const removed = [];
require('../lib/crm').removeParty = async (owner, id) => { removed.push([owner, id]); };

const app = express();
app.use(express.json());
app.use((req, res, next) => { req.id = 'req-test'; next(); });
app.use('/api/relationships', require(path.join(ROOT, 'routes', 'relationships.js')));

let failed = 0, checks = 0;
const check = (ok, label, why) => { checks++; if (!ok) failed++; say((ok ? 'ok   ' : 'FAIL ') + label + (ok ? '' : ' · ' + JSON.stringify(why).slice(0, 300))); };
const ask = (server, method, id, body) => new Promise((resolve) => {
  const data = JSON.stringify(body || {});
  const req = http.request({ port: server.address().port, method, path: '/api/relationships/suppliers/' + id, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
    let text = '';
    res.on('data', (c) => (text += c));
    res.on('end', () => resolve({ status: res.statusCode, text, body: (() => { try { return JSON.parse(text); } catch (e) { return {}; } })() }));
  });
  req.end(data);
});
const updates = () => queries.filter((q) => /UPDATE supplier_list SET/.test(q));

(async () => {
  const server = app.listen(0);

  let a = await ask(server, 'PATCH', ROW, { nickname: 'Raj', category: 'Dairy', notes: 'cold chain', preferred: true, supply_kind: 'own_use' });
  check(a.status === 200 && a.body.message === 'Supplier updated', 'PATCH the owner-side fields → 200 "Supplier updated" (got ' + a.status + ')', a.text);
  const u = updates()[0] || '';
  check(/nickname = \$1/.test(u) && /category = \$2/.test(u) && /notes = \$3/.test(u) && /preferred = \$4/.test(u) && /supply_kind = \$5/.test(u), 'PATCH sets exactly nickname, category, notes, preferred, supply_kind', u);
  check(/WHERE supplier_list_id = \$6 AND owner_entity_id = \$7/.test(u) && params[queries.indexOf(u)].slice(-2).join() === [ROW, SHOP].join(), 'PATCH writes only the caller\'s own row (list id and owner in the WHERE)', u);
  check(params[queries.indexOf(u)][4] === 'own_use' && params[queries.indexOf(u)][3] === true, 'PATCH keeps the flag and the kind as sent', params[queries.indexOf(u)]);

  queries.length = 0;
  a = await ask(server, 'PATCH', OTHER_ROW, { nickname: 'Raj' });
  check(a.status === 404, 'PATCH a row that is not on this shop\'s list → 404 (got ' + a.status + ')', a.text);

  queries.length = 0;
  a = await ask(server, 'PATCH', ROW, { turnover: 5 });
  check(a.status === 400 && a.body.code === 'UNKNOWN_FIELD' && !updates().length, 'PATCH a key it does not know → 400 UNKNOWN_FIELD, nothing written', a.text);

  a = await ask(server, 'PATCH', ROW, { supply_kind: 'gift' });
  check(a.status === 400 && !updates().length, 'PATCH supply_kind outside resale / own_use → 400, nothing written', a.text);

  a = await ask(server, 'PATCH', ROW, {});
  check(a.status === 400 && !updates().length, 'PATCH with nothing to change → 400 in words, nothing written', a.text);

  queries.length = 0;
  a = await ask(server, 'PATCH', ROW, { display_name: 'Corner Hardware & Sons' });
  check(a.status === 403 && !queries.some((q) => /UPDATE identities SET display_name/.test(q)), 'rename of a REAL registered business → 403 and the identity untouched (its name is theirs)', a.text);
  world.userId = '~acmetraders.sup-0001';
  queries.length = 0;
  a = await ask(server, 'PATCH', ROW, { display_name: 'Corner Hardware & Sons' });
  check(a.status === 200 && a.body.display_name === 'Corner Hardware & Sons' && queries.some((q) => /UPDATE identities SET display_name/.test(q)), 'rename of a supplier THIS shop minted → 200, the name changes', a.text);

  world.caller = { identity_id: '44444444-4444-4444-8444-444444444444', identity_type: 'actor', parent_entity_id: SHOP };
  removed.length = 0;
  a = await ask(server, 'DELETE', ROW);
  check(a.status === 403 && removed.length === 0, 'DELETE by a co-assist → 403 and nothing removed', a.text);
  world.caller = { identity_id: SHOP, identity_type: 'entity' };
  a = await ask(server, 'DELETE', OTHER_ROW);
  check(a.status === 404 && removed.length === 0, 'DELETE a row that is not on the list → 404 and nothing removed (got ' + a.status + ')', a.text);
  a = await ask(server, 'DELETE', ROW);
  check(a.status === 200 && a.body.message === 'Supplier removed', 'DELETE by the owner → 200 "Supplier removed" (got ' + a.status + ')', a.text);
  check(removed.length === 1 && removed[0][0] === SHOP && removed[0][1] === SUPPLIER, 'DELETE calls the CRM\'s one remove on the supplier\'s id, for this shop', removed);

  server.close();
  say(checks + ' checks, ' + (failed ? failed + ' FAILED' : 'all passed'));
  process.exit(failed ? 1 : 0);
})();
