#!/usr/bin/env node
// @type: contract
/**
 * body-shape-and-range.test.cjs — cluster body-shape-and-range-blocks (12 Nov 2026): a body field of the wrong type or out of range (a list, an object, a number for a name, a 10k list,
 * a negative line, a number flag that is null) is refused in words (400/422 in the one error shape), never a 500, never stored as junk.
 *
 * OWNS      one proving case per closed line (CAT-329 CAT-335 CTR-174 CTR-240 SEC-154 SET-70 AI-36 API-27 API-26), through the REAL server.js over a stand-in db.
 * CALLED BY scripts/guards.cjs · CI. No database, no network.
 * FLOW      case (line, method, url, body) -> real app -> status . problem+json . code . the words name the field -> table of results
 * MIN       contract - 16 cases; each fails on main.
 * CARD      28-platform-and-operations/api-standard
 * ADD A ROW when another door is found taking a junk body: [line, method, url, body, status, words].
 */
'use strict';
const path = require('path');
const http = require('http');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'path-id-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';

const ROOT = path.join(__dirname, '..');
const loader = require(path.join(ROOT, 'tools', 'load-app.cjs'));
const ME = '11111111-1111-4111-8111-111111111111';
const GOOD = '33333333-3333-4333-8333-333333333333';
const NUL = String.fromCharCode(0);
const JUNK = new Set(['abc', 'zzz', 'x', '-1', '0', '0.5', 'true', '2026-02-30', '/etc/passwd', 'y'.repeat(3000)]);
const isJunk = (value) => (Array.isArray(value) ? value.some(isJunk) : typeof value === 'string' && JUNK.has(value));
const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value));
const DRIVER = /invalid input syntax|invalid byte sequence|22P02|22021/;

let failed = 0;
let total = 0;
const check = (label, ok, info) => {
  total += 1;
  if (!ok) failed += 1;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label + (ok || info === undefined ? '' : '\n        ' + JSON.stringify(info).slice(0, 500)));
};

/** the stand-in world: a shop that exists, with the register, the books, the country and a chit it holds; a junk id where an id goes is Postgres's own refusal */
const answer = (sql, params) => {
  const text = String(sql).replace(/\s+/g, ' ');
  for (const given of params) {
    if (typeof given === 'string' && given.includes(NUL)) throw Object.assign(new Error('invalid byte sequence for encoding "UTF8": 0x00'), { code: '22021' });
    if (isJunk(given)) throw Object.assign(new Error('invalid input syntax for type uuid: "' + String(given).slice(0, 20) + '"'), { code: '22P02' });
  }
  if (/SELECT capabilities FROM identities/.test(text)) return { rows: [{ capabilities: ['register'] }], rowCount: 1 };
  if (/FROM entity_governance WHERE entity_id/.test(text)) return { rows: [{ fy_start_month: 4, tax_registration: 'registered', setup_source: 'owner', country_setup_at: '2026-04-01T00:00:00Z' }], rowCount: 1 };
  if (/country-setup/.test(text)) return { rows: [{ country: 'IN', currency_code: 'INR', gstn: '29ABCDE1234F1Z5', timezone: 'Asia/Kolkata', policy_flag: null }], rowCount: 1 };
  if (/s\.enabled, s\.walkin_grain/.test(text)) return { rows: [{ entity_id: ME, enabled: true, walkin_grain: 'day', fy_start_month: 4, functional_currency: 'INR', country: 'IN', pack_version: '1', last_check: null }], rowCount: 1 };
  if (/information_schema/.test(text)) return { rows: [{ x: 1 }], rowCount: 1 };
  if (/all_recipients FROM chit_header/.test(text)) return { rows: [{ all_recipients: [] }], rowCount: 1 };
  if (/SELECT 1 FROM chit_header WHERE chit_id = \$1 AND entity_id/.test(text)) return { rows: [{ x: 1 }], rowCount: 1 };
  if (/FROM identities WHERE identity_id/.test(text)) return { rows: [{ currency_code: 'INR', country: 'IN', gstn: '29ABCDE1234F1Z5', policy_flag: null }], rowCount: 1 };
  if (/UPDATE catalogue_items AS c/.test(text)) {
    const ids = (params[0] || []).filter(isUuid);
    return { rows: ids.slice(0, 1).map((id) => ({ item_id: id, item_data: { name: 'Tea' } })), rowCount: Math.min(ids.length, 1) };
  }
  return { rows: [], rowCount: 0 };
};

const send = (port, token, method, url, body) =>
  new Promise((resolve) => {
    const text = body === undefined ? '' : JSON.stringify(body);
    const request = http.request({ host: '127.0.0.1', port, method, path: url, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) } }, (reply) => {
      let raw = '';
      reply.on('data', (part) => (raw += part));
      reply.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(raw);
        } catch (failure) {
          json = null;
        }
        resolve({ status: reply.statusCode, type: String(reply.headers['content-type'] || ''), raw, json });
      });
    });
    request.on('error', (failure) => resolve({ status: 0, type: '', raw: String(failure), json: null }));
    request.end(text);
  });

const CASES = [
  ['CAT-329', 'POST', '/api/pricing/price', { lines: [null, 7, 'x'] }, [400], /not a line/i],
  ['CAT-335', 'POST', '/api/catalogue/photo-extract', { images: Array(10000).fill('x') }, [400], /images/],
  ['CTR-174', 'POST', '/api/till/shop', { legal_name: -1, address: -1 }, [400], null],
  ['CTR-240', 'PUT', '/api/quick-keys/screen-config/default', { config: '12abc' }, [400], /config/],
  ['SEC-154', 'POST', '/api/signin/verify', { pin: ['1234'], email: 'a@b.c' }, [400], /pin/],
  ['SEC-154', 'POST', '/api/signin/verify', { otp: ['123456'], email: 'a@b.c' }, [400], /otp/],
  ['SEC-154', 'POST', '/api/entities/verify', { email: ['a@b'] }, [400], /email/],
  ['SET-70', 'PATCH', '/api/entities/policy', { tol_weight_bp: null }, [400], /needs a number/],
  ['SET-70', 'PATCH', '/api/entities/policy', { tol_weight_bp: true }, [400], /needs a number/],
  ['AI-36', 'POST', '/api/assist/catalogue-adopt', { visible: 1e21 }, [422], /visible/],
  ['API-27', 'POST', '/api/quick-keys/groups', { name: 1e21 }, [400], /name/],
  ['API-26', 'POST', '/api/till/state', { state: [] }, [400], /state/]
];
(async () => {
  loader.stubDatabase(ROOT, answer);
  const app = loader.loadApp(ROOT);
  const token = require(path.join(ROOT, 'node_modules', 'jsonwebtoken')).sign({ identity_id: ME, identity_type: 'entity', bridge_id: 'CB-P', display_name: 'P', scope: 'till' }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  for (const [line, method, url, body, status, words] of CASES) {
    const got = await send(port, token, method, url, body);
    const label = line + ' ' + method + ' ' + url.slice(0, 60) + ': ';
    check(label + 'answers ' + status.join('/'), status.includes(got.status), { status: got.status, raw: got.raw.slice(0, 300) });
    check(label + 'is the one error shape (problem+json, a code, a request id)', /application\/problem\+json/.test(got.type) && !!got.json && typeof got.json.code === 'string' && !!got.json.request_id, { type: got.type, json: got.json });
    if (words) check(label + 'the words name it ' + words, words.test(got.raw), got.raw.slice(0, 300));
  }
  server.close();
  console.log(total + ' checks' + (failed ? ', ' + failed + ' FAILED' : ', all ok'));
  process.exit(failed ? 1 : 0);
})();
