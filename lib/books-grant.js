'use strict';
/**
 * lib/books-grant.js — THE GRANT OF READ-ONLY BOOKS (ACC-176): a member store's owner lets its network parent read its books, and every look is recorded.
 * OWNS      the two tables of migrations/b863 (books_access_grant, books_access_log): give · change · revoke · list · the look (find the live grant, decide, write the log row) · the member's list of looks.
 * CALLED BY middleware/books-grant.js (the books router's acting-for middleware) · routes/books-grants.js (the member's grant, revoke and list routes).
 * FLOW      look(): ONE withEntity as the grantee → one SELECT (the latest grant of the pair + the live edge, lib/network-membership isMemberSql) → the verdict → ONE insert in books_access_log → commit;
 *           no log row, no read (the write fails CLOSED). give/change/revoke: one withEntity as the member → the row + its access_events row (lib/access-events.record) in the SAME transaction; a lost event row rolls the change back.
 * CARD      04-network/ACC-176-AUDITOR-GRANT
 * ⚠️ THE EDGE IS READ, NEVER COPIED: the grant is live only while an active, non-suspended edge makes the grantee the network parent of the grantor (isMemberSql: built under it and standing, or an active commercial edge).
 *    Disconnect or suspend ends access on the very next request with no second write; nothing is cached.
 * ⚠️ NOT MIGRATED (b863 not run) is a typed refusal in words (BOOKS_GRANT_NOT_SWITCHED_ON, 503), never a 500 and never a read of the member's books.
 * ⚠️ identities, cb_entity and cb_edge are read by the existing network reader (isMemberSql); when identities take row security (SEC-185) that one statement moves to its bound reader, here and in catalogue-build.
 */
const { withEntity } = require('../db');
const { isMemberSql } = require('./network-membership');
const { record } = require('./access-events');

const NOT_ON = 'BOOKS_GRANT_NOT_SWITCHED_ON';
const NOT_ON_WORDS = 'Access for your auditor is not switched on yet.';
const MONTH_MS = 30.4375 * 24 * 3600 * 1000;
const DEFAULT_MONTHS = 12;
const MAX_MONTHS = 36;
const DEFAULT_PURPOSE = 'audit of the books';
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

const GRANT_COLUMNS = 'grant_id, grantor_entity, grantee_entity, preset, can_see_costs, purpose, granted_by, granted_at, expires_at, revoked_at, revoked_by';
/** the access_events row of a grant change (lib/access-events.record: before and after); false rolls the whole change back */
async function recordEvent(transaction, row, action, before, after, by) {
  const written = await record((sql, params) => transaction.query(sql, params), { entity_id: row.grantor_entity, subject_identity_id: row.grantee_entity, action, before, after, changed_by: by, reason: row.purpose });
  if (!written) throw refusal('BOOKS_GRANT_NOT_RECORDED', 503, 'We could not record this change, so nothing was changed. Try again.');
}
/** what the log of a grant keeps of it: the terms, never more */
const termsOf = (row) => ({ grant_id: row.grant_id, grantee_entity: row.grantee_entity, preset: row.preset, can_see_costs: row.can_see_costs, purpose: row.purpose, expires_at: row.expires_at, revoked_at: row.revoked_at || null });

/**
 * give(grantor, by, { grantee, purpose, expires_at, can_see_costs }) → the new grant row. The grantee must be the network parent of the grantor NOW (the same edge test every request asks);
 * one open grant per pair (a second is 409). The access_events row is written in the same transaction.
 */
async function give(grantor, by, input) {
  const grantee = String(input.grantee || '');
  if (!UUID.test(grantee) || grantee === String(grantor)) throw refusal('BOOKS_GRANT_NO_PARENT', 422, 'Pick the business in your network that audits you.');
  const expires = expiryOf(input.expires_at);
  const purpose = purposeOf(input.purpose);
  return asEntity(grantor, async (transaction) => {
    const live = await transaction.query(`SELECT ${isMemberSql('$1::text', '$2::text')} AS member`, [grantee, String(grantor)]);
    if (!live.rows[0] || live.rows[0].member !== true) throw refusal('BOOKS_GRANT_NO_PARENT', 422, 'That business is not your network parent, so it cannot be given your books.');
    const open = await transaction.query('SELECT 1 FROM books_access_grant WHERE grantor_entity = $1 AND grantee_entity = $2 AND revoked_at IS NULL AND expires_at > now()', [grantor, grantee]);
    if (open.rows.length) throw refusal('BOOKS_GRANT_EXISTS', 409, 'This business can already read your books. Change the end date instead.');
    await transaction.query('UPDATE books_access_grant SET revoked_at = now(), revoked_by = $3 WHERE grantor_entity = $1 AND grantee_entity = $2 AND revoked_at IS NULL', [grantor, grantee, by]); /* an expired open row makes room for the new one */
    const made = await transaction.query(`INSERT INTO books_access_grant (grantor_entity, grantee_entity, can_see_costs, purpose, granted_by, expires_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${GRANT_COLUMNS}`, [grantor, grantee, input.can_see_costs !== false, purpose, by, expires]);
    await recordEvent(transaction, made.rows[0], 'books_grant_given', null, termsOf(made.rows[0]), by);
    return made.rows[0];
  });
}

/** one grant of this member that is still open (not revoked), locked for the change */
async function openOf(transaction, grantor, grantId) {
  const found = await transaction.query(`SELECT ${GRANT_COLUMNS} FROM books_access_grant WHERE grant_id = $1 AND grantor_entity = $2 AND revoked_at IS NULL FOR UPDATE`, [UUID.test(String(grantId)) ? grantId : null, grantor]);
  if (!found.rows[0]) throw refusal('NOT_FOUND', 404, 'There is no open access with that number.');
  return found.rows[0];
}
/** change(grantor, by, grantId, { expires_at?, purpose? }) → the grant: the member edits the end date or the purpose; before and after go to access_events */
async function change(grantor, by, grantId, input) {
  return asEntity(grantor, async (transaction) => {
    const before = await openOf(transaction, grantor, grantId);
    const expires = input.expires_at === undefined ? before.expires_at : expiryOf(input.expires_at);
    const purpose = input.purpose === undefined ? before.purpose : purposeOf(input.purpose);
    const after = (await transaction.query(`UPDATE books_access_grant SET expires_at = $2, purpose = $3 WHERE grant_id = $1 RETURNING ${GRANT_COLUMNS}`, [before.grant_id, expires, purpose])).rows[0];
    await recordEvent(transaction, after, 'books_grant_changed', termsOf(before), termsOf(after), by);
    return after;
  });
}
/** revoke(grantor, by, grantId) → the revoked grant; the very next request of the grantee is refused (nothing is cached) */
async function revoke(grantor, by, grantId) {
  return asEntity(grantor, async (transaction) => {
    const before = await openOf(transaction, grantor, grantId);
    const after = (await transaction.query(`UPDATE books_access_grant SET revoked_at = now(), revoked_by = $2 WHERE grant_id = $1 RETURNING ${GRANT_COLUMNS}`, [before.grant_id, by])).rows[0];
    await recordEvent(transaction, after, 'books_grant_revoked', termsOf(before), termsOf(after), by);
    return after;
  });
}

/** list(entity) → { given: the grants this business gave, received: the grants it holds, each with whether the edge keeps it live right now } (row security shows each side its own) */
async function list(entity) {
  return asEntity(entity, async (transaction) => {
    const rows = (await transaction.query(`SELECT g.grant_id, g.grantor_entity, g.grantee_entity, g.preset, g.can_see_costs, g.purpose, g.granted_at, g.expires_at, g.revoked_at,
        ${isMemberSql('g.grantee_entity::text', 'g.grantor_entity::text')} AS edge_live
      FROM books_access_grant g ORDER BY g.granted_at DESC LIMIT 200`)).rows;
    const state = (row) => (row.revoked_at ? 'revoked' : new Date(row.expires_at) <= new Date() ? 'expired' : row.edge_live ? 'live' : 'edge_off');
    const shaped = rows.map((row) => Object.assign({}, row, { state: state(row) }));
    return { given: shaped.filter((row) => String(row.grantor_entity) === String(entity)), received: shaped.filter((row) => String(row.grantee_entity) === String(entity)) };
  });
}

/** the member's list of looks at its own books, newest first: { at, grant_id, grantee_entity, actor_identity_id, route_pattern, query_shape, status, outcome } */
async function looks(grantor, { limit, grant_id: grantId } = {}) {
  const rowCap = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  return asEntity(grantor, async (transaction) => {
    const wanted = grantId && UUID.test(String(grantId)) ? grantId : null;
    const rows = await transaction.query('SELECT at, grant_id, grantee_entity, actor_identity_id, route_pattern, query_shape, status, outcome FROM books_access_log WHERE grantor_entity = $1 AND ($2::uuid IS NULL OR grant_id = $2) ORDER BY at DESC, log_id DESC LIMIT $3', [grantor, wanted, rowCap]);
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
  not_listed: ['GRANT_ROUTE_NOT_LISTED', 403, 'This part of the books is not open to an auditor.'],
  read_only: ['GRANT_READ_ONLY', 403, 'An auditor can read these books, never change them.']
};
/** the outcome word of one request against the latest grant row of the pair */
function verdictOf(row, request) {
  if (!row) return 'no_grant';
  if (row.revoked_at) return 'revoked';
  if (new Date(row.expires_at) <= new Date()) return 'expired';
  if (row.edge_live !== true) return 'edge_off';
  if (request.method !== 'GET') return 'read_only';
  return request.listed ? 'allowed' : 'not_listed';
}
/** the look itself: the lookup, the verdict and the log row in one transaction (see the header above) */
async function look(grantee, member, request) {
  return asEntity(grantee, async (transaction) => {
    const found = await transaction.query(`SELECT ${GRANT_COLUMNS}, ${isMemberSql('$1::text', '$2::text')} AS edge_live FROM books_access_grant WHERE grantee_entity = $1::uuid AND grantor_entity = $2::uuid ORDER BY granted_at DESC LIMIT 1`, [grantee, member]);
    const row = found.rows[0] || null;
    const outcome = verdictOf(row, request);
    const denied = WORDS[outcome];
    const status = denied ? denied[1] : 200;
    await transaction.query('INSERT INTO books_access_log (grant_id, grantor_entity, grantee_entity, actor_identity_id, route_pattern, query_shape, status, outcome) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [row ? row.grant_id : null, member, grantee, request.actor || null, request.pattern, request.query_shape || null, status, outcome]);
    return { allowed: outcome === 'allowed', grant: outcome === 'allowed' ? row : null, outcome, status, code: denied ? denied[0] : null, words: denied ? denied[2] : null };
  });
}

module.exports = { wrapMissing, give, change, revoke, list, looks, look, refusal, expiryOf, purposeOf, NOT_ON, NOT_ON_WORDS, UUID, DEFAULT_MONTHS, MAX_MONTHS };
