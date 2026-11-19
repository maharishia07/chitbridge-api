'use strict';
// OWNS      two small readers split out of books.js and books-engines.js so neither grows past its size row: contiguousYears (every fiscal year of the carry chain) and settledOf (what a bill's allocations have settled)
// CALLED BY lib/books.js carryKeyOf (contiguousYears) · lib/books-opening.js (settledOf)
// FLOW      contiguousYears(packs, pack, years) → every fiscal year from the oldest to the newest · settledOf(engine items) → { ref: settled_minor }
// CARD      16-finance/receivables-and-payables
const Engines = require('./books-engines');
const num = (v) => (v == null ? 0 : Number(v));

/** every fiscal year from the oldest year holding rows to the newest, oldest first (a year with no entries included) */
function contiguousYears(packs, pack, years) {
  if (!years.length) return [];
  const out = [years[0]],
    last = years[years.length - 1];
  while (out[out.length - 1] < last && out.length < 200) out.push(packs.fiscalYearOf(Engines.addDays(packs.fyRange(out[out.length - 1], pack).end, 1), pack));
  return out;
}

/**
 * settledOf(items) → { ref: settled_minor } — the part of each bill that its ALLOCATIONS have already settled (the engine's allocation rows, net of their reversals; a receipt on account is not an allocation, so it is not counted).
 * Only bills with something settled appear. The opening replace asks this before it reverses a bill (FIN-64: a reversal releases the allocation).
 */
function settledOf(items) {
  const out = Object.create(null);
  (items || []).filter(Boolean).forEach((item) => {
    /* the bill's half of an allocation is negative against the bill; the reversal of an allocation puts it back (engine rows, receivables.js trackAllocation_) */
    if (item.ref_kind === 'allocation' || (item.ref_kind === 'reversal' && item.reverses_kind === 'allocation')) out[item.against_ref] = (out[item.against_ref] || 0) - num(item.amount_minor);
  });
  Object.keys(out).forEach((ref) => { if (!(out[ref] > 0)) delete out[ref]; });
  return out;
}

module.exports = { contiguousYears, settledOf };
