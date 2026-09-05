/** fake-gofrugal.js — a stand-in for GoFrugal's WebReporter API (from the published knowledge base), for the proof.
 *   node fake-gofrugal.js [port] · GET /_orders lists the sales orders received · GET /_reset clears */
'use strict';
const http = require('http');
const port = Number(process.argv[2] || 8482);
const ITEMS = [
  { itemId: 101, itemName: 'Basmati 25kg', locationId: 1, stock: [{ stock: 120, salePrice: 1000, mrp: 1100, itemReferenceCode: 'BAS-25', taxPercentage: 5 }] },
  { itemId: 102, itemName: 'Groundnut Oil 1L', locationId: 1, stock: [{ stock: 40, salePrice: 240, mrp: 260, itemReferenceCode: 'GNO-1', taxPercentage: 5 }] },
  { itemId: 103, itemName: 'Toor Dal 1kg', locationId: 1, stock: [{ stock: 0, salePrice: 168, mrp: 180, itemReferenceCode: 'DAL-TOR-1', taxPercentage: 0 }] },
];
const orders = [];
http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/_orders') return res.end(JSON.stringify(orders));
  if (req.url === '/_reset') { orders.length = 0; return res.end('{}'); }
  if (req.headers['x-auth-token'] !== 'k') { res.statusCode = 401; return res.end(JSON.stringify({ error: 'invalid token' })); }
  if (req.method === 'GET' && req.url === '/WebReporter/api/v1/items') return res.end(JSON.stringify({ items: ITEMS }));
  if (req.method === 'GET' && req.url === '/WebReporter/api/v1/salesOrders') return res.end(JSON.stringify({ salesOrders: orders }));
  if (req.method === 'POST' && req.url === '/WebReporter/api/v1/salesOrders') { let b = ''; req.on('data', (c) => b += c); req.on('end', () => { const j = JSON.parse(b || '{}'); const so = j.salesOrder || {}; const id = orders.length + 1; orders.push(Object.assign({ id }, so)); res.end(JSON.stringify({ result: { status: 'Success', id } })); }); return; }
  res.statusCode = 404; res.end(JSON.stringify({ error: 'not found' }));
}).listen(port, () => console.log('fake GoFrugal on http://localhost:' + port));
