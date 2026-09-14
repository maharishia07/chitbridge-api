'use strict';
/**
 * ── ⭐⭐⭐ WHERE DOES WORK OF THIS KIND GO? ──────────────────────────────────────────────────────────────────────
 *
 * DESIGN-SUPPORT-LIFECYCLE.md §5.1 — the keystone. lib/workpattern.js resolves `folder` and `default_assignee`
 * as OPEN knobs and cascades device → connector → entity, where the entity level is ONE assignee for the whole
 * business. So "incidents to support, requirements to product, changes to engineering" could not be said at
 * all, and CBINC's five queues were one inbox wearing five labels.
 *
 * ⭐ THIS ADDS ONE RUNG, IN THE PLACE "MOST SPECIFIC WINS" ALREADY PUTS IT:
 *
 *     device  →  connector  →  KIND  →  entity default
 *
 * ⚠️ A kind with no row resolves EXACTLY as it did before. That is the whole compatibility argument: this can
 * only fill in a step that was previously empty, so no routing that works today can change.
 *
 * ── ⚠️ AND IT FAILS OPEN, DELIBERATELY ──────────────────────────────────────────────────────────────────────────
 *
 * If the table is missing (b250 not run) or unreadable, this returns nulls and the caller behaves as it did
 * before — because the alternative is a shop's incident failing to record over a routing preference. Routing is
 * a convenience; losing the report is not. ⚠️ But `why` is always populated, so a queue that is quietly
 * unrouted can be SEEN to be. [[feedback-silence-is-the-bug]]
 */

const { withEntity, query } = require('../db');

/** ⭐ a tiny TTL memo, for the same reason workpattern.js has one: this is read on every finding that records,
 *  and routing changes about once a quarter. 60s means a change is visible within a minute without a restart. */
const TTL_MS = 60 * 1000;
const memo = new Map();
const keyOf = (e, k) => String(e) + '|' + String(k);

/**
 * ⚠️⚠️ AN INHERITED ANSWER IS CACHED UNDER THE CHILD'S KEY (that is the point of caching it), but it was WRITTEN
 * by an ancestor — so head office setting a destination stayed invisible to every branch for up to a minute,
 * with no way to force it, and `PUT /routing` only ever cleared the writer's own keys.
 *
 * ⭐ SO A WRITE CLEARS THE WHOLE MEMO. It is a Map of a few dozen entries rebuilt by one query each, routing
 * changes about once a quarter, and the alternative is knowing which descendants exist — which is a tree walk
 * on every write to save a lookup that costs nothing. [[feedback-name-vs-behaviour]]
 */
function invalidate(entity_id) {
  memo.clear();
}

/**
 * @param entity_id  whose routing to read
 * @param kind       'incident' | 'spec' | 'change' | 'release' | 'testcase' | …
 * @returns {Promise<{folder_id:?string, assignee_actor_id:?string, notify_email:?string, why:string}>}
 */
async function routeFor(entity_id, kind) {
  const none = (why) => ({ folder_id: null, assignee_actor_id: null, notify_email: null,
                           route_to_entity_id: null, why });
  if (!entity_id || !kind) return none('no entity or kind');

  const k = keyOf(entity_id, kind);
  const hit = memo.get(k);
  if (hit && (Date.now() - hit.at) < TTL_MS) return hit.v;

  let v;
  try {
    /* ⚠️ entity_work_routing is FORCE RLS tenant data, so it MUST be read inside withEntity — a plain query()
       would return no rows and look exactly like "this kind is not routed", which is the silent-zero failure
       this codebase keeps producing. */
    /* ⚠️ route_to_entity_id arrives with b251; selecting a column that is not there is an ERROR, not a null,
       so it is asked for separately and the answer degrades to "no team" rather than taking the whole read
       down. Same shape as lib/istest's probe, and for the same reason: code ships before migrations run. */
    const r = await withEntity(entity_id, (db) => db.query(
      `SELECT folder_id, assignee_actor_id, notify_email,
              (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='entity_work_routing'
                  AND column_name='route_to_entity_id') AS has_team
         FROM entity_work_routing WHERE entity_id = $1 AND kind = $2`, [entity_id, kind]));
    let team = null;
    if (r.rows[0] && r.rows[0].has_team) {
      const t = await withEntity(entity_id, (db) => db.query(
        `SELECT route_to_entity_id FROM entity_work_routing WHERE entity_id = $1 AND kind = $2`,
        [entity_id, kind]));
      team = (t.rows[0] && t.rows[0].route_to_entity_id) || null;
    }
    const row = r.rows[0];
    if (row && (row.folder_id || row.assignee_actor_id || row.notify_email || team)) {
      v = { folder_id: row.folder_id || null, assignee_actor_id: row.assignee_actor_id || null,
            notify_email: row.notify_email || null, route_to_entity_id: team,
            why: team ? 'routed by kind, to a team' : 'routed by kind' };
    } else {
      /**
       * ── ⭐⭐⭐ A BRANCH IS NOT AN ISLAND ──────────────────────────────────────────
       *
       * Athi, 2026-09-14: *"if a network child creates an incident where will it reach?"* — its own Task, and
       * nowhere else. Every branch of a chain was an island: head office could not say "faults come to us"
       * without signing in as each branch and setting the same row again.
       *
       * ⭐ SO A KIND WITH NO RULE HERE ASKS THE NETWORK ABOVE, nearest first — the pattern b248 already set
       * for populations: the parent declares it once, children inherit, and a child that sets its own row
       * overrides it. Most specific wins, which is what every other rung in this cascade already means.
       *
       * ⚠⚠ AND ONLY THE DESTINATION IS INHERITED, never the folder or the person. Those are TENANT-LOCAL:
       * head office's folder id does not exist in the branch, and head office's staff are not the branch's.
       * Inheriting them would file a ticket into a folder its owner cannot open. Which entity answers is the
       * only part of a routing rule that means the same thing one level down.
       */
      const up = await inheritedTeam(entity_id, kind);
      if (up && up.route_to_entity_id) {
        v = { folder_id: null, assignee_actor_id: null, notify_email: null,
              route_to_entity_id: up.route_to_entity_id,
              why: 'inherited from ' + (up.from_name || 'the network above') };
        memo.set(k, { at: Date.now(), v });
        return v;
      }
      /* ⭐ THE RUNG BELOW — unchanged behaviour. One assignee for the whole entity, which is what every caller
         got before this file existed. */
      const s = await withEntity(entity_id, (db) => db.query(
        `SELECT default_assignee_actor_id FROM entity_actor_settings WHERE entity_id = $1`, [entity_id]));
      const da = s.rows[0] && s.rows[0].default_assignee_actor_id;
      v = { folder_id: null, assignee_actor_id: da || null, notify_email: null, route_to_entity_id: null,
            why: da ? 'entity default (no rule for ' + kind + ')' : 'nothing routed for ' + kind };
    }
  } catch (e) {
    /* ⚠️ 42P01 = b250 not run. Not an error to the caller: routing is a convenience and a lost incident is not. */
    v = none(e.code === '42P01' ? 'b250 has not been run — no routing table' : (e.code || String(e.message || e)));
    /**
     * ⚠️⚠️ AND A FAILURE IS NOT AN ANSWER, SO IT IS NOT CACHED. One connection blip used to freeze
     * "nothing routed for incident" for a full minute across every ticket for that entity — and those tickets
     * were then filed in the default folder PERMANENTLY, with the error string recorded in routed_by as though
     * it were a routing decision. A retry costs one query; a minute of wrong filing cannot be undone.
     *
     * ⚠️ 42P01 is the exception: a missing table is a stable fact about this deployment, not a blip, and
     * re-asking every single time would put a failing query on the path of every finding.
     */
    if (e.code === '42P01') memo.set(k, { at: Date.now(), v });
    return v;
  }

  memo.set(k, { at: Date.now(), v });
  return v;
}

/**
 * ⭐ the nearest ancestor in THIS entity's own network that has named a destination for this kind.
 *
 * ⚠️ FAILS OPEN like everything else here: no b243 root_path, not in a network, or an unreadable tree, and
 * the caller falls through to the entity default exactly as it did before this existed.
 *
 * ⚠️ BOUNDED. Four hops is deeper than any real chain, and an unbounded walk over a cycle in a tree that is
 * supposed not to have one is a hung request rather than a wrong answer.
 */
const MAX_HOPS = 4;
async function inheritedTeam(entity_id, kind) {
  try {
    /* ancestors nearest-first: ltree @> is 'is an ancestor of', and the deepest of those is the parent */
    const a = await query(
      `SELECT i.identity_id, i.display_name
         FROM identities i JOIN cb_entity c ON c.bridge_id = i.bridge_id
        WHERE c.path @> (SELECT c2.path FROM identities i2
                           JOIN cb_entity c2 ON c2.bridge_id = i2.bridge_id
                          WHERE i2.identity_id = $1)
          AND i.identity_id <> $1
          AND coalesce(i.status,'active') = 'active'
        ORDER BY nlevel(c.path) DESC
        LIMIT $2`, [entity_id, MAX_HOPS]);
    for (const row of a.rows) {
      const r = await withEntity(row.identity_id, (db) => db.query(
        `SELECT route_to_entity_id FROM entity_work_routing WHERE entity_id = $1 AND kind = $2`,
        [row.identity_id, kind]));
      const t = r.rows[0] && r.rows[0].route_to_entity_id;
      if (t) return { route_to_entity_id: t, from_name: row.display_name };
    }
  } catch (_) { /* no tree, no column, no answer — and the caller carries on */ }
  return null;
}

module.exports = { routeFor, invalidate };
