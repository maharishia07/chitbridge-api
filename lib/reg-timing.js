/* ADOPTED from chitbridge-engines v1.98.0-l16sit.1 · reg-timing · sha256 f28c641371f13ab4a7979d328a16c86b48ed1910fd2fe33f5a44766f63441d6e — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · reg-timing. Edited ONLY in chitbridge-engines/src/reg-timing.js; every platform adopts a released version of it. */
(function (root) {
  'use strict';
  /* ⭐ TIMING (l16-aupack, 16 Nov 2026): WHEN the tax on a sale or a purchase is reported, ONE table for every pack (kept out of reg-ae / reg-au / reg-in: filesize ratchet). The shop's own basis (`gst_basis`, one value per shop) decides what an open invoice or bill carried in at the start date does on payment; read by tax-packs.openingCarry. UNCONFIRMED: no primary page was read (ato.gov.au 403; see RULE-WATCH). A new country adds a row here with its own dated cite. */
  const EXPORTS = Object.freeze({
    AE: Object.freeze({
      bases: Object.freeze(['accrual']),
      opening: Object.freeze({ accrual: 'already_reported' }),
      cite: 'Federal Decree-Law 8 of 2017 Art. 25-26 (time of supply: earliest of supply, invoice or payment); no cash basis in the Decree-Law; FTA guidance not read',
      status: 'unconfirmed'
    }),
    AU: Object.freeze({
      bases: Object.freeze(['cash', 'accrual']),
      opening: Object.freeze({ accrual: 'already_reported', cash: 'on_payment' }),
      cite: 'GST Act 1999 s.29-5 (non-cash: attributable on the earlier of invoice or payment), s.29-40 (cash: attributable when paid); ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/accounting-for-gst-in-your-business/choosing-an-accounting-method',
      status: 'unconfirmed'
    }),
    IN: Object.freeze({
      bases: Object.freeze(['accrual']),
      opening: Object.freeze({ accrual: 'already_reported' }),
      cite: 'CGST Act 2017 s.12 (time of supply of goods) and s.13 (services): liability arises at invoice/payment/supply, never on later receipt of money; ITC under s.16(2) with Rule 37 (180 days unpaid reverses); no cash basis in the Act',
      status: 'unconfirmed'
    })
  });

  /* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page, the TV and the shop PC take window.CBRegTiming. */
  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
  if (root && typeof root.window !== 'undefined') root.window.CBRegTiming = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
