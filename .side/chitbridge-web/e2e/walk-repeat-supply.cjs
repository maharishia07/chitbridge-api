#!/usr/bin/env node
/**
 * e2e/walk-repeat-supply.cjs - REPEAT SUPPLY AS AN AGREEMENT BOTH PARTIES HOLD, WALKED (round RI1: finance.html#/repeat + app/cap-repeat.js + chit-sheet.js).
 * Black box, both sides: the SELLER's list (next date · last run · the other side's state · the server's may/why per verb, a refused verb greyed WITH its
 * sentence), Run now (one press, one write), the agreement opened as its chit (the sheet) with the seller's verbs, End asks first and Cancel sends nothing,
 * "Repeat this…" on a sent invoice (CBSteps: Schedule → Review → Send agreement, the body the server takes); then the CUSTOMER's side on the same chit:
 * Accept · Counter · Decline · Skip from the server's answer, Counter sends the quantities and the note, Accept re-reads the sheet, a 422 is said in words.
 * Every figure and every verdict is the SERVER's (a stand-in answering inside the page, shaped by the API contract) - the page paints, it computes nothing.
 * A FIXTURE shop ("Fixture Shop") and a fixture customer ("Ravi Stores"): nothing reaches localhost:3000 or the live site; nothing is written anywhere.
 *
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-repeat-supply.cjs        headless, fast
 *   node e2e/walk-repeat-supply.cjs --show                                  headed, a caption per step, a results page that stays open
 * One line per path: "ID · path · PASS/FAIL (what it saw)". Screenshots: e2e/shots/walk-repeat-supply-NN.png.
 */
'use strict';
const TD = require('./lib/today.cjs');
const fs = require('fs');
const path = require('path');
const W = require('./lib/walk.cjs');
const C = require('./lib/contract.cjs');   /* M43: every /api/repeat answer this stand-in serves is held to the API contract */
const J = (r, status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const crmApi = require('./lib/crm-api.cjs');   /* RAIL-LAB-SRV1: the rail card (GET /api/facts/rail) from its one builder */
const clone = (x) => JSON.parse(JSON.stringify(x));
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'web-api.contract.json'), 'utf8')).routes;
const SHOP = '11111111-1111-4111-8111-111111111111', CUST = '22222222-2222-4222-8222-222222222222';
const TODAY = TD.TODAY;
const plus = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

/* ── the agreement's own step table, as lib/repeat-supply may() answers it (the stand-in is the server here) ── */
const STEPS = { seller: { pause: ['agreed'], resume: ['paused'], end: ['proposed', 'agreed', 'countered', 'paused'], skip: ['agreed', 'paused'], run: ['agreed'], agree: ['countered'], refuse: ['countered'] },
  customer: { accept: ['proposed'], counter: ['proposed', 'agreed'], decline: ['proposed', 'countered', 'agreed'], skip: ['agreed'] } };
const WHY = { ended: 'This agreement has ended.', wrong_state: 'This agreement is not at a step where that can be done.', not_due: 'The next run is not due yet.' };
const WORDS = { proposed: 'Waiting for the customer', agreed: 'Agreed', countered: 'Customer proposed a change', declined: 'Declined', paused: 'Paused', ended: 'Ended' };
function actions(a, side) {
  const out = {};
  for (const v of Object.keys(STEPS[side])) {
    if (a.state === 'ended' || a.state === 'declined') out[v] = { ok: false, why: 'ended', say: WHY.ended };
    else if (STEPS[side][v].indexOf(a.state) < 0) out[v] = { ok: false, why: 'wrong_state', say: WHY.wrong_state };
    else if (v === 'run' && a.next_on > TODAY) out[v] = { ok: false, why: 'not_due', say: WHY.not_due };
    else out[v] = { ok: true };
  }
  return out;
}
/** an agreement row in the contract's own shape (the list example's first row), with this scenario's values */
function row(o) {
  const base = clone(FX['GET /api/repeat'].example.agreements[0]);
  return Object.assign(base, { entity_id: SHOP, customer_entity_id: CUST, source_chit_id: 'inv-1', every: 1, unit: 'weekly', anchor_day: null, end_on: null, runs_max: 4, runs_done: 0, mode: 'draft',
    terms: {}, counter: null, skips: [], runs: {}, last_run_on: null, state_by: null, state_at: null, state_note: null, created_by: SHOP, created_at: '2026-10-01T00:00:00Z', updated_at: null,
    customer: { entity_id: CUST, name: 'Ravi Stores' }, money: { gross: 1000, savings: 0, net: 1000, tax: 180, total: 1180, currency_code: 'INR', provisional: true }, currency: 'INR', subject: 'Repeat supply · every week' }, o);
}
const view = (a, side) => Object.assign(clone(a), { side, actions: actions(a, side), words: WORDS[a.state], due: a.state === 'agreed' && a.next_on <= TODAY });
const chitOf = (a, lines) => ({
  header: { chit_id: a.chit_id, purpose: 'subscription', sender_entity_id: SHOP, sender_entity_display_name: 'Fixture Shop', current_status: 'pending', manual_subject: a.subject, created_at: '2026-10-01T06:00:00Z',
    all_recipients: [{ entity_id: SHOP, role: 'sender', display_name: 'Fixture Shop' }, { entity_id: CUST, role: 'to', display_name: 'Ravi Stores' }],
    business_json: { currency: 'INR', repeat: { agreement_id: a.agreement_id, every: a.every, unit: a.unit, anchor_day: a.anchor_day, start_on: a.next_on, until: { runs: a.runs_max, on: null }, mode: a.mode, source_chit_id: 'inv-1' } },
    summary_json: { currency_code: 'INR', purpose: 'subscription', line_item_count: 1, total_value: 1000, money: a.money } },
  detail: { line_items: lines }, state_log: [], participants: [], attachments: [], amendments: [], amendments_migrated: true, actions: {},
});
const LINES = [{ line_id: 'L1', seq: 10, particulars: 'Milk 1L', quantity: 20, price: 50, total: 1000 }];

W.run('repeat-supply', async (w) => {
  const { page, ctx, base } = w;
  const S = { migrated: true, hold: 300, writes: [], bodies: {}, refuse: null, ag: {} };
  S.ag.A = row({ agreement_id: 'A', chit_id: 'agr-a', state: 'agreed', next_on: TODAY, runs_done: 1, last_run_on: plus(TODAY, -7), runs: { [plus(TODAY, -7)]: 'run-1' } });
  S.ag.B = row({ agreement_id: 'B', chit_id: 'agr-b', state: 'countered', next_on: plus(TODAY, 3), counter: { note: 'Fifteen is enough', lines: [{ line_id: 'L1', quantity: 15 }], every: null, unit: null, anchor_day: null, start_on: null, by: CUST, at: '2026-10-05T06:00:00.000Z' } });
  S.ag.C = row({ agreement_id: 'C', chit_id: 'agr-c', state: 'proposed', next_on: plus(TODAY, 1) });
  S.ag.D = row({ agreement_id: 'D', chit_id: 'agr-d', state: 'proposed', next_on: plus(TODAY, 2), mode: 'send' });
  const sideOf = () => (S.me === 'customer' ? 'customer' : 'seller');
  const hold = () => new Promise((res) => setTimeout(res, S.hold));

  await ctx.route('**/api/**', async (r0) => {
    const r = C.wrap(r0);
    const q = r.request(), u = new URL(q.url()), p = u.pathname, m = q.method();
    let body = {}; try { body = JSON.parse(q.postData() || '{}'); } catch (_) {}
    if (m !== 'GET' && p !== '/api/events/ticket') { S.writes.push(m + ' ' + p); (S.bodies[p] = S.bodies[p] || []).push(body); }
    /* the list */
    if (p === '/api/repeat' && m === 'GET') {
      if (!S.migrated) return J(r, 200, { agreements: [], migrated: false, message: 'Repeat supply arrives after the next update.' });
      if (S.me === 'customer') return J(r, 200, { agreements: [], migrated: true });
      return J(r, 200, { agreements: Object.values(S.ag).map((a) => view(a, 'seller')), migrated: true });
    }
    if (p === '/api/repeat' && m === 'POST') {
      await hold();
      if (!body.chit_id || !body.unit || !body.start_on) return J(r, 400, { error: 'How often?', message: 'How often?' });
      const n = row({ agreement_id: 'E', chit_id: 'agr-e', state: 'proposed', every: body.every, unit: body.unit, next_on: body.start_on, runs_max: (body.until && body.until.runs) || null, end_on: (body.until && body.until.on) || null, mode: body.mode || 'draft' });
      S.ag.E = n; return J(r, 200, { agreement: view(n, 'seller') });
    }
    if (p === '/api/repeat/sweep') { await hold(); return J(r, 200, { ran: [], problems: [] }); }
    const one = /^\/api\/repeat\/([A-Z])$/.exec(p), act = /^\/api\/repeat\/([A-Z])\/(accept|counter|decline|skip|agree|refuse|pause|resume|end|run)$/.exec(p);
    if (one && m === 'GET') { const a = S.ag[one[1]]; return a ? J(r, 200, { agreement: view(a, sideOf()) }) : J(r, 404, { error: 'Not found', message: 'No such agreement.' }); }
    if (act && m === 'POST') {
      await hold();
      const a = S.ag[act[1]], v = act[2], side = sideOf();
      if (!a) return J(r, 404, { error: 'Not found', message: 'No such agreement.' });
      if (S.refuse && S.refuse.verb === v) return J(r, 422, { code: 'REPEAT_WRONG_STATE', error: S.refuse.say, message: S.refuse.say });
      const may = actions(a, side)[v] || { ok: false, why: 'wrong_state', say: WHY.wrong_state };
      if (!may.ok) return J(r, 422, { code: 'REPEAT_' + may.why.toUpperCase(), error: may.say, message: may.say });
      const stamp = { state_by: side === 'seller' ? SHOP : CUST, state_at: TD.nowIso(), state_note: body.reason || null };
      let extra = {};
      if (v === 'run') { const d = a.next_on; a.runs[d] = 'run-' + d; a.runs_done += 1; a.last_run_on = d; a.next_on = plus(d, 7); extra = { ran: [{ date: d, chit_id: 'run-' + d, duplicate: false }], problems: [] }; }
      else if (v === 'skip') { a.skips.push({ date: a.next_on, by_entity_id: stamp.state_by, reason: body.reason || null, at: stamp.state_at }); a.next_on = plus(a.next_on, 7); }
      else if (v === 'counter') { a.state = 'countered'; a.counter = { note: body.note || '', lines: body.lines || null, every: body.every == null ? null : body.every, unit: body.unit || null, anchor_day: null, start_on: body.start_on || null, by: CUST, at: stamp.state_at }; }
      else if (v === 'agree') { a.state = 'agreed'; if (a.counter && a.counter.lines) a.terms = { lines: a.counter.lines }; a.counter = null; }
      else a.state = { accept: 'agreed', decline: 'declined', refuse: 'declined', pause: 'paused', resume: 'agreed', end: 'ended' }[v] || a.state;
      Object.assign(a, stamp);
      return J(r, 200, Object.assign({ agreement: view(a, side) }, extra));
    }
    /* the chit sheet: the agreement chits and the invoice "Repeat this…" is pressed on */
    const ch = /^\/api\/chits\/([^/]+)$/.exec(p);
    if (ch && m === 'GET') {
      const id = decodeURIComponent(ch[1]);
      const a = Object.values(S.ag).find((x) => x.chit_id === id);
      if (a) return J(r0, 200, chitOf(a, LINES));
      if (id === 'inv-1') return J(r0, 200, { header: { chit_id: 'inv-1', purpose: 'invoice', sender_entity_id: SHOP, sender_entity_display_name: 'Fixture Shop', current_status: 'accepted', manual_subject: 'INV-0042', created_at: '2026-10-01T06:00:00Z',
        all_recipients: [{ entity_id: SHOP, role: 'sender', display_name: 'Fixture Shop' }, { entity_id: CUST, role: 'to', display_name: 'Ravi Stores' }],
        business_json: { currency: 'INR' }, summary_json: { currency_code: 'INR', purpose: 'invoice', line_item_count: 1, total_value: 1000, money: { gross: 1000, savings: 0, net: 1000, tax: 180, total: 1180, currency_code: 'INR' } } },
        detail: { line_items: LINES }, state_log: [], participants: [], attachments: [], amendments: [], amendments_migrated: true, actions: {} });
      return J(r0, 404, { error: 'Not found' });
    }
    if (p === '/api/entities/me') return J(r0, 200, { entity: { display_name: S.me === 'customer' ? 'Ravi Stores' : 'Fixture Shop', currency_code: 'INR' } });
    if (p === '/api/facts/rail') return J(r0, 200, crmApi.railFacts({ suppliers: 1, customers: 3, in: 0, out: 0, stuck: 0 }));
    return J(r0, 404, { error: 'not found' });
  });
  const asSeller = async () => { S.me = 'seller'; await ctx.addInitScript((s) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Fixture Owner', 'Fixture Shop')); };
  await asSeller();

  const txt = (sel) => page.locator(sel).first().innerText().then((s) => s.replace(/\s+/g, ' ').trim()).catch(() => '');
  const body = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  const open = async (hash, until) => { await page.goto(base + '/finance.html?t=' + Date.now() + (hash || '#/repeat'));   /* clock-ok: cache-bust — a fresh load every time (a hash alone would not reload) */ await page.waitForSelector(until || '[data-testid^="rp-row-"]', { timeout: 20000 }).catch(() => {}); await page.waitForTimeout(400); };
  const sheet = async (chitId) => { await page.evaluate((id) => openChitSheet(id), chitId); await page.waitForSelector('[data-testid="rp-verbs"], [data-testid="cs-act-repeat"], [data-testid="rp-panel-err"]', { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(300); };
  const writesTo = (tail) => S.writes.filter((x) => x.endsWith(tail)).length;

  await open();
  await w.step('R1', 'Finance -> Repeat supply -> the agreements, each with the customer, the schedule, the next run, the last run and THEIR side\'s state in words', async () => {
    const n = await page.locator('[data-testid^="rp-row-"]').count(), a = await txt('[data-testid="rp-row-A"]'), b = await txt('[data-testid="rp-row-B"]'), c = await txt('[data-testid="rp-row-C"]');
    const ok = n === 4 && /Ravi Stores/.test(a) && /every week/.test(a) && /Agreed/.test(a) && /Due/.test(a) && /Customer proposed a change/.test(b) && /Waiting for the customer/.test(c) && /1,?180/.test(a);
    return { ok, saw: n + ' rows; A: "' + a.slice(0, 120) + '" | B: ' + /Customer proposed/.test(b) + ' | C: ' + /Waiting/.test(c) };
  });
  await w.step('R2', 'Repeat supply -> "1 run due" and Run what is due; opening the tab writes nothing', async () => {
    const h = await txt('[data-testid="rp-head"]'), en = await page.locator('[data-testid="rp-run-due"]').isEnabled().catch(() => false);
    return { ok: /1 run due/i.test(h) && en && S.writes.length === 0, saw: '"' + h + '"; enabled ' + en + '; writes ' + S.writes.length };
  });
  await w.step('R3', 'Row C (waiting for the customer) -> Run now is GREYED, with the server\'s sentence beside it; a tap sends nothing', async () => {
    const dis = await page.locator('[data-testid="rp-run-C"]').isDisabled().catch(() => false);
    await page.locator('[data-testid="rp-run-C"]').click({ force: true }).catch(() => {});
    await page.waitForTimeout(200);
    const why = await txt('[data-testid="rp-run-C-say"]');
    return { ok: dis && /not at a step/.test(why) && writesTo('/C/run') === 0, saw: 'disabled ' + dis + '; beside it "' + why + '"; writes ' + writesTo('/C/run') };
  });
  await w.step('R4', 'Row A (due) -> Run now, pressed twice -> ONE request, the outcome said ("1 run made"), the row moves to next week', async () => {
    const btn = page.locator('[data-testid="rp-run-A"]');
    await btn.click(); await page.waitForTimeout(60); await btn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(S.hold + 700);
    const why = await txt('[data-testid="rp-why"]'), a = await txt('[data-testid="rp-row-A"]');
    return { ok: writesTo('/A/run') === 1 && /1 run made/.test(why) && !/Due/.test(a), saw: 'writes ' + writesTo('/A/run') + '; said "' + why + '"; row: ' + a.slice(0, 100) };
  });
  await w.step('R5', 'Row B -> opens the agreement CHIT (the sheet): the panel reads the server\'s answer; the seller sees Agree ✓, Run ✗ with its sentence; the rail\'s Accept is NOT offered', async () => {
    await page.click('[data-testid="rp-row-B"]');
    await page.waitForSelector('[data-testid="rp-verbs"]', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(300);
    const st = await txt('[data-testid="rp-state"]'), agree = await page.locator('[data-testid="rp-act-agree"]').isEnabled().catch(() => false), run = await page.locator('[data-testid="rp-act-run"]').isDisabled().catch(() => false);
    const runWhy = await page.locator('[data-testid="rp-act-run"]').getAttribute('title').catch(() => ''), cnt = await txt('[data-testid="rp-counter"]'), accept = await page.locator('[data-testid="cs-act-accept"]').count();
    return { ok: /Customer proposed a change/.test(st) && agree && run && /not at a step/.test(runWhy || '') && /Fifteen/.test(cnt) && /Milk 1L × 15/.test(cnt) && accept === 0, saw: 'state "' + st + '"; agree ' + agree + '; run disabled ' + run + ' ("' + runWhy + '"); counter "' + cnt.slice(0, 80) + '"; rail accept buttons ' + accept };
  });
  await w.step('R6', 'Sheet -> Agree -> one write, the state turns Agreed, the terms now carry the countered quantity', async () => {
    await page.click('[data-testid="rp-act-agree"]'); await page.waitForTimeout(S.hold + 500);
    const st = await txt('[data-testid="rp-state"]'), said = await txt('[data-testid="rp-panel-why"]');
    return { ok: writesTo('/B/agree') === 1 && /Agreed/.test(st) && S.ag.B.terms.lines && S.ag.B.terms.lines[0].quantity === 15, saw: 'writes ' + writesTo('/B/agree') + '; state "' + st + '"; said "' + said + '"' };
  });
  await w.step('R7', 'Sheet -> End -> asks first; Cancel sends NOTHING; Yes with a reason sends once; every verb then says "ended"', async () => {
    await page.click('[data-testid="rp-act-end"]'); await page.waitForTimeout(200);
    await page.fill('[data-testid="rp-reason"]', 'Customer moved');
    await page.click('[data-testid="rp-end-go"]'); await page.waitForTimeout(300);
    const asked = (await page.locator('[data-testid="confirm-ok"]').count()) > 0;
    await page.click('[data-testid="confirm-cancel"]').catch(() => {}); await page.waitForTimeout(S.hold + 200);
    const w0 = writesTo('/B/end');
    await page.click('[data-testid="rp-end-go"]'); await page.waitForTimeout(300);
    await page.click('[data-testid="confirm-ok"]').catch(() => {}); await page.waitForTimeout(S.hold + 600);
    const st = await txt('[data-testid="rp-state"]'), pauseWhy = await page.locator('[data-testid="rp-act-pause"]').getAttribute('title').catch(() => '');
    const sent = (S.bodies['/api/repeat/B/end'] || [])[0] || {};
    return { ok: asked && w0 === 0 && writesTo('/B/end') === 1 && /Ended/.test(st) && sent.reason === 'Customer moved' && /has ended/.test(pauseWhy || ''), saw: 'asked ' + asked + '; writes before yes ' + w0 + ', after ' + writesTo('/B/end') + '; state "' + st + '"; reason sent "' + sent.reason + '"; pause says "' + pauseWhy + '"' };
  });
  await w.step('R8', 'A SENT invoice (the sheet) -> "Repeat this…" -> the step flow: Schedule (every 2 weeks, 3 runs) -> Review says it in words -> Send agreement -> the body the server takes, "Agreement sent"', async () => {
    await page.evaluate(() => CBSheet.close());
    await sheet('inv-1');
    const has = (await page.locator('[data-testid="cs-act-repeat"]').count()) > 0;
    await page.click('[data-testid="cs-act-repeat"]');
    await page.waitForSelector('[data-testid="rp-every"]', { timeout: 10000 }).catch(() => {});
    await page.fill('[data-testid="rp-every"]', '2'); await page.selectOption('[data-testid="rp-unit"]', 'weekly');
    await page.check('[data-testid="rp-until-runs"]'); await page.fill('[data-testid="rp-runs"]', '3');
    await page.locator('[data-testid="rp-every"]').dispatchEvent('input');
    await page.click('[data-testid^="step-next-"]'); await page.waitForTimeout(300);
    const review = await txt('[data-testid="rp-review"]');
    await page.click('[data-testid="rp-send"]'); await page.waitForTimeout(S.hold + 700);
    const sent = (S.bodies['/api/repeat'] || [])[0] || {}, toast = await txt('#toast');
    const ok = has && /every 2 weeks/.test(review) && /3 runs/.test(review) && sent.chit_id === 'inv-1' && sent.every === 2 && sent.unit === 'weekly' && sent.until && sent.until.runs === 3 && sent.mode === 'draft' && /Agreement sent/.test(toast);
    return { ok, saw: 'verb shown ' + has + '; review "' + review.slice(0, 90) + '"; sent ' + JSON.stringify(sent).slice(0, 120) + '; toast "' + toast + '"' };
  });
  await w.step('R9', 'Before the SQL has run (migrated:false) -> the tab says "Repeat supply arrives after the next update", nothing else', async () => {
    S.migrated = false; await open('#/repeat', '[data-testid="rp-not-yet"]');
    const t = await txt('[data-testid="rp-not-yet"]'), rows = await page.locator('[data-testid^="rp-row-"]').count();
    S.migrated = true;
    return { ok: /next update/.test(t) && rows === 0, saw: '"' + t + '"; rows ' + rows };
  });

  /* ── the customer's side: the same chits, held by Ravi Stores ── */
  S.me = 'customer';
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Ravi', 'Ravi Stores'));
  await open('#/repeat', '[data-testid="rp-head"]');
  await w.step('R10', 'CUSTOMER -> the agreement chit they hold (the sheet) -> Accept · Counter · Decline ✓, Skip greyed with the sentence; no seller verb', async () => {
    await sheet('agr-c');
    const acc = await page.locator('[data-testid="rp-act-accept"]').isEnabled().catch(() => false), co = await page.locator('[data-testid="rp-act-counter"]').isEnabled().catch(() => false);
    const sk = await page.locator('[data-testid="rp-act-skip"]').isDisabled().catch(() => false), skWhy = await page.locator('[data-testid="rp-act-skip"]').getAttribute('title').catch(() => '');
    const run = await page.locator('[data-testid="rp-act-run"]').count(), st = await txt('[data-testid="rp-state"]');
    return { ok: acc && co && sk && /not at a step/.test(skWhy || '') && run === 0 && /Waiting for the customer/.test(st), saw: 'accept ' + acc + '; counter ' + co + '; skip disabled ' + sk + ' ("' + skWhy + '"); seller verbs ' + run + '; state "' + st + '"' };
  });
  await w.step('R11', 'Customer -> Counter -> the lines with their quantities, a note -> Send counter -> the server gets { lines:[{L1, 15}], note } and the state turns "Customer proposed a change"', async () => {
    await page.click('[data-testid="rp-act-counter"]'); await page.waitForTimeout(200);
    await page.fill('[data-testid="rp-cq-0"]', '15'); await page.fill('[data-testid="rp-c-note"]', 'Fifteen is enough on weekdays');
    await page.click('[data-testid="rp-c-send"]'); await page.waitForTimeout(S.hold + 600);
    const sent = (S.bodies['/api/repeat/C/counter'] || [])[0] || {}, st = await txt('[data-testid="rp-state"]'), cnt = await txt('[data-testid="rp-counter"]');
    const ok = sent.chit_id === 'agr-c' && sent.lines && sent.lines[0].line_id === 'L1' && sent.lines[0].quantity === 15 && /Fifteen/.test(sent.note || '') && !('every' in sent) && /Customer proposed a change/.test(st) && /Milk 1L × 15/.test(cnt);
    return { ok, saw: 'sent ' + JSON.stringify(sent).slice(0, 140) + '; state "' + st + '"; counter "' + cnt.slice(0, 60) + '"' };
  });
  await w.step('R12', 'Customer -> Accept on another agreement -> one write, "Agreed", the sheet re-read; then Skip is offered and asks why', async () => {
    await page.evaluate(() => CBSheet.close()); await sheet('agr-d');
    await page.click('[data-testid="rp-act-accept"]'); await page.waitForTimeout(S.hold + 900);
    await page.waitForSelector('[data-testid="rp-verbs"]', { timeout: 10000 }).catch(() => {}); await page.waitForTimeout(300);
    const st = await txt('[data-testid="rp-state"]'), sk = await page.locator('[data-testid="rp-act-skip"]').isEnabled().catch(() => false);
    await page.click('[data-testid="rp-act-skip"]').catch(() => {}); await page.waitForTimeout(200);
    const ph = await page.locator('[data-testid="rp-reason"]').getAttribute('placeholder').catch(() => '');
    return { ok: writesTo('/D/accept') === 1 && /Agreed/.test(st) && sk && /Why/.test(ph || ''), saw: 'writes ' + writesTo('/D/accept') + '; state "' + st + '"; skip enabled ' + sk + '; asks "' + ph + '"' };
  });
  await w.step('R13', 'Customer -> a write the server refuses (422 with a sentence) -> the sentence is said beside the verbs, never "API 422"', async () => {
    S.refuse = { verb: 'skip', say: 'Say why — the other side will read it.' };
    await page.click('[data-testid="rp-skip-go"]'); await page.waitForTimeout(S.hold + 500);
    const said = await txt('[data-testid="rp-panel-why"]'); S.refuse = null;
    return { ok: /Say why/.test(said) && !/API 4/.test(said), saw: '"' + said + '"' };
  });
  await w.step('M43', 'the stand-in answered every /api/repeat call as the API contract says', async () => { const [ok, saw] = C.finish(); return { ok, saw }; });
});
