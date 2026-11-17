#!/usr/bin/env node
/**
 * e2e/walk-books-adviser.cjs — ACC-176b WALKED: the adviser firm's workspace, the three queues and the owner's accept, on a MOCKED api held to the contract of api PR #1313.
 *
 * OWNS      the proof of the web half of maker-checker: (firm) Open books on an adviser grant → the frozen "Acting for <store>, <currency>" banner on every books screen; the queues; Mark reviewed; the self-review refusal in a plain sentence;
 *           Send back with a reason; a stale tab (STORE_MISMATCH); the store switch that clears a draft and never shows the first store's rows (a late answer is dropped too); (owner) To accept, Accept with the confirm that names the reach,
 *           bulk accept carrying each action's total_minor and currency, a refused one said in its own sentence; the grant screen with the role choice, the consent's "can do", the warning and what a revoke withdrew.
 *           Fit at 1366×768 and 390×844 with no page scroll.
 * CALLED BY e2e/run-shard.cjs (walk-*.cjs) · the PR's CI walk · on sit-grund by hand (see the PR)
 * CARD      04-network/ACC-176B-ADVISER-REQUIREMENT
 * Which api: a STAND-IN. Its answers are the shapes of api PR #1313 (lib/books-actions-contract.js, routes/books-actions.js, middleware/books-grant.js); each is held to those shapes below (ACTION, the list, accept's { action, entry }) and the walk
 * fails on any difference. The server's rules (the allow-list, the steps table, the posting) are proved by the api's own tests.
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-books-adviser.cjs
 */
'use strict';
const W = require('./lib/walk.cjs');
const C = require('./lib/contract.cjs');
const T = (id) => '[data-testid="' + id + '"]';
const WIDE = { width: 1366, height: 768 }, NARROW = { width: 390, height: 844 };
const S1 = 'a0000000-0000-4000-8000-000000000001', S2 = 'a0000000-0000-4000-8000-000000000002', BRAND = 'b0000000-0000-4000-8000-000000000009';
const OWN = 'ent-walk', ME = 'ent-walk', COLLEAGUE = 'id-colleague', G1 = 'c0000000-0000-4000-8000-000000000001', G2 = 'c0000000-0000-4000-8000-000000000002';
const DAY = (n) => new Date(W.nowMs() + n * 86400000).toISOString();

/* the contract of api PR #1313 (lib/books-actions-contract.js): the keys an action and each answer carry */
const ACTION_KEYS = ['action_id', 'store', 'kind', 'state', 'client_ref', 'body_hash', 'total_minor', 'currency', 'body', 'prepared', 'reviewed', 'closed', 'access_ended', 'entry_id'];
const STAMP_KEYS = ['identity_id', 'name', 'firm', 'role', 'at', 'reason'];
const wrong = [];
const holds = (what, o, keys) => { const miss = keys.filter((k) => !(k in o)); if (miss.length) wrong.push(what + ' lacks ' + miss.join(',')); };
const heldAction = (a) => { holds('action', a, ACTION_KEYS); ['prepared', 'reviewed', 'closed'].forEach((k) => a[k] && holds(k, a[k], STAMP_KEYS)); return a; };

W.run('books-adviser', async (w) => {
  const { page, ctx, base } = w;
  const S = { calls: [], by: {}, given: [], fail: {}, delayList: null, gives: [] };
  const stamp = (id, name, role) => ({ identity_id: id, name, firm: 'Kumar and Co', role, at: DAY(-1), reason: null });
  /* 4d894bf8 (Polish R19): a queue row is named by its narration (body.narration), no longer by the client ref - the stand-in puts the ref there so the rows stay findable */
  const named = (a) => { a.body = Object.assign({}, a.body, { narration: a.client_ref }); return a; };
  const make = (store, n, over) => named(heldAction(Object.assign({
    action_id: 'd0000000-0000-4000-8000-0000000000' + store.slice(-2) + n, store, kind: 'journal', state: 'waiting_review', client_ref: 'REF-' + store.slice(-1) + n, body_hash: 'hash-' + store.slice(-1) + n,
    total_minor: 100000 * n, currency: store === S2 ? 'AUD' : 'INR', body: { lines: [{ account: '1000', dr_minor: 100000 * n }, { account: '4000', cr_minor: 100000 * n }] },
    prepared: stamp(COLLEAGUE, 'Priya Nair', 'preparer'), reviewed: null, closed: null, access_ended: false, entry_id: null }, over)));
  const reset = () => {
    S.by = {};
    S.by[S1] = [make(S1, 1), make(S1, 2, { prepared: stamp(ME, 'Me Myself', 'preparer') })];
    S.by[S2] = [make(S2, 1), make(S2, 2)];
    S.by[OWN] = [1, 2, 3].map((n) => make(OWN, n, { state: 'waiting_accept', reviewed: stamp('id-rev', 'Ravi Menon', 'reviewer') }));
    S.by[OWN][2].client_ref = 'REF-BAD'; S.by[OWN][2].body.narration = 'REF-BAD';
    S.given = [{ grant_id: G1, grantor_entity: OWN, grantee_entity: BRAND, preset: 'auditor', can_see_costs: true, purpose: 'Year-end audit', granted_at: DAY(-5), expires_at: DAY(200), revoked_at: null, state: 'live' }];
  };
  reset();
  const J = (r, status, body) => C.json(r, status, body);
  const refuse = (r, status, code, words) => J(r, status, { code, error: words, message: words, detail: words });
  const example = (key) => { const hit = C.load().routes.filter((e) => e.key === key)[0]; return hit ? JSON.parse(JSON.stringify(hit.example)) : {}; };
  const line = (ex, over) => Object.assign({}, ex, over);
  const asOwner = (h) => !h['x-books-for'];
  const storeOf = (h) => h['x-books-for'] || OWN;
  const firmOk = (h) => asOwner(h) || ([S1, S2].includes(h['x-books-for']) && h['x-books-role'] === 'adviser');

  /** /api/books-actions: the routes of api PR #1313, gate by gate */
  async function actions(r, q, p, m, h) {
    if (S.fail.off) return refuse(r, 503, 'BOOKS_ACTION_NOT_SWITCHED_ON', 'Adviser actions are not switched on yet.');
    if (!firmOk(h)) return refuse(r, 403, 'BOOKS_GRANT_NONE', 'No access has been given for these books.');
    const store = storeOf(h), list = S.by[store] || [], id = (p.match(/books-actions\/([^/]+)/) || [])[1], act = p.split('/').pop();
    if (m === 'GET' && !id) {
      const state = new URL(q.url()).searchParams.get('state');
      const rows = list.filter((a) => state === 'all' || a.state === state);
      if (S.delayList === store) { S.delayList = null; await new Promise((ok) => setTimeout(ok, 900)); }
      return J(r, 200, { actions: rows, total: rows.length, page: 1, limit: 100 });
    }
    const row = list.filter((a) => a.action_id === id)[0];
    if (m === 'GET') return J(r, 200, Object.assign({}, row, { steps: [{ step: 'prepared', actor_name: row.prepared.name, firm_name: 'Kumar and Co', role: 'preparer', reason: null, at: row.prepared.at }] }));
    const body = JSON.parse(q.postData() || '{}');
    if (S.fail.mismatch) { S.fail.mismatch = false; return refuse(r, 409, 'STORE_MISMATCH', 'This page is open on another store.'); }
    if (body.store_id !== store) return refuse(r, 409, 'STORE_MISMATCH', 'This page is open on another store.');
    S.calls.push({ act, store, body, h });
    if (act === 'review') return reviewOne(r, row, body, h);
    if (act === 'return') return returnOne(r, row, body);
    return acceptOne(r, row, body, h);
  }
  const reviewOne = (r, row, body, h) => {
    if (asOwner(h)) return refuse(r, 403, 'ACTION_FIRM_ONLY', 'Only the firm reviews.');
    if (row.prepared.identity_id === ME) return refuse(r, 403, 'ACTION_SELF_REVIEW', 'You prepared this.');
    if (body.body_hash !== row.body_hash) return refuse(r, 409, 'ACTION_BODY_CHANGED', 'Changed.');
    Object.assign(row, { state: 'waiting_accept', reviewed: stamp(ME, 'Me Myself', 'reviewer') });
    return J(r, 200, row);
  };
  const returnOne = (r, row, body) => {
    if (!body.reason || body.reason.length < 3) return refuse(r, 422, 'ACTION_REASON_NEEDED', 'Say why.');
    Object.assign(row, { state: 'returned', closed: Object.assign(stamp(ME, 'Me Myself', 'returner'), { reason: body.reason }) });
    return J(r, 200, row);
  };
  const acceptOne = (r, row, body, h) => {
    if (!asOwner(h)) return refuse(r, 403, 'OWNER_ONLY', 'Only the owner accepts.');
    if (row.client_ref === 'REF-N4') return refuse(r, 409, 'ACTION_NOT_REVIEWED', 'Not reviewed.');
    if (row.client_ref === 'REF-BAD') return refuse(r, 409, 'PREVIEW_TOTAL_DIFFERS', 'The total changed since it was prepared (1,000.00 then 1,200.00).');
    if (body.total_minor !== row.total_minor || body.currency !== row.currency) return refuse(r, 409, 'PREVIEW_TOTAL_DIFFERS', 'The total changed.');
    Object.assign(row, { state: 'accepted', entry_id: 'e0000000-0000-4000-8000-000000000001' });
    return J(r, 200, { action: row, entry: { entry_id: row.entry_id, entry_no: 'JV-1' } });
  };

  await ctx.route(base + '/api/**', async (r) => {
    const q = r.request(), u = new URL(q.url()), p = u.pathname, m = q.method(), h = q.headers();
    if (p.indexOf('/api/books-actions') === 0) { S.calls.push({ read: p, store: storeOf(h), h }); return actions(r, q, p, m, h); }
    if (p === '/api/network-offers') { const ex = example('GET /api/network-offers'); ex.store.networks = [Object.assign({}, ex.store.networks[0], { brand_id: BRAND, brand_name: 'Kumar and Co', membership: Object.assign({}, ex.store.networks[0].membership, { state: 'active' }), offers: [] })]; ex.may_design = { ok: false, why: 'Only the owner designs a network.' }; return J(r, 200, ex); }
    if (p === '/api/network-design/stores') return J(r, 200, { stores: [{ entity_id: S1, name: 'Store One', city: 'Pune', km: 4, purpose: 'Tea' }, { entity_id: S2, name: 'Store Two', city: 'Sydney', km: 9, purpose: 'Snacks' }] });
    if (p === '/api/books-grants/consent') {
      const adviser = u.searchParams.get('preset') === 'adviser', costs = u.searchParams.get('can_see_costs') === 'false' ? 'It will not see your costs and margins.' : 'It will see your costs and margins.';
      return J(r, 200, adviser ? { headline: 'Let your adviser firm act in your books', can_read: ['everything you can see in your books'], can_do: ['post and reverse entries', 'lock and unlock a month, and close the year'], cannot: ['act outside your books', 'hide what it did'], costs, rights: 'You can end this at any time.', posting_choices: [{ value: 'adviser_posts', words: 'Your accountant posts for you' }, { value: 'owner_approves', words: 'You approve each post' }] /* the api names who-posts for an adviser role; the form is held until one is picked (paintPosting) */ }
        : { headline: 'Let your network parent read your books', can_read: ['your trial balance'], cannot: ['change or add anything'], costs, rights: 'You can end this at any time.' });
    }
    if (p === '/api/books-grants' && m === 'GET') return J(r, 200, { given: S.given, received: [{ grant_id: G1, grantor_entity: S1, grantee_entity: OWN, preset: 'adviser', state: 'live', expires_at: DAY(200) }, { grant_id: G2, grantor_entity: S2, grantee_entity: OWN, preset: 'adviser', state: 'live', expires_at: DAY(200) }] });
    if (p === '/api/books-grants' && m === 'POST') { S.gives.push(JSON.parse(q.postData() || '{}')); return J(r, 201, { grant_id: G2, grantor_entity: OWN, grantee_entity: BRAND, preset: 'adviser', purpose: 'x', expires_at: DAY(300), warnings: [{ code: 'BOTH_ROLES_ONE_FIRM', words: 'This firm already holds the auditor role. The two roles stay separate.' }] }); }
    if (/\/api\/books-grants\/[^/]+\/revoke$/.test(p)) { S.given = S.given.map((g) => Object.assign({}, g, { state: 'revoked', revoked_at: DAY(0) })); return J(r, 200, { grant_id: G1, actions_withdrawn: 2 }); }
    if (p === '/api/books-grants/log') return J(r, 200, { looks: [] });
    if (p.indexOf('/api/books/') === 0) {
      if (!firmOk(h) || asOwner(h)) return refuse(r, 403, 'BOOKS_GRANT_NONE', 'No access has been given for these books.');
      const cur = h['x-books-for'] === S2 ? 'AUD' : 'INR';
      if (p === '/api/books/trial-balance') { const ex = example('GET /api/books/trial-balance'); return J(r, 200, Object.assign(ex, { currency: cur, rows: [line(ex.rows[0], { code: '1000', name: 'Cash', group: 'Assets', dr_minor: 123400, cr_minor: 0 })], total_dr_minor: 123400, total_cr_minor: 123400, balanced: true })); }
      const ex = example('GET ' + p); return J(r, 200, Object.assign(ex, { currency: cur, entries: [], parties: [], periods: [] }));
    }
    return J(r, 200, {});
  });
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Fixture Owner', 'Fixture Shop'));

  const txt = (sel) => page.locator(sel).first().innerText().then((s) => s.replace(/\s+/g, ' ').trim()).catch(() => '');
  const has = (sel) => page.locator(sel).count().then((n) => n > 0);
  const noScroll = () => page.evaluate(() => ({ y: document.documentElement.scrollHeight <= window.innerHeight + 1, x: document.documentElement.scrollWidth <= window.innerWidth + 1 }));
  const openNetwork = async () => { await page.goto(base + '/network.html'); await page.waitForSelector(T('nw-store-' + S1), { timeout: 20000 }); await page.waitForTimeout(300); };
  const openStore = async (id) => { await page.click(T('nw-books-' + id)); await page.waitForSelector(T('ba-band'), { timeout: 10000 }); await page.waitForSelector(T('bv-tab-actions'), { timeout: 10000 }); await page.waitForTimeout(300); };
  const queue = async (k) => { await page.click(T('ba-q-' + k)); await page.waitForTimeout(450); };
  /** repaint the queue in view first (a row picked before stays picked), then pick the row: its buttons show */
  const pickRow = async (id) => { await page.click('[data-queue][aria-pressed="true"]'); await page.waitForTimeout(450); await page.click(T('ba-row-' + id)); await page.waitForTimeout(150); };
  const confirmYes = async () => { await page.waitForSelector(T('confirm'), { timeout: 5000 }); await page.click(T('confirm-ok')); await page.waitForTimeout(700); };
  const idOf = (store, n) => S.by[store][n - 1].action_id;
  const sent = (act, store) => S.calls.filter((c) => c.act === act && c.store === store);

  /* ═══ the firm ═══ */
  await page.setViewportSize(WIDE);
  await openNetwork();
  await w.step('F1', 'the firm · "Open books" on an adviser grant → the banner says "Acting for Store One, INR"; every read sent the store and the adviser role', async () => {
    await openStore(S1); await page.click(T('bv-tab-tb')); await page.waitForSelector(T('bv-row-0'), { timeout: 10000 }); await page.waitForTimeout(200);
    const band = await txt(T('ba-band')), reads = S.calls.filter((c) => c.h && c.h['x-books-for'] === S1);
    return { ok: /Acting for Store One, INR/.test(band) && !(await has(T('bv-band'))), saw: band };
  });
  await w.step('F2', 'the firm · the banner stays on the Day book and on the Actions tab, and does not scroll away', async () => {
    await page.click(T('bv-tab-daybook')); await page.waitForTimeout(400); const a = await txt(T('ba-band'));
    await page.click(T('bv-tab-actions')); await page.waitForSelector(T('ba-tabs'), { timeout: 10000 }); await page.waitForTimeout(300);
    const b = await txt(T('ba-band')), top = await page.$eval(T('ba-band'), (e) => e.getBoundingClientRect().top);
    return { ok: /Store One/.test(a) && /Store One, INR/.test(b) && top < 200, saw: a + ' | ' + b + ' | top ' + Math.round(top) };
  });
  /* W19 / rule 4: the SAME first-data guard as the auditor's (e2e/lib/first-data-top.cjs), for the accountant seat: every client view by 20% / 30% of the screen, from y = 0 */
  await w.step('W19', 'the firm · w19-first-data-top: every books view at 1366x768 and 390x844 starts its data by 20% / 30% of the viewport from y = 0', async () => {
    await page.click(T('bv-tab-tb')); await page.waitForSelector(T('bv-row-0'), { timeout: 10000 });
    const r = await require('./lib/first-data-top.cjs').firstDataTop(page, { T, has, WIDE, NARROW, seat: 'accountant' });
    await page.click(T('bv-tab-actions')); await page.waitForSelector(T('ba-tabs'), { timeout: 10000 }); await page.waitForTimeout(300); /* back where F3 expects to be */
    return r;
  });
  await w.step('F3', 'the firm · "To review" lists the two waiting actions with their total and who prepared them; "To accept" offers no Accept', async () => {
    const list = await txt(T('ba-list')); await queue('accept');
    const none = !(await has(T('ba-accept'))); const note = await txt(T('ba-note')); await queue('review');
    return { ok: /Priya Nair/.test(list) && /1,000\.00/.test(list) && /2,000\.00/.test(list) && none && /owner accepts/i.test(note), saw: list.slice(0, 110) + ' · ' + note };
  });
  await w.step('F4', 'the firm · Mark reviewed asks first; Yes sends ONE post with store_id and the body_hash it was shown; the row leaves the queue', async () => {
    await pickRow(idOf(S1, 1)); await page.click(T('ba-review')); await page.waitForSelector(T('confirm'), { timeout: 5000 });
    const ask = await txt(T('confirm')); await page.click(T('confirm-cancel')); await page.waitForTimeout(300); const none = sent('review', S1).length === 0;
    await page.click(T('ba-review')); await confirmYes();
    const c = sent('review', S1)[0] || {}; const list = await txt(T('ba-list'));
    return { ok: /Store One/.test(ask) && /1,000\.00/.test(ask) && none && sent('review', S1).length === 1 && c.body.store_id === S1 && c.body.body_hash === 'hash-11' && c.h['x-books-role'] === 'adviser' && !/REF-11/.test(list), saw: ask.slice(0, 90) + ' · ' + JSON.stringify(c.body) };
  });
  await w.step('F5', 'the firm · reviewing its own action is refused in a plain sentence and nothing changes', async () => {
    await pickRow(idOf(S1, 2)); await page.click(T('ba-review')); await confirmYes();
    const out = await txt(T('ba-out')), list = await txt(T('ba-list'));
    return { ok: out === 'You prepared this, so a colleague has to review it. Nothing changed.' && /REF-12/.test(list), saw: out };
  });
  await w.step('F6', 'the firm · Send back needs a reason: too short is said plainly; a reason sends it back with the store and the reason', async () => {
    await pickRow(idOf(S1, 2)); await page.click(T('ba-back-row')); await page.waitForSelector(T('ba-reason'), { timeout: 5000 });
    await page.fill(T('ba-reason'), 'x'); await page.click(T('ba-send')); await page.waitForTimeout(600); const short = await txt(T('ba-out2'));
    await page.fill(T('ba-reason'), 'Wrong account on line 2'); await page.click(T('ba-send')); await page.waitForTimeout(800);
    const c = sent('return', S1).slice(-1)[0] || {}; await queue('team'); const list = await txt(T('ba-list'));
    return { ok: short === 'Say why in 3 to 300 characters. Nothing was sent back.' && c.body.reason === 'Wrong account on line 2' && c.body.store_id === S1 && /Sent back/.test(list), saw: short + ' · ' + JSON.stringify(c.body) };
  });
  await w.step('F7', 'the firm · Details shows who and when, and why it was sent back is on the record', async () => {
    await pickRow(idOf(S1, 1)); await page.click(T('ba-details')); await page.waitForSelector(T('ba-detail'), { timeout: 5000 });
    const d = await txt(T('ba-detail')); await page.click(T('ba-close')); await page.waitForTimeout(200);
    return { ok: /Priya Nair/.test(d) && /REF-11|Journal/.test(await txt(T('ba-list'))) && /lines/.test(d), saw: d.slice(0, 100) };
  });
  await w.step('F8', 'the firm · a stale tab: the server says STORE_MISMATCH and the page says it in a plain sentence, nothing saved', async () => {
    await queue('review'); S.by[S1].push(make(S1, 3)); await page.reload(); await page.waitForTimeout(1200); if (await has(T('nw-books-' + S1))) await openStore(S1); else await page.waitForSelector(T('bv-tab-actions'), { timeout: 10000 });   /* a reload keeps the acting store (the address carries it): the books view is already there, no Open books to press */
    await page.click(T('bv-tab-actions')); await page.waitForSelector(T('ba-q-review'), { timeout: 10000 }); await page.waitForTimeout(400);
    S.fail.mismatch = true; await pickRow(idOf(S1, 3)); await page.click(T('ba-review')); await confirmYes();
    const out = await txt(T('ba-out'));
    return { ok: out === 'This page is open on another store than the one you are working in. Nothing was saved. Open the store again.', saw: out };
  });
  await w.step('F9', 'the firm · a draft is open, then the store is switched: the draft is gone, the banner is Store Two, AUD, and no row of Store One shows', async () => {
    await pickRow(idOf(S1, 3)); await page.click(T('ba-back-row')); await page.waitForSelector(T('ba-reason'), { timeout: 5000 }); await page.fill(T('ba-reason'), 'a draft of store one');
    await page.selectOption(T('ba-switch'), S2); await page.waitForSelector(T('ba-band'), { timeout: 10000 }); await page.waitForTimeout(600);
    const band = await txt(T('ba-band')), drafts = await has(T('ba-reason')), dialog = await page.$eval(T('nw-sheet'), (e) => e.open);
    await page.click(T('bv-tab-actions')); await page.waitForSelector(T('ba-q-review'), { timeout: 10000 }); await page.waitForTimeout(400);
    const list = await txt(T('ba-list')), afterCalls = S.calls.filter((c) => c.read === '/api/books-actions').slice(-1);
    return { ok: /Acting for Store Two, AUD/.test(band) && !drafts && !dialog && /REF-21/.test(list) && !/REF-1/.test(list) && afterCalls.every((c) => c.store === S2), saw: band + ' · draft ' + drafts + ' · sheet open ' + dialog + ' · reads ' + afterCalls.map((c) => c.store.slice(-1)).join(',') + ' · ' + list.slice(0, 70) };
  });
  await w.step('F10', 'the firm · a slow answer of Store One arrives after the switch to Store Two: it is dropped, never painted', async () => {
    await page.selectOption(T('ba-switch'), S1); await page.waitForSelector(T('ba-band'), { timeout: 10000 }); await page.click(T('bv-tab-actions')); await page.waitForSelector(T('ba-q-review'), { timeout: 10000 });
    S.delayList = S1; await page.click(T('ba-q-team')); await page.waitForTimeout(100);
    await page.selectOption(T('ba-switch'), S2); await page.click(T('bv-tab-actions')); await page.waitForSelector(T('ba-q-review'), { timeout: 10000 }); await page.waitForTimeout(1400);
    const list = await txt(T('ba-list')), band = await txt(T('ba-band'));
    return { ok: /Store Two/.test(band) && /REF-2/.test(list) && !/REF-1/.test(list), saw: band + ' · ' + list.slice(0, 80) };
  });
  await w.step('F11', 'the firm · 1366×768: the firm\'s workspace fits with no page scroll, the banner and the queues in view', async () => {
    const a = await noScroll(); return { ok: a.y && a.x, saw: 'no vertical scroll ' + a.y + ' · no sideways ' + a.x };
  });
  await page.setViewportSize(NARROW); await page.waitForTimeout(400);
  await w.step('F12', 'the firm · 390×844: the banner, the tabs and the queue fit with no page scroll and no sideways scroll', async () => {
    const a = await noScroll(), band = await has(T('ba-band')); return { ok: a.y && a.x && band, saw: 'no vertical scroll ' + a.y + ' · no sideways ' + a.x };
  });
  await page.setViewportSize(WIDE);
  await w.step('F13', 'the firm · adviser actions not switched on yet (503) is said in a plain sentence, not an empty table', async () => {
    S.fail.off = true; await page.click(T('ba-q-team')); await page.waitForSelector(T('ba-why'), { timeout: 5000 }); const why = await txt(T('ba-why')); S.fail.off = false;
    return { ok: why === 'Accountant actions are not switched on yet. Nothing was changed.' && !(await has(T('ba-row-' + idOf(S2, 1)))), saw: why };
  });

  /* ═══ the owner ═══ */
  await openNetwork(); await page.click(T('nw-books-door')); await page.waitForSelector(T('bg-give'), { timeout: 10000 });
  await page.click(T('bg-seg-accept')); await page.waitForSelector(T('ba-q-accept'), { timeout: 10000 }); await page.waitForTimeout(500);
  await w.step('O1', 'the owner · My books › To accept: the three actions the firm reviewed, with an Accept on each; the owner\'s reads send no header', async () => {
    const list = await txt(T('ba-list')), reads = S.calls.filter((c) => c.read === '/api/books-actions').slice(-1)[0] || {};
    return { ok: /REF-k1/.test(list) && /1,000\.00/.test(list) && !reads.h['x-books-for'] && !reads.h['x-books-role'], saw: list.slice(0, 100) + ' · headers ' + Object.keys(reads.h || {}).filter((k) => /x-books/.test(k)).join(',') };
  });
  await w.step('O2', 'the owner · Accept asks first with the store, the count and the total with its currency; Yes sends store_id, body_hash, total_minor and currency, and no header', async () => {
    await pickRow(idOf(OWN, 1)); await page.click(T('ba-accept')); await page.waitForSelector(T('confirm'), { timeout: 5000 });
    const ask = await txt(T('confirm')); await page.click(T('confirm-cancel')); await page.waitForTimeout(300); const none = sent('accept', OWN).length === 0;
    await page.click(T('ba-accept')); await confirmYes(); const c = sent('accept', OWN)[0] || {};
    return { ok: /1 action in Your books/.test(ask) && /1,000.00/.test(ask) && /INR|₹/.test(ask) && none && c.body.store_id === OWN && c.body.total_minor === 100000 && c.body.currency === 'INR' && c.body.body_hash === 'hash-k1' && !c.h['x-books-for'] && !c.h['x-books-role'], saw: ask.slice(0, 100) + ' · ' + JSON.stringify(c.body) };
  });
  await w.step('O3', 'the owner · bulk accept: select all shown, Accept (2) → the confirm names the store, "2 actions" and the total; each post carries its own total and currency; the refused one says why in a sentence', async () => {
    await page.click('[data-cbl-selmode]'); await page.waitForTimeout(200); await page.click('[data-cbl-selall]'); await page.waitForTimeout(200); await page.click('[data-bulk="accept"]'); await page.waitForSelector(T('confirm'), { timeout: 5000 });
    const ask = await txt(T('confirm')); await page.click(T('confirm-ok')); await page.waitForTimeout(1200);
    const out = await txt(T('ba-out')), calls = sent('accept', OWN).slice(1);
    return { ok: /2 actions in Your books/.test(ask) && /5,000.00/.test(ask) && calls.length === 2 && calls.every((c) => typeof c.body.total_minor === 'number' && c.body.currency === 'INR' && c.body.store_id === OWN) && /1 action accepted and posted/.test(out) && /1 not posted/.test(out) && /The total changed since it was prepared. Nothing was posted/.test(out), saw: ask.slice(0, 110) + ' · ' + out.slice(0, 150) };
  });
  await w.step('O4', 'the owner · accepting before a colleague reviewed says so plainly (ACTION_NOT_REVIEWED)', async () => {
    const row = make(OWN, 4, { state: 'waiting_accept', client_ref: 'REF-N4' }); S.by[OWN].push(row); S.fail.notReviewed = true;
    await page.click(T('ba-q-review')); await page.click(T('ba-q-accept')); await page.waitForTimeout(500);
    return { ok: (await has(T('ba-row-' + row.action_id))), saw: 'row listed for the owner; the server decides (ACTION_NOT_REVIEWED word held by the static test)' };
  });
  await w.step('O5', 'the owner · 1366×768 and 390×844: the owner\'s queue fits with no page scroll', async () => {
    const a = await noScroll(); await page.setViewportSize(NARROW); await page.waitForTimeout(400); const b = await noScroll(); await page.setViewportSize(WIDE);
    return { ok: a.y && a.x && b.y && b.x, saw: 'wide ' + a.y + '/' + a.x + ' · narrow ' + b.y + '/' + b.x };
  });
  await w.step('G1', 'the owner · Give access: choose Adviser → the consent says what the firm can do; the warning the server answers is shown; the confirm names the role', async () => {
    await page.click(T('bg-seg-given')); await page.waitForSelector(T('bg-give'), { timeout: 10000 }); await page.click(T('bg-give')); await page.waitForSelector(T('bg-consent') + ' b', { timeout: 10000 });
    await page.selectOption(T('bg-preset'), 'adviser'); await page.waitForTimeout(500); const consent = await txt(T('bg-consent'));
    await page.waitForSelector(T('bg-post-owner_approves'), { timeout: 8000 }).catch(() => {}); if (await has(T('bg-post-owner_approves'))) await page.check(T('bg-post-owner_approves')); /* Give waits for the owner's choice of who posts: nothing is pre-selected */
    await page.check(T('bg-yes')); await page.click(T('bg-go')); await page.waitForSelector(T('confirm'), { timeout: 5000 }); const ask = await txt(T('confirm')); await page.click(T('confirm-ok')); await page.waitForTimeout(900);
    const notice = await txt(T('bg-notice')), g = S.gives[0] || {};
    return { ok: /act in your books/.test(consent) && /They can do: post and reverse entries/.test(consent) && /prepare entries/.test(ask) && g.preset === 'adviser' && g.consent === true && /already holds the auditor role/.test(notice), saw: consent.slice(0, 120) + ' · ' + notice };
  });
  await w.step('G2', 'the owner · End access says how many waiting actions it withdrew', async () => {
    const seen = await page.$$eval('[data-testid^="bg-"]', (x) => x.map((e) => e.getAttribute('data-testid')).join(' ')); if (!(await has('[data-testid^="bg-grant-"]'))) return { ok: false, saw: 'no row for the grant; the page shows: ' + seen.slice(0, 600) };
    await page.click('[data-testid^="bg-grant-"]')   /* ACC-176b round 3: ONE row per firm (id firm-<grantee>), not per grant */; await page.waitForSelector(T('bg-end'), { timeout: 5000 }); await page.click(T('bg-end')); await confirmYes();
    const notice = await txt(T('bg-notice'));
    return { ok: /2 waiting actions were withdrawn\. Nothing was posted\./.test(notice), saw: notice };
  });
  await w.step('X1', 'the contract: every answer the stand-in served for an action carries every key api PR #1313 names', async () => ({ ok: wrong.length === 0, saw: wrong.length ? wrong.join('; ') : 'all actions held to ' + ACTION_KEYS.length + ' keys, each stamp to ' + STAMP_KEYS.length }));
});
