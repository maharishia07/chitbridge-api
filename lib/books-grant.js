'use strict';
/**
 * lib/books-grant.js — THE GRANT OF READ-ONLY BOOKS (ACC-176): a member store's owner lets its network parent read its books, and every look is recorded.
 * OWNS      the two tables of migrations/b863 (books_access_grant, books_access_log): give · change · revoke · list · the look (find the live grant, decide, write the log row) · the member's list of looks.
 * CALLED BY middleware/books-grant.js (the books router's acting-for middleware) · routes/books-grants.js (the member's grant, revoke and list routes).
 * FLOW      look(): ONE withEntity as the grantee → one SELECT (the latest grant of the pair + the live edge, lib/network-membership isGrantParentSql) → the verdict → ONE insert in books_access_log → commit;
 *           no log row, no read (the write fails CLOSED). give/change/revoke: one withEntity as the member → the row + its access_events row (lib/access-events.record) in the SAME transaction; a lost event row rolls the change back.
 * CARD      04-network/ACC-176-AUDITOR-GRANT
 * ⚠️ THE EDGE IS READ, NEVER COPIED: the grant is live only while an active, non-suspended edge makes the grantee the network parent of the grantor (isGrantParentSql: built under it and standing, or an active commercial edge).
 *    Disconnect or suspend ends access on the very next request with no second write; nothing is cached.
 * ⚠️ NOT MIGRATED (b863 not run) is a typed refusal in words (BOOKS_GRANT_NOT_SWITCHED_ON, 503), never a 500 and never a read of the member's books.
 * ⚠️ identities, cb_entity and cb_edge are read by the existing network reader (isGrantParentSql); when identities take row security (SEC-185) that one statement moves to its bound reader, here and in catalogue-build.
 */
const db = require('../db');
const { withEntity } = db;
const { boundRead } = require('./bound-read');
const { isGrantParentSql } = require('./network-membership');
const { record } = require('./access-events');

const NOT_ON = 'BOOKS_GRANT_NOT_SWITCHED_ON';
const NOT_ON_WORDS = 'Access for your auditor is not switched on yet.';
const MONTH_MS = 30.4375 * 24 * 3600 * 1000;
const DEFAULT_MONTHS = 12;
const MAX_MONTHS = 36;
const DEFAULT_PURPOSE = 'audit of the books';
/** the two roles a store can hand its network parent, kept apart (Athi 14 Nov): `auditor` reviews (read only, always), `adviser` is the firm's team acting for the owner (ACC-176b); a store may hold both as two grants */
const AUDITOR = 'auditor';
const ADVISER = 'adviser';
const PRESETS = [AUDITOR, ADVISER];
const ADVISER_NOT_ON_WORDS = 'Access for your adviser is not switched on yet.';
/** have the adviser columns (b866) been run: the one marker every adviser path asks, so the api is correct before and after the file runs */
/** liveGrantSql(alias) → the ONE SQL test of a live grant: not revoked and not past its end (the database clock). Every reader that asks 'is this grant open now' uses it (Fable review R1, 18 Nov); the alias is the table alias with its dot, e.g. liveGrantSql('g') → 'g.revoked_at IS NULL AND g.expires_at > now()' */
const liveGrantSql = (alias) => { const p = alias ? alias + '.' : ''; return p + 'revoked_at IS NULL AND ' + p + 'expires_at > now()'; };
const roleColumnsReady = () => require('./schema').hasColumn('books_access_log', 'preset');
/** the role a grant is asked for: the auditor unless the request names the adviser; anything else names no grant */
const roleOf = (named) => (named == null || named === '' ? AUDITOR : PRESETS.includes(String(named).toLowerCase()) ? String(named).toLowerCase() : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** a typed refusal the route and the middleware turn into a Problem: { code, status, words } */
function refusal(code, status, words) {
  return Object.assign(new Error(words), { code, status, words });
}
/** the migration is not run: the missing table says so in words */
function wrapMissing(err) {
  if (err && (err.code === '42P01' || err.code === '42703')) return refusal(NOT_ON, 503, NOT_ON_WORDS);
  return err;
}
/** run fn as `entity` in one transaction; a missing table (b863 not run) becomes the typed NOT_ON refusal */
async function asEntity(entity, fn) {
  try {
    return await withEntity(entity, fn);
  } catch (err) {
    throw wrapMissing(err);
  }
}

/** the expiry of a new or edited grant: the member's date, or 12 months from now; never past, never more than 36 months */
function expiryOf(given, now) {
  const at = now || new Date();
  const ceiling = new Date(at.getTime() + MAX_MONTHS * MONTH_MS);
  const date = given == null || given === '' ? new Date(at.getTime() + DEFAULT_MONTHS * MONTH_MS) : new Date(given);
  if (Number.isNaN(date.getTime()) || date <= at) throw refusal('BOOKS_GRANT_EXPIRY_INVALID', 422, 'Pick an end date in the future.');
  if (date > ceiling) throw refusal('BOOKS_GRANT_EXPIRY_INVALID', 422, 'Access can run for at most ' + MAX_MONTHS + ' months at a time.');
  return date;
}
/** the purpose in the member's words (3 to 300 characters); empty means the plain default */
function purposeOf(given) {
  const text = given == null ? '' : String(given).trim();
  if (!text) return DEFAULT_PURPOSE;
  if (text.length < 3 || text.length > 300) throw refusal('BOOKS_GRANT_PURPOSE_INVALID', 422, 'Say why in 3 to 300 characters.');
  return text;
}

/** who posts under an adviser grant is the OWNER'S choice, made when the grant is given and asked there (nothing is pre-selected): the adviser posts for the owner, or the owner approves each post */
const POSTINGS = ['owner_approves', 'adviser_posts'];
const POSTING_COLUMNS = ', posting, posting_cap_minor, posting_cap_currency';
function postingOf(input, required) {
  const given = input.posting;
  if (given === undefined || given === null) {
    if (required) throw refusal('BOOKS_GRANT_POSTING_NEEDED', 422, 'Say who posts: your adviser posts for you, or you approve each post.');
    return undefined;
  }
  if (!POSTINGS.includes(given)) throw refusal('BOOKS_GRANT_POSTING_INVALID', 422, 'Pick: your adviser posts for you, or you approve each post.');
  return given;
}
/** the optional ceiling per entry above which the owner still accepts: a whole number of minor units WITH its currency, both or none; null = no ceiling */
function capOf(input) {
  const minor = input.posting_cap_minor, currency = input.posting_cap_currency;
  if ((minor == null) !== (currency == null)) throw refusal('BOOKS_GRANT_CAP_INVALID', 422, 'Give the limit and its currency together.');
  if (minor == null) return null;
  if (!Number.isInteger(minor) || minor <= 0 || !/^[A-Z]{3}$/.test(String(currency))) throw refusal('BOOKS_GRANT_CAP_INVALID', 422, 'The limit is a positive amount with its currency.');
  return { minor, currency };
}
const GRANT_COLUMNS = 'grant_id, grantor_entity, grantee_entity, preset, can_see_costs, purpose, granted_by, granted_at, expires_at, revoked_at, revoked_by';
/** the access_events row of a grant change (lib/access-events.record: before and after); false rolls the whole change back */
async function recordEvent(transaction, row, action, before, after, by) {
  const written = await record((sql, params) => transaction.query(sql, params), { entity_id: row.grantor_entity, subject_identity_id: row.grantee_entity, action, before, after, changed_by: by, reason: row.purpose });
  if (!written) throw refusal('BOOKS_GRANT_NOT_RECORDED', 503, 'We could not record this change, so nothing was changed. Try again.');
}
/** what the log of a grant keeps of it: the terms, never more */
const termsOf = (row) => ({ grant_id: row.grant_id, grantee_entity: row.grantee_entity, preset: row.preset, can_see_costs: row.can_see_costs, purpose: row.purpose, expires_at: row.expires_at, revoked_at: row.revoked_at || null, posting: row.posting || null, posting_cap_minor: row.posting_cap_minor || null, posting_cap_currency: row.posting_cap_currency || null });

/**
 * give(grantor, by, { grantee, purpose, expires_at, can_see_costs }) → the new grant row. The grantee must be the network parent of the grantor NOW (the same edge test every request asks);
 * one open grant per pair (a second is 409). The access_events row is written in the same transaction.
 */
async function give(grantor, by, input) {
  const grantee = String(input.grantee || '');
  const preset = roleOf(input.preset);
  if (!preset) throw refusal('BOOKS_GRANT_PRESET_INVALID', 422, 'Pick auditor or adviser.');
  if (preset === ADVISER && !(await roleColumnsReady())) throw refusal(NOT_ON, 503, ADVISER_NOT_ON_WORDS);
  if (!UUID.test(grantee) || grantee === String(grantor)) throw refusal('BOOKS_GRANT_NO_PARENT', 422, 'Pick the business in your network that audits you.');
  const expires = expiryOf(input.expires_at);
  const purpose = purposeOf(input.purpose);
  return asEntity(grantor, async (transaction) => {
    const live = await transaction.query(`SELECT ${isGrantParentSql('$1::text', '$2::text')} AS member`, [grantee, String(grantor)]);
    if (!live.rows[0] || live.rows[0].member !== true) throw refusal('BOOKS_GRANT_NO_PARENT', 422, 'That business is not your network parent, so it cannot be given your books.');
    /* BB-F-06: the grantee is judged BEFORE who posts - a grant to a business that is not your parent said "Say who posts" first */
    const posting = preset === ADVISER ? postingOf(input, true) : undefined;
    const ceiling = preset === ADVISER ? capOf(input) : null;
    const open = await transaction.query('SELECT 1 FROM books_access_grant WHERE grantor_entity = $1 AND grantee_entity = $2 AND preset = $3 AND ' + liveGrantSql(), [grantor, grantee, preset]);
    if (open.rows.length) throw refusal('BOOKS_GRANT_EXISTS', 409, 'This business can already read your books. Change the end date instead.');
    await transaction.query('UPDATE books_access_grant SET revoked_at = now(), revoked_by = $4 WHERE grantor_entity = $1 AND grantee_entity = $2 AND preset = $3 AND revoked_at IS NULL', [grantor, grantee, preset, by]); /* an expired open row of the same role makes room for the new one */
    await require('./books-action').withdrawEnded(transaction, grantor, by); /* what the expired grant left open is closed 'withdrawn: grant expired', in this same transaction */
    const plain = [grantor, grantee, preset, input.can_see_costs !== false, purpose, by, expires];
    const made = preset === ADVISER
      ? await transaction.query(`INSERT INTO books_access_grant (grantor_entity, grantee_entity, preset, can_see_costs, purpose, granted_by, expires_at, posting, posting_cap_minor, posting_cap_currency) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING ${GRANT_COLUMNS}${POSTING_COLUMNS}`, [...plain, posting, ceiling && ceiling.minor, ceiling && ceiling.currency])
      : await transaction.query(`INSERT INTO books_access_grant (grantor_entity, grantee_entity, preset, can_see_costs, purpose, granted_by, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${GRANT_COLUMNS}`, plain);
    await recordEvent(transaction, made.rows[0], 'books_grant_given', null, termsOf(made.rows[0]), by);
    return Object.assign({}, made.rows[0], { warnings: await bothRolesWarning(transaction, grantor, grantee, preset) });
  });
}

/**
 * the firm already holds the OTHER role on this store: said at grant time, never a block (whether one firm may audit a store and post in it is for the owner and the firm's own rules; accepting does not cure a conflict of interest,
 * and nothing on a screen claims independence).
 */
async function bothRolesWarning(transaction, grantor, grantee, preset) {
  const other = await transaction.query('SELECT 1 FROM books_access_grant WHERE grantor_entity = $1 AND grantee_entity = $2 AND preset <> $3 AND ' + liveGrantSql(), [grantor, grantee, preset]);
  return other.rows.length ? [{ code: 'BOTH_ROLES_ONE_FIRM', words: 'This business already holds the other kind of access to your books. It will both review your books and prepare entries in them. Make sure that is what you want.' }] : [];
}
/** one grant of this member that is still open (not revoked), locked for the change */
async function openOf(transaction, grantor, grantId) {
  const found = await transaction.query(`SELECT ${GRANT_COLUMNS} FROM books_access_grant WHERE grant_id = $1 AND grantor_entity = $2 AND revoked_at IS NULL FOR UPDATE`, [UUID.test(String(grantId)) ? grantId : null, grantor]);
  if (!found.rows[0]) throw refusal('NOT_FOUND', 404, 'There is no open access with that number.');
  return found.rows[0];
}
/** change(grantor, by, grantId, { expires_at }) → the grant: the member edits the end date (the purpose is fixed at the grant: no UPDATE privilege on it); before and after go to access_events */
async function change(grantor, by, grantId, input) {
  return asEntity(grantor, async (transaction) => {
    const before = await openOf(transaction, grantor, grantId);
    const expires = input.expires_at === undefined ? before.expires_at : expiryOf(input.expires_at);
    const after = (await transaction.query(`UPDATE books_access_grant SET expires_at = $2 WHERE grant_id = $1 RETURNING ${GRANT_COLUMNS}`, [before.grant_id, expires])).rows[0];
    if (before.preset === ADVISER) await changePosting(transaction, before, after, input);
    await recordEvent(transaction, after, 'books_grant_changed', termsOf(before), termsOf(after), by);
    return after;
  });
}
/** the posting columns after a change: what the owner sent, else what the row holds (a ceiling of null clears it, undefined leaves it) */
function postingAfter(now, posting, ceiling) {
  const keepCeiling = ceiling === undefined;
  return {
    posting: posting === undefined ? now.posting : posting,
    minor: keepCeiling ? now.posting_cap_minor : ceiling && ceiling.minor,
    currency: keepCeiling ? now.posting_cap_currency : ceiling && ceiling.currency
  };
}
/** the owner's later change of who posts, or of the ceiling, on an ADVISER grant (the same transaction as the end date; one UPDATE on the three columns the owner may change); it is read from the row on the very next request */
async function changePosting(transaction, before, after, input) {
  const posting = postingOf(input, false);
  const capGiven = input.posting_cap_minor !== undefined || input.posting_cap_currency !== undefined;
  if (posting === undefined && !capGiven) return;
  const ceiling = capGiven ? capOf(input) : undefined;
  const now = (await transaction.query('SELECT posting, posting_cap_minor, posting_cap_currency FROM books_access_grant WHERE grant_id = $1', [before.grant_id])).rows[0];
  const next = postingAfter(now, posting, ceiling);
  await transaction.query('UPDATE books_access_grant SET posting = $2, posting_cap_minor = $3, posting_cap_currency = $4 WHERE grant_id = $1', [before.grant_id, next.posting, next.minor, next.currency]);
  Object.assign(after, { posting: next.posting, posting_cap_minor: next.minor, posting_cap_currency: next.currency });
  Object.assign(before, { posting: now.posting, posting_cap_minor: now.posting_cap_minor, posting_cap_currency: now.posting_cap_currency });
}
/** revoke(grantor, by, grantId) → the revoked grant; the very next request of the grantee is refused (nothing is cached) */
async function revoke(grantor, by, grantId) {
  return asEntity(grantor, async (transaction) => {
    const before = await openOf(transaction, grantor, grantId);
    const after = (await transaction.query(`UPDATE books_access_grant SET revoked_at = now(), revoked_by = $2 WHERE grant_id = $1 RETURNING ${GRANT_COLUMNS}`, [before.grant_id, by])).rows[0];
    await recordEvent(transaction, after, 'books_grant_revoked', termsOf(before), termsOf(after), by);
    const withdrawn = await require('./books-action').withdrawEnded(transaction, grantor, by); /* what the firm left open is closed 'withdrawn: grant revoked', in this same transaction */
    return Object.assign({}, after, { actions_withdrawn: withdrawn });
  });
}

/** list(entity) → { given: the grants this business gave, received: the grants it holds, each with whether the edge keeps it live right now } (row security shows each side its own) */
/**
 * the businesses this member can give access to: its network PARENTS, whether it is a store built under them (a governance edge) or one that joined (a commercial edge), the same edges isGrantParentSql reads;
 * read under the member's own binding so the owner's grant screen needs no catalogue visibility and no membership list
 */
async function list(entity) {
  /* ONE trip, ONE bound statement (boundRead: identities are read under the member's own binding, SEC-185 sweep): the grants and the parents ride one UNION, told apart by `kind`; a column the other kind lacks is a typed NULL
     (the column's own type, so no value is cast). The adviser columns are read through to_jsonb, so the same statement is right before and after b866 runs with no schema probe (a hasColumn trip a request): the identities columns are read BY NAME (SEC-186 revoked the credential columns, so a whole-row to_jsonb(i) answers 42501 and the client list 500s; is_test is in the baseline schema); a column the file
     has not added reads null; ->> keeps the text a bigint arrives as. grantor_name: the shop's name kept beside the grant it gave, so a firm's client list needs no catalogue visibility */
  const typed = (column) => `(SELECT ${column} FROM books_access_grant WHERE false)`;
  let read;
  try {
    read = await boundRead(db.query, entity, `SELECT * FROM (
      SELECT 'grant' AS kind, g.grant_id, g.grantor_entity, g.grantee_entity, g.preset, g.can_see_costs, g.purpose, g.granted_at, g.expires_at, g.revoked_at,
        to_jsonb(g) ->> 'posting' AS posting, to_jsonb(g) ->> 'posting_cap_minor' AS posting_cap_minor, to_jsonb(g) ->> 'posting_cap_currency' AS posting_cap_currency,
        (SELECT display_name FROM identities WHERE identity_id = g.grantor_entity) AS grantor_name,
        (SELECT is_test::text FROM identities WHERE identity_id = g.grantor_entity) AS grantor_is_test, (SELECT country FROM identities WHERE identity_id = g.grantor_entity) AS grantor_country,
        ${isGrantParentSql('g.grantee_entity::text', 'g.grantor_entity::text')} AS edge_live, NULL::text AS entity_id, NULL::text AS name
      FROM (SELECT * FROM books_access_grant ORDER BY granted_at DESC LIMIT 200) g
      UNION ALL
      SELECT 'parent', ${['grant_id', 'grantor_entity', 'grantee_entity', 'preset', 'can_see_costs', 'purpose', 'granted_at', 'expires_at', 'revoked_at'].map(typed).join(', ')}, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::boolean,
        p.entity_id, p.name
      FROM (SELECT i.identity_id::text AS entity_id, i.display_name AS name FROM identities me JOIN cb_entity c ON c.bridge_id = me.bridge_id JOIN cb_edge g ON g.child_id = c.id AND g.state = 'active' AND g.type IN ('governance', 'commercial', 'agency') JOIN cb_entity p ON p.id = g.parent_id JOIN identities i ON i.bridge_id = p.bridge_id WHERE me.identity_id = $1::uuid GROUP BY i.identity_id, i.display_name ORDER BY i.display_name) p
    ) u ORDER BY u.kind, u.granted_at DESC, u.name`, [entity]);
  } catch (err) {
    throw wrapMissing(err);
  }
  const unkind = (row) => { const { kind, entity_id: entityId, name, ...rest } = row; return kind === 'grant' ? rest : { entity_id: entityId, name }; };
  const grantRows = read.rows.filter((row) => row.kind === 'grant').map(unkind);
  const parents = read.rows.filter((row) => row.kind === 'parent').map(unkind);
  const state = (row) => (row.revoked_at ? 'revoked' : new Date(row.expires_at) <= new Date() ? 'expired' : row.edge_live ? 'live' : 'edge_off');
  const shaped = grantRows.map((row) => Object.assign({}, row, { state: state(row) }));
  return { given: shaped.filter((row) => String(row.grantor_entity) === String(entity)), received: shaped.filter((row) => String(row.grantee_entity) === String(entity)), parents };
}

/** the member's list of looks at its own books, newest first: { at, grant_id, grantee_entity, actor_identity_id, route_pattern, query_shape, status, outcome } */
async function looks(grantor, { limit, grant_id: grantId } = {}) {
  const rowCap = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  /* the role, the person's name and the firm were kept AT THE LOOK (b866): read through to_jsonb so the same statement is right before and after the file runs, with no schema trip */
  const named = "to_jsonb(l) ->> 'preset' AS preset, to_jsonb(l) ->> 'actor_name' AS actor_name, to_jsonb(l) ->> 'actor_entity_name' AS actor_entity_name";
  return asEntity(grantor, async (transaction) => {
    const wanted = grantId && UUID.test(String(grantId)) ? grantId : null;
    const rows = await transaction.query(`SELECT at, grant_id, grantee_entity, actor_identity_id, ${named}, route_pattern, query_shape, status, outcome FROM books_access_log l WHERE grantor_entity = $1 AND ($2::uuid IS NULL OR grant_id = $2) ORDER BY at DESC, log_id DESC LIMIT $3`, [grantor, wanted, rowCap]);
    return rows.rows;
  });
}

/**
 * look(grantee, member, request) → { allowed, grant, outcome, status, code, words }: the one decision of a request that names a member's books.
 *   request = { actor, pattern, method, listed, query_shape }; the grantee's own binding reads the grant (row security: a grantee sees its grants), the log row is written in the SAME transaction.
 * outcomes: allowed · no_grant · revoked · expired · edge_off (disconnected or suspended) · not_listed · read_only. A failed log write throws (503): no log row, no read.
 */
const WORDS = {
  no_grant: ['BOOKS_GRANT_NONE', 403, 'No access has been given for these books.'],
  revoked: ['BOOKS_GRANT_ENDED', 403, 'This access was ended by the owner of the books.'],
  expired: ['BOOKS_GRANT_ENDED', 403, 'This access has run out. Ask the owner of the books to renew it.'],
  edge_off: ['BOOKS_GRANT_NOT_LIVE', 403, 'You are no longer connected to this business, so its books are closed to you.'],
  not_listed: ['GRANT_ROUTE_NOT_LISTED', 403, 'This is not part of this access.'],
  read_only: ['GRANT_READ_ONLY', 403, 'An auditor can read these books, never change them.'],
  not_migrated: ['BOOKS_GRANT_NOT_SWITCHED_ON', 503, 'Adviser bank work is not switched on yet. The owner adds these lines for now.'],
  not_assigned: ['BOOKS_GRANT_NOT_ASSIGNED', 403, 'This client is not assigned to you. Ask the partner to assign it.'],
  not_posting: ['ADVISER_POSTING_NOT_ALLOWED', 403, 'The owner has not let you post straight into these books. Prepare a journal for the owner to accept instead.'],
  posting_capped: ['ADVISER_POSTING_CAPPED', 403, 'The owner set a limit on what you may post alone, so bank lines cannot be added from here. Ask the owner to add them or to lift the limit.']
};
/** BB-F-04: the words of a refused WRITE to a client's chit thread, in the seat of the one who asked (an adviser is never told it is 'an auditor'); both seats read the thread and neither posts to it (RC-11, docs/SEAT-MATRIX.md has no chit-thread door for either) */
const threadReadOnlyWords = (role) => 'This conversation is open to ' + (role === ADVISER ? 'an adviser' : 'an auditor') + ' to read, not to write in. Nothing was done.';
/** the outcome word of one request against the latest grant row of the pair */
function verdictOf(row, request) {
  if (!row) return 'no_grant';
  if (row.revoked_at) return 'revoked';
  if (row.unexpired !== true) return 'expired'; /* the database clock decides (expires_at > now() in the SELECT), never the app's */
  if (row.edge_live !== true) return 'edge_off';
  if (request.write_door === true) return 'allowed'; /* MARK & QUERY: the marks router's two write doors (set, reply) are open to a live grant of either role; their own policy (lib/mark-policies) says which role may do which */
  if (row.preset === ADVISER) return request.listed ? 'allowed' : 'not_listed'; /* the adviser's doors are an allow-list too (middleware ADVISER_DOORS): no direct write on the books, a new route is born refused */
  if (request.method !== 'GET') return 'read_only';
  return request.listed ? 'allowed' : 'not_listed';
}
/** at most LOOKS_PER_MINUTE looks per (caller, member) per minute: a grantee cannot flood a member's log (429 in words, no row written) */
const LOOKS_PER_MINUTE = 300;
const recent = new Map();
function tooMany(grantee, member) {
  const key = grantee + '|' + member;
  const now = Date.now();
  const stamps = (recent.get(key) || []).filter((at) => now - at < 60000);
  if (stamps.length >= LOOKS_PER_MINUTE) throw refusal('BOOKS_GRANT_RATE', 429, 'Too many requests for these books. Wait a minute.');
  stamps.push(now);
  recent.set(key, stamps);
  if (recent.size > 5000) recent.clear();
}
/** the columns an adviser's bank write needs (b871 names the firm on both logs; b866 adds `posting`): the refusing outcome, or null when they are all there */
async function postingColumnsOutcome() {
  const schema = require('./schema');
  if (!(await schema.hasColumn('journal_entry', 'by_firm')) || !(await schema.hasColumn('bank_rec_log', 'by_firm'))) return 'not_migrated'; /* b871: no adviser write goes unnamed */
  return (await schema.hasColumn('books_access_grant', 'posting')) ? null : 'not_posting';
}
/**
 * the bank page's WRITES under an adviser grant: open only when the grant row says posting = adviser_posts and sets no cap (a cap is per action in books-action and cannot be checked per bank door, so it fails closed). Read from the live row in this
 * transaction, never from the request. Returns the refusing outcome, or null (the ordinary verdict decides).
 */
async function bankPostingOutcome(transaction, row, request) {
  if (!row || row.preset !== ADVISER || request.bank_write !== true || verdictOf(row, request) !== 'allowed') return null;
  const unready = await postingColumnsOutcome();
  if (unready) return unready;
  const found = (await transaction.query('SELECT posting, posting_cap_minor FROM books_access_grant WHERE grant_id = $1', [row.grant_id])).rows[0] || {};
  if (found.posting !== 'adviser_posts') return 'not_posting';
  return found.posting_cap_minor == null ? null : 'posting_capped';
}
/** ASSIGN-1: who skips the held test, in ONE place: the firm's owner and a firm manager see every client under switch `assigned` (Karbon and Xero Practice Manager give manager-level staff firm-wide visibility); an assistant sees only the clients held. Absent = neither, fail closed. */
const seesEveryClient = (request) => !!request && (request.owner === true || request.manager === true);
/**
 * ⭐ ASSIGN-1 · holdsOutcome(transaction, row, request) → 'not_assigned' | null — the SECOND test of a look (the grant is the first): the caller must HOLD an open job for this client.
 * It runs only when the verdict so far is allowed (the grant wins: revoked, expired, edge_off, not_listed, read_only keep their words), never for the firm's owner (request.owner === true;
 * absent = not the owner, fail closed), and only when the firm's switch says `assigned` (lib/assign-register holds: the switch and the gate are ONE statement; under `all` nothing is read).
 * The member is the grant row's grantor and the firm its grantee, never a header; the role is the grant's own.
 */
async function holdsOutcome(transaction, row, request) {
  if (!row || seesEveryClient(request)) return null;
  const register = require('./assign-register');
  const held = await register.holds(transaction, { plug: 'client', entity_id: row.grantee_entity, actor_id: request.actor, subject_id: row.grantor_entity, role: row.preset });
  return held ? null : 'not_assigned';
}
/**
 * ⭐ finalOutcome(transaction, row, request) — THE ONE OUTCOME of a request that names a member's books: the bank posting rule, else the grant's verdict, else the assignment test. look() and the marks write door
 * (lib/mark-door writeRun) call ONLY this (tests/assign-final-outcome.test.cjs fails if a door calls verdictOf itself), so a new door is born gated.
 */
async function finalOutcome(transaction, row, request) {
  const posting = await bankPostingOutcome(transaction, row, request);
  if (posting) return posting;
  const verdict = verdictOf(row, request);
  if (verdict !== 'allowed') return verdict;
  return (await holdsOutcome(transaction, row, request)) || 'allowed';
}
/**
 * ⭐ ASSIGN-1 · liveAmong(transaction, rows, request) → { live, kept, assigned } — THE ONE LIST OUTCOME, the list readers' twin of finalOutcome (the practice list, the baseline): the same two tests, the grant's verdict first,
 * then the assignment, but for MANY clients at once: ONE holdsAmong statement per role (a page of grants reads at most the two roles), never one per client.
 *   live     = the rows whose verdict is `allowed` (access that stands: what "ended" counts against)
 *   kept     = the live rows whose client the caller HOLDS, under switch `assigned` (the rest are excluded from rows, totals and counts, never masked); the owner and the switch `all` keep every live row
 *   assigned = true when the firm's switch is on (the holder columns show only then); false = today's answer, byte for byte
 * request.owner === true or request.manager === true skips the held test (absent = neither, fail closed). The order of `rows` is kept.
 */
async function liveAmong(transaction, rows, request) {
  const live = rows.filter((row) => verdictOf(row, request) === 'allowed');
  if (!live.length || seesEveryClient(request)) return { live, kept: live, assigned: false };
  const register = require('./assign-register');
  const held = new Set();
  let everyone = true;
  for (const role of [...new Set(live.map((row) => row.preset))]) {
    const mine = live.filter((row) => row.preset === role);
    const heldAmong = await register.holdsAmong(transaction, { plug: 'client', entity_id: mine[0].grantee_entity, actor_id: request.actor, members: mine.map((row) => String(row.grantor_entity)), role });
    if (!heldAmong.all) everyone = false;
    mine.forEach((row) => { if (heldAmong.all || heldAmong.held.has(String(row.grantor_entity))) held.add(row); });
  }
  return { live, kept: live.filter((row) => held.has(row)), assigned: !everyone };
}
/**
 * liveInOtherRole(grantee, member, role) → true when the member's grant to this firm in the OTHER role is live now (AT-F-05, walk AT 22 Nov): an ended auditor row beside a live adviser row is not "ended";
 * the firm named no view, so it is told to choose one. One bound read per role, no log row.
 */
async function liveInOtherRole(grantee, member, role) {
  return asEntity(grantee, async (transaction) => {
    for (const other of PRESETS.filter((name) => name !== role)) {
      if (other === ADVISER && !(await roleColumnsReady())) continue;
      const row = await rowFor(transaction, grantee, member, other);
      if (row && verdictOf(row, { listed: true, method: 'GET' }) === 'allowed') return true;
    }
    return false;
  });
}
/** the look itself: the lookup, the verdict and the log row in one transaction (see the header above) */
/** the answer of a look: the outcome with its status, code and words (null code and words when allowed) */
function answerOf(outcome, row) {
  const denied = WORDS[outcome];
  return { allowed: outcome === 'allowed', grant: outcome === 'allowed' ? row : null, outcome, status: denied ? denied[1] : 200, code: denied ? denied[0] : null, words: denied ? denied[2] : null };
}
/** the day a grant ended, in words (UTC: the database's own day), e.g. 19 November 2026 */
/** the day in words, on the SHOP's calendar (AT-F-04: an access ended on 22 Nov in Sydney was said to end on 21 November, the UTC day); zone = the books' timezone or country, none = UTC as before */
const dayWords = (at, zone) => new Date(require('./books-hooks').dayOf(at, zone || 'UTC') + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
/**
 * RC-13 (DECISIONS 19 Nov): whoever loses access is told plainly WHICH books, WHO ended it and WHEN: "Your access to <books> was ended by <name> on <date>." The names are read under the member's own binding (boundRead, as the practice list reads
 * grantor_name); a name that cannot be read falls back to "the owner of the books" and the old sentence stands when even the day is missing. Never throws: the refusal is the same 403 with or without the names.
 */
async function endedWords(transaction, row) {
  const old = WORDS.revoked[2];
  if (!row || !row.revoked_at) return old;
  try {
    const ids = [row.grantor_entity, row.revoked_by].filter(Boolean).map(String);
    const found = await boundRead(transaction.query.bind(transaction), row.grantor_entity, 'SELECT identity_id::text AS id, display_name, timezone, country FROM identities WHERE identity_id = ANY($1::uuid[])', [ids]);
    const nameOf = new Map(found.rows.map((item) => [item.id, item.display_name]));
    const books = nameOf.get(String(row.grantor_entity));
    const grantorRow = found.rows.find((item) => item.id === String(row.grantor_entity));
    const by = row.revoked_by && String(row.revoked_by) !== String(row.grantor_entity) ? nameOf.get(String(row.revoked_by)) : null;
    return 'Your access to ' + (books ? books + "'s books" : 'these books') + ' was ended by ' + (by || 'the owner of the books') + ' on ' + dayWords(row.revoked_at, grantorRow && (grantorRow.timezone || grantorRow.country)) + '.';
  } catch (err) {
    require('./logger').fellBack('books grant: the names of an ended grant could not be read, the plain sentence stands', err);
    return old;
  }
}
/** answerOf with the names an ended grant owes (RC-13): the ONE answer of a look and of the marks write door */
async function answerNamed(transaction, outcome, row) {
  const answer = answerOf(outcome, row);
  if (outcome === 'revoked') answer.words = await endedWords(transaction, row);
  return answer;
}
/** a look is logged only when an ACTIVE grant row of this pair exists (the log policy asks for it too): no row, or a revoked one, is refused with no log row, so nobody can write into another business's log */
const logsLook = (row) => !!row && !row.revoked_at;
/** the latest grant row of the pair for this role, with the live edge and the database clock's expiry (the ONE read of a look; the marks write door reads it inside its own transaction) */
async function rowFor(transaction, grantee, member, role) {
  const found = await transaction.query(`SELECT ${GRANT_COLUMNS}, ${isGrantParentSql('$1::text', '$2::text')} AS edge_live, (expires_at > now()) AS unexpired FROM books_access_grant WHERE grantee_entity = $1::uuid AND grantor_entity = $2::uuid AND preset = $3 ORDER BY granted_at DESC LIMIT 1`, [grantee, member, role]);
  return found.rows[0] || null;
}
/**
 * liveRoleOf(grantee, member) → the role a seat works under when the request names none: the member's LIVE grant to this firm (the adviser's first, else the auditor's); when none is live, the latest of either (so an ended or expired grant is told
 * in its own words); when there is none, the adviser. One bound read, no log row.
 */
async function liveRoleOf(grantee, member) {
  return asEntity(grantee, async (transaction) => {
    const rows = [];
    for (const role of [ADVISER, AUDITOR]) {
      if (role === ADVISER && !(await roleColumnsReady())) continue;
      const row = await rowFor(transaction, grantee, member, role);
      if (row) rows.push(row);
    }
    const live = rows.find((row) => verdictOf(row, { listed: true, method: 'GET' }) === 'allowed');
    return (live || rows[0] || { preset: ADVISER }).preset;
  });
}
/** the look itself: the lookup, the verdict and (for an active grant) the log row in one transaction */
async function look(grantee, member, request) {
  tooMany(grantee, member);
  const role = roleOf(request.role);
  if (!role) return answerOf('no_grant', null);
  const withRole = await roleColumnsReady();
  if (role === ADVISER && !withRole) return answerOf('no_grant', null);
  return asEntity(grantee, async (transaction) => {
    const row = await rowFor(transaction, grantee, member, role);
    const answer = await answerNamed(transaction, await finalOutcome(transaction, row, request), row);
    if (!logsLook(row)) return answer;
    await writeLogRow(transaction, withRole, row, member, grantee, request, answer);
    if (answer.allowed && row.preset === ADVISER) answer.firm_name = await firmNameOf(transaction, grantee); /* kept on the step rows: the owner reads it with no read into the firm's identities */
    return answer;
  });
}
/** the firm's name as its own binding reads it (the grantee's own identity row) */
async function firmNameOf(transaction, grantee) {
  const found = await boundRead(transaction.query.bind(transaction), grantee, 'SELECT display_name FROM identities WHERE identity_id = $1::uuid', [grantee]);
  return found.rows[0] ? found.rows[0].display_name : null;
}
/** write the member's log row in the firm's own transaction: the role, the person's name and the firm's name ride along once b866 has run (kept at the look, so the owner reads them with no read into another business's identities; the firm's name is read from the firm's own identity row, under its own binding) */
function writeLogRow(transaction, withRole, row, member, grantee, request, answer) {
  return writeLogRows(transaction, withRole, [Object.assign({}, row, { grantor_entity: member })], grantee, request, answer);
}
/** the same log row for SEVERAL members in ONE insert (the firm's practice read looks at every client in one request, one row each, as a look is logged today): rows = grant rows { grant_id, grantor_entity, preset } */
function writeLogRows(transaction, withRole, rows, grantee, request, answer) {
  const width = withRole ? 9 : 8;
  const params = [];
  const values = rows.map((row, i) => {
    params.push(row.grant_id, row.grantor_entity, grantee, request.actor || null, request.pattern, request.query_shape || null, answer.status, answer.outcome);
    if (withRole) params.push(row.preset);
    const at = (n) => '$' + (i * width + n);
    return '(' + [1, 2, 3, 4, 5, 6, 7, 8].map(at).join(', ') + (withRole ? ', ' + at(9) + ', $' + (rows.length * width + 1) + ', (SELECT display_name FROM firm)' : '') + ')';
  });
  if (!withRole) return transaction.query('INSERT INTO books_access_log (grant_id, grantor_entity, grantee_entity, actor_identity_id, route_pattern, query_shape, status, outcome) VALUES ' + values.join(', '), params);
  params.push(request.actor_name ? String(request.actor_name).slice(0, 200) : null, grantee); /* the firm's own identity row, read in this one statement under the grantee's binding (boundRead below) */
  return boundRead(
    transaction.query.bind(transaction),
    grantee,
    'WITH firm AS (SELECT display_name FROM identities WHERE identity_id = $' + (rows.length * width + 2) + '::uuid) INSERT INTO books_access_log (grant_id, grantor_entity, grantee_entity, actor_identity_id, route_pattern, query_shape, status, outcome, preset, actor_name, actor_entity_name) VALUES ' + values.join(', '),
    params
  );
}

module.exports = { threadReadOnlyWords, liveGrantSql, liveRoleOf, liveInOtherRole, rowFor, answerOf, answerNamed, endedWords, logsLook, tooMany, writeLogRow, writeLogRows, firmNameOf, roleColumnsReady, asEntity, AUDITOR, ADVISER, PRESETS, roleOf, verdictOf, finalOutcome, liveAmong, holdsOutcome, seesEveryClient, wrapMissing, give, change, revoke, list, looks, look, refusal, expiryOf, purposeOf, NOT_ON, NOT_ON_WORDS, UUID, DEFAULT_MONTHS, MAX_MONTHS };
