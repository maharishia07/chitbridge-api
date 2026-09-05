// routes/tax.js — the invoice for a chit, the month's ledger, the GSTR shapes. Read-only; nothing here files.
'use strict';
const express = require('express');
const router = express.Router();
const { safeErr } = require('../lib/respond');
const auth = require('../middleware/auth');
const T = require('../lib/tax-lines');
const C = require('../lib/tax-copy');
const ctx = (req) => auth.entityOf(req);

/**
 * ⭐⭐ WHY THIS EXISTS. Athi, 2026-09-04: *"as a network entity, we should be able to say, if you use our networking
 * capability your tax liability can be computed or organised?"* — STUDY-gst-structure §4. We hold BOTH copies of a
 * stamped chit, so the seller's output tax and the buyer's input credit are the same record read from two sides:
 * matched at stamp, not weeks later against GSTR-2B. This route READS that — it never writes, never files.
 *
 * ⚠️ MY COPY ONLY. Every chit read is scoped by entity through RLS (lib/tax-copy → withEntity); the counterparty's
 * registration comes from identities (no RLS) because an invoice needs both parties' facts.
 */

/** GET /api/tax/invoice/:chit_id — the INV-01 block for MY copy of one chit (frozen, or live + provisional). */
router.get('/invoice/:chit_id', auth, async (req, res) => {
  try {
    const me = ctx(req);
    const hdr = await C.copyOf(req.params.chit_id, me);
    if (!hdr) return res.status(404).json({ error: 'Not found' });
    const e = await C.entryFor(hdr, me);
    res.json({ chit_id: e.chit_id, direction: e.direction, status: e.status, provisional: e.provisional, frozen: e.frozen,
               rated: e.rated, unrated: e.unrated, seller: e.seller, buyer: e.buyer, invoice: e.invoice, heads: T.heads(e.invoice) });
  } catch (err) { res.status(500).json({ error: 'Failed', message: safeErr(err) }); }
});

/** GET /api/tax/ledger?month=YYYY-MM — output · ITC · net for my GSTIN in that month, with the rows behind it. */
router.get('/ledger', auth, async (req, res) => {
  try {
    const me = ctx(req);
    const { bounds, me: meParty, ledger } = await C.ledgerFor(me, req.query.month);
    res.json({ month: bounds.month, period: bounds.period, gstin: meParty.Gstin || null, registration: meParty.RegType,
               output: ledger.output, itc: ledger.itc, net: ledger.net, count: ledger.count, provisional: ledger.provisional,
               rows: ledger.rows.map((r) => ({ chit_id: r.chit_id, subject: r.subject, purpose: r.purpose, status: r.status, direction: r.direction,
                 side: r.side, at: r.at, counterparty: r.direction === 'sent' ? r.buyer.LglNm : r.seller.LglNm,
                 counterparty_gstin: r.direction === 'sent' ? r.buyer.Gstin : r.seller.Gstin, heads: r.heads, provisional: r.provisional, unrated: r.unrated })),
               note: 'Computed from chits on the rail. A copy is frozen when it reaches completed; until then its figures are provisional. Off-rail purchases are not here. This is not a filing.' });
  } catch (err) { res.status(500).json({ error: 'Failed', message: safeErr(err) }); }
});

/** GET /api/tax/gstr?month=YYYY-MM&form=gstr1|gstr3b — the offline-tool JSON. Validate before filing. */
router.get('/gstr', auth, async (req, res) => {
  try {
    const me = ctx(req);
    const { bounds, me: meParty, ledger } = await C.ledgerFor(me, req.query.month);
    const form = String(req.query.form || 'gstr1').toLowerCase();
    const out = form === 'gstr3b' ? T.gstr3b(ledger, meParty, bounds.period) : T.gstr1(ledger, meParty, bounds.period);
    res.setHeader('Content-Disposition', `attachment; filename="${form}-${bounds.period}.json"`);
    res.json(out);
  } catch (err) { res.status(500).json({ error: 'Failed', message: safeErr(err) }); }
});

/* ── THE TAX ENGINE AS A SERVICE (rung 2) ──
 *   POST /api/tax/rate     (key: tax)  { lines:[{ item_id?|code?|name, hsn? }] } → the slab each line resolves to on THIS entity's shelf
 *   POST /api/tax/compute  (key: tax)  { seller?, buyer, lines:[{ name, qty, unit_price, discount?, rate?, cess_rate?, hsn? }], scheme?, priceIncludesTax? }
 *                                       → the INV-01 block; a line without a rate takes the shelf's; seller omitted = this entity
 * Global by scheme: GST (state decides intra/inter) or a VAT-type scheme (the border decides domestic/cross) — the line's
 * or the slab's scheme, the parties' Country. */
const S = require('../lib/services');
router.post('/rate', auth, auth.requireScope('tax'), async (req, res) => {
  try {
    const lines = S.normLines(req.body); if (!lines.length) return res.status(400).json({ error: 'validation', message: 'lines[] required' });
    const sh = await S.shelfOf(auth.entityOf(req));
    const rated = S.rateLines(lines, sh.shelf);
    res.json({ engine: 'chitbridge-tax', version: 1, lines: rated.map((l) => ({ key: l.key, item_id: l.item_id, code: l.code, name: l.name, gst_rate: l.gst_rate, cess_rate: l.cess_rate, hsn: l.hsn, slab: l.tax_slab_name, source: l.tax_source, scheme: l.tax_scheme })) });
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});
router.post('/compute', auth, auth.requireScope('tax'), async (req, res) => {
  try {
    const body = req.body || {}; const lines = S.normLines(body); if (!lines.length) return res.status(400).json({ error: 'validation', message: 'lines[] required' });
    const entity_id = auth.entityOf(req);
    const needShelf = lines.some((l) => l.gst_rate == null);
    const sh = needShelf ? await S.shelfOf(entity_id) : null;
    const rated = sh ? S.rateLines(lines, sh.shelf) : lines;
    const mine = await S.partyOfEntity(entity_id);
    const seller = S.party(body.seller, mine); const buyer = S.party(body.buyer, { Country: seller.Country || null, RegType: 'regular' });
    if (!buyer.State && !buyer.Pos && !buyer.Gstin && seller.State) buyer.Pos = seller.State;
    const det = S.computeTax({ seller, buyer, lines: rated.map((l) => Object.assign({}, l, { unit_price: l.listPrice })), priceIncludesTax: !!body.priceIncludesTax, reverseCharge: !!body.reverseCharge, scheme: body.scheme });
    res.json({ engine: 'chitbridge-tax', version: 1, seller: { Gstin: seller.Gstin, State: seller.State, Country: seller.Country, RegType: seller.RegType }, buyer: { Gstin: buyer.Gstin, State: buyer.State, Pos: buyer.Pos, Country: buyer.Country }, invoice: det, heads: T.heads(det) });
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});
router.openapi = {
  paths: {
    '/api/tax/rate': { post: { summary: 'The tax slab each line resolves to on this entity\'s shelf', tags: ['tax'], security: [{ apiKey: [] }, { bearer: [] }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['lines'], properties: { lines: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, item_id: { type: 'string' }, code: { type: 'string' }, name: { type: 'string' }, hsn: { type: 'string' } } } } } } } } }, responses: { 200: { description: 'rated lines' } } } },
    '/api/tax/compute': { post: { summary: 'Compute tax on lines (INV-01 block); GST by state, VAT-type by border', tags: ['tax'], security: [{ apiKey: [] }, { bearer: [] }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['lines'], properties: { seller: { $ref: '#/components/schemas/Party' }, buyer: { $ref: '#/components/schemas/Party' }, lines: { type: 'array', items: { $ref: '#/components/schemas/InvoiceLine' } }, scheme: { type: 'string' }, priceIncludesTax: { type: 'boolean' }, reverseCharge: { type: 'boolean' } } } } } }, responses: { 200: { description: 'the INV-01 block and the heads' } } } },
    '/api/tax/invoice/{chit_id}': { get: { summary: 'The tax invoice of a chit (session)', tags: ['tax'], security: [{ bearer: [] }], parameters: [{ name: 'chit_id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'invoice' } } } },
  },
  schemas: {},
};
module.exports = router;
