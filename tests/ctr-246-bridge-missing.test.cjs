/**
 * tests/ctr-246-bridge-missing.test.cjs - CTR-246 (CTR-212 S5): a CARRIED invoice with no _cb.bridge from a till build that stamps itself (business_json.till.build) is refused
 * 409 BRIDGE_MISSING, nothing stored, ONE ticket, no override. No stamp (an old build) passes and is COUNTED (send.bridge_absent). The stamp is written at finish, read by shape only.
 * Hand computation: 2 x 100.00 + CGST 18.00 + SGST 18.00 = 236.00 = 23600 minor.
 * Run: node tests/ctr-246-bridge-missing.test.cjs
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
  const res = await fetch(`http://127.0.0.1:${PORT}/api/chits/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: J(Object.assign({ client_ref: 'c246-' + ++N }, body)) });
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

const fs = require('fs');
const sendOf = require(path.join(API, 'lib', 'send-money'));
const withBuild = (build) => ({ till: { id: 'C1', build } });
const noBridge = () => invoiceWith((i) => { delete i._cb; });
const noSteps = () => invoiceWith((i) => { delete i._cb.bridge; });
const tillHtml = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8');
const BUILD = (/var TILL_BUILD = '([^']+)';/.exec(tillHtml) || [])[1];   /* read from the till master, never a literal: the stamp the till sends is the one it carries */
if (!BUILD) throw new Error('till.html declares no TILL_BUILD');
const tillJs = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.js'), 'utf8');

(async () => {
  const server = app.listen(0);
  PORT = server.address().port;
  try {
    const good = invoiceWith();
    ok('T1 hand sum: 236.00 = 23600 minor, bridge present', good.ValDtls.TotInvVal === 236 && good._cb.bridge.steps.find((s) => s.name === 'total').amount_minor === 23600, J(good.ValDtls));
    const t1 = await send(body(good, withBuild(BUILD)));
    ok('T1 a stamped bill WITH its bridge -> 200, no ticket', t1.status === 200 && t1.tickets.length === 0, J([t1.status, t1.answer]));

    const t2 = await send(body(noBridge(), withBuild(BUILD)));
    ok('T2 stamped, whole _cb removed -> 409 BRIDGE_MISSING, nothing stored, one ticket, build echoed', t2.status === 409 && t2.answer.code === 'BRIDGE_MISSING' && t2.answer.build === BUILD && t2.copies === null && t2.tickets.length === 1, J([t2.status, t2.answer]));
    ok('T2 the answer is problem+json shaped (status, code, message) and the words are plain', t2.answer.status === 409 && /tax check figures/.test(t2.answer.words) && /We have been told/.test(t2.answer.words) && !/_cb|bridge|ValDtls/.test(t2.answer.words), J(t2.answer));
    const facts = t2.tickets[0] && t2.tickets[0].t.money_mismatch;
    ok('T2 the ticket goes to the platform desk and carries shop, bill and build', !!facts && t2.tickets[0].t.audience === 'platform' && facts.build === BUILD && facts.bill === 'C1-0001' && t2.tickets[0].from.entity_id === SHOP, J(facts));
    const t3 = await send(body(noSteps(), withBuild(BUILD)));
    ok('T3 stamped, only _cb.bridge removed -> 409 BRIDGE_MISSING', t3.status === 409 && t3.answer.code === 'BRIDGE_MISSING' && t3.copies === null, J([t3.status, t3.answer]));
    const t3o = await send(body(noBridge(), { ...withBuild(BUILD), money_override: { by: 'Asha', why: 'owner says' } }));
    ok('T3 NOT overridable: a typed reason still gets 409', t3o.status === 409 && t3o.answer.code === 'BRIDGE_MISSING' && t3o.copies === null, J([t3o.status, t3o.answer]));

    const before = sendOf.bridgeAbsentCount();
    const t4 = await send(body(noBridge()));
    ok('T4 no till.build (an old build), no bridge -> 200, no ticket, COUNTED', t4.status === 200 && t4.tickets.length === 0 && sendOf.bridgeAbsentCount() === before + 1, J([t4.status, t4.answer, before, sendOf.bridgeAbsentCount()]));
    const t5 = await send(body(noBridge(), withBuild('abc')));
    ok('T5 unreadable stamp "abc" = old build: 200, counted', t5.status === 200 && t5.tickets.length === 0 && sendOf.bridgeAbsentCount() === before + 2, J([t5.status, t5.answer]));
    const t6 = await send({ ...body(noBridge(), withBuild(BUILD)), is_draft: true });
    ok('T6 a draft is never refused', t6.status === 200 && t6.tickets.length === 0, J([t6.status, t6.answer]));

    /* T7 a retry under a NEW client_ref is the same bill: still 409, ONE ticket in all */
    TICKETS.length = 0;
    FILED.clear();
    const a = await send(body(noBridge(), withBuild(BUILD)), true);
    const b = await send(body(noBridge(), withBuild(BUILD)), true);
    ok('T7 the retry is refused again and the ticket count stays 1 (second says already told)', a.status === 409 && b.status === 409 && TICKETS.length === 1 && /already told/.test(b.answer.words), J([a.status, b.status, TICKETS.length, b.answer.words]));

    /* T9 the central rule: an old-build bill rebuilt by the NEW chitOf keeps NO stamp. The REAL tillStamp is cut from till.html and run. */
    const cut = tillHtml.slice(tillHtml.indexOf('function tillStamp('), tillHtml.indexOf('/* PAY-FIX H6'));
    const stamper = new Function('counterName', 'tillHostWord', 'onAgent', 'deviceId', 'personOn', 'CloudHost', cut + '; return tillStamp;')(() => 'C1', () => 'host', () => true, () => 'd', () => false, {});
    const rebuilt = JSON.parse(J(stamper('C1', null, undefined))); /* on the wire (JSON drops an undefined build); */ /* chitOf passes bill.till_build: undefined for a bill finished by an old build */
    ok('T9 old-build bill (no till_build) rebuilt by chitOf -> till has no build key', !('build' in rebuilt), J(rebuilt));
    ok('T9 a bill finished by a new build keeps ITS stamp', stamper('C1', null, '2026-11-05.acc255b').build === '2026-11-05.acc255b', '');
    const t9 = await send(body(noBridge(), { till: rebuilt }));
    ok('T9 and that rebuilt old bill passes the send (never lost)', t9.status === 200 && t9.tickets.length === 0, J([t9.status, t9.answer]));

    /* T10 the stamp shape: the real one, a letters+digits tag, and what is rejected */
    const shapeOk = (v) => sendOf.bridgeMissingOf({ ValDtls: {} }, { build: v }, {}) !== null;
    ok('T10 real shapes accepted: 2026-11-05.acc255b, 2026-11-13.ctr246', shapeOk('2026-11-05.acc255b') && shapeOk('2026-11-13.ctr246'), '');
    ok('T10 rejected: "abc", "", an object, a number, a date with no tag', !shapeOk('abc') && !shapeOk('') && !shapeOk({}) && !shapeOk(20261113) && !shapeOk('2026-11-13'), '');
    /* T11 till absent / not an object: passes, counted */
    const c0 = sendOf.bridgeAbsentCount();
    ok('T11 till absent, a string, an array: all null and counted 3', sendOf.bridgeMissingOf({ ValDtls: {} }, undefined, {}) === null && sendOf.bridgeMissingOf({ ValDtls: {} }, 'x', {}) === null && sendOf.bridgeMissingOf({ ValDtls: {} }, [], {}) === null && sendOf.bridgeAbsentCount() === c0 + 3, '');
    /* T12 no invoice at all: untouched, not counted */
    const c1 = sendOf.bridgeAbsentCount();
    const t12 = await send({ purpose: 'order', subject: 'Note', recipients: [{ self: true, name: 'self' }], line_items: LINES, business_json: { bill_no: 'C1-0002', ...withBuild(BUILD), customer: { name: 'Walk-in' } } });
    ok('T12 a send with no invoice is untouched: no 409, not counted, no ticket', t12.status !== 409 && t12.tickets.length === 0 && sendOf.bridgeAbsentCount() === c1, J([t12.status, t12.answer]));

    /* guards: the stamp is written at finish, the ONE tillStamp carries it, the agent maps it, nothing falls back to today's build */
    ok('guard: finish() sets till_build from TILL_BUILD; chitOf reads bill.till_build into tillStamp', /till_build: TILL_BUILD,/.test(tillHtml) && /till: tillStamp\(bill\.till, bill\.by, bill\.till_build\)/.test(tillHtml), '');
    ok('guard: no fallback to TILL_BUILD in tillStamp or the agent', !/TILL_BUILD/.test(cut) && !/TILL_BUILD/.test(tillJs), '');
    ok('guard: the shop PC program maps bill.till_build into till.build, no fallback', /build: bill[.]till_build [}]/.test(tillJs) && !/till_build.*[|][|]/.test(tillJs), '');
    ok('guard: the red stoprow names BRIDGE_MISSING', /q\._code === 'BRIDGE_MISSING'/.test(tillHtml), '');
    const reg = require(path.join(API, 'docs', 'error-codes.json')).codes.find((c) => c.code === 'BRIDGE_MISSING');
    ok('register: BRIDGE_MISSING is a 409 in the error-code register', !!reg && reg.status === '409' && reg.owner_area === 'chits', J(reg));
    ok('health: both sunset counts are in /health', /absentCounts[(][)]/.test(fs.readFileSync(path.join(API, 'routes', 'health.js'), 'utf8')) && sendOf.absentCounts().send_bridge_absent === sendOf.bridgeAbsentCount() && sendOf.absentCounts().send_heads_absent === sendOf.headsAbsentCount(), '');
  } catch (e) {
    fail++;
    console.log('   FAIL the harness threw: ' + (e && e.stack));
  }
  server.close();
  console.log(`\n  ${pass} passed, ${fail} failed · ${pass + fail} checks\n`);
  process.exit(fail ? 1 : 0);
})();
