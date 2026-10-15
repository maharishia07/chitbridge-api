/**
 * ── tests/reward-cycle.test.js · THE WHOLE CYCLE, ONE CUSTOMER, FOUR VISITS ────────────────────────────────────
 *
 * lib/rewards.js is tested on its own (tests/rewards.test.js, 33 checks). This is the other question: does the
 * SEQUENCE hold — earn, come back, encash, expire, register — when the pieces are put together the way the routes
 * put them together?
 *
 * ⚠️ IT RUNS AGAINST lib/reward-store.js WITH THE DATABASE STUBBED, not against a mock of the store. The stub is a
 * tiny append-only table with the same rules the real one has by GRANT: rows go in and never change. So what is
 * being tested is the real fold, the real expiry, the real claim — everything except the network.
 * ⚠️ AND THE STUB REFUSES AN UPDATE. If a future change ever tries to correct a balance by editing a row, this
 * fails here rather than in production against a table that would have refused it anyway.
 */
const assert = require('assert'), path = require('path');
const rewards = require(path.join(__dirname, '..', 'lib', 'rewards.js'));
const store = require(path.join(__dirname, '..', 'lib', 'reward-store.js'));
const counterBill = require(path.join(__dirname, '..', 'lib', 'counter-bill.js'));   /* W2-REW: the server's own bill, the one pick of what was paid */

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); }
                           catch (e) { console.log('  FAIL ' + what + '\n       ' + e.message); process.exitCode = 1; } };
const ita = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); }
                                  catch (e) { console.log('  FAIL ' + what + '\n       ' + e.message); process.exitCode = 1; } };

/* ── the shop's own declaration. ONE shop's choice, not a default anybody inherits. ── */
const SHOP = '11111111-1111-1111-1111-111111111111';
const PROG = { definition_id: 'def-1', name: 'Shop points',
               earn: { kind: 'per_amount', per: 100, points: 1 },
               redeem: [{ kind: 'money', points: 100, amount: 1 }],
               expires_months: 12, walk_in_earns: false, min_balance_to_spend: 100 };

/* ── the stub: an append-only table, a TRANSACTION per withEntity (a throw undoes its inserts, as Postgres would),
 *    and the statements the store issues against it ── */
const TABLE = [];
const LOCKS = [];
/* the server's own records the reward reads: bills by number, catalogue items by id, the category master */
const BILLS = {};
const ITEMS = { 'a1a1a1a1-0000-4000-8000-000000000001': { name: 'Shampoo', sku: 'SH-1', categories: ['cat-1'] },
                'a1a1a1a1-0000-4000-8000-000000000002': { name: 'Rice', sku: 'RC-1', categories: ['cat-2'] } };
const CATS = [{ id: 'cat-1', name: 'Personal care' }, { id: 'cat-2', name: 'Grocery' }];
const mine = (eid, scheme, value) => (r) => r.entity_id === eid && r.holder_scheme === scheme && r.holder_value === value;
const withEntity = async (entity_id, fn) => {
  const mark = TABLE.length;
  try { return await fn({ query: run }); }
  catch (e) { TABLE.length = mark; throw e; }          /* ROLLBACK: nothing this transaction wrote survives */
};
async function run(sql, args) {
    if (/^\s*SELECT d\.definition_id/.test(sql)) return { rows: [{ definition_id: 'def-1', name: 'Shop points', rules: PROG }] };
    if (/pg_advisory_xact_lock/.test(sql)) { LOCKS.push(args[0]); return { rows: [{}] }; }
    if (/SUM\(points\) OVER \(\)/.test(sql)) {
      const [eid, scheme, value, limit] = args;
      const all = TABLE.filter(mine(eid, scheme, value));
      const total = all.reduce((a, r) => a + r.points, 0);
      /* ⚠️ LIMIT NULL is Postgres for "no limit" (ENG-REW1: the whole ledger when the programme declares expiry) */
      const page = all.slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
      return { rows: (limit == null ? page : page.slice(0, limit)).map((r) => Object.assign({ total: String(total) }, r)) };
    }
    /* ⭐ W2-REW: the server's OWN bill (chit_header + chit_detail by client_ref — lib/counter-bill byRef), its catalogue and its
       category master. The reward reads these; the counter's posted basket is not an input anywhere below. */
    if (/FROM chit_header/.test(sql)) {
      const [eid, ref] = args; const b = BILLS[ref];
      return { rows: (b && eid === SHOP) ? [{ chit_id: 'chit-' + ref, till_id: 'C1', billed_at: b.at || null,
                                            summary_json: { money: b.money }, line_items: b.line_items || [] }] : [] };
    }
    if (/FROM catalogue_items/.test(sql)) {
      const ids = args[1] || [];
      return { rows: ids.filter((id) => ITEMS[id]).map((id) => ({ item_id: id, item_data: ITEMS[id] })) };
    }
    if (/kind = 'category'/.test(sql)) return { rows: CATS.map((c) => ({ definition_id: c.id, name: c.name, status: 'live' })) };
    if (/^\s*INSERT INTO reward_ledger/.test(sql)) {
      const [entity_id, holder_scheme, holder_value, points, why, ref, note, definition_id, at] = args;
      /* ⚠️ THE REAL UNIQUE INDEX, reproduced: one entry per (shop, bill, reason, holder). A bill that syncs twice
         must not award twice, and the counter replays its queue as a matter of routine. */
      if (ref && TABLE.some((r) => r.entity_id === entity_id && r.ref === ref && r.why === why
                                && r.holder_scheme === holder_scheme && r.holder_value === holder_value))
        return { rows: [] };
      TABLE.push({ entity_id, holder_scheme, holder_value, points: Number(points), why, ref, note,
                   definition_id, at: at || new Date().toISOString() });
      return { rows: [{ entry_id: 'e' + TABLE.length }] };
    }
    if (/^\s*UPDATE reward_ledger|^\s*DELETE FROM reward_ledger/i.test(sql))
      throw new Error('reward_ledger is append-only by GRANT — cb_app may not UPDATE or DELETE');
    if (/FROM reward_ledger/.test(sql)) throw new Error('the store read the ledger a way this stub does not know: ' + sql.slice(0, 80));
    return { rows: [] };
}

/** the award path, as routes/till.js performs it — kept in one place so the visits below read as visits.
 *  `total` is what the SERVER'S copy of the bill came to (summary_json.money.total): the only figure the earning is computed from. */
async function bill(holder, ref, total, spend) {
  const prog = await store.programme(SHOP, withEntity);
  const walkIn = holder.scheme === 'phone';
  const mayEarn = !walkIn || prog.walk_in_earns !== false;
  BILLS[ref] = BILLS[ref] || { money: { total }, line_items: [] };
  const r = await store.settle(SHOP, holder, prog, { ref, spend: spend || 0, earn: mayEarn }, withEntity);
  const before = r.before, added = r.added;
  return { added, spent: spend || 0, points: before.points - (spend || 0) + added,
           overspent: (spend || 0) > before.points ? (spend || 0) - before.points : 0 };
}
/** one stored row, written straight into the stand-in table (history the test needs to exist) */
const put = (holder, points, why, ref, at) => TABLE.push({ entity_id: SHOP, holder_scheme: holder.scheme, holder_value: holder.value,
  points, why, ref, note: null, definition_id: 'def-1', at: at || new Date().toISOString() });

(async () => {
console.log('— a walk-in with no number —');

await ita('⚠️ earns nothing, and there is nobody to accrue it to', async () => {
  const h = rewards.holderOf({ name: 'Walk-in' });
  assert.strictEqual(h, null, 'a walk-in who gave nothing must hold nothing');
});

console.log('— visit 1: a walk-in who gives a phone number —');

const PHONE = { scheme: 'phone', value: '9840012345' };
await ita('⚠️ THIS SHOP DECLARED walk_in_earns:false, so a phone holder earns nothing — and is told, not ignored', async () => {
  const r = await bill(PHONE, 'B-001', 640, 0);
  assert.strictEqual(r.added, 0, 'the shop said walk-ins do not earn, and the counter awarded anyway');
  assert.strictEqual(r.points, 0);
});

console.log('— visit 2: the same person, now on the shop’s list —');

const ME = { scheme: 'identity', value: 'cust-77' };
await ita('⭐ 1 point per ₹100 — ₹640 earns 6, not 6.4', async () => {
  const r = await bill(ME, 'B-002', 640, 0);
  assert.strictEqual(r.added, 6, 'a fraction of a point is not a point');
  assert.strictEqual(r.points, 6);
});

await ita('⭐⭐ and the SAME bill arriving again awards nothing — the counter replays its queue', async () => {
  const before = TABLE.length;
  const r = await bill(ME, 'B-002', 640, 0);
  assert.strictEqual(TABLE.length, before, 'a replayed bill wrote a second row');
  assert.strictEqual((await store.balance(SHOP, ME, withEntity)).points, 6, 'a replay doubled the balance');
});

console.log('— visits 3 to 20: enough to be worth something —');

await ita('⭐ a year of ordinary shopping', async () => {
  for (let n = 3; n <= 20; n++) await bill(ME, 'B-0' + String(n).padStart(2, '0'), 1200, 0);
  const b = await store.balance(SHOP, ME, withEntity);
  assert.strictEqual(b.points, 6 + 18 * 12, '18 bills of ₹1,200 earn 12 each');
  assert.strictEqual(b.worth, 2.22, '222 points at 100 = ₹1 is ₹2.22 the shop owes');
});

await ita('⭐⭐ and the shopkeeper is told what it MEANS, not just the number', async () => {
  const b = await store.balance(SHOP, ME, withEntity);
  const w = rewards.worthOf(PROG, b.points, {});
  assert.ok(/^222 points · worth 2\.22/.test(w.says), 'got: ' + w.says);
});

console.log('— visit 21: encashing —');

await ita('⭐⭐⭐ points pay for part of the bill; they do NOT reduce it', async () => {
  const before = (await store.balance(SHOP, ME, withEntity)).points;
  const r = await bill(ME, 'B-021', 500, 200);
  assert.strictEqual(r.spent, 200);
  assert.strictEqual(r.added, 5, '₹500 still earns 5 — the bill was 500, not 498');
  assert.strictEqual(r.points, before - 200 + 5);
  assert.strictEqual(r.overspent, 0);
});

await ita('⚠️ a spend the balance cannot cover is STILL WRITTEN, and reported', async () => {
  const r = await bill(ME, 'B-022', 100, 5000);
  assert.ok(r.overspent > 0, 'an unaffordable spend was silently accepted with no warning');
  const b = await store.balance(SHOP, ME, withEntity);
  assert.ok(b.negative, 'the ledger does not add up and is not saying so');
  /* ⚠️ THE REASON IT IS WRITTEN: the customer already paid a reduced price at the counter. Refusing the record
     here would leave them with the goods AND the points, and the shop with neither. */
});

console.log('— the year after —');

await ita('⭐⭐ points expire twelve months after they were earned, as an ENTRY the customer can read', async () => {
  const OLD = { scheme: 'identity', value: 'cust-old' };
  TABLE.push({ entity_id: SHOP, holder_scheme: 'identity', holder_value: 'cust-old', points: 500,
               why: 'earned', ref: 'B-OLD', note: null, definition_id: 'def-1',
               at: '2024-06-01T00:00:00.000Z' });
  const b = await store.balance(SHOP, OLD, withEntity);
  assert.strictEqual(b.points, 0, 'a two-year-old balance is still being counted');
  assert.strictEqual(b.expired.length, 1);
  assert.strictEqual(b.expired[0].points, -500);
  assert.strictEqual(b.expired[0].why, 'expired', 'expiry must be readable in the ledger, not a silent filter');
});

await ita('⭐⭐ T1-FINREW: an expiry once WRITTEN is counted once — the next read does not expire the same earning again', async () => {
  const OLD2 = { scheme: 'identity', value: 'cust-old2' };
  put(OLD2, 500, 'earned', 'B-OLD2', '2024-06-01T00:00:00.000Z');
  put(OLD2, 80, 'earned', 'B-NEW2');
  const prog = await store.programme(SHOP, withEntity);
  await store.settle(SHOP, OLD2, prog, { ref: 'B-NEXT', spend: 0, added: 0 }, withEntity);   /* the next touch writes the expiry */
  assert.strictEqual(TABLE.filter((r) => r.holder_value === 'cust-old2' && r.why === 'expired').length, 1, 'the expiry was not written');
  const b = await store.balance(SHOP, OLD2, withEntity);
  assert.strictEqual(b.expired.length, 0, 'an expiry already in the ledger was produced again');
  assert.strictEqual(b.points, 80, 'got ' + b.points + ' — the written expiry was counted twice');
});

await ita('⭐⭐ ENG-REW1: reading a balance never writes, and reading twice gives the same answer', async () => {
  const R1 = { scheme: 'identity', value: 'cust-read' };
  put(R1, 300, 'earned', 'B-R1', '2024-03-01T00:00:00.000Z');
  const rows = TABLE.length;
  const a = await store.balance(SHOP, R1, withEntity);
  const b = await store.balance(SHOP, R1, withEntity);
  assert.strictEqual(TABLE.length, rows, 'a READ appended to the ledger');
  assert.strictEqual(a.points, 0); assert.strictEqual(b.points, 0, 'the second read cut the balance again: ' + b.points);
  assert.strictEqual(a.expired.length, 1); assert.strictEqual(b.expired.length, 1, 'the same expiry rides every read until a touch writes it');
  assert.strictEqual(String(a.expired[0].at).slice(0, 10), '2025-03-01', 'the expiry is dated the day the points ran out');
});

await ita('⭐⭐ ENG-REW1: earn 100 (due D), spend 60 → at D only 40 expire, not 100 — the balance never goes negative', async () => {
  const F = { scheme: 'identity', value: 'cust-fifo' };
  put(F, 100, 'earned', 'B-F1', '2024-06-01T00:00:00.000Z');
  put(F, -60, 'spent', 'B-F2', '2024-09-01T00:00:00.000Z');
  const b = await store.balance(SHOP, F, withEntity);
  assert.strictEqual(b.expired.length, 1);
  assert.strictEqual(b.expired[0].points, -40, 'got ' + b.expired[0].points + ' — points already spent were expired');
  assert.strictEqual(b.points, 0);
  assert.strictEqual(b.negative, false, 'expiring spent points drove the balance below zero');
  /* the next touch writes exactly that one row, keyed to the lot; a second touch writes nothing */
  const prog = await store.programme(SHOP, withEntity);
  await store.settle(SHOP, F, prog, { ref: 'B-F3', spend: 0, added: 0 }, withEntity);
  await store.settle(SHOP, F, prog, { ref: 'B-F4', spend: 0, added: 0 }, withEntity);
  const exp = TABLE.filter((r) => r.holder_value === 'cust-fifo' && r.why === 'expired');
  assert.strictEqual(exp.length, 1, 'the expiry was written ' + exp.length + ' times');
  assert.strictEqual(exp[0].ref, 'B-F1'); assert.strictEqual(exp[0].points, -40);
  assert.strictEqual((await store.balance(SHOP, F, withEntity)).points, 0);
});

await ita('⚠️ ENG-REW1: a spend after expiry — the counter reads 0 and greys the tender (the engine refuses it)', async () => {
  const G = { scheme: 'identity', value: 'cust-gone' };
  put(G, 100, 'earned', 'B-G1', '2024-01-01T00:00:00.000Z');
  const b = await store.balance(SHOP, G, withEntity);
  assert.strictEqual(b.points, 0);
  assert.strictEqual(rewards.canSpend(b, 10).ok, false, 'expired points were spendable');
});

console.log('— the walk-in who registers —');

await ita('⭐⭐ a phone balance moves onto the account as two entries netting to zero', async () => {
  const PH = { scheme: 'phone', value: '9000011111' }, ID = { scheme: 'identity', value: 'cust-new' };
  put(PH, 340, 'earned', 'B-W1');
  const c = await store.claim(SHOP, PH, ID, 'CLAIM-1', PROG, withEntity);
  assert.strictEqual(c.ok, true);
  assert.strictEqual(c.points, 340);
  assert.strictEqual((await store.balance(SHOP, PH, withEntity)).points, 0, 'the phone still holds points');
  assert.strictEqual((await store.balance(SHOP, ID, withEntity)).points, 340, 'the account did not receive them');
});

await ita('⭐⭐ T1-FINREW: a claim is ALL OR NOTHING — a half that cannot land undoes the other half', async () => {
  const PH = { scheme: 'phone', value: '9000022222' }, A = { scheme: 'identity', value: 'cust-a' }, B = { scheme: 'identity', value: 'cust-b' };
  put(PH, 100, 'earned', 'B-W2');
  assert.strictEqual((await store.claim(SHOP, PH, A, 'CLAIM-2', PROG, withEntity)).points, 100);
  put(PH, 70, 'earned', 'B-W3');                                      /* the same phone earns again… */
  const rows = TABLE.length;
  /* …and the SAME ref is used for a second claim onto another account: the phone's minus half meets the unique index */
  await assert.rejects(() => store.claim(SHOP, PH, B, 'CLAIM-2', PROG, withEntity), (e) => e.code === 'CLAIM_RECORDED' && e.status === 409);
  assert.strictEqual(TABLE.length, rows, 'a half of the refused claim was left in the ledger');
  assert.strictEqual((await store.balance(SHOP, B, withEntity)).points, 0, 'points were created on the second account');
  assert.strictEqual((await store.balance(SHOP, PH, withEntity)).points, 70, 'the phone lost points it still holds');
  assert.ok(LOCKS.some((k) => /9000022222/.test(k)) && LOCKS.some((k) => /cust-b/.test(k)), 'both holders are locked for the claim');
});

await ita('⭐ nothing to claim → refused, nothing written', async () => {
  const rows = TABLE.length;
  const c = await store.claim(SHOP, { scheme: 'phone', value: '9000099999' }, { scheme: 'identity', value: 'cust-z' }, 'CLAIM-9', PROG, withEntity);
  assert.strictEqual(c.ok, false); assert.strictEqual(TABLE.length, rows);
});

console.log('— a long-standing customer —');

await ita('⭐⭐ T1-FINREW: 650 entries — the balance is the SUM of all of them, not of the newest 500', async () => {
  const LOYAL = { scheme: 'identity', value: 'cust-loyal' };
  const t0 = Date.now() - 650 * 60000;
  for (let n = 0; n < 650; n++) put(LOYAL, n % 10 === 9 ? -3 : 2, n % 10 === 9 ? 'spent' : 'earned', 'L-' + n, new Date(t0 + n * 60000).toISOString());
  const want = TABLE.filter((r) => r.holder_value === 'cust-loyal').reduce((a, r) => a + r.points, 0);
  const b = await store.balance(SHOP, LOYAL, withEntity);
  assert.strictEqual(want, 585 * 2 - 65 * 3);
  assert.strictEqual(b.points, want, 'got ' + b.points + ', the ledger holds ' + want);
  assert.strictEqual(b.entries.length, store.RECENT, 'the screen gets the newest page only');
  assert.strictEqual(b.entries[0].ref, 'L-649', 'newest first');
  const r = await bill(LOYAL, 'L-SPEND', 0, want);
  assert.strictEqual(r.overspent, 0, 'a spend of the whole (true) balance was called an overspend');
});

console.log('— W2-REW: the points come from the SERVER\'S bill —');

await ita('⭐⭐⭐ REW-T1: the earning is computed from the stored bill — the counter\'s own figure is not an input', async () => {
  const S = { scheme: 'identity', value: 'cust-server' };
  BILLS['S-001'] = { money: { gross: 520, savings: 20, net: 500, tax: 0, total: 500 }, line_items: [{ particulars: 'Rice', quantity: 5, total: 500 }] };
  const prog = await store.programme(SHOP, withEntity);
  /* the route no longer carries net · gross · count · lines: a till that posted ₹100 000 beside this bill would change nothing */
  const r = await store.settle(SHOP, S, prog, { ref: 'S-001', spend: 0, earn: true, net: 100000 }, withEntity);
  assert.strictEqual(r.added, 5, 'got ' + r.added + ' — ₹500 on the server\'s bill earns 5');
  assert.strictEqual((await store.balance(SHOP, S, withEntity)).points, 5);
});

await ita('⚠️ a bill the server does not hold earns nothing and is REFUSED with a code — nothing written, the spend included', async () => {
  const S = { scheme: 'identity', value: 'cust-server' };
  const rows = TABLE.length;
  const prog = await store.programme(SHOP, withEntity);
  await assert.rejects(() => store.settle(SHOP, S, prog, { ref: 'S-NOWHERE', spend: 2, earn: true }, withEntity),
                       (e) => e.code === 'BILL_NOT_RECORDED' && e.status === 409 && /S-NOWHERE/.test(e.say));
  assert.strictEqual(TABLE.length, rows, 'a refused bill wrote to the ledger');
});

await ita('⚠️ the same number at ANOTHER moment is another counter\'s bill (the /reconcile verdict) — refused, not earned from', async () => {
  const S = { scheme: 'identity', value: 'cust-server' };
  BILLS['C1/26-27/0041'] = { at: '2026-10-15T09:00:00.000Z', money: { total: 9000 }, line_items: [] };
  const prog = await store.programme(SHOP, withEntity);
  await assert.rejects(() => store.settle(SHOP, S, prog, { ref: 'C1/26-27/0041', spend: 0, earn: true, at: '2026-10-15T09:05:00.000Z' }, withEntity),
                       (e) => e.code === 'BILL_NOT_RECORDED');
  const r = await store.settle(SHOP, S, prog, { ref: 'C1/26-27/0041', spend: 0, earn: true, at: '2026-10-15T09:00:00.000Z' }, withEntity);
  assert.strictEqual(r.added, 90, 'the same moment is this counter\'s bill');
});

await ita('⭐⭐ an on_items rule reaches the lines through the server\'s catalogue and category master, by the OFFERS engine\'s scope test', async () => {
  const S = { scheme: 'identity', value: 'cust-items' };
  const ON = Object.assign({}, PROG, { earn: { kind: 'on_items', points: 200, applies_to: { category: 'Personal care' } } });
  BILLS['S-CAT'] = { money: { total: 640 }, line_items: [
    { particulars: 'Shampoo', quantity: 2, total: 400, item_id: 'a1a1a1a1-0000-4000-8000-000000000001' },
    { particulars: 'Rice', quantity: 3, total: 240, item_id: 'a1a1a1a1-0000-4000-8000-000000000002' }] };
  const r = await store.settle(SHOP, S, ON, { ref: 'S-CAT', spend: 0, earn: true }, withEntity);
  assert.strictEqual(r.added, 400, 'got ' + r.added + ' — two shampoos at 200 each; the rice is Grocery');
  const BYSKU = Object.assign({}, PROG, { earn: { kind: 'on_items', points: 50, applies_to: { skus: ['RC-1'] } } });
  BILLS['S-SKU'] = BILLS['S-CAT'];
  assert.strictEqual((await store.settle(SHOP, S, BYSKU, { ref: 'S-SKU', spend: 0, earn: true }, withEntity)).added, 150, 'three rice by sku');
});

await ita('⚠️ earn:false (the shop said walk-ins do not earn) reads no bill and writes no earning', async () => {
  const PH = { scheme: 'phone', value: '9000077777' };
  const prog = await store.programme(SHOP, withEntity);
  const r = await store.settle(SHOP, PH, prog, { ref: 'S-NOWHERE-2', spend: 0, earn: false }, withEntity);
  assert.strictEqual(r.added, 0);
});

console.log('— what the ledger will not let anyone do —');

await ita('⚠️⚠️ nothing corrects a balance by editing a row', async () => {
  await assert.rejects(
    () => withEntity(SHOP, (db) => db.query('UPDATE reward_ledger SET points = 0 WHERE ref = $1', ['B-002'])),
    /append-only/, 'an UPDATE against the ledger was allowed');
});

it('⭐ and every row that was ever written is still there', () => {
  assert.ok(TABLE.length >= 25, 'only ' + TABLE.length + ' rows — something removed history');
  assert.ok(TABLE.every((r) => r.points !== 0), 'a zero entry records nothing and should never have been written');
});

/* ⭐ W2-REW (REW-T1): the points are earned from the SERVER'S bill — lib/counter-bill picks what was paid and shapes the basket, never a sum here */
it('counter-bill paidOf: money.total, else money.net, else total_value — one pick', () => {
  assert.strictEqual(counterBill.paidOf({ money: { total: 1180, net: 1000 }, total_value: 5 }), 1180);
  assert.strictEqual(counterBill.paidOf({ money: { net: 1000 } }), 1000);
  assert.strictEqual(counterBill.paidOf({ total_value: 7 }), 7);
  assert.strictEqual(counterBill.paidOf(null), undefined);
});
it('counter-bill basketOf: net from the pick, gross from money, the lines with the shop\'s own sku and category, nothing summed', () => {
  const bill = { summary_json: { money: { total: 1180, gross: 1300 } }, line_items: [{ item_id: 'a1', quantity: 2, total: 600 }, { quantity: 1, total: 580 }] };
  const basket = counterBill.basketOf(bill, new Map([['a1', { sku: 'SKU-1', category: 'Snacks' }]]));
  assert.deepStrictEqual(basket, { net: 1180, gross: 1300, count: 2, lines: [
    { item_id: 'a1', qty: 2, net: 600, sku: 'SKU-1', category: 'Snacks' }, { item_id: null, qty: 1, net: 580, sku: null, category: null }] });
  assert.deepStrictEqual(counterBill.basketOf(null, null), { net: 0, gross: 0, count: 0, lines: [] });
});

console.log(pass + ' checks');
})();
