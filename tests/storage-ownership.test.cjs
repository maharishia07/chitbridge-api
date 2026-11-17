#!/usr/bin/env node
// @type: unit
/**
 * tests/storage-ownership.test.cjs — A STORED FILE BELONGS TO ONE ENTITY, AND NOTHING CROSSES (lib/storage.js + lib/storage-object.js).
 * UNIT      27 DATA LIFECYCLE / Object storage (media, attachments) (test = 0.5: the cited `storage-s3-live` needs a live bucket)
 * OWNS      the ownership rules of the attachment store that need no bucket: an object key is <entity>/<yyyy>/<mm>/<id> in UTC · get and delete REFUSE a key not under the
 *           caller's own prefix (NOT_OWNER, 404) and never reach the store · an empty owner is refused · "owner" matching is by whole prefix (e1 cannot read e10/…) ·
 *           an upload is REPLICATED, one row per participant, each inserted as that participant (never shared), the uploader's own row id returned · a participant listed
 *           twice is stored once · a half-set object-store config falls back to the database rather than failing the upload · the same CTP event applied twice stores once.
 * CALLED BY scripts/guards.cjs · CI. No database, no bucket: db/index.js and lib/schema.js are stubs; no S3_* variable is set.
 * FLOW      objectKey / assertOwned (pure) → get/del on the db-mode store (stub) → storage.putForParticipants over a stub cb_attachment → rows and who they were written as
 * CARD      27-data-lifecycle-retention-storage-archive/object-storage
 */
'use strict';
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');
for (const k of Object.keys(process.env)) if (/^S3_/.test(k)) delete process.env[k];
delete process.env.STORAGE_ADAPTER;

const E1 = '11111111-1111-4111-8111-111111111111';
const E2 = '22222222-2222-4222-8222-222222222222';
const E3 = '33333333-3333-4333-8333-333333333333';

/* ── the stub database: cb_attachment rows, media_blobs rows, and who each INSERT ran as ── */
const ATT = [];
const BLOBS = new Map();
const ranAs = [];
const sent = [];
let seq = 0;
function run(sql, params) {
  const s = String(sql).replace(/\s+/g, ' ');
  sent.push({ sql: s, params });
  if (/to_regclass\('public\.cb_attachment'\)/.test(s)) return { rows: [{ t: 'cb_attachment' }], rowCount: 1 };
  if (/information_schema\.columns/.test(s)) return { rows: [], rowCount: 0 };
  if (/^INSERT INTO cb_attachment/.test(s)) {
    const fixed = /\(id, entity_id/.test(s);
    const id = fixed ? params[9] : 'att-' + ++seq;
    if (fixed && ATT.some((r) => r.id === id)) return { rows: [], rowCount: 0 }; /* ON CONFLICT (id) DO NOTHING */
    const off = 0;
    ATT.push({ id, entity_id: params[off], name: params[4], size: params[6], data: params[7] });
    return { rows: [{ id }], rowCount: 1 };
  }
  if (/FROM media_blobs/.test(s) && /^SELECT bytes/.test(s)) return { rows: BLOBS.has(params[0]) ? [{ bytes: BLOBS.get(params[0]) }] : [], rowCount: BLOBS.has(params[0]) ? 1 : 0 };
  if (/^DELETE FROM media_blobs/.test(s)) { BLOBS.delete(params[0]); return { rows: [], rowCount: 1 }; }
  if (/^INSERT INTO media_blobs/.test(s)) { BLOBS.set(params[0], params[4]); return { rows: [], rowCount: 1 }; }
  if (/^SELECT name, mime, size, data/.test(s)) {
    const r = ATT.find((x) => x.id === params[0] && x.entity_id === params[1]);
    return { rows: r ? [r] : [], rowCount: r ? 1 : 0 };
  }
  return { rows: [], rowCount: 0 };
}
const dbPath = path.join(ROOT, 'db', 'index.js');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async (sql, params) => run(sql, params),
  withEntity: async (entity, fn) => { ranAs.push(entity); return fn({ query: async (sql, params) => run(sql, params) }); }
} };
let mediaTable = false;
const schemaPath = path.join(ROOT, 'lib', 'schema.js');
require.cache[schemaPath] = { id: schemaPath, filename: schemaPath, loaded: true, exports: { hasTable: async () => mediaTable } };

const objectStore = require(path.join(ROOT, 'lib', 'storage-object.js'));
const storage = require(path.join(ROOT, 'lib', 'storage.js'));

let checks = 0;
async function it(what, fn) { ATT.length = 0; ranAs.length = 0; sent.length = 0; await fn(); checks++; console.log('  ok  ' + what); }
const refuses = async (fn, code) => {
  try { await fn(); } catch (e) { assert.strictEqual(e.code, code, e.message); assert.strictEqual(e.status, 404); return e; }
  assert.fail('was not refused');
};

(async () => {
  await it('objectKey is <entity>/<yyyy>/<mm>/<id> in UTC — 31 Dec 23:30 UTC is still December, 1 Jan 00:10 UTC is January', async () => {
    assert.strictEqual(objectStore.objectKey(E1, 'abc', new Date('2026-12-31T23:30:00Z')), E1 + '/2026/12/abc');
    assert.strictEqual(objectStore.objectKey(E1, 'abc', new Date('2027-01-01T00:10:00Z')), E1 + '/2027/01/abc');
    assert.ok(objectStore.objectKey(E1, 'x').startsWith(E1 + '/'), 'the key must start with its owner');
  });

  await it('assertOwned lets the owner through and refuses every other prefix as NOT_OWNER / 404 (a wrong owner looks like "not found")', async () => {
    assert.strictEqual(objectStore.assertOwned(E1 + '/2026/11/a', E1), E1 + '/2026/11/a');
    await refuses(() => objectStore.assertOwned(E2 + '/2026/11/a', E1), 'NOT_OWNER');
    await refuses(() => objectStore.assertOwned('../' + E1 + '/a', E1), 'NOT_OWNER');
    await refuses(() => objectStore.assertOwned('', E1), 'NOT_OWNER');
    await refuses(() => objectStore.assertOwned(null, E1), 'NOT_OWNER');
  });

  await it('refusal: an empty owner is refused — no owner means no read and no delete, not "everything"', async () => {
    for (const owner of ['', null, undefined]) await refuses(() => objectStore.assertOwned(E1 + '/a', owner), 'NOT_OWNER');
  });

  await it('ownership is by WHOLE prefix: owner "e1" cannot touch "e10/…" and a key equal to the owner alone is not under it', async () => {
    await refuses(() => objectStore.assertOwned('abc10/2026/11/a', 'abc1'), 'NOT_OWNER');
    await refuses(() => objectStore.assertOwned(E1, E1), 'NOT_OWNER');
  });

  await it('get and del with a foreign key are refused BEFORE any statement is sent (nothing is read, nothing is deleted)', async () => {
    BLOBS.set(E2 + '/2026/11/b', Buffer.from('theirs'));
    await refuses(() => objectStore.get(E2 + '/2026/11/b', E1), 'NOT_OWNER');
    await refuses(() => objectStore.del(E2 + '/2026/11/b', E1), 'NOT_OWNER');
    assert.strictEqual(sent.length, 0, 'the store was reached: ' + JSON.stringify(sent));
    assert.ok(BLOBS.has(E2 + '/2026/11/b'), 'another entity\'s object was deleted');
  });

  await it('in db mode an owner round-trips its own bytes, and a missing object is an error, not an empty file', async () => {
    mediaTable = true;
    const key = objectStore.objectKey(E1, 'doc-1');
    await objectStore.put(key, Buffer.from('evidence'), 'text/plain');
    assert.strictEqual((await objectStore.get(key, E1)).toString(), 'evidence');
    await assert.rejects(() => objectStore.get(objectStore.objectKey(E1, 'ghost'), E1), /get 404/);
    assert.strictEqual(await objectStore.del(key, E1), true);
    await assert.rejects(() => objectStore.get(key, E1), /get 404/);
    mediaTable = false;
  });

  await it('an upload is REPLICATED: one row per participant, each written as that participant, the uploader\'s row id returned', async () => {
    const id = await storage.putForParticipants({ chit_id: 'c1', name: 'po.pdf', mime: 'application/pdf', size: 3, buffer: Buffer.from('abc'), participants: [E1, E2, E3], forEntity: E2 });
    assert.strictEqual(ATT.length, 3, 'rows: ' + ATT.length);
    assert.deepStrictEqual(ATT.map((r) => r.entity_id).sort(), [E1, E2, E3].sort());
    assert.deepStrictEqual(ranAs.filter((x, i, a) => a.indexOf(x) === i).sort(), [E1, E2, E3].sort(), 'an insert ran as someone other than its owner');
    assert.strictEqual(ATT.find((r) => r.id === id).entity_id, E2, 'the returned id is not the uploader\'s own copy');
    assert.ok(ATT.every((r) => r.data && r.data.toString() === 'abc'), 'a copy did not get its own bytes');
  });

  await it('a participant listed twice, or empty, is stored once / skipped; an uploader not among the participants gets null', async () => {
    const id = await storage.putForParticipants({ chit_id: 'c1', name: 'a.txt', mime: 'text/plain', size: 1, buffer: Buffer.from('a'), participants: [E1, E1, null, undefined, E2], forEntity: E1 });
    assert.strictEqual(ATT.length, 2);
    assert.ok(id);
    ATT.length = 0;
    const none = await storage.putForParticipants({ chit_id: 'c1', name: 'a.txt', mime: 'text/plain', size: 1, buffer: Buffer.from('a'), participants: [E2], forEntity: E1 });
    assert.strictEqual(none, null);
  });

  await it('the same CTP event applied twice stores ONCE (a fixed id per participant meets ON CONFLICT DO NOTHING)', async () => {
    const args = { chit_id: 'c1', name: 'r.pdf', mime: 'application/pdf', size: 1, buffer: Buffer.from('r'), participants: [E1, E2], forEntity: E1, idFor: (e) => 'ctp-' + e.slice(0, 4) };
    const first = await storage.putForParticipants(args);
    const second = await storage.putForParticipants(args);
    assert.strictEqual(ATT.length, 2, 'a replay stored the file again');
    assert.ok(first);
    assert.strictEqual(second, null, 'a replay claimed a new row');
  });

  await it('STORAGE_ADAPTER=object with no credentials falls back to the database: the upload succeeds with bytes in the row, not a lost document', async () => {
    process.env.STORAGE_ADAPTER = 'object';
    try {
      const id = await storage.putForParticipants({ chit_id: 'c1', name: 'k.pdf', mime: 'application/pdf', size: 2, buffer: Buffer.from('kk'), participants: [E1], forEntity: E1 });
      assert.ok(id);
      assert.strictEqual(ATT[0].data.toString(), 'kk');
    } finally { delete process.env.STORAGE_ADAPTER; }
  });

  await it('a read is scoped to the caller\'s entity: another entity asking for my attachment id gets nothing', async () => {
    const id = await storage.putForParticipants({ chit_id: 'c1', name: 's.pdf', mime: 'application/pdf', size: 1, buffer: Buffer.from('s'), participants: [E1], forEntity: E1 });
    assert.ok(await storage.getBlob(id, E1));
    assert.strictEqual(await storage.getBlob(id, E2), null);
    const q = sent.filter((s) => /^SELECT name, mime, size, data/.test(s.sql)).pop();
    assert.ok(/entity_id = \$2/.test(q.sql), 'the read does not name the entity');
  });

  await it('the attachment ceiling is 6 MB and is exported for the upload and for a CTP arrival to share', async () => {
    assert.strictEqual(storage.MAX_ATTACHMENT_BYTES, 6 * 1024 * 1024);
  });

  console.log('\n  ' + checks + ' checks');
  console.log('  ' + checks + ' passed');
  process.exit(0);
})().catch((e) => { console.log('  FAIL ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join('\n       ') : e)); process.exit(1); });
