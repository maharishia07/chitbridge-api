// profile-map.spec.js — [PRO-01] The profile from their system: the map of what we look for, filled by the connector from the store's own
// CARD  23-connectors-and-integrations/profile-map
// records (here profile.csv; Tally's company master answers the same shape), each value copied with source + date, then
// CHECKED where a check can be done alone (GSTIN check digit, PAN inside the GSTIN, state = GSTIN state, PIN in that
// state) — and a held higher rung is never overwritten by a lower one. Athi, 2026-09-05.
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { mintEntity } = require('../fixtures');
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';
const KIT = path.resolve(__dirname, '..', '..', '..', 'chitbridge-api', 'tools', 'tally-connector');

test('[PRO-01] the profile map: filled from the store\'s system, checked, ranked, shown', async ({ page, request }) => {
  test.setTimeout(240000);
  const core = require(path.join(KIT, 'core.js'));
  const csvAdapter = require(path.join(KIT, 'adapters', 'csv.js'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-profile-'));
  fs.copyFileSync(path.join(KIT, 'samples', 'profile.csv'), path.join(work, 'profile.csv'));
  await mintEntity(page, { fresh: true });
  const key = await page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin'); return (await api('keysMint', { body: { name: 'profile spec', scopes: ['connector', 'services'], days: 1 } })).key; });
  const log = (m) => console.log('[profile] ' + m);
  const cb = new core.CB({ api: API, key, log }); cb.name = 'profile spec';
  const adapter = csvAdapter({ csv: { profile: path.join(work, 'profile.csv') }, log });
  const receipts = new core.Receipts(path.join(work, 'receipts.jsonl'));

  await test.step('BEFORE — the map exists with mostly missing fields', async () => {
    const m = await (await request.get(API + '/api/integrations/profile-map', { headers: { 'X-Api-Key': key } })).json();
    expect(m.total).toBeGreaterThanOrEqual(14); expect(m.fields.gstin.missing).toBe(true);
  });

  await test.step('FILL — sync-profile copies name · GSTIN · state · address …; the GSTIN check digit raises it to checked', async () => {
    const r = await core.syncProfile({ cb, adapter, receipts, log });
    expect(r.written).toContain('gstin'); expect(r.written).toContain('legal_name'); expect(r.issues.length).toBe(0);
    const f = r.fields;
    expect(f.gstin.value).toBe('33AABCK1234F1Z6'); expect(f.gstin.rung).toBe('checked'); expect(f.gstin.source).toBe('csv');
    expect(f.pan.rung).toBe('checked'); expect(f.state.rung).toBe('checked'); expect(f.pincode.rung).toBe('checked');
    expect(f.legal_name.rung).toBe('copied'); expect(r.state_name).toBe('Tamil Nadu');
  });

  await test.step('AUTHENTICITY — a wrong check digit is caught; a lower rung never overwrites a higher', async () => {
    const bad = await (await request.post(API + '/api/integrations/profile', { headers: { 'X-Api-Key': key }, data: { source: 'csv', fields: { gstin: '33AABCK1234F1Z9', legal_name: 'Someone Else Ltd' } } })).json();
    expect(bad.kept.some((k) => k.key === 'gstin')).toBe(true);                  /* checked stands above copied */
    expect(bad.fields.gstin.value).toBe('33AABCK1234F1Z6');
    expect(bad.written).toContain('legal_name');                               /* copied replaces copied when newer */
    const wrong = await (await request.post(API + '/api/integrations/profile', { headers: { 'X-Api-Key': key }, data: { source: 'csv', fields: { pincode: '560001' } } })).json();
    /* the held PIN is 'checked' (it agrees with the GSTIN's state), so a copied Bengaluru PIN cannot displace it — kept, value unchanged */
    expect(wrong.kept.some((k) => k.key === 'pincode')).toBe(true); expect(wrong.fields.pincode.value).toBe('600126'); expect(wrong.fields.pincode.rung).toBe('checked');
  });

  await test.step('THE INVOICE HEADER follows: the supplier block is complete', async () => {
    const p = await page.evaluate(async () => api('profileGet'));
    expect(p.invoice_party.complete).toBe(true); expect(p.invoice_party.state_code).toBe('33'); expect(p.invoice_party.state).toBe('Tamil Nadu'); expect(p.invoice_party.gstin).toBe('33AABCK1234F1Z6');
  });

  await test.step('TRADE READY follows — the invoice-header clearance is gathered at rung documented, and a counterparty sees the same', async () => {
    const rd = await page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('readiness'); return api('readinessOwn'); });
    const item = (rd.clearances || rd.items || []).find((c) => c.doc === 'invoice_header');
    expect(item, 'invoice_header clearance').toBeTruthy(); expect(item.status).toBe('gathered'); expect(item.rung).toBe('documented');
    expect(String(item.guidance || '')).toMatch(/GSTIN check digit and state agree/);
    const me = await page.evaluate(async () => { const m = await api('me'); return (m.entity || m).bridge_id; });
    const other = await page.evaluate(async (b) => api('readinessOf', { params: { bridge_id: b } }), me);
    const seen = (other.clearances || other.items || []).find((c) => c.doc === 'invoice_header');
    expect(seen && seen.rung).toBe('documented');
  });

  await test.step('THE SCREEN — Settings › Integrations shows the map with rungs', async () => {
    await page.evaluate(() => navTo('settings')); await page.waitForTimeout(600);
    await page.getByTestId('set-sec-integrations').click({ timeout: 30000 });
    await expect(page.getByTestId('int-map-gstin')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('int-map-rung-gstin')).toHaveText('checked');
    await expect(page.getByTestId('int-map-gstin')).toContainText('33AABCK1234F1Z6');
  });
  fs.rmSync(work, { recursive: true, force: true });
});
