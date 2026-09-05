/**
 * fake-tally.js — a stand-in for Tally's XML port, for the proof on a machine without Tally.
 * Answers the Export (Collection) request with a few stock items and accepts Import Data vouchers, remembering them.
 *   node fake-tally.js [port]        · GET /_vouchers lists what was imported · GET /_reset clears
 */
'use strict';
const http = require('http');
const ITEMS = [
  { name: 'Basmati 25kg', part: 'BAS-25', unit: 'bag', price: 1000, parent: 'Rice', hsn: '1006', stock: 42 },
  { name: 'Ponni Boiled 10kg', part: 'PON-10', unit: 'bag', price: 600, parent: 'Rice', hsn: '1006' },
  { name: 'Groundnut Oil 1L', part: 'GNO-1', unit: 'nos', price: 240, parent: 'Oil', hsn: '1508' },
];
const vouchers = [];
const masters = [];   /* ledgers created through master import — GET /_masters */
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/_vouchers') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(vouchers)); }
  if (req.method === 'GET' && req.url === '/_reset') { vouchers.length = 0; masters.length = 0; return res.end('ok'); }
  if (req.method === 'GET' && req.url === '/_masters') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(masters)); }
  let body = ''; req.on('data', (c) => body += c); req.on('end', () => {
    res.setHeader('Content-Type', 'text/xml');
    if (/<ID>CBCompany<\/ID>/i.test(body)) {
      return res.end('<ENVELOPE><BODY><DATA><COLLECTION><COMPANY NAME="Kumar Traders"><NAME>Kumar Traders</NAME><BASICCOMPANYFORMALNAME>Kumar Traders Private Limited</BASICCOMPANYFORMALNAME><ADDRESS.LIST><ADDRESS>16A-105 Perumbakkam Main Road</ADDRESS><ADDRESS>Chennai</ADDRESS></ADDRESS.LIST><STATENAME>Tamil Nadu</STATENAME><PINCODE>600126</PINCODE><COUNTRYNAME>India</COUNTRYNAME><PHONENUMBER>044-12345678</PHONENUMBER><EMAIL>accounts@kumartraders.example</EMAIL><GSTREGISTRATIONNUMBER>33AABCK1234F1Z6</GSTREGISTRATIONNUMBER><GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE><INCOMETAXNUMBER>AABCK1234F</INCOMETAXNUMBER><BASECURRENCYSYMBOL>₹</BASECURRENCYSYMBOL></COMPANY></COLLECTION></DATA></BODY></ENVELOPE>');
    }
    /* the Ledger collection answers with the defaults plus whatever master import created (so ensure()/ensureParty() see them) */
    if (/<TYPE>Ledger<\/TYPE>/i.test(body)) {
      const un = (s) => String(s).replace(/&amp;/g, '&');
      const all = [{ name: 'Cash', parent: 'Cash-in-Hand' }, { name: 'Profit & Loss A/c', parent: 'Primary' }].concat(masters.map((m) => ({ name: un(m.name), parent: un(m.parent), gstin: m.gstin })));
      return res.end('<ENVELOPE><BODY><DATA><COLLECTION>' + all.map((l) => `<LEDGER NAME="${l.name.replace(/&/g, '&amp;')}"><NAME>${l.name.replace(/&/g, '&amp;')}</NAME><PARENT>${l.parent.replace(/&/g, '&amp;')}</PARENT>${l.gstin ? '<PARTYGSTIN>' + l.gstin + '</PARTYGSTIN>' : ''}</LEDGER>`).join('') + '</COLLECTION></DATA></BODY></ENVELOPE>');
    }
    if (/<TALLYREQUEST>\s*Export\s*<\/TALLYREQUEST>/i.test(body) || /<TYPE>Collection<\/TYPE>/i.test(body)) {
      const xml = '<ENVELOPE><BODY><DATA><COLLECTION>' + ITEMS.map((i) => `<STOCKITEM NAME="${i.name}"><NAME>${i.name}</NAME><PARENT>${i.parent}</PARENT><BASEUNITS>${i.unit}</BASEUNITS><PARTNO>${i.part}</PARTNO><STANDARDPRICE>${i.price}/${i.unit}</STANDARDPRICE><HSNCODE>${i.hsn}</HSNCODE><CLOSINGBALANCE>${i.stock || 0} ${i.unit}</CLOSINGBALANCE></STOCKITEM>`).join('') + '</COLLECTION></DATA></BODY></ENVELOPE>';
      return res.end(xml);
    }
    if (/<TALLYREQUEST>\s*Import Data\s*<\/TALLYREQUEST>/i.test(body)) {
      const ref = (/<REFERENCE>([^<]*)<\/REFERENCE>/.exec(body) || [])[1] || '';
      const items = [...body.matchAll(/<STOCKITEMNAME>([^<]*)<\/STOCKITEMNAME>[\s\S]*?<RATE>([^<]*)<\/RATE>(?:<DISCOUNT>([^<]*)<\/DISCOUNT>)?<AMOUNT>([^<]*)<\/AMOUNT>[\s\S]*?<BILLEDQTY>([^<]*)<\/BILLEDQTY>/g)].map((m) => ({ item: m[1], rate: m[2], discount: m[3] || '', amount: m[4], qty: m[5] }));
      const narration = (/<NARRATION>([^<]*)<\/NARRATION>/.exec(body) || [])[1] || '';
      const vtype = (/VCHTYPE="([^"]*)"/.exec(body) || [])[1] || '';
      const ledgers = [...body.matchAll(/<LEDGERNAME>([^<]*)<\/LEDGERNAME><ISDEEMEDPOSITIVE>([^<]*)<\/ISDEEMEDPOSITIVE>(?:<ISPARTYLEDGER>[^<]*<\/ISPARTYLEDGER>)?<AMOUNT>([^<]*)<\/AMOUNT>/g)].map((m) => ({ ledger: m[1], dr: m[2] === 'Yes', amount: m[3] }));
      /* master imports (ledgers) are remembered too — GET /_masters */
      if (/<REPORTNAME>All Masters<\/REPORTNAME>/i.test(body)) { const led = [...body.matchAll(/<LEDGER NAME="([^"]*)"[\s\S]*?<PARENT>([^<]*)<\/PARENT>([\s\S]*?)<\/LEDGER>/g)].map((m) => ({ name: m[1].replace(/&amp;/g, '&'), parent: m[2].replace(/&amp;/g, '&'), gstin: (/<PARTYGSTIN>([^<]*)</.exec(m[3]) || [])[1] || '', state: (/<LEDSTATENAME>([^<]*)</.exec(m[3]) || [])[1] || '', duty: (/<GSTDUTYHEAD>([^<]*)</.exec(m[3]) || [])[1] || '' })); masters.push(...led); return res.end(`<RESPONSE><CREATED>${led.length}</CREATED><ALTERED>0</ALTERED><ERRORS>0</ERRORS></RESPONSE>`); }
      const partyGstin = (/<PARTYGSTIN>([^<]*)<\/PARTYGSTIN>/.exec(body) || [])[1] || '', pos = (/<PLACEOFSUPPLY>([^<]*)<\/PLACEOFSUPPLY>/.exec(body) || [])[1] || '';
      const id = vouchers.length + 1; vouchers.push({ id, ref, vtype, items, ledgers, party_gstin: partyGstin, place_of_supply: pos, narration, at: new Date().toISOString() });
      return res.end(`<RESPONSE><CREATED>1</CREATED><ALTERED>0</ALTERED><LASTVCHID>${id}</LASTVCHID><ERRORS>0</ERRORS></RESPONSE>`);
    }
    res.statusCode = 400; res.end('<RESPONSE><ERRORS>1</ERRORS><LINEERROR>unknown request</LINEERROR></RESPONSE>');
  });
});
const port = Number(process.argv[2] || process.env.PORT || 9000);
server.listen(port, () => console.log('fake Tally on http://localhost:' + port));
