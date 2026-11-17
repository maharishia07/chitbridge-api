'use strict';
/**
 * lib/raida-own-chit.js — BOLA GUARD FOR A FINDING ON A CHIT (raidachit, 17 Nov).
 *
 * A chit is BETWEEN parties and each party holds its own co-held copy, so "own" is "this entity holds a chit_header copy of it".
 * The foreign key on register_entry ignores RLS, so an existing chit id is not proof. A chit this entity holds no copy of, a junk id, or a line
 * that is not on that chit answers the one 404 (foreign_id_404), the sentence the route already gives. No chit_id (a standalone register) has nothing to check.
 *
 * OWNS      requireOwnChit(c, entity_id, chit_id, line_id): throws the 404 unless this entity holds the chit (and the line is on it)
 * CALLED BY lib/raida.js add
 * FLOW      chit_id ──▶ uuid? ──▶ chit_header row for this entity? ──▶ line_id ──▶ chit_line row on that chit? ──▶ else 404
 * CARD      03-disputes-service-and-register/raida-register-and-report
 */
const { UUID } = require('./namedentity');

const NOT_FOUND = 'Chit not found or you do not have access';
const noAccess = () => Object.assign(new Error(NOT_FOUND), { status: 404 });
const holds = async (c, sql, params) => (await c.query(sql, params)).rows.length > 0;

async function requireOwnChit(c, entity_id, chit_id, line_id) {
  if (!chit_id) return;
  const mine = UUID.test(String(chit_id)) && (await holds(c, 'SELECT 1 FROM chit_header WHERE chit_id = $1 AND entity_id = $2 LIMIT 1', [chit_id, entity_id]));
  if (!mine) throw noAccess();
  if (!line_id) return;
  const onChit = UUID.test(String(line_id)) && (await holds(c, 'SELECT 1 FROM chit_line WHERE chit_id = $1 AND entity_id = $2 AND line_id = $3 LIMIT 1', [chit_id, entity_id, line_id]));
  if (!onChit) throw noAccess();
}

module.exports = { requireOwnChit };
