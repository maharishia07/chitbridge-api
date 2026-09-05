/**
 * ADAPTER: any system that can export a CSV and read one back — the proof that the core is system-neutral.
 *   readProducts(): products.csv with a header row: name, code, unit, price[, hsn, category]
 *   pushOrder(order): writes orders/<chit_id>.csv (one row per line: chit, buyer, name, code, qty, unit, price, list_price, offer, total)
 * GoFrugal, Zoho, a spreadsheet — anything that speaks files — attaches this way today; a REST adapter is the same two
 * functions with fetch() instead of fs.
 */
'use strict';
const fs = require('fs');
const path = require('path');

function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (c !== '\r') cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
}
const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';

module.exports = function csvAdapter(cfg) {
  const dir = (cfg.csv && cfg.csv.dir) || path.dirname(cfg._configFile || '.');
  const file = (cfg.csv && cfg.csv.products) || path.join(dir, 'products.csv');
  const outDir = (cfg.csv && cfg.csv.orders) || path.join(dir, 'orders');
  return {
    name: 'csv',
    async readProducts() {
      const rows = parseCSV(fs.readFileSync(file, 'utf8'));
      const head = rows[0].map((h) => String(h).trim().toLowerCase());
      const col = (r, k) => { const i = head.indexOf(k); return i >= 0 ? String(r[i]).trim() : ''; };
      return rows.slice(1).map((r) => ({ name: col(r, 'name'), code: col(r, 'code') || col(r, 'sku'), unit: col(r, 'unit') || 'unit', price: Number(col(r, 'price')) || 0, hsn: col(r, 'hsn') || null, category: col(r, 'category') || null, ref: col(r, 'code') })).filter((p) => p.name);
    },
    /** stock: a `stock` column in products.csv, or stock.csv (code, qty) beside it */
    async readStock() {
      const at = new Date().toISOString();
      const sf = (cfg.csv && cfg.csv.stock) || path.join(dir, 'stock.csv');
      const src = fs.existsSync(sf) ? sf : file;
      const rows = parseCSV(fs.readFileSync(src, 'utf8')); const head = rows[0].map((h) => String(h).trim().toLowerCase());
      const col = (r, k) => { const i = head.indexOf(k); return i >= 0 ? String(r[i]).trim() : ''; };
      if (head.indexOf('stock') < 0 && head.indexOf('qty') < 0) return [];
      return rows.slice(1).map((r) => ({ code: col(r, 'code') || col(r, 'sku'), qty: Number(col(r, 'stock') || col(r, 'qty')), at })).filter((x) => x.code && Number.isFinite(x.qty));
    },
    async pushOrder(order) {
      fs.mkdirSync(outDir, { recursive: true });
      const f = path.join(outDir, order.chit_id + '.csv');
      const lines = ['chit,buyer,name,code,qty,unit,price,list_price,offer,total'].concat(order.lines.map((l) => [order.chit_id, order.buyer, l.name, l.code || '', l.qty, l.unit, l.price, l.list_price == null ? '' : l.list_price, l.offer ? l.offer.label + ' −' + l.offer.off : '', l.total].map(q).join(',')));
      fs.writeFileSync(f, lines.join('\n') + '\n');
      return { ref: f };
    },
  };
};
