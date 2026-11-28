'use strict';
// OWNS      THE AUDITOR'S BASELINE (rank 10, 17 Nov 2026): "Mark as checked" per person and client, and the ONE test of "changed since": a journal entry whose created_at is after the baseline (never posting_date: a back-dated entry has an old posting date and a new created_at, and that is the finding).
// CALLED BY lib/books-practice.js (the Home count, the corrected last look) · routes/books-grants.js (POST /practice/baseline) · routes/books.js (GET /daybook?since=mine)
// FLOW      baselinesOf (ONE read in the firm's transaction, before the per-client batch) → sinceFor (the client's baseline, else the grant start) → changedWhere in the practice statement AND in the Day book list (one predicate, so the Home count and the list total are the same number by construction)
// CARD      04-network/ACC-176-AUDITOR-GRANT
/**
 * ⭐ ONE HOME: books_review_baseline (b875), insert-only, in the FIRM's entity. Not review_mark (the client's own session reads that) and not the look log (the client reads that): the client never sees a baseline.
 * ⭐ AN EXPLICIT ACT: opening a book is not reviewing it, so a look never moves the baseline. The act sends back the watermark (`seen_to`) of what the screen listed; the server never stamps its own now() (an entry posted between the page load and the press stays counted).
 * ⭐ PER REAL PERSON, IN THE DATABASE: the table's policy holds identity_id = app.current_actor, and every read and the write also carry identity_id = the caller. Never shared between staff; the firm owner reads only its own rows.
 *   An auditor request runs as the client's synthetic identity, so the firm-side reads here run under reqctx.runWithActor(the REAL person).
 * ⭐ NOT MIGRATED (b875 not run): the count falls back to the grant start, the act answers 503 BOOKS_BASELINE_NOT_MIGRATED in words, never a 500.
 * The count includes the caller's own postings (the list names who posted); excluding them would be a second rule.
 */
const grants = require('./books-grant');
const schema = require('./schema');

const TABLE = 'books_review_baseline';
/** the pattern the practice list writes one look row per client under: written at books-practice, matched out of the Last look; ONE constant for both */
const LIST_READ = 'GET /practice';
const NOT_MIGRATED = 'BOOKS_BASELINE_NOT_MIGRATED';
const NOT_MIGRATED_WORDS = 'Marking a client as checked is not switched on yet. The count still works.';
const BAD_SEEN_TO = 'BOOKS_BASELINE_SEEN_TO';
const BAD_SEEN_TO_WORDS = 'That check point is not valid. Open the changed entries again, then press Mark as checked.';
const FIRM_ONLY = 'BOOKS_SINCE_FIRM_ONLY';
const FIRM_ONLY_WORDS = "'Since my last check' is for a firm reading a client's books. Open a client first.";
const NO_GRANT = 'BOOKS_GRANT_NONE';
const NO_GRANT_WORDS = 'No access has been given for these books.';

/** RC-8 (DECISIONS 19 Nov): independence per CLIENT and PERIOD (APES 110 / ISA 220): a person who prepared entries in this client's books since their last check point cannot sign them off as the auditor */
const SELF_PREPARED = 'BOOKS_SIGNOFF_SELF_PREPARED';
const SELF_PREPARED_WORDS = 'You prepared entries in these books since your last check, so you cannot sign them off as the auditor. Ask a colleague to check them.';

/** the ONE test of an entry changed since a moment: `alias` is the journal_entry alias, `param` the placeholder holding the moment (timestamptz) */
const changedWhere = (alias, param) => `${alias}.created_at > ${param}::timestamptz`;

const ready = () => schema.hasTable(TABLE);
const stamp = (value) => (value ? new Date(value).toISOString() : null);
/** a check point travels as TEXT with microseconds (the database's own precision): a JS Date keeps milliseconds, and a watermark rounded down would leave the newest entry counted as changed */
const MICROS = (column) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** the caller's newest check point of every client, ONE read: Map(client_entity → { seen_to, made_at }); the greatest seen_to wins, so a stale tab can never move a baseline back */
async function baselinesOf(execute, firm, person) {
  if (!person || !(await ready())) return new Map();
  const rows = (await execute(`SELECT client_entity::text AS client, ${MICROS('max(seen_to)')} AS seen_to, max(made_at) AS made_at FROM ${TABLE} WHERE entity_id = $1::uuid AND identity_id = $2::uuid GROUP BY client_entity`, [firm, person])).rows;
  return new Map(rows.map((row) => [row.client, { seen_to: row.seen_to, made_at: stamp(row.made_at) }]));
}

/** the check point of ONE client as a column of a query over books_access_grant (alias `g`): the caller's greatest seen_to, or NULL when b875 has not run. Riding the practice's own grants read keeps its trips unchanged ($1 = the firm, $2 = the person). */
const checkPointSql = (ready_, grantAlias) => (ready_ ? `(SELECT ${MICROS('max(b.seen_to)')} FROM ${TABLE} b WHERE b.entity_id = $1::uuid AND b.identity_id = $2::uuid AND b.client_entity = ${grantAlias}.grantor_entity)` : 'NULL::text');

/** the moment to count from: the person's own check point, else the start of the grant (then the words say "since access began"). → { at (ISO), never (no act yet) } */
function sinceFor(baselines, client, grantStart) {
  const own = baselines && baselines.get(String(client));
  return own ? { at: own.seen_to, never: false } : { at: stamp(grantStart), never: true };
}

/**
 * one client's live grant of the firm for these roles, read as the practice reads it: the row or null. The test is grants.liveAmong's (the verdict, then the assignment under switch `assigned`; never verdictOf called here), for ONE client.
 * `who` = { actor, owner } is REQUIRED: the real person behind the request and whether he is the firm's owner (absent owner = not the owner, fail closed), so an unassigned client answers null like an ended grant.
 */
async function liveGrantOf(execute, firm, client, roles, caller) {
  const rows = (await execute(`SELECT g.grant_id, g.grantor_entity::text AS grantor_entity, g.grantee_entity, g.preset, g.granted_at, g.revoked_at, ${grants.stateColumnsSql('g')}
      FROM books_access_grant g WHERE g.grantee_entity = $1::uuid AND g.grantor_entity = $2::uuid ORDER BY g.granted_at DESC`, [firm, client])).rows.filter((row) => roles.includes(row.preset));
  const { kept } = await grants.liveAmong({ query: execute }, rows, { method: 'GET', listed: true, actor: caller && caller.actor, owner: !!(caller && caller.owner), manager: !!(caller && caller.manager) });
  return kept[0] || null;
}

/**
 * RC-8: refuse the AUDIT sign-off of a person who prepared in this client's period: an entry of this client with created_by = the person, made after their previous check point (else ever) and up to the check point they now sign.
 * Only a person acting as the auditor is held to it (the accountant seat marking their own work is not an audit sign-off). The entry's own maker is read as the client (one boolean), never listed.
 */
async function refuseOwnWork(execute, firm, client, person, roles, seenTo) {
  if (!(roles || [grants.AUDITOR]).includes(grants.AUDITOR)) return;
  const previous = (await baselinesOf(execute, firm, person)).get(String(client));
  const prepared = await grants.asEntity(client, async (transaction) => (await transaction.query('SELECT 1 FROM journal_entry WHERE entity_id = $1::uuid AND created_by = $2::uuid AND created_at <= $3::timestamptz AND ($4::timestamptz IS NULL OR created_at > $4::timestamptz) LIMIT 1', [client, person, String(seenTo), previous ? previous.seen_to : null])).rows.length > 0);
  if (prepared) throw grants.refusal(SELF_PREPARED, 403, SELF_PREPARED_WORDS);
}

/**
 * "Mark as checked": store the check point (the watermark the screen showed) for this person and client. The firm's own binding, ONE transaction, NO look row (a look row would show the baseline to the client).
 * seen_to must not be after the server clock: judged in the INSERT itself (the same now() the table's own CHECK uses), so no clock skew can turn a valid act into a 500.
 * → { client, seen_to, made_at } · refusals in words: 503 not migrated · 403 no live grant · 400 seen_to missing, unreadable or in the future
 */
async function setBaseline(firm, client, person, seenTo, roles, owner, manager) {
  if (!grants.UUID.test(String(client || ''))) throw grants.refusal(NO_GRANT, 403, NO_GRANT_WORDS);
  const when = Date.parse(String(seenTo));
  if (!seenTo || Number.isNaN(when)) throw grants.refusal(BAD_SEEN_TO, 400, BAD_SEEN_TO_WORDS);
  if (!(await ready())) throw grants.refusal(NOT_MIGRATED, 503, NOT_MIGRATED_WORDS);
  return grants.asEntity(firm, async (transaction) => {
    const execute = transaction.query.bind(transaction);
    if (!(await liveGrantOf(execute, firm, client, roles || [grants.AUDITOR, grants.ADVISER], { actor: person, owner, manager }))) throw grants.refusal(NO_GRANT, 403, NO_GRANT_WORDS);
    await refuseOwnWork(execute, firm, client, person, roles, seenTo);
    const made = await execute(`INSERT INTO ${TABLE} (entity_id, client_entity, identity_id, seen_to) SELECT $1::uuid, $2::uuid, $3::uuid, $4::timestamptz WHERE $4::timestamptz <= now() RETURNING ${MICROS('seen_to')} AS seen_to, made_at`, [firm, client, person, String(seenTo)]);
    if (!made.rows.length) throw grants.refusal(BAD_SEEN_TO, 400, BAD_SEEN_TO_WORDS);
    return { client, seen_to: made.rows[0].seen_to, made_at: stamp(made.rows[0].made_at) };
  });
}

/** the baseline of the person behind a request that acts under a grant (the Day book `since=mine`): { at, never }; read in the firm's own binding, never from the request */
async function sinceOfRequest(req, client) {
  const real = req.realIdentity;
  if (!real || !req.acting_for_grant) throw grants.refusal(FIRM_ONLY, 400, FIRM_ONLY_WORDS);
  const firm = real.parent_entity_id || real.identity_id;
  return require('./reqctx').runWithActor(real.identity_id, () => grants.asEntity(firm, async (transaction) => {
    const execute = transaction.query.bind(transaction);
    const start = await grants.startOf(execute, req.acting_for_grant, firm);
    return sinceFor(await baselinesOf(execute, firm, real.identity_id), client, start && start.granted_at);
  }));
}

/**
 * the Day book's "changed since" page, newest posted first: the entry ids of one page (created_at DESC, entry_id DESC), the total by the SAME predicate as the Home count, and the watermark `seen_to`:
 * the newest created_at of ALL the client's entries in this read (so an entry posted after the read is never behind it), else the read's own time. ONE statement, one snapshot.
 * → { ids, total, seen_to }
 */
async function changedPage(h, client, sinceAt, limit, page) {
  const row = (await h.query(`SELECT
      COALESCE((SELECT array_agg(p.entry_id ORDER BY p.created_at DESC, p.entry_id DESC) FROM (SELECT e.entry_id, e.created_at FROM journal_entry e WHERE e.entity_id = $1::uuid AND ${changedWhere('e', '$2')} ORDER BY e.created_at DESC, e.entry_id DESC LIMIT $3 OFFSET $4) p), '{}') AS ids,
      (SELECT count(*)::int FROM journal_entry e WHERE e.entity_id = $1::uuid AND ${changedWhere('e', '$2')}) AS total,
      ${MICROS('COALESCE((SELECT max(e.created_at) FROM journal_entry e WHERE e.entity_id = $1::uuid), now())')} AS seen_to`, [client, sinceAt, limit, Math.max(0, (page - 1) * limit)])).rows[0];
  return { ids: row.ids, total: Number(row.total), seen_to: row.seen_to };
}

module.exports = { SELF_PREPARED, checkPointSql, TABLE, LIST_READ, NOT_MIGRATED, BAD_SEEN_TO, FIRM_ONLY, changedWhere, ready, baselinesOf, sinceFor, liveGrantOf, setBaseline, sinceOfRequest, changedPage };
