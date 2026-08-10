#!/usr/bin/env node
'use strict';
/**
 * prove-outbound.js — PROVE the notify-back DECISION LOGIC against the live API and the real database (b126).
 *
 * ⚠️ WHAT THIS CANNOT PROVE, AND WHY. Inbound was verifiable end-to-end because the webhook trusts an HMAC made
 * with OUR secret — a self-signed payload is indistinguishable from Meta's. Outbound calls META'S servers; there
 * is nothing to self-sign, so the wire call stays unproven until a real WHATSAPP_TOKEN exists.
 *
 * What IS provable without a token is the part that decides WHETHER to send — which is where all the governance
 * lives, and where getting it wrong is expensive:
 *   · a chit that came from a channel produces an outbound attempt
 *   · a chit that did NOT came from a channel produces NOTHING (messaging a stranger is the failure mode)
 *   · with no token it REFUSES, and the refusal is RECORDED with its reason
 *   · the refusal never disturbs the chit — the status change succeeds regardless
 *   · the reply is addressed to the customer, FROM the line they wrote to
 *
 * Run:  node scripts/prove-outbound.js       (reads .env.proof / .env.proof.txt, same as prove-channels.js)
 * It cleans up after itself.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

(function loadEnvFile() {
  for (const name of ['.env.proof', '.env.proof.txt', '.env']) {
    const f = path.join(__dirname, '..', name);
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      const v = m[2].trim().replace(/^['"]|['"]$/g, '').trim();
      if (!process.env[m[1]] && v) process.env[m[1]] = v;
    }
  }
})();

const API = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
const SECRET = process.env.WHATSAPP_APP_SECRET;
const ADMIN = process.env.CB_ADMIN_KEY;

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { console.log('  \x1b[32mok\x1b[0m  ' + n); pass++; } else { console.log('  \x1b[31mXX\x1b[0m  ' + n + (x ? ' — ' + x : '')); fail++; } };

async function j(p, o = {}) {
  const r = await fetch(API + p, { method: o.method || 'GET',
    headers: Object.assign({ 'Content-Type': 'application/json' }, o.token ? { Authorization: 'Bearer ' + o.token } : {}, o.headers || {}),
    body: o.body === undefined ? undefined : (typeof o.body === 'string' ? o.body : JSON.stringify(o.body)) });
  let b = null; try { b = await r.json(); } catch (_) {}
  return { status: r.status, b };
}
async function login(email, name) {
  await j('/api/entities/register', { method: 'POST', body: { email, display_name: name } });
  const v = await j('/api/entities/verify', { method: 'POST', body: { email, otp: '123456' } });
  return (v.b && (v.b.token || (v.b.entity && v.b.entity.token))) || null;
}
async function deliver(to, from, text) {
  const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: {
    metadata: { display_phone_number: to, phone_number_id: '000' },
    contacts: [{ wa_id: from, profile: { name: 'Test Customer' } }],
    messages: [{ from, id: 'wamid.' + Date.now() + Math.random(), type: 'text', text: { body: text } }],
  } }] }] });
  const sig = 'sha256=' + crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  return j('/api/capture/webhook/whatsapp', { method: 'POST', body: payload, headers: { 'X-Hub-Signature-256': sig } });
}

(async () => {
  if (!SECRET || !ADMIN) { console.log('\n  Missing WHATSAPP_APP_SECRET / CB_ADMIN_KEY — see prove-channels.js header.\n'); process.exitCode = 2; return; }
  const canary = await j('/api/capture/webhook/whatsapp', { method: 'POST', body: '{}', headers: { 'X-Hub-Signature-256': 'sha256=deadbeef' } });
  if (canary.status !== 401) { console.log('\n  ABORTED — server not enforcing signatures; run prove-channels.js first.\n'); process.exitCode = 2; return; }

  const stamp = Date.now().toString().slice(-6);
  const NUM = '+9166' + stamp + '0', CUST = '+9190' + stamp + '9';
  const A = await login('beta@test-cb.com', 'Beta Fresh');

  console.log('\noutbound · a chit that came from WhatsApp');
  const bind = await j('/api/channels', { method: 'POST', token: A, body: { channel: 'whatsapp', address: NUM, label: 'out proof' } });
  await j('/api/channels/' + bind.b.id + '/approve', { method: 'POST', headers: { 'x-cb-admin-key': ADMIN }, body: {} });
  await deliver(NUM, CUST, 'outbound proof ' + stamp);
  const caps = ((await j("/api/capture/pending", { token: A })).b || {}).captures || [];
  const cap = caps.find((c) => String(c.raw_text || '').includes('outbound proof ' + stamp));
  ok('the message arrived as a capture', !!cap);
  // ⚠️ b126's whole point: we must know WHICH of our lines they wrote to, or a reply comes from a stranger.
  ok('★★ the capture records WHICH of our lines they wrote to (to_ref)', cap && cap.to_ref === NUM, cap && ('to_ref=' + cap.to_ref));

  // confirm it into a chit, exactly as the Intake screen does: send, then link.
  const chit = await j('/api/chits/send', { method: 'POST', token: A, body: {
    recipients: [{ name: 'Self', role: 'to', self: true }], is_draft: false, send_as_label: 'Beta Fresh',
    subject: 'Outbound proof ' + stamp, schema_values: { subject: 'Outbound proof ' + stamp },
    line_items: [{ particulars: 'bolts', quantity: 2, price: 10, total: 20 }], external_priority: 'normal' } });
  ok('the chit was sent', chit.status === 200 || chit.status === 201, JSON.stringify(chit.b).slice(0, 120));
  const chit_id = chit.b && chit.b.chit_id;
  await j('/api/capture/' + cap.id + '/convert', { method: 'POST', token: A, body: { chit_id } });

  const before = ((await j('/api/channels/outbound', { token: A })).b.outbound || []).length;
  const st = await j('/api/chits/' + chit_id + '/status', { method: 'PUT', token: A, body: { status: 'accepted', note: 'proof' } });
  ok('★★ the status change SUCCEEDS regardless of outbound', st.status === 200, JSON.stringify(st.b).slice(0, 120));

  await new Promise((r) => setTimeout(r, 2500));   // notify is fire-and-forget, after the response
  const outb = (await j('/api/channels/outbound', { token: A })).b.outbound || [];
  const mine = outb.find((o) => o.chit_id === chit_id);
  ok('★★ an outbound attempt was RECORDED for a channel-born chit', !!mine, 'rows now ' + outb.length + ' (was ' + before + ')');
  if (mine) {
    // With no WHATSAPP_TOKEN the only correct outcome is a refusal that SAYS SO — never a silent drop, and never
    // a "sent" we cannot back up.
    ok('★★ …and with no token it REFUSED, with a reason', mine.status === 'refused' && /WHATSAPP_TOKEN/.test(mine.reason || ''), mine.status + ': ' + mine.reason);
    ok('★★ …addressed to the CUSTOMER, from the line they wrote to', mine.to_ref === CUST && mine.from_ref === NUM, 'to=' + mine.to_ref + ' from=' + mine.from_ref);
    ok('★ …carrying what we would have said', /accepted/i.test(mine.body || ''), mine.body);
  }

  console.log('\noutbound · ⚠️ a chit that did NOT come from a channel');
  /**
   * The failure mode this guards is unsolicited contact: a chit composed in the app has nobody waiting on
   * WhatsApp, and replying to whoever happens to be bound would message a stranger about an order they never
   * placed. No capture, no reply.
   */
  const plain = await j('/api/chits/send', { method: 'POST', token: A, body: {
    recipients: [{ name: 'Self', role: 'to', self: true }], is_draft: false, send_as_label: 'Beta Fresh',
    subject: 'App-composed ' + stamp, schema_values: { subject: 'App-composed ' + stamp },
    line_items: [{ particulars: 'x', quantity: 1, price: 1, total: 1 }], external_priority: 'normal' } });
  const plain_id = plain.b && plain.b.chit_id;
  await j('/api/chits/' + plain_id + '/status', { method: 'PUT', token: A, body: { status: 'accepted' } });
  await new Promise((r) => setTimeout(r, 2500));
  const outb2 = (await j('/api/channels/outbound', { token: A })).b.outbound || [];
  ok('★★ NOTHING was sent or logged for it — no capture, no reply', !outb2.find((o) => o.chit_id === plain_id));

  // ── clean up ────────────────────────────────────────────────────────────────────────────────────────────────
  await j('/api/channels/' + bind.b.id, { method: 'DELETE', token: A });
  console.log('  \x1b[36m--\x1b[0m  cleaned up (binding removed; the two proof chits remain — chits are records, not litter)');

  console.log('\n  ' + (fail ? '\x1b[31m' + fail + ' FAILED\x1b[0m' : '\x1b[32mall passed\x1b[0m') + '  (' + pass + ' checks)');
  console.log('  \x1b[33m⚠️\x1b[0m  This proves the DECISION to send. The wire call to Meta is NOT covered and cannot be');
  console.log('     until a real WHATSAPP_TOKEN exists — outbound talks to Meta, so there is nothing to self-sign.\n');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('\nprove-outbound crashed:', e && e.message, '\n'); process.exitCode = 1; });
