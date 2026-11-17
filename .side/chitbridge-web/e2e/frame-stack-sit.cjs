'use strict';
/**
 * frame-stack-sit.cjs — what sits above the first data row of a client view, element by element (y, height, name), for one seat at both sizes. Read-only, on the sit-grund throwaway pair (see frame-proof-sit.cjs).
 * Env SEAT=aud|acct, VIEW=tb|daybook|...
 */
const L = require('/w/lead.cjs');
const C = '5e5877a0-4dbf-42bc-a7a3-3d9c6ffc2497';
const SEAT = process.env.SEAT || 'aud', VIEW = process.env.VIEW || 'tb';
(async () => {
  const browser = await L.chromium.launch();
  const sess = await L.signIn(SEAT === 'aud' ? 'aud1@seedefirmau' : 'acct1@seedefirmau');
  for (const vp of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    const { ctx, page } = await L.ctxOf(browser, vp, sess);
    await page.goto(L.BASE + '/network.html?open=' + C + '&view=' + VIEW, { waitUntil: 'domcontentloaded' });
    await L.sleep(6000);
    L.log('\n### ' + SEAT + ' ' + VIEW + ' ' + vp.width);
    await L.cap(page, 'stack-' + SEAT + '-' + VIEW + '-' + vp.width, { n: 300 });
    await ctx.close();
  }
  await browser.close();
})().catch((e) => { L.log('FATAL ' + e.stack); process.exit(1); });
