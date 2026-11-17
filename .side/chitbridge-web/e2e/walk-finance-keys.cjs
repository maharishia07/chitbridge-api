#!/usr/bin/env node
/**
 * e2e/walk-finance-keys.cjs - CB FINANCE · COLLECTIONS, KEYBOARD (cb-ux-locale, 2026-11-12): Tab to the far-right Remind button at 1366 must not push the grid
 * sideways: the Party column stays on screen, the list pane's scrollLeft stays 0 and nothing is cut at either edge.
 * Same fixture and stand-in api as walk-finance.cjs (FIXTURE shop; nothing leaves the page). One line per check.
 *   NODE_PATH=<dir with @playwright/test> node e2e/walk-finance-keys.cjs
 * OWNS      the keyboard reach of the Collections list. CALLED BY the cloud walks. FLOW  open finance.html -> Tab along the first row -> read scrollLeft and the Party cell's box.
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 */
'use strict';
const TD = require('./lib/today.cjs');
const W = require('./lib/walk.cjs');
const books = require('./lib/books-api.cjs');
const C = require('./lib/contract.cjs');   /* M43: every /api/books answer this stand-in serves is held to the API contract */
const J = (r, status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const crmApi = require('./lib/crm-api.cjs');   /* RAIL-LAB-SRV1: the rail card (GET /api/facts/rail) from its one builder */

const walk = async (w) => {
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

  const open = async () => { await page.goto(base + '/finance.html'); await page.waitForSelector('[data-testid^="fin-row-"]', { timeout: 20000 }).catch(() => {}); await page.waitForTimeout(500); };
  /* where the list pane has scrolled to, and whether the first row's party name is still fully inside the pane */
  const reading = () => page.evaluate(() => {
    const scrollers = Array.from(document.querySelectorAll('*')).filter((e) => e.scrollWidth > e.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(e).overflowX));
    const row = document.querySelector('[data-testid^="fin-row-"]'), pane = row && (row.closest('.cbl') || row.parentElement);
    const tw = row && document.createTreeWalker(row, NodeFilter.SHOW_TEXT); let node = null, range = null;
    while (tw && (node = tw.nextNode())) { if (/Sri Hardware/.test(node.nodeValue)) { range = document.createRange(); range.selectNodeContents(node); break; } }
    const pr = range && range.getBoundingClientRect(), cr = pane && pane.getBoundingClientRect();
    return { scrollers: scrollers.map((e) => (e.className || e.tagName) + ':' + e.scrollLeft + '/' + (e.scrollWidth - e.clientWidth)), pageX: document.documentElement.scrollLeft, partyLeft: pr ? Math.round(pr.left) : null, paneLeft: cr ? Math.round(cr.left) : null, doc: document.documentElement.scrollWidth, win: innerWidth };
  });

  await open();
  await w.step('K1', 'Collections at 1366 -> before any key, the Party column is at the left edge of the list and no pane has anything to scroll sideways', async () => {
    const r = await reading();
    return { ok: r.partyLeft != null && r.partyLeft >= r.paneLeft && r.pageX === 0 && r.scrollers.length === 0, saw: JSON.stringify(r) };
  });
  await w.step('K2', 'Collections at 1366 -> Tab to the far-right Remind button: the Party column is still on screen and no pane has scrolled sideways', async () => {
    const remind = page.locator('[data-testid^="fin-row-"] button', { hasText: 'Remind' }).first();
    await page.locator('[data-testid^="fin-row-"]').first().focus().catch(() => {});
    let hit = false;
    for (let i = 0; i < 30 && !hit; i++) { await page.keyboard.press('Tab'); hit = await remind.evaluate((e) => e === document.activeElement).catch(() => false); }
    await page.waitForTimeout(200);
    const r = await reading();
    return { ok: hit && r.partyLeft >= r.paneLeft && r.pageX === 0 && r.scrollers.every((s) => /:0\//.test(s)), saw: 'reached Remind: ' + hit + ' ' + JSON.stringify(r) };
  });
  await w.step('K3', 'Collections at 390 -> Tab to the shop button in the top bar: its focus ring is drawn and it still shows the shop name', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open();
    await page.locator('[data-testid="shell-shop"]').focus();
    await page.waitForTimeout(150);
    const r = await page.evaluate(() => {
      const who = document.querySelector('[data-testid="shell-shop"]'), b = who.querySelector('b'), c = getComputedStyle(who), box = b && b.getBoundingClientRect();
      return { name: b ? b.textContent.trim() : '', shown: !!box && box.width > 8 && getComputedStyle(b).display !== 'none', nameW: box ? Math.round(box.width) : 0, ring: c.outlineStyle + ' ' + c.outlineWidth, label: who.getAttribute('aria-label') || '', barW: document.querySelector('.cbsh-bar').clientWidth };
    });
    return { ok: r.shown && r.name.length > 0 && /solid|auto/.test(r.ring), saw: JSON.stringify(r) };
  });
};
walk.opts = { viewport: { width: 1366, height: 768 } };   /* the browser's real 1366 screen */
W.run('finance-keys', walk);
