'use strict';
/**
 * lib/books-grant-log.js — THE LOG ROWS OF A LOOK AT A MEMBER'S BOOKS (ACC-176): the insert into books_access_log, one row or several in one statement.
 * OWNER     cb-network
 * OWNS      writeLogRow · writeLogRows (the member's log row, written in the firm's own transaction; the role, person and firm name ride along once b866 has run).
 * CALLED BY lib/books-grant.js (look; re-exports both) · lib/books-practice.js (the practice read, via books-grant).
 * FLOW      rows + the grantee + the request + the answer → ONE INSERT into books_access_log (the firm's name read in the same statement under the grantee's binding, boundRead).
 * CARD      04-network/ACC-176-AUDITOR-GRANT
 * RISK      security · a look with no log row must not read: the caller fails CLOSED when this insert fails; the column order here is the table's.
 */
const { boundRead } = require('./bound-read');
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
module.exports = { writeLogRow, writeLogRows };
