// routes/folders.js — FOLDERS: a per-entity tree for organising ANY chit (mailing-model). Folders are private per entity;
// OWNS  /api/folders: a per-entity tree for filing any chit, a folder's chit list (paged; a cut list says so), its metrics and its rules.
// PARTS routes/folders-inbox.js (the messages inbox · its mark · the worklist) · routes/folders-totals.js (group sum · reconcile · MIS), mounted at the end of this file.
// CALLED BY server.js (mounted at /api/folders), the Task and Order lists, the folder panes and rules builder.
// FLOW  auth → schema check (lib/folders-contract.js) → the folder read (withEntity) → pageOut; a refusal → problem(req, res, said(...) | faultOf(...)), its old body frozen in docs/contracts/api-legacy.json
// CARD 01-rail-core-the-chit/folders
// filing sets chit_status.folder_id on THIS entity's copy only. Current/Archive reuses chit_status.archived_at.
// chit_status is RLS-protected -> any query touching it runs inside withEntity(caller). The folder table is entity-filtered.
const express = require('express');
const PL = require('../lib/page-limit'); /* LIM2: the ONE pager — asked = a page (server max), not asked = every row, as before */
const FOLDER_LIST_MAX = 100; /* a filed folder's chit list when no page is asked — the ceiling it always had, now said in words (W2-RAIL R2) */
const log = require('../lib/logger');
const router = express.Router();
const { withEntity } = require('../db'); // every folder-table query runs inside withEntity — `folder` is RLS-enforced (b64)
const { safeErr } = require('../lib/respond');
const { problem } = require('../lib/problem'); // API-STANDARD S1: the one error writer; each answer's old body is frozen in docs/contracts/api-legacy.json
const { sanitise } = require('../middleware/validate'); // S9: the request is checked against the route's own schema
const { said, failed, faultOf, pathsOf, routeChecks, PAGE_DEFAULT, PAGE_MAX } = require('../lib/folders-contract'); /* one page of this file's lists: PAGE_DEFAULT · PAGE_MAX live in the contract, shared with the parts */ // the contract (each route's operation) and the words of a refusal
const auth = require('../middleware/auth');
const ent = (req) => auth.entityOf(req);
/** the schema check of one route (lib/folders-contract.js routeChecks), spread after the gates: a route that takes no input has none */
const checked = routeChecks;
/**
 * ⚠️ A FOLDER BELONGS TO ONE TRACK (b133). Athi, 2026-08-10: *"tasks and order cannot be on the same folder. folder
 * are having same characteristics as tasks, so all the icon is possible and arithmetic is possible."*
 *
 * You ACT on a Task and you CHASE an Order — different lists, different actions. A folder holding both could inherit
 * neither. Declaring the side makes a folder a SUB-LIST of its track: same row, same icons, same actions, plus
 * arithmetic over a smaller set.
 */
/**
 * ⚠️ LATCH TRUE, NEVER FALSE — the same rule routes/chits.js states for the b50 definer probe: *"latches true once
 * seen; keeps re-probing while false, so it self-heals when the migration lands (no restart needed)."*
 *
 * My first version cached BOTH answers. A server process that learned "no scope column" before b133 was applied
 * kept believing it forever, so folders carried on being created without a side and the proof reported "b133 is
 * NOT applied" against a database where it plainly was. A negative cache outlives the fact it describes.
 *
 * Cost of getting it wrong this way round: one failed query per call until the column appears, then never again.
 */
let SCOPE_OK = false; // latches TRUE once the column is really there; never latches false
const missingCol = (e) => e && e.code === '42703';
/* Always attempt the scoped form unless we have already proved it works — so a pre-b133 database pays one failed
   query per call (a transient state) and a migrated one pays nothing after the first success. */
const views = require('../lib/folder-views'); // ⭐ VIEW folders — contents = the rule's matches (system + a shop's own)
const INV = require('../lib/folder-inventory'); // the folder inventory, numbered with the ledger
const { isOwner } = require('../lib/owner');
const select = require('../lib/select'); // WHICH chits — shared with the scorecard
const cost = require('../lib/cost'); // RAIL-146g/146j: is this caller a co-assist without can_see_costs
const costView = require('../lib/cost-view'); // RAIL-146j: what a cost-blind co-assist may read of a folder
const policy = require('../lib/policy'); // overdue is a declared flag, not a magic number
/** S35: no folder of this shop has the id — an unknown id and another shop's id are this one answer, the 404 of notHere() */
const NOT_HERE = 'not_here';
const notHere = () => ({ status: 404, ...said('NOT_FOUND', 'Not found') });
/**
 * viewFolder(entity, id) → the VIEW folder behind an id: a system one (lib/folder-inventory; `false` when the shop switched it
 * off), or a shop's own (folder.kind = 'view', b275) — null for an ordinary filed folder, NOT_HERE when this shop has no folder
 * with the id (the same read, no extra trip). A failed read is taken as a filed folder, as before. Every folder route asks this first.
 */
async function viewFolder(e, id) {
  const sys = await views.systemById(e, id);
  if (sys) return sys.on ? sys : false;
  const r = await withEntity(e, (db) =>
    db.query(`SELECT f.folder_id, f.name, to_jsonb(f)->>'kind' AS kind FROM folder f WHERE f.folder_id = $1 AND f.entity_id = $2`, [id, e])
  ).catch(log.orElse('folders viewFolder: the read failed — answered as a filed folder', null));
  if (!r) return null;
  const f = r.rows[0];
  if (!f) return NOT_HERE;
  return f.kind === 'view' ? f : null;
}
// GET /api/folders — the entity's folder tree (flat rows; the client builds the tree) with CURRENT (non-archived) counts.
router.get('/', auth, ...checked('GET /'), async (req, res) => {
  try {
    const e = ent(req);
    const readFolders = (withScope) =>
      withEntity(e, (db) =>
        db.query(
          `SELECT f.folder_id, f.parent_id, f.name, f.sort, ${withScope ? 'f.scope' : 'NULL::text AS scope'},
              COALESCE(to_jsonb(f)->>'kind', 'filed') AS kind,      /* b275 — read through to_jsonb: before it, every folder is filed */
              (SELECT COUNT(*) FROM chit_status cs
                 WHERE cs.entity_id = f.entity_id AND cs.folder_id = f.folder_id
                   AND cs.deleted_at IS NULL AND cs.archived_at IS NULL) AS count
         FROM folder f
        WHERE f.entity_id = $1
        ORDER BY f.parent_id NULLS FIRST, f.sort, f.name`,
          [e]
        )
      );
    let r;
    try {
      r = await readFolders(true);
      SCOPE_OK = true;
    } catch (e1) {
      if (!missingCol(e1)) throw e1;
      r = await readFolders(false);
    } // pre-b133 → retry in a FRESH tx
    /* a shop's own VIEW folder counts what its rules match, not what was filed into it (nothing can be) */
    const rows = r.rows;
    for (const f of rows)
      if (f.kind === 'view') {
        try {
          f.count = (await views.members(e, f, {})).counts.open;
        } catch (countError) {
          log.fellBack('folders GET /: failed — answered with nothing', countError);
          f.count = null;
        }
      }
    /**
     * ⭐ THE SYSTEM FOLDERS FIRST — the inventory's ON rows (lib/folder-inventory), each with its code, its ledger and the count
     * of its OPEN items. ⚠️ A failure reading them never blanks the shop's own tree, and it is SAID (system_error), not swallowed.
     */
    let list = [],
      sysErr = null;
    try {
      list = await views.systemFolders(e);
    } catch (e2) {
      sysErr = safeErr(e2);
      console.error('system folders:', e2.message);
    }
    const answer = PL.pageOut('folders', list.concat(rows), PL.pageArgs(req.query, PAGE_DEFAULT, PAGE_MAX));
    /* S34: a system folder (lib/folder-views systemFolders) and a shop's folder (the statement above) each carry the keys they always did, in their own order; the pager adds capped and cap_note only when it cut the list; system_error only when the system folders failed */
    // prettier-ignore
    res.json({ folders: answer.folders.map((x) => (x.system ? { folder_id: x.folder_id, parent_id: x.parent_id, name: x.name, code: x.code, kind: x.kind, system: x.system, scope: x.scope, side: x.side, ledger: x.ledger, sort: x.sort, count: x.count, total: x.total } : { folder_id: x.folder_id, parent_id: x.parent_id, name: x.name, sort: x.sort, scope: x.scope, kind: x.kind, count: x.count })), total: answer.total, page: answer.page, limit: answer.limit, capped: answer.capped, cap_note: answer.cap_note, system_error: sysErr || undefined });
  } catch (err) {
    problem(req, res, failed(err, req, 'List failed'));
  }
});
/**
 * ⭐ GET /api/folders/inventory — every folder a shop can have, numbered with its ledger: code · name · ledger · on/off.
 * Athi, 2026-10-01: *"an inventory of folders tied with the ledger number, enabled or disabled using a checkbox."*
 * `can_change` tells the screen whether to offer the checkboxes (the owner only).
 */
router.get('/inventory', auth, async (req, res) => {
  try {
    const e = ent(req);
    res.json({ rows: views.inventoryRows(await views.flagsOf(e)), can_change: isOwner(req) });
  } catch (err) {
    problem(req, res, failed(err, req, 'Inventory failed'));
  }
});
/**
 * PUT /api/folders/inventory/:code { on?: true|false, msg?: 'external'|'internal'|'none' } — the OWNER switches one system
 * folder on or off, and/or sets its MESSAGING LEVEL.
 * ⚠️ A track (Tasks, Orders) cannot be switched off. ⚠️ Off HIDES the folder; its bills still stay out of Task (they are not
 * tasks — lib/folder-inventory leaves_inbox), which the screen says beside the checkbox.
 * ⚠️ THE LEVEL ONLY GOES DOWN (Athi, 2026-10-01): the inventory's level is the ceiling — a level above it is refused with 409
 * and a plain sentence, and the dispute's level cannot be changed at all.
 */
router.put('/inventory/:code', auth, ...checked('PUT /inventory/:code'), async (req, res) => {
  try {
    if (!isOwner(req)) return problem(req, res, { status: 403, ...said('OWNER_ONLY', 'Only the owner may do this.', 'Only the owner may do this.') });
    const f = INV.byCode(String(req.params.code || ''));
    if (!f) return problem(req, res, { status: 404, ...said('NOT_FOUND', 'No such folder', 'There is no folder ' + req.params.code + ' in the inventory.') });
    const b = req.body || {};
    const hasOn = b.on !== undefined,
      hasMsg = b.msg !== undefined;
    if (!hasOn && !hasMsg) return problem(req, res, { status: 400, ...said('FOLDER_BAD_REQUEST', 'Bad request', 'Send on (true or false) or msg (external, internal or none).') });
    if (hasOn && typeof b.on !== 'boolean') return problem(req, res, { status: 400, ...said('FOLDER_BAD_REQUEST', 'Bad request', 'on must be true or false') });
    if (hasOn && f.fixed) return problem(req, res, { status: 400, ...said('FOLDER_BAD_REQUEST', 'Always on', f.name + ' is always on — it cannot be switched off.') });
    if (hasMsg) {
      if (INV.LEVELS.indexOf(b.msg) < 0) return problem(req, res, { status: 400, ...said('FOLDER_BAD_REQUEST', 'Bad request', 'msg must be external, internal or none.') });
      if (f.msg_fixed || f.kind === 'track') {
        const fixedWords = f.kind === 'track' ? f.name + ' has no messaging level of its own.' : f.name + ' are always shared with the other party — that cannot be changed.';
        return problem(req, res, { status: 409, ...said('MSG_FIXED', 'Fixed', fixedWords, 'before') });
      }
      if (!INV.msgAllowed(f, b.msg)) {
        const how = f.msg === 'internal' ? 'kept internal or switched off' : 'switched off';
        return problem(req, res, { status: 409, ...said('MSG_ABOVE_CEILING', 'Above the default', f.name + ' can be ' + how + ', but not shared beyond the default.', 'before') });
      }
    }
    const e = ent(req);
    const cur = (await policy.get(e)).system_folders || {};
    /* the stored row becomes { on, msg } — an older 'on'/'off' string is carried into it, never lost */
    const was = cur[f.code],
      row = was && typeof was === 'object' ? Object.assign({}, was) : was === 'on' ? { on: true } : was === 'off' ? { on: false } : {};
    if (hasOn) row.on = b.on;
    if (hasMsg) row.msg = b.msg;
    await policy.set(e, { system_folders: Object.assign({}, cur, { [f.code]: row }) });
    res.json({ rows: views.inventoryRows(await views.flagsOf(e)), can_change: true });
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Switch failed'));
  }
});
// POST /api/folders — create { name, parent_id? }
router.post(
  '/',
  auth,
  ...checked('POST /'),
  async (req, res) => {
    try {
      const e = ent(req);
      const name = sanitise(req.body.name);
      const parent = req.body.parent_id || null;
      /* ⚠️ A FOLDER BELONGS TO ONE TRACK (b133). Task and Order are different lists with different actions; a folder
       that held both could inherit neither. Default 'task' — the track folders were built for. */
      const scope = req.body.scope === 'order' ? 'order' : 'task';
      /**
       * ⭐ A VIEW FOLDER (b275) — its contents are its rules' matches, so a chit shows in it AND keeps its own filing (a supplier's
       * folder: rule { from: 'Mayur' }). Needs the kind column; before b275 it is refused by name, never made as a filed folder.
       */
      if (req.body.kind === 'view') {
        try {
          const r = await withEntity(e, (db) =>
            db.query(
              `INSERT INTO folder (entity_id, parent_id, name, scope, kind) VALUES ($1, NULL, $2, $3, 'view') RETURNING folder_id, parent_id, name, sort, scope, kind`,
              [e, name, scope]
            )
          );
          const made = r.rows[0];
          /* S34: the view folder is the columns the INSERT above RETURNs, in its order, then its count */
          // prettier-ignore
          return res.json({ folder: { folder_id: made.folder_id, parent_id: made.parent_id, name: made.name, sort: made.sort, scope: made.scope, kind: made.kind, count: 0 } });
        } catch (ev) {
          if (missingCol(ev)) return problem(req, res, { status: 503, ...said('FOLDER_NOT_MIGRATED', 'Not migrated', 'View folders need b275 on this environment.') });
          throw ev;
        }
      }
      /**
       * ⚠️ A FALLBACK INSIDE A TRANSACTION IS NOT A FALLBACK. The first version caught 42703 (no `scope` column, i.e.
       * pre-b133) and retried the plain INSERT on the SAME client — but Postgres had already aborted the transaction,
       * so the retry died with "current transaction is aborted" and the create returned a folder with no id. The
       * metrics call then 400'd on "id: Invalid value", which points nowhere near the actual cause.
       *
       * The retry must be a NEW transaction, and the negative is never cached (see the latch note above).
       */
      const doInsert = (withScope) =>
        withEntity(e, async (db) => {
          if (parent && !(await views.folderOwned(db, e, parent))) return { badParent: true }; /* SEC-100: the one lookup, under this shop */
          const r = withScope
            ? await db.query(`INSERT INTO folder (entity_id, parent_id, name, scope) VALUES ($1,$2,$3,$4) RETURNING folder_id, parent_id, name, sort, scope`, [
                e,
                parent,
                name,
                scope
              ])
            : await db.query(`INSERT INTO folder (entity_id, parent_id, name) VALUES ($1,$2,$3) RETURNING folder_id, parent_id, name, sort`, [e, parent, name]);
          return { folder: r.rows[0] };
        });
      let row;
      try {
        row = await doInsert(true);
        SCOPE_OK = true;
      } catch (e1) {
        if (!missingCol(e1)) throw e1;
        row = await doInsert(false);
      }
      if (row.badParent) return problem(req, res, { status: 400, ...said('FOLDER_BAD_REQUEST', 'Bad parent', 'Parent folder not found.') });
      const made = row.folder || {}; /* no row read back: the answer stays { count: 0 }, as the spread made it */
      /* S34: the folder is the columns the INSERT above RETURNs (scope only once b133 has run), then its count */
      // prettier-ignore
      res.json({ folder: { folder_id: made.folder_id, parent_id: made.parent_id, name: made.name, sort: made.sort, scope: made.scope, count: 0 } });
    } catch (err) {
      problem(req, res, failed(err, req, 'Create failed'));
    }
  }
);
/** RAIL-137 (c): true when `parentId` is `folderId` itself or sits anywhere BELOW it, walked up through this shop's folders: putting a
 *  folder under its own descendant takes the whole subtree out of the tree. UNION, so a loop already in the table ends the walk. */
async function isInsideItself(db, entityId, folderId, parentId) {
  const above = await db.query(
    `WITH RECURSIVE up AS (
       SELECT folder_id, parent_id FROM folder WHERE folder_id = $1 AND entity_id = $2
       UNION
       SELECT above.folder_id, above.parent_id FROM folder above JOIN up ON above.folder_id = up.parent_id WHERE above.entity_id = $2
     )
     SELECT 1 FROM up WHERE folder_id = $3 LIMIT 1`,
    [parentId, entityId, folderId]
  );
  return above.rows.length > 0;
}
// PATCH /api/folders/:id — rename and/or re-parent (move a subtree)
router.patch(
  '/:id',
  auth,
  ...checked('PATCH /:id'),
  async (req, res) => {
    try {
      const e = ent(req);
      const sets = [];
      const params = [];
      let index = 0;
      let newParent = null; /* SEC-100: a parent named in the body is looked up under this shop before it is stored */
      if (req.body.name !== undefined) {
        index++;
        sets.push(`name = $${index}`);
        params.push(sanitise(req.body.name));
      }
      if (req.body.parent_id !== undefined) {
        const par = req.body.parent_id || null;
        if (par === req.params.id) return problem(req, res, { status: 400, ...said('FOLDER_BAD_REQUEST', 'A folder cannot be its own parent') });
        index++;
        sets.push(`parent_id = $${index}`);
        params.push(par);
        newParent = par;
      }
      if (!sets.length) return problem(req, res, { status: 400, ...said('FOLDER_BAD_REQUEST', 'Nothing to update') });
      index++;
      const idIdx = index;
      params.push(req.params.id);
      index++;
      params.push(e);
      const r = await withEntity(e, async (db) => {
        if (newParent && !(await views.folderOwned(db, e, newParent))) return null;
        if (newParent && (await isInsideItself(db, e, req.params.id, newParent))) return 'inside_itself';
        return db.query(`UPDATE folder SET ${sets.join(', ')} WHERE folder_id = $${idIdx} AND entity_id = $${index} RETURNING folder_id, parent_id, name`, params);
      });
      if (r === 'inside_itself') return problem(req, res, { status: 400, ...said('FOLDER_BAD_REQUEST', 'A folder cannot go inside a folder that is inside it') });
      /* an unknown parent and another shop's parent are one answer, and the same as an unknown folder (SEC-100) */
      if (!r || !r.rows.length) return problem(req, res, { status: 404, ...said('NOT_FOUND', 'Not found') });
      const saved = r.rows[0];
      /* S34: the folder is the three columns the UPDATE above RETURNs, in its order */
      res.json({ folder: { folder_id: saved.folder_id, parent_id: saved.parent_id, name: saved.name } });
    } catch (err) {
      problem(req, res, failed(err, req, 'Update failed'));
    }
  }
);
// DELETE /api/folders/:id — delete a folder (children cascade via FK); UNFILE its chits (folder_id -> NULL) so nothing is lost.
/* RAIL-137 (b): the folder and EVERY folder below it (the foreign key cascades the whole subtree, and nothing constrains
   chit_status.folder_id). Unfiling only the direct children left a chit in a grandchild pointing at a folder no one holds.
   UNION, not UNION ALL, so a parent loop already in the table cannot make this walk forever. */
const UNFILE_SUBTREE_SQL = `WITH RECURSIVE subtree AS (
     SELECT folder_id FROM folder WHERE entity_id = $1 AND folder_id = $2
     UNION
     SELECT child.folder_id FROM folder child JOIN subtree ON child.parent_id = subtree.folder_id WHERE child.entity_id = $1
   )
   UPDATE chit_status SET folder_id = NULL WHERE entity_id = $1 AND folder_id IN (SELECT folder_id FROM subtree)`;
router.delete('/:id', auth, ...checked('DELETE /:id'), async (req, res) => {
  try {
    const e = ent(req);
    const deleted = await withEntity(e, async (db) => {
      await db.query(UNFILE_SUBTREE_SQL, [e, req.params.id]);
      const r = await db.query(`DELETE FROM folder WHERE folder_id = $1 AND entity_id = $2`, [req.params.id, e]);
      return r.rowCount;
    });
    if (!deleted) return problem(req, res, notHere()); /* S35: nothing of this shop's was deleted (an unknown id, another shop's): said, not { deleted: 0 } */
    res.json({ deleted });
  } catch (err) {
    problem(req, res, failed(err, req, 'Delete failed'));
  }
});
// POST /api/folders/move — file / redirect a chit into a folder (folder_id=null => unfile). Sets MY copy only.
router.post('/move', auth, ...checked('POST /move'), async (req, res) => {
  try {
    const e = ent(req);
    const fid = req.body.folder_id || null;
    /* ⚠️ A VIEW FOLDER IS NOT A PLACE — it shows what its rule matches, so nothing can be moved into it (a system folder or a
       shop's own view). Refused by name: a silent "moved: 0" would read as a filing that happened. */
    if (fid && INV.byId(fid)) {
      const moveWords = 'That folder shows what its rule matches — it is not a place to move chits into. The chit is already there if it matches.';
      return problem(req, res, { status: 400, ...said('FOLDER_IS_VIEW', 'View folder', moveWords, 'before') });
    }
    if (fid) {
      const k = await withEntity(e, (db) =>
        db.query(`SELECT to_jsonb(f)->>'kind' AS kind FROM folder f WHERE f.folder_id = $1 AND f.entity_id = $2`, [fid, e])
      ).catch(log.orElse('folders: the read failed — answered with none', { rows: [] }));
      if (k.rows[0] && k.rows[0].kind === 'view')
        return problem(req, res, { status: 400, ...said('FOLDER_IS_VIEW', 'View folder', 'That folder shows what its rules match — it is not a place to move chits into.', 'before') });
    }
    const doMove = (scoped) =>
      withEntity(e, async (db) => {
        let fscope = null;
        if (fid) {
          let f;
          /* Same rule as the create route: never retry inside an aborted transaction, and never cache the negative. */
          f = await db
            .query(
              scoped
                ? `SELECT scope FROM folder WHERE folder_id = $1 AND entity_id = $2`
                : `SELECT NULL::text AS scope FROM folder WHERE folder_id = $1 AND entity_id = $2`,
              [fid, e]
            )
            .catch((err) => {
              if (missingCol(err)) return null;
              throw err;
            });
          if (f === null) return { retryNoScope: true };
          if (!f.rows.length) return { noFolder: true };
          fscope = f.rows[0].scope;
        }
        /**
         * ⚠️ `direction` IS OPTIONAL, AND WITHOUT IT A SELF-CHIT MOVES BOTH COPIES.
         *
         * The comment above says "MY copy" — singular — but this UPDATE matched on (chit_id, entity_id) only. On an
         * inter-entity chit you hold one copy, so there was never a difference. On a SELF-CHIT you hold two (the
         * Order copy and the Task copy) and both moved together: filing 40 chits produced 80 filed rows, and the
         * folder honestly reported 80 while a person would say 40.
         *
         * Found 2026-08-10 by seeding folders and reading the counts back. Fixed ADDITIVELY: omit `direction` and
         * the old behaviour is unchanged; pass it and only that copy moves. The UI passes it now, because Task and
         * Order are genuinely different things in the mailbox model — filing the Order copy into "Sent to suppliers"
         * should not drag the Task copy along.
         */
        let dir = req.body.direction === 'sent' || req.body.direction === 'received' ? req.body.direction : null;
        /**
         * ⚠️ THE FOLDER'S SIDE DECIDES (b133). A Task folder takes received copies; an Order folder takes sent ones.
         * When the caller names no direction, the folder's scope supplies it — so an old client filing "the chit"
         * into a Task folder now files the Task copy and leaves the Order copy alone, instead of dragging both.
         * When the caller DOES name one and it contradicts the folder, that is refused rather than quietly ignored:
         * silently filing into the wrong track is how a folder stops meaning anything.
         */
        const want = fscope === 'order' ? 'sent' : fscope === 'task' ? 'received' : null;
        if (want && dir && dir !== want) return { wrongSide: { folder: fscope, chit: dir } };
        if (want && !dir) dir = want;

        const r = await db.query(
          `UPDATE chit_status SET folder_id = $1 WHERE chit_id = $2 AND entity_id = $3` + (dir ? ` AND direction = $4` : ''),
          dir ? [fid, req.body.chit_id, e, dir] : [fid, req.body.chit_id, e]
        );
        return { moved: r.rowCount, scope: fscope };
      });
    // The 42703 retry is a FRESH transaction — the aborted one can serve nothing further. At most once per process.
    let result = await doMove(true);
    if (result.retryNoScope)
      result = await doMove(false); // FRESH tx — the aborted one serves nothing
    else if (!result.noFolder) SCOPE_OK = true;
    if (result.noFolder) return problem(req, res, { status: 400, ...said('FOLDER_BAD_REQUEST', 'No such folder') });
    if (result.wrongSide) {
      const sideWords =
        'That is a ' +
        (result.wrongSide.folder === 'order' ? 'Order' : 'Task') +
        ' folder — it holds ' +
        (result.wrongSide.folder === 'order' ? 'chits you sent' : 'chits that came to you') +
        '. Task and Order are separate tracks, so a folder belongs to one of them.';
      return problem(req, res, { status: 400, ...said('FOLDER_WRONG_SIDE', 'Wrong side', sideWords, true) });
    }
    res.json({ moved: result.moved, folder_id: fid, scope: result.scope });
  } catch (err) {
    problem(req, res, failed(err, req, 'Move failed'));
  }
});
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
// GET /api/folders/:id/chits?archived=0|1 — the chits filed in this folder.
// ⚠️ ONE SIDE ONLY (b133). Filing enforces it, so a folder cannot acquire the wrong track — but a folder that was
// mixed BEFORE b133 still holds both, and this list would show them side by side with the wrong actions. The
// folder's declared scope filters the read too, so the screen is consistent even where the data is not yet.
// Isolated from the core inbox query on purpose. Lightweight shape for the folder list.
router.get('/:id/chits', auth, ...checked('GET /:id/chits'), async (req, res) => {
  try {
    const e = ent(req);
    const blind = await cost.isCostBlind(req, e),
      ignored = costView.moneyParams(req, blind); /* RAIL-146j: ONE cost read per request */
    const arch = req.query.archived === '1' || req.query.archived === 'true';
    const pg = PL.pageArgs(req.query, PAGE_DEFAULT, PAGE_MAX);
    /**
     * ⭐ A VIEW FOLDER answers with its rule's matches — a bill carrying its lifecycle (lib/bill-steps: step · code · label ·
     * by · at, and the history of every acceptance). ?state=open (default) | closed | all. An OFF system folder is absent.
     */
    const vf = await viewFolder(e, req.params.id);
    if (vf === false) return problem(req, res, { status: 404, ...said('NOT_FOUND', 'Not found', 'That folder is switched off.') });
    if (vf === NOT_HERE) return problem(req, res, notHere());
    if (vf) {
      /* ⚠️ { chits, counts } and nothing else: the web's envelope collapses `chits` to the array and keeps only the siblings it
         knows (`counts` is one) — anything more would be dropped silently on the way in */
      const members = await views.members(e, vf, { archived: arch, state: req.query.state });
      const shown = await withEntity(e, (db) => costView.viewFolderRows(db, e, members.chits, blind)); /* RAIL-146j: a blind reader's cost-side members lose their money */
      const page = PL.pageOut('chits', shown, pg);
      /* S34: the pager keys named (capped and cap_note only when it cut the list); a chit stays the row lib/folder-views members answers (lib/select plus its bill), open; cost_params_ignored (RAIL-146j) only when a blind reader sent a money filter */
      // prettier-ignore
      return res.json({ chits: page.chits, total: page.total, page: page.page, limit: page.limit, capped: page.capped, cap_note: page.cap_note, counts: { open: members.counts.open, closed: members.counts.closed, total: members.counts.total }, cost_params_ignored: costView.ignoredField(ignored) });
    }
    const filed = await filedChits(e, req.params.id, arch, pg, blind);
    const answer = PL.pageOut('chits', costView.folderChitRows(filed.rows, { blind, shopId: e, roles: filed.roles }), pg, filed.total); /* RAIL-146j: a blind reader's cost-side rows lose their money */
    /* S34: the pager keys named (capped and cap_note only when it cut the list); a chit stays the row the statement above selects, since business_json is the chit body the screen reads; cost_params_ignored (RAIL-146j) as above */
    // prettier-ignore
    res.json({ chits: answer.chits, total: answer.total, page: answer.page, limit: answer.limit, capped: answer.capped, cap_note: answer.cap_note, cost_params_ignored: costView.ignoredField(ignored) });
  } catch (err) {
    problem(req, res, failed(err, req, 'List failed'));
  }
});
/** filedSet(shopId, folderId, archived) → { head: { scope }, rows }: a FILED folder's copies for its metrics, on the folder's own side (a Task folder's arithmetic is over Task copies); a failed scope read measures both sides */
async function filedSet(shopId, folderId, archived) {
  let fscope = null;
  try {
    const f = await withEntity(shopId, (db) => db.query('SELECT scope FROM folder WHERE folder_id = $1 AND entity_id = $2', [folderId, shopId]));
    fscope = (f.rows[0] || {}).scope || null;
  } catch (e) {
    log.fellBack('folders GET /:id/metrics: the read failed — carried on without it', e);
  }
  const rows = await select.rows(shopId, { folder_id: folderId, archived, direction: fscope === 'order' ? 'sent' : fscope === 'task' ? 'received' : undefined });
  return { head: { scope: fscope }, rows };
}
/**
 * GET /:id/metrics — WHAT IS IN THIS FOLDER, as numbers.
 *
 * ⚠️ THREE LINES, BECAUSE THE WORK IS SHARED. A folder metric and a counterparty scorecard are the same operation
 * over different selectors — resolve a set (lib/select.js), measure it (lib/measure.js). Written once so a folder
 * and a supplier can never disagree about what "open" or "overdue" means, which they would within a month if
 * each screen counted for itself. See SPEC-folder-skills.md.
 *
 * Read-only, no migration, WITH RLS: withEntity() sets the tenant and the WHERE names it again. A folder is
 * per-COPY — this counts YOUR copies, never a counterparty's.
 */
router.get('/:id/metrics', auth, ...checked('GET /:id/metrics'), async (req, res) => {
  try {
    const me = ent(req);
    const flags = await policy.get(me); //  is a POLICY, not a constant hidden inside a report
    const blind = await costView.blindOf(req, me),
      ignored = costView.moneyParams(req, blind); /* RAIL-146j: ONE cost read per request (RAIL-146k: memoised, the measurer below shares it) */
    /* a VIEW folder measures its rule's matches — the same measure, a different set */
    const vf = await viewFolder(me, req.params.id);
    if (vf === false) return problem(req, res, { status: 404, ...said('NOT_FOUND', 'Not found', 'That folder is switched off.') });
    if (vf === NOT_HERE) return problem(req, res, notHere());
    const archived = req.query.archived === '1';
    const { head, rows } = vf ? { head: { scope: null, code: vf.code || null }, rows: await views.rowsFor(me, await views.whensOf(me, vf), { archived }) } : await filedSet(me, req.params.id, archived);
    const measured = await costView.measureFor(req, me, rows, { overdue_days: flags.overdue_days }); /* RAIL-146k: a blind reader's money stands only over the shop own sales */
    /* S34: the folder (code only for a view folder), then every key lib/measure measure answers, in its order; the nested counts and sums stay the measure own, open; cost_hidden and cost_params_ignored (RAIL-146j) only for a blind reader */
    // prettier-ignore
    res.json({ folder_id: req.params.id, scope: head.scope, code: head.code, count: measured.count, by_status: measured.by_status, by_direction: measured.by_direction, open: measured.open, closed: measured.closed, unread: measured.unread, overdue: measured.overdue, overdue_days: measured.overdue_days, clock: measured.clock, disputes: measured.disputes, money: measured.money, cost_hidden: measured.cost_hidden, cost_params_ignored: costView.ignoredField(ignored) });
  } catch (err) {
    console.error('folder metrics:', err.message);
    problem(req, res, failed(err, req, 'Metrics failed'));
  }
});
/* ── FOLDER RULES (b132) — condition -> file here. The UX Athi asked for lives INSIDE the folder. ────────────── */
const rules = require('../lib/folder-rules');
router.get('/:id/rules', auth, ...checked('GET /:id/rules'), async (req, res) => {
  try {
    /* ⭐ a SYSTEM folder's rule is the inventory's, shown and fixed — the Task list leaves out the same documents, so an
       edited rule here would make the folder and the inbox disagree */
    const f = INV.byId(req.params.id);
    if (f)
      return res.json({
        rules: [{ rule_id: null, folder_id: req.params.id, name: f.code + ' ' + f.name, when: f.when, enabled: true, system: true }],
        migrated: true,
        system: true
      });
    const found = await rules.list(ent(req), req.params.id, true);
    if (!found) return problem(req, res, notHere()); /* S35: lib/folder-rules list asks folderOwned first */
    /* S34: a rule is the columns lib/folder-rules list selects, in its order; note only when b132 is not run */
    // prettier-ignore
    res.json({ rules: found.rules.map((x) => ({ rule_id: x.rule_id, folder_id: x.folder_id, name: x.name, when: x.when, enabled: x.enabled, sort: x.sort, stop_processing: x.stop_processing, last_matched_at: x.last_matched_at, match_count: x.match_count, created_at: x.created_at })), migrated: found.migrated, note: found.note });
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Rules list failed'));
  }
});
router.post('/:id/rules', auth, ...checked('POST /:id/rules'), async (req, res) => {
  try {
    if (INV.byId(req.params.id))
      return problem(req, res, { status: 400, ...said('FOLDER_BAD_REQUEST', 'Fixed rule', "A system folder's rule is part of the folder inventory and cannot be changed here.") });
    const made = await rules.create(ent(req), req.params.id, req.body || {});
    if (!made) return problem(req, res, { status: 404, ...said('NOT_FOUND', 'Not found') }); /* SEC-100: an unknown folder and another shop's folder are one answer */
    /* S34: the rule is the columns the INSERT of lib/folder-rules create RETURNs, in its order */
    // prettier-ignore
    res.json({ rule_id: made.rule_id, folder_id: made.folder_id, name: made.name, when: made.when, enabled: made.enabled, sort: made.sort, stop_processing: made.stop_processing, match_count: made.match_count, created_at: made.created_at });
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Rule create failed'));
  }
});
router.patch('/rules/:rule_id', auth, ...checked('PATCH /rules/:rule_id'), async (req, res) => {
  try {
    const saved = await rules.update(ent(req), req.params.rule_id, req.body || {});
    /* S34: the rule is the columns the UPDATE of lib/folder-rules update RETURNs, in its order */
    // prettier-ignore
    res.json({ rule_id: saved.rule_id, folder_id: saved.folder_id, name: saved.name, when: saved.when, enabled: saved.enabled, sort: saved.sort, stop_processing: saved.stop_processing, match_count: saved.match_count });
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Rule update failed'));
  }
});
router.delete('/rules/:rule_id', auth, ...checked('DELETE /rules/:rule_id'), async (req, res) => {
  try {
    const gone = await rules.remove(ent(req), req.params.rule_id);
    if (!gone.deleted) return problem(req, res, { status: 404, ...said('NOT_FOUND', 'Rule delete failed', 'Rule not found') }); /* S35: the words PATCH /rules/:rule_id answers for a rule this shop does not hold */
    res.json({ deleted: gone.deleted }); /* S34: the count lib/folder-rules remove answers */
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Rule delete failed'));
  }
});
/* ⚠️ PREVIEW BEFORE SAVE — the most useful route here. A rule is a promise about the future written by someone
   who cannot see it; running it against chits that already exist turns "I think this catches supplier invoices"
   into a list you can read first. Needs no rules table, so it works before b132 is run. */
router.post('/rules/preview', auth, ...checked('POST /rules/preview'), async (req, res) => {
  try {
    const seen = await rules.preview(ent(req), (req.body || {}).when, req.body || {});
    /* S34: every key lib/folder-rules preview answers; a sample chit is the six keys it names */
    // prettier-ignore
    res.json({ scanned: seen.scanned, matched: seen.matched, sample: seen.sample.map((x) => ({ chit_id: x.chit_id, subject: x.subject, counterparty: x.counterparty, direction: x.direction, status: x.status, created_at: x.created_at })) });
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Preview failed'));
  }
});
/* The condition vocabulary, served to the UI so the builder cannot offer a term the matcher does not know. */
router.get('/rules/vocabulary', auth, (req, res) => {
  try {
    res.json({ keys: require('../lib/match').KEYS });
  } catch (err) {
    problem(req, res, failed(err, req, 'Failed'));
  }
});
/**
 * GET /rules — EVERY rule this entity has, across all folders.
 *
 * Athi, 2026-08-10: *"even in task, bring metrics and rules as icon, give the same ux and functionalities."*
 *
 * ⚠️ THE TRACK NEEDS THIS MORE THAN A FOLDER DOES. Inside one folder you see the three rules that file into it;
 * what you cannot see is that two OTHER folders are also claiming supplier invoices, and which one wins depends on
 * sort order and stop_processing. Rules only conflict with each other, so the only place a conflict is visible is
 * the list of all of them.
 *
 * ⚠️ NO NEW LIST FUNCTION — rules.list() already treats a missing folder_id as "all", so this is the same query
 * with one argument dropped, not a second implementation that can drift from the first.
 */
router.get('/rules', auth, ...checked('GET /rules'), async (req, res) => {
  try {
    const found = await rules.list(ent(req), null);
    const answer = PL.pageOut('rules', found.rules, PL.pageArgs(req.query, PAGE_DEFAULT, PAGE_MAX));
    /* S34: a rule is the columns lib/folder-rules list selects (folder_rule: migrations/000_baseline_2026-10-21.sql), then what the list adds (note only when b132 is not run; capped and cap_note only when the pager cut the list) */
    // prettier-ignore
    res.json({ rules: answer.rules.map((x) => ({ rule_id: x.rule_id, folder_id: x.folder_id, name: x.name, when: x.when, enabled: x.enabled, sort: x.sort, stop_processing: x.stop_processing, last_matched_at: x.last_matched_at, match_count: x.match_count, created_at: x.created_at })), migrated: found.migrated, note: found.note, total: answer.total, page: answer.page, limit: answer.limit, capped: answer.capped, cap_note: answer.cap_note });
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Rules list failed'));
  }
});

/* the messages inbox + worklist and the cross-chit sums sit in their own files, the LAST routes of this router, so every path keeps its order (MNT-59) */
router.use(require('./folders-inbox'));
router.use(require('./folders-totals'));

router.openapi = { paths: pathsOf(), schemas: {} };
module.exports = router;
