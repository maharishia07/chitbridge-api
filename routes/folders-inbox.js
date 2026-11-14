// routes/folders-inbox.js — the messages inbox and the worklist of /api/folders
/**
 * OWNS      GET /messages (the inbox and its ?count=1 badge) · POST /messages/:message_id/mark · GET /worklist.
 * PART OF  routes/folders.js (mounted there with router.use at the end, so every path keeps its order under /api/folders). Moved verbatim with its leading comments (MNT-59); the only changes to the moved code are the one-line require and `ent` declarations each part needs and, in routes/folders.js, `checked`, PAGE_DEFAULT and PAGE_MAX (now from lib/folders-contract.js). The short names PL, ent, INV are kept on purpose: renaming them would make every moved function new code for the readability guard (cleanup PR).
 * CALLED BY routes/folders.js (router.use), the web rail inbox, the messages badge and the worklist.
 * FLOW      auth → schema check (lib/folders-contract.js) → withEntity → the rows → PL.pageOut; a refusal → problem(req, res, said(...) | failed(...))
 * CARD      01-rail-core-the-chit/folders
 */
const express = require('express');
const router = express.Router();
const PL = require('../lib/page-limit');
const { withEntity } = require('../db');
const { problem } = require('../lib/problem');
const { isCalendarDay } = require('../middleware/validate');
const { said, failed, routeChecks: checked, PAGE_DEFAULT, PAGE_MAX } = require('../lib/folders-contract');
const { UUID } = require('../lib/namedentity');
const auth = require('../middleware/auth');

/** the caller's shop (declared as a function so the endpoint card reads it as its own body) */
function ent(req) {
  return auth.entityOf(req);
}
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
  if (!UUID.test(id)) return problem(req, res, { status: 400, ...said('FOLDER_BAD_REQUEST', 'Bad request', 'message_id must be a uuid') });
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
router.get('/worklist', auth, ...checked('GET /worklist'), async (req, res) => {
  try {
    const due = String(req.query.due_on || '').trim();
    if (due && !isCalendarDay(due)) return problem(req, res, { status: 400, ...said('FOLDER_BAD_REQUEST', 'Bad request', 'due_on must be YYYY-MM-DD') });
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
      actor_id: UUID.test(aid) ? aid : undefined,
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

module.exports = router;
