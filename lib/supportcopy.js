'use strict';
/**
 * ── ⭐⭐⭐ WHATEVER A SHOP RAISES, IT REACHES US AS A TICKET ─────────────────────────────────────────────────────
 *
 * Athi, 2026-09-14: *"is it not a task?"* · *"we can trigger a task from anywhere"* · *"so we can create an
 * order folder for keeping the tickets"* · *"task is to service tickets"* · *"same way all can be handled"*.
 *
 * ── ⚠️⚠️ WHAT THIS FILE USED TO DO, AND WHY IT WAS WRONG ────────────────────────────────────────────────────────
 *
 * It wrote a SECOND `definition` row into the operator's entity — a copy of the incident, in a second store,
 * which then needed a second screen to read it, a second list, a second set of filters, a second everything.
 * A parallel queue, beside a product whose entire job is carrying work between two businesses. I was an hour
 * from building that screen when Athi asked four words that made it unnecessary.
 *
 * ⭐ THE SHOP IS OUR CUSTOMER AND SUPPORT IS WHAT WE SELL THEM. So it is a chit: theirs under ORDER, because
 * they asked us for something; ours under TASK, because answering it is our work. Folders, assignment, states,
 * messages, attachments, the column chooser and the whole list were already built, and are now simply used.
 *
 * ── ⭐ AND IT IS THE SAME PATH FOR EVERY KIND ───────────────────────────────────────────────────────────────────
 *
 * incident, requirement — and whatever is raised later — differ only in the `kind` that decides which folder and
 * which person (b250). One path, so a kind added tomorrow cannot quietly land somewhere nobody is looking.
 *
 * ⚠️ THE RAISER STILL KEEPS THEIR OWN RECORD. The `definition` row in the shop's entity is untouched: it is
 * about their business, in their words, and THEY close it. The ticket is how it reaches us, not where it lives.
 */

const raiseticket = require('./raiseticket');
const { query } = require('../db');

/**
 * Post what a shop raised into the operator's queue, as a ticket.
 *
 * @param kind    'incident' | 'spec' | …  — decides the folder and the assignee (b250)
 * @param origin  { entity_id, definition_id, ref, sub_kind, note, subject, screen_code, audience }
 *                `audience` is 'platform' (the rail is broken — it reaches us), 'here' (my own business has a
 *                fault — it never leaves my entity), or 'them' (+ `to_bridge_id`: the shop whose catalogue I am
 *                on, answered by THEIR routing). Default 'platform': every caller that shipped before today
 *                meant us, and a default that re-routed them elsewhere would lose their tickets silently.
 * @param who     { id, name }
 * @returns {Promise<{copied:boolean, chit_id?:string, folder?:string, why?:string}>}
 *
 * ⚠️ NEVER THROWS, ALWAYS ANSWERS. A shop's report recorded; if our queue is unreachable that is our problem,
 * not a reason to lose their words. But "recorded" with no word on whether anybody was told is exactly the
 * silence this codebase keeps producing. [[feedback-silence-is-the-bug]]
 */
async function toOperator(kind, origin, who) {
  try {
    /* the raiser is the SENDER, so the chit needs their bridge id and name — and their population, so our queue
       can tell a real customer's request from an e2e run's (b249). */
    const r = await query(
      'SELECT bridge_id, display_name, population FROM identities WHERE identity_id = $1',
      [origin.entity_id]).catch(() => null);
    const row = (r && r.rows && r.rows[0]) || {};

    const out = await raiseticket.raise(
      { entity_id: origin.entity_id, bridge_id: row.bridge_id,
        display_name: row.display_name, population: row.population },
      who,
      { kind, audience: origin.audience, to_bridge_id: origin.to_bridge_id,
        ref: origin.ref, subject: origin.subject || origin.note,
        detail: origin.note, severity: origin.sub_kind, definition_id: origin.definition_id,
        screen_code: origin.screen_code });

    /* ⚠️ the key stays `copied`: two routes already answer it to their callers, and renaming a field that has
       shipped is a change to somebody else's contract for the sake of a word. */
    return { copied: !!out.raised, chit_id: out.chit_id, folder: out.folder,
             desk: out.desk || 'platform', assigned: out.assigned, why: out.why || out.routed };
  } catch (e) {
    return { copied: false, why: (e.code ? e.code + ' ' : '') + String(e.message || e) };
  }
}

module.exports = { toOperator };
