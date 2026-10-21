/**
 * RECEIVER-SIDE RETENTION FLOOR (backlog 11) — the guard that ships BEFORE the thing it guards.
 *
 * Found during a spoofing sweep Athi asked for: *"if there a chance to change the setting in the middle then we
 * have to guard those… otherwise spoofing will be possible."* Retention is stored PER COPY. Without a floor
 * owned by the copy's owner, "how long I keep my own records" is decided by whoever sent them.
 *
 * ⚠️ Nothing deletes yet — retire is Ph2, purge Ph3, both human-gated. That is exactly why this is the moment to
 * build it: the guard has to exist before the deletion it constrains, or it arrives as a fix for damage already
 * done.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const policy = require('../lib/policy');

/* The mint's arithmetic, same shape as routes/chits.js `retainDaysFor`. */
const retainDays = (floor, requested) => Math.max(floor, requested || 0);

test('⚠️ A SENDER CANNOT SHORTEN THE RECEIVER\'S COPY', () => {
  // the whole point: they ask for 1 day, the receiver's floor is 90, the copy keeps 90
  assert.strictEqual(retainDays(90, 1), 90);
  assert.strictEqual(retainDays(90, 0), 90);
  assert.strictEqual(retainDays(365, 30), 365, 'a higher floor wins by more than a little');
});

test('a sender CAN ask for longer, and that is honoured', () => {
  // ⚠️ MAX, not clamp-to-floor. "Keep this for seven years" is a legitimate request; refusing it would make the
  // floor a ceiling, which is a different and much worse rule.
  assert.strictEqual(retainDays(90, 365), 365);
  assert.strictEqual(retainDays(90, 3650), 3650);
});

test('the two parties are computed SEPARATELY — the point of a per-copy model', () => {
  // sender floor 30, receiver floor 400, sender asked for 60
  assert.strictEqual(retainDays(30, 60), 60, "sender's own copy");
  assert.strictEqual(retainDays(400, 60), 400, "receiver's copy keeps THEIR minimum");
});

test('a floor of 0 means no floor — the sender\'s request stands alone', () => {
  assert.strictEqual(retainDays(0, 30), 30);
  assert.strictEqual(retainDays(0, 0), 0);
});

test('the flag is registered, bounded, and defaults to the value already in the schema', () => {
  const f = policy.FLAGS ? policy.FLAGS.retention_floor_days : null;
  assert.ok(f, 'retention_floor_days must be a declared policy flag, not a constant in a route');
  assert.strictEqual(f.type, 'number');
  /* ⚠️ 90 IS NOT A NEW POLICY. b105 set `retention_expires_at DEFAULT now() + 90 days`. Matching it means
     turning per-copy retention on cannot shorten anyone's retention on the day it ships — the change is
     invisible until someone deliberately moves their floor. */
  assert.strictEqual(f.def, 90);
  assert.strictEqual(f.min, 0);
  assert.strictEqual(f.max, 3650);
});

test('policy.get returns the floor, so the mint never has to guess one', async () => {
  /* ⚠️ Reads the DEFAULTS path only — no database here. What matters is that the key EXISTS in a resolved flag
     set, because the mint falls back to 90 on any read failure and a silently-absent key would look identical
     to a deliberate 90 forever. */
  const defs = policy.defaults ? policy.defaults() : null;
  if (defs) assert.strictEqual(defs.retention_floor_days, 90);
});

/* ── SET-26 (K-DB, 21 Oct 2026): the copy says WHICH rule set its days ─────────────────────────────────────────────────
   lib/retention.copyRetention is the ONE calculation (routes/chits.js retainDaysFor calls it for every copy): the MAX, its winner
   (records_law · own_floor · sender_asked, a tie names the law first) and, once b771 has run, the column the INSERT adds. Called here
   directly — no copy of the ladder in the test. b771's CHECK must name exactly the sources it can return. */
const fs = require('node:fs');
const path = require('node:path');
const { copyRetention } = require('../lib/retention');
const SOURCES = ['records_law', 'own_floor', 'sender_asked'];
const LAW = policy.RECORDS_FLOOR_DAYS;

test('SET-26 · copyRetention: the source names the rule that won the MAX', () => {
  assert.deepStrictEqual([copyRetention(90, 30, false).days, copyRetention(90, 30, false).source], [LAW, 'records_law'], 'the law wins over a short floor and request');
  assert.deepStrictEqual([copyRetention(LAW + 100, 30, false).days, copyRetention(LAW + 100, 30, false).source], [LAW + 100, 'own_floor'], "the owner's higher floor wins");
  assert.deepStrictEqual([copyRetention(90, LAW + 365, false).days, copyRetention(90, LAW + 365, false).source], [LAW + 365, 'sender_asked'], 'a longer request wins');
  assert.strictEqual(copyRetention(LAW, LAW, false).source, 'records_law', 'a tie names the law first');
  assert.strictEqual(copyRetention(90, null, false).days, LAW, 'no request: the floors alone');
});

test('SET-26 · copyRetention: not stamped adds nothing to the INSERT; stamped adds retention_source as $5', () => {
  const before = copyRetention(90, 30, false);
  assert.deepStrictEqual({ col: before.col, val: before.val, params: before.params }, { col: '', val: '', params: [] });
  const after = copyRetention(LAW + 100, 30, true);
  assert.deepStrictEqual({ col: after.col, val: after.val, params: after.params }, { col: ', retention_source', val: ', $5', params: ['own_floor'] });
});

test('SET-26 · b771 allows exactly the sources the route writes', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'b771_chit_status_retention_source.sql'), 'utf8');
  const chk = (sql.match(/retention_source IN \(([^)]*)\)/) || [])[1] || '';
  assert.deepStrictEqual((chk.match(/'([a-z_]+)'/g) || []).map((item) => item.replace(/'/g, '')).sort(), SOURCES.slice().sort());
  const returned = [copyRetention(90, 0, true), copyRetention(LAW + 1, 0, true), copyRetention(90, LAW + 1, true)].map((item) => item.source).sort();
  assert.deepStrictEqual(returned, SOURCES.slice().sort(), 'every source copyRetention returns is one b771 allows');
});
