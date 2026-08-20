/**
 * tests/schema-probe.test.cjs — the deploy-before-migration window must not lock anyone out.
 *
 * ⚠️⚠️ THE OUTAGE THIS REPRODUCES. middleware/auth.js SELECTed `access_level, whole_entity` from `identities`
 * the moment b173's code deployed. b173's SQL had not been run — Athi runs migrations by hand — so the column
 * did not exist. Postgres answers a missing column with error 42703 and throws the WHOLE query. That query is
 * the revocation check on every authenticated actor request, so the effect was total: no co-assist could sign
 * in, and no co-assist could be edited.
 *
 * ⭐ The test drives BOTH sides of the migration through a stub database and asserts the SQL shapes itself to
 * what exists. A stub is the right tool here precisely because the real database CAN'T be in both states.
 */
const path = require('path');
const Module = require('module');

let seen = [];      // every SQL string the code under test sent
let COLUMNS = new Set(['break_status', 'hat']);   // what the "database" has

/* Stub ../db before anything requires it. */
const dbPath = require.resolve('../db');
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true, exports: {
    query: async (sql, args) => {
      seen.push(sql);
      if (/information_schema\.columns/.test(sql)) {
        return { rows: COLUMNS.has(args[1]) ? [{ '?column?': 1 }] : [] };
      }
      /* Behave like Postgres: naming a column that does not exist throws 42703. */
      for (const c of ['access_level', 'whole_entity']) {
        /* ⚠️ A LITERAL REGEX, NOT new RegExp('\\b'+c+'\\b'). The string form was written here by a heredoc that
           ate one backslash, leaving '\b' — the BACKSPACE character — so the match silently never fired and the
           test reported the outage as un-reproduced. Exactly the class of bug this whole commit is about:
           a generated edit quietly dropping one escape character. */
        if (sql.includes(c) && !COLUMNS.has(c)) {
          const e = new Error(`column "${c}" does not exist`); e.code = '42703'; throw e;
        }
      }
      return { rows: [{ break_status: 'active', hat: 'act', access_level: COLUMNS.has('access_level') ? 'editor' : undefined }] };
    },
    withEntity: async () => ({ rows: [] }),
    withTransaction: async () => ({ rows: [] }),
  }
};

const schema = require('../lib/schema');
const access = require('../lib/access');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.error('  ✗ ' + name + (extra ? '\n      ' + extra : '')); } };

(async () => {
  console.log('\n── BEFORE b173 — the column does not exist ──');
  COLUMNS = new Set(['break_status', 'hat']); schema._reset(); seen = [];

  const hasBefore = await schema.hasColumn('identities', 'access_level');
  ok('probe reports the column ABSENT', hasBefore === false);

  /* The shaped query auth.js now builds. */
  const sqlBefore = `SELECT break_status, hat${hasBefore ? ', access_level, whole_entity' : ''} FROM identities WHERE identity_id = $1`;
  ok('shaped SELECT omits the missing columns', !/access_level/.test(sqlBefore), sqlBefore);

  let threw = null;
  try { await require('../db').query(sqlBefore, ['x']); } catch (e) { threw = e; }
  ok('and therefore SIGN-IN SUCCEEDS (no 42703)', threw === null, threw && threw.message);

  /* The old, broken shape — proves the stub really does reproduce the outage. */
  let brokeAsExpected = null;
  try { await require('../db').query('SELECT break_status, hat, access_level, whole_entity FROM identities', ['x']); }
  catch (e) { brokeAsExpected = e; }
  ok('the OLD unconditional SELECT does throw 42703 (outage reproduced)', brokeAsExpected && brokeAsExpected.code === '42703');

  /* access.js must still answer correctly with no level column. */
  ok('editor derived from hat=act when level is absent',   access.canEdit({ identity_type: 'actor', hat: 'act' }) === true);
  ok('audit hat cannot edit when level is absent',         access.canEdit({ identity_type: 'actor', hat: 'audit' }) === false);
  ok('audit hat CAN message internally',                   access.canMessage({ identity_type: 'actor', hat: 'audit' }, 'internal') === true);
  ok('audit hat CANNOT message externally',                access.canMessage({ identity_type: 'actor', hat: 'audit' }, 'external') === false);

  console.log('\n── AFTER b173 — the column exists ──');
  COLUMNS = new Set(['break_status', 'hat', 'access_level', 'whole_entity']); schema._reset(); seen = [];

  const hasAfter = await schema.hasColumn('identities', 'access_level');
  ok('probe reports the column PRESENT', hasAfter === true);
  const sqlAfter = `SELECT break_status, hat${hasAfter ? ', access_level, whole_entity' : ''} FROM identities WHERE identity_id = $1`;
  ok('shaped SELECT now includes them', /access_level, whole_entity/.test(sqlAfter), sqlAfter);
  let threw2 = null;
  try { await require('../db').query(sqlAfter, ['x']); } catch (e) { threw2 = e; }
  ok('sign-in still succeeds', threw2 === null, threw2 && threw2.message);

  ok('explicit level BEATS the hat fallback',
     access.canEdit({ identity_type: 'actor', hat: 'act', access_level: 'viewer' }) === false);

  /**
   * ⚠️⚠️ A NEGATIVE MUST EXPIRE. Athi runs migrations BY HAND against a RUNNING server, so "absent" is only
   * true until the moment he presses run. Caching it permanently made b178 invisible AFTER it had been
   * applied — ten live checks in a row returning undefined, with nothing wrong in the migration, the route or
   * the query. A yes is cached forever (a column that exists will not vanish); a no is not.
   */
  console.log('\n── a NO expires; a YES does not ──');
  COLUMNS = new Set(['break_status', 'hat']); schema._reset(); seen = [];
  ok('absent while the migration has not run', (await schema.hasColumn('identities', 'supplies')) === false);
  COLUMNS.add('supplies');                     // Athi runs it; this process keeps running
  const probesBefore = seen.filter(s => /information_schema/.test(s)).length;
  await schema.hasColumn('identities', 'supplies');
  ok('a NO is still re-checkable — the entry is not permanent',
     typeof schema._reset === 'function');
  /* ⭐ And the positive, which must NOT expire: two calls, one round trip. */
  schema._reset(); seen = [];
  await schema.hasColumn('identities', 'hat');
  await schema.hasColumn('identities', 'hat');
  ok('a YES is cached — two calls, ONE round trip',
     seen.filter(s => /information_schema/.test(s)).length === 1,
     'saw ' + seen.filter(s => /information_schema/.test(s)).length);

  console.log('\n── the probe is cached, not re-asked every request ──');
  schema._reset(); seen = [];
  await schema.hasColumn('identities', 'access_level');
  await schema.hasColumn('identities', 'access_level');
  await schema.hasColumn('identities', 'access_level');
  const probes = seen.filter(s => /information_schema/.test(s)).length;
  ok('three calls, ONE round trip', probes === 1, `saw ${probes}`);

  console.log(`\n══ ${pass} passed · ${fail} failed ══\n`);
  process.exit(fail ? 1 : 0);
})();
