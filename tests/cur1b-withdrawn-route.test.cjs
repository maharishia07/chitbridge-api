/**
 * tests/cur1b-withdrawn-route.test.cjs · CUR-1b: a withdrawn code reaches the owner as a 422 in words over http, never a 500.
 *
 * OWNS: the answer a route gives when money refuses a withdrawn code: a catalogue price write on a shop whose OWN money is withdrawn (money.stampItem, the call
 *       routes/products.js and routes/combo-templates.js make), the one currency lock door (country-setup.currencyLockRefusal: save, PATCH profile, network-build),
 *       and the setting door (govresolve.currencyRefusal); each through the SAME final handler server.js uses (lib/problem.fromError).
 * CALLED BY: scripts/guards.cjs (node tests/cur1b-withdrawn-route.test.cjs). No database, no browser; a stand-in express app on a free port.
 * FLOW: money refusal -> thrown in a handler -> fromError (lib/knownerr MONEY_REFUSAL_CODES) -> problem+json 422 with the successor in the words.
 * BREAK CASE: with stampPrice answering status 500 for a withdrawn code (engines before v1.93.0) the first route answers 500 and the test fails.
 */
'use strict';
const assert = require('assert');
const http = require('http');
const express = require('express');
const money = require('../lib/money');
const cs = require('../lib/country-setup');
const gov = require('../lib/govresolve');
const { fromError } = require('../lib/problem');

const app = express();
app.use(express.json());
/* the catalogue price write on a shop whose own money is `currency` (what routes/products.js does through money.stampItem) */
app.post('/price/:currency', (req, res, next) => {
  try {
    res.json(money.stampItem({ price: 5 }, req.params.currency));
  } catch (err) {
    next(err);
  }
});
/* the currency lock door every setup writer asks (save, PATCH profile, network-build) */
app.post('/lock/:code', async (req, res, next) => {
  try {
    const held = req.query.held || null;
    res.json({ refusal: await cs.currencyLockRefusal({}, 'entity', req.params.code, { cur: { currency: held, constituted: false, country: { code: 'IN' } } }) });
  } catch (err) {
    next(err);
  }
});
/* the same final handler as server.js:541 */
app.use((err, req, res, next) => fromError(req, res, err, { error: 'Server error', message: 'Something went wrong' }));

function ask(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ port, path, method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      let text = '';
      res.on('data', (chunk) => (text += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text || '{}') }));
    });
    req.on('error', reject);
    req.end('{}');
  });
}

const SUCCESSOR = { BGN: 'EUR', HRK: 'EUR', CUC: 'CUP', SLL: 'SLE', ZWL: 'ZWG', ANG: 'XCG' };
let checks = 0;
const it = async (what, body) => { await body(); checks += 1; console.log('  ok  ' + what); };

const server = app.listen(0, async () => {
  const port = server.address().port;
  try {
    await it('a catalogue price write on a shop whose own money is withdrawn answers 422 in words naming the successor, never 500', async () => {
      for (const code of Object.keys(SUCCESSOR)) {
        const answer = await ask(port, '/price/' + code);
        assert.strictEqual(answer.status, 422, code);
        assert.strictEqual(answer.body.code, 'MONEY_CURRENCY_UNKNOWN', code);
        assert.strictEqual(answer.body.withdrawn, true, code + ': withdrawn travels on the wire');
        assert.ok(JSON.stringify(answer.body).indexOf('replaced by ' + SUCCESSOR[code]) >= 0, code + ' words name ' + SUCCESSOR[code]);
      }
    });
    await it('an unlisted own money on a priced write is refused 422 MONEY_CURRENCY_UNKNOWN (engines #123: stampItem reads decimals(currency) first, which refuses it; was the 500 fault of stampPrice)', async () => {
      const unlisted = await ask(port, '/price/ZZZ');
      assert.strictEqual(unlisted.status, 422);
      assert.strictEqual(unlisted.body.code, 'MONEY_CURRENCY_UNKNOWN');
    });
    await it('the lock door answers a NEW withdrawn money 422 over http, and passes the money the shop already holds', async () => {
      const refused = await ask(port, '/lock/BGN?held=INR');
      assert.strictEqual(refused.status, 422);
      assert.ok(JSON.stringify(refused.body).indexOf('replaced by EUR') >= 0);
      assert.strictEqual((await ask(port, '/lock/BGN?held=BGN')).status, 200, 'the held code is no change');
      assert.strictEqual((await ask(port, '/lock/EUR?held=BGN')).status, 200, 'moving to the successor is allowed by this door (SET-80 then decides on a shop that has traded)');
    });
    await it('the setting door and the document gate say the same sentence (one source)', async () => {
      for (const code of Object.keys(SUCCESSOR)) {
        const setting = await gov.currencyRefusal('no-such-entity', code);
        const document = cs.documentRefusal({ country: 'IN', currency_code: code });
        if (setting.code === 'CURRENCY_NOT_ALLOWED') assert.strictEqual(setting.message, document.message, code);
        assert.ok(document.message.indexOf('replaced by ' + SUCCESSOR[code]) >= 0, code);
      }
    });
    console.log('\n  ' + checks + ' checks');
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
