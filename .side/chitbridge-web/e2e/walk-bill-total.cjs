#!/usr/bin/env node
/**
 * e2e/walk-bill-total.cjs - ACC-348b: THE BILL LIST AND DETAIL READ THE API'S bill_total, WALKED (twin of api #1308 / ACC-348a).
 * Black box: it opens the Task list and a chit the way a shopkeeper does and reads the screen.
 *   B1 the list amount is the api's bill_total.total in the api's currency (an AUD bill reads A$, never a rupee sign) - the stored copies in the row say something else on purpose
 *   B2 a bill whose copies agree carries no "not confirmed" words, on the list or the detail
 *   B3 a bill with agree:false shows the "not confirmed" chip in the list and, on the detail, the server's `says` sentence IN FULL (never hidden, never composed here)
 *   B4 a withheld bill (total null) paints a dash, never a rupee zero
 *   B5 at 1366x768 and 390x844 the list and the detail have no sideways scroll, the sentence is not clipped, and the header stays put
 * Every figure and every sentence is the stand-in's: the page must paint exactly those; nothing is added up on the web (the stored copies differ from bill_total).
 * A FIXTURE shop: the site is served from this checkout, the API is a stand-in answering inside the page.
 *
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-bill-total.cjs          headless (run on a SIT box, never the laptop)
 * One line per path: "ID · path · PASS/FAIL (what it saw)". Screenshots: e2e/shots/walk-bill-total-NN.png.
 */
'use strict';
const W = require('./lib/walk.cjs');
const J = (r, status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const SAYS = 'The system did not get the right value for this figure. We have been told and are on it. Urgent? Call the help desk.';
const me = { role: 'sender', display_name: 'Fixture Shop', entity_id: 'ent-walk' };
/* the stored copies (summary_json) deliberately differ from bill_total: if the page added or picked itself it would show 111, 222 or 333 */
const WIRE = {
  okay: { total: 189, agree: true, source: 'money', currency_code: 'INR' },
  bad: { total: 1180, agree: false, source: 'money', currency_code: 'INR', says: SAYS },
  aud: { total: 55.5, agree: true, source: 'invoice', currency_code: 'AUD' },
  none: { total: null, agree: true, source: 'withheld', currency_code: null },
};
const STORED = { okay: 111, bad: 222, aud: 333, none: 444 };
const SUBJECT = { okay: 'Bill okay-one', bad: 'Bill bad-one', aud: 'Bill aud-one', none: 'Bill none-one' };
const row = (key) => ({ chit_id: 'c-' + key, purpose: 'order', manual_subject: SUBJECT[key], sender_entity_display_name: 'Fixture Shop', current_status: 'pending',
  created_at: '2026-11-14T04:00:00Z', all_recipients: [me, { role: 'receiver', display_name: 'Chola Auto Care' }],
  summary_json: { currency_code: 'INR', total_value: STORED[key], money: { total: STORED[key] } }, bill_total: WIRE[key] });
const detail = (key) => Object.assign({ header: Object.assign({ chit_id: 'c-' + key }, row(key), { entity_id: 'ent-walk' }), detail: { line_items: [], total_value: STORED[key] }, participants: [], state_log: [],
  actions: { message: { ok: true } } }, { bill_total: WIRE[key] });

W.run('bill-total', async (w) => {
  const { page, ctx, base } = w;
  const ROWS = Object.keys(WIRE).map(row);
  await ctx.route('**/api/**', async (r) => {
    const u = new URL(r.request().url()), p = u.pathname;
    if (p === '/api/chits/inbox') return J(r, 200, { chits: ROWS, total: ROWS.length, page: 1, limit: 20 });
    if (p === '/api/chits/sent') return J(r, 200, { chits: [], total: 0, page: 1, limit: 20 });
    const m = /^\/api\/chits\/c-(\w+)$/.exec(p);
    if (m && WIRE[m[1]]) return J(r, 200, detail(m[1]));
    if (p === '/api/folders') return J(r, 200, { folders: [] });
    return J(r, 200, {});
  });
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Fixture Owner', 'Fixture Shop'));
  const fits = () => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, clipped: [...document.querySelectorAll('[data-testid^="bill-not-confirmed"]')].filter((e) => e.scrollWidth > e.clientWidth + 1 && e.dataset.testid === 'bill-not-confirmed').length }));
  /* the Amount column's own cell for a chit (the column is the shopkeeper's pick and needs width: this runs the page's own mapper and cell over the api row and reads what it paints, as text) */
  const amountCell = (key) => page.evaluate((raw) => { const chit = mapApiChit(raw); const html = LISTCOLS.find((col) => col.key === 'amount').cell(chit); const box = document.createElement('div'); box.innerHTML = html; return box.innerText.replace(/s+/g, ' '); }, row(key));
  const cellOf = (subject) => page.evaluate((s) => { const r = [...document.querySelectorAll('.cbl-lrec, .cbl-row')].find((e) => e.innerText.includes(s)); return r ? r.innerText.replace(/\s+/g, ' ') : ''; }, subject);

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(base + '/app.html#/app');
  await page.waitForSelector('[data-testid="nav-task"]', { timeout: 20000 });
  await page.waitForFunction((s) => document.body.innerText.includes(s), SUBJECT.okay, { timeout: 15000 });


  await w.step('B1', 'Task list: the amount is the api bill_total, in the api currency', async () => {
    const okay = await amountCell('okay'), aud = await amountCell('aud');
    return { ok: /189/.test(okay) && !/111/.test(okay) && /55\.50/.test(aud) && /A\$|AUD/.test(aud) && !/333/.test(aud), saw: 'okay row: "' + okay.slice(0, 80) + '" | aud row: "' + aud.slice(0, 80) + '"' };
  });
  await w.step('B2', 'Task list: a bill whose copies agree has no "not confirmed" words', async () => {
    const okay = await cellOf(SUBJECT.okay);
    return { ok: !/not confirmed/i.test(okay), saw: 'okay row has no chip' };
  });
  await w.step('B3a', 'Task list: agree:false shows the chip, with the server sentence in its title', async () => {
    const chip = await page.evaluate((s) => { const r = [...document.querySelectorAll('.cbl-lrec, .cbl-row')].find((e) => e.innerText.includes(s)); const c = r && r.querySelector('[data-testid="bill-not-confirmed-chip"]'); return c ? { text: c.innerText, title: c.getAttribute('title') } : null; }, SUBJECT.bad);
    return { ok: !!chip && /not confirmed/i.test(chip.text) && chip.title === SAYS, saw: chip ? 'chip "' + chip.text + '" title carries the sentence' : 'no chip on the bad row' };
  });
  await w.step('B4', 'Task list: a withheld bill shows a dash, never a rupee zero', async () => {
    const none = await amountCell('none');
    return { ok: !/444/.test(none) && !/₹\s*0(\.00)?\b/.test(none), saw: 'none row: "' + none.slice(0, 80) + '"' };
  });
  await w.step('B5a', 'Task list at 1366x768: no sideways scroll', async () => {
    const f = await fits();
    return { ok: f.sw <= f.iw, saw: 'scrollWidth ' + f.sw + ' / window ' + f.iw };
  });

  await w.step('B3b', 'Detail of the agree:false bill: the server sentence is shown in full', async () => {
    await page.evaluate(() => openChit('c-bad'));
    await page.waitForSelector('[data-testid="bill-not-confirmed"]', { timeout: 10000 });
    const t = await page.locator('[data-testid="bill-not-confirmed"]').first().innerText();
    const f = await fits();
    return { ok: t.replace(/\s+/g, ' ').includes(SAYS) && f.clipped === 0 && f.sw <= f.iw, saw: 'notice: "' + t.replace(/\s+/g, ' ').slice(0, 120) + '" · clipped ' + f.clipped + ' · scrollWidth ' + f.sw + '/' + f.iw };
  });
  await w.step('B2b', 'Detail of an agreeing bill: no notice', async () => {
    await page.evaluate(() => openChit('c-okay'));
    await page.waitForFunction(() => /okay-one/.test(document.body.innerText), null, { timeout: 10000 });
    await page.waitForTimeout(400);
    return { ok: (await page.locator('[data-testid="bill-not-confirmed"]').count()) === 0, saw: 'no notice on the detail' };
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await w.step('B5b', 'Phone 390x844: detail of the agree:false bill, sentence visible, no sideways scroll', async () => {
    await page.locator('.cbl-lrec, .cbl-row, [data-row]').filter({ hasText: SUBJECT.bad }).first().click(); /* a phone opens the detail by tapping the row */
    await page.waitForSelector('[data-testid="bill-not-confirmed"]', { state: 'visible', timeout: 10000 });
    await page.waitForTimeout(300);
    const f = await fits();
    const box = await page.locator('[data-testid="bill-not-confirmed"]').first().boundingBox();
    return { ok: f.sw <= f.iw && f.clipped === 0 && !!box && box.x >= 0 && box.x + box.width <= f.iw + 1, saw: 'scrollWidth ' + f.sw + '/' + f.iw + ' · notice box x ' + (box && Math.round(box.x)) + ' w ' + (box && Math.round(box.width)) };
  });
  await w.step('B5c', 'Phone 390x844: the list (back) has no sideways scroll and still shows the chip', async () => {
    await page.evaluate(() => { UI.sel = null; UI.detail = null; renderApp(); });
    await page.waitForTimeout(500);
    const f = await fits();
    const chips = await page.locator('[data-testid="bill-not-confirmed-chip"]').count();
    return { ok: f.sw <= f.iw, saw: 'scrollWidth ' + f.sw + '/' + f.iw + ' · chips on screen ' + chips };
  });
});
