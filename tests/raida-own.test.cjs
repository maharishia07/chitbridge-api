#!/usr/bin/env node
// @type: unit
/**
 * raida-own.test.cjs — a finding may only name a chit this entity holds a copy of (BOLA, raidachit 17 Nov).
 *
 * OWNS      the proof that lib/raida-own.js requireOwnChit refuses a chit the entity holds no copy of, a junk id and a line that is not on the chit, with the one 404, and lets a standalone register and a held chit through.
 * CALLED BY .github/workflows/ci.yml (offline tests loop). No database, no network: a stand-in client that answers by the ids it is asked for.
 * FLOW      stand-in client (held chits and lines) → requireOwnChit → nothing, or the 404 error
 * CARD      28-platform-and-operations/raida
 * UNIT      28/Register findings
 * MUTATION  checked once: in lib/raida-own.js delete the `if (!mine) throw` line → "a chit this entity holds no copy of is refused" fails.
 */
'use strict';
const assert = require('assert');
const { requireOwnChit } = require('../lib/raida-own');

const ENTITY = '11111111-1111-4111-8111-111111111111';
const CHIT = '22222222-2222-4222-8222-222222222222';
const LINE = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const client = { query: async (sql, params) => ({ rows: /chit_line/.test(sql) ? (params[0] === CHIT && params[2] === LINE ? [{}] : []) : (params[0] === CHIT && params[1] === ENTITY ? [{}] : []) }) };
const refused = async (chit, line) => { try { await requireOwnChit(client, ENTITY, chit, line); return null; } catch (error) { return error; } };

(async () => {
  assert.strictEqual(await requireOwnChit(client, ENTITY, null, null), undefined, 'a standalone register has nothing to check');
  assert.strictEqual(await requireOwnChit(client, ENTITY, CHIT, null), undefined, 'a held chit passes');
  assert.strictEqual(await requireOwnChit(client, ENTITY, CHIT, LINE), undefined, 'a line on the held chit passes');
  const foreign = await refused(OTHER, null);
  assert.ok(foreign && foreign.status === 404, 'a chit this entity holds no copy of is refused with the one 404');
  const junk = await refused('not-an-id', null);
  assert.ok(junk && junk.status === 404, 'a junk id is refused, never a query that throws a 500');
  const stray = await refused(CHIT, OTHER);
  assert.ok(stray && stray.status === 404, 'a line that is not on the chit is refused: the door stays closed');
  console.log('raida-own: 6 checks');
})().catch((error) => { console.error(error); process.exit(1); });
