/**
 * tests/assign-people-suggest.test.cjs — Fable review L5 (I4 suggest, I9 load): no database.
 * HAND-COMPUTED: A (editor) holds 3, B (editor) holds 1, C view-only holds 0, D editor on leave holds 0.
 *   no ?for → B (A has 3; C may not hold, A5; D is not on shift).
 *   ?for client A previously, loads equal (A 1, B 1) → A; loads differ (A 3, B 1) → still B (load first, the previous holder is only the tie).
 *   equal loads, nobody previous → name order (Ann before Ben).
 *   nobody may hold → null. A bad ?for word names nobody.
 * Run: node tests/assign-people-suggest.test.cjs
 * CARD 01-rail-core-the-chit/assign
 */
'use strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const { suggestAmong, parseFor, factsOf, withFacts } = require('../lib/assign-people');
let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) pass++; else { fail++; console.log('FAIL', name); } };
const P = (id, name, extra) => Object.assign({ identity_id: id, display_name: name, break_status: 'active', hat: 'act', access_level: 'editor' }, extra);
const A = P('a', 'Ann'), B = P('b', 'Ben'), C = P('c', 'Cat', { hat: 'view_only', access_level: 'viewer' }), D = P('d', 'Dee', { break_status: 'leave' });
const people = [P('a', 'Ann', { open_held: '1' }), P('b', 'Ben', { open_held: '1' }), P('c', 'Cat', { hat: 'view_only', access_level: 'viewer', open_held: '0' }), P('d', 'Dee', { break_status: 'leave', open_held: '0' })]; /* the people statement carries LOAD_COLUMN (round 1: no trip of its own) */
const L = (a, b) => new Map([['a', a], ['b', b], ['c', 0], ['d', 0]]);
check('A3 B1 C view-only → B', suggestAmong(people, L(3, 1), 'client', null) === 'b');
check('equal loads, A held before → A', suggestAmong(people, L(1, 1), 'client', 'a') === 'a');
check('A held before but holds 3, B 1 → B', suggestAmong(people, L(3, 1), 'client', 'a') === 'b');
check('equal loads, nobody before → name order', suggestAmong([B, A], L(1, 1), 'client', null) === 'a');
check('view-only previous holder is never suggested', suggestAmong([C, B], L(5, 5), 'client', 'c') === 'b');
check('fail-closed: nobody may hold → null', suggestAmong([C, D], L(0, 0), 'client', null) === null);
check('parseFor', parseFor('client:abc').plug === 'client' && parseFor('client:abc').subject_id === 'abc' && parseFor('nope:abc') === null && parseFor('client:') === null && parseFor(5) === null);
(async () => {
  const calls = [];
  const db = async (sql, params) => {
    calls.push(sql);
    return { rows: [{ actor_id: 'a' }] };
  };
  const facts = await factsOf(db, 'e1', people, 'client:sub1');
  check('factsOf: ?for with equal loads → A, one read (the loads ride the people statement)', facts.suggested === 'a' && calls.length === 1);
  check('withFacts marks one person', withFacts({ identity_id: 'a' }, facts).suggested === true && withFacts({ identity_id: 'b' }, facts).suggested === false && withFacts({ identity_id: 'b' }, facts).open_load === 1);
  const meB = [A, B, C].map((p) => withFacts({ identity_id: p.identity_id }, facts, 'b').is_me);
  check('is_me: signed-in B lists A,B,C → only B', meB.join() === 'false,true,false');
  check('is_me: owner (no actor row) → all false', [A, B, C].every((p) => withFacts({ identity_id: p.identity_id }, facts, 'owner-entity-id').is_me === false) && withFacts({ identity_id: 'a' }, facts, undefined).is_me === false);
  const none = await factsOf(db, 'e1', people, undefined);
  check('no ?for → no read, load first then name order → A', none.suggested === 'a');
  console.log(`assign-people-suggest: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
