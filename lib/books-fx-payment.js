/**
 * books-fx-payment.js — A PAYMENT IN OR AGAINST A FOREIGN CURRENCY: the bank's rate, the open foreign bill it settles, and what it says back (ACC-377; split out of books.js, whose size row may not grow).
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      foreignPayment · afterPosting · fxPaymentOutcome · settlementFigures
 * CALLED BY lib/books.js (recordPayment) · routes/books.js (POST /payments answers through fxPaymentOutcome)
 * FLOW      a payment body ──▶ foreignPayment (the rate it states, or the foreign bill it settles; refused in words) ──▶ the one composition (lib/fx-rates forEvent → CBPosting fx_settlement)
 *           ──▶ afterPosting (the carried amount to allocate in the books' own currency, the gain or loss to say) ──▶ fxPaymentOutcome (the shopkeeper's sentence)
 * CARD      14-accounting/foreign-currency
 * One calculation: every figure here is CBPosting's (fx_settlement) read back from the composed lines; this file decides only WHICH rate a payment names and WHAT it says.
 */
'use strict';
const books = require('./books');
const fxRates = require('./fx-rates');
const { money } = require('./books-payment-advice');

const upper = (value) => String(value || '').toUpperCase();
/** a rate as a shopkeeper reads it: 56.100000 → 56.1 */
const plainRate = (rate) => String(rate).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');

/**
 * foreignPayment(handle, entity, payment) → null | { currency, amount_minor, fx_rate, fx_rate_source } — the payment's own rate (lib/fx-rates paymentTerms), read once.
 * A payment in the books' own currency that would settle bills (allocate / allocations) while the party has a bill open in a FOREIGN currency is refused in words: it must say how
 * many of that currency it pays (settles), or the bill stays open at its old rate with the gain or loss never posted (critic T8 / G4).
 */
async function foreignPayment(handle, entity, payment) {
  const allocating = settlesBills(payment);
  if (!statesTerms(payment) && !allocating) return null;
  const functional = books.packOf(payment.setting || (await books.settingOf(handle, entity))).currency;
  const terms = fxRates.paymentTerms(payment, functional);
  if (terms) return termsOf(payment, terms);
  if (allocating && (!upper(payment.currency) || upper(payment.currency) === functional)) await refuseOpenForeign(handle, entity, payment, functional);
  return null;
}
/** does this payment settle bills (oldest first, or the ones it names)? a cheque settles when it clears, never now */
const settlesBills = (payment) => payment.mode !== 'cheque' && (payment.allocate === 'oldest_first' || (Array.isArray(payment.allocations) && payment.allocations.length > 0));
/** does this payment state a rate (fx_rate) or the foreign amount it settles (settles)? */
const statesTerms = (payment) => (payment.fx_rate != null && payment.fx_rate !== '') || !!(payment.settles && typeof payment.settles === 'object');
/** the payment's own rate, as recordPayment carries it (named "bank": it is the bank's) — a foreign cheque waits until it clears */
function termsOf(payment, terms) {
  if (payment.mode === 'cheque') throw books.refuse('A cheque in a foreign currency is recorded when it clears — say the rate then.');
  return { currency: terms.currency, amount_minor: terms.amount_minor, fx_rate: terms.fx_rate, fx_rate_source: 'bank', bank_minor: terms.bank_minor };
}
/** a payment in the books' own currency that would settle bills, while the party has a bill open in a foreign currency: refused in words, naming what is open */
async function refuseOpenForeign(handle, entity, payment, functional) {
  const open = await fxRates.openForeign(handle, entity, payment.party_id, payment.received_at, functional);
  if (!open.length) return;
  const owed = open.map((item) => books.named(Math.abs(item.txn_minor), item.currency)).join(' and ');
  const currencies = open.map((item) => item.currency).join(' and ');
  throw books.refuse(
    'This party has a bill open in ' + currencies + ' (' + owed + '). Say how much of it this payment settles (settles: { currency, amount_minor }), so the exchange gain or loss is posted — or pay it in ' + open[0].currency + ' with the bank rate.'
  );
}

/**
 * afterPosting(row, posted) → { posted, row, fx } — what a written payment entry hands on. An ordinary payment is returned as it was. A foreign settlement (the writer's `fx_settlement`):
 * `row` becomes the carried amount in the books' OWN currency (what the books carried for the part settled — never the foreign amount against rupee bills; oldest bills first unless the
 * caller named bills or said none), and `fx` says the foreign amount, the rate, what the bank moved, what the books carried and the realised gain (+) or loss (−) in the books' minor units.
 */
function afterPosting(row, posted) {
  const settlement = posted && posted.fx_settlement;
  if (!settlement) return { posted, row, fx: undefined };
  const named = Array.isArray(row.allocations) && row.allocations.length > 0;
  const allocate = named ? row.allocate : row.allocate === 'none' ? 'none' : 'oldest_first';
  return {
    posted: Object.assign({}, posted, { fx_settlement: undefined }),
    row: Object.assign({}, row, { amount_minor: settlement.carried_minor, currency: settlement.fn, allocate }),
    fx: {
      currency: upper(row.currency),
      functional: settlement.fn,
      amount_minor: row.amount_minor,
      rate: settlement.rate,
      bank_minor: settlement.bank_minor,
      carried_minor: settlement.carried_minor,
      gain_minor: settlement.gain_minor
    }
  };
}

/**
 * fxPaymentOutcome(handle, entity, payment, payment_id, allocation, name, foreign) — paymentOutcome for a foreign payment, in the shopkeeper's words: the foreign amount, what the bank moved
 * at what rate, the bills settled (at what the books CARRIED), and the realised exchange gain or loss. The figures are the settlement's (afterPosting's `fx`), the sentence is built here only.
 */
async function fxPaymentOutcome(handle, entity, payment, payment_id, allocation, name, foreign) {
  const carriedPayment = Object.assign({}, payment, { amount_minor: foreign.carried_minor, currency: foreign.functional });
  const base = await books.paymentOutcome(handle, entity, carriedPayment, payment_id, allocation, name);
  const out = payment.direction === 'out';
  let words = (out ? 'Paid ' : 'Received ') + books.named(foreign.amount_minor, foreign.currency) + (out ? ' to ' : ' from ') + (name || 'the party');
  words += ' — ' + money(foreign.bank_minor, foreign.functional) + (foreign.rate == null ? '.' : ' at ' + plainRate(foreign.rate) + '.');
  if (base.settled.length) {
    const count = base.settled.length;
    words += ' Settled ' + count + (count === 1 ? ' bill' : ' bills') + ' (' + money(base.applied_minor, foreign.functional) + ' as the books carried it).';
  }
  if (foreign.gain_minor > 0) words += ' Exchange gain ' + money(foreign.gain_minor, foreign.functional) + '.';
  else if (foreign.gain_minor < 0) words += ' Exchange loss ' + money(-foreign.gain_minor, foreign.functional) + '.';
  return Object.assign(base, { words });
}

/** what a foreign settlement posted, READ from the engine's composed lines (nothing is computed here): the party's carried amount, what the bank moved, and the realised gain (+) or loss (−) — all in the books' own minor units; {} for any other event */
function settlementFigures(fxPosting, posted, lines) {
  if (!fxPosting || fxPosting.ev.type !== 'fx_settlement') return {};
  const party = lines.find((line) => line.party_id),
    bank = lines.find((line) => !line.party_id && String(line.code) !== '4260'),
    gain = lines.find((line) => String(line.code) === '4260');
  const minor = (line) => (line ? line.dr_minor || line.cr_minor : null);
  const signed = gain ? (gain.cr_minor ? gain.cr_minor : -gain.dr_minor) : 0;
  return { carried_minor: minor(party), bank_minor: minor(bank), gain_minor: signed, fn: posted.currency };
}

module.exports = { foreignPayment, afterPosting, fxPaymentOutcome, settlementFigures };
