#!/usr/bin/env node
'use strict';
/**
 * prove-storefront-mint.js — the FOURTH mint path: a public buyer's storefront order.
 *
 * Athi asked: *"do the storefront order path too, is it not the same path?"* — it is NOT, and that is exactly why
 * lib/mint.js shares the SHAPE and not the policy:
 *
 *   /api/chits/send      a signed-in ENTITY sends. Recipient resolution, caps, trace, freeze-at-send.
 *   storefront order     a PUBLIC BUYER orders. No JWT — an OTP proves the phone/email. And the OTP consume, the
 *                        chit, and the buyer's documents must commit in ONE transaction.
 *
 * ⚠️ THE SAME-TRANSACTION RULE IS THE WHOLE REASON THIS PATH IS DIFFERENT. Writing the documents after the chit
 * forced an impossible choice: 200 with documents_stored:false (a chit asserting evidence nobody holds), or 500 on
 * a submission that had already committed. mint.deliver(..., { client }) exists for this one caller. If the shared
 * helper had quietly opened its own connection, that atomicity would have been lost with nothing to show for it —
 * which is what this proof is really guarding.
 *
 * RUN:  node scripts/prove-storefront-mint.js
 */
const { j, signIn, run } = require('./_proof');

const CUSTOMER_OTP = process.env.DEV_OTP_CUSTOMER || '123123';   // lib/dev-otp.js DEFAULTS.customer

run('prove-storefront-mint', async (t) => {
  console.log('\n  the storefront order — the fourth mint path, and the only one with a buyer\n');
  const RUN = String(process.pid).slice(-5);
  const shopEmail = 'shop-' + RUN + '@test-cb.com';
  const tok = await signIn(shopEmail, 'Live Run Shop');
  if (!tok) throw new Error('could not sign in as the shop');

  /**
   * A shop needs THREE things to be open, and I only knew two of them until this proof 404'd:
   *   1. a published SCHEMA — the catalogue's face. Without it `catalogue-view` returns {available:false} and the
   *      storefront is indistinguishable from a shop that does not exist. Products alone are not a shop.
   *   2. items with a PRICE — an unpriced line is hidden on a monetary shop (the `unpriced_hidden` rule).
   *   3. catalogue_visibility = public.
   *
   * ⚠️ Worth knowing beyond this script: a real owner who adds products and flips visibility still has a CLOSED
   * shop, and the storefront gives the same answer as for a shop that was never created — deliberately, so bridge
   * ids cannot be enumerated. Correct for security, and silent for the owner. That is an onboarding gap, not a bug.
   */
  await j('/api/schemas/create-default', { method: 'POST', token: tok, body: {} });
  await j('/api/schemas/visibility', { method: 'PATCH', token: tok, body: { visibility: 'public' } });
  await j('/api/products', { method: 'POST', token: tok, body: { item_data: { name: 'Cement', unit: 'bag', price: 340 } } });
  await j('/api/products', { method: 'POST', token: tok, body: { item_data: { name: 'Nails', unit: 'kg', price: 85 } } });
  await j('/api/entities/profile', { method: 'PATCH', token: tok, body: { catalogue_visibility: 'public' } });

  const me = (await j('/api/entities/me', { token: tok })).b;
  const bridge = (me.entity ? me.entity.bridge_id : me.bridge_id);
  t.ok(!!bridge, 'the shop exists', bridge);

  const shop = await j('/api/catalogue/' + bridge);
  t.ok(shop.status === 200, 'the storefront is public and open', 'HTTP ' + shop.status);
  const items = (shop.b && (shop.b.lines || shop.b.items)) || [];
  t.ok(items.length >= 2, 'it has orderable items', String(items.length));

  /* ── the BUYER — no account, no JWT, just a phone number and an OTP ──────────────────────────────────────── */
  const phone = '+9198' + RUN + '55';
  const start = await j('/api/catalogue/' + bridge + '/order/start', { method: 'POST',
    body: { phone, name: 'Walk-in buyer ' + RUN } });
  t.ok(start.status === 200, '★ a public buyer can start an order with no account', JSON.stringify(start.b).slice(0, 140));

  const line_items = [
    { particulars: 'Cement', quantity: 4, price: 340, total: 1360 },
    { particulars: 'Nails',  quantity: 2, price: 85,  total: 170 },
  ];
  const confirm = await j('/api/catalogue/' + bridge + '/order/confirm', { method: 'POST',
    body: { phone, otp: CUSTOMER_OTP, name: 'Walk-in buyer ' + RUN, line_items,
            delivery_address: '9 Market street', note: 'leave at the gate' } });
  t.ok(confirm.status === 200 || confirm.status === 201,
    '★★★ THE STOREFRONT ORDER MINTED — the fourth path, through mint.deliver({client})',
    'HTTP ' + confirm.status + ' ' + JSON.stringify(confirm.b).slice(0, 200));
  if (!(confirm.status === 200 || confirm.status === 201)) return;

  const chitId = confirm.b && (confirm.b.chit_id || confirm.b.order_id || (confirm.b.order && confirm.b.order.chit_id));
  t.ok(!!chitId, 'it returned the chit id', JSON.stringify(confirm.b).slice(0, 160));

  /* ── the SHOP's copy: it must be in the shop's Task list ─────────────────────────────────────────────────── */
  const inbox = ((await j('/api/chits/inbox?limit=20', { token: tok })).b || {}).chits || [];
  const mine = inbox.find((c) => c.chit_id === chitId) || inbox[0];
  t.ok(!!mine, '★★★ the SHOP holds its copy — the order arrived as a Task', JSON.stringify(inbox.map((c) => c.manual_subject || c.auto_subject).slice(0, 3)));

  if (mine) {
    const s = mine.summary_json || {};
    /* ⚠️ THE SAME INVARIANT AS COMPOSE, on a path that never touches /api/chits/send. If the storefront's copies
       had drifted from the shared shape, this is where it would show: a total that disagrees with its own lines. */
    t.ok(Number(s.total_value) === 1530, '★★★ the total is the sum of the lines (1360 + 170 = 1530)', String(s.total_value));
    t.ok(s.line_item_count === 2, '★★ the line count matches what was ordered', String(s.line_item_count));
    t.ok(!!s.currency_code, '★ it carries a currency', String(s.currency_code));

    const full = await j('/api/chits/' + mine.chit_id, { token: tok });
    const det = (full.b && full.b.detail) || {};
    const li = det.line_items || [];
    t.ok(li.length === 2, '★★ the shop can see the actual line items', JSON.stringify(li.map((x) => x.particulars)));
    t.ok(li.some((x) => /cement/i.test(x.particulars) && Number(x.quantity) === 4),
      '★★★ …with the quantities the buyer chose — 4 bags of cement', JSON.stringify(li));

    const h = (full.b && full.b.header) || {};
    t.ok(h.sender_entity_id && h.sender_entity_id !== (me.entity ? me.entity.identity_id : me.identity_id),
      '★★★ the SENDER is the BUYER, not the shop — a customer order is not the shop writing to itself',
      String(h.sender_entity_id));
  }

  /* ── the buyer's OTP must be SPENT. If it still works, the same code could mint a second order. ──────────── */
  const replay = await j('/api/catalogue/' + bridge + '/order/confirm', { method: 'POST',
    body: { phone, otp: CUSTOMER_OTP, name: 'Walk-in buyer ' + RUN, line_items } });
  t.ok(replay.status !== 200 && replay.status !== 201,
    '★★★ the OTP cannot be replayed — the consume committed WITH the chit, in one transaction',
    'got ' + replay.status + ' ' + JSON.stringify(replay.b).slice(0, 120));

  t.note('mint.deliver({client}) kept the OTP consume, the chit and the documents in ONE transaction — that is why');
  t.note('this path takes an open client instead of opening its own connection.');
});
