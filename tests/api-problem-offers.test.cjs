#!/usr/bin/env node
// @type: contract
/**
 * api-problem-offers.test.cjs — CAT-220: ROUTE TESTS for POST /api/offers/evaluate and /explain (routes/offers.js), the offer engine as a service.
 *
 * OWNS      what the two doors answer for a person who asked: the discount and its reason in words, a rule that waits ("not yet — AUD 70.00 more needed"),
 *           an expired or not-yet-started offer SKIPPED with the word saying why (never applied), a rule no line qualifies for, an unknown kind said in words,
 *           the shop's own live offers when the caller names none (and still skipping an expired one), explain = evaluate + one `why` per adjustment,
 *           a key not scoped for offers refused 403 KEY_NOT_SCOPED (a till key cannot reach it; an offers key and the services key can), no lines → 400 LINES_REQUIRED.
 *           The refusal SHAPE of every route is the marketing sweep's (tests/api-problem-marketing.test.cjs); this file is the behaviour behind the 200.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route file over a stand-in sign-in and database (tests/lib/problem-world.cjs).
 * FLOW      scenario (body + who signs in + the shop's offer rows) → real route → status + body → the words the person reads
 * CARD      07-offers-pricing-and-combos/offers-engine-as-service
 * Run: node tests/api-problem-offers.test.cjs
 */
'use strict';
const path = require('path');
const express = require('express');
const { harness } = require('./lib/problem-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const lab = harness({ here: HERE, mounts: ['/api/offers'], routeFiles: { '/api/offers': 'routes/offers.js' }, legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json') });
const { world, check } = lab;

const LINES = [{ key: 'tea', item_id: 'item-tea', name: 'Tea', qty: 3, unitPrice: 10 }];
const NOW = '2026-11-06T10:00:00Z';
const CTX = { now: NOW, currency: 'AUD' };
const PAST = '2026-01-01T00:00:00Z';
const FUTURE = '2027-01-01T00:00:00Z';

/** the shop's own live offer rows, as lib/catalogue-view liveOffers reads them (definition + its current version's rules) */
const shelf = (rows) => (sql) =>
  /FROM definition d/.test(sql) ? { rows: rows.map(([id, name, kind, rules]) => ({ definition_id: id, name, sub_kind: kind, rules })), rowCount: rows.length } : undefined;

let port = 0;
/** one request: who signs in (a session, or a key with these scopes), the shop's offer rows → { status, json } */
async function ask(route, body, setup) {
  Object.assign(world, { realAuth: false, who: lab.world.who, asKey: false, db: 'ok', sqlRows: (setup && setup.rows) || null });
  world.keyScopes = (setup && setup.scopes) || null;
  return lab.send(port, 'POST', '/api/offers/' + route, body);
}
const adjustmentsOf = (json) => (json.adjustments || []).map((one) => [one.label, one.amount, one.why]);
const skippedOf = (json) => (json.skipped || []).map((one) => [one.offer_id, one.label, one.why]);

async function reasonWords() {
  console.log('\n── evaluate: the discount and the reason, in the words a shopkeeper reads ──\n');
  const offered = (offers) => ask('evaluate', { lines: LINES, offers, ctx: CTX });

  /* paper: 3 × 10 = 30; 10% of 30 = 3 comes off → 27 */
  let answer = await offered([{ id: 'o1', label: '10 off', kind: 'percent_off', percent: 10 }]);
  check('percent_off 10% on 3 × 10: answers 200, subtotal 30, total 27', answer.status === 200 && answer.json.subtotal === 30 && answer.json.total === 27, answer.json);
  check('…the adjustment says "10% off AUD 30.00" and comes off as −3', JSON.stringify(adjustmentsOf(answer.json)) === JSON.stringify([['10 off', -3, '10% off AUD 30.00']]), answer.json.adjustments);
  check('…and names its engine and how many offers it read', answer.json.engine === 'chitbridge-offers' && answer.json.offers_considered === 1, answer.json);

  /* paper: a spend-100 rule on a 30 basket waits: 100 − 30 = 70 more needed, nothing comes off */
  answer = await offered([{ id: 'o4', label: 'Spend 100', kind: 'threshold', min_amount: 100, percent: 10 }]);
  check('threshold: a basket 70 short comes off nothing and says "not yet — AUD 70.00 more needed"',
    answer.json.total === 30 && !answer.json.adjustments.length && answer.json.notes.length === 1 && answer.json.notes[0].why === 'not yet — AUD 70.00 more needed' && answer.json.notes[0].shortfall === 70, answer.json);

  /* paper: tiers 2+ → 9 each; qty 3 reaches the 2+ tier: 3 × 9 = 27, so 3 comes off */
  answer = await offered([{ id: 'o5', label: 'Tiers', kind: 'tier_price', tiers: [{ qty: 2, price: 9 }, { qty: 5, price: 8 }] }]);
  check('tier_price: qty 3 reaches the 2+ tier, 10 → 9 each, total 27, the tier named in the reason',
    answer.json.total === 27 && /qty 3 reaches the 2\+ tier/.test(answer.json.adjustments[0].why) && /AUD 10\.00 → AUD 9\.00 each/.test(answer.json.adjustments[0].why), answer.json.adjustments);

  /* paper: buy 2 get 1 free on 3 teas at 10 = one free: 20 */
  answer = await offered([{ id: 'o8', label: 'B2G1', kind: 'buy_x_get_y', buy: 2, get: 1, get_percent: 100 }]);
  check('buy_x_get_y: buy 2 get 1 free on 3 → total 20, "1 × free" in the reason', answer.json.total === 20 && /^1 × free/.test(answer.json.adjustments[0].why), answer.json.adjustments);

  answer = await offered([{ id: 'o6', label: 'Other item', kind: 'percent_off', percent: 10, applies_to: { item_ids: ['zzz'] } }]);
  check('an offer for another item: skipped "no line qualifies", total unchanged at 30', answer.json.total === 30 && JSON.stringify(skippedOf(answer.json)) === JSON.stringify([['o6', 'Other item', 'no line qualifies']]), answer.json);

  answer = await offered([{ id: 'o7', label: 'Bad', kind: 'nonsense' }]);
  check('an unknown kind is skipped in words: "unknown kind: nonsense"', answer.status === 200 && JSON.stringify(skippedOf(answer.json)) === JSON.stringify([['o7', 'Bad', 'unknown kind: nonsense']]), answer.json);
}

async function expiredIsSkipped() {
  console.log('\n── an expired or not-yet-started offer is skipped, with the date in the word ──\n');
  const offered = (offers) => ask('evaluate', { lines: LINES, offers, ctx: CTX });
  let answer = await offered([{ id: 'old', label: 'Old', kind: 'percent_off', percent: 50, valid_to: PAST }]);
  check('valid_to in the past: nothing comes off (30 stays 30) and the skip says "expired (2026-01-01T00:00:00Z)"',
    answer.json.total === 30 && !answer.json.adjustments.length && JSON.stringify(skippedOf(answer.json)) === JSON.stringify([['old', 'Old', 'expired (2026-01-01T00:00:00Z)']]), answer.json);
  answer = await offered([{ id: 'soon', label: 'Future', kind: 'percent_off', percent: 50, valid_from: FUTURE }]);
  check('valid_from in the future: nothing comes off and the skip says "not started (from 2027-01-01T00:00:00Z)"',
    answer.json.total === 30 && JSON.stringify(skippedOf(answer.json)) === JSON.stringify([['soon', 'Future', 'not started (from 2027-01-01T00:00:00Z)']]), answer.json);
  answer = await offered([
    { id: 'old', label: 'Old', kind: 'percent_off', percent: 50, valid_to: PAST },
    { id: 'now', label: 'Now', kind: 'percent_off', percent: 10 }
  ]);
  check('one expired, one live: only the live one comes off (27), the expired one is listed skipped; both were considered',
    answer.json.total === 27 && answer.json.adjustments.length === 1 && answer.json.adjustments[0].offer_id === 'now' && answer.json.skipped.length === 1 && answer.json.offers_considered === 2, answer.json);
}

async function theShopsOwnShelf() {
  console.log("\n── no offers named: THIS shop's live offers (the storefront's shelf), the expired one still skipped ──\n");
  const rows = [
    ['d1', 'Tea week', 'percent_off', { percent: 10 }],
    ['d2', 'Last winter', 'percent_off', { percent: 50, valid_to: PAST }]
  ];
  let answer = await ask('evaluate', { lines: LINES, ctx: CTX }, { rows: shelf(rows) });
  check('the shelf is read: the live offer comes off (27), the expired one is skipped, 2 considered',
    answer.status === 200 && answer.json.total === 27 && answer.json.offers_considered === 2 && answer.json.skipped.length === 1 && /^expired/.test(answer.json.skipped[0].why), answer.json);
  check('…the label shown is the offer\'s name from the shelf', adjustmentsOf(answer.json)[0][0] === 'Tea week', answer.json.adjustments);
  answer = await ask('evaluate', { lines: LINES, ctx: CTX }, { rows: shelf([]) });
  check('a shop with no live offers answers 200 with nothing off and 0 considered, never an error', answer.status === 200 && answer.json.total === 30 && answer.json.offers_considered === 0, answer.json);
  answer = await ask('evaluate', { lines: LINES, offers: [], ctx: CTX }, { rows: shelf(rows) });
  check('an empty offers list means "use the shelf", not "no offers": 2 considered', answer.json.offers_considered === 2, answer.json);
}

async function explainSaysWhy() {
  console.log('\n── explain: the same answer plus one reason per adjustment ──\n');
  const offers = [{ id: 'o1', label: '10 off', kind: 'percent_off', percent: 10 }];
  const plain = await ask('evaluate', { lines: LINES, offers, ctx: CTX });
  const said = await ask('explain', { lines: LINES, offers, ctx: CTX });
  check('explain gives the same total and adjustments as evaluate', said.json.total === plain.json.total && JSON.stringify(said.json.adjustments) === JSON.stringify(plain.json.adjustments), said.json);
  check('explain carries one row per adjustment: label, why, amount, scope, target', JSON.stringify(said.json.explain) === JSON.stringify([{ label: '10 off', why: '10% off AUD 30.00', amount: -3, scope: 'line', target: 'tea' }]), said.json.explain);
  check('evaluate has no explain block (that is the second door)', plain.json.explain === undefined, plain.json);
  const none = await ask('explain', { lines: LINES, offers: [{ id: 'old', label: 'Old', kind: 'percent_off', percent: 50, valid_to: PAST }], ctx: CTX });
  check('explain with nothing applied: an empty list, and the skipped word is in skipped', Array.isArray(none.json.explain) && none.json.explain.length === 0 && none.json.skipped.length === 1, none.json);
}

async function keysAndInput() {
  console.log('\n── who may ask, and what a bad body says ──\n');
  const body = { lines: LINES, offers: [{ id: 'o1', label: '10 off', kind: 'percent_off', percent: 10 }], ctx: CTX };
  for (const route of ['evaluate', 'explain']) {
    let answer = await ask(route, body, { scopes: ['till'] });
    check(route + ': a till key is not scoped for offers → 403 KEY_NOT_SCOPED, the scope named', answer.status === 403 && answer.json.code === 'KEY_NOT_SCOPED' && /offers/.test(answer.json.message || ''), answer.json);
    check(route + ': …and nothing was evaluated (no total in the refusal)', answer.json.total === undefined, answer.json);
    answer = await ask(route, body, { scopes: ['offers'] });
    check(route + ': a key scoped "offers" is answered 200, total 27', answer.status === 200 && answer.json.total === 27, answer.json);
    answer = await ask(route, body, { scopes: ['services'] });
    check(route + ': the "services" key (every service) is answered 200', answer.status === 200, answer.json);
    answer = await ask(route, body, null);
    check(route + ': a signed-in session (no key) is answered 200', answer.status === 200, answer.json);
  }
  let answer = await ask('evaluate', { lines: [], offers: [] });
  check('no lines → 400 LINES_REQUIRED, with the words', answer.status === 400 && answer.json.code === 'LINES_REQUIRED' && /line/i.test(answer.json.detail || answer.json.message || ''), answer.json);
  answer = await ask('explain', { offers: [] });
  check('explain with no lines key at all → 400 LINES_REQUIRED too', answer.status === 400 && answer.json.code === 'LINES_REQUIRED', answer.json);
}

(async () => {
  console.log('\n══ CAT-220 · offer evaluate and explain, at the route ══');
  lab.installStubs();
  const app = express();
  app.use((req, res, next) => {
    req.id = 'req-test';
    if (world.keyScopes) req.api_key = { jti: 'j1', scopes: world.keyScopes }; /* the stand-in sign-in keeps a key a test already put on the request */
    next();
  });
  app.use(express.json());
  app.use('/api/offers', require(path.join(HERE, 'routes', 'offers.js')));
  const server = app.listen(0);
  port = server.address().port;
  try {
    await reasonWords();
    await expiredIsSkipped();
    await theShopsOwnShelf();
    await explainSaysWhy();
    await keysAndInput();
  } finally {
    server.close();
  }
  console.log('\n' + lab.count.passed + ' passed, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
})();
