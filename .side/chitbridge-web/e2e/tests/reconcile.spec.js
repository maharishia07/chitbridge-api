// reconcile.spec.js — [REC-01] ONE OWNER PER STREAM, AND A RECONCILIATION THAT SAYS WHAT LANDED. Athi, 2026-09-07: "say quantity gets posted in ERP, sales
// record in Tally and possibly Zoho CRM — will it not confuse the purpose?" and "need to be sure of reconciliation … do we have a
// mechanism to check if not posted before the next day?". Two connectors check in: the first claims the streams it can carry, the second
// is told they are taken, and the owner hands one over in Settings. Then an order walks waiting → due → booked, and the counts say so.
const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';

test('[REC-01] streams are claimed once, handed over on request, and reconciliation counts what reached the books', async ({ page, request }) => {
  test.setTimeout(300000);
  await mintEntity(page, { fresh: true, name: 'Rec ' + Date.now().toString().slice(-6) });

  /* the kit's own gate is a pure function — it must let its own streams through and refuse another connector's */
  const core = require('../../../chitbridge-api/tools/tally-connector/core.js');
  expect(core.ownsStream({ owns: ['order', 'products'] }, 'order'), 'mine').toBe(true);
  expect(core.ownsStream({ owns: ['order'] }, 'stock'), "another connector's").toBe(false);
  expect(core.ownsStream({}, 'order'), 'an older API answers nothing → carry everything, as before').toBe(true);

  const mint = (name) => page.evaluate(async (n) => { if (typeof ensureCap === 'function') await ensureCap('admin'); return api('keysMint', { body: { name: n, scopes: ['connector', 'services'], days: 1 } }); }, name);
  const beat = (key, body) => request.post(API + '/api/integrations/heartbeat', { headers: { 'X-Api-Key': key }, data: body }).then((r) => r.json());
  const STREAMS = ['products', 'stock', 'profile', 'order', 'receipt'];

  let first, second;
  await test.step('THE FIRST CONNECTOR CLAIMS WHAT IT CARRIES — nobody is asked a question', async () => {
    first = (await mint('books pc')).key;
    const hb = await beat(first, { id: 'kit-books', name: 'Books connector', adapter: 'tally', host: 'BOOKS-PC', version: '1.0.0', note: 'watch', streams: STREAMS });
    expect(hb.approved, 'no GSTIN either side → it waits, and a waiting kit claims nothing').toBe(false);
    await page.evaluate(async (id) => { await api('intApprove', { params: { id } }); }, hb.actor_id);
    const hb2 = await beat(first, { id: 'kit-books', name: 'Books connector', adapter: 'tally', host: 'BOOKS-PC', version: '1.0.0', note: 'watch', streams: STREAMS });
    expect(hb2.approved).toBe(true);
    expect(hb2.owns.sort(), 'an approved connector claims every free stream it carries').toEqual(STREAMS.slice().sort());
    expect(hb2.stream_owner.order).toBe('kit-books');
  });

  await test.step('THE SECOND FINDS THEM TAKEN — the same order is never booked twice', async () => {
    second = (await mint('pos pc')).key;
    const hb = await beat(second, { id: 'kit-pos', name: 'POS connector', adapter: 'gofrugal', host: 'POS-PC', version: '1.0.0', note: 'watch', streams: ['products', 'stock', 'order'] });
    await page.evaluate(async (id) => { await api('intApprove', { params: { id } }); }, hb.actor_id);
    const hb2 = await beat(second, { id: 'kit-pos', name: 'POS connector', adapter: 'gofrugal', host: 'POS-PC', version: '1.0.0', note: 'watch', streams: ['products', 'stock', 'order'] });
    expect(hb2.owns, 'every stream it carries already has an owner').toEqual([]);
    expect(hb2.stream_owner.products, 'and it is told who has them').toBe('kit-books');
  });

  await test.step('THE OWNER HANDS ONE OVER — what a migration does on its last day', async () => {
    const put = await page.evaluate(async () => api('intStreamsSet', { body: { stock: 'kit-pos' } }));
    expect(put.owner.stock).toBe('kit-pos');
    expect(put.owner.order, 'only the named stream moves').toBe('kit-books');
    const hb = await beat(second, { id: 'kit-pos', name: 'POS connector', adapter: 'gofrugal', host: 'POS-PC', version: '1.0.0', note: 'watch', streams: ['products', 'stock', 'order'] });
    expect(hb.owns, 'the connector learns it on its next heartbeat, with nobody at the PC').toEqual(['stock']);
    const back = await beat(first, { id: 'kit-books', name: 'Books connector', adapter: 'tally', host: 'BOOKS-PC', version: '1.0.0', note: 'watch', streams: STREAMS });
    expect(back.owns.indexOf('stock'), 'and the one that had it stops carrying it').toBe(-1);
  });

  let chitId;
  await test.step('AN ORDER WALKS: waiting for the trigger → due → in the books', async () => {
    await page.evaluate(async () => { await api('policySet', { body: { books_at: 'manual' } }); });
    chitId = await page.evaluate(async () => {
      const r = await fetch(CFG.API_BASE + '/api/chits/send', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SESSION.token },
        body: JSON.stringify({ recipients: [{ self: true, name: 'self' }], subject: 'counter sale', manual_subject: 'counter sale', purpose: 'order', business_json: { customer: 'Walk-in' }, line_items: [{ particulars: 'Grapes', unit: 'kg', quantity: 1, price: 200, total: 200 }] }) });
      const j = await r.json(); return j.chit_id || (j.chit && j.chit.chit_id);
    });
    expect(chitId).toBeTruthy();
    const one = async () => { const r = await page.evaluate(async () => api('intReconcile', { query: { days: 1 } })); return { r, row: (r.rows || []).find((x) => x.chit_id === chitId) }; };

    let s = await one();
    expect(s.r.books_at).toBe('manual');
    expect(s.r.overdue_hours, 'overdue is a policy, and it is reported').toBeGreaterThan(0);
    expect(s.row.state, 'manual: nothing is released until someone presses Send to books').toBe('waiting');

    await page.evaluate(async (id) => api('chitBooks', { params: { id } }), chitId);
    s = await one();
    expect(s.row.state, 'asked by hand → released, and the clock starts').toBe('due');
    expect(s.row.released_at).toBeTruthy();

    const wb = await request.post(API + '/api/integrations/books', { headers: { 'X-Api-Key': first }, data: { chit_id: chitId, kind: 'order', system: 'tally', ref: 'CB-' + chitId.slice(0, 8), outcome: 'ok', why: 'sent to books by hand' } });
    expect(wb.status()).toBe(200);
    s = await one();
    expect(s.row.state).toBe('booked');
    expect(s.row.ref).toBe('CB-' + chitId.slice(0, 8));
    expect(s.r.counts.booked).toBeGreaterThanOrEqual(1);
    expect(s.r.by_system.tally).toBeGreaterThanOrEqual(1);
  });

  await test.step('A REFUSAL IS NAMED, NOT SWALLOWED — and a second answer does not hide the first', async () => {
    await request.post(API + '/api/integrations/books', { headers: { 'X-Api-Key': second }, data: { chit_id: chitId, kind: 'order', system: 'zoho', outcome: 'failed', why: 'IGST has to be applied as this is an interstate transaction' } });
    const r = await page.evaluate(async () => api('intReconcile', { query: { days: 1 } }));
    const row = (r.rows || []).find((x) => x.chit_id === chitId);
    expect(row.state, 'the newer answer is what the Task shows').toBe('refused');
    expect(row.why).toContain('IGST');
    const log = await page.evaluate(async (id) => { const c = await api('chit', { params: { id } }); const h = c.header || c.chit || c; return (h.business_json || {}).books_log || []; }, chitId);
    expect(log.length, 'both answers are kept — a duplicate SHOWS instead of hiding behind the newer row').toBeGreaterThanOrEqual(2);
    expect(log.map((x) => x.system).sort()).toEqual(['tally', 'zoho']);
  });

  await test.step('AND IT IS ALL ON ONE SCREEN — Settings › Integrations', async () => {
    await page.evaluate(async () => { navTo('settings'); }); await page.waitForTimeout(600);
    await page.getByTestId('set-sec-integrations').click({ timeout: 30000 });
    /* Integrations is six panes now, reached from the rail like Governance's layers (2026-09-07) */
    await page.getByTestId('int-tab-streams').click({ timeout: 30000 });
    await page.waitForSelector('[data-testid="int-stream-order"]', { timeout: 30000 });
    await page.getByTestId('int-tab-books').click({ timeout: 30000 });
    await expect(page.locator('[data-testid="int-rec-booked"]'), 'the counts are on the screen').toBeVisible();
    await expect(page.locator('[data-testid="int-rec-refused"]')).toBeVisible();
    await expect(page.locator('[data-testid="int-rec-row-' + chitId.slice(0, 8) + '"]'), 'and the refused order is listed with a way to ask again').toBeVisible();
  });
});
