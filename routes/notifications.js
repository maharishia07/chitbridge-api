// routes/notifications.js — derived notification feed (no notifications table).
// Computed from state_log: recent activity by OTHERS on chits I am a party to.
// OWNS       the Activity feed of the bell and its three routes: the feed with its badge (GET /), the watermark (POST /seen) and the dismissals (POST /dismiss). No notifications table.
// CALLED BY  server.js (mounted at /api/notifications) · the app's bell (public/app/rail-bell.js, app.html).
// FLOW  every route: sign-in → its schema check (lib/bell-contract.js `notifications`) → the handler. A refusal or a fault → problem(req, res, ...), the old { error, message } kept beside the Problem fields
//       (docs/contracts/api-legacy.json); a 500 says only the one generic sentence. The shop is the session's (auth.entityOf), never a body's.
// CARD  22-channels-capture-and-messaging/notifications-and-the-bell
const { frag } = require('../lib/sql-frag'); /* a built SQL fragment is marked; a value is a $n parameter */
const express = require('express');
const counterBill = require('../lib/counter-bill'); // ACC-206 C4: the ONE pick of a bill's total, as SQL
const router = express.Router();
const { problem } = require('../lib/problem'); // API-STANDARD S1: the one error writer
const { notifications: contract, words, faultOf } = require('../lib/bell-contract'); // the contract (each route's operation), the words of a refusal and of a fault
const { query, withEntity } = require('../db');
const log = require('../lib/logger');
const auth = require('../middleware/auth');
const billPrivacy = require('../lib/bill-privacy');
const cost = require('../lib/cost'); // RAIL-146g: is this caller a co-assist without can_see_costs
const { isOwner } = require('../lib/owner'); // the one owner test: a firm request is the OWNER's to answer, never a staff seat's
const connectAsks = require('../lib/connect-asks'); // the requests to connect that wait for this business (the bell's pinned rows and its until-answered count)
const costView = require('../lib/cost-view'); // RAIL-146g: the bell's rows for a blind reader
const markNotices = require('../lib/mark-notices'); // the marks' news (a Query, a reply) beside the chit events
const privateFlag = require('../lib/private-flag'); // the ONE right to read the firm's notes: the bell's internal arm asks it, never a second rule
const PL = require('../lib/page-limit'); /* LIM2: the ONE pager */
const { UUID } = require('../lib/namedentity'); // the one uuid shape
const { boundRead } = require('../lib/bound-read'); // SEC-185: an identities read under its own binding
const { textOf } = require('../lib/input-hygiene');
/**
 * ⭐ THE PERSON'S OWN "SEEN" MARK (b877): the caller's own row when it is one of the organisation's people, else the organisation's row. COALESCE(person, organisation): a person who has never opened the bell reads the
 * organisation's mark, so no badge floods on the day the per-person mark lands (the b157 rule "null = every row is new" would otherwise start every colleague at the full feed). $1 = the organisation, $2 = the caller.
 * Before b877 nobody has a person mark: the answer is the organisation's, exactly as before.
 */
const SEEN_SQL = `SELECT COALESCE(p.notif_seen_at, o.notif_seen_at)::text AS seen FROM identities o LEFT JOIN identities p ON p.identity_id = $2 AND p.parent_entity_id = o.identity_id WHERE o.identity_id = $1`;
const FEED_PAGE = 30,
  FEED_MAX = 100; /* the bell shows the newest thirty */

// GET /api/notifications?limit= — recent activity (newest first) on my chits, excluding my own actions.
/**
 * ⭐ WHICH state_log ROWS ARE THIS CALLER'S FEED — one fragment, read by the feed AND by the badge count, so the
 * two can never disagree about what counts (2026-09-28). $1 = the caller's entity, $2 = the caller.
 *   · F3 (P0 isolation): only the caller's OWN copy's state_log row, OR a genuinely cross-party event. Stops the
 *     counterparty's INTERNAL actions (read / archive / delete / restore / internal assign + their actor names)
 *     leaking into this feed; disputes/voids still cross. Status changes already fan a row to each copy
 *     (chits.js:688), so a counterparty status change still shows via the caller's own row.
 *   · ⚠️ DISMISSED IS HIDDEN, NEVER DELETED — b164. The feed is a VIEW over state_log, the trail that
 *     traceability and disputes are built on; clearing a notification must not touch the event.
 *   · The inner ORDER BY leads with the DISTINCT ON keys (Postgres requires it); the caller sorts newest-first
 *     OUTSIDE and applies its LIMIT there — see the DISTINCT ON note in the feed below.
 */
/** how far back the feed and the badge look — an integer, so it is safe inside the SQL text below */
const FEED_DAYS = Math.max(1, parseInt(process.env.NOTIF_FEED_DAYS || '90', 10) || 90);
/* RAIL-216: the buyer's `payment_marked` row has a NULL actor ON PURPOSE — `sl.action_by_identity_id <> $2` is then NULL (not true), so the bell and the badge never count it; do not rewrite that test as IS DISTINCT FROM (tests/rail-216-void-paid.test.cjs section 10) */
const FEED_FROM = `FROM state_log sl
         JOIN chit_status cs
           ON cs.chit_id = sl.chit_id AND cs.entity_id = $1 AND cs.deleted_at IS NULL
         LEFT JOIN chit_header ch
           ON ch.chit_id = sl.chit_id AND ch.entity_id = $1 AND ch.direction = cs.direction
        WHERE (sl.action_by_identity_id <> $2
               OR sl.action IN ('dispute_raised','dispute_resolved','voided'))
          AND ( sl.entity_id = $1 OR sl.action IN ('dispute_raised','dispute_resolved','voided') )
          /* ⭐⭐ ON A BILL, THE OTHER SHOP'S OWN STEPS ARE NOT MY NEWS (lib/bill-privacy, Athi 2026-10-01): its accepting, its goods-in —
             including rows fanned here before that rule — never ring my bell. The dispute and what its folder made external do. */
          AND NOT (${billPrivacy.billSql('ch', 'cs')} AND ${billPrivacy.foreignStepSql('sl', '$1')})
          /* A JOB chit's received copy is the sending firm's assignment record, not the client's work: never the client's news (Fable review A4; lib/work-rows keeps it out of the rows by the same marker) */
          AND NOT (cs.direction = 'received' AND ch.business_json ? 'job')
          AND NOT EXISTS (SELECT 1 FROM notif_dismissed nd
                           WHERE nd.entity_id = $1 AND nd.log_id = sl.log_id)
          /* ⚠️ BOUNDED (external review 2026-09-25): with no date bound this re-sorted the shop's WHOLE state_log on every
             poll and grew without limit. idx_state_log_entity (entity_id, created_at DESC) already exists; the bound is
             what lets it serve the read. The bell shows the newest thirty anyway — ninety days is far beyond that. */
          AND sl.created_at > now() - interval '${FEED_DAYS} days'
        ORDER BY sl.chit_id, sl.action, sl.created_at DESC, sl.detail`;

/**
 * the badge answer: { count, total, seen_at } for ?count=1 (the route decides the person and the page; this only asks the one statement)
 * ── ⭐⭐ ?count=1 — THE BADGE'S OWN QUESTION, IN ONE STATEMENT (2026-09-28, BACKLOG "THE BADGE COSTS A FULL
 * FEED READ") ─────────────────────────────────────────────────────────────────────────────────────────────
 * The badge needs ONE number. Asking for it through the feed cost an unscoped identities read, a withEntity
 * over the DISTINCT ON join returning up to thirty full rows, and a second withEntity for notif_seen_at —
 * three transactions. This is one withEntity, one statement: the same rows (FEED_FROM), the same newest-
 * `limit` window, the same rule (newer than notif_seen_at, messages excluded). Same number, nothing else sent.
 * notif_seen_at is read through to_jsonb, so before b157 every row counts, exactly as the feed does.
 */
async function badgeOf(entity_id, caller_id, limit, internal, mayAnswer) {
  /* the marks' news counts since the same watermark, inside this ONE statement (lib/mark-notices newsCte); without mark_notices (b870 not run) or if it fails, the count alone, as before */
  const countOf = (withNews) =>
    withEntity(entity_id, (db) =>
      db.query(
        `WITH me AS (${SEEN_SQL})${frag(withNews ? ', ' + markNotices.newsCte(limit, internal) : '')}
     SELECT count(*) FILTER (WHERE d.action <> 'message_sent'
                               AND ((SELECT seen FROM me) IS NULL OR d.created_at > (SELECT seen FROM me)::timestamptz))::int AS count,
            count(*)::int AS total,
            (SELECT seen FROM me) AS seen_at${frag(withNews ? ', ' + markNotices.newsColumns('(SELECT seen FROM me)') : '')}${connectAsks.badgeAsksSql(mayAnswer)}
       FROM (SELECT x.action, x.created_at
               FROM (SELECT DISTINCT ON (sl.chit_id, sl.action, sl.created_at, sl.detail) sl.action, sl.created_at
                     ${FEED_FROM}) x
              ORDER BY x.created_at DESC
              LIMIT $3) d`,
        [entity_id, caller_id, limit]
      )
    );
  let counted = null;
  /* the news may fail twice: once for "no three-parameter function yet" (asked again in the two-parameter form), once for "no function at all" (the count alone) */
  for (let attempt = 0; attempt < 2 && !counted && !markNotices.absent(); attempt++) {
    try {
      counted = await countOf(true);
    } catch (err) {
      if (markNotices.noteFailure(err, internal) !== 'retry') break;
    }
  }
  if (!counted) counted = await countOf(false);
  const r = counted.rows[0] || { count: 0, total: 0, seen_at: null };
  const asks = r.asks | 0; /* the owner's waiting firm requests: counted until answered, outside the watermark */
  return { count: r.count + (r.news_fresh || 0) + asks, total: r.total + (r.news_total || 0), seen_at: r.seen_at, asks };
}

/** the feed page: the caller's newest events (one statement, the shared fragment FEED_FROM); the DISTINCT ON note inside says why it is wrapped */
function feedPage(handle, entity_id, caller_id, dispute_handler, limit, blind) {
  return handle.query(
    /**
     * ⚠️ DISTINCT ON, BECAUSE chit_status HOLDS TWO ROWS PER ENTITY ON A SELF-CHIT.
     *
     * Athi, 2026-08-15: *"does it make sense?"* — it did not. Measured live: 30 rows for 27 events, the same
     * delivery listed twice, because the JOIN below matches BOTH the sent and received copy and nothing
     * collapsed them. A person reading this feed would count two deliveries where one happened.
     *
     * ⚠️ AND THIS IS THE FOURTH PLACE TODAY. The worklist showed every person double, b150 wrote every delivery
     * twice, the message inbox needed a LATERAL, and now this. Any join to chit_header or chit_status without
     * a direction filter or a LIMIT 1 is doubling something.
     */
    /* ⚠️ WRAPPED. DISTINCT ON forces its own keys to lead the ORDER BY, which would hand back a feed grouped
     by chit instead of newest-first. Dedupe inside, sort outside, LIMIT outside — in that order, or the LIMIT
     truncates a chit-ordered list and the newest events fall off the end. */
    `SELECT * FROM (
    SELECT DISTINCT ON (sl.chit_id, sl.action, sl.created_at, sl.detail)
          /* ⚠️ log_id IS THE HANDLE A DISMISSAL NEEDS. Without it the client can only DESCRIBE a row
             ("that delivery, at that time"), and a description is not an identity — two events a second
             apart would clear each other. */
          sl.log_id,
          sl.chit_id, sl.action, sl.action_by_display_name,
          sl.new_status, sl.detail, sl.created_at, cs.direction,
          cs.assigned_to_actor_id,
          ch.auto_subject, ch.manual_subject,
          /* O3: a NEW order row says what it is and what it is worth - read from the header, never worked out */
          ch.purpose, ${counterBill.billTotalSql('ch')}::text AS total_value, ch.summary_json->>'currency_code' AS currency_code,
          ch.summary_json->'order_details'->>'channel' AS order_channel, ch.summary_json->'order_details'->>'fulfilment' AS order_fulfilment,
          (cs.assigned_to_actor_id = $2)                                           AS assigned_to_me,
          (sl.action IN ('dispute_raised','dispute_resolved') AND $2 = $3) AS dispute_for_me${costView.feedColsSql('ch', blind)}
    ${FEED_FROM}
  ) d
  ORDER BY d.created_at DESC
  LIMIT $4`,
    [entity_id, caller_id, dispute_handler, limit]
  );
}

/** the watermark, read LAST on the feed's own handle: { seen, warnings } */
async function watermarkOn(handle, entity_id, caller_id) {
  /* the watermark is read LAST and may fail (pre-b157, or a read that errs): the feed and the news are already in hand, the aborted transaction only rolls back a read, so the bell carries on with every row new, and SAYS so (warnings) */
  let seen = null;
  let warnings = [];
  try {
    const s = await handle.query(SEEN_SQL, [entity_id, caller_id]);
    seen = s.rows[0] && s.rows[0].seen;
  } catch (e) {
    log.fellBack('notifications GET /: the read failed — carried on without it', e);
    warnings = [{ code: 'NOTIF_SEEN_UNREAD', words: 'The unread count could not be read just now, so every item is shown as new.' }];
  }
  return { seen, warnings };
}


// @does Signed-in caller with an optional page or count -> we read what is new for them, or just the count for the badge -> the notification feed or the number.
router.get('/', auth, ...contract.checked('GET /'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const caller_id = req.identity.identity_id, /* the actor (or entity) actually making the call */ limit = PL.limitOf(req.query.limit, FEED_PAGE, FEED_MAX);
    const internal = privateFlag.mayUse(await privateFlag.rightsOf(req)); /* may this caller read the firm's notes? the bell's internal arm only runs when the notes' own right says so (the seat is on the identity: no read of its own) */

    if (textOf(req.query.count, { trim: false }) === '1') return res.json(await badgeOf(entity_id, caller_id, limit, internal, isOwner(req))); /* the badge's own question, in one statement (badgeOf); the owner's waiting requests ride in it */

    const blind = await cost.isCostBlind(req, entity_id); /* RAIL-146g: ONE cost read; a blind actor's bell carries no purchase total (lib/cost-view) */
    // Entity-level "dispute team": an actor who receives ALL disputes for this entity,
    // regardless of which actor the individual chit is assigned to.
    const h = await boundRead(query, entity_id, `SELECT dispute_handler_actor_id FROM identities WHERE identity_id = $1`, [entity_id]); /* SEC-185: the shop's own row under its own binding, one trip */
    const dispute_handler = h.rows[0]?.dispute_handler_actor_id || null;

    // B1 RLS: the feed reads the caller's OWN state_log copy — cross-party events (status/dispute/void) are already
    // fanned into it by the definers — so it scopes cleanly to withEntity(me). (The `OR action IN (...)` branch is a
    // harmless no-op under RLS, since non-own rows aren't visible anyway.)
    /* ⭐ ONE transaction for the feed, the watermark and the marks' news (4 trips → 2 with the dispute-team read): three withEntity calls were three BEGIN · set_config · COMMIT; the extra reads ride the feed's own handle */
    let seen = null;
    let news = [];
    let warnings = [];
    const result = await withEntity(entity_id, async (c) => {
      const feedRead = await feedPage(c, entity_id, caller_id, dispute_handler, limit, blind);
      news = await markNotices.noticesOn(c, limit, internal); /* a Query on my books, a reply in my thread: one more kind of row, newest first with the rest */
      ({ seen, warnings } = await watermarkOn(c, entity_id, caller_id));
      return feedRead;
    });

    /**
     * ⭐ THE BADGE COUNTS WHAT ARRIVED SINCE YOU LAST LOOKED — b157.
     *
     * ⚠️ THE COUNT USED TO BE result.rows.length, i.e. "how many recent events exist", capped by the LIMIT. It
     * read 30 forever whatever you did, and a badge that cannot reach zero is one people stop reading — after
     * which the real event arrives wearing the same number as the noise.
     *
     * Read through to_jsonb so the column may not exist yet: before b157 every row counts as new, which is
     * exactly what the old behaviour was, so an unmigrated environment is no worse off than it is today.
     */
    /**
     * ⚠️ MESSAGES ARE NOT COUNTED HERE — they have their own badge now.
     *
     * Measured on a real account: message_sent was 18 of 30 events, so 60% of this badge was counting things the
     * Messages inbox was ALSO counting, on the same screen, at the same time. Two badges for one fact means
     * clearing one leaves the other still shouting, and the person learns to trust neither.
     *
     * They still APPEAR in the panel — it is an activity feed and the history is worth having. They just do not
     * drive the number.
     */
    const countable = (r) => r.action !== 'message_sent';
    const feed = (await costView.feedRows(result.rows, entity_id, blind)).concat(news).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, limit);
    const fresh = (seen ? result.rows.filter((item) => new Date(item.created_at) > new Date(seen)) : result.rows).filter(countable).length + news.filter((n) => !seen || new Date(n.created_at) > new Date(seen)).length;
    res.json(Object.assign({ notifications: feed, count: fresh, total: result.rows.length + news.length, page: 1, limit, seen_at: seen }, warnings.length ? { warnings } : {}));
  } catch (err) {
    console.error('Notifications error:', err.message);
    problem(req, res, faultOf(err, req, 'Failed to get notifications'));
  }
});

/**
 * POST /api/notifications/seen — move the watermark to now.
 *
 * ⚠️ NO PARAMETER, AND THAT IS THE POINT. b157's definer takes the entity from the session, so a caller cannot
 * clear somebody else's badge. A small thing, but a badge you can silently clear for another person is a badge
 * nobody can trust.
 */
// @does Signed-in caller opens the panel -> we stamp the time they last looked so the badge resets -> a done answer with that time.
router.post('/seen', auth, ...contract.checked('POST /seen'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const r = await withEntity(entity_id, (c) => c.query('SELECT notif_mark_seen() AS at'));
    res.json({ ok: true, seen_at: r.rows[0] && r.rows[0].at });
  } catch (err) {
    /* Pre-b157 the function does not exist. Say so plainly rather than 500 — the panel still opens and still
       lists everything; only the badge cannot yet be cleared. */
    if (err && err.code === '42883') {
      return problem(req, res, { status: 503, ...words.seenNotMigrated() });
    }
    console.error('notif seen:', err.message);
    problem(req, res, faultOf(err, req, 'Failed'));
  }
});

/** the dismissals of one entity: every event it can see now (`all`), or the ids named; ON CONFLICT: a repeat counts once */
function dismissRows(session, entity_id, all, ids) {
  if (all) {
    /* ⚠️ "ALL" MEANS EVERY EVENT THIS ENTITY CAN CURRENTLY SEE, resolved server-side rather than from a list
       the client sends. A client-supplied list is a snapshot of what was on screen when the panel opened —
       anything that arrived since would survive a "clear all" and look like the button failed. */
    return session.query(
      `INSERT INTO notif_dismissed (entity_id, log_id)
         SELECT $1, sl.log_id FROM state_log sl
          WHERE sl.entity_id = $1
       ON CONFLICT DO NOTHING`,
      [entity_id]
    );
  }
  return session.query(
    `INSERT INTO notif_dismissed (entity_id, log_id)
       SELECT $1, x FROM unnest($2::uuid[]) AS x
     ON CONFLICT DO NOTHING`,
    [entity_id, ids]
  );
}

/**
 * POST /api/notifications/dismiss — clear one Activity row, or several, or all of them.
 *
 * ⚠️ IT DELETES NOTHING FROM state_log. The feed is a view over the event trail that traceability, disputes and
 * every "who did what, when" answer are built on. Clearing a panel is not a reason to lose an event, so this
 * records a DISMISSAL and the feed hides what this entity has dismissed. The event survives untouched.
 *
 * ⚠️ PER ENTITY. Two parties see the same event through their own copies; one clearing it must never clear it
 * for the other. RLS on notif_dismissed enforces that, and the insert takes the entity from the SESSION — a
 * body-supplied entity_id would let a caller clear somebody else's feed.
 *
 * Body: { log_ids: [uuid, …] }  ·  { all: true } clears everything currently visible.
 */
// @does A list of event ids, or all (signed-in) -> we clear those notifications for the caller so they stop showing -> how many were cleared.
router.post('/dismiss', auth, ...contract.checked('POST /dismiss'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const all = req.body && req.body.all === true;
    const asked = Array.isArray(req.body && req.body.log_ids) ? req.body.log_ids.filter(Boolean) : [];
    /* K-1 (B2): a value that is no uuid names no event: it clears nothing, as an id nobody has does (it reached unnest($2::uuid[]): 22P02, a 500) */
    const ids = asked.map((logId) => markNotices.uuidOfNotice(logId) || logId).filter((logId) => UUID.test(String(logId))); /* a notice's id ('mk:<uuid>') is cleared under its uuid */
    if (!all && !asked.length) {
      return problem(req, res, { status: 400, ...words.nothingToClear() });
    }
    const internal = all && privateFlag.mayUse(await privateFlag.rightsOf(req));
    const cleared = await withEntity(entity_id, async (session) => {
      const out = await dismissRows(session, entity_id, all, ids);
      /* Clear all covers the derived notices too (Query / reply / note reply): they have no state_log row, so each is cleared under its own uuid */
      return out.rowCount + (all ? await markNotices.clearAllOn(session, FEED_MAX, internal) : 0);
    });
    res.json({ ok: true, cleared });
  } catch (err) {
    /* Pre-b164 the table does not exist. Say which migration, rather than 500 — the panel still works, only the
       clearing does not, and the two need different actions from a human. */
    if (err && (err.code === '42P01' || err.code === '42703')) {
      return problem(req, res, { status: 503, ...words.dismissNotMigrated() });
    }
    console.error('notif dismiss:', err.message);
    problem(req, res, faultOf(err, req, 'Failed'));
  }
});

router.openapi = { paths: contract.pathsOf(), schemas: {} };

module.exports = router;
