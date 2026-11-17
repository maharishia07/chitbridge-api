/* day-one.cjs — A SHOP THAT OPENED THIS MORNING, WALKED FROM NOTHING TO ITS FIRST BILL
 *
 * Athi, 2026-09-27: *"assume one shop, one counter, he signed in, if no product, lab to be showcased to add
 * products... so they can add the product, price... then the offer if at all any, combo if at all any, then
 * make the product available. so they can start using the till application from the day 1, without much help
 * from others. can we simulate that flow."*
 *
 * This is that simulation. It walks ONE journey across TWO pages and reports what a shopkeeper actually
 * meets at each step — including the steps that are not built yet, which are marked TODO rather than
 * quietly skipped. A tour that only walks the finished parts is a tour that cannot tell you what is missing.
 *
 * ⚠️ WHAT IS REAL HERE: till.html and product-lab.html are the shipped pages, and the product lists come
 * from lib/catalogue-blueprint — the same library the routes call. What is STUBBED is the database and the
 * sign-in, because neither exists in this sandbox. So this proves the JOURNEY and the pages; it does not
 * prove the server's writes, which e2e/product-lab.cjs and the route tests cover separately.
 *
 * Run: node e2e/day-one.cjs [--shots]
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const BP = require('../../chitbridge-api/lib/catalogue-blueprint');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
let bad = 0, todo = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(58) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };
/** ⚠️ NOT a pass and NOT a failure — a step of the journey that has no answer yet. Counted separately so
 *  "the tour is green" can never come to mean "the tour is complete". */
const gap = (l, d) => { todo++; console.log('  ' + String(l).padEnd(58) + '· ' + d + '  ⛏ NOT BUILT'); };

(async () => {
  /* the shop's shelf — empty, because this shop opened this morning */
  let shelf = [];

  const srv = http.createServer((q, r) => {
    const url = q.url.split('?')[0];
    if (url === '/api/products/lists') {
      return json(r, {
        have: shelf.length, mine: shelf, currency: 'INR', language_names: { ta: 'Tamil' },
        lists: Object.keys(BP.BLUEPRINTS).map((k) => {
          const bp = BP.blueprint(k);
          return { key: bp.key, label: bp.label, outcome: bp.outcome, pin: BP.pin(bp),
                   categories: bp.categories, units: bp.units, languages: BP.languagesOf(k),
                   count: bp.starter.length,
                   rows: bp.starter.map((x) => ({ name: x.name, unit: x.unit || bp.defaultUnit,
                     price: x.price, category: x.category || null, names: x.names || null })) };
        }),
      });
    }
    if (url === '/api/products/lists/adopt') {
      let raw = ''; q.on('data', (c) => { raw += c; });
      q.on('end', () => {
        const b = JSON.parse(raw || '{}');
        /* ⭐ the stub honours the shelf decision, because that is the thing being simulated */
        (b.names || []).forEach((n) => shelf.push({ name: n.name, unit: n.unit, price: n.price == null ? 0 : n.price,
          status: b.status === 'available' ? 'available' : 'unavailable' }));
        json(r, { ok: true, added: (b.names || []).length, skipped: [], status: b.status,
          message: (b.names || []).length + ' products added' });
      });
      return;
    }
    if (url.startsWith('/api/')) return json(r, { ok: true });
    const f = path.join(ROOT, decodeURIComponent(url).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  function json(r, o){ r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); }
  await new Promise((r) => srv.listen(0, r));
  const base = 'http://127.0.0.1:' + srv.address().port;

  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));

  /* the shop as the snapshot would describe it — one shop, one counter, nothing on the shelf */
  const SHOP = (items) => ({
    shop: { name: 'Mayur Bhavan', currency: 'INR', country: 'IN', handle: 'mayurbhavan',
            pay: [{ id: 'cash', label: 'Cash' }, { id: 'upi', label: 'UPI' }] },
    at: new Date().toISOString(), items: items || [], offers: [], slabs: [], categories: [],
  });

  console.log('\n══ THE SHOP THAT OPENED THIS MORNING ' + '═'.repeat(28));

  /* ── 1 · REGISTRATION ──────────────────────────────────────────────────────────────────────── */
  console.log('\n── 1 · registering, and landing in the till ' + '─'.repeat(18));
  gap('a shop registers with a user id and a password, in the till',
    'today registration happens in the back-office app — see the sign-in map');
  gap('or with an emailed code (OTP) instead of a password', 'not offered from this page');

  /* ── 2 · SIGNED IN, EMPTY SHELF ────────────────────────────────────────────────────────────── */
  console.log('\n── 2 · signed in, and there is nothing to sell ' + '─'.repeat(15));
  await p.goto(base + '/till.html');
  await p.waitForFunction(() => typeof window.health === 'function', null, { timeout: 30000 });
  await p.evaluate((api) => {
    CloudHost.key = 'demo-key'; CloudHost.api = api; HOST = CloudHost;
    ls.set(tillGivenKey(), 'C1');
    WHO = { id: 'w1', name: 'Bala', kind: 'coassist', since: new Date().toISOString() };
    window.sure = async () => true;
  }, base);
  await p.evaluate((s) => { window.S = s; }, SHOP([]));

  const empty = await p.evaluate(() => health().filter((h) => /Nothing on the shelf/.test(h.what))[0] || null);
  say('the counter says plainly that it has nothing to sell', !!empty, empty ? '"' + empty.what + '"' : 'nothing said');
  say('⭐⭐⭐ and it names a control IN THIS APP — not another application',
    !!empty && /Start your shop/.test(empty.todo) && !/ChitBridge/.test(empty.todo),
    empty ? '"' + empty.todo.slice(0, 66) + '…"' : '—');

  /* ── 3 · THE LAB ───────────────────────────────────────────────────────────────────────────── */
  console.log('\n── 3 · adopting a ready-made list ' + '─'.repeat(27));
  const lab = await ctx.newPage();
  await lab.evaluate(() => {}).catch(() => {});
  await lab.goto(base + '/product-lab.html?api=' + encodeURIComponent(base));
  await lab.evaluate(() => localStorage.setItem('cb_sess', JSON.stringify({ token: 't' })));
  await lab.goto(base + '/product-lab.html?api=' + encodeURIComponent(base));
  await lab.waitForSelector('[data-testid=pl-table]', { timeout: 15000 });
  say('a brand-new shop is offered every list', (await lab.$$eval('#lists .pill', (x) => x.length)) >= 5,
    (await lab.$$eval('#lists .pill', (x) => x.map((y) => y.textContent.trim().split(' ')[0]).join(' · '))));

  /* they sell greens and nothing else on day one */
  await lab.click('[data-testid=pl-lang-ta]');
  await lab.selectOption('#cat', 'Greens');
  await lab.click('[data-testid=pl-all]');
  await lab.click('[data-testid=pl-next]');
  await lab.waitForSelector('[data-testid=pl-review]', { timeout: 10000 });
  say('⭐ and the shelf decision defaults to NOT selling them yet',
    await lab.$eval('[data-testid=pl-shelf-unavailable]', (e) => e.classList.contains('on')),
    'tax and offers come first');
  await lab.fill('[data-testid="pl-price-Coriander"]', '12');
  await lab.click('[data-testid=pl-adopt]');
  await lab.waitForFunction(() => /added/.test(document.getElementById('say').textContent), null, { timeout: 15000 });
  say('the shop now has a shelf', shelf.length === 22, shelf.length + ' products adopted');
  say('⭐ priced by the shopkeeper where they chose to',
    (shelf.find((x) => x.name === 'Coriander') || {}).price === 12, 'Coriander ₹12, not the suggested ₹10');
  say('⚠️ and NONE of them is sellable yet — that is the point',
    shelf.every((x) => x.status === 'unavailable'), 'all 22 off the shelf');
  await lab.close();

  /* ── 4 · TAX, OFFERS, COMBOS ───────────────────────────────────────────────────────────────── */
  console.log('\n── 4 · tax, offers, combos — before anything is sold ' + '─'.repeat(9));
  gap('the counter walks them to a tax slab for the new products',
    'Product Lab sets no gst_rate; nothing yet prompts for one');
  gap('and then to Offer Lab / Combo Lab if they want either',
    'both exist in 🧪 Lab, but nothing links them into this sequence');

  /* ── 5 · ON THE SHELF ──────────────────────────────────────────────────────────────────────── */
  console.log('\n── 5 · putting one on the shelf ' + '─'.repeat(29));
  await p.evaluate((s) => { window.S = s; }, SHOP(shelf.map((x, i) => ({
    item_id: 'i' + i, name: x.name, price: x.price, unit: x.unit, status: x.status, category: 'Greens',
  }))));
  const offShelf = await p.evaluate(() => (window.S.items || []).filter((i) => statusOf(i) === 'unavailable').length);
  say('the counter sees them, and sees they are off the shelf', offShelf === 22, offShelf + ' marked unavailable');
  const sellable = await p.evaluate(() => { FILTER = { offer:'', cat:'', off:'', job:'' }; return (hits() || []).length; });
  say('⚠️⚠️ so the selling list offers NOTHING — a shop that stopped here could not sell',
    sellable === 0, sellable + ' sellable');

  /* switch one on, the way the maintenance card does */
  await p.evaluate(() => { window.S.items[0].status = 'available'; });
  const nowOne = await p.evaluate(() => { FILTER = { offer:'', cat:'', off:'', job:'' }; return (hits() || []).length; });
  say('⭐ switching one on makes exactly that one sellable', nowOne === 1, nowOne + ' on the shelf');
  /**
   * ⚠️⚠️ THIS WAS LOGGED AS A GAP AND IT WAS NOT ONE — my mistake, corrected 2026-09-27. I reported that a
   * shop adopting 22 products faced "22 separate card visits"; the maintenance screen has had a multi-select
   * pickbar for some time ("Back on the shelf" / "Off the shelf" / "Run out today"). The CONTROL existed.
   * What was wrong sat underneath it: pickedDo() looped one round trip per product. It is one call now.
   * ⭐ So the assertion is that the control is real and reaches the BULK route — not that it is missing.
   */
  const bulk = await p.evaluate(() => {
    MODE = 'maintain';
    PICKED_IDS = (window.S.items || []).slice(0, 5).map((i) => i.item_id);
    paintHits();
    const bar = document.querySelector('[data-testid=till-pickbar]');
    return { shown: !!bar, on: !!document.querySelector('[data-testid=till-pick-on]'),
             says: bar ? bar.innerText.replace(/\s+/g, ' ').trim().slice(0, 40) : '' };
  });
  say('⭐ several can be chosen and switched on together', bulk.shown && bulk.on, '"' + bulk.says + '"');
  say('⭐⭐ and that is ONE call now, not one per product',
    await p.evaluate(() => /stock\/bulk/.test(String(window.pickedDo))), 'POST /api/till/stock/bulk');

  /* ── 6 · THE FIRST BILL ────────────────────────────────────────────────────────────────────── */
  console.log('\n── 6 · the first bill ' + '─'.repeat(39));
  const sale = await p.evaluate(() => {
    CART.length = 0;
    addItem(window.S.items[0], 2);
    price();
    return { total: (document.querySelector('[data-testid="till-total"]') || { innerText: '' }).innerText,
             words: typeof countWords === 'function' ? countWords() : '' };
  });
  say('⭐⭐⭐ and the shop takes money on day one', /24/.test(sale.total), 'TOTAL ' + sale.total + ' (2 bunches at ₹12)');
  /* the stand-in carries country IN; the same bill in a shop whose country is not stated must NOT be billed on a guess (till.html noCountryMoney, CTR-227) */
  const noCountry = await p.evaluate(() => {
    const was = window.S.shop.country; window.S.shop.country = '';
    try { price(); const m = billMoney(); return { refused: m.noCountry === true, invoice: m.invoice, why: m.why || '' }; }
    finally { window.S.shop.country = was; price(); }
  });
  say('⚠️⚠️ a shop whose country is not stated is refused, never billed on a guess', noCountry.refused && !noCountry.invoice && /country/i.test(noCountry.why), noCountry.why);
  say('counted in the unit it is sold in', /2 /.test(sale.words), '"' + sale.words + '"');

  /* ── 7 · THE STOREFRONT ────────────────────────────────────────────────────────────────────── */
  console.log('\n── 7 · what they can send a customer ' + '─'.repeat(24));
  const front = await p.evaluate(() => {
    menuSection('shopdet'); paintMenu();
    var el = document.querySelector('[data-testid=till-shop-storefront]');
    return el ? el.innerText.replace(/\s+/g, ' ').trim() : null;
  });
  say('⭐ the shop profile carries its storefront link', !!front && /shop\.html\?s=mayurbhavan/.test(front),
    front ? front.slice(0, 64) : 'not shown');

  /**
   * ── ⭐⭐ 8 · AND WHAT A CUSTOMER WOULD SEE OF IT ─────────────────────────────────────────────────────
   *
   * Athi, pointing at the back office's own Storefront tab: *"we have the shopfront page the catalogue, so
   * possibly we can reuse."* It reuses shop.html itself, in a frame — so the assertion is that it frames
   * THE REAL PAGE, and that it has not booted it yet.
   *
   * ⚠️⚠️ THE SECOND ASSERTION IS THE IMPORTANT ONE. app.html already paid for this: the frame used to load
   * eagerly and it is not slow rendering, it is a second application starting (CAT001-H06, Athi's own
   * report). A preview that costs a page load per product is one nobody keeps.
   */
  console.log('\n── 8 · what a customer would see of it ' + '─'.repeat(22));
  const prev = await p.evaluate(() => {
    CARD_ID = window.S.items[0].item_id;           /* the product card is open on the first product */
    shopPrevOpen();
    const f = document.getElementById('shopprevframe');
    return { open: document.getElementById('shopprevdlg').open,
             src: f ? (f.getAttribute('src') || '') : 'no frame',
             dataSrc: f ? (f.getAttribute('data-src') || '') : '',
             holdShown: !!document.getElementById('shopprevhold') };
  });
  say('the counter offers the customer’s own page, not a drawing of it',
    /shop\.html\?s=mayurbhavan&item=/.test(prev.dataSrc) && /preview=1/.test(prev.dataSrc),
    prev.dataSrc.replace(/^.*\/shop/, '/shop').slice(0, 52));
  say('⚠️⚠️ and it has NOT booted the storefront — an outline and a button first',
    prev.src === '' && prev.holdShown, 'src empty until asked');
  const loaded = await p.evaluate(() => {
    shopPrevLoad();
    const f = document.getElementById('shopprevframe');
    return { src: f.getAttribute('src') || '', hidden: (document.getElementById('shopprevhold') || {}).style.display };
  });
  say('⭐ and it loads on the one press that asks for it', /shop\.html/.test(loaded.src) && loaded.hidden === 'none',
    'frame given its src');
  await p.evaluate(() => shopPrevClose());

  /**
   * ── ⭐⭐⭐ 9 · WHOSE COUNTER IS THIS? ────────────────────────────────────────────────────────────────
   *
   * Athi, testing many shops in one browser: *"i create a store called vegdemo1 and when we click the
   * counter, it goes to mayuri bhavan... whatever userid signs in, that shop's counter should open, this is
   * the confusion i keep saying."*
   *
   * The counter opened COLD (a bookmark, an old tab) uses whatever key the browser holds and — until now —
   * said nothing about whose shop that was. wrongShop() stays deliberately silent there, and its reasoning
   * is right for a shop PC: nothing declared an expectation, so there is nothing to contradict. In a
   * BROWSER there is: cb_sess, on this very origin, names the shop the person signed in as.
   */
  console.log('\n── 9 · whose counter is this? ' + '─'.repeat(31));
  const same = await p.evaluate(() => {
    localStorage.setItem('cb_sess', JSON.stringify({ entityId: 'ent-mayur', entity: 'Mayur Bhavan' }));
    window.S.entity_id = 'ent-mayur';
    return { bar: whoseShopSay(), m: signedInElsewhere() };
  });
  say('signed in as the SAME shop the counter belongs to — it says nothing',
    same.bar === '' && same.m === null, 'silent, as it should be');

  const other = await p.evaluate(() => {
    /* the exact case: the person is signed in as vegdemo1, the counter holds Mayur Bhavan's key */
    localStorage.setItem('cb_sess', JSON.stringify({ entityId: 'ent-vegdemo1', entity: 'vegdemo1' }));
    return { bar: whoseShopSay(), m: signedInElsewhere() };
  });
  say('⭐⭐⭐ signed in as vegdemo1 on Mayur Bhavan’s counter — it SAYS so',
    /vegdemo1/.test(other.bar) && /Mayur Bhavan/.test(other.bar),
    other.bar.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 74));
  say('and offers the way over, named', /Open vegdemo1’s counter/.test(other.bar), 'a button, not an instruction');

  /* ⚠️ the one thing it must NOT do */
  const stillSells = await p.evaluate(() => {
    CART.length = 0; addItem(window.S.items[0], 1); price();
    return CART.length;
  });
  say('⚠️⚠️ and it never blocks a sale — this is a suspicion, not a proven fault',
    stillSells === 1, 'the counter still bills');

  const coldPC = await p.evaluate(() => {
    localStorage.removeItem('cb_sess');                 /* a shop PC: nobody is signed into an app here */
    return whoseShopSay();
  });
  say('a shop PC with nobody signed in here is left alone', coldPC === '', 'silent');

  console.log('\nconsole/page errors: ' + (errs.length ? errs.join(' · ') : 'none'));
  if (errs.length) bad++;

  if (process.argv.includes('--shots')) {
    fs.mkdirSync(path.join(__dirname, '..', 'png'), { recursive: true });
    await p.screenshot({ path: path.join(__dirname, '..', 'png', 'DayOne.png') });
  }
  await b.close(); srv.close();
  console.log('\n' + (bad ? bad + ' failed · ' : '') + todo + ' step(s) of the journey not built yet');
  console.log(bad ? '' : 'a shop with nothing went from empty to its first bill without leaving the till\n');
  process.exit(bad ? 1 : 0);
})();
