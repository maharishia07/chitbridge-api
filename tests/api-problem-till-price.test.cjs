#!/usr/bin/env node
// @type: contract
/**
 * api-problem-till-price.test.cjs — CAT-222: ROUTE TESTS for the counter's price move (POST /api/till/price) and the "worth an offer" list (GET /api/till/worth-an-offer) of routes/till.js.
 *
 * OWNS      the price move: what is written (money as { amount, currency } in the SHOP's currency, the old price kept as price_was, who and when), the answer a person reads
 *           (was → now), the first price of a product (was null), a price of 0 allowed, text "45.50" read, a blank / null / negative / word refused in words, a product that is not the
 *           shop's 404, a shop with no money stated 422, a cost-blind hat 403, a key not scoped for the till 403. And the worth-an-offer list: each product's REASON in words
 *           (expires in N days / tomorrow / today / expired N days ago · never sold here · not sold for N days), the urgency order, the window and the quiet days (clamped, echoed back),
 *           a product that moved recently and expires far off is NOT listed, 60 rows at most, and the basis sentence that says what the list is made from.
 *           The refusal SHAPE of every till route is the till sweep's (tests/api-problem-till.test.cjs, open PRs); this file is the behaviour behind the 200, in its own file for that reason.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real route file over a stand-in sign-in and database (tests/lib/problem-world.cjs); the product writer is recorded.
 * FLOW      scenario (body or query + who signs in + the shop's rows) → real route → status + body (+ the patch written) → the words the person reads
 * CARD      07-offers-pricing-and-combos/till-price-and-worth-an-offer
 * Run: node tests/api-problem-till-price.test.cjs
 */
'use strict';
const path = require('path');
const express = require('express');
const { harness, PARTY } = require('./lib/problem-world.cjs');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const lab = harness({ here: HERE, mounts: ['/api/till'], routeFiles: { '/api/till': 'routes/till.js' }, legacyFile: path.join(HERE, 'docs', 'contracts', 'api-legacy.json') });
const { world, check } = lab;

const ITEM = PARTY;
const DAY = 86400000;
let port = 0;
let skipped = 0;
const skip = (what, why) => {
  skipped++;
  console.log('  SKIP  ' + what + ' — ' + why);
};

/** what the route wrote: the merge-patch it handed the catalogue's one product writer (recorded; the statement itself is the catalogue's, tested elsewhere) */
let written = [];
const catwrite = require(path.join(HERE, 'lib', 'catalogue-write.js'));
catwrite.patchItems = async (db, entity, rows) => {
  written = rows;
  return { rows: rows.map((one) => ({ item_id: one.item_id, item_data: Object.assign({ name: 'Poori' }, one.merge) })), rowCount: rows.length };
};

const answering = (pattern, rows) => (sql) => (pattern.test(sql) ? { rows, rowCount: rows.length } : undefined);
/** the shop's row (its money), the product's row, or the shop with no money stated and no country */
const SHOP_INR = answering(/SELECT currency_code, country FROM identities/, [{ currency_code: 'INR', country: 'IN' }]);
const SHOP_AUD = answering(/SELECT currency_code, country FROM identities/, [{ currency_code: 'AUD', country: 'AU' }]);
const SHOP_NONE = answering(/SELECT currency_code, country FROM identities/, [{ currency_code: null, country: null }]);
const ITEM_ROW = (data) => answering(/SELECT item_data FROM catalogue_items/, data ? [{ item_data: data }] : []);
const both = (...parts) => (sql, params) => parts.map((one) => one(sql, params)).find(Boolean);

/** one request over the real route: who signs in (a session, or a key with these scopes) and the rows the stand-in database holds */
async function ask(method, url, body, setup) {
  Object.assign(world, { realAuth: false, who: lab.world.who, asKey: false, db: 'ok', sqlRows: (setup && setup.rows) || null });
  world.keyScopes = (setup && setup.scopes) || null;
  written = [];
  return lab.send(port, method, url, body);
}
const move = (body, rows, setup) => ask('POST', '/api/till/price', body, Object.assign({ rows }, setup || {}));

async function priceMoves() {
  console.log('\n── POST /price: a price typed at the counter ──\n');
  const SHELF = both(SHOP_INR, ITEM_ROW({ name: 'Poori', price: { amount: 40, currency: 'INR' } }));
  /* paper: 40 → 45 by Asha: the answer says was 40, now 45, in the shop's own money; the merge writes 45, keeps 40 as price_was, names Asha */
  let answer = await move({ item_id: ITEM, price: 45, by: 'Asha' }, SHELF);
  check('40 → 45: 200 ok, was 40, now 45, currency INR, the product named', answer.status === 200 && answer.json.ok === true && answer.json.was === 40 && answer.json.now === 45 && answer.json.currency === 'INR' && answer.json.item_id === ITEM, answer.json);
  const patch = (written[0] && written[0].merge) || {};
  check('…what is written: price { amount 45, currency INR } · price_was 40 · price_changed_by Asha · a date of the change',
    JSON.stringify(patch.price) === JSON.stringify({ amount: 45, currency: 'INR' }) && patch.price_was === 40 && patch.price_changed_by === 'Asha' && !Number.isNaN(Date.parse(patch.price_changed_at)), patch);
  check('…and only this shop\'s product is the target', written.length === 1 && written[0].item_id === ITEM, written);

  answer = await move({ item_id: ITEM, price: 45 }, SHELF);
  check('no name given: the change is by "the counter"', (written[0].merge || {}).price_changed_by === 'the counter', written);
  answer = await move({ item_id: ITEM, price: 45, by: 'x'.repeat(200) }, SHELF);
  check('a very long name is cut to 80 characters in the record', (written[0].merge || {}).price_changed_by.length === 80, written);

  answer = await move({ item_id: ITEM, price: 45 }, both(SHOP_INR, ITEM_ROW({ name: 'Poori', price: 40 })));
  check('an old price kept as a bare number 40 is read as 40 → was 40', answer.json.was === 40 && written[0].merge.price_was === 40, answer.json);
  answer = await move({ item_id: ITEM, price: 45 }, both(SHOP_INR, ITEM_ROW({ name: 'Poori' })));
  check('the first price of a product: was null in the record (price_was null), now 45', answer.status === 200 && answer.json.now === 45 && written[0].merge.price_was === null, [answer.json, written]);
  answer = await move({ item_id: ITEM, price: 0 }, SHELF);
  check('a price of 0 is allowed (a free item the shop sets), written as 0 not as a blank', answer.status === 200 && written[0].merge.price.amount === 0, [answer.json, written]);
  answer = await move({ item_id: ITEM, price: '45.50' }, SHELF);
  check('a price typed as text "45.50" is read as 45.5', answer.status === 200 && answer.json.now === 45.5 && written[0].merge.price.amount === 45.5, answer.json);
  answer = await move({ item_id: ITEM, price: 12.5 }, both(SHOP_AUD, ITEM_ROW({ name: 'Pie', price: { amount: 10, currency: 'AUD' } })));
  check("an Australian shop's price is written in AUD, from the shop's own money, never INR by name", answer.json.currency === 'AUD' && written[0].merge.price.currency === 'AUD', [answer.json, written]);
}

async function priceRefusals() {
  console.log('\n── POST /price: what is refused, and in which words ──\n');
  const SHELF = both(SHOP_INR, ITEM_ROW({ name: 'Poori', price: 40 }));
  const refused = async (label, body, words) => {
    const answer = await move(body, SHELF);
    check(label + ' → 400 "' + words + '", nothing written', answer.status === 400 && (answer.json.detail || answer.json.message || '').includes(words) && written.length === 0, answer.json);
  };
  await refused('no product named', { price: 5 }, 'item_id required');
  await refused('a negative price', { item_id: ITEM, price: -1 }, 'price must be a number, zero or more');
  await refused('a word for a price', { item_id: ITEM, price: 'cheap' }, 'price must be a number, zero or more');
  await refused('null for a price (once read as 0, wiping the shelf price)', { item_id: ITEM, price: null }, 'Price is required');
  await refused('a blank price', { item_id: ITEM, price: '' }, 'Price is required');
  await refused('an empty list for a price', { item_id: ITEM, price: [] }, 'Price is required');
  await refused('true for a price', { item_id: ITEM, price: true }, 'Price must be a number');
  let answer = await move({ item_id: ITEM, price: 5 }, SHOP_INR);
  check('a product that is not this shop\'s → 404, nothing written', answer.status === 404 && written.length === 0, answer.json);
  answer = await move({ item_id: ITEM, price: 5 }, both(SHOP_NONE, ITEM_ROW({ name: 'Poori' })));
  check('a shop that has stated no money → 422, never a price written in a money nobody chose', answer.status === 422 && answer.json.code === 'NO_MONEY' && written.length === 0, answer.json);
  answer = await ask('POST', '/api/till/price', { item_id: ITEM, price: 5 }, { rows: SHELF, scopes: ['connector'] });
  check('a key not scoped for the till → 403 KEY_NOT_SCOPED, nothing written', answer.status === 403 && answer.json.code === 'KEY_NOT_SCOPED' && written.length === 0, answer.json);
  answer = await ask('POST', '/api/till/price', { item_id: ITEM, price: 45 }, { rows: SHELF, scopes: ['till'] });
  check('a till key is answered 200', answer.status === 200, answer.json);
}

/** one row of the stand-in history: a product, its nearest expiry, the last time it was on a bill */
const stock = (name, expiryDays, soldDays) => ({
  item_id: name,
  name,
  expiry: expiryDays === null ? null : new Date(Date.now() + expiryDays * DAY).toISOString(),
  last_sold: soldDays === null ? null : new Date(Date.now() - soldDays * DAY).toISOString()
});
const HISTORY = (rows) => answering(/WITH lines AS/, rows);
const worth = (rows, query) => ask('GET', '/api/till/worth-an-offer' + (query || ''), undefined, { rows: HISTORY(rows) });
const byName = (answer, name) => (answer.json.items || []).find((one) => one.name === name);

async function worthAnOffer() {
  console.log('\n── GET /worth-an-offer: each product\'s reason, in words, most urgent first ──\n');
  /* paper, window 14 days, quiet 14 days, urgency = days − left for an expiry, + 100 if already past; "never sold" 10; "not sold" min(days,90)/3 */
  const rows = [
    stock('milk', 2.5, 1.5), /* expires in 2 days: 14 − 2 = 12 */
    stock('bread', -1.5, 1.5), /* expired 2 days ago: 14 + 2 + 100 = 116 */
    stock('rice', null, 19.5), /* not sold for 20 days: 20 / 3 = 6.67 → 7 */
    stock('salt', null, null), /* never sold here: 10 */
    stock('tea', 30, 1.5), /* expiry outside the window, sold lately: not listed */
    stock('jam', 5.5, null), /* expires in 5 days (9) + never sold here (10) = 19 */
    stock('curd', 0.5, 1.5), /* expires today: 14 − 0 = 14 */
    stock('cream', 1.5, 1.5) /* expires tomorrow: 14 − 1 = 13 */
  ];
  const answer = await worth(rows);
  check('answers 200 ok with the window 14 and quiet 14 echoed back', answer.status === 200 && answer.json.ok === true && answer.json.days === 14 && answer.json.quiet === 14, answer.json);
  check('the order is the urgency, highest first: bread 116 · jam 19 · curd 14 · cream 13 · milk 12 · salt 10 · rice 7',
    JSON.stringify(answer.json.items.map((one) => [one.name, one.urgency])) === JSON.stringify([['bread', 116], ['jam', 19], ['curd', 14], ['cream', 13], ['milk', 12], ['salt', 10], ['rice', 7]]), answer.json.items);
  check('bread: "expired 2 days ago"', JSON.stringify(byName(answer, 'bread').why) === JSON.stringify(['expired 2 days ago']), byName(answer, 'bread'));
  check('curd: "expires today" · cream: "expires tomorrow" · milk: "expires in 2 days"', JSON.stringify([byName(answer, 'curd').why, byName(answer, 'cream').why, byName(answer, 'milk').why]) === JSON.stringify([['expires today'], ['expires tomorrow'], ['expires in 2 days']]), answer.json.items);
  check('jam carries BOTH reasons, expiry first: "expires in 5 days", "never sold here"', JSON.stringify(byName(answer, 'jam').why) === JSON.stringify(['expires in 5 days', 'never sold here']), byName(answer, 'jam'));
  check('rice: "not sold for 20 days" and its last sale date; salt: "never sold here" with no last sale', byName(answer, 'rice').why[0] === 'not sold for 20 days' && !!byName(answer, 'rice').last_sold && byName(answer, 'salt').last_sold === null, answer.json.items);
  check('tea (expires in 30 days, sold yesterday) is NOT listed: no invented urgency', byName(answer, 'tea') === undefined, answer.json.items);
  check('it says what it is made from: expiry at goods-in and the last sale, not a stock count', /expiry recorded at goods-in, and the last time each product was on a bill/.test(answer.json.basis), answer.json.basis);

  console.log('\n── the window and the quiet days: the caller\'s, clamped, echoed ──\n');
  /* paper: a 6-day window lists jam (5 days) but not a 9-day expiry; a quiet of 30 days leaves rice (20 days) out */
  let narrow = await worth([stock('near', 5.5, 0.5), stock('far', 9.5, 0.5), stock('rice', null, 19.5)], '?days=6&quiet=30');
  check('?days=6&quiet=30 → near (5 days) listed, far (9 days) and rice (20 days of 30) not', JSON.stringify(narrow.json.items.map((one) => one.name)) === JSON.stringify(['near']) && narrow.json.days === 6 && narrow.json.quiet === 30, narrow.json);
  const clamps = [['?days=999', 'days', 180], ['?days=-3', 'days', 1], ['?days=abc', 'days', 14], ['?quiet=1000', 'quiet', 365], ['?quiet=0', 'quiet', 14]];
  for (const [query, key, wanted] of clamps) {
    narrow = await worth([], query);
    check(query + ' → ' + key + ' is ' + wanted, narrow.status === 200 && narrow.json[key] === wanted, narrow.json);
  }
  const many = await worth(Array.from({ length: 70 }, (_, index) => stock('p' + index, null, null)));
  check('70 products worth an offer → 60 are listed, never more', many.json.items.length === 60, many.json.items.length);
  const none = await worth([]);
  check('nothing recorded → 200 with an empty list, never an error', none.status === 200 && Array.isArray(none.json.items) && none.json.items.length === 0, none.json);
  const quiet1 = await worth([stock('oneday', null, 1.5)], '?quiet=1');
  check('a quiet of 1 day lists a product last sold 2 days ago: "not sold for 2 days"', byName(quiet1, 'oneday').why[0] === 'not sold for 2 days', quiet1.json.items);
}

async function dateOnlyExpiry() {
  console.log('\n── an expiry is a DATE (lotfields: "the date it must not be sold after") ──\n');
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + DAY).toISOString().slice(0, 10);
  const row = (date) => ({ item_id: 'a', name: 'curd', expiry: date, last_sold: new Date(Date.now() - 0.5 * DAY).toISOString() });
  const nowToday = (await worth([row(today)])).json.items;
  const nowTomorrow = (await worth([row(tomorrow)])).json.items;
  const sayToday = nowToday[0] && nowToday[0].why[0];
  const sayTomorrow = nowTomorrow[0] && nowTomorrow[0].why[0];
  if (sayToday === 'expires today' && sayTomorrow === 'expires tomorrow') check('a batch dated today says "expires today", one dated tomorrow says "expires tomorrow"', true);
  else skip('a date-only expiry reads as its day', 'today\'s date says "' + sayToday + '" and tomorrow\'s says "' + sayTomorrow + '": the day count floors from UTC midnight of the date (CTR-195)');
}

(async () => {
  console.log('\n══ CAT-222 · the till price move and worth-an-offer, at the route ══');
  lab.installStubs();
  const app = express();
  app.use((req, res, next) => {
    req.id = 'req-test';
    if (world.keyScopes) req.api_key = { jti: 'j1', scopes: world.keyScopes }; /* the stand-in sign-in keeps a key a test already put on the request */
    next();
  });
  app.use(express.json());
  app.use('/api/till', require(path.join(HERE, 'routes', 'till.js')));
  const server = app.listen(0);
  port = server.address().port;
  try {
    await priceMoves();
    await priceRefusals();
    await worthAnOffer();
    await dateOnlyExpiry();
  } finally {
    server.close();
  }
  console.log('\n' + lab.count.passed + ' passed, ' + lab.count.failed + ' failed, ' + skipped + ' skipped (each a real bug, with its backlog line)');
  process.exit(lab.count.failed ? 1 : 0);
})();
