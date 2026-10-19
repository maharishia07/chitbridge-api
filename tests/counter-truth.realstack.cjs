'use strict';
/**
 * tests/counter-truth.realstack.cjs — COUNTER TRUTH, on the LOCAL stack (K-TRUTH-1 2026-10-19; case list: PM/BOX-TRUTH-TESTS.md §3 "Counter / till").
 *
 * TB-SELL-7 / CTR-3. Five of the box's uncovered rows: CT-08 void · CT-09 amend · CT-10 a stocked sale moves stock · CT-14 no country, no bill ·
 * CT-16 no "Kitchen" literal outside says(station). A case whose expected result is the PRINCIPLE (not today's code) carries `gap:` — a FAIL is a
 * RECORDED finding (COUNTER-BACKLOG "K-TRUTH-1 2026-10-19"), never fixed here. Shares tests/lib/truth-harness.cjs. LOCAL ONLY (the harness refuses the rest).
 * Run: node tests/counter-truth.realstack.cjs   (one realstack file at a time on :3100)
 * CARD 09-counter/README
 */
const fs = require('fs'), path = require('path');
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { DB, ENTITY_OTP, j, ok, pause, kase, expect, near, receipt, bill, freshShop, finish } = H;
const RUN = 'ct' + (Date.now() % 1e10).toString(36);
let pg = null;
const sendAs = async (shop, body, what) => ok(await j('/api/chits/send', { method: 'POST', token: shop.token, body }), what).b;
const movesOf = async (shop, item) => (await pg.query(`SELECT reason, qty::float AS qty, ref FROM stock_movement WHERE entity_id = $1 AND item_id = $2 ORDER BY at, movement_id`, [shop.entity, item])).rows;
const onHand = async (shop, item) => { const b = ok(await j('/api/till/stock?detail=1', { token: shop.token }), 'stock').b.balances[item]; return b ? b.qty : null; };
async function settle(shop, item, n, ms = 4000) { const end = Date.now() + ms; for (;;) { const m = await movesOf(shop, item); if (m.length >= n || Date.now() > end) return m; await pause(150); } }
async function product(shop, name, price) { const r = ok(await j('/api/products', { method: 'POST', token: shop.token, body: { item_data: { name, unit: 'piece', price } } }), 'product ' + name).b; return { id: r.item.item_id, name, unit: 'piece', price }; }

(async () => {
  console.log('\n── counter truth on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  pg = new Client({ connectionString: DB }); await pg.connect();
  try {
    const A = await freshShop(RUN + 'a', 'Counter truth');
    const p1 = await product(A, 'Rice', 60), p2 = await product(A, 'Soap', 25), p3 = await product(A, 'Tea', 50);
    await kase('CT-10', 'a counter sale of a stocked item leaves a sale row and lowers the statement', async () => {
      await sendAs(A, receipt(RUN + '-G10', [[p1, 10, 40]]), 'receipt'); await settle(A, p1.id, 1);
      await sendAs(A, bill(RUN + '-B10', [[p1, 3]]), 'bill'); const m = await settle(A, p1.id, 2);
      expect(m.some((x) => x.reason === 'sale') && near(await onHand(A, p1.id), 7), 'movements ' + m.map((x) => x.reason + ' ' + x.qty).join(', ') + ' · on hand ' + await onHand(A, p1.id));
    });
    await kase('CT-08', 'voiding a counter bill: one reversing stock row, a second void adds nothing', async () => {
      await sendAs(A, receipt(RUN + '-G8', [[p2, 10, 10]]), 'receipt'); await settle(A, p2.id, 1);
      const id = (await sendAs(A, bill(RUN + '-B8', [[p2, 4]]), 'bill')).chit_id; await settle(A, p2.id, 2);
      ok(await j('/api/chits/' + id + '/void', { method: 'PUT', token: A.token, body: { reason: 'counter truth' } }), 'void'); await pause(1000);
      await j('/api/chits/' + id + '/void', { method: 'PUT', token: A.token, body: { reason: 'counter truth, twice' } }); await pause(800);
      const m = await movesOf(A, p2.id);
      expect(m.length === 3 && near(await onHand(A, p2.id), 10), 'movements ' + m.map((x) => x.reason + ' ' + x.qty).join(', ') + ' · on hand ' + await onHand(A, p2.id) + ' (expected 3 rows, 10)');
    }, 'void never reaches the stock writer (ST-16; same cause as RL-07)');
    await kase('CT-09', 'amending a bill 3 to 1 puts 2 back, once', async () => {
      await sendAs(A, receipt(RUN + '-G9', [[p3, 10, 20]]), 'receipt'); await settle(A, p3.id, 1);
      const id = (await sendAs(A, bill(RUN + '-B9', [[p3, 3]]), 'bill')).chit_id; await settle(A, p3.id, 2);
      const a = await j('/api/chits/' + id + '/amend', { method: 'POST', token: A.token, body: { edits: [{ line_index: 0, line: { particulars: p3.name, quantity: 1, unit: 'piece' }, reason_code: 'other' }], note: 'counter truth' } });
      await pause(1000);
      expect(a.status < 300 && near(await onHand(A, p3.id), 9), 'amend HTTP ' + a.status + ' · on hand ' + await onHand(A, p3.id) + ' (expected 9)');
    }, 'an amendment never reaches the stock writer (ST-18; same cause as RL-08)');
    await kase('CT-14', 'a shop with no country cannot bill: refused, in words, no INR assumed', async () => {
      const tag = RUN + 'n', email = tag + '@local.test';
      ok(await j('/api/entities/register', { method: 'POST', body: { email, display_name: 'No country ' + tag, user_id: tag } }), 'register');
      const v = ok(await j('/api/entities/verify', { method: 'POST', body: { email, otp: ENTITY_OTP } }), 'verify').b;
      const r = await j('/api/chits/send', { method: 'POST', token: v.token, body: bill(RUN + '-BN', [[{ id: 'x', name: 'Thing', unit: 'piece', price: 10 }, 1]]) });
      expect(r.status >= 400 && r.status < 500 && /country/i.test(JSON.stringify(r.b)), 'HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 200));
    });
    await kase('CT-16', 'a non-food counter reads its station words through says(), no "Kitchen" literal in the till master', async () => {
      const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8').split('\n');
      const hits = []; src.forEach((l, i) => { if (/(['"`])[^'"`\n]*\bKitchen\b[^'"`\n]*\1/.test(l) && !/says\(/.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l)) hits.push(i + 1); });
      expect(hits.length === 0, hits.length + ' lines with a Kitchen literal: till.html:' + hits.slice(0, 8).join(','));
    }, 'Kitchen literals still in the till master (ORD-2 / VB8)');
  } finally { await pg.end(); }
  finish('counter-truth', process.env.COUNTER_TRUTH_JSON, { run: RUN });
})().catch((e) => { console.error('counter truth could not run:', e && e.message); process.exit(2); });
