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
/* ⚠️ ONE HARNESS (scripts/_proof.js): env loading, the API base, sign-in, and a j() that RETRIES a platform
   blip (502/503/504, socket errors) but never a real answer. A platform that never replies aborts as
   "could not test" (exit 2), never as a failed check (exit 1) — conflating those turned a Railway 502 into an
   overnight open defect on 2026-08-09. This was 9 copies of j() and 31 copies of the base URL. */
const { API, j, signIn } = require('./_proof');


const SECRET = process.env.WHATSAPP_APP_SECRET;
const ADMIN = process.env.CB_ADMIN_KEY;
const LINE = '+919000000333';                  // the business line for this proof
const CUST = '+919000000444';                  // the customer

let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + m); } else { fail++; console.log('  \x1b[31m✗ ' + m + '\x1b[0m' + (extra ? '\n      ' + extra : '')); } };


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

  /* The catalogue this proof prices against — created BEFORE the message, so the match is real. "cement" is
     stocked at 340; "nails" deliberately is not, and must come back unpriced and be added. */
  const prods = await j('/api/products', { token: tok });
  const have = JSON.stringify((prods.b && (prods.b.items || prods.b.products || prods.b)) || {});
  if (!/cement/i.test(have)) await j('/api/products', { method: 'POST', token: tok, body: { item_data: { name: 'cement', unit: 'bags', price: 340 } } });
  /* ⚠️ CLEAR RESIDUE FROM THE BUILD THAT USED TO WRITE PRODUCTS. An earlier version of raisePayload created a row
     for anything unrecognised; those rows are still in this test entity and would make "nails was not added" fail
     for a reason that has nothing to do with today's code. Deleted here so the assertion means what it says. */
  for (const row of (((await j('/api/products', { token: tok })).b || {}).items || [])) {
    if ((row.item_data || {}).provisional) await j('/api/products/' + row.item_id, { method: 'DELETE', token: tok });
  }
  // Snapshot it — the strongest claim in this file is that raising a request leaves this list identical.
  const catBefore = (((await j('/api/products', { token: tok })).b || {}).items || []).map((x) => (x.item_data || x).name).sort();

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

  /**
   * ── PRICING. The entity stocks "cement" at 340; it does not stock nails.
   * ⚠️ The catalogue row is created BEFORE the raise, so the match is real rather than something this script set up
   *    to succeed. And "nails" must come back UNPRICED and be ADDED — not quietly priced off some near-miss row.
   */
  ok(pay.line_items.some((l) => /cement/i.test(l.particulars) && l.price === 340),
    '★★ the CATALOGUE price was attached to the line they asked for', JSON.stringify(pay.line_items));
  ok(pay.line_items.some((l) => /nail/i.test(l.particulars) && !l.price),
    '★★ an item you do not stock stays UNPRICED — never guessed from a near-miss', JSON.stringify(pay.line_items));
  const pr = ((pay.business_json || {}).via || {}).priced || {};
  ok(pr.from_catalogue >= 1, '★ it reports how many lines it priced', JSON.stringify(pr));
  /**
   * ⚠️ THE CATALOGUE MUST BE EXACTLY AS IT WAS. Athi: *"do not touch the catalogue."* An earlier version of this
   * wrote a row back for every unrecognised item, which made a stranger's message a reason to edit your shop.
   * Counted before and after, because "it didn't add anything" is only believable as a number.
   */
  const rowsOf = (r) => { const b = (r.b && (r.b.items || r.b.products || r.b)) || []; return Array.isArray(b) ? b.map((x) => x.item_data || x) : []; };
  const catAfter = rowsOf(await j('/api/products', { token: tok })).map((d) => d.name).sort();
  ok(JSON.stringify(catAfter) === JSON.stringify(catBefore),
    '★★★ the catalogue is UNTOUCHED — a request never writes a product',
    'before ' + JSON.stringify(catBefore) + '\n      after  ' + JSON.stringify(catAfter));
  ok(!catAfter.some((n) => /nail/i.test(n)), '★★ the unstocked item was NOT added — it is only on the chit');
  ok(/^WhatsApp request — /.test(pay.subject), '★★ the chit says on its subject line that it is a WhatsApp request', pay.subject);

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

  /**
   * ══════════════════════════════════════════════════════════════════════════════════════════════════════════════
   *  THE FARMER. No catalogue, no price, no product record — and the chit is still complete.
   * ══════════════════════════════════════════════════════════════════════════════════════════════════════════════
   * Athi, 2026-08-09: *"in some places they may not even have a catalogue, for example farmers sending a chit
   * regarding their milk production to the factory... the farmer may say milk 10 l, that is all... the
   * accumulation of all can help to create a capacity planning for the factory before even the milk arrives."*
   *
   * This is the case that would have been silently refused by anything that needed a catalogue to exist, and it is
   * the reason the catalogue lookup has to be enrichment rather than a step. A fresh entity is used precisely so
   * there is nothing to look up.
   */
  console.log('\n  ── the farmer: no catalogue at all ──');
  const femail = 'farm-proof@test-cb.com';
  const FLINE = '+919000000555', FARMER = '+919000000666';
  await j('/api/entities/register', { method: 'POST', body: { email: femail, display_name: 'Milk Factory' } });
  const fv = await j('/api/entities/verify', { method: 'POST', body: { email: femail, otp: process.env.DEV_OTP || '123456' } });
  const ftok = (fv.b && (fv.b.token || (fv.b.entity && fv.b.entity.token))) || null;
  const fcat = rowsOf(await j('/api/products', { token: ftok }));
  ok(fcat.length === 0, 'the factory has NO catalogue (so nothing can be looked up)', fcat.length + ' items');

  const flist = await j('/api/channels', { token: ftok });
  const fwa = (flist.b.channels || []).find((c) => c.key === 'whatsapp') || { bindings: [] };
  let fbind = (fwa.bindings || []).find((b) => b.address === FLINE);
  if (!fbind) { const made = await j('/api/channels', { method: 'POST', token: ftok, body: { channel: 'whatsapp', address: FLINE, label: 'collection line' } }); fbind = made.b; }
  if (fbind && fbind.status !== 'verified') await j('/api/channels/' + fbind.id + '/approve', { method: 'POST', headers: { 'x-cb-admin-key': ADMIN }, body: {} });

  const fwamid = 'wamid.FARM.' + process.pid;
  const fpayload = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: {
    metadata: { display_phone_number: FLINE, phone_number_id: '000' },
    contacts: [{ wa_id: FARMER.replace(/^\+/, ''), profile: { name: 'Selvam dairy farm' } }],
    messages: [{ from: FARMER.replace(/^\+/, ''), id: fwamid, type: 'text', text: { body: 'milk 10 l' } }],
  } }] }] });
  await j('/api/capture/webhook/whatsapp', { method: 'POST', body: fpayload,
    headers: { 'X-Hub-Signature-256': 'sha256=' + crypto.createHmac('sha256', SECRET).update(fpayload).digest('hex') } });
  const fpend = await j('/api/capture/pending', { token: ftok });
  const fcap = (fpend.b.captures || []).find((c) => /milk/i.test(c.raw_text || ''));
  ok(!!fcap, 'the farmer\'s message arrived');
  if (fcap) {
    await j('/api/capture/' + fcap.id + '/structure', { method: 'POST', token: ftok, body: {} });
    const fr = await j('/api/capture/' + fcap.id + '/raise', { method: 'POST', token: ftok, body: {} });
    ok(fr.status === 200, '★★★ it raises with NO catalogue — the chit is the primitive', JSON.stringify(fr.b).slice(0, 160));
    const fli = (fr.b && fr.b.line_items) || [];
    ok(fli.some((l) => /milk/i.test(l.particulars)), '★★ "milk 10 l" became a line', JSON.stringify(fli));
    ok(fli.every((l) => !l.price), '★ it carries no price, and nothing invented one', JSON.stringify(fli));
    const fsent = await j('/api/chits/send', { method: 'POST', token: ftok, body: {
      recipients: fr.b.recipients, subject: fr.b.subject, line_items: fli,
      purpose: fr.b.purpose, business_json: fr.b.business_json, self_copy: fr.b.self_copy } });
    ok(fsent.status === 200 || fsent.status === 201, '★★★ and it SENDS — the factory has its notice before the milk moves',
      JSON.stringify(fsent.b).slice(0, 160));
    ok(rowsOf(await j('/api/products', { token: ftok })).length === 0,
      '★★★ the factory STILL has no catalogue — nothing was invented for it');
  }

  /**
   * ── THE PRICE IN THE MESSAGE ITSELF ────────────────────────────────────────────────────────────────────────────
   * Athi, 2026-08-09: *"sometimes the message itself may have tomatto, 10kg at 40.00, so add those information as
   * name, qty and price and send it across."*
   *
   * With no catalogue there is nothing to price against, so the only figure in the world is the one they wrote.
   * Dropping it would throw away the only commercial fact in the message.
   */
  const twamid = 'wamid.TOMATO.' + process.pid;
  const tpayload = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: {
    metadata: { display_phone_number: FLINE, phone_number_id: '000' },
    contacts: [{ wa_id: FARMER.replace(/^\+/, ''), profile: { name: 'Selvam dairy farm' } }],
    messages: [{ from: FARMER.replace(/^\+/, ''), id: twamid, type: 'text', text: { body: 'tomato, 10 kg at 40.00' } }],
  } }] }] });
  await j('/api/capture/webhook/whatsapp', { method: 'POST', body: tpayload,
    headers: { 'X-Hub-Signature-256': 'sha256=' + crypto.createHmac('sha256', SECRET).update(tpayload).digest('hex') } });
  const tcap = ((await j('/api/capture/pending', { token: ftok })).b.captures || []).find((c) => /tomato/i.test(c.raw_text || ''));
  ok(!!tcap, 'the priced message arrived');
  if (tcap) {
    await j('/api/capture/' + tcap.id + '/structure', { method: 'POST', token: ftok, body: {} });
    const tr = await j('/api/capture/' + tcap.id + '/raise', { method: 'POST', token: ftok, body: {} });
    const tli = (tr.b && tr.b.line_items) || [];
    const tom = tli.find((l) => /tomato/i.test(l.particulars || ''));
    ok(!!tom, '★★ "tomato" came through as the name', JSON.stringify(tli));
    ok(tom && tom.quantity === 10, '★★ 10 came through as the quantity', JSON.stringify(tom));
    ok(tom && tom.price === 40, '★★★ 40.00 came through as the PRICE — the only figure in the message is kept',
      JSON.stringify(tom));
    ok(tom && tom.total === 400, '★ and the line totals to 400', JSON.stringify(tom));
  }

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  console.log('  \x1b[33m⚠️\x1b[0m  transport is stood in for — that Meta carried it needs a WhatsApp Business account.\n');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('\nprove-request-from-message crashed:', e && e.message, '\n'); process.exitCode = 1; });
