/**
 * network-standing.test.cjs — A SUSPENDED MEMBER IS REFUSED (TOP-CORRECT item 2, 2026-10-14).
 *
 * Suspend changes only cb_edge.state (src/services/network.js suspend); the node's path stays. Two readers compared the path's ROOT
 * only — lib/catalogue-view sameNetwork (the `network` catalogue tier) and src/services/network _sameRoot (the tree) — so a suspended
 * member went on reading both. Now both ask ONE helper, lib/network-membership standingSql: no suspended governance edge on the node
 * or any ancestor. isMemberSql's built branch asks the same helper. A LEFT member is re-rooted by disconnect — the path refuses it.
 *
 * Run: node tests/network-standing.test.cjs · no DB (recording stand-ins), no network.
 */
'use strict';
const assert = require('assert'), path = require('path');
const API = path.join(__dirname, '..');

/* src/services/network opens its own pool (src/db) — a recording stand-in before it loads */
const calls = []; let answer = () => ({ rows: [] });
const srcDb = require.resolve(path.join(API, 'src', 'db'));
require.cache[srcDb] = { id: srcDb, filename: srcDb, loaded: true, exports: { pool: { query: async (sql, p) => { calls.push({ sql: String(sql).replace(/\s+/g, ' '), p }); return answer(calls[calls.length - 1]); } }, withTx: async (fn) => fn({ query: async () => ({ rows: [] }) }) } };
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://cb@127.0.0.1:5432/cb_test';

const membership = require(path.join(API, 'lib', 'network-membership'));
const view = require(path.join(API, 'lib', 'catalogue-view'));
const net = require(path.join(API, 'src', 'services', 'network'));

let pass = 0, fail = 0;
const it = async (name, fn) => { try { await fn(); pass++; console.log('  ok  ' + name); } catch (e) { fail++; console.log('  XX  ' + name + ' — ' + e.message); } };
const SUSP = /g\.type = 'governance' AND g\.state = 'suspended'/;

(async () => {
  console.log('\nstanding · the one edge-state read');
  await it('standingSql(p): no SUSPENDED governance edge on the node or any ancestor (containment, not equality)', () => {
    const s = membership.standingSql('n.path').replace(/\s+/g, ' ');
    assert.ok(SUSP.test(s), s);
    assert.ok(/\(n\.path\) <@ x\.path/.test(s), 'ancestors are not asked: ' + s);
    assert.ok(/^NOT EXISTS/.test(s.trim()));
  });
  await it('sameTreeSql(a, b): one root AND both in standing', () => {
    const s = membership.sameTreeSql('a.path', 'b.path').replace(/\s+/g, ' ');
    assert.ok(/subpath\(a\.path, 0, 1\) = subpath\(b\.path, 0, 1\)/.test(s), s);
    assert.strictEqual((s.match(SUSP) || []).length, 1); assert.strictEqual(s.split("g.state = 'suspended'").length - 1, 2, 'both sides');
  });
  await it('isMemberSql: the built branch asks standingSql (the store, and the branch it hangs from); the commercial branch is unchanged', () => {
    const s = membership.isMemberSql('b', 's').replace(/\s+/g, ' ');
    assert.ok(/\(sc\.path\) <@ x\.path/.test(s), s);
    assert.ok(/e\.type = 'commercial' AND e\.state = 'active'/.test(s));
  });

  console.log('\nsameNetwork · the catalogue\'s `network` tier');
  const rec = (same) => { const q = []; return { q, query: async (sql, p) => { q.push({ sql: String(sql).replace(/\s+/g, ' '), p }); return { rows: [{ same }] }; } }; };
  await it('⛔ a suspended member (same root, edge suspended) is NOT in the network: the one query reads cb_edge for BOTH sides', async () => {
    const r = rec(false);
    assert.strictEqual(await membership.sameNetwork(r.query, 'B-STORE', 'B-OWNER'), false);
    assert.strictEqual(r.q.length, 1);
    assert.ok(SUSP.test(r.q[0].sql), 'root only: ' + r.q[0].sql);
    assert.strictEqual(r.q[0].sql.split("g.state = 'suspended'").length - 1, 2);
    assert.deepStrictEqual(r.q[0].p, ['B-STORE', 'B-OWNER']);
  });
  await it('a member in standing is in (same:true); itself without asking; an unresolvable read fails CLOSED', async () => {
    assert.strictEqual(await membership.sameNetwork(rec(true).query, 'B-A', 'B-B'), true);
    const r = rec(true); assert.strictEqual(await membership.sameNetwork(r.query, 'B-A', 'B-A'), true); assert.strictEqual(r.q.length, 0);
    assert.strictEqual(await membership.sameNetwork(async () => { throw new Error('relation cb_entity does not exist'); }, 'B-A', 'B-B'), false);
    assert.strictEqual(await membership.sameNetwork(rec(true).query, null, 'B-B'), false);
  });
  await it('catalogueVisibility: an owner on `network` is PRIVATE to a suspended viewer, PUBLIC to one in standing — through the same helper', async () => {
    const run = (same) => { const q = []; const query = async (sql, p) => { const s = String(sql).replace(/\s+/g, ' '); q.push(s);
      if (/FROM identities/.test(s)) return { rows: [{ catalogue_visibility: 'network', plan: 'free', params_override: {}, bridge_id: 'B-OWNER', business_status: 'open' }] };
      return { rows: [{ same }] }; };
      return { q, query }; };
    const cap = { capOf: () => ({ max: 'public' }) };
    const a = run(false);
    assert.strictEqual(await view.catalogueVisibility({ entity_id: 'E1', query: a.query, visibilityCap: cap, viewer: 'B-STORE' }), 'private');
    assert.ok(a.q.some((s) => SUSP.test(s)), 'the tier was decided on the root alone: ' + a.q.join(' | '));
    const b = run(true);
    assert.strictEqual(await view.catalogueVisibility({ entity_id: 'E1', query: b.query, visibilityCap: cap, viewer: 'B-STORE' }), 'public');
    assert.strictEqual(await view.catalogueVisibility({ entity_id: 'E1', query: run(true).query, visibilityCap: cap, viewer: null }), 'private', 'anonymous');
  });

  console.log('\nsubtree · the tree');
  const node = { id: 'N-ROOT', bridge_id: 'B-ROOT', path: 'b_root' };
  const actor = { id: 'N-STORE', bridge_id: 'B-STORE', path: 'b_root.b_store' };
  await it('⛔ a suspended member is refused the network\'s tree, with the sentence and code NOT_ALLOWED — the access read asks cb_edge', async () => {
    calls.length = 0; answer = (c) => (/from cb_entity where id=\$1/.test(c.sql) ? { rows: [node] } : { rows: [{ same: false }] });
    let e = null; try { await net.subtree('N-ROOT', actor); } catch (x) { e = x; }
    assert.ok(e && e.status === 403 && e.code === 'NOT_ALLOWED', String(e && e.message));
    assert.ok(/suspended/.test(e.message), e.message);
    const access = calls.find((c) => /as same from cb_entity/.test(c.sql));
    assert.ok(access && SUSP.test(access.sql), 'root only: ' + (access && access.sql));
    assert.deepStrictEqual(access.p, ['N-ROOT', 'b_root.b_store', 'N-STORE']);
    assert.ok(/e\.id = \$3 or/.test(access.sql), 'its own node must stay readable');
  });
  await it('a member in standing reads the tree; nobody signed in is refused before any read', async () => {
    calls.length = 0; answer = (c) => (/from cb_entity where id=\$1/.test(c.sql) ? { rows: [node] } : /as same from/.test(c.sql) ? { rows: [{ same: true }] } : { rows: [{ id: 'N-ROOT', path: 'b_root', depth: 0 }] });
    const rows = await net.subtree('N-ROOT', actor);
    assert.strictEqual(rows.length, 1);
    calls.length = 0; let e = null; try { await net.subtree('N-ROOT', null); } catch (x) { e = x; }
    assert.ok(e && e.code === 'NOT_ALLOWED'); assert.strictEqual(calls.filter((c) => /as same from/.test(c.sql)).length, 0);
  });

  console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' : '✓ ') + pass + ' passed · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('ERROR ' + (e && e.stack || e)); process.exit(1); });
