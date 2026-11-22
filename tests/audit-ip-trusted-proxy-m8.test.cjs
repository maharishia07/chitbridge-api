#!/usr/bin/env node
// @type: unit
/**
 * audit-ip-trusted-proxy-m8.test.cjs — M8 (VERIFY-GF-MONEY-SECURITY): the audit address comes from the trusted-proxy rule, never from the caller-typed left end of X-Forwarded-For.
 * ATTACK    a registrant sends `X-Forwarded-For: 10.1.1.1`; the consent record (signup_context.ip) and signin_events.ip kept 10.1.1.1.
 * RULE      lib/client-ip.js reads req.ip, which Express computes from `trust proxy` (server.js: 1) as the rightmost hop we do not trust; routes/signin.js and lib/signin-events.js use it and read no X-Forwarded-For.
 * RUN       node tests/audit-ip-trusted-proxy-m8.test.cjs
 * CARD      18-identity-sign-in-and-access/sign-in
 */
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.DATABASE_URL = '';
const say = console.log.bind(console);
['log', 'warn', 'info', 'error'].forEach((k) => { console[k] = () => {}; });
const ROOT = path.join(__dirname, '..');
const { clientIp } = require(path.join(ROOT, 'lib', 'client-ip'));
const signinEvents = require(path.join(ROOT, 'lib', 'signin-events'));
let bad = 0;
const t = (name, ok, extra) => { say((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : ' ' + (extra || ''))); if (!ok) bad++; };

(async () => {
  const app = express();
  app.set('trust proxy', 1); // exactly server.js
  app.get('/ip', (req, res) => res.json({ ip: clientIp(req), event_ip: signinEvents.fromRequest ? signinEvents.fromRequest(req).ip : null }));
  const srv = app.listen(0);
  const port = srv.address().port;
  /* the platform proxy APPENDS the address it saw (203.0.113.7) to whatever the caller sent */
  const get = (xff) => new Promise((resolve, reject) => http.get({ port, path: '/ip', headers: { 'x-forwarded-for': xff } }, (r) => { let s = ''; r.on('data', (c) => { s += c; }); r.on('end', () => resolve(JSON.parse(s))); }).on('error', reject));
  const forged = await get('10.1.1.1, 203.0.113.7');
  t('a caller-typed left element is ignored: the address is the one hop the proxy saw (203.0.113.7)', forged.ip === '203.0.113.7', JSON.stringify(forged));
  t('the sign-in log row (lib/signin-events.js fromRequest) carries the same address', forged.event_ip === '203.0.113.7', JSON.stringify(forged));
  const longer = await get('1.1.1.1, 2.2.2.2, 203.0.113.9');
  t('a longer typed chain still gives the rightmost untrusted hop (proxy count 1)', longer.ip === '203.0.113.9', JSON.stringify(longer));
  srv.close();
  t('an unreadable address is empty, never a typed string', clientIp({ ip: "1.1.1.1'; DROP" }) === '' && clientIp({}) === '');
  for (const f of ['routes/signin.js', 'lib/signin-events.js']) t(f + ' reads no X-Forwarded-For', !/x-forwarded-for/i.test(fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')), f);
  say(bad ? bad + ' failed' : 'all passed');
  process.exit(bad ? 1 : 0);
})();
