/* product-lab.cjs — ADOPTING A READY-MADE PRODUCT LIST, DRIVEN THE WAY A SHOPKEEPER DRIVES IT
 *
 * Athi, 2026-09-27: *"in the product lab, showcase what are the product lists are available, there they can
 * choose the synonym language as well... what we can showcase is the spread sheet kind of with the checkbox,
 * so they can choose according to their interest, ofcourse category should be included, so in one go or may
 * be in multiple iteration, they can add products into their catalogue."*
 *
 * ⚠️ THE LIST DATA IS REAL — the stub below builds its payload by calling lib/catalogue-blueprint, the same
 * library the route calls, so this proves the page against the actual 301 products rather than a fixture
 * that can quietly drift from them. Only the DATABASE is stubbed, because there isn't one here.
 *
 * Run: node e2e/product-lab.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const BP = require(path.join(process.env.CB_API_REPO || path.join(__dirname, '..', '..', 'chitbridge-api'), 'lib', 'catalogue-blueprint'));
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(58) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

(async () => {
  /* the shop's shelf, as the stub remembers it between calls — so "come back and add more" is real */
  /* ⭐ the shop charges 52 for a tomato the list suggests at 40 — the whole point of showing its own price */
  let shelf = [{ name: 'Tomato', unit: 'kg', price: 52 }];
  let lastAdopt = null;

  const srv = http.createServer((q, r) => {
    const url = q.url.split('?')[0];
    if (url === '/api/products/lists') {
      const body = {
        have: shelf.length, mine: shelf, currency: 'INR',
        language_names: { ta: 'Tamil', hi: 'Hindi' },
        lists: Object.keys(BP.BLUEPRINTS).map((k) => {
          const bp = BP.blueprint(k);
          return { key: bp.key, label: bp.label, outcome: bp.outcome, pin: BP.pin(bp),
                   store_id: 'store-' + k, store_name: 'Reference · ' + bp.label,
                   categories: bp.categories, units: bp.units, languages: BP.languagesOf(k),
                   count: bp.starter.length,
                   rows: bp.starter.map((x) => ({ name: x.name, unit: x.unit || bp.defaultUnit,
                     price: x.price, category: x.category || null, names: x.names || null })) };
        }),
      };
      r.writeHead(200, { 'content-type': 'application/json' }); return r.end(JSON.stringify(body));
    }
    if (url === '/api/products/lists/adopt') {
      let raw = ''; q.on('data', (c) => { raw += c; });
      q.on('end', () => {
        const b = JSON.parse(raw || '{}');
        lastAdopt = b;
        /* the real route skips what the shop already sells; the stub does the same so the count is honest */
        const fresh = (b.names || []).filter((n) => !shelf.some((s) =>
          s.name.toLowerCase() === String(n.name).toLowerCase() && s.unit === n.unit));
        fresh.forEach((n) => shelf.push({ name: n.name, unit: n.unit, price: 9 }));
        const s = (b.names || []).length - fresh.length;
        r.writeHead(200, { 'content-type': 'application/json' });
        r.end(JSON.stringify({ ok: true, added: fresh.length, skipped: new Array(s).fill({}), status: b.status,
          message: fresh.length + ' products added' + (s ? ' · ' + s + ' you already sell were left alone' : '') + '.' }));
      });
      return;
    }
    const f = path.join(ROOT, decodeURIComponent(url).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, r));
  const base = 'http://127.0.0.1:' + srv.address().port;

  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1180, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));

  /* ── it asks who you are, because adopting writes to a real shelf ─────────────────────────── */
  console.log('\n── signed out, it says so rather than showing an empty page ' + '─'.repeat(2));
  await p.goto(base + '/product-lab.html?api=' + encodeURIComponent(base));
  await p.waitForFunction(() => document.getElementById('say').textContent.length > 0, null, { timeout: 15000 });
  say('a signed-out visitor is told why it needs a sign-in',
    /sign in/i.test(await p.textContent('#say')) && /writes to your catalogue/i.test(await p.textContent('#say')),
    (await p.textContent('#say')).trim().slice(0, 62) + '…');

  /* ── signed in ────────────────────────────────────────────────────────────────────────────── */
  await p.evaluate(() => localStorage.setItem('cb_sess', JSON.stringify({ token: 'test-token' })));
  await p.goto(base + '/product-lab.html?api=' + encodeURIComponent(base));
  await p.waitForSelector('[data-testid=pl-table], [data-testid=pl-table]', { timeout: 15000 });

  console.log('\n── the lists on offer ' + '─'.repeat(39));
  const lists = await p.$$eval('#lists .pill', (bs) => bs.map((x) => x.textContent.trim()));
  say('every product list is offered by name and size', lists.length === Object.keys(BP.BLUEPRINTS).length,
    lists.join(' · '));
  say('each tile writes its store name, visible (CAT-124 C2)', (await p.$$eval('#lists .pill', (bs) => bs.map((x) => { const s = x.querySelector('.sub'); return !!s && /^Reference · /.test(s.textContent.trim()) && s.offsetHeight > 0; }))).every(Boolean), 'a visible line in every tile');
  await p.focus('#lists .pill'); await p.keyboard.press('Tab'); await p.keyboard.press('Shift+Tab');
  const ring = await p.$eval('#lists .pill:focus-visible', (e) => { const c = getComputedStyle(e); return { s: c.outlineStyle, w: parseFloat(c.outlineWidth) }; }).catch(() => null);
  say('6a a tile with its store name shows a focus ring from the keyboard', !!ring && ring.s !== 'none' && ring.w > 0, ring ? ring.s + ' ' + ring.w + 'px' : 'not focus-visible');
  say('6b the store name is part of the tile a keyboard user reaches', /Reference · /.test(await p.$eval('#lists .pill:focus-visible', (e) => e.textContent).catch(() => '')), 'inside the button');
  say('it opens on one of them, ticked', await p.$eval('#lists .pill.on', (e) => !!e), 'veg');

  const rows0 = await p.$$eval('[data-testid=pl-table] tbody tr:not(.catrow)', (r) => r.length);
  /* CAT-218: one row per PRODUCT (name + shelf), its units as lines in the row — the starter holds one row per name AND unit,
     so the page's row count is the distinct products, not starter.length (public/product-lab.html:531, groupRows) */
  const vegProductsAll = new Set(BP.blueprint('veg').starter.map((x) => x.name + '|' + (x.category || ''))).size;
  say('the whole list is laid out as a spreadsheet', rows0 === vegProductsAll,
    rows0 + ' rows (' + BP.blueprint('veg').starter.length + ' units in the list)');
  say('⭐ grouped under its shelf, so a category is readable at a glance',
    (await p.$$eval('[data-testid=pl-table] tbody tr.catrow', (r) => r.length)) === BP.blueprint('veg').categories.length,
    (await p.$$eval('[data-testid=pl-table] tbody tr.catrow', (r) => r.length)) + ' shelves');

  /* ── what the shop already sells ───────────────────────────────────────────────────────────── */
  console.log('\n── what it already sells is not offered twice ' + '─'.repeat(16));
  /* CAT-218: a product is ONE row; its units are choices, so "already sold" greys the UNIT line (the whole row only when every unit is sold) */
  const tom = await p.$eval('[data-testid=pl-table] tbody .ul.got', (t) => t.closest('tr').innerText.replace(/\s+/g, ' ').trim());
  say('a unit the shop already sells is greyed and cannot be ticked', /Tomato/.test(tom) && /you sell this/.test(tom),
    tom.slice(0, 48));
  say('and its checkbox is disabled, not merely unticked',
    await p.$eval('[data-testid=pl-table] tbody .ul.got input', (i) => i.disabled), 'disabled');

  /* ── search, by name AND by local name ─────────────────────────────────────────────────────── */
  console.log('\n── finding something in two hundred products ' + '─'.repeat(17));
  await p.fill('#q', 'brinjal');
  say('search by name', (await p.$$eval('[data-testid=pl-table] tbody tr:not(.catrow)', (r) => r.length)) > 0,
    (await p.$$eval('[data-testid=pl-table] tbody tr:not(.catrow)', (r) => r.length)) + ' rows for "brinjal"');
  await p.fill('#q', 'thakkali');
  /* ⚠️ the WHOLE row, not innerText.split('\t')[0] — the first cell is the checkbox, so splitting on the
     tab read an empty string and the assertion failed while the search was working perfectly. */
  const byLocal = await p.$$eval('[data-testid=pl-table] tbody tr:not(.catrow)',
    (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
  say('⭐ search by the LOCAL name — the whole point of carrying them',
    byLocal.length > 0 && /Tomato/.test(byLocal.join(' ')), '"thakkali" → ' + byLocal.length + ' row(s)');
  await p.fill('#q', '');

  /* ── the shelf filter ──────────────────────────────────────────────────────────────────────── */
  await p.selectOption('#cat', 'Greens');
  const greens = await p.$$eval('[data-testid=pl-table] tbody tr:not(.catrow)', (r) => r.length);
  const greenRows = BP.blueprint('veg').starter.filter((x) => x.category === 'Greens');
  say('a shelf can be looked at on its own (one row per product)',
    greens === new Set(greenRows.map((x) => x.name)).size, 'Greens · ' + greens + ' products');

  /* ── tick a whole shelf, adopt it ──────────────────────────────────────────────────────────── */
  console.log('\n── adopting one shelf, in the language they asked for ' + '─'.repeat(8));
  await p.click('[data-testid=pl-lang-ta]');
  say('a language can be asked for', await p.$eval('[data-testid=pl-lang-ta]', (e) => e.classList.contains('on')), 'Tamil on');
  await p.click('[data-testid=pl-all]');
  const ticked = await p.textContent('#count');
  say('"tick all shown" ticks the shelf and nothing else', /\b22 products chosen/.test(ticked), ticked.trim());
  say('the button moves to the next step, it does not add yet',
    /Next — price 22 products/.test(await p.textContent('[data-testid=pl-next]')),
    (await p.textContent('[data-testid=pl-next]')).trim());

  await p.click('[data-testid=pl-next]');           /* step 1 → 2, the conscious decision */
  await p.waitForSelector('[data-testid=pl-review]', { timeout: 10000 });
  await p.click('[data-testid=pl-adopt]');
  await p.waitForFunction(() => /added/.test(document.getElementById('say').textContent), null, { timeout: 15000 });
  say('it says what it did, in a sentence', /22 products added/.test(await p.textContent('#say')),
    (await p.textContent('#say')).trim());
  say('⭐ the languages asked for travelled with the request',
    JSON.stringify(lastAdopt.languages) === '["ta"]', JSON.stringify(lastAdopt.languages));
  say('and every row it sent carried its unit, not just a name',
    lastAdopt.names.every((n) => n.name && n.unit), lastAdopt.names.length + ' rows, each with a unit');

  /* ── come back and add more ────────────────────────────────────────────────────────────────── */
  console.log('\n── coming back for a second helping ' + '─'.repeat(26));
  await p.waitForFunction(() => /products in your catalogue/.test(document.getElementById('who').textContent), null, { timeout: 15000 });
  say('the shelf count is re-read from the server, not assumed',
    /23 products/.test(await p.textContent('#who')), (await p.textContent('#who')).trim());
  await p.selectOption('#cat', 'Greens');
  const nowHas = await p.$$eval('[data-testid=pl-table] tbody .ul.got', (r) => r.length);
  say('⚠️ and what was just added is now greyed — a second visit cannot double it',
    nowHas === greenRows.length, nowHas + ' of ' + greenRows.length + ' green units now marked "you sell this"');

  /* ── one row per unit ──────────────────────────────────────────────────────────────────────── */
  console.log('\n── the same product in three units is ONE row ' + '─'.repeat(17));
  await p.click('[data-testid=pl-list-egg]');
  await p.fill('#q', 'Hen egg (white)');
  const eggs = await p.$$eval('[data-testid=pl-table] tbody tr:not(.catrow)', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
  const eggLines = await p.$$eval('[data-testid=pl-table] tbody tr:not(.catrow) .ul', (r) => r.length);
  say('⭐ CAT-218: one row per product, its units as choices, each with its own price',
    eggs.length === 1 && eggLines === 3 && /piece/.test(eggs.join(' ')) && /dozen/.test(eggs.join(' ')) && /box/.test(eggs.join(' ')),
    eggs.length + ' row, ' + eggLines + ' units: ' + eggs.map((e) => e.replace('Hen egg (white) ', '')).join(' | ').slice(0, 70));
  say('each unit carries its GST unit code (PCS · DOZ · BOX)',
    /PCS/.test(eggs.join(' ')) && /DOZ/.test(eggs.join(' ')) && /BOX/.test(eggs.join(' ')), 'UQC beside the unit');
  say('a whole-rupee price shows no .00', !/\.00/.test(eggs.join(' ')), (eggs.join(' ').match(/₹[\d,.]+/g) || []).join(' '));

  /**
   * ── ⭐⭐ WHAT I ALREADY SELL, AND AT WHOSE PRICE ────────────────────────────────────────────────────
   * Athi: *"can we have an icon / filter to see what is in my catalogue with its price here"* — and the
   * constraint that makes it correct: *"as per the stores catalogue, not from here, because we don't
   * update the price."* So the assertion is not merely that a price shows, but that it is the SHOP'S 52
   * rather than the list's suggested 40 — a page that showed 40 here would be stating a number that is
   * true nowhere and implying this screen might apply it.
   */
  console.log('\n── what this shop already sells, at ITS price ' + '─'.repeat(15));
  await p.click('[data-testid=pl-list-veg]');
  await p.fill('#q', '');
  await p.click('[data-testid=pl-own-mine]');
  const mineRows = await p.$$eval('[data-testid=pl-table] tbody tr:not(.catrow)',
    (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
  say('⭐ a filter shows only what is in my catalogue', mineRows.length === shelf.length, mineRows.length + ' rows');
  const tomRow = mineRows.find((x) => /^Tomato /.test(x)) || '';
  say('⭐⭐ and it shows the SHOP’s price, not the list’s suggestion',
    /52/.test(tomRow) && !/40\.00/.test(tomRow), tomRow.slice(0, 58));
  say('⚠️ the number carries its currency — a bare 52 is not a price',
    /₹/.test(tomRow), (tomRow.match(/₹[\d,.]+/g) || ['none']).join(' '));
  say('and the cell says whose number it is', /yours/.test(tomRow), 'labelled "yours"');

  await p.click('[data-testid=pl-own-new]');
  const newRows = await p.$$eval('[data-testid=pl-table] tbody tr:not(.catrow)', (r) => r.length);
  /* "Not yet" hides a UNIT the shop sells, so a product leaves the list only when EVERY one of its units is on the shelf. By now the
     shelf holds the 22 Greens adopted above (every unit) and Tomato kg, so the rest is derived from the stub's own shelf, never a literal. */
  const soldKeys = new Set(shelf.map((x) => x.name + '|' + x.unit));
  const vegProducts = new Set(BP.blueprint('veg').starter.filter((x) => !soldKeys.has(x.name + '|' + x.unit)).map((x) => x.name + '|' + (x.category || ''))).size;
  /* ⚠️ derived, never a literal — the list grows (202 → 216 the day bulk rows landed) and a hardcoded
     count turns a healthy change into a red test. */
  const vegTotal = BP.blueprint('veg').starter.length;
  say('"Not yet" shows the rest — the question somebody adding products actually has',
    newRows === vegProducts, newRows + ' products still have a unit to add (' + vegTotal + ' units in the list)');

  /**
   * ⚠️⚠️ AND A BULK ROW IS NOT GREYED JUST BECAUSE ITS kg SIBLING IS SOLD ([found by adding veg@3]).
   * The page used to fall back to matching on the NAME alone, which was invisible while every product had
   * one unit. The moment "Tomato · box" appeared beside "Tomato · kg", a shop selling tomatoes by the kilo
   * had the box row greyed out as already-sold — and the box row is exactly what a wholesale buyer came
   * for. Athi, on the bulk units: *"if it is b2b, those only would help."*
   */
  await p.click('#own .pill[data-own=""]');
  await p.fill('#q', 'tomato');
  const tomBoth = await p.$$eval('[data-testid=pl-table] tbody tr:not(.catrow) .ul',
    (lines) => lines.map((x) => ({ t: x.closest('tr').firstElementChild.innerText.trim() + ' ' + x.innerText.replace(/\s+/g, ' ').trim(), had: x.classList.contains('got') })));
  const tomKg = tomBoth.find((x) => /^Tomato /.test(x.t) && / kg /.test(x.t));
  const tomBox = tomBoth.find((x) => /^Tomato /.test(x.t) && / box /.test(x.t));
  say('⚠️⚠️ the kg row is greyed (they sell it) but the B2B box row is still offered',
    !!(tomKg && tomKg.had) && !!(tomBox && !tomBox.had),
    'kg: ' + (tomKg && tomKg.had ? 'already sold' : '?') + ' · box: ' + (tomBox && !tomBox.had ? 'offered' : '?'));
  await p.fill('#q', '');
  say('a suggested price is labelled as suggested, never as theirs',
    /suggested/.test(await p.innerText('[data-testid=pl-table]')), 'labelled "suggested"');
  await p.click('#own .pill[data-own=""]');

  /**
   * ── ⭐ IGNORING A UNIT, TO GET A SHORTER LIST ──────────────────────────────────────────────────────
   * Athi: *"can we sort based on unit or may be a check box to include, say i get crate and kg as well, so
   * i choose to ignore crate, so i get a minimal list."* One row per unit is what makes these lists long,
   * so the unit is the sharpest way to shorten one. Eggs is the clearest case: piece, dozen and box.
   */
  console.log('\n── ignoring a unit, to get a shorter list ' + '─'.repeat(19));
  await p.click('[data-testid=pl-list-egg]');
  const unitPills = await p.$$eval('#units .pill', (b) => b.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
  const eggUnits = new Set(BP.blueprint('egg').starter.map((x) => x.unit));
  say('the units this list actually uses, counted', unitPills.length === eggUnits.size, unitPills.join(' · '));
  const allEgg = await p.$$eval('[data-testid=pl-table] tbody .ul', (r) => r.length);   /* the unit LINES: a product row holds one per unit */

  await p.click('[data-testid=pl-unit-box]');
  const noBox = await p.$$eval('[data-testid=pl-table] tbody .ul', (r) => r.length);
  say('⭐ switching a unit off shortens the list by exactly its count',
    noBox === allEgg - 1, allEgg + ' → ' + noBox + ' unit lines without "box"');
  say('and no row sold in that unit is left behind',
    !/\bbox\b/.test(await p.innerText('[data-testid=pl-table]')), 'no box rows shown');

  /* ⚠️ the one that would actually hurt: ticking rows, then hiding them */
  await p.click('[data-testid=pl-unit-box]');          /* box back on */
  await p.click('[data-testid=pl-all]');
  const before = await p.textContent('#count');
  await p.click('[data-testid=pl-unit-box]');          /* off again, with its rows ticked */
  const after = await p.textContent('#count');
  say('⚠️⚠️ hiding a unit UNTICKS its rows — adopting what you cannot see is the worst outcome here',
    /18 products chosen/.test(before) && /17 products chosen/.test(after), before.trim() + ' → ' + after.trim());
  await p.click('[data-testid=pl-unit-box]');
  await p.click('[data-testid=pl-list-veg]');
  say('a list sold one way offers no unit filter at all',
    (await p.$$eval('#units .pill', (b) => b.length)) > 1, 'veg has 6 units, so it does');

  /**
   * ── ⭐⭐⭐ STEP 2 — THE CONSCIOUS DECISION ───────────────────────────────────────────────────────────
   *
   * Athi: *"we have to say clearly, this is only adding a product to catalogue, then update price and make
   * it available like the flow of cart, so it is a conscious decision, otherwise it just getting added.
   * flow has to be there."* And then the rule that decides the default: *"it is just the first step of
   * adding the product, then there may be tax, there may be offer and combo etc, so we should not directly
   * make it available."*
   */
  /**
   * ⚠️⚠️⚠️ THE CHECKBOX ITSELF, CLICKED — not "Tick all shown" ([found 2026-09-27]).
   * Every tick assertion above drives the BUTTON, which calls pickAll() directly. That left the row
   * checkbox's own handler completely unexercised, and it was broken: its onchange was built by
   * interpolating JSON.stringify(name) into a double-quoted attribute, so the attribute ended early and
   * the browser threw "SyntaxError: Unexpected end of input" on every row. A control can be dead while
   * the feature it drives looks thoroughly tested. This clicks the actual box.
   */
  console.log('\n── the checkbox a person actually clicks ' + '─'.repeat(20));
  await p.click('[data-testid=pl-list-egg]');
  say('⭐ CAT-218: Next is grey with nothing chosen, and says why beside it',
    (await p.$eval('[data-testid=pl-next]', (b) => b.disabled)) && /Tick a product/.test(await p.textContent('[data-testid=pl-next-why]')),
    (await p.textContent('[data-testid=pl-next-why]')).trim());
  await p.click('[data-testid=pl-table] tbody tr:not(.catrow):not(.has) input[type=checkbox]');
  say('⭐ ticking one row with the mouse registers it', /1 product chosen/.test(await p.textContent('#count')),
    (await p.textContent('#count')).trim());
  await p.click('[data-testid=pl-table] tbody tr:not(.catrow):not(.has) input[type=checkbox]');
  say('and unticking it takes it back off', /Tick what this shop sells/.test(await p.textContent('#count')),
    'back to none');

  console.log('\n── step 2, where the decisions are made ' + '─'.repeat(21));
  await p.click('[data-testid=pl-all]');
  say('step 2 is not reachable with nothing chosen — a step that opens empty is a dead end',
    await p.$eval('[data-testid=pl-step-2]', (e) => !e.disabled), 'enabled once something is chosen');
  await p.click('[data-testid=pl-next]');
  await p.waitForSelector('[data-testid=pl-review]', { timeout: 10000 });

  const reviewRows = await p.$$eval('[data-testid=pl-review] tbody tr', (r) => r.length);
  say('only what was chosen is carried forward', reviewRows === 18, reviewRows + ' rows to price');
  say('⭐⭐⭐ and OFF THE SHELF is the default — tax and offers come first',
    await p.$eval('[data-testid=pl-shelf-unavailable]', (e) => e.classList.contains('on')),
    '"Not yet — set tax and offers first" is pre-selected');
  say('the footer says what will happen, before it happens',
    /off the shelf until you switch them on/.test(await p.textContent('#count')),
    (await p.textContent('#count')).trim());

  /* ⭐ amend a price — the thing step 2 exists for */
  const priceBox = '[data-testid="pl-price-Boiled egg"]';
  say('every chosen row offers its price to amend',
    (await p.$$eval('[data-testid=pl-review] input[type=number]', (i) => i.length)) === 18, '18 price boxes');
  await p.fill(priceBox, '18');
  await p.click('[data-testid=pl-shelf-available]');
  say('and the shelf choice can be overridden deliberately',
    /on sale immediately/.test(await p.textContent('#count')), (await p.textContent('#count')).trim());

  /* ⚠️ back and forth must not lose the decision — that is what makes it a flow and not two forms */
  await p.click('[data-testid=pl-step-1]');
  await p.waitForSelector('[data-testid=pl-table]', { timeout: 10000 });
  await p.click('[data-testid=pl-step-2]');
  await p.waitForSelector('[data-testid=pl-review]', { timeout: 10000 });
  say('⚠️ a price typed in step 2 survives a trip back to step 1',
    (await p.inputValue(priceBox)) === '18', 'Boiled egg still ₹18');

  await p.click('[data-testid=pl-adopt]');
  await p.waitForFunction(() => /added/.test(document.getElementById('say').textContent), null, { timeout: 15000 });
  say('⭐⭐ the amended price is what reached the server, not the suggestion',
    (lastAdopt.names.find((x) => x.name === 'Boiled egg') || {}).price === 18,
    JSON.stringify(lastAdopt.names.find((x) => x.name === 'Boiled egg')));
  /**
   * ⭐⭐ EVERY ROW SENDS THE PRICE THAT WAS ON SCREEN — including the ones left at the suggestion.
   * The first version of this assertion expected untouched rows to send nothing and let the server
   * re-derive the list's figure. That is worse: if the list moved between the page loading and the
   * shopkeeper pressing Add, the price written would not be the price they were looking at. What is
   * displayed is what is decided, so what is displayed is what travels.
   */
  const anEgg = lastAdopt.names.find((x) => x.name === 'Duck egg' && x.unit === 'piece');
  say('⭐ and a row left at its suggestion sends that same figure — what was shown is what is written',
    !!anEgg && anEgg.price === 12, JSON.stringify(anEgg));
  say('nothing was sent that the person did not see',
    lastAdopt.names.every((x) => x.price === undefined || Number.isFinite(x.price)),
    lastAdopt.names.length + ' rows, every price a real number');
  say('and the shelf decision travelled with them', lastAdopt.status === 'available', lastAdopt.status);
  say('it lands back on step 1, ready for the next helping',
    await p.$eval('[data-testid=pl-step-1]', (e) => e.classList.contains('on')), 'step 1');

  /* CAT-124 layout: the store line makes the tiles one line taller; only the rows may scroll (#tablewrap, CAT-218), never the page */
  fs.mkdirSync(path.join(__dirname, '..', 'png'), { recursive: true });
  for (const vp of [{ w: 1366, h: 768 }, { w: 390, h: 844 }]) {
    await p.setViewportSize({ width: vp.w, height: vp.h });
    await p.click('[data-testid=pl-list-veg]');
    const over = await p.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    await p.screenshot({ path: path.join(__dirname, '..', 'png', 'ProductLab-store-' + vp.w + 'x' + vp.h + '.png') });
    say('the page does not scroll with the store lines · ' + vp.w + 'x' + vp.h, over <= 1, 'overflow ' + over + 'px');
  }
  console.log('\nconsole/page errors: ' + (errs.length ? errs.join(' · ') : 'none'));
  if (errs.length) bad++;
  if (process.argv.includes('--shots')) {
    fs.mkdirSync(path.join(__dirname, '..', 'png'), { recursive: true });
    /* step 1 on the big list, then step 2 on a small one — the two things worth looking at */
    await p.click('[data-testid=pl-list-veg]');
    await p.screenshot({ path: path.join(__dirname, '..', 'png', 'ProductLab.png') });
    /* ⚠️ a list this run has NOT adopted — eggs are all on the shelf by now, so nothing would tick */
    await p.click('[data-testid=pl-list-meat]');
    await p.click('[data-testid=pl-all]');
    await p.click('[data-testid=pl-next]');
    await p.waitForSelector('[data-testid=pl-review]', { timeout: 10000 });
    await p.screenshot({ path: path.join(__dirname, '..', 'png', 'ProductLab-2.png') });
  }
  await b.close(); srv.close();
  console.log(bad ? '\n' + bad + ' failed\n' : '\na shop adopts a ready-made list, in its own language, without typing a product\n');
  process.exit(bad ? 1 : 0);
})();
