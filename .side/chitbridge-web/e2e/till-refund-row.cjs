/* till-refund-row.cjs — ACC-255: A REFUND READS AS A REFUND IN EARLIER BILLS (Athi, 5 Nov: "−₹300.00 Refund")
 *
 * GET /api/till/bills now gives a counter credit note its money (negative total, taxable, tax, refunds[]). The counter's
 * Earlier bills row prints the minus sign, the money and the word Refund, a sale row prints its money as before, and the
 * day check counts a refund apart from the sales ("1 bill · ₹90.00 and 1 refund · −₹300.00") — never one signed sum.
 * Proven on BOTH copies of the screen: the vendored public/till.html, and the api master (CB_API_DIR, when given) served in its place.
 *
 * Run: node e2e/till-refund-row.cjs            (CB_API_DIR=<api checkout> to also drive the master)
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
const MINUS = '\u2212';
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(64) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };
const apiDir = process.env.CB_API_DIR;
const COPIES = [['web public/till.html', null]].concat(apiDir ? [['api master till.html', path.join(apiDir, 'tools', 'tally-connector', 'till.html')]] : []);

const rows = () => [
  { chit_id: '00000000-0000-4000-8000-000000000090', no: 'C1/26-27/0001', at: new Date().toISOString(), customer: 'Walk-in', by: null,
    till: { id: 'C1', name: 'Counter DHW3' }, total: 1000, saved: 0, taxable: 847.46, tax: 152.54, kind: 'cash',
    payments: [{ how: 'cash', amount: 1000 }], invoice: null, lines: [{ name: 'Tea', qty: 2, unit: 'cup', price: 500, net: 1000 }] },
  { chit_id: '00000000-0000-4000-8000-000000000091', no: 'CN/C1/26-27/0001', at: new Date().toISOString(), customer: 'Walk-in', by: null,
    till: { id: 'C1', name: 'Counter DHW3' }, total: -300, saved: null, taxable: -254.24, tax: -45.76, kind: 'credit_note',
    refunds: [{ how: 'cash', amount: 300 }], against: { bill_no: 'C1/26-27/0001' }, reason_words: 'Wrong item', payments: [], invoice: null,
    lines: [{ name: 'Tea', qty: 1, unit: 'cup', price: 300, net: 300 }] },
  { chit_id: '00000000-0000-4000-8000-000000000092', no: 'CN/C1/26-27/0002', at: new Date().toISOString(), customer: 'Walk-in', by: null,
    till: { id: 'C1', name: 'Counter DHW3' }, total: null, saved: null, taxable: null, tax: null, kind: 'credit_note',
    refunds: [], against: null, reason_words: null, payments: [], invoice: null, lines: [] }
];

async function drive(label, masterFile) {
  console.log('\n── ' + label);
  const srv = http.createServer((q, r) => {
    const url = q.url.split('?')[0];
    if (url === '/api/till/bills') { r.writeHead(200, { 'content-type': 'application/json' }); return r.end(JSON.stringify({ days: 2, count: 3, bills: rows() })); }
    if (url.startsWith('/api/')) { r.writeHead(200, { 'content-type': 'application/json' }); return r.end('{"ok":true}'); }
    const f = (masterFile && url === '/till.html') ? masterFile : path.join(ROOT, decodeURIComponent(url).replace(/^\/+/, '') || 'index.html');
    if ((!masterFile || url !== '/till.html') && !f.startsWith(ROOT)) { r.writeHead(404); return r.end('no'); }
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch();
  try {
    const p = await (await b.newContext({ viewport: { width: 1280, height: 880 } })).newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
    await p.goto(base + '/till.html');
    await p.waitForFunction(() => typeof window.screenSet === 'function', null, { timeout: 30000 });
    await p.evaluate((api) => {
      CloudHost.key = 'demo-key'; CloudHost.api = api; HOST = CloudHost;
      ls.set(tillGivenKey(), 'C1');
      WHO = { id: 'w1', name: 'Bala', kind: 'coassist', since: new Date().toISOString() };
      window.S = { shop: { country: 'IN', name: 'Mayur Bhavan', currency: 'INR', pay: [{ id: 'cash', label: 'Cash' }] }, at: new Date().toISOString(), items: [], offers: [] };
    }, base);
    await p.evaluate(() => paintEarlier());
    await p.waitForSelector('[data-testid="till-old-amount-CN/C1/26-27/0001"]', { timeout: 15000 });
    const text = (id) => p.evaluate((t) => { var e = document.querySelector('[data-testid="' + t + '"]'); return e ? e.innerText.replace(/\s+/g, ' ').trim() : null; }, id);
    const refund = await text('till-old-amount-CN/C1/26-27/0001'), sale = await text('till-old-amount-C1/26-27/0001'), old = await text('till-old-amount-CN/C1/26-27/0002');
    say('a refund row reads "−₹300.00 Refund" (minus sign, money, the word)', /^\u2212₹\s?300\.00 Refund$/.test(refund || ''), JSON.stringify(refund));
    say('…and never a hyphen-minus', refund && refund.indexOf('-') < 0, 'checked');
    say('a sale row reads its money, unchanged', /^₹\s?1,000\.00$/.test(sale || ''), JSON.stringify(sale));
    say('an old note with no total reads the bare word Refund, never ₹0.00', old === 'Refund', JSON.stringify(old));
    const head = await text('till-earlier-head');
    say('the header total dropped by the refund (₹700.00)', /₹\s?700\.00/.test(head || ''), head);
    const side = await p.evaluate(() => dayCheckSide([{}, {}], 1000, 1, -300));
    say('the day check counts a refund apart: "1 bill · ₹1,000.00 and 1 refund · −₹300.00"', /^1 bill · ₹\s?1,000\.00 and 1 refund · \u2212₹\s?300\.00$/.test(side), side);
    const onlyBack = await p.evaluate(() => dayCheckSide([{}], 0, 1, -300));
    say('a refund alone is not called a bill', /^1 refund · \u2212₹\s?300\.00$/.test(onlyBack), onlyBack);
    const oldDay = await p.evaluate(async () => {
      var keep = HOST; HOST = { history: async function(){ return { bills: [{ no: 'CN/OLD/1', at: new Date().toISOString(), kind: 'credit_note', total: null }] }; }, cred: function(){ return true; } };
      try { var chk = await dayServerCheck([]); return { back: chk.moreBackTotal, words: dayCheckSide(chk.more, chk.moreTotal, chk.moreBack, chk.moreBackTotal) }; } finally { HOST = keep; }
    });
    say('the day check with an old note that has no amount says "1 refund", never −₹0.00', oldDay.back === null && oldDay.words === '1 refund', JSON.stringify(oldDay));
    say('no page error', errs.length === 0, errs.join(' | ') || 'none');
  } finally { await b.close(); srv.close(); }
}

(async () => {
  for (const [label, file] of COPIES) await drive(label, file);
  console.log(bad ? '\n' + bad + ' FAILED' : '\nall OK');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
