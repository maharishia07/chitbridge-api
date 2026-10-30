/*
 * OWNS      the contract of routes/tax.js and routes/invoice.js: each route's OpenAPI operation (S9) and the one way their refusals and faults are worded (taxSaid, faultOf).
 * CALLED BY routes/tax.js · routes/invoice.js (schemaValidate on each route, router.openapi) → tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json · tests/api-problem-books.test.cjs.
 * FLOW      operation → schemaValidate(operation) at the route → the register reads router.openapi → the contract cases run from the same schemas
 *           a refusal → problem(req, res, taxSaid(status, code, words)) → the old { error, code, message } beside the Problem fields
 * CARD      15-tax-and-country-packs/tax-compute-rate-invoice-tax
 * This file shapes NO answer and works out no tax: the figures are lib/tax-lines, lib/tax and the engines'.
 *
 * ⚠️ The input schemas say what the handlers ALREADY take: names, nothing required, nothing narrowed. Every handler answers a missing or odd value in its own coded sentence
 *    (NO_LINES, BAD_QTY, BAD_FLAG ...), and those are frozen (docs/contracts/api-legacy.json). Required fields and unknown-key refusal are API-3 (strict_input) with the owner's say.
 */
'use strict';
const { internalSpec } = require('./problem');
const { SAFE_SENTENCE } = require('./respond');
const { known } = require('./knownerr');
const { contractOf, object } = require('./contract-kit');

const FAILED = 'Failed';
/** a refusal in the tax service's words: 400 = the request is malformed, 422 = well-formed but the shop's facts cannot answer it. The body keeps the keys it always had. */
function taxSaid(status, code, message, extra) {
  const error = status === 400 ? 'Bad request' : 'Cannot compute';
  return { status, code, detail: message, legacy: Object.assign({ error, code, message }, extra || {}) };
}
/** a refusal the database makes on purpose keeps its status, code and words; anything else is a 500 TAX_FAILED that says nothing of its cause */
function faultOf(e, req) {
  const refusal = known(e);
  if (refusal) return { status: refusal.status, code: refusal.body.code || 'INTERNAL', detail: refusal.body.message, hint: refusal.body.hint, legacy: refusal.body };
  return internalSpec(req, e, { error: FAILED, code: 'TAX_FAILED', message: SAFE_SENTENCE }, 'TAX_FAILED');
}
/** a read that always answered 500 { error, message } when it failed (no known() mapping, no code) */
const readFault = (e, req) => internalSpec(req, e, { error: FAILED, message: SAFE_SENTENCE });

const INVOICE_BLOCK = ['chit_id', 'direction', 'status', 'provisional', 'frozen', 'rated', 'unrated', 'seller', 'buyer', 'invoice', 'heads', 'sells'];
const LINES_BODY = ['lines'];
const COMPUTE_BODY = ['seller', 'buyer', 'lines', 'scheme', 'priceIncludesTax', 'reverseCharge'];
const ROUTES = {
  'GET /api/tax/invoice/:chit_id': { summary: 'The tax invoice block of MY copy of one chit (frozen, or live and provisional)', inline: [404], out: object(INVOICE_BLOCK) },
  'GET /api/tax/ledger': { summary: 'Output tax, input credit and net for my GSTIN in one month, with the rows behind them', query: ['month'], out: object(['month', 'period', 'gstin', 'registration', 'output', 'itc', 'net', 'count', 'provisional']) },
  'GET /api/tax/gstr': { summary: 'The GSTR-1 or GSTR-3B JSON for the offline filing tool, as a download', query: ['month', 'form'] },
  'POST /api/tax/rate': { summary: 'The tax slab each line resolves to on this shop (key scope: tax)', gates: ['scope'], keyed: true, inline: [400], body: LINES_BODY, out: object(['engine', 'version', 'lines']) },
  'POST /api/tax/compute': { summary: 'The same tax answer the counter prints for the same bill (key scope: tax)', gates: ['scope'], keyed: true, inline: [400], body: COMPUTE_BODY, out: object(['engine', 'version', 'seller', 'buyer', 'price_includes_tax', 'priced', 'currency', 'pack', 'money', 'invoice', 'heads']) },
  'POST /api/invoice/build': { summary: 'The whole invoice pipeline in one call: pricing, offers, tax, the INV-01 block. Built, not issued (key scope: invoice)', gates: ['scope'], keyed: true, inline: [400], body: COMPUTE_BODY.concat(['offers', 'currency']), out: object(['invoice', 'heads']) },
  'GET /api/invoice/:chit_id': { summary: 'The tax invoice of a chit this shop holds (key scope: invoice or connector)', gates: ['scope'], keyed: true, inline: [404], out: object(INVOICE_BLOCK) }
};
/** the rows of one router (tax or invoice), keyed the way that router names its own paths */
const byMount = (mount) => Object.fromEntries(Object.keys(ROUTES).filter((route) => route.includes(' /api/' + mount + '/')).map((route) => [route.replace(' /api/' + mount, ' '), ROUTES[route]]));
const GATE_STATUS = { scope: 403 };
const taxContract = contractOf({ mount: '/api/tax', routes: byMount('tax'), gateStatus: GATE_STATUS });
const invoiceContract = contractOf({ mount: '/api/invoice', routes: byMount('invoice'), gateStatus: GATE_STATUS });

module.exports = {
  taxSaid,
  faultOf,
  readFault,
  taxContract,
  invoiceContract,
  OPERATIONS: Object.assign({}, taxContract.OPERATIONS, invoiceContract.OPERATIONS),
  allowedStatuses: () => (key) => (taxContract.OPERATIONS[key] ? taxContract : invoiceContract).allowedStatuses()(key)
};
