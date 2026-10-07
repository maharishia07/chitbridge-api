/**
 * tests/iso8601.test.cjs — NO TIMESTAMP LEAVES STORAGE OR TRANSPORT IN ANY OTHER FORM THAN RFC 3339 (N11).
 *
 * The standards register says ISO 8601 is in force "for storage and transport; screens show your locale". This is the
 * proof of the first half. It builds the things that LEAVE the system and walks every key that names a moment
 * (`*_at`, `at`, `timestamp`, `*_on`), asserting each non-null value is RFC 3339 / ISO 8601 UTC (...T...Z):
 *   1. a SENT chit (POST /api/chits/send, the real route) — the response and every copy handed to delivery;
 *   2. the PACK (lib/books-pack.js build): manifest, every JSON file in the zip, the change-log CSV `at` column;
 *   3. the TALLY files — in the pack, and the connector's own receipt voucher. Tally's wire format for a DATE is
 *      YYYYMMDD (a calendar day, not an instant); asserted to be the ONLY date form, and no instant is written;
 *   4. the JUnit report lib/junitresults.write() — any timestamp attribute.
 * Display is untouched: nothing here reads locale code (Intl), and the walk never formats anything.
 * No database: db, auth and delivery are stubbed; the route and the pack builder are the real ones.
 * Run: node tests/iso8601.test.cjs
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';

const SHOP = '11111111-1111-4111-8111-111111111111', CUST = '22222222-2222-4222-8222-222222222222';
const OUTSIDE = '33333333-3333-4333-8333-333333333333', STRANGER = '44444444-4444-4444-8444-444444444444';
const ROWS = {
  [SHOP]: { identity_id: SHOP, bridge_id: 'CB-SHOP', display_name: 'Mayur Traders', country: 'IN', gstn: '33AAAAA0000A1Z5', status: 'active' },
  [CUST]: { identity_id: CUST, bridge_id: 'CB-CUST', display_name: 'Chola Auto Care', country: 'IN', gstn: '33BBBBB0000B1Z5', status: 'active' },
  [STRANGER]: { identity_id: STRANGER, bridge_id: 'CB-STRG', display_name: 'Some Other Business', country: 'IN', status: 'active' },
};
/* the shop's customer list, and who on it is a business on the rail (OUTSIDE is on the list, but a local ~ record) */
const OTHERWORLD = '55555555-5555-4555-8555-555555555555';   /* on the list, on the rail, in the TEST sandbox */
const LIST = { [CUST]: { rail: true }, [OUTSIDE]: { rail: false }, [OTHERWORLD]: { rail: true, sandbox: 'test' } };
/* lib/istest mayTrade's answer per party — what the database would say about each */
const TRADE = {
  [STRANGER]: { display_name: 'Some Other Business', status: 'active', user_id: 'strg', on_rail: true, same_world: true },
  [OUTSIDE]: { display_name: 'Corner Store', status: 'active', user_id: '~mayur.cus-0001', on_rail: false, same_world: true },
  [OTHERWORLD]: { display_name: 'Test Bakery', status: 'active', user_id: 'testbakery', on_rail: true, same_world: false, theirs: 'test', mine: 'live' },
};
let REPLAY = null, SQL = [];

let LISTED = [];
function rowsFor(sql, p) {
  const s = String(sql);
  SQL.push(s.replace(/\s+/g, ' ').trim());
  if (/INSERT INTO customer_list/.test(s)) { LISTED.push([String(p && p[0]), String(p && p[1])]); return []; }
  if (/to_regprocedure\('chit_deliver/.test(s)) return [{ ok: true }];
  if (/business_json->>'client_ref' = \$2/.test(s)) return REPLAY ? [REPLAY] : [];
  if (/FROM customer_list/.test(s) && /customer_identity_id = \$2/.test(s)) {
    const l = LIST[p && p[1]];
    /* the gate's question: listed AND on the rail AND the same sandbox (lib/istest mayTradeSql) */
    if (/identity_type = 'entity'/.test(s)) return l && l.rail && !(l.sandbox && /population/.test(s)) ? [{ ok: 1 }] : [];
    return l ? [{ ok: 1 }] : [];   /* the second look: is it on the list at all */
  }
  if (/AS same_world/.test(s)) { const t = TRADE[p && p[1]]; return t ? [t] : []; }
  if (/FROM supplier_list/.test(s)) return [];
  if (/SELECT self_copy_pref/.test(s)) return [{ self_copy_pref: null }];
  if (/FROM identities/.test(s) && /identity_id = \$1/.test(s)) { const r = ROWS[p && p[0]]; return r ? [r] : []; }
  return [];
}
const dbPath = require.resolve(path.join(API, 'db'));
const tx = { query: async (s, p) => ({ rows: rowsFor(s, p) }) };
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async (s, p) => ({ rows: rowsFor(s, p) }),
  withEntity: async (id, fn) => fn(tx), withTransaction: async (fn) => fn(tx),
  trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } },
  onEntity: async (id, db, fn) => fn(tx),
} };
let KEY = { scopes: ['till'] };
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: Object.assign(
  (req, res, next) => { req.identity = { identity_id: SHOP, identity_type: 'entity', bridge_id: 'CB-SHOP', display_name: 'Mayur Traders' }; if (KEY) req.api_key = KEY;
    /* M04 — the real holder builder, as middleware/auth sets it */
    req.till = require(path.join(API, 'lib', 'holder')).holderOf(KEY ? { kind: 'api_key', jti: KEY.jti, scopes: KEY.scopes } : req.identity, null); next(); },
  { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (q, s, n) => n(),
    userOf: (req) => req.identity, forgetKey: () => {}, keyAlive: async () => true }) };

const mint = require(path.join(API, 'lib', 'mint'));
let COPIES = null;
mint.deliver = async (sender, chit_id, copies) => { COPIES = copies; return { ok: true }; };
const hooks = require(path.join(API, 'lib', 'books-hooks'));
let HEARD = [];
hooks.afterChit = (e, c) => { HEARD.push(String(e)); return Promise.resolve({}); };
try { require(path.join(API, 'lib', 'meter')).meter = async () => {}; } catch (_) {}
let SHELVES = [];
require(path.join(API, 'lib', 'tax-shelf')).readShelf = async (eid) => { SHELVES.push(String(eid)); return null; };
try { require(path.join(API, 'lib', 'stock-from-chit')).postFor = async () => ({ failed: [], skipped: [] }); } catch (_) {}

const express = require('express');
const app = express(); app.use(express.json());
app.use('/api/chits', require(path.join(API, 'routes', 'chits')));

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

const lines = [{ particulars: 'Brake pad', quantity: 2, unit: 'piece', price: 59, total: 118, gst_rate: 18, hsn: '8708' }];
const bill = (no, customer, extra) => Object.assign({
  purpose: 'order', subject: 'Counter sale ' + no, manual_subject: 'Counter sale ' + no, client_ref: no,
  business_json: { customer, till: { id: 'C1', name: 'Counter 1', host: 'browser' }, bill_no: no, billed_at: '2026-10-01T05:00:00.000Z',
    payment: { mode: 'On credit', paid: 0, parts: [{ how: 'On credit', amount: 118 }] }, slip: 'cash', terms: { credit_days: 15, due_date: '2026-10-16' } },
  line_items: lines.map((l) => Object.assign({}, l)),
}, extra || {});
const chola = { name: 'Chola Auto Care', phone: '9840012345', identity_id: CUST, entity_id: CUST };
const toCust = { name: 'Chola Auto Care', entity_id: CUST, role: 'to', self: false };
const SELF = { self: true, name: 'self' };

/* ── the walk ── */
const RFC3339 = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:([0-5]\d|60)(\.\d+)?Z$/;
const MOMENT_KEY = /(^|_)(at|on|timestamp)$/i;
const SEEN = {};   /* source -> { checked, bad[], nulls, keys } */
function walk(src, v, p) {
  const S = SEEN[src] = SEEN[src] || { checked: 0, bad: [], nulls: 0, keys: new Set() };
  if (Array.isArray(v)) { v.forEach((x, i) => walk(src, x, p + '[' + i + ']')); return; }
  if (v && typeof v === 'object') {
    Object.keys(v).forEach((k) => {
      const x = v[k];
      if (MOMENT_KEY.test(k) && !(x && typeof x === 'object' && !(x instanceof Date))) {
        if (x == null) { S.nulls++; return; }
        S.checked++; S.keys.add(k);
        if (typeof x !== 'string' || !RFC3339.test(x)) S.bad.push(p + '.' + k + ' = ' + JSON.stringify(x));
      } else walk(src, x, p + '.' + k);
    });
    if (v instanceof Date) { S.checked++; S.bad.push(p + ' is a Date object, not a string'); }
  }
}
/* a stored (method 0) zip -> { name: Buffer } — lib/zip-store writes no other kind */
function unzip(buf) {
  const out = {}; let o = 0;
  while (o + 30 <= buf.length && buf.readUInt32LE(o) === 0x04034b50) {
    const size = buf.readUInt32LE(o + 18), n = buf.readUInt16LE(o + 26), m = buf.readUInt16LE(o + 28);
    out[buf.slice(o + 30, o + 30 + n).toString('utf8')] = buf.slice(o + 30 + n + m, o + 30 + n + m + size);
    o += 30 + n + m + size;
  }
  return out;
}
const verdict = (src) => { const S = SEEN[src] || { checked: 0, bad: [] }; return [S.checked > 0 && !S.bad.length, S.checked + ' checked, ' + (S.bad.length ? 'NOT RFC 3339: ' + S.bad.slice(0, 5).join(' · ') : 'all RFC 3339 Z')]; };

const srv = app.listen(0, '127.0.0.1', async () => {
  const send = async (body) => {
    COPIES = null; HEARD = []; SQL = []; LISTED = []; SHELVES = [];
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/chits/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await new Promise((res) => setTimeout(res, 30));
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  try {
    console.log('\n══ ISO 8601 / RFC 3339 — every moment that leaves storage or transport ══\n');
    /* the walker must catch what it claims to: a locale string, a Date, an offset-less time */
    const T0 = 'probe'; walk(T0, { a_at: '18/08/2026', b_at: new Date(), c_at: '2026-08-18T14:32:05', at: '2026-08-18T14:32:05Z', d_at: null }, '$');
    ok('the walk itself: a locale date, a Date object and an offset-less time are each caught; a real one passes; null is skipped',
      SEEN[T0].bad.length === 3 && SEEN[T0].checked === 4 && SEEN[T0].nulls === 1, JSON.stringify(SEEN[T0]));

    /* 1 · the sent chit and its copies */
    const a = await send(bill('C1/26-27/0041', chola, { recipients: [SELF, toCust] }));
    ok('a bill to a rail customer is sent (200) — copies exist to be walked', a.status === 200 && Array.isArray(COPIES) && COPIES.length === 2, a.status + ' ' + JSON.stringify(a.body).slice(0, 160));
    walk('sent chit (response)', a.body, '$');
    (COPIES || []).forEach((c, i) => walk('sent chit (copies)', c, 'copy' + i));
    let v = verdict('sent chit (response)'); ok('the send response — ' + v[1], SEEN['sent chit (response)'].bad.length === 0, v[1]);
    v = verdict('sent chit (copies)'); ok('every copy handed to delivery (shop + customer) — ' + v[1], v[0], v[1]);
    /* a caller's own retention instant is normalised on the way in: a date-only or offset input comes out as ...Z */
    const e1 = await send(bill('C1/26-27/0047', chola, { recipients: [SELF, toCust], expires_at: '2027-03-31' }));
    (COPIES || []).forEach((c, i) => walk('sent chit (copies)', c, 'expiring copy' + i));
    const e2 = await send(bill('C1/26-27/0048', chola, { recipients: [SELF, toCust], expires_at: '2027-03-31T18:30:00+05:30' }));
    (COPIES || []).forEach((c, i) => walk('sent chit (copies)', c, 'offset copy' + i));
    const ret = (COPIES || []).map((c) => c.summary_json && c.summary_json.retention).filter(Boolean);
    ok('a chit sent with expires_at (date-only, then +05:30) is stored as UTC ...Z on every copy', e1.status === 200 && e2.status === 200 && ret.length >= 1 && ret.every((r) => RFC3339.test(r.expires_at)) && ret[0].expires_at === '2027-03-31T13:00:00.000Z', JSON.stringify(ret));

    ok('billed_at rides through unchanged on both copies', (COPIES || []).every((c) => c.business_json.billed_at === '2026-10-01T05:00:00.000Z'), '');

    /* 2 + 3 · the pack, with its Tally files */
    const H = require('./support/books-harness.cjs');
    if (!H.enginesSrc().dir) { ok('the books engines are present (the pack and Tally halves need them)', false, H.enginesSrc().why); throw new Error('no engines'); }
    const X = H.load({});
    X.T.parties.push({ owner: SHOP, party_id: CUST, party_no: 'P-00001', name: 'Chola Auto Care', customer: true, credit_days: 10 });
    await X.B.enable(X.db, SHOP, { by: SHOP, today: '2026-09-29' });
    require(path.join(API, 'lib', 'storage-object')).available = async () => false;
    require(path.join(API, 'lib', 'tax-copy')).ledgerFor = async () => { throw new Error('no chits in this test'); };
    await X.B.postEntry(X.db, SHOP, { type: 'expense', date: '2026-09-11', currency: 'INR', class: 'rent', amount: 500, paid_from: 'cash', source_ref: 'chit:e1' });
    await X.B.postEntry(X.db, SHOP, { type: 'expense', date: '2026-09-12', currency: 'INR', class: 'rent', amount: 300, paid_from: 'cash', source_ref: 'chit:e2' });
    const P = require(path.join(API, 'lib', 'books-pack'));
    const pk = await P.build(SHOP, { kind: 'month', fiscal_year: '2026-27', period: 6, by: SHOP, today: '2026-09-29' });
    ok('a month pack is built (zip in hand, not stored)', !!(pk && pk.zip && pk.manifest), JSON.stringify(pk).slice(0, 120));
    const files = unzip(pk.zip), names = Object.keys(files);
    walk('pack', pk.manifest, 'manifest');
    let jsonFiles = 0, csvCols = 0;
    names.forEach((n) => {
      const txt = files[n].toString('utf8');
      if (/\.json$/.test(n)) { jsonFiles++; try { walk('pack', JSON.parse(txt), n); } catch (_) { SEEN.pack.bad.push(n + ' is not valid JSON'); } }
      if (/\.csv$/.test(n)) {
        const head = txt.split(/\r?\n/)[0].split(',');
        head.forEach((h, ci) => { if (MOMENT_KEY.test(h)) { csvCols++; SEEN.pack.keys.add(h); txt.split(/\r?\n/).slice(1).filter(Boolean).forEach((ln) => { SEEN.pack.checked++; const cell = ln.split(',')[ci]; if (cell && !RFC3339.test(cell.replace(/^"|"$/g, ''))) SEEN.pack.bad.push(n + ' ' + h + ' = ' + cell); }); } });
      }
    });
    v = verdict('pack'); ok('the pack — manifest + ' + jsonFiles + ' JSON file(s) + ' + csvCols + ' CSV moment column(s) of ' + names.length + ' files — ' + v[1], v[0], v[1]);
    ok('the manifest\'s created_at is present (not null)', typeof pk.manifest.created_at === 'string', String(pk.manifest.created_at));

    const tallyTxt = names.filter((n) => /^tally.*\.xml$/.test(n)).map((n) => files[n].toString('utf8')).join('\n');
    const A = require(path.join(API, 'tools', 'tally-connector', 'adapters', 'tally.js'));
    const receipt = A.builders.receiptXML({ chit_id: 'abcdef12-3456', at: '2026-09-20T10:00:00Z', method: 'upi', ref: 'UTR1', amount: 600, buyer: 'Ravi' }, { partyLedger: 'Ravi', company: 'Acme' });
    const dates = (tallyTxt + receipt).match(/<DATE>[^<]*<\/DATE>/g) || [];
    ok('Tally: the pack\'s files and the connector\'s receipt were built (' + names.filter((n) => /^tally/.test(n)).join(', ') + ')', /<VOUCHER /.test(receipt), tallyTxt.slice(0, 80));
    ok('Tally: every <DATE> is Tally\'s own YYYYMMDD (' + dates.length + ' found) — a calendar day its importer requires, never an instant', dates.length >= 1 && dates.every((d) => /^<DATE>\d{8}<\/DATE>$/.test(d)), dates.join(' '));
    ok('Tally: no clock time is written anywhere (no hh:mm:ss, no T...Z)', !/\d{1,2}:\d{2}:\d{2}|\d{4}-\d\d-\d\dT/.test(tallyTxt + receipt), '');

    /* 4 · JUnit */
    const J = require(path.join(API, 'lib', 'junitresults.js'));
    const xml = J.write('chitbridge-api', [{ name: 'a.test.cjs', status: 'pass', time: 0.5 }, { name: 'b.test.cjs', status: 'fail', message: 'x', time: 1 }, { name: 'c', status: 'skipped' }]);
    const stamps = (xml.match(/\b(timestamp|[a-z_]*_at|[a-z]*date)="[^"]*"/gi) || []);
    ok('JUnit: write() carries no timestamp attribute, or every one it carries is RFC 3339 Z (' + stamps.length + ' present)', stamps.every((s) => RFC3339.test(s.split('"')[1])), stamps.join(' '));
    ok('JUnit: `time=` is a duration in seconds (JUnit\'s meaning), never a clock time', (xml.match(/ time="[^"]*"/g) || []).every((t) => /^ time="\d+\.\d{3}"$/.test(t)), '');

    console.log('\n  what was checked:');
    Object.keys(SEEN).filter((k) => k !== T0).forEach((k) => console.log('   · ' + k + ': ' + SEEN[k].checked + ' moment fields (' + Array.from(SEEN[k].keys).sort().join(', ') + '), ' + SEEN[k].nulls + ' null'));
    console.log('   · Tally: ' + dates.length + ' <DATE> (YYYYMMDD) · JUnit: ' + stamps.length + ' timestamp attributes');
  } catch (e) { fail++; console.log('   FAIL the test ran   ' + (e && e.stack)); }
  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  srv.close(); process.exit(fail ? 1 : 0);
});
