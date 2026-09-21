'use strict';
/**
 * orders.test.js — THE ORDER RULES, TESTED WITH NO BROWSER ANYWHERE NEAR THEM ([TILL-181]).
 *
 * ── ⚠️⚠️⚠️ WHAT THIS DEFENDS ────────────────────────────────────────────────────────────────────────────
 *
 * Athi: *"hope the changes are not tightly integrated to front end, ui — the business function should stay
 * away from rendering always, never ever tightly bound."*
 *
 * He was right, and the first version of the order pad had every rule inside till.html: the PURPOSES registry,
 * the vocabulary, may-a-table-open-twice, what-does-this-come-to, which-round-is-this-line. It worked. It was
 * in the rendering file, which is the worse fault of the two, because the next screen to need those rules
 * would have copied them and the two copies would have disagreed within a month.
 *
 * ⭐ THIS FILE IS THE PROOF THAT THEY MOVED. It runs against lib/orders.js with `require` — no page, no DOM,
 * no window. If any rule ever creeps back into the screen, the check for it here has nothing to run against.
 *
 * Run: node tests/orders.test.js   · no DB, no browser, no network.
 */
const assert = require('assert');
const O = require('../lib/orders');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

console.log('\nWHAT A COUNTER IS FOR\n');

it('billing is the default, and it holds nothing open', () => {
  assert.strictEqual(O.purposeOf({}), 'billing');
  assert.strictEqual(O.purposeOf(null), 'billing');
  assert.strictEqual(O.purposeHas({}, 'open_orders'), false);
  assert.strictEqual(O.purposeHas({}, 'route_lines'), false);
});

/** ⚠️ a value nobody has heard of must fall back, not throw and not pass through */
it('⚠️ an unknown purpose falls back to billing', () => {
  assert.strictEqual(O.purposeOf({ purpose: 'restaurant' }), 'billing');
  assert.strictEqual(O.purposeHas({ purpose: 'restaurant' }, 'open_orders'), false);
});

it('an order pad holds orders open and routes lines', () => {
  assert.strictEqual(O.purposeHas({ purpose: 'order' }, 'open_orders'), true);
  assert.strictEqual(O.purposeHas({ purpose: 'order' }, 'route_lines'), true);
});

/**
 * ⭐⭐ THE VOCABULARY IS A TRANSLATION, NOT A BRANCH. A sweet shop says token, a garage says job card, and
 * neither needs a line of code. This is the whole reason the pattern is not called "restaurant mode".
 */
it('⭐⭐ the words are a shop\'s own, and default to the restaurant\'s', () => {
  assert.strictEqual(O.says({}, 'subject'), 'table');
  assert.strictEqual(O.says({ words: { subject: 'token' } }, 'subject'), 'token');
  assert.strictEqual(O.says({ words: { subject: 'job card' } }, 'subject'), 'job card');
  /* ⚠️ a word nobody set falls back rather than printing the key */
  assert.strictEqual(O.says({ words: { subject: 'token' } }, 'station'), 'kitchen');
});

console.log('\nAN ORDER HELD OPEN\n');

const line = (net) => ({ item_id: 'i', name: 'x', qty: 1, net: net });

it('opening one against a subject', () => {
  const orders = [];
  const o = O.start(orders, ' 7 ', { id: 'w1', name: 'Bala' }, { till: 'C1' });
  assert.strictEqual(o.subject, '7', 'the subject is not trimmed');
  assert.strictEqual(o.state, 'open');
  assert.strictEqual(o.rounds, 0);
  assert.deepStrictEqual(o.lines, []);
});

it('and a blank subject opens nothing', () => {
  assert.strictEqual(O.start([], '   '), null);
  assert.strictEqual(O.start([], null), null);
});

/**
 * ⚠️⚠️⚠️ THE ONE THAT MATTERS. Two orders on table 7 is two bills for one table — the identical failure to two
 * counters both numbering as C1, which put 29 duplicated bills in a shop's books.
 */
it('⚠️⚠️⚠️ the same subject cannot be open twice', () => {
  const orders = [];
  const a = O.start(orders, '7'); orders.push(a);
  const b = O.start(orders, '7');
  assert.strictEqual(b.id, a.id, 'it made a second order for table 7');
  const c = O.start(orders, '  7  ');
  assert.strictEqual(c.id, a.id, 'whitespace made it a different table');
  const d = O.start(orders, 'A1'); orders.push(d);
  assert.strictEqual(O.start(orders, 'a1').id, d.id, 'case made it a different table');
});

it('but a settled one does not block the subject', () => {
  const orders = [];
  const a = O.start(orders, '7'); orders.push(a);
  a.state = 'settled';
  const b = O.start(orders, '7');
  assert.notStrictEqual(b.id, a.id, 'table 7 could not be used again after it was billed');
});

console.log('\nROUNDS\n');

it('a round is numbered, and every line carries it', () => {
  const o = O.start([], '7');
  assert.strictEqual(O.addRound(o, [line(70), line(25)]), 1);
  assert.strictEqual(O.addRound(o, [line(40)]), 2);
  assert.deepStrictEqual(o.lines.map((l) => l.round), [1, 1, 2]);
  assert.strictEqual(o.rounds, 2);
});

/** ⚠️ a round number that can change afterwards is not a record of anything */
it('⚠️ a round is never re-stamped', () => {
  const o = O.start([], '7');
  O.addRound(o, [line(70)]);
  const was = o.lines[0].round;
  O.addRound(o, [line(25)]);
  assert.strictEqual(o.lines[0].round, was, 'an earlier line was renumbered by a later round');
});

it('and an empty round is not a round', () => {
  const o = O.start([], '7');
  assert.strictEqual(O.addRound(o, []), null);
  assert.strictEqual(o.rounds, 0, 'it counted a round that sent nothing');
});

/**
 * ⭐ ROUND 0 IS TYPED BUT NOT SENT — what a waiter had entered when he walked to another table. It belongs to
 * the order he was standing at, and the kitchen has not heard of it.
 */
it('⭐ held lines are kept as round 0, not fired', () => {
  const o = O.start([], '7');
  O.addRound(o, [line(70)]);
  O.hold(o, [line(25)]);
  assert.deepStrictEqual(o.lines.map((l) => l.round), [1, 0]);
  assert.strictEqual(o.rounds, 1, 'holding a line counted as a round');
});

console.log('\nWHAT IT COMES TO\n');

it('one reader, and it ignores what was voided', () => {
  const o = O.start([], '7');
  O.addRound(o, [line(70), line(25)]);
  const v = line(999); v.void = true;
  O.addRound(o, [v]);
  const t = O.totals(o);
  assert.strictEqual(t.total, 95, 'a voided line was billed');
  assert.strictEqual(t.lines, 2);
});

/** ⭐ what is still in the kitchen is what decides where a waiter walks next */
it('⭐ waiting counts what was sent and is not ready', () => {
  const o = O.start([], '7');
  O.addRound(o, [line(70), line(25)]);
  O.hold(o, [line(40)]);
  assert.strictEqual(O.totals(o).waiting, 2, 'held lines must not count as waiting on a station');
  o.lines[0].ready = true;
  assert.strictEqual(O.totals(o).waiting, 1);
});

it('and money does not drift', () => {
  const o = O.start([], '7');
  O.addRound(o, [line(0.1), line(0.2)]);
  assert.strictEqual(O.totals(o).total, 0.3, 'float error reached a total');
});

console.log('\nMAY IT BE SETTLED\n');

/** ⚠️ a rule, not a button state — the screen asks, and the server can ask the same question */
it('⚠️ an empty order may not be settled', () => {
  const o = O.start([], '7');
  assert.strictEqual(O.canSettle(o).ok, false);
  assert.ok(/nothing on it/.test(O.canSettle(o).why));
});

it('one with lines may', () => {
  const o = O.start([], '7');
  O.addRound(o, [line(70)]);
  assert.strictEqual(O.canSettle(o).ok, true);
});

it('and one already settling may not be settled again', () => {
  const o = O.start([], '7');
  O.addRound(o, [line(70)]);
  o.state = 'settling';
  const r = O.canSettle(o);
  assert.strictEqual(r.ok, false, 'a second device could bill it in the gap');
  assert.ok(/already settling/.test(r.why), r.why);
});

it('an order of nothing but voided lines may not be settled', () => {
  const o = O.start([], '7');
  const v = line(70); v.void = true;
  O.addRound(o, [v]);
  assert.strictEqual(O.canSettle(o).ok, false);
});

console.log('\nAND NOTHING HERE KNOWS ABOUT A SCREEN\n');

/**
 * ⭐⭐⭐ THE POINT OF THE WHOLE FILE. If a rule ever creeps back toward the page, it will reach for one of
 * these — and this is the check that says so before it ships.
 */
it('⭐⭐⭐ the engine touches no DOM, no window, no storage', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'orders.js'), 'utf8');
  const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  ['document', 'window', 'localStorage', 'innerHTML', 'querySelector', 'getElementById'].forEach((w) => {
    assert.ok(body.indexOf(w) < 0, 'lib/orders.js mentions ' + w + ' — a rule has drifted into the screen');
  });
});

it('and it is reachable from the server, not only the counter', () => {
  assert.strictEqual(typeof O.totals, 'function');
  assert.strictEqual(typeof O.canSettle, 'function');
  /* the same file the browser gets, wrapped — see scripts/vendor-till.cjs */
  assert.ok(require('fs').existsSync(require('path').join(__dirname, '..', 'lib', 'orders.browser.js')),
    'the browser build is missing, so the page and the server would drift');
});

console.log('\n' + pass + ' checks passed\n');
