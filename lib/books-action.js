'use strict';
/**
 * lib/books-action.js — MAKER-CHECKER FOR AN ADVISER FIRM ACTING IN A STORE'S BOOKS (ACC-176b): a firm's team member PREPARES, a DIFFERENT person of the firm REVIEWS, the store's OWNER ACCEPTS, and only then does the existing writer post.
 * OWNS      the five steps of an action (books_action_step, migration b866, insert-only: the status of an action is its LATEST step) · prepare · review · return · accept · withdrawOpen (a revoked grant) · list · get.
 * CALLED BY routes/books-actions.js (the doors) · lib/books-grant.js revoke() (withdrawOpen, in the revoke's own transaction).
 * FLOW      prepare: the body is read ONCE into the event the owner's own door would build (eventOf) → the server's own preview (B.previewEntry: nothing stored) gives the total and currency the preparer saw → one `prepared` step.
 *           review: a different person, the same body_hash. accept (the owner): in ONE transaction → the stored, the carried and the engine's totals are compared → the EXISTING writer posts (B.postEntry / reverseEntry / setPeriod /
 *           closeYear, source_ref action:<id>) → the engine's total is READ from the entry it wrote and compared (never a second preview, never a second formula) → the `accepted` step; any difference rolls everything back.
 * CARD      04-network/ACC-176B-ADVISER-REQUIREMENT
 * ⚠️ ONE POSTING PATH: nothing here posts a line of its own. ⚠️ A step is stamped with the real person, the firm, the role and the time; nothing is updated, a return ends the round and a new action is prepared.
 * ⚠️ Not migrated (b866 not run) is a typed refusal in words (BOOKS_ACTION_NOT_SWITCHED_ON, 503), never a 500 and never a write.
 */
const crypto = require('crypto');
const { withEntity } = require('../db');
const schema = require('./schema');
const canon = require('./canon');
const reqctx = require('./reqctx');
const money = require('./money');

const KINDS = ['journal', 'reverse', 'lock', 'unlock', 'year_close'];
const NOT_ON = 'BOOKS_ACTION_NOT_SWITCHED_ON';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TERMINAL = ['returned', 'accepted', 'withdrawn'];
const STATE_OF_LAST = { prepared: 'waiting_review', reviewed: 'waiting_accept', returned: 'returned', accepted: 'accepted', withdrawn: 'withdrawn' };
const LAST_OF_STATE = { waiting_review: ['prepared'], waiting_accept: ['reviewed'], open: ['prepared', 'reviewed'], returned: ['returned'], accepted: ['accepted'], withdrawn: ['withdrawn'] };
const MAX_PAGE = 100;

/** a typed refusal the route turns into a Problem: { code, status, words } */
const refusal = (code, status, words) => Object.assign(new Error(words), { code, status, words });
const ledger = () => require('./books');
const sameId = (left, right) => String(left) === String(right);

/** is the table there (b866 run): the api is correct before and after the file runs */
async function ready() {
  if (!(await schema.hasTable('books_action_step'))) throw refusal(NOT_ON, 503, 'Adviser actions are not switched on yet.');
}
/** a missing table or column met mid-way is the same typed refusal */
const wrapMissing = (err) => (err && (err.code === '42P01' || err.code === '42703') ? refusal(NOT_ON, 503, 'Adviser actions are not switched on yet.') : err);
const asStore = async (store, fn) => {
  try {
    return await withEntity(store, fn);
  } catch (err) {
    throw wrapMissing(err);
  }
};

/* ── the body: read once, whitelisted per kind ─────────────────────────────────────────────────────────── */
const FISCAL_YEAR = /^\d{4}(-\d{2})?$/;
const text = (value, max) => (value == null ? null : String(value).trim().slice(0, max));
/** a journal's body: no party and no bill (an adviser never reaches party data), at least two lines */
function journalBodyOf(body) {
  if (body.against_ref || (Array.isArray(body.lines) && body.lines.some((line) => line && (line.party || line.party_id)))) throw refusal('ACTION_PARTY_NOT_IN_V1', 422, 'An adviser journal cannot name a customer, a supplier or a bill. The owner enters those.');
  if (!Array.isArray(body.lines) || body.lines.length < 2) throw refusal('ACTION_BODY_INVALID', 422, 'A journal needs at least two lines.');
  return { narration: text(body.narration, 300), date: text(body.date, 10), lines: body.lines, ref: text(body.ref, 80), currency: body.currency ? String(body.currency).toUpperCase() : null };
}
/** a reversal's body: the entry (a uuid) and the reason */
function reverseBodyOf(body) {
  if (!UUID.test(String(body.entry_id || ''))) throw refusal('ACTION_BODY_INVALID', 422, 'Name the entry to reverse.');
  if (!text(body.reason, 300)) throw refusal('ACTION_BODY_INVALID', 422, 'A reversal needs a reason.');
  return { entry_id: String(body.entry_id).toLowerCase(), reason: text(body.reason, 300) };
}
/** a lock's or unlock's body: the year and the month (opening a locked month needs a reason) */
function periodBodyOf(body, kind) {
  if (!FISCAL_YEAR.test(String(body.fy || '')) || !/^d{1,2}$/.test(String(body.period || ''))) throw refusal('ACTION_BODY_INVALID', 422, 'Name the year and the month.');
  if (kind === 'unlock' && !text(body.reason, 300)) throw refusal('ACTION_BODY_INVALID', 422, 'Opening a locked month needs a reason.');
  return { fy: String(body.fy), period: Number(body.period), reason: text(body.reason, 300) };
}
/** a year close's body: the year */
function yearBodyOf(body) {
  if (!FISCAL_YEAR.test(String(body.fy || ''))) throw refusal('ACTION_BODY_INVALID', 422, 'Name the year to close.');
  return { fy: String(body.fy) };
}
/** the whitelisted body of an action: each kind's own reader, anything else dropped (never carried into the books) */
function bodyOf(kind, given) {
  const body = given && typeof given === 'object' ? given : {};
  if (kind === 'journal') return journalBodyOf(body);
  if (kind === 'reverse') return reverseBodyOf(body);
  if (kind === 'lock' || kind === 'unlock') return periodBodyOf(body, kind);
  return yearBodyOf(body);
}
const hashOf = (store, kind, body) => canon.hash(JSON.parse(JSON.stringify({ store: String(store), kind, body })));

/** an amount carries its currency and a post in another one is refused (the ledger's money, never converted) */
function sameLedgerCurrency(given, kept) {
  try {
    money.assertSameCurrency({ amount: 1, currency: given }, { amount: 1, currency: kept }, 'this journal');
  } catch (err) {
    throw refusal('CURRENCY_NOT_THE_LEDGERS', 422, 'This journal is in ' + given + ' but these books are kept in ' + kept + '. An amount is never converted.');
  }
}
/** the event the owner's own door (POST /entries) builds from the same words: the ONE reader of a typed journal's lines (books-manual.givenLines), the ledger's currency, a typed date that must be open (strict_date) */
function journalEvent(books, body, extra) {
  const ledgerCurrency = ledger().curOf(books);
  if (body.currency) sameLedgerCurrency(body.currency, ledgerCurrency);
  const lines = require('./books-manual').givenLines(body.lines, ledgerCurrency);
  return Object.assign({ type: 'manual', owner: true, narration: body.narration, date: require('./books-period').dateGiven(body.date, null, require('./shop-clock').today(books)), currency: ledgerCurrency, strict_date: true, lines, ref: body.ref }, extra);
}

/* ── reading steps ─────────────────────────────────────────────────────────────────────────────────────── */
const STEP_COLUMNS = 'step_id, action_id, store, step, kind, body, body_hash, total_minor, currency, action_ref, actor_identity_id, actor_name, firm_name, role, reason, grant_id, entry_id, at';
async function stepsOf(handle, store, actionId) {
  if (!UUID.test(String(actionId))) throw refusal('NOT_FOUND', 404, 'There is no such action.');
  const found = await handle.query(`SELECT ${STEP_COLUMNS} FROM books_action_step WHERE store = $1 AND action_id = $2 ORDER BY step_id`, [store, actionId]);
  if (!found.rows.length) throw refusal('NOT_FOUND', 404, 'There is no such action.');
  return found.rows;
}
const lockAction = (handle, key) => handle.query('SELECT pg_advisory_xact_lock(hashtext($1))', [String(key)]);
const stepNamed = (steps, name) => steps.find((row) => row.step === name) || null;
const lastOf = (steps) => steps[steps.length - 1];
/** the shape the web reads: the action as its steps say it is now */
function viewOf(steps, grantLive) {
  const first = steps[0];
  const last = lastOf(steps);
  const stamp = (row) => (row ? { identity_id: row.actor_identity_id, name: row.actor_name, firm: row.firm_name, role: row.role, at: row.at, reason: row.reason } : null);
  const open = !TERMINAL.includes(last.step);
  return {
    action_id: first.action_id, store: first.store, kind: first.kind, state: STATE_OF_LAST[last.step], client_ref: first.action_ref, body_hash: first.body_hash,
    total_minor: first.total_minor == null ? null : Number(first.total_minor), currency: first.currency, body: first.body,
    prepared: stamp(first), reviewed: stamp(stepNamed(steps, 'reviewed')), closed: open ? null : stamp(last), grant_id: first.grant_id, entry_id: (stepNamed(steps, 'accepted') || {}).entry_id || null,
    access_ended: open && grantLive === false
  };
}
/** is the grant an action was prepared under live right now (not revoked, not expired): the database clock decides */
async function grantLiveOf(handle, store, grantId) {
  const found = await handle.query('SELECT (revoked_at IS NULL AND expires_at > now()) AS live FROM books_access_grant WHERE grant_id = $1 AND grantor_entity = $2', [grantId, store]);
  return !!(found.rows[0] && found.rows[0].live === true);
}

/** insert one step; the table's unique index refuses a step that already happened (a second review, a second accept) */
async function addStep(handle, row) {
  const columns = ['action_id', 'store', 'step', 'kind', 'body', 'body_hash', 'total_minor', 'currency', 'action_ref', 'actor_identity_id', 'actor_name', 'firm_name', 'role', 'reason', 'grant_id', 'entry_id'];
  const values = columns.map((name) => (row[name] === undefined ? null : row[name]));
  try {
    await handle.query(`INSERT INTO books_action_step (${columns.join(', ')}) VALUES (${columns.map((_, position) => '$' + (position + 1)).join(', ')})`, values);
  } catch (err) {
    if (err.code === '23505') throw refusal('ACTION_CLOSED', 409, 'This action has already moved on. Open the queue again.');
    if (err.code === '42501' || err.code === '23514') throw refusal('ACTION_NOT_ALLOWED', 403, 'This access has ended, so nothing was recorded.');
    throw err;
  }
}
const stampOf = (actor) => ({ actor_identity_id: actor.identity_id, actor_name: actor.name ? String(actor.name).slice(0, 200) : null, firm_name: actor.firm_name || null, grant_id: actor.grant_id || null });

/* ── prepare ───────────────────────────────────────────────────────────────────────────────────────────── */
/** the total and currency the preparer saw: the server's own preview of the same event (nothing is stored by it) */
async function previewOf(handle, store, books, kind, body) {
  if (kind !== 'journal') return { total_minor: null, currency: null, warnings: [] };
  const seen = await ledger().previewEntry(handle, store, journalEvent(books, body, {}));
  if (!seen || !seen.ok) throw refusal('LEDGER_OFF', 404, 'This shop has not switched the ledger on.');
  return { total_minor: Number(seen.posted.totals.dr_minor), currency: seen.posted.currency, warnings: [] };
}
/** a second prepare on a client_ref is refused while one is open, and when the ref already holds an entry (the same line sent twice) */
async function refuseRepeatedRef(handle, store, ref) {
  if (!ref) return;
  await lockAction(handle, store + '|' + ref);
  const open = await handle.query(`SELECT p.action_id FROM books_action_step p WHERE p.store = $1 AND p.action_ref = $2 AND p.step = 'prepared'
      AND NOT EXISTS (SELECT 1 FROM books_action_step t WHERE t.action_id = p.action_id AND t.step = ANY($3::text[])) LIMIT 1`, [store, ref, TERMINAL]);
  if (open.rows.length) throw refusal('ACTION_REF_OPEN', 409, 'An action with this reference is already waiting. Open it from the queue.');
  const posted = await handle.query(`SELECT entry_no FROM journal_entry WHERE entity_id = $1 AND (source_ref = $2 OR source_ref IN (SELECT 'action:' || action_id::text FROM books_action_step WHERE store = $1 AND action_ref = $3 AND step = 'accepted')) LIMIT 1`, [store, 'manual:' + ref, ref]);
  if (posted.rows.length) throw refusal('ACTION_REF_POSTED', 409, 'This reference already holds entry ' + posted.rows[0].entry_no + '. It is not prepared again.');
}
/**
 * prepareAction(store, actor, { kind, body, client_ref, working_month }, books) → the action view (+ warnings). actor = { identity_id, name, firm_name, grant_id }; books = the store's setting (the route's `on` gate).
 * A date outside the month the page is working on is an ADVISORY warning (a client wish), never a refusal; the guard is the accept's strict-date posting.
 */
async function prepareAction(store, actor, input, books) {
  await ready();
  if (!KINDS.includes(input.kind)) throw refusal('ACTION_KIND_INVALID', 422, 'Say what is to be done: a journal, a reversal, a lock, an unlock or a year close.');
  const body = bodyOf(input.kind, input.body);
  const ref = input.client_ref ? String(input.client_ref).slice(0, 80) : null;
  const actionId = crypto.randomUUID();
  return asStore(store, async (handle) => {
    await refuseRepeatedRef(handle, store, ref);
    const seen = await previewOf(handle, store, books, input.kind, body);
    if (input.kind === 'reverse') {
      const there = await handle.query('SELECT 1 FROM journal_entry WHERE entity_id = $1 AND entry_id = $2', [store, body.entry_id]);
      if (!there.rows.length) throw refusal('NOT_FOUND', 404, 'Not found'); /* an id of another store is invisible by row security: the same 404 */
    }
    await addStep(handle, Object.assign({ action_id: actionId, store, step: 'prepared', kind: input.kind, body, body_hash: hashOf(store, input.kind, body), total_minor: seen.total_minor, currency: seen.currency, action_ref: ref, role: 'maker' }, stampOf(actor)));
    const view = viewOf(await stepsOf(handle, store, actionId), true);
    const month = input.working_month && /^\d{4}-\d{2}$/.test(String(input.working_month)) ? String(input.working_month) : null;
    const date = input.kind === 'journal' ? (body.date || null) : null;
    view.warnings = month && date && date.slice(0, 7) !== month ? [{ code: 'OUTSIDE_MONTH_BEING_WORKED', words: 'This entry is dated ' + date + ', outside ' + month + ', the month you are working in.' }] : [];
    return view;
  });
}

/* ── review and return ─────────────────────────────────────────────────────────────────────────────────── */
/** the action as it must be for a step: open, bound to the hash the person saw */
function openFor(steps, seenHash) {
  const last = lastOf(steps);
  if (TERMINAL.includes(last.step)) throw refusal('ACTION_CLOSED', 409, 'This action is already ' + STATE_OF_LAST[last.step] + '.');
  if (seenHash !== steps[0].body_hash) throw refusal('ACTION_BODY_CHANGED', 409, 'This is not the entry you were shown. Open it again.');
  return last;
}
/** reviewAction(store, actor, actionId, { body_hash }) → the action view: a DIFFERENT person of the firm than the preparer, on an action still waiting for review */
async function reviewAction(store, actor, actionId, input) {
  await ready();
  return asStore(store, async (handle) => {
    await lockAction(handle, actionId);
    const steps = await stepsOf(handle, store, actionId);
    const last = openFor(steps, input.body_hash);
    if (last.step !== 'prepared') throw refusal('ACTION_CLOSED', 409, 'This action has already been reviewed.');
    if (sameId(steps[0].actor_identity_id, actor.identity_id)) throw refusal('ACTION_SELF_REVIEW', 403, 'You prepared this, so a colleague has to review it.');
    const first = steps[0];
    await addStep(handle, Object.assign({ action_id: first.action_id, store, step: 'reviewed', kind: first.kind, body_hash: first.body_hash, total_minor: first.total_minor, currency: first.currency, action_ref: first.action_ref, role: 'checker' }, stampOf(actor)));
    return viewOf(await stepsOf(handle, store, actionId), await grantLiveOf(handle, store, first.grant_id));
  });
}
const reasonOf = (given) => {
  const words = given == null ? '' : String(given).trim();
  if (words.length < 3 || words.length > 300) throw refusal('ACTION_REASON_NEEDED', 422, 'Say why in 3 to 300 characters.');
  return words;
};
/**
 * returnAction(store, actor, actionId, { body_hash, reason }, byOwner) → the action view: the round ends with the reason; the entry is never edited, a new one is prepared.
 * A firm person returns what a colleague prepared (never their own); the owner returns any open action, including one whose access has ended.
 */
async function returnAction(store, actor, actionId, input, byOwner) {
  await ready();
  const reason = reasonOf(input.reason);
  return asStore(store, async (handle) => {
    await lockAction(handle, actionId);
    const steps = await stepsOf(handle, store, actionId);
    openFor(steps, input.body_hash);
    if (!byOwner && sameId(steps[0].actor_identity_id, actor.identity_id)) throw refusal('ACTION_SELF_REVIEW', 403, 'You prepared this, so a colleague has to return it.');
    const first = steps[0];
    await addStep(handle, Object.assign({ action_id: first.action_id, store, step: 'returned', kind: first.kind, body_hash: first.body_hash, total_minor: first.total_minor, currency: first.currency, action_ref: first.action_ref, role: byOwner ? 'owner' : 'checker', reason }, stampOf(byOwner ? Object.assign({}, actor, { grant_id: null, firm_name: null }) : actor)));
    return viewOf(await stepsOf(handle, store, actionId), await grantLiveOf(handle, store, first.grant_id));
  });
}

/* ── accept (the owner) ────────────────────────────────────────────────────────────────────────────────── */
/** a total as words: its currency and its figure in major units */
const shown = (pair) => pair.currency + ' ' + (Number(pair.total_minor) / Math.pow(10, money.decimals(pair.currency))).toFixed(money.decimals(pair.currency));
/** the totals must agree: the pair stored at prepare, the pair the owner's confirm carried (the screen's popup), the pair the engine produced; a difference names both numbers */
function sameTotals(left, right, where) {
  if (Number(left.total_minor) === Number(right.total_minor) && String(left.currency) === String(right.currency)) return;
  throw refusal('PREVIEW_TOTAL_DIFFERS', 409, 'The total changed since it was prepared (' + shown(left) + ' then ' + shown(right) + ', ' + where + '). Nothing was posted. Open it again.');
}
/** the existing writer for the action, in the accept's own transaction; returns { entry_id, entry_no } (null for a lock, unlock or year close) */
async function postWith(handle, store, first, actionId, books) {
  const by = first.actor_identity_id;
  const body = first.body;
  if (first.kind === 'journal') {
    const out = await ledger().postEntry(handle, store, journalEvent(books, body, { by, source_ref: 'action:' + actionId }));
    if (!out || out.off) throw refusal('LEDGER_OFF', 404, 'This shop has not switched the ledger on.');
    if (out.duplicate) throw refusal('ACTION_DUPLICATE', 409, 'This was already posted as ' + (out.entry_no || 'an entry') + '. Nothing was posted again.');
    return { entry_id: out.entry_id, entry_no: out.entry_no };
  }
  if (first.kind === 'reverse') {
    const out = await ledger().reverseEntry(handle, store, body.entry_id, { by, reason: body.reason });
    if (out.duplicate) throw refusal('ACTION_DUPLICATE', 409, 'This entry was already reversed by ' + out.entry_no + '. Nothing was posted again.');
    return { entry_id: out.entry_id, entry_no: out.entry_no };
  }
  if (first.kind === 'year_close') {
    const out = await ledger().closeYear(handle, store, body.fy, by);
    if (!out.ok) throw refusal('YEAR_CLOSE_REFUSED', 422, (out.refusals || []).map((x) => x.why).join(' ') || 'The year cannot be closed yet.');
    if (out.duplicate) throw refusal('ACTION_DUPLICATE', 409, 'This year is already closed.');
    return { entry_id: null, entry_no: null };
  }
  await ledger().setPeriod(handle, store, body.fy, body.period, first.kind === 'unlock' ? 'open' : 'soft_locked', by, body.reason);
  return { entry_id: null, entry_no: null };
}
/** the total the engine wrote, READ from the entry it posted (nothing is computed again) */
async function writtenTotal(handle, store, entryId) {
  const found = await handle.query('SELECT total_minor, currency FROM journal_entry WHERE entity_id = $1 AND entry_id = $2', [store, entryId]);
  if (!found.rows[0]) throw refusal('NOT_FOUND', 404, 'Not found');
  return { total_minor: Number(found.rows[0].total_minor), currency: found.rows[0].currency };
}
/**
 * acceptAction(store, owner, actionId, { body_hash, total_minor, currency }) → { action, entry } · only an action that was REVIEWED, whose access is still live, whose body is the one shown; the stored, the carried and the
 * written totals must agree or the transaction rolls back (PREVIEW_TOTAL_DIFFERS). The posted entry carries grant_id (the stamp) and created_by = the preparer; the `accepted` step carries the owner.
 */
async function acceptAction(store, owner, actionId, input) {
  await ready();
  return asStore(store, async (handle) => {
    await lockAction(handle, actionId);
    const steps = await stepsOf(handle, store, actionId);
    const last = openFor(steps, input.body_hash);
    if (last.step !== 'reviewed') throw refusal('ACTION_NOT_REVIEWED', 409, 'A colleague has to review this before you accept it.');
    const first = steps[0];
    if (!(await grantLiveOf(handle, store, first.grant_id))) throw refusal('ACTION_ACCESS_ENDED', 409, 'The access this was prepared under has ended. You can return it.');
    const stored = { total_minor: first.total_minor, currency: first.currency };
    if (first.kind === 'journal') sameTotals(stored, { total_minor: input.total_minor, currency: input.currency }, 'what you confirmed');
    const books = await ledger().settingOf(handle, store);
    if (!books || !books.enabled) throw refusal('LEDGER_OFF', 404, 'This shop has not switched the ledger on.');
    const posted = await reqctx.runActingFor(first.grant_id, () => postWith(handle, store, first, actionId, books));
    if (first.kind === 'journal') sameTotals(stored, await writtenTotal(handle, store, posted.entry_id), 'what the books wrote');
    await addStep(handle, Object.assign({ action_id: first.action_id, store, step: 'accepted', kind: first.kind, body_hash: first.body_hash, total_minor: first.total_minor, currency: first.currency, action_ref: first.action_ref, role: 'owner', entry_id: posted.entry_id },
      stampOf(Object.assign({}, owner, { grant_id: first.grant_id, firm_name: null }))));
    return { action: viewOf(await stepsOf(handle, store, actionId), true), entry: posted };
  });
}

/* ── a revoked grant closes what it left open ─────────────────────────────────────────────────────────── */
/** withdrawOpen(handle, store, grantId, by) → how many open actions were closed "withdrawn: grant revoked" (run inside the revoke's own transaction; 0 and silent while b866 has not run) */
async function withdrawOpen(handle, store, grantId, by) {
  if (!(await schema.hasTable('books_action_step'))) return 0;
  const open = await handle.query(`SELECT p.action_id, p.kind, p.body_hash, p.total_minor, p.currency, p.action_ref FROM books_action_step p WHERE p.store = $1 AND p.grant_id = $2 AND p.step = 'prepared'
      AND NOT EXISTS (SELECT 1 FROM books_action_step t WHERE t.action_id = p.action_id AND t.step = ANY($3::text[]))`, [store, grantId, TERMINAL]);
  for (const row of open.rows) {
    await addStep(handle, { action_id: row.action_id, store, step: 'withdrawn', kind: row.kind, body_hash: row.body_hash, total_minor: row.total_minor, currency: row.currency, action_ref: row.action_ref, actor_identity_id: by, role: 'owner', reason: 'withdrawn: grant revoked' });
  }
  return open.rows.length;
}

/* ── the queue ─────────────────────────────────────────────────────────────────────────────────────────── */
/**
 * listActions(store, { state, mine, actor, page, limit }) → { actions, total, page, limit } newest first. state: waiting_review · waiting_accept · open · returned · accepted · withdrawn · all (default open);
 * `mine` keeps what this person prepared; the firm's own people see their own, a reviewer asks waiting_review and the web hides the ones they prepared.
 */
async function listActions(store, query, actor) {
  await ready();
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 25, 1), MAX_PAGE);
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const state = query.state && query.state !== 'all' ? LAST_OF_STATE[query.state] || LAST_OF_STATE.open : query.state === 'all' ? null : LAST_OF_STATE.open;
  const mine = query.mine === 'true' || query.mine === true ? actor.identity_id : null;
  return asStore(store, async (handle) => {
    const base = `FROM books_action_step p WHERE p.store = $1 AND p.step = 'prepared' AND ($3::uuid IS NULL OR p.actor_identity_id = $3)
      AND ($2::text[] IS NULL OR (SELECT t.step FROM books_action_step t WHERE t.action_id = p.action_id ORDER BY t.step_id DESC LIMIT 1) = ANY($2::text[]))`;
    const total = (await handle.query(`SELECT count(*)::int AS n ${base}`, [store, state, mine])).rows[0].n;
    const heads = (await handle.query(`SELECT p.action_id ${base} ORDER BY p.at DESC, p.step_id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`, [store, state, mine])).rows.map((row) => row.action_id);
    const rows = heads.length ? (await handle.query(`SELECT ${STEP_COLUMNS} FROM books_action_step WHERE store = $1 AND action_id = ANY($2::uuid[]) ORDER BY step_id`, [store, heads])).rows : [];
    const live = new Map();
    const actions = [];
    for (const id of heads) {
      const steps = rows.filter((row) => sameId(row.action_id, id));
      const grantId = steps[0].grant_id;
      if (!live.has(String(grantId))) live.set(String(grantId), await grantLiveOf(handle, store, grantId));
      actions.push(viewOf(steps, live.get(String(grantId))));
    }
    return { actions, total, page, limit };
  });
}
/** getAction(store, actionId) → one action with every step in order */
async function getAction(store, actionId) {
  await ready();
  return asStore(store, async (handle) => {
    const steps = await stepsOf(handle, store, actionId);
    return Object.assign(viewOf(steps, await grantLiveOf(handle, store, steps[0].grant_id)), { steps: steps.map((row) => ({ step: row.step, role: row.role, identity_id: row.actor_identity_id, name: row.actor_name, firm: row.firm_name, reason: row.reason, at: row.at })) });
  });
}

module.exports = { KINDS, NOT_ON, bodyOf, hashOf, refusal, prepareAction, reviewAction, returnAction, acceptAction, withdrawOpen, listActions, getAction };
