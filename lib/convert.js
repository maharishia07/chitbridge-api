'use strict';
// @stage poc
// @stage-note The conversion engine. Pure: no database, no network, no clock it is not handed. Proven by
//             tests/convert.test.cjs and shown by the conversion lab. No route calls it yet.
// @stage-why  Athi asked for a conversion lab "similar to offer lab" — and the offer lab works because the
//             ENGINE is separable and the lab is a page over it. Same shape here, engine first.
/**
 * ── ⭐⭐⭐ WHAT A QUANTITY IS WORTH, AND WHO SAID SO ──────────────────────────────────────────────────────────────
 *
 * Athi, 2026-09-15: *"we should be creating a conversion lab, reading data from a chit or a catalogue, convert
 * to another currency, and also read the qty and provide value according to current value, bullion market or
 * commodity market."*
 *
 * Two different questions that look like one:
 *
 *     CURRENCY   ₹1,000 → how many dirhams?            a RATE between two currencies
 *     COMMODITY  12 grams of gold → how much is that?  a PRICE per unit, then currency
 *
 * ⭐ AND THE SECOND ONE IS A CHAIN, WHICH IS WHY THEY BELONG IN ONE FILE: 12 g → price per gram in USD → USD to
 * INR. Two conversions, two rates, two sources, and a reader who deserves to see both.
 *
 * ── ⚠️⚠️ THE RULE THAT SHAPES EVERYTHING HERE: A RATE IS EVIDENCE, NOT A NUMBER ──────────────────────────────────
 *
 * lib/money.js refuses to convert, deliberately and correctly — *"an amount is labelled"*, and a conversion is
 * a claim about the world at a moment. So this file does not quietly do what money.js refuses. It does the
 * conversion ONLY when handed a rate that says where it came from and when, and it returns the workings.
 *
 * ⚠️ NO FEED, ON PURPOSE. A live market price is somebody's paid subscription and somebody else's licence
 * terms, and a hard-coded one is a number that is wrong by tomorrow and lies about it. The rate is an INPUT with
 * a declared provenance: pasted by a person, stored by an operator, or fetched from a source they chose. The
 * engine is the asset; the feed is a plug. [[feedback-adopt-dont-reinvent]]
 *
 * ⚠️ AND IT NEVER INVENTS AN INVERSE IT WAS NOT GIVEN… unless asked. `invert: true` says "you may use 1/rate",
 * which is arithmetically fine and commercially often wrong — a bank's buy and sell are not reciprocal. Off by
 * default, and the workings say when it happened.
 */

const money = require('./money');
const units = require('./units');

/** how sure we are of a number, in the order a reader should trust them */
const PROVENANCE = ['quoted', 'contract', 'published', 'stored', 'typed', 'unknown'];

/**
 * A rate, with its evidence.
 * @typedef {{from:string, to:string, rate:number, as_of:string, source:string, provenance:string}} Rate
 */
function rate(from, to, value, meta) {
  const m = meta || {};
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error('a rate must be a positive number — ' + JSON.stringify(value) + ' is not one');
  }
  if (!from || !to) throw new Error('a rate must say what it converts from and to');
  return {
    from: String(from).toUpperCase(), to: String(to).toUpperCase(), rate: n,
    /* ⚠️ a rate with no date is a rate nobody can check. Absent is recorded as absent, never as "now" — dating
       it with the moment somebody happened to run the code is inventing evidence. */
    as_of: m.as_of || null,
    source: m.source || null,
    provenance: PROVENANCE.includes(m.provenance) ? m.provenance : 'unknown',
  };
}

const keyOf = (r) => r.from + '>' + r.to;

/** A table of rates. ⚠️ Later rates replace earlier ones for the same pair — a caller layering a fresher sheet
 *  over a stale one should get the fresher answer without having to remove anything. */
function table(rates) {
  const by = new Map();
  for (const r of rates || []) by.set(keyOf(r), r);
  return {
    get: (from, to) => by.get(String(from).toUpperCase() + '>' + String(to).toUpperCase()) || null,
    all: () => [...by.values()],
    size: by.size,
  };
}

/**
 * Convert an amount of money into another currency.
 *
 * @returns {{ok, amount?, why, workings:Array}} — ⚠️ never throws on a missing rate: "I cannot" is an answer a
 *          screen can show, and an exception is not.
 */
function convertMoney(amount, to, rates, opts) {
  const o = opts || {};
  const from = money.currencyOf(amount);
  const value = money.amountOf(amount);
  const target = String(to).toUpperCase();
  const workings = [];

  if (from === target) {
    return { ok: true, amount: money.make(value, target), why: 'already in ' + target, workings };
  }

  let r = rates.get(from, target);
  let inverted = false, held = null;
  if (!r && o.invert) {
    const back = rates.get(target, from);
    if (back) {
      held = back.rate;
      /* ⚠️ ARITHMETICALLY FINE, COMMERCIALLY OFTEN WRONG: a bank's buy and sell are not reciprocal, so this
         is off unless a caller says otherwise, and it is always declared in the workings. */
      r = rate(from, target, 1 / back.rate,
        { as_of: back.as_of, source: back.source, provenance: back.provenance });
      inverted = true;
    }
  }
  if (!r) {
    return { ok: false, why: 'no rate from ' + from + ' to ' + target
      + (o.invert ? '' : ' (and inverting was not permitted)'), workings };
  }

  const out = round(value * r.rate, o.dp === undefined ? 2 : o.dp);
  /**
   * ⚠️ AN INVERTED RATE IS SAID AS A DIVISION BY THE RATE ACTUALLY HELD, not as its reciprocal. 1/88.2 prints as
   * 0.011337868480725623, which is true, unreadable, and impossible for a person to check against anything.
   * "8820 INR ÷ 88.2" is the same arithmetic and a reader can verify it against the rate on the sheet in front
   * of them — which is the entire point of showing the workings.
   */
  workings.push({
    step: 'currency', from, to: target, rate: r.rate, inverted,
    ...(inverted ? { held_rate: held, held_pair: target + '>' + from } : {}),
    as_of: r.as_of, source: r.source, provenance: r.provenance,
    say: inverted
      ? value + ' ' + from + ' ÷ ' + held + ' = ' + out + ' ' + target + ' (1 ÷ the ' + target + '>' + from + ' rate)'
      : value + ' ' + from + ' × ' + r.rate + ' = ' + out + ' ' + target,
  });
  return { ok: true, amount: money.make(out, target), why: 'converted', workings };
}

/**
 * What a QUANTITY of something is worth — the bullion / commodity question.
 *
 * @param qty      { qty:number, unit:string }   12 grams
 * @param priceOf  { per_unit:string, price:Money-like {amount,currency}, ...meta }  the market price
 * @param to       currency the answer should be in (optional; defaults to the price's own)
 *
 * ⚠️ IT REFUSES A UNIT MISMATCH RATHER THAN CONVERTING IT. lib/units never relates two different units because
 * a factor is product-specific; the same rule holds here. 12 kg priced per gram is a question this cannot
 * answer, and answering it with a guessed 1000× is how a valuation becomes wrong by three orders of magnitude.
 */
function valueOf(qty, priceOf, rates, opts) {
  const o = opts || {};
  const workings = [];
  const n = Number(qty && qty.qty);
  if (!Number.isFinite(n) || n < 0) return { ok: false, why: 'a quantity must be a number', workings };
  if (!priceOf || !priceOf.price) return { ok: false, why: 'no market price given', workings };

  const have = units.normUnit(qty.unit);
  const per = units.normUnit(priceOf.per_unit);
  if (!units.sameUnit(have, per)) {
    return { ok: false, workings,
      why: 'the price is per ' + per + ' and the quantity is in ' + have
         + ' — a factor between two units is product-specific and this engine will not invent one' };
  }

  const ccy = money.currencyOf(priceOf.price);
  const unitPrice = money.amountOf(priceOf.price);
  const gross = round(n * unitPrice, o.dp === undefined ? 2 : o.dp);
  workings.push({
    step: 'market', qty: n, unit: have, unit_price: unitPrice, currency: ccy,
    as_of: priceOf.as_of || null, source: priceOf.source || null,
    provenance: PROVENANCE.includes(priceOf.provenance) ? priceOf.provenance : 'unknown',
    say: n + ' ' + have + ' × ' + unitPrice + ' ' + ccy + '/' + per + ' = ' + gross + ' ' + ccy,
  });

  let out = money.make(gross, ccy);
  if (o.to && String(o.to).toUpperCase() !== ccy) {
    const conv = convertMoney(out, o.to, rates, o);
    workings.push(...conv.workings);
    if (!conv.ok) return { ok: false, why: conv.why, workings, amount: out };
    out = conv.amount;
  }
  return { ok: true, amount: out, why: 'valued', workings };
}

/**
 * Value a whole basket of lines — a chit's lines, a catalogue's items, or anything else shaped
 * `{ qty, unit, item_id?, name? }`.
 *
 * ⚠️⚠️ IT KNOWS NOTHING ABOUT CHITS. It is handed an array. That is deliberate and it is what lets this be an
 * asset: a caller reads a chit, a catalogue, a spreadsheet or a CSV and hands over lines.
 *
 * ⚠️ A LINE IT CANNOT VALUE DOES NOT VANISH. It comes back in `refused`, with the reason. A total that silently
 * skipped two lines is worse than no total. [[feedback-silence-is-the-bug]]
 */
function valueLines(lines, prices, rates, opts) {
  const o = opts || {};
  const priced = [], refused = [];
  let total = 0, ccy = o.to ? String(o.to).toUpperCase() : null;

  for (const l of lines || []) {
    const key = l.item_id || l.name || l.sku;
    const p = prices && (prices[key] || prices[String(key).toLowerCase()]);
    if (!p) { refused.push({ line: l, why: 'no market price for ' + key }); continue; }
    const v = valueOf({ qty: l.qty, unit: l.unit }, p, rates, o);
    if (!v.ok) { refused.push({ line: l, why: v.why, workings: v.workings }); continue; }
    const a = money.amountOf(v.amount), c = money.currencyOf(v.amount);
    if (!ccy) ccy = c;
    if (c !== ccy) { refused.push({ line: l, why: 'valued in ' + c + ', not ' + ccy }); continue; }
    total = round(total + a, o.dp === undefined ? 2 : o.dp);
    priced.push({ line: l, amount: v.amount, workings: v.workings });
  }

  return {
    ok: refused.length === 0,
    total: ccy ? money.make(total, ccy) : null,
    priced, refused,
    /* ⭐ the sentence a reader needs before they trust the number */
    why: refused.length
      ? priced.length + ' of ' + (priced.length + refused.length) + ' lines valued — ' + refused.length
        + ' could not be, and are listed'
      : priced.length + ' lines valued',
  };
}

/**
 * The OTHER basket, and it is the commoner one: lines that already carry a price, read into another currency.
 * A catalogue priced in rupees, seen in dirhams. A chit's lines, read by the party on the other side.
 *
 * @param lines  `{ qty?:number, price:{amount,currency}, item_id?, name? }` — qty defaults to 1
 *
 * ⭐ MIXED SOURCE CURRENCIES ARE THE POINT, not a fault: a basket assembled from two suppliers has two
 * denominations and the question is precisely what the pair comes to in a third. Each line is converted on its
 * own rate and the workings say which.
 *
 * ⚠️ THE SAME RULE AS valueLines: a line it cannot convert is REFUSED, listed, and the total is not `ok`.
 * [[feedback-silence-is-the-bug]]
 *
 * ⚠️ AND THE MULTIPLICATION HAPPENS HERE, not in a page. qty × price is arithmetic a screen could do in one
 * line — and then the "a refused line does not vanish" rule would live in two places, which for a rule that
 * only has to fail once is one place too many.
 */
function convertLines(lines, to, rates, opts) {
  const o = opts || {};
  const target = to ? String(to).toUpperCase() : null;
  const priced = [], refused = [];
  let total = 0, ccy = target;

  for (const l of lines || []) {
    const q = l.qty === undefined || l.qty === null ? 1 : Number(l.qty);
    if (!Number.isFinite(q) || q < 0) { refused.push({ line: l, why: 'a quantity must be a number' }); continue; }
    let from, unit;
    try { from = money.currencyOf(l.price); unit = money.amountOf(l.price); }
    catch (_) { from = null; unit = null; }
    if (!from || !Number.isFinite(Number(unit))) {
      /* ⚠️ a bare number is NOT a price here. lib/money exists because a denomination must travel with the
         amount; accepting an unlabelled number would put the guessing back exactly where it was removed from. */
      refused.push({ line: l, why: 'no priced amount — a price must carry its currency' });
      continue;
    }
    const gross = round(q * Number(unit), o.dp === undefined ? 2 : o.dp);
    const conv = convertMoney(money.make(gross, from), target || from, rates, o);
    if (!conv.ok) { refused.push({ line: l, why: conv.why, workings: conv.workings }); continue; }
    const c = money.currencyOf(conv.amount);
    if (!ccy) ccy = c;
    if (c !== ccy) { refused.push({ line: l, why: 'converted to ' + c + ', not ' + ccy }); continue; }
    total = round(total + money.amountOf(conv.amount), o.dp === undefined ? 2 : o.dp);
    priced.push({
      line: l, from, qty: q, unit_price: Number(unit), amount: conv.amount,
      workings: [{ step: 'line', qty: q, unit_price: Number(unit), currency: from,
        say: q + ' × ' + unit + ' ' + from + ' = ' + gross + ' ' + from }].concat(conv.workings),
    });
  }

  return {
    ok: refused.length === 0,
    total: ccy ? money.make(total, ccy) : null,
    priced, refused,
    why: refused.length
      ? priced.length + ' of ' + (priced.length + refused.length) + ' lines converted — ' + refused.length
        + ' could not be, and are listed'
      : priced.length + ' lines converted',
  };
}

/** ⚠️ round HALF UP at a fixed dp, not toFixed's binary surprise — money must add up the way a person checks it */
function round(n, dp) {
  const f = Math.pow(10, dp);
  return Math.round((n + Number.EPSILON) * f) / f;
}

module.exports = { rate, table, convertMoney, valueOf, valueLines, convertLines, PROVENANCE, round };
