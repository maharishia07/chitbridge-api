// routes/folders.js — FOLDERS: a per-entity tree for organising ANY chit (mailing-model). Folders are private per
// OWNS  /api/folders: a per-entity tree for filing any chit, and a folder's chit list (paged; a cut list says so).
// CALLED BY server.js (mounted at /api/folders), the Task and Order lists, the folder panes and rules builder, MIS and the messages inbox.
// FLOW  auth → schema check (lib/folders-contract.js) → the folder read (withEntity) → pageOut; a refusal → problem(req, res, said(...) | faultOf(...)), its old body frozen in docs/contracts/api-legacy.json
// CARD 01-rail-core-the-chit/folders
// entity; filing sets chit_status.folder_id on THIS entity's copy only. Current/Archive reuses chit_status.archived_at.
// chit_status is RLS-protected -> any query touching it runs inside withEntity(caller). The folder table is entity-filtered.
const express = require('express');
const PL = require('../lib/page-limit'); /* LIM2: the ONE pager — asked = a page (server max), not asked = every row, as before */
const PAGE_DEFAULT = 50,
  PAGE_MAX = 200; /* one page of this file's lists */
const FOLDER_LIST_MAX = 100; /* a filed folder's chit list when no page is asked — the ceiling it always had, now said in words (W2-RAIL R2) */
const log = require('../lib/logger');
const router = express.Router();
const { withEntity } = require('../db'); // every folder-table query runs inside withEntity — `folder` is RLS-enforced (b64)
const { safeErr } = require('../lib/respond');
const { problem } = require('../lib/problem'); // API-STANDARD S1: the one error writer; each answer's old body is frozen in docs/contracts/api-legacy.json
const { schemaValidate, sanitise, queryDay } = require('../middleware/validate'); // S9: the request is checked against the route's own schema
const { said, failed, faultOf, schemaOptionsFor, operationFor, pathsOf } = require('../lib/folders-contract'); // the contract (each route's operation) and the words of a refusal
const auth = require('../middleware/auth');

const ent = (req) => auth.entityOf(req);
/** the schema check of one route (its own operation in lib/folders-contract.js), as a list to spread after the gates: a route that takes no input has none */
function checked(route) {
  const operation = operationFor(route);
  return operation.parameters || operation.requestBody ? [schemaValidate(operation, schemaOptionsFor(route))] : [];
}
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

/**
 * GET /groupsum?scope=task|order&folder_id= — 🧮 WHAT DOES THIS PILE ADD UP TO?
 *
 * Athi, 2026-08-11: *"sum all the tasks and find out the total requirement… say 10 parties ordered 1000Kg, on
 * click the down below need to know who are all asked."*
 *
 * ⚠️ OMIT folder_id AND IT SUMS THE WHOLE TRACK, across every folder — Athi: *"at task level, we can ask for that
 * total sum irrespective of the folders."*  That falls out of select.rows() applying no folder predicate unless
 * asked, which is also why reconcile can see 157 while the inbox shows 34.
 *
 * ⚠️ NO ARITHMETIC LIVES HERE. The requirement is lib/consolidate.js (proved 27/0), the matching is
 * lib/itemmatch.js, the value is lib/measure.js. This route chooses the rows and nothing else.
 */
/**
 * ⭐ GET /worklist?due_on=YYYY-MM-DD&actor_id= — one person's lines, across EVERY chit.
 *
 * Athi, 2026-08-12: division of labour, *"so multiple people, devices or anything it can work at the same time."*
 *
 * ⚠️ THIS IS WHAT ASSIGNMENT BUYS. Assigning a line is bookkeeping; this is the payoff — everything Murugan owes
 * today, assembled from twelve different customers. A chit-level model cannot express it at all, because the chit
 * is the smallest thing it can hand to anybody.
 *
 * ⚠️ PRIVATE. Same read as the chit detail's assignment map, entity-scoped under FORCE RLS. It is on the folders
 * router because it is a cross-chit QUERY over your own copies — the same family as /reconcile and /groupsum —
 * not because it has anything to do with folders.
 */
const assign = require('../lib/assign');
/**
 * ⭐ GET /api/folders/messages — EVERY EXTERNAL MESSAGE THAT STILL WANTS ME, ACROSS EVERY CHIT.
 *
 * Athi, 2026-08-15: *"is there any way we can bring all the external messages under one tab, which are not read
 * yet … read, reply etc should be done there only"* and *"can we bring external new messages under rail?"*
 *
 * ⚠️ IT LIVES HERE FOR THE SAME REASON THE WORKLIST DOES: it is a folder-shaped question — one list assembled
 * from every chit — and it is the one thing the per-chit message route structurally cannot answer. Someone with
 * forty open orders had to open forty chits to find the two that had been replied to.
 *
 * ⚠️ NO ENTITY PARAMETER, ANYWHERE. withEntity(me) plus RLS decides which copies exist; a message row is mine
 * only because b67 put it in my audience. There is no widening this query from the client.
 *
 * UNREAD or KEPT — see b156 on why those are two columns and not one flag.
 */
router.get('/messages', auth, ...checked('GET /messages'), async (req, res) => {
  try {
    const all = req.query.all === '1' || req.query.all === 'true';
    const isActor = req.identity && req.identity.identity_type === 'actor';
    const actorId = isActor ? String(req.identity.identity_id) : null;
    const params = [];
    const actorCond = isActor
      ? (params.push(actorId),
        `
            AND EXISTS (
              SELECT 1 FROM chit_line_assignment a
               WHERE a.entity_id = m.entity_id
                 AND a.chit_id   = m.chit_id
                 AND a.assignee_actor_id = $${params.length}::uuid
                 AND (m.line_id IS NULL OR a.line_id = m.line_id)
                 /* the LATEST assignment for that line — a line handed on is no longer theirs */
                 AND a.seq = (SELECT MAX(s.seq) FROM chit_line_assignment s
                               WHERE s.entity_id = a.entity_id AND s.chit_id = a.chit_id AND s.line_id = a.line_id))`)
      : '';
    /**
     * ⭐ ?count=1 — the badge, without the payload (called on every app boot: one integer, not 200 rows and two joins).
     * Unread only: a KEPT message is not news, and a badge that counted it would never fall to zero while anything was pinned.
     */
    if (req.query.count === '1' || req.query.count === 'true') {
      /* ⚠️ THE SAME ACTOR SCOPE AS THE LIST: a badge counting what the actor cannot open would leak HOW MANY customer conversations the business has. */
      const c = await withEntity(ent(req), (db) =>
        db.query(
          `SELECT count(*)::int AS n FROM chit_messages m
          WHERE m.thread_type = 'external'
            AND COALESCE(m.is_dispute, false) = false
            AND m.sender_entity_id <> m.entity_id
            AND to_jsonb(m)->>'read_at' IS NULL
            ${actorCond}`,
          params
        )
      );
      return res.json({ count: (c.rows[0] && c.rows[0].n) || 0 });
    }
    /**
     * ── ⚠️ AN ACTOR SEES ONLY CONVERSATIONS ABOUT WORK THEY HOLD ────────────────────────────────────────────
     *
     * Athi, 2026-08-15: *"can you check all sides, like actor replying, and how does it filter for actors?"*
     *
     * ⚠️ AND WITHOUT THIS IT FILTERED FOR NOBODY. ent(req) resolves an actor to their PARENT ENTITY, so every
     * co-assist opening this screen would read every customer conversation in the business — pricing arguments,
     * complaints, the lot. RLS cannot catch it: every row belongs to the same entity, which is precisely what RLS
     * scopes to. The boundary here is between two people INSIDE one business, and only this route knows it
     * exists. Exactly the hole the worklist had, in a place where the content is far more sensitive.
     *
     * The rule matches the worklist's: the caller's own actor id WINS when the caller is an actor, and is never
     * a parameter they can set. A line message reaches them if the line is theirs; a chit-wide message reaches
     * them if they hold ANY line on that chit — otherwise "ring me before you load" would be invisible to the
     * person actually loading.
     */
    const rows = await withEntity(ent(req), async (db) => {
      /* Read through to_jsonb so b156 need not be applied for the screen to load — an unmigrated environment
         gets every external message rather than a 500, which is the honest degradation. */
      const cond = all ? '' : " AND (to_jsonb(m)->>'read_at' IS NULL OR (to_jsonb(m)->>'kept')::boolean) ";
      const q = await db.query(
        `SELECT m.message_id, m.chit_id, m.line_id, m.sender_display_name, m.sender_entity_id,
                m.message_text, m.created_at, m.msg_type,
                to_jsonb(m)->>'read_at'                            AS read_at,
                COALESCE((to_jsonb(m)->>'kept')::boolean, false)   AS kept,
                h.manual_subject, h.auto_subject,
                /* 'order' = a chit I sent · 'task' = one I received. The same two words the rail uses, so the
                   chip on a message and the tab it belongs to cannot drift apart. */
                CASE WHEN h.direction = 'sent' THEN 'order' ELSE 'task' END AS track,
                l.particulars,
                /**
                 * ⭐ THE CHIT'S STATE TRAVELS WITH THE MESSAGE, BUT DOES NOT FILTER IT.
                 *
                 * ⚠️ AND THAT IS THE OPPOSITE OF THE WORKLIST, DELIBERATELY. There, a closed chit's lines are
                 * removed — finished work is not work. Here, a message on a CLOSED chit is often the most
                 * important thing in the inbox: "you marked it complete but the dal never came" arrives exactly
                 * then, and an inbox that hid it would hide the one message that needed answering.
                 *
                 * So the status is shown, never used to drop a row. Verified live: both parties marked this chit
                 * completed and three unread messages stayed — which is right, and was previously invisible.
                 */
                st.current_status AS chit_status
           FROM chit_messages m
           /* ⚠️ LATERAL + LIMIT 1. chit_header has no unique constraint on (entity_id, chit_id) and a self-chit
              holds two rows for one entity — a plain join here doubles every message. Third time this table has
              had to be joined this way; the pattern is the fix, not a workaround. */
           /**
            * ⭐ WHICH TRACK THE CONVERSATION BELONGS TO — Athi, 2026-08-15: *"messages are for both task and
            * order, or only for order? How do we differentiate — is it for my order, or is this a task message?"*
            *
            * ⚠️ THE INBOX NEVER CARRIED IT, and the two are different work: "did they answer MY order" and "the
            * customer said something about the job they gave me" arrive in the same list looking identical.
            * chit_header.direction already decides it everywhere else — 'sent' is Order, 'received' is Task.
            *
            * ⚠️ ORDER BY direction, NOT A BARE LIMIT 1. A self-chit holds BOTH rows for one entity, so an
            * unordered pick would label the same conversation Order on one refresh and Task on the next. Sent
            * wins, matching how the chit list itself resolves the same ambiguity.
            */
           LEFT JOIN LATERAL (
             SELECT manual_subject, auto_subject, direction FROM chit_header
              WHERE entity_id = m.entity_id AND chit_id = m.chit_id
              ORDER BY (direction = 'sent') DESC LIMIT 1) h ON true
           LEFT JOIN chit_line l
                  ON l.entity_id = m.entity_id AND l.chit_id = m.chit_id AND l.line_id = m.line_id
           /* LATERAL again — chit_status has no unique constraint on (entity_id, chit_id) either. */
           LEFT JOIN LATERAL (
             SELECT current_status FROM chit_status
              WHERE entity_id = m.entity_id AND chit_id = m.chit_id AND deleted_at IS NULL
              ORDER BY updated_at DESC NULLS LAST LIMIT 1) st ON true
          WHERE m.thread_type = 'external'
            AND COALESCE(m.is_dispute, false) = false
            /* ⚠️ NOT MY OWN. An inbox that lists what I sent is a sent-box wearing an unread badge — the count
               would never fall, because nothing marks my own words as read for me. */
            AND m.sender_entity_id <> m.entity_id
            ${cond}
            ${actorCond}
          ORDER BY m.created_at DESC
          LIMIT 200`,
        params
      );
      return q.rows;
    });
    const answer = PL.pageOut('messages', rows, PL.pageArgs(req.query, PAGE_DEFAULT, PAGE_MAX));
    /* S34: a message is the columns the statement above selects (chit_messages: migrations/000_baseline_2026-10-21.sql, read_at and kept through to_jsonb), then the pager's keys (capped and cap_note only when it cut the list) */
    // prettier-ignore
    res.json({ count: rows.length, messages: answer.messages.map((x) => ({ message_id: x.message_id, chit_id: x.chit_id, line_id: x.line_id, sender_display_name: x.sender_display_name, sender_entity_id: x.sender_entity_id, message_text: x.message_text, created_at: x.created_at, msg_type: x.msg_type, read_at: x.read_at, kept: x.kept, manual_subject: x.manual_subject, auto_subject: x.auto_subject, track: x.track, particulars: x.particulars, chit_status: x.chit_status })), total: answer.total, page: answer.page, limit: answer.limit, capped: answer.capped, cap_note: answer.cap_note });
  } catch (err) {
    console.error('messages inbox:', err);
    problem(req, res, failed(err, req, 'Failed'));
  }
});

/**
 * POST /api/folders/messages/:message_id/mark  { read?: bool, kept?: bool }
 *
 * ⚠️ THE ENTITY IS NEVER A PARAMETER. b156's definer reads it from the session, so a caller cannot mark the
 * COUNTERPARTY's copy read — which would be both a lie about what they have seen and a way to make a message
 * vanish from someone else's inbox. Exactly the "server trusts the client's claim about identity" pattern the
 * reviewer named in July, refused up front this time.
 */
router.post('/messages/:message_id/mark', auth, ...checked('POST /messages/:message_id/mark'), async (req, res) => {
  const id = String(req.params.message_id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return problem(req, res, { status: 400, ...said('FOLDER_BAD_REQUEST', 'Bad request', 'message_id must be a uuid') });
  const read = 'read' in req.body ? !!req.body.read : null;
  const kept = 'kept' in req.body ? !!req.body.kept : null;
  try {
    const n = await withEntity(ent(req), (db) => db.query('SELECT chit_message_mark($1::uuid,$2::boolean,$3::boolean) AS marked_count', [id, read, kept]));
    const touched = (n.rows[0] && Number(n.rows[0].marked_count)) || 0;
    /* 404 rather than a silent 200: a message id that matched nothing of MINE is either not mine or not real,
       and both deserve to be said rather than reported as a successful no-op. */
    if (!touched) return problem(req, res, { status: 404, ...said('NOT_FOUND', 'Not found', 'No such message in your copies.') });
    res.json({ ok: true, updated: touched });
  } catch (err) {
    if (err && err.code === '42883') {
      return problem(req, res, { status: 503, ...said('FOLDER_NOT_MIGRATED', 'Not migrated', 'Message read state needs b156 on this environment.') });
    }
    console.error('message mark:', err);
    problem(req, res, failed(err, req, 'Failed'));
  }
});

router.get('/worklist', auth, ...checked('GET /worklist'), async (req, res) => {
  try {
    const due = String(req.query.due_on || '').trim();
    if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) return problem(req, res, { status: 400, ...said('FOLDER_BAD_REQUEST', 'Bad request', 'due_on must be YYYY-MM-DD') });
    /**
     * ── ⚠️ AN ACTOR SEES ONLY THEIR OWN WORK, AND IT IS NOT THEIR CHOICE ────────────────────────────────────────
     *
     * `actor_id` arrived as a plain query parameter, so a co-assist could read a colleague's worklist by editing
     * the URL. RLS does not catch it: every row belongs to the same ENTITY, which is exactly what RLS scopes to —
     * the boundary being crossed here is between two people inside one business, and that is a boundary only this
     * route knows about.
     *
     * So the caller's own actor id WINS when the caller is an actor. The entity owner keeps the parameter, because
     * "show me what Murugan has" is the whole point of running the business.
     */
    const isActor = req.identity.identity_type === 'actor';
    const aid = isActor ? String(req.identity.identity_id) : String(req.query.actor_id || '').trim();
    const answer = await assign.byPerson(ent(req), {
      due_on: due || undefined,
      actor_id: /^[0-9a-f-]{36}$/i.test(aid) ? aid : undefined,
      /* So the screen can say "your work" honestly rather than guessing from the row count. */
      _scoped_to_self: isActor
    });
    /* S34: every key lib/assign byPerson answers (scoped_to_self is absent when b153 is not run); the people and their lines are the library's own literals, left open and listed */
    // prettier-ignore
    res.json({ people: answer.people, lines: answer.lines, migrated: answer.migrated, scoped_to_self: answer.scoped_to_self });
  } catch (err) {
    console.error('worklist:', err.message);
    problem(req, res, failed(err, req, 'Worklist failed'));
  }
});

const groupsum = require('../lib/groupsum');
router.get('/groupsum', auth, ...checked('GET /groupsum'), async (req, res) => {
  try {
    const me = ent(req);
    const flags = await policy.get(me);
    const fid = String(req.query.folder_id || '').trim();
    /* ⭐ Optional ticked selection. ⚠️ VALIDATE THE SHAPE AND CAP THE COUNT before it reaches the lib: only
       well-formed uuids pass, so a junk id can never reach a query, and 500 is far above any real selection
       (paging is 50) while keeping an unbounded list out of the request. The lib INTERSECTS these with the
       caller's own rows, so this parameter can only ever narrow what they could already see. */
    const ids = String(req.query.chit_ids || '')
      .split(',')
      .map((item) => item.trim())
      .filter((item) => /^[0-9a-f-]{36}$/i.test(item))
      .slice(0, 500);
    const sum = await groupsum.requirement(me, {
      scope: req.query.scope === 'order' ? 'order' : 'task',
      folder_id: /^[0-9a-f-]{36}$/i.test(fid) ? fid : null,
      archived: req.query.archived === '1',
      chit_ids: ids.length ? ids : undefined,
      overdue_days: flags.overdue_days,
      blind: await cost.isCostBlind(req, me) /* RAIL-146g: ONE cost read; a blind actor's sum counts the shop's sales only */
    });
    /* S34: every key lib/groupsum requirement answers (selected and selection_requested only for a ticked selection) */
    // prettier-ignore
    res.json({ scope: sum.scope, folder_id: sum.folder_id, selected: sum.selected, selection_requested: sum.selection_requested, chits: sum.chits, chits_with_lines: sum.chits_with_lines, chits_without_lines: sum.chits_without_lines, has_catalogue: sum.has_catalogue, requirement: sum.requirement, flags: sum.flags, money: sum.money, cost_hidden: sum.cost_hidden });
  } catch (err) {
    console.error('groupsum:', err.message);
    problem(req, res, failed(err, req, 'Group sum failed'));
  }
});

/**
 * GET /reconcile?scope=task|order — ⭐ DOES THE ARITHMETIC ADD UP?
 *
 * Athi, 2026-08-10: *"total number of tasks in the database should be the sum of all the tasks under the folder,
 * according to its status. so the possible segregation is assigned, unassigned, status like act, open, close,
 * folder and its subfolders list."*
 *
 * ⚠️ THIS IS A RECONCILIATION, NOT A REPORT. Filing moves a chit OUT of the Task list and INTO a folder, so the
 * moment folders exist the headline count stops being the whole truth: Task says 34 while 180 more sit in folders.
 * Anyone reading the list would conclude the work had shrunk. The invariant is
 *
 *        TOTAL  =  unfiled  +  Σ(every folder)
 *
 * and it is ASSERTED here rather than assumed — `reconciles` is false if a single chit is unaccounted for. A
 * number that only balances by accident is a number that will one day not.
 *
 * ⚠️ SUBFOLDERS ROLL UP. A parent that reported only its own rows would make the tree total larger than the sum of
 * its visible branches — so each folder carries `own` (filed directly here) and `tree` (this folder and everything
 * under it). Both are given, because collapsing them loses the ability to check either.
 */
router.get('/reconcile', auth, ...checked('GET /reconcile'), async (req, res) => {
  try {
    const me = ent(req);
    const scope = req.query.scope === 'order' ? 'order' : 'task';
    const direction = scope === 'order' ? 'sent' : 'received';
    const flags = await policy.get(me);

    // ONE read of every copy on this track — filed and unfiled alike. Counting the pieces separately is how two
    // numbers come to disagree; here they are literally partitions of the same array.
    const rows = await select.rows(me, { direction, limit: 5000 });
    const measureSeg = await costView.measurerFor(req, me, rows, { overdue_days: flags.overdue_days }); /* RAIL-146k: ONE side read for overall and every segment */
    const folders = (await withEntity(me, (db) => db.query(`SELECT folder_id, parent_id, name FROM folder WHERE entity_id = $1 ORDER BY sort, name`, [me])))
      .rows;

    const byFolder = new Map();
    let unfiled = 0;
    for (const r of rows) {
      if (!r.folder_id) {
        unfiled++;
        continue;
      }
      byFolder.set(r.folder_id, (byFolder.get(r.folder_id) || []).concat([r]));
    }
    // Roll a folder's own rows up through its ancestors, so `tree` is this folder plus everything beneath it.
    const kids = {};
    folders.forEach((item) => {
      (kids[item.parent_id || 'root'] = kids[item.parent_id || 'root'] || []).push(item);
    });
    /* a folder that is its own ancestor (a parent_id loop) is counted once, not followed round again: the loop used to overflow the stack and answer 500 */
    const treeRows = (fid, walked = new Set()) => {
      if (walked.has(fid)) return [];
      walked.add(fid);
      return (byFolder.get(fid) || []).concat((kids[fid] || []).flatMap((item) => treeRows(item.folder_id, walked)));
    };

    const seg = (list) =>
      Object.assign(measureSeg(list), {
        /* ⚠️ ASSIGNED vs UNASSIGNED is a SEGREGATION, not a status. A chit can be open and unassigned, or open and
         assigned — conflating them hides the pile nobody has picked up, which is the one worth seeing. */
        assigned: list.filter((x) => x.assigned_to_actor_id).length,
        unassigned: list.filter((x) => !x.assigned_to_actor_id).length
      });

    const out = folders.map((item) => {
      const own = byFolder.get(item.folder_id) || [];
      const tree = treeRows(item.folder_id);
      return { folder_id: item.folder_id, parent_id: item.parent_id, name: item.name, own: own.length, tree: tree.length, segments: seg(own) };
    });

    const filed = rows.length - unfiled;
    const summed = out.reduce((total, item) => total + item.own, 0);
    /**
     * ⭐ THE BILLS LEFT THE INBOX, SO THEY ARE COUNTED, NOT LOST (2026-10-01). An unfiled bill is in the Bills folders, not in
     * Task: unfiled = inbox + in_bills, by the same classification the inbox uses (lib/folder-inventory LEAVES over doc_kind).
     */
    const leaves = new Set(INV.LEAVES);
    const inBills = rows.filter((x) => !x.folder_id && leaves.has(x.doc_kind)).length;
    const inbox = unfiled - inBills;
    res.json({
      scope,
      direction,
      total: rows.length,
      unfiled,
      inbox,
      in_bills: inBills,
      filed,
      folders: out,
      overall: seg(rows),
      // ⚠️ The assertion, returned rather than described: `filed` counted from the chits must equal the sum of the
      //    folders' own counts. If it does not, a chit is filed into a folder this entity cannot see.
      reconciles: filed === summed && inbox + inBills + filed === rows.length,
      /* S34: named, not spread: present only when a chit is unaccounted for (undefined is left out of the answer) */
      discrepancy: filed === summed ? undefined : { filed, sum_of_folders: summed, missing: filed - summed }
    });
  } catch (err) {
    problem(req, res, failed(err, req, 'Reconcile failed'));
  }
});

/**
 * ⭐⭐ GET /api/folders/mis — THE SAME MEASUREMENT MIS WAS COMPUTING FOR ITSELF (backlog 29).
 *
 * Athi, 2026-08-16: *"if we have it in MIS, we have to reuse"* → *"backlog metrics, bring uniformity."*
 *
 * There were THREE implementations of "open / overdue / ageing / unread". Two already agreed, because
 * lib/measure.js is shared by the folder Metrics pane and the counterparty scorecard — with the reason written
 * on the endpoint: so a folder and a supplier can never disagree about what open or overdue means. MIS was the
 * third, computing from `inbox`/`sent` in the browser.
 *
 * ⚠️⚠️ AND THE DRIFT WAS ALREADY REAL, not hypothetical. `overdue` is a POLICY — `overdue_days`, set in
 * Settings, obeyed by the folder pane and the scorecard. **MIS never mentioned overdue at all.** The screen
 * titled "What is stuck?" did not know what late meant, so setting overdue to 3 days changed every other
 * surface and left MIS exactly as it was.
 *
 * ⚠️ THE DIRECTION ONLY GOES ONE WAY. MIS consumes the server's measurement; the logic is NOT moved into the
 * browser to be "shared" there, because that would take the folder pane and the scorecard off the definition
 * they already agree on. One authority, three consumers.
 *
 * ⚠️ Both directions in ONE response, measured over ONE read. `all` is not the sum of `received` and `sent` —
 * it is measure() over the whole array, so medians and rates are computed across the real population rather
 * than averaged from two halves, which is the classic way a "combined" figure becomes quietly wrong.
 */
router.get('/mis', auth, queryDay('since'), ...checked('GET /mis'), async (req, res) => {
  try {
    const me = ent(req);
    const flags = await policy.get(me);
    const opts = { overdue_days: flags.overdue_days };
    /* ⚠️ THE PERIOD MUST TRAVEL WITH THE QUESTION. MIS has a window selector (all · 30d · 90d). If it showed
       "last 30 days" beside a figure measured over all time, wiring MIS to this endpoint would fix one
       disagreement by creating another — and a subtler one, because both numbers would look authoritative.
       Validated as a date; anything unparseable is ignored rather than guessed at. */
    const sinceRaw = String(req.query.since || '').trim();
    const since = sinceRaw && !Number.isNaN(Date.parse(sinceRaw)) ? sinceRaw : undefined;
    /* ⚠️ ONE read, then partitioned — counting the halves separately is how two numbers come to disagree.
       Same discipline as /reconcile above, and the same limit. */
    const rows = await select.rows(me, { limit: 5000, since });
    const measured = await costView.measurerFor(req, me, rows, opts); /* RAIL-146k: the reader sides ride in opts.sides */
    const received = rows.filter((item) => item.direction === 'received');
    const sent = rows.filter((item) => item.direction === 'sent');
    /* T3-P4-ACCOUNT: `overdue` follows the rail's one rule (lib/home-facts railMeasure — the shop's own notes are never overdue), so CB Finance › Reports'
       overdue opens CB CRM's stuck list and counts the same chits as Home's rail. Every other figure is lib/measure's own, as before. */
    const M = (xs) => require('../lib/home-facts').railMeasure(xs, me, measured.opts);
    res.json({
      overdue_days: flags.overdue_days,
      /* ⚠️ Echoed back so the caller can prove the window it asked for is the window it got — an ignored `since`
         would otherwise be indistinguishable from an empty one. */
      since: since || null,
      truncated: rows.length >= 5000 /* T3-P4-ACCOUNT: a count over a cut read is said, never painted as the whole */,
      all: M(rows),
      received: M(received),
      sent: M(sent)
    });
  } catch (err) {
    console.error('mis:', err.message);
    problem(req, res, failed(err, req, 'MIS failed'));
  }
});

router.openapi = { paths: pathsOf(), schemas: {} };
module.exports = router;
