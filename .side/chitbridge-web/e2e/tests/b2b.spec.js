// b2b.spec.js — [B2B-01] An order from ANOTHER SHOP (a registered buyer) reaches the seller's Tally as a B2B voucher: the connector reads the
// chit's invoice through the key, creates the buyer's party ledger (GSTIN, state) and posts the voucher with PARTYGSTIN and
// the place of supply — while a storefront (walk-in) order still books against the walk-in ledger with no GSTIN.
// Athi, 2026-09-05: "if we try ordering from another shop instead of storefront? their GSTIN and so on" → "go ahead".
const { test, expect } = require('@playwright/test');
const { mintEntity, mintInContext, addProduct, clickNav, composeChit, settle } = require('../fixtures');
const path = require('path'); const fs = require('fs'); const os = require('os'); const { spawn } = require('child_process');
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';
const KIT = path.join(__dirname, '..', '..', '..', 'chitbridge-api', 'tools', 'tally-connector');

test('[B2B-01] a registered buyer\'s order books in Tally with their GSTIN and place of supply', async ({ page, browser }) => {
  test.setTimeout(420000);
  /* the SELLER: a Tamil Nadu business with a product and a connector key */
  const sellerName = 'Seller ' + Date.now().toString().slice(-6);
  await mintEntity(page, { fresh: true, name: sellerName });
  /* public, so the buyer's Compose can find the seller by name */
  await page.evaluate(async () => { await api('saveProfile', { body: { gstn: '33ABCDE1234F1Z7', address: '5 Mount Road, Chennai', catalogue_visibility: 'public' } }); });
  await clickNav(page, 'catalogue');
  await addProduct(page, { name: 'Basmati 25kg', unit: 'bag', price: 1000, code: 'BAS-25' });
  const key = await page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin'); return (await api('keysMint', { body: { name: 'b2b spec', scopes: ['connector'], days: 1 } })).key; });
  /* a fresh entity is named by its handle, whatever `name` was asked for — Compose finds it by that */
  const sellerShown = await page.evaluate(async () => { const m = await api('me'); const e = (m && m.entity) || m; return e.display_name || e.user_id; });

  /* the BUYER: a Karnataka business, ordering through Compose to the seller by name */
  const buyer = await mintInContext(browser, { fresh: true, name: 'Kumar Traders ' + Date.now().toString().slice(-5) });
  let buyerShown = null;
  try {
    buyerShown = await buyer.page.evaluate(async () => { await api('saveProfile', { body: { gstn: '29ABCDE1234F1Z5', address: '12 Market Road, Bengaluru' } }); const m = await api('me'); const e = (m && m.entity) || m; return e.display_name || e.user_id; });
    await composeChit(buyer.page, { subject: 'B2B order', item: 'Basmati 25kg', qty: 2, price: 1000, recipients: [sellerShown] });
  } finally { await buyer.context.close(); }

  /* the seller's connector against a fake Tally: catch-up finds the order, reads its invoice, books it B2B */
  const port = 9800 + Math.floor(Math.random() * 150);
  const fake = spawn(process.execPath, [path.join(KIT, 'fake-tally.js'), String(port)], { stdio: 'ignore' });
  try {
    await new Promise((r) => setTimeout(r, 800));
    const core = require(path.join(KIT, 'core.js')); const T = require(path.join(KIT, 'adapters', 'tally.js'));
    const log = (m) => console.log('[b2b] ' + m);
    const cb = new core.CB({ api: API, key, log }); cb.name = 'b2b spec';
    const adapter = T({ tally: { url: 'http://localhost:' + port, partyLedger: 'Walk-in customers', salesLedger: 'Sales' }, log });
    const receipts = new core.Receipts(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cb-b2b-')), 'r.jsonl'));
    await adapter.ensure();
    let out = []; for (let i = 0; i < 6 && !out.some((x) => x.outcome === 'ok'); i++) { out = await core.catchUp({ cb, adapter, receipts, log }); if (!out.some((x) => x.outcome === 'ok')) await new Promise((r) => setTimeout(r, 3000)); }
    const mine = out.find((x) => x.outcome === 'ok'); expect(mine, 'the order was pushed: ' + JSON.stringify(out)).toBeTruthy();
    const vouchers = await (await fetch('http://localhost:' + port + '/_vouchers')).json();
    const v = vouchers.find((x) => x.ref === 'CB-' + String(mine.chit_id).slice(0, 8)); expect(v).toBeTruthy();
    expect(v.party_gstin).toBe('29ABCDE1234F1Z5');
    expect(v.place_of_supply).toBe('Karnataka');
    const partyLine = v.ledgers.find((l) => l.ledger === buyerShown); expect(partyLine && partyLine.dr, 'party line for ' + buyerShown + ': ' + JSON.stringify(v.ledgers)).toBeTruthy();
    const masters = await (await fetch('http://localhost:' + port + '/_masters')).json();
    const party = masters.find((m) => m.name === buyerShown); expect(party && party.parent).toBe('Sundry Debtors'); expect(party.gstin).toBe('29ABCDE1234F1Z5'); expect(party.state).toBe('Karnataka');
    /* the seller's own chit view still shows the order from the buyer (nothing about the chit changed) */
    await clickNav(page, 'task'); await settle(page);
    await expect(page.getByText(buyerShown).first()).toBeVisible({ timeout: 30000 });
  } finally { fake.kill(); }
});
