// books-at.spec.js — [BOOKS-01] AN ORDER GOES TO THE BOOKS ON A TRIGGER, AND THE TASK SAYS SO. Athi, 2026-09-06: "each task cannot be done on its own,
// there must be some trigger to be allowed to go to Tally, from the task; also there must be a detail somewhere in the task that it has
// been written to Tally". The entity's policy (Orders go to the books) rides the connector's heartbeat; the kit's gate is a pure function
// (core.booksGate) checked here for every setting × state; the kit's write-back lands on MY copy and the Task prints it.
const { test, expect } = require('@playwright/test');
const { mintEntity, clickNav, settle } = require('../fixtures');
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';

test('[BOOKS-01] the trigger rides the heartbeat; the gate waits or goes; the write-back shows on the Task', async ({ page, request }) => {
  test.setTimeout(240000);
  await mintEntity(page, { fresh: true, name: 'Books ' + Date.now().toString().slice(-6) });

  /* the gate, every setting × state — the very function the kit runs */
  const core = require('../../../chitbridge-api/tools/tally-connector/core.js');
  const g = (st, at, asked) => core.booksGate({ header: { current_status: st, business_json: asked ? { books_request: { at: 'x' } } : {} } }, { books_at: at });
  expect(g('pending', 'received').go).toBe(true);
  expect(g('pending', 'accepted').go).toBe(false); expect(g('accepted', 'accepted').go).toBe(true); expect(g('in_progress', 'accepted').go).toBe(true);
  expect(g('accepted', 'completed').go).toBe(false); expect(g('completed', 'completed').go).toBe(true);
  expect(g('completed', 'manual').go).toBe(false); expect(g('pending', 'manual', true).go).toBe(true);
  expect(g('cancelled', 'received').go).toBe(false); expect(g('rejected', 'manual', true).go).toBe(false);

  /* the policy on the heartbeat */
  const key = (await page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin'); return api('keysMint', { body: { name: 'store pc', scopes: ['connector', 'services'], days: 1 } }); })).key;
  /* the server's own registry (lib/policy.js) is the authority; PATCH /entities/policy is the one write — a profile PATCH drops undeclared keys */
  await page.evaluate(async () => { await api('policySet', { body: { books_at: 'manual' } }); });
  const hb = await request.post(API + '/api/integrations/heartbeat', { headers: { 'X-Api-Key': key }, data: { name: 'Tally connector', adapter: 'tally', host: 'STORE-PC', version: '1.0.0', note: 'watch' } });
  /* the policy the kit is told grows over time (books_overdue_hours joined it on 2026-09-07) — assert the TRIGGER, not the payload */
  expect((await hb.json()).policy.books_at, 'the heartbeat carries the trigger').toBe('manual');
  await page.evaluate(async (id) => { await api('intApprove', { params: { id } }); }, (await hb.json()).actor_id);

  /* a sale recorded, then the kit's write-back, then the Task */
  const chitId = await page.evaluate(async () => {
    const r = await fetch(CFG.API_BASE + '/api/chits/send', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SESSION.token },
      body: JSON.stringify({ recipients: [{ self: true, name: 'self' }], subject: 'counter sale', manual_subject: 'counter sale', purpose: 'order', business_json: { customer: 'Walk-in' }, line_items: [{ particulars: 'Grapes', unit: 'kg', quantity: 1, price: 200, total: 200 }] }) });
    const j = await r.json(); return j.chit_id || (j.chit && j.chit.chit_id);
  });
  expect(chitId).toBeTruthy();
  const wb = await request.post(API + '/api/integrations/books', { headers: { 'X-Api-Key': key }, data: { chit_id: chitId, kind: 'order', system: 'tally', ref: 'CB-' + chitId.slice(0, 8), outcome: 'ok', why: 'accepted' } });
  expect(wb.status(), 'the write-back lands').toBe(200);
  await clickNav(page, 'task'); await settle(page);
  await page.evaluate((id) => openChit(id), chitId); await settle(page);
  const sTab = page.getByTestId('dtab-status'); if (await sTab.isVisible().catch(() => false)) { await sTab.click(); await settle(page); }
  const block = page.getByTestId('books-block'); await block.waitFor({ timeout: 30000 });
  await expect(block, 'the Task says it was written').toContainText('Written to tally');
  await expect(block).toContainText('CB-' + chitId.slice(0, 8));
});
