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

module.exports = router;
