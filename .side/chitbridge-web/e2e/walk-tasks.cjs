#!/usr/bin/env node
/**
 * e2e/walk-tasks.cjs - TASKS & ORDERS, WALKED: the standalone app (round TO1-UI: tasks.html + app/cap-tasks.js, and tasks.html?embed=1 as a frame).
 * Black box: it presses what a shopkeeper presses - the folders, the search, a row, Accept, a line's Assign / Done / Deliver, Assign for the whole
 * order, Reject (asks why), Cancel (asks first), the frame inside a host page - and reads what the screen says. Which step is open is the SERVER's
 * answer (GET /api/work/:id -> actions.<step> { ok, why, say }), so the stand-in answers it per login: a refused step must show greyed WITH its
 * sentence, and no write may leave the page for it. Every write goes to the route that already does the work (PUT /chits/:id/status = the ONE
 * status writer; POST assign-lines; POST deliver-lines; PUT /actors/assign/:id) - the walk counts them.
 * A FIXTURE shop ("Fixture Shop" / CBWALK0001): the site is served from this checkout, the API is a stand-in answering inside the page (state kept
 * in memory), so nothing reaches localhost:3000 or the live site and nothing is written anywhere. Every /api/work answer the stand-in serves is held
 * to the API contract (e2e/fixtures/web-api.contract.json, M43) - the last step is that verdict.
 *
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-tasks.cjs       headless, fast
 *   node e2e/walk-tasks.cjs --show                                 watch it: headed, a caption per step, a results page that stays open
 * One line per path: "ID · path · PASS/FAIL (what it saw)". Screenshots: e2e/shots/walk-tasks-NN.png.
 */
'use strict';
const TD = require('./lib/today.cjs');
const W = require('./lib/walk.cjs');
const C = require('./lib/contract.cjs');   /* M43: every /api/work answer this stand-in serves is held to the API contract */
const J = (r, status, body) => C.json(r, status, body);
const crmApi = require('./lib/crm-api.cjs');   /* RAIL-LAB-SRV1: the rail card (GET /api/facts/rail) from its one builder */

W.run('tasks', async (w) => {
  const { page, ctx, base } = w;

  /* ── the stand-in server: three orders, a task, a closed one; the people to pick from; the login's level decides every verdict ── */
  const SAY = { read_only: 'Your access is view-only. You can read this chit but not change it.', wrong_step: 'This chit cannot move to that step from where it is now.',
    already_done: 'This chit is already at that step.' };
  const PEOPLE = [
    { id: 'p1', name: 'Asha Kumar', state: 'on' }, { id: 'p2', name: 'Ravi Nair', state: 'on' }, { id: 'p3', name: 'Meena Iyer', state: 'off' },
  ];
  const S = { calls: [], level: 'editor', listDenied: false, rows: [] };
  const line = (id, what, qty, unit, price, delivered, who) => ({ line_id: id, particulars: what, qty, unit, price_minor: price, delivered, removed: false,
    assignment: who ? { assignee_actor_id: who.id, assignee_name: who.name, assignee_type: 'human', history: [] } : null, settings: { due: null, task: null, note: null, state: 'open' } });
  const row = (id, o) => Object.assign({ chit_id: id, kind: 'order_in', side: 'sell', status: 'pending', subject: 'Order', ref: null, party: null, party_id: null, channel: null, fulfilment: null,
    address: null, requested_for: null, remark: null, total_minor: null, currency: 'INR', billed: false, despatched: false, assignee: null, created_at: new Date(TD.nowMs() - 2 * 3600e3).toISOString(), age_days: 0, lines: [] }, o);
  const seed = () => {
    S.rows = [
      row('c1', { subject: 'Order SO-1', ref: 'SO-1', party: 'Meena', party_id: 'cust-1', channel: 'online', fulfilment: 'pickup', requested_for: '2026-10-13', remark: 'Ring first', total_minor: 120050,
        lines: [line('l1', 'Tomato', 5, 'kg', 10000, 0, null), line('l2', 'Onion', 3, 'kg', 23350, 1, { id: 'p1', name: 'Asha Kumar' })] }),
      row('c2', { subject: 'Order SO-2', ref: 'SO-2', party: 'Kumar Stores', party_id: 'cust-2', status: 'accepted', total_minor: 48000, assignee: { id: 'p1', name: 'Asha Kumar' }, age_days: 3,
        channel: 'online', fulfilment: 'delivery', address: '12 Mint Street, Chennai', billed: true, lines: [line('l3', 'Rice 25 kg bag', 2, 'bag', 24000, 0, null)] }),
      /* TO1b: an accepted delivery order, not billed yet - the one the frame's Bill it hands to the till */
      row('c4', { subject: 'Order SO-4', ref: 'SO-4', party: 'Priya', party_id: 'cust-4', status: 'accepted', channel: 'online', fulfilment: 'delivery', address: '7 Beach Road, Chennai', requested_for: '2026-10-14', total_minor: 25000,
        lines: [line('l5', 'Milk', 5, 'l', 5000, 0, null)] }),
      row('c3', { kind: 'order_out', side: 'buy', subject: 'Purchase to Fresh Farms', party: 'Fresh Farms', party_id: 'sup-1', status: 'accepted', total_minor: 900000, age_days: 1,
        lines: [line('l4', 'Potato', 100, 'kg', 9000, 40, null)] }),
      row('t1', { kind: 'task', side: null, subject: 'Clean the cold room', party: 'Fixture Shop', assignee: { id: 'p2', name: 'Ravi Nair' }, age_days: 1 }),
      row('d1', { subject: 'Order SO-0', ref: 'SO-0', party: 'Lakshmi', party_id: 'cust-3', status: 'rejected', total_minor: 5000, age_days: 9 }),
    ];
  };
  const CLOSED = ['completed', 'rejected', 'cancelled'];
  const open = (r) => r.lines.filter((l) => l.qty - l.delivered > 0).length;
  const stage = (r) => CLOSED.includes(r.status) ? 'closed' : ['pending', 'delivered', 'read'].includes(r.status) ? 'new' : (r.lines.length && !open(r) ? 'delivered' : 'accepted');
  const WORD = { new: { order_in: 'New', order_out: 'Sent', task: 'New' }, accepted: { order_in: 'Accepted', order_out: 'Accepted', task: 'Started' }, delivered: { order_in: 'Delivered', order_out: 'Received', task: 'Done, to close' }, closed: { order_in: 'Closed', order_out: 'Closed', task: 'Done' } };
  const word = (r) => r.status === 'rejected' ? 'Rejected' : r.status === 'cancelled' ? 'Cancelled' : WORD[stage(r)][r.kind];
  const tab = (r) => stage(r) === 'closed' ? 'done' : r.kind === 'order_in' ? 'orders_in' : r.kind === 'order_out' ? 'orders_out' : 'tasks';
  const no = (why) => ({ ok: false, why, say: SAY[why] });
  /** the verdicts the real server would give (lib/workflow over lib/rail): a viewer may do nothing; a step already taken is already_done */
  const verdicts = (r) => {
    if (S.level === 'viewer') return { accept: no('read_only'), reject: no('read_only'), complete: no('read_only'), cancel: no('read_only'), reopen: no('read_only'), assign_task: no('read_only'), assign_line: no('read_only'), deliver_line: no('read_only'), amend: no('read_only') };
    const closed = CLOSED.includes(r.status), need = open(r) ? { needs: ['reason'] } : {};
    return {
      accept: closed ? no('wrong_step') : r.status === 'accepted' ? no('already_done') : { ok: true },
      reject: closed ? no('wrong_step') : { ok: true, needs: ['reason'] },
      complete: closed ? no('wrong_step') : Object.assign({ ok: true }, need),
      cancel: closed ? no('wrong_step') : { ok: true },
      reopen: closed ? { ok: true } : no('wrong_step'),
      assign_task: { ok: true }, assign_line: { ok: true }, deliver_line: { ok: true }, amend: { ok: true },
    };
  };
  const lineOut = (r, l, a) => ({ line_id: l.line_id, particulars: l.particulars, qty: l.qty, unit: l.unit, price_minor: l.price_minor, delivered: l.delivered, remaining: Math.max(0, l.qty - l.delivered),
    assignment: l.assignment, settings: l.settings, actions: { assign_line: a.assign_line, deliver_line: a.deliver_line, amend: a.amend } });
  const rowOut = (r) => {
    const a = verdicts(r), held = r.lines.filter((l) => l.assignment && l.assignment.assignee_actor_id).length;
    return { chit_id: r.chit_id, kind: r.kind, tab: tab(r), stage: stage(r), word: word(r), status: r.status, side: r.side, subject: r.subject, ref: r.ref, party: r.party, party_id: r.party_id,
      channel: r.channel, fulfilment: r.fulfilment, address: r.address, requested_for: r.requested_for, remark: r.remark, total_minor: r.total_minor, currency: r.currency,
      lines_n: r.lines.length, lines_open_n: open(r), billed: r.billed, despatched: r.despatched, assignee: r.assignee, lines_assigned_n: held || null, created_at: r.created_at, age_days: r.age_days, actions: a };
  };
  const counts = () => { const c = { orders_in: 0, orders_out: 0, tasks: 0, done: 0 }; S.rows.forEach((r) => c[tab(r)]++); return c; };
  const find = (id) => S.rows.find((r) => r.chit_id === id);
  const findLine = (id) => { for (const r of S.rows) { const l = r.lines.find((x) => x.line_id === id); if (l) return l; } return null; };
  seed();

  await ctx.route('**/api/**', async (r) => {
    const q = r.request(), u = new URL(q.url()), m = q.method(), p = u.pathname;
    let body = null; try { body = q.postData() ? JSON.parse(q.postData()) : null; } catch (_) {}
    if (m !== 'GET') S.calls.push(m + ' ' + p + (body ? ' ' + JSON.stringify(body) : ''));
    if (p === '/api/entities/me') return J(r, 200, { entity: { display_name: 'Fixture Shop', currency_code: 'INR' } });
    if (p === '/api/entities/header') return J(r, 200, { business: { display_name: 'Fixture Shop', bridge_id: 'CBWALK0001' }, licences: [], trade_ready: true });
    if (p === '/api/facts/rail') return J(r, 200, crmApi.railFacts({ suppliers: 1, customers: 3, in: 2, out: 1, stuck: 1 }));
    /* TO1b: the SERVER's stuck test (lib/home-facts railChits: open, from someone else, age >= overdue_days) with its why - the screen compares no dates */
    if (p === '/api/facts/rail/chits') {
      const items = S.rows.filter((x) => x.kind !== 'task' && !CLOSED.includes(x.status)).map((x) => {
        const stuck = x.age_days >= 2;
        return { chit_id: x.chit_id, direction: x.kind === 'order_in' ? 'received' : 'sent', tab: x.kind === 'order_in' ? 'in' : 'out', stuck, status: x.status, created_at: x.created_at, age_days: x.age_days,
          subject: x.subject, who: x.party, value: x.total_minor / 100, currency: 'INR', self: false, own: false, why: stuck ? x.party + ' has waited ' + x.age_days + ' days - nobody answered.' : null };
      });
      return J(r, 200, { overdue_days: 2, truncated: false, items });
    }
    if (p === '/api/work/facts') { const c = counts(); return J(r, 200, { truncated: false, counts: c, lines: [{ text: '1 new order', value: 1, tone: 'dn' }], figures: { orders_new: 1, tasks_mine: 0, orders_in: c.orders_in, orders_out: c.orders_out, tasks: c.tasks, done: c.done } }); }
    if (p === '/api/work/list' && m === 'GET') {
      if (S.listDenied) return J(r, 403, { error: 'Forbidden', message: 'Sign in as staff to see Tasks and Orders.' });
      const view = ['orders_in', 'orders_out', 'tasks', 'done'].includes(u.searchParams.get('view')) ? u.searchParams.get('view') : 'orders_in';
      const rows = S.rows.filter((x) => tab(x) === view).map(rowOut);
      return J(r, 200, { view, page: 1, limit: Number(u.searchParams.get('limit')) || 50, truncated: false, counts: counts(), total: rows.length, rows });
    }
    let mm = /^\/api\/work\/([^/]+)$/.exec(p);
    if (mm && m === 'GET') { const x = find(mm[1]); if (!x) return J(r, 404, { error: 'Not found', message: 'Chit not found or you do not have access' }); const o = rowOut(x); o.lines = x.lines.map((l) => lineOut(x, l, o.actions)); return J(r, 200, o); }
    if (p === '/api/people' && m === 'GET') return J(r, 200, { people: PEOPLE, may: { add: { ok: true } }, access_choices: [], counts: { on: 2, off: 1 } });
    mm = /^\/api\/chits\/([^/]+)\/status$/.exec(p);
    if (mm && m === 'PUT') { const x = find(mm[1]); if (!x) return J(r, 404, { error: 'Not found' }); if (S.level === 'viewer') return J(r, 403, { error: 'Forbidden', message: SAY.read_only, why: 'read_only' }); x.status = body.status; x.note = body.note || ''; return J(r, 200, { chit_id: x.chit_id, status: x.status, message: 'Status updated' }); }
    /* TOUR-FIX1: ＋ New task — the chit send to the shop itself (POST /api/chits/send); the stand-in files it as an open task */
    if (p === '/api/chits/send' && m === 'POST') { const id = 'n' + (S.rows.length + 1); S.rows.push(row(id, { kind: 'task', side: null, subject: body.manual_subject || body.subject, party: 'Fixture Shop' })); return J(r, 200, { chit_id: id, message: 'sent' }); }
    mm = /^\/api\/chits\/([^/]+)\/assign-lines$/.exec(p);
    if (mm && m === 'POST') {
      const out = (body.edits || []).map((e, i) => { const l = findLine(e.line_id); if (l) { l.assignment = { assignee_actor_id: e.assignee_actor_id, assignee_name: e.assignee_name || null, assignee_type: e.assignee_actor_id ? 'human' : null, history: [] }; l.settings.state = e.state || 'open'; } return { line_id: e.line_id, seq: i + 2, state: e.state || 'open' }; });
      return J(r, 200, { assignments: out });
    }
    mm = /^\/api\/chits\/([^/]+)\/deliver-lines$/.exec(p);
    if (mm && m === 'POST') { const out = (body.rows || []).map((e) => { const l = findLine(e.line_id); if (l) l.delivered += Number(e.quantity) || 0; return { line_id: e.line_id, quantity: e.quantity }; }); return J(r, 200, { delivered: out }); }
    mm = /^\/api\/actors\/assign\/([^/]+)$/.exec(p);
    if (mm && m === 'PUT') { const x = find(mm[1]); if (!x) return J(r, 404, { error: 'Chit not found' }); if (body.action === 'return') x.assignee = null; else { const t = PEOPLE.find((y) => y.id === body.target_actor_id); x.assignee = t ? { id: t.id, name: t.name } : null; } return J(r, 200, { message: 'ok' }); }
    mm = /^\/api\/chits\/([^/]+)\/messages$/.exec(p);
    if (mm && m === 'GET') return J(r, 200, { messages: [], count: 0 });
    if (mm && m === 'POST') return J(r, 200, { message_id: 'm1', thread_type: body.thread_type, message_text: body.message_text, sender_display_name: 'You', created_at: TD.nowIso() });
    mm = /^\/api\/chits\/([^/]+)$/.exec(p);
    if (mm && m === 'GET') return J(r, 200, { chit_id: mm[1], actions: { message_external: { ok: true }, message_internal: { ok: true } } });
    return J(r, 404, { error: 'not found' });
  });
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Fixture Owner', 'Fixture Shop'));

  const txt = (sel, scope) => (scope || page).locator(sel).first().innerText().then((s) => s.replace(/\s+/g, ' ').trim()).catch(() => '');
  const openPage = async (url) => { await page.goto(base + (url || '/tasks.html')); await page.waitForSelector('[data-testid="tk-bar"], [data-testid="tk-fail"], [data-testid="tk-signin"]', { timeout: 20000 }); await page.waitForTimeout(400); };
  const rows = () => page.locator('[data-testid^="tk-row-"]').count();
  const closeSheet = async () => { await page.click('#tk_x').catch(() => {}); await page.waitForTimeout(200); };
  const wrote = (re) => S.calls.filter((c) => re.test(c)).length;
  const openRow = async (id) => { await page.click('[data-testid="tk-row-' + id + '"]'); await page.waitForSelector('[data-testid="tk-steps"]', { timeout: 6000 }); await page.waitForTimeout(300); };
  const greyed = (id) => page.$eval('#' + id, (b) => b.disabled).catch(() => null);

  await openPage();

  await w.step('T1', 'Tasks & Orders -> the standard page: four folders in the sidebar (then Disputes · Assist, T3), Orders in first, one row per open order, the count says 3 rows; a row says 🌐 Online · Pick up and the amount; the 3-day-old order wears Stuck (the rail\'s test) and Billed; ＋ New is this page\'s own button (never the workshop)', async () => {
    const nav = await page.$$eval('[data-testid^="skel-nav-"]', (bs) => bs.map((b) => b.getAttribute('data-sec')));
    const n = await rows(), cnt = await txt('[data-testid="tk-count"]'), list = await txt('[data-testid="tk-list"]');
    const how = await txt('[data-testid="tk-how-c1"]'), stuck = await page.locator('[data-testid="tk-stuck-c2"]').count(), billed = await page.locator('[data-testid="tk-billed-c2"]').count(), stuck4 = await page.locator('[data-testid="tk-stuck-c4"]').count();
    const fresh = await page.$eval('[data-testid="tk-new"]', (b) => b.tagName + (b.getAttribute('href') ? ' href ' + b.getAttribute('href') : '')).catch(() => null);
    return { ok: nav.join() === 'orders_in,orders_out,tasks,done,disputes,assist' && n === 3 && /3\s*rows/.test(cnt) && /Meena/.test(list) && /New/.test(list) && /Accepted/.test(list) && /1,200\.50|1200\.50/.test(list)
        && how === '🌐 Online · Pick up' && stuck === 1 && billed === 1 && stuck4 === 0 && fresh === 'BUTTON' && !w.errs.length,
      saw: 'folders ' + nav.join(' · ') + '; ' + n + ' rows; "' + cnt + '" · SO-1 "' + how + '" · SO-2 stuck ' + stuck + ' billed ' + billed + ' · SO-4 stuck ' + stuck4 + ' · new -> ' + fresh + (w.errs.length ? '; PAGE ERRORS: ' + w.errs.join(' | ') : '') };
  });
  await w.step('T2', 'Sidebar -> Tasks -> the one task, who has it (Ravi), the word Started is not there yet (New)', async () => {
    await page.click('[data-testid="skel-nav-tasks"]'); await page.waitForTimeout(600);
    const n = await rows(), list = await txt('[data-testid="tk-list"]'), active = await page.$eval('[data-testid="skel-nav-tasks"]', (b) => b.classList.contains('active'));
    return { ok: n === 1 && /Clean the cold room/.test(list) && /Ravi Nair/.test(list) && active, saw: n + ' row(s): ' + list.slice(0, 90) };
  });
  await w.step('T3', 'Sidebar -> Done -> the rejected order says Rejected; back to Orders in -> search "meena" -> only SO-1 is left', async () => {
    await page.click('[data-testid="skel-nav-done"]'); await page.waitForTimeout(600);
    const done = await txt('[data-testid="tk-list"]');
    await page.click('[data-testid="skel-nav-orders_in"]'); await page.waitForTimeout(600);
    await page.fill('[data-testid="listctl-search-tasks-orders_in"]', 'meena'); await page.waitForTimeout(400);
    const n = await rows(), t = await txt('[data-testid="tk-list"]');
    await page.fill('[data-testid="listctl-search-tasks-orders_in"]', ''); await page.waitForTimeout(300);
    return { ok: /Rejected/.test(done) && n === 1 && /SO-1/.test(t), saw: 'Done: ' + done.slice(0, 50) + ' | search: ' + n + ' row(s) ' + t.slice(0, 60) };
  });
  await w.step('T4a', 'Click SO-2 (3 days old, billed) -> the sheet says Stuck WITH the rail\'s why, the delivery address, Bill it greyed "Already billed", the last step reads Delivered', async () => {
    await openRow('c2');
    const why = await txt('[data-testid="tk-stuck-why"]'), addr = await txt('[data-testid="tk-address"]'), bill = await greyed('tk_do_bill'), bwhy = await txt('[data-testid="tk_do_bill-why"]'), done = await txt('#tk_do_complete');
    await closeSheet();
    return { ok: /Stuck/.test(why) && /waited 3 days/.test(why) && /Mint Street/.test(addr) && bill === true && /Already billed/.test(bwhy) && done === 'Delivered',
      saw: '"' + why.slice(0, 60) + '" · ' + addr + ' · Bill it ' + (bill ? 'greyed: "' + bwhy + '"' : 'OPEN') + ' · last step "' + done + '"' };
  });
  await w.step('T4', 'Click SO-1 -> the sheet: the word New, Meena and the amount, Pick up, Accept and Reject open, Bill it open (on the till), Handed over for a pick-up, Reopen greyed WITH the server\'s sentence, two lines with their state and holder, the thread', async () => {
    await openRow('c1');
    const subj = await txt('[data-testid="tk-subject"]'), head = await txt('[data-testid="tk-head"]');
    const dis = { accept: await greyed('tk_do_accept'), reject: await greyed('tk_do_reject'), reopen: await greyed('tk_do_reopen'), bill: await greyed('tk_do_bill') };
    const why = await txt('[data-testid="tk_do_reopen-why"]'), done = await txt('#tk_do_complete'), steps = await txt('[data-testid="tk-steps"]');
    const l1 = await txt('[data-testid="tk-line-state-l1"]'), l2who = await txt('[data-testid="tk-line-who-l2"]'), thread = await page.locator('[data-testid="tk-thread"] textarea, [data-testid="tk-thread"] [data-rt-act="text"]').count();
    return { ok: /SO-1/.test(subj) && /Meena/.test(head) && /1,200\.50|1200\.50/.test(head) && /Pick up/.test(head) && dis.accept === false && dis.reject === false && dis.bill === false && /on the till/.test(steps) && done === 'Handed over'
        && dis.reopen === true && /cannot move/.test(why) && /Open/.test(l1) && /Asha/.test(l2who) && thread >= 1,
      saw: subj + ' · ' + head.slice(0, 70) + ' | accept ' + (dis.accept ? 'greyed' : 'open') + ', bill ' + (dis.bill ? 'greyed' : 'open') + ', last step "' + done + '", reopen ' + (dis.reopen ? 'greyed: "' + why.slice(0, 40) + '"' : 'OPEN') + ' | line 1 ' + l1 + ', line 2 held by ' + l2who + ' | composer ' + thread };
  });
  await w.step('T5', 'SO-1 -> Accept -> ONE PUT /status { accepted } (the one status writer), the sheet says Accepted. and wears Accepted', async () => {
    await page.click('#tk_do_accept'); await page.waitForTimeout(800);
    const out = await txt('[data-testid="tk-out"]'), tag = await txt('#tk_sheet [data-testid="tk-word-c1"]');
    return { ok: /Accepted\./.test(out) && /Accepted/.test(tag) && wrote(/PUT \/api\/chits\/c1\/status \{"status":"accepted"\}/) === 1, saw: '"' + out + '" · tag ' + tag + ' · status calls: ' + wrote(/\/status/) };
  });
  await w.step('T6', 'Line Tomato -> Assign -> Ravi -> Save -> POST assign-lines with Ravi, state open; the line says Ravi Nair', async () => {
    await page.click('#tk_la_l1'); await page.waitForSelector('[data-testid="tk-line-pick"]', { timeout: 5000 });
    await page.selectOption('[data-testid="tk-line-pick"]', 'p2'); await page.click('[data-testid="tk-line-pick-go"]'); await page.waitForTimeout(800);
    const who = await txt('[data-testid="tk-line-who-l1"]'), out = await txt('[data-testid="tk-out"]');
    const call = S.calls.find((c) => /assign-lines/.test(c)) || '';
    return { ok: /Ravi Nair/.test(who) && /"line_id":"l1"/.test(call) && /"assignee_actor_id":"p2"/.test(call) && /"state":"open"/.test(call) && /Ravi/.test(out), saw: 'holder ' + who + ' · "' + out + '" · ' + call.slice(0, 120) };
  });
  await w.step('T7', 'Line Tomato -> Done -> the SAME route carries state done and keeps Ravi; the line reads Done and its button now says Reopen', async () => {
    await page.click('#tk_ld_l1'); await page.waitForTimeout(800);
    const st = await txt('[data-testid="tk-line-state-l1"]'), btn = await txt('#tk_ld_l1');
    const call = S.calls.filter((c) => /assign-lines/.test(c)).pop() || '';
    return { ok: /Done/.test(st) && /Reopen/.test(btn) && /"state":"done"/.test(call) && /"assignee_actor_id":"p2"/.test(call) && wrote(/assign-lines/) === 2, saw: 'state ' + st + ' · button ' + btn + ' · ' + call.slice(0, 120) };
  });
  await w.step('T8', 'Line Onion -> Deliver -> the box offers what is left (2) -> Record -> POST deliver-lines { quantity 2 }; the line says left 0 and Delivered', async () => {
    await page.click('#tk_lv_l2'); await page.waitForSelector('[data-testid="tk-deliver-qty"]', { timeout: 5000 });
    const offered = await page.inputValue('[data-testid="tk-deliver-qty"]');
    await page.click('[data-testid="tk-deliver-go"]'); await page.waitForTimeout(800);
    const st = await txt('[data-testid="tk-line-state-l2"]'), line = await txt('[data-testid="tk-line-l2"]'), call = S.calls.find((c) => /deliver-lines/.test(c)) || '';
    return { ok: offered === '2' && /"quantity":2/.test(call) && /"line_id":"l2"/.test(call) && /Delivered/.test(st) && /left 0/.test(line), saw: 'offered ' + offered + ' · ' + st + ' · ' + line.slice(0, 80) + ' · ' + call.slice(0, 90) };
  });
  await w.step('T9', 'SO-1 -> Assign (whole order) -> Asha -> Save -> PUT /actors/assign/c1 { push }; "Who has it" says Asha Kumar', async () => {
    await page.click('#tk_assign'); await page.waitForSelector('[data-testid="tk-pick"]', { timeout: 5000 });
    await page.selectOption('[data-testid="tk-pick"]', 'p1'); await page.click('[data-testid="tk-pick-go"]'); await page.waitForTimeout(800);
    const who = await txt('[data-testid="tk-who"]'), call = S.calls.find((c) => /actors\/assign/.test(c)) || '';
    return { ok: /Asha Kumar/.test(who) && /PUT \/api\/actors\/assign\/c1 \{"action":"push","target_actor_id":"p1"\}/.test(call), saw: 'who ' + who + ' · ' + call };
  });
  await w.step('T10', 'SO-1 -> Reject -> it asks why; nothing typed sends nothing; a reason -> PUT /status { rejected, note } -> the row leaves Orders in (1 row left)', async () => {
    await page.click('#tk_do_reject'); await page.waitForSelector('[data-testid="tk-reason"]', { timeout: 5000 });
    await page.click('[data-testid="tk-reason-go"]'); await page.waitForTimeout(300);
    const askedOut = await txt('[data-testid="tk-out"]'), before = wrote(/"status":"rejected"/);
    await page.fill('[data-testid="tk-reason"]', 'Out of stock'); await page.click('[data-testid="tk-reason-go"]'); await page.waitForTimeout(900);
    const out = await txt('[data-testid="tk-out"]'), tag = await txt('#tk_sheet [data-testid="tk-word-c1"]');
    await closeSheet();
    const n = await rows();
    return { ok: /reason first/.test(askedOut) && before === 0 && wrote(/PUT \/api\/chits\/c1\/status \{"status":"rejected","note":"Out of stock"\}/) === 1 && /Rejected\./.test(out) && /Rejected/.test(tag) && n === 2,
      saw: 'empty: "' + askedOut + '" (' + before + ' sent) · then "' + out + '" tag ' + tag + ' · rows left ' + n };
  });
  await w.step('T11', 'SO-2 (accepted) -> Accept is greyed "already at that step"; Cancel asks first; Cancel in the dialog sends nothing', async () => {
    await openRow('c2');
    const dis = await greyed('tk_do_accept'), why = await txt('[data-testid="tk_do_accept-why"]');
    await page.click('#tk_do_cancel'); await page.waitForSelector('[data-testid="confirm-cancel"]', { timeout: 5000 });
    const asked = await txt('[data-testid="confirm"]');
    await page.click('[data-testid="confirm-cancel"]'); await page.waitForTimeout(400);
    await closeSheet();
    return { ok: dis === true && /already at that step/.test(why) && /Cancel this\?/.test(asked) && wrote(/c2\/status/) === 0, saw: 'accept ' + (dis ? 'greyed: "' + why.slice(0, 40) + '"' : 'OPEN') + ' · asked "' + asked.slice(0, 50) + '" · c2 status calls: ' + wrote(/c2\/status/) };
  });
  await w.step('T12', 'A view-only login -> every step, Assign and each line\'s buttons are greyed WITH the rail\'s sentence; pressing them sends nothing', async () => {
    S.level = 'viewer'; S.calls = [];
    await openPage(); await openRow('c2');
    const dis = await page.$$eval('#tk_do_accept, #tk_do_reject, #tk_do_complete, #tk_do_cancel, #tk_do_reopen, #tk_assign, #tk_la_l3, #tk_ld_l3, #tk_lv_l3', (bs) => bs.map((b) => b.id + (b.disabled ? ':greyed' : ':open')));
    const why = await txt('[data-testid="tk_do_accept-why"]'), lwhy = await txt('[data-testid="tk_la_l3-why"]');
    await page.click('#tk_do_accept', { force: true, timeout: 2000 }).catch(() => {}); await page.click('#tk_la_l3', { force: true, timeout: 2000 }).catch(() => {}); await page.waitForTimeout(300);
    S.level = 'editor';
    await closeSheet();
    const writes = S.calls.filter((c) => /\/status|assign-lines|deliver-lines|actors\/assign/.test(c));
    return { ok: dis.length === 9 && dis.every((d) => /:greyed/.test(d)) && /view-only/.test(why) && /view-only/.test(lwhy) && writes.length === 0, saw: dis.join(' ') + ' · "' + why.slice(0, 40) + '" · writes: ' + (writes.join(' | ') || 'none') + (S.calls.length !== writes.length ? ' · other calls: ' + S.calls.filter((c) => writes.indexOf(c) < 0).join(' | ') : '') };
  });
  await w.step('T12b', 'TOUR-FIX1 · ＋ New -> the sheet asks "What needs doing?"; Add task with nothing typed says so and sends nothing; typed -> one POST /api/chits/send to the shop itself, the sheet closes, Tasks opens with the new task in it', async () => {
    await openPage(); S.calls = [];
    await page.click('[data-testid="tk-new"]'); await page.waitForSelector('[data-testid="tk-new-what"]', { timeout: 5000 });
    const ask = await txt('[data-testid="tk-sheet"]');
    await page.click('[data-testid="tk-new-go"]'); await page.waitForTimeout(200);
    const empty = (await txt('[data-testid="tk-out"]')) + (await txt('[data-testid="tk-sheet"]')), sent0 = wrote(/chits\/send/);
    await page.fill('[data-testid="tk-new-what"]', 'Count the rice bags'); await page.click('[data-testid="tk-new-go"]');
    await page.waitForFunction(() => !document.querySelector('[data-testid="tk-new-what"]'), null, { timeout: 6000 }).catch(() => {}); await page.waitForTimeout(600);
    const list = await txt('[data-testid="tk-list"]'), active = await page.$eval('[data-testid="skel-nav-tasks"]', (b) => b.classList.contains('active')).catch(() => false);
    S.rows = S.rows.filter((x) => !/^n\d+$/.test(x.chit_id));   /* the steps after this one count the seeded rows */
    return { ok: /What needs doing\?/.test(ask) && /Type what needs doing/.test(empty) && sent0 === 0 && wrote(/chits\/send/) === 1 && /Count the rice bags/.test(list) && active,
      saw: 'asked "' + ask.slice(0, 40) + '"; empty -> "' + empty + '" (' + sent0 + ' sent); then ' + wrote(/chits\/send/) + ' send; Tasks active ' + active + ': ' + list.slice(0, 80) };
  });
  await w.step('T13', 'The server refuses the list -> a plain sentence and Try again, never a raw error; Try again reads it', async () => {
    S.listDenied = true; await openPage();
    const t = await txt('[data-testid="tk-fail"]'); S.listDenied = false;
    await page.click('[data-testid="tk-retry"]'); await page.waitForSelector('[data-testid="tk-bar"]', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(300);
    const back = await rows();
    return { ok: /cannot open this/.test(t) && /Try again/.test(t) && back >= 1, saw: '"' + t.slice(0, 80) + '"; after Try again: ' + back + ' rows' };
  });
  await w.step('T14', 'As a frame (?embed=1&view=tasks) inside a host page: no sidebar, a folder chooser, the host hears open then moved when Start is pressed', async () => {
    const sess = JSON.parse(W.session('Fixture Owner', 'Fixture Shop'));
    await page.evaluate((token) => {
      window.__heard = []; window.__bills = [];
      window.addEventListener('message', (e) => { const m = e.data || {}; if (m.cb !== 'tasks') return; window.__heard.push(m.event); if (m.event === 'bill') window.__bills.push(m.chit_id + ':' + m.party); if (m.event === 'need-session') e.source.postMessage({ cb: 'host', event: 'session', token, api: location.origin }, location.origin); });
      const f = document.createElement('iframe'); f.id = '__tkframe'; f.src = '/tasks.html?embed=1&view=tasks'; f.style.cssText = 'position:fixed;left:0;top:0;width:560px;height:640px;z-index:99;background:#fff'; document.body.appendChild(f);
    }, sess.token);
    await page.waitForTimeout(1500);
    const fr = page.frames().find((f) => /embed=1/.test(f.url()));
    if (!fr) return { ok: false, saw: 'the frame did not load' };
    await fr.waitForSelector('[data-testid="tk-bar"]', { timeout: 10000 });
    const side = await fr.locator('[data-testid="skel-side"]').count(), pick = await fr.locator('[data-testid="tk-view"]').count(), n = await fr.locator('[data-testid^="tk-row-"]').count();
    await fr.click('[data-testid="tk-row-t1"]'); await fr.waitForSelector('[data-testid="tk-steps"]', { timeout: 6000 }); await fr.waitForTimeout(300);
    const startLabel = await txt('#tk_do_accept', fr);
    await fr.click('#tk_do_accept'); await fr.waitForTimeout(900);
    const heard = await page.evaluate(() => window.__heard.slice());
    return { ok: side === 0 && pick === 1 && n === 1 && startLabel === 'Start' && heard.includes('need-session') && heard.includes('open') && heard.includes('moved') && wrote(/t1\/status \{"status":"accepted"\}/) === 1,
      saw: 'sidebar ' + side + ' · chooser ' + pick + ' · ' + n + ' task · button "' + startLabel + '" · host heard: ' + heard.join(' > ') };
  });
  await w.step('T14b', 'In the frame -> folder Orders in -> SO-4 (accepted, not billed) -> no ＋ New in a frame; Bill it -> the HOST hears bill with the order (the till bills it through its one path); the frame wrote nothing', async () => {
    const fr = page.frames().find((f) => /embed=1/.test(f.url()));
    if (!fr) return { ok: false, saw: 'the frame is gone' };
    await fr.click('#tk_x').catch(() => {}); await fr.waitForTimeout(200);
    await fr.selectOption('[data-testid="tk-view"]', 'orders_in'); await fr.waitForTimeout(700);
    const fresh = await fr.locator('[data-testid="tk-new"]').count();
    await fr.click('[data-testid="tk-row-c4"]'); await fr.waitForSelector('[data-testid="tk-steps"]', { timeout: 6000 }); await fr.waitForTimeout(300);
    const writes = () => S.calls.filter((c) => /\/status|assign-lines|deliver-lines|actors\/assign/.test(c)).length;
    const before = writes();
    const billDis = await fr.$eval('#tk_do_bill', (b) => b.disabled).catch(() => null);
    await fr.click('#tk_do_bill'); await fr.waitForTimeout(400);
    const bills = await page.evaluate(() => window.__bills.slice());
    await page.evaluate(() => { const f = document.getElementById('__tkframe'); if (f) f.remove(); });
    return { ok: fresh === 0 && billDis === false && bills.join() === 'c4:Priya' && writes() === before,
      saw: 'new button in frame: ' + fresh + ' · Bill it ' + (billDis ? 'greyed' : 'open') + ' · host heard bill: ' + (bills.join(' ') || 'nothing') + ' · writes after: ' + (writes() - before) };
  });
  await w.step('T15', 'A phone (390 px) -> the page fits the width (no sideways scroll) and the rows are there; the bell\'s door (openChit) opens THAT order here, the sheet with its address, still 390 wide', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await openPage(); await page.waitForTimeout(500);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth), n = await rows();
    await page.evaluate(() => window.openChit('c4')); await page.waitForSelector('[data-testid="tk-steps"]', { timeout: 6000 }); await page.waitForTimeout(300);
    const subj = await txt('[data-testid="tk-subject"]'), addr = await txt('[data-testid="tk-address"]'), sw2 = await page.evaluate(() => document.documentElement.scrollWidth);
    await closeSheet();
    await page.setViewportSize({ width: 1280, height: 860 });
    return { ok: sw === 390 && n >= 1 && /SO-4/.test(subj) && /Beach Road/.test(addr) && sw2 === 390, saw: 'scrollWidth ' + sw + ' · ' + n + ' rows · openChit -> ' + subj + ' · ' + addr + ' · sheet open scrollWidth ' + sw2 };
  });
  await w.step('T16', 'Every /api/work answer the stand-in served matches the API contract (keys, nesting, types), and the page threw no error', async () => {
    const [ok, msg] = C.finish();
    return { ok: ok && !w.errs.length, saw: msg + (w.errs.length ? ' · PAGE ERRORS: ' + w.errs.slice(0, 2).join(' | ') : '') };
  });
});
