/**
 * ── lib/local-identity.js · AN ID FOR SOMEONE WHO NEVER REGISTERED ─────────────────────────────────────────────
 *
 * Athi, 2026-09-10, in two goes, and the second one is the design:
 *
 *   *"Still we need the user id, so we can attach item and so on against that id. We create id internally, so the
 *   existing mechanism will not break."*
 *
 *   *"Follow the existing path. Only thing is he is not a recipient — so you can't bring him to the rail or
 *   something. Otherwise for all practical purposes he is a bridge user. If you want, mark the user id as some
 *   char prefixed with the entity id and then some marker, so we can identify — like our customer and so on."*
 *
 * ⭐⭐⭐ BOTH CORRECTIONS POINT THE SAME WAY, AND MY FIRST TWO ATTEMPTS WENT THE OTHER WAY. I tried a NULL
 * `supplier_entity_id`, then a new `identity_type = 'local'`. Each made the local supplier a special case, and a
 * special case has to be handled everywhere: adoption resolves a supplier by id, a purchase attaches by id, spend
 * groups by id, every screen shows a bridge id. One special case means a null branch or a type check in every one
 * of those, forever, and every branch is a place the next query forgets to look.
 *
 * ⭐ THE CORNER HARDWARE SHOP IS JUST AN ENTITY. Same table, same identity_type, same bridge id, same joins.
 * Nothing downstream changes at all. What marks him is his HANDLE — `~acmetraders.corner-hardware` — and the `~`
 * carries the single real difference: he never registered, so he can never be reached.
 *
 * ⚠️ AND THE MARKER COSTS NO MIGRATION. `identities` already has a unique index on lower(user_id), so embedding
 * the owner in the handle makes "one Corner Hardware per shop" fall out of an index that exists — while two
 * different shops may each have their own, which they must. The grammar is in lib/handle.js with the other three.
 *
 * ── ⚠️⚠️ "HE IS NOT A RECIPIENT" ──────────────────────────────────────────────────────────────────────────────
 * A chit addressed to someone who cannot sign in would sit as sent for ever, with the sender waiting on an answer
 * that cannot come. Enforcement is NOT in this file — minting is not where that decision belongs. It is at each
 * path that turns a typed identifier into a counterparty (recipient resolution, business search, adding a supplier
 * or customer), each asking handle.isMinted(). This file only makes the mark; those files honour it.
 *
 * ⚠️ AND HE DOES NOT BECOME A REAL ACCOUNT LATER. Athi: *"never migrate offline to on-line — the bridge id may be
 * different and it will be chaos"*, softened to *"if there are opportunity and if we foresee no issues then we can
 * allow, but not now"*, with the shape already settled: *"debit the older one and credit the new one."* A transfer
 * entry between two ids that both keep existing — which having minted a real id is what makes possible.
 */
'use strict';
const genBridge = require('./bridgeid').generateBridgeId;
const handle = require('./handle');

/**
 * ⭐⭐ FIND OR MINT. Recording a fourth purchase from "Corner Hardware" must land on the SAME id, or the spend
 * figure splits across rows nobody adds up — the same reason lib/supply-store.ensure() exists for supply items.
 *
 * ⚠️ IT LOOKS FIRST *AND* LEANS ON THE UNIQUE INDEX, deliberately. The SELECT answers the ordinary case; the index
 * is the only thing that stops two tills recording the same purchase at the same instant from minting two
 * suppliers, because both would pass a check-then-insert.
 *
 * @param owner      the minting entity's identity_id
 * @param ownerHandle its user_id — or its bridge_id, for an entity registered before user_ids existed
 * @returns {{identity_id, bridge_id, display_name, user_id, created}} or {{error, status}}
 */
async function mint(owner, name, deps) {
  const d = deps || {};
  const query = d.query || require('../db').query;
  const clean = String(name == null ? '' : name).trim().replace(/\s+/g, ' ');
  if (!clean) return { status: 400, error: { error: 'Invalid', message: 'Give the supplier a name' } };
  if (clean.length > 120) return { status: 400, error: { error: 'Invalid', message: 'That name is too long' } };
  /* ⚠️ A NAME THAT IS ACTUALLY AN IDENTIFIER is almost always the wrong field. Someone pastes a real business's
     email into "name" and silently gets a private lookalike: it says added, then the catalogue never loads and
     orders cannot be sent, with nothing anywhere explaining why. */
  if (clean.indexOf('@') >= 0)
    return { status: 400, error: { error: 'Invalid',
      message: 'That looks like an email. Add them as a ChitBridge business, or type their name instead.' } };

  const kind = d.kind || 'sup';

  /* the owner's own handle — the minted id hangs from it, and it is what makes the id specific to this business */
  let ownerHandle = d.ownerHandle;
  if (!ownerHandle) {
    const me = await query(`SELECT user_id, bridge_id FROM identities WHERE identity_id = $1`, [owner]);
    ownerHandle = (me.rows[0] && (me.rows[0].user_id || me.rows[0].bridge_id)) || '';
  }
  const prefix = handle.mintedPrefix(ownerHandle, kind);

  /**
   * ⭐⭐ THE SAME SHOP TWICE MUST BE THE SAME ROW — matched on the NAME, because the handle is now a number and
   * can no longer answer this. Recording a fourth purchase from "Corner Hardware" has to land on the id the first
   * three did, or the spend figure splits across rows nobody adds up and nothing on screen says so.
   * ⚠️ Scoped by the KIND prefix as well as the parent, or a customer and a supplier who share a name — a shop
   * that both buys from and sells to the same trader, which is ordinary — would collapse into one record.
   */
  const found = await query(
    `SELECT identity_id, bridge_id, display_name, user_id FROM identities
      WHERE parent_entity_id = $1 AND user_id LIKE $2 AND lower(btrim(display_name)) = $3
      LIMIT 1`, [owner, prefix + '%', fold(clean)]);
  if (found.rows.length) return Object.assign({ created: false }, found.rows[0]);

  /**
   * ⭐ THE NEXT NUMBER IS AN ORDINAL, NOT A COUNT — max + 1, never rows + 1. With 0001 and 0003 present the next
   * is 0004; a count would hand out 0003 again and attach a new supplier to a removed one's purchase history.
   * ⚠️ Two writers can read the same max. That is what the retry below is for — the unique index on lower(user_id)
   * is the authority, and losing the race is a normal outcome, not an error.
   */
  for (let attempt = 0; attempt < 5; attempt++) {
    /* ⚠️ LENGTH FIRST. The number is zero-padded to four, so plain text ordering is right up to 9999 and wrong
       the moment it widens — '10000' sorts before '9999' and the counter would silently restart. */
    const top = await query(
      `SELECT user_id FROM identities WHERE user_id LIKE $1
        ORDER BY length(user_id) DESC, user_id DESC LIMIT 1`, [prefix + '%']);
    const last = top.rows[0] ? (handle.mintedParts(top.rows[0].user_id) || {}).n || 0 : 0;
    const h = handle.minted(ownerHandle, kind, last + 1 + attempt);
    if (h.error) return { status: 400, error: { error: 'Invalid', message: h.error } };
    try {
      /* ⭐ THE EXISTING PATH, with nothing special about it: identity_type 'entity', active, its own bridge id.
         ⚠️ No email and no password — there is no account to sign in to, and giving it either would create one. */
      const r = await query(
        `INSERT INTO identities (bridge_id, display_name, user_id, identity_type, parent_entity_id, status, created_by)
         VALUES ($1, $2, $3, 'entity', $4, 'active', $4)
         RETURNING identity_id, bridge_id, display_name, user_id`,
        [genBridge(), clean, h.handle, owner]);
      return Object.assign({ created: true }, r.rows[0]);
    } catch (e) {
      if (!(e && e.code === '23505')) throw e;
      /* ⚠️ TWO CONSTRAINTS CAN RAISE THIS, and they mean opposite things. The NAME index means the other writer
         already created this very supplier — their row is the answer. The HANDLE index means they merely took the
         number we wanted — try the next one. Telling them apart matters: retrying a name clash would loop, and
         returning someone else's row on a number clash would return the wrong supplier entirely. */
      const dup = await query(
        `SELECT identity_id, bridge_id, display_name, user_id FROM identities
          WHERE parent_entity_id = $1 AND user_id LIKE $2 AND lower(btrim(display_name)) = $3 LIMIT 1`,
        [owner, prefix + '%', fold(clean)]);
      if (dup.rows.length) return Object.assign({ created: false }, dup.rows[0]);
    }
  }
  return { status: 409, error: { error: 'Busy',
    message: 'Could not allocate an ID for ' + clean + '. Try once more.' } };
}

/** the lookup key for "same supplier, typed differently" — must fold exactly as the b218 index does */
function fold(name) { return String(name == null ? '' : name).trim().replace(/\s+/g, ' ').toLowerCase(); }

/** ⭐ the one question a screen asks: can I call them, or only write down what I bought? */
function onRail(row) { return !!row && !handle.isMinted(row.user_id); }

module.exports = { mint, onRail };
