/**
 * tests/tax-truth.test.cjs — ONE INVOICE, EVERYWHERE: one counter bill read SIX ways, every figure equal to the paisa
 * (docs/tasks/TAX-TRUTH-2026-10-02.md · docs/tasks/CLOUD-TASK-tax-truth.md; Athi, 2026-10-02: "the computation should happen
 * in only one place like billing, rest all the places the value has to only read, no recomputation … recomputation can be
 * done, but cannot rewrite what has been already wrote").
 *
 * The ONE computation is CBTax.determine() (lib/tax.js — window.CBTax on the counter), called by the counter's billMoney().
 * Its result is business_json.invoice; everything after it reads.
 *
 * The bill is C2/26-27/0007 as the counter printed it: Tally Test (33AABCK1234F1Z6, regular, state 33, prices include
 * tax) → Chola Auto Care, a business on the rail with a GSTIN from ANOTHER state (29), on credit; mixed 12% and 18%, two
 * lines with offers. Printed: taxable ₹998.21 · CGST 59.76 + SGST 59.75 at 12% · CGST 0.22 + SGST 0.22 at 18% · total
 * ₹1,118.16 (tax-packs v1.10.0: India's invoice total to the PAISA, so RndOffAmt 0; its line nets sum to ₹1,118.15) · intra ·
 * place of supply 33.
 * ⚠️ The diagnosis records the bill's totals, not its lines; the lines here are a reconstruction that prints exactly
 * those totals through the engine, which is what is under test.
 *
 * The six readings, each through the REAL code, no database, no network:
 *   1 the counter's bill      — till.html finish() → billMoney() → CBTax.determine() → the bill it saves, and its printed slip
 *   2 the chit as stored      — till.html chitOf() → POST /api/chits/send (the real route, db stubbed) → the shop's copy
 *   3 the seller's posting    — lib/tax-copy entryFor(shop copy) → lib/books-hooks classify → sale_bill
 *   4 the buyer's posting     — entryFor(customer copy) → classify, accepted → purchase_bill
 *   5 the reprint's slip      — GET /api/till/bills (the real route) → till.html reprintOld → slipOfRow → moneyOf → slipHTML
 *   6 the buyer's invoice     — entryFor(customer copy) → what GET /api/tax/invoice returns (invoice + heads)
 * Variants: a recorded delivery to another state (IGST everywhere) · an exclusive-price shop · a walk-in · a bill with no
 * invoice (the old path, place of supply = the shop's state) · a stored figure the server's recompute disagrees with (the
 * stored one kept, the difference named). And: billMoney computes nothing of its own; the place-of-supply rule and the
 * reading of an issued invoice are the engine's (CBTax.placeOfSupply, CBTax.moneyOf) on both hosts — no copy; with the
 * engine missing the counter refuses the sale (never a ₹0 bill); the shop-PC program's chitOf carries the same invoice.
 * Broken once each by scripts/tax-truth-breaks.cjs.
 * Run: node tests/tax-truth.test.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const J = (x) => JSON.stringify(x);

const SHOP = '11111111-1111-4111-8111-111111111111', CUST = '22222222-2222-4222-8222-222222222222';
const ROWS = {
  [SHOP]: { identity_id: SHOP, bridge_id: 'CB-SHOP', display_name: 'Tally Test', country: 'IN', gstn: '33AABCK1234F1Z6', status: 'active', policy_flags: { price_includes_tax: 'yes' } },
  [CUST]: { identity_id: CUST, bridge_id: 'CB-CUST', display_name: 'Chola Auto Care', country: 'IN', gstn: '29BBBBB0000B1Z5', status: 'active', policy_flags: {} },
};

/* ── the database, stubbed (the shape tests/two-sided-bill.test.cjs uses) ────────────────────────────────────────── */
function rowsFor(sql, p) {
  const s = String(sql);
  if (/to_regprocedure\('chit_deliver/.test(s)) return [{ ok: true }];
  /* GET /api/till/bills — the shop's stored copy, as the route reads it */
  if (/h\.sender_entity_id = \$1 AND h\.purpose IN/.test(s)) return BILL_ROWS;
  if (/business_json->>'client_ref' = \$2/.test(s)) return [];
  if (/FROM customer_list/.test(s) && /customer_identity_id = \$2/.test(s)) return String(p && p[1]) === CUST ? [{ ok: 1 }] : [];
  if (/FROM supplier_list/.test(s)) return [];
  if (/SELECT self_copy_pref/.test(s)) return [{ self_copy_pref: null }];
  if (/FROM identities/.test(s) && /identity_id = ANY/.test(s)) return (p[0] || []).map((id) => ROWS[id]).filter(Boolean);
  if (/FROM identities/.test(s) && /identity_id = \$1/.test(s)) { const r = ROWS[p && p[0]]; return r ? [r] : []; }
  return [];
}
let BILL_ROWS = [];
const dbPath = require.resolve(path.join(API, 'db'));
const tx = { query: async (s, p) => ({ rows: rowsFor(s, p) }) };
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async (s, p) => ({ rows: rowsFor(s, p) }),
  withEntity: async (id, fn) => fn(tx), withTransaction: async (fn) => fn(tx),
  trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } },
  onEntity: async (id, db, fn) => fn(tx),
} };
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: Object.assign(
  (req, res, next) => { req.identity = { identity_id: SHOP, identity_type: 'entity', bridge_id: 'CB-SHOP', display_name: 'Tally Test' }; req.api_key = { scopes: ['till'] }; next(); },
  { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (q, s, n) => n(),
    userOf: (req) => req.identity, forgetKey: () => {}, keyAlive: async () => true }) };
const mint = require(path.join(API, 'lib', 'mint'));
let COPIES = null;
mint.deliver = async (sender, chit_id, copies) => { COPIES = copies; return { ok: true }; };
const hooks = require(path.join(API, 'lib', 'books-hooks'));
const classify = hooks.classify;
hooks.afterChit = () => Promise.resolve({});
try { require(path.join(API, 'lib', 'meter')).meter = async () => {}; } catch (_) {}
require(path.join(API, 'lib', 'tax-shelf')).readShelf = async () => null;
try { require(path.join(API, 'lib', 'stock-from-chit')).postFor = async () => ({ failed: [], skipped: [] }); } catch (_) {}
const TC = require(path.join(API, 'lib', 'tax-copy'));
const T = require(path.join(API, 'lib', 'tax-lines'));
const I = require(path.join(API, 'lib', 'issued-invoice'));
const CBTAX = require(path.join(API, 'lib', 'tax.js'));
const MONEY = require(path.join(API, 'lib', 'money'));
const r2 = (n) => MONEY.round(Number(n) || 0);

/* ── the counter page, its own functions in a sandbox ─────────────────────────────────────────────────────────────── */
const PAGE = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8').replace(/\r\n/g, '\n');
const PROG = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.js'), 'utf8').replace(/\r\n/g, '\n');
function fnText(src, sig) {
  const at = src.indexOf(sig);
  if (at < 0) throw new Error(sig + ' is gone from the source — this test is measuring nothing');
  const end = src.indexOf('\n}\n', at);
  return src.slice(at, end + 2);
}
const PAGE_FNS = ['function billMoney(', 'function moneyOf(', 'async function finish(', 'function chitOf(',
  'function billRecipients(', 'function billSendTo(', 'function isReturnRow(', 'function isExpenseRow(', 'function slipOfRow(',
  'function reprintOld(', 'function slipHTML(', 'function taxSummaryHTML(', 'function cartCount(', 'function taxIncluded('];

/** one bill rung at the counter: the page's finish() over a cart, as it runs in a browser — returns what it saved and printed */
async function ring(o) {
  const saved = {}, el = (v) => ({ value: v || '', textContent: '', className: '', innerHTML: '', classList: { remove() {}, add() {} }, showModal() {}, close() {}, open: false });
  const els = { tendered: el(''), cname: el(o.cust ? o.cust.name : ''), cphone: el(o.cust ? '9840012345' : ''), lastnote: el(''), billsdlg: el('') };
  const ctx = {
    window: {}, console, Object, Array, String, Number, JSON, Math, Date, Promise,
    CBTax: o.noEngine ? undefined : CBTAX,
    MONEY: () => MONEY, r2, esc: (v) => String(v == null ? '' : v), money: (v) => '₹' + (Number(v) || 0).toFixed(2),
    S: { shop: { name: 'Tally Test', gstin: '33AABCK1234F1Z6', state_code: '33', country: 'IN', reg_type: 'regular' },
         policy: { price_includes_tax: o.inclusive === false ? 'no' : 'yes' } },
    STATE: { till: { name: 'Counter 2' } }, ls: { get: (k, d) => d }, WHO: { id: 'u1', name: 'Athi', kind: 'entity' },
    CART: o.cart.map((c) => Object.assign({}, c)), PARTS: [], PAY_ASKED: false, PICKED: o.cust ? 'On credit' : 'Cash',
    BILL_DELIVERY: o.delivery || null, RW: { holder: null, points: 0, worth: 0, spend: 0, says: null, seq: 0 }, LAST: null, LASTNO: null, EARLIER: [],
    shopTax: () => ({ charges: true, kind: 'tax' }), tillStopped: async () => false, booksOn: () => true,
    custKnown: () => (o.cust ? { identity_id: CUST, entity_id: CUST, name: o.cust.name, gstin: '29BBBBB0000B1Z5' } : null),
    creditSinceRefresh: async () => {}, creditLimitCheck: () => ({ known: false }), ownerApprove: async () => null,
    creditDaysOf: () => 15, dueDateFor: () => '2026-10-17', creditCust: () => null, say: (m) => { saved.said = m; },
    ageRecord: () => null, kotOn: () => false, purposeHas: () => false, orderKind: () => 'counter', orderTable: () => null,
    rwProg: () => null, rwEarns: () => 0, rewardOnSlip: () => '', CFD: { done() {} }, autoPrint() {}, ageClear() {}, paintParts() {},
    paintRw() {}, price() {}, menuFresh() {}, load() {}, loadQuick() {}, stepGo() {},
    showSlip: (b, m) => { saved.slip = { bill: b, m }; },
    HOST: { bill: async (body) => { saved.called = true; saved.body = JSON.parse(JSON.stringify(body));
      return { ok: true, bill: Object.assign({ no: o.no, at: '2026-10-01T17:32:00.000Z', till: 'C2' }, JSON.parse(JSON.stringify(body))) }; } },
    document: { getElementById: (id) => els[id] || el('') },
  };
  ctx.window.CBTax = ctx.CBTax;
  vm.createContext(ctx);
  vm.runInContext(PAGE_FNS.map((s) => fnText(PAGE, s)).join('\n'), ctx);
  await vm.runInContext('finish()', ctx);
  if (o.noEngine) return { ctx, said: saved.said, called: !!saved.called, last: ctx.LAST, cart: ctx.CART.length };
  const bill = ctx.LAST;
  return { ctx, bill, body: saved.body, said: saved.said, m: saved.slip && saved.slip.m, slip: ctx.slipHTML(bill, saved.slip && saved.slip.m),
           chit: JSON.parse(JSON.stringify(ctx.chitOf(bill))) };
}
const text = (html) => String(html).replace(/<[^>]+>/g, '');

/* ── the bill: C2/26-27/0007's lines (see the header — a reconstruction that prints its totals) ───────────────────── */
const line = (item_id, name, price, qty, save, rate, hsn) => {
  const gross = r2(price * qty), net = r2(gross - save);
  return { item_id, name, unit: 'piece', price, unitPrice: price, qty, gross, save, net, gst_rate: rate, hsn,
           off: save > 0, off_label: save > 0 ? 'Monsoon offer' : '', offs: save > 0 ? [{ offer_id: 'o1', label: 'Monsoon offer', amount: -save }] : [], save_unnamed: 0 };
};
const CART_0007 = [
  line('i1', 'Engine flush 500ml', 78.43, 3, 10.21, 12, '3403'), line('i2', 'Brake fluid DOT4', 113.94, 2, 3.45, 12, '3819'),
  line('i3', 'Coolant 1L', 145.02, 2, 0, 12, '3820'), line('i4', 'Wiper refill', 22.87, 2, 0, 12, '4016'),
  line('i5', 'Polish kit', 329.98, 1, 0, 12, '3405'), line('i6', 'Fuse 10A', 2.88, 1, 0, 18, '8536'),
];

/* ── the server ──────────────────────────────────────────────────────────────────────────────────────────────────── */
const express = require('express');
const app = express(); app.use(express.json());
app.use('/api/chits', require(path.join(API, 'routes', 'chits')));
app.use('/api/till', require(path.join(API, 'routes', 'till')));

/** the six readings of one bill */
async function sixWays(port, o) {
  const r = await ring(o);
  const chitBody = o.mutate ? o.mutate(JSON.parse(JSON.stringify(r.chit))) : r.chit;
  COPIES = null;
  const res = await fetch(`http://127.0.0.1:${port}/api/chits/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: J(chitBody) });
  const sent = await res.json().catch(() => ({}));
  const shopCopy = (COPIES || []).find((c) => c.entity_id === SHOP), custCopy = (COPIES || []).find((c) => c.entity_id === CUST);
  const asHdr = (c, status) => c && { chit_id: 'ch-' + o.no, sender_entity_id: c.sender_entity_id || SHOP, all_recipients: c.all_recipients,
    business_json: c.business_json, purpose: c.purpose, line_items: c.line_items, currency_code: 'INR', current_status: status,
    sent_at: '2026-10-01T17:32:05.000Z', created_at: '2026-10-01T17:32:05.000Z', summary_json: c.summary_json };
  const sHdr = asHdr(shopCopy, 'pending'), cHdr = asHdr(custCopy, 'accepted');
  const sEntry = sHdr ? await TC.entryFor(sHdr, SHOP) : null, cEntry = cHdr ? await TC.entryFor(cHdr, CUST) : null;
  const setting = { enabled: true, country: 'IN', walkin_grain: 'day' };
  const sPost = sEntry ? classify({ chit: sHdr, entry: sEntry, setting }) : null;
  const cPost = cEntry ? classify({ chit: cHdr, entry: cEntry, setting, status: 'accepted' }) : null;
  /* the reprint: the row the real GET /api/till/bills returns from the stored copy, through the page's own reprintOld() */
  BILL_ROWS = shopCopy ? [{ chit_id: 'ch-' + o.no, created_at: '2026-10-01T17:32:05.000Z', business_json: shopCopy.business_json,
    line_items: shopCopy.line_items, summary_json: shopCopy.summary_json }] : [];
  const listed = await (await fetch(`http://127.0.0.1:${port}/api/till/bills`)).json().catch(() => ({}));
  const row = ((listed && listed.bills) || [])[0] || null;
  let reprint = null;
  if (row) {
    const ctx = r.ctx; ctx.EARLIER = [JSON.parse(J(row))]; let shown = null;
    ctx.showSlip = (b, m) => { shown = { b, m }; };
    vm.runInContext('reprintOld(' + J(row.no) + ')', ctx);
    reprint = shown ? { bill: shown.b, html: ctx.slipHTML(shown.b, shown.m) } : null;
  }
  return { r, res, sent, shopCopy, custCopy, sEntry, cEntry, sPost, cPost, row, reprint };
}

/** the figures of an INV-01 invoice, per rate — what every reading is compared by */
const figOfInv = (inv) => {
  const by = {}; for (const it of (inv && inv.ItemList) || []) {
    const k = String(it.GstRt), o = by[k] || (by[k] = { taxable: 0, cgst: 0, sgst: 0, igst: 0 });
    o.taxable = r2(o.taxable + it.AssAmt); o.cgst = r2(o.cgst + it.CgstAmt); o.sgst = r2(o.sgst + it.SgstAmt); o.igst = r2(o.igst + it.IgstAmt);
  }
  const v = (inv && inv.ValDtls) || {};
  return { by, taxable: r2(v.AssVal), tax: r2(r2(v.CgstVal) + r2(v.SgstVal) + r2(v.IgstVal)), total: r2(v.TotInvVal),
           supply: inv && inv._cb && inv._cb.supply, pos: inv && inv.BuyerDtls && inv.BuyerDtls.Pos };
};
const figOfBill = (b) => {
  const by = {}; Object.keys(b.by_rate || {}).forEach((k) => { const x = b.by_rate[k];
    by[k] = { taxable: r2(x.base), cgst: r2(x.cgst || 0), sgst: r2(x.sgst || 0), igst: r2(x.igst || 0) }; });
  return { by, taxable: r2(b.taxable), tax: r2(b.tax), total: r2(b.total), supply: b.supply, pos: b.pos_state };
};
const figOfPost = (ev, total) => {
  const by = {}; (ev.by_rate || []).forEach((x) => { by[String(x.rate)] = { taxable: r2(x.taxable), cgst: r2(x.cgst), sgst: r2(x.sgst), igst: r2(x.igst) }; });
  const rows = ev.by_rate || [];
  const tax = r2(rows.reduce((a, x) => a + x.cgst + x.sgst + x.igst, 0)), taxable = r2(rows.reduce((a, x) => a + x.taxable, 0));
  return { by, taxable, tax, total: r2(taxable + tax + (ev.round_off || 0)) };
};
/** a slip's GST summary, read back off the paper */
const slipSays = (html, b) => {
  const s = text(html), inter = b.supply === 'inter', out = [];
  Object.keys(b.by).forEach((k) => {
    const x = b.by[k];
    out.push([k + '%', '₹' + x.taxable.toFixed(2), '₹' + (inter ? x.igst : x.cgst).toFixed(2), inter ? '' : '₹' + x.sgst.toFixed(2)].join(''));
  });
  out.push('TOTAL₹' + b.total.toFixed(2));
  if (b.pos) out.push('Place of supply' + b.pos);
  return out.filter((x) => s.indexOf(x) < 0);
};
const same = (a, b) => J(a) === J(b);
const pick = (f, ks) => Object.fromEntries(ks.map((k) => [k, f[k]]));

const srv = app.listen(0, '127.0.0.1', async () => {
  const port = srv.address().port;
  try {
    console.log('\n══ ONE INVOICE, EVERYWHERE — bill C2/26-27/0007 read six ways ══\n');
    const W = await sixWays(port, { no: 'C2/26-27/0007', cart: CART_0007, cust: { name: 'Chola Auto Care' } });
    const want = { by: { 12: { taxable: 995.77, cgst: 59.76, sgst: 59.75, igst: 0 }, 18: { taxable: 2.44, cgst: 0.22, sgst: 0.22, igst: 0 } },
                   taxable: 998.21, tax: 119.95, total: 1118.16, supply: 'intra', pos: '33' };
    const b = W.r.bill || {};

    /* 1 · the counter's bill */
    const f1 = figOfBill(b);
    ok('1 the COUNTER\'s bill: taxable 998.21 · CGST/SGST 59.76/59.75 at 12% and 0.22/0.22 at 18% · total 1118.16 · intra · place of supply 33',
      same(f1, want), J(f1));
    ok('…the bill\'s invoice IS CBTax.determine()\'s result — the INV-01 shape, the figures above read off it',
      b.invoice && b.invoice.ValDtls && b.invoice.ItemList && b.invoice._cb && same(figOfInv(b.invoice), want) && same(b.invoice, W.r.m && W.r.m.invoice)
      && Object.keys(b.invoice).join() === 'TranDtls,SellerDtls,BuyerDtls,ItemList,ValDtls,_cb', J(b.invoice && Object.keys(b.invoice)));
    ok('…to the paisa (tax-packs v1.10.0): TotInvVal 1118.16 = AssVal + the heads, RndOffAmt 0; the line nets sum to 1118.15',
      b.invoice.ValDtls.TotInvVal === 1118.16 && b.invoice.ValDtls.RndOffAmt === 0 && b.round_off === 0
      && r2(b.lines.reduce((a, l) => a + l.net, 0)) === 1118.15, J([b.invoice.ValDtls, b.round_off]));
    ok('…the invoice names its parties: the shop (GSTIN, state 33), the buyer (GSTIN 29…, B2B) with Pos = the place of supply 33',
      b.invoice.SellerDtls.Gstin === '33AABCK1234F1Z6' && b.invoice.SellerDtls.State === '33' && b.invoice.BuyerDtls.Gstin === '29BBBBB0000B1Z5'
      && b.invoice.BuyerDtls.LglNm === 'Chola Auto Care' && b.invoice.BuyerDtls.Pos === '33' && b.invoice.TranDtls.SupTyp === 'B2B', J([b.invoice.SellerDtls, b.invoice.BuyerDtls]));
    ok('…each line on the bill reads its ItemList entry (taxable = AssAmt, tax = its heads), line for line',
      b.lines.every((l, i) => { const it = b.invoice.ItemList[i]; return it && l.taxable === it.AssAmt && l.tax === r2(it.CgstAmt + it.SgstAmt + it.IgstAmt + it.CesAmt); }),
      J(b.lines.map((l) => [l.taxable, l.tax])));
    ok('…and the printed slip says so: the rate rows, TOTAL ₹1118.16, place of supply 33', slipSays(W.r.slip, want).length === 0, J(slipSays(W.r.slip, want)));

    /* 2 · the chit as stored */
    const sc = W.shopCopy || {}, sbj = sc.business_json || {};
    ok('2 the CHIT as stored: sent (200), the shop\'s copy carries determine()\'s invoice UNCHANGED', W.res.status === 200 && same(sbj.invoice, b.invoice), W.res.status + ' ' + J(W.sent).slice(0, 200));
    const mm = (sc.summary_json && sc.summary_json.money) || {}, vd = b.invoice.ValDtls;
    ok('…summary_json.money is MAPPED off ValDtls: taxable = AssVal, tax = the heads, total = TotInvVal, round-off = RndOffAmt, savings = Discount, gross = Σ TotAmt',
      mm.taxable === vd.AssVal && mm.tax === r2(vd.CgstVal + vd.SgstVal + vd.IgstVal + vd.CesVal) && mm.total === vd.TotInvVal && mm.round_off === vd.RndOffAmt
      && mm.savings === vd.Discount && mm.gross === r2(b.invoice.ItemList.reduce((a, it) => a + it.TotAmt, 0)) && mm.issued === true && mm.provisional === false, J(mm));
    ok('…its value is the invoice total 1118.16 — the copy (chit_detail.total_value), the summary, the money block (not the 1118.15 of the line nets)',
      sc.total_value === 1118.16 && sc.summary_json && sc.summary_json.total_value === 1118.16 && mm.total === 1118.16 && mm.tax === 119.95,
      J([sc.total_value, sc.summary_json && sc.summary_json.total_value, mm]));
    ok('…the customer\'s copy carries the same invoice and lines', W.custCopy && same(W.custCopy.business_json.invoice, b.invoice) && same(W.custCopy.line_items, sc.line_items));
    ok('…and the server\'s check agrees with the counter: no tax_check on the chit, a passing one on each entry',
      !sbj.tax_check && W.sEntry && W.sEntry.tax_check && W.sEntry.tax_check.ok && W.cEntry && W.cEntry.tax_check && W.cEntry.tax_check.ok,
      J([sbj.tax_check, W.sEntry && W.sEntry.tax_check, W.cEntry && W.cEntry.tax_check]));

    /* 3 · the seller's posting */
    const sev = W.sPost && W.sPost.event || {};
    const f3 = Object.assign(figOfPost(sev), { supply: W.sEntry.invoice._cb.supply, pos: W.sEntry.invoice.BuyerDtls.Pos });
    ok('3 the SELLER\'s posting: sale_bill to Chola, the same rates, heads and total; round-off 0', W.sPost && W.sPost.kind === 'post' && sev.type === 'sale_bill'
      && sev.party === CUST && same(f3, want) && sev.round_off === 0 && sev.paid && Object.keys(sev.paid).length === 0, J([W.sPost && W.sPost.kind, sev.type, f3, sev.round_off]));
    ok('…its invoice is the issued one (frozen, not provisional), output CGST + SGST — never IGST', W.sEntry.issued && W.sEntry.frozen && !W.sEntry.provisional
      && T.heads(W.sEntry.invoice).igst === 0 && T.heads(W.sEntry.invoice).cgst === 59.98 && T.heads(W.sEntry.invoice).sgst === 59.97, J(T.heads(W.sEntry.invoice)));
    ok('…GSTR-1 reports it b2b to the buyer\'s GSTIN, place of supply 33, under the bill\'s number, value 1118.16', (() => {
      const g = T.gstr1(T.ledger([W.sEntry], W.sEntry.me), W.sEntry.me, '102026');
      const e = (g.b2b[0] || {}).inv || [];
      return g.b2b.length === 1 && g.b2b[0].ctin === '29BBBBB0000B1Z5' && e[0] && e[0].pos === '33' && e[0].inum === 'C2/26-27/0007' && e[0].val === 1118.16;
    })());

    /* 4 · the buyer's posting */
    const cev = W.cPost && W.cPost.event || {};
    const f4 = Object.assign(figOfPost(cev), { supply: W.cEntry.invoice._cb.supply, pos: W.cEntry.invoice.BuyerDtls.Pos });
    ok('4 the BUYER\'s posting on acceptance: purchase_bill from Tally Test, the same rates, heads and total', W.cPost && W.cPost.kind === 'post' && cev.type === 'purchase_bill'
      && cev.party === SHOP && same(f4, want) && cev.round_off === 0, J([W.cPost && W.cPost.kind, cev.type, f4]));
    ok('…input CGST + SGST on the buyer\'s side too (the invoice as issued is what ITC rests on, s.16)',
      (() => { const l = T.ledger([W.cEntry], W.cEntry.me); return l.itc.cgst === 59.98 && l.itc.sgst === 59.97 && l.itc.igst === 0; })());

    /* 5 · the reprint */
    const rb = W.reprint && W.reprint.bill || {};
    const f5 = figOfBill(rb);
    ok('5 the REPRINT (Earlier bills → print) is the original: the same figures, the same paper', same(f5, want) && slipSays(W.reprint.html, want).length === 0,
      J([f5, W.reprint && slipSays(W.reprint.html, want)]));
    ok('…no line prints "Gross ₹0.00", and no "GST ₹0.00" on a tax invoice', W.reprint && !/Gross₹0\.00/.test(text(W.reprint.html)) && !/GST₹0\.00/.test(text(W.reprint.html)),
      text(W.reprint && W.reprint.html).slice(0, 400));

    /* 6 · the buyer's invoice read */
    const inv6 = W.cEntry.invoice;
    const f6 = figOfInv(inv6);
    ok('6 the BUYER\'s invoice read (/api/tax/invoice): the same figures, place of supply 33', same(f6, want) && T.heads(inv6).total === 1118.16 && T.heads(inv6).tax === 119.95, J([f6, T.heads(inv6)]));
    ok('…the buyer is named on the invoice (GSTIN, legal name — the snapshot\'s customer), the seller is the shop', inv6.BuyerDtls.Gstin === '29BBBBB0000B1Z5' && inv6.BuyerDtls.LglNm === 'Chola Auto Care'
      && inv6.SellerDtls.Gstin === '33AABCK1234F1Z6' && inv6.TranDtls.SupTyp === 'B2B', J([inv6.BuyerDtls, inv6.SellerDtls]));
    ok('ALL SIX agree to the paisa', [f1, figOfInv(sbj.invoice), f3, f4, f5, f6].every((f) => same(f, want)), J([f1, figOfInv(sbj.invoice), f3, f4, f5, f6]));

    console.log('\n── variants ──\n');
    /* a delivery to another state → IGST everywhere */
    const D = await sixWays(port, { no: 'C2/26-27/0011', cart: CART_0007, cust: { name: 'Chola Auto Care' }, delivery: { state_code: '29', address: 'Bengaluru' } });
    const wantD = { by: { 12: { taxable: 995.77, cgst: 0, sgst: 0, igst: 119.51 }, 18: { taxable: 2.44, cgst: 0, sgst: 0, igst: 0.44 } },
                    taxable: 998.21, tax: 119.95, total: 1118.16, supply: 'inter', pos: '29' };
    const fD = [figOfBill(D.r.bill),
      Object.assign(figOfPost(D.sPost.event), { supply: D.sEntry.invoice._cb.supply, pos: D.sEntry.invoice.BuyerDtls.Pos }),
      Object.assign(figOfPost(D.cPost.event), { supply: D.cEntry.invoice._cb.supply, pos: D.cEntry.invoice.BuyerDtls.Pos }),
      figOfBill(D.reprint.bill), figOfInv(D.cEntry.invoice)];
    ok('a bill RECORDING a delivery to state 29 is inter-state: IGST in the bill, both postings, the reprint and the buyer\'s read',
      fD.every((f) => same(f, wantD)) && D.sEntry.tax_check.ok && slipSays(D.reprint.html, wantD).length === 0, J(fD));
    ok('…the delivery travels on the chit', D.shopCopy && D.shopCopy.business_json.delivery && D.shopCopy.business_json.delivery.state_code === '29');

    /* an exclusive-price shop */
    ROWS[SHOP].policy_flags = { price_includes_tax: 'no' };
    const X = await sixWays(port, { no: 'C2/26-27/0012', cart: CART_0007, cust: { name: 'Chola Auto Care' }, inclusive: false });
    ROWS[SHOP].policy_flags = { price_includes_tax: 'yes' };
    const xb = X.r.bill;
    const fX = [figOfBill(xb), Object.assign(figOfPost(X.sPost.event), { supply: X.sEntry.invoice._cb.supply, pos: X.sEntry.invoice.BuyerDtls.Pos }),
      Object.assign(figOfPost(X.cPost.event), { supply: X.cEntry.invoice._cb.supply, pos: X.cEntry.invoice.BuyerDtls.Pos }), figOfBill(X.reprint.bill), figOfInv(X.cEntry.invoice)];
    ok('an EXCLUSIVE-price shop: tax added on top (taxable 1118.15), and all readings agree; the server\'s check agrees',
      xb.taxable === 1118.15 && xb.total === r2(xb.taxable + xb.tax) && fX.every((f) => same(f, fX[0])) && X.sEntry.tax_check.ok && X.shopCopy.total_value === xb.total,
      J(fX.concat([X.sEntry.tax_check])));

    /* a walk-in */
    const K = await sixWays(port, { no: 'C2/26-27/0013', cart: CART_0007.slice(0, 2) });
    const kb = K.r.bill, kw = figOfBill(kb);
    const kSlip = K.sPost && K.sPost.bill;
    ok('a WALK-IN: one copy, place of supply 33, intra; the shop\'s day posting carries the bill\'s rates; the reprint is the original',
      !K.custCopy && kw.pos === '33' && kw.supply === 'intra' && K.sPost.kind === 'walkin'
      && same(Object.fromEntries((kSlip.taxes || []).map((x) => [String(x.rate), { taxable: x.taxable, cgst: x.cgst, sgst: x.sgst, igst: x.igst }])), kw.by)
      && same(figOfBill(K.reprint.bill), kw) && same(figOfInv(K.sEntry.invoice), kw) && K.shopCopy.total_value === kb.total,
      J([kw, K.sPost, figOfInv(K.sEntry.invoice)]));

    /* a bill with no invoice — an older bill, or another host */
    const O = await sixWays(port, { no: 'C2/26-27/0005', cart: CART_0007, cust: { name: 'Chola Auto Care' }, mutate: (c) => {
      delete c.business_json.invoice; return c; } });
    ok('a bill with NO invoice keeps the old path: provisional, recomputed, total = the line nets (1118.15), no check',
      O.sEntry && !O.sEntry.issued && O.sEntry.provisional && O.sEntry.tax_check === null && O.shopCopy.total_value === 1118.15, J([O.sEntry && O.sEntry.issued, O.shopCopy && O.shopCopy.total_value]));
    ok('…its place of supply is still the SHOP\'s state (33 → CGST + SGST), not the buyer\'s (29): both copies',
      O.sEntry.invoice.BuyerDtls.Pos === '33' && O.sEntry.invoice._cb.supply === 'intra' && O.cEntry.invoice.BuyerDtls.Pos === '33' && O.cEntry.invoice._cb.supply === 'intra',
      J([O.sEntry.invoice.BuyerDtls, O.sEntry.invoice._cb.supply, O.cEntry.invoice.BuyerDtls, O.cEntry.invoice._cb.supply]));
    ok('…and its reprint says the tax detail was not kept — never GST ₹0.00 on a tax invoice',
      O.reprint && /Tax detail not kept for this bill/.test(text(O.reprint.html)) && !/GST₹0\.00/.test(text(O.reprint.html)), text(O.reprint && O.reprint.html).slice(0, 500));

    /* a stored figure the server disagrees with */
    const Z = await sixWays(port, { no: 'C2/26-27/0014', cart: CART_0007, cust: { name: 'Chola Auto Care' }, mutate: (c) => {
      const iv = c.business_json.invoice, it = iv.ItemList[0], sl = iv._cb.slabs.find((x) => x.GstRt === 12), v = iv.ValDtls;
      it.CgstAmt = r2(it.CgstAmt + 0.01); it.SgstAmt = r2(it.SgstAmt + 0.01); it.TotItemVal = r2(it.TotItemVal + 0.02);
      sl.CgstVal = r2(sl.CgstVal + 0.01); sl.SgstVal = r2(sl.SgstVal + 0.01);
      v.CgstVal = r2(v.CgstVal + 0.01); v.SgstVal = r2(v.SgstVal + 0.01); v.TotInvVal = r2(v.TotInvVal + 0.02); return c; } });
    const zf = figOfInv(Z.sEntry.invoice);
    ok('a stored figure the server\'s recompute DISAGREES with: the stored one is kept (tax 119.97, total 1118.18) on both copies, the money and the reprint',
      zf.tax === 119.97 && zf.total === 1118.18 && figOfInv(Z.cEntry.invoice).tax === 119.97 && Z.shopCopy.total_value === 1118.18
      && Z.shopCopy.summary_json.money.tax === 119.97 && figOfBill(Z.reprint.bill).total === 1118.18, J([zf, Z.shopCopy && Z.shopCopy.total_value]));
    const zd = (Z.sEntry.tax_check && Z.sEntry.tax_check.differences) || [];
    ok('…and the difference is NAMED: on the entry, and on the stored chit (business_json.tax_check, kept: issued)',
      Z.sEntry.tax_check.ok === false && zd.some((d) => d.what === 'tax at 12%' && d.issued === 119.53 && d.server === 119.51)
      && zd.some((d) => d.what === 'total' && d.issued === 1118.18 && d.server === 1118.16)
      && Z.shopCopy.business_json.tax_check && Z.shopCopy.business_json.tax_check.kept === 'issued'
      && Z.shopCopy.business_json.tax_check.differences.some((d) => d.what === 'tax at 12%'), J([zd, Z.shopCopy && Z.shopCopy.business_json.tax_check]));

    console.log('\n── one computation, one rule, one shape ──\n');
    const BM = fnText(PAGE, 'function billMoney('), MO = fnText(PAGE, 'function moneyOf(');
    ok('billMoney() computes nothing of its own: it calls CBTax.determine() and reads the answer (no split, no heads, no supply decision)',
      /CBTax\.determine\(/.test(BM) && !/splitLineTax|lineHeads|supplyType|\* ?100|\/ ?\(100/.test(BM + MO), 'billMoney or moneyOf works a figure out again');
    ok('…and with no engine there is no invoice — never a second formula (zeros, no invoice to save)', (() => {
      const ctx = { r2, CBTax: undefined, window: {} }; vm.createContext(ctx); vm.runInContext(MO, ctx);
      const m = ctx.moneyOf(null); return m.net === 0 && m.tax === 0 && m.base === 0 && m.heads.length === 0;
    })());
    ok('…and with the engine MISSING, finish() refuses the sale: it says what happened and what to do, saves nothing, keeps the cart',
      await (async () => { const n = await ring({ no: 'C2/26-27/0099', cart: CART_0007, cust: { name: 'Chola Auto Care' }, noEngine: true });
        return n.said === 'Prices cannot be worked out on this counter right now.\n\nPress refresh while online.' && !n.called && n.last === null && n.cart === CART_0007.length; })());
    ok('the place-of-supply rule is the ENGINE\'s, with no copy: no placeOfSupply in till.html or lib/issued-invoice; the counter calls CBTax.placeOfSupply',
      !/function placeOfSupply\(/.test(PAGE) && !/function placeOfSupply\(/.test(fs.readFileSync(path.join(API, 'lib', 'issued-invoice.js'), 'utf8'))
      && /CBTax\.placeOfSupply\(/.test(BM) && /require\('\.\/tax'\)\.placeOfSupply|placeOfSupply \} = require\('\.\/tax'\)/.test(fs.readFileSync(path.join(API, 'lib', 'tax-copy.js'), 'utf8')));
    ok('…over the counter is the shop\'s state; a recorded delivery is its state; a bad state code is ignored',
      CBTAX.placeOfSupply({}, '33') === '33' && CBTAX.placeOfSupply({ delivery: { state_code: '29' } }, '33') === '29' && CBTAX.placeOfSupply({ delivery: { state_code: 7 } }, '33') === '07'
      && CBTAX.placeOfSupply({ delivery: { state_code: 'KA' } }, '33') === '33' && CBTAX.placeOfSupply(null, '33') === '33');
    ok('the reading of an issued invoice is the ENGINE\'s moneyOf on both hosts: the counter maps CBTax.moneyOf, the server\'s summary_json.money is its header fields',
      /CBTax\.moneyOf\(/.test(MO) && !/\breduce\(|\+ ?\(|r2\(/.test(MO) && (() => { const e = CBTAX.moneyOf(b.invoice, 'INR');
        return mm.gross === e.gross && mm.savings === e.savings && mm.net === e.net && mm.taxable === e.taxable && mm.tax === e.tax && mm.total === e.total && mm.round_off === e.round_off
          && b.total === e.total && b.taxable === e.taxable && b.tax === e.tax && b.saved === e.savings && same(b.heads, e.heads); })(),
      'a reading of the invoice was worked out somewhere other than CBTax.moneyOf');
    ok('lib/issued-invoice keeps only the check', Object.keys(I).sort().join() === 'check', Object.keys(I).join());
    /* the shop-PC program builds its own chit from the same bill */
    const pctx = { tillCfg: { id: 'C2', name: 'Counter 2' }, os: { hostname: () => 'SHOP-PC' }, Object, String, Array, JSON };
    vm.createContext(pctx); vm.runInContext(fnText(PROG, 'function chitOf(bill) {'), pctx);
    const progChit = JSON.parse(J(pctx.chitOf(W.r.bill)));
    ok('the shop-PC program\'s chitOf carries the SAME invoice as the page\'s, unchanged',
      same(progChit.business_json.invoice, W.r.chit.business_json.invoice) && same(progChit.business_json.invoice, b.invoice), J(progChit.business_json.invoice).slice(0, 200));
  } catch (e) { fail++; console.log('   FAIL the test ran   ' + (e && e.stack)); }
  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  srv.close(); process.exit(fail ? 1 : 0);
});
