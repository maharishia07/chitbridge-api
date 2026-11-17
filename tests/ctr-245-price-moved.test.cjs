/**
 * tests/ctr-245-price-moved.test.cjs - CTR-245 (CTR-212 S4): a draft promoted long after it was priced. The server names the lines whose catalogue row moved after the draft was made
 * (equality of two carried figures, lib/price-moved over lib/price-drift); a PERSON waiting gets 409 PRICE_MOVED; the shop's own loopback (auto) and a till body are never refused.
 * Hand computation (engine, 2 x 100.00 excl @18% intra-state): 200.00 + 18.00 + 18.00 = 236.00; at 120.00: 240.00 + 21.60 + 21.60 = 283.20; at 12%, 100.00: 200.00 + 12.00 + 12.00 = 224.00.
 * The draft was made 40 days before T0 = 2026-11-13T10:00Z; the row moved at T0. The server sends no total; the figures here are typed by hand and the engine run is only for the actual.
 * The 409 also carries the total before (the send's own engine run, 236.00) and after (the same engine door at 120.00, 283.20) and who gets the bill; the ack is a signed token bound to draft and person.
 * Run: node tests/ctr-245-price-moved.test.cjs
 */
'use strict';
const path = require('path');
const fs = require('fs');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'ctr245-test-secret';
const jsonWebToken = require('jsonwebtoken');
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
const ITEM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GONE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const T0 = '2026-11-13T10:00:00.000Z';
const HOUR = 3600000;
const at = (ms) => new Date(Date.parse(T0) + ms).toISOString();
const shopRow = { status: 'active', identity_type: 'entity', identity_id: SHOP, bridge_id: 'CB-SHOP', display_name: 'Test Shop', country: 'IN', gstn: '33AABCK1234F1Z6', policy_flags: { price_includes_tax: 'no' } };
/** what the catalogue holds now; each case sets it. */
let MODE = 'person'; /* person | till | key | auto */
let DRAFT_ROLE = 'Draft';
const DRAFT_MADE = '2026-10-04T10:00:00.000Z';
let ROWS = [];
let ITEM_READS = 0;
let READ_FAILS = false;
function rowsFor(sql, params) {
  const s = String(sql);
  if (/FROM catalogue_items/.test(s) && /item_id = ANY/.test(s)) {
    ITEM_READS++;
    if (READ_FAILS) throw new Error('catalogue read failed');
    return ROWS.filter((row) => (params[1] || []).includes(row.item_id));
  }
  if (/SELECT created_at, role FROM chit_header/.test(s)) return DRAFT_ROLE ? [{ created_at: DRAFT_MADE, role: DRAFT_ROLE }] : [];
  if (/SELECT role, business_json->>'page' AS page FROM chit_header/.test(s)) return DRAFT_ROLE ? [{ role: DRAFT_ROLE, page: null }] : [];
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
      if (MODE === 'till') {
        req.api_key = { scopes: ['till'] };
        req.till = holder({ kind: 'api_key', jti: 'k1', scopes: ['till'] }, { till: { id: 'C1' } });
      }
      if (MODE === 'key') req.api_key = { scopes: ['chits'] };
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
const TICKETS = [];
const FILED = new Set(); /* the real raiseticket dedupes on client_ref: the same key twice is ONE ticket */
let TICKET_THROWS = false;
require(path.join(API, 'lib', 'raiseticket')).raise = async (from, who, t) => {
  if (TICKET_THROWS) throw new Error('the desk is down');
  if (t.client_ref && FILED.has(t.client_ref)) return { raised: false, duplicate: true };
  FILED.add(t.client_ref);
  TICKETS.push({ from, who, t });
  return { raised: true, chit_id: 'ticket-' + TICKETS.length };
};
require(path.join(API, 'lib', 'notify')).sendSupportAlert = async () => ({ ok: true });
const taxLines = require(path.join(API, 'lib', 'tax-lines'));
const drift = require(path.join(API, 'lib', 'price-drift'));
const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/chits', require(path.join(API, 'routes', 'chits')));

let PORT = 0;
let N = 0;
async function send(body, keep) {
  COPIES = null;
  ITEM_READS = 0;
  if (!keep) {
    TICKETS.length = 0;
    FILED.clear();
  }
  const res = await fetch(`http://127.0.0.1:${PORT}/api/chits/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: J(Object.assign({ client_ref: 'c244-' + ++N }, body)) });
  return { status: res.status, answer: await res.json().catch(() => ({})), copies: COPIES, tickets: TICKETS.slice(), reads: ITEM_READS };
}
/** the carried line: 2 x 100.00 at 18%, from product ITEM (list_price is the shelf price the counter rang it from) */
const mkLine = (extra) => Object.assign({ item_id: ITEM, particulars: 'Item', name: 'Item', quantity: 2, price: 100, list_price: 100, total: 200, unit: 'each', gst_rate: 18 }, extra || {});
const priceNote = require(path.join(API, 'lib', 'price-note'));
priceNote.isShopOwnSend = () => MODE === 'auto'; /* the verifier itself is lib/price-note's own test; here the caller's kind is the input */
const moved = require(path.join(API, 'lib', 'price-moved'));
/** a web draft promoted: one line from product ITEM at 100.00 (the web mint: price stays, ref names the pick), the draft's id */
const DRAFT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
function promote(opts) {
  const o = opts || {};
  const lines = o.lines || [mkLine()];
  const body = { purpose: 'order', subject: 'Order', recipients: [{ self: true, name: 'self' }], line_items: lines, is_draft: false, promote_draft_id: o.fresh ? undefined : o.draft || DRAFT };
  if (o.ack !== undefined) body.price_ack = o.ack;
  if (o.business) body.business_json = o.business;
  return body;
}
const row = (price, rate, changed, extra) => Object.assign({ item_id: ITEM, item_data: { name: 'Item', price: { amount: price, currency: 'INR' }, gst_rate: rate }, is_active: true, commercial_changed_at: changed }, extra || {});
const storedTotal = (copies) => {
  const m = /"TotInvVal":(\d+(?:\.\d+)?)/.exec(J(copies));
  return m ? Number(m[1]) : null;
};
const storedPrices = (copies) => [...J(copies).matchAll(/"price":(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
const facts = (r) => r.tickets[0] && r.tickets[0].t.money_mismatch;
const ackFrom = (r) => r.answer && r.answer.ack;
/** an ack as the server would sign it, for a test that needs another draft, another person, an old one */
const mintAck = (claims, opts) => jsonWebToken.sign(Object.assign({ kind: 'price_ack', draft: DRAFT, actor: SHOP, lines: [{ item_id: ITEM, changed_at: T0 }] }, claims), process.env.JWT_SECRET, Object.assign({ algorithm: 'HS256', audience: 'cb-price-ack', expiresIn: 300 }, opts || {}));

(async () => {
  const server = app.listen(0);
  PORT = server.address().port;
  try {
    ROWS = [row(120, 18, T0)];
    /* row 1: a person promotes the 40-day-old draft; the catalogue moved to 120.00 at T0 */
    const r1 = await send(promote());
    ok('1 person, no ack: 409 PRICE_MOVED, nothing stored, no ticket', r1.status === 409 && r1.answer.code === 'PRICE_MOVED' && r1.copies === null && r1.tickets.length === 0, J([r1.status, r1.answer.code]));
    const l1 = (r1.answer.lines || [])[0] || {};
    ok('1 ONE line: price_moved, was 10000 now 12000 minor, the item and the stamp named', r1.answer.lines.length === 1 && l1.kind === 'price_moved' && l1.was_minor === 10000 && l1.now_minor === 12000 && l1.item_id === ITEM && l1.changed_at === T0, J(l1));
    ok('1 the body carries the lines and a signed ack; a price-only move may go as drafted', r1.answer.can_send_as_drafted === true && typeof r1.answer.ack === 'string', J(Object.keys(r1.answer)));
    ok('1 ONE catalogue read on a promote', r1.reads === 1, String(r1.reads));
    ok('1 reach: the total before 236.00 (the send\'s own engine run) and after 283.20 (the same engine door at 120.00), in the bill\'s currency, copied never worked out in the route', r1.answer.total && r1.answer.total.before === 236 && r1.answer.total.after === 283.2 && 'currency' in r1.answer.total, J(r1.answer.total));
    ok('1 reach: who gets it (a self bill names no one) and how many lines', r1.answer.reach && Array.isArray(r1.answer.reach.recipients) && r1.answer.reach.lines === 1, J(r1.answer.reach));
    ok('1 the ack is a signed token string, not an object the person could edit', typeof r1.answer.ack === 'string' && r1.answer.ack.split('.').length === 3, String(r1.answer.ack).slice(0, 30));

    /* row 2: "use new prices": the web re-prices once and sends 120.00; the rows now equal the line */
    const r2 = await send(promote({ lines: [mkLine({ price: 120, list_price: 120, total: 240 })] }));
    ok('2 use new prices (120.00 sent): sent, no 409, no ticket, no ack needed, stored at 120', r2.status === 200 && r2.copies !== null && r2.tickets.length === 0 && storedPrices(r2.copies).includes(120) && !storedPrices(r2.copies).includes(100), J([r2.status, r2.answer, storedPrices(r2.copies)]));
    if (storedTotal(r2.copies) !== null) ok('2 stored total is 283.20 (240.00 + 21.60 + 21.60), the engine run for the actual', storedTotal(r2.copies) === 283.2, J(storedTotal(r2.copies)));

    const r2b = await send(promote({ lines: [Object.assign(mkLine({ price: 120, list_price: 120 }), { total: undefined })] }));
    ok('2 use new prices WITHOUT a line total (the web no longer rebuilds one): sent, and the engines total decides: 283.20', r2b.status === 200 && (storedTotal(r2b.copies) === null || storedTotal(r2b.copies) === 283.2), J([r2b.status, r2b.answer, storedTotal(r2b.copies)]));

    /* row 3: send as drafted, with the ack the 409 handed out */
    const ack = ackFrom(r1);
    const r3 = await send(promote({ ack }));
    ok('3 send as drafted with the ack: sent, no second 409, stored at 100', r3.status === 200 && r3.copies !== null && storedPrices(r3.copies).includes(100) && !storedPrices(r3.copies).includes(120), J([r3.status, r3.answer]));
    if (storedTotal(r3.copies) !== null) ok('3 stored total is 236.00 as drafted', storedTotal(r3.copies) === 236, J(storedTotal(r3.copies)));
    const kept = /"ack":\{[^}]*"via":"send_as_drafted"/.test(J(r3.copies)) || /"via":"send_as_drafted"/.test(J(r3.copies));
    ok('3 the ack is recorded on the bill: price_basis.ack with by (the person), at, via and the line with its stamp', kept && J(r3.copies).includes('"price_basis"') && J(r3.copies).includes('"changed_at":"' + T0 + '"') && J(r3.copies).includes('"by":"' + SHOP + '"'), J(r3.copies).slice(0, 400));
    ok('3 no ticket: the person decided', r3.tickets.length === 0, J(r3.tickets.length));

    /* row 4: the ack is bound */
    ok('4 an ack that expired (signed, 10 seconds past its exp): 409 again', (await send(promote({ ack: mintAck({}, { expiresIn: -10 }) }))).status === 409, '');
    ok('4 a good ack made by hand with the right secret, draft, person and stamp is accepted (the check is the claims, not the 409 we issued)', (await send(promote({ ack: mintAck({}) }))).status === 200, '');
    ok('4 an ack signed with another secret, or with its signature cut, is refused', (await send(promote({ ack: jsonWebToken.sign({ kind: 'price_ack', draft: DRAFT, actor: SHOP, lines: [{ item_id: ITEM, changed_at: T0 }] }, 'not-our-secret') }))).status === 409 && (await send(promote({ ack: ack.slice(0, -4) + 'AAAA' }))).status === 409, '');
    ok('4 a token that is no ack (a session-like token, kind other): 409', (await send(promote({ ack: mintAck({ kind: 'session' }) }))).status === 409, '');
    ROWS = [row(125, 18, at(60000))];
    const again = await send(promote({ ack }));
    ok('4 a stamp that moved again since the ack was shown: 409 again, naming 12500', again.status === 409 && again.answer.lines[0].now_minor === 12500 && again.answer.lines[0].changed_at === at(60000), J([again.status, again.answer.lines]));
    ROWS = [row(120, 18, T0)];
    ok('4 an ack for another item does not cover this line: 409', (await send(promote({ ack: mintAck({ lines: [{ item_id: GONE, changed_at: T0 }] }) }))).status === 409, '');
    ok('4 junk (empty text, plain text, an object) is no ack: never a 200', (await send(promote({ ack: '' }))).status === 409 && (await send(promote({ ack: 'yes' }))).status === 409 && (await send(promote({ ack: {} }))).status !== 200, '');
    const askedA = await send(promote({ draft: DRAFT }));
    ok('4 BOUND TO THE DRAFT: the ack the server gave for draft A is refused on draft B (409), and still good on A', (await send(promote({ ack: ackFrom(askedA), draft: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }))).status === 409 && (await send(promote({ ack: ackFrom(askedA) }))).status === 200, '');
    ok('4 BOUND TO THE PERSON: an ack signed for another actor is refused (409)', (await send(promote({ ack: mintAck({ actor: 'someone-else' }) }))).status === 409, '');

    /* row 5: nobody is waiting: the shop's own loopback and any key go as authored plus ONE ticket */
    MODE = 'auto';
    const r5 = await send(promote());
    ok('5 auto token: sent as authored (100), never a 409', r5.status === 200 && r5.copies !== null && storedPrices(r5.copies).includes(100), J([r5.status, r5.answer]));
    const f5 = facts(r5);
    ok('5 ONE ticket: price_moved, 10000 vs 12000, the draft named', r5.tickets.length === 1 && f5.price_drift.lines[0].reason === 'price_moved' && f5.price_drift.lines[0].carried.price_minor === 10000 && f5.price_drift.lines[0].row.price_minor === 12000 && /draft/.test(f5.bill), J(f5));
    MODE = 'key';
    const r5b = await send(promote());
    ok('5 any other key: as authored plus ONE ticket, never a 409', r5b.status === 200 && r5b.tickets.length === 1, J([r5b.status, r5b.tickets.length]));
    MODE = 'person';

    /* row 6: a till body never meets this */
    MODE = 'till';
    const r6 = await send(promote({ business: { till: { id: 'C1', build: 'test-build' }, billed_at: at(HOUR), price_basis: { checked: false, at: at(HOUR) } } }));
    ok('6 a till key with a price_basis body and a promote id: stored, never a 409 (its own check is the CTR-244 ticket)', r6.status === 200 && r6.copies !== null, J([r6.status, r6.answer]));
    const r6b = await send(promote());
    ok('6 a till KEY alone (no price_basis) is a till too: never a 409', r6b.status === 200, J([r6b.status, r6b.answer]));
    MODE = 'person';
    const claim = await send(promote({ business: { till: { id: 'C1', build: 'test-build' }, billed_at: at(HOUR), price_basis: { checked: true, at: at(HOUR) } } }));
    ok('6 WHO IS A TILL is the KEY, never the body: a PERSON whose body claims price_basis and a till build still gets the 409', claim.status === 409 && claim.answer.code === 'PRICE_MOVED', J([claim.status, claim.answer.code]));
    ok('6 unit: whoAsks reads the key scope only (till scope, not connector), a key without it is unattended, no key is a person', moved.whoAsks({ till: { key: { scopes: ['till'] } } }) === 'till' && moved.whoAsks({ till: { key: { scopes: ['till', 'connector'] } }, api_key: {} }) === 'unattended' && moved.whoAsks({ api_key: {} }) === 'unattended' && moved.whoAsks({}) === 'person', '');

    /* row 7: a rate that moved: 18 -> 12 at T0, price unchanged */
    ROWS = [row(100, 12, T0)];
    const r7 = await send(promote());
    ok('7 rate 18 -> 12: 409, kind rate_moved, 18 vs 12, not sendable as drafted', r7.status === 409 && r7.answer.lines[0].kind === 'rate_moved' && r7.answer.lines[0].was_rate === 18 && r7.answer.lines[0].now_rate === 12 && r7.answer.can_send_as_drafted === false, J(r7.answer));
    const r7b = await send(promote({ ack: ackFrom(r7) }));
    ok('7 an ack is REFUSED for a rate move: 409 again', r7b.status === 409, J(r7b.status));
    const r7c = await send(promote({ lines: [mkLine({ gst_rate: 12 })] }));
    ok('7 re-priced at 12 (the web ran its engine): sent; the engine total at 12% is 224.00', r7c.status === 200 && (storedTotal(r7c.copies) === null || storedTotal(r7c.copies) === 224), J([r7c.status, storedTotal(r7c.copies)]));

    /* row 8: withdrawn */
    ROWS = [row(100, 18, T0, { is_active: false })];
    const r8 = await send(promote());
    ok('8 withdrawn product: 409 kind withdrawn, remove or cancel only (an ack does not pass it)', r8.status === 409 && r8.answer.lines[0].kind === 'withdrawn' && r8.answer.can_send_as_drafted === false && (await send(promote({ ack: ackFrom(r8) }))).status === 409, J(r8.answer));

    /* row 9: not named */
    ROWS = [row(120, 18, '2026-09-01T10:00:00.000Z')];
    ok('9 the row moved BEFORE the draft was made: no 409 (the draft already had it)', (await send(promote())).status === 200, '');
    ROWS = [row(120, 18, null)];
    ok('9 a row with no commercial stamp (before b845): no 409', (await send(promote())).status === 200, '');
    ROWS = [row(100, 18, T0)];
    ok('9 the figure is the same (price and rate): no 409', (await send(promote())).status === 200, '');
    ROWS = [];
    ok('9 a product this shop does not hold (another shop id, or deleted): not named', (await send(promote({ lines: [mkLine({ item_id: GONE })] }))).status === 200, '');
    ROWS = [row(120, 18, T0)];
    const fr = await send(promote({ fresh: true }));
    ok('9 a fresh send (no promote_draft_id) is never judged: no read, sent', fr.status === 200 && fr.reads === 0, J([fr.status, fr.reads]));
    const free = await send(promote({ lines: [mkLine({ item_id: undefined })] }));
    ok('9 a free line names no product: no read, sent', free.status === 200 && free.reads === 0, J([free.status, free.reads]));

    /* row 10: the web line names its product by ref.item_id (the storefront and the cart) */
    const refLine = mkLine({ item_id: undefined, ref: { item_id: ITEM, how: 'picked' } });
    const r10 = await send(promote({ lines: [refLine] }));
    ok('10 a line that names its product only by ref.item_id is judged: 409', r10.status === 409 && r10.answer.lines[0].item_id === ITEM, J([r10.status, r10.answer]));

    /* row 11: the check itself fails: the draft goes as drafted, a log only */
    READ_FAILS = true;
    const r11 = await send(promote());
    READ_FAILS = false;
    ok('11 the read throws: sent as drafted (never a 500, never a 409)', r11.status === 200 && r11.copies !== null, J([r11.status, r11.answer]));
    TICKET_THROWS = true;
    MODE = 'auto';
    const r11b = await send(promote());
    TICKET_THROWS = false;
    MODE = 'person';
    ok('11 the ticket filing throws on an auto send: stored, 200', r11b.status === 200 && r11b.copies !== null, J([r11b.status, r11b.answer]));

    /* row 12: a price and a withdrawn line together: both named, an ack refused for the set */
    ok('12 unit: movedOf names a price and a withdrawn line together and ackVerdict refuses the set', (() => {
      const two = moved.movedOf([mkLine(), mkLine({ item_id: GONE })], new Map([[ITEM, row(120, 18, T0)], [GONE, row(100, 18, T0, { item_id: GONE, is_active: false })]]), Date.parse(DRAFT_MADE), 'INR');
      return two.lines.length === 2 && two.lines[1].kind === 'withdrawn' && !moved.ackVerdict(mintAck({}), two, { draft: DRAFT, actor: SHOP }).ok && moved.repricedLines([mkLine(), mkLine({ item_id: GONE })], two).length === 1;
    })(), '');

    /* guards: the steps' places, and a till body returns before any read */
    const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const chitsSrc = strip(require(path.join(API, 'tools', 'chits-files.cjs')).read(API));
    ok('13 guard: sendPriceMoved sits after sendPromote and before sendWrite (nothing stored when it answers 409)', /sendPromote,\s*sendPriceMoved,[\s\S]*sendWrite,/.test(chitsSrc), '');
    ok('13 guard: the ticket is filed AFTER the store: sendMovedTicket follows sendPriceDrift', /sendPriceDrift,\s*sendMovedTicket,\s*sendBooks/.test(chitsSrc), '');
    ok('13 guard: a till body returns before any read (whoAsks till)', /asker === 'till'\) return false/.test(chitsSrc), '');
  } catch (e) {
    fail++;
    console.log('   FAIL the harness threw: ' + (e && e.stack));
  }
  server.close();
  console.log(`\n  ${pass} passed, ${fail} failed · ${pass + fail} checks\n`);
  process.exitCode = fail ? 1 : 0;
})();
