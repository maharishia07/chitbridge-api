'use strict';
/**
 * tests/payment-gorilla-truth.realstack.cjs — GORILLA PACK 2: POST /api/chits/:chit_id/payment, hammered (docs/api/COLUMN-13-ADDS-UP.md
 * §4a, second in its order; row ADDS-MONEY-2).
 *
 * owns: the Mark-paid presses a shop can make on a bill it sent, and the checks every one must pass. The generator is tests/lib/gorilla.cjs;
 *       the doors, the case runner and the fresh shop are tests/lib/truth-harness.cjs. Pack 1 (send-gorilla) is the pattern.
 * FLOW  fresh shop, books on, 6 products → per record: before() adds a local customer and sends them an invoice (no till: not a counter
 *       bill, so the door is open) → send() presses Mark paid (sometimes twice) → reads MY copy back, books_payment and party_item
 *       → GP-1..GP-7 graded over every record → one case each
 * CARD 01-rail-core-the-chit/README
 *
 * What a record varies: 1–3 lines; the press: the exact amount · no amount (the quote) · a part · ½% over (inside the tolerance) ·
 * ₹100 over with no note · ₹100 over with a note · ₹0 · a method the contract does not know · no method · a negative amount · a word
 * for an amount · a 121-character reference; and a second press: the same one again (a replay) or a new one (a second payment).
 * Each record has its own customer, so the duplicate rule reads only that record's history.
 *
 * What every record must do (ADDS-MONEY-2: a payment is a whole positive amount, dated, from a party on my list; what it settles never
 * exceeds what is open):
 *   GP-1  never a 500: recorded, or refused with a sentence
 *   GP-2  a body the contract refuses (method, amount, ref) is a 400, and the copy is not marked paid
 *   GP-3  above the quote with no note is a 422 PAYMENT_ABOVE_QUOTE naming the quote, and nothing is marked or recorded
 *   GP-4  a recorded press is on MY copy as pressed (method · amount · ref · note) and in the books ONCE, for the amount (the quote when
 *         none was typed), in paise
 *   GP-5  the same press again says "Already recorded", replayed: true — and the books still hold one payment for it
 *   GP-6  what the books settle against the bill never exceeds the bill (party_item allocations ≤ its total)
 *   GP-7  gap FIN-52 · a ₹0 press is refused, never marked paid (ADDS-MONEY-2: a whole positive amount). TODAY it answers "Payment
 *         recorded" and marks the copy: lib/books-hooks.js classify queues amount 0 ("no amount") before lib/books.js recordPayment's
 *         > 0 gate, and the route marks first-come. RECORDED here so the fix turns it green, not written around.
 *
 * Fixed seed 20261030 · budget 120 s · GORILLA_N (default 200) · GORILLA_SEED=<n>|random · GORILLA_ONLY=<i> replays one.
 * Run: node tests/payment-gorilla-truth.realstack.cjs
 * ⚠️ LOCAL ONLY (the harness refuses anything else). Writes go through the routes; the database is only SELECTed.
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const G = require('./lib/gorilla.cjs');
const { DB, j, ok, kase, freshShop, finish } = H;

/* the run tag names the fresh SHOP only (the world); nothing in a record reads it */
const RUN = 'gp' + (Date.now() % 1e10).toString(36);
const FIXED_SEED = 20261030;
const BILLED_FROM = Date.parse('2026-10-29T06:00:00Z');
const cents = (value) => Math.round(Number(value) * 100);
const round2 = (value) => Math.round(value * 100) / 100;
const textOf = (reply) => [reply && reply.error, reply && reply.message, reply && reply.why, reply && reply.detail].find((said) => typeof said === 'string' && said.trim());

const METHODS = ['upi', 'cash', 'card', 'bank', 'other'];
const KINDS = ['exact', 'exact', 'quote', 'part', 'within', 'over', 'overNote', 'zero', 'badMethod', 'noMethod', 'negative', 'word', 'longRef'];
const REFUSED_BY_CONTRACT = new Set(['badMethod', 'noMethod', 'negative', 'word', 'longRef']);

/** the press body for one kind, against a bill of `total` */
function pressOf(h, kind, total, index) {
  const press = { method: h.pick(METHODS), ref: h.chance(0.5) ? 'UTR' + (100000 + index) : null, client_ref: 'press-' + index };
  if (kind === 'exact') press.amount = total;
  if (kind === 'part') press.amount = round2(total * 0.4);
  if (kind === 'within') press.amount = round2(total * 1.004);
  if (kind === 'over') press.amount = round2(total + 100);
  if (kind === 'overNote') Object.assign(press, { amount: round2(total + 100), note: 'an old balance, paid with this bill' });
  if (kind === 'zero') press.amount = 0;
  if (kind === 'badMethod') press.method = h.pick(['cheque', 'crypto', 'UPI ', '']);
  if (kind === 'noMethod') delete press.method;
  if (kind === 'negative') press.amount = -h.pick([1, 50, total]);
  if (kind === 'word') press.amount = h.pick(['fifty', '12,50', '₹100', '1 0']);
  if (kind === 'longRef') press.ref = 'R'.repeat(121);
  /* odd text in the note — never on 'over', whose whole point is the press with NO note (a note is what lets an overpayment through) */
  if (kind !== 'over' && h.chance(0.15)) press.note = (press.note || '') + ' नकद 💵';
  return press;
}

/** one seeded record: the bill, the press, and maybe a second press */
function makeRecord(products) {
  return (h, index) => {
    const lines = Array.from({ length: h.int(1, 3) }, () => {
      const product = h.pick(products);
      const quantity = h.int(1, 5);
      return { particulars: product.name, quantity, unit: 'piece', price: product.price, total: round2(quantity * product.price), item_id: product.id };
    });
    const total = round2(lines.reduce((sum, item) => sum + item.total, 0));
    const kind = h.pick(KINDS);
    const press = pressOf(h, kind, total, index);
    const again = h.chance(0.35) ? h.pick(['replay', 'second']) : null;
    const second = again === 'replay' ? Object.assign({}, press) : again === 'second' ? { method: h.pick(METHODS), amount: round2(total * 0.6), client_ref: 'press-' + index + '-b' } : null;
    return { index, kind, total, lines, press, again, second };
  };
}

/** before each record: its own local customer, and an invoice to them (no till, no payment on it) */
function billMaker(shop) {
  return async (record) => {
    const added = ok(await j('/api/relationships/customers', { method: 'POST', token: shop.token, body: { name: 'Payer ' + RUN + ' ' + record.index } }), 'customer ' + record.index).b;
    const party = added.customer.customer_identity_id;
    const no = 'P' + record.index;
    const sent = await j('/api/chits/send', { method: 'POST', token: shop.token, body: {
      recipients: [{ self: true, name: 'self' }], purpose: 'invoice', subject: 'Invoice ' + no, manual_subject: 'Invoice ' + no, client_ref: no,
      business_json: { customer: { name: added.customer.display_name, party_id: party }, bill_no: no, billed_at: new Date(BILLED_FROM + record.index * 1000).toISOString() },
      line_items: record.lines
    } });
    if (sent.status >= 300 || !sent.b.chit_id) throw new Error('the bill to pay was not stored: HTTP ' + sent.status + ' ' + (textOf(sent.b) || ''));
    return { chit_id: sent.b.chit_id, party };
  };
}

/** press Mark paid (and maybe again), then read what my copy and the books hold */
function presser(shop, pg) {
  return async (record, index, made) => {
    const url = '/api/chits/' + made.chit_id + '/payment';
    const first = await j(url, { method: 'POST', token: shop.token, body: record.press });
    const seen = { status: first.status, said: textOf(first.b), body: first.b, chit_id: made.chit_id };
    if (record.second) {
      const again = await j(url, { method: 'POST', token: shop.token, body: record.second });
      Object.assign(seen, { againStatus: again.status, againSaid: textOf(again.b), againBody: again.b });
    }
    const back = await j('/api/chits/' + made.chit_id, { token: shop.token });
    seen.mark = back.b && back.b.header && back.b.header.business_json ? back.b.header.business_json.payment || null : null;
    const paid = await pg.query('SELECT client_ref, amount_minor FROM books_payment WHERE entity_id = $1 AND client_ref LIKE $2', [shop.entity, 'chitpay:' + made.chit_id + '%']);
    seen.payments = paid.rows.map((row) => ({ key: row.client_ref, minor: Number(row.amount_minor) }));
    const settled = await pg.query("SELECT COALESCE(SUM(ABS(amount_minor)), 0) AS minor FROM party_item WHERE entity_id = $1 AND ref_kind = 'allocation' AND against_ref = $2", [shop.entity, String(made.chit_id)]);
    seen.settledMinor = Number(settled.rows[0].minor);
    return seen;
  };
}

const keyOf = (seen, press) => 'chitpay:' + seen.chit_id + ':' + press.client_ref;
const recorded = (seen) => seen.status === 200 && seen.body && seen.body.message === 'Payment recorded';

const CHECKS = [
  { id: 'GP-1', title: 'never a 500: every press is recorded, or refused with a sentence', check: (record, seen) => {
    if (seen.thrown) return 'the call threw: ' + seen.thrown;
    for (const [status, said] of [[seen.status, seen.said], [seen.againStatus, seen.againSaid]]) {
      if (status === undefined) continue;
      if (status >= 500) return 'HTTP ' + status + (said ? ' "' + said.slice(0, 80) + '"' : '');
      if (status >= 400 && !said) return 'HTTP ' + status + ' with no sentence';
    }
    return null;
  } },
  { id: 'GP-2', title: 'a body the contract refuses is a 400, and the copy is not marked paid', check: (record, seen) => {
    if (seen.thrown || !REFUSED_BY_CONTRACT.has(record.kind)) return null;
    if (seen.status !== 400) return record.kind + ' ' + JSON.stringify(record.press.method === undefined ? '(no method)' : record.kind === 'longRef' ? 'ref ×121' : record.press.amount ?? record.press.method) + ' answered HTTP ' + seen.status;
    return seen.mark && !record.second ? 'refused, but the copy is marked ' + JSON.stringify(seen.mark) : null;
  } },
  { id: 'GP-3', title: 'above the quote with no note is a 422 naming the quote, and nothing is marked or recorded', check: (record, seen) => {
    if (seen.thrown || record.kind !== 'over') return null;
    if (seen.status !== 422 || !seen.body || seen.body.code !== 'PAYMENT_ABOVE_QUOTE') return '₹' + record.press.amount + ' on a bill of ₹' + record.total + ' answered HTTP ' + seen.status + ' ' + (seen.body && seen.body.code);
    if (cents(seen.body.quoted) !== cents(record.total)) return 'the refusal names a quote of ' + seen.body.quoted + ', the bill is ' + record.total;
    const mine = seen.payments.filter((pay) => pay.key === keyOf(seen, record.press));
    return mine.length ? 'refused, but the books hold it' : null;
  } },
  { id: 'GP-4', title: 'a recorded press is on my copy as pressed, and in the books once, for its amount in paise', check: (record, seen) => {
    if (seen.thrown || !recorded(seen) || (seen.body.books && (seen.body.books.queued || seen.body.books.off))) return null;
    const press = record.press;
    const finalMark = record.second && record.again === 'second' && seen.againStatus === 200 ? record.second : press;
    if (!seen.mark || seen.mark.method !== finalMark.method || cents(seen.mark.amount ?? 0) !== cents(finalMark.amount ?? 0) || (seen.mark.ref || null) !== (finalMark.ref || null))
      return 'pressed ' + JSON.stringify({ method: finalMark.method, amount: finalMark.amount, ref: finalMark.ref }) + ', my copy says ' + JSON.stringify(seen.mark && { method: seen.mark.method, amount: seen.mark.amount, ref: seen.mark.ref });
    const mine = seen.payments.filter((pay) => pay.key === keyOf(seen, press));
    if (mine.length !== 1) return mine.length + ' books payments for one press';
    const expected = cents(press.amount != null ? press.amount : record.total);
    return mine[0].minor === expected ? null : 'the books hold ' + mine[0].minor + ' paise, the press was ' + expected;
  } },
  { id: 'GP-5', title: 'the same press again says "Already recorded" (replayed) and the books still hold one payment for it', check: (record, seen) => {
    if (seen.thrown || record.again !== 'replay' || !recorded(seen) || (seen.body.books && (seen.body.books.queued || seen.body.books.off))) return null;
    if (seen.againStatus !== 200 || !seen.againBody || seen.againBody.replayed !== true || seen.againBody.message !== 'Already recorded')
      return 'the replay answered HTTP ' + seen.againStatus + ' ' + JSON.stringify(seen.againBody && { message: seen.againBody.message, replayed: seen.againBody.replayed });
    const mine = seen.payments.filter((pay) => pay.key === keyOf(seen, record.press));
    return mine.length === 1 ? null : mine.length + ' books payments after a replay';
  } },
  { id: 'GP-6', title: 'what the books settle against the bill never exceeds the bill', check: (record, seen) => {
    if (seen.thrown) return null;
    return seen.settledMinor <= cents(record.total) ? null : 'settled ' + seen.settledMinor + ' paise against a bill of ' + cents(record.total);
  } },
  { id: 'GP-7', title: 'a ₹0 press is refused, never marked paid (a payment is a whole positive amount)', gap: 'FIN-52 · classify queues a zero before the > 0 gate in recordPayment', check: (record, seen) => {
    if (seen.thrown || record.kind !== 'zero') return null;
    if (seen.status < 400) return '₹0 answered HTTP ' + seen.status + ' "' + (seen.said || '') + '"' + (seen.mark ? ' and my copy is marked paid' : '');
    return seen.mark && !record.second ? 'refused, but the copy is marked ' + JSON.stringify(seen.mark) : null;
  } }
];

(async () => {
  console.log('\n══ GORILLA · POST /api/chits/:chit_id/payment · ' + RUN + ' ══\n');
  const pg = new Client({ connectionString: DB });
  let report = null;
  await pg.connect();
  try {
    const shop = await freshShop(RUN, 'Gorilla Pay');
    ok(await j('/api/books/enable', { method: 'POST', token: shop.token }), 'books on');
    const products = [];
    for (const [name, price] of [['Rice', 60], ['Dal', 40], ['Oil', 135.5], ['Salt', 20], ['Tea', 49.99], ['Soap', 25.5]]) {
      const made = ok(await j('/api/products', { method: 'POST', token: shop.token, body: { item_data: { name, unit: 'piece', price } } }), 'product ' + name).b;
      products.push({ id: made.item.item_id, name, price });
    }
    report = await G.hammer({ label: 'POST /api/chits/:chit_id/payment', file: 'tests/payment-gorilla-truth.realstack.cjs', fixedSeed: FIXED_SEED, budgetMs: 120000,
      make: makeRecord(products), before: billMaker(shop), send: presser(shop, pg), checks: CHECKS, kase });
  } finally {
    await pg.end();
  }
  /* finish writes GORILLA_JSON last, so the gorilla's failing indexes ride along with the cases */
  finish('payment-gorilla', process.env.GORILLA_JSON, { gorilla: report });
})().catch((e) => { console.error('payment-gorilla could not run: ' + e.message); process.exit(1); });
