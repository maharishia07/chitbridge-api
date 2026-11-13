'use strict';
/**
 * tests/books-payment-gorilla-truth.realstack.cjs — GORILLA PACK 3: POST /api/books/payments, hammered (docs/api/COLUMN-13-ADDS-UP.md
 * §4a, third in its order; row ADDS-MONEY-2).
 *
 * owns: the payments a shop records against a party in its books, the bills they settle, and the checks every one must pass. The
 *       generator is tests/lib/gorilla.cjs; the doors, the case runner and the fresh shop are tests/lib/truth-harness.cjs; the buyer on
 *       the rail and its open bills are tests/lib/rail-buyer.cjs. Pack 2 (payment-gorilla) is the pattern.
 * FLOW  fresh shop, books on, 6 products, and one OTHER buyer with a bill open (whose bill no payment of mine may touch) → per record:
 *       before() makes the party to pay (a fresh buyer on the rail with 1–3 invoices open in the books · or none: a party on neither
 *       list · a party id that is no id) → send() records the payment (sometimes twice) → reads books_payment and party_item back
 *       → GB-1..GB-11 graded over every record → one case each
 * CARD 01-rail-core-the-chit/README
 *
 * What a record varies: 1–3 bills of 1–3 lines; the payment: the whole of what is owed · a part · more than owed (acknowledged as an
 * advance, or not) · on account (allocate none) · named bills (each in full, or half of each) · a cheque · paid OUT to the customer ·
 * and what the contract or the books refuse: no party · a party that is no id · a stranger · NaN / zero / negative / a word for the
 * amount · no mode · a mode the books do not know · a direction that is neither in nor out · another currency · a date that is no day
 * (2026-02-30) · a future date · a date before the ledger began · a named bill of the OTHER buyer · a bill ref that is no bill ·
 * allocations adding up to more than the payment · more than a bill's open amount · a cheque naming bills; and a second payment:
 * the same one again (a replay of its client_ref) · the same amount on a new ref (the duplicate rule) · the same, acknowledged.
 *
 * What every record must do (ADDS-MONEY-2: a payment is a whole positive amount, dated, from a party on my list; what it settles never
 * exceeds what is open; the payment, its entry and what it settles are ONE transaction):
 *   GB-1  never a 500: recorded, or refused with a sentence
 *   GB-2  a body the contract refuses (party, amount, mode) is a 400, and the books hold nothing for it
 *   GB-3  another currency · a stranger · a date that is no day, in the future or before the ledger: a 4xx in words, nothing recorded
 *   GB-4  a valid payment is recorded ONCE: 200, status recorded (a cheque: cheque_received), one books_payment row with the amount
 *         in paise, the direction and the mode it was sent with
 *   GB-5  the money adds up: applied + on account = the payment, and what party_item settles for it is exactly what it applied
 *         (a held cheque posts nothing until it clears: 0 + 0, nothing settled)
 *   GB-6  no bill is settled beyond what it was; and the whole of what is owed, oldest first, settles every bill exactly
 *   GB-7  an allocation the books may not make (the other buyer's bill · no such bill · more than the payment · more than a bill ·
 *         a cheque naming bills) is refused in words, and NOTHING is recorded — the payment rolls back with it
 *   GB-8  the other buyer's bill is never touched by any payment of mine
 *   GB-9  the same client_ref again answers 200 duplicate: true with the FIRST payment, and the books still hold one
 *   GB-10 the duplicate rule: more than owed, not acknowledged · the same amount on a new ref — a 409 ALREADY_PAID that writes
 *         nothing; acknowledged, it is recorded
 *   GB-11 gap FIN-54 · a direction that is neither in nor out is refused, never read as "in". TODAY routes/books.js paymentQuestion
 *         reads anything but 'out' as 'in' ("both", "sideways", "" are recorded as money in). RECORDED so the fix turns it green.
 *
 * Fixed seed 20261031 · budget 240 s · GORILLA_N (default 200) · GORILLA_SEED=<n>|random · GORILLA_ONLY=<i> replays one.
 * Run: node tests/books-payment-gorilla-truth.realstack.cjs
 * ⚠️ LOCAL ONLY (the harness refuses anything else). Writes go through the routes; the database is only SELECTed.
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
/* ACC-198: tax registration is never assumed - an unknown shop's sales wait with the question; these shops sell untaxed, so they SAY not registered */
const NOT_REGISTERED = { tax: { registered: false } };
const G = require('./lib/gorilla.cjs');
const R = require('./lib/rail-buyer.cjs');
const { DB, j, ok, kase, freshShop, finish } = H;
const { textOf } = R;

/* the run tag names the fresh SHOPS only (the world); nothing in a record reads it */
const RUN = 'gb' + (Date.now() % 1e10).toString(36);
const FIXED_SEED = 20261031;
const BILLED_FROM = Date.parse('2026-10-29T06:00:00Z');
const cents = (value) => Math.round(Number(value) * 100);
const round2 = (value) => Math.round(value * 100) / 100;

const MODES = ['cash', 'bank', 'upi', 'card'];
const VALID = ['whole', 'whole', 'part', 'overAck', 'onAccount', 'namedFull', 'namedHalf', 'cheque', 'out'];
const CONTRACT = ['noParty', 'badParty', 'nan', 'zero', 'negative', 'word', 'noMode', 'badMode'];
const WORDS = ['currency', 'stranger', 'notADay', 'future', 'beforeLedger'];
const ALLOCATION = ['theirBill', 'unknownRef', 'sumOver', 'billOver', 'chequeNamed'];
const KINDS = [...VALID, ...VALID, ...CONTRACT, ...WORDS, ...ALLOCATION, 'overNoAck', 'direction'];
const AGAIN = ['replay', 'same', 'sameAck'];
const ACK_ALL = ['same_again', 'just_settled', 'excess', 'nothing_owed'];
const NO_PARTY = new Set(['noParty', 'badParty', 'stranger']);

/** one seeded record: the bills, the payment (amounts as shares of what is owed; the refs are the world's), maybe a second payment */
function makeRecord(products) {
  return (h, index) => {
    const bills = Array.from({ length: h.int(1, 3) }, () =>
      Array.from({ length: h.int(1, 3) }, () => {
        const product = h.pick(products);
        const quantity = h.int(1, 5);
        return { particulars: product.name, quantity, unit: 'piece', price: product.price, total: round2(quantity * product.price), item_id: product.id };
      }));
    const kind = h.pick(KINDS);
    const mode = kind === 'cheque' || kind === 'chequeNamed' ? 'cheque' : h.pick(MODES);
    const again = VALID.indexOf(kind) >= 0 && kind !== 'overAck' && h.chance(0.35) ? h.pick(AGAIN) : null;
    return { index, kind, bills, mode, reference: h.chance(0.5) ? 'UTR' + (500000 + index) : null, odd: h.chance(0.15), again,
      word: h.pick(['fifty', '12,50', '₹100', '1 0']), badMode: h.pick(['crypto', 'UPI ', 'barter', '']), direction: h.pick(['sideways', 'IN', 'both', '']) };
  };
}

/** the body for a record against its world (party · bills open · the other buyer's bill) */
function bodyOf(record, made, other) {
  const owed = made.bills.reduce((sum, bill) => sum + bill.minor, 0);
  const body = { party_id: made.party, direction: 'in', amount_minor: owed, currency: 'INR', mode: record.mode, allocate: 'oldest_first', client_ref: 'bp-' + record.index };
  if (record.reference) body.reference = record.reference + (record.odd ? ' नकद 💵' : '');
  const named = (share) => made.bills.map((bill) => ({ against_ref: bill.ref, amount_minor: Math.round(bill.minor * share) }));
  const k = record.kind;
  if (k === 'part') body.amount_minor = Math.round(owed * 0.4);
  if (k === 'overAck' || k === 'overNoAck') body.amount_minor = owed + 10000;
  if (k === 'overAck') body.acknowledge = ['excess'];
  if (k === 'onAccount') body.allocate = 'none';
  if (k === 'namedFull' || k === 'namedHalf') {
    delete body.allocate;
    body.allocations = named(k === 'namedFull' ? 1 : 0.5);
    body.amount_minor = body.allocations.reduce((sum, item) => sum + item.amount_minor, 0);
  }
  if (k === 'cheque') Object.assign(body, { allocate: 'none', cheque: { number: String(100000 + record.index), bank: 'SBI', date: '2026-10-29' } });
  if (k === 'out') Object.assign(body, { direction: 'out', allocate: 'none', amount_minor: Math.round(owed * 0.1) || 100 });
  if (k === 'noParty') delete body.party_id;
  if (k === 'badParty') body.party_id = 'not-a-party-' + record.index;
  if (k === 'nan') body.amount_minor = 'NaN';
  if (k === 'zero') body.amount_minor = 0;
  if (k === 'negative') body.amount_minor = -owed;
  if (k === 'word') { delete body.amount_minor; body.amount = record.word; }
  if (k === 'noMode') delete body.mode;
  if (k === 'badMode') body.mode = record.badMode;
  if (k === 'direction') body.direction = record.direction;
  if (k === 'currency') body.currency = 'USD';
  if (k === 'notADay') body.received_at = '2026-02-30';
  if (k === 'future') body.received_at = '2099-01-01';
  if (k === 'beforeLedger') body.received_at = '2001-04-01';
  if (k === 'theirBill') { delete body.allocate; body.allocations = [{ against_ref: other.ref, amount_minor: Math.min(owed, other.minor) }]; }
  if (k === 'unknownRef') { delete body.allocate; body.allocations = [{ against_ref: 'INV-NO-SUCH-' + record.index, amount_minor: owed }]; }
  if (k === 'sumOver') { delete body.allocate; body.allocations = named(1); body.amount_minor = Math.max(1, owed - 100); }
  if (k === 'billOver') { delete body.allocate; body.allocations = [{ against_ref: made.bills[0].ref, amount_minor: made.bills[0].minor + 100 }]; body.amount_minor = owed + 100; body.acknowledge = ['excess']; }
  if (k === 'chequeNamed') { delete body.allocate; body.allocations = named(1); }
  return body;
}

/** the second payment, if any */
function secondOf(record, body) {
  if (record.again === 'replay') return Object.assign({}, body);
  const same = Object.assign({}, body, { client_ref: body.client_ref + '-b', allocate: 'none' });
  delete same.allocations;
  return record.again === 'sameAck' ? Object.assign(same, { acknowledge: ACK_ALL }) : same;
}

/** before each record: the party it pays and that party's bills, open in my books */
function partyMaker(shop, pg) {
  return async (record) => {
    if (record.kind === 'noParty' || record.kind === 'badParty') return { party: null, bills: [{ ref: null, minor: 10000 }] };
    if (record.kind === 'stranger') return { party: '00000000-0000-4000-8000-' + String(300000000000 + record.index), bills: [{ ref: null, minor: 10000 }] };
    const { buyer, party } = await R.buyerOnRail(shop, RUN + 'b' + record.index, 'Gorilla Payer');
    for (const [at, lines] of record.bills.entries()) {
      const no = 'B' + record.index + '-' + at;
      await R.invoiceTo(shop, buyer, { no, billedAt: new Date(BILLED_FROM + record.index * 1000 + at).toISOString(), lines });
    }
    const bills = await R.openBills(pg, shop.entity, party, record.bills.length);
    if (!bills) throw new Error('the invoices never opened in the books (fewer than ' + record.bills.length + ' party_item bill rows in 3 s)');
    return { party, bills };
  };
}

/** what the books hold for one party: its payments, and what each of its bills has had settled */
async function booksOf(pg, entity, party, bills) {
  if (!party) return { payments: [], settled: {} };
  const paid = await pg.query('SELECT payment_id, client_ref, direction, mode, amount_minor FROM books_payment WHERE entity_id = $1 AND party_id = $2', [entity, party]);
  const refs = bills.map((bill) => bill.ref);
  const done = await pg.query("SELECT against_ref, ref, ABS(amount_minor) AS minor FROM party_item WHERE entity_id = $1 AND ref_kind = 'allocation' AND against_ref = ANY($2) AND ref <> against_ref", [entity, refs]);
  const settled = {};
  for (const row of done.rows) settled[row.against_ref] = (settled[row.against_ref] || 0) + Number(row.minor);
  const byPayment = {};
  for (const row of done.rows) byPayment[row.ref] = (byPayment[row.ref] || 0) + Number(row.minor);
  return { payments: paid.rows.map((row) => ({ id: row.payment_id, key: row.client_ref, direction: row.direction, mode: row.mode, minor: Number(row.amount_minor) })), settled, byPayment };
}

/** record the payment (and maybe again), then read what the books hold */
function recorder(shop, pg, other) {
  return async (record, index, made) => {
    const body = bodyOf(record, made, other);
    const first = await j('/api/books/payments', { method: 'POST', token: shop.token, body });
    const seen = { status: first.status, said: textOf(first.b), body: first.b, sent: body, bills: made.bills };
    if (record.again && first.status === 200) {
      seen.second = secondOf(record, body);
      const again = await j('/api/books/payments', { method: 'POST', token: shop.token, body: seen.second });
      Object.assign(seen, { againStatus: again.status, againSaid: textOf(again.b), againBody: again.b });
    }
    Object.assign(seen, await booksOf(pg, shop.entity, made.party, made.bills));
    const theirs = await pg.query("SELECT COALESCE(SUM(ABS(amount_minor)), 0) AS minor FROM party_item WHERE entity_id = $1 AND ref_kind = 'allocation' AND against_ref = $2 AND ref <> against_ref", [shop.entity, other.ref]);
    seen.theirsSettled = Number(theirs.rows[0].minor);
    return seen;
  };
}

const VALID_SET = new Set(VALID);
const recorded = (seen) => seen.status === 200 && seen.body && seen.body.payment && !seen.body.payment.duplicate;
const firstOf = (seen) => seen.payments.filter((pay) => pay.key === seen.sent.client_ref);
const said = (seen) => (seen.said ? ' "' + seen.said.slice(0, 80) + '"' : '');

const CHECKS = [
  { id: 'GB-1', title: 'never a 500: every payment is recorded, or refused with a sentence', check: (record, seen) => {
    if (seen.thrown) return 'the call threw: ' + seen.thrown;
    for (const [status, words] of [[seen.status, seen.said], [seen.againStatus, seen.againSaid]]) {
      if (status === undefined) continue;
      if (status >= 500) return record.kind + ': HTTP ' + status + (words ? ' "' + words.slice(0, 80) + '"' : '');
      if (status >= 400 && !words) return record.kind + ': HTTP ' + status + ' with no sentence';
    }
    return null;
  } },
  { id: 'GB-2', title: 'a body the contract refuses (party, amount, mode) is a 400, and the books hold nothing for it', check: (record, seen) => {
    if (seen.thrown || CONTRACT.indexOf(record.kind) < 0) return null;
    if (seen.status !== 400) return record.kind + ' answered HTTP ' + seen.status + said(seen);
    return seen.payments.length ? record.kind + ': refused, but the books hold ' + seen.payments.length + ' payment(s)' : null;
  } },
  { id: 'GB-3', title: 'another currency, a stranger, a date that is no day / in the future / before the ledger: refused in words, nothing recorded', check: (record, seen) => {
    if (seen.thrown || WORDS.indexOf(record.kind) < 0) return null;
    if (seen.status < 400 || seen.status >= 500) return record.kind + ' (' + (seen.sent.received_at || seen.sent.currency || 'a stranger') + ') answered HTTP ' + seen.status + said(seen);
    return seen.payments.length ? record.kind + ': refused, but the books hold ' + seen.payments.length + ' payment(s)' : null;
  } },
  { id: 'GB-4', title: 'a valid payment is recorded once, in paise, with its direction and mode', check: (record, seen) => {
    if (seen.thrown || !VALID_SET.has(record.kind)) return null;
    if (seen.status !== 200) return record.kind + ' answered HTTP ' + seen.status + said(seen);
    const want = record.kind === 'cheque' ? 'cheque_received' : 'recorded';
    if (!seen.body.payment || seen.body.payment.status !== want) return record.kind + ': status ' + JSON.stringify(seen.body.payment && seen.body.payment.status) + ', not ' + want;
    const mine = firstOf(seen);
    if (mine.length !== 1) return mine.length + ' books payments for one';
    const pay = mine[0];
    if (pay.minor !== seen.sent.amount_minor) return 'the books hold ' + pay.minor + ' paise, the payment was ' + seen.sent.amount_minor;
    return pay.direction !== seen.sent.direction || pay.mode !== seen.sent.mode ? 'sent ' + seen.sent.direction + '/' + seen.sent.mode + ', the books hold ' + pay.direction + '/' + pay.mode : null;
  } },
  { id: 'GB-5', title: 'the money adds up: applied + on account = the payment, and party_item settles exactly what it applied', check: (record, seen) => {
    if (seen.thrown || !recorded(seen) || !seen.body.outcome) return null;
    const out = seen.body.outcome;
    /* a held cheque posts nothing until it CLEARS (C3): nothing applied, nothing on account, nothing settled */
    if (record.kind === 'cheque')
      return out.applied_minor || out.on_account_minor || seen.byPayment['pay:' + seen.body.payment.payment_id] ? 'a held cheque applied ' + out.applied_minor + ', on account ' + out.on_account_minor : null;
    if (out.applied_minor + out.on_account_minor !== seen.sent.amount_minor) return 'applied ' + out.applied_minor + ' + on account ' + out.on_account_minor + ' ≠ ' + seen.sent.amount_minor;
    const applied = seen.byPayment['pay:' + seen.body.payment.payment_id] || 0;
    return applied === out.applied_minor ? null : 'the outcome says ' + out.applied_minor + ' applied, party_item settles ' + applied;
  } },
  { id: 'GB-6', title: 'no bill is settled beyond what it was; the whole of what is owed, oldest first, settles every bill exactly', check: (record, seen) => {
    if (seen.thrown || !seen.bills[0].ref) return null;
    for (const bill of seen.bills) if ((seen.settled[bill.ref] || 0) > bill.minor) return 'bill ' + bill.ref + ' of ' + bill.minor + ' paise settled ' + seen.settled[bill.ref];
    const whole = (record.kind === 'whole' || record.kind === 'overAck' || record.kind === 'namedFull') && recorded(seen);
    const short = whole && seen.bills.find((bill) => (seen.settled[bill.ref] || 0) !== bill.minor);
    return short ? record.kind + ': bill ' + short.ref + ' of ' + short.minor + ' paise settled ' + (seen.settled[short.ref] || 0) : null;
  } },
  { id: 'GB-7', title: 'an allocation the books may not make is refused in words, and nothing is recorded', check: (record, seen) => {
    if (seen.thrown || ALLOCATION.indexOf(record.kind) < 0) return null;
    if (seen.status < 400 || seen.status >= 500) return record.kind + ' answered HTTP ' + seen.status + said(seen);
    if (seen.payments.length) return record.kind + ': refused, but the books hold ' + seen.payments.length + ' payment(s) — not one transaction';
    const moved = seen.bills.find((bill) => seen.settled[bill.ref]);
    return moved ? record.kind + ': refused, but bill ' + moved.ref + ' was settled ' + seen.settled[moved.ref] : null;
  } },
  { id: 'GB-8', title: "the other buyer's bill is never touched by any payment of mine", check: (record, seen) =>
    seen.thrown || !seen.theirsSettled ? null : record.kind + ': the other buyer\'s bill has ' + seen.theirsSettled + ' paise settled against it' },
  { id: 'GB-9', title: 'the same client_ref again answers the first payment (duplicate: true), and the books hold one', check: (record, seen) => {
    if (seen.thrown || record.again !== 'replay' || !recorded(seen)) return null;
    const back = seen.againBody && seen.againBody.payment;
    if (seen.againStatus !== 200 || !back || back.duplicate !== true || back.payment_id !== seen.body.payment.payment_id)
      return 'the replay answered HTTP ' + seen.againStatus + ' ' + JSON.stringify(back);
    return firstOf(seen).length === 1 ? null : firstOf(seen).length + ' books payments after a replay';
  } },
  { id: 'GB-10', title: 'the duplicate rule: over what is owed, or the same amount again, is a 409 that writes nothing; acknowledged, recorded', check: (record, seen) => {
    if (seen.thrown) return null;
    const refused = (status, reply) => status === 409 && reply && reply.code === 'ALREADY_PAID';
    if (record.kind === 'overNoAck') {
      if (!refused(seen.status, seen.body)) return 'more than owed, not acknowledged, answered HTTP ' + seen.status + ' ' + (seen.body && seen.body.code);
      if (!(seen.body.warnings || []).some((w) => w.code === 'excess')) return 'the 409 names no excess: ' + JSON.stringify(seen.body.warnings);
      return seen.payments.length ? 'refused, but the books hold ' + seen.payments.length + ' payment(s)' : null;
    }
    if ((record.again !== 'same' && record.again !== 'sameAck') || !recorded(seen)) return null;
    const second = seen.payments.filter((pay) => pay.key === seen.second.client_ref).length;
    if (record.again === 'same')
      return !refused(seen.againStatus, seen.againBody) ? 'the same amount again answered HTTP ' + seen.againStatus + ' ' + (seen.againBody && seen.againBody.code) : second ? 'refused, but the books hold the second' : null;
    if (seen.againStatus !== 200) return 'acknowledged, the same amount answered HTTP ' + seen.againStatus + ' "' + (seen.againSaid || '').slice(0, 80) + '"';
    return firstOf(seen).length === 1 && second === 1 ? null : 'acknowledged: ' + firstOf(seen).length + ' + ' + second + ' books payments, not 1 + 1';
  } },
  { id: 'GB-11', title: 'a direction that is neither in nor out is refused, never read as "in"', gap: 'FIN-54 · paymentQuestion reads anything but "out" as "in"', check: (record, seen) => {
    if (seen.thrown || record.kind !== 'direction') return null;
    return seen.status === 400 ? null : 'direction ' + JSON.stringify(record.direction) + ' answered HTTP ' + seen.status + (seen.payments.length ? ', recorded as ' + seen.payments[0].direction : '');
  } }
];

(async () => {
  console.log('\n══ GORILLA · POST /api/books/payments · ' + RUN + ' ══\n');
  const pg = new Client({ connectionString: DB });
  let report = null;
  await pg.connect();
  try {
    const shop = await freshShop(RUN, 'Gorilla Books', NOT_REGISTERED);
    ok(await j('/api/books/enable', { method: 'POST', token: shop.token }), 'books on');
    const products = [];
    for (const [name, price] of [['Rice', 60], ['Dal', 40], ['Oil', 135.5], ['Salt', 20], ['Tea', 49.99], ['Soap', 25.5]]) {
      const made = ok(await j('/api/products', { method: 'POST', token: shop.token, body: { item_data: { name, unit: 'piece', price } } }), 'product ' + name).b;
      products.push({ id: made.item.item_id, name, price });
    }
    /* the OTHER buyer: one bill open, which no payment of mine may settle (GB-7 theirBill · GB-8) */
    const them = await R.buyerOnRail(shop, RUN + 'o', 'Gorilla Other');
    await R.invoiceTo(shop, them.buyer, { no: 'THEIRS-1', billedAt: new Date(BILLED_FROM).toISOString(), lines: [{ particulars: 'Rice', quantity: 2, unit: 'piece', price: 60, total: 120, item_id: products[0].id }] });
    const theirs = await R.openBills(pg, shop.entity, them.party, 1);
    if (!theirs) throw new Error("the other buyer's bill never opened in the books");
    report = await G.hammer({ label: 'POST /api/books/payments', file: 'tests/books-payment-gorilla-truth.realstack.cjs', fixedSeed: FIXED_SEED, budgetMs: 240000,
      make: makeRecord(products), before: partyMaker(shop, pg), send: recorder(shop, pg, theirs[0]), checks: CHECKS, kase });
  } finally {
    await pg.end();
  }
  /* finish writes GORILLA_JSON last, so the gorilla's failing indexes ride along with the cases */
  finish('books-payment-gorilla', process.env.GORILLA_JSON, { gorilla: report });
})().catch((e) => { console.error('books-payment-gorilla could not run: ' + e.message); process.exit(1); });
