'use strict';
/**
 * orderhub.test.js — ONE SET OF ORDERS, THREE DEVICES, NO INTERNET ([TILL-178b]).
 *
 * Athi: *"how do we prove without internet the entire cycle works, as a local network?"*
 *
 * ── ⚠️⚠️⚠️ WHAT IS ACTUALLY BEING PROVED ────────────────────────────────────────────────────────────────
 *
 * Not "the counter survives an outage" — that was proved a week ago and it is a one-device claim. THIS is the
 * floor: a waiter, a kitchen and a till, none of which can see the internet, all of which must agree about
 * table 7. Those are three separate browsers holding three separate copies, and the only honest test of an
 * agreement is to make them act AT THE SAME TIME and see which one loses.
 *
 * ⭐ Every check here runs with `require` and no network at all, which is the point: if the rules needed the
 * cloud to be reachable, this file could not run.
 *
 * Run: node tests/orderhub.test.js   · no DB, no browser, no network, no port.
 */
const assert = require('assert');
const H = require('../lib/orderhub');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

const line = (name, net, station) => ({ item_id: name, name, qty: 1, net, station });

console.log('\nA HUB THE SHOP OWNS\n');

it('it starts empty and knows nothing', () => {
  const hub = H.create();
  assert.deepStrictEqual(hub.orders, []);
  assert.strictEqual(H.since(hub, 0).orders.length, 0);
  assert.strictEqual(H.queue(hub).length, 0);
});

it('a waiter opens a table on it', () => {
  const hub = H.create();
  const r = H.apply(hub, { do: 'open', subject: '7', by: { id: 'w1', name: 'Bala' } });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.order.subject, '7');
  assert.strictEqual(hub.orders.length, 1);
});

/** ⚠️ a message a screen can show. A code would have to be translated by the person holding the phone. */
it('⚠️ and a refusal is a sentence, not a code', () => {
  const hub = H.create();
  assert.strictEqual(H.apply(hub, { do: 'open', subject: '  ' }).why, 'that needs a number');
  assert.strictEqual(H.apply(hub, { do: 'round', id: 'nope' }).why, 'that order is not on this hub');
  assert.ok(/does not know how to/.test(H.apply(hub, { do: 'dance' }).why));
});

/* ══ ⭐⭐⭐ THE ONE THE WHOLE FILE EXISTS FOR ═══════════════════════════════════════════════════════════ */
console.log('\nTWO WAITERS, ONE TABLE\n');

it('⭐⭐⭐ two devices typing table 7 at once reach ONE order', () => {
  const hub = H.create();
  const a = H.apply(hub, { do: 'open', subject: '7', by: { id: 'w1' } });
  const b = H.apply(hub, { do: 'open', subject: '7', by: { id: 'w2' } });
  assert.strictEqual(a.order.id, b.order.id, 'the floor got two bills for one table');
  assert.strictEqual(hub.orders.length, 1);
});

/**
 * ⚠️⚠️⚠️ THE FAULT A NAIVE HUB SHIPS WITH. Store whole orders and keep the last received, and this test is the
 * one that fails: the waiter's copy — read BEFORE the kitchen touched anything — is written back a second later
 * and the "ready" is gone. Sending what was DONE rather than what is HELD is the entire fix.
 */
it('⚠️⚠️⚠️ a stale device cannot erase what another one did', () => {
  const hub = H.create();
  const o = H.apply(hub, { do: 'open', subject: '7' }).order;
  H.apply(hub, { do: 'round', id: o.id, lines: [line('Dosa', 70, 'hot')] });

  /* the waiter's phone read the order here, and has not heard anything since */
  const stale = JSON.parse(JSON.stringify(H.find(hub, o.id)));

  H.apply(hub, { do: 'ready', id: o.id, all: true, station: 'hot' });   /* the kitchen acts */
  H.apply(hub, { do: 'round', id: o.id, lines: [line('Coffee', 25, 'cold')] });  /* the waiter acts, late */

  const now = H.find(hub, o.id);
  assert.strictEqual(now.lines.length, 2, 'a round was lost');
  assert.strictEqual(now.lines[0].ready, true, 'the kitchen\'s work was overwritten by a stale copy');
  assert.strictEqual(stale.lines[0].ready, undefined, 'the fixture is not actually stale, so this proves nothing');
});

it('and only one device can take a table to the bill', () => {
  const hub = H.create();
  const o = H.apply(hub, { do: 'open', subject: '7' }).order;
  H.apply(hub, { do: 'round', id: o.id, lines: [line('Dosa', 70, 'hot')] });
  const first = H.apply(hub, { do: 'settle', id: o.id, by: { id: 'w1' } });
  const second = H.apply(hub, { do: 'settle', id: o.id, by: { id: 'w2' } });
  assert.strictEqual(first.ok, true);
  assert.strictEqual(second.ok, false, 'two devices billed one table');
  assert.ok(/already settling/.test(second.why), second.why);
});

/** ⚠️ a table that can never be billed again is worse than one billed twice by mistake */
it('⚠️ and a failed billing puts it back', () => {
  const hub = H.create();
  const o = H.apply(hub, { do: 'open', subject: '7' }).order;
  H.apply(hub, { do: 'round', id: o.id, lines: [line('Dosa', 70, 'hot')] });
  H.apply(hub, { do: 'settle', id: o.id });
  H.apply(hub, { do: 'reopen', id: o.id });
  assert.strictEqual(H.apply(hub, { do: 'settle', id: o.id }).ok, true);
});

console.log('\nWHAT THE KITCHEN SEES\n');

it('the queue is what was sent to that station and is not made', () => {
  const hub = H.create();
  const o = H.apply(hub, { do: 'open', subject: '7' }).order;
  H.apply(hub, { do: 'round', id: o.id, lines: [line('Dosa', 70, 'hot'), line('Coffee', 25, 'cold')] });
  assert.strictEqual(H.queue(hub, 'hot').length, 1, 'the cold station was handed a dosa');
  assert.strictEqual(H.queue(hub, 'hot')[0].name, 'Dosa');
  assert.strictEqual(H.queue(hub, 'cold')[0].name, 'Coffee');
  assert.strictEqual(H.queue(hub).length, 2, 'a hub with one screen must still show everything');
});

/** ⭐ round 0 is a thought. A kitchen that cooks thoughts throws food away. */
it('⭐ a held line never reaches a station', () => {
  const hub = H.create();
  const o = H.apply(hub, { do: 'open', subject: '7' }).order;
  H.apply(hub, { do: 'hold', id: o.id, lines: [line('Dosa', 70, 'hot')] });
  assert.strictEqual(H.queue(hub, 'hot').length, 0, 'the kitchen started cooking something nobody ordered');
});

it('and marking it made takes it off the queue', () => {
  const hub = H.create();
  const o = H.apply(hub, { do: 'open', subject: '7' }).order;
  H.apply(hub, { do: 'round', id: o.id, lines: [line('Dosa', 70, 'hot')] });
  const r = H.apply(hub, { do: 'ready', id: o.id, all: true, station: 'hot' });
  assert.strictEqual(r.made, 1);
  assert.strictEqual(H.queue(hub, 'hot').length, 0);
  /* ⚠️ and pressing it twice says so rather than pretending */
  assert.strictEqual(H.apply(hub, { do: 'ready', id: o.id, all: true, station: 'hot' }).why,
    'nothing there was still waiting');
});

it('a station never touches another station\'s line', () => {
  const hub = H.create();
  const o = H.apply(hub, { do: 'open', subject: '7' }).order;
  H.apply(hub, { do: 'round', id: o.id, lines: [line('Dosa', 70, 'hot'), line('Coffee', 25, 'cold')] });
  H.apply(hub, { do: 'ready', id: o.id, all: true, station: 'hot' });
  assert.strictEqual(H.queue(hub, 'cold').length, 1, 'the hot station marked the coffee made');
});

/** ⚠️ oldest first — sorted by table, table 12 is served last all evening */
it('⚠️ the queue is oldest first, not by table', () => {
  const hub = H.create();
  const a = H.apply(hub, { do: 'open', subject: '12' }).order;
  const b = H.apply(hub, { do: 'open', subject: '3' }).order;
  H.apply(hub, { do: 'round', id: a.id, lines: [line('Dosa', 70, 'hot')], at: '2026-09-21T10:00:00.000Z' });
  H.apply(hub, { do: 'round', id: b.id, lines: [line('Idli', 40, 'hot')], at: '2026-09-21T10:05:00.000Z' });
  assert.deepStrictEqual(H.queue(hub, 'hot').map((q) => q.subject), ['12', '3']);
});

/** ⭐ a parcel is billed first and cooked after, so the station must be told which it is */
it('⭐ the queue says whether it is a parcel', () => {
  const hub = H.create();
  const o = H.apply(hub, { do: 'open', subject: 'P1', kind: 'parcel' }).order;
  H.apply(hub, { do: 'round', id: o.id, lines: [line('Dosa', 70, 'hot')] });
  assert.strictEqual(H.queue(hub, 'hot')[0].kind, 'parcel');
});

/** ⚠️⚠️ the billed table must leave the kitchen screen, or the evening only ever grows */
it('⚠️⚠️ a settled order leaves the queue', () => {
  const hub = H.create();
  const o = H.apply(hub, { do: 'open', subject: '7' }).order;
  H.apply(hub, { do: 'round', id: o.id, lines: [line('Dosa', 70, 'hot')] });
  H.apply(hub, { do: 'settled', id: o.id, bill: 'C1-0007' });
  assert.strictEqual(H.queue(hub, 'hot').length, 0);
});

console.log('\nA TIRED PHONE ASKS FOR LITTLE\n');

it('a device is handed only what changed since it last asked', () => {
  const hub = H.create();
  const a = H.apply(hub, { do: 'open', subject: '7' }).order;
  const mark = H.since(hub, 0).seq;
  H.apply(hub, { do: 'open', subject: '9' });
  const d = H.since(hub, mark);
  assert.strictEqual(d.orders.length, 1, 'it re-read the whole evening');
  assert.strictEqual(d.orders[0].subject, '9');
  assert.ok(d.seq > mark);
  /* ⚠️ and touching an OLD order brings it back into the delta */
  H.apply(hub, { do: 'round', id: a.id, lines: [line('Dosa', 70, 'hot')] });
  assert.strictEqual(H.since(hub, d.seq).orders[0].subject, '7', 'a change to table 7 was never delivered');
});

it('and asking from zero is the whole evening', () => {
  const hub = H.create();
  H.apply(hub, { do: 'open', subject: '7' });
  H.apply(hub, { do: 'open', subject: '9' });
  assert.strictEqual(H.since(hub, 0).orders.length, 2);
});

console.log('\nTHE STATIONS ARE THE MENU\'S, NOT A SETTING\n');

it('⭐ the station list is read off the items', () => {
  assert.deepStrictEqual(H.stations([{ station: 'hot' }, { station: 'cold' }, { station: 'hot' }, {}]),
    ['cold', 'hot']);
  assert.deepStrictEqual(H.stations([]), [], 'a shop with no stations must not be handed one');
});

console.log('\nAND NOTHING HERE KNOWS ABOUT A SCREEN OR A SOCKET\n');

/**
 * ⭐⭐⭐ THE POINT. This file is the shop PC's memory today and could be a table in Postgres tomorrow. Either
 * way it must not reach for a browser, a port or the cloud — if it did, "it works without internet" would be a
 * claim about something we had never run.
 */
it('⭐⭐⭐ the hub touches no DOM, no http, no storage', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'orderhub.js'), 'utf8');
  const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  ['document', 'window', 'localStorage', 'fetch', 'require(\'http', 'axios', 'supabase'].forEach((w) => {
    assert.ok(body.indexOf(w) < 0, 'lib/orderhub.js mentions ' + w + ' — the floor now needs a network');
  });
});

/** ⚠️ and it must not have grown its own opinion about tables — that is lib/orders.js's job */
it('⚠️ it calls the order engine rather than re-deciding', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'orderhub.js'), 'utf8');
  assert.ok(/require\('\.\/orders'\)/.test(src), 'the hub does not use the order engine at all');
  const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(body.indexOf('state === \'open\' &&') < 0, 'the hub re-implements findOpen — two rules, one floor');
});

console.log('\n' + pass + ' checks passed\n');
