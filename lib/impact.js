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
 */

const EDGES_SQL = `SELECT raida_id, kind, body, line_id, subject_id, rel_type, to_type, to_id, to_label,
              needed_by::text AS needed_by, owner_name, severity
         FROM register_entry
        WHERE entity_id = $1 AND to_id IS NOT NULL AND closes_id IS NULL AND revises_id IS NULL`;

const BUSINESS = { entity: 1, business: 1, party: 1, supplier: 1, customer: 1 };
const FILING = { filing: 1, return: 1 };

function walk(rows, from, opts) {
  opts = opts || {};
  const maxDepth = Math.min(Number(opts.depth) || 6, 12);
  const back = !!opts.backwards;
  /* forward: what waits ON this thing. backwards: what this thing waits on. */
  const byTarget = new Map(), bySource = new Map();
  for (const e of rows || []) {
    const t = String(e.to_id);
    if (!byTarget.has(t)) byTarget.set(t, []);
    byTarget.get(t).push(e);
    const src = String(e.line_id || e.subject_id || '');
    if (!bySource.has(src)) bySource.set(src, []);
    bySource.get(src).push(e);
  }
  const seen = new Set();
  const hops = [];
  let frontier = [String(from)];
  for (let d = 0; d < maxDepth && frontier.length; d++) {
    const next = [];
    for (const node of frontier) {
      const edges = back ? (bySource.get(node) || []) : (byTarget.get(node) || []);
      for (const e of edges) {
        if (seen.has(e.raida_id)) continue;      /* the cycle guard */
        seen.add(e.raida_id);
        hops.push({ depth: d, raida_id: e.raida_id, kind: e.kind, body: e.body,
                    rel_type: e.rel_type, to_type: e.to_type, to_id: e.to_id, to_label: e.to_label,
                    needed_by: e.needed_by, owner: e.owner_name, severity: e.severity });
        next.push(String(back ? e.to_id : (e.line_id || e.subject_id || '')));
      }
    }
    frontier = next;
  }
  return { hops, depth_reached: hops.length ? Math.max(...hops.map((h) => h.depth)) + 1 : 0,
           truncated: hops.length > 0 && frontier.length > 0, backwards: back };
}

/** partners: [{ id, name }] the caller knows hold our id. hops: walk(...).hops. */
function reach(hops, partners) {
  const ids = new Set();
  for (const p of partners || []) if (p && p.id != null) ids.add(String(p.id));
  let filings = null;
  for (const h of hops || []) {
    const ty = String(h.to_type || h.kind || '').toLowerCase();
    if (BUSINESS[ty] && h.to_id != null) ids.add(String(h.to_id));
    if (FILING[ty]) filings = (filings || 0) + 1;
  }
  return { businesses: ids.size, filings, ids: Array.from(ids) };
}

module.exports = { EDGES_SQL, walk, reach };
