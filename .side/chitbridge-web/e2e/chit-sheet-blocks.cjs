/* e2e/chit-sheet-blocks.cjs — walk blocks of chit-sheet.cjs kept apart so that file stays under the size ceiling.
 * OWNS: the bill-step and accept-use blocks, the wide-screen Rung check, the window-scroll spy and the Open-page call spy.
 * CALLED BY: e2e/chit-sheet.cjs (each function takes `env`: ok, open, standIn, waitSheet, acts, sheetOpen, yesAccept, take, SHOP, TODAY).
 * chit-sheet-breaks.cjs names the walk block that guards each break; the take() calls here keep that numbering. */
'use strict';

/* the Rung by column only shows on a wide screen: open it wide and read the person cell of both rows */
async function wideRung(env) {
  const { ok, open, standIn } = env;
  const wide = await open(standIn(), 2200);
  const w1 = await wide.p.textContent('[data-testid="db-entry-JV/2026-27/000001"]'), w2 = await wide.p.textContent('[data-testid="db-entry-JV/2026-27/000002"]');
  ok(/Books Shop \(owner\)/.test(w1) && /Mani/.test(w2) && !/[(]owner[)]/.test(w2), 'the Rung by column marks the shop owner (owner) and names Mani without it — got ' + w2.replace(/\s+/g, ' ').slice(0, 100));
  await wide.ctx.close();
}

/* the WINDOW does not move either: opening and closing the sheet never asks the page to scroll (a spy on window.scrollTo; the app shell scrolls inside, so the position itself cannot show it) */
async function windowScrollSpy(env, p) {
  const { ok, waitSheet, sheetOpen } = env;
  await p.evaluate(() => { window.__scrolls = []; window.scrollTo = function () { window.__scrolls.push([].slice.call(arguments)); }; });
  await p.locator('[data-testid="db-src-JV/2026-27/000001"]').evaluate((e) => e.click()); await waitSheet(p, 'C2/26-27/0002');
  await p.click('[data-testid="cs-close"]'); await p.waitForTimeout(250);
  const scrolls = await p.evaluate(() => window.__scrolls.length);
  ok(!(await sheetOpen(p)) && scrolls === 0, 'the page behind the sheet is never scrolled when the sheet opens and closes (window.scrollTo called ' + scrolls + ' times)');
}

/* the sheet closes BEFORE the page door is called: a spy on openChitPage records, at the moment of the call, whether the sheet is still open (sessionStorage survives the same-origin navigation) */
async function spyOnPageDoor(p) {
  await p.evaluate(() => { const real = window.openChitPage; window.openChitPage = function (id) { const d = document.getElementById('chitsheet'), body = d && d.querySelector('.cs-body'); sessionStorage.setItem('cs-page-call', JSON.stringify({ id: id, sheetOpen: !!(d && d.open), held: !!(body && body.innerHTML.trim()) })); return real.apply(this, arguments); }; });
}
async function checkPageDoorCall(env, p) {
  const pageCall = JSON.parse(await p.evaluate(() => sessionStorage.getItem('cs-page-call') || 'null'));
  env.ok(!!pageCall && pageCall.id === 'sb1' && !pageCall.sheetOpen && !pageCall.held, 'Open page closes the sheet first, then opens the chit page (the sheet is shut and empty when the page door is called) — got ' + JSON.stringify(pageCall));
}

/* the step of a bill I received is read from MY state_log bill_step row on a fresh open, never from the shared status (the seller's): the two disagree both ways */
async function billStepBlocks(env) {
  const { ok, open, standIn, waitSheet, acts, take, SHOP, TODAY } = env;
  const openBill = async (S) => { const o = await open(S); await o.p.click('[data-testid="db-src-JV/2026-27/000002"]'); await waitSheet(o.p, 'AM-81'); return o; };
  if (take()) {
    const S = standIn(); S.chits.sb1.state_log.push({ action: 'bill_step', code: 'B-2100', step: 'accepted', mine: true, action_by_display_name: SHOP, created_at: TODAY + 'T04:30:00.000Z' });
    const { ctx, p } = await openBill(S);
    ok(S.chits.sb1.header.current_status === 'pending' && /Accepted/.test(await p.textContent('[data-testid="cs-step"]')) && (await acts(p)).indexOf('accept') < 0, 'a bill my own bill_step row says accepted reads Accepted and offers no Accept, while the shared status still says pending');
    await ctx.close();
  }
  if (take()) {
    const S = standIn(); S.chits.sb1.header.current_status = 'accepted';
    const { ctx, p } = await openBill(S);
    ok(/To accept/.test(await p.textContent('[data-testid="cs-step"]')) && (await acts(p)).indexOf('accept') >= 0, 'a shared status of accepted (the seller) does not move my step: no bill_step of mine, so still To accept with Accept offered');
    await ctx.close();
  }
}

/* Accept with a use choice: "Let my catalogue decide" sends no /use; Goods in sends it, then accepts; Open page is the one way out */
async function acceptUseBlocks(env) {
  const { ok, open, standIn, waitSheet, yesAccept, take } = env;
  /* "Let my catalogue decide": accepted without a /use call */
  if (take()) {
    const S = standIn(); const { ctx, p } = await open(S);
    await p.click('[data-testid="db-src-JV/2026-27/000002"]'); await waitSheet(p, 'AM-81');
    await p.click('[data-testid="cs-act-accept"]'); await p.click('[data-testid="cs-use-auto"]'); await yesAccept(p);
    await p.waitForFunction(() => /Accepted/.test((document.querySelector('[data-testid="cs-step"]') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    ok(S.useCalls.length === 0 && S.statusCalls.length === 1 && S.statusCalls[0].body.status === 'accepted', '"Let my catalogue decide" → accepted with no /use call');
    await ctx.close();
  }
  /* Goods in asks what the goods are for, then accepts */
  if (take()) {
    const S = standIn(); const { ctx, p } = await open(S);
    await p.click('[data-testid="db-src-JV/2026-27/000002"]'); await waitSheet(p, 'AM-81');
    await p.click('[data-testid="cs-act-goodsin"]'); await p.click('[data-testid="bill-use-resale"]'); await yesAccept(p);
    await p.waitForFunction(() => /Accepted/.test((document.querySelector('[data-testid="cs-step"]') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    ok(S.useCalls.length === 1 && S.useCalls[0].body.use === 'resale' && S.statusCalls.length === 1 && S.statusCalls[0].body.status === 'accepted', 'Goods in → what it is for (PUT /use) then accepted');
    /* Open page: the one way out — the chit PAGE in CB CRM (crm.html#/chit/<id>, CRM2), in the SAME tab so Back returns (NAV-MAP 13; accounts.html openChitPage sets location.href), never the workshop */
    await spyOnPageDoor(p);
    await p.click('[data-testid="cs-act-page"]');
    await p.waitForURL(/[\/]crm[.]html#[\/]chit[\/]sb1$/, { timeout: 8000 }).catch(() => {});
    await checkPageDoorCall(env, p);
    ok(/[\/]crm[.]html#[\/]chit[\/]sb1$/.test(p.url()), 'Open page leaves the sheet for the chit page in CRM (/crm.html#/chit/sb1), the same tab — the only navigation (' + p.url().replace(/^https?:[\/][\/][^\/]+/, '') + ')');
    await ctx.close();
  }
}

module.exports = { wideRung, windowScrollSpy, spyOnPageDoor, checkPageDoorCall, billStepBlocks, acceptUseBlocks };
