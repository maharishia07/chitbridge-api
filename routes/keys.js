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
 * A plain "read the list, change one key, write the whole list back" rewrites every OTHER key too. That was
 * fine while the only writer was a person minting or revoking. It stopped being fine on 2026-09-16/17, when a
 * sighting (setSeen), a diagnosis (setDiag) and a till claim (claimTill) all began writing to it — two of them
 * FROM THE SAME REQUEST, since the snapshot is both an authenticated call and the place a counter claims its
 * prefix. Whichever whole-list write finished second silently erased the other's change. A lost prefix claim is
 * two counters on one number again, which is the fault all of this exists to end.
 * ⚠️⚠️ IT BIT MINT() TOO (2026-09-23): mint() read the list, then wrote the whole array back after generating a
 * key — nothing stopped a SECOND enrolment (a retry, a re-sign-in) reading the list before the first one's
 * write landed and then overwriting it away, taking a counter's live key down with it. A shopkeeper mid-sale
 * was told "API key revoked or unknown" for a key nobody had actually revoked. mint(), setEnrol() and the
 * DELETE route now all read with FOR UPDATE and write inside the same transaction instead. [[feedback-whitelist-drops-silently]]
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
  const jti = crypto.randomBytes(12).toString('hex');
  const now = Math.floor(Date.now() / 1000), exp = now + days * 86400;
  const id = identity || {};
  const token = jwt.sign({ identity_id: entity_id, identity_type: 'entity', bridge_id: id.bridge_id || null, display_name: id.display_name || null,
                           kind: 'api_key', scopes, jti, iat: now, exp }, process.env.JWT_SECRET, { algorithm: 'HS256' });
  const rec = { jti, name, scopes, created_at: new Date().toISOString(), expires_at: new Date(exp * 1000).toISOString(), last4: token.slice(-4) };
  /* ⭐ A KEY MADE BY A KEY NAMES ITS MAKER (2026-09-27). A counter may pair a TV; the screen key it yields records the
     counter key's jti, and middleware/auth refuses it the moment that counter key is revoked or closed — so nothing a
     counter hands out can outlive the counter. Athi: "yes, screen codes only". */
  if (opts.parent) rec.parent = String(opts.parent);
  /**
   * ⚠️⚠️ FOR UPDATE, THEN WRITE IN THE SAME TRANSACTION (2026-09-23). mint() used to read the list with listOf(),
   * then save() the WHOLE array back — the exact read-modify-write shape the comment above patchKey() already
   * warns about. Two enrolments close together (a retry after a slow reply, a counter re-signing in while an
   * older request was still in flight) each read the list before the other's save() landed, and whichever
   * save() finished last silently ERASED the other's key from policy_flags.api_keys — a counter mid-sale,
   * still holding that very key in memory, was told on its next request "API key revoked or unknown" and
   * flashed "Signed out by the shop" for a key nobody had actually revoked. [[feedback-whitelist-drops-silently]]
   * ⭐ Locking the row for the read makes the count-and-append atomic, the same discipline claimTill already
   * uses for exactly this class of race.
   */
  await withTransaction(async (db) => {
    const lr = await db.query('SELECT policy_flags FROM identities WHERE identity_id = $1 FOR UPDATE', [entity_id]);
    const pf = (lr.rows[0] && lr.rows[0].policy_flags) || {};
    const keys = Array.isArray(pf.api_keys) ? pf.api_keys : [];
    /* ⚠️ a CLOSED counter is kept as history and must not use up a place — closing one is how a shop makes room */
    if (keys.filter((k) => !(k && k.till && k.till.closed_at)).length >= 20)
      throw Object.assign(new Error('Twenty keys at most — revoke one first.'), { status: 400 });
    await db.query(`UPDATE identities SET policy_flags = COALESCE(policy_flags,'{}'::jsonb) || $1::jsonb WHERE identity_id = $2`,
      [JSON.stringify({ api_keys: keys.concat([rec]) }), entity_id]);
  });
  return Object.assign({ key: token }, rec);
}
router.mint = mint;
router.listOf = listOf;
/**
 * setEnrol(entity_id, jti, patch) → the key's enrolment record after the patch (null if the key is not listed). Clears the auth cache.
 * ⚠️ FOR UPDATE, same reason as mint() — an owner approving a connector while another request touches the same
 * key list must not have the whole-array write silently drop the other one's change (2026-09-23).
 */
router.setEnrol = async (entity_id, jti, patch) => {
  let out = null;
  await withTransaction(async (db) => {
    const lr = await db.query('SELECT policy_flags FROM identities WHERE identity_id = $1 FOR UPDATE', [entity_id]);
    const pf = (lr.rows[0] && lr.rows[0].policy_flags) || {};
    const keys = Array.isArray(pf.api_keys) ? pf.api_keys : [];
    const k = keys.find((x) => x && String(x.jti) === String(jti));
    if (!k) return;
    k.enrol = Object.assign({}, k.enrol || {}, patch || {});
    out = k.enrol;
    await db.query(`UPDATE identities SET policy_flags = COALESCE(policy_flags,'{}'::jsonb) || $1::jsonb WHERE identity_id = $2`,
      [JSON.stringify({ api_keys: keys }), entity_id]);
  });
  if (out) auth.forgetKey(jti);
  return out;
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
/**
 * ⭐ WHICH ENGINE RELEASES A COUNTER RUNS (2026-09-28). The counter sends "money:1.0.0,signin:1.6.0,…" with its
 * snapshot call; it is kept on THIS key's till record (identities.policy_flags.api_keys[].till.engines — the JSON the
 * claim already writes, no new table), so the shop's counter list can say which rules each counter bills with.
 * ⚠️ Read, never trusted: names and versions are shape-checked and capped; nothing downstream decides on them yet.
 */
function cleanEngines(raw) {
  if (!raw) return null;
  const s = Array.isArray(raw) ? raw.join(',') : String(raw);
  const out = {};
  s.split(',').slice(0, 60).forEach((pair) => {
    const m = /^([a-z0-9-]{1,32}):([0-9A-Za-z.\-]{1,20})$/.exec(pair.trim());
    if (m) out[m[1]] = m[2];
  });
  return Object.keys(out).length ? out : null;
}
router.cleanEngines = cleanEngines;

/**
 * bookedPrefixes(db, entity_id) → Set — every prefix that has ever appeared on a recorded counter bill. Never handed to a NEW
 * holder (a key with nothing yet, a phone, a new counter). ONE copy: claimSeries and routes/counters.js both read it here.
 * ⚠️ A SAVEPOINT: a failed statement aborts the whole Postgres transaction, and the claim would fail with it. A lookup that
 * cannot run must cost the lookup, not the counter its prefix.
 */
async function bookedPrefixes(db, entity_id) {
  const out = new Set();
  await db.query('SAVEPOINT booked');
  try {
    await db.query("SELECT set_config('app.current_entity', $1, true)", [String(entity_id)]);
    const r = await db.query(
      `SELECT DISTINCT upper(business_json->'till'->>'id') AS id FROM chit_header
        WHERE entity_id = $1 AND business_json->>'client_ref' IS NOT NULL AND business_json->'till'->>'id' IS NOT NULL`,
      [entity_id]);
    r.rows.forEach((x) => { if (x.id) out.add(x.id); });
    await db.query('RELEASE SAVEPOINT booked');
  } catch (_) { try { await db.query('ROLLBACK TO SAVEPOINT booked'); } catch (__) {} }
  return out;
}
router.bookedPrefixes = bookedPrefixes;

/** holderParts(req.till | 'key:..' | 'dev:..') → { jti } | { device_id, by, jti_session } | {} */
function holderParts(h) {
  if (!h) return {};
  const s = typeof h === 'string' ? h : String(h.holder || '');
  if (s.indexOf('key:') === 0) return { jti: (h.key && h.key.jti) || s.slice(4) };
  if (s.indexOf('dev:') === 0) return { device_id: (h.device_id || s.slice(4)), by: h.by || null, session: (h.session && h.session.jti) || null };
  return {};
}
/** devicePrefixes(pf, except) → Set of the prefixes phones hold (policy_flags.devices[d].till.prefix), but `except`'s own.
 *  ⚠️ A REVOKED phone keeps its prefix reserved: its unsent bills are kept on it and still carry that number. */
function devicePrefixes(pf, except) {
  const devices = (pf && pf.devices && typeof pf.devices === 'object') ? pf.devices : {};
  const out = new Set();
  Object.keys(devices).forEach((id) => {
    const t = devices[id] && devices[id].till;
    if (id !== except && t && t.prefix) out.add(String(t.prefix).toUpperCase());
  });
  return out;
}
router.devicePrefixes = devicePrefixes;

/**
 * phoneHashesOf(db, entity_id, by) → Set — the value_hash of every VERIFIED PHONE document of the person signed in. D9: a
 * counter label is assigned to a phone NUMBER, and matched against the person's PHONE identity document (routes/identity-docs
 * docHash) — never against a number the phone itself claims. ⚠️ A typed phone that was never verified does not match.
 * Savepoint, same reason as bookedPrefixes: a missing table costs the match, not the claim (the phone gets a free label).
 */
async function phoneHashesOf(db, entity_id, by) {
  const out = new Set();
  if (!by) return out;
  await db.query('SAVEPOINT phone_doc');
  try {
    await db.query("SELECT set_config('app.current_entity', $1, true)", [String(entity_id)]);
    const st = require('../lib/iddoc-verify').verifiedPhoneHashesStatement(String(by));
    const r = await db.query(st.text, st.params);
    r.rows.forEach((x) => { if (x.value_hash) out.add(String(x.value_hash)); });
    await db.query('RELEASE SAVEPOINT phone_doc');
  } catch (_) { try { await db.query('ROLLBACK TO SAVEPOINT phone_doc'); } catch (__) {} }
  return out;
}
/** the hashes an assigned number may have been filed under — with and without its leading '+', since both are allowed */
function assignedHashes(phone) {
  const docs = require('./identity-docs');
  const d = docs.normPhone(phone);
  if (!d) return [];
  const bare = d.replace(/^\+/, '');
  return [docs.docHash('PHONE', bare), docs.docHash('PHONE', '+' + bare)];
}
router.assignedHashes = assignedHashes;

/**
 * ── ⭐⭐⭐ claimDevice — A PHONE'S SERIES (M11, D9) ──────────────────────────────────────────────────────────────────────
 *
 * A phone is a PERSON on a DEVICE, never a counter key (SPEC-iam-build §1). Its series is kept on its device listing,
 * policy_flags.devices[d].till = { prefix, assigned_at, issued, at, counter?, engines? } — no SQL.
 *   1. ASSIGNED — the shop gave a counter label to a phone NUMBER (POST /api/counters/:id/assign). If the signed-in person's
 *      verified PHONE document is that number, and no live key and no other phone holds that counter, the phone bills as
 *      it and continues its run (resume_next). The counter register records the phone as its holder ('dev:'+id), so a PC
 *      cannot open it on top (routes/counters.js view()).
 *   2. KEPT — the prefix this phone already has, if no key and no other phone holds it and it is not a registered counter
 *      (a registered label belongs to whoever the shop assigns it to).
 *   3. NEXT FREE — the lowest TILL_IDS prefix no key holds (closed ones included — their numbers are history), no phone
 *      holds, nothing was billed under, and no registered counter owns. Said once: "This phone bills as C4."
 * ⚠️ MOVED, NOT STOPPED, as for a PC: a phone that loses its label (reassigned, taken over) is given a free prefix and told
 * `moved_from`; its old run ends whole (GST rule 46, multiple series).
 */
async function claimDevice(db, entity_id, pf, who, ask) {
  const devices = (pf.devices && typeof pf.devices === 'object') ? pf.devices : {};
  const me = Object.prototype.hasOwnProperty.call(devices, who.device_id) ? devices[who.device_id] : null;
  if (!me || me.revoked_at) return null;
  const now = new Date().toISOString();
  const keys = Array.isArray(pf.api_keys) ? pf.api_keys : [];
  const tills = keys.filter((k) => k && Array.isArray(k.scopes) && k.scopes.indexOf('till') >= 0);
  const keyHeld = new Set(tills.map((k) => k.till && String(k.till.id || '').toUpperCase()).filter(Boolean));
  const liveKeyHeld = new Set(tills.filter((k) => !isClosed(k)).map((k) => k.till && String(k.till.id || '').toUpperCase()).filter(Boolean));
  const phoneHeld = devicePrefixes(pf, who.device_id);
  const counters = pf.counters || {};
  const mine = 'dev:' + who.device_id;
  const had = me.till && me.till.prefix ? String(me.till.prefix).toUpperCase() : null;
  const using = String((ask && ask.id) || '').trim().toUpperCase() || null;
  const engines = cleanEngines(ask && ask.engines);
  const order = (a, b) => TILL_IDS.indexOf(a.id) - TILL_IDS.indexOf(b.id);
  /* a registered counter a live key holds (or is opening) is not this phone's to take */
  const keyHolds = (c) => liveKeyHeld.has(c.id) || (c.held_by && String(c.held_by).indexOf('dev:') !== 0
    && (String(c.held_by).indexOf('pending:') === 0 || tills.some((k) => String(k.jti) === String(c.held_by) && !isClosed(k))));

  /* 1 · assigned by phone number */
  let pick = null, counter = null;
  const assigned = Object.keys(counters).map((id) => Object.assign({ id: String(id).toUpperCase() }, counters[id]))
    .filter((c) => c.assigned && c.assigned.phone).sort(order);
  if (assigned.length) {
    const hashes = await phoneHashesOf(db, entity_id, who.by);
    counter = assigned.find((c) => assignedHashes(c.assigned.phone).some((h) => hashes.has(h))
      && !keyHolds(c) && !phoneHeld.has(c.id)) || null;
    if (counter) pick = counter.id;
  }
  /* 2 · kept */
  if (!pick && had && !keyHeld.has(had) && !phoneHeld.has(had) && !counters[had]) pick = had;
  /* 3 · next free */
  let booked = null;
  if (!pick) {
    booked = await bookedPrefixes(db, entity_id);
    pick = TILL_IDS.find((x) => !keyHeld.has(x) && !phoneHeld.has(x) && !booked.has(x) && !counters[x]) || null;
  }
  const till = Object.assign({}, me.till || {}, {
    prefix: pick, at: now, issued: !!(ask && ask.issued) && pick === (using || had),
    assigned_at: pick && pick === had && me.till && me.till.assigned_at ? me.till.assigned_at : now });
  if (counter) till.counter = counter.id; else delete till.counter;
  if (engines) till.engines = engines;
  await db.query(
    `UPDATE identities SET policy_flags = jsonb_set(policy_flags, ARRAY['devices', $2::text, 'till'], $3::jsonb, true)
      WHERE identity_id = $1`, [entity_id, String(who.device_id), JSON.stringify(till)]);
  /* the register: this phone holds its assigned counter, and lets go of any it held before */
  const counterPatch = (id, patch) => db.query(
    `UPDATE identities
        SET policy_flags = jsonb_set(COALESCE(policy_flags, '{}'::jsonb), '{counters}',
              COALESCE(policy_flags->'counters', '{}'::jsonb)
              || jsonb_build_object($2::text, COALESCE(policy_flags->'counters'->$2, '{}'::jsonb) || $3::jsonb))
      WHERE identity_id = $1`, [entity_id, String(id), JSON.stringify(patch)]);
  for (const id of Object.keys(counters)) {
    const c = counters[id];
    if (c && c.held_by === mine && (!counter || String(id).toUpperCase() !== counter.id))
      await counterPatch(id, { held_by: null, held_at: null, closed_at: now });
  }
  if (counter && counter.held_by !== mine) await counterPatch(counter.id, { held_by: mine, held_at: now, opened_at: now, closed_at: null, released: null });
  if (who.session) { try { require('../lib/person-session').forget(who.session); } catch (_) {} }

  const from = using || had;
  const out = { id: pick, clash: pick ? null : { id: from, held_by: 'every prefix is taken' },
                said: pick ? 'This phone bills as ' + pick + '.' : null };
  if (from && pick && from !== pick && (had || (ask && ask.issued))) out.moved_from = from;
  if (counter) {
    out.counter = counter.id; out.name = counter.name || null;
    out.resume_next = Number(counter.next) > 0 ? Number(counter.next) : null; out.resume_period = counter.period || null;
  }
  return out;
}

/**
 * ── ⭐⭐⭐ claimSeries(entity_id, holder, ask) — ONE SERIES ALLOCATOR, FOR A KEY AND FOR A PHONE (M11, SPEC-iam-build PR 11) ──
 *
 * claimTill widened. `holder` is req.till (lib/holder.js) or its holder string: 'key:'+jti (a counter PC — the body below,
 * UNCHANGED) or 'dev:'+device_id (a person signed in on a phone — claimDevice). Anything else holds no series → null.
 * Both read the SAME locked row and hand out from the SAME TILL_IDS, and each excludes what the other holds — so a key and
 * a phone can never be given one prefix. tests/claim-series.test.cjs.
 * ⚠️ A KEY'S OWN PREFIX IS NEVER DECIDED BY A PHONE: devices only narrow what is FREE for a key with nothing yet; a key
 * that holds a prefix keeps it exactly as before M11 (the STOP condition of the row).
 */
router.claimSeries = async (entity_id, holder, ask) => withTransaction(async (db) => {
  /* ⚠️ FOR UPDATE — two counters opening at the same moment must not both be handed the same free prefix */
  const lr = await db.query('SELECT policy_flags FROM identities WHERE identity_id = $1 FOR UPDATE', [entity_id]);
  const pf = (lr.rows[0] && lr.rows[0].policy_flags) || {};
  const who = holderParts(holder);
  if (who.device_id) return claimDevice(db, entity_id, pf, who, ask);
  if (!who.jti) return null;
  const jti = who.jti;
  const keys = Array.isArray(pf.api_keys) ? pf.api_keys : [];
  const me = keys.find((x) => x && String(x.jti) === String(jti));
  if (!me) return null;
  const tills = keys.filter((k) => k && Array.isArray(k.scopes) && k.scopes.indexOf('till') >= 0);
  const older = (a, b) => String(a.created_at || '').localeCompare(String(b.created_at || ''));
  const others = tills.filter((k) => String(k.jti) !== String(jti));
  const using = String((ask && ask.id) || '').trim().toUpperCase() || null;
  const issued = !!(ask && ask.issued);
  const now = new Date().toISOString();
  const engines = cleanEngines(ask && ask.engines);

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
    if (engines) me.till.engines = engines;
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
  const booked = await bookedPrefixes(db, entity_id);
  /* M11: a prefix a PHONE holds is not free either, nor a REGISTERED counter's label (opening that counter on a PC would hand
     its key the same prefix) — both only narrow a FRESH pick; `held` (keys) still decides what a key keeps */
  const phones = devicePrefixes(pf, null);
  const registered = pf.counters || {};
  const free = (except) => TILL_IDS.find((x) => !held.has(x) && !phones.has(x) && !registered[x] && !booked.has(x) && x !== except) || null;
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
  if (engines) me.till.engines = engines;
  await patchKey(entity_id, jti, { till: me.till }, db);
  return out;
});
router.TILL_IDS = TILL_IDS;
/** claimTill(entity_id, jti, ask) — the pre-M11 name, kept for its readers: the same allocator, asked as a key */
router.claimTill = (entity_id, jti, ask) => router.claimSeries(entity_id, 'key:' + jti, ask);
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

/* ⚠️ FOR UPDATE, same reason as mint() and setEnrol() — a revoke racing a mint on the same list must not have
   whichever save() lands second resurrect the key the other request just removed, or drop the one it just added. */
router.delete('/:jti', auth, sessionOnly, async (req, res) => {
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
      const left = keys.filter((k) => String(k.jti) !== gone && String(k.parent || '') !== gone);
      found = keys.some((k) => String(k.jti) === gone);
      keys.filter((k) => String(k.parent || '') === gone).forEach((k) => auth.forgetKey(k.jti));
      if (found) await db.query(`UPDATE identities SET policy_flags = COALESCE(policy_flags,'{}'::jsonb) || $1::jsonb WHERE identity_id = $2`,
        [JSON.stringify({ api_keys: left }), entity_id]);
    });
    if (!found) return res.status(404).json({ error: 'Not found' });
    auth.forgetKey(req.params.jti);
    res.json({ message: 'Key revoked', jti: req.params.jti });
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});

router.openapi = { paths: { '/api/keys': { post: { summary: 'Mint an API key (session only)', tags: ['keys'], security: [{ bearer: [] }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, scopes: { type: 'array', items: { type: 'string', enum: SCOPES } }, days: { type: 'integer' } } } } } }, responses: { 201: { description: 'the key, shown once' } } }, get: { summary: 'List keys (session only)', tags: ['keys'], security: [{ bearer: [] }], responses: { 200: { description: 'keys' } } } }, '/api/keys/{jti}': { delete: { summary: 'Revoke a key (session only)', tags: ['keys'], security: [{ bearer: [] }], parameters: [{ name: 'jti', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'revoked' } } } } }, schemas: {} };
module.exports = router;
/* ⚠️ ONE MINT, REACHED BY NAME. Pairing (routes/till.js) hands out a screen key, and it must be the SAME mint the keys screen
   uses — expiry, listing on the entity, the jti bookkeeping. A second mint would be a second set of rules about what a key is. */
module.exports.mint = mint;
