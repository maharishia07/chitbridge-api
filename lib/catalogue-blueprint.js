// @stage tested
// @stage-note Two trade blueprints and the product-code sequence. No db, no network, no disk — but SERVER
// @stage-note side: setup is an online act, so the counter reads the trades from the route rather than holding them.
'use strict';
/**
 * catalogue-blueprint.js — A SHOP OPEN FOR BUSINESS, MINTED ([TILL-107]).
 *
 * Athi, 2026-09-19: *"now do the product catalogue with sequence logic, this is where we are going to bring our
 * blue print stuff, can we have a proper two catalogue, one for Veg Store and another one for Hotel… we have
 * many means and complexities in the world, but how do we bring the axiom out of the lot? so we can start the
 * store in no time."*
 *
 * ── ⭐⭐⭐ THE AXIOM, MEASURED RATHER THAN ARGUED ─────────────────────────────────────────────────────────────
 *
 * The honest way to answer "what is the minimum" is to try to sell with less and see where it breaks. Driving
 * till.html with products stripped field by field (e2e/till-catalogue.cjs keeps this as a standing check):
 *
 *     name + price only     → TOTAL ₹20.00, a key on the screen, the bill counts.  **It sells.**
 *     + item_id · unit · category · code → identical. Not one of them is needed to take money.
 *
 * So **AXIOM = name + price**. Everything else is enrichment, and calling it enrichment is not a demotion: a
 * shop cannot be asked for an HSN code before it is allowed to sell a tomato.
 *
 * ⭐⭐ AND THREE INDEPENDENT SOURCES AGREE, WHICH IS WHY THIS IS AN AXIOM AND NOT A PREFERENCE:
 *   · csv-preflight.SYNONYMS — 14 canonical fields distilled from how the world actually spells them
 *     ("rate", "cost", "unit price", "selling price" are all `price`)
 *   · the Tally connector's stock-item FETCH — NAME, PARENT, BASEUNITS, PARTNO, STANDARDPRICE, HSNCODE,
 *     CLOSINGBALANCE, GSTDETAILS. An accounting package, asked the same question, kept the same handful.
 *   · the counter itself, measured above.
 * Three roads, one small core. That is the axiom out of the lot.
 *
 * ── ⭐⭐⭐ WHY THESE ARE BLUEPRINTS AND NOT "TEMPLATES" ────────────────────────────────────────────────────────
 *
 * [[project-blueprint-lifecycle-feature]]: *"a Blueprint is defined by having a defined OUTCOME. No outcome →
 * it is NOT a blueprint."* Shop → orders. So each entry below names its `outcome`, and minting it has to
 * PRODUCE that outcome — a counter that can take money in that trade on the same day — not merely drop a list
 * of products in a table. A starter list with no outcome would be a template, and we would be calling it the
 * wrong thing in the one file where the distinction was decided.
 *
 * ── ⚠️⚠️ WHAT THE TWO TRADES ACTUALLY DIFFER BY, WHICH IS ALMOST NOTHING ─────────────────────────────────────
 *
 * Athi, on the verticals: *"none of them are super set, it is the small subset that makes both as a separate
 * application."* [TILL-104] found that subset by measurement and it is ONE FACT: whether a quantity is counted
 * or measured, and that is decided by the UNIT, not the trade. So these blueprints do not carry behaviour.
 * They carry **the units the trade sells in** — and the counter's existing rules then do the right thing for
 * free: a greengrocer's bill reads "3 items · 2.25 kg" and a hotel's reads "6 items", with no branch anywhere.
 * ⚠️ If a blueprint ever grows an `if (trade === …)`, the subset has been misunderstood.
 * [[feedback-the-data-decides-not-the-trade]]
 *
 * ── ⚠️ SETUP MAY USE THE LINE; SELLING MAY NOT ──────────────────────────────────────────────────────────────
 * Athi, 2026-09-19: *"we don't need to be 100% offline, while setting up the store and provide facilities we
 * can still connect. we should be able to assist the store through on-line meetings."* That settles a question
 * [TILL-107] was going to have to answer the hard way: a product authored offline would be a LOCAL product
 * needing a merge rule against a back-office one. It never has to be. Authoring is an online act, so the
 * sequence below is allocated once, by the server, against what the shop already has — and the counter's job
 * stays what [TILL-106] proved it can do with the line down: sell what it already holds.
 */
const versionref = require('./versionref');   /* ⚠️ the ONE builder of a thing@version — never a '+ "@" +' */


  /**
   * ── ⭐⭐⭐ THE PACKAGE'S OWN VERSION ────────────────────────────────────────────
   *
   * Athi: *"this package what we drop can be replaced with the new updates as we enhances the package, so it
   * needs version number."*
   *
   * ⚠️ BUMP IT WHEN A BLUEPRINT'S CONTENT CHANGES — a product added to a starter list, a price corrected, a
   * unit fixed. Not for a comment. A shop is pinned to what it minted, and the pin is only useful if the
   * number moves when the thing it names moves.
   * ⚠⚠ AND BOTH VERSIONS COEXIST. A shop minted on veg@1 does not change because veg@2 shipped; upgrading is
   * a deliberate re-adopt, which is the rule [[project-version-upgrade]] settled for every layer.
   */
  const VERSION = 2;

  /** ⭐ what a mint is pinned to — 'veg@1'. One spelling, so a reverse index can be built on it later. */
  function pin(bp) { return versionref.format((bp && bp.key) || 'general', (bp && bp.version) || VERSION); }

  /* ── ⭐ THE AXIOM ─────────────────────────────────────────────────────────── */

  /** ⚠️ MEASURED, NOT CHOSEN — a product with only these two sells on the counter today. */
  const AXIOM = ['name', 'price'];

  /**
   * ⭐ WHAT WE ASK FOR NEXT, IN THE ORDER IT EARNS ITS PLACE. Each line says what it BUYS, because a field that
   * cannot say what it buys should not be on a form in front of a shopkeeper who wants to open today.
   */
  const ENRICH = [
    { key: 'unit',     buys: 'lets the bill say "2.25 kg" instead of "2.25 items"' },
    { key: 'category', buys: 'groups the keys on the counter, so a busy till is navigable' },
    { key: 'code',     buys: 'a barcode or a short code to type instead of the name' },
    { key: 'hsn',      buys: 'required on a tax invoice once the shop is registered' },
    { key: 'gst_rate', buys: 'what tax this product carries, if any' },
    { key: 'mrp',      buys: 'the printed price, so a discount can be shown against it' },
    /* ⭐ both added 2026-09-27 with veg@2 — and both were being DROPPED by rowsToProducts' whitelist until
       the same day, so a sheet carrying either lost it in silence. See that loop's own note. */
    { key: 'synonyms', buys: 'the shop’s own words — typing thakkali finds Tomato, at the counter and in a WhatsApp order' },
    { key: 'image',    buys: 'a photograph on the key instead of its first letter' },
  ];

  /* ── ⭐⭐ THE TWO TRADES ────────────────────────────────────────────────────────────────────────────────── */

  /**
   * ⚠️ THE STARTER LISTS ARE REAL SHOPS' GOODS, not lorem. A shopkeeper opening this has to RECOGNISE the list
   * well enough to correct it in two minutes — that is the whole value of a starter catalogue. Prices are
   * plausible 2026 Indian retail and are meant to be edited; the units are not, because the units are what
   * make the bill read correctly.
   */
  const BLUEPRINTS = {
    veg: {
      key: 'veg',
      /**
       * ⭐⭐ v2 (2026-09-27) — 12 products became 202, and 3 categories became 9. Athi, switching a test shop
       * over to a real greengrocer: *"i could see few products, can you create atleast 100 products and its
       * categories etc, so we can showcase some nice variety, we can test against that store so we will know
       * what are missing here?"* Twelve products cannot show whether the category strip, the quick keys, the
       * search or the chip counts hold up — a shelf has to be shelf-sized before an emptiness is a finding.
       * Then, on the first hundred: *"is it only 123 items in the indian market or anything more exists, say
       * roots, potato, yam and so on"* — no, and the gap was real. A south Indian shop's root shelf alone runs
       * to koorka, kaachil, senai, seppankizhangu, maravalli, koova and arrowroot before it reaches potato,
       * and the medicinal greens (vallarai, mudakathan, pirandai, thoothuvalai) are a rack of their own.
       * ⚠️ v1 IS UNTOUCHED AND STILL MINTS. A shop pinned to veg@1 does not change because veg@2 shipped;
       * upgrading is a deliberate re-adopt. [[project-version-upgrade]]
       */
      version: 2,
      label: 'Vegetables & fruit',
      /* ⭐ THE OUTCOME. Without one this is not a blueprint. */
      outcome: 'a counter that can weigh, price and bill fresh produce today',
      prefix: 'V',
      /* ⚠️ MEASURED UNITS FIRST — this is the entire difference between the two trades, and it is data.
         ⭐ `pack` and `dozen` earn their place in v2 with the cut/packed shelf: they are COUNTED, so the
         counter refuses a fraction of them on its own, with no branch anywhere. That contrast — kg beside
         pack on one bill — is the axiom being exercised rather than described. */
      units: ['kg', 'gram', 'bunch', 'piece', 'pack', 'dozen'],
      defaultUnit: 'kg',
      categories: ['Vegetables', 'Gourds', 'Roots & tubers', 'Greens', 'Herbs & aromatics',
                   'Fruit', 'Exotic', 'Cut & packed', 'Pooja & flowers'],
      /**
       * ⚠️ MOST FRESH PRODUCE IS NIL-RATED IN INDIA and a shop below the threshold charges nothing anyway, so
       * no gst_rate is declared here. An unregistered greengrocer must not be handed a tax rate it never asked
       * for. The jurisdiction layer decides; a starter list does not. [[feedback-country-first]]
       * ⚠️⚠️ WHICH IS ALSO WHY v2 STAYS PURE PRODUCE. A greengrocer really does keep a rack of branded
       * packets by the door, and they are NOT nil-rated — so putting them here would mean either inventing
       * rates (the thing the paragraph above refuses) or listing taxable goods with no rate, which is quietly
       * wrong in the other direction. A kirana blueprint, with real rates, is where that shelf belongs.
       */
      starter: [
        /* ── the everyday shelf: what a household buys without thinking ─────────────────────────── */
        { name: 'Tomato',              unit: 'kg',    price: 40,  category: 'Vegetables' },
        { name: 'Tomato (country)',    unit: 'kg',    price: 55,  category: 'Vegetables' },
        { name: 'Onion',               unit: 'kg',    price: 30,  category: 'Vegetables' },
        { name: 'Small onion',         unit: 'kg',    price: 90,  category: 'Vegetables' },
        { name: 'Spring onion',        unit: 'bunch', price: 20,  category: 'Vegetables' },
        { name: 'Potato',              unit: 'kg',    price: 35,  category: 'Vegetables' },
        { name: 'Cabbage',             unit: 'kg',    price: 30,  category: 'Vegetables' },
        { name: 'Cauliflower',         unit: 'piece', price: 40,  category: 'Vegetables' },
        { name: 'Brinjal',             unit: 'kg',    price: 45,  category: 'Vegetables' },
        { name: 'Brinjal (green)',     unit: 'kg',    price: 50,  category: 'Vegetables' },
        { name: 'Ladies finger',       unit: 'kg',    price: 55,  category: 'Vegetables' },
        /* ⚠️ three "Beans" on purpose — a shop really does carry them, and a catalogue where no two names
           share a first word never finds out what the search box does with the ones that do. */
        { name: 'Beans',               unit: 'kg',    price: 80,  category: 'Vegetables' },
        { name: 'Beans (cluster)',     unit: 'kg',    price: 70,  category: 'Vegetables' },
        { name: 'Beans (broad)',       unit: 'kg',    price: 75,  category: 'Vegetables' },
        { name: 'Double beans',        unit: 'kg',    price: 120, category: 'Vegetables' },
        { name: 'Green peas',          unit: 'kg',    price: 120, category: 'Vegetables' },
        { name: 'Capsicum',            unit: 'kg',    price: 70,  category: 'Vegetables' },
        { name: 'Drumstick',           unit: 'piece', price: 15,  category: 'Vegetables' },
        { name: 'Raw banana',          unit: 'piece', price: 15,  category: 'Vegetables' },
        { name: 'Plantain stem',       unit: 'piece', price: 30,  category: 'Vegetables' },
        { name: 'Banana flower',       unit: 'piece', price: 35,  category: 'Vegetables' },
        { name: 'Sweet corn',          unit: 'piece', price: 25,  category: 'Vegetables' },
        { name: 'Chow chow',           unit: 'kg',    price: 35,  category: 'Vegetables' },
        { name: 'Knol khol',           unit: 'kg',    price: 40,  category: 'Vegetables' },
        { name: 'Coconut',             unit: 'piece', price: 25,  category: 'Vegetables' },
        { name: 'Long beans',          unit: 'kg',    price: 60,  category: 'Vegetables' },
        { name: 'Flat beans',          unit: 'kg',    price: 65,  category: 'Vegetables' },
        { name: 'Winged beans',        unit: 'kg',    price: 90,  category: 'Vegetables' },
        { name: 'Turkey berry',        unit: 'gram',  price: 0.3, category: 'Vegetables' },
        { name: 'Raw mango',           unit: 'kg',    price: 70,  category: 'Vegetables' },
        { name: 'Raw papaya',          unit: 'kg',    price: 40,  category: 'Vegetables' },
        { name: 'Raw jackfruit',       unit: 'kg',    price: 70,  category: 'Vegetables' },
        { name: 'Green tomato',        unit: 'kg',    price: 45,  category: 'Vegetables' },
        { name: 'Baby brinjal',        unit: 'kg',    price: 60,  category: 'Vegetables' },

        /* ── gourds: their own shelf in any real shop, and a whole category of names nobody spells twice ── */
        { name: 'Bottle gourd',        unit: 'kg',    price: 35,  category: 'Gourds' },
        { name: 'Ridge gourd',         unit: 'kg',    price: 45,  category: 'Gourds' },
        { name: 'Snake gourd',         unit: 'kg',    price: 40,  category: 'Gourds' },
        { name: 'Bitter gourd',        unit: 'kg',    price: 60,  category: 'Gourds' },
        { name: 'Ash gourd',           unit: 'kg',    price: 30,  category: 'Gourds' },
        { name: 'Ivy gourd',           unit: 'kg',    price: 50,  category: 'Gourds' },
        { name: 'Pumpkin',             unit: 'kg',    price: 30,  category: 'Gourds' },
        { name: 'Cucumber',            unit: 'kg',    price: 40,  category: 'Gourds' },
        { name: 'Salad cucumber',      unit: 'kg',    price: 50,  category: 'Gourds' },
        { name: 'Pointed gourd',       unit: 'kg',    price: 80,  category: 'Gourds' },
        { name: 'Apple gourd',         unit: 'kg',    price: 60,  category: 'Gourds' },
        { name: 'Spine gourd',         unit: 'kg',    price: 140, category: 'Gourds' },

        /* ── roots & tubers ─────────────────────────────────────────────────────────────────────── */
        { name: 'Carrot',              unit: 'kg',    price: 60,  category: 'Roots & tubers' },
        { name: 'Carrot (Ooty)',       unit: 'kg',    price: 85,  category: 'Roots & tubers' },
        { name: 'Beetroot',            unit: 'kg',    price: 45,  category: 'Roots & tubers' },
        { name: 'Radish',              unit: 'kg',    price: 35,  category: 'Roots & tubers' },
        { name: 'Sweet potato',        unit: 'kg',    price: 60,  category: 'Roots & tubers' },
        { name: 'Tapioca',             unit: 'kg',    price: 50,  category: 'Roots & tubers' },
        { name: 'Colocasia',           unit: 'kg',    price: 70,  category: 'Roots & tubers' },
        { name: 'Elephant foot yam',   unit: 'kg',    price: 60,  category: 'Roots & tubers' },
        { name: 'Turmeric (fresh)',    unit: 'kg',    price: 120, category: 'Roots & tubers' },
        { name: 'Chinese potato',      unit: 'kg',    price: 110, category: 'Roots & tubers' },
        { name: 'Purple yam',          unit: 'kg',    price: 80,  category: 'Roots & tubers' },
        { name: 'White yam',           unit: 'kg',    price: 70,  category: 'Roots & tubers' },
        { name: 'Arrowroot',           unit: 'kg',    price: 90,  category: 'Roots & tubers' },
        { name: 'Water chestnut',      unit: 'kg',    price: 100, category: 'Roots & tubers' },
        { name: 'Lotus root',          unit: 'kg',    price: 160, category: 'Roots & tubers' },
        { name: 'Turnip',              unit: 'kg',    price: 55,  category: 'Roots & tubers' },
        { name: 'Red radish',          unit: 'kg',    price: 80,  category: 'Roots & tubers' },
        { name: 'Baby potato',         unit: 'kg',    price: 65,  category: 'Roots & tubers' },
        { name: 'Ginger (tender)',     unit: 'kg',    price: 200, category: 'Roots & tubers' },

        /* ── greens: sold by the bunch, priced in rupees, and the reason `bunch` exists ──────────── */
        { name: 'Coriander',           unit: 'bunch', price: 10,  category: 'Greens' },
        { name: 'Mint',                unit: 'bunch', price: 10,  category: 'Greens' },
        { name: 'Curry leaves',        unit: 'bunch', price: 10,  category: 'Greens' },
        { name: 'Spinach',             unit: 'bunch', price: 20,  category: 'Greens' },
        { name: 'Amaranth greens',     unit: 'bunch', price: 15,  category: 'Greens' },
        { name: 'Arai keerai',         unit: 'bunch', price: 15,  category: 'Greens' },
        { name: 'Siru keerai',         unit: 'bunch', price: 15,  category: 'Greens' },
        { name: 'Ponnanganni keerai',  unit: 'bunch', price: 15,  category: 'Greens' },
        { name: 'Agathi keerai',       unit: 'bunch', price: 15,  category: 'Greens' },
        { name: 'Gongura',             unit: 'bunch', price: 20,  category: 'Greens' },
        { name: 'Fenugreek leaves',    unit: 'bunch', price: 20,  category: 'Greens' },
        { name: 'Dill leaves',         unit: 'bunch', price: 15,  category: 'Greens' },
        { name: 'Drumstick leaves',    unit: 'bunch', price: 15,  category: 'Greens' },
        { name: 'Mustard greens',      unit: 'bunch', price: 20,  category: 'Greens' },
        { name: 'Colocasia leaves',    unit: 'bunch', price: 15,  category: 'Greens' },
        { name: 'Pumpkin leaves',      unit: 'bunch', price: 15,  category: 'Greens' },
        { name: 'Thandu keerai',       unit: 'bunch', price: 15,  category: 'Greens' },
        { name: 'Manathakkali keerai', unit: 'bunch', price: 20,  category: 'Greens' },
        { name: 'Vallarai keerai',     unit: 'bunch', price: 25,  category: 'Greens' },
        { name: 'Mudakathan keerai',   unit: 'bunch', price: 25,  category: 'Greens' },
        { name: 'Pirandai',            unit: 'bunch', price: 25,  category: 'Greens' },
        { name: 'Thoothuvalai',        unit: 'bunch', price: 25,  category: 'Greens' },

        /* ── herbs & aromatics: the small, expensive end — and where `gram` earns its place ──────── */
        { name: 'Ginger',              unit: 'kg',    price: 160, category: 'Herbs & aromatics' },
        { name: 'Garlic',              unit: 'kg',    price: 220, category: 'Herbs & aromatics' },
        { name: 'Small garlic',        unit: 'kg',    price: 320, category: 'Herbs & aromatics' },
        { name: 'Green chilli',        unit: 'kg',    price: 60,  category: 'Herbs & aromatics' },
        { name: 'Bird’s eye chilli', unit: 'gram', price: 0.2, category: 'Herbs & aromatics' },
        { name: 'Lemon',               unit: 'piece', price: 5,   category: 'Herbs & aromatics' },
        { name: 'Tamarind',            unit: 'kg',    price: 200, category: 'Herbs & aromatics' },
        { name: 'Green pepper',        unit: 'gram',  price: 1.2, category: 'Herbs & aromatics' },
        { name: 'Lemongrass',          unit: 'bunch', price: 20,  category: 'Herbs & aromatics' },
        { name: 'Ajwain leaves',       unit: 'bunch', price: 20,  category: 'Herbs & aromatics' },
        { name: 'Red chilli (fresh)',  unit: 'kg',    price: 80,  category: 'Herbs & aromatics' },
        { name: 'Gooseberry',          unit: 'kg',    price: 120, category: 'Herbs & aromatics' },

        /* ── fruit ──────────────────────────────────────────────────────────────────────────────── */
        { name: 'Banana',              unit: 'kg',    price: 50,  category: 'Fruit' },
        { name: 'Banana (yelakki)',    unit: 'kg',    price: 70,  category: 'Fruit' },
        { name: 'Banana (robusta)',    unit: 'dozen', price: 60,  category: 'Fruit' },
        { name: 'Apple',               unit: 'kg',    price: 200, category: 'Fruit' },
        { name: 'Apple (Shimla)',      unit: 'kg',    price: 180, category: 'Fruit' },
        { name: 'Orange',              unit: 'kg',    price: 120, category: 'Fruit' },
        { name: 'Sweet lime',          unit: 'kg',    price: 100, category: 'Fruit' },
        { name: 'Grapes (green)',      unit: 'kg',    price: 90,  category: 'Fruit' },
        { name: 'Grapes (black)',      unit: 'kg',    price: 110, category: 'Fruit' },
        { name: 'Pomegranate',         unit: 'kg',    price: 180, category: 'Fruit' },
        { name: 'Papaya',              unit: 'kg',    price: 50,  category: 'Fruit' },
        { name: 'Guava',               unit: 'kg',    price: 80,  category: 'Fruit' },
        { name: 'Mango (Banganapalli)', unit: 'kg',   price: 150, category: 'Fruit' },
        { name: 'Mango (Alphonso)',    unit: 'kg',    price: 400, category: 'Fruit' },
        { name: 'Watermelon',          unit: 'piece', price: 80,  category: 'Fruit' },
        { name: 'Muskmelon',           unit: 'piece', price: 60,  category: 'Fruit' },
        { name: 'Pineapple',           unit: 'piece', price: 60,  category: 'Fruit' },
        { name: 'Sapota',              unit: 'kg',    price: 90,  category: 'Fruit' },
        { name: 'Custard apple',       unit: 'kg',    price: 150, category: 'Fruit' },
        { name: 'Jackfruit',           unit: 'kg',    price: 80,  category: 'Fruit' },
        { name: 'Tender coconut',      unit: 'piece', price: 45,  category: 'Fruit' },
        { name: 'Pear',                unit: 'kg',    price: 180, category: 'Fruit' },
        { name: 'Plum',                unit: 'kg',    price: 200, category: 'Fruit' },
        { name: 'Litchi',              unit: 'kg',    price: 250, category: 'Fruit' },
        { name: 'Jamun',               unit: 'kg',    price: 220, category: 'Fruit' },
        { name: 'Wood apple',          unit: 'piece', price: 40,  category: 'Fruit' },
        { name: 'Bael fruit',          unit: 'piece', price: 50,  category: 'Fruit' },
        { name: 'Star fruit',          unit: 'kg',    price: 90,  category: 'Fruit' },
        { name: 'Rose apple',          unit: 'kg',    price: 120, category: 'Fruit' },
        { name: 'Indian jujube',       unit: 'kg',    price: 80,  category: 'Fruit' },
        { name: 'Palm fruit',          unit: 'piece', price: 20,  category: 'Fruit' },
        { name: 'Sugarcane',           unit: 'piece', price: 30,  category: 'Fruit' },
        { name: 'Fresh fig',           unit: 'kg',    price: 350, category: 'Fruit' },
        { name: 'Passion fruit',       unit: 'kg',    price: 260, category: 'Fruit' },
        { name: 'Mangosteen',          unit: 'kg',    price: 380, category: 'Fruit' },
        { name: 'Rambutan',            unit: 'kg',    price: 340, category: 'Fruit' },
        { name: 'Ice apple',           unit: 'piece', price: 25,  category: 'Fruit' },

        /* ── exotic: the rack that carries the shop's highest prices, so the money column gets a range ── */
        { name: 'Broccoli',            unit: 'kg',    price: 180, category: 'Exotic' },
        { name: 'Zucchini (green)',    unit: 'kg',    price: 140, category: 'Exotic' },
        { name: 'Zucchini (yellow)',   unit: 'kg',    price: 160, category: 'Exotic' },
        { name: 'Red cabbage',         unit: 'kg',    price: 90,  category: 'Exotic' },
        { name: 'Bell pepper (red)',   unit: 'kg',    price: 240, category: 'Exotic' },
        { name: 'Bell pepper (yellow)', unit: 'kg',   price: 240, category: 'Exotic' },
        { name: 'Iceberg lettuce',     unit: 'piece', price: 90,  category: 'Exotic' },
        { name: 'Celery',              unit: 'bunch', price: 60,  category: 'Exotic' },
        { name: 'Parsley',             unit: 'bunch', price: 50,  category: 'Exotic' },
        { name: 'Basil',               unit: 'bunch', price: 60,  category: 'Exotic' },
        { name: 'Leek',                unit: 'piece', price: 60,  category: 'Exotic' },
        { name: 'Asparagus',           unit: 'kg',    price: 400, category: 'Exotic' },
        { name: 'Avocado',             unit: 'piece', price: 120, category: 'Exotic' },
        { name: 'Kiwi',                unit: 'piece', price: 35,  category: 'Exotic' },
        { name: 'Dragon fruit',        unit: 'piece', price: 90,  category: 'Exotic' },
        { name: 'Kale',                unit: 'bunch', price: 120, category: 'Exotic' },
        { name: 'Bok choy',            unit: 'bunch', price: 90,  category: 'Exotic' },
        { name: 'Brussels sprouts',    unit: 'kg',    price: 320, category: 'Exotic' },
        { name: 'Romaine lettuce',     unit: 'piece', price: 110, category: 'Exotic' },
        { name: 'Rocket leaves',       unit: 'bunch', price: 70,  category: 'Exotic' },
        { name: 'Fennel bulb',         unit: 'piece', price: 80,  category: 'Exotic' },
        { name: 'Thyme',               unit: 'bunch', price: 70,  category: 'Exotic' },
        { name: 'Rosemary',            unit: 'bunch', price: 70,  category: 'Exotic' },
        { name: 'Artichoke',           unit: 'piece', price: 180, category: 'Exotic' },
        { name: 'Blueberry',           unit: 'pack',  price: 320, category: 'Exotic' },
        { name: 'Strawberry',          unit: 'pack',  price: 120, category: 'Exotic' },
        { name: 'Oyster mushroom',     unit: 'pack',  price: 90,  category: 'Exotic' },
        { name: 'Milky mushroom',      unit: 'pack',  price: 80,  category: 'Exotic' },

        /* ── cut & packed: COUNTED, not weighed — the shelf that proves the unit decides, not the trade ── */
        { name: 'Cut mixed vegetables', unit: 'pack', price: 60,  category: 'Cut & packed' },
        { name: 'Sambar cut',          unit: 'pack',  price: 50,  category: 'Cut & packed' },
        { name: 'Grated coconut',      unit: 'pack',  price: 40,  category: 'Cut & packed' },
        { name: 'Cut pumpkin',         unit: 'pack',  price: 30,  category: 'Cut & packed' },
        { name: 'Peeled garlic',       unit: 'pack',  price: 40,  category: 'Cut & packed' },
        { name: 'Peeled small onion',  unit: 'pack',  price: 60,  category: 'Cut & packed' },
        { name: 'Sprouted moong',      unit: 'pack',  price: 40,  category: 'Cut & packed' },
        { name: 'Cut papaya',          unit: 'pack',  price: 50,  category: 'Cut & packed' },
        { name: 'Cut pineapple',       unit: 'pack',  price: 50,  category: 'Cut & packed' },
        { name: 'Salad mix',           unit: 'pack',  price: 80,  category: 'Cut & packed' },
        { name: 'Grated carrot',       unit: 'pack',  price: 35,  category: 'Cut & packed' },
        { name: 'Baby corn',           unit: 'pack',  price: 40,  category: 'Cut & packed' },
        { name: 'Button mushroom',     unit: 'pack',  price: 60,  category: 'Cut & packed' },
        { name: 'Cherry tomato',       unit: 'pack',  price: 70,  category: 'Cut & packed' },
        { name: 'Mixed sprouts',       unit: 'pack',  price: 45,  category: 'Cut & packed' },
        { name: 'Sprouted chana',      unit: 'pack',  price: 45,  category: 'Cut & packed' },
        { name: 'Cut watermelon',      unit: 'pack',  price: 50,  category: 'Cut & packed' },
        { name: 'Cut jackfruit',       unit: 'pack',  price: 90,  category: 'Cut & packed' },
        { name: 'Cut mango',           unit: 'pack',  price: 70,  category: 'Cut & packed' },
        { name: 'Ginger garlic paste', unit: 'pack',  price: 50,  category: 'Cut & packed' },
        { name: 'Chopped coriander',   unit: 'pack',  price: 25,  category: 'Cut & packed' },
        { name: 'Cleaned keerai',      unit: 'pack',  price: 30,  category: 'Cut & packed' },
        { name: 'Cut bottle gourd',    unit: 'pack',  price: 35,  category: 'Cut & packed' },
        { name: 'Cut beans',           unit: 'pack',  price: 45,  category: 'Cut & packed' },

        /* ── pooja & flowers: sits beside the vegetables in every shop of this kind in the south ──── */
        { name: 'Banana leaf',         unit: 'piece', price: 10,  category: 'Pooja & flowers' },
        { name: 'Mango leaves',        unit: 'bunch', price: 15,  category: 'Pooja & flowers' },
        { name: 'Betel leaves',        unit: 'bunch', price: 20,  category: 'Pooja & flowers' },
        { name: 'Tulsi',               unit: 'bunch', price: 10,  category: 'Pooja & flowers' },
        { name: 'Marigold',            unit: 'kg',    price: 150, category: 'Pooja & flowers' },
        { name: 'Jasmine',             unit: 'gram',  price: 3,   category: 'Pooja & flowers' },
        { name: 'Rose',                unit: 'piece', price: 10,  category: 'Pooja & flowers' },
        { name: 'Lotus',               unit: 'piece', price: 25,  category: 'Pooja & flowers' },
        { name: 'Chrysanthemum',       unit: 'kg',    price: 180, category: 'Pooja & flowers' },
        { name: 'Arali flowers',       unit: 'bunch', price: 20,  category: 'Pooja & flowers' },
        { name: 'Nandiyavattai',       unit: 'bunch', price: 20,  category: 'Pooja & flowers' },
        { name: 'Flower garland',      unit: 'piece', price: 60,  category: 'Pooja & flowers' },
        { name: 'Coconut (pooja)',     unit: 'piece', price: 30,  category: 'Pooja & flowers' },
        { name: 'Sugarcane (pooja)',   unit: 'piece', price: 40,  category: 'Pooja & flowers' },
      ],
    },
    hotel: {
      key: 'hotel',
      version: 1,
      label: 'Hotel / restaurant',
      outcome: 'a counter that can take a tiffin order and print a bill today',
      prefix: 'H',
      /* ⚠️ COUNTED UNITS — nobody sells a third of a plate, and the bill must never offer to */
      units: ['plate', 'cup', 'piece', 'set'],
      defaultUnit: 'plate',
      categories: ['Tiffin', 'Rice', 'Drinks', 'Sweets'],
      starter: [
        { name: 'Idli',          unit: 'plate', price: 40, category: 'Tiffin' },
        { name: 'Dosa',          unit: 'plate', price: 50, category: 'Tiffin' },
        { name: 'Vada',          unit: 'piece', price: 15, category: 'Tiffin' },
        { name: 'Pongal',        unit: 'plate', price: 55, category: 'Tiffin' },
        { name: 'Upma',          unit: 'plate', price: 45, category: 'Tiffin' },
        { name: 'Poori',         unit: 'plate', price: 50, category: 'Tiffin' },
        { name: 'Curd rice',     unit: 'plate', price: 60, category: 'Rice' },
        { name: 'Lemon rice',    unit: 'plate', price: 60, category: 'Rice' },
        { name: 'Sambar rice',   unit: 'plate', price: 70, category: 'Rice' },
        { name: 'Coffee',        unit: 'cup',   price: 25, category: 'Drinks' },
        { name: 'Tea',           unit: 'cup',   price: 20, category: 'Drinks' },
        { name: 'Sweet',         unit: 'piece', price: 30, category: 'Sweets' },
      ],
    },
  };

  /**
   * ── ⭐⭐⭐ WHAT THE SHOP ACTUALLY CALLS IT (veg@2, 2026-09-27) ───────────────────────────────────────────
   *
   * Athi: *"it has to have all the names and pictures etc, so we should be able to inherit quickly."*
   *
   * ⭐ THIS IS NOT A NEW FIELD — `item_data.synonyms` has been read since August by lib/itemmatch.js (so a
   * WhatsApp order saying "2 kilo thakkali" finds Tomato) and reaches the counter's own search as
   * `synonym_text` in the snapshot. Its own comment names these very words: *"THE SHOP'S OWN WORDS —
   * thakkali, vengayam, milagai... the same word resolved in a message and failed at the counter. One
   * authority, read by both now."* What was missing was any way for a NEW shop to start with them; a
   * greengrocer typing 123 of these by hand will type none of them.
   *
   * ⚠️ ROMANISED, NOT TAMIL SCRIPT, and that is the point rather than a shortcut: this is what somebody
   * types on a counter keyboard at speed, and it is what arrives in a WhatsApp order. Tamil script is a
   * separate pack to add beside this one when a keyboard that produces it is in the picture.
   * ⚠️⚠️ A PRODUCT WITH NO CONFIDENT LOCAL NAME GETS NONE. Broccoli, zucchini and kiwi are called broccoli,
   * zucchini and kiwi; inventing a regional word for them would put a wrong search term in every shop that
   * ever mints this, and the file's own rule already says enrichment is never invented when it is not there.
   * ⭐ Keyed by the blueprint's own product name, so a name edited above without a matching edit here simply
   * loses its synonyms rather than attaching them to the wrong product.
   */
  const LOCAL_NAMES = {
    ta: {
      'Tomato': ['thakkali'], 'Tomato (country)': ['naatu thakkali'],
      'Onion': ['vengayam', 'periya vengayam'], 'Small onion': ['chinna vengayam', 'sambar vengayam'],
      'Spring onion': ['vengaya thaal'], 'Potato': ['urulaikizhangu', 'urulai'],
      'Cabbage': ['muttaikose'], 'Cauliflower': ['poo kose'],
      'Brinjal': ['kathirikkai'], 'Brinjal (green)': ['pachai kathirikkai'],
      'Ladies finger': ['vendakkai'], 'Beans': ['beans'], 'Beans (cluster)': ['kothavarangai'],
      'Beans (broad)': ['avarakkai'], 'Double beans': ['mochai'], 'Green peas': ['pattani'],
      'Capsicum': ['kudamilagai'], 'Drumstick': ['murungakkai'], 'Raw banana': ['vazhaikkai'],
      'Plantain stem': ['vazhaithandu'], 'Banana flower': ['vazhaipoo'], 'Sweet corn': ['makka cholam'],
      'Chow chow': ['seemai kathirikkai'], 'Knol khol': ['noolkol'], 'Coconut': ['thengai'],
      'Bottle gourd': ['sorakkai'], 'Ridge gourd': ['peerkangai'], 'Snake gourd': ['pudalangai'],
      'Bitter gourd': ['pavakkai'], 'Ash gourd': ['poosanikkai'], 'Ivy gourd': ['kovakkai'],
      'Pumpkin': ['parangikkai'], 'Cucumber': ['vellarikkai'], 'Salad cucumber': ['salad vellarikkai'],
      'Beetroot': ['beetroot'], 'Radish': ['mullangi'], 'Sweet potato': ['sakkaravalli kizhangu'],
      'Tapioca': ['maravalli kizhangu'], 'Colocasia': ['seppankizhangu'],
      'Elephant foot yam': ['senaikizhangu'], 'Turmeric (fresh)': ['pachai manjal'],
      'Coriander': ['kothamalli'], 'Mint': ['pudina'], 'Curry leaves': ['karuveppilai'],
      'Spinach': ['pasalai keerai'], 'Amaranth greens': ['mulai keerai'],
      'Gongura': ['pulicha keerai'], 'Fenugreek leaves': ['vendhaya keerai', 'methi'],
      'Dill leaves': ['sathakuppai'], 'Drumstick leaves': ['murungai keerai'],
      'Ginger': ['inji'], 'Garlic': ['poondu'], 'Small garlic': ['naattu poondu'],
      'Green chilli': ['pachai milagai'], 'Bird’s eye chilli': ['kanthari milagai'],
      'Lemon': ['elumichai'], 'Tamarind': ['puli'],
      'Banana': ['vazhaipazham'], 'Banana (yelakki)': ['elakki vazhai'],
      'Banana (robusta)': ['robusta vazhai'], 'Orange': ['kichili'], 'Sweet lime': ['sathukudi'],
      'Grapes (green)': ['pachai thratchai'], 'Grapes (black)': ['karuppu thratchai'],
      'Pomegranate': ['mathulai'], 'Papaya': ['pappali'], 'Guava': ['koyyapazham'],
      'Mango (Banganapalli)': ['banganapalli maampazham'], 'Mango (Alphonso)': ['alphonso maampazham'],
      'Watermelon': ['tharbusani'], 'Muskmelon': ['mulampazham'], 'Pineapple': ['annasi'],
      'Sapota': ['sappota'], 'Custard apple': ['seetha pazham'], 'Jackfruit': ['palapazham'],
      'Tender coconut': ['ilaneer'], 'Button mushroom': ['kaalaan'],
      'Banana leaf': ['vazhai ilai'], 'Mango leaves': ['maa ilai'], 'Betel leaves': ['vetrilai'],
      'Tulsi': ['thulasi'], 'Marigold': ['samanthi'], 'Jasmine': ['malli', 'mullai'],
      'Rose': ['roja'], 'Lotus': ['thamarai'],
      'Long beans': ['karamani', 'thattai payaru'],
      'Flat beans': ['avarai'],
      'Turkey berry': ['sundakkai'],
      'Raw mango': ['pachai mangai'],
      'Raw papaya': ['pachai pappali'],
      'Raw jackfruit': ['pala kai'],
      'Baby brinjal': ['chinna kathirikkai'],
      'Green tomato': ['pachai thakkali'],
      'Pointed gourd': ['kovakkai parwal'],
      'Chinese potato': ['koorka'],
      'Purple yam': ['kaachil'],
      'White yam': ['vellai valli kizhangu'],
      'Arrowroot': ['koova kizhangu'],
      'Turnip': ['knol kizhangu'],
      'Baby potato': ['chinna urulai'],
      'Ginger (tender)': ['ilam inji'],
      'Mustard greens': ['kadugu keerai'],
      'Colocasia leaves': ['seppankizhangu ilai'],
      'Thandu keerai': ['thandu keerai'],
      'Manathakkali keerai': ['manathakkali keerai'],
      'Vallarai keerai': ['vallarai'],
      'Mudakathan keerai': ['mudakathan'],
      'Pirandai': ['pirandai'],
      'Thoothuvalai': ['thoothuvalai'],
      'Green pepper': ['pachai milagu'],
      'Lemongrass': ['elumichai pul'],
      'Ajwain leaves': ['omavalli'],
      'Red chilli (fresh)': ['sivappu milagai'],
      'Gooseberry': ['nellikai'],
      'Jamun': ['naaval pazham'],
      'Wood apple': ['vilam pazham'],
      'Bael fruit': ['vilva pazham'],
      'Indian jujube': ['ilanthai pazham'],
      'Palm fruit': ['nungu'],
      'Sugarcane': ['karumbu'],
      'Ice apple': ['nungu'],
      'Oyster mushroom': ['sippi kaalaan'],
      'Chrysanthemum': ['samanthi poo'],
      'Arali flowers': ['arali'],
      'Flower garland': ['poo maalai'],
      'Coconut (pooja)': ['thengai'],
      'Sugarcane (pooja)': ['karumbu'],
    },
  };
  /**
   * ⚠️ APPLIED ONCE, AT LOAD, so `bp.starter` is already whole — every reader (the route's sample, the mint,
   * a test) sees the same rows, and nothing downstream has to remember to merge a second source.
   */
  function withLocalNames(bp, lang) {
    const pack = LOCAL_NAMES[lang] || null;
    if (!pack) return bp;
    bp.starter.forEach((p) => { const s = pack[p.name]; if (s && s.length) p.synonyms = s.slice(); });
    return bp;
  }

  /** ⭐ never null — an unknown trade gets a neutral one rather than an exception at setup time */
  const NEUTRAL = {
    key: 'general', version: 1, label: 'A shop', outcome: 'a counter that can bill what this shop sells',
    prefix: 'P', units: ['piece', 'kg', 'litre'], defaultUnit: 'piece', categories: [], starter: [],
  };
  /**
   * ── ⭐⭐⭐ THE NUMBER THE WEIGHING SCALE PRINTS (2026-09-27) ────────────────────────────────────────────
   *
   * Athi: *"how this item are connected to the scale? what is measured has to be fed as the input, bar code
   * scanning has to be enabled?"* Driving it proved the chain was broken for exactly this blueprint:
   *
   *   a scale label 2100001007508 decodes fine (lib/scalecode.js: item 1, 750 g) and then till.html's
   *   weighRead() looks for a product whose `code` or `barcode` is "1" — and veg mints `V0001`, so the
   *   counter answered "No product here has the code 1. Check the scale's item number." On EVERY label.
   *
   * ⭐ A SCALE CARRIES DIGITS ONLY — there is nowhere in a barcode to put the 'V'. So the trade that is most
   * likely to own a scale is the one whose starter catalogue could not use one. The V-series stays (it is
   * what a person reads and types); the PLU is a second, numeric handle, which is exactly what weighRead
   * already looks for — it matches `code` OR `barcode`, and the snapshot has always carried `barcode`.
   *
   * ⚠️⚠️ THIS NUMBER MUST ALSO BE PROGRAMMED INTO THE SCALE, and no software can do that from here. What the
   * blueprint can do is propose a numbering the shop can follow, which beats every shop inventing one and
   * discovering the mismatch at the counter. A shop whose scale is already programmed edits these instead.
   * ⚠️ 1-BASED, IN CATALOGUE ORDER, so the printed list a shopkeeper programs from reads 1, 2, 3.
   */
  function withScalePlu(bp) {
    bp.starter.forEach((p, n) => { if (!p.barcode) p.barcode = String(n + 1).padStart(5, '0'); });
    return bp;
  }

  /* ⚠️ ONCE, not per call — blueprint() is called on every read and merging on each one would rewrite the
     same rows repeatedly and make the cost of asking for a blueprint grow with how often it is asked. */
  withLocalNames(BLUEPRINTS.veg, 'ta');
  withScalePlu(BLUEPRINTS.veg);

  function blueprint(key) {
    return BLUEPRINTS[String(key || '').trim().toLowerCase()] || NEUTRAL;
  }

  /* ── ⭐⭐⭐ THE SEQUENCE ─────────────────────────────────────────────────────────────────────────────────── */

  /**
   * nextCode('V', ['V0001','V0007','x']) → 'V0008'
   *
   * ⚠️⚠️ IT READS WHAT EXISTS RATHER THAN COUNTING. A sequence kept as a stored counter drifts the first time a
   * product is deleted, an upload half-fails, or two tabs are open — and then it hands out a code somebody
   * already has. Reading the highest in use cannot drift, because the thing it reads IS the thing it must not
   * collide with.
   *
   * ⚠️ THE SAME LESSON AS THE BILL SERIES, and that one was paid for: two counters both numbering as C1 put
   * duplicate bill numbers into a shop's books ([[project-till-series-prefix]]). A catalogue cannot be allowed
   * to repeat it — which is also why the SERVER allocates, once, at setup. Athi: setup may use the line.
   *
   * ⚠️ A code that is not this prefix + digits is IGNORED, never renumbered. A shop arriving with its own
   * codes — from Tally, from a spreadsheet, from a previous till — keeps them; we number only what we add.
   */
  function nextCode(prefix, existing, width) {
    const p = String(prefix || 'P').trim().toUpperCase();
    const w = Number(width) > 0 ? Number(width) : 4;
    const re = new RegExp('^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)$', 'i');
    let top = 0;
    for (const c of (existing || [])) {
      const m = re.exec(String(c == null ? '' : c).trim());
      if (m) { const n = parseInt(m[1], 10); if (n > top) top = n; }
    }
    const next = top + 1;
    const digits = String(next);
    /* ⚠️ past the width the number keeps growing rather than wrapping — V10000 is ugly and correct; a wrap is a
       collision, and a collision in a catalogue is two products answering to one code. */
    return p + (digits.length >= w ? digits : '0'.repeat(w - digits.length) + digits);
  }

  /**
   * ⭐ codesFor(n, prefix, existing) — a whole upload numbered in one pass, without re-reading between rows.
   * ⚠️ Calling nextCode() in a loop would hand every row the SAME code: it reads `existing`, which has not
   * changed yet. That is the kind of bug that looks fine on a one-row test.
   */
  function codesFor(count, prefix, existing, width) {
    const out = [], seen = (existing || []).slice();
    for (let i = 0; i < Number(count || 0); i++) { const c = nextCode(prefix, seen, width); out.push(c); seen.push(c); }
    return out;
  }

  /* ── ⭐⭐ FROM A FILE, OR FROM NOTHING ──────────────────────────────────────────────────────────────────── */

  /**
   * ⭐ mint(key, existingCodes) — the blueprint's outcome, as products ready to write.
   * ⚠️ It does NOT touch a database. The caller writes them, so the same function fills the counter's preview
   * and the server's commit and the two cannot disagree about what a Veg Store is.
   */
  function mint(key, existingCodes) {
    const bp = blueprint(key);
    const codes = codesFor(bp.starter.length, bp.prefix, existingCodes || []);
    return bp.starter.map((p, i) => ({
      name: p.name, price: p.price, unit: p.unit || bp.defaultUnit,
      /* ⚠️⚠️ A NAME, NOT THE STORED KEY ([TILL-114]). `category` is the legacy field — *"read, never written
         again"* — and [TILL-107] wrote it. The caller resolves this name to a category id and the product
         CITES it, which is the model catalogue-columns describes. */
      categoryName: p.category || null, code: codes[i],
      /* ⚠️ THE PIN, and it is the one thing that cannot be added afterwards: without it the shops minted
         this week cannot be found when veg@2 ships. [[project-version-upgrade]] */
      from: 'blueprint:' + pin(bp),
    }));
  }

  /**
   * ⭐⭐ rowsToProducts(rows, key, existingCodes) — what an uploaded file becomes.
   *
   * ⚠️ IT TAKES ROWS THAT ARE ALREADY MAPPED. The header reconciliation is csv-preflight's job — it knows 14
   * canonical fields and the world's spellings of them, and it produces a report a person APPROVES. Re-deriving
   * any of that here would be a second opinion about what "Rate" means. This is the step after approval.
   *
   * ⚠️⚠️ THE AXIOM IS THE ONLY GATE, AND A BLANK IS NOT A VALUE. A row with a name and a price is accepted; a
 * row missing either is
   * REFUSED WITH ITS ROW NUMBER, never silently dropped. An upload that quietly loses eleven of four hundred
   * products is the worst outcome available here, because nobody discovers it until a customer asks for one.
   * [[feedback-whitelist-drops-silently]]
   */
  function rowsToProducts(rows, key, existingCodes, opts) {
    const bp = blueprint(key);
    const list = Array.isArray(rows) ? rows : [];
    const ok = [], refused = [];
    /**
     * ⚠️⚠️⚠️ AN EMPTY CELL IS NOT ZERO. `Number('')` is 0 and 0 is finite, so the first cut of this
     * accepted a row whose price cell was blank and priced the product at nothing — goods given away, with a
     * clean-looking import report. The blank is caught BEFORE the number is read, never after.
     */
    const num = (v) => {
      const raw = String(v == null ? '' : v).trim();
      if (!raw) return null;
      const cleaned = raw.replace(/[^0-9.\-]/g, '');
      if (!cleaned || cleaned === '-' || cleaned === '.') return null;   /* "Rs", "--", "n/a" are not numbers */
      const n = Number(cleaned);
      return Number.isFinite(n) ? n : null;
    };
    /* ⭐ units.js knows that Kg, kg and KGM are one unit — INJECTED, so this file still loads in a browser */
    const unitOf = (opts && typeof opts.unitOf === 'function') ? opts.unitOf : null;

    list.forEach((r, i) => {
      const row = r || {};
      const name = String(row.name == null ? '' : row.name).trim();
      const price = num(row.price);
      const why = [];
      if (!name) why.push('no name');
      if (price == null) why.push('no price');
      else if (price < 0) why.push('a negative price');
      if (why.length) { refused.push({ row: i + 1, why: why.join(' and '), had: row }); return; }
      ok.push({ row: i + 1, raw: row, name: name, price: price });
    });

    /* ⚠️ numbered only AFTER the refusals are known, so a refused row does not burn a code */
    const needCode = ok.filter((p) => !String((p.raw.code || p.raw.sku || '')).trim());
    const fresh = codesFor(needCode.length, bp.prefix, existingCodes || []);
    let f = 0;

    const products = ok.map((p) => {
      const given = String((p.raw.code || p.raw.sku || '')).trim();
      const out = {
        name: p.name, price: p.price,
        /* ⚠️ one spelling per unit, decided by units.js and not by whatever the spreadsheet happened to type */
        unit: (function (u) {
          const given = String(u || '').trim();
          if (!given) return bp.defaultUnit;
          return (unitOf && unitOf(given)) || given.toLowerCase();
        })(p.raw.unit),
        /* ⚠️ likewise for an uploaded row — a name the caller resolves, never the legacy key ([TILL-114]) */
        categoryName: String(p.raw.category || '').trim() || null,
        code: given || fresh[f++],
        /* ⚠️ an upload is pinned too — the blueprint supplied its default unit and its code series */
        from: (given ? 'file:own-code' : 'file:numbered') + ' · ' + pin(bp),
      };
      /**
       * ⭐ enrichment travels when it is there and is never invented when it is not
       *
       * ⚠️⚠️ `synonyms` AND `image` WERE NOT ON THIS LIST UNTIL 2026-09-27, AND THIS LIST IS A WHITELIST — so
       * a blueprint row or an uploaded sheet carrying either had it dropped here, in silence, and the mint
       * still reported every row kept. Athi, asking for a catalogue a shop can inherit whole: *"it has to
       * have all the names and pictures etc"* and *"are there synonyms and other data required for that?"* —
       * the answer was yes, the fields exist and are read (see below), and this one line was eating them.
       * [[feedback-whitelist-drops-silently]] — checked by running it, not by reading it.
       *
       * ⭐ WHY THEY BELONG: `synonyms` is the shop's own words (thakkali, vengayam) and is ALREADY read by
       * lib/itemmatch.js for WhatsApp orders and by the counter's own search via the snapshot's
       * `synonym_text`. A name that resolved in a WhatsApp message and failed at the counter was the bug that
       * field was added to fix; a starter catalogue that cannot carry it makes every new shop start with it
       * empty. `image` is the one field that decides whether a tile shows a photograph or its monogram.
       * ⚠️ AN ARRAY IS NOT A STRING: `synonyms` arrives as one, so the emptiness test is per-type. The old
       * String(v).trim() test would pass ['a'] by accident and [] by accident too.
       */
      for (const k of ['hsn', 'gst_rate', 'mrp', 'desc', 'qty', 'synonyms', 'image', 'barcode']) {
        const v = p.raw[k];
        if (v === undefined || v === null) continue;
        if (Array.isArray(v)) { if (v.length) out[k] = v; continue; }
        if (String(v).trim() !== '') out[k] = v;
      }
      return out;
    });

    return { products, refused, blueprint: bp.key, kept: products.length, lost: refused.length };
  }

  const API = {
    VERSION: VERSION, pin: pin,
    AXIOM: AXIOM, ENRICH: ENRICH, BLUEPRINTS: BLUEPRINTS, NEUTRAL: NEUTRAL,
    blueprint: blueprint, nextCode: nextCode, codesFor: codesFor, mint: mint, rowsToProducts: rowsToProducts,
  };

module.exports = API;
