// @stage tested
// @stage-note [BOOKS v2] The posting hooks: a saved chit → the event it posts (or nothing), after the commit, never able
// @stage-note to fail the chit. A walk-in bill waits for its counter's day close. What cannot post waits in books_outbox, named.
'use strict';
/**
 * lib/books-hooks.js — ENTRY POINTS INTO THE LEDGER (SPEC-books-v2 §3).
 *
 * ⚠️⚠️⚠️ A POSTING FAILURE NEVER FAILS THE CHIT. The hooks run after the chit's own commit, are never awaited by the
 *   route, and swallow everything — what could not post is written to books_outbox with the reason, and the reason is
 *   what the Ledger screen and GET /api/books/health show ("named on the to-do list"). If even the outbox cannot be
 *   written (tables not created), it is logged, never silent. [[feedback-silence-is-the-bug]]
 * ⭐ OFF COSTS ONE CACHED READ. With the shop's books off, afterChit() returns after a cached look at books_setting
 *   (60 s; 10 min when the table does not exist yet) — the chit path is the hottest in the product.
 * ⚠️⚠️ A READ THAT FAILED IS NOT "OFF" (critic M3): it is never cached, it is logged, and the last known answer stands.
 * ⭐ WHAT THE HOOK MISSED IS SWEPT UP (critic M6): lib/books-nightly finds the chits of the closed days that never reached
 *   the ledger (a deploy between commit and hook, a client retry, a failed read) and posts them through postChit() here.
 *
 * WHAT POSTS (classify(), pure, tests/books-hooks.test.cjs):
 *   counter bill, walk-in (no party, no GSTIN, not on credit)  → waits for the day close (grain 'day'/'shift'),
 *                                                                or its own walk-in entry (grain 'bill')
 *   counter bill to a known party / on credit / with a GSTIN   → sale_bill, per bill
 *   an invoice I send                                          → sale_bill (the other party owes it)
 *   an invoice I receive / a counter bill another shop billed ME → purchase_bill (I owe the seller) — ONLY once I accepted
 *                                                                it on the rail, no dispute open, the seller on my supplier
 *                                                                list (buyerGate; until then it waits on Waiting, named)
 *   a credit note I issue / receive                            → return / purchase_return
 *   an expense / an income chit                                → expense / other_income, by class
 *   a counter's day summary chit                               → the walk-in day entry for that counter and day
 *   the counter's "money received" chit (business_json.payment_received — its own R/… series, NOT a bill)
 *                                                              → a payment, through books.recordPayment; a cheque is HELD
 *                                                                (a status row) until POST /cheques/:id/status clears it
 * A credit bill's business_json.terms.due_date is the bill's due date; credit_override stays on the chit (it posts nothing).
 * ⚠️ Every event carries a real YYYY-MM-DD date and amounts rounded by money.round — a chit without a usable date is
 *   QUEUED with that reason (CBPosting v1.8.1 refuses an undated event; the refusal is named on the to-do, never swallowed).
 *   anything else (orders, inquiries, drafts, general)         → nothing: an order is a promise, not a transaction
 */
const B = require('./books');
const E = require('./books-engines');
const S = require('./books-store');

let log = null; function L() { if (!log) { try { log = require('./logger'); } catch (_) { log = { info() {}, warn() {} }; } } return log; }
function withEntity(e, fn) { return require('../db').withEntity(e, fn); }

/* ── is this shop's ledger on? cached, because every chit asks ───────────────────────────────────────────────── */
const onCache = new Map();
/**
 * isOn(entity, db?) → the shop's setting when its ledger is on, else null. `db`: a handle the caller already holds (the
 * counter's snapshot reads it inside its own transaction — settingOf keeps to a savepoint, so a failure cannot abort it).
 * ⚠️⚠️ ONLY AN ANSWER IS CACHED (critic M3, 2026-09-30). This used to catch ANY error and cache "off" for ten minutes: one
 *   pool timeout and every chit that shop saved for ten minutes returned { off: true } — nothing queued, nothing logged.
 *   Now: "no" is cached 60 s, "the table is not there" (42P01 → null) ten minutes, and a read that THREW is not cached
 *   at all — it is logged, and the last known answer stands (a shop that was on is still tried; the post parks itself).
 */
async function isOn(entity, db) {
  const k = String(entity), c = onCache.get(k), now = Date.now();
  if (c && c.until > now) return c.s;
  let s;
  try { s = db ? await B.settingOf(db, entity) : await withEntity(entity, (h) => B.settingOf(h, entity)); }
  catch (e) {
    L().warn('books.switch-unread', { entity_id: entity, error: String(e && e.message).slice(0, 200), assumed: c ? (c.s ? 'on (last known)' : 'off (last known)') : 'off (never read)' });
    return c ? c.s : null;
  }
  const v = s && s.enabled ? s : null;
  onCache.set(k, { s: v, until: now + (s === null ? 600000 : 60000) });
  return v;
}
function forget(entity) { onCache.delete(String(entity)); }
/** tests: the cached answer is now stale (kept as the last known one) — true when there was one */
function _expire(entity) { const c = onCache.get(String(entity)); if (c) c.until = 0; return !!c; }

/* ═══ classify — pure ═══════════════════════════════════════════════════════════════════════════════════════════ */

/** a tender's words → the mode the posting rules know; 'credit' = not paid now (the party owes it); null = unknown */
function modeOf(how) {
  const w = String(how || '').toLowerCase().trim();
  if (!w) return null;
  if (/card|visa|master|rupay|amex|pos\b/.test(w)) return 'card';
  if (/upi|gpay|google ?pay|phone ?pe|paytm|bhim|\bqr\b/.test(w)) return 'upi';
  if (/cheque|check/.test(w)) return 'cheque';
  if (/bank|neft|rtgs|imps|transfer/.test(w)) return 'bank';
  if (/credit|udhaar|udhar|due|on account|later|khata/.test(w)) return 'credit';
  if (/cash/.test(w)) return 'cash';
  return null;
}
/* ⭐ money.round — THE one rounder (half away from zero, the currency's own decimals); never a copy of the rule here */
const MONEY = require('./money');
const r2 = (n) => MONEY.round(Number(n) || 0);

/** the invoice's lines, summed per rate — or a problem the posting rules cannot carry yet (cess, a VAT head) */
function byRateOf(inv) {
  const m = new Map(); let other = 0;
  for (const it of (inv && inv.ItemList) || []) {
    const k = String(it.GstRt == null ? 0 : it.GstRt);
    const o = m.get(k) || { rate: Number(k), taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    o.taxable = r2(o.taxable + (it.AssAmt || 0)); o.cgst = r2(o.cgst + (it.CgstAmt || 0)); o.sgst = r2(o.sgst + (it.SgstAmt || 0)); o.igst = r2(o.igst + (it.IgstAmt || 0));
    other = r2(other + (it.CesAmt || 0) + (it.TaxAmt || 0));
    m.set(k, o);
  }
  const rows = Array.from(m.values());
  const total = r2(rows.reduce((t, r) => t + r.taxable + r.cgst + r.sgst + r.igst, 0));
  return { rows, total, other };
}
function modesOf(parts) {
  const out = {}, unknown = [];
  for (const p of parts || []) {
    const m = modeOf(p.how); const a = r2(p.amount);
    if (!a) continue;
    if (!m) { unknown.push(p.how); continue; }
    out[m] = r2((out[m] || 0) + a);
  }
  return { modes: out, unknown };
}
const TZ = { IN: 330, AE: 240 };
/** the shop's calendar day of a moment (India +05:30; decision #5 "bizDay everywhere" still open — the shop-day cut is midnight) */
function dayOf(ts, country) {
  const t = ts instanceof Date ? ts.getTime() : Date.parse(ts); if (!isFinite(t)) return null;   /* a timestamptz arrives as a Date */
  return new Date(t + (TZ[String(country || 'IN').toUpperCase()] || 0) * 60000).toISOString().slice(0, 10);
}
function dayBounds(day, country) {
  const off = (TZ[String(country || 'IN').toUpperCase()] || 0) * 60000, t = Date.parse(day + 'T00:00:00Z') - off;
  return { from: new Date(t).toISOString(), to: new Date(t + 86400000).toISOString() };
}
function partyFromCustomer(c) { return c && (c.party_id || c.identity_id || c.entity_id) ? String(c.party_id || c.identity_id || c.entity_id) : null; }

/**
 * ⭐⭐⭐ THE BUYER'S COPY POSTS ONLY ONCE THE BUYER HAS ACCEPTED IT ON THE RAIL (Athi, 2026-10-01: "it should not be
 * automatic, it has to have a checking mechanism in the rail to allow it to the sundry creditor — the material received
 * status and so on"). A bill I RECEIVE (a counter bill another shop billed me, an invoice a supplier sent) is a claim
 * until I confirm the goods: the acceptance is the chit's OWN status on my copy (chit_status.current_status, moved by
 * PUT /api/chits/:id/status — the step the Intake folder drives), never a ledger-only flag.
 *   accepted · in_progress · completed → may post (supplier list permitting — the hook checks, postChit)
 *   rejected · cancelled               → never posts (a dispute settled in the buyer's favour ends here)
 *   an OPEN dispute on the chit        → waits, whatever the status (settled for the seller + accepted → posts)
 *   anything else (delivered, read, pending, partial) → waits, with the sentence the Waiting list shows
 */
const ACCEPTED = /^(accepted|in_progress|completed)$/, REFUSED = /^(rejected|cancelled)$/;
function sellerNameOf(t) { return (t && t.seller && (t.seller.LglNm || t.seller.TrdNm)) || 'the seller'; }
function buyerGate(inp, t, ref) {
  const st = String(inp.status || (inp.chit && inp.chit.current_status) || '');
  const what = '(bill ' + ref + ' from ' + sellerNameOf(t) + ')';
  if (REFUSED.test(st)) return { kind: 'none' };
  if (inp.disputed) return { kind: 'queue', wait: 'dispute', why: 'Disputed — this posts once the dispute is settled and you confirm the goods ' + what + '.' };
  if (!ACCEPTED.test(st)) return { kind: 'queue', wait: 'acceptance', why: 'Waiting for you to confirm the goods were received ' + what };
  return null;
}

/**
 * classify({ chit, entry, setting, status?, disputed? }) → { kind: 'none' | 'walkin' | 'day' | 'post' | 'queue', event?, why?, counter?, day? }
 *   chit:     the copy (purpose, business_json, chit_id, created_at, currency_code, sender_entity_id, current_status)
 *   entry:    tax-copy entryFor(copy, me) — { sells, direction, invoice, seller, buyer, me }
 *   status:   my copy's chit status (default chit.current_status) — the buyer's acceptance (buyerGate)
 *   disputed: an open dispute on the chit (postChit reads it)
 * A purchase the buyer accepted comes back with `supplier_check: true`: postChit posts it only when the seller is on the
 * buyer's supplier list (never added automatically — Athi, 2026-10-01).
 */
function classify(inp) {
  const c = inp.chit || {}, t = inp.entry || {}, s = inp.setting || {};
  const bj = c.business_json || {}, purpose = String(c.purpose || '');
  const cur = String(c.currency_code || (t.invoice && t.invoice.currency) || s.functional_currency || 'INR').toUpperCase();
  const at = bj.billed_at || c.sent_at || c.created_at;
  const date = dayOf(at, s.country);
  const base = { source_chit_id: c.chit_id, currency: cur, date, ref: bj.bill_no || bj.printed_as || c.chit_id };
  const till = bj.till && bj.till.id ? String(bj.till.id) : null;

  /* the counter's day summary chit → the walk-in day of that counter */
  if (purpose === 'general' && bj.summary && typeof bj.summary === 'object') {
    const sm = bj.summary; if (sm.period !== 'day') return { kind: 'none' };
    const key = /(\d{4}-\d{2}-\d{2})/.exec(String(sm.key || '')); const counter = (sm.till && sm.till.id) || till;
    if (!key || !counter) return { kind: 'queue', why: 'A day summary without its day or its counter.' };
    return { kind: 'day', counter: String(counter), day: key[1] };
  }
  /* ⭐ MONEY RECEIVED AT THE COUNTER — its own numbered series, never a bill (books-counter 3e1c88f) */
  if (bj.kind === 'payment_received' && bj.payment_received && typeof bj.payment_received === 'object') {
    const p = bj.payment_received, pcur = String(p.currency || cur).toUpperCase();
    const party = partyFromCustomer(p.party) || partyFromCustomer(bj.customer);
    const amt = r2(Math.abs(Number(p.amount) || 0)), mode = modeOf(p.mode), day = dayOf(p.at || at, s.country);
    if (!party) return { kind: 'queue', why: 'Money received (' + (p.no || '') + ') from nobody the shop knows — choose the customer.' };
    if (!amt) return { kind: 'queue', why: 'Money received (' + (p.no || '') + ') with no amount.' };
    if (!mode || mode === 'credit') return { kind: 'queue', why: 'Money received (' + (p.no || '') + ') by "' + p.mode + '", which has no ledger yet.' };
    if (!day) return { kind: 'queue', why: 'Money received (' + (p.no || '') + ') has no usable date.' };
    const chq = p.cheque && typeof p.cheque === 'object' ? p.cheque : {};
    return { kind: 'payment', payment: { party_id: party, direction: 'in', amount_minor: Math.round(amt * Math.pow(10, MONEY.decimals(pcur))), currency: pcur, mode,
      reference: p.no || null, cheque_no: chq.no || null, cheque_bank: chq.bank || null, cheque_date: /^\d{4}-\d{2}-\d{2}$/.test(String(chq.dated || '')) ? chq.dated : null,
      received_at: day, client_ref: 'chit:' + c.chit_id, source_chit_id: c.chit_id } };
  }
  /* every event below carries the chit's own day — without one nothing can be posted (and nothing is guessed) */
  if (!date && (purpose === 'expense' || purpose === 'income' || purpose === 'credit_note' || purpose === 'invoice' || (till && bj.bill_no))) return { kind: 'queue', why: 'The chit has no usable date.' };
  if (purpose === 'expense') {
    const x = bj.expense || {}; const amt = r2(Math.abs(Number(x.amount) || 0));
    if (!amt) return { kind: 'queue', why: 'An expense with no amount.' };
    const m = modeOf(x.mode);
    const ev = Object.assign({}, base, { type: 'expense', class: x.class || 'sundry_expense', amount: amt, source_ref: 'chit:' + c.chit_id, counter: till });
    if (m === 'credit') { if (!x.supplier) return { kind: 'queue', why: 'An expense on credit names no supplier.' }; ev.supplier = String(x.supplier); }
    else if (!m) return { kind: 'queue', why: 'The expense was paid by "' + x.mode + '", which has no ledger yet.' };
    else ev.paid_from = m;
    return { kind: 'post', event: ev };
  }
  if (purpose === 'income') {
    const x = bj.income || {}; const amt = r2(Math.abs(Number(x.amount) || 0)); const m = modeOf(x.mode) || 'cash';
    if (!amt) return { kind: 'queue', why: 'An income entry with no amount.' };
    if (m === 'credit') return { kind: 'queue', why: 'Income on credit is not posted from the counter.' };
    return { kind: 'post', event: Object.assign({}, base, { type: 'other_income', class: x.class || 'sundry_income', into: m, amount: amt, source_ref: 'chit:' + c.chit_id, counter: till }) };
  }

  const inv = t.invoice; if (!inv) return { kind: 'none' };
  const br = byRateOf(inv);
  if (br.other) return { kind: 'queue', why: 'The bill carries cess or a non-GST tax (' + br.other + ') the posting rules do not post yet.' };
  const counterBill = !!(till && bj.bill_no);

  if (purpose === 'credit_note') {
    if (t.sells) {
      const refunds = modesOf(bj.refund && bj.refund.parts);
      if (refunds.unknown.length) return { kind: 'queue', why: 'Refunded by "' + refunds.unknown.join(', ') + '", which has no ledger yet.' };
      const party = partyFromCustomer(bj.customer);
      const ev = Object.assign({}, base, { type: 'return', by_rate: br.rows, source_ref: 'chit:' + c.chit_id, counter: till, against_bill: bj.against || null });
      if (Object.keys(refunds.modes).length) ev.refund = refunds.modes; else if (party) ev.party = party;
      else return { kind: 'queue', why: 'A credit note with no refund and no known customer.' };
      if (party && ev.refund) ev.party = party;
      return { kind: 'post', event: ev };
    }
    const sup = t.seller && t.seller.entity_id;
    if (!sup) return { kind: 'queue', why: 'A supplier credit note with no supplier.' };
    return { kind: 'post', event: Object.assign({}, base, { type: 'purchase_return', party: String(sup), by_rate: br.rows, source_ref: 'chit:' + c.chit_id }) };
  }

  /* ⭐ the CUSTOMER's copy of a counter bill reads 'invoice' + counter_bill (routes/chits.js billCopyFor) — still a counter
     bill: its payments at the counter are what was paid, so it takes this branch, never the invoice one (paid {}) */
  if (counterBill && (/^(order|offer|subscription)$/.test(purpose) || (purpose === 'invoice' && bj.counter_bill === true))) {
    /**
     * ⚠️⚠️ WHO SOLD IT DECIDES THE SIDE (2026-10-01). This branch posted sale_bill without asking — so the BUYER's copy of a
     * counter bill (the same business_json) would have posted as the buyer's own SALE, or summed into the buyer's walk-in
     * day when its counter shared the id. A counter bill is SENT by the shop whose counter billed it, so a copy sent by
     * anyone but me is the buyer's, even when tax-copy's counter rule (a self chit naming a customer) calls it "sells".
     */
    const me = t.me && t.me.entity_id ? String(t.me.entity_id) : null;
    const sentByOther = !!(me && c.sender_entity_id && String(c.sender_entity_id) !== me);
    if (!t.sells || sentByOther) {
      const gate = buyerGate(inp, sentByOther && t.sells ? { seller: {} } : t, base.ref);
      if (gate) return gate;
      const sup = sentByOther ? String(c.sender_entity_id) : (t.seller && t.seller.entity_id ? String(t.seller.entity_id) : null);
      if (!sup) return { kind: 'queue', why: 'A bill from a counter with no seller on the rail.' };
      const pay = modesOf(bj.payment && bj.payment.parts);
      if (pay.unknown.length) return { kind: 'queue', why: 'Paid by "' + pay.unknown.join(', ') + '", which has no ledger yet.' };
      const charged = r2(Object.keys(pay.modes).reduce((a, k) => a + pay.modes[k], 0));
      delete pay.modes.credit;                                      /* the credit part is what the buyer owes — Creditors */
      const round_off = r2(charged - br.total);
      if (Math.abs(round_off) > 1) return { kind: 'queue', why: 'The bill\'s payments (' + charged + ') and its tax invoice (' + br.total + ') differ by more than a rupee.' };
      const due = bj.terms && /^\d{4}-\d{2}-\d{2}$/.test(String(bj.terms.due_date || '')) ? String(bj.terms.due_date) : undefined;
      /* counter null: it is the SELLER's counter, not one of mine */
      return { kind: 'post', supplier_check: true, event: Object.assign({}, base, { type: 'purchase_bill', party: sup, by_rate: br.rows, paid: pay.modes, round_off,
        counter: null, source_ref: 'chit:' + c.chit_id, against_ref: c.chit_id, due_date: due }) };
    }
    const pay = modesOf(bj.payment && bj.payment.parts);
    if (pay.unknown.length) return { kind: 'queue', why: 'Paid by "' + pay.unknown.join(', ') + '", which has no ledger yet.' };
    const charged = r2(Object.keys(pay.modes).reduce((a, k) => a + pay.modes[k], 0));
    const credit = pay.modes.credit || 0; delete pay.modes.credit;
    const round_off = r2(charged - br.total);
    if (Math.abs(round_off) > 1) return { kind: 'queue', why: 'The bill\'s payments (' + charged + ') and its tax invoice (' + br.total + ') differ by more than a rupee.' };
    const party = partyFromCustomer(bj.customer);
    const gstin = bj.customer && bj.customer.gstin ? String(bj.customer.gstin) : null;
    let grain = 'day';
    try { const P = E.posting(); grain = P.granularity ? P.granularity({ setting: s.walkin_grain, party, credit: credit > 0, gstin }) : grain; }
    catch (_) { grain = party || credit > 0 || gstin ? 'bill' : (s.walkin_grain || 'day'); }
    if (credit > 0 && !party) return { kind: 'queue', why: 'An on-credit bill with no known customer — who owes it?' };
    if (!party && !gstin && credit <= 0) {
      if (grain === 'bill') return { kind: 'post', event: Object.assign({}, base, { type: 'walkin_day', modes: pay.modes, by_rate: br.rows, round_off, counter: till, source_ref: 'bill:' + c.chit_id }) };
      return { kind: 'walkin', counter: till, day: date, bill: { currency: cur, pay: pay.modes, taxes: br.rows, round_off } };
    }
    /* a credit bill's own terms (the counter wrote them on the chit): its due date, when it is a real date */
    const due = bj.terms && /^\d{4}-\d{2}-\d{2}$/.test(String(bj.terms.due_date || '')) ? String(bj.terms.due_date) : undefined;
    return { kind: 'post', event: Object.assign({}, base, { type: 'sale_bill', party: party || undefined, by_rate: br.rows, paid: pay.modes, round_off,
      counter: till, source_ref: 'chit:' + c.chit_id, against_ref: c.chit_id, due_date: due }) };
  }

  if (purpose === 'invoice') {
    const total = r2((inv.ValDtls && inv.ValDtls.TotInvVal) || br.total);
    const round_off = r2(total - br.total);
    if (t.sells) {
      const buyer = t.buyer && t.buyer.entity_id;
      if (!buyer) return { kind: 'queue', why: 'An invoice with no buyer on the rail — record it at the counter instead.' };
      return { kind: 'post', event: Object.assign({}, base, { type: 'sale_bill', party: String(buyer), by_rate: br.rows, paid: {}, round_off, source_ref: 'chit:' + c.chit_id, against_ref: c.chit_id }) };
    }
    const sup = t.seller && t.seller.entity_id;
    if (!sup) return { kind: 'queue', why: 'A supplier invoice with no supplier.' };
    /* ⭐ behind the buyer's acceptance, like a counter bill received (buyerGate) — it used to post on arrival */
    const gate = buyerGate(inp, t, bj.invoice_no || bj.doc_no || base.ref);
    if (gate) return gate;
    return { kind: 'post', supplier_check: true, event: Object.assign({}, base, { type: 'purchase_bill', party: String(sup), by_rate: br.rows, paid: {}, round_off, source_ref: 'chit:' + c.chit_id, against_ref: c.chit_id }) };
  }
  return { kind: 'none' };
}

/* ═══ the hooks ═════════════════════════════════════════════════════════════════════════════════════════════════ */

/** park it, with the reason — or say loudly that even that failed */
async function park(entity, job, why, chit_id, source_ref) {
  try { await withEntity(entity, (db) => S.queue(db, entity, { source_chit_id: chit_id || null, source_ref: source_ref || null, event: job, why })); }
  catch (e) { L().warn('books.outbox-failed', { entity_id: entity, chit_id, why, error: String(e && e.message) }); return; }
  L().warn('books.queued', { entity_id: entity, chit_id, why });
}

/** one chit, read as MY copy and classified; returns what happened (never throws) */
async function postChit(entity, chit_id, opt) {
  const o = opt || {};
  const s = o.setting || await isOn(entity);
  if (!s) return { off: true };
  try {
    const TC = require('./tax-copy');
    const copy = await TC.copyOf(chit_id, entity);
    if (!copy) return { none: true };
    const bjc = copy.business_json || {};
    const entry = copy.purpose === 'expense' || copy.purpose === 'income' || bjc.summary || bjc.kind === 'payment_received' ? {} : await TC.entryFor(copy, entity);
    /* ⭐ a bill I RECEIVED waits for my acceptance and for any open dispute to settle (buyerGate) — the dispute is read
       only for a copy that is not mine to sell, so the seller's hot path costs nothing more */
    const mine = !!entry.sells && !(entry.me && entry.me.entity_id && copy.sender_entity_id && String(copy.sender_entity_id) !== String(entry.me.entity_id));
    const disputed = entry.invoice && !mine ? (await withEntity(entity, (db) => S.openDisputes(db, entity, chit_id))) > 0 : false;
    const k = classify({ chit: copy, entry, setting: s, status: copy.current_status, disputed });
    if (k.kind === 'none') return { none: true };
    /* the Waiting row carries what the screen needs to open the chit (waitingRow → source) */
    const job = k.wait || k.supplier_check
      ? { job: 'chit', chit_id, kind: 'purchase', ref: bjc.bill_no || bjc.printed_as || bjc.invoice_no || null, counter: null, waiting: k.wait || 'supplier' }
      : { job: 'chit', chit_id };
    if (k.kind === 'queue') { if (!o.retry) await park(entity, job, k.why, chit_id, 'chit:' + chit_id); return { queued: true, why: k.why }; }
    /**
     * ⚠️⚠️ THE SELLER MUST BE ON MY SUPPLIER LIST (Athi, 2026-10-01: "it should not be automatic"). Never added here —
     * the purchase waits, named, and posts on the next retry / nightly sweep once the owner has added them.
     * (A duplicate of an entry already posted is answered by postEntry before this matters — the check runs first only
     *  because a party that left the list must not receive a NEW bill.)
     */
    if (k.supplier_check && k.event && k.event.party) {
      const done = await withEntity(entity, (db) => S.entryBySource(db, entity, k.event.source_ref));
      if (done) return { ok: true, duplicate: true, entry_id: done.entry_id, entry_no: done.entry_no };
      const on = await withEntity(entity, (db) => S.partyOn(db, entity, k.event.party));
      if (!on || !on.supplier) {
        const why = sellerNameOf(entry.sells ? null : entry) + ' is not on your supplier list — add them, then this posts';
        const named = why.charAt(0).toUpperCase() + why.slice(1);
        if (!o.retry) await park(entity, job, named, chit_id, 'chit:' + chit_id);
        return { queued: true, why: named };
      }
    }
    if (k.kind === 'day') return postDay(entity, k.counter, k.day, { setting: s, retry: o.retry, by: o.by });
    if (k.kind === 'payment') {
      try { return await withEntity(entity, (db) => B.recordPayment(db, entity, Object.assign({ by: o.by }, k.payment))); }
      catch (e) { if (o.retry) throw e; await park(entity, { job: 'chit', chit_id }, String(e && e.message || e), chit_id, 'chit:' + chit_id); return { queued: true, why: String(e && e.message || e) }; }
    }
    if (k.kind === 'walkin') {
      /**
       * a walk-in bill whose day is ALREADY posted and does not NAME it is a late bill: its own catch-up entry for that
       * day, never a rewrite of the day (SPEC-books v1, the late-bill rule).
       * ⚠️⚠️ "LATE" IS DECIDED BY THE DAY'S OWN LIST (critic M7), not by comparing times: a bill in flight when the day was
       *   read has an EARLIER created_at and was still not in the read — it answered "waiting: day close" for ever.
       *   (An entry with no list — none is written any more — falls back to the old comparison.)
       */
      const day = await withEntity(entity, (db) => S.entryBySource(db, entity, 'walkin:' + k.counter + ':' + k.day));
      if (!day) return { waiting: 'day close' };
      const covered = Array.isArray(day.source_chit_ids) ? day.source_chit_ids.map(String).indexOf(String(chit_id)) >= 0
        : new Date(day.created_at) >= new Date(copy.created_at);
      if (covered) return { ok: true, covered: true, entry_no: day.entry_no };
      const ev = Object.assign(E.posting().daySummary([k.bill], { ref: 'late ' + chit_id, date: k.day, counter: k.counter }),
        { source_ref: 'walkin-late:' + chit_id, source_chit_id: chit_id, counter: k.counter, by: o.by, narration: 'A walk-in bill that arrived after its day was posted' });
      return postOrPark(entity, ev, { job: 'chit', chit_id }, o);
    }
    if (k.event.type === 'return' && k.event.against_bill && k.event.party) {
      const orig = await withEntity(entity, (db) => db.query(`SELECT chit_id FROM chit_header WHERE entity_id = $1 AND sender_entity_id = $1 AND business_json->>'bill_no' = $2 LIMIT 1`, [entity, String(k.event.against_bill)]));
      if (orig.rows[0]) k.event.against_ref = orig.rows[0].chit_id;
    }
    delete k.event.against_bill;
    return postOrPark(entity, Object.assign(k.event, { by: o.by }), { job: 'chit', chit_id }, o);
  } catch (e) {
    if (!o.retry) await park(entity, { job: 'chit', chit_id }, String(e && e.message || e), chit_id, 'chit:' + chit_id);
    return { queued: true, why: String(e && e.message || e) };
  }
}
async function postOrPark(entity, ev, job, o) {
  try {
    const r = await B.postEntry(null, entity, ev);
    return r;
  } catch (e) {
    if (!o.retry) await park(entity, job, String(e && e.message || e), ev.source_chit_id, ev.source_ref);
    if (o.retry) throw e;
    return { queued: true, why: String(e && e.message || e) };
  }
}

/**
 * ⭐ postDay(entity, counter, day) — the walk-in day of one counter: every walk-in bill it billed that day, summed per
 * mode and per rate by the engine (CBPosting.daySummary), posted once (source_ref walkin:<counter>:<day>).
 */
async function postDay(entity, counter, day, opt) {
  const o = opt || {};
  const s = o.setting || await isOn(entity);
  if (!s) return { off: true };
  const job = { job: 'day', counter, day };
  try {
    /* ⚠️⚠️ GRAIN "bill": every walk-in bill posts as its own entry (bill:<chit>) — the day must not post them again
       (critic M4: one ₹118 cash bill, two entries, Sales ₹200). The nightly job and the day summary both come through here. */
    if (s.walkin_grain === 'bill') return { ok: true, empty: true, grain: 'bill' };
    const done = await withEntity(entity, (db) => S.entryBySource(db, entity, 'walkin:' + counter + ':' + day));
    if (done) return { ok: true, duplicate: true, entry_no: done.entry_no };
    const b = dayBounds(day, s.country);
    const rows = await withEntity(entity, (db) => S.counterBills(db, entity, counter, b.from, b.to));
    const TC = require('./tax-copy');
    const found = [], skipped = [];
    for (const r of rows) {
      const k = classify({ chit: r, entry: await TC.entryFor(r, entity), setting: Object.assign({}, s, { walkin_grain: 'day' }) });
      if (k.kind === 'walkin') found.push({ id: String(r.chit_id), bill: k.bill }); else if (k.kind === 'queue') skipped.push(k.why);
    }
    /* a bill that already posted on its own (the grain was "bill" when it was saved, or it came late) never rides the day too */
    const own = found.length ? await withEntity(entity, (db) => S.postedSources(db, entity, found.reduce((a, f) => a.concat(['bill:' + f.id, 'walkin-late:' + f.id]), []))) : [];
    const take = found.filter((f) => own.indexOf('bill:' + f.id) < 0 && own.indexOf('walkin-late:' + f.id) < 0);
    const bills = take.map((f) => f.bill);
    if (!bills.length) return { ok: true, empty: true, skipped };
    /* ⭐ the day NAMES the bills it covers (source_chit_ids) — that list, not a clock, decides what is late (postChit) */
    const ev = Object.assign(E.posting().daySummary(bills, { ref: 'walkin ' + counter + ' ' + day, date: day, counter }),
      { source_ref: 'walkin:' + counter + ':' + day, source_chit_ids: take.map((f) => f.id), counter, by: o.by,
        narration: 'Walk-in sales, counter ' + counter + ', ' + day + ' (' + bills.length + ' bills)' });
    return postOrPark(entity, ev, job, o);
  } catch (e) {
    if (!o.retry) await park(entity, job, String(e && e.message || e), null, 'walkin:' + counter + ':' + day);
    if (o.retry) throw e;
    return { queued: true, why: String(e && e.message || e) };
  }
}

/**
 * ⭐⭐⭐ afterChit(entity, chit_id, by) — called by routes/chits.js AFTER the commit, not awaited. Never rejects.
 */
function afterChit(entity, chit_id, by) {
  return (async () => {
    const s = await isOn(entity);
    if (!s) return { off: true };
    return postChit(entity, chit_id, { setting: s, by });
  })().catch((e) => { L().warn('books.hook-failed', { entity_id: entity, chit_id, error: String(e && e.message) }); return { failed: true }; });
}

/** the waiting list, tried again (the nightly job, and POST /api/books/outbox/retry) */
async function retryOutbox(entity, limit) {
  const rows = await withEntity(entity, (db) => S.waiting(db, entity, limit || 50));
  const out = { tried: 0, posted: 0, still: 0 };
  for (const r of rows) {
    out.tried++;
    const j = r.event || {};
    let ok = false, why = null;
    try {
      const res = j.job === 'day' ? await postDay(entity, j.counter, j.day, { retry: true })
        : j.job === 'chit' ? await postChit(entity, j.chit_id, { retry: true })
        : j.job === 'event' ? await B.postEntry(null, entity, j.event) : null;
      ok = !!res && !res.queued && !res.off;
      if (res && res.queued) why = res.why;
    } catch (e) { why = String(e && e.message || e); }
    await withEntity(entity, (db) => S.outboxDone(db, entity, r.id, ok, why || r.why));
    if (ok) out.posted++; else out.still++;
  }
  return out;
}

/** a waiting-list row as GET /api/books/health and the nightly check show it — `reason` is why it could not post */
function waitingRow(x) {
  const j = x.event || {};
  /* ⭐ `source` — the same shape the Day book's entries carry, so the screen opens the chit the row is waiting on */
  return { id: x.id, chit_id: x.source_chit_id || null, ref: x.source_ref || null, reason: x.why || null, tries: Number(x.tries) || 0, since: x.created_at,
           job: j.job || null,
           source: { chit_id: x.source_chit_id || j.chit_id || null, ref: j.ref || null, kind: j.kind || j.job || null, counter: j.counter || null, by: j.by || null } };
}

module.exports = { afterChit, postChit, postDay, retryOutbox, classify, modeOf, byRateOf, dayOf, dayBounds, isOn, forget, park, waitingRow, _expire };
