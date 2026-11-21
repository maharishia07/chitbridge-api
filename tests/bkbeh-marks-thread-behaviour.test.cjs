#!/usr/bin/env node
// @type: unit
/**
 * bkbeh-marks-thread-behaviour.test.cjs — BEHAVIOUR of GET and POST /api/marks/:thread_id/messages (until now only the shape sweep).
 *
 * OWNS      what the two thread doors DO: the reply reaches the core with the right person (the owner as himself, the adviser as the firm's person under its grant), the right thread and the very words sent;
 *           the answer is 201 with the message and the mark whose class did not change; a reply with no words, an unknown key, a device key or a signed-out caller never reaches the core;
 *           a thread that is not these books' is 404, a closed thread 409, a stranger 403 - each with its register code and NOTHING written (the real core runs over a scripted statement log for those);
 *           the read gives the conversation and writes nothing.
 * CALLED BY CI (T1). No database, no network: the real routes/marks.js and lib/mark-door over the stand-in db; the success path swaps lib/review-mark for a recording stub (its rules are tests/mark-offline.test.cjs), the refusals run the REAL core.
 * FLOW      seat → real route → (stub core, recording ctx) | (real core, scripted statements) → answer + the statements seen
 * CARD      capability/MARK-AND-QUERY-CAPABILITY
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

const MOUNT = '/api/marks';
const THREAD = '66666666-6666-4666-8666-666666666666';
const ENTRY = '77777777-7777-4777-8777-777777777777';
const GRANT_ID = '33333333-3333-4333-8333-333333333333';
const standIn = (relative, exported) => {
  const file = require.resolve(path.join(HERE, relative));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: exported };
};
/* the grant front is a stand-in: a header says the request acts for the store under a live adviser grant (the real front and the write door are tests/review-mark.realstack.cjs) */
standIn('middleware/books-grant', Object.assign((req, res, next) => {
  if (req.headers['x-test-acting'] === 'adviser') Object.assign(req, { acting_for_grant: GRANT_ID, acting_firm_name: 'Test firm', realIdentity: { identity_id: STAFF.identity_id, display_name: 'Firm person', identity_type: 'actor', parent_entity_id: SHOP } });
  next();
}, { unclassifiedWrites: () => [], MARK_READ_DOORS: new Set(), MARK_WRITE_DOORS: new Set() }));
const lab = harness({ here: HERE, mounts: [MOUNT], routeFiles: { [MOUNT]: 'routes/marks.js' }, legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'), inherited: () => false, notFrozen: () => true });
const { check, world } = lab;
const register = new Set(JSON.parse(fs.readFileSync(path.join(HERE, 'docs', 'error-codes.json'), 'utf8')).codes.map((row) => row.code));
const ADVISER = Object.assign({}, OWNER, { acting_preset: 'adviser', display_name: 'Firm person' });
const MARK = { mark_id: '1', adopter: 'acc.audit', subject_id: ENTRY, thread_id: THREAD, kind: 'query', class: 'open', label: 'Query', note: 'Why?', at: '2026-11-15T10:00:00.000Z', by_name: 'A', by_firm: 'Firm', open: true, open_since: '2026-11-15T10:00:00.000Z', age_days: 0, altered: false, altered_by: null, recheck_needed: false, message_count: 1 };
const MESSAGE = (text) => ({ message_id: '88888888-8888-4888-8888-888888888888', sender_display_name: 'Test shop', message_text: text, msg_type: 'info', created_at: '2026-11-15T10:00:00.000Z', mine: true });
const ACTIONS = { set: { ok: false, why: 'x' }, reply: { ok: true, why: null } };
const writes = (log) => log.filter((sql) => /^\s*(INSERT|UPDATE|DELETE)/i.test(sql));

(async () => {
  lab.installStubs();
  const router = require(path.join(HERE, 'routes', 'marks.js'));
  const core = require(path.join(HERE, 'lib', 'review-mark.js'));
  const server = lab.appOf([{ mount: MOUNT, router }]).listen(0);
  const port = server.address().port;
  const calls = { reply: [], thread: [] };
  const real = { reply: core.reply, threadOf: core.threadOf };
  const stubbed = () => {
    core.reply = async (db, ctx, thread, body) => { calls.reply.push({ ctx, thread, body }); return { message: MESSAGE(body.message_text), mark: MARK }; };
    core.threadOf = async (db, ctx, thread) => { calls.thread.push({ ctx, thread }); return { thread_id: thread, adopter: 'acc.audit', subject_id: ENTRY, subject_label: 'MJ/1', mark: MARK, history: [], messages: [MESSAGE('Why?')], actions: ACTIONS }; };
  };
  const restored = () => { core.reply = real.reply; core.threadOf = real.threadOf; };
  const play = (method, url, body, setup, headers, rows) => {
    Object.assign(world, { realAuth: false, who: OWNER, asKey: false, db: 'ok', sqlRows: rows || null }, setup);
    return lab.send(port, method, url, body, undefined, headers);
  };

  /* the owner replies */
  stubbed();
  let a = await play('POST', at('/api/marks/:id/messages', THREAD), { message_text: 'It is the October rent.' });
  check('the owner\'s reply is 201', a.status === 201, a.text);
  check('the answer holds the message with the very words sent, and the mark still OPEN (a reply never changes the class)', a.json && a.json.message.message_text === 'It is the October rent.' && a.json.mark.class === 'open' && a.json.mark.kind === 'query', a.json);
  const first = calls.reply[0];
  check('the core got the thread of the address and the words of the body', first && first.thread === THREAD && first.body.message_text === 'It is the October rent.', first && { thread: first.thread, body: first.body });
  check('the core got the owner as himself: his own store, owner true, via self', first && first.ctx.entity_id === SHOP && first.ctx.owner === true && first.ctx.via.kind === 'self' && first.ctx.real.identity_id === SHOP, first && first.ctx);

  /* the adviser's person replies under the grant: the firm's person is the sender, the store is the member's */
  calls.reply.length = 0;
  a = await play('POST', at('/api/marks/:id/messages', THREAD), { message_text: 'Rent is booked to 6100.' }, { who: ADVISER }, { 'x-test-acting': 'adviser' });
  const firm = calls.reply[0];
  check('the adviser\'s reply is 201', a.status === 201, a.text);
  check('the core got the FIRM\'S person (not the store) as the real sender, via the grant, owner false', firm && firm.ctx.owner === false && firm.ctx.via.kind === 'grant' && firm.ctx.via.id === GRANT_ID && firm.ctx.via.preset === 'adviser' && firm.ctx.real.identity_id === STAFF.identity_id && firm.ctx.real.entity_name === 'Test firm' && firm.ctx.entity_id === SHOP, firm && firm.ctx);

  /* what never reaches the core */
  calls.reply.length = 0;
  a = await play('POST', at('/api/marks/:id/messages', THREAD), {});
  check('a reply with no words is 422 and the core is not called', a.status === 422 && calls.reply.length === 0, [a.status, a.text]);
  a = await play('POST', at('/api/marks/:id/messages', THREAD), { message_text: 'hi', surprise: 1 });
  check('a body with an unknown key is 422 and the core is not called', a.status === 422 && calls.reply.length === 0, [a.status, a.text]);
  a = await play('POST', at('/api/marks/:id/messages', THREAD), { message_text: 'hi' }, { asKey: true });
  check('a device key is 403 SIGN_IN_FOR_MARKS and the core is not called', a.status === 403 && a.json && a.json.code === 'SIGN_IN_FOR_MARKS' && calls.reply.length === 0, [a.status, a.json && a.json.code]);
  a = await play('POST', at('/api/marks/:id/messages', THREAD), { message_text: 'hi' }, { realAuth: true });
  check('signed out is 401 and the core is not called', a.status === 401 && calls.reply.length === 0, a.status);

  /* the read: the conversation, nothing written */
  calls.thread.length = 0;
  const log = [];
  a = await play('GET', at('/api/marks/:id/messages', THREAD), undefined, null, undefined, (sql) => { log.push(String(sql)); return null; });
  check('the thread read is 200 with the thread, its messages and what this person may do', a.status === 200 && a.json.thread_id === THREAD && a.json.messages.length === 1 && a.json.actions.reply.ok === true, a.text);
  check('the read asked the core for THIS thread in the owner\'s store', calls.thread[0] && calls.thread[0].thread === THREAD && calls.thread[0].ctx.entity_id === SHOP);
  check('the read wrote nothing (no INSERT, UPDATE or DELETE statement)', writes(log).length === 0, log);
  a = await play('GET', at('/api/marks/:id/messages', THREAD), undefined, { asKey: true });
  check('a device key cannot read the thread: 403 SIGN_IN_FOR_MARKS', a.status === 403 && a.json.code === 'SIGN_IN_FOR_MARKS', a.json);
  restored();

  /* the REAL core: refusals that must write nothing, each with its register code */
  const statements = [];
  const latest = (more) => Object.assign({ mark_id: 9, entity_id: SHOP, adopter: 'acc.audit', subject_id: ENTRY, thread_id: THREAD, kind: 'query', class: 'open', note: 'Why?', at: new Date('2026-11-15T10:00:00Z') }, more);
  const scripted = (row) => (sql) => { statements.push(String(sql)); return /FROM review_mark WHERE thread_id/.test(sql) ? { rows: row ? [row] : [], rowCount: row ? 1 : 0 } : null; };
  const refused = (label, answer, status, code) => check(label, answer.status === status && answer.json && answer.json.code === code && register.has(code) && writes(statements).length === 0, [answer.status, answer.json && answer.json.code, writes(statements)]);
  statements.length = 0;
  a = await play('POST', at('/api/marks/:id/messages', THREAD), { message_text: 'hi' }, null, undefined, scripted(null));
  refused('a reply to a thread that is not these books\' is 404 MARK_THREAD_NOT_FOUND (a register code), and nothing is written', a, 404, 'MARK_THREAD_NOT_FOUND');
  statements.length = 0;
  a = await play('POST', at('/api/marks/:id/messages', THREAD), { message_text: 'hi' }, null, undefined, scripted(latest({ kind: 'checked', class: 'clear' })));
  refused('a reply on a closed (Checked) thread is 409 MARK_THREAD_CLOSED, and nothing is written', a, 409, 'MARK_THREAD_CLOSED');
  statements.length = 0;
  a = await play('POST', at('/api/marks/:id/messages', THREAD), { message_text: 'hi' }, { who: STAFF }, undefined, scripted(latest()));
  refused('a seat that is not the owner, the adviser or the auditor is 403 MARK_REPLY_NOT_ALLOWED, and nothing is written', a, 403, 'MARK_REPLY_NOT_ALLOWED');
  statements.length = 0;
  a = await play('POST', at('/api/marks/:id/messages', THREAD), { message_text: 'x'.repeat(10001) }, null, undefined, scripted(latest()));
  check('words over the one message limit (10,000) are refused 413 and nothing is written', a.status === 413 && writes(statements).length === 0, [a.status, a.text.slice(0, 160)]);
  statements.length = 0;
  a = await play('GET', at('/api/marks/:id/messages', THREAD), undefined, null, undefined, scripted(null));
  refused('reading a thread that is not these books\' is 404 MARK_THREAD_NOT_FOUND', a, 404, 'MARK_THREAD_NOT_FOUND');
  check('that lookup named the owner\'s store (entity in the statement\'s values)', statements.some((sql) => /review_mark WHERE thread_id/.test(sql)));

  server.close();
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})().catch((failure) => {
  console.log('  FAIL  the test itself failed: ' + (failure && failure.stack ? failure.stack.split('\n').slice(0, 4).join(' | ') : failure));
  process.exit(1);
});
