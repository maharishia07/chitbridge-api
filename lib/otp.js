// lib/otp.js — per-account OTP attempt cap (defense-in-depth ON TOP of the auth rate limiter).
// Locks an account's CURRENT otp after MAX wrong tries. The lock clears when a fresh OTP is issued (set
// otp_attempts = 0 in the same UPDATE that sets otp_code) or on success (set otp_attempts = 0 when clearing).
const crypto = require('crypto');
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
 * DEV_OTP still overrides when explicitly set, for team testing — unchanged from every copy it replaces.
 */
function generateOTP() {
  return (process.env.DEV_OTP || '').trim() || crypto.randomInt(100000, 1000000).toString();
}

// S6 (reviewer 2026-07-13) — constant-time OTP comparison (no early-exit timing leak). Length-safe.
function otpEqual(a, b) {
  const ba = Buffer.from(String(a == null ? '' : a));
  const bb = Buffer.from(String(b == null ? '' : b));
  if (ba.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ba, bb); } catch (_) { return false; }
}

// row  — must include: identity_id, otp_code, otp_expires_at, otp_attempts.
// run  — a query fn: the pool `query`, or a transaction `client.query`.
// submitted — the code the user typed.
// Returns { ok:true } (the caller then clears the OTP), or { ok:false, status, message } to send back verbatim.
async function verifyOtp(run, row, submitted) {
  if ((row.otp_attempts || 0) >= MAX_OTP_ATTEMPTS)
    return { ok: false, status: 429, message: 'Too many incorrect attempts — request a new code.' };

  const code = String(submitted == null ? '' : submitted).trim();
  if (!row.otp_code || !otpEqual(row.otp_code, code)) {
    await run(`UPDATE identities SET otp_attempts = COALESCE(otp_attempts, 0) + 1 WHERE identity_id = $1`, [row.identity_id]);
    const left = Math.max(0, MAX_OTP_ATTEMPTS - ((row.otp_attempts || 0) + 1));
    return { ok: false, status: 400,
      message: left > 0 ? `Incorrect code — ${left} attempt${left === 1 ? '' : 's'} left.`
                        : 'Too many incorrect attempts — request a new code.' };
  }
  if (new Date() > new Date(row.otp_expires_at))
    return { ok: false, status: 400, message: 'Code expired — request a new one.' };

  return { ok: true };
}

module.exports = { generateOTP, verifyOtp, MAX_OTP_ATTEMPTS };
