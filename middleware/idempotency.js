// middleware/idempotency.js — server-side idempotency for the offline OUTBOX (Phase 2). A mutation carrying an
// `Idempotency-Key` header is executed AT MOST ONCE per (entity, key): the first request runs and its response is
// recorded; any REPLAY with the same key returns the recorded response WITHOUT re-executing — so an outbox replay on
// reconnect can never mint a second chit / form / credential. Concurrent in-flight duplicate → 409; same key reused with
// a DIFFERENT body → 422. Opt-in (no header ⇒ untouched) and SELF-HEALING (store missing ⇒ the request still runs)
// so it is safe to deploy before b109 is run. Scoped per entity, WITH RLS (via withEntity).
//
// owns: the Idempotency-Key contract (idempotency_key table, b109) and the in-process memory that stands in when the store is off.
// called by: server.js (app.use('/api', …) after auth-then-parse, before the routers); lib/autoraise sends the header.
// FLOW  key? → scopeOf(token) → fingerprint(body) → store.begin → { existing → answerExisting | claimed → capture res.json → next → store.finalize }
//       store off (table missing · store error · body unfingerprintable) → the SAME flow on memoryStore, every answer marked X-Idempotency: unverified
// // CARD 28-platform-and-operations/idempotency
//
// ⭐ LIM2 (W1-PLAT, 15 Oct): WHEN IDEMPOTENCY IS OFF, A RETRY WARNS AND IS REFUSED. Before, three silent paths ran a retried
// mutation A SECOND TIME with no trace: an unreadable token (`catch (_) { return null }`), a body the canon could not
// fingerprint (`catch (_) { return next() }`) and a store error (a bare line on stdout, then next()). Now every "off" path says so
// (lib/logger warn with the request id and the reason) and the request still runs — guarded by a bounded per-process memory
// keyed (entity, key): a retry gets the recorded answer (X-Idempotent-Replay: true) or 409 IDEMPOTENCY_IN_PROGRESS, never a
// second execution in this process. The answer carries `X-Idempotency: unverified` so the outbox knows the proof is not durable.
// ⚠️ The memory is per process: two api instances could each run a retry once. The store (b109) remains the real guard.
const crypto = require('crypto');
const { withEntity } = require('../db');
const log = require('../lib/logger');

const MUTATING = ['POST', 'PUT', 'PATCH', 'DELETE'];
const KEY_MAX_LENGTH = 200;
const DEFAULT_WINDOW_HOURS = 48;
/* L3 (PAY-FIX): a request that crashed mid-flight leaves its key 'in_progress'. A live request finishes in seconds, so
   after this many minutes the key is STALE and a retry may claim it — before, it blocked the retry for the whole window. */
const IN_PROGRESS_STALE_MINUTES = Number(process.env.IDEMPOTENCY_STALE_MINUTES || 10);
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 3600 * 1000;
const UNVERIFIED_MEMORY_MAX = 5000; /* entries the store-off memory keeps before the oldest is forgotten */
const STORE_MISSING_CODES = ['42P01', '42703']; /* table or column missing — pre-b109, expected rather than alarming */

/**
 * ⭐ ONE CANONICAL SERIALISATION (lib/canon.js, 2026-09-12). This was one of THREE copies — connectors.js and
 * canon-depth.test.js had the others, each carrying its own CANON_MAX_DEPTH = 256.
 *
 * ⚠️⚠️ THE OUTPUT IS UNCHANGED, AND THAT IS LOAD-BEARING RATHER THAN TIDY. This key IS the replay detector:
 * if its shape moves, a replayed mutation stops matching the one it should match and executes A SECOND TIME.
 * tests/canon.test.js proves byte-identity against this function AS IT WAS WRITTEN, over a corpus, rather
 * than trusting that the new one looks the same.
 */
const stable = (o) => require('../lib/canon').canon(o);

/** scope from the SAME bearer token auth uses (parent_entity_id || identity_id); { entity: null, why } ⇒ the route's auth refuses it */
function scopeOf(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return { entity: null, why: null }; /* no bearer: nothing to scope, auth answers */
  try {
    const claims = require('../lib/jwt-verify').verifyJwt(header.split(' ')[1]).claims; // E10 — the ONE verifier
    if (!claims.identity_id) return { entity: null, why: 'the token names no identity' };
    return { entity: claims.parent_entity_id || claims.identity_id, why: null };
  } catch (e) {
    return { entity: null, why: 'the token could not be read: ' + (e && e.message) };
  }
}
/** kept for the seam register and tests: the entity, or null */
const scope = (req) => scopeOf(req).entity;

/** the request's fingerprint (method · path · canonical body), or null when the body cannot be canonicalised (nesting too deep) */
function fingerprint(req) {
  try {
    return crypto
      .createHash('sha256')
      .update(req.method + ' ' + req.path + ' ' + stable(req.body || {}))
      .digest('hex');
  } catch (e) {
    log.warn('idempotency: the body could not be fingerprinted — the key is held without a body check', { id: req.id, path: req.path, err: e && e.message });
    return null;
  }
}

/* ── the durable store: idempotency_key (b109), one row per (entity, key), inside the entity's RLS ── */
const dbStore = {
  async begin(entity, key, req, hash, windowHrs) {
    return withEntity(entity, async (db) => {
      const found = await db.query(
        `SELECT idem_key, req_hash, state, status, response,
                (created_at < now() - ($2 || ' hours')::interval
                 OR (state = 'in_progress' AND created_at < now() - ($4 || ' minutes')::interval)) AS expired
           FROM idempotency_key WHERE entity_id = $1 AND idem_key = $3`,
        [entity, String(windowHrs), key, String(IN_PROGRESS_STALE_MINUTES)]
      );
      if (found.rows[0] && !found.rows[0].expired) return { existing: found.rows[0] };
      if (found.rows[0]) await db.query(`DELETE FROM idempotency_key WHERE entity_id = $1 AND idem_key = $2`, [entity, key]); // expired → reclaim
      const claimed = await db.query(
        `INSERT INTO idempotency_key (entity_id, idem_key, method, path, req_hash, state)
         VALUES ($1,$2,$3,$4,$5,'in_progress') ON CONFLICT (entity_id, idem_key) DO NOTHING RETURNING idem_key`,
        [entity, key, req.method, req.path, hash]
      );
      if (claimed.rows[0]) return { claimed: true };
      const raced = await db.query(`SELECT idem_key, req_hash, state, status, response FROM idempotency_key WHERE entity_id = $1 AND idem_key = $2`, [
        entity,
        key
      ]);
      return { existing: raced.rows[0] }; // lost the insert race → treat as replay
    });
  },
  async finalize(entity, key, status, body) {
    return withEntity(entity, async (db) => {
      if (status >= 500) {
        // a server error is NOT a completed outcome — let a retry re-run it
        await db.query(`DELETE FROM idempotency_key WHERE entity_id = $1 AND idem_key = $2 AND state = 'in_progress'`, [entity, key]);
      } else {
        // 2xx/3xx/4xx are settled outcomes — record so replays are consistent
        await db.query(`UPDATE idempotency_key SET state = 'done', status = $3, response = $4::jsonb WHERE entity_id = $1 AND idem_key = $2`, [
          entity,
          key,
          status,
          JSON.stringify(body == null ? null : body)
        ]);
      }
    });
  }
};

/* ── the store-off memory: the same contract, per process, bounded, forgotten after the window ── */
const unverified = new Map(); /* (entity + '\n' + key) → { at, req_hash, state, status, response } */
const memoryStore = {
  async begin(entity, key, req, hash, windowHrs) {
    const memoryKey = entity + '\n' + key,
      held = unverified.get(memoryKey);
    const staleInProgress = held && held.state === 'in_progress' && Date.now() - held.at > IN_PROGRESS_STALE_MINUTES * MINUTE_MS;
    if (held && !staleInProgress && Date.now() - held.at <= windowHrs * HOUR_MS) return { existing: held };
    if (held) unverified.delete(memoryKey); // expired → reclaim
    if (unverified.size >= UNVERIFIED_MEMORY_MAX) unverified.delete(unverified.keys().next().value); // the oldest is forgotten
    unverified.set(memoryKey, { at: Date.now(), req_hash: hash, state: 'in_progress', status: null, response: null });
    return { claimed: true };
  },
  async finalize(entity, key, status, body) {
    const memoryKey = entity + '\n' + key,
      held = unverified.get(memoryKey);
    if (!held) return;
    if (status >= 500)
      unverified.delete(memoryKey); // not a completed outcome — a retry may run again
    else Object.assign(held, { state: 'done', status, response: body == null ? null : body });
  },
  size: () => unverified.size,
  clear: () => unverified.clear()
};

/** a key already held: the recorded answer (replay), a conflict (another body), or "still running" — never a second execution */
function answerExisting(res, held, hash, isVerified) {
  if (!isVerified) res.setHeader('X-Idempotency', 'unverified');
  if (held.req_hash && hash && held.req_hash !== hash) {
    return res
      .status(422)
      .json({ code: 'IDEMPOTENCY_CONFLICT', error: 'Idempotency conflict', message: 'This Idempotency-Key was already used with a different request.' });
  }
  if (held.state === 'done') {
    res.setHeader('X-Idempotent-Replay', 'true');
    return res.status(held.status || 200).json(held.response);
  }
  return res
    .status(409)
    .json({ code: 'IDEMPOTENCY_IN_PROGRESS', error: 'In progress', message: 'A request with this Idempotency-Key is still being processed.' });
}

/** we own the key: record the handler's JSON answer through the store it was claimed in, then run the route */
function runAndRecord(req, res, next, store, claim) {
  let captured = false;
  const origJson = res.json.bind(res);
  res.json = (body) => {
    if (!captured) {
      captured = true;
      store
        .finalize(claim.entity, claim.key, res.statusCode, body)
        .catch((e) => log.warn('idempotency: recording the answer failed — a replay may run again', { id: req.id, path: req.path, err: e && e.message }));
    }
    return origJson(body);
  };
  next();
}

/** the store is off for this request: say why (warn), mark the answer, and guard the key in memory instead */
function runUnverified(req, res, next, claim, why) {
  log.warn('idempotency: store off — the key is held in this process only (a retry is refused here, not proven)', {
    id: req.id,
    method: req.method,
    path: req.path,
    why
  });
  res.setHeader('X-Idempotency', 'unverified');
  return memoryStore
    .begin(claim.entity, claim.key, req, claim.hash, claim.windowHrs)
    .then((outcome) => (outcome.existing ? answerExisting(res, outcome.existing, claim.hash, false) : runAndRecord(req, res, next, memoryStore, claim)));
}

const storeWhy = (e) => (e && STORE_MISSING_CODES.includes(e.code) ? 'idempotency_key is not migrated (b109)' : 'store error: ' + (e && e.message));

module.exports = function idempotency(req, res, next) {
  const key = req.headers['idempotency-key'];
  if (!key || !MUTATING.includes(req.method) || String(key).length > KEY_MAX_LENGTH) return next();
  const scoped = scopeOf(req);
  if (!scoped.entity) {
    /* no usable token: the route's auth refuses the request, so nothing can post twice — but it is said */
    if (scoped.why)
      log.warn("idempotency: no scope for the key — the route's auth decides", { id: req.id, method: req.method, path: req.path, why: scoped.why });
    return next();
  }
  const claim = {
    entity: scoped.entity,
    key: String(key),
    hash: fingerprint(req),
    windowHrs: Number(process.env.IDEMPOTENCY_WINDOW_HOURS || DEFAULT_WINDOW_HOURS)
  };
  if (!claim.hash) return runUnverified(req, res, next, claim, 'the body could not be fingerprinted');

  dbStore
    .begin(claim.entity, claim.key, req, claim.hash, claim.windowHrs)
    .then((outcome) => (outcome.existing ? answerExisting(res, outcome.existing, claim.hash, true) : runAndRecord(req, res, next, dbStore, claim)))
    .catch((e) => runUnverified(req, res, next, claim, storeWhy(e)));
};

module.exports._stable = stable;
module.exports._scope = scope;
module.exports._memory = memoryStore;
module.exports.IN_PROGRESS_STALE_MINUTES = IN_PROGRESS_STALE_MINUTES;
module.exports.UNVERIFIED_MEMORY_MAX = UNVERIFIED_MEMORY_MAX;
