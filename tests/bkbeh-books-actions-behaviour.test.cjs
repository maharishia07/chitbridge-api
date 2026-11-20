#!/usr/bin/env node
// @type: unit
/**
 * bkbeh-books-actions-behaviour.test.cjs — BEHAVIOUR of GET /api/books-actions/:id and POST /:id/review · /return · /accept (until now only the shape sweep).
 *
 * OWNS      the maker-checker result of the four doors, on the REAL routes/books-actions.js and the REAL lib/books-action over an in-memory step table (books_action_step, insert-only, as the table is):
 *           the state each door leaves (waiting_review -> waiting_accept -> accepted | returned), the step it records (who, which role, which reason), the seat that is refused (403 with the register code) and that
 *           NOTHING is recorded or posted then, a replay of a closed action, a body that changed since it was shown, a foreign grant (404 exactly as an unknown action), and for the accept the MONEY: the total the
 *           owner confirmed, its currency, the total prepared and the total the books wrote must be the one number, and the entry posted carries the lines that were shown.
 * CALLED BY CI (T1). No database, no network. The ledger writer (lib/books postEntry) is a recording stand-in: the writer's own rules are the books tests; here the question is what the ACTION door hands it and does with its answer.
 * FLOW      seat (owner · adviser colleague · the preparer · a co-assist) → real route → real lib/books-action → in-memory steps → asserts on the steps, the posted event and the answer
 * CARD      04-network/ACC-176B-ADVISER-REQUIREMENT
 */
'use strict';
const path = require('path');
const fs = require('fs');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const HERE = path.join(__dirname, '..');
const { harness, SHOP, OWNER, STAFF } = require('./lib/problem-world.cjs');

const MOUNT = '/api/books-actions';
const ACTION_ID = '66666666-6666-4666-8666-666666666666';
const GRANT_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_GRANT = '34343434-3434-4434-8434-343434343434';
const PREPARER_ID = '99999999-9999-4999-8999-999999999999';
const ENTRY_ID = '77777777-7777-4777-8777-777777777777';
const HASH = 'abc123hash';
const BODY = { narration: 'rent', date: '2026-11-15', lines: [{ account: '6100', dr_minor: 1000 }, { account: '1000', cr_minor: 1000 }] };
/* what the real front makes of a firm person under a live adviser grant (middleware/books-grant syntheticOf): the person's own id, the member's store as parent */
const ADVISER = { identity_id: STAFF.identity_id, parent_entity_id: SHOP, identity_type: 'actor', display_name: 'Firm colleague', acting_preset: 'adviser' };
const SETTING = { entity_id: SHOP, enabled: true, walkin_grain: 'day', fy_start_month: 4, functional_currency: 'INR', country: 'IN', pack_version: '1', timezone: 'Asia/Kolkata' };
const AS_FIRM = { 'x-test-acting': 'adviser' };

const standIn = (relative, exported) => {
  const file = require.resolve(path.join(HERE, relative));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: exported };
};
/* the grant front is a stand-in: a header says the request acts for the store under a live adviser grant; the person is the firm's named colleague (an actor), never the preparer */
standIn('middleware/books-grant', (req, res, next) => {
  if (req.headers['x-test-acting'] === 'adviser') Object.assign(req, { acting_for_grant: req.headers['x-test-grant'] || GRANT_ID, acting_firm_name: 'Test firm', realIdentity: { identity_id: STAFF.identity_id, identity_type: 'actor', parent_entity_id: SHOP } });
  next();
});
const lab = harness({ here: HERE, mounts: [MOUNT], routeFiles: { [MOUNT]: 'routes/books-actions.js' }, legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json'), inherited: () => false, notFrozen: () => true });
const { check, world } = lab;
const register = new Set(JSON.parse(fs.readFileSync(path.join(HERE, 'docs', 'error-codes.json'), 'utf8')).codes.map((row) => row.code));

/** the in-memory books_action_step: insert-only, ordered, a second closing step is the unique index's 23505 */
function table() {
  const steps = [];
  const posted = [];
  const state = { grantLive: true, writtenTotal: 1000, writtenCurrency: 'INR', writeFails: false };
  const add = (more) => steps.push(Object.assign({ step_id: steps.length + 1, action_id: ACTION_ID, store: SHOP, step: 'prepared', kind: 'journal', body: BODY, body_hash: HASH, total_minor: 1000, currency: 'INR', action_ref: 'ref-1', actor_identity_id: PREPARER_ID, actor_name: 'Firm preparer', firm_name: 'Test firm', role: 'maker', reason: null, grant_id: GRANT_ID, entry_id: null, at: '2026-11-15T10:00:00.000Z' }, more));
  const rows = (sql, params) => {
    const text = String(sql);
    if (/information_schema\.tables/.test(text)) return { rows: [{ '?column?': 1 }], rowCount: 1 };
    if (/FROM books_action_step WHERE store = \$1 AND action_id/.test(text)) { const mine = steps.filter((one) => String(one.store) === String(params[0]) && one.action_id === params[1]); return { rows: mine, rowCount: mine.length }; }
    if (/INSERT INTO books_action_step/.test(text)) {
      if (state.writeFails) throw Object.assign(new Error('unique'), { code: '23505' });
      const names = /\(([^)]*)\) VALUES/.exec(text)[1].split(',').map((one) => one.trim());
      const row = {};
      names.forEach((name, index) => (row[name] = params[index]));
      if (['accepted', 'returned', 'withdrawn'].includes(row.step) && steps.some((one) => ['accepted', 'returned', 'withdrawn'].includes(one.step))) throw Object.assign(new Error('unique'), { code: '23505' });
      if (row.step === 'reviewed' && steps.some((one) => one.step === 'reviewed')) throw Object.assign(new Error('unique'), { code: '23505' });
      steps.push(Object.assign({ step_id: steps.length + 1, at: '2026-11-15T11:00:00.000Z' }, row));
      return { rows: [], rowCount: 1 };
    }
    if (/AS live FROM books_access_grant/.test(text)) return { rows: [{ live: state.grantLive }], rowCount: 1 };
    if (/FROM journal_entry WHERE entity_id = \$1 AND entry_id/.test(text)) return { rows: [{ total_minor: state.writtenTotal, currency: state.writtenCurrency }], rowCount: 1 };
    return null;
  };
  return { steps, posted, state, add, rows };
}
const kinds = (store) => store.steps.map((one) => one.step);
const closing = (store) => store.steps.filter((one) => ['accepted', 'returned', 'withdrawn'].includes(one.step));

(async () => {
  lab.installStubs();
  const router = require(path.join(HERE, 'routes', 'books-actions.js'));
  const ledger = require(path.join(HERE, 'lib', 'books.js'));
  const country = require(path.join(HERE, 'lib', 'country-setup.js'));
  country.gate = async () => undefined;
  ledger.settingOf = async () => SETTING;
  const server = lab.appOf([{ mount: MOUNT, router }]).listen(0);
  const port = server.address().port;
  let attempt = 0;
  let store;
  ledger.postEntry = async (handle, shop, event) => { store.posted.push({ shop, event }); return { entry_id: ENTRY_ID, entry_no: 'JV-1' }; };
  const play = (method, tail, body, who, extra) => {
    Object.assign(world, { realAuth: false, asKey: false, db: 'ok', who, sqlRows: store.rows }, extra && extra.setup);
    const headers = Object.assign({ 'idempotency-key': 'attempt-' + ++attempt }, who === ADVISER ? AS_FIRM : {}, extra && extra.headers);
    return lab.send(port, method, MOUNT + '/' + ACTION_ID + (tail || ''), body && Object.assign({ store_id: SHOP }, body), undefined, headers);
  };
  const refused = (label, answer, status, code, untouched) => check(label, answer.status === status && answer.json && answer.json.code === code && register.has(code) && untouched(), [answer.status, answer.json && answer.json.code]);

  /* ---------- GET /:id: the action as its steps say it is ---------- */
  store = table();
  store.add({});
  let a = await play('GET', '', undefined, OWNER);
  check('the owner reads the action: 200', a.status === 200, a.text);
  check('the state is waiting_review, the total and its currency are the prepared pair (1000 INR minor), the body is the one shown', a.json && a.json.state === 'waiting_review' && a.json.total_minor === 1000 && a.json.currency === 'INR' && a.json.body_hash === HASH && a.json.body.narration === 'rent', a.json);
  check('the preparer is named with the firm and the role (the record of who)', a.json && a.json.prepared && a.json.prepared.name === 'Firm preparer' && a.json.prepared.firm === 'Test firm' && a.json.prepared.role === 'maker', a.json && a.json.prepared);
  check('nothing has been reviewed or closed: reviewed null, entry null, access not ended', a.json && a.json.reviewed === null && a.json.entry_id === null && a.json.access_ended === false, a.json);
  store.state.grantLive = false;
  a = await play('GET', '', undefined, OWNER);
  check('when the grant has ended the open action says so (access_ended true)', a.json && a.json.access_ended === true, a.json);
  store.state.grantLive = true;
  a = await play('GET', '', undefined, ADVISER, { headers: { 'x-test-grant': OTHER_GRANT } });
  refused('a firm person under ANOTHER grant is answered 404 NOT_FOUND, exactly as an unknown action', a, 404, 'NOT_FOUND', () => true);
  a = await play('GET', '', undefined, STAFF);
  refused('a co-assist is 403 ACTION_NOT_FOR_YOU', a, 403, 'ACTION_NOT_FOR_YOU', () => true);
  a = await play('GET', '', undefined, OWNER, { setup: { asKey: true } });
  refused('a device key is 403 SIGN_IN_FOR_LEDGER', a, 403, 'SIGN_IN_FOR_LEDGER', () => true);
  check('the reads wrote nothing: still one step', store.steps.length === 1);

  /* ---------- REVIEW: a named colleague of the firm; the owner and a co-assist are not the reviewer ---------- */
  store = table();
  store.add({});
  a = await play('POST', '/review', { body_hash: HASH }, ADVISER);
  check('the colleague\'s review is 200 and the action now waits for the owner (waiting_accept)', a.status === 200 && a.json.state === 'waiting_accept', a.text);
  check('exactly one step was added: reviewed, role checker, stamped with the colleague (not the preparer), the firm and the grant', kinds(store).join() === 'prepared,reviewed' && store.steps[1].role === 'checker' && store.steps[1].actor_identity_id === STAFF.identity_id && store.steps[1].firm_name === 'Test firm' && store.steps[1].grant_id === GRANT_ID, store.steps[1]);
  check('the review is bound to the body that was shown (same hash, same total and currency carried, nothing recomputed)', store.steps[1].body_hash === HASH && store.steps[1].total_minor === 1000 && store.steps[1].currency === 'INR', store.steps[1]);
  check('nothing was posted by a review', store.posted.length === 0);
  a = await play('POST', '/review', { body_hash: HASH }, ADVISER);
  refused('a second review is 409 ACTION_CLOSED and adds no step', a, 409, 'ACTION_CLOSED', () => kinds(store).join() === 'prepared,reviewed');
  store = table();
  store.add({});
  a = await play('POST', '/review', { body_hash: 'another-hash' }, ADVISER);
  refused('a review of a body that is not the one shown is 409 ACTION_BODY_CHANGED and adds no step', a, 409, 'ACTION_BODY_CHANGED', () => kinds(store).join() === 'prepared');
  a = await play('POST', '/review', { body_hash: HASH }, OWNER);
  refused('the owner cannot review: 403 ACTION_FIRM_ONLY, nothing recorded', a, 403, 'ACTION_FIRM_ONLY', () => kinds(store).join() === 'prepared');
  a = await play('POST', '/review', { body_hash: HASH }, ADVISER, { headers: { 'x-test-grant': OTHER_GRANT } });
  refused('a firm person under another grant: 404 NOT_FOUND, nothing recorded', a, 404, 'NOT_FOUND', () => kinds(store).join() === 'prepared');
  a = await play('POST', '/review', { body_hash: HASH }, ADVISER, { setup: { asKey: true } });
  refused('a device key: 403 SIGN_IN_FOR_LEDGER, nothing recorded', a, 403, 'SIGN_IN_FOR_LEDGER', () => kinds(store).join() === 'prepared');

  /* ---------- RETURN: the round ends with a reason; nothing is posted ---------- */
  store = table();
  store.add({});
  a = await play('POST', '/return', { body_hash: HASH, reason: 'wrong month' }, OWNER);
  check('the owner returns the action: 200, state returned', a.status === 200 && a.json.state === 'returned', a.text);
  check('one closing step: returned, role owner, with the reason in the owner\'s words, stamped with the owner and no grant', closing(store).length === 1 && closing(store)[0].step === 'returned' && closing(store)[0].role === 'owner' && closing(store)[0].reason === 'wrong month' && closing(store)[0].actor_identity_id === SHOP && closing(store)[0].grant_id === null, closing(store));
  check('a return posts nothing to the books', store.posted.length === 0);
  a = await play('POST', '/return', { body_hash: HASH, reason: 'again' }, OWNER);
  refused('returning it again is 409 ACTION_CLOSED, still one closing step', a, 409, 'ACTION_CLOSED', () => closing(store).length === 1);
  store = table();
  store.add({});
  a = await play('POST', '/return', { body_hash: HASH, reason: 'ab' }, OWNER);
  refused('a reason under 3 characters is 422 ACTION_REASON_NEEDED, nothing recorded', a, 422, 'ACTION_REASON_NEEDED', () => closing(store).length === 0);
  a = await play('POST', '/return', { body_hash: HASH, reason: 'wrong month' }, STAFF);
  refused('a co-assist is 403 ACTION_NOT_FOR_YOU, nothing recorded', a, 403, 'ACTION_NOT_FOR_YOU', () => closing(store).length === 0);
  a = await play('POST', '/return', { body_hash: HASH, reason: 'wrong month' }, ADVISER);
  check('the firm colleague returns what the preparer made: 200, role checker', a.status === 200 && closing(store)[0] && closing(store)[0].role === 'checker' && closing(store)[0].actor_identity_id === STAFF.identity_id, [a.status, closing(store)]);
  store = table();
  store.add({ actor_identity_id: STAFF.identity_id, actor_name: 'Firm colleague' });
  a = await play('POST', '/return', { body_hash: HASH, reason: 'my own work' }, ADVISER);
  refused('a firm person cannot return their OWN work: 403 ACTION_SELF_REVIEW, nothing recorded', a, 403, 'ACTION_SELF_REVIEW', () => closing(store).length === 0);

  /* ---------- ACCEPT: the owner, the money, the entry ---------- */
  store = table();
  store.add({});
  store.add({ step: 'reviewed', role: 'checker', actor_identity_id: STAFF.identity_id, actor_name: 'Firm colleague' });
  a = await play('POST', '/accept', { body_hash: HASH, total_minor: 1000, currency: 'INR' }, OWNER);
  check('the owner accepts a reviewed action: 200', a.status === 200, a.text);
  check('the answer carries the action accepted and the entry numbered', a.json && a.json.action && a.json.action.state === 'accepted' && a.json.entry && a.json.entry.entry_no === 'JV-1' && a.json.entry.entry_id === ENTRY_ID, a.json);
  check('the existing writer was handed ONE event for THIS store: the narration, the date and the lines that were shown, with the action as its source', store.posted.length === 1 && store.posted[0].shop === SHOP && store.posted[0].event.source_ref === 'action:' + ACTION_ID, store.posted);
  const posted = store.posted[0] && store.posted[0].event;
  const lines = (posted && posted.lines) || [];
  check('the event holds the two lines of the body in the ledger currency: 6100 debit 10.00 and 1000 credit 10.00 INR (1000 minor each side), balanced', posted && posted.currency === 'INR' && lines.length === 2 && lines[0].account === '6100' && lines[0].dr === 10 && lines[0].cr === 0 && lines[1].account === '1000' && lines[1].cr === 10 && lines[1].dr === 0 && posted.narration === 'rent' && posted.date === '2026-11-15', posted);
  check('the entry is created by the PREPARER (the firm\'s person), not by the owner who accepted', posted && posted.by === PREPARER_ID, posted && posted.by);
  const accepted = closing(store)[0];
  check('one closing step: accepted, role owner, stamped with the owner, linked to the entry, carrying the prepared total and currency', closing(store).length === 1 && accepted.step === 'accepted' && accepted.role === 'owner' && accepted.actor_identity_id === SHOP && accepted.entry_id === ENTRY_ID && accepted.total_minor === 1000 && accepted.currency === 'INR', accepted);
  check('a reviewed action is not marked "accepted without a review"', accepted && accepted.reason !== 'accepted without a review', accepted && accepted.reason);
  a = await play('POST', '/accept', { body_hash: HASH, total_minor: 1000, currency: 'INR' }, OWNER);
  check('a second accept (a new attempt) is refused 409 ACTION_CLOSED: nothing posted twice, still one closing step', a.status === 409 && a.json.code === 'ACTION_CLOSED' && store.posted.length === 1 && closing(store).length === 1, [a.status, a.json && a.json.code, store.posted.length]);

  store = table();
  store.add({});
  a = await play('POST', '/accept', { body_hash: HASH, total_minor: 1000, currency: 'INR' }, OWNER);
  check('accepting with no review is allowed and the record SAYS it was not reviewed', a.status === 200 && closing(store)[0] && closing(store)[0].reason === 'accepted without a review', [a.status, closing(store)]);

  /* money refusals: nothing posted, nothing closed */
  const fresh = () => { store = table(); store.add({}); };
  fresh();
  a = await play('POST', '/accept', { body_hash: HASH, total_minor: 1001, currency: 'INR' }, OWNER);
  refused('a confirmed total of 1001 against a prepared 1000 is 409 PREVIEW_TOTAL_DIFFERS; nothing posted, not accepted', a, 409, 'PREVIEW_TOTAL_DIFFERS', () => store.posted.length === 0 && closing(store).length === 0);
  check('the refusal names both figures in words (the owner reads the difference)', a.json && /INR 10\b.*INR 10\.01/.test(a.json.detail), a.json && a.json.detail);
  fresh();
  a = await play('POST', '/accept', { body_hash: HASH, total_minor: 1000, currency: 'AUD' }, OWNER);
  refused('the right figure in the WRONG currency (AUD for INR) is 409 PREVIEW_TOTAL_DIFFERS, nothing posted', a, 409, 'PREVIEW_TOTAL_DIFFERS', () => store.posted.length === 0 && closing(store).length === 0);
  fresh();
  a = await play('POST', '/accept', { body_hash: HASH }, OWNER);
  refused('no confirmed total is 422 ACTION_TOTAL_NEEDED, nothing posted', a, 422, 'ACTION_TOTAL_NEEDED', () => store.posted.length === 0 && closing(store).length === 0);
  fresh();
  store.state.writtenTotal = 1200;
  a = await play('POST', '/accept', { body_hash: HASH, total_minor: 1000, currency: 'INR' }, OWNER);
  refused('when the books WROTE another total than the one carried (1200 for 1000) the accept is 409 PREVIEW_TOTAL_DIFFERS and is NOT recorded as accepted', a, 409, 'PREVIEW_TOTAL_DIFFERS', () => closing(store).length === 0);
  fresh();
  store.state.grantLive = false;
  a = await play('POST', '/accept', { body_hash: HASH, total_minor: 1000, currency: 'INR' }, OWNER);
  refused('an access that has ended is 409 ACTION_ACCESS_ENDED, nothing posted', a, 409, 'ACTION_ACCESS_ENDED', () => store.posted.length === 0 && closing(store).length === 0);
  fresh();
  a = await play('POST', '/accept', { body_hash: 'another-hash', total_minor: 1000, currency: 'INR' }, OWNER);
  refused('a body that is not the one shown is 409 ACTION_BODY_CHANGED, nothing posted', a, 409, 'ACTION_BODY_CHANGED', () => store.posted.length === 0 && closing(store).length === 0);
  fresh();
  a = await play('POST', '/accept', { body_hash: HASH, total_minor: 1000, currency: 'INR' }, ADVISER);
  refused('the firm cannot accept: 403 OWNER_ONLY, nothing posted', a, 403, 'OWNER_ONLY', () => store.posted.length === 0 && closing(store).length === 0);
  a = await play('POST', '/accept', { body_hash: HASH, total_minor: 1000, currency: 'INR' }, STAFF);
  refused('a co-assist cannot accept: 403 OWNER_ONLY, nothing posted', a, 403, 'OWNER_ONLY', () => store.posted.length === 0 && closing(store).length === 0);
  a = await play('POST', '/accept', { body_hash: HASH, total_minor: 1000, currency: 'INR' }, OWNER, { headers: { 'idempotency-key': '' } });
  refused('an accept with no Idempotency-Key is 422 IDEMPOTENCY_KEY_REQUIRED (a money write), nothing posted', a, 422, 'IDEMPOTENCY_KEY_REQUIRED', () => store.posted.length === 0 && closing(store).length === 0);
  a = await play('POST', '/accept', { body_hash: HASH, total_minor: 1000, currency: 'INR' }, OWNER, { setup: { asKey: true } });
  refused('a device key cannot accept: 403 SIGN_IN_FOR_LEDGER, nothing posted', a, 403, 'SIGN_IN_FOR_LEDGER', () => store.posted.length === 0 && closing(store).length === 0);

  server.close();
  console.log('\n  ' + lab.count.passed + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})().catch((failure) => {
  console.log('  FAIL  the test itself failed: ' + (failure && failure.stack ? failure.stack.split('\n').slice(0, 4).join(' | ') : failure));
  process.exit(1);
});
