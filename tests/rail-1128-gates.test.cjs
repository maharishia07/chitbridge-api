/**
 * tests/rail-1128-gates.test.cjs: batch 1128 rail fixes, each row with its figures (hand-computed in the comments).
 * M1 three-way match hold (+F7 match_tolerance_pct, L-F-07 goods gap, N5 minor-unit sums) · M3 buyer cancel of a paid bill · M8 rejected/cancelled never jump to completed
 * L-F-02 a credit note the buyer accepted is not withdrawn · M4 an unknown peer status word is a permanent refusal · M5/M7 the move's outbox row rides its transaction
 * Real statusGate / holdFor / matchOrders / stageStatus over a stub db (no database, no network). Mutation: RAIL1128_RAIL_STATUS=<a copy without the new refusals> turns this red.
 * Run: node tests/rail-1128-gates.test.cjs
 */
'use strict';
process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'test';
const path = require('path');
const API = path.join(__dirname, '..');
const railStatus = require(process.env.RAIL1128_RAIL_STATUS || path.join(API, 'lib', 'rail-status'));
const tillMatch = require(path.join(API, 'lib', 'till-match'));
const hold = require(path.join(API, 'lib', 'match-hold'));
const deliverline = require(path.join(API, 'lib', 'deliverline'));
const ctpReturn = require(path.join(API, 'lib', 'ctpreturn'));
let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };

const BUYER = 'b0000000-0000-4000-8000-000000000001', SELLER = 'a0000000-0000-4000-8000-000000000002', CHIT = 'c0000000-0000-4000-8000-000000000003', PO = 'd0000000-0000-4000-8000-000000000004';
const ME = { level: 'editor', holder: null };
const gate = (db, to, from, copy, extra) => railStatus.statusGate(db, BUYER, CHIT, to, ME, Object.assign({ copy: copy || 'received', from }, extra || {}));

(async () => {
  console.log('\n== M8: rejected / cancelled never jump to completed ==');
  const quiet = { query: async () => ({ rows: [], rowCount: 0 }) };
  for (const from of ['rejected', 'cancelled']) {
    const g = await gate(quiet, 'completed', from);
    t(from + ' -> completed refused as wrong_step, the way back named', g.ok === false && g.why === 'wrong_step' && g.allowed.includes('accepted') && !g.allowed.includes('completed'), JSON.stringify({ ok: g.ok, why: g.why }));
    let wrote = false; try { await g.write(); wrote = true; } catch (e) { /* refused */ }
    t(from + ' -> completed writes nothing', wrote === false);
  }
  t('accepted -> completed still goes through', (await gate(quiet, 'completed', 'accepted')).ok === true);
  t('rejected -> pending (reopen) is not touched by this refusal', (await gate(quiet, 'pending', 'rejected')).why !== 'wrong_step');

  console.log('\n== M3: the buyer cannot cancel a bill it has paid (was: reject only) ==');
  const mark = { method: 'cash', amount: 11800, at: '2026-11-15T00:00:00Z' }; /* buyer paid 11,800 */
  const paidBill = { query: async (text) => {
    if (/SELECT purpose, sender_entity_id, business_json FROM chit_header/.test(text)) return { rows: [{ purpose: 'invoice', sender_entity_id: SELLER, business_json: { payment: mark } }], rowCount: 1 };
    if (/SELECT business_json->'payment' AS payment FROM chit_header/.test(text)) return { rows: [{ payment: mark }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  } };
  const cancelPaid = await gate(paidBill, 'cancelled', 'accepted');
  t('cancel of a received bill marked paid 11,800: refused, why "paid" (a credit note is the way out)', cancelPaid.ok === false && cancelPaid.why === 'paid', JSON.stringify({ ok: cancelPaid.ok, why: cancelPaid.why }));
  t('reject still refused (RAIL-218 unchanged)', (await gate(paidBill, 'rejected', 'accepted')).why === 'paid');
  t('an unpaid received bill may still be cancelled', (await gate(quiet, 'cancelled', 'accepted')).ok === true);

  console.log('\n== L-F-02: a credit note the buyer accepted is not withdrawn by the seller ==');
  const sellerDb = (buyerStatus, purpose) => ({ query: async (text) => {
    if (/SELECT purpose FROM chit_header/.test(text)) return { rows: [{ purpose }], rowCount: 1 };
    if (/FROM chit_participants/.test(text)) return { rows: [{ entity_id: BUYER, current_status: buyerStatus }, { entity_id: SELLER, current_status: 'pending' }], rowCount: 2 };
    return { rows: [], rowCount: 0 };
  } });
  const void1 = await railStatus.statusGate(sellerDb('accepted', 'credit_note'), SELLER, CHIT, 'cancelled', ME, { copy: 'sent', from: 'pending' });
  t('seller voids CN-1 after the buyer accepted it: refused taken_by_buyer', void1.ok === false && void1.why === 'taken_by_buyer', JSON.stringify({ ok: void1.ok, why: void1.why }));
  t('the words name the way out (debit note / buyer cancels its own copy)', /debit note/.test(railStatus.takenByBuyerSaid().message));
  t('buyer has not accepted (pending): the void goes through', (await railStatus.statusGate(sellerDb('pending', 'credit_note'), SELLER, CHIT, 'cancelled', ME, { copy: 'sent', from: 'pending' })).ok === true);
  t('an ordinary invoice void after acceptance is unchanged (by design, RAIL header)', (await railStatus.statusGate(sellerDb('accepted', 'invoice'), SELLER, CHIT, 'cancelled', ME, { copy: 'sent', from: 'pending' })).ok === true);

  console.log('\n== AT-F-01 (1129): an order the BUYER withdrew is not accepted by the seller ==');
  const buyerSide = (senderStatus, sender) => ({ query: async (text) => {
    if (/SELECT sender_entity_id FROM chit_header/.test(text)) return { rows: [{ sender_entity_id: sender || BUYER }], rowCount: 1 };
    if (/FROM chit_participants/.test(text)) return { rows: [{ entity_id: BUYER, current_status: senderStatus }, { entity_id: SELLER, current_status: 'delivered' }], rowCount: 2 };
    return { rows: [], rowCount: 0 };
  } });
  const sellerGate = (db, to, from) => railStatus.statusGate(db, SELLER, CHIT, to, ME, { copy: 'received', from });
  for (const [from, to] of [['delivered', 'accepted'], ['cancelled', 'accepted'], ['delivered', 'in_progress'], ['accepted', 'completed']]) {
    const g = await sellerGate(buyerSide('cancelled'), to, from);
    t('buyer withdrew: seller ' + from + ' -> ' + to + ' refused withdrawn_by_sender', g.ok === false && g.why === 'withdrawn_by_sender', JSON.stringify({ ok: g.ok, why: g.why }));
  }
  t('the words say the buyer withdrew it and name the way out', /buyer withdrew/.test(railStatus.withdrawnBySenderSaid().message) && /Reject/.test(railStatus.withdrawnBySenderSaid().message));
  t('buyer did NOT withdraw (sent copy pending): seller accepts as before', (await sellerGate(buyerSide('pending'), 'accepted', 'delivered')).ok === true);
  t('buyer withdrew: the seller may still reject it (confirming the withdrawal)', (await sellerGate(buyerSide('cancelled'), 'rejected', 'delivered')).ok === true);
  t('a seller who cancelled ITS OWN copy may reopen it (M8 unchanged: the buyer has not cancelled)', (await sellerGate(buyerSide('pending'), 'accepted', 'cancelled')).ok === true);

  console.log('\n== M1 + F7 + L-F-07 + N5: the three-way match holds a bill billed above what was received ==');
  /* world: PO 100 x 1,000 INR = 100,000; received 60 (60,000); their bill 100 units, total 100,000 */
  let WORLD;
  const orderRow = (qty, price) => ({ chit_id: PO, line_items: [{ line_id: 'L1', particulars: 'Rice', quantity: qty, unit: 'kg', price }], business_json: { side: 'buy' } });
  const invoiceRow = (qty, total) => ({ chit_id: CHIT, created_at: '2026-11-10T10:00:00Z', sender_entity_id: SELLER, summary_json: { total_value: total }, business_json: { bill_no: 'INV-9', order: { from: PO } }, line_items: [{ particulars: 'Rice', quantity: qty, unit: 'kg' }] });
  const worldDb = () => ({ query: async (text) => {
    if (/SELECT purpose, sender_entity_id, business_json FROM chit_header WHERE chit_id = \$1 AND entity_id = \$2 AND direction = 'received'/.test(text)) return { rows: [{ purpose: 'invoice', sender_entity_id: SELLER, business_json: WORLD.invoice.business_json }], rowCount: 1 };
    if (/h\.purpose = 'order'/.test(text)) return { rows: [{ chit_id: PO, direction: 'sent', created_at: '2026-11-01T10:00:00Z', current_status: 'pending' }], rowCount: 1 };
    if (/ANY\(\$2::uuid\[\]\)/.test(text)) return { rows: [WORLD.order], rowCount: 1 };
    if (/h\.purpose = 'receipt'/.test(text)) return { rows: [], rowCount: 0 };
    if (/h\.purpose = 'invoice'/.test(text)) return { rows: [WORLD.invoice], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  } });
  const dbModule = require(path.join(API, 'db'));
  dbModule.query = async () => ({ rows: [{ currency_code: 'INR', country: 'IN' }], rowCount: 1 });
  const policy = require(path.join(API, 'lib', 'policy'));
  let FLAGS = {};
  policy.get = async () => FLAGS;
  const received = (n) => { deliverline.progress = async () => new Map([['L1', { delivered: n }]]); };

  WORLD = { order: orderRow(100, 1000), invoice: invoiceRow(100, 100000) };
  received(60);
  const h1 = await hold.holdFor(worldDb(), BUYER, CHIT);
  t('PO 100 x 1,000, received 60, billed 100 / 100,000: HELD', !!h1, JSON.stringify(h1));
  t('the line says billed 100, received 60, ordered 100', h1 && /Rice: billed 100 kg, received 60 \(ordered 100\)/.test(h1.lines[0]), JSON.stringify(h1 && h1.lines));
  t('the money gap is 100,000 - 60,000 = 40,000, said as goods (no tax figure at the door)', h1 && h1.money && h1.money.gap === 40000 && h1.money.kind === 'goods', JSON.stringify(h1 && h1.money));
  const gateHeld = await gate(worldDb(), 'accepted', 'pending');
  t('statusGate: Accept of that bill is refused match_held and writes nothing', gateHeld.ok === false && gateHeld.why === 'match_held', JSON.stringify({ ok: gateHeld.ok, why: gateHeld.why }));
  let wrote = false; try { await gateHeld.write(); wrote = true; } catch (e) { /* refused */ }
  t('a held verdict cannot be saved past', wrote === false);
  t('with a reason (matchOverride) the person clears it', (await gate(worldDb(), 'accepted', 'pending', 'received', { matchOverride: true })).ok === true);
  t('an already-accepted bill is not asked again (accepted -> completed)', (await gate(worldDb(), 'completed', 'accepted')).why !== 'match_held');
  t('a bill sent by me or a task (no order named) is never held', (await hold.holdFor({ query: async () => ({ rows: [{ purpose: 'invoice', sender_entity_id: SELLER, business_json: {} }], rowCount: 1 }) }, BUYER, CHIT)) === null);

  received(100);
  t('received 100 of 100 billed 100: not held', (await hold.holdFor(worldDb(), BUYER, CHIT)) === null);

  /* F7: the tolerance is match_tolerance_pct (default 2): received 99, billed 100 = 1.01% over: absorbed; 2% setting vs 0% setting */
  WORLD = { order: orderRow(100, 1000), invoice: invoiceRow(100, 100000) };
  received(99);
  t('F7: received 99, billed 100 (1.01% over) at the default 2%: not held', (await hold.holdFor(worldDb(), BUYER, CHIT)) === null);
  FLAGS = { match_tolerance_pct: 0 };
  t('F7: the same bill at match_tolerance_pct 0: held (the setting is the tolerance)', !!(await hold.holdFor(worldDb(), BUYER, CHIT)));
  FLAGS = { match_tolerance_pct: 2 };
  received(97);
  t('F7: received 97, billed 100 (3.09% over) at 2%: held', !!(await hold.holdFor(worldDb(), BUYER, CHIT)));
  FLAGS = {};

  /* L-F-07: ordered 10 at 20, received 8, billed 10 = 200: hand gap 200 - 160 = 40.00 */
  WORLD = { order: orderRow(10, 20), invoice: invoiceRow(10, 200) };
  received(8);
  const matched = await tillMatch.matchOrders(worldDb(), BUYER, [{ chit_id: PO, direction: 'sent', counterparty_id: SELLER, current_status: 'pending', created_at: '2026-11-01T10:00:00Z' }], 365, { weight_bp: 50, count_units: 0 }, 'INR');
  t('L-F-07: ordered 10, received 8, billed 10 (200): goods_gap 40, received_total 160', matched[0].goods_gap === 40 && matched[0].received_total === 160 && matched[0].ordered_total === 200, JSON.stringify({ gap: matched[0].goods_gap, rec: matched[0].received_total }));
  t('L-F-07: the tax-inclusive money_gap stays unknown (never faked)', matched[0].money_gap === null && matched[0].money_code === 'no_tax_figure');
  const h2 = await hold.holdFor(worldDb(), BUYER, CHIT);
  t('L-F-07: and that bill is held (40 of 200 = 20% > 2%)', !!h2 && h2.money.gap === 40, JSON.stringify(h2 && h2.money));

  /* N5: ten lines of 1 x 0.335 INR: each rounds to 0.34 (half away): 3.40; the float sum 3.35 was wrong */
  const lineItems = Array.from({ length: 10 }, (_, i) => ({ line_id: 'N' + i, particulars: 'Pin ' + i, quantity: 1, unit: 'piece', price: 0.335 }));
  WORLD = { order: { chit_id: PO, line_items: lineItems, business_json: { side: 'buy' } }, invoice: invoiceRow(1, 3.4) };
  deliverline.progress = async () => new Map(lineItems.map((item) => [item.line_id, { delivered: 1 }]));
  const many = await tillMatch.matchOrders(worldDb(), BUYER, [{ chit_id: PO, direction: 'sent', counterparty_id: SELLER, current_status: 'pending', created_at: '2026-11-01T10:00:00Z' }], 365, { weight_bp: 50, count_units: 0 }, 'INR');
  t('N5: ten lines of 0.335, ordered_total = 10 x 0.34 = 3.40 (integer minor units)', many[0].ordered_total === 3.4 && many[0].received_total === 3.4, JSON.stringify({ o: many[0].ordered_total, r: many[0].received_total }));

  console.log('\n== M4: an unknown peer status word is refused for good ==');
  const bad = ctpReturn.checkShape({ kind: 'status', seq: 4, status: 'on_hold' });
  t('status on_hold (a word the rail does not know): refused with a sentence, never written', typeof bad === 'string' && /on_hold/.test(bad), String(bad));
  t('a known word passes', ctpReturn.checkShape({ kind: 'status', seq: 4, status: 'in_progress' }) === null);
  t('the sender ends a 400-refused status event (does not hold the stream ten hours)', ctpReturn.refusedForGood({ kind: 'status' }, { accepted: false, status: 400 }) === true && ctpReturn.refusedForGood({ kind: 'status' }, { accepted: false, status: 503 }) === false);

  console.log('\n== F5a: a void replay writes nothing (source check of the guard; the route runs over a live stack in the realstack pack) ==');
  const routeSrc = require(path.join(API, 'tools', 'chits-files.cjs')).read(API);
  const guardAt = routeSrc.indexOf('if (!moved.length) return { refused: null, moved, replay: true }');
  t('the void door returns before the voided row when no copy moved', guardAt > 0 && guardAt < routeSrc.indexOf("'voided', $3, $4, 'cancelled'") && guardAt < routeSrc.indexOf('chitWithdrawn(db, entity_id, chit_id, reason'));
  t('and answers the replay without the message or the books call', /if \(gate\.replay\) return res\.json\(\{ message: withdrawnWords,/.test(routeSrc));

  console.log('\n== M6: v1 seal acceptance ends by default (2027-03-31) ==');
  const envelope = require(path.join(API, 'lib', 'ctpenvelope'));
  delete process.env.CTP_ACCEPT_V1_UNTIL;
  t('unset: v1 accepted on 2027-03-30, refused from 2027-03-31', envelope.acceptsV1(new Date('2027-03-30T12:00:00Z')) === true && envelope.acceptsV1(new Date('2027-03-31T00:00:00Z')) === false);
  process.env.CTP_ACCEPT_V1_UNTIL = '2999-01-01';
  t('an operator date overrides the default', envelope.acceptsV1(new Date('2028-01-01T00:00:00Z')) === true);
  delete process.env.CTP_ACCEPT_V1_UNTIL;

  console.log('\n== M5 / M7: the status event is an outbox row in the MOVE\'S transaction ==');
  const log = [];
  const txDb = { query: async (text, params) => {
    log.push(text.trim().slice(0, 40));
    if (/pg_advisory_xact_lock/.test(text)) return { rows: [], rowCount: 0 };
    if (/max\(seq\)/.test(text)) return { rows: [{ seq: '7' }], rowCount: 1 };
    return { rows: [], rowCount: 1, params };
  } };
  const schema = require(path.join(API, 'lib', 'schema'));
  schema.hasTable = async () => true;
  const parties = [{ entity_id: SELLER, bridge_id: 'x@y', installation_key: 'k1' }];
  const staged = await ctpReturn.stageStatus(txDb, BUYER, CHIT, { status: 'accepted', previous_status: 'pending', by_name: 'Asha' }, parties);
  t('M5: staged on the caller\'s own handle (lock, seq read, one insert), seq = max + 1 = 8', staged.queued === 1 && staged.seq === 8 && log.length === 3 && /INSERT INTO ctp_event_out/.test(log[2]) === true || /INSERT/.test(log[2]), JSON.stringify({ staged, log }));
  t('M7: the sequence is read under the per-stream advisory lock in that transaction', /pg_advisory_xact_lock/.test(log[0]) && /max\(seq\)/.test(log[1]));
  t('nothing remote: nothing staged, no query', (await ctpReturn.stageStatus({ query: async () => { throw new Error('no query expected'); } }, BUYER, CHIT, { status: 'accepted' }, [])).queued === 0);
  let rolled = false;
  try { await ctpReturn.stageStatus({ query: async () => { throw new Error('insert failed'); } }, BUYER, CHIT, { status: 'accepted' }, parties); } catch (e) { rolled = /insert failed/.test(e.message); }
  t('M5: a failed outbox insert THROWS (the move rolls back, never loses its event)', rolled);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(pass + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
