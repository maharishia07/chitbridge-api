'use strict';
/**
 * tests/counter-truth.realstack.cjs — COUNTER TRUTH, on the LOCAL stack (K-TRUTH-1 2026-10-19; case list: PM/BOX-TRUTH-TESTS.md §3 "Counter / till").
 *
 * TB-SELL-7 / CTR-3. Five of the box's uncovered rows: CT-08 void · CT-09 amend · CT-10 a stocked sale moves stock · CT-14 no country, no bill ·
 * CT-16 no "Kitchen" literal outside says(station). A case whose expected result is the PRINCIPLE (not today's code) carries `gap:` — a FAIL is a
 * RECORDED finding (COUNTER-BACKLOG "K-TRUTH-1 2026-10-19"), never fixed here. Shares tests/lib/truth-harness.cjs. LOCAL ONLY (the harness refuses the rest).
 * Run: node tests/counter-truth.realstack.cjs   (one realstack file at a time on :3100)
 *
 * T2 BOX ROUND (24 Oct 2026, hygiene row 5): CT-01 each bill once, a replay answers the first chit · CT-02 a late-synced bill keeps the price it printed ·
 * CT-03 the day report's bills for one counter · CT-04 the server names the bill it is missing (POST /api/till/reconcile) · CT-11 two counters, two
 * prefixes, a held counter refused · CT-11b one number from two devices is refused and named · CT-17 (R58 walk 24 Oct) no sales offer on a goods receipt.
 * NOT written here (listed in the PR): CT-05 (the rate prompt is the till's; a GSTIN shop and the rate write are the catalogue's) · CT-06 / CT-13 (the slip
 * title and the pack's tax invoice are till.html functions, pure units: till-country-slip / till-country-bill) · CT-07 / CT-12 (walks) · CT-15 (needs an
 * on-rail customer from a second shop's approval).
 * CARD 09-counter/README
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { DB, ENTITY_OTP, j, ok, pause, kase, expect, near, receipt, bill, freshShop, finish } = H;
const UNKNOWN_CHIT = crypto.randomUUID();                        /* a chit id no shop holds: the bill the server is missing (CT-04) */
const BILLED_AT = new Date(Date.now() - 3600e3).toISOString();   /* one fixed moment per run: a replay carries the SAME billed_at (routes/chits.js sendReplay) */
const DAY_AGO_AT = new Date(Date.now() - 86400e3).toISOString(); /* CT-02: a bill taken yesterday, synced now */
const RUN = 'ct' + (Date.now() % 1e10).toString(36);
let pg = null;
const sendAs = async (shop, body, what) => ok(await j('/api/chits/send', { method: 'POST', token: shop.token, body }), what).b;
const movesOf = async (shop, item) => (await pg.query(`SELECT reason, qty::float AS qty, ref FROM stock_movement WHERE entity_id = $1 AND item_id = $2 ORDER BY at, movement_id`, [shop.entity, item])).rows;
const onHand = async (shop, item) => { const b = ok(await j('/api/till/stock?detail=1', { token: shop.token }), 'stock').b.balances[item]; return b ? b.qty : null; };
async function settle(shop, item, n, ms = 4000) { const end = Date.now() + ms; for (;;) { const m = await movesOf(shop, item); if (m.length >= n || Date.now() > end) return m; await pause(150); } }
async function product(shop, name, price) { const r = ok(await j('/api/products', { method: 'POST', token: shop.token, body: { item_data: { name, unit: 'piece', price } } }), 'product ' + name).b; return { id: r.item.item_id, name, unit: 'piece', price }; }

/** a counter bill under a named counter (till id) at a fixed moment: the harness bill, its till and billed_at set */
function tillBill(no, rows, tillId, at) {
  const b = bill(no, rows, at);
  b.business_json.till = { id: tillId, name: 'Counter ' + tillId, host: 'browser' };
  return b;
}
/** the day report's bills for one counter, as the server holds them (GET /api/till/bills, `till` filters in SQL) */
const billsOf = async (shop, till) => ok(await j('/api/till/bills?days=2&limit=100' + (till ? '&till=' + till : ''), { token: shop.token }), 'bills').b.bills || [];
const lineSum = (rows) => rows.reduce((a, r) => a + r.lines.reduce((b, l) => b + Number(l.net), 0), 0);

/** CT-01: 2 counters x 5 bills, each sent twice (the line came back): every bill is on the server once and a replay answers the first chit */
async function caseEachOnce() {
  const S = await freshShop(RUN + 'o', 'Once'), p = await product(S, 'Rice', 60), first = {}, plan = [];
  for (const t of ['C1', 'C2']) for (let n = 1; n <= 5; n++) plan.push([t + '-' + n, t]);
  for (const [no, t] of plan) first[no] = (await sendAs(S, tillBill(RUN + '-O' + no, [[p, 1]], t, BILLED_AT), 'bill ' + no)).chit_id;
  const again = [];
  for (const [no, t] of plan) again.push(await sendAs(S, tillBill(RUN + '-O' + no, [[p, 1]], t, BILLED_AT), 'replay ' + no));
  const held = (await billsOf(S)).filter((x) => String(x.no).startsWith(RUN + '-O'));
  expect(held.length === 10 && new Set(held.map((x) => x.no)).size === 10, held.length + ' bills on the server for 10 sent twice (expected 10, none twice)');
  const moved = again.filter((r, i) => r.chit_id !== first[plan[i][0]] || r.duplicate !== true);
  expect(!moved.length, moved.length + ' replays did not answer the first chit with duplicate:true');
}

/** CT-02: the catalogue price moves, THEN yesterday's bill syncs: the bill keeps the price it printed (billed_at gates the live re-rate) */
async function casePriceKept() {
  const S = await freshShop(RUN + 'r', 'Rerate'), p = await product(S, 'Tea', 60);
  ok(await j('/api/till/price', { method: 'POST', token: S.token, body: { item_id: p.id, price: 90 } }), 'price moved');
  await sendAs(S, tillBill(RUN + '-R1', [[p, 2]], 'C1', DAY_AGO_AT), 'late bill');
  const row = (await billsOf(S)).find((x) => x.no === RUN + '-R1'), l = row && row.lines[0];
  expect(l && near(l.price, 60) && near(l.net, 120), 'stored line ' + JSON.stringify(l) + ' (expected price 60, net 120; the catalogue says 90 now)');
}

/** CT-03: five bills on one counter: the day report's list (the day's bills for that counter) is those five and their lines add to what was sent */
async function caseDayReport() {
  const S = await freshShop(RUN + 'd', 'Day'), p = await product(S, 'Soap', 25);
  for (let n = 1; n <= 5; n++) await sendAs(S, tillBill(RUN + '-D' + n, [[p, n]], 'C3', BILLED_AT), 'bill ' + n);
  await sendAs(S, tillBill(RUN + '-DX', [[p, 7]], 'C4', BILLED_AT), 'other counter bill');
  const mine = (await billsOf(S, 'C3')).filter((x) => String(x.no).startsWith(RUN + '-D'));
  expect(mine.length === 5 && near(lineSum(mine), 25 * 15), 'counter C3 lists ' + mine.length + ' bills, lines add to ' + lineSum(mine) + ' (expected 5 bills, ' + 25 * 15 + '; the C4 bill is not C3\'s)');
}

/** CT-04: the server is missing one bill: POST /api/till/reconcile names it by its number, and says ok for the rest */
async function caseMissingNamed() {
  const S = await freshShop(RUN + 'm', 'Missing'), p = await product(S, 'Salt', 20), asked = [];
  for (let n = 1; n <= 3; n++) {
    const no = RUN + '-M' + n, id = (await sendAs(S, tillBill(no, [[p, 1]], 'C1', BILLED_AT), 'bill ' + n)).chit_id;
    asked.push({ no, at: BILLED_AT, chit_id: id });
  }
  const gone = RUN + '-M4';
  asked.push({ no: gone, at: BILLED_AT, chit_id: UNKNOWN_CHIT });
  const out = ok(await j('/api/till/reconcile', { method: 'POST', token: S.token, body: { bills: asked } }), 'reconcile').b.bills || [];
  const verdict = Object.fromEntries(out.map((x) => [x.no, x.verdict]));
  expect(out.length === 4 && verdict[gone] === 'missing' && asked.slice(0, 3).every((x) => verdict[x.no] === 'ok'), 'verdicts ' + JSON.stringify(verdict));
}

/** CT-11: two counters made and opened get two prefixes; a counter already open is refused (409), not handed to a second PC */
async function caseTwoPrefixes() {
  const S = await freshShop(RUN + 'k', 'Series'), made = [], opened = [];
  for (const name of ['Front', 'Back']) made.push(ok(await j('/api/counters', { method: 'POST', token: S.token, body: { name } }), 'make ' + name).b.counter);
  for (const c of made) opened.push(ok(await j('/api/counters/' + c.id + '/open', { method: 'POST', token: S.token }), 'open ' + c.id).b);
  const ids = opened.map((o) => o.counter && o.counter.id);
  expect(new Set(ids).size === 2 && opened.every((o) => o.key && o.counter.state === 'open'), 'opened counters ' + JSON.stringify(ids) + ' (expected two different ids, each open with a key)');
  const second = await j('/api/counters/' + made[0].id + '/open', { method: 'POST', token: S.token });
  expect(second.status === 409, 'a second open of ' + made[0].id + ' answered HTTP ' + second.status + ' (expected 409, the counter is held)');
}

/** CT-11b: one bill number from two devices (two moments) is refused and named, never absorbed; the first bill stays the only one */
async function caseCollisionNamed() {
  const S = await freshShop(RUN + 'c', 'Collide'), p = await product(S, 'Oil', 100), no = RUN + '-X1';
  await sendAs(S, tillBill(no, [[p, 1]], 'C1', BILLED_AT), 'first device');
  const r = await j('/api/chits/send', { method: 'POST', token: S.token, body: tillBill(no, [[p, 2]], 'C2', new Date().toISOString()) });
  expect(r.status === 409 && /another counter|already recorded|TILL_SERIES_COLLISION/i.test(JSON.stringify(r.b)), 'second device answered HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 200));
  const held = (await billsOf(S)).filter((x) => x.no === no);
  expect(held.length === 1 && near(held[0].lines[0].qty, 1), held.length + ' bills hold ' + no + ' (expected the first one only)');
}

/** CT-17 (R58 walk 24 Oct): a shop's SALES offer never touches a goods receipt: the line total equals qty x cost. The offer is proved live first, on a captured sale. */
async function caseNoOfferOnReceipt() {
  const S = await freshShop(RUN + 'f', 'Offer'), p = await product(S, 'Dal', 100);
  ok(await j('/api/definitions', { method: 'POST', token: S.token, body: { kind: 'offer', sub_kind: 'amount_off', name: 'Dal 5 off ' + RUN, status: 'live', rules: { amount: 5, scope: 'line', applies_to: { item_ids: [p.id] } } } }), 'offer');
  const sale = bill(RUN + '-F1', [[p, 1]]); delete sale.business_json.billed_at;   /* a captured sale carries no billed_at: the live offers apply to it */
  const sid = (await sendAs(S, sale, 'captured sale')).chit_id;
  const sold = (await pg.query('SELECT line_items FROM chit_detail WHERE chit_id = $1', [sid])).rows[0].line_items[0];
  expect(sold.offer || Number(sold.total) < 100, 'the offer never applied to a sale, so the receipt check proves nothing: ' + JSON.stringify(sold));
  const rid = (await sendAs(S, receipt(RUN + '-F2', [[p, 3, 100]]), 'receipt')).chit_id;
  const got = (await pg.query('SELECT line_items FROM chit_detail WHERE chit_id = $1', [rid])).rows[0].line_items[0];
  expect(!got.offer && near(got.total, 300), 'receipt line ' + JSON.stringify(got) + ' (expected total 300, no offer)');
}

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
    await kase('CT-01', 'two counters, 10 bills each sent twice: 10 on the server, a replay answers the first chit', caseEachOnce);
    await kase('CT-02', 'a bill taken yesterday syncs after the catalogue price moved: the line keeps the price it printed', casePriceKept);
    await kase('CT-03', 'five bills on one counter: the day report\'s bill list is those five, and its lines add to what was sent', caseDayReport);
    await kase('CT-04', 'the server is missing one bill: reconcile names it by number and passes the rest', caseMissingNamed);
    await kase('CT-11', 'two counters opened get two prefixes, and a counter already open is refused', caseTwoPrefixes);
    await kase('CT-11b', 'one bill number from two devices is refused and named, the first stays the only one', caseCollisionNamed);
    await kase('CT-17', 'a sales offer never applies to a goods receipt: the line equals qty x cost', caseNoOfferOnReceipt,
      'R58 walk 24 Oct: /chits/send applies the seller\'s live offers to any chit sent to self without billed_at (routes/chits.js sendOffers: toSelf), a receipt included; only the till\'s own Receive screen was seen doing it');
  } finally { await pg.end(); }
  finish('counter-truth', process.env.COUNTER_TRUTH_JSON, { run: RUN });
})().catch((e) => { console.error('counter truth could not run:', e && e.message); process.exit(2); });
