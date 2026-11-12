#!/usr/bin/env node
// @type: contract
/**
 * path-id-guard.test.cjs — API-25 / cluster path-id-not-uuid-blocks (12 Nov 2026): an id that is not a uuid, in the address, the query or the body, is refused in words
 * (404 NOT_FOUND, or 400/422 naming the field), never the database's 22P02 as a 500.
 *
 * OWNS      one proving case per backlog line RAIL-159 RAIL-206 RAIL-209 ORD-78 NET-92 CAT-230 CTR-169 ACC-217 FIN-86 CMP-28, run through the REAL server.js over a stand-in database that
 *           raises Postgres's own errors (22P02 for a junk id, 22021 for a NUL) - so a door that lets one through shows as the 500 it was; plus the router-level proof: every uuid
 *           path parameter of every mounted router has a guard (lib/id-guard.js), and the guard's own units.
 * CALLED BY scripts/guards.cjs · CI. No database, no network.
 * FLOW      case (line, method, url, body) -> real app -> status . problem+json . code . the words name the field . no driver text -> table of results
 * MIN       contract - 36 line cases, the router sweep (a new uuid path param without a guard fails), the unit rows of the guard.
 * CARD      28-platform-and-operations/api-standard
 * ADD A ROW when another door is found answering 500 for a junk id: [line, method, url, body, status, code, words].
 * CMP-28 is already closed on main (routes/forms.js and routes/identity-docs.js guard their ids; tests/k1-path-uuid.test.cjs holds the forms rows): its rows here pin it.
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

/** [line, method, url, body, status, code, words the detail must hold (a RegExp) or null] */
const PROBLEM_BODY = { type_key: [], ref_id: true, ref_label: -1, name: 1e21 };
const UPLOAD = { chit_id: GOOD, name: 'a.txt', mime: 'text/plain', data_base64: 'aGVsbG8=' };
const CASES = [
  ['RAIL-159', 'POST', '/api/chits/register/subjects', PROBLEM_BODY, 422, 'INVALID_INPUT', null],
  ['RAIL-159', 'POST', '/api/chits/register/subjects', { type_key: 'campaign', ref_id: {}, ref_label: 'x', name: 'ok' }, 422, 'INVALID_INPUT', /ref_id/],
  ['RAIL-159', 'POST', '/api/chits/' + GOOD + '/raida/' + GOOD + '/dispute', { dispute_id: 'abc' }, 422, 'INVALID_INPUT', /dispute_id/],
  ['RAIL-206', 'GET', '/api/attachments/abc', undefined, 404, 'NOT_FOUND', null],
  ['RAIL-206', 'GET', '/api/attachments/' + 'y'.repeat(3000), undefined, 404, 'NOT_FOUND', null],
  ['RAIL-206', 'POST', '/api/attachments', Object.assign({}, UPLOAD, { data_base64: '!!!notbase64' }), 422, 'INVALID_INPUT', /data_base64/],
  ['RAIL-209', 'POST', '/api/attachments', Object.assign({}, UPLOAD, { chit_id: 'abc' }), 422, 'INVALID_INPUT', /chit_id/],
  ['RAIL-209', 'POST', '/api/attachments', Object.assign({}, UPLOAD, { line_index: 'abc' }), 422, 'INVALID_INPUT', /line_index/],
  ['ORD-78', 'POST', '/api/chits/' + GOOD + '/assign-lines', { edits: [{ line_id: GOOD, assignee_actor_id: 'abc' }] }, 400, 'CHIT_BAD_REQUEST', /assignee_actor_id/],
  ['ORD-78', 'POST', '/api/chits/' + GOOD + '/assign-lines', { edits: [{ line_id: 'zzz', assignee_actor_id: null }] }, 400, 'CHIT_BAD_REQUEST', /line_id/],
  ['NET-92', 'GET', '/api/catalogue/network-store/%00', undefined, 400, 'INVALID_INPUT', /networkId/],
  ['CAT-230', 'POST', '/api/till/price', { item_id: 'abc', price: 10 }, 404, 'NOT_FOUND', null],
  ['CAT-230', 'POST', '/api/till/stock', { item_id: 'abc', status: 'unavailable' }, 404, 'NOT_FOUND', null],
  ['CAT-230', 'POST', '/api/till/stock/bulk', { item_ids: [GOOD, 'abc'], status: 'unavailable' }, 200, null, /1 could not be found/],
  ['CAT-230', 'PATCH', '/api/products/abc', { item_data: { name: 'Tea' } }, 404, 'NOT_FOUND', null],
  ['CAT-230', 'PUT', '/api/products/abc/availability', { qty: 5 }, 404, 'NOT_FOUND', null],
  ['CTR-169', 'POST', '/api/till/stock', { item_id: GOOD, status: 'unavailable', until: 'tomorrow' }, 400, 'TILL_BAD_REQUEST', /until must be YYYY-MM-DD/],
  ['CTR-169', 'POST', '/api/till/stock', { item_id: GOOD, status: 'available', until: '2026-12-01' }, 400, 'TILL_BAD_REQUEST', /until only applies/],
  ['ACC-217', 'GET', '/api/invoice/abc', undefined, 404, 'NOT_FOUND', null],
  ['ACC-217', 'GET', '/api/tax/invoice/abc', undefined, 404, 'NOT_FOUND', null],
  ['ACC-217', 'POST', '/api/books/accruals/%00/reverse', {}, 400, 'INVALID_INPUT', /ref/],
  ['CMP-28', 'POST', '/api/identity/documents/abc/code', {}, 404, null, null],
  ['CMP-28', 'POST', '/api/identity/documents/%00/verify', {}, [400, 404], null, null],
  ['CMP-28', 'POST', '/api/forms/instances/abc/sign', { name: 'R Kumar' }, 404, 'FORMS_NOT_FOUND', null],
  ['CMP-28', 'GET', '/api/forms/instances/abc', undefined, 404, 'FORMS_NOT_FOUND', null]
];
/* FIN-86: every junk value, both verbs, the party id of the terms door */
['x', '-1', '0', '0.5', 'true', '2026-02-30', '/etc/passwd', 'y'.repeat(3000)].forEach((value) => {
  CASES.push(['FIN-86', 'GET', '/api/books/terms?party_id=' + encodeURIComponent(value), undefined, 404, 'NOT_FOUND', null]);
  CASES.push(['FIN-86', 'POST', '/api/books/terms', { party_id: value, credit_days: 10 }, 404, 'NOT_FOUND', null]);
});

(async () => {
  loader.stubDatabase(ROOT, answer);
  const app = loader.loadApp(ROOT);
  const token = require(path.join(ROOT, 'node_modules', 'jsonwebtoken')).sign({ identity_id: ME, identity_type: 'entity', bridge_id: 'CB-P', display_name: 'P', scope: 'till' }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  for (const [line, method, url, body, status, code, words] of CASES) {
    const got = await send(port, token, method, url, body);
    const label = line + ' ' + method + ' ' + url.slice(0, 60) + ': ';
    const wanted = [].concat(status);
    check(label + 'answers ' + wanted.join('/'), wanted.includes(got.status), { status: got.status, raw: got.raw.slice(0, 300) });
    if (got.status >= 400) check(label + 'is the one error shape (problem+json, a code, a request id)', /application\/problem\+json/.test(got.type) && !!got.json && typeof got.json.code === 'string' && !!got.json.request_id, { type: got.type, json: got.json });
    if (code) check(label + 'code ' + code, !!got.json && got.json.code === code, got.json);
    if (words) check(label + 'the words name it ' + words, words.test(got.raw), got.raw.slice(0, 300));
    check(label + 'no driver text in the answer', !DRIVER.test(got.raw), got.raw.slice(0, 300));
  }

  /* the router sweep: every uuid path parameter of every route has a guard on its router (lib/id-guard.js adds it unless the file guards it itself) */
  const guard = require(path.join(ROOT, 'lib', 'id-guard.js'));
  const unguarded = [];
  loader.leavesOf(app).forEach((leaf) => {
    [...leaf.path.matchAll(/:(\w+)/g)].map((match) => match[1]).filter((name) => guard.UUID_PARAMS.includes(name)).forEach((name) => {
      if (!leaf.router || !leaf.router.params || !(leaf.router.params[name] || []).length) unguarded.push(leaf.method + ' ' + leaf.path + ' :' + name);
    });
  });
  check('API-25 router sweep: every uuid path parameter has a guard (' + unguarded.length + ' without)', unguarded.length === 0, unguarded.slice(0, 10));

  /* the guard's own units */
  const calls = [];
  const fakeRes = { locals: {}, status() { return this; }, set() { return this; }, json(body) { calls.push(body); return this; } };
  guard.idGuard({ id: 'r1' }, fakeRes, () => calls.push('next'), GOOD);
  check('guard: a uuid passes to next()', calls[0] === 'next', calls);
  guard.idGuard({ id: 'r2' }, fakeRes, () => calls.push('next'), 'abc');
  check('guard: a word is a 404 NOT_FOUND problem, next() not called', calls.length === 2 && calls[1].code === 'NOT_FOUND' && calls[1].status === 404, calls);
  const knownerr = require(path.join(ROOT, 'lib', 'knownerr.js'));
  check('backstop: 22P02 on a uuid is a 404, a 22P02 on another type is left alone', knownerr.isNotAUuid({ code: '22P02', message: 'invalid input syntax for type uuid: "a"' }) && !knownerr.isNotAUuid({ code: '22P02', message: 'invalid input syntax for type integer: "a"' }));
  const till = require(path.join(ROOT, 'lib', 'till-contract.js'));
  const uuidFault = Object.assign(new Error('invalid input syntax for type uuid: "abc"'), { code: '22P02' });
  check('till rate door: the same fault from the item lookup is a 404, not a 500', till.failed(uuidFault, { id: 'r3' }).status === 404);
  server.close();
  console.log(total + ' checks' + (failed ? ', ' + failed + ' FAILED' : ', all ok'));
  process.exit(failed ? 1 : 0);
})();
