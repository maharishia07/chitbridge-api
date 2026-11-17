#!/usr/bin/env node
/**
 * e2e/walk-lead1-risk-explain.cjs - LEAD1 (leader compare 17 Nov): the Day book's Risk column + "Any risk" filter, the weekend that follows the region, and "Explain" on a flagged P&L change, on a MOCKED api.
 *
 * OWNS      the proof of three changes, hand-computed: Risk counts per Day book row (six JET rules, one point each) in an Australian region (Sat+Sun weekend) and in a Fri+Sat region (ar-SA);
 *           the Any risk filter; Risk sortable; the fixed rule sentence under the list; Explain on the two flagged P&L lines (4000 Sales, 5000 Rent) only, a note saved as a private flag of kind 'account' (id <code>@<period end>).
 * CALLED BY by hand (and e2e/run-shard.cjs, walk-*.cjs)
 * CARD      04-network/ACC-176-AUDITOR-GRANT
 * Which api: a STAND-IN (the daybook and flags answers are the shapes of routes/books.js and routes/flags.js; the server's rules are the api's own tests).
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-lead1-risk-explain.cjs
 */
'use strict';
const W = require('./lib/walk.cjs');
const C = require('./lib/contract.cjs');
const T = (id) => '[data-testid="' + id + '"]';
const WIDE = { width: 1366, height: 768 }, NARROW = { width: 390, height: 844 };
const MEMBER = 'a0000000-0000-4000-8000-000000000001', OTHER = 'a0000000-0000-4000-8000-000000000002', BRAND = 'b0000000-0000-4000-8000-000000000009';
const GRANT = 'c0000000-0000-4000-8000-000000000001';
const DAY = (n) => new Date(W.nowMs() + n * 86400000).toISOString();
/* HAND-COMPUTED (viewer zone Australia/Sydney, period 1 Jul 2025 - 30 Jun 2026; Risk = after end + over 7 days late + weekend + after hours + round x100 + no narration):
 *   E1 3 (end, late, round) - E2 1 (narration) - E3 3 (weekend, night, round) - E4 2 (night, narration) - E5 3 (end, late, round) - E6 1 (night) - E7 3 (end, weekend, round) - E8..E13 0
 *   Any risk keeps 7 of 8; sorted most first: 3 3 3 3 2 1 1.  Fri+Sat region (Asia/Riyadh): F1 Fri 1 - F2 Sat 1 - F3 Sun 0 - F4 Fri 00:30 (Thu 21:30 UTC) 2 (weekend + after hours) */
const AU = [['E1', '2026-06-30', '2026-07-14T02:00:00.000Z', 150000, 'Ann', true], ['E2', '2026-06-15', '2026-06-15T22:30:00.000Z', 12345, 'Bob', false], ['E3', '2026-06-20', '2026-06-20T13:00:00.000Z', 1000000, 'Ann', true], ['E4', '2026-06-10', '2026-06-10T19:30:00.000Z', 100, 'Bob', false], ['E5', '2026-05-01', '2026-07-20T00:00:00.000Z', 5000000, 'Cara', true], ['E6', '2026-06-30', '2026-06-30T13:30:00.000Z', 777700, 'Cara', true], ['E7', '2026-07-05', '2026-07-05T01:00:00.000Z', 20000, 'Ann', true], ['E8', '2026-06-17', '2026-06-17T00:00:00.000Z', 550, 'Ann', true]].concat([9, 10, 11, 12, 13].map((n) => ['E' + n, '2026-06-17', '2026-06-17T00:00:00.000Z', 550 + n, 'Ann', true])); /* E9..E13: five more clean rows, so the list has 13 rows and draws its tools bar (a list of 12 or fewer has none) */
const FRI = [['F1', '2026-06-26', '2026-06-26T09:00:00.000Z', 12345, 'Ann', true], ['F2', '2026-06-27', '2026-06-27T09:00:00.000Z', 12345, 'Ann', true], ['F3', '2026-06-28', '2026-06-28T09:00:00.000Z', 12345, 'Ann', true], ['F4', '2026-06-26', '2026-06-25T21:30:00.000Z', 12345, 'Ann', true]];

const run = async (w) => {
  const { page, ctx, base } = w;
  const S = { calls: [], gives: [], revokes: [], given: [], refuse: null, set: AU, flags: [], posts: [] };
  const reset = () => { S.given = [{ grant_id: GRANT, grantor_entity: MEMBER, grantee_entity: BRAND, preset: 'auditor', can_see_costs: true, purpose: 'Year-end audit', granted_at: DAY(-5), expires_at: DAY(200), revoked_at: null, state: 'live' }]; };
  reset();
  const J = (r, status, body) => C.json(r, status, body);
  const example = (key) => { const hit = C.load().routes.filter((e) => e.key === key)[0]; return hit ? JSON.parse(JSON.stringify(hit.example)) : {}; };
  const line = (ex, over) => Object.assign({}, ex, over);
  const entryOf = (s, n) => Object.assign({}, BASE, { entry_id: 'e0000000-0000-4000-8000-' + String(n + 1).padStart(12, '0'), entry_no: 'JV-' + s[0][0] + s[0].slice(1).padStart(2, '0'), posting_date: s[1], doc_date: s[1], event_type: 'journal', narration: s[5] ? 'Written' : 'Journal', no_narration: !s[5], recorded_at: s[2], made_by: s[4], source_chit_id: null, reverses_entry_id: null, reversed_by: null, source: null, lines: [{ code: '1000', name: 'Cash', party_id: null, party_name: null, dr_minor: s[3], cr_minor: 0, counter: null, rate: null }, { code: '4000', name: 'Sales', party_id: null, party_name: null, dr_minor: 0, cr_minor: s[3], counter: null, rate: null }] });
  let BASE = {};
  const flagOf = (b, item, n) => ({ flag_id: String(100 + n), kind: b.kind, visibility: b.visibility || 'org', subject_kind: b.subject_kind, subject_entity: b.subject_entity, subject_id: String(item.id).toLowerCase(), label: item.label, note: b.note || null, state: 'open', seat: 'auditor', mine: true, by_name: 'Ann Auditor', created_at: DAY(0) });
  const handler = async (r) => {
    const q = r.request(), u = new URL(q.url()), p = u.pathname, m = q.method(), h = q.headers();
    S.calls.push({ m, p, q: u.search, h });
    if (p === '/api/flags/query') { const b = JSON.parse(q.postData() || '{}'), flags = {}; S.flags.filter((f) => f.subject_kind === b.subject_kind && (b.ids || []).indexOf(f.subject_id) >= 0).forEach((f) => { (flags[f.subject_id] = flags[f.subject_id] || []).push(f); }); return J(r, 200, { subject_kind: b.subject_kind, subject_entity: b.subject_entity, flags }); }
    if (p === '/api/flags' && m === 'POST') { const b = JSON.parse(q.postData() || '{}'); S.posts.push(b); const made = (b.items || []).map((item, n) => flagOf(b, item, S.flags.length + n)); S.flags = S.flags.concat(made); return J(r, 200, { created: made.length, already: 0, flags: made }); }
    if (p.indexOf('/api/flags') === 0) return J(r, 404, { error: 'We could not find that.' });
    if (p === '/api/books/daybook') { const ex = example('GET /api/books/daybook'); BASE = ex.entries[0] || {}; return J(r, 200, Object.assign(ex, { currency: 'INR', country: S.set === FRI ? 'SA' : 'AU' /* 75b665c3: the weekend is the AUDITED shop's calendar - the api's daybook answer names its country */, entries: S.set.map(entryOf), count: S.set.length })); }
    if (p === '/api/network-offers') { const ex = example('GET /api/network-offers'); ex.store.networks = [Object.assign({}, ex.store.networks[0], { brand_id: BRAND, brand_name: 'Acme Brand', membership: Object.assign({}, ex.store.networks[0].membership, { state: 'active' }), offers: [] })]; ex.may_design = { ok: false, why: 'Only the owner designs a network.' }; return J(r, 200, ex); }
    if (p === '/api/network-design/stores') return J(r, 200, { stores: [{ entity_id: MEMBER, name: 'Store One', city: 'Pune', km: 4, purpose: 'Tea' }, { entity_id: OTHER, name: 'Store Two', city: 'Delhi', km: 9, purpose: 'Snacks' }] });
    if (p === '/api/books-grants/consent') return J(r, 200, { headline: 'Let your network parent read your books', can_read: ['your trial balance', 'your profit and loss'], cannot: ['change or add anything'], costs: u.searchParams.get('can_see_costs') === 'false' ? 'It will not see your costs and margins.' : 'It will see your costs and margins.', rights: 'You can end this at any time.' });
    if (p === '/api/books-grants/log') return J(r, 200, { looks: [{ at: DAY(-1), grant_id: GRANT, grantee_entity: BRAND, actor_identity_id: 'x', route_pattern: 'GET /trial-balance', query_shape: null, status: 200, outcome: 'allowed' }, { at: DAY(-2), grant_id: GRANT, grantee_entity: BRAND, actor_identity_id: 'x', route_pattern: 'GET /packs', query_shape: null, status: 403, outcome: 'not_listed' }] });
    if (p === '/api/books-grants' && m === 'GET') return J(r, 200, { given: S.given, received: [{ grant_id: GRANT, grantor_entity: MEMBER, grantee_entity: BRAND, state: 'live', expires_at: DAY(200) }] });
    if (p === '/api/books-grants' && m === 'POST') { S.gives.push(JSON.parse(q.postData() || '{}')); return J(r, 201, { grant_id: GRANT, grantor_entity: MEMBER, grantee_entity: BRAND, purpose: 'x', expires_at: DAY(300) }); }
    if (/\/api\/books-grants\/[^/]+\/revoke$/.test(p)) { S.revokes.push(p); S.given = S.given.map((g) => Object.assign({}, g, { state: 'revoked', revoked_at: DAY(0) })); return J(r, 200, { grant_id: GRANT }); }
    if (p.indexOf('/api/books/') === 0) {
      if (h['x-books-for'] !== MEMBER) return J(r, 403, { error: 'No access has been given for these books.', message: 'No access has been given for these books.' });
      if (S.refuse && p === S.refuse.path) return J(r, 403, { error: S.refuse.words, message: S.refuse.words, code: 'GRANT_ROUTE_NOT_LISTED' });
      if (p === '/api/books/trial-balance') { const ex = example('GET /api/books/trial-balance'); return J(r, 200, Object.assign(ex, { currency: 'INR', rows: [line(ex.rows[0], { code: '1000', name: 'Cash', group: 'Assets', dr_minor: 123400, cr_minor: 0 }), line(ex.rows[0], { code: '4000', name: 'Sales', group: 'Income', dr_minor: 0, cr_minor: 123400 })], total_dr_minor: 123400, total_cr_minor: 123400, balanced: true, bank: [{ account_id: 'acc-1000', code: '1000', name: 'Cash', currency: 'INR', state: 'reconciled', period_to: ex.asOf || '2026-06-30', statement_minor: 125400, books_signed_minor: 123400, unexplained_minor: 0, books_now_minor: 123400, moved_minor: 0, signed_at: null }] })); }
      if (p === '/api/books/pl') { /* rank 3 (ASA 520): last year beside this year; the figures are HAND-COMPUTED (INR minor, threshold 10% AND 1,000.00 = 100000): Sales 5000000 vs 4000000 +1000000 +25% OVER · Other 120000 vs 100000 +20000 +20% under the amount · Rent 1500000 vs 1000000 +500000 +50% OVER · Wages 2100000 vs 2000000 +100000 +5% under the percent. Served direct (the api contract copy here does not carry the new keys yet). */
        const ex = example('GET /api/books/pl'), acc = (code, name, now, was, bp, over) => ({ code, name, role: 'x', amount_minor: now, prior_minor: was, change_bp: bp, share_bp: 1000, prior_share_bp: 1000, change_minor: now - was, change_over: over });
        const head = (label, now, was, bp, over, accounts) => ({ line: label.toLowerCase(), label, amount_minor: now, prior_minor: was, change_bp: bp, share_bp: 1000, change_minor: now - was, change_over: over, accounts });
        const body = Object.assign(ex, { from: '2025-07-01', to: '2026-06-30', currency: 'INR', income: [line(ex.income[0], { code: '4000', name: 'Sales', amount_minor: 5000000 }), line(ex.income[0], { code: '4100', name: 'Other income', amount_minor: 120000 })], expense: [line(ex.expense[0], { code: '5000', name: 'Rent', amount_minor: 1500000 }), line(ex.expense[0], { code: '5100', name: 'Wages', amount_minor: 2100000 })], total_income_minor: 5120000, total_expense_minor: 3600000, profit_minor: 1520000,
          by_line: { income: [head('Revenue', 5120000, 4100000, 2488, true, [acc('4000', 'Sales', 5000000, 4000000, 2500, true), acc('4100', 'Other income', 120000, 100000, 2000, false)])], expense: [head('Costs', 3600000, 3000000, 2000, true, [acc('5000', 'Rent', 1500000, 1000000, 5000, true), acc('5100', 'Wages', 2100000, 2000000, 500, false)])] },
          compare: { how: 'year', from: '2025-04-01', to: '2026-03-31', total_income_minor: 4100000, total_expense_minor: 3000000, profit_minor: 1100000, income_change_bp: 2488, expense_change_bp: 2000, profit_change_bp: 3818, income_change_minor: 1020000, expense_change_minor: 600000, profit_change_minor: 420000, income_change_over: true, expense_change_over: true, profit_change_over: true },
          over_rule: { pct_bp: 1000, min_major: 1000, min_minor: 100000 } });
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }); }
      if (p === '/api/books/periods') { /* W22: the books start Jul 2025, Jul-Jan locked, Feb open under later locked months; two empty months in 2024 sit before the start */
        const ex = example('GET ' + p), row = (fy, n, ym, status, entries) => Object.assign({}, ex.periods[0], { fiscal_year: fy, period: n, start_date: ym + '-01', end_date: ym + '-28', status, entries, sales_minor: 0, before_books: fy === '2024-25' ? true : undefined });
        const months = ['2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03'];
        return J(r, 200, Object.assign(ex, { periods: [row('2024-25', 1, '2024-07', 'open', 0), row('2024-25', 2, '2024-08', 'open', 0)].concat(months.map((ym, n) => row('2025-26', n + 1, ym, ym === '2026-02' ? 'open' : 'soft_locked', 3))), under_review: { fy: '2025-26', from: '2025-07-01', to: '2026-06-30' }, books_start: { fiscal_year: '2025-26', period: 1, start_date: '2025-07-01' }, lock_date: '2026-01-31', gaps: [{ fiscal_year: '2025-26', period: 8, start_date: '2026-02-01' }] }));
      }
      const E1 = 'e0000000-0000-4000-8000-000000000001';
      const entry = { entry_id: E1, entry_no: 'JV-0001', posting_date: '2026-11-03', doc_date: '2026-11-03', event_type: 'sale', narration: 'Cash sale', source_chit_id: null, reverses_entry_id: null, reversed_by: null, source: { chit_id: null, ref: 'B-9', kind: 'bill', counter: null, by: 'Asha', count: null, how: 'Cash', how_ref: null, split: null, bills: null, doc_at: '2026-11-03T09:00:00.000Z', recorded_at: '2026-11-03T09:05:00.000Z' }, lines: [{ code: '1000', name: 'Cash', party_id: null, party_name: 'Walk-in buyer', dr_minor: 123400, cr_minor: 0, counter: null, rate: null }, { code: '4000', name: 'Sales', party_id: null, party_name: null, dr_minor: 0, cr_minor: 123400, counter: null, rate: null }] };
      if (p === '/api/books/ledger/1000' || p === '/api/books/ledger/4000') { const ex = example('GET /api/books/ledger/:account'), cash = p.endsWith('1000'); /* the PAGED ledger the drill asks for (limit=100): its page keys (total · page · limit · next · totals · page_opening_minor) are not in the api contract's example yet (reported to cb-api), so this one answer is sent as the server sends it and not held to the example */
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(Object.assign(ex, { currency: 'INR', account: { code: cash ? '1000' : '4000', name: cash ? 'Cash' : 'Sales', nature: cash ? 'asset' : 'income' }, from: '2026-04-01', to: '2026-11-15', opening_minor: 0, lines: [{ date: '2026-11-03', doc_date: '2026-11-03', what: 'Cash sale', ref: 'JV-0001', entry_id: E1, entry_no: 'JV-0001', event_type: 'sale', reverses_entry_id: null, reversed_by: null, source_chit_id: null, source: null, party_id: null, dr_minor: cash ? 123400 : 0, cr_minor: cash ? 0 : 123400, running_minor: cash ? 123400 : -123400 }], closing_minor: cash ? 123400 : -123400, page_opening_minor: 0, total: 1, page: 1, limit: 100, next: null, totals: { dr_minor: cash ? 123400 : 0, cr_minor: cash ? 0 : 123400 } })) }); }
      if (p === '/api/books/daybook') { const ex = example('GET /api/books/daybook'); BASE = ex.entries[0] || {}; return J(r, 200, Object.assign(ex, { currency: 'INR', entries: [Object.assign({}, ex.entries[0], entry)], count: 1 })); }
      const ex = example('GET ' + p); ['entries', 'parties', 'periods'].forEach((k) => { if (Array.isArray(ex[k])) ex[k] = []; }); /* only the list keys the api's own example has: a key it does not send is not invented (X1) */ return J(r, 200, ex);
    }
    return J(r, 200, {});
  };
  await ctx.route(base + '/api/**', handler);
  const init = (c, loc) => c.addInitScript((a) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', a[0]); localStorage.setItem('cb_locale', a[1]); } catch (_) {} }, [W.session('Fixture Owner', 'Fixture Shop'), loc]); /* the region the person chose (CBLocale), which is what the weekend reads */
  await init(ctx, 'en-AU');
  const txt = (sel) => page.locator(sel).first().innerText().then((s) => s.replace(/\s+/g, ' ').trim()).catch(() => '');
  const has = (sel) => page.locator(sel).count().then((n) => n > 0);
  const noScroll = () => page.evaluate(() => ({ y: document.documentElement.scrollHeight <= window.innerHeight + 1, x: document.documentElement.scrollWidth <= window.innerWidth + 1 }));
  const openBooks = async (pg, loc) => { await pg.goto(base + '/network.html'); await pg.waitForSelector(T('nw-books-' + MEMBER), { timeout: 20000 }); await pg.evaluate((l) => window.CBLocale.setLocale(l), loc); /* the region the person chose: CBLocale's own setter, after the page's boot */ await pg.click(T('nw-books-' + MEMBER)); await pg.waitForSelector(T('bv-band'), { timeout: 10000 }); await pg.waitForSelector(T('bv-row-0'), { timeout: 10000 }); await pg.waitForTimeout(500); };
  const riskCol = (pg) => pg.$$eval('[data-testid^="bv-row-"]', (rows) => rows.map((r) => { const n = r.querySelector('[data-testid="bv-risk"]'); return n ? Number(n.textContent) : 0; }));
  const entryCol = (pg) => pg.$$eval('[data-testid^="bv-row-"]', (rows) => rows.map((r) => (r.textContent.match(/JV-[A-Z]\d\d/) || [''])[0]));

  await page.setViewportSize(WIDE);
  await openBooks(page, 'en-AU');
  await w.step('R1', 'Day book, region Australia (Sat+Sun): the Risk column counts E1..E8 = 3,1,3,2,3,1,3,0 then five clean rows 0, as hand-computed', async () => {
    const got = await riskCol(page), names = await entryCol(page);
    return { ok: got.join(',') === '3,1,3,2,3,1,3,0,0,0,0,0,0' && names.length === 13, saw: names.join(',') + ' -> ' + got.join(',') + ' | ' + (await page.evaluate(() => 'locale ' + window.CBLocale.locale() + ' weekend ' + JSON.stringify((window.CBLocale.weekInfo() || {}).weekend) + ' ls ' + localStorage.getItem('cb_locale') + ' tz ' + Intl.DateTimeFormat().resolvedOptions().timeZone)) };
  });
  await w.step('R2', 'the rule sentence is on the page and names the fixed constants (7 days, 8 pm to 7 am, multiple of 100)', async () => {
    const note = await txt(T('bv-risk-note'));
    return { ok: /over 7 days late/.test(note) && /8 pm to 7 am/.test(note) && /multiple of 100/.test(note) && /weekend/.test(note), saw: note.slice(0, 160) };
  });
  await w.step('R3', 'Any risk keeps 7 rows (E1..E7), not the six clean ones', async () => {
    await page.click(T('cbl-filters-books-grant-daybook')); await page.selectOption(T('listctl-filter-risk'), 'any'); await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    const names = await entryCol(page);
    return { ok: names.join(',') === 'JV-E01,JV-E02,JV-E03,JV-E04,JV-E05,JV-E06,JV-E07', saw: names.join(',') };
  });
  await w.step('R4', 'Risk sorts: the first press = most risks first (75b665c3: 3,3,3,3,2,1,1), a second press reverses it', async () => {
    const head = page.locator('.cbl-hc .sort', { hasText: 'Risk' }).first();
    const opened = await riskCol(page);
    await head.click(); await page.waitForTimeout(300); const first = await riskCol(page);
    await head.click(); await page.waitForTimeout(300); const second = await riskCol(page);
    return { ok: first.join(',') === '3,3,3,3,2,1,1' && second.join(',') === '1,1,2,3,3,3,3', saw: 'opened: ' + opened.join(',') + ' - press 1: ' + first.join(',') + ' - press 2: ' + second.join(',') };
  });
  await w.step('R5', 'Risk fits 390x844 with no sideways page scroll', async () => {
    await page.setViewportSize(NARROW); await page.waitForTimeout(400); const s = await noScroll(); await page.setViewportSize(WIDE);
    return { ok: s.x, saw: 'x fits ' + s.x };
  });
  await w.step('P1', 'P&L: Explain on the two flagged lines (Sales 4000, Rent 5000) only', async () => {
    await page.click(T('bv-tab-pl')); await page.waitForSelector(T('bv-row-0'), { timeout: 10000 }); await page.waitForTimeout(600);
    const ids = await page.$$eval('[data-fl-k="account"]', (els) => els.map((e) => e.getAttribute('data-fl') + ':' + e.textContent.trim()));
    return { ok: ids.join(',') === '4000@2026-06-30:Explain,5000@2026-06-30:Explain', saw: ids.join(',') };
  });
  await w.step('P2', 'Explain opens a note only (no Bookmark); Save explanation sends kind note, subject_kind account, id 4000@2026-06-30, to my own organisation (no X-Books-For)', async () => {
    await page.click('[data-fl="4000@2026-06-30"]'); await page.waitForSelector(T('fl-sheet'), { timeout: 5000 });
    const bookmark = await has(T('fl-bookmark')), words = await txt(T('fl-sheet'));
    await page.fill(T('fl-note'), 'Price rise from June'); await page.click(T('fl-add-note')); await page.waitForTimeout(600);
    const post = S.posts[0] || {}, call = S.calls.filter((c) => c.p === '/api/flags' && c.m === 'POST')[0] || { h: {} };
    return { ok: !bookmark && /Save explanation/.test(words) && post.kind === 'note' && post.subject_kind === 'account' && post.subject_entity === MEMBER && post.items[0].id === '4000@2026-06-30' && post.note === 'Price rise from June' && !call.h['x-books-for'], saw: 'bookmark button ' + bookmark + ' - ' + JSON.stringify(post).slice(0, 170) };
  });
  await w.step('P3', 'after the note the Sales line says Explained and the Rent line still says Explain', async () => {
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    const ids = await page.$$eval('[data-fl-k="account"]', (els) => els.map((e) => e.getAttribute('data-fl') + ':' + e.textContent.trim()));
    return { ok: ids.join(',') === '4000@2026-06-30:Explained,5000@2026-06-30:Explain', saw: ids.join(',') };
  });
  await w.step('P4', 'the P&L fits 390x844 with no sideways page scroll', async () => {
    await page.setViewportSize(NARROW); await page.waitForTimeout(400); const s = await noScroll(); await page.setViewportSize(WIDE);
    return { ok: s.x, saw: 'x fits ' + s.x };
  });
  /* the region's weekend: a SECOND browser context in Saudi Arabia (Asia/Riyadh, ar-SA: CLDR weekend Fri+Sat) */
  const c2 = await w.contextAt({ timezoneId: 'Asia/Riyadh', locale: 'ar-SA' });
  await c2.route(base + '/api/**', handler); await init(c2, 'ar-SA');
  const p2 = await c2.newPage(); await p2.setViewportSize(WIDE);
  S.set = FRI;
  await w.step('W1', 'Day book, region Saudi Arabia (Fri+Sat weekend): Friday and Saturday flag, Sunday does not; Thursday 21:30 UTC (Friday 00:30 shop time) flags twice (F1..F4 = 1,1,0,2)', async () => {
    await openBooks(p2, 'ar-SA');
    const got = await riskCol(p2);
    const wk = await p2.evaluate(() => (window.CBLocale && window.CBLocale.weekInfo() || {}).weekend);
    return { ok: got.join(',') === '1,1,0,2' && String(wk) === '5,6', saw: 'weekend ' + wk + ' -> ' + got.join(',') + ' | ' + (await p2.evaluate(() => 'locale ' + window.CBLocale.locale() + ' ls ' + localStorage.getItem('cb_locale'))) };
  });
  await w.step('X1', 'every /api/books answer the stand-in served matched the api contract', async () => { const [ok, saw] = C.finish(); return { ok, saw }; });
};
run.opts = { timezoneId: 'Australia/Sydney', locale: 'en-AU' };
W.run('lead1-risk-explain', run);
