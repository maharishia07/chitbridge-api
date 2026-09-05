/** fake-zoho.js — a stand-in for Zoho Books' REST API, for the proof. node fake-zoho.js [port] · GET /_invoices · GET /_reset */
'use strict';
const http = require('http');
const ITEMS = [{ item_id: 'z1', name: 'Basmati 25kg', sku: 'BAS-25', unit: 'bag', rate: 1000, hsn_or_sac: '1006', status: 'active' }, { item_id: 'z2', name: 'Groundnut Oil 1L', sku: 'GNO-1', unit: 'nos', rate: 240, hsn_or_sac: '1508', status: 'active' }];
const invoices = [];
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); res.setHeader('Content-Type', 'application/json');
  if (u.pathname === '/_invoices') return res.end(JSON.stringify(invoices));
  if (u.pathname === '/_reset') { invoices.length = 0; return res.end('{}'); }
  if (!/^Zoho-oauthtoken /.test(req.headers.authorization || '')) { res.statusCode = 401; return res.end(JSON.stringify({ code: 57, message: 'You are not authorized' })); }
  if (req.method === 'GET' && u.pathname === '/books/v3/items') return res.end(JSON.stringify({ code: 0, items: ITEMS, page_context: { has_more_page: false } }));
  if (req.method === 'POST' && u.pathname === '/books/v3/invoices') { let b = ''; req.on('data', (c) => b += c); req.on('end', () => { const j = JSON.parse(b || '{}'); const n = invoices.length + 1; invoices.push(Object.assign({ invoice_id: 'inv' + n, invoice_number: 'INV-' + String(n).padStart(5, '0') }, j)); res.end(JSON.stringify({ code: 0, message: 'The invoice has been created.', invoice: invoices[n - 1] })); }); return; }
  res.statusCode = 404; res.end(JSON.stringify({ code: 5, message: 'Invalid URL' }));
}).listen(Number(process.argv[2] || 9200), () => console.log('fake Zoho on http://localhost:' + (process.argv[2] || 9200)));
