/**
 * tests/current-actor.test.cjs — the catalogue version history must know who made the change.
 *
 * Backlog: *"`app.current_actor` is set by nothing. b146 stamps `changed_by` from it, so the catalogue version
 * history has no author on any row."*
 *
 * ⚠️⚠️ THE HALF THAT EXISTED WAS NEVER BROKEN, WHICH IS WHY NOTHING REPORTED IT. b146's trigger reads
 * `NULLIF(current_setting('app.current_actor', true), '')`. The `true` means "do not error if unset", so an
 * unset value returns `''`, `NULLIF` turns it into NULL, the insert succeeds, and a version row is written
 * recording a change by nobody. Every layer behaved exactly as written.
 *
 * ⭐ A PROVENANCE COLUMN THAT IS ALWAYS NULL IS WORSE THAN NO COLUMN — the schema promises an answer the data
 * never had, and anyone reading it later concludes authorship was not captured rather than that it was lost.
 *
 * ⭐⭐ THIS TEST HOLDS BOTH ENDS TOGETHER. The setting is written in `db/index.js` and read in a SQL trigger;
 * nothing in either file names the other, so a rename on one side would leave the other silently writing NULL
 * again. The names are asserted at both ends here, in one place, on purpose.
 */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.error('  ✗ ' + name + (extra ? '   ' + extra : '')); }
};

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

/* ── the context itself, run for real ─────────────────────────────────────────────────────────────────── */
const { runWithActor, currentActor } = require('../lib/reqctx');

console.log('\n── the actor is carried across async boundaries ──');
t('no request, no actor', currentActor() === null);

(async () => {
  let inside = null, afterHop = null, nested = null;
  await new Promise((done) => {
    runWithActor('actor-123', async () => {
      inside = currentActor();
      await new Promise((r) => setTimeout(r, 5));
      /* ⚠️ THE HOP IS THE POINT. A request opens its transaction several awaits deep; a context that survives
         only the synchronous frame would be set for nobody who actually needs it. */
      afterHop = currentActor();
      /* ⚠️ AND NESTING MUST NOT BLEED — two requests in flight on one process is the ordinary case. */
      runWithActor('actor-999', () => { nested = currentActor(); });
      done();
    });
  });

  t('set for the request', inside === 'actor-123', String(inside));
  t('  …and still set after an await', afterHop === 'actor-123', String(afterHop));
  t('  …a nested scope wins inside itself', nested === 'actor-999', String(nested));
  t('  …and nothing leaks back out', currentActor() === null, String(currentActor()));

  /* ── written where every transaction will carry it ──────────────────────────────────────────────────── */
  console.log('\n── withEntity sets it, and does not pay a round trip for it ──');
  const db = read('db/index.js');
  t('withEntity sets app.current_actor', /set_config\('app\.current_actor'/.test(db));
  /**
   * ⚠️ ONE STATEMENT, NOT TWO. withEntity is already four round trips (BEGIN · set_config · query · COMMIT) and
   * that count is the reason onEntity exists. A second `await client.query` here would add a fifth to EVERY
   * transaction on the platform to carry one string.
   */
  const oneStatement = /set_config\('app\.current_entity'[^;]*set_config\('app\.current_actor'/.test(db);
  t('  …in the SAME statement as the entity', oneStatement);
  const setConfigAwaits = (db.match(/await client\.query\(\s*`?SELECT set_config/g) || []).length;
  t('  …so the transaction still opens with one set_config call', setConfigAwaits === 1,
    setConfigAwaits + ' set_config round trip(s)');
  /* ⚠️ SET LOCAL (the third argument) or it leaks to the next request off a pooled connection. */
  t('  …and it is transaction-scoped, not session-scoped',
    /set_config\('app\.current_actor', \$2, true\)/.test(db));

  /* ── established once, where the identity is built ──────────────────────────────────────────────────── */
  console.log('\n── auth establishes the scope, so no route has to opt in ──');
  const auth = read('middleware/auth.js');
  t('auth runs the request inside the actor scope', /runWithActor\(/.test(auth));
  /**
   * ⚠️⚠️ THE ACTOR IS `identity_id`, NOT `entityOf(req)`, and this is the one mistake worth a test of its own.
   * They differ exactly when it matters: a co-assist acts FOR its parent, so the entity is the business and the
   * actor is the person. `entityOf` here would write "the business changed it" into a column whose entire job
   * is to name someone — and it would look correct, because a valid uuid would appear in every row.
   */
  t('  …with the PERSON, not the business',
    /runWithActor\(req\.identity\.identity_id/.test(auth),
    /runWithActor\(\s*auth\.entityOf/.test(auth) ? 'it passes entityOf — that is the business' : '');

  /* ── and the far end still reads the same name ──────────────────────────────────────────────────────── */
  console.log('\n── the trigger reads what the transaction writes ──');
  const mig = read('migrations/b146_catalogue_item_version.sql');
  t('b146 still stamps changed_by from app.current_actor',
    /changed_by/.test(mig) && /current_setting\('app\.current_actor'/.test(mig));
  /**
   * ⚠️ THE `true` IS WHY THIS WAS SILENT. `current_setting(name, true)` means "missing is not an error" — it
   * returns '' rather than raising. Keep it: raising here would turn a missing author into a failed catalogue
   * write, which is a far worse trade. The fix is to SET the value, not to make its absence fatal.
   */
  t('  …and tolerates absence rather than failing a write',
    /current_setting\('app\.current_actor',\s*true\)/.test(mig));

  console.log('\n  ══ ' + pass + ' passed · ' + fail + ' failed ══\n');
  process.exit(fail ? 1 : 0);
})();
