/**
 * reviews4-network-security.test.cjs — batch 1129, GF-network-01 M3 / M10 / M11 / M17 (EL F17).
 * M10 settle withdraws only Active/Hold, refuses whole if an accepted chit remains; M11 the tree hides place of private/closed stores;
 * M3 invite refuses a remote business; M17 build/reissue/respond refuse a key. Run: node tests/reviews4-network-security.test.cjs (no DB).
 */
'use strict';
const assert = require('assert'), path = require('path'), fs = require('fs');
const API = path.join(__dirname, '..');
const calls = []; let answer = () => ({ rows: [] }); let txAnswer = () => ({ rows: [] });
const run = async (sql, p) => { calls.push({ sql: String(sql).replace(/\s+/g, ' '), p }); return answer(calls[calls.length - 1]); };
const srcDb = require.resolve(path.join(API, 'src', 'db'));
require.cache[srcDb] = { id: srcDb, filename: srcDb, loaded: true, exports: { pool: { query: run }, withTx: async (fn) => fn({ query: async (sql, p) => { calls.push({ sql: String(sql).replace(/\s+/g, ' '), p }); return txAnswer(calls[calls.length - 1]); } }) } };
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://cb@127.0.0.1:5432/cb_test';
const net = require(path.join(API, 'src', 'services', 'network'));
let pass = 0, fail = 0;
const it = async (n, f) => { try { await f(); pass++; console.log('  ok  ' + n); } catch (e) { fail++; console.log('  XX  ' + n + ' — ' + e.message); } };
(async () => {
  const edge = { id: 'E1', parent_id: 'A', child_id: 'B', type: 'commercial', state: 'active', in_flight: false };
  await it('M10 settle never voids Accepted/InProgress/Finished; a remaining accepted chit refuses the disconnect', async () => {
    calls.length = 0;
    txAnswer = (c) => (/from cb_edge where id/.test(c.sql) ? { rows: [edge] } : /select 1 from cb_chit/.test(c.sql) ? { rows: [{ '?column?': 1 }] } : { rows: [] });
    let e = null; try { await net.disconnect({ edgeId: 'E1', settle: true }, { id: 'B' }); } catch (x) { e = x; }
    const upd = calls.find((c) => /update cb_chit set txn_status='Withdrawn'/.test(c.sql));
    assert.ok(upd && !/Finished|Accepted|InProgress/.test(upd.sql), upd && upd.sql);
    assert.ok(e && e.status === 409 && e.code === 'IN_FLIGHT', String(e && e.message));
  });
  await it('M11 subtree hides place and purpose of a private or closed store, not the caller\'s own node nor a public one', async () => {
    const root = { id: 'R', bridge_id: 'B-R', path: 'b_r' }; const actor = { id: 'N-A', bridge_id: 'B-A', path: 'b_r.b_a' };
    const mk = (id, vis, st) => ({ id, name: id, depth: 1, purpose: 'secret', city: 'X', lat: 1, lng: 2, service_km: 5, catalogue_visibility: vis, business_status: st });
    answer = (c) => (/from cb_entity where id=\$1/.test(c.sql) ? { rows: [root] } : /as same from/.test(c.sql) ? { rows: [{ same: true }] } : { rows: [mk('N-A', 'private', 'open'), mk('P', 'private', 'open'), mk('C', 'public', 'closed'), mk('OK', 'network', 'open')] });
    const rows = await net.subtree('R', actor); const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    assert.strictEqual(by.P.city, null); assert.strictEqual(by.P.lat, null); assert.strictEqual(by.P.purpose, null); assert.strictEqual(by.C.city, null);
    assert.strictEqual(by['N-A'].city, 'X'); assert.strictEqual(by.OK.city, 'X'); assert.ok(!('catalogue_visibility' in by.P));
  });
  await it('M3 the invite step asks the NET-77 refusal (a remote business is a failed invite, no edge)', async () => {
    const src = fs.readFileSync(path.join(API, 'lib', 'network-build-run.js'), 'utf8');
    const i = src.indexOf('async function inviteNode'); const j = src.indexOf('INSERT INTO cb_edge', i);
    assert.ok(src.slice(i, j).includes('remoteReason('), 'inviteNode must refuse a remote business before it writes an edge');
    const guard = require(path.join(API, 'lib', 'network-invite-guard'));
    const svc = require(path.join(API, 'src', 'services', 'network')); const keep = svc.refuseRemote;
    svc.refuseRemote = async () => { throw Object.assign(new Error('x'), { code: 'NETWORK_REMOTE_NOT_YET' }); };
    assert.ok((await guard.remoteReason('I1')).includes('another ChitBridge installation'));
    svc.refuseRemote = async () => {}; assert.strictEqual(await guard.remoteReason('I1'), null); svc.refuseRemote = keep;
  });
  await it('M17 build, reissue and respond use the one owner test (a key is refused)', () => {
    const d = fs.readFileSync(path.join(API, 'routes', 'network-design.js'), 'utf8');
    assert.ok(!/if \(req\.identity\.parent_entity_id\) \{\s*return problem\(req, res, \{ status: 403, \.\.\.contract\.words\.(build|reissue)OwnerOnly/.test(d));
    assert.ok(d.split('.isOwner(req)').length - 1 >= 2);
    assert.ok(fs.readFileSync(path.join(API, 'routes', 'connections.js'), 'utf8').includes('!isOwner(req)'));
  });
  console.log('\n' + (fail ? 'FAIL ' + fail + ', ' : 'ok ') + pass + ' passed'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('ERROR ' + (e && e.stack || e)); process.exit(1); });
