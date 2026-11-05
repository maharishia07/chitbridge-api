'use strict';
/**
 * tests/send-gorilla-truth.realstack.cjs — GORILLA PACK 1: POST /api/chits/send, hammered (docs/api/COLUMN-13-ADDS-UP.md §4a, first in its order).
 *
 * owns: the counter-bill variations for /chits/send and the checks every one of them must pass. The generator is tests/lib/gorilla.cjs
 *       (seeded, one replay line per failure); the doors, the case runner and the fresh shop are tests/lib/truth-harness.cjs.
 * FLOW  fresh shop + 6 products → N seeded bills (lines × quantities × prices × invoice × tender modes × odd text) → send → read MY
 *       copy back (live_set from chit_line, the header's payment, chit_detail.total_value) → GS-1..GS-6 graded over every record → one case each
 * CARD 01-rail-core-the-chit/README
 *
 * What a record varies: 1–6 lines; quantity 1, 2, 3, 5, ½, ¼, 1.5, 2.345, 0, −1, a million; price the catalogue's, ₹0, one paisa,
 * ₹19.99, ₹99,999.99, −₹5; a line total that disagrees with quantity × price; the counter's invoice (business_json.invoice, the form
 * CBTax.determine() gives) carried on 3 bills in 4 — its TotInvVal equal to the lines, rounded to the rupee with RndOffAmt, or disagreeing
 * by a rupee; tender cash · UPI · card · two parts · short · over (with change) · nothing · credit with a due date; a 5,000-character
 * subject; Devanagari, Arabic and emoji particulars. billed_at and bill_no come from the record's index, never the clock, so one
 * record replays as it ran.
 *
 * What every record must do (the checks hold TODAY unless marked gap):
 *   GS-1  never a 500: stored, or refused with a sentence (refused BY NAME)
 *   GS-2  a stored bill reads back line for line as sent, from the live rows (live_set, lines_from 'chit_line': particulars, quantity, price)
 *   GS-3  its value (chit_detail.total_value), to the paisa: the carried invoice's TotInvVal (moneyOfInvoice — read, never worked out
 *         again), else the sum of its line totals rounded once (calculateSummary)
 *   GS-6  an invoice whose TotInvVal disagrees with its lines is kept as issued AND named on the bill (business_json.tax_check)
 *   GS-4  the tender is kept as the counter sent it (payment.paid, the parts) — freeze at send
 *   GS-5  gap R127 · ADDS-MONEY-1: the parts, less change, add up to the bill — or a due date says the rest is owed. No door checks
 *         this today (COLUMN-13 §2, row /chits/send); it is RECORDED here so the fix (PR 2) turns it green, not written around.
 *
 * Budget 60 s for 200 records (CI measured 6.1 s; GORILLA-TIME goes red past it) · fixed seed 20261029 · GORILLA_N (default 200) · GORILLA_SEED=<n>|random · GORILLA_ONLY=<i> replays one. Run: node tests/send-gorilla-truth.realstack.cjs
 * ⚠️ LOCAL ONLY (the harness refuses anything else). Writes go through the route; the database is only SELECTed.
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const G = require('./lib/gorilla.cjs');
const { DB, j, ok, kase, freshShop, finish } = H;

/* the run tag names the fresh SHOP only (the world); nothing in a record reads it */
const RUN = 'gs' + (Date.now() % 1e10).toString(36);
const FIXED_SEED = 20261029;
const BILLED_FROM = Date.parse('2026-10-29T06:00:00Z');
const cents = (value) => Math.round(Number(value) * 100);
const sameMoney = (left, right) => left !== null && left !== undefined && cents(left) === cents(right);
const round2 = (value) => Math.round(value * 100) / 100;
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

/** the counter's invoice for these lines (CBTax.determine()'s form, tax-free here) — equal, rounded to the rupee, or a rupee off */
function invoiceOf(h, lines, total, no) {
  const kind = h.pick(['equal', 'equal', 'equal', 'rounded', 'off']);
  const issued = kind === 'rounded' ? Math.round(total) : kind === 'off' ? round2(total + 1) : total;
  return {
    kind,
    invoice: {
      DocDtls: { No: no },
      ItemList: lines.map((item, at) => ({ SlNo: String(at + 1), PrdDesc: item.particulars, Qty: item.quantity, UnitPrice: item.price, TotAmt: item.total, AssAmt: item.total, TotItemVal: item.total })),
      ValDtls: { AssVal: total, CgstVal: 0, SgstVal: 0, IgstVal: 0, TotInvVal: issued, RndOffAmt: kind === 'rounded' ? round2(issued - total) : 0 }
    }
  };
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
    const total = round2(lines.reduce((sum, item) => sum + item.total, 0));
    const no = 'G' + index;
    const carried = h.chance(0.75) ? invoiceOf(h, lines, total, no) : null;
    const mode = h.pick(MODES);
    const payment = tenderOf(h, mode, carried ? carried.invoice.ValDtls.TotInvVal : total);
    const subject = h.chance(0.05) ? 'Counter sale ' + 'x'.repeat(5000) : 'Counter sale ' + no;
    return {
      recipients: [{ self: true, name: 'self' }], purpose: 'order', subject, manual_subject: subject, client_ref: no,
      business_json: Object.assign({ customer: { name: 'Walk-in' }, till: { id: 'C1', name: 'Counter 1', host: 'browser' }, bill_no: no,
        billed_at: new Date(BILLED_FROM + index * 1000).toISOString(), payment: { mode: payment.mode, paid: payment.paid, change: payment.change, parts: payment.parts }, slip: 'cash' },
      payment.terms ? { terms: payment.terms } : {}, carried ? { invoice: carried.invoice } : {}),
      line_items: lines,
      _invoice: carried ? carried.kind : 'none'
    };
  };
}

/** send one bill, then read MY copy back the way the api answers it */
function sender(shop, pg) {
  return async (record) => {
    const { _invoice, ...body } = record;
    const sent = await j('/api/chits/send', { method: 'POST', token: shop.token, body });
    const seen = { status: sent.status, said: textOf(sent.b), chit_id: sent.b && sent.b.chit_id };
    if (sent.status >= 300 || !seen.chit_id) return seen;
    const back = await j('/api/chits/' + seen.chit_id, { token: shop.token });
    seen.readStatus = back.status;
    seen.linesFrom = back.b.lines_from;
    seen.lines = Array.isArray(back.b.live_set) ? back.b.live_set.filter((entry) => entry.live).map((entry) => entry.live) : null;
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
    if (seen.linesFrom !== 'chit_line') return 'the lines came from ' + seen.linesFrom + ', not the live rows (chit_line)';
    if (!seen.lines) return 'the read answered HTTP ' + seen.readStatus + ' with no live_set';
    if (seen.lines.length !== record.line_items.length) return record.line_items.length + ' lines sent, ' + seen.lines.length + ' read back';
    const moved = record.line_items.findIndex((sentLine, at) => {
      const back = seen.lines[at];
      return back.particulars !== sentLine.particulars || Number(back.quantity) !== sentLine.quantity || cents(back.price) !== cents(sentLine.price);
    });
    return moved < 0 ? null : 'line ' + moved + ' sent ' + JSON.stringify([record.line_items[moved].particulars.slice(0, 20), record.line_items[moved].quantity, record.line_items[moved].price]) +
      ', read ' + JSON.stringify([String(seen.lines[moved].particulars).slice(0, 20), seen.lines[moved].quantity, seen.lines[moved].price]);
  } },
  { id: 'GS-3', title: "its value, to the paisa: the invoice's TotInvVal when one is carried; with none, NO figure is invented (ACC-206: the route adds nothing up)", check: (record, seen) => {
    if (!stored(seen)) return null;
    const invoice = record.business_json.invoice;
    if (!invoice) return seen.value === null || Number(seen.value) === 0 ? null : 'value ' + seen.value + ' on a bill that carries no invoice: a sum was invented (the column holds 0 for not-applicable)';
    const expected = round2(Number(invoice.ValDtls.TotInvVal));
    return sameMoney(seen.value, expected) ? null : 'value ' + seen.value + ', expected ' + expected + ' (the invoice, ' + record._invoice + ')';
  } },
  { id: 'GS-4', title: 'the tender is kept as the counter sent it', check: (record, seen) => {
    if (!stored(seen)) return null;
    const kept = seen.business && seen.business.payment;
    const sentPayment = record.business_json.payment;
    if (!kept) return 'no payment on the stored bill';
    const partsOf = (payment) => (payment.parts || []).map((part) => part.how + ':' + cents(part.amount)).join(',');
    return sameMoney(kept.paid, sentPayment.paid) && partsOf(kept) === partsOf(sentPayment) ? null : 'sent ' + JSON.stringify(sentPayment) + ', kept ' + JSON.stringify(kept);
  } },
  { id: 'GS-5', title: 'ADDS-MONEY-1: the parts, less change, add up to the bill — or a due date names the rest', gap: 'R127 · no door checks it (COLUMN-13 §4 PR 2)', check: (record, seen) => {
    if (!stored(seen)) return null;
    const payment = record.business_json.payment;
    const tendered = (payment.parts || []).reduce((sum, part) => sum + Number(part.amount), 0) - Number(payment.change || 0);
    const owed = record.business_json.terms && record.business_json.terms.due_on;
    return sameMoney(seen.value, tendered) || owed ? null : 'stored as paid with ' + round2(tendered) + ' tendered on a bill of ' + seen.value + ', and no due date';
  } },
  { id: 'GS-6', title: 'an invoice whose total disagrees with its lines is kept as issued and named on the bill (tax_check)', check: (record, seen) => {
    if (!stored(seen) || record._invoice !== 'off') return null;
    const check = seen.business && seen.business.tax_check;
    return check && check.kept === 'issued' ? null : 'TotInvVal a rupee off its lines, stored with no tax_check';
  } }
];

(async () => {
  console.log('\n══ GORILLA · POST /api/chits/send · ' + RUN + ' ══\n');
  const pg = new Client({ connectionString: DB });
  let report = null;
  await pg.connect();
  try {
    const shop = await freshShop(RUN, 'Gorilla Send');
    const products = [];
    for (const [name, price] of [['Rice', 60], ['Dal', 40], ['Oil', 30], ['Salt', 20], ['Tea', 50], ['Soap', 25.5]]) {
      const made = ok(await j('/api/products', { method: 'POST', token: shop.token, body: { item_data: { name, unit: 'piece', price } } }), 'product ' + name).b;
      products.push({ id: made.item.item_id, name, unit: 'piece', price });
    }
    report = await G.hammer({ label: 'POST /api/chits/send', file: 'tests/send-gorilla-truth.realstack.cjs', fixedSeed: FIXED_SEED, make: makeBill(products), send: sender(shop, pg), checks: CHECKS, kase, budgetMs: 60000 });
  } finally {
    await pg.end();
  }
  /* finish writes GORILLA_JSON last, so the gorilla's failing indexes ride along with the cases */
  finish('send-gorilla', process.env.GORILLA_JSON, { gorilla: report });
})().catch((e) => { console.error('send-gorilla could not run: ' + e.message); process.exit(1); });
