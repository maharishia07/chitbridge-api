'use strict';
/**
 * ── ⭐⭐⭐ identity-auth.js — THE ONE PLACE THAT SIGNS SOMEBODY IN ─────────────────────────────────────────────
 *
 * Athi, 2026-09-23, after "entity OTP is not accepting": *"we have to sign-in using 123456 for entity id, if
 * it is co-assist, the pin number set by them in coassist page should work... always implemented in one go
 * everywhere — we already have that module I guess... a single library for all user id definition and login
 * process has been instantiated, do not reinvent."*
 *
 * He is right that the user-id HALF already exists: `lib/resolveuserid.js` classifies anything typed at a
 * login box (`docs/NAMESPACE.md` §4/§5) and `routes/actors.js`'s `splitLogin()` already asks it rather than
 * splitting `@` by hand. **This file adopts that, it does not replace it.**
 *
 * What did NOT exist is the LOGIN half once a kind is known:
 *
 *   routes/entities.js  looked up identity_type='entity' ONLY, OTP only, via lib/otp.js's raw DEV_OTP passthrough,
 *                        with its own naive `input.includes('@')` split that predates resolveuserid.js and
 *                        cannot tell a coassist's `bala@mayurbhavan` from a real email address
 *   routes/actors.js     already asks resolveuserid for the SPLIT, but OTP-vs-PIN, the attempt-lock and the
 *                        OTP generation are its own inline copy — not lib/dev-otp.js, the module written
 *                        specifically to stop a fixed test code surviving into a sealed environment
 *
 * ⭐ SO THIS FILE HOLDS: the ONE lookup that finds an entity OR a coassist from one typed string (built on
 * resolveuserid.classify(), never re-parsing '@' by hand), and the ONE verify (OTP or PIN, whichever this
 * identity needs) that both routes call. [[feedback-no-duplicate-functions]] [[feedback-adopt-dont-reinvent]]
 *
 * ⚠️ ZERO OPINIONS ABOUT TRANSPORT. Callers pass a `query` function and get back plain objects; nothing here
 * touches req/res, so the same rules run from /api/entities, /api/actors, or a future channel with no rewrite.
 */
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { generateOTP, verifyOtp } = require('./otp');
const devOtp = require('./dev-otp');
const resolveuserid = require('./resolveuserid');

const MAX_PIN_ATTEMPTS = 5;
/** ⚠️ WIDENED 2026-09-23 to carry every field a JWT needs, for either identity_type — see issueToken(). A
 *  row missing actor_key/actor_role/actor_type is exactly how a coassist signing in through THIS door would
 *  have gotten a token actors.js's own /login never would have issued them. */
const IDENTITY_COLS = `identity_id, bridge_id, display_name, email, user_id, identity_type, parent_entity_id,
                       actor_key, actor_role, actor_type,
                       pin_hash, pin_attempts, pin_locked_at,
                       otp_code, otp_expires_at, otp_attempts, owner_scope, status, break_status`;

/**
 * findEntityByNameOrHandle — the SAME resolution routes/entities.js already does for a typed entity name: try
 * the unique handle first, then display_name, refusing on ambiguity. Extracted so a coassist's `@entity` half
 * resolves through the identical rule, rather than a second copy that could drift from it.
 */
async function findEntityByNameOrHandle(query, name) {
  let found = await query(
    `SELECT identity_id, bridge_id, display_name, user_id FROM identities
     WHERE LOWER(user_id) = LOWER($1) AND identity_type = 'entity' AND status = 'active'`,
    [name]
  );
  if (found.rows.length) return { ok: true, entity: found.rows[0] };
  found = await query(
    `SELECT identity_id, bridge_id, display_name, user_id FROM identities
     WHERE LOWER(display_name) = LOWER($1) AND identity_type = 'entity' AND status = 'active'`,
    [name]
  );
  if (found.rows.length > 1) return { ok: false, ambiguous: true };
  if (found.rows.length === 0) return { ok: false, ambiguous: false };
  return { ok: true, entity: found.rows[0] };
}

/* ── M14: the contact lookups findLoginIdentity() asks for a mobile number or an e-mail ─────────────────────────── */
/** the same shape lib/signin.js (the engine) calls a mobile: 8–15 digits once spaces, dashes and brackets are dropped, a + kept */
const MOBILE = /^\+?[0-9]{8,15}$/;
const mobileOf = (v) => { const d = String(v == null ? '' : v).replace(/[\s\-().]/g, ''); return MOBILE.test(d) ? d : null; };
/** is the documents table there to ask (lib/iddoc-verify.js available) — the migration may not have run; older tests' stub DBs have no schema reader */
async function docsAvailable() {
  try { return !!(await require('./iddoc-verify').available()); } catch (_) { return false; }
}
/**
 * byContact — every identity this contact proves, as IDENTITY_COLS rows, one per identity_id. `mobile` is the normalised number
 * (or null); `v` the typed string (an e-mail when not a mobile). The hashes are routes/identity-docs.js docHash() — the ONE hash
 * the PUT wrote (keys.js claimSeries reads it the same way) — of each spelling the PUT could have stored.
 */
async function byContact(query, mobile, v) {
  const out = new Map();
  /* a removed or deactivated employee cannot sign in, so they are not "someone on this contact" — the door would only refuse them */
  const gone = (r) => r.identity_type === 'actor' && r.break_status && r.break_status !== 'active';
  const add = (rows) => { for (const r of rows || []) if (r && r.identity_id && !gone(r) && !out.has(r.identity_id)) out.set(r.identity_id, r); };
  const byIds = async (ids) => { for (const id of ids) add((await query(`SELECT ${IDENTITY_COLS} FROM identities WHERE identity_id = $1`, [id])).rows); };
  if (mobile) {
    const bare = mobile.replace(/^\+/, '');
    if (await docsAvailable()) {
      const docs = require('../routes/identity-docs');
      await byIds(await require('./iddoc-verify').identitiesByVerifiedContact(query, 'PHONE', [docs.docHash('PHONE', bare), docs.docHash('PHONE', '+' + bare)]));
    }
    add((await query(`SELECT ${IDENTITY_COLS} FROM identities WHERE identity_type = 'customer' AND (phone = $1 OR phone = $2)`, [bare, '+' + bare])).rows);
    return Array.from(out.values());
  }
  const email = v.toLowerCase();
  add((await query(`SELECT ${IDENTITY_COLS} FROM identities WHERE email = $1 AND identity_type = 'entity'`, [email])).rows);
  if (await docsAvailable()) {
    const docs = require('../routes/identity-docs');
    await byIds(await require('./iddoc-verify').identitiesByVerifiedContact(query, 'EMAIL', [docs.docHash('EMAIL', email)]));
  }
  add((await query(`SELECT ${IDENTITY_COLS} FROM identities WHERE identity_type = 'customer' AND otp_contact = $1`, [email])).rows);
  return Array.from(out.values());
}
/**
 * choicesOf — what the door shows when one contact is several people: `id` is the STORED id the page sends back (the grammar
 * travels here, never typed), `kind` a plain word, `name` the person, `shop` where. A removed or deactivated employee is not offered.
 */
async function choicesOf(query, rows) {
  const out = [];
  for (const r of rows) {
    if (r.identity_type === 'actor' && r.break_status && r.break_status !== 'active') continue;
    let shop = r.display_name, parentHandle = null;
    if (r.parent_entity_id) {
      const p = (await query('SELECT display_name, user_id FROM identities WHERE identity_id = $1', [r.parent_entity_id])).rows[0];
      if (p) { shop = p.display_name; parentHandle = p.user_id; }
    }
    /* an employee row from before b260 has no user_id: the handle is MINTED by the one grammar module, never composed here */
    const minted = (r.identity_type === 'actor' && !r.user_id && parentHandle) ? require('./mintuserid').employee(r.actor_key, { user_id: parentHandle }) : null;
    const id = r.identity_type === 'actor' ? (r.user_id || (minted && minted.handle) || null)
             : r.identity_type === 'customer' ? r.email
             : (r.user_id || r.email);
    if (!id) continue;
    out.push({ id, kind: r.identity_type === 'actor' ? 'employee' : r.identity_type === 'customer' ? 'customer' : 'owner',
               name: r.display_name || '', shop: shop || '' });
  }
  return out;
}

/**
 * findLoginIdentity — the ONE lookup, for anything resolveuserid.classify() can tell apart.
 *
 *   a real email           → identities.email, identity_type='entity' (unchanged from today)
 *   a stored handle        → identities.user_id, exact match, ANY identity_type — this alone already finds a
 *                             coassist typed in the b260 form (`bala@mayurbhavan.br`), no classify() needed
 *   `key@entity`, unsuffixed → resolveuserid says `employee_typed`; resolve the entity half exactly as
 *                             routes/actors.js's splitLogin() already does, then the actor scoped under it
 *
 * Returns { identity, ambiguous } — `ambiguous: true` means stop and ask for the fuller form, never guess.
 *
 * ⭐ ctx.shop (P1b · M202, DECISIONS 2026-10-08 "the ID grammar is added behind the scenes"): when the door NAMES the shop (the till's own
 * counter, or a name picked from the shop's own list) a bare short id (`asha01`) is asked as `asha01@<shop>` FIRST — the shop's own staff
 * by the id they type. A bare id with no shop context, a mobile and an e-mail are untouched; nothing here ever looks in another shop.
 */
async function findLoginIdentity(query, input, ctx) {
  let v = String(input == null ? '' : input).trim();
  if (!v) return { identity: null, ambiguous: false };
  const shop = String((ctx && ctx.shop) || '').trim().toLowerCase();
  if (shop && shop.length <= 120 && !/[@s]/.test(shop) && !v.includes('@') && !mobileOf(v)) {
    const own = await findLoginIdentity(query, v + '@' + shop);
    if (own.identity || own.ambiguous) return own;
  }

  /**
   * ── ⭐⭐⭐ M14 — A MOBILE NUMBER OR AN E-MAIL FINDS THE PERSON BEHIND IT (DECISIONS 2026-10-08, Athi: *"only the mobile
   * number or email should be used for sign-in … .br / .cr can be combined behind the scene"*). A person types the contact;
   * the stored id, grammar and all, is found here and never typed. What counts as "their" contact:
   *   · the account's own sign-in e-mail (identities.email, an entity — exactly today's lookup)
   *   · a VERIFIED identity document, PHONE or EMAIL (lib/iddoc-verify.js identitiesByVerifiedContact — M18's one reader;
   *     a contact typed into a form but never proved by a code opens nothing)
   *   · a customer's own contact (identities.phone / otp_contact — proved by the code the storefront sent to it)
   * ⚠️ SEVERAL IDENTITIES ON ONE CONTACT → { ambiguous: true, choices } — the door asks WHICH, never guesses (an owner here
   * who is an employee there is the ordinary case). `via: 'contact'` tells the door the row came from here.
   * ⚠️ A string that is neither (a user id, key@Shop, a name) goes through the lookups below exactly as before.
   */
  const mobile = mobileOf(v);
  if (mobile || v.includes('@')) {
    const found = await byContact(query, mobile, v);
    if (found.length === 1) return { identity: found[0], ambiguous: false, via: 'contact' };
    if (found.length > 1) return { identity: null, ambiguous: true, via: 'contact', choices: await choicesOf(query, found) };
  }

  const byHandle = await query(`SELECT ${IDENTITY_COLS} FROM identities WHERE LOWER(user_id) = LOWER($1)`, [v]);
  if (byHandle.rows.length) return { identity: byHandle.rows[0], ambiguous: false };

  // ⚠️ ONLY NOW does the grammar get asked — exact matches above cover every already-known handle without it.
  const c = resolveuserid.classify(v);
  if (c.kind === 'customer') {
    /* the stored .cr handle (identities.email, mintuserid.customer) — what the chooser hands back for a customer */
    const cust = await query(`SELECT ${IDENTITY_COLS} FROM identities WHERE email = $1 AND identity_type = 'customer'`, [v.toLowerCase()]);
    return { identity: cust.rows[0] || null, ambiguous: false };
  }
  if (c.kind === 'employee' || c.kind === 'employee_typed') {
    const e = await findEntityByNameOrHandle(query, c.at);
    if (!e.ok) return { identity: null, ambiguous: !!e.ambiguous };
    const actor = await query(
      `SELECT ${IDENTITY_COLS} FROM identities
       WHERE actor_key = $1 AND parent_entity_id = $2 AND identity_type = 'actor'`,
      [c.actor_key, e.entity.identity_id]
    );
    return { identity: actor.rows[0] || null, ambiguous: false };
  }

  return { identity: null, ambiguous: false };
}

/** ⭐ the one question that decides what happens next. A coassist who has never signed in has no PIN yet — OTP,
 *  same as an entity, exactly once — and sets a PIN afterwards on their own Co-assists page, not here. */
function needsPin(identity) {
  return !!(identity && identity.identity_type === 'actor' && identity.pin_hash);
}

/**
 * issueOtp — writes a fresh code and returns it. The ONE call site for "make a code exist", so the fixed test
 * code (lib/dev-otp.js) reaches every flow that can request one, not just the ones somebody remembered.
 * ⚠️ 'entity' kind for both an entity AND a first-time coassist — dev-otp.js has no separate coassist default,
 * and inventing one changes what a shopkeeper types for no reason anyone asked for.
 */
async function issueOtp(query, identity, ttlMs, kind) {
  /* M14: a CUSTOMER's fixed test code is its own (DEV_OTP_CUSTOMER, lib/dev-otp.js) — the storefront's door has always used it */
  const otp = devOtp.fixedOtp(kind || 'entity') || generateOTP();
  const expires = new Date(Date.now() + (ttlMs || 60 * 60 * 1000));
  await query(
    `UPDATE identities SET otp_code = $1, otp_expires_at = $2, otp_attempts = 0 WHERE identity_id = $3`,
    [otp, expires, identity.identity_id]
  );
  return otp;
}

/**
 * verifyCredential — OTP or PIN, whichever this identity needs, ONE attempt-lock shape either way.
 * Returns { ok:true } or { ok:false, status, message, use_pin? }.
 */
/*
 * ⭐ M06: THE ONE PIN ENGINE. routes/actors.js /login had its own bcrypt + attempt-lock copy (L824-852); it is gone, and
 * /api/actors/login now answers through this function like every other door. Each refusal carries `reason`
 * (PIN_REQUIRED · PIN_LOCKED · PIN_WRONG · OTP_WRONG · OTP_LOCKED · OTP_EXPIRED), `method` and, for a wrong PIN, `left` —
 * so a door can keep its own words (routes/signin.js WORDS) while the rule, the count and the lock stay here, once.
 */
async function verifyCredential(query, identity, { otp, pin } = {}) {
  if (needsPin(identity)) {
    const p = String(pin == null ? '' : pin).trim();
    if (!p) return { ok: false, status: 400, message: 'Enter your PIN.', use_pin: true, method: 'pin', reason: 'PIN_REQUIRED' };
    if (identity.pin_locked_at)
      return { ok: false, status: 400, message: 'Too many wrong attempts. Ask your admin to reset your PIN.', method: 'pin', reason: 'PIN_LOCKED' };
    const match = await bcrypt.compare(p, identity.pin_hash);
    if (!match) {
      const n = (identity.pin_attempts || 0) + 1;
      const lock = n >= MAX_PIN_ATTEMPTS;
      await query(
        `UPDATE identities SET pin_attempts = $1${lock ? ', pin_locked_at = NOW()' : ''} WHERE identity_id = $2`,
        [n, identity.identity_id]
      );
      return { ok: false, status: 400, use_pin: true, method: 'pin', reason: lock ? 'PIN_LOCKED' : 'PIN_WRONG',
        left: MAX_PIN_ATTEMPTS - n, locked_now: lock,
        message: lock ? 'Account locked after 5 wrong attempts. Ask your admin to reset your PIN.'
                       : `Incorrect PIN. ${MAX_PIN_ATTEMPTS - n} attempt${MAX_PIN_ATTEMPTS - n === 1 ? '' : 's'} left.` };
    }
    await query(`UPDATE identities SET pin_attempts = 0, last_active_at = NOW() WHERE identity_id = $1`,
      [identity.identity_id]);
    return { ok: true };
  }
  // ⭐ OTP path — lib/otp.js's own attempt cap and constant-time compare, unchanged and still tested there.
  const check = await verifyOtp(query, identity, otp);
  if (!check.ok) return Object.assign({ method: 'otp' }, check);
  await query(
    `UPDATE identities SET otp_code = NULL, otp_expires_at = NULL, otp_attempts = 0,
     status = 'active', last_active_at = NOW() WHERE identity_id = $1`,
    [identity.identity_id]
  );
  return { ok: true };
}

/** the one PIN hash (bcrypt, cost 10 — as set-pin and change-pin always wrote it) and the one compare */
const PIN_COST = 10;
const hashPin = (pin) => bcrypt.hash(String(pin), PIN_COST);
const pinMatches = (pin, hash) => (hash ? bcrypt.compare(String(pin == null ? '' : pin), hash) : Promise.resolve(false));
/** setPin — a new PIN for this identity: attempts reset, lock cleared (moved from routes/actors.js set-pin, M06) */
async function setPin(query, identity_id, pin) {
  const pin_hash = await hashPin(pin);
  await query(
    `UPDATE identities
     SET pin_hash = $1, pin_set_at = NOW(),
         pin_attempts = 0, pin_locked_at = NULL
     WHERE identity_id = $2`,
    [pin_hash, identity_id]
  );
}

/**
 * ── ⭐⭐ ONE SPLITTER FOR WHAT SOMEBODY TYPES AT A SIGN-IN BOX (moved from routes/actors.js, M06) ──────────────────
 * Athi, 2026-09-15: *"can you ensure that no different place has another logic for naming convention."* So the split asks
 * lib/resolveuserid.js's grammar; a shape it does not know is halved at the first '@', exactly as split('@') did.
 */
function splitLogin(username) {
  const c = resolveuserid.classify(username);
  if (c.kind === 'employee' || c.kind === 'employee_typed') {
    return { actor_key: c.actor_key, entity_name: c.at };
  }
  const s = String(username == null ? '' : username);
  const at = s.indexOf('@');
  return at < 0 ? { actor_key: s, entity_name: undefined }
                : { actor_key: s.slice(0, at), entity_name: s.slice(at + 1) };
}

/**
 * ── ⭐⭐⭐ issueToken — THE ONE PLACE A SIGN-IN BECOMES A TOKEN ([capability: sign-in], 2026-09-23) ────────────
 *
 * Athi: *"it has to be part of identity auth js."* Right — this was the exact bug that would have recurred.
 * routes/entities.js's /verify built its own jwt.sign() call, and the first version of today's fix left
 * `parent_entity_id` out of it: harmless for an entity, but for a coassist it means
 * `auth.entityOf(req) = req.identity.parent_entity_id || req.identity.identity_id` silently falls through to
 * the COASSIST's OWN id — every authed route after sign-in, starting with the one this whole redesign exists
 * for (`POST /api/till/enrol`), would then act on the wrong "whose data is this".
 *
 * ⚠️ ONE FUNCTION, so that mistake can only ever be made once. It takes the identity row this file's own
 * findLoginIdentity() already returns and builds the complete, correct payload for whichever identity_type it
 * is — including the one extra lookup an ACTS-FOR identity needs (their parent's name and bridge id, for a
 * screen to show which shop this now is) — so no caller assembles a JWT by hand again.
 *
 * ⚠️⚠️ NOT ONLY A COASSIST ACTS FOR A PARENT. A storefront CUSTOMER does too — routes/catalogue.js minted its
 * own JWT, twice, with `parent_entity_id: entity.identity_id` written out by hand both times. It happened to
 * get the field right, which is not the same as it being safe: a third hand-built copy is a third place the
 * SAME mistake can be made once more. `ACTS_FOR_PARENT` is the one list that decides which identity_types
 * carry a parent at all; the actor-only fields (actor_key/role/type) stay actor-only underneath it.
 */
const ACTS_FOR_PARENT = ['actor', 'customer'];
/**
 * ⭐⭐ M05 (D3, 2026-10-07) — issueToken(query, identity, { device_id, surface, ua, label }) — A DEVICE THAT NAMES ITSELF GETS
 * A SESSION: the token carries kind:'person' + jti + device_id + surface, its life is 30 d on surface 'till' and 7 d
 * elsewhere, and the jti is LISTED under the device in the shop's policy_flags.devices (lib/person-session.js) — so it can
 * be logged out, renewed and revoked. Without a device id the token is exactly today's (legacy: 7 d, no jti, unlisted):
 * a page that never named its device would not send X-Device-Id either, and a bound token would 401 every request.
 * ⚠️ IF THE LISTING CANNOT BE WRITTEN, THE SIGN-IN STILL SUCCEEDS with a legacy token, logged loudly — a person is never
 * refused at the door over our bookkeeping. A REVOKED device is the one refusal (403 DEVICE_REVOKED): the owner removed it.
 * Customers (storefront) are not person sessions — their token is unchanged.
 */
const SESSION_TYPES = ['entity', 'actor'];
async function issueToken(query, identity, opts) {
  const base = {
    identity_id: identity.identity_id,
    bridge_id: identity.bridge_id,
    display_name: identity.display_name,
    email: identity.email || null,
    identity_type: identity.identity_type,
    owner_scope: identity.owner_scope || identity.identity_type,
  };
  if (ACTS_FOR_PARENT.includes(identity.identity_type)) {
    let parent = { display_name: null, bridge_id: null };
    try {
      const p = await query('SELECT display_name, bridge_id FROM identities WHERE identity_id = $1', [identity.parent_entity_id]);
      if (p.rows[0]) parent = p.rows[0];
    } catch (_) { /* a token is still issued — the screen just cannot NAME the shop until the next read */ }
    Object.assign(base, {
      ...(identity.identity_type === 'actor'
        ? { actor_key: identity.actor_key, actor_role: identity.actor_role, actor_type: identity.actor_type }
        : {}),
      parent_entity_id: identity.parent_entity_id,
      parent_entity_name: parent.display_name,
      parent_bridge_id: parent.bridge_id,
    });
  }
  const o = opts || {};
  const sessions = require('./person-session');
  const device_id = sessions.deviceIdOf(o.device_id);
  if (device_id && SESSION_TYPES.includes(identity.identity_type)) {
    let s = null;
    try {
      s = await sessions.open(require('../db').withTransaction, sessions.shopOf(identity),
        { device_id, surface: o.surface, by: identity.identity_id, ua: o.ua, label: o.label });
    } catch (e) {
      if (e && e.code === 'DEVICE_REVOKED') throw e;
      console.error('issueToken: the session could not be listed — a legacy token was issued instead:', (e && e.message) || e);
    }
    if (s) return signToken(base, s);
  }
  return signToken(base, null);
}

/**
 * signToken(claims, session|null) — THE ONE jwt.sign FOR A PERSON. issueToken() calls it at sign-in and
 * POST /api/signin/renew calls it with the renewed session, so a renewed token carries exactly the claims the sign-in
 * gave it. Session claims are always written from `session`, never carried over from the old token.
 */
const SESSION_CLAIMS = ['iat', 'exp', 'nbf', 'jti', 'device_id', 'kind', 'surface'];
function signToken(claims, session) {
  const base = Object.assign({}, claims);
  SESSION_CLAIMS.forEach((k) => { delete base[k]; });
  if (!session) return jwt.sign(base, process.env.JWT_SECRET, { expiresIn: '7d' });
  return jwt.sign(Object.assign(base, { kind: 'person', jti: session.jti, device_id: session.device_id, surface: session.surface,
                                        iat: session.iat, exp: session.exp }), process.env.JWT_SECRET, { algorithm: 'HS256' });
}

/**
 * personShape — the ONE shape every caller hands back to a client, whatever the identity_type. This is what
 * closes the gap lib/signin.js's keep() was written against: it reads `a.identity || a.user`, and neither
 * routes/entities.js's `entity:` key nor routes/actors.js's `actor:` key ever matched that. Both now also
 * carry `identity:` in this one shape, so the SAME client code reads an entity and a coassist alike.
 */
function personShape(identity) {
  return {
    identity_id: identity.identity_id,
    bridge_id: identity.bridge_id,
    display_name: identity.display_name,
    email: identity.email || null,
    user_id: identity.user_id || null,
    identity_type: identity.identity_type,
    /**
     * ⭐⭐⭐ THE SHOP THIS PERSON WORKS FOR (2026-09-28). Athi signed in to shop X on a counter, signed out, signed
     * in as shop Y — and was still looking at shop X's products. The counter could not have noticed: nothing in
     * this answer said which shop a person belongs to, so lib/signin.js keep()'s `entity` was always null. An
     * owner IS the shop; a co-assist belongs to its parent_entity_id — the same rule issueToken() writes into the
     * token, stated in the clear so a counter can compare it with the shop it holds, offline, without a token.
     */
    entity_id: identity.parent_entity_id || identity.identity_id,
  };
}

module.exports = {
  findLoginIdentity, findEntityByNameOrHandle, mobileOf, needsPin, issueOtp, verifyCredential, issueToken, signToken, personShape,
  hashPin, pinMatches, setPin, splitLogin,
  MAX_PIN_ATTEMPTS,
};
