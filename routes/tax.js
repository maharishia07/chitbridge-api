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
    res.json({
      chit_id: e.chit_id,
      direction: e.direction,
      status: e.status,
      provisional: e.provisional,
      frozen: e.frozen,
      rated: e.rated,
      unrated: e.unrated,
      seller: e.seller,
      buyer: e.buyer,
      invoice: e.invoice,
      heads: T.heads(e.invoice)
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed', message: safeErr(err) });
  }
});

/** GET /api/tax/ledger?month=YYYY-MM — output · ITC · net for my GSTIN in that month, with the rows behind it. */
router.get('/ledger', auth, async (req, res) => {
  try {
    const me = ctx(req);
    const { bounds, me: meParty, ledger } = await C.ledgerFor(me, req.query.month);
    res.json({
      month: bounds.month,
      period: bounds.period,
      gstin: meParty.Gstin || null,
      registration: meParty.RegType,
      output: ledger.output,
      itc: ledger.itc,
      net: ledger.net,
      count: ledger.count,
      provisional: ledger.provisional,
      rows: ledger.rows.map((item) => ({
        chit_id: item.chit_id,
        subject: item.subject,
        purpose: item.purpose,
        status: item.status,
        direction: item.direction,
        side: item.side,
        at: item.at,
        counterparty: item.direction === 'sent' ? item.buyer.LglNm : item.seller.LglNm,
        counterparty_gstin: item.direction === 'sent' ? item.buyer.Gstin : item.seller.Gstin,
        heads: item.heads,
        provisional: item.provisional,
        unrated: item.unrated
      })),
      note: 'Computed from chits on the rail. A copy is frozen when it reaches completed; until then its figures are provisional. Off-rail purchases are not here. This is not a filing.'
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed', message: safeErr(err) });
  }
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
  } catch (err) {
    res.status(500).json({ error: 'Failed', message: safeErr(err) });
  }
});

/* ── THE TAX ENGINE AS A SERVICE (rung 2) ──
 *   POST /api/tax/rate     (key: tax)  { lines:[{ item_id?|code?|name, hsn? }] } → the slab each line resolves to on THIS entity's shelf
 *   POST /api/tax/compute  (key: tax)  { seller?, buyer, lines:[{ item_id?|code?|name, qty, unit_price?, discount?, rate?, cess_rate?, hsn? }], scheme?, priceIncludesTax? }
 *                                       → the INV-01 block + money (by rate) + currency + pack; a line without a rate takes the shelf's, without a price the shelf's
 *                                         price; seller omitted = this entity; priceIncludesTax omitted = the shop's own setting
 * Global by scheme: GST (state decides intra/inter) or a VAT-type scheme (the border decides domestic/cross) — the line's
 * or the slab's scheme, the parties' Country. */
const S = require('../lib/services');
const tax = require('../lib/tax');
const regulation = require('../lib/regulation');
const { known } = require('../lib/knownerr');

/* ⭐ TAX-SRV1 G5: EVERY REFUSAL IS A CODE AND A SENTENCE. A caller branches on `code`, a person reads `message`; the raw error text never
   leaves (it is logged by safeErr). 400 = the request is malformed · 422 = it is well-formed but the shop's facts cannot answer it. */
const refuse = (res, status, code, message, extra) =>
  res.status(status).json(Object.assign({ error: status === 400 ? 'Bad request' : 'Cannot compute', code, message }, extra || {}));
const fault = (res, e) => {
  const k = known(e);
  if (k) return res.status(k.status).json(k.body);
  return res.status(500).json({ error: 'Failed', code: 'TAX_FAILED', message: safeErr(e) });
};
const nameOf = (l) => '"' + String(l.name || l.item_id || l.code || 'line ' + l.key).slice(0, 60) + '"';
/** the first malformed line, said — qty above 0, a price that is not negative, a rate 0–100 */
function badLine(lines) {
  for (const l of lines) {
    if (!(l.qty > 0)) return ['BAD_QTY', 'Line ' + nameOf(l) + ' needs a quantity above 0.'];
    if (l.listPrice != null && l.listPrice < 0) return ['BAD_PRICE', 'Line ' + nameOf(l) + ' has a price below 0.'];
    if (l.gst_rate != null && (l.gst_rate < 0 || l.gst_rate > 100)) return ['BAD_RATE', 'Line ' + nameOf(l) + ' has a tax rate outside 0–100%.'];
    if (l.listPrice == null && !l.item_id && !l.code) return ['NO_PRICE', 'Line ' + nameOf(l) + ' has no price and names no item to read one from.'];
  }
  return null;
}

router.post('/rate', auth, auth.requireScope('tax'), async (req, res) => {
  try {
    const lines = S.normLines(req.body);
    if (!lines.length) return refuse(res, 400, 'NO_LINES', 'Send at least one line.');
    const sh = await S.shelfOf(auth.entityOf(req));
    const rated = S.rateLines(lines, sh);
    res.json({
      engine: 'chitbridge-tax',
      version: 1,
      lines: rated.map((item) => ({
        key: item.key,
        item_id: item.item_id,
        code: item.code,
        name: item.name,
        gst_rate: item.gst_rate,
        cess_rate: item.cess_rate,
        hsn: item.hsn,
        slab: item.tax_slab_name,
        source: item.tax_source,
        scheme: item.tax_scheme
      }))
    });
  } catch (e) {
    fault(res, e);
  }
});
/**
 * POST /api/tax/compute — the same answer the counter prints for the same bill (TAX-SRV1).
 *   G2 · priceIncludesTax left out = the SHOP's own setting (services.shopOf → policy.flagOf, as the counter's taxIncluded); `price_includes_tax`
 *        in the answer says which value was used and whose (`caller` | `shop`).
 *   G3 · a line with no price that names an item (item_id or code) is priced by the one price reader (services.priceLine: the product's
 *        structure at the quantity, money.priceOf) — never 0. `priced[]` says each line's unit price and where it came from.
 *   G1 · `money` is tax.moneyOf (the summary_json.money shape: by_rate · heads · currency_code), `pack` is regulation.status of the seller's
 *        country (id + version, or the code and sentence when there is none). No country → 422 NO_COUNTRY: tax is never worked out on a guess.
 * Who may call: a signed-in session of the shop, or the shop's API key with scope `tax` (or `services`). Trips: 2 (identities, shelf) — the shelf
 * is read only when a line needs a rate or a price.
 */
router.post('/compute', auth, auth.requireScope('tax'), async (req, res) => {
  try {
    const body = req.body || {};
    const lines = S.normLines(body);
    if (!lines.length) return refuse(res, 400, 'NO_LINES', 'Send at least one line to compute tax on.');
    const bad = badLine(lines);
    if (bad) return refuse(res, 400, bad[0], bad[1]);
    const said = S.saidInclusive(body);
    if (said === null) return refuse(res, 400, 'BAD_FLAG', 'priceIncludesTax must be true or false.');
    const entity_id = auth.entityOf(req);
    const shop = await S.shopOf(entity_id);
    const seller = S.party(body.seller, shop.party);
    const st = regulation.status(seller.Country);
    if (st.code === 'NO_COUNTRY') return refuse(res, 422, 'NO_COUNTRY', st.why);
    const needShelf = lines.some((item) => item.gst_rate == null || item.listPrice == null);
    const sh = needShelf ? await S.shelfOf(entity_id) : null;
    const priced = [];
    for (const l of lines) {
      if (l.listPrice != null) {
        priced.push({ key: l.key, unit_price: l.listPrice, source: 'caller' });
        continue;
      }
      const prod = sh && sh.productOf(l);
      if (!prod) return refuse(res, 422, 'ITEM_NOT_FOUND', 'Line ' + nameOf(l) + ' names an item this shop does not sell.', { line: l.key });
      const p = S.priceLine(l, prod);
      if (p.unit_price == null)
        return refuse(
          res,
          422,
          'NO_PRICE',
          (prod.name ? '"' + String(prod.name).slice(0, 60) + '"' : 'Line ' + nameOf(l)) + ' has no price on the shelf. Set its price, or send one.',
          { line: l.key }
        );
      l.listPrice = p.unit_price;
      l.name = l.name || p.name;
      l.item_id = l.item_id || sh.idOf(l);
      priced.push({ key: l.key, unit_price: p.unit_price, source: 'shelf', structure: p.structure, why: p.why || null });
    }
    const rated = sh ? S.rateLines(lines, sh) : lines;
    /* ⭐ BUY1: a walk-in buyer (no country, no place of supply) is taxed inside the shop — tax-lines.walkIn, the ONE rule (computeTax applies it too; the echo below shows what was taxed) */
    const buyer = T.walkIn(seller, S.party(body.buyer, { RegType: 'regular' })).buyer;
    const inclusive = said !== undefined ? said : shop.priceIncludesTax;
    const det = S.computeTax({
      seller,
      buyer,
      lines: rated.map((item) => Object.assign({}, item, { unit_price: item.listPrice })),
      priceIncludesTax: inclusive,
      reverseCharge: !!body.reverseCharge,
      scheme: body.scheme
    });
    /* no pack = no currency said: never the default pack's INR for a country we do not keep (regulation.lookup would fall back) */
    const currency = st.pack ? T.currencyOf(seller) : null;
    res.json({
      engine: 'chitbridge-tax',
      version: 1,
      seller: { Gstin: seller.Gstin, State: seller.State, Country: seller.Country, RegType: seller.RegType },
      buyer: { Gstin: buyer.Gstin, State: buyer.State, Pos: buyer.Pos, Country: buyer.Country },
      price_includes_tax: { value: inclusive, source: said !== undefined ? 'caller' : 'shop' },
      priced,
      currency,
      pack: { id: st.pack, version: st.version, code: st.code, why: st.why },
      money: tax.moneyOf(det, currency),
      invoice: det,
      heads: T.heads(det)
    });
  } catch (e) {
    fault(res, e);
  }
});
router.openapi = {
  paths: {
    '/api/tax/rate': {
      post: {
        summary: "The tax slab each line resolves to on this entity's shelf",
        tags: ['tax'],
        security: [{ apiKey: [] }, { bearer: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['lines'],
                properties: {
                  lines: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        key: { type: 'string' },
                        item_id: { type: 'string' },
                        code: { type: 'string' },
                        name: { type: 'string' },
                        hsn: { type: 'string' }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        responses: { 200: { description: 'rated lines' } }
      }
    },
    '/api/tax/compute': {
      post: {
        summary: 'Compute tax on lines (INV-01 block); GST by state, VAT-type by border',
        tags: ['tax'],
        security: [{ apiKey: [] }, { bearer: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['lines'],
                properties: {
                  seller: { $ref: '#/components/schemas/Party' },
                  buyer: { $ref: '#/components/schemas/Party' },
                  lines: { type: 'array', items: { $ref: '#/components/schemas/InvoiceLine' } },
                  scheme: { type: 'string' },
                  priceIncludesTax: { type: 'boolean' },
                  reverseCharge: { type: 'boolean' }
                }
              }
            }
          }
        },
        responses: {
          200: { description: 'the INV-01 block, the heads, money (by rate), currency and the pack version' },
          400: { description: 'code: NO_LINES · BAD_QTY · BAD_PRICE · BAD_RATE · NO_PRICE · BAD_FLAG, and a sentence' },
          422: { description: 'code: NO_COUNTRY · ITEM_NOT_FOUND · NO_PRICE, and a sentence' }
        }
      }
    },
    '/api/tax/invoice/{chit_id}': {
      get: {
        summary: 'The tax invoice of a chit (session)',
        tags: ['tax'],
        security: [{ bearer: [] }],
        parameters: [{ name: 'chit_id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'invoice' } }
      }
    }
  },
  schemas: {}
};
module.exports = router;
