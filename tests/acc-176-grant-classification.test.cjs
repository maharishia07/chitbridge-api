#!/usr/bin/env node
// @type: unit
/**
 * tests/acc-176-grant-classification.test.cjs — ACC-176 (the auditor over a network): the guard half that needs no database.
 *
 * Critic cases 6 and 7, and the middleware's own rules, with the grant store stubbed:
 *   6  every GET of routes/books.js is classified (open to an auditor or held back with a reason); a planted GET fails the guard, so a new GET is born refused
 *   7  the owner-only reads (packs, assets, recurring, move-in imports) are NOT on the allow-list, and no route that carries party contact data or bank details is
 *      synthetic identity: not an owner, a commenter, may not write, sees the whole entity, sees costs only as the grant says (the may flags read from the synthetic identity)
 *   no header: nothing changes · a person without the auditor role is refused · the look failing answers 503 and runs nothing · the request after a grant runs BEGIN READ ONLY
 *   the member's id comes from the grant row, never from the header
 * The database half (RLS, revoke, edge, the log, READ ONLY in Postgres) is tests/acc-176-books-grant.realstack.cjs, run by the CI integration job.
 * OWNS      the offline checks of middleware/books-grant.js.   CALLED BY scripts/guards.cjs (CI guards job).   CARD  04-network/ACC-176-AUDITOR-GRANT
 */
'use strict';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'acc176_test_secret_at_least_32_chars_padding';
const path = require('path');
const assert = require('assert');
const API = path.join(__dirname, '..');
let pass = 0;
let fail = 0;
const t = async (name, fn) => {
  try {
    await fn();
    pass++;
    console.log('  ok   ' + name);
  } catch (e) {
    fail++;
    console.log('  FAIL ' + name + '\n         ' + String((e && e.message) || e).slice(0, 300));
  }
};

/* the grant store, stubbed: what the middleware does with its answer is what is tested here */
const storePath = require.resolve(path.join(API, 'lib', 'books-grant.js'));
const real = require(storePath);
let nextLook = null;
let otherLive = false;
const stub = Object.assign({}, real, { liveRoleOf: async () => undefined, liveInOtherRole: async () => otherLive, look: async (...args) => (typeof nextLook === 'function' ? nextLook(...args) : nextLook) });
require.cache[storePath].exports = stub;
const A = require(path.join(API, 'middleware', 'books-grant.js'));
const books = require(path.join(API, 'routes', 'books.js'));
const booksOpening = require(path.join(API, 'routes', 'books-opening.js'));
const { isOwner } = require(path.join(API, 'lib', 'owner.js'));
const access = require(path.join(API, 'lib', 'access.js'));
const cost = require(path.join(API, 'lib', 'cost.js'));
const reqctx = require(path.join(API, 'lib', 'reqctx.js'));

const owner = { identity_id: '11111111-1111-4111-8111-111111111111', bridge_id: 'CBP', identity_type: 'entity', parent_entity_id: null };
const auditorActor = { identity_id: '22222222-2222-4222-8222-222222222222', identity_type: 'actor', parent_entity_id: owner.identity_id, access_level: 'commenter', whole_entity: true, can_see_costs: true };
const MEMBER = '33333333-3333-4333-8333-333333333333';
const granted = (costs) => ({ allowed: true, grant: { grant_id: '44444444-4444-4444-8444-444444444444', grantor_entity: MEMBER, can_see_costs: costs }, outcome: 'allowed', status: 200 });
const refused = { allowed: false, grant: null, outcome: 'no_grant', status: 403, code: 'BOOKS_GRANT_NONE', words: 'No access has been given for these books.' };

/** run the books router's `auth` over a fake request through a fake base auth; resolves { nexted, req, status, body } */
function drive(identity, headers, method, routePath) {
  const base = Object.assign((req, res, next) => { req.identity = Object.assign({}, identity); next(); }, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id });
  const gate = A.frontOf(base);
  const req = { headers: headers || {}, method: method || 'GET', path: routePath || '/daybook', query: {}, id: 'r1' };
  const out = { nexted: false, readOnlyInside: null };
  const res = {
    headers: {}, status(code) { out.status = code; return this; }, set() { return this; }, setHeader() {}, type() { return this; },
    json(body) { out.body = body; return this; }, send(body) { out.body = body; return this; }, end() { return this; }, req, locals: {}
  };
  res.req = req;
  return new Promise((resolve) => {
    gate(req, res, () => { out.nexted = true; out.readOnlyInside = reqctx.isReadOnly(); out.req = req; resolve(out); });
    setTimeout(() => { out.req = req; resolve(out); }, 150);
  });
}

(async () => {
  console.log('\nACC-176 · the grant guard (offline)');

  await t('6 every GET of routes/books.js is classified: open to an auditor or held back with a reason', () => {
    assert.deepStrictEqual(A.unclassifiedGets(books), []);
  });
  await t('6 a planted GET is caught: the guard is red on an unclassified route', () => {
    const planted = { stack: books.stack.concat([{ route: { path: '/planted-export', methods: { get: true } } }]) };
    assert.deepStrictEqual(A.unclassifiedGets(planted), ['/planted-export']);
  });
  await t('6 nothing on the allow-list is absent from the router, and nothing is in both lists', () => {
    const gets = books.stack.concat(booksOpening.stack).filter((l) => l.route && l.route.methods.get).map((l) => l.route.path); /* the opening balances page is its own router on the same mount */
    assert.deepStrictEqual([...A.GRANT_READS].filter((p) => !gets.includes(p)), []);
    assert.deepStrictEqual([...A.GRANT_READS].filter((p) => p in A.GRANT_HELD_BACK), []);
  });
  await t('(g, 18 Nov) the opening balances page: both GETs of routes/books-opening.js are classified, and open to an auditor', () => {
    assert.deepStrictEqual(A.unclassifiedGets(booksOpening), []);
    for (const open of ['/opening', '/opening/years']) assert.ok(A.GRANT_READS.has(open), open + ' is an auditor read (ASA 510: opening balances evidence on an initial engagement)');
  });
  await t('(g) the auditor reads the opening page: GET /opening and /opening/years pass the guard; the two owner POSTs (/opening/preview, /opening/replace) are not listed, and every non-GET is refused by the look (read_only)', async () => {
    nextLook = granted(true);
    const hdr = { 'x-books-for': MEMBER };
    for (const route of ['/opening', '/opening/years']) assert.strictEqual((await drive(auditorActor, hdr, 'GET', route)).nexted, true, 'GET ' + route + ' must reach the route');
    for (const route of ['/opening/preview', '/opening/replace']) assert.strictEqual(A.listedFor(undefined, { method: 'POST', path: route, headers: {} }), false, 'POST ' + route + ' must stay unlisted');
    const lookSrc = require('fs').readFileSync(path.join(API, 'lib', 'books-grant.js'), 'utf8');
    assert.ok(lookSrc.includes("request.method !== 'GET') return 'read_only'"), 'the look refuses any non-GET for an auditor');
  });
  await t('(g) the consent screen says it: the two opening reads are in the plain words', () => {
    const contract = require(path.join(API, 'lib', 'books-grants-contract.js'));
    const said = contract.consentWords(true, 'auditor').can_read.join(' | ');
    assert.ok(/opening balances/.test(said), said);
    assert.ok(/each year/.test(said), said);
  });
  await t('7 owner-only reads and every route with party contact or bank details are held back', () => {
    for (const held of ['/packs', '/packs/:id', '/packs/:id/file', '/assets', '/depreciation/schedule', '/recurring', '/move-in/imports', '/party/:id/bills', '/payments/:id/advice', '/compare', '/compare/:id/csv', '/todo', '/events']) {
      assert.ok(!A.GRANT_READS.has(held), held + ' must not be open to an auditor');
      assert.ok(held in A.GRANT_HELD_BACK, held + ' must carry a reason');
    }
  });
  await t('the books router carries the grant as ONE router-level layer (no route gate list is touched)', () => {
    assert.ok(books.stack.some((layer) => !layer.route && layer.handle === A));
    const daybook = books.stack.find((layer) => layer.route && layer.route.path === '/daybook').route.stack[0].handle;
    assert.strictEqual(daybook, require(path.join(API, 'middleware', 'auth.js')), 'the route keeps middleware/auth as its sign-in');
  });
  await t('the log names the route by its listed pattern or with ids made :id, never a value', () => {
    assert.strictEqual(A.routeForLog('GET', '/ledger/cash-in-hand'), 'GET /ledger/:account');
    assert.strictEqual(A.routeForLog('GET', '/packs/3f2c9e1a-1111-4222-8333-444455556666/file'), 'GET /packs/:id/file');
    assert.strictEqual(A.listedPattern('/year/2026-27/status'), '/year/:fy/status');
    assert.strictEqual(A.listedPattern('/packs'), null);
    assert.strictEqual(A.listedPattern('/daybook/extra'), null);
  });

  await t('no X-Books-For header: the front does nothing (not even a sign-in), the request is not read-only', async () => {
    nextLook = () => { throw new Error('the look must not run'); };
    const out = await drive(owner, {});
    assert.ok(out.nexted && !out.req.identity && !out.req.acting_for_grant && out.readOnlyInside === false);
  });
  await t('a person without the auditor role is refused (403 BOOKS_GRANT_NOT_FOR_YOU) and no look is made', async () => {
    nextLook = () => { throw new Error('the look must not run'); };
    for (const who of [{ ...auditorActor, access_level: 'editor', whole_entity: false } /* W12: an editor of the WHOLE entity (the accountant seat) now opens an auditor-role grant, read only; a counter-level editor still does not */, { ...auditorActor, whole_entity: false }, { ...auditorActor, can_see_costs: false }, { ...owner, parent_entity_id: MEMBER }]) {
      const out = await drive(who, { 'x-books-for': MEMBER });
      assert.ok(!out.nexted && out.status === 403 && out.body.code === 'BOOKS_GRANT_NOT_FOR_YOU', JSON.stringify(out.body));
    }
  });
  await t('a refused look answers its code and its words, and runs nothing', async () => {
    nextLook = refused;
    const out = await drive(owner, { 'x-books-for': MEMBER, 'x-books-role': 'auditor' });
    assert.ok(!out.nexted && out.status === 403 && out.body.code === 'BOOKS_GRANT_NONE' && /No access/.test(out.body.detail || out.body.message));
    /* S2-F-09: no role named at all is not "no access": the other view may hold it, so the same code says what to do */
    const unnamed = await drive(owner, { 'x-books-for': MEMBER });
    assert.ok(!unnamed.nexted && unnamed.status === 403 && unnamed.body.code === 'BOOKS_GRANT_NONE' && /Choose the adviser or auditor view/.test(unnamed.body.detail || unnamed.body.message));
  });
  await t('AT-F-05: an ended auditor look beside a LIVE adviser grant, no role named: "choose a view", never "ended"; with no live grant in the other role it still says ended', async () => {
    const ended = { allowed: false, grant: null, outcome: 'revoked', status: 403, code: 'BOOKS_GRANT_ENDED', words: 'This access was ended by the owner of the books.' };
    nextLook = ended;
    otherLive = true;
    const choose = await drive(owner, { 'x-books-for': MEMBER });
    assert.ok(!choose.nexted && choose.status === 403 && choose.body.code === 'BOOKS_GRANT_NONE' && /Choose the adviser or auditor view/.test(choose.body.detail || choose.body.message), JSON.stringify(choose.body));
    otherLive = false;
    const stays = await drive(owner, { 'x-books-for': MEMBER });
    assert.ok(stays.status === 403 && stays.body.code === 'BOOKS_GRANT_ENDED', JSON.stringify(stays.body));
    const named = await drive(owner, { 'x-books-for': MEMBER, 'x-books-role': 'auditor' });
    assert.ok(named.body.code === 'BOOKS_GRANT_ENDED', 'a NAMED role keeps its own ended words');
  });
  await t('a header that is no id names no member: refused, no look', async () => {
    nextLook = () => { throw new Error('the look must not run'); };
    const out = await drive(owner, { 'x-books-for': "' OR 1=1 --" });
    assert.ok(!out.nexted && out.status === 403);
  });
  await t('fail-closed: the look failing (the log row not written) answers 503 and runs nothing', async () => {
    nextLook = () => { throw Object.assign(new Error('insert failed'), { code: '22P02' }); };
    const out = await drive(owner, { 'x-books-for': MEMBER });
    assert.ok(!out.nexted && out.status === 503 && out.body.code === 'BOOKS_GRANT_LOG_UNAVAILABLE');
  });
  await t('a granted request: the member comes from the GRANT ROW, the identity is the auditor preset of the member, and the rest runs READ ONLY', async () => {
    nextLook = granted(true);
    const out = await drive(owner, { 'x-books-for': 'ffffffff-ffff-4fff-8fff-ffffffffffff' }); /* the header names another id: the row's grantor is used */
    assert.ok(out.nexted && out.readOnlyInside === true);
    const who = out.req.identity;
    assert.strictEqual(require(path.join(API, 'middleware', 'auth.js')).entityOf(out.req), MEMBER);
    assert.strictEqual(out.req.realIdentity.identity_id, owner.identity_id);
    assert.strictEqual(who.acting_for_grant, '44444444-4444-4444-8444-444444444444');
    assert.strictEqual(isOwner(out.req), false);
    assert.strictEqual(access.levelOf(who), 'commenter');
    assert.strictEqual(access.mayWrite(out.req).may, false);
    assert.strictEqual(access.seesWholeEntity(who), true);
    assert.strictEqual(await cost.canRead(out.req, MEMBER), true);
  });
  await t('costs are off when the member ticked them off on the grant', async () => {
    nextLook = granted(false);
    const out = await drive(owner, { 'x-books-for': MEMBER });
    assert.strictEqual(await cost.canRead(out.req, MEMBER), false);
  });
  await t('a parent person holding the auditor preset may use the grant; its real identity is kept for the log', async () => {
    nextLook = granted(true);
    const out = await drive(auditorActor, { 'x-books-for': MEMBER });
    assert.ok(out.nexted && out.req.realIdentity.identity_id === auditorActor.identity_id);
  });
  await t('the look is asked as the PARENT business (an owner: itself; a person: the business it acts for) with the route pattern and the query keys only', async () => {
    let seen = null;
    nextLook = (...args) => { seen = args; return granted(true); };
    await drive(auditorActor, { 'x-books-for': MEMBER }, 'GET', '/ledger/cash');
    assert.strictEqual(seen[0], owner.identity_id);
    assert.strictEqual(seen[2].pattern, 'GET /ledger/:account');
    assert.strictEqual(seen[2].listed, true);
    nextLook = (...args) => { seen = args; return refused; };
    await drive(owner, { 'x-books-for': MEMBER }, 'GET', '/packs');
    assert.strictEqual(seen[2].listed, false);
  });

  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
