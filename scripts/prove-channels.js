#!/usr/bin/env node
'use strict';
/**
 * prove-channels.js — PROVE the channel map routes many numbers to many entities, and that a claim is not a
 * permission. Runs against the LIVE API. No Meta account, no BSP, no cost.
 *
 * ── HOW IT CAN TEST WHATSAPP WITHOUT WHATSAPP ────────────────────────────────────────────────────────────────
 * The webhook does not trust Meta because it is Meta — it trusts an HMAC signature made with WHATSAPP_APP_SECRET.
 * That secret is OURS. So a payload we sign ourselves, in Meta's documented shape, is indistinguishable to the
 * server from a real delivery, and exercises exactly the same code path: signature → number→entity lookup →
 * capture. What it does NOT prove is that Meta's real payload matches the shape (see the note at the end).
 *
 *   WHATSAPP_APP_SECRET=<any long random string>   ← set on Railway; no Meta account needed
 *   CB_ADMIN_KEY=<another random string>           ← gates platform approval
 *
 * ── RUN ──────────────────────────────────────────────────────────────────────────────────────────────────────
 *   node scripts/prove-channels.js
 *
 * ⚠️ PUT THE SECRETS IN A FILE, NOT ON THE COMMAND LINE. Create `.env.proof` next to package.json:
 *
 *     WHATSAPP_APP_SECRET=the-value-you-set-on-railway
 *     CB_ADMIN_KEY=the-other-value-you-set-on-railway
 *
 * It is gitignored (`.env.*` — note a bare `.env` does NOT match `.env.proof`). Reading from a file rather than
 * an inline `VAR=x cmd` prefix matters for two reasons: that syntax is bash-only and silently breaks in Windows
 * PowerShell, and a secret typed on a command line ends up in shell history. Environment variables still win if
 * they are set, so CI can pass them the usual way.
 *
 * It cleans up after itself: every binding and capture it creates is removed at the end.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/** Load .env.proof (or .env) if present — values already in the environment always take precedence. */
(function loadEnvFile() {
  for (const name of ['.env.proof', '.env']) {
    const f = path.join(__dirname, '..', name);
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      const v = m[2].replace(/^['"]|['"]$/g, '');
      if (!process.env[m[1]] && v) process.env[m[1]] = v;
    }
  }
})();

const API = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
const SECRET = process.env.WHATSAPP_APP_SECRET;
const ADMIN = process.env.CB_ADMIN_KEY;
const OTP = process.env.DEV_OTP || '123456';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { console.log('  \x1b[32mok\x1b[0m  ' + name); pass++; } else { console.log('  \x1b[31mXX\x1b[0m  ' + name + (extra ? ' — ' + extra : '')); fail++; } };

async function j(p, o = {}) {
  const r = await fetch(API + p, { method: o.method || 'GET',
    headers: Object.assign({ 'Content-Type': 'application/json' }, o.token ? { Authorization: 'Bearer ' + o.token } : {}, o.headers || {}),
    body: o.body === undefined ? undefined : (typeof o.body === 'string' ? o.body : JSON.stringify(o.body)) });
  let b = null; try { b = await r.json(); } catch (_) {}
  return { status: r.status, b };
}
async function login(email, name) {
  await j('/api/entities/register', { method: 'POST', body: { email, display_name: name } });
  const v = await j('/api/entities/verify', { method: 'POST', body: { email, otp: OTP } });
  return (v.b && (v.b.token || (v.b.entity && v.b.entity.token))) || null;
}
/** A Meta-shaped inbound, signed the way Meta signs it. `to` is OUR business line; `from` is the customer. */
async function deliver(to, from, text) {
  const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: {
    metadata: { display_phone_number: to, phone_number_id: '000' },
    contacts: [{ wa_id: from, profile: { name: 'Test Customer' } }],
    messages: [{ from, id: 'wamid.' + Date.now(), type: 'text', text: { body: text } }],
  } }] }] });
  const sig = 'sha256=' + crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  return j('/api/capture/webhook/whatsapp', { method: 'POST', body: payload, headers: { 'X-Hub-Signature-256': sig } });
}
const pendingTexts = async (tok) => ((await j('/api/capture/pending', { token: tok })).b.captures || []).map((c) => c.raw_text);

(async () => {
  if (!SECRET || !ADMIN) {
    console.log('\n  Missing: ' + [!SECRET && 'WHATSAPP_APP_SECRET', !ADMIN && 'CB_ADMIN_KEY'].filter(Boolean).join(' and '));
    console.log('\n  Create ' + path.join(__dirname, '..', '.env.proof') + ' with two lines:\n');
    console.log('    WHATSAPP_APP_SECRET=the-value-you-set-on-railway');
    console.log('    CB_ADMIN_KEY=the-other-value-you-set-on-railway\n');
    console.log('  (it is gitignored). The SAME values must be set on Railway → Variables.\n');
    process.exit(2);
  }
  const stamp = Date.now().toString().slice(-6);
  const NUM_A = '+9199' + stamp + '1', NUM_B = '+9199' + stamp + '2', NUM_UNCLAIMED = '+9199' + stamp + '3';

  console.log('\nchannels · two entities, two numbers, one webhook');
  const A = await login('beta@test-cb.com', 'Beta Fresh');
  const B = await login('alpha@test-cb.com', 'Alpha Paints');
  ok('both entities signed in', !!A && !!B);

  const bindA = await j('/api/channels', { method: 'POST', token: A, body: { channel: 'whatsapp', address: NUM_A, label: 'A line' } });
  const bindB = await j('/api/channels', { method: 'POST', token: B, body: { channel: 'whatsapp', address: NUM_B, label: 'B line' } });
  ok('each entity claimed its own number', bindA.status === 201 && bindB.status === 201);
  ok('★ a claim starts DECLARED, never verified', bindA.b.status === 'declared' && bindB.b.status === 'declared');

  // ── ⚠️ THE GAP b124 CLOSES ────────────────────────────────────────────────────────────────────────────────
  const before = (await pendingTexts(A)).length;
  await deliver(NUM_A, '+919000000001', 'declared-should-not-arrive ' + stamp);
  ok('★★ a DECLARED binding receives NOTHING — a claim is not a permission',
     (await pendingTexts(A)).length === before);

  // ── the platform grants it ────────────────────────────────────────────────────────────────────────────────
  const apA = await j('/api/channels/' + bindA.b.id + '/approve', { method: 'POST', headers: { 'x-cb-admin-key': ADMIN }, body: {} });
  const apB = await j('/api/channels/' + bindB.b.id + '/approve', { method: 'POST', headers: { 'x-cb-admin-key': ADMIN }, body: {} });
  ok('the platform can approve', apA.status === 200 && apB.status === 200 && apA.b.status === 'verified');
  const noKey = await j('/api/channels/' + bindA.b.id + '/approve', { method: 'POST', headers: { 'x-cb-admin-key': 'wrong' }, body: {} });
  ok('★★ …and nobody else can — a wrong admin key is refused', noKey.status === 403);
  const asEntity = await j('/api/channels/' + bindA.b.id + '/approve', { method: 'POST', token: A, body: {} });
  ok('★★ …including the entity itself, with a valid session', asEntity.status === 403);

  // ── routing ───────────────────────────────────────────────────────────────────────────────────────────────
  const MSG_A = 'for-A-only ' + stamp, MSG_B = 'for-B-only ' + stamp;
  await deliver(NUM_A, '+919000000001', MSG_A);
  await deliver(NUM_B, '+919000000002', MSG_B);
  const inA = await pendingTexts(A), inB = await pendingTexts(B);
  ok('★★ A received A\'s message', inA.includes(MSG_A));
  ok('★★ B received B\'s message', inB.includes(MSG_B));
  ok('★★ A did NOT receive B\'s — one webhook, many entities, no leakage', !inA.includes(MSG_B));
  ok('★★ B did NOT receive A\'s', !inB.includes(MSG_A));

  // ── the collision and the unknown number ──────────────────────────────────────────────────────────────────
  const steal = await j('/api/channels', { method: 'POST', token: B, body: { channel: 'whatsapp', address: NUM_A } });
  ok('★★ B cannot claim A\'s number', steal.status === 409);
  const beforeU = (await pendingTexts(A)).length + (await pendingTexts(B)).length;
  await deliver(NUM_UNCLAIMED, '+919000000003', 'nobody-should-get-this ' + stamp);
  ok('★ a message to an UNBOUND number reaches nobody',
     (await pendingTexts(A)).length + (await pendingTexts(B)).length === beforeU);

  // ── a bad signature is refused ────────────────────────────────────────────────────────────────────────────
  const bad = await j('/api/capture/webhook/whatsapp', { method: 'POST', body: '{}', headers: { 'X-Hub-Signature-256': 'sha256=deadbeef' } });
  ok('★★ an unsigned / wrongly-signed delivery is rejected', bad.status === 401);

  // ── revoke ────────────────────────────────────────────────────────────────────────────────────────────────
  await j('/api/channels/' + bindA.b.id + '/revoke', { method: 'POST', headers: { 'x-cb-admin-key': ADMIN }, body: {} });
  const afterRevoke = (await pendingTexts(A)).length;
  await deliver(NUM_A, '+919000000001', 'after-revoke ' + stamp);
  ok('★ revoking stops delivery immediately', (await pendingTexts(A)).length === afterRevoke);

  // ── clean up: leave no bindings and no captures behind ────────────────────────────────────────────────────
  for (const [tok, id] of [[A, bindA.b.id], [B, bindB.b.id]]) await j('/api/channels/' + id, { method: 'DELETE', token: tok });
  for (const tok of [A, B]) {
    const caps = (await j('/api/capture/pending', { token: tok })).b.captures || [];
    for (const c of caps) if (String(c.raw_text || '').includes(stamp)) await j('/api/capture/' + c.id + '/dismiss', { method: 'POST', token: tok });
  }
  console.log('  \x1b[36m--\x1b[0m  cleaned up (bindings deleted, test captures dismissed)');

  console.log('\n  ' + (fail ? '\x1b[31m' + fail + ' FAILED\x1b[0m' : '\x1b[32mall passed\x1b[0m') + '  (' + pass + ' checks)');
  console.log('  \x1b[33m⚠️\x1b[0m  This proves OUR routing, signature check and isolation. It does NOT prove Meta\'s real');
  console.log('     payload matches the shape above — watch the first genuine message.\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('\nprove-channels crashed:', e && e.message, '\n'); process.exit(1); });
