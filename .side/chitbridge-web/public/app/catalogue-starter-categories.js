/**
 * app/catalogue-starter-categories.js — A SMALL STANDARD SET OF CATEGORIES, PER TRADE.
 *
 * Athi, 2026-08-16: *"seed the small standard set first… bring the proper standard here."*
 *
 * ⭐ EVERY NODE IS REAL. Names and `gid` come from the **Google Product Taxonomy** (version 2021-09-21, the
 * full 5,595-row file is kept at REF-google-product-taxonomy-2021-09-21.txt). Nothing here was invented,
 * and no id was guessed — an invented classification code is worse than none, because it looks citable.
 *
 * ⚠️ THE SHAPE MIRRORS lib/starter-fields.js ON THE SERVER, which already does exactly this for COLUMNS
 * (`starterFor(vertical)` · gold · coffee · pharma · paint · veg · retail · trade). Same verticals, same idea:
 * a trade's usual starting point, extended by the merchant afterwards. A second shape for the same concept is
 * how two lists of "what this trade needs" drift apart.
 *
 * ⚠️ OPT-IN, NEVER AUTOMATIC. A shelf that arrives pre-filled is worse than an empty one — Akeneo ships its demo
 * tree as an opt-in fixture for the same reason. This file is DATA; the seeding action asks first.
 *
 * ⚠️ `gid` IS THE TAXONOMY'S id, NOT OURS. It is kept so a category can later carry its standard code (and a
 * GS1 GPC brick beside it) rather than being re-matched by name. `parent` refers to a `gid` in the same set.
 *
 * ⚠️ SMALL ON PURPOSE. Full-scale seeding is blocked by UNIQUE (entity_id, kind, name) on `definition` — real
 * taxonomies repeat leaf names across branches, and lifting that needs a migration. See BACKLOG item 22.
 
 * CALLED BY public/app.html, public/app/attach-ui.js, public/app/cap-categories.js, public/app/cap-catsetup.js, public/app/cap-definitions.js (+11 more)   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
 */
/*
 * OWNS      CB_STARTER_CATEGORIES: the small standard category set per trade (Google Product Taxonomy ids), as DATA only
 * CALLED BY <script src="/app/catalogue-starter-categories.js"> at public/app.html:1593; read as a global by cap-categories.js, cap-catsetup.js, cap-definitions.js, attach-ui.js
 * FLOW      script load -> global -> the opt-in seeding action reads the trade's nodes (asks first, never automatic)
 * CARD      06-catalogue-pim/categories-and-fields
 */
var CB_STARTER_CATEGORIES = {
  veg: {
    title: 'Fresh produce & groceries',
    nodes: [
      { gid: '430', name: 'Fruits & Vegetables', parent: null },
      { gid: '5799', name: 'Canned & Jarred Fruits', parent: '430' },
      { gid: '5798', name: 'Canned & Jarred Vegetables', parent: '430' },
      { gid: '5797', name: 'Canned & Prepared Beans', parent: '430' },
      { gid: '1755', name: 'Dried Fruits', parent: '430' },
      { gid: '7387', name: 'Dried Vegetables', parent: '430' },
      { gid: '5796', name: 'Dry Beans', parent: '430' },
      { gid: '5795', name: 'Fresh & Frozen Fruits', parent: '430' },
      { gid: '5793', name: 'Fresh & Frozen Vegetables', parent: '430' },
      { gid: '5794', name: 'Fruit Sauces', parent: '430' },
      { gid: '431', name: 'Grains, Rice & Cereal', parent: null },
      { gid: '4683', name: 'Amaranth', parent: '431' },
      { gid: '4687', name: 'Barley', parent: '431' },
      { gid: '4684', name: 'Buckwheat', parent: '431' },
      { gid: '4689', name: 'Cereal & Granola', parent: '431' },
      { gid: '7196', name: 'Couscous', parent: '431' },
      { gid: '4686', name: 'Millet', parent: '431' },
      { gid: '4690', name: 'Oats, Grits & Hot Cereal', parent: '431' },
      { gid: '6259', name: 'Quinoa', parent: '431' },
      { gid: '4682', name: 'Rice', parent: '431' },
      { gid: '7374', name: 'Rye', parent: '431' },
      { gid: '4608', name: 'Seasonings & Spices', parent: null },
      { gid: '1529', name: 'Herbs & Spices', parent: '4608' },
      { gid: '4610', name: 'MSG', parent: '4608' },
      { gid: '6199', name: 'Pepper', parent: '4608' },
      { gid: '4611', name: 'Salt', parent: '4608' }
    ]
  },
  coffee: {
    title: 'Coffee & tea',
    nodes: [
      { gid: '1868', name: 'Coffee', parent: null },
      { gid: '2073', name: 'Tea & Infusions', parent: null }
    ]
  },
  pharma: { title: 'Pharmaceutical', nodes: [{ gid: '518', name: 'Medicine & Drugs', parent: null }] },
  paint: {
    title: 'Paint & coatings',
    nodes: [
      { gid: '503740', name: 'Painting Consumables', parent: null },
      { gid: '1361', name: 'Paint', parent: '503740' },
      { gid: '2474', name: 'Paint Binders', parent: '503740' },
      { gid: '2058', name: 'Primers', parent: '503740' },
      { gid: '1648', name: 'Stains', parent: '503740' },
      { gid: '503738', name: 'Varnishes & Finishes', parent: '503740' }
    ]
  },
  retail: {
    title: 'Clothing & apparel',
    nodes: [
      { gid: '1604', name: 'Clothing', parent: null },
      { gid: '5322', name: 'Activewear', parent: '1604' },
      { gid: '182', name: 'Baby & Toddler Clothing', parent: '1604' },
      { gid: '2271', name: 'Dresses', parent: '1604' },
      { gid: '5182', name: 'One-Pieces', parent: '1604' },
      { gid: '203', name: 'Outerwear', parent: '1604' },
      { gid: '7313', name: 'Outfit Sets', parent: '1604' },
      { gid: '204', name: 'Pants', parent: '1604' },
      { gid: '212', name: 'Shirts & Tops', parent: '1604' },
      { gid: '207', name: 'Shorts', parent: '1604' },
      { gid: '1581', name: 'Skirts', parent: '1604' }
    ]
  },
  gold: {
    title: 'Jewellery',
    nodes: [
      { gid: '188', name: 'Jewelry', parent: null },
      { gid: '189', name: 'Anklets', parent: '188' },
      { gid: '190', name: 'Body Jewelry', parent: '188' },
      { gid: '191', name: 'Bracelets', parent: '188' },
      { gid: '197', name: 'Brooches & Lapel Pins', parent: '188' },
      { gid: '192', name: 'Charms & Pendants', parent: '188' },
      { gid: '194', name: 'Earrings', parent: '188' },
      { gid: '6463', name: 'Jewelry Sets', parent: '188' },
      { gid: '196', name: 'Necklaces', parent: '188' },
      { gid: '200', name: 'Rings', parent: '188' },
      { gid: '5122', name: 'Watch Accessories', parent: '188' }
    ]
  },
  trade: {
    title: 'Agriculture & trade',
    nodes: [
      { gid: '112', name: 'Agriculture', parent: null },
      { gid: '6991', name: 'Animal Husbandry', parent: '112' }
    ]
  }
};
if (typeof module !== 'undefined' && module.exports) module.exports = CB_STARTER_CATEGORIES;
