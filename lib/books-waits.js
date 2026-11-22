/**
 * books-waits.js — WHAT THE BOOKS ARE WAITING FOR on a received bill, said at the accept (ACC-377; split out of books-hooks.js, whose size row may not grow).
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      waitsFor · supplierWords · lockWords · countNow · saleOfBill · saleReturnWait · billReturnWait
 * CALLED BY lib/chit-move.js (an accept answers with it on its `warning` line) · lib/books-hooks.js (supplierCheck parks with supplierWords — one sentence, one place)
 * FLOW      accepted chit ──▶ readAndClassify (the hook's own read; retry: true so it parks nothing) ──▶ the seller on the supplier list? ──▶ a rate for each foreign day? ──▶ the sentence, or null
 * CARD      14-accounting/foreign-currency
 * A READ: it never posts, never parks, never throws (a failed read says nothing and is logged). The hook after the commit stays after-commit and never awaited (Athi, 1 Oct); this only
 * lets the accept SAY what that hook will find, so "accepted" never hides "not in your books yet".
 */
'use strict';
const books = require('./books');
const booksStore = require('./books-store');
const log = require('./logger');
const hooks = () => require('./books-hooks'); /* lazy — books-hooks reads this module */
const withEntity = (entity, work) => require('../db').withEntity(entity, work);

/** the sentence a received bill waits with when its seller is not on the supplier list — ONE place (supplierCheck parks with it; waitsFor says it on the accept) */
function supplierWords(entry) {
  const text = hooks().sellerNameOf(entry.sells ? null : entry) + ' is not on your supplier list — add them, then this posts';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * waitsFor(entity, chit_id) → the sentence the books WAIT with for this chit, or null. It classifies the copy exactly as the hook will and asks the same two questions in the same order:
 * the supplier on the list (supplierWords), then a rate for a foreign day (fx-rates missingWords, with the last earlier rate named when there is one).
 */
async function waitsFor(entity, chit_id) {
  try {
    const setting = await hooks().isOn(entity);
    if (!setting) return null;
    const read = await hooks().readAndClassify(entity, chit_id, setting, { retry: true });
    if (read.early) return null;
    if (read.verdict.kind === 'queue') return read.verdict.why || null;
    return await withEntity(entity, (db) => unpostedWait(db, entity, setting, read));
  } catch (e) {
    log.warn('books.waits-for-failed', { entity_id: entity, chit_id, error: String(e && e.message), then: 'the accept answers without the books sentence' });
    return null;
  }
}
/** the events a verdict would post: its list, else its one event, else none */
const eventsOf = (verdict) => (verdict.kind === 'post' ? verdict.events || (verdict.event ? [verdict.event] : []) : []);
/** what a copy that WOULD post still waits for (a read): not already in the books, the seller on the supplier list, then a rate for each foreign day — null when nothing */
async function unpostedWait(db, entity, setting, read) {
  const { entry, verdict } = read;
  const events = eventsOf(verdict);
  if (!events.length || (await booksStore.entryBySource(db, entity, events[0].source_ref))) return null;
  if (verdict.supplier_check && events[0].party) {
    const on = await booksStore.partyOn(db, entity, events[0].party);
    if (!on || !on.supplier) return supplierWords(entry);
  }
  return (await rateWait(db, entity, String((books.packOf(setting) || {}).currency || '').toUpperCase(), events)) || lockWords(db, entity, events[0]);
}
/**
 * WALK W W-F-02 · a bill whose own day is in a LOCKED month posts on the first open day (doc date kept) — the accept SAYS so instead of a silent 1 Dec. Asks the writer's own read-only composition
 * (books.previewEntry → `moved`, `posting_date`), never a second date rule. → the sentence, or null (not moved, or the read said nothing).
 */
async function lockWords(db, entity, event) {
  try {
    const shown = await books.previewEntry(db, entity, event);
    if (!shown || !shown.ok || !shown.when || !shown.when.moved) return null;
    const said = require('./books-payment-advice').dateWords;
    return 'The bill is dated ' + said(shown.docDate || event.date) + ', in a month that is locked, so it will post on ' + said(shown.when.date) + ' (the first open day) and keep its own date.';
  } catch (e) {
    return null;
  }
}
/** the first foreign event with no rate for its day, as the sentence Waiting shows (with the last earlier rate named); null when every rate is there */
async function rateWait(db, entity, functional, events) {
  const rates = require('./fx-rates');
  for (const event of events) {
    const currency = String(event.currency || '').toUpperCase();
    if (!currency || currency === functional || (event.fx_rate != null && event.fx_rate !== '')) continue;
    if (!(await rates.rateOn(db, entity, currency, functional, event.date))) return rates.missingWords(currency, event.date, await rates.suggest(db, entity, currency, functional, event.date));
  }
  return null;
}

/**
 * countNow(entity, chit_id) → the figure the books would accept this bill AT, in minor units: the shortfall's ours_minor (reviews6 EL-04 M11: an
 * accept-at-the-count carries the figure the screen showed, and the move answers 409 when this is no longer it). A read, like waitsFor.
 * null = no shortfall now (the count agrees, or the bill is no longer waiting on one); undefined = it could not be read.
 */
async function countNow(entity, chit_id) {
  try {
    const setting = await hooks().isOn(entity);
    if (!setting) return null;
    const read = await hooks().readAndClassify(entity, chit_id, setting, { retry: true });
    if (read.early) return null;
    const verdict = read.verdict || {};
    const short = verdict.short || (verdict.event && verdict.event.short) || null;
    return short && Number.isFinite(Number(short.ours_minor)) ? Math.round(Number(short.ours_minor)) : null;
  } catch (e) {
    log.warn('books.count-now-failed', { entity_id: entity, chit_id, error: String(e && e.message) });
    return undefined;
  }
}

/* ⭐ a credit note waits for what it reverses (M-F-04 the sale I issued · AO-F-02 the bill I received) — moved here from books-hooks, which holds the size line */
/** the chit of MY sale whose bill number a credit note names (the till's own bill_no) → chit_id | null; ONE lookup for the wait and for against_ref (postEvents) */
async function saleOfBill(entity, billNo) {
  const found = await withEntity(entity, (db) =>
    db.query(`SELECT chit_id FROM chit_header WHERE entity_id = $1 AND sender_entity_id = $1 AND business_json->>'bill_no' = $2 LIMIT 1`, [entity, String(billNo)])
  );
  return found.rows[0] ? found.rows[0].chit_id : null;
}
/**
 * ⭐ WALK M M-F-04: the same books order for a CREDIT NOTE I issue on my own sale (a return naming the bill it is against). A cash walk-in sale waits for the day close, so the note waits with it
 * and posts after the day (the day's own close, a retry, the nightly sweep) — never Cash below 0 and Output tax on the debit side in between. A sale that is cancelled or rejected never posts,
 * so it holds nothing. → a queue verdict, or null.
 */
async function saleReturnWait(entity, event) {
  if (!event || event.type !== 'return' || !event.against_bill) return null;
  const saleId = await saleOfBill(entity, event.against_bill);
  if (!saleId || (await withEntity(entity, (db) => booksStore.chitPosted(db, entity, saleId)))) return null;
  const sale = await require('./tax-copy').copyOf(saleId, entity);
  if (!sale || hooks().REFUSED.test(String(sale.current_status || ''))) return null;
  return { kind: 'queue', wait: 'original', why: 'The sale this credit note reverses (' + event.against_bill + ') is not in the books yet, so the note waits for it and posts after it. A walk-in cash sale posts when the day is closed.' };
}
/**
 * ⭐ AO-F-02 (walk AO, 22 Nov 2026): a rail CREDIT NOTE I RECEIVED posts after the bill it reverses, the way the till side's note waits for its sale (saleReturnWait). A bill that is disputed (or not yet accepted) is not in the books, so the note
 * alone would show the supplier owing me with no bill behind it. It waits, named, and the next retry / nightly sweep posts it once the bill has posted. A bill that is cancelled or rejected never posts, so it holds nothing.
 * → a queue verdict, or null (the note names no bill · the bill is posted · the bill can never post).
 */
async function billReturnWait(entity, copy) {
  const against = require('./credit-cap').againstOf(copy.business_json); /* the ONE reader of the bill a note names */
  if (!against.chit_id) return null;
  if (await withEntity(entity, (db) => booksStore.chitPosted(db, entity, against.chit_id))) return null;
  const bill = await require('./tax-copy').copyOf(against.chit_id, entity);
  if (!bill || hooks().REFUSED.test(String(bill.current_status || ''))) return null;
  return { kind: 'queue', wait: 'original', why: 'The bill this credit note reduces' + (against.bill_no ? ' (' + against.bill_no + ')' : '') + ' is not in the books yet, so the note waits for it and posts after it.' };
}
module.exports = { waitsFor, supplierWords, lockWords, countNow, saleOfBill, saleReturnWait, billReturnWait };
