'use strict';
/**
 * lib/products-import-rows.js — THE IMPORT'S ANSWER AND ITS ROW FILTERS (S2-F-02 / S2-F-04, moved out of routes/products.js, read1129routes)
 * OWNER     cb-catalogue
 * RISK      plain
 * FLOW      the import's outcome rows -> importAnswer (the sentence and the counts) · the applied file -> dropRejected (the lines the person left out) · an item -> zeroWithoutReason
 * OWNS      importAnswer · zeroWithoutReason · dropRejected
 * CALLED BY routes/products.js (POST /import) · tests/route-modules-1129.test.cjs
 * CARD      06-catalogue-pim/catalogue-build
 */

/** the import's 200: what was added, updated and failed, in a sentence and in numbers, plus the columns it created */
function importAnswer(outcome, created, rejects) {
  const count = (action) => outcome.filter((item) => item.action === action).length;
  const failedCount = count('failed');
  const skipped = (rejects || []).length;
  return {
    message: `${count('created')} added, ${count('updated')} updated` + (failedCount ? `, ${failedCount} failed` : '') + (skipped ? `, ${skipped} row(s) not imported (listed below, with the file to fix them)` : '') + (created.length ? ` · added ${created.length} new column(s) to your catalogue` : ''),
    created_columns: created,
    outcome,
    summary: { created: count('created'), updated: count('updated'), failed: failedCount, rejected: skipped }
  };
}
/** S2-F-04: an item whose rate is stated as 0 with neither a slab nor a nil kind to say why (the till refuses such a line, tax-lines zero_reason_missing) */
const zeroWithoutReason = (item) => item.gst_rate != null && Number(item.gst_rate) === 0 && String(item.gst_rate).trim() !== '' && !item.tax_slab && !item.tax_slab_name && !item.nil_kind;
/** S2-F-02: the applied rows without the lines the person chose to leave out (items and lines stay in step) */
function dropRejected(applied, rejects) {
  if (!rejects.length) return applied;
  const bad = new Set(rejects.map((entry) => entry.line));
  const keep = applied.lines.map((line) => !bad.has(line));
  return Object.assign({}, applied, { items: applied.items.filter((_, at) => keep[at]), lines: applied.lines.filter((_, at) => keep[at]) });
}

module.exports = { importAnswer, zeroWithoutReason, dropRejected };
