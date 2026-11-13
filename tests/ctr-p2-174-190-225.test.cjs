#!/usr/bin/env node
// @type: contract
/**
 * ctr-p2-174-190-225.test.cjs — three counter doors, each proved on the REAL server.js over a stand-in db (13 Nov 2026, P2 trial-blocking).
 *
 * OWNS      CTR-174 (POST /api/till/shop takes junk email / phone / PIN: refused 400 naming the field), CTR-190 (GET /api/till/quick-keys/screen-config
 *           answers config as an object, always), CTR-225 (GET /api/till/bills reads `page`: distinct pages, the true total, a page past the end).
 * CALLED BY scripts/guards.cjs · CI. No database, no network.
 * FLOW      hand-computed expectation -> real app -> status and body -> table of results
 * MIN       contract - 30 checks; each fails on the main it was cut from.
 * CARD      09-counter/till-api
 * HAND      58 bills, limit 5: page 1 = bills 1-5, page 2 = 6-10 (10 distinct over two pages), page 12 = 56-58 (3 bills), page 13 = 0 bills; total 58 on every page.
 */
'use strict';
const path = require('path');
const http = require('http');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'ctr-p2-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';

const ROOT = path.join(__dirname, '..');
const loader = require(path.join(ROOT, 'tools', 'load-app.cjs'));
const ME = '11111111-1111-4111-8111-111111111111';
const BILLS = 58;
let failed = 0;
let total = 0;
const check = (label, ok, info) => {
  total += 1;
  if (!ok) failed += 1;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label + (ok || info === undefined ? '' : '\n        ' + JSON.stringify(info).slice(0, 400)));
};

/** bill n (1 = newest) as chit_header would hold it */
const billOf = (n) => ({
  chit_id: '00000000-0000-4000-8000-' + String(n).padStart(12, '0'),
  created_at: new Date(Date.UTC(2026, 10, 13, 12, 0, 0) - n * 60000).toISOString(),
  business_json: { bill_no: 'B-' + n, billed_at: new Date(Date.UTC(2026, 10, 13, 12, 0, 0) - n * 60000).toISOString(), till: { id: 'C1' } },
  line_items: [],
  summary_json: { total: n * 100 },
  withdrawn: false
});
const WINDOW = Array.from({ length: BILLS }, (unused, index) => billOf(index + 1));

let storedStyle = { config: -1, updated_at: '2026-11-01T00:00:00Z' };
const answer = (sql, params) => {
  const text = String(sql).replace(/\s+/g, ' ');
  if (/total_rows/.test(text) && /FROM chit_header h/.test(text)) {
    const limit = Number(params[2]);
    const offset = Number(params[5]);
    return { rows: WINDOW.slice(offset, offset + limit).map((row) => Object.assign({}, row, { total_rows: String(BILLS) })), rowCount: 1 };
  }
  if (/FROM device_screen_config/.test(text)) return { rows: storedStyle ? [storedStyle] : [], rowCount: storedStyle ? 1 : 0 };
  if (/SELECT capabilities FROM identities/.test(text)) return { rows: [{ capabilities: ['register'] }], rowCount: 1 };
  if (/FROM identities WHERE identity_id/.test(text)) return { rows: [{ display_name: 'Shop', gstn: null, address: '1 Main Rd', phone: '98765 43210', email: 'shop@example.com', country: 'IN', currency_code: 'INR', policy_flags: {} }], rowCount: 1 };
  if (/information_schema/.test(text)) return { rows: [{ x: 1 }], rowCount: 1 };
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
        resolve({ status: reply.statusCode, raw, json });
      });
    });
    request.on('error', (failure) => resolve({ status: 0, raw: String(failure), json: null }));
    request.end(text);
  });

const JUNK = [
  ['email', 'not-an-email', /e-mail/i],
  ['phone', 'abcdefgh', /phone/i],
  ['phone', '1234567', /phone/i],
  ['pincode', 'abcdef', /PIN/]
];
const FINE = [['email', 'owner@shop.com'], ['phone', '+91 98765 43210'], ['pincode', '560001'], ['pincode', '2000'], ['pincode', 'SW1A 1AA'], ['email', ''], ['phone', '']];

/** CTR-174: the shop header's junk is refused, a good value is not */
async function shopCases(port, token) {
  console.log('CTR-174 · the shop header: a junk e-mail, phone or PIN is refused 400, the field named');
  for (const [field, value, words] of JUNK) {
    const got = await send(port, token, 'POST', '/api/till/shop', { [field]: value });
    check(field + ' ' + JSON.stringify(value) + ' answers 400', got.status === 400, { status: got.status, raw: got.raw.slice(0, 200) });
    check(field + ' ' + JSON.stringify(value) + ' the words name it', words.test(got.raw) && got.raw.includes(field), got.raw.slice(0, 200));
  }
  for (const [field, value] of FINE) {
    const got = await send(port, token, 'POST', '/api/till/shop', { [field]: value });
    check(field + ' ' + JSON.stringify(value) + ' is not refused as junk', got.status !== 400, { status: got.status, raw: got.raw.slice(0, 200) });
  }
}

/** CTR-190: whatever the column holds, config answers an object */
async function styleCases(port, token) {
  console.log('CTR-190 · screen-config: config is an object, always');
  for (const stored of [-1, null, [], 'x', 7, { theme: 'dark' }, undefined]) {
    storedStyle = stored === undefined ? null : { config: stored, updated_at: '2026-11-01T00:00:00Z' };
    const got = await send(port, token, 'GET', '/api/till/quick-keys/screen-config');
    const object = got.json && got.json.config && typeof got.json.config === 'object' && !Array.isArray(got.json.config);
    const hand = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
    check('stored ' + JSON.stringify(stored) + ' answers 200 with config ' + JSON.stringify(hand), got.status === 200 && object && JSON.stringify(got.json.config) === JSON.stringify(hand), got.raw.slice(0, 200));
  }
}

/** CTR-225: the hand-computed pages of a 58-bill window */
async function billCases(port, token) {
  console.log('CTR-225 · bills: page is read, the total is the whole window');
  const pageOf = async (page) => (await send(port, token, 'GET', '/api/till/bills?days=3&limit=5&page=' + page)).json || {};
  const first = await pageOf(1);
  const second = await pageOf(2);
  const nos = (page) => (page.bills || []).map((bill) => bill.no);
  const ids = new Set([].concat((first.bills || []).map((bill) => bill.chit_id), (second.bills || []).map((bill) => bill.chit_id)));
  check('page 1 and 2 answer 10 distinct bills (hand 10)', ids.size === 10, { distinct: ids.size });
  check('page 1 is B-1..B-5 and page 2 is B-6..B-10', nos(first).join() === 'B-1,B-2,B-3,B-4,B-5' && nos(second).join() === 'B-6,B-7,B-8,B-9,B-10', { first: nos(first), second: nos(second) });
  check('page echoes the page asked for (1, 2)', first.page === 1 && second.page === 2, { first: first.page, second: second.page });
  check('total is the window, 58 (not the page size 5)', first.total === BILLS && second.total === BILLS, { first: first.total, second: second.total });
  const last = await pageOf(12);
  check('page 12 answers 3 bills (hand 58 - 55) and total 58', nos(last).join() === 'B-56,B-57,B-58' && last.total === BILLS, { n: nos(last), total: last.total });
  const past = await pageOf(13);
  check('page 13 answers 0 bills, total 58, page 13', Array.isArray(past.bills) && past.bills.length === 0 && past.total === BILLS && past.page === 13, { n: nos(past), total: past.total, page: past.page });
  const bare = (await send(port, token, 'GET', '/api/till/bills?days=3')).json || {};
  check('no page, no limit: the first 100 as before (all 58), total 58, page 1', (bare.bills || []).length === BILLS && bare.total === BILLS && bare.page === 1, { n: (bare.bills || []).length, total: bare.total });
}

(async () => {
  loader.stubDatabase(ROOT, answer);
  const app = loader.loadApp(ROOT);
  const token = require(path.join(ROOT, 'node_modules', 'jsonwebtoken')).sign({ identity_id: ME, identity_type: 'entity', bridge_id: 'CB-P', display_name: 'P', scope: 'till' }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await shopCases(port, token);
  await styleCases(port, token);
  await billCases(port, token);
  server.close();
  console.log(total + ' checks' + (failed ? ', ' + failed + ' FAILED' : ', all ok'));
  process.exit(failed ? 1 : 0);
})();
