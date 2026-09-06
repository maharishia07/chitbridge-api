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
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const router = express.Router();
const auth = require('../middleware/auth');
const { query } = require('../db');

const SCOPES = ['offers', 'pricing', 'tax', 'invoice', 'connector', 'services'];   // services = every service; connector = products up · orders down · the bell
const sessionOnly = (req, res, next) => { if (req.api_key) return res.status(403).json({ error: 'Forbidden', message: 'A key cannot manage keys — sign in.' }); next(); };

async function listOf(entity_id) {
  const r = await query('SELECT policy_flags FROM identities WHERE identity_id = $1', [entity_id]);
  const pf = (r.rows[0] && r.rows[0].policy_flags) || {};
  return Array.isArray(pf.api_keys) ? pf.api_keys : [];
}
async function save(entity_id, keys) {
  await query(`UPDATE identities SET policy_flags = COALESCE(policy_flags,'{}'::jsonb) || $1::jsonb WHERE identity_id = $2`, [JSON.stringify({ api_keys: keys }), entity_id]);
}

router.get('/', auth, sessionOnly, async (req, res) => {
  try { res.json({ keys: await listOf(auth.entityOf(req)), scopes: SCOPES }); }
  catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});

/**
 * mint(entity_id, identity, { name, scopes, days }) → { key, jti, name, scopes, created_at, expires_at, last4 } — the ONE mint.
 * The POST below calls it, and so does the connector-kit download (routes/integrations.js), which puts the key inside the zip's
 * connector.json so nobody pastes anything (Athi, 2026-09-06: "download option should autofill everything").
 * Throws { status, message } on a validation or limit failure.
 */
async function mint(entity_id, identity, opts) {
  opts = opts || {};
  const name = String(opts.name || '').trim().slice(0, 80) || 'key';
  const scopes = (Array.isArray(opts.scopes) ? opts.scopes : ['offers']).map(String).filter((s) => SCOPES.includes(s));
  if (!scopes.length) throw Object.assign(new Error('scopes must include one of: ' + SCOPES.join(', ')), { status: 400 });
  const days = Math.min(Math.max(Number(opts.days) || 365, 1), 3650);
  const keys = await listOf(entity_id);
  if (keys.length >= 20) throw Object.assign(new Error('Twenty keys at most — revoke one first.'), { status: 400 });
  const jti = crypto.randomBytes(12).toString('hex');
  const now = Math.floor(Date.now() / 1000), exp = now + days * 86400;
  const id = identity || {};
  const token = jwt.sign({ identity_id: entity_id, identity_type: 'entity', bridge_id: id.bridge_id || null, display_name: id.display_name || null,
                           kind: 'api_key', scopes, jti, iat: now, exp }, process.env.JWT_SECRET, { algorithm: 'HS256' });
  const rec = { jti, name, scopes, created_at: new Date().toISOString(), expires_at: new Date(exp * 1000).toISOString(), last4: token.slice(-4) };
  await save(entity_id, keys.concat([rec]));
  return Object.assign({ key: token }, rec);
}
router.mint = mint;
router.listOf = listOf;
/** setEnrol(entity_id, jti, patch) → the key's enrolment record after the patch (null if the key is not listed). Clears the auth cache. */
router.setEnrol = async (entity_id, jti, patch) => {
  const keys = await listOf(entity_id); const k = keys.find((x) => x && String(x.jti) === String(jti)); if (!k) return null;
  k.enrol = Object.assign({}, k.enrol || {}, patch || {}); await save(entity_id, keys); auth.forgetKey(jti); return k.enrol;
};

router.post('/', auth, sessionOnly, async (req, res) => {
  try {
    const b = req.body || {};
    const r = await mint(auth.entityOf(req), req.identity, { name: b.name, scopes: Array.isArray(b.scopes) ? b.scopes : undefined, days: b.days });
    res.status(201).json(Object.assign({ note: 'Shown once. Send it as Authorization: Bearer <key> or X-Api-Key: <key>.' }, r));
  } catch (e) { res.status(e && e.status ? e.status : 500).json({ error: e && e.status === 400 ? 'validation' : 'Failed', message: String(e && e.message) }); }
});

router.delete('/:jti', auth, sessionOnly, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const keys = await listOf(entity_id);
    const left = keys.filter((k) => String(k.jti) !== String(req.params.jti));
    if (left.length === keys.length) return res.status(404).json({ error: 'Not found' });
    await save(entity_id, left);
    res.json({ message: 'Key revoked', jti: req.params.jti });
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});

router.openapi = { paths: { '/api/keys': { post: { summary: 'Mint an API key (session only)', tags: ['keys'], security: [{ bearer: [] }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, scopes: { type: 'array', items: { type: 'string', enum: SCOPES } }, days: { type: 'integer' } } } } } }, responses: { 201: { description: 'the key, shown once' } } }, get: { summary: 'List keys (session only)', tags: ['keys'], security: [{ bearer: [] }], responses: { 200: { description: 'keys' } } } }, '/api/keys/{jti}': { delete: { summary: 'Revoke a key (session only)', tags: ['keys'], security: [{ bearer: [] }], parameters: [{ name: 'jti', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'revoked' } } } } }, schemas: {} };
module.exports = router;
