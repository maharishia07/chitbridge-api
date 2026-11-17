#!/usr/bin/env node
/**
 * tests/local-kind.test.cjs — A MINTED PARTY IS 'local' ONCE b769 HAS RUN, AND 'supplier' UNTIL THEN (K-DB / OPS-41, 21 Oct 2026).
 * lib/local-identity.mint asks lib/schema.checkAllows('identities_entity_kind_chk', 'local') through the caller's query; a database
 * whose CHECK has no 'local' yet must still mint (as 'supplier', logged), never a 23514. Offline: a fake query plays both databases.
 * FLOW  fake query (constraint text with / without 'local') → mint → the INSERT's entity_kind parameter
 */
'use strict';
const assert = require('assert');
const path = require('path');
const schema = require(path.join(__dirname, '..', 'lib', 'schema'));
const li = require(path.join(__dirname, '..', 'lib', 'local-identity'));

const BEFORE = "CHECK (((entity_kind)::text = ANY ((ARRAY['customer'::character varying, 'supplier'::character varying])::text[])))";
const AFTER = "CHECK (((entity_kind)::text = ANY ((ARRAY['customer'::character varying, 'supplier'::character varying, 'local'::character varying])::text[])))";

/** a database that answers the four statements mint() sends; the INSERT's parameters are kept */
function fakeDb(constraintText) {
  const inserts = [];
  const query = async (sql, params) => {
    if (/pg_constraint/.test(sql)) return { rows: [{ def: constraintText }] };
    if (/^\s*INSERT INTO identities/.test(sql)) {
      inserts.push(params);
      return { rows: [{ identity_id: 'id-1', bridge_id: params[0], display_name: params[1], user_id: params[2] }] };
    }
    return { rows: [] };
  };
  return { query, inserts };
}

let checks = 0;
async function run(what, fn) {
  schema._reset();
  await fn();
  checks++;
  console.log('  ✓ ' + what);
}

(async () => {
  await run("before b769 the mint writes 'supplier' (the CHECK has no 'local')", async () => {
    const db = fakeDb(BEFORE);
    const r = await li.mint('owner-1', 'Corner Hardware', { query: db.query, ownerHandle: 'acme', kind: 'cus' });
    assert.strictEqual(r.created, true);
    assert.strictEqual(db.inserts[0][4], 'supplier');
  });
  await run("after b769 the mint writes 'local'", async () => {
    const db = fakeDb(AFTER);
    await li.mint('owner-1', 'Corner Hardware', { query: db.query, ownerHandle: 'acme', kind: 'cus' });
    assert.strictEqual(db.inserts[0][4], 'local');
  });
  await run("mintMany follows the same rule ('local' after b769)", async () => {
    const db = fakeDb(AFTER);
    await li.mintMany('owner-1', ['Ravi', 'Meena'], { query: db.query, ownerHandle: 'acme', kind: 'cus' });
    assert.strictEqual(db.inserts[0][4], 'local');
  });
  await run('an unreadable constraint answers supplier (never a failed mint)', async () => {
    assert.strictEqual(await li.mintKind(async () => { throw new Error('down'); }), 'supplier');
  });
  console.log('\n  ' + checks + ' checks');
})().catch((e) => {
  console.error('  ✗ ' + e.message);
  process.exit(1);
});
