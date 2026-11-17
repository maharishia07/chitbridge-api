'use strict';
/**
 * tests/private-flag.test.cjs — the OFFLINE checks of private bookmarks and notes (b876): no database, no server.
 * OWNS      the words, the caps and the shape: labels and notes, the caps are the marks' own numbers, the contract lists exactly the router's routes, the subjects are one list, the not-migrated answer, the migration's own promises.
 * Run: node tests/private-flag.test.cjs
 * CARD      PM/REQ-PRIVATE-NOTES-BOOKMARKS-2026-11-17.md
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n         ' + String(e && e.message).slice(0, 400)); } };

(async () => {
  const flags = require(path.join(API, 'lib', 'private-flag.js'));
  const review = require(path.join(API, 'lib', 'review-mark.js'));
  const adopters = require(path.join(API, 'lib', 'mark-adopters.js'));
  const contract = require(path.join(API, 'lib', 'flags-contract.js'));
  const sql = fs.readFileSync(path.join(API, 'migrations', 'b876_private_flag.sql'), 'utf8');

  await t('1 the label is plain text of 1 to 80 characters', async () => {
    assert.strictEqual(flags.labelOf('  Entry 12 2026-11-17 '), 'Entry 12 2026-11-17');
    for (const bad of ['', '   ', 'x'.repeat(81), '<b>x</b>', 'a>b', 'tab\there', 'nul\u0000', null, 5, {}]) assert.throws(() => flags.labelOf(bad), (e) => e.code === 'FLAG_LABEL_INVALID' && e.status === 422, JSON.stringify(bad));
    assert.strictEqual(flags.labelOf('x'.repeat(80)).length, 80);
    assert.strictEqual(flags.LABEL_MAX, 80);
  });
  await t('2 the caps are the marks\' own numbers, imported once (200 ids, 1,000 characters), never retyped here', async () => {
    assert.strictEqual(review.MAX_IDS, 200);
    assert.strictEqual(review.NOTE_MAX, 1000);
    const source = fs.readFileSync(path.join(API, 'lib', 'private-flag.js'), 'utf8') + fs.readFileSync(path.join(API, 'routes', 'flags.js'), 'utf8');
    assert.ok(!/\b(200|1000)\b/.test(source.replace('ok || 200', '').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')), 'a retyped cap');
    assert.ok(/MAX_IDS, NOTE_MAX \} = require\('\.\/review-mark'\)/.test(source));
    assert.ok(/MAX_IDS \} = core/.test(fs.readFileSync(path.join(API, 'routes', 'marks.js'), 'utf8')), 'routes/marks.js imports the cap');
  });
  await t('3 the subjects are ONE list: the audit adopter points at SUBJECTS.posting; v1 = posting + client', async () => {
    assert.deepStrictEqual(adopters.subjectKinds(), ['posting', 'client']);
    assert.strictEqual(adopters.ADOPTERS['acc.audit'].subject, adopters.SUBJECTS.posting);
  });
  await t('4 the contract lists exactly the nine routes of the router, none behind a grant', async () => {
    const router = require(path.join(API, 'routes', 'flags.js'));
    const routed = router.stack.filter((l) => l.route).map((l) => Object.keys(l.route.methods)[0].toUpperCase() + ' ' + l.route.path).sort();
    assert.deepStrictEqual(routed, Object.keys(contract.ROUTES).sort());
    assert.strictEqual(routed.length, 9);
    assert.ok(router.stack.every((l) => l.route), 'no router.use');
  });
  await t('5 the migration keeps its promises in words: two walls, no DELETE grant, a guard trigger, safe to repeat, a roll back and an all-true check', async () => {
    assert.ok(/app\.current_actor/.test(sql) && /FORCE ROW LEVEL SECURITY/.test(sql));
    assert.ok(/GRANT SELECT, INSERT, UPDATE ON private_flag TO cb_app/.test(sql) && !/GRANT[^;]*DELETE[^;]*private_flag/.test(sql.replace(/--.*$/gm, '')));
    assert.ok(/DROP POLICY IF EXISTS private_flag_read/.test(sql) && /CREATE TABLE IF NOT EXISTS/.test(sql) && /ROLL BACK/.test(sql) && /CHECK \(read-only, all-true/.test(sql));
    assert.ok(/state <> 'removed' OR \(note IS NULL/.test(sql), 'a removed row has no words');
  });
  await t('6 not migrated: every call answers 503 FLAGS_NOT_MIGRATED in words, never a 500', async () => {
    const schema = require(path.join(API, 'lib', 'schema.js'));
    const original = schema.hasTable;
    schema.hasTable = async () => false;
    try {
      for (const call of [() => flags.counts({}), () => flags.listOpen({}, {}), () => flags.add({}, {}), () => flags.remove({}, '1')]) {
        await call().then(() => assert.fail('answered'), (e) => { assert.strictEqual(e.code, 'FLAGS_NOT_MIGRATED'); assert.strictEqual(e.status, 503); assert.ok(e.words); });
      }
    } finally { schema.hasTable = original; }
  });
  await t('7 a key or a missing identity has no right: 404, never a 500', async () => {
    const rights = await flags.rightsOf({ api_key: { key_id: 'k' }, identity: { identity_id: 'x' } });
    assert.strictEqual(flags.mayUse(rights), false);
    assert.strictEqual(flags.mayUse(await flags.rightsOf({})), false);
  });
  await t('8 every refusal code the lib and router raise is a row of docs/ERROR-CODES.md', async () => {
    const table = fs.readFileSync(path.join(API, 'docs', 'ERROR-CODES.md'), 'utf8');
    const raised = new Set();
    for (const file of ['lib/private-flag.js', 'routes/flags.js']) for (const m of fs.readFileSync(path.join(API, file), 'utf8').matchAll(/'((?:FLAG|FLAGS|SIGN_IN_FOR_FLAGS)[A-Z_]*)'/g)) raised.add(m[1]);
    assert.ok(raised.size >= 15, 'found ' + raised.size);
    for (const code of raised) assert.ok(table.includes('| ' + code + ' |'), code + ' is not registered');
  });
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
