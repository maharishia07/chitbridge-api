#!/usr/bin/env node
// @type: system
/**
 * e2e/walk-shop-switch-tabs.cjs — SEC-85 IN REAL TABS: one page, one shop (2026-10-23).
 *
 * ⚠️ NEEDS web PR #372 (public/app/device-id.js, SEC-85) IN THE CHECKOUT IT SERVES. Without it step 3 fails by design: the old tab's
 * Save still writes to the shop it left. Run it only once #372 is in main (or point CB_WEB_DIR at #372's worktree).
 *
 * #372's own tests (e2e/shop-switch.cjs, device-id.cjs) run in a vm sandbox, no real tabs. This walk uses ONE browser context with TWO
 * pages (so they share localStorage and get the `storage` event, as two tabs of one browser do) against the LOCAL stack (api :3100,
 * web :8124 = this checkout via toolset/serve-local.cjs) — never production. Both shops are made on the local api (register is also
 * sign-in with the dev code), each signs in through app.html's own sign-in form.
 *
 *   Part 1 · the switch   S1 A signs in, opens Print setup, edits (unsaved) · S2 B signs in, other tab, same browser
 *                         S3 A: the cover within 6 s; Save sends NO write; neither shop's vault changed
 *                         S4 A: Reload → A acts as B (session, bar, calls); a Save then writes B's vault only
 *   Part 2 · FALSE POSITIVES (a false positive blocks every Save — the most important part; none may show the cover)
 *                         F1 one tab: sign in, reload, three Saves · F2 two tabs of the SAME shop both Save
 *                         F3 sign out and in again, same tab (and the other shop in the same tab, then a fresh page)
 *                         F4 the till (till.html) must not load device-id.js and must show no cover
 *
 *   NODE_PATH=e2e/node_modules node e2e/walk-shop-switch-tabs.cjs            headless, against http://localhost:8124 + :3100
 *   CB_WEB_BASE=http://localhost:8124 CB_API_BASE=http://localhost:3100 (both must be local; anything else is refused)
 * One line per step: "ID · PASS/FAIL (what it saw)". Screenshots: e2e/shots/walk-shop-switch-tabs-NN.png. Exit 1 on any FAIL.
 */
'use strict';
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');
const { signinCode, apiIsLocal } = require('./lib/signin-code.cjs');

const WEB = (process.env.CB_WEB_BASE || 'http://localhost:8124').replace(/\/$/, '');
const API = (process.env.CB_API_BASE || 'http://localhost:3100').replace(/\/$/, '');
if (!apiIsLocal(API) || !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(WEB)) { console.error('local stack only: CB_WEB_BASE and CB_API_BASE must be localhost'); process.exit(2); }
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const SHOP_A = { email: 'wt-shop-a@local.test', name: 'wt-shop-a' }, SHOP_B = { email: 'wt-shop-b@local.test', name: 'wt-shop-b' };
const COVER = '#cb-shop-switched', SENTENCE = 'You signed in as another shop in another tab. Reload to continue.';
const T = (s) => '[data-testid="' + s + '"]';
/** a text no earlier run saved, so each save is a real change */
const fresh = (s) => s + Date.now();   // clock-ok: a unique text suffix, not a business date
const results = [];
let shotNo = 0;

function record(id, ok, saw) { results.push(ok); console.log(id + ' · ' + (ok ? 'PASS' : 'FAIL') + ' (' + saw + ')'); }
async function shot(page, what) { const f = path.join(SHOTS, 'walk-shop-switch-tabs-' + String(++shotNo).padStart(2, '0') + '.png'); await page.screenshot({ path: f }); console.log('   shot ' + path.basename(f) + ' — ' + what); return f; }

/** j(path, { method, token, body }) → { status, b } — a plain call to the local api */
function j(p, o) {
  o = o || {};
  return new Promise((res, rej) => {
    const u = new URL(API + p), body = o.body === undefined ? null : JSON.stringify(o.body);
    const q = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: o.method || (body ? 'POST' : 'GET'),
      headers: Object.assign({ 'content-type': 'application/json' }, o.token ? { authorization: 'Bearer ' + o.token } : {}) }, (r) => {
      let s = ''; r.setEncoding('utf8'); r.on('data', (c) => { s += c; });
      r.on('end', () => { let b = null; try { b = JSON.parse(s); } catch (e) { b = { raw: s.slice(0, 200) }; } res({ status: r.statusCode, b }); });
    });
    q.on('error', rej); if (body) q.write(body); q.end();
  });
}
/** the two shops exist on the local api (register is also sign-in with the dev code) and hold a token the walk reads their vaults with */
async function ensureShop(shop) {
  await j('/api/entities/register', { body: { email: shop.email, display_name: shop.name } });
  const v = await j('/api/entities/verify', { body: { email: shop.email, otp: signinCode('entity', API) } });
  if (v.status !== 200 || !v.b.token) throw new Error('cannot make ' + shop.email + ' on the local api: ' + v.status);
  shop.id = (v.b.entity && (v.b.entity.id || v.b.entity.identity_id)) || ''; shop.readToken = v.b.token;
}
/** the vault a shop holds now (what Print setup's Save writes: PUT /api/governance/profile/vault), read by the api — never by the page under test */
async function vaultOf(shop) { const r = await j('/api/governance/profile', { token: shop.readToken }); return JSON.stringify({ v: r.b.vault || null, n: r.b.vault_version || null }); }

/** one write seen on the wire: who sent it (page tag), the verb, the path, and what the api answered (0 = never answered) */
function watch(ctx, log) {
  ctx.on('request', (rq) => { const u = rq.url(); if (u.startsWith(API) || u.startsWith(WEB + '/api/')) if (!/^(GET|HEAD|OPTIONS)$/.test(rq.method())) log.push({ tag: rq.frame().page().__tag, m: rq.method(), p: new URL(u).pathname, status: 0 }); });
  ctx.on('response', (rs) => { const rq = rs.request(), hit = log.find((x) => x.status === 0 && x.m === rq.method() && rs.url().endsWith(x.p)); if (hit) hit.status = rs.status(); });
}
const writesOf = (log, tag) => log.filter((x) => x.tag === tag && !/\/(signin|verify|register|entities\/verify|session)/.test(x.p));
const covered = (p) => p.locator(COVER).count().then((n) => n > 0);

/** app.html's own sign-in form: #l_id → Continue (#l_go) → #l_otp → Verify (#l_go); ends when cb_sess holds the shop */
async function signIn(page, email) {
  await page.goto(WEB + '/app.html');
  /* a browser that already holds a shop opens signed in: a person signs out first (the app's own logoutNow), then signs in */
  if (!(await page.waitForSelector('#l_id', { timeout: 6000 }).then(() => true, () => false))) { await page.waitForSelector('#root *', { timeout: 15000 }); await page.evaluate(() => logoutNow()); }
  await page.waitForSelector('#l_id', { timeout: 20000 });
  await page.fill('#l_id', email); await page.click('#l_go');
  await page.waitForSelector('#l_otp', { timeout: 20000 });
  await page.fill('#l_otp', signinCode('entity', API)); await page.click('#l_go');
  await page.waitForFunction(() => { try { return !!JSON.parse(localStorage.getItem('cb_sess') || 'null').token; } catch (e) { return false; } }, null, { timeout: 20000 });
  await page.waitForTimeout(800);
}
const sessOf = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('cb_sess') || 'null'); } catch (e) { return null; } });
const shopOfSess = (page) => page.evaluate(() => { try { return window.CBDevice ? window.CBDevice.shopOf(JSON.parse(localStorage.getItem('cb_sess')).token) : ''; } catch (e) { return ''; } });
/** Print setup open on settings.html (the Save is CBAction + the vault patch); `footer` typed so the next Save HAS something to write */
async function openPrint(page, footer) {
  await page.goto(WEB + '/settings.html#/print');
  await page.waitForSelector(T('pr-save'), { timeout: 25000 });
  if (footer != null) { await page.fill(T('pr-in-footer'), footer); await page.dispatchEvent(T('pr-in-footer'), 'change'); }
}
/** press Save through the page (the cover, when up, sits over the button — a person would only reach the Reload) */
async function pressSave(page) { await page.evaluate(() => document.querySelector('[data-testid="pr-save"]').click()); await page.waitForTimeout(1800); }
const waitCover = (page, ms) => page.waitForSelector(COVER, { timeout: ms }).then(() => true, () => false);

async function newCtx(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
  const log = []; watch(ctx, log);
  const open = async (tag) => { const p = await ctx.newPage(); p.__tag = tag; p.on('pageerror', (e) => console.log('   [' + tag + '] pageerror ' + String(e.message).slice(0, 100))); return p; };
  return { ctx, log, open };
}

(async () => {
  await ensureShop(SHOP_A); await ensureShop(SHOP_B);
  const browser = await chromium.launch();
  try {
    /* ── Part 1 · the switch ── */
    let C = await newCtx(browser); const A = await C.open('A'), B = await C.open('B');
    await signIn(A, SHOP_A.email); await openPrint(A, fresh('Tab A edit '));
    const shopA = await shopOfSess(A), shopsOnLoad = await A.evaluate(() => !!window.CBDevice);
    record('S1 · A on Print setup as shop A', !!shopA && shopsOnLoad && !(await covered(A)), 'shop ' + shopA + ' · CBDevice loaded ' + shopsOnLoad + ' · no cover');
    await shot(A, 'A on Print setup, footer edited, not saved');
    const before = { a: await vaultOf(SHOP_A), b: await vaultOf(SHOP_B) };
    await signIn(B, SHOP_B.email);
    const shopB = await shopOfSess(B);
    record('S2 · B signs in as shop B in the same browser', !!shopB && shopB !== shopA, 'cb_sess now names ' + shopB + ' (was ' + shopA + ')');
    const up = await waitCover(A, 6000);
    const text = up ? (await A.locator(COVER).innerText()).replace(/\s+/g, ' ') : '';
    await shot(A, 'the cover over tab A');
    const mark = C.log.length; await pressSave(A);
    const sent = writesOf(C.log.slice(mark), 'A');
    const after = { a: await vaultOf(SHOP_A), b: await vaultOf(SHOP_B) };
    record('S3 · A: cover within 6 s, Save sends no write, nothing changes', up && text.indexOf(SENTENCE) === 0 && sent.length === 0 && before.a === after.a && before.b === after.b,
      'cover ' + up + ' · "' + text + '" · writes from A after the switch ' + sent.length + ' · vaults unchanged ' + (before.a === after.a && before.b === after.b));
    await A.locator(COVER + ' button').click(); await A.waitForSelector(T('pr-save'), { timeout: 25000 });
    const nowShop = await shopOfSess(A), noCover = !(await covered(A));
    const barText = await A.locator('body').innerText();
    await A.fill(T('pr-in-footer'), fresh('After reload ')); await A.dispatchEvent(T('pr-in-footer'), 'change');
    const mark2 = C.log.length; await pressSave(A);
    const w2 = writesOf(C.log.slice(mark2), 'A'), v2 = { a: await vaultOf(SHOP_A), b: await vaultOf(SHOP_B) };
    record('S4 · A: Reload → A acts as shop B; its Save writes B only', nowShop === shopB && noCover && w2.length >= 1 && w2.every((x) => x.status === 200) && v2.b !== before.b && v2.a === before.a && /wt-shop-b/.test(barText),
      'page shop ' + nowShop + ' · no cover ' + noCover + ' · writes ' + w2.map((x) => x.m + ' ' + x.p + ' ' + x.status).join(',') + ' · B vault changed ' + (v2.b !== before.b) + ' · A vault unchanged ' + (v2.a === before.a) + ' · bar names B ' + /wt-shop-b/.test(barText));
    await shot(A, 'after Reload: A is shop B, Save went through');
    await C.ctx.close();

    /* ── Part 2 · false positives ── */
    C = await newCtx(browser); let P = await C.open('P');
    await signIn(P, SHOP_A.email);
    let bad = [], saved = 0;
    await openPrint(P, fresh('F1 one ')); await pressSave(P); saved++;
    await P.reload(); await P.waitForSelector(T('pr-save'), { timeout: 25000 }); bad.push(await covered(P));
    for (const n of [2, 3]) { await P.fill(T('pr-in-footer'), 'F1 save ' + n + fresh(' ')); await P.dispatchEvent(T('pr-in-footer'), 'change'); await pressSave(P); saved++; bad.push(await covered(P)); }
    const w = writesOf(C.log, 'P');
    record('F1 · one tab: sign in, reload, three Saves', !bad.some(Boolean) && w.length >= 3 && w.every((x) => x.status === 200), 'cover seen ' + bad.some(Boolean) + ' · writes ' + w.map((x) => x.status).join(','));
    await shot(P, 'F1 after the third Save, no cover');
    await C.ctx.close();

    C = await newCtx(browser); const T1 = await C.open('T1'), T2 = await C.open('T2');
    await signIn(T1, SHOP_A.email); await openPrint(T1, null);
    await signIn(T2, SHOP_A.email); await openPrint(T2, fresh('F2 tab two '));   // a second sign-in of the SAME shop rewrites cb_sess with a new token
    await pressSave(T2);
    await T1.fill(T('pr-in-footer'), fresh('F2 tab one ')); await T1.dispatchEvent(T('pr-in-footer'), 'change'); await pressSave(T1);
    const c1 = await covered(T1), c2 = await covered(T2), w1 = writesOf(C.log, 'T1'), w2b = writesOf(C.log, 'T2');
    record('F2 · two tabs of the SAME shop both Save', !c1 && !c2 && w1.length >= 1 && w2b.length >= 1 && w1.concat(w2b).every((x) => x.status === 200 || x.status === 409),
      'cover T1 ' + c1 + ' T2 ' + c2 + ' · writes T1 ' + w1.map((x) => x.status) + ' T2 ' + w2b.map((x) => x.status) + ' (409 = the vault\'s own stale-version answer, not the stop)');
    await shot(T1, 'F2 tab one after its Save, no cover');
    // sign-out in the other tab, then sign in again as the same shop: this tab's old token is the old session of the SAME shop
    await T2.goto(WEB + '/app.html'); await T2.waitForTimeout(1500); await T2.evaluate(() => logoutNow());
    await T2.waitForTimeout(800); const afterOut = await covered(T1);
    await signIn(T2, SHOP_A.email); await T1.waitForTimeout(800);
    const m3 = C.log.length; await T1.fill(T('pr-in-footer'), fresh('F2 after out/in ')); await T1.dispatchEvent(T('pr-in-footer'), 'change'); await pressSave(T1);
    const w3 = writesOf(C.log.slice(m3), 'T1');
    record('F2b · other tab signs out then in as the same shop; this tab still Saves', !afterOut && !(await covered(T1)) && w3.length >= 1,
      'cover after sign-out ' + afterOut + ' · after sign-in ' + (await covered(T1)) + ' · writes from T1 ' + w3.map((x) => x.status) + ' (a 401 is the api ending the old session, not the stop)');
    await C.ctx.close();

    C = await newCtx(browser); P = await C.open('P');
    await signIn(P, SHOP_A.email); await openPrint(P, null);
    await P.goto(WEB + '/app.html'); await P.waitForTimeout(1500); await P.evaluate(() => logoutNow());
    await signIn(P, SHOP_A.email); await openPrint(P, fresh('F3 same tab again ')); const m4 = C.log.length; await pressSave(P);
    const w4 = writesOf(C.log.slice(m4), 'P'), c4 = await covered(P);
    record('F3 · sign out then in again, same tab, same shop', !c4 && w4.length >= 1 && w4.every((x) => x.status === 200), 'cover ' + c4 + ' · writes ' + w4.map((x) => x.status));
    await P.goto(WEB + '/app.html'); await P.waitForTimeout(1500); await P.evaluate(() => logoutNow());
    await signIn(P, SHOP_B.email); await openPrint(P, fresh('F3 same tab other shop ')); const m5 = C.log.length; await pressSave(P);
    const w5 = writesOf(C.log.slice(m5), 'P'), c5 = await covered(P);
    record('F3b · same tab signs in as the OTHER shop (no second tab), then Saves', !c5 && w5.length >= 1 && w5.every((x) => x.status === 200), 'cover ' + c5 + ' · writes ' + w5.map((x) => x.status));
    await shot(P, 'F3b same tab, other shop, saved, no cover');
    await C.ctx.close();

    /* F4 · the till is not covered (it does not load device-id.js, SEC-85 hand-off): two shops, till open in one of them */
    const tillLoads = /device-id\.js/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'till.html'), 'utf8'));
    C = await newCtx(browser); const TT = await C.open('till'), OT = await C.open('other');
    await signIn(TT, SHOP_A.email); await TT.goto(WEB + '/till.html'); await TT.waitForTimeout(3000);
    await signIn(OT, SHOP_B.email); await TT.waitForTimeout(2500);
    const tillDevice = await TT.evaluate(() => !!window.CBDevice), tillCover = await covered(TT);
    await shot(TT, 'F4 the till after another shop signed in elsewhere');
    record('F4 · the till does not load device-id.js and shows no cover', !tillLoads && !tillDevice && !tillCover, 'till.html names device-id.js ' + tillLoads + ' · CBDevice on the page ' + tillDevice + ' · cover ' + tillCover);
    await C.ctx.close();
  } catch (e) {
    record('RUN · the walk itself', false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | '));
  } finally { await browser.close(); }
  const failed = results.filter((x) => !x).length;
  console.log('\n' + (results.length - failed) + '/' + results.length + ' steps PASS');
  process.exit(failed ? 1 : 0);
})();
