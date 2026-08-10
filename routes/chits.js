// routes/chits.js — Chit send, inbox, detail, status update
const express = require('express');
const router = express.Router();
const { safeErr } = require('../lib/respond');
const { body } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const { query, withTransaction, withEntity } = require('../db');
const storage = require('../lib/storage');
const { validate, sanitise } = require('../middleware/validate');
const auth = require('../middleware/auth');
const trace = require('../lib/trace');
const mint = require('../lib/mint');   // ⚠️ the SHAPE of a chit — one place, four call sites

// The acting entity for RLS/ownership: an actor carries parent_entity_id; a bare entity login is its own id.
// Single source of truth (was duplicated 26× as `auth.entityOf(req)`).
const entityId = (req) => auth.entityOf(req);

// ── B1 RLS — the crossing helper ─────────────────────────────────────────────────────────────────────────
// A few chit operations legitimately cross the entity boundary (log an event into every/selected participant,
// propagate a cancel/void, set the customer flag). Under RLS those are served by the b50/b51 SECURITY DEFINER
// "delivery-agent" fns. `crossing()` runs the definer inside withEntity(caller); if the delivery layer isn't
// applied yet (pre-b50), it runs a legacy direct-SQL fallback in its OWN transaction — so a missing-function
// error can't poison a shared tx, and the feature keeps working before/after the migration. Under FORCE without
// the fn the fallback fails closed (degraded, never a cross-tenant leak). Once b50 is applied the definer wins.
// Are the b50/b51/b52 delivery-agent fns installed? Latches true once seen; keeps re-probing while false, so it
// self-heals when the migration lands (no restart needed). A tenant-table-free probe -> the RLS guard stays silent.
let _definersReady = false;
async function definersReady() {
  if (_definersReady) return true;
  try {
    const r = await query(
      `SELECT (to_regprocedure('chit_deliver(uuid,boolean,jsonb)') IS NOT NULL
           AND to_regprocedure('chit_log_targets(uuid,uuid[],text,uuid,text,text)') IS NOT NULL
           AND to_regprocedure('chit_participant_parity(uuid,uuid)') IS NOT NULL) AS ok`);
    _definersReady = !!(r.rows[0] && r.rows[0].ok);
  } catch (_) { /* leave false — fall back to legacy */ }
  return _definersReady;
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
  try { const r = await query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'chit_status' AND column_name = 'folder_id' LIMIT 1`); _folderColReady = r.rows.length > 0; }
  catch (_) { _folderColReady = false; }
  return _folderColReady;
}

async function crossing(entity, definerSql, definerParams, fallback) {
  if (await definersReady()) {
    return await withEntity(entity, (db) => db.query(definerSql, definerParams));
  }
  return await withEntity(entity, fallback);
}

// Connection check removed — existence check only
// Sender can send to any entity that exists in the system

// ─── Helper: Generate auto subject ───────────────────────────
const generateAutoSubject = (purpose, senderName, date) => {
  const purposes = {
    order: 'Order',
    invoice: 'Invoice',
    receipt: 'Receipt',
    inquiry: 'Inquiry',
    delivery_note: 'Delivery Note',
    general: 'Message'
  };
  const label = purposes[purpose] || 'Chit';
  const dateStr = new Date(date).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric'
  });
  return `${label} from ${senderName} — ${dateStr}`;
};

// ─── Helper: Calculate summary ───────────────────────────────
const calculateSummary = (lineItems) => {
  if (!lineItems || !Array.isArray(lineItems)) {
    return { line_item_count: 0, total_value: 0 };
  }
  const total = lineItems.reduce((sum, item) => {
    return sum + (parseFloat(item.total || item.price * item.quantity || 0));
  }, 0);
  return {
    line_item_count: lineItems.length,
    total_value: Math.round(total * 100) / 100
  };
};

// ─── D1 auto-assign on receipt ─────────────────────────────────
// Walk the delegate chain when the chosen actor is on leave / not-assignable. Returns an assignable
// actor id (active + Act/Manager hat) or null. Loop-guarded (visited set + depth cap). Capacity is
// NOT re-checked here — the default/overflow assignee absorbs excess by design (D1).
async function resolveDelegateTarget(client, entity_id, actorId) {
  const seen = new Set(); let cur = actorId; let depth = 0;
  while (cur && depth < 12) {
    if (seen.has(cur)) return null;                    // cycle → give up (set-time check is the primary guard)
    seen.add(cur);
    const r = (await client.query(
      `SELECT identity_id, break_status, hat, delegate_actor_id
         FROM identities WHERE identity_id = $1 AND parent_entity_id = $2 AND identity_type = 'actor'`,
      [cur, entity_id])).rows[0];
    if (!r) return null;
    if (r.break_status === 'active' && (r.hat === 'act' || r.hat === 'manager')) return r.identity_id;
    cur = r.delegate_actor_id; depth++;                // on leave / not assignable → try their delegate
  }
  return null;
}

// Auto-assign a freshly-received chit per the entity's mode. Atomic + idempotent (skips if already
// assigned). Caller runs it best-effort AFTER commit so it can never fail the guaranteed chit.
async function autoAssignReceived(entity_id, chit_id) {
  // B1 RLS: the receiver auto-assigns within its OWN roster -> withEntity(receiver), not withTransaction.
  await withEntity(entity_id, async (client) => {
    const st = (await client.query(
      `SELECT auto_assign_mode, default_assignee_actor_id, default_max_tasks
         FROM entity_actor_settings WHERE entity_id = $1`, [entity_id])).rows[0];
    const mode = (st && st.auto_assign_mode) || 'off';
    if (mode === 'off') return;
    const defMax = (st && st.default_max_tasks) || 10;
    const defaultAssignee = (st && st.default_assignee_actor_id) || null;

    // Idempotency + scope: only the actionable received copy, still unassigned.
    const cs = (await client.query(
      `SELECT assigned_to_actor_id FROM chit_status
         WHERE chit_id = $1 AND entity_id = $2 AND direction = 'received' AND deleted_at IS NULL`,
      [chit_id, entity_id])).rows[0];
    if (!cs || cs.assigned_to_actor_id) return;

    let target = null;
    if (mode === 'default_assignee') {
      target = defaultAssignee;
    } else if (mode === 'least_loaded') {
      const cand = (await client.query(
        `SELECT identity_id, max_tasks, current_task_count FROM identities
           WHERE parent_entity_id = $1 AND identity_type = 'actor' AND break_status = 'active'
             AND hat IN ('act','manager')
           ORDER BY current_task_count ASC, last_assigned_at ASC NULLS FIRST
           LIMIT 10`, [entity_id])).rows;
      const room = cand.find(a => (a.current_task_count || 0) < (a.max_tasks || defMax));
      target = room ? room.identity_id : defaultAssignee;   // all full → overflow to the default assignee
    }
    if (!target) return;                               // no eligible actor + no default → stays in the pool

    target = await resolveDelegateTarget(client, entity_id, target);   // route past anyone on leave
    if (!target) return;

    const t = (await client.query(
      `SELECT identity_id, display_name FROM identities
         WHERE identity_id = $1 AND parent_entity_id = $2 AND identity_type = 'actor'`,
      [target, entity_id])).rows[0];
    if (!t) return;

    await client.query(
      `UPDATE chit_status SET assigned_to_actor_id = $1, assigned_to_actor_display_name = $2,
              assigned_at = NOW(), assignment_type = 'auto', current_status = 'pending', updated_at = NOW()
        WHERE chit_id = $3 AND entity_id = $4 AND direction = 'received'`,
      [t.identity_id, t.display_name, chit_id, entity_id]);
    await client.query(
      `UPDATE identities SET current_task_count = current_task_count + 1, last_assigned_at = NOW() WHERE identity_id = $1`,
      [t.identity_id]);
    await client.query(
      `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, new_status, detail)
       VALUES ($1, $2, 'assigned', NULL, 'System (auto-assign)', 'pending', $3)`,
      [chit_id, entity_id, `Auto-assigned to ${t.display_name} (${mode === 'least_loaded' ? 'least-loaded' : 'default assignee'})`]);
  });
}

// ─── POST /chits/send ─────────────────────────────────────────
// Send a chit from sender to one or more receivers
router.post('/send',
  [
    // Accept legacy `receivers` (all = To) OR fan-out `recipients` [{..., role:'to'|'cc'|'for'}];
    // a draft may have no recipients. (ATH-119)
    body().custom((_v, { req }) => {
      const list = Array.isArray(req.body.recipients) ? req.body.recipients
                 : Array.isArray(req.body.receivers)  ? req.body.receivers
                 : [];
      if (!req.body.is_draft && list.length === 0) {
        throw new Error('At least one recipient required');
      }
      for (const r of list) {
        if (!r.entity_id && !r.display_name && !r.name && r.self !== true) {
          throw new Error('Each recipient must have entity_id, display_name, name, or self:true');
        }
      }
      return true;
    }),
    body('purpose')
      .optional()
      .trim()
      .isIn(['order','invoice','receipt','inquiry','delivery_note','general'])
      .withMessage('Invalid purpose'),
    body('manual_subject').optional().trim().isLength({ max: 500 }),
    // Per-send copy choice — honoured ONLY on a pure self-chit (see the pureSelfChit branch); ignored elsewhere.
    body('self_copy').optional().isIn(['both', 'sent', 'received']).withMessage('self_copy must be both|sent|received'),
    body('line_items').optional().isArray(),
    body('business_json').optional().isObject(),
  ],
  validate,
  auth,
  async (req, res) => {
    try {
      // Uniform actor model: an actor acts FOR its entity, so the chit is ALWAYS owned by the entity, never the actor.
      // (created_by_actor_id below records WHO pressed send — the only actor-specific bit, for audit.)
      const sender_id = entityId(req);
      let sender_bridge_id = req.identity.bridge_id;
      let sender_display_name = req.identity.display_name;
      if (req.identity.identity_type === 'actor' && req.identity.parent_entity_id) {
        const _ent = await query(`SELECT bridge_id, display_name FROM identities WHERE identity_id = $1`, [sender_id]);
        if (_ent.rows[0]) { sender_bridge_id = _ent.rows[0].bridge_id; sender_display_name = _ent.rows[0].display_name; }
      }
      // Compose panel omits purpose and sends `subject`/`schema_values` — tolerate that shape.
      const purpose = req.body.purpose || 'order';
      const manual_subject = sanitise(req.body.manual_subject || req.body.subject || '');
      const line_items = req.body.line_items || [];
      const business_json = req.body.business_json
        || (req.body.schema_values && Object.keys(req.body.schema_values).length ? { schema_values: req.body.schema_values } : null);
      const is_draft = !!req.body.is_draft;
      // Promote/update a saved draft IN PLACE (same chit_id): Draft stays a draft until sent; sending flips it to
      // Order + fans out to Task. is_draft:true + promote_draft_id => update the draft; is_draft:false => send it.
      const promote_draft_id = (typeof req.body.promote_draft_id === 'string' && req.body.promote_draft_id) ? req.body.promote_draft_id : null;

      // ── Fan-out recipients (ATH-119): To/CC/For. Backward-compatible: legacy `receivers` => all To. ──
      const LIMITS = { to: 5, cc: 5, for: 1, items: 50, attachments: 10 };
      const ROLE_MAP = { to: 'Act', cc: 'Info', for: 'For' };
      const rawList = (Array.isArray(req.body.recipients) ? req.body.recipients
                     : Array.isArray(req.body.receivers)  ? req.body.receivers
                     : []
                    ).map(r => ({ ...r, kind: String(r.role || 'to').toLowerCase() }));

      // Server-side LIMITS re-check — never trust the client (ATH-120).
      const counts = { to: 0, cc: 0, for: 0 };
      for (const r of rawList) {
        if (!(r.kind in counts)) {
          return res.status(400).json({ error: 'Invalid recipient role', message: `role must be to|cc|for, got "${r.kind}"` });
        }
        counts[r.kind]++;
      }
      if (counts.to > LIMITS.to || counts.cc > LIMITS.cc || counts.for > LIMITS.for) {
        return res.status(400).json({ error: 'Limit exceeded', message: `Recipient caps — to:${LIMITS.to}, cc:${LIMITS.cc}, for:${LIMITS.for}` });
      }
      if (line_items.length > LIMITS.items) {
        return res.status(400).json({ error: 'Limit exceeded', message: `Max ${LIMITS.items} line items` });
      }

      // ── Traceability edge (Fragment 1): a doubly-linked, co-held, FROZEN handoff edge that rides in
      //    summary_json.trace. Present ONLY when the sender declares `trace` — normal chits are untouched (every
      //    existing send path behaves exactly as before). HARDENING on the new path: a non-origin handoff MUST carry
      //    >=1 parent chit the sender CO-HOLDS (no silent holes; can't forge an edge to a chit you don't hold). ──
      let traceEdge = null;
      if (req.body.trace && !is_draft) {
        const built = trace.buildEdge(req.body.trace);
        if (built.error) return res.status(400).json({ error: 'Invalid handoff', message: built.error });
        traceEdge = built.edge;
        if (traceEdge && traceEdge.parents.length) {
          const held = await withEntity(sender_id, (db) => db.query(
            `SELECT chit_id FROM chit_header WHERE chit_id = ANY($1::uuid[]) AND entity_id = $2`,
            [traceEdge.parents, sender_id]));
          const heldSet = new Set(held.rows.map((r) => r.chit_id));
          const missing = traceEdge.parents.filter((p) => !heldSet.has(p));
          if (missing.length) return res.status(400).json({ error: 'Invalid handoff', message: `Parent chit not co-held by sender: ${missing.join(', ')}` });
        }
      }

      // Two-copy: the sender's view preference for self-chits (both | sent | received) — exposed via /me.
      const prefRow = await query(`SELECT self_copy_pref FROM identities WHERE identity_id = $1`, [sender_id]);
      const selfCopyPref = prefRow.rows[0]?.self_copy_pref || 'both';
      const makeSelfReceiver = (k) => ({ entity_id: sender_id, bridge_id: sender_bridge_id,
        display_name: sender_display_name, kind: k, role: ROLE_MAP[k], all_role: k === 'to' ? 'receiver' : k });
      let hasSelf = false;

      // Existence check — connection NOT required. Resolve + de-dupe (one row per entity per direction).
      const receiverDetails = [];
      const seen = new Set();
      for (const r of rawList) {
        // Self recipient ("+ Self" or your own name): always create the entity's 'received' (Task)
        // copy here; the 'sent' (Order) copy is the SENDER block below. Two copies, always.
        if (r.self === true || ['self','me'].includes(String(r.name || '').trim().toLowerCase())) {
          if (!hasSelf) receiverDetails.push(makeSelfReceiver(r.kind));
          hasSelf = true;
          continue;
        }
        let rec;
        if (r.entity_id) {
          rec = await query(
            `SELECT identity_id, bridge_id, display_name FROM identities
             WHERE identity_id = $1 AND status = 'active'`,
            [r.entity_id]
          );
        } else if (r.display_name || r.name) {
          rec = await query(
            `SELECT identity_id, bridge_id, display_name FROM identities
             WHERE LOWER(display_name) = LOWER($1) AND status = 'active'
             AND identity_type = 'entity'`,
            [(r.display_name || r.name).trim()]
          );
        }

        if (!rec || rec.rows.length === 0) {
          if (is_draft) {   // a draft is WIP — keep the entered recipient name (unresolved); resolution is enforced only on send
            receiverDetails.push({ entity_id: null, bridge_id: null, display_name: (r.display_name || r.name || '').toString().trim(),
              kind: r.kind, role: ROLE_MAP[r.kind], all_role: r.kind === 'to' ? 'receiver' : r.kind });
            continue;
          }
          return res.status(404).json({
            error: 'Not found',
            message: `Recipient "${r.entity_id || r.display_name || r.name}" not found in the platform`
          });
        }

        const rid = rec.rows[0].identity_id;
        // Resolved to self (you typed your own name): same as "+ Self" — create the received copy.
        if (rid === sender_id) {
          if (!hasSelf) receiverDetails.push(makeSelfReceiver(r.kind));
          hasSelf = true;
          continue;
        }
        if (seen.has(rid)) continue;   // de-dupe external recipients
        seen.add(rid);

        receiverDetails.push({
          entity_id: rid,
          bridge_id: rec.rows[0].bridge_id,
          display_name: rec.rows[0].display_name,
          kind: r.kind,                                   // to | cc | for
          role: ROLE_MAP[r.kind],                         // Act | Info | For (chit_header.role)
          all_role: r.kind === 'to' ? 'receiver' : r.kind // for the all_recipients snapshot
        });
      }

      // ── self_copy_pref (policy-flag #1) — copy suppression is a SELF-CHIT-ONLY affordance. On any inter-entity chit
      //    BOTH copies are mandatory (sender's Order + receiver's Task = the co-held transfer, cb-core-principle), so we
      //    only ever suppress on a PURE self-chit (self is the sole recipient). Every suppression is DECLARED on the chit
      //    via summary_json.copy_policy — the absence is governed + auditable, never a silent gap. ──
      const pureSelfChit = hasSelf && !is_draft && !promote_draft_id && receiverDetails.every(r => r.entity_id === sender_id);
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
      let copyPolicy = null, suppressSentCopy = false;
      if (pureSelfChit) {                          // every self-chit KEEPS its identity (scope:'self') — recorded, not showcased
        if (effSelfCopy === 'sent') {             // ORDER-only → drop the self Task (received) copy
          const si = receiverDetails.findIndex(r => r.entity_id === sender_id);
          if (si >= 0) receiverDetails.splice(si, 1);
          copyPolicy = { scope: 'self', kept: ['sent'], suppressed: ['received'], reason: 'Task copy suppressed — self-chit (Order only)', source: copySource };
        } else if (effSelfCopy === 'received') {  // TASK-only → drop the sender Order (sent) copy
          suppressSentCopy = true;
          copyPolicy = { scope: 'self', kept: ['received'], suppressed: ['sent'], reason: 'Order copy suppressed — self-chit (Task only)', source: copySource };
        } else {                                  // BOTH → keep both copies, but STILL declare the self-chit identity
          copyPolicy = { scope: 'self', kept: ['sent', 'received'], suppressed: [], reason: 'Self-chit — both copies', source: copySource };
        }
      }

      // ── validateSend hook: when promoting a draft, it must be THIS entity's draft. (Baseline/supplier-window
      //    and other send-time rules will plug in here when we build Suppliers.) ──
      if (promote_draft_id) {
        const dchk = await withEntity(sender_id, (db) => db.query(`SELECT role FROM chit_header WHERE chit_id = $1 AND entity_id = $2`, [promote_draft_id, sender_id]));
        if (dchk.rows.length === 0) return res.status(404).json({ error: 'Not found', message: 'Draft not found' });
        if (dchk.rows[0].role !== 'Draft') return res.status(400).json({ error: 'Not a draft', message: 'This chit has already been sent' });
      }
      // Generate chit_id — same for ALL participants (reuse the draft's id when promoting, so the draft BECOMES the order)
      const chit_id = promote_draft_id || uuidv4();
      const now = new Date();

      // Build all_recipients — snapshot with sender + all recipients (with fan-out roles)
      const all_recipients = [
        {
          entity_id: sender_id,
          bridge_id: sender_bridge_id,
          display_name: sender_display_name,
          role: 'sender'
        },
        ...receiverDetails.map(r => ({
          entity_id: r.entity_id, bridge_id: r.bridge_id,
          display_name: r.display_name, role: r.all_role
        }))
      ];

      // ── Operator mandate (Fragment 2): a network handoff names an OPERATOR that is mandated to CO-HOLD the edge
      //    for oversight, so it can walk its whole subtree (visibility ≡ co-holding — no god-view, no BYPASSRLS).
      //    Resolve it here so the participant snapshot lists it; its REDACTED oversight copy (edge only, no
      //    commercial terms — TR-6) is appended alongside the receiver copies below. Additive on the trace path. ──
      let operatorInfo = null;
      if (traceEdge && traceEdge.network && traceEdge.network.operator && !is_draft) {
        const opId = traceEdge.network.operator;
        if (opId !== sender_id && !receiverDetails.some((r) => r.entity_id === opId)) {
          const opRow = await query(`SELECT identity_id, bridge_id, display_name FROM identities WHERE identity_id = $1 AND status = 'active'`, [opId]);
          if (opRow.rows[0]) {
            operatorInfo = opRow.rows[0];
            all_recipients.push({ entity_id: operatorInfo.identity_id, bridge_id: operatorInfo.bridge_id, display_name: operatorInfo.display_name, role: 'operator' });
          }
        }
      }

      // Generate auto subject
      const auto_subject = generateAutoSubject(purpose, sender_display_name, now);

      // Calculate summary from line items
      const summary = calculateSummary(line_items);
      const currency_code = (business_json && business_json.currency) || 'INR';
      // External priority: set by the drafter at compose, immutable once sent (rides on the shared header summary).
      const ext_priority = ['normal','high','urgent'].includes((req.body.external_priority || '').trim()) ? req.body.external_priority.trim() : 'normal';
      // ── chit expiry (Phase 1, NON-DESTRUCTIVE) — record an optional retention/expiry on the chit; nothing auto-retires
      //    or deletes yet (retire = Ph2, purge = Ph3, gated). Migration-free: rides summary_json.retention like copy_policy.
      //    Per-chit override now; the governed DEFAULT lives in the governance channel (backlog), not a Settings toggle. ──
      const DEFAULT_RETENTION_DAYS = null;   // governed default resolves from the cascade later
      let retention = null;
      {
        const rd = (Number.isFinite(+req.body.retention_days) && +req.body.retention_days > 0) ? Math.floor(+req.body.retention_days) : null;
        let exp = null, src = null, days = null;
        if (typeof req.body.expires_at === 'string' && !isNaN(Date.parse(req.body.expires_at))) { exp = new Date(req.body.expires_at).toISOString(); src = 'manual'; }
        else if (rd) { exp = new Date(Date.now() + rd * 86400000).toISOString(); src = 'manual'; days = rd; }
        else if (DEFAULT_RETENTION_DAYS) { exp = new Date(Date.now() + DEFAULT_RETENTION_DAYS * 86400000).toISOString(); src = 'default'; days = DEFAULT_RETENTION_DAYS; }
        if (exp) retention = { expires_at: exp, retention_days: days, source: src };
      }
      // ── assimilation seam: resolve the boilerplate for this send — constitution + capability + pattern + the canonical
      //    SHARED standard (ISO 9000) — and stamp the lineage. Best-effort: never blocks the send. This is the mint
      //    assimilating a per-brand context AND a shared source into one chit (routes send-chit through the seam). ──
      let governed = null;
      try {
        const cfg = await require('../lib/workpattern').resolveWorkPattern('send-chit', { entity_id: sender_id });
        if (cfg) governed = { pattern: cfg._blueprint, capability: cfg._capability, constitution: cfg._constitution, standard: cfg._standard, standards: cfg._standards, boilerplate: cfg._boilerplate };
      } catch (_) { /* seam is best-effort */ }
      // ── ORDER-BINDING: fold the sender's HELD clearances into the chit (per-copy snapshot, FROZEN). The buyer sees, on
      //    THIS order, exactly the supplier's clearances met + their assurance rung; later changes never alter this copy.
      //    Best-effort — never blocks the send. ──
      let folded_clearances = null;
      try {
        const rd = await require('../lib/readiness').resolveReadiness(sender_id);
        const held = (rd.clearances || [])
          .filter(c => c.status === 'gathered' || c.status === 'expiring')
          .map(c => ({ standard: c.standard, doc: c.doc, title: c.title, rung: c.rung,
            valid_until: c.valid_until || null, verified_at: c.verified_at || null, verified_by: c.verified_by || null }));
        if (held.length) folded_clearances = { folded_at: new Date().toISOString(), items: held };
      } catch (_) { /* best-effort */ }
      // ── COMMERCIAL COVER fold — a trade order (one that carries clearances) also freezes its commercial-cover FRAMEWORK
      //    onto the buyer's copy: payment/transit/currency/credit cover by risk, and which is already evidenced on-rail
      //    (e.g. performance risk = the supplier's on-rail track record). Framework, not a secured instrument — honest.
      //    Buyer sees "💳 Commercial cover" beside "🛡 Supplier clearances", frozen. Best-effort — never blocks the send. ──
      let folded_commercial = null;
      try {
        if (folded_clearances) {
          const inc = (summary && summary.incoterm) || 'CIF';
          const ci = require('../lib/instruments').resolveInstruments({ cross_border: 1, incoterm: inc });
          const areas = (ci.cluster || []).map(g => ({ label: g.label, frm_class: g.frm_class,
            on_rail: !!g.covered_onrail, instruments: (g.instruments || []).map(i => i.name) }));
          if (areas.length) folded_commercial = { folded_at: new Date().toISOString(), incoterm: inc, areas };
        }
      } catch (_) { /* best-effort */ }
      /* The whitelist for the provenance rider above. A string field is trimmed and capped; `sender_verified` is
         forced to a real boolean, because "the sender is verified" is a claim that must never arrive as a truthy
         string. Unknown keys are dropped rather than carried. */
      const via = (() => {
        const v = business_json && business_json.via;
        if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
        const str = (x, n) => (x === null || x === undefined || x === '' ? null : String(x).slice(0, n || 120));
        const out = {
          channel: str(v.channel, 24), from: str(v.from, 64), from_name: str(v.from_name, 120),
          to: str(v.to, 64), provider_msg_id: str(v.provider_msg_id, 128), capture_id: str(v.capture_id, 64),
          received_at: str(v.received_at, 40), read_by: str(v.read_by, 40),
          sender_verified: v.sender_verified === true,
          // What they actually wrote, capped — the full text rides as an attachment, not in every copy's summary.
          raw_excerpt: str(v.raw_excerpt, 400),
          media_count: Number.isFinite(+v.media_count) ? Math.max(0, Math.min(20, +v.media_count)) : 0,
          label: str(v.label, 40),
          /* How each line got its price. Re-read key by key rather than spread: the counts must be numbers and the
             lists must be short, whatever a caller sends. */
          priced: (() => {
            const p = v.priced; if (!p || typeof p !== 'object') return undefined;
            const n = (x) => (Number.isFinite(+x) ? Math.max(0, Math.min(999, Math.trunc(+x))) : 0);
            const arr = (a, f) => (Array.isArray(a) ? a.slice(0, 5).map(f) : []);
            return {
              from_catalogue: n(p.from_catalogue), unpriced: n(p.unpriced), catalogue_used: p.catalogue_used !== false,
              ambiguous: arr(p.ambiguous, (x) => ({ name: str(x && x.name, 200), matches: n(x && x.matches) })),
              asked_differs: arr(p.asked_differs, (x) => ({ name: str(x && x.name, 200), asked: +x.asked || 0, ours: +x.ours || 0 })),
            };
          })(),
        };
        return out.channel ? out : null;      // no channel, no provenance — a `via` naming nothing is noise
      })();
      /* ⚠️ The SKELETON comes from lib/mint.js; every rider below is still decided here. mint.summary() adds a rider
         only when it is neither undefined nor null — the same test the conditional spreads made by hand, four
         times, in four files. */
      const summary_json = mint.summary({
        line_item_count: summary.line_item_count,
        total_value: summary.total_value,
        currency_code,
        priority_external: ext_priority,
        purpose,
        is_promotion: !!(business_json && business_json.is_promotion),
        // Forward keeps a reference to the source chit (new thread; content unchanged) so it can be grouped later.
        forwarded_from: (typeof req.body.forwarded_from === 'string' && req.body.forwarded_from.length <= 64) ? req.body.forwarded_from : null,
        copy_policy: copyPolicy,
        retention,
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
        via,
      });

      // ── Freeze-at-send (A10): snapshot the governing schema = sender's active default schema ──
      const schemaRow = await query(
        `SELECT schema_id, schema_version
           FROM entity_schemas
          WHERE entity_id = $1 AND status = 'active' AND is_default = true
          ORDER BY created_at DESC
          LIMIT 1`,
        [sender_id]
      );
      const frozen_schema_id      = schemaRow.rows[0]?.schema_id      || null;
      const frozen_schema_version = schemaRow.rows[0]?.schema_version || null;
      const created_by_actor_id   = req.identity.identity_id;   // who actually pressed send

      // ── Compose the per-participant copies for the delivery layer (SENDER always; RECEIVERS unless draft).
      //    Every copy carries the SAME sender = the caller, which is chit_deliver's isolation gate. ──
      /* ⚠️ SHAPE from lib/mint.js — and ONLY the shape. Everything above this line (recipient resolution, the caps,
         copy_policy, retention, freeze-at-send, the trace edge) is this route's POLICY and has not moved: it is
         engine-locked and is the reference implementation the other three paths were imitating badly. */
      const headerCommon = mint.header({
        sender_entity_id: sender_id, sender_entity_bridge_id: sender_bridge_id,
        sender_entity_display_name: sender_display_name, all_recipients, purpose,
        auto_subject, manual_subject: manual_subject || null, summary_json,
        schema_version: frozen_schema_version, schema_id: frozen_schema_id, created_by_actor_id,
        detail_type: purpose, line_item_count: summary.line_item_count,
        total_value: summary.total_value, currency_code: summary_json.currency_code,
      });
      const mkCopy = (extra) => mint.party(headerCommon, Object.assign({
        // omitted -> SQL NULL (matches legacy): chit_deliver reads c->>'key', for which an absent key and a JSON
        // null are indistinguishable, so passing them conditionally is the same write either way.
        business_json: business_json || undefined,
        line_items: line_items.length > 0 ? line_items : undefined,
      }, extra));
      const copies = suppressSentCopy ? [] : [ mkCopy({
        entity_id: sender_id, direction: 'sent', role: is_draft ? 'Draft' : 'Act',
        current_status: 'delivered', priority_flag: 'normal', payload_delivered: true,
        log: { action: 'created', action_by_identity_id: sender_id, action_by_display_name: sender_display_name,
               new_status: 'delivered', detail: `Chit created and sent to ${receiverDetails.map(r => r.display_name).join(', ')}` },
      }) ];
      if (!is_draft) for (const receiver of receiverDetails) {
        const rcv_status = receiver.kind === 'to' ? 'pending' : 'delivered';   // To acts; CC/For informational
        copies.push(mkCopy({
          entity_id: receiver.entity_id, direction: 'received', role: receiver.role,
          current_status: rcv_status, priority_flag: 'normal',
          log: { action: 'delivered', action_by_identity_id: sender_id, action_by_display_name: sender_display_name,
                 new_status: rcv_status, detail: `Chit received from ${sender_display_name} (${receiver.kind.toUpperCase()})` },
        }));
      }

      // Operator's REDACTED oversight copy — co-holds the EDGE (product/qty/topology) but NOT commercial terms:
      // no business_json, no line_items, total_value nulled. That is TR-6 at write time — the operator physically
      // never holds a rival deal's price, it only holds the traceable edge.
      if (operatorInfo && !is_draft) {
        /* ⚠️ NOT mint.summary() — DELIBERATELY. This is a REDACTED summary, and its whole purpose is to be missing
           keys the real one has. Passing it through the skeleton builder would helpfully restore currency_code and
           total_value, handing the operator the commercial terms this copy exists to withhold. A builder that fills
           in defaults is the wrong tool for a record defined by what it leaves out. */
        const opSummary = { line_item_count: summary_json.line_item_count, purpose: summary_json.purpose, trace: summary_json.trace, oversight: true };
        copies.push(mint.party(headerCommon, {
          summary_json: opSummary, total_value: null,
          entity_id: operatorInfo.identity_id, direction: 'received', role: 'For',
          current_status: 'delivered',
          log: { action: 'oversight', action_by_identity_id: sender_id, action_by_display_name: sender_display_name,
                 new_status: 'delivered', detail: `Network oversight co-hold (edge only) — ${operatorInfo.display_name}` },
        }));
      }

      // ── Guaranteed write: every row for this chit commits together, or none do (INV-2). Delivery is a substrate
      //    op (writes each participant's copy, incl. receivers) -> the b50 SECURITY DEFINER fn chit_deliver, run in
      //    withEntity(sender). Fallback to the legacy in-tx fan-out when b50 isn't applied. ──
      if (await definersReady()) {
        await mint.deliver(sender_id, chit_id, copies, { is_draft: !!promote_draft_id });
      } else {
      await withTransaction(async (client) => {
        if (promote_draft_id) {   // promoting/updating: clear the draft's own rows so this chit re-inserts cleanly under the SAME id
          await client.query('DELETE FROM state_log  WHERE chit_id = $1 AND entity_id = $2', [chit_id, sender_id]);
          await client.query('DELETE FROM chit_detail WHERE chit_id = $1 AND entity_id = $2', [chit_id, sender_id]);
          await client.query('DELETE FROM chit_status WHERE chit_id = $1 AND entity_id = $2', [chit_id, sender_id]);
          await client.query('DELETE FROM chit_header WHERE chit_id = $1 AND entity_id = $2', [chit_id, sender_id]);
        }
        // SENDER (suppressed for a task-only self-chit — no Order copy needed)
        if (!suppressSentCopy) {
        await client.query(
          `INSERT INTO chit_header
           (chit_id, entity_id, sender_entity_id, sender_entity_bridge_id,
            sender_entity_display_name, all_recipients, purpose,
            auto_subject, manual_subject, summary_json, business_json,
            schema_version, schema_id, created_by_actor_id, role, chit_ref, direction, sent_at, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),NOW())`,
          [chit_id, sender_id, sender_id, sender_bridge_id,
           sender_display_name, JSON.stringify(all_recipients), purpose,
           auto_subject, manual_subject || null,
           JSON.stringify(summary_json),
           business_json ? JSON.stringify(business_json) : null,
           frozen_schema_version, frozen_schema_id, created_by_actor_id,
           is_draft ? 'Draft' : 'Act', chit_id, 'sent']
        );
        await client.query(
          `INSERT INTO chit_detail
           (chit_id, entity_id, detail_type, line_item_count,
            total_value, currency_code, line_items, direction, payload_delivered_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
          [chit_id, sender_id, purpose,
           summary.line_item_count, summary.total_value,
           summary_json.currency_code,
           line_items.length > 0 ? JSON.stringify(line_items) : null, 'sent']
        );
        await client.query(
          `INSERT INTO chit_status (chit_id, entity_id, current_status, direction, priority_flag)
           VALUES ($1,$2,'delivered','sent',$3)`,
          [chit_id, sender_id, 'normal']  // internal priority starts normal; each party sets its own (external rides on summary_json)
        );
        await client.query(
          `INSERT INTO state_log
           (chit_id, entity_id, action, action_by_identity_id,
            action_by_display_name, new_status, detail)
           VALUES ($1,$2,'created',$3,$4,'delivered',$5)`,
          [chit_id, sender_id, sender_id, sender_display_name,
           `Chit created and sent to ${receiverDetails.map(r => r.display_name).join(', ')}`]
        );
        }

        // RECIPIENTS (skipped for drafts — a draft is the author's copy only)
        if (!is_draft) for (const receiver of receiverDetails) {
          const rcv_status = receiver.kind === 'to' ? 'pending' : 'delivered'; // To acts; CC/For are informational
          await client.query(
            `INSERT INTO chit_header
             (chit_id, entity_id, sender_entity_id, sender_entity_bridge_id,
              sender_entity_display_name, all_recipients, purpose,
              auto_subject, manual_subject, summary_json, business_json,
              schema_version, schema_id, created_by_actor_id, role, chit_ref, direction, sent_at, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),NOW())`,
            [chit_id, receiver.entity_id, sender_id, sender_bridge_id,
             sender_display_name, JSON.stringify(all_recipients), purpose,
             auto_subject, manual_subject || null,
             JSON.stringify(summary_json),
             business_json ? JSON.stringify(business_json) : null,
             frozen_schema_version, frozen_schema_id, created_by_actor_id,
             receiver.role, chit_id, 'received']
          );
          await client.query(
            `INSERT INTO chit_detail
             (chit_id, entity_id, detail_type, line_item_count,
              total_value, currency_code, line_items, direction)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [chit_id, receiver.entity_id, purpose,
             summary.line_item_count, summary.total_value,
             summary_json.currency_code,
             line_items.length > 0 ? JSON.stringify(line_items) : null, 'received']
          );
          await client.query(
            `INSERT INTO chit_status (chit_id, entity_id, current_status, direction)
             VALUES ($1,$2,$3,'received')`,
            [chit_id, receiver.entity_id, rcv_status]
          );
          await client.query(
            `INSERT INTO state_log
             (chit_id, entity_id, action, action_by_identity_id,
              action_by_display_name, new_status, detail)
             VALUES ($1,$2,'delivered',$3,$4,$5,$6)`,
            [chit_id, receiver.entity_id, sender_id, sender_display_name, rcv_status,
             `Chit received from ${sender_display_name} (${receiver.kind.toUpperCase()})`]
          );
        }
      });
      }

      // ── Best-effort CRM auto-add — AFTER commit; a CRM write must never fail a guaranteed chit (D-065) ──
      // Q4: this post-commit write is OUTSIDE the delivery, so it runs in its OWN withEntity(sender) — customer_list
      // is RLS-scoped on owner_entity_id, so a bare query() would fail closed under FORCE.
      if (!is_draft) for (const receiver of receiverDetails) {
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
        } catch (e) { console.log('customer auto-add skipped:', e.message); }
      }

      // ── Best-effort auto-assign on receipt (D1) — AFTER commit; never fails the guaranteed chit ──
      // Only the actionable 'to' copy is auto-assigned; CC/For stay informational. Each receiver entity
      // resolves against ITS OWN settings/roster (the receiver decides how its inbox auto-assigns).
      if (!is_draft) for (const receiver of receiverDetails) {
        if (receiver.kind !== 'to' || !receiver.entity_id) continue;
        try { await autoAssignReceived(receiver.entity_id, chit_id); }
        catch (e) { console.log('auto-assign skipped:', e.message); }
      }

      res.json({
        message: is_draft ? 'Draft saved' : 'Chit sent successfully',
        chit_id,
        auto_subject,
        is_draft,
        recipients: is_draft ? 0 : receiverDetails.length,
        fan_out: { to: counts.to, cc: counts.cc, for: counts.for },
        summary: summary_json
      });

    } catch (err) {
      console.error('Send chit error:', err.message);
      res.status(500).json({ error: 'Send failed', message: safeErr(err) });
    }
  }
);

// ─── GET /chits/inbox ─────────────────────────────────────────
// Lightweight inbox — my chit_status only — fast
// GET /chits/sent — chits I sent (my sender copy), newest first, paginated.
// Mounted BEFORE /:chit_id so "sent" is never parsed as a chit_id.
// Advanced-search filters shared by the chit lists: amount range, date range, priority, status bucket.
// All parameterised (no injection). Used by /inbox, /sent, /folder. (Criteria set can become schema-driven later.)
function chitFilters(req, where, params){
  /**
   * ⚠️ A FOLDER IS A FILTER ON THIS LIST, NOT A SECOND SCREEN. Athi, 2026-08-10: *"we just pass the parameter as
   * folder name and filter data accordingly, so the same panel works for each folder."*
   *
   * It lives in the SHARED filter builder so Task and Order both get it from one line — a folder under Order is
   * the Order list filtered, exactly as a folder under Task is the Task list filtered. Putting it in each route
   * separately is how the two would drift.
   */
  const fid = String(req.query.folder_id || '').trim();
  if (/^[0-9a-f-]{36}$/i.test(fid)) { params.push(fid); where += ` AND cs.folder_id = $${params.length}::uuid`; }
  const num = v => { const n = parseFloat(v); return isFinite(n) ? n : null; };
  const amin = num(req.query.amount_min), amax = num(req.query.amount_max);
  if (amin !== null) { params.push(amin); where += ` AND COALESCE((ch.summary_json->>'total_value')::numeric,0) >= $${params.length}`; }
  if (amax !== null) { params.push(amax); where += ` AND COALESCE((ch.summary_json->>'total_value')::numeric,0) <= $${params.length}`; }
  if (req.query.date_from) { params.push(req.query.date_from); where += ` AND ch.created_at >= $${params.length}::timestamptz`; }
  if (req.query.date_to)   { params.push(req.query.date_to);   where += ` AND ch.created_at < ($${params.length}::date + interval '1 day')`; }
  if (req.query.priority)  { params.push(req.query.priority);  where += ` AND cs.priority_flag = $${params.length}`; }
  if (req.query.fstatus)   {
    const B = { open:['pending','delivered','read'], act:['accepted','in_progress','partial'], close:['completed','cancelled','rejected'] };
    const L = B[req.query.fstatus] || [req.query.fstatus];
    const ph = L.map(s => { params.push(s); return '$'+params.length; }).join(',');
    where += ` AND cs.current_status IN (${ph})`;
  }
  // Delegation scope: unassigned = the entity's own pool; assigned = delegated to a co-assist. assigned_to=me|<id>
  // scopes to one actor (fixes actor "My Task"). No param = everything (back-compat).
  if (req.query.assignment === 'unassigned')      where += ` AND cs.assigned_to_actor_id IS NULL`;
  else if (req.query.assignment === 'assigned')   where += ` AND cs.assigned_to_actor_id IS NOT NULL`;
  const at = req.query.assigned_to;
  if (at === 'me')                            { params.push(req.identity.identity_id); where += ` AND cs.assigned_to_actor_id = $${params.length}`; }
  else if (at && at !== 'me' && at !== 'all') { params.push(at); where += ` AND cs.assigned_to_actor_id = $${params.length}`; }
  // D4: dispute filter — chits with an OPEN dispute THIS entity holds a copy of (per-copy: RLS scopes to my own copies).
  if (req.query.dispute === 'open' || req.query.dispute === 'active') {
    where += ` AND EXISTS (SELECT 1 FROM chit_disputes cd WHERE cd.chit_id = ch.chit_id AND cd.status = 'open')`;
  }
  return where;
}

router.get('/sent', auth, async (req, res) => {
  try {
    const entity_id = entityId(req);
    const page   = parseInt(req.query.page || 1);
    const limit  = parseInt(req.query.limit || 20);
    const offset = (page - 1) * limit;
    const q_search = (req.query.q || '').trim();

    // search across the header data (subject, recipients, purpose). pg_trgm GIN index recommended at scale.
    const params = [entity_id];
    let where = `ch.entity_id = $1 AND ch.direction = 'sent' AND ch.role <> 'Draft' AND cs.deleted_at IS NULL AND cs.archived_at IS NULL`;
    if (q_search) {
      params.push('%' + q_search + '%');
      where += ` AND (ch.manual_subject ILIKE $${params.length} OR ch.auto_subject ILIKE $${params.length} OR ch.all_recipients::text ILIKE $${params.length} OR ch.purpose ILIKE $${params.length})`;
    }
    const joinFrom = `FROM chit_header ch
         JOIN chit_status cs ON cs.chit_id = ch.chit_id AND cs.entity_id = ch.entity_id AND cs.direction = ch.direction`;

    where = chitFilters(req, where, params);
    // B1 RLS: caller reads only its own entity_id rows -> run inside withEntity(me).
    const { countResult, result } = await withEntity(entity_id, async (db) => {
    const countResult = await db.query(`SELECT COUNT(*) ${joinFrom} WHERE ${where}`, params);

    const limIdx = params.length + 1, offIdx = params.length + 2;
    const result = await db.query(
      `SELECT ch.chit_id, ch.all_recipients, ch.purpose, ch.auto_subject, ch.manual_subject,
              ch.summary_json, ch.created_at, ch.role,
              cs.current_status, cs.priority_flag, cs.customer_priority, cs.star_flag,
              (SELECT COUNT(*) FROM chit_disputes cd
                WHERE cd.chit_id = ch.chit_id AND cd.status = 'open') AS open_dispute_count,
              (SELECT COUNT(*) FROM chit_disputes cd
                WHERE cd.chit_id = ch.chit_id AND cd.status = 'resolved') AS resolved_dispute_count
         ${joinFrom}
        WHERE ${where}
        ORDER BY ${({date:'ch.created_at',subject:'COALESCE(ch.manual_subject, ch.auto_subject)',from:"(ch.all_recipients->1->>'display_name')",amount:"(ch.summary_json->>'total_value')::numeric",status:'cs.current_status',priority:"CASE cs.priority_flag WHEN 'urgent' THEN 3 WHEN 'high' THEN 2 WHEN 'normal' THEN 1 ELSE 0 END",priority_ext:"CASE ch.summary_json->>'priority_external' WHEN 'urgent' THEN 3 WHEN 'high' THEN 2 WHEN 'normal' THEN 1 ELSE 0 END"}[req.query.sort]||'ch.created_at')} ${(String(req.query.dir||'').toLowerCase()==='asc')?'ASC':'DESC'}, ch.created_at DESC
        LIMIT $${limIdx} OFFSET $${offIdx}`,
      [...params, limit, offset]
    );
    return { countResult, result };
    });

    res.json({ chits: result.rows, total: parseInt(countResult.rows[0].count), page, limit });
  } catch (err) {
    console.error('Sent list error:', err.message);
    res.status(500).json({ error: 'Failed to get sent items', message: safeErr(err) });
  }
});

// GET /chits/folder?view=drafts|trash|archive — mailbox folders (both directions), paginated + searchable + sortable.
// Mounted BEFORE /:chit_id so "folder" is never parsed as a chit_id.
router.get('/folder', auth, async (req, res) => {
  try {
    const entity_id = entityId(req);
    const page   = parseInt(req.query.page || 1);
    const limit  = parseInt(req.query.limit || 20);
    const offset = (page - 1) * limit;
    const view   = req.query.view || 'drafts';
    const q_search = (req.query.q || '').trim();

    const params = [entity_id];
    let where = `cs.entity_id = $1`;
    if (view === 'trash')        where += ` AND cs.deleted_at IS NOT NULL`;
    else if (view === 'archive') where += ` AND cs.archived_at IS NOT NULL AND cs.deleted_at IS NULL`;
    else {                       where += ` AND ch.role = 'Draft' AND cs.deleted_at IS NULL`;   // drafts
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
    const { countResult, result } = await withEntity(entity_id, async (db) => {
    const countResult = await db.query(`SELECT COUNT(DISTINCT ch.chit_id) ${joinFrom} WHERE ${where}`, params);

    const orderBy = ({date:'created_at',subject:'COALESCE(manual_subject, auto_subject)',amount:"(summary_json->>'total_value')::numeric",status:'current_status',priority:"CASE priority_flag WHEN 'urgent' THEN 3 WHEN 'high' THEN 2 WHEN 'normal' THEN 1 ELSE 0 END",priority_ext:"CASE summary_json->>'priority_external' WHEN 'urgent' THEN 3 WHEN 'high' THEN 2 WHEN 'normal' THEN 1 ELSE 0 END"}[req.query.sort] || 'created_at')
                  + ' ' + ((String(req.query.dir||'').toLowerCase()==='asc') ? 'ASC' : 'DESC');
    const result = await db.query(
      `SELECT * FROM (
         SELECT DISTINCT ON (ch.chit_id)
              ch.chit_id, ch.sender_entity_display_name, ch.sender_entity_bridge_id, ch.all_recipients,
              ch.purpose, ch.auto_subject, ch.manual_subject, ch.summary_json, ch.created_at,
              cs.current_status, cs.read_at, cs.star_flag, cs.priority_flag, cs.deleted_at, cs.archived_at, ch.direction,
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
    return { countResult, result };
    });
    res.json({ chits: result.rows, total: parseInt(countResult.rows[0].count), page, limit, view });
  } catch (err) {
    console.error('Folder error:', err.message);
    res.status(500).json({ error: 'Failed to get folder', message: safeErr(err) });
  }
});

// GET /chits/rollup?group_by=counterparty|state — read-only grouped summary over MY chits.
// No merge, no new chit, the seal is untouched. Mounted BEFORE /:chit_id.
router.get('/rollup', auth, async (req, res) => {
  try {
    const entity_id = entityId(req);
    const groupBy = (req.query.group_by === 'state') ? 'state' : 'counterparty';
    const keyExpr = groupBy === 'state' ? 'cs.current_status' : 'ch.sender_entity_display_name';
    // direction scopes the rollup to Task (received) or Order (sent); omit for both. Without it, self-chits
    // (sent+received held by one entity) would double-count.
    const dir = (req.query.direction === 'sent' || req.query.direction === 'received') ? req.query.direction : null;
    const params = [entity_id];
    let where = `cs.entity_id = $1 AND cs.deleted_at IS NULL AND cs.archived_at IS NULL`;
    if (dir) { params.push(dir); where += ` AND cs.direction = $${params.length}`; }
    if (req.query.assignment === 'unassigned')      where += ` AND cs.assigned_to_actor_id IS NULL`;
    else if (req.query.assignment === 'assigned')   where += ` AND cs.assigned_to_actor_id IS NOT NULL`;
    else if (req.query.assigned_to === 'me')        { params.push(req.identity.identity_id); where += ` AND cs.assigned_to_actor_id = $${params.length}`; }
    // B1 RLS: caller reads only its own entity_id rows -> run inside withEntity(me).
    const { result, disp } = await withEntity(entity_id, async (db) => {
    const result = await db.query(
      `SELECT ${keyExpr} AS key, COUNT(*)::int AS chits,
              COALESCE(SUM((ch.summary_json->>'total_value')::numeric), 0) AS total_value
         FROM chit_status cs
         JOIN chit_header ch ON ch.chit_id = cs.chit_id AND ch.entity_id = cs.entity_id AND ch.direction = cs.direction
        WHERE ${where}
        GROUP BY ${keyExpr}
        ORDER BY chits DESC`,
      params
    );
    // D4: open-dispute count for the same scope — powers the "Disputes (n)" filter in the task menu.
    // Guarded so a pre-migration DB (no dispute tables) simply reports 0 rather than failing the rollup.
    const disp = await db.query(
      `SELECT COUNT(DISTINCT cs.chit_id)::int AS n
         FROM chit_status cs
        WHERE ${where}
          AND EXISTS (SELECT 1 FROM chit_disputes cd WHERE cd.chit_id = cs.chit_id AND cd.status = 'open')`,
      params).catch(() => ({ rows: [{ n: 0 }] }));
    return { result, disp };
    });
    res.json({ group_by: groupBy, direction: dir, groups: result.rows, dispute_open: disp.rows[0].n });
  } catch (err) {
    console.error('Rollup error:', err.message);
    res.status(500).json({ error: 'Rollup failed', message: safeErr(err) });
  }
});

router.get('/inbox', auth, async (req, res) => {
  try {
    // Actors query their parent entity's inbox (chit_status is entity-keyed)
    const entity_id = entityId(req);
    const page = parseInt(req.query.page || 1);
    const limit = parseInt(req.query.limit || 20);
    const offset = (page - 1) * limit;
    const status_filter = req.query.status || null;
    const q_search = (req.query.q || '').trim();

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
      if (/^[0-9a-f-]{36}$/i.test(fid)) { paramCount++; whereClause += ` AND cs.folder_id = $${paramCount}::uuid`; params.push(fid); }
      else whereClause += ` AND cs.folder_id IS NULL`;
    }

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
    paramCount = params.length;
    // B1 RLS: caller reads only its own entity_id rows -> run inside withEntity(me).
    const { countResult, result } = await withEntity(entity_id, async (db) => {
    const countResult = await db.query(
      `SELECT COUNT(*) FROM chit_status cs
        JOIN chit_header ch ON ch.chit_id = cs.chit_id AND ch.entity_id = cs.entity_id AND ch.direction = cs.direction
        WHERE ${whereClause}`,
      params
    );

    // Get inbox — lightweight — no payload
    const result = await db.query(
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
          ORDER BY sl.created_at ASC LIMIT 1) AS placed_by_type
       FROM chit_status cs
       JOIN chit_header ch ON ch.chit_id = cs.chit_id
                          AND ch.entity_id = cs.entity_id
                          AND ch.direction = cs.direction
       WHERE ${whereClause}
       ORDER BY ${({date:'ch.created_at',subject:'COALESCE(ch.manual_subject, ch.auto_subject)',from:'ch.sender_entity_display_name',amount:"(ch.summary_json->>'total_value')::numeric",status:'cs.current_status',priority:"CASE cs.priority_flag WHEN 'urgent' THEN 3 WHEN 'high' THEN 2 WHEN 'normal' THEN 1 ELSE 0 END",priority_ext:"CASE ch.summary_json->>'priority_external' WHEN 'urgent' THEN 3 WHEN 'high' THEN 2 WHEN 'normal' THEN 1 ELSE 0 END"}[req.query.sort]||'ch.created_at')} ${(String(req.query.dir||'').toLowerCase()==='asc')?'ASC':'DESC'}, ch.created_at DESC
       LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`,
      [...params, limit, offset]
    );
    return { countResult, result };
    });

    res.json({
      chits: result.rows,
      // top-level total/page/limit — mirrors /sent so the web pager treats both lists the same
      total: parseInt(countResult.rows[0].count),
      page,
      limit,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        page,
        limit,
        pages: Math.ceil(countResult.rows[0].count / limit)
      }
    });

  } catch (err) {
    console.error('Inbox error:', err.message);
    res.status(500).json({ error: 'Failed to get inbox', message: safeErr(err) });
  }
});

// ─── GET /chits/:chit_id ──────────────────────────────────────
// Full chit detail — all participants, full state log, line items
// GET /chits/unread — chit_ids that are unread FOR THE CALLING ACTOR (per-actor read state).
// Unread = no chit_reads row yet, or the copy changed (cs.updated_at) after the actor last opened it.
// Entity (non-actor) logins get [] — they use the entity-level read_at. Mounted BEFORE /:chit_id.
router.get('/unread', auth, async (req, res) => {
  try {
    if (req.identity.identity_type !== 'actor') return res.json({ unread: [] });
    const entity_id = entityId(req);
    const actor_id  = req.identity.identity_id;
    // B1 RLS: caller reads only its own entity_id rows -> run inside withEntity(me).
    const r = await withEntity(entity_id, (db) => db.query(
      `SELECT DISTINCT cs.chit_id
         FROM chit_status cs
         LEFT JOIN chit_reads cr ON cr.chit_id = cs.chit_id AND cr.actor_id = $2
        WHERE cs.entity_id = $1 AND cs.deleted_at IS NULL
          AND (cr.read_at IS NULL OR cs.updated_at > cr.read_at)`,
      [entity_id, actor_id]));
    res.json({ unread: r.rows.map(x => x.chit_id) });
  } catch (err) { res.status(500).json({ error: 'Unread failed', message: safeErr(err) }); }
});

router.get('/:chit_id', auth, async (req, res) => {
  try {
    const chit_id = req.params.chit_id;
    // Actors use parent entity's id — chit_header and chit_status are entity-keyed
    const entity_id = entityId(req);

    // B1 RLS: everything here is the caller's OWN copy -> withEntity(me).
    const data = await withEntity(entity_id, async (db) => {
      // Verify entity participates in this chit
      const participation = await db.query(
        `SELECT role, created_by_actor_id FROM chit_header
         WHERE chit_id = $1 AND entity_id = $2`,
        [chit_id, entity_id]
      );
      if (participation.rows.length === 0) return { notFound: true };
      // Draft privacy: a draft is the author's PRIVATE WIP — another actor of the SAME entity must not read it,
      // even by direct id. The drafts LIST is author-scoped (created_by_actor_id); the detail read must be too.
      const _draft = participation.rows.find(r => r.role === 'Draft');
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
            [chit_id, req.identity.identity_id]);
          await db.query('RELEASE SAVEPOINT mark_read');
        } catch (e) {
          console.error('mark-read skipped:', e.message);
          try { await db.query('ROLLBACK TO SAVEPOINT mark_read'); } catch (_) {}
        }
      }

      // Get my header
      const header = await db.query(
        `SELECT * FROM chit_header
         WHERE chit_id = $1 AND entity_id = $2`,
        [chit_id, entity_id]
      );

      // Get my detail — line items if still present
      const detail = await db.query(
        `SELECT detail_type, line_item_count, total_value, currency_code,
                line_items, payload_delivered_at, payload_deleted_at
         FROM chit_detail
         WHERE chit_id = $1 AND entity_id = $2`,
        [chit_id, entity_id]
      );

      // Each participant has their own copy (entity_id = their entity).
      const log = await db.query(
        `SELECT action, action_by_display_name, previous_status,
                new_status, detail, created_at
         FROM state_log
         WHERE chit_id = $1 AND entity_id = $2 AND action != 'read'
         ORDER BY created_at ASC`,
        [chit_id, entity_id]
      );

      // Check if first time reading (before update) to decide whether to log it
      const preCheck = await db.query(
        `SELECT read_at FROM chit_status WHERE chit_id = $1 AND entity_id = $2`,
        [chit_id, entity_id]
      );
      const wasUnread = !preCheck.rows[0]?.read_at;

      // Update read_at FIRST so the participants panel reflects this read
      await db.query(
        `UPDATE chit_status
         SET read_at = NOW()
         WHERE chit_id = $1 AND entity_id = $2`,
        [chit_id, entity_id]
      );

      if (wasUnread) {
        await db.query(
          `INSERT INTO state_log
           (chit_id, entity_id, action, action_by_identity_id,
            action_by_display_name, detail)
           VALUES ($1,$2,'read',$3,$4,'Chit opened and read')`,
          [chit_id, entity_id, entity_id, req.identity.display_name]
        );
      }
      return { header, detail, log };
    });

    if (data.notFound) {
      return res.status(404).json({
        error: 'Not found',
        message: 'Chit not found or you do not have access'
      });
    }

    // Participants panel = a deliberate CROSS-entity read (who has read/accepted). Under RLS it is served by the
    // b50 SECURITY DEFINER fn chit_participants (validates caller is a participant, then crosses). Fallback to the
    // direct join when the delivery layer (b50) isn't applied yet, so the page works before/after the migration;
    // under FORCE without the fn the fallback scopes to self (degraded panel, never a leak).
    let participants;
    try {
      const ps = await withEntity(entity_id, (db) => db.query(`SELECT * FROM chit_participants($1)`, [chit_id]));
      participants = ps.rows;
    } catch (e) {
      if (e && (e.code === '42883' || /chit_participants/.test(e.message || ''))) {
        const ps = await withEntity(entity_id, (db) => db.query(
          `SELECT cs.entity_id, cs.current_status, cs.read_at,
                  cs.assigned_to_actor_display_name, cs.updated_at,
                  i.display_name, i.bridge_id
           FROM chit_status cs
           JOIN identities i ON i.identity_id = cs.entity_id
           WHERE cs.chit_id = $1`,
          [chit_id]));
        participants = ps.rows;
      } else throw e;
    }

    const attachments = await storage.listForChit(chit_id, entity_id).catch(() => []);   // per-entity: the caller's OWN copies only
    res.json({
      header: data.header.rows[0],
      detail: data.detail.rows[0] || null,
      participants,
      state_log: data.log.rows,
      attachments
    });

  } catch (err) {
    console.error('Chit detail error:', err.message);
    res.status(500).json({ error: 'Failed to get chit', message: safeErr(err) });
  }
});

// ─── PUT /chits/:chit_id/status ───────────────────────────────
// Update chit status — accept, reject, complete etc
router.put('/:chit_id/status',
  [
    body('status')
      .trim()
      .isIn(['pending','accepted','rejected','in_progress','partial','completed','cancelled'])
      .withMessage('Invalid status'),
    body('note').optional().trim().isLength({ max: 500 }),
  ],
  validate,
  auth,
  async (req, res) => {
    try {
      const chit_id      = req.params.chit_id;
      // entity_id   = participant entity context (parent for actors, self for entities)
      // action_by_* = whoever is performing — entity admin or actor, never remapped
      const entity_id    = entityId(req);
      const action_by_id   = req.identity.identity_id;
      const action_by_name = req.identity.display_name;
      const new_status = req.body.status;
      const note = sanitise(req.body.note || '');

      // Get current status
      // B1 RLS: own received-copy read -> withEntity(me).
      const current = await withEntity(entity_id, (db) => db.query(
        `SELECT current_status FROM chit_status
         WHERE chit_id = $1 AND entity_id = $2 AND direction = 'received'`,
        [chit_id, entity_id]
      ));

      if (current.rows.length === 0) {
        return res.status(404).json({
          error: 'Not found',
          message: 'Chit not found'
        });
      }

      const previous_status = current.rows[0].current_status;

      // Idempotent: advancing to the status it's already in is a no-op success (not a 400).
      // Fixes the "Cannot move from accepted to accepted" error when a self-chit's displayed copy diverges. (E — symptom fix; direction-scoping still backlog.)
      if (new_status === previous_status) {
        return res.json({ message: `Already ${new_status}`, chit_id, status: new_status, noop: true });
      }

      // Validate state transitions
      // Arrow model: Open(pending/delivered/read) → in_progress → completed
      // ← regress: in_progress/accepted → pending, completed → in_progress
      // Legacy accepted step kept for backward compat (ChitDetailPage still uses it)
      // 3-state UI model (Open / Act / Close) is bidirectional: from any state you can reach any of the three
      // canonical targets — pending (Open), in_progress (Act), completed (Close). Sub-statuses kept for compat.
      const validTransitions = {
        'pending':     ['in_progress', 'completed', 'accepted', 'rejected', 'cancelled'],
        'delivered':   ['in_progress', 'completed', 'accepted', 'rejected', 'cancelled', 'pending'],
        'read':        ['in_progress', 'completed', 'accepted', 'rejected', 'cancelled', 'pending'],
        'accepted':    ['in_progress', 'completed', 'pending', 'rejected', 'cancelled'],
        'in_progress': ['partial', 'completed', 'pending', 'accepted', 'cancelled'],
        'partial':     ['in_progress', 'completed', 'pending', 'cancelled'],
        'completed':   ['in_progress', 'pending'],
        'rejected':    ['accepted', 'pending', 'in_progress', 'completed'],
        'cancelled':   ['accepted', 'pending', 'in_progress', 'completed'],
      };

      const allowed = validTransitions[previous_status] || [];
      if (!allowed.includes(new_status)) {
        return res.status(400).json({
          error: 'Invalid transition',
          message: `Cannot move from ${previous_status} to ${new_status}`,
          allowed_transitions: allowed
        });
      }

      // C1 (per Athi 2026-07-05): closing a DISPUTED chit (completed/cancelled) is ALLOWED, but we WARN + record WHO did it
      // (surfaced to the UI + written to the timeline). Archive/delete still hard-block — a separate, stricter rule.
      let disputeWarning = null;
      if (new_status === 'completed' || new_status === 'cancelled') {
        const openD = await withEntity(entity_id, (db) => db.query(`SELECT COUNT(*)::int AS count FROM chit_disputes WHERE chit_id = $1 AND status = 'open'`,
          [chit_id])).catch(() => ({ rows: [{ count: 0 }] }));   // per-copy: my own open dispute copies
        if (openD.rows[0].count > 0) disputeWarning = `Chit closed with an OPEN dispute — by ${action_by_name}.`;
      }

      // Update chit_status — the caller's OWN received copy.
      await withEntity(entity_id, (db) => db.query(
        `UPDATE chit_status
         SET current_status = $1, updated_at = NOW()
         WHERE chit_id = $2 AND entity_id = $3 AND direction = 'received'`,
        [new_status, chit_id, entity_id]
      ));

      // One log row per participant — a CROSS-entity write, so via the b50 delivery-agent fn chit_log_all
      // (validated: caller must be a participant). Fallback = the legacy INSERT...SELECT when b50 isn't applied.
      const detail = (note ||
        `Status changed from ${previous_status} to ${new_status} by ${action_by_name}`)
        + (disputeWarning ? ` ⚠ ${disputeWarning}` : '');

      await crossing(entity_id,
        `SELECT chit_log_all($1,$2,$3,$4,$5,$6,$7)`,
        [chit_id, `status_${new_status}`, action_by_id, action_by_name, previous_status, new_status, detail],
        (db) => db.query(
          `INSERT INTO state_log
           (chit_id, entity_id, action, action_by_identity_id,
            action_by_display_name, previous_status, new_status, detail)
           SELECT $1, entity_id, $2, $3, $4, $5, $6, $7
           FROM (SELECT DISTINCT entity_id FROM chit_status WHERE chit_id = $1) cs`,
          [chit_id, `status_${new_status}`, action_by_id, action_by_name, previous_status, new_status, detail]));

      // Get header to check sender and propagate cancellation to receivers (own copy).
      const header = await withEntity(entity_id, (db) => db.query(
        `SELECT sender_entity_id FROM chit_header
         WHERE chit_id = $1 AND entity_id = $2`,
        [chit_id, entity_id]
      ));

      const isSender = header.rows.length > 0 &&
                       header.rows[0].sender_entity_id === entity_id;

      // Sender cancel = a REQUEST, never a cross-entity write (Athi): the sender cancels ITS OWN copy and delivers a
      // flagged "[cancel requested]" message to the recipients; each recipient cancels its own copy at its own will.
      if (isSender && new_status === 'cancelled') {
        await withEntity(entity_id, (db) => db.query(
          `UPDATE chit_status SET current_status = 'cancelled', updated_at = NOW() WHERE chit_id = $1 AND entity_id = $2`,
          [chit_id, entity_id]));   // own copy only
        await postMessageCopies({ chit_id, sender_entity_id: entity_id, sender_display_name: action_by_name,
          thread_type: 'external', msg_type: 'action',
          message_text: `[cancel requested] ${note || 'The sender has cancelled and requests you cancel your copy.'}` });
      }

      res.json({
        message: `Chit ${new_status}`,
        warning: disputeWarning,   // C1: set when a disputed chit was closed anyway (UI shows who + that it was open)
        chit_id,
        previous_status,
        new_status
      });

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
          .catch(() => {});
      } catch (_) { /* outbound is never allowed to affect the status change */ }

    } catch (err) {
      console.error('Update status error:', err.message);
      res.status(500).json({ error: 'Update failed', message: safeErr(err) });
    }
  }
);

// ─────────────────────────────────────────────────────────────
// B3.5 — MESSAGING (dual thread) and DISPUTE MODULE
// ─────────────────────────────────────────────────────────────

// ─── POST /chits/:chit_id/messages ───────────────────────────
// thread_type: 'external' (all parties see) | 'internal' (sender entity only)
// ── b67: post a message as PER-ENTITY copies via the SECURITY DEFINER deliver fn (audience computed server-side:
//   internal → author only · external → all chit participants · dispute → the dispute roster). One logical message_id,
//   replicated per audience entity; reads are RLS-scoped to "my own copies". Pass a tx `db` client to stay atomic.
async function postMessageCopies(msg, db) {
  const message_id = uuidv4();
  // ROOT FIX (reviewer 2026-07-13): the deliver definer must run with the sender's TRUSTED context set, so it can
  // verify the claimed sender = the caller (b50 pattern) instead of trusting the parameter. When no tx client is
  // passed, establish withEntity(sender) here (all callers pass sender = their authenticated entity_id).
  const call = (runner) => runner(
    `SELECT chit_message_deliver($1,$2,$3,$4,$5,$6,$7,$8,$9) AS created_at`,
    [message_id, msg.chit_id, msg.sender_entity_id, msg.sender_display_name || null,
     msg.thread_type, msg.message_text, msg.msg_type || 'info', !!msg.is_dispute, msg.dispute_id || null]);
  const r = db ? await call((t, p) => db.query(t, p))
              : await withEntity(msg.sender_entity_id, (c) => call((t, p) => c.query(t, p)));
  return { message_id, created_at: r.rows[0] && r.rows[0].created_at };
}

router.post('/:chit_id/messages',
  [
    body('message_text').trim().notEmpty().withMessage('Message text required'),
    body('thread_type').isIn(['external','internal']).withMessage('thread_type must be external or internal'),
    body('is_dispute').optional().isBoolean(),
    body('dispute_id').optional({ nullable:true }).isUUID(),
  ],
  validate,
  auth,
  async (req, res) => {
    const { chit_id }  = req.params;
    const { message_text, thread_type } = req.body;
    const entity_id    = entityId(req);
    const display_name = req.identity.display_name;

    try {
      // B1 RLS: participant access check on own copy -> withEntity(me).
      const access = await withEntity(entity_id, (db) => db.query(
        `SELECT entity_id FROM chit_status WHERE chit_id = $1 AND entity_id = $2`,
        [chit_id, entity_id]
      ));
      if (access.rows.length === 0) {
        return res.status(403).json({ error: 'Forbidden', message: 'Not a participant on this chit' });
      }

      // D4: dispute-tagged message — stays filterable in the thread even after the dispute resolves.
      const isDispute = req.body.is_dispute === true || req.body.is_dispute === 'true';
      const disputeId = req.body.dispute_id || null;
      // M1 (reviewer 2026-07-13) — a dispute message needs MORE than chit-participation: the sender must be a PARTY to
      // THIS dispute, and the dispute must belong to THIS chit. RLS makes it one query — under withEntity(sender) the
      // policy returns only the sender's OWN chit_disputes copy, so a returned row proves BOTH roster membership AND
      // chit-ownership. No row → 403 (blocks non-party injection AND cross-chit dispute_id injection via the definer).
      if (isDispute && disputeId) {
        const party = await withEntity(entity_id, (db) => db.query(
          `SELECT 1 FROM chit_disputes WHERE dispute_id = $1 AND chit_id = $2 LIMIT 1`, [disputeId, chit_id]));
        if (party.rows.length === 0) {
          return res.status(403).json({ error: 'Forbidden', message: 'Not a party to this dispute' });
        }
      }
      // B3 (Athi): a DISPUTE message posts in the ENTITY's name (the acting actor stays as provenance in the timeline).
      let senderName = display_name;
      if (isDispute && req.identity.parent_entity_id) {
        const _e = await query('SELECT display_name FROM identities WHERE identity_id = $1', [entity_id]).catch(() => ({ rows: [] }));
        if (_e.rows[0] && _e.rows[0].display_name) senderName = _e.rows[0].display_name;
      }

      // PER-ENTITY copies (b67): replicate the message to its audience (internal=author · external=all · dispute=roster).
      const result = await postMessageCopies({ chit_id, sender_entity_id: entity_id, sender_display_name: senderName,
        thread_type, message_text, msg_type: req.body.msg_type, is_dispute: isDispute, dispute_id: disputeId });

      // Log external messages into every participant's timeline — a CROSS-entity write, via chit_log_all
      // (validated: caller must be a participant). Fallback = the legacy per-participant loop when b50 isn't applied.
      if (thread_type === 'external') {
        await crossing(entity_id,
          `SELECT chit_log_all($1,$2,$3,$4,$5,$6,$7)`,
          [chit_id, 'message_sent', entity_id, display_name, null, null, message_text.slice(0, 100)],
          async (db) => {
            // DISTINCT entity: a self-chit has two copies under one entity — log once per entity, not per copy.
            const participants = await db.query(
              `SELECT DISTINCT entity_id FROM chit_status WHERE chit_id = $1`, [chit_id]);
            for (const p of participants.rows) {
              await db.query(
                `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail)
                 VALUES ($1, $2, 'message_sent', $3, $4, $5)`,
                [chit_id, p.entity_id, entity_id, display_name, message_text.slice(0, 100)]);
            }
          });
      }

      res.json({
        message_id:           result.message_id,
        thread_type,
        message_text,
        sender_display_name:  display_name,
        created_at:           result.created_at,
      });
    } catch (err) {
      console.error('Send message error:', err.message);
      res.status(500).json({ error: 'Send message failed', message: safeErr(err) });
    }
  }
);

// ─── GET /chits/:chit_id/messages ────────────────────────────
// thread_type query: 'all' | 'external' | 'internal'
router.get('/:chit_id/messages', auth, async (req, res) => {
  const { chit_id }   = req.params;
  const entity_id     = entityId(req);
  const thread_filter = req.query.thread_type || 'all';

  try {
    // PER-ENTITY (b67): everything runs inside withEntity(me). RLS returns ONLY my own message copies — a row
    // exists for me only if I was in its audience (internal=author · external=all · dispute=roster). So the old
    // cross-entity visibility logic is gone; the filter is just by thread_type on my own rows.
    const result = await withEntity(entity_id, async (db) => {
      const access = await db.query(`SELECT 1 FROM chit_status WHERE chit_id = $1 AND entity_id = $2 LIMIT 1`, [chit_id, entity_id]);
      if (access.rows.length === 0) return null;   // not a participant
      let cond = '';
      if (thread_filter === 'internal')      cond = ` AND COALESCE(is_dispute,false)=false AND thread_type='internal'`;
      else if (thread_filter === 'external') cond = ` AND ((COALESCE(is_dispute,false)=false AND thread_type='external') OR is_dispute=true)`;
      if (req.query.dispute === '1' || req.query.dispute === 'true') cond += ` AND is_dispute = true`;
      return db.query(`SELECT * FROM chit_messages WHERE chit_id = $1${cond} ORDER BY created_at ASC`, [chit_id]);
    });
    if (result === null) return res.status(403).json({ error: 'Forbidden' });

    const msgIds = result.rows.map(m => m.message_id).filter(Boolean);
    const atts = await storage.listForMessages(msgIds, entity_id).catch(() => []);   // per-entity: caller's own copies
    const byMsg = {};
    for (const a of atts) { (byMsg[a.message_id] = byMsg[a.message_id] || []).push(a); }
    for (const m of result.rows) { m.attachments = byMsg[m.message_id] || []; }
    res.json({ messages: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('Get messages error:', err.message);
    if (err.message.includes('chit_messages')) return res.json({ messages: [], count: 0 });
    res.status(500).json({ error: 'Get messages failed', message: safeErr(err) });
  }
});

// ─── B3.10 — targeted + erasure-aware dispute helpers ────────
// integrity-critical categories whose audience the platform widens by obligation (opt-in via env)
const WIDEN_CATEGORIES = (process.env.CB_DISPUTE_WIDEN_CATEGORIES || '')
  .split(',').map(s => s.trim()).filter(Boolean);

async function probeParity(chit_id, target_entity_id, caller_entity_id) {
  if (!target_entity_id) return { parity_state: null, mode: 'two_sided', answerable: true, target_display_name: null };
  const idn = await query(`SELECT display_name, status, is_erased FROM identities WHERE identity_id=$1`, [target_entity_id]);
  if (idn.rows.length === 0) return { parity_state:'absent', mode:'one_sided', answerable:false, target_display_name:'[unknown]' };
  const t = idn.rows[0];
  if (t.is_erased)            return { parity_state:'erased', mode:'one_sided', answerable:false, target_display_name:'[erased]' };
  if (t.status !== 'active')  return { parity_state:'defunct', mode:'one_sided', answerable:false, target_display_name:t.display_name };
  // Cross-entity read of the counterparty's copy -> b52 chit_participant_parity (validated participant);
  // fallback to the legacy direct read pre-b52. Same row-presence semantics either way.
  const cs = await crossing(caller_entity_id,
    `SELECT * FROM chit_participant_parity($1,$2)`, [chit_id, target_entity_id],
    (db) => db.query(`SELECT deleted_at FROM chit_status WHERE chit_id=$1 AND entity_id=$2`, [chit_id, target_entity_id]));
  if (cs.rows.length === 0)   return { parity_state:'absent', mode:'one_sided', answerable:false, target_display_name:t.display_name };
  if (cs.rows[0].deleted_at)  return { parity_state:'archived', mode:'two_sided', answerable:true, target_display_name:t.display_name };
  return { parity_state:'present', mode:'two_sided', answerable:true, target_display_name:t.display_name };
}

// ─── POST /chits/:chit_id/disputes ───────────────────────────
router.post('/:chit_id/disputes',
  [
    body('category').isIn(['quality','quantity','delivery','payment','docs','other']).withMessage('Invalid category'),
    body('reason').trim().isLength({ min: 10 }).withMessage('Reason must be at least 10 characters'),
    body('target_entity_id').optional({ nullable:true }).isUUID().withMessage('Bad target'),
    body('participant_entity_ids').optional().isArray().withMessage('participant_entity_ids must be an array'),
    body('chit_wide').optional().isBoolean(),
    body('via').optional().isIn(['chit','mailbox']),
  ],
  validate,
  auth,
  async (req, res) => {
    const { chit_id } = req.params;
    const { category, reason, target_entity_id = null, chit_wide = false, via = 'chit' } = req.body;
    const entity_id    = entityId(req);
    const display_name = req.identity.display_name;
    try {
      // 1. raiser must be a participant
      const access = await withEntity(entity_id, (db) => db.query(`SELECT current_status FROM chit_status WHERE chit_id=$1 AND entity_id=$2`, [chit_id, entity_id]));
      if (access.rows.length === 0) return res.status(403).json({ error:'Not a participant' });

      // C2 (Athi): raising on an already-CLOSED chit is allowed but flagged with a warning (bring back to Act if needed).
      const _cs = access.rows[0].current_status;
      const closedWarning = (_cs === 'completed' || _cs === 'cancelled')
        ? `This chit is already ${_cs} — the dispute is raised anyway. Bring it back to Act if it needs work.`
        : null;
      // B3 (Athi): dispute records + messages carry the ENTITY's name; the acting actor stays as provenance in the timeline.
      let entityName = display_name;
      if (req.identity.parent_entity_id) {
        const _e = await query('SELECT display_name FROM identities WHERE identity_id = $1', [entity_id]).catch(() => ({ rows: [] }));
        if (_e.rows[0] && _e.rows[0].display_name) entityName = _e.rows[0].display_name;
      }

      // 2. can't target yourself
      if (target_entity_id && target_entity_id === entity_id)
        return res.status(400).json({ error:'Invalid target', message:'You cannot raise a dispute against yourself' });

      // 3. decide scope + probe parity → mode
      // D4: an explicit party checklist means a TARGETED dispute (only those parties see it), even when no
      // single target_entity_id is given. Only fall through to chit_wide when NO parties were selected.
      const selParties = Array.isArray(req.body.participant_entity_ids)
        ? req.body.participant_entity_ids.filter(x => x && x !== entity_id) : [];
      let scope = chit_wide ? 'chit_wide' : ((target_entity_id || selParties.length) ? 'targeted' : 'chit_wide');
      const parity = await probeParity(chit_id, scope === 'targeted' ? (target_entity_id || null) : null, entity_id);

      // 4. platform widen by obligation
      let widened = false;
      if (scope === 'targeted' && WIDEN_CATEGORIES.includes(category)) { scope = 'chit_wide'; widened = true; }

      // 5. duplicate guard (raiser + category + same target + open) — per-copy: read the raiser's OWN dispute copies.
      const dup = await withEntity(entity_id, (db) => db.query(
        `SELECT dispute_id FROM chit_disputes
          WHERE chit_id=$1 AND raised_by_entity_id=$2 AND status='open' AND category=$3
            AND COALESCE(target_entity_id::text,'') = COALESCE($4::text,'')`,
        [chit_id, entity_id, category, scope === 'targeted' ? target_entity_id : null]));
      if (dup.rows.length) return res.status(400).json({ error:'Dispute exists', message:`You already have an open ${category} dispute here` });

      // 5b. D4 — resolve the involved parties (multi-select checklist). Falls back to the single
      //     target for back-compat. Raiser + parties form the roster; each party carries its own status.
      const partyIds = selParties.length
        ? [...new Set(selParties)]
        : (scope === 'targeted' && target_entity_id ? [target_entity_id] : []);
      let partyNames = {};
      if (partyIds.length) {
        const nm = await query(`SELECT identity_id, display_name FROM identities WHERE identity_id = ANY($1::uuid[])`, [partyIds]);
        nm.rows.forEach(r => { partyNames[r.identity_id] = r.display_name; });
      }

      // 6. evidence snapshot — "forward your chit" (survives counterparty erasure)
      const snap = await withEntity(entity_id, (db) => db.query(
        `SELECT ch.auto_subject, ch.summary_json, cs.current_status AS my_status
           FROM chit_header ch JOIN chit_status cs ON cs.chit_id=ch.chit_id AND cs.entity_id=$2
          WHERE ch.chit_id=$1`, [chit_id, entity_id]));
      const evidence = { ...(snap.rows[0] || {}), captured_at: new Date().toISOString(), via };

      // 7 + 8. insert dispute + timeline atomically (INV-2). Post-b68 chit_disputes IS per-copy + FORCE-RLS, so the
      // raiser's own copy is written in withEntity(me); the per-party copies are a CROSS write served by the
      // chit_dispute_deliver definer (owner-bypass fan-out). Per-party notices go via chit_log_targets (validated).
      const ready = await definersReady();
      // b68 — per-entity dispute copies. Build the roster snapshot + audience (raiser + parties); the definer
      // replicates one chit_disputes copy per participant (bypasses FORCE-RLS as owner). dispute_participants retired.
      const dispute_id = uuidv4();
      const roster = [{ entity_id, display_name: entityName, role: 'raiser' }]
        .concat(partyIds.map(pid => ({ entity_id: pid, display_name: partyNames[pid] || null, role: 'party' })));
      const audience = [...new Set([entity_id, ...partyIds])];
      await withEntity(entity_id, async (client) => {
        await client.query(
          `SELECT chit_dispute_deliver($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16::uuid[])`,
          [dispute_id, chit_id, entity_id, entityName,
           scope === 'targeted' ? target_entity_id : null,
           scope === 'targeted' ? parity.target_display_name : null,
           scope, parity.mode, parity.answerable, parity.parity_state, via, category, reason,
           JSON.stringify(evidence), JSON.stringify(roster), audience]);
        // raiser's own timeline
        await client.query(
          `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail)
           VALUES ($1,$2,'dispute_raised',$3,$4,$5)`,
          [chit_id, entity_id, entity_id, display_name,
           `Dispute raised — ${category} (${parity.mode === 'one_sided' ? 'record-only' : scope}): ${reason.slice(0,80)}`]);
        // per-party timeline notices — CROSS write into each party's own state_log copy
        if (partyIds.length) {
          const notice = `Dispute raised against you — ${category}: ${reason.slice(0,80)}`;
          if (ready) {
            await client.query(`SELECT chit_log_targets($1,$2,$3,$4,$5,$6)`, [chit_id, partyIds, 'dispute_raised', entity_id, display_name, notice]);
          } else {
            for (const pid of partyIds) {
              await client.query(
                `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail)
                 VALUES ($1,$2,'dispute_raised',$3,$4,$5)`,
                [chit_id, pid, entity_id, display_name, notice]);
            }
          }
        }
        // the dispute REASON as a per-copy dispute message (roster-scoped via chit_message_deliver)
        await postMessageCopies({ chit_id, sender_entity_id: entity_id, sender_display_name: entityName,
          thread_type: 'external', message_text: `[${category}] ${reason}`, is_dispute: true, dispute_id }, client);
      });
      const d = { dispute_id, mode: parity.mode, answerable: parity.answerable, parity_state: parity.parity_state,
        target_display_name: scope === 'targeted' ? parity.target_display_name : null };
      res.json({
        dispute_id: d.dispute_id, category, reason, status:'open',
        warning: closedWarning,   // C2: set when raised on an already-closed chit
        scope, mode: d.mode, answerable: d.answerable, parity_state: d.parity_state,
        target_display_name: d.target_display_name,
        raised_by_display_name: entityName,
        alert: d.mode === 'one_sided'
          ? `The other side is no longer reachable (${d.parity_state}). This is lodged as a unilateral record on your own copy.`
          : (widened ? 'This category notifies all parties — raised chit-wide.' : 'Dispute raised with the selected party.'),
        message: 'Dispute raised',
      });
    } catch (err) {
      console.error('Raise dispute error:', err.message);
      if (err.message.includes('chit_disputes')) return res.status(500).json({ error:'Table not found', message:'Run B3.5 + B3.10 migrations', sql_needed:true });
      res.status(500).json({ error:'Raise dispute failed', message: safeErr(err) });
    }
  });

// ─── GET /chits/:chit_id/disputes ────────────────────────────
// All participants see all disputes on a chit
router.get('/:chit_id/disputes', auth, async (req, res) => {
  const { chit_id } = req.params;
  const entity_id   = entityId(req);

  try {
    // B1 RLS: participant access check on own copy -> withEntity(me).
    const access = await withEntity(entity_id, (db) => db.query(
      `SELECT entity_id FROM chit_status WHERE chit_id = $1 AND entity_id = $2`,
      [chit_id, entity_id]
    ));
    if (access.rows.length === 0) return res.status(403).json({ error: 'Forbidden' });

    // B3.10 + D4 — scoped: you see chit-wide disputes, ones you raised/target, or ones you're a listed party to
    // per-copy (b68): RLS returns MY OWN dispute copies for this chit
    const result = await withEntity(entity_id, (db) => db.query(
      `SELECT * FROM chit_disputes WHERE chit_id = $1 ORDER BY created_at ASC`, [chit_id]));
    // roster (names/roles from my copy's snapshot) + live per-party status via the definer (reads all parties' copies)
    let partsByD = {};
    for (const d of result.rows) {
      try {
        const rr = await query(`SELECT entity_id, role, status FROM chit_dispute_roster($1)`, [d.dispute_id]);
        const statusBy = {}; rr.rows.forEach(r => { statusBy[r.entity_id] = r.status; });
        partsByD[d.dispute_id] = (d.roster || []).map(p => ({ dispute_id: d.dispute_id, entity_id: p.entity_id,
          display_name: p.display_name, role: p.role, dispute_status: statusBy[p.entity_id] || 'open' }));
      } catch (_) { partsByD[d.dispute_id] = (d.roster || []); }
    }
    // evidence_snapshot is PII — expose presence only; roster surfaced as participants
    const disputes = result.rows.map(({ evidence_snapshot, roster, ...d }) => ({ ...d, has_evidence: evidence_snapshot != null, participants: partsByD[d.dispute_id] || [] }));
    res.json({ disputes, open_count: disputes.filter(d => d.status === 'open').length });
  } catch (err) {
    if (err.message.includes('chit_disputes')) return res.json({ disputes: [], open_count: 0 });
    res.status(500).json({ error: 'Get disputes failed', message: safeErr(err) });
  }
});

// ─── GET /chits/:chit_id/diagnosis ───────────────────────────
// DEMO-5: read-only diagnosis over B3.10 disputes. One card per dispute the
// viewer is party to. probe (fault) → localise (coordinate) → route (routing) + proof.
// Never writes anything; never returns evidence_snapshot contents.
const FAULT_SUMMARY = {
  present:  'Both sides present — workable',
  archived: 'Counterparty archived their copy — still workable',
  erased:   'Counterparty erased — no live other side',
  defunct:  'Counterparty no longer active',
  absent:   'No counterparty copy found on this chit',
};
router.get('/:chit_id/diagnosis', auth, async (req, res) => {
  const { chit_id } = req.params;
  const entity_id   = entityId(req);
  try {
    // B1 RLS: own-copy reads (status/header/detail) -> withEntity(me).
    const rls = await withEntity(entity_id, async (db) => {
      const access = await db.query(`SELECT 1 FROM chit_status WHERE chit_id=$1 AND entity_id=$2`, [chit_id, entity_id]);
      if (access.rows.length === 0) return null;
      const hdr = await db.query(
        `SELECT auto_subject, schema_version FROM chit_header WHERE chit_id=$1 AND entity_id=$2`,
        [chit_id, entity_id]);
      const det = await db.query(
        `SELECT line_items FROM chit_detail WHERE chit_id=$1 AND entity_id=$2`,
        [chit_id, entity_id]);
      return { hdr, det };
    });
    if (!rls) return res.status(403).json({ error: 'Forbidden' });
    const { hdr, det } = rls;
    let itemLabel = null;
    try {
      const raw = det.rows[0]?.line_items;
      const li = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
      if (Array.isArray(li) && li.length) {
        itemLabel = li.map(i => i.particulars || i.product).filter(Boolean).join(', ') || null;
      }
    } catch { itemLabel = null; }

    // same audience rule as GET disputes — never leak someone else's dispute
    const d = await withEntity(entity_id, (db) => db.query(   // per-copy: RLS returns MY OWN dispute copies
      `SELECT dispute_id, category, reason, status, created_at,
              target_display_name, scope, mode, answerable, parity_state, via,
              (evidence_snapshot IS NOT NULL) AS has_evidence
         FROM chit_disputes
        WHERE chit_id=$1
        ORDER BY created_at ASC`,
      [chit_id]));

    const diagnoses = d.rows.map(x => ({
      dispute_id: x.dispute_id,
      category:   x.category,
      reason:     x.reason,
      status:     x.status,
      created_at: x.created_at,
      resolvable: x.mode === 'two_sided',
      // probe → the fault
      fault: {
        state:    x.parity_state || 'present',
        category: x.category,
        summary:  FAULT_SUMMARY[x.parity_state] || FAULT_SUMMARY.present,
      },
      // localise → the coordinate (who / what / which version)
      coordinate: {
        party:          x.target_display_name || 'all parties',
        line_item:      itemLabel,
        schema_version: hdr.rows[0]?.schema_version ?? null,
      },
      // route → how it is handled
      routing: { scope: x.scope, mode: x.mode, answerable: x.answerable },
      // proof → presence only + provenance (never the contents)
      proof: { evidence_captured: x.has_evidence, arose_from: x.via },
    }));

    res.json({ chit_id, chit_subject: hdr.rows[0]?.auto_subject || null, diagnoses, count: diagnoses.length });
  } catch (err) {
    if (err.message.includes('chit_disputes')) return res.json({ chit_id, chit_subject: null, diagnoses: [], count: 0 });
    console.error('Diagnosis error:', err.message);
    res.status(500).json({ error: 'Diagnosis failed', message: safeErr(err) });
  }
});

// ─── PUT /chits/:chit_id/disputes/:dispute_id/resolve ────────
// Only the entity that raised the dispute can resolve it
router.put('/:chit_id/disputes/:dispute_id/resolve',
  [ body('resolution_note').trim().notEmpty().withMessage('Resolution note required'),
    body('target_entity_id').optional({ nullable:true }).isUUID() ],
  validate,
  auth,
  async (req, res) => {
    const { chit_id, dispute_id } = req.params;
    const { resolution_note }     = req.body;
    const targetParty  = req.body.target_entity_id || null;   // per-party resolve; null = clear all remaining
    const entity_id    = entityId(req);
    const display_name = req.identity.display_name;
    // B3: the resolution message posts in the ENTITY name (the acting actor stays as provenance in the timeline).
    let entityName = display_name;
    if (req.identity.parent_entity_id) { const _e = await query('SELECT display_name FROM identities WHERE identity_id = $1', [entity_id]).catch(() => ({ rows: [] })); if (_e.rows[0] && _e.rows[0].display_name) entityName = _e.rows[0].display_name; }

    try {
      // b68 — per-copy: read the raiser's OWN dispute copy (RLS), then resolve across copies via the definer.
      const dispute = await withEntity(entity_id, (db) => db.query(
        `SELECT * FROM chit_disputes WHERE dispute_id = $1 AND chit_id = $2`, [dispute_id, chit_id]));
      if (dispute.rows.length === 0) return res.status(404).json({ error: 'Dispute not found' });

      const d = dispute.rows[0];
      if (d.status !== 'open') return res.status(400).json({ error: 'Dispute already resolved' });
      if (d.raised_by_entity_id !== entity_id) {
        return res.status(403).json({ error: 'Forbidden', message: 'Only the entity that raised the dispute can resolve it' });
      }

      const ready = await definersReady();
      const out = await withEntity(entity_id, async (client) => {
        // who is being cleared (for their timeline notice): the target party, or every still-open party.
        let resolvedPartyIds;
        if (targetParty) resolvedPartyIds = [targetParty];
        else {
          const openR = await client.query(`SELECT entity_id FROM chit_dispute_roster($1) WHERE role='party' AND status='open'`, [dispute_id]);
          resolvedPartyIds = openR.rows.map(r => r.entity_id);
        }
        // definer clears the party copy(ies), and the raiser's copy when no party remains open. Returns allResolved.
        const rr = await client.query(`SELECT chit_dispute_resolve($1,$2,$3,$4) AS all_resolved`, [dispute_id, entity_id, targetParty || null, resolution_note]);
        const allResolved = rr.rows[0].all_resolved;
        // resolver's own timeline
        await client.query(
          `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail)
           VALUES ($1,$2,'dispute_resolved',$3,$4,$5)`,
          [chit_id, entity_id, entity_id, display_name, `Dispute resolved — ${d.category}: ${resolution_note.slice(0,100)}`]);
        // resolution note as a per-copy dispute message (roster-scoped)
        await postMessageCopies({ chit_id, sender_entity_id: entity_id, sender_display_name: entityName,
          thread_type: 'external', message_text: `[resolved] ${resolution_note}`, is_dispute: true, dispute_id }, client);
        // notify the cleared parties on their own timeline
        if (resolvedPartyIds.length) {
          const notice = `Dispute resolved — ${d.category}: ${resolution_note.slice(0,100)}`;
          if (ready) {
            await client.query(`SELECT chit_log_targets($1,$2,$3,$4,$5,$6)`, [chit_id, resolvedPartyIds, 'dispute_resolved', entity_id, display_name, notice]);
          } else {
            for (const pid of resolvedPartyIds) {
              await client.query(
                `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail)
                 VALUES ($1,$2,'dispute_resolved',$3,$4,$5)`,
                [chit_id, pid, entity_id, display_name, notice]);
            }
          }
        }
        return { allResolved, resolvedPartyIds };
      });

      res.json({
        dispute_id,
        status: out.allResolved ? 'resolved' : 'open',
        resolved_parties: out.resolvedPartyIds,
        fully_resolved: out.allResolved,
        resolution_note, resolved_by: display_name,
        message: out.allResolved ? 'Dispute fully resolved' : 'Party resolved — still open for the others'
      });
    } catch (err) {
      console.error('Resolve dispute error:', err.message);
      res.status(500).json({ error: 'Resolve failed', message: safeErr(err) });
    }
  }
);

// ─── GET /chits/disputes/queue ────────────────────────────────
// All open disputes across all chits for this entity — used by DisputesPage sidebar
// Safe: /disputes/queue has 2 segments; /:chit_id matches 1 segment only — no conflict
router.get('/disputes/queue', auth, async (req, res) => {
  const entity_id = entityId(req);

  try {
    // B1 RLS: own-copy subselects (chit_header/chit_status) -> withEntity(me).
    const result = await withEntity(entity_id, (db) => db.query(
      `SELECT cd.*,
              (SELECT ch.auto_subject FROM chit_header ch WHERE ch.chit_id=cd.chit_id AND ch.entity_id=$1 LIMIT 1) AS auto_subject,
              (SELECT ch.purpose      FROM chit_header ch WHERE ch.chit_id=cd.chit_id AND ch.entity_id=$1 LIMIT 1) AS purpose,
              (SELECT se.display_name FROM chit_header ch LEFT JOIN identities se ON se.identity_id=ch.sender_entity_id
                WHERE ch.chit_id=cd.chit_id AND ch.entity_id=$1 LIMIT 1) AS sender_display_name
       FROM chit_disputes cd
       WHERE cd.status = 'open'
       ORDER BY cd.created_at ASC`,
      [entity_id]
    ));   // per-copy: RLS returns only MY OWN open dispute copies (I have one only if I'm a participant)

    // evidence_snapshot is PII — expose presence only, never its contents
    const rows = result.rows.map(({ evidence_snapshot, ...d }) => ({ ...d, has_evidence: evidence_snapshot != null }));
    // attach the per-party roster (live status per party) so the raiser can resolve each party independently
    for (const d of rows) {
      try {
        const rr = await query(`SELECT entity_id, role, status FROM chit_dispute_roster($1)`, [d.dispute_id]);
        const statusBy = {}; rr.rows.forEach(r => { statusBy[r.entity_id] = r.status; });
        d.participants = (d.roster || []).map(p => ({ dispute_id: d.dispute_id, entity_id: p.entity_id,
          display_name: p.display_name, role: p.role, dispute_status: statusBy[p.entity_id] || 'open' }));
      } catch (_) { d.participants = d.roster || []; }
      delete d.roster;
    }
    // "other" now means disputes targeting me (untargeted ones no longer leak)
    const myDisputes    = rows.filter(d => d.raised_by_entity_id === entity_id);
    const otherDisputes = rows.filter(d => d.raised_by_entity_id !== entity_id);

    res.json({
      disputes:       rows,
      my_disputes:    myDisputes,
      other_disputes: otherDisputes,
      total_open:     rows.length,
    });
  } catch (err) {
    if (err.message.includes('chit_disputes')) {
      return res.json({ disputes: [], my_disputes: [], other_disputes: [], total_open: 0 });
    }
    res.status(500).json({ error: 'Get dispute queue failed', message: safeErr(err) });
  }
});

// ─── DELETE /chits/:chit_id ──────────────────────────────────
// Soft delete (per-entity) — sets chit_status.deleted_at for the
// requesting entity only; the other party's copy is untouched.
// Blocked (409) while an OPEN dispute exists on the chit.
router.delete('/:chit_id', auth, async (req, res) => {
  try {
    const chit_id        = req.params.chit_id;
    const entity_id      = entityId(req);
    const action_by_id   = req.identity.identity_id;
    const action_by_name = req.identity.display_name;

    // B1 RLS: caller deletes only its own copy -> withEntity(me).
    await withEntity(entity_id, async (db) => {
    // Verify this entity has a (non-deleted) copy of the chit
    const current = await db.query(
      `SELECT current_status FROM chit_status
       WHERE chit_id = $1 AND entity_id = $2 AND deleted_at IS NULL`,
      [chit_id, entity_id]
    );

    if (current.rows.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: 'Chit not found or already deleted'
      });
    }

    // Guard: cannot delete while an open dispute is registered
    const openDisputes = await db.query(
      `SELECT COUNT(*)::int AS count FROM chit_disputes
       WHERE chit_id = $1 AND status = 'open'`,
      [chit_id]
    );

    if (openDisputes.rows[0].count > 0) {
      return res.status(409).json({
        error: 'Dispute active',
        message: 'Cannot delete a chit with an open dispute. Resolve the dispute first.'
      });
    }

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
      [chit_id, entity_id, action_by_id, action_by_name,
       current.rows[0].current_status,
       `Chit deleted by ${action_by_name}`]
    );

    res.json({ message: 'Chit deleted', chit_id });
    });

  } catch (err) {
    console.error('Delete chit error:', err.message);
    res.status(500).json({ error: 'Delete failed', message: safeErr(err) });
  }
});

// ─────────────────────────────────────────────────────────────
// Slice 2 — fp01 priority endpoints (internal queue + customer cross-edge)
// ─────────────────────────────────────────────────────────────

// PUT /chits/:chit_id/priority — INTERNAL queue priority. Never crosses the edge.
// urgent requires a reason, logged as an internal action message.
router.put('/:chit_id/priority',
  [
    body('priority').trim().isIn(['normal','high','urgent']).withMessage('priority must be normal|high|urgent'),
    body('reason').optional().trim().isLength({ max: 500 }),
  ],
  validate,
  auth,
  async (req, res) => {
    try {
      const chit_id   = req.params.chit_id;
      const entity_id = entityId(req);
      const priority  = req.body.priority;
      const reason    = sanitise(req.body.reason || '');

      if (priority === 'urgent' && !reason) {
        return res.status(400).json({ error: 'Reason required', message: 'An urgent priority needs a reason' });
      }

      // B1 RLS: caller sets priority on its own copy -> withEntity(me).
      await withEntity(entity_id, async (db) => {
      const access = await db.query(
        `SELECT current_status FROM chit_status WHERE chit_id = $1 AND entity_id = $2`,
        [chit_id, entity_id]
      );
      if (access.rows.length === 0) {
        return res.status(404).json({ error: 'Not found', message: 'Chit not found for this entity' });
      }

      await db.query(
        `UPDATE chit_status SET priority_flag = $1, updated_at = NOW()
         WHERE chit_id = $2 AND entity_id = $3`,
        [priority, chit_id, entity_id]
      );

      // urgent → record an internal action message (only this entity's internal thread — single copy)
      if (priority === 'urgent') {
        await postMessageCopies({ chit_id, sender_entity_id: entity_id, sender_display_name: req.identity.display_name,
          thread_type: 'internal', message_text: `Marked URGENT: ${reason}`, msg_type: 'action' }, db);
      }

      res.json({ message: 'Priority updated', chit_id, priority_flag: priority });
      });
    } catch (err) {
      console.error('Set priority error:', err.message);
      res.status(500).json({ error: 'Priority update failed', message: safeErr(err) });
    }
  }
);

// PUT /chits/:chit_id/priority-flag — CUSTOMER cross-edge priority, WRITE-ONCE.
// DESIGN (review): set + lock on EVERY participant row so the counterparty sees it;
// reject once customer_priority_locked is true.
router.put('/:chit_id/priority-flag',
  [ body('priority').isBoolean().withMessage('priority must be true or false') ],
  validate,
  auth,
  async (req, res) => {
    try {
      const chit_id   = req.params.chit_id;
      const entity_id = entityId(req);
      const flag      = req.body.priority === true || req.body.priority === 'true';

      // B1 RLS: write-once lock check on own copy -> withEntity(me).
      const access = await withEntity(entity_id, (db) => db.query(
        `SELECT customer_priority_locked FROM chit_status WHERE chit_id = $1 AND entity_id = $2`,
        [chit_id, entity_id]
      ));
      if (access.rows.length === 0) {
        return res.status(404).json({ error: 'Not found', message: 'Chit not found for this entity' });
      }
      if (access.rows[0].customer_priority_locked) {
        return res.status(409).json({ error: 'Locked', message: 'Customer priority is write-once and already set' });
      }

      // Customer flag is cross-edge (write-once) -> set on ALL participant rows via chit_set_customer_priority_all
      // (validated: caller must be a participant). Fallback = the legacy all-rows update when b50 isn't applied.
      await crossing(entity_id,
        `SELECT chit_set_customer_priority_all($1,$2)`,
        [chit_id, flag],
        (db) => db.query(
          `UPDATE chit_status SET customer_priority = $1, customer_priority_locked = true, updated_at = NOW()
           WHERE chit_id = $2`,
          [flag, chit_id]));

      // Trail parity with internal urgent: log who/when as an action message.
      // External thread (visibility NULL) — the customer flag is cross-edge, so both parties see the trail.
      await postMessageCopies({ chit_id, sender_entity_id: entity_id, sender_display_name: req.identity.display_name,
        thread_type: 'external', msg_type: 'action',
        message_text: flag ? 'Customer marked this chit as priority' : 'Customer cleared priority' });

      res.json({ message: 'Customer priority set', chit_id, customer_priority: flag, locked: true });
    } catch (err) {
      console.error('Customer flag error:', err.message);
      res.status(500).json({ error: 'Customer flag failed', message: safeErr(err) });
    }
  }
);

// ─────────────────────────────────────────────────────────────
// feat/chit-actions — archive (reversible), void (terminal), assign-bulk
// ─────────────────────────────────────────────────────────────

// POST /chits/:chit_id/archive — hide MY copy from inbox/sent (reversible; never deletes).
router.post('/:chit_id/archive', auth, async (req, res) => {
  try {
    const entity_id = entityId(req);
    // D4 guard: a chit with an OPEN dispute can't be archived (parity with the delete guard) — resolve first.
    const openD = await withEntity(entity_id, (db) => db.query(`SELECT COUNT(*)::int AS count FROM chit_disputes WHERE chit_id = $1 AND status = 'open'`,
      [req.params.chit_id])).catch(() => ({ rows: [{ count: 0 }] }));   // per-copy: my own open dispute copies
    if (openD.rows[0].count > 0) return res.status(409).json({ error: 'Dispute active', message: 'Cannot archive a chit with an open dispute. Resolve the dispute first.' });
    // B1 RLS: caller archives only its own copy -> withEntity(me).
    const r = await withEntity(entity_id, (db) => db.query(
      `UPDATE chit_status SET archived_at = NOW(), updated_at = NOW()
        WHERE chit_id = $1 AND entity_id = $2 AND deleted_at IS NULL AND archived_at IS NULL
        RETURNING chit_id`,
      [req.params.chit_id, entity_id]));
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found', message: 'Chit not found or already archived' });
    res.json({ message: 'Chit archived', chit_id: req.params.chit_id });
  } catch (err) { res.status(500).json({ error: 'Archive failed', message: safeErr(err) }); }
});

// PUT /chits/:chit_id/star — toggle the star/flag on MY copies (kept in sync across both directions).
router.put('/:chit_id/star', auth, async (req, res) => {
  try {
    const entity_id = entityId(req);
    // B1 RLS: caller acts only on its own copy -> withEntity(me).
    await withEntity(entity_id, async (db) => {
    const cur = await db.query(`SELECT star_flag FROM chit_status WHERE chit_id = $1 AND entity_id = $2 LIMIT 1`,
      [req.params.chit_id, entity_id]);
    if (cur.rows.length === 0) return res.status(404).json({ error: 'Not found', message: 'Chit not found' });
    const next = !cur.rows[0].star_flag;
    await db.query(`UPDATE chit_status SET star_flag = $3, updated_at = NOW() WHERE chit_id = $1 AND entity_id = $2`,
      [req.params.chit_id, entity_id, next]);
    res.json({ message: 'Star toggled', chit_id: req.params.chit_id, star_flag: next });
    });
  } catch (err) { res.status(500).json({ error: 'Star failed', message: safeErr(err) }); }
});

// POST /chits/:chit_id/unread — mark MY copy unread (clear read_at).
router.post('/:chit_id/unread', auth, async (req, res) => {
  try {
    const entity_id = entityId(req);
    // B1 RLS: caller acts only on its own copy -> withEntity(me).
    const r = await withEntity(entity_id, (db) => db.query(`UPDATE chit_status SET read_at = NULL, updated_at = NOW() WHERE chit_id = $1 AND entity_id = $2 RETURNING chit_id`,
      [req.params.chit_id, entity_id]));
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found', message: 'Chit not found' });
    res.json({ message: 'Marked unread', chit_id: req.params.chit_id });
  } catch (err) { res.status(500).json({ error: 'Mark-unread failed', message: safeErr(err) }); }
});

// POST /chits/:chit_id/unarchive — restore MY copy to inbox/sent.
router.post('/:chit_id/unarchive', auth, async (req, res) => {
  try {
    const entity_id = entityId(req);
    // B1 RLS: caller acts only on its own copy -> withEntity(me).
    const r = await withEntity(entity_id, (db) => db.query(
      `UPDATE chit_status SET archived_at = NULL, updated_at = NOW()
        WHERE chit_id = $1 AND entity_id = $2 AND archived_at IS NOT NULL
        RETURNING chit_id`,
      [req.params.chit_id, entity_id]));
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found', message: 'Chit not found or not archived' });
    res.json({ message: 'Chit restored', chit_id: req.params.chit_id });
  } catch (err) { res.status(500).json({ error: 'Unarchive failed', message: safeErr(err) }); }
});

// POST /chits/:chit_id/restore — bring MY copy back from Trash (undo a soft delete).
// Mirrors DELETE /:chit_id (which sets deleted_at); clears deleted_at on this entity's copy only + logs it.
router.post('/:chit_id/restore', auth, async (req, res) => {
  try {
    const chit_id        = req.params.chit_id;
    const entity_id      = entityId(req);
    const action_by_id   = req.identity.identity_id;
    const action_by_name = req.identity.display_name;
    // B1 RLS: caller restores only its own copy -> withEntity(me).
    await withEntity(entity_id, async (db) => {
    const r = await db.query(
      `UPDATE chit_status SET deleted_at = NULL, updated_at = NOW()
        WHERE chit_id = $1 AND entity_id = $2 AND deleted_at IS NOT NULL
        RETURNING chit_id`,
      [chit_id, entity_id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found', message: 'Chit not found in Trash' });
    await db.query(
      `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail)
       VALUES ($1, $2, 'restored', $3, $4, $5)`,
      [chit_id, entity_id, action_by_id, action_by_name, `Chit restored from Trash by ${action_by_name}`]);
    res.json({ message: 'Chit restored from Trash', chit_id });
    });
  } catch (err) { res.status(500).json({ error: 'Restore failed', message: safeErr(err) }); }
});

// DELETE /chits/:chit_id/purge — permanently remove a DRAFT (owner only). Real chits are immutable co-held
// records and can NEVER be hard-deleted here; only role='Draft' (un-bridged, sender-only) qualifies.
router.delete('/:chit_id/purge', auth, async (req, res) => {
  try {
    const chit_id   = req.params.chit_id;
    const entity_id = entityId(req);
    // B1 RLS: caller purges only its own draft copy -> withEntity(me) (was withTransaction).
    await withEntity(entity_id, async (db) => {
      const chk = await db.query(`SELECT role, created_by_actor_id FROM chit_header WHERE chit_id = $1 AND entity_id = $2`, [chit_id, entity_id]);
      if (chk.rows.length === 0) return res.status(404).json({ error: 'Not found', message: 'Draft not found' });
      if (chk.rows[0].role !== 'Draft') return res.status(403).json({ error: 'Forbidden', message: 'Only drafts can be permanently deleted — sent chits are immutable co-held records.' });
      if (chk.rows[0].created_by_actor_id !== req.identity.identity_id) return res.status(403).json({ error: 'Forbidden', message: 'You can only delete drafts you created.' });
      await db.query(`DELETE FROM chit_messages WHERE chit_id = $1 AND entity_id = $2`, [chit_id, entity_id]);   // per-entity: my own copies only
      await db.query(`DELETE FROM state_log  WHERE chit_id = $1 AND entity_id = $2`, [chit_id, entity_id]);
      await db.query(`DELETE FROM chit_detail WHERE chit_id = $1 AND entity_id = $2`, [chit_id, entity_id]);
      await db.query(`DELETE FROM chit_status WHERE chit_id = $1 AND entity_id = $2`, [chit_id, entity_id]);
      await db.query(`DELETE FROM chit_header WHERE chit_id = $1 AND entity_id = $2`, [chit_id, entity_id]);
      try { await db.query(`DELETE FROM cb_attachment WHERE chit_id = $1`, [chit_id]); } catch (e) { /* attachment table may not exist */ }
      res.json({ message: 'Draft permanently deleted', chit_id });
    });
  } catch (err) {
    console.error('Purge draft error:', err.message);
    res.status(500).json({ error: 'Purge failed', message: safeErr(err) });
  }
});

// PUT /chits/:chit_id/void — recorded hard-cancel by the SENDER; works after acceptance.
// Terminal 'void' status on ALL participant rows (cross-edge); reason required + logged;
// chit stays visible as voided, never deleted; the seal is untouched.
router.put('/:chit_id/void',
  [ body('reason').trim().notEmpty().withMessage('A reason is required to void') ],
  validate, auth,
  async (req, res) => {
    try {
      const chit_id   = req.params.chit_id;
      const entity_id = entityId(req);
      const reason    = sanitise(req.body.reason);

      // B1 RLS: sender check on own copy -> withEntity(me).
      const own = await withEntity(entity_id, (db) => db.query(
        `SELECT sender_entity_id FROM chit_header WHERE chit_id = $1 AND entity_id = $2`,
        [chit_id, entity_id]));
      if (own.rows.length === 0) return res.status(404).json({ error: 'Not found', message: 'Chit not found' });
      if (own.rows[0].sender_entity_id !== entity_id) {
        return res.status(403).json({ error: 'Forbidden', message: 'Only the sender can void a chit' });
      }

      // Void = the sender withdraws ITS OWN copy and REQUESTS cancellation from the recipients — never a cross-entity
      // write. Each recipient acts on its own copy at its own will (it sees the flagged message below).
      await withEntity(entity_id, async (db) => {
        await db.query(`UPDATE chit_status SET current_status = 'void', updated_at = NOW() WHERE chit_id = $1 AND entity_id = $2`, [chit_id, entity_id]);   // own copy only
        await db.query(
          `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, new_status, detail)
           VALUES ($1, $2, 'voided', $3, $4, 'void', $5)`,
          [chit_id, entity_id, req.identity.identity_id, req.identity.display_name, `Voided: ${reason}`]);   // own timeline only
      });
      // deliver the flagged cancel request to the recipients (a per-copy message — like a dispute notification)
      await postMessageCopies({ chit_id, sender_entity_id: entity_id, sender_display_name: req.identity.display_name,
        thread_type: 'external', msg_type: 'action', message_text: `[cancel requested] ${reason}` });

      res.json({ message: 'Chit voided', chit_id, status: 'void' });
    } catch (err) {
      console.error('Void error:', err.message);
      res.status(500).json({ error: 'Void failed', message: safeErr(err) });
    }
  });

// POST /chits/assign-bulk — push-assign many chits to one actor (mirrors the single push).
router.post('/assign-bulk',
  [ body('chit_ids').isArray({ min: 1 }).withMessage('chit_ids[] required'),
    body('target_actor_id').isUUID().withMessage('target_actor_id required') ],
  validate, auth,
  async (req, res) => {
    try {
      const entity_id      = entityId(req);
      const action_by_id   = req.identity.identity_id;
      const action_by_name = req.identity.display_name;
      const { chit_ids, target_actor_id } = req.body;
      if (chit_ids.length > 200) return res.status(400).json({ error: 'Too many', message: 'Assign at most 200 chits at once.' });   // F4: bound the batch (long tx / lock contention)

      // Atomic: the whole batch (counts + chit_status + state_log) commits together or rolls back —
      // a mid-loop failure no longer leaves a partial assign. Target validated inside the tx.
      // B1 RLS: bulk-assign writes only the assigning entity's own rows -> withEntity(me), not withTransaction.
      const out = await withEntity(entity_id, async (client) => {
        // (e) Assignment rule from settings: honour pull/push mode + per-actor capacity BEFORE assigning.
        const st = await client.query(`SELECT assignment_model, default_max_tasks FROM entity_actor_settings WHERE entity_id = $1`, [entity_id]);
        const model  = (st.rows[0] && st.rows[0].assignment_model) || 'both';
        const defMax = (st.rows[0] && st.rows[0].default_max_tasks) || 10;
        if (model === 'pull') { const e = new Error('Push-assign is off — this entity is in pull mode (co-assists take tasks themselves).'); e.status = 400; throw e; }

        const target = await client.query(
          `SELECT identity_id, display_name, max_tasks, current_task_count FROM identities
            WHERE identity_id = $1 AND parent_entity_id = $2 AND break_status = 'active'
              AND hat IN ('act','manager')`,
          [target_actor_id, entity_id]);
        if (target.rows.length === 0) { const e = new Error('Target co-assist not found, not on shift, or not an assignable hat (Act/Manager)'); e.status = 400; throw e; }
        const t = target.rows[0];
        const cap = t.max_tasks || defMax;
        let load = t.current_task_count || 0;

        const assigned = []; const skipped = [];
        for (const chit_id of chit_ids) {
          const cs = await client.query(
            `SELECT assigned_to_actor_id FROM chit_status WHERE chit_id = $1 AND entity_id = $2 AND deleted_at IS NULL`,
            [chit_id, entity_id]);
          if (cs.rows.length === 0) { skipped.push({ chit_id, reason: 'not found' }); continue; }
          const already = cs.rows[0].assigned_to_actor_id;
          if (already === t.identity_id) { assigned.push(chit_id); continue; }              // already theirs — no change, no cost
          if (load >= cap) { skipped.push({ chit_id, reason: `at capacity (${cap})` }); continue; }   // (e) capacity gate
          if (already) { await client.query(`UPDATE identities SET current_task_count = GREATEST(0, current_task_count - 1) WHERE identity_id = $1`, [already]); }
          await client.query(
            `UPDATE chit_status SET assigned_to_actor_id = $1, assigned_to_actor_display_name = $2,
                    assigned_at = NOW(), assignment_type = 'push', current_status = 'pending', updated_at = NOW()
              WHERE chit_id = $3 AND entity_id = $4`,
            [t.identity_id, t.display_name, chit_id, entity_id]);
          await client.query(`UPDATE identities SET current_task_count = current_task_count + 1, last_assigned_at = NOW() WHERE identity_id = $1`, [t.identity_id]);
          load++;
          await client.query(
            // F3: assignment is INTERNAL — write ONLY the assigning entity's own row. The assignee sees it via the
            // derived notifications feed (assigned_to_me) — step (d) of the workflow.
            `INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail)
             SELECT $1, entity_id, 'assigned', $2, $3, $4 FROM chit_status WHERE chit_id = $1 AND entity_id = $5`,
            [chit_id, action_by_id, action_by_name, `Bulk-assigned to ${t.display_name} by ${action_by_name}`, entity_id]);
          assigned.push(chit_id);
        }
        return { t, assigned, skipped, cap };
      });
      res.json({ message: 'Bulk assign complete', assigned_to: out.t.display_name, assigned: out.assigned.length, skipped: out.skipped });
    } catch (err) {
      if (err.status === 400) return res.status(400).json({ error: 'Invalid target', message: err.message });
      console.error('Bulk assign error:', err.message);
      res.status(500).json({ error: 'Bulk assign failed', message: safeErr(err) });
    }
  });

// ─── GET /chits/:id/children ──────────────────────────────────────────────────────────────────────────────
// Forward-link resolver (Fragment 1): the immediate children of a handoff = every chit whose trace.parents SET
// contains :id. RLS-scoped — the caller sees only children they CO-HOLD, so a rival's downstream edge is invisible
// by construction (the TR-6 privacy floor). Proves the forward link is a SET: a fan-out node returns all N children.
// The cross-entity, multi-hop operator WALK (past parties you don't co-hold) is Fragment 2's participant-gated definer.
router.get('/:id/children', auth, async (req, res) => {
  try {
    const me = entityId(req);
    const id = req.params.id;
    if (!trace.UUID_RE.test(id)) return res.status(400).json({ error: 'Bad request', message: 'Invalid chit id' });
    const r = await withEntity(me, (db) => db.query(
      `SELECT chit_id, entity_id, direction, manual_subject, auto_subject,
              summary_json->'trace' AS trace
         FROM chit_header
        WHERE summary_json->'trace'->'parents' @> $1::jsonb
        ORDER BY created_at ASC`,
      [JSON.stringify(id)]));
    res.json({ parent_chit_id: id, count: r.rows.length, children: r.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get children', message: safeErr(err) });
  }
});

// ─── GET /chits/:id/trace?dir=forward|backward ──────────────────────────────────────────────────────────────
// The recall WALK (Fragment 2). RLS-scoped, so the caller only ever traverses edges it CO-HOLDS: an ordinary
// entity sees one hop each way, while the mandated network OPERATOR (co-held onto every network edge) sees its
// whole subtree — and a rival sees nothing of another's chain (TR-6, the moat, by construction). forward =
// exposure / recall set (BFS; the visited-set collapses diamonds + cycles); backward = provenance to source.
// A hop the caller doesn't co-hold is an honest dead-end (the branch stops), never a silent skip to grandchildren.
router.get('/:id/trace', auth, async (req, res) => {
  try {
    const me = entityId(req);
    const id = req.params.id;
    if (!trace.UUID_RE.test(id)) return res.status(400).json({ error: 'Bad request', message: 'Invalid chit id' });
    const dir = req.query.dir === 'backward' ? 'backward' : 'forward';
    const MAX_NODES = 2000, MAX_DEPTH = 40;
    // Optional network scope: when given, the walk follows ONLY edges tagged with this network id, so an entity in
    // several networks never bleeds one into another (the multi-network leak). Omit to walk all co-held edges.
    const net = (typeof req.query.network === 'string' && req.query.network.trim()) ? req.query.network.trim() : null;
    const edgeOf = (t) => { t = t || {}; return { product: t.product || null, qty: (t.qty ?? null), unit: t.unit || null,
      base_qty: (t.base_qty ?? null), base_unit: t.base_unit || null, is_origin: !!t.is_origin, parents: Array.isArray(t.parents) ? t.parents : [] }; };
    // The chain is a graph of HANDOFFS: each node is one co-held edge. Label it by who it went to (to_name) and
    // came from (sender_name) so the walk renders as a readable tree. Names are topology the operator already
    // co-holds — not commercial terms — so this stays within the TR-6 lens.
    const toName = (row) => { let a = row.all_recipients; if (typeof a === 'string') { try { a = JSON.parse(a); } catch (_) { a = []; } }
      a = Array.isArray(a) ? a : []; const rec = a.find((x) => x.role && x.role !== 'sender' && x.role !== 'operator'); return rec ? rec.display_name : null; };
    const fetch1 = (cid) => withEntity(me, (db) => db.query(
      `SELECT chit_id, entity_id, sender_entity_display_name, all_recipients, summary_json->'trace' AS trace
         FROM chit_header WHERE chit_id = $1${net ? " AND summary_json->'trace'->'network'->>'id' = $2" : ''} LIMIT 1`, net ? [cid, net] : [cid]));

    const seed = await fetch1(id);
    if (!seed.rows[0]) return res.status(404).json({ error: 'Not found', message: 'Chit not visible to you' });
    const nodes = new Map();
    const edges = [];
    const seenEdge = new Set();
    const addEdge = (from, to) => { const k = `${from}|${to}`; if (!seenEdge.has(k)) { seenEdge.add(k); edges.push({ from, to }); } };
    const put = (row, depth) => { if (!nodes.has(row.chit_id)) nodes.set(row.chit_id, { chit_id: row.chit_id, entity_id: row.entity_id, depth,
      sender_name: row.sender_entity_display_name || null, to_name: toName(row), network: (row.trace && row.trace.network && row.trace.network.id) || null, ...edgeOf(row.trace) }); };
    put(seed.rows[0], 0);

    if (dir === 'forward') {
      let frontier = [id], depth = 0;
      while (frontier.length && depth < MAX_DEPTH && nodes.size < MAX_NODES) {
        const r = await withEntity(me, (db) => db.query(
          `SELECT chit_id, entity_id, sender_entity_display_name, all_recipients, summary_json->'trace' AS trace
             FROM chit_header
            WHERE EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(summary_json->'trace'->'parents','[]'::jsonb)) AS e WHERE e = ANY($1::text[]))${net ? " AND summary_json->'trace'->'network'->>'id' = $2" : ''}`,
          net ? [frontier, net] : [frontier]));
        const next = [];
        for (const row of r.rows) {
          const parents = Array.isArray(row.trace && row.trace.parents) ? row.trace.parents : [];
          for (const p of parents) if (frontier.includes(p)) addEdge(p, row.chit_id);
          if (!nodes.has(row.chit_id)) { put(row, depth + 1); next.push(row.chit_id); }
        }
        frontier = next; depth++;
      }
      const nodeArr = [...nodes.values()];
      const terminals = nodeArr.filter((n) => !edges.some((e) => e.from === n.chit_id));
      // ── Mass-balance invariant (Fragment 3): at each node, what goes OUT (sum of its children's base_qty) must not
      //    exceed what came IN (its own base_qty), in the same base unit. out > in ⇒ RED — more claimed out than
      //    received = theft / dilution / counterfeit, caught with no investigation. Only compares like base units.
      let flagged = 0;
      for (const n of nodeArr) {
        const kids = edges.filter((e) => e.from === n.chit_id).map((e) => nodes.get(e.to)).filter(Boolean);
        if (!kids.length || n.base_qty == null) { n.balance = null; continue; }         // a leaf, or no quantity to balance
        if (!kids.every((k) => k.base_qty != null && k.base_unit === n.base_unit)) { n.balance = { status: 'unknown' }; continue; }
        const out = kids.reduce((s, k) => s + k.base_qty, 0);
        const delta = out - n.base_qty;
        const red = delta > 1e-9;
        if (red) flagged++;
        n.balance = { in: n.base_qty, out, delta, base_unit: n.base_unit, status: red ? 'red' : 'ok' };
      }
      return res.json({ dir, start: id, reachable_count: nodeArr.length,
        depth_max: nodeArr.reduce((m, n) => Math.max(m, n.depth), 0),
        flagged,
        terminals: terminals.map((t) => ({ chit_id: t.chit_id, product: t.product })),
        nodes: nodeArr, edges });
    }

    // backward: follow parents toward the origin (records every visible parent edge; advances along the first visible parent).
    let current = id, depth = 0; const path = [id];
    while (depth < MAX_DEPTH) {
      const cur = nodes.get(current);
      const parents = cur ? cur.parents : [];
      if (!parents || !parents.length) break;   // origin — or an honest dead-end where provenance isn't co-held
      let advanced = null;
      for (const p of parents) {
        const pr = await fetch1(p);
        if (pr.rows[0]) { addEdge(p, current); put(pr.rows[0], depth + 1); if (!advanced) advanced = p; }
      }
      if (!advanced) break;
      path.push(advanced); current = advanced; depth++;
    }
    return res.json({ dir, start: id, hops: path.length - 1, path: path.slice().reverse(), nodes: [...nodes.values()], edges });
  } catch (err) {
    res.status(500).json({ error: 'Trace walk failed', message: safeErr(err) });
  }
});

// ─── GET /chits/trace/batches ───────────────────────────────────────────────────────────────────────────────
// List the trace-carrying chits the caller holds, so the screen can offer clickable batches (no pasting an id).
// RLS-scoped — the operator sees its network's batches, a party sees only its own; origins listed first.
router.get('/trace/batches', auth, async (req, res) => {
  try {
    const me = entityId(req);
    const toName = (row) => { let a = row.all_recipients; if (typeof a === 'string') { try { a = JSON.parse(a); } catch (_) { a = []; } }
      a = Array.isArray(a) ? a : []; const rec = a.find((x) => x.role && x.role !== 'sender' && x.role !== 'operator'); return rec ? rec.display_name : null; };
    const r = await withEntity(me, (db) => db.query(
      `SELECT chit_id, sender_entity_display_name, all_recipients, summary_json->'trace' AS trace, created_at
         FROM chit_header
        WHERE summary_json->'trace' IS NOT NULL
        ORDER BY ((summary_json->'trace'->>'is_origin') = 'true') DESC, created_at DESC
        LIMIT 200`));
    const seen = new Set(); const batches = [];
    for (const row of r.rows) {
      if (seen.has(row.chit_id)) continue; seen.add(row.chit_id);
      const t = row.trace || {};
      batches.push({ chit_id: row.chit_id, product: t.product || null, qty: (t.qty ?? null), unit: t.unit || null,
        is_origin: !!t.is_origin, network: (t.network && t.network.id) || null, sender_name: row.sender_entity_display_name || null, to_name: toName(row) });
    }
    res.json({ count: batches.length, batches });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list batches', message: safeErr(err) });
  }
});

// ─── GET /chits/trace/by-batch?q=<batch> ────────────────────────────────────────────────────────────────────
// Reconstruct the chain from SHARED DATA (a batch number) instead of the parent links — proves the graph survives
// even if the explicit links weren't followed. Finds the caller's chits carrying that batch, then rebuilds the
// directed chain by PARTY-CHAINING: X → Y when the receiver of X is the sender of Y. No parent_chit_ids used.
// RLS-scoped (you match only within what you hold). Same response shape as the walk, so the tree render is reused.
router.get('/trace/by-batch', auth, async (req, res) => {
  try {
    const me = entityId(req);
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'Bad request', message: 'A batch value (q) is required' });
    const recipientOf = (row) => { let a = row.all_recipients; if (typeof a === 'string') { try { a = JSON.parse(a); } catch (_) { a = []; } }
      a = Array.isArray(a) ? a : []; return a.find((x) => x.role === 'receiver') || a.find((x) => x.role && x.role !== 'sender' && x.role !== 'operator') || null; };
    const r = await withEntity(me, (db) => db.query(
      `SELECT chit_id, sender_entity_id, sender_entity_display_name, all_recipients, summary_json->'trace' AS trace
         FROM chit_header
        WHERE summary_json->'trace' IS NOT NULL
          AND lower(summary_json->'trace'->>'product') = lower($1)`, [q]));
    const seen = new Set(); const items = [];
    for (const row of r.rows) {
      if (seen.has(row.chit_id)) continue; seen.add(row.chit_id);
      const rec = recipientOf(row); const t = row.trace || {};
      items.push({ chit_id: row.chit_id, sender_entity_id: row.sender_entity_id, sender_name: row.sender_entity_display_name || null,
        to_entity_id: rec ? rec.entity_id : null, to_name: rec ? rec.display_name : null,
        product: t.product || null, qty: (t.qty ?? null), unit: t.unit || null, base_qty: (t.base_qty ?? null), base_unit: t.base_unit || null });
    }
    // rebuild edges: X → Y when receiver(X) === sender(Y). Pure data correlation, no links.
    const bySender = {}; items.forEach((it) => { (bySender[it.sender_entity_id] = bySender[it.sender_entity_id] || []).push(it); });
    const edges = []; const hasParent = new Set();
    items.forEach((x) => (bySender[x.to_entity_id] || []).forEach((y) => { if (y.chit_id !== x.chit_id) { edges.push({ from: x.chit_id, to: y.chit_id }); hasParent.add(y.chit_id); } }));
    const nmap = {}; items.forEach((it) => { nmap[it.chit_id] = Object.assign({}, it, { depth: 0, is_origin: !hasParent.has(it.chit_id) }); });
    // BFS depth from the roots
    const kidsMap = {}; edges.forEach((e) => { (kidsMap[e.from] = kidsMap[e.from] || []).push(e.to); });
    let frontier = items.filter((it) => !hasParent.has(it.chit_id)).map((it) => it.chit_id);
    const seenD = new Set(frontier); let d = 0;
    while (frontier.length && d < 60) { const next = []; frontier.forEach((id) => (kidsMap[id] || []).forEach((k) => { if (!seenD.has(k)) { seenD.add(k); nmap[k].depth = d + 1; next.push(k); } })); frontier = next; d++; }
    const nodeArr = Object.values(nmap);
    // mass-balance, same invariant as the walk
    let flagged = 0;
    for (const n of nodeArr) {
      const kids = (kidsMap[n.chit_id] || []).map((id) => nmap[id]).filter(Boolean);
      if (!kids.length || n.base_qty == null) { n.balance = null; continue; }
      if (!kids.every((k) => k.base_qty != null && k.base_unit === n.base_unit)) { n.balance = { status: 'unknown' }; continue; }
      const out = kids.reduce((s, k) => s + k.base_qty, 0); const delta = out - n.base_qty; const red = delta > 1e-9; if (red) flagged++;
      n.balance = { in: n.base_qty, out, delta, base_unit: n.base_unit, status: red ? 'red' : 'ok' };
    }
    const terminals = nodeArr.filter((n) => !edges.some((e) => e.from === n.chit_id));
    res.json({ dir: 'forward', by_batch: q, reconstructed: true, start: (nodeArr[0] && nodeArr[0].chit_id) || null,
      reachable_count: nodeArr.length, depth_max: nodeArr.reduce((m, n) => Math.max(m, n.depth), 0), flagged,
      terminals: terminals.map((t) => ({ chit_id: t.chit_id, product: t.product })), nodes: nodeArr, edges });
  } catch (err) {
    res.status(500).json({ error: 'Batch trace failed', message: safeErr(err) });
  }
});

// ─── GET /chits/trace/networks ──────────────────────────────────────────────────────────────────────────────
// The networks the caller participates in (derived from the edges it co-holds — migration-free registry seed).
// Supports "an entity can be in many networks" + "see where you are": lists each network id, whether the caller
// is its operator, and how many edges it holds there. RLS-scoped, so you only see networks you're actually in.
router.get('/trace/networks', auth, async (req, res) => {
  try {
    const me = entityId(req);
    const r = await withEntity(me, (db) => db.query(
      `SELECT summary_json->'trace'->'network'->>'id' AS network_id,
              bool_or((summary_json->'trace'->'network'->>'operator') = $1) AS is_operator,
              count(DISTINCT chit_id) AS edges
         FROM chit_header
        WHERE summary_json->'trace'->'network'->>'id' IS NOT NULL
        GROUP BY 1
        ORDER BY edges DESC`, [me]));
    res.json({ networks: r.rows.map((x) => ({ network_id: x.network_id, is_operator: !!x.is_operator, edges: Number(x.edges) })) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list networks', message: safeErr(err) });
  }
});

module.exports = router;
