#!/usr/bin/env node
'use strict';
/**
 * prove-request-from-message.js — a WhatsApp message becomes a REQUEST addressed to the entity.
 *
 * Athi, 2026-08-09: *"what we need is creating a chit and send it to the entity as a request"* and
 * *"we can create a self chit and you can make the order copy none, it will create a task."*
 *
 * ── WHAT IS ACTUALLY BEING PROVED ───────────────────────────────────────────────────────────────────────────────
 * Not "a chit was created" — that is easy and says nothing. The claims worth failing on are:
 *   · it lands as a TASK and NOT in the Order list  (the entity did not raise it; Sent would be a lie)
 *   · the suppression is DECLARED, with source:'request'  (a missing copy that cannot be told from a gap is a gap)
 *   · it is an `inquiry`, not an `order`  (a stranger's message must not mint an obligation)
 *   · the WhatsApp reference is ON the chit, from the CAPTURE ROW, and survives to a fresh read
 *   · the sender is recorded as NOT VERIFIED
 *   · the customer is NOT a party  (a phone number is not an entity, and the rail must keep refusing to pretend)
 *   · a second press cannot raise the same message twice
 *
 * ── ⚠️ WHAT THIS DOES NOT PROVE ─────────────────────────────────────────────────────────────────────────────────
 * That Meta delivered anything. The webhook payload here is signed and real, but the TRANSPORT is stood in for.
 * Nothing can carry a real WhatsApp message without a WhatsApp Business account.
 *
 * RUN:  node scripts/prove-request-from-message.js
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
const LINE = '+919000000333';                  // the business line for this proof
const CUST = '+919000000444';                  // the customer

let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + m); } else { fail++; console.log('  \x1b[31m✗ ' + m + '\x1b[0m' + (extra ? '\n      ' + extra : '')); } };

async function j(p, o = {}) {
  const r = await fetch(API + p, { method: o.method || 'GET',
    headers: Object.assign({ 'Content-Type': 'application/json' }, o.token ? { Authorization: 'Bearer ' + o.token } : {}, o.headers || {}),
    body: o.body === undefined ? undefined : (typeof o.body === 'string' ? o.body : JSON.stringify(o.body)) });
  let b = null; try { b = await r.json(); } catch (_) {}
  return { status: r.status, b };
}

(async () => {
  console.log('\n  prove-request-from-message — a message becomes a request, not an order\n');
  if (!SECRET || !ADMIN) { console.log('  Missing WHATSAPP_APP_SECRET / CB_ADMIN_KEY — see prove-channels.js.\n'); process.exitCode = 2; return; }

  /* ── PRECONDITION. A proof that cannot fail proves nothing: if the server is not enforcing signatures, every
     assertion below would pass while the door stood open. Abort rather than print a green wall. */
  const unsigned = await j('/api/capture/webhook/whatsapp', { method: 'POST', body: '{}', headers: { 'X-Hub-Signature-256': 'sha256=deadbeef' } });
  if (unsigned.status !== 401) {
    console.log('  \x1b[31mABORT\x1b[0m — an unsigned webhook was not rejected (got ' + unsigned.status + ').');
    console.log('  Everything below would pass without proving anything. Check WHATSAPP_APP_SECRET on the server.\n');
    process.exitCode = 2; return;
  }
  console.log('  precondition: an unsigned webhook is refused (401) — the checks below mean something\n');

  const email = 'req-proof@test-cb.com';
  await j('/api/entities/register', { method: 'POST', body: { email, display_name: 'Request Proof Co' } });
  const v = await j('/api/entities/verify', { method: 'POST', body: { email, otp: process.env.DEV_OTP || '123456' } });
  const tok = (v.b && (v.b.token || (v.b.entity && v.b.entity.token))) || null;
  if (!tok) { console.log('  could not sign in\n'); process.exitCode = 1; return; }

  // bind + approve the business line
  const list = await j('/api/channels', { token: tok });
  const wa = (list.b.channels || []).find((c) => c.key === 'whatsapp') || { bindings: [] };
  let bind = (wa.bindings || []).find((b) => b.address === LINE);
  if (!bind) { const made = await j('/api/channels', { method: 'POST', token: tok, body: { channel: 'whatsapp', address: LINE, label: 'proof line' } }); bind = made.b; }
  if (bind && bind.status !== 'verified') await j('/api/channels/' + bind.id + '/approve', { method: 'POST', headers: { 'x-cb-admin-key': ADMIN }, body: {} });

  // ── deliver a signed message
  const wamid = 'wamid.REQPROOF.' + process.pid + '.' + pass;
  const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: {
    metadata: { display_phone_number: LINE, phone_number_id: '000' },
    contacts: [{ wa_id: CUST.replace(/^\+/, ''), profile: { name: 'Ramesh Traders' } }],
    messages: [{ from: CUST.replace(/^\+/, ''), id: wamid, type: 'text',
      text: { body: 'Please send 4 bags of cement and 12 kg nails to the Ramnagar site by Friday' } }],
  } }] }] });
  const sig = 'sha256=' + crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  const hook = await j('/api/capture/webhook/whatsapp', { method: 'POST', body: payload, headers: { 'X-Hub-Signature-256': sig } });
  ok(hook.status === 200 && hook.b && hook.b.captured >= 1, 'the signed message was captured', JSON.stringify(hook.b));

  const pend = await j('/api/capture/pending', { token: tok });
  const cap = (pend.b.captures || []).find((c) => c.raw_text && c.raw_text.includes('Ramnagar'));
  ok(!!cap, 'it is on the intake queue');
  if (!cap) { console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n'); process.exitCode = 1; return; }

  // ── raising REFUSES before the message has been read: a request with no lines is not a request.
  const early = await j('/api/capture/' + cap.id + '/raise', { method: 'POST', token: tok, body: {} });
  ok(early.status === 409, '★ it refuses to raise a message nothing has read yet (409)', 'got ' + early.status);

  const st = await j('/api/capture/' + cap.id + '/structure', { method: 'POST', token: tok, body: {} });
  ok(st.status === 200 && st.b.structured && (st.b.structured.line_items || []).length >= 1, 'the co-assist read it into lines');

  // ── RAISE. It must create NOTHING — it returns what to send.
  const raise = await j('/api/capture/' + cap.id + '/raise', { method: 'POST', token: tok, body: {} });
  ok(raise.status === 200, 'raise returned a payload', JSON.stringify(raise.b).slice(0, 200));
  const pay = raise.b || {};
  ok(pay.purpose === 'inquiry', '★★ it is an INQUIRY, not an order — a stranger\'s message mints no obligation', 'purpose=' + pay.purpose);
  ok(pay.self_copy === 'received', '★★ Task only — no Order copy, because the entity did not raise this', 'self_copy=' + pay.self_copy);
  ok(Array.isArray(pay.recipients) && pay.recipients.length === 1 && pay.recipients[0].self === true,
    '★ the only party is the entity itself', JSON.stringify(pay.recipients));
  const via = (pay.business_json || {}).via || {};
  ok(via.channel === 'whatsapp' && via.from && via.from.includes('9000000444'), '★ the provenance names who asked', JSON.stringify(via));
  ok(via.to === LINE, '★★ it names WHICH of your lines they wrote to', 'to=' + via.to);
  ok(via.provider_msg_id === wamid, '★ it carries the provider\'s own message id', 'got ' + via.provider_msg_id);
  ok(via.sender_verified === false, '★★ the sender is recorded as NOT verified');
  // ⚠️ The client did not supply any of that — it was stamped from the stored capture row.
  ok(via.capture_id === cap.id, '★ the provenance was stamped from the capture row, not composed by the caller');
  ok(via.from_name === 'Ramesh Traders', '★ the sender\'s CONTACT NAME came through from the message', 'from_name=' + via.from_name);
  ok((via.raw_excerpt || '').includes('Ramnagar'), '★★ what they ACTUALLY wrote is on the chit, beside the AI\'s reading');
  // ⚠️ THE EVIDENCE ITSELF. A reading you can check against the original is a different kind of record from one
  //    you have to trust. It must be a real file the caller can attach, holding the untouched words.
  ok(pay.original && typeof pay.original.text === 'string' && pay.original.text.includes('Ramnagar'),
    '★★ the ORIGINAL message is returned to be attached as evidence');
  ok(pay.original && /Sender verified: NO/.test(pay.original.text),
    '★ the attached original says on its face that the sender is not checked');

  const beforeCount = (await j('/api/capture/pending', { token: tok })).b.captures.length;

  // ── SEND it through the ONE send path, exactly as the app does.
  const sent = await j('/api/chits/send', { method: 'POST', token: tok, body: {
    recipients: pay.recipients, subject: pay.subject, line_items: pay.line_items,
    purpose: pay.purpose, business_json: pay.business_json, self_copy: pay.self_copy } });
  ok(sent.status === 200 || sent.status === 201, 'the request was sent through /api/chits/send', JSON.stringify(sent.b).slice(0, 200));
  const chitId = sent.b && sent.b.chit_id;
  if (!chitId) { console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n'); process.exitCode = 1; return; }
  await j('/api/capture/' + cap.id + '/convert', { method: 'POST', token: tok, body: { chit_id: chitId } });

  // ── READ IT BACK. Everything above is what we sent; this is what the rail actually kept.
  const got = await j('/api/chits/' + chitId, { token: tok });
  const h = (got.b && got.b.header) || {};
  const sum = h.summary_json || {};
  ok(got.status === 200, 'the chit reads back');
  ok(h.purpose === 'inquiry', '★★ it is STILL an inquiry after a round trip', 'purpose=' + h.purpose);
  ok(sum.via && sum.via.channel === 'whatsapp', '★★ the WhatsApp reference survived onto summary_json', JSON.stringify(sum.via));
  ok(sum.via && sum.via.to === LINE && sum.via.provider_msg_id === wamid, '★ the line and the message id survived');
  ok(sum.via && sum.via.sender_verified === false, '★★ "not verified" survived — and as a real boolean',
    'typeof=' + typeof (sum.via || {}).sender_verified);
  ok(sum.via && (sum.via.raw_excerpt || '').includes('Ramnagar'), '★★ their own words survived onto the chit');
  // ⚠️ THE WHITELIST HOLDS. summary_json is ours; a caller must not be able to write arbitrary keys into a chit's
  //    own summary, and "verified" must never arrive as a truthy string.
  const forged = await j('/api/chits/send', { method: 'POST', token: tok, body: {
    recipients: [{ self: true, role: 'to' }], subject: 'forgery attempt', line_items: [{ particulars: 'x', quantity: 1, price: 1, total: 1 }],
    business_json: { via: { channel: 'whatsapp', sender_verified: 'yes', evil: 'dropped', from: 'x' } } } });
  const fsum = forged.b && forged.b.chit_id ? ((await j('/api/chits/' + forged.b.chit_id, { token: tok })).b.header || {}).summary_json || {} : {};
  ok(fsum.via && fsum.via.sender_verified === false, '★★ a truthy STRING cannot claim the sender is verified',
    JSON.stringify(fsum.via));
  ok(fsum.via && fsum.via.evil === undefined, '★★ unknown keys are dropped, not carried into our summary',
    JSON.stringify(fsum.via));
  ok(sum.copy_policy && sum.copy_policy.suppressed && sum.copy_policy.suppressed.indexOf('sent') >= 0,
    '★★ the Order copy is suppressed', JSON.stringify(sum.copy_policy));
  ok(sum.copy_policy && sum.copy_policy.source === 'request',
    '★★ the suppression is DECLARED as this send\'s choice, not the account setting', JSON.stringify(sum.copy_policy));

  /**
   * ── THE PART THAT MATTERS ON SCREEN: a Task, and NOT an Order.
   *
   * ⚠️ THE ENDPOINTS ARE /inbox AND /sent, NOT `?folder=`. The first version of this proof asked for
   * `/api/chits?folder=order`, which 404s — so "it is NOT in the Order list" passed on an error page and proved
   * precisely nothing. A green tick from a request that never reached a list is worse than no tick, and it is why
   * both calls are asserted to be 200 BEFORE their contents are read.
   */
  const rows = (r) => (r.b && (r.b.chits || r.b.rows || r.b.data)) || [];
  const tasks = await j('/api/chits/inbox?limit=50', { token: tok });
  const orders = await j('/api/chits/sent?limit=50', { token: tok });
  ok(tasks.status === 200 && orders.status === 200, 'both lists actually answered (a 404 would fake the next two)',
    'inbox=' + tasks.status + ' sent=' + orders.status);
  ok(rows(tasks).some((c) => c.chit_id === chitId), '★★★ it is in the TASK list — the request is in their inbox',
    'inbox holds ' + rows(tasks).length + ' chits');
  ok(!rows(orders).some((c) => c.chit_id === chitId), '★★★ it is NOT in the Order list — the record never claims they raised it themselves',
    'sent holds ' + rows(orders).length + ' chits');

  // ── the customer is NOT a party. This is the gate that must keep holding.
  const parties = (h.all_recipients || []).map((r) => String(r.display_name || ''));
  ok(!parties.some((p) => p.includes('9000000444')), '★★ the phone number is NOT a party on the chit', JSON.stringify(parties));

  // ── raise twice? The capture is converted, so the second press has nothing to raise.
  const again = await j('/api/capture/' + cap.id + '/raise', { method: 'POST', token: tok, body: {} });
  ok(again.status === 409, '★★ the same message cannot be raised twice (409)', 'got ' + again.status);
  const afterCount = (await j('/api/capture/pending', { token: tok })).b.captures.length;
  ok(afterCount === beforeCount - 1, '★ it left the intake queue exactly once', beforeCount + ' → ' + afterCount);

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  console.log('  \x1b[33m⚠️\x1b[0m  transport is stood in for — that Meta carried it needs a WhatsApp Business account.\n');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('\nprove-request-from-message crashed:', e && e.message, '\n'); process.exitCode = 1; });
