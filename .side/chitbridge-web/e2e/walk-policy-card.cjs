#!/usr/bin/env node
/**
 * e2e/walk-policy-card.cjs — the WORKSHOP's Business rules card (app.html › Settings › Policy, cap-admin.js policyFlagsCard), WALKED (R121b, 2026-10-24).
 * The card used to save the moment a box changed (setPolFlag on onchange). It now draws and writes through the SAME path as CB Settings › Policy
 * (CBSettings.policyControl · policyEditButtons · policyRowEdit · policyRun, app/cap-settings.js): a row is a draft; Save asks first; Cancel writes nothing.
 * Black box, a stand-in api answering inside the page (nothing leaves the runner):
 *   P1  change a rule -> nothing is sent; Save and Cancel appear; Cancel puts the old value back and still nothing is sent
 *   P2  change -> Save -> the page confirm (confirmAsk) says "Change … from … to …?" -> No sends nothing; Yes -> ONE PATCH, the row says Saved, the card repaints from the server
 *   P3  a rule the platform sets: locked, no control, no Save
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-policy-card.cjs [--show]
 */
'use strict';
const W = require('./lib/walk.cjs');
const C = require('./lib/contract.cjs');
const J = C.json;

const walk = async (w) => {
  const { page, ctx } = w;
  const calls = [];
  const FLAGS = { books_at: 'accepted', tol_weight_bp: 50, dispute_scope: 'per-party', connectors_in_use: [] };
  const ui = (order, label, more) => Object.assign({ label, level: 'entity', gov: 'entity', order, help: '' }, more || {});
  const SCHEMA = {
    books_at: { type: 'enum', options: ['received', 'accepted', 'completed', 'manual'], def: 'accepted', ui: ui(1, 'Orders go to the books') },
    tol_weight_bp: { type: 'number', def: 50, ui: ui(2, 'Short delivery allowed (weighed goods)', { scale: 100, suffix: '%', step: 0.01 }) }
  };
  const BOUND_SCHEMA = { dispute_scope: { type: 'enum', options: ['per-party', 'shared'], def: 'per-party', ui: ui(3, 'Dispute messages', { level: 'platform', gov: 'bound' }) } };
  const ok = { ok: true, code: null, why: null };
  await ctx.route('**/api/**', async (r) => {
    const q = r.request(), p = new URL(q.url()).pathname, m = q.method();
    let body = null; try { body = q.postData() ? JSON.parse(q.postData()) : null; } catch (_) {}
    if (p === '/api/entities/policy' && m === 'GET') return J(r, 200, { flags: FLAGS, schema: SCHEMA, bound: { dispute_scope: 'per-party' }, bound_schema: BOUND_SCHEMA, may: { books_at: ok, tol_weight_bp: ok } });
    if (p === '/api/entities/policy' && m === 'PATCH') { calls.push(JSON.stringify(body)); Object.assign(FLAGS, body); return J(r, 200, { flags: FLAGS }); }
    if (p === '/api/entities/me') return J(r, 200, { entity: { display_name: 'Fixture Shop', country_code: 'IN', currency_code: 'INR' } });
    return J(r, 200, {});
  });
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Fixture Owner', 'Fixture Shop'));

  const IN = '#sx_pol_tol_weight_bp', SAVE = '#sx_pol_save_tol_weight_bp', CANCEL = '#sx_pol_cancel_tol_weight_bp', OK = '#sx_pol_ok_tol_weight_bp';
  const vis = (sel) => page.locator(sel).isVisible().catch(() => false);
  const txt = (sel) => page.locator(sel).first().innerText().then((s) => s.replace(/\s+/g, ' ').trim()).catch(() => '');
  await page.goto(w.base + '/app.html'); await page.waitForTimeout(1500);
  await page.evaluate(async () => { await ensureCap('admin'); navTo('settings'); setSetSec('policy'); });
  await page.waitForSelector(IN, { timeout: 20000 });

  await w.step('P1', 'change a rule on the card -> nothing is sent; Save and Cancel appear; Cancel puts 0.5 back and still nothing is sent', async () => {
    const before = await vis(SAVE);
    await page.fill(IN, '0.75'); await page.dispatchEvent(IN, 'change'); await page.dispatchEvent(IN, 'blur'); await page.waitForTimeout(500);
    const shown = (await vis(SAVE)) && (await vis(CANCEL)), onChange = calls.length;
    await page.click(CANCEL); await page.waitForTimeout(300);
    const back = await page.inputValue(IN), gone = !(await vis(SAVE));
    return { ok: !before && shown && onChange === 0 && back === '0.5' && gone && calls.length === 0, saw: 'buttons before ' + before + ' · after edit ' + shown + ' · PATCH on change ' + onChange + ' · after Cancel "' + back + '" gone ' + gone + ' · PATCH ' + calls.length };
  });
  await w.step('P2', 'change -> Save -> the confirm says "Change … from 0.5 % to 0.75 %?" -> No sends nothing; Yes -> one PATCH { tol_weight_bp: 75 }, the row says Saved', async () => {
    await page.fill(IN, '0.75'); await page.dispatchEvent(IN, 'change'); await page.click(SAVE);
    await page.waitForSelector('[data-testid="confirm-cancel"]', { timeout: 5000 });
    const ask = await txt('.modal .mhd');
    await page.click('[data-testid="confirm-cancel"]'); await page.waitForTimeout(400);
    const afterNo = calls.length;
    await page.click(SAVE); await page.waitForSelector('[data-testid="confirm-cancel"]', { timeout: 5000 }); await page.click('#_cfmok'); await page.waitForTimeout(600);
    const out = await txt(OK), now = await page.inputValue(IN);
    return { ok: /Change .*from 0\.5.* to 0\.75/.test(ask) && afterNo === 0 && calls.length === 1 && /"tol_weight_bp":75/.test(calls[0]) && /Saved/.test(out) && now === '0.75', saw: '"' + ask.slice(0, 70) + '" · after No ' + afterNo + ' · ' + calls.length + ' PATCH ' + (calls[0] || '') + ' · "' + out + '" · box "' + now + '"' };
  });
  await w.step('P3', 'a rule the platform sets is locked: no control, no Save', async () => {
    const control = await page.locator('#sx_pol_dispute_scope').count(), save = await page.locator('#sx_pol_save_dispute_scope').count();
    return { ok: control === 0 && save === 0, saw: 'control ' + control + ' · Save ' + save };
  });
  if (w.errs.length) w.note('T99', 'page errors seen during the walk', w.errs.slice(0, 3).join(' | '));
};
walk.opts = { viewport: { width: 1366, height: 900 } };
W.run('policy-card', walk);
