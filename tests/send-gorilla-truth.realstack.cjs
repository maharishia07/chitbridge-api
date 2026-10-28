'use strict';
/**
 * tests/send-gorilla-truth.realstack.cjs — GORILLA PACK 1: POST /api/chits/send, hammered (docs/api/COLUMN-13-ADDS-UP.md §4a, first in its order).
 *
 * owns: the counter-bill variations for /chits/send and the checks every one of them must pass. The generator is tests/lib/gorilla.cjs
 *       (seeded, one replay line per failure); the doors, the case runner and the fresh shop are tests/lib/truth-harness.cjs.
 * FLOW  fresh shop + 6 products → N seeded bills (lines × quantities × prices × tender modes × odd text) → send → read MY copy back
 *       → GS-1..GS-5 graded over every record → one case each
 * CARD 01-rail-core-the-chit/README
 *
 * What a record varies: 1–6 lines; quantity 1, 2, 3, 5, ½, ¼, 1.5, 2.345, 0, −1, a million; price the catalogue's, ₹0, one paisa,
 * ₹19.99, ₹99,999.99, −₹5; a line total that disagrees with quantity × price; tender cash · UPI · card · two parts · short · over (with
 * change) · nothing · credit with a due date; a 5,000-character subject; Devanagari, Arabic and emoji particulars.
 *
 * What every record must do (the checks hold TODAY unless marked gap):
 *   GS-1  never a 500: stored, or refused with a sentence (refused BY NAME)
 *   GS-2  a stored bill reads back line for line as sent (particulars, quantity, price, total)
 *   GS-3  its value (chit_detail.total_value) is the sum of its line totals, rounded once (routes/chits.js calculateSummary)
 *   GS-4  the tender is kept as the counter sent it (payment.paid, the parts) — freeze at send
 *   GS-5  gap R127 · ADDS-MONEY-1: the parts, less change, add up to the bill — or a due date says the rest is owed. No door checks
 *         this today (COLUMN-13 §2, row /chits/send); it is RECORDED here so the fix (PR 2) turns it green, not written around.
 *
 * Fixed seed 20261029 · GORILLA_N (default 200) · GORILLA_SEED=<n>|random · GORILLA_ONLY=<i> replays one. Run: node tests/send-gorilla-truth.realstack.cjs
 * ⚠️ LOCAL ONLY (the harness refuses anything else). Writes go through the route; the database is only SELECTed.
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const G = require('./lib/gorilla.cjs');
const { DB, j, ok, kase, freshShop, finish } = H;

const RUN = 'gs' + (Date.now() % 1e10).toString(36);
const FIXED_SEED = 20261029;
const cents = (value) => Math.round(Number(value) * 100);
const nearMoney = (left, right) => Math.abs(cents(left) - cents(right)) <= 1;
const textOf = (reply) => [reply.error, reply.message, reply.why, reply.detail].find((said) => typeof said === 'string' && said.trim());

const QUANTITIES = [1, 1, 1, 2, 2, 3, 5, 0.5, 0.25, 1.5, 2.345, 0, -1, 1000000];
const ODD_PRICES = [0, 0.01, 19.99, 99999.99, -5];
const NAMES = ['चावल 5 kg', 'أرز بسمتي', 'Rice 🍚 bag', 'Tea "special" <b>', 'Oil\tcan'];
const MODES = ['cash', 'cash', 'upi', 'card', 'part', 'short', 'over', 'nothing', 'credit'];

/** the tender a counter would send for this mode — what GS-5 later asks to add up */
function tenderOf(h, mode, total) {
  if (mode === 'cash' || mode === 'upi' || mode === 'card') return { mode, paid: total, change: 0, parts: [{ how: mode, amount: total }] };
  if (mode === 'part') {
    const first = Math.round(total * 40) / 100;
    return { mode: 'part', paid: total, change: 0, parts: [{ how: 'cash', amount: first }, { how: 'upi', amount: Math.round((total - first) * 100) / 100 }] };
  }
  if (mode === 'short') { const paid = Math.round(total * 60) / 100; return { mode: 'cash', paid, change: 0, parts: [{ how: 'cash', amount: paid }] }; }
  if (mode === 'over') return { mode: 'cash', paid: total + 50, change: 50, parts: [{ how: 'cash', amount: total + 50 }] };
  if (mode === 'credit') return { mode: 'credit', paid: 0, change: 0, parts: [], terms: { due_on: '2026-12-31' } };
  return { mode: 'cash', paid: 0, change: 0, parts: [] };
}

/** one seeded counter bill */
function makeBill(products) {
  return (h, index) => {
    const lines = Array.from({ length: h.int(1, 6) }, () => {
      const product = h.pick(products);
      const quantity = h.pick(QUANTITIES);
      const price = h.chance(0.8) ? product.price : h.pick(ODD_PRICES);
      let total = Math.round(quantity * price * 100) / 100;
      if (h.chance(0.05)) total = Math.round((total + 1) * 100) / 100; /* a total that disagrees with quantity × price */
      const particulars = h.chance(0.1) ? h.pick(NAMES) : product.name;
      return { particulars, quantity, unit: product.unit, price, total, item_id: product.id };
    });
    const total = Math.round(lines.reduce((sum, item) => sum + item.total, 0) * 100) / 100;
    const mode = h.pick(MODES);
    const payment = tenderOf(h, mode, total);
    const no = RUN + '-G' + index;
    const subject = h.chance(0.05) ? 'Counter sale ' + 'x'.repeat(5000) : 'Counter sale ' + no;
    return {
      recipients: [{ self: true, name: 'self' }], purpose: 'order', subject, manual_subject: subject, client_ref: no,
      business_json: Object.assign({ customer: { name: 'Walk-in' }, till: { id: 'C1', name: 'Counter 1', host: 'browser' }, bill_no: no,
        billed_at: new Date().toISOString(), payment: { mode: payment.mode, paid: payment.paid, change: payment.change, parts: payment.parts }, slip: 'cash' },
      payment.terms ? { terms: payment.terms } : {}),
      line_items: lines
    };
  };
}

/** send one bill, then read MY copy back the way the api answers it */
function sender(shop, pg) {
  return async (record) => {
    const sent = await j('/api/chits/send', { method: 'POST', token: shop.token, body: record });
    const seen = { status: sent.status, said: textOf(sent.b), chit_id: sent.b && sent.b.chit_id };
    if (sent.status >= 300 || !seen.chit_id) return seen;
    const back = await j('/api/chits/' + seen.chit_id, { token: shop.token });
    seen.readStatus = back.status;
    seen.lines = back.b.detail && Array.isArray(back.b.detail.line_items) ? back.b.detail.line_items : null;
    seen.business = back.b.header && back.b.header.business_json;
    const value = await pg.query('SELECT total_value FROM chit_detail WHERE chit_id = $1 AND entity_id = $2', [seen.chit_id, shop.entity]);
    seen.value = value.rows[0] ? Number(value.rows[0].total_value) : null;
    return seen;
  };
}

const stored = (seen) => seen.status < 300 && seen.chit_id;
const lineTotal = (item) => (item.total !== undefined && item.total !== null && String(item.total).trim() !== '' ? Number(item.total) : Number(item.price) * Number(item.quantity));

const CHECKS = [
  { id: 'GS-1', title: 'never a 500: every bill is stored, or refused with a sentence', check: (record, seen) => {
    if (seen.thrown) return 'the call threw: ' + seen.thrown;
    if (seen.status >= 500) return 'HTTP ' + seen.status + (seen.said ? ' "' + seen.said.slice(0, 80) + '"' : '');
    if (seen.status >= 400 && !seen.said) return 'HTTP ' + seen.status + ' with no sentence';
    if (seen.status < 300 && !seen.chit_id) return 'HTTP ' + seen.status + ' and no chit_id';
    return null;
  } },
  { id: 'GS-2', title: 'a stored bill reads back line for line as sent', check: (record, seen) => {
    if (!stored(seen)) return null;
    if (!seen.lines) return 'the read answered HTTP ' + seen.readStatus + ' with no lines';
    if (seen.lines.length !== record.line_items.length) return record.line_items.length + ' lines sent, ' + seen.lines.length + ' read back';
    const moved = record.line_items.findIndex((sentLine, at) => {
      const back = seen.lines[at];
      return back.particulars !== sentLine.particulars || Number(back.quantity) !== sentLine.quantity || Number(back.price) !== sentLine.price || !nearMoney(back.total, sentLine.total);
    });
    return moved < 0 ? null : 'line ' + moved + ' sent ' + JSON.stringify([record.line_items[moved].quantity, record.line_items[moved].price, record.line_items[moved].total]) +
      ', read ' + JSON.stringify([seen.lines[moved].quantity, seen.lines[moved].price, seen.lines[moved].total]);
  } },
  { id: 'GS-3', title: 'its value is the sum of its line totals, rounded once', check: (record, seen) => {
    if (!stored(seen)) return null;
    const expected = record.line_items.reduce((sum, item) => sum + lineTotal(item), 0);
    return seen.value !== null && nearMoney(seen.value, expected) ? null : 'value ' + seen.value + ', lines add to ' + Math.round(expected * 100) / 100;
  } },
  { id: 'GS-4', title: 'the tender is kept as the counter sent it', check: (record, seen) => {
    if (!stored(seen)) return null;
    const kept = seen.business && seen.business.payment;
    const sentPayment = record.business_json.payment;
    if (!kept) return 'no payment on the stored bill';
    const partsOf = (payment) => (payment.parts || []).map((part) => part.how + ':' + cents(part.amount)).join(',');
    return nearMoney(kept.paid, sentPayment.paid) && partsOf(kept) === partsOf(sentPayment) ? null : 'sent ' + JSON.stringify(sentPayment) + ', kept ' + JSON.stringify(kept);
  } },
  { id: 'GS-5', title: 'ADDS-MONEY-1: the parts, less change, add up to the bill — or a due date names the rest', gap: 'R127 · no door checks it (COLUMN-13 §4 PR 2)', check: (record, seen) => {
    if (!stored(seen)) return null;
    const payment = record.business_json.payment;
    const tendered = (payment.parts || []).reduce((sum, part) => sum + Number(part.amount), 0) - Number(payment.change || 0);
    const owed = record.business_json.terms && record.business_json.terms.due_on;
    return nearMoney(tendered, seen.value) || owed ? null : 'stored as paid with ' + Math.round(tendered * 100) / 100 + ' tendered on a bill of ' + seen.value + ', and no due date';
  } }
];

(async () => {
  console.log('\n══ GORILLA · POST /api/chits/send · ' + RUN + ' ══\n');
  const pg = new Client({ connectionString: DB });
  await pg.connect();
  try {
    const shop = await freshShop(RUN, 'Gorilla Send');
    const products = [];
    for (const [name, price] of [['Rice', 60], ['Dal', 40], ['Oil', 30], ['Salt', 20], ['Tea', 50], ['Soap', 25.5]]) {
      const made = ok(await j('/api/products', { method: 'POST', token: shop.token, body: { item_data: { name, unit: 'piece', price } } }), 'product ' + name).b;
      products.push({ id: made.item.item_id, name, unit: 'piece', price });
    }
    await G.hammer({ label: 'POST /api/chits/send', file: 'tests/send-gorilla-truth.realstack.cjs', fixedSeed: FIXED_SEED, make: makeBill(products), send: sender(shop, pg), checks: CHECKS, kase });
  } finally {
    await pg.end();
  }
  finish('send-gorilla', process.env.GORILLA_JSON);
})().catch((e) => { console.error('send-gorilla could not run: ' + e.message); process.exit(1); });
