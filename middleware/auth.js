// middleware/auth.js — JWT validation middleware
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const schema = require('../lib/schema');   // b173 — ask the DB what it has before naming a column

const auth = async (req, res, next) => {
  try {
    // Get token from Authorization header
    /* ⭐ AN API KEY FOR ANOTHER SYSTEM travels as X-Api-Key or as a Bearer — same verification, then the listing check below */
    const authHeader = req.headers.authorization || (req.headers['x-api-key'] ? 'Bearer ' + String(req.headers['x-api-key']).trim() : '');
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
    /* ⚠️ A KEY IS ONLY AS ALIVE AS ITS LISTING (routes/keys.js): revoked = not in identities.policy_flags.api_keys, whatever
       the token's own expiry says. One read per request, cached a minute per jti. */
    if (decoded.kind === 'api_key') {
      const ok = await keyListed(decoded.identity_id, decoded.jti);
      if (!ok) return res.status(401).json({ error: 'Unauthorised', message: 'API key revoked or unknown' });
      req.api_key = { jti: decoded.jti, scopes: Array.isArray(decoded.scopes) ? decoded.scopes : [] };
      /* ⚠️ A KEY REACHES ONLY THE ROUTES ITS SCOPES NAME — never the session's whole surface */
      const url = String(req.originalUrl || req.url || '').split('?')[0], m = req.method;
      const allowed = req.api_key.scopes.some((sc) => (KEY_ROUTES[sc] || []).some(([meth, re]) => (meth === '*' || meth === m) && re.test(url)));
      if (!allowed) return res.status(403).json({ error: 'Forbidden', message: 'This key is not scoped for ' + m + ' ' + url });
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
      /**
       * ⚠️⚠️ THE COLUMN LIST IS BUILT FROM WHAT THE DATABASE ACTUALLY HAS. I previously named access_level and
       * whole_entity unconditionally and left a comment saying that was safe because they "can be undefined".
       * That is not how Postgres answers a missing column — it raises 42703 and THE WHOLE QUERY THROWS. This is
       * the revocation check every authenticated actor request runs, so the real effect was that NO CO-ASSIST
       * COULD SIGN IN until a hand-run migration landed. The comment described a JavaScript failure mode for a
       * SQL problem, and that gap is exactly what made it read as handled.
       */
      const lvlCols = await schema.hasColumn('identities', 'access_level');
      const r = await query(
        `SELECT break_status, hat${lvlCols ? ', access_level, whole_entity' : ''} FROM identities
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
      /**
       * ⭐⭐ THE SAME QUERY THAT ALREADY RAN FOR REVOCATION NOW CARRIES ACCESS. It reads the row on every
       * request to check break_status, so the level and the reach flag are free — no extra round trip in an
       * app whose main complaint is round trips.
       *
       * ⚠️ b173 MAY NOT BE APPLIED YET. Code deploys before Athi runs migrations, always. When the columns are
       * absent they are not SELECTed at all (see above), so they arrive here as undefined and lib/access.js
       * derives the level from the old `hat` — answering identically either side of the migration. Passing
       * undefined through is correct: it is what tells access.js to fall back.
       */
      req.identity.hat          = r.rows[0].hat || 'act';
      req.identity.access_level = r.rows[0].access_level;
      req.identity.whole_entity = r.rows[0].whole_entity === true;
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
    /**
     * ⭐⭐ AND WHO IS DOING IT, CARRIED DOWN TO THE TRANSACTION. b146 stamps `changed_by` from
     * `app.current_actor`, which until now was set by nothing — so every catalogue version row recorded a
     * change with no author, and `NULLIF` made that look deliberate.
     *
     * ⭐ THIS IS THE ONE PLACE THAT KNOWS. `req.identity` is built here, and this is the single point where
     * auth hands control on, so establishing the scope here covers every route without any of them opting in.
     * `withEntity` reads it back out — see lib/reqctx.js for why a parameter would have been the wrong answer.
     *
     * ⚠️ THE ACTOR IS `identity_id`, NOT `entityOf(req)`. They differ exactly when it matters: a co-assist acts
     * FOR its parent, so the entity is the business and the actor is the person. Using entityOf here would
     * write "the business changed it" into a column that exists to name someone.
     */
    return require('../lib/reqctx').runWithActor(req.identity.identity_id, () => gate(req, res, next));
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Unauthorised',
        message: 'Token expired — please log in again'
      });
    }
    /**
     * ⚠️⚠️ ONLY A JWT PROBLEM MAY BE REPORTED AS A TOKEN PROBLEM. This catch used to turn EVERY exception into
     * 401 "Invalid token" — including the Postgres 42703 raised when the revocation query named a column b173
     * had not created yet. A perfectly valid token, issued seconds earlier by this same process, came back as
     * invalid. Athi reported it as "sign-in is not working", and the message pointed the whole investigation
     * at tokens and login when the fault was a missing column two layers down.
     *
     * ⭐ A misleading error is worse than a bare failure: it does not merely withhold the answer, it actively
     * argues for the wrong one. A database fault is a 500 — ours, not the caller's — and it gets logged.
     */
    if (err.name === 'JsonWebTokenError' || err.name === 'NotBeforeError') {
      return res.status(401).json({ error: 'Unauthorised', message: 'Invalid token' });
    }
    console.error('auth: non-JWT failure —', err.code || '', err.message);
    return res.status(500).json({
      error: 'Server error',
      message: 'Could not verify your session. This is our fault, not your login.'
    });
  }
};

module.exports = auth;

/** what each scope opens — method + path; a route not listed here is closed to keys whatever else they pass */
const KEY_ROUTES = {
  offers:    [['*', /^\/api\/offers(\/|$)/]],
  pricing:   [['*', /^\/api\/pricing(\/|$)/]],
  tax:       [['POST', /^\/api\/tax\/(rate|compute)$/]],
  invoice:   [['*', /^\/api\/invoice(\/|$)/]],
  services:  [['*', /^\/api\/(offers|pricing|invoice)(\/|$)/], ['POST', /^\/api\/tax\/(rate|compute)$/]],
  connector: [['*', /^\/api\/offers(\/|$)/], ['GET', /^\/api\/products(\/|$)/], ['POST', /^\/api\/products\/bulk$/], ['PATCH', /^\/api\/products\/[^/]+$/],
              ['GET', /^\/api\/chits\/(inbox|pulse|[0-9a-f-]{36})$/], ['POST', /^\/api\/events\/ticket$/], ['GET', /^\/api\/events\/stats$/]],
};
const _keyCache = new Map();   // jti → { ok, at }
async function keyListed(entity_id, jti) {
  if (!jti) return false;
  const c = _keyCache.get(jti); if (c && Date.now() - c.at < 60000) return c.ok;
  let ok = false;
  try { const { query } = require('../db'); const r = await query('SELECT policy_flags FROM identities WHERE identity_id = $1', [entity_id]);
        const list = (r.rows[0] && r.rows[0].policy_flags && r.rows[0].policy_flags.api_keys) || [];
        ok = Array.isArray(list) && list.some((k) => k && String(k.jti) === String(jti)); } catch (_) { ok = false; }
  _keyCache.set(jti, { ok, at: Date.now() }); return ok;
}
/** requireScope('offers') — a session may do anything; a key only what it was minted for */
auth.requireScope = (scope) => (req, res, next) => {
  if (!req.api_key) return next();
  if (req.api_key.scopes.includes(scope) || req.api_key.scopes.includes('services')) return next();   /* 'services' = every service */
  return res.status(403).json({ error: 'Forbidden', message: 'This key is not scoped for ' + scope });
};

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
