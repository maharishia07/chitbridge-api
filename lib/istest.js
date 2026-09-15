'use strict';
/**
 * ── ⭐⭐ "DOES THIS ENTITY COUNT?" — the axis, and whether the database has it yet ────────────────────────────
 *
 * Athi, 2026-09-14: *"do we have a mechanism of marking an entity as Test? … a human tester wants to test the
 * feature in the real system, he can create a test entity and test it, and it should not mix it up with
 * production at all"* — and then the sentence that settled the design: *"so we may create one for goods,
 * services, network etc."*
 *
 * ⚠️ THAT SENTENCE IS IMPOSSIBLE WHILE `test` IS A VALUE OF entity_kind. A test network would have to stop
 * being a network. b246 splits it into two columns — entity_kind says WHAT it is, is_test says WHETHER IT
 * COUNTS — and this module is how code asks the second question without caring which state the schema is in.
 *
 * ── ⚠️ WHY THE PROBE, AND WHY ONCE ─────────────────────────────────────────────────────────────────────────
 *
 * Deploys are automatic on push; migrations are run by hand. So there is always a window where the code is
 * ahead of the database, and a route that SELECTs a column that is not there does not degrade — it throws, and
 * the whole screen 500s. `to_regclass`-style probes return null instead of raising, which is the only safe way
 * to ask. Cached because the answer changes at most once in the life of a process, and a probe per request on
 * a 2,500-row report is a round trip spent on a question already answered. [[project-round-trip-cost]]
 */

const { query } = require('../db');

/**
 * ⚠️⚠️ ONLY THE `true` IS CACHED, AND THAT ASYMMETRY IS THE POINT.
 *
 * I first cached both answers, reasoning that the schema changes at most once in the life of a process. It
 * does — but the process does not restart when it changes. Athi runs a migration by hand against a running
 * API, so a cached "no" would have survived b246 and the screen would have gone on using the old partition
 * until the next unrelated deploy happened to restart the dyno. It only worked this time by luck of ordering.
 *
 * ⭐ A column cannot be dropped by a migration in this codebase, so `true` is permanent and safe to keep.
 * `false` is a temporary state, so it is re-asked — one extra round trip per request, only while the migration
 * is outstanding, which is exactly when being right matters more than being fast.
 */
let known = false;         /* false = not seen yet (re-ask) · true = the column exists (permanent) */
let asking = null;         /* the in-flight probe, so twenty concurrent requests ask once */

/** true once b246 has run. ⚠️ Never throws — an unreachable database answers "not yet", which is the safe side. */
async function ready() {
  if (known) return true;
  if (!asking) {
    asking = query(
      /* ⚠⚠ ASK ABOUT THE COLUMN WE WRITE. This probed `is_test`, which b249 turned into a GENERATED column —
         so it kept answering “yes, you may write it” about a column nothing may write. A readiness probe must
         name the thing it is making ready. */
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = 'public' AND table_name = 'identities'
                         AND column_name = 'population') AS ok`)
      .then((r) => { known = r.rows[0].ok === true; return known; })
      .catch(() => false)
      .finally(() => { asking = null; });
  }
  return asking;
}

/**
 * The SQL predicate for one population, for a query that aliases identities as `i`.
 *
 * ⭐ BEFORE b246 it falls back to the old partition, so the screen keeps working and keeps meaning the same
 * thing. After it, the same call means the same thing and reads the right column.
 */
/** ⚠️ READING is_test is fine and stays — a generated column reads like any other. Only writing it is refused. */
function where(population, hasColumn) {
  const test = population === 'test';
  if (hasColumn) return test ? 'AND i.is_test' : 'AND NOT i.is_test';
  return test ? "AND i.entity_kind = 'test'" : "AND i.entity_kind <> 'test'";
}

/**
 * ⚠️⚠️ AND THE REGISTRATION DOOR, WHICH IS WHERE THE DRIFT WOULD HAVE COME BACK.
 *
 * b246 empties `entity_kind = 'test'`. If registration went on writing it, the partition would refill from the
 * very next e2e run and the axis would be wrong within a day — the bug fixed in the morning and reintroduced
 * by the afternoon, by code nobody thought to look at.
 *
 * ⭐ So a fixture registration is a CUSTOMER that is a TEST, which is what it always actually was.
 * ⚠️ The email detector stays as a BACKSTOP, not as the mechanism: it is how an unattended e2e run marks
 * itself. A human tester marks their own account deliberately, which no domain list can do for them.
 */
/**
 * ── ⚠⚠⚠ SIGN-UP WAS BROKEN FOR A DAY BY THIS FUNCTION ──────────────────────────────────
 *
 * b249 replaced `is_test` with a GENERATED ALWAYS column — `(population <> 'live')` — and said so in its own
 * comment: *"Never written — set `population`."* This function went on returning `is_test`, ready() went on
 * answering true (a generated column satisfies an information_schema probe exactly like a real one), and the
 * INSERT in routes/entities.js went on naming the column. Postgres refuses that:
 *
 *     428C9  cannot insert a non-DEFAULT value into column "is_test"
 *
 * ⚠️ EVERY REGISTRATION, not just a fixture one — `is_test: isFixture` is a boolean either way, so the column
 * was always named. Proven against production in a rolled-back transaction before this was written.
 *
 * ⭐ SO IT ANSWERS A POPULATION NOW, and null means “say nothing, let the DEFAULT and b248's inheritance
 * trigger decide” — which is the right answer for an ordinary sign-up and the only safe one for a child mint.
 */
function atRegistration(email, hasPopulation) {
  const isFixture = require('./entitykind').atRegistration(email) === 'test';
  /* before b249 there was no population column and the axis lived in entity_kind */
  if (!hasPopulation) return { entity_kind: isFixture ? 'test' : 'customer', population: null };
  /* ⚠️ null, not 'live': the DEFAULT already says live, and naming it would override b248's inheritance for
     anything minted with a parent. Say only what is not already true. */
  return { entity_kind: 'customer', population: isFixture ? 'test' : null };
}

module.exports = { ready, where, atRegistration };
