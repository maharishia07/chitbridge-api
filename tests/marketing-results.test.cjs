'use strict';
/**
 * tests/marketing-results.test.cjs - WHO CAME BACK (MKT-4), offline: the bucketing of SENT offers against bills, the setting, the reasons a 0 gives,
 * the b776 not-run-yet answer, and the route's fence. Pure functions plus lib/marketing-results over a canned database (no Postgres).
 * Real-stack proof of the same numbers: tests/marketing-truth.realstack.cjs (MK-04 / MK-11). Run: node tests/marketing-results.test.cjs
 * CARD 12-marketing/README
 */
const assert = require('assert'), path = require('path'), http = require('http');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';
const stub = (rel, exports) => { const p = require.resolve(path.join(API, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };

let n = 0, failed = 0;
const t = async (name, fn) => { try { await fn(); n++; console.log('  ok  ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } };

const DAY = 86400e3, NOW = new Date('2026-10-22T10:00:00Z');
const ago = (d) => new Date(NOW.getTime() - d * DAY).toISOString();
const P = (i) => '10000000-0000-4000-8000-00000000000' + i;
const world = { migrated: true, flags: { came_back_days: 14 }, sends: [], bills: [], selected: [] };
stub('db', { query: async () => ({ rows: [] }), withEntity: async (o, fn) => fn({ query: async () => ({ rows: world.sends }) }) });
stub('lib/schema', { hasColumn: async () => world.migrated, hasTable: async () => true });
stub('lib/policy', { get: async () => world.flags });
stub('lib/select', { rows: async (owner, sel) => { world.selected.push(sel); return world.bills; } });
const R = require('../lib/marketing-results.js');

const send = (i, status, daysAgo, extra) => Object.assign({ party_id: P(i), status, reason: status === 'sent' ? null : 'x', send_ref: 'S' + i, created_at: ago(daysAgo), party_name: 'Cust ' + i }, extra);
const bill = (i, id, daysAgo, extra) => Object.assign({ chit_id: id, counterparty_id: P(i), counterparty_name: 'Cust ' + i, created_at: ago(daysAgo), purpose: 'order', doc_kind: 'bill_issued', bill_no: id, value: '60', currency: 'INR', current_status: 'completed' }, extra);

(async () => {
  console.log('\n-- marketing-results (offline) --');
  await t('the setting: default 14, held to 1..90, junk falls back to the default', () => {
    assert.strictEqual(R.daysOf({}), 14); assert.strictEqual(R.daysOf({ came_back_days: 20 }), 20); assert.strictEqual(R.daysOf({ came_back_days: 500 }), 90);
    assert.strictEqual(R.daysOf({ came_back_days: 0 }), 14); assert.strictEqual(R.daysOf({ came_back_days: 'abc' }), 14); assert.strictEqual(R.daysOf(null), 14);
  });
  await t('a bill counts from the send to the day before the window ends: day 5 yes, day 14 no, before the send no', () => {
    const at = (d) => ({ at: new Date(NOW.getTime() - d * DAY) }), s = [at(20)];
    assert.ok(R.sendBefore(s, new Date(NOW.getTime() - 15 * DAY), 14), 'day 5 after the send');
    assert.ok(!R.sendBefore(s, new Date(NOW.getTime() - 6 * DAY), 14), 'exactly 14 days after is outside');
    assert.ok(!R.sendBefore(s, new Date(NOW.getTime() - 21 * DAY), 14), 'a bill BEFORE the send is not a result of it');
  });
  await t('the latest send before the bill gets the credit', () => {
    const a = { at: new Date(NOW.getTime() - 10 * DAY), id: 'old' }, b = { at: new Date(NOW.getTime() - 3 * DAY), id: 'new' };
    assert.strictEqual(R.sendBefore([a, b], NOW, 14).id, 'new');
  });
  await t('only SENT offers are matched: a refused send followed by a bill is NOT a result', async () => {
    world.sends = [send(1, 'refused', 5), send(2, 'sent', 5)]; world.bills = [bill(1, 'b1', 2), bill(2, 'b2', 2)];
    const r = await R.cameBack('E1', { now: NOW });
    assert.deepStrictEqual(r.customers.map((x) => x.party_id), [P(2)]); assert.strictEqual(r.sent_n, 1); assert.strictEqual(r.came_back_n, 1);
    assert.deepStrictEqual(world.selected.pop().counterparty_ids, [P(2)], 'the bills are read for the people who were sent, only');
  });
  await t('3 came back inside 14 days; a buyer sent 15 days ago and a bill from an unsent person are left out; ONE select for the whole window', async () => {
    world.selected = [];
    world.sends = [send(1, 'sent', 5), send(2, 'sent', 5), send(3, 'sent', 5), send(4, 'sent', 15), send(5, 'sent', 5), send(6, 'refused', 5)];
    world.bills = [bill(1, 'b1', 1), bill(2, 'b2', 1), bill(3, 'b3', 1), bill(4, 'b4', 1), bill(6, 'b6', 1), bill(9, 'b9', 1)];
    const r = await R.cameBack('E1', { now: NOW });
    assert.strictEqual(r.came_back_n, 3); assert.strictEqual(r.sent_n, 5); assert.strictEqual(r.days, 14);
    assert.deepStrictEqual(r.money.by_currency, [{ currency: 'INR', total: 180, chits: 3 }]);
    assert.strictEqual(world.selected.length, 1, 'one reader for all of them, not one per person');
    assert.strictEqual(r.why, null); assert.ok(r.customers.every((x) => x.bills.length === 1 && x.bills[0].chit_id), 'every number opens the bills it counts');
  });
  await t('the days are the shop setting: 20 days counts the day-15 buyer too', async () => {
    world.flags = { came_back_days: 20 };
    const r = await R.cameBack('E1', { now: NOW }); world.flags = { came_back_days: 14 };
    assert.strictEqual(r.came_back_n, 4); assert.strictEqual(r.days, 20);
  });
  await t('money is per currency, never added across them', async () => {
    world.sends = [send(1, 'sent', 5), send(2, 'sent', 5)]; world.bills = [bill(1, 'b1', 1), bill(2, 'b2', 1, { currency: 'AED', value: '10' })];
    const r = await R.cameBack('E1', { now: NOW });
    assert.strictEqual(r.money.mixed, true); assert.strictEqual(r.money.total, null); assert.strictEqual(r.money.by_currency.length, 2);
  });
  await t('a bill held as two copies, a credit note and a bill from another doc kind count once or not at all', async () => {
    world.sends = [send(1, 'sent', 5)];
    world.bills = [bill(1, 'b1', 1), bill(1, 'b1', 1), bill(1, 'c1', 1, { doc_kind: 'return', purpose: 'credit_note' }), bill(1, 'o1', 1, { doc_kind: null, purpose: 'order' }), bill(1, 'i1', 1, { doc_kind: null, purpose: 'invoice' })];
    const r = await R.cameBack('E1', { now: NOW });
    assert.deepStrictEqual(r.customers[0].bills.map((x) => x.chit_id).sort(), ['b1', 'i1'], 'the counter bill once, the invoice; not the return, not an order');
  });
  await t('a 0 explains itself with a CODE and a sentence: nothing sent · all refused (template) · sent but nobody bought', async () => {
    world.sends = []; world.bills = [];
    assert.strictEqual((await R.cameBack('E1', { now: NOW })).why.code, 'NO_SENDS');
    world.sends = [send(1, 'refused', 2, { reason: 'x - and offers need an approved offers template, which is not set up, so nothing was sent' })];
    const tpl = await R.cameBack('E1', { now: NOW }); assert.strictEqual(tpl.why.code, 'NO_TEMPLATE'); assert.ok(/template/i.test(tpl.why.say)); assert.strictEqual(tpl.counts.refused, 1);
    world.sends = [send(1, 'refused', 2, { reason: 'WHATSAPP_TOKEN is not set - outbound is not configured' })];
    assert.strictEqual((await R.cameBack('E1', { now: NOW })).why.code, 'NO_TOKEN');
    world.sends = [send(1, 'sent', 2)]; world.bills = [];
    const none = await R.cameBack('E1', { now: NOW }); assert.strictEqual(none.why.code, 'NO_BUYERS'); assert.ok(/14 days/.test(none.why.say));
  });
  await t('before b776 runs: the same shape with zeros and MKT_NOT_MIGRATED - never a 500', async () => {
    world.migrated = false; const r = await R.cameBack('E1', { now: NOW }); world.migrated = true;
    assert.strictEqual(r.migrated, false); assert.strictEqual(r.code, 'MKT_NOT_MIGRATED'); assert.strictEqual(r.came_back_n, 0); assert.deepStrictEqual(r.customers, []); assert.strictEqual(r.total, 0);
  });
  await t('the customers are paged (total, page, limit) and newest buyer first', async () => {
    world.sends = [1, 2, 3].map((i) => send(i, 'sent', 9)); world.bills = [bill(1, 'b1', 3), bill(2, 'b2', 1), bill(3, 'b3', 2)];
    const r = await R.cameBack('E1', { now: NOW, query: { page: 2, limit: 2 } });
    assert.strictEqual(r.total, 3); assert.strictEqual(r.page, 2); assert.strictEqual(r.limit, 2); assert.deepStrictEqual(r.customers.map((x) => x.party_id), [P(1)]);
    const first = await R.cameBack('E1', { now: NOW, query: { page: 1, limit: 2 } });
    assert.deepStrictEqual(first.customers.map((x) => x.party_id), [P(2), P(3)]);
  });

  /* the route: any signed-in member reads it; an API key does not */
  const keyed = { on: false }, authFn = (req, res, next) => { req.identity = { identity_id: 'E1' }; if (keyed.on) req.api_key = true; next(); }; authFn.entityOf = () => 'E1';
  stub('middleware/auth', authFn);
  const express = require('express'), app = express();
  app.use('/api/marketing', require('../routes/marketing.js'));
  const srv = app.listen(0), port = srv.address().port;
  const get = (p) => new Promise((resolve) => http.get({ port, path: p }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b || '{}') })); }));
  await t('GET /api/marketing/came-back answers 200 for a member and 403 SIGN_IN for an API key', async () => {
    world.sends = [send(1, 'sent', 5)]; world.bills = [bill(1, 'b1', 1)];
    const ok = await get('/api/marketing/came-back'); assert.strictEqual(ok.status, 200); assert.strictEqual(ok.body.came_back_n, 1);
    keyed.on = true; const no = await get('/api/marketing/came-back'); keyed.on = false;
    assert.strictEqual(no.status, 403); assert.strictEqual(no.body.code, 'SIGN_IN');
  });
  await t('bad input to the route: a malformed page or limit is held by validation to page 1 with at least one row (a read never answers 400 or 500), and asking twice gives the same page (replay)', async () => {
    world.sends = [send(1, 'sent', 5), send(2, 'sent', 5)]; world.bills = [bill(1, 'b1', 1), bill(2, 'b2', 1)];
    const first = await get('/api/marketing/came-back?page=abc&limit=-3'), again = await get('/api/marketing/came-back?page=abc&limit=-3');
    assert.strictEqual(first.status, 200); assert.strictEqual(first.body.page, 1); assert.strictEqual(first.body.limit, 1); assert.strictEqual(first.body.customers.length, 1);
    assert.deepStrictEqual(first.body.customers, again.body.customers);
  });
  await t('the contract (docs/contracts/web-api.json) lists GET /api/marketing/came-back with the keys the web reads, and its not-yet-migrated keys as optional', () => {
    const entry = JSON.parse(require('fs').readFileSync(path.join(API, 'docs', 'contracts', 'web-api.json'), 'utf8')).routes['GET /api/marketing/came-back'];
    assert.ok(entry && entry.status === 200); ['customers', 'sent_n', 'came_back_n', 'days', 'money', 'why', 'total', 'page', 'limit'].forEach((key) => assert.ok(key in entry.example, key));
    assert.deepStrictEqual(entry.optional.slice().sort(), ['code', 'say']);
  });
  srv.close();
  console.log('\n' + (failed ? 'FAILURES above - ' : '') + n + ' checks passed' + (failed ? ', ' + failed + ' failed' : ''));
  process.exit(failed ? 1 : 0);
})();
