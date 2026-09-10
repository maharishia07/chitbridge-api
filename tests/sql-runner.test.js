/**
 * ── tests/sql-runner.test.js · THE ONE THING scripts/sql.cjs MUST NEVER GET WRONG ─────────────────────────────
 *
 * It is a tool that runs SQL against production, so its only real promise is that the line saying **WITH RLS** or
 * **WITHOUT RLS** is true. Everything else it does is convenience; that one line is what somebody will trust when
 * deciding whether a mistake would be caught.
 *
 * ⚠️ IT IS TESTED WITHOUT A DATABASE, on purpose — these are assertions about the script's own reasoning, and a
 * guard that needed the network would be skipped in exactly the runs where it matters. What cannot be checked
 * here (that the entity actually survives the pooler) was proven live and is written down in the commit.
 */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'sql.cjs');
const SRC = fs.readFileSync(SCRIPT, 'utf8');
let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); }
                           catch (e) { console.log('  FAIL ' + what + '\n       ' + e.message); process.exitCode = 1; } };

/** run it and capture what it said, whichever stream it used and whatever it exited with */
function run(args) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [SCRIPT].concat(args),
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { DATABASE_URL: '' }) }) };
  } catch (e) {
    return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}

console.log('— it refuses before it connects —');

it('⭐⭐ it will not run until you say WHICH SIDE OF RLS', () => {
  const r = run(['-e', 'SELECT 1', '--write']);
  assert.notStrictEqual(r.code, 0, 'it ran without being told which side of RLS');
  assert.ok(/which side of RLS/i.test(r.out), 'got: ' + r.out.trim());
  assert.ok(/--entity/.test(r.out) && /--as-owner/.test(r.out), 'the refusal must name both ways out');
});

it('⚠️ and it will not accept both answers at once', () => {
  const r = run(['-e', 'SELECT 1', '--entity', 'x', '--as-owner']);
  assert.notStrictEqual(r.code, 0);
  assert.ok(/opposite answers/i.test(r.out), 'got: ' + r.out.trim());
});

it('⚠️⚠️ a file that DROPs is refused BEFORE a connection is opened', () => {
  const r = run(['-e', 'DROP TABLE reward_ledger', '--as-owner', '--write']);
  assert.strictEqual(r.code, 5, 'a destructive statement was not refused with the destructive exit code');
  assert.ok(/--i-mean-it/.test(r.out), 'the refusal must say how to proceed deliberately');
  /* ⭐ THE REAL ASSERTION: it never reached the database. If the check moved below connect(), a DROP aimed at
     production would be stopped only after the door was already open — and on a machine with a working
     DATABASE_URL that is a very different risk. */
  assert.ok(!/could not connect|DATABASE_URL/.test(r.out),
    'the destructive check ran AFTER the connection was attempted — move it above connect()');
});

it('⚠️ TRUNCATE and DELETE FROM are refused the same way', () => {
  for (const stmt of ['TRUNCATE reward_ledger', 'DELETE FROM reward_ledger WHERE 1=1'])
    assert.strictEqual(run(['-e', stmt, '--as-owner', '--write']).code, 5, stmt + ' was not refused');
});

console.log('— what it must never claim —');

it('⭐⭐⭐ the RLS line is derived from the DATABASE, never from the flag', () => {
  /**
   * ⚠️ THE BUG THIS EXISTS FOR. --as-owner first printed "WITHOUT RLS" because the flag was passed. Railway's
   * DATABASE_URL is cb_app — NOSUPERUSER, NOBYPASSRLS — so that was a lie, and it was a lie in the one direction
   * that matters: it told somebody their mistake would NOT be caught when in fact it would, which is the way
   * round that makes people stop trusting the tool.
   */
  const owner = SRC.slice(SRC.indexOf('} else if (OWNER) {'), SRC.indexOf('no third case'));
  assert.ok(/rls = bypasses \?/.test(owner),
    'the WITHOUT RLS claim must be conditional on what the database answered (bypasses), not on the flag');
  assert.ok(!/rls = 'WITHOUT RLS';/.test(owner),
    '--as-owner asserts WITHOUT RLS unconditionally again — it means "do not switch role", not "outside RLS"');
});

it('⭐⭐ the role and the entity ride in the SAME query as the file (the pooler cannot split them)', () => {
  assert.ok(/prelude = "SET ROLE cb_app; SELECT set_config\('app\.current_entity'/.test(SRC),
    'the prelude must be built as text to prepend');
  assert.ok(/c\.query\(prelude \+ sql\)/.test(SRC),
    'the prelude must be sent WITH the file. Separate round trips are not safe over a transaction pooler: '
    + 'PgBouncer may hand the next statement to a backend that never saw the SET ROLE.');
});

it('⚠️ the entity is validated as a uuid, because it is inlined rather than bound', () => {
  assert.ok(/\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}/.test(SRC),
    'an inlined value that is not shape-checked is an injection; refuse anything that is not a uuid');
});

it('⭐ the quiet failure — RLS on with no entity — is announced, not discovered', () => {
  assert.ok(/NO entity is set/.test(SRC) && /NOT "there is no data"/.test(SRC),
    'cb_app with no app.current_entity returns zero rows and refuses writes. That looks exactly like an empty '
    + 'shop, so the header has to say it before the result appears.');
});

console.log('— the default —');

it('⭐⭐ it looks, unless told to write', () => {
  assert.ok(/if \(!WRITE\) \{/.test(SRC), 'the no-write branch must exist');
  assert.ok(SRC.indexOf('LOOKED ONLY') > 0, 'and it must say plainly that nothing ran');
  /* ⚠️ a tool whose SAFE mode needs a flag is a tool that will one day be run without it */
  assert.ok(/const WRITE = has\('--write'\)/.test(SRC), 'writing must be opt-in, never the default');
});

it('⚠️ and it says what it cannot promise about a file that COMMITs on its own', () => {
  assert.ok(/COMMITs on its own/.test(SRC), 'a self-committing file cannot be rolled back and must say so');
  assert.ok(/may not survive that COMMIT/.test(SRC),
    'over a pooler such a file can also lose the entity after its COMMIT — that has to be said too');
});

console.log(pass + ' checks');
