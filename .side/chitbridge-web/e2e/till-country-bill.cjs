/* till-country-bill.cjs — THE COUNTER'S BILL IN INDIA, AUSTRALIA AND THE UAE (CX1, 2026-10-13; web docs/design/standards/COUNTRY-COVERAGE.md T1 · T2 · T4)
 *
 * The bill follows the SHOP's pack: from A$1,000 an Australian tax invoice names its buyer (reg-au taxInvoice, s.29-70(1)(c)(ii)) — the bill says
 * so on the screen, and a bill saved without one prints as NOT a tax invoice with the reason; the buyer's ABN / TRN prints on the slip; counts are
 * grouped the shop's way; the Language row offers the shop's region's languages. India (reg-in v1.73.0): no buyer warning on the screen; a registered buyer's GSTIN on the paper (CGST Rules r.46(d)).
 * Each shop at 1366 and 390 px, light and dark (rule 13): the new line's text contrast (AA 4.5:1), no clipped text, no page-wide horizontal scroll,
 * no link to app.html in the new row. Run: NODE_PATH=$PWD/e2e/node_modules node e2e/till-country-bill.cjs (exit 1 on any failure)
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const { ratio } = require('./lib/contrast.cjs');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let bad = 0, n = 0;
const say = (l, ok, d) => { n++; console.log(String(l).padEnd(34) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

const SHOPS = [
  { country: 'IN', currency: 'INR', gstin: '33AABCK1234F1Z6', state_code: '33', price: 900, rate: 18, tax_id_word: 'GSTIN' },
  { country: 'AU', currency: 'AUD', gstin: '51824753556', price: 600, rate: 10, tax_id_word: 'ABN' },
  { country: 'AE', currency: 'AED', gstin: '100123456700003', price: 6000, rate: 5, tax_id_word: 'TRN' },
];
const VIEWS = [{ w: 1366, h: 900 }, { w: 390, h: 844 }];
const THEMES = ['light', 'dark'];

const toHex = (rgb) => { const m = String(rgb).match(/\d+/g); return m ? '#' + m.slice(0, 3).map((v) => Number(v).toString(16).padStart(2, '0')).join('') : null; };

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
  const shots = path.join(__dirname, 'out', 'till-country-bill'); fs.mkdirSync(shots, { recursive: true });

  for (const sh of SHOPS) for (const v of VIEWS) for (const theme of THEMES) {
    const tag = sh.country + ' ' + v.w + ' ' + theme;
    const p = await b.newPage({ viewport: { width: v.w, height: v.h } });
    await p.goto('http://127.0.0.1:' + srv.address().port + '/till.html');
    await p.waitForFunction(() => typeof window.screenSet === 'function', null, { timeout: 30000 });
    const r = await p.evaluate(({ sh, theme }) => {
      ls.set('cb_till_theme', theme); applyLook();
      window.S = { shop: { name: 'A shop', currency: sh.currency, country: sh.country, gstin: sh.gstin, state_code: sh.state_code || null, reg_type: 'regular', tax_id_word: sh.tax_id_word /* STD2: the server sends the word (profile.taxIdWordOf) */ },
        items: [{ item_id: 'a', name: 'Espresso machine', code: 'A1', category: 'Kit', unit: 'pc', price: sh.price, tax_slab: 'std' }],
        offers: [], slabs: [{ id: 'std', name: 'Standard', rate: sh.rate }], at: new Date().toISOString(), policy: { price_includes_tax: 'yes' } };
      setMode('sell'); paintChips();
      addItem(S.items[0], 2); price();
      /* a phone shows the bill on its own step — the line is measured where the cashier sees it */
      if (document.body.classList.contains('steps')) stepGo('bill');
      const vis = (e) => !!(e && e.getClientRects().length);
      const warn = document.querySelector('[data-testid="till-warn-buyer"]');
      const span = warn && warn.querySelector('span');
      let bg = null, el = warn;
      while (el && !bg) { const c = getComputedStyle(el).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) bg = c; el = el.parentElement; }
      const out = {
        rule: !!invoiceRule(S.items[0].price * 2, null), seen: vis(warn),
        warn: warn ? warn.innerText.replace(/\s+/g, ' ').trim() : null,
        fg: span ? getComputedStyle(span).color : null, bg: bg || getComputedStyle(document.body).backgroundColor,
        clipped: span ? span.scrollWidth > span.clientWidth + 1 : false,
        appLink: warn ? !!warn.querySelector('a[href*="app.html"]') : false,
        hscroll: document.documentElement.scrollWidth > window.innerWidth + 1,
        count: fmtCount(100000),
        payClipped: (() => { const pb = document.querySelector('[data-testid="till-step-pay"]'); return !!(pb && vis(pb) && pb.scrollWidth > pb.clientWidth + 1); })(),
        rowScheme: ((document.querySelector('.cart .row') || {}).innerText || '').replace(/\s+/g, ' '),
      };
      /* a typed name clears it (the fix the line's button points at) */
      document.getElementById('cname').value = 'Jo Smith'; price();
      out.after = !!document.querySelector('[data-testid="till-warn-buyer"]');
      document.getElementById('cname').value = ''; price();
      /* the paper: a bill saved without a named buyer, and one with the buyer's tax id */
      const total = S.items[0].price * 2, bill = (extra) => Object.assign({ no: 'C1/1', at: new Date().toISOString(), kind: 'tax', lines: [], payments: [], total: total, taxable: total, tax: 0, by_rate: {}, supply: 'domestic', customer: { name: 'Walk-in' } }, extra);
      const slipNo = slipHTML(bill({ not_invoice: invoiceRule(total, null) && invoiceRule(total, null).buyer_identity ? 'buyer_identity' : null }), null);
      out.slipNotInvoice = /BILL — NOT A TAX INVOICE/.test(slipNo) && /data-testid="till-slip-nobuyer"/.test(slipNo);
      out.slipBuyer = /Buyer (ABN|TRN|GSTIN)/.test(slipHTML(bill({ customer: { name: 'Acme', gstin: sh.gstin } }), null));
      openSettings();
      out.langs = Array.from(document.querySelectorAll('#set_lang option')).map((o) => o.value);
      out.lang = document.getElementById('set_lang').value;
      try { document.getElementById('setdlg').close(); } catch (_) {}
      return out;
    }, { sh, theme });
    await p.screenshot({ path: path.join(shots, sh.country + '-' + v.w + '-' + theme + '.png') });

    if (sh.country === 'IN') {
      say(tag + ' buyer GSTIN', !r.warn && r.slipBuyer, 'no buyer warning; the buyer\'s GSTIN on the paper (r.46(d))');
      say(tag + ' counts', r.count === '1,00,000', 'count reads ' + r.count);
      say(tag + ' voice', r.langs.join(',') === 'en-IN,ta-IN,hi-IN,en-GB' && r.lang === 'en-IN', 'the four it always had · ' + r.lang);
    } else if (sh.country === 'AU') {
      say(tag + ' buyer line', /^⚠ Over A\$1,000\.00 a tax invoice names the buyer/.test(r.warn || '') && r.seen, '"' + r.warn + '"' + (r.seen ? ' — on screen' : ' — NOT visible'));
      say(tag + ' cleared by a name', r.after === false, 'gone once the buyer is typed');
      say(tag + ' slip not-invoice', r.slipNotInvoice, 'saved without a buyer: NOT A TAX INVOICE + the reason');
      say(tag + ' slip ABN', r.slipBuyer, 'the buyer\'s ABN on the paper');
      say(tag + ' counts', r.count === '100,000', 'count reads ' + r.count);
      say(tag + ' voice', r.langs.join(',') === 'en-AU' && r.lang === 'en-AU', 'hears ' + r.langs.join(','));
    } else {
      say(tag + ' no buyer line', !r.warn, 'simplified invoice allowed for an unregistered buyer — nothing to say');
      say(tag + ' slip TRN', r.rule && r.slipBuyer, 'the buyer\'s TRN on the paper');
      say(tag + ' counts', r.count === '100,000', 'count reads ' + r.count);
      say(tag + ' voice', r.langs.indexOf('ar-AE') >= 0 && r.lang === 'en-AE', 'hears ' + r.langs.join(',') + ' · ' + r.lang);
    }
    if (r.warn) {
      const cr = ratio(toHex(r.fg), toHex(r.bg));
      say(tag + ' contrast', cr != null && cr >= 4.5, 'the buyer line ' + (cr ? cr.toFixed(2) : '?') + ':1 (' + r.fg + ' on ' + r.bg + ')');
      say(tag + ' not clipped', !r.clipped, 'the line wraps, never cut');
      say(tag + ' no app.html', !r.appLink, 'the row links nowhere else');
      say(tag + ' text budget', r.warn.length <= 80, r.warn.length + ' characters');
    }
    say(tag + ' no h-scroll', !r.hscroll, 'the page fits ' + v.w + ' px');
    say(tag + ' pay fits', !r.payClipped, 'the Pay button shows its whole figure');
    if (r.rowScheme) say(tag + ' row scheme', sh.country === 'AE' ? /VAT 5%/.test(r.rowScheme) && !/GST/.test(r.rowScheme) : /GST/.test(r.rowScheme), 'cart row: ' + (r.rowScheme.match(/(GST|VAT) \d+%/) || ['—'])[0]);
    await p.close();
  }
  await b.close(); srv.close();
  console.log(bad ? '\n' + bad + ' of ' + n + ' failed' : '\nthe bill follows the shop\'s country — ' + n + ' checks');
  process.exit(bad ? 1 : 0);
})();
