// @stage tested
// @stage-note The ONE write of a chit copy's status: read my copy, ask the rail (rail.move), then write. moveStatus and every door that moves a status call it.
// CARD 01-rail-core-the-chit/status-the-one-status-writer
// owns: the ONE write of a chit copy's status (compare-and-set).
// called by: lib/chit-move.js moveStatus · lib/assign-chit.js · routes/actors.js · the void and cancel doors · lib/ctpreturn.js (mirror: a status another installation decided).
// FLOW  door opens its transaction → statusGate (read → rail.move) → write() [UPDATE … AND current_status = read RETURNING] → 409 for the loser
'use strict';
/**
 * lib/rail-status.js — ⭐⭐ THE ONE STATUS WRITE (T1-RAIL, 2026-10-14 · RC1 / DSP-ONE).
 *
 * Five doors wrote `chit_status.current_status` without asking the rail: auto-assign, assign-bulk, the co-assist pull and
 * push (all → pending) and the void route (→ cancelled — even from `completed`, which lib/rail.js forbids). The truth forked:
 * the action bar said one thing, the doors did another.
 *
 * ⭐ This is moveStatus's own read → rail.move → UPDATE, lifted so a door that already holds the row in ITS transaction can use
 * it there (calling moveStatus whole from inside would open a second transaction on a row the first one has locked, and fan an
 * internal assignment into the other party's timeline). moveStatus calls it; so does every other door. There is no other
 * `SET current_status` in lib/ or routes/ — tests/rail-status.test.cjs scans for one.
 *
 * ⭐ ORD-FIX O6: write() is compare-and-set — a copy that moved since the read refuses with a 409 `status_conflict` (never last-write-wins).
 *
 * statusGate(db, entity_id, chit_id, to, me, opts) — on the caller's open transaction `db` (withEntity(entity_id)):
 *   opts.copy  'received' (default) · 'sent' — which of MY copies moves
 *   opts.from  the copy's status when the caller already read it in this same transaction (saves the read)
 *   → { ok, why?, allowed?, noop?, from, copy, write }   — the rail's verdict (why is ALWAYS a rail.WHY key), plus write():
 *     write() runs the UPDATE when ok; a noop writes nothing; a refused verdict THROWS (a door can never write past a no).
 *
 * ⚠️ THE SENT COPY. The rail moves "my received copy" (rail.js header). A sender withdrawing ITS OWN copy is gated by the SAME
 * table over that copy's own status — the copy's status sits in the engine's `received` slot because it is the copy moving.
 * No second table. A copy that does not exist answers not_received, and the door decides what that means for it.
 */
const railActions = require('./rail-actions');

/* the copies a status lives on; each SQL below names its direction as a literal so the reads stay plain to RLS and to tests */
const COPIES = ['received', 'sent'];

/**
 * THE UPDATE ITSELF — the only SQL in the product that sets a chit copy's status, shared by write() and mirror() below.
 * ⭐ ORD-FIX O6: COMPARE-AND-SET. The write names the status the gate read; if another person moved the copy meanwhile no row
 * matches, and the loser is told (409 status_conflict) instead of overwriting — the winner's books hook is the only one that fired.
 */
function setStatus(db, to, chit_id, entity_id, copy, from) {
  return db.query(
    `UPDATE chit_status SET current_status = $1, updated_at = NOW()
        WHERE chit_id = $2 AND entity_id = $3 AND direction = '${copy}' AND current_status = $4
        RETURNING chit_id`,
    [to, chit_id, entity_id, from]
  );
}

/**
 * RAIL-106 · THE MIRROR of a status another installation decided. The party that moved its copy is on ANOTHER installation; its rail already said yes THERE
 * (lib/rail.js ran in that database), so this installation does not re-decide the step — it records the fact on its OWN shadow of that party's chit_status row, so
 * every reader (chit_participants, the timeline, the chit sheet) reads it as it does in one database. Not a second writer of the truth: the same UPDATE (setStatus),
 * on a row whose owner is a remote stub, called only by lib/ctpreturn.js apply after the door checked the sender's installation.
 *
 * db = a transaction under withEntity(<the remote party's stub entity>). A missing shadow is created (an INSERT, no status write).
 * @returns {Promise<'created'|'moved'|'same'>}
 */
async function mirror(db, entity_id, chit_id, to, copy) {
  if (!COPIES.includes(copy)) throw new Error('rail-status: copy must be received or sent, not "' + copy + '"');
  const existing = await db.query(`SELECT current_status FROM chit_status WHERE chit_id = $1 AND entity_id = $2 AND direction = '${copy}'`, [chit_id, entity_id]);
  if (!existing.rows.length) {
    await db.query('INSERT INTO chit_status (chit_id, entity_id, current_status, direction) VALUES ($1, $2, $3, $4)', [chit_id, entity_id, to, copy]);
    return 'created';
  }
  if (existing.rows[0].current_status === to) return 'same';
  const done = await setStatus(db, to, chit_id, entity_id, copy, existing.rows[0].current_status);
  if (!done.rowCount) throw Object.assign(new Error('the shadow moved meanwhile'), { status: 409, code: 'status_conflict' });
  return 'moved';
}

/* RAIL-173: a received copy cannot leave rejected / cancelled for a live status once the books hold the chit's reversal (chit:<id> posts once ever) */
const TAKEN_BACK_FROM = /^(rejected|cancelled)$/, REOPENS_TO = /^(pending|accepted|in_progress|completed)$/;
/** RAIL-173: is this move a revival of a bill the books took back? Read only, on the caller's own handle; books off / never posted → false. Asked only for a move OUT of rejected/cancelled. */
async function revivesTakenBack(db, entity_id, chit_id, copy, from, to) {
  if (copy !== 'received' || !(TAKEN_BACK_FROM.test(String(from)) && REOPENS_TO.test(String(to)))) return false;
  return require('./books-hooks').wasTakenBack(entity_id, chit_id, db);
}

/** RAIL-173: the refusal statusGate returns for a revival; its write() throws so no door can save it by mistake */
const takenBackVerdict = (from, copy) => ({ ok: false, why: 'taken_back', from, copy, write: async () => { throw new Error('rail-status: this bill was taken back by the books'); } });

/** RAIL-173: the taken_back refusal when a rail-allowed move revives a bill the books took back, else null */
async function takenBackRefusal(db, entity_id, chit_id, { copy, from, to, verdict }) {
  const revives = verdict.ok && (await revivesTakenBack(db, entity_id, chit_id, copy, from, to));
  return revives ? takenBackVerdict(from, copy) : null;
}

/** RAIL-216: the refusal statusGate returns when the invoice I SENT has money on it; its write() throws so no door can save past it */
const paidVerdict = (from, copy) => ({ ok: false, why: 'paid', from, copy, write: async () => { throw new Error('rail-status: this invoice has a payment on it'); } });

/** RAIL-216: the paid refusal when the invoice I ISSUED is withdrawn (to cancelled or rejected, the rail's own WITHDRAWN list, either of my copies) after money was applied (lib/chit-paid: any amount above 0), else null. */
async function paidRefusal(db, entity_id, chit_id, { copy, from, to, verdict }) {
  if (!(verdict.ok && !verdict.noop && railActions.WITHDRAWN.includes(to))) return null; /* keyed on the invoice being MINE (paidFactsOf asks docOf bill_issued): the buyer's own cancel (bill_received) is not asked */
  return (await require('./chit-paid').paidFactsOf(db, entity_id, chit_id)) ? paidVerdict(from, copy) : null;
}

/** the refusals the books and the money add to the rail's table, asked in one place: RAIL-173 a bill the books took back may not reopen · RAIL-216 an invoice with a payment on it is reversed by a credit note, never withdrawn; else null */
async function sideRefusal(db, entity_id, chit_id, facts) {
  return (await takenBackRefusal(db, entity_id, chit_id, facts)) || (await paidRefusal(db, entity_id, chit_id, facts));
}

/** ask the rail whether this copy of the chit may move to `to`: returns the rail verdict plus write(), which saves the move (409 when someone else moved it first); throws on a bad copy, no actor or a refusal at write time */
async function statusGate(db, entity_id, chit_id, to, actor, opts) {
  const options = opts || {};
  const copy = options.copy || 'received';
  if (!COPIES.includes(copy)) throw new Error('rail-status: copy must be received or sent, not "' + copy + '"');
  if (!actor) throw new Error('rail-status: who is moving it (railActions.meOf(req)) is required');
  let from = options.from;
  if (from === undefined) {
    const existing = await db.query(
      `SELECT current_status FROM chit_status
        WHERE chit_id = $1 AND entity_id = $2 AND direction = '${copy}'`,
      [chit_id, entity_id]
    );
    from = existing.rows.length ? existing.rows[0].current_status : null;
  }
  const verdict = railActions.move({ held: true, received: from || null }, actor, to);
  /* RAIL-173: BEFORE any write — every door that reaches this gate (the status route, goods-in, assign pull / push / auto) gets it */
  const stopped = await sideRefusal(db, entity_id, chit_id, { copy, from, to, verdict });
  if (stopped) return stopped;
  const write = async () => {
    if (!verdict.ok) throw new Error('rail-status: the rail refused ' + from + ' → ' + to + ' (' + verdict.why + ')');
    if (verdict.noop) return false;
    const done = await setStatus(db, to, chit_id, entity_id, copy, from);
    if (!done.rowCount)
      throw Object.assign(new Error('Someone else just changed this — look again, then try once more.'), { status: 409, code: 'status_conflict' });
    return true;
  };
  return Object.assign({ from: from || null, copy, write }, verdict);
}

/** the shop's own automation (auto-assign) moves its copy as the shop itself — an editor of its own rows */
const SYSTEM = Object.freeze({ level: 'editor', holder: null });

/** RAIL-173: the legacy body of the 409 every door answers when the books took the bill back (the code is the register row taken_back) */
const takenBackSaid = (from) => ({
  error: 'Bill was taken back',
  code: 'taken_back',
  message: `This bill was ${from} after it was booked, so it cannot be reopened. Ask the sender to send it again as a new bill.`,
  why: 'taken_back'
});

module.exports = { statusGate, mirror, SYSTEM, COPIES, takenBackSaid, paidSaid: () => require('./chit-paid').PAID_SAID };
