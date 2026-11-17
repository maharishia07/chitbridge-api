#!/usr/bin/env node
/**
 * e2e/stack-walk.cjs — ONE WALK AGAINST A RUNNING CHITBRIDGE (round HX0: the compose stack, chitbridge-api deploy/compose.yml).
 * Unlike every walk-*.cjs (the site served from this checkout, the API a stand-in inside the page), nothing here is a stand-in: the
 * site is the web container, the API is the production api container, the shop is the one tools/sim-load.cjs put in its Postgres,
 * and the sign-in code is the one the sealed api e-mailed — read back from the stack's mail sink (deploy/mail-sink.cjs, profile proof).
 * NOT named walk-* on purpose: the cloud shards (e2e/run-shard.cjs) run without a stack.
 *
 *   STACK_WEB=http://localhost:8080 STACK_API=http://localhost:3000 STACK_MAIL=http://127.0.0.1:8025 STACK_SHOP=simstores \
 *     NODE_PATH=e2e/node_modules node e2e/stack-walk.cjs
 * HX2: a cloud spin (chitbridge-api deploy/<platform>/test.sh) runs the same walk against its platform; its sink is public, so it
 * answers only to STACK_MAIL_TOKEN (sent as `authorization: Bearer …`; unset = the open compose sink).
 * One line per path; shots e2e/shots/walk-stack-NN.png. Exit 0 = every path passed.
 */
'use strict';
const W = require('./lib/walk.cjs');

const WEB = process.env.STACK_WEB || 'http://localhost:8080';
const API = (process.env.STACK_API || 'http://localhost:3000').replace(/\/+$/, '');
const MAIL = (process.env.STACK_MAIL || 'http://127.0.0.1:8025').replace(/\/+$/, '');
const MAIL_AUTH = process.env.STACK_MAIL_TOKEN ? { authorization: 'Bearer ' + process.env.STACK_MAIL_TOKEN } : {};
const SHOP = process.env.STACK_SHOP || 'simstores';
const T = (s) => '[data-testid="' + s + '"]';

const body = async (w) => {
  const { page, base } = w;
  await w.step('S1', 'Stack -> the web container serves Home, and the site calls the stack\'s api', async () => {
    await page.goto(base + '/');
    await page.waitForSelector(T('cbshell'), { timeout: 20000 });
    const api = await page.evaluate(() => window.CBShell && window.CBShell.apiBase && window.CBShell.apiBase());
    const health = await (await fetch(API + '/health')).json();
    return { ok: api === API && health.environment === 'production' && health.db === 'ok', saw: 'api base ' + api + ' · /health ' + health.environment + ' · db ' + health.db };
  });

  await w.step('S2', 'Stack -> Sign in as ' + SHOP + ' with the code the production api e-mailed', async () => {
    if (!await page.locator(T('signin-id')).count()) await page.click(T('signin-door'));   /* signed out, Home already holds the window */
    await page.waitForSelector(T('signin-id'), { timeout: 15000 });
    await page.fill(T('signin-id'), SHOP);
    const asked = Date.now();
    await page.click(T('signin-go'));
    await page.waitForSelector(T('signin-code') + ', ' + T('signin-why'), { timeout: 15000 });
    if (!await page.locator(T('signin-code')).count()) return { ok: false, saw: 'no code box: ' + await page.locator(T('signin-why')).textContent() };
    let mail = null;
    for (let i = 0; i < 20 && !mail; i++) {
      const r = await fetch(MAIL + '/last?to=' + encodeURIComponent(SHOP + '@test.example'), { headers: MAIL_AUTH });
      if (r.ok) mail = await r.json(); else await page.waitForTimeout(250);
    }
    if (!mail || !mail.code) return { ok: false, saw: 'no mail reached the sink in ' + (Date.now() - asked) + ' ms' };
    await page.fill(T('signin-code'), mail.code);
    await page.click(T('signin-verify'));
    /* on Home the shell takes over once the session is held (the window leaves) — wait for the session, not a control */
    await page.waitForFunction(() => { try { return !!JSON.parse(localStorage.getItem('cb_sess') || 'null').token; } catch (_) { return false; } }, null, { timeout: 15000 }).catch(() => {});
    const sess = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('cb_sess') || 'null'); } catch (_) { return null; } });
    return { ok: !!(sess && sess.token), saw: 'mail "' + mail.subject + '" · ' + (sess && sess.token ? 'session held for ' + (sess.entity || sess.name || '?') : 'no session') };
  });

  await w.step('S3', 'Stack -> signed in, the browser reads the shop from the api across origins (CORS: ALLOWED_ORIGINS)', async () => {
    const me = await page.evaluate(async (api) => {
      const s = JSON.parse(localStorage.getItem('cb_sess') || 'null');
      const r = await fetch(api + '/api/entities/me', { headers: { authorization: 'Bearer ' + s.token } });
      const b = await r.json().catch(() => ({}));
      return { status: r.status, name: (b.entity || b).display_name || null };
    }, API);
    return { ok: me.status === 200 && me.name === 'Simulated Stores', saw: 'GET /api/entities/me ' + me.status + ' · ' + me.name };
  });

  await w.step('S4', 'Stack -> Home again: the shell names the signed-in shop', async () => {
    await page.goto(base + '/');
    await page.waitForSelector(T('cbshell'), { timeout: 20000 });
    await page.waitForFunction(() => /Simulated Stores/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
    const has = await page.evaluate(() => /Simulated Stores/.test(document.body.innerText));
    return { ok: has, saw: has ? '"Simulated Stores" on Home' : 'the shop name is not on Home' };
  });
};
body.opts = { base: WEB };
W.run('stack', body);
