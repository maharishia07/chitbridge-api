/* offer-lab-next-import.cjs — FEEL THE PURPOSE WITH YOUR OWN NUMBERS
 *
 * Athi: "can we use a excel sheet as an input file to create the data in the browser and analyse the offer
 * engine, so we can release it public domain if required to use it, and feel the purpose... possibly excel,
 * tally connector we have to bring it here." SheetJS (vendor/xlsx.full.min.js, served from this origin, never
 * a CDN) reads a real spreadsheet client-side; nothing it reads is ever sent anywhere. This proves a real
 * upload replaces the sample books, loose header names are matched (not column position), a missing cost
 * reads as unknown rather than zero, and the reverse direction — exporting what's on screen — produces a
 * real, re-readable CSV.
 *
 * Run: node e2e/offer-lab-next-import.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(48) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

(async () => {
  const srv = http.createServer((q, r) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'text/plain' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((res) => srv.listen(0, res));
  const b = await chromium.launch();
  const p = await b.newPage({ acceptDownloads: true });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto('http://127.0.0.1:' + srv.address().port + '/offer-lab-next.html');
  await p.waitForTimeout(200);

  console.log('\n── a real CSV, loose header names, one row with no cost ' + '─'.repeat(9));
  const csvPath = path.join(require('os').tmpdir(), 'my-shop-' + Date.now() + '.csv');
  fs.writeFileSync(csvPath,
    'Product Name,Section,Rate,Purchase Price\r\n' +
    'Hand Soap,Toiletries,45,28\r\n' +
    'Notebook,Stationery,60,\r\n' +      /* no cost — must read as unknown, never 0 */
    'Pencil,Stationery,10,4\r\n');
  await p.setInputFiles('#labImportFile', csvPath);
  await p.waitForTimeout(300);
  const imported = await p.evaluate(() => ({
    biz: S.biz, name: BIZ[S.biz].name, count: P.length,
    soap: P.filter((x) => x.name === 'Hand Soap')[0],
    notebook: P.filter((x) => x.name === 'Notebook')[0],
    toast: (document.getElementById('labtoast') || {}).textContent,
  }));
  say('switches to the uploaded book, replacing the samples', imported.biz === 'imported', 'S.biz is "' + imported.biz + '"');
  say('all three rows read', imported.count === 3, imported.count + ' items');
  say('loosely-named headers matched ("Rate" → price, "Purchase Price" → cost)',
      imported.soap && imported.soap.price === 45 && imported.soap.cost === 28, JSON.stringify(imported.soap));
  say('⚠️ a blank cost cell reads as unknown, never zero', imported.notebook && imported.notebook.cost === null,
      'Notebook cost is ' + (imported.notebook && imported.notebook.cost));
  say('says plainly that nothing was saved anywhere', /nothing was saved/.test(imported.toast || ''), '"' + imported.toast + '"');
  fs.unlinkSync(csvPath);

  console.log('\n── the imported book works like any other — real engine, real margin ' + '─'.repeat(2));
  const worked = await p.evaluate(() => {
    pickGoal('percent'); S.scope = 'item'; S.itemId = P.filter((x) => x.name === 'Pencil')[0].id; S.itemIds = [S.itemId]; S.pctOff = 10; apply();
    /* ⚠️ MOVED, NOT DELETED (2026-09-28). Since 2026-09-26 the per-offer loyalty switch follows the shop-wide one
       (S.loyOn = S.custOn, on by default), so CBOffers.compound(offer, loyalty) is the LOYALTY price — ₹10 → ₹9 → ₹8.10,
       rounded down to ₹8, margin (8−4)/8 = 50%, which is right. The ₹9 / ~56% this case always meant is the PUBLIC
       price, priceRow(p, offerFrac(p)). Both are asserted now, each against its own formula. */
    var pub = priceRow(byId(S.itemId), offerFrac(byId(S.itemId)));
    var loy = priceRow(byId(S.itemId), CBOffers.compound([offerFrac(byId(S.itemId))*100, loyFrac()*100])/100);
    return { shown: pub.shown, margin: pub.margin, loyOn: S.loyOn, loyShown: loy.shown, loyMargin: loy.margin,
             loyExpect: S.loyOn ? Math.round(((loy.shown - 4) / loy.shown) * 100) : null };
  });
  say('10% off pencil (₹10, cost ₹4) → ₹9, margin ~56% (the public price)', worked.shown === 9 && worked.margin >= 55 && worked.margin <= 56,
      JSON.stringify({ shown: worked.shown, margin: worked.margin }));
  say('and the loyalty price stacks on it, margin taken on what that customer pays', !worked.loyOn
      || (worked.loyShown < worked.shown && worked.loyMargin === worked.loyExpect),
      JSON.stringify({ loyOn: worked.loyOn, shown: worked.loyShown, margin: worked.loyMargin }));

  console.log('\n── a file with no readable name column is refused, not silently emptied ' + '─'.repeat(1));
  const badPath = path.join(require('os').tmpdir(), 'bad-' + Date.now() + '.csv');
  fs.writeFileSync(badPath, 'Widget,Colour\r\nfoo,red\r\n');
  await p.setInputFiles('#labImportFile', badPath);
  await p.waitForTimeout(300);
  const bad2 = await p.evaluate(() => ({ biz: S.biz, toast: (document.getElementById('labtoast') || {}).textContent }));
  say('stays on the last good book rather than importing nothing useful', bad2.biz === 'imported', 'S.biz is still "' + bad2.biz + '"');
  say('and says why', /column/i.test(bad2.toast || ''), '"' + bad2.toast + '"');
  fs.unlinkSync(badPath);

  console.log('\n── export: what is on screen, as a real, re-readable CSV ' + '─'.repeat(7));
  const [download] = await Promise.all([p.waitForEvent('download'), p.evaluate(() => exportCsv())]);   /* ⚠️ MOVED 2026-09-28: the chip is relabelled 'Export' and sits in a tool strip not visible in this state — the export itself is what is under test */
  const savedPath = await download.path();
  const csvOut = fs.readFileSync(savedPath, 'utf8');
  say('a file actually downloaded', !!savedPath, download.suggestedFilename());
  say('with a header row and all three items', /Item,Category,Price,Cost/.test(csvOut) && csvOut.split('\n').length >= 4,
      csvOut.split('\r\n')[0]);
  say('the no-cost row exports as truly blank, not "0" or "null"', /Notebook,Stationery,60,\r?\n/.test(csvOut), 'Notebook row has an empty Cost field');

  console.log('\nconsole/page errors:', errs.length ? errs.join(' | ') : 'none');
  await b.close(); srv.close();
  console.log(bad || errs.length ? '\n' + (bad + errs.length) + ' failed'
    : '\na real spreadsheet in, a real CSV out, nothing ever saved anywhere in between');
  process.exit(bad || errs.length ? 1 : 0);
})();
