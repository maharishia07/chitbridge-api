// @stage tested
// @stage-note What an entity MAY choose for its catalogue visibility, as opposed to what it DID choose. Pure — the
// caller supplies the constitution, the plan and the entity's params_override.
'use strict';
/**
 * visibility-cap.js — a choice, bounded by a cap.
 *
 * Athi, 2026-08-06: *"this means even a private catalogue can be made public. How do we protect a private catalogue
 * — say it is done from the networking side, the entity should be private not public?"*
 *
 * He is right, and the hole was older than the switch that exposed it. `PATCH /api/entities/profile` whitelisted
 * `public|private` and wrote it: no plan check, no operator check, nothing. `assertPublicAllowed()` had existed in
 * routes/governance.js since it was written, exported, with ZERO callers and a comment saying "not wired yet". And
 * the Settings row reading `Catalogue visibility · private (cap)` came from a hardcoded array the code itself calls
 * a "7-layer perception stub" — it displayed a governance we did not have.
 *
 * ── THE MODEL ──────────────────────────────────────────────────────────────────────────────────────────────────
 *     CAP     what the entity MAY choose   ← the operator who provisioned it, then the plan
 *     CHOICE  what the entity DID choose   ← identities.catalogue_visibility
 *     EFFECT  the narrower of the two
 *
 * A shop opening its own storefront is its own business. A node provisioned BY A NETWORK is not — the operator
 * decided, and the entity must not be able to undo that from its own profile screen.
 *
 * ── WHY AN UNKNOWN PLAN DOES NOT DENY ──────────────────────────────────────────────────────────────────────────
 * `entitlements.planFor()` default-denies an unknown plan, which is right when granting a quota and wrong here.
 * Every live entity carries `plan: 'free'`, and if the constitution's plan_menu has no `free` entry, a strict
 * reading would close EVERY SHOP ON THE PLATFORM the moment this is wired. That is a bigger harm than the gap it
 * closes, and it would arrive as a silent outage rather than an error anyone could read.
 *
 * So: an ABSENT declaration does not deny. A PRESENT one does.
 *   · operator cap says private            → refused, naming the operator
 *   · plan exists and says public_facing:false → refused, naming the plan
 *   · plan unknown / no constitution        → allowed, and REPORTED as unenforced
 *
 * That is stricter than today (which checked nothing) and honest about where it stops. `strict: true` flips the
 * last line to a denial for an installation that wants it.
 *
 * ── ZERO DEPENDENCIES · TIER A ─────────────────────────────────────────────────────────────────────────────────
 */

const PUBLIC = 'public', PRIVATE = 'private';
// The middle tier: members of the same network, and no one else. See SPEC-network-storefront.md. It is bounded by
// the same cap as PUBLIC — an operator who closed an entity closed it to the network too.
const NETWORK = 'network';

/**
 * capOf({ plan, planMenu, paramsOverride, strict }) → { max, by, reason, enforced }
 *
 * `max` is the most open value this entity may choose. `by` names who capped it, because a refusal a person cannot
 * attribute is a refusal they will treat as a bug.
 */
function capOf(opts = {}) {
  const ov = (opts.paramsOverride && typeof opts.paramsOverride === 'object') ? opts.paramsOverride : {};
  const caps = (ov.caps && typeof ov.caps === 'object') ? ov.caps : {};

  // 1 · THE OPERATOR who provisioned this entity. The most specific statement, so it is checked first, and it is
  //     the only one that can say "this node is not yours to open".
  const opCap = String(caps.catalogue_visibility || '').trim().toLowerCase();
  if (opCap === PRIVATE) {
    return { max: PRIVATE, by: 'operator', enforced: true,
      reason: 'Your network operator set this entity to stay closed. It cannot publish a public catalogue.' };
  }

  /**
   * 2 · THE PLAN — OFF BY DEFAULT, and this is a scar, not a preference.
   *
   * ⚠️ I enforced this and it took the platform down for a minute. The live constitution's plan_menu declares
   * `free: { public_facing: false }`, EVERY entity is on `free`, and nothing had ever read that field — so the
   * moment the check went live, Beta Fresh and every other shop was refused with "a public catalogue is not
   * available on the free plan". Publishing is the product; the commercial tier said otherwise and no one had
   * noticed because it was decoration.
   *
   * The header of this file already argued that an ABSENT declaration must not deny. It did not consider a
   * declaration that is PRESENT, wrong, and load-bearing the moment it is believed. That is the sharper trap: a
   * value nobody has audited becomes policy the instant something starts reading it.
   *
   * So charging for a public catalogue is a COMMERCIAL DECISION, not a bug fix, and it is Athi's to make. It stays
   * off until he turns it on with `enforcePlan: true`, and the cap says out loud that it is not enforcing.
   *
   * The OPERATOR cap above is unaffected — that is the thing he actually asked for, it is explicit per entity, and
   * nobody can set it by accident.
   */
  const menu = (opts.planMenu && typeof opts.planMenu === 'object') ? opts.planMenu : null;
  const planName = String(opts.plan || '').trim();
  const plan = (menu && planName && Object.prototype.hasOwnProperty.call(menu, planName)) ? menu[planName] : null;
  if (plan && opts.enforcePlan) {
    if (plan.public_facing === false) {
      return { max: PRIVATE, by: 'plan', enforced: true,
        reason: `A public catalogue is not available on the ${planName} plan.` };
    }
    return { max: PUBLIC, by: null, enforced: true, reason: '' };
  }
  if (plan && plan.public_facing === false) {
    return { max: PUBLIC, by: null, enforced: false,
      reason: `The ${planName} plan declares no public catalogue, but plan enforcement is off — set enforcePlan to charge for it.` };
  }

  // 3 · NOTHING DECLARED. Allowed, and said out loud — an unenforced cap that reports itself as enforced is how a
  //     governance model becomes decoration.
  if (opts.strict) {
    return { max: PRIVATE, by: 'plan', enforced: true,
      reason: 'No entitlement is declared for this plan, and this installation refuses by default.' };
  }
  return { max: PUBLIC, by: null, enforced: false,
    reason: planName ? `No entitlement declared for the ${planName} plan — visibility is not being enforced.` : '' };
}

/**
 * check(want, cap) → { ok, status, message }
 *
 * `private` is always allowed: a cap bounds how OPEN you may be, never how closed.
 */
function check(want, cap) {
  const w = String(want || '').trim().toLowerCase();
  if (w !== PUBLIC && w !== PRIVATE && w !== NETWORK) {
    return { ok: false, status: 400, message: 'Visibility must be "public", "network" or "private".' };
  }
  if (w === PRIVATE) return { ok: true, status: 200, message: '' };
  // A cap that says private closes the NETWORK tier too: it bounds how OPEN, and `network` is more open than
  // `private`. So an operator-closed entity is invisible even to its own network peers — which is the point of an
  // operator cap, and the opposite of a warehouse the network is meant to see.
  if (cap && cap.max === PRIVATE) {
    return { ok: false, status: 403, message: cap.reason || 'This entity may not publish a public catalogue.' };
  }
  return { ok: true, status: 200, message: '' };
}

/**
 * The effective visibility: the narrower of what was chosen and what is allowed.
 *
 * ⚠️ Returns `network` unchanged. The first version collapsed anything that was not `public` into `private`, which
 * would have made a warehouse's OWN profile report "private" — the owner told their catalogue is closed when it is
 * deliberately open to their network. Whether a given READER may see it is a different question, answered by
 * catalogue-view.catalogueVisibility() with the viewer in hand; this function only narrows a choice by its cap.
 */
function effective(chosen, cap) {
  const c = String(chosen || PRIVATE).trim().toLowerCase();
  if (cap && cap.max === PRIVATE) return PRIVATE;
  if (c === PUBLIC) return PUBLIC;
  if (c === NETWORK) return NETWORK;
  return PRIVATE;
}

module.exports = { capOf, check, effective, PUBLIC, PRIVATE, NETWORK };
