#!/usr/bin/env node
/* e2e/action-state.cjs — M64 T1: ONE PRESS, ONE WRITE; AN IRREVERSIBLE WRITE ASKS FIRST; THE OUTCOME IS SAID WHERE IT HAPPENED.
 *
 * Drives the three controls M64 put on CBAction (public/app/accounts-shell.js), pressing the real buttons:
 *   A  Record a payment   (app.html › Customers › Receive › Record, `pay_record`)        POST /api/books/payments
 *   B  Lock a month       (CB Accounts › Month lock, `lk-lock-N`)                       POST /api/books/periods/:fy/:p/lock
 *   C  Close for good     (CB Accounts › Month lock, `lk-hard-N`) — IRREVERSIBLE         POST …/lock { hard:true }
 * For each: a double press sends ONE request (the stand-in holds every write 700 ms, so the second press lands while the
 * first is out), and the handler called twice in one tick sends one (the key guard, which survives a repaint that replaces
 * the button). For C: the page's own dialog comes first, Cancel sends NOTHING, Yes sends once. And the outcome: said beside
 * the control — the proposal / the row flipped / a refusal in the shop's words, never a thrown error's text.
 *
 * Pattern: e2e/one-avatar.cjs — Playwright, the stand-in API of books-web.cjs answering INSIDE the page, a static server on a
 * free OS port (in this process, closed at the end). Nothing reaches a real API. ONE headless browser.
 * Run:  node e2e/action-state.cjs        (exit 1 on any failure)
 */
'use strict';
const path = require('path');
const { chromium } = require('@playwright/test');
const { standIn, route: booksRoute } = require('./books-web.cjs');
const { serve } = require('./lib/serve.cjs');
const C = require('./lib/contract.cjs');   /* the one altered answer (periods) is checked against the API contract, like every harness that serves /api/books */

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
const HOLD = 700;
const SESSION = () => {
  const b64 = (x) => Buffer.from(JSON.stringify(x)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const tok = b64({ alg: 'none' }) + '.' + b64({ identity_id: 'ent-books', identity_type: 'entity', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.x';
  return JSON.stringify({ token: tok, role: 'entity', name: 'Books Shop', entity: 'Books Shop' });
};

(async () => {
  const S = standIn(); S.hard = {};
  const writes = [];                               /* every write that ARRIVED: { m, p, body } */
  const web = await serve(), b = await chromium.launch(), errs = [];
  const route = async (r) => {
    const q = r.request(), m = q.method(), p = new URL(q.url()).pathname;
    if (m !== 'GET') {
      let body = {}; try { body = JSON.parse(q.postData() || '{}'); } catch (_) {}
      writes.push({ m, p, body });
      if (S.failNextLock && /\/lock$/.test(p)) { S.failNextLock = false; return r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'TypeError: Cannot read properties of undefined (reading \'status\')' }) }); }
      await new Promise((res) => setTimeout(res, HOLD));
    }
    if (m === 'GET' && p === '/api/books/periods') {   /* the server lets a soft-locked month reopen with a reason (M157); the shared stand-in says may:false for every row, which hides the Reason box part C types into */
      return booksRoute(S, { request: () => q, fulfill: (o) => { const j = JSON.parse(o.body); j.periods.forEach((x) => { if (x.status === 'soft_locked') x.reopen = { may: true, why: null }; }); C.check('GET', '/api/books/periods', o.status || 200, j, 'action-state'); return r.fulfill(Object.assign({}, o, { body: JSON.stringify(j) })); } });
    }
    return booksRoute(S, r);
  };
  const count = (re) => writes.filter((w) => re.test(w.m + ' ' + w.p)).length;
  const settle = (ms) => new Promise((res) => setTimeout(res, ms || HOLD + 500));

  const ctx = await b.newContext({ viewport: { width: 1360, height: 900 }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.route('**/api/**', route);
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_sess', s); } catch (_) {} }, SESSION());
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(String(e.message)));
  p.on('dialog', (d) => { errs.push('a browser dialog opened: ' + d.type()); d.dismiss().catch(() => {}); });   /* never confirm()/alert() */

  try {
    /* ── 0 · the helper is there, on both pages' shared floor ── */
    await p.goto(web.url('/app.html#/app'));
    await p.waitForSelector('[data-testid="nav-task"]', { timeout: 20000 });
    ok(await p.evaluate(() => typeof CBAction === 'object' && typeof CBAction.run === 'function' && typeof CBAction.once === 'function' && bkOnce.toString().indexOf('CBAction.once') >= 0),
      'CBAction.run / CBAction.once exist, and bkOnce IS CBAction.once (one guard, not two)');

    /* ── A · Record a payment: a double press on Next records ONCE ── */
    await p.evaluate(() => navTo('customers'));
    await p.waitForSelector('[data-testid="cust-row-c1"]', { timeout: 15000 });
    await p.click('[data-testid="cust-row-c1"]');
    await p.waitForSelector('[data-testid="party-books-c1"] [data-testid="party-pay"]', { timeout: 15000 });
    await p.click('[data-testid="party-books-c1"] [data-testid="party-pay"]');
    await p.fill('[data-testid="pay_amt"]', '4000');
    await p.waitForSelector('[data-testid="alloc-0"]', { timeout: 10000 });   /* the bills table: the preview read (a POST, held like every write here) */
    const n0 = count(/^POST \/api\/books\/payments$/);
    /* R102b: Record ASKS first — a double press opens one question and writes nothing (the second tap lands on the dialog's backdrop, which is
       CBConfirm's own Cancel); the write is the Yes tap, and that is where the busy state is measured */
    await p.dblclick('[data-testid="pay_record"]'); await p.waitForTimeout(400);
    const asked = await p.locator('dialog[open] [data-testid="confirm-ok"]').count();
    ok(count(/^POST \/api\/books\/payments$/) - n0 === 0 && await p.locator('[data-testid="pay_amt"]').count() === 1, 'A · R102b: a double press on Record writes NOTHING — it asks first (question still up: ' + asked + ')');
    if (!asked) await p.click('[data-testid="pay_record"]');
    /* UX-115: a double press leaves the question UP (the backdrop's grace); a later tap on the backdrop is still Cancel */
    ok(asked === 1, 'A · UX-115: after a double press the question is still up (' + asked + ')');
    await p.waitForTimeout(700);
    await p.mouse.click(2, 2);
    ok(await p.locator('dialog[open] [data-testid="confirm-ok"]').count() === 0 && count(/^POST \/api\/books\/payments$/) - n0 === 0, 'A · UX-115: a backdrop tap after the grace is still Cancel, nothing written');
    await p.click('[data-testid="pay_record"]');
    await p.click('dialog[open] [data-testid="confirm-ok"]', { timeout: 5000 });
    const busy = await p.evaluate(() => { const x = document.querySelector('[data-testid="pay_record"]'); return x ? [x.disabled, x.getAttribute('aria-busy'), x.getAttribute('data-action-state')].join('/') : 'gone'; });
    ok(busy === 'true/true/busy', 'A · while the payment is out, Record is disabled + aria-busy + data-action-state=busy (' + busy + ')');
    await p.waitForSelector('[data-testid="pay_outcome"]', { timeout: 10000 }).catch(() => {});
    await settle();
    ok(count(/^POST \/api\/books\/payments$/) - n0 === 1, 'A · double press on Record → ONE POST /api/books/payments (' + (count(/^POST \/api\/books\/payments$/) - n0) + ')');
    ok(count(/^POST \/api\/books\/payments\/[^/]+\/(propose|confirm)$/) === 0, 'A · and no second step: one call recorded it and settled the bills');
    ok(await p.locator('[data-testid="pay_outcome"]').count() === 1 && await p.locator('[data-testid="pay_done"]').count() === 1, 'A · the outcome is shown where the press was: what happened, with Done');
    /* the key guard: the handler called twice in one tick (a repaint can hand the second press a NEW button) */
    await p.evaluate(() => closeModal());
    await p.click('[data-testid="party-books-c1"] [data-testid="party-pay"]');
    await p.fill('[data-testid="pay_amt"]', '100');
    await p.waitForSelector('[data-testid="alloc-0"]', { timeout: 10000 });
    const n1 = count(/^POST \/api\/books\/payments$/);
    await p.evaluate(() => { payRecord(); payRecord(); }); await p.click('dialog[open] [data-testid="confirm-ok"]', { timeout: 5000 });
    await settle(HOLD + 900);
    ok(count(/^POST \/api\/books\/payments$/) - n1 === 1, 'A · payRecord() twice in one tick → ONE POST (the key guard, not just the disabled button)');
    await p.evaluate(() => closeModal());

    /* ── B · Lock a month (CB Accounts): a double press locks ONCE, the row flips ── */
    await p.goto(web.url('/accounts.html#daybook'));
    await p.waitForSelector('[data-testid="acc-nav-lock"]', { timeout: 20000 });
    await p.click('[data-testid="acc-nav-lock"]');
    await p.waitForSelector('[data-testid="lk-row-12"]', { timeout: 15000 });
    const mo = String((new Date().getMonth() + 9) % 12 + 1);
    const l0 = count(/\/lock$/);
    await p.dblclick('[data-testid="lk-lock-' + mo + '"]');
    await p.waitForFunction((n) => /Locked/.test((document.querySelector('[data-testid="lk-state-' + n + '"]') || {}).textContent || ''), mo, { timeout: 10000 }).catch(() => {});
    await settle();
    ok(count(/\/lock$/) - l0 === 1, 'B · double press on Lock → ONE POST …/lock (' + (count(/\/lock$/) - l0) + ')');
    ok(/Locked/.test(await p.textContent('[data-testid="lk-state-' + mo + '"]')) && /Locked/.test(await p.textContent('[data-testid="lk_out"]')), 'B · the outcome: the month\'s row now says Locked, and the line under the months says so');
    /* a failure says the shop's sentence — never the thrown text */
    S.failNextLock = true;
    const nxt = String(mo % 12 + 1);
    await p.click('[data-testid="lk-lock-' + nxt + '"]');
    await p.waitForFunction(() => ((document.querySelector('[data-testid="lk_out"]') || {}).textContent || '').length > 0 && !/Locked/.test(document.querySelector('[data-testid="lk_out"]').textContent), null, { timeout: 8000 }).catch(() => {});
    const failTxt = await p.textContent('[data-testid="lk_out"]');
    ok(/Could not change it/.test(failTxt) && !/TypeError|undefined|status/.test(failTxt), 'B · a 500 is said as "Could not change it" — no error text reaches the person (' + failTxt.trim() + ')');
    ok(await p.locator('[data-testid="lk-lock-' + nxt + '"]').isEnabled(), 'B · after a failure the button is pressable again');

    /* ── C · Close for good (IRREVERSIBLE): asks first; Cancel sends nothing; a double press asks ONCE; Yes sends ONCE ── */
    const h0 = count(/\/lock$/);
    await p.click('[data-testid="lk-hard-' + mo + '"]');
    await p.waitForSelector('[data-testid="confirm-cancel"]', { timeout: 5000 }).catch(() => {});
    ok(await p.locator('[data-testid="confirm-ok"]').count() === 1 && /never open again/.test(await p.textContent('[data-testid="confirm"]').catch(() => '') || await p.evaluate(() => document.body.innerText)), 'C · Close for good opens the page\'s own dialog first, saying it never opens again');
    await settle(300);
    ok(count(/\/lock$/) - h0 === 0, 'C · nothing is sent while the question is open');
    await p.click('[data-testid="confirm-cancel"]');
    await settle();
    ok(count(/\/lock$/) - h0 === 0 && await p.locator('[data-testid="confirm-ok"]').count() === 0 && /Locked/.test(await p.textContent('[data-testid="lk-state-' + mo + '"]')) && !/Closed/.test(await p.textContent('[data-testid="lk-state-' + mo + '"]')), 'C · Cancel sends NOTHING and the month stays Locked');
    ok(await p.locator('[data-testid="lk-hard-' + mo + '"]').isEnabled(), 'C · after Cancel the button is pressable again');
    await p.dblclick('[data-testid="lk-hard-' + mo + '"]');
    await settle(400);
    ok(await p.locator('[data-testid="confirm-ok"]').count() <= 1 && count(/\/lock$/) - h0 === 0, 'C · a double press asks at most once and sends nothing by itself (' + await p.locator('[data-testid="confirm-ok"]').count() + ' dialog)');
    if (await p.locator('[data-testid="confirm-ok"]').count() === 0) { await p.click('[data-testid="lk-hard-' + mo + '"]'); await p.waitForSelector('[data-testid="confirm-ok"]', { timeout: 5000 }); }
    await p.click('[data-testid="confirm-ok"]');
    await p.evaluate((n) => { bkLockDo('hard', +n); }, mo);   /* a second press while the first is out */
    await p.waitForFunction((n) => /Closed for good/.test((document.querySelector('[data-testid="lk-state-' + n + '"]') || {}).textContent || ''), mo, { timeout: 10000 }).catch(() => {});
    await settle();
    const hard = writes.filter((w) => /\/lock$/.test(w.p)).slice(h0);
    ok(hard.length === 1 && hard[0].body.hard === true, 'C · Yes → ONE POST …/lock {hard:true}, a press while it was out sent nothing (' + hard.length + ')');
    ok(/Closed for good/.test(await p.textContent('[data-testid="lk-state-' + mo + '"]')) && await p.locator('[data-testid="lk-hard-' + mo + '"]').count() === 0 && await p.locator('[data-testid="confirm-ok"]').count() === 0, 'C · the outcome: the row says Closed for good and offers nothing more; no dialog left open');

    ok(...C.finish());
    ok(errs.length === 0, 'no page error and no browser dialog (confirm/alert) the whole run' + (errs.length ? ' — ' + errs.slice(0, 3).join(' | ') : ''));
  } catch (e) {
    ok(false, 'the run threw: ' + (e && e.message));
  } finally {
    await b.close().catch(() => {});
    web.close();
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
