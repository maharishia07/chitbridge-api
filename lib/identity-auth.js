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
const { generateOTP, verifyOtp } = require('./otp');
const devOtp = require('./dev-otp');
const resolveuserid = require('./resolveuserid');

const MAX_PIN_ATTEMPTS = 5;
const IDENTITY_COLS = `identity_id, bridge_id, display_name, email, user_id, identity_type, parent_entity_id,
                       pin_hash, pin_attempts, pin_locked_at,
                       otp_code, otp_expires_at, otp_attempts, owner_scope, status`;

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
 */
async function findLoginIdentity(query, input) {
  const v = String(input == null ? '' : input).trim();
  if (!v) return { identity: null, ambiguous: false };

  if (v.includes('@')) {
    const byEmail = await query(`SELECT ${IDENTITY_COLS} FROM identities WHERE email = $1 AND identity_type = 'entity'`,
      [v.toLowerCase()]);
    if (byEmail.rows.length) return { identity: byEmail.rows[0], ambiguous: false };
  }

  const byHandle = await query(`SELECT ${IDENTITY_COLS} FROM identities WHERE LOWER(user_id) = LOWER($1)`, [v]);
  if (byHandle.rows.length) return { identity: byHandle.rows[0], ambiguous: false };

  // ⚠️ ONLY NOW does the grammar get asked — exact matches above cover every already-known handle without it.
  const c = resolveuserid.classify(v);
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
async function issueOtp(query, identity, ttlMs) {
  const otp = devOtp.fixedOtp('entity') || generateOTP();
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
async function verifyCredential(query, identity, { otp, pin } = {}) {
  if (needsPin(identity)) {
    const p = String(pin == null ? '' : pin).trim();
    if (!p) return { ok: false, status: 400, message: 'Enter your PIN.', use_pin: true };
    if (identity.pin_locked_at)
      return { ok: false, status: 400, message: 'Too many wrong attempts. Ask your admin to reset your PIN.' };
    const match = await bcrypt.compare(p, identity.pin_hash);
    if (!match) {
      const n = (identity.pin_attempts || 0) + 1;
      const lock = n >= MAX_PIN_ATTEMPTS;
      await query(
        `UPDATE identities SET pin_attempts = $1${lock ? ', pin_locked_at = NOW()' : ''} WHERE identity_id = $2`,
        [n, identity.identity_id]
      );
      return { ok: false, status: 400, use_pin: true,
        message: lock ? 'Account locked after 5 wrong attempts. Ask your admin to reset your PIN.'
                       : `Incorrect PIN. ${MAX_PIN_ATTEMPTS - n} attempt${MAX_PIN_ATTEMPTS - n === 1 ? '' : 's'} left.` };
    }
    await query(`UPDATE identities SET pin_attempts = 0, last_active_at = NOW() WHERE identity_id = $1`,
      [identity.identity_id]);
    return { ok: true };
  }
  // ⭐ OTP path — lib/otp.js's own attempt cap and constant-time compare, unchanged and still tested there.
  const check = await verifyOtp(query, identity, otp);
  if (!check.ok) return check;
  await query(
    `UPDATE identities SET otp_code = NULL, otp_expires_at = NULL, otp_attempts = 0,
     status = 'active', last_active_at = NOW() WHERE identity_id = $1`,
    [identity.identity_id]
  );
  return { ok: true };
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
  };
}

module.exports = {
  findLoginIdentity, findEntityByNameOrHandle, needsPin, issueOtp, verifyCredential, personShape, MAX_PIN_ATTEMPTS,
};
