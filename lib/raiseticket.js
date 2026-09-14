'use strict';
/**
 * ── ⭐⭐⭐ A SUPPORT TICKET IS A CHIT. IT WAS ALWAYS A CHIT. ─────────────────────────────────────────────────────
 *
 * Athi, 2026-09-14, when I was about to build a support screen:
 *
 *   *"is it not a task?"* · *"we can trigger a task from anywhere"* ·
 *   *"so we can create an order folder for keeping the tickets"* · *"task is to service tickets"*
 *
 * ⚠️⚠️ HE STOPPED ME BUILDING A PARALLEL QUEUE. I had incidents landing in a second store (a `definition` copy in
 * the operator's entity) with a second screen to read it, a second list, a second set of filters, a second
 * everything — beside a product whose entire job is carrying work between two businesses.
 *
 * ⭐ THE SHOP IS OUR CUSTOMER AND SUPPORT IS WHAT WE SELL THEM. So a ticket is what it looks like: a chit from
 * the shop to CBINC. They hold their copy and see it under ORDER, because they asked us for something. We hold
 * ours and see it under TASK, because servicing it is our work. Per-copy replication, already built; folders,
 * already built; assignment, states, messages, attachments, the column chooser — all already built.
 *
 * ⚠️ AND IT COMPOSES lib/mint.js RATHER THAN RE-MINTING. That file's header is explicit: four paths mint chits,
 * their POLICY differs, and a single function with a dozen flags would be worse than four copies. What is shared
 * is the SHAPE — summary, header, party, deliver — and this is a fifth policy composing the same four helpers.
 * Writing the shape again is how one chit's two copies come to disagree about what it is.
 *
 * ⚠️ b247 IS WHAT MAKES A TEST SHOP'S TICKET LEGAL. Two entities may only transact inside one population — and
 * cbincroot carries serves_all_populations precisely so a test shop can still reach support. That exemption
 * stopped being hypothetical the moment this file existed.
 */

const { withEntity, query } = require('../db');
const { v4: uuidv4 } = require('uuid');
const mint = require('./mint');
const platformroot = require('./platformroot');

/** the folder tickets land in when nothing else is routed. ⭐ Named, not numbered, because a person reads it. */
const DEFAULT_FOLDER = '00-support';

/**
 * Raise a ticket from a shop to the platform operator.
 *
 * @param from  { entity_id, bridge_id, display_name, population }  — the shop
 * @param who   { id, name }                                        — the person who raised it
 * @param t     { kind, audience, ref, subject, detail, severity, screen_code, definition_id }
 * @returns {Promise<{raised:boolean, chit_id?:string, folder?:string, why?:string}>}
 *
 * ⚠️ NEVER THROWS. A shop's incident RECORDED; if our ticket cannot be raised that is our problem, not a reason
 * to fail their report. But it always answers — "recorded" with no word on whether anyone was told is the
 * silence this codebase keeps producing. [[feedback-silence-is-the-bug]]
 */
async function raise(from, who, t) {
  const root = platformroot.root();
  if (!root) return { raised: false, why: 'no operator entity is configured (PLATFORM_ROOT_ENTITY)' };
  if (!from || !from.entity_id) return { raised: false, why: 'no raiser' };
  /**
   * ── ⚠️⚠️ THE OPERATOR'S OWN FINDINGS USED TO GO NOWHERE ──────────────────────────────────────────────────
   *
   * Athi, 2026-09-14: *"I send an incident from cbinc itself, where does it come? does it come to cbinc task?"*
   * It did not. This line returned early with *"raised by the operator"*, on my reasoning that the operator
   * *"does not need a copy of itself"* — and that was wrong twice over.
   *
   * ⭐ CBINC IS A BUSINESS TOO. A fault Athi finds is work that belongs in the support queue exactly like a
   * shop's, and he is the person doing most of the testing — so the findings most likely to be acted on were
   * the ones silently kept out of the list.
   *
   * ⭐ AND ONCE SUPPORT IS A TEAM (b251), there is no self at all: cbincroot raises it and the Support branch
   * receives it, which is an ordinary two-party chit. The skip would have gone on suppressing the very case the
   * network feature was built for.
   */

  try {
    /**
     * ── ⭐⭐⭐ WHOSE PROBLEM IS IT — THE ONE QUESTION THAT DECIDES EVERYTHING BELOW ──────────────────
     *
     * Athi, 2026-09-14: *"how do we differentiate between raising an incident to the platform and raising an
     * incident to the entity?"*
     *
     * ⚠⚠ WE DID NOT. Every ticket was resolved against `root` — so a shop's own routing screen, the one
     * built so *"anyone who wants to run a simple helpdesk service"* could use this, decided nothing at all.
     * The two cases are genuinely different work and were sharing one address:
     *
     *   'platform'  the RAIL is broken, or should do something it does not. We own that, it reaches CBINC,
     *               and CBINC's own routing hands it to its Support team (b251).
     *   'here'      MY business has a fault, or someone wants something of me. It never leaves my entity;
     *               my routing puts it in my folder, on my person, or with my own team.
     *
     * ⭐ AND IT IS ONE LINE, BECAUSE THE TWO ARE THE SAME MECHANISM POINTED AT A DIFFERENT ROOT. That is the
     * whole reason this is worth having: a shop's helpdesk is not a copy of ours, it is ours, re-addressed.
     *
     * ⚠️ 'platform' STAYS THE DEFAULT. Every caller that shipped before today meant the platform, and a
     * default that silently re-routed their tickets inward would lose them without an error anywhere.
     */
    const here = String(t.audience || 'platform') === 'here';
    const desk = here ? from.entity_id : root;
    /* ⭐ whose routing answers — b250, resolved on the DESK's side, because routing is about who answers a
       ticket and not about who raised it.
       ⚠️ BEFORE the transaction: routeFor opens its own withEntity, and nesting two pins two connections. */
    const route = await require('./workroute').routeFor(desk, t.kind || 'incident');

    /**
     * ── ⭐⭐ AND IT MAY GO TO A TEAM, NOT TO THE OPERATOR ITSELF (b251) ───────────────────────────────────────
     *
     * Athi, 2026-09-14: *"need to see how we exploit our network feature. Support can be a separate entity
     * below, similarly dev, commercial and so on… if we can create our own support mechanism, that will be a
     * good showcase."*
     *
     * ⭐ So CBINC becomes a network and its teams become branches — real entities that can be HANDED WORK BY A
     * CHIT, which is the one mechanism this product actually proves. A folder cannot hold staff or a queue; a
     * team can. And b251 refuses a target outside your own network, so this cannot become a way to post a
     * shop's tickets to a competitor.
     *
     * ⚠️ Null until somebody names one, and then it changes one kind at a time. Athi: *"currently we keep it
     * that way."*
     */
    const to = route.route_to_entity_id || desk;
    /* ⭐ SELF when nobody else is routed — the shape lib/mint.js already names for an IoT exception: one
       received copy, Task-only, no Order copy, because nobody ordered anything from themselves. */
    const isSelf = String(to) === String(from.entity_id);
    const them = await query(
      'SELECT bridge_id, display_name FROM identities WHERE identity_id = $1', [to]);
    const op = them.rows[0];
    if (!op) return { raised: false, why: 'destination entity not found' };

    const chit_id = uuidv4();
    const now = new Date();
    const purpose = 'general';
    const subject = String(t.subject || t.ref || 'Support request').slice(0, 160);

    const all_recipients = isSelf
      ? [{ entity_id: from.entity_id, bridge_id: from.bridge_id, display_name: from.display_name, role: 'sender' },
         { entity_id: from.entity_id, bridge_id: from.bridge_id, display_name: from.display_name, role: 'receiver' }]
      : [{ entity_id: from.entity_id, bridge_id: from.bridge_id, display_name: from.display_name, role: 'sender' },
         { entity_id: to, bridge_id: op.bridge_id, display_name: op.display_name, role: 'receiver' }];

    /* ⚠️ NO LINE ITEMS AND NO VALUE. A ticket is not a trade — giving it a total would put support requests into
       a shop's spend, which is somebody's books. */
    const summary_json = mint.summary({
      line_item_count: 0, total_value: 0, purpose,
      /* ⚠️ DECLARED, not implied. A suppressed copy that nothing records reads later as a delivery that failed. */
      ...(isSelf ? { copy_policy: { scope: 'self', kept: ['received'], suppressed: ['sent'],
                                    reason: 'Raised and answered by the same entity — Task only',
                                    source: 'support' } } : {}),
      governed: { pattern: 'support-ticket', folder: route.folder_id || DEFAULT_FOLDER,
                  assignee: route.assignee_actor_id || null, routed: route.why, resolved_at: now.toISOString() },
    });

    /* ⭐ what the ticket IS, carried on the chit so the chain can be walked later without a second store. */
    const business_json = {
      kind: 'support_ticket', of: t.kind || 'incident', ref: t.ref || null,
      severity: t.severity || null, screen_code: t.screen_code || null,
      detail: String(t.detail || '').slice(0, 4000),
      /* ⚠️ WHOSE, AND FROM WHICH SET OF BOOKS (b249). Without the population a real customer's fault and an e2e
         run's are indistinguishable in our queue. */
      raised_by: who && who.name, raised_by_id: who && who.id,
      origin: { entity_id: from.entity_id, definition_id: t.definition_id || null,
                shop: from.display_name || null, population: from.population || null },
      at: now.toISOString(),
    };

    const headerCommon = mint.header({
      sender_entity_id: from.entity_id, sender_entity_bridge_id: from.bridge_id,
      sender_entity_display_name: from.display_name,
      all_recipients, purpose,
      auto_subject: 'Support — ' + (from.display_name || 'a shop') + ' — ' + now.toISOString().slice(0, 10),
      manual_subject: '[' + (t.kind || 'incident') + '] ' + subject,
      summary_json, created_by_actor_id: (who && who.id) || null,
    });

    /* ⭐ TWO COPIES, ONE CHIT — theirs is the record that they asked, ours is the work of answering.
       ⚠️ ONE copy when it is the same entity: a "sent" copy to yourself would put your own support requests
       into your own Order list, which is not a thing that happened. */
    const received = mint.party(headerCommon, { entity_id: to, direction: 'received', role: 'Act',
      current_status: 'pending', business_json,
      log: { action: 'delivered', action_by_identity_id: from.entity_id,
             action_by_display_name: from.display_name, new_status: 'pending',
             detail: isSelf ? 'Raised here' : ('Support ticket from ' + (from.display_name || 'a shop')) } });
    const copies = isSelf ? [received] : [
      mint.party(headerCommon, { entity_id: from.entity_id, direction: 'sent', role: 'Info',
        current_status: 'delivered', business_json }),
      received,
    ];

    /* ⚠️ RUNS AS THE SENDER — chit_deliver is SECURITY DEFINER and withEntity(sender) is its isolation gate.
       The shop raised this, so the shop is the sender, and the API is acting on their authenticated request. */
    await mint.deliver(from.entity_id, chit_id, copies);

    /**
     * ⭐ AND IT IS FILED AND OWNED ON OUR SIDE. autoFile (b132) already runs the receiver's folder RULES; this
     * puts it in the routed folder when b250 says where, and creates the default one when it does not — so a
     * first ticket has somewhere to be rather than sitting loose in Task.
     * ⚠️ Best-effort and LOUD: a ticket that arrives unfiled is an annoyance; one that fails to arrive is a
     * shop left waiting. Never let the filing undo the delivery.
     */
    let folderName = null, filedRows = null;
    try {
      /* ⚠️ filed in the entity that RECEIVED it — the team's folder, not the operator's, when one is routed. */
      await withEntity(to, async (db) => {
        let fid = route.folder_id || null;
        if (!fid) {
          const fr = await db.query(
            'SELECT folder_id FROM folder WHERE entity_id = $1 AND lower(name) = lower($2) LIMIT 1',
            [to, DEFAULT_FOLDER]);
          fid = fr.rows[0] && fr.rows[0].folder_id;
          if (!fid) {
            const ins = await db.query(
              'INSERT INTO folder (entity_id, name) VALUES ($1,$2) RETURNING folder_id', [to, DEFAULT_FOLDER]);
            fid = ins.rows[0].folder_id;
          }
        }
        const nm = await db.query('SELECT name FROM folder WHERE folder_id = $1 AND entity_id = $2', [fid, to]);
        folderName = nm.rows[0] && nm.rows[0].name;
        const up = await db.query(
          `UPDATE chit_status SET folder_id = $1 WHERE chit_id = $2 AND entity_id = $3 AND direction = 'received'`,
          [fid, chit_id, to]);
        /* ⚠️ an UPDATE matching nothing is not an error. Without this the answer reports the folder it MEANT
           to use while the ticket sits loose in Task, which is how "filed: yes" becomes a lie nobody checks. */
        filedRows = up.rowCount;
        if (route.assignee_actor_id) {
          const a = await db.query(
            `SELECT display_name FROM identities WHERE identity_id = $1 AND parent_entity_id = $2 AND status = 'active'`,
            [route.assignee_actor_id, to]);
          if (a.rows[0]) {
            await db.query(
              `UPDATE chit_status SET assigned_to_actor_id = $1, assigned_to_actor_display_name = $2,
                      assigned_at = NOW(), assignment_type = 'auto', updated_at = NOW()
                WHERE chit_id = $3 AND entity_id = $4 AND direction = 'received'`,
              [route.assignee_actor_id, a.rows[0].display_name, chit_id, to]);
          }
        }
      });
    } catch (e) {
      console.warn('[raiseticket] filing failed (the ticket still arrived):', e.code || '', e.message);
    }

    return { raised: true, chit_id,
             /* ⭐ the folder it ACTUALLY landed in, or null and a reason — never the one we aimed at. */
             folder: filedRows ? folderName : null,
             filed: filedRows === null ? 'not attempted' : (filedRows ? 'yes' : 'no rows matched'),
             assigned: !!route.assignee_actor_id,
             /* ⭐ WHICH DESK, said out loud. "routed by kind" alone cannot tell the reader whether their fault
                reached us or stayed on their own board — which is the exact confusion this parameter fixes. */
             desk: here ? 'here' : 'platform',
             routed: (here ? 'your own desk' : 'the platform') + ' · ' + route.why
                     + (isSelf ? ' · raised and held here' : ' · sent to ' + (op.display_name || 'the team')) };
  } catch (e) {
    /* ⚠️ b247 refuses a ticket that would cross populations. That is the rule working, and it must read as a
       sentence rather than a stack trace. */
    if (e.code === '23514' && /cannot trade with a/.test(String(e.message || ''))) {
      return { raised: false, why: 'population boundary: ' + e.message };
    }
    return { raised: false, why: (e.code ? e.code + ' ' : '') + String(e.message || e) };
  }
}

module.exports = { raise, DEFAULT_FOLDER };
