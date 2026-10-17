/**
 * move-in-added-via.test.cjs — THE MOVE-IN WRITES ONLY AN added_via THE DATABASE ALLOWS (QM-1, 17 Oct 2026).
 *
 * The move-in wrote added_via = 'move_in'; the CHECK constraints (b227 supplier_list · b297 customer_list) allow only
 * manual · transaction · import · system (+ catalogue · lead for customers). Every real database refused the contacts
 * file with 23514, and tests/move-in.test.cjs stayed green because its stub database has no constraints.
 *
 * So the allowed sets are READ FROM THE MIGRATION FILES (the latest definition of each constraint wins), and lib/move-in
 * apply() is driven with a fake connection that records what each list INSERT would write — the value is resolved from the
 * SQL itself (column position → literal or $n → the parameter), so a new literal or a re-ordered column cannot hide.
 * A 23514 raised inside the apply must come back as a refusal with a sentence (422), never an uncaught 500.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const API = path.join(__dirname, '..');
const MIG = path.join(API, 'migrations');

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; console.error('  FAIL  ' + name + '\n        ' + (e && e.message)); }
};

/* migrations in the order they are run: the baseline (000_*) first, then bNNN by number */
const orderOf = (f) => { const m = /^b(\d+)/.exec(f); return m ? Number(m[1]) : (/^0+_/.test(f) ? -1 : Infinity); };
const files = fs.readdirSync(MIG).filter((f) => f.endsWith('.sql') && orderOf(f) !== Infinity)
  .sort((a, b) => orderOf(a) - orderOf(b) || a.localeCompare(b));

/** the allowed added_via values of one table: the LAST `<table>_added_via_check` CHECK across the run order */
function allowedOf(table) {
  let last = null;
  const re = new RegExp('ADD\\s+CONSTRAINT\\s+' + table + '_added_via_check\\s+CHECK\\s*\\(([\\s\\S]*?)\\)\\s*;', 'gi');
  for (const f of files) {
    const sql = fs.readFileSync(path.join(MIG, f), 'utf8').replace(/--[^\n]*/g, '');
    let m; while ((m = re.exec(sql))) last = { file: f, values: (m[1].match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1)) };
  }
  return last;
}

/** what an INSERT INTO <table> (…, added_via, …) VALUES (…) writes into added_via: a literal, or the parameter its $n names */
function addedViaOf(sql, params) {
  const m = /INSERT\s+INTO\s+(\w+)\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)/i.exec(sql);
  if (!m) return { table: null };
  const cols = m[2].split(',').map((s) => s.trim()), vals = m[3].split(',').map((s) => s.trim());
  const i = cols.indexOf('added_via');
  if (i < 0) return { table: m[1], value: undefined };
  const v = vals[i];
  const p = /^\$(\d+)$/.exec(v);
  return { table: m[1], value: p ? params[Number(p[1]) - 1] : v.replace(/^'|'$/g, '') };
}

/** a fake withEntity handle: answers the mint and the list inserts, records every list write, optionally refuses one with 23514 */
function fakeDb(opts) {
  const o = opts || {}, writes = [];
  let n = 0;
  const query = async (sql, params) => {
    const s = String(sql);
    if (/INSERT\s+INTO\s+(customer_list|supplier_list)/i.test(s)) {
      const w = addedViaOf(s, params || []); writes.push(w);
      if (o.refuse) { const e = new Error('new row for relation "' + w.table + '" violates check constraint'); e.code = '23514'; e.constraint = w.table + '_added_via_check'; e.table = w.table; throw e; }
      return { rows: [{ id: 'list-' + (++n), customer_list_id: 'list-' + n }] };
    }
    if (/INSERT\s+INTO\s+identities/i.test(s)) return { rows: [{ identity_id: 'party-' + (++n), bridge_id: 'B' + n, display_name: params[1], user_id: params[2] }] };
    if (/SELECT user_id, bridge_id FROM identities WHERE identity_id/.test(s)) return { rows: [{ user_id: 'testshop', bridge_id: 'BSHOP' }] };
    return { rows: [] };
  };
  return { writes, h: { query } };
}

const MI = require(path.join(API, 'lib', 'move-in'));
const SHOP = '00000000-0000-0000-0000-0000000000aa';
const contacts = () => ({ kind: 'contacts', source: 'xero', rows: [
  { line: 2, what: 'Kumar Traders', action: 'add', data: { side: 'customer', name: 'Kumar Traders' } },
  { line: 3, what: 'Harbour Supplies', action: 'add', data: { side: 'supplier', name: 'Harbour Supplies' } }] });
const ctx = { world: { listIds: [] }, by: 'u1' };

(async () => {
  console.log('\nthe allowed added_via values, read from the migrations');
  const cust = allowedOf('customer_list'), sup = allowedOf('supplier_list');
  await t('customer_list_added_via_check is found (not vacuous)', () => { assert.ok(cust && cust.values.length, 'no customer_list_added_via_check in migrations/'); console.log('        ' + cust.file + ': ' + cust.values.join(' · ')); });
  await t('supplier_list_added_via_check is found (not vacuous)', () => { assert.ok(sup && sup.values.length, 'no supplier_list_added_via_check in migrations/'); console.log('        ' + sup.file + ': ' + sup.values.join(' · ')); });
  await t('lib/move-in ADDED_VIA is allowed on both lists', () => {
    assert.ok(cust.values.includes(MI.ADDED_VIA), MI.ADDED_VIA + ' not in ' + cust.values);
    assert.ok(sup.values.includes(MI.ADDED_VIA), MI.ADDED_VIA + ' not in ' + sup.values);
  });

  console.log('\nwhat the move-in apply actually writes');
  const X = fakeDb();
  const out = await MI.apply(X.h, SHOP, contacts(), ctx);
  await t('both contacts were added (a customer and a supplier)', () => assert.strictEqual(out.added, 2, JSON.stringify(out)));
  await t('it wrote one customer_list and one supplier_list row', () => {
    assert.deepStrictEqual(X.writes.map((w) => w.table).sort(), ['customer_list', 'supplier_list']);
  });
  await t('⭐ every added_via it wrote is one the database allows', () => {
    for (const w of X.writes) {
      const allowed = w.table === 'customer_list' ? cust.values : sup.values;
      assert.ok(allowed.includes(w.value), w.table + ' added_via=' + JSON.stringify(w.value) + ' — allowed: ' + allowed.join(', '));
    }
  });

  console.log('\na check refusal from the database is a sentence, not a 500');
  const Y = fakeDb({ refuse: true });
  let err = null;
  try { await MI.apply(Y.h, SHOP, contacts(), ctx); } catch (e) { err = e; }
  await t('the apply refuses (the transaction is aborted; nothing after it may land)', () => assert.ok(err, 'apply did not throw'));
  await t('as a refusal the books route answers 422 with a code', () => {
    assert.strictEqual(err.refused, true); assert.strictEqual(err.status, 422); assert.strictEqual(err.code, 'MOVE_IN_DB_REFUSED');
  });
  await t('the sentence says nothing was imported', () => assert.ok(/^Nothing was imported/.test(err.message), err.message));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
