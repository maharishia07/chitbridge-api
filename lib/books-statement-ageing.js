/**
 * books-statement-ageing.js — the AGEING SCHEDULE a country's balance sheet carries beside it (India: Schedule III trade receivables / trade payables ageing).
 *
 * OWNS      statementAgeing (the schedule for one as-at day, built only when the shop's PACK names `presentation.statementAgeing`; no pack member, no schedule — never another country's)
 * CALLED BY routes/books.js GET /bs
 * FLOW      the pack's note + the debtors / creditors party items → books-engines.dues (the engine's pack buckets, counted from the DUE date) → one row per bucket, undisputed and disputed apart → the page prints
 * CARD      02-accounting/ACC-355
 *
 * Computes nothing new: the buckets and the amounts are CBLedger.ageing's, read through the same dues() the Receivables and Payables screens use; the words are the pack's. The dues screens keep
 * their ONE ageing in days past due (W15-94) — this is the statutory schedule only, on the balance sheet.
 */
'use strict';
const E = require('./books-engines');
const S = require('./books-store');

/** one side of the schedule from the engine's ageing answer: rows in the pack's bucket order, each with the words the pack gives it */
function rowsOf(buckets, words, aged) {
  const rows = buckets.map((bucket) => {
    const undisputed = (aged.buckets.undisputed || {})[bucket[0]] || 0,
      disputed = (aged.buckets.disputed || {})[bucket[0]] || 0;
    return { key: bucket[0], label: words.labels[bucket[0]] || bucket[0], undisputed_minor: undisputed, disputed_minor: disputed, total_minor: undisputed + disputed };
  });
  return { title: words.title, rows, total_minor: rows.reduce((total, row) => total + row.total_minor, 0) };
}

/**
 * statementAgeing(h, e, chart, pack, asOf, cut) → null (the pack has no such note) | { cite, as_at, receivable: { title, rows[], total_minor }, payable: { … } }
 * `cut` is the shop's end-of-day moment (a created_at before it counts), exactly as GET /dues reads it.
 */
async function statementAgeing(h, e, chart, pack, asOf, cut) {
  const note = pack && pack.presentation && pack.presentation.statementAgeing;
  if (!note) return null;
  const out = { cite: note.cite, as_at: asOf };
  for (const [role, side, key] of [['debtors', 'receivable', 'receivable'], ['creditors', 'payable', 'payable']]) {
    const account = chart.find((item) => item.role === role);
    const items = account ? (await S.items(h, e, null, account.account_id)).filter((item) => new Date(item.created_at).getTime() < cut).map(E.itemOf) : [];
    const aged = E.dues(items, asOf, side, { pack }).ageing;
    out[key] = rowsOf(pack.presentation.ageing[side], note[side], aged);
  }
  return out;
}
module.exports = { statementAgeing, rowsOf };
