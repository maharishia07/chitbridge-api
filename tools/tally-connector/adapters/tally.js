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
function voucherXML(order, opt) {
  const party = opt.partyLedger || 'Cash', sales = opt.salesLedger || 'Sales', vtype = opt.voucherType || 'Sales';
  const total = Math.round((order.total || order.lines.reduce((t, l) => t + l.total, 0)) * 100) / 100;
  const inv = order.lines.map((l) => {
    const rate = l.price, qty = l.qty, unit = l.unit || 'nos', amount = Math.round(rate * qty * 100) / 100;
    const disc = l.list_price != null && l.list_price > rate ? Math.round((1 - rate / l.list_price) * 10000) / 100 : 0;
    return `<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>${esc(l.name)}</STOCKITEMNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
<RATE>${rate}/${esc(unit)}</RATE>${disc ? '<DISCOUNT>' + disc + '</DISCOUNT>' : ''}<AMOUNT>${amount}</AMOUNT><ACTUALQTY>${qty} ${esc(unit)}</ACTUALQTY><BILLEDQTY>${qty} ${esc(unit)}</BILLEDQTY>
<ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>${esc(sales)}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${amount}</AMOUNT></ACCOUNTINGALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST>`;
  }).join('\n');
  return `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>
<STATICVARIABLES>${opt.company ? '<SVCURRENTCOMPANY>' + esc(opt.company) + '</SVCURRENTCOMPANY>' : ''}</STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="${esc(vtype)}" ACTION="Create" OBJVIEW="Invoice Voucher View"><DATE>${ymd(eduDate(order.at, opt.eduDates))}</DATE><VOUCHERTYPENAME>${esc(vtype)}</VOUCHERTYPENAME>
<REFERENCE>CB-${esc(String(order.chit_id).slice(0, 8))}</REFERENCE><NARRATION>${esc('ChitBridge order ' + order.chit_id + ' from ' + order.buyer + (opt.eduDates ? ' (ordered ' + String(order.at || '').slice(0, 10) + '; EDU date)' : ''))}</NARRATION>
<PARTYLEDGERNAME>${esc(party)}</PARTYLEDGERNAME><PARTYNAME>${esc(order.buyer)}</PARTYNAME><ISINVOICE>Yes</ISINVOICE>
${inv}
<LEDGERENTRIES.LIST><LEDGERNAME>${esc(party)}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>-${total}</AMOUNT></LEDGERENTRIES.LIST>
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
      for (const k of Object.keys(out)) if (!out[k]) delete out[k];
      return out;
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
