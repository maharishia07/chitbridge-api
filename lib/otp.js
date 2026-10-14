// lib/otp.js — per-account OTP attempt cap (defense-in-depth ON TOP of the auth rate limiter).
// Locks an account's CURRENT otp after MAX wrong tries. The lock clears when a fresh OTP is issued (set
// otp_attempts = 0 in the same UPDATE that sets otp_code) or on success (set otp_attempts = 0 when clearing).
const crypto = require('crypto');
const logger = require('./logger');
const MAX_OTP_ATTEMPTS = parseInt(process.env.MAX_OTP_ATTEMPTS || '5', 10);

/**
 * generateOTP — THE OTP generator. Every place that issues one calls this.
 *
 * ⚠️ IT LIVES HERE BECAUSE A DUPLICATE ATE THE SECURITY FIX. `generateOTP` had THREE independent copies —
 * routes/entities.js, routes/actors.js, routes/connectors.js. The S4 reviewer fix (2026-07-13) moved it to a
 * CSPRNG and wrote down exactly why: *"Math.random() — whose V8 state is recoverable, letting an attacker predict
 * a victim's OTP."*
 *
 * That fix reached routes/entities.js. The other two kept `Math.random()` for four weeks: the co-assist login OTP,
 * and the connector OTP that is valid for SEVEN DAYS. Both are credentials. The reviewer was right, the fix was
 * right, and two thirds of the code it was written for never saw it — with nothing anywhere to report that.
 *
 * Verification already lives in this file (otpEqual, the attempt cap). Issuing belongs next to it: one module owns
 * the OTP end to end, so the next fix cannot land on one third of it again.
 *
 * DEV_OTP's fixed code still applies — but only where lib/dev-otp.js fixedOtp() allows it (SEC1: a LOCAL stack, never sealed).
 * It read DEV_OTP raw before SEC1, a second door beside dev-otp; now it asks the one door.
 */
function generateOTP() {
  return require('./dev-otp').fixedOtp('entity') || crypto.randomInt(100000, 1000000).toString();
}

// S6 (reviewer 2026-07-13) — constant-time OTP comparison (no early-exit timing leak). Length-safe.
function otpEqual(a, b) {
  const ba = Buffer.from(String(a == null ? '' : a));
  const bb = Buffer.from(String(b == null ? '' : b));
  if (ba.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ba, bb); } catch (e) { logger.fellBack('otp otpEqual: did not parse — answered no', e, 'debug'); return false; }
}

// row  — must include: identity_id, otp_code, otp_expires_at, otp_attempts.
// run  — a query fn: the pool `query`, or a transaction `client.query`.
// submitted — the code the user typed.
// opts.names — SEC1: the sign-in name the person typed (the identity's own email / user_id / bridge_id / contact are added here),
//   for TESTER_NAMES. The tester code (lib/dev-otp.js testerCodeOk) is checked HERE, the one verify every door uses — after the
//   attempt lock (a locked account stays locked) and before the stored code. A miss falls through to the stored code, so a
//   wrong tester code is counted and answered exactly like any wrong code.
// Returns { ok:true } (the caller then clears the OTP), or { ok:false, status, message, reason } — status + message to send
// back verbatim; reason (OTP_WRONG | OTP_LOCKED | OTP_EXPIRED) is for the sign-in log (lib/signin-events.js), never the body.
async function verifyOtp(run, row, submitted, opts) {
  if ((row.otp_attempts || 0) >= MAX_OTP_ATTEMPTS)
    return { ok: false, status: 429, reason: 'OTP_LOCKED', message: 'Too many incorrect attempts — request a new code.' };

  const code = String(submitted == null ? '' : submitted).trim();
  const names = [].concat((opts && opts.names) || [], row.email, row.user_id, row.bridge_id, row.otp_contact, row.phone);
  if (require('./dev-otp').testerCodeOk(code, names)) return { ok: true };
  if (!row.otp_code || !otpEqual(row.otp_code, code)) {
    await run(`UPDATE identities SET otp_attempts = COALESCE(otp_attempts, 0) + 1 WHERE identity_id = $1`, [row.identity_id]);
    const left = Math.max(0, MAX_OTP_ATTEMPTS - ((row.otp_attempts || 0) + 1));
    return { ok: false, status: 400, reason: left > 0 ? 'OTP_WRONG' : 'OTP_LOCKED',
      message: left > 0 ? `Incorrect code — ${left} attempt${left === 1 ? '' : 's'} left.`
                        : 'Too many incorrect attempts — request a new code.' };
  }
  if (new Date() > new Date(row.otp_expires_at))
    return { ok: false, status: 400, reason: 'OTP_EXPIRED', message: 'Code expired — request a new one.' };

  return { ok: true };
}

module.exports = { generateOTP, verifyOtp, otpEqual, MAX_OTP_ATTEMPTS };
