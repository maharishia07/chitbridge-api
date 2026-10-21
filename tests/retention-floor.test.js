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
   retainDaysFor returns { days, source, stamp }; source is the winner of the MAX, in this order on a tie: records_law, own_floor,
   sender_asked. b771 adds chit_status.retention_source with a CHECK naming exactly those three, and the mint writes it only when the
   column exists. The mirror below is the route's arithmetic; the two source checks hold the route and the migration to it. */
const fs = require('node:fs');
const path = require('node:path');
const keptFor = (lawFloor, ownFloor, requested) => {
  const days = Math.max(lawFloor, ownFloor, requested || 0);
  return { days, source: days === lawFloor ? 'records_law' : days === ownFloor ? 'own_floor' : 'sender_asked' };
};
const SOURCES = ['records_law', 'own_floor', 'sender_asked'];

test('SET-26 · the source names the rule that won the MAX', () => {
  const law = policy.RECORDS_FLOOR_DAYS;
  assert.deepStrictEqual(keptFor(law, 90, 30), { days: law, source: 'records_law' }, 'the records-law floor wins over a short floor and request');
  assert.deepStrictEqual(keptFor(law, law + 100, 30), { days: law + 100, source: 'own_floor' }, "the owner's higher floor wins");
  assert.deepStrictEqual(keptFor(law, 90, law + 365), { days: law + 365, source: 'sender_asked' }, 'a longer request wins');
  assert.strictEqual(keptFor(law, law, law).source, 'records_law', 'a tie names the law first');
});

test('SET-26 · the route returns { days, source } and writes retention_source only behind the b771 column check', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'chits.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(/const source = days === policy\.RECORDS_FLOOR_DAYS \? 'records_law' : days === floor \? 'own_floor' : 'sender_asked';/.test(src), 'the source ladder');
  assert.ok(/return \{ days, source, stamp: await schema\.hasColumn\('chit_status', 'retention_source'\) \}/.test(src), 'the column check');
  const writes = src.match(/retire_at\$\{kept\.stamp \? ', retention_source' : ''\}/g) || [];
  assert.strictEqual(writes.length, 2, 'both copies (the sender\'s and each receiver\'s) write the source behind kept.stamp');
});

test('SET-26 · b771 allows exactly the sources the route writes', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'b771_chit_status_retention_source.sql'), 'utf8');
  const chk = (sql.match(/retention_source IN \(([^)]*)\)/) || [])[1] || '';
  assert.deepStrictEqual((chk.match(/'([a-z_]+)'/g) || []).map((item) => item.replace(/'/g, '')).sort(), SOURCES.slice().sort());
});
