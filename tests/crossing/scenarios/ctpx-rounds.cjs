'use strict';
// @type: system
/**
 * tests/crossing/scenarios/ctpx-rounds.cjs — R16-R22 of the walk: an RFQ across installations, round by round (IN buys, AU sells), and the step functions the reverse direction (R28) and Grundfos (G3, G4) reuse.
 * OWNS      the order step (quotation + jurisdiction + seller currency) · sellerQuotes · buyerCounters · buyerAccepts · identicalOnBothSides · the terms round
 * CALLED BY scenarios/ctpx-registry.cjs · scenarios/ctpx-reverse.cjs · scenarios/ctpx-grundfos.cjs
 * FLOW      /api/chits/send -> /proposals (+ /counter, /accept, /reject) -> read both installations' chit_header + chit_proposal -> compare (md5 of the invoice and of the header money, byte for byte)
 * The seller computes every price (lib/chit-proposal): a buyer's counter is a REQUEST in text, money null. These steps assert exactly that, so a regression in who computes shows here.
 */
const flow = require('../lib/flow.cjs');
const { sameDigest } = require('../lib/compare.cjs');

/** buyer orders `qty` of the seller's matching item from the remote catalogue, stating the CART's currency (what the screen does). → { chit_id, stub, item, cat } | null */
/** what was agreed, without the per-installation `at` stamp */
const agreedTerms = (c) => { const a = (c && c.business_json.agreed) || {}; return { by: a.by, round: a.round, terms: a.terms, agreed_with: a.agreed_with }; };

async function placeOrder(ctx, rec, id, qty, opts) {
  const a = await flow.actors(ctx, id);
  const { stub } = await flow.addSupplier(ctx, a.bk, a.sk);
  if (!rec.check(stub && stub.supplier_entity_id, 'the seller is in the buyer\'s list', 'not in my supplier list')) return null;
  const cat = await flow.catalogue(a.buyer, stub.supplier_entity_id);
  const item = flow.pickItem(cat.items, a.pair.seller.fixture && a.pair.seller.fixture.item_match) || cat.items[0];
  if (!rec.check(item, 'the seller\'s catalogue has an item to order (' + cat.items.length + ' items, currency ' + cat.currency + ')', JSON.stringify(cat.remote || {}))) return null;
  const o = Object.assign({ currency: cat.currency, subject: id + ' order', ref: id }, opts || {});
  const sent = await a.buyer.send(flow.orderBody(ctx, stub, a.pair.seller, item, qty, o));
  if (!rec.check(sent.ok && sent.body.chit_id, 'the order is sent (HTTP ' + sent.status + ')', JSON.stringify(sent.body).slice(0, 240))) return null;
  const arrived = await flow.waitCopy(ctx, a.sk, sent.body.chit_id);
  rec.check(arrived.ok, 'the order reaches the seller\'s installation (' + arrived.waitedMs + ' ms)', 'no seller copy');
  return arrived.ok ? { chit_id: sent.body.chit_id, stub, item, cat } : null;
}

/** the seller prices: POST /proposals with one overridden line. → the response body (and records the answer) */
async function sellerQuotes(ctx, rec, a, chitId, price, qty, label) {
  const out = await a.seller.post('/api/chits/' + chitId + '/proposals', { lines: [{ line_index: 0, price, quantity: qty }], note: ctx.tag + ' ' + label });
  rec.check(out.ok && out.body.proposal_id, label + ': the seller quotes ' + qty + ' x ' + price + ' (HTTP ' + out.status + ')', JSON.stringify(out.body).slice(0, 240));
  return out.body;
}

/** the other side holds the same proposal id with the same invoice bytes */
async function sameProposalBothSides(ctx, rec, a, chitId, proposalId, label) {
  const there = await flow.waitProposals(ctx, a.bk, chitId, (rows) => rows.some((r) => r.proposal_id === proposalId));
  rec.check(there.ok, label + ': the buyer\'s installation holds proposal ' + String(proposalId).slice(0, 8) + ' (' + there.waitedMs + ' ms)', 'never arrived');
  const mine = (await flow.proposals(ctx, a.sk, chitId)).find((r) => r.proposal_id === proposalId);
  const theirs = there.ok ? there.value.find((r) => r.proposal_id === proposalId) : null;
  rec.check(mine && theirs && sameDigest(mine.invoice_md5, theirs.invoice_md5), label + ': invoice md5 identical on both (' + (mine && String(mine.invoice_md5).slice(0, 8)) + ')', JSON.stringify({ mine: mine && mine.invoice_md5, theirs: theirs && theirs.invoice_md5 }));
  return { mine, theirs };
}

/** the buyer counters a round in text: a REQUEST, money null (never computed by the buyer) */
async function buyerCounters(ctx, rec, a, chitId, proposalId, qty, wantedText, label) {
  const out = await a.buyer.post('/api/chits/' + chitId + '/proposals/' + proposalId + '/counter', { lines: [{ line_index: 0, quantity: qty, requested_price: wantedText }], note: ctx.tag + ' ' + label });
  rec.check(out.ok && out.body.kind === 'request', label + ': the counter is kind request (HTTP ' + out.status + ', kind ' + out.body.kind + ')', JSON.stringify(out.body).slice(0, 240));
  rec.check(out.body.money === null || out.body.money === undefined, label + ': the buyer\'s counter carries NO money', JSON.stringify(out.body.money));
  return out.body;
}

/** the buyer accepts a round; returns the response */
async function buyerAccepts(ctx, rec, a, chitId, proposalId, label) {
  const out = await a.buyer.post('/api/chits/' + chitId + '/proposals/' + proposalId + '/accept', { note: ctx.tag + ' ' + label });
  rec.check(out.ok, label + ': the buyer accepts (HTTP ' + out.status + ')', JSON.stringify(out.body).slice(0, 240));
  return out;
}

/** after an accept: header money + invoice + document identical on both installations, and equal to the accepted proposal's invoice */
async function identicalOnBothSides(ctx, rec, a, chitId, proposalId, expect, label) {
  const done = await flow.waitCopyWhere(ctx, a.sk, chitId, (c) => (c.business_json.jurisdiction || {}).document === 'pro_forma');
  rec.check(done.ok, label + ': the seller\'s copy became pro_forma (' + done.waitedMs + ' ms)', 'document ' + JSON.stringify(done.value && done.value.business_json.jurisdiction));
  const pair = await flow.bothCopies(ctx, chitId, a.bk, a.sk);
  const prop = (await flow.proposals(ctx, a.sk, chitId)).find((r) => r.proposal_id === proposalId);
  rec.check(pair.buyer && pair.seller && (pair.buyer.business_json.jurisdiction || {}).document === 'pro_forma', label + ': the buyer\'s copy is pro_forma too', JSON.stringify(pair.buyer && pair.buyer.business_json.jurisdiction));
  rec.check(pair.buyer && pair.seller && sameDigest(pair.buyer.money_md5, pair.seller.money_md5), label + ': header money md5 identical', JSON.stringify({ b: pair.buyer && pair.buyer.money_md5, s: pair.seller && pair.seller.money_md5 }));
  rec.check(pair.buyer && pair.seller && prop && sameDigest(pair.buyer.invoice_md5, pair.seller.invoice_md5, prop.invoice_md5), label + ': invoice md5 identical on both AND equal to the accepted proposal', JSON.stringify({ b: pair.buyer && pair.buyer.invoice_md5, s: pair.seller && pair.seller.invoice_md5, p: prop && prop.invoice_md5 }));
  const money = pair.seller && pair.seller.summary_json && pair.seller.summary_json.money;
  rec.check(money && money.currency_code === expect.currency && flow.num(money.total) === expect.total, label + ': ' + expect.currency + ' ' + expect.total + ' on the header', JSON.stringify(money));
  const sideA = (await flow.proposals(ctx, a.bk, chitId)).map((r) => r.round + ':' + r.status).join(' ');
  const sideB = (await flow.proposals(ctx, a.sk, chitId)).map((r) => r.round + ':' + r.status).join(' ');
  rec.check(sideA === sideB && sideA.includes('accepted'), label + ': the round history is identical (' + sideB + ')', sideA + ' | ' + sideB);
}

/* ── R16-R22 ─────────────────────────────────────────────────────────────────────────────── */
const R16 = {
  id: 'R16', title: 'order from the remote catalogue in the seller\'s currency: quotation, jurisdiction, no invoice', requires: [],
  async run(ctx, rec) {
    const placed = await placeOrder(ctx, rec, 'R16', 10, { subject: 'RFQ 10 units' });
    if (!placed) return;
    ctx.state.rfq = placed;
    const a = await flow.actors(ctx, 'R16');
    const pair = await flow.bothCopies(ctx, placed.chit_id, a.bk, a.sk);
    const want = a.pair.seller.currency;
    for (const side of ['buyer', 'seller']) {
      const c = pair[side];
      const bj = (c && c.business_json) || {};
      const j = bj.jurisdiction || {};
      rec.check(c && bj.currency === want, side + ' copy: business_json.currency is ' + want + ' from the start (W24)', 'currency ' + bj.currency);
      rec.check(j.document === 'quotation', side + ' copy: jurisdiction.document is quotation', JSON.stringify(j));
      rec.check(j.buyer_installation === a.pair.buyer.installation && j.seller_installation === a.pair.seller.installation, side + ' copy: jurisdiction names both installations', JSON.stringify(j));
      rec.check(!bj.invoice, side + ' copy: no invoice (the buyer ran no tax)', 'invoice present');
      rec.check(c && c.summary_json && c.summary_json.money && c.summary_json.money.currency_code === want, side + ' copy: header money is in ' + want, JSON.stringify(c && c.summary_json && c.summary_json.money));
    }
  }
};

const R17 = {
  id: 'R17', title: 'round 2: the seller prices; same proposal id and invoice bytes on both sides', requires: ['R16'],
  async run(ctx, rec) {
    const a = await flow.actors(ctx, 'R17');
    const body = await sellerQuotes(ctx, rec, a, ctx.state.rfq.chit_id, 12, 10, 'R17');
    if (!body.proposal_id) return;
    rec.check(body.round === 2 && body.kind === 'pro_forma', 'round 2, kind pro_forma', JSON.stringify({ round: body.round, kind: body.kind }));
    rec.check(body.money && body.money.currency_code === a.pair.seller.currency && flow.num(body.money.net) === 120, 'seller-computed net is 120 in ' + a.pair.seller.currency, JSON.stringify(body.money));
    ctx.state.rfq.round2 = body.proposal_id;
    await sameProposalBothSides(ctx, rec, a, ctx.state.rfq.chit_id, body.proposal_id, 'R17');
  }
};

const R18 = {
  id: 'R18', title: 'round 3: the buyer counters 12 at "11.50" as TEXT: a request, money null', requires: ['R17'],
  async run(ctx, rec) {
    const a = await flow.actors(ctx, 'R18');
    const body = await buyerCounters(ctx, rec, a, ctx.state.rfq.chit_id, ctx.state.rfq.round2, 12, a.pair.seller.currency + ' 11.50', 'R18');
    if (!body.proposal_id) return;
    ctx.state.rfq.round3 = body.proposal_id;
    const there = await flow.waitProposals(ctx, a.sk, ctx.state.rfq.chit_id, (rows) => rows.some((r) => r.proposal_id === body.proposal_id && r.kind === 'request'));
    rec.check(there.ok, 'the request arrived on the seller\'s installation (' + there.waitedMs + ' ms)', 'never arrived');
    const row = there.ok ? there.value.find((r) => r.proposal_id === body.proposal_id) : null;
    rec.check(row && row.money === null && row.invoice_md5 === null, 'stored with money null and no invoice', JSON.stringify(row));
  }
};

const R19 = {
  id: 'R19', title: 'accepting the replaced round 2 is refused: PROPOSAL_CLOSED', requires: ['R18'],
  async run(ctx, rec) {
    const a = await flow.actors(ctx, 'R19');
    const out = await a.buyer.post('/api/chits/' + ctx.state.rfq.chit_id + '/proposals/' + ctx.state.rfq.round2 + '/accept', {});
    rec.check(out.status === 409, 'HTTP 409 (got ' + out.status + ')', JSON.stringify(out.body).slice(0, 200));
    rec.check(out.body.code === 'PROPOSAL_CLOSED', 'code PROPOSAL_CLOSED', 'code ' + out.body.code);
    rec.check(/already countered/i.test(JSON.stringify(out.body)), 'in words: "already countered"', JSON.stringify(out.body).slice(0, 200));
  }
};

const R20 = {
  id: 'R20', title: 'round 4: the seller re-quotes 12 x 11.50 = 138', requires: ['R18'],
  async run(ctx, rec) {
    const a = await flow.actors(ctx, 'R20');
    const body = await sellerQuotes(ctx, rec, a, ctx.state.rfq.chit_id, 11.5, 12, 'R20');
    if (!body.proposal_id) return;
    rec.check(body.round === 4, 'round 4', 'round ' + body.round);
    rec.check(body.money && flow.num(body.money.net) === 138, 'seller-computed net is 138', JSON.stringify(body.money));
    ctx.state.rfq.round4 = body.proposal_id;
    await sameProposalBothSides(ctx, rec, a, ctx.state.rfq.chit_id, body.proposal_id, 'R20');
  }
};

const R21 = {
  id: 'R21', title: 'the buyer accepts round 4: both copies pro_forma, header and invoice byte-identical', requires: ['R20'],
  async run(ctx, rec) {
    const a = await flow.actors(ctx, 'R21');
    const out = await buyerAccepts(ctx, rec, a, ctx.state.rfq.chit_id, ctx.state.rfq.round4, 'R21');
    if (!out.ok) return;
    await identicalOnBothSides(ctx, rec, a, ctx.state.rfq.chit_id, ctx.state.rfq.round4, { currency: a.pair.seller.currency, total: 138 }, 'R21');
  }
};

const R22 = {
  id: 'R22', title: 'round 5: a money-free terms round is agreed; the invoice is untouched', requires: ['R21'],
  async run(ctx, rec) {
    const a = await flow.actors(ctx, 'R22');
    const chitId = ctx.state.rfq.chit_id;
    const before = await flow.copy(ctx, a.sk, chitId);
    const terms = { delivery_date: '2026-12-15', scope: 'FOB, packed in 25 kg bags' };
    const out = await a.buyer.post('/api/chits/' + chitId + '/proposals', { terms, note: ctx.tag + ' R22' });
    rec.check(out.ok && out.body.kind === 'terms', 'the buyer puts terms forward (HTTP ' + out.status + ', kind ' + out.body.kind + ')', JSON.stringify(out.body).slice(0, 200));
    if (!out.body.proposal_id) return;
    const there = await flow.waitProposals(ctx, a.sk, chitId, (rows) => rows.some((r) => r.proposal_id === out.body.proposal_id));
    rec.check(there.ok, 'the terms arrived on the seller\'s installation (' + there.waitedMs + ' ms)', 'never arrived');
    const agreed = await a.seller.post('/api/chits/' + chitId + '/proposals/' + out.body.proposal_id + '/accept', {});
    rec.check(agreed.ok, 'the seller agrees (HTTP ' + agreed.status + ')', JSON.stringify(agreed.body).slice(0, 200));
    const done = await flow.waitCopyWhere(ctx, a.bk, chitId, (c) => c.business_json.agreed && (c.business_json.agreed.terms || c.business_json.agreed).scope === terms.scope);
    rec.check(done.ok, 'the buyer\'s copy carries business_json.agreed (' + done.waitedMs + ' ms)', 'no agreed terms on the buyer');
    const pair = await flow.bothCopies(ctx, chitId, a.bk, a.sk);
    rec.check(pair.buyer && pair.seller && JSON.stringify(agreedTerms(pair.buyer)) === JSON.stringify(agreedTerms(pair.seller)), 'the same terms on both copies (each installation stamps its own at)', JSON.stringify({ b: pair.buyer && pair.buyer.business_json.agreed, s: pair.seller && pair.seller.business_json.agreed }));
    rec.check(before && pair.seller && sameDigest(before.invoice_md5, pair.seller.invoice_md5), 'the invoice md5 did not change', 'before ' + (before && before.invoice_md5) + ' after ' + (pair.seller && pair.seller.invoice_md5));
  }
};

module.exports = {
  scenarios: [R16, R17, R18, R19, R20, R21, R22],
  steps: { placeOrder, sellerQuotes, sameProposalBothSides, buyerCounters, buyerAccepts, identicalOnBothSides }
};
