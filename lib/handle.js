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
 *     athi.mens               a department of Clothing — STILL two levels
 *
 * ── A HANDLE IS ALWAYS EXACTLY TWO LEVELS ──────────────────────────────────────────────────────────────────────
 * Athi, 2026-08-07: *"we don't need levels naming convention — it can be athi.clothing, athi.men etc. Otherwise it
 * will keep growing and it would be difficult to manage if it is 10 levels, and if an employee underneath, it
 * would be difficult."*
 *
 * The first version mirrored the tree into the name: `athi.clothing.mens.formals.shirts`. He is right that this
 * is the wrong thing to mirror. The name is what a person SAYS and TYPES, and a co-assist login is
 * `ravi@athi.clothing` — mirroring five levels of structure would make that `ravi@athi.clothing.mens.formals`,
 * unsayable and unwritable, for no gain.
 *
 * **The ltree already manages the relationship.** Depth belongs there, where it is queried; the handle only has to
 * be unique and memorable. So every member of a network is `root.name`, however deep it actually sits.
 *
 * The cost is honest and worth naming: two nodes called "Mens" under different parents now COLLIDE, where a
 * mirrored name would have separated them. That is caught before anything is created and the operator renames one
 * — a flat namespace you have to keep unique, exactly like every other username on earth.
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
const MAX_DEPTH = 2;           // `athi` or `athi.clothing` — never deeper. Depth lives in the ltree, not the name.
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
  if (parts.length > MAX_DEPTH) return { ok: false, reason: 'A handle is the network name and one store name — for example athi.clothing. Structure below that lives in the network tree, not in the name.' };
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
 * child(anyHandleInTheNetwork, name) → `athi.clothing`, or { error } when it cannot be formed.
 *
 * ALWAYS composes from the ROOT, never from the handle passed in. `child('athi.clothing', 'Mens')` is `athi.mens`,
 * not `athi.clothing.mens` — a department of a department is still one name under the network. Taking the root
 * here rather than asking every caller to remember means a nested node cannot accidentally grow a third level.
 */
function child(anyHandleInTheNetwork, name) {
  const root = rootOf(anyHandleInTheNetwork);
  const rc = check(root);
  if (!rc.ok) return { error: 'The network name is not usable: ' + rc.reason };
  const s = slug(name);
  if (!s) return { error: `"${name}" has no letters or numbers to make a name from.` };
  const composed = root + '.' + s;
  const cc = check(composed);
  if (!cc.ok) return { error: cc.reason };
  return { handle: composed, label: s };
}

/** The network a handle belongs to — `athi.clothing` → `athi`. Tolerates a deeper string so child() can normalise. */
function rootOf(handle) {
  const h = String(handle == null ? '' : handle).trim().toLowerCase();
  return h ? h.split('.')[0] : '';
}

/** Do two handles name members of the same network? A display convenience — the TREE remains the authority. */
function sameRoot(a, b) {
  const ra = rootOf(a), rb = rootOf(b);
  return !!ra && ra === rb;
}

/**
 * ⭐⭐ checkRoot(handle) — THE RULE FOR AN ENTITY'S OWN USER ID. Athi, 2026-08-19:
 *
 *   *"only the entity registers. Employee or network or anyone else can never register through the registration
 *   screen. The validations are minimum of 8 characters, no @, no . because these are reserved for employee and
 *   . is reserved for network."*
 *
 * ⭐ THE TWO BANNED CHARACTERS ARE NOT STYLE — THEY ARE THE GRAMMAR OF THE WHOLE NAMESPACE. One identifier space
 * holds three kinds of thing, and the SEPARATOR is what tells them apart:
 *
 *     acmetraders              an ENTITY      — registered, and the root of everything below
 *     ravi@acmetraders         an EMPLOYEE    — @ binds a person to the entity they work for
 *     acmetraders.clothing     a NETWORK node — . binds a store to the network it was born in
 *
 * So an entity that could register `acme.clothing` would be claiming a name in the NETWORK space, and one that
 * could register `ravi@acme` would be claiming a name in the EMPLOYEE space. The ban is what keeps the three
 * readable at a glance and parseable without a lookup.
 *
 * ⚠️ WHY THIS EXISTS AS A SECOND FUNCTION. check() validates a handle ANYWHERE in the system, so it must ACCEPT
 * a dot — `athi.clothing` is a perfectly good network node. A root is the one position where the dot is illegal,
 * and nothing in check() knew about position. That gap is exactly what let PATCH /profile grow its own private
 * regex that allowed dots, capitals, emails and CB-lookalikes. One concept, one rule, every caller.
 *
 * ⚠️ AND IT IS SET ONCE. Athi: *"the registered user id cannot be changed. Are you able to change your Gmail id?
 * The same way here."* Enforced at the write, not on the screen — see routes/entities.js. The DISPLAY NAME is the
 * mutable one: *"the display name can be anything and any format. No restriction."*
 */
const MIN_ROOT = 8;

function checkRoot(handle) {
  const h = String(handle == null ? '' : handle).trim().toLowerCase();
  if (!h) return { ok: false, reason: 'Choose a User ID.', value: '' };
  if (h.includes('@')) {
    return { ok: false, value: h,
      reason: 'A User ID cannot contain "@". That separator makes an employee sign-in — ravi@yourbusiness.' };
  }
  if (h.includes('.')) {
    return { ok: false, value: h,
      reason: 'A User ID cannot contain ".". That separator makes a network store — yourbusiness.clothing.' };
  }
  if (h.length < MIN_ROOT) {
    return { ok: false, value: h, reason: `A User ID is at least ${MIN_ROOT} characters. "${h}" is ${h.length}.` };
  }
  /* Everything else — charset, length cap, reserved words, CB-lookalikes — is check()'s job. One rule set. */
  const c = check(h);
  return { ok: c.ok, reason: c.reason, value: h };
}

module.exports = { slug, check, checkRoot, child, rootOf, sameRoot, RESERVED, MAX_LABEL, MAX_DEPTH, MAX_TOTAL, MIN_ROOT };
