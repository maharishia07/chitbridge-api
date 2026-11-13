#!/usr/bin/env node
/**
 * ops-58-short-delivery-posts.red.cjs — OPS-58 (proof 2026-11-14), half 2: ACCEPTING the W73 rail bill must not post the full paper bill. EXPECTED RED on main (REGRESSION).
 * @type regression
 * OWNS      W73: the supplier's invoice (rail) says 60 Parotta = 720; 50 were received (600). Decided (OPS-60, ATHI-DECISIONS 24 Oct): post what ARRIVED, hold the gap, offer a debit note or
 *           a dispute. lib/books-hooks.classify of that accepted invoice, given the delivered count (the shortfall the till match already shows), must NOT answer
 *           kind 'post' at the full 720 with nothing noted: it posts at 600 with the 120 noted, or waits with wait 'gap'.
 * CALLED BY NOT enrolled in scripts/guards.cjs (red on main, reopened on the OPS-58 line). No database.
 * FLOW      accepted rail invoice 720 + delivered 50 of 60 -> classify -> expected { post at 600, short 12000 minor } | { queue, wait 'gap' }
 *   node tests/ops-58-short-delivery-posts.red.cjs
 */
'use strict';
const path = require('path');
const { ok, done } = require('./lib/cat-proof-kit.cjs');
const H = require('./support/books-harness.cjs');
const SHOP = '11111111-1111-4111-8111-111111111111', SUPP = '33333333-3333-4333-8333-333333333333';
const S = { enabled: true, walkin_grain: 'day', country: 'IN', functional_currency: 'INR' };
H.load();
const K = require(path.join(H.API, 'lib', 'books-hooks'));
const invoice720 = { currency: 'INR', ItemList: [{ GstRt: 0, AssAmt: 720, CgstAmt: 0, SgstAmt: 0, IgstAmt: 0, CesAmt: 0 }], ValDtls: { TotInvVal: 720 } };
const got = K.classify({
  chit: { chit_id: 'w73', created_at: '2026-10-18T05:00:00Z', purpose: 'invoice', sender_entity_id: SUPP, business_json: { invoice_no: 'INV-73' } },
  entry: { sells: false, seller: { entity_id: SUPP, LglNm: 'Mill' }, me: { entity_id: SHOP }, invoice: invoice720 },
  setting: S, status: 'accepted', delivered: { ordered: 60, received: 50, taxable_minor: 60000 }
});
const taxable = (got.event && got.event.by_rate || []).reduce((sum, r) => sum + Number(r.taxable || 0), 0);
const heldOrNoted = got.kind === 'queue' || (got.kind === 'post' && taxable === 600 && got.event.short && got.event.short.short_minor === 12000);
ok('W73: the accepted rail bill is held or posted at the 600 that arrived with the 120 noted (never ₹720 silently)', heldOrNoted, JSON.stringify({ kind: got.kind, taxable, short: got.event && got.event.short, wait: got.wait }).slice(0, 300));
done();
