'use strict';
// @stage held
// @stage-note The deployment root resolver. Written with the reservation in lib/handle.js; NOT yet called by a
//             route, because no root has been minted. Off by default — root() is null and every caller must
//             behave as it did before there was a root.
// @stage-why  Being uncalled is a STAGE, not a defect. tests/engine-boundary.test.js requires this tag so an
//             experiment is never mistaken for shipped capability.
/**
 * lib/platformroot.js — THE ROOT ENTITY OF THIS DEPLOYMENT.
 *
 * Athi, 2026-09-14: *"this is the root entity we want to register to a platform and it has to be static… while
 * creating a platform, we spin with one entity named, and all the metrics comes to that entity… so tomorrow if
 * we whitelabel, we need to have a root entity."*
 *
 * ── ⭐⭐⭐ ONE ROOT PER DEPLOYMENT, AND IT IS AN ORDINARY ENTITY ────────────────────────────────────────────────
 *
 * The root is where the platform operator's own business lives: our customer list (every registered entity),
 * the support queues under `00-support`, our plans as a catalogue, our own testing. See
 * DESIGN-PLATFORM-OPERATIONS.md.
 *
 * ⚠️ IT IS NOT A NEW LAYER, A NEW TYPE OR A NEW TABLE. It is an entity like any other, and its ROOTNESS is a
 * fact held in configuration — one uuid — not a property of the row. That is deliberate:
 *
 *   · everything an operator needs (customers, folders, chits, catalogue, plans) an entity already does
 *   · a second kind of entity would need a branch in every query that reads one
 *   · and a white-label deployment then differs from ours only by a value in its environment
 *
 * [[feedback-stay-in-the-construct]]
 *
 * ── ⚠️⚠️ THE HANDLE IS A LABEL. THE UUID IS THE IDENTITY. ──────────────────────────────────────────────────────
 *
 * The convention is `<brand>root` — `chitbridgeinc`, `cbincroot`, `railmailroot`. It is for HUMANS, because the
 * root appears in every shop's supplier list and `~cbincroot.sup-0001` should read as somebody.
 *
 * ⚠️ NOTHING MAY EVER RESOLVE THE ROOT BY THAT NAME. `WHERE user_id LIKE '%root'` makes any customer who
 * registers `myshoproot` a root entity — and nothing stops them: lib/handle.js reserves the bare word `root`,
 * not every handle ending in it. The uuid is the only authority. See lib/namedentity.js.
 *
 * ⚠️ AND THE HANDLE CAN NEVER BE CHANGED. routes/entities.js writes COALESCE(user_id, $5), so the existing
 * value always wins. A rebrand to Railmail moves the DISPLAY NAME, which is free, and leaves the handle. Choose
 * it once, knowing that. [[project-user-id-rule]]
 *
 * ── OFF BY DEFAULT ─────────────────────────────────────────────────────────────────────────────────────────
 *
 * Unset, `root()` is null and every caller must behave exactly as it did before there was a root. A deployment
 * that has not minted one is not broken; it simply has no operator-side surface yet. Same discipline as
 * lib/testboard.js — a switch that can be thrown back without a deploy.
 */

const named = require('./namedentity');

const ROOT = named.fromEnv('PLATFORM_ROOT_ENTITY', 'platformroot',
  'this deployment has no operator surface');

/** the uuid of this deployment's root entity, or null if none is configured */
function root() { return ROOT; }

/** is there a root at all? Read this before assuming an operator surface exists. */
function configured() { return ROOT !== null; }

/**
 * Is this entity the root? ⚠️ Always false when no root is configured — never "maybe".
 *
 * ⚠️ Compared case-insensitively because a uuid from an environment variable may be typed in either case while
 * one out of postgres is lower — a mismatch here would silently deny the operator their own data.
 */
function isRoot(entity_id) {
  return !!ROOT && String(entity_id || '').toLowerCase() === ROOT.toLowerCase();
}

module.exports = { root, configured, isRoot };
