/**
 * key-scopes.test.js — WHAT EVERY KEY CAN REACH, WRITTEN DOWN AND CHECKED (2026-09-09).
 *
 * From the backlog item Athi asked for — *"do we have a mechanism of hacking our product and see what the gaps are"* — section A,
 * the one part that needs no tool and no permission: **the authorisation matrix, exhaustively.**
 *
 * ⚠️⚠️ WHY THIS IS WORTH A FILE OF ITS OWN. Twice this week a scope was wrong in a way nothing noticed:
 *   · `screen` listed /api/till/verify, a route that refuses it — a scope advertising a door it cannot open
 *   · the counter's 📺 button handed a television a TILL key, which can POST /api/chits/send and record a sale
 * Neither threw. Both were found by hand. A scope map is a security boundary written as data, and data drifts unless something
 * asserts it.
 *
 * ⚠️ THIS IS A DECLARATION, NOT A MIRROR. It does not re-derive the answer from KEY_ROUTES — that would pass no matter what the
 * map said, which is the classic worthless test. Every line below is what a human decided that key SHOULD be able to do. When
 * this file and the map disagree, one of them is a bug and somebody has to choose.
 *
 * ⚠️ NO NETWORK, NO WRITES. It asks the guard directly, so it can assert the DANGEROUS direction — "this key must NOT reach this
 * route" — without ever sending the request that would prove it the hard way.
 *
 * Run: node tests/key-scopes.test.js
 */
'use strict';
const assert = require('assert'), path = require('path');
const auth = require(path.join(__dirname, '..', 'middleware', 'auth.js'));

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

/* the guard's own answer: may a key with these scopes make this call? */
const may = (scopes, method, url) => auth.allowsKey
  ? auth.allowsKey(scopes, method, url)
  : (function () { throw new Error('middleware/auth does not expose allowsKey — the matrix cannot be checked'); })();

/**
 * THE ROUTES THAT MATTER. Not every route — the ones where being wrong costs money, privacy or control:
 *   money    recording a sale, changing a price, sending anything
 *   privacy  reading somebody's bills, chits, customers
 *   control  minting keys, authoring the rules that decide a price
 */
const SENSITIVE = [
  ['POST', '/api/chits/send',            'record a sale or send a chit'],
  ['GET',  '/api/chits/inbox',           'read the shop inbox'],
  ['GET',  '/api/till/bills',            'read the day takings'],
  ['GET',  '/api/till/snapshot',         'read the whole shop'],
  ['POST', '/api/till/price',            'change a price'],
  ['POST', '/api/till/stock',            'take something off the shelf'],
  ['POST', '/api/till/pair',             'hand out a new key'],
  ['POST', '/api/keys',                  'mint a key'],
  ['POST', '/api/definitions',           'author an offer or a tax slab'],
  ['DELETE', '/api/definitions/abc',     'retire an offer'],
  ['GET',  '/api/products',              'read the catalogue'],
  ['PATCH', '/api/products/abc',         'rewrite a product'],
  ['DELETE', '/api/products/abc',        'remove a product'],
  ['GET',  '/api/tax/gstr',              'read the tax return'],
  ['POST', '/api/events/ticket',         'listen to the bell'],
];

/**
 * WHAT EACH KEY IS FOR, in one sentence, and exactly what it may do. Everything not listed is DENIED — that is the point of
 * writing it this way round: a scope that quietly gains a route fails here rather than passing silently.
 */
const EXPECT = {
  screen:  { why: 'a sign on a wall: it reads the price list and nothing else',
             allow: ['GET /api/till/snapshot', 'POST /api/events/ticket'] },
  till:    { why: 'a counter: it bills for its own shop, and can say what ran out and what a price is now',
             allow: ['GET /api/till/snapshot', 'GET /api/till/bills', 'POST /api/chits/send',
                     'POST /api/till/price', 'POST /api/till/stock', 'POST /api/events/ticket'] },
  connector: { why: 'a program on a shop PC: products up, orders down, the bell',
             allow: ['GET /api/products', 'PATCH /api/products/abc', 'GET /api/chits/inbox', 'POST /api/events/ticket'] },
  offers:  { why: 'the offers engine as a service', allow: [] },
  pricing: { why: 'the pricing engine as a service', allow: [] },
  tax:     { why: 'the tax engine as a service', allow: [] },
  invoice: { why: 'the invoice reader', allow: [] },
  services:{ why: 'every engine, as a service', allow: [] },
};

console.log('— what every key may reach —');

for (const scope of Object.keys(EXPECT)) {
  const spec = EXPECT[scope];
  it(scope + ' — ' + spec.why, () => {
    const wrong = [];
    for (const [m, url, what] of SENSITIVE) {
      const want = spec.allow.indexOf(m + ' ' + url) >= 0;
      const got = may([scope], m, url);
      if (got !== want) wrong.push((got ? 'CAN' : 'cannot') + ' ' + what + '  (' + m + ' ' + url + ') — expected ' + (want ? 'ALLOW' : 'DENY'));
    }
    assert.strictEqual(wrong.length, 0, 'the ' + scope + ' key:\n        ' + wrong.join('\n        '));
  });
}

it('⚠️⚠️ NO key of any scope may mint another key', () => {
  /* the one that would turn a stolen counter key into every other kind of key */
  for (const scope of auth.SCOPE_NAMES)
    assert.ok(!may([scope], 'POST', '/api/keys'), 'the ' + scope + ' scope can mint keys');
});

it('⚠️⚠️ NO key of any scope may author the rules that decide a price', () => {
  /* an offer or a tax slab changes what every future bill says; that is a signed-in decision, not a device one */
  for (const scope of auth.SCOPE_NAMES) {
    assert.ok(!may([scope], 'POST', '/api/definitions'), 'the ' + scope + ' scope can author a definition');
    assert.ok(!may([scope], 'DELETE', '/api/definitions/abc'), 'the ' + scope + ' scope can retire a definition');
  }
});

it('⚠️ a SCREEN key can never record a sale, read the takings, or change anything', () => {
  for (const [m, url] of [['POST', '/api/chits/send'], ['GET', '/api/till/bills'],
                          ['POST', '/api/till/price'], ['POST', '/api/till/stock'],
                          ['PATCH', '/api/products/abc'], ['GET', '/api/products']])
    assert.ok(!may(['screen'], m, url), 'a screen key can ' + m + ' ' + url);
});

it('⚠️ a TILL key can never rewrite a product, nor read another shop', () => {
  /* it changes a price and an availability through their own narrow routes; the product itself stays out of reach */
  for (const [m, url] of [['PATCH', '/api/products/abc'], ['DELETE', '/api/products/abc'],
                          ['POST', '/api/products/bulk'], ['GET', '/api/tax/gstr']])
    assert.ok(!may(['till'], m, url), 'a till key can ' + m + ' ' + url);
});

it('⭐ and a scope nobody has heard of opens nothing', () => {
  for (const [m, url] of SENSITIVE) assert.ok(!may(['made_up'], m, url), 'an unknown scope reached ' + m + ' ' + url);
  assert.ok(!may([], 'GET', '/api/till/snapshot'), 'a key with NO scopes reached the snapshot');
});

console.log(pass + ' checks');
