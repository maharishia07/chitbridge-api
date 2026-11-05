/*
 * OWNS      the contract of routes/till.js (the counter's 41 routes): each route's OpenAPI operation (S9) and the one way its refusals and faults are worded (said, badRequest, notFound, relayed, failed, refusalOf).
 * CALLED BY routes/till.js (schemaValidate on each route, router.openapi, problem(req, res, { status, ...badRequest(...) })) → tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json · tests/api-problem-till.test.cjs.
 * FLOW      operation → schemaValidate(operation, schemaOptions) at the route → the register reads router.openapi → the contract cases run from the same schemas
 *           a refusal → problem(req, res, { status, ...said(code, error, message, extra) }) → the old { error, message, ... } beside the Problem fields
 *           a body a library made (a counter claim, the trend, a cost refusal) → relayed(body) keeps its code and words; a thrown error → failed(e, req) | refusalOf(e, req)
 * CARD      counter/till-routes
 * This file shapes NO answer: the snapshot, the bills, the rewards and every list are built in routes/till.js and the libraries it calls, as before.
 *
 * ⚠️ The till is OFFLINE-FIRST and its pages (tools/tally-connector/till.html, till.js and their vendored copies) read these answers: every key a refusal answered before is kept
 *    (docs/contracts/api-legacy.json, recorded from the code before the sweep) and the Problem fields ride beside them. A status never changes.
 * ⚠️ The input schemas say what the handlers ALREADY take: names, nothing required, nothing narrowed. A handler answers a missing or odd value in its own sentence (item_id required ...),
 *    and those sentences are frozen. The one thing a schema refuses is a body that is not an object or a query value given twice: answered 400 in the old { error: 'validation', message } shape.
 */
'use strict';
const { problem, internalSpec } = require('./problem');
const { SAFE_SENTENCE } = require('./respond');
const { schemaValidate } = require('../middleware/validate');
const { contractOf, object, array, text } = require('./contract-kit');

/** the old body of a refusal, as the spec parts problem() takes: { code, detail, legacy }. `message` is left out where the route never sent one; `extra` keys ride beside them. */
function said(code, error, message, extra) {
  const legacy = Object.assign({ error }, message === undefined ? {} : { message }, extra || {});
  return { code, detail: message === undefined ? error : message, legacy };
}
/** the counter's own 400: { error: 'validation', message } */
const badRequest = (message) => said('TILL_BAD_REQUEST', 'validation', message);
/** the bare 404 (or one with words) */
const notFound = (message) => said('NOT_FOUND', 'Not found', message);
/** a key that does not hold a counter is refused by the quick-keys routes in these words */
const noCounter = () => said('TILL_NO_COUNTER', 'Forbidden', 'This key is not holding a counter.');
/** the counter's own 400, answered: problem(req, res, { status: 400, ...badRequest(message) }) — the one shape 25 refusals of routes/till.js used to spell out */
const refuseBad = (req, res, message) => problem(req, res, { status: 400, ...badRequest(message) });
/** the quick-keys routes' 403 when the key holds no counter, answered */
const refuseNoCounter = (req, res) => problem(req, res, { status: 403, ...noCounter() });
/** a fault of ours: the screen's old words, nothing of the cause (the real error is logged with the request id) */
const failed = (e, req) => internalSpec(req, e, { error: 'Failed', message: SAFE_SENTENCE });
/**
 * relayed(body) — the spec of a refusal body a library made ({ error, code?, message? }): its own code (else TILL_REFUSED) and its own words, the whole body kept as it was.
 * Used for the counter claim (routes/counters.js claim), the trend (lib/till-summary trend) and the cost refusal (lib/cost writeRefusal).
 */
function relayed(body) {
  const given = body || {};
  return { code: given.code || 'TILL_REFUSED', detail: given.message || given.error || 'Refused.', legacy: given };
}
/** what a thrown error of the enrol route says: a library refusal of 400 keeps its own words, anything else is a 500 that says nothing of its cause */
function refusalOf(e, req) {
  if (e && e.status === 400) return { status: 400, code: 'TILL_BAD_REQUEST', detail: String(e.message), legacy: { error: 'Failed', message: String(e.message) } };
  return failed(e, req);
}
/** the sentence the catalogue start gives when the shop's categories could not be set up (the cause is logged, not sent) */
const CATEGORIES_WORDS = 'Your categories could not be set up, so nothing was added.';
const categoriesFailed = (e, req) => internalSpec(req, e, { error: 'Failed', message: CATEGORIES_WORDS }, 'CATEGORIES_NOT_SET_UP');

/** a body or a query value the schema refuses is answered 400 in the old validation shape, naming the first thing at fault */
const schemaOptions = { status: 400, code: 'TILL_BAD_REQUEST', legacy: (failures) => ({ error: 'validation', message: failures[0].detail }) };

/* ── the shapes ─────────────────────────────────────────────────────────────────────────────────────────── */
const OK = object(['ok']);
const SNAPSHOT = object([], {
  at: text, version: text, entity_id: text, more: { type: 'boolean' }, delta: { type: 'boolean' }, since: text, shop: object(), items: array(), removed: array(), offers: array(), slabs: array(),
  categories: array(), category_master: array(), face: object(), customers: array(), suppliers: array(), staff: array(), reward: {}, policy: object(), lot_fields: {}, till: object()
});
const SHOP_FIELDS = ['trade_name', 'legal_name', 'address', 'city', 'state', 'pincode', 'phone', 'email', 'gstin', 'currency', 'reg_type'];
/* F5 A1 · the rate door's 200, CLOSED (S34): a new route, so its answer lists every key and refuses any other; `rate` is null when the slab names none */
const RATE_SET = Object.assign(
  object(['ok', 'item_id', 'slab_id', 'rate', 'changed', 'words'], { ok: { type: 'boolean' }, item_id: text, slab_id: text, rate: { type: ['number', 'null'] }, changed: { type: 'boolean' }, words: text }),
  { additionalProperties: false }
);
/** the statuses a counter claim may relay (routes/counters.js claim): not literals in the handler, so declared here and checked by the test */
const CLAIM_REFUSALS = [
  { status: 404, code: 'NOT_FOUND', detail: 'there is no such counter in this shop' },
  { status: 409, code: 'COUNTER_HELD', detail: 'the counter is open on another PC (takeover asks first)' }
];

const ROUTES = {
  'GET /snapshot': { summary: "Everything a counter needs to bill offline, in one call (a shop screen is sent the allow-listed view)", keyed: true, query: ['since', 'till', 'issued', 'eng'], out: SNAPSHOT },
  'GET /bills': { summary: "This shop's earlier counter bills, newest first, with their lines (optionally one counter's or one person's)", keyed: true, query: ['days', 'limit', 'by', 'till'], out: object(['days', 'count', 'bills']) },
  'GET /catalogue/blueprints': { summary: 'The trades a counter may start a catalogue from, and what the axiom is', keyed: true, gates: ['scope'], out: object(['version', 'axiom', 'blueprints']) },
  'GET /counters': { summary: "The shop's other counters (id and name) and which one this key is", keyed: true, gates: ['scope'], out: object(['counters', 'me']) },
  'GET /engine/:name': { summary: 'One engine file the counter keeps a copy of (JavaScript, never cached)', keyed: true, media: 'application/javascript' },
  'GET /match': { summary: 'The three-way match: each purchase order beside what was received and what was invoiced', keyed: true, query: ['days', 'page', 'limit'], out: object(['days', 'count', 'orders']) },
  'GET /quick-keys/groups': { summary: "The quick-key groups a counter can choose from", keyed: true, gates: ['scope'], out: object(['groups']) },
  'GET /quick-keys/hidden': { summary: "The products this counter has marked sold out (none for a login that holds no counter)", keyed: true, gates: ['scope'], out: object(['hidden']) },
  'GET /quick-keys/screen-config': { summary: "This counter's quick-key screen style", keyed: true, gates: ['scope'] },
  'GET /quick-keys/state': { summary: "The quick-key groups this counter has active on one business day", keyed: true, gates: ['scope'], query: ['business_date'], inline: [400, 403] },
  'GET /reward': { summary: 'What one customer holds in points, and what it is worth (the holder is a phone number or an identity)', keyed: true, gates: ['scope'], query: ['scheme', 'value'], inline: [400], out: object(['ok', 'holder', 'points', 'entries']) },
  'GET /screens': { summary: 'The shop screens (TVs) this shop has paired, with when each last showed the sign', keyed: true, gates: ['scope'], out: object(['screens', 'count', 'limit', 'keys_used']) },
  'GET /stock': { summary: 'Quantity on hand and average cost per product (cost only for a login that may see costs; ?detail=1 adds names and batches)', keyed: true, gates: ['scope'], query: ['detail'], out: object(['balances']) },
  'GET /summary': { summary: "The shop's day, week or month rollup across every counter (?compare=1 gives the Reports trend instead)", keyed: true, query: ['compare', 'period', 'n', 'limit'], inline: [400, 422], out: object([], { period: text, rows: array(), counters: array() }) },
  'GET /tasks': { summary: 'What is still owed: orders to receive or to despatch, with what has already moved', keyed: true, query: ['kind', 'limit'], out: object(['kind', 'count', 'tasks']) },
  'GET /verify': { summary: 'A cheap second opinion on the counter\'s copy: how many sellable products, and a spread sample of real rows', keyed: true, gates: ['scope'], out: object(['total', 'at', 'shop', 'sample']) },
  'GET /worth-an-offer': { summary: 'Products worth an offer today: expiring soon or not moving, each with its reason', keyed: true, gates: ['scope'], query: ['days', 'quiet'], out: object(['ok', 'items', 'basis']) },
  'POST /alias': { summary: 'Remember what a supplier calls a product (and the pack conversion)', keyed: true, body: ['item_id', 'by', 'text', 'unit', 'factor'], inline: [400, 404], out: object(['ok', 'aliases']) },
  'POST /catalogue': { summary: "Start a shop's catalogue from a trade's starter list or from rows a person approved", keyed: true, gates: ['scope'], body: ['blueprint', 'products', 'replace'], inline: [400, 409, 422], out: object(['ok', 'added', 'refused', 'message']) },
  'POST /close': { summary: 'A counter finishes: its key is closed (never deleted) and a named counter is let go', keyed: true, gates: ['scope'], body: ['last_no', 'bills', 'next', 'period'], inline: [400, 404], out: object(['ok', 'closed_at']) },
  'POST /diagnostic': { summary: "A counter reports its own state (counts and reasons, never a customer's details)", keyed: true, gates: ['scope'], body: ['code', 'verdict', 'till_id', 'online', 'storage', 'queued', 'foreign', 'bills', 'last_why', 'waiting'], inline: [400, 404], out: object(['ok', 'code', 'at']) },
  'POST /enrol': { summary: 'Trade a signed-in owner session, once, for a counter key (claims the counter)', keyed: true, gates: ['owner'], body: ['name', 'counter', 'takeover'], inline: [400, 403], relayed: CLAIM_REFUSALS, out: object(['key', 'counter', 'took_over', 'shop']) },
  'POST /flags': { summary: 'Put a product on the shop screen, or take it in or out of one offer', keyed: true, gates: ['scope'], body: ['item_id', 'screen', 'offer_id', 'excluded'], inline: [400, 404], out: object(['ok', 'item_id']) },
  'POST /listen': { summary: 'Words from a short recording (audio is never stored); a failure is ok:false in words, never an error status', keyed: true, body: ['audio', 'mime', 'format', 'lang', 'hint'], out: object(['ok']) },
  'POST /offer-item': { summary: 'Move one product in or out of one live offer (appends an offer version)', keyed: true, gates: ['scope'], body: ['offer_id', 'item_id', 'on', 'by'], inline: [400, 404], out: object(['ok', 'offer_id', 'item_id', 'on']) },
  'POST /pair': { summary: 'The shop (or a counter) asks for a six-character code to pair one screen', keyed: true, body: [], inline: [403], out: object(['code', 'expires_at', 'minutes']) },
  'POST /pair/claim': { summary: 'A screen swaps its code, once, for a screen key (no sign-in: the screen has none yet)', public: true, body: ['code'], inline: [404, 429], out: object(['key', 'shop']) },
  'POST /price': { summary: 'Change one product\'s price from the counter (the old price is kept)', keyed: true, gates: ['scope'], body: ['item_id', 'price', 'by'], inline: [400, 403, 404, 422], out: object(['ok', 'item_id', 'now', 'currency']) },
  'POST /quick-keys/hide': { summary: 'Mark a product sold out on this counter (and on others when asked); saying it twice is no change', keyed: true, gates: ['scope'], body: ['product_id', 'shift_id', 'by', 'also_counters'], inline: [400, 403], out: object(['hidden']) },
  /* F5 A1 — a NEW door, so its body is STRICT (S33): both ids required, nothing else accepted; no old caller to keep */
  'POST /rate': { summary: "Set one product's tax rate from the counter, once: an owner or manager picks one of the shop's slabs (a till key or a cashier is told to ask the owner); saying it twice changes nothing", body: ['item_id', 'slab_id'], required: ['item_id', 'slab_id'], rules: { additionalProperties: false }, inline: [400, 403, 404, 409], out: RATE_SET },
  'POST /quick-keys/screen-config': { summary: "Set this counter's quick-key screen style", keyed: true, gates: ['scope'], body: ['config'], inline: [403] },
  'POST /quick-keys/state': { summary: 'Set the quick-key groups this counter has active on one business day', keyed: true, gates: ['scope'], body: ['business_date', 'shift_id', 'active_group_ids'], inline: [400, 403] },
  'POST /quick-keys/unhide': { summary: 'Put a sold-out product back on this counter (and on others when asked)', keyed: true, gates: ['scope'], body: ['product_id', 'also_counters'], inline: [400, 403] },
  'POST /reconcile': { summary: 'Did the chit the counter was given record its bill? (read-only: ok, absorbed, missing or unknown for each)', keyed: true, gates: ['scope'], body: ['bills'], out: object(['checked', 'bills']) },
  'POST /reward': { summary: 'Award and encash points on one bill (the server reads its own copy of the bill; a replay writes nothing)', keyed: true, gates: ['scope'], body: ['ref', 'holder', 'customer', 'spend', 'at'], inline: [400, 409], out: object(['ok']) },
  'POST /reward/claim': { summary: 'Move a walk-in\'s phone-held points onto an account (all or nothing)', keyed: true, gates: ['scope'], body: ['from', 'to', 'ref'], inline: [400, 409], out: object(['ok', 'moved', 'from', 'to']) },
  'POST /screens/rename': { summary: 'Give a paired shop screen its own name (screen keys only)', keyed: true, gates: ['scope'], body: ['jti', 'name'], inline: [400, 403, 404], out: object(['ok', 'jti', 'name']) },
  'POST /screens/revoke': { summary: 'Switch off a paired shop screen (screen keys only)', keyed: true, gates: ['scope'], body: ['jti'], inline: [400, 403, 404], out: object(['ok', 'jti', 'message']) },
  'POST /shop': { summary: "The counter fills in the shop's header and tax number (never its currency or registration type)", keyed: true, gates: ['scope'], body: SHOP_FIELDS, inline: [400], out: object(['ok', 'changed', 'refused', 'shop']) },
  'POST /state': { summary: 'The counter says it is on a break or billing (best effort)', keyed: true, gates: ['scope'], body: ['state', 'since', 'by'], out: object(['ok', 'recorded']) },
  'POST /stock': { summary: 'Mark one product available or unavailable from the counter', keyed: true, gates: ['scope'], body: ['item_id', 'status', 'until', 'note', 'by'], inline: [400, 404], out: object(['ok', 'item_id', 'status']) },
  'POST /stock/bulk': { summary: 'Mark up to 500 products available or unavailable in one change (says how many actually moved)', keyed: true, gates: ['scope'], body: ['item_ids', 'status', 'note', 'by'], inline: [400], out: object(['ok', 'moved', 'asked', 'status', 'message']) }
};
/** every row that takes input is refused at 400 by its schema (the old status), not the standard 422 */
Object.keys(ROUTES).forEach((route) => {
  ROUTES[route].invalid = 400;
});

const GATE_STATUS = { scope: 403, owner: 403 };
const contract = contractOf({ mount: '/api/till', routes: ROUTES, gateStatus: GATE_STATUS });
/** the schema check of one route (its own operation above), as a list to spread after the gates: a route that takes no input has none */
function checked(route) {
  const operation = contract.operationFor(route);
  return operation.parameters || operation.requestBody ? [schemaValidate(operation, schemaOptions)] : [];
}
/* the refusals a library relays (not a status literal of the handler): declared as an extension of the operation, and allowed to the test */
Object.keys(ROUTES).forEach((route) => {
  if (ROUTES[route].relayed) contract.OPERATIONS['POST /api/till' + route.split(' ')[1]]['x-relayed-refusals'] = ROUTES[route].relayed;
});
const allowedStatuses = () => (key) => contract.allowedStatuses()(key).concat(((contract.OPERATIONS[key] || {})['x-relayed-refusals'] || []).map((item) => item.status));

module.exports = { said, badRequest, notFound, noCounter, refuseBad, refuseNoCounter, failed, relayed, refusalOf, categoriesFailed, schemaOptions, checked, ROUTES, contract: Object.assign({}, contract, { allowedStatuses }), operationFor: contract.operationFor, pathsOf: contract.pathsOf };
