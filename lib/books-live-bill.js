'use strict';
// OWNS      R1-03 (DEC-267): a bill that is still LIVE leaves the books through a credit note, never through Reverse: which entries are live bills (one read for a page),
//           the sentence, the route guard on POST /entries/:id/reverse, and the day book's may_reverse + why for each entry
// CALLED BY routes/books.js (the day book answers · the guard in the POST /entries/:id/reverse chain)
// FLOW      day book page → markReverseAnswers → liveBillEntries (one query) · Reverse press → refuseLiveBill → 409 ENTRY_OF_LIVE_BILL, else on to B.reverseEntry (untouched: the cancel path reaches it directly)
// CARD      14-accounting/books-reverse-live-bill
const { withEntity } = require('../db');
const { problem } = require('./problem');
const { refusalOf } = require('./books-contract');
const auth = require('../middleware/auth');

/** the sentence the refusal and the greyed Reverse button both say (one text, the server's; the register row ENTRY_OF_LIVE_BILL carries the same words): a bill I SOLD, and the default */
const LIVE_BILL_WORDS = 'This entry is a bill that is still live. Make a credit note instead.';
/** the same refusal, worded by the side of the entry (ACC-357 Q4): a buyer cannot make a credit note, a day entry holds many bills, a credit note or an expense has its own way out */
const BUYER_WORDS = 'This entry is a bill from your supplier that is still live. Ask the supplier for a credit note, or reject the bill.';
const DAY_WORDS = "This entry is the day's counter sales. Cancel the bill or make a credit note instead.";
const OTHER_WORDS = 'This entry belongs to a document that is still live. Cancel that document instead of reversing the entry.';
/** the words for an entry of this event type: a purchase side, a walk-in day, a credit note / expense / anything else a live chit posted, or a bill I sold */
function wordsOf(eventType) {
  if (eventType === 'purchase_bill') return BUYER_WORDS;
  if (eventType === 'walkin_day') return DAY_WORDS;
  return ["sale_bill", "debit_note"].includes(eventType) ? LIVE_BILL_WORDS : OTHER_WORDS;
}
/** what a live chit posts that Reverse must not undo: its bills, its debit and credit notes, its expense (Athi 18 Nov, Q4). A payment stays reversible by design (#1321: a wrong payment is corrected by reversing it) */
const LIVE_TYPES = ['sale_bill', 'purchase_bill', 'debit_note', 'return', 'credit_note', 'purchase_return', 'expense'];
/** a chit nobody has cancelled or rejected: the WITHDRAWN list of lib/rail-actions, on my copy (chit_status) */
const WITHDRAWN = "cs.current_status IN ('cancelled', 'rejected')";
/**
 * R1-03 + ACC-357 Q4 · which of these entries are the posting of something that is still LIVE, and of what kind (entry_id → event_type): ANY entry whose source is chit:<id> (or its :asset / :use half, so a
 * purchase bill is never half reversed) while that chit is live (a bill, a debit note, a credit note, an expense, a payment); and the walk-in DAY entry (source walkin:<counter>:<day>) while any bill it covers
 * (source_chit_ids) is live. Nothing has reversed it. Reverse is refused for these (refuseLiveBill; the delegated Reverse asks too): the way out is a credit note, a cancel or a reject. The cancel path
 * (chit-move → books-hooks.takeBackCancelled) never comes through here, so it is untouched. Two reads for a page, the second apart so a database without source_chit_ids (b273) costs nothing.
 */
async function liveEntryKinds(db, entity, entryIds) {
  const ids = (entryIds || []).filter((item) => /^[0-9a-f-]{36}$/i.test(String(item)));
  const live = new Map();
  if (!ids.length) return live;
  const chitSourced = await db.query(
    `SELECT x.entry_id, x.event_type FROM journal_entry x
      WHERE x.entity_id = $1 AND x.entry_id = ANY($2::uuid[]) AND x.event_type = ANY($3::text[]) AND x.source_ref ~ '^chit:[0-9a-f-]{36}(:asset|:use)?$'
        AND NOT EXISTS (SELECT 1 FROM journal_entry r WHERE r.entity_id = x.entity_id AND r.reverses_entry_id = x.entry_id)
        AND NOT EXISTS (SELECT 1 FROM chit_status cs WHERE cs.entity_id = x.entity_id AND cs.chit_id = substr(x.source_ref, 6, 36)::uuid AND ${WITHDRAWN})`,
    [entity, ids, LIVE_TYPES]
  );
  chitSourced.rows.forEach((row) => live.set(String(row.entry_id), row.event_type));
  const days = await require('../db').trySavepoint(
    db,
    (handle) =>
      handle.query(
        `SELECT x.entry_id, x.event_type FROM journal_entry x
      WHERE x.entity_id = $1 AND x.entry_id = ANY($2::uuid[]) AND x.event_type = 'walkin_day'
        AND NOT EXISTS (SELECT 1 FROM journal_entry r WHERE r.entity_id = x.entity_id AND r.reverses_entry_id = x.entry_id)
        AND (COALESCE(cardinality(x.source_chit_ids), 0) = 0
          OR EXISTS (SELECT 1 FROM unnest(x.source_chit_ids) c(id) WHERE NOT EXISTS (SELECT 1 FROM chit_status cs WHERE cs.entity_id = x.entity_id AND cs.chit_id = c.id AND ${WITHDRAWN})))`,
        [entity, ids]
      ),
    { rows: [] }
  );
  days.rows.forEach((row) => live.set(String(row.entry_id), row.event_type));
  return live;
}
/** the entries of the page that are live, as a Set (the day book and the guard read this) */
async function liveBillEntries(db, entity, entryIds) {
  return new Set((await liveEntryKinds(db, entity, entryIds)).keys());
}

/** show every action, the server answers may/why: each day-book entry carries may_reverse, and a live bill's Reverse is greyed with the sentence (the route refuses it too); ONE read for the page → the same entries */
async function markReverseAnswers(handle, entity, entries) {
  const live = await liveEntryKinds(handle, entity, entries.map((item) => item.entry_id));
  for (const item of entries) {
    item.may_reverse = !live.has(String(item.entry_id));
    item.why = item.may_reverse ? null : { code: 'ENTRY_OF_LIVE_BILL', words: wordsOf(live.get(String(item.entry_id))) };
  }
  return entries;
}
/**
 * the guard in POST /entries/:id/reverse's chain, after auth, owner and the input check. The guard sits HERE, not in B.reverseEntry: the cancel path (chit-move →
 * books-hooks.takeBackCancelled) reaches the writer too and must keep working. An entry already reversed is not live: it goes on and answers ALREADY_REVERSED.
 */
async function refuseLiveBill(req, res, next) {
  try {
    const entity = auth.entityOf(req), entryId = String(req.params.id);
    const live = await withEntity(entity, (handle) => liveEntryKinds(handle, entity, [entryId]));
    if (live.has(entryId)) return problem(req, res, { status: 409, code: 'ENTRY_OF_LIVE_BILL', detail: wordsOf(live.get(entryId)) });
    return next();
  } catch (err) {
    return problem(req, res, refusalOf(err, req));
  }
}

module.exports = { LIVE_BILL_WORDS, wordsOf, liveBillEntries, liveEntryKinds, markReverseAnswers, refuseLiveBill };
