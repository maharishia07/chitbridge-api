'use strict';
/**
 * dayopen.test.js — THE MORNING, RUN WITH NO BROWSER ([TILL-182]).
 *
 * Athi: *"once you sign-in, set up begins, say 'Loading product data', once done say completed, assigning a
 * counter, find which counter was already associated and provide that number, before that find if it is not
 * used by someone, receive the money in hand, and anything else, so the counter is setting up for the day."*
 *
 * ⭐ Every sentence of that is a check below, in his order. The one that matters most is the one he put a
 * "before that" in front of: a counter number handed out before anybody checked whether another PC is already
 * numbering with it is worse than no number at all, because billing will have started by the time it shows.
 *
 * Run: node tests/dayopen.test.js   · no DB, no browser, no network.
 */
const assert = require('assert');
const D = require('../lib/dayopen');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

const NOW = new Date('2026-09-21T09:00:00.000Z').getTime();
const fresh = new Date(NOW - 2 * 3600000).toISOString();
const old = new Date(NOW - 50 * 3600000).toISOString();

/** a counter that is ready for the day — each test spoils exactly one thing */
const ready = (over) => Object.assign({
  now: NOW, device: 'PC-1', currency_symbol: '₹',
  who: { id: 'w1', name: 'Bala', kind: 'coassist', float: 2000 },
  items: 240, prices_at: fresh,
  counter: { id: 'C2', name: 'Front', next: 43 },
  counters: [{ id: 'C1', held_by: { name: 'Back office', device: 'PC-9' } }, { id: 'C2', held_by: null }],
  agent_print: true,
}, over || {});

console.log('\nTHE ORDER HE ASKED FOR\n');

it('the steps run in his order', () => {
  assert.deepStrictEqual(D.STEPS.map((s) => s.id), ['who', 'products', 'counter', 'float', 'printer']);
});

it('and each one says what it is doing', () => {
  const doing = {}; D.STEPS.forEach((s) => { doing[s.id] = s.doing; });
  assert.strictEqual(doing.products, 'Loading product data');
  assert.strictEqual(doing.counter, 'Assigning a counter');
  D.STEPS.forEach((s) => assert.ok(s.doing && s.title, s.id + ' has nothing to say while it runs'));
});

it('a counter with everything in place is ready', () => {
  const r = D.canOpen(ready());
  assert.strictEqual(r.ok, true, r.why);
  assert.strictEqual(D.next(ready()), null, 'it is still waiting on something');
});

console.log('\nLOADING PRODUCT DATA\n');

it('nothing loaded stops the morning', () => {
  const r = D.read('products', ready({ items: 0 }));
  assert.strictEqual(r.done, false);
  assert.strictEqual(D.canOpen(ready({ items: 0 })).step, 'products');
});

it('and when it is done it says how much', () => {
  assert.strictEqual(D.read('products', ready()).say, '240 products · 2h old');
  assert.strictEqual(D.read('products', ready({ items: 1 })).say, '1 product · 2h old');
});

/**
 * ⚠️⚠️ OLD PRICES ARE SAID, NEVER REFUSED OVER. This counter's whole reason for existing is that it bills with
 * the line down, and a shop cannot be stopped from selling because nobody could reach the internet last night.
 */
it('⚠️⚠️ day-old prices are said and do NOT stop the day', () => {
  const s = ready({ prices_at: old });
  const r = D.read('products', s);
  assert.strictEqual(r.done, true, 'a shop was stopped from selling over a stale catalogue');
  assert.strictEqual(r.stale, true);
  assert.ok(/more than a day old/.test(r.why), r.why);
  assert.strictEqual(D.canOpen(s).ok, true);
});

it('and with no copy at all the age is not invented', () => {
  assert.strictEqual(D.priceAge(null), null);
  assert.strictEqual(D.priceAge('not a date'), null);
  assert.strictEqual(D.priceAge(new Date(NOW - 3600000).toISOString(), NOW), 1);
});

/* ══ ⭐⭐⭐ ASSIGNING A COUNTER — AND THE "BEFORE THAT" ════════════════════════════════════════════════════ */
console.log('\nASSIGNING A COUNTER\n');

it('it provides the number this device is already associated with', () => {
  const c = D.counterState(ready());
  assert.strictEqual(c.id, 'C2');
  assert.strictEqual(c.ok, true);
  assert.strictEqual(c.say, 'C2 · Front');
  /* ⭐ and where the series carries on from, which is the thing a fresh PC gets wrong */
  assert.ok(/C2-0043/.test(c.why), c.why);
});

/**
 * ⚠️⚠️⚠️ THE ONE HE PUT "BEFORE THAT" IN FRONT OF. Two PCs both numbering as C1 is the fault that reached a
 * shop's books — 29 duplicated bills — and neither PC can see the other. The morning is the only moment it is
 * cheap to find. [[project-till-series-prefix]]
 */
it('⚠️⚠️⚠️ a counter open on another device STOPS the morning, and names who', () => {
  const s = ready({ counter: { id: 'C1', next: 12 } });
  const c = D.counterState(s);
  assert.strictEqual(c.ok, false, 'two PCs were allowed to number as C1');
  assert.strictEqual(c.held, true);
  assert.ok(/Back office/.test(c.why), c.why);
  assert.ok(/Close it there first/.test(c.why), c.why);
  const v = D.canOpen(s);
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.step, 'counter');
});

/** ⚠️ and it offers the way out rather than only refusing */
it('⚠️ it says which counters ARE free', () => {
  const c = D.counterState(ready({ counter: { id: 'C1', next: 12 } }));
  assert.deepStrictEqual(c.free, ['C2']);
});

/**
 * ⚠️⚠️ HELD BY THIS DEVICE IS THE ORDINARY MORNING. The same PC opening the counter it closed last night must
 * not be told it is clashing with itself — a check that could not tell those apart would block every shop
 * every day, which is how a safety feature gets switched off.
 */
it('⚠️⚠️ but the SAME device holding it is not a clash', () => {
  const s = ready({ counters: [{ id: 'C2', held_by: { name: 'This counter', device: 'PC-1' } }] });
  assert.strictEqual(D.counterState(s).ok, true, 'a PC was blocked by its own key from last night');
});

it('and a device paired to no counter yet is not a fault', () => {
  const s = ready({ counter: null });
  const c = D.counterState(s);
  assert.strictEqual(c.ok, false);
  assert.strictEqual(c.held, false, 'a first morning was reported as a clash');
  assert.strictEqual(c.say, 'not assigned yet');
  assert.deepStrictEqual(c.free, ['C2']);
});

it('⚠️ and if every counter is taken it says that instead', () => {
  const s = ready({ counter: null, counters: [{ id: 'C1', held_by: { name: 'Back office', device: 'PC-9' } }] });
  assert.ok(/no counter free/.test(D.counterState(s).say));
});

console.log('\nTHE MONEY IN HAND\n');

it('the drawer is counted and said back', () => {
  assert.strictEqual(D.read('float', ready()).say, '₹2,000');
});

/**
 * ⚠️⚠️ NOT COUNTED IS NOT ZERO. A drawer nobody counted cannot be reconciled at all; calling it zero
 * manufactures a difference that was never real and hands somebody a shortfall to explain.
 */
it('⚠️⚠️ not counted and empty are different things', () => {
  const none = D.read('float', ready({ who: { name: 'Bala', kind: 'coassist' } }));
  const zero = D.read('float', ready({ who: { name: 'Bala', kind: 'coassist', float: 0 } }));
  assert.strictEqual(none.done, false);
  assert.strictEqual(none.say, 'not counted');
  assert.strictEqual(zero.done, true, 'an honestly empty drawer was treated as unanswered');
  assert.strictEqual(zero.say, 'nothing in the drawer');
});

/** ⚠️ and an uncounted drawer must NOT stop a shop selling — it is a thing to say, not a gate */
it('⚠️ an uncounted drawer does not block the day', () => {
  assert.strictEqual(D.canOpen(ready({ who: { name: 'Bala', kind: 'coassist' } })).ok, true);
});

console.log('\nWHO IS ON THE COUNTER\n');

it('nobody signed in stops the morning', () => {
  const s = ready({ who: null });
  assert.strictEqual(D.read('who', s).say, 'nobody yet');
  assert.strictEqual(D.canOpen(s).step, 'who');
});

/** ⭐ the shop itself is a real answer, and a different one from "nobody chose" */
it('⭐ the shop itself is a choice, not an absence', () => {
  const s = ready({ who: { id: 'e1', name: 'Mayur Bhavan', kind: 'entity', float: 500 } });
  assert.strictEqual(D.read('who', s).done, true);
  assert.strictEqual(D.read('who', s).say, 'the shop itself');
});

console.log('\nAND THE THINGS THAT ARE SAID BUT NEVER BLOCK\n');

it('no printer is said plainly and sells anyway', () => {
  const s = ready({ agent_print: false });
  assert.strictEqual(D.read('printer', s).done, false);
  assert.strictEqual(D.read('printer', s).say, 'through the browser');
  assert.strictEqual(D.canOpen(s).ok, true, 'a shop was stopped from selling over a printer');
});

it('the first thing in the way is the one named', () => {
  const s = ready({ who: null, items: 0, counter: { id: 'C1', next: 2 } });
  assert.strictEqual(D.canOpen(s).step, 'who', 'it named a later problem than the one to fix first');
});

it('and when it is all settled it says what it settled', () => {
  assert.strictEqual(D.done(ready()), 'Bala is on counter C2 with ₹2,000 in the drawer.');
  assert.ok(/empty drawer/.test(D.done(ready({ who: { name: 'Bala', kind: 'coassist', float: 0 } }))));
});


/* ══ ⭐⭐⭐ A SHIFT, AND WHERE A COUNTER NUMBER COMES FROM ([TILL-183]) ══════════════════════════════════ */
console.log('\nA SHIFT CHANGES THE PERSON, NOT THE COUNTER\n');

/**
 * ⚠️⚠️⚠️ Athi: *"if the counter is already running, and the person sign-out and another person sign-in,
 * continue the same counter number, it is like shift. counter continues, but the person changes."*
 * Under GST an invoice run must be one continuous serial. A number that followed the PERSON would start a new
 * series at every handover, and a shop with three shifts would close with three broken runs.
 */
it('⚠️⚠️⚠️ a handover keeps the counter number', () => {
  const s = ready();
  const r = D.shiftChange(s, { id: 'w2', name: 'Kumar' });
  assert.strictEqual(r.counter, 'C2', 'the number followed the person');
  assert.strictEqual(r.keeps_series, true);
  assert.ok(/Kumar is on counter C2/.test(r.say), r.say);
});

it('and signing out does not release it', () => {
  const r = D.shiftChange(ready(), null);
  assert.strictEqual(r.counter, 'C2', 'the counter was released when somebody stepped away');
  assert.ok(/still open/.test(r.say), r.say);
});

/** ⚠️ the next person counts their own drawer — carrying the last one's float hands over their shortfall */
it('⚠️ but the drawer does NOT carry over', () => {
  assert.strictEqual(D.shiftChange(ready(), { id: 'w2', name: 'Kumar' }).float, null);
});

console.log('\nWHERE A COUNTER NUMBER COMES FROM\n');

it('one already assigned is kept, with its run', () => {
  const a = D.assign(ready({ entity: 'e1' }));
  assert.strictEqual(a.action, 'keep');
  assert.strictEqual(a.id, 'C2');
  assert.strictEqual(a.next, 43, 'the sequence was not carried forward');
});

it('none assigned but one free is picked', () => {
  const a = D.assign(ready({ entity: 'e1', counter: null }));
  assert.strictEqual(a.action, 'pick');
  assert.deepStrictEqual(a.free, ['C2']);
});

/** ⚠️⚠️ held elsewhere is not "pick another" — it is a stop, because bills are already numbered under it */
it('⚠️⚠️ one held elsewhere blocks rather than reassigns', () => {
  const a = D.assign(ready({ entity: 'e1', counter: { id: 'C1', next: 12 } }));
  assert.strictEqual(a.action, 'blocked');
  assert.ok(/Back office/.test(a.why), a.why);
});

/**
 * ⚠️⚠️⚠️ Athi: *"assume you left with no counter, then provide a message that you have no free counter
 * available, call services to provide a new counter sequence. so it can be minted from the backend."*
 */
it('⚠️⚠️⚠️ with nothing free it says so AND names the way out', () => {
  const a = D.assign(ready({ entity: 'e1', counter: null,
    counters: [{ id: 'C1', held_by: { name: 'Back office', device: 'PC-9' } }] }));
  assert.strictEqual(a.action, 'mint');
  assert.strictEqual(a.say, 'no counter free');
  assert.ok(/Ask ChitBridge for another one/.test(a.why), a.why);
  /* ⭐ the backend mints it — a number decided on a device is the two-PCs-one-series fault with extra steps */
  assert.strictEqual(a.call, 'counters.create');
});

it('and with no shop at all it asks for that first', () => {
  const a = D.assign(ready({ entity: null }));
  assert.strictEqual(a.action, 'shop');
  assert.ok(/needs the internet once/.test(a.why), a.why);
});

/* ══ ⚠️⚠️⚠️ THE FIRST TIME NEEDS THE LINE ═══════════════════════════════════════════════════════════════ */
console.log('\nTHE FIRST TIME NEEDS THE LINE\n');

/**
 * Athi: *"if the network not there for the first time you cannot set up a shop at all, as the basic
 * requirement is to pull the data from the backend etc."*
 */
it('⚠️⚠️⚠️ a blank counter with no line is stopped, and told why', () => {
  const r = D.firstRun({ entity: null, items: 0, counter: null, line: false });
  assert.strictEqual(r.first, true);
  assert.strictEqual(r.blocked, true);
  assert.strictEqual(r.say, 'No internet');
  assert.ok(/needs the internet once/.test(r.why), r.why);
  /* ⭐ and it must say the counter is fine AFTERWARDS, or it reads as "this thing needs the internet" */
  assert.ok(/works with the line down/.test(r.why), r.why);
});

it('a blank counter WITH a line is simply not set up yet', () => {
  const r = D.firstRun({ entity: null, items: 0, counter: null, line: true });
  assert.strictEqual(r.blocked, false);
  assert.ok(/Sign in to set it up/.test(r.why), r.why);
});

/**
 * ⚠️⚠️ AND THE COUNTER'S WHOLE PITCH SURVIVES THIS. A counter that has been set up once needs no line for
 * anything. If this ever returned blocked for a working shop, the rule would have eaten the product.
 */
it('⚠️⚠️ but a counter set up once is never blocked, line or no line', () => {
  assert.strictEqual(D.firstRun({ entity: 'e1', items: 240, line: false }).first, false);
  assert.strictEqual(D.firstRun({ entity: 'e1', items: 240, line: false }).blocked, false);
  /* ⭐ even with no products cached, a counter that holds a NUMBER has been set up */
  assert.strictEqual(D.firstRun({ entity: 'e1', items: 0, counter: { id: 'C2' }, line: false }).blocked, false);
});

console.log('\nAND NOTHING HERE KNOWS ABOUT A SCREEN\n');

/** ⭐⭐⭐ the rule that keeps the morning out of the markup that draws it */
it('⭐⭐⭐ the engine touches no DOM, no window, no storage, no fetch', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'dayopen.js'), 'utf8');
  const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  ['document', 'window', 'localStorage', 'innerHTML', 'fetch(', 'querySelector'].forEach((w) => {
    assert.ok(body.indexOf(w) < 0, 'lib/dayopen.js mentions ' + w + ' — the morning has drifted into the screen');
  });
});

it('and every step it declares can actually be read', () => {
  D.STEPS.forEach((s) => {
    const r = D.read(s.id, ready());
    assert.ok(typeof r.done === 'boolean', s.id + ' returns no verdict');
    assert.ok(r.say !== undefined, s.id + ' says nothing');
  });
  /* ⚠️ break it before trusting it: a step nobody implemented must not quietly read as done */
  assert.strictEqual(D.read('invented', ready()).done, false);
});

console.log('\n' + pass + ' checks passed\n');
