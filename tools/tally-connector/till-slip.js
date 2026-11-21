/* app/till-slip.js — THE SLIP, a part of the till page (till.html) kept in its own file to hold the page's size row (2026-11-29; no behaviour changed).
 * Classic script, shared global scope with till.html: it reads the page's own S, esc(), money(), shopPack(), schemeWord(), invoiceRule(), counterName(), cartCount() and the other
 * page functions at call time, so it loads after the engines and before the page's main script and runs only when a slip is drawn.
 *
 * OWNER     cb-counter (the till)
 * RISK      money (the paper a customer takes home and a tax officer reads)
 * OWNS      slipRule46 · slipStampOf · slipHsnOf · slipSignatureHTML · slipBuyerAddressHTML · slipHeadHTML · slipBuyerHTML · slipBuyerKind · slipNoBuyerHTML · SLIP_TITLE_EN · slipTitleLines ·
 *           slipTitleKey · slipTitleHTML · slipTitleOf · slipTaxed · reducedMark · reducedNoteHTML · slipCashRoundHTML · slipRateOf · slipHTML (+ slipLinesHTML · slipCountRows) · slipFooterHTML
 * CALLED BY till.html (the bill's slip, the reprint, the day's replay, [TILL-B2] titles); loaded by <script src="/app/till-slip.js"> after the engines and before the page's main script
 * FLOW      a stored bill ──▶ slipHTML (title · rows · lines · tax summary · total · tenders · points · footer) ──▶ the slip box or the printer
 * CARD      09-counter/bill-slip
 *
 * ⚠️ MASTER: this file in the api kit (tools/tally-connector/till-slip.js); scripts/vendor-till.cjs copies it to web public/app/till-slip.js and the service worker shelves it.
 */
/**
 * ⭐ IN-F-07 (walk IN 21 Nov): CGST Rules 2017 r.46 — the particulars a tax invoice must carry: (c) the date of issue, (f) the HSN / SAC of each line, (d) the recipient's name, address and GSTIN
 * when registered, (o) whether the tax is payable on reverse charge, (p) the supplier's signature. It is asked only where THE PACK says its invoice carries an HSN (tax.hsn_digits: India),
 * so an Australian or Emirates slip prints what it did. The number, seller, rate, tax and place of supply were already on it.
 */
function slipRule46(bill){
  var pack = shopPack();
  return !!(bill && bill.kind === 'tax' && !bill.not_invoice && !unratedOnBill(bill).length && pack && pack.tax && pack.tax.hsn_digits);
}
/** the stamp of a slip: a tax invoice names its YEAR ("21 Nov 2026 11:47 am"), every other slip keeps "21 Nov 11:47 am" */
function slipStampOf(bill){ return slipRule46(bill) ? atShop(bill.at, 'date') + ' ' + atShop(bill.at, 'time') : atShop(bill.at); }
/** r.46(f): " HSN 7323" on a goods line, " SAC 9987" on a service (a code opening 99 is a service accounting code); nothing when the line carries none */
function slipHsnOf(bill, line){
  var code = String((line && line.hsn) || '').replace(/\s+/g, '');
  return slipRule46(bill) && code ? '  ' + (/^99/.test(code) ? 'SAC ' : 'HSN ') + esc(code) : '';
}
/** r.46(o) and (p): the reverse-charge answer (a till sale is never one) and the supplier's signature space, under the total */
function slipSignatureHTML(bill, shop){
  if (!slipRule46(bill)) return '';
  return '<div data-testid="till-slip-rcm" style="font-size:.9em">Tax payable on reverse charge: No</div>'
    + '<div data-testid="till-slip-sign" style="margin-top:14px;text-align:end;font-size:.9em"><div style="border-top:1px solid currentColor;display:inline-block;min-width:34mm;padding-top:2px">For ' + esc((shop && shop.name) || counterName()) + '<br>Authorised signatory</div></div>';
}
/** IN-F-07, r.46(d)/(e): the recipient's ADDRESS under the buyer row, when the party holds one (a separate row so slipBuyerHTML is unchanged) */
function slipBuyerAddressHTML(bill){
  return slipRule46(bill) && bill.customer && bill.customer.address ? '<div data-testid="till-slip-buyer-address" style="font-size:.9em">' + esc(bill.customer.address) + '</div>' : '';
}
function slipHeadHTML(kind){
  var shop = (S && S.shop) || {};
  return '<div data-testid="till-slip-head" style="text-align:center;font-weight:700;font-size:1.3em">' + esc(shop.name || counterName()) + '</div>'
    + (shop.address ? '<div style="text-align:center">' + esc(shop.address) + '</div>' : '')
    + (shop.phone ? '<div style="text-align:center">Ph ' + esc(shop.phone) + '</div>' : '')
    + (kind !== 'cash' && shop.gstin ? '<div style="text-align:center">' + taxIdLabel() + ' ' + esc(shop.gstin) + '</div>' : '');
}
/**
 * ⭐ CX1 (T1): THE BUYER ON THE PAPER, where the shop's law asks for it — the buyer's ABN / TRN on a tax invoice (reg-au s.29-70(1)(c)(ii); reg-ae
 * ER Art. 59(1)(c)), and, on a bill saved without a named buyer above the pack's line, why it is not a tax invoice. Only under a pack with a
 * taxInvoice member, so an Indian slip prints exactly what it did.
 */
function slipBuyerHTML(bill, t){
  if (!bill || !slipBuyerKind(bill.kind) || !invoiceRule(bill.total, bill.customer && bill.customer.gstin)) return '';
  var g = bill.customer && bill.customer.gstin, row = g ? t('Buyer ' + taxIdLabel(), esc(g)) : '';
  return bill.kind === 'supply' ? row : row + slipNoBuyerHTML(bill);
}
/** ⭐ CTR-166: the bills that name their buyer: a tax invoice, and a BILL OF SUPPLY when the buyer is registered (CGST Rules r.49(d): name, address and GSTIN or UIN, if registered, of the recipient); the no-buyer sentence below is a tax invoice's alone */
function slipBuyerKind(kind){ return kind === 'tax' || kind === 'supply'; }
/** why a bill saved without a named buyer above the pack's line is not a tax invoice */
function slipNoBuyerHTML(bill){
  return bill.not_invoice === 'buyer_identity' ? '<div data-testid="till-slip-nobuyer" style="font-size:.9em">Over ' + money(buyerFromMajor())
    + ' a tax invoice names the buyer or their ' + taxIdLabel() + ' — none was given.</div>' : '';
}
/* the English titles a slip printed before the packs carried their own (pack.slip) — the fallback, so a shop with no pack prints what it always did */
var SLIP_TITLE_EN = { tax: 'TAX INVOICE', supply: 'BILL OF SUPPLY', plain: 'CASH MEMO' };
/**
 * ⭐ TILL-B2 (2026-10-17): THE SLIP'S TITLE IN THE SHOP'S LANGUAGES — pack.slip (engines v1.65.0) → [{ lang, text }], one per language in
 * slip.langs order, the first the main line. kind 'tax' → titles.tax (titles.simplified when the pack's taxInvoice rule says 'simplified'),
 * 'supply' → titles.supply, anything else → titles.plain. Uppercased — Arabic and Japanese have no case and print as written; India stays
 * TAX INVOICE · BILL OF SUPPLY · CASH MEMO. No pack.slip, or no title for the kind → today's English words.
 */
function slipTitleLines(kind, rule){
  var pack = shopPack(), slip = pack && pack.slip, key = slipTitleKey(kind, rule, slip);
  var words = slip && slip.titles && slip.titles[key];
  var lines = words ? (slip.langs || []).filter(function(lang){ return words[lang]; })
    .map(function(lang){ return { lang: lang, text: String(words[lang]).toUpperCase() }; }) : [];
  return lines.length ? lines : [{ lang: 'en', text: SLIP_TITLE_EN[key === 'simplified' ? 'tax' : key] }];
}
/** which of pack.slip.titles a bill of this kind prints: tax (or simplified, when the rule says so and the pack has the words) · supply · plain */
function slipTitleKey(kind, rule, slip){
  if (kind === 'supply') return 'supply';
  if (kind !== 'tax') return 'plain';
  var simplified = rule && rule.kind === 'simplified' && slip && slip.titles && slip.titles.simplified;
  return simplified ? 'simplified' : 'tax';
}
/** the title as the slip prints it: one centred bold line per language; with two or more each names its language (Arabic right to left) */
function slipTitleHTML(lines){
  var many = lines.length > 1;
  return lines.map(function(line){
    var attrs = !many ? '' : line.lang === 'ar' ? ' dir="rtl" lang="ar"' : ' lang="' + esc(line.lang) + '"';
    return '<div' + attrs + ' style="text-align:center;font-weight:700">' + esc(line.text) + '</div>';
  }).join('');
}
/* ⚠️ NEVER "TAX INVOICE" OVER A LINE THAT CHARGED NO TAX BECAUSE IT HAD NO RATE (BF1) — the paper says what it is */
/* ⚠️ …nor over a bill saved while the shop's own details disagreed (M41, bill.not_invoice) — the same title, no second path */
function slipTitleOf(bill, unrated){
  if (unrated.length || bill.not_invoice) return slipTitleHTML([{ lang: 'en', text: 'BILL — NOT A TAX INVOICE' }]);
  var rule = bill.kind === 'tax' ? invoiceRule(bill.total, bill.customer && bill.customer.gstin) : null;
  return slipTitleHTML(slipTitleLines(bill.kind, rule));
}
/** ⭐ TILL-B2: does this slip carry a tax foot? A tax invoice — and a RECEIPT that still charged tax (US sales tax with no EIN, shopTax) */
function slipTaxed(bill){ return bill.kind === 'tax' || (bill.kind === 'cash' && Number(bill.tax) !== 0); }
/** ⭐ TILL-B2: Japan's reduced-rate mark — ' ※' after a line taxed below the pack's standard rate (and above 0), when the invoice rule asks for it */
function reducedMark(bill, line){
  var rule = slipTaxed(bill) ? invoiceRule(bill.total, bill.customer && bill.customer.gstin) : null, pack = shopPack();
  var rate = Number(line && line.gst_rate) || 0, standard = Number(pack && pack.tax && pack.tax.standard_rate) || 0;
  return rule && rule.reduced_mark && rate > 0 && rate < standard ? ' ※' : '';
}
/** the line that says what ※ means, when any line carries it */
function reducedNoteHTML(bill){
  var marked = (bill.lines || []).some(function(line){ return reducedMark(bill, line); });
  return marked ? '<div data-testid="till-slip-reduced" style="font-size:.9em">※ reduced rate (軽減税率対象)</div>' : '';
}
/** ⭐ TILL-B2: the cash rounding this bill took (bill.cash_round, AU · MY), between the total and the cash that paid it */
function slipCashRoundHTML(bill, row){
  var rounded = Number(bill.cash_round) || 0;
  return rounded ? '<div data-testid="till-slip-cashround">' + row('Cash rounding', (rounded > 0 ? '+' : '') + money(rounded)) + '</div>' : '';
}
/** the rate printed on a tax-invoice line: the engine's band words when the law set it (from the bill's own invoice, so a duplicate says the same), else the line's rate */
function slipRateOf(bill, line, index){
  if (bill.kind !== 'tax') return '';
  var band = bandWordsOf(bill.invoice, index);
  var zero = (band || line.gst_rate || typeof lineZeroWordOf !== 'function') ? '' : lineZeroWordOf(bill.invoice, index);   /* R-F-02: a 0% line says its reason (Zero-rated · Exempt · GST-free) or "VAT 0%", never nothing */
  return band ? '  ' + schemeWord() + ' ' + esc(band) : (line.gst_rate ? '  ' + schemeWord() + ' ' + line.gst_rate + '%' : (zero ? '  ' + esc(zero) : ''));
}
function slipHTML(bill, totals){
  var shop = (S && S.shop) || {};
  var unrated = unratedOnBill(bill);
  var title = slipTitleOf(bill, unrated);
  var t = function(a,b,big){ return '<div style="display:flex;justify-content:space-between' + (big?';font-weight:700;font-size:1.15em':'') + '"><span>' + a + '</span><span>' + b + '</span></div>'; };
  var dash = '<div style="border-top:1px dashed #000;margin:4px 0"></div>', solid = '<div style="border-top:1px solid currentColor;margin:4px 0"></div>';
  return '<div id="slip" style="font-family:Consolas,\'Courier New\',monospace;font-size:12px;width:72mm;margin:0 auto;color:#000;background:#fff">'
    + slipHeadHTML(bill.kind)
    + solid + title + dash
    + t('No ' + esc(bill.no), esc(slipStampOf(bill)))
    /* ⚠️ a REPRINT of a renumbered sale must carry both numbers — the customer's paper says the first one */
    + (bill.printed_as ? t('Printed as ' + esc(bill.printed_as), 'recorded as ' + esc(bill.no)) : '')
    + t(esc(counterName()) + (bill.by && bill.by.name ? ' · ' + esc(bill.by.name) : ''), esc((bill.customer && bill.customer.name) || 'Walk-in'))
    /* ⭐ DINE-IN (table 4) / TAKEAWAY / DELIVERY — the bill already carries it (BF8) */
    + billOrderRow(bill, t)
    + slipBuyerHTML(bill, t) + slipBuyerAddressHTML(bill) + slipCheckedHTML(bill)
    /* ⭐ BOOKS v2 — a credit bill says so on the paper, and when it is due */
    + (bill.terms ? t('<b>ON CREDIT</b>', bill.terms.due_date ? '<b>Due by ' + esc(bill.terms.due_date) + '</b>' : 'shop’s terms') : '')
    /* ⭐ the two-sided bill says so, in one line: the customer has their own copy on ChitBridge */
    + (billSendTo(bill) ? '<div data-testid="till-slip-sent-to" style="text-align:center">Sent to ' + esc(billSendTo(bill).name || 'customer') + '</div>' : '') + dash
    /**
     * ── ⭐⭐⭐ EVERY ITEM ACCOUNTS FOR ITSELF ON THE PAPER ──────────────────────────────────────────────────────
     *
     * Athi, 2026-09-10: *"check how Pantaloons invoice is and then do it accordingly — there, every item below
     * they showcase, it is no ambiguity."*
     *
     * ⭐⭐ AND THAT IS THE INDIAN RETAIL BILL, which solved this long ago: each line states its MRP, its rate,
     * the discount BY THE NAME OF THE SCHEME, and what is left. Nothing is deferred to a summary, so a customer
     * checking one item never has to reconcile it against a total covering nine others.
     *
     * ⚠️⚠️ WHAT WAS HERE PRINTED "(−₹9.00)" — a bare parenthesis, no scheme name, no MRP. That is precisely the
     * ambiguity: on the paper the customer takes home, a discount nobody can name is a discount nobody can
     * question, and the shopkeeper standing behind it has nothing to point at.
     *
     * ⚠️ The offer rows come from what was STORED on the bill, not from a re-evaluation. A reprint next year must
     * show what was charged then — offers change, and a slip that re-derived them would quietly rewrite history.
     */
    + slipLinesHTML(bill) + dash
    /* ⭐ ON THE PAPER TOO. This is the line a customer runs their finger down when the bag does not look right, and the
       one a shopkeeper reads back at the door. It is printed for every bill, offer or no offer. */
    /**
     * ⚠️⚠️ THE COUNT A CUSTOMER CHECKS AGAINST THE BAG ([TILL-104]). This summed every quantity and called
     * it "Items", so a bill for a quarter kilo of tomato, two kilos of onion and three coconuts printed
     * "Items 5.25". One count for the whole counter — cartCount() — rendered here as rows.
     */
    + t('Products', String((bill.lines||[]).length))
    + slipCountRows(bill, t)
    + slipTaxBlockHTML(bill, totals, t, dash, unrated)
    + solid + t('TOTAL', money(bill.total), true) + solid + slipCashRoundHTML(bill, t)
    + (bill.payments||[]).map(function(p){ return t(esc(p.how), money(p.amount)); }).join('')
    + (bill.change > 0 ? t('Change', money(bill.change)) : '') + dash
    /**
     * ⭐⭐ POINTS ON THE PAPER. Athi, 2026-09-10: *"reward point can be showcased in the bill — reward points added,
     * and reward point encashed."* It is printed BELOW the total and below the tender, because that is what it is:
     * something that happened alongside the money, not part of it.
     * ⚠️ IT PRINTS WHAT IS TRUE, INCLUDING WHEN NOTHING WAS RECORDED. A slip that showed points the shop never
     * wrote would be a promise the shop cannot honour on the next visit — so an unqueued failure says so on the
     * paper, in the customer's hands, where somebody can still do something about it.
     */
    + rewardOnSlip(bill, t, dash)
    + slipSignatureHTML(bill, shop)
    + (bill.kind === 'supply' ? '<div style="text-align:center">Composition taxable person.<br>Not eligible to collect tax on supplies.</div>' : '')
    + slipFooterHTML(shop)
    + '<div style="height:10mm"></div></div>';
}
/** the saving, the tax summary rate by rate, the unrated note and the place of supply: the slip between the count and the total (split out of slipHTML; behaviour unchanged) */
function slipTaxBlockHTML(bill, totals, t, dash, unrated){
  return ''
    + (bill.saved > 0 ? t('Before offers', money((totals&&totals.gross)||bill.total)) + t('You saved', '−' + money(bill.saved)) : '')
    /**
     * ── ⭐⭐ THE TAX SUMMARY, RATE BY RATE — THE STANDARD LAYOUT, NOT ONE OF OURS ─────────────────────────────
     *
     * Athi, 2026-09-10: *"Tesco bill, or any other standard way of invoicing can be used as an example. Nothing
     * to reinvent."* Right, and it is the same instinct as the rest of this platform — adopt the convention, do
     * not author one. Every retail receipt in the world ends the same way: a small table of rate · taxable · tax,
     * one row per rate, summing to the tax already shown in the total.
     *
     * ⭐ AND IT IS ALSO WHAT THE LAW WANTS. A GST bill has to let a buyer see the taxable value and the tax at
     * each rate; a flat "GST ₹48.66" makes a bill that cannot be used to claim credit. So the format a customer
     * recognises and the format a tax officer requires are the same format — which is usually the sign that a
     * convention is worth adopting rather than improving.
     *
     * ⚠️ IT FALLS BACK, because bills saved before by_rate existed still get reprinted, and a reprint that
     * dropped the tax block would be worse than one that shows it the old way.
     */
    /* ⚠️ a reprint of a bill whose tax was never kept says so — never "GST 0.00" on a TAX INVOICE (slipOfRow) */
    + (slipTaxed(bill) ? (bill.tax_lost ? t('Tax detail not kept for this bill', '') : taxSummaryHTML(bill, t, dash)) : '')
    /* ⭐ Rule 46(n): a tax invoice names its place of supply */
    + (unrated.length ? '<div data-testid="till-slip-norate" style="font-size:.9em">No tax rate set, so no ' + schemeWord() + ' charged on: ' + esc(unrated.join(', ')) + '</div>' : '')
    /* ⚠️ M66 (walk 2026-10-10): ONLY ON A REAL TAX INVOICE. A bill saved as NOT a tax invoice (no rate, or the shop's GSTIN and
       address in two states) printed "Place of supply 29 Karnataka" on a Chennai takeaway — the GSTIN's state, under a title that
       says it is not an invoice. The place itself is still CBTax.placeOfSupply's (the shop's state; a delivery moves it). */
    + (bill.kind === 'tax' && bill.pos_state && !(unrated.length || bill.not_invoice) ? t('Place of supply', esc(posWords(bill.pos_state))) : '')
  ;
}
/** every item accounts for itself on the paper: the slip's item lines, each with its offers, rate and HSN (split out of slipHTML; behaviour unchanged) */
function slipLinesHTML(bill){
  return (bill.lines||[]).map(function slipLineHTML(line, index){
        var offs = (line.offers && line.offers.length)
          ? line.offers
          : (line.off ? [{ label: line.off_label || 'Offer', off: line.save }] : []);   /* bills saved before offers[] existed */
        var sub = function(a, b){ return '<div style="display:flex;justify-content:space-between;font-size:.9em;'
               + 'padding-inline-start:8px"><span>' + a + '</span><span>' + b + '</span></div>'; };
        /**
         * ⭐ ORIGINAL COST AND DISCOUNT AT THE LINE; TAX LAST. Athi, 2026-09-10: *"original cost and discount will
         * be shown there itself and the tax shown last."* So the line carries what a customer checks item by item
         * — what it cost, what came off, what is left — and the tax is summarised once, below the total.
         *
         * ⚠️ THE RATE STAYS ON THE LINE OF A TAX INVOICE, and only there. A rate-wise summary at the foot is what
         * a B2C bill needs, but a registered buyer claims input credit off the LINE — so on a TAX INVOICE the per
         * line rate is not clutter, it is the thing that makes the document usable. On a cash memo it is absent,
         * because there is no tax to name.
         */
        return '<div style="display:flex;justify-content:space-between"><span>' + esc(line.name) + reducedMark(bill, line) + '</span><span>' + money(line.net) + '</span></div>'
             /* ⭐ THE CHOSEN MODIFIERS, under the item they belong to (BF3) */
             + (line.mods && line.mods.length ? '<div data-testid="till-slip-mods" style="font-size:.9em;padding-inline-start:8px">' + esc(modWordsPlain(line.mods)) + '</div>' : '')
             + '<div style="font-size:.9em">' + line.qty + ' ' + esc(line.unit) + ' × ' + money(line.price)
             + (Number(line.mrp) > 0 ? '  MRP ' + money(line.mrp) : '')
             + slipHsnOf(bill, line)
             + slipRateOf(bill, line, index) + '</div>'
             /* ⚠️ only when something came off — on a line with no offer, "Gross ₹9.00" over "₹9.00" is a row
                that says nothing twice, and rows that say nothing are how a bill becomes unreadable. */
             + (offs.length || Number(line.save_unnamed) > 0.004 ? sub('Gross', money(line.gross)) : '')
             /* one row per scheme, indented under the item it came off — named, and with its own amount */
             + offs.map(function(o){ return sub(esc(o.label || 'Offer'), '−' + money(o.off)); }).join('')
             /* ⚠️ a bill-wide offer's share, said plainly — otherwise this line's total is short by an amount
                that appears nowhere on the line, which is the thing being fixed */
             + (Number(line.save_unnamed) > 0.004
                 ? '<div style="display:flex;justify-content:space-between;font-size:.9em;padding-inline-start:8px">'
                   + '<span>share of bill offer</span><span>−' + money(line.save_unnamed) + '</span></div>' : '');
  }).join('');
}
/** the count a customer checks against the bag: Items, then each measured unit, as slip rows (split out of slipHTML; behaviour unchanged) */
function slipCountRows(bill, t){
        var n = cartCount(bill.lines || []);
        var rows = n.items ? t('Items', String(Math.round(n.items * 100) / 100)) : '';
        Object.keys(n.measured).forEach(function(u){
          rows += t(u, String(Math.round(n.measured[u] * 1000) / 1000));
        });
        return rows;
}
/**
 * ⭐ CTR-158: THE SLIP'S CLOSING LINE is the footer the shop saved in Print setup (shop.slip_footer, the one bill-print.html prints on the preview): the words,
 * nothing at all when the shop saved one and unticked it, and today's two lines only when none is saved (an older snapshot, a shop that never set one).
 */
function slipFooterHTML(shop){
  var saved = shop && shop.slip_footer;
  if (typeof saved === 'string') return saved ? '<div data-testid="till-slip-footer" style="text-align:center">' + esc(saved) + '</div>' : '';
  return '<div style="text-align:center">Thank you · visit again</div><div style="text-align:center">Billed on ChitBridge</div>';
}
