#!/usr/bin/env node
/**
 * e2e/walk-match-other-unit.cjs — CTR-248 (api #1194, OPS-87): THE MATCH SCREEN WALKED, with a line counted in ANOTHER UNIT.
 * Library card 03-disputes-service-and-register/three-way-match. Black box: the page is the workshop (public/app.html), the shop is a FIXTURE
 * shop, GET /api/till/match is a stand-in answering inside the page (nothing reaches a server). The fixture carries the three kinds of line:
 * ordered 10 box / counted 4 box + 2 dozen (counted_in_another_unit), a plain shortfall with the door's reason, and a line that agrees.
 *
 *   M1  Match › "Does not agree": the order is listed with its verdict; its row opens to the lines, the three figures and the money gap
 *   M1b the page fetched and ran the capability: public/app/cap-match.js
 *   M2  the box line says BOTH in one cell: "short 6 · counted in another unit: dozen mine 2 / theirs 2" — the other unit is never summed into the box total
 *   M3  the plain shortfall says "short 3" and the door's reason; the line that agrees says "agrees"
 *   M4  the other-unit words are never a conversion (no "= 24", no "equals"), and the line never reads "undefined" or "[object"
 *   M5  the match could not be read -> the screen says so in words and does NOT say "No purchase orders yet"
 *   M6  the string layer: in the pseudo-language (qps) the other-unit cell comes from the string layer, none hard-wired
 *   K1  KEYBOARD ONLY: Tab reaches the state chips and the days select, Enter on a chip changes the list, Escape is not needed (no trap)
 *   K2  KEYBOARD ONLY: the order row opens and closes from the keyboard (Enter), and the Raise a dispute button is reachable by Tab
 *   R1–R4 screen rules (BRIEF-RULES 13): Cream and Dark at 1366 and 390 — AA contrast of every text, no clipping, nothing over a control
 *
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-match-other-unit.cjs      headless        --show   headed, a caption per step
 */
'use strict';
const W = require('./lib/walk.cjs');
const { rule13 } = require('./lib/rule13.cjs');

/** the capability under test, by path: the walk proves it was really fetched and run by the page (the knowledge graph reads this name as the tested-by link) */
const UNDER_TEST = ['public/app/cap-match.js'];
const WORDS = 'short 6 · counted in another unit: dozen mine 2 / theirs 2';

const ORDERS = {
  orders: [
    { chit_id: 'po1', party: 'Sri Ganesh Provisions', at: '2026-11-02T08:00:00Z', subject: 'Weekly order', verdict: 'differs',
      ordered_total: 1200, received_total: 1000, invoiced_total: 1150, invoiced_from: 'their paper bill SG-1022', received_with_tax: 1000, money_gap: -150, money_code: 'apart',
      lines: [
        { name: 'Eggs', ordered: 10, unit: 'box', received: 4, difference: -6, state: 'short', reason: null, counted_in_another_unit: true, other_units: [{ unit: 'dozen', mine: 2, theirs: 2 }] },
        { name: 'Oil', ordered: 10, unit: 'L', received: 7, difference: -3, state: 'short', reason: 'one can leaked', counted_in_another_unit: false, other_units: [] },
        { name: 'Rice', ordered: 20, unit: 'kg', received: 20, difference: 0, state: 'agreed', reason: null, counted_in_another_unit: false, other_units: [] }
      ],
      receipts: [{ no: 'G/C1/26-27/0002', their_bill_no: 'SG-1022' }] },
    { chit_id: 'po2', party: 'Kumar Traders', at: '2026-11-03T08:00:00Z', subject: 'Salt', verdict: 'agreed',
      ordered_total: 300, received_total: 300, invoiced_total: 300, invoiced_from: null, received_with_tax: 300, money_gap: 0, money_code: 'agrees',
      lines: [{ name: 'Salt', ordered: 30, unit: 'kg', received: 30, difference: 0, state: 'agreed', reason: null, counted_in_another_unit: false, other_units: [] }], receipts: [] }
  ]
};

/** RULE 13 measures THIS screen: the workshop around it is not the match screen and has its own walks. The rest of the page is made invisible (not removed) while it is measured. */
const scope = (page, host) => page.evaluate((h) => { const st = document.createElement('style'); st.id = '__scope'; st.textContent = 'body *:not(' + h + '):not(' + h + ' *):not(:has(' + h + ')){visibility:hidden !important}'; document.head.appendChild(st); }, host);
const unscope = (page) => page.evaluate(() => { const st = document.getElementById('__scope'); if (st) st.remove(); });

W.run('match-other-unit', async (w) => {
  const { page, ctx, base } = w;
  const fetched = new Set();
  page.on('request', (q) => { const m = /[/]app[/](cap-[a-z0-9-]+[.]js)/.exec(q.url()); if (m) fetched.add('public/app/' + m[1]); });
  const S = { down: false, reads: 0 };
  const answer = async (route) => {
    const u = new URL(route.request().url()), p = u.pathname;
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*' } });
    if (p === '/api/till/match') { S.reads++; return S.down ? json(500, { error: 'Failed', message: 'Could not read the match just now.' }) : json(200, ORDERS); }
    return json(200, {});
  };
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Books Shop', 'Books Shop'));
  await ctx.route('**/api/**', answer);
  await page.goto(base + '/app.html#/app');
  await page.waitForFunction(() => typeof ensureCap === 'function' && typeof renderApp === 'function', null, { timeout: 30000 });
  await page.waitForTimeout(1500);

  const text = (sel) => page.evaluate((s) => ((document.querySelector(s) || {}).innerText || '').replace(/[ \t\r\n]+/g, ' ').trim(), sel);
  const openMatch = async (open) => {
    await page.evaluate(async (o) => { await ensureCap('match'); MATCH.rows = null; MATCH.error = null; MATCH.only = 'differs'; MATCH.open = o; UI.nav = 'match'; renderApp(); }, open || null);
    await page.waitForSelector('[data-testid="match-screen"] [data-testid="match-order"], [data-testid="match-screen"]', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);
  };

  await w.step('M1', 'Match -> "Does not agree" lists the order with its verdict; opened, it shows the three figures and the lines; the money note waits while lines are short (OPS-83)', async () => {
    await openMatch('po1');
    const t = await text('[data-testid="match-screen"]'), orders = await page.locator('[data-testid="match-order"]').count(), lines = await page.locator('[data-testid="match-line"]').count();
    return { ok: orders === 1 && /Sri Ganesh Provisions/.test(t) && /Does not agree/.test(t) && lines === 3 && /1,?200/.test(t) && /1,?150/.test(t) && !(await page.locator('[data-testid="match-gap"]').count()) && /their paper bill SG-1022/.test(t), saw: orders + ' order · ' + lines + ' lines · "' + t.slice(0, 150) + '"' };
  });
  await w.step('M1b', 'The page fetched and ran the capability: ' + UNDER_TEST.join(' · '), async () => {
    const ran = await page.evaluate(() => typeof matchScreen === 'function' && typeof matchDiffCell === 'function');
    return { ok: UNDER_TEST.every((f) => fetched.has(f)) && ran, saw: UNDER_TEST.map((f) => f.replace('public/app/', '') + (fetched.has(f) ? ' fetched' : ' NOT fetched')).join(' · ') };
  });
  await w.step('M2', 'The box line says BOTH in one cell: "' + WORDS + '" — the dozens are never summed into the boxes', async () => {
    const cell = await page.locator('[data-testid="match-line"]').nth(0).innerText().then((s) => s.replace(/\s+/g, ' ').trim());
    return { ok: /^Eggs 10 box 4 /.test(cell) && cell.indexOf(WORDS) >= 0, saw: '"' + cell + '"' };
  });
  await w.step('M3', 'The plain shortfall says "short 3" with the door\'s reason; the line that agrees says "agrees"', async () => {
    const oil = await page.locator('[data-testid="match-line"]').nth(1).innerText().then((s) => s.replace(/\s+/g, ' ').trim());
    const rice = await page.locator('[data-testid="match-line"]').nth(2).innerText().then((s) => s.replace(/\s+/g, ' ').trim());
    return { ok: /short 3 · one can leaked/.test(oil) && !/another unit/.test(oil) && /agrees$/.test(rice), saw: '"' + oil + '" · "' + rice + '"' };
  });
  await w.step('M4', 'No conversion is guessed: the other-unit words never say "= 24" or "equals", and no line reads "undefined" or "[object"', async () => {
    const t = await text('[data-testid="match-screen"]');
    return { ok: !/= ?\d|equals|undefined|\[object/.test(t), saw: 'screen text clean of conversion and raw values (' + t.length + ' chars)' };
  });
  await w.step('M5', 'The match cannot be read -> the screen says it could not read, NOT "No purchase orders yet"', async () => {
    S.down = true; await openMatch(); S.down = false;
    const t = await text('[data-testid="match-screen"]');
    return { ok: /Could not read the match just now/.test(t) && !/No purchase orders yet/.test(t) && !/undefined|\[object/.test(t), saw: '"' + t.slice(0, 160) + '"' };
  });

  /* ── the string layer: the pseudo-locale pack makes a hard-wired word visible ── */
  await w.step('M6', 'Match in the pseudo-language (qps) -> the other-unit cell and the chips come from the string layer, none hard-wired', async () => {
    const c = await w.contextAt();
    await c.addInitScript(() => { try { localStorage.setItem('cb_lang', 'qps'); localStorage.setItem('cb_langs', 'qps'); localStorage.setItem('cb_locale', 'en-IN'); localStorage.setItem('cb_region', 'IN'); } catch (_) {} });
    await c.addInitScript((s) => { try { localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Books Shop', 'Books Shop'));
    await c.route('**/api/**', async (route) => {
      if (new URL(route.request().url()).pathname === '/api/entities/me') return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ entity: { display_name: 'Books Shop', currency_code: 'INR', country: 'IN', locale_prefs: { lang: 'qps', langs: 'qps' } } }) });
      return answer(route);
    });
    const p = await c.newPage();
    await p.goto(base + '/app.html#/app');
    await p.waitForFunction(() => typeof ensureCap === 'function' && typeof renderApp === 'function', null, { timeout: 30000 });
    await p.waitForTimeout(1500);
    await p.evaluate(async () => { await ensureCap('match'); MATCH.rows = null; MATCH.only = 'differs'; MATCH.open = 'po1'; UI.nav = 'match'; renderApp(); });
    await p.waitForSelector('[data-testid="match-line"]', { timeout: 8000 }).catch(() => {}); await p.waitForTimeout(300);
    const out = await p.evaluate(() => ({ cell: ((document.querySelector('[data-testid="match-line"]') || {}).innerText || '').replace(/\s+/g, ' '), chips: [...document.querySelectorAll('[data-testid^="match-chip-"]')].map((b) => b.textContent.trim()) }));
    await c.close();
    const wrapped = (s) => /\[!!.*!!\]/.test(s);
    return { ok: wrapped(out.cell) && out.chips.length === 5 && out.chips.every(wrapped) && !/counted in another unit: dozen/.test(out.cell), saw: 'cell "' + out.cell.slice(0, 120) + '" · chips ' + out.chips.join(' | ') };
  });

  /* ── keyboard only ── */
  const focusInfo = () => page.evaluate(() => { const a = document.activeElement || {}; return { id: a.getAttribute && a.getAttribute('data-testid'), tag: a.tagName }; });
  /** press Tab until the element with this data-testid has focus (at most 60 presses): reachable by keyboard alone */
  const tabTo = async (testid) => { for (let n = 0; n < 60; n++) { await page.keyboard.press('Tab'); if ((await focusInfo()).id === testid) return n + 1; } return 0; };
  await openMatch(null);
  await w.step('K1', 'KEYBOARD ONLY: Tab reaches the "Part arrived" chip, Enter on it switches the list (an empty state in words), the days select is reachable, no keyboard trap', async () => {
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); });
    const hops = await tabTo('match-chip-open');
    await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    const t = await text('[data-testid="match-screen"]'), pressed = await page.evaluate(() => MATCH.only);
    await page.evaluate(() => { const c = document.querySelector('[data-testid="match-chip-differs"]'); c && c.focus(); });
    const days = await tabTo('match-days');
    return { ok: hops > 0 && pressed === 'open' && /Nothing in this state/.test(t) && days > 0, saw: 'chip after ' + hops + ' Tabs; filter ' + pressed + '; "' + t.slice(0, 80) + '"; days select after ' + days + ' Tabs from the first chip' };
  });
  await page.evaluate(() => { MATCH.only = 'differs'; MATCH.open = null; renderApp(); }); await page.waitForTimeout(300);
  await w.step('K2', 'KEYBOARD ONLY: the order row is reached with Tab and opens with Enter (its lines show), and "Raise a dispute" is reached with Tab', async () => {
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); });
    const row = await page.evaluate(() => { const r = document.querySelector('[data-testid="match-order"] > div'); return { tab: r ? r.tabIndex : null, role: r ? r.getAttribute('role') : null }; });
    let hops = 0;
    for (let n = 0; n < 60 && !hops; n++) { await page.keyboard.press('Tab'); if (await page.evaluate(() => !!document.activeElement && !!document.activeElement.closest('[data-testid="match-order"]'))) hops = n + 1; }
    if (hops) { await page.keyboard.press('Enter'); await page.waitForTimeout(300); }
    const lines = await page.locator('[data-testid="match-line"]').count();
    const dispute = lines ? await tabTo('match-dispute') : 0;
    return { ok: hops > 0 && lines === 3 && dispute > 0, saw: 'row tabindex ' + row.tab + ' role ' + row.role + '; reached after ' + hops + ' Tabs; lines ' + lines + '; dispute button after ' + dispute + ' more Tabs' };
  });

  /* ── BRIEF-RULES 13: Cream and Dark, 1366 and 390 — the opened order with its lines and its other-unit cell ── */
  await openMatch('po1');
  await scope(page, '[data-testid="match-screen"]');
  await rule13(w, 'R', 'the match screen, an order opened (box counted in dozen)', 'match-host', null, async () => { await page.waitForTimeout(400); await unscope(page); await openMatch('po1'); await scope(page, '[data-testid="match-screen"]'); });
  await unscope(page);
});
