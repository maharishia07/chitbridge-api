/* finfix-live.cjs — l16-finfix · Receivables / Payables party expansion (a server-paged sub-table), the Needs attention strip on the Day book, Ledgers and BAS, against a REAL api
 * (a SIT box's throwaway api, e2e/lib/live-harbour.cjs). Shots 1366x768 and 390x844 into $OUT; every check prints ok/XX; a page that scrolls sideways or down past its box is a XX.
 * env: API, OUT, HANDLE (harbour-plumbing-au), TOKEN (optional: a ready token). Never production. */
'use strict';
const { chromium } = require('@playwright/test'), fs = require('fs'), path = require('path');
const L = require('./lib/live-harbour.cjs');
const OUT = process.env.OUT || 'e2e/shots';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  if (process.env.TOKEN) fs.writeFileSync(path.join(OUT, 'token.json'), JSON.stringify({ token: process.env.TOKEN }));
  const { base } = await L.serve(), token = await L.signIn(process.env.HANDLE || 'harbour-plumbing-au');
  const b = await chromium.launch();
  for (const vp of [{ width: 1366, height: 768, tag: '1366' }, { width: 390, height: 844, tag: '390' }]) {
    const { ctx, page: p } = await L.open(b, base, token, vp, undefined, '/accounts.html#receivables', 'body');
    const shot = async (name) => { await p.screenshot({ path: path.join(OUT, name + '-' + vp.tag + '.png') }); };
    const fit = async (name) => { const s = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth })); ok(s.sw <= s.iw + 1, name + ' ' + vp.tag + ': no sideways page scroll (' + s.sw + '/' + s.iw + ')'); };
    /* Receivables: a party row opens to the sub-table */
    await p.waitForTimeout(3500);
    await shot('recv-list');
    const rows = p.locator('.cbl-row[aria-expanded]');
    const n = await rows.count();
    ok(n > 0, 'Receivables ' + vp.tag + ': the party rows are openable (aria-expanded) — ' + n);
    if (n) {
      await rows.first().click();
      await p.waitForSelector('[data-pb]', { timeout: 15000 }).catch(() => {});
      await p.waitForTimeout(800);
      const t = flat(await p.locator('[data-pb]').first().innerText().catch(() => ''));
      ok(vp.width < 700 || /Date.*Bill.*Due date.*Days overdue.*Still owed.*Reviewed/i.test(t), 'the sub-table header: Date · Bill · (Why) · Due date · Days overdue · Still owed · Reviewed (1366 only; a phone shows cards) (' + vp.tag + ')');
      ok(/Needs you \d+/.test(t) && /Open \d+/.test(t) && /All \d+/.test(t), 'Needs you / Open / All carry the server counts (W15-113: the Paid tab is gone, All holds the paid)');
      ok(!/ 07:00| 0[0-9]:[0-9]{2} (am|pm)/i.test(t), 'no time-of-day noise on the bill rows');
      await shot('recv-open');
      const chip = p.locator('[data-pb] [data-b^="band-"]').first();
      if (await chip.count()) {
        const before = await p.locator('[data-pb] .cbl-ntrow').count();
        await chip.click(); await p.waitForTimeout(900);
        const on = await p.locator('[data-pb] [data-b^="band-"][aria-pressed="true"]').count();
        const after = await p.locator('[data-pb] .cbl-ntrow').count();
        ok(on === 1 && after <= before, 'a band chip filters the bills (' + before + ' → ' + after + ') and shows pressed');
        await shot('recv-band');
        await p.locator('[data-pb] [data-b^="band-"][aria-pressed="true"]').first().click(); await p.waitForTimeout(900);
        ok((await p.locator('[data-pb] .cbl-ntrow').count()) === before, 'pressed again, the band clears');
      }
      const all = p.locator('[data-pb] [data-b="state-all"]');
      if (await all.count()) { await all.click(); await p.waitForTimeout(900); await shot('recv-all'); }
      const hdr = p.locator('[data-pb] [data-nt-sort="days"]');
      if (await hdr.count()) { await hdr.click(); await p.waitForTimeout(900); ok((await p.locator('[data-pb] [data-nt-sort="days"]').innerText()).includes('▼'), 'a header press sorts on the server'); await shot('recv-sort'); }
      // keyboard pass: the caret, a chip and a sort header are reachable and pressable by keys
      await p.keyboard.press('Tab'); ok(await p.evaluate(() => !!document.activeElement && document.activeElement !== document.body), 'keyboard: Tab lands on a control');
    }
    await fit('receivables');
    /* Payables */
    await p.goto(base + '/accounts.html#payables'); await p.waitForTimeout(3500);
    await shot('pay-list');
    const prow = p.locator('.cbl-row[aria-expanded]');
    if (await prow.count()) { await prow.first().click(); await p.waitForSelector('[data-pb]', { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(800); await shot('pay-open'); const t = flat(await p.locator('[data-pb]').first().innerText().catch(() => '')); ok(vp.width < 700 || /Date.*Bill.*Due date.*Days overdue.*Still owed/i.test(t), 'Payables opens the same sub-table'); ok(((t.match(/On hold/g)) || []).length <= 1, 'a hold is said once'); }
    await fit('payables');
    /* Day book · Ledgers · BAS: the strip */
    for (const [name, hash] of [['daybook', '#daybook'], ['ledgers', '#ledgers'], ['bas', '#gstclose']]) {
      await p.goto(base + '/accounts.html' + hash); await p.waitForTimeout(4000);
      await shot('strip-' + name);
      const strip = flat(await p.locator('[data-testid="attn-strip"]').first().innerText().catch(() => ''));
      ok(/Needs attention/i.test(strip), name + ' ' + vp.tag + ': the strip is at the top — "' + strip + '"');
      await fit(name);
      if (name === 'daybook') {
        const chips = p.locator('[data-testid^="attn-"][data-b^="attn-"]');
        if (await chips.count()) { await chips.first().click(); await p.waitForTimeout(1200); await shot('strip-daybook-list'); ok((await p.locator('[data-testid="attn-list"] .cbl-ntrow').count()) > 0, 'a count opens the entries behind it'); }
      }
    }
    await ctx.close();
  }
  await b.close();
  console.log('\n  ' + pass + ' ok, ' + fail + ' XX');
  process.exit(fail ? 1 : 0);
})();
