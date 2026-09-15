'use strict';
/**
 * ── ⭐⭐⭐ RESOLVE A USER ID — READ ONE BACK, IN ONE PLACE ─────────────────────────────────────────────────────────
 *
 * Athi, 2026-09-15: *"mint user id should be a module… similarly, resolve user id should be a module."*
 *
 * `lib/mintuserid.js` MAKES a name. This READS one: given whatever a person typed, it says what KIND of name it
 * is and which parts it carries — before anybody goes near the database.
 *
 * ⚠️⚠️ THE SPLIT IS THE POINT. A builder that also parses starts accepting what it emits and nothing else, and
 * then a form that was minted last year stops being readable. These two files share one grammar (`lib/handle`)
 * and never call each other.
 *
 * ── WHAT IT CAN TELL APART, and how — no lookup required ───────────────────────────────────────────────────────
 *
 *     acmetraders                   entity      no separator at all
 *     ravi@acmetraders.br           employee    "@" and the .br suffix
 *     9876512345@alpha-timers.cr    customer    "@" and the .cr suffix
 *     ~acmetraders.sup-0001         minted      leading "~"
 *     CBM5P72HB7                    bridge_id   CB + 8 from the unambiguous alphabet
 *     CBM5P72HB7@in.example         foreign     a bridge id, then a DOMAIN
 *     ravi@acmetraders              employee_typed — what a person actually types at a login box
 *
 * ⚠️⚠️ `ravi@acmetraders` IS DELIBERATELY ITS OWN ANSWER, not "employee". It is the unsuffixed form somebody
 * types, and it is also — character for character — what a foreign address looks like when the domain has no
 * dot. The grammar cannot settle that one alone, so it does not pretend to: it reports `employee_typed` and
 * hands the caller the two candidate readings. **Which field it was typed in decides**, and after that the
 * order in docs/NAMESPACE.md §5: local first, and only a PAIRED installation makes it foreign.
 *
 * ⚠️ ORDER MATTERS BELOW. The suffixed forms are tested before the bare one, because `ravi@acmetraders.br` also
 * satisfies "contains @".
 */

const handle = require('./handle');
const versionref = require('./versionref');   /* the OTHER meaning of "@" — asked, never re-implemented */

const BRIDGE = /^CB[A-HJ-NP-Z2-9]{8}$/;                 /* the minted alphabet: no I, O, 0 or 1 */
const DOMAINISH = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;        /* at least one dot — in.example, ae.chitbridge.com */

/**
 * classify(typed) → { kind, ...parts }
 *
 * Never throws and never guesses silently: an unreadable string comes back as `kind: 'unknown'` with a reason,
 * because "I cannot read this" is an answer a screen can show and an exception is not.
 */
function classify(typed) {
  const raw = String(typed == null ? '' : typed).trim();
  if (!raw) return { kind: 'unknown', why: 'nothing was typed' };
  const h = raw.toLowerCase();

  /* a bridge id, bare or qualified by a domain — checked on the RAW string, because a bridge id is upper case */
  if (BRIDGE.test(raw)) return { kind: 'bridge_id', bridge_id: raw };
  const at = raw.lastIndexOf('@');
  if (at > 0) {
    const left = raw.slice(0, at), right = raw.slice(at + 1).toLowerCase();
    if (BRIDGE.test(left) && DOMAINISH.test(right)) {
      return { kind: 'foreign', bridge_id: left, domain: right };
    }
  }

  if (handle.isMinted(h)) {
    const p = handle.mintedParts(h);
    return p ? { kind: 'minted', owner: p.owner, minted_kind: p.kind, n: p.n, sendable: false }
             : { kind: 'unknown', why: 'it starts with ~ but is not a minted party' };
  }

  if (handle.isEmployee(h)) {
    const p = handle.employeeParts(h);
    return p ? { kind: 'employee', actor_key: p.actor_key, at: p.at, handle: h }
             : { kind: 'unknown', why: 'it ends in .br but carries no business' };
  }

  if (handle.isCustomer(h)) {
    const body = h.slice(0, -handle.CUSTOMER.length);
    const cut = body.lastIndexOf('@');
    if (cut < 1) return { kind: 'unknown', why: 'it ends in .cr but carries no shop' };
    const local = body.slice(0, cut);
    /* ⚠️ "=" is an EMAIL with its @ swapped — mintuserid.customer does that so two addresses at one shop stay
       two people. Swapping it back is presentation only; the stored handle is never rewritten. */
    const isEmail = local.indexOf('=') >= 0;
    return { kind: 'customer', at: body.slice(cut + 1), handle: h,
             channel: isEmail ? 'email' : 'phone',
             contact: isEmail ? local.replace('=', '@') : local };
  }

  /**
   * ── ⚠️⚠️ "@" HAS A SECOND MEANING IN THIS CODEBASE, AND IT IS NOT AN IDENTITY ────────────────────────────────
   *
   * Athi, 2026-09-15: *"check the constitution logic, all should work perfectly."* It does — and the reason is
   * worth stating, because it looks like a collision and is not:
   *
   *     ravi@acmetraders          a PARTY      — a person at a business
   *     gst-india@v1              a VERSION    — a constitution, standard, container or work pattern, at a version
   *
   * `constitution_key@version` (routes/entities.js, lib/govresolve.js), `standard_key@version`
   * (lib/conformance.js), `container_id@version` (lib/container.js, lib/regional.js) and the work-pattern facet
   * map all compose this shape. **None of them is ever stored in `identities.user_id`**, so nothing can collide
   * where it matters — but a version ref handed to THIS function would have come back as `employee_typed`, and
   * a caller acting on that would go looking for a person called `gst-india`.
   *
   * ⭐ THEY ARE TELLABLE APART WITHOUT A LOOKUP, which is the standard this whole grammar is held to: a business
   * handle is at least MIN_ROOT (8) characters, and a version is `v` and digits. Nothing legal is both.
   */
  /* ⚠️ ASKED, NOT RE-IMPLEMENTED. This had its own copy of the version regex for about ten minutes, and it was
     already wrong: it did not know `thing@code`, which lib/workpattern composes for an unminted blueprint. One
     rule, one file. [[feedback-no-duplicate-functions]] */
  if (versionref.is(raw)) {
    const p = versionref.parse(raw);
    return { kind: 'version_ref', of: p.key, version: p.version,
             why: 'thing@version — a constitution, standard or container, not a party' };
  }

  /* ⚠️ the ambiguous one — see the header. Two readings, both offered, neither chosen here. */
  if (at > 0) {
    const left = raw.slice(0, at).toLowerCase(), right = raw.slice(at + 1).toLowerCase();
    if (!left || !right) return { kind: 'unknown', why: 'an "@" with nothing on one side of it' };
    return {
      kind: 'employee_typed', actor_key: left, at: right,
      could_be: DOMAINISH.test(right) ? ['employee', 'foreign'] : ['employee'],
      why: 'an unsuffixed name — which field it was typed in decides. See docs/NAMESPACE.md §5.',
    };
  }

  const c = handle.check(h);
  if (!c.ok) return { kind: 'unknown', why: c.reason };
  return { kind: h.indexOf('.') > 0 ? 'network_node' : 'entity', handle: h, root: handle.rootOf(h) };
}

/**
 * ⭐ may a chit be addressed to what this string names? The one question every send path asks.
 * ⚠️ A version ref is not a party at all, so it is not sendable either — and it is listed explicitly rather
 * than left to fall through, because "not minted and not unreadable" would have said yes to `gst-india@v1`.
 */
const NOT_A_PARTY = ['minted', 'version_ref', 'unknown'];
function isSendable(typed) {
  return NOT_A_PARTY.indexOf(classify(typed).kind) < 0;
}

/**
 * ⭐ THE STORED FORM of what somebody typed — so a caller can look a row up without knowing the grammar.
 * `ravi@acmetraders` at a login box is stored as `ravi@acmetraders.br`; everything else is already stored as
 * typed. Returns null when there is no single stored form (an unreadable string, or a bare bridge id, which is
 * not a user_id at all).
 */
function storedForm(typed, opts) {
  const c = classify(typed);
  if (c.kind === 'employee' || c.kind === 'customer' || c.kind === 'entity' ||
      c.kind === 'network_node' || c.kind === 'minted') {
    return c.handle || String(typed).trim().toLowerCase();
  }
  if (c.kind === 'employee_typed' && (!opts || opts.as !== 'foreign')) {
    return c.actor_key + '@' + c.at + handle.EMPLOYEE;
  }
  return null;
}

/** every kind classify() can return — asserted by the register, so a new one cannot arrive undocumented */
const KINDS = ['entity', 'network_node', 'employee', 'employee_typed', 'customer', 'minted',
               'bridge_id', 'foreign', 'version_ref', 'unknown'];

module.exports = { classify, isSendable, storedForm, KINDS, BRIDGE, DOMAINISH };
