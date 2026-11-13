/**
 * tests/ctr-204-replay-body.test.cjs — CTR-204: A DIFFERENT SALE UNDER THE SAME BILL NUMBER, TILL AND MOMENT IS REFUSED, NOT ANSWERED "DUPLICATE".
 * The real send route over a stand-in db. The held bill is whatever the first send stored (its summary_json + line_items, captured from mint.deliver);
 * the replay is compared with it by counter-bill.replayDiffers (two carried figures, nothing recomputed). Same sale → 200 duplicate:true;
 * a different total or different items → 409 CHIT_REPLAY_DIFFERS naming which. Hand figures: 2 x 100 + 18% = 236; 3 x 100 + 18% = 354.
 * Run: node tests/ctr-204-replay-body.test.cjs
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
    console.log('   FAIL ' + name + (why ? '\n          ' + String(why).slice(0, 300) : ''));
  }
};
const J = (x) => JSON.stringify(x);
const SHOP = '11111111-1111-4111-8111-111111111111';
const shopRow = { status: 'active', identity_type: 'entity', identity_id: SHOP, bridge_id: 'CB-SHOP', display_name: 'Test Shop', country: 'IN', gstn: '33AABCK1234F1Z6', policy_flags: { price_includes_tax: 'no' } };
let HELD = null; /* the bill the shop already holds: { ref, header, full } */
function rowsFor(sql, params) {
  const s = String(sql);
  if (/to_regprocedure\('chit_deliver/.test(s)) return [{ ok: true }];
  if (/business_json->>'client_ref' = \$2/.test(s)) return HELD && params[1] === HELD.ref ? [/summary_json/.test(s) ? HELD.full : HELD.header] : [];
  if (/SELECT self_copy_pref/.test(s)) return [{ self_copy_pref: null }];
  if (/FROM identities/.test(s) && /identity_id = ANY/.test(s)) return (params[0] || []).map((id) => (id === SHOP ? shopRow : null)).filter(Boolean);
  if (/FROM identities/.test(s) && /identity_id = \$1/.test(s)) return params && params[0] === SHOP ? [shopRow] : [];
  return [];
}
const dbPath = require.resolve(path.join(API, 'db'));
const tx = { query: async (s, p) => ({ rows: rowsFor(s, p) }) };
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    query: async (s, p) => ({ rows: rowsFor(s, p) }),
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
require(path.join(API, 'lib', 'tax-shelf')).readShelf = async () => null;
require(path.join(API, 'lib', 'notify')).sendSupportAlert = async () => ({ ok: true });
const taxLines = require(path.join(API, 'lib', 'tax-lines'));
const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/chits', require(path.join(API, 'routes', 'chits')));
let PORT = 0;
async function send(body) {
  COPIES = null;
  const res = await fetch('http://127.0.0.1:' + PORT + '/api/chits/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: J(body) });
  return { status: res.status, answer: await res.json().catch(() => ({})), copies: COPIES };
}
const line = (item, price, qty) => ({ item_id: item, particulars: item, name: item, quantity: qty, price, total: price * qty, unit: 'each', gst_rate: 18 });
const bill = (lines, edit) => {
  const inv = JSON.parse(J(taxLines.invoiceFor({ lines, seller: taxLines.partyOf(shopRow), buyer: {}, currency: 'INR', at: '2026-11-13T05:00:00Z', priceIncludesTax: false }).invoice));
  const bj = { bill_no: 'C1/26-27/0041', till: { id: 'C1' }, billed_at: '2026-11-13T05:00:00Z', customer: { name: 'Walk-in' }, invoice: inv };
  if (edit) edit(bj);
  return { client_ref: 'C1/26-27/0041', purpose: 'order', subject: 'Bill', recipients: [{ self: true, name: 'self' }], line_items: lines, business_json: bj };
};
const TWO = [line('tea', 100, 2)];
const THREE = [line('tea', 100, 3)];
const OTHER_ITEM = [line('coffee', 100, 2)];

(async () => {
  const server = app.listen(0);
  PORT = server.address().port;
  try {
    HELD = null;
    const first = await send(bill(TWO));
    const stored = first.copies && (first.copies.find((c) => c.direction === 'sent') || first.copies[0]);
    ok('the first send of the bill is stored: 200, total 236', first.status === 200 && !first.answer.duplicate && stored && stored.summary_json.total_value === 236, J([first.status, first.answer]));
    HELD = {
      ref: 'C1/26-27/0041',
      header: { chit_id: 'held-1', till_id: 'C1', billed_at: '2026-11-13T05:00:00Z' },
      full: { chit_id: 'held-1', till_id: 'C1', billed_at: '2026-11-13T05:00:00Z', summary_json: stored.summary_json, line_items: TWO }
    };
    const same = await send(bill(TWO));
    ok('the identical replay → 200 duplicate:true with the held chit, nothing stored', same.status === 200 && same.answer.duplicate === true && same.answer.chit_id === 'held-1' && same.copies === null, J([same.status, same.answer]));
    const honest = await send(bill(TWO, (bj) => { bj.till.by = 'phone-9'; bj.sent_at = '2026-11-13T09:09:09Z'; bj.note = 'reprinted'; }));
    ok('an honest replay that differs only in receipt time, device stamp and a note → still 200 duplicate:true', honest.status === 200 && honest.answer.duplicate === true, J([honest.status, honest.answer]));
    const dearer = await send(bill(THREE));
    ok('a different total (3 x 100 + 18% = 354 against the held 236) → 409 CHIT_REPLAY_DIFFERS naming the total, nothing stored', dearer.status === 409 && dearer.answer.code === 'CHIT_REPLAY_DIFFERS' && dearer.answer.differs === 'total' && dearer.copies === null, J([dearer.status, dearer.answer]));
    ok('the words say it is a different sale on the same number and that nothing is lost', /different sale/.test(dearer.answer.message || '') && /nothing has been lost/.test(dearer.answer.message || ''), J(dearer.answer));
    const swapped = await send(bill(OTHER_ITEM));
    ok('the same 236 total but another item (coffee for tea) → 409 CHIT_REPLAY_DIFFERS naming the lines', swapped.status === 409 && swapped.answer.code === 'CHIT_REPLAY_DIFFERS' && swapped.answer.differs === 'lines', J([swapped.status, swapped.answer]));
    const noInvoice = bill(TWO);
    delete noInvoice.business_json.invoice;
    const blind = await send(noInvoice);
    ok('a replay that carries no invoice figure gives no verdict: still 200 duplicate:true (never blocks what it cannot judge)', blind.status === 200 && blind.answer.duplicate === true, J([blind.status, blind.answer]));
    const otherMoment = await send(bill(THREE, (bj) => { bj.billed_at = '2026-11-13T07:00:00Z'; }));
    ok('another moment is still the two-counters answer (TILL_SERIES_COLLISION), not CHIT_REPLAY_DIFFERS', otherMoment.status === 409 && otherMoment.answer.code === 'TILL_SERIES_COLLISION', J(otherMoment.answer));
    /* ── a false "different" would make the till renumber an honest replay and bill the customer twice: every doubt is no verdict ── */
    const held236 = HELD.full;
    const kwd = (total, bridged) => bill(TWO, (bj) => {
      bj.invoice.currency = 'KWD';
      bj.invoice.ValDtls.TotInvVal = total;
      if (bridged) bj.invoice._cb.bridge = { ok: true, decimals: 3, steps: [{ name: 'total', amount: total, amount_minor: Math.round(total * 1000) }] };
      else delete bj.invoice._cb.bridge;
    });
    const kwdHeld = (bridged) => ({ chit_id: 'held-1', till_id: 'C1', billed_at: '2026-11-13T05:00:00Z', line_items: TWO,
      summary_json: { money: Object.assign({ total: 1.24, currency_code: 'KWD' }, bridged ? { bridge: { decimals: 3, steps: [{ name: 'total', amount: 1.235, amount_minor: 1235 }] } } : {}) } });
    HELD.full = kwdHeld(true);
    const kwdSame = await send(kwd(1.235, true));
    ok('a 3-decimal bill (KWD 1.235, stored money.total 1.24) replayed honestly → 200 duplicate:true, compared in the bridge minor units (1235 = 1235)', kwdSame.status === 200 && kwdSame.answer.duplicate === true, J([kwdSame.status, kwdSame.answer]));
    const kwdOther = await send(kwd(1.236, true));
    ok('the same KWD bill with one fils more (1.236) → 409 CHIT_REPLAY_DIFFERS total', kwdOther.status === 409 && kwdOther.answer.differs === 'total', J([kwdOther.status, kwdOther.answer]));
    HELD.full = kwdHeld(false);
    const oldHeld = await send(kwd(1.235, true));
    ok('a held bill from before the bridge (money.total 1.24 rounded to 2) against a bridged replay (1.235) → no verdict: 200 duplicate:true', oldHeld.status === 200 && oldHeld.answer.duplicate === true, J([oldHeld.status, oldHeld.answer]));
    const plain = await send(kwd(1.24, false));
    ok('neither side bridged: both rounded to the currency decimals (1.24 = 1.24) → 200 duplicate:true', plain.status === 200 && plain.answer.duplicate === true, J([plain.status, plain.answer]));
    const plainOther = await send(kwd(1.245, false));
    ok('neither side bridged, 1.245 against 1.24 → 409 total', plainOther.status === 409 && plainOther.answer.differs === 'total', J([plainOther.status, plainOther.answer]));

    HELD.full = Object.assign({}, held236, { summary_json: Object.assign({}, held236.summary_json, { money: Object.assign({}, held236.summary_json.money, { currency_code: 'AUD' }) }) });
    const money = await send(bill(TWO));
    ok('a held bill in AUD against a replay whose invoice is INR → 409 CHIT_REPLAY_DIFFERS currency', money.status === 409 && money.answer.differs === 'currency', J([money.status, money.answer]));
    HELD.full = Object.assign({}, held236, { summary_json: Object.assign({}, held236.summary_json, { money: Object.assign({}, held236.summary_json.money, { currency_code: null }) }) });
    const noCur = await send(bill(TWO));
    ok('the held bill states no currency → no verdict on currency: 200 duplicate:true', noCur.status === 200 && noCur.answer.duplicate === true, J([noCur.status, noCur.answer]));

    const idless = (name, qty) => [{ particulars: name, name, quantity: qty, price: 100, total: 100 * qty, unit: 'each', gst_rate: 18 }];
    HELD.full = Object.assign({}, held236, { line_items: idless('tea', 2) });
    const renamed = await send(bill(idless('chai', 2)));
    ok('a line with no item_id renamed on an honest replay (tea → chai, same total) → 200 duplicate:true, never judged on a name', renamed.status === 200 && renamed.answer.duplicate === true, J([renamed.status, renamed.answer]));
    const idlessMoney = await send(bill(idless('tea', 3)));
    ok('id-less lines, another quantity and so another total → still 409 (the total carries it)', idlessMoney.status === 409 && idlessMoney.answer.differs === 'total', J([idlessMoney.status, idlessMoney.answer]));
    HELD.full = held236;
  } finally {
    server.close();
  }
  console.log(String.fromCharCode(10) + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
