#!/usr/bin/env node
/**
 * e2e/walk-marks.cjs — ACC-358 WALKED: the auditor's Checked / Query / On hold marks and the Query thread, on a STATEFUL STAND-IN of api feat/marks (docs/marks-contract.md).
 *
 * OWNS      the proof of the web half: the auditor marks an entry Checked in ONE press, raises a Query (its question is required), the OWNER sees the chip at once and replies in the thread (no second composer),
 *           the auditor clears it; "checked n of m" and "All queries" with ageing; "Changed after review" as a chip state; the owner never sees set buttons; 1366×768 and 390×844 with no page scroll; a keyboard path
 * CALLED BY e2e/run-shard.cjs (walk-*.cjs) · the PR's CI walk · toolset/sit-box-run.sh <box> e2e
 * CARD      14-accounting/ACC-358-AUDIT-MARKERS-REQUIREMENT
 * Which api: a STAND-IN of the contract. The real round (the SIT box, a real grant) is e2e/walk-marks-live.cjs.
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-marks.cjs
 */
'use strict';
const path = require('path');
const W = require('./lib/walk.cjs');
const C = require('./lib/contract.cjs');
const T = (id) => '[data-testid="' + id + '"]';
const WIDE = { width: 1366, height: 768 }, NARROW = { width: 390, height: 844 };
const MEMBER = 'a0000000-0000-4000-8000-000000000001', BRAND = 'b0000000-0000-4000-8000-000000000009';
const GRANT = 'c0000000-0000-4000-8000-000000000001';
const E = ['e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000003'];
const THREAD = 'f0000000-0000-4000-8000-000000000001';
const DAY = (n) => new Date(W.nowMs() + n * 86400000).toISOString();
const SHOTS = process.env.MARKS_SHOTS || path.join(__dirname, 'shots');

W.run('marks', async (w) => {
  const { page, ctx, base } = w;
  const S = { qseq: 0, bellFor: 'owner', both: false, daybookQueries: [], calls: [], marks: {}, msgs: [], sets: [], replies: [] };
  const J = (r, status, body) => C.json(r, status, body);
  const example = (key) => { const hit = C.load().routes.filter((e) => e.key === key)[0]; return hit ? JSON.parse(JSON.stringify(hit.example)) : {}; };
  const VOC = [{ kind: 'checked', label: 'Checked', class: 'clear', note: 'none' }, { kind: 'query', label: 'Query', class: 'open', note: 'required' }, { kind: 'on_hold', label: 'On hold', class: 'hold', note: 'optional' }];
  const KIND = { checked: ['clear', 'Checked'], query: ['open', 'Query'], on_hold: ['hold', 'On hold'] };
  const NOT_AUDITOR = 'Only the auditor can mark a record. You can read the marks and answer a query.';
  const auditor = (h) => !!h['x-books-for'] && h['x-books-role'] !== 'adviser';
  const acts = (h, open) => ({ set: auditor(h) ? { ok: true, why: null } : { ok: false, why: NOT_AUDITOR }, reply: open === false ? { ok: false, why: 'This question is closed.' } : { ok: true, why: null } }); /* the auditor raised it: auditor, owner and adviser reply; only the auditor sets */
  const mark = (id, h) => {
    const m = S.marks[id]; if (!m) return null;
    const open = m.class === 'open' || m.class === 'hold';
    return Object.assign({}, m, { open, age_days: open ? 3 : null, message_count: S.msgs.length, actions: acts(h, open) });
  };
  const entry = (n) => ({ entry_id: E[n], entry_no: 'JV-000' + (n + 1), posting_date: '2026-11-0' + (n + 3), doc_date: '2026-11-03', event_type: 'sale', narration: ['Cash sale', 'Rent paid', 'Stock bought'][n], source_chit_id: null, reverses_entry_id: null, reversed_by: null, source: { chit_id: null, ref: 'B-' + n, kind: 'bill', counter: null, by: 'Asha', count: null, how: 'Cash', how_ref: null, split: null, bills: null, doc_at: '2026-11-03T09:00:00.000Z', recorded_at: '2026-11-03T09:05:00.000Z' }, lines: [{ code: '1000', name: 'Cash', party_id: null, party_name: 'Walk-in buyer', dr_minor: 123400 + n, cr_minor: 0, counter: null, rate: null }, { code: '4000', name: 'Sales', party_id: null, party_name: null, dr_minor: 0, cr_minor: 123400 + n, counter: null, rate: null }] });

  await ctx.route(base + '/api/**', async (r) => {
    const q = r.request(), u = new URL(q.url()), p = u.pathname, m = q.method(), h = q.headers();
    S.calls.push({ m, p, q: u.search, h });
    if (p === '/api/network-offers') { const ex = example('GET /api/network-offers'); ex.store.networks = [Object.assign({}, ex.store.networks[0], { brand_id: BRAND, brand_name: 'Acme Brand', membership: Object.assign({}, ex.store.networks[0].membership, { state: 'active' }), offers: [] })]; ex.may_design = { ok: false, why: 'Only the owner designs a network.' }; return J(r, 200, ex); }
    if (p === '/api/network-design/stores') return J(r, 200, { stores: [{ entity_id: MEMBER, name: 'Store One', city: 'Pune', km: 4, purpose: 'Tea' }] });
    if (p === '/api/books-grants' && m === 'GET') return J(r, 200, { given: [], received: [{ grant_id: GRANT, grantor_entity: MEMBER, grantee_entity: BRAND, state: 'live', preset: 'auditor', expires_at: DAY(200) }].concat(S.both ? [{ grant_id: 'c0000000-0000-4000-8000-000000000002', grantor_entity: MEMBER, grantee_entity: BRAND, state: 'live', preset: 'adviser', expires_at: DAY(200) }] : []) });
    if (p === '/api/marks' && m === 'GET' && u.searchParams.get('open')) {
      const open = Object.keys(S.marks).map((id) => mark(id, h)).filter((x) => x.open).map((x) => Object.assign(x, { subject_label: 'JV-000' + (E.indexOf(x.subject_id) + 1), posting_date: '2026-11-04' }));
      const checked = Object.keys(S.marks).filter((id) => S.marks[id].class === 'clear' && !S.marks[id].altered).length;
      return J(r, 200, { adopter: 'acc.audit', from: '2026-11-01', to: '2026-11-15', open, total_open: open.length, checked, of: u.searchParams.get('from') && u.searchParams.get('to') && u.searchParams.get('from') <= '2026-11-01' && u.searchParams.get('to') >= '2026-11-30' ? 3 : 0, /* the server counts the period asked: the Day book now opens on the whole year (a9483f9b), which holds the three November entries */ /* the server counts the period it is asked about; with none it is the current month (empty here) */ oldest_age_days: open.length ? 3 : null, vocabulary: VOC, actions: acts(h) });
    }
    if (p === '/api/marks' && m === 'GET' && u.searchParams.get('ids')) return J(r, 200, { adopter: 'acc.audit', marks: u.searchParams.get('ids').split(',').map((id) => mark(id, h)).filter(Boolean), actions: acts(h) }); /* the list of marks for ids (the bell opens one record without the Day book) */
    if (p === '/api/marks' && m === 'POST') {
      const b = JSON.parse(q.postData() || '{}'); S.sets.push({ b, h });
      if (!auditor(h)) return J(r, 403, { code: 'MARK_NOT_ALLOWED', message: NOT_AUDITOR });
      if (b.kind === 'query' && !b.note) return J(r, 422, { code: 'MARK_WORDS_REQUIRED', message: 'Write the question first. The owner will read it.' });
      if (b.kind === 'query') S.qseq += 1; /* the server's thread starts at the latest Query: an older Query's replies stay behind */
      S.marks[b.subject_id] = { mark_id: String(1200 + S.sets.length), adopter: 'acc.audit', subject_id: b.subject_id, thread_id: THREAD, kind: b.kind, class: KIND[b.kind][0], label: KIND[b.kind][1], note: b.note || null, at: DAY(0), by_name: 'A. Auditor', by_firm: 'Harbour Audit', open_since: DAY(-3), altered: false, altered_by: null, recheck_needed: false };
      return J(r, 201, { mark: mark(b.subject_id, h), vocabulary: VOC });
    }
    if (/^\/api\/marks\/[^/]+\/messages$/.test(p)) {
      const id = Object.keys(S.marks).filter((k) => S.marks[k].thread_id === p.split('/')[3])[0], mk = id && mark(id, h);
      if (m === 'GET') return J(r, 200, { thread_id: THREAD, adopter: 'acc.audit', subject_id: id, subject_label: 'JV-0002', mark: mk, history: [], messages: S.msgs.filter((x) => x.qseq === S.qseq).map((x) => Object.assign({}, x, { mine: !auditor(h) })), actions: acts(h) });
      const b = JSON.parse(q.postData() || '{}'); S.replies.push({ b, h });
      if (auditor(h)) return J(r, 403, { code: 'MARK_REPLY_NOT_ALLOWED', message: 'Only the owner and the adviser answer a question.' });
      const msg = { message_id: 'm' + S.msgs.length, sender_display_name: 'Fixture Owner', message_text: b.message_text, msg_type: 'info', created_at: DAY(0), mine: true, qseq: S.qseq };
      S.msgs.push(msg); return J(r, 201, { message: msg, mark: mk });
    }
    if (p === '/api/notifications' && m === 'GET') {
      /* the bell as the api gives it (lib/mark-notices): the owner hears each Query, the auditor each reply; every row names the entry */
      const entryOf = (id) => { const n = E.indexOf(id); return { entry_id: id, entry_no: 'JV-000' + (n + 1), posting_date: '2026-11-0' + (n + 3), currency: 'INR', total_minor: '88000' }; };
      const rows = S.bellFor === 'owner' ? S.sets.filter((x) => auditor(x.h) && x.b.kind === 'query').map((x, i) => ({ log_id: 'mk:' + i, action: 'mark_query', action_by_display_name: 'Fixture Auditor', detail: x.b.note, created_at: DAY(0), mark_entry: entryOf(x.b.subject_id) })) : S.replies.map((x, i) => ({ log_id: 'mr:' + i, action: 'mark_reply', action_by_display_name: 'Fixture Owner', detail: x.b.message_text, created_at: DAY(0), mark_entry: entryOf(E[1]) }));
      if (S.ghost && S.bellFor === 'owner') rows.length = 0, rows.push({ log_id: 'mk:ghost', action: 'mark_query', action_by_display_name: 'Fixture Auditor', detail: 'Gone?', created_at: DAY(0), mark_entry: { entry_id: null, entry_no: 'JV-0009', posting_date: '2026-11-05', currency: 'INR', total_minor: '1000' } }); /* a row that names no entry id and a number nothing open carries */
      return J(r, 200, u.searchParams.get('count') ? { count: rows.length, total: rows.length, seen_at: null } : { notifications: rows, count: rows.length, total: rows.length, page: 1, limit: 30, seen_at: null });
    }
    if (p === '/api/books/daybook') {
      if (h['x-books-for']) S.daybookQueries.push(new URL(q.url()).search);
      const ex = example('GET /api/books/daybook');
      return J(r, 200, Object.assign(ex, { currency: 'INR', entries: [0, 1, 2].map((n) => Object.assign({}, ex.entries[0], entry(n), { mark: mark(E[n], h) })), count: 3, mark_actions: acts(h), mark_vocabulary: VOC }));
    }
    if (p === '/api/books/periods' && h['x-books-for']) return J(r, 200, { under_review: { fy: '2026-27', from: '2026-04-01', to: '2027-03-31' }, years: [], periods: [{ fiscal_year: '2026-27', period: 5, start_date: '2026-11-01', end_date: '2026-11-30', status: 'open', entries: 3, sales_minor: 370200 }, { fiscal_year: '2026-27', period: 6, start_date: '2026-12-01', end_date: '2026-12-31', status: 'open', entries: 0, sales_minor: 0 }, { fiscal_year: '2098-99', period: 7, start_date: '2099-01-01', end_date: '2099-01-31', status: 'open', entries: 0, sales_minor: 0 }] }); /* the real shape: period is the fiscal month number, the dates are the range; the latest month is EMPTY */
    if (/^\/api\/books\/(trial-balance|pl|bs|dues|periods)$/.test(p) && h['x-books-for']) { const ex = example('GET ' + p); return J(r, 200, Object.assign(ex, { entries: [], parties: [], periods: [] })); }
    return J(r, 200, {});
  });
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Fixture Owner', 'Fixture Shop'));

  const txt = (sel) => page.locator(sel).first().innerText().then((s) => s.replace(/\s+/g, ' ').trim()).catch(() => '');
  const noScroll = () => page.evaluate(() => ({ y: document.documentElement.scrollHeight <= window.innerHeight + 1, x: document.documentElement.scrollWidth <= window.innerWidth + 1 }));
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, name + '.png') }).catch(() => {});
  const chip = (n) => '[data-mark*="' + E[n] + '"]';
  const sets = () => S.sets.filter((x) => auditor(x.h));
  const openDaybook = async () => {
    await page.goto(base + '/network.html'); await page.waitForSelector(T('nw-books-' + MEMBER), { timeout: 20000 });
    await page.click(T('nw-books-' + MEMBER)); await page.waitForSelector(T('bv-band'), { timeout: 10000 });
    await page.click(T('bv-tab-daybook')); await page.waitForSelector(T('bv-row-0'), { timeout: 10000 }); await page.waitForSelector(T('mk-bar'), { timeout: 10000 });
  };

  /* ═══ the auditor ═══ */
  await page.setViewportSize(WIDE);
  await w.step('L1', 'the auditor lands on the Day book: Open books shows it with no extra press', async () => {
    await page.goto(base + '/network.html'); await page.waitForSelector(T('nw-books-' + MEMBER), { timeout: 20000 });
    await page.click(T('nw-books-' + MEMBER)); await page.waitForSelector(T('bv-band'), { timeout: 10000 }); await page.waitForSelector(T('bv-row-0'), { timeout: 10000 });
    const on = await page.getAttribute(T('bv-tab-daybook'), 'aria-pressed'), tb = await page.getAttribute(T('bv-tab-tb'), 'aria-pressed');
    return { ok: on === 'true' && tb === 'false', saw: 'Day book pressed ' + on + ' · trial balance pressed ' + tb };
  });
  await openDaybook();
  await w.step('A1', 'the auditor · Day book: a chip on each entry and "Checked 0 of 3 entries this period"', async () => {
    const chips = await page.locator('[data-mark] button[data-mk="check"]').count(), bar = await txt(T('mk-count'));
    await shot('01-auditor-daybook-unmarked');
    return { ok: chips === 3 && /Checked 0 of 3/.test(bar), saw: chips + ' check chips · ' + bar };
  });
  await w.step('N390', '390×844 · an unmarked entry says what it is in words (Not checked, Query), never a bare symbol, and the page does not scroll', async () => {
    await page.setViewportSize(NARROW); await page.waitForTimeout(400);
    const words = await page.evaluate(() => Array.prototype.map.call(document.querySelectorAll('[data-mark]'), (h) => Array.prototype.map.call(h.querySelectorAll('button'), (b) => { const r = b.getBoundingClientRect(); return r.width > 0 ? b.innerText.replace(/s+/g, ' ').trim() : '-'; }).join('|')));
    const a = await noScroll(); await shot('00b-phone-labels'); await page.setViewportSize(WIDE); await page.waitForTimeout(300);
    return { ok: words.length === 3 && words.every((x) => /Not checked/.test(x) && /Query/.test(x)) && a.y && a.x, saw: words.join(' // ') + ' · scroll ' + a.y + '/' + a.x };
  });
  await w.step('A0', 'the auditor · the Day book opens non-empty on its own, on the whole financial year (a9483f9b): no day typed, the period shown, the date in words, the kind in words', async () => {
    const first = (S.daybookQueries[0] || ''), day = await page.inputValue(T('bv-day')), period = await page.locator('body').innerText(), row = await txt(T('bv-row-0'));
    await shot('00-auditor-daybook-opens-on-its-own');
    return { ok: first.includes('from=2026-04-01') && first.includes('to=2027-03-31') && day === '' && period.includes('1 Apr 2026 – 31 Mar 2027') && row.includes('Sales') && row.includes('3 Nov 2026') && !row.includes('2026-11') && (await txt(T('mk-count'))).includes('of 3'), saw: first + ' · day "' + day + '" · ' + period + ' · ' + row.slice(0, 80) };
  });
  await w.step('A2', 'the auditor · ONE press on a row\'s Check: one write (checked), the chip says Checked, the bar says 1 of 3', async () => {
    await page.click(chip(0) + ' button[data-mk="check"]'); await page.waitForSelector(chip(0) + ' [data-class="clear"]', { timeout: 8000 });
    await page.waitForTimeout(400);
    const s = sets(), bar = await txt(T('mk-count')), c = await txt(chip(0));
    await shot('02-auditor-checked');
    return { ok: s.length === 1 && s[0].b.kind === 'checked' && s[0].b.subject_id === E[0] && !!s[0].h['idempotency-key'] && /Checked/.test(c) && /1 of 3/.test(bar), saw: JSON.stringify(s[0] && s[0].b) + ' · ' + c + ' · ' + bar };
  });
  await w.step('A3', 'the auditor · "?" on a row opens the sheet; Ask a question with no words is refused in plain words and sends nothing', async () => {
    await page.click(chip(1) + ' button[data-mk="ask"]'); await page.waitForSelector(T('mk-sheet'), { timeout: 5000 });
    const before = sets().length;
    /* the Ask button is aria-disabled while the box is empty (Playwright will not click it); a press still answers in plain words, so press it by force */
    await page.click(T('mk-set-open'), { force: true }); await page.waitForTimeout(300);
    const out = await txt(T('mk-out')), hint = await txt(T('mk-sheet'));
    return { ok: /Write your question first/.test(out) && sets().length === before && /The owner sees this/.test(hint), saw: out + ' · owner-sees-this hint ' + /The owner sees this/.test(hint) };
  });
  await w.step('T1', 'the Query sheet is titled by the entry (number · day · amount), never the record id', async () => {
    const title = await txt(T('mk-title'));
    return { ok: /^JV-0002 · 4 Nov 2026 · ₹[0-9,]+.[0-9]{2}$/.test(title) && !title.includes(E[1]), saw: title };
  });
  await w.step('A4', 'the auditor · type the question, Ask: ONE write (query + note), the sheet closes, the row says Query', async () => {
    await page.fill(T('mk-note'), 'Why was rent posted to 4100?'); await shot('03-auditor-query-sheet');
    await page.click(T('mk-set-open')); await page.waitForSelector(T('mk-sheet'), { state: 'detached', timeout: 8000 });
    await page.waitForTimeout(400);
    const s = sets(), c = await txt(chip(1)), bar = await txt(T('mk-filter'));
    await shot('04-auditor-query-raised');
    return { ok: s.length === 2 && s[1].b.kind === 'query' && s[1].b.note === 'Why was rent posted to 4100?' && /Query/.test(c) && /All queries · 1/.test(bar), saw: JSON.stringify(s[1] && s[1].b) + ' · ' + c + ' · ' + bar };
  });
  await w.step('A5', 'the auditor · All queries: the open list with its age and the question; pressed again it returns to the day book', async () => {
    await page.click(T('mk-filter')); await page.waitForSelector(T('mk-queries'), { timeout: 5000 });
    const list = await txt(T('mk-queries')); await shot('05-auditor-all-queries');
    await page.click(T('mk-filter')); await page.waitForSelector(T('bv-row-0'), { timeout: 5000 });
    return { ok: /JV-0002/.test(list) && /Why was rent posted/.test(list) && /3 days/.test(list), saw: list };
  });

  /* ═══ the owner ═══ */
  await w.step('O1', 'the owner · accounts.html Day book: the same chips at once; the Query is there; he cannot set (no Check chip)', async () => {
    await page.goto(base + '/accounts.html#daybook'); await page.waitForSelector(T('acc-nav-daybook'), { timeout: 20000 });
    await page.waitForSelector('[data-mark] button[data-mk]', { timeout: 15000 });
    const checked = await txt(chip(0)), query = await txt(chip(1)), ghosts = await page.locator('[data-mark] button[data-mk="check"]').count();
    await shot('06-owner-daybook-chips');
    return { ok: /Checked/.test(checked) && /Question from Harbour Audit/.test(query) && !/^Query/.test(query) && ghosts === 0, saw: checked + ' · ' + query + ' · check chips ' + ghosts };
  });
  await w.step('O1b', 'the owner · W15-25: the queried row has a coloured bar on its LEFT edge; "Waiting for you · 1" shows only the Query still waiting for his answer; pressed again it shows all', async () => {
    const bar = await page.evaluate((id) => { const h = document.querySelector('[data-mark*="' + id + '"]'), r = h && h.closest('.cbl-row,.cbl-lrec'); return r ? { cls: r.className, shadow: getComputedStyle(r).boxShadow } : null; }, E[1]);
    const chipTxt = await txt(T('mk-chip-waiting'));
    await page.click(T('mk-chip-waiting')); await page.waitForTimeout(400);
    const rowsOn = await page.locator('[data-mark] button[data-mk]').count(), pressed = await page.getAttribute(T('mk-chip-waiting'), 'aria-pressed'); await shot('06c-owner-waiting-filter');
    await page.click(T('mk-chip-waiting')); await page.waitForTimeout(400);
    const rowsAll = await page.locator('[data-mark] button[data-mk]').count();
    return { ok: !!bar && /mk-wait/.test(bar.cls) && /rgb/.test(bar.shadow) && /Waiting for you · 1/.test(chipTxt) && pressed === 'true' && rowsOn === 1 && rowsAll === 2, saw: JSON.stringify(bar) + ' · ' + chipTxt + ' · pressed ' + pressed + ' · rows ' + rowsOn + ' → ' + rowsAll };
  });
  await w.step('B1', 'the owner bell rings for the auditor Query and names the entry (number · day · amount)', async () => {
    S.bellFor = 'owner'; await page.reload(); await page.waitForSelector('[data-testid="bell-dot"]', { timeout: 15000 });
    const dot = await txt(T('bell-dot')); await page.click(T('bell-btn')); await page.waitForSelector(T('bell-row'), { timeout: 8000 });
    const row = await txt(T('bell-row')); await shot('06b-owner-bell');
    await page.keyboard.press('Escape');
    return { ok: dot === '1' && /raised a Query on/.test(row) && /JV-0002 · 4 Nov 2026 · .*880/.test(row), saw: 'dot ' + dot + ' · ' + row };
  });
  await w.step('B1b', 'W15-54 · the owner bell row for the Query is NOT disabled: pressing it opens the Query thread sheet on that entry (the same opener as the Day book chip)', async () => {
    if (!(await page.locator(T('bell-row')).isVisible())) await page.click(T('bell-btn')); await page.waitForSelector(T('bell-row'), { timeout: 8000 });
    const off = await page.$eval(T('bell-row'), (b) => b.disabled);
    await page.click(T('bell-row')); await page.waitForSelector(T('mk-sheet'), { timeout: 8000 }); await shot('06c-owner-bell-opens-thread');
    await page.waitForSelector(T('msg-body'), { timeout: 8000 }); const q = await txt(T('mk-question')), title = await txt(T('mk-title'));
    await page.setViewportSize(NARROW); await page.waitForTimeout(400); await shot('06d-owner-bell-thread-phone');
    const fits = await page.evaluate(() => { const d = document.querySelector('dialog.mk-sheet').getBoundingClientRect(); return d.left >= 0 && d.right <= window.innerWidth + 1 && d.bottom <= window.innerHeight + 1 && document.documentElement.scrollWidth <= document.documentElement.clientWidth; }); await page.setViewportSize(WIDE);
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    const byId = S.calls.some((c) => c.p === '/api/marks' && c.q.indexOf('ids=' + E[1]) >= 0) && !S.calls.some((c) => c.p === '/api/marks' && /open=1/.test(c.q) && /from=2026-11-04&to=2026-11-04/.test(c.q)); /* W15-80: the row carries the entry id, so the thread is read BY ID: no look through the open list for a number */
    return { ok: !off && fits && byId && /Why was rent posted/.test(q) && /JV-0002/.test(title), saw: 'disabled ' + off + ' · ' + title + ' · ' + q };
  });
  await w.step('B1c', 'W15-80 · a bell row whose entry is gone (no id, no open question by that number) says WHY in a toast: "reversed or removed", not "try again"', async () => {
    S.ghost = true; await page.reload(); await page.waitForSelector('[data-testid="bell-dot"]', { timeout: 15000 });
    await page.click(T('bell-btn')); await page.waitForSelector(T('bell-row'), { timeout: 8000 }); await page.click(T('bell-row')); await page.waitForTimeout(1200);
    const body = await page.evaluate(() => document.body.innerText); await shot('06e-owner-bell-entry-gone'); S.ghost = false;
    const noSheet = (await page.locator(T('mk-sheet')).count()) === 0;
    await page.keyboard.press('Escape'); await page.reload(); await page.waitForSelector('[data-mark] button[data-mk]', { timeout: 15000 }); /* back to the start state: no toast, no bell list, the chips there for O2 */
    return { ok: /This entry was reversed or removed/.test(body) && !/try again/.test(body) && noSheet, saw: body.indexOf('This entry was') >= 0 ? 'toast shown' : 'no toast' };
  });
  await w.step('O2', 'the owner · the Query chip opens the sheet: the question, no set buttons; he replies in the thread (the one composer) and it posts ONCE', async () => {
    await page.click(chip(1) + ' button[data-mk="open"]'); await page.waitForSelector(T('mk-sheet'), { timeout: 5000 }); await page.waitForSelector(T('msg-body'), { timeout: 8000 });
    const q = await txt(T('mk-question')), setBtns = await page.locator(T('mk-set-clear')).count(), composers = await page.locator('dialog.mk-sheet [data-rt-act="text"]').count();
    const focusInComposer = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid') === 'msg-body');
    await page.fill(T('msg-body'), 'Posted to 4100 because it is a lease.'); await shot('07-owner-sheet-reply');
    await page.press(T('msg-body'), 'Enter'); await page.waitForTimeout(800); /* Enter sends (W15-26) */
    return { ok: focusInComposer && /Why was rent posted/.test(q) && setBtns === 0 && composers === 1 && S.replies.length === 1 && S.replies[0].b.message_text === 'Posted to 4100 because it is a lease.' && !S.replies[0].b.thread_type, saw: q + ' · set buttons ' + setBtns + ' · composers ' + composers + ' · replies ' + S.replies.length };
  });
  await w.step('O3', 'the owner sheet is a chat (W15-26/28): the auditor\'s question on the LEFT, his reply on the RIGHT, name and time on each, newest at the bottom, the list opens on the newest, the reply box pinned under it; Shift+Enter is a new line and sends nothing', async () => {
    await page.waitForSelector('dialog.mk-sheet [data-testid="rt-row"]', { timeout: 8000 });
    const g = await page.evaluate(() => {
      const d = document.querySelector('dialog.mk-sheet'), list = d.querySelector('.rt-list'), comp = d.querySelector('[data-testid="rt-composer"]');
      const bubbles = Array.from(list.querySelectorAll('.rt-m')).map((b) => ({ side: b.getAttribute('data-side'), head: b.querySelector('.rt-h').innerText.replace(/\s+/g, ' ').trim(), top: b.getBoundingClientRect().top, left: b.getBoundingClientRect().left, right: b.getBoundingClientRect().right }));
      const lr = list.getBoundingClientRect(), cr = comp.getBoundingClientRect(), dr = d.getBoundingClientRect();
      return { bubbles, listAboveComposer: lr.bottom <= cr.top + 1, atNewest: list.scrollTop + list.clientHeight >= list.scrollHeight - 2, composerInside: cr.bottom <= dr.bottom + 1, sideways: d.scrollWidth <= d.clientWidth + 1, twice: (d.innerText.match(/cannot be unsent/g) || []).length, actionAbove: !!d.querySelector('[data-testid="rt-above"]') };
    });
    const before = S.replies.length;
    await page.fill(T('msg-body'), 'first line'); await page.press(T('msg-body'), 'Shift+Enter'); await page.keyboard.type('second line');
    const val = await page.inputValue(T('msg-body')), noPost = S.replies.length === before; await shot('07b-owner-chat-sheet');
    await page.fill(T('msg-body'), '');
    const b = g.bubbles;
    return { ok: b.length === 2 && b[0].side === 'theirs' && b[1].side === 'mine' && b[0].top < b[1].top && b[0].left < b[1].left && /Harbour|A\. Auditor/.test(b[0].head) && /\d{1,2}:\d{2}|\d{4}/.test(b[0].head) && /You/.test(b[1].head) && g.listAboveComposer && g.atNewest && g.composerInside && g.sideways && g.twice <= 1 && val === 'first line\nsecond line' && noPost, saw: JSON.stringify(g) + ' · value ' + JSON.stringify(val) + ' · no post ' + noPost };
  });
  await page.keyboard.press('Escape');

  /* ═══ the auditor clears it ═══ */
  await w.step('B2', 'the auditor bell rings for the owner reply and names the entry', async () => {
    S.bellFor = 'auditor'; await page.goto(base + '/network.html'); await page.waitForSelector('[data-testid="bell-dot"]', { timeout: 15000 });
    const dot = await txt(T('bell-dot')); await page.click(T('bell-btn')); await page.waitForSelector(T('bell-row'), { timeout: 8000 });
    const row = await txt(T('bell-row')); await shot('08b-auditor-bell'); await page.keyboard.press('Escape');
    return { ok: dot === '1' && /replied to the Query on/.test(row) && /JV-0002 · 4 Nov 2026 · .*880/.test(row), saw: 'dot ' + dot + ' · ' + row };
  });
  await w.step('A6', 'the auditor · opens the Query: the owner\'s reply is in the thread; Mark checked clears it (one write), the bar says 2 of 3, no open queries', async () => {
    await openDaybook();
    await page.click(chip(1) + ' button[data-mk="open"]'); await page.waitForSelector(T('mk-sheet'), { timeout: 5000 }); await page.waitForSelector('[data-testid="rt-row"]', { timeout: 8000 });
    const thread = await txt(T('mk-thread')), composer = await page.locator(T('msg-body')).count(); await shot('08-auditor-sees-reply');
    const aud = await page.evaluate(() => { const d = document.querySelector('dialog.mk-sheet'), bs = Array.from(d.querySelectorAll('.rt-list .rt-m')).map((b) => b.getAttribute('data-side')), act = d.querySelector('[data-testid="mk-actbar"]'), comp = d.querySelector('[data-testid="rt-composer"]'), list = d.querySelector('.rt-list'); return { bs, above: !!act && !list.contains(act) && act.getBoundingClientRect().bottom <= comp.getBoundingClientRect().top + 1 && act.getBoundingClientRect().top >= list.getBoundingClientRect().bottom - 1 }; });
    await shot('08d-auditor-chat-sheet');
    await page.click(T('mk-set-clear')); await page.waitForSelector(T('mk-sheet'), { state: 'detached', timeout: 8000 }); await page.waitForTimeout(500);
    const bar = await txt(T('mk-count')), f = await txt(T('mk-filter')), c = await txt(chip(1));
    await shot('09-auditor-cleared');
    return { ok: aud.bs.join() === 'mine,theirs' && aud.above && composer === 1 && !/View only/.test(thread) && /lease/.test(thread) && /Checked/.test(c) && /2 of 3/.test(bar) && /All queries · 0/.test(f) && sets().slice(-1)[0].b.kind === 'checked', saw: thread.slice(0, 80) + ' · ' + c + ' · ' + bar + ' · ' + f };
  });
  await w.step('Q2', 'a NEW Query on the same entry: the thread opens clean, the old reply stays behind', async () => {
    await page.click(chip(1) + ' button[data-mk="open"]'); await page.waitForSelector(T('mk-sheet'), { timeout: 5000 });
    await page.fill(T('mk-note'), 'And the GST on it?'); await page.click(T('mk-set-open')); await page.waitForSelector(T('mk-sheet'), { state: 'detached', timeout: 8000 }); await page.waitForTimeout(400);
    await page.click(chip(1) + ' button[data-mk="open"]'); await page.waitForSelector(T('mk-sheet'), { timeout: 5000 }); await page.waitForTimeout(600);
    const quote = await txt(T('mk-question')), thread = await txt(T('mk-thread')), title = await txt(T('mk-title')); await shot('08c-new-query-clean-thread');
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    return { ok: /GST on it/.test(quote) && !/lease/.test(thread) && /^JV-0002 · /.test(title), saw: quote + ' · thread "' + thread.slice(0, 60) + '" · ' + title };
  });
  await w.step('A7', 'the auditor · On hold takes an optional reason; a changed entry reads "Changed after review"', async () => {
    await page.click(chip(2) + ' button[data-mk="ask"]'); await page.waitForSelector(T('mk-sheet'), { timeout: 5000 }); await page.click(T('mk-set-hold')); await page.waitForSelector(T('mk-sheet'), { state: 'detached', timeout: 8000 }); await page.waitForTimeout(300);
    const hold = await txt(chip(2));
    S.marks[E[0]].altered = true; await openDaybook();
    const alt = await txt(chip(0)); await shot('10-changed-after-review');
    return { ok: /On hold/.test(hold) && /Changed after review/.test(alt) && sets().slice(-1)[0].b.kind === 'on_hold', saw: hold + ' · ' + alt };
  });

  /* ═══ the fit and the keyboard ═══ */
  await w.step('F1', '1366×768 · no page scroll, no sideways scroll', async () => { const a = await noScroll(); return { ok: a.y && a.x, saw: 'vertical ' + a.y + ' · sideways ' + a.x }; });
  await w.step('F2', '390×844 · the Day book with chips and the bar, and the sheet, fit: no page scroll, no sideways scroll, the sheet inside the screen', async () => {
    await page.setViewportSize(NARROW); await page.waitForTimeout(400);
    const a = await noScroll(); await shot('11-phone-daybook');
    await page.click(chip(1) + ' button[data-mk="open"]'); await page.waitForSelector(T('mk-sheet'), { timeout: 5000 }); await page.waitForTimeout(400);
    const b = await noScroll(), box = await page.evaluate(() => { const r = document.querySelector('dialog.mk-sheet').getBoundingClientRect(); return { w: r.width <= window.innerWidth + 1, h: r.height <= window.innerHeight + 1 }; });
    await page.waitForSelector('dialog.mk-sheet [data-testid="msg-body"]', { timeout: 8000 }).catch(() => {});
    const full = await page.evaluate(() => { const d = document.querySelector('dialog.mk-sheet').getBoundingClientRect(), c = document.querySelector('dialog.mk-sheet [data-testid="rt-composer"]'), r = c && c.getBoundingClientRect(); return { tall: d.height >= window.innerHeight - 2, composer: !!r && r.bottom <= window.innerHeight + 1 && r.top >= 0 }; });
    await shot('12-phone-sheet'); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    return { ok: a.y && a.x && b.y && b.x && box.w && box.h && full.tall && full.composer, saw: 'full height ' + full.tall + ' · composer on screen ' + full.composer + ' · ' + 'list ' + a.y + '/' + a.x + ' · with sheet ' + b.y + '/' + b.x + ' · sheet inside ' + box.w + '/' + box.h };
  });
  await w.step('K1', 'keyboard only · focus a chip, Enter opens the sheet, Escape closes it and focus returns to the chip', async () => {
    await page.setViewportSize(WIDE); await page.waitForTimeout(300);
    await page.focus(chip(1) + ' button[data-mk="open"]'); await page.keyboard.press('Enter'); await page.waitForSelector(T('mk-sheet'), { timeout: 5000 });
    const inSheet = await page.evaluate(() => !!document.activeElement.closest('dialog.mk-sheet'));
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    const back = await page.evaluate((id) => !!document.activeElement.closest('[data-mark*="' + id + '"]'), E[1]);
    return { ok: inSheet && back, saw: 'focus in the sheet ' + inSheet + ' · back on the chip ' + back };
  });
  await w.step('M1', 'Months: the tab says Months, each month shows its state, the sales as the server sent them, and no month that has not begun', async () => {
    await page.setViewportSize(WIDE); await openDaybook(); await page.click(T('bv-tab-periods')); await page.waitForFunction(() => /November 2026/.test((document.querySelector('[data-testid="bv-list"]') || {}).innerText || ''), null, { timeout: 8000 }).catch(() => {});
    const list = await txt(T('bv-list')); await shot('13-closed-months');
    const tab = await txt(T('bv-tab-periods'));
    return { ok: tab === 'Months' && /Open/.test(list) && list.includes('November 2026') && !list.includes('2099') && !list.includes('January') && list.includes('3,702'), saw: list.slice(0, 160) };
  });
  await w.step('S1', 'two grants on one client: the firm is asked which seat, nothing is picked silently; "Open as auditor" opens read only with no Prepare a journal', async () => {
    S.both = true; await page.goto(base + '/network.html'); await page.waitForSelector(T('nw-books-' + MEMBER), { timeout: 20000 });
    await page.evaluate(() => Object.keys(localStorage).filter((k) => k.indexOf('cb_seat:') === 0).forEach((k) => localStorage.removeItem(k)));   /* the earlier steps opened this client with its one seat, which the page remembers (29714ef3); S1 is the FIRST time two seats exist */
    await page.click(T('nw-books-' + MEMBER)); await page.waitForSelector(T('nw-seat-title'), { timeout: 8000 });
    const asked = await page.locator(T('bv-band')).count(); await shot('14-seat-choice');
    await page.click(T('nw-seat-auditor')); await page.waitForSelector(T('bv-band'), { timeout: 8000 });
    const band = await txt(T('bv-band')), prepare = await page.locator(T('bv-prepare')).count();
    return { ok: asked === 0 && /read only/.test(band) && prepare === 0, saw: 'books before choice ' + asked + ' · ' + band.slice(0, 50) + ' · prepare ' + prepare };
  });
  await w.step('S2', 'the seat is remembered per client: the next Open books goes straight in, no second question', async () => {
    await page.goto(base + '/network.html'); await page.waitForSelector(T('nw-books-' + MEMBER), { timeout: 20000 });
    await page.click(T('nw-books-' + MEMBER)); await page.waitForSelector(T('bv-band'), { timeout: 8000 });
    const asked = await page.locator(T('nw-seat-title')).count();
    return { ok: asked === 0, saw: 'seat questions ' + asked };
  });
  await w.step('X1', 'a write by the owner is refused in the server\'s words (he cannot set a mark)', async () => {
    const r = await page.evaluate(async (a) => { const res = await fetch('/api/marks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adopter: 'acc.audit', subject_id: a, kind: 'checked' }) }); return res.status; }, E[2]);
    return { ok: r === 403, saw: 'status ' + r };
  });
});
