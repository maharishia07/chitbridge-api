/**
 * chain-compare.cjs — an old express-validator chain and the schema that replaced it, run on the same table of bodies.
 *
 * OWNS      the comparison: the same verdict, and when both refuse, the same old body ({ error: "Validation failed", details: [{ field, message }] }) and status;
 *           the table of values a field is tried with; the differences that were looked at and kept (a config's `known` judge names them).
 * CALLED BY tests/lib/products-chains.cjs · tests/lib/catalogue-chains.cjs (each holds its own chains). Not a test itself.
 * FLOW      createComparer({ chains, valid, known }) → compare(route, schemaCheck) → for each body: the chain through middleware/validate's validate() · the schema → equal, a fault, or a known difference
 * CARD      qa/offline-guards
 */
'use strict';
const path = require('path');
const { validate } = require(path.join(__dirname, '..', '..', 'middleware', 'validate'));

const ABSENT = Symbol('absent');
const BIG = (count) => Array.from({ length: count }, () => ({}));
const VALUES = [ABSENT, null, '', ' ', 'x', 'abc', '0', '1', '5', '+5', '0005', '1000', '1001', '-1', '5.5', 0, 1, 5, 1000, 1001, -1, 5.5, true, false, [], ['x'], [5], [{}], [[]], {}, { a: 1 }, BIG(2000), BIG(2001), 'external', 'internal', ' hi ', ['external']];
const WHOLE_BODIES = [undefined, [], [1], 'text', 5, null];
const PROBLEM_KEYS = ['type', 'title', 'status', 'code', 'detail', 'hint', 'request_id', 'field', 'params', 'errors'];

const labelOf = (value) => (value === ABSENT ? '(absent)' : JSON.stringify(value, (key, item) => (Array.isArray(item) && item.length > 20 ? 'array of ' + item.length : item)));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
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

/** the new verdict: schemaValidate on the request; the old keys of its refusal are the keys that are not the Problem's */
function newAnswer(schemaCheck, request) {
  const { res, seen } = recorder();
  let passed = false;
  schemaCheck(request, res, () => (passed = true));
  const legacy = seen.body ? Object.fromEntries(Object.entries(seen.body).filter(([key]) => !PROBLEM_KEYS.includes(key))) : null;
  return { refused: !passed, status: seen.status, body: legacy };
}

/** createComparer({ chains, valid, known, values? }) — chains: { route: [chain] }, valid: { route: a body that passes }, known(description, before, after, given) → the kept difference's words, or null; values = more values every field is tried with (beside the shared table) */
function createComparer({ chains, valid, known, values }) {
  async function oldAnswer(route, request) {
    for (const chain of chains[route]) await chain.run(request);
    const { res, seen } = recorder();
    let passed = false;
    validate(request, res, () => (passed = true));
    return { refused: !passed, status: seen.status, body: seen.body, request };
  }
  /** every case of a route: [description, body] */
  function casesOf(route) {
    const fields = chains[route].map((chain) => chain.builder.build().fields[0]);
    const single = fields.flatMap((field) => VALUES.concat(values || []).map((value) => [field + ' = ' + labelOf(value), withField(valid[route], field, value)]));
    const together = [['every field absent', {}], ['every field null', Object.fromEntries(fields.map((field) => [field, null]))], ['every field a number', Object.fromEntries(fields.map((field) => [field, 7]))]];
    return single.concat(together, WHOLE_BODIES.map((whole) => ['the whole body is ' + labelOf(whole), whole]));
  }
  /** one case judged → { fault } | { known } | {} */
  function judge(description, before, after, given) {
    const kept = known(description, before, after, given);
    if (kept) return { known: kept };
    if (before.refused !== after.refused) return { fault: description + ': chain ' + (before.refused ? 'refused' : 'passed') + ', schema ' + (after.refused ? 'refused' : 'passed') };
    const wholeBody = !given || typeof given !== 'object' || Array.isArray(given);
    if (!before.refused || wholeBody) return {};
    if (before.status !== after.status) return { fault: description + ': status ' + before.status + ' vs ' + after.status };
    if (!same(before.body, after.body)) return { fault: description + ': refusal bodies differ ' + JSON.stringify(before.body).slice(0, 120) + ' vs ' + JSON.stringify(after.body).slice(0, 120) };
    return {};
  }
  /** compare(route, schemaCheck) → { cases, disagree: [description], known: [what] } */
  async function compare(route, schemaCheck) {
    const disagree = [];
    const kept = new Set();
    const cases = casesOf(route);
    for (const [description, given] of cases) {
      /* the chain's sanitizers (trim) write into the body they are given: the chain gets its own copy, so the schema is asked about the body that was SENT */
      const before = await oldAnswer(route, { body: given === undefined ? {} : structuredClone(given), params: {}, query: {} });
      const after = newAnswer(schemaCheck, { body: given, params: { id: 'x', item_id: 'x' }, query: {}, id: 'r1' });
      const verdict = judge(description, before, after, given);
      if (verdict.fault) disagree.push(verdict.fault);
      if (verdict.known) kept.add(verdict.known);
    }
    return { cases: cases.length, disagree, known: [...kept] };
  }
  return { compare, casesOf };
}

module.exports = { createComparer, ABSENT };
