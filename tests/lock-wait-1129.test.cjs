/**
 * tests/lock-wait-1129.test.cjs — AW-F-02 + AM-F-05 (Athi, 22 Nov 2026, DECISIONS item 4): a day close or a bank sign-off dated in a LOCKED month WAITS on the one Waiting list, in words,
 * and posts forward only on the owner's press (POST /outbox/retry { forward: true }), into the first open month, doc date kept. The till is never refused: its day close is stored.
 * OWNS      the proof of that rule on the real postChit → postDay → retryOutbox (the in-memory books), the real routes/books.js POST /outbox/retry seat gate, and the late sign-off (books-locked-wait).
 * CALLED BY scripts/guards.cjs
 * FLOW      lock April → the till's day summary for 30 Apr → waits (no entry) → a plain retry keeps it waiting → a non-owner's press is 403 → the owner's press posts it on 1 May with doc date 30 Apr
 * CARD      09-counter/day-close
 * MUTATION  checked once: remove the `lockedWait.heldIfLocked` block in books-hooks postDay → "a locked-April day close waits" goes red (it posts on 1 May at once).
 * Run: node tests/lock-wait-1129.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + String(why).slice(0, 400) : '')); } };
const SHOP = '11111111-1111-4111-8111-111111111111';
let who = 'owner';
const stubAuth = (req, res, next) => { req.identity = who === 'owner' ? { identity_id: SHOP, identity_type: 'entity' } : { identity_id: '33333333-3333-4333-8333-333333333333', identity_type: 'actor', parent_entity_id: SHOP, hat: 'act' }; next(); };
stubAuth.entityOf = (req) => req.identity.parent_entity_id || req.identity.identity_id;
stubAuth.forgetKey = () => {};

(async () => {
  const X = H.load({ auth: stubAuth });
  if (!X.src.dir) { console.log('   SKIP the books engines are not here: ' + X.src.why); process.exit(0); }
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const TC = require(path.join(H.API, 'lib', 'tax-copy'));
  const summaryCopy = (id) => ({ chit_id: id, purpose: 'general', sender_entity_id: SHOP, currency_code: 'INR', business_json: { summary: { period: 'day', key: '2026-04-30', till: { id: 'C1' }, totals: { bills: 1 } } } });
  TC.copyOf = async () => summaryCopy('sum-1');
  const invoice = { currency: 'INR', ItemList: [{ GstRt: 18, AssAmt: 100, CgstAmt: 9, SgstAmt: 9, IgstAmt: 0, CesAmt: 0 }], ValDtls: { TotInvVal: 118 } };
  TC.entryFor = async (copy) => (copy.chit_id === 'bill-1' ? { sells: true, seller: { entity_id: SHOP }, me: { entity_id: SHOP }, buyer: { entity_id: null }, invoice } : {});
  X.store.counterBills = async () => [{ chit_id: 'bill-1', purpose: 'order', sender_entity_id: SHOP, currency_code: 'INR', business_json: { bill_no: 'C1-0001', till: { id: 'C1' }, billed_at: '2026-04-30T05:00:00Z', customer: { name: 'Walk-in' }, payment: { parts: [{ how: 'Cash', amount: 118 }] } } }];
  await X.store.saveSetting(X.db, SHOP, { enabled: true });
  await X.B.enable(X.db, SHOP, { by: SHOP, today: '2026-04-01' });
  K.forget(SHOP);
  const dayEntries = () => X.T.entries.filter((e) => e.entity_id === SHOP && e.source_ref === 'walkin:C1:2026-04-30');
  const open = () => X.T.outbox.filter((o) => o.entity_id === SHOP && !o.done_at);
  await X.B.setPeriod(X.db, SHOP, '2026-27', 1, 'hard_locked', SHOP, 'April filed'); /* IN: FY starts April, period 1 = April */

  const first = await K.postChit(SHOP, 'sum-1', {});
  ok('a locked-April day close waits (answered queued, not posted, no refusal)', first.queued === true && first.wait === 'locked' && dayEntries().length === 0, JSON.stringify(first));
  ok("it waits in the ONE Waiting list, in the owner's words", open().length === 1 && open()[0].why === 'April is locked; open it, or post this into May.', JSON.stringify(open().map((o) => o.why)));
  ok('the words name no tax section', !/s\.\s*\d|section|GST Act/i.test(open()[0] ? open()[0].why : ''));
  const row = open()[0] ? K.waitingRow(open()[0]) : {};
  ok('the row says what it waits for as data (wait: locked), the screen branches on it', row.wait === 'locked' && row.job === 'day', JSON.stringify(row));

  const plain = await K.retryOutbox(SHOP, 100);
  ok('a plain retry (nightly, supplier added) leaves it waiting', plain.posted === 0 && plain.still === 1 && dayEntries().length === 0, JSON.stringify(plain));

  /* the seat gate: the real route, a non-owner then the owner */
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.id = 'req-test'; next(); });
  app.use('/api/books', require(path.join(H.API, 'routes', 'books.js')));
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const press = (body) => new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = http.request({ port: server.address().port, method: 'POST', path: '/api/books/outbox/retry', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => { let t = ''; res.on('data', (c) => (t += c)); res.on('end', () => resolve({ status: res.statusCode, body: (() => { try { return JSON.parse(t); } catch (e) { return {}; } })() })); });
    req.end(data);
  });
  who = 'staff';
  const refused = await press({ forward: true });
  ok("a non-owner's press is refused (403) and nothing posts", refused.status === 403 && dayEntries().length === 0, JSON.stringify(refused));
  who = 'owner';
  const pressed = await press({ forward: true });
  ok("the owner's press answers 200 and posts the day", pressed.status === 200 && pressed.body.posted === 1, JSON.stringify(pressed));
  const e = dayEntries()[0];
  ok("it posted into the first open month (1 May) with the day's own date kept (30 Apr)", !!e && String(e.posting_date).slice(0, 10) === '2026-05-01' && String(e.doc_date).slice(0, 10) === '2026-04-30', JSON.stringify(e && { p: e.posting_date, d: e.doc_date }));
  ok('the Waiting row is closed by the press', open().length === 0);

  /* a late bank sign-off in April waits the same way, and posts on the owner's press */
  const LW = require(path.join(H.API, 'lib', 'books-locked-wait'));
  const bank = require(path.join(H.API, 'lib', 'bank-rec-log'));
  const signed = [];
  const keep = [bank.appendStatement, bank.accountIn];
  bank.accountIn = () => ({ account_id: 'a1', code: '1500' });
  bank.appendStatement = async (db, ent, account, cur, body, by) => { signed.push({ account: account.code, to: body.period_to, by }); return { seq: 1 }; };
  X.store.accounts = async () => [];
  const setting = await X.B.settingOf(X.db, SHOP);
  const held = await X.dbStub.withEntity(SHOP, (h) => LW.heldIfLocked(h, SHOP, setting, '2026-04-30'));
  ok('a sign-off ending 30 Apr is held with the same sentence', !!held && held.why === 'April is locked; open it, or post this into May.', JSON.stringify(held));
  const heldMay = await X.dbStub.withEntity(SHOP, (h) => LW.heldIfLocked(h, SHOP, setting, '2026-05-31'));
  ok('a sign-off ending in open May is not held', heldMay === null);
  await X.B.setPeriod(X.db, SHOP, '2026-27', 1, 'hard_locked', SHOP, 'April filed').catch(() => {});
  const job = { job: LW.BANK_JOB, waiting: 'locked', body: { account: '1500', period_to: '2026-04-30' }, by: SHOP };
  const stays = await LW.postStatement(SHOP, job, false);
  ok('the sign-off stays waiting on a plain retry (nothing signed)', stays.queued === true && signed.length === 0, JSON.stringify(stays));
  const done = await LW.postStatement(SHOP, job, true);
  ok("the owner's press signs it off, stamped by the parked session", done.ok === true && signed.length === 1 && signed[0].by === SHOP, JSON.stringify(signed));
  [bank.appendStatement, bank.accountIn] = keep;
  server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
