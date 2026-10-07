'use strict';
/**
 * employee-code.js — M02: THE ONE PLACE an employee's first sign-in code is made, timed, delivered and shown.
 *
 * Invariants (tests/employee-code.test.cjs):
 *   · a SEALED environment never shows a code in a response — it is e-mailed or the request is refused;
 *   · a code is single-use (routes/actors.js clears it on the first good login; lib/otp.js verifyOtp then fails) and valid 24 h.
 * Reuses: lib/dev-otp.js (isSealed, fixedOtp), lib/otp.js (generateOTP), lib/notify.js (sendOtpEmail → Resend). No second sender.
 * Unsealed (dev/test) behaviour is unchanged: the owner still sees the code once, so work never stops without a mailbox.
 */
const devOtp = require('./dev-otp');
const { generateOTP } = require('./otp');

const TTL_MS = 24 * 60 * 60 * 1000;
const TTL_WORDS = '24 hours';

const mint = () => ({ otp: devOtp.fixedOtp('entity') || generateOTP(), expires: new Date(Date.now() + TTL_MS) });

/** Resend is configured when real delivery is switched on AND a key and a from-address exist. */
const resendReady = () => String(process.env.OTP_EMAIL_ENABLED || '').trim() === 'true'
  && !!String(process.env.RESEND_API_KEY || '').trim() && !!String(process.env.FROM_EMAIL || '').trim();

const validEmail = (s) => typeof s === 'string' && /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(s.trim());

const mask = (e) => { const s = String(e), i = s.indexOf('@'); return (s.slice(0, 1) || '*') + '***' + s.slice(i); };

/**
 * Call BEFORE writing anything. Null = go ahead; otherwise { status, body } to send as-is.
 * Only a sealed environment is ever refused: there nobody may read a code off the screen, so without a mailbox
 * and Resend there is no way to hand it over.
 */
function refusal(to) {
  if (!devOtp.isSealed()) return null;
  if (!resendReady()) return { status: 503, body: { error: 'E-mail delivery is not configured', code: 'EMAIL_DELIVERY_NOT_CONFIGURED',
    message: 'This environment is sealed and has no e-mail sender set up, so a first code cannot be delivered. Nothing was changed.' } };
  if (!validEmail(to)) return { status: 400, body: { error: 'E-mail required', code: 'EMPLOYEE_EMAIL_REQUIRED',
    message: 'Add this employee\'s e-mail address — the first code is sent there and is never shown on screen.' } };
  return null;
}

/**
 * Deliver the code and return the fields to spread into the response.
 * `send` defaults to notify.sendOtpEmail; tests pass a stub, so nothing real is ever sent.
 * `otp` appears in the body only when the environment is NOT sealed.
 */
async function deliver({ to, name, otp, send }) {
  const out = { expires_in: TTL_WORDS };
  const sealed = devOtp.isSealed();
  let delivery = 'none';
  if (validEmail(to)) {
    const sender = send || require('./notify').sendOtpEmail;
    let r = null;
    try { r = await sender(String(to).trim(), name, otp, { ttl: TTL_WORDS }); } catch (_) { r = null; }
    if (r && r.delivered) { delivery = 'sent'; out.sent_to = mask(to); } else delivery = 'failed';
  }
  out.delivery = delivery;
  if (delivery === 'none') out.delivery_note = 'No e-mail on file — read the code to them.';
  if (delivery === 'failed') out.delivery_note = 'The e-mail could not be sent. Reset the code to try again.';
  if (!sealed) out.otp = otp;
  return out;
}

module.exports = { TTL_MS, TTL_WORDS, mint, refusal, deliver, resendReady, validEmail, mask };
