/**
 * books-minor-exponent.test.cjs — ACC-179: money crosses major <-> minor in the CURRENCY's own decimals, through the api's ONE pair
 * (lib/books-cashflow toMinor · fromMinor: money.round, then money.decimals), on every books door that took a hard-coded 100.
 *
 * Proves, THROUGH REAL EXPRESS (stand-in auth, db and store; the books engines from the sibling checkout, as books-routes does):
 *   POST /write-off { amount_minor } · POST /payments { amount } · POST /opening { rows: dr_minor/cr_minor } · POST /entries { lines: dr_minor/cr_minor }
 *   for INR (2 decimals, an IN shop), JPY (0 decimals, a JP shop — reg-jp is a real path) and KWD (3 decimals, a ledger kept in KWD —
 *   no Kuwait pack yet, so money.decimals is what is proven), each against a value worked out by hand (the HAND table below).
 * And, pure: INR is unchanged — the new minorOf equals the old x 100 formula on 20,000 two-decimal amounts; the pack's threshold words
 *   and the credit-limit sentence use the currency's own places.
 * Before ACC-179: a ¥500 write-off posted ¥5; a ¥500 payment was 50,000 minor (100x too big); a ¥12.34 opening row was ¥12.
 * Run: node tests/books-minor-exponent.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

const SHOP = '11111111-1111-4111-8111-111111111111', CUST = '22222222-2222-4222-8222-222222222222';
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Shop' };
const authStub = Object.assign((req, res, next) => { req.identity = OWNER; next(); }, {
  entityOf: (req) => req.identity.identity_id,
  requireScope: () => (req, res, next) => next()
});
const call = (port, method, p, body) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  /* FIN-63: every call is its own attempt (a fresh Idempotency-Key per request) */
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b), 'Idempotency-Key': 'attempt-' + process.hrtime.bigint() } },
    (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => { let j; try { j = JSON.parse(raw || '{}'); } catch (e) { j = { unreadable: String(raw).slice(0, 200) }; } done({ status: res.statusCode, body: j }); });
    });
  r.end(b);
});

/* the HAND table (minor units), worked out on paper before the run — what each door must post:
   write-off amount_minor 500 → 500 in every currency (₹5.00 · ¥500 · KWD 0.500); the old /100 posted ¥5 → 5 and KWD 5.000 → 5000
   payment amount 500 (major) → ₹500.00 = 50000 · ¥500 = 500 · KWD 500.000 = 500000; the old x100 made ¥500 → 50000
   opening dr_minor 1234 → 1234 (₹12.34 · ¥1234 · KWD 1.234); the old /100 made ¥12.34 → ¥12 → 12, KWD 12.340 → 12340
   entries dr_minor 777 → 777 (₹7.77 · ¥777 · KWD 0.777); the old /100 made ¥7.77 → 8, KWD 7.770 → 7770 */
const CASES = [
  { country: 'IN', cur: 'INR', writeOff: 500, payment: 50000, opening: 1234, entry: 777 },
  { country: 'JP', cur: 'JPY', writeOff: 500, payment: 500, opening: 1234, entry: 777 },
  { country: 'JP', cur: 'KWD', writeOff: 500, payment: 500000, opening: 1234, entry: 777 }
];

/** the minor units a posted entry put on one ledger (the store's own rows), or the refusal in words */
function postedOn(X, answer, code, party) {
  if (answer.status !== 200) return 'status ' + answer.status + ' ' + JSON.stringify(answer.body).slice(0, 200);
  const e = X.T.entries.find((x) => x.entry_no === answer.body.entry_no);
  const a = code ? X.T.accounts.find((x) => x.entity_id === SHOP && x.code === code) : null;
  const l = e && X.T.lines.find((x) => x.entry_id === e.entry_id && (a ? x.account_id === a.account_id : x.party_id === party));
  return l ? Number(l.dr_minor) || Number(l.cr_minor) : null;
}

/** one shop in the case's currency, its four doors pressed, the posted minor units read back from the store */
async function runCase(c) {
  const X = H.load({ auth: authStub });
  require.cache[require.resolve(path.join(H.API, 'lib', 'storage-object'))] = { exports: { available: async () => false } };
  const app = express();
  app.use(express.json());
  app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0), port = srv.address().port;
  const q = (m, p, b) => call(port, m, '/api/books' + p, b);
  try {
    await X.store.saveSetting(X.db, SHOP, { enabled: false, country: c.country, functional_currency: c.cur });
    const en = await q('POST', '/enable', {});
    /* enable takes the pack's money (JP → JPY); a 3-decimal ledger has no pack yet, so its currency is set on the setting itself, the cache forgotten */
    await X.store.saveSetting(X.db, SHOP, { enabled: true, country: c.country, functional_currency: c.cur });
    require(path.join(H.API, 'lib', 'books-hooks')).forget(SHOP);
    const kept = (X.T.setting.get(SHOP) || {}).functional_currency;
    X.T.parties.push({ owner: SHOP, party_id: CUST, party_no: 'P-00001', name: 'Ravi Stores', customer: true, credit_days: 10 });
    /* FIN-78: a write-off needs a due to write off — the customer owes 1,000,000 minor first, more than the write-off (500) and the payment (500 major, 500000 minor in KWD) take */
    const codeOfRole = (role) => String(X.T.accounts.find((x) => x.entity_id === SHOP && x.role === role).code);
    await q('POST', '/entries', { narration: 'bill', date: '2026-09-09', lines: [{ code: codeOfRole('debtors'), dr_minor: 1000000, party_id: CUST }, { code: codeOfRole('sales'), cr_minor: 1000000 }] });
    const wo = await q('POST', '/write-off', { party_id: CUST, amount_minor: 500, reason: 'bad debt', date: '2026-09-10' });
    const pay = await q('POST', '/payments', { party_id: CUST, direction: 'in', amount: 500, mode: 'cash', received_at: '2026-09-11' });
    const paid = X.T.payments[X.T.payments.length - 1];
    const op = await q('POST', '/opening', { rows: [{ code: '1400', dr_minor: 1234 }, { code: '3000', cr_minor: 1234 }] });
    const je = await q('POST', '/entries', { narration: 'test', date: '2026-09-12', lines: [{ code: '1400', dr_minor: 777 }, { code: '3000', cr_minor: 777 }] });
    return {
      enabled: en.status === 200 && kept === c.cur,
      writeOff: postedOn(X, wo, null, CUST),
      words: pay.body.outcome && pay.body.outcome.words,
      payment: pay.status === 200 && paid ? Number(paid.amount_minor) : 'status ' + pay.status + ' ' + JSON.stringify(pay.body).slice(0, 200),
      opening: postedOn(X, op, '1400'),
      suspense: op.body.suspense_minor,
      entry: postedOn(X, je, '1400')
    };
  } finally {
    srv.close();
  }
}

/** INR unchanged: the new minorOf against the old formula (Math.round(money.round(x) x 100)) on 20,000 two-decimal amounts, and the pure seams */
function pureChecks() {
  const CF = require(path.join(H.API, 'lib', 'books-cashflow'));
  const M = require(path.join(H.API, 'lib', 'money'));
  const { minorOf } = require(path.join(H.API, 'routes', 'books'))._test;
  let same = 0, first = null;
  for (let i = 0; i < 20000; i++) {
    const x = Number((((i * 7919) % 10000000) / 100).toFixed(2));
    const old = Math.round(M.round(Number(x)) * 100), now = minorOf({ amount: x }, 'INR');
    if (old === now) same++;
    else if (!first) first = x + ': old ' + old + ' new ' + now;
  }
  ok('INR unchanged: minorOf(amount) equals the old x 100 on 20,000 two-decimal amounts', same === 20000, first);
  ok('INR unchanged: the old /100 equals fromMinor on every amount 1..20000 minor', Array.from({ length: 20000 }, (_, i) => i + 1).every((m) => CF.fromMinor(m, 'INR') === m / 100));
  ok('KWD / BHD: 3 decimals — toMinor(1.2345) 1235 (half away), fromMinor(1235) 1.235', CF.toMinor(1.2345, 'KWD') === 1235 && CF.fromMinor(1235, 'KWD') === 1.235 && CF.toMinor(1.2345, 'BHD') === 1235);
  ok('JPY: 0 decimals — toMinor(500) 500, fromMinor(500) 500', CF.toMinor(500, 'JPY') === 500 && CF.fromMinor(500, 'JPY') === 500);
  const W = require(path.join(H.API, 'lib', 'pack-words'));
  const pk = (cur, minor) => ({ currency: cur, tax: { registration: { turnover_minor: minor } } });
  const tw = [W.thresholdWords(pk('JPY', 10000000)), W.thresholdWords(pk('INR', 2000000000)), W.thresholdWords(pk('KWD', 1000000))];
  ok('pack-words thresholdWords: JPY 10,000,000 minor → "JPY 10,000,000" (was "JPY 100,000"); INR 2,000,000,000 → "INR 20,000,000"; KWD 1,000,000 → "KWD 1,000"',
    tw[0] === 'JPY 10,000,000' && tw[1] === 'INR 20,000,000' && tw[2] === 'KWD 1,000', tw.join(' · '));
  const F = require(path.join(H.API, 'lib', 'finance-terms'));
  const s = (cur, lim, after) => F.overSentence({ currency: cur, limit_minor: lim, after_minor: after });
  ok('credit-limit sentence: ¥1,500 over ¥1,000 → "1500" / "1000" (was "15.00" / "10.00"); INR 100001 / 100000 → "1000.01" / "1000.00"; KWD 1500 → "1.500"',
    /to 1500 —/.test(s('JPY', 1000, 1500)) && /limit of 1000\./.test(s('JPY', 1000, 1500)) && /1000\.01/.test(s('INR', 100000, 100001)) && /1000\.00/.test(s('INR', 100000, 100001)) && /to 1\.500 —/.test(s('KWD', 1000, 1500)),
    s('JPY', 1000, 1500) + ' | ' + s('KWD', 1000, 1500));
  const BM = require(path.join(H.API, 'lib', 'books-manual'));
  const gl = (cur) => BM.givenLines([{ code: '1400', dr_minor: 777 }], cur)[0].dr;
  ok('books-manual givenLines: 777 minor → INR 7.77 · JPY 777 · KWD 0.777 (was 7.77 for all)', gl('INR') === 7.77 && gl('JPY') === 777 && gl('KWD') === 0.777, [gl('INR'), gl('JPY'), gl('KWD')].join(' · '));
}

(async () => {
  console.log("\n══ ACC-179 — major <-> minor in the currency's own decimals ══\n");
  const src = H.enginesSrc();
  if (!src.dir) console.log('   SKIP the route half: ' + src.why);
  else {
    for (const c of CASES) {
      const r = await runCase(c);
      console.log('   ' + c.cur + ' actual: ' + JSON.stringify(r));
      ok(c.cur + ': the ledger switches on (' + c.country + ')', r.enabled);
      ok(c.cur + ': POST /write-off amount_minor 500 posts ' + c.writeOff + ' minor', r.writeOff === c.writeOff, String(r.writeOff));
      ok(c.cur + ': POST /payments amount 500 records ' + c.payment + ' minor', r.payment === c.payment, String(r.payment));
      ok(c.cur + ': POST /opening dr_minor 1234 posts ' + c.opening + ' minor, nothing to Suspense', r.opening === c.opening && !r.suspense, r.opening + ' · suspense ' + r.suspense);
      ok(c.cur + ': POST /entries dr_minor 777 posts ' + c.entry + ' minor', r.entry === c.entry, String(r.entry));
    }
  }
  pureChecks();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
