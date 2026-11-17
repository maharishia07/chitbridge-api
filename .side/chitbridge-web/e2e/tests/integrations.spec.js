// integrations.spec.js — [INT-01] Integrations is the home of connectors: the catalogue lists Tally · Zoho · CSV with a download and instructions
// each; the download is a real zip of the kit with connector.json pre-filled (key empty); a running connector's heartbeat
// (with a connector key) appears under "Running connectors". Athi, 2026-09-05: "include the tally connector as a
// downloadable option in the system itself … all should reside as part of integrations".
const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';

test('[INT-01] connectors: catalogue, download, instructions, heartbeat → the Integrations screen', async ({ page, request }) => {
  test.setTimeout(240000);
  await mintEntity(page, { fresh: true });

  await test.step('THE CATALOGUE — three connectors, each with a download and a document', async () => {
    const r = await request.get(API + '/api/integrations/catalogue'); expect(r.status()).toBe(200);
    const ids = (await r.json()).connectors.map((c) => c.id); for (const id of ['tally', 'zoho', 'csv']) expect(ids).toContain(id);
    const d = await request.get(API + '/api/integrations/download/tally?adapter=tally'); expect(d.status()).toBe(200);
    expect(d.headers()['content-type']).toContain('application/zip'); const buf = await d.body(); expect(buf.length).toBeGreaterThan(5000); expect(buf.slice(0, 2).toString()).toBe('PK');
    const text = buf.toString('latin1'); expect(text).toContain('chitbridge-connector/core.js'); expect(text).toContain('chitbridge-connector/connector.json'); expect(text).toContain('PASTE THE KEY');
    const doc = await request.get(API + '/api/integrations/docs/zoho'); expect(doc.status()).toBe(200); expect(await doc.text()).toContain('Zoho Books connector');
  });

  await test.step('THE DOWNLOAD IS THE INSTALLER — signed in, the zip carries a minted key and start.cmd installs Node (Athi, 2026-09-06)', async () => {
    const z = await page.evaluate(async (api) => { const r = await fetch(api + '/api/integrations/download/tally?adapter=tally', { headers: { Authorization: 'Bearer ' + SESSION.token } }); const b = new Uint8Array(await r.arrayBuffer()); let t = ''; for (let i = 0; i < b.length; i++) t += String.fromCharCode(b[i]); return { status: r.status, text: t }; }, API);
    expect(z.status).toBe(200);
    expect(z.text, 'the key is inside').not.toContain('"key": "PASTE THE KEY');   /* start.cmd's own check line carries the words */
    expect(z.text, 'the key is a token').toMatch(/"key": "eyJ[A-Za-z0-9._-]+"/);
    expect(z.text, 'setup runs first').toContain('"configured": false');
    expect(z.text, 'start.cmd installs Node').toContain('OpenJS.NodeJS.LTS');
    expect(z.text, 'START.txt says so').toContain('Your key is already inside connector.json (');
    const keys = await page.evaluate(async () => { const r = await api('keysList'); return (r.keys || []).map((k) => k.name); }).catch(() => null);
    if (keys) expect(keys.some((n) => /^kit tally/.test(n)), 'the minted key is listed under Your keys').toBeTruthy();
  });

  let key = '';
  await test.step('A CONNECTOR CHECKS IN — with a connector key; the screen lists it', async () => {
    const k = await page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin'); return api('keysMint', { body: { name: 'store pc', scopes: ['connector', 'services'], days: 1 } }); });
    key = k.key; expect(key).toBeTruthy();
    const hb = await request.post(API + '/api/integrations/heartbeat', { headers: { 'X-Api-Key': key }, data: { name: 'Tally connector', adapter: 'tally', host: 'STORE-PC', version: '1.0.0', counters: { products_ok: 3, orders_ok: 1, failed: 0 }, note: 'watching' } });
    expect(hb.status()).toBe(200);
    await page.evaluate(async () => { navTo('settings'); }); await page.waitForTimeout(600);
    await page.getByTestId('set-sec-integrations').click({ timeout: 30000 });
    await expect(page.getByTestId('int-connector-tally')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('int-connector-zoho')).toBeVisible();
    await expect(page.getByTestId('int-download-tally-tally')).toBeVisible();
    await expect(page.getByTestId('int-docs-tally')).toBeVisible();
    await expect(page.locator('[data-testid^="int-running-"]').first()).toContainText('STORE-PC', { timeout: 30000 });
    await expect(page.locator('[data-testid^="int-running-"]').first()).toContainText('orders 1');
  });

  await test.step('THE HANDSHAKE — a kit is approved for one PC; a stranger\'s PC waits, a wrong GSTIN stops, the owner approves (Athi, 2026-09-06)', async () => {
    /* this entity has no GSTIN: the kit's PC is unknown → pending; the key may only heartbeat */
    const hb1 = await request.post(API + '/api/integrations/heartbeat', { headers: { 'X-Api-Key': key }, data: { name: 'Tally connector', adapter: 'tally', host: 'STORE-PC', version: '1.0.0', note: 'watch', tally: { company: 'Probe Traders', gstin: '33AAAAA0000A1Z5' } } });
    expect(hb1.status()).toBe(200); const j1 = await hb1.json(); expect(j1.approved, 'unknown PC waits').toBe(false); expect(j1.reason).toMatch(/awaiting/);
    const gated = await request.get(API + '/api/products?limit=1', { headers: { 'X-Api-Key': key } });
    expect(gated.status(), 'a pending key may not read products').toBe(403); expect((await gated.json()).pending).toBe(true);
    /* the row says so, with the PC and the company; the owner approves */
    await page.evaluate(async () => { _INT_RUN = undefined; loadSettings(); }); await page.waitForTimeout(800);
    const row = page.locator('[data-testid^="int-running-"]').first();
    await expect(row).toContainText('waiting for approval', { timeout: 30000 }); await expect(row).toContainText('Probe Traders');
    const approved = page.waitForResponse((r) => /\/approve$/.test(r.url()) && r.request().method() === 'POST', { timeout: 30000 });
    await page.locator('[data-testid^="int-approve-"]').first().click(); expect((await approved).status()).toBe(200);
    const ok = await request.get(API + '/api/products?limit=1', { headers: { 'X-Api-Key': key } });
    expect(ok.status(), 'an approved key reads').not.toBe(403);
    const hb2 = await request.post(API + '/api/integrations/heartbeat', { headers: { 'X-Api-Key': key }, data: { name: 'Tally connector', adapter: 'tally', host: 'STORE-PC', version: '1.0.0', note: 'watch', tally: { company: 'Probe Traders', gstin: '33AAAAA0000A1Z5' } } });
    expect((await hb2.json()).approved, 'the same PC stays approved').toBe(true);
    /* the same key on ANOTHER PC → pending again */
    const hb3 = await request.post(API + '/api/integrations/heartbeat', { headers: { 'X-Api-Key': key }, data: { name: 'Tally connector', adapter: 'tally', host: 'OTHER-SHOP-PC', version: '1.0.0', note: 'watch', tally: { company: 'Someone Else', gstin: '' } } });
    const j3 = await hb3.json(); expect(j3.approved, 'another PC on the same key waits').toBe(false); expect(j3.reason).toMatch(/new PC/);
    /* the account gains a GSTIN: a Tally company with the SAME GSTIN is approved by itself; a different one is stopped */
    await page.evaluate(async () => { await api('saveProfile', { body: { gstn: '33AAAAA0000A1Z5' } }); });
    const hb4 = await request.post(API + '/api/integrations/heartbeat', { headers: { 'X-Api-Key': key }, data: { name: 'Tally connector', adapter: 'tally', host: 'THIRD-PC', version: '1.0.0', note: 'watch', tally: { company: 'Probe Traders', gstin: '33AAAAA0000A1Z5' } } });
    expect((await hb4.json()).reason, 'same GSTIN = the right store, no click').toBe('gstin match');
    const hb5 = await request.post(API + '/api/integrations/heartbeat', { headers: { 'X-Api-Key': key }, data: { name: 'Tally connector', adapter: 'tally', host: 'THIRD-PC', version: '1.0.0', note: 'watch', tally: { company: 'Wrong Shop', gstin: '29BBBBB1111B1Z9' } } });
    const j5 = await hb5.json(); expect(j5.approved).toBe(false); expect(j5.reason, 'a different GSTIN is the wrong store').toMatch(/mismatch/);
  });
});
