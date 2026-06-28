// lib/otp.js — per-account OTP attempt cap (defense-in-depth ON TOP of the auth rate limiter).
// Locks an account's CURRENT otp after MAX wrong tries. The lock clears when a fresh OTP is issued (set
// otp_attempts = 0 in the same UPDATE that sets otp_code) or on success (set otp_attempts = 0 when clearing).
const MAX_OTP_ATTEMPTS = parseInt(process.env.MAX_OTP_ATTEMPTS || '5', 10);

// row  — must include: identity_id, otp_code, otp_expires_at, otp_attempts.
// run  — a query fn: the pool `query`, or a transaction `client.query`.
// submitted — the code the user typed.
// Returns { ok:true } (the caller then clears the OTP), or { ok:false, status, message } to send back verbatim.
async function verifyOtp(run, row, submitted) {
  if ((row.otp_attempts || 0) >= MAX_OTP_ATTEMPTS)
    return { ok: false, status: 429, message: 'Too many incorrect attempts — request a new code.' };

  const code = String(submitted == null ? '' : submitted).trim();
  if (!row.otp_code || row.otp_code !== code) {
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

module.exports = { verifyOtp, MAX_OTP_ATTEMPTS };
