'use strict';
/**
 * lib/crm-firm-read.js — THE PARTY LIST'S PAGE, ITS SEARCH, AND WHAT A FIRM SEAT MAY ASK AND SEE UNDER A BOOKS GRANT (CRM-259/261, CON-165).
 * OWNS      the page size of GET /parties (PAGE) · the ONE search rule (matchesQuery) · the query a grant reader may send (askedOf) · the cut answers of the two party GETs.
 * CALLED BY lib/crm.js (list: the search) · routes/crm.js (GET /parties, GET /parties/:id).
 * FLOW      route → listOptions(req) (what the reader asked, cut under a grant) → crm.list → cutList / cutRecord when req.acting_for_grant, else the owner's own answer.
 * OWNER     cb-crm (with cb-security)
 * RISK      access
 * CARD      11-crm-and-marketing/crm-parties
 */
const view = require('./party-grant-view');
const { textOf } = require('./input-hygiene');
const pager = require('./page-limit');
const PAGE = 500; /* CRM-261: a page of the list is 500 rows (the shared limitOf's default and its ceiling); crm.CAP is only how many parties the read holds in memory */

/** CRM-259: does a party match the words typed (name · nickname · party no · user id · phone · e-mail)? A phone typed with spaces or a plus finds the same number however it was spaced. The list's ?q and the quick add read this ONE rule. */
function matchesQuery(item, text, namesOnly) {
  const ql = String(text || '').trim().toLowerCase();
  if (!ql) return true;
  /* CON-165: a firm reading under a books grant searches NAMES and party numbers only: a search on phone or e-mail would let it read a number it is not shown, digit by digit, from which names match */
  if (namesOnly) return [item.display_name, item.nickname, item.legal_name, item.party_no].join(' ').toLowerCase().indexOf(ql) >= 0;
  if ([item.display_name, item.nickname, item.party_no, item.user_id, item.phone, item.email].join(' ').toLowerCase().indexOf(ql) >= 0) return true;
  const typed = ql.replace(/[^0-9]/g, '');
  if (typed.length < 7 || /[a-z@]/.test(ql)) return false;
  return String(item.phone || '').replace(/[^0-9]/g, '').indexOf(typed) >= 0;
}
/** the query a request is read by: all of it, or under a grant only q · page · limit (no view=leads, no with=consent) */
const askedOf = (req) => (req.acting_for_grant ? Object.fromEntries(view.QUERY_KEEP.filter((key) => req.query[key] !== undefined).map((key) => [key, req.query[key]])) : req.query);
/** the options of crm.list that come from the query: view · consent · page · q, and names_only under a grant (no search on phone or e-mail); the route itself says the page's limit (the register reads its cap there) */
function listOptions(req) {
  const asked = askedOf(req);
  return {
    view: asked.view === 'leads' ? 'leads' : null,
    consent: textOf(asked.with, { trim: false }).split(',').indexOf('consent') >= 0,
    page: pager.pageOf(asked.page),
    q: textOf(asked.q),
    names_only: !!req.acting_for_grant
  };
}
const cutList = (listed) => view.cutList(listed, view.readOnlyMay());
const cutRecord = (party, mergedFrom) => view.cutRecord(party, mergedFrom, view.readOnlyMay());
/** CON-165: the answer of a relationships list (the books screens' party pickers): the owner's own, or under a grant the cut rows (key = customers | suppliers) */
const relationsFor = (req, answer, key) => (req.acting_for_grant ? view.cutRelations(answer, key) : answer);
module.exports = { relationsFor, PAGE, matchesQuery, askedOf, listOptions, cutList, cutRecord };
