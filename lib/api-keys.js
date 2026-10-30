/*
 * OWNS      The API-key list on an entity (identities.policy_flags.api_keys) and the counter / phone series allocator: mint, list, end by
 *           person, enrol, sighting, diagnosis, claimSeries / claimTill, the till prefixes, patchKey. The ONE writer of those keys.
 * CALLED BY routes/keys.js (the /api/keys handlers) · routes/counters.js · routes/till.js · routes/integrations.js · routes/actors.js ·
 *           middleware/auth.js (setSeen) · lib/home-facts.js (isClosed) · tests/claim-series.test.cjs
 * FLOW      read the list FOR UPDATE → change one key → write in the same transaction (see patchKey)
 * CARD      18-identity-sign-in-and-access/keys
 * S7 (2026-10-30): moved out of routes/keys.js unchanged, so no route file loads another as a library.
 */
const crypto = require('crypto');
const jsonwebtoken = require('jsonwebtoken');
const logger = require('./logger');
const auth = require('../middleware/auth');
const { query, withTransaction } = require('../db');
const policy = require('./policy'); // T2-POLICY: the one writer of policy_flags (patchKey)

const SCOPES = auth.SCOPE_NAMES;

async function listOf(entity_id) {
  const queryResult = await query('SELECT policy_flags FROM identities WHERE identity_id = $1', [entity_id]);
  const policyFlags = (queryResult.rows[0] && queryResult.rows[0].policy_flags) || {};
  return Array.isArray(policyFlags.api_keys) ? policyFlags.api_keys : [];
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
async function patchKey(entity_id, keyId, patch, db) {
  /* T2-POLICY: the one writer — its `merge_item` op is this statement, generalised */
  await policy.patchKey(db || null, entity_id, ['api_keys'], patch, { op: 'merge_item', match: ['jti', String(keyId)] });
}

/**
 * mint(entity_id, identity, { name, scopes, days }) → { key, jti, name, scopes, created_at, expires_at, last4 } — the ONE mint.
 * The POST below calls it, and so does the connector-kit download (routes/integrations.js), which puts the key inside the zip's
 * connector.json so nobody pastes anything (Athi, 2026-09-06: "download option should autofill everything").
 * Throws { status, message } on a validation or limit failure.
 */
async function mint(entity_id, identity, opts) {
  opts = opts || {};
  const name =
    String(opts.name || '')
      .trim()
      .slice(0, 80) || 'key';
  const scopes = (Array.isArray(opts.scopes) ? opts.scopes : ['offers']).map(String).filter((item) => SCOPES.includes(item));
  if (!scopes.length) throw Object.assign(new Error('scopes must include one of: ' + SCOPES.join(', ')), { status: 400 });
  const days = Math.min(Math.max(Number(opts.days) || 365, 1), 3650);
  const keyId = crypto.randomBytes(12).toString('hex');
  const now = Math.floor(Date.now() / 1000),
    expiresAt = now + days * 86400;
  const id = identity || {};
  const token = jsonwebtoken.sign(
    {
      identity_id: entity_id,
      identity_type: 'entity',
      bridge_id: id.bridge_id || null,
      display_name: id.display_name || null,
      kind: 'api_key',
      scopes,
      jti: keyId,
      iat: now,
      exp: expiresAt
    },
    process.env.JWT_SECRET,
    { algorithm: 'HS256' }
  );
  const rec = { jti: keyId, name, scopes, created_at: new Date().toISOString(), expires_at: new Date(expiresAt * 1000).toISOString(), last4: token.slice(-4) };
  /* ⭐ A KEY MADE BY A KEY NAMES ITS MAKER (2026-09-27). A counter may pair a TV; the screen key it yields records the
     counter key's jti, and middleware/auth refuses it the moment that counter key is revoked or closed — so nothing a
     counter hands out can outlive the counter. Athi: "yes, screen codes only". */
  if (opts.parent) rec.parent = String(opts.parent);
  /* PEOPLE-SRV1 (G4): A KEY A PERSON OPENS NAMES THE PERSON. The token is the shop's (identity_type 'entity'), so auth's
     "is this co-assist still on" check never sees it — switching the person off now ends it (endKeysBy). An owner's key has no `by`. */
  if (id.parent_entity_id && id.identity_id) rec.by = String(id.identity_id);
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
    const lockedRow = await db.query('SELECT policy_flags FROM identities WHERE identity_id = $1 FOR UPDATE', [entity_id]);
    const policyFlags = (lockedRow.rows[0] && lockedRow.rows[0].policy_flags) || {};
    const keys = Array.isArray(policyFlags.api_keys) ? policyFlags.api_keys : [];
    /* ⚠️ a CLOSED counter is kept as history and must not use up a place — closing one is how a shop makes room */
    if (keys.filter((item) => !(item && item.till && item.till.closed_at)).length >= 20)
      throw Object.assign(new Error('Twenty keys at most — revoke one first.'), { status: 400 });
    await policy.patchKey(db, entity_id, [], { api_keys: keys.concat([rec]) }, { op: 'merge' });
  });
  return Object.assign({ key: token }, rec);
}

/**
 * endKeysBy(db, entity_id, person) → { closed, revoked, jtis } — PEOPLE-SRV1 (G4): every live key the person opened (`by`) ends,
 * on the caller's transaction client, in ONE locked read and ONE write of api_keys:
 *   · a counter key is CLOSED as POST /api/counters/:id/release closes it (till.closed_at + released) — kept as history, the
 *     counter is free, the bills still on that PC keep their numbers and come in by pairing;
 *   · any other key is dropped from the listing with the screen keys it paired — the DELETE /api/keys/:jti rule.
 * The caller forgets `jtis` (auth.forgetKey) after its COMMIT. Keys made before `by` was recorded are not touched.
 */
async function endKeysBy(db, entity_id, person) {
  const holderIds = String(person || '');
  if (!holderIds) return { closed: 0, revoked: 0, jtis: [] };
  const lockedRow = await db.query('SELECT policy_flags FROM identities WHERE identity_id = $1 FOR UPDATE', [entity_id]);
  const policyFlags = (lockedRow.rows[0] && lockedRow.rows[0].policy_flags) || {};
  const keys = Array.isArray(policyFlags.api_keys) ? policyFlags.api_keys : [];
  const mine = keys.filter((item) => item && String(item.by || '') === holderIds && !isClosed(item));
  if (!mine.length) return { closed: 0, revoked: 0, jtis: [] };
  const now = new Date().toISOString();
  const tills = new Set(mine.filter((item) => item.till).map((item) => String(item.jti)));
  const gone = new Set(mine.filter((item) => !item.till).map((item) => String(item.jti)));
  const jtis = new Set(mine.map((item) => String(item.jti)));
  const left = keys
    .filter((item) => {
      if (!item) return false;
      if (gone.has(String(item.jti)) || gone.has(String(item.parent || ''))) {
        jtis.add(String(item.jti));
        return false;
      }
      return true;
    })
    .map((item) => (tills.has(String(item.jti)) ? Object.assign({}, item, { till: Object.assign({}, item.till, { closed_at: now, released: true }) }) : item));
  await policy.patchKey(db, entity_id, [], { api_keys: left }, { op: 'merge' });
  return { closed: tills.size, revoked: gone.size, jtis: [...jtis] };
}
/**
 * setEnrol(entity_id, jti, patch) → the key's enrolment record after the patch (null if the key is not listed). Clears the auth cache.
 * ⚠️ FOR UPDATE, same reason as mint() — an owner approving a connector while another request touches the same
 * key list must not have the whole-array write silently drop the other one's change (2026-09-23).
 */
const setEnrol = async (entity_id, keyId, patch) => {
  let out = null;
  await withTransaction(async (db) => {
    const lockedRow = await db.query('SELECT policy_flags FROM identities WHERE identity_id = $1 FOR UPDATE', [entity_id]);
    const policyFlags = (lockedRow.rows[0] && lockedRow.rows[0].policy_flags) || {};
    const keys = Array.isArray(policyFlags.api_keys) ? policyFlags.api_keys : [];
    const keyRecord = keys.find((x) => x && String(x.jti) === String(keyId));
    if (!keyRecord) return;
    keyRecord.enrol = Object.assign({}, keyRecord.enrol || {}, patch || {});
    out = keyRecord.enrol;
    await policy.patchKey(db, entity_id, [], { api_keys: keys }, { op: 'merge' });
  });
  if (out) auth.forgetKey(keyId);
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
const setSeen = async (entity_id, keyId, at) => {
  const seen = { at: new Date().toISOString(), ip: (at && at.ip) || null, agent: (at && at.agent) || null };
  await patchKey(entity_id, keyId, { seen }); /* ⚠️ never save() — see patchKey */
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
  for (let index = 1; index <= 9; index++) out.push('C' + index);
  for (let L = 65; L <= 90; L++) {
    if (L === 67) continue;
    for (let index = 1; index <= 9; index++) out.push(String.fromCharCode(L) + index);
  }
  return out;
})();
/**
 * ⭐ WHICH ENGINE RELEASES A COUNTER RUNS (2026-09-28). The counter sends "money:1.0.0,signin:1.6.0,…" with its
 * snapshot call; it is kept on THIS key's till record (identities.policy_flags.api_keys[].till.engines — the JSON the
 * claim already writes, no new table), so the shop's counter list can say which rules each counter bills with.
 * ⚠️ Read, never trusted: names and versions are shape-checked and capped; nothing downstream decides on them yet.
 */
function cleanEngines(rawEngines) {
  if (!rawEngines) return null;
  const text = Array.isArray(rawEngines) ? rawEngines.join(',') : String(rawEngines);
  const out = {};
  text
    .split(',')
    .slice(0, 60)
    .forEach((pair) => {
      const pairMatch = /^([a-z0-9-]{1,32}):([0-9A-Za-z.-]{1,20})$/.exec(pair.trim());
      if (pairMatch) out[pairMatch[1]] = pairMatch[2];
    });
  return Object.keys(out).length ? out : null;
}

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
    const queryResult = await db.query(
      `SELECT DISTINCT upper(business_json->'till'->>'id') AS id FROM chit_header
        WHERE entity_id = $1 AND business_json->>'client_ref' IS NOT NULL AND business_json->'till'->>'id' IS NOT NULL`,
      [entity_id]
    );
    queryResult.rows.forEach((x) => {
      if (x.id) out.add(x.id);
    });
    await db.query('RELEASE SAVEPOINT booked');
  } catch (_) {
    try {
      await db.query('ROLLBACK TO SAVEPOINT booked');
    } catch (__) {
      logger.fellBack('keys bookedPrefixes: the read failed — carried on without it', __);
    }
  }
  return out;
}

/** holderParts(req.till | 'key:..' | 'dev:..') → { jti } | { device_id, by, jti_session } | {} */
function holderParts(holderArg) {
  if (!holderArg) return {};
  const holderText = typeof holderArg === 'string' ? holderArg : String(holderArg.holder || '');
  if (holderText.indexOf('key:') === 0) return { jti: (holderArg.key && holderArg.key.jti) || holderText.slice(4) };
  if (holderText.indexOf('dev:') === 0) return { device_id: holderArg.device_id || holderText.slice(4), by: holderArg.by || null, session: (holderArg.session && holderArg.session.jti) || null };
  return {};
}
/** devicePrefixes(pf, except) → Set of the prefixes phones hold (policy_flags.devices[d].till.prefix), but `except`'s own.
 *  ⚠️ A REVOKED phone keeps its prefix reserved: its unsent bills are kept on it and still carry that number. */
function devicePrefixes(policyFlags, except) {
  const devices = policyFlags && policyFlags.devices && typeof policyFlags.devices === 'object' ? policyFlags.devices : {};
  const out = new Set();
  Object.keys(devices).forEach((id) => {
    const deviceTill = devices[id] && devices[id].till;
    if (id !== except && deviceTill && deviceTill.prefix) out.add(String(deviceTill.prefix).toUpperCase());
  });
  return out;
}

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
    const phoneQuery = require('./iddoc-verify').verifiedPhoneHashesStatement(String(by));
    const queryResult = await db.query(phoneQuery.text, phoneQuery.params);
    queryResult.rows.forEach((x) => {
      if (x.value_hash) out.add(String(x.value_hash));
    });
    await db.query('RELEASE SAVEPOINT phone_doc');
  } catch (_) {
    try {
      await db.query('ROLLBACK TO SAVEPOINT phone_doc');
    } catch (__) {
      logger.fellBack('keys phoneHashesOf: the read failed — carried on without it', __);
    }
  }
  return out;
}
/** the hashes an assigned number may have been filed under — with and without its leading '+', since both are allowed */
function assignedHashes(phone) {
  const docs = require('../routes/identity-docs');
  const text = docs.normPhone(phone);
  if (!text) return [];
  const bare = text.replace(/^\+/, '');
  return [docs.docHash('PHONE', bare), docs.docHash('PHONE', '+' + bare)];
}

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
async function claimDevice(db, entity_id, policyFlags, holderIds, askedFor) {
  const devices = policyFlags.devices && typeof policyFlags.devices === 'object' ? policyFlags.devices : {};
  const ownRecord = Object.prototype.hasOwnProperty.call(devices, holderIds.device_id) ? devices[holderIds.device_id] : null;
  if (!ownRecord || ownRecord.revoked_at) return null;
  const now = new Date().toISOString();
  const keys = Array.isArray(policyFlags.api_keys) ? policyFlags.api_keys : [];
  const tills = keys.filter((item) => item && Array.isArray(item.scopes) && item.scopes.indexOf('till') >= 0);
  const keyHeld = new Set(tills.map((item) => item.till && String(item.till.id || '').toUpperCase()).filter(Boolean));
  const liveKeyHeld = new Set(
    tills
      .filter((item) => !isClosed(item))
      .map((item) => item.till && String(item.till.id || '').toUpperCase())
      .filter(Boolean)
  );
  const phoneHeld = devicePrefixes(policyFlags, holderIds.device_id);
  const counters = policyFlags.counters || {};
  const mine = 'dev:' + holderIds.device_id;
  const hadPrefix = ownRecord.till && ownRecord.till.prefix ? String(ownRecord.till.prefix).toUpperCase() : null;
  const using =
    String((askedFor && askedFor.id) || '')
      .trim()
      .toUpperCase() || null;
  const engines = cleanEngines(askedFor && askedFor.engines);
  const order = (earlier, later) => TILL_IDS.indexOf(earlier.id) - TILL_IDS.indexOf(later.id);
  /* a registered counter a live key holds (or is opening) is not this phone's to take */
  const keyHolds = (counterRecord) =>
    liveKeyHeld.has(counterRecord.id) ||
    (counterRecord.held_by &&
      String(counterRecord.held_by).indexOf('dev:') !== 0 &&
      (String(counterRecord.held_by).indexOf('pending:') === 0 || tills.some((item) => String(item.jti) === String(counterRecord.held_by) && !isClosed(item))));

  /* 1 · assigned by phone number */
  let pick = null,
    counter = null;
  const assigned = Object.keys(counters)
    .map((id) => Object.assign({ id: String(id).toUpperCase() }, counters[id]))
    .filter((item) => item.assigned && item.assigned.phone)
    .sort(order);
  if (assigned.length) {
    const hashes = await phoneHashesOf(db, entity_id, holderIds.by);
    counter =
      assigned.find((item) => assignedHashes(item.assigned.phone).some((entry) => hashes.has(entry)) && !keyHolds(item) && !phoneHeld.has(item.id)) || null;
    if (counter) pick = counter.id;
  }
  /* 2 · kept */
  if (!pick && hadPrefix && !keyHeld.has(hadPrefix) && !phoneHeld.has(hadPrefix) && !counters[hadPrefix]) pick = hadPrefix;
  /* 3 · next free */
  let booked = null;
  if (!pick) {
    booked = await bookedPrefixes(db, entity_id);
    pick = TILL_IDS.find((x) => !keyHeld.has(x) && !phoneHeld.has(x) && !booked.has(x) && !counters[x]) || null;
  }
  const till = Object.assign({}, ownRecord.till || {}, {
    prefix: pick,
    at: now,
    issued: !!(askedFor && askedFor.issued) && pick === (using || hadPrefix),
    assigned_at: pick && pick === hadPrefix && ownRecord.till && ownRecord.till.assigned_at ? ownRecord.till.assigned_at : now
  });
  if (counter) till.counter = counter.id;
  else delete till.counter;
  if (engines) till.engines = engines;
  await policy.patchKey(db, entity_id, ['devices', String(holderIds.device_id), 'till'], till, { parents: false });
  /* the register: this phone holds its assigned counter, and lets go of any it held before */
  const counterPatch = (id, patch) => policy.patchKey(db, entity_id, ['counters', String(id)], patch, { op: 'merge' });
  for (const id of Object.keys(counters)) {
    const counterRecord = counters[id];
    if (counterRecord && counterRecord.held_by === mine && (!counter || String(id).toUpperCase() !== counter.id))
      await counterPatch(id, { held_by: null, held_at: null, closed_at: now });
  }
  if (counter && counter.held_by !== mine) await counterPatch(counter.id, { held_by: mine, held_at: now, opened_at: now, closed_at: null, released: null });
  if (holderIds.session) {
    try {
      require('./person-session').forget(holderIds.session);
    } catch (e) {
      logger.fellBack('keys claimDevice: the helper failed — carried on without it', e);
    }
  }

  const from = using || hadPrefix;
  const out = { id: pick, clash: pick ? null : { id: from, held_by: 'every prefix is taken' }, said: pick ? 'This phone bills as ' + pick + '.' : null };
  if (from && pick && from !== pick && (hadPrefix || (askedFor && askedFor.issued))) out.moved_from = from;
  if (counter) {
    out.counter = counter.id;
    out.name = counter.name || null;
    out.resume_next = Number(counter.next) > 0 ? Number(counter.next) : null;
    out.resume_period = counter.period || null;
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
const claimSeries = async (entity_id, holder, askedFor) =>
  withTransaction(async (db) => {
    /* ⚠️ FOR UPDATE — two counters opening at the same moment must not both be handed the same free prefix */
    const lockedRow = await db.query('SELECT policy_flags FROM identities WHERE identity_id = $1 FOR UPDATE', [entity_id]);
    const policyFlags = (lockedRow.rows[0] && lockedRow.rows[0].policy_flags) || {};
    const holderIds = holderParts(holder);
    if (holderIds.device_id) return claimDevice(db, entity_id, policyFlags, holderIds, askedFor);
    if (!holderIds.jti) return null;
    const keyId = holderIds.jti;
    const keys = Array.isArray(policyFlags.api_keys) ? policyFlags.api_keys : [];
    const ownRecord = keys.find((x) => x && String(x.jti) === String(keyId));
    if (!ownRecord) return null;
    const tills = keys.filter((item) => item && Array.isArray(item.scopes) && item.scopes.indexOf('till') >= 0);
    const older = (earlier, later) => String(earlier.created_at || '').localeCompare(String(later.created_at || ''));
    const others = tills.filter((item) => String(item.jti) !== String(keyId));
    const using =
      String((askedFor && askedFor.id) || '')
        .trim()
        .toUpperCase() || null;
    const issued = !!(askedFor && askedFor.issued);
    const now = new Date().toISOString();
    const engines = cleanEngines(askedFor && askedFor.engines);

    /**
     * ⭐⭐⭐ A KEY OPENED FOR A NAMED COUNTER TAKES THAT COUNTER'S NUMBER, AND ITS PLACE IN THE SERIES (2026-09-17).
     * Athi: *"like a co-assist — I know the counter number, and I open and close it again and again, in one PC."*
     * The counter, not the pairing, owns the prefix; routes/counters.js guarantees only one open key holds it. So
     * there is nothing to decide here — only to say which counter this is and where its run stopped, so a PC that has
     * never seen it continues rather than starting again at 0001.
     */
    if (ownRecord.counter) {
      const counterId = String(ownRecord.counter).toUpperCase();
      const counterRecord = (policyFlags.counters || {})[counterId] || {};
      ownRecord.till = Object.assign({}, ownRecord.till || {}, { id: counterId, issued: issued || Number(counterRecord.next) > 1, at: now });
      if (engines) ownRecord.till.engines = engines;
      await patchKey(entity_id, keyId, { till: ownRecord.till }, db);
      return {
        id: counterId,
        clash: null,
        counter: counterId,
        name: counterRecord.name || null,
        resume_next: Number(counterRecord.next) > 0 ? Number(counterRecord.next) : null,
        resume_period: counterRecord.period || null
      };
    }

    /* every prefix another counter of this shop holds */
    const held = new Set(others.map((item) => item.till && String(item.till.id || '').toUpperCase()).filter(Boolean));
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
    const phones = devicePrefixes(policyFlags, null);
    const registered = policyFlags.counters || {};
    const free = (except) => TILL_IDS.find((x) => !held.has(x) && !phones.has(x) && !registered[x] && !booked.has(x) && x !== except) || null;
    let out;

    if (issued && using) {
      /* this counter has numbers out under `using` — does an OLDER counter hold the same prefix? */
      const rival = others.filter((item) => item.till && String(item.till.id || '').toUpperCase() === using && item.till.issued).sort(older)[0];
      if (rival && older(rival, ownRecord) < 0) {
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
        out = {
          id: to,
          moved_from: using,
          held_by: rival.name || 'another counter',
          clash: to ? null : { id: using, held_by: rival.name || 'another counter' }
        };
        ownRecord.till = { id: to || using, issued: true, at: now };
      } else {
        /* uncontested: this counter keeps the prefix it has been billing under, and the shop now reserves it */
        out = { id: using, clash: null };
        ownRecord.till = { id: using, issued: true, at: now };
      }
    } else {
      /* nothing issued yet: keep what this key was given before, else the lowest prefix nobody holds or has billed */
      const hadPrefix = ownRecord.till && ownRecord.till.id ? String(ownRecord.till.id).toUpperCase() : null;
      const kept = hadPrefix && !held.has(hadPrefix) && !booked.has(hadPrefix) ? hadPrefix : null;
      const id = kept || free(null);
      out = { id, clash: null };
      ownRecord.till = { id, issued: false, at: now };
    }
    if (engines) ownRecord.till.engines = engines;
    await patchKey(entity_id, keyId, { till: ownRecord.till }, db);
    return out;
  });
/** claimTill(entity_id, jti, ask) — the pre-M11 name, kept for its readers: the same allocator, asked as a key */
const claimTill = (entity_id, keyId, askedFor) => claimSeries(entity_id, 'key:' + keyId, askedFor);
/** patchTill — replace one key's `till` record in one statement (see patchKey). Used by POST /api/till/close. */
const patchTill = (entity_id, keyId, till) => patchKey(entity_id, keyId, { till });
/** patchKeyWith — the same one-statement merge, on a transaction's own client (routes/counters.js) */
const patchKeyWith = (db, entity_id, keyId, patch) => patchKey(entity_id, keyId, patch, db);
/** ⭐ a closed counter is history, not a live key — see POST /api/till/close */
const isClosed = (keyRecord) => !!(keyRecord && keyRecord.till && keyRecord.till.closed_at);
const setDiag = async (entity_id, keyId, patch) => {
  const keys = await listOf(entity_id);
  if (!keys.find((x) => x && String(x.jti) === String(keyId))) return null;
  const diag = Object.assign({}, patch || {}, { at: new Date().toISOString() });
  await patchKey(entity_id, keyId, { diag }); /* ⚠️ never save() — see patchKey */
  auth.forgetKey(keyId);
  return diag;
};

module.exports = {
  listOf, patchKey, mint, endKeysBy, setEnrol, setSeen, setDiag, TILL_IDS, cleanEngines, bookedPrefixes, devicePrefixes,
  assignedHashes, claimSeries, claimTill, patchTill, patchKeyWith, isClosed
};
