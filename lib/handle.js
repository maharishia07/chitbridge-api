// @stage tested
// @stage-note The human-readable name of a store inside a network — `athi.clothing`. Pure; no DB. Uniqueness is
// enforced by the existing unique index on lower(user_id), not here.
'use strict';
/**
 * handle.js — a name a person can say out loud.
 *
 * Athi, 2026-08-07: *"instead of bridgeid it should be user id. Example: Athi is the top / root / network name,
 * then clothing is going to be athi.clothing and so on. Every member at whatever level will have the same naming
 * convention, and the bridge id for everyone is going to be different. ltree manages the relationship. If you keep
 * bridgeid.clothing, people cannot remember the id — it has to be human readable."*
 *
 * He is right, and my first version was wrong for exactly that reason. `CBV97P3TYA.clothing` is unique and
 * unusable: nobody reads it over the phone, nobody types it into "add a supplier". A handle that cannot be
 * remembered is not a handle, it is a second id.
 *
 *     athi                    the root — the network's own name
 *     athi.clothing           a department
 *     athi.clothing.mens      a department of a department — same convention at every level
 *
 * ── THREE NAMES, THREE JOBS ────────────────────────────────────────────────────────────────────────────────────
 *     bridge_id     CBM5P72HB7      the IDENTITY — minted, unique, never changes, never reused, never typed
 *     user_id       athi.clothing   the HANDLE — unique, human, portable; what you give someone
 *     display_name  Clothing        the LABEL — what a person reads; not unique and does not need to be
 *
 * ── THE HANDLE RECORDS WHERE A STORE WAS BORN, NOT WHERE IT SITS ───────────────────────────────────────────────
 * ⚠️ Membership lives in the ltree, not in the name. So a store that later joins a second network KEEPS
 * `athi.clothing` — which is what makes it portable in the first place: *"entityid.storename can be used for adding
 * it in another network or as a supplier to someone else."* The consequence is that a handle can outlive the
 * relationship it describes, the way a username outlives the reason you chose it. That is a deliberate trade for
 * stability: a name that changed when a store moved could not be used to move it.
 *
 * ── ZERO DEPENDENCIES · TIER A ─────────────────────────────────────────────────────────────────────────────────
 */

const MAX_LABEL = 40;
const MAX_DEPTH = 5;           // athi.clothing.mens.formals.shirts — deeper than any real trading structure
const MAX_TOTAL = 100;         // identities.user_id is varchar(100)

/**
 * Labels a handle may not use.
 *
 * `api`, `www`, `app`, `admin` because a handle appears in URLs and support conversations; `cb` because it prefixes
 * every bridge id. Small and closed on purpose — a long reserved list is a list nobody can check against.
 */
const RESERVED = ['api', 'www', 'app', 'admin', 'root', 'cb', 'chitbridge', 'network', 'system', 'support', 'help'];

/** A bridge id is CB + 8. A handle that LOOKS like one could impersonate an identity in any field that takes both. */
const LOOKS_LIKE_BRIDGE = /^cb[a-z0-9]{8}$/;

/**
 * slug(name) → one label. "Men's Clothing" → "mens-clothing".
 *
 * Lowercase because the uniqueness index is on lower(user_id): storing mixed case would let `Athi.Clothing` and
 * `athi.clothing` look different while colliding, which is the worst of both.
 */
function slug(name) {
  return String(name == null ? '' : name)
    .toLowerCase()
    .replace(/['’]/g, '')                  // don't turn "Men's" into "men-s"
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, MAX_LABEL);
}

/**
 * check(handle) → { ok, reason }
 *
 * Format only. Whether it is TAKEN is a database question, answered by the unique index on lower(user_id).
 */
function check(handle) {
  const h = String(handle == null ? '' : handle).trim().toLowerCase();
  if (!h) return { ok: false, reason: 'A handle cannot be empty.' };
  if (h.length > MAX_TOTAL) return { ok: false, reason: `A handle can be at most ${MAX_TOTAL} characters.` };
  if (h.includes('@')) return { ok: false, reason: 'A handle is not an email address.' };
  if (/\.\./.test(h) || h.startsWith('.') || h.endsWith('.')) return { ok: false, reason: 'Use single dots between names, e.g. athi.clothing.' };

  const parts = h.split('.');
  if (parts.length > MAX_DEPTH) return { ok: false, reason: `A handle can go at most ${MAX_DEPTH} levels deep.` };
  for (const p of parts) {
    if (!p) return { ok: false, reason: 'Every part of a handle must have a name.' };
    if (!/^[a-z0-9][a-z0-9-]*$/.test(p) || p.endsWith('-')) {
      return { ok: false, reason: `"${p}" must be letters, numbers and dashes, starting with a letter or number.` };
    }
    if (p.length > MAX_LABEL) return { ok: false, reason: `"${p}" is longer than ${MAX_LABEL} characters.` };
  }
  // Only the ROOT is checked against the reserved list — `athi.support` is a perfectly good department name, while
  // a top-level `support` would be confusing in every URL and every conversation.
  if (RESERVED.includes(parts[0])) return { ok: false, reason: `"${parts[0]}" is reserved. Choose another name.` };
  if (LOOKS_LIKE_BRIDGE.test(parts[0])) return { ok: false, reason: 'A handle cannot look like a User ID (CB…).' };
  return { ok: true, reason: '' };
}

/**
 * child(rootHandle, name) → `athi.clothing`, or { error } when it cannot be formed.
 *
 * The root is a handle in its own right, so this composes at any depth: child('athi.clothing', 'Mens') is
 * `athi.clothing.mens`. Same convention at every level, which is what makes the tree readable from the name alone.
 */
function child(rootHandle, name) {
  const root = String(rootHandle == null ? '' : rootHandle).trim().toLowerCase();
  const rc = check(root);
  if (!rc.ok) return { error: 'The network name is not usable: ' + rc.reason };
  const s = slug(name);
  if (!s) return { error: `"${name}" has no letters or numbers to make a name from.` };
  const composed = root + '.' + s;
  const cc = check(composed);
  if (!cc.ok) return { error: cc.reason };
  return { handle: composed, label: s };
}

/** The network a handle belongs to — `athi.clothing.mens` → `athi`. */
function rootOf(handle) {
  const h = String(handle == null ? '' : handle).trim().toLowerCase();
  return h ? h.split('.')[0] : '';
}

/** Do two handles name members of the same network? A display convenience — the TREE remains the authority. */
function sameRoot(a, b) {
  const ra = rootOf(a), rb = rootOf(b);
  return !!ra && ra === rb;
}

module.exports = { slug, check, child, rootOf, sameRoot, RESERVED, MAX_LABEL, MAX_DEPTH, MAX_TOTAL };
