#!/usr/bin/env node
// @type: contract
/**
 * api-tolerant-doors.test.cjs — S33-T (Athi, 11 Nov 2026, "tolerant by design"): the proofs of the doors listed in docs/contracts/api-hardening-scope.json tolerant_outward whose test is this file.
 *
 * OWNS      per door, over the real route file and the stand-in world (tests/lib/problem-world.cjs): (a) a good body is accepted; (b) the same body plus an unknown key (zz_unknown) answers the same status and body,
 *           and the key is in no statement the route sent to the database and not in the answer (ignored = never stored, never acted on); (c) a JUNK VALUE in a known key is refused 422 in the problem shape.
 * CALLED BY scripts/guards.cjs · CI. No database, no network. tools/api-register.cjs --check refuses a listed door whose test file does not name the route, zz_unknown and problem.
 * FLOW      DOORS table → real route over http → status + body + the SQL parameters seen → checks
 * CARD      28-platform-and-operations/api-standard
 */
'use strict';
const path = require('path');
const express = require('express');
const { harness } = require('./lib/problem-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
process.env.VAULT_ENC_KEY = process.env.VAULT_ENC_KEY || Buffer.alloc(32, 7).toString('base64');
const SHOP = '11111111-1111-4111-8111-111111111111';
const MASK = (text) => String(text).replace(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g, 'UUID').replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g, 'STAMP');
const CANARY = { zz_unknown: 'zz_unknown_canary_value' };

/** one entry per listed door: its mount and route file, the url, a good body, and one junk value in a known key */
const DOORS = [
  { route: 'POST /api/integrations/ask/:handle/stock', mount: '/api/integrations', file: 'routes/integrations.js', url: '/api/integrations/ask/tea-shop/stock', rows: (sql) => (/FROM identities WHERE .user_id/.test(sql) ? { rows: [{ identity_id: SHOP }], rowCount: 1 } : /catalogue_visibility/.test(sql) ? { rows: [{ catalogue_visibility: 'public', plan: 'free', bridge_id: 'tea-shop', business_status: 'active' }], rowCount: 1 } : null), good: { codes: ['A1', 'B2'] }, junk: { codes: 'not-a-list' } },
  { route: 'POST /api/integrations/heartbeat', mount: '/api/integrations', file: 'routes/integrations.js', url: '/api/integrations/heartbeat', good: { id: 'kit-1', name: 'tally', host: 'PC1', streams: ['sales'] }, junk: { streams: 'sales' } },
  { route: 'POST /api/integrations/profile', mount: '/api/integrations', file: 'routes/integrations.js', url: '/api/integrations/profile', good: { source: 'tally', fields: { legal_name: 'Tea Shop' } }, junk: { fields: 'not-an-object' } },
  { route: 'PATCH /api/products/:id', mount: '/api/products', file: 'routes/products.js', url: '/api/products/33333333-3333-4333-8333-333333333333', rows: (sql) => (/catalogue_items/.test(sql) ? { rows: [{ item_id: '33333333-3333-4333-8333-333333333333', entity_id: SHOP, item_data: { name: 'Tea' }, is_active: true, updated_at: '2026-11-01T00:00:00Z' }], rowCount: 1 } : null), good: { item_data: { name: 'Tea 250g' }, merge: true }, junk: { merge: 'maybe' } },
  { route: 'POST /api/products/availability/bulk', mount: '/api/products', file: 'routes/products.js', url: '/api/products/availability/bulk', good: { items: [{ code: 'A1', qty: 3 }] }, junk: { items: 'not-a-list' } }
];

/** the catalogue doors decided STRICT (S33-T): only our web page and the till call them, so an unknown top-level key is refused by name (400, problem shape) */
const STRICT_DOORS = [
  { route: 'POST /api/products/bulk', url: '/api/products/bulk', body: { items: [{}] } },
  { route: 'POST /api/products/import/preflight', url: '/api/products/import/preflight', body: { csv: 'name,price' } },
  { route: 'POST /api/products/import', url: '/api/products/import', body: { csv: 'name,price', decisions: [], confirm: true } }
];

const lab = harness({ here: HERE, mounts: [...new Set(DOORS.map((door) => door.mount))], routeFiles: Object.fromEntries(DOORS.map((door) => [door.mount, door.file])), legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json') });
const { world, check } = lab;

(async () => {
  lab.installStubs();
  const app = express();
  app.use((req, res, next) => { req.id = 'req-test'; next(); });
  app.use(express.json());
  [...new Set(DOORS.map((door) => door.mount + '|' + door.file))].forEach((pair) => app.use(pair.split('|')[0], require(path.join(HERE, pair.split('|')[1]))));
  const server = app.listen(0);
  const port = server.address().port;
  try {
    for (const door of DOORS) {
      const method = door.route.split(' ')[0];
      const seen = [];
      const run = async (body) => {
        seen.length = 0;
        Object.assign(world, { realAuth: false, asKey: false, db: 'ok', sqlRows: (sql, params) => { seen.push(JSON.stringify(params || [])); return door.rows ? door.rows(sql) : null; } });
        return lab.send(port, method, door.url, body);
      };
      const plain = await run(door.good);
      check(door.route + ': a good body is accepted (not a 4xx/5xx)', plain.status > 0 && plain.status < 400, [plain.status, plain.json]);
      const extra = await run(Object.assign({}, door.good, CANARY));
      check(door.route + ': an unknown key (zz_unknown) is ignored: same status and answer', extra.status === plain.status && MASK(JSON.stringify(extra.json)) === MASK(JSON.stringify(plain.json)), [extra.status, extra.json, plain.json]);
      check(door.route + ': the unknown key reached no database statement and is not in the answer', !seen.some((text) => text.includes('zz_unknown')) && !extra.text.includes('zz_unknown'), seen);
      const bad = await run(Object.assign({}, door.good, door.junk));
      check(door.route + ': a junk value in a known key is refused (400 or 422, the status the route has always used) in the problem shape', [400, 422].includes(bad.status) && /application\/problem\+json/.test(bad.type) && bad.json && bad.json.code && bad.json.status === bad.status, [bad.status, bad.type, bad.json]);
    }
    for (const door of STRICT_DOORS) {
      Object.assign(world, { realAuth: false, asKey: false, db: 'ok', sqlRows: null });
      const refused = await lab.send(port, 'POST', door.url, Object.assign({}, door.body, CANARY));
      check(door.route + ': STRICT, an unknown key (zz_unknown) is refused 400 in the problem shape and the key is named', refused.status === 400 && String(refused.type).includes('application/problem+json') && refused.json && refused.json.field === 'zz_unknown', [refused.status, refused.type, refused.json]);
    }
  } finally {
    server.close();
  }
  console.log('\n' + lab.count.passed + ' passed, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})();
