// routes/chits.js — Chit send, inbox, detail, status update
/**
 * owns: the chit routes — send (the fan-out of co-held copies), the lists (inbox · sent · folder), the read (GET /:id with the
 *       rail's `actions`), moveStatus (the ONE status writer, through lib/rail-status), amend · reprice · assign · deliver,
 *       disputes, and the housekeeping of MY copy (delete · restore · archive · unarchive · purge · star · unread).
 * called by: the web app (EP map in app.html · cap-chit2.js · chit-sheet.js), the till, lib/autoraise, CTP's deliver door.
 * FLOW  auth → entityId(req) → withEntity(me) → the rail's verdict (rail-actions / rail-status / canHousekeep) → the write → res
 * INIT  express → lib (logger · money · rail-actions · dispute-may · rail-status · assign-chit) → db → the routes in file order
 *       (every literal path — /sent · /folder · /raida/report — is mounted BEFORE /:chit_id, so a word is never read as an id)
 * // CARD 01-rail-core-the-chit/chits-routes
 */
const express = require('express');
const cbLog = require('../lib/logger');
const {
  round: roundMoney
} = require('../lib/money'); /* ⭐ money.round — the one rounder (SPEC-money-one-reader.md): half away from zero, on the decimal value */
const router = express.Router();
const { safeErr } = require('../lib/respond');
const railActions = require('../lib/rail-actions'); // ⭐ R01 — the rail engine: GET's `actions` and every rail route's refusal, one rule
const disputeMay = require('../lib/dispute-may'); // T3-DISPUTES-ASSIST — may I raise / resolve: the answer GET returns and the resolve route refuses with
const { moveStatus, stampCancelRequested, stampCancelConfirmed, ringStatus } = require('../lib/chit-move'); // the ONE status writer (and the two cancel flags its legs stamp, the bell of a move) (lifted out of this route, LEAN-PLAN §8 #3): PUT /:chit_id/status and goods-in call it
const { definersReady, crossing, crossingIn, postMessageCopies } = require('../lib/chit-crossing'); // how a chit write reaches the other copies (lifted with moveStatus)
const ctpReturn = require('../lib/ctpreturn'); // ⭐ RAIL-106 — the return path: a status or an external message reaches a party on another installation (queued, resent), a dispute across installations is refused in words
const railStatus = require('../lib/rail-status'); // ⭐ T1-RAIL — the ONE status write (read → rail.move → UPDATE); no other SET current_status
const { assignChit, taskCount } = require('../lib/assign-chit'); // ⭐ W1-RAIL · TA1 — the ONE writer of who holds a chit and of a person's task count
const ownBill = require('../lib/counter-bill'); // ⭐ W2-REW — the shop's bill by its number: the duplicate check here, the points in reward-store
const log = require('../lib/logger');
const { v4: uuidv4 } = require('uuid');
const { query, withTransaction, withEntity, trySavepoint } = require('../db');
const storage = require('../lib/storage');
const docnumber = require('../lib/docnumber'); // what a document number may look like, per country
const { tillClaimOf } = require('../lib/holder'); // M11 — a phone's bill names its device and person; checked against the session
const CLOCK = require('../lib/shop-clock'); // ⭐ Y1b — a chit's sent_at/created_at are the SHOP CLOCK's moment (the system clock in life; set by tools/sim-load.cjs), never SQL NOW()

/**
 * ⭐ THE SHOP'S JURISDICTION, MEMOISED FOR FIVE MINUTES.
 *
 * ⚠️ A BILL MUST NOT PAY A ROUND TRIP TO LEARN A FACT THAT CHANGES ONCE IN A SHOP'S LIFETIME. This API runs in
 * San Francisco and the database is in Mumbai, so an uncached read here would put a Pacific crossing on every
 * counter sale to answer "which country" — a question whose answer is the same every time.
 * ⚠️ Five minutes, not forever: a shop that corrects its country should not have to wait for a deploy.
 */
const _countryMemo = new Map();
async function countryOfEntity(entity_id) {
  const hit = _countryMemo.get(entity_id);
  if (hit && hit.at > Date.now() - 300000) return hit.c;
  let c = null;
  try {
    const r = await query(`SELECT country, gstn FROM identities WHERE identity_id = $1`, [entity_id]);
    const row = r.rows[0] || {};
    c = require('../lib/profile').countryOf({ country: row.country, gstin: row.gstn });
  } catch (e) {
    cbLog.fellBack('chits countryOfEntity: the read failed — carried on without it', e); /* ⚠️ a bill must never fail because we could not look up a country */
  }
  _countryMemo.set(entity_id, { c: c, at: Date.now() });
  return c;
}
/* Cached "does the database actually have this?" probe — cheaper than a savepoint and truer than a guess. */
const schema = require('../lib/schema');
const { copyRetention } = require('../lib/retention'); /* SET-26: one copy's retention days + source (the one MAX) */
const { sanitise } = require('../middleware/validate'); // S9: a request is checked against the route's own schema, by routeChecks (lib/chits-contract)
const { problem } = require('../lib/problem'); // API-STANDARD S1: the one error writer; each answer's old body is frozen in docs/contracts/api-legacy.json
const { said, failed, faultOf, codeOfStatus, railSaid, operationFor, pathsOf, routeChecks: checked } = require('../lib/chits-contract');
const { PRIORITIES, trimmedBody, recipientsRule, LIST_MAX, LIST_PAGE } = require('../lib/chits-input'); // the inputs the express-validator chains used to check: the one list of priorities, the trim, the recipients rule // the contract (each route's operation) and the words of a refusal
const auth = require('../middleware/auth');
const trace = require('../lib/trace');
const mint = require('../lib/mint'); // ⚠️ the SHAPE of a chit — one place, four call sites
const amend = require('../lib/amend'); // ⚠️ b138 — corrections ride ALONGSIDE the reading; line_items never mutate
const assign = require('../lib/assign');
const policy = require('../lib/policy'); // ⚠️ backlog 11 — each copy owner's retention FLOOR, applied at the mint
const deliverline = require('../lib/deliverline');
const cost = require('../lib/cost');
const raida = require('../lib/raida'); // b182 — the register on a line
const reprice = require('../lib/reprice'); // pull catalogue prices onto a chit — as AMENDMENTS, never a silent edit // ⚠️ b145 — PRIVATE + write-without-read; the gate is here, RLS cannot express it // ⚠️ b144 — per-line delivery. SHARED: replicated into every copy // ⚠️ b143 — who is doing which line. PRIVATE; never crosses to a counterparty
const itemmatch = require('../lib/itemmatch'); // ⚠️ THE one matcher — same resolution the raise path used
/* TAX ON THE CHIT (STUDY-gst-structure §6, 2026-09-04): the shelf that rates a line at send, the line rater, the freeze at completed. */
const regional = require('../lib/regional');
const catalogueView = require('../lib/catalogue-view');
const taxShelf = require('../lib/tax-shelf');
const taxLines = require('../lib/tax-lines');
const taxEngine = require('../lib/tax'); // ⭐ moneyOf — the ONE reading of an issued invoice (the counter's CBTax.moneyOf)
const taxCopy = require('../lib/tax-copy');
const billPaper = require('../lib/bill-paper'); /* CTRY-76: the paper a counter bill is, read once at send from the shop's pack — held, or a refused buyer tax id */
const localIdentity = require('../lib/local-identity'); /* mayTrade — may this party trade with this shop (onRail + population, b249's rule, at the door) */
const istest = require('../lib/istest'); /* RAIL-LAB-SRV1: isLabChit · maySample — the one lab rule (b249's population axis), at the send door */
/* ⭐⭐ THE INBOX PREDICATE (lib/folder-inventory inboxSql) — bills are not tasks: a received bill and the shop's own counter bill
   live in the Bills folders. The SAME classification the folders read through lib/select.js, so the two can never disagree. */
const FOLDER_INV = require('../lib/folder-inventory');
/* ⭐⭐ A BILL'S STEPS STAY WITH THE SHOP THAT TOOK THEM, at its folder's messaging level (lib/bill-privacy, Athi 2026-10-01) */
const billPrivacy = require('../lib/bill-privacy');
/* ⭐ RAIL-146: what a cost-blind co-assist may READ of a chit — the five reads (GET /:chit_id · /inbox · /folder · /sent · /rollup) answer through it, answer-side only */
const costView = require('../lib/cost-view');
/* ⭐ RAIL-147: what such a co-assist may WRITE — POST /:chit_id/amend and /reprice ask lib/cost-write (403 COST_BLIND on a cost-side chit's money, an omitted price kept from the stored line) */
const costWrite = require('../lib/cost-write');

// The acting entity for RLS/ownership: an actor carries parent_entity_id; a bare entity login is its own id.
// Single source of truth (was duplicated 26× as `auth.entityOf(req)`).
const entityId = (req) => auth.entityOf(req);
/* "Do I hold a copy of this chit?" — the one probe /amend, /reprice, /costs and /assign-lines ask before writing (RAIL-128) */
const holdsCopy = async (entity_id, chit_id) =>
  (await withEntity(entity_id, (db) => db.query(`SELECT 1 FROM chit_header WHERE chit_id = $1 AND entity_id = $2`, [chit_id, entity_id]))).rows.length > 0;


/**
 * ⭐⭐ THE ONE THING A TILL KEY MAY SEND BEYOND ITSELF — the two-sided counter bill (Athi, 2026-10-01: *"naming a connected
 * customer on a credit or named bill IS the sending"*). The key lives on a shop PC anyone can pick up, so the door opens
 * exactly this wide and no wider:
 *   · a COUNTER BILL (a bill number from a till — lib/tax-copy counterIssued), purpose 'order'
 *   · ONE outside recipient, as 'to', addressed by entity id
 *   · who is the bill's own customer (business_json.customer.entity_id) — the counter names whom it is billing
 *   · and is on THIS shop's customer list AND a business on the rail (lib/local-identity onRailSql — the same test the
 *     counter's snapshot made when it offered them) AND in the same sandbox (lib/istest mayTradeSql — b249's rule).
 *
 * ⭐⭐⭐ TWO KINDS OF NO, AND ONLY ONE OF THEM REFUSES THE BILL (Athi, 2026-10-02: *"if another customer who is not in our
 * network if the bill raised against him on credit, still we have to proceed, but only thing is it is not two ways"*).
 *   · { refuse }   — the SHAPE is wrong (two parties, a cc, not a counter bill, a customer the bill does not name). That is
 *                    not a sale this key may record at all: 403, code TILL_SEND_REFUSED.
 *   · { oneSided } — the shape is right but the customer cannot receive their copy (not on the list, not on ChitBridge,
 *                    no longer active, another sandbox, or the check could not run). THE SALE IS THE SHOP'S OWN RECORD and
 *                    is recorded with its ledger; only the customer's copy is dropped, and the answer says why.
 * ⚠️ Before this, both were a bare 403 that the counter read as "key refused" — two bills sat pending with the network green.
 */
async function tillMaySend(sender_id, outward, payload) {
  const b = payload || {},
    bj = b.business_json || {};
  if (outward.length !== 1) return { refuse: 'a counter bill can go to one customer only' };
  const r = outward[0];
  if (String(r.role || 'to').toLowerCase() !== 'to') return { refuse: 'a counter bill can only be addressed "to" its customer' };
  if (String(b.purpose || 'order') !== 'order' || !taxCopy.counterIssued(bj)) return { refuse: 'it is not a counter bill (no bill number or counter on it)' };
  const eid = String(r.entity_id || '');
  if (!/^[0-9a-f-]{36}$/i.test(eid)) return { refuse: 'the customer has no ChitBridge id on this bill' };
  if (!bj.customer || String(bj.customer.entity_id || '') !== eid) return { refuse: 'the bill names a different customer from the one it is sent to' };
  const who = r.name || (bj.customer && bj.customer.name) || 'this customer';
  try {
    const ok = await withEntity(sender_id, (db) =>
      db.query(
        `SELECT 1 AS ok FROM customer_list c JOIN identities i ON i.identity_id = c.customer_identity_id
        WHERE c.owner_entity_id = $1 AND c.customer_identity_id = $2 AND ${localIdentity.mayTradeSql('i', '$1')}
        LIMIT 1`,
        [sender_id, eid]
      )
    );
    if (ok.rows.length === 1) return null;
    /* the second look only says WHICH rule failed, so the words on the bill are the true ones */
    const listed = await withEntity(sender_id, (db) =>
      db.query(`SELECT 1 AS ok FROM customer_list WHERE owner_entity_id = $1 AND customer_identity_id = $2 LIMIT 1`, [sender_id, eid])
    );
    if (!listed.rows.length) return { oneSided: who + " is not on this shop's customer list" };
    const v = await localIdentity.mayTrade(sender_id, eid);
    return { oneSided: v.ok ? who + ' could not be sent their copy' : v.say };
  } catch (_) {
    return { oneSided: 'the customer could not be checked just now' };
  }
}

// Run a b50/b51/b52 definer inside withEntity(caller); before the delivery layer is applied, run the legacy
// direct-SQL fallback instead (fallback(db) receives the tx client). Keeps every crossing feature working
// before/after the migration; once the fns exist the definer path wins, so writes cross safely + audited.
// b63 folders: is chit_status.folder_id present? Cached probe so the inbox can hide FILED chits (mailing-model "move"
// is a QUERY, not data movement — the chit stays put; Task just excludes what's filed) WITHOUT ever erroring if the
// migration isn't applied yet. Self-heals the moment the column exists.
let _folderColReady = null;
async function folderColReady() {
  if (_folderColReady !== null) return _folderColReady;
  try {
    const r = await query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'chit_status' AND column_name = 'folder_id' LIMIT 1`);
    _folderColReady = r.rows.length > 0;
  } catch (e) {
    cbLog.fellBack('chits folderColReady: the read failed — answered no', e);
    _folderColReady = false;
  }
  return _folderColReady;
}


// Connection check removed — existence check only
// Sender can send to any entity that exists in the system

// ─── Helper: Generate auto subject ───────────────────────────
const generateAutoSubject = (purpose, senderName, date, clock) => {
  const purposes = {
    order: 'Order',
    invoice: 'Invoice',
    receipt: 'Receipt',
    inquiry: 'Inquiry',
    delivery_note: 'Delivery Note',
    credit_note: 'Credit Note',
    general: 'Message'
  };
  const label = purposes[purpose] || 'Chit';
  const dateStr = require('../lib/country-setup').datePhrase(date, clock); /* N3: the shop's locale and zone, India's only when the shop is India's */
  return `${label} from ${senderName} — ${dateStr}`;
};

// ─── Helper: Calculate summary ───────────────────────────────
const calculateSummary = (lineItems) => {
  if (!lineItems || !Array.isArray(lineItems)) {
    return { line_item_count: 0, total_value: 0 };
  }
  /**
   * ⚠️⚠️ A TOTAL OF ZERO IS A TOTAL. `item.total || item.price * item.quantity` treats 0 as absent and falls
   * through to the full price — so a line given away FREE was silently charged for in the chit's value.
   *
   * Athi, 2026-09-03: *"many of the products are sold based on what is coming as free… the chit should
   * automatically make the oil price as zero and should be informed as freebie."* A freebie is exactly the line
   * whose total is 0, so this coalesce was wrong precisely where it mattered most, and nowhere else — which is
   * why nothing caught it: every line anyone had ever sent had a non-zero total.
   *
   * ⭐ Same rule this codebase keeps re-learning: ABSENT IS NOT ZERO, and the inverse is just as true — zero is
   * not absent. `availability.countedZero`, `sheet.fromSheet`'s blank cell, `itemstatus`: same line, drawn again.
   */
  const total = lineItems.reduce((sum, item) => {
    const explicit = item.total !== undefined && item.total !== null && String(item.total).trim() !== '';
    const t = explicit ? parseFloat(item.total) : (parseFloat(item.price) || 0) * (parseFloat(item.quantity) || 0);
    return sum + (Number.isFinite(t) ? t : 0);
  }, 0);
  return {
    line_item_count: lineItems.length,
    total_value: roundMoney(total)
  };
};

// ─── D1 auto-assign on receipt ─────────────────────────────────
// Walk the delegate chain when the chosen actor is on leave / not-assignable. Returns an assignable
// actor id (active + Act/Manager hat) or null. Loop-guarded (visited set + depth cap). Capacity is
// NOT re-checked here — the default/overflow assignee absorbs excess by design (D1).
async function resolveDelegateTarget(client, entity_id, actorId) {
  const seen = new Set();
  let cur = actorId;
  let depth = 0;
  while (cur && depth < 12) {
    if (seen.has(cur)) return null; // cycle → give up (set-time check is the primary guard)
    seen.add(cur);
    const r = (
      await client.query(
        `SELECT identity_id, break_status, hat, delegate_actor_id
         FROM identities WHERE identity_id = $1 AND parent_entity_id = $2 AND identity_type = 'actor'`,
        [cur, entity_id]
      )
    ).rows[0];
    if (!r) return null;
    if (r.break_status === 'active' && (r.hat === 'act' || r.hat === 'manager')) return r.identity_id;
    cur = r.delegate_actor_id;
    depth++; // on leave / not assignable → try their delegate
  }
  return null;
}

// Auto-assign a freshly-received chit per the entity's mode. Atomic + idempotent (skips if already
// assigned). Caller runs it best-effort AFTER commit so it can never fail the guaranteed chit.
async function autoAssignReceived(entity_id, chit_id) {
  // B1 RLS: the receiver auto-assigns within its OWN roster -> withEntity(receiver), not withTransaction.
  await withEntity(entity_id, async (client) => {
    const st = (
      await client.query(
        `SELECT auto_assign_mode, default_assignee_actor_id, default_max_tasks
         FROM entity_actor_settings WHERE entity_id = $1`,
        [entity_id]
      )
    ).rows[0];
    const mode = (st && st.auto_assign_mode) || 'off';
    if (mode === 'off') return;
    const defMax = (st && st.default_max_tasks) || 10;
    const defaultAssignee = (st && st.default_assignee_actor_id) || null;

    // Idempotency + scope: only the actionable received copy, still unassigned.
    const cs = (
      await client.query(
        `SELECT assigned_to_actor_id, current_status FROM chit_status
         WHERE chit_id = $1 AND entity_id = $2 AND direction = 'received' AND deleted_at IS NULL`,
        [chit_id, entity_id]
      )
    ).rows[0];
    if (!cs || cs.assigned_to_actor_id) return;

    let target = null;
    if (mode === 'default_assignee') {
      target = defaultAssignee;
    } else if (mode === 'least_loaded') {
      const cand = (
        await client.query(
          `SELECT identity_id, max_tasks, current_task_count FROM identities
           WHERE parent_entity_id = $1 AND identity_type = 'actor' AND break_status = 'active'
             AND hat IN ('act','manager')
           ORDER BY current_task_count ASC, last_assigned_at ASC NULLS FIRST
           LIMIT 10`,
          [entity_id]
        )
      ).rows;
      const room = cand.find((item) => (item.current_task_count || 0) < (item.max_tasks || defMax));
      target = room ? room.identity_id : defaultAssignee; // all full → overflow to the default assignee
    }
    if (!target) return; // no eligible actor + no default → stays in the pool

    target = await resolveDelegateTarget(client, entity_id, target); // route past anyone on leave
    if (!target) return;

    const t = (
      await client.query(
        `SELECT identity_id, display_name FROM identities
         WHERE identity_id = $1 AND parent_entity_id = $2 AND identity_type = 'actor'`,
        [target, entity_id]
      )
    ).rows[0];
    if (!t) return;

    /* ⭐ W1-RAIL: the one assignment writer (lib/assign-chit) — my received copy, then back to pending through the ONE status write
       (T1-RAIL, rail-status statusGate), never a bare SET. The status was read with the row above — no second read. The shop's own
       automation moves it as SYSTEM. */
    await assignChit(client, entity_id, chit_id, t, 'auto', { copy: 'received', me: railStatus.SYSTEM, from: cs.current_status });
    await taskCount(client, t.identity_id, 'take'); /* TA1 */
    await client.query(
      `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, new_status, detail)
       VALUES ($1, $2, 'assigned', NULL, 'System (auto-assign)', 'pending', $3)`,
      [chit_id, entity_id, `Auto-assigned to ${t.display_name} (${mode === 'least_loaded' ? 'least-loaded' : 'default assignee'})`]
    );
  });
}

// ─── POST /chits/send ─────────────────────────────────────────
// Send a chit from sender to one or more receivers
router.post(
  '/send',
  /* ⭐ M04 (IAM §35): WHO before WHAT. auth runs ahead of the validator chain, so an unauthenticated or refused caller never
     has its body examined — and server.js (middleware/auth-first.js) authenticates this route before the body is even
     parsed. The second auth here keeps the route self-guarding; it reuses the decision, it does not repeat it. */
  auth,
  recipientsRule(operationFor('POST /send')),
  ...checked('POST /send'),
  trimmedBody(['purpose', 'manual_subject']),
  async (req, res) => {
    try {
      /* ⭐ T2-SPLIT (2026-10-14): the 1,408 lines that stood here are the named steps below, in order, each under 80
         lines — the same statements, the same order, the same answers (tests/send-golden.test.cjs, frozen before the split).
         A step that has answered returns truthy and the send stops there. `st` carries what one step hands the next. */
      const st = {};
      for (const step of SEND_STEPS) if (await step(st, req, res)) return;
    } catch (err) {
      /**
       * ── ⭐⭐⭐ A LOST RACE IS A DUPLICATE, NOT A FAILURE (2026-09-18) ───────────────────────
       *
       * b263's unique index closed the hole the duplicate-bill fault came through: the check above is a SELECT,
       * and two requests arriving together both see nothing and both write. The database now refuses the second
       * — which is correct, and arrives here as a raw 23505 that would be reported as "Send failed". It is not a
       * failure. It is the very duplicate we asked the database to catch, and the answer is the one the check
       * above would have given had it won the race: the existing chit for a retry, or a named collision for two
       * counters.
       *
       * ⚠⚠ WHY NOT `INSERT … ON CONFLICT DO NOTHING`, which is the usual advice and what was first planned:
       *   · DO NOTHING makes the INSERT SUCCEED with zero rows, and the transaction then carries on writing
       *     chit_detail, chit_status and the recipient rows against a header that was never inserted. It turns a
       *     clean refusal into a half-written chit — a worse fault than the one being fixed, and a silent one.
       *   · The index is PARTIAL, so inference needs its predicate spelled out at every insert site; there are
       *     two, and a mismatch there fails open rather than closed.
       *   · Letting the constraint throw rolls the whole transaction back, which is exactly what should happen.
       * So the mechanism is the same and the seam is different: the database refuses, nothing is written, and
       * this translates the refusal into the answer.
       *
       * ⚠️ `client_ref` and `sender_id` are declared INSIDE the try and are not in scope here — block scoping,
       * which is the same rule that made this file's temporal-dead-zone bug (tests/tdz-guard). They are asked of
       * the request again, through the one reader both sides use.
       */
      const raceRef = refOf(req);
      if (raceRef && err && err.code === '23505' && /client_ref/.test(String(err.constraint || err.detail || err.message || ''))) {
        try {
          const who = entityId(req);
          const seen = await sameRefLook(who, raceRef);
          if (seen) {
            const _bj = req.body && req.body.business_json;
            const mine = (_bj && _bj.till && _bj.till.id) || null;
            const theirs = seen.till_id || null;
            const myAt = _bj && _bj.billed_at ? String(_bj.billed_at) : null;
            const theirAt = seen.billed_at ? String(seen.billed_at) : null;
            /* ⚠ THE SAME VERDICT AS THE CHECK ABOVE — via the one function both callers share, so this can no
               longer drift from it (it used to: this branch had no sameName wording at all). */
            const verdict = tillCollisionVerdict(mine, theirs, myAt, theirAt, raceRef);
            if (verdict.collision) return problem(req, res, { status: 409, ...said(verdict.body, 'CHIT_CONFLICT') });
            /* the same bill, sent twice — answer with the chit that exists, exactly as a replay is answered */
            return res.status(200).json({ ok: true, chit_id: seen.chit_id, duplicate: true, client_ref: raceRef, raced: true });
          }
        } catch (e) {
          cbLog.fellBack('chits: failed — carried on without it', e); /* fall through to the ordinary failure — a bad answer here must not hide the real one */
        }
      }
      /* ⭐ a refusal the database made on purpose (b247's population boundary) answers as one — 409, in words — not
         as "Send failed" (lib/knownerr, external review §23) */
      const _known = require('../lib/knownerr').known(err);
      if (_known) return problem(req, res, { status: _known.status, ...said(_known.body, codeOfStatus(_known.status)) });
      cbLog.error('chits/send failed', { id: req.id, err: err.message });
      problem(req, res, failed(err, req, 'Send failed'));
    }
  }
);

/* ═══ POST /chits/send — THE NAMED STEPS (T2-SPLIT, 2026-10-14) ═════════════════════════════════════════════════════════
   validate · resolve parties · money · copies · write · after-commit · answer. The policy is unchanged and engine-locked:
   lib/mint.js gives the SHAPE (header · party · summary · deliver); every decision below is still this route's. ═══ */

const SEND_STEPS = [
  sendSender,
  sendMoneyStated,
  sendLab,
  sendNumberCheck,
  sendTillClaim,
  sendReplay,
  sendTillGate,
  sendBody,
  sendSourceCarry,
  sendCredit,
  sendSource,
  sendFanOut,
  sendTrace,
  sendPrefs,
  sendRecipients,
  sendOwnSpend,
  sendSuspended,
  sendSeller,
  sendOffers,
  sendMoney,
  sendIssued,
  sendPaper,
  sendCopyPolicy,
  sendPromote,
  sendParticipants,
  sendRetention,
  sendFolds,
  sendDesigns,
  sendSummary,
  sendFreeze,
  sendCopies,
  sendOperatorCopy,
  sendWrite,
  sendCustomers,
  sendAssign,
  sendMeter,
  sendStock,
  sendBooks,
  sendAnswer
];

/** who is sending — the entity (an actor acts FOR it), its bridge id and name, read fresh when the claim is stale */
async function sendSender(st, req, res) {
  // Uniform actor model: an actor acts FOR its entity, so the chit is ALWAYS owned by the entity, never the actor.
  // (created_by_actor_id below records WHO pressed send — the only actor-specific bit, for audit.)
  const sender_id = entityId(req);
  let sender_bridge_id = req.identity.bridge_id;
  let sender_display_name = req.identity.display_name;
  /**
   * ⚠️⚠️ THE TOKEN'S bridge_id IS A CACHE; THE DATABASE IS THE TRUTH — AND A KEY CACHES IT FOR A YEAR.
   *
   * Athi, 2026-09-16: *"how many chits I create, it is creating the receipt, but not able to sync."* On one PC
   * only. An api key is minted with `bridge_id: identity.bridge_id || null` (routes/keys.js) and that claim is
   * then FROZEN for the life of the key. Pair a counter before the shop has a bridge_id and every send from it
   * puts NULL into sender_entity_bridge_id — `character varying(32) NOT NULL` — so it 500s, for ever, on that
   * counter alone. The receipt prints because the counter prints locally; the sale never reaches ChitBridge and
   * no amount of retrying will change that. A counter paired later works, which is what made it look like a
   * sick PC rather than a stale claim.
   *
   * ⚠️ So the lookup is no longer an ACTOR special case. Anything missing the claim asks the database, which is
   * one query on a path that already opens a transaction, and it cannot be wrong the way a year-old claim can.
   */
  const staleClaim = !sender_bridge_id || !sender_display_name;
  if (staleClaim || (req.identity.identity_type === 'actor' && req.identity.parent_entity_id)) {
    const _ent = await query(`SELECT bridge_id, display_name FROM identities WHERE identity_id = $1`, [sender_id]);
    if (_ent.rows[0]) {
      sender_bridge_id = _ent.rows[0].bridge_id;
      sender_display_name = _ent.rows[0].display_name;
    }
  }
  /**
   * ⚠️ AND IF IT IS STILL MISSING, REFUSE IN WORDS. A 500 from a NOT NULL constraint tells a shopkeeper that
   * "something went wrong" and tells the counter to keep retrying something that can never work. This says what
   * is actually wrong and who can fix it, and the counter shows it on the bill that is stuck.
   */
  if (!sender_bridge_id) {
    return problem(req, res, { status: 409, ...said({
      error: 'no_bridge_id',
      message:
        'This shop has no ChitBridge address yet, so a sale cannot be recorded against it. ' +
        "Open ChitBridge → Settings and set the shop's bridge id, then send this bill again."
    }, 'CHIT_NO_BRIDGE_ID') });
  }
  Object.assign(st, { sender_id, sender_bridge_id, sender_display_name });
}

/**
 * ⭐ N0 · A SHOP THAT HAS NOT STATED ITS COUNTRY AND MONEY ISSUES NO DOCUMENT — refused in words, before anything is written. A draft is the
 * author's own copy and is let through; a shop already India (the b299 backfill) has both stated and passes unchanged. The sentence and the
 * check are country-setup's (documentGate); this step only asks.
 */
async function sendMoneyStated(state, req, res) {
  const countrySetup = require('../lib/country-setup');
  const facts = await countrySetup.statedFacts(query, state.sender_id);
  state.clock = countrySetup.clockOf(facts); /* N3: the shop's zone and locale write the subject's date */
  if (req.body.is_draft) return false;
  const refusal = countrySetup.documentRefusal(facts);
  if (!refusal) return false;
  return problem(req, res, { status: refusal.status, ...said({ error: 'refused', code: refusal.code, message: refusal.message }, codeOfStatus(refusal.status)) });
}

/**
 * ⭐ RAIL-LAB-SRV1 (2026-10-14) · A LAB CHIT IS REFUSED ON A LIVE SHOP, IN WORDS, BEFORE ANYTHING IS WRITTEN.
 * The sender declares a lab chit as `business_json.lab: true` (the is_promotion path; sendSummary echoes it onto summary_json.lab so
 * every co-held copy says what it is). The ONE rule is lib/istest's (b249's axis: a lab shop is a shop whose population is not live) —
 * the same answer GET /api/facts/rail gives as `may_sample`, so the Rail Lab can never be told "yes" here and "no" there.
 * ⚠️ ONE identities read, ONLY when a lab chit is declared: an ordinary send runs no statement here and is byte-identical
 * (tests/send-golden.test.cjs). This is the one door: a lab chit cannot reach a live shop by delivery either — b247's population
 * boundary and istest.mayTrade already refuse a copy across populations. A population the database cannot state is LIVE (fail safe).
 * The refusal carries a CODE the client branches on (`code`, `why`); the sentence is for the person.
 */
async function sendLab(st, req, res) {
  const bj = req.body && req.body.business_json;
  if (!istest.isLabChit(bj)) return;
  const r = await query(`SELECT to_jsonb(i)->>'population' AS population FROM identities i WHERE identity_id = $1`, [st.sender_id]);
  const population = r.rows[0] && r.rows[0].population != null ? String(r.rows[0].population) : null;
  const may = istest.maySample(population);
  if (!may.ok) return problem(req, res, { status: 409, ...said({ error: 'Lab chit on a live shop', code: 'LAB_CHIT_LIVE_SHOP', may: false, why: may.why, message: may.say }, 'CHIT_CONFLICT') });
  st.lab = true;
}

/** the bill number on the paper, checked against this shop's country rule — recorded, never refused */
async function sendNumberCheck(st, req, res) {
  const { sender_id } = st;
  /**
   * ⭐⭐⭐ THE NUMBER ON THE PAPER, CHECKED AGAINST THE RULE FOR THIS SHOP'S COUNTRY.
   *
   * The counter now asks lib/docnumber for the shape it issues (vendored as /engine/docnumber.js), but the
   * SERVER held the same rule and accepted anything — so a counter on older code, or one whose till id was
   * set before the cap existed, could post a number that is too long and nothing would notice.
   *
   * ⚠️⚠️ IT RECORDS, IT DOES NOT REFUSE, and that is the whole judgement rather than a shortcut.
   *
   * A bill number is not a request — it is already printed and already in a customer's hand. Refusing it
   * does not un-print it; it wedges the counter's queue forever and loses the sale from the books, which is
   * strictly worse than a long number. The physical world happened first, and a server does not get a vote
   * on it. What a server CAN do is say so, and put the finding where the shop will read it.
   *
   * ⚠️ ONLY FOR A COUNTER DOCUMENT. `client_ref` carries an ERP's own reference, a WhatsApp id, a connector's
   * key — none of which are document numbers and none of which this rule governs. The till id is the marker
   * that this one is a bill, and without it nothing is checked.
   */
  /**
   * ⚠️⚠️ DECLARED HERE BECAUSE THE NUMBER CHECK BELOW READS IT. It used to be declared ~17 lines further down,
   * and on 2026-09-11 the document-number check was added ABOVE it — so every POST to this route died in the
   * temporal dead zone with "Cannot access 'client_ref' before initialization", and the screen showed nothing
   * at all: no toast, no error, the composer simply stayed open.
   *
   * ⭐ FOUND BY PRESSING "Save draft" IN A REAL SHOP AND READING THE NETWORK TAB: 500, silently. A `const` read
   * above its own declaration parses perfectly — `node -c` has nothing to say, because a TDZ violation is a
   * RUNTIME error — which is why tests/tdz-guard.test.js now exists.
   */
  const client_ref = refOf(req); /* ⚠️ one reader — the route's catch asks the same question again */

  let number_check = null;
  if (client_ref) {
    const _b = req.body && req.body.business_json;
    if (_b && _b.till && _b.till.id) {
      const v = docnumber.check(client_ref, await countryOfEntity(sender_id));
      /* ⚠ an unstudied country passes on the only rule everyone agrees on, and `verified` says so — a green
         tick there would be the platform claiming something nobody checked. */
      if (!v.ok) number_check = { ok: false, reason: v.reason, verified: v.verified, number: client_ref };
    }
  }
  Object.assign(st, { client_ref, number_check });
}

/**
 * ⚠⚠ ONE LOOK-UP, TWO CALLERS. It is asked once BEFORE anything is written (the ordinary duplicate), and again
 * from the route's catch when the b263 unique index refuses an insert (the race the first ask lost). Two copies
 * of this query would be two opinions about what "already here" means. [[feedback-no-duplicate-functions]]
 * ⭐ W2-REW: the query itself lives in lib/counter-bill (byRef) — the reward reads the same bill by the same number to earn
 * its points from, and two readers of "my bill by its number" are one query. The till id comes back too (the collision check).
 * → the row { chit_id, till_id, billed_at, summary_json } or null.
 */
async function sameRefLook(sender_id, client_ref) {
  return withEntity(sender_id, (db) => ownBill.byRef(db, sender_id, client_ref));
}
/** the one place the bill number is read off a request, so the catch below cannot drift from the check above */
function refOf(req) {
  const text = req && req.body && req.body.client_ref;
  return typeof text === 'string' && text.trim() ? text.trim().slice(0, 64) : null;
}
/**
 * ⭐⭐⭐ summary_json.money FOR A BILL THAT CARRIES ITS INVOICE — READ OFF IT by the engine's moneyOf (lib/tax.js, the same
 * reading the counter's screen, slip and reprint use — window.CBTax.moneyOf), never worked out again (Athi, 2026-10-02).
 * The header keeps its own names, which are moneyOf's: gross · savings · net · taxable · tax · total · round_off. Picked,
 * not added up. `issued: true` says the figures are the counter's invoice, not the provisional estimate the send route
 * makes for other chits.
 */
function moneyOfInvoice(inv, currency_code) {
  const m = taxEngine.moneyOf(inv, currency_code);
  return {
    gross: m.gross,
    savings: m.savings,
    net: m.net,
    taxable: m.taxable,
    tax: m.tax,
    total: m.total,
    round_off: m.round_off,
    currency_code,
    provisional: false,
    issued: true
  };
}
/**
 * ⭐⭐⭐ ONE TIE-BREAK, TWO CALLERS — lifted 2026-09-26 per the external review's §22. This verdict (same till id
 * AND same billed_at moment → a retry; anything else once a client_ref collides → two counters on one number) was
 * written out twice — the pre-send check below and the race-catch further down — and had actually drifted: the
 * catch block was missing this `sameName` branch entirely (the "two counters, ALSO called..." wording), so a
 * lost-race collision between two identically-named counters read the same as an ordinary one. One function now
 * answers both callers, so that gap cannot reopen by one of them being edited without the other.
 */
function tillCollisionVerdict(mine, theirs, myAt, theirAt, client_ref) {
  const otherBill = !!(myAt && theirAt && myAt !== theirAt);
  if (!((mine && theirs && String(mine) !== String(theirs)) || otherBill)) return { collision: false };
  const sameName = !!(mine && theirs && String(mine) === String(theirs));
  return {
    collision: true,
    sameName,
    body: {
      error: 'Bill number already used by another counter',
      code: 'TILL_SERIES_COLLISION',
      client_ref,
      till: mine,
      taken_by: theirs,
      message: sameName
        ? 'Bill ' +
          client_ref +
          ' was already recorded by a different counter that is ALSO called ' +
          mine +
          '. Two counters are numbering from the same series. This counter is given its own ' +
          'number the next time it reads the shop. This bill is kept on the counter, unsent — it was ' +
          'already printed with this number, so how it is recorded needs a decision. Nothing has been lost.'
        : 'Bill ' +
          client_ref +
          ' was already recorded by counter ' +
          theirs +
          ', and this is ' +
          'counter ' +
          mine +
          '. Two counters are numbering from the same series. This counter is given ' +
          'its own number the next time it reads the shop. This bill is kept on the counter, unsent — ' +
          'nothing has been lost.'
    }
  };
}

/** a phone's bill names its device and person — checked BEFORE the dedupe */
async function sendTillClaim(st, req, res) {
  const { client_ref } = st;
  /**
   * ⭐⭐ THE SAME BILL TWICE IS THE SAME CHIT (the till, 2026-09-07). A counter queues its bills and replays them when the line
   * comes back; a replay that arrived twice would bill the customer twice and put two vouchers in the books. 'client_ref' is the
   * till's own bill number — asked for FIRST, before anything is created, and answered with the chit that already exists.
   * ⚠️ Scoped to this entity: a bill number is unique to the shop that issued it, not to the platform.
   */
  /* ⭐ M11: a PHONE's bill names its device and its person, and both must be the session's (lib/holder tillClaimOf) — checked
     BEFORE the dedupe, so a bill from another phone is never answered as somebody's retry. A key's bill: unchanged. */
  const tillClaim = tillClaimOf(req.till, req.body && req.body.business_json);
  if (!tillClaim.ok) {
    res.locals.code = tillClaim.code;
    return problem(req, res, { status: 400, ...said({ error: 'Bill claim mismatch', code: tillClaim.code, field: tillClaim.field, client_ref, message: tillClaim.message }, 'CHIT_BAD_REQUEST') });
  }
  if (tillClaim.stamp) Object.assign(req.body.business_json.till, tillClaim.stamp); /* merge-patch: `by` is never overwritten by sent_by */
  if (tillClaim.sentByOther) res.locals.kind = 'sent_by_other'; /* the request log line names it */
}

/** the same bill twice is the same chit — a retry answered with the chit that exists, a collision refused and named */
async function sendReplay(st, req, res) {
  const { sender_id, client_ref } = st;
  if (client_ref) {
    try {
      const seen = await sameRefLook(sender_id, client_ref);
      if (seen) {
        /**
         * ⭐⭐⭐ A RETRY AND A COLLISION LOOK IDENTICAL FROM HERE, AND THEY ARE OPPOSITES.
         *
         * Athi, 2026-09-11, planning two testers at once: *"we cannot have same receipt number if the same
         * login opens from couple of places?"* — and the answer was that we could.
         *
         * The counter numbers its bills LOCALLY as `<till>/<FY>/<nnnn>`, and the till prefix defaults to
         * `C1` and is only ever set by hand. So two counters nobody renamed both produce C1/26-27/0041.
         * Returning the first chit is exactly right for a RETRY from the same device — which is what this
         * guard was built for — and exactly wrong for two devices: the second shop's real sale is absorbed,
         * the counter is told it succeeded, and it hands back somebody else's chit id.
         *
         * ⚠⚠ AND IT IS NOT MERELY A LOST RECORD. An invoice number must be a consecutive serial UNIQUE for
         * the financial year, so two counters on one number is two tax invoices carrying one number.
         *
         * ⭐ THE TILL ID TELLS THEM APART, and it is already on the chit. Same till — or either side missing
         * one, which is every chit that is not a counter bill — behaves exactly as before. Different tills
         * is REFUSED AND NAMED, because a number that two devices both think is theirs is a thing a person
         * has to settle, not something a server may quietly pick a winner for.
         */
        /* ⚠ FROM req.body, NOT the `business_json` const — that is declared further down, so naming it
            here is a temporal dead zone and EVERY duplicate would have thrown a ReferenceError. */
        const _bj = req.body && req.body.business_json;
        const mine = (_bj && _bj.till && _bj.till.id) || null;
        const theirs = seen.till_id || null;
        /**
         * ── ⚠️⚠️⚠️ THE GUARD ABOVE NEVER FIRED FOR THE ONE CASE ITS OWN COMMENT DESCRIBES ────────────────
         *
         * Athi, 2026-09-17: *"from this PC the bills are pushed, but still not happening from the other PC."*
         * Only three counter bills had reached ChitBridge in five days — C1/26-27/0005, 0006, 0007 — and his
         * two PCs, on 152.233.15.121 and .123, were BOTH counter `C1`, because nobody had renamed either.
         *
         * The comment above says, in so many words, "two counters nobody renamed both produce C1/26-27/0041".
         * The code then compared TILL IDS — and two unrenamed counters have the SAME till id, so every
         * collision between them read as a same-device RETRY. The second PC's real sale was absorbed, the
         * server answered 200 with the FIRST PC's chit id, and the counter recorded that as its receipt and
         * showed "✓ sent". Nothing failed anywhere, which is why no log, no queue and no panel caught it — and
         * why the acknowledgement added on 2026-09-16 was fooled too: it received a real chit id, just
         * somebody else's.
         *
         * ⭐ `billed_at` IS WHAT TELLS THEM APART, and every counter already sends it. A retry is the SAME
         * bill, so it carries the same moment it was taken. Two devices issuing one number carry two different
         * moments — they would have to be billed in the same millisecond. So: same moment → a retry, answered
         * as before; different moments → a collision, refused and named, whatever the till ids say.
         * ⚠️ Either side missing it — every chit that is not a counter bill, and anything older — behaves
         * exactly as before. This only ever turns a silent absorption into a spoken refusal.
         */
        const myAt = _bj && _bj.billed_at ? String(_bj.billed_at) : null;
        const theirAt = seen.billed_at ? String(seen.billed_at) : null;
        const verdict = tillCollisionVerdict(mine, theirs, myAt, theirAt, client_ref);
        if (verdict.collision) return problem(req, res, { status: 409, ...said(verdict.body, 'CHIT_CONFLICT') });
        return res.status(200).json({ ok: true, chit_id: seen.chit_id, duplicate: true, client_ref });
      }
    } catch (e) {
      cbLog.fellBack(
        'chits: failed — carried on without it',
        e
      ); /* a lookup that fails must not stop a sale — the worst case is the ordinary one, a new chit */
    }
  }
}

/** a till key may only bill itself — or one listed customer (one-sided when their copy cannot go) */
async function sendTillGate(st, req, res) {
  const { sender_id } = st;
  /**
   * ⚠️ A TILL KEY MAY ONLY BILL ITSELF. The key lives on a shop PC where anyone can pick it up; a counter sale is the shop's own
   * record and never addresses another business. The scope opens the send route; this closes it to one shape.
   */
  let oneSided = null; /* { why } when a counter bill is recorded without its customer's copy — see tillMaySend */
  const tk = req.till && req.till.key; /* M04 — the holder says whether a key is speaking (middleware/auth holderOf) */
  if (tk && tk.scopes.indexOf('till') >= 0 && !tk.scopes.includes('connector')) {
    const list = Array.isArray(req.body.recipients) ? req.body.recipients : Array.isArray(req.body.receivers) ? req.body.receivers : [];
    const outward = list.filter((item) => item && item.self !== true && String(item.entity_id || '') !== String(sender_id));
    const gate = outward.length ? await tillMaySend(sender_id, outward, req.body) : null;
    if (gate && gate.refuse) {
      /* ⚠️ code TILL_SEND_REFUSED: a refusal of THIS BILL's shape, not of the key — the counter keeps it and sends the rest */
      return problem(req, res, { status: 403, ...said({
        error: 'Forbidden',
        code: 'TILL_SEND_REFUSED',
        message: 'Not sent: ' + gate.refuse + '. Counter bills go only to listed customers on ChitBridge.'
      }, 'CHIT_NOT_PERMITTED') });
    }
    if (gate && gate.oneSided) {
      /* ⭐ ONE-SIDED: the sale and its ledger are recorded; only the customer's copy is dropped. The bill keeps naming its
         customer (business_json.customer) — it is still their bill, they simply do not receive a copy on ChitBridge. */
      const keep = list.filter((item) => !(item && item.self !== true && String(item.entity_id || '') !== String(sender_id)));
      if (!keep.some((item) => item && item.self === true)) keep.push({ self: true, name: 'self' });
      if (Array.isArray(req.body.recipients)) req.body.recipients = keep;
      else req.body.receivers = keep;
      oneSided = { why: gate.oneSided };
    }
  }
  Object.assign(st, { oneSided });
}

/** what the chit says — purpose, subject, lines, business data, its page and its money */
async function sendBody(st, req, res) {
  // Compose panel omits purpose and sends `subject`/`schema_values` — tolerate that shape.
  const purpose = req.body.purpose || 'order';
  const manual_subject = sanitise(req.body.manual_subject || req.body.subject || '');
  /* ⭐ STAMP IDENTITY AND ORDER AT THE DOOR. Every line gets a `line_id` that survives editing and a `seq`
     that states its position, instead of position being whatever order the array happened to be built in
     ("the one you selected comes as the last record"). Done here because this is where a chit is born;
     mint.lines() is idempotent, so a forward or a draft-resume keeps the ids it already had. */
  const line_items = mint.lines(req.body.line_items || []); // `let`: rated below, once the sender is known
  /* `let`: the page stamp below gives a chit with no business data a business_json of its own ({ page }) */
  const business_json =
    req.body.business_json || (req.body.schema_values && Object.keys(req.body.schema_values).length ? { schema_values: req.body.schema_values } : null);
  /* ⭐ WHICH DETAIL PAGE THIS CHIT IS MADE WITH (N03, M-D6/M-D7) — checked at the door, stamped on every copy just
     before the copies are built (below). An unknown name is refused HERE, before anything is written; opening never
     refuses (the app falls back to the base page with a note). mint.page() reads the one registry, data/pages.json. */
  const pageAsked = business_json && typeof business_json === 'object' ? business_json.page : undefined;
  const pageStamp = mint.page(pageAsked);
  if (!pageStamp.ok) return problem(req, res, { status: 400, ...said({ error: 'Unknown page', code: pageStamp.code, message: pageStamp.message }, 'PAGE_UNKNOWN') });
  /**
   * ⚠️⚠️ THE SAME FAULT, LATENT. `currency_code` was declared ~90 lines below the tax-invoice block that reads
   * it as `currency: currency_code`. Same scope, proven by brace depth over source with strings blanked (a
   * naive count is useless in this file — it is full of SQL braces).
   *
   * ⭐ IT HAS NOT BEEN FIRING DAILY, and the difference matters: that block needs a chit with LINES, a buyer
   * different from the seller, and identity rows for both. Counter bills and self-addressed chits never reach
   * it — so the first thing to break would have been a real invoice to a real counterparty, which is the exact
   * transaction this product exists for.
   */
  /* ⭐ WX-R2R (2026-10-13): a chit that names no currency is in the SENDER's money — identities.currency_code, the Country setup's
     answer — never INR by default. The counter sends no currency: an AU shop's every bill was minted as INR, and the ledger hook then
     refused each one ("an entry in INR needs its rate to AUD"), so no sale ever posted. Decided below from the sender's row that
     the self-copy preference already reads (one query, not two). */
  const currency_code = (business_json && business_json.currency) || null;
  Object.assign(st, { purpose, manual_subject, line_items, business_json, pageAsked, pageStamp, currency_code });
}

/** the draft this send promotes (the id the body names), or null — read by sendFanOut and, earlier, by sendSourceCarry */
const promoteIdOf = (req) => (typeof req.body.promote_draft_id === 'string' && req.body.promote_draft_id ? req.body.promote_draft_id : null);

/**
 * RAIL-146c — the SOURCE a blind sender's lines are carried from: the draft a send promotes (RAIL-149), or the ORDER a goods receipt names (business_json.against.chit_id: a receipt is a new
 * chit whose lines match the order's by the line_id the till sends in item_data). A receipt is the shop's spend whatever the order's party list says (options.cost), so it is carried even
 * when it names no order (nothing to take, and a figure of its own is still a 403): its own money (goods · extras · landed_total · costs · their bill's total) rides in options.extra.
 */
function sourceOf(state, req) {
  const draft = promoteIdOf(req);
  if (draft) return { id: draft, options: {} };
  if (state.purpose !== 'receipt') return null;
  const against = state.business_json && state.business_json.against;
  const order = against && typeof against.chit_id === 'string' && /^[0-9a-f-]{36}$/i.test(against.chit_id) ? against.chit_id : null;
  return { id: order, options: { cost: true, extra: state.business_json } };
}

/** before the definers (b50) the write is the legacy fan-out, which cannot re-check the carried money under the lock: a blind promote is refused there, nothing written */
const legacyRefusal = () => Object.assign(new Error('not sent'), { status: 409, refused: true, code: 'CHIT_CONFLICT', body: { error: 'Not sent', code: 'CHIT_CONFLICT', message: 'This draft cannot be sent with this access until the system update finishes; ask the account owner to send it.' } });

/**
 * RAIL-149 — a cost-blind co-assist re-sending a draft (promote_draft_id): the stored money of the draft's lines is carried onto the lines sent, never null over it. One named step so a
 * later source (RAIL-146c, a receipt sent against an order) widens the same call. The owner, a cost-allowed actor and a paired till pay nothing (isCostBlind is false); a sale-side draft is as it was.
 * Answers the 403 COST_BLIND (blocked = key names) or a 400 for a shifted list in the refusal's own words; the write transaction re-checks the stamp (sendWrite).
 */
async function sendSourceCarry(state, req, res) {
  const { sender_id, line_items } = state;
  const source = sourceOf(state, req);
  if (!source || !line_items.length || !(await cost.isCostBlind(req, sender_id))) return false;
  return carryAnswer(state, req, res, source, (db) => costWrite.carryFromSource(db, sender_id, source.id, line_items, req.body.line_items, source.options));
}

/** runs one carry (`carry(db)` → null or { lines, stamp }) in the sender's scope; a refusal is answered (403 COST_BLIND, 400, 409), a carry replaces the lines and sets the stamp sendWrite re-checks */
async function carryAnswer(state, req, res, source, carry) {
  try {
    const carried = await withEntity(state.sender_id, carry);
    if (carried && !(await definersReady())) throw legacyRefusal();
    if (carried) Object.assign(state, { line_items: carried.lines, sourceCarry: carried.stamp, sourceId: source.id, sourceOptions: source.options });
  } catch (e) {
    if (!e.refused) throw e;
    return problem(req, res, { status: e.status, ...said(e.body, codeOfStatus(e.status)) });
  }
  return false;
}

/**
 * RAIL-156 — a cost-blind co-assist sending a chit that is the shop's SPEND with no source (a purchase order, a supplier bill: the receiver is a supplier on the shop's own list, or the
 * document kind is a buy): any figure he sends is the SAME 403 COST_BLIND a receipt gets (carryFromSource with options.cost and no source id), nothing written. Runs after the receivers
 * are resolved because the side is judged from them (lib/cost-write sideOfCopy, the reader's own lists). Only a positive buy is judged: a sale, a walk-in, or a party on neither list is as before.
 */
async function sendOwnSpend(state, req, res) {
  const { sender_id, line_items, purpose, business_json, receiverDetails } = state;
  if (!line_items.length || sourceOf(state, req) || !(await cost.isCostBlind(req, sender_id))) return false;
  const copy = { purpose, sender_entity_id: sender_id, business_json, all_recipients: receiverDetails.filter((item) => item.entity_id).map((item) => ({ entity_id: item.entity_id, role: item.all_role })) };
  const source = { id: null, options: { cost: true, extra: business_json } };
  return carryAnswer(state, req, res, source, async (db) =>
    (await costWrite.sideOfCopy(db, sender_id, copy)) === 'buy' ? costWrite.carryFromSource(db, sender_id, null, line_items, req.body.line_items, source.options) : null);
}

/** the credit limit (F2) and the bill's own facts stamped on the chit */
async function sendCredit(st, req, res) {
  const { sender_id, client_ref, number_check, purpose, business_json } = st;
  /* ⭐ CB FINANCE · TERMS (F2) — THE SERVER ENFORCES THE CREDIT LIMIT. A credit bill to a known customer that would take them past
     the limit that applies (their own, else the shop's default) is refused with 409 OVER_LIMIT — unless the OWNER allowed it: the
     counter carries business_json.credit_override = { by } (the owner's counter PIN, checked at the till), and only a counter key or
     the owner's own login may carry it. An allowed bill is recorded (books_change_log 'credit_limit'). Not a credit bill, no named
     customer, ledger off or no limit → no query at all. */
  if (!req.body.is_draft && purpose === 'order' && business_json && typeof business_json === 'object') {
    const F = require('../lib/finance-terms');
    const chk = await F.creditSaleCheck(sender_id, business_json);
    if (chk.over) {
      const allowedBy = F.overrideBy(req, business_json.credit_override);
      if (!allowedBy)
        return problem(req, res, { status: 409, ...said({
          code: 'OVER_LIMIT',
          error: 'Over the credit limit.',
          message: F.overSentence(chk),
          limit_minor: chk.limit_minor,
          owed_minor: chk.owed_minor,
          after_minor: chk.after_minor,
          party_id: chk.party_id
        }, 'CHIT_CONFLICT') });
      F.noteOverride(sender_id, chk, allowedBy).catch(cbLog.orElse('chits: failed — carried on without it'));
    }
  }

  /* the bill number the till issued travels ON the chit — it is what the dedupe above looks for on a replay (2026-09-07) */
  if (client_ref && business_json && typeof business_json === 'object') business_json.client_ref = client_ref;
  /* ⭐ ON THE CHIT, not only in the reply. The counter may be offline when the answer comes back, the person
     who reads the books is not the person who pressed the key, and a finding that lives only in an HTTP
     response is a finding nobody will ever see again. */
  if (number_check && business_json && typeof business_json === 'object') business_json.number_check = number_check;
}

/** the sender's declared trade travels with the goods */
async function sendSource(st, req, res) {
  const { sender_id, sender_display_name, purpose, business_json } = st;
  /**
   * ── ⭐⭐⭐ THE SENDER'S TRADE TRAVELS WITH THE GOODS (2026-09-10) ──────────────────────────────────────
   *
   * Found by [ADOPT-01] going red on a batch number that was plainly on the delivery. The adopt route was
   * LOOKING UP the sender's sector — and could not read it, because entity_profile is isolated per entity.
   * That is not a bug in RLS; it is RLS working. A receiver has no business reading a supplier's profile.
   *
   * ⭐ So the requirement rides on the chit instead, which is the correct shape anyway and is what
   * "source-governed distribution" has meant all along: a batch number is a fact about the MEDICINE, not
   * about who is holding it, so a pharma supplier's despatch must carry "these need a batch and an expiry"
   * with it. The receiver's own sector cannot make an expiry optional, and now it cannot fail to know.
   *
   * ⚠️ ONLY FOR GOODS. An ordinary message or an invoice does not need the sender's trade attached, and
   * stamping every chit with it would be telling counterparties something they did not ask for on documents
   * where it means nothing.
   * ⚠️ AND IT IS WHAT THE SENDER HAS DECLARED PUBLICLY ABOUT THEIR TRADE — the sector already shown on their
   * passport — never the profile itself, and never the vault.
   */
  if (business_json && typeof business_json === 'object' && ['receipt', 'delivery_note', 'order'].indexOf(String(purpose)) >= 0 && !business_json.source) {
    try {
      /* ⚠️⚠️ withEntity, NOT query. entity_profile is RLS-isolated, and a bare query() runs with no
         app.current_entity set — under which every policy is false and the read returns ZERO ROWS.
         Not an error: an empty answer that looks exactly like a shop that declared no trade. This is
         the quietest failure on the platform and it cost an hour here. */
      const sp = await withEntity(sender_id, (db) => db.query(`SELECT sectors FROM entity_profile WHERE entity_id = $1`, [sender_id]));
      const row = sp.rows[0] || {};
      const sectors = row.sectors || [];
      if (sectors && sectors.length) {
        business_json.source = { name: sender_display_name || null, sectors, vertical: require('../lib/adopt').verticalOf(sectors) };
      }
    } catch (e) {
      cbLog.fellBack(
        'chits: the read failed — carried on without it',
        e
      ); /* a shop that has declared no trade sends goods that require nothing — the ordinary case */
    }
  }
}

/** draft or send, and the recipient caps re-checked (To/CC/For) */
async function sendFanOut(st, req, res) {
  const { line_items } = st;
  const is_draft = !!req.body.is_draft;
  // Promote/update a saved draft IN PLACE (same chit_id): Draft stays a draft until sent; sending flips it to
  // Order + fans out to Task. is_draft:true + promote_draft_id => update the draft; is_draft:false => send it.
  const promote_draft_id = promoteIdOf(req);

  // ── Fan-out recipients (ATH-119): To/CC/For. Backward-compatible: legacy `receivers` => all To. ──
  const LIMITS = { to: 5, cc: 5, for: 1, items: 50, attachments: 10 };
  const ROLE_MAP = { to: 'Act', cc: 'Info', for: 'For' };
  const rawList = (Array.isArray(req.body.recipients) ? req.body.recipients : Array.isArray(req.body.receivers) ? req.body.receivers : []).map((item) => ({
    ...item,
    kind: String(item.role || 'to').toLowerCase()
  }));

  // Server-side LIMITS re-check — never trust the client (ATH-120).
  const counts = { to: 0, cc: 0, for: 0 };
  for (const r of rawList) {
    if (!(r.kind in counts)) {
      return problem(req, res, { status: 400, ...said({ error: 'Invalid recipient role', message: `role must be to|cc|for, got "${r.kind}"` }, 'CHIT_BAD_REQUEST') });
    }
    counts[r.kind]++;
  }
  if (counts.to > LIMITS.to || counts.cc > LIMITS.cc || counts.for > LIMITS.for) {
    return problem(req, res, { status: 400, ...said({ error: 'Limit exceeded', message: `Recipient caps — to:${LIMITS.to}, cc:${LIMITS.cc}, for:${LIMITS.for}` }, 'CHIT_BAD_REQUEST') });
  }
  if (line_items.length > LIMITS.items) {
    return problem(req, res, { status: 400, ...said({ error: 'Limit exceeded', message: `Max ${LIMITS.items} line items` }, 'CHIT_BAD_REQUEST') });
  }
  Object.assign(st, { is_draft, promote_draft_id, ROLE_MAP, rawList, counts });
}

/** the traceability edge — only when the sender declares one, its parents co-held */
async function sendTrace(st, req, res) {
  const { sender_id, is_draft } = st;
  // ── Traceability edge (Fragment 1): a doubly-linked, co-held, FROZEN handoff edge that rides in
  //    summary_json.trace. Present ONLY when the sender declares `trace` — normal chits are untouched (every
  //    existing send path behaves exactly as before). HARDENING on the new path: a non-origin handoff MUST carry
  //    >=1 parent chit the sender CO-HOLDS (no silent holes; can't forge an edge to a chit you don't hold). ──
  let traceEdge = null;
  if (req.body.trace && !is_draft) {
    const built = trace.buildEdge(req.body.trace);
    if (built.error) return problem(req, res, { status: 400, ...said({ error: 'Invalid handoff', message: built.error }, 'CHIT_BAD_REQUEST') });
    traceEdge = built.edge;
    if (traceEdge && traceEdge.parents.length) {
      const held = await withEntity(sender_id, (db) =>
        db.query(`SELECT chit_id FROM chit_header WHERE chit_id = ANY($1::uuid[]) AND entity_id = $2`, [traceEdge.parents, sender_id])
      );
      const heldSet = new Set(held.rows.map((item) => item.chit_id));
      const missing = traceEdge.parents.filter((item) => !heldSet.has(item));
      if (missing.length) return problem(req, res, { status: 400, ...said({ error: 'Invalid handoff', message: `Parent chit not co-held by sender: ${missing.join(', ')}` }, 'CHIT_BAD_REQUEST') });
    }
  }
  Object.assign(st, { traceEdge });
}

/** the sender's money and self-copy preference — one read */
async function sendPrefs(st, req, res) {
  const { sender_id, sender_bridge_id, sender_display_name, ROLE_MAP } = st;
  let { currency_code } = st;
  // Two-copy: the sender's view preference for self-chits (both | sent | received) — exposed via /me.
  const prefRow = await query(`SELECT self_copy_pref, currency_code FROM identities WHERE identity_id = $1`, [sender_id]);
  /* the sender's money (WX-R2R, above): the row's own code; a row without one asks lib/regional.currencyFor — the ONE resolver (its regional layer, its fallback) */
  const statedMoney = currency_code || (prefRow.rows[0] && prefRow.rows[0].currency_code) || (await require('../lib/regional').currencyFor(sender_id));
  currency_code = statedMoney
    ? String(statedMoney).toUpperCase()
    : null; /* N1: none stated → null (sendMoneyStated refuses a document first), never 'INR' by name */
  /**
   * ⭐ A SELF-CHIT MAKES ONE COPY, AND IT IS THE TASK — Athi, 2026-08-14: *"self should create one copy only,
   * no two copies, and you would be very specific about direction."*
   *
   * The default was 'both', so every self-chit wrote TWO rows for the SAME entity — a `sent` copy and a
   * `received` copy. That is not a display quirk: it doubles chit_header, chit_detail AND chit_line, so every
   * cross-chit read counts the same work twice. It is what made the worklist show four lines per person where
   * two were assigned, and it made `due_on` and `actor_id` look broken when both were filtering correctly.
   *
   * ⚠️ WHY `received` AND NOT `sent`. A self-chit exists because there is work to do. The Order/Sent list is
   * the record of obligations placed on SOMEONE ELSE, and a self-chit places none — filing it there asserts
   * "I sent this to a counterparty", which is false. Task asserts "this is mine to act on", which is true. It
   * is also what the capture path already does: a WhatsApp message becomes a Task, never an Order.
   *
   * ⚠️ NARROWED, NOT SILENT. The suppression is declared on the chit as `copy_policy` with its source, exactly
   * as before — an absence that cannot be told from a gap is not governed. An entity that has explicitly set
   * `self_copy_pref` keeps its choice; only the unset default moves. Inter-entity chits are untouched: both
   * copies stay mandatory there, because the co-held transfer is the whole point.
   */
  const selfCopyPref = prefRow.rows[0]?.self_copy_pref || 'received';
  const makeSelfReceiver = (k) => ({
    entity_id: sender_id,
    bridge_id: sender_bridge_id,
    display_name: sender_display_name,
    kind: k,
    role: ROLE_MAP[k],
    all_role: k === 'to' ? 'receiver' : k
  });
  const hasSelf = false;
  Object.assign(st, { currency_code, selfCopyPref, makeSelfReceiver, hasSelf });
}

/** every recipient resolved by id before name, de-duplicated; self becomes the Task copy */
async function sendRecipients(st, req, res) {
  const { sender_id, is_draft, ROLE_MAP, rawList, makeSelfReceiver } = st;
  let { hasSelf } = st;
  // Existence check — connection NOT required. Resolve + de-dupe (one row per entity per direction).
  const receiverDetails = [];
  const seen = new Set();
  for (const r of rawList) {
    // Self recipient ("+ Self" or your own name): always create the entity's 'received' (Task)
    // copy here; the 'sent' (Order) copy is the SENDER block below. Two copies, always.
    if (
      r.self === true ||
      ['self', 'me'].includes(
        String(r.name || '')
          .trim()
          .toLowerCase()
      )
    ) {
      if (!hasSelf) receiverDetails.push(makeSelfReceiver(r.kind));
      hasSelf = true;
      continue;
    }
    /**
     * ⚠️⚠️ A MINTED PARTY IS NOT A RECIPIENT. Athi, 2026-09-10: *"he is not a recipient, so you can't bring
     * him to the rail or something."* `~acmetraders.sup-0001` is an ordinary active entity in every other
     * respect — which was the whole design — so all four lookups below would resolve it happily, and the chit
     * would then sit as sent for ever because nobody can sign in to open it. The sender would be waiting on an
     * answer that cannot come.
     * ⭐ One test on whatever was typed, before any lookup runs. The id path is fenced separately below,
     * because a screen holding a supplier row would pass the uuid rather than the handle.
     */
    const typedAny = String(r.user_id || r.bridge || r.bridge_id || r.display_name || r.name || '').trim();
    if (require('../lib/handle').isMinted(typedAny)) {
      return problem(req, res, { status: 404, ...said({ error: 'Not found', message: `"${typedAny}" cannot receive chits — that is a local record, not a ChitBridge business.` }, 'NOT_FOUND') });
    }
    const rec = await sendLookupRecipient(r);

    if (!rec || rec.rows.length === 0) {
      if (is_draft) {
        // a draft is WIP — keep the entered recipient name (unresolved); resolution is enforced only on send
        receiverDetails.push({
          entity_id: null,
          bridge_id: null,
          display_name: (r.display_name || r.name || '').toString().trim(),
          kind: r.kind,
          role: ROLE_MAP[r.kind],
          all_role: r.kind === 'to' ? 'receiver' : r.kind
        });
        continue;
      }
      return problem(req, res, { status: 404, ...said({
        error: 'Not found',
        message: `Recipient "${r.entity_id || r.display_name || r.name}" not found in the platform`
      }, 'NOT_FOUND') });
    }

    const rid = rec.rows[0].identity_id;
    // Resolved to self (you typed your own name): same as "+ Self" — create the received copy.
    if (rid === sender_id) {
      if (!hasSelf) receiverDetails.push(makeSelfReceiver(r.kind));
      hasSelf = true;
      continue;
    }
    if (seen.has(rid)) continue; // de-dupe external recipients
    seen.add(rid);

    receiverDetails.push({
      entity_id: rid,
      bridge_id: rec.rows[0].bridge_id,
      display_name: rec.rows[0].display_name,
      kind: r.kind, // to | cc | for
      role: ROLE_MAP[r.kind], // Act | Info | For (chit_header.role)
      all_role: r.kind === 'to' ? 'receiver' : r.kind // for the all_recipients snapshot
    });
  }
  Object.assign(st, { hasSelf, receiverDetails });
}

/**
 * NET-7: a member the network has SUSPENDED sends nothing to it. Any chit to a receiver whose network suspended the sender is refused
 * here, in words, before anything is written (the edge itself says nothing of purpose, and a suspended member asking to be resumed
 * does it by phone or the connection screen, not by a chit). The read is lib/network-membership.suspendedWith, which asks the one
 * standing() reader; a receiver with no edge to the sender, a draft, and a brand writing to its own suspended store are unaffected.
 */
async function sendSuspended(state, req, res) {
  const { sender_id, is_draft, receiverDetails } = state;
  const ids = receiverDetails.map((receiver) => receiver.entity_id).filter((id) => id !== sender_id); /* the self copy is not a counterparty */
  if (is_draft || !ids.length) return false;
  const membership = require('../lib/network-membership');
  let suspended;
  try {
    suspended = await membership.suspendedWith(sender_id, ids);
  } catch (e) {
    if (answerStandingReadFailed(res, e, sender_id, ids.length)) return true;
    throw e;
  }
  if (!suspended) return false;
  return problem(req, res, { status: 403, ...said({
    code: 'MEMBERSHIP_SUSPENDED',
    error: 'Membership suspended.',
    message: 'The network has suspended your membership, so you cannot send to it. Ask the network to resume it, then send again.'
  }, 'CHIT_CONFLICT') });
}

/** the standing read failed: logged with its code and ids only, answered 503 NETWORK_READ_FAILED in the row's words, nothing written; false for any other error */
function answerStandingReadFailed(res, e, entity_id, receivers) {
  const membership = require('../lib/network-membership');
  if (e && e.code === membership.READ_FAILED) log.warn('send.standing-read-failed', { code: e.code, entity_id, receivers });
  return membership.answerReadFailed(res, e);
}

/** one recipient → its identity row, by id, bridge id, user id, then typed name — never a minted party (sendRecipients) */
async function sendLookupRecipient(r) {
  let rec;
  if (r.entity_id) {
    rec = await query(
      `SELECT identity_id, bridge_id, display_name FROM identities
       WHERE identity_id = $1 AND status = 'active'
       AND COALESCE(user_id, '') NOT LIKE '~%'`,
      [r.entity_id]
    );
  } else if (r.bridge || r.bridge_id) {
    /* ⭐ BY IDENTITY BEFORE BY NAME (Athi, 2026-09-06: renamed tallytest to "Tally Test Shop" on the profile — "now I couldn't send the chit,
       it says Tally Test Shop not found"). A display name is a VIEW name, free to change; the bridge id and the user id are set once
       (project-user-id-rule). The Suppliers checkout and Compose now send the id; a name alone is the last resort, kept for typed recipients. */
    rec = await query(`SELECT identity_id, bridge_id, display_name FROM identities WHERE bridge_id = $1 AND status = 'active' AND identity_type = 'entity'`, [
      String(r.bridge || r.bridge_id).trim()
    ]);
  } else if (r.user_id) {
    rec = await query(
      `SELECT identity_id, bridge_id, display_name FROM identities WHERE LOWER(user_id) = LOWER($1) AND status = 'active' AND identity_type = 'entity'`,
      [String(r.user_id).trim()]
    );
  } else if (r.display_name || r.name) {
    const typed = (r.display_name || r.name).trim();
    /* a typed handle may be a user id or a bridge id as easily as a name — try those first, then the name */
    rec = await query(
      `SELECT identity_id, bridge_id, display_name FROM identities WHERE (LOWER(user_id) = LOWER($1) OR bridge_id = $1) AND status = 'active' AND identity_type = 'entity' LIMIT 1`,
      [typed]
    );
    if (!rec.rows.length)
      rec = await query(
        `SELECT identity_id, bridge_id, display_name FROM identities
       WHERE LOWER(display_name) = LOWER($1) AND status = 'active'
       AND identity_type = 'entity'
       /* ⚠️ never a minted party. Their display names are ordinary shop names — "Corner Hardware" — so
          without this a name typed by ANY business could resolve to another one's private supplier record.
          The typed-handle test above cannot catch this one: what was typed is a name, not a handle. */
       AND COALESCE(user_id, '') NOT LIKE '~%'`,
        [typed]
      );
  }
  return rec;
}

/** who sells (an order: the recipient; anything else: the sender) and the rate on every line the shelf can answer */
/**
 * ⭐ THE SELLER'S CURRENCY (Athi, 25 Oct, DECISIONS 14:50, walk W24: "always use the seller currency"). An order is priced in the money of the business that SELLS it: Sydney (AUD) ordering ₹650 goods
 * from Chennai (INR) was stored as 13000.00 AUD on both copies because the chit took the SENDER's money. For an order-like send (seller ≠ sender) the seller's own money is, in order:
 *   1. the seller's identities.currency_code, when this installation holds it;
 *   2. lib/regional.currencyFor(seller) — the one resolver — when the seller lives on THIS installation;
 *   3. nothing: a seller on another installation is a stub with NULL money on purpose (the business is elsewhere; regional would invent this installation's default). The caller then keeps what the
 *      buyer's screen stated (business_json.currency, the seller's price list as it showed it). With none stated sendMoney REFUSES the send (400 CURRENCY_REQUIRED, F7, 25 Oct): it never files the sender's money.
 * A self-chit, a counter bill, and anything that is not an order never come here (sendSeller decides who sells).
 * @returns {Promise<string|null>} an upper-case code, or null when this installation does not know the seller's money
 */
async function sellerMoney(sellerId) {
  const row = await query('SELECT currency_code FROM identities WHERE identity_id = $1', [sellerId]);
  const stated = row.rows[0] && row.rows[0].currency_code;
  if (stated) return String(stated).toUpperCase();
  if ((await require('../lib/ctpaddress').resolve(sellerId)).local === false) return null;
  const known = await require('../lib/regional').currencyFor(sellerId);
  return known ? String(known).toUpperCase() : null;
}

async function sendSeller(st, req, res) {
  const { sender_id, purpose, business_json, receiverDetails } = st;
  let { line_items } = st;
  // ── self_copy_pref (policy-flag #1) — copy suppression is a SELF-CHIT-ONLY affordance. On any inter-entity chit
  //    BOTH copies are mandatory (sender's Order + receiver's Task = the co-held transfer, cb-core-principle), so we
  //    only ever suppress on a PURE self-chit (self is the sole recipient). Every suppression is DECLARED on the chit
  //    via summary_json.copy_policy — the absence is governed + auditable, never a silent gap. ──
  /**
   * ⭐⭐ WHO SELLS. Athi, 2026-09-06 10:19 (Chola's order to tallytest: list prices, no offer, no rate — "it has to be the exact cart"):
   * the rate and the live offers were read from the SENDER's shelf, and the offers only for self/counter/captured chits. An ORDER
   * is sent by the buyer to the seller — the recipient's shelf and the recipient's offers are the ones that price it, exactly as
   * the storefront order path already does. Any other purpose: the sender sells (a bill, a quote, a captured message).
   */
  const orderLike = /^(order|offer)$/.test(String(purpose || ''));
  const toIds = receiverDetails
    .filter((item) => item.kind === 'to' && item.entity_id && String(item.entity_id) !== String(sender_id))
    .map((item) => String(item.entity_id));
  /* ⚠️ A COUNTER BILL IS 'order' TOO, AND THE COUNTER SELLS IT (the two-sided counter bill, 2026-10-01). Sent to an on-rail
     customer it has one 'to' recipient — read as an order, the CUSTOMER would have become the seller: their shelf, their
     offers, the shop added to the customer's own customer list. The shop whose counter numbered it sold it. */
  const counterBill = taxCopy.counterIssued(business_json);
  const sellerId = orderLike && !counterBill && toIds.length === 1 ? toIds[0] : sender_id;
  if (sellerId !== sender_id) st.currency_code = (await sellerMoney(sellerId)) || st.currency_code; /* DECISIONS 14:50: the seller's money, when this installation knows it */
  /**
   * ⭐ G1 — EVERY LINE THE SELLER'S CATALOGUE CAN ANSWER GETS ITS RATE HERE, AT SEND (STUDY-gst-structure §6).
   * A chit line carried no rate, HSN or slab; only storefront orders resolved one. The same shelf reader the
   * storefront uses (own + governed slabs, categories, face) rates a line by item_id, else by exact name — and
   * the line keeps that rate for life. ⚠️ Fails open: no shelf, no rate, the chit still sends. Never touches
   * price or total. Athi (asleep): "complete all on your own" — decision logged in BUILD_LOG.
   */
  try {
    const shelf = await taxShelf.readShelf(
      sellerId,
      { withEntity, query, regionLayer: regional.regionLayer, getFace: (eid) => catalogueView.getFace({ entity_id: eid, withEntity }) },
      { withItems: true }
    );
    if (shelf)
      line_items = taxLines.decorate(line_items, {
        items: shelf.items,
        slabs: shelf.slabs,
        categories: shelf.categories,
        face: shelf.face
      }); /* the Map, as the storefront passes it — see slabOf */
  } catch (e) {
    cbLog.fellBack('chits: the read failed — carried on without it', e); /* rate-less lines are what every chit carried until tonight */
  }
  Object.assign(st, { line_items, orderLike, toIds, counterBill, sellerId });
}

/** the seller's live offers, when the sender sells — never on a bill already priced (REV-02) */
async function sendOffers(st, req, res) {
  const { sender_id, purpose, business_json, orderLike, sellerId } = st;
  let { line_items } = st;
  /**
   * ⭐ THE SELLER'S LIVE OFFERS, AT SEND, WHEN THE SENDER SELLS (Athi, 2026-09-05: "how does it become a chit when it comes
   * through WhatsApp? check there also — the offer and tax applied correctly"). A counter bill (business_json.customer) and
   * a captured message (business_json.via — WhatsApp, email, any channel) are sent BY the seller; the storefront applied
   * the live offers to its orders and these two never did. The same function (lib/offers-live.js), the same engine, the
   * same per-line result; lines a client already discounted are left alone. Fails open, like the rate.
   *
   * ⚠️⚠️ [REV-02] "a bill the customer has paid is re-priced at today's offers when it syncs." Send time is not
   * always sale time — a till bill queued offline can reach here days later, after the shop launches a new
   * offer. offers-live.js already skips a line that carries `it.offer` (an offer the till itself applied);
   * what it never skipped was a PLAIN line with none, which is exactly what a later, unrelated offer attaches
   * itself to — the customer's ₹500 slip becomes a server-side ₹450 chit, and a credit note for the same
   * bill gets over-refunded the same way. `business_json.billed_at` is the tell: ONLY till.html/till.js ever
   * set it (grep confirms — no compose/capture/storefront path does), so it names a document that was
   * ALREADY priced and printed at a real moment in the past, not a sale being priced here for the first time.
   * A captured/typed sale (no billed_at) still needs these live offers — that path is what this block exists
   * for — so the guard is additive, not a new refusal.
   */
  let offersApplied = []; /* what the seller's live offers did to these lines (line + cart scope) — recorded on the summary */
  try {
    const bj = business_json || {};
    const alreadyBilled = require('../lib/offers-live').alreadyBilled(bj);
    const toSelf =
      Array.isArray(req.body.recipients) &&
      req.body.recipients.length &&
      req.body.recipients.every((item) => item && (item.self === true || String(item.name || '').toLowerCase() === 'self'));
    /* any purpose: the intake page records a captured message as 'general' with priced lines — still the seller's own sale */
    if (!alreadyBilled && (bj.customer || bj.via || toSelf || orderLike) && require('../lib/offers-live').isSalesDocument(purpose, bj)) {
      const cur = await require('../lib/regional')
        .currencyFor(sellerId)
        .catch(cbLog.orElse('chits sendOffers: the seller money was not read - no live offers applied', null));
      const r = await require('../lib/offers-live').applyLiveOffers({ identity_id: sellerId, currency_code: cur }, line_items, null, {
        withEntity,
        viewer: orderLike ? sender_id : null
      }); /* an order's buyer may hold a customer-only offer with this seller */
      if (r && r.items) {
        line_items = r.items;
        offersApplied = Array.isArray(r.applied) ? r.applied : [];
      }
    }
  } catch (e) {
    cbLog.fellBack('chits: the read failed — carried on without it', e); /* no offers, no change */
  }
  Object.assign(st, { line_items, offersApplied });
}

/** the invoice for a chit between two parties, computed ONCE at send (the origin) from the seller's own flags; null when a party is not on record */
async function invoiceAtSend(li, sellerId, buyerId, business_json, currency_code) {
  const pr = await query('SELECT identity_id, gstn, display_name, policy_flags, country FROM identities WHERE identity_id = ANY($1::uuid[])', [[String(sellerId), String(buyerId)]]);
  const rowOf = (id) => pr.rows.filter((x) => String(x.identity_id) === String(id))[0] || null;
  const sRow = rowOf(sellerId),
    bRow = rowOf(buyerId);
  if (!sRow || !bRow) return null;
  /* ⭐⭐⭐ [REV-01] the fix for "every server invoice is 18% too high" — this line was simply absent, so priceIncludesTax arrived as undefined
     and !!undefined taxed a GST-inclusive shelf price as if it were ex-tax. flagOf() reads the SELLER's own setting, no second query. */
  const priceIncludesTax = policy.flagOf(sRow.policy_flags, 'price_includes_tax', sRow.country) === 'yes';
  /* ⚠️ [REV-02] the invoice's own document date, not the moment sync happened to run — `at` only ever reaches DocDtls.Dt (metadata, no rate
     lookup keys on it), but a bill queued offline and sent days later must say when it was actually billed. */
  const invAt = (business_json && business_json.billed_at) || new Date().toISOString();
  return taxLines.invoiceFor({ lines: li, seller: taxLines.partyOf(sRow), buyer: taxLines.partyOf(bRow), currency: currency_code, at: invAt, priceIncludesTax }).invoice;
}

/**
 * The header's money and the invoice behind it, for ONE set of lines — gross · savings · net · tax · total, provisional, and the INV-01 invoice when the tax can be decided. The ONE
 * calculation: a send uses it (sendMoney), and so does a CHANGE ORDER (lib/change-order.js, RAIL-106) when the amending side re-issues the invoice for the proposed lines. Computed here, at the
 * origin; every other copy reads what this returned.
 * @param parties { sellerId, buyerId|null }   buyerId null (a counter bill, several recipients) = no server-side tax
 * @returns {Promise<{moneyBlock, invoice}>}   invoice is null when the tax could not be decided (tax then null, never 0)
 */
async function moneyOfLines(li, parties, business_json, currency_code) {
  const r2m = (n) => roundMoney(Number(n) || 0);
  const qtyOf = (l) => Number(l.quantity != null ? l.quantity : l.qty) || 0;
  const netOf = (l) => Number(l.total != null ? l.total : (Number(l.price) || 0) * qtyOf(l)) || 0;
  const listOf = (l) => Number(l.list_price != null ? l.list_price : l.price) || 0;
  const gross = r2m(li.reduce((sum, item) => sum + listOf(item) * qtyOf(item), 0));
  const net = r2m(li.reduce((sum, item) => sum + netOf(item), 0));
  let tax = null,
    total = null,
    originInvoice = null;
  const { sellerId, buyerId } = parties;
  const invoice = li.length && buyerId && String(sellerId) !== String(buyerId) ? await invoiceAtSend(li, sellerId, buyerId, business_json, currency_code) : null;
  const h = invoice && taxLines.heads(invoice);
  if (h && Number.isFinite(h.tax)) {
    tax = r2m(h.tax);
    total = r2m(h.total || net + tax);
    originInvoice = invoice; /* ACC-192: computed here, the origin; sendIssued carries it with the chit */
  }
  return {
    invoice: originInvoice,
    moneyBlock: {
      gross,
      savings: r2m(gross - net),
      net,
      tax,
      total: total != null ? total : tax != null ? r2m(net + tax) : null,
      currency_code,
      provisional: true
    }
  };
}

/**
 * ⭐ F7 (critic 25 Oct, Athi: "if the stuff is not there, we should not fall back, rather reject"): an order to a seller on ANOTHER installation, with no money stated by the sender's screen
 * (business_json.currency), is refused in words. This installation holds a stub with NULL money for that seller on purpose, so it cannot know the money of their price list and must not
 * file the order in the sender's money. A draft is the author's own copy and is let through.
 */
function refuseCurrencyRequired(req, res) {
  return problem(req, res, {
    status: 400,
    ...said({ error: 'Currency required', code: 'CURRENCY_REQUIRED', message: 'Say which money their price list is in, then send again.' }, codeOfStatus(400))
  });
}

/** RAIL-106: where the seller of this send lives (lib/ctpaddress resolve) — null for a counter bill or when I am the seller myself */
async function sellerPlaceOf(sendState) {
  if (sendState.counterBill || String(sendState.sellerId) === String(sendState.sender_id)) return null;
  return require('../lib/ctpaddress').resolve(sendState.sellerId);
}

/** whose tax view prices the lines: me on an order I place, the one recipient of anything else, or nobody (several recipients) */
const buyerOfSend = (orderLike, sender_id, toIds) => (orderLike ? String(sender_id) : toIds.length === 1 ? toIds[0] : null);

/** the currency the sender stated on the chit (business_json.currency), or '' */
const statedCurrencyOf = (business_json) => (business_json && typeof business_json === 'object' ? String(business_json.currency || '').trim() : '');

/**
 * ⭐ RAIL-106 (DECISIONS 13:10): a seller on another installation prices it (moneyOfLines asked nobody's tax engine here); the request and every priced round before acceptance are a QUOTATION.
 * The chit says whose country it was asked from; the seller's half is added by its priced rounds. The buyer's duty and taxes are never computed (buyer_duty_and_taxes: not_included). The words on the screen are the web's.
 */
async function stampQuotation(business_json, sender_id, sellerPlace) {
  if (!business_json || typeof business_json !== 'object' || business_json.jurisdiction) return;
  business_json.jurisdiction = { document: 'quotation', buyer_country: await countryOfEntity(sender_id), buyer_installation: process.env.INSTALLATION_KEY || null, seller_installation: sellerPlace.installation_key || null, buyer_duty_and_taxes: 'not_included' };
}

/** the header's money — gross · savings · net · tax · total, provisional */
async function sendMoney(st, req, res) {
  const { sender_id, line_items, business_json, currency_code, orderLike, toIds, counterBill, sellerId } = st;
  /**
   * ⭐⭐ THE MONEY THE HEADER CARRIES (Athi, 2026-09-07). `total_value` is the net after offers and BEFORE tax — right, but alone
   * on a list column called Amount it reads as the whole bill, and his Order list said ₹488.25 where Zoho's invoice said ₹531.
   * So the header now carries the five figures a person actually compares: gross · savings · net · tax · total (moneyOfLines above).
   * ⚠️ PROVISIONAL, AND IT SAYS SO. A tax we cannot compute is `null`, never 0 — a column showing "—" is honest, a column showing zero tax is a lie.
   */
  let moneyBlock = null;
  let originInvoice = null;
  let sellerElsewhere = false;
  try {
    /* a counter bill: no server-side tax here, exactly as for every counter bill today (the slip's own tax stands; REV-02) */
    /* ⭐ RAIL-106 (Athi, 25 Oct 12:05): a seller on ANOTHER installation prices its own goods — price, currency and tax by its own pack, at its side (lib/chit-proposal). The buyer's installation sends what and how many and runs no tax of its own on someone else's goods. */
    const sellerPlace = await sellerPlaceOf(st);
    sellerElsewhere = !!sellerPlace && sellerPlace.local === false;
    const buyerId = counterBill || sellerElsewhere ? null : buyerOfSend(orderLike, sender_id, toIds);
    ({ moneyBlock, invoice: originInvoice } = await moneyOfLines(Array.isArray(line_items) ? line_items : [], { sellerId, buyerId }, business_json, currency_code));
    if (sellerElsewhere) await stampQuotation(business_json, sender_id, sellerPlace);
  } catch (e) {
    cbLog.fellBack('chits: the read failed — carried on without it', e); /* a chit never fails to send because its money summary could not be built */
  }
  if (sellerElsewhere && !statedCurrencyOf(business_json) && !req.body.is_draft) return refuseCurrencyRequired(req, res);
  Object.assign(st, { moneyBlock, originInvoice });
}

/**
 * sit/run6 (ACC-192 x the header of 2026-09-07): an invoice computed HERE at send is priced at the sold price, so it knows no offer; the offer the lines carried
 * (the listed price beside the sold one) stays on the header: savings from the lines, gross = the invoice net + those savings, every other figure the invoice's. A counter's invoice is read as it came.
 */
function keepOffer(fromInvoice, fromLines) {
  if (!fromLines || !(Number(fromLines.savings) > Number(fromInvoice.savings || 0))) return fromInvoice;
  return Object.assign(fromInvoice, { gross: roundMoney(Number(fromInvoice.net) + Number(fromLines.savings)), savings: fromLines.savings });
}

/** a counter bill carries its invoice — the header maps it, the server only checks it */
async function sendIssued(st, req, res) {
  const { sender_id, purpose, line_items, business_json, currency_code, is_draft, receiverDetails, counterBill } = st;
  let { moneyBlock } = st;
  /**
   * ⭐⭐⭐ A COUNTER BILL CARRIES ITS INVOICE, AND THE SERVER ONLY READS IT (Athi, 2026-10-02: "the computation should happen
   * in only one place like billing, rest all the places the value has to only read … recomputation can be done, but
   * cannot rewrite what has been already wrote"). business_json.invoice is CBTax.determine()'s result from the counter's
   * billMoney(), stored as it came. The header's money is MAPPED off it (moneyOfInvoice → the engine's moneyOf) — ₹1,118.16 for bill
   * C2/26-27/0007, where the sum of its line nets said ₹1,118.15. The server's own computation runs ONLY to check it
   * (lib/tax-copy entryFor → lib/issued-invoice check): a difference is named on the chit (business_json.tax_check) and in
   * the log (tax.check-differs, for the health view); the stored invoice is never replaced. Fails open, like the block above.
   */
  let issuedTotal = null;
  /* ⭐⭐⭐ ACC-192 (Athi 2026-10-25): "the computation happens in only one place where it originates, rest of the places it just displays it as
     a record". The invoice sendMoney computed at send travels with the chit exactly as a counter bill's does — business_json.invoice, read by
     tax-copy and carried over CTP — so no copy computes it again. Never over an invoice already carried, never on a draft. */
  if (business_json && !business_json.invoice && st.originInvoice && !is_draft) business_json.invoice = st.originInvoice;
  const carried = business_json && business_json.invoice;
  /* ACC-192: every chit that carries its invoice (the counter's, or the one sendMoney computed at send) is mapped the same way; only the
     counter's is checked, because only the counter computed it somewhere other than here */
  if (!is_draft && carried && typeof carried === 'object' && carried.ValDtls && Number.isFinite(Number(carried.ValDtls.TotInvVal))) {
    moneyBlock = keepOffer(moneyOfInvoice(carried, currency_code), carried === st.originInvoice ? moneyBlock : null);
    issuedTotal = moneyBlock.total;
  }
  if (counterBill && issuedTotal != null) await checkCounterInvoice(st);
  Object.assign(st, { moneyBlock, issuedTotal });
}

/** a counter bill's invoice was computed at the counter: the server checks it and names a difference on the chit, never replacing it (ACC-192: only the
 *  counter's invoice is checked, because only the counter computed it somewhere other than here; the roster is the sender plus every receiver) */
async function checkCounterInvoice(sendState) {
  const { sender_id, purpose, line_items, business_json, currency_code, receiverDetails } = sendState;
  try {
    const e = await taxCopy.entryFor(
      {
        chit_id: null,
        sender_entity_id: sender_id,
        purpose,
        business_json,
        line_items,
        currency_code,
        all_recipients: [{ entity_id: sender_id, role: 'sender' }].concat(
          receiverDetails.filter((item) => item.entity_id).map((item) => ({ entity_id: item.entity_id, role: item.all_role || 'receiver' }))
        ),
        sent_at: business_json.billed_at || null
      },
      sender_id
    );
    if (e && e.tax_check && !e.tax_check.ok) {
      business_json.tax_check = { at: new Date().toISOString(), differences: e.tax_check.differences, kept: 'issued' };
      require('../lib/logger').warn('tax.check-differs', { entity_id: sender_id, bill_no: business_json.bill_no, says: e.tax_check.says });
    }
  } catch (e) {
    cbLog.fellBack('chits: the helper failed — carried on without it', e); /* the check never stops a bill — the stored invoice stands either way */
  }
}

/**
 * ⭐ CTRY-76 (Round 1 E2; Athi Q1 30 Oct: HELD, refuse only a bad buyer tax id) — THE PAPER A COUNTER BILL IS, read once at send from the
 * SHOP's pack (lib/bill-paper: reg-au from A$1,000 the buyer's identity or ABN, GST Act s.29-70(1)(c)(ii)). Its own step, OUTSIDE sendIssued's
 * fail-open try, because a refusal here must reach the counter. A buyer tax id that fails the pack's one check (profile.taxIdRefusal — the same
 * call shop setup runs) → 400 BUYER_TAX_ID_BAD. A sale the pack wants the buyer on, with nobody named → the sale stands, recorded under the
 * counter's own name (business_json.not_invoice 'buyer_identity', the till's M41 slot — a reason the counter already wrote stands) and the
 * answer says so (not_invoice.code INVOICE_HELD_BUYER + the pack's sentence), so the counter can ask for the buyer before "Tax invoice" is printed.
 * The frozen invoice and the money are never touched. A draft, a non-counter chit, a shop with no pack rule: nothing.
 */
async function sendPaper(sendState, req, res) {
  const { sender_id, business_json, currency_code, is_draft } = sendState;
  if (is_draft || !taxCopy.counterIssued(business_json)) return;
  const paper = billPaper.paperOf({ country: await countryOfEntity(sender_id), business_json, currency: currency_code });
  if (paper.refusal) {
    res.locals.code = paper.refusal.code;
    return problem(req, res, {
      status: 400,
      ...said({ error: 'Buyer tax number not accepted', code: paper.refusal.code, field: paper.refusal.field, message: paper.refusal.why }, 'CHIT_BAD_REQUEST')
    });
  }
  if (paper.held) {
    if (!business_json.not_invoice) business_json.not_invoice = paper.held.reason;
    sendState.paper = { code: 'INVOICE_HELD_BUYER', not_invoice: business_json.not_invoice, why: paper.held.why, cite: paper.held.cite };
  }
}

/** which copies a self-chit or a numbered document keeps — declared, never silent */
async function sendCopyPolicy(st, req, res) {
  const { sender_id, client_ref, is_draft, promote_draft_id, selfCopyPref, hasSelf, receiverDetails } = st;
  const pureSelfChit = hasSelf && !is_draft && !promote_draft_id && receiverDetails.every((item) => item.entity_id === sender_id);
  /**
   * ⚠️ ENGINE TOUCH, STRICTLY ADDITIVE — a PER-SEND copy choice, and it can only ever narrow a PURE SELF-CHIT.
   *
   * Athi, 2026-08-09: *"we can create a self chit and you can make the order copy none, it will create a task."*
   * That is the right shape for an inbound request: the entity did NOT send it — someone outside asked — so a
   * copy sitting in their Order/Sent list would be a lie about who asked. Task-only is the truthful record.
   *
   * The account-wide setting could not express this: it would have flipped EVERY self-chit they ever author.
   * A single send needs to say it for itself.
   *
   * WHAT THIS DOES NOT DO — it lives INSIDE the pureSelfChit branch and nowhere else, so it cannot reach an
   * inter-entity chit. Both copies stay mandatory there (cb-core-principle: the co-held transfer is the point),
   * and both suppressed copies here belong to the SAME entity, so nobody loses a record they hold. The choice is
   * DECLARED on the chit exactly as the setting's is, with `source` recording which of the two decided it — a
   * suppression that cannot be told apart from a gap is not governed.
   */
  const reqSelfCopy = ['both', 'sent', 'received'].includes(String(req.body.self_copy || '')) ? String(req.body.self_copy) : null;
  const effSelfCopy = reqSelfCopy || selfCopyPref;
  const copySource = reqSelfCopy ? 'request' : 'setting';
  let copyPolicy = null,
    suppressSentCopy = false;
  if (pureSelfChit) {
    // every self-chit KEEPS its identity (scope:'self') — recorded, not showcased
    if (effSelfCopy === 'sent') {
      // ORDER-only → drop the self Task (received) copy
      const si = receiverDetails.findIndex((item) => item.entity_id === sender_id);
      if (si >= 0) receiverDetails.splice(si, 1);
      copyPolicy = { scope: 'self', kept: ['sent'], suppressed: ['received'], reason: 'Task copy suppressed — self-chit (Order only)', source: copySource };
    } else if (effSelfCopy === 'received') {
      // TASK-only → drop the sender Order (sent) copy
      suppressSentCopy = true;
      copyPolicy = { scope: 'self', kept: ['received'], suppressed: ['sent'], reason: 'Order copy suppressed — self-chit (Task only)', source: copySource };
    } else if (client_ref) {
      /**
       * ── ⚠⚠⚠ A NUMBERED DOCUMENT IS ONE ROW PER ENTITY, WHATEVER THE COPY SETTING SAYS ──────────
       *
       * b263 puts a UNIQUE INDEX on (entity_id, client_ref). 'both' writes the sender copy AND the recipient
       * copy — and on a pure self-chit those are the SAME entity — so a shop whose self_copy_pref is 'both'
       * would have every counter bill refused with a 23505 and **be unable to sell**. The column defaults to
       * 'received' so nothing is broken today; this is the trap the index arms for the day somebody changes
       * it, and it is armed silently, which is the worst kind.
       *
       * ⭐ AND IT IS THE RIGHT ANSWER ON ITS OWN MERITS, not merely a way round the constraint. Two rows in
       * one shop's books both claiming to BE invoice C1/26-27/0033 is not a copy, it is a second voucher —
       * the exact thing the index exists to prevent. A self-copy is a useful idea for a message; for a
       * numbered tax document it is a duplicate with a nicer name.
       * ⚠ DECLARED, NEVER SILENT — copyPolicy is how this file records a suppression, and `source` says who
       * decided it. A suppression that cannot be told apart from a gap is not governed (see the note above).
       */
      suppressSentCopy = true;
      copyPolicy = {
        scope: 'self',
        kept: ['received'],
        suppressed: ['sent'],
        reason:
          'Order copy suppressed — ' +
          client_ref +
          ' is a numbered document, and a number ' +
          "may appear once in a shop's books (b263). The setting asked for both.",
        source: 'numbered-document'
      };
    } else {
      // BOTH → keep both copies, but STILL declare the self-chit identity
      copyPolicy = { scope: 'self', kept: ['sent', 'received'], suppressed: [], reason: 'Self-chit — both copies', source: copySource };
    }
  } else if (client_ref && hasSelf && !is_draft && !promote_draft_id) {
    /**
     * ⚠️⚠️ THE SAME RULE WHEN THE NUMBERED DOCUMENT ALSO GOES OUT (the two-sided counter bill, 2026-10-01). A counter bill
     * to an on-rail customer is self + the customer: not a PURE self chit, so the branch above never ran and the shop got
     * TWO rows — its 'sent' Order copy and its self Task copy — both carrying client_ref, which b263's unique index refuses:
     * the counter could not sell to a connected customer at all. The shop keeps the ONE row it keeps for every counter bill
     * (the self copy); the customer holds their own. Declared, like every suppression here.
     */
    suppressSentCopy = true;
    copyPolicy = {
      scope: 'sender',
      kept: ['received'],
      suppressed: ['sent'],
      reason: 'One copy for the sender — ' + client_ref + ' is a numbered document, and a number may appear once ' + "in a shop's books (b263).",
      source: 'numbered-document'
    };
  }
  Object.assign(st, { copyPolicy, suppressSentCopy });
}

/**
 * ⚠️⚠️ client_ref IS THE SENDER'S REPLAY KEY, NOT A FACT ABOUT THE TRADE — so it stays on the sender's own row only.
 * b263's unique index is (entity_id, client_ref) over EVERY row an entity holds, received ones included: a counter bill
 * C1/26-27/0041 sent to a customer whose own counter has issued C1/26-27/0041 (two shops, both on the default prefix)
 * would be refused on the CUSTOMER's row, and the whole send with it — retried for ever. The bill's number travels as
 * bill_no on every copy; only the dedupe key is withheld.
 */
function sendBjFor(st, eid) {
  const { client_ref, business_json, sender_id } = st;
  return client_ref && business_json && typeof business_json === 'object' && String(eid) !== String(sender_id)
    ? (() => {
        const o = Object.assign({}, business_json);
        delete o.client_ref;
        return o;
      })()
    : business_json;
}

/**
 * ⭐⭐ THE CUSTOMER'S COPY OF A COUNTER BILL IS NAMED FOR WHAT IT IS (Athi, 2026-10-01). To them it is not an order to
 * fulfil but a BILL to accept: purpose 'invoice' (the purpose an app-side supplier invoice already has, so the ledger's
 * invoice reading and every purchase reader apply), marked `counter_bill: true` with the bill's number, till and terms
 * kept, its own subject ("Bill C1/26-27/0041 from Mayur Traders") and, on its summary, what the list row shows — who
 * it is from, the number, and what is owed. The SHOP's own copy is untouched. One chit, each copy in its holder's words.
 */
function sendBillCopyFor(st, receiver) {
  const { counterBill, is_draft, sender_id, sender_display_name } = st;
  if (!counterBill || is_draft || receiver.kind !== 'to' || !receiver.entity_id || String(receiver.entity_id) === String(sender_id)) return null;
  const bj = Object.assign({}, sendBjFor(st, receiver.entity_id), { counter_bill: true });
  const parts = bj.payment && Array.isArray(bj.payment.parts) ? bj.payment.parts : [];
  const total = roundMoney(parts.reduce((sum, item) => sum + (Number(item && item.amount) || 0), 0));
  return {
    purpose: 'invoice',
    business_json: bj,
    manual_subject: 'Bill ' + bj.bill_no + ' from ' + (sender_display_name || 'the seller'),
    bill_received: { from: sender_display_name || null, no: String(bj.bill_no), total }
  };
}

/** promoting a draft: it must be this entity's draft, and its page goes with it */
async function sendPromote(st, req, res) {
  const { sender_id, pageAsked, promote_draft_id } = st;
  let { pageStamp } = st;
  // ── validateSend hook: when promoting a draft, it must be THIS entity's draft. (Baseline/supplier-window
  //    and other send-time rules will plug in here when we build Suppliers.) ──
  if (promote_draft_id) {
    const dchk = await withEntity(sender_id, (db) =>
      db.query(`SELECT role, business_json->>'page' AS page FROM chit_header WHERE chit_id = $1 AND entity_id = $2`, [promote_draft_id, sender_id])
    );
    if (dchk.rows.length === 0) return problem(req, res, { status: 404, ...said({ error: 'Not found', message: 'Draft not found' }, 'NOT_FOUND') });
    if (dchk.rows[0].role !== 'Draft') return problem(req, res, { status: 400, ...said({ error: 'Not a draft', message: 'This chit has already been sent' }, 'CHIT_BAD_REQUEST') });
    /* the draft's page goes with it when the resend does not name one — a draft resumed through a form that does not
       carry business_json.page must not quietly become a base-page chit (N03) */
    if (pageAsked == null && dchk.rows[0].page) {
      const kept = mint.page(dchk.rows[0].page);
      if (kept.ok) pageStamp = kept;
    }
  }
  Object.assign(st, { pageStamp });
}

/** the chit id, the moment, the bell, and every participant (the operator too) */
async function sendParticipants(st, req, res) {
  const { sender_id, sender_bridge_id, sender_display_name, purpose, is_draft, promote_draft_id, traceEdge, receiverDetails } = st;
  // Generate chit_id — same for ALL participants (reuse the draft's id when promoting, so the draft BECOMES the order)
  const chit_id = promote_draft_id || uuidv4();
  const now = CLOCK.now(); /* Y1b: the one clock — the day a bill lands on (books-hooks.dayOf) and the day it is listed under agree */

  // Build all_recipients — snapshot with sender + all recipients (with fan-out roles)
  /* ⭐ THE BELL RINGS FOR EVERY RECIPIENT once this response has gone out (i.e. after the commit) — lib/events.js */
  try {
    require('../lib/events').notifyAfter(
      res,
      receiverDetails.map((item) => item.entity_id),
      { kind: 'chit', id: chit_id, who: sender_display_name || null, note: purpose || null }
    );
  } catch (e) {
    cbLog.fellBack('chits: the signal was not sent — carried on without it', e);
  }
  const all_recipients = [
    {
      entity_id: sender_id,
      bridge_id: sender_bridge_id,
      display_name: sender_display_name,
      role: 'sender'
    },
    ...receiverDetails.map((item) => ({
      entity_id: item.entity_id,
      bridge_id: item.bridge_id,
      display_name: item.display_name,
      role: item.all_role
    }))
  ];

  // ── Operator mandate (Fragment 2): a network handoff names an OPERATOR that is mandated to CO-HOLD the edge
  //    for oversight, so it can walk its whole subtree (visibility ≡ co-holding — no god-view, no BYPASSRLS).
  //    Resolve it here so the participant snapshot lists it; its REDACTED oversight copy (edge only, no
  //    commercial terms — TR-6) is appended alongside the receiver copies below. Additive on the trace path. ──
  let operatorInfo = null;
  if (traceEdge && traceEdge.network && traceEdge.network.operator && !is_draft) {
    const opId = traceEdge.network.operator;
    if (opId !== sender_id && !receiverDetails.some((item) => item.entity_id === opId)) {
      const opRow = await query(`SELECT identity_id, bridge_id, display_name FROM identities WHERE identity_id = $1 AND status = 'active'`, [opId]);
      if (opRow.rows[0]) {
        operatorInfo = opRow.rows[0];
        all_recipients.push({
          entity_id: operatorInfo.identity_id,
          bridge_id: operatorInfo.bridge_id,
          display_name: operatorInfo.display_name,
          role: 'operator'
        });
      }
    }
  }
  Object.assign(st, { chit_id, now, all_recipients, operatorInfo });
}

/** the subject, the summary, the priority and the retention each copy keeps */
async function sendRetention(st, req, res) {
  const { sender_display_name, purpose, line_items, issuedTotal, now } = st;
  // Generate auto subject
  const auto_subject = generateAutoSubject(purpose, sender_display_name, now, st.clock);

  // Calculate summary from line items
  const summary = calculateSummary(line_items);
  /* ⭐ a counter bill's value is its invoice's TotInvVal (above), never the sum of its line nets */
  if (issuedTotal != null) summary.total_value = issuedTotal;
  // External priority: set by the drafter at compose, immutable once sent (rides on the shared header summary).
  const ext_priority = PRIORITIES.includes((req.body.external_priority || '').trim()) ? req.body.external_priority.trim() : 'normal';
  // ── chit expiry (Phase 1, NON-DESTRUCTIVE) — record an optional retention/expiry on the chit; nothing auto-retires
  //    or deletes yet (retire = Ph2, purge = Ph3, gated). Migration-free: rides summary_json.retention like copy_policy.
  //    Per-chit override now; the governed DEFAULT lives in the governance channel (backlog), not a Settings toggle. ──
  const DEFAULT_RETENTION_DAYS = null; // governed default resolves from the cascade later
  let retention = null;
  {
    const rd = Number.isFinite(+req.body.retention_days) && +req.body.retention_days > 0 ? Math.floor(+req.body.retention_days) : null;
    let exp = null,
      src = null,
      days = null;
    if (typeof req.body.expires_at === 'string' && !isNaN(Date.parse(req.body.expires_at))) {
      exp = new Date(req.body.expires_at).toISOString();
      src = 'manual';
    } else if (rd) {
      exp = new Date(Date.now() + rd * 86400000).toISOString();
      src = 'manual';
      days = rd;
    } else if (DEFAULT_RETENTION_DAYS) {
      exp = new Date(Date.now() + DEFAULT_RETENTION_DAYS * 86400000).toISOString();
      src = 'default';
      days = DEFAULT_RETENTION_DAYS;
    }
    if (exp) retention = { expires_at: exp, retention_days: days, source: src };
  }
  /**
   * ⚠️⚠️ RETENTION IS PER COPY, AND EACH COPY'S OWNER SETS ITS FLOOR (backlog 11).
   *
   * `retention` above rides on the SHARED summary — it is the sender's DECLARATION, and until now that is
   * all it was: nothing in the codebase wrote `chit_status.retention_expires_at`, so every copy silently
   * took the schema default. Applying the declaration without a floor would have handed a sender the power
   * to set an expiry on the RECEIVER's copy, which is the spoofing route this guards.
   *
   * ⚠️ MAX, NEVER MIN. A counterparty may ask you to keep a record longer than your floor and you will; they
   * can never make your copy disappear sooner. And it is computed PER COPY on purpose — the two parties may
   * legitimately differ, which is the entire point of a per-copy model.
   *
   * ⚠️ Nothing deletes yet (retire is Ph2, purge Ph3, both human-gated), so this ships the guard BEFORE the
   * thing it guards — which is the only order in which it is worth building.
   */
  const _reqDays = retention && retention.retention_days ? +retention.retention_days : null;
  /* SET-26 (K-DB, 21 Oct 2026): the copy's days AND the rule that set them, declared the way copy_policy declares its source —
     records_law (CO3, RECORDS_FLOOR_DAYS) · own_floor (the owner's retention_floor_days) · sender_asked (the sender's retention_days).
     `stamp`: chit_status.retention_source exists (b771), so the copy row carries the source; before b771 the days alone, as before. */
  const retainDaysFor = async (owner_id) => {
    let floor = 90;
    try {
      const f = await policy.get(owner_id);
      if (Number.isFinite(+f.retention_floor_days)) floor = +f.retention_floor_days;
    } catch (e) {
      cbLog.fellBack('chits retainDaysFor: failed — carried on without it', e); /* unreadable policy → keep the schema default; never shorten on an error */
    }
    return copyRetention(floor, _reqDays, await schema.hasColumn('chit_status', 'retention_source')); /* CO3: MAX over the records-law floor */
  };
  Object.assign(st, { auto_subject, summary, ext_priority, retention, retainDaysFor });
}

/** the governed lineage, the held clearances and the commercial cover — folded, frozen */
async function sendFolds(st, req, res) {
  const { sender_id, summary } = st;
  // ── assimilation seam: resolve the boilerplate for this send — constitution + capability + pattern + the canonical
  //    SHARED standard (ISO 9000) — and stamp the lineage. Best-effort: never blocks the send. This is the mint
  //    assimilating a per-brand context AND a shared source into one chit (routes send-chit through the seam). ──
  let governed = null;
  try {
    const cfg = await require('../lib/workpattern').resolveWorkPattern('send-chit', { entity_id: sender_id });
    if (cfg)
      governed = {
        pattern: cfg._blueprint,
        capability: cfg._capability,
        constitution: cfg._constitution,
        standard: cfg._standard,
        standards: cfg._standards,
        boilerplate: cfg._boilerplate
      };
  } catch (e) {
    cbLog.fellBack('chits: the helper failed — carried on without it', e); /* seam is best-effort */
  }
  // ── ORDER-BINDING: fold the sender's HELD clearances into the chit (per-copy snapshot, FROZEN). The buyer sees, on
  //    THIS order, exactly the supplier's clearances met + their assurance rung; later changes never alter this copy.
  //    Best-effort — never blocks the send. ──
  let folded_clearances = null;
  try {
    const rd = await require('../lib/readiness').resolveReadiness(sender_id);
    const held = (rd.clearances || [])
      .filter((item) => item.status === 'gathered' || item.status === 'expiring')
      .map((item) => ({
        standard: item.standard,
        doc: item.doc,
        title: item.title,
        rung: item.rung,
        valid_until: item.valid_until || null,
        verified_at: item.verified_at || null,
        verified_by: item.verified_by || null
      }));
    if (held.length) folded_clearances = { folded_at: new Date().toISOString(), items: held };
  } catch (e) {
    cbLog.fellBack('chits: the helper failed — carried on without it', e); /* best-effort */
  }
  // ── COMMERCIAL COVER fold — a trade order (one that carries clearances) also freezes its commercial-cover FRAMEWORK
  //    onto the buyer's copy: payment/transit/currency/credit cover by risk, and which is already evidenced on-rail
  //    (e.g. performance risk = the supplier's on-rail track record). Framework, not a secured instrument — honest.
  //    Buyer sees "💳 Commercial cover" beside "🛡 Supplier clearances", frozen. Best-effort — never blocks the send. ──
  let folded_commercial = null;
  try {
    if (folded_clearances) {
      const inc = (summary && summary.incoterm) || 'CIF';
      const ci = require('../lib/instruments').resolveInstruments({ cross_border: 1, incoterm: inc });
      const areas = (ci.cluster || []).map((item) => ({
        label: item.label,
        frm_class: item.frm_class,
        on_rail: !!item.covered_onrail,
        instruments: (item.instruments || []).map((entry) => entry.name)
      }));
      if (areas.length) folded_commercial = { folded_at: new Date().toISOString(), incoterm: inc, areas };
    }
  } catch (e) {
    cbLog.fellBack('chits: the helper failed — carried on without it', e); /* best-effort */
  }
  Object.assign(st, { governed, folded_clearances, folded_commercial });
}

/* The whitelist for the provenance rider above. A string field is trimmed and capped; `sender_verified` is
   forced to a real boolean, because "the sender is verified" is a claim that must never arrive as a truthy
   string. Unknown keys are dropped rather than carried. */
function sendViaOf(business_json) {
  const v = business_json && business_json.via;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const str = (x, n) => (x === null || x === undefined || x === '' ? null : String(x).slice(0, n || 120));
  const out = {
    channel: str(v.channel, 24),
    from: str(v.from, 64),
    from_name: str(v.from_name, 120),
    to: str(v.to, 64),
    provider_msg_id: str(v.provider_msg_id, 128),
    capture_id: str(v.capture_id, 64),
    received_at: str(v.received_at, 40),
    read_by: str(v.read_by, 40),
    /* Order-level facts that have no column of their own. `unplaced` is what the reader could not place at
       all — surfaced, never dropped: a request that quietly lost 'deliver at 7pm' looks correct and is not. */
    delivery_at: str(v.delivery_at, 120),
    delivery_address: str(v.delivery_address, 300),
    notes: str(v.notes, 800),
    unplaced: str(v.unplaced, 800),
    sender_verified: v.sender_verified === true,
    // What they actually wrote, capped — the full text rides as an attachment, not in every copy's summary.
    raw_excerpt: str(v.raw_excerpt, 400),
    media_count: Number.isFinite(+v.media_count) ? Math.max(0, Math.min(20, +v.media_count)) : 0,
    label: str(v.label, 40),
    /* How each line got its price. Re-read key by key rather than spread: the counts must be numbers and the
       lists must be short, whatever a caller sends. */
    priced: (() => {
      const p = v.priced;
      if (!p || typeof p !== 'object') return undefined;
      const n = (x) => (Number.isFinite(+x) ? Math.max(0, Math.min(999, Math.trunc(+x))) : 0);
      const arr = (a, f) => (Array.isArray(a) ? a.slice(0, 5).map(f) : []);
      return {
        from_catalogue: n(p.from_catalogue),
        unpriced: n(p.unpriced),
        catalogue_used: p.catalogue_used !== false,
        ambiguous: arr(p.ambiguous, (x) => ({ name: str(x && x.name, 200), matches: n(x && x.matches) })),
        asked_differs: arr(p.asked_differs, (x) => ({ name: str(x && x.name, 200), asked: +x.asked || 0, ours: +x.ours || 0 }))
      };
    })()
  };
  return out.channel ? out : null; // no channel, no provenance — a `via` naming nothing is noise
}

/** each party's detail-page reading, resolved once per party */
async function sendDesigns(st, req, res) {
  const { sender_id, is_draft, receiverDetails } = st;
  /**
   * The sending entity's detail-page preference, resolved once and stamped below.
   *
   * ⚠️ `undefined` WHEN IT IS THE DEFAULT, deliberately: `mint.summary()` adds a rider only when it is
   * neither undefined nor null, so an entity that never chose does not get a stamp claiming it did. That
   * chit then falls back to whatever its reader prefers — which is the honest reading of "never chosen".
   *
   * ⚠️ Best-effort: a policy read that fails must not stop a chit being sent. No stamp is a recoverable
   * state; a refused send is not.
   */
  let _detailDesign;
  /**
   * ⭐⭐ ONE LOOKUP PER PARTY, and each copy is stamped with ITS OWN owner's choice — see the note at the
   * recipient insert. `detail_design` is the single key in summary_json that is allowed to differ between
   * copies, because it is not a fact about the trade: it is how the holder reads their own work.
   *
   * ⚠️ Cached per send. A chit to eight recipients must not be eight extra round trips on the hottest
   * write in the product, and two recipients are frequently the same entity in different roles.
   */
  const _designCache = new Map();
  const _designFor = async (eid) => {
    if (!eid) return undefined;
    if (_designCache.has(eid)) return _designCache.get(eid);
    let d;
    try {
      const _pf = await policy.get(eid);
      if (_pf && _pf.detail_design && _pf.detail_design !== 'chit') d = _pf.detail_design;
    } catch (e) {
      cbLog.fellBack('chits _designFor: failed — carried on without it', e); /* no stamp; Order level, which is the default anyway */
    }
    _designCache.set(eid, d);
    return d;
  };
  _detailDesign = await _designFor(sender_id);
  /* Resolved for every recipient BEFORE the transaction opens — an await inside it would hold a connection
     open across a policy read for each party. */
  if (!is_draft) for (const r of receiverDetails) await _designFor(r.entity_id);
  Object.assign(st, { _detailDesign, _designCache });
}

/** The shared summary, with only this copy's reading swapped in. */
function sendSummaryFor(st, eid) {
  const { _designCache, _detailDesign, summary_json } = st;
  const d = _designCache.get(eid);
  if (d === _detailDesign) return summary_json; // identical — share the object
  const s = Object.assign({}, summary_json);
  if (d) s.detail_design = d;
  else delete s.detail_design;
  return s;
}

/** the shared summary every copy carries */
async function sendSummary(st, req, res) {
  const {
    purpose,
    business_json,
    currency_code,
    traceEdge,
    offersApplied,
    moneyBlock,
    copyPolicy,
    now,
    summary,
    ext_priority,
    retention,
    governed,
    folded_clearances,
    folded_commercial,
    _detailDesign
  } = st;
  /* the provenance rider, whitelisted (sendViaOf) */
  const via = sendViaOf(business_json);
  /* ⚠️ The SKELETON comes from lib/mint.js; every rider below is still decided here. mint.summary() adds a rider
     only when it is neither undefined nor null — the same test the conditional spreads made by hand, four
     times, in four files. */
  const summary_json = mint.summary({
    line_item_count: summary.line_item_count,
    total_value: summary.total_value,
    money: moneyBlock,
    offers: offersApplied,
    currency_code,
    priority_external: ext_priority,
    purpose,
    is_promotion: !!(business_json && business_json.is_promotion),
    /* RAIL-LAB-SRV1: a lab chit says so on every copy (sendLab proved the shop may; mint.summary keeps the rider only when true) */
    lab: st.lab ? true : undefined,
    // Forward keeps a reference to the source chit (new thread; content unchanged) so it can be grouped later.
    forwarded_from: typeof req.body.forwarded_from === 'string' && req.body.forwarded_from.length <= 64 ? req.body.forwarded_from : null,
    copy_policy: copyPolicy,
    retention,
    /**
     * ⭐⭐ THE DESIGN IS STAMPED HERE AND KEPT FOR LIFE. Athi, 2026-08-24: *"attach design 1 or design 2 as
     * per the choice in the settings, in the header record — so we avoid the complication of moving from
     * one record type to another and both can be tested independently."*
     *
     * ⚠️ A STAMP, NOT A LOOKUP. Reading the preference at render time would mean every existing job silently
     * changed shape the moment someone touched Settings — a chit reading one way on Monday and another on
     * Tuesday, with no event to explain it. Written once, at creation, from whatever the preference then was.
     *
     * ⚠️ ONLY THE SENDER'S OWN COPY IS STAMPED, and that is a boundary, not an oversight: the design belongs
     * to the entity that INTERPRETS the work, and one entity may not read another's settings. A recipient's
     * copy carries no stamp and falls back to their own preference until they have one of their own.
     *
     * ⭐ Migration-free — it rides `summary_json` exactly as `copy_policy` and `retention` do.
     */
    detail_design: _detailDesign,
    governed,
    clearances: folded_clearances,
    commercial: folded_commercial,
    // Traceability edge — frozen onto every co-held copy (Fragment 1). parents is a SET (forward fan-out is the spread).
    trace: traceEdge ? { ...traceEdge, sealed_at: now.toISOString() } : null,
    /**
     * ⚠️ ENGINE TOUCH #2, ADDITIVE — channel PROVENANCE, echoed onto the summary so it rides every copy and is
     * readable from a list without opening the chit. Present only when declared, exactly like `trace`; a chit
     * sent without it is byte-identical to before.
     *
     * It belongs on summary_json rather than only on business_json because provenance that has to be dug for is
     * provenance nobody reads. Six weeks after a disputed order, "where did this come from" is the first
     * question, and business_json is not on the list row.
     *
     * ⚠️ WHITELISTED, NOT COPIED. summary_json is ours; letting a caller spread arbitrary keys into it would
     * make the chit's own summary a place strangers can write. Known keys, coerced, capped.
     */
    via
  });
  Object.assign(st, { summary_json });
}

/** freeze-at-send: the governing schema */
async function sendFreeze(st, req, res) {
  const { sender_id } = st;
  // ── Freeze-at-send (A10): snapshot the governing schema = sender's active default schema ──
  const schemaRow = await query(
    `SELECT schema_id, schema_version
       FROM entity_schemas
      WHERE entity_id = $1 AND status = 'active' AND is_default = true
      ORDER BY created_at DESC
      LIMIT 1`,
    [sender_id]
  );
  const frozen_schema_id = schemaRow.rows[0]?.schema_id || null;
  const frozen_schema_version = schemaRow.rows[0]?.schema_version || null;
  const created_by_actor_id = req.identity.identity_id; // who actually pressed send
  Object.assign(st, { frozen_schema_id, frozen_schema_version, created_by_actor_id });
}

/** every participant's copy — the sender's, each receiver's in its holder's words */
async function sendCopies(st, req, res) {
  const {
    sender_id,
    sender_bridge_id,
    sender_display_name,
    purpose,
    manual_subject,
    line_items,
    pageStamp,
    is_draft,
    receiverDetails,
    now,
    all_recipients,
    auto_subject,
    summary,
    summary_json,
    frozen_schema_id,
    frozen_schema_version,
    created_by_actor_id,
    suppressSentCopy
  } = st;
  let { business_json } = st;
  // ── Compose the per-participant copies for the delivery layer (SENDER always; RECEIVERS unless draft).
  //    Every copy carries the SAME sender = the caller, which is chit_deliver's isolation gate. ──
  /* ⚠️ SHAPE from lib/mint.js — and ONLY the shape. Everything above this line (recipient resolution, the caps,
     copy_policy, retention, freeze-at-send, the trace edge) is this route's POLICY and has not moved: it is
     engine-locked and is the reference implementation the other three paths were imitating badly. */
  /* ⭐ THE PAGE STAMP (N03): on the header of every copy that carries business data — sender, receivers, a bill copy.
     Added onto what the sender sent, never a rewrite of it; set ONCE here and written by no route afterwards. */
  business_json = Object.assign({}, business_json && typeof business_json === 'object' ? business_json : {}, { page: pageStamp.page });
  st.business_json = business_json; /* the page-stamped business data — what bjFor / billCopyFor read from here on */
  const _summaryFor = (eid) => sendSummaryFor(st, eid),
    bjFor = (eid) => sendBjFor(st, eid),
    billCopyFor = (receiver) => sendBillCopyFor(st, receiver);
  const headerCommon = mint.header({
    sender_entity_id: sender_id,
    sender_entity_bridge_id: sender_bridge_id,
    sender_entity_display_name: sender_display_name,
    all_recipients,
    purpose,
    auto_subject,
    manual_subject: manual_subject || null,
    summary_json,
    schema_version: frozen_schema_version,
    schema_id: frozen_schema_id,
    created_by_actor_id,
    detail_type: purpose,
    line_item_count: summary.line_item_count,
    total_value: summary.total_value,
    currency_code: summary_json.currency_code,
    created_at: now,
    sent_at: now /* Y1b: the shop clock's moment (b300 reads it; before b300 the definer stamps NOW() as it always did) */
  });
  const mkCopy = (extra) =>
    mint.party(
      headerCommon,
      Object.assign(
        {
          // omitted -> SQL NULL (matches legacy): chit_deliver reads c->>'key', for which an absent key and a JSON
          // null are indistinguishable, so passing them conditionally is the same write either way.
          business_json: business_json || undefined,
          line_items: line_items.length > 0 ? line_items : undefined
        },
        extra
      )
    );
  const copies = suppressSentCopy
    ? []
    : [
        mkCopy({
          entity_id: sender_id,
          direction: 'sent',
          role: is_draft ? 'Draft' : 'Act',
          current_status: railActions.SENT_STATUS,
          priority_flag: 'normal',
          payload_delivered: true,
          log: {
            action: 'created',
            action_by_identity_id: sender_id,
            action_by_display_name: sender_display_name,
            new_status: railActions.SENT_STATUS,
            detail: `Chit created and sent to ${receiverDetails.map((item) => item.display_name).join(', ')}`
          }
        })
      ];
  if (!is_draft)
    for (const receiver of receiverDetails) {
      const rcv_status = railActions.arrivalStatus(receiver.kind); // the one table: To acts (pending); CC/For are informed (delivered)
      const billCopy = billCopyFor(receiver); /* the customer's copy of a counter bill — a bill, in their words */
      copies.push(
        mkCopy(
          Object.assign(
            {
              /**
               * ⭐⭐ THE RECIPIENT'S COPY CARRIES THE RECIPIENT'S READING — see _summaryFor above. Every other key
               * here is the shared record and must not diverge; `detail_design` is the one exception, because it is
               * not a fact about the trade but how the holder of THIS copy reads their own work.
               *
               * ⚠️ Set on the LIVE path as well as the legacy fan-out below. The operator's redacted copy proved
               * per-copy summary_json was already a seam — this rides the same one rather than inventing another.
               */
              summary_json: _summaryFor(receiver.entity_id),
              business_json: bjFor(receiver.entity_id) || undefined /* the sender's replay key stays on the sender's row (bjFor) */,
              entity_id: receiver.entity_id,
              direction: 'received',
              role: receiver.role,
              current_status: rcv_status,
              priority_flag: 'normal',
              log: {
                action: 'delivered',
                action_by_identity_id: sender_id,
                action_by_display_name: sender_display_name,
                new_status: rcv_status,
                detail: `Chit received from ${sender_display_name} (${receiver.kind.toUpperCase()})`
              }
            },
            billCopy
              ? {
                  purpose: billCopy.purpose,
                  detail_type: billCopy.purpose,
                  manual_subject: billCopy.manual_subject,
                  business_json: billCopy.business_json,
                  summary_json: Object.assign({}, _summaryFor(receiver.entity_id), { purpose: billCopy.purpose, bill_received: billCopy.bill_received })
                }
              : {}
          )
        )
      );
    }
  Object.assign(st, { business_json, headerCommon, copies });
}

/** the network operator's redacted oversight copy — the edge, never the terms */
async function sendOperatorCopy(st, req, res) {
  const { sender_id, sender_display_name, is_draft, operatorInfo, summary_json, headerCommon, copies } = st;
  // Operator's REDACTED oversight copy — co-holds the EDGE (product/qty/topology) but NOT commercial terms:
  // no business_json, no line_items, total_value nulled. That is TR-6 at write time — the operator physically
  // never holds a rival deal's price, it only holds the traceable edge.
  if (operatorInfo && !is_draft) {
    /* ⚠️ NOT mint.summary() — DELIBERATELY. This is a REDACTED summary, and its whole purpose is to be missing
       keys the real one has. Passing it through the skeleton builder would helpfully restore currency_code and
       total_value, handing the operator the commercial terms this copy exists to withhold. A builder that fills
       in defaults is the wrong tool for a record defined by what it leaves out. */
    const opSummary = { line_item_count: summary_json.line_item_count, purpose: summary_json.purpose, trace: summary_json.trace, oversight: true };
    copies.push(
      mint.party(headerCommon, {
        summary_json: opSummary,
        total_value: null,
        entity_id: operatorInfo.identity_id,
        direction: 'received',
        role: 'For',
        current_status: railActions.ARRIVAL.for,
        log: {
          action: 'oversight',
          action_by_identity_id: sender_id,
          action_by_display_name: sender_display_name,
          new_status: railActions.ARRIVAL.for,
          detail: `Network oversight co-hold (edge only) — ${operatorInfo.display_name}`
        }
      })
    );
  }
}

/** the guaranteed write — every row commits together (the definer, or the legacy fan-out before b50) */
async function sendWrite(st, req, res) {
  const { sender_id, business_json, is_draft, promote_draft_id, receiverDetails, chit_id, now, copies } = st;
  // ── Guaranteed write: every row for this chit commits together, or none do (INV-2). Delivery is a substrate
  //    op (writes each participant's copy, incl. receivers) -> the b50 SECURITY DEFINER fn chit_deliver, run in
  //    withEntity(sender). Fallback to the legacy in-tx fan-out when b50 isn't applied. ──
  if (await definersReady()) {
    /**
     * ⭐ THE FIRST BILL ENDS THE LEAD — IN THE BILL'S OWN TRANSACTION (L2C step 5, FX-L2C 2026-10-13). A counter bill is sent to
     * SELF and names its customer in business_json.customer; the post-commit auto-add below counts RECIPIENTS, so the named
     * party's txn_count never moved (a billed lead stayed "Trial"; Ravi Stores read 0 trades after three years). One withEntity
     * holds chit_deliver AND the bump (lib/crm.traded: one UPDATE, never an insert); the bump sits in a SAVEPOINT so a CRM
     * write can never fail a guaranteed chit (D-065). A named party that is also a recipient is left to the recipient block.
     */
    const namedParty = !is_draft ? require('../lib/crm').namedParty(business_json) : null;
    const isRecipient = namedParty && receiverDetails.some((item) => String(item.entity_id) === String(namedParty));
    await withEntity(sender_id, async (c) => {
      if (st.sourceCarry) await costWrite.verifySourceCarry(c, sender_id, st.sourceId, st.sourceCarry, st.sourceOptions); /* RAIL-149: the draft's money is still what was carried, read under the lock */
      await mint.deliver(sender_id, chit_id, copies, { is_draft: !!promote_draft_id, client: c });
      if (namedParty && !isRecipient) await trySavepoint(c, () => require('../lib/crm').traded(c, sender_id, namedParty, now), null);
    });
  } else {
    await sendLegacyWrite(st);
  }
}

/** the legacy fan-out (before b50's definer): every row in one transaction, the draft's own rows cleared first when promoting */
async function sendLegacyWrite(st) {
  const { promote_draft_id, chit_id, sender_id, suppressSentCopy, is_draft, receiverDetails } = st;
  await withTransaction(async (client) => {
    if (promote_draft_id) {
      // promoting/updating: clear the draft's own rows so this chit re-inserts cleanly under the SAME id
      await client.query('DELETE FROM state_log  WHERE chit_id = $1 AND entity_id = $2', [chit_id, sender_id]);
      await client.query('DELETE FROM chit_detail WHERE chit_id = $1 AND entity_id = $2', [chit_id, sender_id]);
      await client.query('DELETE FROM chit_status WHERE chit_id = $1 AND entity_id = $2', [chit_id, sender_id]);
      await client.query('DELETE FROM chit_header WHERE chit_id = $1 AND entity_id = $2', [chit_id, sender_id]);
    }
    // SENDER (suppressed for a task-only self-chit — no Order copy needed)
    if (!suppressSentCopy) await sendLegacySenderRows(client, st);

    // RECIPIENTS (skipped for drafts — a draft is the author's copy only)
    if (!is_draft) for (const receiver of receiverDetails) await sendLegacyReceiverRows(client, st, receiver);
  });
}

/** the legacy fan-out: the sender's own four rows */
async function sendLegacySenderRows(client, st) {
  const {
    chit_id,
    sender_id,
    sender_bridge_id,
    sender_display_name,
    all_recipients,
    purpose,
    auto_subject,
    manual_subject,
    summary_json,
    business_json,
    frozen_schema_version,
    frozen_schema_id,
    created_by_actor_id,
    is_draft,
    now,
    summary,
    line_items,
    retainDaysFor,
    receiverDetails
  } = st;
  await client.query(
    `INSERT INTO chit_header
     (chit_id, entity_id, sender_entity_id, sender_entity_bridge_id,
      sender_entity_display_name, all_recipients, purpose,
      auto_subject, manual_subject, summary_json, business_json,
      schema_version, schema_id, created_by_actor_id, role, chit_ref, direction, sent_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18)`,
    [
      chit_id,
      sender_id,
      sender_id,
      sender_bridge_id,
      sender_display_name,
      JSON.stringify(all_recipients),
      purpose,
      auto_subject,
      manual_subject || null,
      JSON.stringify(summary_json),
      business_json ? JSON.stringify(business_json) : null,
      frozen_schema_version,
      frozen_schema_id,
      created_by_actor_id,
      is_draft ? 'Draft' : 'Act',
      chit_id,
      'sent',
      now
    ]
  );
  await client.query(
    `INSERT INTO chit_detail
     (chit_id, entity_id, detail_type, line_item_count,
      total_value, currency_code, line_items, direction, payload_delivered_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
    [
      chit_id,
      sender_id,
      purpose,
      summary.line_item_count,
      summary.total_value,
      summary_json.currency_code,
      line_items.length > 0 ? JSON.stringify(line_items) : null,
      'sent'
    ]
  );
  const kept = await retainDaysFor(sender_id); // internal priority starts normal; each party sets its own (external rides on summary_json)
  await client.query(
    `INSERT INTO chit_status (chit_id, entity_id, current_status, direction, priority_flag,
                              retention_expires_at, retire_at${kept.col})
     VALUES ($1,$2,'delivered','sent',$3, now() + ($4 || ' days')::interval, now() + ($4 || ' days')::interval${kept.val})`,
    [chit_id, sender_id, 'normal', String(kept.days)].concat(kept.params)
  );
  await client.query(
    `INSERT INTO state_log
     (chit_id, entity_id, action, action_by_identity_id,
      action_by_display_name, new_status, detail)
     VALUES ($1,$2,'created',$3,$4,'delivered',$5)`,
    [chit_id, sender_id, sender_id, sender_display_name, `Chit created and sent to ${receiverDetails.map((item) => item.display_name).join(', ')}`]
  );
}

/** the legacy fan-out: one receiver's four rows, in its holder's words */
async function sendLegacyReceiverRows(client, st, receiver) {
  const {
    chit_id,
    sender_id,
    sender_bridge_id,
    sender_display_name,
    all_recipients,
    purpose,
    auto_subject,
    manual_subject,
    frozen_schema_version,
    frozen_schema_id,
    created_by_actor_id,
    now,
    summary,
    summary_json,
    line_items,
    retainDaysFor
  } = st;
  const _summaryFor = (eid) => sendSummaryFor(st, eid),
    bjFor = (eid) => sendBjFor(st, eid),
    billCopyFor = (r) => sendBillCopyFor(st, r);
  const rcv_status = railActions.arrivalStatus(receiver.kind); // the one table (rail-actions ARRIVAL), as the live path above
  const billCopy = billCopyFor(receiver); /* the same per-copy reading as the live path above */
  const rcvPurpose = billCopy ? billCopy.purpose : purpose;
  const rcvBj = billCopy ? billCopy.business_json : bjFor(receiver.entity_id);
  const rcvSummary = billCopy
    ? Object.assign({}, _summaryFor(receiver.entity_id), { purpose: billCopy.purpose, bill_received: billCopy.bill_received })
    : _summaryFor(receiver.entity_id);
  await client.query(
    `INSERT INTO chit_header
     (chit_id, entity_id, sender_entity_id, sender_entity_bridge_id,
      sender_entity_display_name, all_recipients, purpose,
      auto_subject, manual_subject, summary_json, business_json,
      schema_version, schema_id, created_by_actor_id, role, chit_ref, direction, sent_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18)`,
    [
      chit_id,
      receiver.entity_id,
      sender_id,
      sender_bridge_id,
      sender_display_name,
      JSON.stringify(all_recipients),
      rcvPurpose,
      auto_subject,
      (billCopy ? billCopy.manual_subject : manual_subject) || null,
      /**
       * ⭐⭐ THE RECIPIENT'S COPY CARRIES THE RECIPIENT'S READING. Athi, 2026-08-24: *"the customer copy
       * and supplier copy should be the same, but the interpretation can be in another tab — how the
       * customer request is interpreted can stay within the receiving end."*
       *
       * ⚠️⚠️ EVERY OTHER KEY IN summary_json IS THE SHARED RECORD AND MUST NOT DIVERGE — the value, the
       * lines, the clearances, the provenance. `detail_design` is the one exception, because it is not a
       * fact about the trade at all: it is how the holder of THIS copy reads their own work. Stamping
       * the sender's choice here would let a customer decide how a workshop organises its mechanics.
       *
       * ⚠️ Read server-side, per copy. This is not one entity reading another's settings — no client
       * ever sees it — it is the server writing each copy the way its own owner asked to read it.
       */
      JSON.stringify(rcvSummary),
      rcvBj ? JSON.stringify(rcvBj) : null,
      frozen_schema_version,
      frozen_schema_id,
      created_by_actor_id,
      receiver.role,
      chit_id,
      'received',
      now
    ]
  );
  await client.query(
    `INSERT INTO chit_detail
     (chit_id, entity_id, detail_type, line_item_count,
      total_value, currency_code, line_items, direction)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      chit_id,
      receiver.entity_id,
      rcvPurpose,
      summary.line_item_count,
      summary.total_value,
      summary_json.currency_code,
      line_items.length > 0 ? JSON.stringify(line_items) : null,
      'received'
    ]
  );
  const kept = await retainDaysFor(receiver.entity_id); /* ⚠️ THE RECEIVER'S OWN FLOOR, not the sender's: each recipient's copy keeps its own minimum */
  await client.query(
    `INSERT INTO chit_status (chit_id, entity_id, current_status, direction,
                              retention_expires_at, retire_at${kept.col})
     VALUES ($1,$2,$3,'received', now() + ($4 || ' days')::interval, now() + ($4 || ' days')::interval${kept.val})`,
    [chit_id, receiver.entity_id, rcv_status, String(kept.days)].concat(kept.params)
  );
  await client.query(
    `INSERT INTO state_log
     (chit_id, entity_id, action, action_by_identity_id,
      action_by_display_name, new_status, detail)
     VALUES ($1,$2,'delivered',$3,$4,$5,$6)`,
    [chit_id, receiver.entity_id, sender_id, sender_display_name, rcv_status, `Chit received from ${sender_display_name} (${receiver.kind.toUpperCase()})`]
  );
}

/** after the commit: the customer lists (the sender's, and an order's seller's) */
async function sendCustomers(st, req, res) {
  const { sender_id, is_draft, receiverDetails, orderLike, sellerId } = st;
  // ── Best-effort CRM auto-add — AFTER commit; a CRM write must never fail a guaranteed chit (D-065) ──
  // Q4: this post-commit write is OUTSIDE the delivery, so it runs in its OWN withEntity(sender) — customer_list
  // is RLS-scoped on owner_entity_id, so a bare query() would fail closed under FORCE.
  if (!is_draft)
    for (const receiver of receiverDetails) {
      try {
        await withEntity(sender_id, async (db) => {
          const isSupplier = await db.query(
            `SELECT 1 FROM supplier_list
            WHERE owner_entity_id = $1 AND supplier_entity_id = $2`,
            [sender_id, receiver.entity_id]
          );
          if (isSupplier.rows.length === 0) {
            await db.query(
              `INSERT INTO customer_list
               (owner_entity_id, customer_identity_id, customer_type, added_via, txn_count, last_txn_at)
             VALUES ($1, $2, 'entity', 'transaction', 1, NOW())
             ON CONFLICT (owner_entity_id, customer_identity_id)
             DO UPDATE SET txn_count = customer_list.txn_count + 1, last_txn_at = NOW()`,
              [sender_id, receiver.entity_id]
            );
          }
        });
      } catch (e) {
        cbLog.fellBack('chits send: the customer was not added to the party list — the chit is sent without it', e);
      }
    }
  /* ⭐ THE SELLER'S CUSTOMER LIST for an order sent from the Suppliers menu (2026-09-06, found by [OFF-03]): the block above records the
     RECEIVER as the SENDER's customer — right for a bill the seller sends, backwards for an order, where the BUYER sends. The seller
     (the recipient who sells) gets the row, the way the storefront order path gives the shop one (CJ-06). Best-effort, after commit. */
  if (!is_draft && orderLike)
    for (const receiver of receiverDetails) {
      if (String(receiver.entity_id) !== String(sellerId) || String(sellerId) === String(sender_id)) continue;
      try {
        await withEntity(sellerId, (db) =>
          db.query(
            `INSERT INTO customer_list
           (owner_entity_id, customer_identity_id, customer_type, added_via, txn_count, last_txn_at)
         VALUES ($1, $2, 'entity', 'transaction', 1, NOW())
         ON CONFLICT (owner_entity_id, customer_identity_id)
         DO UPDATE SET txn_count = customer_list.txn_count + 1, last_txn_at = NOW()`,
            [sellerId, sender_id]
          )
        );
      } catch (e) {
        cbLog.fellBack('chits send: the seller was not added to the party list — the chit is sent without it', e);
      }
    }
}

/** after the commit: auto-assign each actionable copy by its own entity */
async function sendAssign(st, req, res) {
  const { is_draft, receiverDetails, chit_id } = st;
  // ── Best-effort auto-assign on receipt (D1) — AFTER commit; never fails the guaranteed chit ──
  // Only the actionable 'to' copy is auto-assigned; CC/For stay informational. Each receiver entity
  // resolves against ITS OWN settings/roster (the receiver decides how its inbox auto-assigns).
  if (!is_draft)
    for (const receiver of receiverDetails) {
      if (receiver.kind !== 'to' || !receiver.entity_id) continue;
      try {
        await autoAssignReceived(receiver.entity_id, chit_id);
      } catch (e) {
        cbLog.fellBack('chits send: the chit was not auto-assigned — it is sent unassigned', e);
      }
    }
}

/** meter the send — after the work, never able to fail it */
async function sendMeter(st, req, res) {
  const { sender_id, purpose, is_draft, chit_id, summary, summary_json } = st;
  /**
   * ⭐⭐ METER THE SEND. b99 named `chit.send` in its own header two months ago and nothing ever wrote it,
   * so the ledger has billed AI drafts and KYB lookups while the platform's central act was free.
   *
   * ⚠️ AFTER THE WORK, NEVER BEFORE, AND IT CANNOT FAIL THE SEND — `meter()` swallows and warns. A chit
   * that failed because its meter failed would lose a person's work to protect a fraction of a cent, and
   * `chit_header` still evidences the send either way.
   *
   * ⚠️ DRAFTS ARE NOT METERED. A draft is not an act on the rail — nothing was sent, nobody received a
   * copy, and billing for one would charge a person for changing their mind.
   *
   * ⚠️ NOT AWAITED, deliberately: the response should not wait on a billing row. The `.catch` is belt and
   * braces — `meter()` already never rejects — but an unhandled rejection here would take the process
   * down, and this is the hottest path in the product.
   */
  if (!is_draft) {
    try {
      /**
       * ⭐ THE BASIS TRAVELS WITH THE CHARGE. Athi's reason for wanting cost recorded per chit was that a
       * later model — profit share, percentage-of-value, tiered — needs the BASIS and the RATE together.
       * The trade's value is right here at send; carrying it into the ledger row means switching model is
       * a rate-card change rather than a data-archaeology exercise.
       *
       * ⚠️ It is what the value WAS at send, which is the only figure that can be charged against. A later
       * amend changes the chit and must not retro-change what was billed.
       */
      require('../lib/meter')
        .meter(sender_id, 'chit.send', {
          detail: chit_id,
          quantity: 1,
          rid: req.id,
          basis: summary && summary.total_value != null ? summary.total_value : null,
          currency: (summary_json && summary_json.currency_code) || null,
          meta: { purpose: purpose || undefined }
        })
        .catch(cbLog.orElse('chits: failed — carried on without it'));
    } catch (e) {
      cbLog.fellBack('chits: the helper failed — carried on without it', e);
    }
  }
}

/** stock moves when goods move — after the commit, not awaited */
async function sendStock(st, req, res) {
  const { sender_id, purpose, line_items, business_json, is_draft, chit_id, now } = st;
  /**
   * ── ⭐⭐⭐ STOCK MOVES WHEN GOODS MOVE (2026-09-10) ─────────────────────────────────────────────────────
   *
   * Athi: *"wire goods-in and sales to post movements."* Goods received put stock IN at its landed cost; a
   * counter bill takes it OUT. lib/stock-from-chit.js decides which chits qualify and returns [] for the
   * great majority — an order is a promise, a draft is nothing, and a despatch note is deliberately not
   * wired because for a counter shop it would take the same goods out twice.
   *
   * ⚠️⚠️ AFTER THE COMMIT, AND NOT AWAITED — the same posture as the meter above, for the same reason: this
   * is the hottest path in the product and a sale that has already happened must not fail because a stock
   * row could not be written. The trade is real and worth naming: a failure here is LOST until somebody
   * notices. It is survivable only because the movements are re-derivable from the chit at any time, with
   * the same ref and the same idempotency, so a backfill heals it — and because the balance is a cache that
   * rebuild() can check against the log.
   *
   * ⚠️ Idempotent by (entity, ref, line_ref, reason), so the counter replaying its queue moves nothing twice.
   */
  if (!is_draft) {
    try {
      require('../lib/stock-from-chit')
        .postFor(sender_id, { chit_id, purpose, is_draft, business_json, line_items, created_at: now }, withEntity, {
          actor_id: req.identity && req.identity.identity_id
        })
        .then((reply) => {
          if (!reply || (!reply.failed.length && !reply.skipped.length)) return;
          /* ⚠️ SAID, NOT SWALLOWED. "Half the lines silently did nothing" is exactly how a stock ledger rots,
             and a skipped line is usually legitimate (labour, delivery) — so it is logged, never guessed at. */
          try {
            require('../lib/logger').warn('stock.from-chit', {
              chit_id,
              entity_id: sender_id,
              moved: reply.moved,
              duplicate: reply.duplicate,
              skipped: reply.skipped.length,
              failed: reply.failed,
              /* STK-FIX1b: a REFUSED line (an unreadable batch or expiry) is named with its sentence and code — a count alone is silence */
              refused: reply.skipped
                .filter((item) => item.code === 'batch_unreadable' || item.code === 'expiry_unreadable')
                .map((item) => ({ line_ref: item.line_ref, item_id: item.item_id, code: item.code, why: item.why }))
            });
          } catch (e) {
            cbLog.fellBack('chits: the helper failed — carried on without it', e);
          }
        })
        .catch(cbLog.orElse('chits: failed — carried on without it')); /* postFor already never rejects; this is belt and braces on the hot path */
    } catch (e) {
      cbLog.fellBack('chits: the helper failed — carried on without it', e);
    }
  }
}

/** the ledger hears about it — each side that holds a copy posts its own view */
async function sendBooks(st, req, res) {
  const { sender_id, is_draft, receiverDetails, chit_id } = st;
  /**
   * ⭐⭐ THE LEDGER HEARS ABOUT IT (SPEC-books-v2 §3) — AFTER the commit, never awaited, never able to fail the chit:
   * lib/books-hooks.afterChit swallows everything and parks what cannot post in books_outbox, named. Off (the
   * default) it is one cached read. Each side that holds a copy posts its OWN view: the sender, and every 'to'
   * receiver (a supplier's invoice is the receiving shop's purchase).
   */
  if (!is_draft) {
    try {
      const hooks = require('../lib/books-hooks');
      const who = req.identity && req.identity.identity_id;
      setImmediate(() => {
        hooks.afterChit(sender_id, chit_id, who);
        for (const r of receiverDetails)
          if (r.kind === 'to' && r.entity_id && String(r.entity_id) !== String(sender_id)) hooks.afterChit(r.entity_id, chit_id, null);
      });
    } catch (e) {
      cbLog.fellBack('chits: the helper failed — carried on without it', e);
    }
  }
}

/** the answer, then the counter's place in its series */
async function sendAnswer(st, req, res) {
  const { sender_id, client_ref, number_check, oneSided, business_json, is_draft, counts, receiverDetails, chit_id, auto_subject, summary_json } = st;
  res.json(costWrite.hideSendAnswer(st.sourceCarry, { /* RAIL-149: a blind sender who carried the draft money is not told it */
    message: is_draft ? 'Draft saved' : 'Chit sent successfully',
    chit_id,
    auto_subject,
    is_draft,
    recipients: is_draft ? 0 : receiverDetails.length,
    fan_out: { to: counts.to, cc: counts.cc, for: counts.for },
    summary: summary_json,
    /* ⚠ present only when something is wrong, so a caller can treat its absence as silence rather than as
       a claim that the number was checked and approved. */
    number_check: number_check || undefined,
    /* ⭐ present only when the customer's copy was not sent — the counter shows it on the bill */
    one_sided: oneSided || undefined,
    /* ⭐ CTRY-76: present only when this bill went out as NOT a tax invoice because the buyer is not named (sendPaper) — the counter asks for the buyer */
    not_invoice: st.paper || undefined
  }));

  /**
   * ⭐⭐ THE COUNTER'S PLACE IN ITS SERIES, KEPT IN THE CLOUD (2026-09-17). Athi: *"the system should be updated
   * with the next seq number whenever the sync completes."* A counter bill carries { prefix, period, seq }; a
   * registered counter's high-water mark moves with it, so the next PC to open that counter continues from here.
   * ⚠️ AFTER the answer, and never able to fail the send — a missed update costs nothing the counter's own
   * count and its close do not already carry.
   */
  if (!is_draft && client_ref && business_json && business_json.series) {
    setImmediate(() => {
      require('../lib/counters-store')
        .noteBill(sender_id, business_json.series, business_json.billed_at, client_ref)
        .catch(cbLog.orElse('chits: the helper failed — carried on without it'));
    });
  }
}

// ─── GET /chits/inbox ─────────────────────────────────────────
// Lightweight inbox — my chit_status only — fast
// GET /chits/sent — chits I sent (my sender copy), newest first, paginated.
// Mounted BEFORE /:chit_id so "sent" is never parsed as a chit_id.
// Advanced-search filters shared by the chit lists: amount range, date range, priority, status bucket.
// All parameterised (no injection). Used by /inbox, /sent, /folder. (Criteria set can become schema-driven later.)
/* ── PERF1 · the chit lists' page: a server-side maximum, and keyset paging in the default (newest-first) order ── */
const PAGE_LIMIT = require('../lib/page-limit');
/** a chit list's page — ALWAYS a page (inbox · sent · folder were never answered whole): the one clamp, and whether the asked size
 *  was cut, so the answer can say so (W2-RAIL R2: PAGE_LIMIT.capOf → `capped` + `cap_note`, never a silent 200-row ceiling) */
function listPage(req) {
  return PAGE_LIMIT.pageArgs({ page: req.query.page, limit: req.query.limit != null ? req.query.limit : LIST_PAGE }, LIST_PAGE, LIST_MAX);
}
/**
 * ?after=<created_at, µs, UTC>|<chit_id> — the `next` the page before answered. Only in the default order (newest first): any other sort keeps
 * page + OFFSET. → { where } appended to the list's WHERE (params pushed). The cursor carries microseconds (keyCol below), so no row is skipped.
 */
function keysetOf(req, params, a) {
  if ((req.query.sort && req.query.sort !== 'date') || String(req.query.dir || '').toLowerCase() === 'asc') return { where: '' };
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z)\|([0-9a-f-]{36})$/i.exec(String(req.query.after || ''));
  if (!m) return { where: '' };
  params.push(m[1], m[2]);
  return { where: ` AND (${a}.created_at::timestamptz, ${a}.chit_id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)` };
}
/** the cursor column a list selects (its last row's becomes `next`), printed in the session's zone — db/index.js pins it to UTC */
const keyCol = (a) => `to_char(${a}.created_at::timestamptz, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || ${a}.chit_id::text AS _after`;
/** `next` from a page's rows (null on a short page, or in another order) — and the cursor column taken off every row */
function afterOf(rows, limit, req) {
  const last = rows[rows.length - 1],
    keyed = !(req.query.sort && req.query.sort !== 'date') && String(req.query.dir || '').toLowerCase() !== 'asc';
  const next = keyed && rows.length === limit && last ? last._after || null : null;
  rows.forEach((item) => {
    delete item._after;
  });
  return next;
}

function chitFilters(req, where, params) {
  /**
   * ⚠️ A FOLDER IS A FILTER ON THIS LIST, NOT A SECOND SCREEN. Athi, 2026-08-10: *"we just pass the parameter as
   * folder name and filter data accordingly, so the same panel works for each folder."*
   *
   * It lives in the SHARED filter builder so Task and Order both get it from one line — a folder under Order is
   * the Order list filtered, exactly as a folder under Task is the Task list filtered. Putting it in each route
   * separately is how the two would drift.
   */
  const fid = String(req.query.folder_id || '').trim();
  if (/^[0-9a-f-]{36}$/i.test(fid)) {
    params.push(fid);
    where += ` AND cs.folder_id = $${params.length}::uuid`;
  }
  const num = (v) => {
    const n = parseFloat(v);
    return isFinite(n) ? n : null;
  };
  const amin = num(req.query.amount_min),
    amax = num(req.query.amount_max);
  if (amin !== null) {
    params.push(amin);
    where += ` AND COALESCE((ch.summary_json->>'total_value')::numeric,0) >= $${params.length}`;
  }
  if (amax !== null) {
    params.push(amax);
    where += ` AND COALESCE((ch.summary_json->>'total_value')::numeric,0) <= $${params.length}`;
  }
  /* ⭐ a date filter is the SHOP's day (M210): midnight in the shop's own zone (identities.timezone, b176; else its country pack's zone, else UTC) — the
     same rule as books-hooks.dayBounds, spelt in SQL because this builder is synchronous and a trip to read the zone is not
     affordable here. `timestamp AT TIME ZONE zone` names the instant that midnight is; it compares right against created_at
     before b301 (naive, read as UTC by the pinned session zone) and after it (timestamptz). */
  const dateQ = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim());
  if (dateQ(req.query.date_from) || dateQ(req.query.date_to)) {
    params.push(entityId(req)); /* the SHOP (an actor's parent entity), whose zone it is */
    const zone = `COALESCE((SELECT COALESCE(z.timezone, ${require('../lib/country-setup').zoneCaseSql('z')}) FROM identities z WHERE z.identity_id = $${params.length}::uuid), 'UTC')`;
    if (dateQ(req.query.date_from)) {
      params.push(String(req.query.date_from).trim());
      where += ` AND ch.created_at >= ($${params.length}::date::timestamp AT TIME ZONE ${zone})`;
    }
    if (dateQ(req.query.date_to)) {
      params.push(String(req.query.date_to).trim());
      where += ` AND ch.created_at < (($${params.length}::date + 1)::timestamp AT TIME ZONE ${zone})`;
    }
  } else {
    /* a full timestamp: as before, an instant */
    if (req.query.date_from) {
      params.push(req.query.date_from);
      where += ` AND ch.created_at >= $${params.length}::timestamptz`;
    }
    if (req.query.date_to) {
      params.push(req.query.date_to);
      where += ` AND ch.created_at < ($${params.length}::date + interval '1 day')`;
    }
  }
  /* ⭐ TRADE-SRV1 G3: ?abroad=1 → only the trades across a border (another currency, or a party in another country) — ONE fragment
     (country-setup.abroadSql, beside shopCountrySql), so Task, Order and every folder answer the same */
  if (req.query.abroad === '1' || req.query.abroad === 'true') {
    params.push(entityId(req));
    where += ` AND ${require('../lib/country-setup').abroadSql('ch', params.length)}`;
  }
  if (req.query.priority) {
    params.push(req.query.priority);
    where += ` AND cs.priority_flag = $${params.length}`;
  }
  if (req.query.fstatus) {
    /* ⭐ W2-RAIL R2: the buckets are the ONE table (lib/rail-actions BUCKETS, read off the engine's transitions) — never spelled here */
    const list = railActions.BUCKETS[req.query.fstatus] || [req.query.fstatus];
    const ph = list
      .map((item) => {
        params.push(item);
        return '$' + params.length;
      })
      .join(',');
    where += ` AND cs.current_status IN (${ph})`;
  }
  // Delegation scope: unassigned = the entity's own pool; assigned = delegated to a co-assist. assigned_to=me|<id>
  // scopes to one actor (fixes actor "My Task"). No param = everything (back-compat).
  if (req.query.assignment === 'unassigned') where += ` AND cs.assigned_to_actor_id IS NULL`;
  else if (req.query.assignment === 'assigned') where += ` AND cs.assigned_to_actor_id IS NOT NULL`;
  const at = req.query.assigned_to;
  if (at === 'me') {
    params.push(req.identity.identity_id);
    where += ` AND cs.assigned_to_actor_id = $${params.length}`;
  } else if (at && at !== 'me' && at !== 'all') {
    params.push(at);
    where += ` AND cs.assigned_to_actor_id = $${params.length}`;
  }
  // D4: dispute filter — chits with an OPEN dispute THIS entity holds a copy of (per-copy: RLS scopes to my own copies).
  if (req.query.dispute === 'open' || req.query.dispute === 'active') {
    where += ` AND EXISTS (SELECT 1 FROM chit_disputes cd WHERE cd.chit_id = ch.chit_id AND cd.status = 'open')`;
  }
  return where;
}

/**
 * S34: a chit of the three mailbox lists, as each statement selects it and in its order — the allow-list of the answer, named once per list (the cancel
 * columns only when cancelCols named them: undefined is left out). summary_json and all_recipients are documents whose keys are the chit's own, so the
 * answer schema leaves the row open (listed in docs/contracts/api-output-shapes.json) and this mapping is what keeps an unnamed column out.
 */
// prettier-ignore
const sentRow = (x) => ({ chit_id: x.chit_id, all_recipients: x.all_recipients, purpose: x.purpose, auto_subject: x.auto_subject, manual_subject: x.manual_subject, summary_json: x.summary_json, created_at: x.created_at, role: x.role, current_status: x.current_status, priority_flag: x.priority_flag, customer_priority: x.customer_priority, star_flag: x.star_flag, cancel_requested_at: x.cancel_requested_at, cancel_requested_by: x.cancel_requested_by, cancel_reason: x.cancel_reason, cancel_confirmed_at: x.cancel_confirmed_at, cancel_confirmed_by: x.cancel_confirmed_by, open_dispute_count: x.open_dispute_count, resolved_dispute_count: x.resolved_dispute_count });
// prettier-ignore
const folderRow = (x) => ({ chit_id: x.chit_id, sender_entity_display_name: x.sender_entity_display_name, sender_entity_bridge_id: x.sender_entity_bridge_id, all_recipients: x.all_recipients, purpose: x.purpose, auto_subject: x.auto_subject, manual_subject: x.manual_subject, summary_json: x.summary_json, created_at: x.created_at, role: x.role, current_status: x.current_status, read_at: x.read_at, star_flag: x.star_flag, priority_flag: x.priority_flag, deleted_at: x.deleted_at, archived_at: x.archived_at, direction: x.direction, cancel_requested_at: x.cancel_requested_at, cancel_requested_by: x.cancel_requested_by, cancel_reason: x.cancel_reason, cancel_confirmed_at: x.cancel_confirmed_at, cancel_confirmed_by: x.cancel_confirmed_by, message_count: x.message_count });
// prettier-ignore
const inboxRow = (x) => ({ chit_id: x.chit_id, sender_entity_display_name: x.sender_entity_display_name, sender_entity_bridge_id: x.sender_entity_bridge_id, all_recipients: x.all_recipients, purpose: x.purpose, auto_subject: x.auto_subject, manual_subject: x.manual_subject, summary_json: x.summary_json, created_at: x.created_at, current_status: x.current_status, read_at: x.read_at, star_flag: x.star_flag, priority_flag: x.priority_flag, cancel_requested_at: x.cancel_requested_at, cancel_requested_by: x.cancel_requested_by, cancel_reason: x.cancel_reason, cancel_confirmed_at: x.cancel_confirmed_at, cancel_confirmed_by: x.cancel_confirmed_by, assignment_type: x.assignment_type, assigned_to_actor_id: x.assigned_to_actor_id, assigned_to_actor_display_name: x.assigned_to_actor_display_name, open_dispute_count: x.open_dispute_count, resolved_dispute_count: x.resolved_dispute_count, message_count: x.message_count, last_message_at: x.last_message_at, placed_by_name: x.placed_by_name, placed_by_type: x.placed_by_type });

router.get('/sent', auth, ...checked('GET /sent'), async (req, res) => {
  try {
    const entity_id = entityId(req);
    /* PERF1: as the Inbox — a server-side maximum, keyset after page 1, the count on page 1 only */
    const pg = listPage(req),
      page = pg.page,
      limit = pg.limit;
    const q_search = (req.query.q || '').trim(), blind = await cost.isCostBlind(req, entity_id), ignored = costView.moneyParams(req, blind); /* RAIL-146: ONE cost read per request; a blind reader's amount filter and sort are taken off and named back */

    // search across the header data (subject, recipients, purpose). pg_trgm GIN index recommended at scale.
    const params = [entity_id];
    let where = `ch.entity_id = $1 AND ch.direction = 'sent' AND ch.role <> 'Draft' AND cs.deleted_at IS NULL AND cs.archived_at IS NULL`;
    /* ⭐⭐ the Order list leaves out bills the same way Task does (lib/folder-inventory inboxSql) — they live in Bills · Issued */
    where += ` AND ${FOLDER_INV.inboxSql('ch', 'cs')}`;
    if (q_search) {
      params.push('%' + q_search + '%');
      where += ` AND (ch.manual_subject ILIKE $${params.length} OR ch.auto_subject ILIKE $${params.length} OR ch.all_recipients::text ILIKE $${params.length} OR ch.purpose ILIKE $${params.length})`;
    }
    const joinFrom = `FROM chit_header ch
         JOIN chit_status cs ON cs.chit_id = ch.chit_id AND cs.entity_id = ch.entity_id AND cs.direction = ch.direction`;

    where = chitFilters(req, where, params);
    const countWhere = where,
      countParams = params.slice();
    const ks = keysetOf(req, params, 'ch');
    if (ks.where) where += ks.where;
    const offset = ks.where ? 0 : (page - 1) * limit;
    // B1 RLS: caller reads only its own entity_id rows -> run inside withEntity(me).
    const { countResult, result, roles } = await withEntity(entity_id, async (db) => {
      const nestedCountResult = page === 1 && !ks.where ? await db.query(`SELECT COUNT(*) ${joinFrom} WHERE ${countWhere}`, countParams) : null;

      const limIdx = params.length + 1,
        offIdx = params.length + 2;
      const _cancelCol = await cancelCols();
      const outcome = await db.query(
        `SELECT ch.chit_id, ch.all_recipients, ch.purpose, ch.auto_subject, ch.manual_subject,
              ch.summary_json, ch.created_at, ch.role,
              cs.current_status, cs.priority_flag, cs.customer_priority, cs.star_flag,
              /* b195 cancel-request flag, named only when the column exists — see the note above the query. */
              ${_cancelCol}
              (SELECT COUNT(*) FROM chit_disputes cd
                WHERE cd.chit_id = ch.chit_id AND cd.status = 'open') AS open_dispute_count,
              (SELECT COUNT(*) FROM chit_disputes cd
                WHERE cd.chit_id = ch.chit_id AND cd.status = 'resolved') AS resolved_dispute_count,
              ${keyCol('ch')}${costView.sideColsSql('ch', blind)}
         ${joinFrom}
        WHERE ${where}
        ORDER BY ${{ date: 'ch.created_at', subject: 'COALESCE(ch.manual_subject, ch.auto_subject)', from: "(ch.all_recipients->1->>'display_name')", amount: "(ch.summary_json->>'total_value')::numeric", status: 'cs.current_status', priority: "CASE cs.priority_flag WHEN 'urgent' THEN 3 WHEN 'high' THEN 2 WHEN 'normal' THEN 1 ELSE 0 END", priority_ext: "CASE ch.summary_json->>'priority_external' WHEN 'urgent' THEN 3 WHEN 'high' THEN 2 WHEN 'normal' THEN 1 ELSE 0 END" }[req.query.sort] || 'ch.created_at'} ${String(req.query.dir || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC'}, ch.created_at DESC, ch.chit_id DESC
        LIMIT $${limIdx} OFFSET $${offIdx}`,
        [...params, limit, offset]
      );
      return { countResult: nestedCountResult, result: outcome, roles: await costView.rolesFor(db, entity_id, outcome.rows, blind) };
    });

    const next = afterOf(result.rows, limit, req);
    const total = countResult ? parseInt(countResult.rows[0].count) : null;
    const pageCap = PAGE_LIMIT.capOf(pg, result.rows.length, total);
    /* S34: a chit is sentRow (the statement above, in its order); capped and cap_note only when the pager cut the page */
    res.json({ chits: costView.listRows(result.rows, sentRow, { blind, shopId: entity_id, roles }), total, page, limit, next, capped: pageCap.capped, cap_note: pageCap.cap_note, cost_params_ignored: costView.ignoredField(ignored) });
  } catch (err) {
    console.error('Sent list error:', err.message);
    problem(req, res, failed(err, req, 'Failed to get sent items'));
  }
});

// GET /chits/folder?view=drafts|trash|archive — mailbox folders (both directions), paginated + searchable + sortable.
// Mounted BEFORE /:chit_id so "folder" is never parsed as a chit_id.
router.get('/folder', auth, ...checked('GET /folder'), async (req, res) => {
  try {
    const entity_id = entityId(req);
    /* always a page (the mailbox folders were never answered whole); LIM2: the one pager — before it ?limit=1000000 was obeyed here */
    const pg = listPage(req),
      { page, limit, offset } = pg;
    const view = req.query.view || 'drafts';
    const q_search = (req.query.q || '').trim(), blind = await cost.isCostBlind(req, entity_id), ignored = costView.moneyParams(req, blind); /* RAIL-146: ONE cost read per request; a blind reader's amount filter and sort are taken off and named back */

    const params = [entity_id];
    let where = `cs.entity_id = $1`;
    if (view === 'trash') where += ` AND cs.deleted_at IS NOT NULL`;
    else if (view === 'archive') where += ` AND cs.archived_at IS NOT NULL AND cs.deleted_at IS NULL`;
    else {
      where += ` AND ch.role = 'Draft' AND cs.deleted_at IS NULL`; // drafts
      // Drafts are personal WIP until sent: an actor sees ONLY the drafts they authored (mailing model).
      params.push(req.identity.identity_id);
      where += ` AND ch.created_by_actor_id = $${params.length}`;
    }
    if (q_search) {
      params.push('%' + q_search + '%');
      where += ` AND (ch.manual_subject ILIKE $${params.length} OR ch.auto_subject ILIKE $${params.length} OR ch.all_recipients::text ILIKE $${params.length} OR ch.purpose ILIKE $${params.length})`;
    }
    const joinFrom = `FROM chit_status cs
         JOIN chit_header ch ON ch.chit_id = cs.chit_id AND ch.entity_id = cs.entity_id AND ch.direction = cs.direction`;
    // dedupe self-chits (both copies in trash/archive) to one row per chit, preferring the sent copy
    where = chitFilters(req, where, params);
    // B1 RLS: caller reads only its own entity_id rows -> run inside withEntity(me).
    const { countResult, result, roles } = await withEntity(entity_id, async (db) => {
      const nestedCountResult = await db.query(`SELECT COUNT(DISTINCT ch.chit_id) ${joinFrom} WHERE ${where}`, params);

      const orderBy =
        ({
          date: 'created_at',
          subject: 'COALESCE(manual_subject, auto_subject)',
          amount: "(summary_json->>'total_value')::numeric",
          status: 'current_status',
          priority: "CASE priority_flag WHEN 'urgent' THEN 3 WHEN 'high' THEN 2 WHEN 'normal' THEN 1 ELSE 0 END",
          priority_ext: "CASE summary_json->>'priority_external' WHEN 'urgent' THEN 3 WHEN 'high' THEN 2 WHEN 'normal' THEN 1 ELSE 0 END"
        }[req.query.sort] || 'created_at') +
        ' ' +
        (String(req.query.dir || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC');
      const _cancelCol = await cancelCols(); // b195 — named only when it exists; see cancelCols()
      const outcome = await db.query(
        `SELECT * FROM (
         SELECT DISTINCT ON (ch.chit_id)
              ch.chit_id, ch.sender_entity_display_name, ch.sender_entity_bridge_id, ch.all_recipients,
              ch.purpose, ch.auto_subject, ch.manual_subject, ch.summary_json, ch.created_at,
              /* ⭐ ROLE, because the LIST is where a draft has to be recognisable. Without it the mailbox could
                 not tell a draft from a sent chit, so 🗑️ refused every draft with a reason that was false —
                 "the other party holds a matching copy" about a chit nobody had ever been sent. */
              ch.role,
              cs.current_status, cs.read_at, cs.star_flag, cs.priority_flag, cs.deleted_at, cs.archived_at, ch.direction${costView.sideColsSql('ch', blind)},
              ${_cancelCol}
              (SELECT COUNT(*) FROM chit_messages cm
                WHERE cm.chit_id = ch.chit_id AND cm.visibility_entity_id IS NULL) AS message_count
           ${joinFrom}
          WHERE ${where}
          ORDER BY ch.chit_id, (ch.direction = 'sent') DESC
       ) t
       ORDER BY ${orderBy}, created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      );
      return { countResult: nestedCountResult, result: outcome, roles: await costView.rolesFor(db, entity_id, outcome.rows, blind) };
    });
    /* ⚠️ `view` was echoed back and dropped by the envelope; the pager reads total/page/limit. It was the
       caller's own query param travelling in a circle. */
    const total = parseInt(countResult.rows[0].count);
    const pageCap = PAGE_LIMIT.capOf(pg, result.rows.length, total);
    /* S34: a chit is folderRow (the DISTINCT ON statement above, in its order); capped and cap_note only when the pager cut the page */
    res.json({ chits: costView.listRows(result.rows, folderRow, { blind, shopId: entity_id, roles }), total, page, limit, capped: pageCap.capped, cap_note: pageCap.cap_note, cost_params_ignored: costView.ignoredField(ignored) });
  } catch (err) {
    console.error('Folder error:', err.message);
    problem(req, res, failed(err, req, 'Failed to get folder'));
  }
});

/** REP-50: (key, currency) rows → one group per key, busiest first: { key, chits, total_value (null when it mixes currencies), by_currency[] } */
function rollupGroups(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const group = byKey.get(row.key) || { key: row.key, chits: 0, by_currency: [] };
    group.chits += row.chits;
    group.by_currency.push({ currency_code: row.currency_code || null, chits: row.chits, total_value: row.total_value });
    if (row.cost_hidden) group.cost_hidden = true; /* RAIL-146: a blind actor's stripped row marks the whole group */
    byKey.set(row.key, group);
  }
  return [...byKey.values()]
    .map((group) => Object.assign(group, { total_value: group.by_currency.length === 1 ? group.by_currency[0].total_value : null }))
    .sort((first, second) => second.chits - first.chits);
}

// GET /chits/rollup?group_by=counterparty|state — read-only grouped summary over MY chits.
// No merge, no new chit, the seal is untouched. Mounted BEFORE /:chit_id.
router.get('/rollup', auth, ...checked('GET /rollup'), async (req, res) => {
  try {
    const entity_id = entityId(req);
    const groupBy = req.query.group_by === 'state' ? 'state' : 'counterparty';
    const keyExpr = groupBy === 'state' ? 'cs.current_status' : 'ch.sender_entity_display_name', blind = await cost.isCostBlind(req, entity_id); /* RAIL-146: ONE cost read; a blind actor's sum leaves the cost-side chits out (lib/cost-view) */
    // direction scopes the rollup to Task (received) or Order (sent); omit for both. Without it, self-chits
    // (sent+received held by one entity) would double-count.
    const dir = req.query.direction === 'sent' || req.query.direction === 'received' ? req.query.direction : null;
    const params = [entity_id];
    let where = `cs.entity_id = $1 AND cs.deleted_at IS NULL AND cs.archived_at IS NULL`;
    if (dir) {
      params.push(dir);
      where += ` AND cs.direction = $${params.length}`;
    }
    /* ⭐ the track's counts leave out the bills its list leaves out (lib/folder-inventory inboxSql) — a tab that counted them
       would promise rows the list never shows. Both queries below join chit_header as ch. */
    if (dir) where += ` AND ${FOLDER_INV.inboxSql('ch', 'cs')}`;
    if (req.query.assignment === 'unassigned') where += ` AND cs.assigned_to_actor_id IS NULL`;
    else if (req.query.assignment === 'assigned') where += ` AND cs.assigned_to_actor_id IS NOT NULL`;
    else if (req.query.assigned_to === 'me') {
      params.push(req.identity.identity_id);
      where += ` AND cs.assigned_to_actor_id = $${params.length}`;
    }
    // B1 RLS: caller reads only its own entity_id rows -> run inside withEntity(me).
    const { result, disp, roles } = await withEntity(entity_id, async (db) => {
      /* REP-50 (SIT 2026-10-25): summed PER CURRENCY, never across. One SUM over every chit added an IN chit's rupees to an AU shop's
         dollars at face value. Each group carries by_currency [{ currency_code, chits, total_value }]; total_value stays for the old
         readers but only where the group holds one currency, and is null where it mixes (a sum across currencies is no number).
         RAIL-146 rides on the same rows: a blind actor's (key, currency) row is stripped by lib/cost-view first, then folded by key. */
      const perCur = await db.query(
        `SELECT ${keyExpr} AS key, NULLIF(ch.summary_json->>'currency_code', '') AS currency_code, COUNT(*)::int AS chits,
              COALESCE(SUM((ch.summary_json->>'total_value')::numeric), 0) AS total_value${costView.rollupMembersSql('ch', blind)}
         FROM chit_status cs
         JOIN chit_header ch ON ch.chit_id = cs.chit_id AND ch.entity_id = cs.entity_id AND ch.direction = cs.direction
        WHERE ${where}
        GROUP BY 1, 2`,
        params
      );
      const outcome = perCur;
      // D4: open-dispute count for the same scope — powers the "Disputes (n)" filter in the task menu.
      // Guarded so a pre-migration DB (no dispute tables) simply reports 0 rather than failing the rollup.
      const nestedDisp = await db
        .query(
          `SELECT COUNT(DISTINCT cs.chit_id)::int AS n
         FROM chit_status cs
         JOIN chit_header ch ON ch.chit_id = cs.chit_id AND ch.entity_id = cs.entity_id AND ch.direction = cs.direction
        WHERE ${where}
          AND EXISTS (SELECT 1 FROM chit_disputes cd WHERE cd.chit_id = cs.chit_id AND cd.status = 'open')`,
          params
        )
        .catch(() => ({ rows: [{ n: 0 }] }));
      return { result: outcome, disp: nestedDisp, roles: await costView.rollupRoles(db, entity_id, outcome.rows, blind) };
    });
    /* S34: a group is the three columns its statement selects; a blind actor's is lib/cost-view rollupGroup (the same three, cost_hidden when the sum left some out) */
    /* each (key, currency) row for its reader (lib/cost-view rollupGroups: the statement's columns, or a blind actor's stripped sum), then one group per key (REP-50 rollupGroups) */
    const perReader = costView.rollupGroups(result.rows, blind, entity_id, roles).map((row, index) => Object.assign({ currency_code: result.rows[index].currency_code }, row));
    res.json({ group_by: groupBy, direction: dir, groups: rollupGroups(perReader), dispute_open: disp.rows[0].n });
  } catch (err) {
    console.error('Rollup error:', err.message);
    problem(req, res, failed(err, req, 'Rollup failed'));
  }
});

/**
 * cancelCols() — the b195 cancel-request columns, named ONLY when they exist.
 *
 * ⚠️⚠️ A MISSING COLUMN IS NOT `undefined` IN SQL. It is 42703 and the WHOLE query throws — and on a chit-list
 * query that means an empty list for every user until the migration lands. Exactly the shape that took employee
 * sign-in down on 2026-08-20 (`access_level` named before b173 ran). So the rule this codebase settled on is:
 * ask lib/schema.js and shape the SELECT to the answer. A YES is cached forever; a NO expires in 60s, because
 * Athi runs migrations by hand against a RUNNING server.
 *
 * ⚠️⚠️ AND THERE ARE THREE CHIT-LIST SELECTS, NOT ONE. I added the columns to the first one I found, deployed,
 * and the flag still did not appear — because `/inbox` is served by a different query, and the row shape said so
 * the moment I read its keys instead of trusting the edit. Three copies of a fragment is three chances to fix
 * two of them, so the fragment lives here and all three call it.
 *
 * The trailing comma is INSIDE the fragment: an absent column then leaves the SELECT list untouched rather than
 * a dangling `,` in front of the next expression.
 */
async function cancelCols() {
  /**
   * ⚠️⚠️ TWO MIGRATIONS, TWO INDEPENDENT CHECKS. b195 added the REQUEST columns and b197 the CONFIRM ones, and
   * they are run by hand on separate days — so one may exist without the other in either direction. A single
   * check covering both would name three columns that are not there the moment the pair is half-applied, and a
   * missing column is 42703: the WHOLE query throws, which on a chit-list query is an empty list for everyone.
   *
   * ⚠️⚠️ AND b197's COLUMNS WERE WRITTEN AND NEVER READ. The migration ran, the API stamped
   * `cancel_confirmed_at`, and the value reached nobody — because this fragment still only named b195's. That is
   * the THIRD time in one session for the same shape: a count computed and whitelisted away, cancel columns
   * added to one of three list queries, and now a column written but never selected.
   *
   * ⭐ THE HABIT THAT CATCHES IT EVERY TIME is the one that caught it here: after adding a column, ask the live
   * endpoint for a row and look at its KEYS. Reading the write path proves the write; only reading the payload
   * proves the read.
   */
  const req = await schema.hasColumn('chit_status', 'cancel_requested_at');
  const conf = await schema.hasColumn('chit_status', 'cancel_confirmed_at');
  return (req ? 'cs.cancel_requested_at, cs.cancel_requested_by, cs.cancel_reason,' : '') + (conf ? 'cs.cancel_confirmed_at, cs.cancel_confirmed_by,' : '');
}

router.get('/inbox', auth, ...checked('GET /inbox'), async (req, res) => {
  try {
    // Actors query their parent entity's inbox (chit_status is entity-keyed)
    const entity_id = entityId(req);
    /* PERF1: a server-side maximum (lib/page-limit — `?limit=1000000` was obeyed) · keyset after page 1 (`after`, below) · the COUNT on page 1 only */
    const pg = listPage(req),
      page = pg.page,
      limit = pg.limit;
    const status_filter = req.query.status || null;
    const q_search = (req.query.q || '').trim(), blind = await cost.isCostBlind(req, entity_id), ignored = costView.moneyParams(req, blind); /* RAIL-146: ONE cost read per request; a blind reader's amount filter and sort are taken off and named back */

    let whereClause = `cs.entity_id = $1 AND cs.direction = 'received' AND cs.deleted_at IS NULL AND cs.archived_at IS NULL`;
    const params = [entity_id];
    let paramCount = 1;
    /**
     * ⚠️ A FOLDER IS THIS LIST WITH A FILTER — NOT A SECOND SCREEN. Athi, 2026-08-10: *"we don't need to create
     * different ux/UI panel for each panel, only task and order panel, we just pass the parameter as folder name
     * and filter data accordingly, so the same panel works for each folder."*
     *
     * Right, and it deletes code rather than adding it: the folder view was a bespoke list that would have drifted
     * from Task within a month — different columns, different row actions, its own bugs. One list, one filter.
     *
     * No folder asked for → hide FILED chits (they live in their folder, not loose in Task). A folder asked for →
     * show exactly that folder. Same query, one parameter apart.
     */
    if (await folderColReady()) {
      const fid = String(req.query.folder_id || '').trim();
      /**
       * ⚠️ AN ASSIGNMENT FILTER IS A QUESTION ABOUT WORK, NOT ABOUT FILING (fixed 2026-08-13).
       *
       * Athi: *"for the owner panel... the filter is not working correctly."* It was working — and useless.
       * Filing is a MOVE (the mailing model), so an unfiltered list shows only UNFILED chits. But Beta's rules
       * file almost everything on arrival, so the moment he assigned a chit it left the pool AND was already
       * out of the list — both tabs came back empty and the filter looked broken. Reproduced exactly: the chit
       * was assigned, was in ⚑ Needs attention, and appeared under assignment=assigned only WITHIN that folder.
       *
       * "Show me everything assigned" is a question about who is doing what, and who is doing what is not
       * confined to a folder. So when an assignment scope is asked for and NO folder is named, the unfiled-only
       * restriction is lifted and the answer spans every folder.
       *
       * ⚠️ NAMING A FOLDER STILL WINS. Inside a folder the list stays that folder filtered — the folder-as-a-
       * filter model is untouched. Only the top-level "Unassigned / Assigned / All Task" question goes wide.
       */
      const asksAssignment =
        req.query.assignment === 'unassigned' || req.query.assignment === 'assigned' || (req.query.assigned_to && req.query.assigned_to !== 'all');
      if (/^[0-9a-f-]{36}$/i.test(fid)) {
        paramCount++;
        whereClause += ` AND cs.folder_id = $${paramCount}::uuid`;
        params.push(fid);
      } else if (!asksAssignment) whereClause += ` AND cs.folder_id IS NULL`;
    }
    /**
     * ⭐⭐ BILLS ARE NOT TASKS (Athi, 2026-10-01: "the purpose of rail is for the order to be received and serviced, but this is
     * not a task"). A bill I received and my own counter bill leave this list for the Bills folders — ONE predicate, the one the
     * folders read (lib/folder-inventory inboxSql). ⚠️ A folder named explicitly still shows what the person filed into it: a
     * bill they moved there by hand is their own filing.
     */
    if (!/^[0-9a-f-]{36}$/i.test(String(req.query.folder_id || '').trim())) whereClause += ` AND ${FOLDER_INV.inboxSql('ch', 'cs')}`;

    if (status_filter) {
      paramCount++;
      whereClause += ` AND cs.current_status = $${paramCount}`;
      params.push(status_filter);
    }

    if (q_search) {
      paramCount++;
      whereClause += ` AND (ch.manual_subject ILIKE $${paramCount} OR ch.auto_subject ILIKE $${paramCount} OR ch.sender_entity_display_name ILIKE $${paramCount} OR ch.all_recipients::text ILIKE $${paramCount} OR ch.purpose ILIKE $${paramCount})`;
      params.push('%' + q_search + '%');
    }

    whereClause = chitFilters(req, whereClause, params);
    /* the count is of the same rows, before the keyset narrows them — and only on the first page (the pager keeps it: app.html pgNext) */
    const countWhere = whereClause,
      countParams = params.slice();
    const ks = keysetOf(req, params, 'ch');
    if (ks.where) whereClause += ks.where;
    const offset = ks.where ? 0 : (page - 1) * limit;
    paramCount = params.length;
    // B1 RLS: caller reads only its own entity_id rows -> run inside withEntity(me).
    const { countResult, result, roles } = await withEntity(entity_id, async (db) => {
      const nestedCountResult =
        page === 1 && !ks.where
          ? await db.query(
              `SELECT COUNT(*) FROM chit_status cs
        JOIN chit_header ch ON ch.chit_id = cs.chit_id AND ch.entity_id = cs.entity_id AND ch.direction = cs.direction
        WHERE ${countWhere}`,
              countParams
            )
          : null;

      // Get inbox — lightweight — no payload
      const _cancelCol = await cancelCols(); // b195 — see cancelCols(); three list selects, one fragment
      const outcome = await db.query(
        `SELECT
         ch.chit_id,
         ch.sender_entity_display_name,
         ch.sender_entity_bridge_id,
         ch.all_recipients,
         ch.purpose,
         ch.auto_subject,
         ch.manual_subject,
         ch.summary_json,
         ch.created_at,
         cs.current_status,
         cs.read_at,
         cs.star_flag,
         cs.priority_flag,
         ${_cancelCol}
         cs.assignment_type,
         cs.assigned_to_actor_id,
         cs.assigned_to_actor_display_name,
         (SELECT COUNT(*) FROM chit_disputes cd
          WHERE cd.chit_id = ch.chit_id AND cd.status = 'open') AS open_dispute_count,
         (SELECT COUNT(*) FROM chit_disputes cd
          WHERE cd.chit_id = ch.chit_id AND cd.status = 'resolved') AS resolved_dispute_count,
         (SELECT COUNT(*) FROM chit_messages cm
          WHERE cm.chit_id = ch.chit_id AND cm.visibility_entity_id IS NULL) AS message_count,
         (SELECT MAX(cm2.created_at) FROM chit_messages cm2
          WHERE cm2.chit_id = ch.chit_id AND cm2.visibility_entity_id IS NULL) AS last_message_at,
         (SELECT sl.action_by_display_name FROM state_log sl
          WHERE sl.chit_id = ch.chit_id AND sl.entity_id = ch.entity_id AND sl.action = 'created'
          ORDER BY sl.created_at ASC LIMIT 1) AS placed_by_name,
         (SELECT i.identity_type FROM state_log sl
          LEFT JOIN identities i ON i.identity_id = sl.action_by_identity_id
          WHERE sl.chit_id = ch.chit_id AND sl.entity_id = ch.entity_id AND sl.action = 'created'
          ORDER BY sl.created_at ASC LIMIT 1) AS placed_by_type,
         ${keyCol('ch')}${costView.sideColsSql('ch', blind)}
       FROM chit_status cs
       JOIN chit_header ch ON ch.chit_id = cs.chit_id
                          AND ch.entity_id = cs.entity_id
                          AND ch.direction = cs.direction
       WHERE ${whereClause}
       ORDER BY ${{ date: 'ch.created_at', subject: 'COALESCE(ch.manual_subject, ch.auto_subject)', from: 'ch.sender_entity_display_name', amount: "(ch.summary_json->>'total_value')::numeric", status: 'cs.current_status', priority: "CASE cs.priority_flag WHEN 'urgent' THEN 3 WHEN 'high' THEN 2 WHEN 'normal' THEN 1 ELSE 0 END", priority_ext: "CASE ch.summary_json->>'priority_external' WHEN 'urgent' THEN 3 WHEN 'high' THEN 2 WHEN 'normal' THEN 1 ELSE 0 END" }[req.query.sort] || 'ch.created_at'} ${String(req.query.dir || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC'}, ch.created_at DESC, ch.chit_id DESC
       LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`,
        [...params, limit, offset]
      );
      return { countResult: nestedCountResult, result: outcome, roles: await costView.rolesFor(db, entity_id, outcome.rows, blind) };
    });

    const inboxNext = afterOf(result.rows, limit, req);
    const total = countResult ? parseInt(countResult.rows[0].count) : null; /* PERF1: counted on page 1; later pages say null and the pager keeps page 1's */
    const pageCap = PAGE_LIMIT.capOf(pg, result.rows.length, total); /* W2-RAIL R2: a cut page says so — `capped` + `cap_note` (absent otherwise) */
    /* S34: a chit is inboxRow (the statement above, in its order). Top-level total/page/limit mirror /sent so the web pager treats both lists the same; next is the ?after= of the next page (newest-first only; null on
       the last). ⚠️ the `pagination` object said the same three numbers a second time: two spellings of one fact is how they start disagreeing. */
    res.json({ chits: costView.listRows(result.rows, inboxRow, { blind, shopId: entity_id, roles }), total, page, limit, next: inboxNext, capped: pageCap.capped, cap_note: pageCap.cap_note, cost_params_ignored: costView.ignoredField(ignored) });
  } catch (err) {
    console.error('Inbox error:', err.message);
    problem(req, res, failed(err, req, 'Failed to get inbox'));
  }
});

// ─── GET /chits/:chit_id ──────────────────────────────────────
// Full chit detail — all participants, full state log, line items
// GET /chits/unread — chit_ids that are unread FOR THE CALLING ACTOR (per-actor read state).
// Unread = no chit_reads row yet, or the copy changed (cs.updated_at) after the actor last opened it.
// Entity (non-actor) logins get [] — they use the entity-level read_at. Mounted BEFORE /:chit_id.
/**
 * ⭐⭐ GET /pulse — "has anything changed?", so the 20-second refresh stops re-reading a list that has not moved.
 *
 * Athi, 2026-08-21: *"the screen keeps refreshing … can we change the model from reading the data to push data,
 * which avoids the read continuously?"* Push (SSE) is the eventual answer and costs a held connection per
 * signed-in tab. This is the stepping stone that gets most of the benefit for one cheap query: the client asks
 * for a WATERMARK, and only fetches the list when the watermark moves.
 *
 * ⚠⚠ THE WATERMARK MUST COVER EVERYTHING A LIST ROW DISPLAYS, or the screen goes quietly stale — which is
 * worse than the flashing it replaces. A row draws from FIVE tables (chit_header, chit_status, chit_disputes,
 * chit_messages, state_log), so three sources are read:
 *   · chit_header MAX(created_at)  — a chit arriving, on either copy
 *   · state_log   MAX(created_at)  — every logged action: advance, assign, dispute, message (27 write sites)
 *   · chit_status MAX(updated_at)  — a status change, which UPDATES in place and so moves no created_at
 *
 * ⚠️ AND A COUNT, because deletion LOWERS nothing. Trash a chit and every MAX above is unchanged; without the
 * count the list would keep showing a row that is gone.
 *
 * ⭐ ONE TRANSACTION, THREE SCALAR SUBQUERIES. All three MAX reads are index-only backward scans
 * — idx_chit_header_entity_created and idx_state_log_entity, both (entity_id, created_at), and
 * cs_entity_updated_idx (entity_id, updated_at DESC) added by b180 for exactly this query. Before b180 the
 * chit_status read scanned every one of that entity's rows, which was fine at a few hundred and not at fifty
 * thousand. ⚠️ That index is NOT free: `updated_at` changes on every write to this table, so it is maintained
 * on every status advance, assignment and read-receipt. The trade was made deliberately — one extra index
 * write per change against a full per-entity scan every 20 seconds per open tab. This runs every 20s
 * per signed-in tab, so it had to be the cheapest thing on the platform, not merely cheaper than the list.
 *
 * ⚠️ THE WATERMARK IS OPAQUE ON PURPOSE. The client compares it and never parses it, so its composition can
 * change — a sixth table, a different column — without touching the client or inventing a version negotiation.
 */
router.get('/pulse', auth, async (req, res) => {
  try {
    const me = auth.entityOf(req);
    const r = await withEntity(me, (db) =>
      db.query(
        `SELECT
         (SELECT MAX(created_at) FROM chit_header WHERE entity_id = $1) AS h,
         (SELECT MAX(created_at) FROM state_log   WHERE entity_id = $1) AS s,
         (SELECT MAX(updated_at) FROM chit_status WHERE entity_id = $1) AS c,
         (SELECT COUNT(*)        FROM chit_header WHERE entity_id = $1) AS n`,
        [me]
      )
    );
    const x = r.rows[0] || {};
    const list = ['h', 's', 'c'].map((item) => (x[item] ? new Date(x[item]).getTime() : 0)).join('.') + '.' + (x.n || 0);
    res.json({ w: list });
  } catch (e) {
    /**
     * ⚠️ A PULSE THAT FAILS MUST NOT SILENCE THE SCREEN. Answering an error would leave the client with no
     * watermark and, depending on how it reads that, either refreshing forever or never again. `null` is an
     * explicit "cannot tell" — the client falls back to refreshing, which is exactly today's behaviour.
     */
    console.error('pulse:', e.message);
    res.json({ w: null });
  }
});

router.get('/unread', auth, async (req, res) => {
  try {
    if (req.identity.identity_type !== 'actor') return res.json({ unread: [] });
    const entity_id = entityId(req);
    const actor_id = req.identity.identity_id;
    // B1 RLS: caller reads only its own entity_id rows -> run inside withEntity(me).
    const r = await withEntity(entity_id, (db) =>
      db.query(
        `SELECT DISTINCT cs.chit_id
         FROM chit_status cs
         LEFT JOIN chit_reads cr ON cr.chit_id = cs.chit_id AND cr.actor_id = $2
        WHERE cs.entity_id = $1 AND cs.deleted_at IS NULL
          AND (cr.read_at IS NULL OR cs.updated_at > cr.read_at)`,
        [entity_id, actor_id]
      )
    );
    res.json({ unread: r.rows.map((x) => x.chit_id) });
  } catch (err) {
    problem(req, res, failed(err, req, 'Unread failed'));
  }
});

/**
 * orderBilledSql(header) — WALK2 W36: the ONE_SHOT scalar that says whether a bill names this ORDER yet (open-orders' ONE billed test, the Tasks
 * list's Billed tag), so the sheet says "Not billed yet" instead of "Unpaid" (an order is a promise; it never posts). NULL when not an order.
 */
function orderBilledSql(header) {
  return header && header.purpose === 'order' ? require('../lib/open-orders').billedOfChitSql('$1', '$2') : 'NULL::boolean';
}
/** RAIL-106: the changes of mine on this chit the party on another installation has not confirmed yet (lib/ctpreturn unconfirmed) — null, and no query, when nothing is hosted elsewhere; null when the read fails (logged) */
const unconfirmedOf = (entity_id, chit_id) => ctpReturn.unconfirmed(entity_id, chit_id).catch(cbLog.orElse('chits GET /:chit_id: the read failed — answered with none', null));

/** S34: what `make` builds from a map that holds something, else undefined (the key then drops out of the answer) */
const whenFilled = (map, make) => (map && map.size ? make(map) : undefined);

router.get('/:chit_id', auth, ...checked('GET /:chit_id'), async (req, res) => {
  /* ⚠️ THE CLOCK STARTS AT THE TOP. It used to start after the main read, so ~2.8s of a 9s request sat in an
     'unaccounted' bucket — the largest single slice, invisible because the first mark measured nothing. */
  const _wantTiming = String(req.query.timing || '') === '1';
  const _T = {};
  let _t0 = Date.now();
  const _mark = (k) => {
    if (_wantTiming) {
      _T[k] = Date.now() - _t0;
      _t0 = Date.now();
    }
  };
  try {
    const chit_id = req.params.chit_id;
    // Actors use parent entity's id — chit_header and chit_status are entity-keyed
    const entity_id = entityId(req), blind = await cost.isCostBlind(req, entity_id); /* RAIL-146: ONE cost read; a blind actor's answer is reshaped LAST (lib/cost-view), the rows never */

    // B1 RLS: everything here is the caller's OWN copy -> withEntity(me).
    const data = await withEntity(entity_id, async (db) => {
      /**
       * ⭐ ONE READ OF chit_header, NOT TWO. This asked for `role, created_by_actor_id` and then, forty lines
       * later, asked the SAME TABLE for `*` with the SAME WHERE — two round trips for one row, ~270ms of them
       * on the Railway→Supabase hop. `*` already contains both columns, so the participation check reads the
       * header it was going to read anyway.
       *
       * ⚠️ The ORDER still matters and is preserved: participation and draft-privacy are decided before the
       * mark-read write below, so an actor who may not see a draft never marks it read.
       */
      const header = await db.query(
        `SELECT * FROM chit_header
         WHERE chit_id = $1 AND entity_id = $2`,
        [chit_id, entity_id]
      );
      const participation = header;
      if (participation.rows.length === 0) return { notFound: true };
      // Draft privacy: a draft is the author's PRIVATE WIP — another actor of the SAME entity must not read it,
      // even by direct id. The drafts LIST is author-scoped (created_by_actor_id); the detail read must be too.
      const _draft = participation.rows.find((item) => item.role === 'Draft');
      if (_draft && _draft.created_by_actor_id !== req.identity.identity_id) return { notFound: true };

      // Per-actor read: opening the chit marks it read for THIS actor (clears its unread flag).
      // Best-effort — never let read-tracking break the chit view (chit_reads is not RLS-scoped).
      if (req.identity.identity_type === 'actor') {
        // SAVEPOINT so a failure here (e.g. a missing table) can't poison the outer transaction and 500 the read.
        try {
          await db.query('SAVEPOINT mark_read');
          await db.query(
            `INSERT INTO chit_reads (chit_id, actor_id, read_at) VALUES ($1, $2, NOW())
             ON CONFLICT (chit_id, actor_id) DO UPDATE SET read_at = NOW()`,
            [chit_id, req.identity.identity_id]
          );
          await db.query('RELEASE SAVEPOINT mark_read');
        } catch (e) {
          console.error('mark-read skipped:', e.message);
          try {
            await db.query('ROLLBACK TO SAVEPOINT mark_read');
          } catch (rollbackError) {
            cbLog.fellBack('chits GET /:chit_id: the read failed — carried on without it', rollbackError);
          }
        }
      }

      // (the header was read above — the participation check and this are the same row)

      // Get my detail — line items if still present
      const detail = await db.query(
        `SELECT detail_type, line_item_count, total_value, currency_code,
                line_items, payload_delivered_at, payload_deleted_at
         FROM chit_detail
         WHERE chit_id = $1 AND entity_id = $2`,
        [chit_id, entity_id]
      );

      // Each participant has their own copy (entity_id = their entity).
      const nestedLog = await db.query(
        `SELECT action, action_by_identity_id, action_by_display_name, previous_status,
                new_status, detail, created_at
         FROM state_log
         WHERE chit_id = $1 AND entity_id = $2 AND action != 'read'
         ORDER BY created_at ASC`,
        [chit_id, entity_id]
      );

      /**
       * ⭐ THE OLD VALUE AND THE NEW ONE, IN ONE STATEMENT. This read `read_at` and then immediately
       * overwrote it — two round trips to learn one fact ("was this already read?") and set one column.
       *
       * ⚠️ THE CTE IS WHAT MAKES IT CORRECT, not a trick: every sub-statement of a data-modifying statement
       * sees the SAME SNAPSHOT, taken before the UPDATE, so `prev` returns the value as it was. Reading
       * `RETURNING read_at` instead would return NOW() and every chit would look like it had always been read
       * — the log entry for "first opened" would never be written again.
       *
       * ⚠️ No row at all still means unread: an entity with no `chit_status` row has never opened it, which is
       * exactly what the old `!preCheck.rows[0]?.read_at` said.
       */
      /**
       * ⭐ AND THE "FIRST OPENED" LOG ROW RIDES IN THE SAME STATEMENT. Three round trips became one: read the
       * old `read_at`, stamp the new one, and write the log line only if this was the first open.
       *
       * ⚠️ `upd` IS DELIBERATELY UNREFERENCED. A data-modifying CTE always executes whether or not anything
       * selects from it, so the stamp happens regardless — while making the INSERT depend on it would suppress
       * the log row for an entity that has no `chit_status` row yet, which the old code logged.
       *
       * ⚠️ `NOT EXISTS (… WHERE read_at IS NOT NULL)` is exactly the old `!preCheck.rows[0]?.read_at`: no row
       * at all, or a row never read, both count as unread. A plain `read_at IS NULL` would miss the first case.
       */
      await db.query(
        `WITH prev AS (SELECT read_at FROM chit_status WHERE chit_id = $1 AND entity_id = $2),
              upd  AS (UPDATE chit_status SET read_at = NOW()
                        WHERE chit_id = $1 AND entity_id = $2 RETURNING 1)
         INSERT INTO state_log
           (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail)
         SELECT $1, $2, 'read', $2, $3, 'Chit opened and read'
          WHERE NOT EXISTS (SELECT 1 FROM prev WHERE read_at IS NOT NULL)`,
        [chit_id, entity_id, req.identity.display_name]
      );

      /* (the "first opened" log row is written by the statement above, in the same round trip) */
      return { header, detail, log: nestedLog };
    });

    if (data.notFound) {
      return problem(req, res, { status: 404, ...said({ error: 'Not found', message: 'Chit not found or you do not have access' }, 'NOT_FOUND') });
    }

    // Participants panel = a deliberate CROSS-entity read (who has read/accepted). Under RLS it is served by the
    // b50 SECURITY DEFINER fn chit_participants (validates caller is a participant, then crosses). Fallback to the
    // direct join when the delivery layer (b50) isn't applied yet, so the page works before/after the migration;
    // under FORCE without the fn the fallback scopes to self (degraded panel, never a leak).
    /**
     * ── ⭐ SIX INDEPENDENT READS, ONE TRANSACTION (2026-08-14) ─────────────────────────────────────────────────
     *
     * Athi: opening a chit measured 2.8s and saving one line 5.4s. The cause was not a slow query — it was the
     * NUMBER of round trips. withEntity() wraps each call in its own transaction (BEGIN → set_config → query →
     * COMMIT = four round trips), and this handler made seven of them SEQUENTIALLY. None of the six below depends
     * on any other. ~28 round trips to open one chit.
     *
     * ⚠️ NOT Promise.all — the pool is max:10, so six parallel transactions per request means two concurrent
     * readers want twelve connections and the third queues. That trades a slow page for connection timeouts.
     * One BEGIN, one set_config, six queries, one COMMIT: ~11 round trips, and ONE connection instead of six.
     *
     * ⚠️ EVERY OPTIONAL READ IS SAVEPOINTED, and that is what makes this safe rather than clever. Postgres aborts
     * the whole transaction on any error, and these reads fail routinely and harmlessly on an un-migrated
     * environment — readLines throws 42P01 before b142, chit_participants throws 42883 before b50. Without a
     * savepoint the first such failure would poison every read after it, so a chit that used to open WITHOUT its
     * optional parts would stop opening at all. Each one still degrades exactly as it did before.
     */
    /**
     * ⚠️ SELF-MEASUREMENT, because two rounds of reasoning about this were wrong.
     *
     * Athi has said all week that screens are slow. I found withEntity's four-round-trips-per-call and fixed it,
     * predicting the chit open would halve. It moved ~10%. Measuring the endpoint directly then showed the truth:
     * GET /chits/:id takes ~9 SECONDS server-side on a one-line chit, while /health is 250ms and /products 1.3s
     * from the same machine. So the cost is inside this handler and I do not yet know which part.
     *
     * `?timing=1` returns a per-step breakdown instead of another guess. It costs one Date.now() per step and is
     * off unless asked for.
     */
    _mark('main_read');

    const _lines0 = data.detail.rows[0] && Array.isArray(data.detail.rows[0].line_items) ? mint.order(data.detail.rows[0].line_items) : null;
    _mark('mint_order');

    /**
     * ── ⭐ ONE STATEMENT FOR ALL FIVE ROW-SETS ─────────────────────────────────────────────────────────────────
     *
     * Measured on this deployment: every SQL statement costs ~250ms, because Railway (Singapore) and Supabase
     * (Mumbai) are in different regions. That single number explains everything — 4 statements ≈ 1s (/products),
     * 21 statements ≈ 5s (the previous six-read bundle with its savepoints). Transactions were never the unit that
     * mattered; STATEMENTS are.
     *
     * So: five scalar sub-selects, each returning a JSON array, in ONE round trip. 21 statements → 4.
     * The savepoints go with it — there is nothing left to isolate when there is only one statement, and they were
     * costing 12 of the 21.
     *
     * ⚠️ THE SHAPING STAYS IN THE LIBS. Only the FETCH moved. Each lib now accepts pre-fetched rows and applies
     * exactly the transformation it always did, so the fast path and the old path cannot drift.
     *
     * ⚠️ AND IT FALLS BACK WHOLE. If any table is missing (an un-migrated environment) this one statement fails
     * entirely rather than degrading read-by-read — so on failure we simply run the previous per-read path, which
     * still degrades individually. Fast where it can be, correct everywhere.
     */
    const ONE_SHOT = `
      SELECT
        (SELECT coalesce(json_agg(x), '[]'::json) FROM (SELECT * FROM chit_participants($2)) x)          AS participants,
        (SELECT coalesce(json_agg(x), '[]'::json) FROM (
           SELECT amendment_id, line_index, line_id, seq, line, reason_code, reason, actor_name, created_at
             FROM chit_line_amendment WHERE entity_id = $1 AND chit_id = $2 ORDER BY line_index, seq) x)  AS amendments,
        (SELECT coalesce(json_agg(x), '[]'::json) FROM (
           SELECT line_id, seq, particulars, quantity, unit, unit_size, price, comment,
                  asked_as, asked_unit, raw_phrase, removed, removed_reason, needs_human, flags
             FROM chit_line WHERE entity_id = $1 AND chit_id = $2 ORDER BY seq, line_id) x)               AS lines,
        (SELECT coalesce(json_agg(x), '[]'::json) FROM (
           -- ⚠️ THE COLUMN LIST HERE IS THE ONE THAT COUNTS. assign.current() has its own SELECT, but it is only
           -- the fallback — this CTE is what actually serves the chit screen, so adding a column to that query
           -- alone changes nothing and looks exactly like a deploy that has not landed. b153's state column was
           -- there first and spent a quarter of an hour being mistaken for a slow Railway build.
           SELECT line_id, seq, assignee_actor_id, assignee_name, assignee_type, task, due_date, note, created_at,
                  COALESCE(to_jsonb(chit_line_assignment)->>'state', 'open') AS state
             FROM chit_line_assignment WHERE entity_id = $1 AND chit_id = $2 ORDER BY line_id, seq) x)    AS assignments,
        (SELECT coalesce(json_agg(x), '[]'::json) FROM (
           SELECT l.line_id, l.particulars, l.unit AS ordered_unit, l.quantity AS ordered, l.removed,
                  d.delivery_id, d.quantity AS dq, d.unit AS du, d.reference, d.note,
                  d.recorded_by_entity_id, d.recorded_by_name, d.recorded_by_actor_name, d.recorded_by_actor_id, d.delivered_at,
                  -- b152, read through to_jsonb so the columns may not exist yet: naming d.kind directly raises
                  -- 42703, which deliverline treats as "not migrated" and turns into a null progress — the whole
                  -- delivery display would vanish between deploying this and running b152.
                  to_jsonb(d)->>'kind'              AS dkind,
                  (to_jsonb(d)->>'amount')::numeric AS damount,
                  to_jsonb(d)->>'particulars'       AS dparticulars
             FROM chit_line l
             LEFT JOIN chit_line_delivery d
                    ON d.entity_id = l.entity_id AND d.chit_id = l.chit_id AND d.line_id = l.line_id
            WHERE l.entity_id = $1 AND l.chit_id = $2
            ORDER BY l.seq, l.line_id, d.delivered_at) x)                                                AS deliveries,
        -- ⭐ R01: the status of MY RECEIVED copy (null when I hold only the sent one) — the fact rail.actions steps on. A scalar
        -- in the same statement, so the actions answer costs no round trip. The same row PUT /status reads and moves.
        (SELECT cs.current_status FROM chit_status cs
          WHERE cs.chit_id = $2 AND cs.entity_id = $1 AND cs.direction = 'received' LIMIT 1)            AS my_received,
        -- ⭐ STD1: what the books wait on for THIS chit (books_outbox, b273: todo · name · why · candidates) — a scalar, no round trip;
        -- the bill's Accept verdict below is composed from it (the server's may/why), never from a list the page happens to hold.
        ${require('../lib/books-store').waitOfChitSql('$1', '$2')}                                        AS books_wait, ${orderBilledSql(data.header.rows[0])} AS order_billed`;

    let bundle = null;
    try {
      bundle = await withEntity(entity_id, async (db) => {
        const r = await db.query(ONE_SHOT, [entity_id, chit_id]);
        const g = r.rows[0] || {};
        return {
          participants: g.participants || [],
          amd: await amend.list(entity_id, chit_id, db, g.amendments || []),
          rows: _lines0 ? await amend.readLines(entity_id, chit_id, db, g.lines || []) : null,
          assigned: _lines0 ? await assign.current(entity_id, chit_id, db, g.assignments || []) : null,
          prog: _lines0 ? await deliverline.progress(entity_id, chit_id, db, g.deliveries || []) : null,
          my_received: g.my_received || null,
          books_wait: g.books_wait || null,
          order_billed: g.order_billed /* W36: orderBilledSql */, ...(await costView.bundleExtras(db, blind, entity_id, data.header.rows[0], g.deliveries)) /* RAIL-146: a blind actor's party role and the delivery rows (his own adds); {} for everyone else */,
          /**
           * ⭐ THE ATTACHMENT LIST RIDES ALONG — it cost a whole transaction of its own, measured at 1074ms,
           * for a four-column SELECT. See lib/storage.listForChit: it takes a `db` now precisely so a caller
           * already inside a transaction stops paying BEGIN + set_config + COMMIT to read a handful of rows.
           *
           * ⚠️⚠️ PROBE, DO NOT SAVEPOINT — and the first version of this got it wrong in a way only measuring
           * caught. A savepoint is not free: SAVEPOINT + RELEASE are two more round trips, ~270ms each on this
           * hop, so wrapping a ~270ms SELECT in one costs ~800ms and folding the read into this transaction
           * saved almost nothing. Measured: `attachments` went 1074ms → 0ms while `one_shot` went 1076 → 1872.
           *
           * ⭐ `schema.hasTable()` is CACHED, so it asks the database once per process and is free thereafter —
           * the same answer `/me` reached: probe what the database HAS, then name only that. A missing
           * `cb_attachment` (before b65/b66) now costs nothing at all rather than two round trips per open,
           * and still cannot poison the transaction, because the query is never issued.
           */
          attachments: (await schema.hasTable('cb_attachment')) ? await storage.listForChit(chit_id, entity_id, db) : null,
          _fast: true
        };
      });
    } catch (e) {
      console.error('chit detail: one-shot read failed, falling back per-read —', e.code || '', e.message);
      bundle = null;
    }
    _mark('one_shot');

    if (!bundle)
      bundle = await withEntity(entity_id, async (db) => {
        const nestedParticipants = await trySavepoint(db, (c) => c.query(`SELECT * FROM chit_participants($1)`, [chit_id]).then((reply) => reply.rows), null);
        /* The b50 fallback, still scoped to self under FORCE — a degraded panel, never a leak. */
        const participants2 =
          nestedParticipants ||
          (await trySavepoint(
            db,
            (c) =>
              c
                .query(
                  `SELECT cs.entity_id, cs.current_status, cs.read_at,
                cs.assigned_to_actor_display_name, cs.updated_at,
                i.display_name, i.bridge_id
           FROM chit_status cs
           JOIN identities i ON i.identity_id = cs.entity_id
          WHERE cs.chit_id = $1`,
                  [chit_id]
                )
                .then((reply) => reply.rows),
            []
          ));

        const nestedAmd = await trySavepoint(db, () => amend.list(entity_id, chit_id, db), { amendments: [], migrated: false });
        const rows = _lines0 ? await trySavepoint(db, () => amend.readLines(entity_id, chit_id, db), null) : null;
        const assigned = _lines0 ? await trySavepoint(db, () => assign.current(entity_id, chit_id, db), null) : null;
        const prog = _lines0 ? await trySavepoint(db, () => deliverline.progress(entity_id, chit_id, db), null) : null;

        /* R01 — my received copy's status, as the one-shot reads it (null = none, or not readable here) */
        const my_received = await trySavepoint(
          db,
          (c) =>
            c
              .query(`SELECT cs.current_status FROM chit_status cs WHERE cs.chit_id = $1 AND cs.entity_id = $2 AND cs.direction = 'received' LIMIT 1`, [
                chit_id,
                entity_id
              ])
              .then((reply) => (reply.rows[0] && reply.rows[0].current_status) || null),
          null
        );
        /* STD1 — the books' wait on this chit, as the one-shot reads it (null = none, or not readable here) */
        const books_wait = await trySavepoint(
          db,
          (c) =>
            c
              .query(`SELECT ${require('../lib/books-store').waitOfChitSql('$1', '$2')} AS w`, [entity_id, chit_id])
              .then((reply) => (reply.rows[0] && reply.rows[0].w) || null),
          null
        );
        return { participants: participants2, amd: nestedAmd, rows, assigned, prog, my_received, books_wait, ...(await costView.bundleExtras(db, blind, entity_id, data.header.rows[0], null)) };
      });

    _mark('bundle_6_reads');
    /* ⚠️ ATTACHMENTS STAY OUTSIDE. storage.listForChit reaches a different store and owns its own error handling;
       dragging it into this transaction would couple a blob read to the chit's own read for no round-trip saving. */
    /* ⭐ Already read inside the one-shot transaction when that path ran. Only the FALLBACK path — an
       environment where the one-shot statement failed — still pays for its own transaction here. */
    const attachments =
      bundle && bundle.attachments != null
        ? bundle.attachments
        : await storage.listForChit(chit_id, entity_id).catch(cbLog.orElse('chits GET /:chit_id: failed — answered with none', []));
    _mark('attachments'); // per-entity: the caller's OWN copies only

    /* ── b137 AMENDMENTS ─────────────────────────────────────────────────────────────────────────────────────
       ⚠️ `detail.line_items` IS RETURNED UNTOUCHED — it is what the reader produced and it never changes. The
       amendments ride ALONGSIDE it, and `amended_lines` is the two laid over each other so the screen can strike
       the old value and show the new one. Sending only the corrected version would be smaller and a lie: the
       whole point of an amendment is that both readings stay on the record.
       Deliberately AFTER the main read and outside its transaction — a chit must open whether or not b137 is
       applied, so list() answers `migrated:false` rather than throwing. */
    const amd = bundle.amd;
    /* ⚠️ SORTED BY THE STATED ORDER, not by array position. Lines minted before this carry no `seq`, so they sort
       as 0 and keep their existing sequence — the fix is additive and cannot reshuffle an old chit. */
    const _lines = _lines0;

    /* ⭐ b142 — the LIVE rows, when they exist. `readLines` returns null before the migration, and then the live
       set is replayed from the frozen payload instead. Same answer, two routes, so neither is a special case.
       ⚠️ The ORIGINAL still comes from `chit_detail.line_items` even when the rows exist — that is the delivered
       payload and it never changes, which is the only reason a struck-through "was 3" can be trusted. */
    const _rows = bundle.rows;
    const _assigned = bundle.assigned;
    let _prog = bundle.prog;
    /**
     * ⭐⭐ A BILL IS READ AS ITS HOLDER MAY SEE IT (lib/bill-privacy). The other shop keeps who it is on the participants panel,
     * never its status, read time or assignee; its goods-in claims are dropped from the delivery picture; its internal history
     * (status, goods-in — including rows fanned here before this rule) is hidden. The bill itself, its dispute, and the steps
     * the other shop's own folder made external stay. Not a bill → untouched.
     */
    let _red = { private: false, state_log: data.log.rows, participants: bundle.participants };
    try {
      const _h = data.header.rows[0];
      if (_h && billPrivacy.isBill(_h, entity_id)) {
        const mine = await billPrivacy.mineSet(
          entity_id,
          data.log.rows.map((item) => item.action_by_identity_id)
        );
        _red = billPrivacy.redactRead({ header: _h, me: entity_id, state_log: data.log.rows, participants: bundle.participants, mine });
        if (_lines0) {
          const dl = await withEntity(entity_id, (db) =>
            db.query(
              `SELECT l.line_id, l.particulars, l.unit AS ordered_unit, l.quantity AS ordered, l.removed,
                    d.delivery_id, d.quantity AS dq, d.unit AS du, d.reference, d.note, d.recorded_by_entity_id, d.recorded_by_name,
                    d.recorded_by_actor_name, d.recorded_by_actor_id, d.delivered_at, to_jsonb(d)->>'kind' AS dkind, (to_jsonb(d)->>'amount')::numeric AS damount,
                    to_jsonb(d)->>'particulars' AS dparticulars
               FROM chit_line l LEFT JOIN chit_line_delivery d ON d.entity_id = l.entity_id AND d.chit_id = l.chit_id AND d.line_id = l.line_id
              WHERE l.entity_id = $1 AND l.chit_id = $2 AND (d.delivery_id IS NULL OR d.recorded_by_entity_id = $1)
              ORDER BY l.seq, l.line_id, d.delivered_at`,
              [entity_id, chit_id]
            )
          ).catch(cbLog.orElse('chits GET /:chit_id: failed — answered with nothing', null));
          _prog = dl ? await deliverline.progress(entity_id, chit_id, null, dl.rows) : null;
        }
      }
    } catch (e) {
      console.error('bill read redaction:', e.message);
      _red = { private: true, state_log: [], participants: [] };
      _prog = null;
    }
    const _byId = new Map((_lines || []).map((item) => [item.line_id, item]));
    const _live = _rows
      ? _rows.map((row, i) => {
          const orig = _byId.get(row.line_id) || (_lines || [])[i] || row;
          const chain = (amd.amendments || []).filter((item) => item.line_id === row.line_id).sort((x, y) => x.seq - y.seq);
          return {
            index: i,
            line_id: row.line_id,
            live: row.removed ? null : row,
            original: orig,
            history: chain.length
              ? [orig].concat(
                  chain
                    .slice(0, -1)
                    .map((item) => item.line)
                    .filter(Boolean)
                )
              : [],
            removed: !!row.removed,
            reason_code: row.removed_reason || (chain.length ? chain[chain.length - 1].reason_code : undefined),
            versions: chain.length
          };
        })
      : amend.liveSet(_lines, amd.amendments);
    /**
     * ⭐⭐ THE PRICED FACTS RIDE THE LIVE LINE ([PAR-03], 2026-09-06). The live set is read from the line TABLE, which has columns for
     * particulars · quantity · unit · price · total and none for what the send wrote onto the line JSON — discount · offer · gst_rate ·
     * tax name · sku · item_id · hsn. The header knew ₹360 (total_value) while every row said ₹200 × 2 = ₹400 and no GST. Merged by
     * position while the two still line up one-to-one (the same rule the client already used for the stock stamp), and only where
     * the table row is silent — an amendment that changed a price keeps its own value.
     */
    try {
      const KEEP = ['discount', 'offer', 'gst_rate', 'cess_rate', 'tax_name', 'tax_scheme', 'tax_slab_name', 'tax_source', 'hsn', 'sku', 'item_id', 'code'];
      if (Array.isArray(_lines) && Array.isArray(_live) && _lines.length === _live.length) {
        _live.forEach((e, index) => {
          const j = _lines[index];
          if (!j || !e) return;
          [e.live, e.original].forEach((item) => {
            if (!item || typeof item !== 'object') return;
            KEEP.forEach((k) => {
              if ((item[k] === undefined || item[k] === null) && j[k] !== undefined && j[k] !== null) item[k] = j[k];
            });
          });
        });
      }
    } catch (e) {
      cbLog.fellBack('chits GET /:chit_id: failed — carried on without it', e);
    }
    _mark('assemble');
    const _doc = FOLDER_INV.docOf(data.header.rows[0], entity_id);
    res.json(costView.chitAnswer({ /* RAIL-146 LAST: a cost-blind co-assist reads a COPY of this answer with the cost gone, see lib/cost-view; the actions and docOf above read the real header */
      _timing: _wantTiming ? _T : undefined /* S34: only on ?timing=1 */,
      ...ctpReturn.markOf(await unconfirmedOf(entity_id, chit_id)), // RAIL-106: ctp_unconfirmed — a change of mine the party on another installation has not confirmed yet
      header: data.header.rows[0],
      detail: data.detail.rows[0] || null,
      participants: _red.participants,
      state_log: _red.state_log,
      bill_private: _red.private ? true : undefined,
      attachments,
      amendments: amd.amendments,
      /* ⚠️ THE UI GATES THE ✎ ON THIS. Without it the pen renders on every line before b138 is applied, and the
         only way to discover that is to tap it and get a 503 — an affordance that exists solely to fail. */
      amendments_migrated: amd.migrated !== false,
      /* ⭐⭐ R01 — MAY I DO X ON THIS COPY, answered by the rail engine (lib/rail.js) over the facts of MY copy: one verdict per
         action, { ok:true } or { ok:false, why } with why from the vocabulary of the engine. The writing routes ask the same
         engine before they write, so a ✓ here is never refused there. A host paints this; it never computes it. */
      actions: railActions.forBill(
        _doc,
        bundle.books_wait,
        railActions.actions(
          {
            held: true,
            received: bundle.my_received || null,
            sender: !!(data.header.rows[0] && String(data.header.rows[0].sender_entity_id) === String(entity_id))
          },
          railActions.meOf(req)
        )
      ),
      /* ⭐ STD1: WHAT DOCUMENT THIS COPY IS, said by the server (lib/folder-inventory docOf — the Bills folders' own classification), so the popup
         never guesses whether it holds a bill; and what the books wait on for it (books_wait: todo · name · why · candidates, or null) */
      doc: _doc,
      books_wait: bundle.books_wait || null,
      order_billed: bundle.order_billed /* W36: true · false on an order, null otherwise; absent on the fallback path */,
      /* ⭐ THE LIVE SET — one entry per ORIGINAL line, carrying what it is now and everything it has been.
         Removed lines are PRESENT with live:null: they must stay visible as evidence while counting nowhere.
         Sent whenever lines exist, amended or not, so the client has exactly one shape to render. */
      live_set: Array.isArray(_lines) ? _live : undefined,
      /* ⚠️ WHICH PATH ANSWERED, said out loud. Before b142 the live set is REPLAYED from the frozen payload plus
         the audit trail; after it, the live rows are read directly. Both give the same answer — which is exactly
         why a test can pass without touching the new table and look like it proved it. Naming the source is what
         makes that checkable instead of assumed. */
      lines_from: _rows ? 'chit_line' : 'payload',
      /* ⚠️ b143 — MY side only. This is a per-copy read under FORCE RLS, so a counterparty calling the same
         endpoint on their own copy gets their own (empty) map, never mine. Assignment is the private half. */
      line_assignment: whenFilled(_assigned, Object.fromEntries),
      /* ⚠️ b144 — SHARED, so this is present on BOTH copies. Each side sees its own claims and the other's,
         attributed; nothing is merged into one number. Totals are summed here, never stored. */
      line_delivery: whenFilled(_prog, Object.fromEntries), delivery_summary: whenFilled(_prog, deliverline.summarise)
    }, blind, data.header.rows[0], entity_id, bundle, req.identity.identity_id));
  } catch (err) {
    console.error('Chit detail error:', err.message);
    problem(req, res, failed(err, req, 'Failed to get chit'));
  }
});

// ═══ REPRICE — pull prices from the catalogue onto a chit that arrived without them ════════════════════════════
//
// Athi, 2026-08-13: *"if the price is not available, there must be a way to pick from the catalogue... either
// wholistically or for an individual item... whether price is already there or not, it really doesn't matter."*
//
// POST body: { line_ids?: [uuid], only_unpriced?: bool, preview?: bool }
// ⚠️ preview:true COMPUTES AND WRITES NOTHING. Pricing a whole chit in one tap is the useful version and also the
//    dangerous one, so the decision is made against a list rather than a promise.
// ⚠️ It writes AMENDMENTS, never a direct price. The old figure stays struck through — a chit is a record.
router.post('/:chit_id/reprice', auth, ...checked('POST /:chit_id/reprice'), async (req, res) => {
  try {
    const entity_id = entityId(req);
    const chit_id = req.params.chit_id;
    const held = await holdsCopy(entity_id, chit_id);
    /* ⭐ W2-RAIL R2 — THE RAIL QUESTION, the same one /amend asks: a reprice WRITES amendments (lib/reprice apply → amend.record),
       so it is the `amend` action — the level ladder (viewer · commenter refused in the engine's word), then "I hold a copy".
       Preview too: the answer GET /chits/:id gives for `amend` is the door's answer, preview or apply. */
    const verdict = railActions.can({ held }, railActions.meOf(req), 'amend');
    if (!verdict.ok) return problem(req, res, railSaid(railActions.ownCopyRefusalOf(verdict)));

    const ids = Array.isArray(req.body.line_ids) ? req.body.line_ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)) : null;
    const opts = await costWrite.repriceOpts(req, entity_id, chit_id, { line_ids: ids, only_unpriced: !!req.body.only_unpriced }); /* RAIL-147: a cost-blind co-assist is refused on a cost-side chit (preview too); the options of everyone else are as before */
    /* S34: lib/reprice preview answers the first five keys; apply() adds `applied` (how many amendments it wrote) */
    if (req.body.preview) {
      const previewed = await reprice.plan(entity_id, chit_id, opts);
      return res.json({ has_catalogue: previewed.has_catalogue, will_price: previewed.will_price, needs_price: previewed.needs_price, unchanged: previewed.unchanged, totals: previewed.totals });
    }
    const priced = await reprice.apply(entity_id, chit_id, opts, {
      actor_id: req.identity.identity_id,
      actor_name: req.identity.display_name
    });
    res.json({ has_catalogue: priced.has_catalogue, will_price: priced.will_price, needs_price: priced.needs_price, unchanged: priced.unchanged, totals: priced.totals, applied: priced.applied });
  } catch (err) {
    cbLog.error('chits/reprice failed', { id: req.id, chit_id: req.params.chit_id, err: err.message });
    problem(req, res, faultOf(err, req, 'Reprice failed', { words: true })); /* API-6 (SIT 25 Oct): the library's own 400 reaches the person */
  }
});

// ═══ b145 · COST — private to the entity, and gated WITHIN it ══════════════════════════════════════════════════
//
// Athi, 2026-08-12: "money cannot be seen by everyone, the cost accumulates here, not the difference" →
// WRITE-WITHOUT-READ. Anyone may record a cost; only the entity login or an actor with can_see_costs may read
// totals or margin. A worker always reads back their own rows — someone who cannot check what they typed will
// type it wrong, and blind entry is worse than none.
//
// POST body: { rows: [{ line_id?, kind, amount | (minutes + rate_per_hour), currency?, note }] }
// ⚠️ line_id omitted = a whole-chit cost (one auto fare for one trip). Splitting that across lines would invent
//    an allocation nobody agreed to.
router.post('/:chit_id/costs', auth, ...checked('POST /:chit_id/costs'), async (req, res) => {
  try {
    const entity_id = entityId(req);
    const chit_id = req.params.chit_id;
    const held = await holdsCopy(entity_id, chit_id);
    if (!held) return problem(req, res, { status: 404, ...said({ error: 'Not found', message: 'Chit not found or you do not have access' }, 'NOT_FOUND') });
    const recorded = await cost.record(entity_id, chit_id, req.body.rows || req.body, {
      actor_id: req.identity.identity_id,
      actor_name: req.identity.display_name
    });
    res.json({ costs: recorded.costs });
  } catch (err) {
    cbLog.error('chits/costs record failed', { id: req.id, chit_id: req.params.chit_id, err: err.message });
    problem(req, res, faultOf(err, req, 'Failed to record cost', { words: true })); /* API-6 (SIT 25 Oct): the library's own 400 reaches the person */
  }
});

// GET — everything if permitted; otherwise ONLY the caller's own rows and no totals at all.
router.get('/:chit_id/costs', auth, ...checked('GET /:chit_id/costs'), async (req, res) => {
  try {
    const entity_id = entityId(req);
    const permitted = await cost.canRead(req, entity_id);
    const out = await cost.read(entity_id, req.params.chit_id, { permitted, actor_id: req.identity.identity_id });
    if (out === null) return problem(req, res, { status: 503, ...said({ error: 'Not migrated', message: 'Cost is not migrated on this environment (b145).' }, 'CHIT_NOT_MIGRATED') });
    /* S34: the owner's answer holds the totals; a worker's holds only the rows (mine_only), and mixed_currency appears only when two currencies were summed */
    res.json({ costs: out.costs, mine_only: out.mine_only, can_see_totals: out.can_see_totals, by_kind: out.by_kind, by_currency: out.by_currency, invoiced: out.invoiced, currency: out.currency, spent: out.spent, margin: out.margin, margin_pct: out.margin_pct, mixed_currency: out.mixed_currency });
  } catch (err) {
    cbLog.error('chits/costs read failed', { id: req.id, chit_id: req.params.chit_id, err: err.message });
    problem(req, res, failed(err, req, 'Failed to read costs'));
  }
});

// ═══ b182 · THE REGISTER ON A LINE — risks, assumptions, issues, dependencies, actions, decisions ══════════════
//
// Design: C:\dev\DESIGN-raida-and-cover.md. Phase 0 records facts and nothing else — no owner, no due date, no
// derivation. State is COMPUTED (open = nothing closes it), so there is no status field to drift.
//
// ⚠️ THE SAME OWNERSHIP CHECK AS COSTS, FOR THE SAME REASON. Without it an id in the URL is enough to file an
// entry against a stranger's chit — RLS makes the row harmless but it is still a record nobody asked for, sitting
// under a chit_id its author never held.
// ═══ b185 · THE REGISTER AS A CAPABILITY — subjects, the gate, acceptance, the library, the walk ════════════════
//
// ⚠️ ALL DECLARED BEFORE /:chit_id/raida. Express matches in order and 'register' is a perfectly good :chit_id;
// the other way round, every one of these would be read as a request for the register of a chit by that name and
// answer EMPTY rather than 404 — a silent wrong answer, which is the worse failure.

/** What a register may be attached to. A registry, so a new kind is data. */
router.get('/register/attachables', auth, async (req, res) => {
  try {
    const found = await raida.attachables();
    /* S34: an attachable is the three columns lib/raida selects (register_attachable); degraded names why the list is empty (absent · no-grant · rls-no-policy · empty), else null */
    res.json({ attachables: found.attachables.map((x) => ({ type_key: x.type_key, label: x.label, points_at: x.points_at })), degraded: found.degraded });
  } catch (err) {
    problem(req, res, failed(err, req, 'Failed'));
  }
});

router.get('/register/subjects', auth, ...checked('GET /register/subjects'), async (req, res) => {
  try {
    const found = await raida.listSubjects(entityId(req), {
      type_key: req.query.type_key || undefined,
      open_only: req.query.open === '1'
    });
    /* S34: a register is the columns lib/raida listSubjects selects (register_subject, open_count a COUNT: text) */
    // prettier-ignore
    res.json({ subjects: found.subjects.map((x) => ({ subject_id: x.subject_id, type_key: x.type_key, ref_id: x.ref_id, ref_label: x.ref_label, name: x.name, opened_at: x.opened_at, closed_at: x.closed_at, closed_by_name: x.closed_by_name, open_count: x.open_count })), migrated: found.migrated });
  } catch (err) {
    problem(req, res, failed(err, req, 'Failed to list registers'));
  }
});

router.post('/register/subjects', auth, ...checked('POST /register/subjects'), async (req, res) => {
  try {
    const subject = await raida.subjectFor(entityId(req), {
      type_key: req.body.type_key,
      ref_id: req.body.ref_id,
      ref_label: req.body.ref_label,
      name: req.body.name
    });
    res.json({ subject_id: subject.subject_id, closed_at: subject.closed_at });
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Failed to open the register', { words: true }));
  }
});

/**
 * ⭐⭐ THE GATE. A register may not close while any entry is undispositioned — and the refusal is a 409 that
 * NAMES what is outstanding, because "4 still open" without the four sends someone hunting.
 */
router.post('/register/subjects/:subject_id/close', auth, ...checked('POST /register/subjects/:subject_id/close'), async (req, res) => {
  try {
    const closed = await raida.closeSubject(entityId(req), req.params.subject_id, { by_name: req.identity.display_name });
    res.json({ closed: closed.closed, at: closed.at, migrated: closed.migrated });
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Cannot close yet', { words: true, extra: err.outstanding ? { outstanding: err.outstanding } : undefined }));
  }
});

/** The library — the same risk turns up everywhere, worded slightly differently. */
router.get('/register/templates', auth, async (req, res) => {
  try {
    const found = await raida.templates(entityId(req));
    /* S34: a template is the columns lib/raida templates selects (register_template; raised and closed are COUNTs: text; standards an array_agg, NULL when none) */
    // prettier-ignore
    res.json({ templates: found.templates.map((x) => ({ template_id: x.template_id, kind: x.kind, title: x.title, body: x.body, likelihood: x.likelihood, severity: x.severity, treatment: x.treatment, verification_method: x.verification_method, applies_to: x.applies_to, raised: x.raised, closed: x.closed, standards: x.standards })), migrated: found.migrated });
  } catch (err) {
    problem(req, res, failed(err, req, 'Failed to read the library'));
  }
});

router.post('/register/templates', auth, ...checked('POST /register/templates'), async (req, res) => {
  try {
    const added = await raida.addTemplate(entityId(req), req.body || {});
    res.json({ template_id: added.template_id, migrated: added.migrated });
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Failed to save it', { words: true }));
  }
});

/**
 * ⭐⭐ THE WALK — what this breaks, or (backwards=1) what broke it. Backwards is the one people need, because it
 * is the question asked after something has already gone wrong.
 */
/**
 * ⭐⭐ AN ENTRY ON A STANDALONE REGISTER — one attached to a campaign, an audit, a release, and not to any
 * order. `add()` already took a subject_id; there was simply no way in from outside, so a register opened
 * against anything other than a chit could be created and then never written to.
 *
 * ⚠️ chit_id is NULL here, which b185 made legal by dropping the NOT NULL. That is the whole point of the
 * subject: the register is attached to the THING, and an order is only one kind of thing.
 */
router.post('/register/subjects/:subject_id/entries', auth, ...checked('POST /register/subjects/:subject_id/entries'), async (req, res) => {
  try {
    const made = await raida.add(
      entityId(req),
      null,
      Object.assign({}, req.body, {
        subject_id: req.params.subject_id,
        by_name: req.identity.display_name
      })
    );
    /* S34: an entry as lib/raida add() answers it; subject_id and standards only on a b185 register */
    res.json({ raida_id: made.raida_id, at: made.at, kind: made.kind, subject_id: made.subject_id, standards: made.standards, migrated: made.migrated, full: made.full });
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Failed to record it', { words: true }));
  }
});

/**
 * Close an entry BY ID, wherever it lives.
 * ⚠️ The existing close hangs off /:chit_id/raida, so an entry on a standalone register had no way to end —
 * and an entry that cannot be ended is what makes the closure gate unpassable. close() locates the row by
 * raida_id and reads chit_id back off it, so null here is correct rather than a shortcut.
 */
router.post('/register/entries/:raida_id/close', auth, ...checked('POST /register/entries/:raida_id/close'), async (req, res) => {
  try {
    const ended = await raida.close(entityId(req), null, req.params.raida_id, Object.assign({}, req.body, { by_name: req.identity.display_name }));
    /* S34: an ending as lib/raida close() answers it; disposition only on a b185 register */
    res.json({ closed: ended.closed, closing_row: ended.closing_row, disposition: ended.disposition, at: ended.at, migrated: ended.migrated });
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Failed to close it', { words: true }));
  }
});

router.get('/register/walk/:from', auth, ...checked('GET /register/walk/:from'), async (req, res) => {
  try {
    const walked = await raida.walk(entityId(req), req.params.from, { backwards: req.query.backwards === '1', depth: req.query.depth });
    /* S34: lib/impact walk() answers hops · depth_reached · truncated · backwards; a register not on this environment answers hops [] and migrated false */
    res.json({ hops: walked.hops, depth_reached: walked.depth_reached, truncated: walked.truncated, backwards: walked.backwards, migrated: walked.migrated });
  } catch (err) {
    problem(req, res, failed(err, req, 'Failed to walk it'));
  }
});

/** Revise a field without destroying what it said before — an appended row, never an UPDATE. */
router.post('/register/entries/:raida_id/revise', auth, ...checked('POST /register/entries/:raida_id/revise'), async (req, res) => {
  try {
    const revised = await raida.revise(entityId(req), req.params.raida_id, Object.assign({}, req.body, { by_name: req.identity.display_name }));
    res.json({ revised: revised.revised, revision: revised.revision, changed: revised.changed, migrated: revised.migrated });
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Failed to revise it', { words: true }));
  }
});

/** ⭐⭐ Accept a residual risk. A signature, at a level the severity demands, with a date it comes back. */
router.post('/register/entries/:raida_id/accept', auth, ...checked('POST /register/entries/:raida_id/accept'), async (req, res) => {
  try {
    const accepted = await raida.accept(entityId(req), req.params.raida_id, {
      accepted_by_name: req.body.accepted_by_name || req.identity.display_name,
      authority_level: req.body.authority_level,
      rationale: req.body.rationale,
      review_by: req.body.review_by
    });
    res.json({ acceptance_id: accepted.acceptance_id, at: accepted.at, entry_severity: accepted.entry_severity, migrated: accepted.migrated });
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Failed to record the acceptance', { words: true }));
  }
});

/**
 * ⭐⭐ THE ROLL-UP — every entry this entity holds, across every chit. Athi, 2026-08-30: *"where will it reflect
 * as a wholesum across all the chit … so we can see all the open and closed stuff in a single place."*
 *
 * ⚠️ DECLARED BEFORE /:chit_id/raida ON PURPOSE. Express matches in order, and 'report' is a perfectly good
 * :chit_id — put this second and every call to it would be read as a request for the register of a chit named
 * 'report', which exists for nobody and answers empty. A silent empty answer, not a 404.
 */
router.get('/raida/report', auth, ...checked('GET /raida/report'), async (req, res) => {
  try {
    /* ⭐⭐ FILTERABLE BY STANDARD — the whole point of the mapping. ISO 9001 and ISO 27001 become two READINGS
       of one set of facts instead of two registers a company keeps rewriting to survive two audits. */
    const report = await raida.report(entityId(req), {
      subject_id: req.query.subject_id || undefined,
      standard_key: req.query.standard || undefined
    });
    /* S34: every key lib/raida report answers (all but entries and migrated only once the register is migrated); an entry and a kind count are the library's
       own literals and by_disposition is keyed by the dispositions found, so those stay open and listed */
    // prettier-ignore
    res.json({ entries: report.entries, by_kind: report.by_kind, by_disposition: report.by_disposition, migrated: report.migrated, full: report.full, resp: report.resp, open: report.open, closed: report.closed, closed_by_order: report.closed_by_order });
  } catch (err) {
    console.error('Raida report error:', err.message);
    problem(req, res, faultOf(err, req, 'Failed to read the register', { words: true }));
  }
});

router.get('/:chit_id/raida', auth, ...checked('GET /:chit_id/raida'), async (req, res) => {
  try {
    const entity_id = entityId(req);
    /* line_id absent = the whole chit; a uuid = that line PLUS the order-level entries it inherits. */
    const line_id = req.query.line_id ? String(req.query.line_id) : undefined;
    const listed = await raida.list(entity_id, req.params.chit_id, line_id);
    /* S34: entries · open · closed come from the fold (absent when the register is not on this environment: migrated false); full says which column set was read */
    res.json({ entries: listed.entries, open: listed.open, closed: listed.closed, migrated: listed.migrated, full: listed.full });
  } catch (err) {
    console.error('Raida read error:', err.message);
    problem(req, res, faultOf(err, req, 'Failed to read the register', { words: true }));
  }
});

router.post('/:chit_id/raida', auth, ...checked('POST /:chit_id/raida'), async (req, res) => {
  try {
    const entity_id = entityId(req);
    const chit_id = req.params.chit_id;
    /* ⭐ ONE TRANSACTION. The ownership check and the insert share it — a second withEntity would pay
       BEGIN + set_config + COMMIT again to learn what this one already knows. */
    const out = await withEntity(entity_id, async (db) => {
      const mine = await db.query(`SELECT 1 FROM chit_header WHERE chit_id = $1 AND entity_id = $2`, [chit_id, entity_id]);
      if (!mine.rows.length) {
        const e = new Error('Chit not found or you do not have access');
        e.status = 404;
        throw e;
      }
      /**
       * ⚠️⚠️ THE WHOLE ENTRY, NOT FOUR FIELDS. This forwarded kind · body · line_id · visibility and nothing
       * else, so a risk raised from a line card could never carry a rating, an owner, a treatment or a
       * response — it arrived in the register with every column that makes a register useful left empty, and
       * the only way to fill them was to raise it again somewhere else.
       *
       * ⚠️ A WHITELIST, NOT A SPREAD. `subject_id`, `chit_id` and `entity_id` are decided HERE, by the route
       * that just proved ownership; letting the body carry them would let a caller file a finding against
       * somebody else's order.
       */
      return raida.add(entity_id, chit_id, {
        kind: req.body.kind,
        body: req.body.body,
        line_id: req.body.line_id,
        visibility: req.body.visibility,
        owner_name: req.body.owner_name,
        due_date: req.body.due_date,
        review_date: req.body.review_date,
        likelihood: req.body.likelihood,
        severity: req.body.severity,
        treatment: req.body.treatment,
        verification_method: req.body.verification_method,
        response: req.body.response,
        template_id: req.body.template_id,
        rel_type: req.body.rel_type,
        to_type: req.body.to_type,
        to_id: req.body.to_id,
        to_label: req.body.to_label,
        needed_by: req.body.needed_by,
        by_name: req.identity.display_name,
        db
      });
    });
    res.json({ raida_id: out.raida_id, at: out.at, kind: out.kind, subject_id: out.subject_id, standards: out.standards, migrated: out.migrated, full: out.full });
  } catch (err) {
    console.error('Raida add error:', err.message);
    problem(req, res, faultOf(err, req, 'Failed to record it', { words: true }));
  }
});

/* ⭐ CLOSING IS A POST, NOT A DELETE OR A PATCH, and the verb is the design. A close APPENDS the row that
   closes — it carries who ended it and why, because "we booked the slot" and "the customer withdrew it" are
   different endings and a flag cannot tell them apart. */
router.post('/:chit_id/raida/:raida_id/close', auth, ...checked('POST /:chit_id/raida/:raida_id/close'), async (req, res) => {
  try {
    /* RAIL-93: the ending's disposition (and where a carried-forward one goes, and its evidence) reach raida.close — without
       them every close of a full register answered 400 "An ending needs a disposition" (cap-worklist sends { body, disposition }) */
    const { body, disposition, carried_to_subject_id, evidence_ref, evidence_hash } = req.body || {};
    const ended = await raida.close(entityId(req), req.params.chit_id, req.params.raida_id,
      { body, disposition, carried_to_subject_id, evidence_ref, evidence_hash, by_name: req.identity.display_name });
    res.json({ closed: ended.closed, closing_row: ended.closing_row, disposition: ended.disposition, at: ended.at, migrated: ended.migrated });
  } catch (err) {
    console.error('Raida close error:', err.message);
    problem(req, res, faultOf(err, req, 'Failed to close it', { words: true }));
  }
});

/**
 * ⭐⭐ RAISING THE DISPUTE IS NOT DONE HERE — Athi, 2026-08-30: *"if they want to link it as dispute there
 * should be a facility to raise it as a dispute, just call the dispute here."* The caller raises it the ONE way
 * disputes are raised, then posts the id back so the register can say it was escalated. Reimplementing any part
 * of that lifecycle here would be a second answer to a question that already has one.
 */
router.post('/:chit_id/raida/:raida_id/dispute', auth, ...checked('POST /:chit_id/raida/:raida_id/dispute'), async (req, res) => {
  try {
    const linked = await raida.linkDispute(entityId(req), req.params.chit_id, req.params.raida_id, req.body.dispute_id);
    res.json({ raida_id: linked.raida_id, dispute_id: linked.dispute_id, migrated: linked.migrated });
  } catch (err) {
    console.error('Raida dispute link error:', err.message);
    problem(req, res, faultOf(err, req, 'Failed to link the dispute', { words: true }));
  }
});
// ═══ b144 · PER-LINE DELIVERY — the SHARED half ════════════════════════════════════════════════════════════════
//
// POST body: { rows: [{ line_id, quantity, unit, reference, note }] }
// ⚠️ quantity may be NEGATIVE — that is a correcting entry, which is how a delivery is undone. Rows are never
//    edited or deleted, so what was claimed on the day stays legible after someone changes their mind.
// ⚠️ It writes into EVERY participant's copy via a gated SECURITY DEFINER fn. That is what shared means.
/**
 * ⭐⭐ WHAT A BILL I RECEIVED IS FOR — resale · use · asset (Athi, 2026-10-01; lib/bill-use). The buyer's own fact, on their
 * own copy, before they accept it: GET answers what each line will post as (their choice, else their catalogue); PUT
 * { use?, lines? } records a choice — merged, and refused (409) once the bill is accepted. Goods-in may carry the same
 * `use` on deliver-lines.
 */
router.get('/:chit_id/use', auth, ...checked('GET /:chit_id/use'), async (req, res) => {
  try {
    const entity_id = entityId(req);
    const copy = await taxCopy.copyOf(req.params.chit_id, entity_id);
    if (!copy) return problem(req, res, { status: 404, ...said({ error: 'Not found', message: 'Chit not found' }, 'NOT_FOUND') });
    if (!taxCopy.billReceived(copy, entity_id))
      return problem(req, res, { status: 409, ...said({ error: 'Not a bill', message: 'Only a bill you received says what its goods are for' }, 'CHIT_NOT_A_BILL') });
    const eff = await require('../lib/bill-use').forCopy(entity_id, copy);
    /* S34: bill · lines · uses are always there; asset_class and put_to_use only when the buyer chose them (lib/bill-use effective) */
    res.json({
      chit_id: req.params.chit_id,
      status: copy.current_status,
      changeable: railActions.BUCKETS.open.includes(String(copy.current_status || '')),
      bill: eff.bill,
      lines: eff.lines,
      uses: eff.uses,
      asset_class: eff.asset_class,
      put_to_use: eff.put_to_use
    });
  } catch (err) {
    problem(req, res, failed(err, req, 'Failed'));
  }
});
router.put('/:chit_id/use', auth, ...checked('PUT /:chit_id/use'), async (req, res) => {
  try {
    const r = await require('../lib/bill-use').set(entityId(req), req.params.chit_id, req.body || {}, { name: req.identity && req.identity.display_name });
    if (!r.ok) return problem(req, res, { status: r.status || 400, ...said({ error: 'Not saved', message: r.message }, codeOfStatus(r.status || 400)) });
    /* S34: lib/bill-use set() answers ok · use · effective, and party when a supplier was named */
    res.json({ ok: r.ok, use: r.use, effective: r.effective, party: r.party });
  } catch (err) {
    problem(req, res, failed(err, req, 'Failed'));
  }
});

router.post('/:chit_id/deliver-lines', auth, ...checked('POST /:chit_id/deliver-lines'), async (req, res) => {
  try {
    const chit_id = req.params.chit_id;
    const entity_id = entityId(req);
    /* ⭐ SEC4 — the server decides, not the page's grey: the level first (no read, nothing written for a viewer), then "I hold a copy",
       through the rail's words (lib/rail-actions canDeliver). A copy read that FAILS is logged and left to the delivery definer's own
       participant gate, as before — only a read that answers "no copy" refuses here (404, the answer an id in the URL always got). */
    const _me = railActions.meOf(req);
    const _lv = railActions.canDeliver({ held: true }, _me);
    if (!_lv.ok) return problem(req, res, railSaid(railActions.ownCopyRefusalOf(_lv)));
    let _mineCopy = null,
      _copyRead = true;
    try {
      _mineCopy = await taxCopy.copyOf(chit_id, entity_id);
    } catch (e) {
      _copyRead = false;
      log.warn('deliver.copy-unread', { chit_id, entity_id, err: e && e.message, then: 'the delivery definer checks the participant' });
    }
    if (_copyRead) {
      const _v = railActions.canDeliver({ held: !!_mineCopy }, _me);
      if (!_v.ok) return problem(req, res, railSaid(railActions.ownCopyRefusalOf(_v)));
    }
    const useSaid = await deliverUse(req, entity_id, chit_id);
    /* ⭐⭐ ON A BILL, GOODS-IN IS MY OWN STEP (lib/bill-privacy): recorded on my copy only, and its line is written at my bill
       folder's level — never replicated into, or announced to, the other shop */
    const _bill = !!(_mineCopy && billPrivacy.isBill(_mineCopy, entity_id));
    const out = await deliverline.record(entity_id, chit_id, req.body.rows || req.body, {
      actor_id: req.identity.identity_id,
      actor_name: req.identity.display_name,
      private: _bill
    });
    /* H6 — a replay of rows already recorded is answered with the first result and does not announce, advance or accept again */
    if (out.delivered.length && out.delivered.every((row) => row.replayed)) return res.json({ ok: out.ok, delivered: out.delivered, replayed: true });
    await deliverAnnounce(req, entity_id, chit_id, out, _mineCopy, _bill);
    await deliverProgress(entity_id, chit_id, out);
    await goodsInAccept(req, entity_id, chit_id, out);
    if (useSaid) out.use = useSaid.ok ? useSaid.use : { refused: useSaid.message };
    /* S34: delivered from the library (a stand-in library may add ok, kept first), then what each step wrote on it in its order: step · progress · summary · accepted · use */
    res.json({ ok: out.ok, delivered: out.delivered, step: out.step, progress: out.progress, summary: out.summary, accepted: out.accepted, use: out.use });
  } catch (err) {
    /* RAIL-133: a library's own 400 ('quantity must be a non-zero number') reaches the person; a fault still says the safe sentence, and faultOf logs it */
    problem(req, res, faultOf(err, req, 'Failed to record delivery', { words: true }));
  }
});

/* ═══ DELIVER-LINES' NAMED STEPS (T2-SPLIT, 2026-10-14) — the use · the announcement · the progress · the goods-in accept. ═══ */

/* ⭐ goods-in may say what the goods are for (the same field Intake sets) — recorded BEFORE the lines, so the tick below
     accepts with the answer in place; a bill already accepted refuses it, said, and the delivery still records */
async function deliverUse(req, entity_id, chit_id) {
  let useSaid = null;
  if (req.body && !Array.isArray(req.body) && (req.body.use !== undefined || req.body.use_lines !== undefined)) {
    useSaid = await require('../lib/bill-use')
      .set(entity_id, chit_id, { use: req.body.use, lines: req.body.use_lines }, { name: req.identity && req.identity.display_name })
      .catch((e) => ({ ok: false, message: String(e && e.message) }));
  }
  return useSaid;
}

/** after the lines are recorded: a bill's private step, or the delivery announced to every party */
async function deliverAnnounce(req, entity_id, chit_id, out, _mineCopy, _bill) {
  if (_bill) {
    try {
      out.step = await billPrivacy.writeStep(
        entity_id,
        chit_id,
        { code: billPrivacy.ownerCode(_mineCopy, entity_id), step: 'goods_checked', label: 'Goods checked', lines: out.delivered.length },
        { id: req.identity.identity_id, name: req.identity.display_name }
      );
    } catch (e) {
      cbLog.fellBack('chits deliver-lines: the goods-in bill step was not written — the delivery stands without it', e);
    }
  } else
    try {
      const d = out.delivered.map((x) => x.quantity).join(', ');
      /**
       * ⭐ THE NOTIFICATION FANS OUT TO EVERY PARTY, BECAUSE THE DELIVERY DOES.
       *
       * ⚠️ IT USED TO WRITE ONE ROW, INTO THE ACTING ENTITY'S COPY ONLY. So when the counterparty recorded a
       * delivery against your order, the DELIVERY crossed — b144's definer puts it in every copy — and the
       * NOTIFICATION did not. Found 2026-08-15 by checking b157 end to end: Karpagam recorded 5 kg, mytest's
       * badge stayed at zero and the event never appeared in the feed at all.
       *
       * That is the most important event this product has. Goods moved, and the other side was not told.
       *
       * ⚠️ DISTINCT entity_id — one row per PARTY, not per chit_status row. A self-chit holds two status rows for
       * one entity, and this is the fourth place today where a missing DISTINCT would have doubled something
       * (b150 wrote every delivery twice for exactly this reason).
       *
       * ⚠️ IT NEEDS A SECURITY DEFINER, AND MY FIRST ATTEMPT DID NOT USE ONE. I wrote the fan-out as a plain
       * INSERT … SELECT DISTINCT entity_id FROM chit_status inside withEntity(actor) and asserted a definer was
       * unnecessary. The test disproved it in minutes: that subquery runs under RLS, sees only the actor's own
       * chit_status row, and therefore wrote exactly the single row it had always written. It LOOKED like a
       * fan-out and behaved like the bug. b158 does it properly — the audience is computed inside the definer
       * from the chit's participants and is never a parameter.
       *
       * ⚠️ BEST-EFFORT, DELIBERATELY. It stays inside this try/catch: if the function is missing (pre-b158) or
       * RLS refuses, the delivery still stands. A notification that fails must never undo a movement of goods.
       */
      await withEntity(entity_id, (db) =>
        db.query('SELECT state_log_fanout($1::uuid,$2::text,$3::uuid,$4::text,$5::text) AS n', [
          chit_id,
          'delivered_line',
          req.identity.identity_id,
          req.identity.display_name,
          out.delivered.length + ' line(s) delivered: ' + d
        ])
      )
        /* Pre-b158 the function does not exist — fall back to the single-copy row rather than losing the event
         entirely. The counterparty is not notified until the migration runs, which is the status quo. */
        .catch(async (e) => {
          if (!(e && e.code === '42883')) throw e;
          return withEntity(entity_id, (db) =>
            db.query(
              `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail)
           VALUES ($1,$2,'delivered_line',$3,$4,$5)`,
              [chit_id, entity_id, req.identity.identity_id, req.identity.display_name, out.delivered.length + ' line(s) delivered: ' + d]
            )
          );
        });
    } catch (e) {
      cbLog.fellBack('chits deliver-lines: the history line was not written — the delivery stands without it', e);
    }
}

/**
 * ⭐⭐ HAND BACK THE NEW STATE SO THE SCREEN NEED NOT ASK FOR IT. Measured 2026-08-23: recording a
 * delivery cost ~3.5s, and the FULL CHIT RELOAD the UI ran straight afterwards cost ~4.9s — more than the
 * write it was confirming. `GET /chits/:id` is twelve round trips and the screen needed one fact from it.
 *
 * ⚠️ `progress()` opens one more transaction, so this is not free — it is four trips instead of twelve,
 * and it removes a whole request from the critical path. Additive: an older client that ignores the field
 * behaves exactly as before.
 */
async function deliverProgress(entity_id, chit_id, out) {
  try {
    const _map = await deliverline.progress(entity_id, chit_id);
    out.progress = Object.fromEntries(_map);
    /**
     * ⚠️⚠️ THE SUMMARY HAS TO COME BACK TOO, OR THE SCREEN CONTRADICTS ITSELF. Returning `progress` alone
     * let the client update every LINE from the response while the HEADER kept whatever the last full read
     * said — so both complaints on a job read "complete" under a header still saying *"0 of 2 lines
     * delivered"*. Caught by the design-2 driver, which reads the header and the lines in the same breath.
     *
     * ⭐ It is free: the same map, through `summarise()` — the one function that already defines what
     * "complete" counts as. Computing it a second time in JS would be a second definition, and the two
     * would disagree the day either changes.
     */
    out.summary = deliverline.summarise(_map);
  } catch (e) {
    /* the write succeeded; a stale screen is not worth failing it — the reply simply carries no progress */
    require('../lib/logger').warn('deliver.progress-unread', { chit_id, entity_id, err: e && e.message });
  }
}

/**
 * ⭐⭐ GOODS-IN TICKS THE SAME FACT (Athi, 2026-10-01: "one fact, three doors"). Every line of a bill I RECEIVED is now
 * in → my copy is accepted, through moveStatus — the very function PUT /:chit_id/status runs for Intake: the same
 * transition table, timeline row and ledger hook (the purchase posts behind acceptance). Before this, goods-in recorded
 * the lines and the bill sat "waiting for you to confirm the goods were received".
 * ⚠️ Only from pending / delivered / read: a bill I rejected, or already accepted, is never moved by a goods-in, and a
 *   replayed or corrected delivery moves nothing twice. Only a bill I bought (tax-copy billReceived) — never the seller's
 *   own despatch, never an order I am fulfilling. After the delivery, and never able to fail it.
 */
async function goodsInAccept(req, entity_id, chit_id, out) {
  try {
    const s = out.summary;
    if (s && s.lines > 0 && s.complete === s.lines) {
      const mine = await taxCopy.copyOf(chit_id, entity_id);
      if (mine && taxCopy.billReceived(mine, entity_id) && railActions.BUCKETS.open.includes(String(mine.current_status || ''))) {
        const mv = await moveStatus(
          entity_id,
          chit_id,
          'accepted',
          { id: req.identity.identity_id, name: req.identity.display_name },
          'Goods received in full — accepted at goods-in',
          railActions.meOf(req)
        );
        if (mv.moved) out.accepted = true;
      }
    }
  } catch (e) {
    cbLog.fellBack('chits deliver-lines: the bill was fully received but NOT accepted — accept it by hand', e); /* RAIL-133: this one failed in silence */
  }
}

// ═══ b143 · PER-LINE ASSIGNMENT — division of labour, and it is PRIVATE ═════════════════════════════════════════
//
// Athi, 2026-08-12: assignment private, delivery shared. Nothing here is ever returned to a counterparty.
//
// POST body: { edits: [{ line_id, assignee_actor_id|null, assignee_name, assignee_type, task, due_date, note }] }
// ⚠️ assignee_actor_id: null means UNASSIGN — a deliberate act, and not the same as never having been assigned.
router.post('/:chit_id/assign-lines', auth, ...checked('POST /:chit_id/assign-lines'), async (req, res) => {
  try {
    const chit_id = req.params.chit_id;
    const entity_id = entityId(req);
    /* Assign only on a chit I hold. Without this an id in the URL would file work against a document I am not
       party to — RLS would keep the row mine and harmless, but it would still be a record of someone else's job. */
    const held = await holdsCopy(entity_id, chit_id);
    /* ⭐ R01 — the engine decides: I hold a copy (and the level, which the hat gate already answered) */
    const _v = railActions.can({ held }, railActions.meOf(req), 'assign');
    if (!_v.ok) return problem(req, res, railSaid(railActions.ownCopyRefusalOf(_v)));

    const out = await assign.assign(entity_id, chit_id, req.body.edits || req.body, {
      actor_id: req.identity.identity_id,
      actor_name: req.identity.display_name
    });

    /* ⚠️ LOGGED, BUT INTERNALLY. state_log is per-copy, so this stays on our side of the boundary — the
       counterparty's log is a different set of rows and never receives it. */
    try {
      const detail = out.assignments
        .map(
          (item) =>
            (item.assignee_name || 'Unassigned') + (item.task ? ' · ' + item.task : '') + (item.due_date ? ' · due ' + String(item.due_date).slice(0, 10) : '')
        )
        .join('; ');
      await withEntity(entity_id, (db) =>
        db.query(
          `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail)
         VALUES ($1,$2,'assigned_line',$3,$4,$5)`,
          [chit_id, entity_id, req.identity.identity_id, req.identity.display_name, detail]
        )
      );
    } catch (e) {
      cbLog.fellBack('chits assign-lines: the history line was not written — the assignment stands without it', e);
    }

    res.json({ assignments: out.assignments });
  } catch (err) {
    problem(req, res, faultOf(err, req, 'Failed to assign', { words: true })); /* RAIL-133: the library's own 400 reaches the person */
  }
});

// ═══ b137 · AMEND ═══════════════════════════════════════════════════════════════════════════════════════════════
// Athi, 2026-08-11: *"the chit preparation is going to be automatic... so we have to provide an edit option while
// performing the action at the task level. what the original content is and what it has been amended to."*
//
// ⚠️ THIS IS NOT AN EDIT ENDPOINT. It never touches chit_detail. A sent chit is co-held and immutable — the purge
// route below already refuses anything but a Draft for that reason, and an UPDATE here would quietly undo that
// guarantee from a different direction. What it writes is a CORRECTION, filed next to the reading it corrects.
//
// POST body: { edits: [{ line_index, line: {particulars, quantity, unit, unit_size, price, comment} | null,
//                        reason_code, reason }] }
// ⚠️ `line: null` REMOVES the line — Athi: "old line deleted and new line is nothing". It stays visible on the
//    chit and counts in nothing. That is NOT quantity:0, which is a real zero and would leak into totals.
/** the amend route's edits as a proposal (lib/chit-proposal propose); null when the chit has nobody else on it */
async function proposeAmendment(entity_id, chit_id, edits, req) {
  if (!(await schema.hasTable('chit_proposal'))) return null; /* b796 not run: an amendment is direct, as it always was */
  if (!(await require('../lib/chit-proposal').usesRfq(entity_id, chit_id))) return null; /* a domestic chit that was not made a proposal deal is amended directly, exactly as before 25 Oct (DECISIONS 14:10) */
  const lines = edits.map((item) => ({ line_index: item.line_index, line_id: item.line_id, line: item.line === undefined ? undefined : item.line, price: item.line && item.line.price, quantity: item.line && item.line.quantity, requested_price: item.line && item.line.price, remove: item.line === null, note: item.reason || null }));
  return require('../lib/chit-proposal').propose(entity_id, chit_id, { lines, note: null }, { id: req.identity.identity_id, name: req.identity.display_name });
}
/**
 * ⭐ RAIL-106 (Athi, 25 Oct 11:15): an amendment is a change order. With another party on the chit it is PROPOSED (the seller prices it at the seller's installation; anyone else asks) and the agreed record
 * stands until it is accepted — lib/chit-proposal. Answered here (the proposal, or the library's refusal in its words and code) → true; false: a chit with nobody else on it is amended directly, as it always was.
 */
async function answeredAsProposal(req, res, { entity_id, chit_id, edits }) {
  let proposed;
  try {
    proposed = await proposeAmendment(entity_id, chit_id, edits, req);
  } catch (err) {
    if (!(err && err.refused)) throw err;
    problem(req, res, { status: err.status, ...said({ error: 'Not done', message: err.message, code: err.code }, err.code) });
    return true;
  }
  if (!proposed) return false;
  res.json({ proposed: true, proposal: proposed, amendments: [], message: proposed.kind === 'request' ? 'Counter-proposal asked' : 'Change proposed' });
  return true;
}

/** the edits an amend body carries: { edits: [...] }, or the array (or one edit) as the body itself */
const editsOf = (body) => [].concat(body.edits || body).filter(Boolean);

/**
 * the amend refusals the library means → the Problem spec, or null (anything else goes on to the catch below):
 *  · a settled line is a deliberate refusal, not a failure — say which line and what to do instead. b152: three narrower refusals replaced the old blanket
 *    "any delivery locks the line". Each keeps its own code, because the screen's next action differs: a removal or a reduction wants a NEGATIVE delivery,
 *    while a unit change wants the line left alone. One code for all three would send people to the wrong remedy.
 *  · an input the caller can fix (lib/amend AMEND_*: a line with no item, a quantity that is not a number, nothing to amend, a bad line number): the sentence
 *    reaches the screen under its own code (API-6 finding, 25 Oct)
 */
function knownAmendSpec(err) {
  if (!err) return null;
  if (['LINE_DELIVERED', 'LINE_BELOW_DELIVERED', 'LINE_UNIT_LOCKED'].includes(err.code)) {
    return { status: 409, ...said({ error: 'Already delivered', message: err.message, code: err.code }, 'CHIT_CONFLICT') };
  }
  if (err.status === 400 && /^AMEND_/.test(String(err.code))) return { status: 400, ...said({ error: 'Failed to amend', message: err.message, code: err.code }, err.code) };
  return null;
}

router.post('/:chit_id/amend', auth, ...checked('POST /:chit_id/amend'), async (req, res) => {
  try {
    const chit_id = req.params.chit_id;
    const entity_id = entityId(req);

    /* Amend only what I actually hold. Without this an id in the URL would be enough to file a correction against
       a stranger's chit — the row would be RLS-scoped to me and harmless, but it would still be a record of a
       document I was never party to. */
    const held = await holdsCopy(entity_id, chit_id);
    /* ⭐ R01 — the engine decides: I hold a copy (and the level, which the hat gate already answered) */
    const verdict = railActions.can({ held }, railActions.meOf(req), 'amend');
    if (!verdict.ok) return problem(req, res, railSaid(railActions.ownCopyRefusalOf(verdict)));

    const edits = editsOf(req.body);
    if (await answeredAsProposal(req, res, { entity_id, chit_id, edits })) return;
    const out = await costWrite.recordAmend(req, entity_id, chit_id, edits, { /* RAIL-147: amend.record behind the cost door (lib/cost-write); the owner's call and answer as before */
      actor_id: req.identity.identity_id,
      actor_name: req.identity.display_name
    });

    /* ⚠️ THE AMENDMENT IS THE RECORD; the state_log entry is only so it shows in the chit's own history beside
       every other action. Best-effort: a missing log must not lose a correction that already committed. */
    try {
      const detail = out.amendments
        .map((item) =>
          item.line === null
            ? 'line ' + (item.line_index + 1) + ' removed (' + item.reason_code + ')'
            : 'line ' +
              (item.line_index + 1) +
              ' → ' +
              [item.line.particulars, item.line.quantity, item.line.unit].filter(Boolean).join(' ') +
              ' (' +
              item.reason_code +
              ')'
        )
        .join('; ');
      await withEntity(entity_id, (db) =>
        db.query(
          `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail)
         VALUES ($1,$2,'amended',$3,$4,$5)`,
          [chit_id, entity_id, req.identity.identity_id, req.identity.display_name, detail]
        )
      );
    } catch (e) {
      console.error('amend state_log skipped:', e.message);
    }

    /* ⚠️ SYNONYM CANDIDATES ARE REPORTED, NOT WRITTEN. A correction that renames an item ("thakkali" → Tomato) is
       exactly the fact worth learning, but writing it into the catalogue unasked would permanently merge two words
       on one person's typo, and nothing downstream would ever flag it. Athi's rule (2026-08-11): synonyms may
       promote automatically, but only on N independent confirmations across entities — never on one. Units and
       grades never promote automatically at all. */
    const orig =
      (
        (await withEntity(entity_id, (db) => db.query('SELECT line_items FROM chit_detail WHERE chit_id=$1 AND entity_id=$2 LIMIT 1', [chit_id, entity_id])))
          .rows[0] || {}
      ).line_items || [];
    const norm = (s) =>
      String(s || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
    const candidates = out.amendments
      .filter((item) => item.line && item.reason_code === 'misread_by_ai')
      .map((item) => ({ was: (orig[item.line_index] || {}).particulars, now: item.line.particulars, amendment_id: item.amendment_id }))
      .filter((item) => item.was && item.now && norm(item.was) !== norm(item.now))
      .map((item) => ({ amendment_id: item.amendment_id, term: item.was, means: item.now }));

    res.json({ amendments: out.amendments, synonym_candidates: candidates.length ? candidates : undefined });
  } catch (err) {
    /**
     * ⚠️ A CHECK-CONSTRAINT VIOLATION IS NOT AN INTERNAL FAILURE, AND REPORTING IT AS ONE COST THREE ROUNDS OF
     * TESTING. `reason_code` is whitelisted in lib/amend.js AND constrained in the database — the same rule,
     * written twice — so a value added to one and not the other produced a bare 500 saying "Something went wrong".
     * From the screen it looked like the save button did nothing. Say which value the database refused, so the
     * next time the two lists drift the message points straight at the drift.
     */
    const known = knownAmendSpec(err);
    if (known) return problem(req, res, known);
    if (err && err.code === '23514') {
      cbLog.warn('chits/amend refused by a CHECK constraint', { id: req.id, constraint: err.constraint || '', err: err.detail || err.message });
      return problem(req, res, { status: 409, ...said({
        error: 'Not an accepted value',
        message: /reason_code/.test(err.constraint || '')
          ? 'That amendment reason is not accepted on this environment yet — b148 adds it.'
          : 'The database refused one of these values: ' + (err.constraint || 'constraint violation')
      }, 'CHIT_VALUE_NOT_ACCEPTED') });
    }
    problem(req, res, faultOf(err, req, 'Failed to amend', { words: true })); /* RAIL-133: the library's own 400 reaches the person */
  }
});

// ─── GET /chits/:chit_id/catalogue-overlay?q=… ──────────────────────────────────────────────────────────────────
// Athi: *"assume if you have a catalogue, we can pick up the details from there as an overlay, so it captures all
// the details from the catalogue."*
//
// Correcting the NAME is only half the job — the unit, the pack size and the price were misread with it. This
// hands back the whole catalogue row so one correction can carry all of them, using THE SAME matcher the raise
// path used. Reusing it matters: a picker that resolved names differently from the reader would let a human
// "correct" a line to something the reader would never have produced, and the next message would go wrong again
// in the same way with no trace of why.
//
// ⚠️ READS THE CATALOGUE, WRITES NOTHING TO IT. Standing rule since the raise path: a message never creates a
// product. Here it does not create one either — a human picks from what exists, or types free text.
/** S34: the three keys the overlay adds only when the matcher could not pick one item: ambiguous (how many answer to the name), candidates (the shortlist), unmatched (why); each undefined, so absent, otherwise */
function overlayPicks(found, shortlist) {
  if (!found) return {};
  return { ambiguous: found.ambiguous ? found.matches : undefined, candidates: found.ambiguous || found.variant_unspecified ? shortlist(found) : undefined, unmatched: found.unmatched ? found.reason : undefined };
}

router.get('/:chit_id/catalogue-overlay', auth, ...checked('GET /:chit_id/catalogue-overlay'), async (req, res) => {
  try {
    const entity_id = entityId(req);
    const q = String(req.query.q || '').trim();
    const cat = await itemmatch.loadCatalogue(entity_id);

    /* No catalogue is a normal state, not an error — the farmer sending "milk 10 l" has none, and the amend box
       must still work as free text. Saying so explicitly stops the UI inventing an empty picker. */
    if (!cat.items.length) return res.json({ has_catalogue: false, items: [], match: null });

    /* ⚠️ A CATALOGUE PRICE IS {amount, currency}, NOT A NUMBER. Handing the raw object to the amend card meant
       picking an item set `price: {amount:100,…}` on the replacement line, which clean() then rejected as
       "must be a number" — so correcting an item from the catalogue would 400. `lib/capture.js` already unwraps
       via money.amountOf on the raise path; this route did not, which is the same fact stored two ways.
       Currency travels beside it rather than being dropped: a bare 100 with no code is how two currencies
       eventually get added together. */
    const money = require('../lib/money');
    const full = (it) => ({
      name: it.name,
      variant: it.variant || null,
      unit: it.unit || null,
      price: money.amountOf(it.price),
      currency: money.currencyOf(it.price),
      unit_size: it.unit_size || null,
      label: it.name + (it.variant ? ' · ' + it.variant : ''),
      key: it.key,
      /* The durable identity, so a human pick stamps the same reference the matcher would have. Without it the
         one path where we are CERTAIN which item was meant would be the only one leaving no reference. */
      item_id: it.item_id || null,
      sku: it.sku || null,
      their_ref:
        it.their_ref && typeof it.their_ref === 'object'
          ? { system: String(it.their_ref.system || '').slice(0, 120), id: String(it.their_ref.id || '').slice(0, 120) }
          : null /* the BUYER'S id for this line (Identifiers row) — travels so their side can match it */,
      /* the moment, so a human pick fixes the base exactly as the matcher does — one shape, three paths */
      as_of: it.as_of || null,
      hash: itemmatch.stampOf(it)
    });

    /* The matcher's shortlist, re-read from the catalogue so the picker shows the SAME row shape as everything
       else — and so the price on it is today's, not whatever the reader saw when the chit was raised. */
    const shortlist = (nestedM) =>
      (nestedM.candidates || [])
        .map((item) => {
          const it = cat.items.find((x) => x.key === item.key);
          return it ? { ...full(it), status: item.status, status_text: item.status_text } : null;
        })
        .filter(Boolean);

    const m = q ? itemmatch.match(q, req.query.comment || '', cat) : null;
    const nq = itemmatch.norm(q), picks = overlayPicks(m, shortlist);
    const items = (
      nq
        ? cat.items.filter(
            (item) =>
              itemmatch.norm(item.name).includes(nq) ||
              nq.includes(itemmatch.norm(item.name)) ||
              item.synonyms.some((entry) => entry.includes(nq) || nq.includes(entry))
          )
        : cat.items
    )
      .slice(0, 200)
      .map(full);

    res.json({
      has_catalogue: true,
      /* The whole list too (capped), because the match may be wrong — that is why a human is here. */
      items: items.length ? items : cat.items.slice(0, 200).map(full),
      match:
        m && m.item
          ? {
              ...full(m.item),
              /* ⚠️ SURFACED, NOT HIDDEN. "The catalogue has grades and your message named none" is the single most
           useful thing to tell someone who is about to confirm a line. */
              ...(m.variant_unspecified ? { variant_unspecified: true, variants: m.variants } : {}),
              ...(m.fuzzy ? { matched_by_spelling: true } : {})
            }
          : null,
      /* ⚠️ THE SHORTLIST, NOT A COUNT. This returned `ambiguous: 2` — a number the screen could only print as
         "matches 2 catalogue lines", leaving the person to hunt those two out of a 200-row picker themselves. The
         matcher knew which two; it just did not say. `shortlist()` shapes them exactly like every other pickable
         row, so the picker renders one kind of thing whether it is a shortlist or the whole catalogue. */
      ambiguous: picks.ambiguous,
      /* Same treatment for "the catalogue has grades and you named none" — one picker, two causes. */
      candidates: picks.candidates,
      unmatched: picks.unmatched
    });
  } catch (err) {
    console.error('Catalogue overlay error:', err.message);
    problem(req, res, failed(err, req, 'Failed to load catalogue'));
  }
});
/**
 * the Mark-paid write on the caller's handle: the books first (a refusal throws — nothing marked), then the mark on my copy.
 * → null (no copy) · { parts } (the bill carries its own tender) · { books }
 * An amount above what the bill owes is NOT judged here (FIN-53, Athi 2026-10-29): the books' one rule (`excess`, 409) asks, the
 * owner confirms once with `acknowledge`, and the rest records as an advance — no tolerance, no note path, no second calculation.
 */
async function markChitPaid(db, press) {
  const { entity_id, chit_id, payment, hooks } = press;
  const copy = await taxCopy.copyOn(db, chit_id, entity_id);
  if (!copy) return null;
  const bj = copy.business_json || {};
  /* a counter bill's tender lives on the bill ({ parts }) and posts with it — this door must not overwrite it (two shapes under one key) */
  if (bj.payment && Array.isArray(bj.payment.parts)) return { parts: true };
  const books = await hooks.chitPaid(db, entity_id, Object.assign({}, copy, { business_json: Object.assign({}, bj, { payment }) }), {
    by: payment.by,
    acknowledge: Array.isArray(press.acknowledge) ? press.acknowledge : [] /* a code, or { code, over_minor } — books.acknowledgements reads both */,
    name: (bj.customer && bj.customer.name) || undefined
  });
  const marked = await db.query(
    `UPDATE chit_header SET business_json = COALESCE(business_json, '{}'::jsonb) || jsonb_build_object('payment', $1::jsonb) WHERE chit_id = $2 AND entity_id = $3 RETURNING chit_id`,
    [JSON.stringify(payment), chit_id, entity_id]
  );
  return marked.rows.length ? { books } : null;
}
/** the payment a Mark-paid press carries (method · ref · amount · note · when · who · the press's own client_ref, H2) */
function pressPayment(req, entity_id) {
  const payload = req.body,
    payment = {
      method: payload.method,
      ref: payload.ref || null,
      amount: payload.amount != null ? Number(payload.amount) : null,
      note: payload.note || null,
      at: new Date().toISOString(),
      by: (req.identity && req.identity.identity_id) || entity_id
    };
  if (payload.client_ref) payment.client_ref = String(payload.client_ref);
  return payment;
}
/** a Mark-paid that failed: the books' own refusals in words (already paid · a locked month · …), else a 500 */
function payFailure(req, res, err) {
  const BR = require('./books');
  if (err && err.code === 'ALREADY_PAID') return BR.alreadyPaid(res, err);
  if (err && (err.refused || err.status === 409 || err.status === 422 || /^(BOOKS_|PERIOD_|YEAR_)/.test(String(err.code || '')))) return BR.fail(res, err);
  return problem(req, res, failed(err, req, 'Payment failed'));
}
router.post(
  '/:chit_id/payment',
  auth,
  ...checked('POST /:chit_id/payment'),
  trimmedBody(['ref', 'note', 'client_ref']),
  async (req, res) => {
    try {
      const entity_id = auth.entityOf(req),
        chit_id = req.params.chit_id;
      /* H2 (PAY-FIX): the press's own reference (the web mints one per open of the sheet) — the books key the payment chitpay:<chit>:<ref>, so a second
       "Mark paid" is a second payment and a retry of the same press is its own replay (docs/FIELDS.md business_json.payment.client_ref) */
      const payment = pressPayment(req, entity_id);
      const hooks = require('../lib/books-hooks');
      /* an id that is no uuid names no bill: the unknown bill's 404, never a 500 from the cast (gorilla pack 2, GP-8: not-a-bill-N) */
      const out = trace.UUID_RE.test(chit_id) ? await withEntity(entity_id, (db) => markChitPaid(db, { entity_id, chit_id, payment, acknowledge: req.body.acknowledge, hooks })) : null;
      if (!out) return problem(req, res, { status: 404, ...said({ error: 'Not found' }, 'NOT_FOUND') });
      if (out.parts)
        return problem(req, res, { status: 422, ...said({
          error: 'The tender is on the bill',
          message: 'This bill carries its own tender — money received later is recorded at the counter, against the bill.'
        }, 'PAYMENT_TENDER_ON_BILL') });
      /* what could not post WAITS, named, after the commit (books_outbox → Waiting; the retry posts it through the same classify) */
      if (out.books && out.books.queued) await hooks.park(entity_id, { job: 'chit', chit_id }, out.books.why, chit_id, 'chit:' + chit_id);
      /* my own connector (if one is watching) books the Receipt voucher — the bell rings for ME */
      try {
        require('../lib/events').emit([entity_id], { kind: 'paid', id: chit_id, method: payment.method });
      } catch (e) {
        cbLog.fellBack('chits POST /:chit_id/payment: the signal was not sent — carried on without it', e);
      }
      /* a replay (the same press, or an older web's second press on one chit) is SAID: the books kept the first — never "recorded" twice */
      const replayed = !!(out.books && out.books.payment && out.books.payment.duplicate);
      res.json({ message: replayed ? 'Already recorded' : 'Payment recorded', replayed, payment, books: out.books });
    } catch (err) {
      payFailure(req, res, err);
    }
  }
);
router.delete('/:chit_id/payment', auth, ...checked('DELETE /:chit_id/payment'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const r = await withEntity(entity_id, (db) =>
      db.query(
        `UPDATE chit_header SET business_json = COALESCE(business_json, '{}'::jsonb) - 'payment' WHERE chit_id = $1 AND entity_id = $2 RETURNING chit_id`,
        [req.params.chit_id, entity_id]
      )
    );
    if (!r.rows.length) return problem(req, res, { status: 404, ...said({ error: 'Not found' }, 'NOT_FOUND') });
    /* the books' record is not undone by clearing the mark (drift D1): name the entry, so the owner reverses it there — never silently */
    let books = null;
    try {
      const S = require('../lib/books-store');
      books = await withEntity(entity_id, async (db) => {
        /* H2: every press the chit recorded (chitpay:<chit> and chitpay:<chit>:<ref>), each named by its entry */
        const mine = await S.paymentsOfChit(db, entity_id, req.params.chit_id);
        if (!mine.length) return null;
        const named = [];
        for (const p of mine) {
          const en = await S.entryBySource(db, entity_id, 'pay:' + p.payment_id);
          named.push({ payment_id: p.payment_id, entry_no: en ? en.entry_no : null });
        }
        const entryNumbers = named.map((x) => x.entry_no).filter(Boolean);
        return {
          payment_id: named[0].payment_id,
          entry_no: named[0].entry_no,
          payments: named,
          words:
            'The books still hold ' +
            (named.length === 1 ? 'this payment' : 'these ' + named.length + ' payments') +
            (entryNumbers.length ? ' (' + entryNumbers.join(', ') + ')' : '') +
            ' — reverse ' +
            (named.length === 1 ? 'it' : 'them') +
            ' there.'
        };
      });
    } catch (e) {
      if (!e || e.code !== '42P01') console.error('payment clear: books read failed:', e && e.message);
    }
    res.json({ message: 'Payment cleared', books });
  } catch (err) {
    problem(req, res, failed(err, req, 'Payment clear failed'));
  }
});

/**
 * ⭐ "SEND TO BOOKS" BY HAND (Athi, 2026-09-06): with Orders go to the books = manual, this is the trigger; with any other setting it
 * is "send it now, do not wait for the state". Marks MY copy (business_json.books_request) and rings my own bell so the watching
 * connector books it within a second; the kit's five-minute catch-up would find it anyway.
 */
router.post('/:chit_id/books-request', auth, ...checked('POST /:chit_id/books-request'), async (req, res) => {
  try {
    if (req.api_key) return problem(req, res, { status: 403, ...said({ error: 'Forbidden', message: 'Sign in to send a chit to the books.' }, 'CHIT_NOT_PERMITTED') });
    const entity_id = entityId(req);
    const reqRec = { at: new Date().toISOString(), by: req.identity.identity_id };
    const r = await withEntity(entity_id, (db) =>
      db.query(
        `UPDATE chit_header SET business_json = COALESCE(business_json, '{}'::jsonb) || jsonb_build_object('books_request', $1::jsonb) WHERE chit_id = $2 AND entity_id = $3 RETURNING chit_id`,
        [JSON.stringify(reqRec), req.params.chit_id, entity_id]
      )
    );
    if (!r.rows.length) return problem(req, res, { status: 404, ...said({ error: 'Not found' }, 'NOT_FOUND') });
    try {
      require('../lib/events').emit([entity_id], { kind: 'books', id: req.params.chit_id });
    } catch (e) {
      cbLog.fellBack('chits POST /:chit_id/books-request: the signal was not sent — carried on without it', e);
    }
    res.json({ ok: true, books_request: reqRec });
  } catch (err) {
    problem(req, res, failed(err, req, 'Failed'));
  }
});
/**
 * H3 (PAY-FIX): the books would not take the reversal of a withdrawn chit (every month locked, …) — the withdrawal did NOT happen (its
 * transaction rolled back); the sentence says why and what to do. The sale is reversed in the SAME transaction as the withdrawal.
 */
function withdrawFailure(req, res, err) {
  if (!require('../lib/books-hooks').isBooksRefusal(err)) {
    cbLog.error('chits/void failed', { id: req.id, chit_id: req.params.chit_id, err: err.message });
    return problem(req, res, failed(err, req, 'Void failed'));
  }
  return problem(req, res, { status: 409, ...said({
    error: 'Cannot withdraw',
    code: err.code || 'BOOKS_REFUSED',
    why: 'books_refused',
    message: 'The books hold this chit and could not reverse it: ' + err.message + ' Open the month, or reverse the entry there, then withdraw again.'
  }, 'CHIT_CANNOT_WITHDRAW') });
}
/** the answer of PUT /status: a refusal of the rail as a Problem (its old body kept), else the 200 of a move or of the no-op of a status already held; true when the status really moved */
function answerMoved(req, res, moved) {
  if (moved.code >= 400) problem(req, res, { status: moved.code, ...said(moved.body, codeOfStatus(moved.code)) });
  else res.json(moved.body);
  return !!moved.moved;
}
router.put(
  '/:chit_id/status',
  auth,
  ...checked('PUT /:chit_id/status'),
  trimmedBody(['status', 'note']),
  async (req, res) => {
    try {
      const chit_id = req.params.chit_id;
      // entity_id   = participant entity context (parent for actors, self for entities)
      // action_by_* = whoever is performing — entity admin or actor, never remapped
      const entity_id = entityId(req);
      const action_by_id = req.identity.identity_id;
      const action_by_name = req.identity.display_name;
      const new_status = req.body.status;
      const note = sanitise(req.body.note || '');

      // Get current status
      // B1 RLS: own received-copy read -> withEntity(me).
      /**
       * ── ⭐⭐⭐ FOUR TRANSACTIONS BECAME ONE, AND THE READ MOVED INSIDE THE WRITE ────────────────────────────
       *
       * Athi, 2026-09-11: *"fix the 29 round trips."* The note below this one records the last time this was
       * cut — from six transactions to three. It drifted back to SIX, which is the argument for the budget
       * existing at all: an optimisation with no guard is a thing that gets undone by the next feature.
       *
       * ⚠️⚠️ THE STATUS READ WAS ITS OWN TRANSACTION, AND EVERYTHING IT GATES IS IN THE NEXT ONE. BEGIN,
       * set_config, one SELECT, COMMIT — four round trips across the Pacific to learn one word, and then the
       * whole ceremony again to act on it. The validation between them is PURE: a table lookup and two string
       * comparisons. There was never a reason for it to cost a connection round trip.
       *
       * ⭐ So the read, the validation and the write are one transaction now, and an early return is a MARKER
       * carried out of it rather than a `return` from inside the callback — returning from inside would leave
       * the transaction to be committed by the pool wrapper with the response already sent, which is how a
       * connection leak starts.
       *
       * ⚠️ THE DISPUTE PROBE STAYS OUTSIDE. `schema.hasTable` is a plain query, cached per process, and the
       * note below explains why it must not move in: Postgres aborts the WHOLE transaction on any error, so a
       * missing chit_disputes would take the status change down with it. A savepoint would cost two more trips
       * than it saves.
       */

      /**
       * ── ⭐⭐ THREE TRANSACTIONS BECAME ONE ─────────────────────────────────────────────────────────────────
       *
       * Athi, closing twenty-six tasks: *"it takes a while… also, why does it take long time to do this
       * activity?"* Measured: ONE status change was 7 statements in SIX transactions — 25 round trips, ~6.7s
       * on the Railway→Supabase hop, and he does it once per chit. Three of those transactions were the same
       * entity's own rows, read and written back to back: the open-dispute count, the status UPDATE and the
       * header. One BEGIN, one set_config, three statements, one COMMIT.
       *
       * ⚠️ NOT Promise.all, for the reason stated elsewhere in this file: the pool is max:10, so parallel
       * transactions per request means two concurrent users queue the third. Sequential, inside ONE connection.
       *
       * ⚠️ THE HEADER IS NOW READ BEFORE THE UPDATE RATHER THAN AFTER. Nothing depends on the order — the
       * status write does not touch chit_header — and it is read only to decide whether the caller is sender.
       *
       * ⚠️ A CACHED PROBE, NOT A SAVEPOINT, for the dispute count. The old code guarded it with .catch(),
       * which is fine across separate transactions and useless inside a shared one: Postgres aborts the WHOLE
       * transaction on any error, so a missing chit_disputes would have taken the status change down with it.
       * A savepoint would fix that and cost two more round trips — measured on the chit read today — while
       * schema.hasTable costs one query per process.
       */

      const _moved = await moveStatus(entity_id, chit_id, new_status, { id: action_by_id, name: action_by_name }, note, railActions.meOf(req));
      if (!answerMoved(req, res, _moved)) return;

      /**
       * ⚠️ NOTIFY BACK — AFTER res.json(), AND DELIBERATELY NOT AWAITED (b126).
       *
       * If this chit came from a channel, the customer who sent the original WhatsApp message is told its status
       * changed. It runs after the response for one reason: a courtesy message must never delay, fail, or alter
       * the chit operation that triggered it. The chit is the record; the reply is a notice.
       *
       * notifyChitStatus never throws and returns null when there is nothing to say — no capture behind the chit
       * (composed in the app, so nobody is waiting on WhatsApp), or a status with no customer-facing meaning.
       * ⚠️ It also refuses outside Meta's 24-hour window rather than posting something that would be rejected;
       * the refusal is logged, because a notification never attempted is not the same as one that failed.
       */
      try {
        // No subject is in scope here and it is not worth a query for a courtesy line — notifyChitStatus reads it
        // as optional and simply omits the quoted subject when absent.
        require('../lib/whatsapp-out')
          .notifyChitStatus(entity_id, chit_id, new_status, null)
          .catch(cbLog.orElse('status changed, but the WhatsApp reply was not sent — the customer was not told'));
      } catch (e) {
        cbLog.fellBack(
          'status changed, but the WhatsApp reply could not start — the customer was not told',
          e
        ); /* outbound is never allowed to affect the status change */
      }
    } catch (err) {
      cbLog.error('chits/status failed', { id: req.id, chit_id: req.params.chit_id, err: err.message });
      problem(req, res, failed(err, req, 'Update failed'));
    }
  }
);

// ─────────────────────────────────────────────────────────────
// B3.5 — MESSAGING (dual thread) and DISPUTE MODULE
// ─────────────────────────────────────────────────────────────

// ─── POST /chits/:chit_id/messages ───────────────────────────
// thread_type: 'external' (all parties see) | 'internal' (sender entity only)

/** an EXTERNAL message's timeline line, on the tx that posted its copies: every participant's timeline (chit_log_all,
 *  validated: the caller must be a participant), or a dispute reply's roster only (chit_log_targets). Fallback = the legacy
 *  per-participant loop when b50 isn't applied. RAIL-136 (d): one tx with the copies, so a failed timeline write leaves no
 *  message behind and a retry posts it once. */
async function logMessageSent(db, { chit_id, entity_id, display_name, message_text, roster }) {
  if (roster) {
    // a dispute reply: the roster only (chit_log_targets, validated like the dispute raise/resolve notices)
    await crossingIn(
      db,
      `SELECT chit_log_targets($1,$2,$3,$4,$5,$6)`,
      [chit_id, roster, 'message_sent', entity_id, display_name, message_text.slice(0, 100)],
      async (db) => {
        for (const pid of roster) {
          await db.query(
            `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail)
             VALUES ($1, $2, 'message_sent', $3, $4, $5)`,
            [chit_id, pid, entity_id, display_name, message_text.slice(0, 100)]
          );
        }
      }
    );
  } else {
    await crossingIn(
      db,
      `SELECT chit_log_all($1,$2,$3,$4,$5,$6,$7)`,
      [chit_id, 'message_sent', entity_id, display_name, null, null, message_text.slice(0, 100)],
      async (db) => {
        // DISTINCT entity: a self-chit has two copies under one entity — log once per entity, not per copy.
        const participants = await db.query(`SELECT DISTINCT entity_id FROM chit_status WHERE chit_id = $1`, [chit_id]);
        for (const p of participants.rows) {
          await db.query(
            `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail)
             VALUES ($1, $2, 'message_sent', $3, $4, $5)`,
            [chit_id, p.entity_id, entity_id, display_name, message_text.slice(0, 100)]
          );
        }
      }
    );
  }
}

/**
 * RAIL-106: a message just posted, told to the parties on another installation → what was queued (ctpReturn.answerOf says it on the answer).
 * A dispute message goes to the roster parties elsewhere (targeted), or every party elsewhere (chit-wide); any other message by RAIL-106 x RAIL-136 (sit/run6):
 * the copies are written inside the transaction, so the crossing is queued once it has committed.
 */
function tellMessageElsewhere(entity_id, chit_id, result, posted) {
  const { isDispute, disputeId, disputeRoster, thread_type, message_text, senderName, msg_type } = posted;
  const line_id = posted.line_id || null;
  if (isDispute) return ctpReturn.onDisputeMessage(entity_id, chit_id, { dispute_id: disputeId, message_id: result.message_id, message_text, msg_type, sender_display_name: senderName, line_id, to_ids: disputeRoster });
  return ctpReturn.onMessagePosted(entity_id, { chit_id, thread_type, message_text, msg_type, sender_display_name: senderName, line_id }, result);
}

router.post(
  '/:chit_id/messages',
  auth,
  ...checked('POST /:chit_id/messages'),
  trimmedBody(['message_text']),
  async (req, res) => {
    const { chit_id } = req.params;
    const { message_text, thread_type } = req.body;
    const entity_id = entityId(req);
    const display_name = req.identity.display_name;

    /**
     * ⭐⭐ READ-ONLY MAY MESSAGE INTERNALLY, NEVER EXTERNALLY. Athi, 2026-08-20:
     *
     *   *"Read only is internal messaging only, not external messaging. Edit can pass external messaging."*
     *   *"The auditor can read the external messaging but cannot respond back — that is the difference."*
     *   *"He is auditing, he cannot go and ask questions directly to anyone else. He is internal gate keeper."*
     *
     * An auditor who can answer a counterparty is not auditing, they are participating.
     *
     * ⚠️⚠️ AND THIS CHECK CANNOT LIVE IN THE HAT GATE — which is why it is here, duplicating nothing.
     * Internal and external are ONE endpoint distinguished by a BODY field. The gate matches on path and
     * method and never sees a body, so it can only open or close the whole route. A permission that depends
     * on the CONTENT of a request has to be made where the content is readable.
     *
     * ⚠️ THE GATE OPENING AND THIS REFUSAL LANDED IN THE SAME COMMIT, deliberately. Ship the gate first and
     * read-only silently gains EXTERNAL messaging until this arrives — and widening is the failure direction
     * that never announces itself.
     */
    /* ⭐ R01 — THE ENGINE DECIDES (lib/rail.js): the level first, before any read (as this route always did), then the copy.
       The words below are the ones this route always said; the engine's refusal word rides along as `why`. */
    const _me = railActions.meOf(req);
    const _act = thread_type === 'external' ? 'message_external' : 'message_internal';
    const _lvl = railActions.can({ held: true }, _me, _act); // the copy is not read yet — this verdict is the level's alone
    if (!_lvl.ok) {
      return problem(req, res, railSaid(railActions.refusalOf(_lvl, 403, {
        error: 'Not permitted',
        message:
          _lvl.why === 'read_only'
            ? 'Your access is view-only. You can read this conversation but not post to it.'
            : 'Your access is comment-only. You can reply internally, but not to the other party.',
        access_level: _me.level
      })));
    }

    try {
      // B1 RLS: participant access check on own copy -> withEntity(me).
      const held = await withEntity(entity_id, (db) =>
        db.query(`SELECT entity_id FROM chit_status WHERE chit_id = $1 AND entity_id = $2`, [chit_id, entity_id])
      );
      const _v = railActions.can({ held: held.rows.length > 0 }, _me, _act);
      if (!_v.ok) {
        return problem(req, res, railSaid(railActions.refusalOf(_v, 403, { error: 'Forbidden', message: 'Not a participant on this chit' })));
      }

      // D4: dispute-tagged message — stays filterable in the thread even after the dispute resolves.
      const isDispute = req.body.is_dispute === true || req.body.is_dispute === 'true';
      const disputeId = req.body.dispute_id || null;
      // M1 (reviewer 2026-07-13) — a dispute message needs MORE than chit-participation: the sender must be a PARTY to
      // THIS dispute, and the dispute must belong to THIS chit. RLS makes it one query — under withEntity(sender) the
      // policy returns only the sender's OWN chit_disputes copy, so a returned row proves BOTH roster membership AND
      // chit-ownership. No row → 403 (blocks non-party injection AND cross-chit dispute_id injection via the definer).
      /* ⭐ N02 / I2 — a DISPUTE message's timeline line and bell go to the dispute's ROSTER only, exactly the audience its
         per-copy message already has (chit_message_deliver: targeted → roster). A chit_wide dispute is deliberately the whole
         chit, so it keeps the plain-external audience. null = not a roster-scoped message (plain external, or chit_wide). */
      let disputeRoster = null;
      if (isDispute && disputeId) {
        const party = await withEntity(entity_id, (db) =>
          db.query(`SELECT scope FROM chit_disputes WHERE dispute_id = $1 AND chit_id = $2 LIMIT 1`, [disputeId, chit_id])
        );
        if (party.rows.length === 0) {
          return problem(req, res, { status: 403, ...said({ error: 'Forbidden', message: 'Not a party to this dispute' }, 'CHIT_NOT_PERMITTED') });
        }
        if ((party.rows[0].scope || 'targeted') !== 'chit_wide') {
          // fail closed: a roster that cannot be read means the poster's own timeline only, and no bell
          disputeRoster = [entity_id];
          try {
            const rr = await withEntity(entity_id, (db) => db.query(`SELECT entity_id, role, status FROM chit_dispute_roster($1)`, [disputeId]));
            disputeRoster = [...new Set([entity_id].concat(rr.rows.map((item) => String(item.entity_id))))];
          } catch (e) {
            cbLog.fellBack('chits POST /:chit_id/messages: the read failed — carried on without it', e); /* keep [me] */
          }
        }
      }
      // B3 (Athi): a DISPUTE message posts in the ENTITY's name (the acting actor stays as provenance in the timeline).
      let senderName = display_name;
      if (isDispute && req.identity.parent_entity_id) {
        const _e = await query('SELECT display_name FROM identities WHERE identity_id = $1', [entity_id]).catch(
          cbLog.orElse('chits POST /:chit_id/messages: the read failed — answered with none', { rows: [] })
        );
        if (_e.rows[0] && _e.rows[0].display_name) senderName = _e.rows[0].display_name;
      }

      // PER-ENTITY copies (b67): replicate the message to its audience (internal=author · external=all · dispute=roster).
      /* RAIL-136 (d): the copies and the timeline line in ONE transaction, so a failed timeline write answers 500 with nothing
         posted and a retry posts the message once (it used to be held by every party already, and posted twice) */
      const result = await withEntity(entity_id, async (db) => {
        const posted = await postMessageCopies(
          {
            chit_id,
            sender_entity_id: entity_id,
            sender_display_name: senderName,
            thread_type,
            message_text,
            msg_type: req.body.msg_type,
            is_dispute: isDispute,
            dispute_id: disputeId,
            line_id: req.body.line_id || null
          },
          db
        );
        if (thread_type === 'external') await logMessageSent(db, { chit_id, entity_id, display_name, message_text, roster: disputeRoster });
        return posted;
      });
      result.ctp = await tellMessageElsewhere(entity_id, chit_id, result, { isDispute, disputeId, disputeRoster, thread_type, message_text, senderName, msg_type: req.body.msg_type, line_id: req.body.line_id });

      /* ⭐ THE BELL, for the people on the other side of an EXTERNAL message (CB CRM — a reply lands on the party's timeline and the
         Next block, so their open tab refreshes it). Internal notes are the author's own and ring nobody. Best effort, after the
         answer: a push that cannot be sent never fails the message. kind · id · who — nothing of the text rides it (lib/events). */
      if (thread_type === 'external') {
        try {
          const aud = await withEntity(entity_id, (db) =>
            db.query(`SELECT sender_entity_id, all_recipients FROM chit_header WHERE chit_id = $1 AND entity_id = $2 LIMIT 1`, [chit_id, entity_id])
          );
          const h = aud.rows[0] || {};
          const others = (
            disputeRoster || [h.sender_entity_id].concat((Array.isArray(h.all_recipients) ? h.all_recipients : []).map((x) => x && x.entity_id))
          ).filter((x) => x && String(x) !== String(entity_id));
          if (others.length) require('../lib/events').notifyAfter(res, others, { kind: 'message', id: chit_id, who: display_name || null });
        } catch (e) {
          cbLog.fellBack('chits POST /:chit_id/messages: the read failed — carried on without it', e); /* the message is sent; only the push is lost */
        }
      }

      res.json({
        message_id: result.message_id,
        thread_type,
        message_text,
        sender_display_name: display_name,
        created_at: result.created_at,
        ...ctpReturn.answerOf(result.ctp) // RAIL-106: queued for the party on another installation (resent until it accepts), or the words saying it could not be
      });
    } catch (err) {
      answerSendFailure(req, res, err);
    }
  }
);

// ─── GET /chits/:chit_id/messages ────────────────────────────
/** true only for "the chit_messages table does not exist yet" (42P01 naming it): the one failure an empty thread is honest for */
const isNoMessagesTable = (err) => !!err && err.code === '42P01' && /chit_messages/.test(String(err.message));
// thread_type query: 'all' | 'external' | 'internal'
router.get('/:chit_id/messages', auth, ...checked('GET /:chit_id/messages'), async (req, res) => {
  const { chit_id } = req.params;
  const entity_id = entityId(req);
  const thread_filter = req.query.thread_type || 'all';

  try {
    // PER-ENTITY (b67): everything runs inside withEntity(me). RLS returns ONLY my own message copies — a row
    // exists for me only if I was in its audience (internal=author · external=all · dispute=roster). So the old
    // cross-entity visibility logic is gone; the filter is just by thread_type on my own rows.
    const result = await withEntity(entity_id, async (db) => {
      const access = await db.query(`SELECT 1 FROM chit_status WHERE chit_id = $1 AND entity_id = $2 LIMIT 1`, [chit_id, entity_id]);
      if (access.rows.length === 0) return null; // not a participant
      let cond = '';
      if (thread_filter === 'internal') cond = ` AND COALESCE(is_dispute,false)=false AND thread_type='internal'`;
      else if (thread_filter === 'external') cond = ` AND ((COALESCE(is_dispute,false)=false AND thread_type='external') OR is_dispute=true)`;
      if (req.query.dispute === '1' || req.query.dispute === 'true') cond += ` AND is_dispute = true`;
      /* b155 — one line's thread. Read through to_jsonb so the column may not exist yet: naming line_id directly
         raises 42703 and would take the whole message panel down before the migration runs. */
      const params = [chit_id];
      /* ⚠️ THE PLACEHOLDER IS "$" + THE INDEX. Written through a shell the dollar was eaten, leaving
         `= 2` — a uuid compared against the integer two, which matches nothing and returns an empty thread
         rather than an error. A filter that silently finds nothing looks exactly like "there are no notes". */
      if (req.query.line_id) {
        params.push(req.query.line_id);
        cond += ` AND to_jsonb(chit_messages)->>'line_id' = $` + params.length;
      }
      return db.query(`SELECT * FROM chit_messages WHERE chit_id = $1${cond} ORDER BY created_at ASC`, params);
    });
    if (result === null) return problem(req, res, { status: 403, ...said({ error: 'Forbidden' }, 'CHIT_NOT_PERMITTED', 'This login holds no copy of this chit.') });

    const msgIds = result.rows.map((item) => item.message_id).filter(Boolean);
    const atts = await storage.listForMessages(msgIds, entity_id).catch(cbLog.orElse('chits GET /:chit_id/messages: failed — answered with none', [])); // per-entity: caller's own copies
    const byMsg = {};
    for (const a of atts) {
      (byMsg[a.message_id] = byMsg[a.message_id] || []).push(a);
    }
    for (const m of result.rows) {
      m.attachments = byMsg[m.message_id] || [];
    }
    ctpReturn.markMessages(result.rows, await ctpReturn.unconfirmed(entity_id, chit_id).catch(cbLog.orElse('chits GET /:chit_id/messages: the read failed — answered with none', null))); // RAIL-106: a message of mine the other installation has not confirmed carries ctp_unconfirmed (the sentence to show)
    const thread = PAGE_LIMIT.pageOut('messages', result.rows, PAGE_LIMIT.pageArgs(req.query, LIST_PAGE, LIST_MAX));
    /* S34: count, then the page envelope (lib/page-limit pageOut); capped and cap_note only when the pager cut the thread */
    res.json({ count: result.rows.length, messages: thread.messages, total: thread.total, page: thread.page, limit: thread.limit, capped: thread.capped, cap_note: thread.cap_note });
  } catch (err) {
    console.error('Get messages error:', err.message);
    /* RAIL-136 (e): an empty thread ONLY while the table does not exist yet (42P01, before its migration). Any other failure that
       names chit_messages (a permission, a constraint, a missing column) is a fault and answers so: it used to say "no messages". */
    if (isNoMessagesTable(err)) {
      cbLog.fellBack('chits GET /:chit_id/messages: no chit_messages table yet — answered an empty thread', err);
      return res.json({ messages: [], count: 0, total: 0, page: 1, limit: 0 });
    }
    problem(req, res, failed(err, req, 'Get messages failed'));
  }
});

// ─── B3.10 — targeted + erasure-aware dispute helpers ────────
// integrity-critical categories whose audience the platform widens by obligation (opt-in via env)
const WIDEN_CATEGORIES = (process.env.CB_DISPUTE_WIDEN_CATEGORIES || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

async function probeParity(chit_id, target_entity_id, caller_entity_id) {
  if (!target_entity_id) return { parity_state: null, mode: 'two_sided', answerable: true, target_display_name: null };
  const idn = await query(`SELECT display_name, status, is_erased FROM identities WHERE identity_id=$1`, [target_entity_id]);
  if (idn.rows.length === 0) return { parity_state: 'absent', mode: 'one_sided', answerable: false, target_display_name: '[unknown]' };
  const t = idn.rows[0];
  if (t.is_erased) return { parity_state: 'erased', mode: 'one_sided', answerable: false, target_display_name: '[erased]' };
  if (t.status !== 'active') return { parity_state: 'defunct', mode: 'one_sided', answerable: false, target_display_name: t.display_name };
  // Cross-entity read of the counterparty's copy -> b52 chit_participant_parity (validated participant);
  // fallback to the legacy direct read pre-b52. Same row-presence semantics either way.
  const cs = await crossing(caller_entity_id, `SELECT * FROM chit_participant_parity($1,$2)`, [chit_id, target_entity_id], (db) =>
    db.query(`SELECT deleted_at FROM chit_status WHERE chit_id=$1 AND entity_id=$2`, [chit_id, target_entity_id])
  );
  if (cs.rows.length === 0) return { parity_state: 'absent', mode: 'one_sided', answerable: false, target_display_name: t.display_name };
  if (cs.rows[0].deleted_at) return { parity_state: 'archived', mode: 'two_sided', answerable: true, target_display_name: t.display_name };
  return { parity_state: 'present', mode: 'two_sided', answerable: true, target_display_name: t.display_name };
}

/** the businesses a dispute names: the checklist, else the single target of a targeted dispute */
function askedPartyIds(checklist, targetId) {
  return checklist.length ? [...new Set(checklist)] : targetId ? [targetId] : [];
}

/** SEC-FIX3 S4 — which of these entity ids HOLD a copy of the chit (chit_participants, callable by a holder only); a stranger gets no copy, no reason text */
async function holdersAmong(callerEntity, chit_id, ids) {
  if (!ids.length) return [];
  const participants = await withEntity(callerEntity, (db) => db.query(`SELECT entity_id FROM chit_participants($1)`, [chit_id]));
  const holding = new Set(participants.rows.map((row) => String(row.entity_id)));
  return ids.filter((id) => holding.has(String(id)));
}

/**
 * ⭐ RAIL-106 — THE ONE WRITER OF A RAISED DISPUTE: the per-party copies (chit_dispute_deliver), the raiser's timeline row, the parties' notices and the reason as a roster-scoped message.
 * POST /:chit_id/disputes runs it for the person who raised it; lib/ctpreturn runs the SAME function on the installation that is told of it (as the remote raiser's stub, with the ids mapped
 * to its own rows). The permission and scope decisions are made once, by the route, where the dispute originates — this only records.
 * client = a transaction under withEntity(raiser). → { reason_message_id }
 */
async function recordRaise(client, args) {
  await client.query(`SELECT chit_dispute_deliver($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16::uuid[])`, [
    args.dispute_id, args.chit_id, args.raiser_id, args.raiser_name, args.target_id, args.target_name, args.scope, args.parity.mode, args.parity.answerable, args.parity.parity_state, args.via, args.category, args.reason,
    JSON.stringify(args.evidence), JSON.stringify(args.roster), args.audience
  ]);
  // raiser's own timeline
  await client.query(
    `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail)
     VALUES ($1,$2,'dispute_raised',$3,$4,$5)`,
    [args.chit_id, args.raiser_id, args.raiser_id, args.actor_name, `Dispute raised — ${args.category} (${args.parity.mode === 'one_sided' ? 'record-only' : args.scope}): ${args.reason.slice(0, 80)}`]
  );
  // per-party timeline notices — CROSS write into each party's own state_log copy
  if (args.partyIds.length) {
    const notice = `Dispute raised against you — ${args.category}: ${args.reason.slice(0, 80)}`;
    if (args.ready !== undefined ? args.ready : await definersReady()) {
      await client.query(`SELECT chit_log_targets($1,$2,$3,$4,$5,$6)`, [args.chit_id, args.partyIds, 'dispute_raised', args.raiser_id, args.actor_name, notice]);
    } else {
      for (const pid of args.partyIds) {
        await client.query(
          `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail)
           VALUES ($1,$2,'dispute_raised',$3,$4,$5)`,
          [args.chit_id, pid, args.raiser_id, args.actor_name, notice]
        );
      }
    }
  }
  // the dispute REASON as a per-copy dispute message (roster-scoped via chit_message_deliver)
  const reason_message_id = args.reason_message_id || uuidv4();
  await postMessageCopies(
    { message_id: reason_message_id, chit_id: args.chit_id, sender_entity_id: args.raiser_id, sender_display_name: args.raiser_name, thread_type: 'external', message_text: `[${args.category}] ${args.reason}`, is_dispute: true, dispute_id: args.dispute_id },
    client
  );
  return { reason_message_id };
}

/**
 * ⭐ RAIL-106 — THE ONE WRITER OF A RESOLUTION: the definer that clears the party copy(ies) (and the raiser's when none is left open), the resolver's timeline row, the note as a roster-scoped
 * message and the parties' notices. PUT …/resolve runs it after its own permission check; lib/ctpreturn runs the same function where the resolution is told of. client = a transaction under withEntity(resolver).
 * → { allResolved, resolvedPartyIds, resolve_message_id }
 */
async function recordResolve(client, args) {
  let resolvedPartyIds;
  if (args.targetParty) resolvedPartyIds = [args.targetParty];
  else {
    const openR = await client.query(`SELECT entity_id FROM chit_dispute_roster($1) WHERE role='party' AND status='open'`, [args.dispute_id]);
    resolvedPartyIds = openR.rows.map((item) => item.entity_id);
  }
  // definer clears the party copy(ies), and the raiser's copy when no party remains open. Returns allResolved.
  const rr = await client.query(`SELECT chit_dispute_resolve($1,$2,$3,$4) AS all_resolved`, [args.dispute_id, args.resolver_id, args.targetParty || null, args.resolution_note]);
  const allResolved = rr.rows[0].all_resolved;
  await client.query(
    `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail)
     VALUES ($1,$2,'dispute_resolved',$3,$4,$5)`,
    [args.chit_id, args.resolver_id, args.resolver_id, args.actor_name, `Dispute resolved — ${args.category}: ${args.resolution_note.slice(0, 100)}`]
  );
  const resolve_message_id = args.resolve_message_id || uuidv4();
  await postMessageCopies(
    { message_id: resolve_message_id, chit_id: args.chit_id, sender_entity_id: args.resolver_id, sender_display_name: args.resolver_name, thread_type: 'external', message_text: `[resolved] ${args.resolution_note}`, is_dispute: true, dispute_id: args.dispute_id },
    client
  );
  if (resolvedPartyIds.length) {
    const notice = `Dispute resolved — ${args.category}: ${args.resolution_note.slice(0, 100)}`;
    if (await definersReady()) {
      await client.query(`SELECT chit_log_targets($1,$2,$3,$4,$5,$6)`, [args.chit_id, resolvedPartyIds, 'dispute_resolved', args.resolver_id, args.actor_name, notice]);
    } else {
      for (const pid of resolvedPartyIds) {
        await client.query(
          `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail)
           VALUES ($1,$2,'dispute_resolved',$3,$4,$5)`,
          [args.chit_id, pid, args.resolver_id, args.actor_name, notice]
        );
      }
    }
  }
  return { allResolved, resolvedPartyIds, resolve_message_id };
}

/** ⭐ a settled dispute may release a bill a party already ACCEPTED (lib/books-hooks buyerGate: open dispute → waits). The dispute carries no "in whose favour"; the buyer's own status says it. */
function releaseAfterResolve(out, chit_id, extraIds) {
  if (!out.allResolved) return;
  try {
    const hooks = require('../lib/books-hooks');
    setImmediate(() => {
      for (const party of (extraIds || []).concat(out.resolvedPartyIds || [])) hooks.afterChit(party, chit_id, null);
    });
  } catch (e) {
    cbLog.fellBack('chits dispute resolve: the helper failed — carried on without it', e);
  }
}

/** RAIL-106: a message longer than lib/message-limit allows is refused 413 in words (the writer threw it); true when it answered */
/** POST /messages could not send: a message over the one limit is 413 MESSAGE_TOO_LONG in its words; anything else is the fault answer (logged with the request id) */
function answerSendFailure(req, res, err) {
  if (answeredTooLong(req, res, err)) return;
  console.error('Send message error:', err.message);
  problem(req, res, failed(err, req, 'Send message failed'));
}

/** a targeted dispute names its target (id and the name parity read); a chit-wide one names nobody */
const targetOf = (scope, target_entity_id, parity) => (scope === 'targeted' ? { id: target_entity_id, name: parity.target_display_name } : { id: null, name: null });

/** RAIL-106: on an international or proposal deal only, the parties named on it are rung here; those elsewhere when it arrives */
async function ringDisputeRaised(entity_id, chit_id, partyIds, byName) {
  if (await require('../lib/chit-proposal').usesRfq(entity_id, chit_id)) require('../lib/events').emit(partyIds, { kind: 'dispute', id: chit_id, what: 'raised', who: byName });
}

/** POST /disputes could not raise: too long (413, its words), the disputes tables missing (500 DISPUTES_TABLE_MISSING, says which migrations), else the fault answer */
function answerRaiseFailure(req, res, err) {
  if (answeredTooLong(req, res, err)) return;
  console.error('Raise dispute error:', err.message);
  if (err.message.includes('chit_disputes'))
    return problem(req, res, { status: 500, ...said({ error: 'Table not found', message: 'Run B3.5 + B3.10 migrations', sql_needed: true }, 'DISPUTES_TABLE_MISSING') });
  problem(req, res, failed(err, req, 'Raise dispute failed'));
}

/** PUT /disputes/:id/resolve could not resolve: too long (413, its words), else the fault answer */
function answerResolveFailure(req, res, err) {
  if (answeredTooLong(req, res, err)) return;
  console.error('Resolve dispute error:', err.message);
  problem(req, res, failed(err, req, 'Resolve failed'));
}

function answeredTooLong(req, res, err) {
  if (!err || err.code !== 'MESSAGE_TOO_LONG') return false;
  problem(req, res, { status: 413, ...said({ error: 'Message too long', message: err.message, code: 'MESSAGE_TOO_LONG', limit: err.limit }, 'MESSAGE_TOO_LONG') });
  return true;
}

// ─── POST /chits/:chit_id/disputes ───────────────────────────
router.post(
  '/:chit_id/disputes',
  auth,
  ...checked('POST /:chit_id/disputes'),
  trimmedBody(['reason']),
  async (req, res) => {
    const { chit_id } = req.params;
    const { category, reason, target_entity_id = null, chit_wide = false, via = 'chit' } = req.body;
    const entity_id = entityId(req);
    const display_name = req.identity.display_name;
    try {
      // 1. raiser must be a participant
      const access = await withEntity(entity_id, (db) =>
        db.query(`SELECT current_status FROM chit_status WHERE chit_id=$1 AND entity_id=$2`, [chit_id, entity_id])
      );
      if (access.rows.length === 0) return problem(req, res, { status: 403, ...said({ error: 'Not a participant' }, 'CHIT_NOT_PERMITTED') });
      await ctpReturn.ensureShadows(entity_id, chit_id); // RAIL-106: a party on another installation is a participant here (its shadow row), so the roster below can hold it

      // C2 (Athi): raising on an already-CLOSED chit is allowed but flagged with a warning (bring back to Act if needed).
      const _cs = access.rows[0].current_status;
      const closedWarning =
        _cs === 'completed' || _cs === 'cancelled'
          ? `This chit is already ${_cs} — the dispute is raised anyway. Bring it back to Act if it needs work.`
          : null;
      // B3 (Athi): dispute records + messages carry the ENTITY's name; the acting actor stays as provenance in the timeline.
      let entityName = display_name;
      if (req.identity.parent_entity_id) {
        const _e = await query('SELECT display_name FROM identities WHERE identity_id = $1', [entity_id]).catch(
          cbLog.orElse('chits POST /:chit_id/disputes: the read failed — answered with none', { rows: [] })
        );
        if (_e.rows[0] && _e.rows[0].display_name) entityName = _e.rows[0].display_name;
      }

      // 2. can't target yourself
      if (target_entity_id && target_entity_id === entity_id)
        return problem(req, res, { status: 400, ...said({ error: 'Invalid target', message: 'You cannot raise a dispute against yourself' }, 'CHIT_BAD_REQUEST') });

      // 3. decide scope + probe parity → mode
      // D4: an explicit party checklist means a TARGETED dispute (only those parties see it), even when no
      // single target_entity_id is given. Only fall through to chit_wide when NO parties were selected.
      const selParties = Array.isArray(req.body.participant_entity_ids) ? req.body.participant_entity_ids.filter((x) => x && x !== entity_id) : [];
      let scope = chit_wide ? 'chit_wide' : target_entity_id || selParties.length ? 'targeted' : 'chit_wide';
      const parity = await probeParity(chit_id, scope === 'targeted' ? target_entity_id || null : null, entity_id);

      // 4. platform widen by obligation
      let widened = false;
      if (scope === 'targeted' && WIDEN_CATEGORIES.includes(category)) {
        scope = 'chit_wide';
        widened = true;
      }

      // 5. duplicate guard (raiser + category + same target + open) — per-copy: read the raiser's OWN dispute copies.
      const dup = await withEntity(entity_id, (db) =>
        db.query(
          `SELECT dispute_id FROM chit_disputes
          WHERE chit_id=$1 AND raised_by_entity_id=$2 AND status='open' AND category=$3
            AND COALESCE(target_entity_id::text,'') = COALESCE($4::text,'')`,
          [chit_id, entity_id, category, scope === 'targeted' ? target_entity_id : null]
        )
      );
      if (dup.rows.length) return problem(req, res, { status: 400, ...said({ error: 'Dispute exists', message: `You already have an open ${category} dispute here` }, 'DISPUTE_EXISTS') });

      // 5b. D4 — resolve the involved parties (multi-select checklist). Falls back to the single
      //     target for back-compat. Raiser + parties form the roster; each party carries its own status.
      const partyIds = await holdersAmong(entity_id, chit_id, askedPartyIds(selParties, scope === 'targeted' ? target_entity_id : null));
      const partyNames = {};
      if (partyIds.length) {
        const nm = await query(`SELECT identity_id, display_name FROM identities WHERE identity_id = ANY($1::uuid[])`, [partyIds]);
        nm.rows.forEach((item) => {
          partyNames[item.identity_id] = item.display_name;
        });
      }

      // 6. evidence snapshot — "forward your chit" (survives counterparty erasure)
      const snap = await withEntity(entity_id, (db) =>
        db.query(
          `SELECT ch.auto_subject, ch.summary_json, cs.current_status AS my_status
           FROM chit_header ch JOIN chit_status cs ON cs.chit_id=ch.chit_id AND cs.entity_id=$2
          WHERE ch.chit_id=$1`,
          [chit_id, entity_id]
        )
      );
      const evidence = { ...(snap.rows[0] || {}), captured_at: new Date().toISOString(), via };

      // 7 + 8. insert dispute + timeline atomically (INV-2). Post-b68 chit_disputes IS per-copy + FORCE-RLS, so the
      // raiser's own copy is written in withEntity(me); the per-party copies are a CROSS write served by the
      // chit_dispute_deliver definer (owner-bypass fan-out). Per-party notices go via chit_log_targets (validated).
      const ready = await definersReady();
      // b68 — per-entity dispute copies. Build the roster snapshot + audience (raiser + parties); the definer
      // replicates one chit_disputes copy per participant (bypasses FORCE-RLS as owner). dispute_participants retired.
      const dispute_id = uuidv4();
      const roster = [{ entity_id, display_name: entityName, role: 'raiser' }].concat(
        partyIds.map((pid) => ({ entity_id: pid, display_name: partyNames[pid] || null, role: 'party' }))
      );
      const audience = [...new Set([entity_id, ...partyIds])];
      const target = targetOf(scope, target_entity_id, parity);
      const raised = await withEntity(entity_id, (client) =>
        recordRaise(client, { dispute_id, chit_id, raiser_id: entity_id, raiser_name: entityName, actor_name: display_name, target_id: target.id, target_name: target.name, scope, parity, via, category, reason, evidence, roster, audience, partyIds, ready })
      );
      await ringDisputeRaised(entity_id, chit_id, partyIds, display_name);
      /* RAIL-106: told to the roster's parties on other installations, who record it on their own copy (the decision above is not re-run there) */
      const crossed = await ctpReturn.onDisputeRaised(entity_id, chit_id, { dispute_id, category, reason, scope, mode: parity.mode, answerable: parity.answerable, parity_state: parity.parity_state, via, evidence, actor_name: display_name, raiser_id: entity_id, target_id: target.id, target_name: target.name, roster, partyIds, reason_message_id: raised.reason_message_id });
      const d = {
        dispute_id,
        mode: parity.mode,
        answerable: parity.answerable,
        parity_state: parity.parity_state,
        target_display_name: scope === 'targeted' ? parity.target_display_name : null
      };
      res.json({
        dispute_id: d.dispute_id,
        category,
        reason,
        status: 'open',
        warning: closedWarning, // C2: set when raised on an already-closed chit
        scope,
        mode: d.mode,
        answerable: d.answerable,
        parity_state: d.parity_state,
        target_display_name: d.target_display_name,
        raised_by_display_name: entityName,
        alert:
          d.mode === 'one_sided'
            ? `The other side is no longer reachable (${d.parity_state}). This is lodged as a unilateral record on your own copy.`
            : widened
              ? 'This category notifies all parties — raised chit-wide.'
              : 'Dispute raised with the selected party.',
        message: 'Dispute raised',
        ...ctpReturn.answerOf(crossed)
      });
    } catch (err) {
      answerRaiseFailure(req, res, err);
    }
  }
);

// ─── GET /chits/:chit_id/disputes ────────────────────────────
// All participants see all disputes on a chit
/**
 * ⭐ T3-DISPUTES-ASSIST — every dispute row a screen paints, finished ONE way (this route and the queue below):
 *   participants  the roster (names/roles from MY copy's snapshot) with each party's live status — ONE definer read for every row
 *                 (was one read PER ROW); a failed read keeps the snapshot, logged, never a 500
 *   others        the participants who are not me (the raiser too, when it is not me) — "with whom", decided here, not by the page
 *   mine          I raised it
 *   actions.resolve  { ok } | { ok:false, why, say } — lib/dispute-may.resolve, the same verdict PUT …/resolve refuses with
 */
async function finishDisputes(rows, entity_id, me) {
  const ids = rows.map((item) => item.dispute_id);
  const statusBy = {};
  let rosterRead = false;
  if (ids.length) {
    try {
      const rr = await query(
        `SELECT u.did AS dispute_id, r.entity_id, r.role, r.status FROM unnest($1::uuid[]) AS u(did) CROSS JOIN LATERAL chit_dispute_roster(u.did) r`,
        [ids]
      );
      rr.rows.forEach((item) => {
        statusBy[item.dispute_id + '|' + item.entity_id] = item.status;
      });
      rosterRead = true;
    } catch (err) {
      log.warn('dispute roster read failed — the snapshot is shown', { err: err.message, n: ids.length });
    }
  }
  const lvl = railActions.can({ held: true }, me, 'dispute');
  return rows.map(({ evidence_snapshot, roster, ...d }) => {
    const parts = (roster || d.participants || []).map((item) => ({
      dispute_id: d.dispute_id,
      entity_id: item.entity_id,
      display_name: item.display_name,
      role: item.role,
      dispute_status: (rosterRead && statusBy[d.dispute_id + '|' + item.entity_id]) || item.dispute_status || 'open'
    }));
    const mine = d.raised_by_entity_id === entity_id;
    return {
      ...d,
      has_evidence: evidence_snapshot != null,
      participants: parts,
      others: parts.filter((item) => item.entity_id !== entity_id),
      mine,
      actions: { resolve: disputeMay.resolve(lvl, { open: d.status === 'open', raisedByMe: mine }) }
    };
  });
}
router.get('/:chit_id/disputes', auth, ...checked('GET /:chit_id/disputes'), async (req, res) => {
  const { chit_id } = req.params;
  const entity_id = entityId(req);

  try {
    // B1 RLS: participant access check on own copy -> withEntity(me). T3: the chit's recipients ride the same transaction (who a dispute may name).
    const own = await withEntity(entity_id, async (db) => {
      const access = await db.query(`SELECT entity_id FROM chit_status WHERE chit_id = $1 AND entity_id = $2`, [chit_id, entity_id]);
      if (access.rows.length === 0) return null;
      // B3.10 + D4 — scoped: per-copy (b68): RLS returns MY OWN dispute copies for this chit
      const result = await db.query(`SELECT * FROM chit_disputes WHERE chit_id = $1 ORDER BY created_at ASC`, [chit_id]);
      const hdr = await db.query(`SELECT all_recipients FROM chit_header WHERE chit_id = $1 AND entity_id = $2 LIMIT 1`, [chit_id, entity_id]);
      return { rows: result.rows, recipients: (hdr.rows[0] && hdr.rows[0].all_recipients) || [] };
    });
    if (!own) return problem(req, res, { status: 403, ...said({ error: 'Forbidden' }, 'CHIT_NOT_PERMITTED', 'This login holds no copy of this chit.') });
    const me = railActions.meOf(req);
    // evidence_snapshot is PII — expose presence only; roster surfaced as participants
    const disputes = await finishDisputes(own.rows, entity_id, me);
    /* T3: who a new dispute may name — everyone on the chit but me, once each (the raise route ticks these as participant_entity_ids) */
    const seen = {},
      raise_parties = (Array.isArray(own.recipients) ? own.recipients : [])
        .filter((item) => item && item.entity_id && item.entity_id !== entity_id && !seen[item.entity_id] && (seen[item.entity_id] = 1))
        .map((item) => ({ entity_id: item.entity_id, display_name: item.display_name || null, role: item.role || null }));
    res.json({
      disputes,
      open_count: disputes.filter((item) => item.status === 'open').length,
      raise_parties,
      actions: { raise: disputeMay.raise(railActions.can({ held: true }, me, 'dispute')) }
    });
  } catch (err) {
    if (err.message.includes('chit_disputes')) return res.json({ disputes: [], open_count: 0 });
    problem(req, res, failed(err, req, 'Get disputes failed'));
  }
});

// ─── GET /chits/:chit_id/diagnosis ───────────────────────────
// DEMO-5: read-only diagnosis over B3.10 disputes. One card per dispute the
// viewer is party to. probe (fault) → localise (coordinate) → route (routing) + proof.
// Never writes anything; never returns evidence_snapshot contents.
const FAULT_SUMMARY = {
  present: 'Both sides present — workable',
  archived: 'Counterparty archived their copy — still workable',
  erased: 'Counterparty erased — no live other side',
  defunct: 'Counterparty no longer active',
  absent: 'No counterparty copy found on this chit'
};
router.get('/:chit_id/diagnosis', auth, ...checked('GET /:chit_id/diagnosis'), async (req, res) => {
  const { chit_id } = req.params;
  const entity_id = entityId(req);
  try {
    // B1 RLS: own-copy reads (status/header/detail) -> withEntity(me).
    const rls = await withEntity(entity_id, async (db) => {
      const access = await db.query(`SELECT 1 FROM chit_status WHERE chit_id=$1 AND entity_id=$2`, [chit_id, entity_id]);
      if (access.rows.length === 0) return null;
      const nestedHdr = await db.query(`SELECT auto_subject, schema_version FROM chit_header WHERE chit_id=$1 AND entity_id=$2`, [chit_id, entity_id]);
      const nestedDet = await db.query(`SELECT line_items FROM chit_detail WHERE chit_id=$1 AND entity_id=$2`, [chit_id, entity_id]);
      return { hdr: nestedHdr, det: nestedDet };
    });
    if (!rls) return problem(req, res, { status: 403, ...said({ error: 'Forbidden' }, 'CHIT_NOT_PERMITTED', 'This login holds no copy of this chit.') });
    const { hdr, det } = rls;
    let itemLabel = null;
    try {
      const raw = det.rows[0]?.line_items;
      const li = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
      if (Array.isArray(li) && li.length) {
        itemLabel =
          li
            .map((item) => item.particulars || item.product)
            .filter(Boolean)
            .join(', ') || null;
      }
    } catch (e) {
      cbLog.fellBack('chits GET /:chit_id/diagnosis: did not parse — answered with nothing', e, 'debug');
      itemLabel = null;
    }

    // same audience rule as GET disputes — never leak someone else's dispute
    const d = await withEntity(entity_id, (db) =>
      db.query(
        // per-copy: RLS returns MY OWN dispute copies
        `SELECT dispute_id, category, reason, status, created_at,
              target_display_name, scope, mode, answerable, parity_state, via,
              (evidence_snapshot IS NOT NULL) AS has_evidence
         FROM chit_disputes
        WHERE chit_id=$1
        ORDER BY created_at ASC`,
        [chit_id]
      )
    );

    const diagnoses = d.rows.map((x) => ({
      dispute_id: x.dispute_id,
      category: x.category,
      reason: x.reason,
      status: x.status,
      created_at: x.created_at,
      resolvable: x.mode === 'two_sided',
      // probe → the fault
      fault: {
        state: x.parity_state || 'present',
        category: x.category,
        summary: FAULT_SUMMARY[x.parity_state] || FAULT_SUMMARY.present
      },
      // localise → the coordinate (who / what / which version)
      coordinate: {
        party: x.target_display_name || 'all parties',
        line_item: itemLabel,
        schema_version: hdr.rows[0]?.schema_version ?? null
      },
      // route → how it is handled
      routing: { scope: x.scope, mode: x.mode, answerable: x.answerable },
      // proof → presence only + provenance (never the contents)
      proof: { evidence_captured: x.has_evidence, arose_from: x.via }
    }));

    res.json({ chit_id, chit_subject: hdr.rows[0]?.auto_subject || null, diagnoses, count: diagnoses.length });
  } catch (err) {
    if (err.message.includes('chit_disputes')) return res.json({ chit_id, chit_subject: null, diagnoses: [], count: 0 });
    console.error('Diagnosis error:', err.message);
    problem(req, res, failed(err, req, 'Diagnosis failed'));
  }
});

// ─── PUT /chits/:chit_id/disputes/:dispute_id/resolve ────────
// Only the entity that raised the dispute can resolve it
router.put(
  '/:chit_id/disputes/:dispute_id/resolve',
  auth,
  ...checked('PUT /:chit_id/disputes/:dispute_id/resolve'),
  trimmedBody(['resolution_note']),
  async (req, res) => {
    const { chit_id, dispute_id } = req.params;
    const { resolution_note } = req.body;
    const targetParty = req.body.target_entity_id || null; // per-party resolve; null = clear all remaining
    const entity_id = entityId(req);
    const display_name = req.identity.display_name;
    // B3: the resolution message posts in the ENTITY name (the acting actor stays as provenance in the timeline).
    let entityName = display_name;
    if (req.identity.parent_entity_id) {
      const _e = await query('SELECT display_name FROM identities WHERE identity_id = $1', [entity_id]).catch(
        cbLog.orElse('chits PUT /:chit_id/disputes/:dispute_id/resolve: the read failed — answered with none', { rows: [] })
      );
      if (_e.rows[0] && _e.rows[0].display_name) entityName = _e.rows[0].display_name;
    }

    try {
      // b68 — per-copy: read the raiser's OWN dispute copy (RLS), then resolve across copies via the definer.
      const dispute = await withEntity(entity_id, (db) =>
        db.query(`SELECT * FROM chit_disputes WHERE dispute_id = $1 AND chit_id = $2`, [dispute_id, chit_id])
      );
      if (dispute.rows.length === 0) return problem(req, res, { status: 404, ...said({ error: 'Dispute not found' }, 'NOT_FOUND') });

      const d = dispute.rows[0];
      /* T3-DISPUTES-ASSIST: the SAME verdict GET answers as actions.resolve (lib/dispute-may) — the status codes and words unchanged, `why` added */
      const may = disputeMay.resolve(railActions.can({ held: true }, railActions.meOf(req), 'dispute'), {
        open: d.status === 'open',
        raisedByMe: d.raised_by_entity_id === entity_id
      });
      if (!may.ok && may.why === 'already_resolved') return problem(req, res, { status: 400, ...said({ error: 'Dispute already resolved', why: may.why }, 'DISPUTE_ALREADY_RESOLVED') });
      if (!may.ok && may.why === 'not_raiser') {
        return problem(req, res, { status: 403, ...said({ error: 'Forbidden', message: 'Only the entity that raised the dispute can resolve it', why: may.why }, 'CHIT_NOT_PERMITTED') });
      }
      if (!may.ok) return problem(req, res, { status: 403, ...said({ error: 'Not permitted', message: may.say, why: may.why }, 'CHIT_NOT_PERMITTED') });

      /* ⭐ N02 / I2 — the body's target_entity_id becomes the notice list below, so it must be a PARTY on this dispute's roster.
         The definer only checks chit membership; an unchecked id would hand an outsider "Dispute resolved — <category>: <note>". */
      if (targetParty) {
        const ros = await withEntity(entity_id, (db) => db.query(`SELECT entity_id, role, status FROM chit_dispute_roster($1)`, [dispute_id]));
        if (!ros.rows.some((item) => item.role === 'party' && String(item.entity_id) === String(targetParty))) {
          return problem(req, res, { status: 400, ...said({ error: 'Invalid target', code: 'DISPUTE_TARGET_NOT_PARTY', message: 'That business is not a party to this dispute' }, 'CHIT_BAD_REQUEST') });
        }
      }

      const out = await withEntity(entity_id, (client) =>
        recordResolve(client, { dispute_id, chit_id, resolver_id: entity_id, resolver_name: entityName, actor_name: display_name, targetParty, resolution_note, category: d.category })
      );
      releaseAfterResolve(out, chit_id, [entity_id]);
      if (await require('../lib/chit-proposal').usesRfq(entity_id, chit_id)) require('../lib/events').emit(out.resolvedPartyIds || [], { kind: 'dispute', id: chit_id, what: 'resolved', who: display_name }); /* RAIL-106: an international or proposal deal only: the cleared parties are rung */
      const crossed = await ctpReturn.onDisputeResolved(entity_id, chit_id, { dispute_id, scope: d.scope, target_id: targetParty, resolution_note, category: d.category, actor_name: display_name, resolver_name: entityName, resolve_message_id: out.resolve_message_id });

      res.json({
        dispute_id,
        status: out.allResolved ? 'resolved' : 'open',
        resolved_parties: out.resolvedPartyIds,
        fully_resolved: out.allResolved,
        resolution_note,
        resolved_by: display_name,
        message: out.allResolved ? 'Dispute fully resolved' : 'Party resolved — still open for the others',
        ...ctpReturn.answerOf(crossed)
      });
    } catch (err) {
      answerResolveFailure(req, res, err);
    }
  }
);

// ─── GET /chits/disputes/queue ────────────────────────────────
// All open disputes across all chits for this entity — used by DisputesPage sidebar
// Safe: /disputes/queue has 2 segments; /:chit_id matches 1 segment only — no conflict
/**
 * ⭐ T3-DISPUTES-ASSIST — WIDENED, never copied: the same route answers the small app's paged list (CB Tasks & Orders › Disputes).
 *   ?status=open|resolved|all (open)  ?side=mine|against  ?q=<words>  ?sort=old|new (old: the oldest open one is the one rotting)
 *   ?page=&limit= (lib/page-limit; no page/limit = every row, as before)
 * The answer keeps every key it had (disputes · my_disputes · other_disputes · total_open — the workshop and MIS read them) and adds
 * rows · total · page · limit · counts { open, resolved } and, per row, others · mine · actions.resolve (finishDisputes above).
 * Trips: ONE withEntity transaction (the page + the counts) + ONE roster read for the whole page (was one per row).
 */
router.get('/disputes/queue', auth, ...checked('GET /disputes/queue'), async (req, res) => {
  const entity_id = entityId(req);
  const list = req.query || {};
  const status = ['open', 'resolved', 'all'].includes(list.status) ? list.status : 'open';
  const side = ['mine', 'against'].includes(list.side) ? list.side : null;
  const words = typeof list.q === 'string' ? list.q.trim().slice(0, 100) : '';
  const like = words ? '%' + words.replace(/[\\%_]/g, (c) => '\\' + c) + '%' : null;
  const pageAsked = PAGE_LIMIT.pageArgs(list, 50, 200); /* not asked = every row, as before */
  const limit = pageAsked.limit,
    page = pageAsked.page;
  const dir = list.sort === 'new' ? 'DESC' : 'ASC';

  try {
    // SEC-105: my own copies named in the SQL too (entity_id = $1), not left to RLS alone.
    // B1 RLS: own-copy subselects (chit_header/chit_status) -> withEntity(me). per-copy: RLS returns only MY OWN dispute copies.
    const got = await withEntity(entity_id, async (db) => {
      const r = await db.query(
        `SELECT x.*, count(*) OVER() AS _total FROM (
           SELECT cd.*,
                  (SELECT ch.auto_subject FROM chit_header ch WHERE ch.chit_id=cd.chit_id AND ch.entity_id=$1 LIMIT 1) AS auto_subject,
                  (SELECT ch.purpose      FROM chit_header ch WHERE ch.chit_id=cd.chit_id AND ch.entity_id=$1 LIMIT 1) AS purpose,
                  (SELECT se.display_name FROM chit_header ch LEFT JOIN identities se ON se.identity_id=ch.sender_entity_id
                    WHERE ch.chit_id=cd.chit_id AND ch.entity_id=$1 LIMIT 1) AS sender_display_name
             FROM chit_disputes cd
            WHERE cd.entity_id = $1 AND ($2::text = 'all' OR ($2::text = 'open' AND cd.status = 'open') OR ($2::text = 'resolved' AND cd.status <> 'open'))
              AND ($3::text IS NULL OR ($3::text = 'mine' AND cd.raised_by_entity_id = $1) OR ($3::text = 'against' AND cd.raised_by_entity_id <> $1))
         ) x
         WHERE ($4::text IS NULL OR concat_ws(' ', x.auto_subject, x.purpose, x.category, x.reason, x.raised_by_display_name, x.resolution_note) ILIKE $4::text)
         ORDER BY x.created_at ${dir}, x.dispute_id
         LIMIT $5 OFFSET $6`,
        [entity_id, status, side, like, limit, pageAsked.offset]
      );
      const c = await db.query(
        `SELECT count(*) FILTER (WHERE status = 'open')::int AS open, count(*) FILTER (WHERE status <> 'open')::int AS resolved FROM chit_disputes WHERE entity_id = $1`, [entity_id]);
      return { rows: r.rows, counts: c.rows[0] || { open: 0, resolved: 0 } };
    });
    const total = got.rows.length ? Number(got.rows[0]._total) : 0;
    // evidence_snapshot is PII — expose presence only, never its contents; the roster as participants (live status per party) so the raiser can resolve each party
    const finished = await finishDisputes(
      got.rows.map(({ _total, ...d }) => d),
      entity_id,
      railActions.meOf(req)
    );
    /* S34: a dispute is chit_disputes' columns (cd.*, in table order: migrations/000_baseline_2026-10-21.sql and after) less evidence_snapshot and roster,
       the three subselects, then what finishDisputes adds. Named here, so a column added to the table later is not answered until it is named. */
    // prettier-ignore
    const rows = finished.map((x) => ({ dispute_id: x.dispute_id, chit_id: x.chit_id, raised_by_entity_id: x.raised_by_entity_id, raised_by_display_name: x.raised_by_display_name, category: x.category, reason: x.reason, status: x.status, resolution_note: x.resolution_note, resolved_by_entity_id: x.resolved_by_entity_id, resolved_at: x.resolved_at, created_at: x.created_at, target_entity_id: x.target_entity_id, target_display_name: x.target_display_name, scope: x.scope, mode: x.mode, answerable: x.answerable, parity_state: x.parity_state, via: x.via, entity_id: x.entity_id, role: x.role, auto_subject: x.auto_subject, purpose: x.purpose, sender_display_name: x.sender_display_name, has_evidence: x.has_evidence, participants: x.participants, others: x.others, mine: x.mine, actions: x.actions }));
    // "other" now means disputes targeting me (untargeted ones no longer leak)
    const myDisputes = rows.filter((item) => item.raised_by_entity_id === entity_id);
    const otherDisputes = rows.filter((item) => item.raised_by_entity_id !== entity_id);

    res.json({
      disputes: rows,
      my_disputes: myDisputes,
      other_disputes: otherDisputes,
      total_open: got.counts.open,
      rows,
      total,
      page,
      limit: limit || total,
      counts: { open: got.counts.open, resolved: got.counts.resolved }
    });
  } catch (err) {
    if (err.message.includes('chit_disputes')) {
      return res.json({
        disputes: [],
        my_disputes: [],
        other_disputes: [],
        total_open: 0,
        rows: [],
        total: 0,
        page: 1,
        limit: 0,
        counts: { open: 0, resolved: 0 },
        code: 'DISPUTES_NOT_SET_UP'
      });
    }
    problem(req, res, failed(err, req, 'Get dispute queue failed'));
  }
});

// ─── DELETE /chits/:chit_id ──────────────────────────────────
// Soft delete (per-entity) — sets chit_status.deleted_at for the
// requesting entity only; the other party's copy is untouched.
// ⭐ W2-RAIL R2 — THE GUARDS FAIL CLOSED, answered by lib/rail-actions canHousekeep (one rule for delete · purge · archive):
//   a copy that was SENT or RECEIVED is a record both parties hold → 409 co_held_record (only a Draft moves to Trash — the
//   rule the web already follows and /purge already enforced; the trash door was the one that said yes to anything);
//   an OPEN dispute → 409 dispute_open; a dispute count that could not be read → 503 disputes_unknown, never "none".
/** my copy's facts for a housekeeping verdict: its status, the header's role (Draft = never sent), the open-dispute count (null = unreadable) */
async function housekeepFacts(db, chit_id, entity_id) {
  const copy = await db.query(
    `SELECT cs.current_status, ch.role FROM chit_status cs
       JOIN chit_header ch ON ch.chit_id = cs.chit_id AND ch.entity_id = cs.entity_id AND ch.direction = cs.direction
      WHERE cs.chit_id = $1 AND cs.entity_id = $2 AND cs.deleted_at IS NULL`,
    [chit_id, entity_id]
  );
  if (copy.rows.length === 0) return null;
  return { current_status: copy.rows[0].current_status, role: copy.rows[0].role, open_disputes: await disputeMay.openOn(db, chit_id) };
}
router.delete('/:chit_id', auth, ...checked('DELETE /:chit_id'), async (req, res) => {
  try {
    const chit_id = req.params.chit_id;
    const entity_id = entityId(req);
    const action_by_id = req.identity.identity_id;
    const action_by_name = req.identity.display_name;

    // B1 RLS: caller deletes only its own copy -> withEntity(me). ONE transaction: the facts, the verdict, the write, the log.
    await withEntity(entity_id, async (db) => {
      const facts = await housekeepFacts(db, chit_id, entity_id);
      if (!facts) return problem(req, res, { status: 404, ...said({ error: 'Not found', message: 'Chit not found or already deleted' }, 'NOT_FOUND') });
      const verdict = railActions.canHousekeep('delete', facts);
      if (!verdict.ok) return problem(req, res, railSaid(railActions.housekeepRefusalOf(verdict)));

      // Soft delete this entity's copy only
      await db.query(
        `UPDATE chit_status
       SET deleted_at = NOW(), updated_at = NOW()
       WHERE chit_id = $1 AND entity_id = $2`,
        [chit_id, entity_id]
      );

      // Audit trail — one row for this entity's copy
      await db.query(
        `INSERT INTO state_log
       (chit_id, entity_id, action, action_by_identity_id,
        action_by_display_name, previous_status, new_status, detail)
       VALUES ($1, $2, 'deleted', $3, $4, $5, $5, $6)`,
        [chit_id, entity_id, action_by_id, action_by_name, facts.current_status, `Chit deleted by ${action_by_name}`]
      );

      res.json({ message: 'Chit deleted', chit_id });
    });
  } catch (err) {
    console.error('Delete chit error:', err.message);
    problem(req, res, failed(err, req, 'Delete failed'));
  }
});

// ─────────────────────────────────────────────────────────────
// Slice 2 — fp01 priority endpoints (internal queue + customer cross-edge)
// ─────────────────────────────────────────────────────────────

// PUT /chits/:chit_id/priority — INTERNAL queue priority. Never crosses the edge.
// urgent requires a reason, logged as an internal action message.
router.put(
  '/:chit_id/priority',
  auth,
  ...checked('PUT /:chit_id/priority'),
  trimmedBody(['priority', 'reason']),
  async (req, res) => {
    try {
      const chit_id = req.params.chit_id;
      const entity_id = entityId(req);
      const priority = req.body.priority;
      const reason = sanitise(req.body.reason || '');

      if (priority === 'urgent' && !reason) {
        return problem(req, res, { status: 400, ...said({ error: 'Reason required', message: 'An urgent priority needs a reason' }, 'CHIT_REASON_REQUIRED') });
      }

      // B1 RLS: caller sets priority on its own copy -> withEntity(me).
      await withEntity(entity_id, async (db) => {
        const access = await db.query(`SELECT current_status FROM chit_status WHERE chit_id = $1 AND entity_id = $2`, [chit_id, entity_id]);
        if (access.rows.length === 0) {
          return problem(req, res, { status: 404, ...said({ error: 'Not found', message: 'Chit not found for this entity' }, 'NOT_FOUND') });
        }

        await db.query(
          `UPDATE chit_status SET priority_flag = $1, updated_at = NOW()
         WHERE chit_id = $2 AND entity_id = $3`,
          [priority, chit_id, entity_id]
        );

        // urgent → record an internal action message (only this entity's internal thread — single copy)
        if (priority === 'urgent') {
          await postMessageCopies(
            {
              chit_id,
              sender_entity_id: entity_id,
              sender_display_name: req.identity.display_name,
              thread_type: 'internal',
              message_text: `Marked URGENT: ${reason}`,
              msg_type: 'action'
            },
            db
          );
        }

        res.json({ message: 'Priority updated', chit_id, priority_flag: priority });
      });
    } catch (err) {
      console.error('Set priority error:', err.message);
      problem(req, res, failed(err, req, 'Priority update failed'));
    }
  }
);

// PUT /chits/:chit_id/priority-flag — CUSTOMER cross-edge priority, WRITE-ONCE.
// DESIGN (review): set + lock on EVERY participant row so the counterparty sees it;
// reject once customer_priority_locked is true.
router.put('/:chit_id/priority-flag', auth, ...checked('PUT /:chit_id/priority-flag'), async (req, res) => {
  try {
    const chit_id = req.params.chit_id;
    const entity_id = entityId(req);
    const flag = req.body.priority === true || req.body.priority === 'true';

    // B1 RLS: write-once lock check on own copy -> withEntity(me).
    const access = await withEntity(entity_id, (db) =>
      db.query(`SELECT customer_priority_locked FROM chit_status WHERE chit_id = $1 AND entity_id = $2`, [chit_id, entity_id])
    );
    if (access.rows.length === 0) {
      return problem(req, res, { status: 404, ...said({ error: 'Not found', message: 'Chit not found for this entity' }, 'NOT_FOUND') });
    }
    if (access.rows[0].customer_priority_locked) {
      return problem(req, res, { status: 409, ...said({ error: 'Locked', message: 'Customer priority is write-once and already set' }, 'CHIT_PRIORITY_LOCKED') });
    }

    // Customer flag is cross-edge (write-once) -> set on ALL participant rows via chit_set_customer_priority_all
    // (validated: caller must be a participant). Fallback = the legacy all-rows update when b50 isn't applied.
    await crossing(entity_id, `SELECT chit_set_customer_priority_all($1,$2)`, [chit_id, flag], (db) =>
      db.query(
        `UPDATE chit_status SET customer_priority = $1, customer_priority_locked = true, updated_at = NOW()
           WHERE chit_id = $2`,
        [flag, chit_id]
      )
    );

    // Trail parity with internal urgent: log who/when as an action message.
    // External thread (visibility NULL) — the customer flag is cross-edge, so both parties see the trail.
    await postMessageCopies({
      chit_id,
      sender_entity_id: entity_id,
      sender_display_name: req.identity.display_name,
      thread_type: 'external',
      msg_type: 'action',
      message_text: flag ? 'Customer marked this chit as priority' : 'Customer cleared priority'
    });

    res.json({ message: 'Customer priority set', chit_id, customer_priority: flag, locked: true });
  } catch (err) {
    console.error('Customer flag error:', err.message);
    problem(req, res, failed(err, req, 'Customer flag failed'));
  }
});

// ─────────────────────────────────────────────────────────────
// feat/chit-actions — archive (reversible), void (terminal), assign-bulk
// ─────────────────────────────────────────────────────────────

// POST /chits/:chit_id/archive — hide MY copy from inbox/sent (reversible; never deletes).
// ⭐ W2-RAIL R2: the open-dispute guard FAILS CLOSED — the count that could not be read used to answer 0 (`.catch(() => count 0)`)
// and the chit was archived; now it is 503 disputes_unknown, logged (lib/dispute-may openOn). One transaction, not two.
router.post('/:chit_id/archive', auth, ...checked('POST /:chit_id/archive'), async (req, res) => {
  try {
    const entity_id = entityId(req),
      chit_id = req.params.chit_id;
    // B1 RLS: caller archives only its own copy -> withEntity(me). Per-copy: my own open dispute copies.
    await withEntity(entity_id, async (db) => {
      const verdict = railActions.canHousekeep('archive', { open_disputes: await disputeMay.openOn(db, chit_id) });
      if (!verdict.ok) return problem(req, res, railSaid(railActions.housekeepRefusalOf(verdict)));
      const r = await db.query(
        `UPDATE chit_status SET archived_at = NOW(), updated_at = NOW()
          WHERE chit_id = $1 AND entity_id = $2 AND deleted_at IS NULL AND archived_at IS NULL
          RETURNING chit_id`,
        [chit_id, entity_id]
      );
      if (r.rows.length === 0) return problem(req, res, { status: 404, ...said({ error: 'Not found', message: 'Chit not found or already archived' }, 'NOT_FOUND') });
      res.json({ message: 'Chit archived', chit_id });
    });
  } catch (err) {
    problem(req, res, failed(err, req, 'Archive failed'));
  }
});

// PUT /chits/:chit_id/star — toggle the star/flag on MY copies (kept in sync across both directions).
router.put('/:chit_id/star', auth, ...checked('PUT /:chit_id/star'), async (req, res) => {
  try {
    const entity_id = entityId(req);
    // B1 RLS: caller acts only on its own copy -> withEntity(me).
    await withEntity(entity_id, async (db) => {
      const cur = await db.query(`SELECT star_flag FROM chit_status WHERE chit_id = $1 AND entity_id = $2 LIMIT 1`, [req.params.chit_id, entity_id]);
      if (cur.rows.length === 0) return problem(req, res, { status: 404, ...said({ error: 'Not found', message: 'Chit not found' }, 'NOT_FOUND') });
      const next = !cur.rows[0].star_flag;
      await db.query(`UPDATE chit_status SET star_flag = $3, updated_at = NOW() WHERE chit_id = $1 AND entity_id = $2`, [req.params.chit_id, entity_id, next]);
      res.json({ message: 'Star toggled', chit_id: req.params.chit_id, star_flag: next });
    });
  } catch (err) {
    problem(req, res, failed(err, req, 'Star failed'));
  }
});

// POST /chits/:chit_id/unread — mark MY copy unread (clear read_at).
router.post('/:chit_id/unread', auth, ...checked('POST /:chit_id/unread'), async (req, res) => {
  try {
    const entity_id = entityId(req);
    // B1 RLS: caller acts only on its own copy -> withEntity(me).
    const r = await withEntity(entity_id, (db) =>
      db.query(`UPDATE chit_status SET read_at = NULL, updated_at = NOW() WHERE chit_id = $1 AND entity_id = $2 RETURNING chit_id`, [
        req.params.chit_id,
        entity_id
      ])
    );
    if (r.rows.length === 0) return problem(req, res, { status: 404, ...said({ error: 'Not found', message: 'Chit not found' }, 'NOT_FOUND') });
    res.json({ message: 'Marked unread', chit_id: req.params.chit_id });
  } catch (err) {
    problem(req, res, failed(err, req, 'Mark-unread failed'));
  }
});

// POST /chits/:chit_id/unarchive — restore MY copy to inbox/sent.
router.post('/:chit_id/unarchive', auth, ...checked('POST /:chit_id/unarchive'), async (req, res) => {
  try {
    const entity_id = entityId(req);
    // B1 RLS: caller acts only on its own copy -> withEntity(me).
    const r = await withEntity(entity_id, (db) =>
      db.query(
        `UPDATE chit_status SET archived_at = NULL, updated_at = NOW()
        WHERE chit_id = $1 AND entity_id = $2 AND archived_at IS NOT NULL
        RETURNING chit_id`,
        [req.params.chit_id, entity_id]
      )
    );
    if (r.rows.length === 0) return problem(req, res, { status: 404, ...said({ error: 'Not found', message: 'Chit not found or not archived' }, 'NOT_FOUND') });
    res.json({ message: 'Chit restored', chit_id: req.params.chit_id });
  } catch (err) {
    problem(req, res, failed(err, req, 'Unarchive failed'));
  }
});

// POST /chits/:chit_id/restore — bring MY copy back from Trash (undo a soft delete).
// Mirrors DELETE /:chit_id (which sets deleted_at); clears deleted_at on this entity's copy only + logs it.
router.post('/:chit_id/restore', auth, ...checked('POST /:chit_id/restore'), async (req, res) => {
  try {
    const chit_id = req.params.chit_id;
    const entity_id = entityId(req);
    const action_by_id = req.identity.identity_id;
    const action_by_name = req.identity.display_name;
    // B1 RLS: caller restores only its own copy -> withEntity(me).
    await withEntity(entity_id, async (db) => {
      const r = await db.query(
        `UPDATE chit_status SET deleted_at = NULL, updated_at = NOW()
        WHERE chit_id = $1 AND entity_id = $2 AND deleted_at IS NOT NULL
        RETURNING chit_id`,
        [chit_id, entity_id]
      );
      if (r.rows.length === 0) return problem(req, res, { status: 404, ...said({ error: 'Not found', message: 'Chit not found in Trash' }, 'NOT_FOUND') });
      await db.query(
        `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail)
       VALUES ($1, $2, 'restored', $3, $4, $5)`,
        [chit_id, entity_id, action_by_id, action_by_name, `Chit restored from Trash by ${action_by_name}`]
      );
      res.json({ message: 'Chit restored from Trash', chit_id });
    });
  } catch (err) {
    problem(req, res, failed(err, req, 'Restore failed'));
  }
});

// DELETE /chits/:chit_id/purge — permanently remove a DRAFT (owner only). Real chits are immutable co-held
// records and can NEVER be hard-deleted here; only role='Draft' (un-bridged, sender-only) qualifies.
router.delete('/:chit_id/purge', auth, ...checked('DELETE /:chit_id/purge'), async (req, res) => {
  try {
    const chit_id = req.params.chit_id;
    const entity_id = entityId(req);
    // B1 RLS: caller purges only its own draft copy -> withEntity(me) (was withTransaction).
    await withEntity(entity_id, async (db) => {
      const chk = await db.query(`SELECT role, created_by_actor_id FROM chit_header WHERE chit_id = $1 AND entity_id = $2`, [chit_id, entity_id]);
      if (chk.rows.length === 0) return problem(req, res, { status: 404, ...said({ error: 'Not found', message: 'Draft not found' }, 'NOT_FOUND') });
      /* W2-RAIL R2: the same draft rule the trash door now enforces (canHousekeep: a sent/received copy → 409 co_held_record) */
      const verdict = railActions.canHousekeep('purge', { role: chk.rows[0].role, open_disputes: await disputeMay.openOn(db, chit_id) });
      if (!verdict.ok) return problem(req, res, railSaid(railActions.housekeepRefusalOf(verdict)));
      if (chk.rows[0].created_by_actor_id !== req.identity.identity_id)
        return problem(req, res, { status: 403, ...said({ error: 'Forbidden', message: 'You can only delete drafts you created.' }, 'CHIT_NOT_PERMITTED') });
      await db.query(`DELETE FROM chit_messages WHERE chit_id = $1 AND entity_id = $2`, [chit_id, entity_id]); // per-entity: my own copies only
      await db.query(`DELETE FROM state_log  WHERE chit_id = $1 AND entity_id = $2`, [chit_id, entity_id]);
      await db.query(`DELETE FROM chit_detail WHERE chit_id = $1 AND entity_id = $2`, [chit_id, entity_id]);
      await db.query(`DELETE FROM chit_status WHERE chit_id = $1 AND entity_id = $2`, [chit_id, entity_id]);
      await db.query(`DELETE FROM chit_header WHERE chit_id = $1 AND entity_id = $2`, [chit_id, entity_id]);
      try {
        await db.query(`DELETE FROM cb_attachment WHERE chit_id = $1`, [chit_id]);
      } catch (e) {
        cbLog.fellBack('chits DELETE /:chit_id/purge: the write failed — carried on without it', e); /* attachment table may not exist */
      }
      res.json({ message: 'Draft permanently deleted', chit_id });
    });
  } catch (err) {
    console.error('Purge draft error:', err.message);
    problem(req, res, failed(err, req, 'Purge failed'));
  }
});

/**
 * ⭐ RAIL-106: each copy of mine the withdrawal moved is told to the parties on other installations, by the same event a status move sends (the rail decided it in the route);
 * a withdrawal rings the recipients, as a cancelled status does. → what each was queued as (the route answers the first that says something)
 */
async function tellWithdrawal(entity_id, chit_id, moved, byName, reason) {
  if (!moved || !moved.length) return [];
  const header = await withEntity(entity_id, (db) => db.query('SELECT all_recipients FROM chit_header WHERE chit_id = $1 AND entity_id = $2', [chit_id, entity_id]));
  await ringStatus(entity_id, chit_id, 'cancelled', header, byName);
  const told = [];
  for (const copy of moved) told.push(await ctpReturn.onStatusMoved(entity_id, chit_id, { status: 'cancelled', previous_status: copy.from, copy: copy.copy, by_name: byName, note: reason }));
  return told;
}

// PUT /chits/:chit_id/void — recorded withdrawal by the SENDER; works after acceptance.
//
// ⚠️⚠️ THIS HEADER SAID THE OPPOSITE OF WHAT THE CODE DOES, and said it in the one line anybody skims. It read
// "Terminal 'void' status on ALL participant rows (cross-edge)" — describing a design that was considered and
// NOT built. The body below writes the sender's own copy only and asks the recipients, which is the correct
// behaviour and is explained where it happens. A stale header is worse than no header: it is the version a
// reader trusts, and the next person to touch this would have "fixed" the code to match the comment.
//
// WHAT IT ACTUALLY DOES: the sender's OWN copy goes terminal-void with a reason on its own timeline, and every
// recipient is sent a flagged `[cancel requested]` message. Each recipient then acts on its own copy at its own
// will — a supplier who has already cut the stock may refuse, and that disagreement stays visible and disputable
// rather than being overwritten. Never a cross-entity write: you cannot reach into somebody else's records.
//
// Reason required and logged; the chit stays visible as voided, never deleted; the seal is untouched.
router.put('/:chit_id/void', auth, ...checked('PUT /:chit_id/void'), trimmedBody(['reason']), async (req, res) => {
  try {
    const chit_id = req.params.chit_id;
    const entity_id = entityId(req);
    const reason = sanitise(req.body.reason);

    // B1 RLS: sender check on own copy -> withEntity(me).
    const own = await withEntity(entity_id, (db) =>
      db.query(`SELECT sender_entity_id FROM chit_header WHERE chit_id = $1 AND entity_id = $2`, [chit_id, entity_id])
    );
    if (own.rows.length === 0) return problem(req, res, { status: 404, ...said({ error: 'Not found', message: 'Chit not found' }, 'NOT_FOUND') });
    if (own.rows[0].sender_entity_id !== entity_id) {
      return problem(req, res, { status: 403, ...said({ error: 'Forbidden', message: 'Only the sender can void a chit' }, 'CHIT_NOT_PERMITTED') });
    }

    // Void = the sender withdraws ITS OWN copy and REQUESTS cancellation from the recipients — never a cross-entity
    // write. Each recipient acts on its own copy at its own will (it sees the flagged message below).
    const me = railActions.meOf(req);
    const gate = await withEntity(entity_id, async (db) => {
      /**
       * ⭐⭐ `cancelled`, NOT `void` — Athi, 2026-09-02: *"go with cancelled, retire void."*
       *
       * ⚠️⚠️ `void` WAS A STATUS THE FRONT END HAD NEVER HEARD OF. The list maps status → bucket with
       * `ST[current_status] || 'open'`, and `void` is not in ST — so a withdrawn order fell through the default
       * and went on reading as **OPEN** in the sender's own list. The withdrawal worked and the screen said it
       * had not. A vocabulary with one word that only the server knows is not a vocabulary.
       *
       * ⭐ AND `cancelled` ALREADY EXISTED, meaning exactly this, already bucketed as closed, already in every
       * filter and rollup. There were two withdrawal paths — this route, and setting status to `cancelled` as
       * the sender, which already posted the same `[cancel requested]` message. Two mechanisms for one act, one
       * of them speaking a private word. This route keeps the door (the button calls it, it enforces
       * sender-only, it requires a reason) and now writes the vocabulary everything else understands.
       *
       * ⚠️ The state_log action stays `voided`: it is a HISTORY row, and rewriting what old entries claim
       * happened would falsify the record this table exists to keep. b196 converts the stored statuses; the log
       * keeps saying what the code was called on the day.
       */
      /* ⭐⭐ T1-RAIL — THROUGH THE ONE STATUS WRITE. This was a bare SET for every own copy, so a COMPLETED chit could be
           withdrawn though the rail has no completed → cancelled step. Each copy I hold (the sent one; a self-chit also its
           received one) asks lib/rail-status statusGate; if ANY copy may not be cancelled, nothing is written and the sender is
           told why. Own copies only, as before. */
      const gates = [];
      for (const copy of railStatus.COPIES) {
        const g = await railStatus.statusGate(db, entity_id, chit_id, 'cancelled', me, { copy });
        if (g.from) gates.push(g); // a copy I do not hold has nothing to move
      }
      const refusedBy = gates.find((item) => !item.ok);
      if (refusedBy) return { refused: refusedBy };
      const moved = [];
      for (const g of gates) if (await g.write()) moved.push({ copy: g.copy, from: g.from });
      await db.query(
        `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, new_status, detail)
           VALUES ($1, $2, 'voided', $3, $4, 'cancelled', $5)`,
        [chit_id, entity_id, req.identity.identity_id, req.identity.display_name, `Withdrawn: ${reason}`]
      ); // own timeline only
      return { refused: null, moved, books: await require('../lib/books-hooks').chitWithdrawn(db, entity_id, chit_id, reason, req.identity.identity_id) }; // H3
    });
    if (gate.refused) {
      const g = gate.refused;
      if (g.why !== 'wrong_step') {
        return problem(req, res, railSaid(railActions.refusalOf(g, 403, { error: 'Not permitted', message: railActions.WHY[g.why] })));
      }
      /* what happened · what it means · what to do — `why` is the code a screen branches on, never this sentence */
      return problem(req, res, railSaid(railActions.refusalOf(g, 409, {
        error: 'Cannot withdraw',
        message: `This chit is already ${g.from}, so it cannot be withdrawn. Raise a dispute on it if something is wrong.`,
        from: g.from,
        allowed_transitions: g.allowed
      })));
    }
    const told = await tellWithdrawal(entity_id, chit_id, gate.moved, req.identity.display_name, reason);
    // deliver the flagged cancel request to the recipients (a per-copy message — like a dispute notification)
    await postMessageCopies({
      chit_id,
      sender_entity_id: entity_id,
      sender_display_name: req.identity.display_name,
      thread_type: 'external',
      msg_type: 'action',
      message_text: `[cancel requested] ${reason}`
    });

    /**
     * ⭐⭐ AND A FLAG ON THEIR COPY, NOT ONLY A MESSAGE (b195). Athi, 2026-09-02: *"it has to be flagged against
     * the order right away, so we need a flag to show cancel requested."*
     *
     * The message alone lands in the Messages tab, behind a click, in a list with everything else — so the one
     * fact that changes what a supplier should do next arrived looking like chatter. It could not be derived on
     * the read path either: `msg_type` is CHECK-constrained to eight values, none meaning "cancel request", so
     * the only marker was a PREFIX IN THE TEXT and every screen would have had to string-match message bodies.
     *
     * ⚠️⚠️ THIS IS NOT THE CROSS-ENTITY WRITE THIS ROUTE FORBIDS, and the line is worth being exact about.
     * `postMessageCopies` directly above ALREADY writes into every recipient's copy — delivering INTO a copy is
     * what the rail does. What it must never do is decide FOR them:
     *     cancel_requested_at  — someone has asked. Inbound. Written here.        ✅
     *     current_status       — their answer. Only they may write it.            ❌ untouched
     * A supplier who cut the stock at 6am still refuses by leaving their status where it is.
     *
     * ⚠️ SCOPED TO THE OTHER PARTICIPANTS: `entity_id <> $2`. The sender's own row is already terminal-void
     * from the UPDATE above, and stamping "cancel requested" on it as well would make the sender look like
     * somebody who had been asked.
     *
     * ⚠️⚠️ ONE CONTEXT PER RECIPIENT — AND MY FIRST VERSION USED `withEntity(null)` AND WROTE NOTHING.
     *
     * The b49 policy on chit_status is `entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid`.
     * With no context that expression is NULL, `entity_id = NULL` is never true, and the UPDATE matched ZERO
     * rows — inside a catch, so nothing was raised and the withdrawal reported success. The flag simply never
     * existed. ⭐ THE END-TO-END SPEC IS WHAT CAUGHT IT: every part was green (the button, the banner's render
     * states, the column reaching the payload) and the join was dead.
     *
     * ⚠️ AND THE COMMENT I WROTE ARGUED FOR THE BUG — it said a null context was needed because the sender's
     * context would filter the rows. A null context filters EVERYTHING. This is the same RLS-with-no-usable-
     * context blackout diagnosed for the register earlier in this same session; writing it a second time, one
     * day later, is why the rule is worth stating plainly: **RLS with no context is not "unrestricted", it is
     * "matches nothing".**
     *
     * ⭐ The rail already had the answer beside this line: `postMessageCopies` reaches every copy through the
     * SECURITY DEFINER `chit_message_deliver`. Without a definer for this, the honest equivalent is to set each
     * recipient's own context and write their row — the server acting as delivery agent, one copy at a time,
     * which is exactly what a per-copy rail does.
     *
     * ⚠️ Recipients come from the SENDER'S OWN header (`all_recipients`), readable under the sender's context —
     * so nothing here needs to read across a boundary in order to write across one.
     *
     * ⚠️ GUARDED BY hasColumn so the deploy can precede the migration in either order, and wrapped so a failure
     * here can never lose the withdrawal itself: the sender's copy and the message are already committed, and
     * an un-flagged request is a smaller fault than a withdrawal that reports failure after doing the work.
     */
    try {
      if (await schema.hasColumn('chit_status', 'cancel_requested_at')) {
        const hdr = await withEntity(entity_id, (db) =>
          db.query(`SELECT all_recipients FROM chit_header WHERE chit_id = $1 AND entity_id = $2`, [chit_id, entity_id])
        );
        const parties = ((hdr.rows[0] && hdr.rows[0].all_recipients) || []).map((item) => item && item.entity_id).filter((id) => id && id !== entity_id);
        /* De-duplicated: one entity may appear as both `to` and `cc`, and stamping twice would move the
             timestamp for no reason. */
        for (const rid of [...new Set(parties)]) {
          await stampCancelRequested(rid, chit_id, req.identity.display_name, reason);
        }
        told.push(await ctpReturn.onCancelRequested(entity_id, chit_id, { by_name: req.identity.display_name, reason })); // RAIL-106: the flag on a copy on another installation is set there, by the same stamp
      }
    } catch (e) {
      console.error('cancel flag:', e.message);
    }

    /* The response says what was WRITTEN. Answering 'void' while storing 'cancelled' would hand every caller
         the private word this change exists to retire. */
    res.json({ message: 'Order withdrawn', chit_id, status: 'cancelled', books: gate.books, ...ctpReturn.answerOf(ctpReturn.firstOf(told)) });
  } catch (err) {
    withdrawFailure(req, res, err);
  }
});

// POST /chits/assign-bulk — push-assign many chits to one actor (mirrors the single push).
router.post(
  '/assign-bulk',
  auth,
  ...checked('POST /assign-bulk'),
  async (req, res) => {
    try {
      const entity_id = entityId(req);
      const action_by_id = req.identity.identity_id;
      const action_by_name = req.identity.display_name;
      const { chit_ids, target_actor_id } = req.body;
      const me = railActions.meOf(req); // T1-RAIL: who moves each copy back to pending (the rail's level ladder)
      if (chit_ids.length > 200) return problem(req, res, { status: 400, ...said({ error: 'Too many', message: 'Assign at most 200 chits at once.' }, 'CHIT_TOO_MANY') }); // F4: bound the batch (long tx / lock contention)

      // Atomic: the whole batch (counts + chit_status + state_log) commits together or rolls back —
      // a mid-loop failure no longer leaves a partial assign. Target validated inside the tx.
      // B1 RLS: bulk-assign writes only the assigning entity's own rows -> withEntity(me), not withTransaction.
      const out = await withEntity(entity_id, async (client) => {
        // (e) Assignment rule from settings: honour pull/push mode + per-actor capacity BEFORE assigning.
        const st = await client.query(`SELECT assignment_model, default_max_tasks FROM entity_actor_settings WHERE entity_id = $1`, [entity_id]);
        const model = (st.rows[0] && st.rows[0].assignment_model) || 'both';
        const defMax = (st.rows[0] && st.rows[0].default_max_tasks) || 10;
        if (model === 'pull') {
          const e = new Error('Push-assign is off — this entity is in pull mode (co-assists take tasks themselves).');
          e.status = 400;
          throw e;
        }

        const target = await client.query(
          `SELECT identity_id, display_name, max_tasks, current_task_count FROM identities
            WHERE identity_id = $1 AND parent_entity_id = $2 AND break_status = 'active'
              AND hat IN ('act','manager')`,
          [target_actor_id, entity_id]
        );
        if (target.rows.length === 0) {
          const e = new Error('Target co-assist not found, not on shift, or not an assignable hat (Act/Manager)');
          e.status = 400;
          throw e;
        }
        const t = target.rows[0];
        const cap = t.max_tasks || defMax;
        let load = t.current_task_count || 0;

        const assigned = [];
        const skipped = [];
        for (const chit_id of chit_ids) {
          const cs = await client.query(`SELECT assigned_to_actor_id FROM chit_status WHERE chit_id = $1 AND entity_id = $2 AND deleted_at IS NULL`, [
            chit_id,
            entity_id
          ]);
          if (cs.rows.length === 0) {
            skipped.push({ chit_id, reason: 'not found' });
            continue;
          }
          const already = cs.rows[0].assigned_to_actor_id;
          if (already === t.identity_id) {
            assigned.push(chit_id);
            continue;
          } // already theirs — no change, no cost
          if (load >= cap) {
            skipped.push({ chit_id, reason: `at capacity (${cap})` });
            continue;
          } // (e) capacity gate
          if (already) {
            await taskCount(client, already, 'release');
          }
          /* ⭐ W1-RAIL: the one assignment writer — the UPDATE, then back to pending through the ONE status write (T1-RAIL): only my
             received copy moves (the rail's rule); a sent copy keeps its status. The assignment stands either way; a refusal is logged. */
          await assignChit(client, entity_id, chit_id, t, 'push', { me });
          await taskCount(client, t.identity_id, 'take'); /* TA1 */
          load++;
          await client.query(
            // F3: assignment is INTERNAL — write ONLY the assigning entity's own row. The assignee sees it via the
            // derived notifications feed (assigned_to_me) — step (d) of the workflow.
            `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail)
             /* DISTINCT — a self-chit holds two chit_status rows for one entity, so this wrote the same
                assignment event twice. The read side now dedupes it, but writing it twice was still wrong. */
             SELECT $1, entity_id, 'assigned', $2, $3, $4 FROM (SELECT DISTINCT entity_id FROM chit_status WHERE chit_id = $1 AND entity_id = $5) s`,
            [chit_id, action_by_id, action_by_name, `Bulk-assigned to ${t.display_name} by ${action_by_name}`, entity_id]
          );
          assigned.push(chit_id);
        }
        return { t, assigned, skipped, cap };
      });
      res.json({ message: 'Bulk assign complete', assigned_to: out.t.display_name, assigned: out.assigned.length, skipped: out.skipped });
    } catch (err) {
      if (err.status === 400) return problem(req, res, { status: 400, ...said({ error: 'Invalid target', message: err.message }, 'CHIT_BAD_REQUEST') });
      console.error('Bulk assign error:', err.message);
      problem(req, res, failed(err, req, 'Bulk assign failed'));
    }
  }
);

router.use(require('./chits-trace')); /* LEAN-PLAN §8 slice 1: the trace routes, mounted where they sat so no path changes its order */

router.openapi = { paths: pathsOf(), schemas: {} };
router.use(require('./chit-proposals')); /* RAIL-106: /:chit_id/proposals — the one proposal mechanism (pro-forma rounds, counters, amendments after agreement) */
router.sendSeller = sendSeller; /* tests show whose money a send is priced in */
router.sendMoney = sendMoney; /* the send step that prices a chit — exported so a test can show WHO it asks the tax engine for */
router.moneyOfLines = moneyOfLines; /* lib/change-order re-issues the invoice for proposed lines by the very same calculation */
router.moneyOfInvoice = moneyOfInvoice;
router.recordRaise = recordRaise; /* lib/ctpreturn records a dispute raised on another installation through the same writers */
router.recordResolve = recordResolve;
router.releaseAfterResolve = releaseAfterResolve;
router._autoAssignReceived = autoAssignReceived; /* tests: T1-RAIL proves auto-assign moves status through lib/rail-status */
module.exports = router;
module.exports.rollupGroups = rollupGroups; /* REP-50: for tests/rollup-currency.test.cjs */
router.holdersAmong = holdersAmong; /* SEC-FIX3 S4 — exported for tests/sec-fix3.test.cjs */
