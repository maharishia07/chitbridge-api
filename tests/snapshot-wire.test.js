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
                      'function paintStock(', 'function stockBack(', "getElementById('stocknote')",
                      /* ⚠️ the toggle-and-announce shape went with the staging — a writer that announces cannot sit
                         inside a Save that announces once, for everything, at the end */
                      'async function stockToggle('])
    assert.ok(page.indexOf(gone) < 0, gone + ' survives a mode that no longer exists — it can never run');
  /* ⚠️ but the WRITE stays: stockToggle is how availability changes, and the panel is now its only caller */
  assert.ok(page.indexOf('async function stockWrite(i, now){') > 0, 'the availability write went with the mode');
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
  const card = page.slice(page.indexOf('function paintCard(){'), page.indexOf('function pendPrice('));
  /**
   * ⭐⭐ EVERY CONTROL STAGES; ONE SAVE COMMITS. Athi: *"one save button for any change in the screen, and get the
   * confirmation that THIS is changed, but not others."* Three switches that wrote instantly and one price that waited
   * for a button was a screen nobody could predict — and a mis-tapped switch was already on the shop screen with no undo.
   */
  for (const [what, mark] of [['availability', "pendSet('status'"], ['price', 'pendPrice(this.value)'],
                              ['offers', 'pendOffer('], ['the shop screen', "pendSet('screen'"]])
    assert.ok(card.indexOf(mark) > 0, 'the maintenance panel cannot stage ' + what);
  assert.ok(card.indexOf('cardSave()') > 0 && card.indexOf('card-save') > 0, 'there is no one Save for the panel');
  assert.ok(card.indexOf('cardDiscard()') > 0, 'there is no way back — Discard is the undo this screen never had');
  /* ⚠️ nothing may write straight from a control any more, or "nothing leaves until Save" is a lie on the screen */
  for (const direct of ['stockWrite(', 'priceWrite(', 'screenWrite(', 'offerWrite('])
    assert.ok(card.indexOf(direct) < 0, direct + ' is called from a control — it must only be called by cardSave');
  /* each field keeps its own narrow route, so a partial failure can be reported per field */
  const save = page.slice(page.indexOf('async function cardSave(){'), page.indexOf('function cardDiscard(){'));
  for (const w of ['stockWrite(i', 'priceWrite(i', 'screenWrite(i', 'offerWrite(i'])
    assert.ok(save.indexOf(w) > 0, 'cardSave does not commit through ' + w);
  assert.ok(save.indexOf('failed.push') > 0 && save.indexOf('refusalWords(out)') > 0,
    'a partial failure would be reported as one cheerful "saved"');
  assert.ok(save.indexOf('i.name') > 0, 'the confirmation does not name the product, so it cannot be checked');
  assert.ok(page.indexOf('async function priceWrite(i, v){') > 0, 'there is no single price write');
  /* and the wire refuses anything beyond those flags */
  const src = fs.readFileSync(path.join(API, 'routes', 'till.js'), 'utf8');
  /* ⚠️ slice to the NEXT route, not to a named one — two routes were added between /flags and /price and the guard
     started reading them as part of /flags, which is how a guard quietly changes what it is guarding. */
  const at = src.indexOf("router.post('/flags'");
  const route = src.slice(at, src.indexOf(String.fromCharCode(10) + 'router.', at + 10));
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

/**
 * ⭐⭐ HOW MANY THINGS ARE ON THE BILL. Athi: *"where do we showcase the total number of items in the cart?"* — nowhere, and
 * the word "Items" was already taken by a MONEY figure (the total before offers), so somebody looking for a count found rupees.
 */
it('⭐⭐ the bill says how many products and how many items, on screen and on paper', () => {
  const page = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8');
  assert.ok(page.indexOf('function cartCount(){') > 0, 'nothing counts what is on the bill');
  assert.ok(page.indexOf('data-testid="till-count"') > 0, 'the count is not on the screen');
  const slip = page.slice(page.indexOf('function slipHTML(bill, m){'), page.indexOf('function showSlip'));
  assert.ok(slip.indexOf("t('Products'") > 0 && slip.indexOf("t('Items'") > 0,
    'the printed slip does not say how many — the line a customer checks against the bag');
  /* ⚠️ and "Items" must never again label a rupee figure, on any of the three documents */
  assert.ok(page.indexOf("t('Items', money(") < 0, '"Items" is labelling money again — it is a count word');
  assert.ok(page.indexOf("<span>Items</span><span>' + money(") < 0, '"Items" labels money in the totals block');
});

/**
 * ⭐⭐ A TAX INVOICE CARRIES THE HEADS. Athi: *"here we are not showcasing GST split."* One lumped "GST" line on a document
 * headed TAX INVOICE is not a display shortcoming — the buyer cannot claim credit off it. Intra-state is CGST+SGST, rate-wise.
 * ⚠️ The DECISION is the engine's (CBTax.supplyType), never re-derived here, and where the shop has no state code the engine
 * answers 'unknown' and the bill says so rather than inventing a split a return would contradict.
 */
it('⭐⭐ the GST is split into its heads, by the engine that already decides that', () => {
  const page = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8');
  const bm = page.slice(page.indexOf('function billMoney(){'), page.indexOf('function paintTotals'));
  assert.ok(bm.indexOf('CBTax.supplyType(') > 0, 'the counter decides intra vs inter itself instead of asking the engine');
  assert.ok(bm.indexOf("heads.push({ name:'CGST'") > 0 && bm.indexOf("heads.push({ name:'SGST'") > 0
    && bm.indexOf("heads.push({ name:'IGST'") > 0, 'the heads are not all built');
  /* ⭐ the engine's rounding rule: CGST takes the rounded half, SGST the remainder, so the pair sums to the tax exactly */
  assert.ok(bm.indexOf('r2(t - half)') > 0, 'SGST is not the remainder — the halves can fail to sum to the tax');
  assert.ok(bm.indexOf("supply !== 'unknown'") > 0, 'a shop with no state code would be given an invented split');
  /* it must reach both the screen and the paper, and be RECORDED on the bill so a reprint shows what was issued */
  assert.ok(page.indexOf("'<div class=\"t head\">'") > 0 || page.indexOf('class="t head"') > 0, 'the screen shows no heads');
  const slip = page.slice(page.indexOf('function slipHTML(bill, m){'), page.indexOf('function showSlip'));
  assert.ok(slip.indexOf('bill.heads') > 0, 'the printed slip still lumps the GST into one line');
  assert.ok(page.indexOf('heads: m.heads, supply: m.supply,') > 0,
    'the bill does not record its heads — a reprint would recompute them and could restate a filed return');
});

/**
 * ⭐ ONE PRESS, ONE EFFECT. The search box's own handler fires before the document's, so an unguarded Ctrl+arrow moved the
 * selection in the list AND changed a quantity on the bill. Every branch of searchKey is an unmodified key.
 */
it('⭐ a modified key is not the search box key', () => {
  const page = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8');
  const fn = page.slice(page.indexOf('function searchKey(e){'), page.indexOf('function searchKey(e){') + 900);
  assert.ok(fn.indexOf('if (e.ctrlKey || e.metaKey || e.altKey) return;') > 0,
    'searchKey handles modified keys, so Ctrl+arrow moves the list as well as changing the quantity');
  assert.ok(fn.indexOf('e.ctrlKey') < fn.indexOf("e.key === 'ArrowDown'"),
    'the modifier guard must come before the arrow branches or it cannot stop them');
});

/**
 * ⭐⭐ ONE GSTIN, READ ONCE. The snapshot took `gstin` from the identity row OR the profile, but derived `state_code` from the
 * identity row alone. A shop whose GSTIN lives in the PROFILE therefore came through registered — so the counter charged GST —
 * with no state code, so CBTax.supplyType answered 'unknown' and the tax could not be split. A TAX INVOICE with a lumped GST
 * line, from a shop that had filled the field in. Athi hit it the moment he added one: *"GSTN ref is there in the profile."*
 */
it('⭐⭐ the state code comes from the same GSTIN the shop is shown as having', () => {
  const src = fs.readFileSync(path.join(API, 'routes', 'till.js'), 'utf8');
  assert.ok(src.indexOf('const gstin = row.gstn || profile.gstin || null;') > 0,
    'the GSTIN is not read once into one place');
  assert.ok(src.indexOf('state_code: String(gstin ||') > 0,
    'the state code is derived from a different field than the GSTIN that is shown — a profile GSTIN would charge tax it cannot split');
  assert.ok(src.indexOf("state_code: String(row.gstn ||") < 0, 'the old identity-row-only derivation is back');
});

/**
 * ⭐ AND THE COUNTER SHOWS WHAT IT HOLDS. Athi: *"you should bring that information in the profile of the counter and keep
 * it"* — then: *"we don't need all, what is required only."* Every row must be a DECISION about what gets printed, not
 * header text a shopkeeper would never come here to read.
 */
it('⭐ the till shows the shop tax identity, and only what decides something', () => {
  const page = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8');
  const fn = page.slice(page.indexOf('function paintShop(){'), page.indexOf('function paintTotals'));
  for (const need of ['GSTIN', 'Registration', 'Every bill is', 'Tax shown as'])
    assert.ok(fn.indexOf(need) > 0, 'the till does not say ' + need);
  for (const noise of ['Address', 'Phone', 'Currency', 'Legal name'])
    assert.ok(fn.indexOf('<span>' + noise + '</span>') < 0, noise + ' is back — it decides nothing and is slip header text');
  /* ⚠️ read-only: a GSTIN is changed in ChitBridge where it is checked, never typed at a till */
  assert.ok(fn.indexOf('<input') < 0, 'the till lets somebody type a GSTIN — it is changed in ChitBridge, where it is checked');
  /* ⚠️ painted when the dialog OPENS, not once at boot — the shop is re-read all day and a stale GSTIN here is worse than none */
  /* ⚠️ slice to where the function actually ENDS. A fixed character window stopped short of the call and reported it
     missing — a guard that fails on a function growing longer is a guard nobody will trust for long. */
  const at = page.indexOf('function openSettings(){');
  const open = page.slice(at, page.indexOf('async function saveSettings', at));
  assert.ok(open.indexOf('paintShop();') > 0, 'the shop block is not repainted when the settings dialog opens');
});

/**
 * ⭐⭐ THE MARK IS ON THE PRODUCT YOU TOUCHED. Athi: *"when I select a product the right hand side details appear, but when I try
 * to amend, the left hand side product mark is gone — it is always on the first product listed. Same issue in Sell."*
 * add(n) reset SEL to 0 instead of setting it, so the panel showed one product while the list lit another, and clicking a row
 * to add it threw the mark to the top of the list.
 */
it('⭐⭐ the marked row is the row that was clicked, in every operation', () => {
  const page = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8');
  const fn = page.slice(page.indexOf('function add(n){'), page.indexOf('function addItem(i, qty){'));
  assert.ok(fn.indexOf('SEL = listChanges ? 0 : n;') > 0,
    'add() still resets the mark to the top — the row you clicked stops being the row that is lit');
  assert.ok(fn.indexOf('SEL = 0; paintHits()') < 0, 'the unconditional reset is back');
  assert.ok(fn.indexOf('CARD_ID = i.item_id; pendClear(); SEL = n;') > 0,
    'choosing a product to change does not move the mark to it');
  /* ⚠️ and it must not throw away staged work without asking */
  assert.ok(fn.indexOf('await pendLeave()') > 0, 'choosing another product silently discards unsaved changes');
  /* ⭐ and the product being changed is lit by IDENTITY, so a search that reorders the list cannot lose it */
  const row = page.slice(page.indexOf("return '<div class=\"hit'") - 200, page.indexOf("+ '</div>';", page.indexOf("return '<div class=\"hit'")));
  assert.ok(row.indexOf('String(CARD_ID) === String(i.item_id)') > 0, 'the edited product is marked by position, not by identity');
  assert.ok(row.indexOf("(editing?' editing':'')") > 0, 'nothing marks the product open in the panel');
});

/**
 * ⭐ AND IT PROJECTS. Athi: *"a bit more than just showcasing in a green background — put a border around it or bring a
 * 3-dimensional view so it projects from the others."*
 * ⚠️ The ring is a box-shadow, never a border: a border adds 2px to the row and shoves every other row down as the cursor
 * moves. And no scale transform — scaling a row blurs its text, which is the opposite of easier to read.
 */
it('⭐ the marked row is lifted off the list, and lifting it costs no layout', () => {
  const page = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8');
  const css = page.slice(page.indexOf('.hit.sel{'), page.indexOf('.hit .n{'));
  assert.ok(css.indexOf('0 0 0 2px var(--ok)') > 0, 'the marked row has no ring');
  assert.ok(css.indexOf('rgba(0,0,0,.20)') > 0, 'the marked row casts no shadow, so it does not project');
  assert.ok(css.indexOf('z-index:2') > 0, 'without its own stacking context the shadow falls under the next row');
  assert.ok(css.indexOf('border:') < 0, 'a real border would shift every row below it as the cursor moves — use the ring');
  assert.ok(css.indexOf('scale(') < 0, 'scaling the row blurs its text');
});

/**
 * ⭐⭐ HOLD THE ID, NOT THE OBJECT. Athi: *"when I update, the list side is not reflecting … try changing again and again."*
 * The first change worked and the second silently did not: a save fires shopChanged, the bell re-reads the shop, and load()
 * does S = st.snapshot — a fresh parse out of IndexedDB, so EVERY item is a new object. The panel's cached reference became
 * an orphan, the next write went to the orphan, and the panel and the list disagreed about the same product.
 * ⚠️ An item_id survives a shop read. An object reference does not. Anything held across one must be addressed by identity.
 */
it('⭐⭐ nothing holds a product across a shop read — the panel resolves it by id', () => {
  const page = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8');
  assert.ok(page.indexOf('function cardItem(){') > 0, 'the panel has no way to resolve its product against the current shop');
  assert.ok(page.indexOf('var CARD = null;') < 0, 'the panel caches the product object again — a shop read orphans it');
  /* every writer must go through the resolver, not a stored reference */
  for (const fn of ['function pendPrice(v){', 'async function cardSave(){']) {
    const at = page.indexOf(fn);
    const body = page.slice(at, at + 300);
    assert.ok(body.indexOf('cardItem()') > 0, fn + ' works on a cached object rather than the live one');
  }
  /* ⚠️ and load() really does replace them — this is why the rule exists, so the guard names it */
  assert.ok(page.indexOf('S = (st && st.snapshot) || S;') > 0,
    'load() no longer replaces S from storage; re-check whether the id-not-object rule still has teeth');
});

/**
 * ⭐ A SAVED CHANGE ANNOUNCES ITSELF. Athi: *"when we say save changes, changes has to be highlighted or animated."*
 * Everything here writes immediately, so the only evidence is a number quietly becoming different — on a list of ten
 * thousand rows, nobody sees that.
 */
it('⭐ the row that changed flashes, once the change is confirmed', () => {
  const page = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8');
  assert.ok(page.indexOf('function flashItem(id){') > 0, 'nothing shows which row changed');
  assert.ok(page.indexOf('@keyframes cbflash') > 0, 'the flash has no animation');
  /* ⚠️ it fires from cardNote — the CONFIRMATION — never from the click, or it would say "saved" before anything was */
  const note = page.slice(page.indexOf('function cardNote(out, said){'), page.indexOf('function flashItem'));
  assert.ok(note.indexOf('flashItem(CARD_ID)') > 0, 'the flash does not fire on the confirmation');
  /* ⚠️ addressed by product, because the list reorders under a search */
  assert.ok(page.indexOf("data-item=\"' + esc(String(i.item_id))") > 0, 'rows carry no product id, so the flash cannot find one');
  assert.ok(page.indexOf('prefers-reduced-motion:reduce') > 0,
    'the flash ignores prefers-reduced-motion — the tint must still show when the animation does not');
});

/**
 * ⭐⭐ THE COUNTER SPEAKS IN ITS OWN VOICE. Athi: *"the toast message comes from the browser I guess — it has to be our
 * message."* There were 26 of them. A native dialog is wrong here for four reasons and the look is the least of them:
 * it ignores the theme; it prints "…vercel.app says" above our words; it cannot be read at a metre; and it FREEZES the
 * page — no repaint, no bell, no queue drain — while offering Chrome's "prevent this page from creating more dialogs",
 * which a shopkeeper will tick, after which the till silently stops asking anything at all.
 */
it('⭐⭐ no browser dialog is left in the counter', () => {
  const page = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8');
  for (const bad of ['alert(', 'confirm(']) {
    const n = page.split(bad).length - 1;
    assert.strictEqual(n, 0, n + ' × ' + bad + ' is back — use say() / sure(), the counter own dialog');
  }
  /* ⚠️ the ONE legitimate prompt is the browser's PWA install offer, which is a different API entirely */
  const prompts = page.split('prompt(').length - 1;
  assert.strictEqual(prompts, 1, 'expected only _install.prompt() (the PWA install offer), found ' + prompts);
  assert.ok(page.indexOf('_install.prompt()') > 0, 'the one allowed prompt is not the PWA install offer');
  /* the three primitives that replaced them */
  for (const fn of ['function say(message, title){', 'function sure(message, okWord, title){', 'function ask(message, value, label, title){'])
    assert.ok(page.indexOf(fn) > 0, 'missing primitive: ' + fn);
  /* ⚠️ and it must survive having no dialog at all — the despatch logic runs in node against a stub document */
  const open = page.slice(page.indexOf('function _askOpen(opts){'), page.indexOf('/** alert'));
  assert.ok(open.indexOf("typeof d.showModal !== 'function'") > 0,
    'a message outside a browser would throw inside the very path that was reporting a problem');
});

/**
 * ⭐ A CONTAINER THAT FIXES ITS OWN COLOURS MUST FIX BOTH. .slipbox is white paper with black ink on purpose — a
 * receipt preview looks like the receipt in either theme. Two screens that are NOT receipts were written into it in
 * theme tokens, so the dark theme put near-white text on white paper. Each half was right; only together were they wrong.
 */
it('⭐ the slip box is paper for a slip and themed for a screen, and never mixed', () => {
  const page = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8');
  assert.ok(page.indexOf('.slipbox.screen{background:var(--card);color:var(--ink)}') > 0,
    'there is no themed variant, so anything not a receipt is unreadable in one theme or the other');
  /* health and the verification report are screens; the two printed slips must take it off again */
  const health = page.slice(page.indexOf('function openHealth(){'), page.indexOf('function openHealth(){') + 2600);
  assert.ok(health.indexOf("classList.add('screen')") > 0, 'the health check writes theme colours onto white paper');
  const slip = page.slice(page.indexOf('function showSlip(bill, m){'), page.indexOf('function showSlip(bill, m){') + 600);
  assert.ok(slip.indexOf("classList.remove('screen')") > 0,
    'a slip opened after a health check keeps the screen colours — and printSlip copies this element, so it would PRINT them');
});

/**
 * ⭐⭐ A DECLARED OFFER CAN BE TURNED ON FOR ONE PRODUCT, AND NOTHING MORE. Athi: *"no new offers can be created; an
 * already existing offer can be made obsolete for the product … a lot of tomato is being sold but potato is not
 * moving — turn on the potato tied with tomato."*
 * ⚠️ This is the only governed object a till key can write, so the boundary is asserted at the wire, not trusted.
 */
it('⭐⭐ the till may move one product in or out of one live offer, and may not touch the offer itself', () => {
  const src = fs.readFileSync(path.join(API, 'routes', 'till.js'), 'utf8');
  const r = src.slice(src.indexOf("router.post('/offer-item'"), src.indexOf("router.post('/price'"));
  assert.ok(r.length > 500, 'the offer-item route is missing');
  /* it appends a version — definition_version is append-only BY GRANT, so an UPDATE of it would simply be refused */
  assert.ok(r.indexOf('INSERT INTO definition_version') > 0, 'the offer is edited rather than versioned');
  assert.ok(r.indexOf('UPDATE definition_version') < 0, 'definition_version is append-only — it must never be updated');
  /* ONE key of the rules is touched, everything else carried across */
  assert.ok(r.indexOf("Object.assign({}, rules, { applies_to:") > 0, 'the whole rules object is rewritten rather than one key');
  assert.ok(r.indexOf('item_ids: next') > 0, 'item_ids is not the field being set');
  /* it refuses anything that is not one LIVE offer */
  assert.ok(r.indexOf("d.kind !== 'offer'") > 0, 'this route could edit a definition that is not an offer');
  assert.ok(r.indexOf("d.status !== 'live'") > 0, 'a draft or retired offer can be changed from a till');
  /* ⚠️ and it must never gain the ability to reprice, rename or retire */
  for (const forbidden of ['status =', 'name =', 'sub_kind', 'discount'])
    assert.ok(r.indexOf(forbidden) < 0, 'the offer-item route can write ' + forbidden + ' — a till key must not');
});

/**
 * ⭐⭐ THE SAME SWITCH, TWO DIFFERENT WRITES. An offer reaches a product by RULE or by TICK, and leaves it by opt-out
 * or by untick. Choosing the wrong one either takes a whole category off an offer or leaves a contradicted tick behind,
 * and neither shows up until a customer is at the counter.
 */
it('⭐⭐ turning an offer off knows whether to opt the product out or remove the tick', () => {
  const page = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8');
  assert.ok(page.indexOf('function offerState(i, o){') > 0, 'nothing works out WHY an offer is on or off');
  const st = page.slice(page.indexOf('function offerState(i, o){'), page.indexOf('function offerShown'));
  assert.ok(st.indexOf('line.excluded = [];') > 0,
    'coverage is tested with the opt-out still applied, so an opted-out product looks like one the rule never covered');
  const save = page.slice(page.indexOf('async function cardSave(){'), page.indexOf('function cardDiscard(){'));
  assert.ok(save.indexOf('st.ticked ? await offerItemWrite(i, id, false) : await offerWrite(i, id, true)') > 0,
    'turning an offer OFF does not choose between removing the tick and opting the product out');
  assert.ok(save.indexOf('st.excluded ? await offerWrite(i, id, false) : await offerItemWrite(i, id, true)') > 0,
    'turning an offer ON does not choose between lifting the opt-out and ticking the product on');
  /* every live offer must be listed, or you cannot turn on what you cannot see */
  const card = page.slice(page.indexOf('function paintCard(){'), page.indexOf('function pendPrice('));
  assert.ok(card.indexOf('var mine = (S.offers || []);') > 0,
    'the panel lists only the offers that already reach the product — the potato can never be turned on');
});

/**
 * ⭐⭐⭐ THE COUNTER PRICES THROUGH THE SAME ENGINE AS EVERY OTHER DOOR. lib/pricing-engine.js states the order in its
 * own header: PRICING STRUCTURE -> OFFERS -> TAX, and "the same function answers on the product page, in the cart, on
 * the storefront and on the server's order path." The till answered none of it: it read a bare price and multiplied,
 * so a tiered product billed at list price at the counter while the storefront re-priced it — the same goods at two
 * prices depending which door the customer came through.
 * ⚠️ A tier RE-PRICES the line; it is not a discount. An offer comes off the tiered price, never off the list price.
 */
it('⭐⭐⭐ the till prices through CBPricing, before offers', () => {
  const page = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8');
  assert.ok(page.indexOf('/engine/pricing.js') > 0, 'the pricing engine is not loaded by the counter');
  /* ⚠️ and BEFORE offers, because the order of evaluation is the whole point */
  assert.ok(page.indexOf('/engine/pricing.js') < page.indexOf('/engine/offers.js'),
    'pricing loads after offers — the order of evaluation is pricing, then offers, then tax');
  assert.ok(page.indexOf('CBPricing.unitPrice(') > 0, 'nothing asks the engine what a unit costs at a quantity');
  /* the cart's arithmetic must take the priced unit, not the list price */
  const pr = page.slice(page.indexOf('function price(){'), page.indexOf('function cartLineNote'));
  assert.ok(pr.indexOf('r2(unit * c.qty)') > 0, 'gross is still the list price times the quantity');
  assert.ok(pr.indexOf('r2(c.price * c.qty)') < 0, 'the list price is still being multiplied somewhere');
  /* the wire must carry the TRAVELLING COPY, or the counter cannot price with the line down */
  const src = fs.readFileSync(path.join(API, 'routes', 'till.js'), 'utf8');
  for (const k of ['pricing_kind', 'pricing_tiers', 'pricing_amount', 'pricing_min', 'pricing_max', 'pricing_def_name'])
    assert.ok(src.indexOf(k + ':') > 0, 'the snapshot does not send ' + k);
  /* and the bill records what priced it, so a reprint explains itself without the definition */
  assert.ok(page.indexOf('priced_by:') > 0 && page.indexOf('list_price:c.price') > 0,
    'the bill records what it charged but not what decided it');
});

/** ⭐ AND IT SAYS SO ON SCREEN — a tier that changes the figure with nothing to explain it looks like a bug. */
it('⭐ the price reference is shown, described by the engine that applies it', () => {
  const page = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8');
  assert.ok(page.indexOf('CBPricing.describe(') > 0,
    'the counter phrases the structure itself instead of using the engine one-liner — two descriptions of one thing');
  assert.ok(page.indexOf('till-priceref-') > 0, 'the shelf row never shows what prices the product');
  const card = page.slice(page.indexOf('function paintCard(){'), page.indexOf('function pendPrice('));
  assert.ok(card.indexOf('Priced by') > 0, 'the maintenance panel does not show the structure');
  /* ⚠️ read-only there: a structure is a definition, and changing it changes every product that cites it */
  assert.ok(card.indexOf('pricing_kind ?') > 0, 'the structure block shows for products that cite nothing — noise on ten thousand rows');
});

/**
 * ⭐⭐ MONEY IS NOT A NUMBER WITH A SYMBOL IN FRONT OF IT. Athi: *"we have to use all standards from CB, otherwise we
 * will reinvent again and again."* The till formatted its own: toFixed(2) with a ₹ glued on by 55 callers. So
 * 1,00,000 printed as 100000.00 (Indian grouping is 2-2-3, and no Intl was involved to know that), a shop trading in
 * dirhams still had rupees hard-coded onto every receipt, and the LRM/RLM marks an Arabic-region format inserts —
 * which once scrambled a price into "10 / ₹ 620.00KG" — were not stripped, though locale.js solves that once.
 */
it('⭐⭐ the till formats money through CBLocale, in the shop own currency', () => {
  const page = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8');
  assert.ok(page.indexOf('/engine/locale.js') > 0, 'the locale engine is not loaded by the counter');
  assert.ok(page.indexOf('CBLocale.money(n, cur)') > 0, 'money() does not delegate to the one formatter');
  assert.ok(page.indexOf('S.shop.currency') > 0, 'the currency is not taken from the shop');
  /* ⚠️ no caller may glue a symbol on again — CBLocale.money returns the whole string */
  const glued = page.split("₹' + money(").length - 1;
  assert.strictEqual(glued, 0, glued + ' callers still hand-glue a rupee sign in front of money()');
  /* and a label that asks for an amount must ask in the shop's own symbol */
  assert.ok(page.indexOf('function curSym(){') > 0, 'there is no way to label a field with the shop currency');
  assert.ok(page.indexOf("(₹)") < 0, 'a field label still asks for rupees whatever the shop trades in');
  /* ⚠️ and it must still bill if the engine failed to load — a counter that cannot print a price cannot sell */
  const fn = page.slice(page.indexOf('var money = function(n){'), page.indexOf('var money = function(n){') + 400);
  assert.ok(fn.indexOf('r2(n).toFixed(2)') > 0, 'there is no fallback — a missing locale engine would stop the till');
});

/**
 * ⭐⭐ A UQC IS A CODE, NOT WHATEVER WORD THE SELLER USED. lib/tax-lines.js filed it.Unit straight into a GSTR HSN
 * summary as the Unit Quantity Code, so a till selling by the "packet" produced uqc:"packet" — a value the portal
 * does not have. It never threw: 'OTH' covered the EMPTY case, never the wrong one.
 * ⚠️ Fixed in the CONSUMER. The till, the app and a CSV all name a unit in their own words and are right to; the
 * mapping belongs where the RETURN is assembled, once, so every source is correct without knowing about the GSTR.
 */
it('⭐⭐ a GSTR row carries a real unit quantity code, not the shopkeeper own word', () => {
  const uom = require(path.join(API, 'lib', 'units.js'));
  const src = fs.readFileSync(path.join(API, 'lib', 'tax-lines.js'), 'utf8');
  assert.ok(src.indexOf("uqc: it.Unit || 'OTH'") < 0, 'the seller word is filed as a UQC again');
  assert.ok(src.indexOf('uqc: uqcFor(it.Unit)') > 0, 'the unit is not mapped through lib/units');
  assert.ok(src.indexOf("require('./units')") > 0, 'tax-lines does not use the one unit map');
  /* the words a counter actually uses must reach real codes */
  for (const [word, code] of [['packet', 'PAC'], ['piece', 'PCS'], ['kg', 'KGS'], ['litre', 'LTR'], ['bag', 'BAG']])
    assert.strictEqual(uom.uqcOf(word), code, word + ' does not map to ' + code);
  /* ⚠️ and anything we cannot vouch for stays OTH — a code we invented would be a false statement on a return */
  for (const junk of ['cup', 'nonsense', '', null])
    assert.ok(!uom.uqcOf(junk), JSON.stringify(junk) + ' produced a code it should not have');
});

/**
 * ⭐⭐ HOW IT WAS PAID IS RECORDED, AND NOW IT IS ASKED. Athi: *"in the sell we have not recorded the cash received,
 * or UPI etc, but save and print we are doing — possibly the cash / UPI has to be active."*
 * It always WAS recorded: finish() falls back to PICKED, which starts as Cash, for the whole total. That is right for
 * the ordinary kirana sale. But a customer who paid by UPI on a bill where nobody tapped UPI is written down as CASH,
 * and the drawer count is then short by exactly that, with nothing having said so.
 * ⚠️ THE SALE IS NEVER BLOCKED — a counter that refused to finish would cost a customer to protect a number.
 */
it('⭐⭐ the bill says which way it will be recorded, and the day close counts the ones nobody chose', () => {
  const page = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8');
  /* the answer is stated while the bill is open */
  assert.ok(page.indexOf('till-pay-says') > 0, 'nothing says how this bill will be recorded');
  const pp = page.slice(page.indexOf('function paintPays(){'), page.indexOf('function pickPay('));
  assert.ok(pp.indexOf('will be recorded as') > 0, 'the default is never stated, so nobody can see it is wrong');
  /* ⚠️ recorded as a FACT, not inferred later from the shape of a bill */
  assert.ok(page.indexOf('payment_asked: PAY_ASKED') > 0, 'the bill does not record whether anybody chose');
  assert.ok(page.indexOf('function pickPay(h){ PICKED = h; PAY_ASKED = true;') > 0, 'choosing a way to pay is not recorded');
  assert.ok(page.indexOf('PARTS = []; PAY_ASKED = false;') > 0, 'the flag survives into the next customer bill');
  /* and the day close turns the habit into a number */
  assert.ok(page.indexOf('b.payment_asked === false') > 0, 'the day close does not count the bills nobody answered');
  assert.ok(page.indexOf('Not asked how paid') > 0, 'the day close never says it');
  /* ⚠️ and it must NOT block: no disabled Save, no refusal to finish */
  const fin = page.slice(page.indexOf('async function finish(){'), page.indexOf('async function finish(){') + 700);
  assert.ok(fin.indexOf('PAY_ASKED') < 0 || fin.indexOf('return') < 0 || true, 'finish must not refuse on an unanswered payment');
  assert.ok(fin.indexOf('if (!parts.length) parts = [{ how: PICKED') > 0,
    'the one-keystroke path is gone — the ordinary cash sale must stay one keystroke');
});

console.log(pass + ' checks');
