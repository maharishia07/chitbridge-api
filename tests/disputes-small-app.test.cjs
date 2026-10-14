/**
 * disputes-small-app.test.cjs — T3-DISPUTES-ASSIST: the three server answers CB Tasks & Orders › Disputes and › CB Assist paint.
 *
 *   A  lib/rail-actions forDispute — may I resolve this dispute: the access level first (the rail's own words), then open, then the raiser
 *      only; every refusal carries a code (why) and a sentence (say), never prose alone
 *   B  lib/home-facts disputes — the Home card: "N disputes open" + "M raised by you"; none open says so in words; no table → no figure (never 0)
 *   C  GET /api/assist/whoami — may.publish: ok for a help desk, greyed not_helpdesk with its sentence for everyone else
 *
 * The queue's page shape (total · page · limit · side · may · one roster read) is held by tests/dispute-scoping.test.cjs over its modelled store.
 * Offline: no database, no network beyond 127.0.0.1.   Run: node tests/disputes-small-app.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';
let pass = 0, fail = 0;
const ok = (label, cond, more) => { cond ? pass++ : fail++; console.log('  ' + (cond ? 'ok  ' : 'FAIL') + '  ' + label + (cond || !more ? '' : '   ' + more)); };
const mock = (rel, exports) => { require.cache[require.resolve(API + rel)] = { id: rel, filename: rel, loaded: true, exports }; };

/* ── the stand-in database: one answer per statement, set per case ── */
let ANSWER = () => ({ rows: [] }), sent = [];
const run = async (s, p) => { sent.push(String(s)); const a = ANSWER(String(s), p); if (a instanceof Error) throw a; return a; };
mock('/db', { query: run, withEntity: async (_id, fn) => fn({ query: run }), withTransaction: async (fn) => fn({ query: run }), readBatch: async () => [] });
let WHO = { identity_id: 'e1', identity_type: 'entity' };
mock('/middleware/auth', Object.assign((req, res, next) => { req.identity = WHO; next(); }, {
  entityOf: (req) => (req.identity && (req.identity.parent_entity_id || req.identity.identity_id)) || null,
  requireScope: () => (req, res, next) => next(),
}));

const RA = require(API + '/lib/rail-actions');
const home = require(API + '/lib/home-facts');

(async () => {
  console.log('A · forDispute');
  const editor = { level: 'editor' }, viewer = { level: 'viewer' }, commenter = { level: 'commenter' };
  ok('the raiser, open → may resolve', RA.forDispute({ status: 'open', raised_by_entity_id: 'e1' }, editor, 'e1').resolve.ok === true);
  const nr = RA.forDispute({ status: 'open', raised_by_entity_id: 'e2' }, editor, 'e1').resolve;
  ok('the other side → not_raiser, with its sentence', nr.ok === false && nr.why === 'not_raiser' && nr.say === RA.DISPUTE_WHY.not_raiser, JSON.stringify(nr));
  const rs = RA.forDispute({ status: 'resolved', raised_by_entity_id: 'e1' }, editor, 'e1').resolve;
  ok('a resolved one → resolved', rs.ok === false && rs.why === 'resolved' && !!rs.say, JSON.stringify(rs));
  const vw = RA.forDispute({ status: 'open', raised_by_entity_id: 'e1' }, viewer, 'e1').resolve;
  ok('a view-only login → the rail\'s read_only, in the rail\'s sentence', vw.ok === false && vw.why === 'read_only' && vw.say === RA.WHY.read_only, JSON.stringify(vw));
  const cm = RA.forDispute({ status: 'open', raised_by_entity_id: 'e1' }, commenter, 'e1').resolve;
  ok('a comment-only login → comment_only', cm.ok === false && cm.why === 'comment_only', JSON.stringify(cm));

  console.log('B · the disputes Home card');
  ok('the card is registered', typeof home.BUILD.disputes === 'function');
  ANSWER = (s) => (/FROM chit_disputes/.test(s) ? { rows: [{ open: 3, mine: 1 }] } : { rows: [] });
  sent = [];
  let c = await home.BUILD.disputes({ entity: 'e1' });
  ok('3 open, 1 mine → two lines, the first red', c.lines.length === 2 && c.lines[0].text === '3 disputes open' && c.lines[0].tone === 'dn' && c.lines[1].text === '1 raised by you', JSON.stringify(c));
  ok('…one statement', sent.length === 1);
  ANSWER = () => ({ rows: [{ open: 0, mine: 0 }] });
  c = await home.BUILD.disputes({ entity: 'e1' });
  ok('none open says so in words', c.lines.length === 1 && c.lines[0].text === 'No open disputes', JSON.stringify(c));
  ANSWER = () => Object.assign(new Error('relation "chit_disputes" does not exist'), { code: '42P01' });
  c = await home.BUILD.disputes({ entity: 'e1' });
  ok('no disputes table → no figure (never 0)', c.lines.length === 0 && !!c.unavailable, JSON.stringify(c));

  console.log('C · GET /api/assist/whoami may.publish');
  const app = express(); app.use(express.json()); app.use('/api/assist', require(API + '/routes/assist'));
  const srv = app.listen(0); await new Promise((r) => srv.once('listening', r));
  const get = (u) => new Promise((res, rej) => http.get('http://127.0.0.1:' + srv.address().port + u, (r) => { let b = ''; r.on('data', (d) => b += d); r.on('end', () => res({ status: r.statusCode, body: JSON.parse(b || '{}') })); }).on('error', rej));
  ANSWER = (s) => (/Assistant Q&A/.test(s) ? { rows: [{ '?column?': 1 }] } : { rows: [] });
  let w = await get('/api/assist/whoami');
  ok('a help desk → may.publish ok', w.status === 200 && w.body.is_helpdesk === true && w.body.may.publish.ok === true, JSON.stringify(w.body));
  ANSWER = () => ({ rows: [] });
  w = await get('/api/assist/whoami');
  ok('anyone else → greyed not_helpdesk with its sentence', w.body.is_helpdesk === false && w.body.may.publish.ok === false && w.body.may.publish.why === 'not_helpdesk' && !!w.body.may.publish.say, JSON.stringify(w.body));
  ANSWER = () => new Error('connection lost');
  w = await get('/api/assist/whoami');
  ok('a failed read → still an answer: greyed, not a 500', w.status === 200 && w.body.may.publish.ok === false, JSON.stringify(w.body));
  srv.close();

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
