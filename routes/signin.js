'use strict';
/**
 * /api/signin — A PERSON'S SESSIONS: renew · logout · list · revoke (M05, SPEC-iam-build §4.2, D3, D14).
 *
 *   POST /api/signin/renew              (person)  → { token, jti, exp, device_id } — new jti, same device, old jti gone
 *   POST /api/signin/logout             (person)  → { ok, removed } — removes this session's jti; 200 even if already gone
 *   GET  /api/signin/sessions           (person)  → { sessions:[…] } — my own sessions on every device in this shop
 *   GET  /api/signin/devices            (owner)   → { devices:[…] } — every device listed in this shop
 *   POST /api/signin/sessions/revoke    { jti }        — my own session, or (owner) anyone's
 *                                       { device_id }  — (owner) the device: revoked_at, every session on it ends
 *
 * M06 — THE SIGN-IN ITSELF LIVES HERE NOW (handlers MOVED, not copied — see the block "M06" below):
 *   POST /api/signin/ask     { id | email | user_id }        → the login half of /api/entities/register
 *   POST /api/signin/verify  { id | email | user_id, otp|pin } → /api/entities/verify, whole
 *                            { username, pin|otp }             → /api/actors/login (key@Display Name), same handler
 *   POST /api/signin/pin     (auth) { pin, confirm_pin }       → /api/actors/set-pin
 * and the OLD PATHS ARE ALIASES — the same handler functions, mounted by routes/entities.js and routes/actors.js.
 *
 * Sessions are stored and judged in ONE place,
 * lib/person-session.js; a token is signed in ONE place, lib/identity-auth.js (issueToken / signToken).
 *
 * ⚠️ A KEY CANNOT SIGN IN. Every route here answers a key (kind:'api_key', a counter PC / connector / screen) 403 —
 * keys are listed and revoked on /api/keys.
 * ⭐ A LEGACY TOKEN (no jti, issued before M05 or by a page that did not name its device) is welcome here: logout answers
 * 200 (nothing listed to remove — the page clears itself), and renew turns it into a listed session when the request
 * names its device (X-Device-Id) — so a phone can move onto a revocable session without anybody signing in again.
 */
const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const auth = require('../middleware/auth');
const { query, withTransaction, withEntity } = require('../db');
const sessions = require('../lib/person-session');
const identityAuth = require('../lib/identity-auth');
const { isOwner } = require('../lib/owner');

const personOnly = (req, res, next) => {
  if (req.api_key) { res.locals.code = 'KEY_CANNOT_SIGN_IN';
    return res.status(403).json({ error: 'Forbidden', code: 'KEY_CANNOT_SIGN_IN', message: 'A key cannot sign in — sign in.' }); }
  next();
};
const ownerOnly = (req, res, next) => (isOwner(req) ? next()
  : res.status(403).json({ error: 'Forbidden', message: 'Only the owner may do this.' }));
const fail = (res, e) => {
  const status = (e && e.status) || 500;
  if (e && e.code) res.locals.code = e.code;
  if (status >= 500) console.error('signin:', (e && e.message) || e);
  res.status(status).json({ error: status >= 500 ? 'Server error' : 'Refused', code: (e && e.code) || null,
                            message: status >= 500 ? 'Could not change your session. This is our fault.' : String(e.message) });
};
/** the claims of the token this request came with — auth already verified it */
const claimsOf = (req) => jwt.decode(String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')) || {};
const shopOf = (req) => auth.entityOf(req);
const me = (req) => req.identity.identity_id;

router.post('/renew', auth, personOnly, async (req, res) => {
  try {
    const shop = shopOf(req);
    let s;
    if (req.session) {
      s = await sessions.renew(withTransaction, shop, req.session.device_id, req.session.jti, me(req));
    } else {
      /* a legacy token: becomes a listed session on the device the request names — or stays as it is */
      const device_id = sessions.deviceIdOf(req.headers['x-device-id']);
      if (!device_id) return res.status(400).json({ error: 'Refused', code: 'NO_DEVICE', message: 'Send X-Device-Id to renew.' });
      s = await sessions.open(withTransaction, shop, { device_id, surface: (req.body && req.body.surface) || 'web', by: me(req),
        ua: String(req.headers['user-agent'] || '').slice(0, 160) || null });
    }
    const token = identityAuth.signToken(claimsOf(req), s);
    res.json({ token, jti: s.jti, exp: s.exp, device_id: s.device_id, surface: s.surface });
  } catch (e) { fail(res, e); }
});

router.post('/logout', auth, personOnly, async (req, res) => {
  try {
    if (!req.session) return res.json({ ok: true, removed: false, legacy: true });
    const out = await sessions.close(withTransaction, shopOf(req), req.session.device_id, req.session.jti);
    res.json({ ok: true, removed: out.removed });
  } catch (e) { fail(res, e); }
});

router.get('/sessions', auth, personOnly, async (req, res) => {
  try {
    const devices = await sessions.devicesOf(query, shopOf(req));
    const t = Math.floor(Date.now() / 1000), out = [];
    for (const [device_id, d] of Object.entries(devices)) {
      if (!d || d.revoked_at) continue;
      for (const s of (d.sessions || [])) {
        if (!s || s.by !== me(req) || Number(s.exp) <= t) continue;
        out.push({ jti: s.jti, device_id, surface: s.surface || null, iat: s.iat, exp: s.exp,
                   current: !!(req.session && req.session.jti === s.jti),
                   device: { label: d.label || null, kind: d.kind || null, seen: d.seen || null } });
      }
    }
    res.json({ sessions: out, legacy: !req.session });
  } catch (e) { fail(res, e); }
});

router.get('/devices', auth, personOnly, ownerOnly, async (req, res) => {
  try {
    const devices = await sessions.devicesOf(query, shopOf(req));
    const t = Math.floor(Date.now() / 1000);
    res.json({ devices: Object.entries(devices).map(([device_id, d]) => ({
      device_id, label: d.label || null, kind: d.kind || null, by: d.by || null, first_seen: d.first_seen || null, seen: d.seen || null,
      revoked_at: d.revoked_at || null, till_prefix: (d.till && d.till.prefix) || null,
      sessions: (d.sessions || []).filter((s) => s && Number(s.exp) > t).length })) });
  } catch (e) { fail(res, e); }
});

router.post('/sessions/revoke', auth, personOnly, async (req, res) => {
  try {
    const b = req.body || {}, shop = shopOf(req);
    if (b.device_id) {
      if (!isOwner(req)) return res.status(403).json({ error: 'Forbidden', message: 'Only the owner may remove a device.' });
      const device_id = sessions.deviceIdOf(b.device_id);
      if (!device_id) return res.status(400).json({ error: 'Refused', message: 'device_id is not a device id.' });
      const out = await sessions.revokeDevice(withTransaction, shop, device_id, me(req));
      if (!out.revoked) return res.status(404).json({ error: 'Not found', message: 'No such device in this shop.' });
      return res.json({ ok: true, revoked: 'device', device_id });
    }
    if (!b.jti) return res.status(400).json({ error: 'Refused', message: 'Send { jti } or { device_id }.' });
    /* whose session is it? — a person may end their own; the owner may end anyone's */
    const devices = await sessions.devicesOf(query, shop);
    let found = null;
    for (const [device_id, d] of Object.entries(devices))
      for (const s of ((d && d.sessions) || [])) if (s && String(s.jti) === String(b.jti)) found = { device_id, by: s.by };
    if (!found) return res.json({ ok: true, removed: false });
    if (found.by !== me(req) && !isOwner(req)) return res.status(403).json({ error: 'Forbidden', message: 'Only the owner may end another person’s session.' });
    const out = await sessions.close(withTransaction, shop, found.device_id, String(b.jti));
    res.json({ ok: true, revoked: 'session', removed: out.removed });
  } catch (e) { fail(res, e); }
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 * M06 · ask · verify · pin — MOVED from routes/entities.js (/register login half, /verify) and routes/actors.js (/login,
 * /check-login, /set-pin). SPEC-iam-build PR 6 (SW-5), REVIEW-signin-iam I5.
 *
 * ⚠️⚠️ THE RISKIEST IAM MOVE: A REAL PERSON'S 401 STOPS THE BUILD. So nothing here changes who may sign in or what an old
 * path answers. Every old path is an ALIAS — the SAME function — and answers byte for byte what it answered before the
 * move (tests/signin-routes.test.cjs replays 53 requests against a golden recorded from the pre-move code).
 * The only differences are additive and only on the NEW door (req.signinDoor === 'signin'): ask answers `kind` + `need`,
 * a refusal for an unknown id carries `code: 'NO_ACCOUNT'`, and ask/verify take `{ id }` (a user id or e-mail).
 *
 * ⭐ DOORS. `door(name)` marks which path a request came in by, because the old paths keep their old words:
 *   'register'     /api/entities/register   — ask, and an unknown e-mail without mode:'login' goes on to REGISTRATION
 *   'entity-verify'/api/entities/verify
 *   'actor-login'  /api/actors/login        — the key@Display Name door, its own lookup and its own refusal words
 *   'signin'       /api/signin/*            — never registers; { username } selects the actor-login words
 * ⭐ ONE PIN ENGINE: lib/identity-auth.js verifyCredential() decides PIN-or-code, counts, locks. The actor door's own bcrypt
 *   + lock copy is deleted; its words come from the engine's `reason` (WORDS.actorPin below).
 * ⭐ signin_events (b282): every attempt that names a known person writes ONE row (lib/signin-events.js — fire-and-forget,
 *   never blocks, never silent; a missing table logs an error once per window).
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════ */
const { body } = require('express-validator');
const { validate, sanitise } = require('../middleware/validate');
const { safeErr } = require('../lib/respond');
const devOtp = require('../lib/dev-otp');
const { generateOTP } = require('../lib/otp');
const { sendOtpEmail } = require('../lib/notify');
const events = require('../lib/signin-events');

const door = (name) => function signinDoor(req, res, next) { req.signinDoor = name; next(); };
const isNewDoor = (req) => req.signinDoor === 'signin';
const actorLoginDoor = (req) => req.signinDoor === 'actor-login' || (isNewDoor(req) && !!req.body && req.body.username !== undefined);
const shopOfIdentity = (i) => (i && (i.parent_entity_id || i.identity_id)) || null;
const actionOf = (reason) => (/_LOCKED$/.test(String(reason || '')) ? 'locked' : 'fail');
/** one signin_events row for this attempt — only when the attempt names a known person (no shop → no row) */
function note(req, identity, action, method, code, jti) {
  if (!identity || !identity.identity_id) return;
  events.record(Object.assign(events.fromRequest(req), {
    entity_id: shopOfIdentity(identity), identity_id: identity.identity_id, action, method: method || null, code: code || null, jti: jti || null }));
}
const noAccount = (req, res, status, bodyOut) => {
  res.locals.code = 'NO_ACCOUNT';
  return res.status(status).json(Object.assign(bodyOut, isNewDoor(req) ? { code: 'NO_ACCOUNT' } : {}));
};

/* ── the words each door has always used — the engine decides, the door speaks ──────────────────────────────────── */
const WORDS = {
  /** /api/actors/login's refusals for a PIN, exactly as its own bcrypt block wrote them before M06 */
  actorPin(check) {
    if (check.reason === 'PIN_LOCKED' && !check.locked_now)
      return { error: 'Account locked', message: 'Too many wrong attempts. Contact your admin to reset.' };
    if (check.reason === 'PIN_LOCKED') return { error: 'Login failed', message: 'Account locked after 5 wrong attempts. Contact your admin.' };
    return { error: 'Login failed', message: `Incorrect PIN. ${check.left} attempts remaining.` };
  },
};

/* ── ask ─────────────────────────────────────────────────────────────────────────────────────────────────────────── */
/**
 * ⚠️ `user_id` AND `email` ARE BOTH OPTIONAL (found live 2026-09-23 — Athi: "even if i give the wrong id, it is not
 * verifying the user id"): a plain user id arrives as { user_id }, and a REQUIRED email refused it before the handler
 * ran. The handler refuses only when none arrived. `id` (M06) is the new door's one field for either.
 */
const askChecks = [
  body('display_name').optional().trim().isLength({ min: 2, max: 255 }),
  body('user_id').optional().trim(),
  body('email').optional().trim(),
  body('id').optional().trim(),
];

/**
 * sendCode — a fresh code on the identity, then to its inbox. Shared by ask and by registration (routes/entities.js),
 * which ends the same way. ⚠️ fixedOtp('entity') is null the moment the environment is sealed (lib/dev-otp.js), so a
 * DEV_OTP left set by mistake can never make a production code predictable. TTL stays 60 min (D4's 10 min is a change
 * to who can sign in — not in this move).
 */
async function sendCode(req, res, { identity_id, email, display_name }, extra) {
  const otp = devOtp.fixedOtp('entity') || generateOTP();
  const expires = new Date(Date.now() + 60 * 60 * 1000);
  await query(
    `UPDATE identities SET otp_code = $1, otp_expires_at = $2, otp_attempts = 0 WHERE identity_id = $3`,
    [otp, expires, identity_id]
  );
  /**
   * ⚠️ A NETWORK-MINTED STORE HAS NO INBOX. It is issued a handle and a claim code; the credential travels through the
   * OPERATOR (Athi, 2026-08-07: "he can have the password similar to an actor and … circulate the same"). Calling the
   * mailer with no address would report a false failure — nothing was meant to be sent.
   */
  if (!email) {
    return res.json(Object.assign({
      message: 'This store signs in with the code its network operator issued.',
      handle: (await query('SELECT user_id FROM identities WHERE identity_id = $1', [identity_id])).rows[0]?.user_id || null,
      operator_issued: true,
    }, extra || {}));
  }
  /* ⚠ the code is echoed only under lib/dev-otp.js's one rule (explicit opt-in, never sealed) — never on the sender's `dev` flag */
  const sent = await sendOtpEmail(email, display_name, otp);
  return res.json(Object.assign({
    message: sent.delivered ? 'Verification code sent to your email'
           : sent.dev       ? 'Dev mode — verification code issued'
           :                  "We couldn't send your code — please try again.",
    email,
    ...(devOtp.mayExposeOtp() && { dev_otp: otp }),
  }, extra || {}));
}

async function ask(req, res, next) {
  try {
    const input = String(req.body.email || req.body.user_id || req.body.id || '').trim();
    if (!input) {
      return res.status(400).json({ error: 'Validation failed', message: 'Send your email address or your User ID.' });
    }
    const extra = (kind, need) => (isNewDoor(req) ? { kind, need } : {});

    /**
     * ⭐⭐⭐ A COASSIST TYPED INTO THE SAME BOX — answered FIRST, before anything splits on '@': a coassist's own user id
     * (`bala@mayurbhavan.br`, b260) contains '@' like an e-mail, and the e-mail branch below would have gone on to
     * REGISTER a new entity under it. identityAuth.findLoginIdentity() asks lib/resolveuserid.js's grammar instead.
     * ⚠️ AMBIGUOUS is refused, never guessed.
     */
    const found = await identityAuth.findLoginIdentity(query, input);
    if (found.ambiguous) {
      res.locals.code = 'AMBIGUOUS_NAME';
      return res.status(409).json({
        error: 'Ambiguous business', code: 'AMBIGUOUS_NAME',
        message: 'More than one business matches that name. Ask your admin for the exact login.',
      });
    }
    if (found.identity && found.identity.identity_type === 'actor') {
      const a = found.identity;
      if (identityAuth.needsPin(a)) {
        note(req, a, 'ask', 'pin');
        return res.json(Object.assign({ message: 'Enter your PIN.', use_pin: true, user_id: a.user_id }, extra('actor', 'pin')));
      }
      const otp = await identityAuth.issueOtp(query, a);
      note(req, a, 'ask', 'otp');
      return res.json(Object.assign({
        message: 'First sign-in — enter the one-time code your admin shared, then set a PIN in Co-assists.',
        user_id: a.user_id,
        ...(devOtp.mayExposeOtp() && { dev_otp: otp }),
      }, extra('actor', 'code')));
    }

    const isEmail = input.includes('@');
    let email, display_name, identity_id;
    if (isEmail) {
      email = input.toLowerCase();
      display_name = sanitise(req.body.display_name || input);
      const existing = await query('SELECT identity_id, bridge_id FROM identities WHERE email = $1', [email]);
      if (existing.rows.length > 0) {
        identity_id = existing.rows[0].identity_id;
        console.log(`Existing entity login: ${email}`);
      } else if (req.signinDoor === 'register' && req.body.mode !== 'login') {
        return next();   // ⭐ a new e-mail at /api/entities/register is a REGISTRATION — routes/entities.js. No other door creates.
      } else {
        return noAccount(req, res, 400, { error: 'Not registered', message: 'No account found — please register first' });
      }
    } else {
      /**
       * ── HANDLE OR NAME ── `user_id` FIRST (the only unique one; a network-minted store's `<network>.<store>`), THEN
       * display name — and the name must be UNAMBIGUOUS: taking rows[0] once mailed a code to the wrong owner and locked
       * the other out. Ambiguity is refused with how to be specific.
       */
      let rows = await query(
        `SELECT identity_id, bridge_id, email, display_name FROM identities
         WHERE LOWER(user_id) = LOWER($1) AND identity_type = 'entity' AND status = 'active'`,
        [input]
      );
      if (!rows.rows.length) {
        rows = await query(
          `SELECT identity_id, bridge_id, email, display_name FROM identities
           WHERE LOWER(display_name) = LOWER($1)
           AND identity_type = 'entity'
           AND status = 'active'`,
          [input]
        );
        if (rows.rows.length > 1) {
          res.locals.code = 'AMBIGUOUS_NAME';
          return res.status(409).json({
            error: 'Ambiguous name',
            message: `More than one business is called "${input}". Sign in with your email address or your User ID instead.`,
            code: 'AMBIGUOUS_NAME',
          });
        }
      }
      if (rows.rows.length === 0) {
        return noAccount(req, res, 400, { error: 'Not found', message: 'Entity not found — check your name, User ID, or email address' });
      }
      identity_id  = rows.rows[0].identity_id;
      email        = rows.rows[0].email;
      display_name = rows.rows[0].display_name;
      console.log(`Display name login: ${display_name} → ${email}`);
    }
    note(req, { identity_id }, 'ask', 'otp');
    return await sendCode(req, res, { identity_id, email, display_name }, extra('entity', 'code'));
  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ error: 'Registration failed', message: safeErr(err) });
  }
}

/* ── verify ──────────────────────────────────────────────────────────────────────────────────────────────────────── */
/**
 * EMAIL OR HANDLE (a network-minted store has a user_id and no e-mail); OTP or PIN optional — verifyCredential() decides
 * which this identity needs. The actor door keeps its own checks: username required, PIN 4 digits.
 */
const entityVerifyChecks = [
  body('email').optional().trim(),
  body('user_id').optional().trim(),
  body('id').optional().trim(),
  body('otp').optional().trim().isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
  body('pin').optional().trim().isLength({ min: 4, max: 4 }).isNumeric().withMessage('PIN must be 4 digits'),
];
const actorLoginChecks = [
  body('username').trim().notEmpty().withMessage('Username required'),
  body('otp').optional().trim(),
  body('pin').optional().trim().isLength({ min: 4, max: 4 }).isNumeric(),
];
async function verifyChecks(req, res, next) {
  try {
    for (const c of (actorLoginDoor(req) ? actorLoginChecks : entityVerifyChecks)) await c.run(req);
    next();
  } catch (e) { next(e); }
}

/** the one refusal a session adds at the door (M05): the owner removed this device */
function deviceRevoked(req, res, identity, method) {
  note(req, identity, 'fail', method, 'DEVICE_REVOKED');
  res.locals.code = 'DEVICE_REVOKED';
  return res.status(403).json({ error: 'Forbidden', code: 'DEVICE_REVOKED', message: 'The shop removed this device. Ask the owner.' });
}
const jtiOf = (token) => { try { return (jwt.decode(token) || {}).jti || null; } catch (_) { return null; } };
const methodOf = (identity) => (identityAuth.needsPin(identity) ? 'pin' : 'otp');

async function verify(req, res) {
  if (actorLoginDoor(req)) return actorLogin(req, res);
  let identity = null;
  try {
    const otp = (req.body.otp || '').trim();
    const pin = (req.body.pin || '').trim();
    const email  = (req.body.email  || '').toLowerCase().trim();
    const handle = (req.body.user_id || '').trim();
    const id     = String(req.body.id || '').trim();
    if (!email && !handle && !id) {
      return res.status(400).json({ error: 'Verification failed', message: 'Send your email address or your User ID.' });
    }

    /* ⚠️ NO identity_type FILTER on the e-mail / user_id lookups — a handle carries a unique index whatever type owns it */
    const COLS = `identity_id, bridge_id, display_name, email, user_id, identity_type,
                    pin_hash, pin_attempts, pin_locked_at, otp_code, otp_expires_at, otp_attempts, owner_scope, parent_entity_id`;
    let rows;
    if (email) rows = (await query(`SELECT ${COLS} FROM identities WHERE email = $1`, [email])).rows;
    else if (handle) rows = (await query(`SELECT ${COLS} FROM identities WHERE LOWER(user_id) = LOWER($1)`, [handle])).rows;
    else {
      /* M06 { id }: the ONE lookup ask uses — an e-mail, a stored user id, or key@Display Name */
      const f = await identityAuth.findLoginIdentity(query, id);
      if (f.ambiguous) {
        res.locals.code = 'AMBIGUOUS_NAME';
        return res.status(409).json({ error: 'Ambiguous business', code: 'AMBIGUOUS_NAME',
          message: 'More than one business matches that name. Ask your admin for the exact login.' });
      }
      rows = f.identity ? [f.identity] : [];
    }
    if (rows.length === 0) {
      return noAccount(req, res, 400, { error: 'Verification failed',
        message: email ? 'Email not found — please register first' : 'That User ID is not recognised.' });
    }
    identity = rows[0];

    // ⭐ ONE verify, OTP or PIN — lib/identity-auth.js. The engine counts and locks; this door says it in its words.
    const check = await identityAuth.verifyCredential(query, identity, { otp, pin });
    if (!check.ok) {
      note(req, identity, actionOf(check.reason), check.method, check.reason);
      res.locals.code = check.reason || null;
      return res.status(check.status).json({
        error: 'Verification failed', message: check.message, ...(check.use_pin ? { use_pin: true } : {}),
      });
    }

    /**
     * ⚠️⚠️ EVERYTHING BELOW, UP TO THE TOKEN, IS ENTITY ONBOARDING — email_verified, the governance-context write, the
     * constitution auto-mint, the default schema bootstrap, the root link. A coassist belongs to a parent that has been
     * through all of this; running it on the actor's own id would mint a second, bogus governance stamp.
     */
    let mintedConstitution = null;
    if (identity.identity_type !== 'actor') {
      await query(`UPDATE identities SET email_verified = TRUE WHERE identity_id = $1`, [identity.identity_id]);

      /**
       * ⭐⭐ THE GOVERNANCE LAYER THE BROWSER WORKED OUT ([REG-2]/[REG-3]). ⚠️ COALESCE, NEVER OVERWRITE — this runs on every
       * owner sign-in; a derived value fills a BLANK, never corrects a choice. ⚠️ BEST-EFFORT: nothing here may fail a
       * verification. The IP is read here because here is the only place it exists. b264 keeps the claim as an audit row.
       */
      try {
        const ctx = req.body.context && typeof req.body.context === 'object' ? req.body.context : null;
        if (ctx) {
          const cc = /^[A-Za-z]{2}$/.test(String(ctx.country || '')) ? String(ctx.country).toUpperCase() : null;
          const cur = /^[A-Za-z]{3}$/.test(String(ctx.currency_code || '')) ? String(ctx.currency_code).toUpperCase() : null;
          /* ⚠️ an IANA zone, not free text — anything else is somebody's typing and would break every date we print */
          const tz = /^[A-Za-z][A-Za-z0-9_+\-]*(?:\/[A-Za-z0-9_+\-]+){1,2}$/.test(String(ctx.timezone || ''))
            ? String(ctx.timezone) : null;
          const langs = Array.isArray(ctx.languages)
            ? ctx.languages.filter((x) => /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(String(x))).slice(0, 3) : [];
          if (cc || cur || tz) {
            await query(
              `UPDATE identities
                  SET country       = COALESCE(country, $2),
                      currency_code = COALESCE(currency_code, $3),
                      timezone      = COALESCE(timezone, $4)
                WHERE identity_id = $1`,
              [identity.identity_id, cc, cur, tz]
            );
          }
          if (langs.length) {
            await query(
              `UPDATE identities
                  SET locale_prefs = COALESCE(locale_prefs, '{}'::jsonb) || jsonb_build_object('langs_seen', $2::jsonb)
                WHERE identity_id = $1`,
              [identity.identity_id, JSON.stringify(langs)]
            );
          }
          /* ⚠️ AN UNPARSEABLE IP IS NULL, NOT AN ERROR — a proxy chain can hand over anything */
          const rawIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || '';
          const ip = /^[0-9a-fA-F:.]{3,45}$/.test(rawIp) ? rawIp : null;
          const agreed = (typeof req.body.agreed_at === 'string' && !isNaN(Date.parse(req.body.agreed_at)))
            ? req.body.agreed_at : null;
          await query(
            `INSERT INTO signup_context
               (identity_id, claimed_country, claimed_currency, claimed_timezone, claimed_locale,
                claimed_languages, device, ip, user_agent, agreed_at)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10)`,
            [identity.identity_id, cc, cur, tz,
             (typeof ctx.locale === 'string' ? ctx.locale.slice(0, 40) : null),
             JSON.stringify(langs),
             JSON.stringify(ctx.device && typeof ctx.device === 'object' ? ctx.device : {}),
             ip, String(req.headers['user-agent'] || '').slice(0, 400) || null, agreed]
          );
        }
      } catch (e) {
        /* ⚠️ STILL LOUD ON FAILURE: the sign-in continues, but a capture that drops what it captured says so */
        console.log('[signup-context] NOT STORED for ' + (identity && identity.identity_id) + ': '
          + (e && e.message));
      }

      // AUTO-MINT the governance stamp onto the CHOSEN vertical (else the default). BEST-EFFORT — can never fail verification.
      try {
        const chosen = (req.body.constitution && String(req.body.constitution).trim()) || 'base';
        let c = (await query(`SELECT constitution_key, version FROM constitution WHERE constitution_key = $1 AND active = true ORDER BY (is_default IS TRUE) DESC, minted_at DESC LIMIT 1`, [chosen])).rows[0];
        if (!c) c = (await query(`SELECT constitution_key, version FROM constitution WHERE is_default = true AND active = true LIMIT 1`)).rows[0];
        if (c) {
          // place the entity on the INSTALLATION that serves its vertical (service-desk → the Mexico platform), else default
          let installKey = 'platform-0';
          try { const ir = await query(`SELECT installation_key FROM installation WHERE vertical_key = $1 AND active = true ORDER BY created_at LIMIT 1`, [c.constitution_key]); if (ir.rows[0]) installKey = ir.rows[0].installation_key; } catch (_) {}
          await withEntity(identity.identity_id, (cl) => cl.query(
            `INSERT INTO entity_governance (entity_id, constitution_key, constitution_version, installation_key) VALUES ($1,$2,$3,$4)
             ON CONFLICT (entity_id) DO UPDATE SET constitution_key = EXCLUDED.constitution_key, constitution_version = EXCLUDED.constitution_version, installation_key = EXCLUDED.installation_key, minted_at = now()`,
            [identity.identity_id, c.constitution_key, c.version, installKey]));
          mintedConstitution = require('../lib/versionref').format(c.constitution_key, c.version);
          console.log(`Entity minted: ${identity.display_name} → ${mintedConstitution} on ${installKey}`);
        }
      } catch (e) { console.warn('entity auto-mint skipped:', (e && e.message) || e); }

      // BOOTSTRAP the default schema so catalogue/compose works at once. Non-fatal.
      try { await require('../lib/schema-bootstrap').ensureDefaultSchema(identity.identity_id); } catch (_) {}

      /* CONNECT to this deployment's root (lib/rootlink.js) — inert without PLATFORM_ROOT_ENTITY, and never fails verification */
      try {
        await require('../lib/rootlink').connect(identity.identity_id, req.id);
      } catch (e) { console.warn('root link skipped:', (e && e.message) || e); }
    }

    /**
     * ⚠️⚠️⚠️ THE TOKEN IS BUILT BY identity-auth.js, NOT HERE — the one place, for either identity_type (a hand-built JWT once
     * left parent_entity_id out for a coassist). M05: a page that names its device gets a listed, revocable session.
     */
    const token = await identityAuth.issueToken(query, identity, sessions.deviceOfSignin(req));
    note(req, identity, 'in', methodOf(identity), null, jtiOf(token));
    console.log(`${identity.identity_type === 'actor' ? 'Coassist' : 'Entity'} verified: ${identity.display_name}`);

    res.json({
      message: 'Verified successfully',
      token,
      /**
       * ⭐ THE SET-PIN SIGNAL ON EVERY DOOR (2026-10-08, Athi: an employee's first sign-in "does NOT ask them to set a
       * PIN"). /api/actors/login has always answered `requires_pin_setup` for a first-time co-assist; this door — which
       * the stored `.br` id reaches from every page, because its dot after the '@' reads as an e-mail — signed the
       * same person in and said nothing, so no page could show the step. Same word, same meaning, additive: present
       * only when a co-assist just signed in by code and holds no PIN yet.
       */
      ...(identity.identity_type === 'actor' && !identity.pin_hash ? { requires_pin_setup: true } : {}),
      entity: {
        identity_id: identity.identity_id,
        bridge_id: identity.bridge_id,
        display_name: identity.display_name,
        email: identity.email
      },
      // ⭐ the ONE shape lib/signin.js's keep() reads (a.identity || a.user) — `entity:` above is kept for its readers
      identity: identityAuth.personShape(identity),
      constitution: mintedConstitution
    });
  } catch (err) {
    if (err && err.code === 'DEVICE_REVOKED') return deviceRevoked(req, res, identity, identity && methodOf(identity));
    console.error('Verify error:', err.message);
    res.status(500).json({ error: 'Verification failed', message: safeErr(err) });
  }
}

/**
 * actorLogin — the key@Display Name door (was routes/actors.js POST /login). OTP the first time, PIN after.
 * ⭐ user_id FIRST after the @, display_name SECOND — accepting only user_id would lock out everyone who types the name.
 * ⚠️ and the display_name path REFUSES AMBIGUITY (findEntityByNameOrHandle — the same rule entity sign-in uses).
 * ⚠️ THE ACTOR ROW IS READ WITH THE COLUMNS THIS DOOR ALWAYS READ — not identity-auth's IDENTITY_COLS — so the token it
 *   issues carries exactly the claims it carried before M06 (no email / owner_scope from the row). Widening that is a
 *   token change, for a later PR, not this move.
 */
async function actorLogin(req, res) {
  let a = null;
  try {
    const username = req.body.username.trim().toLowerCase();
    if (!username.includes('@')) {
      return res.status(400).json({ error: 'Invalid format', message: 'Actor login format is: yourname@entityname' });
    }
    const { actor_key, entity_name } = identityAuth.splitLogin(username);
    const e = await identityAuth.findEntityByNameOrHandle(query, entity_name.toLowerCase());
    if (e.ambiguous) {
      res.locals.code = 'AMBIGUOUS_NAME';
      return res.status(409).json({
        error: 'Ambiguous business',
        message: 'More than one business is called "' + entity_name + '". Sign in with the business User ID '
          + 'after the @ instead — ask your admin for it.',
        code: 'AMBIGUOUS_NAME',
      });
    }
    if (!e.ok) return noAccount(req, res, 400, { error: 'Login failed', message: 'Entity not found — check spelling after @' });
    const parent_entity = e.entity;

    const actor = await query(
      `SELECT identity_id, bridge_id, display_name, actor_key,
              actor_role, actor_type, break_status,
              otp_code, otp_expires_at, otp_attempts, max_tasks,
              pin_hash, pin_attempts, pin_locked_at
       FROM identities
       WHERE actor_key = $1
       AND parent_entity_id = $2
       AND identity_type = 'actor'`,
      [actor_key, parent_entity.identity_id]
    );
    if (actor.rows.length === 0) {
      return noAccount(req, res, 400, { error: 'Login failed', message: `Actor ${actor_key} not found under ${entity_name}` });
    }
    a = actor.rows[0];
    a.parent_entity_id = parent_entity.identity_id;   // a WHERE clause, not a column — set so issueToken uses THIS parent
    a.identity_type = 'actor';

    if (a.break_status === 'removed' || a.break_status === 'deactivated') {
      note(req, a, 'fail', methodOf(a), a.break_status === 'removed' ? 'ACCESS_REMOVED' : 'ACCESS_DEACTIVATED');
      return res.status(400).json({
        error: 'Login failed',
        message: a.break_status === 'removed'
          ? 'This account has been removed. Contact your admin.'
          : 'This account has been deactivated. Contact your admin.'
      });
    }

    // First sign-in: the code (pin_hash NULL). Returning: the PIN. Both through the ONE engine.
    const otp = (req.body.otp || '').trim();
    const pin = req.body.pin;
    if (a.pin_hash) {
      if (!pin) {
        note(req, a, 'fail', 'pin', 'PIN_REQUIRED');
        return res.status(400).json({ error: 'PIN required', message: 'Enter your 4 digit PIN to login', use_pin: true });
      }
      const check = await identityAuth.verifyCredential(query, a, { pin });
      if (!check.ok) {
        note(req, a, actionOf(check.reason), 'pin', check.reason);
        res.locals.code = check.reason;
        return res.status(400).json(WORDS.actorPin(check));
      }
    } else {
      if (!otp) {
        note(req, a, 'fail', 'otp', 'OTP_REQUIRED');
        return res.status(400).json({ error: 'OTP required', message: 'Enter the OTP your admin shared with you', use_otp: true });
      }
      // F5: lib/otp.js's per-account attempt cap; authLimiter still sits in front of this door
      const check = await identityAuth.verifyCredential(query, a, { otp });
      if (!check.ok) {
        note(req, a, actionOf(check.reason), 'otp', check.reason);
        res.locals.code = check.reason;
        return res.status(check.status).json({ error: 'Login failed', message: check.message });
      }
    }

    const token = await identityAuth.issueToken(query, a, sessions.deviceOfSignin(req));
    note(req, a, 'in', a.pin_hash ? 'pin' : 'otp', null, jtiOf(token));
    console.log(`Actor login: ${actor_key}@${entity_name}`);
    res.json({
      message: 'Login successful',
      token,
      requires_pin_setup: !a.pin_hash,
      actor: {
        identity_id:    a.identity_id,
        bridge_id:      a.bridge_id,
        display_name:   a.display_name,
        actor_key:      a.actor_key,
        actor_role:     a.actor_role,
        login_format:   `${actor_key}@${entity_name}`,
        parent_entity:  parent_entity.display_name,
        break_status:   a.break_status,
      }
    });
  } catch (err) {
    if (err && err.code === 'DEVICE_REVOKED') return deviceRevoked(req, res, a, a && (a.pin_hash ? 'pin' : 'otp'));
    console.error('Actor login error:', err.message);
    res.status(500).json({ error: 'Login failed', message: safeErr(err) });
  }
}

/**
 * checkLogin — GET /api/actors/check-login?username= (moved from routes/actors.js, unchanged). Does this co-assist have a
 * PIN, so the page shows the right box. ⚠️ KEPT ANSWERING, NOT 410: app.html#/login (L3748) calls it before every
 * key@Display Name sign-in, and app.html is untouched until PR 14 — a 410 here would refuse every co-assist on app.html.
 * It retires with the other aliases (PR 16). Read-only: it issues no code (ask would overwrite the code the admin shared).
 */
async function checkLogin(req, res) {
  try {
    const username = (req.query.username || '').trim().toLowerCase();
    if (!username.includes('@')) return res.json({ has_pin: false, valid: false });
    const { actor_key, entity_name } = identityAuth.splitLogin(username);
    const entity = await query(
      `SELECT identity_id FROM identities
       WHERE LOWER(display_name) = $1
       AND identity_type = 'entity' AND status = 'active'`,
      [entity_name]
    );
    if (entity.rows.length === 0) return res.json({ has_pin: false, valid: false });
    const actor = await query(
      `SELECT pin_hash, break_status FROM identities
       WHERE actor_key = $1 AND parent_entity_id = $2
       AND identity_type = 'actor'`,
      [actor_key, entity.rows[0].identity_id]
    );
    if (actor.rows.length === 0) return res.json({ has_pin: false, valid: false });
    const x = actor.rows[0];
    if (x.break_status === 'removed') return res.json({ has_pin: false, valid: false, removed: true });
    res.json({ valid: true, has_pin: !!x.pin_hash });
  } catch (err) {
    res.json({ has_pin: false, valid: false });
  }
}

/* ── pin ─────────────────────────────────────────────────────────────────────────────────────────────────────────── */
const pinChecks = [
  body('pin').isLength({ min: 4, max: 4 }).isNumeric()
    .withMessage('PIN must be exactly 4 digits'),
  body('confirm_pin').custom((val, { req }) => {
    if (val !== req.body.pin) throw new Error('PINs do not match');
    return true;
  }),
];
/**
 * pin — a co-assist sets their PIN after the first code (was routes/actors.js POST /set-pin). Actor-only, as before:
 * widening it to owners (SPEC "widened to entities", I10) needs verifyCredential to ASK an owner for a PIN — a change to
 * how owners sign in, so not in this move.
 */
async function pin(req, res) {
  try {
    const identity_id = req.identity.identity_id;
    if (req.identity.identity_type !== 'actor') {
      return res.status(400).json({ error: 'Only actors can set PIN' });
    }
    await identityAuth.setPin(query, identity_id, req.body.pin);
    note(req, { identity_id, parent_entity_id: auth.entityOf(req) }, 'link', 'pin');
    res.json({ message: 'PIN set successfully — use PIN for future logins' });
  } catch (err) {
    res.status(500).json({ error: 'Set PIN failed', message: safeErr(err) });
  }
}

router.post('/ask', door('signin'), askChecks, validate, ask);
router.post('/verify', door('signin'), verifyChecks, validate, verify);
router.post('/pin', auth, pinChecks, validate, pin);

router.handlers = { ask, verify, pin, checkLogin };
Object.assign(router, { door, askChecks, verifyChecks, pinChecks, sendCode, events });
module.exports = router;
