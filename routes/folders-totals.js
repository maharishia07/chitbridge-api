// routes/folders-totals.js — the cross-chit sums of /api/folders
/**
 * OWNS      GET /groupsum · GET /reconcile · GET /mis: what a pile of chits adds up to, whether the folders add up to the track, and the MIS view.
 * PART OF  routes/folders.js (mounted there with router.use at the end, so every path keeps its order under /api/folders). Moved verbatim with its leading comments (MNT-59); the only changes to the moved code are the one-line require and `ent` declarations each part needs and, in routes/folders.js, `checked`, PAGE_DEFAULT and PAGE_MAX (now from lib/folders-contract.js). The short names PL, ent, INV are kept on purpose: renaming them would make every moved function new code for the readability guard (cleanup PR).
 * CALLED BY routes/folders.js (router.use), the web group-sum pane, the metrics pane and the MIS screens.
 * FLOW      auth → schema check → select.rows → lib/measure through costView → res.json; a refusal → problem(req, res, said(...) | failed(...))
 * CARD      01-rail-core-the-chit/folders
 */
const express = require('express');
const router = express.Router();
const { withEntity } = require('../db');
const { problem } = require('../lib/problem');
const { queryDay } = require('../middleware/validate');
const { said, failed, routeChecks: checked } = require('../lib/folders-contract');
const { UUID } = require('../lib/namedentity');
const auth = require('../middleware/auth');
const INV = require('../lib/folder-inventory');
const select = require('../lib/select');
const cost = require('../lib/cost');
const costView = require('../lib/cost-view');
const policy = require('../lib/policy');

/** the caller's shop (declared as a function so the endpoint card reads it as its own body) */
function ent(req) {
  return auth.entityOf(req);
}
const groupsum = require('../lib/groupsum');
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
      .filter((item) => UUID.test(item))
      .slice(0, 500);
    const sum = await groupsum.requirement(me, {
      scope: req.query.scope === 'order' ? 'order' : 'task',
      folder_id: UUID.test(fid) ? fid : null,
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

module.exports = router;
