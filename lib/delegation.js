'use strict';
/**
 * lib/delegation.js — THE DELEGATION RULE, area-neutral (Athi 20 Nov): the client's GRANT is the ceiling and the staff member's SEAT narrows within it, per functional AREA.
 * OWNS      AREA_HOMES (the areas a grant may delegate: today only 'books') · GRANT_AREAS (which areas each grant kind reaches) · SEAT_CAPS (per area: what each seat kind may do) · seatKindOf(identity) · areaOfPath(path) · mayDo(area, action, asker).
 * FLOW      a request names a client's path -> areaOfPath finds the area -> grantReaches (the ceiling) -> capsOf (the seat) -> mayDo says yes or no; no stored state, no I/O.
 * CARD      04-network/ACC-176B-ADVISER-REQUIREMENT
 * CALLED BY middleware/books-grant.js (the books door: seats, the synthetic identity, refuseElsewhere) · routes/books-grants.js · lib/private-flag.js (through the middleware).
 * WHERE THE MATRIX WIDENS: a new delegable area (e.g. catalogue) is ONE entry in AREA_HOMES (its path prefix), ONE per-area table in SEAT_CAPS, and the area name in GRANT_AREAS of the grant kinds that reach it. Nothing else here changes; the
 *   later matrix (area -> owner | internal seats | external firms | none) replaces GRANT_AREAS with the stored per-client delegation and keeps mayDo as the one question.
 * Seat kinds are read from the person's own people settings (level, reach, cost sight): owner (the firm's own sign-in) · accountant (editor, whole entity) · reviewer (commenter, whole entity, sees costs) · reports (commenter, whole entity, no costs) · null (View-only, Counter: no delegated area).
 */
/** the path prefix of each delegable area: a request that names a client (X-Books-For) is for these paths only */
const AREA_HOMES = { books: /^\/api\/(books(-actions|-grants)?|marks)(\/|$)/ };
/** the areas each grant kind (role) reaches: today both reach the books only; any other area is refused for a firm because it is not listed here, not by a special case */
const GRANT_AREAS = { adviser: ['books'], auditor: ['books'] };
/** per area, what each seat kind may do (read: the area's records · reports: its figures · review: notes and checks · write: its own doors) */
const SEAT_CAPS = {
  books: {
    owner: { read: true, reports: true, review: true, write: true },
    accountant: { read: true, reports: true, review: true, write: true },
    reviewer: { read: true, reports: true, review: true, write: false },
    reports: { read: false, reports: true, review: false, write: false }
  }
};
function seatKindOf(holder) {
  if (!holder) return null;
  if (holder.identity_type !== 'actor') return holder.parent_entity_id ? null : 'owner';
  if (holder.whole_entity !== true) return null;
  if (holder.access_level === 'editor') return 'accountant';
  if (holder.access_level === 'commenter') return holder.can_see_costs === true ? 'reviewer' : 'reports';
  return null;
}
/** the delegable area a path belongs to, or null (not delegated: the area's own people only) */
const areaOfPath = (path) => Object.keys(AREA_HOMES).find((area) => AREA_HOMES[area].test(String(path))) || null;
/** does a grant of this role reach this area */
const grantReaches = (role, area) => (GRANT_AREAS[role] || []).includes(area);
/** the caps of a seat in an area (all false when none) */
const capsOf = (area, holder) => (SEAT_CAPS[area] || {})[seatKindOf(holder)] || {};
/**
 * mayDo(area, action, asker) -> boolean: asker = { identity (the real person), role (the grant's kind; absent = no grant in the question) }. True only when the grant reaches the area (the ceiling) AND the seat holds the action there.
 */
function mayDo(area, action, asker) {
  if (!asker || !asker.identity || asker.api_key) return false;
  if (asker.role !== undefined && !grantReaches(asker.role, area)) return false;
  return capsOf(area, asker.identity)[action] === true;
}
module.exports = { AREA_HOMES, GRANT_AREAS, SEAT_CAPS, seatKindOf, areaOfPath, grantReaches, capsOf, mayDo };
