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
const crypto = require('crypto');
const express = require('express');
const { harness } = require('./lib/problem-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
process.env.VAULT_ENC_KEY = process.env.VAULT_ENC_KEY || Buffer.alloc(32, 7).toString('base64');
const SHOP = '11111111-1111-4111-8111-111111111111';
const MASK = (text) => String(text).replace(/"ticket":"[^"]+"/g, '"ticket":"T"').replace(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g, 'UUID').replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g, 'STAMP');
const WA_SECRET = 'wa-secret-test';
const MAIL_SECRET = 'mail-secret-test';
process.env.WHATSAPP_APP_SECRET = WA_SECRET;
process.env.EMAIL_INBOUND_SECRET = MAIL_SECRET;
const hmac = (secret, text) => crypto.createHmac('sha256', secret).update(text).digest('hex');
/** a provider's delivery: the exact bytes, signed over those bytes (not JSON-parsed by the test app: the route reads the raw body) */
const signedBy = (secret, header, prefix) => (body) => { const text = JSON.stringify(body); return { headers: { 'content-type': 'application/octet-stream', [header]: prefix + hmac(secret, text) }, text }; };
/** a peer's refusal is a 400 in the problem shape, never a 422 (RAIL-126: a peer is never sent a 422) */
const refusedAsPeer = (res) => res.status === 400 && /application\/problem\+json/.test(res.type) && !!res.json && !!res.json.code && res.json.status === 400;
const ANY_ANSWER = (res) => res.status > 0 && res.status < 600;
const CANARY = { zz_unknown: 'zz_unknown_canary_value' };

/** one entry per listed door: its mount and route file, the url, a good body, and one junk value in a known key */
const DOORS = [
  { route: 'PATCH /api/products/:id', mount: '/api/products', file: 'routes/products.js', url: '/api/products/33333333-3333-4333-8333-333333333333', rows: (sql) => (/catalogue_items/.test(sql) ? { rows: [{ item_id: '33333333-3333-4333-8333-333333333333', entity_id: SHOP, item_data: { name: 'Tea' }, is_active: true, updated_at: '2026-11-01T00:00:00Z' }], rowCount: 1 } : null), good: { item_data: { name: 'Tea 250g' }, merge: true }, junk: { merge: 'maybe' } },
  { route: 'POST /api/products/availability/bulk', mount: '/api/products', file: 'routes/products.js', url: '/api/products/availability/bulk', good: { items: [{ code: 'A1', qty: 3 }] }, junk: { items: 'not-a-list' } }
];

/** the catalogue doors decided STRICT (S33-T): only our web page and the till call them, so an unknown top-level key is refused by name (400, problem shape) */
const STRICT_DOORS = [
  { route: 'POST /api/products/bulk', url: '/api/products/bulk', body: { items: [{}] } },
  { route: 'POST /api/products/import/preflight', url: '/api/products/import/preflight', body: { csv: 'name,price' } },
  { route: 'POST /api/products/import', url: '/api/products/import', body: { csv: 'name,price', decisions: [], confirm: true } },
  { route: 'POST /api/integrations/heartbeat', junkMore: [{ counters: { products_ok: 'many' } }, { counters: Object.fromEntries(Array.from({ length: 25 }, (unused, index) => ['counter_' + String.fromCharCode(97 + index), index])) }, { counters: { 'Bad Name': 1 } }, { counters: [1, 2] }], mount: '/api/integrations', file: 'routes/integrations.js', url: '/api/integrations/heartbeat', good: { id: 'kit-1', name: 'tally', host: 'PC1', streams: ['sales'] }, junk: { streams: 'sales' } },
  { route: 'POST /api/integrations/profile', mount: '/api/integrations', file: 'routes/integrations.js', url: '/api/integrations/profile', good: { source: 'tally', fields: { legal_name: 'Tea Shop' } }, junk: { fields: 'not-an-object' } },
  { route: 'POST /api/events/ticket', mount: '/api/events', file: 'routes/events.js', url: '/api/events/ticket', good: {}, junk: null },
  { route: 'POST /api/capture/webhook/whatsapp', mount: '/api/capture', file: 'routes/capture.js', url: '/api/capture/webhook/whatsapp', raw: signedBy(WA_SECRET, 'x-hub-signature-256', 'sha256='), good: { object: 'whatsapp_business_account', entry: [{ id: '1', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '15550001111' }, messages: [] } }] }] }, junk: { entry: 'not-a-list' }, junkMore: [{ object: 7 }] },
  { route: 'POST /api/capture/webhook/email', mount: '/api/capture', file: 'routes/capture.js', url: '/api/capture/webhook/email', raw: signedBy(MAIL_SECRET, 'x-inbound-signature', ''), good: { to: 'shop@in.example.com', from: 'a@example.com', subject: 'Order', text: 'ten kg rice' }, junk: { subject: { a: 1 } } },
  { route: 'POST /api/ctp/deliver', mount: '/api/ctp', file: 'routes/ctp.js', url: '/api/ctp/deliver', accept: ANY_ANSWER, refused: refusedAsPeer, good: { ctp: '1', to: { bridge_id: 'CBBBBBBBBB' }, from: { installation_key: 'peer-1' } }, junk: { to: 'CBBBBBBBBB' } },
  { route: 'POST /api/ctp/query', mount: '/api/ctp', file: 'routes/ctp.js', url: '/api/ctp/query', accept: ANY_ANSWER, refused: refusedAsPeer, good: { ctp: '1', kind: 'query', from: { installation_key: 'peer-1' }, ask: { want: 'resolve' } }, junk: { ask: 'resolve' } }
];

const lab = harness({ here: HERE, mounts: [...new Set(DOORS.map((door) => door.mount))], routeFiles: Object.fromEntries(DOORS.map((door) => [door.mount, door.file])), legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json') });
const { world, check } = lab;

(async () => {
  lab.installStubs();
  const app = express();
  app.use((req, res, next) => { req.id = 'req-test'; next(); });
  [...new Set(DOORS.filter((door) => door.raw).map((door) => door.mount + '|' + door.file))].forEach((pair) => app.use(pair.split('|')[0], require(path.join(HERE, pair.split('|')[1])))); /* a signed delivery is read as raw bytes: its router sits before the JSON parser */
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
        return door.raw ? lab.send(port, method, door.url, undefined, door.raw(body)) : lab.send(port, method, door.url, body);
      };
      const plain = await run(door.good);
      check(door.route + ': a good body is accepted (not a 4xx/5xx)', (door.accept || ((res) => res.status > 0 && res.status < 400))(plain), [plain.status, plain.json]);
      const extra = await run(Object.assign({}, door.good, CANARY));
      check(door.route + ': an unknown key (zz_unknown) is ignored: same status and answer', extra.status === plain.status && MASK(JSON.stringify(extra.json)) === MASK(JSON.stringify(plain.json)), [extra.status, extra.json, plain.json]);
      check(door.route + ': the unknown key reached no database statement and is not in the answer', !seen.some((text) => text.includes('zz_unknown')) && !extra.text.includes('zz_unknown'), seen);
      const junks = (door.junk ? [door.junk] : []).concat(door.junkMore || []);
      for (const junk of junks) {
        const bad = await run(Object.assign({}, door.good, junk));
        const refused = door.refused || ((res) => [400, 422].includes(res.status) && /application\/problem\+json/.test(res.type) && !!res.json && !!res.json.code && res.json.status === res.status);
        check(door.route + ': a junk value in a known key is refused (400 or 422, the status the route has always used) in the problem shape: ' + JSON.stringify(junk).slice(0, 60), !!refused(bad), [bad.status, bad.type, bad.json]);
      }
      if (!junks.length) check(door.route + ': reads no body key, so no known key can hold a junk value (the answer above is the same with any key)', true);
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
