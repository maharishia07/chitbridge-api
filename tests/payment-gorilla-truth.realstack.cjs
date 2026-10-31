'use strict';
/**
 * tests/payment-gorilla-truth.realstack.cjs — GORILLA PACK 2: POST /api/chits/:chit_id/payment, hammered (docs/api/COLUMN-13-ADDS-UP.md
 * §4a, second in its order; row ADDS-MONEY-2).
 *
 * owns: the Mark-paid presses a shop can make, on a bill it sent and on bills it may not mark, and the checks every one must pass. The
 *       generator is tests/lib/gorilla.cjs; the doors, the case runner and the fresh shop are tests/lib/truth-harness.cjs. Pack 1
 *       (send-gorilla) is the pattern.
 * FLOW  fresh shop, books on, 6 products, and a second shop (whose bill is not mine) → per record: before() makes the bill to press on
 *       (a fresh buyer shop on the rail, added as my customer, and an invoice to it, waited until the books hold it open · or a
 *       stranger's · a counter bill · the other shop's · an id that is no bill) → send() presses Mark paid (sometimes twice) → reads the copy back, books_payment and party_item
 *       → GP-1..GP-9 graded over every record → one case each
 * CARD 01-rail-core-the-chit/README
 *
 * What a record varies: 1–3 lines; the bill (mine, open in the books · naming a party on neither list · a counter bill carrying its
 * own tender · the other shop's · a malformed id · an unknown id); the press: the exact amount · no amount (the quote) · a part ·
 * ½% over (inside the tolerance) · ₹100 over with no note · ₹100 over with a note · ₹0 · a method the contract does not know ·
 * no method · a negative amount · a word for an amount · a 121-character reference; and a second press: the same one again (a
 * replay) · a new one for 60% · a new one for the same amount (the duplicate rule) · the same amount with its warnings acknowledged.
 * Each record has its own buyer, so the duplicate rule reads only that record's history.
 *
 * What every record must do (ADDS-MONEY-2: a payment is a whole positive amount, dated, from a party on my list; what it settles never
 * exceeds what is open):
 *   GP-1  never a 500: recorded, or refused with a sentence
 *   GP-2  a body the contract refuses (method, amount, ref) is a 400: the copy is not marked and the books hold nothing for it
 *   GP-3  FIN-53 · above what the bill owes (½% over · over · over WITH a note — no tolerance, no note path) is ASKED: 409 ALREADY_PAID
 *         carrying the `excess` warning with over_minor (the amount over the bill, in paise) and over_words; nothing is marked or recorded
 *   GP-4  a valid press on my open bill is RECORDED (never queued, never "books off"), on MY copy as pressed (method · amount · ref)
 *         and in the books ONCE, for the amount (the quote when none was typed), in paise · method 'other' names no ledger: it may
 *         be queued, but only with a why, and then the books hold nothing for it
 *   GP-5  the same press again says "Already recorded", replayed: true — and the books still hold one payment for it
 *   GP-6  what the books settle against the bill never exceeds the bill; and a whole press (exact · the quote) settles exactly the bill
 *   GP-7  gap FIN-52 · a ₹0 press is refused, never marked paid (ADDS-MONEY-2: a whole positive amount). TODAY it answers "Payment
 *         recorded" and marks the copy: lib/books-hooks.js classify queues amount 0 ("no amount") before lib/books.js recordPayment's
 *         > 0 gate, and the route marks first-come. RECORDED here so the fix turns it green, not written around.
 *   GP-8  a bill I may not mark is refused, and nothing is marked or recorded: a party on neither list 422 · a counter bill 422
 *         PAYMENT_TENDER_ON_BILL (its own tender untouched) · the other shop's bill 404 (their copy untouched) · no such bill 404 / 400
 *   GP-10 FIN-53 · the ask confirmed: the same press with acknowledge [{ code: 'excess', over_minor }] — the figure it was asked — is
 *         recorded once, for the whole amount; the bill is settled exactly and the rest is kept as an advance. A STALE figure (over_minor
 *         one paisa off, as if a colleague recorded in between) is asked again, and writes nothing
 *   GP-11 gap FIN-55 · a stranger's bill pressed "other" is refused 422 and never marked. TODAY the books queue "other" ("no ledger
 *         yet") before the stranger refusal, so it answers 200 and marks my copy paid (GP-8 leaves this pair to GP-11).
 *   GP-9  the duplicate rule: the same amount again on a new press is a 409 ALREADY_PAID that leaves one payment and the first mark;
 *         acknowledged, it is recorded as a second payment
 *
 * Fixed seed 20261030 · budget 180 s · GORILLA_N (default 200) · GORILLA_SEED=<n>|random · GORILLA_ONLY=<i> replays one.
 * Run: node tests/payment-gorilla-truth.realstack.cjs
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
const RUN = 'gp' + (Date.now() % 1e10).toString(36);
const FIXED_SEED = 20261030;
const BILLED_FROM = Date.parse('2026-10-29T06:00:00Z');
const cents = (value) => Math.round(Number(value) * 100);
const round2 = (value) => Math.round(value * 100) / 100;

const METHODS = ['upi', 'cash', 'card', 'bank', 'other'];
const KINDS = ['exact', 'exact', 'quote', 'part', 'within', 'over', 'overNote', 'zero', 'badMethod', 'noMethod', 'negative', 'word', 'longRef'];
const TARGETS = ['stranger', 'counter', 'notMine', 'badId', 'unknownId'];
const AGAIN = ['replay', 'second', 'same', 'sameAck'];
const REFUSED_BY_CONTRACT = new Set(['badMethod', 'noMethod', 'negative', 'word', 'longRef']);
const VALID = new Set(['exact', 'quote', 'part']);
/* FIN-53 (Athi, 2026-10-29): money above what the bill owes has ONE gate, the books' `excess` ask (409 ALREADY_PAID with over_minor) —
   no ½% tolerance, no note path. A press of these kinds is asked first (GP-3), then confirmed with the figure it was asked (GP-10) */
const OVER = new Set(['within', 'over', 'overNote']);
const ACK_ALL = ['same_again', 'just_settled', 'excess', 'nothing_owed'];

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

/** the second press, if any */
function secondOf(again, press, total, index, h) {
  if (again === 'replay') return Object.assign({}, press);
  if (again === 'second') return { method: h.pick(METHODS), amount: round2(total * 0.6), client_ref: 'press-' + index + '-b' };
  const same = { method: press.method || 'cash', amount: press.amount != null ? press.amount : total, client_ref: 'press-' + index + '-b' };
  return again === 'sameAck' ? Object.assign(same, { acknowledge: ACK_ALL }) : same;
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
    const target = h.chance(0.15) ? h.pick(TARGETS) : 'own';
    const kind = target === 'own' ? h.pick(KINDS) : 'exact';
    const press = pressOf(h, kind, total, index);
    const drawn = target === 'own' && h.chance(0.4) ? h.pick(AGAIN) : null;
    /* a press above the bill makes its own second press, the confirm (GP-10): no other second press beside it */
    const again = OVER.has(kind) ? null : drawn;
    const second = again ? secondOf(again, press, total, index, h) : null;
    return { index, target, kind, total, lines, press, again, second };
  };
}

/** before each record: the bill its press lands on (see TARGETS) */
function billMaker(shop, other, pg) {
  const send = R.sendChit;
  return async (record) => {
    const no = 'P' + record.index;
    const billedAt = new Date(BILLED_FROM + record.index * 1000).toISOString();
    const invoice = (customer) => ({ recipients: [{ self: true, name: 'self' }], purpose: 'invoice', subject: 'Invoice ' + no, manual_subject: 'Invoice ' + no, client_ref: no,
      business_json: { customer, bill_no: no, billed_at: billedAt }, line_items: record.lines });
    if (record.target === 'badId') return { chit_id: 'not-a-bill-' + record.index };
    if (record.target === 'unknownId') return { chit_id: '00000000-0000-4000-8000-' + String(100000000000 + record.index) };
    if (record.target === 'notMine') return { chit_id: await send(other.token, invoice({ name: 'Their customer' })), token: other.token };
    if (record.target === 'stranger') return { chit_id: await send(shop.token, invoice({ name: 'Nobody on my list', party_id: '00000000-0000-4000-8000-' + String(200000000000 + record.index) })) };
    if (record.target === 'counter') {
      const tender = { mode: 'cash', paid: record.total, change: 0, parts: [{ how: 'cash', amount: record.total }] };
      return { chit_id: await send(shop.token, { recipients: [{ self: true, name: 'self' }], purpose: 'order', subject: 'Counter sale ' + no, manual_subject: 'Counter sale ' + no, client_ref: no,
        business_json: { customer: { name: 'Walk-in' }, till: { id: 'C1', name: 'Counter 1', host: 'browser' }, bill_no: no, billed_at: billedAt, payment: tender, slip: 'cash' },
        line_items: record.lines }), tender };
    }
    /* each record's buyer is a fresh shop ON THE RAIL (tests/lib/rail-buyer.cjs says why) */
    const { buyer, party } = await R.buyerOnRail(shop, RUN + 'b' + record.index, 'Gorilla Buyer');
    const chitId = await R.invoiceTo(shop, buyer, { no, billedAt, lines: record.lines });
    const open = await R.openBills(pg, shop.entity, party, 1);
    if (!open) throw new Error('the invoice never opened in the books (no party_item bill row for its buyer in 3 s)');
    return { chit_id: chitId, billRef: open[0].ref };
  };
}

/** what my copy's mark and the books hold for this bill now: { mark, payments, settledMinor } */
async function stateOf(shop, pg, made) {
  const back = await j('/api/chits/' + made.chit_id, { token: made.token || shop.token });
  const business = back.b && back.b.header && back.b.header.business_json;
  const paid = await pg.query('SELECT client_ref, amount_minor FROM books_payment WHERE entity_id = $1 AND client_ref LIKE $2', [shop.entity, 'chitpay:' + made.chit_id + '%']);
  const settled = await pg.query("SELECT COALESCE(SUM(ABS(amount_minor)), 0) AS minor FROM party_item WHERE entity_id = $1 AND ref_kind = 'allocation' AND against_ref = $2", [shop.entity, String(made.billRef || made.chit_id)]);
  return { mark: business ? business.payment || null : null, payments: paid.rows.map((row) => ({ key: row.client_ref, minor: Number(row.amount_minor) })), settledMinor: Number(settled.rows[0].minor) };
}
/** the `excess` warning of an answer, if it carries one */
const excessOf = (body) => ((body && body.warnings) || []).find((warning) => warning && warning.code === 'excess') || null;

/** press Mark paid (and maybe again — or, above the bill, confirm the ask), then read what the copy and the books hold */
function presser(shop, pg) {
  return async (record, index, made) => {
    const url = '/api/chits/' + encodeURIComponent(made.chit_id) + '/payment';
    const first = await j(url, { method: 'POST', token: shop.token, body: record.press });
    const seen = { status: first.status, said: textOf(first.b), body: first.b, chit_id: made.chit_id, tender: made.tender, billRef: made.billRef || null };
    if (record.second) {
      const again = await j(url, { method: 'POST', token: shop.token, body: record.second });
      Object.assign(seen, { againStatus: again.status, againSaid: textOf(again.b), againBody: again.b });
    }
    if (record.target === 'badId' || record.target === 'unknownId') return Object.assign(seen, { mark: null, payments: [], settledMinor: 0 });
    const asked = own(record) && OVER.has(record.kind) && first.status === 409 ? excessOf(first.b) : null;
    if (asked) {
      /* GP-3 reads what the ask left behind; GP-10 confirms it — first with a STALE figure on a ½%-over press, then with the one it was asked */
      seen.afterAsk = await stateOf(shop, pg, made);
      if (record.kind === 'within') {
        const stale = await j(url, { method: 'POST', token: shop.token, body: Object.assign({}, record.press, { acknowledge: [{ code: 'excess', over_minor: asked.over_minor + 1 }] }) });
        Object.assign(seen, { staleStatus: stale.status, staleBody: stale.b, afterStale: await stateOf(shop, pg, made) });
      }
      const confirm = await j(url, { method: 'POST', token: shop.token, body: Object.assign({}, record.press, { acknowledge: [{ code: 'excess', over_minor: asked.over_minor }] }) });
      Object.assign(seen, { confirmStatus: confirm.status, confirmSaid: textOf(confirm.b), confirmBody: confirm.b });
    }
    return Object.assign(seen, await stateOf(shop, pg, made));
  };
}

const keyOf = (seen, press) => 'chitpay:' + seen.chit_id + ':' + press.client_ref;
const waits = (body) => !!(body && body.books && (body.books.queued || body.books.off));
const recorded = (seen) => seen.status === 200 && seen.body && seen.body.message === 'Payment recorded' && !waits(seen.body);
/* a second press that may itself mark the copy (a new press, not a replay of the first) */
const marksAgain = (record) => record.again === 'second' || record.again === 'same' || record.again === 'sameAck';
const own = (record) => record.target === 'own';
/* FIN-55: a stranger's bill pressed "other" is queued before the stranger refusal — GP-11 holds it, GP-8 the rest */
const strangerOther = (record) => record.target === 'stranger' && record.press.method === 'other';
const nothingFor = (seen, press) => seen.payments.some((pay) => pay.key === keyOf(seen, press));

const CHECKS = [
  { id: 'GP-1', title: 'never a 500: every press is recorded, or refused with a sentence', check: (record, seen) => {
    if (seen.thrown) return 'the call threw: ' + seen.thrown;
    for (const [status, said] of [[seen.status, seen.said], [seen.againStatus, seen.againSaid], [seen.staleStatus, textOf(seen.staleBody)], [seen.confirmStatus, seen.confirmSaid]]) {
      if (status === undefined) continue;
      if (status >= 500) return 'HTTP ' + status + (said ? ' "' + said.slice(0, 80) + '"' : '');
      if (status >= 400 && !said) return 'HTTP ' + status + ' with no sentence';
    }
    return null;
  } },
  { id: 'GP-2', title: 'a body the contract refuses is a 400: not marked, nothing in the books', check: (record, seen) => {
    if (seen.thrown || !own(record) || !REFUSED_BY_CONTRACT.has(record.kind)) return null;
    if (seen.status !== 400) return record.kind + ' ' + JSON.stringify(record.press.method === undefined ? '(no method)' : record.kind === 'longRef' ? 'ref ×121' : record.press.amount ?? record.press.method) + ' answered HTTP ' + seen.status;
    if (nothingFor(seen, record.press)) return 'refused, but the books hold it';
    return seen.mark && !marksAgain(record) ? 'refused, but the copy is marked ' + JSON.stringify(seen.mark) : null;
  } },
  { id: 'GP-3', title: 'above what the bill owes (½% over · over · over with a note) is asked: 409 ALREADY_PAID with the excess and its over_minor; nothing marked or recorded', check: (record, seen) => {
    if (seen.thrown || !own(record) || !OVER.has(record.kind)) return null;
    /* 'other' names no ledger: the books queue it with a why before any ask, and hold nothing (as GP-4) */
    if (record.press.method === 'other' && seen.status === 200 && waits(seen.body)) return seen.body.books.why && !nothingFor(seen, record.press) ? null : '"other" above the bill: queued with no why, or the books hold it';
    const asked = excessOf(seen.body);
    if (seen.status !== 409 || seen.body.code !== 'ALREADY_PAID' || !asked) return record.kind + ' ₹' + record.press.amount + ' on a bill of ₹' + record.total + ' answered HTTP ' + seen.status + ' ' + (seen.body && seen.body.code) + ' "' + (seen.said || '').slice(0, 60) + '"';
    const over = cents(record.press.amount) - cents(record.total);
    if (asked.over_minor !== over || typeof asked.over_words !== 'string' || !asked.over_words) return 'asked with over_minor ' + asked.over_minor + ' (' + JSON.stringify(asked.over_words) + '); the press is ' + over + ' paise over the bill';
    if (!seen.afterAsk || seen.afterAsk.payments.length) return 'asked, but the books hold ' + (seen.afterAsk ? seen.afterAsk.payments.length : '?') + ' payment(s)';
    return seen.afterAsk.mark ? 'asked, but the copy is marked ' + JSON.stringify(seen.afterAsk.mark) : null;
  } },
  { id: 'GP-4', title: 'a valid press on my open bill is recorded (never queued), on my copy as pressed, and in the books once in paise', check: (record, seen) => {
    if (seen.thrown || !own(record) || !VALID.has(record.kind)) return null;
    if (seen.status !== 200) return record.kind + ' answered HTTP ' + seen.status + ' "' + (seen.said || '') + '"';
    const press = record.press;
    /* 'other' names no ledger of its own: the books queue it and SAY why ("… which has no ledger yet") — honest, not silent */
    if (press.method === 'other' && waits(seen.body))
      return seen.body.books.why ? (nothingFor(seen, press) ? 'queued for "other", but the books hold it' : null) : 'queued for "other" with no why';
    if (waits(seen.body)) return 'a valid press was not posted: ' + JSON.stringify({ queued: seen.body.books.queued, off: seen.body.books.off, why: seen.body.books.why });
    const second = marksAgain(record) && seen.againStatus === 200 ? record.second : null;
    const finalMark = second || press;
    if (!seen.mark || seen.mark.method !== finalMark.method || cents(seen.mark.amount ?? 0) !== cents(finalMark.amount ?? 0) || (seen.mark.ref || null) !== (finalMark.ref || null))
      return 'pressed ' + JSON.stringify({ method: finalMark.method, amount: finalMark.amount, ref: finalMark.ref }) + ', my copy says ' + JSON.stringify(seen.mark && { method: seen.mark.method, amount: seen.mark.amount, ref: seen.mark.ref });
    const mine = seen.payments.filter((pay) => pay.key === keyOf(seen, press));
    if (mine.length !== 1) return mine.length + ' books payments for one press';
    const expected = cents(press.amount != null ? press.amount : record.total);
    return mine[0].minor === expected ? null : 'the books hold ' + mine[0].minor + ' paise, the press was ' + expected;
  } },
  { id: 'GP-5', title: 'the same press again says "Already recorded" (replayed) and the books still hold one payment for it', check: (record, seen) => {
    if (seen.thrown || record.again !== 'replay' || !recorded(seen)) return null;
    if (seen.againStatus !== 200 || !seen.againBody || seen.againBody.replayed !== true || seen.againBody.message !== 'Already recorded')
      return 'the replay answered HTTP ' + seen.againStatus + ' ' + JSON.stringify(seen.againBody && { message: seen.againBody.message, replayed: seen.againBody.replayed });
    const mine = seen.payments.filter((pay) => pay.key === keyOf(seen, record.press));
    return mine.length === 1 ? null : mine.length + ' books payments after a replay';
  } },
  { id: 'GP-6', title: 'what the books settle against the bill never exceeds it, and a whole press settles exactly the bill', check: (record, seen) => {
    if (seen.thrown || !own(record)) return null;
    const bill = cents(record.total);
    if (seen.settledMinor > bill) return 'settled ' + seen.settledMinor + ' paise against a bill of ' + bill;
    const whole = (record.kind === 'exact' || record.kind === 'quote') && recorded(seen) && (!record.again || record.again === 'replay');
    return whole && seen.settledMinor !== bill ? 'a whole press settled ' + seen.settledMinor + ' of the bill\'s ' + bill + ' paise' : null;
  } },
  { id: 'GP-7', title: 'a ₹0 press is refused, never marked paid (a payment is a whole positive amount)', gap: 'FIN-52 · classify queues a zero before the > 0 gate in recordPayment', check: (record, seen) => {
    if (seen.thrown || !own(record) || record.kind !== 'zero') return null;
    if (seen.status < 400) return '₹0 answered HTTP ' + seen.status + ' "' + (seen.said || '') + '"' + (seen.mark ? ' and my copy is marked paid' : '');
    return seen.mark && !marksAgain(record) ? 'refused, but the copy is marked ' + JSON.stringify(seen.mark) : null;
  } },
  { id: 'GP-8', title: 'a bill I may not mark is refused (stranger 422 · counter bill 422 · not mine 404 · no such bill), nothing marked or recorded', check: (record, seen) => {
    if (seen.thrown || own(record) || strangerOther(record)) return null;
    const code = seen.body && seen.body.code;
    const want = { stranger: [422], counter: [422], notMine: [404], badId: [400, 404], unknownId: [404] }[record.target];
    if (want.indexOf(seen.status) < 0) return record.target + ' answered HTTP ' + seen.status + ' ' + (code || '') + ' "' + (seen.said || '').slice(0, 80) + '"';
    if (record.target === 'counter' && code !== 'PAYMENT_TENDER_ON_BILL') return 'a counter bill was refused as ' + code + ', not PAYMENT_TENDER_ON_BILL';
    if (seen.payments.length) return record.target + ': refused, but the books hold ' + seen.payments.length + ' payment(s)';
    if (record.target === 'counter') return seen.mark && JSON.stringify(seen.mark.parts) === JSON.stringify(seen.tender.parts) ? null : 'the counter bill\'s own tender changed: ' + JSON.stringify(seen.mark);
    return seen.mark ? record.target + ': refused, but the copy is marked ' + JSON.stringify(seen.mark) : null;
  } },
  { id: 'GP-9', title: 'the same amount on a new press is a 409 ALREADY_PAID (one payment, first mark kept); acknowledged, a second payment', check: (record, seen) => {
    if (seen.thrown || (record.again !== 'same' && record.again !== 'sameAck') || !recorded(seen)) return null;
    const mine = (press) => seen.payments.filter((pay) => pay.key === keyOf(seen, press)).length;
    if (record.again === 'same') {
      if (seen.againStatus !== 409 || !seen.againBody || seen.againBody.code !== 'ALREADY_PAID') return 'the same amount again answered HTTP ' + seen.againStatus + ' ' + (seen.againBody && seen.againBody.code);
      if (mine(record.second)) return 'refused as ALREADY_PAID, but the books hold the second press';
      return seen.mark && seen.mark.client_ref === record.press.client_ref ? null : 'refused, but the mark moved to ' + JSON.stringify(seen.mark && seen.mark.client_ref);
    }
    if (seen.againStatus !== 200) return 'acknowledged, the same amount answered HTTP ' + seen.againStatus + ' ' + (seen.againBody && seen.againBody.code) + ' "' + (seen.againSaid || '').slice(0, 80) + '"';
    return mine(record.press) === 1 && mine(record.second) === 1 ? null : 'acknowledged: ' + mine(record.press) + ' + ' + mine(record.second) + ' books payments, not 1 + 1';
  } },
  { id: 'GP-11', title: 'a bill to a stranger pressed "other" is refused 422, never marked paid', gap: 'FIN-55 · the books queue "other" before the stranger refusal is reached', check: (record, seen) => {
    if (seen.thrown || !strangerOther(record)) return null;
    if (seen.status !== 422) return 'a stranger, "other", answered HTTP ' + seen.status + ' "' + (seen.said || '').slice(0, 60) + '"' + (seen.mark ? ' and my copy is marked paid' : '');
    return seen.mark ? 'refused, but the copy is marked ' + JSON.stringify(seen.mark) : seen.payments.length ? 'refused, but the books hold it' : null;
  } },
  { id: 'GP-10', title: 'the ask confirmed with the figure it was asked is recorded once for the whole amount (the bill settled exactly, the rest an advance); a stale figure is asked again', check: (record, seen) => {
    if (seen.thrown || !own(record) || !OVER.has(record.kind) || seen.confirmStatus === undefined) return null;
    if (seen.staleStatus !== undefined) {
      if (seen.staleStatus !== 409 || !excessOf(seen.staleBody)) return 'confirmed with a stale figure (one paisa off), it answered HTTP ' + seen.staleStatus + ' ' + (seen.staleBody && seen.staleBody.code);
      if (seen.afterStale.payments.length || seen.afterStale.mark) return 'a stale confirm was asked again, but it wrote: ' + seen.afterStale.payments.length + ' payment(s), mark ' + JSON.stringify(seen.afterStale.mark);
    }
    if (seen.confirmStatus !== 200 || !seen.confirmBody || seen.confirmBody.message !== 'Payment recorded') return 'confirmed with the figure asked, it answered HTTP ' + seen.confirmStatus + ' ' + (seen.confirmBody && seen.confirmBody.code) + ' "' + (seen.confirmSaid || '').slice(0, 80) + '"';
    const mine = seen.payments.filter((pay) => pay.key === keyOf(seen, record.press));
    if (mine.length !== 1 || mine[0].minor !== cents(record.press.amount)) return 'confirmed: the books hold ' + JSON.stringify(mine.map((pay) => pay.minor)) + ', the press was ' + cents(record.press.amount) + ' paise';
    if (seen.settledMinor !== cents(record.total)) return 'confirmed: ' + seen.settledMinor + ' paise settled against a bill of ' + cents(record.total) + ' (the rest belongs on account)';
    return seen.mark && cents(seen.mark.amount) === cents(record.press.amount) ? null : 'confirmed, but my copy says ' + JSON.stringify(seen.mark);
  } }
];

(async () => {
  console.log('\n══ GORILLA · POST /api/chits/:chit_id/payment · ' + RUN + ' ══\n');
  const pg = new Client({ connectionString: DB });
  let report = null;
  await pg.connect();
  try {
    const shop = await freshShop(RUN, 'Gorilla Pay', NOT_REGISTERED);
    const other = await freshShop(RUN + 'o', 'Gorilla Other', NOT_REGISTERED);
    ok(await j('/api/books/enable', { method: 'POST', token: shop.token }), 'books on');
    const products = [];
    for (const [name, price] of [['Rice', 60], ['Dal', 40], ['Oil', 135.5], ['Salt', 20], ['Tea', 49.99], ['Soap', 25.5]]) {
      const made = ok(await j('/api/products', { method: 'POST', token: shop.token, body: { item_data: { name, unit: 'piece', price } } }), 'product ' + name).b;
      products.push({ id: made.item.item_id, name, price });
    }
    report = await G.hammer({ label: 'POST /api/chits/:chit_id/payment', file: 'tests/payment-gorilla-truth.realstack.cjs', fixedSeed: FIXED_SEED, budgetMs: 180000,
      make: makeRecord(products), before: billMaker(shop, other, pg), send: presser(shop, pg), checks: CHECKS, kase });
  } finally {
    await pg.end();
  }
  /* finish writes GORILLA_JSON last, so the gorilla's failing indexes ride along with the cases */
  finish('payment-gorilla', process.env.GORILLA_JSON, { gorilla: report });
})().catch((e) => { console.error('payment-gorilla could not run: ' + e.message); process.exit(1); });
