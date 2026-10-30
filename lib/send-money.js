'use strict';
/**
 * lib/send-money.js — WHICH CHITS THE ENGINE BILLS AT SEND, THE CALL, AND WHAT THE ENGINE SAID (ACC-206 A · Athi 2026-10-30).
 *
 * "it cannot compute, the compute engine does it, afterwards, everything is data, no computation anywhere, whatsoever it may be."
 * OWNS    the scope of the engine at send (scopeOf) · the one engine call for a chit that carries no invoice (invoiceAtSend) ·
 *         the bridge's verdict as DATA (stopOf, pick only) · the stamps that name who wrote each figure (stampsOf).
 * CALLED BY routes/chits.js sendMoney / sendBridge / sendSummary.
 * FLOW    send → scopeOf(st) → invoiceAtSend (the engine: lib/tax-lines → lib/tax determine) → the chit carries the invoice →
 *         the header copies its figures (moneyOfInvoice) → stopOf(invoice) says whether the engine's own bridge balanced.
 * ⚠️ NO ARITHMETIC HERE. Every figure is read off the engine's answer; the file holds no sum, no difference, no rounding
 *    (tests/money-no-arithmetic.test.cjs proves it by scan).
 * CARD 01-rail-core-the-chit/README
 */
const { query } = require('../db');
const policy = require('./policy');
const taxLines = require('./tax-lines');
const offersLive = require('./offers-live');
const lock = require('../engines.lock.json');

/** the purposes that ARE a billing document: a buyer's order, a seller's invoice, a credit note. An offer or a negotiation is not (routes/catalogue.js T2.1: a figure neither party agreed). */
const BILLING_PURPOSES = ['order', 'invoice', 'credit_note'];

/** is this a captured sale — a message the shop recorded as its own priced sale (the intake page files it as `general`)? Same test as sendOffers. */
function isCapturedSale(purpose, business_json) {
  return !!(business_json && business_json.via) && offersLive.isSalesDocument(purpose, business_json);
}

/**
 * scopeOf(state) → { kind: 'carried' | 'engine' | 'none', why }
 *   carried — the chit already holds its invoice (the counter computed it with the same engine): the header copies it
 *   engine  — a billing document with no invoice yet: the engine is asked ONCE, here, at the origin
 *   none    — not a billing document, several recipients, no lines, or a counter bill that carries NO invoice (an older till): money is NOT
 *             APPLICABLE / UNKNOWN — null, never 0, never a sum (docs/critique/ACC-206-A-B.md J2: the counter did not compute it, and the server does not invent a slip the customer never held)
 */
function scopeOf(state) {
  const { purpose, business_json, counterBill, orderLike, toIds, line_items } = state;
  if (business_json && business_json.invoice && typeof business_json.invoice === 'object') return { kind: 'carried', why: 'the invoice travels with the chit' };
  if (counterBill) return { kind: 'none', why: 'a counter bill that carries no invoice' };
  if (!pricedLines(line_items).length) return { kind: 'none', why: 'no lines' };
  if (!isBillingDocument(purpose, business_json)) return { kind: 'none', why: 'not a billing document' };
  if (!orderLike && toIds.length > 1) return { kind: 'none', why: 'more than one recipient — no single buyer to bill' };
  return { kind: 'engine', why: 'billing document' };
}

/** the lines that count: a removed line is not on the bill */
const pricedLines = (lines) => (Array.isArray(lines) ? lines.filter((item) => item && !item.removed) : []);

/** a billing purpose (order · invoice · credit note), or a captured sale */
const isBillingDocument = (purpose, business_json) => BILLING_PURPOSES.includes(String(purpose)) || isCapturedSale(purpose, business_json);

/** the buyer's identity id for the engine call: the order's buyer is its sender; any other document's buyer is its one `to`; nobody named → null (the walk-in of the shop's country) */
function buyerIdOf(state) {
  const { orderLike, toIds, sender_id, counterBill } = state;
  if (toIds.length !== 1) return null;
  return orderLike && !counterBill ? String(sender_id) : toIds[0];
}

/**
 * ⚠️ A LINE THE ENGINE CANNOT READ IS REFUSED, NOT PRICED AT ZERO. A present price or quantity that is not a number reads as 0 inside the
 * engine's coercion (a silent free line); the route answers 422 first. → the first unreadable line's { line, field } or null. A blank is
 * "no figure given", which is a different (valid) thing.
 */
function unreadableLine(lines) {
  const present = (value) => value !== undefined && value !== null && String(value).trim() !== '';
  const unreadable = (value) => present(value) && !Number.isFinite(Number(value));
  const list = Array.isArray(lines) ? lines : [];
  for (let at = 0; at < list.length; at++) {
    const item = list[at] || {};
    for (const field of ['price', 'quantity', 'total', 'list_price', 'discount']) if (unreadable(item[field])) return { line: at, field };
  }
  return null;
}

/**
 * invoiceAtSend(state) → the INV-01 invoice the engine answered (with its `_cb.bridge`), or throws (the caller answers 503 MONEY_NOT_COMPUTED).
 * Both parties are read in ONE query; the seller's own flag says whether its prices include tax; a buyer nobody named is the walk-in of the
 * SELLER'S country (tax-lines.walkIn, inside invoiceFor). The offers engine's applied list is NOT handed in yet (docs/critique/ACC-206-A-B.md J1),
 * so the bridge's step 2 is the lines' own discounts as one declared row.
 */
async function invoiceAtSend(state) {
  const { line_items, business_json, currency_code } = state;
  const { seller, buyer } = await partiesOf(state);
  /* ⭐⭐⭐ [REV-01] the SELLER's own setting says whether the shelf price already holds the tax (absent, a GST-inclusive price was taxed again: "every server invoice is 18% too high") */
  const priceIncludesTax = policy.flagOf(seller.policy_flags, 'price_includes_tax', seller.country) === 'yes';
  /* ⚠️ [REV-02] the invoice's own document date, not the moment sync ran */
  const at = (business_json && business_json.billed_at) || new Date().toISOString();
  const answer = taxLines.invoiceFor({ lines: line_items, seller: taxLines.partyOf(seller), buyer: buyer ? taxLines.partyOf(buyer) : {}, currency: currency_code, at, priceIncludesTax });
  if (!answer || !answer.invoice || !answer.invoice.ValDtls) throw new Error('the engine gave no invoice');
  return answer.invoice;
}

/** the seller's and the buyer's identity rows, read in ONE query; the buyer is null for a walk-in. Throws when a party the chit names is not on record (the caller answers 503). */
async function partiesOf(state) {
  const sellerId = String(state.sellerId);
  const named = buyerIdOf(state);
  const buyerId = named && String(named) !== sellerId ? String(named) : null;
  const read = await query('SELECT identity_id, gstn, display_name, policy_flags, country FROM identities WHERE identity_id = ANY($1::uuid[])', [[sellerId].concat(buyerId ? [buyerId] : [])]);
  const rowOf = (id) => read.rows.filter((row) => String(row.identity_id) === String(id))[0] || null;
  const seller = rowOf(sellerId);
  const buyer = buyerId ? rowOf(buyerId) : null;
  if (!seller) throw new Error('the seller is not on record');
  if (buyerId && !buyer) throw new Error('the buyer is not on record');
  return { seller, buyer };
}

/**
 * stopOf(invoice) → null when the engine's own bridge balanced (or the invoice carries none — frozen before v1.74.0, or a counter on an older engine copy);
 * else { step, line?, unexplained_minor, words, gross_minor, total_minor } — every field READ off the engine's answer, never worked out here.
 */
function stopOf(invoice) {
  const bridge = invoice && invoice._cb && invoice._cb.bridge;
  if (!bridge || bridge.ok !== false) return null;
  const stepAmount = (name) => {
    const row = (bridge.steps || []).filter((item) => item && item.name === name)[0];
    return row ? row.amount_minor : null;
  };
  return { step: bridge.step, line: bridge.line, unexplained_minor: bridge.unexplained_minor, words: bridge.words, gross_minor: stepAmount('gross'), total_minor: stepAmount('total') };
}

/** the engine copy's version, as the platform pins it (engines.lock.json) — named on every figure's stamp */
function engineVersion() {
  return String(lock.pins && lock.pins.tax);
}

/**
 * stampsOf(at) → who wrote each stored figure (DECISIONS 2026-10-30: "naming the place that wrote it"). Rides summary_json.stamps beside the figures it names.
 * `where` says whether the engine's invoice was computed at the counter, or here at send; the route only copies it.
 */
function stampsOf(at, where) {
  return {
    money: { by: 'chits send', engine: 'tax@' + engineVersion(), where, at },
    total_value: { by: 'chits send', from: 'money.total', at }
  };
}

module.exports = { BILLING_PURPOSES, scopeOf, buyerIdOf, unreadableLine, invoiceAtSend, stopOf, stampsOf, engineVersion };
