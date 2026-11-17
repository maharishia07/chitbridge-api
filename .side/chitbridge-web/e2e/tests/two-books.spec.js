// two-books.spec.js — [B2B-02] ONE CHIT, TWO BOOKS. A Karnataka buyer orders from a Tamil Nadu seller through Compose. The seller's connector
// books a Sales voucher in the seller's (fake) Tally; the buyer marks the chit completed and the buyer's connector books a
// Purchase voucher in the buyer's (fake) Tally — the seller as a supplier with GSTIN, the material created, the same
// CB-<8> reference on both vouchers. Athi, 2026-09-05: "the sales record from the seller needs to be added into the buyer
// system — materials, qty and so on; attach the receipt, the GST claim, the arithmetic."
const { test, expect } = require('@playwright/test');
const { mintEntity, mintInContext, addProduct, clickNav, composeChit } = require('../fixtures');
const path = require('path'); const fs = require('fs'); const os = require('os'); const { spawn } = require('child_process');
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';
const KIT = path.join(__dirname, '..', '..', '..', 'chitbridge-api', 'tools', 'tally-connector');
const fakeTally = (port) => spawn(process.execPath, [path.join(KIT, 'fake-tally.js'), String(port)], { stdio: 'ignore' });
const getJ = (port, p) => fetch('http://localhost:' + port + p).then((r) => r.json());

test('[B2B-02] one chit books the seller\'s Sales and the buyer\'s Purchase, same reference', async ({ page, browser }) => {
  test.setTimeout(480000);
  const sellerName = 'Seller ' + Date.now().toString().slice(-6);
  await mintEntity(page, { fresh: true, name: sellerName });
  await page.evaluate(async () => { await api('saveProfile', { body: { gstn: '33ABCDE1234F1Z7', address: '5 Mount Road, Chennai', catalogue_visibility: 'public' } }); });
  await clickNav(page, 'catalogue');
  await addProduct(page, { name: 'Idli Rice 25kg', unit: 'bag', price: 1200, code: 'IDL-25' });
  const sellerKey = await page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin'); return (await api('keysMint', { body: { name: 'two-books seller', scopes: ['connector'], days: 1 } })).key; });
  const sellerShown = await page.evaluate(async () => { const m = await api('me'); const e = (m && m.entity) || m; return e.display_name || e.user_id; });

  const buyer = await mintInContext(browser, { fresh: true, name: 'Kumar Traders ' + Date.now().toString().slice(-5) });
  let buyerKey = null, buyerShown = null, chitId = null;
  try {
    buyerShown = await buyer.page.evaluate(async () => { await api('saveProfile', { body: { gstn: '29ABCDE1234F1Z5', address: '12 Market Road, Bengaluru' } }); const m = await api('me'); const e = (m && m.entity) || m; return e.display_name || e.user_id; });
    buyerKey = await buyer.page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin'); return (await api('keysMint', { body: { name: 'two-books buyer', scopes: ['connector'], days: 1 } })).key; });
    await composeChit(buyer.page, { subject: 'Two books', item: 'Idli Rice 25kg', qty: 4, price: 1200, recipients: [sellerShown] });
    chitId = await buyer.page.evaluate(async () => { const s = await api('sent'); const rows = s.chits || s.rows || (Array.isArray(s) ? s : []); const r = rows.find((x) => /Two books/.test(String(x.manual_subject || x.auto_subject || ''))); return r && (r.chit_id || r.id); });
    expect(chitId, 'the buyer sees the order in Order').toBeTruthy();
  } catch (e) { await buyer.context.close(); throw e; }

  const core = require(path.join(KIT, 'core.js')); const T = require(path.join(KIT, 'adapters', 'tally.js'));
  const pA = 9300 + Math.floor(Math.random() * 40), pB = pA + 50; const fA = fakeTally(pA), fB = fakeTally(pB);
  try {
    await new Promise((r) => setTimeout(r, 900));
    const log = (m) => console.log('[two-books] ' + m);
    /* the SELLER's connector → Sales in Tally A */
    const cbS = new core.CB({ api: API, key: sellerKey, log }); cbS.name = 'seller connector';
    const adS = T({ tally: { url: 'http://localhost:' + pA, partyLedger: 'Walk-in customers', salesLedger: 'Sales' }, log });
    const rS = new core.Receipts(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cb-tb-s-')), 'r.jsonl'));
    await adS.ensure();
    let out = []; for (let i = 0; i < 6 && !out.some((x) => x.chit_id === chitId && x.outcome === 'ok'); i++) { out = await core.catchUp({ cb: cbS, adapter: adS, receipts: rS, log }); if (!out.some((x) => x.chit_id === chitId && x.outcome === 'ok')) await new Promise((r) => setTimeout(r, 3000)); }
    const sale = (await getJ(pA, '/_vouchers')).find((v) => v.ref === 'CB-' + chitId.slice(0, 8));
    expect(sale && sale.vtype, 'the Sales voucher in the seller\'s Tally').toBe('Sales');
    expect(sale.party_gstin).toBe('29ABCDE1234F1Z5');

    /* the SELLER completes the order (goods delivered — a status change is the receiver's act; it is logged on the buyer's
       copy too) → the buyer's connector sees it on its own copy and books the Purchase in Tally B */
    const st = await page.evaluate(async (id) => { try { return await api('status', { params: { id }, body: { status: 'completed' } }); } catch (e) { return { error: e && e.message }; } }, chitId);
    expect(st && !st.error, 'the seller completed the chit: ' + JSON.stringify(st)).toBeTruthy();
    const cbB = new core.CB({ api: API, key: buyerKey, log }); cbB.name = 'buyer connector';
    const adB = T({ role: 'buyer', tally: { url: 'http://localhost:' + pB, role: 'buyer' }, log });
    const rB = new core.Receipts(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cb-tb-b-')), 'r.jsonl'));
    await adB.ensure();
    let pur = []; for (let i = 0; i < 6 && !pur.some((x) => x.chit_id === chitId && x.outcome === 'ok'); i++) { pur = await core.syncPurchases({ cb: cbB, adapter: adB, receipts: rB, log }); if (!pur.some((x) => x.chit_id === chitId && x.outcome === 'ok')) await new Promise((r) => setTimeout(r, 3000)); }
    const mine = pur.find((x) => x.chit_id === chitId); expect(mine && mine.outcome, 'the purchase booked: ' + JSON.stringify(pur)).toBe('ok');
    const purchase = (await getJ(pB, '/_vouchers')).find((v) => v.vtype === 'Purchase' && v.ref === 'CB-' + chitId.slice(0, 8));
    expect(purchase, 'the Purchase voucher in the buyer\'s Tally').toBeTruthy();
    expect(purchase.party_gstin).toBe('33ABCDE1234F1Z7');
    expect(purchase.place_of_supply).toBe('Karnataka');
    expect(purchase.ref).toBe(sale.ref);   /* the same reference in both books — the three-way match */
    const masters = await getJ(pB, '/_masters');
    expect(masters.find((m) => m.name === sellerShown && m.parent === 'Sundry Creditors' && m.gstin === '33ABCDE1234F1Z7'), 'the seller is a supplier in the buyer\'s Tally').toBeTruthy();
    /* the buyer typed the line in Compose without a unit, so the material is created with the unit as it came ('nos') */
    expect(masters.find((m) => m.kind === 'item' && m.name === 'Idli Rice 25kg'), 'the material was created in the buyer\'s Tally: ' + JSON.stringify(masters.filter((m) => m.kind === 'item'))).toBeTruthy();
    const supplierLine = purchase.ledgers.find((l) => l.ledger === sellerShown); expect(supplierLine && !supplierLine.dr && Number(supplierLine.amount) === 4800, 'the supplier is credited 4800 (no slab on the seller: tax 0)').toBeTruthy();
  } finally { fA.kill(); fB.kill(); await buyer.context.close(); }
});
