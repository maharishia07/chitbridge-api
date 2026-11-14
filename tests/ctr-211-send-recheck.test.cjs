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

    /* H22 (closed by CTR-214, engine v1.84.0 writes bridge.heads): CGST edited to 10 under the 236 total, no sum needed — the head pairs compare two carried figures */
    const h22 = await send(body(invoiceWith((i) => { i.ValDtls.CgstVal = 10; })));
    ok('H22: CGST 10 under 236 → 409 naming total:CgstVal (bridge 1800, carried 1000), one ticket', h22.status === 409 && h22.answer.pair === 'total:CgstVal' && h22.answer.bridge_minor === 1800 && h22.answer.carried_minor === 1000 && h22.copies === null && h22.tickets.length === 1, J(h22.answer));

    const h20 = await send(body(invoiceWith((i) => { i._cb.bridge = { ok: false, step: 'total', unexplained_minor: 6400, words: 'Does not add up at total', steps: [{ name: 'taxable', amount: i.ValDtls.AssVal, amount_minor: 20000 }, { name: 'round_off', amount: 0, amount_minor: 0 }, { name: 'total', amount: i.ValDtls.TotInvVal, amount_minor: 23600 }] }; })));
    ok('H20: a bridge that says ok:false still stops 409 MONEY_UNBALANCED', h20.status === 409 && h20.answer.code === 'MONEY_UNBALANCED' && h20.copies === null, J(h20.answer));
    const bad = invoiceWith((i) => { i._cb.bridge = { ok: false, step: 'offers', unexplained_minor: 5000, words: 'Does not add up at offers', steps: [{ name: 'gross', amount_minor: 20000 }, { name: 'taxable', amount: i.ValDtls.AssVal, amount_minor: 20000 }, { name: 'round_off', amount: 0, amount_minor: 0 }, { name: 'total', amount: i.ValDtls.TotInvVal, amount_minor: 23600 }] }; });
    const h23 = await send(body(bad));
    ok('H23: a discount above the line (bridge ok:false, step offers) → 409', h23.status === 409 && h23.answer.step === 'offers', J(h23.answer));
    const h24 = await send(body(bad, { money_override: { by: 'Asha (owner PIN)', why: 'checked by hand' } }));
    ok('H24: the owner override with a typed reason on an ok:false bridge stays 200 (and raises no pair ticket)', h24.status === 200 && h24.tickets.length === 0, J([h24.status, h24.answer]));

    const old = await send(body(invoiceWith((i) => { delete i._cb.bridge; i.ValDtls.TotInvVal = 300; })));
    ok('an invoice with NO bridge (frozen before v1.74.0) behaves as today: 200, no ticket', old.status === 200 && old.tickets.length === 0, J([old.status, old.answer]));
    /* the shopkeeper sentence: plain names, both figures, no field path (the paths stay on the ticket) */
    const fieldPath = new RegExp('_cb|ValDtls|bridge[.]steps');
    ok('the words use plain names and no field path; the paths ride the ticket only', !fieldPath.test(h21.answer.words + h21.answer.message) && /bill total/.test(h21.answer.words) && /We have been told/.test(h21.answer.words) && facts.bridge_field === '_cb.bridge.steps.total' && facts.carried_field === 'ValDtls.TotInvVal', J(h21.answer));
    const ro = await send(body(invoiceWith((i) => { i.ValDtls.RndOffAmt = 0.5; })));
    ok('the round-off pair (bridge 0 vs RndOffAmt 0.5) → 409 naming round-off, one ticket', ro.status === 409 && ro.answer.pair === 'round_off' && /round-off/.test(ro.answer.words) && ro.copies === null && ro.tickets.length === 1, J(ro.answer));

    /* the minor unit is the BRIDGE's own decimals (the seller pack's currency), never the chit's stated currency (here INR, 2 places) */
    const inPlaces = (i, places, total, taxable) => {
      i._cb.bridge.decimals = places;
      delete i._cb.bridge.heads; /* the fixture re-scales the steps by hand; heads in 2 places would not match (a fixture artefact, CTR-214) */
      i.ValDtls.TotInvVal = total;
      i.ValDtls.AssVal = taxable;
      i.ValDtls.RndOffAmt = 0;
      const unit = Math.pow(10, places);
      i._cb.bridge.steps.forEach((x) => {
        if (x.name === 'total') { x.amount = total; x.amount_minor = total * unit; }
        if (x.name === 'taxable') { x.amount = taxable; x.amount_minor = taxable * unit; }
        if (x.name === 'round_off') { x.amount = 0; x.amount_minor = 0; }
      });
    };
    const jpyGood = await send(body(invoiceWith((i) => inPlaces(i, 0, 236, 200))));
    ok('a correct JPY (0 decimals) bill passes the send: 200, no ticket', jpyGood.status === 200 && jpyGood.tickets.length === 0, J([jpyGood.status, jpyGood.answer]));
    const jpyBad = await send(body(invoiceWith((i) => { inPlaces(i, 0, 236, 200); i.ValDtls.TotInvVal = 237; })));
    ok('a JPY bill whose figure differs by one yen is refused 409 (total), one ticket', jpyBad.status === 409 && jpyBad.answer.pair === 'total' && jpyBad.answer.bridge_minor === 236 && jpyBad.answer.carried_minor === 237 && jpyBad.tickets.length === 1, J(jpyBad.answer));
    const kwdGood = await send(body(invoiceWith((i) => inPlaces(i, 3, 236, 200))));
    ok('a correct KWD (3 decimals) bill passes the send: 200, no ticket', kwdGood.status === 200 && kwdGood.tickets.length === 0, J([kwdGood.status, kwdGood.answer]));
    const kwdBad = await send(body(invoiceWith((i) => { inPlaces(i, 3, 236, 200); i.ValDtls.TotInvVal = 236.001; })));
    ok('a KWD bill off by one fils is refused 409 (total 236000 vs 236001), one ticket', kwdBad.status === 409 && kwdBad.answer.bridge_minor === 236000 && kwdBad.answer.carried_minor === 236001 && kwdBad.tickets.length === 1, J(kwdBad.answer));

    /* a credit note / negative total: the same equality on a negative figure */
    const negative = (total) => invoiceWith((i) => {
      i.ValDtls.TotInvVal = total;
      i._cb.bridge.steps.forEach((x) => { if (x.name === 'total') { x.amount = -236; x.amount_minor = -23600; } });
    });
    const negGood = await send(body(negative(-236)));
    ok('a negative total that agrees (-236 both ways) passes: 200, no ticket', negGood.status === 200 && negGood.tickets.length === 0, J([negGood.status, negGood.answer]));
    const negBad = await send(body(negative(-237)));
    ok('a negative total that differs (-236 vs -237) is refused 409', negBad.status === 409 && negBad.answer.bridge_minor === -23600 && negBad.answer.carried_minor === -23700 && negBad.tickets.length === 1, J(negBad.answer));

    /* a replay of the same refused bill: ONE ticket, the second answer says we were already told */
    const same = body(invoiceWith((i) => { i.ValDtls.TotInvVal = 300; }));
    FILED.clear();
    TICKETS.length = 0;
    const first = await send({ ...same, client_ref: 'c211-replay' }, true);
    const again = await send({ ...same, client_ref: 'c211-replay' }, true);
    ok('the same refused bill sent twice raises ONE ticket (same key), both answers 409', first.status === 409 && again.status === 409 && TICKETS.length === 1 && /already told/.test(again.answer.words), J([TICKETS.length, again.answer.words]));
    /* two different bills with no number and no reference do not dedupe into one ticket */
    FILED.clear();
    TICKETS.length = 0;
    const noRef = (total) => {
      const b = body(invoiceWith((i) => { i.ValDtls.TotInvVal = total; }));
      delete b.business_json.bill_no;
      return b;
    };
    const unRef = async (total) => {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/chits/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: J(noRef(total)) });
      return res.status;
    };
    const u1 = await unRef(300);
    const u2 = await unRef(310);
    ok('two unnumbered bills without a reference each raise their own ticket', u1 === 409 && u2 === 409 && TICKETS.length === 2 && TICKETS[0].t.client_ref !== TICKETS[1].t.client_ref, J(TICKETS.map((x) => x.t.client_ref)));
    FILED.clear();

    /* the same bill retried under a NEW client_ref is the same bill: ONE ticket (the key is the hash of shop, bill, pair and both minor values) */
    FILED.clear();
    TICKETS.length = 0;
    const r1 = await send({ ...same, client_ref: 'c211-retry-a' }, true);
    const r2 = await send({ ...same, client_ref: 'c211-retry-b' }, true);
    ok('a retry under a new client_ref raises no second ticket; client_ref rides the ticket as a fact', r1.status === 409 && r2.status === 409 && TICKETS.length === 1 && TICKETS[0].t.money_mismatch.client_ref === 'c211-retry-a', J(TICKETS.map((x) => x.t.client_ref)));
    FILED.clear();

    /* a bridge that CARRIES its steps but lacks a figure or a step is a stripped invoice: refused like a disagreement, not overridable, one ticket */
    const strip = async (what, edit, extra) => {
      const res = await send(body(invoiceWith(edit), extra));
      ok(what, res.status === 409 && res.answer.code === 'MONEY_UNBALANCED' && res.copies === null && res.tickets.length === 1 && /missing its e-invoice/.test(res.answer.words) && !new RegExp('_cb|ValDtls').test(res.answer.words), J([res.status, res.answer, res.tickets.length]));
      return res;
    };
    await strip('ValDtls.TotInvVal deleted → 409, "missing its e-invoice total", one ticket', (i) => { delete i.ValDtls.TotInvVal; });
    const gone = await strip('ValDtls.RndOffAmt deleted → 409 round-off missing', (i) => { delete i.ValDtls.RndOffAmt; });
    ok('…the answer names the pair and missing: figure, and the ticket says which side is missing', gone.answer.pair === 'round_off' && gone.answer.missing === 'figure' && /figure missing/.test(gone.tickets[0].t.subject), J(gone.answer));
    await strip('a bridge step deleted (no taxable step) → 409', (i) => { i._cb.bridge.steps = i._cb.bridge.steps.filter((x) => x.name !== 'taxable'); });
    await strip('a missing figure cannot be overridden by a typed reason', (i) => { delete i.ValDtls.AssVal; }, { money_override: { by: 'Asha', why: 'owner says it is right' } });
    const noBridge = await send(body(invoiceWith((i) => { delete i._cb.bridge; delete i.ValDtls.TotInvVal; })));
    ok('NO bridge at all (an old till) still sends: 200, no ticket', noBridge.status === 200 && noBridge.tickets.length === 0, J([noBridge.status, noBridge.answer]));

    /* ===== CTR-214: the head pairs (engine v1.84.0 bridge.heads[] against ValDtls.*Val and _cb.slabs[]). Hand figures (this test only): T1 = IN intra, 1 x 180.00 @5% + 2 x 100.50 @18%:
       CGST 4.50 + 18.09 = 22.59 [2259], SGST 22.59, slab 5 base 180.00 [18000] CGST 4.50 [450], slab 18 base 201.00 [20100] CGST 18.09 [1809]. ===== */
    const sendOf = require(path.join(API, 'lib', 'send-money'));
    const two = [line('Tea', 180, 1, 5), line('Rice', 100.5, 2, 18)];
    const t1 = (edit, party) => {
      const inv = JSON.parse(J(taxLines.invoiceFor({ lines: two, seller: taxLines.partyOf(party || shopRow), buyer: {}, currency: 'INR', at: '2026-11-08T05:00:00Z', priceIncludesTax: false }).invoice));
      if (edit) edit(inv);
      return inv;
    };
    const body2 = (inv, extra) => Object.assign(body(inv, extra), { line_items: two });
    const heads = t1()._cb.bridge.heads;
    ok('T1: the engine wrote heads: total CGST 2259 / SGST 2259, slab 5 (450, base 18000), slab 18 (1809, base 20100)', Array.isArray(heads) && heads.length === 3 && heads[0].minor.CgstVal === 2259 && heads[0].minor.SgstVal === 2259 && heads[1].rate === 5 && heads[1].minor.CgstVal === 450 && heads[1].base_minor === 18000 && heads[2].minor.CgstVal === 1809 && heads[2].base_minor === 20100 && heads.every((row) => row.currency === 'INR'), J(heads));
    const t1ok = await send(body2(t1(), { currency: 'INR' }));
    ok('T1: a correct two-rate bill passes the send: 200, no ticket', t1ok.status === 200 && t1ok.tickets.length === 0, J([t1ok.status, t1ok.answer]));
    const t5 = await send(body2(t1((i) => { i.ValDtls.CgstVal = 22.6; i.ValDtls.SgstVal = 22.58; })));
    ok('T5: CGST +0.01 / SGST -0.01 (total, taxable, round-off and the sum untouched) → 409, pair total:CgstVal 2259 vs 2260, nothing stored, ONE ticket', t5.status === 409 && t5.answer.pair === 'total:CgstVal' && t5.answer.bridge_minor === 2259 && t5.answer.carried_minor === 2260 && t5.copies === null && t5.tickets.length === 1, J(t5.answer));
    ok('T5: the shopkeeper sentence shows both figures with the point in place, no field path; the ticket carries the paths', /22\.59/.test(t5.answer.words) && /22\.60/.test(t5.answer.words) && !/_cb|ValDtls|minor/.test(t5.answer.words) && t5.tickets[0].t.money_mismatch.bridge_field === '_cb.bridge.heads[total].minor.CgstVal' && t5.tickets[0].t.money_mismatch.carried_field === 'ValDtls.CgstVal', J([t5.answer.words, t5.tickets[0] && t5.tickets[0].t.money_mismatch]));
    const slabMove = await send(body2(t1((i) => { i._cb.slabs[0].CgstVal = 4.51; })));
    ok('a split moved inside ONE rate (slab 5 CGST 4.51, ValDtls untouched) → 409 slab:5:CgstVal 450 vs 451, one ticket', slabMove.status === 409 && slabMove.answer.pair === 'slab:5:CgstVal' && slabMove.answer.bridge_minor === 450 && slabMove.answer.carried_minor === 451 && slabMove.tickets.length === 1, J(slabMove.answer));
    const baseMove = await send(body2(t1((i) => { i._cb.slabs[0].AssVal = 181; i._cb.slabs[1].AssVal = 200; })));
    ok('a taxable base moved between rates (181 / 200, same 381) → 409 slab:5:base 18000 vs 18100', baseMove.status === 409 && baseMove.answer.pair === 'slab:5:base' && baseMove.answer.bridge_minor === 18000 && baseMove.answer.carried_minor === 18100, J(baseMove.answer));
    const planted = await send(body2(t1((i) => { i.ValDtls.IgstVal = 0.01; })));
    ok('0.01 planted on a head the engine zeroed (IGST) → 409 total:IgstVal 0 vs 1 (plain equality, the api names no head)', planted.status === 409 && planted.answer.pair === 'total:IgstVal' && planted.answer.bridge_minor === 0 && planted.answer.carried_minor === 1, J(planted.answer));
    const cur = await send(body2(t1(), { currency: 'USD' }));
    ok('a head row in INR on a USD chit → 409 heads:currency, one ticket (CUR-1)', cur.status === 409 && cur.answer.pair === 'heads:currency' && cur.tickets.length === 1, J(cur.answer));
    const dup = await send(body2(t1((i) => { i._cb.slabs.push(Object.assign({}, i._cb.slabs[0])); })));
    ok('a duplicate GstRt row planted in _cb.slabs (3 carried, 2 heads rows) → 409 heads:slabs 2 vs 3', dup.status === 409 && dup.answer.pair === 'heads:slabs' && dup.answer.bridge_minor === 2 && dup.answer.carried_minor === 3, J(dup.answer));
    const noRow = await send(body2(t1((i) => { i._cb.slabs[1].GstRt = 12; })));
    ok('a heads slab row with no carried slab of that rate (18 renamed 12) → 409 slab:18, missing figure, "missing its e-invoice tax amount"', noRow.status === 409 && noRow.answer.pair === 'slab:18' && noRow.answer.missing === 'figure' && /missing its e-invoice tax amount/.test(noRow.answer.words), J(noRow.answer));
    const twin = await send({ ...body2(t1((i) => { i.ValDtls.CgstVal = 22.6; })), client_ref: 'c214-a' });
    const twin2 = await send({ ...body2(t1((i) => { i.ValDtls.CgstVal = 22.6; })), client_ref: 'c214-b' }, true);
    ok('the same refused bill under a new client_ref is ONE ticket (the key is shop, bill, pair and both minor values)', twin.status === 409 && twin2.status === 409 && TICKETS.length === 1, J(TICKETS.length));
    /* no heads: a COUNTER bill before the floor passes and is counted; on or after the floor it is refused; a bill built here (where 'send') with no heads is refused */
    const before = sendOf.headsAbsentCount();
    const oldTill = await send(body2(t1((i) => { delete i._cb.bridge.heads; })));
    ok('a counter bill with no heads and no engine stamp (an old till) → 200, no ticket, COUNTED', oldTill.status === 200 && oldTill.tickets.length === 0 && sendOf.headsAbsentCount() === before + 1, J([oldTill.status, oldTill.answer, before, sendOf.headsAbsentCount()]));
    const realBuild = taxLines.invoiceFor;
    taxLines.invoiceFor = (q) => { const out = realBuild(q); delete out.invoice._cb.bridge.heads; return out; };
    const atSend = await send({ ...body2(t1()), business_json: { bill_no: 'S1-0001', billed_at: '2026-11-08T05:00:00Z', customer: { name: 'Walk-in' } } });
    taxLines.invoiceFor = realBuild;
    ok('a bill BUILT AT SEND with its heads stripped (the tamper case) → 409 pair heads, nothing stored, one ticket', atSend.status === 409 && atSend.answer.pair === 'heads' && atSend.copies === null && atSend.tickets.length === 1, J([atSend.status, atSend.answer]));
    const builtAtSend = await send({ ...body2(t1()), business_json: { bill_no: 'S2-0001', billed_at: '2026-11-08T05:00:00Z', customer: { name: 'Walk-in' } } });
    ok('a bill built at send by the real engine carries heads and passes: 200, no ticket', builtAtSend.status === 200 && builtAtSend.tickets.length === 0, J([builtAtSend.status, builtAtSend.answer]));
    const draftNoHeads = await send({ ...body2(t1((i) => { delete i._cb.bridge.heads; i.ValDtls.CgstVal = 1; })), is_draft: true });
    ok('a draft with a planted head is never stopped', draftNoHeads.status === 200, J(draftNoHeads.answer));

    /* T2 to T4 and T6 at the compare itself, with the real engine (hand figures in the cases): every pair of a correct bill agrees → null */
    const au = { identity_id: SHOP, country: 'AU', gstn: '51824753556', policy_flags: { price_includes_tax: 'no' }, display_name: 'AU Shop' };
    const ae = { identity_id: SHOP, country: 'AE', gstn: '100123456700003', policy_flags: { price_includes_tax: 'no' }, display_name: 'AE Shop' };
    const mk = (party, buyer, lines, currency) => JSON.parse(J(taxLines.invoiceFor({ lines, seller: taxLines.partyOf(party), buyer: buyer || {}, currency, at: '2026-11-08T05:00:00Z', priceIncludesTax: false }).invoice));
    const send0 = { where: 'send' };
    const T2 = mk(shopRow, { state: 'Karnataka', pos: '29' }, [line('Item', 99.99, 3, 18)], 'INR');
    ok('T2 IN inter-state (IGST 18% of 299.97 = 53.9946, half-up 53.99 [5399]): the engine wrote IGST 5399 in heads and the compare agrees', !!T2._cb.bridge.heads && T2._cb.bridge.heads[0].minor.IgstVal === 5399 && sendOf.pairMismatchOf(T2, 'INR', send0) === null, J(T2._cb.bridge.heads));
    const T2bad = JSON.parse(J(T2));
    T2bad.ValDtls.IgstVal = 54;
    ok('T2 tamper: IGST 54.00 → refused total:IgstVal', (sendOf.pairMismatchOf(T2bad, 'INR', send0) || {}).pair === 'total:IgstVal', '');
    const T3 = mk(au, {}, [Object.assign(line('Bread', 4.5, 1, 0), { supply_kind: 'gst_free' }), line('Pen', 20, 1, 10)], 'AUD');
    ok('T3 AU, a GST-free line plus a 10% line: heads written (rate 0 slab, no TaxVal carried reads 0) and the compare agrees', !!T3._cb.bridge.heads && sendOf.pairMismatchOf(T3, 'AUD', send0) === null, J(T3._cb.bridge.heads));
    const T4 = mk(ae, {}, [line('Item', 100, 1, 5)], 'AED');
    ok('T4 AE 5% on 100.00 (VAT 5.00 [500]): heads written and the compare agrees', !!T4._cb.bridge.heads && sendOf.pairMismatchOf(T4, 'AED', send0) === null, J(T4._cb.bridge.heads));
    const T6 = mk(shopRow, {}, [line('A', 0.3, 1, 5), line('B', 0.3, 1, 5), line('C', 0.3, 1, 5)], 'INR');
    const reRound = JSON.parse(J(T6));
    reRound.ValDtls.CgstVal = 0.02;
    ok('T6 round-off per line (3 x 0.30 @5%: CGST 0.01 each = 0.03 [3]): a later re-round to 0.02 is a disagreement, not rounding', T6._cb.bridge.heads[0].minor.CgstVal === 3 && sendOf.pairMismatchOf(T6, 'INR', send0) === null && (sendOf.pairMismatchOf(reRound, 'INR', send0) || {}).pair === 'total:CgstVal', J(T6._cb.bridge.heads));

    /* ===== CTR-214 review: M6 cases (T5c, T9, a plant on a 0% slab) and the stamp rule for a missing `heads` ===== */
    const t5c = await send(body2(t1((i) => { i.ValDtls.CgstVal = 0; i.ValDtls.SgstVal = 0; i.ValDtls.IgstVal = 45.18; })));
    ok('T5c: IGST 45.18 in place of CGST 22.59 + SGST 22.59 (total, taxable, round-off and the sum untouched) → 409 total:CgstVal 2259 vs 0, nothing stored, ONE ticket', t5c.status === 409 && t5c.answer.pair === 'total:CgstVal' && t5c.answer.bridge_minor === 2259 && t5c.answer.carried_minor === 0 && t5c.copies === null && t5c.tickets.length === 1, J(t5c.answer));
    /* T9: a 3-decimal bill. 1 x 100.000 @5%: CGST 2.500 [2500], SGST 2.500, base 100.000 [100000]; built from the engine's IN answer with every minor figure written in thousandths by hand */
    const kwd = (edit) => {
      const inv = JSON.parse(J(taxLines.invoiceFor({ lines: [line('K', 100, 1, 5)], seller: taxLines.partyOf(shopRow), buyer: {}, currency: 'INR', at: '2026-11-08T05:00:00Z', priceIncludesTax: false }).invoice));
      inv._cb.bridge.decimals = 3;
      inv._cb.bridge.steps.forEach((x) => { x.amount_minor = Math.round(x.amount * 1000); });
      inv._cb.bridge.heads.forEach((row) => { row.currency = 'KWD'; Object.keys(row.minor).forEach((k) => { row.minor[k] *= 10; }); if (row.base_minor !== undefined) row.base_minor *= 10; });
      if (edit) edit(inv);
      return inv;
    };
    const kwdHeads = kwd()._cb.bridge.heads;
    ok('T9: the KWD fixture carries CGST 2500, SGST 2500, base 100000 in thousandths', kwdHeads[0].minor.CgstVal === 2500 && kwdHeads[1].base_minor === 100000, J(kwdHeads));
    const kwdOk = await send({ ...body(kwd()), line_items: [line('K', 100, 1, 5)], business_json: { ...body(kwd()).business_json, currency: 'KWD' } });
    ok('T9: a correct 3-decimal bill with heads passes: 200, no ticket', kwdOk.status === 200 && kwdOk.tickets.length === 0, J([kwdOk.status, kwdOk.answer]));
    const kwdBadHead = await send({ ...body(kwd((i) => { i.ValDtls.CgstVal = 2.501; })), line_items: [line('K', 100, 1, 5)] });
    ok('T9: CGST 2.501 (one fils) → 409 total:CgstVal 2500 vs 2501, one ticket (thousandths, not hundredths)', kwdBadHead.status === 409 && kwdBadHead.answer.pair === 'total:CgstVal' && kwdBadHead.answer.bridge_minor === 2500 && kwdBadHead.answer.carried_minor === 2501 && kwdBadHead.tickets.length === 1, J(kwdBadHead.answer));
    /* a head planted on a 0% slab: the AU GST-free slab carries no TaxVal (reads 0); 0.01 planted there disagrees with the engine's 0 */
    const T3plant = JSON.parse(J(T3));
    T3plant._cb.slabs.find((row) => Number(row.GstRt) === 0).TaxVal = 0.01;
    const plantOn0 = sendOf.pairMismatchOf(T3plant, 'AUD', send0) || {};
    ok('a head (0.01) planted on the 0% slab → refused slab:0:TaxVal, bridge 0 vs carried 1', plantOn0.pair === 'slab:0:TaxVal' && plantOn0.bridge_minor === 0 && plantOn0.carried_minor === 1, J(plantOn0));
    /* a missing `heads` is refused only when the bill's OWN engine stamp is tax@1.84.0 or later; an older or unknown stamp is counted (log send.heads_absent), never refused */
    const bare = t1((i) => { delete i._cb.bridge.heads; });
    const seen = sendOf.headsAbsentCount();
    ok('a 1.84.0 stamp without heads → refused (pair heads, rows missing)', (sendOf.pairMismatchOf(bare, 'INR', { where: 'send', engine: 'tax@1.84.0' }) || {}).missing === 'rows' && sendOf.headsAbsentCount() === seen, '');
    ok('a 1.85.2 and a 2.0.0 stamp without heads → refused (later than 1.84)', (sendOf.pairMismatchOf(bare, 'INR', { where: 'send', engine: 'tax@1.85.2' }) || {}).missing === 'rows' && (sendOf.pairMismatchOf(bare, 'INR', { where: 'counter', engine: 'tax@2.0.0' }) || {}).missing === 'rows', '');
    ok('a 1.83.0 stamp without heads → passes and is COUNTED', sendOf.pairMismatchOf(bare, 'INR', { where: 'send', engine: 'tax@1.83.0' }) === null && sendOf.headsAbsentCount() === seen + 1, J(sendOf.headsAbsentCount()));
    ok('a 1.9.0 stamp (1.9 is below 1.84, numbers not text) and no stamp at all → pass and are COUNTED', sendOf.pairMismatchOf(bare, 'INR', { where: 'counter', engine: 'tax@1.9.0' }) === null && sendOf.pairMismatchOf(bare, 'INR', { where: 'counter' }) === null && sendOf.headsAbsentCount() === seen + 3, J(sendOf.headsAbsentCount()));
    const stamped = (engine) => ({ stamps: { money: { by: 'chits send', engine, where: 'counter', at: 'TS' } } });
    const s184 = await send(body2(bare, stamped('tax@1.84.0')));
    ok('route: a carried bill stamped tax@1.84.0 with no heads → 409 pair heads, one ticket', s184.status === 409 && s184.answer.pair === 'heads' && s184.tickets.length === 1, J(s184.answer));
    const s183 = await send(body2(bare, stamped('tax@1.83.0')));
    ok('route: the same bill stamped tax@1.83.0 → 200, no ticket', s183.status === 200 && s183.tickets.length === 0, J([s183.status, s183.answer]));

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
