'use strict';
/**
 * lib/chits-cancel-flag.js — the "cancel requested" flag on each recipient's copy of a withdrawn chit (moved out of routes/chits.js whole, so that file's size row holds)
 * OWNER     cb-rail
 * RISK      plain: a failure here is logged and never loses the withdrawal itself (the sender's copy and the message are already committed)
 * OWNS      flagCancelRequested: stamp cancel_requested_at on every OTHER participant's copy, one context per recipient, and the same stamp across installations
 * FLOW      the withdrawal committed ──▶ the sender's header names the recipients ──▶ each recipient's own context stamps its row ──▶ the cross-installation answer is pushed on `told`
 * CALLED BY routes/chits.js (PUT /:chit_id/void) · tests/route-modules-1129.test.cjs
 * CARD      rail/chits-void
 */
const { withEntity } = require('../db');
const schema = require('./schema');
const { stampCancelRequested } = require('./chit-move');
const ctpReturn = require('./ctpreturn');

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
/** the flag on each recipient's copy that a cancel was requested, and the same stamp across installations: `told` gets the cross-installation answer pushed on; never loses the withdrawal itself */
async function flagCancelRequested(req, entity_id, chit_id, reason, told) {
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
}

module.exports = { flagCancelRequested };
