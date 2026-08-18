// middleware/auth.js — JWT validation middleware
const jwt = require('jsonwebtoken');
const { query } = require('../db');

const auth = async (req, res, next) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Unauthorised',
        message: 'No token provided'
      });
    }

    const token = authHeader.split(' ')[1];

    // Verify token
    // Pin the algorithm: tokens are signed HS256, so only accept HS256 — closes any
    // algorithm-confusion ambiguity (e.g. a token claiming a different alg).
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });

    // S1 (reviewer 2026-07-13) — FAIL CLOSED on any token that is not a REAL identity. The signature being valid is not
    // enough: a non-identity token (e.g. a marketing `sim_lead` token that happened to be signed with JWT_SECRET) must NOT
    // be accepted as a platform credential. A token without an identity_id, or not of type entity/actor, is not a credential.
    if (!decoded.identity_id || !['entity', 'actor'].includes(decoded.identity_type)) {
      return res.status(401).json({ error: 'Unauthorised', message: 'Invalid token' });
    }

    // Attach identity to request
    req.identity = {
      identity_id:      decoded.identity_id,
      bridge_id:        decoded.bridge_id,
      display_name:     decoded.display_name,
      identity_type:    decoded.identity_type,
      email:            decoded.email,
      parent_entity_id: decoded.parent_entity_id || null,
      owner_scope:      decoded.owner_scope || null,
    };

    // Revalidate actor status — a removed/deactivated co-assist must lose access
    // immediately on their next request, not whenever the JWT happens to expire.
    // (Stateless JWTs can't be deleted server-side; this is the standard revocation.)
    if (decoded.identity_type === 'actor') {
      /**
       * ⚠️ THE HAT COMES FROM THE DATABASE, NEVER FROM THE TOKEN — and it rides on the query that was already
       * here, so it costs no extra round trip.
       *
       * A hat in the JWT would mean an owner demoting someone to view_only has NO EFFECT until that token
       * expires. The person keeps the access the owner just took away, for hours, with nothing to show it. That
       * is the same reasoning the break_status revocation below already rests on: a permission you cannot
       * withdraw immediately is not a permission you control.
       */
      const r = await query(
        `SELECT break_status, hat FROM identities
         WHERE identity_id = $1 AND identity_type = 'actor'`,
        [decoded.identity_id]
      );
      const status = r.rows[0]?.break_status;
      if (!r.rows.length || status === 'removed' || status === 'deactivated') {
        return res.status(401).json({
          error: 'Unauthorised',
          message: 'Your access has been revoked. Contact your admin.'
        });
      }
      /* Default 'act', matching what POST /actors writes when no hat is given — so an actor created before the
         column existed behaves exactly as it does today rather than being locked out by an absent value. */
      req.identity.hat = r.rows[0].hat || 'act';
    }

    /**
     * ⭐⭐ THE HAT GATE RUNS HERE, INSIDE auth, AND THAT PLACEMENT IS THE WHOLE DESIGN.
     *
     * ⚠️ I FIRST WROTE IT AS `app.use('/api', hatGate)` IN server.js AND IT WOULD HAVE DONE NOTHING. `auth` is
     * applied PER ROUTE — `router.post('/send', auth, …)` — not globally, so anything mounted at the app level
     * runs BEFORE it, sees no `req.identity`, and falls straight through. A permission gate that silently
     * permits everything is the exact defect it was written to close, reintroduced one layer up.
     *
     * ⭐ Here it is unmissable by construction: every protected route already calls auth, so every protected
     * route is gated, and a new route written next month is gated the moment it asks for authentication. There
     * is nothing to remember and nothing to opt into.
     *
     * ⚠️ AND IT FAILS CLOSED. Anything not on the self-scoped list in hat-gate.js is refused for a restricted
     * hat. A route I have not thought about REFUSES rather than permits — a loud, immediate, correctable
     * failure instead of a silent one. Failing open here costs a chit nobody meant to send.
     */
    const gate = require('./hat-gate');
    return gate(req, res, next);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Unauthorised',
        message: 'Token expired — please log in again'
      });
    }
    return res.status(401).json({
      error: 'Unauthorised',
      message: 'Invalid token'
    });
  }
};

module.exports = auth;

/**
 * entityOf(req) — WHOSE data is this request acting on.
 *
 * ⚠️ THE ANSWER IS NEVER "THE ACTOR". A co-assist acts FOR its entity, so everything it touches belongs to the
 * parent. Getting that backwards would give a co-assist its own private island of data inside a business — which
 * is why this one-liner is the difference between an actor being staff and an actor being a tenant.
 *
 * ⚠️ IT LIVES HERE BECAUSE THIS FILE BUILDS req.identity. The reader belongs with the writer. It had 47 copies —
 * as `entityId`, `ent`, `entity_id`, `owner`, `entity`, `sender` — and routes/chits.js already carried the note
 * "Single source of truth (was duplicated 26× ...)", which is the same fix made once, locally, in one file while
 * the other 46 carried on. Local single-sources-of-truth are how a codebase ends up with several.
 */
auth.entityOf = (req) => req.identity.parent_entity_id || req.identity.identity_id;

/**
 * ⚠️ requireAct / requireManager USED TO LIVE HERE and are gone deliberately.
 *
 * I wrote them, then wrote hat-gate.js, and for a few minutes the codebase had TWO mechanisms for one rule —
 * an opt-in helper nobody had called yet and a default-deny gate. That is the duplication this project keeps
 * paying for: two things that must agree, no mechanism to make them, and the one nobody remembered being the
 * one that mattered. The gate covers every authenticated write; a per-route helper would only ever cover the
 * routes someone remembered to decorate.
 *
 * ⭐ If a route ever needs MANAGER specifically (assigning others, standing in for the entity), add it to
 * hat-gate.js as a rule there — one file that answers "what may this hat do", not a second convention.
 */
