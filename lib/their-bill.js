// @stage tested
// @stage-note The ONE comparison of a supplier's bill total with what was counted (FX-F10W2): the counter's Receive form, its slip and the books' Waiting row.
/* their-bill.js — DOES THEIR BILL AGREE WITH WHAT WAS COUNTED? One rule, every host (FX-F10W2, QA-W1 F10).
 *
 * ⚠️⚠️ THERE WERE TWO. The counter compared their total with the goods BEFORE tax (till.html paintRcvSum) and the books compared it with
 * the goods PLUS tax (books-hooks receiptBill): on SG-201 the counter said "agrees" at ₹420 while Books said "₹21 apart", and ₹441 the
 * reverse. A supplier's bill total is what they CHARGE — taxable + tax (− discounts + charges on their bill, already in their lines) — so
 * that is the one figure it is compared with, here, and both hosts call this file:
 *   api   lib/books-hooks receiptBill  (require('./their-bill'))
 *   page  till.html paintRcvSum + the receipt slip (window.CBTheirBill — /app/their-bill.js, a byte copy written by scripts/vendor-till.cjs
 *         into web public/app/ and the kit; till.js serves the kit's at the same path)
 * ⭐ Its home is the tax engine (CBTax) — engines rounds are serial; until one lifts it there, this is the only copy, and the vendor check
 *   holds the copies byte-equal.
 *
 * check({ total, taxable, tax, currency, no, say }) → { code, theirs, ours, gap, sentence }
 *   total     their bill's total as typed at the door (major units); null/'' → code 'no_total'
 *   taxable   what was counted, before tax (the engine's splitLineTax per line, summed — the caller's own figure, never re-derived here)
 *   tax       the tax on it (every head, cess included)
 *   say(n)    the host's money words (the M36 unit) — the sentence is built HERE, so the slip and the Waiting row say the same words
 *   code      'agrees' (to the minor unit) · 'round_off' (within ONE unit of the currency — it posts as their round-off) · 'apart' (more:
 *             it waits; nothing silent posts either figure) · 'no_total' · 'no_engine' (the page has no money engine: no verdict). A host branches on the code, never on the sentence.
 *   gap       theirs − ours (positive: their bill says more than was counted)
 */
(function (root) {
  'use strict';
  var M = typeof module !== 'undefined' && module.exports ? require('./money') : root.CBMoney || null;

  /* the ONE money engine rounds (money.round / CBMoney.round) — without it there is no verdict ('no_engine'), never a hand-rounded one */
  function decimals(cur) {
    return M.decimals(cur);
  }
  function round(n, cur) {
    return M.round(n, cur);
  }
  /** a major amount → integer minor units (the money rule: compare integers, never floats) */
  function minor(n, cur) {
    return Math.round(round(Number(n) || 0, cur) * Math.pow(10, decimals(cur)));
  }

  function check(o) {
    var x = o || {},
      cur = x.currency;
    if (!M || !M.round || !M.decimals) return { code: 'no_engine', theirs: null, ours: null, gap: null, sentence: '' };
    var say =
      typeof x.say === 'function'
        ? x.say
        : function (n) {
            return String(n);
          };
    var no = String(x.no == null ? '' : x.no).trim();
    var bill = no ? 'Their bill ' + no : 'Their bill';
    var taxable = round(Number(x.taxable) || 0, cur),
      tax = round(Number(x.tax) || 0, cur);
    var ours = round(taxable + tax, cur);
    if (x.total == null || x.total === '' || !isFinite(Number(x.total))) return { code: 'no_total', theirs: null, ours: ours, gap: null, sentence: '' };
    var theirs = round(Number(x.total), cur);
    var gm = minor(theirs, cur) - minor(ours, cur),
      unit = Math.pow(10, decimals(cur));
    var gap = gm / unit;
    var what = tax ? 'goods ' + say(taxable) + ' + tax ' + say(tax) : 'the goods counted';
    if (gm === 0)
      return {
        code: 'agrees',
        theirs: theirs,
        ours: ours,
        gap: 0,
        sentence: tax ? bill + ' agrees: ' + say(theirs) + ' = ' + what + '.' : bill + ' agrees with the goods counted: ' + say(theirs) + '.'
      };
    var mid = bill + ' says ' + say(theirs) + ', ' + what + ' come to ' + say(ours);
    if (Math.abs(gm) <= unit)
      return { code: 'round_off', theirs: theirs, ours: ours, gap: gap, sentence: mid + ' — ' + say(Math.abs(gap)) + ' is their round-off.' };
    return { code: 'apart', theirs: theirs, ours: ours, gap: gap, sentence: mid + ' — ' + say(Math.abs(gap)) + ' apart.' };
  }

  var EXPORTS = { check: check };
  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
  else root.CBTheirBill = EXPORTS;
})(typeof window !== 'undefined' ? window : this);
