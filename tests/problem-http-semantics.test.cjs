// tests/problem-http-semantics.test.cjs - the status codes mean what RFC 9110 says (API-STANDARD S4, S41).
//   1 a 401 carries the Bearer challenge (RFC 9110 11.6.1) from the one middleware, and a non-401 does not
//   2 a body that is well formed but fails its schema is 422 (15.5.21), with every field named
//   3 a malformed value in the address (a character no text column holds) is 400 (15.5.1)
//   4 a read and an absent id follow the same meanings: not-a-uuid is 404, never a 500
// Offline: no database, no network. Run: node tests/problem-http-semantics.test.cjs
'use strict';
const assert = require('node:assert');
const P = require('../lib/problem');
const V = require('../middleware/validate');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log('  ok  ' + name); pass++; } catch (e) { console.log('  XX  ' + name + ' - ' + e.message); fail++; } };

/** a bare response double: status, headers, the JSON body, and writeHead so the challenge middleware can hook it */
function fakeRes() {
  const res = { headers: {}, locals: {}, code: 200, body: null,
    status(c) { res.code = c; return res; },
    set(k, v) { res.headers[String(k).toLowerCase()] = v; return res; },
    setHeader(k, v) { res.headers[String(k).toLowerCase()] = v; },
    getHeader(k) { return res.headers[String(k).toLowerCase()]; },
    writeHead(c) { res.code = c; },
    json(b) { res.body = b; res.writeHead(res.code); return res; } };
  return res;
}

t('a 401 carries the Bearer challenge; a 404 does not', () => {
  const a = fakeRes(); P.wwwAuthenticate({}, a, () => {});
  P.problem({ id: 'r1' }, a, { status: 401, code: 'UNAUTHORIZED', detail: 'Sign in first.' });
  assert.strictEqual(a.code, 401);
  assert.strictEqual(a.headers['www-authenticate'], P.AUTH_CHALLENGE);
  assert.ok(/^Bearer /.test(P.AUTH_CHALLENGE));
  const b = fakeRes(); P.wwwAuthenticate({}, b, () => {});
  P.problem({ id: 'r2' }, b, { status: 404, code: 'NOT_FOUND', detail: 'Not found.' });
  assert.strictEqual(b.headers['www-authenticate'], undefined);
});

t('well formed but not processable is 422 with the fields named', () => {
  const mw = V.schemaValidate({ requestBody: { content: { 'application/json': { schema: { type: 'object', additionalProperties: false, required: ['qty'], properties: { qty: { type: 'integer', minimum: 1 } } } } } } });
  const res = fakeRes(); let nexted = 0;
  mw({ method: 'POST', body: { qty: 'many' }, query: {}, params: {}, id: 'r3' }, res, () => { nexted++; });
  assert.strictEqual(nexted, 0);
  assert.strictEqual(res.code, 422);
  assert.strictEqual(res.headers['content-type'], 'application/problem+json; charset=utf-8');
  assert.strictEqual(res.body.status, 422);
  assert.ok(res.body.errors && res.body.errors.length >= 1 && res.body.errors[0].field);
});

t('a malformed address value is 400; a clean one passes', () => {
  const guard = P.textParam();
  const res = fakeRes(); let nexted = 0;
  guard({ id: 'r4' }, res, () => { nexted++; }, 'a' + String.fromCharCode(0) + 'b', 'handle');
  assert.strictEqual(res.code, 400);
  assert.strictEqual(nexted, 0);
  guard({ id: 'r5' }, fakeRes(), () => { nexted++; }, 'shop-1', 'handle');
  assert.strictEqual(nexted, 1);
});

t('an id that is no uuid names no row: 404, not a 500', () => {
  const res = fakeRes(); let nexted = 0;
  P.uuidParam({ detail: 'Not found.' })({ id: 'r6' }, res, () => { nexted++; }, 'not-a-uuid');
  assert.strictEqual(res.code, 404);
  assert.strictEqual(nexted, 0);
});

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
