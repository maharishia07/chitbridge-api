'use strict';
/**
 * employee-code.js — M02: THE ONE PLACE an employee's first sign-in code is made, timed, delivered and shown.
 *
 * Invariants (tests/employee-code.test.cjs):
 *   · a SEALED environment shows a code in a response ONLY through the R112 door (a person with no e-mail, to the owner, on the issuing call, 30 min); everyone else gets it e-mailed or is refused;
 *   · a code is single-use (lib/identity-auth.js verifyCredential clears it on the first good login; lib/otp.js verifyOtp then fails) and valid 24 h;
 *   · SEC-106: a code is kept only as a KEYED hash (identities.otp_code_hash, lib/otp.js codeHash), never in plain text, and `issue` is the ONE writer.
 * Reuses: lib/dev-otp.js (isSealed, fixedOtp), lib/otp.js (generateOTP), lib/notify.js (sendOtpEmail → Resend). No second sender.
 * SEC2: besides the R112 owner door above, the code is shown in an answer ONLY through dev-otp.mayExposeOtp (a local stack that opted in). Anywhere
 * else it is e-mailed or nobody reads it: testers sign in with the tester code (SEC1), real people get it by e-mail.
 
 * owns: an employee first code from mint to the screen: made once (issue), kept as a keyed hash, timed, e-mailed, refused in words when it cannot be kept or sent.
 * CARD 18-identity-sign-in-and-access/sign-in
 * CALLED BY lib/people.js, routes/actors.js, routes/signin.js   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
 */
const devOtp = require('./dev-otp');
const log = require('./logger');
const { generateOTP, codeHash } = require('./otp');
const schema = require('./schema');
const vaultcrypto = require('./vaultcrypto');
const accessEvents = require('./access-events');

const TTL_MS = 24 * 60 * 60 * 1000;
const TTL_WORDS = '24 hours';
/* R112: a code SHOWN to the owner (a person with no e-mail) lives 30 minutes, not 24 h — it is read out at the counter, not left in a mailbox */
const SHOW_TTL_MS = 30 * 60 * 1000;
const SHOW_TTL_WORDS = '30 minutes';

const mint = (ttlMs) => ({ otp: generateOTP('entity'), expires: new Date(Date.now() + (ttlMs || TTL_MS)) });

/**
 * storageMode() -> 'hash' | 'plain' (SEC-106). 'hash' once the b781 column exists AND VAULT_ENC_KEY is set. Otherwise 'plain': the code is kept the old
 * way, in EVERY environment, sealed included, because staff sign-in must never be blocked by a missing key (laptop1's ruling). Before b781 that is said
 * as a warning; with the column but no key it is said as an ERROR (the code sits in plain text until the key is set). Never the code in the log.
 */
async function storageMode() {
  if (!(await schema.hasColumn('identities', 'otp_code_hash'))) {
    log.warn('employee-code: the staff code is kept in plain text until b781 (otp_code_hash) is run');
    return 'plain';
  }
  if (vaultcrypto.isConfigured()) return 'hash';
  log.error('employee-code: VAULT_ENC_KEY is not set: the staff code is kept in plain text until it is');
  return 'plain';
}

/** Resend is configured when real delivery is switched on AND a key and a from-address exist. */
const resendReady = () =>
  String(process.env.OTP_EMAIL_ENABLED || '').trim() === 'true' &&
  !!String(process.env.RESEND_API_KEY || '').trim() &&
  !!String(process.env.FROM_EMAIL || '').trim();

const validEmail = (text) => typeof text === 'string' && /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(text.trim());

const mask = (e) => {
  const s = String(e),
    i = s.indexOf('@');
  return (s.slice(0, 1) || '*') + '***' + s.slice(i);
};

/**
 * Call BEFORE writing anything. Null = go ahead; otherwise { status, body } to send as-is.
 * R112: a person with NO usable e-mail is never refused — the owner is SHOWN the code once (see `deliver`, `channelOf`), on a sealed stack too; that
 * check comes before the Resend one, so a shop with no sender can still hand a worker a first code. Only a person WITH an e-mail needs the sender:
 * a sealed environment without Resend refuses (503), because an e-mailed code is the one channel there. No e-mail is never a second channel
 * for a person who has one (no "mail failed, show it instead").
 */
function refusal(to) {
  if (!validEmail(to)) return null;
  if (devOtp.isSealed() && !resendReady())
    return {
      status: 503,
      body: {
        error: 'E-mail delivery is not configured',
        code: 'EMAIL_DELIVERY_NOT_CONFIGURED',
        message: 'This environment is sealed and has no e-mail sender set up, so a first code cannot be delivered. Nothing was changed.'
      }
    };
  return null;
}

/** the SET fragment that clears a held code's hash too (', otp_code_hash = NULL'), or '' while b781 has not been run: whoever clears otp_code adds it */
async function clearSql() {
  return (await schema.hasColumn('identities', 'otp_code_hash')) ? ', otp_code_hash = NULL' : '';
}

/**
 * mayIssue(to, person) -> null to go ahead, or { status, body } to send as-is: refusal(to) first, then (R112, when person = { entity_id, identity_id } is given) the
 * issue limiter, then the show-path check. Call BEFORE writing anything. A missing VAULT_ENC_KEY never refuses (SEC-106: issue() keeps the code the old way and logs an error).
 * R112: a code that is SHOWN is a new capability, so on a sealed stack it refuses in words while the b781 column (otp_code_hash) is missing; nobody is locked out by that.
 */
async function mayIssue(to, person) {
  const refused = refusal(to) || (person && (await tooManyIssued(person)));
  if (refused) return refused;
  if (channelOf(to) === 'screen' && devOtp.isSealed() && !(await schema.hasColumn('identities', 'otp_code_hash')))
    return {
      status: 503,
      body: {
        error: 'Showing a code is not ready',
        code: 'CODE_SHOW_NOT_READY',
        message: 'This environment cannot show a first code yet, so none was made. Add their e-mail, or try again later. Nothing was changed.'
      }
    };
  return null;
}

/**
 * issue(run, identity_id, { entity_id, by, channel, also, ttlMs }) -> { otp, expires } — SEC-106: THE ONE WRITER of an employee's first code (create, reset,
 * reactivate, first sign-in). Mints it, stores the keyed hash (never the code), sets ONE expires_at, zeroes the attempt count (a locked code
 * stays locked under a new one otherwise), and puts a code_issued row on the access trail (only when `entity_id` is given: the owner's acts, not a sign-in ask). `ttlMs` replaces the 24 h. `also` is a literal SET fragment the caller needs in
 * the same statement ('pin_hash = NULL, ...'), never built from input. The caller holds the plain code only to e-mail it or show it once.
 */
async function issue(runQuery, identity_id, opts) {
  const { entity_id, by, channel, also, ttlMs } = opts || {};
  const { otp: code, expires } = mint(ttlMs || (channel === 'screen' ? SHOW_TTL_MS : undefined));
  const mode = await storageMode();
  const extra = also ? also + ', ' : '';
  if (mode === 'hash')
    await runQuery(`UPDATE identities SET ${extra}otp_code = NULL, otp_code_hash = $1, otp_expires_at = $2, otp_attempts = 0 WHERE identity_id = $3`, [codeHash(identity_id, code), expires, identity_id]);
  else {
    await runQuery(`UPDATE identities SET ${extra}otp_code = $1${await clearSql()}, otp_expires_at = $2, otp_attempts = 0 WHERE identity_id = $3`, [code, expires, identity_id]);
  }
  if (mode === 'hash' && entity_id) await recordIssued({ entity_id, identity_id, by, channel, expires });
  return { otp: code, expires };
}

/* ── SEC-106 · A SIGN-IN ASK MAY REPLACE A PERSON'S CODE ONLY A FEW TIMES. The ask has no session, and every new code zeroes the guess count, so an
   unlimited ask would be an unlimited number of guesses (and a way to knock out a worker's mailed code). Same pattern as lib/dev-otp testerGuess
   (express-rate-limit's MemoryStore, per person): at most ASK_REMINT_MAX replacements per window, and not twice inside the cooldown. ── */
const { MemoryStore } = require('express-rate-limit');
const ASK_REMINT_MAX = 3;
const ASK_REMINT_WINDOW_MS = 60 * 60 * 1000;
const ASK_REMINT_COOLDOWN_MS = 60 * 1000;
const askWindow = new MemoryStore();
askWindow.init({ windowMs: ASK_REMINT_WINDOW_MS });
const askCooldown = new MemoryStore();
askCooldown.init({ windowMs: ASK_REMINT_COOLDOWN_MS });

/**
 * mayReplaceOnAsk(identity_id) -> true when a pre-auth sign-in ask may make a new code for this person (and counts it), false when it must keep
 * the held one and leave the guess count alone. The refusal is logged in words, without the code or the e-mail; the caller answers the same as ever.
 */
async function mayReplaceOnAsk(identity_id) {
  const key = 'ask:' + String(identity_id);
  const recent = await askCooldown.get(key);
  const used = await askWindow.get(key);
  if ((recent && recent.totalHits >= 1) || (used && used.totalHits >= ASK_REMINT_MAX)) {
    log.warn('employee-code: a sign-in ask came too soon or too often to replace the code again — the held code is kept, guesses not reset', { identity_id });
    return false;
  }
  await askWindow.increment(key);
  await askCooldown.increment(key);
  return true;
}

/* ── R112 · THE OWNER MAY ISSUE A PERSON'S CODE ONLY A FEW TIMES. Every issue zeroes the 5-try guess count, so unlimited issues from a stolen owner session
   would be unlimited guesses. Same pattern as the ask above: at most ISSUE_MAX codes per person per window, per shop + person (MemoryStore). ── */
const ISSUE_MAX = 5;
const ISSUE_WINDOW_MS = 15 * 60 * 1000;
const issueWindow = new MemoryStore();
issueWindow.init({ windowMs: ISSUE_WINDOW_MS });

/** tooManyIssued({ entity_id, identity_id }) -> null (and counts this issue) or { status: 429, body } in words, saying when to try again */
async function tooManyIssued({ entity_id, identity_id }) {
  const key = 'issue:' + String(entity_id) + ':' + String(identity_id);
  const used = await issueWindow.get(key);
  if (used && used.totalHits >= ISSUE_MAX)
    return {
      status: 429,
      body: {
        error: 'Too many codes',
        code: 'CODE_ISSUE_LIMIT',
        message: 'Five codes were made for this person in the last 15 minutes. Wait a few minutes, then make a new one. Nothing was changed.'
      }
    };
  await issueWindow.increment(key);
  return null;
}

/** the words of an actor's ask answer: "sent" when the code went by e-mail, or when this ask kept a code that was mailed a moment ago (same words as a fresh send, so a refusal tells nothing) */
function askMessage(toMail, fresh, sent) {
  if (toMail && (!fresh || (sent && sent.delivered))) return 'Verification code sent to your email';
  return 'First sign-in — enter the one-time code your admin shared, then set a PIN in Co-assists.';
}

/** forget every counted ask (a test hook: each scene starts with a fresh person) */
const _resetAsk = () => {
  askWindow.resetAll();
  askCooldown.resetAll();
  issueWindow.resetAll();
};

/** which way a first code travels, for the trail: an e-mail address on file means e-mail, none means the owner reads it off the screen */
const channelOf = (to) => (validEmail(to) ? 'email' : 'screen');

/** the code_issued row, in the shop's own RLS scope after the write (as routes/actors.js recordBreak does): a lost row is logged by access-events, and never fails the issue */
async function recordIssued({ entity_id, identity_id, by, channel, expires }) {
  const event = { entity_id, subject_identity_id: identity_id, action: 'code_issued', after: { channel: channel || 'email', expires_at: expires.toISOString() }, changed_by: by };
  try {
    await require('../db').withEntity(entity_id, (scopedDb) => accessEvents.record((sql, args) => scopedDb.query(sql, args), event));
  } catch (e) {
    log.warn('employee-code: the code was issued but its access event was not written — the trail has a gap', { identity_id, err: e && e.message });
  }
}

/**
 * R112 · THE ONE DOOR THAT SHOWS A CODE TO THE OWNER: a person with no e-mail, on the call that issued it, to the caller the route already
 * proved is the owner (ownerWrite). The caller passes `show` only on create, reset PIN and new code — never on a list, a GET or a reactivate.
 * Never logged, and middleware/idempotency never records an answer that carries show_code.
 */
function shownCode(name, code) {
  return {
    show_code: code,
    expires_in: SHOW_TTL_WORDS,
    delivery: 'shown',
    delivery_note: 'Give this code to ' + name + ' now. It works once, for 30 minutes, and is not shown again.'
  };
}

/** mails the code and says how it went: 'sent' or 'failed' (a thrown sender is logged and counts as failed) */
async function mailIt({ to, name, code, send }) {
  const sender = send || require('./notify').sendOtpEmail;
  try {
    const result = await sender(String(to).trim(), name, code, { ttl: TTL_WORDS });
    return result && result.delivered ? 'sent' : 'failed';
  } catch (e) {
    log.fellBack('employee-code: failed — answered with nothing', e);
    return 'failed';
  }
}

/**
 * Deliver the code and return the fields to spread into the response.
 * `send` defaults to notify.sendOtpEmail; tests pass a stub, so nothing real is ever sent.
 * `otp` appears in the body only through dev-otp.mayExposeOtp (SEC2).
 */
async function deliver({ to, name, otp, send, show, expires }) {
  const out = { expires_in: TTL_WORDS };
  if (expires) out.expires_at = expires.toISOString();
  const delivery = validEmail(to) ? await mailIt({ to, name, code: otp, send }) : 'none';
  if (delivery === 'sent') out.sent_to = mask(to);
  out.delivery = delivery;
  if (delivery === 'none') out.delivery_note = 'No e-mail on file, so no code was sent. Add their e-mail, then send a new code.';
  if (delivery === 'none' && show) Object.assign(out, shownCode(name, otp));
  if (delivery === 'sent') out.delivery_note = 'The code went to ' + out.sent_to + '.'; // SEC2: the screen paints this, it has no code to show
  if (delivery === 'failed') out.delivery_note = 'The e-mail could not be sent. Reset the code to try again.';
  if (devOtp.mayExposeOtp()) out.otp = otp; // SEC2: the one door, never "not sealed"
  return out;
}

module.exports = { TTL_MS, SHOW_TTL_MS, ISSUE_MAX, tooManyIssued, mint, issue, mayIssue, clearSql, channelOf, mayReplaceOnAsk, askMessage, ASK_REMINT_MAX, _resetAsk, _askCooldown: askCooldown, storageMode, refusal, deliver, resendReady, validEmail, mask };
