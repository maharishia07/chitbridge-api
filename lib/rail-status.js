// @stage tested
// @stage-note The ONE write of a chit copy's status: read my copy, ask the rail (rail.move), then write. moveStatus and every door that moves a status call it.
// CARD 01-rail-core-the-chit/rail-status
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

async function statusGate(db, entity_id, chit_id, to, me, opts) {
  const o = opts || {};
  const copy = o.copy || 'received';
  if (!COPIES.includes(copy)) throw new Error('rail-status: copy must be received or sent, not "' + copy + '"');
  if (!me) throw new Error('rail-status: who is moving it (railActions.meOf(req)) is required');
  let from = o.from;
  if (from === undefined) {
    const existing = await db.query(
      `SELECT current_status FROM chit_status
        WHERE chit_id = $1 AND entity_id = $2 AND direction = '${copy}'`,
      [chit_id, entity_id]
    );
    from = existing.rows.length ? existing.rows[0].current_status : null;
  }
  const verdict = railActions.move({ held: true, received: from || null }, me, to);
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

module.exports = { statusGate, mirror, SYSTEM, COPIES };
