/*
 * OWNS      API keys for other systems: mint (owner only), list, revoke.
 * CALLED BY web Settings › Integrations › Keys · routes/till.js.
 * FLOW      auth → owner gate → mint → revoke
 * CARD      18-identity-sign-in-and-access/keys
 */
/**
 * /api/keys — API KEYS FOR OTHER SYSTEMS (Athi, 2026-09-05: "create the entire offer as a capability and attach it to
 * any other systems … an api or micro service").
 *
 * A key is a long-lived token the entity mints for ANOTHER SYSTEM, scoped to what that system may call. It is a JWT
 * signed with the same secret as a session (so every existing route understands it) but marked kind:'api_key' with a
 * jti, and the jti must be LISTED on the entity (identities.policy_flags.api_keys) — delete the listing and the key is
 * dead, whatever its expiry. No migration: the list rides the jsonb column b130 gave policy flags.
 *
 *   POST   /api/keys          (session only)  { name, scopes?:['offers'], days?:365 } → { key, jti, … }   the key is shown ONCE
 *   GET    /api/keys          (session only)  → { keys:[{ jti, name, scopes, created_at, expires_at, last4 }] }
 *   DELETE /api/keys/:jti     (session only)  → revoked
 *
 * ⚠️ A KEY CANNOT MINT OR REVOKE KEYS. Only a person's session can — a leaked key must not be able to breed.
 * Scopes today: 'offers' (the offer engine as a service). A route asks for one with auth.requireScope('offers').
 */
const express = require('express');
const { SAFE_SENTENCE } = require('../lib/respond');
const { problem, fromError, problemResponse } = require('../lib/problem'); // API-STANDARD S1: the one error writer; each answer's old body is frozen in docs/contracts/api-legacy.json
const logger = require('../lib/logger');
const { ownerOnly } = require('../lib/owner');
const router = express.Router();
const auth = require('../middleware/auth');
const { withTransaction } = require('../db');
const { listOf, mint } = require('../lib/api-keys'); // S7: the key list and the one mint live in lib/, not on this router
const { schemaValidate } = require('../middleware/validate'); // S9: the request is checked against the route's own schema
const policy = require('../lib/policy'); // T2-POLICY: the one writer of policy_flags (patchKey)
const { shapeOf, outputFilter } = require('../lib/output-allowlist'); // S34: the answer's closed schema and the filter that applies it

/* ⚠️ ASKED, NOT REMEMBERED. This was its own array, so a scope added to the guard was mintable by nobody and a scope removed
   from the guard stayed on offer here. The map that enforces them is the only place they are named.
   services = every service · connector = products up, orders down, the bell · till = a counter · screen = a sign that only reads */
const SCOPES = auth.SCOPE_NAMES;
/* the body every 500 on these routes answered before the standard: frozen (S2) — the sentence is the one safeErr returns, never the error's own text (S8) */
const FAILED_LEGACY = { error: 'Failed', message: SAFE_SENTENCE };
const sessionOnly = (req, res, next) => {
  if (req.api_key) {
    const sentence = 'A key cannot manage keys — sign in.';
    return problem(req, res, { status: 403, code: 'KEY_CANNOT_MANAGE_KEYS', detail: sentence, legacy: { error: 'Forbidden', message: sentence } });
  }
  next();
};

/** the kinds a login may mint: every scope, minus the platform's 'testing' for a shop login */
function scopesFor(req) {
  let platform = false;
  try {
    platform = require('../lib/platformroot').isPlatform(req);
  } catch (e) {
    logger.warn("keys scopesFor: the platform test failed — answered a shop's list", { err: e && e.message });
  }
  return SCOPES.filter((scope) => scope !== 'testing' || platform);
}
/* ⭐ SEC-FIX2 L1: revoking a key is the OWNER's (lib/owner — the same gate counters and people writes use): an editor could stop the
   counter mid-sale by revoking its key, while changing the counters themselves was already owner-only. The list says it as `may`. */
const owner = require('../lib/owner');
const REVOKE_SAYS = 'Only the owner can revoke a key.';
/* ── the contract: each route's OpenAPI operation, the ONE source the register, the contract tests, schemaValidate and /api/openapi.json share (S9) ── */
const refused = problemResponse;
const KEY_RECORD = {
  type: 'object',
  required: ['jti', 'name', 'scopes', 'created_at', 'expires_at', 'last4'],
  properties: { jti: { type: 'string' }, name: { type: 'string' }, scopes: { type: 'array', items: { type: 'string' } }, created_at: { type: 'string' }, expires_at: { type: 'string' }, last4: { type: 'string' } }
};
const json = (schema) => ({ 'application/json': { schema } });
const MINT_OPERATION = {
  summary: 'Mint an API key (session only)',
  tags: ['keys'],
  security: [{ bearer: [] }],
  requestBody: {
    content: json({
      type: 'object',
      description: 'scopes are some of: ' + [].concat(SCOPES || []).join(', ') + ' (a kind the shop may not make is refused with 403)',
      properties: { name: { type: 'string', maxLength: 200 }, scopes: { type: 'array', items: { type: 'string' } }, days: { type: 'integer' } }
    })
  },
  responses: {
    201: { description: 'the key, shown once', content: json({ type: 'object', required: ['key', 'note'].concat(KEY_RECORD.required), properties: Object.assign({ key: { type: 'string' }, note: { type: 'string' } }, KEY_RECORD.properties) }) },
    400: refused('the request cannot be made into a key'),
    401: refused('no or bad credentials'),
    403: refused('a key, a co-assist or a shop asking for a platform kind'),
    500: refused('a fault of ours')
  }
};
/* S34: the list's 200 schema is the one derived from its recorded answers (docs/contracts/api-output-shapes.json), else the hand-written one; a hand-written operation never reaches the filter by itself */
const LIST_SHAPE = shapeOf('GET /api/keys');
const LIST_FILTER = [outputFilter(LIST_SHAPE, 'GET /api/keys')].filter(Boolean);
const LIST_ANSWER = { type: 'object', required: ['keys', 'scopes', 'may'], properties: { keys: { type: 'array', items: { type: 'object' } }, scopes: { type: 'array', items: { type: 'string' } }, may: { type: 'object', required: ['revoke'], properties: { revoke: { type: 'boolean' } } } } };
const LIST_OPERATION = {
  summary: 'List keys (session only)',
  tags: ['keys'],
  security: [{ bearer: [] }],
  responses: {
    200: { description: 'keys', content: json(LIST_SHAPE && String(LIST_SHAPE.status) === '200' ? LIST_SHAPE.schema : LIST_ANSWER) },
    401: refused('no or bad credentials'),
    403: refused('a key cannot list keys'),
    500: refused('a fault of ours')
  }
};
const REVOKE_OPERATION = {
  summary: 'Revoke a key (session only)',
  tags: ['keys'],
  security: [{ bearer: [] }],
  parameters: [{ name: 'jti', in: 'path', required: true, schema: { type: 'string', minLength: 1 } }],
  responses: {
    200: { description: 'revoked', content: json({ type: 'object', required: ['message', 'jti'], properties: { message: { type: 'string' }, jti: { type: 'string' } } }) },
    401: refused('no or bad credentials'),
    403: refused('a key or a co-assist cannot revoke'),
    404: refused('no such key in this shop'),
    422: refused('the key id is missing'),
    500: refused('a fault of ours')
  }
};
/* an outward route keeps its old refusal (400 and its frozen body) until its next major (S2, S13): the schema answers it, never a silent 422 */
const MINT_REFUSAL = { status: 400, code: 'INVALID_KEY_REQUEST', legacy: (failures) => ({ error: 'validation', message: failures[0].detail }) };

router.get('/', auth, sessionOnly, ...LIST_FILTER, async (req, res) => {
  /* ⭐ SET-WALK1 · W15: `scopes` = the kinds THIS login may mint — 'testing' (a build posts test results to the board) is the platform role's
     only (lib/platformroot.isPlatform); a shop owner never sees it. The web offers exactly this list (cap-settings.js keyKinds); mint() refuses the rest. */
  try {
    const keys = await listOf(auth.entityOf(req));
    const revoke = owner.may(req, REVOKE_SAYS);
    res.json({ keys, scopes: scopesFor(req), may: { revoke: { ok: revoke.ok, code: revoke.code, why: revoke.why } } }); // S34: every key named
  } catch (e) {
    fromError(req, res, e, FAILED_LEGACY);
  }
});

/** a shop asking for a platform-only kind (testing) is refused with its sentence → the 403 body, or null when every asked kind is its to make */
function platformScopeRefusal(req, askedScopes) {
  const allowed = scopesFor(req),
    asked = Array.isArray(askedScopes) ? askedScopes.map(String) : [];
  const notAllowed = asked.filter((kind) => SCOPES.includes(kind) && !allowed.includes(kind));
  if (!notAllowed.length) return null;
  return {
    error: 'Platform only',
    code: 'NOT_PLATFORM',
    may: false,
    why: 'NOT_PLATFORM',
    message: 'A ' + notAllowed[0] + " key is the platform's to make, not a shop's."
  };
}
/* SEC-FIX3 S9: only the owner makes a key — a co-assist's key survived their switch-off and could carry more than they may do */
router.post('/', auth, sessionOnly, ownerOnly('Only the owner can make a key.'), schemaValidate(MINT_OPERATION, MINT_REFUSAL), async (req, res) => {
  try {
    const b = req.body || {};
    const refusal = platformScopeRefusal(req, b.scopes);
    if (refusal) return problem(req, res, { status: 403, code: 'NOT_PLATFORM', detail: refusal.message, legacy: refusal });
    const r = await mint(auth.entityOf(req), req.identity, { name: b.name, scopes: Array.isArray(b.scopes) ? b.scopes : undefined, days: b.days });
    res.status(201).json(Object.assign({ note: 'Shown once. Send it as Authorization: Bearer <key> or X-Api-Key: <key>.' }, r));
  } catch (e) {
    /* mint() throws status 400 with a sentence of its own (a bad scope, twenty keys); anything else is a fault of ours and says nothing of its cause (S8) */
    if (e && e.status === 400) return problem(req, res, { status: 400, code: 'INVALID_KEY_REQUEST', detail: String(e.message), legacy: { error: 'validation', message: String(e.message) } });
    fromError(req, res, e, FAILED_LEGACY);
  }
});

/* ⚠️ FOR UPDATE, same reason as mint() and setEnrol() — a revoke racing a mint on the same list must not have
   whichever save() lands second resurrect the key the other request just removed, or drop the one it just added. */
router.delete('/:jti', auth, sessionOnly, owner.gate(REVOKE_SAYS), schemaValidate(REVOKE_OPERATION), async (req, res) => {
  /* L1: the owner gate, see GET / above */
  try {
    const entity_id = auth.entityOf(req);
    let found = false;
    await withTransaction(async (db) => {
      const lr = await db.query('SELECT policy_flags FROM identities WHERE identity_id = $1 FOR UPDATE', [entity_id]);
      const pf = (lr.rows[0] && lr.rows[0].policy_flags) || {};
      const keys = Array.isArray(pf.api_keys) ? pf.api_keys : [];
      /* ⭐ and the screen keys that counter paired go with it — auth already refuses them once their maker is gone, but
         left listed they would keep using up the shop's twenty places for keys that can no longer open anything */
      const gone = String(req.params.jti);
      const left = keys.filter((item) => String(item.jti) !== gone && String(item.parent || '') !== gone);
      found = keys.some((item) => String(item.jti) === gone);
      keys.filter((item) => String(item.parent || '') === gone).forEach((item) => auth.forgetKey(item.jti));
      if (found) await policy.patchKey(db, entity_id, [], { api_keys: left }, { op: 'merge' });
    });
    if (!found) return problem(req, res, { status: 404, code: 'KEY_NOT_FOUND', detail: 'No key with that id.', legacy: { error: 'Not found' } });
    auth.forgetKey(req.params.jti);
    res.json({ message: 'Key revoked', jti: req.params.jti });
  } catch (e) {
    fromError(req, res, e, FAILED_LEGACY);
  }
});

router.openapi = { paths: { '/api/keys': { post: MINT_OPERATION, get: LIST_OPERATION }, '/api/keys/{jti}': { delete: REVOKE_OPERATION } }, schemas: {} };
module.exports = router;
