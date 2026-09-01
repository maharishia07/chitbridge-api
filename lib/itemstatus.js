'use strict';
// lib/itemstatus.js — a catalogue item's LIFECYCLE. Set a flag; never delete the row.
//
// Athi, 2026-08-13: *"add a field called available / not available / redundant / retired etc so we don't need to
// amend the catalogue, but we can set the flag… need to differentiate between temporarily not available to never."*
//
// ── ⚠️ TEMPORARY AND PERMANENT BEHAVE DIFFERENTLY IN THE MATCHER, WHICH IS THE WHOLE POINT ──────────────────────
//   available    — matches, prices. The normal state, and the state of every row that has never been touched.
//   unavailable  — ⭐ STILL MATCHES. Out of stock today is not "we have never heard of this": the order must
//                  record what the customer asked for, priced as usual, with a flag saying it cannot ship. If it
//                  stopped matching, an out-of-stock tomato would come back as "no catalogue match" —
//                  indistinguishable from a product nobody sells, and the request would silently lose its item.
//   retired      — does NOT match new orders. Discontinued for good. Old chits keep their own copy of the line,
//                  so history is untouched; only new readings stop resolving to it.
//   redundant    — does NOT match either, and carries `replaced_by`. The difference from retired is that there
//                  IS a right answer, and saying which one is the useful half.
//
// ── ⚠️ THIS IS NOT `avail` ──────────────────────────────────────────────────────────────────────────────────────
// `item_data.avail` already exists and is a QUANTITY feed ({qty, source, as_of}) — how many are on the shelf.
// This is whether the item is a thing you sell at all. A shelf can be empty without the product being retired,
// and a retired product can still have stock nobody may order. Two questions, two fields.
//
// ⚠️ AN ABSENT STATUS MEANS AVAILABLE. Every existing row predates this field, and a migration that had to touch
// all of them to say "normal" would be a migration that could get it wrong.

/**
 * ── ⚠️ ADOPTED, NOT INVENTED — schema.org ItemAvailability ──────────────────────────────────────────────────────
 * Athi's standing rule: *"any logic, common field that we are incorporating follow the standards, so we don't
 * need to invent."* I wrote these four names first and checked afterwards, which is the wrong order. There IS a
 * standard for exactly this concept — `schema.org/ItemAvailability`, already listed in CBCatalogue.STANDARDS as
 * "by reference" — and three of the four map onto it directly.
 *
 * The human names stay as the API and screen vocabulary, because "not available" is what a trader says and
 * `https://schema.org/OutOfStock` is not. The standard value travels beside it so an export, a feed or a
 * storefront reads as the rest of the world expects. Vocabulary alignment, no vendor code — the same posture the
 * PIM entry in STANDARDS already takes.
 *
 * ⚠️ ONE PLACE WE ARE FINER THAN THE STANDARD, deliberately: schema.org has a single `Discontinued`, which
 * conflates "we stopped selling it" with "use that one instead". The second carries a successor and is worth
 * acting on, so CB keeps them apart and both export as Discontinued. Being finer than a standard is safe;
 * exporting a value it does not define would not be.
 *
 * NOT adopted: Medusa's ProductStatus (draft/proposed/published/rejected). That is a PUBLICATION workflow — is
 * this listing ready to show — which is a different question from whether the thing can be ordered.
 */
const SCHEMA_ORG = {
  available:   'https://schema.org/InStock',
  unavailable: 'https://schema.org/OutOfStock',
  retired:     'https://schema.org/Discontinued',
  redundant:   'https://schema.org/Discontinued',
};

const STATUSES = ['available', 'unavailable', 'redundant', 'retired'];

/** Statuses a NEW order may resolve to. Retired and redundant are readable history, not sellable items. */
const MATCHABLE = new Set(['available', 'unavailable']);

/** Statuses that mean "you cannot have this now" — used to explain, not to hide. */
const BLOCKED = new Set(['redundant', 'retired']);

const statusOf = (item_data) => {
  const s = String((item_data && item_data.status) || '').toLowerCase().trim();
  return STATUSES.includes(s) ? s : 'available';
};

const isMatchable = (item_data) => MATCHABLE.has(statusOf(item_data));

/**
 * ⭐⭐ CAN A CUSTOMER PICK THIS RIGHT NOW — a DIFFERENT question from isMatchable, and conflating them was my bug.
 *
 * Athi, 2026-09-01: *"if stock unavailable is set, then it should not appear at all for the customer to select.
 * It is a temp retirement. Only available stock should be visible."*
 *
 * ⚠️ I GATED THE STOREFRONT ON isMatchable AND REPORTED IT DONE. It is not: `MATCHABLE` deliberately INCLUDES
 * `unavailable`, so out-of-stock products went on being listed and ordered. The predicate did exactly what its
 * own file says it does; I read the name and not the set.
 *
 * ⭐ AND isMatchable MUST NOT CHANGE. Its reasoning is right and is written above: an out-of-stock tomato named
 * in a WhatsApp message has to keep resolving, or the request comes back "no catalogue match" —
 * indistinguishable from a product nobody sells — and silently loses the item. The order records what was asked
 * for, priced as usual, flagged as unshippable.
 *
 *   isMatchable  — "do we know what this IS?"      · available · unavailable        → the matcher
 *   isOfferable  — "may somebody take one NOW?"    · available                      → browsing and ordering
 *
 * Two questions about one row. One predicate could only ever have got one of them right.
 */
const OFFERABLE = new Set(['available']);
const isOfferable = (item_data) => OFFERABLE.has(statusOf(item_data));

/**
 * stamp(body) — validate a status change into the shape stored on the item.
 *
 * ⚠️ `until` IS WHAT MAKES "TEMPORARY" MEAN ANYTHING. "Not available" with no end is indistinguishable from
 * retired to everyone except the person who set it, and that person forgets. A date is optional but asked for,
 * and when it is in the past the reader can say "this was due back on Saturday" instead of quietly staying off.
 *
 * ⚠️ `replaced_by` IS REQUIRED FOR redundant, because redundant means "use that one instead" — without the
 * pointer it is just a worse way of saying retired.
 */
function stamp(body = {}, who = {}) {
  const status = String(body.status || '').toLowerCase().trim();
  if (!STATUSES.includes(status)) {
    const e = new Error('status must be one of: ' + STATUSES.join(', ')); e.status = 400; throw e;
  }
  if (status === 'redundant' && !body.replaced_by) {
    const e = new Error('A redundant item needs replaced_by — the point of "redundant" is that there is a right '
      + 'answer. Without one, use "retired".');
    e.status = 400; throw e;
  }
  if (body.until && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.until))) {
    const e = new Error('until must be YYYY-MM-DD'); e.status = 400; throw e;
  }
  if (status !== 'unavailable' && body.until) {
    /* ⚠️ REFUSED RATHER THAN IGNORED. A return date on a retired item is someone believing it comes back. */
    const e = new Error('until only applies to "unavailable" — a retired or redundant item is not coming back.');
    e.status = 400; throw e;
  }
  /**
   * ⚠️ FLAT FIELDS, NOT A NESTED OBJECT — and this was nearly a silent bug. The first version returned
   * `{status, until, …}` to be stored AT `item_data.status`, while statusOf() read `item_data.status` as a
   * STRING. `String({...})` is "[object Object]", which is not in the list, so every item would have fallen
   * back to "available" and the whole feature would have done nothing at all — quietly, with no error.
   * One shape, one place: the status is a string, its details sit beside it.
   */
  return {
    status,
    status_until: body.until ? String(body.until) : null,
    status_replaced_by: body.replaced_by ? String(body.replaced_by).slice(0, 120) : null,
    status_note: body.note ? String(body.note).slice(0, 300) : null,
    status_at: new Date().toISOString(),
    status_by: who.actor_name ? String(who.actor_name).slice(0, 120) : null,
    /**
     * The interop value, stored beside the human one so a feed or storefront reads as the world expects.
     *
     * ⚠️ NAMED `status_schema_org`, NOT `availability` — which is what I wrote first. `item_data.avail` is the
     * QUANTITY feed, and an `item_data.availability` sitting next to it would read as the same thing to anyone
     * who arrived later. They do not collide in storage; they collide in the reading, which is the kind that
     * survives review. Every other field this stamp writes is `status_*`, and this one belongs to the status.
     */
    status_schema_org: SCHEMA_ORG[status],
  };
}

/** A sentence a person can read on a line, rather than a code they have to learn. */
function explain(item_data) {
  const s = statusOf(item_data);
  if (s === 'available') return null;
  const d = item_data || {};
  if (s === 'unavailable') {
    if (!d.status_until) return 'not available at the moment';
    const back = new Date(d.status_until + 'T00:00:00Z');
    return back < new Date() ? ('was due back on ' + d.status_until) : ('back on ' + d.status_until);
  }
  if (s === 'redundant') return d.status_replaced_by ? ('replaced by ' + d.status_replaced_by) : 'replaced';
  return 'retired — no longer sold';
}

module.exports = { STATUSES, MATCHABLE, OFFERABLE, BLOCKED, SCHEMA_ORG, statusOf, isMatchable, isOfferable, stamp, explain };
