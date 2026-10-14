'use strict';
/**
 * tests/read-batch-entity.test.cjs — readBatch: a statement may name its OWN entity (EFF-TRIPS, 2026-10-15).
 * `{ text, params, entity }` rides behind a `SELECT set_config('app.current_entity', <entity>, true)` in the SAME one-trip text, and the
 * result array still has ONE entry per statement, in order. Statements without `entity` are untouched (the old shape, byte for byte).
 * Run: node tests/read-batch-entity.test.cjs · no DB, no network.
 */
process.env.DATABASE_URL = 'postgres://u:p@127.0.0.1:5432/x';
process.env.RLS_GUARD = 'off';
process.env.DB_BOOT_WAIT_MS = '2000';
let sent = null;
/* the wire: one result per statement in the text (the boot's own SELECT 1 answers one row) — the same stub shape tests/round-trips-all.test.cjs uses */
const one = (text) => { const s = String(text); if (!/^\s*BEGIN;/.test(s)) return { rows: [{ ok: 1 }], rowCount: 1 }; sent = s; const n = s.split(/;\s*\n|;\s*$/).filter((x) => x.trim()).length; return Array.from({ length: n }, (_, i) => ({ rows: [{ i }], rowCount: 1 })); };
class FakePool {
  on() { return this; }
  async end() {}
  query(text, params, cb) { if (typeof params === 'function') cb = params; const r = one(text); if (cb) { cb(null, r); return undefined; } return Promise.resolve(r); }
  connect(cb) { const client = { query: (q) => Promise.resolve(one(q)), release() {} }; if (typeof cb === 'function') { cb(null, client, () => {}); return undefined; } return Promise.resolve(client); }
}
require('pg').Pool = FakePool;
const db = require('../db');
let pass = 0, fail = 0;
const t = (name, cond, extra) => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '   ' + extra : '')); } };
(async () => {
  /* the old shape: no entity anywhere → exactly the text readBatch always sent */
  let r = await db.readBatch('store-1', 'actor-1', [{ text: 'SELECT 1 WHERE x = $1', params: ['a'] }, { text: 'SELECT 2 WHERE y = $1', params: ['b'] }]);
  t('two plain statements → two results, in order', r.length === 2 && r[0].rows[0].i === 2 && r[1].rows[0].i === 3, JSON.stringify(r));
  t('no entity switch is sent when none is named', (sent.match(/set_config\('app\.current_entity'/g) || []).length === 1, sent);
  /* the widening: the second and third statements each run under their own brand */
  r = await db.readBatch('store-1', 'actor-1', [
    { text: 'SELECT 1 WHERE x = $1', params: ['a'] },
    { text: 'SELECT d FROM definition WHERE entity_id = $1', params: ['brand-A'], entity: 'brand-A' },
    { text: 'SELECT d FROM definition WHERE entity_id = $1', params: ['brand-B'], entity: 'brand-B' }]);
  t('three statements → three results (the switches are not handed back)', r.length === 3, String(r.length));
  t('each result is the statement\'s own, in order', r[0].rows[0].i === 2 && r[1].rows[0].i === 4 && r[2].rows[0].i === 6, JSON.stringify(r.map((x) => x.rows[0].i)));
  t('a set_config precedes each entity statement', /set_config\('app\.current_entity', 'brand-A', true\);\nSELECT d FROM definition WHERE entity_id = 'brand-A'/.test(sent) && /set_config\('app\.current_entity', 'brand-B', true\);\nSELECT d FROM definition WHERE entity_id = 'brand-B'/.test(sent), sent);
  t('still ONE text on the wire (one trip): BEGIN first, COMMIT last', /^BEGIN;/.test(sent) && /COMMIT;$/.test(sent.trim()));
  t('the entity is a literal, escaped', (await db.readBatch('s', null, [{ text: 'SELECT 1', params: [], entity: "o'brand" }]), /set_config\('app\.current_entity', 'o''brand', true\)/.test(sent)), sent);
  console.log(`\n  ${pass} checks · ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
