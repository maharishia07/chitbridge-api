/**
 * books-payment-advice.js — THE PAYMENT ADVICE, OUT: may this login send it, its body in words, its state (split out of books.js, whose size row may not grow; reads only — no journal write here).
 * OWNER     cb-finance
 * RISK      money
 * OWNS      MODE_WORDS · dateWords · adviceMay · adviceState · adviceBody · adviceFor · money · decimalPlaces · partyItems
 * CALLED BY lib/books.js (re-exported: routes/books.js and the payment sheet still ask books.js)
 * FLOW      a recorded payment + its context → store reads (advice row, entry, status) → adviceMay → the ready body, or the reason it may not be sent
 * CARD      16-finance/books-posting
 */
'use strict';
const { waiting } = require('./not-migrated');
const log = require('./logger');
const engines = require('./books-engines');
const store = require('./books-store');
const moneyOps = require('./books-money-ops');
const stated = require('./country-setup').currencyStated; /* the stated currency or null — never INR by name */
const isoDay = engines.ymd;

/** an amount in the shop's money words (bill-privacy's ONE formatter), lazy */
const money = (minor, currency) => require('./bill-privacy').money(minor, currency);
/** the currency's decimals (money.decimals); 2 when that helper fails, said in the log */
function decimalPlaces(currency) {
  try {
    const moneyModule = require('./money');
    return moneyModule.decimals ? moneyModule.decimals(currency) : 2;
  } catch (e) {
    log.fellBack('books dp: the helper failed — counted as 2', e);
    return 2;
  }
}

/** a party's rows on one control account (every account when none is named), read as the engine reads them */
async function partyItems(handle, entity, party, account_id) {
  return (await store.items(handle, entity, party, account_id)).map(engines.itemOf);
}

/* ═══ M30 · THE PAYMENT ADVICE, OUT (SPEC-payments §3 · §4.3; MASTER-BUILD row M30; FIT-shell: the payer settles its own books and informs) ═══
 * The advice is a CHIT the WEB sends (purpose 'general', business_json.kind 'payment_advice' — §3.1, D2): this file composes the
 * ready body and answers MAY (the same rule PATCH /payments/:id enforces), so the unit paints and never decides.
 * Invariants: an advice is sent only for a RECORDED payment (posted, not reversed, a cheque only once cleared) · ONE advice per payment
 * (store setAdvice first-wins) · nothing posts on the payee side at send (the hook classifies payment_advice as a queue until M31 Accept). */
/* ACC-300: a word for every mode a country pack takes (the advice sentence never prints a raw key); an unknown mode still prints itself */
const MODE_WORDS = { cash: 'cash', upi: 'by UPI', bank: 'by bank', card: 'by card', cheque: 'by cheque', eft: 'by EFT', bpay: 'by BPAY', payid: 'by PayID', eftpos: 'by EFTPOS', transfer: 'by bank transfer' };
const MONTHS3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-10-04' → '4 Oct 2026' (the advice names its day the way a person says it) */
function dateWords(date) {
  const dateText = isoDay(date);
  return dateText ? Number(dateText.slice(8, 10)) + ' ' + MONTHS3[Number(dateText.slice(5, 7)) - 1] + ' ' + dateText.slice(0, 4) : '';
}
/** the refusal words of the advice, keyed like a rail verdict: { ok: false, why, say } — the level words are the rail engine's own (one vocabulary) */
const ADVICE_SAY = {
  off_rail: (partyName) => partyName + ' is not on ChitBridge — share the advice instead.',
  on_rail: (partyName) => partyName + ' is on ChitBridge — send the advice instead.',
  not_posted: () => 'Nothing to advise — the payment did not post.',
  reversed: () => 'This payment was reversed.',
  cheque_held: () => 'A cheque is advised when it clears.',
  already_sent: () => 'An advice is already sent for this payment.',
  not_available: () => waiting('Payment advice', false, 'The payment itself is recorded; the advice cannot be sent or shown yet.')
};
const adviceNo = (reason, name) => ({ ok: false, why: reason, say: ADVICE_SAY[reason] ? ADVICE_SAY[reason](name || 'This party') : require('./rail').say(reason) });
/**
 * ⭐ adviceMay(facts) — MAY THIS LOGIN SEND / SHARE THE ADVICE OF THIS PAYMENT. The one rule: PATCH /payments/:id refuses with the same
 *   answer the read paints greyed. facts = { level (viewer·commenter·editor), ready, posted, reversed, cheque_held, on_rail, sent, name }
 *   → { send_advice: { ok } | { ok: false, why, say }, share_advice: … }
 *   send = on rail; share = off rail (copy / WhatsApp / e-mail — never a chit to nowhere). Both: a recorded payment, not reversed,
 *   not a held cheque, no advice sent yet; and a level that may answer the other party (rail byLevel: viewer → read_only, commenter → comment_only).
 */
function adviceMay(facts) {
  const x = facts || {},
    common = adviceRefusal(x);
  return {
    send_advice: common || (x.on_rail ? { ok: true } : adviceNo('off_rail', x.name)),
    share_advice: common || (!x.on_rail ? { ok: true } : adviceNo('on_rail', x.name))
  };
}
/** the refusal both send and share share (the level, then the payment's own state, in this order), or null when neither is refused on those grounds */
function adviceRefusal(x) {
  const levelVerdict = require('./rail').byLevel(x.level, 'advice');
  if (levelVerdict) return adviceNo(levelVerdict);
  if (!x.ready) return adviceNo('not_available');
  if (x.cheque_held) return adviceNo('cheque_held');
  if (!x.posted) return adviceNo('not_posted');
  if (x.reversed) return adviceNo('reversed');
  return x.sent ? adviceNo('already_sent') : null;
}
/** the advice STATE a statement line paints (SPEC §4.4): none · sent · delivered · shared · disputed — from the payment's columns and my copy's chit status */
function adviceState(row, chitStatus) {
  const payment = row || {};
  if (payment.advice_chit_id) {
    const chitCopy = chitStatus || null;
    return chitCopy && chitCopy.disputed ? 'disputed' : chitCopy && /^(delivered|read|accepted|completed|in_progress)$/.test(String(chitCopy.status || '')) ? 'delivered' : 'sent';
  }
  return payment.advice_shared_at ? 'shared' : 'none';
}
/**
 * ⭐ adviceBody(payment, context) — THE CHIT SEND BODY (§3.2, one shape): recipients · purpose 'general' · client_ref 'advice:pay:<id>' (chits /send dedupes on
 *   it — a retry answers the first chit) · line_items = the bills settled (ref_chit_id = the bill's chit_id, the same on both copies, which is what
 *   lets the payee settle the same bills in M31) · business_json.payment_advice (minor-unit integers are the source; amount / on_account in
 *   major units ride beside them for folders and the CRM timeline, derived here by the currency's own decimals — money.decimals).
 *   payment = the payment row; context = { me, party: { party_id, name }, entry_no, settled: [{ against_ref, bill_no, amount_minor }], on_account_minor }
 *   → { words, body, share: { text, wa, mailto } }
 */
function adviceBody(payment, context) {
  const currency = stated(payment.currency),
    decimals = decimalPlaces(currency),
    major = (minor) => Number(minor) / Math.pow(10, decimals);
  const out = payment.direction === 'out',
    shopName = context.me || 'We',
    partyName = (context.party && context.party.name) || 'you';
  const settled = (context.settled || []).filter((item) => Number(item.amount_minor) > 0),
    applied = moneyOps.sumMinor(settled, currency, (item) => item.amount_minor);
  const on_account = Math.max(0, Number(context.on_account_minor != null ? context.on_account_minor : payment.amount_minor - applied));
  const words = adviceWords(payment, { currency, shopName, settled, applied, on_account });
  const adviceBlock = {
    action: out ? 'paid' : 'received',
    adviser_payment_id: payment.payment_id,
    adviser_entry_no: context.entry_no || null,
    amount: major(payment.amount_minor),
    amount_minor: Number(payment.amount_minor),
    currency: currency,
    mode: payment.mode,
    reference: payment.reference || null,
    paid_on: isoDay(payment.received_at),
    applied_minor: applied,
    on_account: major(on_account),
    on_account_minor: on_account,
    collected_by: null,
    reverses_advice_chit_id: null,
    words
  };
  const body = adviceChitBody(payment, context, { currency, settled, major, adviceBlock });
  const subject = 'Payment advice' + (context.entry_no ? ' ' + context.entry_no : '') + ' — ' + shopName;
  const share = {
    text: words,
    wa: 'https://wa.me/?text=' + encodeURIComponent(words),
    mailto: 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(words)
  };
  return { words, body, share, to: partyName };
}
/** the one sentence of the advice: "We paid you ₹5,000 by UPI on 4 Oct 2026 for bills A-1 (₹3,000) · ₹2,000 as an advance." */
function adviceWords(payment, { currency, shopName, settled, applied, on_account }) {
  const out = payment.direction === 'out';
  let words =
    shopName +
    (out ? ' paid you ' : ' received ') +
    money(payment.amount_minor, currency) +
    ' ' +
    (MODE_WORDS[payment.mode] || payment.mode) +
    (out ? '' : ' from you') +
    ' on ' +
    dateWords(payment.received_at);
  if (settled.length)
    words +=
      ' for ' +
      (settled.length === 1 ? 'bill ' : 'bills ') +
      settled.map((item) => item.bill_no || item.against_ref).join(', ') +
      ' (' +
      money(applied, currency) +
      ')';
  if (on_account > 0) words += (settled.length ? ' · ' : ' · ') + money(on_account, currency) + ' as an advance';
  words += '.';
  if (payment.reference) words += ' Ref ' + String(payment.reference) + '.';
  return words;
}
/** the chit /send body of an advice (§3.2): the recipient, the bills settled as line items, and the payment_advice block */
function adviceChitBody(payment, context, { currency, settled, major, adviceBlock }) {
  return {
    recipients: context.party && context.party.party_id ? [{ entity_id: context.party.party_id, role: 'to' }] : [],
    purpose: 'general',
    manual_subject: 'Payment advice' + (context.entry_no ? ' ' + context.entry_no : ''),
    client_ref: 'advice:pay:' + payment.payment_id,
    line_items: settled.map((item) => ({
      particulars: 'Bill ' + (item.bill_no || item.against_ref),
      quantity: 1,
      unit: 'bill',
      price: major(item.amount_minor),
      total: major(item.amount_minor),
      currency: currency,
      ref_chit_id: item.against_ref,
      bill_no: item.bill_no || null,
      applied: major(item.amount_minor),
      applied_minor: Number(item.amount_minor)
    })),
    business_json: { kind: 'payment_advice', currency: currency, payment_advice: adviceBlock }
  };
}
/** the bills a payment settled, read back from the party rows (the engine's allocations) and named once, with what stayed on account → { settled, on_account_minor } */
async function settledFromRows(handle, entity, payment) {
  const items = await partyItems(handle, entity, payment.party_id, null);
  const mine = items.filter((item) => item.ref === 'pay:' + payment.payment_id && item.ref_kind === 'allocation' && item.against_ref !== item.ref);
  const billNumbers = await store.billNos(
    handle,
    entity,
    mine.map((item) => item.against_ref)
  );
  const settled = mine.map((item) => ({
    against_ref: item.against_ref,
    bill_no: billNumbers[item.against_ref] || null,
    amount_minor: Math.abs(Number(item.amount_minor))
  }));
  const outstandingPay = items.length ? engines.receivables().outstanding(items).by_ref['pay:' + payment.payment_id] : null;
  const on_account_minor =
    payment.mode === 'cheque'
      ? 0
      : outstandingPay
        ? Math.abs(Number(outstandingPay.outstanding_minor))
        : Math.max(0, moneyOps.diffMinor(payment.amount_minor, moneyOps.sumMinor(settled, stated(payment.currency), (item) => item.amount_minor), stated(payment.currency)));
  return { settled, on_account_minor };
}
/** the advice read's answer, shaped: who, the advice's state, what this login may do, and the words / body (null when it may not send / share) */
function adviceAnswer({ payment, party, name, ready, row, chitStatus, permissions, advice }) {
  return {
    payment_id: payment.payment_id,
    party: { party_id: payment.party_id, name, on_rail: party.on_rail === true },
    advice: {
      chit_id: row.advice_chit_id || null,
      state: ready ? adviceState(row, chitStatus) : 'none',
      shared_at: row.advice_shared_at ? new Date(row.advice_shared_at).toISOString() : null
    },
    may: permissions,
    words: advice.words,
    body: permissions.send_advice.ok ? advice.body : null,
    share: permissions.share_advice.ok ? advice.share : null
  };
}
/** the party's row (name · nickname · on_rail) from the caller's names map, else an empty row */
const partyRow = (context, payment) => (context.names && context.names.get(String(payment.party_id))) || {};
/** the payment's entry (the caller's, else read by its source) and whether that entry was reversed — two reads, as before */
async function postedState(handle, entity, payment, context) {
  const posted = context.entry_no ? { entry_no: context.entry_no, entry_id: context.entry_id } : await store.entryBySource(handle, entity, 'pay:' + payment.payment_id);
  const reversed = !!(posted && posted.entry_id && (await store.entryBySource(handle, entity, 'reverse:' + posted.entry_id)));
  return { posted, reversed };
}
/** the bills the payment settled and what stayed on account: the caller's (known from the record just made), else read back from the party rows */
async function settledOf(handle, entity, payment, context) {
  if (context.settled) return { settled: context.settled, on_account_minor: context.on_account_minor };
  return settledFromRows(handle, entity, payment);
}
/** my copy's chit status of the advice that was sent (one read), or null when none was */
async function adviceChitStatus(handle, entity, row) {
  return row.advice_chit_id ? (await store.adviceStates(handle, entity, [row.advice_chit_id]))[row.advice_chit_id] : null;
}
/**
 * ⭐ adviceFor(handle, entity, payment, context) — THE ADVICE READ (GET /payments/:id/advice; the same block rides on POST /payments). All from facts already in
 *   hand or ONE read each, never per row: the payment, its entry (posted · reversed, via entryBySource ×2), the party row (name · on_rail),
 *   the bills it settled (party_item once → the engine's allocations), their numbers (billNos once), my copy's chit status (adviceStates once).
 *   context = { level, me (shop name), names (partyNames map), ready, settled? (known from the record just made), entry_no?, on_account_minor? }
 *   → { payment_id, party: { party_id, name, on_rail }, advice: { chit_id, state, shared_at }, may, words, body, share }
 */
async function adviceFor(handle, entity, payment, context) {
  const party = partyRow(context, payment),
    name = party.nickname || party.name || 'this party';
  const ready = context.ready !== false;
  const row = ready ? (await store.paymentsAdvice(handle, entity, [payment.payment_id]))[0] || {} : {};
  const { posted, reversed } = await postedState(handle, entity, payment, context);
  const { settled, on_account_minor } = await settledOf(handle, entity, payment, context);
  const cheque_held = payment.mode === 'cheque' && !(posted && posted.entry_id);
  const chitStatus = await adviceChitStatus(handle, entity, row);
  const permissions = adviceMay({
    level: context.level,
    ready,
    posted: !!(posted && posted.entry_id),
    reversed,
    cheque_held,
    on_rail: party.on_rail === true,
    sent: !!row.advice_chit_id,
    name
  });
  const advice = adviceBody(payment, { me: context.me, party: { party_id: payment.party_id, name }, entry_no: posted ? posted.entry_no : null, settled, on_account_minor });
  return adviceAnswer({ payment, party, name, ready, row, chitStatus, permissions, advice });
}


module.exports = { MODE_WORDS, dateWords, adviceMay, adviceState, adviceBody, adviceFor, money, decimalPlaces, partyItems };
