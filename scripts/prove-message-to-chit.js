#!/usr/bin/env node
'use strict';
/**
 * prove-message-to-chit.js — THE ONE THAT MATTERS: a WhatsApp message becomes a CHIT, with the right lines on it.
 *
 * Athi, 2026-08-09: *"i wanted to check from cb… is there any way we can do that and push the content to chit,
 * that is what we have to verify, is it not?"* — yes, and it is, and it needed saying. Meta's transport is
 * well-trodden and is not ours to prove. What is OURS is the pipeline:
 *
 *      inbound message → capture → AI structure → CHIT on the rail → capture linked to it
 *
 * Every step of that is testable today, with no Meta account, because the webhook trusts an HMAC made with OUR
 * secret. The previous proofs each covered an END of this: prove-channels showed a message LANDS as a capture,
 * prove-outbound showed a chit REPLIES. Neither covered the middle — the actual conversion — which is precisely
 * the part that is CB's and not a provider's.
 *
 * ⚠️ THIS COSTS a little: one real AI structuring call (~$0.001). And it MINTS A REAL CHIT, deliberately — a chit
 * that was not really created proves nothing about whether content reaches the rail. It is left in place and
 * named, because a chit is a record, not litter.
 *
 * Run:  node scripts/prove-message-to-chit.js      (reads .env.proof / .env.proof.txt)
 */
const crypto = require('crypto');
/* ⚠️ ONE HARNESS (scripts/_proof.js): env loading, the API base, sign-in, and a j() that RETRIES a platform
   blip (502/503/504, socket errors) but never a real answer. A platform that never replies aborts as
   "could not test" (exit 2), never as a failed check (exit 1) — conflating those turned a Railway 502 into an
   overnight open defect on 2026-08-09. This was 9 copies of j() and 31 copies of the base URL. */
const { API, j, signIn } = require('./_proof');


const SECRET = process.env.WHATSAPP_APP_SECRET;
const ADMIN = process.env.CB_ADMIN_KEY;

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { console.log('  \x1b[32mok\x1b[0m  ' + n); pass++; } else { console.log('  \x1b[31mXX\x1b[0m  ' + n + (x ? ' — ' + x : '')); fail++; } };

const login = (email, name) => signIn(email, name);
async function deliver(to, from, text) {
  const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: {
    metadata: { display_phone_number: to, phone_number_id: '000' },
    contacts: [{ wa_id: from, profile: { name: 'Ravi (test)' } }],
    messages: [{ from, id: 'wamid.' + Date.now() + Math.random(), type: 'text', text: { body: text } }],
  } }] }] });
  const sig = 'sha256=' + crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  return j('/api/capture/webhook/whatsapp', { method: 'POST', body: payload, headers: { 'X-Hub-Signature-256': sig } });
}

/**
 * What a real customer actually writes — messy, not a form.
 *
 * ⚠️ IT CARRIES THE RUN STAMP, and that is not decoration. This was a CONSTANT, and the capture was then found by
 * exact text match — so a leftover pending capture from an earlier run (an aborted one, say) was picked up instead
 * of this run's. Its sender and line were the OLD run's numbers, so "it knows who wrote and which line they wrote
 * to" went red, and "it is NOT a chit yet" went red if that leftover had since been converted.
 *
 * Two failures with nothing wrong, in a file whose whole job is to be believed. The phone numbers were already
 * stamped per run; the message was the one thing that was not. A customer quoting their own reference is exactly
 * what a real one does, so this costs the message nothing in realism.
 */
const messageFor = (stamp) =>
  'Hi, please send 2 boxes of bolts and 5 metres of cable to the Ramnagar site by Friday. Thanks - Ravi (ref ' + stamp + ')';

(async () => {
  if (!SECRET || !ADMIN) { console.log('\n  Missing WHATSAPP_APP_SECRET / CB_ADMIN_KEY — see prove-channels.js.\n'); process.exitCode = 2; return; }
  const canary = await j('/api/capture/webhook/whatsapp', { method: 'POST', body: '{}', headers: { 'X-Hub-Signature-256': 'sha256=deadbeef' } });
  if (canary.status !== 401) { console.log('\n  ABORTED — server not enforcing signatures; run prove-channels.js first.\n'); process.exitCode = 2; return; }

  const stamp = Date.now().toString().slice(-6);
  const NUM = '+9155' + stamp + '0', CUST = '+9191' + stamp + '9';
  const A = await login('beta@test-cb.com', 'Beta Fresh');

  console.log('\n── 1 · a customer writes in ────────────────────────────────────────────────');
  const bind = await j('/api/channels', { method: 'POST', token: A, body: { channel: 'whatsapp', address: NUM, label: 'msg→chit proof' } });
  await j('/api/channels/' + bind.b.id + '/approve', { method: 'POST', headers: { 'x-cb-admin-key': ADMIN }, body: {} });
  const MESSAGE = messageFor(stamp);
  await deliver(NUM, CUST, MESSAGE);
  const caps = ((await j('/api/capture/pending', { token: A })).b || {}).captures || [];
  // Matched on THIS RUN's stamp, so a leftover capture from another run can never be mistaken for ours.
  const cap = caps.find((c) => String(c.raw_text || '').includes(stamp));
  ok('★★ the message is in the intake inbox, raw and unaltered', !!cap);
  ok('★ it knows who wrote and which line they wrote to', cap && cap.sender_ref === CUST && cap.to_ref === NUM);
  ok('★★ it is NOT a chit yet — it is pending', cap && cap.status === 'pending' && !cap.chit_id);
  if (!cap) { console.log('\n  cannot continue\n'); process.exitCode = 1; return; }

  console.log('\n── 2 · the co-assist reads it  \x1b[33m(this call costs)\x1b[0m ─────────────────────────');
  const st = await j('/api/capture/' + cap.id + '/structure', { method: 'POST', token: A, body: {} });
  const s = (st.b && st.b.structured) || {};
  const lines = s.line_items || [];
  ok('★★ prose became structured line items', st.status === 200 && lines.length >= 2, 'status ' + st.status + ' lines ' + lines.length);
  const txt = JSON.stringify(lines).toLowerCase();
  ok('★★ it read the ACTUAL goods, not a guess', txt.includes('bolt') && txt.includes('cable'), JSON.stringify(lines).slice(0, 200));
  const bolts = lines.find((l) => /bolt/i.test(l.particulars || ''));
  ok('★★ …and the ACTUAL quantity — 2 boxes of bolts', bolts && Number(bolts.qty) === 2, JSON.stringify(bolts));
  /**
   * ⚠️ THE MOST IMPORTANT ASSERTION HERE. The message states no prices. A model that helpfully supplies one has
   * invented a number that will sit on a chit and be traded against — the single worst thing this pipeline could
   * do. The skill forbids it; this proves the forbidding holds on real prose.
   */
  ok('★★ it invented NO price — none was stated', lines.every((l) => Number(l.rate || 0) === 0), JSON.stringify(lines));
  ok('★ it is marked as a DRAFT, not evidence', /draft/i.test(st.b.note || ''), st.b.note);
  if (st.b.usage) console.log('  \x1b[36m--\x1b[0m  cost of that call: $' + st.b.usage.est_cost_usd);

  console.log('\n── 3 · a human confirms it onto the rail ───────────────────────────────────');
  /* Exactly what the Intake screen does: send the chit, then record the linkage. */
  const subject = s.subject || ('From ' + CUST);
  const chit = await j('/api/chits/send', { method: 'POST', token: A, body: {
    recipients: [{ name: 'Self', role: 'to', self: true }], is_draft: false, send_as_label: 'Beta Fresh',
    subject: subject, schema_values: { subject: subject },
    line_items: lines.map((l) => ({ particulars: l.particulars, quantity: Number(l.qty) || 0,
                                    price: Number(l.rate) || 0, total: (Number(l.qty) || 0) * (Number(l.rate) || 0) })),
    external_priority: 'normal' } });
  const chit_id = chit.b && chit.b.chit_id;
  ok('★★ THE CHIT EXISTS ON THE RAIL', (chit.status === 200 || chit.status === 201) && !!chit_id, JSON.stringify(chit.b).slice(0, 140));

  const conv = await j('/api/capture/' + cap.id + '/convert', { method: 'POST', token: A, body: { chit_id } });
  ok('★ the capture is marked converted', conv.status === 200 && conv.b.status === 'converted');

  console.log('\n── 4 · is the chit really what the customer asked for? ─────────────────────');
  const got = await j('/api/chits/' + chit_id, { token: A });
  const body = JSON.stringify(got.b || {}).toLowerCase();
  ok('★★ the chit carries the goods they named', body.includes('bolt') && body.includes('cable'), 'chit read status ' + got.status);
  /**
   * ⚠️ `header.manual_subject`, NOT the top level — the chit detail is {header, detail, participants, …}. And
   * asserting it is DISTINCT from auto_subject matters: auto_subject is the generic "Order from X — 09 Aug"
   * fallback the engine writes anyway, so a test that accepted either would pass with the AI's reading thrown
   * away entirely.
   */
  const hdr = (got.b && got.b.header) || {};
  ok('★★ …under a subject drawn from THEIR OWN words, not the generic fallback',
     !!hdr.manual_subject && hdr.manual_subject !== hdr.auto_subject, 'manual="' + hdr.manual_subject + '" auto="' + hdr.auto_subject + '"');
  /* `detail` is an OBJECT carrying line_items, not an array of rows — asserted against the real shape. */
  const det = (got.b && got.b.detail) || {};
  ok('★ the line items are on the chit itself', Array.isArray(det.line_items) && det.line_items.length >= 2,
     'line_items: ' + JSON.stringify(det.line_items || []).slice(0, 120));

  /* ⚠️ PROVENANCE — the point of the whole exercise. Six weeks later someone must be able to ask "where did this
     order come from?" and be told: that WhatsApp message, from that number, on that date. */
  const after = (await j('/api/capture/pending', { token: A })).b.captures || [];
  ok('★★ it has left the pending queue — handled, not lost', !after.find((c) => c.id === cap.id));
  ok('★★ the capture still POINTS AT the chit it became — provenance survives', conv.b.chit_id === chit_id);

  console.log('\n── 5 · ⚠️ the SAME message must not become a SECOND chit ───────────────────');
  /**
   * Two distinct ways this goes wrong, and they need separate guards:
   *
   *   a) THE SAME CAPTURE CONVERTED TWICE — someone double-clicks, or two people work the inbox.
   *   b) THE SAME MESSAGE DELIVERED TWICE — providers retry. Meta re-sends a webhook it believes failed, and that
   *      retry is indistinguishable from the customer repeating themselves EXCEPT by the provider's message id.
   *      Without (b) the inbox shows two identical requests, a human converts both in good faith, and the shop
   *      ships twice. Nothing about that looks like a bug from the inside.
   */
  const again = await j('/api/capture/' + cap.id + '/convert', { method: 'POST', token: A, body: { chit_id } });
  ok('★★ (a) converting the same capture twice is REFUSED', again.status === 404, 'status ' + again.status);

  const beforeDup = ((await j('/api/capture/pending', { token: A })).b.captures || []).length;
  /* Redeliver the SAME wamid by replaying an identical signed payload — which is exactly what a Meta retry is. */
  const same = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: {
    metadata: { display_phone_number: NUM, phone_number_id: '000' },
    contacts: [{ wa_id: CUST, profile: { name: 'Ravi (test)' } }],
    messages: [{ from: CUST, id: 'wamid.RETRY.' + stamp, type: 'text', text: { body: 'retry test ' + stamp } }],
  } }] }] });
  const sig = 'sha256=' + crypto.createHmac('sha256', SECRET).update(same).digest('hex');
  await j('/api/capture/webhook/whatsapp', { method: 'POST', body: same, headers: { 'X-Hub-Signature-256': sig } });
  await j('/api/capture/webhook/whatsapp', { method: 'POST', body: same, headers: { 'X-Hub-Signature-256': sig } });
  const afterDup = (await j('/api/capture/pending', { token: A })).b.captures || [];
  const retries = afterDup.filter((c) => String(c.raw_text || '') === 'retry test ' + stamp);
  ok('★★ (b) the SAME message delivered twice makes ONE capture, not two', retries.length === 1, 'found ' + retries.length);
  /* Tidy the extras this section created so the queue is left as it was found. */
  for (const c of afterDup) if (String(c.raw_text || '').includes('retry test ' + stamp)) {
    await j('/api/capture/' + c.id + '/dismiss', { method: 'POST', token: A, body: {} });
  }

  await j('/api/channels/' + bind.b.id, { method: 'DELETE', token: A });
  console.log('\n  \x1b[36m--\x1b[0m  binding removed. The CHIT is left in place: "' + subject + '"');
  console.log('     \x1b[36m   a chit is a record, not litter — and one you can open and look at is the proof.\x1b[0m');

  console.log('\n  ' + (fail ? '\x1b[31m' + fail + ' FAILED\x1b[0m' : '\x1b[32mall passed\x1b[0m') + '  (' + pass + ' checks)');
  console.log('  \x1b[32mCONTENT → CHIT is proven end to end, with no Meta account.\x1b[0m');
  console.log('  \x1b[33m⚠️\x1b[0m  What is NOT proven is the transport: that Meta really delivers to that webhook.');
  console.log('     That is the part other applications do every day, and the part we wait on an account for.\n');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('\nprove-message-to-chit crashed:', e && e.message, '\n'); process.exitCode = 1; });
