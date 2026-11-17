'use strict';
// OWNS      requireOwnChit: a finding's chit and line must be a chit THIS entity holds a copy of (split out of raida.js so it stays inside its size row)
// CALLED BY lib/raida.js add
// FLOW      requireOwnChit(client, entity_id, chit_id, line_id) → nothing, or the one 404 (foreign_id_404)
// CARD      28-platform-and-operations/raida
const { UUID } = require('./namedentity');
const noSuch = (msg) => Object.assign(new Error(msg), { status: 404 });

/**
 * BOLA (raidachit, 17 Nov): a chit is BETWEEN parties and each party holds its own co-held copy, so "own" is "this entity holds a chit_header copy of it".
 * The foreign key on register_entry ignores RLS, so an existing chit id is not proof. A chit this entity holds no copy of, a junk id, or a line that is
 * not on that chit answers the one 404 (foreign_id_404), the sentence the route already gives. No chit_id (a standalone register) has nothing to check.
 */
async function requireOwnChit(c, entity_id, chit_id, line_id) {
  if (!chit_id) return;
  const mine = UUID.test(String(chit_id)) && (await c.query('SELECT 1 FROM chit_header WHERE chit_id = $1 AND entity_id = $2 LIMIT 1', [chit_id, entity_id])).rows.length;
  if (!mine) throw noSuch('Chit not found or you do not have access');
  if (!line_id) return;
  const onChit = UUID.test(String(line_id)) && (await c.query('SELECT 1 FROM chit_line WHERE chit_id = $1 AND entity_id = $2 AND line_id = $3 LIMIT 1', [chit_id, entity_id, line_id])).rows.length;
  if (!onChit) throw noSuch('Chit not found or you do not have access');
}

module.exports = { requireOwnChit };
