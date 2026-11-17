#!/usr/bin/env node
/**
 * e2e/walk-finance.cjs - CB FINANCE · COLLECTIONS, WALKED (round F1: finance.html + app/cap-finance.js): who owes the shop, how old, the limit, the interest earned.
 * Black box: it reads the list the way an owner does (the groups, the chips, the amounts in words), presses Receive and Remind, and checks the two refusals
 * (a login that may not see collections; a read that fails). Every figure on this screen is the SERVER's (GET /api/books/dues?finance=1) - the stand-in
 * answers fixed numbers, so the page must paint exactly those and add nothing of its own. Interest is SHOWN, never charged.
 * A FIXTURE shop ("Fixture Shop" / CBWALK0001): the site is served from this checkout, the API is a stand-in answering inside the page, so nothing reaches
 * localhost:3000 or the live site and nothing is written anywhere. Not run in the round that wrote it (no Playwright) - first run is the check.
 * (The finance=1 rows carry fields - over_limit, interest, last remind - the contract master does not list yet: the plain dues answer is held to the contract, the finance fields ride beside it.)
 *
 *   NODE_PATH=C:/dev/toolset/node_modules/e2e node e2e/walk-finance.cjs        headless, fast   (or: sh C:/dev/toolset/e2e.sh <checkout> e2e/walk-finance.cjs)
 *   node e2e/walk-finance.cjs --show                                             watch it: headed, a caption per step, green/red per step, a results page that stays open
 * One line per path: "ID · path · PASS/FAIL (what it saw)". Screenshots: e2e/shots/walk-finance-NN.png.
 */
'use strict';
const TD = require('./lib/today.cjs');
const W = require('./lib/walk.cjs');
const books = require('./lib/books-api.cjs');
const C = require('./lib/contract.cjs');   /* M43: every /api/books answer this stand-in serves is held to the API contract */
const J = (r, status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const crmApi = require('./lib/crm-api.cjs');   /* RAIL-LAB-SRV1: the rail card (GET /api/facts/rail) from its one builder */

W.run('finance', async (w) => {
  const { page, ctx, base } = w;

  /* the day as the server states it: Sri Hardware is over its limit and owes 1,20,000; Lakshmi Stores is overdue with interest; Kumar Traders is within terms.
     A supplier and a settled customer are in the same answer - Collections must leave them out. */
  /* FIN-R1: limit and interest come from the customer's Terms — credit_limit_from (party · shop · null) and interest_state (on · off · not_set) are the server's codes */
  const fin = (o) => Object.assign({ credit_limit_minor: null, credit_limit_from: o.credit_limit_minor != null ? 'party' : null, over_limit: false, interest_minor: 0, interest_state: 'on', last_remind: null }, o);
  /* FIN-72: the server's follow-up split (days past the due date) and its page total — codes and minor units, as GET /dues?finance=1 sends them */
  const FU = (o, worst) => Object.assign({ not_due: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, worst, no_terms_minor: 0, terms: 'ok' }, o);
  const TOTAL = FU({ not_due: 800000, d61_90: 4500000, d90_plus: 12000000 }, 'd90_plus');
  const ROWS = [
    fin({ party_id: 'pa', party_no: 'P-00001', name: 'Sri Hardware', side: 'customer', balance_minor: 12000000, oldest_due: '2026-06-01', credit_limit_minor: 10000000, over_limit: true, interest_minor: 150000, buckets: { lt_6m: 12000000 }, follow_up: FU({ d90_plus: 12000000 }, 'd90_plus') }),
    fin({ party_id: 'pb', party_no: 'P-00002', name: 'Lakshmi Stores', side: 'customer', balance_minor: 4500000, oldest_due: '2026-08-15', credit_limit_minor: 10000000, interest_minor: 20000, last_remind: '2026-09-20', buckets: { lt_6m: 4500000 }, follow_up: FU({ d61_90: 4500000 }, 'd61_90') }),
    fin({ party_id: 'pc', party_no: 'P-00003', name: 'Kumar Traders', side: 'customer', balance_minor: 800000, interest_minor: null, interest_state: 'not_set', buckets: { not_due: 800000 }, follow_up: FU({ not_due: 800000 }, null) }),
    fin({ party_id: 'ps', party_no: 'P-00004', name: 'Bharat Steel', side: 'supplier', balance_minor: -300000, buckets: { lt_1y: 300000 } }),
    fin({ party_id: 'pz', party_no: 'P-00005', name: 'Settled Sons', side: 'customer', balance_minor: 0 }),
  ];
  const S = { rows: ROWS, mode: 'ok', asked: [], writes: [], total: TOTAL };
  await ctx.route('**/api/**', async (r0) => {
    const r = C.wrap(r0);
    const q = r.request(), u = new URL(q.url()), p = u.pathname;
    /* not writes: the payment preview is a read asked with POST (the body is the question); /events/ticket only mints the shell's one-time bell-stream ticket */
    if (q.method() !== 'GET' && !/\/pay(ments)?\/preview$|\/pay-preview$|^\/api\/events\/ticket$/.test(p)) S.writes.push(q.method() + ' ' + p);
    if (p === '/api/books/dues') {
      S.asked.push(u.search);
      if (S.mode === 'denied') return J(r, 403, { message: 'Only the owner may see collections.' });
      if (S.mode === 'off') return J(r, 404, { message: 'Books is not switched on' });
      if (S.mode === 'broken') return J(r, 500, { message: 'database timeout at 10.0.0.5' });
      const asOf = TD.TODAY, plain = books.dues(S.rows.map((x) => books.dueRow({ party_no: x.party_no, name: x.name, party_id: x.party_id, side: x.side, balance_minor: x.balance_minor, oldest_due: x.oldest_due, buckets: x.buckets })), { asOf });
      C.check('GET', p, 200, plain, 'walk-finance: ');   /* the contract holds the plain answer; the finance fields (credit limit, over_limit, interest, last remind) are served beside it */
      const extra = Object.fromEntries(S.rows.map((x) => [x.party_id, x]));
      return J(r0, 200, Object.assign({}, plain, { parties: plain.parties.map((x) => Object.assign({}, x, { credit_limit_minor: extra[x.party_id].credit_limit_minor, credit_limit_from: extra[x.party_id].credit_limit_from, over_limit: extra[x.party_id].over_limit, interest_minor: extra[x.party_id].interest_minor, interest_state: extra[x.party_id].interest_state, last_remind: extra[x.party_id].last_remind, follow_up: extra[x.party_id].follow_up })), follow_up_total: S.total }));
    }
    if (/\/pay(\/|-)preview$/.test(p)) return J(r, 200, { proposal: [], warnings: [] });   /* no open bill: Remind has nothing to remind about */
    if (p === '/api/entities/me') return J(r, 200, { entity: { display_name: 'Fixture Shop', currency_code: 'INR' } });
    if (p === '/api/facts/rail') return J(r, 200, crmApi.railFacts({ suppliers: 1, customers: 3, in: 0, out: 0, stuck: 0 }));
    return J(r, 404, { error: 'not found' });
  });
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Fixture Owner', 'Fixture Shop'));

  const txt = (sel) => page.locator(sel).first().innerText().then((s) => s.replace(/\s+/g, ' ').trim()).catch(() => '');
  const body = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  const open = async (until) => { await page.goto(base + '/finance.html'); await page.waitForSelector(until || '[data-testid^="fin-row-"]', { timeout: 20000 }).catch(() => {}); await page.waitForTimeout(400); };
  const rows = () => page.locator('[data-testid^="fin-row-"]').count();

  await page.setViewportSize({ width: 1366, height: 768 });   /* the house desktop standard (Athi, 17 Nov); the walk had inherited the helper's 1280 */
  await open();

  await w.step('F1', 'Collections -> only the three customers who owe us are listed (no supplier, no settled customer), each named with its number', async () => {
    const n = await rows(), t = await body();
    const ok = n === 3 && /P-00001 · Sri Hardware/.test(t) && /Lakshmi Stores/.test(t) && /Kumar Traders/.test(t) && !/Bharat Steel/.test(t) && !/Settled Sons/.test(t);
    return { ok, saw: n + ' rows; ' + (/Bharat Steel/.test(t) ? 'the supplier is showing' : 'no supplier') + '; ' + (/Settled Sons/.test(t) ? 'the settled customer is showing' : 'no settled customer') };
  });
  await w.step('F2', 'Collections -> the page asks the server for the finance view (finance=1) and only reads - nothing is written on opening', async () => {
    const q = S.asked[0] || '';
    return { ok: /finance=1/.test(q) && S.writes.length === 0, saw: 'asked ' + (q || 'nothing') + '; writes: ' + S.writes.length };
  });
  await w.step('F3', 'Collections -> the amounts are the server\'s figures: Sri Hardware 1,20,000 · limit 1,00,000 · interest 1,500', async () => {
    const r = await txt('[data-testid="fin-row-pa"]');
    return { ok: /1,?20,?000/.test(r) && /1,?00,?000/.test(r) && /1,?500/.test(r), saw: r.slice(0, 160) };
  });
  await w.step('F4', 'Collections -> Sri Hardware carries "Over limit" and sits in the Over limit group, first; the group head counts 1 party in words', async () => {
    const r = await txt('[data-testid="fin-row-pa"]'), head = await txt('[data-testid="fin-group-over"]'), others = await txt('[data-testid="fin-group-coll"]');
    return { ok: /Over limit/.test(r) && /1 party/.test(head) && /they owe you/.test(head) && /2 parties/.test(others), saw: 'row: ' + /Over limit/.test(r) + ' | head "' + head.slice(0, 70) + '" | other group "' + others.slice(0, 70) + '"' };
  });
  await w.step('F5', 'Collections -> Kumar Traders (no terms set anywhere) says "Not set" for limit and interest - never a zero or a guessed rate', async () => {
    const r = await txt('[data-testid="fin-row-pc"]'), hasInterest = await page.locator('[data-testid="fin-row-pc"] [data-b="interest"]').count();
    const unset = await page.locator('[data-testid="fin-row-pc"] [data-b="limit-unset"], [data-testid="fin-row-pc"] [data-b="interest-unset"]').count();
    return { ok: hasInterest === 0 && unset === 2 && /Not set/.test(r), saw: unset + ' "Not set" cell(s); ' + r.slice(0, 120) };
  });
  await w.step('F6', 'Collections -> type "lakshmi" in the search box -> one party is left', async () => {
    await page.fill('[data-testid="listctl-search-fin-collect"]', 'lakshmi'); await page.waitForTimeout(400);
    const n = await rows(); await page.fill('[data-testid="listctl-search-fin-collect"]', ''); await page.waitForTimeout(300);
    return { ok: n === 1, saw: n + ' row(s) for "lakshmi"' };
  });
  await w.step('F7', 'Collections -> Receive on Sri Hardware -> the payment sheet opens for Sri Hardware (the one payment path)', async () => {
    await page.click('[data-testid="fin-receive-pa"]'); await page.waitForSelector('#fin_sheet[open]', { timeout: 6000 });
    const t = await txt('[data-testid="pay_title"]');
    await page.click('#fin_sheet .mx').catch(() => {}); await page.waitForTimeout(300);
    return { ok: /Receive/.test(t), saw: 'sheet title "' + t + '"; writes: ' + S.writes.length };
  });
  await w.step('F8', 'Collections -> Remind on Kumar Traders (no open bill) -> told in a sentence, no sheet, nothing sent', async () => {
    await page.click('[data-testid="fin-remind-pc"]'); await page.waitForTimeout(900);
    const t = await body(), sheet = await page.locator('#fin_sheet[open]').count();
    return { ok: /No open bill to remind about/.test(t) && sheet === 0 && S.writes.length === 0, saw: (/No open bill/.test(t) ? 'the sentence showed' : 'no sentence') + '; sheet ' + (sheet ? 'OPEN' : 'closed') + '; writes: ' + S.writes.length };
  });
  await w.step('F9', 'Collections (this login may not see them) -> the owner-only sentence, greyed, and no list at all', async () => {
    S.mode = 'denied'; await open('[data-testid="fin-denied"]');
    const why = await txt('[data-testid="fin-denied-why"]'), n = await rows();
    S.mode = 'ok';
    return { ok: /Only the owner may see collections/.test(why) && n === 0, saw: '"' + why + '"; ' + n + ' rows' };
  });
  await w.step('F10', 'Collections (the read fails) -> a plain sentence to try again, never the raw server message', async () => {
    S.mode = 'broken'; await open('[data-testid="fin-list"]'); await page.waitForTimeout(600);
    const t = await body(); S.mode = 'ok';
    return { ok: /Could not read who owes you/.test(t) && /Try again/.test(t) && !/database timeout|10\.0\.0\.5/.test(t), saw: (/Could not read who owes you/.test(t) ? 'plain sentence' : 'NO plain sentence') + '; ' + (/database timeout|10\.0\.0\.5/.test(t) ? 'RAW MESSAGE SHOWING' : 'no raw message') };
  });
  await w.step('F11', 'Collections (nobody owes us) -> "Nobody owes you money", not an empty grid', async () => {
    S.rows = ROWS.filter((x) => x.side === 'supplier'); await open('[data-testid="fin-list"]'); await page.waitForTimeout(600);
    const t = await body(), n = await rows(); S.rows = ROWS;
    return { ok: /Nobody owes you money/.test(t) && n === 0, saw: (/Nobody owes you money/.test(t) ? 'the empty sentence showed' : 'no empty sentence') + '; ' + n + ' rows' };
  });
  await w.step('F13', 'the ledger is off (M212) -> "Your ledger is off" and the owner switch (Turn on), on Collections AND on Terms; Turn on asks first and sends nothing until yes', async () => {
    S.mode = 'off'; await open('[data-testid="fin-off"]');
    const t1 = await txt('[data-testid="fin-off"]'), on1 = await page.locator('[data-testid="fin-turn-on"]').isEnabled().catch(() => false);
    const w0 = S.writes.length;
    await page.click('[data-testid="fin-turn-on"]'); await page.waitForTimeout(500);
    const asked = /Switch the Ledger on/.test(await body()), sent = S.writes.length - w0;
    await page.goto(base + '/finance.html#/terms'); await page.waitForSelector('[data-testid="fin-off"]', { timeout: 20000 }).catch(() => {}); await page.waitForTimeout(400);
    const t2 = await txt('[data-testid="fin-off"]'); S.mode = 'ok';
    return { ok: /Your ledger is off/.test(t1) && on1 && asked && sent === 0 && /Your ledger is off/.test(t2), saw: '"' + t1 + '"; enabled ' + on1 + '; asked first ' + asked + '; writes before yes ' + sent + '; Terms: "' + t2 + '"' };
  });
  /* FIN-72 · the follow-up view: the server's days-past-due split, painted and never computed */
  await w.step('F14', 'Collections -> the head shows the totals by days past due (1–30 · 31–60 · 61–90 · 90+) and "Current" apart, in money', async () => {
    await open();   /* F13 left the page on the Terms tab with the ledger off: read Collections afresh (mode is ok again) */
    const chips = await page.locator('[data-testid^="fin-age-"]').evaluateAll((els) => els.map((el) => el.getAttribute('data-testid') + '=' + el.textContent.replace(/\s+/g, ' ').trim()));
    const t = chips.join(' | ');
    const ok = chips.length === 5 && /d90_plus=90\+ days .*1,?20,?000/.test(t) && /d61_90=61–90 days .*45,?000/.test(t) && /d0_30=1–30 days/.test(t) && /not_due=Current .*8,?000/.test(t);
    return { ok, saw: t.slice(0, 260) };
  });
  await w.step('F15', 'Collections -> each Age says its oldest late bucket in days (Sri Hardware "90+ days", Lakshmi "61–90 days"); Kumar, not yet due, says "Current"', async () => {
    const a = await txt('[data-testid="fin-row-pa"] [data-b="age"]'), b = await txt('[data-testid="fin-row-pb"] [data-b="age"]'), c = await txt('[data-testid="fin-row-pc"] [data-b="age"]');
    return { ok: /90\+ days/.test(a) && /61–90 days/.test(b) && /Current/.test(c), saw: '"' + a + '" | "' + b + '" | "' + c + '"' };
  });
  await w.step('F16', 'Collections -> Show 61–90 days -> only Lakshmi Stores is left (the filter reads the worst code)', async () => {
    if (!await page.locator('[data-testid="cbl-filters-pop-fin-collect"]').count()) await page.click('[data-testid="cbl-filters-fin-collect"]').catch(() => {});
    await page.selectOption('[data-testid="listctl-filter-flag"]', 'd61_90'); await page.waitForTimeout(400);
    const n = await rows(), t = await body();
    await page.selectOption('[data-testid="listctl-filter-flag"]', ''); await page.waitForTimeout(300);
    return { ok: n === 1 && /Lakshmi Stores/.test(t), saw: n + ' row(s)' };
  });
  await w.step('F17', 'Collections -> a bill with no due date and no credit days anywhere -> "Set your credit days" (a note that opens Terms); absent when the shop has days', async () => {
    S.total = Object.assign({}, TOTAL, { no_terms_minor: 800000, terms: 'not_set' }); await open();
    const on = await page.locator('[data-testid="fin-set-terms"]').count();
    S.total = TOTAL; await open();
    const off = await page.locator('[data-testid="fin-set-terms"]').count();
    return { ok: on === 1 && off === 0, saw: 'note ' + on + ' (not set) · ' + off + ' (days set)' };
  });
  await w.step('F18', 'Collections -> an answer with no follow_up (an older server) shows no chips, no age word and no note (W15-94: no second ageing to fall back on)', async () => {
    S.total = null; S.rows = ROWS.map((x) => Object.assign({}, x, { follow_up: undefined })); await open();
    const chips = await page.locator('[data-testid^="fin-age-"]').count(), age = await txt('[data-testid="fin-row-pa"] [data-b="age"]'), note = await page.locator('[data-testid="fin-set-terms"]').count();
    S.total = TOTAL; S.rows = ROWS; await open();
    return { ok: chips === 0 && age === '' && note === 0, saw: chips + ' chips; age "' + age + '"; note ' + note };
  });
  for (const theme of ['cream', 'dark']) {
    for (const [width, height] of [[1366, 768], [390, 844]]) {
      await w.step('F19-' + theme + '-' + width, 'screen rules · ' + (theme === 'cream' ? 'light' : 'dark') + ' · ' + width + 'x' + height + ' -> the page does not scroll, the head stays inside the width, nothing is clipped, no app.html link', async () => {
        await page.setViewportSize({ width, height }); await open(); await page.evaluate((t) => CBAvatar.applyTheme(t), theme).catch(() => {}); await page.waitForTimeout(400);
        const m = await page.evaluate(() => {
          const de = document.documentElement, head = document.querySelector('.cbl-title');
          const chips = Array.from(document.querySelectorAll('.cbl-title .cbl-chip')).filter((el) => el.offsetParent);
          const clipped = chips.filter((el) => el.scrollWidth > el.clientWidth + 1).length;
          return { vScroll: de.scrollHeight - de.clientHeight, hScroll: de.scrollWidth - de.clientWidth, headOver: head ? head.scrollWidth - head.clientWidth : 0, clipped, appLinks: document.querySelectorAll('a[href*="app.html"]').length };
        });
        await page.screenshot({ path: 'e2e/shots/walk-finance-fu-' + theme + '-' + width + '.png' }).catch(() => {});
        return { ok: m.vScroll <= 1 && m.hScroll <= 1 && m.headOver <= 1 && m.clipped === 0 && m.appLinks === 0, saw: JSON.stringify(m) };
      });
    }
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await w.step('M43', 'the stand-in answered every /api/books call as the API contract says', async () => { const [ok, saw] = C.finish(); return { ok, saw }; });
  w.note('F12', 'Batch Remind (select parties -> Remind -> the queue sheet, one Remind after another) and a Remind that reaches the message composer', 'needs the chit + rail-thread stand-in (walk-rail-two-sided); not asserted here');
});
