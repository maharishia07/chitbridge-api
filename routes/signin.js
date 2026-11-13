'use strict';
/**
 * /api/signin — A PERSON'S SESSIONS: renew · logout · list · revoke (M05, SPEC-iam-build §4.2, D3, D14).
 * OWNS      every route under /api/signin (8): renew · logout · sessions · devices · sessions/revoke · ask · verify · pin, and the handler functions the old paths (/api/entities/register, /verify, /api/actors/login, /check-login, /set-pin) mount as aliases.
 * FLOW      door(name) → [session routes: auth → personOnly (a key is refused) → schemaValidate (lib/signin-contract.js)] · [ask · verify: schemaValidate → chains → validate → handler → lib/identity-auth.js] → the one answer an unknown account and a wrong secret share (SEC-81)
 *           ⚠️ a typed value with a NUL byte names no account: it is answered as an unknown one before any lookup (K-1).
 * CARD 18-identity-sign-in-and-access/sign-in
 *
 *   POST /api/signin/renew              (person)  → { token, jti, exp, device_id } — new jti, same device, old jti gone
 *   POST /api/signin/logout             (person)  → { ok, removed } — removes this session's jti; 200 even if already gone
 *   GET  /api/signin/sessions           (person)  → { sessions:[…], legacy, may:{ devices } } — my own sessions on every device in this shop; may.devices = owner (T3-P4-ACCOUNT)
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
 
 * CALLED BY server.js (app.use('/api/signin') and the /api/signin/{ask,verify,pin} rate-limit list) · routes/actors.js and routes/entities.js (the alias mounts) · the web's sign-in (signin-ui.js) · tests/api-problem-signin.test.cjs · tests/signin-routes.test.cjs
 */
const express = require('express');
const log = require('../lib/logger');
const jwt = require('jsonwebtoken');
const router = express.Router();
const auth = require('../middleware/auth');
const { query, withTransaction, withEntity } = require('../db');
const sessions = require('../lib/person-session');
const identityAuth = require('../lib/identity-auth');
const signinLookup = require('../lib/signin-lookup'); // SEC-184: the one pre-binding reader of identities (ops.signin_candidates)
const empCode = require('../lib/employee-code'); // SEC-106: the one issuer of a staff first code (a keyed hash is kept, never the code)
const { OTP_HASH_COL } = require('../lib/otp');
const SIGNIN_ASK_TTL_MS = 60 * 60 * 1000; // a code made by a sign-in ask lives one hour, as identity-auth issueOtp always gave it (the owner's issue is 24 h)
const { rateLimit } = require('../lib/rate-limit'); // the one limiter factory (429 problem+json RATE_LIMITED)
const { intFromEnv } = require('../lib/limits');
const { problem, internalSpec } = require('../lib/problem'); // API-STANDARD S1: the one error writer
const { failed } = require('../lib/products-contract'); // a fault of ours: a 500 that says nothing of its cause (the old body kept: the screen's label and the safe sentence)
const { contract, schemaOptions, VERIFY_REFUSALS } = require('../lib/signin-contract'); // the operations of the routes that read an input
const { declaresStatuses } = require('../lib/contract-kit'); // a gate that refuses nothing and says which statuses a call under it can answer
const owner = require('../lib/owner');
const { isOwner } = owner;

/** the spec of a refusal in the old words: the old { error, message[, code] } beside the Problem fields (API-STANDARD S2). A route's handler passes it to problem(); the old body is frozen here, in one place */
const said = (code, error, message, withCode) => ({ code, detail: message, legacy: Object.assign({ error }, withCode ? { code } : {}, { message }) });
const personOnly = (req, res, next) => {
  if (req.api_key) return problem(req, res, Object.assign({ status: 403 }, said('KEY_CANNOT_SIGN_IN', 'Forbidden', 'A key cannot sign in — sign in.', true)));
  next();
};
/* T3-P4-ACCOUNT: the ONE owner gate (lib/owner.gate = SEC2's ownerOnly, with the sentence) — the refusal carries code OWNER_ONLY and the sentence GET /sessions says in `may.devices`,
   so CB Settings › Account greys "Every device" and "Remove this device" with the words the server would refuse with (never a regex over prose). */
const DEVICES_WHY = 'Only the owner may see or remove every device.';
const ownerOnly = owner.gate(DEVICES_WHY);
/** a library's refusal (person-session: a device the owner removed, a session that is gone) keeps its status, its code and its sentence; anything else is a 500 that says nothing of its cause (S8) */
const FAULT_WORDS = 'Could not change your session. This is our fault.';
const fail = (req, res, e) => {
  const status = (e && e.status) || 500;
  if (status >= 500) return problem(req, res, internalSpec(req, e, { error: 'Server error', message: FAULT_WORDS }));
  const code = (e && e.code) || (status === 404 ? 'NOT_FOUND' : 'VALIDATION_FAILED');
  return problem(req, res, Object.assign({ status }, said(code, 'Refused', String(e.message), !!(e && e.code))));
};
/** the claims of the token this request came with — auth already verified it */
const claimsOf = (req) => jwt.decode(String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')) || {};
const shopOf = (req) => auth.entityOf(req);
const me = (req) => req.identity.identity_id;

router.post('/renew', auth, personOnly, ...contract.checked('POST /renew', schemaOptions), async (req, res) => {
  try {
    const shop = shopOf(req);
    let s;
    if (req.session) {
      s = await sessions.renew(withTransaction, shop, req.session.device_id, req.session.jti, me(req));
    } else {
      /* a legacy token: becomes a listed session on the device the request names — or stays as it is */
      const device_id = sessions.deviceIdOf(req.headers['x-device-id']);
      if (!device_id) return problem(req, res, Object.assign({ status: 400 }, said('NO_DEVICE', 'Refused', 'Send X-Device-Id to renew.', true)));
      s = await sessions.open(withTransaction, shop, {
        device_id,
        surface: (req.body && req.body.surface) || 'web',
        by: me(req),
        ua: String(req.headers['user-agent'] || '').slice(0, 160) || null
      });
    }
    const token = identityAuth.signToken(claimsOf(req), s);
    res.json({ token, jti: s.jti, exp: s.exp, device_id: s.device_id, surface: s.surface });
  } catch (e) {
    fail(req, res, e);
  }
});

/** a token from before M05 lists no session: nothing to remove, and the page clears itself (the 200 answer, frozen) */
const LEGACY_TOKEN_LOGOUT = { ok: true, removed: false, legacy: true };
router.post('/logout', auth, personOnly, ...contract.checked('POST /logout', schemaOptions), async (req, res) => {
  try {
    if (!req.session) return res.json(LEGACY_TOKEN_LOGOUT);
    const out = await sessions.close(withTransaction, shopOf(req), req.session.device_id, req.session.jti);
    res.json({ ok: true, removed: out.removed });
  } catch (e) {
    fail(req, res, e);
  }
});

router.get('/sessions', auth, personOnly, ...contract.checked('GET /sessions', schemaOptions), async (req, res) => {
  try {
    const devices = await sessions.devicesOf(query, shopOf(req));
    const t = Math.floor(Date.now() / 1000),
      out = [];
    for (const [device_id, d] of Object.entries(devices)) {
      if (!d || d.revoked_at) continue;
      for (const s of d.sessions || []) {
        if (!s || s.by !== me(req) || Number(s.exp) <= t) continue;
        out.push({
          jti: s.jti,
          device_id,
          surface: s.surface || null,
          iat: s.iat,
          exp: s.exp,
          current: !!(req.session && req.session.jti === s.jti),
          device: { label: d.label || null, kind: d.kind || null, seen: d.seen || null }
        });
      }
    }
    /* T3-P4-ACCOUNT: may.devices — whether THIS sign-in may read GET /devices and revoke a device (the owner); a co-assist sees the list greyed with this sentence */
    res.json({ sessions: out, legacy: !req.session, may: { devices: owner.may(req, DEVICES_WHY) } });
  } catch (e) {
    fail(req, res, e);
  }
});

router.get('/devices', auth, personOnly, ownerOnly, ...contract.checked('GET /devices', schemaOptions), async (req, res) => {
  try {
    const devices = await sessions.devicesOf(query, shopOf(req));
    const t = Math.floor(Date.now() / 1000);
    res.json({
      devices: Object.entries(devices).map(([device_id, d]) => ({
        device_id,
        label: d.label || null,
        kind: d.kind || null,
        by: d.by || null,
        first_seen: d.first_seen || null,
        seen: d.seen || null,
        revoked_at: d.revoked_at || null,
        till_prefix: (d.till && d.till.prefix) || null,
        sessions: (d.sessions || []).filter((item) => item && Number(item.exp) > t).length
      }))
    });
  } catch (e) {
    fail(req, res, e);
  }
});

router.post('/sessions/revoke', auth, personOnly, ...contract.checked('POST /sessions/revoke', schemaOptions), async (req, res) => {
  try {
    const b = req.body || {},
      shop = shopOf(req);
    if (b.device_id) {
      if (!isOwner(req)) return problem(req, res, Object.assign({ status: 403 }, said(owner.OWNER_ONLY, 'Forbidden', DEVICES_WHY, true)));
      const device_id = sessions.deviceIdOf(b.device_id);
      if (!device_id) return problem(req, res, Object.assign({ status: 400 }, said('VALIDATION_FAILED', 'Refused', 'device_id is not a device id.')));
      const nestedOut = await sessions.revokeDevice(withTransaction, shop, device_id, me(req));
      if (!nestedOut.revoked) return problem(req, res, Object.assign({ status: 404 }, said('NOT_FOUND', 'Not found', 'No such device in this shop.')));
      return res.json({ ok: true, revoked: 'device', device_id });
    }
    if (!b.jti) return problem(req, res, Object.assign({ status: 400 }, said('VALIDATION_FAILED', 'Refused', 'Send { jti } or { device_id }.')));
    /* whose session is it? — a person may end their own; the owner may end anyone's */
    const devices = await sessions.devicesOf(query, shop);
    let found = null;
    for (const [device_id, d] of Object.entries(devices))
      for (const s of (d && d.sessions) || []) if (s && String(s.jti) === String(b.jti)) found = { device_id, by: s.by };
    if (!found) return res.json({ ok: true, removed: false });
    if (found.by !== me(req) && !isOwner(req)) return problem(req, res, Object.assign({ status: 403 }, said(owner.OWNER_ONLY, 'Forbidden', 'Only the owner may end another person’s session.')));
    const out = await sessions.close(withTransaction, shop, found.device_id, String(b.jti));
    res.json({ ok: true, revoked: 'session', removed: out.removed });
  } catch (e) {
    fail(req, res, e);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 * M06 · ask · verify · pin — MOVED from routes/entities.js (/register login half, /verify) and routes/actors.js (/login,
 * /check-login, /set-pin). SPEC-iam-build PR 6 (SW-5), REVIEW-signin-iam I5.
 *
 * ⚠️⚠️ THE RISKIEST IAM MOVE: A REAL PERSON'S 401 STOPS THE BUILD. So nothing here changes who may sign in or what an old
 * path answers. Every old path is an ALIAS — the SAME function — and answers byte for byte what it answered before the
 * move (tests/signin-routes.test.cjs replays 53 requests against a golden recorded from the pre-move code).
 * The only difference is additive and only on the NEW door (req.signinDoor === 'signin'): a refusal for an unknown id carries `code: 'NO_ACCOUNT'`, and ask/verify take `{ id }` (a user id or e-mail). SEC-143: ask answers ONE body to everyone (askAnswered), on every door.
 *
 * ⭐ DOORS. `door(name)` marks which path a request came in by, because the old paths keep their old words:
 *   'register'     /api/entities/register   — ask, and an unknown e-mail without mode:'login' goes on to REGISTRATION
 *   'entity-verify'/api/entities/verify
 *   'actor-login'  /api/actors/login        — the key@Display Name door, its own lookup and its own refusal words
 *   'signin'       /api/signin/*            — never registers; { username } selects the actor-login words
 * ⭐ ONE PIN ENGINE: lib/identity-auth.js verifyCredential() decides PIN-or-code, counts, locks. The actor door's own bcrypt
 *   + lock copy is deleted; the door says one sentence for every secret refusal (SEC-81, `refused` below), the engine's `reason` goes to the log.
 * ⭐ signin_events (b282): every attempt that names a known person writes ONE row (lib/signin-events.js — fire-and-forget,
 *   never blocks, never silent; a missing table logs an error once per window).
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════ */
const { body } = require('express-validator');
const { validate, sanitise } = require('../middleware/validate');
const devOtp = require('../lib/dev-otp');
const { generateOTP } = require('../lib/otp');
const { sendOtpEmail, sendOtp } = require('../lib/notify');
const events = require('../lib/signin-events');

const door = (name) =>
  function signinDoor(req, res, next) {
    req.signinDoor = name;
    next();
  };
const isNewDoor = (req) => req.signinDoor === 'signin';
const actorLoginDoor = (req) => req.signinDoor === 'actor-login' || (isNewDoor(req) && !!req.body && req.body.username !== undefined);
const shopOfIdentity = (i) => (i && (i.parent_entity_id || i.identity_id)) || null;
const actionOf = (reason) => (/_LOCKED$/.test(String(reason || '')) ? 'locked' : 'fail');
/** one signin_events row for this attempt — only when the attempt names a known person (no shop → no row) */
function note(req, identity, action, method, code, jti) {
  if (!identity || !identity.identity_id) return;
  events.record(
    Object.assign(events.fromRequest(req), {
      entity_id: shopOfIdentity(identity),
      identity_id: identity.identity_id,
      action,
      method: method || null,
      code: code || null,
      jti: jti || null
    })
  );
}
/**
 * ⭐ M14 — ONE CONTACT, SEVERAL PEOPLE (Athi 2026-11-07: the chooser comes AFTER the secret). Only the accounts the typed secret OPENS are listed,
 * so a stranger learns nothing; `choices[].id` is the STORED id the page sends back as `id` with the same secret.
 */
const chooseWhich = async (req, res, opens) => {
  res.locals.code = 'CHOOSE_IDENTITY';
  const message = 'That contact is on more than one account. Choose one.';
  const choices = await identityAuth.choicesOf(query, opens);
  return problem(req, res, { status: 409, code: 'CHOOSE_IDENTITY', detail: message, legacy: { error: 'Which account?', code: 'CHOOSE_IDENTITY', message, choices } });
};
/**
 * ⭐ SEC-81 (API-STANDARD S6) — ONE ANSWER BEFORE SIGN-IN. An unknown account, a wrong secret and a locked account all get this same
 * status, body and (as far as practical) time, so the door cannot be used to find who has an account or who is locked. The true
 * reason goes to the request log and signin_events (note) only. The lock is told through that trail, not on the door.
 */
const SIGNIN_REFUSED = { error: 'Sign-in failed', message: identityAuth.SIGNIN_REFUSED_SENTENCE };
const refused = (req, res, reason) => {
  problem(req, res, { status: 400, code: 'SIGNIN_REFUSED', detail: SIGNIN_REFUSED.message, legacy: SIGNIN_REFUSED });
  if (reason) res.locals.code = reason; // the log keeps the true reason; the caller never sees it
};
/** SEC-184: the accounts a typed e-mail or handle names: who (the definer lookup), then their credential columns BY ID in one read; a minted party is no account (SEC-130) */
const accountsTypedAs = async (kind, typed, columns) => {
  const named = (await signinLookup.candidates(query, kind, typed)).filter(identityAuth.isAccount);
  return identityAuth.rowsOfCandidates(query, named.map((candidate) => candidate.identity_id), columns);
};
/** no such account: refuse like a wrong secret, after spending the time a secret check spends */
const unknownAccount = async (req, res) => {
  await identityAuth.spendCheckTime();
  await identityAuth.padHashes(req.contactPad || 0);
  return refused(req, res, 'NO_ACCOUNT');
};
/**
 * ⭐ SEC-143 (API-STANDARD S6) — ONE ASK ANSWER. Before a secret is proven the ask door says the same thing to everyone: an unknown person,
 * a person with a PIN, a person who gets a code, a contact shared by several accounts, a store with no inbox. It never says which box
 * (PIN or code), which account (id, user_id, handle, e-mail), which kind of person, or that a choice exists; the one box takes either secret.
 * It spends one hash time first, the time an unknown account spends, so what a person needs is not told by how long the answer takes either.
 * The true reason goes to the request log and signin_events (note) only. A code made here is mailed AFTER the answer starts (askMail), never inside its time.
 */
const ASK_ANSWER = { message: 'If that sign-in exists, enter your PIN or the code we sent.', need: 'pin_or_code' };
/** answers an ask: waits for the hash time that has run BESIDE the branch's own work (so owner, first-timer, PIN holder and unknown take as long as the slowest, not a sum), notes the true reason in the log, then says ASK_ANSWER (plus the code only on an opted-in local stack) */
const askAnswered = async (req, res, reason, echoed, hashing = identityAuth.spendCheckTime()) => {
  await hashing;
  if (reason) res.locals.code = reason;
  return res.json(devOtp.mayExposeOtp() && echoed ? { ...ASK_ANSWER, dev_otp: echoed } : ASK_ANSWER); // dev_otp: the explicit local-stack opt-in only (lib/dev-otp.js), never sealed
};
/** a mail or text for a code made at ask goes out without holding the answer; a failure to send is logged, never told on the door */
const askMail = (sending) => Promise.resolve(sending).catch((err) => console.error('ask mail not sent:', err.message));
/** K-1: a typed value with a NUL byte names no account and no database can hold it (Postgres refuses it, 22021): it is answered as an unknown value is, before any lookup */
const holdsNul = (value) => String(value == null ? '' : value).includes('\u0000');
/** the shop a door names, as findLoginIdentity reads it: one with a NUL byte names no shop, as an unknown shop does (the id is then looked up on its own) */
const shopNamed = (req) => (holdsNul(req.body.shop) ? '' : req.body.shop);
/** what the ask door looks up: the first of e-mail, user id, id that was typed */
const typedByAsk = (req) => String(req.body.email || req.body.user_id || req.body.id || '').trim();
/** what the verify door looks up: the username after its @ on the key@Display Name door, else the first of e-mail, user id, id that was typed */
const typedByVerify = (req) => (actorLoginDoor(req) ? (String(req.body.username).includes('@') ? String(req.body.username) : '') : (req.body.email || '').toLowerCase().trim() || (req.body.user_id || '').trim() || String(req.body.id || '').trim());
/** a door's handler that answers a typed value with a NUL byte as an unknown one (K-1): the same refusal, the same spent time, before any lookup. The old paths mount these (router.handlers). */
const junkAsUnknown = (handler, typedBy, unknown = unknownAccount) => (req, res, next) => (holdsNul(typedBy(req)) ? unknown(req, res) : handler(req, res, next));
/** a wrong or locked secret is refused with the one answer; a missing PIN or an expired code still has its own sentence (it needed the right secret) */
const isSecretRefusal = (reason) => /^(PIN|OTP)_(WRONG|LOCKED|REQUIRED)$/.test(String(reason || ''));
/**
 * SEC-139 (API-STANDARD S6): a secret that was NOT sent (or a code, which hashes nothing) is refused like a wrong PIN or an account that is
 * not there: the same status, code and body, after spending the same hash time. "Enter your PIN" was only ever said to a person who exists.
 */
const secretRefused = async (req, res, check) => {
  if (!(check.method === 'pin' && 'left' in check)) await identityAuth.spendCheckTime(); /* a PIN just counted (wrong, or the try that locked) was hashed; every other refusal was not */
  await identityAuth.padHashes(req.contactPad || 0); /* SEC-143: a contact door costs the same hash times whoever is behind it */
  return refused(req, res, check.reason);
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
  body('id').optional().trim()
];

/**
 * sendCode — a fresh code on the identity, then to its inbox. Shared by ask and by registration (routes/entities.js),
 * which ends the same way. ⚠️ fixedOtp('entity') is null the moment the environment is sealed (lib/dev-otp.js), so a
 * DEV_OTP left set by mistake can never make a production code predictable. TTL stays 60 min (D4's 10 min is a change
 * to who can sign in — not in this move).
 */
/** a fresh code on the identity (kept plain here, as the owner door always has) — the code itself is returned */
async function storeCode(identity_id) {
  const code = generateOTP('entity');
  const expires = new Date(Date.now() + 60 * 60 * 1000);
  await query(`UPDATE identities SET otp_code = $1, otp_expires_at = $2, otp_attempts = 0 WHERE identity_id = $3`, [code, expires, identity_id]);
  return code;
}
/**
 * ⭐ SEC-148 · sentWords(sent) → the ONE sentence for a mail's outcome ({ delivered, dev } from lib/notify). The new-address path (sendCode) and the held-address path
 * (routes/entities.js, the "already on file" notice) both say it, so a mailer outage reads the same on both and the words cannot tell a held address from a free one.
 */
/**
 * ⭐ SEC-148 · askAddressCap — the register door's PER-ADDRESS cap (REGISTRATION only: mode:'login' is the owner's sign-in and is never counted) (the app-level authLimiter counts per IP, so many IPs could mail one address without end). One budget per typed
 * address, counted BEFORE anything is looked up, so a held address and a free one are capped alike and over the cap both answer the same 429 (OWASP ASVS V2.2 / V11 anti-automation;
 * the code mail and the "already on file" notice are the same send). REGISTER_PER_ADDRESS_MAX (default 5) per hour, in this process like the other limiters.
 */
const askAddressCap = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: intFromEnv('REGISTER_PER_ADDRESS_MAX', 5),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => 'addr:' + typedByAsk({ body: req.body || {} }).toLowerCase().slice(0, 200),
  skip: (req) => !typedByAsk({ body: req.body || {} }) || (req.body || {}).mode === 'login', /* the register door is also the owner's LOGIN (mode:'login'): never capped, only registration is */
  message: { error: 'Too many codes', message: 'A code was already asked for that address a few times. Use the last one we sent, or try again in an hour.' }
});
const sentWords = (sent) =>
  sent && sent.delivered ? 'Verification code sent to your email' : sent && sent.dev ? 'Dev mode — verification code issued' : "We couldn't send your code — please try again.";
async function sendCode(req, res, { identity_id, email, display_name }, extra) {
  const otp = await storeCode(identity_id);
  /**
   * ⚠️ A NETWORK-MINTED STORE HAS NO INBOX. It is issued a handle and a claim code; the credential travels through the
   * OPERATOR (Athi, 2026-08-07: "he can have the password similar to an actor and … circulate the same"). Calling the
   * mailer with no address would report a false failure — nothing was meant to be sent.
   */
  if (!email) {
    return res.json(
      Object.assign(
        {
          message: 'This store signs in with the code its network operator issued.',
          handle: (await query('SELECT user_id FROM identities WHERE identity_id = $1', [identity_id])).rows[0]?.user_id || null,
          operator_issued: true
        },
        extra || {}
      )
    );
  }
  /* ⚠ the code is echoed only under lib/dev-otp.js's one rule (explicit opt-in, never sealed) — never on the sender's `dev` flag */
  const sent = await sendOtpEmail(email, display_name, otp);
  return res.json(
    Object.assign(
      {
        message: sentWords(sent),
        email,
        ...(devOtp.mayExposeOtp() && { dev_otp: otp })
      },
      extra || {}
    )
  );
}

/**
 * firstCodeFor(actor, toMail) -> { otp, fresh }: otp = the plain code to e-mail or echo on a local stack (null when the held one is kept),
 * fresh = a new code was made (SEC-106). TOP-CORRECT: the code the admin shared is KEPT while it is live, a new one only when none is held.
 * A code kept as a hash cannot be read back to e-mail, so a mailed ask makes a NEW code (empCode.issue, attempts back to 0) — but this door has no
 * session, so empCode.mayReplaceOnAsk allows that only a few times per person per hour and not twice within a minute; past that the held
 * code is kept, the guess count is NOT reset, and the answer is the same as any other ask.
 */
async function firstCodeFor(actor, toMail) {
  const wantsNew = toMail || !identityAuth.holdsLiveCode(actor);
  if (wantsNew && (await empCode.mayReplaceOnAsk(actor.identity_id))) {
    return { otp: (await empCode.issue(query, actor.identity_id, { ttlMs: SIGNIN_ASK_TTL_MS })).otp, fresh: true };
  }
  return { otp: identityAuth.heldOtp(actor), fresh: false };
}


async function ask(req, res, next) {
  try {
    const input = typedByAsk(req); // never empty here: askDoor refused that

    /**
     * ⭐⭐⭐ A COASSIST TYPED INTO THE SAME BOX — answered FIRST, before anything splits on '@': a coassist's own user id
     * (`bala@mayurbhavan.br`, b260) contains '@' like an e-mail, and the e-mail branch below would have gone on to
     * REGISTER a new entity under it. identityAuth.findLoginIdentity() asks lib/resolveuserid.js's grammar instead.
     * ⚠️ AMBIGUOUS is never guessed, and (SEC-143) never listed: one contact on several accounts gets the one answer and no code.
     */
    const hashing = identityAuth.spendCheckTime();
    hashing.catch((err) => console.error('ask hash time:', err.message)); // awaited by askAnswered too; a failure there reaches the catch below
    const answer = (reason, echoed) => askAnswered(req, res, reason, echoed, hashing);
    const found = await identityAuth.findLoginIdentity(query, input, { shop: shopNamed(req) });
    if (found.ambiguous) return answer('AMBIGUOUS_NAME');
    if (found.identity && found.identity.identity_type === 'actor') {
      const a = found.identity;
      if (identityAuth.needsPin(a)) {
        note(req, a, 'ask', 'pin');
        return answer();
      }
      /* M14: an employee who signed in by a VERIFIED e-mail gets the code there — the one contact the shop proved is theirs */
      const toMail = found.via === 'contact' && input.includes('@') && !identityAuth.mobileOf(input);
      const { otp, fresh } = await firstCodeFor(a, toMail);
      note(req, a, 'ask', 'otp');
      if (toMail && fresh) askMail(sendOtpEmail(input.toLowerCase(), a.display_name, otp));
      return answer(null, otp);
    }

    /**
     * ⭐ M14 — A CUSTOMER by the contact the storefront proved (identities.phone / otp_contact): the code goes back on the same
     * channel, the customer's own fixed test code applies (lib/dev-otp.js 'customer').
     * Customers are not person sessions (issueToken: no jti) — exactly the storefront's token.
     */
    if (found.identity && found.identity.identity_type === 'customer') {
      const c = found.identity;
      const row = (await query('SELECT otp_contact, phone FROM identities WHERE identity_id = $1', [c.identity_id])).rows[0] || {};
      const to = row.otp_contact || row.phone || '';
      const otp = await identityAuth.issueOtp(query, c, undefined, 'customer');
      if (to) askMail(sendOtp(to.includes('@') ? 'email' : 'phone', to, c.display_name, otp));
      note(req, c, 'ask', 'otp');
      return answer(null, otp);
    }

    /* ⭐ M14 — an OWNER found by a mobile number or a verified e-mail: the row is in hand; the lookups below would not find a number */
    if (found.identity && found.via === 'contact') {
      const e = found.identity;
      note(req, { identity_id: e.identity_id }, 'ask', 'otp');
      return await mailedCode(answer, e);
    }

    const isEmail = input.includes('@');
    let email, display_name, identity_id;
    if (isEmail) {
      email = input.toLowerCase();
      display_name = sanitise(req.body.display_name || input);
      const existing = (await signinLookup.candidates(query, 'email', email)).filter(identityAuth.isAccount); // SEC-130
      if (existing.length > 0) {
        identity_id = existing[0].identity_id;
        console.log(`Existing entity login: ${email}`);
      } else if (req.signinDoor === 'register' && req.body.mode !== 'login') {
        return next(); // ⭐ a new e-mail at /api/entities/register is a REGISTRATION — routes/entities.js. No other door creates.
      } else {
        return answer('NO_ACCOUNT');
      }
    } else {
      /**
       * ── HANDLE OR NAME ── `user_id` FIRST (the only unique one; a network-minted store's `<network>.<store>`), THEN
       * display name — and the name must be UNAMBIGUOUS: taking rows[0] once mailed a code to the wrong owner and locked
       * the other out. Ambiguity gets the one answer and no code (SEC-143).
       */
      const accounts = async (kind, keep) => ({ rows: (await signinLookup.candidates(query, kind, input)).filter(keep).filter(identityAuth.isAccount) }); // SEC-130: a minted party is no account
      let rows = await accounts('handle', (candidate) => candidate.identity_type === 'entity' && candidate.status === 'active');
      if (!rows.rows.length) {
        rows = await accounts('name', () => true); // the function keeps active entities only
        if (rows.rows.length > 1) return answer('AMBIGUOUS_NAME');
      }
      if (rows.rows.length === 0) return answer('NO_ACCOUNT');
      identity_id = rows.rows[0].identity_id;
      email = rows.rows[0].email;
      display_name = rows.rows[0].display_name;
      console.log(`Display name login: ${display_name} → ${email}`);
    }
    note(req, { identity_id }, 'ask', 'otp');
    return await mailedCode(answer, { identity_id, email, display_name });
  } catch (err) {
    console.error('Register error:', err.message);
    problem(req, res, failed(err, req, 'Registration failed'));
  }
}
/** ask for an owner: a fresh code on the account, mailed after the answer (a store with no inbox has the code its network operator issued) */
async function mailedCode(answer, { identity_id, email, display_name }) {
  const code = await storeCode(identity_id);
  if (email) askMail(sendOtpEmail(email, display_name, code));
  return answer(null, code);
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
  body('otp').optional().trim().isLength({ min: 6, max: 64 }).withMessage('OTP must be 6 digits'), // SEC1: up to 64 — a tester code is 8+ (words kept: signin-parity golden)
  body('pin').optional().trim().isLength({ min: 4, max: 4 }).isNumeric().withMessage('PIN must be 4 digits')
];
const actorLoginChecks = [
  body('username').trim().notEmpty().withMessage('Username required'),
  body('otp').optional().trim(),
  body('pin').optional().trim().isLength({ min: 4, max: 4 }).isNumeric()
];
async function verifyChecks(req, res, next) {
  try {
    for (const c of actorLoginDoor(req) ? actorLoginChecks : entityVerifyChecks) await c.run(req);
    next();
  } catch (e) {
    next(e);
  }
}

/** the one refusal a session adds at the door (M05): the owner removed this device */
function deviceRevoked(req, res, identity, method) {
  note(req, identity, 'fail', method, 'DEVICE_REVOKED');
  res.locals.code = 'DEVICE_REVOKED';
  const message = 'The shop removed this device. Ask the owner.';
  return problem(req, res, { status: 403, code: 'DEVICE_REVOKED', detail: message, legacy: { error: 'Forbidden', code: 'DEVICE_REVOKED', message } });
}
/**
 * sessionRefused(err, req, res, identity, method) → true when issueToken refused the door and the answer is sent.
 * DEVICE_REVOKED (403, the owner removed the device) · SESSION_NOT_LISTED (503, K-SEC PR A: our listing failed — try again;
 * never a legacy token instead). Anything else → false, and the door answers its own 500.
 */
function sessionRefused(err, req, res, identity, method) {
  const code = err && err.code;
  if (code === 'DEVICE_REVOKED') {
    deviceRevoked(req, res, identity, method);
    return true;
  }
  if (code !== 'SESSION_NOT_LISTED') return false;
  note(req, identity, 'fail', method, code);
  res.locals.code = code;
  problem(req, res, { status: 503, code, detail: err.message, legacy: { error: 'Sign-in failed', code, message: err.message } });
  return true;
}
const jtiOf = (token) => {
  try {
    return (jwt.decode(token) || {}).jti || null;
  } catch (e) {
    log.fellBack('signin jtiOf: failed — answered with nothing', e);
    return null;
  }
};
/**
 * identityOnContact — a contact on several accounts (SEC-143): try the secret on all of them (identityAuth.proveOnContact); the ONE it opens is
 * the person, several it opens get the chooser (only those), none it opens gets the one refusal and costs the contact one miss.
 * → the identity to go on with, or null once it has answered.
 */
async function identityOnContact(req, res, found, secret) {
  const proof = await identityAuth.proveOnContact(query, found.candidates, found.contact, secret);
  req.contactPad = Math.max(0, identityAuth.CONTACT_HASHES - proof.hashes);
  if (proof.opens.length === 1) return proof.opens[0];
  if (proof.opens.length > 1) await chooseWhich(req, res, proof.opens);
  else await secretRefused(req, res, proof.refusal);
  return null;
}
/** M06 { id }: the ONE lookup ask uses (an e-mail, a stored user id, key@Display Name, a mobile) → the accounts to try, or null once it has answered */
async function accountsOfTypedId(req, res, secret) {
  const f = await identityAuth.findLoginIdentity(query, secret.name, { shop: shopNamed(req) });
  if (f.ambiguous && f.via !== 'contact') {
    await unknownAccount(req, res); // two businesses of one name are never listed (SEC-139)
    return null;
  }
  if (!f.ambiguous) return f.identity ? [f.identity] : [];
  const chosen = await identityOnContact(req, res, f, secret);
  return chosen ? [chosen] : null;
}
/** is this typed value a contact (an e-mail, a mobile, key@business): the doors that take one pad their refusals to the same hash time */
const contactShaped = (typed) => typed.includes('@') || !!identityAuth.mobileOf(typed);
const methodOf = (identity) => (identityAuth.needsPin(identity) ? 'pin' : 'otp');

async function verify(req, res) {
  if (actorLoginDoor(req)) return actorLogin(req, res);
  let identity = null;
  try {
    const otp = (req.body.otp || '').trim();
    const nestedPin = (req.body.pin || '').trim();
    const email = (req.body.email || '').toLowerCase().trim();
    const handle = (req.body.user_id || '').trim();
    const id = String(req.body.id || '').trim();
    if (!email && !handle && !id) {
      return problem(req, res, { status: 400, code: 'VALIDATION_FAILED', detail: 'Type your mobile number, email or User ID.', legacy: { error: 'Verification failed', message: 'Type your mobile number, email or User ID.' } });
    }

    /* ⚠️ NO identity_type FILTER on the e-mail / user_id lookups (a handle is unique whatever type owns it) — but ACCOUNTS only (SEC-130) */
    const COLS = `identity_id, bridge_id, display_name, email, user_id, identity_type,
                    pin_hash, pin_attempts, pin_locked_at, otp_code, ${OTP_HASH_COL}, otp_expires_at, otp_attempts, owner_scope, parent_entity_id`;
    let rows;
    if (email) rows = await accountsTypedAs('email', email, COLS);
    else if (handle) rows = await accountsTypedAs('handle', handle, COLS);
    else {
      rows = await accountsOfTypedId(req, res, { otp, pin: nestedPin, name: id });
      if (!rows) return; // answered: the chooser, or the one refusal
    }
    if (rows.length === 0) {
      return unknownAccount(req, res);
    }
    identity = rows[0];

    // ⭐ ONE verify, OTP or PIN — lib/identity-auth.js. The engine counts and locks; this door says it in its words.
    const check = await identityAuth.verifyCredential(query, identity, { otp, pin: nestedPin, name: email || handle || id });
    if (!check.ok) {
      note(req, identity, actionOf(check.reason), check.method, check.reason);
      res.locals.code = check.reason || null;
      if (isSecretRefusal(check.reason)) return secretRefused(req, res, check);
      return problem(req, res, {
        status: check.status,
        code: 'VERIFICATION_FAILED',
        detail: check.message,
        legacy: { error: 'Verification failed', message: check.message, ...(check.use_pin ? { use_pin: true } : {}) }
      });
    }

    /**
     * ⚠️⚠️ EVERYTHING BELOW, UP TO THE TOKEN, IS ENTITY ONBOARDING — email_verified, the governance-context write, the
     * constitution auto-mint, the default schema bootstrap, the root link. A coassist belongs to a parent that has been
     * through all of this; running it on the actor's own id would mint a second, bogus governance stamp.
     */
    let mintedConstitution = null;
    if (identity.identity_type !== 'actor' && identity.identity_type !== 'customer') {
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
          const tz = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){1,2}$/.test(String(ctx.timezone || '')) ? String(ctx.timezone) : null;
          const langs = Array.isArray(ctx.languages) ? ctx.languages.filter((x) => /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(String(x))).slice(0, 3) : [];
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
          const agreed = typeof req.body.agreed_at === 'string' && !isNaN(Date.parse(req.body.agreed_at)) ? req.body.agreed_at : null;
          /**
           * ⭐ GOV-SPIN: THE COUNTRY THE REGISTRANT ACCEPTED with reg-agree (the register panel sends `country_source` only then). The server
           * decides the source from the facts and moves the stored country only while nothing exists (CS.acceptAtSignup) — a later sign-in
           * that sends the same keys changes nothing on a shop that trades. Its own try: a refusal here never costs the audit row below.
           */
          let accepted = null;
          if (agreed && ctx.country_source) {
            try {
              const CS = require('../lib/country-setup');
              const at = await CS.atSignup();
              accepted = await withEntity(identity.identity_id, (h) => CS.acceptAtSignup(h, identity.identity_id, ctx, at));
            } catch (e) {
              /* STD2: through the logger — the shop keeps the country registration stored; Country setup shows it and lets the owner correct it */
              require('../lib/logger').warn('signin.verify: accepted country NOT recorded — the registered country stands', {
                identity_id: identity.identity_id,
                why: String(e && e.message)
              });
            }
          }
          const audit = await query(
            `INSERT INTO signup_context
               (identity_id, claimed_country, claimed_currency, claimed_timezone, claimed_locale,
                claimed_languages, device, ip, user_agent, agreed_at)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10) RETURNING signup_context_id`,
            [
              identity.identity_id,
              cc,
              cur,
              tz,
              typeof ctx.locale === 'string' ? ctx.locale.slice(0, 40) : null,
              JSON.stringify(langs),
              JSON.stringify(ctx.device && typeof ctx.device === 'object' ? ctx.device : {}),
              ip,
              String(req.headers['user-agent'] || '').slice(0, 400) || null,
              agreed
            ]
          );
          /* GOV-SPIN: the accepted country's source code onto THIS audit row (b383) — named only once the column exists */
          const row = audit && audit.rows && audit.rows[0];
          if (accepted && row && (await require('../lib/schema').hasColumn('signup_context', 'country_source'))) {
            await query(`UPDATE signup_context SET country_source = $2 WHERE signup_context_id = $1`, [row.signup_context_id, accepted.source]);
          }
        }
      } catch (e) {
        /* ⚠️ STILL LOUD ON FAILURE: the sign-in continues, but a capture that drops what it captured says so */
        console.log('[signup-context] NOT STORED for ' + (identity && identity.identity_id) + ': ' + (e && e.message));
      }

      // AUTO-MINT the governance stamp onto the CHOSEN vertical (else the default). BEST-EFFORT — can never fail verification.
      try {
        const chosen = (req.body.constitution && String(req.body.constitution).trim()) || 'base';
        let c = (
          await query(
            `SELECT constitution_key, version FROM constitution WHERE constitution_key = $1 AND active = true ORDER BY (is_default IS TRUE) DESC, minted_at DESC LIMIT 1`,
            [chosen]
          )
        ).rows[0];
        if (!c) c = (await query(`SELECT constitution_key, version FROM constitution WHERE is_default = true AND active = true LIMIT 1`)).rows[0];
        if (c) {
          // place the entity on the INSTALLATION that serves its vertical (service-desk → the Mexico platform), else default
          /* GOV-SPIN: else THIS installation (INSTALLATION_KEY) — a spin's shops were stamped India's platform-0 */
          let installKey = require('../lib/country-setup').installationKey();
          /* …and THIS installation first when it serves the vertical — platform-0 also serves 'base', and created_at alone picked it on every spin */
          try {
            const ir = await query(
              `SELECT installation_key FROM installation WHERE vertical_key = $1 AND active = true ORDER BY (installation_key = $2) DESC, created_at LIMIT 1`,
              [c.constitution_key, installKey]
            );
            if (ir.rows[0]) installKey = ir.rows[0].installation_key;
          } catch (e) {
            require('../lib/logger').warn('signin.verify: installation lookup failed — the shop is stamped on this installation', {
              installKey,
              why: String(e && e.message)
            });
          }
          /**
           * ⚠️⚠️ A SIGN-IN NEVER RE-STAMPS A SHOP'S CONSTITUTION (T3-FIXES, SIGNIN-CONST). This runs on EVERY owner verify, and a
           * plain sign-in names no constitution — so `chosen` fell to 'base' and a pharma shop was re-stamped base each morning.
           * The stamp moves only when THIS request named the constitution it got ($5); otherwise an existing row is refreshed
           * (version, installation) only while it is already on the same constitution — a different key is kept as chosen.
           */
          const named = !!(req.body.constitution && String(req.body.constitution).trim() === c.constitution_key);
          const st = await withEntity(identity.identity_id, (cl) =>
            cl.query(
              `INSERT INTO entity_governance (entity_id, constitution_key, constitution_version, installation_key) VALUES ($1,$2,$3,$4)
             ON CONFLICT (entity_id) DO UPDATE SET constitution_key = EXCLUDED.constitution_key, constitution_version = EXCLUDED.constitution_version, installation_key = EXCLUDED.installation_key, minted_at = now()
             WHERE $5::boolean OR entity_governance.constitution_key = EXCLUDED.constitution_key`,
              [identity.identity_id, c.constitution_key, c.version, installKey, named]
            )
          );
          if (st && st.rowCount === 0) {
            require('../lib/logger').info('signin.verify: the shop keeps its own constitution — a sign-in does not re-stamp it', {
              entity: identity.identity_id,
              offered: c.constitution_key
            });
          } else {
            mintedConstitution = require('../lib/versionref').format(c.constitution_key, c.version);
            console.log(`Entity minted: ${identity.display_name} → ${mintedConstitution} on ${installKey}`);
          }
        }
      } catch (e) {
        console.warn('entity auto-mint skipped:', (e && e.message) || e);
      }

      // BOOTSTRAP the default schema so catalogue/compose works at once. Non-fatal.
      try {
        await require('../lib/schema-bootstrap').ensureDefaultSchema(identity.identity_id);
      } catch (e) {
        log.fellBack('signin verify: the helper failed — carried on without it', e);
      }

      /* CONNECT to this deployment's root (lib/rootlink.js) — inert without PLATFORM_ROOT_ENTITY, and never fails verification */
      try {
        await require('../lib/rootlink').connect(identity.identity_id, req.id);
      } catch (e) {
        console.warn('root link skipped:', (e && e.message) || e);
      }
    }

    /**
     * ⚠️⚠️⚠️ THE TOKEN IS BUILT BY identity-auth.js, NOT HERE — the one place, for either identity_type (a hand-built JWT once
     * left parent_entity_id out for a coassist). M05: a page that names its device gets a listed, revocable session.
     */
    const token = await identityAuth.issueToken(query, identity, sessions.deviceOfSignin(req));
    note(req, identity, 'in', methodOf(identity), identityAuth.viaCode(check.via), jtiOf(token)); /* SEC-136: a tester-code sign-in is listed as one */
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
    if (sessionRefused(err, req, res, identity, identity && methodOf(identity))) return;
    console.error('Verify error:', err.message);
    problem(req, res, failed(err, req, 'Verification failed'));
  }
}

/**
 * actorSecretRefused — the secret step of the key@Display Name door: first sign-in takes the code (pin_hash NULL), a returning actor the PIN,
 * both through the ONE engine. Returns true when it has already answered (SEC-81: a wrong or locked secret gets the one safe sentence).
 */
async function actorSecretCheck(req, actor, typed) {
  const pinHolder = !!actor.pin_hash;
  if (!typed) return { ok: false, reason: pinHolder ? 'PIN_REQUIRED' : 'OTP_REQUIRED' };
  return identityAuth.verifyCredential(query, actor, pinHolder ? { pin: typed } : { otp: typed, name: req.body.username });
}
/** the secret step of the key@Display Name door, answered when it is refused (see actorSecretRefused) */
async function actorSecretRefused(req, res, actor) {
  const otp = (req.body.otp || '').trim();
  const nestedPin = String(req.body.pin || '').trim();
  /* SEC-139: one secret box. A co-assist with a PIN may type it in either field (a first-timer's code goes in `otp`): the page cannot know which, and check-login no longer says */
  const method = actor.pin_hash ? 'pin' : 'otp';
  const check = await actorSecretCheck(req, actor, actor.pin_hash ? nestedPin || otp : otp);
  if (check.ok) {
    req.signinVia = identityAuth.viaCode(check.via); /* SEC-136: the 'in' row of this door says a tester code opened it */
    return false;
  }
  note(req, actor, actionOf(check.reason), method, check.reason);
  if (isSecretRefusal(check.reason)) await secretRefused(req, res, check);
  else {
    res.locals.code = check.reason;
    problem(req, res, { status: check.status, code: 'LOGIN_FAILED', detail: check.message, legacy: { error: 'Login failed', message: check.message } });
  }
  return true;
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
      return problem(req, res, { status: 400, code: 'LOGIN_FORMAT_INVALID', detail: 'Actor login format is: yourname@entityname', legacy: { error: 'Invalid format', message: 'Actor login format is: yourname@entityname' } });
    }
    const { actor_key, entity_name } = identityAuth.splitLogin(username);
    const e = await identityAuth.findEntityByNameOrHandle(query, entity_name.toLowerCase());
    if (e.ambiguous || !e.ok) return unknownAccount(req, res); // SEC-139: two businesses of one name get the refusal, not a list (SEC-143)
    const parent_entity = e.entity;

    const actor = await query(
      `SELECT identity_id, bridge_id, display_name, actor_key,
              actor_role, actor_type, break_status,
              otp_code, ${OTP_HASH_COL}, otp_expires_at, otp_attempts, max_tasks,
              pin_hash, pin_attempts, pin_locked_at
       FROM identities
       WHERE actor_key = $1
       AND parent_entity_id = $2
       AND identity_type = 'actor'`,
      [actor_key, parent_entity.identity_id]
    );
    if (actor.rows.length === 0) {
      return unknownAccount(req, res);
    }
    a = actor.rows[0];
    a.parent_entity_id = parent_entity.identity_id; // a WHERE clause, not a column — set so issueToken uses THIS parent
    a.identity_type = 'actor';

    if (a.break_status === 'removed' || a.break_status === 'deactivated') {
      note(req, a, 'fail', methodOf(a), a.break_status === 'removed' ? 'ACCESS_REMOVED' : 'ACCESS_DEACTIVATED');
      return secretRefused(req, res, { reason: a.break_status === 'removed' ? 'ACCESS_REMOVED' : 'ACCESS_DEACTIVATED' }); // SEC-81: before the secret, so no state is told; SEC-139: after the same hash time
    }

    if (await actorSecretRefused(req, res, a)) return;

    const token = await identityAuth.issueToken(query, a, sessions.deviceOfSignin(req));
    note(req, a, 'in', a.pin_hash ? 'pin' : 'otp', req.signinVia, jtiOf(token));
    console.log(`Actor login: ${actor_key}@${entity_name}`);
    res.json({
      message: 'Login successful',
      token,
      requires_pin_setup: !a.pin_hash,
      actor: {
        identity_id: a.identity_id,
        bridge_id: a.bridge_id,
        display_name: a.display_name,
        actor_key: a.actor_key,
        actor_role: a.actor_role,
        login_format: `${actor_key}@${entity_name}`,
        parent_entity: parent_entity.display_name,
        break_status: a.break_status
      }
    });
  } catch (err) {
    if (sessionRefused(err, req, res, a, a && (a.pin_hash ? 'pin' : 'otp'))) return;
    console.error('Actor login error:', err.message);
    problem(req, res, failed(err, req, 'Login failed'));
  }
}

/**
 * checkLogin — GET /api/actors/check-login?username= . SEC-139 (API-STANDARD S6): ONE CONSTANT ANSWER, no lookup. It once said whether a
 * co-assist had a PIN, which told who exists. app.html#/login still calls it before every key@Display Name sign-in; the constant
 * `has_pin: false` sends everyone to the one secret box, and /api/actors/login takes the PIN or the first code in it (actorSecretRefused).
 * Read-only: it issues no code. Retires with the other aliases (PR 16).
 */
const CHECK_LOGIN_ANSWER = Object.freeze({ valid: true, has_pin: false });
function checkLogin(req, res, next) {
  try {
    res.json(CHECK_LOGIN_ANSWER);
  } catch (err) {
    next(err); /* a fault of ours goes to the server's one error handler (a Problem 500 with the request id) */
  }
}

/* ── pin ─────────────────────────────────────────────────────────────────────────────────────────────────────────── */
const pinChecks = [
  body('pin').isLength({ min: 4, max: 4 }).isNumeric().withMessage('PIN must be exactly 4 digits'),
  body('confirm_pin').custom((val, { req }) => {
    if (val !== req.body.pin) throw new Error('PINs do not match');
    return true;
  })
];
/**
 * pin — a co-assist sets their PIN after the first code (was routes/actors.js POST /set-pin). Actor-only, as before:
 * widening it to owners (SPEC "widened to entities", I10) needs verifyCredential to ASK an owner for a PIN — a change to
 * how owners sign in, so not in this move.
 */
const PIN_ACTORS_ONLY = { status: 400, code: 'PIN_ACTORS_ONLY', detail: 'Only actors can set PIN', legacy: { error: 'Only actors can set PIN' } }; /* the body this refusal always had, frozen */
async function pin(req, res) {
  try {
    const identity_id = req.identity.identity_id;
    if (req.identity.identity_type !== 'actor') {
      return problem(req, res, PIN_ACTORS_ONLY);
    }
    await identityAuth.setPin(query, identity_id, req.body.pin);
    note(req, { identity_id, parent_entity_id: auth.entityOf(req) }, 'link', 'pin');
    res.json({ message: 'PIN set successfully — use PIN for future logins' });
  } catch (err) {
    problem(req, res, failed(err, req, 'Set PIN failed'));
  }
}

/** the ask door: nothing typed is a 400; a value with a NUL byte is answered as an unknown one (K-1); anything else goes to ask, whose faults are Problems too */
function askDoor(req, res, next) {
  if (!typedByAsk(req)) return problem(req, res, Object.assign({ status: 400 }, said('VALIDATION_FAILED', 'Validation failed', 'Type your mobile number, email or User ID.')));
  return holdsNul(typedByAsk(req)) ? askAnswered(req, res, 'NO_ACCOUNT') : ask(req, res, next);
}
/** SEC-143: the doors that take a contact pad their refusals to CONTACT_HASHES hash times, found or not (a refusal spends the first itself) */
const padded = (handler) => (req, res, next) => {
  req.contactPad = contactShaped(typedByVerify(req)) ? identityAuth.CONTACT_HASHES - 1 : 0;
  return handler(req, res, next);
};
const verifyDoor = padded(junkAsUnknown(verify, typedByVerify));
router.post('/ask', door('signin'), ...contract.checked('POST /ask', schemaOptions), askChecks, validate, askDoor);
router.post('/verify', door('signin'), declaresStatuses(VERIFY_REFUSALS), ...contract.checked('POST /verify', schemaOptions), verifyChecks, validate, verifyDoor);
router.post('/pin', auth, ...contract.checked('POST /pin', schemaOptions), pinChecks, validate, pin);
router.openapi = { paths: contract.pathsOf(), schemas: {} }; // S9: the five routes that read an input (lib/signin-contract.js)

router.handlers = { ask: askDoor, verify: verifyDoor, pin, checkLogin };
Object.assign(router, { askAddressCap, sentWords, holdsNul, door, askChecks, verifyChecks, pinChecks, sendCode, events });
module.exports = router;
