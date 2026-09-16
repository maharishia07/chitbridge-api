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
const { query, withTransaction } = require('../db');

/* ⚠️ ASKED, NOT REMEMBERED. This was its own array, so a scope added to the guard was mintable by nobody and a scope removed
   from the guard stayed on offer here. The map that enforces them is the only place they are named.
   services = every service · connector = products up, orders down, the bell · till = a counter · screen = a sign that only reads */
const SCOPES = auth.SCOPE_NAMES;
const sessionOnly = (req, res, next) => { if (req.api_key) return res.status(403).json({ error: 'Forbidden', message: 'A key cannot manage keys — sign in.' }); next(); };

async function listOf(entity_id) {
  const r = await query('SELECT policy_flags FROM identities WHERE identity_id = $1', [entity_id]);
  const pf = (r.rows[0] && r.rows[0].policy_flags) || {};
  return Array.isArray(pf.api_keys) ? pf.api_keys : [];
}
/**
 * ── ⚠️⚠️ ONE KEY AT A TIME, IN ONE STATEMENT ─────────────────────────────────────────────────────────────────
 *
 * save() below rewrites the WHOLE key list. That was fine while the only writers were a person minting or
 * revoking. It stopped being fine on 2026-09-16/17, when a sighting (setSeen), a diagnosis (setDiag) and a till
 * claim (claimTill) all began writing to it — two of them FROM THE SAME REQUEST, since the snapshot is both an
 * authenticated call and the place a counter claims its prefix. Read the list, change one key, write the list:
 * whichever finished second silently erased the other's change. A lost prefix claim is two counters on one
 * number again, which is the fault all of this exists to end.
 *
 * ⭐ So a per-key change is ONE UPDATE that merges into the matching element only. Postgres locks the row and
 * re-evaluates the expression against whatever committed before it, so concurrent writers stack instead of
 * overwriting. A key that has been revoked matches nothing, so it cannot be resurrected by a late sighting.
 * ⚠️ The merge is SHALLOW — top-level fields of one key. Anything nested is passed whole.
 */
async function patchKey(entity_id, jti, patch, db) {
  const run = db ? db.query.bind(db) : query;
  await run(
    `UPDATE identities
        SET policy_flags = jsonb_set(COALESCE(policy_flags, '{}'::jsonb), '{api_keys}',
          COALESCE((SELECT jsonb_agg(CASE WHEN k->>'jti' = $2 THEN k || $3::jsonb ELSE k END)
                      FROM jsonb_array_elements(COALESCE(policy_flags->'api_keys', '[]'::jsonb)) k), '[]'::jsonb))
      WHERE identity_id = $1`,
    [entity_id, String(jti), JSON.stringify(patch)]);
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
  /* ⚠️ a CLOSED counter is kept as history and must not use up a place — closing one is how a shop makes room */
  if (keys.filter((k) => !(k && k.till && k.till.closed_at)).length >= 20)
    throw Object.assign(new Error('Twenty keys at most — revoke one first.'), { status: 400 });
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

/**
 * ⭐⭐⭐ setDiag(entity_id, jti, patch) → what a counter last said about itself, or null if the key is not listed.
 *
 * Athi, 2026-09-16: *"in real life if a PC is in such a situation how do we resolve it, because that PC cannot be
 * scrutinised through you."* A counter that is stuck is the one thing nobody can reach — so it says so itself, and
 * this is where that lands. It rides the key record for the same reason the enrolment does: the key IS the counter,
 * it is already listed on a screen the shop can open, and nothing new has to be migrated to hold it.
 *
 * ⚠️ IT IS THE COUNTER'S OWN ACCOUNT OF ITSELF, not a measurement we took. A counter whose storage is broken may
 * report nothing at all, and the absence is then the finding — so `at` is stamped here, by the server, and a stale
 * `at` says "this counter has not spoken since" rather than pretending to be live.
 * ⚠️ ONE SLOT PER KEY. It is a last-known-state, not a log: an unbounded array on a jsonb column shared with the
 * key list is how that column stops being readable.
 */
/**
 * ⭐⭐ setSeen(entity_id, jti, { ip, agent }) — a sighting: this key was used, now, from there.
 *
 * ⚠️ IT MUST NOT INVALIDATE THE AUTH CACHE. setEnrol and setDiag both call forgetKey because they change what the
 * key IS ALLOWED to do, so the next request must re-read it. A sighting changes nothing about authority, and
 * dropping the cache every five minutes per counter would put a database read back on the hot path it was added
 * to avoid. Written straight to the row, cache untouched.
 * ⚠️ AND IT NEVER THROWS INTO A REQUEST. The caller fires it after the answer has gone; a shop must never lose a
 * sale because we could not file a timestamp.
 */
router.setSeen = async (entity_id, jti, at) => {
  const seen = { at: new Date().toISOString(), ip: (at && at.ip) || null, agent: (at && at.agent) || null };
  await patchKey(entity_id, jti, { seen });      /* ⚠️ never save() — see patchKey */
  return seen;
};
/**
 * ── ⭐⭐⭐ claimTill(entity_id, jti, { id, issued }) — ONE PREFIX PER COUNTER, DECIDED HERE ──────────────────────
 *
 * Athi, 2026-09-17: *"if the same counter number is already opened in another PC, the sequence numbers collapse.
 * If the same counter number is already opened somewhere, either stop opening that counter, or allow — but with a
 * different sequence number. Otherwise we are messing up."*
 *
 * Both of his answers, each where it belongs:
 *   · ALLOW WITH A DIFFERENT NUMBER — automatic. A counter that has issued NOTHING is given the lowest prefix no
 *     other counter of this shop holds, and it is STORED ON THE KEY, so it never moves again. (The old suggestion
 *     was an ordinal among till keys, which shifted every time an older key was revoked.)
 *   · STOP — only where no machine can fix it. A counter that has ALREADY issued numbers under a prefix an OLDER
 *     counter also issued under cannot be renamed mid-series: under GST an invoice run must be one continuous
 *     serial for the year, and renaming it breaks exactly that. It is told to stop issuing until a person chooses.
 *
 * ⚠️ THE OLDEST KEY KEEPS A CONTESTED PREFIX. A rule, not a race — whichever PC happened to open first this
 * morning must not decide which shop's books stay intact. The oldest counter is the one whose bills are most
 * likely already in the books under that prefix.
 *
 * ⚠️ ONE READ, ONE WRITE: the decision and the record of it happen together, so two counters opening at the same
 * moment cannot both walk away believing they hold the same prefix.
 */
const TILL_IDS = (() => {
  /* C1..C9 then A1..A9, B1.. — TWO CHARACTERS, because the whole number must stay inside India's sixteen */
  const out = [];
  for (let n = 1; n <= 9; n++) out.push('C' + n);
  for (let L = 65; L <= 90; L++) { if (L === 67) continue; for (let n = 1; n <= 9; n++) out.push(String.fromCharCode(L) + n); }
  return out;
})();
router.claimTill = async (entity_id, jti, ask) => withTransaction(async (db) => {
  /* ⚠️ FOR UPDATE — two counters opening at the same moment must not both be handed the same free prefix */
  const lr = await db.query('SELECT policy_flags FROM identities WHERE identity_id = $1 FOR UPDATE', [entity_id]);
  const pf = (lr.rows[0] && lr.rows[0].policy_flags) || {};
  const keys = Array.isArray(pf.api_keys) ? pf.api_keys : [];
  const me = keys.find((x) => x && String(x.jti) === String(jti));
  if (!me) return null;
  const tills = keys.filter((k) => k && Array.isArray(k.scopes) && k.scopes.indexOf('till') >= 0);
  const older = (a, b) => String(a.created_at || '').localeCompare(String(b.created_at || ''));
  const others = tills.filter((k) => String(k.jti) !== String(jti));
  const using = String((ask && ask.id) || '').trim().toUpperCase() || null;
  const issued = !!(ask && ask.issued);
  const now = new Date().toISOString();

  /**
   * ⭐⭐⭐ A KEY OPENED FOR A NAMED COUNTER TAKES THAT COUNTER'S NUMBER, AND ITS PLACE IN THE SERIES (2026-09-17).
   * Athi: *"like a co-assist — I know the counter number, and I open and close it again and again, in one PC."*
   * The counter, not the pairing, owns the prefix; routes/counters.js guarantees only one open key holds it. So
   * there is nothing to decide here — only to say which counter this is and where its run stopped, so a PC that has
   * never seen it continues rather than starting again at 0001.
   */
  if (me.counter) {
    const cid = String(me.counter).toUpperCase();
    const c = (pf.counters || {})[cid] || {};
    me.till = Object.assign({}, me.till || {}, { id: cid, issued: issued || Number(c.next) > 1, at: now });
    await patchKey(entity_id, jti, { till: me.till }, db);
    return { id: cid, clash: null, counter: cid, name: c.name || null,
             resume_next: Number(c.next) > 0 ? Number(c.next) : null, resume_period: c.period || null };
  }

  /* every prefix another counter of this shop holds */
  const held = new Set(others.map((k) => k.till && String(k.till.id || '').toUpperCase()).filter(Boolean));
  /**
   * ⚠️⚠️ AND EVERY PREFIX THAT ALREADY HAS BILLS IN THE BOOKS. Athi, 2026-09-17: *"is the running sequence number
   * stored in cloud after every chit? is the seq maintained by us?"* — it is not; the next number lives only on the
   * device, which is what lets a counter bill offline. So the cloud cannot say "carry on from 0042". What it CAN do
   * is never hand out a prefix it has already recorded bills under: revoke the key that held C1, pair a new PC, and
   * without this the new PC would be given C1 and start again at 0001 — on top of numbers already issued as tax
   * invoices. Used by BOTH a fresh assignment and a move, because both hand out a prefix.
   * ⚠️ A SAVEPOINT: a failed statement aborts the whole Postgres transaction, and the claim would fail with it. A
   * lookup that cannot run must cost the lookup, not the counter its prefix.
   */
  const booked = new Set();
  await db.query('SAVEPOINT till_used');
  try {
    await db.query("SELECT set_config('app.current_entity', $1, true)", [String(entity_id)]);
    const used = await db.query(
      `SELECT DISTINCT upper(business_json->'till'->>'id') AS id
         FROM chit_header
        WHERE entity_id = $1 AND business_json->>'client_ref' IS NOT NULL
          AND business_json->'till'->>'id' IS NOT NULL`, [entity_id]);
    used.rows.forEach((r) => { if (r.id) booked.add(r.id); });
    await db.query('RELEASE SAVEPOINT till_used');
  } catch (_) {
    try { await db.query('ROLLBACK TO SAVEPOINT till_used'); } catch (__) {}
  }
  const free = (except) => TILL_IDS.find((x) => !held.has(x) && !booked.has(x) && x !== except) || null;
  let out;

  if (issued && using) {
    /* this counter has numbers out under `using` — does an OLDER counter hold the same prefix? */
    const rival = others
      .filter((k) => k.till && String(k.till.id || '').toUpperCase() === using && k.till.issued)
      .sort(older)[0];
    if (rival && older(rival, me) < 0) {
      /**
       * ⭐⭐ MOVED, NOT STOPPED. Athi, 2026-09-17: *"the counter sequence number — we should offer it, and it cannot
       * be changed for a PC, so it is a permanent number."* The first version stopped the newer counter and asked a
       * person to rename it. There is no need: GST rule 46 allows invoices to be numbered in MULTIPLE series, each
       * consecutive for the year. So the newer counter is given a prefix nobody holds and nothing has been billed
       * under; its old run ends where it stopped, whole, and the new one begins at 0001 (the counter keeps a
       * high-water mark per prefix). Nobody types anything, so nobody can type the wrong thing.
       * ⚠️ `moved_from` is said out loud, so the shop is told why its numbers changed shape.
       * ⚠️ Only if no prefix is free at all — seventeen-odd dozen of them — is the counter stopped instead.
       */
      const to = free(using);
      out = { id: to, moved_from: using, held_by: rival.name || 'another counter',
              clash: to ? null : { id: using, held_by: rival.name || 'another counter' } };
      me.till = { id: to || using, issued: true, at: now };
    } else {
      /* uncontested: this counter keeps the prefix it has been billing under, and the shop now reserves it */
      out = { id: using, clash: null };
      me.till = { id: using, issued: true, at: now };
    }
  } else {
    /* nothing issued yet: keep what this key was given before, else the lowest prefix nobody holds or has billed */
    const had = me.till && me.till.id ? String(me.till.id).toUpperCase() : null;
    const kept = had && !held.has(had) && !booked.has(had) ? had : null;
    const id = kept || free(null);
    out = { id, clash: null };
    me.till = { id, issued: false, at: now };
  }
  await patchKey(entity_id, jti, { till: me.till }, db);
  return out;
});
router.TILL_IDS = TILL_IDS;
/** patchTill — replace one key's `till` record in one statement (see patchKey). Used by POST /api/till/close. */
router.patchTill = (entity_id, jti, till) => patchKey(entity_id, jti, { till });
/** patchKeyWith — the same one-statement merge, on a transaction's own client (routes/counters.js) */
router.patchKeyWith = (db, entity_id, jti, patch) => patchKey(entity_id, jti, patch, db);
/** ⭐ a closed counter is history, not a live key — see POST /api/till/close */
const isClosed = (k) => !!(k && k.till && k.till.closed_at);
router.isClosed = isClosed;
router.setDiag = async (entity_id, jti, patch) => {
  const keys = await listOf(entity_id); if (!keys.find((x) => x && String(x.jti) === String(jti))) return null;
  const diag = Object.assign({}, patch || {}, { at: new Date().toISOString() });
  await patchKey(entity_id, jti, { diag });      /* ⚠️ never save() — see patchKey */
  auth.forgetKey(jti); return diag;
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
/* ⚠️ ONE MINT, REACHED BY NAME. Pairing (routes/till.js) hands out a screen key, and it must be the SAME mint the keys screen
   uses — expiry, listing on the entity, the jti bookkeeping. A second mint would be a second set of rules about what a key is. */
module.exports.mint = mint;
