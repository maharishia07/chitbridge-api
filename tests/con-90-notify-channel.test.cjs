/**
 * tests/con-90-notify-channel.test.cjs — CON-90 · dual-channel customer OTP: lib/notify.js sendOtp delivers on the channel the identifier is.
 * OWNS      the proof that sendOtp('email') goes to the e-mail sender (Resend) and sendOtp('sms') goes to the SMS sender, never crossed, and that each is dormant-safe (never "delivered" without a provider).
 * CALLED BY scripts/guards.cjs (P2 PROOF pass 2026-11-14)
 * FLOW      stub Resend (the e-mail transport) → real lib/notify.sendOtp → which transport was touched, what was answered
 * CARD      23-connectors-and-integrations
 * Hand-computed: email + key set → 1 e-mail sent to `to`, delivered:true; sms + no provider → 0 e-mails, {delivered:false, dev:true}; sms + provider set → still 0 e-mails (stub, dev:true).
 */
'use strict';
const path = require('path');
const { ok, done, API } = require('./lib/cat-proof-kit.cjs');

process.env.NODE_ENV = 'test';
delete process.env.DEV_OTP;
const sent = [];
const resendPath = require.resolve('resend', { paths: [API] });
require.cache[resendPath] = { id: resendPath, filename: resendPath, loaded: true, exports: { Resend: class { constructor(key) { this.key = key; this.emails = { send: async (m) => { sent.push(m); return { id: 'x' }; } }; } } } };
const notify = require(path.join(API, 'lib', 'notify.js'));
const quiet = console.log; const lines = [];
console.log = (...a) => lines.push(a.join(' '));

(async () => {
  process.env.OTP_EMAIL_ENABLED = 'true'; process.env.RESEND_API_KEY = 'k';
  delete process.env.SMS_PROVIDER; delete process.env.SMS_API_KEY;
  const e = await notify.sendOtp('email', 'a@b.co', 'Asha', '123456');
  const eMail = sent.length === 1 && sent[0].to === 'a@b.co' && /123456/.test(sent[0].html);
  const s1 = await notify.sendOtp('sms', '+919800000001', 'Asha', '654321');
  const smsDidNotMail = sent.length === 1;
  process.env.SMS_PROVIDER = 'msg91'; process.env.SMS_API_KEY = 'sk';
  const s2 = await notify.sendOtp('sms', '+919800000001', 'Asha', '654321');
  const smsProviderDidNotMail = sent.length === 1;
  process.env.OTP_EMAIL_ENABLED = 'false';
  const e2 = await notify.sendOtp('email', 'a@b.co', 'Asha', '111111');
  process.env.DEV_OTP = '1';
  const eDev = await notify.sendOtp('email', 'a@b.co', 'Asha', '222222');
  const sDev = await notify.sendOtp('sms', '+919800000001', 'Asha', '333333');
  console.log = quiet;

  console.log('\nCON-90 · sendOtp chooses the channel');
  ok('channel "email" → one e-mail to the address carrying the code, delivered:true', e.delivered === true && eMail, JSON.stringify({ e, sent }));
  ok('channel "sms" → no e-mail sent, and with no provider it is dormant-safe: {delivered:false, dev:true}', smsDidNotMail && s1.delivered === false && s1.dev === true, JSON.stringify(s1));
  ok('channel "sms" with a provider set → still no e-mail; the stub never claims delivery', smsProviderDidNotMail && s2.delivered === false && lines.some((l) => /sms-stub provider=msg91/.test(l)), JSON.stringify({ s2, lines }));
  ok('e-mail not enabled → no e-mail sent, delivered:false (never a silent pretend)', sent.length === 1 && e2.delivered === false);
  ok('DEV_OTP on: each channel answers dev:true on its OWN log line (email, sms)', eDev.dev === true && sDev.dev === true && lines.some((l) => /\[DEV\] Fixed OTP for a@b\.co/.test(l)) && lines.some((l) => /\[DEV\] Fixed OTP \(sms\) for \+919800000001/.test(l)), JSON.stringify(lines));
  done();
})();
