'use strict';
/**
 * lib/signin-code.js — a fresh sign-in code on an identity, then to its inbox (storeCode · sentWords · sendCode).
 * OWNS      the owner/registration code write and the one sentence for a mail's outcome
 * CALLED BY routes/signin.js (re-exports sendCode and sentWords, as routes/entities.js reads them there)
 * FLOW      storeCode (OTP row under the identity's own binding) → sendOtpEmail → the JSON answer
 * CARD      18-identity-sign-in-and-access/sign-in
 */
const devOtp = require('./dev-otp');
const { generateOTP } = require('./otp');
const { sendOtpEmail } = require('./notify');
const { query } = require('../db');
const { boundRead } = require('./bound-read');

/**
 * sendCode — a fresh code on the identity, then to its inbox. Shared by ask and by registration (routes/entities.js),
 * which ends the same way. ⚠️ fixedOtp('entity') is null the moment the environment is sealed (lib/dev-otp.js), so a
 * DEV_OTP left set by mistake can never make a production code predictable. TTL stays 60 min (D4's 10 min is a change
 * to who can sign in — not in this move).
 */
/** M1: a re-ask keeps the count while the old code is unexpired (as lib/otp.js issueShopperOtp), so asking again never returns the guesses */
/** a fresh code on the identity (kept plain here, as the owner door always has) — the code itself is returned */
async function storeCode(identity_id) {
  const code = generateOTP('entity');
  const expires = new Date(Date.now() + 60 * 60 * 1000);
  const kept = await require('./employee-code').codeSet(identity_id, code, 1); /* A11: the keyed hash, not the code */
  await boundRead(query, identity_id, `UPDATE identities SET ${kept.sql}, otp_expires_at = $2, otp_attempts = CASE WHEN otp_expires_at IS NULL OR otp_expires_at < NOW() THEN 0 ELSE COALESCE(otp_attempts, 0) END WHERE identity_id = $3`, [kept.value, expires, identity_id]);
  return code;
}
/**
 * ⭐ SEC-148 · sentWords(sent) → the ONE sentence for a mail's outcome ({ delivered, dev } from lib/notify). The new-address path (sendCode) and the held-address path
 * (routes/entities.js, the "already on file" notice) both say it, so a mailer outage reads the same on both and the words cannot tell a held address from a free one.
 */
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
          handle: (await boundRead(query, identity_id, 'SELECT user_id FROM identities WHERE identity_id = $1', [identity_id])).rows[0]?.user_id || null,
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


module.exports = { storeCode, sentWords, sendCode };
