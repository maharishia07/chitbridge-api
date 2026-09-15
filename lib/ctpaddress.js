'use strict';
// @stage poc
// @stage-note CTP step 2 (docs/CTP-DESIGN.md §11). The address seam, with every address local and no wire behind
//             it. Called by lib/mint.deliver on every delivery; the remote branch cannot be reached until an
//             installation says hosted_locally = false, which nothing does yet.
// @stage-why  A seam that is not called is a seam that has already drifted. This one is on the live path from
//             the day it exists, answering "local" — which is the only way to know it costs nothing.
/**
 * ── ⭐⭐⭐ WHERE DOES THIS ENTITY LIVE? ──────────────────────────────────────────────────────────────────────────
 *
 * Athi, 2026-09-15: *"how do we cross within same engine or maybe a different installation altogether including
 * infra and IP?"* — docs/CTP-DESIGN.md answers it; this is the first step of building it.
 *
 * ⭐ ONE PLACE ADDRESSING LIVES. Today every answer is `local` and `mint.deliver` behaves exactly as it always
 * has. The point of building it now is that the alternative — adding addressing later, at the same time as a
 * wire, a signature and a queue — is how three hard things get debugged as one.
 *
 * ── ⚠️⚠️ AND IT COSTS NOTHING WHILE NOTHING IS REMOTE ───────────────────────────────────────────────────────────
 *
 * Athi asked directly: *"does it look for each transfer?"* It must not, and it does not.
 *
 * The resolver first asks ONE memoised question — *is any installation hosted elsewhere?* While the answer is
 * no, which is today and will be true of most deployments forever, every address is local by construction and
 * **not a single per-entity query is issued**. The cost of the seam on the common path is one Map lookup.
 *
 * ⚠️ Only when some installation IS remote does it pay for a per-entity lookup, and then only to decide routing
 * for a delivery that is about to cross a border anyway.
 *
 * ── ⚠️ IT FAILS LOCAL, DELIBERATELY ─────────────────────────────────────────────────────────────────────────────
 *
 * An unreadable installation table, a missing b257, a database blip — all answer `local`. That is today's
 * behaviour, so a failure here can never turn a working delivery into a lost one. ⚠️ But `why` always says which
 * answer it gave and on what grounds, so a wrong local is visible rather than assumed.
 * [[feedback-silence-is-the-bug]]
 */

const { query } = require('../db');

/* installations change about never; this is read once a minute at most. */
const TTL_MS = 60 * 1000;
let memo = { at: 0, remote: null };   /* remote: Map<installation_key, {endpoint, region, population_hint}> */

/**
 * The set of installations NOT hosted here. Empty is the normal answer and the fast path.
 * @returns {Promise<Map<string, {endpoint: string}>>}
 */
async function remoteInstallations(fresh) {
  if (!fresh && memo.remote && (Date.now() - memo.at) < TTL_MS) return memo.remote;
  let m = new Map();
  try {
    const r = await query(
      `SELECT installation_key, ctp_endpoint, region FROM installation
        WHERE active AND hosted_locally = false`);
    for (const row of r.rows) {
      m.set(row.installation_key, { endpoint: row.ctp_endpoint, region: row.region });
    }
    memo = { at: Date.now(), remote: m };
  } catch (e) {
    /* 42703 = b257 not run. Not an error: before b257 nothing could be remote, which is exactly this answer.
       ⚠️ NOT cached — a blip must not freeze "everything is local" for a minute once something is not. */
    if (e.code !== '42703' && e.code !== '42P01') {
      console.warn('[ctpaddress] could not read installations, treating all as local:', e.code || '', e.message);
      return m;
    }
    memo = { at: Date.now(), remote: m };
  }
  return m;
}

/** drop the memo — call after changing where an installation runs, or a lift is invisible for a minute. */
function invalidate() { memo = { at: 0, remote: null }; }

/**
 * Resolve one entity to an address.
 *
 * @param entity_id
 * @returns {Promise<{entity_id, local: boolean, installation_key: ?string, endpoint: ?string, why: string}>}
 *          ⚠️ never throws — see the header. `local: true` is the safe answer and the current one.
 */
async function resolve(entity_id) {
  const remote = await remoteInstallations();
  if (!remote.size) {
    /* ⭐ THE FAST PATH, and the only one taken today: nothing is hosted elsewhere, so nothing can be remote.
       No per-entity query, no join, no cost. */
    return { entity_id, local: true, installation_key: null, endpoint: null,
             why: 'no installation is hosted elsewhere' };
  }
  try {
    /**
     * ⚠️⚠️ THROUGH A SECURITY DEFINER FUNCTION, NOT A PLAIN READ. `entity_governance` is FORCE ROW LEVEL
     * SECURITY and this asks about the RECIPIENT — somebody else's row. A plain read answers NOTHING, which
     * this function would take as "not stamped, so local", and a remote party's copy would be written into
     * this database. It does not error and it looks exactly like the right answer for the 2,485 entities that
     * genuinely have no stamp. Caught by tests/rls-context.test.cjs. [[feedback-silence-is-the-bug]]
     */
    const r = await query('SELECT ops.f_installation_of($1) AS installation_key', [entity_id]);
    /* ⚠️ unstamped means the deployment default, which is here. b254's trigger stamps new entities; everything
       older has no row and has always resolved to platform-0 by fallback. */
    const key = r.rows[0] && r.rows[0].installation_key;
    if (!key) return { entity_id, local: true, installation_key: null, endpoint: null,
                       why: 'not stamped — the deployment default, which is here' };
    const far = remote.get(key);
    if (!far) return { entity_id, local: true, installation_key: key, endpoint: null,
                       why: 'installation ' + key + ' is hosted here' };
    return { entity_id, local: false, installation_key: key, endpoint: far.endpoint,
             why: 'installation ' + key + ' is hosted at ' + far.endpoint };
  } catch (e) {
    /* ⚠️ entity_governance is FORCE RLS and this runs with no tenant context — which is CORRECT here, because
       the question is about the platform's topology and not about anybody's rows. The policy permits it or it
       does not; if it does not, the answer is local and the reason says so rather than a silent zero.
       [[feedback-state-rls-status]] */
    return { entity_id, local: true, installation_key: null, endpoint: null,
             why: 'could not resolve (' + (e.code || e.message) + ') — treated as here' };
  }
}

/** Resolve many at once, preserving the fast path. */
async function resolveAll(entity_ids) {
  const out = new Map();
  const remote = await remoteInstallations();
  if (!remote.size) {
    for (const id of entity_ids) {
      out.set(String(id), { entity_id: id, local: true, installation_key: null, endpoint: null,
                            why: 'no installation is hosted elsewhere' });
    }
    return out;
  }
  for (const id of entity_ids) out.set(String(id), await resolve(id));
  return out;
}

module.exports = { resolve, resolveAll, remoteInstallations, invalidate };
