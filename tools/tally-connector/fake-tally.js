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
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/_vouchers') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(vouchers)); }
  if (req.method === 'GET' && req.url === '/_reset') { vouchers.length = 0; return res.end('ok'); }
  let body = ''; req.on('data', (c) => body += c); req.on('end', () => {
    res.setHeader('Content-Type', 'text/xml');
    if (/<ID>CBCompany<\/ID>/i.test(body)) {
      return res.end('<ENVELOPE><BODY><DATA><COLLECTION><COMPANY NAME="Kumar Traders"><NAME>Kumar Traders</NAME><BASICCOMPANYFORMALNAME>Kumar Traders Private Limited</BASICCOMPANYFORMALNAME><ADDRESS.LIST><ADDRESS>16A-105 Perumbakkam Main Road</ADDRESS><ADDRESS>Chennai</ADDRESS></ADDRESS.LIST><STATENAME>Tamil Nadu</STATENAME><PINCODE>600126</PINCODE><COUNTRYNAME>India</COUNTRYNAME><PHONENUMBER>044-12345678</PHONENUMBER><EMAIL>accounts@kumartraders.example</EMAIL><GSTREGISTRATIONNUMBER>33AABCK1234F1Z6</GSTREGISTRATIONNUMBER><GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE><INCOMETAXNUMBER>AABCK1234F</INCOMETAXNUMBER><BASECURRENCYSYMBOL>₹</BASECURRENCYSYMBOL></COMPANY></COLLECTION></DATA></BODY></ENVELOPE>');
    }
    if (/<TALLYREQUEST>\s*Export\s*<\/TALLYREQUEST>/i.test(body) || /<TYPE>Collection<\/TYPE>/i.test(body)) {
      const xml = '<ENVELOPE><BODY><DATA><COLLECTION>' + ITEMS.map((i) => `<STOCKITEM NAME="${i.name}"><NAME>${i.name}</NAME><PARENT>${i.parent}</PARENT><BASEUNITS>${i.unit}</BASEUNITS><PARTNO>${i.part}</PARTNO><STANDARDPRICE>${i.price}/${i.unit}</STANDARDPRICE><HSNCODE>${i.hsn}</HSNCODE><CLOSINGBALANCE>${i.stock || 0} ${i.unit}</CLOSINGBALANCE></STOCKITEM>`).join('') + '</COLLECTION></DATA></BODY></ENVELOPE>';
      return res.end(xml);
    }
    if (/<TALLYREQUEST>\s*Import Data\s*<\/TALLYREQUEST>/i.test(body)) {
      const ref = (/<REFERENCE>([^<]*)<\/REFERENCE>/.exec(body) || [])[1] || '';
      const items = [...body.matchAll(/<STOCKITEMNAME>([^<]*)<\/STOCKITEMNAME>[\s\S]*?<RATE>([^<]*)<\/RATE>[\s\S]*?<BILLEDQTY>([^<]*)<\/BILLEDQTY>/g)].map((m) => ({ item: m[1], rate: m[2], qty: m[3] }));
      const id = vouchers.length + 1; vouchers.push({ id, ref, items, at: new Date().toISOString() });
      return res.end(`<RESPONSE><CREATED>1</CREATED><ALTERED>0</ALTERED><LASTVCHID>${id}</LASTVCHID><ERRORS>0</ERRORS></RESPONSE>`);
    }
    res.statusCode = 400; res.end('<RESPONSE><ERRORS>1</ERRORS><LINEERROR>unknown request</LINEERROR></RESPONSE>');
  });
});
const port = Number(process.argv[2] || process.env.PORT || 9000);
server.listen(port, () => console.log('fake Tally on http://localhost:' + port));
