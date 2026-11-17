// OWNS      sending: the OTP (e-mail via Resend, SMS provider-pluggable), a generic notice e-mail, and the support alert OUR side gets when a money mismatch is found (ACC-206 B).
// CALLED BY routes/entities.js, routes/catalogue.js, lib/money-check.js (and the notice senders)
// FLOW      caller → sendOtp / sendEmail / sendSupportAlert → dormant-safe gate (DEV / unconfigured logs, production without config logs an error) → Resend
// CARD      25-ai-cb-assist-and-support-desks/support-desks
// lib/notify.js — OTP delivery, dual-channel. Shared by entity register (entities.js) and the customer order
// flow (catalogue.js). Email via Resend; SMS provider-pluggable via env.
//
// DORMANT-SAFE: with no provider configured each sender logs and (in DEV only) reports `dev:true` so the caller
// may reveal the code for testing. In PRODUCTION it NEVER silently pretends to deliver — it logs an error and
// reports `delivered:false` (pairs with the boot guard so prod can't run with delivery unconfigured).
// Return shape: { delivered:boolean, dev?:boolean }.
const log = require('./logger');
// ⚠️ This used to be `NODE_ENV === 'production'` while server.js sealed on ['production','uat','staging','live'].
// Setting NODE_ENV=uat at cutover would therefore have blocked DEV_OTP at boot while THIS file kept taking the dev
// branch and returning the code in the HTTP response — a half-seal that looks sealed. There is now ONE definition
// (lib/dev-otp.js) and nothing may redefine it. It also trims NODE_ENV, because production was observed carrying a
// leading space (" development") which silently defeated every === 'production' comparison in the codebase.
const { isSealed } = require('./dev-otp');
const isProd = () => isSealed();

async function sendOtpEmail(to, name, otp, opts) {
  const ttl = (opts && opts.ttl) || '1 hour'; // M02: an employee's first code lasts 24 hours, not the 1 hour a challenge does
  if (process.env.DEV_OTP) {
    console.log(`[DEV] Fixed OTP for ${to}: ${otp}`);
    return { delivered: false, dev: true };
  }
  if (process.env.OTP_EMAIL_ENABLED !== 'true' || !process.env.RESEND_API_KEY) {
    if (isProd()) {
      log.error('email OTP not configured in production', { to });
      return { delivered: false };
    }
    console.log(`[OTP:email-dormant] ${to}: ${otp}`);
    return { delivered: false, dev: true };
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
          <p>This code expires in ${ttl}.</p>
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
  if (process.env.DEV_OTP) {
    console.log(`[DEV] Fixed OTP (sms) for ${to}: ${otp}`);
    return { delivered: false, dev: true };
  }
  const provider = process.env.SMS_PROVIDER,
    key = process.env.SMS_API_KEY;
  if (!provider || !key) {
    if (isProd()) {
      log.error('SMS OTP not configured in production', { to });
      return { delivered: false };
    }
    console.log(`[OTP:sms-dormant] ${to}: ${otp}`);
    return { delivered: false, dev: true };
  }
  // TODO: real adapter (e.g. Twilio / MSG91) using SMS_SENDER_ID. Until implemented, do NOT silently bypass in
  // production — log an error there; in dev, log the code so the flow is testable.
  if (isProd()) {
    log.error('SMS provider set but adapter not implemented', { provider, to });
    return { delivered: false };
  }
  console.log(`[OTP:sms-stub provider=${provider} sender=${process.env.SMS_SENDER_ID || ''}] ${to}: ${otp}`);
  return { delivered: false, dev: true };
}

// Dispatcher — pick the sender for the detected channel. `to` is the RAW contact (never the .cr handle).
async function sendOtp(channel, to, name, otp) {
  return channel === 'email' ? sendOtpEmail(to, name, otp) : sendOtpSms(to, otp);
}

// Generic NOTICE email — an off-rail nudge to someone NOT in the system (e.g. a connector's external CC). Same
// DORMANT-SAFE gating as the OTP path: DEV / unconfigured never sends (logs only); prod without config logs + no-op.
// It is a notice, never the governed payload. Best-effort — the caller must never fail its work over delivery.
async function sendEmail(to, subject, html) {
  if (process.env.DEV_OTP) {
    console.log(`[DEV] notice email to ${to}: ${subject}`);
    return { delivered: false, dev: true };
  }
  if (process.env.OTP_EMAIL_ENABLED !== 'true' || !process.env.RESEND_API_KEY) {
    if (isProd()) {
      log.error('notice email not configured in production', { to });
      return { delivered: false };
    }
    console.log(`[email-dormant] ${to}: ${subject}`);
    return { delivered: false, dev: true };
  }
  try {
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({ from: process.env.FROM_EMAIL || 'noreply@chitandbridge.com', to, subject, html });
    return { delivered: true };
  } catch (err) {
    log.error('notice email send failed', { to, err: err.message });
    return { delivered: false };
  }
}

/**
 * sendSupportAlert(to, ticket) — the mail OUR side gets when a money mismatch is found (ACC-206 B · Athi 2026-10-30: "it should reach us directly"). A sibling of
 * sendEmail (same dormant-safe gating, same Resend), never to a shop. ticket = { ticket_id, shop, chit_id, facts } or { digest: true, tickets: [...] }.
 * It names the chit, each value with its writer, the reader that saw it and the ticket, so Support can act before the shop phones.
 */
async function sendSupportAlert(to, ticket) {
  const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]);
  if (ticket && ticket.digest) {
    const rows = (ticket.tickets || []).map((item) => '<li>chit ' + escapeHtml(item.chit_id) + ' · ticket ' + escapeHtml(item.ticket_id) + '</li>').join('');
    return sendEmail(to, 'ChitBridge: ' + (ticket.tickets || []).length + ' more money mismatches this hour', '<p>More than five this hour. The rest:</p><ul>' + rows + '</ul>');
  }
  const facts = (ticket && ticket.facts) || {};
  const values = (facts.values || []).map((item) => '<li>' + escapeHtml(item.field) + ' = ' + escapeHtml(item.value) + ' — written by ' + escapeHtml(JSON.stringify(item.writer)) + '</li>').join('');
  const html =
    '<p>Two stored copies of one engine figure disagree.</p><ul><li>shop ' + escapeHtml(ticket.shop) + '</li><li>chit ' + escapeHtml(ticket.chit_id) + '</li><li>seen by ' + escapeHtml(facts.reader) +
    ' at ' + escapeHtml(facts.at) + '</li>' + values + '<li>support ticket ' + escapeHtml(ticket.ticket_id) + '</li></ul><p>The other party has not been told.</p>';
  return sendEmail(to, 'ChitBridge: money mismatch on chit ' + String(ticket.chit_id).slice(0, 8), html);
}

module.exports = { sendOtp, sendOtpEmail, sendOtpSms, sendEmail, sendSupportAlert };
