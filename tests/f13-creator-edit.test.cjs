'use strict';
/**
 * tests/f13-creator-edit.test.cjs — F13 offline half: the ONE creator-edit rule (lib/creator-edit.js) is what the arrange path and the migration both say, and the refusal is in words.
 * Run: node tests/f13-creator-edit.test.cjs · fails on the parent (the module and the b909 file do not exist there; the old arrange refusal named no claim).
 * The behaviour on real Postgres is tests/f13-identities-creator-narrow.realstack.cjs (CI job integration).
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const check = (name, fn) => { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n         ' + String(e && e.message).slice(0, 300)); } };
const { CREATOR_MAY_EDIT_SQL, creatorRefusal } = require('../lib/creator-edit');
const run = read('lib/network-build-run.js');
const mig = read('migrations/RUN-2026-11-22-b909-identities-creator-narrow.sql');
const code = mig.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');

check('the arrange statement carries the one rule (created_by AND CREATOR_MAY_EDIT_SQL), not its own copy', () => {
  assert(/WHERE bridge_id = \$2 AND created_by = \$3 AND \$\{CREATOR_MAY_EDIT_SQL\}/.test(run));
  assert(!/was not changed — you did not create that store/.test(run));
});
check('the rule says unclaimed OR network-provisioned, and the migration policy says the same text', () => {
  assert(/last_active_at IS NULL/.test(CREATOR_MAY_EDIT_SQL) && /entity_kind = 'network'/.test(CREATOR_MAY_EDIT_SQL));
  assert(code.includes("(last_active_at IS NULL OR entity_kind = 'network')"));
});
check('the refusal is a sentence a shopkeeper can act on: what happened, why, what to do', () => {
  const w = creatorRefusal('Tea Corner');
  assert(/Tea Corner/.test(w) && /claimed/.test(w) && /Ask/.test(w) && !/RLS|policy|42501/.test(w));
});
check('migration: header has run order, rollback and check; idempotent; no DELETE policy; no data touched', () => {
  assert(/RUN ORDER/.test(mig) && /ROLL BACK/.test(mig) && /CHECK \(read-only\)/.test(mig));
  assert((code.match(/DROP POLICY IF EXISTS/g) || []).length === 4);
  assert(!/FOR DELETE|FOR ALL/.test(code) && !/\b(UPDATE|DELETE FROM|INSERT INTO) identities\b/.test(code));
  assert(/FOR SELECT/.test(code) && /FOR INSERT/.test(code) && /FOR UPDATE/.test(code));
});
check('MANIFEST lists the file as Athi runs', () => assert(/RUN-2026-11-22-b909-identities-creator-narrow\.sql[^\n]*\| Athi \|/.test(read('migrations/MANIFEST.md'))));
console.log('\n' + (pass + fail) + ' checks · ' + pass + ' passed · ' + fail + ' failed');
process.exit(fail ? 1 : 0);
