'use strict';
/**
 * tests/sec-fix3.test.cjs — SEC-FIX3: the review's S1–S11, each as the scenario that was open on main.
 * The SERVER is the gate (entity scope · owner gate · platform root), never the page. Offline: no DB, no network.
 * Run: node tests/sec-fix3.test.cjs
 */
const assert = require('assert'), fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-sec-fix3';
const ROOT = '11111111-1111-4111-8111-111111111111', SHOP_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', SHOP_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BOARD = '22222222-2222-4222-8222-222222222222';
process.env.PLATFORM_ROOT_ENTITY = ROOT; process.env.TEST_BOARD_ENTITY = BOARD;

/* the database, answered by a handler the test sets per scenario; every statement is recorded */
const SEEN = []; let ANSWER = () => [];
const q = async (sql, params) => { SEEN.push({ sql: String(sql), params }); const rows = ANSWER(String(sql), params) || []; return { rows, rowCount: rows.length }; };
const tx = { query: q };
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: q, pool: { query: q }, withEntity: async (id, fn) => fn(tx), withTransaction: async (fn) => fn(tx), onEntity: async (id, db, fn) => fn(tx),
  readBatch: async () => ({}), trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } } } };

let pass = 0;
const it = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n       ' + e.message); process.exitCode = 1; } };
const src = (f) => fs.readFileSync(path.join(API, f), 'utf8');
/** run a route's handlers after `auth` as an express would, with this request; resolves to what the first responder said */
async function call(router, method, route, req) {
  const layer = router.stack.find((l) => l.route && l.route.path === route && l.route.methods[method]);
  assert.ok(layer, method + ' ' + route + ' is gone');
  let out = null;
  const res = { locals: {}, status(c) { this.code = c; return this; }, json(b) { out = { status: this.code || 200, body: b }; return this; }, setHeader() {}, end() { out = out || { status: this.code || 200 }; } };
  const fns = layer.route.stack.map((l) => l.handle).slice(1);   /* [0] is auth */
  for (const fn of fns) { let nexted = false; await fn(req, res, () => { nexted = true; }); if (!nexted) break; }
  return out;
}
const OWNER = { identity: { identity_id: SHOP_A, identity_type: 'entity' }, body: {} };
const STAFF = { identity: { identity_id: 'act-1', identity_type: 'actor', parent_entity_id: SHOP_A }, body: {} };

(async () => {
  console.log('\nS1 · a change cites only the caller\'s own incidents');
  const testing = require('../routes/testing');
  await it('a shop naming another shop\'s entity gets its OWN entity stored', () => assert.strictEqual(testing.citedEntityOf(SHOP_A, { entity_id: SHOP_B }), SHOP_A));
  await it('the platform root may cite another shop\'s incident', () => assert.strictEqual(testing.citedEntityOf(ROOT, { entity_id: SHOP_B }), SHOP_B));
  await it('/releases follows another entity or `origin` only as the root', () => {
    const s = src('routes/testing.js');
    assert.ok(/mayFollow = require\('\.\.\/lib\/platformroot'\)\.isRoot/.test(s) && /if \(mayFollow\) await tellOriginShop/.test(s) && /if \(!mayFollow && String\(c\.entity_id\)/.test(s));
  });

  console.log('\nS2 · adopt writes to the shop\'s own schema only');
  await it('adopt takes the shop\'s default schema, never req.body.schema_id', () => assert.ok(!/req\.body\.schema_id/.test(src('routes/adopt.js'))));
  await it('commitFields inserts only into a schema this entity owns', async () => {
    SEEN.length = 0; ANSWER = (sql) => (/MAX\(display_order\)/.test(sql) ? [{ m: 0 }] : []);
    await require('../lib/catalogue-columns').commitFields({ query: q, schema_id: 'victim-schema', entity_id: SHOP_A, newFields: [{ field_key: 'x', field_name: 'X', field_type: 'text' }] });
    const ins = SEEN.find((c) => /INSERT INTO schema_fields/.test(c.sql));
    assert.ok(ins && /entity_schemas/.test(ins.sql) && ins.params.includes(SHOP_A), 'the INSERT is not scoped to the caller\'s entity');
  });
  await it('readDeclaration reads only the caller\'s schema', async () => {
    SEEN.length = 0; ANSWER = (sql) => (/MAX\(display_order\)/.test(sql) ? [{ m: 0 }] : []);
    await require('../lib/catalogue-columns').ensureDeclaredMany({ query: q, entity_id: SHOP_A, schema_id: 'victim-schema', items: [{ name: 'x' }], validate: null });
    assert.ok(/entity_schemas/.test(SEEN[0].sql));
  });

  console.log('\nS3 · only the owner (or a counter key) overrides a credit limit');
  const F = require('../lib/finance-terms');
  const ov = { by: SHOP_B };
  await it('an editor naming the owner is refused', () => assert.strictEqual(F.overrideBy(Object.assign({ till: { kind: 'person', counter: null } }, STAFF), ov), null));
  await it('the owner\'s own login is allowed, named from the session not the body', () => assert.strictEqual(F.overrideBy(Object.assign({ till: { kind: 'person' } }, OWNER), ov), SHOP_A));
  await it('a counter key is allowed (the till checked the owner\'s PIN)', () => assert.strictEqual(F.overrideBy({ identity: OWNER.identity, api_key: { jti: 'k' }, till: { kind: 'key', counter: 'C1' } }, ov), SHOP_B));
  await it('a key with no counter is refused', () => assert.strictEqual(F.overrideBy({ identity: OWNER.identity, api_key: { jti: 'k' }, till: { kind: 'key', counter: null } }, ov), null));

  console.log('\nS4 · a dispute reaches only businesses that hold the chit');
  const chits = require('../routes/chits');
  await it('a business that does not hold the chit is dropped from the audience', async () => {
    ANSWER = (sql) => (/chit_participants/.test(sql) ? [{ entity_id: SHOP_A }, { entity_id: SHOP_B }] : []);
    assert.deepStrictEqual(await chits.holdersAmong(SHOP_A, 'c1', [SHOP_B, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc']), [SHOP_B]);
  });
  await it('the definer migration checks the audience too', () => assert.ok(/NOT EXISTS \(SELECT 1 FROM chit_status WHERE chit_id = p_chit_id AND entity_id = v_ent\)/.test(src('migrations/archive/b742_dispute_audience_holders.sql'))));

  console.log('\nS5 · a handle lookup finds a business, not a customer or an employee');
  await it('both add-by-handle lookups carry the business filter', () => {
    const s = src('routes/relationships.js');
    assert.ok(/A_BUSINESS = `identity_type = 'entity' AND parent_entity_id IS NULL`/.test(s));
    assert.strictEqual((s.match(/AND \$\{A_BUSINESS\}/g) || []).length, 2);
  });

  console.log('\nS6 · another shop\'s registry values stay with it');
  await it('the readiness passport blanks evidence_ref unless it is the caller\'s own', () => assert.ok(/isOwnRow \? rd : Object\.assign\(\{\}, rd, \{ clearances:[^;]+evidence_ref: null/.test(src('routes/governance.js'))));

  console.log('\nS7 · WhatsApp sends only from a platform-verified line');
  const channels = require('../lib/channels');
  await it('a shop cannot mark a template approved', async () => { await assert.rejects(() => channels.setTemplate(SHOP_A, 'b1', Object.keys(require('../lib/whatsapp-templates').TEMPLATES)[0], 'approved'), (e) => e.status === 403); });
  await it('changing provider_ref withdraws the verification', async () => {
    SEEN.length = 0; ANSWER = () => [{ id: 'b1', address: 'x', provider_ref: 'p2', status: 'declared' }];
    await channels.setProviderRef(SHOP_A, 'b1', 'p2');
    assert.ok(/provider_ref IS DISTINCT FROM \$3 THEN 'declared'/.test(SEEN[0].sql));
  });
  await it('the group send and the status reply pick a VERIFIED line only', () => {
    assert.ok(/channel = 'whatsapp' AND status = 'verified'/.test(src('lib/crm-groups.js')));
    assert.ok(/b\.status = 'verified'/.test(src('lib/whatsapp-out.js')));
  });
  await it('simulate is always the web channel', () => assert.ok(/channel: 'web', sender_ref/.test(src('routes/capture.js'))));

  console.log('\nS8 · a co-assist\'s kit download carries no key');
  await it('the key is minted only for the owner', () => assert.ok(/if \(req\.identity && isOwner\(req\)\) \{/.test(src('routes/integrations.js'))));

  console.log('\nS9 · only the owner makes a counter or a key');
  for (const [file, route] of [['keys', '/'], ['till', '/enrol']]) {
    await it('POST ' + route + ' (' + file + ') refuses a co-assist with the owner sentence', async () => {
      SEEN.length = 0;
      const r = await call(require('../routes/' + file), 'post', route, Object.assign({ body: { name: 'x' } }, { identity: STAFF.identity }));
      assert.ok(r && r.status === 403 && r.body.code === 'OWNER_ONLY', JSON.stringify(r));
      assert.strictEqual(SEEN.length, 0, 'the database was touched before the refusal');
    });
  }

  console.log('\nS10 · a non-writer\'s results stay under their own entity');
  await it('a shop that is not a board writer posts into its own entity', () => assert.strictEqual(testing.resultsEntityOf({ identity: { identity_id: SHOP_A } }), SHOP_A));
  await it('the board\'s own entity posts to the shared board', () => assert.strictEqual(testing.resultsEntityOf({ identity: { identity_id: BOARD } }), BOARD));
  await it('the tester name is the token\'s, not the body\'s', () => assert.ok(/tester_name: who\.name,/.test(src('routes/testing.js'))));

  console.log('\nS11 · an unowned shared source is claimed by the root only');
  const assist = require('../routes/assist');
  const put = (who) => { SEEN.length = 0; ANSWER = (sql) => (/FROM catalogue_source/.test(sql) ? [{ owner_entity_id: null }] : []); return call(assist, 'put', '/catalogue-source', { id: 'r', identity: { identity_id: who }, body: { source_key: 'beta-royale-play@v1', items: [{ name: 'hijack' }] } }); };
  await it('a shop is refused and nothing is written', async () => { const r = await put(SHOP_A); assert.strictEqual(r.status, 403); assert.ok(!SEEN.some((c) => /INSERT INTO catalogue_source/.test(c.sql))); });
  await it('the root may claim it', async () => { const r = await put(ROOT); assert.ok(SEEN.some((c) => /INSERT INTO catalogue_source/.test(c.sql)), JSON.stringify(r)); });

  console.log('\n' + pass + ' passed, ' + (process.exitCode ? 'some' : 0) + ' failed · ' + pass + ' checks'); setTimeout(() => process.exit(process.exitCode || 0), 50);
})();
