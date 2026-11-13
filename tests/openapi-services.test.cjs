/**
 * tests/openapi-services.test.cjs - the public services API tells the truth about itself: /api/openapi.json (routes/openapi.js).
 *   1  the document is OpenAPI 3.0.3, names the five services (offers - pricing - tax - invoice - keys), carries the one Problem schema
 *   2  EVERY real route of offers, pricing, tax, invoice and keys is documented (same method, same path with {param})
 *   3  NOTHING documented under those five is a phantom: each path and method has a real route behind it
 *   4  every operation answers something (has responses); the server url follows PUBLIC_API_BASE, else the request host
 * Offline: the routers are loaded, never listened on; no database, no network.
 * Run: node tests/openapi-services.test.cjs
 * CARD      23-connectors-and-integrations/public-services-api
 * UNIT      23/Public services API
 */
'use strict';
process.env.NODE_ENV = 'test'; process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'; process.env.DATABASE_URL = '';
const assert = require('assert'), path = require('path');
const API = path.join(__dirname, '..');
const O = require(path.join(API, 'routes', 'openapi.js'));
const SERVICES = ['offers', 'pricing', 'tax', 'invoice', 'keys'];

let n = 0;
const ok = (name, cond, why) => { assert.ok(cond, name + (why ? ' - ' + why : '')); n++; console.log('  ok  ' + name); };

delete process.env.PUBLIC_API_BASE;
const doc = O.assemble({ protocol: 'https', get: () => 'api.example.test' });
ok('the document is OpenAPI 3.0.3 and names the five services', doc.openapi === '3.0.3' && JSON.stringify(doc.tags.map((t) => t.name)) === JSON.stringify(SERVICES), JSON.stringify(doc.tags));
ok('the one Problem schema is in components (every refusal points at it)', !!doc.components.schemas.Problem);
ok('the server url is the request host without PUBLIC_API_BASE', doc.servers[0].url === 'https://api.example.test');
process.env.PUBLIC_API_BASE = 'https://api.chitbridge.test';
ok('PUBLIC_API_BASE wins when set', O.assemble({ protocol: 'http', get: () => 'x' }).servers[0].url === 'https://api.chitbridge.test');
delete process.env.PUBLIC_API_BASE;

const documented = new Set();
for (const [p, ops] of Object.entries(doc.paths)) for (const m of Object.keys(ops)) documented.add(m + ' ' + p);
const toDoc = (name, p) => ('/api/' + name + (p === '/' ? '' : p)).replace(/:([A-Za-z_]+)/g, '{$1}');

for (const name of SERVICES) {
  const R = require(path.join(API, 'routes', name + '.js'));
  const real = [];
  for (const l of R.stack) if (l.route) for (const m of Object.keys(l.route.methods)) real.push(m + ' ' + toDoc(name, l.route.path));
  const missing = real.filter((r) => !documented.has(r));
  ok(name + ': every real route is documented (' + real.length + ')', real.length > 0 && missing.length === 0, 'undocumented: ' + missing.join(', '));
  const mine = Object.keys(R.openapi.paths).flatMap((p) => Object.keys(R.openapi.paths[p]).map((m) => m + ' ' + p));
  const phantom = mine.filter((r) => !real.includes(r));
  ok(name + ': nothing documented without a route behind it (' + mine.length + ')', phantom.length === 0, 'phantom: ' + phantom.join(', '));
}
const bare = [...documented].filter((r) => !(doc.paths[r.split(' ')[1]][r.split(' ')[0]] || {}).responses);
ok('every documented operation has responses', bare.length === 0, bare.join(', '));
console.log(n + ' checks');
process.exit(0);
