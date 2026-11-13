/**
 * tests/ctr-244-price-drift.test.cjs - CTR-244 (CTR-212 S3): at SEND the server says ONCE (one service ticket) that a bill's prices were out of date when the sale was rung. The bill is stored
 * exactly as sold; nothing is re-priced and nothing is refused. The stamp is the COLUMN catalogue_items.commercial_changed_at (b845), the compare is the counter gate's (CTR-243).
 * Hand computation (engine, 2 x 100.00 excl @18% intra-state): 200.00 + CGST 18.00 + SGST 18.00 = 236.00 (23600 minor). The catalogue moved to 120.00 at T0 = 2026-11-13T10:00Z.
 * Both sides are read as carried / stored values; no case here recomputes 283.20 (2 x 120 + 43.20) on the server.
 * Run: node tests/ctr-244-price-drift.test.cjs
 */
'use strict';
const path = require('path');
const fs = require('fs');
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
const ITEM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GONE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const T0 = '2026-11-13T10:00:00.000Z';
const HOUR = 3600000;
const at = (ms) => new Date(Date.parse(T0) + ms).toISOString();
const shopRow = { status: 'active', identity_type: 'entity', identity_id: SHOP, bridge_id: 'CB-SHOP', display_name: 'Test Shop', country: 'IN', gstn: '33AABCK1234F1Z6', policy_flags: { price_includes_tax: 'no' } };
/** what the catalogue holds now; each case sets it. */
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
const invoiceFor = (lines) => JSON.parse(J(taxLines.invoiceFor({ lines, seller: taxLines.partyOf(shopRow), buyer: {}, currency: 'INR', at: '2026-11-13T05:00:00Z', priceIncludesTax: false }).invoice));
const tillHtml = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8');
const BUILD = (/var TILL_BUILD = '([^']+)';/.exec(tillHtml) || [])[1];
if (!BUILD) throw new Error('till.html declares no TILL_BUILD');
let BILL = 0;
/** one bill body: billed_at, optional price_basis, the till build stamp (a build that sends price_basis); `lines` default to one ITEM line */
function bill(opts) {
  const o = opts || {};
  const lines = o.lines || [mkLine()];
  const business = { bill_no: o.no || 'C1-' + String(++BILL).padStart(4, '0'), till: o.noBuild ? { id: 'C1' } : { id: 'C1', build: BUILD }, billed_at: o.billed || at(HOUR), customer: { name: 'Walk-in' }, invoice: invoiceFor(lines) };
  if (o.basis) business.price_basis = o.basis;
  return { purpose: 'order', subject: 'Bill', recipients: [{ self: true, name: 'self' }], line_items: lines, is_draft: !!o.draft, business_json: business };
}
/** a catalogue row: the shelf price and rate now, and when the commercial stamp moved */
const row = (price, rate, changed, extra) => Object.assign({ item_id: ITEM, item_data: { name: 'Item', price: { amount: price, currency: 'INR' }, gst_rate: rate }, is_active: true, commercial_changed_at: changed }, extra || {});
const storedTotal = (copies) => {
  const m = /"TotInvVal":(\d+(?:\.\d+)?)/.exec(J(copies));
  return m ? Number(m[1]) : null;
};
const facts = (r) => r.tickets[0] && r.tickets[0].t.money_mismatch;

(async () => {
  const server = app.listen(0);
  PORT = server.address().port;
  try {
    const hand = invoiceFor([mkLine()]);
    ok('hand sum: 2 x 100.00 + 18.00 + 18.00 = 236.00 (23600 minor)', hand.ValDtls.TotInvVal === 236 && hand._cb.bridge.steps.find((s) => s.name === 'total').amount_minor === 23600, J(hand.ValDtls));

    /* row 1: the catalogue moved to 120.00 at T0; the bill was rung at T0+1h at 100.00 and carries no price_basis answer */
    ROWS = [row(120, 18, T0)];
    const r1 = await send(bill());
    ok('1 billed T0+1h, carried 100, no price_basis: stored, 200', r1.status === 200 && r1.copies !== null, J([r1.status, r1.answer]));
    ok('1 stored total is still 236.00 (nothing re-priced)', storedTotal(r1.copies) === 236, J(storedTotal(r1.copies)));
    const f1 = facts(r1);
    ok('1 ONE ticket: carried 10000 vs row 12000 minor, stamp named', r1.tickets.length === 1 && f1.price_drift.lines.length === 1 && f1.price_drift.lines[0].carried.price_minor === 10000 && f1.price_drift.lines[0].row.price_minor === 12000 && f1.price_drift.lines[0].changed_at === T0 && f1.price_drift.lines[0].reason === 'price_moved', J(f1));
    ok('1 the ticket names the bill, goes to the platform desk from the shop; the answer is the ordinary 200 (never a 4xx)', f1.bill === 'C1-0001' && r1.tickets[0].t.audience === 'platform' && r1.tickets[0].from.entity_id === SHOP && r1.answer.ok !== false, J(r1.answer));
    ok('1 ONE extra read per bill (items ANY): one catalogue_items query', r1.reads === 1, String(r1.reads));

    /* row 2: the same body again, under new refs (a retry): no second ticket */
    const body2 = bill({ no: 'C1-0900' });
    const a = await send(body2);
    const b = await send(Object.assign({}, body2, { client_ref: 'c244-new-ref' }), true);
    const c = await send(Object.assign({}, body2, { client_ref: 'c244-new-ref-2' }), true);
    ok('2 the same bill sent again under new refs is ONE ticket in all (key = shop, bill, item, carried figure, stamp)', TICKETS.length === 1 && a.tickets.length === 1 && c.status === 200, J([TICKETS.length, a.status, b.status, c.status]));
    const d = await send(bill({ no: 'C1-0901' }), true);
    ok('2 a SECOND bill the same day is a second ticket', TICKETS.length === 2 && d.status === 200, String(TICKETS.length));

    /* row 3: billed T0-1h: the change came after the sale */
    const r3 = await send(bill({ billed: at(-HOUR) }));
    ok('3 billed T0-1h: no ticket (the change came after the sale), stored 236.00', r3.status === 200 && r3.tickets.length === 0 && storedTotal(r3.copies) === 236, J([r3.status, r3.tickets.length]));

    /* row 4: carried 120 */
    const r4 = await send(bill({ lines: [mkLine({ price: 120, list_price: 120, total: 240 })] }));
    ok('4 carried 120 = the row: no ticket', r4.status === 200 && r4.tickets.length === 0, J(r4.tickets.length));

    /* row 5: rate moved 18 -> 12 at T0, carried rate 18 (price unchanged) */
    ROWS = [row(100, 12, T0)];
    const r5 = await send(bill());
    ok('5 rate moved 18 -> 12, carried 18: ONE ticket, reason rate_moved, 18 vs 12 both carried', r5.tickets.length === 1 && facts(r5).price_drift.lines[0].reason === 'rate_moved' && facts(r5).price_drift.lines[0].carried.gst_rate === 18 && facts(r5).price_drift.lines[0].row.gst_rate === 12, J(facts(r5)));
    ok('5 stored total stays 236.00 (224.00 is what a recheck would show, never stored)', storedTotal(r5.copies) === 236 && !/"TotInvVal":224/.test(J(r5.copies)), J(storedTotal(r5.copies)));

    /* rows 6 and 7: the bill was already answered */
    ROWS = [row(120, 18, T0)];
    const r6 = await send(bill({ basis: { checked: false, at: at(HOUR), snapshot_at: at(-2 * HOUR), reason: 'offline', stale_ack: { at: at(HOUR), via: 'auto', reason: 'price_moved', lines: [] } } }));
    ok('6 price_basis.stale_ack (CTR-243): no ticket', r6.status === 200 && r6.tickets.length === 0, J(r6.tickets.length));
    const r7 = await send(bill({ basis: { checked: true, at: at(HOUR), kept: [{ item_id: ITEM, by: 'owner', why: 'price kept', carried: 100, current: 120 }] } }));
    ok('7 price_basis.kept (owner PIN): no ticket', r7.status === 200 && r7.tickets.length === 0, J(r7.tickets.length));
    ok('7 money_override and credit_override are answered too (unit; on a balanced bill the send step drops a claimed override, so it is read here)', drift.answeredOf({ money_override: { by: 'x' }, price_basis: {} }) === 'money_override' && drift.answeredOf({ credit_override: { by: 'x' } }) === 'credit_override', '');
    const r7b = await send(bill({ basis: { checked: false, reason: 'offline', stale_unchecked: { at: at(HOUR), tries: 9, mode: 'wait' } } }));
    ok('7 stale_unchecked (door down, chip shown) and a recorded offline / recheck_failed reason: no ticket', r7b.tickets.length === 0 && drift.answeredOf({ price_basis: { reason: 'recheck_failed' } }) === 'recheck_failed' && drift.answeredOf({ price_basis: { reason: 'offline' } }) === 'offline', J(r7b.tickets.length));
    const r7c = await send(bill({ basis: { checked: true, at: at(HOUR), reason: 'recheck' } }));
    ok('7 a bill whose price_basis says it was CHECKED but carries the old price is still judged: ONE ticket', r7c.tickets.length === 1, J(r7c.tickets.length));

    /* row 8: a late bill and a 40-day-old one: stored 236.00 unrepriced, the ticket says it was stale at the sale */
    const r8 = await send(bill({ billed: at(HOUR + 20 * HOUR) }));
    ok('8 20 h later: stored 236.00 unrepriced, one ticket', r8.status === 200 && storedTotal(r8.copies) === 236 && r8.tickets.length === 1, J([r8.status, r8.tickets.length]));
    ROWS = [row(120, 18, '2026-10-03T10:00:00.000Z')];
    const r8b = await send(bill({ billed: '2026-10-04T10:00:00.000Z' }));
    ok('8 a 40-day-old bill replayed now: stored 236.00 unrepriced, one ticket', r8b.status === 200 && storedTotal(r8b.copies) === 236 && r8b.tickets.length === 1, J([r8b.status, r8b.tickets.length]));
    ROWS = [row(120, 18, T0)];

    /* row 9: the filing throws, then the read throws: the bill is still stored and answered 200, a log only */
    TICKET_THROWS = true;
    const r9 = await send(bill());
    TICKET_THROWS = false;
    ok('9 the ticket filing throws: the bill is stored and answers 200', r9.status === 200 && r9.copies !== null && storedTotal(r9.copies) === 236, J([r9.status, r9.answer]));
    READ_FAILS = true;
    const r9b = await send(bill());
    READ_FAILS = false;
    ok('9 the catalogue read throws: the bill is stored and answers 200, no ticket', r9b.status === 200 && r9b.copies !== null && r9b.tickets.length === 0, J([r9b.status, r9b.answer]));

    /* row 10: the break test is a mutation run (the call removed), recorded in the PR; here the step is placed and the projection is the lib's */
    const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const chitsSrc = strip(require(path.join(API, 'tools', 'chits-files.cjs')).read(API));
    ok('10 guard: sendPriceDrift sits in SEND_STEPS after sendStock and before sendBooks (after the store)', /sendWrite,[\s\S]*sendStock,\s*sendPriceDrift,\s*sendBooks/.test(chitsSrc), '');
    ok('10 guard: routes/chits.js never requires routes/till.js; lib/price-drift and routes/till.js read the row through lib/till-row', !/require\('\.\/till'\)|routes\/till/.test(chitsSrc) && /require\('\.\/till-row'\)/.test(fs.readFileSync(path.join(API, 'lib', 'price-drift.js'), 'utf8')) && /require\('\.\.\/lib\/till-row'\)/.test(fs.readFileSync(path.join(API, 'routes', 'till.js'), 'utf8')), '');

    /* exemptions of the line: a free line, a network line, a mistyped id, a soft-removed product, a row with no stamp, a draft, an old till build */
    const free = await send(bill({ lines: [mkLine({ item_id: undefined })] }));
    const net = await send(bill({ lines: [mkLine({ item_id: 'src:brand:sku1' })] }));
    const typo = await send(bill({ lines: [mkLine({ item_id: 'not-a-uuid' })] }));
    ok('11 a free line, a network line and a mistyped id: no ticket, no read', free.tickets.length === 0 && net.tickets.length === 0 && typo.tickets.length === 0 && free.reads + net.reads + typo.reads === 0, J([free.tickets.length, net.tickets.length, typo.tickets.length]));
    ROWS = [row(120, 18, T0, { is_active: false })];
    ok('11 a soft-removed product: no ticket (#1219 case 27)', (await send(bill())).tickets.length === 0, '');
    ROWS = [row(120, 18, null)];
    ok('11 a row with no commercial stamp (before b845 ran): no ticket (counted unknown, never read as a fault)', (await send(bill())).tickets.length === 0, '');
    ROWS = [row(120, 18, T0)];
    ok('11 a draft is never judged', (await send(bill({ draft: true }))).tickets.length === 0, '');
    ok('11 a bill with no price_basis and no till build stamp is exempt (old build)', (await send(bill({ noBuild: true }))).tickets.length === 0 && drift.answeredOf({ till: { id: 'C1' } }) === 'old_till_build', '');
    const mods = await send(bill({ lines: [mkLine({ mods: [{ name: 'Extra', price: 10 }], price: 110, list_price: 110 })] }));
    ok('11 a line with chosen modifiers is compared on its rate only (named limit): price alone raises none', mods.tickets.length === 0, J(mods.tickets.length));

    /* a product the shop no longer holds (hard-deleted): ticket either way, the date said unknown */
    ROWS = [];
    const gone = await send(bill({ lines: [mkLine({ item_id: GONE })] }));
    ok('12 a hard-deleted catalogue product: ONE ticket, date_unknown, the stored bill unchanged', gone.tickets.length === 1 && facts(gone).price_drift.lines[0].date_unknown === true && facts(gone).price_drift.lines[0].reason === 'not_found' && storedTotal(gone.copies) === 236, J(facts(gone)));
    ok('12 and its words say the date is unknown', /date unknown/.test(gone.tickets[0].t.detail), gone.tickets[0].t.detail);

    /* the clock: a counter clock that runs slow hides a drift and never invents one; the 2-minute slack leans toward a ticket */
    ROWS = [row(120, 18, T0)];
    ok('13 clock: billed 1 minute before the stamp (inside the 2-minute slack) raises one ticket', (await send(bill({ billed: at(-60000) }))).tickets.length === 1, '');
    ok('13 clock: billed 3 minutes before the stamp raises none', (await send(bill({ billed: at(-180000) }))).tickets.length === 0, '');
    ok('13 the counter already had the change (the stamp is at or before price_basis.snapshot_at): no ticket', (await send(bill({ basis: { checked: true, snapshot_at: at(30 * 60000) } }))).tickets.length === 0, '');
  } catch (e) {
    fail++;
    console.log('   FAIL the harness threw: ' + (e && e.stack));
  }
  server.close();
  console.log(`\n  ${pass} passed, ${fail} failed · ${pass + fail} checks\n`);
  process.exitCode = fail ? 1 : 0;
})();
