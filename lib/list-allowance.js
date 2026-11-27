'use strict';
// @stage tested
/**
 * lib/list-allowance.js — the GET list-shaped routes that are NOT a growing list (one record, a summary, a fixed vocabulary), each with its reason.
 * OWNS      ALLOWED: 'routes-file.js /path-in-router' -> why it is not a growing list (moved out of tests/list-paging-guard.test.cjs, 26 Nov 2026, so the API register's
 *           paged_read column (lib/paged-read.js) and the guard read ONE list and never two)
 * CALLED BY tests/list-paging-guard.test.cjs · lib/paged-read.js
 * OWNER     cb-speed
 * RISK      plain
 * CARD      28-platform-and-operations/api-standard
 * FLOW      a route's file + path -> reasonFor() -> ALLOWED[key] -> the reason, or undefined (then a list read must page)
 */
const ALLOWED = {
  'work.js /list': 'paged inside lib/work-rows (page and limit, clamped to PAGE_MAX, with a total); the route only names the output keys (API-8 #522)',
  'adopt.js /:chit_id': 'one chit',
  'chits.js /:chit_id': 'one chit and its lines',
  'chits.js /:chit_id/diagnosis': 'one chit\'s diagnosis',
  'service.js /:chit_id': 'one service chit',
  'crm.js /parties/:id': 'one party',
  'definitions.js /:id': 'one definition and its versions',
  'entities.js /usage': 'one entity\'s usage summary',
  'entities.js /constitutions': 'the fixed constitution vocabulary of the installation',
  'assist.js /regions': 'the fixed region vocabulary (region_layer)',
  'schemas.js /fields': 'the shop\'s field dictionary — bounded by its schema',
  'connectors.js /:actorId/provisioning': 'one connector\'s provisioning',
  'till.js /snapshot': 'one counter\'s snapshot (its own round-trip budget, round-trips-till)',
  'till.js /summary': 'one day\'s summary',
  'till.js /verify': 'the counter\'s sign-in check',
  'folders.js /:id/metrics': 'one folder\'s metrics',
  'testing.js /report': 'one report document over the whole board',
  /* W1-PLAT (LIM2): not growing lists — a summary, a graph, one record's rows, a fixed vocabulary */
  'assist.js /penetration': 'a summary by locality (orders per locality), not a list',
  'books.js /party/:id/statement': 'one party\'s statement over a date range — its lines carry a running balance a page would break (keyset later, as /ledger)',
  'books.js /trial-balance': 'one row per account — bounded by the chart',
  'books.js /bank/rail': 'one range\'s bank-vs-rail reconciliation summary',
  'books.js /year/:fy/status': 'one year\x27s status — the year\x27s twelve month rows are read for closed_with, the answer is one object',
  'books.js /periods': 'the year\'s periods — twelve rows',
  'books.js /fx-revalue': 'one revaluation proposal',
  'chits.js /rollup': 'grouped sums over my chits — one row per group',
  'chits.js /unread': 'the unread ids for the badge — ids only',
  'chits.js /:chit_id/disputes': 'one chit\'s disputes',
  'chits-trace.js /:id/children': 'one chit\'s children',
  'chits-trace.js /:id/trace': 'one chit\'s trace graph',
  'chits-trace.js /trace/by-batch': 'one batch\'s reconstructed graph',
  'chits-trace.js /trace/networks': 'the networks I trace in — a small vocabulary',
  'entities.js /routing': 'one entity\'s routing summary',
  'entities.js /populations': 'the fixed population vocabulary',
  'entities.js /mis': 'one entity\'s MIS summary',
  'folders-totals.js /reconcile': 'one reconciliation summary',
  'folders-totals.js /mis': 'the folders\' MIS summary',
  'integrations.js /reconcile': 'one range\'s books-vs-connector reconciliation summary',
  'network-design.js /availability': 'one availability question across the network\'s members',
  'products.js /:id/versions': 'one product\'s versions',
  'products.js /lists': 'the Product Lab\'s tick-and-grey: what the shop sells beside the blueprint lists (a vocabulary)',
  'relationships.js /scorecard/:entity_id': 'one counterparty\'s scorecard',
  'simulator.js /content': 'the simulator\'s fixed content tables',
  'tax.js /ledger': 'one month\'s tax ledger',
  'testing.js /stale': 'a summary of stale items',
  'testing.js /coverage': 'the coverage summary',
  'testing.js /reliability': 'the reliability summary',
  'till.js /worth-an-offer': 'a computed shortlist (sixty at most)',
  'till.js /stock': 'the counter\'s stock balances — one object keyed by item',
};

/** the key a route is allowed under: its routes file's name and its path inside that router (the register's full path ends with it) */
const reasonFor = (file, fullPath) => {
  const base = String(file).replace(/^.*[\/]/, '');
  const hit = Object.keys(ALLOWED).find((key) => key.startsWith(base + ' ') && String(fullPath).endsWith(key.slice(base.length + 1)));
  return hit ? ALLOWED[hit] : null;
};
module.exports = { ALLOWED, reasonFor };
