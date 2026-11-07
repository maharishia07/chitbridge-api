'use strict';
// @type: unit
/**
 * tests/read-batch-rls-guard.test.cjs — OPS-27: readBatch ran the context-free [RLS-GUARD] tripwire on EVERY statement, even with a shop set.
 * A SCOPED batch (a shop bound by set_config, or a statement naming its own entity) is not context-free: no warning, and under
 * RLS_GUARD=throw it must RUN, not fall back. An UNSCOPED batch (null / empty entity) is guarded exactly as before.
 * Hand-computed: 2 tenant-table statements × scoped = 0 warnings, 1 wire message; × unscoped = 2 warnings (warn) or a refusal (throw).
 * Run: node tests/read-batch-rls-guard.test.cjs · no DB, no network. Mutation proof: tests/read-batch-rls-guard-mutation.test.cjs
 * CARD      13-inventory-stock-and-traceability (OPS-27)
 */
process.env.DATABASE_URL = 'postgres://u:p@127.0.0.1:5432/x';
process.env.DB_BOOT_WAIT_MS = '2000';
let wires = 0;
const one = (text) => { const s = String(text); if (!/^\s*BEGIN;/.test(s)) return { rows: [{ ok: 1 }], rowCount: 1 }; wires++; const n = s.split(/;\s*\n|;\s*$/).filter((x) => x.trim()).length; return Array.from({ length: n }, () => ({ rows: [], rowCount: 0 })); };
class FakePool {
  on() { return this; }
  async end() {}
  query(text, params, cb) { if (typeof params === 'function') cb = params; const r = one(text); if (cb) { cb(null, r); return undefined; } return Promise.resolve(r); }
  connect(cb) { const client = { query: (q) => Promise.resolve(one(q)), release() {} }; if (typeof cb === 'function') { cb(null, client, () => {}); return undefined; } return Promise.resolve(client); }
}
require('pg').Pool = FakePool;
const db = require(process.env.READ_BATCH_DB ? '../' + process.env.READ_BATCH_DB : '../db');   /* the mutation test points this at a broken copy */
const warnings = [];
console.warn = (m) => warnings.push(String(m));
const TWO = () => [{ text: 'SELECT * FROM stock_balance WHERE item_id = $1', params: ['a'] }, { text: 'SELECT * FROM stock_movement WHERE item_id = $1', params: ['a'] }];
let pass = 0, fail = 0;
const t = (name, cond, extra) => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '   ' + extra : '')); } };
/** run(mode, entity, statements) → { warned, threw, wired } for one readBatch under RLS_GUARD=mode */
async function run(mode, entity, statements) {
  process.env.RLS_GUARD = mode; warnings.length = 0; const before = wires; let threw = null;
  try { await db.readBatch(entity, 'actor-1', statements); } catch (e) { threw = e; }
  return { warned: warnings.filter((w) => /RLS-GUARD/.test(w)).length, threw, wired: wires - before };
}
(async () => {
  let r = await run('warn', 'shop-1', TWO());
  t('scoped + warn: 0 warnings, 1 message sent', r.warned === 0 && !r.threw && r.wired === 1, JSON.stringify({ w: r.warned, wired: r.wired }));
  r = await run('throw', 'shop-1', TWO());
  t('scoped + throw: the batch RUNS (no throw, 1 message sent)', !r.threw && r.wired === 1, r.threw && r.threw.message);
  r = await run('throw', null, [{ text: 'SELECT * FROM stock_balance', entity: 'brand-A' }]);
  t('a statement naming its own entity is scoped too (throw, null batch entity)', !r.threw && r.wired === 1, r.threw && r.threw.message);
  r = await run('warn', null, TWO());
  t('UNSCOPED (null) + warn: still 2 warnings, one per statement', r.warned === 2 && r.wired === 1, String(r.warned));
  r = await run('warn', '', TWO());
  t('UNSCOPED (empty string) + warn: still 2 warnings', r.warned === 2, String(r.warned));
  r = await run('warn', '   ', TWO());
  t('UNSCOPED (blank) + warn: still 2 warnings', r.warned === 2, String(r.warned));
  r = await run('throw', null, TWO());
  t('UNSCOPED + throw: still refused with [RLS-GUARD], nothing sent', r.threw && /RLS-GUARD/.test(r.threw.message) && r.wired === 0, r.threw && r.threw.message);
  r = await run('off', null, TWO());
  t('UNSCOPED + off: silent, runs (the mode switch is untouched)', r.warned === 0 && !r.threw && r.wired === 1);
  r = await run('warn', 'shop-1', [{ text: 'SELECT 1', params: [] }]);
  t('a statement with no tenant table never warned, scoped or not', r.warned === 0 && !r.threw);
  console.log(`\n  ${pass} checks · ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
