'use strict';
// @type: system
/**
 * tests/crossing/scenarios/reverse.cjs — R23-R30 of the walk: the reverse direction, AU buys and IN sells (the seller's currency is INR, so the rupee shows on the Australian screen).
 * OWNS      R23 seller standing facts · R24 add by address (no duplicate stub) · R25 the remote catalogue in INR · R26 an order that STATES no currency (known gap) · R27 the order that states it
 *           · R28 rounds (seller prices, buyer counters in text, seller re-prices, buyer accepts, byte-identical) · R29 reject · R30 status from the Indian seller
 * CALLED BY scenarios/index.cjs
 * FLOW      same steps as rounds.cjs, with the roles swapped by the topology binding (pair au_buys_in)
 */
const flow = require('../lib/flow.cjs');
const db = require('../lib/db.cjs');
const rounds = require('./rounds.cjs').steps;
const { waitFor } = require('../lib/compare.cjs');

const R23 = {
  id: 'R23', title: 'the Indian seller: exporter, public price list, INR', requires: [],
  async run(ctx, rec) {
    const a = await flow.actors(ctx, 'R23');
    const state = await flow.shopState(ctx, a.sk);
    rec.check(state && state.trade_mode === 'export', 'trade_mode export (Selling abroad)', JSON.stringify(state));
    rec.check(state && state.catalogue_visibility === 'public', 'the price list is public', JSON.stringify(state));
    rec.check(state && state.currency_code === a.pair.seller.currency, 'money is ' + a.pair.seller.currency, JSON.stringify(state));
  }
};

const R24 = {
  id: 'R24', title: 'the buyer adds the Indian seller by address; one stub, no duplicate', requires: [],
  async run(ctx, rec) {
    const a = await flow.actors(ctx, 'R24');
    const { add, stub } = await flow.addSupplier(ctx, a.bk, a.sk);
    rec.check(add.status === 200 || add.status === 409, 'accepted or already there (HTTP ' + add.status + ')', JSON.stringify(add.body).slice(0, 200));
    rec.check(stub && stub.supplier_entity_id, 'the seller is in the list', 'missing');
    const rows = await ctx.q(a.pair.buyer.installation, 'SELECT count(*)::int AS n FROM supplier_list sl JOIN identities i ON i.identity_id = sl.supplier_entity_id WHERE i.bridge_id = ' + db.lit(a.pair.seller.bridge_id) + ' AND sl.owner_entity_id = ' + db.uuid(await ctx.entityId(a.bk)));
    rec.check(rows[0].n === 1, 'exactly one supplier_list row for them (' + rows[0].n + ')', 'rows ' + rows[0].n);
  }
};

const R25 = {
  id: 'R25', title: 'the buyer\'s screen reads the price list in rupees', requires: [],
  async run(ctx, rec) {
    const a = await flow.actors(ctx, 'R25');
    const { stub } = await flow.addSupplier(ctx, a.bk, a.sk);
    if (!rec.check(stub, 'the seller is in the list', 'missing')) return;
    const cat = await flow.catalogue(a.buyer, stub.supplier_entity_id);
    rec.check(cat.status === 200 && cat.items.length > 0, 'items listed (' + cat.items.length + ')', JSON.stringify(cat.remote || {}));
    rec.check(cat.currency === a.pair.seller.currency, 'the catalogue states ' + a.pair.seller.currency, 'got ' + cat.currency);
    const item = flow.pickItem(cat.items, a.pair.seller.fixture && a.pair.seller.fixture.item_match);
    rec.check(item && (item.item_data || {}).currency === a.pair.seller.currency && flow.priceOf(item) > 0, 'the item is priced in ' + a.pair.seller.currency + ' (' + (item && flow.nameOf(item)) + ' ' + (item && flow.priceOf(item)) + ')', JSON.stringify(item && item.item_data));
  }
};

const R26 = {
  id: 'R26', title: 'an order that states NO currency (an api client, not the screen): the seller\'s money must still win', requires: [],
  async run(ctx, rec) {
    const a = await flow.actors(ctx, 'R26');
    const { stub } = await flow.addSupplier(ctx, a.bk, a.sk);
    const cat = await flow.catalogue(a.buyer, stub.supplier_entity_id);
    const item = flow.pickItem(cat.items, a.pair.seller.fixture && a.pair.seller.fixture.item_match) || cat.items[0];
    if (!rec.check(item, 'there is an item to order', 'empty catalogue')) return;
    const sent = await a.buyer.send(flow.orderBody(ctx, stub, a.pair.seller, item, 1, { currency: null, subject: 'R26 no currency stated', ref: 'R26' }));
    rec.check(sent.ok && sent.body.chit_id, 'the order is sent (HTTP ' + sent.status + ')', JSON.stringify(sent.body).slice(0, 200));
    if (!sent.body.chit_id) return;
    const mine = await flow.copy(ctx, a.bk, sent.body.chit_id);
    const stored = mine && mine.business_json && mine.business_json.currency;
    rec.note('stored currency with nothing stated: ' + stored);
    /* api sellerMoney (rail f6ddcabd): a remote seller's stub holds NULL money, so with nothing stated the SENDER's money is used. The screen always states it (UX-121), so this is
       only an api client's hole. KNOWN until the seller's currency is asked of the far side at send. */
    rec.known('W24', stored === a.pair.seller.currency, 'a remote-seller order with no stated currency is filed in the SELLER\'s money (today: the sender\'s)');
  }
};

const R27 = {
  id: 'R27', title: 'the order that states the cart\'s currency is filed in INR on both copies, as a quotation', requires: [],
  async run(ctx, rec) {
    const placed = await rounds.placeOrder(ctx, rec, 'R27', 20, { subject: 'R27 reverse RFQ 20 units' });
    if (!placed) return;
    ctx.state.rev = placed;
    const a = await flow.actors(ctx, 'R27');
    const pair = await flow.bothCopies(ctx, placed.chit_id, a.bk, a.sk);
    for (const side of ['buyer', 'seller']) {
      const bj = (pair[side] && pair[side].business_json) || {};
      const j = bj.jurisdiction || {};
      rec.check(bj.currency === a.pair.seller.currency, side + ' copy: currency ' + a.pair.seller.currency + ' (not the sender\'s ' + a.pair.buyer.currency + ')', 'currency ' + bj.currency);
      rec.check(j.document === 'quotation' && j.buyer_installation === a.pair.buyer.installation && j.seller_installation === a.pair.seller.installation, side + ' copy: quotation, buyer ' + a.pair.buyer.installation + ', seller ' + a.pair.seller.installation, JSON.stringify(j));
    }
    const money = pair.seller && pair.seller.summary_json && pair.seller.summary_json.money;
    rec.check(money && money.currency_code === a.pair.seller.currency && flow.num(money.net) === 20 * flow.priceOf(placed.item), 'net is 20 x the list price in ' + a.pair.seller.currency, JSON.stringify(money));
  }
};

const R28 = {
  id: 'R28', title: 'rounds, seller Indian: price 620 x 20, counter 25 at "600" (text), re-price 600 x 25, accept: byte-identical', requires: ['R27'],
  async run(ctx, rec) {
    const a = await flow.actors(ctx, 'R28');
    const chitId = ctx.state.rev.chit_id;
    const r2 = await rounds.sellerQuotes(ctx, rec, a, chitId, 620, 20, 'R28 round 2');
    if (!r2.proposal_id) return;
    rec.check(flow.num(r2.money && r2.money.net) === 12400, 'round 2 net is 12,400', JSON.stringify(r2.money));
    await rounds.sameProposalBothSides(ctx, rec, a, chitId, r2.proposal_id, 'R28 round 2');
    const r3 = await rounds.buyerCounters(ctx, rec, a, chitId, r2.proposal_id, 25, a.pair.seller.currency + ' 600', 'R28 round 3');
    if (!r3.proposal_id) return;
    await flow.waitProposals(ctx, a.sk, chitId, (rows) => rows.some((r) => r.proposal_id === r3.proposal_id));
    const r4 = await rounds.sellerQuotes(ctx, rec, a, chitId, 600, 25, 'R28 round 4');
    if (!r4.proposal_id) return;
    rec.check(flow.num(r4.money && r4.money.net) === 15000, 'round 4 net is 15,000', JSON.stringify(r4.money));
    await rounds.sameProposalBothSides(ctx, rec, a, chitId, r4.proposal_id, 'R28 round 4');
    const ok = await rounds.buyerAccepts(ctx, rec, a, chitId, r4.proposal_id, 'R28');
    if (ok.ok) await rounds.identicalOnBothSides(ctx, rec, a, chitId, r4.proposal_id, { currency: a.pair.seller.currency, total: 15000 }, 'R28');
  }
};

const R29 = {
  id: 'R29', title: 'reject: the seller prices, the buyer rejects; both rejected, the chit is unchanged', requires: [],
  async run(ctx, rec) {
    const placed = await rounds.placeOrder(ctx, rec, 'R29', 20, { subject: 'R29 reject' });
    if (!placed) return;
    const a = await flow.actors(ctx, 'R29');
    const before = await flow.copy(ctx, a.sk, placed.chit_id);
    const quote = await rounds.sellerQuotes(ctx, rec, a, placed.chit_id, 650, 20, 'R29');
    if (!quote.proposal_id) return;
    await rounds.sameProposalBothSides(ctx, rec, a, placed.chit_id, quote.proposal_id, 'R29');
    const out = await a.buyer.post('/api/chits/' + placed.chit_id + '/proposals/' + quote.proposal_id + '/reject', { note: ctx.tag + ' R29 no thanks' });
    rec.check(out.ok, 'the buyer rejects (HTTP ' + out.status + ')', JSON.stringify(out.body).slice(0, 200));
    const both = await waitFor(async () => {
      const [x, y] = [await flow.proposals(ctx, a.sk, placed.chit_id), await flow.proposals(ctx, a.bk, placed.chit_id)];
      const rx = x.find((r) => r.proposal_id === quote.proposal_id);
      const ry = y.find((r) => r.proposal_id === quote.proposal_id);
      return rx && ry && rx.status === 'rejected' && ry.status === 'rejected';
    }, { timeoutMs: ctx.topo.waits.crossMs, everyMs: ctx.topo.waits.everyMs });
    rec.check(both.ok, 'rejected on both installations (' + both.waitedMs + ' ms)', 'one side still open');
    const after = await flow.copy(ctx, a.sk, placed.chit_id);
    rec.check(before && after && (after.business_json.jurisdiction || {}).document === 'quotation' && before.money_md5 === after.money_md5, 'the chit is unchanged: still a quotation, same header money', JSON.stringify({ before: before && before.money_md5, after: after && after.money_md5 }));
  }
};

const R30 = {
  id: 'R30', title: 'status from the Indian seller reaches the Australian buyer', requires: ['R27'],
  async run(ctx, rec) {
    const a = await flow.actors(ctx, 'R30');
    const { chit_id, stub } = ctx.state.rev;
    const moved = await a.seller.put('/api/chits/' + chit_id + '/status', { status: 'in_progress', note: ctx.tag + ' R30' });
    rec.check(moved.ok, 'the seller moves the status (HTTP ' + moved.status + ')', JSON.stringify(moved.body).slice(0, 200));
    const seen = await waitFor(async () => (await flow.statusAt(ctx, a.pair.buyer.installation, stub.supplier_entity_id, chit_id)) === 'in_progress', { timeoutMs: ctx.topo.waits.crossMs, everyMs: ctx.topo.waits.everyMs });
    rec.check(seen.ok, 'the buyer\'s installation shows in_progress (' + seen.waitedMs + ' ms)', 'never arrived');
  }
};

module.exports = { scenarios: [R23, R24, R25, R26, R27, R28, R29, R30] };
