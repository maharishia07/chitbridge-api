/**
 * finance-terms.test.cjs — CB FINANCE · TERMS (F2): shop default + per-party override (resolver), the limit check, one change event per
 * changed key, the routes before b298 has run (words, not a 500), and b298 itself (no new table, RLS stated, no policy to add).
 * Needs the books engines for the route half. Run: node tests/finance-terms.test.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
const H = require('./support/books-harness.cjs');
const T = require('../lib/finance-terms');
const schema = require('../lib/schema');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const throwsSay = (fn) => { try { fn(); return null; } catch (e) { return e.say || e.message; } };

/* ── the resolver: its own value, else the shop's, else nothing ── */
const shop = { credit_days: 30, credit_limit_minor: 100000, interest: { on: true, rate_pct: 18, grace_days: 5 }, early: { pct: 2, within_days: 10 } };
let r = T.resolve(shop, { credit_days: 7, credit_limit_minor: null, terms: { interest: { on: false, rate_pct: 0, grace_days: 0 } } });
ok('party days win over the shop default', r.credit_days.value === 7 && r.credit_days.from === 'party');
ok('no party limit → the shop limit', r.credit_limit_minor.value === 100000 && r.credit_limit_minor.from === 'shop');
ok('party interest override wins; early falls to the shop', r.interest.from === 'party' && r.interest.value.on === false && r.early.from === 'shop');
r = T.resolve({}, null);
ok('nothing set anywhere → null, from null', r.credit_days.value === null && r.credit_days.from === null && r.interest.value === null);
ok('limit 0 is a limit of "none" in the check', T.limitCheck(0, 5, 5).applies === false);

/* ── the limit check (minor units) ── */
let c = T.limitCheck(100000, 60000, 40000);
ok('exactly at the limit is not over', c.applies && !c.over && c.after_minor === 100000);
c = T.limitCheck(100000, 60000, 40001);
ok('one paisa past the limit is over', c.over === true && c.after_minor === 100001);
ok('no limit → never over', T.limitCheck(null, 1e9, 1e9).over === false);
ok('the refusal sentence names both figures', /1000\.01/.test(T.overSentence(c)) && /1000\.00/.test(T.overSentence(c)) && /owner/i.test(T.overSentence(c)));

/* ── the credit part of a counter bill ── */
ok('creditOf sums only the credit tenders, in minor units', T.creditOf({ currency: 'INR', payment: { parts: [{ how: 'Cash', amount: 100 }, { how: 'On credit', amount: 250.5 }] } }) === 25050);
ok('creditOf of a cash bill is 0', T.creditOf({ payment: { parts: [{ how: 'Cash', amount: 100 }] } }) === 0);

/* ── validation, in sentences ── */
ok('days: whole, 0–3650', /Credit days/.test(throwsSay(() => T.clean({ credit_days: -1 }))) && /Credit days/.test(throwsSay(() => T.clean({ credit_days: 1.5 }))));
ok('interest on needs a rate', /rate/.test(throwsSay(() => T.clean({ interest: { on: true, rate_pct: 0, grace_days: 0 } }))));
ok('early-pay needs days', /days/.test(throwsSay(() => T.clean({ early: { pct: 2, within_days: 0 } }))));
ok('null clears; absent keys stay out', JSON.stringify(T.clean({ interest: null })) === '{"interest":null}');

/* ── the writes: one change event per changed key, nothing for an unchanged one ── */
function fake(state) {
  const q = [];
  return { q, query: async (sql, p) => {
    q.push({ sql, p });
    if (/FROM books_setting/.test(sql)) return { rows: [{ terms: state.shop }] };
    if (/FROM customer_list/.test(sql)) return { rows: state.row ? [state.row] : [] };
    return { rows: [] };
  } };
}
const logsOf = (db) => db.q.filter((x) => /INSERT INTO books_change_log/.test(x.sql));
(async () => {
  let db = fake({ shop: { credit_days: 30 } });
  await T.saveShop(db, 'E1', { credit_days: 45, credit_limit_minor: 50000 }, 'U1');
  let logs = logsOf(db);
  ok('shop default: two keys changed → two events, who + from → to', logs.length === 2 && logs[0].p[1] === 'U1' && logs[0].p[2] === 'terms' && logs[0].p[4] === 'credit_days' && logs[0].p[5] === '30' && logs[0].p[6] === '45', JSON.stringify(logs.map((x) => x.p)));
  db = fake({ shop: { credit_days: 30 } });
  await T.saveShop(db, 'E1', { credit_days: 30 }, 'U1');
  ok('an unchanged value makes no event', logsOf(db).length === 0);
  db = fake({ shop: {}, row: { credit_days: 10, credit_limit_minor: '50000', terms: {} } });
  const eff = await T.saveParty(db, 'E1', 'P1', 'customer', { credit_limit_minor: 80000, interest: { on: true, rate_pct: 12, grace_days: 0 } }, 'U1');
  logs = logsOf(db);
  ok('party: limit and interest each an event on that party', logs.length === 2 && logs.every((x) => x.p[2] === 'party_terms' && x.p[3] === 'P1') && logs.some((x) => x.p[4] === 'customer.credit_limit_minor' && x.p[5] === '50000' && x.p[6] === '80000'), JSON.stringify(logs.map((x) => x.p)));
  ok('party: the answer is what now applies', eff.credit_limit_minor.value === 80000 && eff.credit_days.value === 10 && eff.interest.value.rate_pct === 12);
  const upd = db.q.find((x) => /^UPDATE customer_list/.test(x.sql));
  ok('party: ONE update (limit column + terms jsonb together)', !!upd && /credit_limit_minor = \$3/.test(upd.sql) && /terms = \$4::jsonb/.test(upd.sql), upd && upd.sql);
  let err = null; try { await T.saveParty(fake({ shop: {} }), 'E1', 'P9', 'customer', { credit_days: 5 }, 'U1'); } catch (e) { err = e; }
  ok('a party not on the list → 404 in words', err && err.status === 404 && /not on your customer list/.test(err.say));

  /* ── the server-side limit check on a credit sale (lib creditSaleCheck, the call routes/chits.js /send makes) ── */
  console.log('\n── credit sale check ──');
  schema.hasColumn = async () => false;
  const D = require('../db'), hooks = require('../lib/books-hooks'), B = require('../lib/books');
  let touched = 0;
  const lim = (m) => ({ query: async () => { touched++; return { rows: [{ credit_days: null, credit_limit_minor: m == null ? null : String(m) }] }; } });
  let LIMIT = 100000;
  D.withEntity = async (e, fn) => fn(lim(LIMIT));
  hooks.isOn = async () => true; B.controlOf = async () => ({ account_id: 'A' }); B.partyItems = async () => [];
  const bill = (how, amount, cust) => ({ currency: 'INR', customer: cust === null ? undefined : { entity_id: 'C1' }, payment: { parts: [{ how, amount }] } });
  let k = await T.creditSaleCheck('E1', bill('On credit', 1500));
  ok('credit ₹1500 against a ₹1000 limit → over, with the figures', k.over === true && k.party_id === 'C1' && k.limit_minor === 100000 && k.after_minor === 150000, JSON.stringify(k));
  ok('credit ₹500 → inside the limit', (await T.creditSaleCheck('E1', bill('On credit', 500))).over === false);
  touched = 0;
  ok('a cash bill → not over, and no query at all', (await T.creditSaleCheck('E1', bill('Cash', 5000))).over === false && touched === 0);
  ok('credit with no named customer → not over, no query', (await T.creditSaleCheck('E1', bill('On credit', 5000, null))).over === false && touched === 0);
  LIMIT = null;
  ok('no limit anywhere → never over', (await T.creditSaleCheck('E1', bill('On credit', 999999))).over === false);
  hooks.isOn = async () => null; LIMIT = 100000;
  ok('ledger off → no check', (await T.creditSaleCheck('E1', bill('On credit', 1500))).over === false);
  const chits = fs.readFileSync(path.join(__dirname, '..', 'routes', 'chits.js'), 'utf8');
  ok('/send refuses OVER_LIMIT unless the owner allowed it (a counter key or the owner login)', /creditSaleCheck\(sender_id, business_json\)/.test(chits) && /code: 'OVER_LIMIT'/.test(chits) && /ov\.by && \(req\.till \|\| isOwner\(req\)\)/.test(chits));

  /* ── the routes before b298 has run ── */
  console.log('\n── routes before b298 ──');
  if (!H.enginesSrc().dir) { console.log('   SKIP routes: ' + H.enginesSrc().why); } else {
    schema.hasColumn = async () => false;                                  /* b298 not run */
    const SHOP = '11111111-1111-4111-8111-111111111111', MALA = '22222222-2222-4222-8222-222222222222';
    let WHO = { identity_id: SHOP, identity_type: 'entity', display_name: 'Shop' };
    const auth = Object.assign((req, res, next) => { req.identity = WHO; next(); }, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (req, res, next) => next() });
    const X = H.load({ auth });
    X.T.parties.push({ owner: SHOP, party_id: MALA, party_no: 'P-00001', name: 'Mala', customer: true, credit_days: 10, credit_limit_minor: 50000 });
    const express = require('express'), app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
    const srv = app.listen(0), port = srv.address().port;
    const req = (method, p, body) => new Promise((done) => {
      const rq = http.request({ host: '127.0.0.1', port, path: '/api/books' + p, method, headers: { 'Content-Type': 'application/json' } }, (res) => {
        const b = []; res.on('data', (x) => b.push(x));
        res.on('end', () => { let j = {}; try { j = JSON.parse(Buffer.concat(b).toString('utf8') || '{}'); } catch (_) {} done({ status: res.statusCode, body: j }); });
      });
      rq.end(body ? JSON.stringify(body) : undefined);
    });
    await req('POST', '/enable', {});
    const g = await req('GET', '/terms');
    ok('GET /terms before b298: 200, terms_migrated false, owner may_set', g.status === 200 && g.body.terms_migrated === false && g.body.may_set === true, JSON.stringify(g));
    const p = await req('POST', '/terms', { credit_days: 15 });
    ok('POST /terms before b298: 503 TERMS_NOT_MIGRATED in a sentence', p.status === 503 && p.body.code === 'TERMS_NOT_MIGRATED' && /next update/.test(p.body.message), JSON.stringify(p));
    WHO = { identity_id: '99999999-9999-4999-8999-999999999999', parent_entity_id: SHOP, identity_type: 'entity' };
    const g2 = await req('GET', '/terms'), p2 = await req('POST', '/terms', { credit_days: 15 });
    ok('not the owner: may read (may_set false, with why), POST is 403', g2.status === 200 && g2.body.may_set === false && /owner/i.test(g2.body.why_not) && p2.status === 403, JSON.stringify([g2.status, p2.status]));
    srv.close();
  }

  /* ── b298: the SQL file ── */
  console.log('\n── b298_finance_terms.sql ──');
  const dir = path.join(__dirname, '..', 'migrations'), sql = fs.readFileSync(path.join(dir, 'b298_finance_terms.sql'), 'utf8');
  ok('no new table', !/CREATE TABLE/i.test(sql));
  ok('adds exactly the three terms columns, idempotently', (sql.match(/ADD COLUMN IF NOT EXISTS terms jsonb/g) || []).length === 3);
  ok('RLS is stated (WITHOUT a new policy — the tables already carry theirs)', /RLS: WITHOUT/.test(sql));
  const earlier = fs.readdirSync(dir).filter((f) => f < 'b298').map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  ok('the three tables carry RLS in earlier migrations', ['books_setting', 'customer_list', 'supplier_list'].every((t) => new RegExp('ALTER TABLE ' + t + '\\s+(ENABLE|FORCE) ROW LEVEL SECURITY', 'i').test(earlier)));

  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.log(e && e.stack || e); process.exit(1); });
