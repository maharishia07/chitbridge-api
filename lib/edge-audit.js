// CALLED BY src/routes/network.js, tests/edge-audit.test.cjs
// @stage tested
// @stage-note Writes the agency-edge audit rows (b882). Self-healing: no-op (counted) until the migration is applied.
'use strict';
/*
 * OWNS      the audit row of an agency edge (a firm acting for a client): asked, approved, declined, ended, as access_events rows through lib/access-events.record
 * CALLED BY src/routes/network.js (the ask, approve, decline and disconnect routes)
 * FLOW      edge answer (type agency) → edgeIdentities (node ids → identity ids, one read) → withEntity(client) → record() → access_events row; never fails the action
 * CARD      04-network/connections-and-invitations
 */
/**
 * edge-audit.js — FIRM-PARENT-DOOR §3.5 (18 Nov 2026). The relationship between a firm and a client was recorded only as cb_edge.requested_by / approved_by:
 * the ask, and who ended it and when, left no trace. One row per step, in the CLIENT's trail (entity_id = the client; subject = the firm; changed_by = the person who acted),
 * because the client owner is the one who reads "who asked for my books". The row is written as the client's own entity (access_events is FORCE RLS on entity_id).
 *
 * ⚠️ SELF-HEALING, like every writer of access_events: until the migration (b882) widens access_events_action_check, record() swallows the refusal, counts it (lostCount, GET /health audit_lost)
 *    and the ask/approve/disconnect still succeed. A failed audit write never fails the action (lib/access-events header).
 * ⚠️ ONLY AGENCY EDGES. A governance or commercial edge is a brand's network, not a firm over a client's books; it keeps its own record.
 */
const { withEntity, query: bareQuery } = require('../db');
const { record } = require('./access-events');
const log = require('./logger');

/** the four steps and the action word each writes (b882 allows exactly these) */
const ACTIONS = { ask: 'agency_asked', approve: 'agency_approved', decline: 'agency_declined', end: 'agency_ended' };
/** where the edge stood before each step (the ask has no before); an edge ends from active or suspended, both read 'connected' */
const BEFORE = { approve: 'requested', decline: 'requested', end: 'connected' };

/** the identities of an edge's two nodes (the node holds the bridge id; the identity row holds the id access_events names), or null when either is missing */
async function edgeIdentities(edge) {
  const { rows } = await bareQuery(
    `select e.id as node_id, i.identity_id from cb_entity e join identities i on upper(i.bridge_id) = upper(e.bridge_id) and i.identity_type = 'entity' where e.id = any($1::uuid[])`,
    [[edge.parent_id, edge.child_id]]
  );
  const idOf = new Map(rows.map((row) => [String(row.node_id), row.identity_id]));
  const firm = idOf.get(String(edge.parent_id)), client = idOf.get(String(edge.child_id));
  return firm && client ? { firm, client } : null;
}

/**
 * recordEdgeEvent(step, edge, changedBy) — one access_events row for an agency edge; resolves true when written, false when not (not an agency edge, or the audit could not be kept).
 * `step` is a key of ACTIONS; `changedBy` is the signed-in person's identity id.
 */
async function recordEdgeEvent(step, edge, changedBy) {
  if (!edge || edge.type !== 'agency' || !ACTIONS[step]) return false;
  try {
    const sides = await edgeIdentities(edge);
    if (!sides) return false;
    return await withEntity(sides.client, (handle) =>
      record((sql, params) => handle.query(sql, params), {
        entity_id: sides.client,
        subject_identity_id: sides.firm,
        action: ACTIONS[step],
        before: BEFORE[step] ? { state: BEFORE[step] } : null,
        after: { edge_id: edge.id, state: edge.state, requested_by: edge.requested_by || null },
        changed_by: changedBy,
        reason: 'agency edge ' + step
      })
    );
  } catch (e) {
    log.error('edge-audit: audit row NOT written', { step, code: (e && e.code) || null });
    return false;
  }
}

module.exports = { recordEdgeEvent, edgeIdentities, ACTIONS };
