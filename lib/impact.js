// CALLED BY lib/raida.js, lib/sides.js
'use strict';
/**
 * lib/impact.js — THE IMPACT WALK, ONE ENGINE. Pure: no database, no network.
 *
 * "If this changes, what waits on it?" was answered in ONE place — the register screen's impact view (web cap-register.js rgImpact,
 * fed by lib/raida.js walk). The CB Sides panel (lib/sides.js, "If you change your GSTIN: N businesses · M filings") asks the very
 * same question of the business itself. So the walk is WIDENED into this file and both callers use it — raida.walk for the register
 * screen, sides.build for the panel. The graph rule lives here once: a dependency that POINTS (to_id set) is an edge; the walk is
 * the impact; a cycle is cut by the raida_id it has already crossed.
 *
 *   EDGES_SQL                        the open dependency edges of one entity (the single statement both callers send)
 *   walk(rows, from, {backwards, depth})   -> { hops, depth_reached, truncated, backwards }
 *   reach(hops, partners)            -> { businesses, filings, ids }   "N businesses · M filings", from what is KNOWN
 *
 * ⭐ NEVER A MADE-UP NUMBER. `filings` is a count only of hops that name a filing (to_type filing|return); when nothing in the
 * graph can say, it is null — the panel prints "not yet", never 0. `businesses` is the distinct partners the caller KNOWS hold the
 * id (its supplier/customer lists) plus every hop that points at a business.
 * OWNS      the impact walk: walk() over the open dependency edges and reach() counting businesses and filings, one engine for both callers
 * FLOW      EDGES_SQL rows ──▶ walk(rows, from, { backwards, depth }) ──▶ hops ──▶ reach(hops, partners) ──▶ { businesses, filings, ids }; filings stays null when the graph cannot say
 * CARD      03-disputes-service-and-register/raida-register-and-report
 */

const EDGES_SQL = `SELECT raida_id, kind, body, line_id, subject_id, rel_type, to_type, to_id, to_label,
              needed_by::text AS needed_by, owner_name, severity
         FROM register_entry
        WHERE entity_id = $1 AND to_id IS NOT NULL AND closes_id IS NULL AND revises_id IS NULL`;

const BUSINESS = { entity: 1, business: 1, party: 1, supplier: 1, customer: 1 };
const FILING = { filing: 1, return: 1 };

/** the id a dependency edge starts from: its line, else its subject, else '' */
const sourceOf = (edge) => String(edge.line_id || edge.subject_id || '');

/** index the open edges both ways: by what they point TO (forward walk) and by where they start (backwards walk) */
function indexEdges(rows) {
  const byTarget = new Map(),
    bySource = new Map();
  const appendTo = (index, key, edge) => {
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(edge);
  };
  for (const edge of rows || []) {
    appendTo(byTarget, String(edge.to_id), edge);
    appendTo(bySource, sourceOf(edge), edge);
  }
  return { byTarget, bySource };
}

/** one edge as a hop of the walk, at the depth it was reached */
function hopOf(edge, depth) {
  return {
    depth,
    raida_id: edge.raida_id,
    kind: edge.kind,
    body: edge.body,
    rel_type: edge.rel_type,
    to_type: edge.to_type,
    to_id: edge.to_id,
    to_label: edge.to_label,
    needed_by: edge.needed_by,
    owner: edge.owner_name,
    severity: edge.severity
  };
}

/** walk(rows, from, { backwards, depth }) — breadth-first over the open edges from one id, a cycle cut by the raida_id already crossed (depth at most 12, default 6) */
function walk(rows, from, opts) {
  opts = opts || {};
  const maxDepth = Math.min(Number(opts.depth) || 6, 12);
  const back = !!opts.backwards;
  /* forward: what waits ON this thing. backwards: what this thing waits on. */
  const { byTarget, bySource } = indexEdges(rows);
  const seen = new Set();
  const hops = [];
  let frontier = [String(from)];
  for (let level = 0; level < maxDepth && frontier.length; level++) {
    const next = [];
    for (const node of frontier) {
      const edges = back ? bySource.get(node) || [] : byTarget.get(node) || [];
      for (const edge of edges) {
        if (seen.has(edge.raida_id)) continue; /* the cycle guard: a raida_id is crossed once */
        seen.add(edge.raida_id);
        hops.push(hopOf(edge, level));
        next.push(String(back ? edge.to_id : sourceOf(edge)));
      }
    }
    frontier = next;
  }
  return {
    hops,
    depth_reached: hops.length ? Math.max(...hops.map((item) => item.depth)) + 1 : 0,
    truncated: hops.length > 0 && frontier.length > 0,
    backwards: back
  };
}

/** partners: [{ id, name }] the caller knows hold our id. hops: walk(...).hops. */
function reach(hops, partners) {
  const ids = new Set();
  for (const partner of partners || []) if (partner && partner.id != null) ids.add(String(partner.id));
  let filings = null;
  for (const hop of hops || []) {
    const hopType = String(hop.to_type || hop.kind || '').toLowerCase();
    if (BUSINESS[hopType] && hop.to_id != null) ids.add(String(hop.to_id));
    filings = FILING[hopType] ? (filings || 0) + 1 : filings;
  }
  return { businesses: ids.size, filings, ids: Array.from(ids) };
}

module.exports = { EDGES_SQL, walk, reach };
