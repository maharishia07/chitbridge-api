/* till-settings-declutter.cjs — QUICK KEYS AND THE SHOP LEAVE SETTINGS AS ONE LINE EACH, AND "CLEAR AND
 * RELOAD" LEAVES SETTINGS ENTIRELY (design-handoff/04-settings §3 row-table, 00-CORRECTIONS.md #18,
 * acceptance checks §10.7/§10.8, Phase 4.5)
 *
 * ⚠️⚠️⚠️ THE RISK NAMED IN THE PACKAGE ITSELF: "Each new home must exist first." Both homes already existed
 * before this — Counter health's "Repair this counter" (Phase 4.4) and the group/source/hidden-keys controls
 * themselves (2026-09-18) — so this only proves Settings stopped being a second, editable copy of either.
 *
 * Run: node e2e/till-settings-declutter.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(52) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

(async () => {
  const srv = http.createServer((q, r) => {
    const url = q.url.split('?')[0];
    if (url.startsWith('/api/')) { r.writeHead(200, { 'content-type': 'application/json' }); return r.end('{"ok":true}'); }
    const f = path.join(ROOT, decodeURIComponent(url).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((res) => srv.listen(0, res));
  const b = await chromium.launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto('http://127.0.0.1:' + srv.address().port + '/till.html');
  await p.waitForFunction(() => typeof window.screenSet === 'function', null, { timeout: 30000 });

  await p.evaluate(async () => {
    ls.set(tillGivenKey(), 'C1');
    window.S = { shop: { country: 'IN', name: 'Mayur Bhavan', currency: 'INR' }, at: new Date().toISOString(),
      items: [
        { item_id: 'i1', name: 'Masala Dosa', price: 70, unit: 'plate', category: 'Tiffin' },
        { item_id: 'i2', name: 'Filter Coffee', price: 25, unit: 'cup', category: 'Drinks' },
      ] };
    setMode('sell');
    await loadQuick();
  });

  console.log('\n── ⭐⭐⭐ the shop’s tax block is ONE LINE, not a mini table ' + '─'.repeat(6));
  const shop = await p.evaluate(() => {
    openSettings();
    var html = document.getElementById('shopbox').innerHTML;
    var out = {
      hasGstin: /GSTIN/.test(html),
      hasNotRegistered: /Not registered/.test(html),
      hasFactRows: /class="f"/.test(html),
      hasEdit: !!document.querySelector('[data-testid="till-shop-edit"]'),
      hasHubLink: !!document.querySelector('[data-testid="till-shop-openhub"]'),
    };
    document.getElementById('setdlg').close();
    return out;
  });
  say('says the shop is unregistered (no GSTIN set up)', shop.hasNotRegistered, 'true');
  say('no four-row mini table (class="f") survives', !shop.hasFactRows, 'gone');
  say('still carries "Change these"', shop.hasEdit, 'true');
  say('still links out to the hub’s fuller read-out', shop.hasHubLink, 'true');

  console.log('\n── ⭐⭐⭐ Quick keys is ONE LINE and a link in Settings, not the picker itself ' + '─'.repeat(0));
  const before = await p.evaluate(() => {
    openSettings('keys');
    return {
      hasSummary: !!document.querySelector('[data-testid="till-quicksum"]'),
      hasGroupPicker: !!document.querySelector('[data-testid="till-set-group-new"]'),
      summaryText: (document.getElementById('quicksum') || {}).innerText || '',
    };
  });
  say('Settings shows the one-line summary', before.hasSummary, 'true');
  say('Settings itself never edits a group again (no ＋ New in Settings)', !before.hasGroupPicker, 'absent');
  say('the line names what is in force', /What sells now/i.test(before.summaryText), '"' + before.summaryText.trim() + '"');

  console.log('\n── Edit ↗ opens the real maintenance dialog, and it actually fills a group ' + '─'.repeat(0));
  const maint = await p.evaluate(async () => {
    document.querySelector('[data-testid="till-quickmaint-open"]').click();
    var d = document.getElementById('quickmaintdlg');
    var opened = !!(d && d.open);
    tillOptSet({ groups: { Morning: [] }, group: 'Morning' });
    quickMaintPaint();
    var tick = document.querySelector('[data-testid="till-set-group-items"] input[type="checkbox"]');
    var found = !!tick;
    if (tick) { tick.checked = true; tick.dispatchEvent(new Event('change')); }
    return { opened, found, groupSize: (tillOpt().groups.Morning || []).length };
  });
  say('the dialog actually opened', maint.opened, 'true');
  say('the tick-list is real, not a stub', maint.found, 'found a checkbox');
  say('ticking a product filled the group', maint.groupSize === 1, maint.groupSize + ' item(s) in Morning');

  console.log('\n── ⭐⭐ Settings’ one line is a VIEW of the same state — it updates live, behind the dialog ' + '─'.repeat(0));
  const live = await p.evaluate(() => {
    quickMaintClose();
    return (document.getElementById('quicksum') || {}).innerText || '';
  });
  say('the summary now names the group and its count', /Morning \(1\)/.test(live), '"' + live.trim() + '"');

  console.log('\n── ⭐⭐⭐ "Clear and reload" does not appear in Settings anywhere (acceptance check §10.8) ' + '─'.repeat(0));
  const gone = await p.evaluate(() => {
    /* ⚠️ innerText, not innerHTML — a shopkeeper reads what renders, not the comments that explain why it doesn't */
    var text = document.getElementById('setdlg').innerText;
    document.getElementById('setdlg').close();
    return { text: /Clear and reload/i.test(text), hasColdbox: !!document.getElementById('coldbox'),
             hasColdBtn: !!document.querySelector('[data-testid="till-coldstart"]') };
  });
  say('the words "Clear and reload" are gone from Settings', !gone.text, 'absent');
  say('the #coldbox row is gone', !gone.hasColdbox, 'absent');
  say('and so is its button', !gone.hasColdBtn, 'absent');

  console.log('\n── ⭐ the hub menu’s own copy now goes through the live-figures sheet, not its own bare confirm ' + '─'.repeat(0));
  const menu = await p.evaluate(async () => {
    STATE = Object.assign({}, STATE || {}, { queued: 0 });
    coldStartFromMenu();
    await new Promise((r) => setTimeout(r, 50));
    var d = document.getElementById('suredlg');
    var open = !!(d && d.open);
    var title = open ? document.getElementById('surebody').innerText : '';
    if (open) sureClose();
    return { open, title };
  });
  say('"Repair this counter" from the hub opens the same sheet Counter health uses', menu.open, 'the sheet opened');

  console.log('\nconsole/page errors:', errs.length ? errs.join(' | ') : 'none');
  await b.close(); srv.close();
  console.log(bad || errs.length ? '\n' + (bad + errs.length) + ' failed'
    : '\nQuick keys and the shop are one line each in Settings, and Clear and reload has left it entirely');
  process.exit(bad || errs.length ? 1 : 0);
})();
