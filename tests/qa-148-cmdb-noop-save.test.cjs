'use strict';
/**
 * qa-148-cmdb-noop-save.test.cjs — saving an identical CMDB record writes nothing (QA-148, 2026-11-12).
 * upsertVersioned compared JSON.stringify, so a different key order counted as a change and a re-seed added a version per file.
 * Now it compares lib/canon (keys sorted). Fake db, no network.   Run: node tests/qa-148-cmdb-noop-save.test.cjs
 * CARD      20-settings-governance-and-plan/cmdb
 */
const assert = require('assert');
const upsert = require('../routes/testing').upsertVersioned;

/** a tiny in-memory definition + definition_version; the rules come back the way jsonb returns them (keys reordered) */
function fakeDb() {
  const st = { def: null, versions: [] };
  return { st, async query(sql, p) {
    if (/^\s*SELECT d\.definition_id/.test(sql)) {
      if (!st.def) return { rows: [] };
      const v = st.versions[st.versions.length - 1];
      const sorted = Object.fromEntries(Object.entries(JSON.parse(v)).sort()); // jsonb does not keep the sender's order
      return { rows: [{ definition_id: 7, current_version: st.def.v, rules: sorted }] };
    }
    if (/^\s*INSERT INTO definition_version/.test(sql)) { st.versions.push(p[sql.includes('VALUES ($1,1') ? 2 : 3]); return { rows: [] }; }
    if (/^\s*UPDATE definition SET current_version/.test(sql)) { st.def.v = p[1]; return { rows: [] }; }
    if (/INSERT INTO definition/.test(sql)) { st.def = { v: 1 }; return { rows: [{ definition_id: 7 }] }; }
    throw new Error('unexpected sql ' + sql.slice(0, 40));
  } };
}
const who = { id: 'u1' };
(async () => {
  const db = fakeDb();
  const a = await upsert(db, 'e1', who, 'cmdb', 'CAP-X', 'sys', 'title', { ci: 'CAP-X', title: 'T', nested: { b: 1, a: 2 }, z: [1, 2] });
  assert.strictEqual(a.version, 1);
  const same = await upsert(db, 'e1', who, 'cmdb', 'CAP-X', 'sys', 'title', { z: [1, 2], nested: { a: 2, b: 1 }, title: 'T', ci: 'CAP-X' });
  assert.strictEqual(same.changed, false, 'keys shuffled = the same record');
  assert.strictEqual(same.version, 1);
  assert.strictEqual(db.st.versions.length, 1, 'nothing was written');
  const diff = await upsert(db, 'e1', who, 'cmdb', 'CAP-X', 'sys', 'title', { ci: 'CAP-X', title: 'T2', nested: { b: 1, a: 2 }, z: [1, 2] });
  assert.strictEqual(diff.version, 2);
  assert.strictEqual(db.st.versions.length, 2, 'a real change versions');
  console.log('  ok  shuffled save = no new version; one field changed = +1 version');
  console.log('\n4 checks');
})().catch((e) => { console.log('  FAIL ' + e.message); process.exit(1); });
