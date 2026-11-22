'use strict';
/**
 * lib/books-event-guard.js — R12a + R4: what a typed Day book event (POST /events) meets just before the one writer.
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      posted(entity, { kind, ev }) → the entry the one writer posted (+ `warnings` when it looks like an earlier one) · sameLines(composed, stored) · refuseOtherPayment(handle, entity, sent, first) · signature(lines, day)
 * CALLED BY lib/books-manual.js post · lib/books.js recordPayment (AW-F-01)
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 * FLOW      the event ──▶ books.previewEntry (the journal it WOULD post, nothing written) ──▶
 *             R12a  same client_ref (source_ref) already posted AND the journal differs  ──▶ 409 EVENT_REF_REUSED naming that entry_no; the same journal replays unchanged (duplicate: true)
 *             R4    another source_ref, same day, same accounts, same amounts, same party within WINDOW_MINUTES ──▶ still posts, answers warnings: [{ code: 'LOOKS_LIKE_EARLIER', entry_no, words }]
 * A journal is the comparison, not the raw body: the body's spelling (rupees or minor units, key order) cannot make one entry look like two, and nothing is hashed or stored anew (no migration).
 * Xero and QuickBooks warn on a probable duplicate and let it through; so does this. Never refuses on a look-alike.
 * ⚠️ Law is not a switch: this is a duplicate check on the typed door, it changes no posting rule.
 */
const WINDOW_MINUTES = 10;
const dayOf = (value) => (value ? require('./books-engines').ymd(value) : ''); /* the ONE day reader (books-engines.ymd) */
/** one entry's comparable shape: its day and its lines (account, Dr, Cr, party) in a fixed order */
function signature(lines, day) {
  const rows = (lines || []).map((line) => [line.account_id, Number(line.dr_minor), Number(line.cr_minor), line.party_id || ''].join('|')).sort();
  return day + '#' + rows.join(';');
}
const sameLines = (composed, stored) => signature(composed.lines, dayOf(composed.docDate)) === signature(stored.lines, dayOf(stored.doc_date));
/** the shop's entries made in the last WINDOW_MINUTES (the statement is inline: this module reads only the shop's own rows) */
async function recent(handle, entity) {
  const result = await handle.query(`SELECT entry_id, entry_no, source_ref FROM journal_entry WHERE entity_id = $1 AND created_at > now() - ($2::int * interval '1 minute') ORDER BY created_at DESC LIMIT 25`, [entity, WINDOW_MINUTES]);
  return result.rows || [];
}
/** the ONE comparison: a stored entry under this reference whose journal differs → 409 EVENT_REF_REUSED; the same journal passes (a replay) */
function refuseOther(event, composed, seen) {
  if (!seen || !event.source_ref || !composed || sameLines(composed, seen)) return;
  throw reused(event.source_ref, seen.entry_no);
}
/** the ONE refusal for a reference sent again with another body (events and payments both): 409 EVENT_REF_REUSED in words */
function reused(ref, entryNo) {
  return Object.assign(new Error('The reference ' + String(ref).replace(/^ev:[a-z_]+:/, '') + ' is already used for a different ' + (entryNo ? 'entry (' + entryNo + ')' : 'payment') + '. Nothing was posted: send a new reference for a new entry, or the same body to repeat that one.'), { code: 'EVENT_REF_REUSED', refused: true, entry_no: entryNo || null });
}
/** AW-F-01: POST /payments meets its first payment under the same client_ref. The same party, side, currency and amount replay unchanged; any other body is the same 409 as a Day book event. The stored row is the comparison: a refund, a foreign payment or a held cheque has no journal a preview could recompose */
async function refuseOtherPayment(handle, entity, sent, first) {
  const same = (a, b) => a == null || b == null || String(a) === String(b);
  if (!first || (same(first.party_id, sent.party_id) && same(first.direction, sent.direction) && same(first.currency, sent.currency) && same(first.mode, sent.mode) && Number(first.amount_minor) === Number(sent.amount_minor))) return;
  const entry = await require('./books-store').entryBySource(handle, entity, 'pay:' + first.payment_id);
  throw reused(sent.client_ref, entry && entry.entry_no);
}
/** called by postEntry INSIDE its transaction after it took the reference's lock: compares the body with the COMMITTED winner */
async function onSeen(handle, entity, event, seen) {
  let composed;
  /* AV-F-03: the body is compared BEFORE any lock answer — a replay with another amount in a hard-locked month is the same 409 as in an open one (ignoreLock: the journal, not its landing month) */
  try { composed = await require('./books').previewEntry(handle, entity, event, { ignoreLock: true }); } catch (error) { return noPreview(error); }
  if (composed && composed.ok) refuseOther(event, composed, await require('./books-store').entry(handle, entity, seen.entry_id));
}
/** the preview could not compose the journal: nothing to compare, logged; the real write meets the refusal and says it to the person */
function noPreview(error) {
  require('./logger').fellBack('books-event-guard: the preview did not compose; the one writer answers the person', error);
  return null;
}
/** the look-alike judgement before the write: the stored entry under this ref is compared (a different journal is refused), else a recent look-alike's entry_no → { later } or null */
async function judge(entity, event) {
  const books = require('./books'), store = require('./books-store');
  return require('../db').withEntity(entity, async (handle) => {
    let composed;
    try { composed = await books.previewEntry(handle, entity, event); } catch (error) { return noPreview(error); }
    if (!composed || !composed.ok) return null;
    const seen = event.source_ref && composed.duplicate ? await store.entry(handle, entity, composed.duplicate.entry_id) : null;
    refuseOther(event, composed, seen);
    return { later: seen ? null : await lookalike(handle, entity, event, composed, store) };
  });
}
/** the first recent entry (another reference) whose day, accounts, amounts and party are the same → its entry_no, else null */
async function lookalike(handle, entity, event, composed, store) {
  for (const row of await recent(handle, entity)) {
    if (row.source_ref && row.source_ref === event.source_ref) continue;
    const other = await store.entry(handle, entity, row.entry_id);
    if (other && sameLines(composed, other)) return other.entry_no;
  }
  return null;
}
/** post through the one writer; a look-alike rides on the answer as a non-blocking warning */
async function posted(entity, built) {
  const found = await judge(entity, built.ev);
  const out = Object.assign({ kind: built.kind }, await require('./books').postEntry(null, entity, built.ev, { onSeen: (handle, seen) => onSeen(handle, entity, built.ev, seen) }));
  if (found && found.later && !out.duplicate && out.ok) out.warnings = [{ code: 'LOOKS_LIKE_EARLIER', entry_no: found.later, words: 'This looks like ' + found.later + ': the same day, accounts, amounts and party within minutes. It was posted; if it was a repeat, reverse it.' }];
  return out;
}
module.exports = { posted, onSeen, refuseOther, refuseOtherPayment, sameLines, signature, WINDOW_MINUTES };
