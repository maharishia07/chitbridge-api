'use strict';
/**
 * lib/connect-asks.js — the requests to connect that wait, for ONE business
 * OWNER     cb-network
 * RISK      plain
 * OWNS      the one reader of "who asked to connect and waits for me" and "who I asked and I wait for": asksOf(entityId) → { to_me[], by_me[] } and pendingCount(entityId)
 * CALLED BY src/routes/network.js GET /asks · lib/home-facts.js card `network` (the Home Do-first door) · routes/notifications.js (the bell row and its dot)
 * FLOW      identity → its node (cb_entity by bridge id, never made here) → cb_edge in state `requested` where the asker is the OTHER side (to_me) or this side (by_me) → one row each, with the other business's name, bridge id and country
 * CARD      04-network/connections-and-invitations
 *
 * `kind` is the code the screen branches on (never the words): `firm` = an agency edge (a bookkeeping or audit firm and a shop), `network` = a brand's network (governance or commercial).
 * `i_am` says which end this business is on: for a firm edge the firm is the parent and the shop the child, so 'firm' | 'shop'; for a network edge 'brand' | 'store'.
 * An edge from before requested_by was recorded counts as asked by its parent (the same rule as services/network.mayAct).
 */
const { pool } = require('../src/db');

const ASK_LIMIT = 100; /* a firm with 150 shops may have many waiting; the screen pages beyond this by answering them */
const FIRM_TYPE = 'agency';
const ASK_SQL = `
  SELECT e.id AS edge_id, e.type, e.created_at AS asked_at,
         (e.parent_id = me.id) AS i_am_parent,
         (COALESCE(e.requested_by, e.parent_id) = me.id) AS by_me,
         o.name, o.bridge_id, i.country
    FROM cb_entity me
    JOIN cb_edge e ON e.state = 'requested' AND (e.parent_id = me.id OR e.child_id = me.id)
    JOIN cb_entity o ON o.id = CASE WHEN e.parent_id = me.id THEN e.child_id ELSE e.parent_id END
    LEFT JOIN identities i ON i.bridge_id = o.bridge_id AND i.identity_type = 'entity'
   WHERE me.bridge_id = (SELECT bridge_id FROM identities WHERE identity_id = $1 AND identity_type = 'entity')
   ORDER BY e.created_at DESC
   LIMIT ${ASK_LIMIT}`;

/** one edge row in the shape the screen draws */
function askView(row) {
  const firmEdge = row.type === FIRM_TYPE;
  const iAm = firmEdge ? (row.i_am_parent ? 'firm' : 'shop') : row.i_am_parent ? 'brand' : 'store';
  return { edge_id: row.edge_id, kind: firmEdge ? 'firm' : 'network', i_am: iAm, name: row.name, bridge_id: row.bridge_id, country: row.country || null, asked_at: row.asked_at };
}
/** asksOf(entityId) → { to_me: the requests waiting for MY answer, by_me: the ones I asked and wait on }, newest first */
async function asksOf(entityId) {
  const { rows } = await pool.query(ASK_SQL, [entityId]);
  const views = rows.map((row) => ({ by_me: row.by_me, view: askView(row) }));
  return { to_me: views.filter((item) => !item.by_me).map((item) => item.view), by_me: views.filter((item) => item.by_me).map((item) => item.view) };
}
/** how many requests wait for this business's answer (the Home door and the bell's dot): a request is a need until it is answered, so it is never "seen" away */
async function pendingCount(entityId) {
  return (await asksOf(entityId)).to_me.length;
}
module.exports = { asksOf, pendingCount, FIRM_TYPE };
