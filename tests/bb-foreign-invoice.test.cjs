/**
 * tests/bb-foreign-invoice.test.cjs - BB-F-01 (walk BB, 21 Nov 2026): an invoice an India shop sends in USD, EUR, "usd1" or XXX was answered 200 and booked as INR at face value
 * (US$650.00 = 65,000 cents became Rs 650.00 = 65,000 paise on debtors). One rule (IAS 21 / Ind AS 21 para 21: a foreign amount is recorded at the spot rate on the transaction date, never at 1:1):
 *   (a) a code that is not ISO 4217 ("usd1", "XXX") is refused in words, nothing stored;
 *   (b) a real foreign code is CARRIED on the chit (never relabelled INR). An invoice's tax heads are worked out in the shop's money (DEC-073/074, FX-ENTRY v1: no tax on a foreign line), so a foreign INVOICE
 *       is refused in words (409 heads:currency: "make the bill in INR; a sale in USD goes as an order, which keeps its currency") and an ORDER carries it - the books convert it at the day's rate;
 *   (c) the conversion (lib/fx-rates forEvent) with no rate for the day waits/refuses in words, never 1:1.
 * Hand figures (this test only): 10 x 65.00 = 650.00 USD = 65,000 cents; at the walk's rate 83.25 -> 65,000 x 83.25 = 5,411,250 paise (Rs 54,112.50). The parent booked 65,000 paise.
 * Run: node tests/bb-foreign-invoice.test.cjs
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'test';
let pass = 0,
  fail = 0;
const ok = (name, cond, why) => {
  if (cond) {
    pass++;
    console.log('   ok   ' + name);
  } else {
    fail++;
    console.log('   FAIL ' + name + (why ? '\n          ' + why : ''));
  }
};
const J = (x) => JSON.stringify(x);
const SHOP = '11111111-1111-4111-8111-111111111111';
const shopRow = { status: 'active', identity_type: 'entity', identity_id: SHOP, bridge_id: 'CB-SHOP', display_name: 'Test Shop', country: 'IN', gstn: '33AABCK1234F1Z6', policy_flags: { price_includes_tax: 'no' } };
function rowsFor(sql, params) {
  const s = String(sql);
  if (/to_regprocedure\('chit_deliver/.test(s)) return [{ ok: true }];
  if (/business_json->>'client_ref' = \$2/.test(s)) return [];
  if (/SELECT self_copy_pref/.test(s)) return [{ self_copy_pref: null }];
  if (/FROM identities/.test(s) && /identity_id = ANY/.test(s)) return (params[0] || []).map((id) => (id === SHOP ? shopRow : null)).filter(Boolean);
  if (/FROM identities/.test(s) && /identity_id = \$1/.test(s)) return params && params[0] === SHOP ? [shopRow] : [];
  return [];
}
const bound = require('./support/bound-db.cjs').boundDb(rowsFor);
const dbPath = require.resolve(path.join(API, 'db'));
const tx = { query: async (s, p) => ({ rows: rowsFor(s, p) }) };
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    query: async (s, p) => ({ rows: rowsFor(s, p) }),
    queryAs: bound.queryAs, queryFor: bound.queryFor, /* SEC-75: a bound read; blank id or another shop's predicate sees no row */
    withEntity: async (id, fn) => fn(tx),
    withTransaction: async (fn) => fn(tx),
    trySavepoint: async (db, fn, fb) => {
      try {
        return await fn(db);
      } catch (_) {
        return fb;
      }
    },
    onEntity: async (id, db, fn) => fn(tx)
  }
};
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: Object.assign(
    (req, res, next) => {
      const holder = require(path.join(API, 'lib', 'holder')).holderOf;
      req.identity = { identity_id: SHOP, identity_type: 'entity', bridge_id: 'CB-X', display_name: 'Caller' };
      req.api_key = { scopes: ['till'] };
      req.till = holder({ kind: 'api_key', jti: 'k1', scopes: ['till'] }, { till: { id: 'C1' } });
      next();
    },
    { entityOf: (req) => req.identity.identity_id, requireScope: () => (q, s, n) => n(), userOf: (req) => req.identity, forgetKey: () => {}, keyAlive: async () => true }
  )
};
const mint = require(path.join(API, 'lib', 'mint'));
let COPIES = null;
mint.deliver = async (sender, chit_id, copies) => {
  COPIES = copies;
  return { ok: true };
};
try {
  require(path.join(API, 'lib', 'books-hooks')).afterChit = () => Promise.resolve({});
  require(path.join(API, 'lib', 'meter')).meter = async () => {};
  require(path.join(API, 'lib', 'stock-from-chit')).postFor = async () => ({ failed: [], skipped: [] });
} catch (_) {
  /* a hook that is not loaded in this harness needs no stub */
}
require(path.join(API, 'lib', 'tax-shelf')).readShelf = async () => null;
/** the ONE service-ticket path (lib/raiseticket) — captured, never sent */
const TICKETS = [];
const FILED = new Set(); /* the real raiseticket dedupes on client_ref: the same key twice is ONE ticket */
require(path.join(API, 'lib', 'raiseticket')).raise = async (from, who, t) => {
  if (t.client_ref && FILED.has(t.client_ref)) return { raised: false, duplicate: true };
  FILED.add(t.client_ref);
  TICKETS.push({ from, who, t });
  return { raised: true, chit_id: 'ticket-' + TICKETS.length };
};
require(path.join(API, 'lib', 'notify')).sendSupportAlert = async () => ({ ok: true });
const taxLines = require(path.join(API, 'lib', 'tax-lines'));
const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/chits', require(path.join(API, 'routes', 'chits')));

let PORT = 0;
let N = 0;
async function send(body, keep) {
  COPIES = null;
  if (!keep) {
    TICKETS.length = 0;
    FILED.clear();
  }
  const res = await fetch(`http://127.0.0.1:${PORT}/api/chits/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: J(Object.assign({ client_ref: 'bb-' + ++N }, body)) });
  return { status: res.status, answer: await res.json().catch(() => ({})), copies: COPIES, tickets: TICKETS.slice() };
}
const line = (name, price, qty, rate) => ({ particulars: name, name, quantity: qty, price, total: price * qty, unit: 'each', gst_rate: rate });
const LINES = [line('Item', 100, 2, 18)];
/** a fresh engine invoice for 2 x 100 at 18% (intra-state: CGST 18 + SGST 18, total 236), then `edit` plays the client */
const BB_LINES = [{ particulars: 'Steel bottle 1 L', quantity: 10, unit: 'piece', price: 65, total: 650, gst_rate: 18 }];
const bbBody = (purpose, extra) => Object.assign({ purpose, subject: 'Export', recipients: [{ self: true, name: 'self' }], line_items: BB_LINES, business_json: { bill_no: 'BB-X1' } }, extra || {});
(async () => {
  const server = app.listen(0);
  PORT = server.address().port;
  try {
    const inr = await send(bbBody('invoice'));
    ok('control: the same invoice in the shop\'s own money (INR) is sent: 200', inr.status === 200, J([inr.status, inr.answer]));
    for (const code of ['usd1', 'XXX', 'zz']) {
      const r = await send(bbBody('invoice', { currency_code: code }));
      ok('a ' + J(code) + ' invoice is refused in words (422 MONEY_CURRENCY_UNKNOWN), nothing stored', r.status === 422 && r.answer.code === 'MONEY_CURRENCY_UNKNOWN' && r.copies === null && /ISO 4217|currency/.test(r.answer.message || ''), J([r.status, r.answer]));
    }
    for (const code of ['USD', 'EUR']) {
      const r = await send(bbBody('invoice', { currency_code: code }));
      const stored = r.copies && (r.copies.find((c) => c.direction === 'sent') || r.copies[0]);
      ok('a ' + code + ' invoice on an India shop is NEVER stored as INR at face value (the parent stored 65,000 paise): refused in words, nothing stored', r.status === 409 && r.copies === null && new RegExp('in ' + code).test(r.answer.message || '') && /order/.test(r.answer.message || ''), J([r.status, r.answer]));
    }
    /* the same door for the other packs: AU (AUD) and AE (AED) shops - one path, no country word */
    for (const [country, money] of [['AU', 'AUD'], ['AE', 'AED']]) {
      shopRow.country = country;
      delete shopRow.gstn;
      const same = await send(bbBody('invoice', { currency_code: money.toLowerCase() }));
      const usd = await send(bbBody('invoice', { currency_code: 'usd' }));
      const junk = await send(bbBody('invoice', { currency_code: 'usd1' }));
      ok(country + ': own money ' + money + ' sends 200; USD refused 409 in words; "usd1" 422', same.status === 200 && usd.status === 409 && usd.copies === null && /in USD/.test(usd.answer.message) && junk.status === 422 && junk.copies === null, J([same.status, usd.status, usd.answer.message, junk.status]));
    }
  } finally {
    server.close();
  }
  console.log('\n   ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
