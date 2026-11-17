#!/usr/bin/env node
/**
 * e2e/walk-books-prepare.cjs — ACC-176b WALKED: the adviser PREPARES a journal on the owner's books page (accounts.html acting for a store), on a MOCKED api held to the contract of api PR #1313.
 *
 * OWNS      the proof of the prepare half: "Prepare a journal" in the firm's workspace opens accounts.html?acting=<store>; the frozen "Acting for <store>, <currency>" banner; every request names the store and the adviser role;
 *           the ＋ Entry sheet (cap-entry.js, not a new form) writes a journal and its Save sends POST /api/books-actions { store_id, kind: 'journal', body (with its date), client_ref, working_month } and never POST /api/books/events;
 *           the sheet says "Prepared, waiting for review"; the row is in "Prepared by my team". A journal with no date is not sent. Fit at 1366×768 and 390×844.
 * CALLED BY e2e/run-shard.cjs (walk-*.cjs) · the PR's CI walk · on sit-grund by hand
 * CARD      04-network/ACC-176B-ADVISER-REQUIREMENT
 * Which api: a STAND-IN with the shapes of api PR #1313 (lib/books-actions-contract.js POST /); it refuses any books request that lacks X-Books-For and X-Books-Role: adviser, and an action without store_id, date or client_ref.
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-books-prepare.cjs
 */
'use strict';
const W = require('./lib/walk.cjs');
const C = require('./lib/contract.cjs');
const books = require('./lib/books-api.cjs');
const T = (id) => '[data-testid="' + id + '"]';
const WIDE = { width: 1366, height: 768 }, NARROW = { width: 390, height: 844 };
const S1 = 'a0000000-0000-4000-8000-000000000001', S2 = 'a0000000-0000-4000-8000-000000000002', BRAND = 'b0000000-0000-4000-8000-000000000009', OWN = 'ent-walk', G1 = 'c0000000-0000-4000-8000-000000000001';
const DAY = (n) => new Date(W.nowMs() + n * 86400000).toISOString();
const TODAY = new Date(W.nowMs()).toISOString().slice(0, 10); /* the stand-in's preview date when none is sent */

/* the journal event and the accounts, as GET /api/books/events and /accounts send them (e2e/manual-entry.cjs holds the full set) */
const EVENTS = [{ kind: 'journal', words: 'Write a journal', icon: 'pen', band: 'adjust', voucher: 'Journal', fields: [{ key: 'lines', kind: 'lines', required: true }, { key: 'narration', kind: 'text', required: true }, { key: 'date', kind: 'date', required: false, default: 'today' }], preview: true, post: 'POST /events' }];
const ACCOUNTS = [['1500', 'Bank', 'bank'], ['6090', 'Bank charges', null]].map(([code, name, role]) => ({ account_id: 'acc-' + code, code, name, role, is_group: false, tally_group: 'Group', nature: 'asset', parent_code: 'G1000', active: true }));
const NAME = { 1500: 'Bank', 6090: 'Bank charges' };
const ACTION_KEYS = ['action_id', 'store', 'kind', 'state', 'client_ref', 'body_hash', 'total_minor', 'currency', 'body', 'prepared', 'reviewed', 'closed', 'access_ended', 'entry_id'];
const wrong = [];

W.run('books-prepare', async (w) => {
  const { page, ctx, base } = w;
  const S = { calls: [], prepared: [], posted: [] };
  const J = (r, status, body) => C.json(r, status, body);
  const refuse = (r, status, code, words) => J(r, status, { code, error: words, message: words, detail: words });
  const example = (key) => { const hit = C.load().routes.filter((e) => e.key === key)[0]; return hit ? JSON.parse(JSON.stringify(hit.example)) : {}; };
  const body = (q) => { try { return JSON.parse(q.postData() || '{}'); } catch (_) { return {}; } };
  const L = (code, dr, cr) => ({ code, ledger: NAME[code], dr_minor: dr, cr_minor: cr, type: 'nominal', rule: dr ? 'Dr expenses and losses' : 'Cr incomes and gains' });
  const preview = (b) => {
    const lines = (b.lines || []).map((l) => L(l.code, l.dr_minor || 0, l.cr_minor || 0)), dr = lines.reduce((s, l) => s + l.dr_minor, 0), cr = lines.reduce((s, l) => s + l.cr_minor, 0);
    return { ok: dr === cr && dr > 0, kind: 'journal', voucher: { series: 'MJ', type: 'Journal' }, date: b.date || TODAY, lines, balanced: dr === cr, totals: { dr_minor: dr, cr_minor: cr }, credit: null, bill: null, flags: [], refusals: [], code: null, duplicate: null };
  };
  const stamp = () => ({ identity_id: OWN, name: 'Me Myself', firm: 'Kumar and Co', role: 'preparer', at: DAY(0), reason: null });
  /** POST /api/books-actions as api PR #1313 takes it: store_id, kind, body, client_ref, working_month; the journal's date and the reference are required */
  function prepare(b) {
    if (b.store_id !== S1) return ['STORE_MISMATCH', 409, 'This page is open on another store.'];
    if (b.kind !== 'journal' || !b.body || !Array.isArray(b.body.lines) || b.body.lines.length < 2) return ['ACTION_BODY_INVALID', 422, 'A journal needs at least two lines.'];
    if (!b.body.date) return ['ACTION_DATE_REQUIRED', 422, 'Give the journal its date.'];
    if (!b.client_ref) return ['ACTION_REF_REQUIRED', 422, 'Give the action a reference.'];
    return null;
  }
  const actionOf = (b) => {
    const total = b.body.lines.reduce((s, l) => s + (l.dr_minor || 0), 0);
    const a = { action_id: 'd0000000-0000-4000-8000-000000000001', store: S1, kind: 'journal', state: 'waiting_review', client_ref: b.client_ref, body_hash: 'hash-p1', total_minor: total, currency: 'INR', body: b.body, prepared: stamp(), reviewed: null, closed: null, access_ended: false, entry_id: null };
    ACTION_KEYS.forEach((k) => { if (!(k in a)) wrong.push('action lacks ' + k); });
    return a;
  };

  await ctx.route(base + '/api/**', async (r) => {
    const q = r.request(), u = new URL(q.url()), p = u.pathname, m = q.method(), h = q.headers();
    S.calls.push({ m, p, h, body: m === 'POST' ? body(q) : null });
    if (p === '/api/network-offers') { const ex = example('GET /api/network-offers'); ex.store.networks = [Object.assign({}, ex.store.networks[0], { brand_id: BRAND, brand_name: 'Kumar and Co', membership: Object.assign({}, ex.store.networks[0].membership, { state: 'active' }), offers: [] })]; ex.may_design = { ok: false, why: 'Only the owner designs a network.' }; return J(r, 200, ex); }
    if (p === '/api/network-design/stores') return J(r, 200, { stores: [{ entity_id: S1, name: 'Store One', city: 'Pune', km: 4, purpose: 'Tea' }, { entity_id: S2, name: 'Store Two', city: 'Sydney', km: 9, purpose: 'Snacks' }] });
    if (p === '/api/books-grants' && m === 'GET') return J(r, 200, { given: [], received: [{ grant_id: G1, grantor_entity: S1, grantor_name: 'Store One', grantee_entity: OWN, preset: 'adviser', state: 'live', expires_at: DAY(200) }] });
    if (p.indexOf('/api/books') === 0) {
      if (h['x-books-for'] !== S1 || h['x-books-role'] !== 'adviser') return refuse(r, 403, 'BOOKS_GRANT_NONE', 'No access has been given for these books.');
      if (p === '/api/books-actions' && m === 'POST') {
        const b = body(q), bad = prepare(b);
        if (bad) return refuse(r, bad[1], bad[0], bad[2]);
        const a = actionOf(b); S.prepared.push(Object.assign({ posted_to: p }, b)); S.row = a; return J(r, 201, Object.assign({}, a, { warnings: [] }));
      }
      if (p === '/api/books-actions') { const rows = S.row && (u.searchParams.get('state') === 'all' || S.row.state === u.searchParams.get('state')) ? [S.row] : []; return J(r, 200, { actions: rows, total: rows.length, page: 1, limit: 100 }); }
      if (p === '/api/books/events' && m === 'POST') { S.posted.push(body(q)); return J(r, 200, { ok: true }); }
      if (p === '/api/books/events') return J(r, 200, { events: EVENTS, picks: { mode: [], debit_reason: [] }, pending: [], golden: {} });
      if (p === '/api/books/accounts') return J(r, 200, { accounts: ACCOUNTS });
      if (p === '/api/books/preview') return J(r, 200, preview(body(q)));
      if (p === '/api/books/health') return J(r, 200, books.health());
      if (p === '/api/books/trial-balance') { const ex = example('GET /api/books/trial-balance'); return J(r, 200, Object.assign(ex, { currency: 'INR' })); }
      return J(r, 200, {});
    }
    if (p === '/api/entities/me') return J(r, 200, { entity: { display_name: 'Fixture Shop', currency_code: 'INR' } });
    if (p === '/api/folders') return J(r, 200, { folders: [] });
    return J(r, 200, {});
  });
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Fixture Owner', 'Fixture Shop'));

  const txt = (sel) => page.locator(sel).first().innerText().then((s) => s.replace(/\s+/g, ' ').trim()).catch(() => '');
  const noScroll = () => page.evaluate(() => ({ y: document.documentElement.scrollHeight <= window.innerHeight + 1, x: document.documentElement.scrollWidth <= window.innerWidth + 1 }));

  await page.setViewportSize(WIDE);
  await page.goto(base + '/network.html'); await page.waitForSelector(T('nw-books-' + S1), { timeout: 20000 });
  await w.step('P1', 'the firm · Open books → "Prepare a journal" is offered in the workspace; it opens the books page acting for Store One', async () => {
    await page.click(T('nw-books-' + S1)); await page.waitForSelector(T('bv-prepare'), { timeout: 10000 });
    await page.click(T('bv-prepare')); await page.waitForSelector(T('ba-band'), { timeout: 20000 });
    const band = await txt(T('ba-band')), where = page.url();
    return { ok: /Acting for Store One/.test(band) && /accounts\.html\?acting=/.test(where), saw: band + ' · ' + where.replace(base, '') };
  });
  await w.step('P2', 'the books page · the frozen banner says Store One and its currency; every books request named the store and the adviser role', async () => {
    await page.waitForSelector(T('en-step-2'), { timeout: 20000 }); await page.waitForTimeout(400);
    const band = await txt(T('ba-band')), reads = S.calls.filter((c) => c.p.indexOf('/api/books/') === 0 || c.p === '/api/books-actions');
    return { ok: /Acting for Store One, INR/.test(band) && reads.length > 2 && reads.every((c) => c.h['x-books-for'] === S1 && c.h['x-books-role'] === 'adviser'), saw: band + ' · ' + reads.length + ' books requests, all with both headers' };
  });
  await w.step('P3', 'the sheet · a journal is written in the existing entry sheet (two lines), the preview comes from the server', async () => {
    await page.selectOption(T('en-line-code-0'), '6090'); await page.fill(T('en-line-amt-0'), '250'); await page.selectOption(T('en-line-side-0'), 'dr');
    await page.selectOption(T('en-line-code-1'), '1500'); await page.fill(T('en-line-amt-1'), '250'); await page.selectOption(T('en-line-side-1'), 'cr');
    await page.click(T('en-next')); await page.waitForSelector(T('en-step-3'), { timeout: 10000 }); await page.fill(T('en-f-narration'), 'Bank charges for October');
    await page.click(T('en-next')); await page.waitForSelector(T('en-step-4'), { timeout: 10000 }); await page.waitForSelector('[data-testid^="en-pline-"]', { timeout: 10000 });
    return { ok: await page.locator(T('en-save')).isEnabled(), saw: 'balanced by the server, Save on' };
  });
  await w.step('P4', 'the sheet · Save PREPARES: one POST /api/books-actions with store_id, kind journal, the body with its date, client_ref and working_month; nothing is posted; it says "Prepared, waiting for review"', async () => {
    await page.click(T('en-save')); await page.waitForSelector(T('en-prepared'), { timeout: 10000 });
    const said = await txt(T('en-prepared')), why = await txt('#en_body'), sent = S.prepared[0] || {};
    return { ok: S.prepared.length === 1 && S.posted.length === 0 && sent.store_id === S1 && sent.kind === 'journal' && sent.body && String(sent.body.date || '').length === 10 && sent.body.lines.length === 2 && !!sent.client_ref && /^\d{4}-\d{2}$/.test(sent.working_month || '') && /Prepared, waiting for review/.test(said) && /not posted until then/.test(why), saw: said + ' · prepared ' + S.prepared.length + ' posted ' + S.posted.length + ' lines ' + (sent.body && sent.body.lines && sent.body.lines.length) + ' · why: ' + why.slice(0, 80) + ' · ' + JSON.stringify({ kind: sent.kind, date: sent.body && sent.body.date, ref: sent.client_ref, month: sent.working_month }) };
  });
  await w.step('P5', 'the firm · back in the workspace, "Prepared by my team" lists the journal, waiting for review', async () => {
    await page.click(T('en-done')); await page.click(T('ba-back')); await page.waitForTimeout(800); if (!(await page.locator(T('nw-books-' + S1)).count())) await page.goto(base + '/network.html');   /* Back goes to the firm's Clients, which a firm login now lands on as its practice (W4): the workspace list is network.html */
    await page.waitForSelector(T('nw-books-' + S1), { timeout: 20000 });
    await page.click(T('nw-books-' + S1)); await page.waitForSelector(T('bv-tab-actions'), { timeout: 10000 }); await page.click(T('bv-tab-actions')); await page.waitForSelector(T('ba-q-team'), { timeout: 10000 });
    await page.click(T('ba-q-team')); await page.waitForTimeout(600);
    const list = await txt(T('ba-list'));
    return { ok: /Journal/.test(list) && /Waiting for review/.test(list) && /Me Myself/.test(list) && /250\.00/.test(list), saw: list.slice(0, 140) };
  });
  await w.step('P6', 'the contract · a journal with no date is refused by the api, and the sheet never sends one without it (the date field is required, today by default)', async () => {
    const miss = prepare({ store_id: S1, kind: 'journal', body: { lines: [{ code: '6090', dr_minor: 1 }, { code: '1500', cr_minor: 1 }] }, client_ref: 'x' });
    return { ok: !!miss && miss[0] === 'ACTION_DATE_REQUIRED' && S.prepared.every((b) => b.body.date), saw: 'stand-in answers ' + (miss && miss[0]) + '; the one sent carried ' + (S.prepared[0] && S.prepared[0].body.date) };
  });
  await w.step('P7', 'the books page · 1366×768 and 390×844 with the banner and the sheet: no sideways scroll', async () => {
    await page.goto(base + '/accounts.html?acting=' + S1 + '&actingName=Store%20One&prepare=journal#/daybook'); await page.waitForSelector(T('en-step-2'), { timeout: 20000 });
    const a = await noScroll(); await page.setViewportSize(NARROW); await page.waitForTimeout(400); const b = await noScroll();
    return { ok: a.x && b.x && (await page.locator(T('ba-band')).count()) === 1, saw: 'wide ' + a.y + '/' + a.x + ' · narrow ' + b.y + '/' + b.x };
  });
  await w.step('X1', 'the contract: every action the stand-in served carries every key api PR #1313 names', async () => ({ ok: wrong.length === 0, saw: wrong.length ? wrong.join('; ') : 'all ' + ACTION_KEYS.length + ' keys' }));
});
