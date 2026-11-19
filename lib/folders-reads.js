'use strict';
/**
 * lib/folders-reads.js — a folder's reads and the delete's unfile statement: one page of a filed folder's chits, the subtree unfile SQL.
 * OWNS      UNFILE_SUBTREE_SQL · filedChits (no route, no state)
 * CALLED BY routes/folders.js (DELETE /:id and GET /:id/chits)
 * FLOW      filedChits(withEntity: one statement, COUNT(*) OVER) -> { rows, total, roles }
 * CARD      01-rail-core-the-chit/folders
 */
const { withEntity } = require('../db'); // every folder-table query runs inside withEntity — `folder` is RLS-enforced
const costView = require('./cost-view'); // RAIL-146j: what a cost-blind co-assist may read of a folder
const FOLDER_LIST_MAX = 100; /* a filed folder's chit list when no page is asked — the ceiling it always had (W2-RAIL R2) */

/* RAIL-137 (b): the folder and EVERY folder below it (the foreign key cascades the whole subtree, and nothing constrains
   chit_status.folder_id). Unfiling only the direct children left a chit in a grandchild pointing at a folder no one holds.
   UNION, not UNION ALL, so a parent loop already in the table cannot make this walk forever. */
const UNFILE_SUBTREE_SQL = `WITH RECURSIVE subtree AS (
     SELECT folder_id FROM folder WHERE entity_id = $1 AND folder_id = $2
     UNION
     SELECT child.folder_id FROM folder child JOIN subtree ON child.parent_id = subtree.folder_id WHERE child.entity_id = $1
   )
   UPDATE chit_status SET folder_id = NULL WHERE entity_id = $1 AND folder_id IN (SELECT folder_id FROM subtree)`;

/**
 * filedChits(entityId, folderId, archived, pager, blind) → { rows, total, roles }: one page of a FILED folder's chits, newest first, and the whole count.
 * ⭐ W2-RAIL R2: THE CAP SAYS SO. This list always cut at 100 and answered `total` = the rows it kept, so a folder's 101st chit
 * was invisible and unsaid. Now the whole count rides in the same statement (COUNT(*) OVER(), no extra trip), the page is the
 * pager's when asked (LIMIT/OFFSET) and the ceiling when not — and pageOut answers `capped` + `cap_note` whenever rows were cut.
 */
async function filedChits(entityId, folderId, archived, pager, blind) {
  const limit = pager.asked ? pager.limit : FOLDER_LIST_MAX,
    offset = pager.asked ? pager.offset : 0;
  const read = await withEntity(entityId, async (db) => {
    const found = await db.query(
      `SELECT ch.chit_id, ch.sender_entity_display_name, ch.auto_subject, ch.manual_subject, ch.purpose, ch.created_at,
            ch.business_json, ch.created_by_actor_id${costView.feedColsSql('ch', blind)},
            (SELECT display_name FROM identities WHERE identity_id = ch.created_by_actor_id) AS raiser_name,
            cs.direction, cs.current_status, COUNT(*) OVER() AS _total
       FROM chit_status cs
       JOIN chit_header ch ON ch.chit_id = cs.chit_id AND ch.entity_id = cs.entity_id AND ch.direction = cs.direction
      WHERE cs.entity_id = $1 AND cs.folder_id = $2 AND cs.deleted_at IS NULL AND cs.archived_at IS ${archived ? 'NOT NULL' : 'NULL'}
      ORDER BY ch.created_at DESC LIMIT $3 OFFSET $4`,
      [entityId, folderId, limit, offset]
    );
    return { found, roles: await costView.rolesFor(db, entityId, found.rows, blind) }; /* RAIL-146j: ONE party-role read per page, only for a blind reader */
  });
  const total = read.found.rows.length ? Number(read.found.rows[0]._total) || 0 : 0;
  read.found.rows.forEach((row) => {
    delete row._total;
  });
  return { rows: read.found.rows, total, roles: read.roles };
}

module.exports = { UNFILE_SUBTREE_SQL, filedChits };
