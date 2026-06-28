// lib/notify.js — OTP delivery, dual-channel. Shared by entity register (entities.js) and the customer order
// flow (catalogue.js). Email via Resend; SMS provider-pluggable via env.
//
// DORMANT-SAFE: with no provider configured each sender logs and (in DEV only) reports `dev:true` so the caller
// may reveal the code for testing. In PRODUCTION it NEVER silently pretends to deliver — it logs an error and
// reports `delivered:false` (pairs with the boot guard so prod can't run with delivery unconfigured).
// Return shape: { delivered:boolean, dev?:boolean }.
const log = require('./logger');
const isProd = () => process.env.NODE_ENV === 'production';

async function sendOtpEmail(to, name, otp) {
  if (process.env.DEV_OTP) { console.log(`[DEV] Fixed OTP for ${to}: ${otp}`); return { delivered: false, dev: true }; }
  if (process.env.OTP_EMAIL_ENABLED !== 'true' || !process.env.RESEND_API_KEY) {
    if (isProd()) { log.error('email OTP not configured in production', { to }); return { delivered: false }; }
    console.log(`[OTP:email-dormant] ${to}: ${otp}`); return { delivered: false, dev: true };
  }
  try {
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: process.env.FROM_EMAIL || 'noreply@chitandbridge.com',
      to,
      subject: 'Your Chit and Bridge verification code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto;">
          <h2 style="color: #0D47A1;">Chit and Bridge</h2>
          <p>Hello ${name || 'there'},</p>
          <p>Your verification code is:</p>
          <div style="background: #f5f5f5; padding: 20px; text-align: center;
                      font-size: 32px; font-weight: bold; letter-spacing: 8px;
                      color: #0D47A1; border-radius: 8px; margin: 20px 0;">
            ${otp}
          </div>
          <p>This code expires in 1 hour.</p>
          <p style="color: #888; font-size: 12px;">If you did not request this, please ignore this email.</p>
        </div>
      `
    });
    return { delivered: true };
  } catch (err) {
    log.error('email OTP send failed', { to, err: err.message });
    if (!isProd()) console.log(`[FALLBACK OTP] ${to}: ${otp}`);
    return { delivered: false };
  }
}

// SMS — provider-pluggable via SMS_PROVIDER / SMS_API_KEY / SMS_SENDER_ID. No adapter wired yet, so it is a
// DORMANT stub: dev logs the code (testable); production logs an error and does NOT bypass.
async function sendOtpSms(to, otp) {
  if (process.env.DEV_OTP) { console.log(`[DEV] Fixed OTP (sms) for ${to}: ${otp}`); return { delivered: false, dev: true }; }
  const provider = process.env.SMS_PROVIDER, key = process.env.SMS_API_KEY;
  if (!provider || !key) {
    if (isProd()) { log.error('SMS OTP not configured in production', { to }); return { delivered: false }; }
    console.log(`[OTP:sms-dormant] ${to}: ${otp}`); return { delivered: false, dev: true };
  }
  // TODO: real adapter (e.g. Twilio / MSG91) using SMS_SENDER_ID. Until implemented, do NOT silently bypass in
  // production — log an error there; in dev, log the code so the flow is testable.
  if (isProd()) { log.error('SMS provider set but adapter not implemented', { provider, to }); return { delivered: false }; }
  console.log(`[OTP:sms-stub provider=${provider} sender=${process.env.SMS_SENDER_ID || ''}] ${to}: ${otp}`);
  return { delivered: false, dev: true };
}

// Dispatcher — pick the sender for the detected channel. `to` is the RAW contact (never the .cr handle).
async function sendOtp(channel, to, name, otp) {
  return channel === 'email' ? sendOtpEmail(to, name, otp) : sendOtpSms(to, otp);
}

module.exports = { sendOtp, sendOtpEmail, sendOtpSms };
