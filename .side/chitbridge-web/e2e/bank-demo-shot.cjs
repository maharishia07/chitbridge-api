/* bank-demo-shot.cjs — one picture of the demo loaded with the sample, at 1366x768 and 390x844, and the counts it prints. Output OUT (default e2e/shots). Stand-in only: no api. */
'use strict';
const { chromium } = require('@playwright/test'), http = require('http'), fs = require('fs'), path = require('path');
const PUB = path.join(__dirname, '..', 'public'), OUT = process.env.OUT || 'e2e/shots';
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = http.createServer((q, r) => { const f = path.join(PUB, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html'); if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const b = await chromium.launch();
  for (const [w, h, tag] of [[1366, 768, '1366'], [390, 844, '390']]) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.goto('http://127.0.0.1:' + srv.address().port + '/bank-demo.html');
    await p.evaluate(() => document.getElementById('bd_load').click());
    await p.waitForTimeout(1500);
    console.log(tag + ' count: ' + (await p.locator('#bd_count').innerText()).replace(/\s+/g, ' '));
    console.log(tag + ' payees: ' + (await p.locator('.bd-payee').allInnerTexts()).join(' | '));
    console.log(tag + ' buttons: ' + (await p.locator('button[data-act=newparty]').allInnerTexts()).join(' | '));
    await p.screenshot({ path: path.join(OUT, 'demo-' + tag + '.png') });
    await p.close();
  }
  await b.close(); srv.close();
})();
