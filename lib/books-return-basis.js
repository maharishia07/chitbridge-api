/**
 * books-return-basis.js — which basis each amount box of a return is read on, and why it changed between periods (RW2-04, walk 25 Nov).
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      markBasis(pack, periodId, boxes) → { boxes, notes } — the sales-total box says its basis; one note says why the purchase boxes changed basis
 * CALLED BY lib/books-period.taxReturn (after the boxes are built; no figure is read or changed here)
 * FLOW      the pack's dated rows (pack.returns.g10_g11: from / to / basis / cite) ──▶ the pack's own basis words (pack.returns.bas) ──▶ a note per box + one line
 * CARD      14-accounting/README
 *
 * ⭐ WHY. The pack reads its purchase boxes on one basis before a dated change and on another after it (Athi's 22 Nov decision, DECISIONS.md AP-F-09: the dated
 *   rows are the pack's data). Each such box already carried its own basis words; the total-sales box did not say it is read tax-included, and nothing said WHY two
 *   quarters differ. The change itself is not touched here: unifying the basis is held for Athi. Words and dates come from the pack's rows; nothing country-named is typed.
 * ⭐ ONE DEFINITION. The words are asked of the pack's own bas() for a period inside each row, so the screen never holds a second copy of them.
 */
'use strict';
const { dateWords } = require('./books-payment-advice');

/** the basis words of one dated row, read from the pack (before any bracket: 'X-inclusive (ATO ...)' → 'X-inclusive'), or null */
function wordsOfRow(pack, row) {
  try {
    const answer = pack.returns.bas({ period: String(row.from).slice(0, 7) }, []);
    return answer.g10_g11_basis ? String(answer.g10_g11_basis).replace(/\s*\(.*$/, '') : null;
  } catch (refused) {
    return null;
  }
}
/** the basis words in force for a period (the pack answers by the period's first day) */
function wordsForPeriod(pack, periodId) {
  const answer = pack.returns.bas({ period: periodId }, []);
  const head = answer && answer.g10_g11_basis ? String(answer.g10_g11_basis).replace(/\s*\(.*$/, '') : null;
  return head;
}

function markBasis(pack, periodId, boxes) {
  const rows = (pack && pack.returns && pack.returns.g10_g11) || [];
  if (rows.length < 2 || typeof pack.returns.bas !== 'function') return { boxes, notes: [] };
  const noted = (boxes || []).filter((box) => box.note && /^\S+-(in|ex)clusive/.test(box.note));
  if (!noted.length) return { boxes, notes: [] };
  const words = rows.map((row) => wordsOfRow(pack, row));
  const now = wordsForPeriod(pack, periodId);
  const change = rows[rows.length - 1];
  const before = words[rows.length - 2],
    after = words[rows.length - 1];
  if (!now || !before || !after || before === after) return { boxes, notes: [] };
  const inclusive = rows.map((row, at) => (row.basis === 'inclusive' ? words[at] : null)).filter(Boolean)[0];
  const first = (boxes || [])[0];
  const marked = (boxes || []).map((box) => (inclusive && box === first && !box.note ? Object.assign({}, box, { note: inclusive + ' (this box includes the tax)' }) : box));
  const codes = noted.map((box) => box.code).join(' and ');
  const note =
    codes + ' are read ' + now + ' in this period. The basis changed on ' + dateWords(change.from) + ': periods before it read ' + before + ', periods from it read ' + after + '. Why: ' +
    String(change.cite || '').replace(/Athi [^:]*: /, '').replace(/\s*\(DECISIONS[^)]*\)/, '').replace(/\s*NOT re-fetched.*$/, '').replace(/\.$/, '') + '.';
  return { boxes: marked, notes: [note] };
}

module.exports = { markBasis };
