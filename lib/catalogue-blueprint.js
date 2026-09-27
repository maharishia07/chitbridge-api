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
      /**
       * ⭐⭐ v3 (2026-09-27) — THE BULK ROW. Athi, looking at the unit filter: *"under vegetable, no crate
       * or bigger units are present?"* No, and he is right that a greengrocer needs them: a shop buys a
       * sack of potatoes and a box of tomatoes, and plenty sell them on that way too. Fourteen bulk rows
       * now sit beside their own kg row as siblings, in `bag` and `box`.
       *
       * ⚠️⚠️ NOT `crate`, AND THAT IS NOT AN OVERSIGHT. It was tried on 2026-09-27 and tests/units-alias
       * refused it: a crate is a near neighbour of box, and lib/ai.js states the rule — *"never a near
       * neighbour (crate for box), because a near neighbour IS a conversion, not a spelling"*. A crate has
       * no fixed size, so a shop declares its own with a factor (the alias mechanism) rather than the
       * platform pretending one crate means one thing everywhere. `bag` and `box` are real units with real
       * UQC codes; `crate` would have been a word standing in for an unknown quantity.
       *
       * ⚠️ THE PLUs RENUMBER, which is exactly why this is v3 and not an edit of v2. Scale PLUs are assigned
       * by position, so inserting a row shifts every one after it — and a shop that has already programmed
       * its scale from veg@2 must not have the numbers move underneath it. It does not: a shop stays on
       * what it adopted. [[project-version-upgrade]]
       */
      version: 3,
      label: 'Vegetables & fruit',
      /* ⭐ THE OUTCOME. Without one this is not a blueprint. */
      outcome: 'a counter that can weigh, price and bill fresh produce today',
      prefix: 'V',
      /* ⚠️ MEASURED UNITS FIRST — this is the entire difference between the two trades, and it is data.
         ⭐ `pack` and `dozen` earn their place in v2 with the cut/packed shelf: they are COUNTED, so the
         counter refuses a fraction of them on its own, with no branch anywhere. That contrast — kg beside
         pack on one bill — is the axiom being exercised rather than described. */
      units: ['kg', 'gram', 'bunch', 'piece', 'pack', 'dozen', 'bag', 'box'],
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
        { name: 'Tomato',              unit: 'box',   price: 520, category: 'Vegetables' },
        { name: 'Tomato (country)',    unit: 'kg',    price: 55,  category: 'Vegetables' },
        { name: 'Onion',               unit: 'kg',    price: 30,  category: 'Vegetables' },
        { name: 'Onion',               unit: 'bag',   price: 1250, category: 'Vegetables' },
        { name: 'Small onion',         unit: 'kg',    price: 90,  category: 'Vegetables' },
        { name: 'Small onion',         unit: 'bag',   price: 850, category: 'Vegetables' },
        { name: 'Spring onion',        unit: 'bunch', price: 20,  category: 'Vegetables' },
        { name: 'Potato',              unit: 'kg',    price: 35,  category: 'Vegetables' },
        { name: 'Potato',              unit: 'bag',   price: 1400, category: 'Vegetables' },
        { name: 'Cabbage',             unit: 'kg',    price: 30,  category: 'Vegetables' },
        { name: 'Cabbage',             unit: 'bag',   price: 600, category: 'Vegetables' },
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
        { name: 'Coconut',             unit: 'bag',   price: 1150, category: 'Vegetables' },
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
        { name: 'Carrot',              unit: 'box',   price: 1100, category: 'Roots & tubers' },
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
        { name: 'Ginger',              unit: 'bag',   price: 3000, category: 'Herbs & aromatics' },
        { name: 'Garlic',              unit: 'kg',    price: 220, category: 'Herbs & aromatics' },
        { name: 'Small garlic',        unit: 'kg',    price: 320, category: 'Herbs & aromatics' },
        { name: 'Green chilli',        unit: 'kg',    price: 60,  category: 'Herbs & aromatics' },
        { name: 'Green chilli',        unit: 'bag',   price: 550, category: 'Herbs & aromatics' },
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
        { name: 'Banana',              unit: 'box',   price: 600, category: 'Fruit' },
        { name: 'Banana (yelakki)',    unit: 'kg',    price: 70,  category: 'Fruit' },
        { name: 'Banana (robusta)',    unit: 'dozen', price: 60,  category: 'Fruit' },
        { name: 'Apple',               unit: 'kg',    price: 200, category: 'Fruit' },
        { name: 'Apple',               unit: 'box',   price: 1800, category: 'Fruit' },
        { name: 'Apple (Shimla)',      unit: 'kg',    price: 180, category: 'Fruit' },
        { name: 'Orange',              unit: 'kg',    price: 120, category: 'Fruit' },
        { name: 'Orange',              unit: 'box',   price: 1100, category: 'Fruit' },
        { name: 'Sweet lime',          unit: 'kg',    price: 100, category: 'Fruit' },
        { name: 'Grapes (green)',      unit: 'kg',    price: 90,  category: 'Fruit' },
        { name: 'Grapes (green)',      unit: 'box',   price: 700, category: 'Fruit' },
        { name: 'Grapes (black)',      unit: 'kg',    price: 110, category: 'Fruit' },
        { name: 'Pomegranate',         unit: 'kg',    price: 180, category: 'Fruit' },
        { name: 'Papaya',              unit: 'kg',    price: 50,  category: 'Fruit' },
        { name: 'Guava',               unit: 'kg',    price: 80,  category: 'Fruit' },
        { name: 'Mango (Banganapalli)', unit: 'kg',   price: 150, category: 'Fruit' },
        { name: 'Mango (Banganapalli)', unit: 'box',  price: 1400, category: 'Fruit' },
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
    /**
     * ⭐⭐ THE LISTS ARE NOT SHOP TYPES (2026-09-27). Athi: *"product lab is what we create as a product list,
     * for example, veg, egg, fish, chicken, meat and so on."* A butcher adopts meat and chicken; a
     * supermarket adopts all five; a greengrocer adopts veg and maybe egg. So these COMPOSE — which is the
     * whole reason mintPlan() had to become additive, because the second list a shop adopts arrives when the
     * shop is no longer empty.
     *
     * ⚠️ THE SAME PRODUCT IN TWO UNITS IS TWO ROWS. Athi: *"if multiple units are there, each one, one row,
     * they can choose."* An egg is sold by the piece AND by the dozen AND by the thirty-tray, at prices that
     * are not multiples of each other, and a shop picks the one it actually sells in. One row per unit is the
     * only shape that lets them choose rather than be given a conversion nobody asked for.
     * ⚠️ WHICH IS WHY 'ALREADY SELLS IT' IS KEYED ON NAME **AND** UNIT — see mintPlan. A shop selling eggs by
     * the piece must still be offered the dozen.
     */
    egg: {
      key: 'egg', version: 1, label: 'Eggs',
      outcome: 'a counter that can sell eggs by the piece, the dozen or the tray today',
      prefix: 'E',
      units: ['piece', 'dozen', 'box', 'pack'],
      defaultUnit: 'piece',
      categories: ['Hen eggs', 'Other eggs', 'Ready to eat'],
      starter: [
        { name: 'Hen egg (white)',   unit: 'piece', price: 6,   category: 'Hen eggs' },
        { name: 'Hen egg (white)',   unit: 'dozen', price: 70,  category: 'Hen eggs' },
        { name: 'Hen egg (white)',   unit: 'box',   price: 165, category: 'Hen eggs' },
        { name: 'Hen egg (brown)',   unit: 'piece', price: 8,   category: 'Hen eggs' },
        { name: 'Hen egg (brown)',   unit: 'dozen', price: 90,  category: 'Hen eggs' },
        { name: 'Country egg',       unit: 'piece', price: 15,  category: 'Hen eggs' },
        { name: 'Country egg',       unit: 'dozen', price: 170, category: 'Hen eggs' },
        { name: 'Free range egg',    unit: 'piece', price: 12,  category: 'Hen eggs' },
        { name: 'Free range egg',    unit: 'dozen', price: 140, category: 'Hen eggs' },
        { name: 'Omega-3 egg',       unit: 'dozen', price: 150, category: 'Hen eggs' },
        { name: 'Kadaknath egg',     unit: 'piece', price: 35,  category: 'Other eggs' },
        { name: 'Duck egg',          unit: 'piece', price: 12,  category: 'Other eggs' },
        { name: 'Duck egg',          unit: 'dozen', price: 140, category: 'Other eggs' },
        { name: 'Quail egg',         unit: 'piece', price: 5,   category: 'Other eggs' },
        { name: 'Quail egg',         unit: 'pack',  price: 50,  category: 'Other eggs' },
        { name: 'Turkey egg',        unit: 'piece', price: 40,  category: 'Other eggs' },
        { name: 'Boiled egg',        unit: 'piece', price: 15,  category: 'Ready to eat' },
        { name: 'Egg white (packed)', unit: 'pack', price: 90,  category: 'Ready to eat' },
      ],
    },
    chicken: {
      key: 'chicken', version: 1, label: 'Chicken',
      outcome: 'a counter that can weigh and bill a bird, cut or whole, today',
      prefix: 'C',
      units: ['kg', 'gram', 'piece', 'pack'],
      defaultUnit: 'kg',
      categories: ['Whole bird', 'Cuts', 'Offal', 'Ready to cook'],
      starter: [
        { name: 'Broiler chicken (live)',      unit: 'kg',    price: 140, category: 'Whole bird' },
        { name: 'Broiler chicken (with skin)', unit: 'kg',    price: 180, category: 'Whole bird' },
        { name: 'Broiler chicken (skinless)',  unit: 'kg',    price: 220, category: 'Whole bird' },
        { name: 'Whole chicken (dressed)',     unit: 'piece', price: 380, category: 'Whole bird' },
        { name: 'Country chicken',             unit: 'kg',    price: 420, category: 'Whole bird' },
        { name: 'Kadaknath chicken',           unit: 'kg',    price: 900, category: 'Whole bird' },
        { name: 'Chicken curry cut',           unit: 'kg',    price: 240, category: 'Cuts' },
        { name: 'Chicken curry cut (skinless)', unit: 'kg',   price: 260, category: 'Cuts' },
        { name: 'Chicken breast (boneless)',   unit: 'kg',    price: 320, category: 'Cuts' },
        { name: 'Chicken thigh (boneless)',    unit: 'kg',    price: 340, category: 'Cuts' },
        { name: 'Chicken leg',                 unit: 'kg',    price: 260, category: 'Cuts' },
        { name: 'Chicken drumstick',           unit: 'kg',    price: 280, category: 'Cuts' },
        { name: 'Chicken wings',               unit: 'kg',    price: 240, category: 'Cuts' },
        { name: 'Chicken mince',               unit: 'kg',    price: 300, category: 'Cuts' },
        { name: 'Chicken liver',               unit: 'kg',    price: 160, category: 'Offal' },
        { name: 'Chicken gizzard',             unit: 'kg',    price: 140, category: 'Offal' },
        { name: 'Chicken skin',                unit: 'kg',    price: 80,  category: 'Offal' },
        { name: 'Chicken bones (soup)',        unit: 'kg',    price: 60,  category: 'Offal' },
        { name: 'Chicken lollipop',            unit: 'kg',    price: 320, category: 'Ready to cook' },
        { name: 'Chicken 65 cut',              unit: 'kg',    price: 280, category: 'Ready to cook' },
        { name: 'Marinated tikka cut',         unit: 'pack',  price: 220, category: 'Ready to cook' },
      ],
    },
    fish: {
      key: 'fish', version: 1, label: 'Fish & seafood',
      outcome: 'a counter that can weigh, clean and bill the day\u2019s catch',
      prefix: 'F',
      units: ['kg', 'gram', 'piece', 'pack'],
      defaultUnit: 'kg',
      categories: ['Sea fish', 'Fresh water', 'Shellfish', 'Dried', 'Cleaned & cut'],
      starter: [
        { name: 'Seer fish',        unit: 'kg',   price: 900, category: 'Sea fish' },
        { name: 'Pomfret (white)',  unit: 'kg',   price: 800, category: 'Sea fish' },
        { name: 'Pomfret (black)',  unit: 'kg',   price: 600, category: 'Sea fish' },
        { name: 'Sardine',          unit: 'kg',   price: 180, category: 'Sea fish' },
        { name: 'Mackerel',         unit: 'kg',   price: 240, category: 'Sea fish' },
        { name: 'Anchovy',          unit: 'kg',   price: 220, category: 'Sea fish' },
        { name: 'Barracuda',        unit: 'kg',   price: 420, category: 'Sea fish' },
        { name: 'Red snapper',      unit: 'kg',   price: 480, category: 'Sea fish' },
        { name: 'Sole fish',        unit: 'kg',   price: 400, category: 'Sea fish' },
        { name: 'Tuna',             unit: 'kg',   price: 350, category: 'Sea fish' },
        { name: 'Kingfish steak',   unit: 'kg',   price: 950, category: 'Sea fish' },
        { name: 'Rohu',             unit: 'kg',   price: 260, category: 'Fresh water' },
        { name: 'Katla',            unit: 'kg',   price: 280, category: 'Fresh water' },
        { name: 'Tilapia',          unit: 'kg',   price: 220, category: 'Fresh water' },
        { name: 'Murrel',           unit: 'kg',   price: 500, category: 'Fresh water' },
        { name: 'Catla head',       unit: 'piece', price: 180, category: 'Fresh water' },
        { name: 'Prawns (small)',   unit: 'kg',   price: 350, category: 'Shellfish' },
        { name: 'Prawns (medium)',  unit: 'kg',   price: 500, category: 'Shellfish' },
        { name: 'Prawns (tiger)',   unit: 'kg',   price: 900, category: 'Shellfish' },
        { name: 'Crab',             unit: 'kg',   price: 600, category: 'Shellfish' },
        { name: 'Squid',            unit: 'kg',   price: 420, category: 'Shellfish' },
        { name: 'Cuttlefish',       unit: 'kg',   price: 400, category: 'Shellfish' },
        { name: 'Mussels',          unit: 'kg',   price: 180, category: 'Shellfish' },
        { name: 'Clams',            unit: 'kg',   price: 150, category: 'Shellfish' },
        { name: 'Dried anchovy',    unit: 'kg',   price: 600, category: 'Dried' },
        { name: 'Dried sardine',    unit: 'kg',   price: 500, category: 'Dried' },
        { name: 'Dried prawns',     unit: 'gram', price: 1.2, category: 'Dried' },
        { name: 'Fish fillet',      unit: 'pack', price: 250, category: 'Cleaned & cut' },
        { name: 'Fish curry cut',   unit: 'kg',   price: 320, category: 'Cleaned & cut' },
      ],
    },
    meat: {
      key: 'meat', version: 1, label: 'Meat',
      outcome: 'a counter that can weigh and bill mutton and the rest of the board today',
      prefix: 'M',
      units: ['kg', 'gram', 'piece'],
      defaultUnit: 'kg',
      /**
       * ⚠️ BEEF AND PORK ARE ON THE LIST AND THAT IS NOT A STATEMENT ABOUT ANY SHOP. They are ordinary goods
       * in much of the country and not sold at all in the rest, which is exactly why the whole screen is
       * checkboxes: a shop adopts the shelves it sells and leaves the others unticked. A list that quietly
       * omitted them would be a worse answer than one a shop can decline.
       */
      categories: ['Goat & sheep', 'Offal', 'Pork', 'Beef', 'Ready to cook'],
      starter: [
        { name: 'Mutton curry cut',   unit: 'kg',    price: 900,  category: 'Goat & sheep' },
        { name: 'Mutton boneless',    unit: 'kg',    price: 1100, category: 'Goat & sheep' },
        { name: 'Mutton chops',       unit: 'kg',    price: 950,  category: 'Goat & sheep' },
        { name: 'Mutton ribs',        unit: 'kg',    price: 850,  category: 'Goat & sheep' },
        { name: 'Mutton keema',       unit: 'kg',    price: 950,  category: 'Goat & sheep' },
        { name: 'Lamb curry cut',     unit: 'kg',    price: 950,  category: 'Goat & sheep' },
        { name: 'Goat head',          unit: 'piece', price: 400,  category: 'Goat & sheep' },
        { name: 'Mutton liver',       unit: 'kg',    price: 700,  category: 'Offal' },
        { name: 'Mutton kidney',      unit: 'kg',    price: 600,  category: 'Offal' },
        { name: 'Mutton brain',       unit: 'piece', price: 120,  category: 'Offal' },
        { name: 'Mutton trotters',    unit: 'piece', price: 100,  category: 'Offal' },
        { name: 'Bone (soup)',        unit: 'kg',    price: 300,  category: 'Offal' },
        { name: 'Pork belly',         unit: 'kg',    price: 450,  category: 'Pork' },
        { name: 'Pork chops',         unit: 'kg',    price: 500,  category: 'Pork' },
        { name: 'Pork mince',         unit: 'kg',    price: 480,  category: 'Pork' },
        { name: 'Beef curry cut',     unit: 'kg',    price: 400,  category: 'Beef' },
        { name: 'Beef boneless',      unit: 'kg',    price: 520,  category: 'Beef' },
        { name: 'Beef mince',         unit: 'kg',    price: 460,  category: 'Beef' },
        { name: 'Marinated mutton',   unit: 'kg',    price: 1000, category: 'Ready to cook' },
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
      'Hen egg (white)': ['muttai', 'kozhi muttai'],
      'Hen egg (brown)': ['brown muttai'],
      'Country egg': ['naattu kozhi muttai'],
      'Duck egg': ['vaathu muttai'],
      'Quail egg': ['kaadai muttai'],
      'Boiled egg': ['vevitha muttai'],
      'Broiler chicken (live)': ['kozhi'],
      'Broiler chicken (with skin)': ['broiler kozhi'],
      'Country chicken': ['naattu kozhi'],
      'Chicken curry cut': ['kozhi kari'],
      'Chicken liver': ['kozhi eeral'],
      'Chicken mince': ['kozhi keema'],
      'Seer fish': ['vanjaram'],
      'Pomfret (white)': ['vellai vavval'],
      'Pomfret (black)': ['karuppu vavval'],
      'Sardine': ['mathi'],
      'Mackerel': ['ayila'],
      'Anchovy': ['nethili'],
      'Barracuda': ['sheela'],
      'Red snapper': ['sankara'],
      'Sole fish': ['nangu'],
      'Murrel': ['viral meen'],
      'Prawns (small)': ['chinna iraal'],
      'Prawns (medium)': ['iraal'],
      'Prawns (tiger)': ['periya iraal'],
      'Crab': ['nandu'],
      'Squid': ['kanava'],
      'Dried anchovy': ['nethili karuvadu'],
      'Dried sardine': ['mathi karuvadu'],
      'Mutton curry cut': ['aattu kari'],
      'Mutton boneless': ['elumbu illatha aattu kari'],
      'Mutton liver': ['aattu eeral'],
      'Mutton brain': ['aattu moolai'],
      'Mutton trotters': ['aattu kaal'],
      'Goat head': ['aattu thalai'],
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
  /**
   * ⭐⭐⭐ NAMES ARE HELD BY LANGUAGE, AND FLATTENED ONLY WHEN A SHOP ADOPTS (2026-09-27).
   *
   * Athi: *"there they can choose the synonym language as well... say english, tamil and hindi or english,
   * malayalam and hindi or english, bengali and hindi, like that."* So the LIST cannot be tied to a language
   * any more than it is tied to a currency — a Kerala shop and a Bengal shop adopt the same tomato and want
   * different words for it.
   *
   * ⚠️ `p.names` IS THE BLUEPRINT'S SHAPE; `synonyms` IS THE PRODUCT'S. item_data.synonyms is a FLAT list —
   * that is what lib/itemmatch.js matches a WhatsApp order against and what the counter's search reads as
   * `synonym_text`, and neither wants to know which language a word came from. So the pack keeps them apart
   * and mintPlan() flattens exactly the languages that were asked for. Storing the flat list here instead
   * would mean every shop inheriting every language, which is noise in the search box for all but one.
   */
  function withLocalNames(bp) {
    bp.starter.forEach((p) => {
      const names = {};
      for (const lang of Object.keys(LOCAL_NAMES)) {
        const s = LOCAL_NAMES[lang][p.name];
        if (s && s.length) names[lang] = s.slice();
      }
      if (Object.keys(names).length) p.names = names;
    });
    return bp;
  }
  /** ⭐ which languages a list can actually be adopted in — asked of the data, never a second hand-kept list */
  function languagesOf(key) {
    const bp = blueprint(key);
    const seen = new Set();
    bp.starter.forEach((p) => Object.keys(p.names || {}).forEach((l) => seen.add(l)));
    return [...seen].sort();
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

  /**
   * ⭐ PICTURES, keyed by product name like LOCAL_NAMES — so every size of one product (Tomato kg, Tomato
   * box) shows the same photograph, and a renamed product loses its picture rather than wearing another's.
   *
   * ⚠️⚠️ DEMO ONLY (2026-09-27). Athi: *"just for the demo purpose, copy the veg photo here, just for those
   * 9 items.. will see how to fill it later"*. Taken from a public gist (ChrisNjubi/1d3c5ac9…, no licence)
   * whose images came from free-PNG aggregator sites. NOT cleared for a product: replace with openly
   * licensed photos before any shop outside a demo adopts this list. Copied into chitbridge-web/pics/veg/
   * rather than hot-linked, so a foreign site moving a file cannot blank a tile mid-demo.
   * ⚠️ The gist's "celeriac" picture is celery, so it sits on Celery.
   * ⚠️ Adding a picture moves no row, so no scale PLU shifts and this stays veg@3 — unlike the bulk rows.
   */
  const PICS = 'https://chitbridge-web.vercel.app/pics/veg/';
  const PICTURES = {
    veg: {
      'Cabbage': 'cabbage.webp', 'Capsicum': 'capsicum.jpg', 'Garlic': 'garlic.webp',
      'Beetroot': 'beetroot.png', 'Tomato': 'tomato.webp', 'Celery': 'celery.png',
      'Carrot': 'carrot.webp', 'Onion': 'onion.webp', 'Potato': 'potato.webp',
    },
  };
  function withPictures(bp) {
    const map = PICTURES[bp.key];
    if (map) bp.starter.forEach((p) => { if (map[p.name] && !p.image) p.image = PICS + map[p.name]; });
    return bp;
  }

  /* ⚠️ ONCE, not per call — blueprint() is called on every read and merging on each one would rewrite the
     same rows repeatedly and make the cost of asking for a blueprint grow with how often it is asked. */
  /* ⚠️ EVERY LIST, not just veg — a fish counter has a scale too, and "vanjaram" is as much a word a
     shopkeeper types as "thakkali". Iterated over the table so a list added LATER cannot be forgotten
     here — which is exactly how veg’s own PLUs would have been missed. [[product lab inherits more]] */
  for (const k of Object.keys(BLUEPRINTS)) { withLocalNames(BLUEPRINTS[k]); withScalePlu(BLUEPRINTS[k]); withPictures(BLUEPRINTS[k]); }


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
  /**
   * ── ⭐⭐⭐ ONE LIST, TWO DOORS ([found 2026-09-27, before it shipped]) ──────────────────────────────────
   *
   * A product can arrive two ways — MINTED from a starter pack, or UPLOADED from a sheet — and each door had
   * its own idea of which fields to carry. rowsToProducts() had a list; mint() had none, it rebuilt six fields
   * by hand. So the synonyms and scale PLUs added to veg@2 that morning survived an upload and were silently
   * dropped by the mint, which is the door every new shop actually uses. They would have reached nobody.
   *
   * ⚠️⚠️ AND I PROVED IT THROUGH THE WRONG DOOR FIRST — ran rowsToProducts(bp.starter) and watched `synonyms`
   * come out the far end, which proves the upload path and says nothing about the mint. Driving the control a
   * shop actually presses is the only check that counts. [[feedback-probe-through-the-gate]]
   *
   * ⭐ So the list lives in ONE place and both doors call it. A field added here works however a product
   * arrives; a field added to one door only is the bug above, waiting. [[feedback-no-duplicate-functions]]
   */
  const CARRIED = ['hsn', 'gst_rate', 'mrp', 'desc', 'qty', 'synonyms', 'image', 'barcode'];
  /** ⚠️ AN ARRAY IS NOT A STRING — String(['a']) is truthy and String([]) is '', so the test is per-type. */
  function carry(out, raw) {
    const src = raw || {};
    for (const k of CARRIED) {
      const v = src[k];
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) { if (v.length) out[k] = v.slice(); continue; }
      if (String(v).trim() !== '') out[k] = v;
    }
    return out;
  }

  /**
   * ── ⭐⭐⭐ INHERIT SOME OF IT, ON TOP OF WHAT IS ALREADY THERE (2026-09-27) ─────────────────────────────
   *
   * Athi: *"without much effort a shop should be able to inherit common products, and we can make it
   * specialise for the specific category."* The mint could not do either. It was all-or-nothing — the whole
   * pack or none of it — and the route refused outright if the shop had so much as one product already
   * ("This shop already has 12 products"). A greengrocer who had typed in their own twenty could not take the
   * greens shelf at all, and nobody wanting only Gourds and Greens could say so.
   *
   * ⭐ TWO OPTIONS, AND BOTH ARE JUST FILTERS — no new concept, no second mint:
   *   `categories`  take only these shelves. THIS is "specialise for the specific category".
   *   `skipNames`   what the shop already sells, matched case- and space-insensitively, left alone.
   *
   * ⚠️ SKIPPED, NOT REFUSED, and the difference is the whole feature. A shop with its own Tomato should get
   * the other 201 products and be told Tomato was left alone — not be turned away at the door because one
   * name collided. ⚠️ The report is returned rather than logged, because "what did it actually add?" is the
   * question a person asks straight afterwards and a silent answer is how this rots.
   */
  function mintPlan(key, existingCodes, opts) {
    const o = opts || {};
    const bp = blueprint(key);
    const norm = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
    const want = Array.isArray(o.categories) && o.categories.length
      ? new Set(o.categories.map(norm)) : null;
    /**
     * ⚠️⚠️ KEYED ON NAME **AND** UNIT (2026-09-27). Athi: *"if multiple units are there, each one, one row,
     * they can choose."* An egg is a row by the piece, a row by the dozen and a row by the tray, at prices
     * that are not multiples of one another. Keyed on the name alone, a shop that already sells eggs by the
     * piece would be refused the dozen — which is the one thing the row-per-unit shape exists to offer.
     * ⭐ A caller that only knows names still works: a bare name matches any unit, because a shop saying
     * "I sell Tomato" and meaning it in every unit is the commoner case than one meaning kg specifically.
     */
    const rowKey = (name, unit) => norm(name) + '' + norm(unit);
    const have = new Set(), haveAnyUnit = new Set();
    for (const h of (o.skipNames || [])) {
      if (h && typeof h === 'object') have.add(rowKey(h.name, h.unit));
      else haveAnyUnit.add(norm(h));
    }

    const skipped = [];
    const take = bp.starter.filter((p) => {
      if (want && !want.has(norm(p.category))) return false;
      const unit = p.unit || bp.defaultUnit;
      if (have.has(rowKey(p.name, unit)) || haveAnyUnit.has(norm(p.name))) {
        skipped.push({ name: p.name, unit: unit, why: 'this shop already sells it' });
        return false;
      }
      return true;
    });
    /* ⚠️ NUMBERED FOR WHAT IS ACTUALLY TAKEN, so a skipped product does not burn a code — the same rule
       rowsToProducts already applies to a refused row. */
    const codes = codesFor(take.length, bp.prefix, existingCodes || []);
    /**
     * ⭐ THE LANGUAGES THIS SHOP ASKED FOR. Default is NONE of them: a shop that says nothing gets the
     * product's own name and no extra words in its search box, which is the honest default for a list that
     * belongs to no language. ⚠️ 'en' is not a pack — the product's `name` IS the English one, and adding a
     * pack that repeated it would put every name in twice.
     */
    const langs = Array.isArray(o.languages) ? o.languages.filter((l) => l && l !== 'en') : [];
    const items = take.map((p, i) => {
      const out = carry({
        name: p.name, price: p.price, unit: p.unit || bp.defaultUnit,
        categoryName: p.category || null, code: codes[i],
        from: 'blueprint:' + pin(bp),
      }, p);
      /* ⚠️ FLATTENED HERE, and deduped — two languages can legitimately share a word, and the same word
         twice in a search index is a row that matches twice and reads as a duplicate product. */
      const words = [];
      for (const l of langs) for (const w of ((p.names && p.names[l]) || [])) {
        if (words.indexOf(w) < 0) words.push(w);
      }
      if (words.length) out.synonyms = words; else delete out.synonyms;
      return out;
    });
    return { items, skipped, pin: pin(bp), blueprint: bp.key, languages: langs,
             categories: [...new Set(take.map((p) => p.category).filter(Boolean))] };
  }

  /** ⚠️ the whole pack, unchanged — every existing caller keeps working, and there is still one mint under it */
  function mint(key, existingCodes) {
    return mintPlan(key, existingCodes, {}).items;
  }

  /* ⚠️⚠️ THE TWO RULES THAT USED TO LIVE IN mint()'s BODY, kept because they are the reasons, not decoration:
     · categoryName is A NAME, NOT THE STORED KEY ([TILL-114]). `category` is the legacy field — "read, never
       written again" — and [TILL-107] wrote it. The caller resolves the name and the product CITES the id.
     · `from` carries THE PIN, and it is the one thing that cannot be added afterwards: without it the shops
       minted this week cannot be found when veg@3 ships. [[project-version-upgrade]] */

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
      return carry(out, p.raw);   /* ⭐ the SAME list the mint carries — see CARRIED */
    });

    return { products, refused, blueprint: bp.key, kept: products.length, lost: refused.length };
  }

  const API = {
    VERSION: VERSION, pin: pin,
    AXIOM: AXIOM, ENRICH: ENRICH, BLUEPRINTS: BLUEPRINTS, NEUTRAL: NEUTRAL,
    blueprint: blueprint, nextCode: nextCode, codesFor: codesFor, mint: mint, rowsToProducts: rowsToProducts,
    /* ⭐ the partial, additive mint — see mintPlan. CARRIED is exported so a caller can SAY what travels. */
    mintPlan: mintPlan, CARRIED: CARRIED,
    languagesOf: languagesOf,
  };

module.exports = API;
