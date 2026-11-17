'use strict';
/**
 * frame-hang-sit.cjs — T1 for the read that never answers (the 25 s hang): on a fresh browser the page shows the practice frame, not the shop Home. Read-only, sit-grund throwaway pair (see frame-proof-sit.cjs).
 */
const L = require('/w/lead.cjs');
const { sleep, log } = L;
const SHOP = /We lean on|Leans on us|New orders|\bTill\b|Marketing|\bCRM\b|Your business|Set up|counters?\b|your shop/i;
(async () => {
  const browser = await L.chromium.launch();
  let pass = 0, fail = 0;
  for (const [seat, user] of [['aud', 'aud1@seedefirmau'], ['acct', 'acct1@seedefirmau']]) {
    const sess = await L.signIn(user);
    for (const vp of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
      const { ctx, page } = await L.ctxOf(browser, vp, sess);
      await ctx.route('http://localhost:3000/api/books-grants/practice*', () => {}); /* registered last = runs first: never answered */
      await page.goto(L.BASE + '/', { waitUntil: 'domcontentloaded' });
      await sleep(29000);
      const t = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim());
      const frame = (await page.locator('[data-testid="practice-failed"]').count()) > 0, retry = (await page.locator('[data-testid="read-failed-retry"]').count()) > 0;
      const good = frame && retry && !SHOP.test(t);
      if (good) pass++; else fail++;
      log((good ? '  ok  ' : '  XX  ') + 'T1 hang ' + seat + '-' + vp.width + ': frame ' + frame + ' retry ' + retry + ' shop words ' + SHOP.test(t) + ' :: ' + t.slice(0, 120));
      await ctx.close();
    }
  }
  log('RESULT pass=' + pass + ' fail=' + fail);
  await browser.close();
})().catch((e) => { log('FATAL ' + e.stack); process.exit(1); });
