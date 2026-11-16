'use strict';
/**
 * tests/e11-events-ticket-readonly.test.cjs — E11 (Fable multi-role walk 2026-11-17): the auditor seat got 403 on POST /api/events/ticket, so it had no live push.
 * OWNS      (1) the hat gate lets a read-only seat mint the ticket by EXACT path (the cases are in tests/hat-gate.test.cjs too);
 *           (2) CROSS-TENANT NEGATIVE: a ticket carries only the events of the entity the ROUTE bound it to (the caller's own), never another shop's;
 *           (3) the route binds the ticket to the caller's entity only: no body, query or path id reaches ticketFor.
 * CALLED BY node tests/e11-events-ticket-readonly.test.cjs (no DB, no server)
 * CARD      18-identity-sign-in-and-access/access-levels-and-roles
 */
const assert = require('assert'), fs = require('fs'), path = require('path');
const gate = require('../middleware/hat-gate');
const events = require('../lib/events');
let pass = 0;
const it = (w, fn) => { try { fn(); pass++; console.log('  ok  ' + w); } catch (e) { console.log('  FAIL ' + w + '\n      ' + e.message); process.exitCode = 1; } };

function fakeRes() { const w = []; return { w, writeHead() {}, write(s) { w.push(String(s)); }, end() {}, on() {} }; }
const fakeReq = () => ({ on() {} });

it('the auditor (commenter, an actor) passes the hat gate on POST /api/events/ticket', () => {
  let ok = false;
  gate({ method: 'POST', originalUrl: '/api/events/ticket', identity: { identity_type: 'actor', access_level: 'commenter' } }, { status() { return this; }, json() { return this; } }, () => { ok = true; });
  assert.ok(ok, 'the read-only seat is still refused at the gate');
});

it('POSITIVE CONTROL: a ticket for shop A delivers shop A its own event', () => {
  const a = fakeRes();
  const v = events.spendFor(events.ticketFor('shop-A', {}).ticket);
  events.subscribe(v.entity_id, fakeReq(), a, { screen: v.screen });
  const n = events.emit(['shop-A'], { kind: 'chit', id: 'canary-A-1' });
  assert.ok(n >= 1 && a.w.join('').includes('canary-A-1'), 'the own-entity event did not arrive: the test could not fail');
});

it('CROSS-TENANT NEGATIVE: the auditor ticket (firm F) never receives shop B, shop C or a client shop event', () => {
  const f = fakeRes();
  const v = events.spendFor(events.ticketFor('firm-F', {}).ticket);
  events.subscribe(v.entity_id, fakeReq(), f, { screen: v.screen });
  events.emit(['shop-B'], { kind: 'chit', id: 'canary-B-1', who: 'Other Shop', note: 'secret-B' });
  events.emit(['client-C', 'shop-B'], { kind: 'task', id: 'canary-C-1' });
  events.emit(['firm-F'], { kind: 'chit', id: 'canary-F-1' });
  const got = f.w.join('');
  assert.ok(got.includes('canary-F-1'), 'positive control: the firm hears its own');
  for (const c of ['canary-B-1', 'secret-B', 'Other Shop', 'canary-C-1']) assert.ok(!got.includes(c), 'another shop\'s event reached the ticket: ' + c);
});

it('a ticket is one-time: spent once, a second use is refused', () => {
  const t = events.ticketFor('firm-F', {}).ticket;
  assert.ok(events.spendFor(t));
  assert.strictEqual(events.spendFor(t), null);
});

it('the route binds the ticket to the caller\'s entity only: ticketFor is never given a body, query or param value', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'events.js'), 'utf8');
  const body = src.slice(src.indexOf("router.post('/ticket'"), src.indexOf("router.get('/stream'"));
  assert.ok(/const e = ctx\(req\)/.test(body) && /events\.ticketFor\(e,/.test(body), 'ticketFor is not fed from the caller\'s own entity');
  assert.ok(!/req\.(body|query|params)/.test(body), 'a request value reaches the ticket route');
});

console.log('\n  ' + pass + ' passed');
