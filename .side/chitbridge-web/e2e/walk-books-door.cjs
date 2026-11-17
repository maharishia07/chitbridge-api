#!/usr/bin/env node
/**
 * e2e/walk-books-door.cjs — the doors to "Who can see my books" for an owner who sits in NO network (only a books grant / governance edge), on a MOCKED api.
 *
 * OWNS      the proof that the page's own sidebar names "Who can see my books" (network.html), that the in-page door is drawn with an empty network list,
 *           that Accounts › Setup carries the second door, and that end / who looked work from there. Fit 1366×768 and 390×844, keyboard path.
 * CALLED BY e2e/run-shard.cjs (walk-*.cjs) · CARD 04-network/ACC-176-AUDITOR-GRANT
 * Which api: a STAND-IN (shapes of routes/books-grants.js). The server's rules are the api's own tests.
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-books-door.cjs
 */
'use strict';
const W = require('./lib/walk.cjs');
const C = require('./lib/contract.cjs');
const T = (id) => '[data-testid="' + id + '"]';
const WIDE = { width: 1366, height: 768 }, NARROW = { width: 390, height: 844 };
const MEMBER = 'a0000000-0000-4000-8000-000000000001', FIRM = 'b0000000-0000-4000-8000-000000000009', GRANT = 'c0000000-0000-4000-8000-000000000001';
const DAY = (n) => new Date(W.nowMs() + n * 86400000).toISOString();

W.run('books-door', async (w) => {
  const { page, ctx, base } = w;
  const S = { revokes: [], logCalls: 0, given: [{ grant_id: GRANT, grantor_entity: MEMBER, grantee_entity: FIRM, preset: 'auditor', can_see_costs: false, purpose: 'Year-end audit', granted_at: DAY(-5), expires_at: DAY(200), revoked_at: null, state: 'live' }] };
  const J = (r, status, body) => C.json(r, status, body);
  const example = (key) => { const hit = C.load().routes.filter((e) => e.key === key)[0]; return hit ? JSON.parse(JSON.stringify(hit.example)) : {}; };

  await ctx.route(base + '/api/**', async (r) => {
    const q = r.request(), u = new URL(q.url()), p = u.pathname, m = q.method();
    if (p === '/api/network-offers') { const ex = example('GET /api/network-offers'); ex.store = Object.assign({}, ex.store, { networks: [] }); ex.may_design = { ok: false, why: 'Only the owner designs a network.' }; return J(r, 200, ex); }
    if (p === '/api/network-design/stores') return J(r, 200, { stores: [] });
    if (p === '/api/books-grants/consent') return J(r, 200, { headline: 'Let your adviser read your books', can_read: ['your trial balance'], cannot: ['change or add anything'], costs: 'It will not see your costs and margins.', rights: 'You can end this at any time.' });
    if (p === '/api/books-grants/log') { S.logCalls++; return J(r, 200, { looks: [{ at: DAY(-1), grant_id: GRANT, grantee_entity: FIRM, actor_identity_id: 'x', route_pattern: 'GET /trial-balance', query_shape: null, status: 200, outcome: 'allowed' }] }); }
    if (p === '/api/books-grants' && m === 'GET') return J(r, 200, { given: S.given, received: [] });
    if (/\/api\/books-grants\/[^/]+\/revoke$/.test(p)) { S.revokes.push(p); S.given = S.given.map((g) => Object.assign({}, g, { state: 'revoked', revoked_at: DAY(0) })); return J(r, 200, { grant_id: GRANT }); }
    return J(r, 200, {});
  });
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Fixture Owner', 'Fixture Shop'));

  const txt = (sel) => page.locator(sel).first().innerText().then((s) => s.replace(/\s+/g, ' ').trim()).catch(() => '');
  const has = (sel) => page.locator(sel).count().then((n) => n > 0);
  const noScroll = () => page.evaluate(() => ({ y: document.documentElement.scrollHeight <= window.innerHeight + 1, x: document.documentElement.scrollWidth <= window.innerWidth + 1 }));

  await page.setViewportSize(WIDE);
  await page.goto(base + '/network.html'); await page.waitForSelector(T('nw-body'), { timeout: 20000 }); await page.waitForTimeout(400);
  await w.step('D1', 'no network · the sidebar names "Who can see my books"', async () => {
    const side = await has(T('skel-nav-books')), label = await txt(T('skel-nav-books'));
    return { ok: side && /Who can see my books/.test(label), saw: label };
  });
  await w.step('D2', 'no network · the in-page door is drawn under "Not in a network yet"', async () => {
    const none = await has(T('nw-none')), door = await has(T('nw-books-door'));
    return { ok: none && door, saw: 'empty state ' + none + ' · door ' + door };
  });
  await w.step('D3', 'keyboard: focus the door, Enter → the grant list (Access I gave)', async () => {
    await page.focus(T('nw-books-door')); await page.keyboard.press('Enter');
    await page.waitForSelector(T('bg-list'), { timeout: 10000 });
    const list = await txt(T('bg-list'));
    return { ok: /Year-end audit|Open/.test(list), saw: list.slice(0, 120) };
  });
  await w.step('D4', 'Who looked lists the event', async () => {
    await page.click(T('bg-seg-looks')); await page.waitForSelector(T('bg-look-allowed'), { timeout: 10000 });
    const list = await txt(T('bg-list'));
    /* ACC-176b round 3: a logged route is said in plain words (books-grant-words.js: 'opened the trial balance'), under the What they did column */
    return { ok: /opened the trial balance/i.test(list) && /what they did/i.test(list) && S.logCalls > 0, saw: list.slice(0, 160) };
  });
  await w.step('D5', 'End access asks first, then ends: the row says Ended', async () => {
    await page.click(T('bg-seg-given')); await page.waitForSelector(T('bg-grant-firm-' + FIRM), { timeout: 10000 });
    await page.click(T('bg-grant-firm-' + FIRM)); await page.waitForSelector(T('bg-end'), { timeout: 5000 });
    await page.click(T('bg-end')); await page.waitForSelector(T('confirm'), { timeout: 5000 });
    await page.click(T('confirm-ok')); await page.waitForTimeout(700);
    const list = await txt(T('bg-list'));
    return { ok: S.revokes.length === 1 && /Ended/.test(list), saw: 'revokes ' + S.revokes.length + ' · ' + list.slice(0, 60) };
  });
  await w.step('D6', 'Give access with no network parent says so in words (no dead tap)', async () => {
    await page.click(T('bg-give')); await page.waitForSelector(T('bg-noparent'), { timeout: 5000 });
    return { ok: true, saw: await txt(T('bg-noparent')) };
  });
  await w.step('D7', 'the page opens on the section from the Accounts door (#books)', async () => {
    await page.goto(base + '/network.html#books'); await page.reload(); await page.waitForSelector(T('bg-list'), { timeout: 15000 });
    return { ok: (await page.getAttribute(T('skel-nav-books'), 'aria-current')) === 'page', saw: 'books section is the current one' };
  });
  await page.goto(base + '/accounts.html'); await page.waitForSelector(T('acc-nav-access'), { timeout: 20000 });
  await w.step('D8', 'Accounts › Setup carries "Who can see my books" and it opens the network page on that section', async () => {
    const label = await txt(T('acc-nav-access'));
    await page.click(T('acc-nav-access')); await page.waitForSelector(T('nw-body'), { timeout: 15000 });
    return { ok: /Who can see my books/.test(label) && /network\.html#books/.test(page.url()), saw: label + ' → ' + page.url() };
  });
  await w.step('D9', 'fits 1366×768 and 390×844 with no page scroll', async () => {
    const a = await noScroll(); await page.setViewportSize(NARROW); await page.waitForTimeout(300); const b = await noScroll();
    return { ok: a.y && a.x && b.y && b.x, saw: 'wide ' + a.y + '/' + a.x + ' · narrow ' + b.y + '/' + b.x };
  });
});
