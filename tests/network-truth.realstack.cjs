'use strict';
/**
 * tests/network-truth.realstack.cjs — NETWORK TRUTH, on the LOCAL stack (K-TRUTH-1 2026-10-19; case list: PM/BOX-TRUTH-TESTS.md §12 "Network").
 *
 * NET-3. Principles: nodes and edges · a brand reads what was transacted, never a member's OWNED data (customers, costs) · both ends of an edge
 * see the same edge · a BOM on a node, with consumes on, moves its components when it sells (VB3, shared with stock).
 * NW-04 member B's own customer and cost are not in anything the brand A reads (member view, network catalogue, shop card, place) ·
 * NW-06 an invitation accepted: the asker cannot approve its own ask, then the edge is active and both sides read the same edge id ·
 * NW-07 a BOM item sells: the component moves (the consumes primitive is not built — VB3).
 * Already covered over stand-ins and not repeated here: NW-01/02/03/05/08 (the files named in the case list).
 * Setup: a business becomes a network node the first time it takes part (src/routes/network.js actorOf ensure), so the store makes one failed ask
 * (that is enough to ensure its node), then the brand invites it by bridge id as a `commercial` edge and the store accepts.
 * A `gap:` FAIL is a RECORDED finding (NETWORK-BACKLOG "K-TRUTH-1 2026-10-19"), never fixed here. LOCAL ONLY; the database is only read.
 * Break-tested 2026-10-19: each passing case was run once with its expectation flipped and went red.
 * Run: node tests/network-truth.realstack.cjs   (one realstack file at a time on :3100)
 * CARD 04-network/README
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { DB, j, ok, pause, kase, expect, near, bill, receipt, freshShop, finish } = H;
const RUN = 'nt' + (Date.now() % 1e10).toString(36);
const COST = 31.7311, CUSTOMER = 'Zorbax Ownedcustomer', PHONE = '9876511177';
let pg = null;

/** B makes itself a node (a failed ask does it), then A invites B. Returns the edge as the invitation made it. */
async function joinNetwork(A, B) {
  await j('/api/network/connections', { method: 'POST', token: B.token, body: { childBridgeId: A.bridge, type: 'commercial' } });
  return ok(await j('/api/network/connections', { method: 'POST', token: A.token, body: { childBridgeId: B.bridge, type: 'commercial' } }), 'invite').b;
}
const memberRow = (view, edgeId) => ((view.brand || {}).members || []).find((m) => m.edge_id === edgeId);
const storeRow = (view, edgeId) => (((view.store || {}).networks) || []).find((n) => (n.membership || {}).edge_id === edgeId);
const offers = async (shop) => (await j('/api/network-offers', { token: shop.token })).b;

(async () => {
  console.log('\n── network truth on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  pg = new Client({ connectionString: DB }); await pg.connect();
  try {
    const A = await freshShop(RUN + 'a', 'Brand'), B = await freshShop(RUN + 'b', 'Store');
    const edge = await joinNetwork(A, B);

    await kase('NW-06', 'an invitation accepted: the asker cannot approve its own ask; once the store accepts, the edge is active and BOTH sides read the same edge', async () => {
      const self = await j('/api/network/connections/' + edge.id + '/approve', { method: 'POST', token: A.token });
      const aWait = memberRow(await offers(A), edge.id), bWait = storeRow(await offers(B), edge.id);
      const acc = ok(await j('/api/network/connections/' + edge.id + '/approve', { method: 'POST', token: B.token }), 'accept').b;
      const aIn = memberRow(await offers(A), edge.id), bIn = storeRow(await offers(B), edge.id);
      expect(self.status === 403 && self.b.code === 'NOT_ALLOWED', 'the brand approving its own invitation answered ' + self.status + ' ' + JSON.stringify(self.b));
      expect(aWait && aWait.state === 'requested' && bWait && bWait.membership.state === 'invited', 'while waiting: brand sees ' + (aWait && aWait.state) + ', store sees ' + (bWait && bWait.membership.state));
      expect(acc.state === 'active' && aIn && aIn.state === 'active' && bIn && bIn.membership.state === 'active', 'after accept: edge ' + acc.state + ' · brand sees ' + (aIn && aIn.state) + ' · store sees ' + (bIn && bIn.membership.state));
    });

    await kase('NW-04', 'member B\'s OWN customer (name, phone) and its item cost are in nothing the brand reads: member view, network catalogue, the shop card, the place', async () => {
      const r = ok(await j('/api/products', { method: 'POST', token: B.token, body: { item_data: { name: 'Owned cost item', unit: 'piece', price: 99, cost: COST } } }), 'product').b;
      const lead = ok(await j('/api/crm/leads', { method: 'POST', token: B.token, body: { name: CUSTOMER, phone: PHONE } }), 'lead').b.party;
      const b = bill(RUN + '-n', [[{ id: r.item.item_id, name: 'Owned cost item', unit: 'piece', price: 99 }, 1]]);
      b.business_json.customer = { name: lead.display_name, party_id: lead.party_id };
      ok(await j('/api/chits/send', { method: 'POST', token: B.token, body: b }), 'bill');
      await pause(1500);
      const views = {
        memberView: await offers(A),
        networkCatalogue: (await j('/api/catalogue/network/' + A.bridge, { token: A.token })).b,
        shopCard: (await j('/api/catalogue/' + B.bridge, { token: A.token })).b,
        place: (await j('/api/network/place?bridgeId=' + A.bridge, { token: A.token })).b,
      };
      /* the premise: B itself holds the cost and the customer, and the brand's view does reach B (a vacuous pass would prove nothing) */
      const own = JSON.stringify((await j('/api/products', { token: B.token })).b), crm = JSON.stringify((await j('/api/crm/parties', { token: B.token })).b);
      const reached = JSON.stringify(views.memberView).includes('Store ' + RUN + 'b');
      expect(own.includes('31.7311') && crm.includes('Zorbax') && reached, 'premise: B holds cost ' + own.includes('31.7311') + ', customer ' + crm.includes('Zorbax') + ', the brand reads B ' + reached);
      const leaks = Object.entries(views).filter(([, v]) => { const s = JSON.stringify(v); return s.includes('Zorbax') || s.includes(PHONE) || s.includes('31.7311'); }).map(([k]) => k);
      expect(leaks.length === 0, 'B\'s owned data appears in what the brand reads: ' + leaks.join(', '));
    });

    await kase('NW-07', 'a BOM item sold posts component movements (the component\'s stock falls by qty x recipe)', async () => {
      const comp = ok(await j('/api/products', { method: 'POST', token: A.token, body: { item_data: { name: 'Flour comp', unit: 'piece', price: 5 } } }), 'component').b;
      const C = { id: comp.item.item_id, name: 'Flour comp', unit: 'piece', price: 5 };
      const made = ok(await j('/api/products', { method: 'POST', token: A.token, body: { item_data: { name: 'Bread made', unit: 'piece', price: 40, bom: [{ item_id: C.id, qty: 2 }] } } }), 'made item').b;
      ok(await j('/api/chits/send', { method: 'POST', token: A.token, body: receipt(RUN + '-r', [[C, 10, 3]]) }), 'receive component');
      ok(await j('/api/chits/send', { method: 'POST', token: A.token, body: bill(RUN + '-s', [[{ id: made.item.item_id, name: 'Bread made', unit: 'piece', price: 40 }, 3]]) }), 'sell');
      await pause(2500);
      const rows = (await pg.query('SELECT reason, qty::float AS qty FROM stock_movement WHERE entity_id = $1 AND item_id = $2', [A.entity, C.id])).rows;
      const left = rows.reduce((a, x) => a + x.qty, 0);
      expect(near(left, 4), 'component movements ' + JSON.stringify(rows) + ' — expected 10 received minus 3 sold x 2 = 4 left');
    }, 'VB3: no consumes primitive; a sale of a BOM item moves only the item itself (BACKLOG:2636)');
  } finally { await pg.end(); }
  finish('network-truth', process.env.NETWORK_TRUTH_JSON, { run: RUN });
})().catch((e) => { console.error('network truth could not run:', e && e.message); process.exit(2); });
