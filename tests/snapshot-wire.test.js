/**
 * snapshot-wire.test.js — WHAT THE COUNTER ACTUALLY RECEIVES (2026-09-08).
 *
 * ⚠️⚠️ THE BUG THIS EXISTS FOR. Athi: *"no, tax is not there."* `taxShelf.readShelf()` returns `slabs` as a **Map**, and every
 * in-process caller hands it straight to `taxSlab.resolve()`, which accepts a Map — so it was correct in four places. This route
 * does not call a function with it; it puts it on the wire, and `JSON.stringify(new Map())` is `{}`. Every snapshot the till had
 * ever taken carried `slabs: {}`. No rate resolved on any product, no GST on any bill, nothing thrown, nothing logged.
 *
 * The lesson is narrow and worth keeping: **a value that crosses JSON must be checked AFTER it crosses.** Reading the code proves
 * nothing here — the code was right everywhere except at the one boundary that serialises.
 *
 * Run: node tests/snapshot-wire.test.js   · no DB, no network.
 */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');
const taxSlab = require(path.join(API, 'lib', 'tax-slab.js'));

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

console.log('— what survives the wire —');

it('⚠️⚠️ a Map becomes {} in JSON — the shape that cost the counter its tax', () => {
  const m = taxSlab.indexSlabs([{ definition_id: 'gst-5', name: 'GST 5%', rate: 5 }]);
  assert.ok(m instanceof Map, 'indexSlabs no longer returns a Map — this guard may be over');
  assert.strictEqual(JSON.stringify({ slabs: m }), '{"slabs":{}}');
});

it('⭐ the snapshot converts it, so the slabs reach the till as rows', () => {
  const src = fs.readFileSync(path.join(API, 'routes', 'till.js'), 'utf8');
  /* ⚠️ read the CODE line, not the comment above it that quotes the old broken shape — an anchor that matches prose proves nothing */
  const line = src.split(/\r?\n/).filter(function (l) { return /^\s*slabs:/.test(l); })[0] || '';
  assert.ok(/shelf\.slabs instanceof Map/.test(line), 'the snapshot sends readShelf\'s slabs without unwrapping the Map: ' + line.trim());
  assert.ok(/\[\.\.\.shelf\.slabs\.values\(\)\]/.test(line), 'and it must send the VALUES, not the Map');
});

it('⭐⭐ and a rate resolves from what the wire actually delivers', () => {
  const m = taxSlab.indexSlabs([{ definition_id: 'gst-5', name: 'GST 5%', rate: 5 },
                                { definition_id: 'gst-18', name: 'GST 18%', rate: 18 }]);
  /* exactly what the route now does, then exactly what JSON does to it */
  const onTheWire = JSON.parse(JSON.stringify({ slabs: [...m.values()] }));
  assert.strictEqual(onTheWire.slabs.length, 2, 'the slabs did not survive the crossing');
  const r = taxSlab.resolve({ item_data: { name: 'Masala', tax_slab: 'gst-5' }, face: {}, slabs: onTheWire.slabs, categories: [] });
  assert.strictEqual(r.rate, 5, 'a product citing gst-5 still has no rate after the wire');
  assert.strictEqual(r.source, 'product');
});

it('⚠️ the OLD shape resolves to nothing — which is what a shop saw, in silence', () => {
  const m = taxSlab.indexSlabs([{ definition_id: 'gst-5', name: 'GST 5%', rate: 5 }]);
  const asItWas = JSON.parse(JSON.stringify({ slabs: m }));
  const r = taxSlab.resolve({ item_data: { name: 'Masala', tax_slab: 'gst-5' }, face: {}, slabs: asItWas.slabs, categories: [] });
  assert.strictEqual(r.rate, null, 'the old shape must be shown to fail, or this test proves nothing');
  assert.strictEqual(r.unresolved, true);
  assert.strictEqual(r.cited, 'gst-5', 'and it knew which slab it could not find — nobody was reading');
});

it('a shop with no shelf at all still gets an array, never null', () => {
  const src = fs.readFileSync(path.join(API, 'routes', 'till.js'), 'utf8');
  assert.ok(src.indexOf("((shelf && shelf.slabs) || [])") > 0, 'the fallback must stay an array — the counter does .length on it');
});

it('⚠️⚠️ the snapshot says how many products the shop HAS — a delete is invisible to a delta', () => {
  const src = fs.readFileSync(path.join(API, 'routes', 'till.js'), 'utf8');
  /**
   * ⚠️ NO REGEX HERE, ON PURPOSE. This assertion was written as /^s*total:/m — the backslash of \s was eaten on its way into
   * the file, leaving a pattern that can never match, so the guard failed on correct code and would have been "fixed" by
   * deleting it. A line filter says the same thing and cannot be damaged in transit.
   */
  const carries = src.split(/\r?\n/).some((l) => l.trim().indexOf('total:') === 0);
  assert.ok(carries, 'the snapshot no longer carries a total; a hard delete becomes invisible again');
  assert.ok(src.indexOf("NOT IN ('unavailable', 'redundant', 'retired')") > 0,
    'the count must exclude exactly the blocked statuses');
});

it('⭐⭐ and that SQL agrees with isOfferable for every status a row can hold', () => {
  const itemstatus = require(path.join(API, 'lib', 'itemstatus.js'));
  /* what the SQL does, in JS: COALESCE(NULLIF(btrim(lower(status)),''),'available') NOT IN (blocked) */
  const BLOCKED = ['unavailable', 'redundant', 'retired'];
  const sqlSays = (raw) => {
    const v = String(raw == null ? '' : raw).trim().toLowerCase();
    return BLOCKED.indexOf(v === '' ? 'available' : v) < 0;
  };
  /* ⚠️ the unknown and the blank are the cases that matter: statusOf() falls back to 'available', so a row that never had the
     field IS sellable. A count that required status='available' would under-count every such row, and the counter would then
     decide its copy was wrong and re-read the whole shop on every single refresh, for ever. */
  for (const raw of ['available', 'unavailable', 'redundant', 'retired', '', null, undefined, '  AVAILABLE  ', 'Retired', 'nonsense'])
    assert.strictEqual(sqlSays(raw), itemstatus.isOfferable({ status: raw }),
      'SQL and isOfferable disagree about status ' + JSON.stringify(raw));
});

it('⭐ the counter refuses a merge that does not add up', () => {
  const page = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8');
  assert.ok(page.indexOf('snap.items.length !== snap.total') > 0,
    'the counter no longer checks its merged copy against the shop own count');
  const at = page.indexOf('snap.items.length !== snap.total');
  const after = page.slice(at, at + 400);
  assert.ok(after.indexOf('/api/till/snapshot') > 0 && after.indexOf('rebuilt') > 0,
    'on a mismatch it must take the WHOLE shop again, not patch around it');
});

/**
 * ⭐⭐ THE OFFER MUST REACH THE BILL. lib/offers-engine.js answers under the line's OWN key — line_net[l.key], and every
 * adjustment.target is l.key — so a cart that builds lines under one key and reads the answer under another gets no discount at
 * all, in silence. It happened: lineOf(c, n) passed the index while price() looked the answer up by item_id, and buy-2-get-1
 * stopped coming off. The badge on the shelf row went on promising it, because that path never consults line_net.
 */
it('⭐⭐ the cart asks the offer engine under the same key it reads the answer back with', () => {
  const page = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8');
  const fn = page.slice(page.indexOf('function price(){'), page.indexOf('function cartLineNote'));
  assert.ok(fn.indexOf('lineOf(c)') > 0, 'price() must build its lines with lineOf(c) — no index, so the key is the item_id');
  assert.ok(fn.indexOf('lineOf(c, n)') < 0, 'price() passes an index as the key: line_net[c.item_id] will never resolve');
  assert.ok(fn.indexOf('ev.line_net[c.item_id]') > 0, 'the net must still be read back by item_id');
});

/**
 * ⭐⭐ ONE DESCRIPTION OF A LINE. The row badge and the bill drifted once — only one of them carried the category — so the counter
 * promised an offer it then failed to apply. Both call lineOf(); neither may build its own.
 */
it('⭐⭐ the shelf badge and the bill are built from the same description of a line', () => {
  const page = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8');
  const off = page.slice(page.indexOf('function offersFor(i){'), page.indexOf('function offerNames'));
  assert.ok(off.indexOf('lineOf(') > 0, 'offersFor() must describe its line with lineOf(), or the badge can promise what the bill refuses');
  const src = page.slice(page.indexOf('function lineOf('), page.indexOf('function price(){'));
  for (const field of ['categories', 'sku', 'excluded'])
    assert.ok(src.indexOf(field) > 0, 'lineOf() drops ' + field + ' — an offer scoped by it can never match');
});

/**
 * ⭐⭐ "avail" IS A QUANTITY, "status" IS A LIFECYCLE — lib/itemstatus.js says so in as many words, and the counter read the wrong
 * one for a week: it compared item_data.avail (an object) against the string 'unavailable', which is always false, while the
 * server stamped item_data.status. Marking something off the shelf therefore survived exactly until the next re-read.
 */
it('⭐⭐ the counter reads the lifecycle from status, never from the quantity feed', () => {
  const page = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8');
  assert.ok(page.indexOf("i.avail === 'unavailable'") < 0,
    'the counter is comparing the avail QUANTITY feed against a status string — always false');
  assert.ok(page.indexOf('function statusOf(i){') > 0, 'the counter must have one reading of the flag');
  /* ⚠️ dspStock is the legitimate reader of avail: it wants the COUNT. Its use must survive this rule. */
  const dsp = page.slice(page.indexOf('function dspStock('), page.indexOf('function dspStock(') + 500);
  assert.ok(dsp.indexOf('a.qty') > 0, 'dspStock must still read avail as the quantity feed it is');
});

it('⭐ and the snapshot sends that status, or the flag can never travel', () => {
  const src = fs.readFileSync(path.join(API, 'routes', 'till.js'), 'utf8');
  assert.ok(src.indexOf('status: itemstatus.statusOf(d)') > 0,
    'the snapshot does not carry the lifecycle status — the counter cannot show what it cannot see');
  /* the row is on the counter at all only because the snapshot stopped filtering to sellable */
  assert.ok(src.indexOf('onTheCounter') > 0 && src.indexOf('all.filter(onTheCounter)') > 0,
    'an item marked off the shelf must stay on the counter, or it can never be put back from there');
});

/**
 * ⭐⭐ A PRODUCT NAME IS NOT AN ARITHMETIC EXPRESSION. lib/numerals.js reads 'a', 'an', 'oru' and 'ஒரு' as ONE — correct for
 * "a kg of rice", ruinous for "Probe biscuit A", which became "Probe biscuit 1" and matched nothing at all. The search box may
 * use the converted text only where it actually found a quantity.
 */
it('⭐⭐ a number-word in a product name does not make the product unfindable', () => {
  const page = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8');
  const fn = page.slice(page.indexOf('function typed(){'), page.indexOf('function hits(){'));
  assert.ok(fn.indexOf('var orig =') > 0, 'typed() must keep what was actually typed, not only the numeral-converted copy');
  assert.ok(fn.indexOf('text: orig.trim()') > 0,
    'the fall-through returns the CONVERTED text: any name ending in a, an, oru or a number-word becomes unsearchable');
  assert.ok(fn.indexOf('text: raw.trim()') < 0, 'the no-quantity branch must not hand the search a rewritten name');
  /* the two branches that DID find a quantity are the only legitimate users of the conversion */
  assert.ok(fn.indexOf('unit: String(hit[3]).toLowerCase()') > 0, 'the unit branch must still read the converted text');
});

/**
 * ⭐⭐ THE SELLING LIST SHOWS ONLY WHAT CAN BE SOLD. Athi, 2026-09-09: *"if the product is not on the shelf do not bring it here …
 * here only the products which are available."* The rows still TRAVEL in the snapshot — an item that left it entirely could never
 * be put back from the counter — but they are not listed until the "Off the shelf" chip asks for them.
 */
it('⭐⭐ the counter lists what it can sell, and off-the-shelf is a view you ask for', () => {
  const page = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8');
  const fn = page.slice(page.indexOf('function hits(){'), page.indexOf('function hits(){') + 1200);
  assert.ok(fn.indexOf("statusOf(i) !== 'unavailable'") > 0,
    'hits() does not exclude off-the-shelf rows — they would be listed among the sellable ones');
  assert.ok(fn.indexOf('FILTER.off') > 0, 'there is no way to ask for the off-the-shelf rows');
  assert.ok(page.indexOf('till-chip-off') > 0, 'the chip that asks for them is missing, so they are unreachable');
  /* ⚠️ and the count beside the list must count the same set the list shows */
  const shelf = page.slice(page.indexOf('function shelfLine('), page.indexOf('function paintHits'));
  assert.ok(shelf.indexOf("statusOf(i) !== 'unavailable'") > 0,
    'the shelf line counts every row including the unsellable ones, so it disagrees with the list under it');
});

/**
 * ⭐⭐ THE WHOLE ROW IS ONE TAP THAT ADDS. Athi, 2026-09-09: *"adding a tap was increasing the count, but it is not working
 * now?"* — because I had put a quantity stepper at the right-hand end of the row and every part of it called
 * stopPropagation(), correctly, to stop a count change billing the item. The result was a ~130 px dead strip down the right of
 * every row where tapping a product did nothing. Every probe I had written added with the keyboard, so none of them touched it.
 *
 * ⭐ The list is for CHOOSING and the bill is for AMENDING: product and price on the left, quantity on the right-hand pane.
 * The only control allowed to swallow a tap in the selling list is the shelf dot, which opens the product panel.
 */
it('⭐⭐ the left row is product details only — nothing in it can be tapped but the row', () => {
  const page = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8');
  /* ⚠️ the end anchor must be searched FROM the start of the row, and not on an inner .join either —
     offerNames(...).map(...).join('') sits INSIDE the row. The row's own closing tag is the only honest end. */
  const at = page.indexOf("return '<div class=\"hit'");
  const row = page.slice(at, page.indexOf("+ '</div>';", at));
  /**
   * Athi, settling the design 2026-09-09: *"left side is only for selection … I don't want green etc in the left side, only
   * the product details, same as what is being shown in the storefront."*
   * ⚠️ A control in this row is not merely clutter: every one of them has to stopPropagation so it does not bill the item,
   * and each is then a dead patch of row where tapping a product does nothing. That is the bug he reported.
   */
  assert.strictEqual(row.split('event.stopPropagation()').length - 1, 0,
    'something in the selling row swallows the tap — the whole row must add the product');
  for (const gone of ['qtyBox(', 'flagBtn(', 'till-back-'])
    assert.ok(row.indexOf(gone) < 0, gone + ' is back in the product row — the left side is for choosing only');
  /**
   * ⭐ THE THUMBNAIL IS THE ONE THING IN THE ROW THAT IS A CHOICE. Athi: *"can we keep the image as a toggle in the
   * maintenance screen? depends on the type of business they may need it."* A grocery recognises a packet before it reads
   * the name; a pharmacy reading strip names loses a column of the name to a picture. So it is drawn only when asked for,
   * and it is never a control — a picture that could be tapped would be the dead-strip bug again.
   */
  assert.ok(row.indexOf('thumbs ? picOf(i)') > 0, 'the thumbnail is unconditional — it must follow the shop own switch');
  assert.ok(page.indexOf('function thumbsOn(){') > 0, 'there is no setting behind the thumbnail');
  assert.ok(page.indexOf("shopLs('cb_till_thumbs')") > 0,
    'the thumbnail choice is not namespaced per shop — two shops in one browser would share it');
  assert.ok(page.slice(page.indexOf('function paintCard(){'), page.indexOf('function cardPrice(')).indexOf('thumbsToggle()') > 0,
    'the switch is not on the Maintenance screen, which is where it was asked for');
  /* what it MUST still say: the storefront's own fields */
  for (const [what, mark] of [['the name', 'esc(i.name)'], ['the unit', 'i.unit'], ['the code', 'i.code'],
                              ['the category', 'i.category'], ['its offers', 'offerNames(i)'], ['the price', 'priceBlock(i)']])
    assert.ok(row.indexOf(mark) > 0, 'the row no longer shows ' + what);
});

/**
 * ⭐⭐ SELLING NEVER TOUCHES THE CATALOGUE. Athi: *"the product maintenance cannot be on the same menu, like sell — we keep
 * another menu called maintenance … instead of price change in the menu, it will be maintenance."*
 */
it('⭐⭐ maintenance is its own operation, and selling has no way into the catalogue', () => {
  const page = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8');
  /**
   * ⭐ AND STOCK OUT GOES TOO. Athi: *"remove the stock out mode, maintenance covers it."* It was a mode that did one thing
   * to a product, and that thing is the first switch in the Maintenance panel. Two ways to mark something off the shelf is
   * two places for one decision.
   */
  assert.ok(page.indexOf("var OPS = ['sell','receive','despatch','maintain'];") > 0,
    'the operations are not sell/receive/despatch/maintain');
  for (const gone of ['<option value="price">', '<option value="stock">', 'id="pane_stock"',
                      'function paintStock(', 'function stockBack(', "getElementById('stocknote')"])
    assert.ok(page.indexOf(gone) < 0, gone + ' survives a mode that no longer exists — it can never run');
  /* ⚠️ but the WRITE stays: stockToggle is how availability changes, and the panel is now its only caller */
  assert.ok(page.indexOf('async function stockToggle(i){') > 0, 'the availability write went with the mode');
  assert.ok(page.indexOf('id="pane_maintain"') > 0, 'there is no maintenance pane for the four decisions to live in');
  /* ⚠️ and the dead screen went with the mode — paintPrice wrote into an element that no longer exists */
  for (const dead of ['function paintPrice(', 'function priceStart(', 'function priceSave(', "getElementById('pricelist')"])
    assert.ok(page.indexOf(dead) < 0, dead + ' is left over from the Price-change mode and can never run');
  /* the selling list shows only what can be sold; maintenance and stock-out see everything */
  const hits = page.slice(page.indexOf('function hits(){'), page.indexOf('function hits(){') + 1400);
  assert.ok(hits.indexOf("seeAll = (MODE === 'maintain')") > 0 && hits.indexOf("statusOf(i) !== 'unavailable'") > 0,
    'the list does not change with the operation — selling must not offer what is off the shelf');
});

/**
 * ⭐⭐ FOUR DECISIONS, ONE PLACE. Athi, 2026-09-09: *"changing availability, product price, offer enable/disable, show on TV —
 * all can be kept in the same place."* Each calls the function that already did that job; none may grow a second write.
 */
it('⭐⭐ the maintenance panel holds the four decisions and writes each through one path', () => {
  const page = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8');
  const card = page.slice(page.indexOf('function paintCard(){'), page.indexOf('function cardPrice('));
  for (const [what, mark] of [['availability', 'stockToggle(CARD)'], ['price', 'cardPrice()'],
                              ['offers', 'cardOffer('], ['the shop screen', 'cardScreen(']])
    assert.ok(card.indexOf(mark) > 0, 'the maintenance panel cannot set ' + what);
  assert.ok(page.indexOf('async function priceWrite(i, v){') > 0, 'there is no single price write');
  assert.ok(page.slice(page.indexOf('function cardPrice(){'), page.indexOf('async function cardOffer')).indexOf('priceWrite(CARD') > 0,
    'the panel does not go through the shared price write');
  /* and the wire refuses anything beyond those flags */
  const src = fs.readFileSync(path.join(API, 'routes', 'till.js'), 'utf8');
  const route = src.slice(src.indexOf("router.post('/flags'"), src.indexOf("router.post('/price'"));
  assert.ok(route.indexOf('nothing to set') > 0, '/flags accepts a body that sets nothing');
  for (const field of ['name', 'category', 'tax_slab'])
    assert.ok(route.indexOf("'" + field + "'") < 0, '/flags can write ' + field + ' — a till key must not rename the catalogue');
});

/**
 * ⭐⭐ THE QUANTITY IS AMENDED ON THE CART. Athi: *"reduce the qty in the cart by using + or − in the cart, or by a shortcut
 * key."* Repeated adds raise it; the cart's own stepper and Ctrl+arrows change it after the fact.
 */
it('⭐⭐ the cart carries the stepper and a shortcut, and a repeated add raises the count', () => {
  const page = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8');
  const rowfn = page.slice(page.indexOf('function cartRowHTML(c, k){'), page.indexOf('function paintCartRow'));
  assert.ok(rowfn.indexOf('till-minus-') > 0 && rowfn.indexOf('till-plus-') > 0, 'the cart line has no + and - buttons');
  assert.ok(rowfn.indexOf('till-qty-') > 0, 'the cart line has no typeable quantity, so 24 would be 23 taps');
  assert.ok(page.indexOf("if (e.ctrlKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown'))") > 0,
    'there is no keyboard way to change a quantity');
  /* the repeated add is what makes three of something ordinary — addItem merges by item_id */
  const addItem = page.slice(page.indexOf('function addItem(i, qty){'), page.indexOf('function addItem(i, qty){') + 500);
  assert.ok(addItem.indexOf('have.qty = r2(have.qty + n)') > 0,
    'adding the same product again no longer increases the count on the bill');
});

console.log(pass + ' checks');
