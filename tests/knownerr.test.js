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
  const cat = fs.readFileSync(path.join(API, 'routes', 'catalogue.js'), 'utf8');
  let from = 0, n = 0;
  for (;;) { const g = cat.indexOf("res.status(500).json({ error: 'Order failed'", from); if (g < 0) break; n++;
    const k = cat.lastIndexOf("knownerr').known(err)", g);
    assert.ok(k > 0 && g - k < 600, 'routes/catalogue.js line ' + cat.slice(0, g).split('\n').length + ' answers "Order failed" without asking lib/knownerr first');
    from = g + 10; }
  assert.ok(n >= 2, 'expected both storefront order routes, found ' + n);
  at('server.js', "res.status(500).json({ error: 'Server error'");
});
console.log(pass + ' checks');
