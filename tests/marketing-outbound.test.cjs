'use strict';
/**
 * tests/marketing-outbound.test.cjs - OFFERS SENT as receipts (MKT-2 / MKT-17, migration b776), offline over a canned database:
 *  - whatsapp-out writes party, purpose, send_ref and the consent basis ONLY when the b776 columns exist (before it runs the old receipt is written, never a 500);
 *  - logRefused writes a group's refusals in ONE multi-row INSERT per chunk, all sharing the send_ref;
 *  - channels.listOutbound pages (total, page, limit), filters by purpose, and says "arrives after the next update" before b776;
 *  - lib/select takes counterparty_ids + until and uses the SAME counterparty expression as the column it paints.
 * Real-stack proof: tests/marketing-truth.realstack.cjs (MK-08 / MK-10). Run: node tests/marketing-outbound.test.cjs
 * CARD 12-marketing/README
 */
const assert = require('assert'), path = require('path'), fs = require('fs');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test'; delete process.env.WHATSAPP_TOKEN;
const stub = (rel, exports) => { const p = require.resolve(path.join(API, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };

let n = 0, failed = 0;
const t = async (name, fn) => { try { await fn(); n++; console.log('  ok  ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } };

const world = { migrated: true, calls: [], rows: [], total: 0, gate: { may: true, code: 'CONSENT', why: 'They agreed to offers on whatsapp.', pref: { id: 'pf1', at: '2026-10-01T00:00:00Z' } } };
const handle = { query: async (sql, p) => {
  const text = String(sql).replace(/\s+/g, ' ').trim();
  world.calls.push({ sql: text, p });
  if (/^INSERT INTO channel_outbound/.test(text)) return { rows: [{ id: 'ob' + world.calls.length, status: p[6], reason: p[7] }] };
  if (/^SELECT count\(\*\)/.test(text)) return { rows: [{ n: world.total }] };
  return { rows: world.rows };
} };
stub('db', { query: handle.query, withEntity: async (o, fn) => fn(handle), readBatch: async () => [] });
stub('lib/schema', { hasColumn: async () => world.migrated, hasTable: async () => true });
stub('lib/privacy', { gate: async () => world.gate });
const WA = require('../lib/whatsapp-out.js'), CH = require('../lib/channels.js');
const inserts = () => world.calls.filter((c) => /^INSERT INTO channel_outbound/.test(c.sql));

(async () => {
  console.log('\n-- marketing outbound (offline) --');
  await t('b776 run: a refused offer is logged with the person, the purpose, the send and the consent basis (the gate code + the preference row)', async () => {
    world.calls = [];
    const r = await WA.notify('E1', { to_ref: '919840011111', text: 'Diwali offer', party_id: 'P1', purpose: 'marketing', send_ref: 'SEND1' });
    const c = inserts()[0];
    assert.strictEqual(r.status, 'refused'); assert.ok(/WHATSAPP_TOKEN/.test(r.reason), 'no token locally: refused in words');
    assert.ok(/party_id, purpose, send_ref, basis\) VALUES/.test(c.sql) && /::jsonb\)/.test(c.sql), 'the four columns are in the statement');
    assert.deepStrictEqual(c.p.slice(9, 12), ['P1', 'marketing', 'SEND1']);
    assert.deepStrictEqual(JSON.parse(c.p[12]), { code: 'CONSENT', pref_id: 'pf1', at: '2026-10-01T00:00:00Z' });
    assert.strictEqual(c.p[6], 'refused', 'status stays at the position the older tests read');
  });
  await t('a status update (no party, no purpose) is logged as purpose service', async () => {
    world.calls = []; world.gate = { may: true, code: 'LEGITIMATE_USE', why: 'ok' };
    await WA.notify('E1', { to_ref: '919840011111', text: 'Your order is ready' });
    const c = inserts()[0]; assert.strictEqual(c.p[9], null); assert.strictEqual(c.p[10], 'service'); assert.strictEqual(c.p[11], null);
    world.gate = { may: true, code: 'CONSENT', why: 'ok', pref: { id: 'pf1', at: '2026-10-01T00:00:00Z' } };
  });
  await t('before b776: the old nine-column receipt is written - the send is not broken', async () => {
    world.migrated = false; world.calls = [];
    const r = await WA.notify('E1', { to_ref: '919840011111', text: 'Diwali offer', party_id: 'P1', purpose: 'marketing', send_ref: 'SEND1' });
    world.migrated = true;
    const c = inserts()[0]; assert.strictEqual(r.status, 'refused'); assert.ok(!/send_ref/.test(c.sql)); assert.strictEqual(c.p.length, 9);
  });
  await t('logRefused: the refused people of one send are ONE multi-row INSERT sharing the send_ref, each with its reason and basis', async () => {
    world.calls = [];
    const rows = [1, 2, 3].map((i) => ({ party_id: 'P' + i, to_ref: i === 3 ? null : '98765400' + i, reason: 'No consent for offers on whatsapp. Ask them first.', basis: { code: 'NO_CONSENT', pref_id: null, at: null } }));
    const r = await WA.logRefused('E1', 'SEND1', rows);
    assert.strictEqual(r.logged, 3); assert.strictEqual(inserts().length, 1, 'one statement');
    const c = inserts()[0]; assert.strictEqual((c.sql.match(/'whatsapp'/g) || []).length, 3); assert.strictEqual(c.p.length, 39);
    assert.strictEqual(c.p[6], 'refused'); assert.strictEqual(c.p[10], 'marketing'); assert.strictEqual(c.p[11], 'SEND1'); assert.strictEqual(c.p[4], '987654001'); assert.strictEqual(c.p[26 + 4], '', 'no phone: an empty to_ref, the person is named by party_id');
  });
  await t('logRefused: a send to thousands is written in chunks of 500, and an empty list writes nothing', async () => {
    world.calls = [];
    const big = Array.from({ length: 1203 }, (_, i) => ({ party_id: 'P' + i, to_ref: '9' + i, reason: 'r', basis: { code: 'NO_CONSENT' } }));
    const r = await WA.logRefused('E1', 'S', big);
    assert.strictEqual(r.logged, 1203); assert.strictEqual(inserts().length, 3);
    world.calls = []; assert.deepStrictEqual(await WA.logRefused('E1', 'S', []), { logged: 0, migrated: true }); assert.strictEqual(inserts().length, 0);
  });
  await t('logRefused before b776 writes nothing and says so', async () => {
    world.migrated = false; world.calls = [];
    const r = await WA.logRefused('E1', 'S', [{ party_id: 'P1', reason: 'r' }]); world.migrated = true;
    assert.deepStrictEqual(r, { logged: 0, migrated: false }); assert.strictEqual(inserts().length, 0);
  });
  await t('listOutbound: filtered by purpose, paged with total / page / limit, newest first, names the person', async () => {
    world.calls = []; world.rows = [{ id: 'a', party_name: 'Chola', status: 'sent' }, { id: 'b', party_name: 'Ravi', status: 'refused' }]; world.total = 7;
    const r = await CH.listOutbound('E1', { purpose: 'marketing', page: '2', limit: '2' });
    const q = world.calls[0];
    assert.ok(/o\.purpose = \$2/.test(q.sql) && /LEFT JOIN identities i ON i\.identity_id = o\.party_id/.test(q.sql) && /ORDER BY o\.created_at DESC/.test(q.sql) && /LIMIT 2 OFFSET 2/.test(q.sql), q.sql);
    assert.deepStrictEqual(q.p, ['E1', 'marketing']);
    assert.strictEqual(r.total, 7); assert.strictEqual(r.page, 2); assert.strictEqual(r.limit, 2); assert.strictEqual(r.outbound.length, 2); assert.strictEqual(r.migrated, true);
  });
  await t('listOutbound with no query keeps the old behaviour: the first 50, newest first, no purpose filter', async () => {
    world.calls = []; world.rows = []; world.total = 0;
    const r = await CH.listOutbound('E1', undefined);
    assert.ok(/LIMIT 50 OFFSET 0/.test(world.calls[0].sql) && !/o\.purpose = /.test(world.calls[0].sql)); assert.deepStrictEqual(r.outbound, []);
    await CH.listOutbound('E1', '500'); assert.ok(/LIMIT 200 OFFSET 0/.test(world.calls[2].sql), 'the old ?limit= stays held to 200');
  });
  await t('listOutbound before b776: Offers sent says it arrives after the next update (a code), and the plain receipts still list', async () => {
    world.migrated = false; world.calls = [];
    const off = await CH.listOutbound('E1', { purpose: 'marketing' });
    assert.strictEqual(off.code, 'MKT_NOT_MIGRATED'); assert.strictEqual(off.migrated, false); assert.deepStrictEqual(off.outbound, []); assert.strictEqual(world.calls.length, 0);
    world.rows = [{ id: 'a' }]; world.total = 1; const all = await CH.listOutbound('E1', {}); world.migrated = true;
    assert.ok(!/party_id/.test(world.calls[0].sql) && all.outbound.length === 1);
  });
  await t('every not-sent receipt carries ONE reason_code (the gate code, else the sender reason); ?status= narrows the list', async () => {
    const R = require('../lib/marketing-results.js');
    assert.strictEqual(R.reasonCodeOf({ status: 'sent' }), null);
    assert.strictEqual(R.reasonCodeOf({ status: 'refused', reason: 'x', basis: { code: 'SAID_NO' } }), 'SAID_NO');
    assert.strictEqual(R.reasonCodeOf({ status: 'refused', reason: 'x - and offers need an approved offers template, which is not set up', basis: { code: 'CONSENT' } }), 'NO_TEMPLATE');
    assert.strictEqual(R.reasonCodeOf({ status: 'refused', reason: 'WHATSAPP_TOKEN is not set - outbound is not configured', basis: { code: 'CONSENT' } }), 'NO_TOKEN');
    assert.strictEqual(R.reasonCodeOf({ status: 'failed', reason: 'provider returned 500' }), 'FAILED');
    assert.strictEqual(R.reasonCodeOf({ status: 'refused', reason: 'odd' }), 'NOT_SENT');
    world.calls = []; world.rows = [{ id: 'a', status: 'refused', reason: 'WHATSAPP_TOKEN is not set', basis: { code: 'CONSENT' } }]; world.total = 1;
    const r = await CH.listOutbound('E1', { purpose: 'marketing', status: 'refused' });
    assert.ok(/o\.status = \$3/.test(world.calls[0].sql) && world.calls[0].p[2] === 'refused'); assert.strictEqual(r.outbound[0].reason_code, 'NO_TOKEN');
    world.calls = []; await CH.listOutbound('E1', { status: 'bogus' }); assert.ok(!/o.status = /.test(world.calls[0].sql), 'an unknown status is ignored');
  });
  await t('lib/select: counterparty_ids and until are parameters, matched on the SAME expression COLS paints (a counter bill finds its named customer)', () => {
    const src = fs.readFileSync(path.join(API, 'lib', 'select.js'), 'utf8');
    assert.ok(/const COUNTERPARTY_ID_SQL = `/.test(src)); assert.ok(/\$\{COUNTERPARTY_ID_SQL\}\s+AS counterparty_id/.test(src), 'the column uses the fragment');
    assert.ok(/put\(`\$\{COUNTERPARTY_ID_SQL\} = ANY\(\$\?::uuid\[\]\)`/.test(src), 'the filter uses the fragment');
    assert.ok(/sel\.until\) put\('ch\.created_at < \$\?::timestamp'/.test(src));
    assert.strictEqual((src.match(/business_json->'customer'->>'identity_id' ~\*/g) || []).length, 1, 'the uuid test is written once');
  });
  await t('GET /api/channels/outbound: no session is refused 401 (anonymous), a member reads it; a malformed ?status= or ?page= is held by validation (never 500); the same read twice answers the same (replay)', async () => {
    const http = require('http'), express = require('express');
    const authFn = (req, res, next) => (req.headers['x-test-session'] ? next() : res.status(401).json({ error: 'Sign in' }));
    authFn.entityOf = () => 'E1';
    stub('middleware/auth', authFn);
    delete require.cache[require.resolve(path.join(API, 'routes', 'channels.js'))];
    const app = express(); app.use('/api/channels', require('../routes/channels.js'));
    const srv = app.listen(0), port = srv.address().port;
    const get = (p, headers) => new Promise((resolve) => http.get({ port, path: p, headers }, (res) => { let b = ''; res.on('data', (x) => (b += x)); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b || '{}') })); }));
    world.rows = [{ id: 'a', status: 'sent', basis: null }]; world.total = 1;
    const anon = await get('/api/channels/outbound?purpose=marketing');
    const asked = '/api/channels/outbound?purpose=marketing&status=%00bad&page=-9&limit=zzz';
    const mine = await get(asked, { 'x-test-session': '1' }), twice = await get(asked, { 'x-test-session': '1' });
    srv.close();
    assert.strictEqual(anon.status, 401); assert.strictEqual(mine.status, 200); assert.strictEqual(mine.body.page, 1); assert.deepStrictEqual(mine.body, twice.body);
  });
  console.log('\n' + (failed ? 'FAILURES above - ' : '') + n + ' checks passed' + (failed ? ', ' + failed + ' failed' : ''));
  process.exit(failed ? 1 : 0);
})();
