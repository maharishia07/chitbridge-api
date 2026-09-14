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

let known = null;          /* null = not asked yet · true/false = the answer */
let asking = null;         /* the in-flight probe, so twenty concurrent requests ask once */

/** true once b246 has run. ⚠️ Never throws — an unreachable database answers "not yet", which is the safe side. */
async function ready() {
  if (known !== null) return known;
  if (!asking) {
    asking = query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = 'public' AND table_name = 'identities'
                         AND column_name = 'is_test') AS ok`)
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
function atRegistration(email, hasColumn) {
  const isFixture = require('./entitykind').atRegistration(email) === 'test';
  if (!hasColumn) return { entity_kind: isFixture ? 'test' : 'customer', is_test: null };
  return { entity_kind: 'customer', is_test: isFixture };
}

module.exports = { ready, where, atRegistration };
