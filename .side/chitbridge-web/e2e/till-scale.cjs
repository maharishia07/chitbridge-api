/* till-scale.cjs — A VEGETABLE SHOP'S WEIGHING SCALE ([TILL-185])
 *
 * The grocery baseline the backlog carried as a red blocker: *"Weighing scale + price-embedded barcodes
 * (EAN-13 carrying weight/price)… Produce and deli need it."*
 *
 * ── ⚠️⚠️⚠️ WHAT THIS HARNESS IS FOR, BEYOND THE HAPPY PATH ──────────────────────────────────────────────
 *
 * The decoding is proved without a browser in tests/scalecode.test.js. What can only be proved HERE is that
 * the counter does the right thing with the answer — and in particular the two cases the old page-side reader
 * got wrong by returning null: a damaged label and an item code the catalogue has never heard of. Both fell
 * through to the ordinary product search and said nothing at all, which on a produce counter means the wrong
 * vegetable at the wrong weight on a bill somebody pays.
 *
 * Run: node e2e/till-scale.cjs [--shots]
 *
 * ⚠️⚠️ NO FIXED SLEEPS (K2b, TEST-LOG W2-1). Every wait below is on a CONDITION: the page's boot (TILL_BOOT) before seeding,
 * then each step's own effect — the line on the bill and its total on screen, the words in #lastnote, the control's effect.
 * Two traps this file has walked into: the boot load() landing AFTER the seed (it re-reads the key, so the counter un-pairs),
 * and add()/addWeighed() being ASYNC — reading CART on the same tick reads an empty bill (web #160, 5/5 red).
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const SC = require('../../chitbridge-api/lib/scalecode');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
let bad = 0;
/** ⭐ wait for a condition in the page, never a clock — true/false; the check that follows says what was actually seen */
const until = (p, fn, arg, ms) => p.waitForFunction(fn, arg, { timeout: ms || 10000, polling: 50 }).then(() => true, () => false);
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(46) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

/** ⭐ a real label, built with the engine's own check digit — never a constant typed by hand */
function label(mask, item, value) {
  let body = '', i = 0, w = 0;
  const nI = (mask.match(/I/g) || []).length, nV = (mask.match(/[WP]/g) || []).length;
  const it = String(item).padStart(nI, '0'), vl = String(value).padStart(nV, '0');
  for (let k = 0; k < mask.length - 1; k++) {
    const c = mask[k];
    if (/[0-9]/.test(c)) body += c;
    else if (c === 'I') body += it[i++];
    else if (c === 'W' || c === 'P') body += vl[w++];
    else body += '0';
  }
  return body + String(SC.checkDigit(body));
}

(async () => {
  const srv = http.createServer((q, r) => {
    const url = q.url.split('?')[0];
    if (url.startsWith('/api/')) { r.writeHead(200, { 'content-type': 'application/json' }); return r.end('{"ok":true}'); }
    const f = path.join(ROOT, decodeURIComponent(url).replace(/^\/+/, '') || 'till.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  p.on('pageerror', (e) => { console.log('    PAGE ERROR: ' + e.message); bad++; });
  await p.goto(base + '/till.html');
  await p.waitForFunction(() => typeof window.setMode === 'function', null, { timeout: 30000 });
  /* ⚠️⚠️ THE PAGE'S OWN BOOT FIRST. load() awaits pickHost() — which sets CloudHost.key from storage (none here) — and then
     replaces S; landing after the seed below, it un-pairs the counter or empties the shelf. TILL_BOOT is that boot, named
     in the till master (K2b): await it to the end, then seed. */
  await p.waitForFunction(() => typeof TILL_BOOT === 'object', null, { timeout: 30000 });
  await p.evaluate(() => TILL_BOOT.then(() => true, () => true));

  /* a produce counter: tomatoes sold by the kilo, with the scale's own item code on them */
  await p.evaluate(() => {
    ls.set(tillGivenKey(), 'C1');
    /* ⚠️ A PAIRED COUNTER, or add() stops at needShop() and the cart stays empty with nothing said —
       which is correct behaviour and would have made every check below fail for the wrong reason. */
    CloudHost.key = 'test-key'; HOST = CloudHost;
    WHO = { id: 'w1', name: 'Bala', kind: 'coassist', since: new Date().toISOString(), float: 0 };
    window.S = { shop: { country: 'IN', name: 'Anand Vegetables', currency: 'INR' }, at: new Date().toISOString(),
      items: [{ item_id: 'v1', name: 'Tomato', code: '42', price: 40, unit: 'kg' },
              { item_id: 'v2', name: 'Onion',  code: '43', price: 30, unit: 'kg' },
              { item_id: 'p1', name: 'Soap',   barcode: '8901234567894', price: 25, unit: 'piece' }] };
    setMode('sell');
  });

  console.log('\n══ the engine is on the page ' + '═'.repeat(42));
  say('CBScaleCode is loaded', await p.evaluate(() => !!window.CBScaleCode), 'window.CBScaleCode');
  say('and the page holds no layout of its own',
      await p.evaluate(() => /CBScaleCode|SCALE\(\)/.test(String(window.weighRead))),
      'weighRead() asks the engine');

  /* ══ ⚠️⚠️ A SHOP WITH NO SCALE MUST NOTICE NOTHING ═══════════════════════════════════════════════════ */
  console.log('\n── a shop with no scale ' + '─'.repeat(47));
  const off = await p.evaluate(async (code) => {
    tillOptSet({ weigh: { on: false } });
    document.getElementById('q').value = code;
    searchTyped();      /* ⚠️ scale off → not a label → no exact code → scanned() answers false on this tick; nothing to wait for */
    return { cart: CART.length, still: document.getElementById('q').value.length > 0 };
  }, label('21IIIIIWWWWWC', 42, 750));
  say('⚠️⚠️ a scale label is just an unknown barcode', off.cart === 0, 'nothing was added or claimed');

  /* ══ WEIGHT IN THE LABEL ════════════════════════════════════════════════════════════════════════════ */
  console.log('\n── 750 g of tomatoes, weighed and scanned ' + '─'.repeat(29));
  await p.evaluate((code) => {
    tillOptSet({ weigh: { on: true, preset: 'weight_13', mask: '' } });
    CART.length = 0; price();
    document.getElementById('q').value = code;
    searchTyped();
  }, label('21IIIIIWWWWWC', 42, 750));
  /* ⭐ the line on the bill AND its money on screen — addWeighed() is async, and price() follows it (K2b, till master) */
  const shown30 = await until(p, () => CART.length === 1 && /Tomato/.test(document.getElementById('cart').innerText)
    && document.getElementById('totals').innerText.indexOf(money(30)) >= 0);
  const weighed = await p.evaluate(() => {
    const l = CART[0] || {};
    return { n: CART.length, name: l.name, qty: l.qty, unit: l.unit, box: document.getElementById('q').value,
             total: (document.getElementById('totals').innerText.match(/TOTAL\s*(\S+)/) || [])[1] || '' };
  });
  say('the tomatoes are on the bill', weighed.n === 1 && weighed.name === 'Tomato', weighed.name || 'nothing');
  /** ⭐ THE LABEL SAYS GRAMS AND THE SHOP SELLS BY THE KILO — the counter converts, it does not bill 750 kg */
  say('⭐ 750 g became 0.75 kg', weighed.qty === 0.75 && weighed.unit === 'kg',
      weighed.qty + ' ' + weighed.unit);
  say('⭐ and the screen shows it — the line and ₹30 total', shown30, 'TOTAL ' + (weighed.total || 'nothing'));
  say('and the box is cleared for the next one', !weighed.box, 'ready to scan again');

  /* ══ ⚠️⚠️⚠️ THE TWO THAT USED TO FAIL IN SILENCE ════════════════════════════════════════════════════ */
  console.log('\n── a label that did not scan cleanly ' + '─'.repeat(34));
  const damaged = {};
  await p.evaluate((good) => {
    const bad2 = good.slice(0, -1) + String((Number(good[good.length - 1]) + 1) % 10);
    CART.length = 0; document.getElementById('lastnote').textContent = '';
    document.getElementById('q').value = bad2;
    searchTyped();
  }, label('21IIIIIWWWWWC', 42, 750));
  /* ⚠️ toastLine() writes #lastnote — the first draft looked for a .toast that does not exist, so every
     message check would have passed as "nothing said" whatever the counter actually said. */
  await until(p, () => /did not scan cleanly|Weigh it again/.test(document.getElementById('lastnote').textContent));
  Object.assign(damaged, await p.evaluate(() => ({ cart: CART.length, said: document.getElementById('lastnote').textContent })));
  say('⚠️⚠️⚠️ nothing is sold on a damaged label', damaged.cart === 0, 'the cart is untouched');
  say('and the person is TOLD', /did not scan cleanly|Weigh it again/.test(damaged.said),
      damaged.said ? ('"' + damaged.said.trim() + '"') : 'NOTHING WAS SAID');

  console.log('\n── an item code the shop has never heard of ' + '─'.repeat(27));
  await p.evaluate((code) => {
    CART.length = 0; document.getElementById('lastnote').textContent = '';
    document.getElementById('q').value = code;
    searchTyped();
  }, label('21IIIIIWWWWWC', 99, 500));
  await until(p, () => /code 99/.test(document.getElementById('lastnote').textContent));
  const unknown = await p.evaluate(() => ({ cart: CART.length, said: document.getElementById('lastnote').textContent }));
  say('⚠️⚠️ nothing is sold', unknown.cart === 0, 'the cart is untouched');
  say('and it names the code to go and fix', /code 99/.test(unknown.said),
      unknown.said ? ('"' + unknown.said.trim() + '"') : 'NOTHING WAS SAID');

  /* ══ AN ORDINARY BARCODE STILL WORKS, which is a thousand scans a day ════════════════════════════════ */
  console.log('\n── and the soap still scans ' + '─'.repeat(43));
  await p.evaluate(() => {
    CART.length = 0;
    document.getElementById('q').value = '8901234567894';
    searchTyped();
  });
  await until(p, () => CART.length === 1);          /* add() is async — it awaits modOpen() */
  const soap = await p.evaluate(() => ({ n: CART.length, name: (CART[0] || {}).name, qty: (CART[0] || {}).qty }));
  say('an ordinary product is unaffected', soap.n === 1 && soap.name === 'Soap', soap.name + ' × ' + soap.qty);

  /* ══ PRICE IN THE LABEL — the deli case ═════════════════════════════════════════════════════════════ */
  console.log('\n── a label that carries the price ' + '─'.repeat(37));
  await p.evaluate((code) => {
    tillOptSet({ weigh: { on: true, preset: 'price_13', mask: '' } });
    CART.length = 0; price();
    document.getElementById('q').value = code;
    searchTyped();
  }, label('22IIIIIPPPPPC', 42, 4500));   /* ₹45.00 of tomatoes at ₹40/kg */
  /* ⭐ the line's money, priced by the counter itself — no price() from here any more */
  await until(p, () => CART.length === 1 && CART[0].net != null
    && document.getElementById('totals').innerText.indexOf(money(45)) >= 0);
  const priced = await p.evaluate(() => {
    const l = CART[0] || {};
    return { n: CART.length, name: l.name, qty: l.qty, price: l.price, net: l.net };
  });
  say('the money is the label\'s', priced.n === 1 && Math.abs(priced.net - 45) < 0.01,
      '₹' + priced.net + ' on the bill');
  /**
   * ⚠️⚠️ THE SCALE ALREADY MULTIPLIED. Charging rate × qty again would bill ₹45 of tomatoes twice over, so
   * the LINE'S MONEY is the label's and the quantity is only DESCRIBED from it.
   * ⚠️ It is rounded to two places like every other quantity here, so 45/40 shows as 1.13 kg and not 1.125 —
   * qty × rate therefore does not equal the net on this line, which is correct and is why the check above
   * reads the NET. The label is the truth; the quantity is a description of it.
   */
  say('⚠️⚠️ and it was not multiplied twice', Math.abs(priced.qty - 1.13) < 0.001,
      priced.qty + ' kg described from ₹45 at ₹40/kg');

  /* ══ THE SETTING, DRIVEN THROUGH ITS OWN CONTROL ════════════════════════════════════════════════════ */
  console.log('\n── setting it up, with a worked example ' + '─'.repeat(31));
  /* ⚠️ setTab() is gone (design-handoff/04-settings, Phase 2.5) — Settings is one scrolling list now, so
     #set_weigh and its neighbours are already in the document with no tab to switch to first. */
  await p.evaluate(() => { document.getElementById('setdlg').showModal(); paintSetup(); });
  await p.waitForSelector('#set_weigh', { state: 'visible' });
  await p.selectOption('#set_weigh', 'weight_13');
  await until(p, () => /reads as item/.test((document.getElementById('set_weighex') || {}).innerText || ''));
  const shown = await p.evaluate(() => ({
    ex: (document.getElementById('set_weighex') || {}).innerText || '',
    maskRow: (document.getElementById('row_weighmask') || {}).hidden,
  }));
  say('⭐ it shows what a label would read as', /reads as item/.test(shown.ex), '"' + shown.ex + '"');
  say('and the pattern box stays out of the way', shown.maskRow === true, 'hidden until "Something else"');

  await p.selectOption('#set_weigh', 'custom');
  await until(p, () => document.getElementById('row_weighmask').hidden === false);
  say('until a shop says its scale is different',
      await p.evaluate(() => document.getElementById('row_weighmask').hidden === false), 'the box appears');
  /** ⚠️ and a pattern that cannot work is refused where it is typed, not at a till three weeks later */
  await p.evaluate(() => {
    document.getElementById('lastnote').textContent = '';
    document.getElementById('set_weighmask').value = 'IIIIIWWWWWC';
    document.getElementById('set_weighmask').dispatchEvent(new Event('change'));
  });
  await until(p, () => /digits your scale always prints/.test(document.getElementById('lastnote').textContent));
  const refused = await p.evaluate(() => document.getElementById('lastnote').textContent);
  say('⚠️ a pattern with no prefix is refused there and then',
      /digits your scale always prints/.test(refused), '"' + refused.trim() + '"');

  /**
   * ── ⭐⭐⭐ AND THE STARTER CATALOGUE CAN ACTUALLY BE WEIGHED (2026-09-27) ──────────────────────────────
   *
   * Athi: *"how this item are connected to the scale?"* — asked while switching a test shop onto the veg
   * blueprint, and the honest answer at that moment was "it isn't". veg mints `code: 'V0001'`; a scale label
   * carries digits only and there is nowhere in a barcode to put the 'V', so weighRead() looked for "1",
   * found nothing, and refused EVERY label on the trade most likely to own a scale.
   *
   * ⭐ veg@2 now also carries a numeric PLU in `barcode` (catalogue-blueprint.withScalePlu), which is the
   * handle weighRead() already looked for. This asserts the join in both directions, because the failure it
   * replaces was invisible from either side alone: the label decoded perfectly and the catalogue looked fine.
   */
  console.log('\n── the veg blueprint, weighed ' + '─'.repeat(28));
  const bp = require('../../chitbridge-api/lib/catalogue-blueprint');
  const veg = bp.blueprint('veg');
  const tom = veg.starter.find((x) => x.name === 'Tomato');
  say('every product on the list carries a numeric PLU for the scale',
    veg.starter.every((x) => /^[0-9]+$/.test(String(x.barcode || ''))),
    bp.pin(veg) + ' · Tomato PLU ' + (tom && tom.barcode));
  const joined = await p.evaluate((row) => {
    const mk = (item, grams) => {
      const body = '21' + String(item).padStart(5, '0') + String(grams).padStart(5, '0');
      let s = 0; for (let i = 0; i < 12; i++) s += Number(body[i]) * (i % 2 === 0 ? 1 : 3);
      return body + String((10 - (s % 10)) % 10);
    };
    /* ⚠️ set again here: the settings section above deliberately leaves a refused pattern behind */
    tillOptSet({ weigh: { on: true, preset: 'weight_13', mask: '' } });
    const label = mk(Number(row.barcode), 750);
    const mint = { item_id: 'v1', name: row.name, price: row.price, unit: row.unit,
                   code: 'V0001', barcode: row.barcode, category: row.category };
    window.S = { shop: { country: 'IN', pay: [] }, items: [mint] };
    const withPlu = weighRead(label);
    delete window.S.items[0].barcode;                    /* ⚠️ the same shop before the PLU existed */
    const without = weighRead(label);
    return { label, withPlu: withPlu && (withPlu.bad || { qty: withPlu.qty, why: withPlu.why }),
             without: without && (without.bad || { qty: without.qty }) };
  }, tom);
  say('a 750 g label on that PLU lands as 0.75 kg, priced by the shop’s rate',
    joined.withPlu && joined.withPlu.qty === 0.75 && /weight/.test(joined.withPlu.why || ''),
    joined.label + ' → ' + JSON.stringify(joined.withPlu));
  say('⚠️ and without the PLU the same label is refused — the bug this fixes, kept visible',
    typeof joined.without === 'string' && /code 1/.test(joined.without), '"' + joined.without + '"');

  if (process.argv.includes('--shots')) {
    fs.mkdirSync(path.join(__dirname, '..', 'png'), { recursive: true });
    await p.screenshot({ path: path.join(__dirname, '..', 'png', 'Scale.png') });
  }

  await b.close(); srv.close();
  console.log(bad ? '\n' + bad + ' failed' :
    '\nthe scale is read, the wrong label is refused out loud, and an ordinary barcode is untouched\n');
  process.exit(bad ? 1 : 0);
})();
