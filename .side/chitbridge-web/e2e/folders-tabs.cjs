/* folders-tabs.cjs (MNT-59, pin leg iii) — the four Folders tabs, opened from app.html the way a person opens them: ensureCap('folders') first, then Chits, Metrics, Rules, Group sum.
 * OWNS      per tab: the endpoint it calls (foldersList · folderChits · folderReconcile · folderRules/folderAllRules · folderGroupSum) and that the pane draws its stand-in reply;
 *           three behaviours on the code that moves in the split: _doMove's request body, ruleMove's sort writes (the sign), _gsMoney's quiet flag.
 * CALLED BY e2e/run-shard.cjs (EXTRA) · the move-only PR of the folders split.
 * FLOW      serve public/ ──▶ app.html signed in (no service worker) ──▶ ensureCap('folders') ──▶ openFolderPane(tab) per tab ──▶ read the pane and S.calls.
 * RED when CAP_WITH drops a half (a tab then throws or draws nothing), and under each mutation: _doMove path, ruleMove sign, _gsMoney `quiet: !mixed`. */
'use strict';
const { chromium } = require('@playwright/test');
const { server, signedContext, counters, FOLDER, RULE, RULE2, CHIT } = require('./folders-pin-lib.cjs');
const { ok, finish } = counters();

(async () => {
  const srv = await server(), browser = await chromium.launch(), S = { calls: [], writes: [] }, threw = [];
  const ctx = await signedContext(browser, S, 'block');
  const page = await ctx.newPage();
  page.on('pageerror', (error) => threw.push(error.message));
  await page.goto(srv.base + '/app.html#/app');
  await page.waitForSelector('[data-testid="nav-task"]', { timeout: 20000 });
  const loaded = await page.evaluate(() => ensureCap('folders').then(() => 'loaded', (error) => 'failed: ' + error.message));
  ok(loaded === 'loaded', 'ensureCap(\'folders\') resolves — every half of the capability loads (' + loaded + ')');
  const pane = (tab) => page.evaluate(async (which) => {
    await openFolderPane(which);
    await new Promise((done) => setTimeout(done, 700));
    const host = document.getElementById('fld_pane');
    return host ? host.innerText : '(no pane)';
  }, tab);
  const closePane = () => page.evaluate(() => { if (typeof closeModal === 'function') closeModal(); });
  const called = (pattern) => S.calls.some((call) => pattern.test(call));

  await page.evaluate(() => loadFolders());
  await page.waitForFunction(() => Array.isArray(UI.folders) && UI.folders.length > 0, null, { timeout: 15000 }).catch(() => {});
  ok(called(/^GET \/api\/folders$/), 'foldersList: the folder list is read');

  /* Chits: a picked folder reads its chits and the view paints them */
  await page.evaluate((id) => { UI.folderSel = id; UI.folderArch = false; return loadFolderChits(); }, FOLDER.folder_id);
  const view = await page.evaluate(() => (typeof _folderView === 'function' ? _folderView() : ''));
  ok(called(/^GET \/api\/folders\/[^/]+\/chits$/) && view.indexOf(CHIT.manual_subject) >= 0, 'Chits: folderChits is read and the folder view lists "' + CHIT.manual_subject + '"');
  await page.evaluate(() => { UI.folderSel = null; });

  /* Metrics: the track level reads reconcile and draws the measure */
  const metrics = await pane('metrics');
  ok(called(/^GET \/api\/folders\/reconcile$/) && /on this track/i.test(metrics) && /INR/.test(metrics), 'Metrics: folderReconcile is read and the pane draws the count and the INR value');
  await closePane();

  /* Rules: both stand-in rules drawn, then ruleMove up writes the new order */
  const rules = await pane('rules');
  ok(called(/^GET \/api\/folders\/rules$/) && rules.indexOf(RULE.name) >= 0 && rules.indexOf(RULE2.name) >= 0, 'Rules: folderAllRules is read and both rules are drawn');
  S.writes.length = 0;
  await page.evaluate((id) => ruleMove(id, -1), RULE2.rule_id);
  const orderWrites = S.writes.filter((write) => /\/api\/folders\/rules\//.test(write.call)).map((write) => write.call.split('/').pop() + ':' + write.body.sort).sort();
  ok(JSON.stringify(orderWrites) === JSON.stringify([RULE.rule_id + ':1', RULE2.rule_id + ':0'].sort()), 'ruleMove up: the second rule is written sort 0 and the first sort 1 (' + orderWrites.length + ' writes)');
  await closePane();

  /* Group sum */
  const sum = await pane('groupsum');
  ok(called(/^GET \/api\/folders\/groupsum$/) && /3 chits/.test(sum) && /every status/.test(sum), 'Group sum: folderGroupSum is read and the pane draws "3 chits" and the every-status note');
  const money = await page.evaluate(() => ({
    one: _gsMoney([{ currency: 'INR', total: 750 }], false).replace(/<[^>]+>/g, ' '),
    many: _gsMoney([{ currency: 'INR', total: 750 }, { currency: 'USD', total: 2000 }], true).replace(/<[^>]+>/g, ' '),
  }));
  ok(!/not added/i.test(money.one) && /750/.test(money.one) && /not added together/i.test(money.many), '_gsMoney: one currency is quiet, two currencies say they are not added together');
  await closePane();

  /* the move: _doMove posts the chit and the folder */
  S.writes.length = 0;
  await page.evaluate((args) => _doMove(args.chit, args.folder), { chit: CHIT.chit_id, folder: FOLDER.folder_id });
  const move = S.writes.find((write) => write.call === 'POST /api/folders/move');
  ok(move && move.body.chit_id === CHIT.chit_id && move.body.folder_id === FOLDER.folder_id, '_doMove: POST /api/folders/move carries the chit and the folder');

  ok(!threw.some((message) => /is not defined|folder|_FLD|ensureCap/i.test(message)), 'no page error from the folder code' + (threw.length ? ' — ' + threw[0].slice(0, 100) : ''));
  await ctx.close(); await browser.close(); srv.close();
  finish('folders-tabs');
})().catch((error) => { console.error(error); process.exit(1); });
