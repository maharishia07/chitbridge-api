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
  const VERSION = 1;

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
      version: 1,
      label: 'Vegetables & fruit',
      /* ⭐ THE OUTCOME. Without one this is not a blueprint. */
      outcome: 'a counter that can weigh, price and bill fresh produce today',
      prefix: 'V',
      /* ⚠️ MEASURED UNITS FIRST — this is the entire difference between the two trades, and it is data */
      units: ['kg', 'gram', 'bunch', 'piece'],
      defaultUnit: 'kg',
      categories: ['Vegetables', 'Greens', 'Fruit'],
      /**
       * ⚠️ MOST FRESH PRODUCE IS NIL-RATED IN INDIA and a shop below the threshold charges nothing anyway, so
       * no gst_rate is declared here. An unregistered greengrocer must not be handed a tax rate it never asked
       * for. The jurisdiction layer decides; a starter list does not. [[feedback-country-first]]
       */
      starter: [
        { name: 'Tomato',        unit: 'kg',    price: 40, category: 'Vegetables' },
        { name: 'Onion',         unit: 'kg',    price: 30, category: 'Vegetables' },
        { name: 'Potato',        unit: 'kg',    price: 35, category: 'Vegetables' },
        { name: 'Carrot',        unit: 'kg',    price: 60, category: 'Vegetables' },
        { name: 'Beans',         unit: 'kg',    price: 80, category: 'Vegetables' },
        { name: 'Brinjal',       unit: 'kg',    price: 45, category: 'Vegetables' },
        { name: 'Ladies finger', unit: 'kg',    price: 55, category: 'Vegetables' },
        { name: 'Coriander',     unit: 'bunch', price: 10, category: 'Greens' },
        { name: 'Curry leaves',  unit: 'bunch', price: 10, category: 'Greens' },
        { name: 'Spinach',       unit: 'bunch', price: 20, category: 'Greens' },
        { name: 'Coconut',       unit: 'piece', price: 25, category: 'Vegetables' },
        { name: 'Banana',        unit: 'kg',    price: 50, category: 'Fruit' },
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

  /** ⭐ never null — an unknown trade gets a neutral one rather than an exception at setup time */
  const NEUTRAL = {
    key: 'general', version: 1, label: 'A shop', outcome: 'a counter that can bill what this shop sells',
    prefix: 'P', units: ['piece', 'kg', 'litre'], defaultUnit: 'piece', categories: [], starter: [],
  };
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
      /* ⭐ enrichment travels when it is there and is never invented when it is not */
      for (const k of ['hsn', 'gst_rate', 'mrp', 'desc', 'qty']) {
        const v = p.raw[k];
        if (v !== undefined && String(v).trim() !== '') out[k] = v;
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
