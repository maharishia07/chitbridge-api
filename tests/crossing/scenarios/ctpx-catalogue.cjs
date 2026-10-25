'use strict';
// @type: system
/**
 * tests/crossing/scenarios/ctpx-catalogue.cjs — R12-R15 of the walk: window-shopping across installations, the export opt-in, and the refusal for a shop that sells only at home.
 * OWNS      R12 (a shop that does not sell outside is hidden from another installation's search - the replayable form of "hidden before the opt-in") · R13 (the opt-in state matches the topology)
 *           · R14 (the buyer reads the remote catalogue in the SELLER's currency) · R15 (SUPPLIER_SELLS_ONLY_HERE for a home-only shop)
 * CALLED BY scenarios/ctpx-registry.cjs
 * FLOW      API as a shop → the database's own facts (entity_profile.trade_mode, supplier_list) → compare
 * Variants: the walk's R12 and R15 used Sydney BEFORE it opted in / Chennai while domestic; both are exporters now and the pack never switches a shop back, so the same rules are replayed with the one
 * shop that is public but NOT an exporter (qa-grund-sup-hu). The browser spec covers the Save -> confirm popup of the opt-in itself (R13).
 */
const flow = require('../lib/flow.cjs');
const db = require('../lib/db.cjs');

const R12 = {
  id: 'R12', title: 'variant: search on another installation hides a shop that does not sell outside', requires: [],
  async run(ctx, rec) {
    const a = await flow.actors(ctx, 'R12');
    const hu = a.pair.seller;
    const where = flow.dbKeyOf(ctx, hu.installation);
    const found = await a.buyer.get('/api/entities/search?q=' + encodeURIComponent('QA Pump Castings') + '&where=' + encodeURIComponent(where));
    rec.check(found.ok, 'the remote search answers (HTTP ' + found.status + ')', JSON.stringify(found.body).slice(0, 200));
    const results = found.body.results || [];
    rec.check(!results.some((r) => r.bridge_id === hu.bridge_id), hu.user_id + ' (public, not an exporter) is NOT listed', 'listed: ' + JSON.stringify(results.map((r) => r.display_name)));
    const state = await flow.shopState(ctx, hu.key);
    rec.check(state && state.trade_mode !== 'export' && state.catalogue_visibility === 'public', 'premise: it is public and not an exporter', JSON.stringify(state));
  }
};

const R13 = {
  id: 'R13', title: 'the opt-in is on for every exporter in the topology, off for the rest', requires: [],
  async run(ctx, rec) {
    const a = await flow.actors(ctx, 'R13');
    for (const shop of [a.pair.seller, a.pair.buyer]) {
      const state = await flow.shopState(ctx, shop.key);
      const want = shop.exporter ? 'export' : 'domestic';
      rec.check(state && state.trade_mode === want, shop.user_id + ' trade_mode is ' + want + ' (Selling abroad)', JSON.stringify(state));
    }
  }
};

const R14 = {
  id: 'R14', title: 'buyer opens the remote catalogue: items in the SELLER\'s currency', requires: [],
  async run(ctx, rec) {
    const a = await flow.actors(ctx, 'R14');
    const { add, stub } = await flow.addSupplier(ctx, a.bk, a.sk);
    rec.check(add.status === 200 || add.status === 409, 'add by address is accepted or already there (HTTP ' + add.status + ')', JSON.stringify(add.body).slice(0, 200));
    if (!rec.check(stub && stub.supplier_entity_id, 'the seller is in the list', 'not in my supplier list')) return;
    const cat = await flow.catalogue(a.buyer, stub.supplier_entity_id);
    rec.check(cat.status === 200 && cat.items.length > 0, 'the catalogue answers with items (' + cat.items.length + ')', JSON.stringify(cat.remote || cat.body).slice(0, 200));
    rec.check(cat.currency === a.pair.seller.currency, 'the catalogue currency is the seller\'s ' + a.pair.seller.currency, 'got ' + cat.currency);
    const item = flow.pickItem(cat.items, a.pair.seller.fixture && a.pair.seller.fixture.item_match);
    rec.check(item && (item.item_data || {}).currency === a.pair.seller.currency, 'an item is priced in ' + a.pair.seller.currency + ' (' + (item && flow.nameOf(item)) + ')', JSON.stringify(item && item.item_data));
    ctx.state.cat = ctx.state.cat || {};
    ctx.state.cat[a.pair.name] = { stub, item };
  }
};

const R15 = {
  id: 'R15', title: 'variant: adding a shop that sells only on its own ChitBridge is refused in words', requires: [],
  async run(ctx, rec) {
    const a = await flow.actors(ctx, 'R15');
    const added = await flow.addSupplier(ctx, a.bk, a.sk);
    rec.check(added.add.status === 409, 'refused with HTTP 409 (got ' + added.add.status + ')', JSON.stringify(added.add.body).slice(0, 200));
    rec.check(added.add.body.code === 'SUPPLIER_SELLS_ONLY_HERE', 'the code is SUPPLIER_SELLS_ONLY_HERE', 'code ' + added.add.body.code);
    const said = JSON.stringify(added.add.body);
    rec.check(/sells only on their own ChitBridge, so they cannot be your supplier from here/.test(said), 'the sentence names the reason', said.slice(0, 200));
    const rows = await ctx.q(a.pair.buyer.installation, 'SELECT count(*)::int AS n FROM supplier_list sl JOIN identities i ON i.identity_id = sl.supplier_entity_id WHERE i.bridge_id = ' + db.lit(a.pair.seller.bridge_id));
    rec.check(rows[0].n === 0, 'no supplier_list row was written on ' + a.pair.buyer.installation, 'rows ' + rows[0].n);
  }
};

module.exports = { scenarios: [R12, R13, R14, R15] };
