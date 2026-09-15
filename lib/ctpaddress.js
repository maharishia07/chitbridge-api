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

/**
 * ── ⭐⭐⭐ `bridge_id@domain` — THE ADDRESS, AND WHY A BARE BRIDGE ID IS NOT ONE ──────────────────────────────────
 *
 * Athi, 2026-09-15, proposing the test that found this: *"create two shops identical in two different domain…
 * ALPHA-TIMERS and Alpha Timers, one is in IN and another in Arab region… try and force the bridge id also same?
 * then what will happen?"*
 *
 * ⚠️⚠️ THE COLLISION IS NOT THE PROBLEM. In ONE database `bridge_id` is UNIQUE, so two identical shops cannot
 * coexist here at all. Across two installations they are two rows in two databases and a collision is not only
 * possible, it is EXPECTED — eight random characters, minted independently, forever.
 *
 * ⭐ SO THE BRIDGE ID IS A LOCAL NAME, exactly like a population code (§7.1) and exactly like a mailbox name.
 * `CBAAAAAAAA@in.example` and `CBAAAAAAAA@ae.example` are two different businesses and always were; what was
 * missing is that nothing said so. A bare `CBAAAAAAAA` arriving from outside is ambiguous, and resolving it
 * locally would hand somebody else's chit to whoever holds that id HERE.
 *
 * ⚠️ AND THIS IS WHY WE DO NOT FORCE GLOBAL UNIQUENESS. Making bridge ids unique across every installation in
 * the world needs one allocator that everybody asks — which is the central registry the DNS design exists to
 * avoid. Qualifying the name costs nothing and keeps the namespace where it belongs: with the installation that
 * minted it. [[project-user-id-rule]]
 *
 * ⚠️ `identity_id` IS NEVER AN ADDRESS. It is a uuid and it is internal; accepting one from a caller is how an
 * internal key becomes an address, and it is already refused everywhere else in CTP.
 */

/* a bridge id is CB + 8 of [A-Z0-9]; a domain is a host, optionally with a port for a loopback test */
const ADDRESS_RE = /^([A-Za-z0-9._~-]{3,64})@([A-Za-z0-9.-]+(?::\d{2,5})?)$/;

/**
 * Split `name@domain` into its parts. A bare name is LOCAL by definition — it is our own namespace.
 * @returns {{bridge_id: string, domain: ?string, qualified: boolean, ok: boolean, why: string}}
 */
function parse(address) {
  const s = String(address == null ? '' : address).trim();
  if (!s) return { ok: false, why: 'empty address', bridge_id: null, domain: null, qualified: false };
  if (s.indexOf('@') < 0) {
    /* ⚠️ a bare name is ours. That is a decision, not an assumption: a name with no namespace can only mean
       the namespace you are standing in, which is how every mail system and every filesystem behaves. */
    return { ok: true, why: 'unqualified — this installation’s own namespace',
             bridge_id: s, domain: null, qualified: false };
  }
  const m = ADDRESS_RE.exec(s);
  if (!m) return { ok: false, why: 'not a valid address — expected name@domain',
                   bridge_id: null, domain: null, qualified: false };
  return { ok: true, why: 'qualified', bridge_id: m[1], domain: m[2].toLowerCase(), qualified: true };
}

/** Render one. ⚠️ A local party has NO domain here — adding ours would assert a name other installations use. */
function format(bridge_id, domain) {
  return domain ? String(bridge_id) + '@' + String(domain).toLowerCase() : String(bridge_id);
}

/**
 * Resolve an ADDRESS (rather than an entity id) to where it lives.
 *
 * ⭐ This is the entry point a composer should use for a counterparty that may not exist here: a remote party
 * has no row in this database at all, so there is no entity id to resolve. The address is all there is.
 *
 * @returns {{local, bridge_id, domain, endpoint, installation_key, entity_id, why}}
 */
async function resolveAddress(address) {
  const a = parse(address);
  if (!a.ok) return { local: false, ok: false, why: a.why, bridge_id: null, domain: null,
                      endpoint: null, installation_key: null, entity_id: null };

  if (!a.qualified) {
    /* our own namespace: find the row, and then ask the usual question about its installation */
    try {
      const r = await query(
        `SELECT identity_id FROM identities
          WHERE bridge_id = $1 AND identity_type = 'entity' AND coalesce(status,'active') = 'active'`,
        [a.bridge_id]);
      if (!r.rows[0]) {
        return { local: true, ok: false, why: 'no active business here called ' + a.bridge_id,
                 bridge_id: a.bridge_id, domain: null, endpoint: null, installation_key: null, entity_id: null };
      }
      const byEntity = await resolve(r.rows[0].identity_id);
      return Object.assign({ ok: true, bridge_id: a.bridge_id, domain: null }, byEntity);
    } catch (e) {
      return { local: true, ok: false, why: 'could not resolve ' + a.bridge_id + ': ' + (e.code || e.message),
               bridge_id: a.bridge_id, domain: null, endpoint: null, installation_key: null, entity_id: null };
    }
  }

  /**
   * ⚠️⚠️ A QUALIFIED ADDRESS IS NEVER RESOLVED LOCALLY, EVEN IF THAT BRIDGE ID EXISTS HERE. That is the whole
   * collision answer: `CBAAAAAAAA@ae.example` means the one in the Emirates, and if we happen to hold a
   * `CBAAAAAAAA` of our own, reading the address as ours would deliver a stranger's chit into our books — and
   * silently, because both rows are perfectly valid.
   */
  let peer = null;
  try {
    const r = await query(
      `SELECT installation_key, ctp_endpoint, hosted_locally, active FROM installation
        WHERE lower(domain) = $1`, [a.domain]);
    peer = r.rows[0] || null;
  } catch (_) { peer = null; }

  if (!peer || !peer.active) {
    return { local: false, ok: false, bridge_id: a.bridge_id, domain: a.domain,
             endpoint: null, installation_key: null, entity_id: null,
             why: 'no installation we deal with answers for ' + a.domain };
  }
  if (peer.hosted_locally) {
    /* ⭐ the domain names an installation hosted HERE — so the address is ours after all, and the bridge id is
       in our namespace. This is the case that makes `@ourdomain` harmless rather than a second way in. */
    return Object.assign({ ok: true, bridge_id: a.bridge_id, domain: a.domain },
      await resolveAddress(a.bridge_id));
  }
  return { local: false, ok: true, bridge_id: a.bridge_id, domain: a.domain,
           endpoint: peer.ctp_endpoint, installation_key: peer.installation_key, entity_id: null,
           why: a.bridge_id + ' is at ' + peer.installation_key + ' (' + a.domain + ')' };
}

module.exports = { resolve, resolveAll, remoteInstallations, invalidate, parse, format, resolveAddress };
