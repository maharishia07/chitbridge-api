/**
 * network-storefront.test.cjs — A MEMBER STORE'S STOREFRONT SHOWS ITS NETWORK'S OFFERS, AND ITS CHECKOUT CHARGES THEM.
 *
 * 2026-09-17: the counter honoured what a brand released and the store took; the storefront showed the same products with
 * no offer, and the order path had no way to apply one to an adopted product. The storefront now keys each adopted item
 * (lib/network-offers.lineKey), the offers are aimed at those keys (forFinishes), and lib/offers-live applies the same
 * offers to the same keys at checkout. Same key on both sides, or the promise and the invoice disagree.
 *
 * Run: node tests/network-storefront.test.cjs   · no DB (the readers are stubbed), no network.
 */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');

let pass = 0, fail = 0;
const tests = [];
const it = (name, fn) => tests.push([name, fn]);

const net = require(path.join(API, 'lib', 'network-offers.js'));
const read = require(path.join(API, 'lib', 'catalogue-read.js'));

it('⚠️⚠️ the storefront key is the key catalogue-read gives the same line — by sku, and by name when there is none', () => {
  const src = { source_key: 'prestige-home@v1', title: 'Prestige', owner_entity_id: 'brand-1' };
  for (const item of [{ name: 'Apex 500W', sku: 'PR-APEX-500' }, { name: 'Apex 500W' }]) {
    const line = read.referencedLine(src, item, 'store-1', null);
    assert.strictEqual(net.lineKey(src.source_key, item), line.line_id);
  }
});

it('⭐ a store whose adoptions are all its own reads nothing and gets nothing — but its items are still keyed', async () => {
  const fins = [{ source: 'own@v1', owner_entity_id: 'store-1', items: [{ name: 'Tea', sku: 'T1' }] }];
  const out = await net.forFinishes('store-1', fins);
  assert.deepStrictEqual(out, []);
  assert.strictEqual(fins[0].items[0].line_id, 'src:own@v1:T1');
});

it('⭐⭐ checkout applies a network offer to the adopted line it was aimed at — and to nothing else', async () => {
  const cv = require(path.join(API, 'lib', 'catalogue-view.js'));
  const cg = require(path.join(API, 'lib', 'customer-groups.js'));
  const saved = { live: cv.liveOffers, groups: cg.groupsOf, fin: net.forFinishes };
  let asked = null;
  cv.liveOffers = async () => [];
  cg.groupsOf = async () => [];
  net.forFinishes = async (store, fins) => {
    asked = fins;
    return [{ id: 'off-1', kind: 'percent_off', label: 'Festive 15%', percent: 15, scope: 'line',
              applies_to: { category: 'Mixer grinders' }, network: { brand_id: 'brand-1', brand_name: 'Prestige' } }];
  };
  try {
    const mixer = { kind: 'finish', source: 'prestige-home@v1', finish: 'Apex 500W', name: 'Apex 500W', quantity: 1, price: 3799, total: 3799,
                    governed: { under: 'prestige-home@v1', owner_entity_id: 'brand-1' } };
    Object.defineProperty(mixer, 'd', { value: { sku: 'PR-APEX-500', category: 'Mixer grinders' }, enumerable: false });
    const hob = { kind: 'finish', source: 'prestige-home@v1', finish: 'Gas hob', name: 'Gas hob', quantity: 2, price: 6860, total: 13720,
                  governed: { under: 'prestige-home@v1', owner_entity_id: 'brand-1' } };
    Object.defineProperty(hob, 'd', { value: { sku: 'PR-GTM02', category: 'Gas stoves' }, enumerable: false });
    const r = await require(path.join(API, 'lib', 'offers-live.js')).applyLiveOffers(
      { identity_id: 'store-1', currency_code: 'INR' }, [mixer, hob], 17519, { withEntity: async () => ({ rows: [] }) });
    assert.ok(asked && asked.length === 2, 'checkout never asked for the network offers');
    assert.strictEqual(r.items[0].offer && r.items[0].offer.off, 569.85, 'the mixer did not get 15% off');
    assert.strictEqual(r.items[0].total, 3229.15);
    assert.ok(!r.items[1].offer, 'the offer reached a product outside its category');
    assert.strictEqual(r.total, 16949.15);
    assert.ok(!('d' in JSON.parse(JSON.stringify(r.items[0]))), 'the matching data was stored on the chit line');
  } finally { cv.liveOffers = saved.live; cg.groupsOf = saved.groups; net.forFinishes = saved.fin; }
});

it('⭐ a store\'s OWN adopted line (it authored the source) does not ask its network', async () => {
  const cv = require(path.join(API, 'lib', 'catalogue-view.js'));
  const cg = require(path.join(API, 'lib', 'customer-groups.js'));
  const saved = { live: cv.liveOffers, groups: cg.groupsOf, fin: net.forFinishes };
  let asked = false;
  cv.liveOffers = async () => []; cg.groupsOf = async () => [];
  net.forFinishes = async () => { asked = true; return []; };
  try {
    const own = { kind: 'finish', source: 'mine@v1', finish: 'X', quantity: 1, price: 10, total: 10, governed: { owner_entity_id: 'store-1' } };
    await require(path.join(API, 'lib', 'offers-live.js')).applyLiveOffers({ identity_id: 'store-1' }, [own], 10, { withEntity: async () => ({ rows: [] }) });
    assert.strictEqual(asked, false);
  } finally { cv.liveOffers = saved.live; cg.groupsOf = saved.groups; net.forFinishes = saved.fin; }
});

it('⚠️ the wiring: the storefront read adds the network offers, and both order lines carry the engine\'s data unstored', () => {
  const view = fs.readFileSync(path.join(API, 'lib', 'catalogue-view.js'), 'utf8');
  assert.ok(/forFinishes\(entity\.identity_id, finishes/.test(view), 'the storefront read never asks for network offers');
  assert.ok(/offersFor\(offersAll, viewerGroups\)\.concat\(networkOffers/.test(view), 'the network offers are not in the payload');
  const cat = fs.readFileSync(path.join(API, 'routes', 'catalogue.js'), 'utf8');
  assert.ok(/defineProperty\(finLine, 'd', \{[^}]*\}[^)]*enumerable: false/.test(cat), 'an adopted order line does not carry its category');
  assert.ok(/defineProperty\(l, 'd', \{ value: ref\.d, enumerable: false \}\)/.test(cat), 'an own order line does not carry its categories');
});

it('⚠️ a public storefront view never writes the brand\'s member index', () => {
  const src = fs.readFileSync(path.join(API, 'lib', 'network-offers.js'), 'utf8');
  assert.ok(/noteMembers: false/.test(src.slice(src.indexOf('async function forFinishes'))), 'forFinishes would write on every anonymous view');
});

it('⭐⭐ a brand\'s offers say whether its stores have them — unreleased, released, changed since release', () => {
  const rows = [
    { kind: 'offer', definition_id: 'new', current_version: 2 },
    { kind: 'offer', definition_id: 'out', current_version: 20 },
    { kind: 'offer', definition_id: 'edited', current_version: 5 },
    { kind: 'category', definition_id: 'cat', current_version: 1 },
  ];
  net.stampReleases(rows, { stores: 5, released: { out: { at: '2026-09-17T02:47:53Z', version: 20 }, edited: { at: 'x', version: 4 } } });
  assert.deepStrictEqual(rows[0].network, { stores: 5, released: false, at: null, changed: false });
  assert.deepStrictEqual(rows[1].network, { stores: 5, released: true, at: '2026-09-17T02:47:53Z', changed: false });
  assert.strictEqual(rows[2].network.changed, true);
  assert.ok(!rows[3].network, 'a category was given a release state');
  const lone = [{ kind: 'offer', definition_id: 'a', current_version: 1 }];
  net.stampReleases(lone, { stores: 0, released: {} });
  assert.ok(!lone[0].network, 'a shop with no stores was told about a network it does not have');
});

it('⚠️ the definitions list stamps them in the SAME message as the list (no extra trip)', () => {
  const src = fs.readFileSync(path.join(API, 'routes', 'definitions.js'), 'utf8');
  assert.ok(/at\.net = stmts\.push\(/.test(src), 'the release state is not read in the batch');
  assert.ok(/stampReleases\(rows, res\[at\.net\]/.test(src), 'the list is not stamped');
});

(async () => {
  console.log('\nnetwork offers · the member storefront and its checkout');
  for (const [name, fn] of tests) {
    try { await fn(); console.log('  ok  ' + name); pass++; }
    catch (e) { console.log('  FAIL ' + name + '\n      ' + e.message); fail++; }
  }
  console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' : '✓ ') + pass + ' passed · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})();
