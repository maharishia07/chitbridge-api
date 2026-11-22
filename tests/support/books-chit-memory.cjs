'use strict';
/**
 * OWNS      the in-memory answer to the reads of chit_header the books libs make (no chit is held in memory, so each read finds no row): lib/books-evidence (the bill a ledger row came from), lib/tax-copy (the bill's tax copy), lib/money-check.resolve (is the credit note / corrected bill a chit of this shop? the refusal, 400, is what the route answers, never a 500 from a store with no answer).
 * CALLED BY tests/support/books-memory.cjs (fakeDb.query, one line)
 * FLOW      the SQL text ──▶ { rows: [] } when it is one of these chit_header reads, else null (the caller goes on)
 * CARD      qa/offline-guards
 */
const ASKED = [
  /^SELECT chit_id, sent_at, business_json->'invoice' AS invoice FROM chit_header/,
  /^SELECT h.chit_id, h.sender_entity_id, h.all_recipients, h.business_json/,
  /^SELECT 1 FROM chit_header WHERE entity_id = \$1 AND chit_id::text = \$2/,
];
/** @returns {{rows: []}|null} an empty answer when the text is a chit_header read listed above, else null */
function answer(text) {
  const trimmed = String(text).trim();
  return ASKED.some((pattern) => pattern.test(trimmed)) ? { rows: [] } : null;
}
module.exports = { answer };
