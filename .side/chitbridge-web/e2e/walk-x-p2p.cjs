#!/usr/bin/env node
/**
 * e2e/walk-x-p2p.cjs — P2P (procure to pay), WALKED ON A REAL STACK, width and depth (round WX-P2P, 2026-10-13).
 *
 * Owner (2026-10-13): "walk each of the screen across all the flow both depth and width and resolve the issues for every operation".
 * The flow is docs/process/flows.json → P2P: need (Supplies · Intake) → PO (Suppliers › order steps → Order) → goods receipt (the bill's
 * Lines · Delivered) → supplier bill (Task › Goods received · bill accepted → the hook posts) → payment (CB Accounts › Payables › Pay ·
 * the advice) → posted (Day book · Ledgers · TB · P&L · GST · Reverse). Two parties: the BUYER (the loader's shop) and a SUPPLIER on the
 * rail (a second loaded shop); a VIEW-ONLY co-assist for the refused states. Every assertion is on what the SCREEN shows (innerText), and
 * every step is shot.
 *
 *   --real     the real stack: Postgres (docker) + the api on 3000 + public/ on 5173 (e2e/lib/stack-local.cjs up), the shops loaded by
 *              chitbridge-api tools/sim-load.cjs (--shop simstores · --shop kumartrade --seed 11 --years 1; see docs/testing/WX-P2P-2026-10-13.md
 *              for the exact fixture steps). Without --real the walk prints one NOTE and exits 0: a fixture stand-in for a two-party flow with
 *              a posting ledger would be a second ledger, and the cloud walks (walk-*.cjs) must stay green without a stack.
 *   --only W|D the width half (every screen × 1366 and 390) or the depth half (the operations end to end)
 *   --show     headed, captions, a results page (lib/walk.cjs)
 *
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-x-p2p.cjs --real [--only W|D]
 * Shots: e2e/shots/walk-x-p2p-NN.png (the buyer's page, per step) and e2e/shots/wxp2p-<name>.png (the other party, the phone).
 */
'use strict';
const TD = require('./lib/today.cjs');
const path = require('path'), fs = require('fs');
const W = require('./lib/walk.cjs');

const REAL = process.argv.includes('--real');
const ONLY = (() => { const i = process.argv.indexOf('--only'); return i > 0 ? String(process.argv[i + 1] || '').toUpperCase() : ''; })();
const API = process.env.WX_API || 'http://localhost:3000', WEB = process.env.WX_WEB || 'http://localhost:5173';
const BUYER = process.env.WX_BUYER || 'simstores', SUPPLIER = process.env.WX_SUPPLIER || 'kumartrade';
/* ⚠️ the DEPTH half buys as a FRESH shop (registered through the api's own doors below): the loader hard-locks every month it wrote — the
   present one included — so a bill accepted today on the loaded shop posts silently into the next open year (WX-P2P-08). The WIDTH half
   walks the loaded shop, three years deep. */
const DEPTH_BUYER = process.env.WX_DEPTH_BUYER || 'walkbuyer', VIEWER = process.env.WX_VIEWER || ('vani@' + DEPTH_BUYER);
const OTP = process.env.DEV_OTP || '123456';
const SHOTS = path.join(__dirname, 'shots');
const RUN = String(Date.now()).slice(-4);   /* a suffix so a re-run on the same stack adds a new supply, not a second 'Packing tape' */   /* clock-ok: a unique run suffix */

if (!REAL) { console.log('walk x-p2p: NOTE · needs the real stack (--real); the fixture walks cannot stand in for a two-party flow that posts a ledger'); process.exit(0); }

/* ── the api, as a party: sign in (DEV_OTP), read, write ───────────────────────────────────────────────────────── */
async function http(p, m, body, token) {
  const r = await fetch(API + p, { method: m || 'GET', headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}), body: body ? JSON.stringify(body) : undefined });
  let b; try { b = await r.json(); } catch (_) { b = {}; }
  return { status: r.status, b };
}
async function party(id) {
  await http('/api/signin/ask', 'POST', { id });
  const v = await http('/api/signin/verify', 'POST', { id, otp: OTP });
  if (!v.b.token) throw new Error('sign-in as ' + id + ' failed: ' + JSON.stringify(v.b).slice(0, 160));
  const ent = v.b.entity || {}, act = v.b.actor || null;
  const sess = { token: v.b.token, role: act ? 'actor' : 'entity', name: act ? act.display_name : ent.display_name, entity: ent.display_name || (act && act.parent_entity_name) || '', bridgeId: ent.bridge_id || '' };
  if (act) sess.duty = 'duty';
  const me = await http('/api/entities/me', 'GET', null, v.b.token);
  return { id, token: v.b.token, sess, me: (me.b && me.b.entity) || {}, get: (p) => http(p, 'GET', null, v.b.token), post: (p, b) => http(p, 'POST', b, v.b.token) };
}

/** the fresh buyer — made once, through the doors tools/sim-load.cjs uses (register is also sign-in; DEV_OTP; CS1 country setup; the ledger on) */
async function ensureBuyer(id) {
  try { return await party(id); } catch (_) { /* not there yet */ }
  const email = id + '@test.example';
  const reg = await http('/api/entities/register', 'POST', { email, display_name: 'Walk Buyer Stores', user_id: id });
  if (reg.status >= 300) throw new Error('register ' + id + ': ' + JSON.stringify(reg.b).slice(0, 160));
  const ver = await http('/api/entities/verify', 'POST', { email, otp: OTP });
  if (!ver.b.token) throw new Error('verify ' + id + ': ' + JSON.stringify(ver.b).slice(0, 160));
  const tok = ver.b.token, w = (p, b) => http(p, 'POST', b, tok);
  /* a Tamil Nadu GSTIN whose check digit passes (the api's own rule, lib/profile-map.gstinChecksum) */
  const PM = require(path.join(__dirname, '..', '..', 'chitbridge-api', 'lib', 'profile-map'));
  let gstn = null; for (const d of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') { if (PM.gstinChecksum('33AAACW1234B1Z' + d).ok) { gstn = '33AAACW1234B1Z' + d; break; } }
  await http('/api/governance/country-setup', 'PUT', { country: 'IN', currency: 'INR', fy_start_month: 4, tax: gstn ? { registered: true, number: gstn, scheme: 'regular' } : { registered: false }, source: { country: 'walk', currency: 'the pack', fy_start_month: 'the pack', tax: 'walk' } }, tok);
  await http('/api/entities/profile', 'PATCH', { address: '4 Market Road, Madurai' }, tok);
  await w('/api/books/enable', {});
  const chart = (await http('/api/books/accounts', 'GET', null, tok)).b, accounts = (chart && chart.accounts) || [];
  const code = (role) => (accounts.find((a) => a.role === role) || {}).code;
  await w('/api/books/opening', { date: TD.TODAY, client_ref: 'walk-x-p2p/opening', rows: [{ code: code('cash') || '1400', dr_minor: 20000000 }, { code: code('capital') || '3000', cr_minor: 20000000 }] });
  await w('/api/relationships/suppliers', { supplier_bridge_id: SUPPLIER, supply_kind: 'resale' });
  await w('/api/actors', { display_name: 'Viewer Vani', actor_key: 'vani', hat: 'view_only', access_level: 'viewer' });
  return party(id);
}

/* ── the page helpers ───────────────────────────────────────────────────────────────────────────────────────── */
const T = (s) => '[data-testid="' + s + '"]';
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const text = (page) => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ')).catch(() => '');
const txt = async (page, sel) => norm(await page.locator(sel).first().innerText().catch(() => ''));
const widths = (page) => page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
/* every screen starts fresh: a hash-only change on the same page would keep a sheet or a modal of the last step on screen (CB Accounts is one page) */
async function open(page, url, until, ms) { await page.goto('about:blank').catch(() => {}); await page.goto(WEB + url, { waitUntil: 'load' }); if (until) await page.waitForSelector(until, { timeout: ms || 9000 }).catch(() => {}); await page.waitForTimeout(700); }
async function shot(page, name) { try { await page.screenshot({ path: path.join(SHOTS, 'wxp2p-' + name + '.png') }); } catch (_) {} return 'wxp2p-' + name + '.png'; }
async function ctxFor(browser, p, vp) {
  const ctx = await browser.newContext({ viewport: vp || { width: 1366, height: 768 }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' });
  /* no request interception here: this walk answers nothing itself — every /api call reaches the real api (a stand-in would owe the contract guard its answers) */
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_sess', s); window.print = function () {}; } catch (_) {} }, JSON.stringify(p.sess));
  const page = await ctx.newPage(); page.on('dialog', (d) => d.accept().catch(() => {}));
  return { ctx, page };
}
/** the supplier's bill to the buyer — the counter's two-sided bill chit (tools/tally-connector/till.js chitOf), the invoice from the api's
 *  ONE calculation (lib/tax-lines.invoiceFor) exactly as tools/sim-load.cjs sends it; nothing here computes a rupee */
function supplierBillBody(sup, buyer, lines, no, at) {
  const TL = require(path.join(__dirname, '..', '..', 'chitbridge-api', 'lib', 'tax-lines'));
  /* the parties in the invoice's own shape (TL.partyOf — GSTIN, state, registration), exactly as the loader builds its seller */
  const seller = TL.partyOf({ gstn: sup.me.gstn || null, display_name: sup.me.display_name, country: sup.me.country || 'IN', policy_flags: sup.me.policy_flags }, { entity_id: sup.me.identity_id });
  const buyerP = TL.partyOf({ gstn: buyer.me.gstn || null, display_name: buyer.me.display_name, country: buyer.me.country || 'IN', policy_flags: buyer.me.policy_flags }, { entity_id: buyer.me.identity_id });
  const inv = TL.invoiceFor({ lines, seller, buyer: buyerP, currency: 'INR', at, priceIncludesTax: true }).invoice;
  const total = Number(inv.ValDtls && inv.ValDtls.TotInvVal) || 0;
  return { body: {
    recipients: [{ self: true, name: 'self' }, { name: buyer.me.display_name, entity_id: String(buyer.me.identity_id), role: 'to', self: false }],
    purpose: 'order', subject: 'Counter sale ' + no, manual_subject: 'Counter sale ' + no, client_ref: no,
    business_json: { customer: { name: buyer.me.display_name, entity_id: String(buyer.me.identity_id) }, till: { id: 'C1', name: 'Counter 1', host: 'walk-x-p2p', by: null },
      bill_no: no, billed_at: at, catalogue_version: null, payment: { mode: 'credit', paid: 0, change: 0, parts: [{ how: 'credit', amount: total }] }, slip: 'credit',
      terms: { due_date: at.slice(0, 10), credit_days: 10 }, credit_override: null, invoice: inv },
    line_items: lines }, total };
}

/** the two loaded shops as the flow needs them (idempotent; the api's own doors): the supplier shop is named Kumar Trade Co, its catalogue is public,
 *  the buyer lists it as a resale supplier and it lists the buyer as a customer. tools/sim-load.cjs names every shop "Simulated Stores" and keeps
 *  its catalogue private — so a fresh load needs exactly these four PATCH/POSTs, and nothing else (docs/testing/WX-P2P-2026-10-13.md). */
async function ensureSupplier(buyerId, supId) {
  let sup = await party(supId);
  if (sup.me.display_name !== 'Kumar Trade Co') await http('/api/entities/profile', 'PATCH', { display_name: 'Kumar Trade Co' }, sup.token);
  if (sup.me.catalogue_visibility !== 'public') await http('/api/entities/profile', 'PATCH', { catalogue_visibility: 'public' }, sup.token);
  await sup.post('/api/relationships/customers', { handle: buyerId });
  const buyer = await party(buyerId);
  await buyer.post('/api/relationships/suppliers', { supplier_bridge_id: supId, supply_kind: 'resale' });
  return party(supId);
}

const walk = async (w) => {
  const { browser, page } = w;
  const sup = await ensureSupplier(BUYER, SUPPLIER), loaded = await party(BUYER);
  const dep = ONLY === 'W' ? null : await ensureBuyer(DEPTH_BUYER);
  /* the supplier knows the fresh buyer as a customer too (its own door) — a bill to a customer on the rail is two-sided */
  if (dep) await sup.post('/api/relationships/customers', { handle: DEPTH_BUYER });
  let viewer = null; if (dep) { try { viewer = await party(VIEWER); } catch (e) { console.log('viewer: ' + e.message); } }
  /* the buyer's own page is w.page (shot per step by the skeleton); the session goes in before the first navigation — the depth half's
     fresh shop first, the loaded shop for the width half (the session is swapped in the page before it starts) */
  let buyer = dep || loaded;
  await page.context().addInitScript((s) => { try { if (!localStorage.getItem('cb_sess_walk')) { localStorage.setItem('cb_sess', s); localStorage.setItem('cb_sess_walk', '1'); } } catch (_) {} }, JSON.stringify(buyer.sess));
  const S = {};   /* what the depth half made: the order, the bill, the payment */
  const money = (n) => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  /* ═══ DEPTH — the operations, end to end, both parties ═══════════════════════════════════════════════════════ */
  if (ONLY !== 'W') {
    await w.step('D01', 'The front door: Accounts signed out shows ONE sign-in window; the owner signs in with the code -> the To do opens', async () => {
      const fresh = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'en-IN', timezoneId: 'Asia/Kolkata' });
      const p = await fresh.newPage(); await p.goto(WEB + '/accounts.html', { waitUntil: 'load' });
      await p.waitForSelector(T('signin-id'), { timeout: 15000 }).catch(() => {});
      const door = await p.locator(T('signin-id')).count();
      let after = '';
      if (door) {
        await p.fill(T('signin-id'), buyer.id); await p.click(T('signin-go'));
        await p.waitForSelector(T('signin-code'), { timeout: 15000 }).catch(() => {});
        await p.fill(T('signin-code'), OTP); await p.click(T('signin-verify'));
        await p.waitForSelector(T('todo-list') + ', ' + T('todo-none') + ', ' + T('signin-later'), { timeout: 10000 }).catch(() => {});
        if (await p.locator(T('signin-later')).count()) { await p.click(T('signin-later')); await p.waitForSelector(T('todo-list') + ', ' + T('todo-none'), { timeout: 10000 }).catch(() => {}); }
        after = await text(p);
      }
      await shot(p, 'd01-front-door'); await fresh.close();
      return { ok: door === 1 && /To do/.test(after) && after.indexOf(buyer.me.display_name) >= 0, saw: (door ? 'the window showed; after: ' + after.slice(0, 90) : 'NO sign-in window') };
    });

    /* ── step 1 · need: Supplies ── */
    await open(page, '/app.html#/app/supplies', T('supply-add'));
    await w.step('D02', 'Supplies (step 1 · need) -> Add a supply "Packing tape" counted -> the row shows it, counted, not bought yet, with Used some', async () => {
      await page.click(T('supply-add')); await page.waitForSelector(T('supply-name'), { timeout: 8000 });
      await page.fill(T('supply-name'), 'Packing tape ' + RUN); await page.fill(T('supply-unit'), 'roll'); await page.check(T('supply-keep'));
      await page.click(T('supply-save')); await page.waitForSelector(T('supply-row'), { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(600);
      const t = await text(page);
      return { ok: /Packing tape/.test(t) && /counted/.test(t) && /not bought yet/.test(t) && /Used some/.test(t), saw: t.slice(t.indexOf('SUPPLIES'), t.indexOf('SUPPLIES') + 420) };
    });
    await w.step('D03', 'Supplies -> Record a purchase (a cash bill from a shop not on the network): Corner Stores · CS-77 · 2 Packing tape at 40 -> Recorded; the row now says what it last cost and who from', async () => {
      await page.click(T('supply-buy')); await page.waitForSelector(T('supply-from'), { timeout: 8000 });
      await page.fill(T('supply-from'), 'Corner Stores'); await page.fill(T('supply-ref'), 'CS-77');
      await page.fill(T('supply-l-name'), 'Packing tape ' + RUN); await page.fill(T('supply-l-qty'), '2'); await page.fill(T('supply-l-cost'), '40');
      await page.click(T('supply-record')); await page.waitForTimeout(2500);
      const t = await text(page);
      const row = t.slice(t.indexOf('Packing tape ' + RUN), t.indexOf('Packing tape ' + RUN) + 140);
      return { ok: /Packing tape/.test(t) && /₹\s?40\.00/.test(row) && /Corner Stores/.test(t), saw: row + (/₹\s?40\.00/.test(row) ? '' : ' [the last cost is a bare number, not money — WX-P2P-05]') };
    });
    await w.step('D04', 'Supplies -> Used some (1 roll) -> Recorded, the row stays counted', async () => {
      await page.click(T('supply-use')); await page.waitForSelector(T('supply-use-qty'), { timeout: 8000 });
      await page.fill(T('supply-use-qty'), '1'); await page.click(T('supply-use-save')); await page.waitForTimeout(1500);
      const t = await text(page), modal = await page.locator(T('supply-use-qty')).count();
      return { ok: modal === 0 && /Packing tape/.test(t) && /counted/.test(t), saw: (modal ? 'the sheet is still open' : 'sheet closed') + '; ' + t.slice(t.indexOf('Packing tape ' + RUN), t.indexOf('Packing tape ' + RUN) + 100) };
    });
    await w.step('D05', 'Supplies -> Record a purchase with no reference -> refused in a sentence that says what to put (nothing recorded)', async () => {
      await page.click(T('supply-buy')); await page.waitForSelector(T('supply-from'), { timeout: 8000 });
      await page.fill(T('supply-l-name'), 'Tape'); await page.fill(T('supply-l-qty'), '1');
      await page.click(T('supply-record')); await page.waitForTimeout(700);
      const t = await text(page), still = await page.locator(T('supply-from')).count();
      await page.keyboard.press('Escape'); await page.evaluate(() => { try { closeModal(); } catch (_) {} }); await page.waitForTimeout(300);
      return { ok: still === 1 && /Give it a reference/.test(t), saw: (/Give it a reference/.test(t) ? 'the sentence showed' : 'NO sentence') + '; sheet ' + (still ? 'still open' : 'closed') };
    });

    /* ── step 1 · need: Intake ── */
    await open(page, '/app.html#/app/intake', T('intake-simulate-open'));
    await w.step('D06', 'Intake (step 1 · need) -> empty: "Nothing waiting" with the sentence; Record a message opens the form', async () => {
      const t0 = await text(page);
      await page.click(T('intake-simulate-open')); await page.waitForTimeout(800);
      const t = await text(page), form = await page.locator('textarea, input[data-testid^="intake-sim"]').count();
      return { ok: /Nothing waiting/.test(t0) && form > 0, saw: (/Nothing waiting/.test(t0) ? 'empty state said' : 'no empty state') + '; form controls: ' + form + '; ' + t.slice(t.indexOf('Record a message'), t.indexOf('Record a message') + 260) };
    });

    /* ── step 2 · PO: Suppliers › Kumar Trade Co › Items → Details → Review → Send ── */
    await open(page, '/app.html#/app/suppliers', '[data-testid^="sup-row-"]');
    await w.step('D07', 'Suppliers (step 2 · PO) -> Kumar Trade Co (on the rail) -> their catalogue with the three steps Items · Details · Review', async () => {
      const row = page.locator('[data-testid^="sup-row-"]', { hasText: 'Kumar Trade Co' }).first();
      await row.click(); await page.waitForSelector(T('cart-add'), { timeout: 15000 }).catch(() => {});
      const t = await text(page), n = await page.locator(T('cart-add')).count();
      return { ok: n > 5 && /Items/.test(t) && /Details/.test(t) && /Review/.test(t) && /what you can order from them/.test(t), saw: n + ' items to add; ' + t.slice(t.indexOf('Kumar Trade Co what'), t.indexOf('Kumar Trade Co what') + 120) };
    });
    await w.step('D08', 'Suppliers -> add two items -> the cart counts 2 and shows its money; Check out -> Details with the subject proposed; Review -> Send order', async () => {
      const adds = page.locator(T('cart-add'));
      await adds.nth(0).click(); await page.waitForTimeout(300); await adds.nth(1).click(); await page.waitForTimeout(500);
      const cart = await txt(page, '[data-testid^="cart-count-"]');
      await page.click(T('step-next-cbsteps-1')); await page.waitForTimeout(900);
      const t1 = await text(page);
      const subj = await page.evaluate(() => { const i = document.querySelector('#sup_body input[type="text"], #sup_body input:not([type])'); return i ? i.value : ''; });
      await page.click(T('step-next-cbsteps-1')); await page.waitForTimeout(900);
      const t2 = await text(page), send = await txt(page, T('step-next-cbsteps-1'));
      return { ok: /2/.test(cart) && /Order — Kumar Trade Co/.test(subj) && /Send order to Kumar Trade Co/.test(send), saw: 'cart "' + cart + '"; subject "' + subj + '"; details: ' + t1.slice(t1.indexOf('When, where'), t1.indexOf('When, where') + 60) + '; review button "' + send + '"; ' + t2.slice(t2.indexOf('Check it'), t2.indexOf('Check it') + 160) };
    });
    await w.step('D09', 'Review -> Send order to Kumar Trade Co -> the Order list opens with "Order — Kumar Trade Co" at the top, state OPEN', async () => {
      await page.click(T('step-next-cbsteps-1'));
      await page.waitForFunction(() => /Order — Kumar Trade Co/.test(document.body.innerText) && /chits you've sent/.test(document.body.innerText), null, { timeout: 25000 }).catch(() => {});
      await page.waitForTimeout(800);
      const t = await text(page), i = t.indexOf('Order — Kumar Trade Co');
      return { ok: /chits you've sent/.test(t) && i >= 0 && /OPEN/.test(t.slice(i, i + 80)), saw: t.slice(t.indexOf('Order — chits'), t.indexOf('Order — chits') + 60) + ' … ' + t.slice(i, i + 70) };
    });

    /* the supplier's side */
    const supUI = await ctxFor(browser, sup);
    await w.step('D10', 'The SUPPLIER (Kumar Trade Co) -> Task: "Open 0/1 · Nothing in Open" on a paged list (WX-P2P-03); the search finds the order -> opening it shows the buyer and the two lines', async () => {
      const p = supUI.page;
      await open(p, '/app.html#/app/task', T('task-count')); await p.waitForTimeout(1500);
      const t0 = await text(p), paged = t0.slice(t0.indexOf('Unassigned'), t0.indexOf('Unassigned') + 60), listed = /Order — Kumar Trade Co/.test(t0);
      await p.fill('#listsrch', 'Order — Kumar'); await p.waitForFunction(() => /Order — Kumar Trade Co/.test(document.body.innerText) && !/Nothing in Open/.test(document.body.innerText), null, { timeout: 10000 }).catch(() => {});
      await p.waitForTimeout(600);
      const row = p.locator('text=Order — Kumar Trade Co').first();
      if (await row.count()) { await row.click(); await p.waitForTimeout(1500); }
      const t2 = await text(p), name = await shot(p, 'd10-supplier-task');
      const i = t2.indexOf('DTL');
      const selfHead = /Order — Kumar Trade Co · Kumar Trade Co/.test(t2);
      return { ok: listed && !selfHead && new RegExp('Order — Kumar Trade Co · ' + buyer.me.display_name).test(t2) && t2.slice(i).indexOf(buyer.me.display_name) >= 0 && /Coconut hair oil|Chocolate bar/.test(t2), saw: name + ' · before the search: "' + paged + '" ' + (listed ? '(the order is listed)' : '[the order is NOT listed until searched — WX-P2P-03]') + ' · ' + t2.slice(i, i + 200) + (selfHead ? ' [the head names the reader\'s own shop as the party — WX-P2P-17]' : '') };
    });
    await w.step('D11', 'The SUPPLIER -> Status ▾ -> Act -> Set status -> the order reads ACT; the BUYER\'s Order list shows the same ACT', async () => {
      const p = supUI.page;
      await p.click(T('chit-status-btn')); await p.waitForSelector('.optrow[data-v="act"]', { timeout: 8000 });
      await p.click('.optrow[data-v="act"]'); await p.click('#mok'); await p.waitForTimeout(3000);
      const t = await text(p), name = await shot(p, 'd11-supplier-accept');
      await open(page, '/app.html#/app/order', T('task-count')); await page.waitForTimeout(1500);
      const tb = await text(page), i = tb.indexOf('Order — Kumar Trade Co');
      await page.locator('text=Order — Kumar Trade Co').first().click().catch(() => {}); await page.waitForTimeout(1000);
      await page.click(T('dtab-status')).catch(() => {}); await page.waitForTimeout(800);
      const ts = await text(page), j = ts.indexOf('Kumar Trade Co', ts.indexOf('Status'));
      const trail = ts.slice(Math.max(0, j - 60), j + 80);
      return { ok: /Moved|ACT/.test(t) && i >= 0 && /Kumar Trade Co/.test(ts.slice(ts.indexOf('Content'))) && /progress|Act|accept/i.test(trail), saw: name + ' · supplier: ' + (t.match(/Moved[^.]{0,60}/) || ['no "Moved" toast'])[0] + '; buyer row: ' + tb.slice(i, i + 60) + (/OPEN/.test(tb.slice(i, i + 80)) ? ' [row still OPEN — WX-P2P-07]' : '') + '; Status tab: ' + trail };
    });

    /* ── step 4 · the supplier's bill arrives (the counter's two-sided bill, as the loader sends it) ── */
    await w.step('D12', 'The SUPPLIER bills the buyer (its counter bill, on credit) -> Accounts › Unpaid bills › Received lists "KT/…" from Kumar Trade Co with its amount, step "Received"; the app\'s Task counts it as Open but does not list it (bills are not tasks)', async () => {
      const cat = await buyer.get('/api/relationships/suppliers/' + sup.me.identity_id + '/catalogue');
      const items = ((cat.b && cat.b.items) || []).slice(0, 2);
      const lines = items.map((it, i) => { const d = it.item_data || {}; return { particulars: d.name, quantity: i + 2, unit: d.unit || 'piece', price: Number(d.price && d.price.amount || 0), gst_rate: Number(d.gst_rate || 0), hsn: d.hsn || undefined, item_id: it.item_id }; });
      const at = TD.nowIso(), no = 'KT/26-27/' + String(Math.floor(Math.random() * 9000) + 1000);
      const made = supplierBillBody(sup, buyer, lines, no, at);
      const r = await sup.post('/api/chits/send', made.body);
      S.bill = { no, total: made.total, chit_id: r.b && r.b.chit_id, lines };
      await open(page, '/accounts.html#bills', T('bills-list'));
      await page.waitForFunction((no) => document.body.innerText.indexOf(no) >= 0, no, { timeout: 10000 }).catch(() => {});
      const t = await text(page), row = S.bill.chit_id ? await txt(page, T('bill-' + S.bill.chit_id)) : '', step = S.bill.chit_id ? await txt(page, T('bill-step-' + S.bill.chit_id)) : '', tabs = t.slice(t.indexOf('Received'), t.indexOf('Received') + 24);
      await open(page, '/app.html#/app/task', T('task-count')); await page.waitForTimeout(1200);
      const tt = await text(page), openTab = tt.slice(tt.indexOf('Open'), tt.indexOf('Open') + 14);
      return { ok: r.status === 200 && /Kumar Trade Co/.test(row) && row.indexOf(money(made.total)) >= 0 && /Received/.test(step), saw: 'send HTTP ' + r.status + (r.status !== 200 ? ' ' + JSON.stringify(r.b).slice(0, 120) : '') + '; bill ' + no + ' ₹' + money(made.total) + '; row "' + row.slice(0, 80) + '"; tabs "' + tabs + '" step "' + step + '"; Task tab "' + openTab + '"' + (/Received 0/.test(tabs) ? ' [tab count 0 beside a row — WX-P2P-06]' : '') };
    });

    /* ── step 3 · goods receipt: the bill's sheet → Open page → ⧉ Lines → Delivered ── */
    const openBillSheet = async () => {
      await open(page, '/accounts.html#bills', T('bills-list'));
      await page.waitForFunction((no) => document.body.innerText.indexOf(no) >= 0, S.bill.no, { timeout: 10000 }).catch(() => {});
      const row = S.bill.chit_id ? page.locator(T('bill-' + S.bill.chit_id)) : page.locator('[data-testid^="bill-"]:not([data-testid^="bills"])', { hasText: 'Kumar Trade Co' }).first();
      await row.first().click({ timeout: 10000 });
      await page.waitForSelector(T('cs-head'), { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(800);
    };
    await w.step('D13', 'Unpaid bills -> the bill row opens its sheet: Bill · KT/… · Kumar Trade Co · "To accept" · the two lines, GST summary, total; the actions Accept · Dispute · Goods in · Open page', async () => {
      await openBillSheet();
      const t = await txt(page, '#chitsheet'), acts = [];
      for (const k of ['accept', 'dispute', 'goodsin', 'page']) if (await page.locator(T('cs-act-' + k)).count()) acts.push(k);
      /* a line's Total is the figure the buyer agreed to — quantity × the tax-inclusive price; a paisa off is the parts' rounding re-added (WX-P2P-16) */
      const offs = [];
      for (let i = 0; i < S.bill.lines.length; i++) { const row = await txt(page, T('cs-line-' + i)), want = money(S.bill.lines[i].quantity * S.bill.lines[i].price), got = (row.match(/₹\s?[\d,]+\.\d\d\s*$/) || [''])[0].replace(/[₹\s]/g, ''); if (got && got !== want) offs.push(row.slice(0, 40) + ' → ' + got + ' not ' + want); }
      return { ok: t.indexOf(S.bill.no) >= 0 && /Kumar Trade Co/.test(t) && /To accept/.test(t) && t.indexOf(money(S.bill.total)) >= 0 && acts.length === 4, saw: 'actions ' + acts.join('·') + '; ' + t.slice(0, 220) + (offs.length ? ' [line total ≠ qty × price: ' + offs.join('; ') + ' — WX-P2P-16, engines]' : '') };
    });
    await w.step('D14', 'The sheet -> Open page -> the app opens the bill in a new tab -> ⧉ Lines -> THEM · Delivered & paid: "0 of n"; Delivered on the first line, its box untouched (it shows the pending n) -> "n of n" (step 3 · goods receipt)', async () => {
      const popup = page.context().waitForEvent('page', { timeout: 15000 }).catch(() => null);
      await page.click(T('cs-act-page'));
      const p2 = (await popup) || page;
      await p2.waitForLoadState('load').catch(() => {}); await p2.waitForSelector(T('open-design2'), { timeout: 25000 }).catch(() => {}); await p2.waitForTimeout(800);
      await p2.click(T('open-design2')).catch(() => {}); await p2.waitForSelector(T('c2-tab-del'), { timeout: 15000 }).catch(() => {});
      await p2.click(T('c2-tab-del')).catch(() => {}); await p2.waitForSelector(T('c2-delivered'), { timeout: 10000 }).catch(() => {});
      const before = await txt(p2, T('c2-del-count'));
      const q = S.bill.lines[0].quantity;
      const first = p2.locator(T('c2-delivered')).first();
      /* WX-P2P-19: nothing typed — the box shows the pending quantity, and Delivered records what it shows */
      await first.click().catch(() => {}); await p2.waitForTimeout(2000);
      const after = await txt(p2, T('c2-del-count')), t = await text(p2), name = await shot(p2, 'd14-goods-in-lines');
      if (p2 !== page) await p2.close().catch(() => {});
      return { ok: /0 of/.test(before) && new RegExp(q + ' of ' + q).test(after), saw: name + ' · ' + (p2 === page ? 'no new tab opened; ' : 'new tab; ') + 'before "' + before + '" → after "' + after + '"' + (/Recorded/.test(t) ? ' · toast Recorded' : '') };
    });
    await w.step('D15', 'The sheet -> Goods in -> "What is it for?" -> To sell -> the bill reads "Accepted" (step 4 · supplier bill accepted; the hook posts it)', async () => {
      await openBillSheet();
      await page.click(T('cs-act-goodsin')); await page.waitForSelector(T('bill-use-choice'), { timeout: 8000 });
      const ask = await txt(page, T('bill-use-choice'));
      await page.click(T('bill-use-resale'));
      /* R102: accepting the bill asks first — "Accept <supplier>'s bill <no> for ₹…?" — the Yes tap is the deliberate step */
      await page.waitForSelector('#cb_confirm ' + T('confirm-ok'), { timeout: 5000 }).catch(() => {});
      const askYes = await txt(page, '#cb_confirm').catch(() => '');
      await page.click('#cb_confirm ' + T('confirm-ok')).catch(() => {}); await page.waitForTimeout(3500);
      const t = await txt(page, '#chitsheet') + (askYes ? ' · asked: ' + askYes.replace(/\s+/g, ' ').slice(0, 80) : '');
      await page.click(T('cs-close')).catch(() => {});
      return { ok: /What is it for/.test(ask) && /Accepted/.test(t), saw: '"' + ask.slice(0, 60) + '"; sheet: ' + t.slice(0, 140) };
    });

    /* ── step 6 · posted: CB Accounts ── */
    await w.step('D16', 'Accounts › Unpaid bills › Received (step 6) -> the bill from Kumar Trade Co with its amount and the server\'s step word', async () => {
      await open(page, '/accounts.html#bills', T('bills-list'));
      await page.waitForFunction((no) => document.body.innerText.indexOf(no) >= 0, S.bill.no, { timeout: 10000 }).catch(() => {});
      const t = await text(page), row = S.bill.chit_id ? await txt(page, T('bill-' + S.bill.chit_id)) : '', step = S.bill.chit_id ? await txt(page, T('bill-step-' + S.bill.chit_id)) : '';
      return { ok: /Kumar Trade Co/.test(row) && row.indexOf(money(S.bill.total)) >= 0 && /Accepted|accepted/.test(step), saw: t.slice(t.indexOf('Received'), t.indexOf('Received') + 30) + ' … row "' + row.slice(0, 100) + '"; step "' + step + '"' };
    });
    await w.step('D17', 'Accounts › Payables -> Kumar Trade Co · you owe the bill\'s amount, with Pay; Day book -> the PV entry names Kumar Trade Co with Purchases + GST', async () => {
      await open(page, '/accounts.html#payables', T('dues-list')); await page.waitForTimeout(1500);
      const tp = await text(page);
      const payable = page.locator(T('dues-' + sup.me.identity_id)); const prow = await payable.count() ? norm(await payable.innerText()) : '';
      await open(page, '/accounts.html#daybook', T('db-list'));
      await page.fill(T('listctl-search-daybook'), 'Kumar Trade Co').catch(() => {}); await page.waitForTimeout(900);
      const td = await text(page);
      const k = td.indexOf(S.bill.no), pv = k >= 0 ? td.slice(td.lastIndexOf('PV/', k), k + 200) : '';
      S.owed = (prow.match(/₹\s?[\d,]+\.\d\d/) || [''])[0];
      return { ok: /Kumar Trade Co/.test(prow) && !!S.owed && /Pay/.test(prow) && /Kumar Trade Co/.test(pv) && /Purchases/.test(pv) && /GST/.test(pv), saw: 'payables row "' + prow.slice(0, 110) + '"; day book: ' + (pv || td.slice(td.indexOf('shown'), td.indexOf('shown') + 120)) };
    });
    await w.step('D18', 'Accounts › Ledgers › Suppliers › Kumar Trade Co -> the party\'s ledger: Opening · Closing … Cr in the head, the bill as "Purchase · Bill KT/…" with its amount Cr', async () => {
      await open(page, '/accounts.html#ledgers', T('lt-tree'));
      await page.click('[data-tn="L:2100"]').catch(() => {}); await page.waitForTimeout(1200);   /* Suppliers: opens the control ledger and unfolds its parties */
      let party = page.locator('[data-tn="P:' + sup.me.identity_id + '"]').first();
      if (!(await party.count())) { await page.fill(T('lt-find'), 'Kumar Trade').catch(() => {}); await page.waitForTimeout(900); party = page.locator('[data-tn="P:' + sup.me.identity_id + '"]').first(); }
      const found = await party.count();
      if (found) { await party.click(); await page.waitForTimeout(1500); }
      const t = await text(page), i = t.indexOf(S.bill.no), head = t.slice(t.indexOf('Kumar Trade Co Opening'), t.indexOf('Kumar Trade Co Opening') + 60);
      return { ok: found > 0 && /Closing ₹[\d,.]+ Cr/.test(head) && i >= 0 && /Purchase · Bill/.test(t.slice(i - 20, i)) && t.indexOf(money(S.bill.total)) >= 0, saw: (found ? '' : 'no tree node for the party; ') + head + ' … ' + t.slice(Math.max(0, i - 24), i + 60) };
    });

    /* ── step 5 · payment: Payables › Pay ── */
    await w.step('D19', 'Payables › Pay Kumar Trade Co -> the sheet: amount typed -> the bill is proposed oldest first with the amount applied; Record -> Recorded · Settled: the bill · Balance settled · the advice line', async () => {
      await open(page, '/accounts.html#payables', T('dues-list')); await page.waitForTimeout(1200);
      const row = page.locator(T('dues-' + sup.me.identity_id));
      if (!(await row.count())) return { ok: false, saw: 'Kumar Trade Co is not on Payables' };
      await row.locator('[data-testid^="dues-pay-"]').first().click({ force: true });
      await page.waitForSelector(T('pay_title'), { timeout: 10000 });
      const title = await txt(page, T('pay_title'));
      await page.fill(T('pay_amt'), String(S.bill.total.toFixed(2))); await page.fill(T('pay_ref'), 'NEFT 4421'); await page.selectOption(T('pay_mode'), 'bank');
      await page.waitForSelector('[data-testid^="alloc-row-"]', { timeout: 10000 }).catch(() => {});
      const bills = await txt(page, T('pay_bills')), left = await txt(page, T('pay_left'));
      /* a band ("the last bill was settled today" — the duplicate rule) holds Record until its own button is pressed: that press is the acknowledgement */
      const band = await page.locator(T('pay_band')).isVisible().catch(() => false), bandWords = band ? await txt(page, T('pay_band_words')) : '', ackLabel = band ? await txt(page, T('pay_ack')) : '';
      if (band) await page.click(T('pay_ack')); else { await page.click(T('pay_record')); await page.click('dialog[open] ' + T('confirm-ok'), { timeout: 5000 }).catch(() => {}); } /* R102b: Record asks first; the band's button is its own ask */
      await page.waitForSelector(T('pay_outcome'), { timeout: 15000 }).catch(() => {});
      const out = await txt(page, '#pay_body'), adv = await page.locator(T('pay_advice')).count();
      S.paid = /Paid|Recorded/.test(out); S.settledNo = (out.match(/Settled: ([^ ]+)/) || [])[1] || ''; S.settledOther = !!(S.settledNo && S.settledNo !== S.bill.no);
      S.settledOther = S.settledOther || (/settles \d+ bills/.test(left));
      return { ok: /Pay · Kumar Trade Co/.test(title) && bills.indexOf(S.bill.no) >= 0 && /settles \d+ bills?/.test(left) && /Paid|Recorded/.test(out) && /Settled/.test(out) && adv === 1, saw: '"' + title + '"; bills: ' + bills.slice(0, 90) + '; line: ' + left + (band ? '; band "' + bandWords.slice(0, 80) + '" → pressed "' + ackLabel + '"' + (/advance/i.test(ackLabel) ? ' [the band\'s only yes is "as advance" though the bills are applied — WX-P2P-11]' : '') : '') + '; outcome: ' + out.slice(0, 200) };
    });
    await w.step('D20', 'The outcome -> Send advice -> "Advice sent to Kumar Trade Co ✓"; the SUPPLIER\'s Task shows the advice chit', async () => {
      const before = await txt(page, T('pay_advice'));
      const send = page.locator(T('pay_advice')).locator('button', { hasText: /Send advice/ }).first();
      const may = await send.count() ? await send.isEnabled() : false;
      if (may && !/advice sent/.test(before)) await send.click();
      await page.waitForFunction(() => /Advice sent to|advice sent/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
      const out = await txt(page, T('pay_advice'));
      await page.click(T('pay_done')).catch(() => {});
      await open(supUI.page, '/app.html#/app/task', T('task-count'));
      await supUI.page.fill('#listsrch', 'advice').catch(() => {});
      await supUI.page.waitForFunction(() => /advice/i.test(document.body.innerText) && !/Nothing in Open/.test(document.body.innerText), null, { timeout: 10000 }).catch(() => {});
      await supUI.page.waitForTimeout(600);
      const ts = await text(supUI.page), name = await shot(supUI.page, 'd19-supplier-advice'), k = ts.search(/advice/i);
      return { ok: /advice sent|Advice sent to Kumar Trade Co/.test(out) && /advice/i.test(ts.slice(ts.indexOf('shown'))), saw: 'outcome: "' + out.slice(0, 90) + '"' + (/advice sent · delivered/.test(before) ? ' [sent by the record itself, before any press]' : '') + '; supplier: ' + name + ' ' + ts.slice(Math.max(0, k - 60), k + 90) };
    });
    await w.step('D21', 'After the payment: Payables shows Kumar Trade Co owed less by the bill (or gone); Unpaid bills › Received no longer lists the bill', async () => {
      await open(page, '/accounts.html#payables', T('dues-list')); await page.waitForTimeout(1500);
      const tp = await text(page);
      await open(page, '/accounts.html#bills', T('bills-list')); await page.waitForTimeout(1500);
      const tb = await text(page);
      await page.waitForSelector(T('dues-' + sup.me.identity_id), { timeout: 8000 }).catch(() => {});
      if (!(await page.locator(T('dues-' + sup.me.identity_id)).count())) { await open(page, '/accounts.html#payables', T('dues-list')); await page.waitForSelector(T('dues-' + sup.me.identity_id), { timeout: 8000 }).catch(() => {}); }
      const prow = await txt(page, T('dues-' + sup.me.identity_id)).catch(() => ''), now = (prow.match(/₹\s?[\d,]+\.\d\d/) || [''])[0];
      const minor = (x) => Math.round(Number(String(x).replace(/[^\d.]/g, '')) * 100);
      const settled = !prow || (S.owed && minor(S.owed) - minor(now) === Math.round(S.bill.total * 100));
      /* oldest first: on a re-run the payment settles the OLDEST open bill, which may be an earlier run's — then this one stays open, rightly */
      const mine = !S.settledOther, stillOpen = S.bill.chit_id ? await page.locator(T('bill-' + S.bill.chit_id)).count() : 0;
      const settledShown = S.settledNo ? await page.locator('[data-testid^="bill-"]', { hasText: S.settledNo }).count() : 0;
      return { ok: settled && (mine ? stillOpen === 0 : true), saw: 'payables: ' + (prow ? 'owed ' + S.owed + ' → ' + now : 'the party is gone') + '; bills: ' + (mine ? (stillOpen ? 'this bill is STILL open' : 'this bill is gone') : 'the payment settled the older ' + S.settledNo + ' (oldest first); this bill stays open') + (S.settledNo && !mine ? '; the settled bill ' + (settledShown ? 'is STILL listed under Unpaid bills [WX-P2P-12]' : 'is gone') : '') };
    });

    /* ── reports ── */
    await w.step('D22', 'Trial balance -> 2100 Suppliers and 1500 Bank are rows, Dr = Cr; P&L -> 5000 Purchases; GST close & pay -> the month picker and the one button', async () => {
      await open(page, '/accounts.html#tb', T('tb-balanced')); const t1 = await text(page), bal = await txt(page, T('tb-balanced'));
      await open(page, '/accounts.html#pl', T('pl-profit')); const t2 = await text(page);
      await open(page, '/accounts.html#gstclose', T('pg-close')); const t3 = await text(page);
      return { ok: /1500 Bank/.test(t1) && /2210 Input CGST/.test(t1) && /✓ balances/.test(bal) && /5000 · Purchases/.test(t2) && /Close the month/.test(t3), saw: 'TB: ' + t1.slice(t1.indexOf('1500'), t1.indexOf('1500') + 40) + ' · ' + (/2100/.test(t1) ? 'Suppliers listed' : 'Suppliers nets to nothing after the payment (no row, rightly)') + ' · ' + bal + ' · ' + t1.slice(t1.indexOf('Total'), t1.indexOf('Total') + 40) + '; P&L: ' + t2.slice(t2.indexOf('5000'), t2.indexOf('5000') + 40) + '; GST: ' + t3.slice(t3.indexOf('Financial year'), t3.indexOf('Financial year') + 60) };
    });

    /* ── reverse: the trail shows both ── */
    await w.step('D23', 'Day book -> the payment entry (PY) -> Reverse with a reason -> the entry carries "reversed" and the reversal is a row of its own; Payables lists Kumar Trade Co again', async () => {
      await open(page, '/accounts.html#daybook', T('db-list'));
      await page.fill(T('listctl-search-daybook'), 'Kumar Trade Co').catch(() => {}); await page.waitForTimeout(900);
      const head = page.locator('[data-testid^="db-head-PY"]').last();
      const no = await head.count() ? await head.evaluate((e) => e.getAttribute('data-testid').replace('db-head-', '')) : '';
      if (no) { await head.click(); await page.waitForTimeout(900); }
      const rev = page.locator(T('db-reverse')).first();
      const had = await rev.count();
      if (had) {
        await rev.click(); await page.waitForSelector(T('en-reason'), { timeout: 8000 }).catch(() => {});
        await page.fill(T('en-reason'), 'Paid twice by mistake').catch(() => {});
        const go = page.locator('[data-testid="confirm-ok"], [data-testid="ask-ok"], dialog button, .mfoot button.pri, button.pri', { hasText: /^Reverse$/ }).last();
        await go.click().catch(() => {}); await page.waitForTimeout(2500);
      }
      await page.fill(T('listctl-search-daybook'), '').catch(() => {}); await page.fill(T('listctl-search-daybook'), no.slice(-6)).catch(() => {}); await page.waitForTimeout(900);
      const t = await text(page);
      await open(page, '/accounts.html#payables', T('dues-list')); await page.waitForTimeout(1500);
      const tp = await text(page);
      const i = t.indexOf('Reversed by'), j = t.indexOf('Reverses') >= 0 ? t.indexOf('Reverses') : t.indexOf('reversal');
      return { ok: !!no && had === 1 && /Reversed by/.test(t) && /Kumar Trade Co/.test(tp), saw: 'entry ' + (no || 'NOT FOUND') + '; Reverse button: ' + had + '; trail: ' + (i >= 0 ? t.slice(Math.max(0, i - 60), i + 60) : t.slice(t.indexOf(no), t.indexOf(no) + 160)) + (j >= 0 ? ' … ' + t.slice(Math.max(0, j - 40), j + 60) : '') + '; payables: ' + (/Kumar Trade Co/.test(tp) ? 'listed again' : 'not listed') };
    });

    /* ── the refused states, with a view-only login ── */
    if (viewer) {
      const vUI = await ctxFor(browser, viewer);
      await w.step('D24', 'A VIEW-ONLY co-assist on Accounts -> the Ledger opens read-only: Payables › Pay is shown but the record is refused in the server\'s sentence; GST close is refused the same way', async () => {
        const p = vUI.page;
        await open(p, '/accounts.html#payables', T('dues-list') + ', ' + T('acc-card')); await p.waitForTimeout(1500);
        const t0 = await text(p);
        let paySaw = '';
        const row = p.locator('[data-testid^="dues-pay-"]').first();
        if (await row.count()) {
          await row.click({ force: true }).catch(() => {});
          if (await p.waitForSelector(T('pay_title'), { timeout: 8000 }).catch(() => null)) {
            await p.fill(T('pay_amt'), '10.00'); await p.waitForTimeout(1500);
            if (await p.locator(T('pay_band')).isVisible().catch(() => false)) await p.click(T('pay_ack')); else { await p.click(T('pay_record')).catch(() => {}); await p.click('dialog[open] ' + T('confirm-ok'), { timeout: 5000 }).catch(() => {}); }
            await p.waitForTimeout(2500);
            paySaw = await txt(p, T('pay_why')) + ' | ' + await txt(p, '#pay_body'); await p.click(T('pay_done')).catch(() => {}); await p.evaluate(() => { try { closeModal(); } catch (_) {} });
          }
        }
        await open(p, '/accounts.html#gstclose', T('pg-close') + ', ' + T('acc-card')); await p.waitForTimeout(800);
        await p.click(T('pg-close')).catch(() => {}); await p.waitForTimeout(2500);
        const t2 = await text(p), name = await shot(p, 'd23-viewer');
        const payRefused = /view-only/i.test(paySaw) && !/Paid ₹/.test(paySaw);
        return { ok: /Payables|Accounts/.test(t0) && payRefused && /Only the owner may do this/.test(t2), saw: name + ' · opened: ' + t0.slice(0, 60) + '; pay: "' + paySaw.slice(0, 120) + '"' + (payRefused ? '' : ' [a VIEW-ONLY login RECORDED a payment — WX-P2P-15]') + '; gst: ' + (t2.match(/Only the owner may do this\.?/) || ['no refusal sentence'])[0] };
      });
      await vUI.ctx.close();
    } else w.note('D24', 'view-only co-assist', 'no viewer login (' + VIEWER + ') on this stack — see the findings file for how to make one');
    await supUI.ctx.close();
  }

  /* ═══ WIDTH — every screen the flow touches, at 1366 × 768 and 390 × 844, its controls and its empty / refused states ═══ */
  if (ONLY !== 'D') {
    buyer = loaded;
    await page.goto(WEB + '/index.html', { waitUntil: 'load' }).catch(() => {});
    await page.evaluate((s) => { try { localStorage.clear(); localStorage.setItem('cb_sess', s); localStorage.setItem('cb_sess_walk', '1'); } catch (_) {} }, JSON.stringify(loaded.sess));
    const screens = [
      ['supplies', '/app.html#/app/supplies', T('supply-add'), ['supply-add', 'supply-buy'], /Things the shop buys and uses/],
      ['intake', '/app.html#/app/intake', T('intake-simulate-open'), ['intake-refresh', 'intake-simulate-open', 'listctl-search-intake'], /A message is a notice/],
      ['suppliers', '/app.html#/app/suppliers', '[data-testid^="sup-row-"]', ['sup-tab-trade', 'sup-tab-other', 'sup-add', 'sup-find', 'sup-tab-req', 'listctl-search-suppliers', 'cols-btn-suppliers'], /Kumar Trade Co/],
      ['task', '/app.html#/app/task', T('task-count'), ['folder-metrics-btn', 'folder-groupsum-btn', 'view-grid-task', 'view-lines-task', 'cols-btn-task'], /chits received/],
      ['order', '/app.html#/app/order', T('task-count'), ['view-grid-task', 'cols-btn-task'], /chits you've sent/],
      ['acc-todo', '/accounts.html#todo', T('todo-list') + ', ' + T('todo-none'), ['acc-nav-payables', 'acc-nav-bills', 'acc-nav-daybook', 'acc-nav-ledgers'], /To do/],
      ['acc-payables', '/accounts.html#payables', T('dues-list'), ['listctl-search-dues', 'cbl-filters-dues', 'cols-btn-dues', 'cbl-csv-dues'], /Payables/],
      ['acc-bills', '/accounts.html#bills', T('bills-list'), ['bills-tab-B-2100', 'bills-tab-B-1300', 'listctl-search-bills'], /Received/],
      ['acc-daybook', '/accounts.html#daybook', T('db-list'), ['cbl-period-daybook', 'db-add', 'db-group-day', 'db-group-week', 'db-group-month', 'db-csv'], /Day book/],
      ['acc-ledgers', '/accounts.html#ledgers', T('lt-tree'), ['lt-search', 'lg-acc-2100', 'lg-acc-1300'], /Suppliers/],
      ['acc-tb', '/accounts.html#tb', T('tb-balanced'), [], /Trial balance/],
      ['acc-pl', '/accounts.html#pl', T('pl-profit'), [], /P&L/],
      ['acc-waiting', '/accounts.html#waiting', T('bk-body'), [], /Waiting/],
      ['acc-cheques', '/accounts.html#cheques', T('cheques-list'), ['listctl-search-cheques'], /Cheques/],
      ['acc-gst', '/accounts.html#gstclose', T('pg-close'), ['pg-close'], /GST close/],
    ];
    const phone = await ctxFor(browser, buyer, { width: 390, height: 844 });
    let n = 0;
    for (const [key, url, until, ctl, words] of screens) {
      n++;
      await w.step('W' + String(n).padStart(2, '0'), key + ' at 1366 and 390: its words, every control present, no sideways scroll at 390 (scrollWidth = 390)', async () => {
        await open(page, url, until); const t = await text(page); const [sw, cw] = await widths(page);
        const missing = []; for (const c of ctl) if (!(await page.locator(T(c)).count())) missing.push(c);
        await open(phone.page, url, until); const tp = await text(phone.page); const [sw2] = await widths(phone.page);
        const missing2 = []; for (const c of ctl) if (!(await phone.page.locator(T(c)).count())) missing2.push(c);
        const name = await shot(phone.page, 'w-' + key + '-390');
        const ok = words.test(t) && words.test(tp) && sw <= cw && sw2 === 390 && !missing.length && !missing2.length;
        return { ok, saw: '1366: ' + (words.test(t) ? 'words ok' : 'WORDS MISSING') + (missing.length ? ', missing ' + missing.join(',') : '') + ' · 390: ' + (words.test(tp) ? 'words ok' : 'WORDS MISSING') + ', scrollWidth ' + sw2 + (missing2.length ? ', missing ' + missing2.join(',') : '') + ' · ' + name };
      });
    }
    await w.step('W16', 'Pay sheet at 390: opens full width, the amount, how, reference and the bills table fit, Cancel and Record reachable', async () => {
      const p = phone.page;
      await open(p, '/accounts.html#payables', T('dues-list')); await p.waitForTimeout(1200);
      const row = p.locator('[data-testid^="dues-pay-"]').first();
      if (!(await row.count())) return { ok: false, saw: 'no Pay button on Payables at 390' };
      await row.click({ force: true }); await p.waitForSelector(T('pay_title'), { timeout: 10000 });
      await p.fill(T('pay_amt'), '100.00'); await p.waitForSelector('[data-testid^="alloc-row-"]', { timeout: 10000 }).catch(() => {});
      const [sw] = await widths(p), t = await txt(p, '#pay_body'), name = await shot(p, 'w-pay-390');
      /* on screen means INSIDE the 390 × 844 window: the first Apply box wholly within the width, Record within the height (SYSTEM rule 8: no sideways scroll, a table is cards below 620) */
      const box = await p.locator(T('alloc-0')).first().boundingBox().catch(() => null), rb = await p.locator(T('pay_record')).boundingBox().catch(() => null);
      const applyIn = !!(box && box.x >= 0 && box.x + box.width <= 390), recIn = !!(rb && rb.y >= 0 && rb.y + rb.height <= 844);
      await p.click(T('pay_done')).catch(() => {}); await p.evaluate(() => { try { closeModal(); } catch (_) {} });
      return { ok: sw === 390 && applyIn && recIn && /Oldest bill first/.test(t), saw: 'scrollWidth ' + sw + '; Apply box ' + (box ? 'x ' + Math.round(box.x) + '–' + Math.round(box.x + box.width) : 'none') + (applyIn ? '' : ' CLIPPED') + '; Record ' + (rb ? 'y ' + Math.round(rb.y) : 'none') + (recIn ? '' : ' OFF SCREEN') + ' [WX-P2P-14]' + ' · ' + name };
    });
    await w.step('W17', 'Supplies at 390: Add a supply sheet fits (scrollWidth 390), its three fields and two buttons on screen', async () => {
      const p = phone.page;
      await open(p, '/app.html#/app/supplies', T('supply-add'));
      await p.click(T('supply-add')); await p.waitForSelector(T('supply-name'), { timeout: 8000 });
      const [sw] = await widths(p), save = await p.locator(T('supply-save')).isVisible(), name = await shot(p, 'w-supply-add-390');
      await p.evaluate(() => { try { closeModal(); } catch (_) {} });
      return { ok: sw === 390 && save, saw: 'scrollWidth ' + sw + '; Add visible ' + save + ' · ' + name };
    });
    await w.step('W18', 'Suppliers › Kumar Trade Co at 390: the detail replaces the list (‹ Suppliers to go back), the catalogue and the cart fit', async () => {
      const p = phone.page;
      await open(p, '/app.html#/app/suppliers', '[data-testid^="sup-row-"]');
      await p.locator('[data-testid^="sup-row-"]', { hasText: 'Kumar Trade Co' }).first().click(); await p.waitForSelector(T('cart-add'), { timeout: 15000 }).catch(() => {});
      const [sw] = await widths(p), back = await p.locator('.dback, [data-testid="sup-back"]').first().isVisible().catch(() => false), adds = await p.locator(T('cart-add')).count(), name = await shot(p, 'w-supplier-detail-390');
      return { ok: sw === 390 && adds > 5, saw: 'scrollWidth ' + sw + '; back ' + back + '; ' + adds + ' items · ' + name };
    });
    await phone.ctx.close();
  }
};
walk.opts = { base: WEB };   /* the real site, not the fixture server */
W.run('x-p2p', walk);
