#!/usr/bin/env node
'use strict';
/**
 * prove-policy-flags.js — the policy flags are REAL (b130), and trade_side actually governs pricing.
 *
 * ⚠️ WHAT THIS IS GUARDING AGAINST. The flags used to live in localStorage: the card said "set", nothing left the
 * browser, and the server never heard. So the claims here are deliberately the boring ones — it persists, it comes
 * back after a fresh sign-in, it survives a patch of a DIFFERENT key, and it CHANGES WHAT THE PRODUCT DOES. A
 * setting that stores but governs nothing is the same failure wearing a database.
 *
 * RUN:  node scripts/prove-policy-flags.js
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
const ok = (c, m, x) => { if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + m); } else { fail++; console.log('  \x1b[31m✗ ' + m + '\x1b[0m' + (x ? '\n      ' + x : '')); } };


(async () => {
  console.log('\n  prove-policy-flags — settings that persist AND govern (b130)\n');
  const email = 'policy-proof@test-cb.com';
  let tok = await signIn(email, 'Policy Proof Co');
  if (!tok) { console.log('  could not sign in\n'); process.exitCode = 1; return; }

  const g0 = await j('/api/entities/policy', { token: tok });
  ok(g0.status === 200, 'the policy endpoint answers', JSON.stringify(g0.b).slice(0, 160));
  /* ⚠️ PRECONDITION. Pre-b130 the read still answers with defaults by design, so every "it saved" check below
     would pass against an unmigrated column. Abort rather than print a green wall. */
  if (g0.b && g0.b.flags && g0.b.flags._migrated === false) {
    console.log('\n  \x1b[31mABORT\x1b[0m — b130 is not applied on this environment. Run migrations/b130_policy_flags.sql.\n');
    process.exitCode = 2; return;
  }
  console.log('  precondition: b130 is applied — "it saved" means something\n');
  ok(g0.b.flags.trade_side === 'sell', '★ a new entity defaults to SELL', 'got ' + g0.b.flags.trade_side);

  // ── it stores, and it comes back on a FRESH sign-in (the localStorage version could never do this)
  const s1 = await j('/api/entities/policy', { method: 'PATCH', token: tok, body: { trade_side: 'receive' } });
  ok(s1.status === 200 && s1.b.flags.trade_side === 'receive', 'the write is accepted and echoed back', JSON.stringify(s1.b).slice(0, 160));
  const tok2 = await signIn(email, 'Policy Proof Co');
  const g1 = await j('/api/entities/policy', { token: tok2 });
  ok(g1.b.flags.trade_side === 'receive', '★★★ it survived a fresh sign-in — it is on the ENTITY, not the device');

  // ── a PATCH of one key must not blank the others
  await j('/api/entities/policy', { method: 'PATCH', token: tok2, body: { retention_days: 30 } });
  const g2 = await j('/api/entities/policy', { token: tok2 });
  ok(g2.b.flags.retention_days === 30 && g2.b.flags.trade_side === 'receive',
    '★★ patching one flag does not blank another', JSON.stringify(g2.b.flags));

  // ── self_copy_pref is PROXIED to its own column: the same value must be visible BOTH ways, or the two sources
  //    have already drifted — which is the whole reason it was not moved into the jsonb.
  await j('/api/entities/policy', { method: 'PATCH', token: tok2, body: { self_copy_pref: 'received' } });
  const me = await j('/api/entities/me', { token: tok2 });
  const viaMe = ((me.b && me.b.entity) || me.b || {}).self_copy_pref;
  ok(viaMe === 'received', '★★★ self_copy_pref written via /policy is visible on its own column', 'me says ' + viaMe);
  const g3 = await j('/api/entities/policy', { token: tok2 });
  ok(g3.b.flags.self_copy_pref === 'received', '★★ and reads back through /policy — one fact, one value');

  // ── the whitelist holds
  const bad1 = await j('/api/entities/policy', { method: 'PATCH', token: tok2, body: { evil_flag: 'yes' } });
  ok(bad1.status === 400, '★★ an unknown flag is REFUSED, not written into the entity', 'got ' + bad1.status);
  const bad2 = await j('/api/entities/policy', { method: 'PATCH', token: tok2, body: { trade_side: 'whatever' } });
  ok(bad2.status === 400, '★★ an invalid value is refused', 'got ' + bad2.status);
  const bad3 = await j('/api/entities/policy', { method: 'PATCH', token: tok2, body: { dispute_scope: 'shared' } });
  ok(bad3.status === 400, '★★★ the platform-BOUND flag cannot be relaxed — the USP is not a preference', 'got ' + bad3.status);
  const g4 = await j('/api/entities/policy', { token: tok2 });
  ok(g4.b.flags.evil_flag === undefined && g4.b.flags.dispute_scope === 'per-party',
    '★★ nothing refused leaked in anyway', JSON.stringify(g4.b.flags));

  /**
   * ── AND NOW THE PART THAT MATTERS: DOES IT GOVERN ANYTHING? ────────────────────────────────────────────────────
   * A setting that stores and changes nothing is the localStorage failure wearing a database. This entity stocks
   * "cement" at 340 and is set to RECEIVE, so an inbound message naming cement must come back UNPRICED.
   */
  if (!SECRET || !ADMIN) { console.log('\n  (skipping the pricing half — no WHATSAPP_APP_SECRET / CB_ADMIN_KEY)\n'); }
  else {
    const prods = await j('/api/products', { token: tok2 });
    if (!/cement/i.test(JSON.stringify(prods.b || {}))) {
      await j('/api/products', { method: 'POST', token: tok2, body: { item_data: { name: 'cement', unit: 'bags', price: 340 } } });
    }
    const LINE = '+919000000777', CUST = '+919000000888';
    const list = await j('/api/channels', { token: tok2 });
    const wa = (list.b.channels || []).find((c) => c.key === 'whatsapp') || { bindings: [] };
    let bind = (wa.bindings || []).find((b) => b.address === LINE);
    if (!bind) { const made = await j('/api/channels', { method: 'POST', token: tok2, body: { channel: 'whatsapp', address: LINE, label: 'proof' } }); bind = made.b; }
    if (bind && bind.status !== 'verified') await j('/api/channels/' + bind.id + '/approve', { method: 'POST', headers: { 'x-cb-admin-key': ADMIN }, body: {} });

    const raiseFor = async (text, tag) => {
      const wamid = 'wamid.POL.' + tag + '.' + process.pid;
      const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: {
        metadata: { display_phone_number: LINE, phone_number_id: '000' },
        contacts: [{ wa_id: CUST.replace(/^\+/, ''), profile: { name: 'Proof sender' } }],
        messages: [{ from: CUST.replace(/^\+/, ''), id: wamid, type: 'text', text: { body: text } }],
      } }] }] });
      await j('/api/capture/webhook/whatsapp', { method: 'POST', body: payload,
        headers: { 'X-Hub-Signature-256': 'sha256=' + crypto.createHmac('sha256', SECRET).update(payload).digest('hex') } });
      const cap = ((await j('/api/capture/pending', { token: tok2 })).b.captures || []).find((c) => (c.raw_text || '').includes(tag));
      if (!cap) return null;
      await j('/api/capture/' + cap.id + '/structure', { method: 'POST', token: tok2, body: {} });
      const r = await j('/api/capture/' + cap.id + '/raise', { method: 'POST', token: tok2, body: {} });
      return r.b || null;
    };

    const recv = await raiseFor('3 bags of cement please REF-RECV', 'REF-RECV');
    const rli = (recv && recv.line_items) || [];
    ok(rli.length > 0, 'the RECEIVE-side message raised', JSON.stringify(recv).slice(0, 140));
    ok(rli.every((l) => !l.price), '★★★ set to RECEIVE, cement comes back UNPRICED even though the catalogue has it at 340',
      JSON.stringify(rli));
    ok(recv && ((recv.business_json || {}).via || {}).priced.catalogue_used === false,
      '★★ and the chit records that the catalogue was not consulted', JSON.stringify(recv && (recv.business_json || {}).via && recv.business_json.via.priced));

    await j('/api/entities/policy', { method: 'PATCH', token: tok2, body: { trade_side: 'sell' } });
    const sell = await raiseFor('3 bags of cement please REF-SELL', 'REF-SELL');
    const sli = (sell && sell.line_items) || [];
    ok(sli.some((l) => /cement/i.test(l.particulars) && l.price === 340),
      '★★★ flipped to SELL, the same message prices at 340 — the flag GOVERNS, it does not just store',
      JSON.stringify(sli));
  }

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('\nprove-policy-flags crashed:', e && e.message, '\n'); process.exitCode = 1; });
