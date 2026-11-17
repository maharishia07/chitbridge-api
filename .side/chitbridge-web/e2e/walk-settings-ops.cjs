#!/usr/bin/env node
/**
 * e2e/walk-settings-ops.cjs — CB SETTINGS › Counters & keys · Connectors · Policy · Plan & usage, WALKED (T3-SETTINGS, 2026-10-14; app/cap-settings.js).
 * Black box: it presses what an owner presses — add a counter, open one on this PC, release one, make a key and revoke one, download a connector kit,
 * say "we use this", approve a PC, change a rule, read the plan — and what a CO-ASSIST sees (every counters action greyed with the server's sentence,
 * nothing sent). Then RULE 13 on each section (e2e/lib/rule13.cjs): Cream and Dark × 1366 and 390 px.
 *   default   a stand-in api answering inside the page (nothing leaves the runner)
 *   --real    the local api (e2e/lib/real-stack.cjs: ../chitbridge-api/server.js on CB_REAL_DB, DEV_OTP) signed in as simstores@test.example —
 *             the read paths and rule 13 on real routes; the writes that would change the sim shop (open · release · revoke) are not pressed
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-settings-ops.cjs [--real] [--show]
 * One line per path: "ID · path · PASS/FAIL (what it saw)". Screenshots: e2e/shots/walk-settings-ops-NN.png.
 */
'use strict';
const TD = require('./lib/today.cjs');   /* QW1-TODAY: the one injected today (CB_TODAY) — never the runner's clock */
const W = require('./lib/walk.cjs');
const REAL = process.argv.includes('--real');
const C = require('./lib/contract.cjs');   /* M43: every answer for a route in the API contract is held to it (RAIL-LAB-SRV1: the facts family) */
const J = C.json;
const crmApi = require('./lib/crm-api.cjs');   /* RAIL-LAB-SRV1: the rail card (GET /api/facts/rail) from its one builder */

const walk = async (w) => {
  const { page, ctx, base } = w;
  const S = { calls: [], polFail: false, coassist: false, ctrFail: false, opened: [] };
  const ago = (min) => new Date(TD.nowMs() - min * 60000).toISOString();
  const OWNER_SAYS = 'Only the owner can change the counters.';
  const COUNTERS = () => [
    { id: 'C1', name: 'Front desk', state: 'open', held_by: { name: 'counter C1 · Win32', seen: { ip: '10.0.0.4', at: ago(2) } }, next: 42, last_no: 'C1/26-27/0041', closed_at: null },
    { id: 'C2', name: 'Billing 2', state: 'closed', held_by: null, next: 7, last_no: 'C2/26-27/0006', closed_at: ago(600) }];
  /* the minted secret the stand-in shows once: fake by construction (a prefix + a run of x), so no scanner reads it as a key (INT6d-GREEN: gitleaks generic-api-key) */
  const NEW_KEY = 'cbk_test_' + 'x'.repeat(12);
  const KEYS = [{ jti: 'k-till', name: 'counter C1 · Win32 · 2026-10-01', scopes: ['till'], last4: 'a1b2', created_at: '2026-10-01T09:00:00Z', seen: { at: ago(2), ip: '10.0.0.4', agent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120' } },
    { jti: 'k-svc', name: 'Price feed', scopes: ['services'], last4: 'c3d4', created_at: '2026-09-20T09:00:00Z', seen: null }];
  const FLAGS = { trade_side: 'sell', trade_cover: 'off', books_at: 'accepted', tol_weight_bp: 50, dispute_scope: 'per-party', connectors_in_use: [] };
  /* the rows ARE the server's (T2-POLICY: schema[key].ui + bound_schema — the web holds no flag list): the shape GET /entities/policy answers */
  const ui = (order, label, more) => Object.assign({ label, level: 'entity', gov: 'entity', order, help: '' }, more || {});
  const SCHEMA = { trade_side: { type: 'enum', options: ['sell', 'receive'], def: 'sell', ui: ui(1, 'This entity') },
    gst_registration: { type: 'enum', options: ['regular', 'composition', 'unregistered', 'sez'], def: 'regular', ui: ui(2, 'GST registration') },
    books_at: { type: 'enum', options: ['received', 'accepted', 'completed', 'manual'], def: 'accepted', ui: ui(3, 'Orders go to the books') },
    tol_weight_bp: { type: 'number', def: 50, ui: ui(4, 'Short delivery allowed (weighed goods)', { scale: 100, suffix: '%', step: 0.01 }) },
    trade_cover: { type: 'enum', options: ['off', 'on'], def: 'off', ui: ui(5, 'Trade cover on chits') },
    self_copy_pref: { type: 'enum', options: ['received', 'both', 'sent'], def: 'received', ui: ui(6, 'Self-chit copy', { labels: { received: 'Task only', both: 'Both Task and Order', sent: 'Order only' } }) },
    connectors_in_use: { type: 'list', def: [] } };
  const BOUND_SCHEMA = { dispute_scope: { type: 'enum', options: ['per-party', 'shared'], def: 'per-party', ui: ui(7, 'Dispute messages', { level: 'platform', gov: 'bound', help: 'Set by the platform' }) } };
  const ok = { ok: true, code: null, why: null };
  const MAY = { trade_side: ok, trade_cover: ok, books_at: ok, tol_weight_bp: ok, connectors_in_use: ok, gst_registration: ok, self_copy_pref: ok,
    dispute_scope: { ok: false, code: 'PLATFORM_BOUND', why: 'Set by the platform for every shop.' } };
  const CAT = [{ id: 'tally', name: 'Tally', does: 'Products and stock up, orders down as vouchers.', adapters: ['tally'], default_adapter: 'tally', steps: ['Download', 'Unzip on the Tally PC', 'Double-click start.cmd'], may: { ok: true } },
    { id: 'zoho', name: 'Zoho Books', does: 'Invoices and payments both ways.', adapters: ['zoho'], may: { ok: false, code: 'NOT_YET_FOR_COUNTRY', why: 'Our Zoho Books kit is built for India\'s GST so far — not yet for a Australia shop.' } }];   /* SET-WALK1 W16: the code words the row */
  const RUN = [{ id: 'k9', actor_id: 'act-9', name: 'Tally on OFFICE-PC', adapter: 'tally', host: 'OFFICE-PC', last_seen: ago(3), key_jti: 'k9', enrol: { approved: false, host: 'OFFICE-PC', company: 'Fixture Shop' } }];
  let api = base;

  if (REAL) {
    const R = require('./lib/real-stack.cjs');
    S.stack = await R.up({ webBase: base }); api = S.stack.api;
    const owner = await R.signIn(api, 'simstores@test.example');
    ctx.on('request', (q) => { if (q.url().startsWith(api) && q.method() !== 'GET' && q.method() !== 'OPTIONS') S.calls.push(q.method() + ' ' + new URL(q.url()).pathname + ' ' + (q.postData() || '')); });
    await ctx.addInitScript((a) => { try { localStorage.setItem('cb_api_base', a.api); localStorage.setItem('cb_sess', a.s); } catch (_) {} }, { api, s: owner.session });
  } else {
    await ctx.route('**/api/**', async (r) => {
      const q = r.request(), u = new URL(q.url()), p = u.pathname, m = q.method();
      let body = null; try { body = q.postData() ? JSON.parse(q.postData()) : null; } catch (_) {}
      if (m !== 'GET') S.calls.push(m + ' ' + p + (body ? ' ' + JSON.stringify(body) : ''));
      const may = S.coassist ? { ok: false, code: 'OWNER_ONLY', why: OWNER_SAYS } : ok;
      if (p === '/api/entities/me') return J(r, 200, { entity: { display_name: 'Fixture Shop', country_code: 'IN', currency_code: 'INR' } });
      if (p === '/api/counters' && m === 'GET') return S.ctrFail ? J(r, 500, { error: 'Failed' }) : J(r, 200, { counters: COUNTERS(), free: 1, may: { manage: may } });
      if (/^\/api\/counters/.test(p) && S.coassist) return J(r, 403, { error: 'Forbidden', code: 'OWNER_ONLY', message: OWNER_SAYS });
      if (p === '/api/counters' && m === 'POST') return J(r, 201, { counter: { id: 'C3', name: body && body.name } });
      if (/^\/api\/counters\/C\d$/.test(p) && m === 'PATCH') return J(r, 200, { ok: true });
      if (/\/open$/.test(p)) return J(r, 200, { key: 'tk-walk', counter: { id: 'C2', state: 'open' } });
      if (/\/release$/.test(p)) return J(r, 200, { ok: true, id: 'C1' });
      if (p === '/api/keys' && m === 'GET') return J(r, 200, { keys: KEYS, scopes: ['services', 'offers', 'pricing', 'tax', 'invoice', 'till', 'connector'] });   /* SET-WALK1 W15: the kinds THIS login may mint — a shop never sees 'testing' */
      if (p === '/api/keys' && m === 'POST') return J(r, 201, { key: NEW_KEY, jti: 'k-new', name: body && body.name });
      if (/^\/api\/keys\//.test(p) && m === 'DELETE') return J(r, 200, { ok: true });
      if (p === '/api/integrations/catalogue') return J(r, 200, { connectors: CAT });
      if (p === '/api/integrations/status') return J(r, 200, { connectors: RUN });
      if (/^\/api\/integrations\/download\//.test(p)) { S.calls.push('GET ' + p + u.search); return r.fulfill({ status: 200, contentType: 'application/zip', body: 'PK' }); }
      if (/\/approve$/.test(p)) return J(r, 200, { ok: true, enrol: { approved: true } });
      if (p === '/api/entities/policy' && m === 'GET') return J(r, 200, { flags: FLAGS, schema: SCHEMA, bound: { dispute_scope: 'per-party' }, bound_schema: BOUND_SCHEMA, may: MAY });
      if (p === '/api/entities/policy' && m === 'PATCH') { if (S.polFail) return J(r, 403, { error: 'Forbidden', message: 'Only the owner changes this rule.' }); Object.assign(FLAGS, body); return J(r, 200, { flags: FLAGS }); }
      if (p === '/api/entities/entitlements') return J(r, 200, { plan: 'test', name: 'Test', sellable: false, limited: false, features: ['chits'], enforced: false,
        quotas: { entities: { state: 'unlimited' }, actors: { state: 'unset' }, chits_per_month: { state: 'capped', limit: 500 } } });
      if (p === '/api/entities/usage') return J(r, 200, { window_days: 30, counts: { billed: 12 }, total_cost_usd: 0.0123, by_meter: [{ meter: 'chit.send', events: 12, cost: 0.0123 }] });
      if (p === '/api/facts/rail') return J(r, 200, crmApi.railFacts({ suppliers: 0, customers: 0, in: 0, out: 0, stuck: 0 }));
      return J(r, 200, {});
    });
    await ctx.addInitScript((s) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Fixture Owner', 'Fixture Shop'));
  }
  ctx.on('page', (p) => S.opened.push(p.url()));

  const txt = (sel) => page.locator(sel).first().innerText().then((s) => s.replace(/\s+/g, ' ').trim()).catch(() => '');
  const wrote = (re) => S.calls.filter((c) => re.test(c));
  const go = async (sec, ready) => { await page.goto(base + '/settings.html#/' + sec); await page.reload(); await page.waitForSelector(ready, { timeout: 20000 }); await page.waitForTimeout(300); };
  /* WALK-REG 2026-10-16: lists open in the GRID, where a row opens from its caret (a tap on the row's middle can land on a cell's own button) */
  const openRow = async (tid) => { const caret = page.locator('[data-testid="' + tid + '"] [data-caret]'); if (await caret.count()) await caret.first().click(); else await page.click('[data-testid="' + tid + '"]'); await page.waitForTimeout(200); };
  const act = (a, id) => page.locator('[data-act="' + a + '"][data-actrow="' + id + '"]');
  const yes = async () => { await page.waitForSelector('[data-testid="confirm-ok"]', { timeout: 5000 }); await page.click('[data-testid="confirm-ok"]'); await page.waitForTimeout(500); };

  /* ── COUNTERS & KEYS ── */
  await go('counters', '[data-testid="sx-ctr-C1"]');
  await w.step('S1', 'Counters & keys: one CBList, a line per counter (C1 open on its PC, C2 closed), the count from the same answer; the sidebar marks it', async () => {
    const c1 = await txt('[data-testid="sx-ctr-state-C1"]'), c2 = await txt('[data-testid="sx-ctr-state-C2"]'), n = await txt('[data-testid="sx-ctr-count"]');
    const side = await txt('[data-testid="skel-side"]');
    return { ok: REAL ? /counter/.test(n) : (/Open on/.test(c1) && /Closed/.test(c2) && /2 counters · 1 open/.test(n) && /Counters/.test(side) && !/Counters & keys/.test(side)), saw: n + ' · C1 "' + c1 + '" · C2 "' + c2 + '"' };
  });
  if (!REAL) {
    await w.step('S2', 'type a name -> Add a counter -> one POST /api/counters with the name, the outcome said in words', async () => {
      await page.fill('[data-testid="sx-ctr-name"]', 'Back office'); await page.click('[data-testid="sx-ctr-add"]'); await page.waitForTimeout(600);
      const post = wrote(/^POST \/api\/counters /), out = await txt('[data-testid="sx-ctr-out"]');
      return { ok: post.length === 1 && /Back office/.test(post[0]) && /Counter added: C3/.test(out), saw: post.length + ' POST · "' + out + '"' };
    });
    await w.step('S3', 'C2 -> its next level (next bill number, the name) -> Open on this PC -> one POST open -> the till opens with the counter\'s key', async () => {
      await openRow('sx-ctr-C2'); const nx = await txt('[data-testid="sx-ctr-next-C2"]');
      /* WALK-REG 2026-10-16: headless Chromium does not hand the page a popup after the awaited POST, so the walk records what the page asked window.open for */
      await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; });
      await act('open', 'C2').click(); await page.waitForTimeout(800);
      const post = wrote(/POST \/api\/counters\/C2\/open/), till = (await page.evaluate(() => window.__opened || [])).filter((u) => /till\.html#key=tk-walk/.test(u));
      return { ok: /0007/.test(nx) && post.length === 1 && till.length === 1, saw: 'next "' + nx.slice(0, 40) + '" · ' + post.length + ' open · till tabs ' + till.length };
    });
    await w.step('S4', 'C1 (open) -> Release -> the page\'s own confirm names what it costs -> Release -> one POST release', async () => {
      await go('counters', '[data-testid="sx-ctr-C1"]'); await openRow('sx-ctr-C1'); await act('release', 'C1').click();
      await page.waitForSelector('[data-testid="confirm-ok"]', { timeout: 5000 }); const ask = await txt('[data-testid="confirm"]');
      await yes();
      const post = wrote(/POST \/api\/counters\/C1\/release/);
      return { ok: post.length === 1 && /not sent/.test(ask), saw: post.length + ' release · asked "' + ask.slice(0, 80) + '"' };
    });
    await w.step('S5', 'Keys: WALK-REG 2026-10-16: removed by decision - no key list, no Make a key, no key row on Counters or Connectors for a shop owner', async () => {
      const on = async () => (await page.locator('[data-testid="sx-key-list"], [data-testid="sx-key-mint"], [data-testid="sx-key-name"], [data-testid="sx-key-scope"], [data-testid^="sx-key-seen-"]').count());
      const a = await on(); await go('connectors', '[data-testid="sx-con-tally"]'); const b = await on(); await go('counters', '[data-testid="sx-ctr-C1"]');
      return { ok: a === 0 && b === 0 && wrote(/^POST \/api\/keys/).length === 0, saw: 'key controls on Counters ' + a + ', on Connectors ' + b };
    });
    /* S6 (revoke a key) - WALK-REG 2026-10-16: removed by decision, there is no key list to revoke from */
    await w.step('S7', 'a CO-ASSIST: Add and every row action SHOWN, greyed with the server\'s sentence (may.manage); pressing sends nothing', async () => {
      S.coassist = true; const mine = () => S.calls.filter((c) => /\/api\/(counters|keys)/.test(c)); const before = mine().length;
      await go('counters', '[data-testid="sx-ctr-C1"]'); await openRow('sx-ctr-C2');
      const add = await page.locator('[data-testid="sx-ctr-add"]').isDisabled(), why = await txt('[data-testid="sx-ctr-add-why"]');
      const open = await act('open', 'C2').isDisabled(), rowWhy = await txt('[data-testid="sx-ctr-next-C2"] ~ .cbl-acts, .cbl-next[data-next="C2"] .cbl-why');
      await act('open', 'C2').click({ force: true }).catch(() => {}); await page.waitForTimeout(300);
      S.coassist = false;
      return { ok: add && why === OWNER_SAYS && open && rowWhy.indexOf(OWNER_SAYS) >= 0 && mine().length === before, saw: 'Add greyed ' + add + ' "' + why + '" · Open greyed ' + open + ' "' + rowWhy + '" · sent ' + (S.calls.length - before) };
    });
    await w.step('S8', 'the counters read fails -> "Could not read this" + Try again in the list, never "No counters yet"', async () => {
      S.ctrFail = true; await go('counters', '[data-testid="cbl-error-set-counters"]');
      const e = await txt('[data-testid="cbl-error-set-counters"]'); S.ctrFail = false;
      return { ok: /Could not read this/.test(e) && /Try again/.test(e) && !/No counters/.test(e), saw: '"' + e + '"' };
    });
  }

  /* ── CONNECTORS ── */
  await go('connectors', '[data-testid="sx-con-tally"]');
  await w.step('S9', 'Connectors: Tally "Works here"; Zoho "Not yet for your country" (from its code, W16) — its Download shown and greyed with the server\'s sentence', async () => {
    const t = await txt('[data-testid="sx-con-may-tally"]'), z = await txt('[data-testid="sx-con-may-zoho"]');
    if (REAL) return { ok: !!t, saw: 'tally "' + t + '"' };
    await openRow('sx-con-zoho'); const dis = await act('kit', 'zoho').isDisabled(), why = await txt('[data-testid="sx-con-why-zoho"]');   /* WALK-REG 2026-10-16: tag is "Available"; Download is a row button sx-con-kit-<id> */
    return { ok: /Available/.test(t) && /Not yet for your country/.test(z) && dis && /not yet for a/.test(why), saw: '"' + t + '" · "' + z + '" · greyed ' + dis + ' "' + why + '"' };
  });
  if (!REAL) {
    await w.step('S10', 'Tally -> We use this -> one PATCH /entities/policy { connectors_in_use: ["tally"] }; the row says "We use this"', async () => {
      await openRow('sx-con-tally'); await act('use', 'tally').click(); await page.waitForTimeout(600);
      const p = wrote(/PATCH \/api\/entities\/policy/), tag = await txt('[data-testid="sx-con-inuse-tally"]');
      return { ok: p.length === 1 && /"connectors_in_use":\["tally"\]/.test(p[0]) && /We use this/.test(tag), saw: (p[0] || '').slice(0, 90) + ' · "' + tag + '"' };
    });
    await w.step('S11', 'Tally -> Download the kit -> one download through the session, the outcome said', async () => {
      await go('connectors', '[data-testid="sx-con-tally"]'); await openRow('sx-con-tally'); await act('kit', 'tally').click(); await page.waitForTimeout(800);
      const d = wrote(/GET \/api\/integrations\/download\/tally\?adapter=tally/), out = await txt('[data-testid="sx-con-out"]');
      return { ok: d.length === 1 && /Downloaded/.test(out), saw: d.length + ' download · "' + out + '"' };
    });
    await w.step('S12', 'Running: the OFFICE-PC kit "Waiting for you" -> Approve this PC -> one POST approve', async () => {
      const tag = await txt('[data-testid="sx-run-ok-act-9"]'); await openRow('sx-run-act-9'); await act('approve', 'act-9').click(); await page.waitForTimeout(600);
      const p = wrote(/POST \/api\/integrations\/act-9\/approve/);
      return { ok: /Waiting/.test(tag) && p.length === 1, saw: '"' + tag + '" · ' + p.length + ' approve' };
    });
  }

  /* ── POLICY ── */
  await go('policy', '[data-testid="sx-pol-tol_weight_bp"]');   /* WALK-REG 2026-10-16: trade_side, trade_cover, chit_expiry_days are hidden */
  await w.step('S13', 'Policy: one CBList of the rules with their words; "Dispute messages" says the platform decides, its Save greyed with the server\'s sentence', async () => {
    const has = (sel) => page.locator(sel).first().count().then((n) => n > 0);
    const lbl = await txt('[data-testid="sx-pol-books_at"]'), who = await txt('[data-testid="sx-pol-who-dispute_scope"]');
    const hidden = (await page.locator('[data-testid="sx-pol-trade_side"], [data-testid="sx-pol-trade_cover"], [data-testid="sx-pol-chit_expiry_days"]').count()) === 0;
    const title = await txt('[data-testid="sx-title"]'), optional = await has('[data-testid="sx-pol-optional"]');
    if (REAL) return { ok: /Orders go to the books/.test(lbl), saw: '"' + lbl + '"' };
    /* WALK-REG 2026-10-16: no Save button - an opened row is the control + an info icon; a rule the platform sets has its control greyed, the reason in the icon's title */
    await openRow('sx-pol-dispute_scope'); const dis = await page.locator('[data-testid="sx-pol-in-dispute_scope"]').isDisabled(), why = await page.getAttribute('[data-testid="sx-pol-why-dispute_scope"]', 'title').catch(() => ''), noSave = (await page.locator('[data-act="save"]').count()) === 0;
    return { ok: /Orders go to the books/.test(lbl) && hidden && /Policy/.test(title) && optional && /platform/i.test(who) && dis && noSave && /Set by the platform/.test(why || ''), saw: '"' + lbl.slice(0, 40) + '" · hidden rows ' + hidden + ' · who "' + who + '" · greyed ' + dis + ' "' + why + '" · no Save ' + noSave };
  });
  if (!REAL) {
    /* R121 (walk 24 Oct): a policy row edits a DRAFT. Nothing is written on change; Save asks first; Cancel puts the old value back and writes nothing. */
    const IN = '[data-testid="sx-pol-in-tol_weight_bp"]', SAVE = '[data-testid="sx-pol-save-tol_weight_bp"]', CANCEL = '[data-testid="sx-pol-cancel-tol_weight_bp"]';
    const policyPatches = () => S.calls.filter((c) => c.includes('PATCH /api/entities/policy') && c.includes('tol_weight_bp'));   /* this row's own writes (S10 left a connectors_in_use one in the log) */
    const vis = (sel) => page.locator(sel).isVisible().catch(() => false);
    await w.step('S14', 'R121 · change a rule, leave the box -> nothing is sent; Save and Cancel appear; Cancel puts 0.5 back and still nothing is sent', async () => {
      await openRow('sx-pol-tol_weight_bp');
      const before = await vis(SAVE);
      await page.fill(IN, '0.75'); await page.dispatchEvent(IN, 'change'); await page.dispatchEvent(IN, 'blur'); await page.waitForTimeout(500);
      const shownNow = (await vis(SAVE)) && (await vis(CANCEL)), sentOnChange = policyPatches().length;
      await page.click(CANCEL); await page.waitForTimeout(300);
      const back = await page.inputValue(IN), gone = !(await vis(SAVE)), sent = policyPatches().length;
      return { ok: !before && shownNow && sentOnChange === 0 && back === '0.5' && gone && sent === 0, saw: 'buttons before ' + before + ' · after edit ' + shownNow + ' · PATCH on change ' + sentOnChange + ' · after Cancel "' + back + '" buttons gone ' + gone + ' · PATCH ' + sent };
    });
    await w.step('S14b', 'R121 · change -> Save -> the confirm says "Change … from 0.5 % to 0.75 %?" -> No sends nothing; Yes -> one PATCH { tol_weight_bp: 75 }, the row says Saved, a reload keeps 0.75', async () => {
      await page.fill(IN, '0.75'); await page.dispatchEvent(IN, 'change'); await page.click(SAVE);
      await page.waitForSelector('[data-testid="confirm-ok"]', { timeout: 5000 });
      const ask = await txt('[data-testid="confirm"]');
      await page.click('[data-testid="confirm-cancel"]'); await page.waitForTimeout(400);
      const afterNo = policyPatches().length;
      await page.click(SAVE); await yes(); await page.waitForTimeout(400);
      const p = policyPatches(), out = await txt('[data-testid="sx-pol-ok-tol_weight_bp"]');
      await go('policy', '[data-testid="sx-pol-tol_weight_bp"]');
      const now = await txt('[data-testid="sx-pol-tol_weight_bp"]');
      return { ok: /Change .*from 0.5.* to 0.75.*?/.test(ask) && afterNo === 0 && p.length === 1 && /"tol_weight_bp":75/.test(p[0]) && /Saved/.test(out) && /0.75 %/.test(now), saw: '"' + ask.slice(0, 80) + '" · after No ' + afterNo + ' · ' + p.length + ' PATCH ' + (p[0] || '').slice(-30) + ' · "' + out + '" · reload "' + now.slice(-24) + '"' };
    });
    await w.step('S14c', 'R121 · the server refuses -> the row says so in the words the server gave and keeps the draft; never silent', async () => {
      S.polFail = true;
      await openRow('sx-pol-tol_weight_bp'); await page.fill(IN, '1.25'); await page.dispatchEvent(IN, 'change'); await page.click(SAVE); await yes(); await page.waitForTimeout(400);
      S.polFail = false;
      const out = await txt('[data-testid="sx-pol-ok-tol_weight_bp"]'), draft = await page.inputValue(IN);
      return { ok: /Only the owner changes this rule/.test(out) && draft === '1.25', saw: '"' + out + '" · draft "' + draft + '"' };
    });
  }

  /* ── PLAN & USAGE ── */
  await go('plan', '[data-testid="sx-plan-name"]');
  await w.step('S15', 'Plan & usage: the server\'s plan, "Nothing is limited…" (enforced:false), each quota as its STATE — "Not decided yet" never reads as unlimited; usage billed', async () => {
    const name = await txt('[data-testid="sx-plan-name"]'), enf = await txt('[data-testid="sx-plan-enforced"]');
    if (REAL) return { ok: !!name, saw: name + ' · ' + enf };
    await page.waitForSelector('[data-testid="sx-quota-state-actors"]', { timeout: 8000 });
    const q = await txt('[data-testid="sx-quota-state-actors"]'), cap = await txt('[data-testid="sx-quota-state-chits_per_month"]'), billed = await txt('[data-testid="sx-use-billed"]');
    return { ok: name === 'Test' && /Nothing is limited/.test(enf) && /Not decided yet/.test(q) && /Up to 500/.test(cap) && /12 events billed in 30 days/.test(billed), saw: name + ' · "' + enf + '" · actors "' + q + '" · "' + cap + '" · "' + billed + '"' };
  });
  await w.step('S16', 'Home: the four doors are built, each routes into Settings (never the workshop); Counters & keys reads /api/facts/counters', async () => {
    const m = await page.evaluate(() => fetch('/app/manifest.json').then((r) => r.json()));
    const e = (id) => m.entries.filter((x) => x.id === id)[0] || {};
    const four = ['counters', 'connectors', 'governance', 'plan'].map(e);
    return { ok: four.every((x) => x.state === 'built' && /^\/settings\.html#\//.test(x.route || '')) && e('counters').facts === '/api/facts/counters', saw: four.map((x) => x.id + ' ' + x.state + ' ' + x.route).join(' · ') };
  });

  /* ── RULE 13: each section, Cream and Dark × 1366 and 390 px ── */
  const rule13 = (id, label) => require('./lib/rule13.cjs').rule13(w, id, label, 'set');
  for (const [k, ready, id] of [['counters', '[data-testid="sx-ctr-C1"]', 'R1'], ['connectors', '[data-testid="sx-con-tally"]', 'R2'], ['policy', '[data-testid="sx-pol-tol_weight_bp"]', 'R3'], ['plan', '[data-testid="sx-plan-name"]', 'R4']]) {
    await page.setViewportSize({ width: 1366, height: 900 }); await go(k, ready);
    if (k === 'counters') await openRow(REAL ? 'sx-ctr-C1' : 'sx-ctr-C2');   /* the next level and its actions are measured too */
    await rule13(id, 'Settings › ' + k);
  }
  if (S.stack) S.stack.stop();
  if (w.errs.length) w.note('T99', 'page errors seen during the walk', w.errs.slice(0, 3).join(' | '));
};
walk.opts = { viewport: { width: 1366, height: 900 } };
W.run('settings-ops', walk);
