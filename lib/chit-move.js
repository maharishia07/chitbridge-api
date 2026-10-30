// @stage tested
// @stage-note The ONE status writer over lib/rail-status: validate (rail.move), write, stamp the freeze, tell the books, log the step, run the cancel legs. Lifted unchanged from routes/chits.js (LEAN-PLAN §8 #3) so lib no longer requires a route.
// CARD 01-rail-core-the-chit/chit-move
// owns: moveStatus(entity_id, chit_id, new_status, by, note, me) and its legs (cancelSentCopy, readThenWriteMove, readMoveHeader, writeOrConflict).
// called by: routes/chits.js (PUT /:chit_id/status · goods-in accept) · lib/books-hooks.js (a posted counter sale closes through it) · lib/repeat-supply.js (the customer accepts).
// FLOW  routes/chits.js or a lib door → moveStatus → withEntity → lib/rail-status statusGate (rail.move + compare-and-set) → freeze · books hook · timeline row → cancel legs
'use strict';
const cbLog = require('./logger');
const log = require('./logger');
const { withEntity } = require('../db');
const schema = require('./schema');
const railActions = require('./rail-actions');
const railStatus = require('./rail-status');
const disputeMay = require('./dispute-may');
const taxCopy = require('./tax-copy');
const FOLDER_INV = require('./folder-inventory');
const billPrivacy = require('./bill-privacy');
const { crossing, postMessageCopies } = require('./chit-crossing');

/**
 * the sender's own cancel leg (T1-RAIL + H3): my SENT copy goes through the same rail gate, the sale it posted is reversed in that SAME
 * transaction (a books refusal is SAID on the answer — { refused }, never swallowed), and the withdrawal message goes to the recipients.
 * → the books' answer for the cancel (the reversal · { none } · { refused }) or undefined. A sent copy the rail will not cancel stays, said in the log.
 */
async function cancelSentCopy(entity_id, chit_id, viewer, note, by) {
  const hooks = require('./books-hooks');
  const sent = await withEntity(entity_id, async (db) => {
    const gate = await railStatus.statusGate(db, entity_id, chit_id, 'cancelled', viewer, { copy: 'sent' });
    if (!gate.ok) return gate;
    await gate.write();
    gate.books = await hooks.chitWithdrawnSaid(db, entity_id, chit_id, note, by.id);
    return gate;
  });
  if (!sent.ok && sent.why !== 'not_received') log.warn('sent copy not cancelled', { chit_id, from: sent.from, why: sent.why });
  await postMessageCopies({
    chit_id,
    sender_entity_id: entity_id,
    sender_display_name: by.name,
    thread_type: 'external',
    msg_type: 'action',
    message_text: `[cancel requested] ${note || 'The sender has cancelled and requests you cancel your copy.'}`
  });
  return sent.books;
}
/** ORD-FIX O6: write the caller's OWN received copy (the gate said yes) — compare-and-set, so someone who moved it a moment ago wins; → `done` for the writer, a `conflict` stop for the loser */
async function writeOrConflict(verdict, done) {
  try {
    await verdict.write();
    return done;
  } catch (e) {
    if (e && e.code === 'status_conflict') return { stop: 'conflict', message: e.message };
    throw e;
  }
}
/** the copy the freeze reads, or the narrow header read: one statement either way */
async function readMoveHeader(db, chit_id, entity_id, new_status) {
  /**
   * ⭐ THE FREEZE'S COPY, READ HERE RATHER THAN IN ITS OWN TRANSACTION. G3 stamps the invoice when this
   * copy reaches `completed`, and it was re-reading the very row this transaction has open — a second
   * BEGIN · set_config · SELECT · COMMIT for chit_header, four trips to fetch what was already in hand.
   * ⚠️ Only on `completed`; every other status takes the narrow read below and nothing more.
   */
  const copy = new_status === 'completed' ? await taxCopy.copyOn(db, chit_id, entity_id) : undefined;
  /* ⚠️ AND THE NARROW READ IS THE ELSE, NOT AN EXTRA. The wide copy already carries sender_entity_id, so
     reading chit_header twice in one transaction — which is what the first cut of this left behind — was
     a statement spent on a column already on the row above. */
  const header =
    copy !== undefined
      ? { rows: copy ? [copy] : [] }
      : await db.query(
          /* purpose + business_json: what lib/bill-privacy needs to know this copy is a bill (same row, same trip) */
          `SELECT sender_entity_id, purpose, business_json FROM chit_header WHERE chit_id = $1 AND entity_id = $2`,
          [chit_id, entity_id]
        );
  return { copy, header };
}
/** true when a bill is being rejected with no reason: the reason is the note, and a bill's reject asks for it (a task keeps its own ask) */
function rejectLacksReason(new_status, note, header, entity_id) {
  return new_status === 'rejected' && !String(note || '').trim() && FOLDER_INV.docOf(header.rows[0], entity_id) === 'bill_received';
}
/** the first half of a status move, inside the transaction: the verdict (rail-status statusGate), the open-dispute count, the copy the freeze reads, then the write — or a marker saying why it stopped */
async function readThenWriteMove(db, press) {
  const { entity_id, chit_id, new_status, note, checkDisputes } = press;
  /* B1 RLS: own received-copy read — and the gate for everything below it */
  /* ⭐ R01 — THE ENGINE DECIDES (lib/rail.js move): level → my received copy → the transition table. This route reads
     ONLY my received copy, so "no copy" and "only the sent copy" are one answer here: not_received, said as the 404 it
     always was. ⭐ T1-RAIL: the read, the verdict and the write are lib/rail-status statusGate — the same one every door uses. */
  const verdict = await railStatus.statusGate(db, entity_id, chit_id, new_status, press.me);
  const previous_status = verdict.from;
  if (!verdict.ok && verdict.why === 'not_received') return { stop: 'missing', why: verdict.why };
  if (!verdict.ok && verdict.why !== 'wrong_step') return { stop: 'level', why: verdict.why };

  /* Idempotent: advancing to the status it is already in is a no-op success, not a 400. Fixes the
     "Cannot move from accepted to accepted" error when a self-chit's displayed copy diverges. */
  if (verdict.noop) return { stop: 'noop', previous_status };

  if (!verdict.ok) return { stop: 'invalid', previous_status, allowed: verdict.allowed, why: verdict.why };

  /* the ONE open-dispute count (lib/dispute-may openOn, W2-RAIL R2). Closing never blocks on a dispute (C1 above), so an
     unreadable count (null, logged there) only loses the warning — delete and archive, which DO block, refuse on it. */
  const openCount = checkDisputes ? (await disputeMay.openOn(db, chit_id)) || 0 : 0;
  const { copy, header } = await readMoveHeader(db, chit_id, entity_id, new_status);
  /* ⭐ FX-F10W2: REJECTING A BILL SAYS WHY (lib/workflow needsOf: reject → reason; the chit read answers actions.reject.needs). The
     reason is the note — it goes on the chit's history. Refused before the write, said; a task keeps its own ask. */
  if (rejectLacksReason(new_status, note, header, entity_id)) return { stop: 'reason', previous_status };
  return writeOrConflict(verdict, { previous_status, openCount, header, copy });
}
/** the word for a move the rail or the copy stopped, OUTSIDE the transaction (the early returns are markers, see readThenWriteMove) → { code, body }, or null when the move went through */
function refusalOf(_pre, chit_id, new_status) {
  if (_pre.stop === 'missing') {
    return { code: 404, body: { error: 'Not found', message: 'Chit not found', why: _pre.why } };
  }
  /* the hat gate refuses a viewer / commenter before this route runs; the engine says the same if one ever gets here */
  if (_pre.stop === 'level') {
    return { code: 403, body: { error: 'Not permitted', message: railActions.WHY[_pre.why], why: _pre.why } };
  }
  if (_pre.stop === 'noop') {
    return { code: 200, noop: true, body: { message: `Already ${new_status}`, chit_id, status: new_status, noop: true } };
  }
  if (_pre.stop === 'conflict') return { code: 409, body: { error: 'Status changed', code: 'status_conflict', message: _pre.message } };
  if (_pre.stop === 'reason') {
    return {
      code: 400,
      body: {
        error: 'Reason required',
        code: 'reason_required',
        message: 'Say why you are rejecting this bill — the reason goes on the bill.',
        why: 'reason_required'
      }
    };
  }
  if (_pre.stop === 'invalid') {
    return {
      code: 400,
      body: {
        error: 'Invalid transition',
        message: `Cannot move from ${_pre.previous_status} to ${new_status}`,
        allowed_transitions: _pre.allowed,
        why: _pre.why
      }
    };
  }
  return null;
}
/** ⭐ G3 — the freeze: on `completed` the invoice is stamped on MY copy; it fails open (the move stands without it) */
async function freezeInvoice(entity_id, chit_id, new_status, copy) {
  if (new_status !== 'completed') return;
  try {
    await taxCopy.freezeOnComplete(chit_id, entity_id, copy);
  } catch (e) {
    cbLog.fellBack('chits moveStatus: failed — carried on without it', e);
  }
}
/** the books hear of a move that reaches the ledger (after the commit, never awaited, never able to fail the status change) */
function tellBooks(entity_id, chit_id, new_status, action_by_id) {
  /**
   * ⭐⭐ THE BUYER'S ACCEPTANCE REACHES THE LEDGER (Athi, 2026-10-01: "a checking mechanism in the rail to allow it to the
   * sundry creditor"). A bill I RECEIVED posts as my purchase only once MY copy is accepted / in_progress / completed
   * (lib/books-hooks buyerGate) — and THIS is the one transition that says so. After the commit, never awaited, never
   * able to fail the status change; off it is one cached read. Idempotent on the chit (source_ref chit:<id>), so a
   * second door firing the same acceptance posts nothing twice.
   */
  /* FX-F10W2: a rejection / cancellation reaches the books too — it never posts, and the bill's Waiting row closes as "Rejected — not posted" */
  if (/^(accepted|in_progress|completed|rejected|cancelled)$/.test(new_status)) {
    try {
      const hooks = require('./books-hooks');
      setImmediate(() => hooks.afterChit(entity_id, chit_id, action_by_id));
    } catch (e) {
      require('./logger').warn('books.hook-not-reached', {
        entity_id,
        chit_id,
        status: new_status,
        error: String((e && e.message) || e),
        then: 'the nightly sweep posts or closes it'
      });
    }
  }
}
/** the timeline line of a move: a bill's own step (never fanned), or one log row per participant */
async function writeTimeline(entity_id, chit_id, new_status, press) {
  const { previous_status, header, detail, by, note } = press;
  const action_by_id = by.id,
    action_by_name = by.name;
  const _hrow = (header && header.rows && header.rows[0]) || null;
  /**
   * ⭐⭐ A BILL'S STATUS IS THE HOLDER'S OWN STEP (Athi, 2026-10-01: "goods verified and accounted are internal status, not
   * between two shops"). On a bill copy the change is written ONCE, as a bill_step at the level of the folder that owns it
   * (B-2100 for a bill I received, B-1300 for one I issued — internal by default, never external): my history only, or
   * nothing. It is no longer fanned into the other shop's timeline, feed or bell. Every other chit logs as it always did.
   */
  if (_hrow && billPrivacy.isBill(_hrow, entity_id)) {
    try {
      await billPrivacy.writeStep(
        entity_id,
        chit_id,
        { code: billPrivacy.ownerCode(_hrow, entity_id), step: new_status, label: billPrivacy.STATUS_LABEL[new_status] || new_status, note: note || undefined },
        { id: action_by_id, name: action_by_name }
      );
    } catch (e) {
      cbLog.fellBack('chits status: the bill step was not written — the status change stands without it', e);
    }
  } else
    await crossing(
      entity_id,
      `SELECT chit_log_all($1,$2,$3,$4,$5,$6,$7)`,
      [chit_id, `status_${new_status}`, action_by_id, action_by_name, previous_status, new_status, detail],
      (db) =>
        db.query(
          `INSERT INTO state_log
           (chit_id, entity_id, action, action_by_identity_id,
            action_by_display_name, previous_status, new_status, detail)
           SELECT $1, entity_id, $2, $3, $4, $5, $6, $7
           FROM (SELECT DISTINCT entity_id FROM chit_status WHERE chit_id = $1) cs`,
          [chit_id, `status_${new_status}`, action_by_id, action_by_name, previous_status, new_status, detail]
        )
    );
}
/** the return leg of a recipient's cancel: the sender's copy is stamped "cancel confirmed" and told, when this copy was actually asked */
/**
 * ⭐⭐ THE RETURN LEG (b197) — Athi, 2026-09-02: *"on cancelling the requester should be notified as well
 * and his flag to set as cancelled, change from cancel requested to cancelled in the order copy as well."*
 *
 * A withdrawal without this is a request with no reply: the sender could see that they had ASKED and never
 * that anyone AGREED. b195 answers "somebody asked me"; this answers the opposite question, which is the
 * one the person who withdrew is actually holding.
 *
 * ⚠️ ONLY WHEN THIS COPY WAS ACTUALLY ASKED. A recipient may cancel for their own reasons and that is not a
 * reply to anything — reporting it to the sender as a confirmation would credit them with an agreement
 * nobody made. `cancel_requested_at` being set is what makes this an answer rather than a coincidence.
 *
 * ⚠️ WITHIN THE SENDER'S CONTEXT, NOT A NULL ONE. The b49 policy is `entity_id = NULLIF(current_setting(…),
 * '')::uuid`, so a null context matches NOTHING and the UPDATE would write nowhere, silently — the exact
 * mistake b195 shipped with, caught only by the end-to-end spec.
 */
async function confirmCancelToSender(entity_id, chit_id, header, by) {
  const action_by_name = by.name;
  try {
    if (await schema.hasColumn('chit_status', 'cancel_confirmed_at')) {
      const senderId = header.rows.length ? header.rows[0].sender_entity_id : null;
      const asked = await withEntity(entity_id, (db) =>
        db.query(`SELECT cancel_requested_at FROM chit_status WHERE chit_id = $1 AND entity_id = $2`, [chit_id, entity_id])
      );
      const wasAsked = !!(asked.rows[0] && asked.rows[0].cancel_requested_at);
      if (senderId && senderId !== entity_id && wasAsked) {
        await withEntity(senderId, (db) =>
          db.query(
            `UPDATE chit_status
                  SET cancel_confirmed_at = NOW(), cancel_confirmed_by = $2
                WHERE chit_id = $1 AND entity_id = $3`,
            [chit_id, action_by_name, senderId]
          )
        );
        await postMessageCopies({
          chit_id,
          sender_entity_id: entity_id,
          sender_display_name: action_by_name,
          thread_type: 'external',
          msg_type: 'action',
          message_text: `[cancel confirmed] ${action_by_name} has cancelled their copy.`
        });
      }
    }
  } catch (e) {
    cbLog.fellBack('chits status: the cancel confirm was not stamped — the cancel stands without it', e);
  }
}
/** a move to `cancelled`: the sender cancels ITS OWN copy and asks the others (→ what the books did), a recipient confirms back to the sender; any other move has no cancel leg */
async function cancelLegs(entity_id, chit_id, new_status, press) {
  if (new_status !== 'cancelled') return null;
  const { header, viewer, note, by } = press;
  const isSender = header.rows.length > 0 && header.rows[0].sender_entity_id === entity_id;
  // Sender cancel = a REQUEST, never a cross-entity write (Athi): the sender cancels ITS OWN copy and delivers a
  // flagged "[cancel requested]" message to the recipients; each recipient cancels its own copy at its own will.
  if (isSender) return cancelSentCopy(entity_id, chit_id, viewer, note, by);
  await confirmCancelToSender(entity_id, chit_id, header, by);
  return null;
}
/** the 200 of a status that really moved */
function movedAnswer(done) {
  const { chit_id, previous_status, new_status, disputeWarning, booksOnCancel } = done;
  return {
    code: 200,
    moved: true,
    body: {
      message: `Chit ${new_status}`,
      warning: disputeWarning, // C1: set when a disputed chit was closed anyway (UI shows who + that it was open)
      chit_id,
      previous_status,
      new_status,
      ...(booksOnCancel ? { books: booksOnCancel } : {}) // H3 (only when the cancel touched the books — every other move answers as it always did): the reversal the cancel posted (entry_no · reverses), { none } when nothing was posted, { refused } in words
    }
  };
}
/**
 * ⭐⭐ ONE TRANSITION, MANY DOORS (Athi, 2026-10-01: "one fact, three doors"). The body of PUT /:chit_id/status, lifted
 * out unchanged so that goods-in (POST /:chit_id/deliver-lines, all lines received) moves a bill to `accepted` through the
 * SAME validation, timeline row, ledger hook and cancel legs as Intake — never a second status writer.
 * → { code, body, moved?, noop? }  — the caller answers with code/body; `moved` = a status actually changed.
 */
async function moveStatus(entity_id, chit_id, new_status, by, note, viewer) {
  /* ⭐ R01: the transition table that lived here (validTransitions) is the rail engine's TRANSITIONS now, verbatim, and the
         decision is rail.move — the same function GET /chits/:id answers `actions` with. `viewer` = railActions.meOf(req). */
  if (!viewer) throw new Error('moveStatus: who is moving it (railActions.meOf(req)) is required');

  // C1 (per Athi 2026-07-05): closing a DISPUTED chit (completed/cancelled) is ALLOWED, but we WARN + record WHO did it
  // (surfaced to the UI + written to the timeline). Archive/delete still hard-block — a separate, stricter rule.
  const _checkDisputes = ['completed', 'cancelled'].includes(new_status) && (await schema.hasTable('chit_disputes'));

  const _pre = await withEntity(entity_id, (db) => readThenWriteMove(db, { entity_id, chit_id, new_status, me: viewer, note, checkDisputes: _checkDisputes }));

  /* ⭐ the early returns, OUTSIDE the transaction — see the note above on why they are markers */
  const refusal = refusalOf(_pre, chit_id, new_status);
  if (refusal) return refusal;
  const previous_status = _pre.previous_status;
  await freezeInvoice(entity_id, chit_id, new_status, _pre.copy);
  tellBooks(entity_id, chit_id, new_status, by.id);

  const disputeWarning = _pre.openCount > 0 ? `Chit closed with an OPEN dispute — by ${by.name}.` : null;
  // One log row per participant — a CROSS-entity write, so via the b50 delivery-agent fn chit_log_all
  // (validated: caller must be a participant). Fallback = the legacy INSERT...SELECT when b50 isn't applied.
  const detail = (note || `Status changed from ${previous_status} to ${new_status} by ${by.name}`) + (disputeWarning ? ` ⚠ ${disputeWarning}` : '');
  await writeTimeline(entity_id, chit_id, new_status, { previous_status, header: _pre.header, detail, by, note });

  const booksOnCancel = await cancelLegs(entity_id, chit_id, new_status, { header: _pre.header, viewer, note, by });
  return movedAnswer({ chit_id, previous_status, new_status, disputeWarning, booksOnCancel });
}

module.exports = { moveStatus };
