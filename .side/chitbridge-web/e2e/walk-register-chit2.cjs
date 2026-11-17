#!/usr/bin/env node
/**
 * e2e/walk-register-chit2.cjs - THE RAIDA REGISTER AND THE LINE-LEVEL CHIT (Design 2), WALKED (QA-78, 2026-10-23).
 * The two workshop capabilities app/cap-register.js (the register: Live · Closure · Impact) and app/cap-chit2.js (a chit as line-level
 * work: Them / Us, tabs) had no walk, so the section 7 "ui" minimums (walk · cream and dark at 1366 and 390 · AA contrast · words when it
 * cannot read · the string layer) stood unevidenced and the readability guard's test-minimums rule blocked any change to either file.
 * Black box: the page is the workshop (public/app.html), the shop is a FIXTURE shop, the API is a stand-in answering inside the page;
 * nothing reaches localhost:3000 or the live site. It reads what the screen SAYS, never the DOM alone.
 *   R1 the register opens: the count line, the rows with owner and due day, the three views
 *   R2 Closure names how each ended, in the shopkeeper's words      R3 Impact opens without an error
 *   R4 the register cannot be read: the screen says it did not look, and that nothing-here is not the answer (never a blank)
 *   R5 the pseudo-locale (qps): the register's own words come from the string layer          R6 RULE 13 on the register (modal)
 *   C1 the chit opens as Design 2: Them and Us, the order lines     C2 Us switches the tabs to our side only
 *   C3 the chit cannot be read: words, not "undefined"              C4 RULE 13 on the chit
 *   RULE 13 = Cream and Dark, 1366 and 390 px: AA contrast, no clipped text, no inner sideways scroll, nothing floating over a control,
 *   no link to app.html, copy within the text budget (e2e/lib/rule13.cjs).
 *
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-register-chit2.cjs      headless        --show   headed, a caption per step
 * One line per path: "ID · path · PASS/FAIL (what it saw)". Screenshots: e2e/shots/walk-register-chit2-NN.png.
 */
'use strict';
const W = require('./lib/walk.cjs');
const { rule13 } = require('./lib/rule13.cjs');

/** the two capabilities under test, by path: the walk proves each one was really fetched and run by the page (the knowledge graph reads these names as the tested-by link) */
const UNDER_TEST = ['public/app/cap-register.js', 'public/app/cap-chit2.js'];

const REPORT = {
  migrated: true, full: true, open: 3, closed: 1, closed_by_order: 0,
  entries: [
    { raida_id: 'r1', subject_id: 's1', chit_id: null, kind: 'risk', body: 'Cold-chain truck may be late on Friday', open: true, owner: 'Murugan', likelihood: 3, severity: 4, score: 12, treatment: 'Book a second truck', due_date: '2026-10-30' },
    { raida_id: 'r2', subject_id: 's1', chit_id: null, kind: 'action', body: 'Call the cold store', open: true, owner: 'Selvam', due_date: '2026-10-25' },
    { raida_id: 'r3', subject_id: null, chit_id: null, kind: 'decision', body: 'Use the second supplier for rice', open: true },
    { raida_id: 'r4', subject_id: 's1', chit_id: null, kind: 'issue', body: 'Delivery was short by two bags', open: false, ending: 'closed', disposition: 'resolved', closed_note: 'Credit note raised', closed_by: 'Asha' }
  ]
};
const SUBJECTS = { subjects: [{ subject_id: 's1', name: 'Friday cold-chain trip', type_key: 'other', open: 2 }] };
const CHIT = {
  header: { chit_id: 'c1', manual_subject: 'Friday supply to Sri Ganesh', purpose: 'order', sender_entity_display_name: 'Books Shop', created_at: '2026-10-20T08:00:00Z', business_json: {}, summary_json: {} },
  live_set: [
    { line_id: 'l1', live: { item_id: 'i1', name: 'Onion', quantity: 20, unit: 'kg', price: 30 } },
    { line_id: 'l2', live: { item_id: 'i2', name: 'Potato', quantity: 10, unit: 'kg', price: 0 } }
  ],
  line_assignment: {}, line_delivery: {}, delivery_summary: null
};

/** RULE 13 measures THIS screen: the workshop around it (the list, the Online pill) is not the register or the chit, and has its own walks. The rest of the page is made invisible (not removed) while the host is measured. */
const scope = (page, host) => page.evaluate((h) => { const st = document.createElement('style'); st.id = '__scope'; st.textContent = 'body *:not(' + h + '):not(' + h + ' *):not(:has(' + h + ')){visibility:hidden !important}'; document.head.appendChild(st); }, host);
const unscope = (page) => page.evaluate(() => { const st = document.getElementById('__scope'); if (st) st.remove(); });

W.run('register-chit2', async (w) => {
  const { page, ctx, base } = w;
  const fetched = new Set();
  page.on('request', (q) => { const m = /[/]app[/](cap-[a-z0-9-]+[.]js)/.exec(q.url()); if (m) fetched.add('public/app/' + m[1]); });
  const down = { register: false, chit: false };   /* the two "cannot read" switches: the stand-in answers 500 while one is on */
  const answer = async (route) => {
    const u = new URL(route.request().url()), p = u.pathname;
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*' } });
    if (p === '/api/chits/raida/report') return down.register ? json(500, { error: 'Failed to read the register', message: 'Could not read the register just now.' }) : json(200, REPORT);
    if (p === '/api/chits/register/subjects') return json(200, SUBJECTS);
    if (p === '/api/chits/register/attachables') return json(200, { attachables: [] });
    if (p === '/api/chits/c1') return down.chit ? json(500, { error: 'Failed', message: 'This chit could not be opened just now.' }) : json(200, CHIT);
    if (/\/messages$|\/api\/chits\/c1\/|\/actors$/.test(p) && !/^\/api\/chits\/c1$/.test(p)) return json(200, []);
    return json(200, {});
  };
  const shared = (c) => c.addInitScript((s) => { try { localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Books Shop', 'Books Shop'));
  await shared(ctx);
  await ctx.route('**/api/**', answer);
  await page.goto(base + '/app.html#/app');
  await page.waitForFunction(() => typeof ensureCap === 'function' && typeof renderApp === 'function', null, { timeout: 30000 });
  await page.waitForTimeout(1500);

  const screenText = (sel) => page.evaluate((s) => ((document.querySelector(s) || {}).innerText || '').replace(/[ \t\r\n]+/g, ' ').trim(), sel);
  const openRegister = async (force) => {
    await page.evaluate(async (f) => { await ensureCap('register'); await openRegister(f); }, !!force);
    await page.waitForSelector('[data-testid="register-tab-live"]', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(300);
  };
  const closeModal = () => page.evaluate(() => { if (typeof closeModal === 'function') closeModal(); }).catch(() => {});

  /* ── the register ── */
  await w.step('R1', 'Register -> "3 open · 1 closed", each row names who has it and the day, and the three views are there', async () => {
    await openRegister(true);
    const t = await screenText('#modalhost');
    const views = await page.locator('[data-testid^="register-tab-"]').count();
    const ok = /3 open · 1 closed/.test(t) && /Cold-chain truck may be late on Friday/.test(t) && /Murugan/.test(t) && /2026-10-30/.test(t) && /Book a second truck/.test(t) && views === 3;
    return { ok, saw: views + ' views · "' + t.slice(0, 130) + '"' };
  });
  await w.step('R1b', 'The page fetched and ran both capabilities: ' + UNDER_TEST.join(' · '), async () => {
    await page.evaluate(async () => { await ensureCap('chit2'); });
    const ran = await page.evaluate(() => ({ register: typeof openRegister === 'function' && typeof rgGo === 'function', chit2: typeof openChit2 === 'function' && typeof c2Side === 'function' }));
    return { ok: UNDER_TEST.every((f) => fetched.has(f)) && ran.register && ran.chit2, saw: UNDER_TEST.map((f) => f.replace('public/app/', '') + (fetched.has(f) ? ' fetched' : ' NOT fetched')).join(' · ') };
  });
  await w.step('R2', 'Closure -> the one that ended says HOW (Resolved), who closed it and the note', async () => {
    await page.click('[data-testid="register-tab-closure"]'); await page.waitForTimeout(250);
    const t = await screenText('#modalhost'); 
    return { ok: /Resolved/.test(t) && /Credit note raised/.test(t) && /Delivery was short by two bags/.test(t), saw: '"' + t.slice(0, 150) + '"' };
  });
  await w.step('R3', 'Impact -> opens, says what to do, and the page raised no error', async () => {
    const before = w.errs.length;
    await page.click('[data-testid="register-tab-impact"]'); await page.waitForTimeout(250);
    const t = await screenText('#modalhost');
    return { ok: /Impact/.test(t) && t.length > 40 && w.errs.length === before && !/undefined|\[object/.test(t), saw: '"' + t.slice(0, 140) + '"' };
  });
  await w.step('R4', 'The register cannot be read -> the screen says it could not look, and that this is NOT "nothing on the register"', async () => {
    down.register = true;
    await closeModal();
    await openRegister(true);
    const t = await screenText('#modalhost');
    down.register = false;
    return { ok: /Could not read the register just now\./.test(t) && /does NOT mean there is nothing on the register/.test(t) && !/undefined|\[object|3 open/.test(t), saw: '"' + t.slice(0, 160) + '"' };
  });
  await closeModal();

  /* ── the string layer: the pseudo-locale pack makes a hard-wired word visible ── */
  await w.step('R5', 'Register in the pseudo-language (qps) -> the count line and the views come from the string layer, none hard-wired', async () => {
    const c = await w.contextAt();
    await c.addInitScript(() => { try { localStorage.setItem('cb_lang', 'qps'); localStorage.setItem('cb_langs', 'qps'); localStorage.setItem('cb_locale', 'en-IN'); localStorage.setItem('cb_region', 'IN'); } catch (_) {} });
    await shared(c);
    await c.route('**/api/**', answer);
    /* the reader's choice, as the product stores it (walk-locale.cjs): the UI language is qps; the page reads it from the profile, not from storage */
    await c.route('**/api/entities/me**', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ entity: { display_name: 'Books Shop', currency_code: 'INR', country: 'IN', locale_prefs: { lang: 'qps', langs: 'qps' } } }) }));
    const p = await c.newPage();
    await p.goto(base + '/app.html#/app');
    await p.waitForFunction(() => typeof ensureCap === 'function' && window.CBSTR && window.CBSTR.qps, null, { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(1500);   /* the boot's first paint must be done: it would clear the register's window */
    await p.evaluate(async () => { await ensureCap('register'); await openRegister(true); });
    await p.waitForSelector('[data-testid="register-tab-live"]', { timeout: 8000 }).catch(() => {});
        const out = await p.evaluate(() => ({
      head: ((document.querySelector('#modalhost .mhd') || document.querySelector('#modalhost') || {}).innerText || '').replace(/\s+/g, ' '),
      tabs: [...document.querySelectorAll('[data-testid^="register-tab-"]')].map((b) => b.textContent.trim())
    }));
    await c.close();
    const wrapped = (s) => /\[!!.*!!\]/.test(s);
    return { ok: out.tabs.length === 3 && out.tabs.every(wrapped) && /\[!!/.test(out.head), saw: 'views ' + out.tabs.join(' | ') + ' · head "' + out.head.slice(0, 90) + '"' };
  });

  await openRegister(true);
  await scope(page, '#modalhost');
  await rule13(w, 'R6', 'the register', 'modalhost', null, async () => { await page.waitForTimeout(500); await openRegister(true); });
  await unscope(page);
  await closeModal();

  /* ── the chit as line-level work ── */
  const openChit2 = async () => {
    await page.evaluate(async () => { await ensureCap('chit2'); UI.nav = 'task'; UI.folder = 'task'; UI.mdetail = true; /* a phone: the tapped row opens the detail */ renderApp(); await openChit2('c1'); });
    await page.waitForSelector('[data-testid="c2-side-them"]', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(300);
  };
  await w.step('C1', 'Open the task as Design 2 -> Them and Us, the subject, and the order says "2 lines" with the one that has no price', async () => {
    await openChit2();
    await page.click('[data-testid="c2-tab-ord"]'); await page.waitForTimeout(250);
    const t = await screenText('#detailpane');
    return { ok: /Friday supply to Sri Ganesh/.test(t) && /Them/.test(t) && /Us/.test(t) && /2 lines/.test(t) && /1 with no price/.test(t) && /Onion/.test(t) && /Potato/.test(t), saw: '"' + t.slice(0, 170) + '"' };
  });
  await w.step('C2', 'Us -> the tabs become our side only (the other party sees none of it)', async () => {
    const before = await page.locator('[data-testid^="c2-tab-"]').allTextContents();
    await page.click('[data-testid="c2-side-us"]'); await page.waitForTimeout(250);
    const after = await page.locator('[data-testid^="c2-tab-"]').allTextContents();
    const t = await screenText('#detailpane');
    return { ok: after.join() !== before.join() && /our side only/.test(t), saw: 'them ' + before.join(' | ') + ' -> us ' + after.join(' | ') };
  });
  await w.step('C3', 'The chit cannot be read -> the screen says so in words (no "undefined", no blank)', async () => {
    down.chit = true;
    await page.evaluate(async () => { await openChit2('c1'); });
    await page.waitForTimeout(500);
    const t = await screenText('#detailpane');
    down.chit = false;
    return { ok: /could not be opened just now/.test(t) && !/undefined|\[object/.test(t), saw: '"' + t.slice(0, 140) + '"' };
  });
  await openChit2();
  await scope(page, '#detailpane');
  await rule13(w, 'C4', 'the chit as line-level work', 'detailpane', null, async () => { await page.waitForTimeout(500); await openChit2(); });
  await unscope(page);
});
