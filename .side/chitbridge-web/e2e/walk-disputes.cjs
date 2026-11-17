#!/usr/bin/env node
/**
 * e2e/walk-disputes.cjs - DISPUTES AND CB ASSIST, WALKED in CB Tasks & Orders (round T3-DISPUTES-ASSIST: tasks.html ?view=disputes · ?view=assist).
 * Black box: it presses what a shopkeeper presses and reads what the screen says.
 *   Disputes   the list (CBList, SERVER-paged: the walk reads the query each control sends - search · Where it is · Side · sort · page), a row
 *              opens the CHIT SHEET with its dispute section; Resolve and Raise are shown always and greyed WITH the server's sentence
 *              (GET /chits/:id/disputes → actions.resolve / actions.raise, per login); every write goes to the route that already does it.
 *   CB Assist  ✨ Draft (POST /governance/ai-draft, skill assist-ask) → Reject (nothing written) · Accept (POST /assist/publish); Publish greyed
 *              with the server's sentence for a shop that is not a help desk (GET /assist/whoami → actions.publish).
 *   Rule 13    each screen (the Disputes list, the sheet's dispute section, CB Assist) in Cream AND Dark at 1366 AND 390 px: AA contrast, no
 *              clipped text, no inner sideways scroll, nothing over a control, no link to app.html, copy in budget (e2e/lib/rule13.cjs).
 * A FIXTURE shop by default: the API is a stand-in inside the page (state in memory), nothing reaches a server. Every answer the stand-in serves
 * for a route in the API contract is held to it (e2e/fixtures/web-api.contract.json, M43).
 *
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-disputes.cjs           the fixture
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-disputes.cjs --real    chitbridge-api as a child on the loader's local Postgres (e2e/lib/real-api.cjs):
 *                                                                        the two sections read the real routes; Publish greyed with the real sentence
 * One line per path: "ID · path · PASS/FAIL (what it saw)". Screenshots: e2e/shots/walk-disputes-NN.png.
 */
'use strict';
const TD = require('./lib/today.cjs');   /* QW1-TODAY: the one injected today (CB_TODAY) — never the runner's clock */
const W = require('./lib/walk.cjs');
const C = require('./lib/contract.cjs');
const J = (r, status, body) => C.json(r, status, body);
const REAL = process.argv.includes('--real');

W.run(REAL ? 'disputes-real' : 'disputes', async (w) => {
  const { page, ctx, base } = w;
  const R13 = require('./lib/rule13.cjs');
  const txt = (sel, scope) => (scope || page).locator(sel).first().innerText().then((s) => s.replace(/\s+/g, ' ').trim()).catch(() => '');
  const settle = (ms) => page.waitForTimeout(ms || 500);
  const open = async (view) => { await page.goto(base + '/tasks.html?view=' + view); await page.waitForSelector(view === 'assist' ? '[data-testid="ca-bar"], [data-testid="ca-fail"]' : '[data-testid="dp-bar"], [data-testid="dp-fail"]', { timeout: 20000 }); await settle(600); };

  if (REAL) {
    const api = await require('./lib/real-api.cjs').start({ origin: base });
    try {
      const token = await api.owner();
      const me = await api.j('/api/entities/me', { token });
      const ent = (me && (me.entity || me.identity)) || {};
      await ctx.addInitScript((o) => { try { localStorage.setItem('cb_api_base', o.b); localStorage.setItem('cb_sess', JSON.stringify({ token: o.t, role: 'owner', name: o.n, entity: o.n })); } catch (_) {} }, { b: api.base, t: token, n: ent.display_name || api.shop });
      await w.step('X1', 'Real api: Disputes reads GET /chits/disputes/queue paged — a count from the server (open · resolved) and the list or its empty words, never a raw error', async () => {
        await open('disputes');
        const bar = await txt('[data-testid="dp-bar"]'), fail = await page.locator('[data-testid="dp-fail"]').count(), list = await txt('[data-testid="dp-list"]');
        return { ok: !fail && /open · \d+ resolved/.test(bar) && !w.errs.length, saw: '"' + bar + '" · list "' + list.slice(0, 90) + '"' + (fail ? ' · FAILED: ' + await txt('[data-testid="dp-fail"]') : '') };
      });
      await w.step('X2', 'Real api: Assist reads the answers and whoami; the shop is not a help desk, so Accept is greyed WITH the server\'s sentence', async () => {
        await open('assist');
        const cnt = await txt('[data-testid="ca-count"]'), dis = await page.$eval('#ca_accept', (b) => b.disabled).catch(() => null), why = await txt('[data-testid="ca_accept-why"]');
        return { ok: /answers? live/.test(cnt) && dis === true && /help desk/.test(why) && !w.errs.length, saw: '"' + cnt + '" · accept ' + (dis ? 'greyed: "' + why + '"' : 'OPEN') };
      });
    } finally { await api.stop(); }
    return;
  }

  /* ── the stand-in: the shop "Fixture Shop" (e-me) and its trading partners; two real disputes + filler so the list pages ── */
  const ME = 'e0000000-0000-4000-8000-000000000001', KS = 'e0000000-0000-4000-8000-000000000002', FF = 'e0000000-0000-4000-8000-000000000003';
  const NAME = { [ME]: 'Fixture Shop', [KS]: 'Kumar Stores', [FF]: 'Fresh Farms' };
  const SAY = { read_only: 'Your access is view-only. You can read this chit but not change it.', not_raiser: 'Only the business that raised this dispute can resolve it.',
    already_resolved: 'This dispute is already resolved.', not_helpdesk: 'Only a help desk can publish to its catalogue.' };
  const S = { calls: [], queries: [], level: 'editor', queueFails: false, helpdesk: false, ai: 'ok', disputes: [], answers: [] };
  const iso = (d) => new Date(Date.UTC(2026, 9, d, 9)).toISOString();
  const disp = (id, chit, o) => Object.assign({ dispute_id: id, chit_id: chit, category: 'quality', reason: '', status: 'open', created_at: iso(10), raised_by_entity_id: ME,
    raised_by_display_name: NAME[ME], roster: [{ entity_id: ME, display_name: NAME[ME], role: 'raiser' }, { entity_id: KS, display_name: NAME[KS], role: 'party' }], resolution_note: null,
    auto_subject: 'Order SO-7', purpose: 'order', party_status: {} }, o);
  const seed = () => {
    S.disputes = [
      disp('d1', 'c1', { category: 'quality', reason: 'Brake pads arrived cracked, 4 of 10', created_at: iso(2), auto_subject: 'Order SO-7' }),
      disp('d2', 'c2', { category: 'delivery', reason: 'Rice came two days after the promised day', created_at: iso(3), auto_subject: 'Purchase PO-3', raised_by_entity_id: FF, raised_by_display_name: NAME[FF],
        roster: [{ entity_id: FF, display_name: NAME[FF], role: 'raiser' }, { entity_id: ME, display_name: NAME[ME], role: 'party' }] }),
      disp('d3', 'c3', { category: 'payment', reason: 'Paid twice for the same bill', status: 'resolved', resolution_note: 'Refunded by bank transfer', created_at: iso(1), auto_subject: 'Bill B-11' }),
    ];
    for (let i = 0; i < 50; i++) S.disputes.push(disp('f' + i, 'cf' + i, { category: 'quantity', reason: 'Short by ' + (i + 1) + ' cartons', created_at: new Date(Date.UTC(2026, 9, 4, 9, i)).toISOString(), auto_subject: 'Order SO-' + (100 + i),
      raised_by_entity_id: FF, raised_by_display_name: NAME[FF], roster: [{ entity_id: FF, display_name: NAME[FF], role: 'raiser' }, { entity_id: ME, display_name: NAME[ME], role: 'party' }] }));
    S.answers = [{ id: 'q1', q: 'How do I print a bill again?', a: 'Open Today\'s bills on the till and press Print.', topics: [], context: ['till'], fit: null, media: null },
      { id: 'q2', q: 'How do I add a product?', a: 'CB Catalogue, then Add product.', topics: [], context: ['*'], fit: null, media: null }];
  };
  seed();
  const can = (lv) => lv === 'viewer' ? { ok: false, why: 'read_only', say: SAY.read_only } : { ok: true };
  /** one dispute row as the api's finishDisputes answers it: participants (live status) · others · mine · actions.resolve (lib/dispute-may) */
  const out = (d) => {
    const parts = d.roster.map((p) => ({ dispute_id: d.dispute_id, entity_id: p.entity_id, display_name: p.display_name, role: p.role, dispute_status: d.party_status[p.entity_id] || (d.status === 'open' ? 'open' : 'resolved') }));
    const mine = d.raised_by_entity_id === ME, lvl = can(S.level);
    const resolve = !lvl.ok ? lvl : d.status !== 'open' ? { ok: false, why: 'already_resolved', say: SAY.already_resolved } : !mine ? { ok: false, why: 'not_raiser', say: SAY.not_raiser } : { ok: true };
    const { roster, party_status, ...rest } = d;
    return Object.assign({}, rest, { has_evidence: true, participants: parts, others: parts.filter((p) => p.entity_id !== ME), mine, actions: { resolve } });
  };

  await ctx.route('**/api/**', async (r) => {
    const q = r.request(), u = new URL(q.url()), m = q.method(), p = u.pathname;
    let body = null; try { body = q.postData() ? JSON.parse(q.postData()) : null; } catch (_) {}
    if (m !== 'GET') S.calls.push(m + ' ' + p + (body ? ' ' + JSON.stringify(body) : ''));
    if (p === '/api/entities/me') return J(r, 200, { entity: { display_name: 'Fixture Shop', currency_code: 'INR' } });
    if (p === '/api/entities/header') return J(r, 200, { business: { display_name: 'Fixture Shop', bridge_id: 'CBWALK0001' }, licences: [], trade_ready: true });
    if (p === '/api/facts/rail') return J(r, 200, { suppliers: 1, customers: 3, in: 2, out: 1, stuck: 0 });
    if (p === '/api/chits/disputes/queue') {
      const sp = u.searchParams; S.queries.push(sp.toString());
      if (S.queueFails) return J(r, 500, { error: 'Get dispute queue failed', message: 'boom' });
      const st = sp.get('status') || 'open', side = sp.get('side'), words = (sp.get('q') || '').toLowerCase(), lim = Number(sp.get('limit')) || 0, pg = Number(sp.get('page')) || 1;
      let rows = S.disputes.filter((d) => st === 'all' || (st === 'open' ? d.status === 'open' : d.status !== 'open'))
        .filter((d) => !side || (side === 'mine' ? d.raised_by_entity_id === ME : d.raised_by_entity_id !== ME))
        .filter((d) => !words || [d.auto_subject, d.category, d.reason, d.raised_by_display_name, d.resolution_note].join(' ').toLowerCase().indexOf(words) >= 0);
      rows.sort((a, b) => (a.created_at < b.created_at ? -1 : 1) * (sp.get('sort') === 'new' ? -1 : 1));
      const total = rows.length; rows = lim ? rows.slice((pg - 1) * lim, pg * lim) : rows; rows = rows.map(out);
      const open = S.disputes.filter((d) => d.status === 'open').length;
      return J(r, 200, { disputes: rows, my_disputes: rows.filter((d) => d.mine), other_disputes: rows.filter((d) => !d.mine), total_open: open,
        rows, total, page: pg, limit: lim || total, counts: { open, resolved: S.disputes.length - open } });
    }
    let mm = /^\/api\/chits\/([^/]+)\/disputes$/.exec(p);
    if (mm && m === 'GET') {
      const ds = S.disputes.filter((d) => d.chit_id === mm[1]).map(out);
      return J(r, 200, { disputes: ds, open_count: ds.filter((d) => d.status === 'open').length, raise_parties: [{ entity_id: KS, display_name: NAME[KS], role: 'receiver' }, { entity_id: FF, display_name: NAME[FF], role: 'cc' }],
        actions: { raise: can(S.level) } });
    }
    if (mm && m === 'POST') {
      if (S.level === 'viewer') return J(r, 403, { error: 'Not permitted', message: SAY.read_only, why: 'read_only' });
      const id = 'n' + S.disputes.length, parties = body.participant_entity_ids || [];
      S.disputes.push(disp(id, mm[1], { category: body.category, reason: body.reason, created_at: TD.nowIso(),
        roster: [{ entity_id: ME, display_name: NAME[ME], role: 'raiser' }].concat(parties.map((e) => ({ entity_id: e, display_name: NAME[e], role: 'party' }))) }));
      return J(r, 200, { dispute_id: id, category: body.category, reason: body.reason, status: 'open', warning: null, scope: parties.length ? 'targeted' : 'chit_wide', message: 'Dispute raised' });
    }
    mm = /^\/api\/chits\/([^/]+)\/disputes\/([^/]+)\/resolve$/.exec(p);
    if (mm && m === 'PUT') {
      const d = S.disputes.find((x) => x.dispute_id === mm[2]); if (!d) return J(r, 404, { error: 'Dispute not found' });
      const v = out(d).actions.resolve;
      if (!v.ok) return J(r, v.why === 'already_resolved' ? 400 : 403, { error: 'Forbidden', message: v.say, why: v.why });
      d.status = 'resolved'; d.resolution_note = body.resolution_note;
      return J(r, 200, { dispute_id: d.dispute_id, status: 'resolved', resolved_parties: [KS], fully_resolved: true, resolution_note: body.resolution_note, message: 'Dispute fully resolved' });
    }
    mm = /^\/api\/chits\/([^/]+)\/messages$/.exec(p);
    if (mm && m === 'GET') return J(r, 200, { messages: [{ message_id: 'm1', chit_id: mm[1], thread_type: 'external', message_text: '[quality] Brake pads arrived cracked, 4 of 10', is_dispute: true, dispute_id: 'd1', sender_display_name: NAME[ME], sender_entity_id: ME, created_at: iso(2) }], count: 1 });
    if (mm && m === 'POST') return J(r, 200, { message_id: 'm2', thread_type: 'external', message_text: body.message_text, sender_display_name: 'You', created_at: TD.nowIso() });
    mm = /^\/api\/chits\/([^/]+)$/.exec(p);
    if (mm && m === 'GET') {
      const d = S.disputes.find((x) => x.chit_id === mm[1]) || {};
      return J(r, 200, { header: { chit_id: mm[1], purpose: 'order', auto_subject: d.auto_subject || 'Order', current_status: 'accepted', created_at: iso(1), summary_json: {}, business_json: {},
        all_recipients: [{ entity_id: ME, display_name: NAME[ME], role: 'sender' }, { entity_id: KS, display_name: NAME[KS], role: 'receiver' }] }, detail: { line_items: [] }, state_log: [],
        actions: { message_external: can(S.level), message_internal: { ok: true } } });
    }
    if (p === '/api/assist/whoami') return J(r, 200, { ok: true, is_helpdesk: S.helpdesk, actions: { publish: S.helpdesk ? { ok: true } : { ok: false, why: 'not_helpdesk', say: SAY.not_helpdesk } } });
    if (p === '/api/assist/questions') return J(r, 200, { ok: true, data: S.answers });
    if (p === '/api/governance/ai-draft' && m === 'POST') {
      if (S.ai === 'off') return J(r, 503, { error: 'AI not connected — set ANTHROPIC_API_KEY.' });
      return J(r, 200, { ok: true, skill_id: body.skill_id, draft: 'Open Settings, then Your shop, and change the address there.', usage: { est_cost_usd: 0.001 } });
    }
    if (p === '/api/assist/publish' && m === 'POST') {
      if (!S.helpdesk) return J(r, 403, { ok: false, error: SAY.not_helpdesk, why: 'not_helpdesk' });
      if (body.qa_id) { const a = S.answers.find((x) => x.id === body.qa_id); if (a) Object.assign(a, { q: body.question, a: body.answer, context: body.context }); return J(r, 200, { ok: true, qa_id: body.qa_id, updated: true }); }
      S.answers.push({ id: 'p' + S.answers.length, q: body.question, a: body.answer, topics: [], context: body.context, fit: null, media: null });
      return J(r, 200, { ok: true, qa_id: 'p' + (S.answers.length - 1) });
    }
    if (p === '/api/work/list') return J(r, 200, { view: 'orders_in', page: 1, limit: 100, truncated: false, counts: { orders_in: 0, orders_out: 0, tasks: 0, done: 0 }, total: 0, rows: [] });
    if (p === '/api/facts/rail/chits') return J(r, 200, { overdue_days: 2, truncated: false, items: [] });
    return J(r, 404, { error: 'not found' });
  });
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Fixture Owner', 'Fixture Shop'));

  const rows = () => page.locator('[data-testid^="dp-row-"]').count();
  const lastQ = () => S.queries[S.queries.length - 1] || '';
  const wrote = (re) => S.calls.filter((c) => re.test(c)).length;
  const greyed = (id) => page.$eval('#' + id, (b) => b.disabled).catch(() => null);
  const openRow = async (id) => { await page.click('[data-testid="dp-row-' + id + '"]'); await page.waitForSelector('[data-testid="dp-one-' + id + '"]', { timeout: 8000 }); await settle(300); };
  const closeSheet = async () => { await page.click('[data-testid="cs-close"]').catch(() => {}); await settle(250); };
  const filter = async (key, v) => {
    if (!(await page.locator('[data-testid="listctl-filter-' + key + '"]').count())) { await page.click('[data-testid="cbl-filters-disputes"]'); await settle(200); }
    await page.selectOption('[data-testid="listctl-filter-' + key + '"]', v); await settle(600);
  };

  await open('disputes');

  await w.step('D1', 'Tasks & Orders ?view=disputes -> the sidebar holds the folders AND Disputes · CB Assist; Disputes is lit; the bar says 52 open · 1 resolved (the server\'s counts); the open ones, oldest first, 50 a page; the five controls are there', async () => {
    const nav = await page.$$eval('[data-testid^="skel-nav-"]', (bs) => bs.map((b) => b.getAttribute('data-sec') + (b.classList.contains('active') ? '*' : '')));
    const bar = await txt('[data-testid="dp-bar"]'), n = await rows(), first = await page.locator('[data-testid^="dp-row-"]').first().getAttribute('data-testid');
    const ctl = { search: await page.locator('[data-testid="listctl-search-disputes"]').count(), filters: await page.locator('[data-testid="cbl-filters-disputes"]').count(), pager: await page.locator('[data-testid="dp-pager"]').count(), count: await txt('[data-testid="disputes-count"]') };
    const q = lastQ();
    return { ok: nav.indexOf('disputes*') >= 0 && nav.indexOf('assist') >= 0 && /52\s*open · 1 resolved/.test(bar) && n === 50 && first === 'dp-row-d1' && ctl.search && ctl.filters && ctl.pager && /50 shown of 52/.test(ctl.count)
        && /status=open/.test(q) && /page=1/.test(q) && /limit=50/.test(q) && /sort=old/.test(q) && !w.errs.length,
      saw: nav.join(' ') + ' · "' + bar + '" · ' + n + ' rows, first ' + first + ' · count "' + ctl.count + '" · pager ' + ctl.pager + ' · asked ' + q + (w.errs.length ? ' · ERRORS ' + w.errs.join(' | ') : '') };
  });
  await w.step('D2', 'Page 2 (›) -> the server is asked page=2 and answers the last 2; ‹ Back returns to page 1', async () => {
    await page.click('[data-testid="dp-next"]'); await settle(600);
    const q2 = lastQ(), n2 = await rows(), lbl = await txt('[data-testid="dp-page"]');
    await page.click('[data-testid="dp-prev"]'); await settle(600);
    return { ok: /page=2/.test(q2) && n2 === 2 && /Page 2 of 2/.test(lbl) && /page=1/.test(lastQ()) && (await rows()) === 50, saw: 'asked ' + q2 + ' -> ' + n2 + ' rows, "' + lbl + '"; back: ' + lastQ() };
  });
  await w.step('D3', 'Search "cracked" -> the SERVER searches (q=cracked), one row: Order SO-7, Quality, with Kumar Stores', async () => {
    await page.fill('[data-testid="listctl-search-disputes"]', 'cracked'); await settle(900);
    const q = lastQ(), n = await rows(), list = await txt('[data-testid="dp-list"]');
    await page.fill('[data-testid="listctl-search-disputes"]', ''); await settle(900);
    return { ok: /q=cracked/.test(q) && n === 1 && /SO-7/.test(list) && /Kumar Stores/.test(list), saw: 'asked ' + q + ' -> ' + n + ' row(s): ' + list.slice(0, 120) };
  });
  await w.step('D4', 'Filters -> Where it is: Resolved -> the server is asked status=resolved; the paid-twice one, Resolved; then Side: Against you with Open and resolved -> 51 against', async () => {
    await filter('status', 'resolved');
    const q = lastQ(), n = await rows(), word = await txt('[data-testid="dp-word-d3"]');
    await filter('status', ''); await filter('side', 'against');
    const q2 = lastQ(), cnt = await txt('[data-testid="disputes-count"]');
    await filter('side', ''); await filter('status', 'open');
    /* a popover closes on Escape and on a click outside it (WAI-ARIA APG); the walk leaves none open over the rows it clicks next (CI fonts put it over the row centre) */
    const open1 = await page.locator('.cbl-pop').count();
    await page.keyboard.press('Escape'); await settle(150);
    const afterEsc = await page.locator('.cbl-pop').count();
    await page.click('[data-testid="cbl-filters-disputes"]'); await settle(150);
    const reopened = await page.locator('.cbl-pop').count();
    await page.click('[data-testid="dp-bar"]'); await settle(150);
    const afterOutside = await page.locator('.cbl-pop').count();
    const popOk = open1 === 1 && afterEsc === 0 && reopened === 1 && afterOutside === 0;
    return { ok: popOk && /status=resolved/.test(q) && n === 1 && word === 'Resolved' && /status=all/.test(q2) && /side=against/.test(q2) && /of 51/.test(cnt), saw: 'asked ' + q + ' -> ' + n + ' "' + word + '" · then ' + q2 + ' -> "' + cnt + '" · popover open/Esc/reopen/outside: ' + [open1, afterEsc, reopened, afterOutside].join('/') };
  });
  await w.step('D5', 'Click SO-7 (raised by me) -> the CHIT SHEET opens with its dispute section: Quality · Open · with Kumar Stores · the reason; Resolve open; the room is open with the dispute\'s own message', async () => {
    await openRow('d1');
    const sheet = await page.locator('#chitsheet[open]').count(), one = await txt('[data-testid="dp-one-d1"]'), res = await greyed('dp_res_d1');
    await page.waitForSelector('[data-testid="dp-room-d1"] [data-testid="rt-row"]', { timeout: 6000 }).catch(() => {});
    const room = await txt('[data-testid="dp-room-d1"]');
    return { ok: sheet === 1 && /Quality/.test(one) && /Open/.test(one) && /Kumar Stores/.test(one) && /cracked/.test(one) && res === false && /Brake pads/.test(room), saw: 'sheet ' + sheet + ' · "' + one.slice(0, 120) + '" · resolve ' + (res ? 'greyed' : 'open') + ' · room "' + room.slice(0, 220) + '"' };
  });
  await w.step('D6', 'Resolve -> it asks how it was settled; nothing typed sends nothing; a note -> ONE PUT …/disputes/d1/resolve { resolution_note } -> "Resolved." and the section reads Resolved, Resolve greyed "already resolved"', async () => {
    await page.click('#dp_res_d1'); await page.waitForSelector('[data-testid="dp-rnote"]', { timeout: 5000 });
    await page.click('[data-testid="dp-rgo"]'); await settle(250);
    const asked = await txt('[data-testid="dp-out"]'), before = wrote(/resolve/);
    await page.fill('[data-testid="dp-rnote"]', 'Credit note CN-21 sent for 4 pads'); await page.click('[data-testid="dp-rgo"]'); await settle(1000);
    const said = await txt('[data-testid="dp-out"]'), word = await txt('[data-testid="dp-one-d1"] [data-testid="dp-word-d1"]'), res = await greyed('dp_res_d1'), why = await txt('[data-testid="dp_res_d1-why"]');
    return { ok: /how it was settled/.test(asked) && before === 0 && wrote(/PUT \/api\/chits\/c1\/disputes\/d1\/resolve \{"resolution_note":"Credit note CN-21 sent for 4 pads"\}/) === 1 && /Resolved\./.test(said) && word === 'Resolved' && res === true && /already resolved/.test(why),
      saw: 'empty: "' + asked + '" (' + before + ' sent) · "' + said + '" · ' + word + ' · resolve ' + (res ? 'greyed "' + why + '"' : 'OPEN') };
  });
  await R13.rule13(w, 'D7', 'the chit sheet with its dispute section', 'chitsheet');
  await page.setViewportSize({ width: 1366, height: 900 }); await page.evaluate(() => CBAvatar.applyTheme('cream'));
  await w.step('D8', 'Raise from the sheet: ⚑ Raise a dispute -> the form (kind · what happened · which parties); a short reason sends nothing; a reason + Kumar Stores ticked -> POST /chits/c1/disputes { category, reason, participant_entity_ids } -> "Dispute raised."', async () => {
    await page.click('#dp_raise'); await page.waitForSelector('[data-testid="dp-raise-form"]', { timeout: 5000 });
    await page.selectOption('[data-testid="dp-cat"]', 'quantity'); await page.fill('[data-testid="dp-reason"]', 'short'); await page.click('[data-testid="dp-raise-go"]'); await settle(250);
    const asked = await txt('[data-testid="dp-out"]'), before = wrote(/POST \/api\/chits\/c1\/disputes/);
    await page.fill('[data-testid="dp-reason"]', 'Two cartons of pads missing from the box'); await page.check('[data-testid="dp-party-0"]'); await page.click('[data-testid="dp-raise-go"]'); await settle(1000);
    const said = await txt('[data-testid="dp-out"]'), call = S.calls.filter((c) => /POST \/api\/chits\/c1\/disputes/.test(c)).pop() || '', n = await page.locator('[data-testid^="dp-one-"]').count();
    return { ok: /at least 10/.test(asked) && before === 0 && /"category":"quantity"/.test(call) && /"participant_entity_ids":\["e0000000-0000-4000-8000-000000000002"\]/.test(call) && /Dispute raised\./.test(said) && n === 2,
      saw: 'short: "' + asked + '" (' + before + ' sent) · ' + call.slice(0, 160) + ' · "' + said + '" · ' + n + ' disputes on the chit' };
  });
  await closeSheet();
  await w.step('D9', 'Against me: Purchase PO-3 (Fresh Farms raised it) -> Resolve shown, greyed WITH "Only the business that raised…"; pressing it sends nothing', async () => {
    await openRow('d2');
    const dis = await greyed('dp_res_d2'), why = await txt('[data-testid="dp_res_d2-why"]'), before = wrote(/resolve/);
    await page.click('#dp_res_d2', { force: true, timeout: 2000 }).catch(() => {}); await settle(300);
    await closeSheet();
    return { ok: dis === true && /Only the business that raised/.test(why) && wrote(/resolve/) === before, saw: 'resolve ' + (dis ? 'greyed: "' + why + '"' : 'OPEN') + ' · writes ' + (wrote(/resolve/) - before) };
  });
  await w.step('D10', 'A view-only login -> Raise and Resolve greyed WITH the rail\'s sentence; nothing is written', async () => {
    S.level = 'viewer'; S.calls = [];
    await open('disputes'); await openRow('f0');
    const r1 = await greyed('dp_raise'), r2 = await greyed('dp_res_f0'), why = await txt('[data-testid="dp_raise-why"]');
    await page.click('#dp_raise', { force: true, timeout: 2000 }).catch(() => {}); await settle(300);
    S.level = 'editor'; await closeSheet();
    const writes = S.calls.filter((c) => /disputes|resolve/.test(c));
    return { ok: r1 === true && r2 === true && /view-only/.test(why) && writes.length === 0, saw: 'raise ' + (r1 ? 'greyed' : 'OPEN') + ' · resolve ' + (r2 ? 'greyed' : 'OPEN') + ' · "' + why + '" · dispute writes: ' + (writes.join(' | ') || 'none') };
  });
  await w.step('D11', 'The queue cannot be read -> a sentence in words and Try again, never "nothing here"; Try again reads it', async () => {
    S.queueFails = true; await open('disputes');
    const t = await txt('[data-testid="dp-fail"]'); S.queueFails = false;
    await page.click('[data-testid="dp-retry"]'); await page.waitForSelector('[data-testid^="dp-row-"]', { timeout: 8000 }).catch(() => {});
    return { ok: /Couldn't read the disputes/.test(t) && /Try again/.test(t) && (await rows()) > 0, saw: '"' + t.slice(0, 100) + '" · after Try again ' + (await rows()) + ' rows' };
  });
  await R13.rule13(w, 'D12', 'the Disputes list', 'dp');
  await page.setViewportSize({ width: 1366, height: 900 }); await page.evaluate(() => CBAvatar.applyTheme('cream'));

  /* ── CB Assist ── */
  await open('assist');
  await w.step('A1', 'Sidebar -> Assist: "2 answers live", the review box, the answers in a CBList; this shop is not a help desk, so Accept is shown greyed WITH the server\'s sentence', async () => {
    const cnt = await txt('[data-testid="ca-count"]'), n = await page.locator('[data-testid^="ca-row-"]').count(), dis = await greyed('ca_accept'), why = await txt('[data-testid="ca_accept-why"]'), lit = await page.$eval('[data-testid="skel-nav-assist"]', (b) => b.classList.contains('active'));
    return { ok: /2\s*answers live/.test(cnt) && n === 2 && dis === true && /Only a help desk/.test(why) && lit, saw: '"' + cnt + '" · ' + n + ' rows · accept ' + (dis ? 'greyed: "' + why + '"' : 'OPEN') };
  });
  S.helpdesk = true; await open('assist');
  await w.step('A2', 'As the help desk: a question -> ✨ Draft -> ONE POST /governance/ai-draft { skill_id: assist-ask, context.question } -> the answer box holds the draft, marked "Assist drafted this"', async () => {
    await page.fill('[data-testid="ca-q"]', 'How do I change my shop address?'); await page.click('[data-testid="ca-draft"]'); await settle(900);
    const a = await page.inputValue('[data-testid="ca-a"]'), mark = await txt('[data-testid="ca-drafted"]'), call = S.calls.find((c) => /ai-draft/.test(c)) || '';
    return { ok: /"skill_id":"assist-ask"/.test(call) && /shop address/.test(call) && /Your shop/.test(a) && /drafted this/.test(mark), saw: call.slice(0, 120) + ' · draft "' + a.slice(0, 60) + '" · "' + mark + '"' };
  });
  await w.step('A3', 'Reject -> the draft is thrown away, nothing is published', async () => {
    await page.click('[data-testid="ca-reject"]'); await settle(300);
    const a = await page.inputValue('[data-testid="ca-a"]'), said = await txt('[data-testid="ca-out"]');
    return { ok: a === '' && /Nothing was published/.test(said) && wrote(/assist\/publish/) === 0, saw: 'answer box "' + a + '" · "' + said + '" · publishes ' + wrote(/assist\/publish/) };
  });
  await w.step('A4', 'Draft again -> Accept and publish -> ONE POST /assist/publish { question, answer, context } -> "Published." and the list says 3 answers', async () => {
    await page.fill('[data-testid="ca-q"]', 'How do I change my shop address?'); await page.click('[data-testid="ca-draft"]'); await settle(800);
    await page.click('#ca_accept'); await settle(1000);
    const said = await txt('[data-testid="ca-out"]'), call = S.calls.filter((c) => /assist\/publish/.test(c)).pop() || '', n = await page.locator('[data-testid^="ca-row-"]').count();
    return { ok: /Published\./.test(said) && /"question":"How do I change my shop address\?"/.test(call) && /"context":\["\*"\]/.test(call) && !/qa_id/.test(call) && n === 3, saw: '"' + said + '" · ' + call.slice(0, 140) + ' · ' + n + ' rows' };
  });
  await w.step('A5', 'Open an answer from the list -> it fills the review box to refine; Accept -> the SAME publish with its qa_id -> "Updated."', async () => {
    await page.click('[data-testid="ca-row-q1"]'); await settle(300);
    const q = await page.inputValue('[data-testid="ca-q"]');
    await page.fill('[data-testid="ca-a"]', 'Open Today\'s bills on the till, pick the bill, press Print.'); await page.click('#ca_accept'); await settle(1000);
    const said = await txt('[data-testid="ca-out"]'), call = S.calls.filter((c) => /assist\/publish/.test(c)).pop() || '';
    return { ok: /print a bill again/.test(q) && /"qa_id":"q1"/.test(call) && /Updated\./.test(said), saw: 'opened "' + q + '" · ' + call.slice(0, 120) + ' · "' + said + '"' };
  });
  await w.step('A6', 'Assist not connected on the server (503) -> said in words: write the answer yourself', async () => {
    S.ai = 'off'; await page.fill('[data-testid="ca-q"]', 'Where are my reports?'); await page.click('[data-testid="ca-draft"]'); await settle(800);
    const said = await txt('[data-testid="ca-out"]'); S.ai = 'ok';
    return { ok: /not connected on this server/.test(said), saw: '"' + said + '"' };
  });
  await R13.rule13(w, 'A7', 'Assist', 'ca');
  await page.setViewportSize({ width: 1366, height: 900 }); await page.evaluate(() => CBAvatar.applyTheme('cream'));

  await w.step('Z1', 'Every answer the stand-in served for a route in the API contract matches it, and the page threw no error', async () => {
    const [ok, msg] = C.finish();
    return { ok: ok && !w.errs.length, saw: msg + (w.errs.length ? ' · PAGE ERRORS: ' + w.errs.slice(0, 3).join(' | ') : '') };
  });
});
