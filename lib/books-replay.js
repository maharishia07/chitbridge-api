// @stage tested
// @stage-note [CB FINANCE] FIN-63 step 2: the one rule that tells a pressed-again allocation (a replay) from a real further one. Pure: rows in, answer out.
'use strict';
/**
 * lib/books-replay.js — A REPEATED CONFIRM ANSWERS duplicate: true AND NEVER SETTLES TWICE (FIN-63 step 2; plan C:/dev/PM/FIN-63-STEP2-PLAN.md v3;
 * decision FIN-63b, Athi 2026-11-05: a 2-minute window, and an identical top-up inside it on the latest batch counts as a replay).
 *
 * ⭐ A BATCH is the allocation rows one confirm wrote for a payment (ref = 'pay:<id>', ref_kind 'allocation'): Postgres stamps `created_at` with the
 *   TRANSACTION START, so one confirm's rows share it. Batches are RANKED by their highest item_id, never by created_at: a confirm that started
 *   earlier and waited on the C3 lock carries an EARLIER stamp than the batch that committed first, and item_id (a sequence taken at insert) follows
 *   the lock order. pg returns the bigint item_id as a string: it is compared as a BigInt.
 * ⭐ A batch is LIVE when no row of it is named by a reversal row's `reverses` (the engine's live() rule applied to the api rows; FIN-64 releases both halves).
 * ⭐ REPLAY iff the payment's LATEST live batch (a) has the same fingerprint, and (b) is within ALLOC_REPLAY_WINDOW_MS. Otherwise the allocation is a
 *   further one and confirmItems judges it (it REFUSES more than the payment has left or the bill owes, it never caps).
 * ⭐ A replay skips bill-privacy.moneySteps ON PURPOSE (routes/books.js): moneySteps has no replay key, so a re-run would write each R-1400 step twice.
 *   Consequence: a replay never repairs a first attempt whose post-commit steps failed (a follow-up for finance and rail, not this file).
 * ⭐ The fingerprint is lib/canon.hash of { pay, alloc: [[against_ref, amount_minor], …] }, against_ref trimmed, zero amounts dropped, sorted by
 *   against_ref. Nothing is stored: a stored batch is rebuilt from its "−" halves and hashed by the SAME function.
 *
 * owns: allocationHash · replayOf · ALLOC_REPLAY_WINDOW_MS — nothing else decides what a replay is
 * called by: lib/books.js writeAllocation (only when the event carries replay: true — POST /payments/:id/confirm)
 * FLOW  the payment's party rows (read under the C3 lock) ──▶ liveBatches ──▶ replayOf ──▶ the first answer + duplicate: true, or null
 * // CARD 16-finance/collections
 */
const canon = require('./canon');

/** how long an identical allocation on the latest batch is "the same press again" (FIN-63b: 2 minutes) */
const ALLOC_REPLAY_WINDOW_MS = 2 * 60 * 1000;

const byRef = (first, second) => (first[0] < second[0] ? -1 : first[0] > second[0] ? 1 : 0);

/** the fingerprint of an allocation: the payment and its [against_ref, amount_minor] pairs (zeros dropped, sorted) */
function allocationHash(payment_id, pairs) {
  const alloc = (pairs || [])
    .filter((pair) => Number(pair[1]) > 0)
    .map((pair) => [String(pair[0]).trim(), Number(pair[1])])
    .sort(byRef);
  return canon.hash({ pay: 'pay:' + payment_id, alloc });
}

/** a created_at as a number, whether the store answered a Date or an ISO string */
const stampOf = (created) => new Date(created).getTime();

/** the payment's allocation rows grouped into batches (one created_at each), live ones only, oldest first by their highest item_id */
function liveBatches(rows, payment_id) {
  const ref = 'pay:' + payment_id,
    gone = new Set((rows || []).filter((row) => row.ref_kind === 'reversal' && row.reverses != null).map((row) => String(row.reverses))),
    byStamp = new Map();
  (rows || []).forEach((row) => {
    if (row.ref_kind !== 'allocation' || row.ref !== ref) return;
    const key = stampOf(row.created_at),
      batch = byStamp.get(key) || { rows: [], at: key, top: BigInt(0), live: true };
    batch.rows.push(row);
    batch.live = batch.live && !gone.has(String(row.item_id));
    const id = BigInt(String(row.item_id));
    if (id > batch.top) batch.top = id;
    byStamp.set(key, batch);
  });
  return Array.from(byStamp.values())
    .filter((batch) => batch.live)
    .sort((first, second) => (first.top < second.top ? -1 : first.top > second.top ? 1 : 0));
}

/** a stored batch's pairs, rebuilt from its "−" halves (the half against the bill, not the payer's own half) */
function pairsOfBatch(batch, payment_id) {
  const ref = 'pay:' + payment_id;
  return batch.rows.filter((row) => row.against_ref !== ref).map((row) => [row.against_ref, -row.amount_minor]);
}

/**
 * replayOf(rows, payment_id, pairs, nowMs) → the first answer plus duplicate: true when this allocation is the latest live batch pressed again
 * inside the window; null when it is a further allocation. The answer is read from the stored rows, so it equals the first one.
 */
function replayOf(rows, payment_id, pairs, nowMs) {
  const live = liveBatches(rows, payment_id),
    latest = live[live.length - 1];
  if (!latest || nowMs - latest.at > ALLOC_REPLAY_WINDOW_MS) return null;
  if (allocationHash(payment_id, pairsOfBatch(latest, payment_id)) !== allocationHash(payment_id, pairs)) return null;
  const allocated = latest.rows.filter((row) => row.amount_minor < 0).reduce((total, row) => total - row.amount_minor, 0);
  return { ok: true, items: latest.rows.length, allocated_minor: allocated, duplicate: true };
}

module.exports = { ALLOC_REPLAY_WINDOW_MS, allocationHash, replayOf };
