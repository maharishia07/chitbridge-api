'use strict';
/**
 * lib/delegation.js — THE DELEGATION RULE, area-neutral (Athi 20 Nov): the client's GRANT is the ceiling and the staff member's SEAT narrows within it, per functional AREA.
 * OWNER     cb-security
 * RISK      access
 * OWNS      AREA_HOMES (the areas a grant may delegate) · GRANT_CEILING (per grant kind, per area: the highest LEVEL it may reach, from lib/access RANK) · ACTION_MIN (the level each action needs) · SEAT_CAPS · seatKindOf(identity) · areaOfPath(path) · mayActIn(area, action, asker).
 * FLOW      a request names a client's path -> areaOfPath finds the area -> mayActIn: (1) via 'grant': the grant kind must be known, reach the area, and its ceiling LEVEL must carry the action (an auditor grant is a commenter ceiling: it never writes, whatever the seat) -> (2) the seat's caps; no stored state, no I/O.
 * CARD      04-network/ACC-176B-ADVISER-REQUIREMENT
 * CALLED BY middleware/books-grant.js (the books door: seats, the synthetic identity, refuseElsewhere) · routes/books-grants.js · lib/private-flag.js (through the middleware).
 * H-h1 (20 Nov, critic slice 0): the ceiling carries a LEVEL not only an area; a grant asker with no known role is REFUSED (an absent role used to skip the ceiling); role names are looked up in a Map (a role named __proto__ or constructor finds nothing); the answer says why ({ may, code, why }); the name no longer collides with lib/repeat-supply.js mayDo.
 * WHERE THE MATRIX WIDENS: a new delegable area is ONE entry in AREA_HOMES, ONE per-area table in SEAT_CAPS, and its level in GRANT_CEILING of each grant kind that reaches it.
 * Seat kinds are read from the person's own people settings (level, reach, cost sight): owner · accountant (editor, whole entity) · reviewer (commenter, whole entity, sees costs) · reports (commenter, whole entity, no costs) · null (nothing here).
 */
const access = require('./access');
/** the path prefix of each delegable area: a request that names a client (X-Books-For) is for these paths only */
const AREA_HOMES = new Map([
  ['books', /^\/api\/(books(-actions|-grants)?|marks)(\/|$)/],
  /* CON-165 (Athi 27 Nov): the client's party list and one record, READ ONLY. EXACT paths: the timeline, consent, follow-ups, calls, groups, segments and Marketing stay outside every area (BOOKS_FOR_NOT_HERE) */
  ['parties', /^\/api\/(crm\/parties(\/[^/]+)?|relationships\/(customers|suppliers))\/?$/]
]);
/** per grant kind (role), per area: the highest level the grant reaches. An adviser acts for the owner (editor); an auditor only reads and reviews (commenter). A role not in this Map has no ceiling and is refused. */
const GRANT_CEILING = new Map([
  ['adviser', new Map([['books', access.EDITOR], ['parties', access.VIEWER]])],
  ['auditor', new Map([['books', access.COMMENTER], ['parties', access.VIEWER]])]
]);
/** the level each action needs (lib/access RANK): read and reports need no more than a viewer's level, review a commenter's, write an editor's */
const ACTION_MIN = new Map([['read', access.VIEWER], ['reports', access.VIEWER], ['review', access.COMMENTER], ['write', access.EDITOR]]);
/** per area, what each seat kind may do (read: the area's records · reports: its figures · review: notes and checks · write: its own doors) */
const SEAT_CAPS = new Map([
  ['books', new Map([
    ['owner', { read: true, reports: true, review: true, write: true }],
    ['accountant', { read: true, reports: true, review: true, write: true }],
    ['reviewer', { read: true, reports: true, review: true, write: false }],
    ['reports', { read: false, reports: true, review: false, write: false }]
  ])],
  /* parties: reading only. A Reports / MIS seat reads figures, not people; nobody writes through a grant */
  ['parties', new Map([
    ['owner', { read: true, reports: false, review: false, write: false }],
    ['accountant', { read: true, reports: false, review: false, write: false }],
    ['reviewer', { read: true, reports: false, review: false, write: false }],
    ['reports', { read: false, reports: false, review: false, write: false }]
  ])]
]);
/**
 * the seat kind of a person, from the same three facts the people screen reads (lib/access levelOf · reach · cost sight). An editor with the whole entity is the accountant (cost sight narrows costs, not the seat: presetFor has no
 * row for an editor without costs, so asking it would lock a cost-blind accountant out); below editor the Reviewer preset (access.presetFor) decides reviewer or reports.
 */
function seatKindOf(holder) {
  if (!holder) return null;
  if (holder.identity_type !== 'actor') return holder.parent_entity_id ? null : 'owner';
  if (holder.whole_entity !== true) return null;
  const level = access.LEVELS.includes(holder.access_level) ? holder.access_level : null; /* an absent or odd level is no seat here (fail closed; levelOf would read absent as editor) */
  if (!level) return null;
  if (access.RANK[level] >= access.RANK[access.EDITOR]) return 'accountant';
  if (level !== access.COMMENTER) return null;
  return access.presetFor(level, true, holder.can_see_costs === true, true) ? 'reviewer' : 'reports';
}
/** the delegable area a path belongs to, or null (not delegated: the area's own people only) */
const areaOfPath = (path) => [...AREA_HOMES.keys()].find((area) => AREA_HOMES.get(area).test(String(path))) || null;
/** does a grant of this role reach this area at all */
const grantReaches = (role, area) => typeof role === 'string' && GRANT_CEILING.has(role) && GRANT_CEILING.get(role).has(area);
/** the caps of a seat in an area (all false when none): the SEAT alone, no grant in the question */
const capsOf = (area, holder) => ((SEAT_CAPS.get(area) || new Map()).get(seatKindOf(holder))) || {};
const no = (code, why) => ({ may: false, code, why });
/** a grant asker that does not get through: the grant's area not reached (or role unknown), or its ceiling below the action → the refusal answer, else null */
function grantRefusal(asker, area, action) {
  if (!grantReaches(asker.role, area)) return no(typeof asker.role === 'string' && GRANT_CEILING.has(asker.role) ? 'GRANT_AREA_NOT_REACHED' : 'GRANT_ROLE_UNKNOWN', 'This access does not reach that part.');
  if (access.RANK[GRANT_CEILING.get(asker.role).get(area)] < access.RANK[ACTION_MIN.get(action)]) return no('GRANT_CEILING', 'This access is read and review only.');
  return null;
}
/**
 * mayActIn(area, action, asker) -> { may, code, why }. asker = { identity (the real person), via: 'grant' | 'self', role (the grant's kind; needed when via is 'grant'), api_key }.
 * via 'grant': the grant kind must be known (Map lookup), reach the area, and its ceiling LEVEL must carry the action; then the seat must hold it. via 'self': the person's own entity: the seat alone. Anything else (no via, no identity, a device key, an unknown area or action): refused.
 */
function mayActIn(area, action, asker) {
  if (!asker || !asker.identity || asker.api_key) return no('NO_SEAT', 'No signed-in person with a seat.');
  if (!AREA_HOMES.has(area)) return no('AREA_NOT_DELEGATED', 'This area is not opened to a firm.');
  if (!ACTION_MIN.has(action)) return no('ACTION_UNKNOWN', 'That is not a known action.');
  if (asker.via === 'grant') {
    const refused = grantRefusal(asker, area, action);
    if (refused) return refused;
  } else if (asker.via !== 'self') return no('VIA_NEEDED', 'The question must say whether it is a grant or the person\'s own entity.');
  return capsOf(area, asker.identity)[action] === true ? { may: true, code: null, why: null } : no('SEAT_NARROWS', 'Your seat does not allow that here.');
}
module.exports = { AREA_HOMES, GRANT_CEILING, ACTION_MIN, SEAT_CAPS, seatKindOf, areaOfPath, grantReaches, capsOf, mayActIn };
