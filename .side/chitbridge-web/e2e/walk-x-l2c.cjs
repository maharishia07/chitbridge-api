#!/usr/bin/env node
/**
 * e2e/walk-x-l2c.cjs — L2C · LEAD TO CUSTOMER, WALKED WIDTH AND DEPTH (round WX-L2C, 2026-10-13; the flow: docs/process/L2C.md).
 * Steps 1 lead → 2 call → 3 demo → 4 trial → 5 customer, on CB CRM (public/crm.html: Leads · Calls · the record · Follow-ups · Timeline),
 * at 1366×768 AND 390×844, every control, the owner and a view-only login. Every assertion is on what the SCREEN shows (visible text +
 * a screenshot per step: e2e/shots/walk-x-l2c-NN.png), never the DOM alone or the API.
 *
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-x-l2c.cjs           FIXTURE mode: the stand-in answers inside the page (e2e/lib/standin.cjs)
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-x-l2c.cjs --real    REAL mode: chitbridge-api as a child on the loader's Postgres
 *                                                                       (api docs/SIM-LOAD.md; e2e/lib/real-api.cjs) — sign-in through CBSignin
 *   --show   a headed browser with captions (e2e/lib/walk.cjs)
 * Reuse: e2e/lib/walk.cjs (steps · shots · exit), e2e/lib/real-api.cjs (the api child, the one sign-in door, the counter's bill shape),
 * e2e/lib/standin.cjs (the fixture answers, widened with the L2C routes). Findings: docs/testing/WX-L2C-2026-10-13.md.
 */
'use strict';
const W = require('./lib/walk.cjs');
const C = require('./lib/contract.cjs');   /* M43: every /api/crm answer the fixture stand-in serves is held to the API contract (e2e/lib/standin.cjs → C.json) */
const REAL = process.argv.includes('--real');
const T = (s) => '[data-testid="' + s + '"]';
const LAP = { width: 1366, height: 768 }, PHONE = { width: 390, height: 844 };
const tag = new Date().toISOString().slice(11, 19).replace(/:/g, '');   /* re-runnable: this run's leads carry its time */   /* clock-ok: a time-of-day tag for re-runs, not a business date */
const NAMES = { a: 'Lead Anbu ' + tag, b: 'Lead Bala ' + tag, c: 'Lead Chitra ' + tag, d: 'Lead Devi ' + tag };
const PHONES = { a: '9' + String(Date.now()).slice(-9), b: '8' + String(Date.now()).slice(-9), c: '7' + String(Date.now()).slice(-9), d: '6' + String(Date.now()).slice(-9) };   /* clock-ok: a unique phone suffix */

W.run(REAL ? 'x-l2c-real' : 'x-l2c', async (w) => {   /* two sets of shots: walk-x-l2c-real-NN.png (this stack) · walk-x-l2c-NN.png (the fixture) */
  const { page, ctx, base } = w;
  let api = null, token = null, SI = null, S = null;
  const txt = async (sel) => { try { return (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim(); } catch (_) { return ''; } };
  const body = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  const count = (sel) => page.locator(sel).count();
  const sw = () => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  const settle = (ms) => page.waitForTimeout(ms || 350);
  const go = async (hash, until) => { await page.evaluate((h) => { location.hash = h; }, hash); if (until) await page.waitForSelector(until, { timeout: 15000 }).catch(() => {}); await settle(); };
  const toast = () => txt('#toast');
  /** the toast that says THIS happened (an earlier toast may still be on screen) */
  const waitToast = async (re) => { await page.waitForFunction((src) => new RegExp(src).test((document.getElementById('toast') || {}).innerText || ''), re.source, { timeout: 15000 }).catch(() => {}); return toast(); };
  /** the record, read and painted (not only its header from the list row) */
  const recordReady = async () => { await page.waitForSelector(T('crm-actions'), { timeout: 15000 }); await page.waitForSelector(T('crm-rec-loading'), { state: 'detached', timeout: 15000 }).catch(() => {}); await settle(300); };
  const chipIs = (stage) => page.waitForFunction((st) => { const c = document.querySelector('[data-testid="crm-record"] [data-testid="crm-stage-chip"]'); return c && c.getAttribute('data-stage') === st; }, stage, { timeout: 15000 }).catch(() => {});
  const leadRow = (name) => page.locator('[data-row][data-testid^="crm-lead-"]', { hasText: name }).first();
  const callRow = (name) => page.locator('[data-row][data-testid^="crm-call-row-"]', { hasText: name }).first();
  const chip = (sel) => page.locator((sel || '') + ' ' + T('crm-stage-chip')).first();
  /** the CRM's sign-in card drives CBSignin (signin-id · signin-go · signin-code · signin-verify · the PIN pair for a first-time co-assist) */
  async function signIn(p, id, code) {
    await p.goto(base + '/crm.html#/leads');
    await p.waitForSelector(T('signin-id'), { timeout: 20000 });
    await p.fill(T('signin-id'), id); await p.click(T('signin-go'));
    await p.waitForSelector(T('signin-code') + ', ' + T('signin-pin'), { timeout: 20000 });
    if (await p.locator(T('signin-code')).count()) await p.fill(T('signin-code'), code); else await p.fill(T('signin-pin'), code);
    await p.click(T('signin-verify'));
    await p.waitForSelector(T('shop-name') + ', ' + T('signin-pin1') + ', ' + T('signin-why'), { timeout: 20000 });
    if (await p.locator(T('signin-pin1')).count()) { await p.fill(T('signin-pin1'), '2749'); await p.fill(T('signin-pin2'), '2749'); await p.click(T('signin-pinsave')); await p.waitForSelector(T('shop-name'), { timeout: 20000 }); }
  }

  try {
    /* ── the stack ──────────────────────────────────────────────────────────────────────────────────────────────── */
    if (REAL) {
      api = await require('./lib/real-api.cjs').start({ origin: base });
      await ctx.addInitScript((b) => { try { localStorage.setItem('cb_api_base', b); } catch (_) {} }, api.base);
      token = await api.owner();
    } else {
      SI = require('./lib/standin.cjs');
      S = SI.standIn({ l2c: SI.l2cState() });
      await ctx.route('**/api/**', (r) => SI.route(S, r));
      await ctx.addInitScript((s) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Fixture Owner', 'Mayur Bhavan'));
    }
    await page.setViewportSize(LAP);

    /* ── L01 · sign in, the CRM opens ───────────────────────────────────────────────────────────────────────────── */
    await w.step('L01', 'Sign in as the shop → CRM opens on Leads', async () => {
      if (REAL) await signIn(page, api.shop, api.otp); else { await page.goto(base + '/crm.html#/leads'); await page.waitForSelector(T('shop-name'), { timeout: 20000 }); }
      await page.waitForSelector(T('crm-leads'), { timeout: 20000 }); await settle(600);
      const who = await txt(T('shop-name')), b = await body();
      return { ok: !!who && /Leads/.test(b) && !/Reading…/.test(b), saw: 'signed in as "' + who + '" · nav: ' + (await page.$$eval('#nav .label', (l) => l.map((x) => x.textContent.trim()))).join(' · ') };
    });

    /* ── step 1 · lead ──────────────────────────────────────────────────────────────────────────────────────────── */
    await w.step('L02', 'Leads tab: the list frame (title · search · filters · + Add lead) or the empty state', async () => {
      const b = await body(), add = await count(T('crm-lead-add')), empty = /No leads yet/.test(b);
      const hint = await page.getAttribute('[data-cbl-q]', 'placeholder').catch(() => '');
      return { ok: add === 1 && /Leads/.test(b) && (empty || await count('[data-row][data-testid^="crm-lead-"]') > 0), saw: (empty ? 'empty: "No leads yet · People you have not traded with yet. Use + Add lead."' : 'rows listed') + ' · search "' + hint + '" · + Add lead' };
    });
    await w.step('L03', 'Add lead → Save with no name → the sheet says what to do', async () => {
      await page.click(T('crm-lead-add')); await page.waitForSelector(T('crm-lead-sheet'));
      await page.click(T('crm-lead-save')); await settle(200);
      const m = await txt(T('crm-lead-msg')), opts = await page.$$eval(T('crm-lead-stage') + ' option', (o) => o.map((x) => x.textContent.trim()));
      return { ok: m === 'Give the lead a name.', saw: '"' + m + '" · stage choices: ' + opts.join(' · ') };
    });
    await w.step('L04', 'Add lead "' + NAMES.a + '" with a phone → toast · a row with the New lead chip', async () => {
      await page.fill(T('crm-lead-name'), NAMES.a); await page.fill(T('crm-lead-phone'), PHONES.a);
      await page.click(T('crm-lead-save')); const t = await waitToast(/Lead added/);
      await leadRow(NAMES.a).waitFor({ timeout: 15000 }); await settle(500);
      const row = (await leadRow(NAMES.a).innerText()).replace(/\s+/g, ' ');
      return { ok: /Lead added/.test(t) && /New lead/.test(row), saw: 'toast "' + t + '" · row "' + row + '"' };
    });
    await w.step('L05', 'Leads: search by phone finds the one row; the Stage filter offers the five stages', async () => {
      await page.fill('[data-cbl-q]', PHONES.a.slice(-6)); await settle(400);
      const n = await count('[data-row][data-testid^="crm-lead-"]');
      await page.click(T('cbl-filters-crm-leads')); await page.waitForSelector(T('cbl-filters-pop-crm-leads'));
      const opts = await page.$$eval(T('cbl-filters-pop-crm-leads') + ' select[data-filt="stage"] option', (o) => o.map((x) => x.textContent.trim()));
      await page.keyboard.press('Escape'); await page.fill('[data-cbl-q]', ''); await settle(300);
      return { ok: n === 1 && opts.length === 6, saw: n + ' row for the phone · Stage: ' + opts.join(' · ') };
    });

    /* ── the record of a lead ───────────────────────────────────────────────────────────────────────────────────── */
    let aKey = '';
    await w.step('L06', 'Open the lead → the record: New lead chip · Not on the network · Call · Log · Follow-up · Move to…', async () => {
      await leadRow(NAMES.a).click(); await page.waitForSelector(T('crm-record'), { timeout: 15000 }); await recordReady();
      aKey = decodeURIComponent((await page.evaluate(() => location.hash)).replace(/^#\/party\//, ''));
      const acts = (await page.$$eval(T('crm-actions') + ' .act', (a) => a.map((x) => x.textContent.replace(/\s+/g, ' ').trim()))).filter(Boolean);
      const b = await body(), stage = await txt(T('crm-rec-name') + ' ~ .rchips ' + T('crm-stage-chip'));
      return { ok: /New lead/.test(b) && /Not on the network/.test(b) && acts.some((a) => /^Move to/.test(a)) && acts.some((a) => /Log/.test(a)) && acts.some((a) => /Call/.test(a)), saw: 'chip "' + stage + '" · actions: ' + acts.join(' · ') };
    });
    await w.step('L07', 'Move to… → the sheet offers the moves the server allows; Demo → chip reads Demo (step 3 by hand)', async () => {
      await page.click(T('crm-act-stage')); await page.waitForSelector(T('crm-stage-sheet'));
      const moves = await page.$$eval(T('crm-stage-sheet') + ' button[data-crm="stagego"]', (b) => b.map((x) => x.textContent.trim()));
      await page.click(T('crm-stage-demo')); const t = await waitToast(/Moved/);
      await chipIs('demo'); await recordReady(); const stage = await txt(T('crm-record') + ' ' + T('crm-stage-chip'));
      return { ok: moves.length === 4 && /Moved/.test(t) && stage === 'Demo', saw: 'moves: ' + moves.join(' · ') + ' · toast "' + t + '" · chip "' + stage + '"' };
    });
    await w.step('L08', 'Timeline of the lead: does the stage move leave a trail?', async () => {
      await go('#/party/' + encodeURIComponent(aKey) + '/timeline', T('crm-timeline')); await settle(800);
      const b = await body(), has = /Demo|stage|Moved/i.test(b.replace(/Timeline · [^·]+/, ''));
      return { ok: has, saw: has ? 'the move is on the timeline' : 'nothing on the timeline says the lead moved to Demo (' + (/Nothing yet/.test(b) ? '"Nothing yet with this party."' : 'entries without it') + ')' };
    });

    /* ── step 2 · call (the call desk) ─────────────────────────────────────────────────────────────────────────── */
    await w.step('L09', 'Calls tab: the untouched lead is in today\'s queue as New, with a phone link and the six outcomes', async () => {
      await go('#/calls', T('crm-calls')); await callRow(NAMES.a).waitFor({ timeout: 15000 }); await settle(500);
      const row = (await callRow(NAMES.a).innerText()).replace(/\s+/g, ' ');
      await callRow(NAMES.a).locator('[data-caret]').first().click().catch(() => {}); await settle(300);
      const acts = await page.$$eval('.cbl-next .cbl-btn', (b) => b.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
      const tel = await count(T('crm-call-tel-' + ((await callRow(NAMES.a).getAttribute('data-testid')) || '').replace('crm-call-row-', '')));
      return { ok: /New/.test(row) && acts.length === 6 && tel === 1, saw: 'row "' + row + '" · outcomes: ' + acts.join(' · ') };
    });
    /* ── W1-CRM: the call screen = the row's next level: the stage's script (three lines) + Next, above the server's outcomes ── */
    await w.step('L09a', 'The open row is the call screen: "Script · Demo" (L07 moved this lead to Demo) with three lines, "First call", and a Next button above the six outcomes', async () => {
      const script = page.locator(T('crm-call-script')).first(); await script.waitFor({ timeout: 5000 }).catch(() => {});
      const head = await txt(T('crm-call-script') + ' .nh'), lines = await count(T('crm-call-script') + ' [data-testid^="crm-call-line-"]'), stage = await script.getAttribute('data-stage').catch(() => '');
      const line1 = await txt(T('crm-call-line-1')), first = await txt(T('crm-call-script') + ' .s'), next = await count(T('crm-call-next'));
      const above = await page.evaluate(() => { const s = document.querySelector('[data-testid="crm-call-script"]'), b = document.querySelector('.cbl-next .cbl-acts'); return !!(s && b) && !!(s.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING); });
      return { ok: /script/i.test(head) && /demo/i.test(head) && stage === 'demo' && lines === 3 && /Confirm the demo/.test(line1) && /First call/.test(first) && next === 1 && above,
        saw: '"' + head + '" · ' + lines + ' lines · 1: "' + line1 + '" · "' + first + '" · Next: ' + next + ' · outcomes below the script: ' + above };
    });
    await require('./lib/rule13.cjs').rule13(w, 'L09r', 'the call screen (Calls, the script open)', 'crm_calls');
    await w.step('L09b', 'Next on the last row on the list: nothing written, the row closes, the page says it was the last call', async () => {
      await go('#/calls', T('crm-calls')); await callRow(NAMES.a).waitFor({ timeout: 15000 }); await settle(400);
      const rowId = await callRow(NAMES.a).getAttribute('data-row');
      const opened = await page.evaluate((id) => { const a = CBList.get('crm-calls'); if (!a) return false; a.open(id, true); return true; }, rowId); await settle(200);
      const following = await page.evaluate(() => typeof crmCallFollowing === 'function' ? crmCallFollowing(document.querySelector('[data-testid="crm-call-next"]').getAttribute('data-id')) : 'nofn');
      const writesBefore = REAL ? 0 : (S ? S.calls.filter((c) => /outcome/.test(c)).length : 0);
      await page.click(T('crm-call-next')); await settle(400);
      const t = await toast(), aOpen = await callRow(NAMES.a).getAttribute('aria-expanded');
      const openedNext = following ? await page.locator('[data-row="' + following + '"]').first().getAttribute('aria-expanded') : null;
      const writesAfter = REAL ? 0 : (S ? S.calls.filter((c) => /outcome/.test(c)).length : 0);
      const ok = opened && aOpen === 'false' && writesAfter === writesBefore && (following ? openedNext === 'true' : /last call/.test(t));
      await page.evaluate((id) => { CBList.get('crm-calls').open(id, true); }, rowId); await settle(200);   /* open again: L10 logs its outcome on this row */
      return { ok, saw: (following ? 'the following row opened: ' + openedNext : 'last row · toast "' + t + '"') + ' · this row open after: ' + aOpen + ' · outcome writes: ' + writesBefore + ' → ' + writesAfter };
    });
    await w.step('L10', 'Outcome "No answer" → Saved · the lead leaves today\'s queue · a Ring again follow-up for tomorrow', async () => {
      await page.click(T('crm-call-no_answer')); const t = await waitToast(/Saved/);
      await page.waitForFunction((n) => !Array.from(document.querySelectorAll('[data-row][data-testid^="crm-call-row-"]')).some((r) => r.textContent.indexOf(n) >= 0), NAMES.a, { timeout: 15000 }).catch(() => {});
      const still = await callRow(NAMES.a).count();
      await go('#/followups', T('crm-fu-list')); await settle(800);
      const fu = page.locator('[data-row][data-testid^="crm-fu-"]', { hasText: NAMES.a }).first(); const fuT = (await fu.count()) ? (await fu.innerText()).replace(/\s+/g, ' ') : '';
      return { ok: /Saved/.test(t) && still === 0 && /Ring again/.test(fuT), saw: 'toast "' + t + '" · in queue after: ' + still + ' · follow-up "' + fuT + '"' };
    });
    await w.step('L11', 'Add lead "' + NAMES.b + '" · Calls → "Demo booked" asks when → Tomorrow → stage Demo + a Demo follow-up (step 3)', async () => {
      await go('#/leads', T('crm-leads')); await page.click(T('crm-lead-add')); await page.waitForSelector(T('crm-lead-sheet'));
      await page.fill(T('crm-lead-name'), NAMES.b); await page.fill(T('crm-lead-phone'), PHONES.b); await page.click(T('crm-lead-save'));
      await leadRow(NAMES.b).waitFor({ timeout: 15000 });
      await go('#/calls', T('crm-calls')); await callRow(NAMES.b).waitFor({ timeout: 15000 }); await settle(300);
      await callRow(NAMES.b).locator('[data-caret]').first().click().catch(() => {}); await settle(300);
      await page.click(T('crm-call-demo_booked')); await page.waitForSelector(T('crm-call-ask'));
      const asks = await page.$$eval(T('crm-call-ask') + ' button[data-crm="callafter"]', (b) => b.map((x) => x.textContent.trim()));
      await page.click(T('crm-call-after-tomorrow')); const t = await waitToast(/Saved/);
      await go('#/leads', T('crm-leads')); await settle(800);
      const row = (await leadRow(NAMES.b).innerText()).replace(/\s+/g, ' ');
      return { ok: asks.length === 2 && /Saved/.test(t) && /Demo/.test(row), saw: 'asks: ' + asks.join(' · ') + ' · toast "' + t + '" · lead row "' + row + '"' };
    });
    await w.step('L12', 'Add lead "' + NAMES.c + '" · "Not now" → stage Not now (parked) · "' + NAMES.d + '" · "Wrong number" → Lost, no follow-up', async () => {
      for (const k of ['c', 'd']) { await go('#/leads', T('crm-leads')); await page.click(T('crm-lead-add')); await page.waitForSelector(T('crm-lead-sheet')); await page.fill(T('crm-lead-name'), NAMES[k]); await page.fill(T('crm-lead-phone'), PHONES[k]); await page.click(T('crm-lead-save')); await leadRow(NAMES[k]).waitFor({ timeout: 15000 }); }
      await go('#/calls', T('crm-calls')); await callRow(NAMES.c).waitFor({ timeout: 15000 }); await settle(300);
      /* W1-CRM: Next moves from this row to the one that follows; an outcome saved opens the following row by itself (the next call is on screen) */
      const cId = await callRow(NAMES.c).getAttribute('data-row');
      await page.evaluate((id) => { CBList.get('crm-calls').open(id, true); }, cId); await settle(200);
      const afterC = await page.evaluate((id) => crmCallFollowing(id), cId);
      await page.click(T('crm-call-next')); await settle(300);
      const nextOpened = afterC ? await page.locator('[data-row="' + afterC + '"]').first().getAttribute('aria-expanded') : null;
      const cClosed = await callRow(NAMES.c).getAttribute('aria-expanded');
      /* back to C (the following row closed again), log Not now on C: the row that followed C opens by itself */
      await page.evaluate((ids) => { const a = CBList.get('crm-calls'); if (ids[1]) a.open(ids[1], false); a.open(ids[0], true); }, [cId, afterC]); await settle(200);
      await page.locator('.cbl-next[data-next="' + cId + '"] ' + T('crm-call-not_now')).click(); await waitToast(/Saved/); await settle(800);   /* the open panel is the row's SIBLING (CBList nextHTML) */
      const autoOpened = afterC ? await page.locator('[data-row="' + afterC + '"]').first().getAttribute('aria-expanded') : null;
      const nextSaw = 'Next → following row ' + (afterC ? 'opened: ' + nextOpened : 'none (last)') + ' · C closed: ' + (cClosed === 'false') + ' · after Not now the following row opened by itself: ' + autoOpened;
      const nextOk = cClosed === 'false' && (!afterC || (nextOpened === 'true' && autoOpened === 'true'));
      const dId = await callRow(NAMES.d).getAttribute('data-row');
      await page.evaluate((id) => { CBList.get('crm-calls').open(id, true); }, dId); await settle(200);
      await page.locator('.cbl-next[data-next="' + dId + '"] ' + T('crm-call-wrong_number')).click(); await waitToast(/Saved/); await settle(800);
      await go('#/leads', T('crm-leads')); await settle(800);
      const rc = (await leadRow(NAMES.c).innerText()).replace(/\s+/g, ' '), rd = (await leadRow(NAMES.d).innerText()).replace(/\s+/g, ' ');
      await go('#/followups', T('crm-fu-list')); await settle(600); const fuD = await page.locator('[data-row][data-testid^="crm-fu-"]', { hasText: NAMES.d }).count();
      return { ok: nextOk && /Not now/.test(rc) && /Lost/.test(rd) && fuD === 0, saw: nextSaw + ' · C "' + rc + '" · D "' + rd + '" · follow-ups for D: ' + fuD };
    });
    await w.step('L13', 'Follow-ups: the Ring again row → Done → it leaves the open list', async () => {
      const fu = page.locator('[data-row][data-testid^="crm-fu-"]', { hasText: NAMES.a }).first();
      if (!(await fu.count())) return { ok: false, saw: 'no follow-up row for ' + NAMES.a };
      const id = ((await fu.getAttribute('data-testid')) || '').replace('crm-fu-', '');
      let done = page.locator(T('crm-fu-done-' + id)); if (!(await done.count())) { await fu.locator('[data-caret]').first().click().catch(() => {}); await settle(200); done = page.locator(T('crm-fu-mini-done')).first(); }
      await done.click(); await settle(1200);
      const left = await page.locator('[data-row][data-testid^="crm-fu-"]', { hasText: NAMES.a }).count();
      return { ok: left === 0, saw: 'rows for the lead after Done: ' + left };
    });

    await w.step('L13b', 'The record\'s other controls: Log (4 kinds · a follow-up) · Follow-up sheet · Edit sheet · More menu — each opens and closes', async () => {
      await go('#/party/' + encodeURIComponent(aKey)); await recordReady(); const out = [];
      await page.click(T('crm-act-log')); await page.waitForSelector(T('crm-log-sheet')); out.push('Log: ' + (await page.$$eval(T('crm-log-sheet') + ' [data-crm="logkind"]', (b) => b.map((x) => x.textContent.trim()))).join('/') + (await count(T('crm-log-fu')) ? ' + follow-up' : ''));
      await page.fill(T('crm-log-body'), 'Spoke about the demo'); await page.click(T('crm-log-save')); await waitToast(/Logged/); await recordReady();
      out.push(/Spoke about the demo/.test(await body()) ? 'the note is on the record' : 'the note is NOT on the record ✗');
      await page.click(T('crm-act-fu')); await page.waitForSelector(T('crm-fu-sheet')); out.push('Follow-up sheet: ' + (await page.$$eval(T('crm-fu-sheet') + ' label', (l) => l.map((x) => x.firstChild && x.firstChild.textContent.trim()).filter(Boolean))).join('/')); await page.keyboard.press('Escape'); await settle(200);
      await page.click(T('crm-act-edit')); await page.waitForSelector('#crm_sheet[open]'); out.push('Edit sheet: "' + (await txt('#crm_sheet .mhd .t, #crm_sheet h2, #crm_sheet .t')).slice(0, 40) + '"'); await page.keyboard.press('Escape'); await settle(200);
      await page.click(T('crm-act-more')); await page.waitForSelector(T('crm-more-menu')); out.push('More: ' + (await page.$$eval(T('crm-more-menu') + ' button', (b) => b.map((x) => x.textContent.replace(/\s+/g, ' ').trim()))).join(' · ')); await page.keyboard.press('Escape'); await settle(200);
      return { ok: !out.some((x) => /✗/.test(x)) && out.length === 5, saw: out.join(' · ') };
    });

    /* ── step 4 · trial ─────────────────────────────────────────────────────────────────────────────────────────── */
    await w.step('L14', 'Record → Move to… → Trial → chip reads Trial (step 4)', async () => {
      await go('#/party/' + encodeURIComponent(aKey)); await recordReady();
      await page.click(T('crm-act-stage')); await page.waitForSelector(T('crm-stage-sheet')); await page.click(T('crm-stage-trial'));
      await waitToast(/Moved/); await chipIs('trial'); await recordReady();
      const stage = await txt(T('crm-record') + ' ' + T('crm-stage-chip'));
      return { ok: stage === 'Trial', saw: 'chip "' + stage + '"' };
    });

    /* ── step 5 · customer: the first bill ends the lead ────────────────────────────────────────────────────────── */
    await w.step('L15', 'The counter bills the lead (the counter\'s own door) → the record reads Customer and Move to… is gone (step 5)', async () => {
      let sent;
      if (REAL) { const p = { party_id: aKey.match(/^[0-9a-f-]{36}$/) ? aKey : null, display_name: NAMES.a }; if (!p.party_id) { const r = await api.j('/api/crm/parties?view=leads', { token }); const row = (r.b.parties || []).find((x) => x.display_name === NAMES.a); p.party_id = row && row.party_id; } sent = await api.billTo(token, p); }
      else sent = SI.l2cBill(S.l2c, NAMES.a);
      await page.reload(); await recordReady(); await settle(500);
      const stage = await txt(T('crm-record') + ' ' + T('crm-stage-chip')), move = await count(T('crm-act-stage')), b = await body();
      return { ok: sent.status < 300 && stage === 'Customer' && move === 0, saw: 'bill ' + sent.no + ' → HTTP ' + sent.status + ' · chip "' + stage + '" · Move to… buttons: ' + move + (/Bills/.test(b) ? ' · the bill is on the record' : ' · no bill on the record') };
    });
    await w.step('L16', 'The server refuses a stage move for a party that traded (IS_CUSTOMER) — and the Leads list no longer lists them', async () => {
      let st = null, code = '';
      if (REAL) {   /* the billed lead is no longer in the Leads view (a customer now, FX-L2C): the Parties list names them now */
        const r = await api.j('/api/crm/parties', { token }); const row = (r.b.parties || []).find((x) => x.display_name === NAMES.a); const id = row ? row.party_id : aKey;
        const s = await api.j('/api/crm/parties/' + id + '/stage', { method: 'POST', token, body: { stage: 'lead' } }); st = s.status; code = s.b.code || '';
      }
      else { const s = SI.l2cStage(S.l2c, NAMES.a, 'lead'); st = s.status; code = s.code; }
      await go('#/leads', T('crm-leads')); await settle(800);
      const listed = await leadRow(NAMES.a).count();
      return { ok: st === 409 && code === 'IS_CUSTOMER' && listed === 0, saw: 'POST stage → HTTP ' + st + ' ' + code + ' · still on the Leads list: ' + listed };
    });

    /* ── reverse / cancel: Lost, then back ──────────────────────────────────────────────────────────────────────── */
    await w.step('L17', 'Lead B: Move to… Lost → chip Lost → the Stage filter Lost finds it → Move to… New lead brings it back', async () => {
      await leadRow(NAMES.b).click(); await recordReady();
      await page.click(T('crm-act-stage')); await page.waitForSelector(T('crm-stage-sheet')); await page.click(T('crm-stage-lost'));
      await waitToast(/Moved/); await chipIs('lost'); await recordReady();
      const lost = await txt(T('crm-record') + ' ' + T('crm-stage-chip'));
      await go('#/leads', T('crm-leads')); await settle(500);
      await page.click(T('cbl-filters-crm-leads')); await page.waitForSelector(T('cbl-filters-pop-crm-leads')); await page.selectOption(T('cbl-filters-pop-crm-leads') + ' select[data-filt="stage"]', 'lost'); await settle(400);
      const found = await leadRow(NAMES.b).count(); await page.keyboard.press('Escape'); await page.click('[data-unfilt="stage"]').catch(() => {}); await settle(300);
      await leadRow(NAMES.b).click(); await recordReady();
      await page.click(T('crm-act-stage')); await page.waitForSelector(T('crm-stage-sheet')); await page.click(T('crm-stage-lead'));
      await waitToast(/Moved/); await chipIs('lead'); await recordReady();
      const back = await txt(T('crm-record') + ' ' + T('crm-stage-chip'));
      return { ok: lost === 'Lost' && found === 1 && back === 'New lead', saw: 'chip "' + lost + '" · filter Lost rows: ' + found + ' · back to "' + back + '"' };
    });

    /* ── width · the phone ──────────────────────────────────────────────────────────────────────────────────────── */
    await w.step('L18', 'Phone 390: Leads · Calls · Follow-ups · the record · Add lead — no sideways scroll on any', async () => {
      await page.setViewportSize(PHONE); const out = [];
      for (const [h, until] of [['#/leads', T('crm-leads')], ['#/calls', T('crm-calls')], ['#/followups', T('crm-fu-list')], ['#/party/' + encodeURIComponent(aKey), T('crm-actions')]]) {
        await go(h, until); await settle(500); const g = await sw(); out.push(h.replace(/#\/party\/.*/, '#/party') + ' ' + g.sw);
        if (g.sw !== 390) out[out.length - 1] += ' ✗';
      }
      await go('#/leads', T('crm-leads')); await page.click(T('crm-lead-add')); await page.waitForSelector(T('crm-lead-sheet')); await settle(300); const g2 = await sw(); out.push('add sheet ' + g2.sw + (g2.sw !== 390 ? ' ✗' : ''));
      await page.keyboard.press('Escape'); await settle(200);
      return { ok: !out.some((x) => /✗/.test(x)), saw: 'scrollWidth: ' + out.join(' · ') };
    });
    await w.step('L19', 'Phone 390: the Calls row opens its outcomes; the record shows the stage chip and Move to…', async () => {
      await go('#/calls', T('crm-calls')); await settle(500);
      const anyRow = page.locator('[data-row][data-testid^="crm-call-row-"]').first(); let acts = [];
      if (await anyRow.count()) { await anyRow.locator('[data-caret]').first().click().catch(() => {}); await settle(300); acts = await page.$$eval('.cbl-next .cbl-btn', (b) => b.map((x) => x.textContent.replace(/\s+/g, ' ').trim())); }
      await go('#/leads', T('crm-leads')); await settle(300); await leadRow(NAMES.b).click(); await recordReady();
      const stage = await txt(T('crm-record') + ' ' + T('crm-stage-chip')), move = await count(T('crm-act-stage')), g = await sw();
      return { ok: (acts.length === 6 || !(await anyRow.count())) && !!stage && move === 1 && g.sw === 390, saw: 'outcomes on the phone: ' + acts.length + ' · chip "' + stage + '" · Move to…: ' + move + ' · scrollWidth ' + g.sw };
    });
    await page.setViewportSize(LAP);

    /* ── the refused state: a view-only login ───────────────────────────────────────────────────────────────────── */
    await w.step('L20', 'A view-only login: + Add lead · Move to… · Log · every call outcome SHOWN and greyed with "Your login can only view" — and the server refuses the write', async () => {
      /* the viewer needs a row in today's call queue to look at: one untouched lead, added by the shop (the fixture seeds its own) */
      if (REAL) await api.j('/api/crm/leads', { method: 'POST', token, body: { name: 'Lead Esai ' + tag, phone: '5' + String(Date.now()).slice(-9) } });   /* clock-ok: a unique phone suffix */
      const ctx2 = await w.browser.newContext({ viewport: LAP, locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' });
      await ctx2.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
      const p2 = await ctx2.newPage(); p2.on('pageerror', (e) => w.errs.push(String(e && e.message || e)));
      try {
        if (REAL) {
          const v = await api.viewer(token, 'vw' + tag); await ctx2.addInitScript((b) => { try { localStorage.setItem('cb_api_base', b); } catch (_) {} }, api.base);
          await p2.goto(base + '/crm.html#/leads'); await p2.waitForSelector(T('signin-id'), { timeout: 20000 });
          await p2.fill(T('signin-id'), v.login); await p2.click(T('signin-go')); await p2.waitForSelector(T('signin-code') + ', ' + T('signin-pin'), { timeout: 20000 });
          if (await p2.locator(T('signin-code')).count()) await p2.fill(T('signin-code'), v.otp); else await p2.fill(T('signin-pin'), '2749');
          await p2.click(T('signin-verify'));
          const got = await p2.waitForSelector(T('shop-name') + ', ' + T('signin-pin1') + ', ' + T('signin-why'), { timeout: 20000 }).catch(() => null);
          if (!got) { await p2.screenshot({ path: require('path').join(__dirname, 'shots', 'walk-x-l2c' + (REAL ? '-real' : '') + '-viewer.png') }); return { ok: false, saw: 'the sign-in window after the code, as ' + v.login + ': "' + (await p2.locator(T('signin-window')).innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160) + '"' }; }
          if (await p2.locator(T('signin-pin1')).count()) { await p2.fill(T('signin-pin1'), '2749'); await p2.fill(T('signin-pin2'), '2749'); await p2.click(T('signin-pinsave')); await p2.waitForSelector(T('shop-name'), { timeout: 20000 }); }
        } else {
          const S2 = SI.standIn({ l2c: SI.l2cState({ seed: true }) }); await ctx2.route('**/api/**', (r) => SI.route(S2, r));
          await ctx2.addInitScript((s) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) {} }, SI.viewerSession());
          await p2.goto(base + '/crm.html#/leads'); await p2.waitForSelector(T('shop-name'), { timeout: 20000 });
        }
        await p2.waitForSelector(T('crm-leads'), { timeout: 20000 }); await p2.waitForTimeout(900);
        const who = (await p2.locator(T('shop-name')).innerText()).replace(/\s+/g, ' '), add = await p2.locator(T('crm-lead-add')).count();
        const addOff = add ? await p2.locator(T('crm-lead-add')).isDisabled() : false, addWhy = (await p2.locator(T('crm-lead-add-why')).innerText().catch(() => '')).trim();
        const row = p2.locator('[data-row][data-testid^="crm-lead-"]').first(); let move = -1, log = -1, moveOff = false, logOff = false, barWhy = '';
        /* a viewer's record draws its bar with every write greyed and the server's ONE sentence (FX-L2C: show the action, the server decides) */
        if (await row.count()) {
          await row.click(); await p2.waitForSelector(T('crm-record'), { timeout: 15000 }); await p2.waitForSelector(T('crm-rec-loading'), { state: 'detached', timeout: 15000 }).catch(() => {}); await p2.waitForTimeout(400);
          move = await p2.locator(T('crm-act-stage')).count(); moveOff = move ? await p2.locator(T('crm-act-stage')).isDisabled() : false;
          log = await p2.locator(T('crm-act-log')).count(); logOff = log ? await p2.locator(T('crm-act-log')).isDisabled() : false;
          barWhy = (await p2.locator(T('crm-actions-why')).innerText().catch(() => '')).trim();
        }
        await p2.evaluate(() => { location.hash = '#/calls'; }); await p2.waitForSelector(T('crm-calls'), { timeout: 15000 }); await p2.waitForTimeout(900);
        const crow = p2.locator('[data-row][data-testid^="crm-call-row-"]').first(); let whys = [], greyed = 0;
        if (await crow.count()) { await crow.locator('[data-caret]').first().click().catch(() => {}); await p2.waitForTimeout(300); whys = await p2.$$eval('.cbl-next .cbl-why', (s) => s.map((x) => x.textContent.trim())); greyed = await p2.locator('.cbl-next .cbl-btn[disabled]').count(); }
        let tried = '', server = null;
        if (REAL) {   /* the server, asked directly with the viewer's own token: the row the POST /actors made refuses the write (no PATCH behind it) */
          const vt = await p2.evaluate(() => { try { return JSON.parse(localStorage.getItem('cb_sess') || '{}').token || null; } catch (_) { return null; } });
          const s = await api.j('/api/crm/leads', { method: 'POST', token: vt, body: { name: 'Viewer Try ' + tag } }); server = s.status; tried += ' · POST /api/crm/leads as the viewer → HTTP ' + s.status + ' ' + (s.b.access_level || s.b.code || '');
        }
        if (add && !addOff) {   /* the page offered the write: press it — the SERVER's refusal must come back as a sentence on the sheet */
          await p2.evaluate(() => { location.hash = '#/leads'; }); await p2.waitForSelector(T('crm-lead-add'), { timeout: 15000 }); await p2.click(T('crm-lead-add')); await p2.waitForSelector(T('crm-lead-sheet'));
          await p2.fill(T('crm-lead-name'), 'Viewer Try ' + tag); await p2.click(T('crm-lead-save')); await p2.waitForTimeout(1500);
          tried += ' · a viewer pressing Save got: "' + ((await p2.locator(T('crm-lead-msg')).innerText().catch(() => '')) || (await p2.locator('#toast').innerText().catch(() => ''))).replace(/\s+/g, ' ').trim() + '"';
        }
        await p2.screenshot({ path: require('path').join(__dirname, 'shots', 'walk-x-l2c' + (REAL ? '-real' : '') + '-viewer.png') });
        const S = 'Your login can only view';
        const ok = /view-only/.test(who) && add === 1 && addOff && addWhy === S && move === 1 && moveOff && log === 1 && logOff && barWhy === S && greyed === 6 && whys.length === 1 && whys[0] === S && (!REAL || server === 403);
        return { ok, saw: '"' + who + '" · + Add lead: ' + (add ? (addOff ? 'greyed "' + addWhy + '"' : 'LIVE') : 'missing') + ' · Move to…: ' + (move ? (moveOff ? 'greyed' : 'LIVE') : 'missing') + ' · Log: ' + (log ? (logOff ? 'greyed' : 'LIVE') : 'missing') + ' · bar: "' + barWhy + '" · greyed outcomes: ' + greyed + ' · the sentence ' + whys.length + '× "' + (whys[0] || '') + '"' + tried };
      } catch (e) {
        await p2.screenshot({ path: require('path').join(__dirname, 'shots', 'walk-x-l2c' + (REAL ? '-real' : '') + '-viewer.png') }).catch(() => {});
        return { ok: false, saw: 'it stopped (' + String(e && e.message || e).split('\n')[0].slice(0, 80) + ') · the page: "' + (await p2.evaluate(() => document.body.innerText.replace(/\s+/g, ' ')).catch(() => '')).slice(0, 160) + '"' };
      } finally { await ctx2.close(); }
    });

    /* ── the party list: a shop is never its own party ─────────────────────────────────────────────────────────── */
    await w.step('L21', 'Parties: the shop\'s own name is not a row (a counter bill is sent to self), the billed lead is', async () => {
      await go('#/parties', '#crm_list [data-row], ' + T('cbl-empty-crm-parties')); await settle(900);
      const names = await page.$$eval('#crm_list [data-row]', (r) => r.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
      const shop = await txt(T('shop-name')), self = names.filter((n) => n.indexOf(shop.split(' ·')[0]) === 0).length, lead = names.filter((n) => n.indexOf(NAMES.a) >= 0).length;
      return { ok: self === 0 && lead === 1, saw: names.length + ' rows · rows named after the shop itself: ' + self + ' · the billed lead listed: ' + lead };
    });
    if (!REAL) await w.step('M43', 'the stand-in answered every /api/crm call as the API contract says', async () => { const [ok, saw] = C.finish(); return { ok, saw }; });
  } finally {
    if (api) await api.stop();
  }
});
