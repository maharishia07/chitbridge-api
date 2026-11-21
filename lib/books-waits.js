/**
 * books-waits.js — WHAT THE BOOKS ARE WAITING FOR on a received bill, said at the accept (ACC-377; split out of books-hooks.js, whose size row may not grow).
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      waitsFor · supplierWords · lockWords
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

module.exports = { waitsFor, supplierWords, lockWords };
