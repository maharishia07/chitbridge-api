'use strict';
/**
 * migrate-stops-and-locks.test.cjs — VERIFY-EL-DB A6: tools/migrate.cjs (the ONE runner) takes a session advisory lock before it touches a database and STOPS at the first failed
 * numbered file (only files on migrations/fresh-db.accepted.json may fail and go on). Static: it reads the runner; the real-PG proof is the fresh-db job. No DB, no network.
 * Mutant: delete the `break` or the pg_advisory_lock line and a check below turns red. Run: node tests/migrate-stops-and-locks.test.cjs
 * CARD      28-platform-and-operations/migrations-and-schema
 */
const assert = require('assert'), fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'migrate.cjs'), 'utf8').replace(/\r\n/g, '\n');
let pass = 0;
const it = (w, f) => { try { f(); pass++; console.log('  ok  ' + w); } catch (e) { console.log('  FAIL ' + w + '\n      ' + e.message); process.exitCode = 1; } };
const runBody = src.slice(src.indexOf('async function runPending('), src.indexOf('async function apply(')); /* the loop over the pending files: a same-file helper of apply */
const applyBody = src.slice(src.indexOf('async function apply('), src.indexOf('async function status('));
it('apply takes the advisory lock before preflight and releases it in finally', () => {
  assert(/pg_try_advisory_lock/.test(src) && /pg_advisory_lock\(/.test(src) && /pg_advisory_unlock/.test(src), 'lock calls missing');
  assert(applyBody.indexOf('takeLock(') > -1 && applyBody.indexOf('takeLock(') < applyBody.indexOf('preflight('), 'the lock must be taken before preflight');
  assert(/finally \{\s*if \(lock\) await releaseLock\(lock\)/.test(applyBody), 'the lock must be released in finally');
});
it('the first failed numbered file stops the run unless it is on the accepted list', () => {
  assert(/acceptedFailures\(\)\.includes\(f\)/.test(runBody), 'accepted list not consulted');
  assert(/if \(stopped\) break;/.test(runBody), 'no break on the first failure');
  assert(/stopped,?\s*\}/.test(applyBody), 'the result must say where it stopped');
});
console.log(pass + ' passed');
