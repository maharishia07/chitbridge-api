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

/**
 * ⭐⭐ THE LOCK HAS TWO HALVES AND BOTH MUST BE TURNED. requireScope('till') on the route is one; the KEY_ROUTES table in
 * middleware/auth.js is the other. A route that carries the first and is missing from the second is refused with a bare 403
 * however correct it looks — and the failure is silent to everything except a person at a counter.
 *
 * ⚠️ THAT IS NOT HYPOTHETICAL. POST /api/till/flags shipped with requireScope('till') and no entry here, so "show on the
 * shop screen" and the offer opt-out saved locally and were refused by the server every single time. Athi found it by
 * reading his own screen: *"the image shows 403 error, what is it, and what it means?"*
 *
 * This walks routes/till.js and insists every route it declares is actually reachable by the scope it asks for. It is a
 * structural check, not a list — a new route added tomorrow is covered without anybody remembering to come here.
 */
it('⭐⭐ every route in routes/till.js is reachable by a till key, or is a named exception', () => {
  const fs = require('fs'), path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'till.js'), 'utf8');

  /**
   * ⚠️ THE EXCEPTIONS ARE THE POINT. This router exists for the counter, so the DEFAULT is that a till key reaches every
   * route in it. Anything that does not must be listed here with the reason, which forces the question to be answered on
   * purpose rather than by forgetting a line in KEY_ROUTES.
   */
  const SHUT = {
    'POST /api/till/pair': 'a key may not mint a key — pairing is gated on !req.api_key inside the route itself',
    'POST /api/till/pair/claim': 'the device claiming a code has no key yet, so it carries no scope at all',
    /* ⚠️ found BY this guard on the day it was written: built for the three-way match and wired to no caller. Left closed
       on purpose — a key should not reach a route nothing calls. Open it in KEY_ROUTES when something actually asks. */
    'GET /api/till/match': 'built, not yet called by anything — the key stays narrow until it is',
  };

  const re = /router\.(get|post)\(\s*'([^']+)'/g;
  let m, seen = 0, shutSeen = 0;
  while ((m = re.exec(src))) {
    const method = m[1].toUpperCase();
    /* mounted at /api/till; a :param stands in for any single segment */
    const url = ('/api/till' + m[2]).replace(/:[A-Za-z_]+/g, 'x');
    const label = method + ' /api/till' + m[2];
    seen++;
    if (SHUT[label]) { shutSeen++; continue; }
    assert.ok(may(['till'], method, url),
      label + ' cannot be reached by a till key. Add it to KEY_ROUTES in middleware/auth.js, or list it in SHUT above with'
      + ' the reason it is closed. requireScope on the route is only half the lock — a route missing from that table is a'
      + ' bare 403 however correct it looks, and the only place that shows is somebody at a counter.');
  }
  assert.ok(seen >= 12, 'only ' + seen + ' till routes were found — the parser has stopped matching, so this guard is blind');
  assert.strictEqual(shutSeen, Object.keys(SHUT).length,
    'a route listed as deliberately closed no longer exists — remove it from SHUT so the list stays honest');
});

/**
 * ⭐⭐⭐ THE LOCK HAS THREE HALVES, AND THEY MUST ALL BE TURNED.
 *   1. routes/till.js         requireScope('till') on the route
 *   2. middleware/auth.js     KEY_ROUTES — what a key may reach at all
 *   3. tools/.../till.js      the AGENT's own ALLOW list, because on a shop PC the page asks its agent to forward
 *                             the call and the agent holds the key
 *
 * ⚠️ Miss (2) and every call is a bare 403 — that was POST /api/till/flags, which Athi found by reading the error on
 * his own screen. Miss (3) and the SAME feature works in a browser and fails on a desktop counter with a completely
 * different message ("not an operation this counter may send"), which reads like an unrelated fault. Three features
 * shipped with (3) stale: the offer opt-out, the shop-screen pick, and turning a declared offer on.
 *
 * This is structural on purpose: it reads the agent's list and insists every till WRITE the counter page makes is in
 * it. A route added tomorrow is covered without anybody remembering to come here.
 */
it('⭐⭐⭐ every till write the counter makes is allowed by the agent as well as by the key', () => {
  const fs2 = require('fs'), path2 = require('path');
  const dir = path2.join(__dirname, '..', 'tools', 'tally-connector');
  const agent = fs2.readFileSync(path2.join(dir, 'till.js'), 'utf8');
  const page = fs2.readFileSync(path2.join(dir, 'till.html'), 'utf8');

  /* what the PAGE actually posts upstream */
  const wants = new Set();
  const re = /tillPost\(\s*'(\/api\/till\/[a-z/-]+)'/g;
  let m; while ((m = re.exec(page))) wants.add(m[1]);
  assert.ok(wants.size >= 4, 'only ' + wants.size + ' till writes were found in the page — the parser has stopped matching');

  /* what the AGENT will forward */
  const allowFrom = agent.indexOf('var ALLOW = [');
  assert.ok(allowFrom > 0, 'the agent no longer declares var ALLOW — this guard is measuring nothing');
  const allowEnd = agent.indexOf('];', allowFrom);
  assert.ok(allowEnd > allowFrom, 'the agent ALLOW list is not closed with ]; — the guard cannot see where it ends');
  const allowLine = agent.slice(allowFrom, allowEnd + 2);
  for (const p of wants) {
    assert.ok(allowLine.indexOf("'" + p + "'") > 0,
      'the counter posts ' + p + ' but the agent ALLOW list does not carry it — it works in a browser and is refused'
      + ' on a shop PC with "not an operation this counter may send"');
    /* and the key must reach it too — the other half of the same lock */
    assert.ok(may(['till'], 'POST', p), p + ' is not in KEY_ROUTES, so every call is a bare 403');
  }

  /* the reads are allow-listed the same way, and are never queued */
  const reads = new Set();
  /* ⚠️ the sub-path matters: /api/till/reward/claim is a different door from /api/till/reward, and a pattern that
     stopped at the first segment would pass a route the agent has never been told about. */
  const rre = /tillGet\(\s*'(\/api\/till\/[a-z/-]+)/g;
  while ((m = rre.exec(page))) reads.add(m[1]);
  for (const p of reads) {
    assert.ok(agent.indexOf("'" + p + "'") > 0, 'the counter reads ' + p + ' but the agent will not forward it');
    assert.ok(may(['till'], 'GET', p), p + ' is not readable by a till key');
  }
});

console.log(pass + ' checks');
