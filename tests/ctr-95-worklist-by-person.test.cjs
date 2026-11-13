#!/usr/bin/env node
/**
 * ctr-95-worklist-by-person.test.cjs — CTR-95 (proof 2026-11-14): GET /api/folders/worklist groups one station's queue across every open order through assign.byPerson.
 * @type regression
 * OWNS      the proof on the real route + real lib/assign.byPerson over a stand-in db: five chit_line rows from THREE different chits (Mani c1 + c3, Priya c2,
 *           nobody c4 + c5) answer as 3 people: Mani 2 lines, Priya 1, Unassigned 2 (named, actor_id null); every line keeps its own chit_id
 *           (the ticket rail spans orders); remaining quantity = ordered - delivered (4 - 1 = 3); a co-assist's own id wins over a ?actor_id= it typed (the SQL param is the caller's).
 *           (tests/worklist-unassigned.test.cjs pins the unassigned SQL; this pins the route -> byPerson -> grouping path.)
 * CALLED BY scripts/guards.cjs · CI. No database, no network.
 * FLOW      GET /api/folders/worklist -> routes/folders.js -> lib/assign.byPerson -> rows grouped by assignee
 *   node tests/ctr-95-worklist-by-person.test.cjs
 */
'use strict';
const path = require('path');
const express = require('express');
const { API, ok, done, mock, standInDb, call } = require('./lib/cat-proof-kit.cjs');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const SHOP = '11111111-1111-4111-8111-111111111111';
const MANI = '22222222-2222-4222-8222-222222222222';
const PRIYA = '33333333-3333-4333-8333-333333333333';
const who = { current: { identity_id: SHOP, identity_type: 'entity', display_name: 'Kaveri Mess' } };
const line = (assignee, name, chit, id, qty, delivered) => ({ assignee_actor_id: assignee, assignee_name: name, assignee_type: assignee ? 'actor' : null, chit_id: chit, line_id: id, seq: 1, particulars: 'item ' + id, quantity: qty, delivered, state: 'open', chit_status: 'open' });
const ROWS = [line(MANI, 'Mani', 'c1', 'l1', 4, 1), line(PRIYA, 'Priya', 'c2', 'l2', 2, 0), line(MANI, 'Mani', 'c3', 'l3', 1, 0), line(null, null, 'c4', 'l4', 1, 0), line(null, null, 'c5', 'l5', 5, 0)];

const { db, calls } = standInDb((sql) => (/FROM chit_line l/.test(sql) ? { rows: ROWS } : { rows: [], rowCount: 0 }));
const realAuth = require(path.join(API, 'middleware', 'auth'));
mock('middleware/auth', Object.assign((req, res, next) => { req.identity = who.current; next(); }, realAuth, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (q, s, n) => n() }));
mock('db', db); mock('db/index', db);
const realErr = console.error, realWarn = console.warn;
console.error = () => undefined; console.warn = () => undefined;

(async () => {
  const app = express(); app.use(express.json());
  app.use('/api/folders', require(path.join(API, 'routes', 'folders.js')));
  const server = app.listen(0); const port = server.address().port;
  try {
    const r = await call(port, 'GET', '/api/folders/worklist');
    console.error = realErr; console.warn = realWarn;
    const people = (r.body && r.body.people) || [];
    ok('200 with three people', r.status === 200 && people.length === 3, r.status + ' ' + JSON.stringify(r.body).slice(0, 300));
    const mani = people.find((p) => p.actor_id === MANI), priya = people.find((p) => p.actor_id === PRIYA), nobody = people.find((p) => p.actor_id === null);
    ok('Mani holds 2 lines, from two different orders (c1, c3)', mani && mani.lines.length === 2 && mani.lines.map((l) => l.chit_id).join() === 'c1,c3', JSON.stringify(mani));
    ok('Priya holds 1 line (c2)', priya && priya.lines.length === 1 && priya.lines[0].chit_id === 'c2', JSON.stringify(priya));
    ok('the unpicked lines are one bucket named Unassigned with 2 lines (c4, c5)', nobody && nobody.name === 'Unassigned' && nobody.lines.length === 2, JSON.stringify(nobody));
    ok('what is left is ordered - delivered (4 - 1 = 3)', mani.lines[0].left === 3 && mani.lines[0].delivered === 1, JSON.stringify(mani.lines[0]));
    ok('all five lines are answered in lines too', r.body.lines === 5 || (Array.isArray(r.body.lines) && r.body.lines.length === 5), JSON.stringify(r.body.lines));

    who.current = { identity_id: MANI, parent_entity_id: SHOP, identity_type: 'actor', access_level: 'editor', hat: 'act' };
    calls.length = 0;
    const mine = await call(port, 'GET', '/api/folders/worklist?actor_id=' + PRIYA);
    const q = calls.find((c) => /FROM chit_line l/.test(c.sql));
    ok('a co-assist asking for Priya\'s list is queried as themselves (param = Mani), and told it is scoped to self', q && q.params.includes(MANI) && !q.params.includes(PRIYA) && mine.body.scoped_to_self === true, JSON.stringify(q && q.params) + JSON.stringify(mine.body.scoped_to_self));
  } finally { server.close(); }
  done();
})();
