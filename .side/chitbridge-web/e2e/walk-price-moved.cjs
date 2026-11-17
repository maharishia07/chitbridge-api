#!/usr/bin/env node
/**
 * e2e/walk-price-moved.cjs - CTR-245 (api ctr/ctr-245-price-moved, CTR-212 S4): THE "PRICES HAVE MOVED" QUESTION WALKED, over the compose send.
 * Library card 09-counter/README. Black box: the page is the workshop (public/app.html), the shop is a FIXTURE shop, POST /api/chits/send is a stand-in inside the page (nothing reaches a server).
 * The stand-in answers the first send of a promoted draft with 409 PRICE_MOVED (the server's body: lines, can_send_as_drafted, ack) and records every body it is sent.
 * Hand figures: line 2 x 100.00, the catalogue now 120.00 (12000 minor) -> the question shows the engine's totals 236.00 > 283.20 and who gets it; new prices send price 120 with no line total (the server's engine decides), as drafted sends price 100 and the signed ack unchanged.
 *
 *   P1  a send that is answered 409 PRICE_MOVED opens the question over the page: the moved line with both figures, three choices, nothing sent yet
 *   P2  Use the new prices: sent again with price 120, no ack; the question is gone
 *   P3  Send as drafted: sent again with price 100 and the server's ack, unchanged
 *   P4  a rate that moved: no Send as drafted button, the sentence says why; Use the new prices carries the new rate
 *   P5  Back to the draft and Escape: nothing is sent, the draft is as it was
 *   P6  an ordinary failure says its own words (the server could not save it), no question is opened
 *   K1  KEYBOARD ONLY: the question takes focus on its primary choice, Tab reaches every choice, Escape answers Back, no trap
 *   R1-R4 screen rules (BRIEF-RULES 13): Cream and Dark at 1366 and 390 - AA contrast of every text, no clipping, nothing over a control
 *
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-price-moved.cjs      headless        --show   headed, a caption per step
 */
'use strict';
const W = require('./lib/walk.cjs');
const { rule13 } = require('./lib/rule13.cjs');

/** the module under test, by path: the walk proves it was really loaded by the page (the knowledge graph reads this name as the tested-by link) */
const UNDER_TEST = ['public/app/chit-price-moved.js'];
const ITEM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACK = 'eyJhbGciOiJIUzI1NiJ9.eyJraW5kIjoicHJpY2VfYWNrIn0.c2lnbmVk'; /* the server's ack is a signed token: opaque here */
const PRICE = { line_id: 'l1', item_id: ITEM, name: 'Basmati rice 5 kg', kind: 'price_moved', was_minor: 10000, now_minor: 12000, was_rate: null, now_rate: null, changed_at: '2026-11-13T09:00:00.000Z' };
const RATE = { line_id: 'l1', item_id: ITEM, name: 'Basmati rice 5 kg', kind: 'rate_moved', was_minor: null, now_minor: null, was_rate: 18, now_rate: 12, changed_at: '2026-11-13T09:00:00.000Z' };
const MOVED = (lines, drafted) => ({ code: 'PRICE_MOVED', error: 'Prices have moved since this draft was made.', message: 'One item in this draft changed.', lines, can_send_as_drafted: drafted, ack: ACK, total: { currency: 'INR', before: 236, after: 283.2 }, reach: { recipients: ['Sri Ganesh Provisions'], lines: 1 } });

/** RULE 13 measures THIS popup: the workshop behind it is not the popup and has its own walks. The rest of the page is made invisible (not removed) while it is measured. */
const scope = (page, host) => page.evaluate((h) => { const st = document.createElement('style'); st.id = '__scope'; st.textContent = 'body *:not(' + h + '):not(' + h + ' *):not(:has(' + h + ')){visibility:hidden!important}'; document.head.appendChild(st); }, host);
const unscope = (page) => page.evaluate(() => { const st = document.getElementById('__scope'); if (st) st.remove(); });

W.run('price-moved', async (w) => {
  const { page, ctx, base } = w;
  const fetched = new Set();
  page.on('request', (q) => { const m = /[/]app[/](chit-price-moved[.]js)/.exec(q.url()); if (m) fetched.add('public/app/' + m[1]); });
  const S = { sends: [], next: [] };
  const answer = async (route) => {
    const request = route.request(), p = new URL(request.url()).pathname;
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*' } });
    if (p === '/api/chits/send' && request.method() === 'POST') {
      S.sends.push(JSON.parse(request.postData() || '{}'));
      const scripted = S.next.shift();
      return scripted ? json(scripted.status, scripted.body) : json(200, { chit_id: 'c-new', copies: 1 });
    }
    return json(200, {});
  };
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Books Shop', 'Books Shop'));
  await ctx.route('**/api/**', answer);
  await page.goto(base + '/app.html#/app');
  await page.waitForFunction(() => typeof sendChit === 'function' && typeof renderApp === 'function' && !!window.CBPriceMoved, null, { timeout: 30000 });
  await page.waitForTimeout(1200);

  /** a draft promoted from the page's own sendChit, as the compose modal does: one rice line, 2 x 100.00 */
  const promote = (first) => {
    S.sends = [];
    S.next = first;
    return page.evaluate(() => {
      window.__errors = [];
      sendChit({ recipients: [{ name: 'self', role: 'to', self: true }], isDraft: false, subject: 'Rice', line_items: [{ particulars: 'Basmati rice 5 kg', unit: 'bag', quantity: 2, price: 100, total: 200, comment: '', ref: { item_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', how: 'picked' }, gst_rate: 18 }], promote_draft_id: 'draft-1', onError: (m) => window.__errors.push(m) });
    });
  };
  const open = () => page.locator('[data-testid="price-moved"]');
  const text = () => page.evaluate(() => ((document.querySelector('[data-testid="price-moved"]') || {}).innerText || '').replace(/[ \t\r\n]+/g, ' ').trim());
  const sendCount = () => S.sends.length;

  await w.step('P1', 'A send answered 409 PRICE_MOVED opens the question over the page: the line with both figures, the choices, nothing sent yet (one send was tried, none went through)', async () => {
    await promote([{ status: 409, body: MOVED([PRICE], true) }]);
    await open().waitFor({ state: 'visible', timeout: 8000 });
    const t = await text();
    const choices = await page.locator('[data-testid="price-moved"] button').count();
    return { ok: /Prices have moved/.test(t) && /Basmati rice 5 kg/.test(t) && /price changed/.test(t) && /100\.00/.test(t) && /120\.00/.test(t) && choices === 3 && sendCount() === 1, saw: t.slice(0, 160) + ' · buttons ' + choices + ' · sends ' + sendCount() };
  });
  await w.step('P1b', 'The module was fetched and ran: ' + UNDER_TEST.join(' · '), async () => {
    const ran = await page.evaluate(() => typeof CBPriceMoved.failed === 'function');
    return { ok: UNDER_TEST.every((f) => fetched.has(f)) && ran, saw: UNDER_TEST.map((f) => f.replace('public/app/', '') + (fetched.has(f) ? ' fetched' : ' NOT fetched')).join(' · ') };
  });
  await scope(page, '#cb_pricemoved');
  await rule13(w, 'R', 'the prices-have-moved question', 'cb_pricemoved', null, async () => { await unscope(page); await scope(page, '#cb_pricemoved'); });
  await unscope(page);

  await w.step('P2', 'Use the new prices: sent again with price 120 and no ack; the question is gone', async () => {
    await page.locator('[data-testid="price-moved-new"]').click();
    await page.waitForTimeout(600);
    const second = S.sends[1] || {}, line = (second.line_items || [])[0] || {};
    return { ok: sendCount() === 2 && line.price === 120 && !('total' in line) && second.price_ack == null && second.promote_draft_id === 'draft-1' && (await open().count()) === 0, saw: 'price ' + line.price + ' total ' + line.total + ' ack ' + JSON.stringify(second.price_ack) };
  });

  await w.step('P3', 'Send as drafted: sent again with price 100 and the server\'s ack, unchanged', async () => {
    await promote([{ status: 409, body: MOVED([PRICE], true) }]);
    await open().waitFor({ state: 'visible', timeout: 8000 });
    await page.locator('[data-testid="price-moved-drafted"]').click();
    await page.waitForTimeout(600);
    const second = S.sends[1] || {}, line = (second.line_items || [])[0] || {};
    return { ok: sendCount() === 2 && line.price === 100 && JSON.stringify(second.price_ack) === JSON.stringify(ACK), saw: 'price ' + line.price + ' ack ' + JSON.stringify(second.price_ack) };
  });

  await w.step('P4', 'A rate that moved: no Send as drafted, the sentence says why; Use the new prices carries the new rate (12)', async () => {
    await promote([{ status: 409, body: MOVED([RATE], false) }]);
    await open().waitFor({ state: 'visible', timeout: 8000 });
    const t = await text(), drafted = await page.locator('[data-testid="price-moved-drafted"]').count();
    await page.locator('[data-testid="price-moved-new"]').click();
    await page.waitForTimeout(600);
    const second = S.sends[1] || {}, line = (second.line_items || [])[0] || {};
    return { ok: drafted === 0 && /cannot be sent as drafted/.test(t) && /18% > 12%/.test(t) && line.gst_rate === 12 && line.price === 100 && second.price_ack == null, saw: t.slice(0, 150) + ' · rate sent ' + line.gst_rate };
  });

  await w.step('P5', 'Back to the draft, and Escape: nothing more is sent (the first try only), the question is gone', async () => {
    await promote([{ status: 409, body: MOVED([PRICE], true) }]);
    await open().waitFor({ state: 'visible', timeout: 8000 });
    await page.locator('[data-testid="price-moved-back"]').click();
    const afterBack = sendCount(), goneBack = (await open().count()) === 0;
    await promote([{ status: 409, body: MOVED([PRICE], true) }]);
    await open().waitFor({ state: 'visible', timeout: 8000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    return { ok: afterBack === 1 && goneBack && sendCount() === 1 && (await open().count()) === 0, saw: 'sends after Back ' + afterBack + ' · after Escape ' + sendCount() };
  });

  await w.step('P6', 'An ordinary failure says its own words (could not save, in words) and opens no question', async () => {
    await promote([{ status: 500, body: { error: 'Failed', message: 'We could not save the chit just now.' } }]);
    await page.waitForFunction(() => (window.__errors || []).length > 0, null, { timeout: 8000 });
    const said = await page.evaluate(() => window.__errors[0]);
    return { ok: /could not save/i.test(said) && (await open().count()) === 0, saw: said };
  });

  await w.step('K1', 'KEYBOARD ONLY: the question takes focus on Use the new prices, Tab reaches the other choices, Escape answers Back (no trap)', async () => {
    await promote([{ status: 409, body: MOVED([PRICE], true) }]);
    await open().waitFor({ state: 'visible', timeout: 8000 });
    const first = await page.evaluate(() => (document.activeElement || {}).getAttribute && document.activeElement.getAttribute('data-testid'));
    const seen = new Set([first]);
    for (let n = 0; n < 4; n++) { await page.keyboard.press('Tab'); seen.add(await page.evaluate(() => document.activeElement.getAttribute('data-testid'))); }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const all = ['price-moved-new', 'price-moved-drafted', 'price-moved-back'].every((id) => seen.has(id));
    return { ok: first === 'price-moved-new' && all && (await open().count()) === 0 && sendCount() === 1, saw: 'first ' + first + ' · reached ' + [...seen].join(',') };
  });
});
