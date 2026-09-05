/**
 * ADAPTER: Tally Prime / Tally.ERP 9 — over its own XML port (Gateway of Tally › F1 Help › Settings › Connectivity:
 * "Enable ODBC/XML" on port 9000). Two functions, as every adapter: readProducts() and pushOrder(order) — plus the optional
 * readStock() · readProfile() · pushReceipt(p) (a Receipt voucher when the seller marks the chit paid, 2026-09-05).
 *
 * ✅ FIRST LIVE READ 2026-09-05 (TallyPrime EDU 7.x, Athi's laptop): the company master, the stock items, the closing stock
 * and the GST/HSN details read correctly after three corrections found live — parse only the <DATA> part (the CMPINFO
 * counts collide with object names), the alias is the second NAME in NAME.LIST, "Primary" is no category.
 * ⚠️ THE VOUCHER IMPORT (pushOrder) IS STILL PROVEN AGAINST fake-tally.js ONLY. Run with --dry first: it prints the
 * voucher XML instead of posting it; the first live voucher may need a ledger name or a sign convention corrected here.
 */
'use strict';
const XML_HEADERS = { 'Content-Type': 'text/xml' };

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function tag(name, xml) { const re = new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i'); const m = re.exec(xml); return m ? m[1].trim() : ''; }
function tags(name, xml) { const re = new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'gi'); const out = []; let m; while ((m = re.exec(xml))) out.push(m[1]); return out; }
/** ⚠️ FIRST LIVE TALLY (2026-09-05): every reply opens with a CMPINFO block whose element names COLLIDE with the object
 *  names (<COMPANY>1</COMPANY>, <STOCKITEM>0</STOCKITEM> are COUNTS) — parse only the <DATA> part */
function dataOf(xml) { const m = /<DATA>([\s\S]*?)<\/DATA>/i.exec(String(xml || '')); return m ? m[1] : String(xml || ''); }
function aliasOf(it) { const list = tags('NAME.LIST', it)[0] || ''; const names = tags('NAME', list).map(unesc).map((x) => x.trim()).filter(Boolean); return names.length > 1 ? names[1] : ''; }
/** LIVE TALLY (2026-09-05): the item's GST rate sits in GSTDETAILS.LIST › STATEWISEDETAILS.LIST › RATEDETAILS.LIST as
 *  { GSTRATEDUTYHEAD: IGST, GSTRATE: 5 } — absent when "As per Company/Stock Group"; the HSN in HSNDETAILS.LIST › HSNCODE */
function gstRateOf(it) { const heads = tags('RATEDETAILS.LIST', it); for (const h of heads) { if (/IGST/i.test(tag('GSTRATEDUTYHEAD', h))) { const r = num(tag('GSTRATE', h)); if (r != null) return r; } } return null; }
function hsnOf(it) { const d = tags('HSNDETAILS.LIST', it)[0] || ''; return unesc(tag('HSNCODE', d)) || unesc(tag('HSN', d)) || unesc(tag('HSNCODE', it)) || null; }
function unesc(s) { return String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#4;/g, ''); }
function num(s) { const m = /-?[\d,]*\.?\d+/.exec(String(s || '').replace(/,/g, '')); return m ? Number(m[0]) : null; }
/**
 * ⚠️ TALLYPRIME EDUCATIONAL MODE accepts vouchers dated the 1st, 2nd or 31st of a month only (its "Voucher date is missing"
 * refusal on 2026-09-05, Athi's laptop, said nothing of the kind). With tally.eduDates:true the voucher date snaps to the
 * 2nd of its month (or stays on the 1st/2nd/31st) and the narration keeps the real date. Off for a licensed Tally.
 */
function eduDate(d, on) { const x = d ? new Date(d) : new Date(); if (!on) return x; const day = x.getDate(); if (day === 1 || day === 2 || day === 31) return x; return new Date(x.getFullYear(), x.getMonth(), 2, 12); }
function ymd(d) { const x = d ? new Date(d) : new Date(); return x.getFullYear() + String(x.getMonth() + 1).padStart(2, '0') + String(x.getDate()).padStart(2, '0'); }

/** the Export Data request: a TDL collection of stock items with the fields we need */
function exportRequest(company) {
  return `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>CBStockItems</ID></HEADER>
<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>${company ? '<SVCURRENTCOMPANY>' + esc(company) + '</SVCURRENTCOMPANY>' : ''}</STATICVARIABLES>
<TDL><TDLMESSAGE><COLLECTION NAME="CBStockItems" ISMODIFY="No"><TYPE>StockItem</TYPE>
<FETCH>NAME, PARENT, BASEUNITS, PARTNO, GSTAPPLICABLE, STANDARDPRICE, CLOSINGRATE, HSNCODE, CLOSINGBALANCE, GSTDETAILS.LIST, HSNDETAILS.LIST</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;
}
/** the company master: name · formal name · address lines · state · PIN · country · phone · email · GSTIN · PAN */
function companyRequest(company) {
  return `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>CBCompany</ID></HEADER>
<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>${company ? '<SVCURRENTCOMPANY>' + esc(company) + '</SVCURRENTCOMPANY>' : ''}</STATICVARIABLES>
<TDL><TDLMESSAGE><COLLECTION NAME="CBCompany" ISMODIFY="No"><TYPE>Company</TYPE>
<FETCH>NAME, BASICCOMPANYFORMALNAME, ADDRESS, STATENAME, PINCODE, COUNTRYNAME, PHONENUMBER, MOBILENUMBERS, EMAIL, GSTREGISTRATIONNUMBER, GSTREGISTRATIONTYPE, INCOMETAXNUMBER, BASECURRENCYSYMBOL</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;
}
/** the Import Data request: one Sales voucher for the order (invoice view, inventory entries, party + sales ledger) */
/** GST state codes → the names Tally uses (Place of Supply, LEDSTATENAME). The first two digits of a GSTIN. */
const STATES = { '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman & Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory' };
function stateName(code) { const c = String(code || '').padStart(2, '0'); return STATES[c] || String(code || ''); }
/** the party ledger a registered buyer books under — their legal name, so the ledger reads as the ledger they would keep for us */
function partyLedgerName(buyer) { return String(buyer.name || buyer.gstin || 'Customer').trim().slice(0, 60); }

/** the offers that shaped the lines, for the accountant's eye — Tally has no field for them, the narration carries the names */
function offerNote(order) {
  const seen = new Map();
  for (const l of order.lines || []) if (l.offer && l.offer.label) seen.set(l.offer.label, (seen.get(l.offer.label) || 0) + (Number(l.offer.off) || 0));
  if (!seen.size) return '';
  return ' · offers: ' + [...seen.entries()].map(([k, v]) => k + (v ? ' −' + Math.round(v * 100) / 100 : '')).join(', ');
}
function voucherXML(order, opt) {
  const b2b = order.b2b || null;
  const party = b2b ? partyLedgerName(b2b.buyer) : (opt.partyLedger || 'Cash'), sales = opt.salesLedger || 'Sales', vtype = opt.voucherType || 'Sales';
  const taxes = b2b ? b2b.taxes : { cgst: 0, sgst: 0, igst: 0, cess: 0 };
  const taxTotal = Math.round(((taxes.cgst || 0) + (taxes.sgst || 0) + (taxes.igst || 0) + (taxes.cess || 0)) * 100) / 100;
  const goods = Math.round((order.total || order.lines.reduce((t, l) => t + l.total, 0)) * 100) / 100;
  /* the party owes goods + tax; a walk-in order has no tax lines and the two figures coincide */
  const total = b2b && b2b.total ? Math.round(b2b.total * 100) / 100 : Math.round((goods + taxTotal) * 100) / 100;
  const inv = order.lines.map((l) => {
    /* ⚠️ THE AMOUNT IS THE CHIT'S LINE TOTAL, NEVER RATE × QTY (Athi, 2026-09-05: "how will our offer module behave to
       Tally?"). Tally has no offers; it has a listed RATE, a DISCOUNT %, and the AMOUNT. An offer (percent off, a bundle, a
       threshold) lowered l.total and left l.price listed — sending rate × qty booked MORE than the chit says. Now: rate =
       the listed price, amount = the chit's total, discount = the difference as a percentage; a free item (buy 1 get 1,
       a reward) is a zero-rate line that still leaves stock. */
    const listed = l.list_price != null ? l.list_price : l.price, qty = l.qty, unit = l.unit || 'nos';
    const gross = Math.round(listed * qty * 100) / 100;
    const amount = l.total != null && Number.isFinite(Number(l.total)) ? Math.round(Number(l.total) * 100) / 100 : gross;
    const rate = listed;
    const disc = gross > 0 && amount < gross ? Math.round((1 - amount / gross) * 10000) / 100 : 0;
    const gstRate = l.gst_rate != null ? l.gst_rate : (b2b && (b2b.items.find((x) => x.name === l.name) || {}).rate);
    return `<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>${esc(l.name)}</STOCKITEMNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
<RATE>${rate}/${esc(unit)}</RATE>${disc ? '<DISCOUNT>' + disc + '</DISCOUNT>' : ''}<AMOUNT>${amount}</AMOUNT><ACTUALQTY>${qty} ${esc(unit)}</ACTUALQTY><BILLEDQTY>${qty} ${esc(unit)}</BILLEDQTY>${b2b && gstRate != null ? '<GSTOVRDNTAXABILITY>Taxable</GSTOVRDNTAXABILITY><GSTOVRDNIGSTRATE>' + gstRate + '</GSTOVRDNIGSTRATE>' : ''}
<ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>${esc(sales)}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${amount}</AMOUNT></ACCOUNTINGALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST>`;
  }).join('\n');
  /* the tax heads as ledger lines — CGST+SGST within the state, IGST across; the frozen invoice decided which */
  const taxLines = !b2b ? '' : [['CGST', taxes.cgst], ['SGST', taxes.sgst], ['IGST', taxes.igst], ['Cess', taxes.cess]].filter(([, v]) => v > 0)
    .map(([n, v]) => `<LEDGERENTRIES.LIST><LEDGERNAME>${esc((opt.taxLedgers || {})[n.toLowerCase()] || n)}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${Math.round(v * 100) / 100}</AMOUNT></LEDGERENTRIES.LIST>`).join('\n');
  const b2bHead = !b2b ? '' : `<PARTYGSTIN>${esc(b2b.buyer.gstin)}</PARTYGSTIN><PLACEOFSUPPLY>${esc(stateName(b2b.place_of_supply))}</PLACEOFSUPPLY><STATENAME>${esc(stateName(b2b.buyer.state_code))}</STATENAME><GSTREGISTRATIONTYPE>${esc(b2b.buyer.reg_type || 'Regular')}</GSTREGISTRATIONTYPE>`;
  return `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>
<STATICVARIABLES>${opt.company ? '<SVCURRENTCOMPANY>' + esc(opt.company) + '</SVCURRENTCOMPANY>' : ''}</STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="${esc(vtype)}" ACTION="Create" OBJVIEW="Invoice Voucher View"><DATE>${ymd(eduDate(order.at, opt.eduDates))}</DATE><VOUCHERTYPENAME>${esc(vtype)}</VOUCHERTYPENAME>
<REFERENCE>CB-${esc(String(order.chit_id).slice(0, 8))}</REFERENCE><NARRATION>${esc('ChitBridge order ' + order.chit_id + ' from ' + order.buyer + offerNote(order) + (opt.eduDates ? ' (ordered ' + String(order.at || '').slice(0, 10) + '; EDU date)' : ''))}</NARRATION>
<PARTYLEDGERNAME>${esc(party)}</PARTYLEDGERNAME><PARTYNAME>${esc(b2b ? b2b.buyer.name : order.buyer)}</PARTYNAME><ISINVOICE>Yes</ISINVOICE>${b2bHead}
${inv}
<LEDGERENTRIES.LIST><LEDGERNAME>${esc(party)}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>-${total}</AMOUNT>${b2b ? '<BILLALLOCATIONS.LIST><NAME>CB-' + esc(String(order.chit_id).slice(0, 8)) + '</NAME><BILLTYPE>New Ref</BILLTYPE><AMOUNT>-' + total + '</AMOUNT></BILLALLOCATIONS.LIST>' : ''}</LEDGERENTRIES.LIST>
${taxLines}
</VOUCHER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
}

/**
 * RECEIPT (payment loop, level 1 → Tally, 2026-09-05): the seller marked the chit paid in ChitBridge; Tally gets a Receipt
 * voucher — Dr the cash/bank ledger, Cr the party ledger, against the sale's reference CB-<ref> (Agst Ref) so the bill
 * closes. A CASH SALE (partyLedger is the cash ledger) is already settled by the Sales voucher: no receipt is booked.
 *   opt.cashLedger (default 'Cash') for method cash · opt.bankLedger (default 'Bank') for upi/card/bank/other
 */
function receiptXML(p, opt) {
  const party = opt.partyLedger || 'Cash';
  const into = p.method === 'cash' ? (opt.cashLedger || 'Cash') : (opt.bankLedger || 'Bank');
  const amount = Math.round(Number(p.amount) * 100) / 100, ref = 'CB-' + String(p.chit_id).slice(0, 8);
  return `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>
<STATICVARIABLES>${opt.company ? '<SVCURRENTCOMPANY>' + esc(opt.company) + '</SVCURRENTCOMPANY>' : ''}</STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="Receipt" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>${ymd(eduDate(p.at, opt.eduDates))}</DATE><VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>
<REFERENCE>${esc(ref)}</REFERENCE><NARRATION>${esc('ChitBridge payment ' + (p.method || '').toUpperCase() + (p.ref ? ' ' + p.ref : '') + ' for order ' + p.chit_id + ' from ' + (p.buyer || 'customer'))}</NARRATION>
<PARTYLEDGERNAME>${esc(party)}</PARTYLEDGERNAME>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>${esc(party)}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>${amount}</AMOUNT>
<BILLALLOCATIONS.LIST><NAME>${esc(ref)}</NAME><BILLTYPE>Agst Ref</BILLTYPE><AMOUNT>${amount}</AMOUNT></BILLALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>${esc(into)}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-${amount}</AMOUNT></ALLLEDGERENTRIES.LIST>
</VOUCHER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
}

module.exports = function tallyAdapter(cfg) {
  const url = (cfg.tally && cfg.tally.url) || 'http://localhost:9000';
  const opt = Object.assign({ company: null, partyLedger: 'Cash', salesLedger: 'Sales', voucherType: 'Sales' }, cfg.tally || {});
  const dry = !!cfg.dry, log = cfg.log || (() => {});
  async function post(xml) {
    const r = await fetch(url, { method: 'POST', headers: XML_HEADERS, body: xml });
    const text = await r.text(); if (!r.ok) throw new Error('Tally ' + r.status + ': ' + text.slice(0, 120)); return text;
  }
  return {
    name: 'tally',
    async readProducts() {
      const xml = dataOf(await post(exportRequest(opt.company)));
      return tags('STOCKITEM', xml).map((it) => ({
        /* LIVE TALLY (2026-09-05): the alias is the SECOND <NAME> inside LANGUAGENAME.LIST/NAME.LIST; PARTNO only exists when enabled */
        name: unesc(tag('NAME', it)), code: unesc(tag('PARTNO', it)) || aliasOf(it) || unesc(tag('NAME', it)), unit: unesc(tag('BASEUNITS', it)) || 'nos',
        price: num(tag('STANDARDPRICE', it)) != null ? num(tag('STANDARDPRICE', it)) : (num(tag('CLOSINGRATE', it)) || 0),
        category: (unesc(tag('PARENT', it)).trim() && !/^primary$/i.test(unesc(tag('PARENT', it)).trim())) ? unesc(tag('PARENT', it)).trim() : null, hsn: hsnOf(it), gst_rate: gstRateOf(it), ref: unesc(tag('NAME', it)) })).filter((p) => p.name);
    },
    /** closing stock per item — Tally's CLOSINGBALANCE reads "12 bag"; a negative balance is stock in hand in Tally's sign convention */
    async readStock() {
      const xml = dataOf(await post(exportRequest(opt.company))); const at = new Date().toISOString();
      return tags('STOCKITEM', xml).map((it) => { const q = num(tag('CLOSINGBALANCE', it)); return { code: unesc(tag('PARTNO', it)) || aliasOf(it) || unesc(tag('NAME', it)), qty: q == null ? null : Math.abs(q), at }; }).filter((r) => r.code && r.qty != null);
    },
    /** the store's profile from the company master — every value 'copied' with source tally; the API checks and ranks */
    async readProfile() {
      const xml = dataOf(await post(companyRequest(opt.company))); const c = tags('COMPANY', xml)[0] || xml;
      const lines = tags('ADDRESS', c).map(unesc).map((s) => s.trim()).filter(Boolean);
      const out = { trade_name: unesc(tag('NAME', c)), legal_name: unesc(tag('BASICCOMPANYFORMALNAME', c)) || unesc(tag('NAME', c)), address: lines.join(', '), city: lines.length > 1 ? lines[lines.length - 1].replace(/[\d-]+$/, '').trim() : '',
        state: unesc(tag('STATENAME', c)), pincode: unesc(tag('PINCODE', c)), country: /india/i.test(unesc(tag('COUNTRYNAME', c))) ? 'IN' : unesc(tag('COUNTRYNAME', c)), phone: unesc(tag('PHONENUMBER', c)) || unesc(tag('MOBILENUMBERS', c)), email: unesc(tag('EMAIL', c)),
        gstin: unesc(tag('GSTREGISTRATIONNUMBER', c)), reg_type: /composition/i.test(unesc(tag('GSTREGISTRATIONTYPE', c))) ? 'composition' : (unesc(tag('GSTREGISTRATIONTYPE', c)) ? 'regular' : ''), pan: unesc(tag('INCOMETAXNUMBER', c)), currency: /₹|Rs|INR/i.test(unesc(tag('BASECURRENCYSYMBOL', c))) ? 'INR' : '' };
      /* ⭐ THE GSTIN LIVES ON THE VOUCHERS (found live 2026-09-05 with Athi at the keyboard). TallyPrime Release 3+ keeps the
         registration in a "GST Registration" master the Company object does not expose and whose TDL type FREEZES Tally when
         asked for; every voucher, though, carries CMPGSTIN · CMPGSTSTATE · CMPGSTREGISTRATIONTYPE — the Voucher object is one
         Tally answers all day. So: no GSTIN on the company → read it off the most recent voucher, if any exists yet. */
      if (!out.gstin) {
        try {
          const vq = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>CBVchG</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>${opt.company ? '<SVCURRENTCOMPANY>' + esc(opt.company) + '</SVCURRENTCOMPANY>' : ''}<SVFROMDATE>${ymd(new Date(Date.now() - 400 * 86400000))}</SVFROMDATE><SVTODATE>${ymd(new Date(Date.now() + 400 * 86400000))}</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="CBVchG" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>CMPGSTIN, CMPGSTSTATE, CMPGSTREGISTRATIONTYPE</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;
          const vx = dataOf(await post(vq));
          const v = tags('VOUCHER', vx).find((x) => unesc(tag('CMPGSTIN', x)).trim());
          if (v) {
            out.gstin = unesc(tag('CMPGSTIN', v)).trim();
            const rt = unesc(tag('CMPGSTREGISTRATIONTYPE', v)); if (rt && !out.reg_type) out.reg_type = /composition/i.test(rt) ? 'composition' : 'regular';
            const st = unesc(tag('CMPGSTSTATE', v)).trim(); if (st && !out.state) out.state = st;
            out.gstin_source = 'voucher';
          }
        } catch (_) { /* no vouchers yet, or Tally busy — the profile simply has no GSTIN until the first voucher */ }
      }
      for (const k of Object.keys(out)) if (!out[k]) delete out[k];
      return out;
    },
    /**
     * ⭐ THE LEDGERS THE VOUCHERS NEED, CREATED BY THE CONNECTOR (Athi, 2026-09-05, after creating "Sales" by hand: "you create
     * the ledgers"). Reads the Ledger collection, creates what is missing through Tally's own master import — the party
     * under Sundry Debtors (unless it is the cash ledger), sales under Sales Accounts, the bank under Bank Accounts, cash
     * under Cash-in-Hand. Never alters an existing ledger; a group that does not exist makes Tally refuse, and we say so.
     */
    async ensure() {
      const req = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>CBLed</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>${opt.company ? '<SVCURRENTCOMPANY>' + esc(opt.company) + '</SVCURRENTCOMPANY>' : ''}</STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="CBLed" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>NAME, PARENT</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;
      const have = new Set(tags('LEDGER', dataOf(await post(req))).map((l) => unesc(tag('NAME', l)).trim().toLowerCase()));
      const want = [];
      const cashName = opt.cashLedger || 'Cash';
      if (opt.partyLedger && opt.partyLedger.toLowerCase() !== cashName.toLowerCase() && !/^cash$/i.test(opt.partyLedger)) want.push([opt.partyLedger, 'Sundry Debtors']);
      want.push([opt.salesLedger || 'Sales', 'Sales Accounts']);
      want.push([opt.bankLedger || 'Bank', 'Bank Accounts']);
      want.push([cashName, 'Cash-in-Hand']);
      /* the GST tax ledgers a B2B voucher books its heads to (Duties & Taxes, duty head set) — unless told not to */
      if (opt.gstLedgers !== false) { const T = opt.taxLedgers || {}; want.push([T.cgst || 'CGST', 'Duties & Taxes', 'CGST'], [T.sgst || 'SGST', 'Duties & Taxes', 'SGST/UTGST'], [T.igst || 'IGST', 'Duties & Taxes', 'IGST']); }
      /* the buyer's side: the purchase ledger and the input-tax ledgers (my ITC claim) */
      if (/buyer|both/.test(String(opt.role || cfg.role || 'seller'))) { const I = opt.inputTaxLedgers || {}; want.push([opt.purchaseLedger || 'Purchase', 'Purchase Accounts'], [I.cgst || 'Input CGST', 'Duties & Taxes', 'CGST'], [I.sgst || 'Input SGST', 'Duties & Taxes', 'SGST/UTGST'], [I.igst || 'Input IGST', 'Duties & Taxes', 'IGST']); }
      const missing = want.filter(([n]) => !have.has(String(n).toLowerCase()));
      if (!missing.length) return { existing: want.map((w) => w[0]), created: [] };
      const masters = missing.map(([n, g, duty]) => `<LEDGER NAME="${esc(n)}" ACTION="Create"><NAME.LIST><NAME>${esc(n)}</NAME></NAME.LIST><PARENT>${esc(g)}</PARENT>${g === 'Bank Accounts' || g === 'Sundry Debtors' ? '<ISBILLWISEON>Yes</ISBILLWISEON>' : ''}${duty ? '<TAXTYPE>GST</TAXTYPE><GSTDUTYHEAD>' + esc(duty) + '</GSTDUTYHEAD>' : ''}</LEDGER>`).join('\n');
      const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES>${opt.company ? '<SVCURRENTCOMPANY>' + esc(opt.company) + '</SVCURRENTCOMPANY>' : ''}</STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">\n${masters}\n</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
      if (dry) { log('[dry] ledger masters:\n' + xml); return { existing: want.map((w) => w[0]).filter((n) => have.has(n.toLowerCase())), created: [], would_create: missing.map((m) => m[0] + ' (' + m[1] + ')') }; }
      const res = await post(xml);
      const created = num(tag('CREATED', res)) || 0, errors = num(tag('ERRORS', res)) || 0;
      if (errors || created < missing.length) throw new Error('Tally refused a ledger: ' + (tag('LINEERROR', res) || res.slice(0, 200)));
      log('ledgers created in Tally: ' + missing.map((m) => m[0] + ' (' + m[1] + ')').join(' · '));
      return { existing: want.map((w) => w[0]).filter((n) => have.has(n.toLowerCase())), created: missing.map((m) => m[0]) };
    },
    /**
     * ⭐ A REGISTERED BUYER'S PARTY LEDGER (B2B, 2026-09-05): named after their legal name, under Sundry Debtors, carrying
     * their GSTIN · registration type · state · address — created once, never altered (a buyer who changes their GSTIN is
     * a new ledger in the books, which is what an accountant would do too).
     */
    async ensureParty(buyer) {
      const name = partyLedgerName(buyer);
      const req = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>CBLed1</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>${opt.company ? '<SVCURRENTCOMPANY>' + esc(opt.company) + '</SVCURRENTCOMPANY>' : ''}</STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="CBLed1" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>NAME, PARENT, PARTYGSTIN</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;
      const have = tags('LEDGER', dataOf(await post(req))).map((l) => unesc(tag('NAME', l)).trim().toLowerCase());
      if (have.includes(name.toLowerCase())) return { name, created: null };
      const st = stateName(buyer.state_code);
      const addr = [buyer.addr, buyer.loc].filter(Boolean).map((a) => '<ADDRESS>' + esc(a) + '</ADDRESS>').join('');
      const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES>${opt.company ? '<SVCURRENTCOMPANY>' + esc(opt.company) + '</SVCURRENTCOMPANY>' : ''}</STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
<LEDGER NAME="${esc(name)}" ACTION="Create"><NAME.LIST><NAME>${esc(name)}</NAME></NAME.LIST><PARENT>Sundry Debtors</PARENT><ISBILLWISEON>Yes</ISBILLWISEON>
<PARTYGSTIN>${esc(buyer.gstin)}</PARTYGSTIN><GSTREGISTRATIONTYPE>${esc(buyer.reg_type || 'Regular')}</GSTREGISTRATIONTYPE><LEDSTATENAME>${esc(st)}</LEDSTATENAME><COUNTRYNAME>India</COUNTRYNAME>
<LEDGERMAILINGDETAILS.LIST><APPLICABLEFROM>${ymd(new Date(new Date().getFullYear() - (new Date().getMonth() < 3 ? 1 : 0), 3, 1))}</APPLICABLEFROM><MAILINGNAME>${esc(name)}</MAILINGNAME>${addr ? '<ADDRESS.LIST>' + addr + '</ADDRESS.LIST>' : ''}<STATE>${esc(st)}</STATE><COUNTRY>India</COUNTRY>${buyer.pin ? '<PINCODE>' + esc(buyer.pin) + '</PINCODE>' : ''}</LEDGERMAILINGDETAILS.LIST>
</LEDGER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
      if (dry) { log('[dry] party ledger:\n' + xml); return { name, created: null, would_create: name }; }
      const res = await post(xml);
      const created = num(tag('CREATED', res)) || 0, errors = num(tag('ERRORS', res)) || 0;
      if (errors || !created) throw new Error('Tally refused the party ledger: ' + (tag('LINEERROR', res) || res.slice(0, 200)));
      return { name, created: name };
    },
    /* ══ THE BUYER'S SIDE (2026-09-05): the seller as a supplier, the materials as stock items, the Purchase voucher with ITC ══ */
    /** the seller → a ledger under Sundry Creditors with their GSTIN · registration type · state · mailing address, once */
    async ensureSupplier(seller) {
      const name = partyLedgerName(seller);
      const req = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>CBLed2</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>${opt.company ? '<SVCURRENTCOMPANY>' + esc(opt.company) + '</SVCURRENTCOMPANY>' : ''}</STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="CBLed2" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>NAME, PARENT</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;
      const have = tags('LEDGER', dataOf(await post(req))).map((l) => unesc(tag('NAME', l)).trim().toLowerCase());
      if (have.includes(name.toLowerCase())) return { name, created: null };
      const st = stateName(seller.state_code);
      const addr = [seller.addr, seller.loc].filter(Boolean).map((a) => '<ADDRESS>' + esc(a) + '</ADDRESS>').join('');
      const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES>${opt.company ? '<SVCURRENTCOMPANY>' + esc(opt.company) + '</SVCURRENTCOMPANY>' : ''}</STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
<LEDGER NAME="${esc(name)}" ACTION="Create"><NAME.LIST><NAME>${esc(name)}</NAME></NAME.LIST><PARENT>Sundry Creditors</PARENT><ISBILLWISEON>Yes</ISBILLWISEON>
${seller.gstin ? '<PARTYGSTIN>' + esc(seller.gstin) + '</PARTYGSTIN><GSTREGISTRATIONTYPE>' + esc(seller.reg_type || 'Regular') + '</GSTREGISTRATIONTYPE>' : '<GSTREGISTRATIONTYPE>Unregistered</GSTREGISTRATIONTYPE>'}<LEDSTATENAME>${esc(st)}</LEDSTATENAME><COUNTRYNAME>India</COUNTRYNAME>
<LEDGERMAILINGDETAILS.LIST><APPLICABLEFROM>${ymd(new Date(new Date().getFullYear() - (new Date().getMonth() < 3 ? 1 : 0), 3, 1))}</APPLICABLEFROM><MAILINGNAME>${esc(name)}</MAILINGNAME>${addr ? '<ADDRESS.LIST>' + addr + '</ADDRESS.LIST>' : ''}<STATE>${esc(st)}</STATE><COUNTRY>India</COUNTRY>${seller.pin ? '<PINCODE>' + esc(seller.pin) + '</PINCODE>' : ''}</LEDGERMAILINGDETAILS.LIST>
</LEDGER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
      if (dry) { log('[dry] supplier ledger:\n' + xml); return { name, created: null, would_create: name }; }
      const res = await post(xml);
      const created = num(tag('CREATED', res)) || 0, errors = num(tag('ERRORS', res)) || 0;
      if (errors || !created) throw new Error('Tally refused the supplier ledger: ' + (tag('LINEERROR', res) || res.slice(0, 200)));
      return { name, created: name };
    },
    /**
     * the materials I bought → stock items I hold. Matched by name (Tally's key); a material I never stocked is created with the
     * seller's unit (created too if my Tally lacks it), HSN and GST rate. Never alters an existing item — my price, my group.
     * ⚠️ the GST-details shape mirrors what Tally EXPORTS (GSTDETAILS.LIST › STATEWISEDETAILS.LIST › RATEDETAILS.LIST); proven on
     * fake-tally, to be watched on the first live purchase.
     */
    async ensureItems(items) {
      const q = (type, id) => `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>${id}</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>${opt.company ? '<SVCURRENTCOMPANY>' + esc(opt.company) + '</SVCURRENTCOMPANY>' : ''}</STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="${id}" ISMODIFY="No"><TYPE>${type}</TYPE><FETCH>NAME</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;
      const haveItems = new Set(tags('STOCKITEM', dataOf(await post(q('StockItem', 'CBItems')))).map((x) => unesc(tag('NAME', x)).trim().toLowerCase()));
      const haveUnits = new Set(tags('UNIT', dataOf(await post(q('Unit', 'CBUnits')))).map((x) => unesc(tag('NAME', x)).trim().toLowerCase()));
      const seen = new Set(); const newItems = [], newUnits = [];
      for (const it of items) {
        const name = String(it.name || '').trim(); if (!name || seen.has(name.toLowerCase())) continue; seen.add(name.toLowerCase());
        const unit = String(it.unit || 'nos').trim() || 'nos';
        if (!haveUnits.has(unit.toLowerCase()) && !newUnits.some((u) => u.toLowerCase() === unit.toLowerCase())) newUnits.push(unit);
        if (!haveItems.has(name.toLowerCase())) newItems.push({ name, unit, hsn: it.hsn || null, gst_rate: it.gst_rate });
      }
      if (!newItems.length && !newUnits.length) return { created: [], units: [] };
      const from = ymd(new Date(new Date().getFullYear() - (new Date().getMonth() < 3 ? 1 : 0), 3, 1));
      const unitXml = newUnits.map((u) => `<UNIT NAME="${esc(u)}" ACTION="Create"><NAME>${esc(u)}</NAME><ISSIMPLEUNIT>Yes</ISSIMPLEUNIT><DECIMALPLACES>3</DECIMALPLACES></UNIT>`).join('\n');
      const itemXml = newItems.map((it) => {
        const gst = it.gst_rate != null && it.gst_rate >= 0 ? `<GSTAPPLICABLE>&#4; Applicable</GSTAPPLICABLE><GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY>
<GSTDETAILS.LIST><APPLICABLEFROM>${from}</APPLICABLEFROM><SRCOFGSTDETAILS>Specify Details Here</SRCOFGSTDETAILS><TAXABILITY>Taxable</TAXABILITY><STATEWISEDETAILS.LIST><STATENAME>&#4; Any</STATENAME>
<RATEDETAILS.LIST><GSTRATEDUTYHEAD>CGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE>${it.gst_rate / 2}</GSTRATE></RATEDETAILS.LIST>
<RATEDETAILS.LIST><GSTRATEDUTYHEAD>SGST/UTGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE>${it.gst_rate / 2}</GSTRATE></RATEDETAILS.LIST>
<RATEDETAILS.LIST><GSTRATEDUTYHEAD>IGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE>${it.gst_rate}</GSTRATE></RATEDETAILS.LIST></STATEWISEDETAILS.LIST></GSTDETAILS.LIST>` : '';
        const hsn = it.hsn ? `<HSNDETAILS.LIST><APPLICABLEFROM>${from}</APPLICABLEFROM><SRCOFHSNDETAILS>Specify Details Here</SRCOFHSNDETAILS><HSNCODE>${esc(it.hsn)}</HSNCODE></HSNDETAILS.LIST>` : '';
        return `<STOCKITEM NAME="${esc(it.name)}" ACTION="Create"><NAME.LIST><NAME>${esc(it.name)}</NAME></NAME.LIST><PARENT>&#4; Primary</PARENT><BASEUNITS>${esc(it.unit)}</BASEUNITS>${gst}${hsn}</STOCKITEM>`;
      }).join('\n');
      const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES>${opt.company ? '<SVCURRENTCOMPANY>' + esc(opt.company) + '</SVCURRENTCOMPANY>' : ''}</STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">\n${unitXml}\n${itemXml}\n</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
      if (dry) { log('[dry] stock masters:\n' + xml); return { created: [], units: [], would_create: newItems.map((i) => i.name), would_create_units: newUnits }; }
      const res = await post(xml);
      const created = num(tag('CREATED', res)) || 0, errors = num(tag('ERRORS', res)) || 0;
      if (errors || created < newItems.length + newUnits.length) throw new Error('Tally refused a stock master: ' + (tag('LINEERROR', res) || res.slice(0, 200)));
      return { created: newItems.map((i) => i.name), units: newUnits };
    },
    /**
     * the Purchase voucher (invoice view): the goods in (ISDEEMEDPOSITIVE Yes), the purchase ledger, the input tax lines — my
     * ITC claim — and the supplier credited for goods + tax against a New Ref bill that carries the seller's reference.
     */
    async pushPurchase(p) {
      const party = partyLedgerName(p.seller), purch = opt.purchaseLedger || 'Purchase';
      const T = opt.inputTaxLedgers || {}; const names = { cgst: T.cgst || 'Input CGST', sgst: T.sgst || 'Input SGST', igst: T.igst || 'Input IGST', cess: T.cess || 'Input Cess' };
      const total = Math.round(Number(p.total) * 100) / 100;
      const inv = p.items.map((it) => {
        const qty = it.qty, unit = it.unit || 'nos', gross = Math.round(it.rate * qty * 100) / 100, amount = Math.round((it.ass || gross) * 100) / 100;
        const disc = gross > 0 && amount < gross ? Math.round((1 - amount / gross) * 10000) / 100 : 0;
        return `<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>${esc(it.name)}</STOCKITEMNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
<RATE>${it.rate}/${esc(unit)}</RATE>${disc ? '<DISCOUNT>' + disc + '</DISCOUNT>' : ''}<AMOUNT>-${amount}</AMOUNT><ACTUALQTY>${qty} ${esc(unit)}</ACTUALQTY><BILLEDQTY>${qty} ${esc(unit)}</BILLEDQTY>
<ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>${esc(purch)}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-${amount}</AMOUNT></ACCOUNTINGALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST>`;
      }).join('\n');
      const taxLines = [['cgst', p.taxes.cgst], ['sgst', p.taxes.sgst], ['igst', p.taxes.igst], ['cess', p.taxes.cess]].filter(([, v]) => v > 0)
        .map(([k, v]) => `<LEDGERENTRIES.LIST><LEDGERNAME>${esc(names[k])}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-${Math.round(v * 100) / 100}</AMOUNT></LEDGERENTRIES.LIST>`).join('\n');
      const inputTax = Math.round(((p.taxes.cgst || 0) + (p.taxes.sgst || 0) + (p.taxes.igst || 0) + (p.taxes.cess || 0)) * 100) / 100;
      const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>
<STATICVARIABLES>${opt.company ? '<SVCURRENTCOMPANY>' + esc(opt.company) + '</SVCURRENTCOMPANY>' : ''}</STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="Purchase" ACTION="Create" OBJVIEW="Invoice Voucher View"><DATE>${ymd(eduDate(p.at, opt.eduDates))}</DATE><VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
<REFERENCE>${esc(p.ref)}</REFERENCE><REFERENCEDATE>${ymd(eduDate(p.at, opt.eduDates))}</REFERENCEDATE><NARRATION>${esc('ChitBridge purchase ' + p.chit_id + ' from ' + p.seller.name + ' · seller invoice ' + p.ref + ' · ITC ' + inputTax + (opt.eduDates ? ' (EDU date)' : ''))}</NARRATION>
<PARTYLEDGERNAME>${esc(party)}</PARTYLEDGERNAME><PARTYNAME>${esc(p.seller.name)}</PARTYNAME><ISINVOICE>Yes</ISINVOICE>${p.seller.gstin ? '<PARTYGSTIN>' + esc(p.seller.gstin) + '</PARTYGSTIN>' : ''}${p.buyer_state ? '<PLACEOFSUPPLY>' + esc(stateName(p.buyer_state)) + '</PLACEOFSUPPLY>' : ''}${p.seller.state_code ? '<STATENAME>' + esc(stateName(p.seller.state_code)) + '</STATENAME>' : ''}
${inv}
<LEDGERENTRIES.LIST><LEDGERNAME>${esc(party)}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>${total}</AMOUNT><BILLALLOCATIONS.LIST><NAME>${esc(p.ref)}</NAME><BILLTYPE>New Ref</BILLTYPE><AMOUNT>${total}</AMOUNT></BILLALLOCATIONS.LIST></LEDGERENTRIES.LIST>
${taxLines}
</VOUCHER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
      if (dry) { log('[dry] purchase XML for ' + p.chit_id + ':\n' + xml); return { ref: 'dry-run', input_tax: inputTax }; }
      const res = await post(xml);
      const created = num(tag('CREATED', res)) || 0, errors = num(tag('ERRORS', res)) || 0;
      if (errors || !created) throw new Error('Tally refused the purchase: ' + (tag('LINEERROR', res) || res.slice(0, 200)));
      return { ref: tag('VCHID', res) || tag('LASTVCHID', res) || ('created:' + created), input_tax: inputTax };
    },
    /** a payment recorded in ChitBridge → a Receipt voucher (skipped for a cash sale — the Sales voucher settled it) */
    async pushReceipt(p) {
      const cashy = /^cash$/i.test(String(opt.partyLedger || 'Cash')) || /^cash$/i.test(String(opt.cashLedger || 'Cash')) && opt.partyLedger === (opt.cashLedger || 'Cash');
      if (cashy) return { ref: null, skipped: 'cash sale (partyLedger ' + (opt.partyLedger || 'Cash') + ') is settled by the Sales voucher' };
      if (!(Number(p.amount) > 0)) return { ref: null, skipped: 'no amount on the payment' };
      const xml = receiptXML(p, opt);
      if (dry) { log('[dry] receipt XML for ' + p.chit_id + ':\n' + xml); return { ref: 'dry-run' }; }
      const res = await post(xml);
      const created = num(tag('CREATED', res)) || 0, errors = num(tag('ERRORS', res)) || 0;
      if (errors || !created) throw new Error('Tally refused the receipt: ' + (tag('LINEERROR', res) || res.slice(0, 200)));
      return { ref: tag('VCHID', res) || tag('LASTVCHID', res) || ('created:' + created) };
    },
    async pushOrder(order) {
      const xml = voucherXML(order, opt);
      if (dry) { log('[dry] voucher XML for ' + order.chit_id + ':\n' + xml); return { ref: 'dry-run' }; }
      const res = await post(xml);
      const created = num(tag('CREATED', res)) || 0, errors = num(tag('ERRORS', res)) || 0;
      if (errors || !created) throw new Error('Tally refused the voucher: ' + (tag('LINEERROR', res) || res.slice(0, 160)));
      return { ref: tag('VCHID', res) || tag('LASTVCHID', res) || ('created:' + created) };
    },
    _xml: { exportRequest, voucherXML, companyRequest },
  };
};
