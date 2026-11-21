/** tests/support/ledger-months-memory.cjs — the in-memory answer to lib/ledger-months.monthSums: Σ Dr / Σ Cr per posting month, the real filters. */
'use strict';
module.exports = function monthRows(T, text, v) {
  const [e, from, to, acc, party] = v, by = {};
  for (const l of T.lines) {
    const h = T.entries.find((x) => x.entry_id === l.entry_id), d = String(h.posting_date).slice(0, 10);
    if (l.entity_id !== e || d < from || d > to || (acc && l.account_id !== acc) || (party && l.party_id !== party) || (/period <> 0/.test(text) && Number(h.period) === 0)) continue;
    const m = by[d.slice(0, 7)] || (by[d.slice(0, 7)] = { month: d.slice(0, 7), dr: 0, cr: 0 });
    m.dr += Number(l.dr_minor || 0); m.cr += Number(l.cr_minor || 0);
  }
  return { rows: Object.keys(by).sort().map((k) => by[k]) };
};
