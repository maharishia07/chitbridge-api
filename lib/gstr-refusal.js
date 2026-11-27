/**
 * lib/gstr-refusal.js — the refusals a GSTR return builder gives for a shop that does not file that return at all.
 *
 * OWNS      composition(shopParty): CTRY-148, a composition dealer (CGST Act s.10) does not file GSTR-3B. It pays by FORM GST CMP-08 each quarter and files FORM GSTR-4
 *           once a year (CGST Rules 2017 r.62; Part B forms, cbic-gst.gov.in; GST portal CMP-08 FAQ 2 and 11, tutorial.gst.gov.in). Its bills of supply carry no tax and it
 *           takes no input credit, so a GSTR-3B built for it would be a file of zeros that looks real. Only composition is refused: the law source covers no other type.
 *           We do not build CMP-08 or GSTR-4 here (CTRY-149).
 * FLOW      gstr3b(ledger, me, period) ──▶ composition(me) ──▶ { ok: false, why } or null ──▶ the route answers 422 GSTR_REFUSED, or the builder goes on
 * INIT      none (pure; reads only the party it is given)
 * CARD      15-tax-and-country-packs/gst-returns-bas-vat
 * CALLED BY lib/tax-lines.js gstr3b (the answer is { ok: false, why }; GET /api/tax/gstr turns it into 422 GSTR_REFUSED).
 */
'use strict';
/** composition(shopParty) → { ok: false, why } for a composition shop (RegType, any case), else null: the return it files instead is named in the sentence */
function composition(shopParty) {
  if (String((shopParty && shopParty.RegType) || '').toLowerCase() !== 'composition') return null;
  return { ok: false, why: 'This shop is registered under the composition scheme, which does not file GSTR-3B. It pays tax with form CMP-08 each quarter and files GSTR-4 once a year.' };
}
module.exports = { composition };
