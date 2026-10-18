'use strict';
/**
 * tests/stock-truth.realstack.cjs — STOCK TRUTH, on the LOCAL stack (the case list: C:/dev/docs/13-inventory-stock-and-traceability/STOCK-TRUTH-TESTS.md).
 *
 * Athi, 2026-10-18: *"is the stock statement correct, does it show the current stock, where from it appears, if the stock moves how
 * does it handle … online, offline all works concurrent? if the reversal happens, how does it impact …"*
 *
 * Every case drives the api's own routes (the same doors as scripts/seed-local.cjs: register → verify with the dev code → products →
 * POST /api/chits/send) on a FRESH shop made for this run, then checks three things against each other:
 *   the statement  GET /api/till/stock (the one reader, stock-store.onHand — the Stock screen and the storefront read the same)
 *   the cache      stock_balance            (read-only SELECT on the local database)
 *   the log        stock_movement           (read-only SELECT — the truth; the balance must equal its sum)
 * A case whose expected result is the PRINCIPLE (not today's code) is marked `gap:` — a FAIL there is a finding, not a flake.
 *
 * ⚠️ LOCAL ONLY: refuses any api that is not on this machine and any database that is not the local container. Writes go through
 * routes only; the database is only ever SELECTed. Needs DEV_OTP armed (lib/dev-otp.js: 123456 entity · 123123 customer).
 * Run: node tests/stock-truth.realstack.cjs        (API_BASE / STOCK_DB override the defaults)
 * CARD 13-inventory-stock-and-traceability/on-hand-and-movements
 */
const API = (process.env.API_BASE || 'http://127.0.0.1:3100').replace(/\/$/, '');
const DB = process.env.STOCK_DB || 'postgres://postgres:cblocal@127.0.0.1:55432/cb_local';
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(API)) { console.error('REFUSED: local api only, not ' + API); process.exit(3); }
if (!/@(127\.0\.0\.1|localhost):55432\//.test(DB)) { console.error('REFUSED: local database only'); process.exit(3); }

const { Client } = require('pg');
const ENTITY_OTP = '123456', CUSTOMER_OTP = '123123';
const RUN = 'st' + (Date.now() % 1e10).toString(36);   /* a User ID is at most 20 characters */
const results = [];

/* ── the doors (the seed's own j()) ── */
async function j(path, { method = 'GET', token, body } = {}) {
  const r = await fetch(API + path, { method, headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}), body: body ? JSON.stringify(body) : undefined });
  let b = null; try { b = await r.json(); } catch (_) { /* no body */ }
  return { status: r.status, b: b || {} };
}
function ok(reply, what) { if (reply.status >= 300) throw new Error(what + ': HTTP ' + reply.status + ' ' + JSON.stringify(reply.b).slice(0, 240)); return reply; }
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

/* ── the log and the cache, read-only ── */
let pg = null, SHOP = null;
async function moves(item_id) {
  const r = await pg.query(`SELECT reason, qty::float AS qty, rate::float AS rate, ref, line_ref, at FROM stock_movement WHERE entity_id = $1 AND item_id = $2 ORDER BY at, movement_id`, [SHOP.entity, item_id]);
  return r.rows;
}
async function stored(item_id) {
  const r = await pg.query(`SELECT COALESCE(sum(qty),0)::float AS qty, COALESCE(sum(value),0)::float AS value, COALESCE(sum(moves),0)::int AS moves FROM stock_balance WHERE entity_id = $1 AND item_id = $2`, [SHOP.entity, item_id]);
  return r.rows[0];
}
async function statement() { return ok(await j('/api/till/stock?detail=1', { token: SHOP.token }), 'stock read').b; }
async function onHand(item_id) { const b = (await statement()).balances[item_id]; return b ? b.qty : null; }
/** stock moves AFTER the send answers (routes/chits.js sendStock, not awaited) — wait until the log holds `n` rows for the item */
async function settle(item_id, n, ms = 4000) {
  const end = Date.now() + ms;
  for (;;) { const m = await moves(item_id); if (m.length >= n || Date.now() > end) return m; await pause(150); }
}

/* ── the chits a counter and goods-in send (shapes: seed-local demoBillChit / demoReceiptChit; till.html chitOfCN / chitOfDoc) ── */
const line = (p, qty, unit, price) => ({ particulars: p.name, quantity: qty, unit: unit || p.unit, price, total: qty * price });
function receipt(no, rows, at) {
  return { recipients: [{ self: true, name: 'self' }], purpose: 'receipt', subject: 'Goods received ' + no, manual_subject: 'Goods received ' + no, client_ref: no,
    business_json: { doc: 'receipt', doc_no: no, doc_at: at || new Date().toISOString(), party: { name: 'Stock truth supplier' } },
    line_items: rows.map(([p, qty, cost, unit]) => Object.assign(line(p, qty, unit, cost), { item_data: { item_id: p.id } })) };
}
function bill(no, rows, billedAt) {
  const total = rows.reduce((a, [p, qty]) => a + qty * p.price, 0);
  return { recipients: [{ self: true, name: 'self' }], purpose: 'order', subject: 'Counter sale ' + no, manual_subject: 'Counter sale ' + no, client_ref: no,
    business_json: { customer: { name: 'Walk-in' }, till: { id: 'C1', name: 'Counter 1', host: 'browser' }, bill_no: no, billed_at: billedAt || new Date().toISOString(),
      payment: { mode: 'cash', paid: total, change: 0, parts: [{ how: 'cash', amount: total }] }, slip: 'cash' },
    line_items: rows.map(([p, qty]) => Object.assign(line(p, qty, p.unit, p.price), { item_id: p.id })) };
}
function creditNote(no, against, rows) {
  const total = rows.reduce((a, [p, qty]) => a + qty * p.price, 0);
  return { recipients: [{ self: true, name: 'self' }], purpose: 'credit_note', subject: 'Credit note ' + no, manual_subject: 'Credit note ' + no, client_ref: no,
    business_json: { customer: { name: 'Walk-in' }, till: { id: 'C1', name: 'Counter 1', host: 'browser' }, doc: 'credit_note', slip: 'credit_note', bill_no: no,
      billed_at: new Date().toISOString(), against: { bill_no: against }, reason: 'returned', refund: { parts: [{ how: 'cash', amount: total }], total } },
    line_items: rows.map(([p, qty]) => Object.assign(line(p, qty, p.unit, p.price), { item_id: p.id })) };
}
function despatch(no, orderId, rows) {
  return { recipients: [{ self: true, name: 'self' }], purpose: 'delivery_note', subject: 'Despatch ' + no, manual_subject: 'Despatch ' + no, client_ref: no,
    business_json: { doc: 'despatch', doc_no: no, doc_at: new Date().toISOString(), against: { chit_id: orderId } },
    line_items: rows.map(([p, qty]) => Object.assign(line(p, qty, p.unit, p.price), { item_data: { item_id: p.id } })) };
}
const send = async (body, what) => ok(await j('/api/chits/send', { method: 'POST', token: SHOP.token, body }), what).b;

/* ── the case runner: an expectation that fails is recorded with what was seen ── */
async function kase(id, title, fn, gap) {
  try { const seen = await fn(); results.push({ id, title, pass: true, seen: seen || '', gap }); console.log('  ok   ' + id + ' ' + title); }
  catch (e) { results.push({ id, title, pass: false, seen: e.message, gap }); console.log('  FAIL ' + id + ' ' + title + (gap ? '  [gap: ' + gap + ']' : '') + '\n         ' + e.message); }
}
function expect(cond, said) { if (!cond) throw new Error(said); }
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-6;

/* ── a fresh shop, its products and (for ST-18) a supplier on the rail ── */
async function freshShop() {
  const email = RUN + '@local.test';
  ok(await j('/api/entities/register', { method: 'POST', body: { email, display_name: 'Stock Truth ' + RUN, user_id: RUN } }), 'register');
  const v = ok(await j('/api/entities/verify', { method: 'POST', body: { email, otp: ENTITY_OTP } }), 'verify (is DEV_OTP armed?)').b;
  const entity = (v.entity && (v.entity.identity_id || v.entity.entity_id)) || (v.identity && v.identity.identity_id);
  SHOP = { token: v.token, bridge: v.entity.bridge_id, entity, products: {} };
  ok(await j('/api/entities/profile', { method: 'PATCH', token: SHOP.token, body: { catalogue_visibility: 'public' } }), 'publish');
  /* a price needs the shop's currency (lib/money stampPrice) — the seed's own country step (seed-local demoSetCountry) */
  ok(await j('/api/governance/country-setup', { method: 'PUT', token: SHOP.token, body: { country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: false } } }), 'country');
  for (const [key, name, unit, price] of [['A', 'Rice 1kg', 'piece', 60], ['B', 'Last packet', 'piece', 40], ['C', 'Average item', 'piece', 30],
    ['D', 'Late item', 'piece', 20], ['E', 'Void item', 'piece', 50], ['F', 'Amend item', 'piece', 25], ['G', 'Supplier item', 'piece', 35], ['H', 'Sale first', 'piece', 15]]) {
    const r = ok(await j('/api/products', { method: 'POST', token: SHOP.token, body: { item_data: { name, unit, price } } }), 'product ' + name).b;
    SHOP.products[key] = { id: r.item.item_id, name, unit, price };
  }
}

async function cases() {
  const { A, B, C, D, E, F, G, H } = SHOP.products;

  /* ── per channel ── */
  await kase('ST-01', 'goods received (receipt chit) puts stock IN at its cost', async () => {
    await send(receipt(RUN + '-GRN1', [[A, 10, 40]]), 'receipt');
    const m = await settle(A.id, 1);
    expect(m.length === 1 && m[0].reason === 'purchase' && near(m[0].qty, 10) && near(m[0].rate, 40), 'movements ' + JSON.stringify(m));
    expect(near(await onHand(A.id), 10), 'on hand ' + await onHand(A.id));
  });
  await kase('ST-02', 'the same receipt replayed moves nothing', async () => {
    await j('/api/chits/send', { method: 'POST', token: SHOP.token, body: receipt(RUN + '-GRN1', [[A, 10, 40]]) });
    await pause(600);
    const m = await moves(A.id);
    expect(m.length === 1 && near(await onHand(A.id), 10), m.length + ' movements, on hand ' + await onHand(A.id));
  });
  await kase('ST-03', 'a counter bill takes stock OUT', async () => {
    await send(bill(RUN + '-B1', [[A, 3]]), 'bill');
    const m = await settle(A.id, 2);
    const sale = m.find((x) => x.reason === 'sale');
    expect(sale && near(sale.qty, -3) && sale.ref === RUN + '-B1', 'movements ' + JSON.stringify(m));
    expect(near(await onHand(A.id), 7), 'on hand ' + await onHand(A.id));
  });
  await kase('ST-04', 'the offline queue re-sending the bill moves nothing', async () => {
    await j('/api/chits/send', { method: 'POST', token: SHOP.token, body: bill(RUN + '-B1', [[A, 3]]) });
    await pause(600);
    expect((await moves(A.id)).length === 2 && near(await onHand(A.id), 7), 'on hand ' + await onHand(A.id));
  });
  await kase('ST-05', 'a credit note (return) puts stock back once', async () => {
    await send(creditNote(RUN + '-CN1', RUN + '-B1', [[A, 1]]), 'credit note');
    const m = await settle(A.id, 3);
    const back = m.find((x) => x.reason === 'sale_return');
    expect(back && near(back.qty, 1) && back.ref === RUN + '-CN1', 'movements ' + JSON.stringify(m));
    await j('/api/chits/send', { method: 'POST', token: SHOP.token, body: creditNote(RUN + '-CN1', RUN + '-B1', [[A, 1]]) });
    await pause(600);
    expect((await moves(A.id)).length === 3 && near(await onHand(A.id), 8), 'after replay on hand ' + await onHand(A.id));
  });
  await kase('ST-06', 'a second partial return of the same line (its own credit note) also counts', async () => {
    await send(creditNote(RUN + '-CN2', RUN + '-B1', [[A, 1]]), 'credit note 2');
    await settle(A.id, 4);
    expect(near(await onHand(A.id), 9), 'on hand ' + await onHand(A.id));
  });
  await kase('ST-07', 'returning more than the bill sold is refused', async () => {
    const r = await j('/api/chits/send', { method: 'POST', token: SHOP.token, body: creditNote(RUN + '-CN3', RUN + '-B1', [[A, 5]]) });
    await pause(800);
    const h = await onHand(A.id);
    expect(r.status >= 400 || near(h, 9), 'HTTP ' + r.status + ', on hand ' + h + ' (bill sold 3, 2 already back, 5 more taken back)');
  }, 'no check of a return against what the bill sold');

  /* ── online shop order: a promise, then the despatch ── */
  let orderId = null;
  await kase('ST-08', 'an online-shop order moves no stock (a promise)', async () => {
    const nBefore = (await moves(A.id)).length, hBefore = await onHand(A.id);
    const door = '/api/catalogue/' + SHOP.bridge, email = RUN + '-cust@local.test';
    ok(await j(door + '/order/start', { method: 'POST', body: { email, name: 'Truth Customer' } }), 'order start');
    const o = ok(await j(door + '/order/confirm', { method: 'POST', body: { email, otp: CUSTOMER_OTP, line_items: [{ item_id: A.id, quantity: 2 }] } }), 'order confirm').b;
    orderId = o.chit_id;
    await pause(800);
    expect((await moves(A.id)).length === nBefore && near(await onHand(A.id), hBefore), 'on hand ' + await onHand(A.id) + ' (was ' + hBefore + ')');
    return 'order ' + orderId;
  });
  await kase('ST-09', 'an open order HOLDS its stock (committed / available-to-promise shown)', async () => {
    const b = (await statement()).balances[A.id] || {};
    expect(b.committed != null || b.available != null, 'statement row has no committed/available figure: ' + JSON.stringify(b));
  }, 'reservations not built (INVENTORY-LIFECYCLE §2.6)');
  await kase('ST-10', 'a despatch note against the order takes stock OUT once', async () => {
    expect(orderId, 'no order from ST-08');
    const nBefore = (await moves(A.id)).length, hBefore = await onHand(A.id);
    await send(despatch(RUN + '-DN1', orderId, [[A, 2]]), 'despatch');
    await settle(A.id, nBefore + 1);
    expect(near(await onHand(A.id), hBefore - 2), 'on hand ' + await onHand(A.id) + ' (was ' + hBefore + ')');
  });

  /* ── concurrency ── */
  await kase('ST-11', 'two counters sell the LAST unit at the same moment — no lost update, the oversell is recorded', async () => {
    await send(receipt(RUN + '-GRN2', [[B, 1, 25]]), 'receipt B');
    await settle(B.id, 1);
    const [r1, r2] = await Promise.all([j('/api/chits/send', { method: 'POST', token: SHOP.token, body: bill(RUN + '-B2a', [[B, 1]]) }),
      j('/api/chits/send', { method: 'POST', token: SHOP.token, body: bill(RUN + '-B2b', [[B, 1]]) })]);
    expect(r1.status < 300 && r2.status < 300, 'HTTP ' + r1.status + '/' + r2.status);
    const m = await settle(B.id, 3);
    const s = await stored(B.id), h = await onHand(B.id);
    expect(m.length === 3 && near(h, -1) && near(s.qty, -1), m.length + ' movements, on hand ' + h + ', stored ' + s.qty);
    return 'both sales kept, on hand −1 (negative allowed by design)';
  });
  await kase('ST-12', 'two receipts at the same moment — quantity and value both land (weighted average)', async () => {
    await Promise.all([send(receipt(RUN + '-GRN3a', [[C, 5, 10]]), 'r1'), send(receipt(RUN + '-GRN3b', [[C, 5, 20]]), 'r2')]);
    await settle(C.id, 2);
    const s = await stored(C.id);
    expect(near(s.qty, 10) && near(s.value, 150), 'stored ' + JSON.stringify(s));
  });
  await kase('ST-13', 'the same bill arriving twice at the same moment (two replays racing) moves once', async () => {
    const body = bill(RUN + '-B3', [[C, 2]]);
    await Promise.all([j('/api/chits/send', { method: 'POST', token: SHOP.token, body }), j('/api/chits/send', { method: 'POST', token: SHOP.token, body })]);
    await pause(1200);
    const sales = (await moves(C.id)).filter((x) => x.reason === 'sale');
    expect(sales.length === 1 && near(await onHand(C.id), 8), sales.length + ' sale movements, on hand ' + await onHand(C.id));
  });

  /* ── offline, then sync ── */
  await kase('ST-14', 'an offline bill synced late is dated when the goods LEFT (billed_at), not when it arrived', async () => {
    await send(receipt(RUN + '-GRN4', [[D, 5, 10]], new Date(Date.now() - 6 * 3600e3).toISOString()), 'receipt D');
    await settle(D.id, 1);
    const billedAt = new Date(Date.now() - 3 * 3600e3).toISOString();
    await send(bill(RUN + '-B4', [[D, 1]], billedAt), 'late bill');
    const sale = (await settle(D.id, 2)).find((x) => x.reason === 'sale');
    const gapMin = Math.round((new Date(sale.at) - new Date(billedAt)) / 60000);
    expect(Math.abs(gapMin) <= 1, 'movement dated ' + new Date(sale.at).toISOString() + ', billed ' + billedAt + ' (' + gapMin + ' min later)');
  }, 'sendStock passes created_at = server clock; billed_at / doc_at are ignored');
  await kase('ST-15', 'an offline sale that reaches the server before the receipt: negative, then healed by the receipt', async () => {
    await send(bill(RUN + '-B5', [[H, 2]]), 'sale first');
    await settle(H.id, 1);
    const neg = await onHand(H.id);
    await send(receipt(RUN + '-GRN5', [[H, 5, 8]]), 'receipt after');
    await settle(H.id, 2);
    const h = await onHand(H.id);
    expect(near(neg, -2) && near(h, 3), 'after sale ' + neg + ', after receipt ' + h);
  });

  /* ── reversals ── */
  let voidBill = null, voidGrn = null;
  await kase('ST-16', 'voiding (cancelling) a counter bill puts its stock back, as a reversing movement', async () => {
    await send(receipt(RUN + '-GRN6', [[E, 10, 30]]), 'receipt E');
    await settle(E.id, 1);
    voidBill = (await send(bill(RUN + '-B6', [[E, 4]]), 'bill E')).chit_id;
    await settle(E.id, 2);
    ok(await j('/api/chits/' + voidBill + '/void', { method: 'PUT', token: SHOP.token, body: { reason: 'stock truth test: wrong bill' } }), 'void bill');
    await pause(1000);
    const m = await moves(E.id), h = await onHand(E.id);
    expect(near(h, 10) && m.length === 3, 'on hand ' + h + ' after the void; movements ' + m.map((x) => x.reason + ' ' + x.qty).join(', '));
  }, 'void/cancel never reaches the stock writer');
  await kase('ST-17', 'voiding a goods receipt takes its stock back out', async () => {
    voidGrn = (await send(receipt(RUN + '-GRN7', [[E, 3, 30]]), 'receipt E2')).chit_id;
    const before = (await settle(E.id, (await moves(E.id)).length + 1)).length;
    ok(await j('/api/chits/' + voidGrn + '/void', { method: 'PUT', token: SHOP.token, body: { reason: 'stock truth test: wrong receipt' } }), 'void receipt');
    await pause(1000);
    const m = await moves(E.id);
    expect(m.length === before + 1, 'no reversing movement after the void (' + m.length + ' movements), on hand ' + await onHand(E.id));
  }, 'void/cancel never reaches the stock writer');
  await kase('ST-18', 'amending a bill line (3 → 1) moves the difference', async () => {
    await send(receipt(RUN + '-GRN8', [[F, 10, 10]]), 'receipt F');
    await settle(F.id, 1);
    const id = (await send(bill(RUN + '-B8', [[F, 3]]), 'bill F')).chit_id;
    await settle(F.id, 2);
    const a = await j('/api/chits/' + id + '/amend', { method: 'POST', token: SHOP.token,
      body: { edits: [{ line_index: 0, line: { particulars: F.name, quantity: 1, unit: F.unit }, reason_code: 'other', note: 'stock truth test' }] } });
    await pause(1000);
    const h = await onHand(F.id);
    expect(a.status < 300 && near(h, 9), 'amend HTTP ' + a.status + ', on hand ' + h + ' (expected 9)');
  }, 'an amendment never reaches the stock writer');

  /* ── a supplier bill received on the rail, counted in (the 18 Oct walk: Sri Ganesh ₹2,940) ── */
  await kase('ST-19', 'a supplier bill received, marked resale and counted in (goods-in) puts the goods IN', async () => {
    const sEmail = RUN + '-sup@local.test';
    ok(await j('/api/entities/register', { method: 'POST', body: { email: sEmail, display_name: 'Truth Supplier ' + RUN, user_id: RUN + 's' } }), 'supplier register');
    const sv = ok(await j('/api/entities/verify', { method: 'POST', body: { email: sEmail, otp: ENTITY_OTP } }), 'supplier verify').b;
    ok(await j('/api/governance/country-setup', { method: 'PUT', token: sv.token, body: { country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: false } } }), 'supplier country');
    const listed = await j('/api/relationships/suppliers', { method: 'POST', token: SHOP.token, body: { supplier_bridge_id: sv.entity.bridge_id, supply_kind: 'resale' } });
    if (listed.status !== 409) ok(listed, 'supplier on the list');
    const ref = RUN + '-SINV';
    const inv = ok(await j('/api/chits/send', { method: 'POST', token: sv.token, body: { recipients: [{ display_name: 'Stock Truth ' + RUN, bridge_id: SHOP.bridge, kind: 'to' }],
      purpose: 'invoice', subject: 'Invoice ' + ref, manual_subject: 'Invoice ' + ref, client_ref: ref, business_json: { bill_no: ref, billed_at: new Date().toISOString() },
      line_items: [{ particulars: G.name, quantity: 6, unit: G.unit, price: 20, total: 120 }] } }), 'supplier sends').b;
    const mine = ok(await j('/api/chits/' + inv.chit_id, { token: SHOP.token }), 'read bill').b;
    const lineIds = ((mine.detail && mine.detail.line_items) || []).map((l) => l.line_id);
    ok(await j('/api/chits/' + inv.chit_id + '/use', { method: 'PUT', token: SHOP.token, body: { use: 'resale' } }), 'use resale');
    ok(await j('/api/chits/' + inv.chit_id + '/deliver-lines', { method: 'POST', token: SHOP.token, body: { rows: [{ line_id: lineIds[0], quantity: 6, unit: G.unit, client_ref: ref + ':0' }] } }), 'goods in');
    await pause(1200);
    const any = await pg.query(`SELECT count(*)::int AS n FROM stock_movement WHERE entity_id = $1 AND ref LIKE $2`, [SHOP.entity, ref + '%']);
    expect(any.rows[0].n > 0, 'no movement for the counted-in bill (' + ref + '); the shop\'s ' + G.name + ' on hand ' + await onHand(G.id));
  }, 'deliver-lines records chit_line_delivery only; supplier lines carry no item of MINE');

  /* ── what the sender is told ── */
  await kase('ST-20', 'a receipt line with no product is SAID to the sender (not silently skipped)', async () => {
    const r = await send({ ...receipt(RUN + '-GRN9', [[A, 1, 40]]), line_items: [{ particulars: 'Loose provisions', quantity: 4, unit: 'kg', price: 50, total: 200 }] }, 'free-text receipt');
    expect(r.stock || r.stock_skipped, 'send answered ' + JSON.stringify(Object.keys(r)) + ' — nothing about the line that moved no stock');
  }, 'skips are logged on the server (stock.from-chit) only');
  await kase('ST-21', 'a receipt in a second unit is refused WITH a sentence to the sender', async () => {
    const before = (await moves(A.id)).length;
    const r = await send(receipt(RUN + '-GRN10', [[A, 2, 400, 'box']]), 'receipt in box');
    await pause(800);
    const after = (await moves(A.id)).length;
    expect(after === before, 'a second unit was accepted onto one balance');
    expect(r.stock || r.stock_skipped, 'refused silently: send answered ' + JSON.stringify(Object.keys(r)));
  }, 'refusal reaches the log only');

  /* ── the statement ── */
  await kase('ST-22', 'the statement equals the stored balance equals the SUM of movements, for every product of the shop', async () => {
    const st = (await statement()).balances;
    const r = await pg.query(`SELECT m.item_id::text AS item_id, sum(m.qty)::float AS log, count(*)::int AS n,
        (SELECT COALESCE(sum(b.qty),0) FROM stock_balance b WHERE b.entity_id = m.entity_id AND b.item_id = m.item_id)::float AS bal,
        (SELECT COALESCE(sum(b.moves),0) FROM stock_balance b WHERE b.entity_id = m.entity_id AND b.item_id = m.item_id)::int AS bm
        FROM stock_movement m WHERE m.entity_id = $1 GROUP BY m.entity_id, m.item_id`, [SHOP.entity]);
    const drift = r.rows.filter((x) => !near(x.log, x.bal) || x.n !== x.bm || !st[x.item_id] || !near(st[x.item_id].qty, x.log));
    expect(!drift.length, 'drift: ' + JSON.stringify(drift));
    return r.rows.length + ' products agree';
  });
  await kase('ST-23', 'the storefront shows the same figure as the statement', async () => {
    const pub = ok(await j('/api/catalogue/' + SHOP.bridge), 'storefront').b;
    const items = pub.items || pub.products || (pub.catalogue && pub.catalogue.items) || [];
    const a = items.find((x) => String(x.item_id || x.id) === String(A.id));
    const shown = a && ((a.item_data && a.item_data.avail) || a.avail);
    expect(shown && near(shown.qty, await onHand(A.id)), 'storefront ' + JSON.stringify(shown) + ' vs statement ' + await onHand(A.id));
  });
  await kase('ST-24', 'the statement says AS OF when each figure was last moved', async () => {
    const b = (await statement()).balances[A.id] || {};
    expect(b.last_at || b.as_of || b.at, 'row ' + JSON.stringify(b) + ' — only the read time `at` on the whole answer');
  }, 'onHand drops last_at');
  await kase('ST-25', 'a movement history per product is reachable', async () => {
    const tries = ['/api/till/stock/' + A.id + '/movements', '/api/till/stock/movements?item_id=' + A.id, '/api/stock/' + A.id + '/movements'];
    const codes = [];
    for (const p of tries) { const r = await j(p, { token: SHOP.token }); codes.push(p + ' ' + r.status); if (r.status === 200) return p; }
    throw new Error(codes.join(' · '));
  }, 'stock-store.movementsOf has no route');

  /* ── the whole local database (read-only): the nightly monitor's query ── */
  await kase('ST-26', 'monitor: no balance on this installation disagrees with its log', async () => {
    const r = await pg.query(`WITH l AS (SELECT entity_id, item_id, location, COALESCE(lot,'') AS lot, sum(qty) AS q, count(*) AS n FROM stock_movement GROUP BY 1,2,3,4)
      SELECT count(*)::int AS drift FROM stock_balance b FULL JOIN l ON l.entity_id = b.entity_id AND l.item_id = b.item_id AND l.location = b.location AND l.lot = b.lot
       WHERE COALESCE(b.qty,0) <> COALESCE(l.q,0) OR COALESCE(b.moves,0) <> COALESCE(l.n,0)`);
    expect(r.rows[0].drift === 0, r.rows[0].drift + ' balance rows disagree with their log');
    return '0 drift';
  });
}

(async () => {
  console.log('\n── stock truth on ' + API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  pg = new Client({ connectionString: DB }); await pg.connect();
  try {
    await freshShop();
    console.log('  shop ' + SHOP.bridge + ' · entity ' + SHOP.entity);
    await cases();
  } finally { await pg.end(); }
  const pass = results.filter((r) => r.pass).length, fail = results.length - pass;
  console.log('\n── ' + results.length + ' cases · ' + pass + ' pass · ' + fail + ' fail (' + results.filter((r) => !r.pass && r.gap).length + ' of them known gaps) ──');
  if (process.env.STOCK_TRUTH_JSON) require('fs').writeFileSync(process.env.STOCK_TRUTH_JSON, JSON.stringify({ run: RUN, shop: SHOP && SHOP.bridge, results }, null, 2));
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('stock truth could not run:', e && e.message); process.exit(2); });
