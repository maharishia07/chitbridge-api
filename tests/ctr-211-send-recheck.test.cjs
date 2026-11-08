/**
 * tests/ctr-211-send-recheck.test.cjs — CTR-211 (Athi 8 Nov 2026): AT SEND THE SERVER COMPARES WHAT THE ENGINE ALREADY WROTE TWICE, AND REFUSES A DISAGREEMENT.
 * Compute once, in the engine; the send only READS. The carried invoice holds the bridge (_cb.bridge.steps: taxable, round_off, total) and the figures
 * (ValDtls: AssVal, RndOffAmt, TotInvVal) — the same engine answer in two places. A pair that disagrees means a FAULT (not a judgement):
 * 409 MONEY_UNBALANCED naming the pair and both values, nothing stored, ONE service ticket (lib/money-check.raisePair → raiseticket, audience platform),
 * and NOT overridable (H24's owner override is for an ok:false bridge, which is a judgement). No bridge (frozen before v1.74.0) → as before.
 * Hand computation lives only in this test: 2 x 100 + CGST 18 + SGST 18 = 236.
 * Run: node tests/ctr-211-send-recheck.test.cjs
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
require(path.join(API, 'lib', 'raiseticket')).raise = async (from, who, t) => {
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
async function send(body) {
  COPIES = null;
  TICKETS.length = 0;
  const res = await fetch(`http://127.0.0.1:${PORT}/api/chits/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: J(Object.assign({ client_ref: 'c211-' + ++N }, body)) });
  return { status: res.status, answer: await res.json().catch(() => ({})), copies: COPIES, tickets: TICKETS.slice() };
}
const line = (name, price, qty, rate) => ({ particulars: name, name, quantity: qty, price, total: price * qty, unit: 'each', gst_rate: rate });
const LINES = [line('Item', 100, 2, 18)];
/** a fresh engine invoice for 2 x 100 at 18% (intra-state: CGST 18 + SGST 18, total 236), then `edit` plays the client */
const invoiceWith = (edit) => {
  const inv = JSON.parse(J(taxLines.invoiceFor({ lines: LINES, seller: taxLines.partyOf(shopRow), buyer: {}, currency: 'INR', at: '2026-11-08T05:00:00Z', priceIncludesTax: false }).invoice));
  if (edit) edit(inv);
  return inv;
};
const body = (inv, extra) => ({ purpose: 'order', subject: 'Bill', recipients: [{ self: true, name: 'self' }], line_items: LINES, business_json: { bill_no: 'C1-0001', till: { id: 'C1' }, billed_at: '2026-11-08T05:00:00Z', customer: { name: 'Walk-in' }, invoice: inv, ...(extra || {}) } });

(async () => {
  const server = app.listen(0);
  PORT = server.address().port;
  try {
    const good = invoiceWith();
    ok('the engine gives 236 for 2 x 100 + 18 + 18 (the hand sum, test only)', good.ValDtls.TotInvVal === 236 && good._cb.bridge.ok === true, J(good.ValDtls));
    const r0 = await send(body(good));
    const stored = r0.copies && (r0.copies.find((c) => c.direction === 'sent') || r0.copies[0]);
    ok('a correct 236 bill → 200, stored total 236, no ticket', r0.status === 200 && stored && stored.summary_json.total_value === 236 && r0.tickets.length === 0, J([r0.status, r0.answer, r0.tickets.length]));

    const h21 = await send(body(invoiceWith((i) => { i.ValDtls.TotInvVal = 300; })));
    ok('H21: TotInvVal 300, bridge total 236, ok:true → 409 MONEY_UNBALANCED, nothing stored, one ticket', h21.status === 409 && h21.answer.code === 'MONEY_UNBALANCED' && h21.copies === null && h21.tickets.length === 1, J([h21.status, h21.answer, h21.tickets.length]));
    const facts = h21.tickets[0] && h21.tickets[0].t.money_mismatch;
    ok('H21: the words name the pair and both values (236 and 300)', /total/.test(h21.answer.words || '') && /236/.test(h21.answer.words) && /300/.test(h21.answer.words) && h21.answer.pair === 'total' && h21.answer.bridge_minor === 23600 && h21.answer.carried_minor === 30000, J(h21.answer));
    ok('H21: the ticket goes to the platform desk from the shop and carries bill, pair, both values and the engine version', !!facts && h21.tickets[0].t.audience === 'platform' && h21.tickets[0].from.entity_id === SHOP && facts.bill === 'C1-0001' && facts.pair === 'total' && facts.bridge_minor === 23600 && facts.carried_minor === 30000 && /^tax@/.test(facts.engine), J(h21.tickets[0] && h21.tickets[0].t));
    const h21o = await send(body(invoiceWith((i) => { i.ValDtls.TotInvVal = 300; }), { money_override: { by: 'Asha', why: 'owner says it is right' } }));
    ok('a pair mismatch is NOT overridable (a fault, not a judgement): a typed reason still gets 409', h21o.status === 409 && h21o.copies === null && h21o.tickets.length === 1, J([h21o.status, h21o.answer]));
    const taxable = await send(body(invoiceWith((i) => { i.ValDtls.AssVal = 150; })));
    ok('the taxable pair (bridge taxable 200 vs AssVal 150) → 409 naming it, one ticket', taxable.status === 409 && taxable.answer.pair === 'taxable' && taxable.copies === null && taxable.tickets.length === 1, J(taxable.answer));

    /* H22: CGST edited to 10 under the 236 total. The engine carries each head in ValDtls, but NO bridge step carries a head alone: seeing it takes a SUM of heads,
       which the send may not do (CTR-211 design). Pinned as OPEN so it is never claimed; it turns green when the engine writes per-head bridge steps. */
    const h22 = await send(body(invoiceWith((i) => { i.ValDtls.CgstVal = 10; })));
    console.log('   OPEN H22 (needs an engines change, see the PR): CGST 10 under 236 answered ' + h22.status + ', tickets ' + h22.tickets.length + ' - no bridge step carries CGST alone to compare; not counted, not claimed');

    const h20 = await send(body(invoiceWith((i) => { i._cb.bridge = { ok: false, step: 'total', unexplained_minor: 6400, words: 'Does not add up at total', steps: [{ name: 'total', amount_minor: 23600 }] }; })));
    ok('H20: a bridge that says ok:false still stops 409 MONEY_UNBALANCED', h20.status === 409 && h20.answer.code === 'MONEY_UNBALANCED' && h20.copies === null, J(h20.answer));
    const bad = invoiceWith((i) => { i._cb.bridge = { ok: false, step: 'offers', unexplained_minor: 5000, words: 'Does not add up at offers', steps: [{ name: 'gross', amount_minor: 20000 }, { name: 'taxable', amount: i.ValDtls.AssVal, amount_minor: 20000 }, { name: 'round_off', amount: 0, amount_minor: 0 }, { name: 'total', amount: i.ValDtls.TotInvVal, amount_minor: 23600 }] }; });
    const h23 = await send(body(bad));
    ok('H23: a discount above the line (bridge ok:false, step offers) → 409', h23.status === 409 && h23.answer.step === 'offers', J(h23.answer));
    const h24 = await send(body(bad, { money_override: { by: 'Asha (owner PIN)', why: 'checked by hand' } }));
    ok('H24: the owner override with a typed reason on an ok:false bridge stays 200 (and raises no pair ticket)', h24.status === 200 && h24.tickets.length === 0, J([h24.status, h24.answer]));

    const old = await send(body(invoiceWith((i) => { delete i._cb.bridge; i.ValDtls.TotInvVal = 300; })));
    ok('an invoice with NO bridge (frozen before v1.74.0) behaves as today: 200, no ticket', old.status === 200 && old.tickets.length === 0, J([old.status, old.answer]));
    const draft = await send({ ...body(invoiceWith((i) => { i.ValDtls.TotInvVal = 300; })), is_draft: true });
    ok('a draft is never stopped, no ticket', draft.status === 200 && draft.tickets.length === 0, J([draft.status, draft.answer]));
  } catch (e) {
    fail++;
    console.log('   FAIL the harness threw: ' + (e && e.stack));
  }
  server.close();
  console.log(`\n  ${pass} passed, ${fail} failed · ${pass + fail} checks\n`);
  process.exit(fail ? 1 : 0);
})();
