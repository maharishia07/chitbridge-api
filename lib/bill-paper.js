// @stage tested
// CALLED BY routes/chits.js   [sendPaper — the step after sendIssued]
// @stage-note CTRY-76: the server's ONE read of the shop's pack for the buyer line of a counter bill at send — held (not a tax invoice) or a refused buyer tax id. Never a recompute.
'use strict';
/**
 * bill-paper.js — WHAT PAPER A COUNTER BILL IS, read ONCE at send (CTRY-76 · Round 1 E2 · Athi Q1 30 Oct: HELD, refuse only a bad buyer tax id).
 *
 * OWNS      the server's read of the shop's country pack for the BUYER line of a tax invoice: `held` when the pack asks for the buyer
 *           (reg-au taxInvoice: from A$1,000 the buyer's identity or ABN, GST Act s.29-70(1)(c)(ii); reg-in r.46(f)) and nobody is named;
 *           `refusal` when the buyer's tax id fails THE one check — lib/profile taxIdRefusal, the same call shop setup (country-setup.js)
 *           and the profile save (entities.js) run. One ABN check for the shop and for the bill.
 * CALLED BY routes/chits.js sendPaper (after sendIssued, OUTSIDE its fail-open try: a refusal here must reach the counter)
 * FLOW      business_json { invoice (frozen) · customer } + the shop's country ──▶ country.packFor (null, never India) ──▶ tax-lines.heads
 *           ──▶ pack.taxInvoice(total minor, facts) ──▶ buyer named? tax id ok? ──▶ { held: { reason, why, cite } | null, refusal: { code, why, field } | null }
 * CARD      15-tax-and-country-packs/invoice-front-door
 *
 * ⚠️ NO ARITHMETIC: the figures are the frozen invoice's own (ValDtls through tax-lines.heads); the total is only moved into minor units for the
 * pack's threshold (books-cashflow toMinor, the api's one). The pack decides and words everything (buyer_why, cite); no country is named here.
 * ⭐ The engines' invoice.build (v1.73.0) is THE front door of a bill's paper and makes this same decision (ruleOf_ · buyerOf_ · decision_);
 * the api adopts it with the money pin move (PLAN-AU-PILOT PR-A1). Until then this is the server's one reader, written to the front door's
 * reading of the pack so the swap is one call. Name on the chit: the counter's own `business_json.not_invoice` ('shop_details' |
 * 'buyer_identity', till.html finish) — no second name for the paper's kind.
 * ⚠️ The buyer is NAMED when a name (not the counter's 'Walk-in' placeholder) or a tax id is on the bill — the till's buyerNamed, the engine's
 * 'identity' need. A pack whose rule lists more (reg-in buyer_needs name · address · State) is read the same way here, as the till reads it today;
 * the full list is the front door's reading and arrives with it (said in the PR, not a silent change for India).
 */
const COUNTRY = require('./country');
const { heads } = require('./tax-lines');
const WALK_IN = 'Walk-in'; /* the counter's placeholder for nobody (till.html chitOf; lib/tax-lines walkIn reads the same word) */
const REASON_BUYER = 'buyer_identity'; /* the counter's own value of business_json.not_invoice when the buyer is missing */
const CODE_TAX_ID = 'BUYER_TAX_ID_BAD';
const FIELD_TAX_ID = 'business_json.customer.gstin'; /* the slot the chit already has for the buyer's ABN / TRN / GSTIN (CX1) */
const NONE = Object.freeze({ held: null, refusal: null, rule: null });

const text = (value) => String(value == null ? '' : value).trim();
/** a major-unit figure in the currency's minor units — the api's one (lib/books-cashflow toMinor), found at call time: that module reaches the db */
const toMinor = (amount, currency) => require('./books-cashflow').toMinor(amount, currency);

/** the bill's buyer is NAMED: a typed name that is not the placeholder, or their tax id (what reg-au's buyer_identity asks for) */
function buyerNamed(customer) {
  const named = customer && typeof customer === 'object' ? customer : {};
  const name = text(named.name);
  return !!text(named.gstin) || (!!name && name !== WALK_IN);
}

/** the frozen invoice of a counter bill, or null when the bill carries none worth reading (no ValDtls, no total) */
function frozenInvoiceOf(businessJson) {
  const invoice = businessJson && businessJson.invoice;
  if (!invoice || typeof invoice !== 'object' || !invoice.ValDtls) return null;
  return Number.isFinite(Number(invoice.ValDtls.TotInvVal)) ? invoice : null;
}

/** the pack's taxInvoice answer for this frozen invoice — the front door's call shape (engines invoice.js ruleOf_), or null when the pack has no rule */
function ruleOf(pack, invoice, currency, buyerTaxId) {
  if (!pack || typeof pack.taxInvoice !== 'function') return null;
  const figures = heads(invoice);
  const items = Array.isArray(invoice.ItemList) ? invoice.ItemList : [];
  const rated = (item) => Number(item.GstRt) > 0;
  return pack.taxInvoice(toMinor(figures.total, currency), {
    buyer_registered: !!buyerTaxId,
    taxable_minor: toMinor(figures.taxable, currency),
    taxable_lines: items.filter(rated).length,
    exempt_lines: items.filter((item) => !rated(item)).length,
    reverse_charge: !!(invoice.TranDtls && invoice.TranDtls.RegRev === 'Y')
  });
}

/** does the pack's answer want the buyer on this paper — its own list, a tax id (r.46(e) / AE buyer_trn) or an identity (AU: name or ABN) */
function buyerWanted(rule) {
  if (!rule) return false;
  if (Array.isArray(rule.buyer_needs) && rule.buyer_needs.length) return true;
  return !!(rule.buyer_identity || rule.buyer_tax_id || rule.buyer_trn);
}

/** the buyer's tax id on the bill, checked by the pack's own rule through THE one check (profile.taxIdRefusal) — a refusal, or null when it checks out */
function taxIdRefusalOf(country, buyerTaxId) {
  const refused = require('./profile').taxIdRefusal(country, buyerTaxId);
  return refused ? { code: CODE_TAX_ID, why: refused.why, field: FIELD_TAX_ID } : null;
}

/**
 * paperOf({ country, business_json, currency }) → { held, refusal, rule }
 *   held     { reason: 'buyer_identity', why (the pack's buyer_why), cite } — the pack wants the buyer on this tax invoice and nobody is named;
 *            the sale stands, the paper is "Bill — not a tax invoice" until the buyer is named (s.29-70(2): 28 days after a request)
 *   refusal  { code: 'BUYER_TAX_ID_BAD', why, field } — the buyer's tax id on the bill fails the pack's own check (reg-au ABN mod-89, reg-in GSTIN)
 *   rule     the pack's answer, for a caller that wants to say more; null when nothing applied
 * Nothing when: not a counter bill with its frozen invoice · no pack for the country (the shop could not exist) · the pack has no taxInvoice rule ·
 * the invoice carries no tax (a GST-free sale, an export, an unregistered shop: not a tax invoice, nothing to hold or check).
 */
function paperOf(input) {
  const businessJson = (input && input.business_json) || {};
  const invoice = frozenInvoiceOf(businessJson);
  const pack = invoice ? rulePackOf(input.country) : null;
  if (!pack || !(heads(invoice).tax > 0)) return NONE;
  const customer = customerOf(businessJson);
  const buyerTaxId = text(customer.gstin);
  const refusal = buyerTaxId ? taxIdRefusalOf(input.country, buyerTaxId) : null;
  if (refusal) return { held: null, refusal, rule: null };
  const rule = ruleOf(pack, invoice, input.currency, buyerTaxId);
  return { held: heldOf(rule, customer), refusal: null, rule };
}

/** the shop's pack when it states a taxInvoice rule; null for no pack (never India) or a pack without the rule */
function rulePackOf(country) {
  const pack = COUNTRY.packFor(country);
  return pack && typeof pack.taxInvoice === 'function' ? pack : null;
}

/** the buyer the counter wrote on the bill (business_json.customer), an empty record when none */
function customerOf(businessJson) {
  return businessJson.customer && typeof businessJson.customer === 'object' ? businessJson.customer : {};
}

/** held when the pack wants the buyer on this paper and nobody is named — the pack's own sentence (buyer_why, when the adopted release states one;
 *  reg-au carries it from v1.73.0, reg-in from v1.73.0) and its cite; null otherwise. The sentence a PERSON reads is the register's
 *  (docs/ERROR-CODES.md INVOICE_HELD_BUYER), so no words are typed here when a pack has none yet. */
function heldOf(rule, customer) {
  if (!buyerWanted(rule) || buyerNamed(customer)) return null;
  return { reason: REASON_BUYER, why: rule.buyer_why || null, cite: rule.cite || null };
}

module.exports = { paperOf, buyerNamed, REASON_BUYER };
