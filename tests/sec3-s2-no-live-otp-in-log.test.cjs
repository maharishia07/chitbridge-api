#!/usr/bin/env node
// @type: unit
/**
 * sec3-s2-no-live-otp-in-log.test.cjs — S2 (VERIFY-EL-SECURITY): lib/notify.js printed the live one-time code to the host log.
 * ATTACK    anyone with log access reads "[DEV] Fixed OTP for owner@shop: 481516" (DEV_OTP left set, NODE_ENV unset/odd) or "[FALLBACK OTP]" after a mail outage, and signs in as that owner.
 * RULE      a code is printed only when DEV_OTP is explicitly on AND NODE_ENV is test (or development on a local database); never on a sealed host; never because mail was merely skipped or failed
 *           (the line says "mail not sent" without the code).
 * RUN       node tests/sec3-s2-no-live-otp-in-log.test.cjs        STANDARD  OWASP ASVS 4.0.3 V7.1.1 (no credentials in logs) · V2.1
 * CARD      25-ai-cb-assist-and-support-desks/support-desks
 */
'use strict';
const path = require('path');
const out = (s) => process.stdout.write(s + '\n');
let bad = 0;
const t = (n, ok) => { out((ok ? 'ok   ' : 'FAIL ') + n); if (!ok) bad++; };
const resendPath = require.resolve('resend', { paths: [path.join(__dirname, '..')] });
let failSend = false;
let lastHtml = '';
require.cache[resendPath] = { id: resendPath, filename: resendPath, loaded: true, exports: { Resend: class { constructor() { this.emails = { send: async (m) => { lastHtml = m.html; if (failSend) throw new Error('provider down'); } }; } } } };
const KEYS = ['NODE_ENV', 'DEV_OTP', 'DATABASE_URL', 'OTP_EMAIL_ENABLED', 'RESEND_API_KEY', 'SMS_PROVIDER', 'SMS_API_KEY'];
const LIVE = '481516';

async function run(env, fn) {
  KEYS.forEach((k) => delete process.env[k]);
  Object.assign(process.env, env);
  ['../lib/notify', '../lib/dev-otp', '../lib/logger'].forEach((m) => delete require.cache[require.resolve(m)]);
  const buf = [];
  const keep = {};
  ['log', 'warn', 'error', 'info'].forEach((k) => { keep[k] = console[k]; console[k] = (...a) => buf.push(a.map(String).join(' ')); });
  const ow = process.stdout.write, ew = process.stderr.write;
  process.stdout.write = (s) => { buf.push(String(s)); return true; };
  process.stderr.write = (s) => { buf.push(String(s)); return true; };
  try { await fn(require('../lib/notify')); } finally { process.stdout.write = ow; process.stderr.write = ew; Object.assign(console, keep); }
  return buf.join('\n');
}

(async () => {
  const both = (n) => async (notify) => { await notify.sendOtp('email', 'owner@shop.test', 'Owner', LIVE); await notify.sendOtp('sms', '+919800000001', 'Owner', LIVE); };
  let log = await run({ NODE_ENV: 'production', DEV_OTP: '1' }, both());
  t('sealed host with DEV_OTP left set: no code in the log', !log.includes(LIVE));
  log = await run({ NODE_ENV: ' development', DEV_OTP: '1', DATABASE_URL: 'postgres://u:p@db.example.com:5432/x' }, both());
  t('" development" on a remote database (the 14 Oct production state): no code in the log', !log.includes(LIVE));
  log = await run({ DEV_OTP: '1' }, both());
  t('NODE_ENV unset with DEV_OTP: no code in the log', !log.includes(LIVE));
  log = await run({ NODE_ENV: 'development' }, both());
  t('unsealed, mail merely skipped (no DEV_OTP): says "mail not sent", no code', !log.includes(LIVE) && /mail not sent/.test(log));
  failSend = true;
  log = await run({ NODE_ENV: 'development', OTP_EMAIL_ENABLED: 'true', RESEND_API_KEY: 'k' }, both());
  failSend = false;
  t('unsealed, provider outage: no FALLBACK code in the log', !log.includes(LIVE));
  log = await run({ NODE_ENV: 'test', DEV_OTP: '1' }, both());
  t('DEV_OTP on + NODE_ENV test: the developer still sees the code', log.includes(LIVE));
  log = await run({ NODE_ENV: 'development', DEV_OTP: '1', DATABASE_URL: 'postgres://u@127.0.0.1:5432/x' }, both());
  t('DEV_OTP on + development on a local database: the developer still sees the code', log.includes(LIVE));
  log = await run({ NODE_ENV: 'test', OTP_EMAIL_ENABLED: 'true', RESEND_API_KEY: 'k' }, async (n) => { await n.sendOtp('email', 'o@s.test', '<b>Your account is suspended</b> & call 98xxxx please do it now before midnight', LIVE); });
  t('(S14) the mail name is escaped and short: no markup, no long message from the platform', !/<b>/.test(lastHtml) && /&lt;b&gt;/.test(lastHtml) && !/midnight/.test(lastHtml));
  process.exit(bad ? 1 : 0);
})();
