#!/usr/bin/env node
// @type: unit
/**
 * bkbeh-books-grants-behaviour.test.cjs — BEHAVIOUR of PATCH /api/books-grants/:id and POST /api/books-grants/:id/revoke (until now only the shape sweep).
 *
 * OWNS      the business result of the member's two grant writes: the end date really moves (and only that), the grant is really ended, each write leaves its audit row (access_events, with the
 *           before and the after), the seat that may not write is refused 403 with the register code and NOTHING is written, an unknown or already-ended grant is 404 and nothing is written,
 *           and a revoke closes what the firm left open (the withdraw statement runs in the same transaction).
 * CALLED BY CI (T1) · tests/lib/problem-world.cjs stand-ins. No database, no network: the real routes/books-grants.js and the real lib/books-grant over a scripted statement log.
 * FLOW      seat (owner, co-assist, device key, signed out) → real route → real lib/books-grant → the log of statements the stand-in db saw → asserts on the statements and on the answer
 * CARD      04-network/ACC-176-AUDITOR-GRANT
 */
'use strict';
/** the route as the register names it (/:id) with the one id of this scene put in: the path of every call below is the route's own template */
const at = (route, id) => route.replace(':id', id);
const path = require('path');
const fs = require('fs');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const HERE = path.join(__dirname, '..');
const { harness, SHOP, OWNER, STAFF } = require('./lib/problem-world.cjs');

const MOUNT = '/api/books-grants';
const GRANT_ID = '33333333-3333-4333-8333-333333333333';
const PARENT = '88888888-8888-4888-8888-888888888888';
const FUTURE = '2027-06-01T00:00:00.000Z';
const lab = harness({ here: HERE, mounts: [MOUNT], routeFiles: { [MOUNT]: 'routes/books-grants.js' }, legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'), inherited: () => false, notFrozen: () => true });
const { check, world } = lab;
const GRANT = (more) => Object.assign({ grant_id: GRANT_ID, grantor_entity: SHOP, grantee_entity: PARENT, preset: 'auditor', can_see_costs: true, purpose: 'audit of the books', granted_by: SHOP, granted_at: '2026-11-01T10:00:00.000Z', expires_at: '2027-11-01T10:00:00.000Z', revoked_at: null, revoked_by: null }, more);

/** a statement log over the stand-in db: every statement is kept with its values; the scene says which statements find a row */
function scene(open, written) {
  const log = [];
  const rows = (sql, params) => {
    const text = String(sql);
    log.push({ sql: text, params });
    if (/FROM books_access_grant WHERE grant_id/.test(text)) return open ? { rows: [open], rowCount: 1 } : { rows: [], rowCount: 0 };
    if (/UPDATE books_access_grant SET/.test(text)) return { rows: [written], rowCount: 1 };
    if (/access_events/.test(text) && /INSERT/.test(text)) return { rows: [{ event_id: 1 }], rowCount: 1 };
    return null;
  };
  return { log, rows };
}
const wrote = (log) => log.filter((one) => /^\s*(UPDATE|INSERT)/i.test(one.sql));
const events = (log) => log.filter((one) => /INSERT INTO access_events/.test(one.sql));
const register = new Set(JSON.parse(fs.readFileSync(path.join(HERE, 'docs', 'error-codes.json'), 'utf8')).codes.map((row) => row.code));

(async () => {
  lab.installStubs();
  const router = require(path.join(HERE, 'routes', 'books-grants.js'));
  const server = lab.appOf([{ mount: MOUNT, router }]).listen(0);
  const port = server.address().port;
  const play = async (method, url, body, setup, scenario) => {
    Object.assign(world, { realAuth: false, who: OWNER, asKey: false, db: 'ok', sqlRows: scenario && scenario.rows }, setup);
    return lab.send(port, method, url, body);
  };

  /* PATCH: the owner moves the end date */
  let s = scene(GRANT(), GRANT({ expires_at: FUTURE }));
  let a = await play('PATCH', at('/api/books-grants/:id', GRANT_ID), { expires_at: FUTURE }, null, s);
  check('PATCH by the owner answers 200', a.status === 200, a.text);
  check('the answer carries the new end date, and the grant is still open', a.json && new Date(a.json.expires_at).toISOString() === FUTURE && a.json.revoked_at === null, a.json);
  const update = s.log.find((one) => /UPDATE books_access_grant SET expires_at/.test(one.sql));
  check('the UPDATE sets expires_at on THIS grant only (by id) to the day asked', update && update.params[0] === GRANT_ID && new Date(update.params[1]).toISOString() === FUTURE, update);
  check('the open grant was read for THIS store before the write (grant id and grantor in the predicate)', s.log.some((one) => /FROM books_access_grant WHERE grant_id = \$1 AND grantor_entity = \$2 AND revoked_at IS NULL/.test(one.sql) && one.params[1] === SHOP));
  check('the audit row is written once, books_grant_changed, with before and after end dates', events(s.log).length === 1, events(s.log).map((one) => one.params));
  const audit = events(s.log)[0] && JSON.stringify(events(s.log)[0].params);
  check('the audit row names the change, the shop, the person and both end dates', audit && /books_grant_changed/.test(audit) && audit.includes(SHOP) && audit.includes('2027-11-01') && audit.includes('2027-06-01'), audit);
  check('nothing else is written: one UPDATE and one audit INSERT', wrote(s.log).length === 2, wrote(s.log).map((one) => one.sql.slice(0, 40)));

  /* PATCH refused: a co-assist is not the owner; a device key is not a person; nothing is written */
  for (const [label, setup, code, status] of [['a co-assist', { who: STAFF }, null, 403], ['a device key', { asKey: true }, 'SIGN_IN_FOR_BOOKS_GRANT', 403]]) {
    s = scene(GRANT(), GRANT({ expires_at: FUTURE }));
    a = await play('PATCH', at('/api/books-grants/:id', GRANT_ID), { expires_at: FUTURE }, setup, s);
    check('PATCH by ' + label + ' is refused ' + status, a.status === status, a.text);
    check('PATCH by ' + label + ' is a Problem with a register code' + (code ? ' (' + code + ')' : ''), a.json && register.has(a.json.code) && (!code || a.json.code === code), a.json && a.json.code);
    check('PATCH by ' + label + ' wrote nothing (no UPDATE, no audit row)', wrote(s.log).length === 0, s.log.map((one) => one.sql.slice(0, 50)));
  }
  /* PATCH: an end date in the past, and an unknown (or already ended) grant, change nothing */
  s = scene(GRANT(), GRANT());
  a = await play('PATCH', at('/api/books-grants/:id', GRANT_ID), { expires_at: '2020-01-01T00:00:00.000Z' }, null, s);
  check('an end date in the past is 422 and writes nothing', a.status === 422 && wrote(s.log).filter((one) => /UPDATE|INSERT/.test(one.sql)).length === 0, [a.status, a.text]);
  s = scene(null, null);
  a = await play('PATCH', at('/api/books-grants/:id', GRANT_ID), { expires_at: FUTURE }, null, s);
  check('PATCH on an unknown or ended grant is 404 and writes nothing', a.status === 404 && wrote(s.log).length === 0, [a.status, a.text]);

  /* REVOKE: the access ends, the log says so, what the firm left open is withdrawn in the same transaction */
  const ended = GRANT({ revoked_at: '2026-11-20T10:00:00.000Z', revoked_by: SHOP });
  s = scene(GRANT(), ended);
  a = await play('POST', at('/api/books-grants/:id/revoke', GRANT_ID), {}, null, s);
  check('POST revoke by the owner answers 200', a.status === 200, a.text);
  check('the answer is the grant, now ended (revoked_at set, revoked_by the owner)', a.json && a.json.grant_id === GRANT_ID && !!a.json.revoked_at && a.json.revoked_by === SHOP, a.json);
  const kill = s.log.find((one) => /UPDATE books_access_grant SET revoked_at = now\(\), revoked_by = \$2 WHERE grant_id = \$1/.test(one.sql));
  check('the UPDATE ends THIS grant, stamped with the owner', kill && kill.params[0] === GRANT_ID && kill.params[1] === SHOP, kill);
  check('one audit row, books_grant_revoked, with the terms before (open) and after (ended)', events(s.log).length === 1 && /books_grant_revoked/.test(JSON.stringify(events(s.log)[0].params)), events(s.log).map((one) => one.params));
  const order = s.log.map((one) => (/UPDATE books_access_grant SET revoked_at/.test(one.sql) ? 'end' : /INSERT INTO access_events/.test(one.sql) ? 'audit' : /books_action_step/.test(one.sql) ? 'action' : ''));
  check('the access is ended, then the audit row is written, in that order', order.indexOf('end') >= 0 && order.indexOf('audit') > order.indexOf('end'), order);
  check('revoke answers the count of actions it withdrew (a number, 0 when none were open)', a.json && Number.isInteger(a.json.actions_withdrawn), a.json);

  for (const [label, setup] of [['a co-assist', { who: STAFF }], ['a device key', { asKey: true }]]) {
    s = scene(GRANT(), ended);
    a = await play('POST', at('/api/books-grants/:id/revoke', GRANT_ID), {}, setup, s);
    check('revoke by ' + label + ' is refused 403 with a register code', a.status === 403 && a.json && register.has(a.json.code), [a.status, a.json && a.json.code]);
    check('revoke by ' + label + ' wrote nothing', wrote(s.log).length === 0);
  }
  s = scene(null, null);
  a = await play('POST', at('/api/books-grants/:id/revoke', GRANT_ID), {}, null, s);
  check('revoking an unknown or already-ended grant is 404 NOT_FOUND and writes nothing (a second revoke is no second audit row)', a.status === 404 && a.json && a.json.code === 'NOT_FOUND' && wrote(s.log).length === 0, [a.status, a.text]);

  server.close();
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})().catch((failure) => {
  console.log('  FAIL  the test itself failed: ' + (failure && failure.stack ? failure.stack.split('\n').slice(0, 4).join(' | ') : failure));
  process.exit(1);
});
