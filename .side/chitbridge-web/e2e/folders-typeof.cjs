/* folders-typeof.cjs (MNT-59, pin leg ii) — every one of the 48 Folders names resolves on the three pages that carry the cap-folders script tag.
 * OWNS      `typeof` of each name on accounts.html, crm.html and finance.html (function, or object for the two tables), service worker allowed;
 *           on accounts.html also _foldersFrom and loadFolderChits against the stand-in replies (the two names that page really calls).
 * CALLED BY e2e/run-shard.cjs (EXTRA, browser harnesses) · the move-only PR of the folders split.
 * FLOW      serve public/ ──▶ open each page signed in ──▶ typeof every name ──▶ accounts: call the two names ──▶ assert.
 * RED when a script tag of the family is missing on a page (a name then reads 'undefined'), reachable from that page or not. */
'use strict';
const { chromium } = require('@playwright/test');
const { server, signedContext, counters, names, FOLDER, CHIT } = require('./folders-pin-lib.cjs');
const { ok, finish } = counters();
const TABLES = new Set(['_FLD', '_RULE_HELP']);

(async () => {
  const srv = await server(), browser = await chromium.launch(), S = { calls: [], writes: [] };
  const ctx = await signedContext(browser, S, 'allow');
  for (const page of ['accounts.html', 'crm.html', 'finance.html']) {
    const tab = await ctx.newPage(), threw = [];
    tab.on('pageerror', (error) => threw.push(error.message));
    await tab.goto(srv.base + '/' + page, { waitUntil: 'load' });
    await tab.waitForTimeout(800);
    const types = await tab.evaluate((list) => Object.fromEntries(list.map((name) => [name, typeof window[name]])), names());
    const wrong = names().filter((name) => types[name] !== (TABLES.has(name) ? 'object' : 'function'));
    ok(wrong.length === 0, page + ': all ' + names().length + ' names resolve' + (wrong.length ? ' — missing or wrong: ' + wrong.join(', ') : ''));
    if (page === 'accounts.html') {
      const split = await tab.evaluate(() => { const out = _foldersFrom({ folders: [{ folder_id: 'f1', name: 'Urgent', kind: 'filed', scope: 'task' }, { folder_id: 's1', name: 'Bills', kind: 'view', system: true }] }); return JSON.stringify(out); });
      ok(/Urgent/.test(split), 'accounts.html: _foldersFrom splits the folder reply (' + split.slice(0, 60) + ')');
      await tab.evaluate((id) => { UI.folderSel = id; UI.folderArch = false; return loadFolderChits(); }, FOLDER.folder_id);
      const drawn = await tab.evaluate(() => JSON.stringify(UI.folderChits));
      ok(S.calls.some((call) => /^GET \/api\/folders\/[^/]+\/chits$/.test(call)) && drawn.indexOf(CHIT.chit_id) >= 0, 'accounts.html: loadFolderChits reads the folder\'s chits and keeps the reply');
    }
    ok(!threw.some((message) => /is not defined|folder/i.test(message)), page + ': no ReferenceError from the folder code' + (threw.length ? ' (' + threw[0].slice(0, 80) + ')' : ''));
    await tab.close();
  }
  await ctx.close(); await browser.close(); srv.close();
  finish('folders-typeof');
})().catch((error) => { console.error(error); process.exit(1); });
