/* a look at the counter-health page, served the way every other counter harness serves it */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
(async () => {
  const srv = http.createServer((q, r) => {
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const f = path.join(ROOT, rel);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, r));
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await p.goto('http://127.0.0.1:' + srv.address().port + '/till.html');
  await p.waitForFunction(() => typeof window.paintHealth === 'function', null, { timeout: 30000 });
  await p.waitForTimeout(1500);
  console.log('CBVerdict loaded : ' + await p.evaluate(() => !!(window.CBVerdict && window.CBVerdict.read)));
  await p.evaluate(() => {
    window.CloudHost.key = 'x.y.z';
    window.S = Object.assign({}, window.S || {}, { items: [{}], shop: { name: 'Mayur Bhavan' } });
    window.STATE = Object.assign({}, window.STATE, { online: false, paired: true, queued: 0,
      shop: { name: 'Mayur Bhavan', bridge_id: 'CBMAYUR01', scopes: ['till'] },
      queue_why: null, till: { id: 'C1' } });
  });
  await p.evaluate(() => window.openHealth());
  await p.waitForTimeout(1000);
  console.log('verdict : ' + await p.locator('[data-testid="till-health-verdict"] .hvl').innerText().catch(() => '(none)'));
  console.log('why     : ' + (await p.locator('[data-testid="till-health-verdict"] .hvw').innerText().catch(() => '')).slice(0, 160));
  console.log('fix     : ' + await p.locator('[data-testid="till-health-fix"]').innerText().catch(() => '(none)'));
  console.log('waiting : ' + (await p.locator('.hbox').first().innerText().catch(() => '')).replace(/s+/g,' ').slice(0,150));
  console.log('lasttry : ' + (await p.locator('.hbox').nth(1).innerText().catch(() => '')).replace(/s+/g,' ').slice(0,130));
  console.log('code    : ' + await p.locator('[data-testid="till-health-code"]').innerText().catch(() => ''));
  await p.screenshot({ path: 'C:/dev/chitbridge-web/png/Health.png' });
  await b.close(); await new Promise((r) => srv.close(r));
})();
