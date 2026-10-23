/**
 * products-chains.cjs — the express-validator chains routes/products.js used before its schemas, run beside those schemas on a table of bodies.
 *
 * OWNS      the old chains (copied here as the record of what the schemas replaced, never read by the route), the table of values they are tried with, and the comparison: the same
 *           verdict, and when both refuse, the same old body ({ error: "Validation failed", details: [{ field, message }] }).
 * CALLED BY tests/api-problem-products.test.cjs. Not a test itself.
 * FLOW      compare(route, operation, schemaCheck) → for each body of the table: the chain through middleware/validate's validate() · the schema through schemaValidate → equal or listed
 * CARD      qa/offline-guards
 */
'use strict';
const path = require('path');
const { body } = require('express-validator');
const { validate } = require(path.join(__dirname, '..', '..', 'middleware', 'validate'));

const ABSENT = Symbol('absent');
const CHAINS = {
  'POST /': [body('item_data').isObject()],
  'POST /bulk': [body('items').isArray({ min: 1 })],
  'POST /status/bulk': [body('ids').isArray({ min: 1 }), body('status').isString()],
  'POST /bulk-update': [body('items').isArray({ min: 1 })],
  'POST /import/preflight': [body('csv').optional().isString(), body('xlsx').optional().isString(), body('header_row').optional().isInt({ min: 1, max: 1000 })],
  'POST /import': [body('csv').optional().isString(), body('xlsx').optional().isString(), body('header_row').optional().isInt({ min: 1, max: 1000 }), body('decisions').isArray()],
  'POST /starter-columns': [body('vertical').isString()],
  'PATCH /:id': [body('item_data').isObject()],
  'POST /:id/schedule': [body('effective_at').isString(), body('item_data').isObject()],
  'POST /availability/bulk': [body('items').isArray({ min: 1, max: 2000 })],
  'PUT /:id/availability': [body('qty').exists(), body('source').optional().isString(), body('as_of').optional().isString()],
  'PUT /:id/status': [body('status').isString()],
  'POST /lists/adopt': [body('list').isString()]
};
/** a body that satisfies the chain: the single-field cases change one field of it */
const VALID = {
  'POST /': { item_data: {} },
  'POST /bulk': { items: [{}] },
  'POST /status/bulk': { ids: ['x'], status: 'available' },
  'POST /bulk-update': { items: [{}] },
  'POST /import/preflight': {},
  'POST /import': { decisions: [] },
  'POST /starter-columns': { vertical: 'gold' },
  'PATCH /:id': { item_data: {} },
  'POST /:id/schedule': { effective_at: 'x', item_data: {} },
  'POST /availability/bulk': { items: [{}] },
  'PUT /:id/availability': { qty: 1 },
  'PUT /:id/status': { status: 'available' },
  'POST /lists/adopt': { list: 'veg' }
};
const BIG = (count) => Array.from({ length: count }, () => ({}));
const VALUES = [ABSENT, null, '', ' ', 'x', 'abc', '0', '1', '5', '+5', '0005', '1000', '1001', '-1', '5.5', 0, 1, 5, 1000, 1001, -1, 5.5, true, false, [], ['x'], [5], [{}], [[]], {}, { a: 1 }, BIG(2000), BIG(2001)];
const WHOLE_BODIES = [undefined, [], [1], 'text', 5, null];

/** the differences between a chain and its schema that were looked at and kept, each with what it is (a body no screen sends) */
const KNOWN_DIFFERENCES = [
  { route: 'POST /import/preflight', what: 'a body that is not an object is refused by the schema (400) where the handler refused it in its own words (400)' },
  { route: 'POST /import/preflight', what: 'header_row sent as a list is refused: the chain checked each entry of it (an empty list or a list of one whole number passed), the schema asks for one number' },
  { route: 'POST /import', what: 'header_row sent as a list is refused: the chain checked each entry of it (an empty list or a list of one whole number passed), the schema asks for one number' }
];

const labelOf = (value) => (value === ABSENT ? '(absent)' : JSON.stringify(value, (key, item) => (Array.isArray(item) && item.length > 20 ? 'array of ' + item.length : item)));
const withField = (base, field, value) => {
  const made = Object.assign({}, base);
  if (value === ABSENT) delete made[field];
  else made[field] = value;
  return made;
};

/** a response that keeps its status and body: what a middleware answered */
function recorder() {
  const seen = { status: null, body: null };
  const res = { locals: {}, status: (code) => ((seen.status = code), res), set: () => res, json: (given) => ((seen.body = given), res) };
  return { res, seen };
}

/** the old verdict: the chains run on the body, then validate() — [refused?, status, body] */
async function oldAnswer(route, request) {
  for (const chain of CHAINS[route]) await chain.run(request);
  const { res, seen } = recorder();
  let passed = false;
  validate(request, res, () => (passed = true));
  return { refused: !passed, status: seen.status, body: seen.body };
}

const PROBLEM_KEYS = ['type', 'title', 'status', 'code', 'detail', 'hint', 'request_id', 'field', 'params', 'errors'];
/** the new verdict: schemaValidate on the same request; the old keys of its refusal are the keys that are not the Problem's */
function newAnswer(schemaCheck, request) {
  const { res, seen } = recorder();
  let passed = false;
  schemaCheck(request, res, () => (passed = true));
  const legacy = seen.body ? Object.fromEntries(Object.entries(seen.body).filter(([key]) => !PROBLEM_KEYS.includes(key))) : null;
  return { refused: !passed, status: seen.status, body: legacy };
}

/** every case of a route: [description, body] */
function casesOf(route) {
  const fields = CHAINS[route].map((chain) => chain.builder.build().fields[0]);
  const base = VALID[route];
  const single = fields.flatMap((field) => VALUES.map((value) => [field + ' = ' + labelOf(value), withField(base, field, value)]));
  const together = [['every field absent', {}], ['every field null', Object.fromEntries(fields.map((field) => [field, null]))], ['every field a number', Object.fromEntries(fields.map((field) => [field, 7]))]];
  return single.concat(together, WHOLE_BODIES.map((whole) => ['the whole body is ' + labelOf(whole), whole]));
}

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const HEADER_ROW_LIST = 'header_row sent as a list is refused: the chain checked each entry of it (an empty list or a list of one whole number passed), the schema asks for one number';
const WHOLE_BODY_WORDS = 'a body that is not an object is refused by the schema (400) where the handler refused it in its own words (400)';

/** one case judged: a verdict that differs, a refusal body that differs, or (for a whole body that is not an object) the one difference that is kept */
function judge(description, before, after, given) {
  if (given && Array.isArray(given.header_row) && (before.refused !== after.refused || !same(before.body, after.body))) return { known: HEADER_ROW_LIST };
  const wholeBody = !given || typeof given !== 'object' || Array.isArray(given);
  if (before.refused !== after.refused) {
    if (wholeBody && !before.refused && after.refused && after.status === 400) return { known: WHOLE_BODY_WORDS };
    return { fault: description + ': chain ' + (before.refused ? 'refused' : 'passed') + ', schema ' + (after.refused ? 'refused' : 'passed') };
  }
  if (!before.refused || wholeBody) return {};
  if (before.status !== after.status) return { fault: description + ': status ' + before.status + ' vs ' + after.status };
  if (!same(before.body, after.body)) return { fault: description + ': refusal bodies differ ' + JSON.stringify(before.body).slice(0, 120) + ' vs ' + JSON.stringify(after.body).slice(0, 120) };
  return {};
}

/** compare(route, operation, schemaCheck) → { cases, disagree: [description], known: [what] } */
async function compare(route, operation, schemaCheck) {
  const disagree = [];
  const known = new Set();
  const cases = casesOf(route);
  for (const [description, given] of cases) {
    const before = await oldAnswer(route, { body: given === undefined ? {} : given, params: {}, query: {} });
    const after = newAnswer(schemaCheck, { body: given, params: { id: 'x' }, query: {}, id: 'r1' });
    const verdict = judge(description, before, after, given);
    if (verdict.fault) disagree.push(verdict.fault);
    if (verdict.known) known.add(verdict.known);
  }
  void operation;
  return { cases: cases.length, disagree, known: [...known] };
}

module.exports = { compare, KNOWN_DIFFERENCES, CHAINS };
