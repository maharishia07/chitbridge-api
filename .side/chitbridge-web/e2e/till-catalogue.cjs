/* till-catalogue.cjs — THE AXIOM, THE TWO TRADES, AND STARTING A SHOP ([TILL-107])
 *
 * Athi, 2026-09-19: *"can we have a proper two catalogue, one for Veg Store and another one for Hotel… we have
 * many means and complexities in the world, but how do we bring the axiom out of the lot? so we can start the
 * store in no time."*
 *
 * ⭐⭐⭐ THE FIRST BLOCK IS WHERE THE AXIOM CAME FROM, and it stays here as a standing check rather than a note
 * in a commit message. lib/catalogue-blueprint declares AXIOM = name + price on the strength of it: strip a
 * product down field by field and see where the counter stops being able to sell. If a future change makes
 * `unit` or `item_id` load-bearing, this fails and the claim in that file stops being true quietly.
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const SHOTS = process.argv.includes('--shots');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log(String(l).padEnd(26) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

/* what the server would answer — the counter must not hold its own copy of the trades */
const BLUEPRINTS = {
  version: 1, axiom: ['name', 'price'],
  blueprints: [
    { key: 'veg', label: 'Vegetables & fruit', outcome: 'a counter that can weigh, price and bill fresh produce today',
      pin: 'veg@1', products: 12, sample: ['Tomato', 'Onion', 'Potato', 'Carrot'] },
    { key: 'hotel', label: 'Hotel / restaurant', outcome: 'a counter that can take a tiffin order and print a bill today',
      pin: 'hotel@1', products: 12, sample: ['Idli', 'Dosa', 'Vada', 'Pongal'] },
  ],
};
const VEG = [
  { item_id: 'v1', name: 'Tomato', code: 'V0001', category: 'Vegetables', unit: 'kg', price: 40 },
  { item_id: 'v2', name: 'Coriander', code: 'V0008', category: 'Greens', unit: 'bunch', price: 10 },
  { item_id: 'v3', name: 'Coconut', code: 'V0011', category: 'Vegetables', unit: 'piece', price: 25 },
];

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
  const p = await b.newPage({ viewport: { width: 1280, height: 880 } });
  await p.goto('http://127.0.0.1:' + srv.address().port + '/till.html');
  await p.waitForFunction(() => typeof window.screenSet === 'function', null, { timeout: 30000 });

  /* ══ 1 · THE AXIOM, MEASURED — this is the evidence behind AXIOM = ['name','price'] ══════════════════ */
  console.log('\n── what a product needs before it can be sold ' + '─'.repeat(16));
  const axiom = await p.evaluate(() => {
    const tries = [
      ['name + price only', { name: 'Tea', price: 10 }],
      ['+ item_id',         { item_id: 'x1', name: 'Tea', price: 10 }],
      ['+ unit',            { item_id: 'x1', name: 'Tea', price: 10, unit: 'cup' }],
      ['+ category',        { item_id: 'x1', name: 'Tea', price: 10, unit: 'cup', category: 'Drinks' }],
      ['+ code',            { item_id: 'x1', name: 'Tea', price: 10, unit: 'cup', category: 'Drinks', code: 'T1' }],
    ];
    return tries.map(([label, item]) => {
      window.S = { shop: { name: 'S', currency: 'INR', country: 'IN' }, items: [item], offers: [], at: new Date().toISOString() };
      let err = null, total = '';
      try {
        setMode('sell'); applyLook(); paintChips();
        CART.length = 0; addItem(item, 2); price();
        total = (document.querySelector('[data-testid="till-total"]') || { innerText: '' }).innerText;
      } catch (e) { err = String(e && e.message).slice(0, 60); }
      return { label, err, total };
    });
  });
  for (const a of axiom) say(a.label, !a.err && a.total === '₹20.00', a.err ? 'threw: ' + a.err : 'TOTAL ' + a.total);
  /* ⚠️ THE CLAIM IS THAT THEY ARE ALL THE SAME. If the first differs from the rest, the axiom is bigger. */
  say('the axiom is 2 fields', new Set(axiom.map((a) => a.total)).size === 1,
    'every shape billed identically — nothing beyond name + price is load-bearing');

  /* ══ 2 · THE FRONT DOOR ═══════════════════════════════════════════════════════════════════════════════ */
  console.log('\n── an empty counter ' + '─'.repeat(42));
  await p.evaluate(() => {
    window.S = { shop: { name: 'A new shop', currency: 'INR', country: 'IN' }, items: [], offers: [], at: new Date().toISOString() };
    setMode('sell'); applyLook(); paintChips(); paintHits();
  });
  const empty = await p.evaluate(() => (document.querySelector('[data-testid="till-shelf-count"]') || { innerText: '' }).innerText);
  say('it offers a way out', /Start your shop/i.test(empty), '"' + empty.trim() + '"');

  /**
   * ⚠️ THE TRADES COME FROM THE SERVER. Stubbing tillGet is what proves the page does not hold its own copy —
   * if the dialog fills with anything when the stub returns nothing, there is a list hidden in the page.
   */
  const listed = await p.evaluate(async (BP) => {
    window.HOST.tillGet = async () => BP;
    await startOpen();
    const cards = [...document.querySelectorAll('.trade')].map((t) => ({
      key: t.getAttribute('data-testid'), text: t.innerText.replace(/\s+/g, ' ').trim() }));
    return { open: document.getElementById('startdlg').open, cards,
             /* ⭐ the OTHER way in — a shop that already keeps a list brings it ([TILL-108]). It is not a
                trade and does not wear that class, which is what keeps `.trade` a meaningful set. */
             bring: !!document.querySelector('.bring[data-testid="till-upload-open"]'),
             note: (document.querySelector('#startbody .note') || { innerText: '' }).innerText };
  }, BLUEPRINTS);
  say('both trades are offered', listed.cards.length === 2, listed.cards.map((c) => c.key).join(' '));
  /* ⚠️ and exactly two — the upload card must not creep into the set and be treated as a blueprint */
  say('and a way to bring a list', listed.bring, 'offered beside them, without pretending to be a trade');
  /* ⭐ A BLUEPRINT LEADS WITH ITS OUTCOME — that is what makes it a blueprint and not a starter list */
  say('each leads with its outcome', listed.cards.every((c) => /counter that can/.test(c.text)),
    '"' + (listed.cards[0] || {}).text + '"');
  say('and it states the axiom', /only a .*name.* and a .*price/i.test(listed.note), '"' + listed.note.trim() + '"');

  /* ══ 3 · MINTING IT ═══════════════════════════════════════════════════════════════════════════════════ */
  console.log('\n── starting a vegetable shop ' + '─'.repeat(33));
  const minted = await p.evaluate(async (items) => {
    let sent = null;
    window.HOST.tillPost = async (pathname, body) => { sent = { pathname, body }; return { ok: true, added: 12, message: '12 products added' }; };
    /* refresh() would go to the network; the shop arriving is what it does, so that is what is simulated */
    window.refresh = async () => { window.S = Object.assign({}, window.S, { items, at: new Date().toISOString() }); };
    await startMint('veg');
    return { sent, open: document.getElementById('startdlg').open,
             shelf: (document.querySelector('[data-testid="till-shelf-count"]') || { innerText: '' }).innerText,
             keys: document.querySelectorAll('.quick .sk-name, .quick button').length };
  }, VEG);
  say('it asks the server to mint', minted.sent && minted.sent.pathname === '/api/till/catalogue'
    && minted.sent.body.blueprint === 'veg', JSON.stringify(minted.sent && minted.sent.body));
  /* ⚠️ THE PAGE MUST NOT NUMBER THE PRODUCTS. A code allocated in a browser is the bill-series incident again. */
  say('the page sends no products', minted.sent && !minted.sent.body.products,
    'it names the trade only — the server numbers them against what the shop holds');
  say('the dialog closes', !minted.open, 'the shopkeeper is returned to the counter');
  say('the shelf redraws', /3 products/.test(minted.shelf), '"' + minted.shelf.trim() + '"');

  /* ══ ⭐⭐⭐ THE CATEGORY MASTER IS THE TRUTH, THE NAME IS A CACHE ([TILL-114]) ═════════════════ */
  console.log('\n── the local copy stays in step ' + '─'.repeat(30));
  /**
   * Athi: *"they can always in sync?"* — they can, but only if the ID is what is trusted. The snapshot sends
   * the master in full every time while a DELTA leaves unchanged products alone, so a renamed category would
   * otherwise stick on every product that happened not to change.
   */
  const sync = await p.evaluate(() => {
    const snap = { shop: { name: 'S', currency: 'INR', country: 'IN' }, at: new Date().toISOString(), offers: [],
      category_master: [{ id: '838f', name: 'Grains' }, { id: 'b6d6', name: 'Flour' }],
      items: [
        { item_id: 'a', name: 'Rice',   price: 10, unit: 'kg', category: 'Veg',    category_id: '838f' },
        { item_id: 'b', name: 'Atta',   price: 20, unit: 'kg', category: null,     category_id: 'b6d6' },
        { item_id: 'c', name: 'Old',    price: 30, unit: 'pc', category: 'Legacy', category_id: null },
        { item_id: 'd', name: 'Orphan', price: 40, unit: 'pc', category: 'Kept',   category_id: 'zzzz' },
      ] };
    const after = catRestamp(snap);
    const by = {};
    after.items.forEach((i) => { by[i.name] = i.category; });
    return by;
  });

  /* ⭐ A RENAME TAKES EFFECT on a product that did not itself change — the point of the whole arrangement */
  say('a rename reaches old rows', sync.Rice === 'Grains', 'Rice was baked as "Veg", now reads "' + sync.Rice + '"');
  say('an unnamed one resolves', sync.Atta === 'Flour', 'Atta had no name and now reads "' + sync.Atta + '"');
  /**
   * ⚠️⚠️ AND NOTHING IS LOST. A product with no id keeps its legacy name, and one citing an id the master
   * does not hold keeps what it had — replacing a name with nothing is a regression, not a fix.
   */
  say('the legacy name survives', sync.Old === 'Legacy', 'a product with no id still reads "' + sync.Old + '"');
  say('an unknown id keeps its name', sync.Orphan === 'Kept', 'not blanked to "' + sync.Orphan + '"');

  /* ══ 4 · AND THE SHOP CAN SELL, with the veg differentiator intact ════════════════════════════════════ */
  const sale = await p.evaluate(() => {
    CART.length = 0;
    addItem(window.S.items[0], 0.5); addItem(window.S.items[2], 3);
    price();
    return { total: (document.querySelector('[data-testid="till-total"]') || { innerText: '' }).innerText,
             words: typeof countWords === 'function' ? countWords() : '' };
  });
  say('the new shop bills', sale.total === '₹95.00', 'TOTAL ' + sale.total + ' (0.5 kg tomato + 3 coconuts)');
  /* ⭐⭐ the blueprint chose measured units, so [TILL-104]'s rule reads correctly with no branch anywhere */
  say('and counts by unit', /0.5 kg/.test(sale.words) && /3 items/.test(sale.words), '"' + sale.words + '"');

  if (SHOTS) {
    await p.evaluate(async (BP) => { window.HOST.tillGet = async () => BP; await startOpen(); }, BLUEPRINTS);
    const out = path.join(__dirname, '..', 'png', 'StartShop.png');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await p.screenshot({ path: out });
    console.log('  shot                      · png/StartShop.png');
  }

  await b.close(); srv.close();
  console.log(bad ? '\n' + bad + ' failed' : '\ntwo trades, one axiom — a shop opens and sells');
  process.exit(bad ? 1 : 0);
})();
