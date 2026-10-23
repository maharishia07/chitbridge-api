'use strict';
/**
 * tests/knownerr.test.js — a refusal the database makes on purpose reaches a person as one (external review §23).
 *
 * No route calls next(err), so server.js's translation of b247's population boundary never ran and the refusal came
 * out as "Send failed". lib/knownerr.known() is now asked by the routes that actually catch the error.
 */
const assert = require('assert'), fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');
const K = require(path.join(API, 'lib', 'knownerr'));
let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

it('⭐ the population boundary answers 409, in words', () => {
  const r = K.known(Object.assign(new Error('b247: a test entity cannot trade with a production entity'), { code: '23514' }));
  assert.strictEqual(r && r.status, 409);
  assert.strictEqual(r.body.code, 'POPULATION_BOUNDARY');
  assert.ok(/cannot trade/.test(r.body.message));
});
it('⚠️ any OTHER check constraint is left alone — "cannot trade" on a tax-slab violation would be worse than nothing', () => {
  assert.strictEqual(K.known(Object.assign(new Error('new row violates check constraint "rate_nonneg"'), { code: '23514' })), null);
  assert.strictEqual(K.known(new Error('anything else')), null);
  assert.strictEqual(K.known(null), null);
});
it('⭐⭐ every route that writes a chit asks it BEFORE its generic 500 — and so does the global handler', () => {
  const at = (file, generic) => {
    const s = fs.readFileSync(path.join(API, file), 'utf8');
    const g = s.indexOf(generic); assert.ok(g > 0, file + ': the generic failure line moved — "' + generic + '"');
    const k = s.lastIndexOf("knownerr').known(err)", g);
    assert.ok(k > 0 && g - k < 2500, file + ' answers "' + generic + '" without asking lib/knownerr first');   /* server.js keeps its origin check in between */
  };
  at('routes/chits.js', "res.status(500).json({ error: 'Send failed'");
  /* both storefront orders write chits — the single-shop confirm and the network order (deliverEdge) */
  /* API-1 slice 1e: both answer "Order failed" through lib/problem.js fromError, which asks known() first (checked below) */
  const cat = fs.readFileSync(path.join(API, 'routes', 'catalogue.js'), 'utf8');
  const storefrontFailed = require(path.join(API, 'lib', 'storefront-contract')).FAILED;
  ['NETWORK_ORDER', 'ORDER'].forEach((name) => {
    assert.ok(cat.includes('return fromError(req, res, err, storefront.FAILED.' + name + ');'), 'routes/catalogue.js: the ' + name + ' failure no longer answers through fromError');
    assert.strictEqual(storefrontFailed[name].error, 'Order failed', 'lib/storefront-contract.js: FAILED.' + name + ' is not the old "Order failed"');
  });
  assert.ok(!cat.includes("res.status(500).json({ error: 'Order failed'"), 'routes/catalogue.js answers "Order failed" without asking lib/knownerr first');
  /* API-1 slice 1a: the global handler answers through lib/problem.js fromError, which asks known() BEFORE it falls to the generic 500 */
  const handler = fs.readFileSync(path.join(API, 'server.js'), 'utf8');
  assert.ok(handler.includes("fromError(req, res, err, { error: 'Server error'"), 'server.js: the handler no longer answers through fromError');
  const problemSrc = fs.readFileSync(path.join(API, 'lib', 'problem.js'), 'utf8');
  const fromErrorAt = problemSrc.indexOf('function fromError');
  assert.ok(problemSrc.indexOf('known(err)', fromErrorAt) > 0 && problemSrc.indexOf('known(err)', fromErrorAt) < problemSrc.indexOf("code: 'INTERNAL'", fromErrorAt), 'lib/problem.js: fromError must ask knownerr before INTERNAL');
});
it('ORD-65: a refusal THROWN on purpose (refused + 4xx + code) keeps its status, code and words', () => {
  const thrown = Object.assign(new Error('Set the money first.'), { status: 422, code: 'NO_MONEY', title: 'No money', refused: true });
  const answer = K.known(thrown);
  assert.deepStrictEqual(answer, { status: 422, body: { error: 'No money', message: 'Set the money first.', code: 'NO_MONEY' } });
});
it('ORD-65: not a refusal unless it says so: a books refusal with no status, a refused 5xx, a plain 422 are not answered here', () => {
  assert.strictEqual(K.known(Object.assign(new Error('x'), { code: 'BOOKS_REFUSED', refused: true })), null);
  assert.strictEqual(K.known(Object.assign(new Error('x'), { code: 'X', refused: true, status: 500 })), null);
  assert.strictEqual(K.known(Object.assign(new Error('x'), { code: 'X', status: 422 })), null);
});
console.log(pass + ' checks');
