/**
 * /api/invoice — THE INVOICE AS A SERVICE (rung 2): the whole line pipeline in one call, on the same engines the chit
 * uses — pricing structure → offers → tax → the INV-01 block (India's e-invoice JSON shape; `_cb.scheme` names GST or a
 * VAT-type scheme; `_cb.supply` intra · inter · domestic · cross · unknown).
 *   POST /api/invoice/build   (key: invoice)  { seller?, buyer?, lines:[…], offers?, currency?, priceIncludesTax? }
 *        seller omitted = this entity (GSTIN → state, registration type); buyer = { Gstin?, State?|Pos?, Country?, name? }
 *        → { pricing:[…], offers:{…}, rates:[…], invoice:{ INV-01 }, heads, explain:[…] }
 *   GET  /api/invoice/:chit_id (key: invoice)  → the tax invoice of a chit this entity holds (provisional or frozen)
 *
 * ⚠️ IT BUILDS, IT DOES NOT ISSUE. Nothing is written; an invoice number, a signature and the freeze belong to the chit.
 */
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const S = require('../lib/services');
const T = require('../lib/tax-lines');
const C = require('../lib/tax-copy');

router.post('/build', auth, auth.requireScope('invoice'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const lines = S.normLines(req.body);
    if (!lines.length) return res.status(400).json({ error: 'validation', message: 'lines[] required' });
    const body = req.body || {};
    const sh = await S.shelfOf(entity_id);
    /* 1 · pricing structure */
    const priced = lines.map((l) => Object.assign({}, l, S.priceLine(l, sh.productOf(l))));
    /* 2 · offers on the priced lines */
    const off = await S.offerLines(entity_id, priced, body.offers, { currency: body.currency || 'INR' });
    const gross = priced.reduce((t, l) => t + l.unit_price * l.qty, 0);
    const orderOff = (off.ev.adjustments || []).filter((a) => a.scope !== 'line' && a.scope !== 'note').reduce((t, a) => t + Math.abs(Number(a.amount) || 0), 0);
    const withOffers = priced.map((l) => { const p = off.per[l.key] || {}; const lineOff = Number(p.off) || 0; const share = gross > 0 ? orderOff * (l.unit_price * l.qty) / gross : 0; return Object.assign({}, l, { discount: S.R2((l.discount || 0) + lineOff + share), offer_label: p.label || null }); });
    /* 3 · tax rates, then the block */
    const rated = S.rateLines(withOffers, sh);
    const mine = await S.partyOfEntity(entity_id);
    const seller = S.party(body.seller, mine);
    const buyer = S.party(body.buyer, { Country: seller.Country || null, RegType: 'regular' });
    if (!buyer.State && !buyer.Pos && !buyer.Gstin && seller.State) buyer.Pos = seller.State;   /* a walk-in buyer: the supply is where the seller is */
    const det = S.computeTax({ seller, buyer, lines: rated, priceIncludesTax: !!body.priceIncludesTax, reverseCharge: !!body.reverseCharge, scheme: body.scheme });
    const invoice = Object.assign({ DocDtls: { Typ: 'INV', No: null, Dt: new Date().toISOString().slice(0, 10) }, currency: body.currency || 'INR' }, det);
    res.json({ engine: 'chitbridge-invoice', version: 1, order: ['pricing structure', 'offers', 'tax'],
      pricing: priced.map((l) => ({ key: l.key, unit_price: l.unit_price, list_price: l.list_price, structure: l.structure, why: l.why })),
      offers: { subtotal: off.ev.subtotal, total: off.ev.total, adjustments: off.ev.adjustments || [], notes: off.ev.notes || [], considered: off.offers_considered },
      rates: rated.map((l) => ({ key: l.key, gst_rate: l.gst_rate, cess_rate: l.cess_rate, hsn: l.hsn, slab: l.tax_slab_name, source: l.tax_source, scheme: l.tax_scheme })),
      seller: { LglNm: seller.LglNm, Gstin: seller.Gstin, State: seller.State, Country: seller.Country, RegType: seller.RegType }, buyer: { LglNm: buyer.LglNm, Gstin: buyer.Gstin, State: buyer.State, Pos: buyer.Pos, Country: buyer.Country },
      invoice, heads: T.heads(invoice) });
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});

router.get('/:chit_id', auth, auth.requireScope('invoice'), async (req, res) => {
  try {
    const me = auth.entityOf(req);
    const hdr = await C.copyOf(req.params.chit_id, me);
    if (!hdr) return res.status(404).json({ error: 'Not found' });
    const e = await C.entryFor(hdr, me);
    res.json({ chit_id: e.chit_id, direction: e.direction, sells: e.sells, status: e.status, provisional: e.provisional, frozen: e.frozen, rated: e.rated, unrated: e.unrated, seller: e.seller, buyer: e.buyer, invoice: e.invoice, heads: T.heads(e.invoice) });
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});

router.openapi = {
  paths: {
    '/api/invoice/build': { post: { summary: 'Build an invoice: pricing structure → offers → tax → INV-01 block (nothing is issued)', tags: ['invoice'], security: [{ apiKey: [] }, { bearer: [] }],
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/InvoiceBody' } } } },
      responses: { 200: { description: 'the built invoice and how it was arrived at', content: { 'application/json': { schema: { $ref: '#/components/schemas/InvoiceResult' } } } } } } },
    '/api/invoice/{chit_id}': { get: { summary: 'The tax invoice of a chit this entity holds', tags: ['invoice'], security: [{ apiKey: [] }, { bearer: [] }], parameters: [{ name: 'chit_id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'invoice' }, 404: { description: 'not held' } } } },
  },
  schemas: {
    Party: { type: 'object', properties: { name: { type: 'string' }, Gstin: { type: 'string' }, State: { type: 'string', description: 'GST state code, e.g. 29' }, Pos: { type: 'string', description: 'place of supply (state code)' }, Country: { type: 'string', description: 'ISO 3166-1 alpha-2' }, RegType: { type: 'string', enum: ['regular', 'composition', 'unregistered'] } } },
    InvoiceLine: { type: 'object', required: ['qty'], properties: { key: { type: 'string' }, item_id: { type: 'string' }, code: { type: 'string' }, name: { type: 'string' }, qty: { type: 'number' }, listPrice: { type: 'number' }, unit: { type: 'string' }, pricing: { $ref: '#/components/schemas/PricingStructure' }, discount: { type: 'number' }, gst_rate: { type: 'number' }, cess_rate: { type: 'number' }, hsn: { type: 'string' }, categories: { type: 'array', items: { type: 'string' } } } },
    InvoiceBody: { type: 'object', required: ['lines'], properties: { seller: { $ref: '#/components/schemas/Party' }, buyer: { $ref: '#/components/schemas/Party' }, lines: { type: 'array', items: { $ref: '#/components/schemas/InvoiceLine' } }, offers: { type: 'array', items: { $ref: '#/components/schemas/Offer' } }, currency: { type: 'string' }, priceIncludesTax: { type: 'boolean' }, reverseCharge: { type: 'boolean' }, scheme: { type: 'string', description: 'GST (default) or a VAT-type scheme' } } },
    InvoiceResult: { type: 'object', properties: { pricing: { type: 'array', items: { type: 'object' } }, offers: { type: 'object' }, rates: { type: 'array', items: { type: 'object' } }, seller: { $ref: '#/components/schemas/Party' }, buyer: { $ref: '#/components/schemas/Party' }, invoice: { type: 'object', description: 'INV-01 shape: ItemList[], ValDtls, _cb{scheme,supply,notes}' }, heads: { type: 'object' } } },
  },
};
module.exports = router;
