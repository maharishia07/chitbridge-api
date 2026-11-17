'use strict';
/**
 * frame-proof-sit.cjs — firm frame P0 proof T1-T8 on a SIT box (sit-grund, a throwaway api+web pair against the seeded firm), read-only: lead.cjs blocks every write.
 * OWNS     the proof run of the REQ PM/REQ-FIRM-FRAME-P0-2026-11-16.md: 429 / 500 / offline / never-answers on the practice read, the six failed client reads, the seat sheet, the deep link, first data by 20% / 30%, the signed-out pages.
 * UNIT      14/Practice door (accountant opens a client)
 * CALLED BY by hand on the box: the playwright image with /w (lead.cjs from fable-lead, BASE and API pointed at the throwaway pair) and /e2e (this repo's e2e). ONE sign-in per seat per run; the code lives in the environment only.
 */
const L = require('/w/lead.cjs');
const { sleep, log } = L;
const FDT = require('/e2e/lib/first-data-top.cjs');
const C = '5e5877a0-4dbf-42bc-a7a3-3d9c6ffc2497';
const SEATS = { aud: 'aud1@seedefirmau', acct: 'acct1@seedefirmau' };
const VPS = [{ width: 1366, height: 768 }, { width: 390, height: 844 }];
const SHOP = /We lean on|Leans on us|New orders|\bTill\b|Marketing|\bCRM\b|Your business|Set up|counters?\b|your shop/i;
const RAW = /Server error|Too many requests|Failed to fetch|Forbidden|Check the connection|Not in a network yet|\[object|undefined/i;
const SERVER_403 = "Only an owner, or a person with the auditor role, can open another business's books.";
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else fail++; log((cond ? '  ok  ' : '  XX  ') + msg); };
const txt = (page) => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim());
const has = (page, id) => page.locator('[data-testid="' + id + '"]').count().then((n) => n > 0);
const go = async (page, path, ms) => { await page.goto('about:blank'); await page.goto(L.BASE + path, { waitUntil: 'domcontentloaded' }); await sleep(ms || 3500); };
const FAULTS = { 429: () => ({ status: 429, body: { error: 'Too many requests' } }), 500: () => ({ status: 500, body: { error: 'Server error' } }), offline: () => 'abort' };
const only = (prefix, fault) => (p) => (p.indexOf(prefix) === 0 ? fault() : null);

(async () => {
  const browser = await L.chromium.launch();
  const sess = {};
  for (const k of Object.keys(SEATS)) sess[k] = await L.signIn(SEATS[k]);
  for (const k of Object.keys(SEATS)) {
    const r = await L.call('GET', '/api/books-grants', null, sess[k].token), body = r.body || r;
    const rows = (body.received || []).filter((x) => String(x.grantor_entity) === C);
    log('GRANTS ' + k + ' seats=' + JSON.stringify(body.seats) + ' rows=' + rows.map((x) => x.preset + ':may_use=' + x.may_use).join(','));
  }
  for (const seat of Object.keys(SEATS)) {
    for (const vp of VPS) {
      const tag = seat + '-' + vp.width, role = seat === 'aud' ? 'auditor' : 'adviser', other = seat === 'aud' ? 'adviser' : 'auditor';
      // T1: the practice read fails on a FRESH browser (no hint): never the shop Home
      for (const f of Object.keys(FAULTS)) {
        const { ctx, page } = await L.ctxOf(browser, vp, sess[seat], only('/api/books-grants/practice', FAULTS[f]));
        await go(page, '/', 4500);
        const t = await txt(page);
        ok((await has(page, 'practice-failed')) && (await has(page, 'read-failed-retry')) && /could not be read/.test(t) && !SHOP.test(t) && !RAW.test(t), 'T1 ' + tag + ' ' + f + ': practice frame + Try again, 0 shop words, 0 raw words :: ' + t.slice(0, 120));
        if (f === '500') await page.screenshot({ path: L.OUT + '/t1-' + tag + '.png' }).catch(() => {});
        await ctx.close();
      }
      { // retry succeeds: only the first read fails
        let n = 0;
        const { ctx, page } = await L.ctxOf(browser, vp, sess[seat], (p) => (p.indexOf('/api/books-grants/practice') === 0 && n++ < 1 ? FAULTS[500]() : null));
        await go(page, '/', 4000);
        const failed = await has(page, 'read-failed-retry');
        await page.click('[data-testid="read-failed-retry"]').catch(() => {});
        await sleep(5000);
        ok(failed && !(await has(page, 'practice-failed')) && !SHOP.test((await txt(page)).slice(0, 400)), 'T1 ' + tag + ' Try again re-reads and draws the practice');
        await ctx.close();
      }
      if (vp.width === 1366) { // the read that never answers
        const { ctx, page } = await L.ctxOf(browser, vp, sess[seat]);
        await ctx.route('http://localhost:3000/api/books-grants/practice*', () => {}); /* registered last = runs first: the read is never answered */
        await go(page, '/', 29000);
        const t = await txt(page);
        ok((await has(page, 'practice-failed')) && !SHOP.test(t), 'T1 ' + tag + ' a read that never answers (29 s): the frame, not the shop Home :: ' + t.slice(0, 100));
        await ctx.close();
      }
      // T2: the client page, every failed read
      const f403 = () => ({ status: 403, body: { code: 'BOOKS_GRANT_NOT_FOR_YOU', detail: SERVER_403, message: SERVER_403 } });
      for (const [f, make] of [['429', FAULTS[429]], ['500', FAULTS[500]], ['offline', FAULTS.offline], ['403', f403]]) {
        const { ctx, page } = await L.ctxOf(browser, vp, sess[seat], only('/api/books/trial-balance', make));
        await go(page, '/network.html?open=' + C + '&view=tb', 5000);
        if (await has(page, 'nw-seat-title')) { await page.click('[data-testid="nw-seat-' + role + '"]').catch(() => {}); await sleep(3500); }
        const t = await txt(page), st = await page.locator('[data-testid="read-failed"]').first().getAttribute('data-status').catch(() => null);
        ok((await has(page, 'read-failed')) && !RAW.test(t) && (f !== '403' || /auditor role/.test(t)) && (f === '403' || /could not be read/.test(t)), 'T2 ' + tag + ' client read ' + f + ': one frame (status ' + st + '), no raw words :: ' + t.slice(0, 140));
        await ctx.close();
      }
      { // a failed grants read is never "Not in a network yet"
        const { ctx, page } = await L.ctxOf(browser, vp, sess[seat], (p) => (p === '/api/books-grants' ? FAULTS[500]() : null));
        await go(page, '/network.html', 4500);
        const t = await txt(page);
        ok(!/Not in a network yet/.test(t) && (await has(page, 'read-failed')), 'T2 ' + tag + ' a failed grants read never says "Not in a network yet" :: ' + t.slice(0, 100));
        await ctx.close();
      }
      { // T4 + T5: seat and deep link, with the OTHER seat remembered
        const { ctx, page } = await L.ctxOf(browser, vp, sess[seat]);
        await go(page, '/network.html', 2500);
        await page.evaluate(([c, o]) => { try { localStorage.setItem('cb_seat:' + c, o); } catch (_) { /* blocked */ } }, [C, other]);
        await go(page, '/network.html?open=' + C + '&view=tb&fy=2025-26', 5000);
        const sheet = await has(page, 'nw-seat-title'), url = await page.evaluate(() => location.search), stored = await page.evaluate((c) => localStorage.getItem('cb_seat:' + c), C), t = await txt(page);
        ok(!sheet && (await has(page, 'ba-band') || await has(page, 'bv-band')) && /view=tb/.test(url), 'T4/T5 ' + tag + ' stored ' + other + ': no sheet, Trial balance, address ' + url + ', stored seat now ' + stored);
        ok(!/Only an owner|not for you/i.test(t), 'T4 ' + tag + ' no wrong-role sentence');
        await page.screenshot({ path: L.OUT + '/t45-' + tag + '.png' }).catch(() => {});
        if (vp.width === 1366) { // T6: every view at both sizes, once per seat
          const r = await FDT.firstDataTop(page, { T: (id) => '[data-testid="' + id + '"]', has: (s) => page.locator(s).count().then((n) => n > 0), WIDE: VPS[0], NARROW: VPS[1], seat: seat === 'aud' ? 'auditor' : 'accountant' });
          log('T6 ' + seat + ' ' + (r.ok ? 'PASS' : 'FAIL'));
          (r.all || []).forEach((l) => log('   ' + l));
          (r.bad || []).forEach((l) => log('   BAD ' + l));
          ok(r.ok, 'T6 ' + seat + ' first data by 20% / 30% on every view');
        }
        await ctx.close();
      }
      { // T7: #/returns is said, not swapped
        const { ctx, page } = await L.ctxOf(browser, vp, sess[seat]);
        await go(page, '/accounts.html?acting=' + C + '&role=' + role + '#/returns', 5000);
        ok((await has(page, 'acc-seat-closed')) && /not open to your seat/.test(await txt(page)), 'T7 ' + tag + ' #/returns says it is not open to this seat');
        await go(page, '/accounts.html?acting=' + C + '&role=' + role + '#/lock', 5000);
        ok(!(await has(page, 'acc-seat-closed')) && !RAW.test(await txt(page)), 'T7 ' + tag + ' #/lock opens');
        await ctx.close();
      }
    }
  }
  for (const vp of VPS) { // T3: signed out
    for (const p of ['/', '/network.html', '/accounts.html', '/settings.html']) {
      const { ctx, page } = await L.ctxOf(browser, vp, null);
      await go(page, p, 3500);
      const t = await txt(page), reg = /Register|New shop/i.test(t);
      log('T3 ' + vp.width + ' ' + p + ' register=' + reg + ' shopwords=' + SHOP.test(t) + ' :: ' + t.slice(0, 160));
      if (p !== '/') ok(!reg && /sign/i.test(t), 'T3 ' + vp.width + ' ' + p + ': plain sign-in, no register door');
      await ctx.close();
    }
  }
  log('\nRESULT pass=' + pass + ' fail=' + fail + ' ' + L.stats());
  await browser.close();
})().catch((e) => { log('FATAL ' + e.stack); process.exit(1); });
