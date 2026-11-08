/**
 * tests/ctr-227-no-country-bill.test.cjs - CTR-227: A SHOP WITH NO COUNTRY CANNOT BILL (box truth CT-14; rule: never default an unasked fact).
 *
 * OWNS      routes/chits.js sendMoneyStated (the ONE country-and-money gate at the head of SEND_STEPS: every send, counter bill or not, passes it) driven over
 *           http with the real problem writer: a shop whose identities row has country NULL -> 422 NO_COUNTRY in the one sentence (country-setup.DOC_UNSTATED),
 *           in the one problem shape; a country but no money -> 422 NO_MONEY; a draft is the author's own copy and passes; an IN shop passes.
 *           The gate is in the shared path, so there is no per-route check to add: a second refusal in the till or in invoiceAtSend would be a second opinion.
 * CALLED BY scripts/guards.cjs, by hand: node tests/ctr-227-no-country-bill.test.cjs
 * FLOW      POST body -> express -> sendMoneyStated(state, req, res) (db stand-in answers the shop's country) -> 422 problem | 200
 * CARD      counter/bill-slip
 */
'use strict';
const path = require('path'), http = require('http');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
const HERE = path.join(__dirname, '..');
const NONE = '11111111-1111-4111-8111-111111111111', IN_SHOP = '99999999-9999-4999-8999-999999999999', NO_MONEY_SHOP = '55555555-5555-4555-8555-555555555555';
const dbFile = require.resolve(path.join(HERE, 'db'));
const real = require(dbFile);
const FACTS = { [NONE]: { country: null, currency_code: null, timezone: null }, [IN_SHOP]: { country: 'IN', currency_code: 'INR', timezone: 'Asia/Kolkata' }, [NO_MONEY_SHOP]: { country: 'ZZ', currency_code: null, timezone: null } };
require.cache[dbFile].exports = Object.assign({}, real, {
  query: async (sql, params) => (/FROM identities WHERE identity_id/.test(sql) ? { rows: [FACTS[params[0]]], rowCount: 1 } : { rows: [], rowCount: 0 })
});
const express = require('express');
const chits = require(path.join(HERE, 'routes', 'chits.js'));
const CS = require(path.join(HERE, 'lib', 'country-setup'));
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

(async () => {
  console.log('\n== CTR-227 · the country gate over express ==\n');
  ok('routes/chits.js exports the real sendMoneyStated', typeof chits.sendMoneyStated === 'function');
  if (typeof chits.sendMoneyStated !== 'function') { console.log('\n' + pass + ' ok, ' + fail + ' failed'); process.exit(1); }
  const app = express();
  app.use(express.json());
  app.post('/send', async (req, res) => {
    const state = { sender_id: req.body.sender };
    if (await chits.sendMoneyStated(state, req, res)) return;
    if (!res.headersSent) res.json({ message: 'Chit sent successfully' });
  });
  const server = await new Promise((resolve) => { const s = http.createServer(app).listen(0, () => resolve(s)); });
  const url = 'http://127.0.0.1:' + server.address().port + '/send';
  const post = async (body) => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const bill = (sender, extra) => Object.assign({ sender, purpose: 'order', business_json: { bill_no: 'C1-1', till: { id: 'C1' } } }, extra || {});

  let r = await post(bill(NONE));
  ok('no country: 422 NO_COUNTRY', r.status === 422 && r.body.code === 'NO_COUNTRY', JSON.stringify(r));
  ok('...in the one sentence, naming Country setup', (r.body.detail || r.body.message) === CS.DOC_UNSTATED && /Country setup/.test(r.body.detail || r.body.message || ''), JSON.stringify(r.body));
  ok('...in the one problem shape (status, code, title)', r.body.status === 422 && !!r.body.title, JSON.stringify(r.body));
  r = await post(bill(NO_MONEY_SHOP));
  ok('a country with no money: 422 NO_MONEY, same sentence', r.status === 422 && r.body.code === 'NO_MONEY', JSON.stringify(r));
  r = await post(bill(NONE, { is_draft: true }));
  ok('a draft of a country-less shop is the author\'s own copy: let through', r.status === 200, JSON.stringify(r));
  r = await post(bill(IN_SHOP));
  ok('an IN shop bills', r.status === 200, JSON.stringify(r));
  server.close();
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
