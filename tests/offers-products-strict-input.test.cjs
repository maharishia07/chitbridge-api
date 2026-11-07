#!/usr/bin/env node
// @type: contract
/**
 * offers-products-strict-input.test.cjs — S33 strict input, products and network offers: a closed write body refuses an unknown key by name and still takes every body a caller sends.
 *
 * OWNS      the proof for the routes this sweep closed (API-30 bulk pass, 6 Nov 2026): (1) an unknown key is refused (400 or 422, the route's own refusal) with the field named ·
 *           (2) the bodies the web, the till and the toolset send are still accepted by the route's own schema check · (3) every key the handler reads from its body is declared.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the app is loaded offline and the route's schema check (middleware/validate.js schemaValidate) runs alone.
 * FLOW      tools/load-app.cjs → the route's operation (its own schema check, with its own refusal words) → a body → accepted, or refused with the field named
 * CARD      28-platform-and-operations/api-standard
 * Pass 2 (7 Nov 2026) closed the routes API-30 left open for their keyed callers (products bulk · availability/bulk · import · preflight · PATCH /:id) and the two books ＋ Entry doors (POST /events · /preview); the bodies each real caller sends are replayed below.
 * What it cannot see (each stays a review question): a key read through a computed name; a body handed to another function; nested keys.
 *
 *   node tests/offers-products-strict-input.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'tools', 'load-app.cjs')).loadApp(ROOT);
const register = require(path.join(ROOT, 'tools', 'api-register.cjs'));
const { schemaValidate, bodySchemaOf } = require(path.join(ROOT, 'middleware', 'validate'));

const OPERATIONS = register.operationsOfApp();
const UUID = '11111111-1111-4111-8111-111111111111';
/** [route, the file its handler is in, [bodies a real caller sends]] */
const CASES = [
  ['POST /api/products', 'routes/products.js', [{ item_data: { name: 'Tea' } }]],
  ['POST /api/products/status/bulk', 'routes/products.js', [{ ids: [UUID], status: 'available' }]],
  ['POST /api/products/bulk-update', 'routes/products.js', [{ items: [{ id: UUID, item_data: { name: 'x' } }] }]],
  ['POST /api/products/starter-columns', 'routes/products.js', [{ vertical: 'kirana' }, { vertical: 'kirana', fields: [], custom: [] }]],
  ['POST /api/products/:id/schedule', 'routes/products.js', [{ effective_at: '2026-12-01', item_data: { price: 5 } }]],
  ['PUT /api/products/:id/availability', 'routes/products.js', [{ qty: 4, source: 'count' }, { qty: 2, as_of: '2026-11-01', location: 'main' }]],
  ['PUT /api/products/:id/status', 'routes/products.js', [{ status: 'available' }, { status: 'unavailable', until: '2026-12-01', note: 'n' }, { status: 'redundant', replaced_by: UUID }]],
  ['POST /api/products/:id/media', 'routes/products.js', [{ name: 'a.png', mime: 'image/png', data_base64: 'AAAA' }, { url: 'https://youtu.be/x' }]],
  ['POST /api/products/lists/adopt', 'routes/products.js', [{ list: 'kirana', names: [], languages: ['en'], status: 'unavailable' }, { list: 'k', categories: [], skip_existing: true }]],
  /* pass 2 (7 Nov): the five keyed routes that stayed open, closed after every caller's keys were read — web cap-catalogue (_cfBody, prodImport, prodEdit), cap-categories, app.html prodEdit, till.html upBody + commit,
     the Tally connector (core.js addProducts/stock/editProduct), tools/seed/load.cjs, e2e specs (items; csv + decisions + confirm) */
  ['POST /api/products/bulk', 'routes/products.js', [{ items: [{ name: 'Tea', price: 5 }] }]],
  ['POST /api/products/availability/bulk', 'routes/products.js', [{ items: [{ code: 'BAS-25', qty: 3, source: 'erp', as_of: '2026-11-07T00:00:00Z' }] }]],
  ['POST /api/products/import/preflight', 'routes/products.js', [{ csv: 'name,price\nTea,5' }, { xlsx: 'AAAA' }, { csv: 'a', header_row: 2 }, { xlsx: 'AAAA', sheet: 'Products', header_row: 3 }]],
  ['POST /api/products/import', 'routes/products.js', [{ csv: 'name,price\nTea,5', decisions: [], confirm: true }, { xlsx: 'AAAA', header_row: 2, decisions: [{ incoming: 'price', use: 'price' }], confirm: true }]],
  ['PATCH /api/products/:id', 'routes/products.js', [{ item_data: { name: 'x' } }, { item_data: { exposure: null }, merge: true }]],
  /* pass 2, books: the ＋ Entry door's bodies, as cap-entry enBody builds them (expense · other_income · contra · debit note · journal) */
  ['POST /api/books/preview', 'routes/books.js', [
    { event: 'expense', class: 'rent', amount_minor: 5000, paid_from: 'cash', date: '2026-11-07', narration: 'Rent' },
    { event: 'expense', class: 'rent', amount_minor: 5000, paid_by: 'cheque', cheque_no: '12', cheque_date: '2026-11-08', paid_from: 'bank' },
    { event: 'other_income', class: 'interest', amount_minor: 100, into: 'bank', date: '2026-11-07', narration: 'Bank statement' },
    { event: 'contra', from: 'cash', to: 'bank', amount_minor: 100 },
    { event: 'debit_note', supplier: UUID, against_ref: 'B1', reason: 'rate', lines: [{ name: 'x', qty: 1, rate: 5 }], party: UUID },
    { event: 'journal', lines: [{ code: '1000', dr_minor: 1 }, { code: '2000', cr_minor: 1 }], narration: 'adj', date: '2026-11-07' },
    { event: { kind: 'expense', class: 'rent', amount: 50 }, how: 'cash' }
  ]],
  ['POST /api/books/events', 'routes/books.js', [
    { event: 'expense', class: 'rent', amount_minor: 5000, paid_from: 'cash', client_ref: 'r1', attachment: { name: 'a.jpg' } },
    { event: 'debit_note', supplier: UUID, against_ref: 'B1', lines: [{ gst_rate: 5 }], supplier_gstin: '29ABCDE1234F1Z5', my_gstin: '27ABCDE1234F1Z5', place_of_supply: '27', client_ref: 'r2' },
    { event: 'journal', lines: [], narration: 'x', client_ref: 'r3' }
  ]],
  ['PUT /api/network-offers/policy', 'routes/network-offers.js', [{ policy: 'opt_in' }]],
  ['POST /api/network-offers/catalogue/publish', 'routes/network-offers.js', [{ source_key: 'k', at: 'now', add: ['a'], withdraw: [], withdraw_at: 'x', restore_at: 'y' }]],
  ['POST /api/network-offers/catalogue/cancel', 'routes/network-offers.js', [{ source_key: 'k' }]],
  ['POST /api/network-offers/catalogue/price', 'routes/network-offers.js', [{ source_key: 'k', name: 'n', key: 'x', choice: 'use' }]],
  ['POST /api/network-offers/:id/release', 'routes/network-offers.js', [{}, { at: 'now' }, { at: 'x', until: 'y' }]],
  ['POST /api/network-offers/:id/withdraw', 'routes/network-offers.js', [{}, { at: 'now' }]],
  ['POST /api/network-offers/:id/choice', 'routes/network-offers.js', [{ choice: 'in' }, { choice: null }]]
];
const IGNORED_READS = new Set(['length', 'map', 'filter', 'slice', 'trim', 'toString', 'forEach', 'some', 'every', 'join', 'split', 'includes', 'hasOwnProperty']);
let pass = 0;
let fail = 0;
const ok = (name, cond, why) => {
  if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); }
};

/** what the route's schema check does with a body: { status: 200 } when it lets it on, else the refusal's status and json */
function answerTo(operation, body, route) {
  let out = { status: 200 };
  const params = {};
  (route.match(/:[A-Za-z_]+/g) || []).forEach((name) => { params[name.slice(1)] = UUID; });
  const res = {
    statusCode: 200, locals: {}, set() { return this; }, setHeader() {}, getHeader() {}, type() { return this; }, end() { return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { out = { status: this.statusCode, json: value }; return this; },
    send(value) { out = { status: this.statusCode, json: value }; return this; }
  };
  const req = { body, query: {}, params, headers: {}, id: 'test', method: route.split(' ')[0], originalUrl: route.split(' ')[1], get() { return ''; } };
  schemaValidate(operation)(req, res, () => { out = { status: 200 }; });
  return out;
}
const lines = {};
const linesOf = (file) => (lines[file] = lines[file] || fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n'));

for (const [route, file, bodies] of CASES) {
  const operation = OPERATIONS[route];
  ok(route + ': the route has a body schema', !!(operation && bodySchemaOf(operation)));
  if (!operation || !bodySchemaOf(operation)) continue;
  ok(route + ': the body is closed (additionalProperties false)', bodySchemaOf(operation).additionalProperties === false);
  const refused = answerTo(operation, Object.assign({}, bodies[0], { zz_unknown_field: 1 }), route);
  ok(route + ': an unknown key is refused (400/422) and named', (refused.status === 400 || refused.status === 422) && JSON.stringify(refused.json).includes('zz_unknown_field'), JSON.stringify(refused));
  const bad = bodies.map((body) => answerTo(operation, body, route)).filter((got) => got.status !== 200);
  ok(route + ': ' + bodies.length + ' real caller body(ies) still accepted', !bad.length, JSON.stringify(bad));
  /* every key the handler reads is declared */
  const [method, apiPath] = route.split(' ');
  const L = linesOf(file);
  const tail = apiPath.split('/').filter(Boolean);
  let at = -1;
  for (let k = 0; k <= tail.length && at < 0; k++) {
    const sub = '/' + tail.slice(k).join('/');
    at = L.findIndex((l, n) => { const head = 'router.' + method.toLowerCase() + '('; const text = l.startsWith(head) ? (l === head ? L[n + 1] : l) : ''; return !!text && (text.includes("'" + sub + "'") || text.includes('"' + sub + '"')); });
  }
  if (at < 0) { ok(route + ': its handler is found in ' + file, false); continue; }
  let end = at + 1;
  while (end < L.length && !/^\}\);?\s*$/.test(L[end]) && !/^router\./.test(L[end])) end++;
  const text = L.slice(at, end).join('\n');
  const aliases = new Set(['req.body']);
  for (const m of text.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*\(?req\.body\b/g)) aliases.add(m[1]);
  const read = new Set();
  for (const al of aliases) for (const m of text.matchAll(new RegExp(String.raw`(?<![\w.$])` + al.replace('.', String.raw`\.`) + String.raw`\??\.([A-Za-z_]\w*)`, 'g'))) read.add(m[1]);
  for (const m of text.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:req\.body|(\w+))/g)) {
    if (m[2] && !aliases.has(m[2])) continue;
    m[1].split(',').forEach((s) => { const n = s.trim().split(/[:=\s]/)[0]; if (n && !n.startsWith('...')) read.add(n); });
  }
  const declared = new Set(Object.keys(bodySchemaOf(operation).properties || {}));
  const missing = [...read].filter((k) => !IGNORED_READS.has(k) && !declared.has(k));
  ok(route + ': every key its handler reads is declared (' + read.size + ' read)', !missing.length, 'read but not declared: ' + missing.join(', '));
}
console.log('\n  ' + (fail ? '✗ ' + fail + ' failed' : '✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks');
process.exit(fail ? 1 : 0);
