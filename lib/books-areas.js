'use strict';
/**
 * lib/books-areas.js — THE ONE CLASSIFICATION OF EVERY VERB ON THE /api/books MOUNT (W15-66): which area level a person needs, or the owner.
 * OWNS      DOORS (the money routes outside /api/books) · CARD_AREA (the Home cards that carry money) · CRM_MONEY_AREAS · ENFORCED_AREAS · CLASSES · TABLE (route + method → read | bankWrite | ownerOnly | gateDoor) · classOf(method, path) · unclassified(...routers) · stale(...routers) · needs(class).
 * CALLED BY middleware/books-area-gate.js (the router-level gate) · routes/books.js (bankWriter) · tests/l16-staff-areas.test.cjs (every route of routes/books.js AND routes/books-money.js is in the table, a planted route of each verb is not).
 * FLOW      a request's method + path (relative to the mount) → classOf → the class → the gate asks lib/areas.holds(identity, 'accounts', needs(class)) · a route in no row has NO class and is closed to everyone but the owner.
 * CARD      18-identity-sign-in-and-access/access-levels
 * ⭐ ALL VERBS, BOTH ROUTERS: routes/books.js and routes/books-money.js share the mount, so one table covers both; a new route of ANY method is born closed to staff until it has a row here.
 *    read       the books' figures and lists                      needs accounts: see
 *    bankWrite  POST /bank/marks · POST /bank/statements          needs accounts: work (the bank reconciliation, nothing else)
 *    gateDoor   a write that is an editor's everyday door and is not the bank (cheque step, party dispute, a compare snapshot, closing an overridden sale's open item)
 *               needs accounts: work AND the route's own gate (an editor's level)
 *    ownerOnly  never grantable: journal, reverse, write-off, opening, move-in, periods, year close, packs, recurring, fx, the ledger's switch and settings, AND PAYMENTS (Athi 15 Nov: payments stay the owner's)
 * ⚠️ The firm's grants (X-Books-For) do not come through this table: middleware/books-grant.js allow-lists those requests before the gate sees them (the gate passes a request that is acting for a grant).
 */
const READ = 'read';
const BANK = 'bankWrite';
const OWNER = 'ownerOnly';
const DOOR = 'gateDoor';
const CLASSES = Object.freeze([READ, BANK, OWNER, DOOR]);

/** 'METHOD /path' relative to /api/books → class; the path is the router's own (':x' is one segment) */
const TABLE = Object.freeze({
  /* the switch, the settings and the ledger's own upkeep: the owner's */
  'GET /status': OWNER,
  'POST /enable': OWNER,
  'POST /setting': OWNER,
  'POST /terms': OWNER,
  'POST /check': OWNER,
  'POST /outbox/retry': OWNER,
  'POST /accounts': OWNER,
  /* the books' figures */
  'GET /terms': READ,
  'GET /health': READ,
  'GET /accounts': READ,
  'GET /daybook': READ,
  'GET /ledger/:account': READ,
  'GET /party/:id/statement': READ,
  'GET /dues': READ,
  'GET /cashflow': READ,
  'GET /trial-balance': READ,
  'GET /pl': READ,
  'GET /bs': READ,
  'GET /cheques': READ,
  'GET /events': READ,
  'GET /todo': READ,
  'GET /returns': READ,
  'GET /fx-rates': READ,
  'GET /year/:fy/status': READ,
  'GET /periods': READ,
  'POST /preview': READ /* the server's own preview of a posting: stores nothing */,
  /* the bank: the reads ride with accounts, the three writes need `work` */
  'GET /bank/rail': READ,
  'GET /bank/log': READ,
  'POST /bank/marks': BANK,
  'POST /bank/statements': BANK,
  /* PAYMENTS: an explicit row for every verb, the owner's alone until Athi names who (the money door). The quote and the advice only read, so they follow the books' reads. */
  'POST /payments/preview': READ,
  'GET /payments/:id/advice': READ,
  'POST /payments': OWNER,
  'PATCH /payments/:id': OWNER,
  'POST /payments/:id/propose': OWNER,
  'POST /payments/:id/confirm': OWNER,
  /* an editor's everyday doors that are not the bank: work on accounts, and the route's own level gate */
  'POST /cheques/:id/status': DOOR,
  'POST /parties/:id/dispute': DOOR,
  'POST /money-check/resolve': DOOR /* routes/books-money.js */,
  'GET /compare': READ,
  'GET /compare/:id': READ,
  'GET /compare/:id/csv': READ,
  'POST /compare/preflight': DOOR,
  'POST /compare/snapshots': DOOR,
  /* the owner's alone: entries, reversals, write-offs, opening, move-in, periods, year close, packs, recurring, assets, fx */
  'POST /events': OWNER,
  'POST /entries': OWNER,
  'POST /entries/:id/reverse': OWNER,
  'POST /write-off': OWNER,
  'POST /opening': OWNER,
  'POST /move-in/preflight': OWNER,
  'POST /move-in/preview': OWNER,
  'POST /move-in/import': OWNER,
  'GET /move-in/imports': OWNER,
  'POST /periods/:fy/:p/:act': OWNER,
  'POST /year/:fy/close': OWNER,
  'GET /packs': OWNER,
  'POST /packs': OWNER,
  'GET /packs/:id': OWNER,
  'GET /packs/:id/file': OWNER,
  'POST /packs/:id/ack': OWNER,
  'GET /recurring': OWNER,
  'POST /recurring': OWNER,
  'PATCH /recurring/:id': OWNER,
  'DELETE /recurring/:id': OWNER,
  'POST /recurring/:id/post': OWNER,
  'POST /recurring/:id/skip': OWNER,
  'GET /assets': OWNER,
  'POST /assets': OWNER /* the period-end routes made by route(...) in routes/books.js: all owner, each with its own row */,
  'POST /assets/:id/dispose': OWNER,
  'POST /depreciation/run': OWNER,
  'POST /closing-stock': OWNER,
  'POST /gst/close': OWNER,
  'POST /gst/pay': OWNER,
  'POST /loans': OWNER,
  'POST /loans/:ref/emi': OWNER,
  'POST /accruals': OWNER,
  'POST /accruals/:ref/reverse': OWNER,
  'POST /contra': OWNER,
  'POST /fx-rates': OWNER,
  'POST /fx-rates/import': OWNER,
  'GET /fx-revalue': OWNER,
  'POST /fx-revalue': OWNER
});

/** each row as a request test: ':name' is any one segment, a trailing slash is the same route */
const ROWS = Object.keys(TABLE).map((key) => {
  const [method, pattern] = key.split(' ');
  return { key, method, pattern, test: new RegExp('^' + pattern.replace(/:[^/]+/g, '[^/]+') + '/?$') };
});

/** a HEAD is the GET it follows */
const verbOf = (method) => (String(method).toUpperCase() === 'HEAD' ? 'GET' : String(method).toUpperCase());

/** classOf(method, path) → 'read' | 'bankWrite' | 'ownerOnly' | 'gateDoor', or null when no row names the route (the gate closes it to everyone but the owner) */
function classOf(method, path) {
  const verb = verbOf(method);
  const row = ROWS.find((item) => item.method === verb && item.test.test(String(path)));
  return row ? TABLE[row.key] : null;
}

/** the area level a class needs: 'see' for a read, 'work' for the bank and the gate doors, null for the owner's alone (no level opens it) */
const needs = (doorClass) => (doorClass === READ ? 'see' : doorClass === BANK || doorClass === DOOR ? 'work' : null);

/** every 'METHOD /path' a router declares */
const routesOf = (router) => (router.stack || []).filter((layer) => layer.route).flatMap((layer) => Object.keys(layer.route.methods).filter((method) => layer.route.methods[method]).map((method) => method.toUpperCase() + ' ' + layer.route.path));

/** unclassified(...routers) → the routes of these routers in no table row, ALL VERBS (the planted-route test, and the guard: empty = every door is classified) */
const unclassified = (...routers) => routers.flatMap(routesOf).filter((route) => !(route in TABLE));

/** stale(...routers) → the table rows no router declares (a row left behind when a route is removed or renamed) */
const stale = (...routers) => {
  const declared = new Set(routers.flatMap(routesOf));
  return Object.keys(TABLE).filter((key) => !declared.has(key));
};

/**
 * THE OTHER DOORS (W15-66 slice 2): the money answers that live OUTSIDE /api/books, each in ONE area. 'METHOD /full/path' → area. Every one carries middleware/books-area-gate.areaDoor(area) after its own sign-in
 * (tests/l16-staff-areas2.test.cjs reads each route's stack and fails when a row has no gate, or a gate has no row). A route not named here is open to the signed-in, as it was.
 */
const DOORS = Object.freeze({
  'GET /api/till/invoice-lease/report': 'accounts',
  'GET /api/chits/rollup': 'reports',
  'GET /api/folders/groupsum': 'reports',
  'GET /api/folders/reconcile': 'reports',
  'GET /api/folders/mis': 'reports'
});
/** every Home card that carries money → its area (a card in no row is the person's own work and stays open); GET /api/facts/:card answers a closed one as a card with no lines (lib/home-facts) */
const CARD_AREA = Object.freeze({ accounts: 'accounts', compare: 'accounts', reports: 'reports', finance: 'finance' });
/** CRM money (party dues and the late-dues count, unbilled): one of these two opens it */
const CRM_MONEY_AREAS = Object.freeze(['accounts', 'finance']);
/** the areas something enforces: the union of the books' own, the other doors and the cards (lib/areas.GRANTABLE must equal it) */
const ENFORCED_AREAS = Object.freeze([...new Set(['accounts', ...Object.values(DOORS), ...Object.values(CARD_AREA)])]);

module.exports = { READ, BANK, OWNER, DOOR, CLASSES, TABLE, DOORS, CARD_AREA, CRM_MONEY_AREAS, ENFORCED_AREAS, classOf, needs, routesOf, unclassified, stale };
