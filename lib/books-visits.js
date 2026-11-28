'use strict';
/**
 * lib/books-visits.js — the owner's "Who looked" as VISITS, not one row per look
 * OWNER     cb-network (the grant screen is cb-accounting's ACC-176; this is the one grouping rule)
 * RISK      plain
 * OWNS      visitsOf(looks, gapMinutes?) → the visits: a run of looks by the SAME person (or the same firm when the log holds no person) on the SAME grant with no gapMs longer than 30 minutes
 * CALLED BY routes/books-grants.js GET /log (answers { looks, visits }) · tests/books-visits.test.cjs
 * FLOW      the log rows (newest first, as lib/books-grant.looks reads them) → sorted oldest first per (grant, person) → a gapMs of more than 30 minutes closes the visit → newest visit first
 * CARD      04-network/connections-and-invitations
 *
 * A visit says who (the firm, and the person where the log holds one), the role, from and to, how many pages (looks), and the pages listed once each with a count: the screen draws one row and keeps the pages in its detail.
 * A person-less look (a log row from before b866, or a look with no named person) groups under the firm alone, never under a made-up person. A gapMs of exactly 30 minutes keeps the visit going.
 */
const GAP_MINUTES = 30;
const keyOf = (look) => `${look.grant_id}|${look.actor_identity_id || ''}`;

/** the pages of one visit, each route once with how many times it was read, most read first */
function pagesOf(looks) {
  const counts = new Map();
  for (const look of looks) counts.set(look.route_pattern, (counts.get(look.route_pattern) || 0) + 1);
  return [...counts].map(([route, count]) => ({ route_pattern: route, count })).sort((a, b) => b.count - a.count || String(a.route_pattern).localeCompare(String(b.route_pattern)));
}
function visitOf(looks) {
  const first = looks[0];
  const last = looks[looks.length - 1];
  const refused = looks.filter((look) => look.outcome !== 'allowed').length;
  return {
    grant_id: first.grant_id, grantee_entity: first.grantee_entity, actor_identity_id: first.actor_identity_id || null,
    actor_name: first.actor_name || null, actor_entity_name: first.actor_entity_name || null, preset: first.preset || null,
    from: first.at, to: last.at, pages: looks.length, refused, pages_list: pagesOf(looks)
  };
}
/** visitsOf(looks, gapMinutes = 30) → the visits, newest first */
function visitsOf(looks, gapMinutes = GAP_MINUTES) {
  const gapMs = gapMinutes * 60 * 1000;
  const runs = new Map();
  for (const look of [...looks].sort((a, b) => new Date(a.at) - new Date(b.at))) {
    const open = runs.get(keyOf(look)) || [];
    runs.set(keyOf(look), open);
    const last = open[open.length - 1];
    if (!last || new Date(look.at) - new Date(last[last.length - 1].at) > gapMs) open.push([look]);
    else last.push(look);
  }
  return [...runs.values()].flat().map(visitOf).sort((a, b) => new Date(b.to) - new Date(a.to));
}
module.exports = { visitsOf, GAP_MINUTES };
