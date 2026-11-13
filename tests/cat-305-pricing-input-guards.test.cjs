#!/usr/bin/env node
// @type: contract
/**
 * cat-305-pricing-input-guards.test.cjs — CAT-305 / CAT-306 / CAT-312: the money input of POST /api/pricing/price and POST /api/offers/evaluate|explain is refused, not priced.
 *
 * OWNS      (1) a quantity of 0, below 0, blank, null-as-text or not a number → 400 BAD_QTY on both services (it used to price at 1 or at a negative total);
 *           (2) a list/unit price below 0, blank or not a number → 400 BAD_PRICE; on offers a line with NO price is refused too (it was a free line);
 *           (3) a pricing structure: unknown kind → 400 PRICING_KIND_UNKNOWN; a negative or blank amount, min, max or tier price → 400 BAD_PRICE; an ABSENT amount still means the list price;
 *           (4) a good line is still priced (a string "8" tier price, qty 1) and a refusal names the line; (5) the BREAK: the guard is the helper in lib/services — with it removed the same bodies answer 200.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route files over the stand-in sign-in (tests/lib/problem-world.cjs); the shelf read is stood in at lib/services.
 * FLOW      a bad body → real route → status + code + sentence (RFC 9457 problem details, the old { error, message } beside it)
 * CARD      28-platform-and-operations/pricing-service
 * CARD  07-offers-pricing-and-combos/offers-engine-as-service
 * Run: node tests/cat-305-pricing-input-guards.test.cjs
 */
'use strict';
const path = require('path');
const express = require('express');
const { harness } = require('./lib/problem-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const routeFiles = { '/api/pricing': 'routes/pricing.js', '/api/offers': 'routes/offers.js' };
const lab = harness({ here: HERE, mounts: Object.keys(routeFiles), routeFiles, legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json') });
const { world, check } = lab;
const SERVICES = require(path.join(HERE, 'lib', 'services'));
let port = 0;

async function post(url, lines) {
  Object.assign(world, { realAuth: false, who: lab.world.who, asKey: false, db: 'ok', sqlRows: () => ({ rows: [], rowCount: 0 }), keyScopes: null });
  SERVICES.shelfOf = async () => ({ productOf: () => null });
  return lab.send(port, 'POST', url, { lines, offers: [], ctx: { currency: 'AUD' } });
}
const priceOf = (lines) => post('/api/pricing/price', lines);
const offerOf = (lines) => post('/api/offers/evaluate', lines);
const refused = (answer, code) => answer.status === 400 && answer.json.code === code && /Line/.test(answer.json.detail || answer.json.message || '');

async function quantity() {
  console.log('\n── a quantity that is not above 0 or not a number (CAT-305, CAT-312) ──\n');
  for (const [label, qty] of [['0', 0], ['-3', -3], ['blank ""', ''], ['"abc"', 'abc'], ['"1e400"', '1e400'], ['[1]', [1]], ['null', null], ['true', true]]) {
    const body = [{ key: 'a', name: 'Tea', qty, listPrice: 10, unitPrice: 10 }];
    check('pricing: qty ' + label + ' → 400 BAD_QTY, naming the line', refused(await priceOf(body), 'BAD_QTY'), (await priceOf(body)).json);
    check('offers: qty ' + label + ' → 400 BAD_QTY, naming the line', refused(await offerOf(body), 'BAD_QTY'), (await offerOf(body)).json);
  }
  check('pricing: a line with NO qty key is refused, not priced as 1', refused(await priceOf([{ key: 'a', listPrice: 10 }]), 'BAD_QTY'));
  const good = await priceOf([{ qty: 1, listPrice: 10 }]);
  check('a good line (qty 1 × 10) is still priced: 200 total 10', good.status === 200 && good.json.total === 10, good.json);
}

async function price() {
  console.log('\n── a price below 0 or not a number (CAT-306, CAT-312) ──\n');
  for (const [label, value] of [['-5', -5], ['blank ""', ''], ['"abc"', 'abc']]) {
    check('pricing: listPrice ' + label + ' → 400 BAD_PRICE', refused(await priceOf([{ qty: 2, listPrice: value }]), 'BAD_PRICE'), (await priceOf([{ qty: 2, listPrice: value }])).json);
    check('offers: unitPrice ' + label + ' → 400 BAD_PRICE', refused(await offerOf([{ qty: 2, unitPrice: value }]), 'BAD_PRICE'), (await offerOf([{ qty: 2, unitPrice: value }])).json);
  }
  const free = await priceOf([{ qty: 2, listPrice: 0 }]);
  check('pricing: a deliberate price of 0 is a free line, answered 200 total 0', free.status === 200 && free.json.total === 0, free.json);
  check('offers: a line with NO price is refused (it was read as a free line)', refused(await offerOf([{ key: 'a', qty: 2 }]), 'BAD_PRICE'), (await offerOf([{ key: 'a', qty: 2 }])).json);
  const aliased = await offerOf([{ qty: 2, listPrice: 7 }]);
  check('offers: the listPrice alias is read like unitPrice (2 × 7 = 14)', aliased.status === 200 && aliased.json.subtotal === 14, aliased.json);
}

async function structure() {
  console.log('\n── a pricing structure the engine does not know, or with money below 0 (CAT-306) ──\n');
  check('kind "zzz" → 400 PRICING_KIND_UNKNOWN, naming the line', refused(await priceOf([{ qty: 1, listPrice: 10, pricing: { kind: 'zzz' } }]), 'PRICING_KIND_UNKNOWN'), (await priceOf([{ qty: 1, listPrice: 10, pricing: { kind: 'zzz' } }])).json);
  for (const [label, pricing] of [
    ['fixed amount -1', { kind: 'fixed', amount: -1 }],
    ['fixed amount ""', { kind: 'fixed', amount: '' }],
    ['range min -2', { kind: 'range', min: -2, max: 5 }],
    ['a tier price -2', { kind: 'tiered', tiers: [{ qty: 5, price: -2 }] }],
    ['a tier price ""', { kind: 'tiered', tiers: [{ qty: 5, price: '' }] }],
    ['a tier price "abc"', { kind: 'tiered', tiers: [{ qty: 5, price: 'abc' }] }]
  ]) check('structure: ' + label + ' → 400 BAD_PRICE', refused(await priceOf([{ qty: 6, listPrice: 10, pricing }]), 'BAD_PRICE'), pricing);
  let answer = await priceOf([{ qty: 5, listPrice: 12, pricing: { kind: 'fixed' } }]);
  check('structure: a fixed structure with NO amount is still the list price 12', answer.status === 200 && answer.json.lines[0].unit_price === 12, answer.json);
  answer = await priceOf([{ qty: 10, listPrice: 10, pricing: { kind: 'tiered', tiers: [{ qty: 10, price: '8' }] } }]);
  check('structure: a tier price typed as text "8" is still read as 8', answer.status === 200 && answer.json.lines[0].unit_price === 8, answer.json);
}

async function breakTest() {
  console.log('\n── the break: take the guard out and the same bodies are answered 200 ──\n');
  const keep = { line: SERVICES.lineRefusal, structure: SERVICES.structureRefusal };
  SERVICES.lineRefusal = () => null;
  SERVICES.structureRefusal = () => null;
  try {
    check('without the guard, pricing qty -3 answers 200 (the bug the guard closes)', (await priceOf([{ qty: -3, listPrice: 10 }])).status === 200);
    check('without the guard, offers qty -1 answers 200 (the bug the guard closes)', (await offerOf([{ qty: -1, unitPrice: 10 }])).status === 200);
    check('without the guard, an unknown structure kind answers 200', (await priceOf([{ qty: 1, listPrice: 10, pricing: { kind: 'zzz' } }])).status === 200);
  } finally {
    SERVICES.lineRefusal = keep.line;
    SERVICES.structureRefusal = keep.structure;
  }
  check('with the guard back, the same body is refused again', refused(await priceOf([{ qty: -3, listPrice: 10 }]), 'BAD_QTY'));
}

(async () => {
  console.log('\n══ CAT-305/306/312 · pricing and offers refuse bad money input ══');
  lab.installStubs();
  const app = express();
  app.use((req, res, next) => {
    req.id = 'req-test';
    next();
  });
  app.use(express.json());
  for (const mount of Object.keys(routeFiles)) app.use(mount, require(path.join(HERE, routeFiles[mount])));
  const server = app.listen(0);
  port = server.address().port;
  try {
    await quantity();
    await price();
    await structure();
    await breakTest();
  } finally {
    server.close();
  }
  console.log('\n' + lab.count.passed + ' passed, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})();
