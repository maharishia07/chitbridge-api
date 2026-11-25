/**
 * tests/assign-register.test.cjs — ASSIGN-1: the generic assign capability's register and the rules around it, with no database (a stand-in transaction records the statements).
 *
 * HAND-COMPUTED (D1 / DECISIONS-SLICE1 / CAP-REVIEW; every expectation is the document's sentence, not a read-back of the code):
 *   register   every plug has every key; client = copy sent, carrier chit, subject_match party, may_assign manager, gate holds, listed_in own; task/line = today's behaviour (any); product_set is designed, not built.
 *   W3 (T14)   a job batch: the owner or an actor of hat `manager` may; hat act, view_only, audit, mis, a key and a grant-synthetic identity may not (CHIT_NOT_PERMITTED, the WHOLE call). A task batch: any actor.
 *   holds      F1 two jobs two holders both pass · F3 direction = sent, LIMIT 1 · F4 no holder no pass · F5 the role is in the predicate · F9 the grant still decides first · T13 switch `all` (or absent) asks no chit table.
 *   switch     absent = all · `all` = all · any other word (also an unreadable one) = assigned (fail closed).
 *   door       no door calls verdictOf itself: finalOutcome is the one (a new door is born gated).
 *   opener     the idempotency key is job:<plug>:<role>:<subject>:<period>; a repeat opens nothing twice; unknown and foreign ids answer THE SAME skip; 150 asked twice = 150 opened then 150 existing.
 * Run: node tests/assign-register.test.cjs
 * CARD 01-rail-core-the-chit/assign
 */
'use strict';
const fs = require('fs');
const path = require('path');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const register = require('../lib/assign-register');
const owner = require('../lib/owner');
const grants = require('../lib/books-grant');
const jobsOpen = require('../lib/jobs-open');
const matrix = require('../lib/role-matrix');
const railActions = require('../lib/rail-actions');

let pass = 0;
let fail = 0;
const check = (name, ok, extra) => {
  if (ok) pass++;
  else {
    fail++;
    console.log('  FAIL ' + name + (extra ? '\n       ' + extra : ''));
  }
};
const FIRM = '11111111-1111-4111-8111-111111111111';
const CLIENT = '22222222-2222-4222-8222-222222222222';
const ACTOR = '33333333-3333-4333-8333-333333333333';

/* ── the register ─────────────────────────────────────────────────────────────── */
for (const [name, entry] of Object.entries(register.REGISTER)) {
  check('register: plug ' + name + ' has every key', register.KEYS.every((key) => Object.prototype.hasOwnProperty.call(entry, key)), 'missing ' + register.KEYS.filter((key) => !(key in entry)));
  check('register: plug ' + name + ' names itself', entry.plug === name);
  check('register: plug ' + name + ' uses only the words the register lists', Object.keys(register.WORDS).every((key) => register.WORDS[key].includes(entry[key])), name);
  check('register: plug ' + name + ' is frozen (values, never logic)', Object.isFrozen(entry) && Object.values(entry).every((value) => typeof value !== 'function'));
}
const client = register.REGISTER.client;
check('client: copy sent · carrier chit · subject_match party · may_assign manager · gate holds · listed_in own', client.copy === 'sent' && client.carrier === 'chit' && client.subject_match === 'party' && client.may_assign === 'manager' && client.gate === 'holds' && client.listed_in === 'own');
check('client: roles are the grant roles, opens a general chit', client.roles.join() === 'adviser,auditor' && client.opens.purpose === 'general');
check('task and line keep today: any may assign, received copy, no gate', ['task', 'line'].every((name) => register.REGISTER[name].may_assign === 'any' && register.REGISTER[name].gate === null && register.REGISTER[name].copy === 'received'));
check('only a built plug with `opens` can open a job', register.OPENERS.join() === 'client');
check('an unknown plug has no entry and the strictest level (fail closed)', register.entryOf('nope') === null && register.levelOf('nope') === 'owner' && register.entryOf('__proto__') === null);
check('product_set is designed not built: holds() refuses it by name', register.REGISTER.product_set.built === false);
check('the register has no neutral-word leak: no accounting word in any value', !/account|adviser|auditor|books/i.test(JSON.stringify(Object.assign({}, register.REGISTER.task, register.REGISTER.line, register.REGISTER.product_set))));

/* ── W3: who may assign a job (T14) ─────────────────────────────────────────── */
const asOwner = { identity: { identity_id: FIRM, identity_type: 'entity' } };
const actor = (hat, more) => ({ identity: Object.assign({ identity_id: ACTOR, identity_type: 'actor', parent_entity_id: FIRM, hat }, more || {}) });
check('W3: the owner may at manager and at owner level', owner.mayAt(asOwner, 'manager').ok && owner.mayAt(asOwner, 'owner').ok);
check('W3: a manager-hat actor may at manager level, not at owner level', owner.mayAt(actor('manager'), 'manager').ok && !owner.mayAt(actor('manager'), 'owner').ok);
for (const hat of ['act', 'view_only', 'view', 'audit', 'mis', undefined]) check('W3: hat ' + hat + ' is refused CHIT_NOT_PERMITTED', owner.mayAt(actor(hat), 'manager').ok === false && owner.mayAt(actor(hat), 'manager').code === 'CHIT_NOT_PERMITTED');
check('W3: a manager hat acting for a grant (synthetic identity) is refused', !owner.mayAt(actor('manager', { acting_for_grant: 'g1' }), 'manager').ok);
check('W3: an API key is refused even as the entity', !owner.mayAt(Object.assign({ api_key: 'k' }, asOwner), 'manager').ok && !owner.mayAt(Object.assign({ api_key: 'k' }, actor('manager')), 'manager').ok);
check('W3: level any lets every signed-in actor (tasks keep today)', owner.mayAt(actor('act'), 'any').ok);
check('W3: an unknown level fails closed', !owner.mayAt(asOwner, 'banana').ok);
check('W3: the sentence', owner.mayAt(actor('act'), 'manager').why === 'Only the partner or a manager can assign clients.');
check('W3: the gate is tagged roleGate manager (tools/api-reported.cjs)', owner.managerGate().roleGate === 'manager');
check('role matrix: the staff answer manager exists and OWNER_MANAGER_ONLY is well formed', matrix.problemsOf(matrix.SEATS.OWNER_MANAGER_ONLY).length === 0 && matrix.SEATS.OWNER_MANAGER_ONLY.staff === 'manager' && matrix.SEATS.OWNER_MANAGER_ONLY.adviser === 'deny' && matrix.SEATS.OWNER_MANAGER_ONLY.auditor === 'deny');
check('role matrix: manager is allowed only for the manager level of staff', matrix.allowedFor(matrix.SEATS.OWNER_MANAGER_ONLY, 'staff', 'manager') && !matrix.allowedFor(matrix.SEATS.OWNER_MANAGER_ONLY, 'staff', 'editor') && !matrix.allowedFor(matrix.SEATS.OWNER_MANAGER_ONLY, 'staff', 'viewer'));

/* the single door: PUT /actors/assign/:chit_id on a job chit */
const asyncCheck = [];
function stub(answers) {
  const seen = [];
  return {
    seen,
    query: async (sql, params) => {
      seen.push({ sql, params });
      const hit = answers.find((answer) => answer.when.test(sql));
      return hit ? hit.rows : { rows: [] };
    }
  };
}
const jobMarker = (plug) => ({ when: /business_json -> 'job' ->> 'plug' AS plug/, rows: { rows: plug ? [{ plug }] : [] } });
asyncCheck.push(async () => {
  const refuse = (db, req, action, holder) => register.jobRefusalOf(db, req, { entity_id: FIRM, chit_id: 'c1', action, holder_id: holder });
  check('single door: a task chit (no marker) is untouched', (await refuse(stub([jobMarker(null)]), actor('act'), 'push', null)) === null);
  check('PULLFIX: a task chit (no marker) is still pulled by anyone', (await refuse(stub([jobMarker(null)]), actor('act'), 'pull', null)) === null);
  check('single door: pull of a job chit is self only, by any person (A claims a client)', (await refuse(stub([jobMarker('client')]), actor('act'), 'pull', null)) === null);
  /* the marker only from jobs-open (the internal token): never from client input */
  check('PULLFIX: a job marker sent by a person is refused 403 CHIT_NOT_PERMITTED', register.jobMarkerRefusal({ job: { plug: 'client', role: 'adviser' } }, false).code === 'CHIT_NOT_PERMITTED');
  check('PULLFIX: the same marker from the jobs-open token (auto) passes; no marker passes; a null body passes', register.jobMarkerRefusal({ job: { plug: 'client' } }, true) === null && register.jobMarkerRefusal({ page: 'x' }, false) === null && register.jobMarkerRefusal(null, false) === null);
  check('PULLFIX: the send route calls the one check before it builds anything', /jobMarkerRefusal/.test(require('../tools/chits-files.cjs').read(require('path').join(__dirname, '..'))));
  check('single door: push by a plain actor who is not the holder is refused 403 CHIT_NOT_PERMITTED', (await refuse(stub([jobMarker('client')]), actor('act'), 'push', '99999999-9999-4999-8999-999999999999')).code === 'CHIT_NOT_PERMITTED');
  check('single door: the CURRENT holder may hand over (A hands to B with a note)', (await refuse(stub([jobMarker('client')]), actor('act'), 'push', ACTOR)) === null);
  check('single door: return to the pool by a plain non-holder is refused; by a manager or the owner is allowed', (await refuse(stub([jobMarker('client')]), actor('act'), 'return', null)).status === 403 && (await refuse(stub([jobMarker('client')]), actor('manager'), 'return', null)) === null && (await refuse(stub([jobMarker('client')]), asOwner, 'return', null)) === null);
});

/* ── holds() ─────────────────────────────────────────────────────────────────── */
asyncCheck.push(async () => {
  const yes = stub([{ when: /SELECT CASE WHEN/, rows: { rows: [{ ok: true }] } }]);
  const no = stub([{ when: /SELECT CASE WHEN/, rows: { rows: [{ ok: false }] } }]);
  const args = { plug: 'client', entity_id: FIRM, actor_id: ACTOR, subject_id: CLIENT, role: 'adviser' };
  check('holds: true when the statement says so, false when it does not (F1 / F4)', (await register.holds(yes, args)) === true && (await register.holds(no, args)) === false);
  check('holds: ONE statement per call', yes.seen.length === 1);
  const sql = yes.seen[0].sql;
  check('holds: reads copy SENT from the register (F3), a literal, never from the request', /cs\.direction = 'sent'/.test(sql));
  check('holds: LIMIT 1 so a second holder row counts once (F3)', /LIMIT 1/.test(sql));
  check('holds: the role is in the predicate (F5) and the plug is too', /ch\.business_json -> 'job' ->> 'role' = \$4/.test(sql) && /ch\.business_json -> 'job' ->> 'plug' = \$3/.test(sql));
  check('holds: open = the one closed list', sql.includes("NOT IN (" + railActions.CLOSED_SQL + ")"));
  check('holds: the subject is matched in the sealed recipient list, never the sender entry', /jsonb_array_elements\(ch\.all_recipients\)/.test(sql) && /r ->> 'role' IS DISTINCT FROM 'sender'/.test(sql));
  check('holds: every value is a placeholder (parameterised), the member is not in the text', !sql.includes(CLIENT) && !sql.includes(ACTOR) && yes.seen[0].params.join() === [FIRM, ACTOR, 'client', 'adviser', CLIENT].join());
  const caseAt = sql.indexOf('CASE WHEN');
  check('T13: the switch is evaluated BEFORE any chit table (a CASE answers true under all)', caseAt >= 0 && sql.indexOf('entity_actor_settings') > caseAt && sql.indexOf('entity_actor_settings') < sql.indexOf('chit_status'));
  check('switch: absent or `all` reads as off (true), any other word is assigned, a missing row is off', /IS NULL OR \(to_jsonb\(s\) ->> 'client_access'\) = 'all'/.test(sql) && /COALESCE\(\(SELECT/.test(sql));
  let refused = null;
  try { await register.holds(yes, Object.assign({}, args, { plug: 'product_set' })); } catch (e) { refused = e; }
  check('holds: an unbuilt plug is refused by name, not guessed', refused && /not built/.test(refused.message));
  refused = null;
  try { await register.holds(yes, Object.assign({}, args, { plug: 'nope' })); } catch (e) { refused = e; }
  check('holds: an unknown plug is refused', !!refused);
  const among = stub([{ when: /AS everyone/, rows: { rows: [{ everyone: false, held: [CLIENT] }] } }]);
  const list = await register.holdsAmong(among, { plug: 'client', entity_id: FIRM, actor_id: ACTOR, members: [CLIENT, FIRM], role: 'adviser' });
  check('holdsAmong: ONE statement per page, = ANY(members), the held set comes back', among.seen.length === 1 && /= ANY\(\$5::text\[\]\)/.test(among.seen[0].sql) && list.all === false && list.held.has(CLIENT) && !list.held.has(FIRM));
  const off = await register.holdsAmong(stub([{ when: /AS everyone/, rows: { rows: [{ everyone: true, held: [] }] } }]), { plug: 'client', entity_id: FIRM, actor_id: ACTOR, members: [CLIENT] });
  check('holdsAmong: switch off = all, nothing excluded', off.all === true);
});

/* ── finalOutcome: the one outcome ───────────────────────────────────────────── */
asyncCheck.push(async () => {
  const live = { grant_id: 'g1', grantor_entity: CLIENT, grantee_entity: FIRM, preset: 'adviser', revoked_at: null, unexpired: true, edge_live: true };
  const get = { method: 'GET', listed: true, actor: ACTOR };
  const holdsTrue = stub([{ when: /SELECT CASE WHEN/, rows: { rows: [{ ok: true }] } }]);
  const holdsFalse = stub([{ when: /SELECT CASE WHEN/, rows: { rows: [{ ok: false }] } }]);
  check('T13 / W12: switch off (holds true) = allowed for a non-owner, ONE extra statement', (await grants.finalOutcome(holdsTrue, live, get)) === 'allowed' && holdsTrue.seen.length === 1);
  check('the owner costs nothing: no statement at all', (await grants.finalOutcome(holdsFalse, live, Object.assign({ owner: true }, get))) === 'allowed' && holdsFalse.seen.length === 0);
  check('assigned and not the holder: not_assigned', (await grants.finalOutcome(holdsFalse, live, get)) === 'not_assigned');
  check('the member and the role asked are the GRANT row\'s (grantor, grantee, preset), never the request', holdsFalse.seen[0].params[0] === FIRM && holdsFalse.seen[0].params[4] === CLIENT && holdsFalse.seen[0].params[3] === 'adviser');
  for (const [name, row, outcome] of [['revoked', Object.assign({}, live, { revoked_at: new Date() }), 'revoked'], ['expired', Object.assign({}, live, { unexpired: false }), 'expired'], ['edge off', Object.assign({}, live, { edge_live: false }), 'edge_off']]) {
    const db = stub([]);
    check('F9: the grant wins: ' + name + ' keeps its word and costs no holds statement', (await grants.finalOutcome(db, row, get)) === outcome && db.seen.length === 0);
  }
  const none = stub([]);
  check('no grant row: no_grant, nothing asked', (await grants.finalOutcome(none, null, get)) === 'no_grant' && none.seen.length === 0);
  const audit = stub([]);
  check('an auditor write is still read_only first (the verdict is the first test)', (await grants.finalOutcome(audit, Object.assign({}, live, { preset: 'auditor' }), { method: 'POST', listed: true, actor: ACTOR })) === 'read_only' && audit.seen.length === 0);
  const words = grants.answerOf('not_assigned', live);
  check('BOOKS_GRANT_NOT_ASSIGNED: 403 and the sentence, the same for adviser and auditor', words.status === 403 && words.code === 'BOOKS_GRANT_NOT_ASSIGNED' && words.words === 'This client is not assigned to you. Ask the partner to assign it.' && grants.answerOf('not_assigned', Object.assign({}, live, { preset: 'auditor' })).words === words.words);
  /* DECISION 2026-11-17 (coordinator, leader practice: Karbon, Xero Practice Manager): under switch assigned a firm MANAGER sees every client as the owner does; an assistant only the clients held */
  const forManager = stub([{ when: /SELECT CASE WHEN/, rows: { rows: [{ ok: false }] } }]);
  check('manager: skips the held test (no statement), as the owner', (await grants.finalOutcome(forManager, live, Object.assign({ manager: true }, get))) === 'allowed' && forManager.seen.length === 0);
  const amongRows = [live, Object.assign({}, live, { grant_id: 'g2', grantor_entity: '99999999-9999-4999-8999-999999999999' })];
  const none2 = stub([]);
  const viaManager = await grants.liveAmong(none2, amongRows, Object.assign({ manager: true }, get));
  check('manager: liveAmong keeps every live client with no holds statement', viaManager.kept.length === 2 && none2.seen.length === 0);
  const assistant = stub([{ when: /AS everyone/, rows: { rows: [{ everyone: false, held: [CLIENT] }] } }]);
  const viaAssistant = await grants.liveAmong(assistant, amongRows, Object.assign({ manager: false }, get));
  check('assistant (manager false): only the held client is kept', viaAssistant.kept.length === 1 && assistant.seen.length === 1);
  check('isManager: hat manager of a firm actor only (not act, not a key, not acting for a grant)', owner.isManager({ identity: { identity_type: 'actor', parent_entity_id: 'f', hat: 'manager' } }) && !owner.isManager({ identity: { identity_type: 'actor', parent_entity_id: 'f', hat: 'act' } }) && !owner.isManager({ api_key: 'k', identity: { identity_type: 'actor', parent_entity_id: 'f', hat: 'manager' } }) && !owner.isManager({ identity: { identity_type: 'actor', parent_entity_id: 'f', hat: 'manager', acting_for_grant: 'g' } }));
  check('request without an owner flag is NOT the owner (fail closed)', (await grants.finalOutcome(holdsFalse, live, { method: 'GET', listed: true, actor: ACTOR })) === 'not_assigned');
});

/* ── the guard: no door calls verdictOf itself ──────────────────────────────── */
const ROOT = path.join(__dirname, '..');
const scanDirs = ['lib', 'routes', 'middleware', 'src'];
const LIST_READERS = { 'lib/jobs-open.js': 'the opener asks whether a client is LIVE for a role (a batched read of grant rows); it opens no books' };
const offenders = [];
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) { if (name !== 'node_modules') walk(full); continue; }
    if (!/\.(js|cjs)$/.test(name)) continue;
    const rel = path.relative(ROOT, full).split(path.sep).join('/');
    const text = fs.readFileSync(full, 'utf8');
    if (!/\bgrants?\.verdictOf\(|books-grant'\)\.verdictOf\(|\.\.\.\s*require\('\.\/books-grant'\)/.test(text)) continue;
    if (rel === 'lib/books-grant.js' || LIST_READERS[rel]) continue;
    offenders.push(rel);
  }
}
scanDirs.filter((dir) => fs.existsSync(path.join(ROOT, dir))).forEach((dir) => walk(path.join(ROOT, dir)));
check('GUARD: no door calls verdictOf directly; they call finalOutcome (lib/books-grant; the opener, which opens no books, is the one reader excepted by name)', offenders.length === 0, offenders.join(', '));
const grantText = fs.readFileSync(path.join(ROOT, 'lib', 'books-grant.js'), 'utf8');
const directCalls = (grantText.match(/[^.\w]verdictOf\(/g) || []).length;
check('GUARD: inside lib/books-grant.js verdictOf has its definition and five callers only: bankPostingOutcome, finalOutcome, liveAmong, liveInOtherRole and liveRoleOf (00390da05: the role read for the grant seat, a GET that opens no books; 7061ed75d AT-F-05: liveInOtherRole)', directCalls === 6, 'found ' + directCalls);
check('GUARD: look() and the marks write door call finalOutcome', /answerNamed\(transaction, await finalOutcome\(transaction, row, request\), row\)/.test(grantText) && /grants\.finalOutcome\(transaction, row, request\)/.test(fs.readFileSync(path.join(ROOT, 'lib', 'mark-door.js'), 'utf8')));
check('GUARD: both doors say who the caller is (owner flag from the real identity, never a header)', /owner: !req\.api_key && !req\.identity\.parent_entity_id/.test(fs.readFileSync(path.join(ROOT, 'middleware', 'books-grant.js'), 'utf8')) && /owner: !real\.parent_entity_id/.test(fs.readFileSync(path.join(ROOT, 'lib', 'mark-door.js'), 'utf8')));

/* ── the opener ──────────────────────────────────────────────────────────────── */
check('opener: the idempotency key is job:<plug>:<role>:<subject>:<period>', jobsOpen.refOf('client', 'adviser', CLIENT, 'standing') === 'job:client:adviser:' + CLIENT + ':standing');
check('opener: the key fits what the send keeps of a client_ref (80): longest role + the longest period the contract allows (24)', jobsOpen.refOf('client', 'adviser', CLIENT, 'x'.repeat(24)).length <= 80 && require('../tools/chits-files.cjs').read(path.join(__dirname, '..')).split('function refOf(req)')[1].slice(0, 260).includes('slice(0, 80)') && require('../lib/chits-jobs-contract').operationFor('POST /jobs/open').requestBody.content['application/json'].schema.properties.period.maxLength === 24);
check('opener: the six codes are the registered words', Object.values(jobsOpen.SKIP).every(([code]) => /^JOB_/.test(code)) && jobsOpen.SKIP.NOT_YOURS[0] === 'JOB_CLIENT_NOT_YOURS');
check('opener: the client-facing subject line has no "chit"', !/chit/i.test(jobsOpen.subjectLineOf('adviser', 'standing')) && jobsOpen.subjectLineOf('adviser', '2026') === 'Adviser service, 2026');
const known = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'error-codes.json'), 'utf8')).codes.map((row) => row.code));
['JOB_CLIENT_NOT_YOURS', 'JOB_ROLE_NOT_GRANTED', 'JOB_CLIENT_UNREACHABLE', 'JOB_NOT_OPEN', 'ASSIGN_AT_CAPACITY', 'BOOKS_GRANT_NOT_ASSIGNED', 'CHIT_NOT_PERMITTED', 'CHIT_TOO_MANY'].forEach((code) => check('error code registered: ' + code, known.has(code)));

/** a stand-in for the firm's transaction: clients A..: edge + grant by id lists; refs already held */
function openerWorld({ linked, granted, held }) {
  const rowsOfGrants = (ids) => ids.filter((id) => granted.has(id)).map((id) => ({ member: id, preset: 'adviser', revoked_at: null, unexpired: true, edge_live: linked.has(id) }));
  return {
    query: async (sql, params) => {
      if (/FROM books_access_grant g WHERE g.grantee_entity/.test(sql)) return { rows: rowsOfGrants(params[1]) };
      if (/FROM unnest/.test(sql)) return { rows: params[1].filter((id) => linked.has(id)).map((id) => ({ member: id })) };
      if (/business_json ->> 'client_ref' = ANY/.test(sql)) return { rows: params[1].filter((ref) => held.has(ref)).map((ref) => ({ ref, chit_id: held.get(ref) })) };
      return { rows: [] };
    }
  };
}
asyncCheck.push(async () => {
  const ids = Array.from({ length: 150 }, (item, n) => '00000000-0000-4000-8000-' + String(n + 1).padStart(12, '0'));
  const linked = new Set(ids);
  const granted = new Set(ids);
  const held = new Map();
  const world = openerWorld({ linked, granted, held });
  const realAs = grants.asEntity;
  grants.asEntity = async (entity, fn) => fn(world);
  const sent = [];
  const sender = async (firm, body) => {
    sent.push(body);
    const ref = body.client_ref;
    if (held.has(ref)) return { ok: true, body: { chit_id: held.get(ref), duplicate: true } };
    const chit_id = 'c-' + sent.length;
    held.set(ref, chit_id);
    return { ok: true, body: { chit_id } };
  };
  let assignedCalls = 0;
  const autoAssign = async () => { assignedCalls++; return ACTOR; };
  try {
    const first = await jobsOpen.openJobs({ firm: FIRM, plug: 'client', role: 'adviser', period: 'standing', subject_ids: ids, sender, autoAssign });
    check('T15: 150 asked: opened 150, existing 0, assigned 150, skipped none', first.opened === 150 && first.existing === 0 && first.assigned === 150 && first.skipped.length === 0 && first.jobs.length === 150, JSON.stringify(first).slice(0, 200));
    const second = await jobsOpen.openJobs({ firm: FIRM, plug: 'client', role: 'adviser', period: 'standing', subject_ids: ids, sender, autoAssign });
    check('T15: asked again: opened 0, existing 150, no send, no assignment', second.opened === 0 && second.existing === 150 && sent.length === 150 && assignedCalls === 150 && second.jobs.every((job) => job.outcome === 'existing'));
    const body = sent[0];
    check('opener: the send is a general chit to the client, no lines, the job marker and the ref', body.purpose === 'general' && body.line_items.length === 0 && body.recipients[0].entity_id === ids[0] && body.business_json.job.plug === 'client' && body.business_json.job.role === 'adviser' && body.business_json.job.period === 'standing' && body.client_ref === jobsOpen.refOf('client', 'adviser', ids[0], 'standing'));
    check('opener: the body carries no holder, no money, no name', !/assign|amount|total|price|display_name/i.test(JSON.stringify(body)));
    const third = await jobsOpen.openJobs({ firm: FIRM, plug: 'client', role: 'adviser', period: 'FY27', subject_ids: ids.slice(0, 2), sender, autoAssign });
    check('a new period is a NEW job (the closed one is never silently reopened)', third.opened === 2 && third.existing === 0);
    const UNKNOWN = '99999999-9999-4999-8999-999999999999';
    const FOREIGN = '88888888-8888-4888-8888-888888888888';
    const NOGRANT = '77777777-7777-4777-8777-777777777777';
    linked.add(NOGRANT);
    const mixed = await jobsOpen.openJobs({ firm: FIRM, plug: 'client', role: 'adviser', period: 'standing', subject_ids: [ids[0], UNKNOWN, FOREIGN, NOGRANT], sender, autoAssign });
    const unknownSkip = mixed.skipped.find((item) => item.subject_id === UNKNOWN);
    const foreignSkip = mixed.skipped.find((item) => item.subject_id === FOREIGN);
    check('S35: an unknown id and another shop\'s id get THE SAME code and sentence', unknownSkip && foreignSkip && unknownSkip.code === 'JOB_CLIENT_NOT_YOURS' && unknownSkip.code === foreignSkip.code && unknownSkip.reason === foreignSkip.reason);
    check('a linked client with no live grant of the role: JOB_ROLE_NOT_GRANTED', mixed.skipped.find((item) => item.subject_id === NOGRANT).code === 'JOB_ROLE_NOT_GRANTED');
    check('opened + existing + skipped = subjects asked (4)', mixed.opened + mixed.existing + mixed.skipped.length === 4 && mixed.existing === 1);
    const lost = await jobsOpen.openJobs({ firm: FIRM, plug: 'client', role: 'adviser', period: 'down', subject_ids: [ids[5]], sender: async () => ({ ok: false, status: 404, body: null }), autoAssign });
    check('a client that cannot be reached: JOB_CLIENT_UNREACHABLE, one sentence, no cause', lost.skipped.length === 1 && lost.skipped[0].code === 'JOB_CLIENT_UNREACHABLE' && lost.opened === 0);
    const fails = await jobsOpen.openJobs({ firm: FIRM, plug: 'client', role: 'adviser', period: 'noassign', subject_ids: [ids[6]], sender, autoAssign: async () => { throw new Error('boom'); } });
    check('the auto door failing never fails the job: opened 1, assigned 0, it stays Unassigned', fails.opened === 1 && fails.assigned === 0);
    let tooMany = null;
    try { await jobsOpen.openJobs({ firm: FIRM, plug: 'client', role: 'adviser', period: 'x', subject_ids: Array.from({ length: 201 }, (item, n) => '00000000-0000-4000-8000-9' + String(n).padStart(11, '0')), sender, autoAssign }); } catch (e) { tooMany = e; }
    check('201 subjects: 400 CHIT_TOO_MANY before any send', tooMany && tooMany.status === 400 && tooMany.code === 'CHIT_TOO_MANY');
  } finally {
    grants.asEntity = realAs;
  }
});

/* ── the contract and the doors' text ───────────────────────────────────────── */
const contract = require('../lib/chits-jobs-contract');
const operation = contract.operationFor('POST /jobs/open');
const bodySchema = operation.requestBody.content['application/json'].schema;
check('contract: strict body, three required, oneOf subject_ids / filter, bounded arrays', bodySchema.additionalProperties === false && bodySchema.required.join() === 'plug,role,period' && bodySchema.oneOf.length === 2 && bodySchema.properties.subject_ids.maxItems === undefined /* the 200 cap is the opener's CHIT_TOO_MANY (400), as assign-bulk's, never a schema 422 */ && bodySchema.properties.filter.additionalProperties === false);
check('contract: the seats are the partner or a manager, adviser and auditor refused, and the statuses are declared', operation['x-seats'] === matrix.SEATS.OWNER_MANAGER_ONLY && ['200', '400', '401', '403', '422', '500'].every((status) => status in operation.responses));
check('contract: the answer is a closed allowlist with no holder key', operation.responses['200'].content['application/json'].schema.additionalProperties === false && !/holder|assigned_to|actor/.test(Object.keys(operation.responses['200'].content['application/json'].schema.properties).join()));
const chitsContract = require('../lib/chits-contract');
const bulk = chitsContract.operationFor('POST /assign-bulk');
const bulkSchema = bulk.requestBody.content['application/json'].schema;
check('assign-bulk: chit_ids XOR { plug, role, subject_ids }, target null = the pool, an optional note, 403 declared', bulkSchema.required.join() === 'target_actor_id' && bulkSchema.oneOf.length === 2 && bulkSchema.properties.target_actor_id.type.includes('null') && bulkSchema.properties.note.maxLength === 200 && '403' in bulk.responses);

/* A1 + A2 (18 Nov): the switch's word, the server verdict, and holders read whatever the switch says */
check('A1 clientAccessOf: absent, null and all read all; assigned and any garbage word read assigned (fail closed, as clientAccessSql)', ['all', null, undefined].every((w) => register.clientAccessOf(w) === 'all') && ['assigned', 'x', ''].every((w) => register.clientAccessOf(w) === 'assigned'));
const asReq = (identity, extra) => ({ identity: Object.assign({ identity_type: 'actor', parent_entity_id: 'P' }, identity), ...(extra || {}) });
const ownerReq = { identity: { identity_type: 'entity', identity_id: 'P' } };
check('A2 verdictOf: the partner may_assign, may_take false (holds nothing)', JSON.stringify(register.verdictOf(ownerReq)) === '{"may_assign":true,"may_take":false}');
check('A2 verdictOf: a manager hat may_assign and may_take', JSON.stringify(register.verdictOf(asReq({ hat: 'manager' }))) === '{"may_assign":true,"may_take":true}');
check('A2 verdictOf: staff (act) neither: taking from the pool stays OFF', JSON.stringify(register.verdictOf(asReq({ hat: 'act' }))) === '{"may_assign":false,"may_take":false}');
check('A2 verdictOf: an api key and a grant-synthetic manager neither', !register.verdictOf(asReq({ hat: 'manager' }, { api_key: 'k' })).may_assign && !register.verdictOf(asReq({ hat: 'manager', acting_for_grant: true })).may_assign);
asyncCheck.push(async () => {
  let sql = '';
  await register.holdersAmong({ query: async (text) => { sql = text; return { rows: [{ everyone: true, holders: [{ subject: 's1', actor_id: 'a1', name: 'Anna' }] }] }; } }, { plug: 'client', entity_id: 'P', members: ['s1'], role: 'adviser' }).then((got) => {
    check('A1 holdersAmong: the holder read is not behind the switch (no CASE on clientAccessSql around it), and a holder comes back when the switch says all', !/CASE WHEN[^)]*client_access[sS]*'[]'::jsonb/.test(sql) && got.all === true && got.holders.get('s1')[0].name === 'Anna');
  });
});

/* H-mx-002 / H-mx-005 (matrix r5, 20 Nov) */
const assignBulk = require('../lib/assign-bulk');
const heldBy = (rows) => ({ query: async (sql) => (/staff_pick_up/.test(sql) ? { rows: [{ v: 'on' }] } : { rows }) });
asyncCheck.push(async () => {
  const mgr = asReq({ hat: 'manager', identity_id: 'M1', access_level: 'editor' });
  const act = asReq({ hat: 'act', identity_id: 'S1', access_level: 'editor' });
  const body = { target_actor_id: 'T', chit_ids: ['c1'] };
  check('H-mx-002 a manager seat is not staff: hand-over of held work is not gated', assignBulk.staffMayTry(mgr, body) === false);
  check('H-mx-002 a non-manager seat is still staff', assignBulk.staffMayTry(act, body) === true);
  let code = null;
  await assignBulk.staffGateIn(heldBy([{ assigned_to_actor_id: 'OTHER' }]), act, 'P', body, ['c1']).catch((e) => { code = e.code; });
  check('H-mx-002 staff meeting a row held by someone else is refused ASSIGN_HELD_BY_OTHER', code === 'ASSIGN_HELD_BY_OTHER');
});
asyncCheck.push(async () => {
  /* R9 / sweep: the loser of a race names the holder from the ONE read of names namedSkips already makes (no second read of identities); held_by never leaves */
  const reads = [];
  const client = { query: async (sql, params) => { reads.push(String(sql)); return { rows: [{ id: 'H1', display_name: 'Asha' }, { id: 'C1', display_name: 'Bondi Grocer' }] }; } };
  const held = assignBulk.heldSkip({ chit_id: 'k1' }, 'H1', { subject_id: 'C1' });
  const out = await assignBulk.namedSkips(client, [held]);
  check('a lost race: one read of names, the reason names the holder, the client keeps its name, held_by is dropped', reads.length === 1 && out.length === 1 && out[0].reason === 'already held by Asha' && out[0].name === 'Bondi Grocer' && out[0].code === 'ASSIGN_HELD_BY_OTHER' && !('held_by' in out[0]) && Object.keys(out[0]).join() === 'chit_id,reason,code,subject_id,name', JSON.stringify(out));
  const unknown = await assignBulk.namedSkips({ query: async () => ({ rows: [] }) }, [assignBulk.heldSkip({ chit_id: 'k2' }, 'H9', {})]);
  check('a holder with no name row keeps the plain sentence', unknown[0].reason === 'someone else already holds it' && !('held_by' in unknown[0]), JSON.stringify(unknown));
});
const seatOf = (hat, access_level) => asReq({ hat, access_level, identity_id: 'X' });
check('H-mx-005 reviewer (commenter) and reports (commenter) seats: may_take false even with the switch ON', ['reviewer', 'reports'].every((hat) => register.verdictOf(seatOf(hat === 'reviewer' ? 'audit' : 'mis', 'commenter'), { pickUp: true }).may_take === false));
check('H-mx-005 an accountant (editor, hat act) seat: may_take true with the switch ON', register.verdictOf(seatOf('act', 'editor'), { pickUp: true }).may_take === true);

(async () => {
  for (const run of asyncCheck) await run();
  console.log('assign-register: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  FAIL threw ' + e.stack); process.exit(1); });
