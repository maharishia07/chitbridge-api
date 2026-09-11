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
  /**
   * ⚠⚠ AND NO LABEL MAY READ LIKE A MINTED PARTY. Athi, 2026-09-11: *"we should not have enough char to name
   * supplier with entity-id.sup01 etc and get mixed up?"* — the LENGTH is fine (the worst case leaves 9 spare in
   * varchar(100)) and `~` is unforgeable here, because a label must start with a letter or number. The real risk
   * he is pointing at is the READER's: `tallytest.sup-0001` is a perfectly legal store name and sits one tilde
   * away from `~tallytest.sup-0001`, which is a supplier somebody's purchase history hangs from. The code would
   * never confuse them; a person glancing at a list would. So the SHAPE is reserved, not just the prefix.
   */
  /* ⚠ THE STORE NAME ONLY, NOT THE ROOT. A minted party is always `~owner.kind-nnnn`, so the shape is only
     mistakable in the second label; a bare root `sup-0001` has no owner in front of it and resembles nothing.
     ⚠⚠ And check() is called on handles that ALREADY EXIST (network-design reads your current User ID before
     building a network), so a rule that reached the root could lock an existing business out of its own tree
     over a name we only started objecting to today. */
  for (const p of parts.slice(1)) {
    const m = p.match(/^([a-z]+)-[0-9]+$/);
    if (m && MINTED_KINDS.indexOf(m[1]) >= 0) {
      return { ok: false, reason: `"${p}" is the shape of a supplier or customer a business writes down itself (˜you.${m[1]}-0001). Choose another store name.` };
    }
  }
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
/**
 * ⭐⭐ AND A MAXIMUM, BECAUSE A USER ID IS HALF OF THREE OTHER NAMES.
 *
 * Athi, 2026-09-11: *"user id will be the problem as we are actually combining two id to form a new one, so we
 * should limit the size of the user id."*
 *
 * ⚠ IT IS NOT A ROOM PROBLEM — that was measured first, and the worst case the old rules allowed was 91 of the
 * column's 100 characters, so nothing was ever at risk of truncation. It is a READABILITY problem, and his own
 * rule for network handles already settles it: an id nobody can remember is not a handle. A 40-character User ID
 * produces `~fortycharacterbusinessname….sup-0001`, which no one will ever read aloud to a supplier.
 *
 * 20, not the 12 he first suggested: `cornerhardware` is 14 and `sriramtraders` is 13, and a cap that forces a
 * real business to register as `cornerhw` — permanently, because this is set once — buys eight characters at the
 * cost of the name being theirs.
 *
 * ⚠⚠ NEW REGISTRATIONS ONLY. checkRoot() runs on handles being CHOSEN; check() runs on handles that already
 * exist (network-design reads your current User ID before building a tree). The cap lives here, in checkRoot,
 * so a business registered before today keeps its name and its network.
 */
const MAX_ROOT = 20;

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
  if (h.length > MAX_ROOT) {
    return { ok: false, value: h,
      reason: `A User ID is at most ${MAX_ROOT} characters, and "${h}" is ${h.length}. Your staff sign in as `
        + `name@${h.slice(0, MAX_ROOT)} and your suppliers are numbered under it, so it has to stay typeable. `
        + `Your business NAME can be as long as you like — you set that after signing in.` };
  }
  /* Everything else — charset, length cap, reserved words, CB-lookalikes — is check()'s job. One rule set. */
  const c = check(h);
  return { ok: c.ok, reason: c.reason, value: h };
}

/**
 * ⭐⭐⭐ A FOURTH KIND OF NAME: SOMEONE THE ENTITY MINTED, WHO NEVER REGISTERED.
 *
 * Athi, 2026-09-10, on the corner hardware shop that supplies a kirana and will never have a ChitBridge account:
 *
 *   *"Follow the existing path. Only thing is he is not a recipient — so you can't bring him to the rail or
 *   something. Otherwise for all practical purposes he is a bridge user. If you want, mark the user id as some
 *   char prefixed with the entity id and then some marker, so we can identify — like our customer and so on."*
 *
 * ⭐ AND THAT IS THE WHOLE MECHANISM. He is a normal `identity_type = 'entity'` row: every join, every lookup by
 * id, every screen that shows a bridge id keeps working with no null branch and no new type to teach anybody.
 * What separates him is his HANDLE, and the separator does the work exactly as `@` and `.` already do:
 *
 *     acmetraders                    an ENTITY       — registered, the root of everything below
 *     ravi@acmetraders               an EMPLOYEE     — @ binds a person to their business
 *     acmetraders.clothing           a NETWORK node  — . binds a store to the network it was born in
 *     ~acmetraders.sup-0001          a MINTED party  — ~ says "created BY acmetraders, never registered"
 *
 * ── ⭐⭐ THE CONVENTION, AND WHY IT IS A NUMBER AND NOT THE NAME ──────────────────────────────────────────────
 * Athi, 2026-09-10: *"keep some naming convention... I would suggest entity-id-sup-nn"*, then, exactly:
 * *"entity user id-sup-nnnn, whatever, so he is specific to the user."* Adopted. Four parts, left to right:
 *
 *     ~            MINTED. Created by a business, never registered by a person. Cannot sign in, cannot be sent to.
 *     acmetraders  WHOSE — *"specific to the user"*. The minting entity's USER ID, which is the human, sayable,
 *                  set-once name. Not its uuid: Athi's own rule for network handles was that an id nobody can
 *                  remember is not a handle. Only an entity with no user_id yet falls back to its bridge id.
 *     .            the separator that already means "born inside this entity", which is exactly what this is
 *     sup-0001     WHAT and WHICH. `sup` supplier, `cus` customer. The number runs per business, per kind, from
 *                  0001 — four digits because a wholesaler with a thousand local suppliers is a real business,
 *                  and a scheme that has to widen later is one that renumbers, which this must never do.
 *
 * ⚠️ HE WROTE THE SEPARATORS AS HYPHENS AND SAID *"whatever"*, so this uses a dot before `sup`. It is not
 * cosmetic: a user_id may itself contain hyphens, so `acme-traders-sup-0001` cannot be split back into owner and
 * suffix without guessing. The dot is already the platform's "inside this entity" separator and cannot appear in
 * a registered user_id, so it separates cleanly and reads as the grammar it already is.
 *
 * ⭐ MY FIRST VERSION PUT THE SUPPLIER'S NAME THERE — `~acmetraders.corner-hardware` — and Athi's number is
 * better for a reason that is already law in this file: **the handle is set once and the display name is free to
 * change**. A name-shaped handle quietly breaks that. Rename "Corner Hardware" to "Corner Hardware & Sons" and
 * the id still says the old thing for ever, so the two drift apart and the handle starts lying. A number cannot
 * drift because it never claimed to describe anything. It also sidesteps a whole class of nuisance: what
 * "M/s Rajan & Co. (Opp. Bus Stand)" slugs to, what happens when two suppliers slug to the same string, and the
 * fact that a name in a handle leaks a trading relationship to anyone who sees the id.
 *
 * ⭐ THE ONE ADDITION IS THE LEADING `~`, and it is doing work his form cannot do alone. `acmetraders-sup-01` is
 * a perfectly legal handle that a person could REGISTER — hyphens and digits are allowed — so anyone could claim
 * a name that reads like somebody else's supplier record. `~` is illegal in a registered handle already, because
 * check() has always demanded every label begin with a letter or digit. So the marker is unforgeable by
 * construction rather than by a new rule someone must remember to enforce.
 *
 * ⚠️ THE NUMBER IS AN ORDINAL, NOT A COUNT. Suppliers 01, 02, 03 with 02 removed leaves 01 and 03 — the next one
 * is 04, never a reused 02. A recycled id would attach a new supplier to the old one's purchase history.
 *
 * ── ⚠️⚠️ "HE IS NOT A RECIPIENT" IS THE ONE THING THE MARKER MUST ENFORCE ─────────────────────────────────────
 * A chit addressed to someone who cannot sign in is a chit nobody will ever open — it would sit as sent for ever,
 * and the sender would be waiting on an answer that cannot come. So every path that resolves a TYPED identifier
 * into a counterparty refuses these: the recipient resolver, the business search, and adding a supplier or a
 * customer. isMinted() is that one question, asked in each of those places.
 *
 * ⚠️ THE SEARCH EXCLUSION IS ALSO PRIVACY, not tidiness. Who supplies you is one of the few genuinely competitive
 * facts a small business holds; without it, every local supplier a shop wrote down would be discoverable — and
 * addable — by every competitor on the platform.
 */
const MINTED = '~';
const MINTED_KINDS = ['sup', 'cus'];   // supplier, customer. Closed on purpose — a kind is a screen, not a label.
const MINTED_DIGITS = 4;

/**
 * ⭐ `minted('acmetraders', 'sup', 7)` → `~acmetraders.sup-0007`, or { error }.
 * `ownerHandle` is the minting entity's user_id — or its bridge id, for an entity registered before user_ids.
 */
function minted(ownerHandle, kind, n) {
  const owner = String(ownerHandle == null ? '' : ownerHandle).trim().toLowerCase().replace(/[^a-z0-9.-]/g, '');
  if (!owner) return { error: 'The business minting this has no User ID to hang the name from.' };
  const k = String(kind == null ? '' : kind).trim().toLowerCase();
  if (MINTED_KINDS.indexOf(k) < 0) return { error: `"${kind}" is not a kind of minted party.` };
  const seq = Math.floor(Number(n));
  if (!(seq >= 1)) return { error: 'A minted party is numbered from 1.' };
  /* ⚠️ padStart, NOT a fixed width: past 9999 the number simply gets longer. Wrapping or truncating would reuse
     an id, and a reused id attaches a new supplier to the old one's purchase history. */
  const h = MINTED + owner + '.' + k + '-' + String(seq).padStart(MINTED_DIGITS, '0');
  if (h.length > MAX_TOTAL) return { error: 'That business handle is too long to mint names under.' };
  return { handle: h, kind: k, n: seq };
}

/** ⭐ THE ONE QUESTION: was this party created by a business rather than registered by a person? */
function isMinted(handle) {
  return String(handle == null ? '' : handle).trim().charAt(0) === MINTED;
}

/**
 * `~acmetraders.sup-0007` → { owner: 'acmetraders', kind: 'sup', n: 7 }, or null.
 * ⚠️ Split from the LAST dot: a user_id cannot contain a dot, but this parses defensively anyway — the cost of
 * being wrong is attributing a record to the wrong business.
 */
function mintedParts(handle) {
  const h = String(handle == null ? '' : handle).trim().toLowerCase();
  if (!isMinted(h)) return null;
  const body = h.slice(1);
  const cut = body.lastIndexOf('.');
  if (cut < 1) return null;
  const owner = body.slice(0, cut), suffix = body.slice(cut + 1);
  const m = suffix.match(/^([a-z]+)-([0-9]+)$/);
  if (!m || MINTED_KINDS.indexOf(m[1]) < 0) return null;
  return { owner, kind: m[1], n: parseInt(m[2], 10) };
}

/** the SQL prefix for "everything this business minted of this kind" — one place, so the LIKE is never retyped */
function mintedPrefix(ownerHandle, kind) {
  const owner = String(ownerHandle == null ? '' : ownerHandle).trim().toLowerCase();
  return MINTED + owner + '.' + String(kind || '').toLowerCase() + '-';
}

module.exports = { slug, check, checkRoot, child, rootOf, sameRoot, minted, isMinted, mintedParts, mintedPrefix,
                   RESERVED, MAX_LABEL, MAX_DEPTH, MAX_TOTAL, MIN_ROOT, MAX_ROOT, MINTED, MINTED_KINDS,
                   MINTED_DIGITS };
