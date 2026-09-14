'use strict';
/**
 * lib/namedentity.js — ONE WAY TO NAME A SPECIAL ENTITY IN THE ENVIRONMENT.
 *
 * Two things in this codebase point at one particular entity chosen by configuration rather than by a request:
 * the shared test board (TEST_BOARD_ENTITY) and the platform root (PLATFORM_ROOT_ENTITY). They resolve it the
 * same way, and a second copy of "read env, check it is a uuid, warn if it is not" is the kind of duplication
 * that drifts — one copy gains a trim, the other does not, and the difference is invisible until a deployment
 * behaves differently from its twin. [[feedback-no-duplicate-functions]]
 *
 * ── ⚠️⚠️ A UUID OR NOTHING, AND NEVER A NAME ──────────────────────────────────────────────────────────────────
 *
 * Athi, 2026-09-14: *"this is the platform of platform… tomorrow if we whitelabel, we need to have a root
 * entity. can we name something like root, say CBINCROOT so we follow this."*
 *
 * The CONVENTION `<brand>root` is for people — it is what a human reads in a supplier list. It must never be
 * what CODE resolves. A lookup like `WHERE user_id LIKE '%root'` makes any customer who registers `myshoproot`
 * into a root entity, and there is nothing to stop them registering it: the handle rules reserve the bare word
 * `root`, not every handle ending in it.
 *
 * ⭐ So the identity is the UUID, held in the environment, and the handle is a label with no authority. That is
 * also what makes white-labelling work: each deployment sets its own uuid and no code knows the brand.
 *
 * ⚠️ AND A MALFORMED VALUE RESOLVES TO NOTHING, LOUDLY. Passing a half-typed uuid through would scope every
 * query to an entity that does not exist and report an empty everything — a silent, confusing failure that
 * looks like missing data rather than a broken setting.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read one entity uuid out of the environment.
 *
 * @param {string} varName  the environment variable, e.g. 'PLATFORM_ROOT_ENTITY'
 * @param {string} tag      what to call this in the warning, e.g. 'platformroot'
 * @param {string} unsetSays  what behaviour an unset value falls back to, for the warning line
 * @returns {string|null} the uuid, or null when unset or malformed
 */
function fromEnv(varName, tag, unsetSays) {
  const raw = String(process.env[varName] || '').trim();
  if (!raw) return null;
  if (!UUID.test(raw)) {
    console.warn('[' + tag + '] ' + varName + ' is set but is not a uuid — ignoring it, ' + unsetSays);
    return null;
  }
  return raw;
}

module.exports = { fromEnv, UUID };
