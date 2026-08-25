'use strict';
// lib/mint.js — the SHAPE of a chit, in one place. Four call sites built it independently.
//
// ── ⚠️ WHAT THIS IS, AND DELIBERATELY IS NOT ────────────────────────────────────────────────────────────────────
// It is NOT a `mintChit()` that owns sending. Four paths mint chits and their POLICY is genuinely different:
//   · /api/chits/send   — recipient resolution, caps, trace edges, copy_policy, retention, freeze-at-send, drafts
//   · emitSignalChit    — no line items, Task-only by nature, auto-files into a folder afterwards
//   · deliverEdge       — a co-held 2-party network edge, currency resolved by the governance layer
//   · storefront order  — consumes the customer's OTP and stores documents in the SAME transaction
// A single function serving all four would need a dozen flags, and a helper with a dozen flags is worse than four
// copies: it hides the differences instead of removing them.
//
// What IS identical in all four is the SHAPE — the summary skeleton, the header key-set, what a copy is, and the
// delivery call. That is what lives here. Each path keeps its own policy and composes these.
//
// ── ⚠️ WHY IT MATTERS MORE THAN TIDINESS ────────────────────────────────────────────────────────────────────────
// Duplication in this codebase has twice absorbed a security fix (lib/otp.js, lib/bridgeid.js): a reviewer found a
// real flaw, the fix was correct, and it reached one call site of several. The same risk lives here in a worse
// place — a key added to summary_json in one path and not the others means two copies of ONE chit disagree about
// what that chit is, which is exactly the dispute the rail exists to prevent.
const { withEntity } = require('../db');
const { v4: uuidv4 } = require('uuid');

/**
 * summary(fields) — the summary_json skeleton every path starts from.
 *
 * ⚠️ THE DEFAULTS ARE THE CONTRACT. Every path wrote these seven keys by hand with the same values; one omission
 * and a chit's summary silently lacks a field that readers (lists, sorting, kyb's trade-value sum) expect.
 * `total_value: null` means NOT APPLICABLE and is not the same as 0 — deliverEdge carried a hard-coded 0 for
 * network orders that had real line items, which made them read as worth nothing.
 */
function summary(f = {}) {
  const s = {
    line_item_count: f.line_item_count || 0,
    total_value: f.total_value === undefined ? 0 : f.total_value,
    currency_code: f.currency_code || 'INR',
    priority_external: f.priority_external || 'normal',
    purpose: f.purpose || 'order',
    is_promotion: !!f.is_promotion,
    forwarded_from: f.forwarded_from === undefined ? null : f.forwarded_from,
  };
  // Riders — present ONLY when declared, exactly as each path already does it (copy_policy, trace, retention,
  // governed, clearances, commercial, via). Spreading an absent rider would add `key: undefined`, which JSON.stringify
  // drops silently on the way in and readers then cannot tell "absent" from "null".
  /**
   * ⚠️⚠️ THE LIST IS THE GATE, AND IT DROPS IN SILENCE. `detail_design` was passed in from the send path and
   * never appeared in a single chit, because a rider not named here is discarded without a word — which is
   * exactly what this whitelist is for, and exactly why forgetting it costs a debugging session. Anything new
   * that must survive into summary_json is added HERE, not spread in by the caller.
   */
  for (const k of ['copy_policy', 'trace', 'retention', 'governed', 'clearances', 'commercial', 'via',
    'detail_design']) {
    if (f[k] !== undefined && f[k] !== null) s[k] = f[k];
  }
  return s;
}

/**
 * header(x) — the key-set shared by every copy of one chit.
 *
 * ⚠️ EVERY COPY OF A CHIT MUST CARRY THE SAME HEADER. That is the co-held record: two parties holding rows that
 * disagree on sender, subject, total or currency is not a chit, it is two documents. Building it once per chit and
 * spreading it into each copy is what makes that structural rather than a thing to remember.
 */
function header(x) {
  return {
    sender_entity_id: x.sender_entity_id,
    sender_entity_bridge_id: x.sender_entity_bridge_id,
    sender_entity_display_name: x.sender_entity_display_name,
    all_recipients: x.all_recipients,
    purpose: x.purpose,
    auto_subject: x.auto_subject,
    manual_subject: x.manual_subject === undefined ? null : x.manual_subject,
    summary_json: x.summary_json,
    schema_version: x.schema_version === undefined ? null : x.schema_version,
    schema_id: x.schema_id === undefined ? null : x.schema_id,
    created_by_actor_id: x.created_by_actor_id === undefined ? null : x.created_by_actor_id,
    detail_type: x.detail_type === undefined ? x.purpose : x.detail_type,
    line_item_count: x.line_item_count === undefined ? (x.summary_json && x.summary_json.line_item_count) || 0 : x.line_item_count,
    total_value: x.total_value === undefined ? (x.summary_json && x.summary_json.total_value) : x.total_value,
    currency_code: x.currency_code === undefined ? (x.summary_json && x.summary_json.currency_code) || 'INR' : x.currency_code,
  };
}

/**
 * ⭐ lines(items) — stamp every line with a STABLE IDENTITY and an EXPLICIT ORDER.
 *
 * Athi, 2026-08-12: *"the problem i faced earlier was, the one you selected comes as the last record in the line
 * item."*
 *
 * ── ⚠️ WHY A LINE NEEDED AN ID ──────────────────────────────────────────────────────────────────────────────────
 * `chit_detail.line_items` is ONE jsonb array per copy, so until now a line's only identity was its ARRAY INDEX.
 * b138 amendments key on that index. Insert or reorder a single line and every amendment silently re-points at a
 * different item — a corrected quantity would attach itself to somebody else's product, and the chit would look
 * perfectly normal. Nothing would ever flag it.
 *
 * ── ⚠️ AND WHY IT NEEDED A seq ──────────────────────────────────────────────────────────────────────────────────
 * "The one you selected comes last" is what array order looks like when nothing declares the order. Position was
 * implicit — whatever order the array happened to be built in, through a map, a filter, a merge. `seq` makes it a
 * stated fact, so a renderer sorts rather than trusts.
 *
 * GAPPED BY 10 (10, 20, 30…) so a line can later be inserted BETWEEN two others without renumbering the rest.
 * Renumbering would be safe for amendments now — they key on line_id, not position — but it would still churn
 * every row for one insertion.
 *
 * ⚠️ IDEMPOTENT. A line that already carries a line_id keeps it. Re-stamping on a forward, a draft resume or a
 * fork would mint new ids for the same lines and orphan every amendment pointing at the old ones.
 */
function lines(items) {
  if (!Array.isArray(items)) return items;
  return items.map((li, i) => Object.assign({}, li, {
    line_id: li.line_id || uuidv4(),
    seq: Number.isFinite(Number(li.seq)) ? Number(li.seq) : (i + 1) * 10,
  }));
}

/**
 * order(items) — read them back in the order they were stated.
 * ⚠️ line_id IS THE TIEBREAK, and it is not decoration: two lines sharing a seq would otherwise come back in
 * whatever order the array or the driver felt like, which is the same non-determinism in a new coat.
 */
function order(items) {
  if (!Array.isArray(items)) return items;
  return items.slice().sort((a, b) => {
    const d = (Number(a && a.seq) || 0) - (Number(b && b.seq) || 0);
    return d !== 0 ? d : String((a && a.line_id) || '').localeCompare(String((b && b.line_id) || ''));
  });
}

/**
 * party(hdr, p) — one entity's copy of the chit.
 *
 * `direction` ('sent' | 'received') and `role` ('Act' | 'Info' | 'For') are what make the two rows different; the
 * header is what makes them the same chit. Extra per-copy keys (line_items, business_json, payload_delivered) are
 * passed through untouched, because they legitimately differ per path.
 */
function party(hdr, p) {
  const c = Object.assign({}, hdr, {
    entity_id: p.entity_id,
    direction: p.direction,
    role: p.role || 'Act',
    current_status: p.current_status,
    priority_flag: p.priority_flag || 'normal',
  });
  if (p.business_json !== undefined) c.business_json = p.business_json;
  if (p.line_items !== undefined) c.line_items = p.line_items;
  if (p.payload_delivered !== undefined) c.payload_delivered = p.payload_delivered;
  if (p.log !== undefined) c.log = p.log;
  for (const k of Object.keys(p)) {
    if (['entity_id', 'direction', 'role', 'current_status', 'priority_flag', 'business_json', 'line_items', 'payload_delivered', 'log'].indexOf(k) < 0) c[k] = p[k];
  }
  return c;
}

/**
 * deliver(sender_entity_id, chit_id, copies, opts) — the ONE delivery call.
 *
 * ⚠️ `opts.client` EXISTS BECAUSE ONE PATH GENUINELY NEEDS IT. The storefront order consumes the customer's OTP and
 * stores their documents in the SAME transaction as the chit — writing the documents afterwards forced a choice
 * between "200 with documents_stored:false" (a chit asserting evidence nobody holds) and "500 on a submission that
 * already committed". Passing the open client keeps that atomic instead of forcing a second connection.
 *
 * ⚠️ AND IT RUNS AS THE SENDER. chit_deliver is a SECURITY DEFINER fn, and withEntity(sender) is its isolation gate:
 * every copy carries the same sender, and the sender is the caller. Running it as anyone else is how a cross-tenant
 * write would look.
 */
async function deliver(sender_entity_id, chit_id, copies, opts = {}) {
  const sql = 'SELECT chit_deliver($1,$2,$3::jsonb)';
  const args = [chit_id, !!opts.is_draft, JSON.stringify(copies)];
  const out = opts.client ? await opts.client.query(sql, args)
                          : await withEntity(sender_entity_id, (c) => c.query(sql, args));
  if (!opts.is_draft) autoFile(chit_id, copies);
  return out;
}

/**
 * autoFile — run each RECEIVER's folder rules against their new copy (b132).
 *
 * ⚠️ ONE HOOK, BECAUSE THERE IS NOW ONE DELIVERY. A week ago this would have needed four call sites and would have
 * diverged at the first one somebody forgot. The consolidation is what makes a rule engine cheap here.
 *
 * ⚠️ AFTER THE WRITE, NEVER INSIDE IT. Filing runs in the RECEIVER's tenant context, not the sender's — putting it
 * in the sender's transaction would be a cross-tenant write wearing a convenience. It is also deliberately not
 * awaited: a rules failure must never fail a delivery. A chit that arrives unfiled is an annoyance; a chit that
 * fails to arrive is a lost obligation.
 *
 * ⚠️ RECEIVED COPIES ONLY. A sender's own copy is not "arriving" anywhere, and filing it would put your own sent
 * chits into folders you built for inbound work.
 */
function autoFile(chit_id, copies) {
  setImmediate(async () => {
    try {
      const rules = require('./folder-rules');
      for (const c of (copies || [])) {
        if (c.direction !== 'received') continue;
        await rules.fileArrival(c.entity_id, {
          chit_id,
          manual_subject: c.manual_subject, auto_subject: c.auto_subject,
          counterparty_name: c.sender_entity_display_name,
          sender_entity_display_name: c.sender_entity_display_name,
          purpose: c.purpose, direction: 'received', current_status: c.current_status,
          summary_json: c.summary_json,
          value: c.total_value, read_at: null, open_disputes: 0,
          created_at: new Date().toISOString(),
        });
      }
    } catch (_) { /* best-effort by design — see above */ }
  });
}

module.exports = { summary, header, party, deliver, lines, order };
