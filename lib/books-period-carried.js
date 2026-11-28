'use strict';
/**
 * lib/books-period-carried.js — A CLOSED TAX PERIOD REPLAYED FROM ITS OWN CARRIED FIGURES (b854): what was paid since the close, and what was reversed.
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      paidSinceClose · noteReversed · subtractPaidSince (the replay steps of carriedClose; the figures a close carried are never re-derived).
 * CALLED BY lib/books-period.js (carriedClose) — built once with its pack readers, so the one reader of tax heads stays there.
 * FLOW      stored close figures + the payments named after it → the answer less what was paid since → the still-to-pay total added up again
 * CARD      16-finance/month-and-year-end
 */
module.exports = ({ headsOf, rcmHeadsOf, minorMap }) => {
  /** the payments named for a tax head after its close, added up per head: { since: output-tax heads, sinceRcm: reverse-charge heads } */
  function paidSinceClose(pack, payRows) {
    const since = {},
      sinceRcm = {};
    payRows.forEach((payRow) => {
      const x = headsOf(pack).find((y) => y.output === payRow.role || y.rcm === payRow.role),
        bucket = x.output === payRow.role ? since : sinceRcm;
      bucket[x.head] = (bucket[x.head] || 0) + payRow.dr_minor;
    });
    return { since, sinceRcm };
  }
  const named0 = (stored, head) => ((stored.paid_rcm || {})[head]) || 0;
  /** a payment counted at the close that was reversed since: the figures stand, the answer says the tax is owed again in the books (and the mismatch is logged) */
  function noteReversed(answer, stored, live, entity, span) {
    const gone = (stored.paid_entries || []).filter((id) => live.entries.indexOf(id) < 0);
    if (!gone.length) return;
    answer.paid_note = 'A payment counted when this period was closed has been reversed since. The close figures stand as they were; the tax is owed again in the books.';
    require('./logger').warn('tax_close.mismatch', { entity_id: entity, close: span.key, reversed_entries: gone });
  }
  /** a closed period replayed: the payments named since the close come off the figures it carried (forward heads and reverse charge), and the still-to-pay total is added up again */
  function subtractPaidSince(answer, pack, stored, since, sinceRcm) {
    const heads = headsOf(pack).map((x) => x.head);
    answer.paid_since_close_minor = minorMap(since, heads, '_minor');
    let total = 0;
    heads.forEach((head) => {
      answer.still_to_pay_minor[head + '_minor'] = Math.max(0, (answer.still_to_pay_minor[head + '_minor'] || 0) - (since[head] || 0));
      total += answer.still_to_pay_minor[head + '_minor'];
    });
    rcmHeadsOf(pack).forEach((head) => {
      total += Math.max(0, ((answer.rcm_minor || {})[head] || 0) - (named0(stored, head) + (sinceRcm[head] || 0)));
    });
    answer.still_to_pay_total_minor = total;
  }
  return { paidSinceClose, noteReversed, subtractPaidSince };
};
