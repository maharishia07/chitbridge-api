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
const store = require('./books-store');

/** the sentence the refusal and the greyed Reverse button both say (one text, the server's; the register row ENTRY_OF_LIVE_BILL carries the same words) */
const LIVE_BILL_WORDS = 'This entry is a bill that is still live. Make a credit note instead.';
/** the sentence for a loan whose instalments are still live: the store's ONE text (the register row ENTRY_HAS_REPAYMENTS carries the same words) */
const LIVE_REPAYMENT_WORDS = store.LOAN_HAS_INSTALMENTS_WORDS;
/**
 * R1-03 · which of these entries are the posting of a bill that is still LIVE: a sale_bill or purchase_bill whose source_ref is chit:<id> (or its :asset / :use half, so a purchase bill is never half reversed), that nothing has reversed,
 * and whose chit nobody has cancelled or rejected (chit_status on my copy). Reverse is refused for these (lib/books-live-bill.js refuseLiveBill): a bill leaves the books through a credit note,
 * or through its own cancel (chit-move → books-hooks.takeBackCancelled never comes through the route, so it is untouched). One read for a page → Set of entry_id.
 */
async function liveBillEntries(db, entity, entryIds) {
  const ids = (entryIds || []).filter((item) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(item)));
  if (!ids.length) return new Set();
  const found = await db.query(
    `SELECT x.entry_id FROM journal_entry x
      WHERE x.entity_id = $1 AND x.entry_id = ANY($2::uuid[]) AND x.event_type IN ('sale_bill', 'purchase_bill') AND x.source_ref ~ '^chit:[0-9a-f-]{36}(:asset|:use)?$'
        AND NOT EXISTS (SELECT 1 FROM journal_entry r WHERE r.entity_id = x.entity_id AND r.reverses_entry_id = x.entry_id)
        AND NOT EXISTS (SELECT 1 FROM chit_status cs WHERE cs.entity_id = x.entity_id AND cs.chit_id = substr(x.source_ref, 6, 36)::uuid AND cs.current_status IN ('cancelled', 'rejected')) /* the WITHDRAWN list of lib/rail-actions */`,
    [entity, ids]
  );
  return new Set(found.rows.map((row) => String(row.entry_id)));
}

/** the ONE ask: why Reverse is refused for each of these entries → Map entry_id → { code, words } (a live bill, or a loan with live repayments); an entry not in the map may be reversed */
async function reverseRefusals(db, entity, entryIds) {
  const [bills, loans] = await Promise.all([liveBillEntries(db, entity, entryIds), store.loanEntriesWithRepayments(db, entity, entryIds)]);
  const out = new Map();
  loans.forEach((id) => out.set(id, { code: 'ENTRY_HAS_REPAYMENTS', words: LIVE_REPAYMENT_WORDS }));
  bills.forEach((id) => out.set(id, { code: 'ENTRY_OF_LIVE_BILL', words: LIVE_BILL_WORDS }));
  return out;
}

/** show every action, the server answers may/why: each day-book entry carries may_reverse, and a live bill's Reverse is greyed with the sentence (the route refuses it too); ONE read for the page → the same entries */
async function markReverseAnswers(handle, entity, entries) {
  const held = await reverseRefusals(handle, entity, entries.map((item) => item.entry_id));
  for (const item of entries) {
    item.why = held.get(String(item.entry_id)) || null;
    item.may_reverse = !item.why;
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
    const held = (await withEntity(entity, (handle) => reverseRefusals(handle, entity, [entryId]))).get(entryId);
    if (held) return problem(req, res, { status: 409, code: held.code, detail: held.words });
    return next();
  } catch (err) {
    return problem(req, res, refusalOf(err, req));
  }
}

module.exports = { LIVE_BILL_WORDS, LIVE_REPAYMENT_WORDS, liveBillEntries, reverseRefusals, markReverseAnswers, refuseLiveBill };
