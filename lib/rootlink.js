'use strict';
// @stage held
// @stage-note The root↔entity connection. Written and wired into registration, but INERT until a root exists:
//             with PLATFORM_ROOT_ENTITY unset, connect() returns immediately and registration is unchanged.
// @stage-why  Being uncalled-in-effect is a STAGE, not a defect. tests/engine-boundary.test.js requires this
//             tag so a switched-off capability is never mistaken for a shipped one.
/**
 * lib/rootlink.js — WHEN A SHOP REGISTERS, IT BECOMES OUR CUSTOMER AND WE BECOME ITS SUPPLIER.
 *
 * Athi, 2026-09-14: *"cbinc is one of the entity. its customer are each registered entity, so when a
 * registration happens, there will be a connection to that entity to the super entity. so for them we will be
 * shown as a supplier."* · *"let us first complete the connection."*
 *
 * ── ⭐⭐⭐ TWO ROWS, AND THEY ARE NOT TWO ENDS OF ONE LINK ─────────────────────────────────────────────────────
 *
 * Both relationship lists are ONE-SIDED by design — routes/relationships.js says so in its own section
 * headers: *"SUPPLIERS (no consent — D-056)"* and *"CUSTOMERS (auto-added — D-065)"*. `owner_entity_id` owns
 * the list. So this writes TWO independent records, deliberately:
 *
 *   customer_list   owner = the root, customer = the new shop   → OUR record of who our customers are
 *   supplier_list   owner = the new shop, supplier = the root   → THEIR record of who supplies them
 *
 * ⚠️ Writing only the first would give us a customer list while the shop had no idea who we were, and no door
 * to order an upgrade through. Writing only the second is a supplier row pointing at nobody's customer.
 *
 * ── ⚠️⚠️ THE SECOND ROW IS A WRITE INTO SOMEBODY ELSE'S ENTITY, AND IT IS LEGITIMATE EXACTLY ONCE ─────────────
 *
 * At the mint. We are creating that entity; seeding its supplier list with its own platform operator is part
 * of handing it over, in the same breath as its default schema and its governance stamp. It is NOT a licence
 * to write into a shop's entity at any later moment, and nothing else in this file does.
 *
 * ── ⚠️ THREE CONSEQUENCES OF BEING IN THEIR SUPPLIER LIST, EACH HANDLED ────────────────────────────────────
 *
 *   1 · THEY COULD DELETE US and their support routing would die with it. `added_via = 'system'` marks the row
 *       so the supplier screen can refuse to remove it. ⚠️ THE REFUSAL IS NOT BUILT YET — the mark is laid
 *       down first so the row can be recognised the day it is.
 *
 *   2 · WE WOULD EAT THEIR SUPPLIER QUOTA. Starter allows ten suppliers and we would silently take one, so
 *       every shop starts at 1/10 for a supplier they did not choose. Any quota count MUST exclude
 *       `added_via = 'system'`. Cheap now; infuriating to discover after billing is live.
 *
 *   3 · WE APPEAR IN THEIR ORDERING FLOWS. ⭐ That one is wanted — it is how a shop buys a plan upgrade from
 *       us, an ordinary order to an ordinary supplier — but it should be a decision rather than a surprise.
 *
 * ── ⚠️⚠️ IT MUST NEVER FAIL A REGISTRATION ────────────────────────────────────────────────────────────────
 *
 * Losing a signup because a bookkeeping row would not write is far worse than a missing row. Same rule, and
 * the same reason, as lib/meter.js — and the same discipline about it: the failure is LOGGED, never swallowed
 * in silence, because an unlinked customer is a customer we do not know we have.
 * [[feedback-silence-is-the-bug]]
 */

const { withEntity } = require('../db');
const log = require('./logger');
const platformroot = require('./platformroot');

/**
 * Connect a freshly minted entity to this deployment's root.
 * Resolves { linked, customer, supplier } — never rejects, never throws.
 *
 * @param {string} entity_id     the new entity
 * @param {string} [rid]         correlation id for the log line
 */
async function connect(entity_id, rid) {
  const root = platformroot.root();

  /* No root configured — this deployment has no operator surface. Not a failure, and not worth a log line on
     every registration: it is the ordinary state of a deployment that has not minted one. */
  if (!root) return { linked: false, reason: 'no root configured' };
  if (!entity_id) return { linked: false, reason: 'no entity' };

  /* ⚠️ The root registering itself would make it its own customer and its own supplier. It is minted through
     the same ordinary route as everybody else, so this WILL happen the day the root is created. */
  if (platformroot.isRoot(entity_id)) return { linked: false, reason: 'the root is not its own customer' };

  const out = { linked: false, customer: false, supplier: false };

  /**
   * ⚠️ TWO TRANSACTIONS, NOT ONE, AND NOT A CHOICE. Each row lands in a DIFFERENT entity, and withEntity pins
   * a transaction to one — the RLS WITH CHECK refuses a row whose entity does not match the one set. They are
   * also independent records rather than two halves of one fact, so one succeeding without the other is a
   * partial link, not a corrupt one. Each is reported separately for that reason.
   */
  try {
    await withEntity(root, (db) => db.query(
      `INSERT INTO customer_list (owner_entity_id, customer_identity_id, customer_type, added_via)
       VALUES ($1, $2, 'entity', 'system')
       ON CONFLICT (owner_entity_id, customer_identity_id) DO NOTHING`,
      [root, entity_id]));
    out.customer = true;
  } catch (e) {
    log.warn('root link: customer row not written', { id: rid, entity_id, err: e.message });
  }

  try {
    await withEntity(entity_id, (db) => db.query(
      `INSERT INTO supplier_list (owner_entity_id, supplier_entity_id, supply_kind, added_via)
       VALUES ($1, $2, 'service', 'system')
       ON CONFLICT (owner_entity_id, supplier_entity_id) DO NOTHING`,
      [entity_id, root]));
    out.supplier = true;
  } catch (e) {
    log.warn('root link: supplier row not written', { id: rid, entity_id, err: e.message });
  }

  out.linked = out.customer && out.supplier;
  return out;
}

module.exports = { connect };
