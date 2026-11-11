'use strict';
/**
 * lib/send-money.js — WHICH CHITS THE ENGINE BILLS AT SEND, THE CALL, AND WHAT THE ENGINE SAID (ACC-206 A · Athi 2026-10-30).
 *
 * "it cannot compute, the compute engine does it, afterwards, everything is data, no computation anywhere, whatsoever it may be."
 * OWNS    the scope of the engine at send (scopeOf) · THE ONE engine call for one set of lines (invoiceOfLines: a send through invoiceAtSend,
 *         and a change order through lib/chit-proposal priceMoney, RAIL-106) ·
 *         the bridge's verdict as DATA (stopOf, pick only) · the stamps that name who wrote each figure (stampsOf).
 * CALLED BY routes/chits.js sendMoney / sendBridge / sendSummary · lib/chit-proposal.js priceMoney (the seller prices a round).
 * FLOW    send → scopeOf(st) → invoiceAtSend (the engine: lib/tax-lines → lib/tax determine) → the chit carries the invoice →
 *         the header copies its figures (moneyOfInvoice) → stopOf(invoice) says whether the engine's own bridge balanced.
 * ⚠️ NO ARITHMETIC HERE. Every figure is read off the engine's answer; the file holds no sum, no difference, no rounding
 *    (tests/money-no-arithmetic.test.cjs proves it by scan).
 * CARD 01-rail-core-the-chit/README
 */
const { query } = require('../db');
const policy = require('./policy');
const taxLines = require('./tax-lines');
const services = require('./services'); /* ACC-271: the ONE unreadable-figure check (ACC-221) */
const offersLive = require('./offers-live');
const taxCopy = require('./tax-copy'); /* CTRY-81: withRecordedPos, the ONE place-of-supply reader (engine placeOfSupply) for a chit's recorded delivery */
const lock = require('../engines.lock.json');
const log = require('./logger');

/** the purposes that ARE a billing document: a buyer's order, a seller's invoice, a credit note. An offer or a negotiation is not (routes/catalogue.js T2.1: a figure neither party agreed). */
const BILLING_PURPOSES = ['order', 'invoice', 'credit_note', 'debit_note'];

/** is this a captured sale — a message the shop recorded as its own priced sale (the intake page files it as `general`)? Same test as sendOffers. */
function isCapturedSale(purpose, business_json) {
  return !!(business_json && business_json.via) && offersLive.isSalesDocument(purpose, business_json);
}

/**
 * scopeOf(state) → { kind: 'carried' | 'quotation' | 'engine' | 'none', why }
 *   carried — the chit already holds its invoice (the counter computed it with the same engine): the header copies it
 *   quotation — the seller is on ANOTHER installation (state.sellerElsewhere, RAIL-106): it prices its own goods there; no engine runs here, money null
 *   engine  — a billing document with no invoice yet: the engine is asked ONCE, here, at the origin
 *   none    — not a billing document, several recipients, no lines, or a counter bill that carries NO invoice (an older till): money is NOT
 *             APPLICABLE / UNKNOWN — null, never 0, never a sum (docs/critique/ACC-206-A-B.md J2: the counter did not compute it, and the server does not invent a slip the customer never held)
 */
function scopeOf(state) {
  const { purpose, business_json, counterBill, orderLike, toIds, line_items } = state;
  if (business_json && business_json.invoice && typeof business_json.invoice === 'object') return { kind: 'carried', why: 'the invoice travels with the chit' };
  if (counterBill) return { kind: 'none', why: 'a counter bill that carries no invoice' };
  if (state.sellerElsewhere) return { kind: 'quotation', why: 'a seller on another installation prices it' };
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
 * ⚠️ A LINE THE ENGINE CANNOT READ IS REFUSED, NOT PRICED AT ZERO (ACC-206 J7, widened by ACC-271). A figure the chit line SENT that is not a number reads as 0
 * inside the engine's coercion (a silent free line, bridge ok). The check is the ONE services.unreadOf (ACC-221, api#919) over the chit line's own keys
 * (quantity · qty · price · unit_price · list_price · total · discount · gst_rate · rate · cess_rate), so the codes are the quote routes' codes: BAD_QTY · BAD_PRICE · BAD_RATE.
 * null / absent = not sent (the shelf may answer); a blank discount / rate / cess / list price / total is absent; a blank qty or price is refused. A removed line is skipped.
 * `unratedBlank` = the lines (index) that SENT a blank rate and that the shelf did not rate either (the route turned the blank into no-rate first, so the shelf could answer): BAD_RATE, never 0%.
 * → the first bad line { line, field, code, message } or null.
 */
/** the unreadable figures of line `at`, [] when it is fine: the sent ones (services.unreadOf), else a blank rate the shelf did not fill (unratedBlank) */
function unreadIn(item, at, unratedBlank) {
  const found = services.unreadOf(item, services.CHIT_SENT_FIELDS);
  if (!found.length && Array.isArray(unratedBlank) && unratedBlank.includes(at)) found.push({ field: 'gst_rate', value: '' });
  return found;
}
function unreadableLine(lines, unratedBlank) {
  const list = Array.isArray(lines) ? lines : [];
  for (let at = 0; at < list.length; at++) {
    const item = list[at];
    if (!item || item.removed) continue;
    const first = unreadIn(item, at, unratedBlank)[0];
    if (first) return { line: at, field: first.field, code: services.UNREAD_CODE[first.field], message: services.unreadSentence('"' + (item.name || item.particulars || 'line ' + (at + 1)) + '"', first) };
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
  return invoiceOfLines({ lines: state.line_items, sellerId: state.sellerId, buyerId: buyerIdOf(state), business_json: state.business_json, purpose: state.purpose, currency_code: state.currency_code });
}

/**
 * ⭐⭐⭐ invoiceOfLines({ lines, sellerId, buyerId, business_json, currency_code }) → THE ONE CALCULATION of the money of one set of lines: the engine's
 * INV-01 invoice. A send asks it (invoiceAtSend) and so does a CHANGE ORDER when the seller prices a round (lib/chit-proposal priceMoney, RAIL-106) —
 * widened from the send so no second calculation exists (ACC-206: the rule holds on every path). buyerId null = the walk-in of the seller's country.
 * Throws (err.code NO_INVOICE when the engine decided none — a seller with no country or tax setup; PARTY_MISSING when a named party is not on record).
 */
async function invoiceOfLines(question) {
  const { lines, business_json, currency_code } = question;
  const { seller, buyer } = await partiesOf(question.sellerId, question.buyerId);
  /* ⭐⭐⭐ [REV-01] the SELLER's own setting says whether the shelf price already holds the tax (absent, a GST-inclusive price was taxed again: "every server invoice is 18% too high") */
  const priceIncludesTax = policy.flagOf(seller.policy_flags, 'price_includes_tax', seller.country) === 'yes';
  /* ⚠️ [REV-02] the invoice's own document date, not the moment sync ran */
  const at = (business_json && business_json.billed_at) || new Date().toISOString();
  /* ⭐ CTRY-81: the stamp reads the recorded delivery the same way the unstamped copy does (tax-copy.withRecordedPos): delivered to the seller's own state = intra, never IGST */
  const buyerParty = taxCopy.withRecordedPos(buyer ? taxLines.partyOf(buyer) : {}, business_json);
  const billDay = taxLines.billDayOf(business_json, question.purpose || (business_json && business_json.purpose), at, seller); /* CTRY-139: the shop's day of the document, for the dated price band */
  const answer = taxLines.invoiceFor({ lines, seller: taxLines.partyOf(seller), buyer: buyerParty, currency: currency_code, at, priceIncludesTax, bill_day: billDay });
  if (!answer || !answer.invoice || !answer.invoice.ValDtls) throw refusedWith('NO_INVOICE', 'the engine gave no invoice');
  return answer.invoice;
}

/** the seller's and the buyer's identity rows, read in ONE query; the buyer is null for a walk-in. Throws when a party the chit names is not on record (the caller answers 503). */
async function partiesOf(sellerOf, named) {
  const sellerId = String(sellerOf);
  const buyerId = named && String(named) !== sellerId ? String(named) : null;
  const read = await query('SELECT identity_id, gstn, display_name, policy_flags, country FROM identities WHERE identity_id = ANY($1::uuid[])', [[sellerId].concat(buyerId ? [buyerId] : [])]);
  const rowOf = (id) => read.rows.filter((row) => String(row.identity_id) === String(id))[0] || null;
  const seller = await taxLines.withRegistration(rowOf(sellerId)); /* ACC-273: the seller's own registration word */
  const buyer = buyerId ? rowOf(buyerId) : null;
  if (!seller) throw refusedWith('PARTY_MISSING', 'the seller is not on record');
  if (buyerId && !buyer) throw refusedWith('PARTY_MISSING', 'the buyer is not on record');
  return { seller, buyer };
}

/** an Error that names why the engine gave no figures (the caller words it; the code lets a change order say "Tax not decided" for a seller with no setup) */
const refusedWith = (code, words) => Object.assign(new Error(words), { code });

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

/**
 * CTR-211 — the pairs the engine wrote TWICE into one invoice: a bridge step (minor units) and the ValDtls figure it must equal (major units).
 * Reading only: the figure is turned into minor units (the api's one toMinor) and tested for equality — no sum, no difference, no recompute here.
 * Per-head tax pairs (CTR-214) are built from the bridge's own `heads[]` rows below (headsMismatchOf), not listed here: the engine names each head, the api holds no head map.
 */
const BRIDGE_PAIRS = [
  { pair: 'total', figure: 'TotInvVal' },
  { pair: 'taxable', figure: 'AssVal' },
  { pair: 'round_off', figure: 'RndOffAmt' }
];

/** the bridge step called `pair` (minor units, as the engine wrote it), or null when the invoice carries no bridge (frozen before v1.74.0) */
function bridgeStepOf(invoice, pair) {
  const bridge = invoice && invoice._cb && invoice._cb.bridge;
  const steps = bridge && Array.isArray(bridge.steps) ? bridge.steps : [];
  const step = steps.find((item) => item && item.name === pair);
  return step && Number.isFinite(step.amount_minor) ? step : null;
}

/** the pair's two carried values, or null when the invoice does not carry one of them: { step, carried } */
function pairValues(invoice, pair, figure) {
  const step = bridgeStepOf(invoice, pair);
  const carried = invoice && invoice.ValDtls ? invoice.ValDtls[figure] : null;
  return step && carried !== undefined && carried !== null ? { step, carried } : null;
}

/**
 * the carried figure written in the minor units the ENGINE wrote the bridge in: the bridge's own `decimals` (the seller pack's currency, a JPY pack 0, a KWD pack 3), read
 * off the invoice, never the chit's stated currency. Digits are moved as TEXT (no arithmetic, no rounding): it is only what the answer and the ticket SHOW. An old bridge with
 * no decimals falls back to the currency's own.
 */
function carriedMinorOf(invoice, figure, currency) {
  const places = invoice._cb.bridge.decimals;
  if (!Number.isInteger(places) || places < 0 || places > 6) return require('./books-cashflow').toMinor(figure, currency);
  const [whole, fraction = ''] = String(Number(figure)).split('.');
  return Number(whole + fraction.padEnd(places, '0').slice(0, places));
}

/** do the two carried values agree? the engine's own step amount against the figure (equality of two carried numbers); a step with no amount compares minor units */
function sameFigure(values, minor) {
  return Number.isFinite(values.step.amount) ? Number(values.carried) === values.step.amount : minor === values.step.amount_minor;
}

/** a bridge that CARRIES its steps but lacks this pair's step or figure: the engine always writes all three, so it is a stripped or broken invoice — refused like a disagreement, with no values to show */
function missingPairOf(invoice, pair, figure) {
  const step = bridgeStepOf(invoice, pair);
  return { pair, missing: step ? 'figure' : 'step', bridge_field: '_cb.bridge.steps.' + pair, carried_field: 'ValDtls.' + figure, bridge_minor: step ? step.amount_minor : null, carried_minor: null, bridge: step ? step.amount : null, carried: null };
}

/**
 * CTR-214 — the HEAD pairs: the bridge's `heads[]` (engine v1.84.0: every tax head, in minor units, in total and per rate) against the carried per-head figures
 * (ValDtls.*Val and _cb.slabs[]). Built from the BRIDGE's own keys — no head map, no country word here; the api never enumerates the carried object. An ABSENT member
 * on an EXISTING carried row reads as 0 (an AU rate-0 slab has no TaxVal), so a planted 0.01 on a member the engine zeroed disagrees by plain equality.
 * Two carried figures, compared; nothing is added, subtracted or rounded here.
 */
/** the first engine release that writes `heads`: a missing `heads` is refused only for a bill whose OWN engine stamp is this or later (no calendar) */
const HEADS_FROM = [1, 84, 0];
/** per process, since boot: counter bills that carried no heads (counted, never refused before the floor) */
let headsAbsent = 0;

/** the digits of a minor-unit whole number written with the decimal point in place — string moves only, so a ticket and a sentence can show it */
function minorText(minor, places) {
  const sign = minor < 0 ? '-' : '';
  const digits = String(minor).replace('-', '').padStart(places + 1, '0');
  return places > 0 ? `${sign}${digits.slice(0, digits.length - places)}.${digits.slice(digits.length - places)}` : `${sign}${digits}`;
}

/** one head pair, both values read: the bridge's minor against the carried figure written in the bridge's own minor units */
function headPair(invoice, pair, bridgeMinor, carried, fields) {
  const carriedMinor = carriedMinorOf(invoice, carried, null);
  const places = invoice._cb.bridge.decimals;
  return { pair, bridge_field: fields.bridge, carried_field: fields.carried, bridge_minor: bridgeMinor, carried_minor: carriedMinor, bridge: minorText(bridgeMinor, places), carried: minorText(carriedMinor, places), agree: bridgeMinor === carriedMinor };
}

/** a heads row with no carried counterpart (or a stripped one): refused like a missing figure, no values to show */
function missingHead(pair, bridgeField, carriedField, missing) {
  return { pair, missing: missing || 'figure', bridge_field: bridgeField, carried_field: carriedField, bridge_minor: null, carried_minor: null, bridge: null, carried: null };
}

/** the pairs of ONE heads row against its carried object (ValDtls for the total row, the slab row for a slab): the first that disagrees, or null */
function rowMismatchOf(invoice, row, carriedObject, names) {
  const bridgeKeys = Object.keys(row.minor || {});
  if (bridgeKeys.length === 0) return missingHead(`${names.pair}:figures`, names.bridge, names.carried);
  for (const key of bridgeKeys) {
    const carried = carriedObject[key] === undefined || carriedObject[key] === null ? 0 : carriedObject[key];
    const found = headPair(invoice, `${names.pair}:${key}`, row.minor[key], carried, { bridge: `${names.bridge}.minor.${key}`, carried: `${names.carried}.${key}` });
    if (!found.agree) return found;
  }
  if (row.level !== 'slab') return null;
  const base = headPair(invoice, `${names.pair}:base`, row.base_minor, carriedObject.AssVal === undefined ? 0 : carriedObject.AssVal, { bridge: `${names.bridge}.base_minor`, carried: `${names.carried}.AssVal` });
  return base.agree ? null : base;
}

/** the head rows' currency against the chit's, when both exist (CUR-1: a mismatch is refused) */
function headCurrencyMismatch(rows, currency) {
  const stated = String(currency || '').toUpperCase();
  if (!stated) return null;
  const oddRow = rows.find((row) => row && String(row.currency || '').toUpperCase() !== stated);
  return oddRow ? { pair: 'heads:currency', bridge_field: '_cb.bridge.heads.currency', carried_field: 'chit.currency_code', bridge_minor: null, carried_minor: null, bridge: oddRow.currency, carried: stated } : null;
}

/** the bridge carries `heads`: currency first, then the total row against ValDtls, then the slab count, then each slab row against its carried row (the first failure only) */
function headsMismatchOf(invoice, currency) {
  const rows = invoice._cb.bridge.heads;
  const total = rows.find((row) => row && row.level === 'total');
  const slabs = rows.filter((row) => row && row.level === 'slab');
  const carriedSlabs = Array.isArray(invoice._cb.slabs) ? invoice._cb.slabs : [];
  const oddRow = headCurrencyMismatch(rows, currency);
  if (oddRow) return oddRow;
  if (!total || !invoice.ValDtls) return missingHead('total', '_cb.bridge.heads[total]', 'ValDtls');
  const totalOdd = rowMismatchOf(invoice, total, invoice.ValDtls, { pair: 'total', bridge: '_cb.bridge.heads[total]', carried: 'ValDtls' });
  if (totalOdd) return totalOdd;
  if (slabs.length !== carriedSlabs.length) return { pair: 'heads:slabs', bridge_field: '_cb.bridge.heads[slab] count', carried_field: '_cb.slabs length', bridge_minor: slabs.length, carried_minor: carriedSlabs.length, bridge: String(slabs.length), carried: String(carriedSlabs.length) };
  for (const row of slabs) {
    const carriedRow = carriedSlabs.find((item) => item && Number(item.GstRt) === Number(row.rate));
    const names = { pair: `slab:${row.rate}`, bridge: `_cb.bridge.heads[slab ${row.rate}]`, carried: `_cb.slabs[GstRt=${row.rate}]` };
    const found = carriedRow ? rowMismatchOf(invoice, row, carriedRow, names) : missingHead(names.pair, names.bridge, names.carried);
    if (found) return found;
  }
  return null;
}

/** the numbers of a stamp such as 'tax@1.84.0' (or '1.84.0'), or null when it names none — compared as numbers, never as text (1.9 is below 1.84) */
function versionOf(stamp) {
  const found = /([0-9]+)[.]([0-9]+)[.]([0-9]+)/.exec(String(stamp || ''));
  return found ? [Number(found[1]), Number(found[2]), Number(found[3])] : null;
}

/** is the stamped engine at or past the release that writes heads? An unreadable or absent stamp is not */
function writesHeads(stamp) {
  const have = versionOf(stamp);
  if (!have) return false;
  const at = have.findIndex((part, index) => part !== HEADS_FROM[index]);
  return at < 0 || have[at] > HEADS_FROM[at];
}

/**
 * a bridge with no `heads` (M5). Refused when the bill's OWN engine stamp (ctx.engine, as stampsOf writes it: 'tax@1.84.0') is 1.84.0 or later: that engine always writes them. An older, unreadable
 * or absent stamp (a till on an older copy: it carries no stamp today) is COUNTED and logged (send.heads_absent), never refused. The stamp is the bill's own, so no calendar decides.
 */
function headsAbsentOf(invoice, ctx) {
  const stamp = ctx && ctx.engine;
  if (writesHeads(stamp)) return missingHead('heads', '_cb.bridge.heads', 'ValDtls.*Val and _cb.slabs', 'rows');
  headsAbsent += 1;
  log.warn('send.heads_absent', { where: (ctx && ctx.where) || 'counter', bill: ctx && ctx.bill, engine: stamp || null });
  return null;
}

/** the counter bills seen without heads since boot (a restart resets it; the log line is the durable record) */
const headsAbsentCount = () => headsAbsent;

/** where the invoice was built — the one word stampsOf records: 'counter' when the chit carried its own invoice, else 'send' (built here) */
const whereOf = (scope) => (scope && scope.kind === 'carried' ? 'counter' : 'send');

/** the engine stamp of the bill's OWN invoice: built here it is this repo's pin (what stampsOf will write); a carried invoice names the one it travelled with (business_json.stamps), or none — a till stamps nothing today */
function engineStampOf(business_json, scope) {
  if (whereOf(scope) === 'send') return 'tax@' + engineVersion();
  const stamps = business_json && business_json.stamps;
  return (stamps && stamps.money && stamps.money.engine) || null;
}

/**
 * pairMismatchOf(invoice, currency, ctx) → null when the invoice carries NO bridge (frozen before v1.74.0: sent as before) or every pair agrees; else the FIRST pair that
 * disagrees, both values READ — or, when a bridge exists, the first pair whose step or figure is MISSING (missing: 'step' | 'figure'): the check cannot be defeated by deleting a figure.
 * ctx = { where: 'send' | 'counter', engine, bill }: the bill's own engine stamp decides what a bridge with no `heads` means (CTR-214, headsAbsentOf).
 */
function pairMismatchOf(invoice, currency, ctx) {
  const bridge = invoice && invoice._cb && invoice._cb.bridge;
  if (!bridge) return null;
  for (const { pair, figure } of BRIDGE_PAIRS) {
    const values = pairValues(invoice, pair, figure);
    if (!values) return missingPairOf(invoice, pair, figure);
    const carriedMinor = carriedMinorOf(invoice, values.carried, currency);
    if (sameFigure(values, carriedMinor)) continue;
    return { pair, bridge_field: '_cb.bridge.steps.' + pair, carried_field: 'ValDtls.' + figure, bridge_minor: values.step.amount_minor, carried_minor: carriedMinor, bridge: values.step.amount, carried: values.carried };
  }
  return Array.isArray(bridge.heads) ? headsMismatchOf(invoice, currency) : headsAbsentOf(invoice, ctx);
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

module.exports = { BILLING_PURPOSES, scopeOf, buyerIdOf, unreadableLine, invoiceAtSend, invoiceOfLines, stopOf, pairMismatchOf, whereOf, engineStampOf, headsAbsentCount, stampsOf, engineVersion };
