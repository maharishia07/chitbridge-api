'use strict';
// OWNS      the neutral CORE of MARK & QUERY: set (the ONE mark writer) · marksFor (the latest mark per subject, one read) · openList (the open items, ageing, "checked n of m") · threadOf (history + replies) · reply · the typed refusals
// CALLED BY routes/marks.js · the adopters' own lists (marksFor embedded in a list the adopter already serves) · tests/review-mark.test.cjs
// FLOW      adopter (lib/mark-adopters) + the person's ctx → policy (lib/mark-policies) → subject + seal (lib/mark-detect) → the DB function review_mark_set (b868) → the door's onWrite hook, all on the CALLER'S transaction `db`
//           replies go through lib/message-post (the ONE message writer): no CTP, no replication, no timeline line, no level ladder.
// CARD      capability/MARK-AND-QUERY-CAPABILITY
/**
 * ⚠️ THIS FILE HOLDS NO ADOPTER WORD (tests/mark-core-neutral.test.cjs greps it): a record, a reviewer, a class, a door (`via`), an `onWrite` hook. What the record is, who may mark it and what counts as a change are the adopter's entry.
 * ⚠️ THE STATE IS THE LATEST ROW. Nothing is updated or deleted. A removed row never resets the age of an open run. `altered` is derived on read (two carried seals compared), never stored.
 * ctx = { entity_id (whose record), real: { identity_id, name, entity_id, entity_name }, owner, via: { kind, id, preset }, onWrite?(db, row), scope?(db, 'record' | 'writer') }
 * `scope` is for a door that writes for another business: the record side is read under the record owner's scope, the writer side (the DB function's trusted caller, the door's own log row) under the writer's own; a plain caller has none.
 */
const { adopterOf, vocabularyOf } = require('./mark-adopters');
const policies = require('./mark-policies');
const detect = require('./mark-detect');
const { postMessage } = require('./message-post');
const messageLimit = require('./message-limit');
const { boundRead } = require('./bound-read');

const NOTE_MAX = 1000; /* one number with the web textarea (cap-mark.js maxlength 1000); the table's CHECK stays at 4000 as the backstop */
const CLOSING = ['clear', 'reject'];
const DAY_MS = 24 * 3600 * 1000;

/** a typed refusal the route turns into a Problem: { code, status, words } */
const refusal = (code, status, words) => Object.assign(new Error(words), { code, status, words });
const WORDS = {
  MARK_NOT_SWITCHED_ON: 'Marking and queries are not switched on yet.',
  MARK_ADOPTER_UNKNOWN: 'We do not know that kind of review.',
  MARK_KIND_UNKNOWN: 'Choose one of the marks shown.',
  MARK_WORDS_REQUIRED: 'Write the question first. The owner will read it.',
  MARK_BULK_NOT_ALLOWED: 'Mark one record at a time.',
  MARK_IDS_TOO_MANY: 'Ask for 200 records at a time or fewer.',
  MARK_SUBJECT_NOT_FOUND: 'We could not find that record.',
  MARK_THREAD_NOT_FOUND: 'We could not find that question.',
  MARK_THREAD_CLOSED: 'This question is closed.',
  MARK_NOTE_TOO_LONG: 'Keep the note to 1000 characters or fewer.'
};
const said = (code, status) => refusal(code, status, WORDS[code]);

/** the refusal of the database in words: a function or table that is not there is "not switched on"; the door not vouching is a 403; a closed thread is a 409 */
function fromDb(err) {
  if (err && err.words) return err;
  if (err && (err.code === '42P01' || err.code === '42883' || err.code === '42703')) return said('MARK_NOT_SWITCHED_ON', 503);
  if (err && err.code === '23514') return said('MARK_NOTE_TOO_LONG', 422); /* a CHECK of review_mark the app did not catch first: words, never a 500 */
  if (err && err.code === '42501') return refusal('MARK_NOT_ALLOWED', 403, 'This is not open to you.');
  if (err && err.code === 'P0001' && /thread is closed/.test(String(err.message))) return said('MARK_THREAD_CLOSED', 409);
  return err;
}

/** move the transaction to the record's side or the writer's side (a door that has no second scope does nothing) */
const scopeTo = (db, ctx, side) => (ctx.scope ? ctx.scope(db, side) : null);

const isoOf = (value) => (value instanceof Date ? value.toISOString() : value ? new Date(value).toISOString() : null);

/** the server's verdict on what this person may do on this adopter (and, given a latest row, on this thread): { set: { ok, why }, reply: { ok, why } } */
function actionsOf(adopter, ctx, latest) {
  const set = policies.answer(adopter.set, ctx);
  const reply = policies.answer(adopter.reply, ctx);
  const open = !!latest && ['open', 'hold'].includes(latest.class);
  return {
    set: { ok: set.ok, why: set.ok ? null : adopter.words.set },
    reply: { ok: reply.ok && (!latest || open), why: !reply.ok ? adopter.words.reply : latest && !open ? adopter.words.closed : null }
  };
}

/** the latest row per subject (DISTINCT ON) with the first row of its current open run and the count of replies: ONE read */
async function latestRows(db, adopterKey, entity, ids) {
  const found = await db.query(
    `WITH latest AS (
       SELECT DISTINCT ON (subject_id) * FROM review_mark WHERE entity_id = $1::uuid AND adopter = $2 AND subject_id = ANY($3::text[]) ORDER BY subject_id, mark_id DESC)
     SELECT l.*, (SELECT min(r.at) FROM review_mark r WHERE r.entity_id = l.entity_id AND r.adopter = l.adopter AND r.subject_id = l.subject_id AND r.class IN ('open', 'hold')
                    AND r.mark_id > COALESCE((SELECT max(c.mark_id) FROM review_mark c WHERE c.entity_id = l.entity_id AND c.adopter = l.adopter AND c.subject_id = l.subject_id AND c.class IN ('clear', 'reject')), 0)) AS open_since,
            (SELECT count(*) FROM chit_messages m WHERE m.entity_id = l.entity_id AND m.subject_type = 'mark' AND m.subject_id = l.thread_id) AS message_count
       FROM latest l`,
    [entity, adopterKey, ids]
  );
  return found.rows;
}

/** the Mark object of a latest row, with what the subject is now */
function markOf(adopter, adopterKey, row, now, ctx) {
  const verdict = detect.compareSeal(row.seal, now && now.seal);
  const open = ['open', 'hold'].includes(row.class);
  const since = open ? row.open_since || row.at : null;
  const word = Object.values(adopter.vocabulary).find((entry) => entry.class === row.class && entry.label) || {};
  const kindWord = adopter.vocabulary[row.kind] || word;
  return {
    mark_id: String(row.mark_id),
    adopter: adopterKey,
    subject_id: row.subject_id,
    thread_id: row.thread_id,
    kind: row.kind,
    class: row.class,
    label: kindWord.label,
    note: row.note || null,
    at: isoOf(row.at),
    by_name: row.by_name || null,
    by_firm: row.by_entity_id && String(row.by_entity_id) !== String(row.entity_id) ? row.by_entity_name || null : null,
    open,
    open_since: since ? isoOf(since) : null,
    age_days: since ? Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / DAY_MS)) : null,
    altered: verdict.altered,
    altered_by: verdict.altered && now && now.successor ? { entry_id: now.successor.id, entry_no: now.successor.no, at: isoOf(now.successor.at), by_name: now.successor.who_name || null } : null,
    recheck_needed: verdict.recheck_needed,
    message_count: Number(row.message_count || 0),
    actions: actionsOf(adopter, ctx, row)
  };
}

/** the identity names behind `who` ids of successors (the people who made the later rows), read once; a name that cannot be read stays null */
async function nameSuccessors(db, entity, nowMap) {
  const ids = [...new Set([...nowMap.values()].map((now) => now.successor && now.successor.who).filter(Boolean))];
  if (!ids.length) return;
  let names = new Map();
  try {
    await db.query('SAVEPOINT mark_names');
    const found = await boundRead(db.query.as ? db.query : db.query.bind(db), entity, 'SELECT identity_id::text AS id, display_name FROM identities WHERE identity_id = ANY($1::uuid[])', [ids]); /* SEC-185: the caller's own handle (already bound to the scope the door chose) — the one bound reader */
    await db.query('RELEASE SAVEPOINT mark_names');
    names = new Map(found.rows.map((row) => [row.id, row.display_name]));
  } catch (err) {
    await db.query('ROLLBACK TO SAVEPOINT mark_names').catch(require('./logger').orElse('marks: the rollback after the names read failed', undefined));
    require('./logger').fellBack('marks: the who-names could not be read — the successor shows no name', err);
  }
  for (const now of nowMap.values()) if (now.successor) now.successor.who_name = names.get(String(now.successor.who)) || null;
}

/**
 * marksFor(db, adopterKey, entity, ids, ctx) → { marks: { id: Mark | null }, not_found: [id] }
 * One read for the whole list. A mark whose latest class is `removed` reads as null. An id the entity has no record for is `not_found` (and no mark).
 */
async function marksFor(db, adopterKey, entity, ids, ctx) {
  const adopter = adopterOf(adopterKey);
  if (!adopter) throw said('MARK_ADOPTER_UNKNOWN', 422);
  const unique = [...new Set(ids.map(String))];
  const marks = {};
  for (const id of unique) marks[id] = null;
  if (!unique.length) return { marks, not_found: [] };
  const rows = await latestRows(db, adopterKey, entity, unique).catch((err) => { throw fromDb(err); });
  if (!rows.length) return { marks, not_found: [] };
  const live = rows.filter((row) => row.class !== 'removed');
  const now = await detect.subjectsNow(db, adopter, entity, live.map((row) => row.subject_id));
  await nameSuccessors(db, entity, now);
  const missing = [];
  for (const row of live) {
    const here = now.get(row.subject_id);
    if (!here || !here.found) { missing.push(row.subject_id); continue; }
    marks[row.subject_id] = markOf(adopter, adopterKey, row, here, ctx);
  }
  return { marks, not_found: missing };
}

/**
 * the two reads of the "checked n of m" count, as SQL text (coverageSql) and the step after them (coverageFrom): coverage() runs them one after the other, the practice read sends the SAME texts in its one batch per client.
 * of: $1 entity, $2 from, $3 to · cleared: $1 entity, $2 adopter key, $3 from, $4 to. null when the adopter's subject has no date (no count).
 */
function coverageSql(adopter) {
  const { subject } = adopter;
  const table = subject.table, id = subject.id, date = subject.date;
  /* a uuid key: the id text is read as a uuid in the CTE's SELECT LIST, so the join is a plain uuid = uuid the key index serves. In the join itself the cast (not leakproof) could not be an index condition under row security (measured 0.65 to 2.15 ms per client, l17 speed) */
  const uuid = subject.id_type === 'uuid';
  const keyIs = uuid ? `s.${id} = l.subject_key` : `s.${id}::text = l.subject_id`;
  const keyCol = uuid ? `, ${detect.uuidOf('subject_id')} AS subject_key` : '';
  if (!date) return null;
  return {
    of: `SELECT count(*)::int AS n FROM ${table} WHERE entity_id = $1::uuid AND ${date} BETWEEN $2::date AND $3::date`,
    cleared: `WITH latest AS (SELECT DISTINCT ON (subject_id) subject_id, class, seal${keyCol} FROM review_mark WHERE entity_id = $1::uuid AND adopter = $2 ORDER BY subject_id, mark_id DESC)
     SELECT l.subject_id, l.seal, to_char(s.${date}::date, 'YYYY-MM-DD') AS day FROM latest l JOIN ${table} s ON ${keyIs} AND s.entity_id = $1::uuid
      WHERE l.class = 'clear' AND s.${date} BETWEEN $3::date AND $4::date LIMIT 5000`
  };
}
/** the count from what the two reads answered and what the cleared entries are now (a seal that changed does not count) */
function coverageFrom(ofRows, clearedRows, now) {
  return { checked: stillCleared(clearedRows, now).length, of: ofRows[0].n };
}
/** the cleared entries that still read as they did when checked (a seal that changed does not count): the ONE rule behind every checked count, a whole period's and a month's (period choices) */
function stillCleared(clearedRows, now) {
  return clearedRows.filter((row) => { const here = now.get(row.subject_id); return here && here.found && !detect.compareSeal(row.seal, here.seal).altered; });
}
/** the period of the "checked n of m" count: [from, to] ISO days */
async function coverage(db, adopter, adopterKey, entity, from, to) {
  const sql = coverageSql(adopter);
  if (!sql) return { checked: null, of: null };
  const of = await db.query(sql.of, [entity, from, to]);
  const cleared = await db.query(sql.cleared, [entity, adopterKey, from, to]);
  const now = await detect.subjectsNow(db, adopter, entity, cleared.rows.map((row) => row.subject_id));
  return coverageFrom(of.rows, cleared.rows, now);
}

/** ⭐ THE ONE "STILL READS" FILTER (MIS 0b): of these latest rows, the ones whose class is open or hold AND whose entry still reads; openList lists them, openCount counts them (never a second rule). → { rows, now } */
function stillOpenFrom(latest, now) {
  const open = latest.filter((row) => ['open', 'hold'].includes(row.class));
  return { rows: open.filter((row) => { const here = now.get(row.subject_id); return !!(here && here.found); }), now };
}
async function stillOpen(db, adopter, entity, latest) {
  const open = latest.filter((row) => ['open', 'hold'].includes(row.class));
  return stillOpenFrom(latest, await detect.subjectsNow(db, adopter, entity, open.map((row) => row.subject_id)));
}

/**
 * openList(db, adopterKey, entity, ctx, { from, to }) → { open: [Mark + subject_label + posting_date], total_open, oldest_age_days, checked, of }
 * Every item whose latest class is open or hold, oldest first (an item that was changed after it was marked stays until the reviewer decides).
 */
async function openList(db, adopterKey, entity, ctx, { from, to }) {
  const adopter = adopterOf(adopterKey);
  if (!adopter) throw said('MARK_ADOPTER_UNKNOWN', 422);
  const found = await db.query(
    `WITH latest AS (SELECT DISTINCT ON (subject_id) subject_id FROM review_mark WHERE entity_id = $1::uuid AND adopter = $2 ORDER BY subject_id, mark_id DESC)
     SELECT subject_id FROM latest`,
    [entity, adopterKey]
  ).catch((err) => { throw fromDb(err); });
  const ids = found.rows.map((row) => row.subject_id);
  const rows = ids.length ? await latestRows(db, adopterKey, entity, ids) : [];
  const { rows: open, now } = await stillOpen(db, adopter, entity, rows);
  await nameSuccessors(db, entity, now);
  const list = open.map((row) => { const here = now.get(row.subject_id); return Object.assign(markOf(adopter, adopterKey, row, here, ctx), { subject_label: here.label, posting_date: here.date }); });
  list.sort((first, second) => new Date(first.open_since) - new Date(second.open_since) || Number(first.mark_id) - Number(second.mark_id));
  const cover = await coverage(db, adopter, adopterKey, entity, from, to);
  return { open: list, total_open: list.length, oldest_age_days: list.length ? list[0].age_days : null, checked: cover.checked, of: cover.of };
}

/** the light read behind openCount ($1 entity, $2 adopter key): the latest row per entry that is open or held, with its thread; the practice read sends this SAME text in its batch */
const OPEN_LATEST_SQL = `SELECT * FROM (SELECT DISTINCT ON (subject_id) subject_id, class, thread_id FROM review_mark WHERE entity_id = $1::uuid AND adopter = $2 ORDER BY subject_id, mark_id DESC) l WHERE l.class IN ('open', 'hold')`;
/**
 * openCount(db, adopterKey, entity) → { open, thread_ids }: ONLY the count of the open and held items that still read (what openList's total_open says), for a caller that needs no list (the practice read, per client).
 * Light: the latest row per entry (class + thread, no ageing), then the SAME stillOpen filter as openList.
 */
async function openCount(db, adopterKey, entity) {
  const adopter = adopterOf(adopterKey);
  if (!adopter) throw said('MARK_ADOPTER_UNKNOWN', 422);
  const latest = await db.query(OPEN_LATEST_SQL, [entity, adopterKey]).catch((err) => { throw fromDb(err); });
  const { rows } = await stillOpen(db, adopter, entity, latest.rows);
  return { open: rows.length, thread_ids: rows.map((row) => row.thread_id) };
}

/** the words a mark needs, by the adopter's vocabulary: { word, note } or a refusal */
function wordOf(adopter, kind, note) {
  const word = Object.prototype.hasOwnProperty.call(adopter.vocabulary, kind) ? adopter.vocabulary[kind] : null;
  if (!word || (word.class === 'removed' && !adopter.allow_removed)) throw said('MARK_KIND_UNKNOWN', 422);
  const text = note == null ? '' : String(note).trim();
  if (text.length > NOTE_MAX) throw said('MARK_NOTE_TOO_LONG', 422);
  if (word.note === 'required' && !text) throw said('MARK_WORDS_REQUIRED', 422);
  if (word.note === 'none' && text) return { word, text: '' };
  return { word, text };
}

/**
 * set(db, ctx, { adopter, subject_id, subject_ids, kind, note }) → { mark, unchanged }
 * The ONE mark writer. `db` is the caller's open transaction: the policy, the seal read, review_mark_set and the door's onWrite hook all commit or roll back together.
 */
async function set(db, ctx, input) {
  const adopter = adopterOf(input.adopter);
  if (!adopter) throw said('MARK_ADOPTER_UNKNOWN', 422);
  await scopeTo(db, ctx, 'record');
  const ids = Array.isArray(input.subject_ids) ? input.subject_ids : [input.subject_id];
  if (ids.length > 1 && !adopter.bulk) throw said('MARK_BULK_NOT_ALLOWED', 422);
  const subjectId = String(ids[0] == null ? '' : ids[0]);
  const { word, text } = wordOf(adopter, input.kind, input.note);
  const allowed = policies.answer(adopter.set, ctx);
  if (!allowed.ok) throw refusal('MARK_NOT_ALLOWED', 403, adopter.words.set);
  const now = (await detect.subjectsNow(db, adopter, ctx.entity_id, [subjectId])).get(subjectId);
  if (!now || !now.found) throw refusal('MARK_SUBJECT_NOT_FOUND', 404, adopter.words.notFound);
  const before = (await latestRows(db, input.adopter, ctx.entity_id, [subjectId]).catch((err) => { throw fromDb(err); }))[0];
  if (before && before.kind === input.kind && (before.note || '') === text) {
    const same = (await marksFor(db, input.adopter, ctx.entity_id, [subjectId], ctx)).marks[subjectId];
    return { mark: same, unchanged: true };
  }
  if (!before && word.class === 'removed') throw said('MARK_KIND_UNKNOWN', 422);
  let row;
  await scopeTo(db, ctx, 'writer');
  try {
    const written = await db.query('SELECT * FROM review_mark_set($1::uuid, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::uuid, $10, $11::uuid, $12, $13, $14, $15, $16::uuid)', [
      ctx.entity_id, input.adopter, subjectId, input.kind, word.class, text || null, JSON.stringify(now.seal), adopter.change.how,
      ctx.real.identity_id, ctx.real.name || null, ctx.real.entity_id, ctx.real.entity_name || null, allowed.form, ctx.via.kind, ctx.via.id == null ? null : String(ctx.via.id), null
    ]);
    row = written.rows[0];
  } catch (err) {
    throw fromDb(err);
  }
  if (typeof ctx.onWrite === 'function') await ctx.onWrite(db, row);
  await scopeTo(db, ctx, 'record');
  const mark = (await marksFor(db, input.adopter, ctx.entity_id, [subjectId], ctx)).marks[subjectId];
  return { mark: mark || { mark_id: String(row.mark_id), adopter: input.adopter, subject_id: subjectId, thread_id: row.thread_id, kind: row.kind, class: row.class, label: word.label, note: row.note, at: isoOf(row.at), open: false }, unchanged: false };
}

/** the moment the LATEST Query of a thread was raised (marks oldest first); null when it never had one (every reply shows). A newer Query on the same entry starts a clean thread: the replies to an older one stay behind */
function currentRunStart(rows) {
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i].class === 'open') return isoOf(rows[i].at);
  return null;
}

/** threadOf(db, ctx, threadId) → { adopter, subject_id, subject_label, mark, history[], messages[] }; a thread of another business reads exactly like none (404) */
async function threadOf(db, ctx, threadId) {
  const rows = await db.query('SELECT * FROM review_mark WHERE thread_id = $1::uuid AND entity_id = $2::uuid ORDER BY mark_id', [threadId, ctx.entity_id]).catch((err) => { throw fromDb(err); });
  if (!rows.rows.length) throw said('MARK_THREAD_NOT_FOUND', 404);
  const last = rows.rows[rows.rows.length - 1];
  const adopter = adopterOf(last.adopter);
  if (!adopter) throw said('MARK_THREAD_NOT_FOUND', 404);
  const now = await detect.subjectsNow(db, adopter, ctx.entity_id, [last.subject_id]);
  await nameSuccessors(db, ctx.entity_id, now);
  const here = now.get(last.subject_id);
  if (!here || !here.found) throw said('MARK_THREAD_NOT_FOUND', 404);
  const latest = (await latestRows(db, last.adopter, ctx.entity_id, [last.subject_id]))[0];
  const history = rows.rows.map((row, index) => {
    const before = rows.rows[index - 1];
    const word = adopter.vocabulary[row.kind] || {};
    return { mark_id: String(row.mark_id), kind: row.kind, class: row.class, label: word.label || row.kind, note: row.note || null, at: isoOf(row.at), by_name: row.by_name || null,
      by_firm: String(row.by_entity_id) !== String(row.entity_id) ? row.by_entity_name || null : null, seal_changed_before: !!before && !!before.seal && !!row.seal && before.seal.hash !== row.seal.hash && JSON.stringify(before.seal.fields) === JSON.stringify(row.seal.fields) };
  });
  const since = currentRunStart(rows.rows); /* a thread shows the replies of the Query it is showing, never an older one's */
  const messages = await db.query(
    `SELECT message_id, sender_entity_id, sender_display_name, message_text, msg_type, created_at FROM chit_messages WHERE entity_id = $1::uuid AND subject_type = 'mark' AND subject_id = $2::uuid AND ($3::timestamptz IS NULL OR created_at >= $3::timestamptz) ORDER BY created_at, message_id`,
    [ctx.entity_id, threadId, since]
  );
  return {
    thread_id: threadId, adopter: last.adopter, subject_id: last.subject_id, subject_label: here.label,
    mark: last.class === 'removed' ? null : markOf(adopter, last.adopter, latest, here, ctx), history,
    messages: messages.rows.map((row) => ({ message_id: row.message_id, sender_display_name: row.sender_display_name, message_text: row.message_text, msg_type: row.msg_type, created_at: isoOf(row.created_at), mine: String(row.sender_entity_id) === String(ctx.real.entity_id) })),
    actions: actionsOf(adopter, ctx, latest)
  };
}

/** reply(db, ctx, threadId, { message_text, msg_type }) → { message, mark } through the ONE message writer; the class never changes */
async function reply(db, ctx, threadId, body) {
  await scopeTo(db, ctx, 'record');
  const rows = await db.query('SELECT * FROM review_mark WHERE thread_id = $1::uuid AND entity_id = $2::uuid ORDER BY mark_id DESC LIMIT 1', [threadId, ctx.entity_id]).catch((err) => { throw fromDb(err); });
  const latest = rows.rows[0];
  const adopter = latest && adopterOf(latest.adopter);
  if (!adopter) throw said('MARK_THREAD_NOT_FOUND', 404);
  const allowed = policies.answer(adopter.reply, ctx);
  if (!allowed.ok) throw refusal('MARK_REPLY_NOT_ALLOWED', 403, adopter.words.reply);
  if (!['open', 'hold'].includes(latest.class)) throw refusal('MARK_THREAD_CLOSED', 409, adopter.words.closed);
  const longer = messageLimit.tooLong(body.message_text);
  if (longer) throw longer;
  let posted;
  await scopeTo(db, ctx, 'writer');
  try {
    posted = await postMessage(db, { subject_type: 'mark', subject_id: threadId, sender_entity_id: ctx.real.entity_id, sender_display_name: ctx.real.name, message_text: body.message_text, msg_type: body.msg_type || 'info', via_kind: ctx.via.kind, via_id: ctx.via.id, by_policy: allowed.form });
  } catch (err) {
    throw fromDb(err);
  }
  if (typeof ctx.onWrite === 'function') await ctx.onWrite(db, latest);
  await scopeTo(db, ctx, 'record');
  const mark = (await marksFor(db, latest.adopter, ctx.entity_id, [latest.subject_id], ctx)).marks[latest.subject_id];
  return { message: { message_id: posted.message_id, sender_display_name: ctx.real.name, message_text: body.message_text, msg_type: body.msg_type || 'info', created_at: isoOf(posted.created_at), mine: true }, mark };
}

module.exports = { set, marksFor, openList, openCount, coverage, coverageSql, coverageFrom, stillCleared, stillOpenFrom, OPEN_LATEST_SQL, adopterOf, threadOf, reply, currentRunStart, actionsOf, vocabularyOf, refusal, said, fromDb, WORDS, CLOSING };
