'use strict';
/**
 * vertical-readers-characterisation.test.cjs — VERT-13 slice 1 · P1-14.
 * What the three remaining read sites answered for one shop BEFORE they asked the resolver, and what they answer now.
 *   adopt   "mine"    routes/adopt.js receiverOf → adopt.verticalOf(words)   (the receiver's goods pack key)
 *   profile "sectors" lib/profile.resolveProfileReadiness                   (the sectors the readiness rules run over)
 *   kyb     "sectors" lib/kyb.yourself                                      (the sectors its applicability reads)
 * WAS = recorded from origin/main e8d03e66 (adopt.verticalOf(entity_profile.sectors) · p.sectors || [null] · p.sectors).
 * The rule now: the resolver's trade is constitution → identity → first declared sector; a shop's DECLARED sectors stay the list
 * readiness and KYB judge, the resolved trade only fills the gap when none is declared. Every answer that moved is listed below.
 * Run: node tests/vertical-readers-characterisation.test.cjs · no DB, no network.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const API = path.join(__dirname, '..');
const G = require(path.join(API, 'lib', 'govresolve'));
const A = require(path.join(API, 'lib', 'adopt'));

/* the shops: c constitution · i identities.vertical · s entity_profile.sectors; WAS and NOW per reader */
const SHOPS = [
  { name: 'A both agree (pharma)', c: null, i: 'pharma', s: ['pharma'], was: { mine: 'pharma', profile: ['pharma'], kyb: ['pharma'] }, now: { mine: 'pharma', profile: ['pharma'], kyb: ['pharma'] } },
  { name: 'B constitution pharma, sectors paint', c: 'pharma', i: null, s: ['paint'], was: { mine: 'chemical', profile: ['paint'], kyb: ['paint'] }, now: { mine: 'pharma', profile: ['paint'], kyb: ['paint'] } },
  { name: 'C identity hotel, no sectors', c: null, i: 'hotel', s: [], was: { mine: null, profile: [null], kyb: [] }, now: { mine: null, profile: ['hotel'], kyb: ['hotel'] } },
  { name: 'D sectors only (kirana)', c: null, i: null, s: ['kirana'], was: { mine: 'food', profile: ['kirana'], kyb: ['kirana'] }, now: { mine: 'food', profile: ['kirana'], kyb: ['kirana'] } },
  { name: 'E constitution paint, no sectors', c: 'paint', i: null, s: [], was: { mine: null, profile: [null], kyb: [] }, now: { mine: 'chemical', profile: ['paint'], kyb: ['paint'] } },
  { name: 'F nothing stated', c: null, i: null, s: [], was: { mine: null, profile: [null], kyb: [] }, now: { mine: null, profile: [null], kyb: [] } },
  { name: 'G identity paint, sectors kirana', c: null, i: 'paint', s: ['kirana'], was: { mine: 'food', profile: ['kirana'], kyb: ['kirana'] }, now: { mine: 'chemical', profile: ['kirana'], kyb: ['kirana'] } }
];
/** the three readers' answers NOW, through the same helpers the code calls */
function nowOf(shop) {
  const trade = G.verticalFrom({ constitution: shop.c, vertical: shop.i, sectors: shop.s });
  const judged = G.sectorsOrTrade(shop.s, { key: trade.key });
  return { mine: A.verticalOf(G.tradeWordsOf(trade)), profile: judged.length ? judged : [null], kyb: G.sectorsOrTrade(shop.s, shop.s.length ? null : trade) };
}
let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + String(e && e.message).slice(0, 300)); } };

console.log('\n══ every reader, every shop: the answer now ══');
SHOPS.forEach((shop) => ok(shop.name, () => assert.deepStrictEqual(nowOf(shop), shop.now)));

console.log('\n══ the answers that moved (the PR lists the same) ══');
ok('exactly 7 of 21 answers changed, and every one is a shop whose sources disagree or whose declaration is empty', () => {
  const moved = [];
  SHOPS.forEach((shop) => Object.keys(shop.was).forEach((reader) => {
    if (JSON.stringify(shop.was[reader]) !== JSON.stringify(shop.now[reader])) moved.push(shop.name[0] + ':' + reader);
  }));
  assert.deepStrictEqual(moved, ['B:mine', 'C:profile', 'C:kyb', 'E:mine', 'E:profile', 'E:kyb', 'G:mine']);
});
ok('the shops where both sources agree, or only one is stated, change nothing', () => {
  ['A', 'D', 'F'].forEach((letter) => {
    const shop = SHOPS.find((x) => x.name[0] === letter);
    assert.deepStrictEqual(shop.was, shop.now);
  });
});

console.log('\n══ the helpers ══');
ok('tradeWordsOf: the trade first, then the declared sectors; no trade → []; null → []', () => {
  assert.deepStrictEqual(G.tradeWordsOf(G.verticalFrom({ constitution: 'pharma', sectors: ['grocery'] })), ['pharma', 'grocery']);
  assert.deepStrictEqual(G.tradeWordsOf(G.verticalFrom({})), []);
  assert.deepStrictEqual(G.tradeWordsOf(null), []);
});
ok('sectorsOrTrade: the shop\'s own words win as written; a gap is filled by the stated trade; an unstated trade fills nothing; the input is not mutated', () => {
  const own = ['Paint '];
  assert.deepStrictEqual(G.sectorsOrTrade(own, { key: 'hotel' }), ['Paint ']);
  assert.deepStrictEqual(G.sectorsOrTrade([], { key: 'hotel' }), ['hotel']);
  assert.deepStrictEqual(G.sectorsOrTrade(undefined, { key: null }), []);
  assert.deepStrictEqual(own, ['Paint ']);
});

console.log('\n══ no read site keeps its own trade read ══');
const code = (file) => fs.readFileSync(path.join(API, file), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
ok('routes/adopt.js receiverOf reads through the resolver, not entity_profile', () => {
  const src = code('routes/adopt.js');
  assert.ok(/tradeWordsOf\(await govresolve\.verticalOf\(entity_id\)\)/.test(src));
  assert.ok(!/FROM entity_profile/.test(src));
});
ok('profile and kyb judge sectorsOrTrade, not the raw list; stocked uses tradeWordsOf (one helper, two callers)', () => {
  assert.ok(/govresolve\.sectorsOrTrade\(p\.sectors/.test(code('lib/profile.js')));
  assert.ok(/govresolve\.sectorsOrTrade\(declared/.test(code('lib/kyb.js')));
  assert.ok(/govresolve\.tradeWordsOf\(read\.trade\)/.test(code('lib/stocked.js')));
});

console.log('\n' + (pass + fail) + ' checks · ' + pass + ' passed · ' + fail + ' failed');
process.exit(fail ? 1 : 0);
