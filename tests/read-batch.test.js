/* readBatch's inliner: every literal shape it accepts, and the two things it must refuse. Pure — no database. */
const assert = require('assert');
const db = require('../db');
let n = 0, f = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { f++; console.log('FAIL', name, e.message); } };

t('strings, numbers, arrays, null are inlined as Postgres literals', () => {
  const sql = db.inlineSql("SELECT * FROM t WHERE a = $1 AND b = $2 AND c = ANY($3) AND d = $4 AND e = $5", ["it's", 5, ['x', 'y'], null, true]);
  assert.strictEqual(sql, "SELECT * FROM t WHERE a = 'it''s' AND b = 5 AND c = ANY(ARRAY['x','y']) AND d = NULL AND e = TRUE");
});
t('a backslash string takes the E form', () => {
  assert.ok(/E'/.test(db.inlineSql('SELECT $1', ['a\\b'])));
});
t('a second statement in one entry is refused', () => {
  assert.throws(() => db.inlineSql('SELECT 1; DROP TABLE x', []), /one statement/);
});
t('a semicolon INSIDE a literal is fine', () => {
  assert.doesNotThrow(() => db.inlineSql('SELECT $1', ['a; b']));
});
t('an object or a missing value is refused before any SQL is built', () => {
  assert.throws(() => db.inlineSql('SELECT $1', [{}]), /unsupported/);
  assert.throws(() => db.inlineSql('SELECT $2', ['a']), /no value/);
  assert.throws(() => db.inlineSql('SELECT $1', [NaN]), /non-finite/);
});
t('$10 is not read as $1 followed by 0', () => {
  const params = []; for (let i = 0; i < 10; i++) params.push('v' + (i + 1));
  assert.strictEqual(db.inlineSql('SELECT $10, $1', params), "SELECT 'v10', 'v1'");
});
console.log(`read-batch: ${n} passed, ${f} failed`); process.exit(f ? 1 : 0);
