'use strict';
// OWNS      PRIVATE BOOKMARKS AND NOTES (v1, 17 Nov 2026): the ONE module that names the table private_flag (b876) · ready · mayUse · add · forSubjects · listOpen · counts · resolve · reopen · share · remove · clearBookmarks · thread · reply (the firm's own thread on a "My firm" note, b877)
// CALLED BY routes/flags.js (mounted at /api/flags) · tests/private-flag.test.cjs · tests/private-flag-isolation.realstack.cjs
// FLOW      the real caller (auth: req.identity) → the organisation's own binding (auth.entityOf) and the person (identity_id) → reqctx.runWithActor → grants.asEntity(own organisation) → the right to read the SUBJECT → the statement; both row-security walls (organisation, "Only me") answer from the database
// CARD      PM/REQ-PRIVATE-NOTES-BOOKMARKS-2026-11-17.md (amended per critic 9a26ad3c)
/**
 * ⭐ A FLAG BELONGS TO THE ORGANISATION OF THE PERSON WHO WROTE IT. Every statement here runs in the caller's OWN organisation (auth.entityOf(req)), never in a client's: this file never reads req.acting_for_grant, never reads X-Books-For, and routes/flags.js never mounts
 *   middleware/books-grant (a flag written under a grant would land in the client's organisation: the leak the capability doc named). tests/private-flag-isolation.realstack.cjs fails if the router ever mounts it.
 * ⭐ TWO WALLS IN THE DATABASE (b876): the organisation, and "Only me" on app.current_actor. The actor here is the REAL person (req.identity.identity_id, set again below), so a colleague's "Only me" row is not returned by ANY statement in this file, even one that forgot a filter.
 * ⭐ NO EXISTENCE ORACLE: this file reads NOTHING of the client. The page sends the label it already shows (entry number and date, plain text, at most 80 characters); a forged label fools only the writer's own organisation. The ONE check on a client subject is a LIVE GRANT from
 *   the writer's organisation on that client (books-baseline.liveGrantOf, which asks grants.verdictOf: the same verdict the books router reads, never copied). No live grant, an unknown client and a person without the right all answer the same 404.
 * ⭐ THE READ RIGHT IS THE RIGHT TO READ THE SUBJECT (critic 4): a firm = holdsSeat for either seat (middleware/books-grant mayUseGrant); a business = its owner, or a whole-entity login who may see costs (lib/access.seesWholeEntity + lib/cost.canRead: the test the books router
 *   asks of its auditor for compare and the returns). A cashier, a till key, a person with neither: 404.
 * ⭐ NOTHING IS DELETED. Removing sets state = 'removed', removed_by / removed_at and note = NULL (the words are gone, who and when stay); the trigger refuses any later change. cb_app has no DELETE.
 * ⭐ NOT MIGRATED: every call answers 503 FLAGS_NOT_MIGRATED in words, never a 500.
 * Replies (slice A4) and the lock at file close (slice C) are NOT here.
 */
const grants = require('./books-grant');
const baseline = require('./books-baseline'); /* rank 10: the ONE test of a live grant */
const schema = require('./schema');
const reqctx = require('./reqctx');
const access = require('./access');
const cost = require('./cost');
const { isOwner } = require('./owner');
const { subjectKinds } = require('./mark-adopters');
const { postMessage, blankFlagThread } = require('./message-post'); /* the ONE writer of a message; a note's replies are subject 'flag' */
const { MAX_IDS, NOTE_MAX } = require('./review-mark'); /* the one cap on ids and the one cap on a note: imported, never retyped */

const TABLE = 'private_flag';
const LABEL_MAX = 80;
const KINDS = ['bookmark', 'note'];
const VISIBILITIES = ['org', 'me'];
const BUSINESS = 'business';
const refuse = grants.refusal;
const WORDS = {
  NOT_FOUND: 'We could not find that.',
  NOT_MIGRATED: 'Private notes are not switched on yet.',
  IDS_TOO_MANY: 'Flag ' + MAX_IDS + ' records at a time or fewer.',
  IDS_NONE: 'Choose at least one record.',
  SUBJECT: 'That kind of record cannot be flagged.',
  LABEL: 'The label must be plain text, 1 to ' + LABEL_MAX + ' characters, with no < or >.',
  NOTE_NEEDED: 'Write the note.',
  NOTE_LONG: 'A note can be at most ' + NOTE_MAX + ' characters.',
  KIND: 'A flag is a bookmark or a note.',
  VISIBILITY: 'Choose who sees it: your organisation, or only you.',
  ONE_NOTE: 'A note goes on one record at a time.',
  NOT_YOURS: 'Only the person who wrote it, or the owner, can change this.',
  NOT_A_NOTE: 'Only a note can be resolved. Remove a bookmark when you are done.',
  REMOVED: 'This was removed. It cannot change.',
  SHARE_AUTHOR: 'Only the person who wrote it can share it.',
  SHARED_ALREADY: 'This record is already bookmarked for your organisation.',
  REFUSED: 'That change is not allowed.',
  PERIOD: 'Give the period as two dates, year-month-day.',
  REPLY_NEEDED: 'Write your reply.',
  ONLY_ME: 'An Only me note takes no replies. Share it with your organisation first.',
  RESOLVED: 'This note is resolved. Open it again to reply.',
  GRANT_ENDED: 'The access for this client has ended, so this note takes no new reply.',
  NOT_OPEN: 'This note cannot take a reply now.',
  NOT_A_NOTE_REPLY: 'Only a note takes replies.',
  REPLIES_NOT_MIGRATED: 'Replies on notes are not switched on yet.',
  NOTE_FULL: 'This note has all the replies it can take. Start a new note.'
};
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const FLAG_ID = /^\d{1,18}$/;
const notFound = () => refuse('FLAG_NOT_FOUND', 404, WORDS.NOT_FOUND);
const invalid = (code, words) => refuse(code, 422, words);

const ready = () => schema.hasTable(TABLE);
/** the replies' own switch (b877 widened the message check for 'flag'): before it runs a thread reads as empty and a reply is refused in words, never a 500 */
const repliesReady = () => schema.checkAllows('chit_messages_subject_ck', 'flag');
async function needReady() {
  if (!(await ready())) throw refuse('FLAGS_NOT_MIGRATED', 503, WORDS.NOT_MIGRATED);
}
const stamp = (value) => (value ? new Date(value).toISOString() : null);

/** the caller's own organisation: a co-assist acts FOR its parent (auth.entityOf); the person is always the real identity */
const spaceOf = (req) => require('../middleware/auth').entityOf(req);
const actorOf = (req) => req.identity.identity_id;

/**
 * what this caller may read, decided BEFORE any statement: { space, actor, business, roles }. business = may read the organisation's OWN books; roles = the grant roles a firm seat may open.
 * A device key has neither (a key is not a person). → mayUse = business or any role.
 */
async function rightsOf(req) {
  if (!req || !req.identity || req.api_key) return { space: null, actor: null, business: false, roles: [] };
  const space = spaceOf(req);
  const business = isOwner(req) || (access.seesWholeEntity(req.identity) && (await cost.canRead(req, space)) === true);
  const roles = require('../middleware/books-grant').usableRoles(req);
  return { space, actor: actorOf(req), business, roles };
}
const mayUse = (rights) => rights.business || rights.roles.length > 0;

/**
 * the seat the writer works from on this subject, or null (→ 404): the business's own books = 'business' (the right above); another business = the live grant of the writer's organisation, the seat being the grant's role.
 * One statement for all the roles the person may use, through books-baseline.liveGrantOf (grants.verdictOf, the books router's own verdict, inside it).
 */
async function subjectSeat(transaction, rights, subjectEntity) {
  if (subjectEntity === rights.space) return rights.business ? BUSINESS : null;
  const row = await baseline.liveGrantOf(transaction.query.bind(transaction), rights.space, subjectEntity, rights.roles);
  return row ? row.preset : null;
}

/** run in the caller's own organisation, as the real person, in one transaction; a trigger refusal is a refusal in words, a missing table is 503 */
async function runAsPerson(rights, work) {
  try {
    return await reqctx.runWithActor(rights.actor, () => grants.asEntity(rights.space, work));
  } catch (err) {
    if (err && err.code === '23505') throw refuse('FLAG_ALREADY_SHARED', 409, WORDS.SHARED_ALREADY);
    if (err && (err.code === 'P0001' || err.code === '42501') && /^private_flag/.test(String(err.message))) throw refuse('FLAG_CHANGE_REFUSED', 409, WORDS.REFUSED);
    throw err;
  }
}

const COLUMNS = 'flag_id::text AS flag_id, kind, visibility, subject_kind, subject_entity::text AS subject_entity, subject_id, label, note, state, seat, author_name, author_identity_id::text AS author_id, created_at, resolved_name, resolved_at, removed_name, removed_at';
/** a row as the page reads it: never the author's id, only `mine` */
const shaped = (row, actor) => ({
  flag_id: row.flag_id, kind: row.kind, visibility: row.visibility, subject_kind: row.subject_kind, subject_entity: row.subject_entity, subject_id: row.subject_id, label: row.label,
  note: row.note, state: row.state, seat: row.seat, by_name: row.author_name, mine: row.author_id === String(actor), created_at: stamp(row.created_at),
  resolved_by: row.resolved_name || null, resolved_at: stamp(row.resolved_at)
});

/** a label is plain text the page already shows: 1 to 80 characters, no markup, no control characters */
function labelOf(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > LABEL_MAX || /[<>\u0000-\u001f\u007f]/.test(text)) throw invalid('FLAG_LABEL_INVALID', WORDS.LABEL);
  return text;
}
function noteOf(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw invalid('FLAG_NOTE_REQUIRED', WORDS.NOTE_NEEDED);
  if (text.length > NOTE_MAX) throw invalid('FLAG_NOTE_TOO_LONG', WORDS.NOTE_LONG);
  return text;
}
/** the subject a request names: its kind (one of the SUBJECTS) and its client; a malformed client id is the same 404 as an unknown one */
function subjectOf(body, rights) {
  const kind = String((body || {}).subject_kind || '');
  if (!subjectKinds().includes(kind)) throw invalid('FLAG_SUBJECT_UNKNOWN', WORDS.SUBJECT);
  const entity = String((body || {}).subject_entity || '').toLowerCase();
  if (!grants.UUID.test(entity)) throw notFound();
  if (kind === 'client' && entity === rights.space) throw notFound(); /* a client is another business: a firm's note about it */
  return { kind, entity };
}
const idsOf = (list) => {
  if (!Array.isArray(list) || !list.length) throw invalid('FLAG_IDS_REQUIRED', WORDS.IDS_NONE);
  if (list.length > MAX_IDS) throw invalid('FLAG_IDS_TOO_MANY', WORDS.IDS_TOO_MANY);
  return list;
};
const ACCOUNT_ID = /^[a-z0-9._-]{1,40}@\d{4}-\d{2}-\d{2}$/; /* '<account code>@<period end day>': an explanation belongs to one period */
/** the ids of the subject kind: a posting is a uuid, a client is its own id, an account line is its code at the period's end */
function subjectIdOf(kind, entity, value) {
  const id = String(value == null ? '' : value).trim().toLowerCase();
  const valid = kind === 'client' ? id === entity : kind === 'account' ? ACCOUNT_ID.test(id) : grants.UUID.test(id);
  if (!valid) throw invalid('FLAG_ID_INVALID', 'That record is not valid.');
  return id;
}

/** the records of an add, each once with its label: Map(subject id → label) */
function recordsOf(input, subject) {
  const seen = new Map();
  for (const item of idsOf(input.items)) {
    const id = subjectIdOf(subject.kind, subject.entity, (item || {}).id);
    if (!seen.has(id)) seen.set(id, labelOf((item || {}).label));
  }
  return seen;
}
/** what an add asks for, validated: the kind, the visibility, the subject, the records (each once, with its label) and, for a note, the one note */
function addAsked(input, rights) {
  const kind = String(input.kind || '');
  if (!KINDS.includes(kind)) throw invalid('FLAG_KIND_INVALID', WORDS.KIND);
  const visibility = input.visibility == null ? 'org' : String(input.visibility);
  if (!VISIBILITIES.includes(visibility)) throw invalid('FLAG_VISIBILITY_INVALID', WORDS.VISIBILITY);
  const subject = subjectOf(input, rights);
  const seen = recordsOf(input, subject);
  const note = kind === 'note' ? noteOf(input.note) : null;
  if (kind === 'note' && seen.size !== 1) throw invalid('FLAG_ONE_NOTE', WORDS.ONE_NOTE);
  return { kind, visibility, subject, seen, note };
}
/**
 * add: bookmark one or many records (items [{ id, label }], at most MAX_IDS) or write ONE note. visibility 'org' (default) or 'me'. ONE statement for all the bookmarks; a record already bookmarked (open, by this person for 'me', by anyone of the organisation for 'org') is left as it is.
 * → { created, already, flags } · 404 when the subject is not the caller's to read
 */
async function addFlags(req, body) {
  await needReady();
  const rights = await rightsOf(req);
  if (!mayUse(rights)) throw notFound();
  const { kind, visibility, subject, seen, note } = addAsked(body || {}, rights);
  return runAsPerson(rights, async (transaction) => {
    const seat = await subjectSeat(transaction, rights, subject.entity);
    if (!seat) throw notFound();
    const ids = [...seen.keys()];
    const made = await transaction.query(
      `INSERT INTO ${TABLE} (entity_id, kind, visibility, subject_kind, subject_entity, subject_id, label, note, state, author_identity_id, author_name, seat)
       SELECT $1::uuid, $2, $3, $4, $5::uuid, t.id, t.label, $6, 'open', $7::uuid, $8, $9 FROM unnest($10::text[], $11::text[]) AS t(id, label) ON CONFLICT DO NOTHING RETURNING ${COLUMNS}`,
      [rights.space, kind, visibility, subject.kind, subject.entity, note, rights.actor, req.identity.display_name || null, seat, ids, ids.map((id) => seen.get(id))]);
    return { created: made.rows.length, already: ids.length - made.rows.length, flags: made.rows.map((row) => shaped(row, rights.actor)) };
  });
}

/** forSubjects: the open and resolved flags of the records a list page shows (ids in the body, at most MAX_IDS), ONE read → { subject_kind, subject_entity, flags: { id: [flag] } }; needs the live grant, as writing does */
async function forSubjects(req, body) {
  await needReady();
  const rights = await rightsOf(req);
  if (!mayUse(rights)) throw notFound();
  const subject = subjectOf(body, rights);
  const ids = idsOf((body || {}).ids).map((id) => String(id).toLowerCase());
  return runAsPerson(rights, async (transaction) => {
    if (!(await subjectSeat(transaction, rights, subject.entity))) throw notFound();
    const rows = (await transaction.query(
      `SELECT ${COLUMNS} FROM ${TABLE} WHERE entity_id = $1::uuid AND subject_entity = $2::uuid AND subject_kind = $3 AND subject_id = ANY($4::text[]) AND state <> 'removed' ORDER BY flag_id`,
      [rights.space, subject.entity, subject.kind, ids])).rows;
    const flags = {};
    for (const row of rows) (flags[row.subject_id] = flags[row.subject_id] || []).push(shaped(row, rights.actor));
    return { subject_kind: subject.kind, subject_entity: subject.entity, flags };
  });
}

/** a word of a query as text (lower case when asked), or null when it is missing or empty */
const textOrNull = (value, lower) => (value == null || value === '' ? null : lower ? String(value).toLowerCase() : String(value));
/** what a list asks for: the page (limit capped at MAX_IDS), one client (a uuid) and one kind, each or none */
function listAsked(options) {
  const limit = Math.min(Math.max(parseInt(options.limit, 10) || 50, 1), MAX_IDS);
  const page = Math.max(parseInt(options.page, 10) || 1, 1);
  const client = textOrNull(options.subject_entity, true);
  if (client !== null && !grants.UUID.test(client)) throw notFound();
  const kind = textOrNull(options.kind, false);
  if (kind !== null && !KINDS.includes(kind)) throw invalid('FLAG_KIND_INVALID', WORDS.KIND);
  return { limit, page, client, kind };
}
/** listOpen: the organisation's open flags this person may read, newest first, paged; optionally one client's. The grant is NOT asked (a firm keeps reading its own flags after a grant ends) → { flags, total, page, limit } */
async function listOpen(req, query) {
  await needReady();
  const rights = await rightsOf(req);
  if (!mayUse(rights)) throw notFound();
  const { limit, page, client, kind } = listAsked(query || {});
  return runAsPerson(rights, async (transaction) => {
    const where = `entity_id = $1::uuid AND state = 'open' AND ($2::uuid IS NULL OR subject_entity = $2::uuid) AND ($3::text IS NULL OR kind = $3::text)`;
    const args = [rights.space, client, kind];
    const total = (await transaction.query(`SELECT count(*)::int AS n FROM ${TABLE} WHERE ${where}`, args)).rows[0].n;
    const rows = (await transaction.query(`SELECT ${COLUMNS} FROM ${TABLE} WHERE ${where} ORDER BY created_at DESC, flag_id DESC LIMIT $4 OFFSET $5`, [...args, limit, (page - 1) * limit])).rows;
    return { flags: rows.map((row) => shaped(row, rights.actor)), total, page, limit };
  });
}

/** counts: how many open flags this person may read, in ONE read, for Home → { open, bookmarks, notes } */
async function counts(req) {
  await needReady();
  const rights = await rightsOf(req);
  if (!mayUse(rights)) throw notFound();
  return runAsPerson(rights, async (transaction) => {
    const rows = (await transaction.query(`SELECT kind, count(*)::int AS n FROM ${TABLE} WHERE entity_id = $1::uuid AND state = 'open' GROUP BY kind`, [rights.space])).rows;
    const by = Object.fromEntries(rows.map((row) => [row.kind, row.n]));
    return { open: (by.bookmark || 0) + (by.note || 0), bookmarks: by.bookmark || 0, notes: by.note || 0 };
  });
}

/** the one flag of this organisation the caller may read (the database hides a colleague's "Only me"), or the same 404 */
async function loaded(transaction, rights, id) {
  if (!FLAG_ID.test(String(id))) throw notFound();
  const row = (await transaction.query(`SELECT ${COLUMNS}, thread_id::text AS thread_id FROM ${TABLE} WHERE flag_id = $1::bigint AND entity_id = $2::uuid`, [id, rights.space])).rows[0];
  if (!row) throw notFound();
  return row;
}
/** a shared note or bookmark changes by its author or the organisation's lead (the owner); an "Only me" row is only ever the author's */
const mayChange = (req, rights, row) => row.author_id === String(rights.actor) || isOwner(req);
async function actOnFlag(req, id, work) {
  await needReady();
  const rights = await rightsOf(req);
  if (!mayUse(rights)) throw notFound();
  return runAsPerson(rights, async (transaction) => {
    const row = await loaded(transaction, rights, id);
    return work(transaction, rights, row);
  });
}
const personOf = (req, rights) => [rights.actor, req.identity.display_name || null];

/** resolve a note: it stays, greyed, with who and when */
const resolve = (req, id) => actOnFlag(req, id, async (transaction, rights, row) => {
  if (row.state === 'removed') throw refuse('FLAG_REMOVED', 409, WORDS.REMOVED);
  if (row.kind !== 'note') throw refuse('FLAG_NOT_A_NOTE', 409, WORDS.NOT_A_NOTE);
  if (row.state === 'resolved') return { flag: shaped(row, rights.actor), unchanged: true };
  if (!mayChange(req, rights, row)) throw refuse('FLAG_NOT_YOURS', 403, WORDS.NOT_YOURS);
  const done = (await transaction.query(`UPDATE ${TABLE} SET state = 'resolved', resolved_by = $2::uuid, resolved_name = $3, resolved_at = now() WHERE flag_id = $1::bigint AND state = 'open' RETURNING ${COLUMNS}`, [row.flag_id, ...personOf(req, rights)])).rows[0];
  return { flag: shaped(done, rights.actor), unchanged: false };
});
/** open a resolved note again */
const reopen = (req, id) => actOnFlag(req, id, async (transaction, rights, row) => {
  if (row.state === 'removed') throw refuse('FLAG_REMOVED', 409, WORDS.REMOVED);
  if (row.state === 'open') return { flag: shaped(row, rights.actor), unchanged: true };
  if (!mayChange(req, rights, row)) throw refuse('FLAG_NOT_YOURS', 403, WORDS.NOT_YOURS);
  const done = (await transaction.query(`UPDATE ${TABLE} SET state = 'open', resolved_by = NULL, resolved_name = NULL, resolved_at = NULL WHERE flag_id = $1::bigint AND state = 'resolved' RETURNING ${COLUMNS}`, [row.flag_id])).rows[0];
  return { flag: shaped(done, rights.actor), unchanged: false };
});
/** share an "Only me" flag with the organisation: its author only, one way (the table refuses taking it back) */
const share = (req, id) => actOnFlag(req, id, async (transaction, rights, row) => {
  if (row.state === 'removed') throw refuse('FLAG_REMOVED', 409, WORDS.REMOVED);
  if (row.visibility === 'org') return { flag: shaped(row, rights.actor), unchanged: true };
  if (row.author_id !== String(rights.actor)) throw refuse('FLAG_NOT_YOURS', 403, WORDS.SHARE_AUTHOR);
  const done = (await transaction.query(`UPDATE ${TABLE} SET visibility = 'org' WHERE flag_id = $1::bigint AND visibility = 'me' RETURNING ${COLUMNS}`, [row.flag_id])).rows[0];
  return { flag: shaped(done, rights.actor), unchanged: false };
});
/** remove a bookmark or a note: the words are gone, who and when stay (the row is the record) */
const remove = (req, id) => actOnFlag(req, id, async (transaction, rights, row) => {
  if (row.state === 'removed') throw refuse('FLAG_REMOVED', 409, WORDS.REMOVED);
  if (!mayChange(req, rights, row)) throw refuse('FLAG_NOT_YOURS', 403, WORDS.NOT_YOURS);
  const done = (await transaction.query(`UPDATE ${TABLE} SET state = 'removed', note = NULL, removed_by = $2::uuid, removed_name = $3, removed_at = now() WHERE flag_id = $1::bigint AND state <> 'removed' RETURNING ${COLUMNS}`, [row.flag_id, ...personOf(req, rights)])).rows[0];
  await blankFlagThread(transaction, row.thread_id, rights.space); /* the replies lose their words in the SAME transaction; who and when stay (critic A2) */
  return { flag: shaped(done, rights.actor), unchanged: false };
});

/** what a reply to this note may do now, with the sentence when it may not: the server answers, the page greys (a removed, resolved or Only-me note, or a grant that has ended, takes none) */
function replyMay(row, seat, switchedOn) {
  if (switchedOn === false) return { ok: false, why: WORDS.REPLIES_NOT_MIGRATED };
  if (row.kind !== 'note') return { ok: false, why: WORDS.NOT_A_NOTE_REPLY };
  if (row.state === 'removed') return { ok: false, why: WORDS.REMOVED };
  if (row.visibility !== 'org') return { ok: false, why: WORDS.ONLY_ME };
  if (row.state === 'resolved') return { ok: false, why: WORDS.RESOLVED };
  if (!seat) return { ok: false, why: WORDS.GRANT_ENDED };
  return { ok: true, why: null };
}
const MESSAGE_COLUMNS = 'message_id::text AS message_id, sender_display_name, message_text, created_at, (sender_identity_id = $3::uuid) AS mine';

/**
 * thread: the replies of ONE note this person may read, oldest first, and what a reply may do now. The grant is NOT asked (a firm keeps reading its thread after a grant ended). A note of a colleague's "Only me" is the same 404 (the database hides the row).
 * → { flag, messages: [{ message_id, by_name, text, mine, at }], may: { reply: { ok, why } } }
 */
async function thread(req, id) {
  await needReady();
  const rights = await rightsOf(req);
  if (!mayUse(rights)) throw notFound();
  return runAsPerson(rights, async (transaction) => threadOn(transaction, rights, await loaded(transaction, rights, id)));
}
/** the thread answer for one loaded note, on the caller's transaction (thread and reply both end here: no second transaction) */
async function threadOn(transaction, rights, row) {
  const seat = await subjectSeat(transaction, rights, row.subject_entity);
  const switchedOn = await repliesReady();
  const rows = row.visibility !== 'org' || row.state === 'removed' || !switchedOn ? [] : (await transaction.query(
    `SELECT ${MESSAGE_COLUMNS} FROM chit_messages WHERE subject_type = 'flag' AND subject_id = $1::uuid AND entity_id = $2::uuid ORDER BY created_at, message_id LIMIT 500`, [row.thread_id, rights.space, rights.actor])).rows;
  return {
    flag: shaped(row, rights.actor),
    messages: rows.map((message) => ({ message_id: message.message_id, by_name: message.sender_display_name || null, text: message.message_text, mine: message.mine === true, at: stamp(message.created_at) })),
    may: { reply: replyMay(row, seat, switchedOn) }
  };
}

/**
 * reply: one reply on a "My firm" note, by anyone of the organisation who may read the notes, while the access for the client is live. Written by lib/message-post (subject 'flag'): one copy, in this organisation, internal, never the client's.
 * Refused in words: an Only-me, resolved or removed note, a note whose access ended, an empty or too long reply. → the thread as thread() answers it
 */
async function reply(req, id, body) {
  await needReady();
  const rights = await rightsOf(req);
  if (!mayUse(rights)) throw notFound();
  const replyText = body && typeof body.message_text === 'string' ? body.message_text.trim() : '';
  if (!replyText) throw invalid('FLAG_REPLY_REQUIRED', WORDS.REPLY_NEEDED);
  if (replyText.length > NOTE_MAX) throw invalid('FLAG_REPLY_TOO_LONG', WORDS.NOTE_LONG);
  if (/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(replyText)) throw invalid('FLAG_REPLY_INVALID', 'A reply is plain text: no < or >.');
  if (!(await repliesReady())) throw refuse('FLAG_REPLIES_NOT_MIGRATED', 503, WORDS.REPLIES_NOT_MIGRATED);
  return runAsPerson(rights, async (transaction) => {
    const row = await loaded(transaction, rights, id);
    const seat = await subjectSeat(transaction, rights, row.subject_entity);
    const replyRight = replyMay(row, seat);
    if (!replyRight.ok) throw refuse('FLAG_REPLY_REFUSED', 409, replyRight.why);
    try {
      await postMessage(transaction, { subject_type: 'flag', subject_id: row.thread_id, sender_entity_id: rights.space, sender_display_name: req.identity.display_name || '', message_text: replyText });
    } catch (err) {
      if (err && err.code === 'MESSAGE_FLAG_NOT_OPEN') throw refuse('FLAG_REPLY_REFUSED', 409, WORDS.NOT_OPEN);
      if (err && err.code === 'MESSAGE_FLAG_FULL') throw refuse('FLAG_REPLY_REFUSED', 409, WORDS.NOTE_FULL);
      throw err;
    }
    return threadOn(transaction, rights, row);
  });
}

/** what a clear asks for: one client (a uuid) and an optional period of two days (YYYY-MM-DD) */
function clearAsked(input) {
  const client = String(input.subject_entity || '').toLowerCase();
  if (!grants.UUID.test(client)) throw notFound();
  const from = input.from == null ? null : String(input.from);
  const to = input.to == null ? null : String(input.to);
  for (const day of [from, to]) if (day !== null && !isRealDay(day)) throw invalid('FLAG_PERIOD_INVALID', WORDS.PERIOD);
  return { client, from, to };
}
/** a day written YYYY-MM-DD that is a real date */
const isRealDay = (day) => ISO_DAY.test(day) && !Number.isNaN(Date.parse(day));
/**
 * clearBookmarks: remove, in one act, the open BOOKMARKS of one client the caller may read (the organisation's shared ones and their own "Only me"), optionally the ones set between two days (from, to). Notes are never cleared in bulk.
 * The grant is not asked: a firm may tidy its bookmarks after a grant ended. → { cleared }
 */
async function clearBookmarks(req, body) {
  await needReady();
  const rights = await rightsOf(req);
  if (!mayUse(rights)) throw notFound();
  const { client, from, to } = clearAsked(body || {});
  return runAsPerson(rights, async (transaction) => {
    const done = await transaction.query(
      `UPDATE ${TABLE} SET state = 'removed', removed_by = $2::uuid, removed_name = $3, removed_at = now()
        WHERE entity_id = $1::uuid AND subject_entity = $4::uuid AND kind = 'bookmark' AND state = 'open'
          AND ($5::date IS NULL OR created_at >= $5::date) AND ($6::date IS NULL OR created_at < $6::date + 1)`,
      [rights.space, ...personOf(req, rights), client, from, to]);
    return { cleared: done.rowCount };
  });
}

module.exports = { thread, reply, TABLE, LABEL_MAX, KINDS, VISIBILITIES, WORDS, ready, mayUse, rightsOf, spaceOf, add: addFlags, forSubjects, listOpen, counts, resolve, reopen, share, remove, clearBookmarks, labelOf, subjectIdOf };
