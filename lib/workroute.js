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

const { withEntity } = require('../db');

/** ⭐ a tiny TTL memo, for the same reason workpattern.js has one: this is read on every finding that records,
 *  and routing changes about once a quarter. 60s means a change is visible within a minute without a restart. */
const TTL_MS = 60 * 1000;
const memo = new Map();
const keyOf = (e, k) => String(e) + '|' + String(k);

function invalidate(entity_id) {
  if (!entity_id) { memo.clear(); return; }
  for (const k of [...memo.keys()]) if (k.startsWith(String(entity_id) + '|')) memo.delete(k);
}

/**
 * @param entity_id  whose routing to read
 * @param kind       'incident' | 'spec' | 'change' | 'release' | 'testcase' | …
 * @returns {Promise<{folder_id:?string, assignee_actor_id:?string, notify_email:?string, why:string}>}
 */
async function routeFor(entity_id, kind) {
  const none = (why) => ({ folder_id: null, assignee_actor_id: null, notify_email: null, why });
  if (!entity_id || !kind) return none('no entity or kind');

  const k = keyOf(entity_id, kind);
  const hit = memo.get(k);
  if (hit && (Date.now() - hit.at) < TTL_MS) return hit.v;

  let v;
  try {
    /* ⚠️ entity_work_routing is FORCE RLS tenant data, so it MUST be read inside withEntity — a plain query()
       would return no rows and look exactly like "this kind is not routed", which is the silent-zero failure
       this codebase keeps producing. */
    const r = await withEntity(entity_id, (db) => db.query(
      `SELECT folder_id, assignee_actor_id, notify_email FROM entity_work_routing
        WHERE entity_id = $1 AND kind = $2`, [entity_id, kind]));
    const row = r.rows[0];
    if (row && (row.folder_id || row.assignee_actor_id || row.notify_email)) {
      v = { folder_id: row.folder_id || null, assignee_actor_id: row.assignee_actor_id || null,
            notify_email: row.notify_email || null, why: 'routed by kind' };
    } else {
      /* ⭐ THE RUNG BELOW — unchanged behaviour. One assignee for the whole entity, which is what every caller
         got before this file existed. */
      const s = await withEntity(entity_id, (db) => db.query(
        `SELECT default_assignee_actor_id FROM entity_actor_settings WHERE entity_id = $1`, [entity_id]));
      const da = s.rows[0] && s.rows[0].default_assignee_actor_id;
      v = { folder_id: null, assignee_actor_id: da || null, notify_email: null,
            why: da ? 'entity default (no rule for ' + kind + ')' : 'nothing routed for ' + kind };
    }
  } catch (e) {
    /* ⚠️ 42P01 = b250 not run. Not an error to the caller: routing is a convenience and a lost incident is not. */
    v = none(e.code === '42P01' ? 'b250 has not been run — no routing table' : (e.code || String(e.message || e)));
  }

  memo.set(k, { at: Date.now(), v });
  return v;
}

module.exports = { routeFor, invalidate };
