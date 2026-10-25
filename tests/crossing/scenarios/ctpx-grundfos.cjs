'use strict';
// @type: system
/**
 * tests/crossing/scenarios/ctpx-grundfos.cjs — G1-G4 of the walk: Grundfos on its own installation (several currencies on ONE installation) and across installations.
 * OWNS      G1 add by User ID + the HUF catalogue · G2 the same-installation cart order stays domestic · G3 RFQ by choice (amend becomes a request round; domestic amend stays direct) · G4 AUD buyer <-> DKK exporter across installations
 * CALLED BY scenarios/ctpx-registry.cjs
 * FLOW      same steps as ctpx-rounds.cjs; the DATABASE on each installation is the judge (deal_type, jurisdiction, chit_proposal count, invoice md5, ctp queue)
 * DECISIONS 25 Oct 14:10: a same-installation chit is domestic unless composed as deal_type 'rfq'; only an international deal or an rfq chit has rounds, quotation / jurisdiction fields and the status/dispute bells.
 */
const flow = require('../lib/flow.cjs');
const rounds = require('./ctpx-rounds.cjs').steps;
const { sameDigest } = require('../lib/compare.cjs');

const G1 = {
  id: 'G1', title: 'plant (INR) adds the HUF supplier by User ID; its catalogue is in HUF', requires: [],
  async run(ctx, rec) {
    const a = await flow.actors(ctx, 'G1');
    const { add, stub } = await flow.addSupplier(ctx, a.bk, a.sk);
    rec.check(add.status === 200 || add.status === 409, 'added by User ID or already there (HTTP ' + add.status + ')', JSON.stringify(add.body).slice(0, 200));
    if (!rec.check(stub && stub.supplier_entity_id, 'the supplier is in the list', 'missing')) return;
    const cat = await flow.catalogue(a.buyer, stub.supplier_entity_id);
    rec.check(cat.items.length > 0, 'the catalogue lists items (' + cat.items.length + ')', JSON.stringify(cat.remote || {}));
    const item = flow.pickItem(cat.items, a.pair.seller.fixture && a.pair.seller.fixture.item_match);
    rec.check(item && (item.item_data || {}).currency === a.pair.seller.currency && flow.priceOf(item) === 45000, 'GC-80 is HUF 45,000 (G1b)', JSON.stringify(item && item.item_data));
    ctx.state.g1 = { stub, item };
  }
};

const G2 = {
  id: 'G2', title: 'same-installation cart order stays domestic: HUF both copies, no deal_type, no jurisdiction, no proposal rows', requires: ['G1'],
  async run(ctx, rec) {
    const placed = await rounds.placeOrder(ctx, rec, 'G2', 2, { subject: 'G2 domestic cart order' });
    if (!placed) return;
    ctx.state.g2 = placed;
    const a = await flow.actors(ctx, 'G2');
    const pair = await flow.bothCopies(ctx, placed.chit_id, a.bk, a.sk);
    for (const side of ['buyer', 'seller']) {
      const c = pair[side];
      const bj = (c && c.business_json) || {};
      const money = (c && c.summary_json && c.summary_json.money) || {};
      rec.check(bj.currency === 'HUF' && money.currency_code === 'HUF', side + ' copy: HUF in business_json and header money', JSON.stringify({ cur: bj.currency, money: money.currency_code }));
      rec.check(flow.num(money.total) === 90000 || flow.num(money.net) === 90000, side + ' copy: 90,000', JSON.stringify(money));
      rec.check(bj.deal_type === undefined && bj.jurisdiction === undefined, side + ' copy: no deal_type, no jurisdiction', JSON.stringify({ d: bj.deal_type, j: bj.jurisdiction }));
      rec.check((await flow.proposals(ctx, side === 'buyer' ? a.bk : a.sk, placed.chit_id)).length === 0, side + ' copy: 0 chit_proposal rows', 'proposal rows exist');
    }
  }
};

const G3 = {
  id: 'G3', title: 'RFQ by choice: /amend becomes a request round, the seller counters, accept copies the invoice; domestic /amend stays direct', requires: ['G2'],
  async run(ctx, rec) {
    const a = await flow.actors(ctx, 'G3');
    const placed = await rounds.placeOrder(ctx, rec, 'G3', 10, { dealType: 'rfq', subject: 'G3 rfq by choice' });
    if (!placed) return;
    const chitId = placed.chit_id;
    const pair = await flow.bothCopies(ctx, chitId, a.bk, a.sk);
    rec.check(pair.buyer && pair.seller && pair.buyer.business_json.deal_type === 'rfq' && pair.seller.business_json.deal_type === 'rfq', 'G3a: deal_type rfq on both copies', JSON.stringify(pair.buyer && pair.buyer.business_json.deal_type));
    rec.check(pair.buyer && !pair.buyer.business_json.jurisdiction && flow.num(pair.buyer.summary_json.money.net) === 450000, 'G3a: HUF 450,000 and no jurisdiction (same installation)', JSON.stringify(pair.buyer && pair.buyer.summary_json.money));
    const edit = [{ line_index: 0, line: { quantity: 10, price: 40000 }, reason_code: 'quantity' }];
    const amended = await a.buyer.post('/api/chits/' + chitId + '/amend', { edits: edit });
    rec.check(amended.ok && amended.body.proposed === true && amended.body.proposal && amended.body.proposal.kind === 'request', 'G3: the buyer\'s /amend becomes a request round (HTTP ' + amended.status + ')', JSON.stringify(amended.body).slice(0, 240));
    const req = amended.body.proposal || {};
    for (const key of [a.bk, a.sk]) {
      const rows = await flow.proposals(ctx, key, chitId);
      const row = rows.find((r) => r.proposal_id === req.proposal_id);
      rec.check(row && row.round === 2 && row.kind === 'request' && row.money === null, 'G3: round 2 request, money null on ' + key, JSON.stringify(rows));
    }
    const quote = await rounds.sellerQuotes(ctx, rec, a, chitId, 42000, 10, 'G3c');
    if (!quote.proposal_id) return;
    rec.check(quote.round === 3 && quote.kind === 'pro_forma' && flow.num(quote.money && quote.money.net) === 420000, 'G3c: round 3 pro_forma HUF 420,000 (seller-computed)', JSON.stringify(quote));
    rec.check((await flow.queueOut(ctx, a.sk, chitId)).length === 0, 'G3c: nothing queued for the far side (same installation)', 'queue rows exist');
    const r2 = (await flow.proposals(ctx, a.bk, chitId)).find((r) => r.proposal_id === req.proposal_id);
    const s2 = (await flow.proposals(ctx, a.sk, chitId)).find((r) => r.proposal_id === req.proposal_id);
    rec.check(r2 && s2 && r2.status === s2.status && r2.status !== 'proposed', 'G3c: round 2 closed the same way on both copies (' + (r2 && r2.status) + ')', JSON.stringify({ r2, s2 }));
    const accepted = await rounds.buyerAccepts(ctx, rec, a, chitId, quote.proposal_id, 'G3d');
    if (!accepted.ok) return;
    const done = await flow.bothCopies(ctx, chitId, a.bk, a.sk);
    const prop = (await flow.proposals(ctx, a.sk, chitId)).find((r) => r.proposal_id === quote.proposal_id);
    rec.check(done.buyer && done.seller && flow.num(done.buyer.summary_json.money.total) === 420000 && flow.num(done.seller.summary_json.money.total) === 420000, 'G3d: both copies total HUF 420,000', JSON.stringify(done.buyer && done.buyer.summary_json.money));
    rec.check(done.buyer && done.seller && prop && sameDigest(done.buyer.invoice_md5, done.seller.invoice_md5, prop.invoice_md5), 'G3d: invoice md5 on both copies equals the proposal\'s', JSON.stringify({ b: done.buyer && done.buyer.invoice_md5, p: prop && prop.invoice_md5 }));
    /* G3b: the contrast - the same /amend on the plain G2 order is a DIRECT amendment, no proposal */
    const plain = ctx.state.g2;
    if (!plain) return;
    const direct = await a.buyer.post('/api/chits/' + plain.chit_id + '/amend', { edits: [{ line_index: 0, line: { quantity: 1 }, reason_code: 'quantity' }] });
    rec.check(direct.ok && !direct.body.proposed, 'G3b: a domestic /amend is a direct amendment (HTTP ' + direct.status + ')', JSON.stringify(direct.body).slice(0, 240));
    rec.check((await flow.proposals(ctx, a.bk, plain.chit_id)).length === 0, 'G3b: still 0 proposal rows', 'a proposal was written');
    rec.known('W-amend-reason', direct.ok && Array.isArray(direct.body.amendments) && direct.body.amendments.every((x) => x.reason_code === 'quantity'), 'reason_code quantity is kept (walk: it was filed as other)');
  }
};

const G4 = {
  id: 'G4', title: 'AUD buyer to the DKK exporter across installations: search lists only exporters, DKK catalogue, quotation, pro-forma crosses, accept is byte-identical', requires: [],
  extra: ['grund-hu', 'grund-plant'],
  async run(ctx, rec) {
    const a = await flow.actors(ctx, 'G4');
    const where = flow.dbKeyOf(ctx, a.pair.seller.installation);
    const found = await a.buyer.get('/api/entities/search?q=Grundfos&where=' + encodeURIComponent(where));
    const names = (found.body.results || []).map((r) => r.bridge_id);
    rec.check(found.ok && names.includes(a.pair.seller.bridge_id), 'G4b: search "Grundfos" on ' + where + ' lists the exporter HQ', JSON.stringify((found.body.results || []).map((r) => r.display_name)));
    for (const other of ['grund-hu', 'grund-plant']) {
      rec.check(!names.includes(ctx.topo.shops[other].bridge_id), 'G4b: ' + ctx.topo.shops[other].user_id + ' (not an exporter) is not listed', 'listed');
    }
    const placed = await rounds.placeOrder(ctx, rec, 'G4', 3, { subject: 'G4 DKK order' });
    if (!placed) return;
    rec.check(placed.cat.currency === 'DKK' && flow.priceOf(placed.item) === 8500, 'G4c: the catalogue states DKK 8,500', JSON.stringify({ cur: placed.cat.currency, price: flow.priceOf(placed.item) }));
    const chitId = placed.chit_id;
    const pair = await flow.bothCopies(ctx, chitId, a.bk, a.sk);
    for (const side of ['buyer', 'seller']) {
      const bj = (pair[side] && pair[side].business_json) || {};
      const money = (pair[side] && pair[side].summary_json && pair[side].summary_json.money) || {};
      const j = bj.jurisdiction || {};
      rec.check(bj.currency === 'DKK' && flow.num(money.net) === 25500 && money.provisional === true && (money.total === null || money.total === undefined), 'G4d ' + side + ': DKK, net 25,500, provisional, total not decided', JSON.stringify(money));
      rec.check(j.document === 'quotation' && j.buyer_installation === flow.dbKeyOf(ctx, a.pair.buyer.installation) && j.seller_installation === flow.dbKeyOf(ctx, a.pair.seller.installation) && j.buyer_duty_and_taxes === 'not_included', 'G4d ' + side + ': jurisdiction quotation, both installations, duty not included', JSON.stringify(j));
    }
    const quote = await rounds.sellerQuotes(ctx, rec, a, chitId, 8200, 3, 'G4e');
    if (!quote.proposal_id) return;
    rec.check(flow.num(quote.money && quote.money.net) === 24600, 'G4e: seller-computed 3 x 8,200 = 24,600', JSON.stringify(quote.money));
    await rounds.sameProposalBothSides(ctx, rec, a, chitId, quote.proposal_id, 'G4e');
    const out = await rounds.buyerAccepts(ctx, rec, a, chitId, quote.proposal_id, 'G4f');
    if (!out.ok) return;
    await rounds.identicalOnBothSides(ctx, rec, a, chitId, quote.proposal_id, { currency: 'DKK', total: 24600 }, 'G4f');
    const accepted = (await flow.proposals(ctx, a.bk, chitId)).find((r) => r.proposal_id === quote.proposal_id);
    rec.check(accepted && accepted.status === 'accepted', 'G4f: the proposal is accepted on the buyer\'s installation', JSON.stringify(accepted));
    const header = await flow.copy(ctx, a.bk, chitId);
    rec.check(header && header.summary_json.money.provisional === false, 'G4f: money no longer provisional', JSON.stringify(header && header.summary_json.money));
  }
};

module.exports = { scenarios: [G1, G2, G3, G4] };
