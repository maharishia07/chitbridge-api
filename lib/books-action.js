'use strict';
/**
 * lib/books-action.js — MAKER-CHECKER FOR AN ADVISER FIRM ACTING IN A STORE'S BOOKS (ACC-176b): a firm's team member PREPARES, a DIFFERENT person of the firm REVIEWS, the store's OWNER ACCEPTS (under adviser_posts the server accepts for the owner in the preparer's own transaction, stamped delegated), and only then does the existing writer post.
 * OWNS      the five steps of an action (books_action_step, migration b867, insert-only: the status of an action is its LATEST step) · prepare · review · return · accept · withdrawEnded (a revoked or expired grant) · list · get.
 * CALLED BY routes/books-actions.js (the doors) · lib/books-grant.js revoke() and give() (withdrawEnded, in their own transaction).
 * FLOW      prepare: the body is read ONCE into the event the owner's own door would build (eventOf) → the server's own preview (B.previewEntry: nothing stored) gives the total and currency the preparer saw → one `prepared` step.
 *           review: a different person, the same body_hash. accept (the owner): in ONE transaction → the stored, the carried and the engine's totals are compared → the EXISTING writer posts (B.postEntry / reverseEntry / setPeriod /
 *           closeYear, source_ref action:<id>) → the engine's total is READ from the entry it wrote and compared (never a second preview, never a second formula) → the `accepted` step; any difference rolls everything back.
 * CARD      04-network/ACC-176B-ADVISER-REQUIREMENT
 * The queue READS (queueAsked · queuePage · waitingForOwner · returnedFor) live in lib/books-action-queue.js, re-exported here; the row shapes they read (STEP_COLUMNS, viewOf, grantLiveOf, sameId) are exported for it.
 * SHOPBK-B (19 Nov): the SAME queue holds the shop's OWN Bookkeeper's held entries when the owner asked to approve (policy_flags.books_owner_approves, lib/books-approval.js): role `staff`, kind `event` (a Day book event, exactly the
 *           /events body) or `journal`, grant_id NULL, no review step (prepared reads waiting_accept), accepted by the owner through the same acceptAction. Needs migration b884 (the role, the kind and the insert policy).
 * ⚠️ ONE POSTING PATH: nothing here posts a line of its own. ⚠️ A step is stamped with the real person, the firm, the role and the time; nothing is updated, a return ends the round and a new action is prepared.
 * ⚠️ Not migrated (b867 not run) is a typed refusal in words (BOOKS_ACTION_NOT_SWITCHED_ON, 503), never a 500 and never a write.
 */
const crypto = require('crypto');
const { withEntity, queryAs } = require('../db');
const schema = require('./schema');
const canon = require('./canon');
const reqctx = require('./reqctx');
const money = require('./money');
const { isGrantParentSql } = require('./network-membership');
const { record } = require('./access-events');

const KINDS = ['journal', 'reverse', 'lock', 'unlock', 'year_close', 'event'];
const { STAFF_KINDS } = require('./books-approval');
const NOT_ON = 'BOOKS_ACTION_NOT_SWITCHED_ON';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TERMINAL = ['returned', 'accepted', 'withdrawn'];
const STATE_OF_LAST = { prepared: 'waiting_review', reviewed: 'waiting_accept', returned: 'returned', accepted: 'accepted', withdrawn: 'withdrawn' };

/** a typed refusal the route turns into a Problem: { code, status, words } */
const refusal = (code, status, words) => Object.assign(new Error(words), { code, status, words });
const ledger = () => require('./books');
const queue = () => require('./books-action-queue'); /* the queue reads (split out of this file) */
const sameId = (left, right) => String(left) === String(right);

/** is the table there (b867 run): the api is correct before and after the file runs */
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
function journalBodyOf(body, staff) {
  if (body.against_ref || (Array.isArray(body.lines) && body.lines.some((line) => line && (line.party || line.party_id)))) throw refusal('ACTION_PARTY_NOT_IN_V1', 422, staff ? 'A journal that names a customer, a supplier or a bill is entered by the owner.' : 'An adviser journal cannot name a customer, a supplier or a bill. The owner enters those.');
  if (!Array.isArray(body.lines) || body.lines.length < 2) throw refusal('ACTION_BODY_INVALID', 422, 'A journal needs at least two lines.');
  /* the date is part of what was reviewed: an undated journal would post on the day of the ACCEPT, in a month nobody saw */
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.date || ''))) throw refusal('ACTION_BODY_INVALID', 422, 'A journal needs its date.');
  return { narration: require('./books-input').narration(body.narration), date: text(body.date, 10), lines: body.lines, ref: text(body.ref, 80), currency: body.currency ? String(body.currency).toUpperCase() : null };
}
const EVENT_BODY_MAX = 8000;
/** a Day book event's body (SHOPBK-B): exactly the /events body, whole and plain (books-manual.eventOf is its one reader; nothing is picked or renamed here) */
function eventBodyOf(body) {
  if (!Object.keys(body).length || JSON.stringify(body).length > EVENT_BODY_MAX) throw refusal('ACTION_BODY_INVALID', 422, 'Say what happened, with its figures.');
  return JSON.parse(JSON.stringify(body));
}
/** a reversal's body: the entry (a uuid) and the reason */
function reverseBodyOf(body) {
  if (!UUID.test(String(body.entry_id || ''))) throw refusal('ACTION_BODY_INVALID', 422, 'Name the entry to reverse.');
  if (!text(body.reason, 300)) throw refusal('ACTION_BODY_INVALID', 422, 'A reversal needs a reason.');
  return { entry_id: String(body.entry_id).toLowerCase(), reason: text(body.reason, 300) };
}
/** a lock's or unlock's body: the year and the month (opening a locked month needs a reason) */
function periodBodyOf(body, kind) {
  if (!FISCAL_YEAR.test(String(body.fy || '')) || !/^[0-9]{1,2}$/.test(String(body.period || ''))) throw refusal('ACTION_BODY_INVALID', 422, 'Name the year and the month.');
  if (kind === 'unlock' && !text(body.reason, 300)) throw refusal('ACTION_BODY_INVALID', 422, 'Opening a locked month needs a reason.');
  return { fy: String(body.fy), period: Number(body.period), reason: text(body.reason, 300) };
}
/** a year close's body: the year */
function yearBodyOf(body) {
  if (!FISCAL_YEAR.test(String(body.fy || ''))) throw refusal('ACTION_BODY_INVALID', 422, 'Name the year to close.');
  return body.returns_lodged === true ? { fy: String(body.fy), returns_lodged: true } : { fy: String(body.fy) }; /* PAST-YEARS: the declaration rides in the body only when given, so every earlier action keeps its hash */
}
/** the whitelisted body of an action: each kind's own reader, anything else dropped (never carried into the books) */
function bodyOf(kind, given, staff) {
  const body = given && typeof given === 'object' ? given : {};
  if (kind === 'event') return eventBodyOf(body);
  if (kind === 'journal') return journalBodyOf(body, staff);
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
/** RC-9/10 (DECISIONS 19 Nov): review is never enforced, so the record SAYS which it was: 'reviewed' (a colleague), 'self_reviewed' (the doer checked their own work), 'not_reviewed' (nobody did) */
const SELF_REVIEWED = 'self_reviewed';
const NOT_REVIEWED_NOTE = 'accepted without a review';
const reviewWordOf = (reviewedStep) => (!reviewedStep ? 'not_reviewed' : reviewedStep.reason === SELF_REVIEWED ? SELF_REVIEWED : 'reviewed');
/** the state a person reads: a staff action has no review step, so its `prepared` step already waits for the OWNER */
const stateOf = (steps) => (steps[0].role === 'staff' && lastOf(steps).step === 'prepared' ? 'waiting_accept' : STATE_OF_LAST[lastOf(steps).step]);
/** the shape the web reads: the action as its steps say it is now */
function viewOf(steps, grantLive) {
  const first = steps[0];
  const last = lastOf(steps);
  const stamp = (row) => (row ? { identity_id: row.actor_identity_id, name: row.actor_name, firm: row.firm_name, role: row.role, at: row.at, reason: row.reason } : null);
  const open = !TERMINAL.includes(last.step);
  return {
    action_id: first.action_id, store: first.store, kind: first.kind, state: stateOf(steps), client_ref: first.action_ref, body_hash: first.body_hash,
    total_minor: first.total_minor == null ? null : Number(first.total_minor), currency: first.currency, body: first.body,
    prepared: stamp(first), reviewed: stamp(stepNamed(steps, 'reviewed')), review: reviewWordOf(stepNamed(steps, 'reviewed')), review_state: reviewWordOf(stepNamed(steps, 'reviewed')), reviewed_by: (stepNamed(steps, 'reviewed') || {}).actor_name || null, reviewed_at: (stepNamed(steps, 'reviewed') || {}).at || null, closed: open ? null : stamp(last), grant_id: first.grant_id, entry_id: (stepNamed(steps, 'accepted') || {}).entry_id || null,
    access_ended: open && grantLive === false
  };
}
/**
 * is the grant an action was prepared under live right now: not revoked, not expired (the database clock) and the network edge still makes the grantee the store's parent: the look's own test, asked in the same words.
 * `locked` reads the grant FOR SHARE: a revoke (which holds it FOR UPDATE) then waits for this transaction or is seen by it, so a revoke racing an accept leaves exactly one outcome.
 */
async function grantLiveOf(handle, store, grantId, locked) {
  if (grantId == null) return true; /* the shop's own staff action carries no grant: there is no access to end */
  const live = `${require('./books-grant').liveGrantSql('g')} AND ${isGrantParentSql('g.grantee_entity::text', 'g.grantor_entity::text')}`;
  const found = await handle.query(`SELECT (${live}) AS live FROM books_access_grant g WHERE g.grant_id = $1 AND g.grantor_entity = $2${locked ? ' FOR SHARE OF g' : ''}`, [grantId, store]);
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
    if (err.code === '42501' || err.code === '23514') throw refusal('ACTION_NOT_ALLOWED', 403, row.role === 'staff' ? 'The approval list cannot take this yet, so nothing was recorded. Ask the owner.' : 'This access has ended, so nothing was recorded.'); /* a staff step is refused by the table only until its migration ran (b884 · b885) */
    throw err;
  }
}
const stampOf = (actor) => ({ actor_identity_id: actor.identity_id, actor_name: actor.name ? String(actor.name).slice(0, 200) : null, firm_name: actor.firm_name || null, grant_id: actor.grant_id || null });

/* ── prepare ───────────────────────────────────────────────────────────────────────────────────────────── */
/** the kinds that carry an amount: the total and the currency travel with them from prepare to accept and are compared at each step */
const MONEY_KINDS = ['journal', 'reverse', 'event'];
/** a reversal names a MANUAL journal entry of THIS store (an id of another store is invisible by row security: the same 404): the entry's own total and currency are READ, carried, never computed */
async function reversibleEntryOf(handle, store, entryId, staff) {
  const found = await handle.query('SELECT entry_no, event_type, total_minor, currency FROM journal_entry WHERE entity_id = $1 AND entry_id = $2', [store, entryId]);
  if (!found.rows.length) throw refusal('NOT_FOUND', 404, 'Not found');
  if (!staff && found.rows[0].event_type !== 'manual') throw /* the shop's own Bookkeeper reverses what the owner could (the live-bill guard still applies); an adviser reverses journals only */ refusal('ACTION_REVERSE_MANUAL_ONLY', 422, 'An adviser reverses journal entries only. A sale, a receipt or a bill is reversed by the owner.');
  return { total_minor: Number(found.rows[0].total_minor), currency: found.rows[0].currency };
}
/** XC-1119: a ledger that is off because the client's country has NO PACK says so (the one sentence, lib/no-pack-words) — the owner cannot switch it on; only a ledger the owner has not switched on says LEDGER_OFF */
async function ledgerOffRefusal(handle, store) {
  const status = await require('./country-setup').status(handle, store);
  if (status && status.code === 'NO_COUNTRY_PACK') return refusal('NO_COUNTRY_PACK', 422, status.why);
  return refusal('LEDGER_OFF', 404, 'This shop has not switched the ledger on.');
}
/** the Day book's own builder (books-manual.eventOf), the ONE reader of an /events body: the same event the owner's own door would post */
const eventBuilt = (store, books, body, by) => require('./books-manual').eventOf(store, books, body, by);
/** the total and currency the preparer saw: the server's own preview of the same event (nothing is stored by it), or the entry a reversal undoes */
async function previewOf(handle, store, books, kind, body, staff) {
  if (kind === 'reverse') return reversibleEntryOf(handle, store, body.entry_id, staff);
  if (kind !== 'journal' && kind !== 'event') return { total_minor: null, currency: null };
  const seen = await ledger().previewEntry(handle, store, kind === 'event' ? (await eventBuilt(store, books, body, null)).ev : journalEvent(books, body, {}));
  if (!seen || !seen.ok) throw await ledgerOffRefusal(handle, store);
  return { total_minor: Number(seen.posted.totals.dr_minor), currency: seen.posted.currency };
}
/** a second prepare is refused while an action with the same client_ref or the same body is open, and when the ref already holds an entry (the same line, or a double press, sent twice) */
async function refuseRepeatedRef(handle, store, ref, hash) {
  await lockAction(handle, store + '|' + ref);
  await lockAction(handle, store + '|body|' + hash); /* LENS2 integrity money-01 M2: the body-hash refusal below is on a different ref's rows, so the ref lock alone let two tabs with the same body and different refs both pass and post twice */
  const open = await handle.query(`SELECT p.action_id FROM books_action_step p WHERE p.store = $1 AND (p.action_ref = $2 OR p.body_hash = $4) AND p.step = 'prepared'
      AND NOT EXISTS (SELECT 1 FROM books_action_step t WHERE t.action_id = p.action_id AND t.step = ANY($3::text[])) LIMIT 1`, [store, ref, TERMINAL, hash]);
  if (open.rows.length) throw refusal('ACTION_REF_OPEN', 409, 'An action with this reference or this content is already waiting. Open it from the queue.');
  const posted = await handle.query(`SELECT entry_no FROM journal_entry WHERE entity_id = $1 AND (source_ref = $2 OR (source_ref LIKE 'ev:%' AND right(source_ref, length($4::text) + 1) = ':' || $4::text) OR source_ref IN (SELECT 'action:' || action_id::text FROM books_action_step WHERE store = $1 AND action_ref = $3 AND step = 'accepted')) LIMIT 1`, [store, 'manual:' + ref, ref, ref]);
  if (posted.rows.length) throw refusal('ACTION_REF_POSTED', 409, 'This reference already holds entry ' + posted.rows[0].entry_no + '. It is not prepared again.');
}
/** the advisory warning of a prepare: a journal dated outside the month the page says it is working in (a client wish, never a refusal; the guard is the accept's strict-date posting) */
function warningsOf(input, body) {
  const month = /^\d{4}-\d{2}$/.test(String(input.working_month || '')) ? String(input.working_month) : null;
  const date = input.kind === 'journal' ? body.date || null : null;
  if (!month || !date || date.slice(0, 7) === month) return [];
  return [{ code: 'OUTSIDE_MONTH_BEING_WORKED', words: 'This entry is dated ' + date + ', outside ' + month + ', the month you are working in.' }];
}
/**
 * prepareAction(store, actor, { kind, body, client_ref, working_month }, books) → the action view (+ warnings). actor = { identity_id, name, firm_name, grant_id }; books = the store's setting (the route's `on` gate).
 * A date outside the month the page is working on is an ADVISORY warning (a client wish), never a refusal; the guard is the accept's strict-date posting.
 */
async function prepareAction(store, actor, input, books) {
  const staff = actor.staff === true; /* the shop's own Bookkeeper (SHOPBK-B): a held entry, no grant, no review step; what a person may prepare is refused BEFORE the table is asked */
  if (!KINDS.includes(input.kind)) throw refusal('ACTION_KIND_INVALID', 422, 'Say what is to be done: a journal, a reversal, a lock, an unlock or a year close.');
  if (staff && !STAFF_KINDS.includes(input.kind)) throw refusal('ACTION_KIND_NOT_FOR_STAFF', 403, 'Only the owner locks or opens a month or closes a year.');
  if (!staff && input.kind === 'event') throw refusal('ACTION_KIND_INVALID', 422, 'An adviser firm prepares a journal, a reversal, a lock, an unlock or a year close.');
  await ready();
  let body = bodyOf(input.kind, input.body, staff);
  if (input.kind === 'event') body = await withTheDate(store, books, body);
  const hash = hashOf(store, input.kind, body);
  const ref = input.client_ref ? String(input.client_ref).slice(0, 80) : staff ? 'held-' + hash.slice(0, 24) : null; /* a staff press with no reference is the same action while it waits */
  if (!ref) throw refusal('ACTION_REF_NEEDED', 422, 'Give the action a reference, so that pressing Prepare twice cannot make two.');
  const actionId = crypto.randomUUID();
  return asStore(store, async (handle) => {
    await refuseRepeatedRef(handle, store, ref, hash);
    const seen = await previewOf(handle, store, books, input.kind, body, staff);
    await addStep(handle, Object.assign({ action_id: actionId, store, step: 'prepared', kind: input.kind, body, body_hash: hash, total_minor: seen.total_minor, currency: seen.currency, action_ref: ref, role: staff ? 'staff' : 'maker' }, stampOf(actor)));
    if (!staff && (await delegatedFor(handle, store, actor.grant_id, seen))) return postDelegated(handle, store, actionId, actor, books, input);
    return Object.assign(viewOf(await stepsOf(handle, store, actionId), true), { warnings: warningsOf(input, body) });
  });
}

/** a date is part of what the owner is shown: an event typed with no date would post on the day of the ACCEPT, in a month nobody saw — so the day the shop's clock gave it at prepare is written into the body */
async function withTheDate(store, books, body) {
  const built = await eventBuilt(store, books, body, null);
  const shopDay = built && built.ev && typeof built.ev.date === 'string' ? built.ev.date.slice(0, 10) : null;
  const inner = body.event && typeof body.event === 'object' ? body.event : null;
  if ((inner && inner.date) || body.date || !/^\d{4}-\d{2}-\d{2}$/.test(String(shopDay))) return body;
  return Object.assign({}, body, { date: shopDay });
}

/* ── review and return ─────────────────────────────────────────────────────────────────────────────────── */
/** the action as it must be for a step: open, bound to the hash the person saw */
function openFor(steps, seenHash) {
  const last = lastOf(steps);
  if (TERMINAL.includes(last.step)) throw refusal('ACTION_CLOSED', 409, 'This action is already ' + STATE_OF_LAST[last.step] + '.');
  if (seenHash !== steps[0].body_hash) throw refusal('ACTION_BODY_CHANGED', 409, 'This is not the entry you were shown. Open it again.');
  return last;
}
/**
 * is the reviewer the SAME HUMAN as the preparer: the same identity, or two identities that name one person (the same e-mail, auth user id or phone), such as the firm's owner sign-in and a staff login of the same man.
 * Read as the FIRM (its own people are visible to it), never as the store. Unknown rows read as "not the same": a person with no e-mail and no phone on file cannot be linked, which is stated in the PR.
 */
async function sameHuman(firmEntity, leftId, rightId) {
  if (sameId(leftId, rightId)) return true;
  const found = await queryAs(firmEntity, 'SELECT identity_id, lower(btrim(email)) AS email, lower(user_id) AS user_id, phone FROM identities WHERE identity_id = ANY($1::uuid[])', [[leftId, rightId]]);
  const left = found.rows.find((row) => sameId(row.identity_id, leftId));
  const right = found.rows.find((row) => sameId(row.identity_id, rightId));
  return !!left && !!right && ['email', 'user_id', 'phone'].some((key) => !!left[key] && left[key] === right[key]);
}
/**
 * who of the FIRM may check what: the same firm (the grant the action was prepared under, else it is not theirs and answers 404, nothing leaks), a NAMED person (a person's own sign-in: the firm's owner sign-in is not
 * a named person and can prepare but never check), and not the preparer.
 */
async function refuseUnlessNamedOfGrant(actor, first) {
  if (!sameId(actor.grant_id, first.grant_id)) throw refusal('NOT_FOUND', 404, 'There is no such action.');
  if (!actor.named) throw refusal('ACTION_REVIEWER_NOT_NAMED', 403, 'A review needs a named person of the firm, not the firm\'s own sign-in.');
}
/** a RETURN is a colleague's (never one's own work); a review is not enforced as a second person (RC-9/10), so reviewAction asks refuseUnlessNamedOfGrant only */
async function refuseUnlessChecker(actor, first) {
  await refuseUnlessNamedOfGrant(actor, first);
  if (await sameHuman(actor.firm_entity, first.actor_identity_id, actor.identity_id)) throw refusal('ACTION_SELF_REVIEW', 403, 'You prepared this, or you are the same person as the one who did, so a colleague has to review it.');
}
/** reviewAction(store, actor, actionId, { body_hash }) → the action view: a DIFFERENT named person of the same firm than the preparer, on an action still waiting for review */
async function reviewAction(store, actor, actionId, input) {
  await ready();
  return asStore(store, async (handle) => {
    await lockAction(handle, actionId);
    const steps = await stepsOf(handle, store, actionId);
    const first = steps[0];
    await refuseUnlessNamedOfGrant(actor, first);
    const last = openFor(steps, input.body_hash);
    if (last.step !== 'prepared') throw refusal('ACTION_CLOSED', 409, 'This action has already been reviewed.');
    const self = await sameHuman(actor.firm_entity, first.actor_identity_id, actor.identity_id); /* RC-10: allowed, and recorded as such (the reason column carries the word: no new column) */
    await addStep(handle, Object.assign({ action_id: first.action_id, store, step: 'reviewed', kind: first.kind, body_hash: first.body_hash, total_minor: first.total_minor, currency: first.currency, action_ref: first.action_ref, role: 'checker', reason: self ? SELF_REVIEWED : undefined }, stampOf(actor)));
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
    const first = steps[0];
    if (!byOwner) await refuseUnlessChecker(actor, first);
    openFor(steps, input.body_hash);
    await addStep(handle, Object.assign({ action_id: first.action_id, store, step: 'returned', kind: first.kind, body_hash: first.body_hash, total_minor: first.total_minor, currency: first.currency, action_ref: first.action_ref, role: byOwner ? 'owner' : 'checker', reason }, stampOf(byOwner ? Object.assign({}, actor, { grant_id: null, firm_name: null }) : actor)));
    return viewOf(await stepsOf(handle, store, actionId), await grantLiveOf(handle, store, first.grant_id));
  });
}

/* ── accept (the owner) ────────────────────────────────────────────────────────────────────────────────── */
/** a total as words: its currency and its figure in major units */
const shown = (pair) => money.format({ amount: require('./books-cashflow').fromMinor(pair.total_minor, pair.currency), currency: pair.currency });
/** the totals must agree: the pair stored at prepare, the pair the owner's confirm carried (the screen's popup), the pair the engine produced; a difference names both numbers */
function sameTotals(left, right, where) {
  if (Number(left.total_minor) === Number(right.total_minor) && String(left.currency) === String(right.currency)) return;
  throw refusal('PREVIEW_TOTAL_DIFFERS', 409, 'The total changed since it was prepared (' + shown(left) + ' then ' + shown(right) + ', ' + where + '). Nothing was posted. Open it again.');
}
/** a journal: the owner's own typed-entry writer, source_ref action:<id>; a `duplicate` answer is a refusal, never an acceptance */
async function postJournal(handle, store, first, actionId, books) {
  const out = await ledger().postEntry(handle, store, journalEvent(books, first.body, { by: first.actor_identity_id, source_ref: 'action:' + actionId }));
  if (!out || out.off) throw await ledgerOffRefusal(handle, store);
  if (out.duplicate) throw refusal('ACTION_DUPLICATE', 409, 'This was already posted as ' + (out.entry_no || 'an entry') + '. Nothing was posted again.');
  return { entry_id: out.entry_id, entry_no: out.entry_no };
}
/** a reversal: the existing reverser (the mirror entry, the bills it reopened) */
async function postReversal(handle, store, first) {
  const held = (await require('./books-live-bill').reverseRefusals(handle, store, [first.body.entry_id])).get(String(first.body.entry_id)); /* the ONE reverse guard (live bill / loan with repayments), asked here too */
  if (held) throw refusal(held.code, 409, held.words);
  const out = await ledger().reverseEntry(handle, store, first.body.entry_id, { by: first.actor_identity_id, reason: first.body.reason });
  if (out.duplicate) throw refusal('ACTION_DUPLICATE', 409, 'This entry was already reversed by ' + out.entry_no + '. Nothing was posted again.');
  return { entry_id: out.entry_id, entry_no: out.entry_no };
}
/** a year close: the existing closer, with its refusals in the owner's words */
async function postYearClose(handle, store, first) {
  const out = await ledger().closeYear(handle, store, first.body.fy, first.actor_identity_id, { returnsLodged: first.body.returns_lodged === true });
  if (!out.ok) throw refusal('YEAR_CLOSE_REFUSED', 422, (out.refusals || []).map((item) => item.why).join(' ') || 'The year cannot be closed yet.');
  if (out.duplicate) throw refusal('ACTION_DUPLICATE', 409, 'This year is already closed' + (out.returns_lodged ? ' and its returns are recorded as lodged.' : '.'));
  return { entry_id: null, entry_no: null };
}
/** a lock or an unlock of a month: the existing period writer (a soft lock; an unlock needs its reason) */
async function postPeriod(handle, store, first) {
  await ledger().setPeriod(handle, store, first.body.fy, first.body.period, first.kind === 'unlock' ? 'open' : 'soft_locked', first.actor_identity_id, first.body.reason);
  return { entry_id: null, entry_no: null };
}
/** a Day book event: the same builder as the owner's own door (books-manual.eventOf) over the body that was shown; the writer is the one B.postEntry; source_ref action:<id>, created_by the preparer */
async function postEvent(handle, store, first, actionId, books) {
  const built = await eventBuilt(store, books, first.body, first.actor_identity_id);
  const out = await ledger().postEntry(handle, store, Object.assign({}, built.ev, { by: first.actor_identity_id, source_ref: 'action:' + actionId }));
  if (!out || out.off) throw await ledgerOffRefusal(handle, store);
  if (out.duplicate) throw refusal('ACTION_DUPLICATE', 409, 'This was already posted as ' + (out.entry_no || 'an entry') + '. Nothing was posted again.');
  return { entry_id: out.entry_id, entry_no: out.entry_no };
}
const POSTERS = { event: postEvent, journal: postJournal, reverse: postReversal, year_close: postYearClose, lock: postPeriod, unlock: postPeriod };
/** the existing writer for the action, in the accept's own transaction; returns { entry_id, entry_no } (null for a lock, unlock or year close) */
async function postWith(handle, store, first, actionId, books) {
  return POSTERS[first.kind](handle, store, first, actionId, books);
}
/** the total the engine wrote, READ from the entry it posted (nothing is computed again) */
async function writtenTotal(handle, store, entryId) {
  const found = await handle.query('SELECT total_minor, currency FROM journal_entry WHERE entity_id = $1 AND entry_id = $2', [store, entryId]);
  if (!found.rows[0]) throw refusal('NOT_FOUND', 404, 'Not found');
  return { total_minor: Number(found.rows[0].total_minor), currency: found.rows[0].currency };
}
/** the owner may accept only a REVIEWED action, still under a live grant, whose confirm carried the total that was prepared → the first step (the prepared one) */
async function acceptableFirst(handle, store, steps, input) {
  openFor(steps, input.body_hash); /* RC-9: no review is needed to accept; the record says "not reviewed" */
  const first = steps[0];
  if (first.grant_id != null && !(await grantLiveOf(handle, store, first.grant_id, true))) throw refusal('ACTION_ACCESS_ENDED', 409, 'The access this was prepared under has ended. You can return it.');
  if (MONEY_KINDS.includes(first.kind)) {
    if (!Number.isInteger(input.total_minor) || !/^[A-Z]{3}$/.test(String(input.currency || ''))) throw refusal('ACTION_TOTAL_NEEDED', 422, 'Confirm the total and its currency as shown on the screen.');
    sameTotals({ total_minor: first.total_minor, currency: first.currency }, { total_minor: input.total_minor, currency: input.currency }, 'what you confirmed');
  }
  return first;
}
/** post the action through the existing writer in this transaction, compare the carried and the written totals (a difference rolls everything back), then close it with the accepting step of `role` stamped by `who` */
async function settle(handle, store, first, books, role, who, reason) {
  const posted = first.grant_id == null ? await postWith(handle, store, first, first.action_id, books) : await reqctx.runActingFor(first.grant_id, () => postWith(handle, store, first, first.action_id, books)); /* the shop's own staff action acts under no grant */
  if (MONEY_KINDS.includes(first.kind)) sameTotals({ total_minor: first.total_minor, currency: first.currency }, await writtenTotal(handle, store, posted.entry_id), 'what the books wrote');
  await addStep(handle, Object.assign({ action_id: first.action_id, store, step: 'accepted', kind: first.kind, body_hash: first.body_hash, total_minor: first.total_minor, currency: first.currency, action_ref: first.action_ref, role, reason, entry_id: posted.entry_id }, stampOf(who)));
  return posted;
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
    const first = await acceptableFirst(handle, store, steps, input);
    const books = await ledger().settingOf(handle, store);
    if (!books || !books.enabled) throw await ledgerOffRefusal(handle, store);
    const posted = await settle(handle, store, first, books, 'owner', Object.assign({}, owner, { grant_id: first.grant_id, firm_name: null }), stepNamed(steps, 'reviewed') || first.role === 'staff' ? undefined : NOT_REVIEWED_NOTE); /* RC-9 (a staff action has no review step to miss) ·: the accepting step says so */
    return { action: viewOf(await stepsOf(handle, store, actionId), true), entry: posted };
  });
}

/* ── delegated posting (the owner chose adviser_posts on the grant; ACC-176b) ───────────────────────── */
/**
 * does the owner's live adviser grant say adviser_posts for THIS action: read from the grant row in this transaction (never from the request); a money action above the optional cap, or in another currency than the cap's, waits
 * for the owner's accept instead. NULL (not chosen) and owner_approves are both "the owner accepts".
 */
async function delegatedFor(handle, store, grantId, seen) {
  if (!grantId || !(await schema.hasColumn('books_access_grant', 'posting')) || !(await grantLiveOf(handle, store, grantId, true))) return false;
  const row = (await handle.query('SELECT posting, posting_cap_minor, posting_cap_currency FROM books_access_grant WHERE grant_id = $1 AND grantor_entity = $2 AND preset = $3', [grantId, store, 'adviser'])).rows[0];
  if (!row || row.posting !== 'adviser_posts') return false;
  if (row.posting_cap_minor == null || seen.total_minor == null) return true;
  return seen.currency === row.posting_cap_currency && Number(seen.total_minor) <= Number(row.posting_cap_minor);
}
/** the record the owner reads in the audit log (access_events; no bell seam exists for it: the bell is fed by chit state changes only): the first delegated post of a grant, and every unlock and year close; a failed write rolls the post back */
async function alertOwner(handle, store, first, actor) {
  const prior = await handle.query("SELECT 1 FROM books_action_step WHERE store = $1 AND grant_id = $2 AND role = 'delegated' AND step = 'accepted' LIMIT 1", [store, first.grant_id]);
  const why = first.kind === 'unlock' || first.kind === 'year_close' ? first.kind : (prior.rows.length ? null : 'first');
  if (!why) return;
  const after = { action_id: first.action_id, kind: first.kind, grant_id: first.grant_id, posted_by: actor.name || null, firm: actor.firm_name || null };
  const written = await record((sql, params) => handle.query(sql, params), { entity_id: store, subject_identity_id: actor.identity_id, action: 'books_delegated_' + why, before: null, after, changed_by: actor.identity_id, reason: 'posted by ' + (actor.name || 'the adviser') + ' under delegation ' + first.grant_id });
  if (!written) throw refusal('ACTION_ALERT_NOT_RECORDED', 503, 'We could not record this for the owner, so nothing was posted. Try again.');
}
/**
 * the owner's record of an adviser's FIRST bank write under a grant (l16 adviser-bank): the same access_events row as the first delegated journal ('books_delegated_first'), once per grant. Called by the bank write doors BEFORE the writer, so a
 * failed record refuses the write (nothing is posted unrecorded); the owner's Who-looked page also shows each call (books_access_log).
 */
async function alertBankFirst(store, actor) {
  return asStore(store, async (handle) => {
    const prior = await handle.query("SELECT 1 FROM access_events WHERE entity_id = $1 AND action = 'books_delegated_first' AND after_value ->> 'grant_id' = $2 LIMIT 1", [store, String(actor.grant_id)]);
    if (prior.rows.length) return;
    const written = await record((sql, params) => handle.query(sql, params), { entity_id: store, subject_identity_id: actor.identity_id, action: 'books_delegated_first', before: null, after: { kind: 'bank', grant_id: actor.grant_id, posted_by: actor.name || null, firm: actor.firm_name || null }, changed_by: actor.identity_id, reason: 'bank lines added by ' + (actor.name || 'the adviser') + ' under delegation ' + actor.grant_id });
    if (!written) throw refusal('ACTION_ALERT_NOT_RECORDED', 503, 'We could not record this for the owner, so nothing was posted. Try again.');
  });
}
/** prepare, review and accept in ONE transaction, the same writer and the same total checks: the accept is stamped role 'delegated' (no review step: RC-9) with the adviser person and the grant, never as the owner */
async function postDelegated(handle, store, actionId, actor, books, input) {
  const first = (await stepsOf(handle, store, actionId))[0];
  /* RC-9: NO 'reviewed' step is written here: nobody reviewed it, and a step under the doer's own name read as if they had (the record says not_reviewed) */
  await alertOwner(handle, store, first, actor);
  const posted = await settle(handle, store, first, books, 'delegated', actor, 'delegated by the owner; not reviewed');
  return Object.assign(viewOf(await stepsOf(handle, store, actionId), true), { entry: posted, warnings: warningsOf(input, first.body) });
}

/* ── a revoked grant closes what it left open ─────────────────────────────────────────────────────────── */
/**
 * withdrawEnded(handle, store, by) → how many open actions were closed because the grant they were prepared under is revoked or has run out: "withdrawn: grant revoked" / "withdrawn: grant expired". It runs in the revoke's own
 * transaction, when a new grant replaces an expired one, and when the owner opens the queue; 0 and silent while b867 has not run. A closing step is unique per action (the database), so a racing accept and this leave one outcome.
 */
async function withdrawEnded(handle, store, by) {
  if (!(await schema.hasTable('books_action_step'))) return 0;
  /* ONE statement: an action another transaction closed first (an accept) is skipped by ON CONFLICT on the closing-step index, its outcome stands */
  const closed = await handle.query(`INSERT INTO books_action_step (action_id, store, step, kind, body_hash, total_minor, currency, action_ref, actor_identity_id, role, reason)
      SELECT p.action_id, p.store, 'withdrawn', p.kind, p.body_hash, p.total_minor, p.currency, p.action_ref, $3, 'owner',
        CASE WHEN g.revoked_at IS NOT NULL AND g.revoked_at < g.expires_at THEN 'withdrawn: grant revoked' ELSE 'withdrawn: grant expired' END
      FROM books_action_step p JOIN books_access_grant g ON g.grant_id = p.grant_id AND g.grantor_entity = p.store
      WHERE p.store = $1 AND p.step = 'prepared' AND (g.revoked_at IS NOT NULL OR g.expires_at <= now())
        AND NOT EXISTS (SELECT 1 FROM books_action_step t WHERE t.action_id = p.action_id AND t.step = ANY($2::text[]))
      ON CONFLICT DO NOTHING`, [store, TERMINAL, by]);
  return closed.rowCount;
}

/* ── the queue ─────────────────────────────────────────────────────────────────────────────────────────── */
/**
 * listActions(store, { state, mine, actor, page, limit }) → { actions, total, page, limit } newest first. state: waiting_review · waiting_accept · open · returned · accepted · withdrawn · all (default open);
 * `mine` keeps what this person prepared; the firm's own people see their own, a reviewer asks waiting_review and the web hides the ones they prepared.
 */
async function listActions(store, query, actor) {
  await ready();
  const asked = queue().queueAsked(query, actor);
  return asStore(store, async (handle) => {
    if (!asked.grant && !reqctx.isReadOnly()) await withdrawEnded(handle, store, actor.identity_id); /* the owner opening the queue closes what an expired or revoked grant left open */
    return queue().queuePage(handle, store, asked);
  });
}
/** getAction(store, actionId, actor) → one action with every step in order; a firm person asking for another grant's action gets the same 404 as for none */
async function getAction(store, actionId, actor) {
  await ready();
  return asStore(store, async (handle) => {
    const steps = await stepsOf(handle, store, actionId);
    if (actor && actor.grant_id && !sameId(actor.grant_id, steps[0].grant_id)) throw refusal('NOT_FOUND', 404, 'There is no such action.');
    return Object.assign(viewOf(steps, await grantLiveOf(handle, store, steps[0].grant_id)), { steps: steps.map((row) => ({ step: row.step, role: row.role, identity_id: row.actor_identity_id, name: row.actor_name, firm: row.firm_name, reason: row.reason, at: row.at })) });
  });
}


module.exports = { refuseRepeatedRef, withTheDate, returnedFor: (...args) => queue().returnedFor(...args), waitingForOwner: (...args) => queue().waitingForOwner(...args), STEP_COLUMNS, viewOf, grantLiveOf, sameId, reviewWordOf, SELF_REVIEWED, alertBankFirst, KINDS, NOT_ON, bodyOf, hashOf, refusal, prepareAction, reviewAction, returnAction, acceptAction, withdrawEnded, listActions, getAction };
