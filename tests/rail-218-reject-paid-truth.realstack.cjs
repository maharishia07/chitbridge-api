'use strict';
/**
 * tests/rail-218-reject-paid-truth.realstack.cjs — RAIL-218 on a REAL Postgres, the api running as cb_app (RLS on): a buyer cannot REJECT an invoice it has marked paid.
 *
 * OWNS     the proof that PUT /api/chits/:chit_id/status {status: rejected} on the BUYER's copy answers 409 CHIT_CONFLICT why "paid" once the copy carries the payment mark, writes nothing
 *          (status unchanged), while an unpaid invoice still rejects (200) — through the one status writer (lib/rail-status paidRefusal), not a route check
 * FLOW     fresh AU shops S and R → S sends R an invoice → R's copy is marked paid (the stamp POST /payment writes: business_json.payment on R's own copy, set as owner so the books are not part of the proof) → R rejects
 * CARD     01-rail-core-the-chit/status-the-one-status-writer
 *
 *   P-1  paid copy: reject → 409 CHIT_CONFLICT, why "paid", a sentence naming the credit note; R's copy stays pending
 *   P-3  the real doors: R presses Mark paid (POST /payment), then Mark unpaid (DELETE /payment clears only the stamp, the books keep the payment, drift D1), then rejects → still 409 why paid
 *   P-2  control: an unpaid invoice rejects → 200 and R's copy reads rejected
 * CI: picked up by the T2 loop over tests/*-truth.realstack.cjs.
 */
const H = require('./lib/truth-harness.cjs');
const { Client } = require('pg');
const { j, kase, expect, freshShop, finish, DB } = H;
const RUN = 'r218' + (Date.now() % 1e9).toString(36);
const asOwner = async (sql, args) => { const c = new Client({ connectionString: DB }); await c.connect(); try { return (await c.query(sql, args)).rows; } finally { await c.end(); } };
const statusOf = async (shop, chit) => (await asOwner(`SELECT current_status AS s FROM chit_status WHERE entity_id = $1 AND chit_id = $2 AND direction = 'received'`, [shop.entity, chit]))[0].s;
let S, R, seq = 0;
async function invoice(tag) {
  const no = tag + RUN + ++seq;
  const sent = await j('/api/chits/send', { method: 'POST', token: S.token, body: { recipients: [{ bridge_id: R.bridge, display_name: R.name, kind: 'to' }], purpose: 'invoice', subject: no, manual_subject: no, client_ref: no, business_json: { invoice_no: no }, line_items: [{ particulars: 'Rice sack', quantity: 10, unit: 'kg', price: 100, total: 1000 }] } });
  expect(sent.status === 200, 'the invoice did not send: HTTP ' + sent.status + ' ' + JSON.stringify(sent.b).slice(0, 200));
  return sent.b.chit_id || (sent.b.chit && sent.b.chit.chit_id);
}
const reject = (chit) => j('/api/chits/' + chit + '/status', { method: 'PUT', token: R.token, body: { status: 'rejected', note: 'RAIL-218 test' } });

(async () => {
  console.log('\n── RAIL-218 reject after paying on ' + H.API + ' · run ' + RUN + ' ──');
  const au = { country: 'AU', currency: 'AUD', fy_start_month: 7, timezone: 'Australia/Sydney', tax: { registered: false } };
  S = await freshShop(RUN + 's', 'Seller', au);
  R = await freshShop(RUN + 'r', 'Buyer', au);

  await kase('P-1', 'a copy marked paid cannot be rejected: 409 why paid, status unchanged', async () => {
    const chit = await invoice('p');
    const before = await statusOf(R, chit);
    await asOwner(`UPDATE chit_header SET business_json = COALESCE(business_json, '{}'::jsonb) || '{"payment":{"method":"cash","amount":1000}}'::jsonb WHERE chit_id = $1 AND entity_id = $2`, [chit, R.entity]);
    const r = await reject(chit);
    expect(r.status === 409 && r.b.code === 'CHIT_CONFLICT' && r.b.why === 'paid', 'expected 409 CHIT_CONFLICT paid, got HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 300));
    expect(/credit note/.test(String(r.b.message || r.b.detail)), 'the sentence names no credit note: ' + JSON.stringify(r.b).slice(0, 300));
    expect(await statusOf(R, chit) === before, 'the copy moved: ' + await statusOf(R, chit));
  });

  await kase('P-3', 'Mark paid, Mark unpaid, reject: the books still hold the payment, so 409 why paid', async () => {
    H.ok(await j('/api/books/enable', { method: 'POST', token: R.token }), 'books on (buyer)');
    H.ok(await j('/api/relationships/suppliers', { method: 'POST', token: R.token, body: { supplier_bridge_id: S.bridge, supply_kind: 'resale' } }), 'S on the buyer supplier list');
    const chit = await invoice('m');
    H.ok(await j('/api/chits/' + chit + '/status', { method: 'PUT', token: R.token, body: { status: 'accepted' } }), 'accept');
    const pay = await j('/api/chits/' + chit + '/payment', { method: 'POST', token: R.token, body: { method: 'cash', amount: 1000 } });
    expect(pay.status === 200, 'Mark paid: HTTP ' + pay.status + ' ' + JSON.stringify(pay.b).slice(0, 300));
    const booked = (await asOwner(`SELECT count(*)::int AS n FROM books_payment WHERE entity_id = $1 AND client_ref LIKE $2`, [R.entity, 'chitpay:' + chit + '%']))[0].n;
    expect(booked >= 1, 'the buyer books hold no payment for the press (books ' + JSON.stringify(pay.b.books).slice(0, 200) + '): the case cannot arm');
    const unpay = await j('/api/chits/' + chit + '/payment', { method: 'DELETE', token: R.token });
    expect(unpay.status === 200, 'Mark unpaid: HTTP ' + unpay.status);
    expect((await asOwner(`SELECT business_json->'payment' AS p FROM chit_header WHERE chit_id = $1 AND entity_id = $2`, [chit, R.entity]))[0].p === null, 'the stamp was not cleared');
    const r = await reject(chit);
    expect(r.status === 409 && r.b.why === 'paid', 'expected 409 paid, got HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 300));
    expect(await statusOf(R, chit) !== 'rejected', 'the copy moved to rejected');
  });

  await kase('P-2', 'control: an unpaid invoice rejects', async () => {
    const chit = await invoice('u');
    const r = await reject(chit);
    expect(r.status === 200, 'HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 300));
    expect(await statusOf(R, chit) === 'rejected', 'status ' + await statusOf(R, chit));
  });

  finish('rail-218-reject-paid');
})().catch((e) => { console.error(e); process.exit(1); });
