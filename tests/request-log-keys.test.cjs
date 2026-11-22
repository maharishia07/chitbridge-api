'use strict';
/**
 * CARD  28-platform-and-operations/logging-and-observability-db-watch
 * ERR-14 part 3 · the request log line carries `seat` (a role word) and `route` (the matched pattern) beside the keys it had, and never an e-mail, phone or name.
 * Drives lib/request-log.js through a real express router, so req.route and req.baseUrl are the real ones.
 * Run: node tests/request-log-keys.test.cjs
 */
const express = require('express'), http = require('http');
const { requestLine, seatOf } = require('../lib/request-log');
const { SEAT_NAMES } = require('../lib/role-matrix');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  XX  ' + m); } };

const OWNER = { identity_id: 'ent-1', identity_type: 'entity', email: 'owner@example.com', display_name: 'Asha Rao', phone: '+919800000001', parent_entity_id: null };
const STAFF = { identity_id: 'act-9', identity_type: 'actor', hat: 'act', email: 'staff@example.com', display_name: 'Ravi Kumar', parent_entity_id: 'ent-1' };
const lines = [];

const app = express();
app.use((req, res, next) => { const who = req.headers['x-test-who']; req.id = 'rid-' + (who || 'none'); if (who) req.identity = who === 'owner' ? OWNER : STAFF; const t0 = Date.now(); res.on('finish', () => lines.push(requestLine(req, res, t0))); next(); });
const router = express.Router();
router.get('/:chit_id', (req, res) => res.json({}));
router.get('/', (req, res) => res.json({}));
app.use('/api/chits', router);

const ask = (p, who) => new Promise((resolve) => http.get({ host: '127.0.0.1', port: server.address().port, path: p, headers: who ? { 'x-test-who': who } : {} }, (r) => { r.resume(); r.on('end', resolve); }));
let server;
(async () => {
  server = app.listen(0);
  await ask('/api/chits/abc123?q=1', 'owner');
  await ask('/api/chits/xyz789', 'staff');
  await ask('/api/chits', null);
  await ask('/api/nothing-here/77', null);
  server.close();
  const byId = (id) => lines.find((l) => l.id === id);
  const o = byId('rid-owner'), s = byId('rid-staff'), a = byId('rid-none');
  ok(o && o.seat === 'owner' && o.route === '/api/chits/:chit_id', 'an owner line: seat owner, route is the pattern, not the id (' + JSON.stringify(o && [o.seat, o.route]) + ')');
  ok(s && s.seat === 'staff' && s.route === '/api/chits/:chit_id' && s.entity === 'ent-1', 'a staff line: seat staff, same route, the shop is the entity');
  ok(o && o.path === '/api/chits/abc123' && o.id === 'rid-owner' && o.entity === 'ent-1' && o.person === 'ent-1' && 'ms' in o && 'status' in o && 'bytes' in o && 'code' in o, 'the existing keys are kept (id, path, entity, person, ms, status, bytes, code)');
  ok(a && a.seat === 'anon' && a.route === '/api/chits', 'no sign-in: seat anon, a root route keeps its mount');
  const none = lines.find((l) => l.path === '/api/nothing-here/77');
  ok(none && none.route === null && none.status === 404, 'no route matched: route null');
  lines.forEach((l) => ok(SEAT_NAMES.concat('customer').includes(l.seat), 'seat is one of the seat words: ' + l.seat));
  const text = JSON.stringify(lines);
  ok(!/example\.com|Asha|Ravi|\+91980|@/.test(text), 'no e-mail, name or phone on any request line');
  ok(seatOf({ identity: { identity_type: 'actor', hat: 'audit' } }) === 'auditor' && seatOf({ identity: OWNER, acting_for_grant: 'g1', books_role: 'adviser' }) === 'adviser', 'hat audit → auditor; a grant look → the grant role');
  console.log('request-log-keys: ' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
