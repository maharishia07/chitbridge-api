#!/usr/bin/env node
// @type: integration
/**
 * tests/purge-erase-guards.test.cjs — PURGE AND ERASE NEVER TAKE WHAT A SHOP OWNS OR HOLDS WITH ANOTHER (DELETE /api/chits/:id/purge · PATCH /api/entities/:id/erase).
 * UNIT      27 DATA LIFECYCLE / Auto-purge, customer purge, erase an entity (test = 0: the card cited `E: till-purge.cjs`, a walk that proves nothing offline)
 * OWNS      the refusals that keep an owner's records from being deleted early: a SENT or RECEIVED copy (co-held, immutable) is never purged — 409 and not one DELETE ·
 *           a draft with an OPEN dispute is not purged · an unreadable dispute count refuses (fails closed, 503) · only the draft's own creator may purge it (403) ·
 *           another shop's draft is "not found" (404) · the one valid purge deletes only MY copy (every DELETE carries entity_id) · erase is the platform role only
 *           (403 for a shop), a SEALED identity is refused (403), and erase is a tombstone UPDATE, never a DELETE.
 * CALLED BY scripts/guards.cjs · CI. No database: tests/support/route-golden.cjs stubs db and auth; the real routes/chits.js and routes/entities.js run.
 * FLOW      stub rows → DELETE/PATCH → status + every statement sent → asserted (a refusal must send no write at all)
 * CARD      27-data-lifecycle-retention-storage-archive/auto-purge-customer-purge-erase-an-entity
 */
'use strict';
const assert = require('assert');
const path = require('path');
const G = require('./support/route-golden.cjs');

const SHOP = '11111111-1111-4111-8111-111111111111';
const ME = '22222222-2222-4222-8222-222222222222';
const OTHER_ACTOR = '33333333-3333-4333-8333-333333333333';
const CHIT = 'c0000000-0000-4000-8000-0000000000c1';
const TARGET = '44444444-4444-4444-8444-444444444444';

function rows(sql, params, ctx) {
  if (/FROM chit_header WHERE chit_id = \$1 AND entity_id = \$2/.test(sql) && /SELECT role/.test(sql)) return ctx.header ? [ctx.header] : [];
  if (/FROM chit_disputes WHERE chit_id = \$1 AND status = 'open'/.test(sql)) {
    if (ctx.disputesFail) throw new Error('relation "chit_disputes" does not exist');
    return [{ count: ctx.openDisputes || 0 }];
  }
  if (/SELECT sealed FROM identities/.test(sql)) return ctx.sealed === undefined ? [] : [{ sealed: ctx.sealed }];
  return [];
}
const h = G.harness({ rows, known: { [SHOP]: 'SHOP', [ME]: 'ME', [CHIT]: 'CHIT', [TARGET]: 'TARGET' } });
const chits = h.app('/api/chits', require(path.join(G.API, 'routes', 'chits.js')));
const entities = h.app('/api/entities', require(path.join(G.API, 'routes', 'entities.js')));
const shop = { identity_id: SHOP, identity_type: 'entity', display_name: 'Shop A' };
const purge = (ctx, who) => h.run(chits, { method: 'DELETE', url: '/api/chits/' + CHIT + '/purge', identity: who || { ...shop, identity_id: ME, parent_entity_id: SHOP }, ctx, settle: 5 });
const erase = (ctx, who) => h.run(entities, { method: 'PATCH', url: '/api/entities/' + TARGET + '/erase', body: {}, identity: who || shop, ctx, settle: 5 });
const deletes = (r) => r.calls.filter((c) => /^\s*DELETE\b/i.test(c.sql || ''));
const anyWrite = (r) => r.calls.filter((c) => /^\s*(DELETE|UPDATE|INSERT)\b/i.test(c.sql || ''));

let checks = 0;
async function it(what, fn) { await fn(); checks++; console.log('  ok  ' + what); }

(async () => {
  await it('a SENT copy is co-held: purge answers 409 and not one statement writes', async () => {
    const r = await purge({ header: { role: 'Sender', created_by_actor_id: ME }, openDisputes: 0 });
    assert.strictEqual(r.status, 409, JSON.stringify(r.body));
    assert.strictEqual(anyWrite(r).length, 0, JSON.stringify(anyWrite(r)));
  });

  await it('a RECEIVED copy is refused the same way', async () => {
    const r = await purge({ header: { role: 'Receiver', created_by_actor_id: ME }, openDisputes: 0 });
    assert.strictEqual(r.status, 409);
    assert.strictEqual(anyWrite(r).length, 0);
  });

  await it('a draft with an OPEN dispute is not purged: 409, no write', async () => {
    const r = await purge({ header: { role: 'Draft', created_by_actor_id: ME }, openDisputes: 1 });
    assert.strictEqual(r.status, 409, JSON.stringify(r.body));
    assert.strictEqual(anyWrite(r).length, 0);
  });

  await it('refusal is fail-closed: an unreadable dispute count refuses (503), it never reads "no disputes"', async () => {
    const r = await purge({ header: { role: 'Draft', created_by_actor_id: ME }, disputesFail: true });
    assert.strictEqual(r.status, 503, 'got ' + r.status + ' ' + JSON.stringify(r.body));
    assert.strictEqual(anyWrite(r).length, 0);
  });

  await it('a draft someone else created is 403 and nothing is deleted', async () => {
    const r = await purge({ header: { role: 'Draft', created_by_actor_id: OTHER_ACTOR }, openDisputes: 0 });
    assert.strictEqual(r.status, 403, JSON.stringify(r.body));
    assert.strictEqual(anyWrite(r).length, 0);
  });

  await it('a chit this shop holds no copy of is 404 (another shop\'s draft is invisible, not forbidden) and nothing is deleted', async () => {
    const r = await purge({ header: null });
    assert.strictEqual(r.status, 404);
    assert.strictEqual(anyWrite(r).length, 0);
  });

  await it('the one valid purge: own draft, no dispute → 200 and every DELETE is scoped to MY entity (attachments by chit)', async () => {
    const r = await purge({ header: { role: 'Draft', created_by_actor_id: ME }, openDisputes: 0 });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const d = deletes(r);
    assert.ok(d.length >= 5, 'expected the draft rows to go, saw ' + d.length);
    const tables = d.map((c) => (c.sql.match(/DELETE FROM (\w+)/) || [])[1]);
    for (const t of ['chit_messages', 'state_log', 'chit_detail', 'chit_status', 'chit_header']) assert.ok(tables.includes(t), 'not purged: ' + t);
    for (const c of d.filter((x) => !/cb_attachment/.test(x.sql))) assert.ok(/entity_id = \$2/.test(c.sql) && c.params[1] === 'SHOP', 'a delete is not scoped to my entity: ' + c.sql);
    assert.ok(!tables.includes('chit_disputes'), 'a dispute row was deleted by a purge');
  });

  await it('erase is the platform role only: a shop gets 403 NOT_PLATFORM and no statement is sent', async () => {
    const r = await erase({ sealed: false });
    assert.strictEqual(r.status, 403, JSON.stringify(r.body));
    assert.strictEqual(r.calls.length, 0, 'the database was reached by a non-platform caller');
  });

  await it('a SEALED identity cannot be erased even by the platform: 403 and no UPDATE', async () => {
    const r = await erase({ sealed: true }, { ...shop, owner_scope: 'platform' });
    assert.strictEqual(r.status, 403, JSON.stringify(r.body));
    assert.strictEqual(anyWrite(r).length, 0);
  });

  await it('erase by the platform is a TOMBSTONE: one UPDATE that marks the identity, never a DELETE', async () => {
    const r = await erase({ sealed: false }, { ...shop, owner_scope: 'platform' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(deletes(r).length, 0, 'an erase deleted rows');
    const w = anyWrite(r);
    assert.strictEqual(w.length, 1);
    assert.ok(/UPDATE identities SET is_erased=true/.test(w[0].sql) && w[0].params[0] === 'TARGET');
    assert.strictEqual(r.body.message, 'Identity tombstoned');
  });

  console.log('\n  ' + checks + ' checks');
  console.log('  ' + checks + ' passed');
  process.exit(0);
})().catch((e) => { console.log('  FAIL ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join('\n       ') : e)); process.exit(1); });
