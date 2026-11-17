/**
 * cart-ui.test.mjs — the ONE cart helper (public/app/cart-ui.js).
 *
 * Athi, 2026-08-08: *"it has to be one helper and should be used everywhere."*
 *
 * Because it is one helper, a bug here is a bug in all four ordering screens at once — Compose, Suppliers, Network
 * store catalogues, and the public storefront. That is the trade: one place to fix, one place to break. So the
 * cases that matter are the ones a screen could not catch on its own.
 *
 * Run:  node scripts/cart-ui.test.mjs
 * ⚠️ ESM, imported for SIDE EFFECTS — both files are browser files that attach to `window`; under this package's
 * "type": "module" they land on globalThis, which is what a browser would give them too.
 */
/* the unit table — UNIT_KINDS is what tells a continuous unit from a countable one */
await import('../public/app/catalogue-model.js');
await import('../public/app/catalogue-lines.js');   // the walk cart-ui builds on
/* ⚠️ cart-ui.js became part of cart.js in bf14516 and this import was not repointed, so the file threw
   ERR_MODULE_NOT_FOUND before its first assertion — red in the suite, and silent about which of the cart's
   rules had stopped being checked. CBCart is still the global; only the file moved. */
await import('../public/app/cart.js');
const K = globalThis.CBCart;

let failed = 0;
const ok = (name, cond) => { if (cond) console.log('  ok   ' + name); else { failed++; console.log('  FAIL ' + name); } };

const cat = {
  shop: { bridge_id: 'B1' },
  items: [
    { item_id: 'a', item_data: { name: 'Tussar Emulsion', unit: 'L', price: 950 } },
    { item_id: 'b', item_data: { name: 'Tussar Emulsion', unit: 'L', price: 3400 } },
    { item_id: 'c', item_data: { name: 'Primer Base', unit: 'L', price: 650 } },
    { item_id: 'd', item_data: { name: 'Wall Putty', unit: 'bag' } },          // no price, on purpose
  ],
  groups: [{ label: 'Tussar Emulsion', lines: [{ item_id: 'a', variant: '1L' }, { item_id: 'b', variant: '4L' }] }],
};

console.log('\ncart-ui · the stepper');
K.init('t', cat);
K.add('t', 'a'); K.add('t', 'a'); K.add('t', 'c');
ok('★ + again raises the QUANTITY, it does not add a second line', K.lines('t') === 2 && K.qtyOf('t', 'a') === 2);
ok('lines and units are different numbers', K.units('t') === 3);
ok('the total multiplies out', K.total('t').amount === 950 * 2 + 650);
K.dec('t', 'a');
ok('− lowers it', K.qtyOf('t', 'a') === 1);
K.dec('t', 'a');
ok('★★ the last − removes the line — never a cart entry worth zero', K.qtyOf('t', 'a') === 0 && K.lines('t') === 1);
K.setQty('t', 'a', '4');
ok('a typed quantity is taken', K.qtyOf('t', 'a') === 4);
K.setQty('t', 'a', '0');
ok('★ typing 0 removes the line', K.lines('t') === 1);
K.setQty('t', 'a', 'abc');
ok('★ nonsense never creates a line', K.lines('t') === 1);

console.log('\ncart-ui · a total that cannot be trusted says so');
K.add('t', 'd');
const T = K.total('t');
ok('★★ an unpriced line makes the total PARTIAL, not silently smaller', T.amount === 650 && T.partial === true);
K.dec('t', 'd');

console.log('\ncart-ui · search is a view, the cart is not');
K.search('t', 'primer');
ok('the list narrows', K.rows('t').filter((r) => r.type === 'line').length === 1);
ok('★★ filtering does NOT remove what it hides from the cart', K.lines('t') === 1);
K.search('t', '4l');
ok('a matched variant keeps its heading, so it is never shown without context',
   K.rows('t').filter((r) => r.type === 'product').length === 1);
K.search('t', 'zzz');
ok('a search matching nothing returns nothing (the screen says so)', K.rows('t').length === 0);
K.search('t', '');
ok('★ clearing the search restores the FULL list — the cart is a popup, not a filter',
   K.rows('t').filter((r) => r.type === 'line').length === 4);

console.log('\ncart-ui · add-all on a heading');
K.clear('t');
K.group('t', 0);
ok('★★ it adds ONLY its own group — not the ungrouped products appended after it', K.lines('t') === 2);
ok('★ and ONE of each, never a quantity nobody asked for', K.units('t') === 2);
K.group('t', 0);
ok('pressing it again clears the group', K.lines('t') === 0);

console.log('\ncart-ui · the cart survives a repaint, and only a repaint');
K.add('t', 'c');
K.init('t', cat);
ok('★★ re-initialising on the SAME catalogue keeps the cart', K.lines('t') === 1);
K.init('t', { shop: { bridge_id: 'B2' }, items: [] });
ok('★ a different catalogue starts an empty cart', K.lines('t') === 0);

console.log('\ncart-ui · what leaves the cart');
K.init('t', cat);
K.add('t', 'a'); K.add('t', 'a'); K.add('t', 'c');
const sel = K.selected('t');
ok('★ a variant carries its parent name — "1L" alone is not an order line',
   sel.some((l) => l.name === 'Tussar Emulsion 1L'));
ok('★ the quantity travels with the line', sel.find((l) => l.item_id === 'a').qty === 2);
ok('an ungrouped product keeps its own name', sel.some((l) => l.name === 'Primer Base'));

console.log('\ncart-ui · checkout hands over, it does not decide');
let handed = null;
K.init('t', cat, { onCheckout: (items, tot) => { handed = { items, tot }; } });
K.clear('t');            // …and re-init KEPT the previous cart, which is the rule two sections up. Start clean.
K.add('t', 'c');
K.checkout('t');
ok('★ the caller receives the lines and the total, and decides what happens next',
   handed && handed.items.length === 1 && handed.tot.amount === 650);
ok('★ opening an EMPTY cart does nothing — there is nothing to review', (K.clear('t'), K.open('t'), K.state('t').open === false));

/* ══════════════════════════════════════════════════════════════════════════════════════════════════════════════
   ORDER MODELS — each one checked on its own.

   Athi, 2026-08-08: *"if you apply different cart type like range and so on, can you check each one how it works,
   so you have the cart model picker as a single source."*

   Every model is driven through the SAME three doors a person has — the +, the −, and the typed box. A rule that
   only holds when you step it is not a rule; it is a coincidence that the typed box will break.
   ══════════════════════════════════════════════════════════════════════════════════════════════════════════════ */
const modelCat = { shop: { bridge_id: 'M1' }, items: [
  { item_id: 'm_count',   item_data: { name: 'Paint tin', unit: 'tin', price: 100 } },
  { item_id: 'm_measure', item_data: { name: 'Sand',  unit: 'kg', price: 20, order: { model: 'measure', step: 0.5 } } },
  { item_id: 'm_pack',    item_data: { name: 'Bolts', unit: 'box', price: 12, order: { model: 'pack', step: 12 } } },
  { item_id: 'm_range',   item_data: { name: 'Cable', unit: 'm', price: 9, order: { model: 'range', min: 5, max: 500, step: 5 } } },
  { item_id: 'm_pick',    item_data: { name: 'Site survey', unit: 'visit', price: 2500, order: { model: 'pick' } } },
  { item_id: 'm_offer',   item_data: { name: 'Reclaimed teak', unit: 'cft', price: 900,
                                       order: { model: 'offer', price_min: 700, price_max: 1100 } } },
] };

console.log('\ncart-ui · model: count (the default)');
K.init('m', modelCat);
K.add('m', 'm_count'); K.add('m', 'm_count');
ok('+ adds one whole unit', K.qtyOf('m', 'm_count') === 2);
K.setQty('m', 'm_count', '2.7');
ok('★ a decimal is floored — 2.7 tins is not a thing', K.qtyOf('m', 'm_count') === 2);

console.log('\ncart-ui · model: measure (a decimal amount)');
K.add('m', 'm_measure');
ok('the first press lands on one declared step', K.qtyOf('m', 'm_measure') === 0.5);
K.add('m', 'm_measure');
ok('★ it steps by the DECLARED step, not by 1', K.qtyOf('m', 'm_measure') === 1);
K.setQty('m', 'm_measure', '2.25');
ok('★ 2.25 kg is a legal order and is kept exactly', K.qtyOf('m', 'm_measure') === 2.25);
K.setQty('m', 'm_measure', '0.1'); K.add('m', 'm_measure');
ok('★ no floating-point dust — 0.1 + 0.5 stays 0.6', K.qtyOf('m', 'm_measure') === 0.6);

console.log('\ncart-ui · model: pack (sold in multiples)');
K.add('m', 'm_pack');
ok('★ the first press is one PACK, not one item', K.qtyOf('m', 'm_pack') === 12);
K.add('m', 'm_pack');
ok('the next press is another pack', K.qtyOf('m', 'm_pack') === 24);
K.setQty('m', 'm_pack', '13');
ok('★★ 13 becomes a legal pack — the multiple IS the unit of sale', K.qtyOf('m', 'm_pack') % 12 === 0);
K.setQty('m', 'm_pack', '30');
ok('30 lands on a legal pack', K.qtyOf('m', 'm_pack') % 12 === 0);
K.setQty('m', 'm_pack', '0');
ok('and it can be emptied, never left as a part-pack', K.qtyOf('m', 'm_pack') === 0);

console.log('\ncart-ui · model: range (a declared minimum and maximum)');
K.add('m', 'm_range');
ok('★ the first press lands ON the minimum, not on 1', K.qtyOf('m', 'm_range') === 5);
K.setQty('m', 'm_range', '3');
ok('★★ BELOW the minimum is REFUSED — never silently raised to 5', K.qtyOf('m', 'm_range') === 0);
K.setQty('m', 'm_range', '9999');
ok('★ above the maximum IS clamped — a ceiling may clamp where a floor may not', K.qtyOf('m', 'm_range') === 500);
K.setQty('m', 'm_range', '120');
ok('a value inside the band is kept as typed', K.qtyOf('m', 'm_range') === 120);

console.log('\ncart-ui · model: pick (one or none)');
K.add('m', 'm_pick');
ok('adding it puts exactly one in', K.qtyOf('m', 'm_pick') === 1);
K.add('m', 'm_pick');
ok('★★ pressing again does NOT make it two — one survey cannot be had twice', K.qtyOf('m', 'm_pick') === 1);
K.setQty('m', 'm_pick', '7');
ok('★ nor can it be typed to seven', K.qtyOf('m', 'm_pick') === 1);
K.setQty('m', 'm_pick', '0');
ok('and it can be taken out', K.qtyOf('m', 'm_pick') === 0);

console.log('\ncart-ui · model: offer (your price, against their band)');
K.add('m', 'm_offer');
K.setOffer('m', 'm_offer', 850);
ok('an offer inside the band reads as ok', K.offerState('m', 'm_offer').ok === true);
K.setOffer('m', 'm_offer', 500);
ok('★ below the band is FLAGGED, not blocked — it is an offer, and they may still accept',
   K.offerState('m', 'm_offer').ok === false && K.offerState('m', 'm_offer').low === true);
K.setOffer('m', 'm_offer', 2000);
ok('★ above the band is flagged too', K.offerState('m', 'm_offer').high === true);
ok('★ the offer is a SEPARATE fact from the quantity', K.qtyOf('m', 'm_offer') === 1);



console.log('\ncart-ui · what the models send onward');
const ml = K.selected('m');
ok('★★ every line carries its MODEL — a "4" means something different on a pack than on a metre',
   ml.length > 0 && ml.every((l) => !!l.model));
ok('★ the declared model is the one that travels',
   (ml.find((l) => l.item_id === 'm_range') || {}).model === 'range');
ok('★ the offer travels with its line', (ml.find((l) => l.item_id === 'm_offer') || {}).offer === 2000);
K.init('z', { shop: { bridge_id: 'Z' }, items: [{ item_id: 'q', item_data: { name: 'X', order: { model: 'nonsense' } } }] });
K.add('z', 'q');
ok('★ an unknown model falls back to counting rather than breaking the row', K.qtyOf('z', 'q') === 1);

/* ── AD-HOC LINES — compose can author a chit for something never catalogued. ────────────────────────────────────
   ⚠️ The trap this exists to avoid: keeping typed lines in a SECOND list beside the cart. Two lists mean two counts,
   and the bar — which is the running answer to "what am I sending" — would be quietly wrong. */
console.log('\ncart-ui · lines that are not in the catalogue');
K.init('ad', cat);
K.add('ad', 'c');                                            // one catalogue line, ₹650
const adId = K.addAdhoc('ad', { name: 'Scaffold hire', unit: 'week', price: 1200 }, 2);
ok('★★ a typed line joins the SAME cart', K.lines('ad') === 2);
ok('★★ adding one did NOT empty the cart it was added to', K.qtyOf('ad', 'c') === 1);
ok('★ it carries the quantity it was given', K.qtyOf('ad', adId) === 2);
ok('★★ it reaches the TOTAL, so the bar is never quietly wrong', K.total('ad').amount === 650 + 1200 * 2);
ok('★ it comes out with the other lines', K.selected('ad').some((l) => l.name === 'Scaffold hire'));
ok('★ it steps like any other line', (K.add('ad', adId), K.qtyOf('ad', adId) === 3));
ok('★ and removes like any other line', (K.setQty('ad', adId, 0), K.lines('ad') === 1));
const adNo = K.addAdhoc('ad', { unit: 'week' });
ok('★ a nameless line is refused — there is nothing to put on a chit', adNo === null && K.lines('ad') === 1);
const adFree = K.addAdhoc('ad', { name: 'Goodwill', unit: 'each' });
ok('★ an unpriced typed line is allowed, and makes the total partial rather than smaller',
   K.qtyOf('ad', adFree) === 1 && K.total('ad').partial === true && K.total('ad').amount === 650);

console.log('\ncart-ui · the offer must reach the money');
/* ⚠️ THE BUG ATHI CAUGHT, 2026-08-08: *"your price value not appearing in the review page, it got ignored."*
   The offer travelled out with the line and then every total went on multiplying the SELLER's price, so someone
   who offered ₹850 against a ₹900 ask saw ₹900 on review — and would have sent an order at a number they never
   agreed to. These four cases exist so it cannot come back on any of the four screens. */
K.clear('m');
K.add('m', 'm_offer'); K.add('m', 'm_offer');      // 2 × asking 900
K.setOffer('m', 'm_offer', 850);
ok('★★ the TOTAL uses the offer, not the asking price', K.total('m').amount === 850 * 2);
ok('★★ …and says whose number it is, so it cannot read as agreed', K.total('m').offered === true);
const ol = K.selected('m')[0];
ok('★ the line carries the price that COUNTS', ol.unit_price === 850 && ol.line_total === 1700);
ok('★ …and still carries what they ASKED, so nothing is hidden', ol.asking_price === 900 && ol.offered === true);
K.setOffer('m', 'm_offer', '');
ok('★ withdrawing the offer falls back to their price, and stops claiming an offer',
   K.total('m').amount === 900 * 2 && K.total('m').offered === false);
K.clear('m');

/* ══════════════════════════════════════════════════════════════════════════════════════════════════════════════
   create() — a cart you HOLD, and load() — the door every non-human input comes through.

   Athi, 2026-08-09: *"the cart is the mechanism different type of input can get into the system… how the whatsapp
   integration works? it has to be one of the cart?"*

   It is not a cart — it FILLS one. WhatsApp, email, the AI line, a CSV and an ERP push all produce the same thing:
   lines somebody then confirms. load() is that door, and it routes every line through the SAME gate as the +
   button, or the order models are decoration.
   ══════════════════════════════════════════════════════════════════════════════════════════════════════════════ */
console.log('\ncart-ui · create()');
const chanCat = { shop: { bridge_id: 'W' }, groups: [], items: [
  { item_id: 'b', item_data: { name: 'Bolts', unit: 'box', price: 12, order: { model: 'pack', step: 12 } } },
  { item_id: 'c', item_data: { name: 'Cable', unit: 'm', price: 9, order: { model: 'range', min: 5, max: 500, step: 5 } } },
  { item_id: 'p', item_data: { name: 'Paint tin', unit: 'tin', price: 100 } },
] };
const cart = K.create(chanCat, {});
ok('★ create returns a handle you hold — no namespace string to pass around',
   typeof cart.add === 'function' && typeof cart.ns === 'string');
cart.add('p').add('p');
ok('it counts like any cart', cart.lines() === 1 && cart.qtyOf('p') === 2 && cart.total().amount === 200);
const second = K.create(chanCat, {});
second.add('p');
ok('★★ two carts are INDEPENDENT — the bug the namespaced API could not prevent',
   cart.qtyOf('p') === 2 && second.qtyOf('p') === 1);
second.destroy();
ok('★ destroy releases it', K.state(second.ns) === undefined);

/* ⚠️ THE DEFECT THIS PAIR EXISTS FOR — shipped to the public storefront on 2026-08-09.
   The popup host was a default the COMPAT ADAPTER filled in and create() did not. So the storefront migrated to
   create(), kept adding to its cart perfectly, and could never open it: open() looked up a popupEl nobody had told
   the caller to supply, got null, and returned in silence. Six + buttons and no way to check out, on a public page,
   with nothing thrown for the smoke test to see.
   Two front doors are one implementation only if they hand back the SAME cart. */
const hosted = K.create(chanCat, {});
const hOpts = K.state(hosted.ns).opts;
ok('★★ create() supplies the popup host itself — a caller must not have to know an overlay exists',
   hOpts.popupEl === 'cbcart_ov' && hOpts.popupBodyEl === 'cbcart_ovc' && hOpts.popupClass === 'cbcart-ov');
const owned = K.create(chanCat, { popupEl: 'mine_ov', popupBodyEl: 'mine_body' });
ok('★ …but a caller that names its own host keeps it',
   K.state(owned.ns).opts.popupEl === 'mine_ov' && K.state(owned.ns).opts.popupBodyEl === 'mine_body');
hosted.destroy(); owned.destroy();

console.log('\ncart-ui · load() — the channel door (WhatsApp, email, AI, CSV, ERP)');
cart.clear();
const res = cart.load([
  { name: 'Bolts', qty: 2 },       // sold in 12s — "2 boxes" is not a legal line as written
  { name: 'Cable', qty: 3 },       // below the 5 m minimum
  { name: 'Sand bag', qty: 4 },    // not stocked at all
  { qty: 9 },                      // no name
]);
ok('★★ a channel line passes through the MODEL gate — 2 boxes of bolts lands on a legal pack',
   cart.qtyOf('b') > 0 && cart.qtyOf('b') % 12 === 0);
ok('★★ below a minimum is REFUSED and REPORTED — never rounded up to fit',
   cart.qtyOf('c') === 0 && res.refused.some((r) => r.name === 'Cable'));
ok('★ something the shop does not stock still becomes a line — a real request, not a silent drop',
   res.placed.some((p) => p.adhoc && p.name === 'Sand bag'));
ok('★ a nameless line is refused, with a reason', res.refused.some((r) => r.name === null && r.why));
ok('★ placed says what was ASKED as well as what landed, so a person can see the difference',
   res.placed.find((p) => p.name === 'Bolts').asked === 2);
ok('★ nothing is minted — load fills a cart, a human still confirms', cart.lines() === 2);
cart.destroy();

/**
 * ── ⭐⭐⭐ HALF A KILO — EVERY UNIT, ASKED ONE BY ONE ─────────────────────────────────────────────────────────
 *
 * Athi, 2026-09-12: *"is the weight and kg allows fraction? it requires, can you test that? in fact every
 * unit."*
 *
 * ⚠️⚠️ THE UNIT DECIDES NOTHING. Quantity is decided by the line's order MODEL, and `modelOf` ends with
 * `MODELS[o.model] || MODELS.count` — so a product with no order model attached is counted in whole numbers
 * whatever it is measured in. Type 0.5 against a kilo of rice and `count.coerce` floors it to 0, and 0 does not
 * mean zero: **it removes the line from the cart**. The shopkeeper sees the row disappear, not a refusal.
 *
 * ⭐ AND THE DATA TO GET THIS RIGHT IS ALREADY THERE, UNUSED. `CBCatalogue.UNIT_KINDS` groups every unit —
 * Weight · Volume · Length · Area are continuous, Count · Pack are discrete — and `unitKind(u)` is exported and
 * called by NOTHING. A default model derived from the kind would make half a kilo work on the day a product is
 * created, and still let an explicit order model win.
 *
 * ⚠️ THE CONTINUOUS HALF OF THIS TEST IS RED ON PURPOSE and names a real gap. It is not describing what the
 * cart does; it is describing what a shop selling by weight requires. [[feedback-document-status]]
 */
console.log('\ncart-ui · fractions, unit by unit');
{
  const KINDS = globalThis.CBCatalogue.UNIT_KINDS || [];
  const CONTINUOUS = ['Weight', 'Volume', 'Length', 'Area'];
  const cont = [], disc = [];
  KINDS.forEach((k) => (CONTINUOUS.indexOf(k.label) >= 0 ? cont : disc).push(...(k.units || [])));

  /** one product, one unit, one optional order model — the smallest thing that can hold a quantity */
  const one = (unit, model) => {
    const item = { item_id: 'x', item_data: { name: 'P', unit: unit, price: 100 } };
    if (model) item.item_data.order = { model: model };
    const c = { shop: { bridge_id: 'B1' }, items: [item] };
    K.init('frac', c); K.add('frac', 'x'); K.setQty('frac', 'x', 0.5);
    return K.qtyOf('frac', 'x');
  };

  const brokenDefault = cont.filter((u) => one(u) !== 0.5);
  ok('★★★ a unit measured continuously takes half of it — with NO order model attached: '
     + (brokenDefault.length ? brokenDefault.join(', ') + ' floor 0.5 to 0, which REMOVES the line'
                             : 'all of ' + cont.join(', ')),
     brokenDefault.length === 0);

  const brokenMeasure = cont.filter((u) => one(u, 'measure') !== 0.5);
  ok('★★ and every one of them takes it once a measure model IS attached',
     brokenMeasure.length === 0);

  /* ⚠️ The other direction is just as real: half a box is not a thing, and today NOTHING stops it. */
  const loose = disc.filter((u) => one(u, 'measure') === 0.5);
  ok('★★ a DISCRETE unit refuses half of itself: '
     + (loose.length ? loose.join(', ') + ' accept 0.5 when a measure model is attached — nothing checks the unit'
                     : 'none accept a fraction'),
     loose.length === 0);

  ok('★ a discrete unit with no model counts in whole numbers, and says so by refusing 0.5',
     disc.every((u) => one(u) === 0));

  /* ⭐ three decimal places, because 2.5 kg is a real order and 0.001 kg is a gram. */
  const item = { item_id: 'x', item_data: { name: 'P', unit: 'kg', price: 100, order: { model: 'measure' } } };
  K.init('frac', { shop: { bridge_id: 'B1' }, items: [item] }); K.add('frac', 'x');
  K.setQty('frac', 'x', 2.5);      ok('★ 2.5 kg survives exactly', K.qtyOf('frac', 'x') === 2.5);
  K.setQty('frac', 'x', 0.001);    ok('★ a gram expressed in kilos survives', K.qtyOf('frac', 'x') === 0.001);
  K.setQty('frac', 'x', 0.0004);   ok('★ below a milligram of a kilo is not kept as a fiction',
                                      K.qtyOf('frac', 'x') === 0);
  K.setQty('frac', 'x', 1.0005);   ok('★ rounding is to three places, not floating-point noise',
                                      K.qtyOf('frac', 'x') === 1.001 || K.qtyOf('frac', 'x') === 1);
}

/**
 * ── ⭐⭐ THE MARGIN: A SCALE THAT SETTLES AT 1.010 MEANS ONE KILO ────────────────────────────────────────────
 *
 * Athi, 2026-09-12: *"allow margin, in the sense, 1.010, to be considered as 1, kind of?"*
 *
 * ⚠️⚠️ THIS ONE CHANGES MONEY, so the cases that matter most are the ones where it must NOT fire. A hundredth
 * of a unit, FLAT — ten grams on a kilo, and still ten grams on a tonne. A percentage would have been 10 kg of
 * a tonne and the first anybody heard of it would be an invoice.
 */
/**
 * ── ⭐⭐ THE MARGIN IS THE ENTITY'S, PER UNIT — AND EVERY PRODUCT OBEYS IT ────────────────────────────────────
 *
 * Athi, 2026-09-12: *"we have selection, what are the units applied for this entity. for each entity we can set
 * decimal allowed, if so tollerance and min qty. that will be perfect. and each product obeys that."*
 *
 * ⚠️⚠️ THE CASES THAT MATTER MOST ARE THE ONES WHERE IT MUST NOT FIRE, because this one changes money. A
 * hundredth of a unit, FLAT — ten grams on a kilo and still ten grams on a tonne. A percentage would have been
 * 10 kg of a tonne, and the first anybody heard of it would be an invoice.
 */
console.log('\ncart-ui · the margin, declared per unit by the entity');
{
  /** one product in one unit, under one entity's declared unit rules */
  const buy = (unit, v, rules) => {
    const shop = { bridge_id: 'B1' };
    if (rules) shop.unit_rules = rules;
    K.init('m', { shop: shop, items: [{ item_id: 'x', item_data: { name: 'Rice', unit: unit, price: 100 } }] });
    K.add('m', 'x'); K.setQty('m', 'x', v);
    return K.qtyOf('m', 'x');
  };

  console.log('  — the default, for a catalogue that has never opened the screen —');
  ok('★★★ 1.010 kg is one kilo', buy('kg', 1.010) === 1);
  /**
   * ⭐⭐ DOWN ONLY, and this case is the whole reason to say so out loud. Athi, 2026-09-12: *"round is good,
   * basically floor, ground"*. Rounding to the NEAREST would bill five grams the scale never weighed — the
   * excess above a whole number is dropped, the shortfall below one is kept, and the customer is never
   * charged for what did not arrive.
   */
  ok('★★★ 0.995 kg is NOT rounded up to a kilo — the margin only ever takes off, never adds',
     buy('kg', 0.995) === 0.995);
  ok('★★ 1.02 kg is NOT one kilo — twenty grams is a quantity, not noise', buy('kg', 1.02) === 1.02);
  ok('★★ 10.05 stays 10.05 — the band is FLAT, it does not widen with the number', buy('kg', 10.05) === 10.05);
  ok('★★★ it never snaps toward nothing: 0.004 kg keeps itself', buy('kg', 0.004) === 0.004);
  ok('★ a half is a half — nowhere near a whole number', buy('kg', 0.5) === 0.5);

  console.log('  — decimals, declared per unit by the entity —');
  ok('★★★ decimals OFF makes a continuous unit whole: 2.4 kg is 2',
     buy('kg', 2.4, { kg: { decimals: false } }) === 2);
  ok('★★ and nothing is asked about tolerance for a unit that cannot be halved',
     buy('kg', 1.010, { kg: { decimals: false } }) === 1);
  /* ⚠⚠ Athi, 2026-09-12: *"no, the count cannot be half"* — a RULE, not a preference, so a declaration
     saying otherwise is refused rather than honoured. A setting the data can hold but the world cannot is how
     a bill ends up reading 2.5 boxes. */
  ok('★★★ a countable unit refuses a fraction even when the entity declares decimals on',
     buy('box', 2.5, { box: { decimals: true } }) === 2);
  /* ⚠ DOWN, not to the nearest: this file's own rule is that a model never silently corrects upward. */
  ok('★ and OFF is the default for a countable unit, with nothing declared', buy('box', 2.5) === 2);

  console.log('  — the margin and its minimum —');
  ok('★★ a wider band is declared, not coded: tol 0.1 makes 1.05 one',
     buy('kg', 1.05, { kg: { decimals: true, tol: 0.1 } }) === 1);
  ok('★★ tol 0 keeps the decimals and drops the margin',
     buy('kg', 1.010, { kg: { decimals: true, tol: 0 } }) === 1.01);
  ok('★★★ MIN QTY: a margin that is 1% of a kilo is 20% of fifty grams, so below the minimum it does not apply',
     buy('kg', 1.010, { kg: { decimals: true, min_qty: 5 } }) === 1.01);
  ok('★★★ …and above the minimum the same margin does apply',
     buy('kg', 7.005, { kg: { decimals: true, min_qty: 5 } }) === 7);
  ok('★ the minimum is read against the quantity, not the whole number it would snap to',
     buy('kg', 4.999, { kg: { decimals: true, min_qty: 5 } }) === 4.999);

  console.log('  — every product in that unit obeys, without being asked —');
  const shop = { bridge_id: 'B1', unit_rules: { kg: { decimals: true, tol: 0.02, min_qty: 2 } } };
  K.init('m2', { shop: shop, items: [
    { item_id: 'a', item_data: { name: 'Rice', unit: 'kg', price: 50 } },
    { item_id: 'b', item_data: { name: 'Dal',  unit: 'kg', price: 90, order: { model: 'measure' } } },
    { item_id: 'c', item_data: { name: 'Soap', unit: 'box', price: 20 } },
  ] });
  K.add('m2', 'a'); K.setQty('m2', 'a', 3.015);
  K.add('m2', 'b'); K.setQty('m2', 'b', 3.015);
  K.add('m2', 'c'); K.setQty('m2', 'c', 3.015);
  ok('★★★ a product with no order model obeys the unit', K.qtyOf('m2', 'a') === 3);
  ok('★★★ a product WITH a measure model obeys the same unit — one place to look', K.qtyOf('m2', 'b') === 3);
  ok('★★ and a box in the same catalogue is still whole', K.qtyOf('m2', 'c') === 3);
}

console.log('\n  ' + (failed ? failed + ' FAILED' : 'all passed') + '\n');
process.exit(failed ? 1 : 0);
