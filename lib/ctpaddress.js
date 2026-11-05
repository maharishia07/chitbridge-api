'use strict';
// OWNS      where an entity or an address lives (local or which installation) · parse/format of bridge_id@domain · the shared-link reader (fromShared) · the peer lookup both CTP doors ask
// FLOW      entity id or address → installation (memoised topology, ops.f_installation_of) → { local, installation_key, endpoint, why }      CARD 05-ctp-and-cross-installation/discovery-well-known-ctp-json-address-bridge-id
/* ⭐ Every kind of id, its shape and which of them may be sent to: docs/NAMESPACE.md, with the
   machine-checked table in docs/namespace.yaml (guard: tests/namespace.test.cjs). */
// OWNS      where an entity is hosted: the remote installation set (memoised) and resolve / resolveAll → { local, resolved, endpoint }
// FLOW      lib/mint.deliver → resolveAll → installation table (remote set) → ops.f_installation_of per entity → an address
// CARD      05-ctp-and-cross-installation/where-an-installation-runs
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
 * An unreadable installation table, a missing b257, a database blip — all answer `local` WHILE NOTHING IS KNOWN TO BE
 * REMOTE. That is today's behaviour, so a failure here can never turn a working delivery into a lost one.
 * ⚠️ RAIL-142 (a): ONCE SOMETHING IS REMOTE, "LOCAL" ON A FAILURE IS A LOST COPY. A local copy of a remote party's chit
 * is written here, the sender is told delivered, and the owner never gets it — the core principle broken by the guard
 * meant to protect delivery, and the only trace was a console.warn. So: once any read has found something remote, a
 * failed topology read or stamp read answers `resolved: false` (logged) — never the last set read, which after a lift
 * back home would send a local party's copy away; mint.deliver then refuses the whole chit (CTP_UNRESOLVABLE) before any write. [[feedback-silence-is-the-bug]]
 */

const { query } = require('../db');
const log = require('./logger');

/* installations change about never; this is read once a minute at most. */
const TTL_MS = 60 * 1000;
let memo = { at: 0, remote: null }; /* remote: Map<installation_key, {endpoint, region, population_hint}> */
/* RAIL-142 (a): has any read of this process ever found an installation hosted elsewhere? Survives invalidate(). */
let everRemote = false;
/* the answer to a failed read once something has been remote: nobody can be placed, so nobody is guessed */
const UNKNOWN = Object.assign(new Map([['?', null]]), { unknown: true });

/**
 * The set of installations NOT hosted here. Empty is the normal answer and the fast path.
 * @returns {Promise<Map<string, {endpoint: string}>>}
 */
async function remoteInstallations(fresh) {
  if (!fresh && memo.remote && Date.now() - memo.at < TTL_MS) return memo.remote;
  const lookup = new Map();
  try {
    /* RAIL-142 (b): EVERY row, whatever its active flag. Filtering on active made a switched-off remote installation
       vanish, and its parties then resolved "hosted here"; and with no list of known keys, a typo in a stamp did too. */
    const r = await query(`SELECT installation_key, ctp_endpoint, region, active, hosted_locally, domain, label FROM installation`);
    lookup.known = new Set(r.rows.map((row) => row.installation_key));
    for (const row of r.rows) {
      if (row.hosted_locally === true) continue;
      /* domain and label ride along for the network search and the member view (NET-39 / RAIL-96): where a party is, in words */
      lookup.set(row.installation_key, { endpoint: row.ctp_endpoint, region: row.region, active: row.active !== false, domain: row.domain || null, label: row.label || null });
    }
    memo = { at: Date.now(), remote: lookup };
    everRemote = everRemote || lookup.size > 0;
  } catch (e) {
    /* 42703 = b257 not run. Not an error: before b257 nothing could be remote, which is exactly this answer.
       ⚠️ NOT cached — a blip must not freeze "everything is local" for a minute once something is not. */
    if (e.code !== '42703' && e.code !== '42P01') {
      /* RAIL-142 (a): once anything has been remote, a failed read places NOBODY. "Nothing is remote" would write a
         remote party's copy here; the last set read would, after a lift back home, send a local party's copy away. */
      log.fellBack('ctpaddress: the installation table could not be read' + (everRemote ? ' — nobody is placed until it can be' : ' — nothing has been remote, so all local'), e);
      return everRemote ? UNKNOWN : lookup;
    }
    memo = { at: Date.now(), remote: lookup };
  }
  return lookup;
}

/** drop the memo — call after changing where an installation runs, or a lift is invisible for a minute. */
function invalidate() {
  memo = { at: 0, remote: null };
}

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
    return { entity_id, local: true, installation_key: null, endpoint: null, why: 'no installation is hosted elsewhere' };
  }
  if (remote.unknown) return { entity_id, local: true, resolved: false, installation_key: null, endpoint: null, why: 'could not resolve — not delivered' };
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
    if (!key) return { entity_id, local: true, installation_key: null, endpoint: null, why: 'not stamped — the deployment default, which is here' };
    return placeStamp(entity_id, key, remote);
  } catch (e) {
    /* ⚠️ entity_governance is FORCE RLS and this runs with no tenant context — which is CORRECT here, because
       the question is about the platform's topology and not about anybody's rows. The policy permits it or it
       does not; if it does not, the answer is local and the reason says so rather than a silent zero.
       [[feedback-state-rls-status]] */
    /* RAIL-142 (a): remote installations ARE known here, so "here" would be a guess — say it was not resolved */
    log.fellBack('ctpaddress: where an entity is hosted could not be read', e);
    return { entity_id, local: true, resolved: false, installation_key: null, endpoint: null, why: 'could not resolve — not delivered' };
  }
}

/**
 * Where a stamped entity lives, from the topology set. RAIL-142 (b): a switched-off remote installation and a
 * stamp that names no installation at all are NOT "here" — they are unresolved, so mint refuses rather than
 * writing a remote party's copy into this database. Our own key is here even without a row (does every
 * deployment hold one? laptop1 is asking; RAIL-142 g owns the platform-0 default).
 */
function placeStamp(entity_id, key, remote) {
  const far = remote.get(key);
  /* ⚠️ INACTIVE remote rows are still REMOTE (SIT run 4, RAIL-112): dropping them made a suspended installation's party look local and its chit stayed
     here. local:false keeps it on the away side, and inactive:true lets lib/mint sendAway refuse it in words (CTP_PEER_INACTIVE) before any write. */
  if (far && !far.active) return { entity_id, local: false, inactive: true, installation_key: key, endpoint: null, why: 'installation ' + key + ' is not active here (suspended or retired), so nothing can be sent to it' };
  if (far) return { entity_id, local: false, installation_key: key, endpoint: far.endpoint, why: 'installation ' + key + ' is hosted at ' + far.endpoint };
  const ownKey = process.env.INSTALLATION_KEY || 'platform-0';
  if (key !== ownKey && remote.known && !remote.known.has(key)) {
    log.fellBack('ctpaddress: a party is stamped on installation ' + key + ', which has no row here', null);
    return { entity_id, local: true, resolved: false, installation_key: key, endpoint: null, why: 'that party is stamped on an installation this one does not know — not delivered' };
  }
  return { entity_id, local: true, installation_key: key, endpoint: null, why: 'installation ' + key + ' is hosted here' };
}

/** Resolve many at once, preserving the fast path. */
async function resolveAll(entity_ids) {
  const out = new Map();
  const remote = await remoteInstallations();
  if (!remote.size) {
    for (const id of entity_ids) {
      out.set(String(id), { entity_id: id, local: true, installation_key: null, endpoint: null, why: 'no installation is hosted elsewhere' });
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

/* RAIL-140 (f): the name, bare or qualified, is 3–64 of [A-Za-z0-9._~-]. It is NOT held to generateBridgeId's form
   (CB + 8 of lib/bridgeid CHARS): seeded shops (CBCUST0001) and ctpquery's placeholder (CB00000000) are not. */
const NAME_RE = /^[A-Za-z0-9._~-]{3,64}$/;
/* a domain is dot-separated labels (letters, digits, inner hyphens), with an optional port 1–65535 for a loopback test */
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const PORT_RE = /^[1-9]\d{0,4}$/;
const NOT_AN_ADDRESS = 'not a valid address — expected name@domain';

const refused = (sentence) => ({ ok: false, why: sentence, bridge_id: null, domain: null, qualified: false });

/** The domain half, lowercased, one trailing dot dropped — or null when it is not a host[:port]. */
function cleanDomain(text) {
  const [host, port, extra] = text.toLowerCase().split(':');
  if (extra !== undefined) return null;
  if (port !== undefined && !(PORT_RE.test(port) && Number(port) <= 65535)) return null;
  const bare = host.endsWith('.') ? host.slice(0, -1) : host;
  if (!bare || bare.length > 253 || !bare.split('.').every((label) => LABEL_RE.test(label))) return null;
  return port === undefined ? bare : bare + ':' + port;
}

/**
 * Split `name@domain` into its parts. A bare name is LOCAL by definition — it is our own namespace.
 * @returns {{bridge_id: string, domain: ?string, qualified: boolean, ok: boolean, why: string}}
 */
function parse(address) {
  /* RAIL-140 (f): String() made an object "[object Object]" and a one-item array its item */
  if (address != null && typeof address !== 'string') return refused('an address must be text');
  const text = (address || '').trim();
  if (!text) return refused('empty address');
  const parts = text.split('@');
  if (parts.length === 1) {
    /* ⚠️ a bare name is ours. That is a decision, not an assumption: a name with no namespace can only mean
       the namespace you are standing in, which is how every mail system and every filesystem behaves. */
    if (!NAME_RE.test(text)) return refused('not a valid name — letters, digits and . _ ~ - only');
    return { ok: true, why: 'unqualified — this installation’s own namespace', bridge_id: text, domain: null, qualified: false };
  }
  const domain = parts.length === 2 && NAME_RE.test(parts[0]) ? cleanDomain(parts[1]) : null;
  if (!domain) return refused(NOT_AN_ADDRESS);
  return { ok: true, why: 'qualified', bridge_id: parts[0], domain, qualified: true };
}

/**
 * RAIL-101: what a person PASTES or SCANS for a business — a typed `bridge_id@domain`, or a shared link on that business's own domain
 * (`https://<domain>/shop.html?s=<handle>` · `?bridge=<id>` · `/shop/<handle>`, the links the app builds and the QR on a bill carries).
 * → { ok, bridge_id (the handle or id), domain (null = a bare id: LOCAL only), why }. One parser for every way in; the domain is never typed
 * by hand once a link or QR is used, and a bare id is accepted only as a local one (parse() above says the same).
 */
function fromShared(input) {
  const typed = String(input == null ? '' : input).trim();
  if (/^https?:\/\//i.test(typed)) {
    let link;
    try {
      link = new URL(typed);
    } catch (e) {
      log.fellBack('ctpaddress fromShared: the link did not parse', e);
      return { ok: false, bridge_id: null, domain: null, why: 'not a link we can read' };
    }
    const fromPath = (/^\/(?:shop|b)\/([^/]+)/.exec(link.pathname) || [])[1] || '';
    const handle = (link.searchParams.get('s') || link.searchParams.get('bridge') || '').trim() || fromPath;
    if (!handle) return { ok: false, bridge_id: null, domain: null, why: 'that link does not name a business' };
    return { ok: true, bridge_id: decodeURIComponent(handle), domain: link.host.toLowerCase(), why: 'a link on ' + link.host.toLowerCase() };
  }
  const parsed = parse(typed);
  return { ok: parsed.ok, bridge_id: parsed.bridge_id, domain: parsed.domain, why: parsed.why };
}

/** Render one. ⚠️ A local party has NO domain here — adding ours would assert a name other installations use. */
function format(bridge_id, domain) {
  return domain ? String(bridge_id) + '@' + String(domain).toLowerCase() : String(bridge_id);
}

/** the answer for an address that does not resolve: where it lives is unknown, and `why` says so in a fixed sentence (RAIL-140 (e) · Q19: the typed text is not echoed) */
function notResolved(local, address, sentence) {
  return { local, ok: false, why: sentence, bridge_id: address.bridge_id, domain: address.domain, endpoint: null, installation_key: null, entity_id: null };
}

/* a bare bridge id that resolveAddress cannot place: local, not ok, in a fixed sentence */
const bareRefusal = (parsed, sentence) => notResolved(true, { bridge_id: parsed.bridge_id, domain: null }, sentence);

/** an unqualified address is our own namespace: find the row, then ask the usual question about its installation */
async function resolveOwnNamespace(parsedAddress) {
  try {
    const found = await query(
      `SELECT identity_id FROM identities
        WHERE bridge_id = $1 AND identity_type = 'entity' AND coalesce(status,'active') = 'active'`,
      [parsedAddress.bridge_id]
    );
    if (!found.rows[0]) return bareRefusal(parsedAddress, 'no active business here has that bridge id'); /* RAIL-140 (e) · Q19: the typed id is not echoed */
    const byEntity = await resolve(found.rows[0].identity_id);
    return Object.assign({ ok: true, bridge_id: parsedAddress.bridge_id, domain: null }, byEntity);
  } catch (e) {
    log.fellBack('ctpaddress resolveAddress: the business could not be looked up', e); /* RAIL-140 (e): the code stays here */
    return bareRefusal(parsedAddress, 'that address could not be looked up just now');
  }
}

/**
 * The installation that answers for a domain: { peer } (null when none could be read) — or { conflict: 'words' } when two ACTIVE rows claim it. A domain can outlive an installation (a VM re-used,
 * a member re-joined): the retired row stays, inactive, beside the live one, so the ACTIVE row answers; two active rows for one domain is a conflict we refuse rather than guess (SIT run 4).
 */
async function installationForDomain(domain) {
  try {
    const rows = (await query(
      `SELECT installation_key, ctp_endpoint, hosted_locally, active FROM installation
        WHERE lower(domain) = $1
        ORDER BY active DESC, installation_key LIMIT 2`, /* RAIL-140 (g): no unique index on domain, so two rows answer the same way every time; the second row only tells two ACTIVE rows apart */
      [domain]
    )).rows;
    if (rows[0] && rows[0].active && rows[1] && rows[1].active) {
      return { conflict: 'two installations here claim ' + domain + ' (' + rows[0].installation_key + ', ' + rows[1].installation_key + '); ask the operator to retire one' };
    }
    return { peer: rows[0] || null };
  } catch (e) {
    log.fellBack('ctpaddress resolveAddress: the read failed — answered with nothing', e);
    return { peer: null };
  }
}

/**
 * Resolve an ADDRESS (rather than an entity id) to where it lives.
 *
 * ⭐ This is the entry point a composer should use for a counterparty that may not exist here: a remote party
 * has no row in this database at all, so there is no entity id to resolve. The address is all there is.
 *
 * ⚠️⚠️ A QUALIFIED ADDRESS IS NEVER RESOLVED LOCALLY, EVEN IF THAT BRIDGE ID EXISTS HERE. That is the whole
 * collision answer: `CBAAAAAAAA@ae.example` means the one in the Emirates, and if we happen to hold a
 * `CBAAAAAAAA` of our own, reading the address as ours would deliver a stranger's chit into our books — and
 * silently, because both rows are perfectly valid.
 *
 * @returns {{local, bridge_id, domain, endpoint, installation_key, entity_id, why}}
 */
async function resolveAddress(address) {
  const parsedAddress = parse(address);
  if (!parsedAddress.ok) return notResolved(false, { bridge_id: null, domain: null }, parsedAddress.why);
  if (!parsedAddress.qualified) return resolveOwnNamespace(parsedAddress);
  const found = await installationForDomain(parsedAddress.domain);
  if (found.conflict) return notResolved(false, parsedAddress, found.conflict);
  const peer = found.peer;
  if (!peer || !peer.active) return notResolved(false, parsedAddress, 'no installation we deal with answers for that domain'); /* RAIL-140 (e) · Q19 */
  /* ⭐ the domain names an installation hosted HERE — so the address is ours after all, and the bridge id is
     in our namespace. This is the case that makes `@ourdomain` harmless rather than a second way in. */
  if (peer.hosted_locally) return ownDomainAnswer(parsedAddress, peer);
  return {
    local: false,
    ok: true,
    bridge_id: parsedAddress.bridge_id,
    domain: parsedAddress.domain,
    endpoint: peer.ctp_endpoint,
    installation_key: peer.installation_key,
    entity_id: null,
    why: parsedAddress.bridge_id + ' is at ' + peer.installation_key + ' (' + parsedAddress.domain + ')'
  };
}

/**
 * An address at a domain hosted HERE. RAIL-142 (e): this database may host more than one installation, so the
 * business must be stamped on the installation THAT domain names — CB…@mx.example resolved a shop stamped on
 * platform-0 and wrote its copy as if it were Mexico's. An unstamped shop is on our own key. One read, and only
 * for a qualified address at a hosted domain; a read that fails refuses (never a guess).
 */
async function ownDomainAnswer(parsed, peer) {
  const bare = await resolveAddress(parsed.bridge_id);
  if (!bare.ok || !bare.entity_id) return Object.assign(bare, { domain: parsed.domain });
  let stamped = null;
  try {
    const stamp = await query('SELECT ops.f_installation_of($1) AS installation_key', [bare.entity_id]);
    stamped = (stamp.rows[0] && stamp.rows[0].installation_key) || process.env.INSTALLATION_KEY || 'platform-0';
  } catch (e) {
    log.fellBack('ctpaddress resolveAddress: the stamp of a business at a hosted domain could not be read', e);
    return bareRefusal(parsed, 'that address could not be looked up just now');
  }
  if (stamped !== peer.installation_key) return Object.assign(bareRefusal(parsed, 'that business is not on the installation that domain names'), { domain: parsed.domain });
  /* RAIL-140 (g): the domain the address named stays on the answer (the bare answer carries domain: null) */
  return Object.assign({ ok: true, bridge_id: parsed.bridge_id }, bare, { domain: parsed.domain });
}

/**
 * ⭐⭐ "IS HE A MEMBER OF ME" — the ONE peer lookup both CTP doors ask (round T2-SPLIT, 2026-10-14).
 *
 * POST /api/ctp/deliver and POST /api/ctp/query each read the caller's `installation` row by key and refused the same
 * three ways, written out twice in routes/ctp.js. Discovery is open; DELIVERY (and a question) is not: a stranger can
 * read our manifest and still be refused here, because being findable and being dealt with are different things.
 *
 *   peerByKey(ik, localWhy) → { peer } | { peer: null, status, why }
 *     403  not in `installation`, or not active (an unreadable table answers the same — never "allowed")
 *     409  hosted HERE — `localWhy` says what to do instead (each door has its own words)
 *     403  no domain recorded, so its key cannot be fetched from its own domain
 */
async function peerByKey(ik, localWhy) {
  let peer = null;
  try {
    const r = await query(`SELECT installation_key, domain, hosted_locally, active FROM installation WHERE installation_key = $1`, [ik]);
    peer = r.rows[0] || null;
  } catch (e) {
    /* the door still refuses (a stranger); the log says it was the table, not the caller */
    require('./logger').warn('ctp.peer-unreadable', { installation_key: ik, code: e && e.code, err: e && e.message });
    peer = null;
  }
  if (!peer || !peer.active) return { peer: null, status: 403, why: 'installation ' + ik + ' is not one we deal with' };
  if (peer.hosted_locally) return { peer: null, status: 409, why: 'installation ' + ik + ' is hosted here — ' + localWhy };
  if (!peer.domain) return { peer: null, status: 403, why: 'no domain recorded for ' + ik + ', so its key cannot be found' };
  return { peer };
}

module.exports = { resolve, resolveAll, remoteInstallations, invalidate, parse, fromShared, format, resolveAddress, peerByKey };
