/* catalogue-model.js — THE canonical catalogue model (single source of truth).
 *
 * Framework-agnostic and DOM-free. Loaded as a plain <script> in the browser (attaches the
 * global `CBCatalogue`) AND require()-able in Node (module.exports). The UI (cap-network.js)
 * and any headless consumer (e.g. the EOQ compute→seal harness) MUST route the catalogue
 * shape, migration, and derivations through here — so there is exactly one definition.
 *
 * A catalogue draft (per node):
 *   { story, product, variants:[{name}], baseUnit, altUnits:[{unit,num,den}],
 *     refs:[{system,code}], bom:[{item,qty}], loadedBy,
 *     fields:[{name, leg, via, type}],           // leg ∈ system|customer|compute|cb ; via ∈ ERP|IoT|AI
 *     triggers:[{watch,op,value,action,target}], // the loop
 *     feedback:[{system,format,onRail}] }         // outbound adapter
 
 * CALLED BY public/app/cap-catsetup.js, public/app/cap-definitions.js, public/app/cap-network.js, public/app/cart.js, public/app/price-resolve.js (+4 more)   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
 */
/*
 * OWNS      the one catalogue model (CBCatalogue): draft shape, migration and derivations, DOM-free
 * CALLED BY <script src="/app/catalogue-model.js"> at public/app.html:1588; read as a global by scripts/standards-doc.js; run in a vm by scripts/cap-network-render.test.mjs
 * CARD      06-catalogue-pim/categories-and-fields
 */
(function (root, factory) {
  var M = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = M; // Node
  if (root) root.CBCatalogue = M; // browser global
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---- vocabulary (the one place these live) ----
  var LEGS = [
    { k: 'system', label: 'Fed by system', short: 'System feed', hint: 'already exists in ERP / IoT — sync it in', col: ['var(--warn-2)', 'var(--warn-tint)'] },
    {
      k: 'customer',
      label: 'Collected from customer',
      short: 'From customer',
      hint: 'known only at order time — capture it',
      col: ['var(--blue-2)', 'var(--blue-tint-bg)']
    },
    {
      k: 'compute',
      label: 'Computed by co-assist',
      short: 'Computed',
      hint: 'a co-assist (AI / ERP) computes it, the rail seals it',
      col: ['var(--purple-2)', 'var(--purple-tint)']
    },
    { k: 'cb', label: 'Stored in CB', short: 'Store in CB', hint: 'has no home today — the gap CB fills', col: ['var(--ok-2)', 'var(--ok-tint)'] }
  ];
  var TYPES = ['text', 'number', 'choice', 'range', 'date'];
  // Part C · standards — external classification schemes, always BY REFERENCE (link out, never mirror).
  var STD_SCHEMES = ['HS', 'GS1 GPC', 'Schema.org', 'UNSPSC', 'custom'];
  // Part D · pricing — where a price ORIGINATES (basis) and how it is HELD (by ref = loose/resolved at seal · by value = frozen).
  var PRICE_BASIS = ['global', 'system', 'user', 'manual']; // global market stage · ERP/system · user choice at order · hand-entered
  var PRICE_BY = ['ref', 'value']; // ref → resolved from source at seal (loose) · value → frozen amount now
  /**
   * ⭐ WHERE A PRICE IS REFERRED FROM — Athi, 2026-08-16: *"can we say where prices are refered from, or accessed
   * from, example, url, website"*.
   *
   * `basis` already said WHAT KIND of source a price comes from (a market stage, an ERP, the user, a hand entry).
   * What was missing is WHERE — and "where" is the half that makes a price checkable by the other party. A number
   * whose origin is "global" is an assertion; a number whose origin is a named publisher, a URL, and a reading
   * date is EVIDENCE. In a dispute those are not the same object.
   *
   * ⚠️ THIS IS THE ATTESTATION RULE APPLIED TO MONEY: verified, not self-asserted. The same reason a KYB claim
   * carries its issuer and its check date.
   *
   * `at` (when it was read) matters as much as `url`. A commodity price with no reading date cannot be checked
   * against anything — the page it came from has moved on, and "it said 4,200" becomes unfalsifiable. Whoever
   * disputes it deserves to know which day's number this was.
   */
  var PRICE_ORIGIN = ['url', 'publisher', 'exchange', 'system', 'contract', 'manual'];
  function viaFor(nestedLeg) {
    return nestedLeg === 'compute' ? ['AI', 'ERP'] : ['ERP', 'IoT'];
  }

  // ---- THE MAXIMUM DATATYPE PALETTE ----
  // We cannot pre-design every catalogue. So the code fixes the GRAMMAR (the full set of primitives), and an AI
  // composes any catalogue from it in real time. This is that grammar — the maximum datatypes as code.
  var DATATYPES = [
    { k: 'text', label: 'Text', note: 'a short string' },
    { k: 'longtext', label: 'Long text', note: 'description / notes' },
    { k: 'number', label: 'Number', note: 'decimal quantity' },
    { k: 'integer', label: 'Whole number', note: 'count' },
    { k: 'boolean', label: 'Yes / No', note: 'a flag' },
    { k: 'date', label: 'Date', note: 'expiry, harvest' },
    { k: 'datetime', label: 'Date & time', note: 'timestamped event' },
    { k: 'choice', label: 'Choice (one)', note: 'grade, colour — pick one' },
    { k: 'multichoice', label: 'Choice (many)', note: 'tags, effects' },
    { k: 'range', label: 'Range (min–max)', note: 'a band' },
    { k: 'money', label: 'Money', note: 'amount + currency (from context)' },
    { k: 'quantity', label: 'Quantity', note: 'value + unit' },
    { k: 'unit', label: 'Unit + conversions', note: 'base unit + integer factors' },
    { k: 'standard_ref', label: 'Standard reference', note: 'HS / GS1 — by reference' },
    { k: 'external_ref', label: 'External reference', note: 'system + id (ERP/PIM code)' },
    { k: 'media', label: 'Image / video / file', note: 'own or inherited from source' },
    { k: 'url', label: 'Link', note: 'spec sheet, page' },
    { k: 'geo', label: 'Location', note: 'origin, delivery point' },
    { k: 'formula', label: 'Computed (formula)', note: 'derived by a co-assist, then sealed' },
    /**
     * ⭐ Athi, 2026-08-16: *"under field data type, consists of, means, this item consists of the following item"*.
     *
     * The CONCEPT already existed as the `bom` FACET (`bom:[{item, qty}]`) — a bill of materials for the whole
     * product. What was missing is that a FIELD could not be one, so a product could not say "this pack consists
     * of…" as an attribute alongside its others; the composition had to be the product's own top-level bom or
     * nowhere.
     *
     * ⚠️ SAME SHAPE AS THE FACET, ON PURPOSE — `[{item, qty}]`. A second shape for the same idea is how the
     * traceability walk ends up with two things to understand and mass-balance ends up reconciling one of them.
     */
    {
      k: 'composition',
      label: 'Consists of (bill of materials)',
      note: 'this item consists of these items, each with a quantity — same shape as the product bom'
    }
  ];
  var METHODS = [
    // how the whole catalogue sells (one per catalogue)
    { k: 'cart', label: 'Cart (qty × price)' },
    { k: 'qty', label: 'Quantity only' },
    { k: 'range', label: 'Price as a range' },
    { k: 'qtyprice', label: 'Both negotiable' },
    { k: 'text', label: 'Information only' },
    { k: 'subscription', label: 'Subscription / recurring' },
    { k: 'quote', label: 'Quote / tender' }
  ];
  /**
   * ⭐⭐ WHAT EACH SELLING METHOD CAN ACTUALLY SELL (backlog 18).
   *
   * Athi, 2026-08-16: *"so a catalogue choose what it wants to display, if you have not chosen range, your
   * catalogue will not work for range?"* — checked, and the answer was worse than "it will not work": **nothing
   * validated it at all.** A catalogue set to `text` could hold a product with a `pack` model and a step of 6.
   * Nothing rejected it, nothing warned, and the two disagreed at ORDER TIME — i.e. the customer found out.
   *
   * ⚠️⚠️ `range` AND `qtyprice` MEAN TWO DIFFERENT THINGS, and this table is where that stops being invisible:
   *   METHODS.range  — the whole CATALOGUE sells by price range      (one per catalogue)
   *   MODELS.range   — this LINE is quantified min/max               (one per line)
   * Same word, two levels. Naming them apart is a bigger change than this; naming the RELATIONSHIP is what was
   * actually missing, and that is what lives here.
   *
   * ⚠️ THE FIRST CUT IS THE PIPELINE, and it is the reported bug: `text` and `form` are `payload` catalogues —
   * they do not sell quantities at all, so they support NO order model. Everything else is `commerce`.
   * ⚠️ `offer` is available wherever commerce is: an offer line is a price mechanism, not a quantity shape.
   */
  var METHOD_MODELS = {
    cart: ['count', 'measure', 'pack', 'range', 'pick', 'offer'],
    qty: ['count', 'measure', 'pack', 'range', 'pick'], // no price → no offer
    range: ['count', 'measure', 'pack', 'range', 'pick', 'offer'],
    qtyprice: ['count', 'measure', 'pack', 'range', 'pick', 'offer'],
    subscription: ['count', 'measure', 'pack'], // a recurring line is a fixed shape
    quote: ['count', 'measure', 'pack', 'range', 'pick', 'offer'], // a quote may ask for anything
    text: [], // payload — nothing to quantify
    form: [] // payload
  };
  /**
   * The models a method supports. ⚠️ FAILS OPEN: an unknown or absent method returns EVERY model, because the
   * damage runs one way — hiding a model the catalogue genuinely supports silently removes a capability the
   * owner already relies on, while showing one it does not is caught by the orphan check below. Never narrow on
   * a guess.
   */
  function modelsForMethod(method) {
    var m = METHOD_MODELS[method];
    return m ? m.slice() : ['count', 'measure', 'pack', 'range', 'pick', 'offer'];
  }
  /**
   * ⚠️ SURFACE, NEVER SILENTLY BREAK. A catalogue that narrows its method later would orphan products already
   * using a dropped model. Those must be REPORTED, not quietly stopped from working — the same "not listed vs
   * can't tell" distinction the supplier search makes. This returns them; deciding what happens to them is a
   * product call and deliberately not made here.
   */
  function orphanModels(method, usedModels) {
    if (!METHOD_MODELS[method]) return []; // unknown method → nothing is provably orphaned
    var ok = METHOD_MODELS[method];
    return (usedModels || []).filter(function (item) {
      return ok.indexOf(item) < 0;
    });
  }
  var FACETS = ['identity', 'variants', 'units', 'standards', 'media', 'bom', 'pricing', 'loop', 'feedback'];
  var PRICING_MODELS = ['fixed', 'range', 'tiered', 'market-ref', 'negotiated'];
  /**
   * ⭐ UNITS OF MEASURE — MOVED HERE FROM THE WIZARD (2026-08-16).
   *
   * This list lived as `CW_UNITS` inside cap-catalogue.js — a SCREEN, and a lazily-loaded capability at that. The
   * unit is the one thing every single line item carries, and it had no home in the model: it could not be
   * declared, published in Definitions, or referred to under Model A. Governance's "Units of measure" row read
   * `—`, and when I first wired it I pointed it at STANDARDS (adopted specifications) and confidently reported
   * "19 declared" for a registry that did not exist.
   *
   * ⚠️ IT ALSO CREATED A CROSS-CAPABILITY DEPENDENCY: cap-admin had to reach for a global owned by cap-catalogue,
   * which is only defined once that capability has been opened. Here in the model both read the same export and
   * neither has to have visited the other's screen.
   *
   * ⚠️ ORDER AND SPELLING PRESERVED EXACTLY as the wizard had them — this is a move, not a redesign. Any addition
   * (or a switch to UN/CEFACT codes) is a separate, deliberate change.
   */
  var UNITS = ['kg', 'gram', 'litre', 'ml', 'piece', 'count', 'unit', 'pack', 'box', 'dozen', 'tonne', 'barrel', 'metre', 'sqft', 'roll'];
  /**
   * ⭐⭐ UNIT ALIASES — one unit, many spellings (backlog 30). Found while checking Group sum: every unit-split
   * warning on the live account was the SAME UNIT failing to match itself across scripts —
   * `0 bunch + 20 கட்டு + 5 kattu`, `0 kg + 8 கிலோ`, `37 litre + 10 லிட்டர்`. They arrive through the WhatsApp
   * captures in Tamil; the catalogue knew `kg` and had no idea `கிலோ` was one. Six items could not be totalled.
   *
   * ⭐ The precedent is right here in this file: a product already knows "thakkali" is a tomato via `synonyms`.
   * A unit knew nothing. This is that same idea, for units.
   *
   * ⚠️⚠️ AN ALIAS IS A RENAME, NEVER A CONVERSION — the entire safety property.
   *   `கிலோ → kg`   RENAME. Same quantity, different script. No number changes, always safe.
   *   `crate → kg`  CONVERSION. Entity-specific (20kg for one supplier, 25 for another) and stays REFUSED
   *                 unless declared on the item. Mixing the two into one table would silently re-enable the
   *                 exact money error lib/consolidate.js was written to prevent.
   * ⚠️ OBSERVED, NOT INVENTED — every spelling below was seen on real captures. Grow it from what arrives.
   * ⚠️ MIRRORED IN chitbridge-api/lib/units.js, which is where totalling reads it. Change both or neither.
   */
  /**
   * ⭐ THE HUMAN NAME OF A UNIT — the PRESENTATION half (Athi, 2026-08-17: *"what left kg is and what right kg
   * is… so declaration and presentation?"*).
   *
   * ⚠️ HE WAS RIGHT THAT IT MEANT NOTHING. Until now a unit was a bare string, and the setup screen rendered it
   * as `{code:u, label:u}` — the SAME value printed in two columns, which invites exactly that question and has
   * no answer. There was no declaration/presentation split; there was one value shown twice.
   *
   * Now there genuinely are two things:
   *   CODE  `kg`        what is stored on a line and travels on a chit — never shown to a customer
   *   NAME  `Kilogram`  what a person reads
   * ⚠️ The CODE stays the identity. Renaming here changes what is displayed and nothing that is stored, which is
   * the same rule categories follow — names are labels, ids are identity.
   */
  var UNIT_NAMES = {
    kg: 'Kilogram',
    gram: 'Gram',
    litre: 'Litre',
    ml: 'Millilitre',
    piece: 'Piece',
    count: 'Count',
    unit: 'Unit',
    pack: 'Pack',
    box: 'Box',
    dozen: 'Dozen',
    tonne: 'Tonne',
    barrel: 'Barrel',
    metre: 'Metre',
    sqft: 'Square foot',
    roll: 'Roll',
    bunch: 'Bunch'
  };
  /**
   * ⭐⭐ WHAT KIND OF QUANTITY A UNIT MEASURES (Athi, 2026-08-17: *"can be segregated based on weight, liquid,
   * count and so on, area and so on"*). Ordered — this is the display order, not a lookup.
   *
   * ⚠️ THIS IS NOT JUST TIDINESS, and the last group is why. Within `weight` or `volume` the ratios are UNIVERSAL
   * (a kilogram is a thousand grams everywhere, for everyone). Within `pack` they are not: a box is only so many
   * kilograms because THIS seller says so, and the next seller's box is a different weight. That is exactly the
   * line lib/consolidate.js draws when it refuses to invent a conversion — so grouping the units this way makes
   * a rule that already governs the totals visible on the screen where units are declared.
   *
   * ⚠️ Two units can never be added across groups at all: 5 kg + 2 litre is not a quantity, it is two quantities.
   */
  var UNIT_KINDS = [
    { k: 'weight', label: 'Weight', units: ['kg', 'gram', 'tonne'] },
    { k: 'volume', label: 'Volume', units: ['litre', 'ml', 'barrel'] },
    { k: 'length', label: 'Length', units: ['metre'] },
    { k: 'area', label: 'Area', units: ['sqft'] },
    { k: 'count', label: 'Count', units: ['piece', 'count', 'unit', 'dozen'] },
    /* ⚠️ A GROUPING WHOSE SIZE THE SELLER DEFINES — the one group with no universal ratio to anything. */
    { k: 'pack', label: 'Pack', units: ['pack', 'box', 'bunch', 'roll'] }
  ];
  /** The kind a unit belongs to, or null. Used to group the list and to say what may never be added together. */
  function unitKind(u) {
    for (var index = 0; index < UNIT_KINDS.length; index++) if (UNIT_KINDS[index].units.indexOf(u) >= 0) return UNIT_KINDS[index];
    return null;
  }
  var UNIT_LANGS = [
    { code: 'en', label: 'English', group: 'Common' },
    { code: 'ta', label: 'தமிழ் · Tamil', group: 'Indian' },
    { code: 'hi', label: 'हिन्दी · Hindi', group: 'Indian' },
    { code: 'ml', label: 'മലയാളം · Malayalam', group: 'Indian' },
    { code: 'te', label: 'తెలుగు · Telugu', group: 'Indian' },
    { code: 'kn', label: 'ಕನ್ನಡ · Kannada', group: 'Indian' },
    { code: 'mr', label: 'मराठी · Marathi', group: 'Indian' },
    { code: 'gu', label: 'ગુજરાતી · Gujarati', group: 'Indian' },
    { code: 'bn', label: 'বাংলা · Bengali', group: 'Indian' },
    { code: 'pa', label: 'ਪੰਜਾਬੀ · Punjabi', group: 'Indian' },
    { code: 'or', label: 'ଓଡ଼ିଆ · Odia', group: 'Indian' },
    { code: 'ur', label: 'اردو · Urdu', group: 'Indian' },
    { code: 'ar', label: 'العربية · Arabic', group: 'Foreign' },
    { code: 'zh', label: '中文 · Chinese', group: 'Foreign' },
    { code: 'es', label: 'Español · Spanish', group: 'Foreign' },
    { code: 'fr', label: 'Français · French', group: 'Foreign' },
    { code: 'de', label: 'Deutsch · German', group: 'Foreign' },
    { code: 'pt', label: 'Português · Portuguese', group: 'Foreign' },
    { code: 'ru', label: 'Русский · Russian', group: 'Foreign' },
    { code: 'it', label: 'Italiano · Italian', group: 'Foreign' },
    { code: 'nl', label: 'Nederlands · Dutch', group: 'Foreign' },
    { code: 'tr', label: 'Türkçe · Turkish', group: 'Foreign' },
    { code: 'id', label: 'Indonesia · Indonesian', group: 'Foreign' },
    { code: 'vi', label: 'Tiếng Việt · Vietnamese', group: 'Foreign' },
    { code: 'th', label: 'ไทย · Thai', group: 'Foreign' },
    { code: 'ja', label: '日本語 · Japanese', group: 'Foreign' },
    { code: 'ko', label: '한국어 · Korean', group: 'Foreign' }
  ];
  var UNIT_ALIASES = {
    kg: { ta: ['கிலோ', 'கிலோகிராம்'], hi: ['किलो', 'किलोग्राम'], en: ['kilo', 'kilos', 'kilogram', 'kilograms', 'kgs', 'kilogramme'] },
    gram: { ta: ['கிராம்'], hi: ['ग्राम'], en: ['grams', 'gm', 'gms', 'gramme'] },
    litre: { ta: ['லிட்டர்'], hi: ['लीटर'], en: ['liter', 'liters', 'litres', 'ltr', 'ltrs'] },
    ml: { ta: ['மில்லி'], hi: ['मिलीलीटर'], en: ['millilitre', 'millilitres', 'milliliter', 'mls'] },
    piece: { ta: ['பீஸ்'], hi: ['पीस', 'नग'], en: ['pieces', 'pcs', 'pc'] },
    bunch: { ta: ['கட்டு', 'kattu'], hi: ['गड्डी', 'गुच्छा'], en: ['bunches'] },
    pack: { ta: ['பேக்'], hi: ['पैकेट'], en: ['packet', 'packets', 'pkt', 'pkts', 'packs'] },
    box: { ta: ['பாக்ஸ்'], hi: ['डिब्बा', 'बॉक्स'], en: ['boxes'] },
    /* ⚠️ 2026-09-27: carton was filed under box here and nos/no under piece, while lib/units.js — the platform's table —
       has carton and count as units of their own (tests/units-alias: "the two halves of one fact disagree"). A carton is a
       near neighbour of a box, and a near neighbour IS a conversion, not a spelling (lib/ai.js). This view follows the API. */
    carton: { en: ['cartons'] },
    dozen: { ta: ['டஜன்'], hi: ['दर्जन'], en: ['dozens', 'dzn'] },
    tonne: { ta: ['டன்'], hi: ['टन'], en: ['ton', 'tons', 'tonnes', 'mt'] },
    metre: { ta: ['மீட்டர்'], hi: ['मीटर'], en: ['meter', 'meters', 'metres', 'mtr'] },
    count: { ta: ['எண்ணிக்கை'], en: ['counts', 'nos', 'no'] },
    unit: { ta: ['யூனிட்'], hi: ['यूनिट'], en: ['units'] }
  };
  // the whole grammar, in one place — what the AI composes from
  function PALETTE() {
    return {
      datatypes: DATATYPES,
      priceOrigin: PRICE_ORIGIN,
      legs: LEGS,
      viaFor: viaFor,
      methods: METHODS,
      facets: FACETS,
      pricingModels: PRICING_MODELS,
      standards: STD_SCHEMES,
      priceBy: PRICE_BY,
      priceBasis: PRICE_BASIS
    };
  }
  function leg(k) {
    for (var index = 0; index < LEGS.length; index++) if (LEGS[index].k === k) return LEGS[index];
    return null;
  }

  // ---- normalize / migrate a draft to the current shape (moved out of the UI's _ensureCat) ----
  function ensure(c) {
    c = c || {};
    if (!c.fields) c.fields = [];
    if (!c.loadedBy) c.loadedBy = 'manual';
    if (c.story === undefined) c.story = '';
    if (!c.feedback) c.feedback = [];
    if (!c.refs) c.refs = [];
    if (!c.bom) c.bom = [];
    if (!c.triggers) c.triggers = [];
    if (c.product === undefined) c.product = '';
    if (!c.variants) c.variants = [];
    if (c.baseUnit === undefined) c.baseUnit = '';
    if (!c.altUnits) c.altUnits = [];
    // governance context: currency + region the catalogue is priced/read in; prices inherit these when blank.
    if (!c.context) c.context = { currency: '', region: '' };
    if (c.context.currency === undefined) c.context.currency = '';
    if (c.context.region === undefined) c.context.region = '';
    if (!c.standards) c.standards = []; // Part C · [{scheme, code, label}] — by reference
    if (!c.pricing) c.pricing = []; // Part D · [{label, basis, by, source, amount, currency, region, validFrom, validTo}]
    c.pricing.forEach(function (item) {
      if (!item.basis) item.basis = 'global';
      if (!item.by) item.by = 'ref';
      if (item.source === undefined) item.source = '';
      /**
       * ⭐ THE PROVENANCE OF THE NUMBER — where it was referred from, and when it was read.
       *
       * ⚠️ ADDITIVE AND OPTIONAL. Every price written before today has none of these, and a missing origin means
       * "not stated", never "invalid" — the same rule products.js applies to a missing status. Demanding it
       * retroactively would invalidate every existing price at once.
       *
       *   origin     one of PRICE_ORIGIN — the KIND of place ('url', 'exchange', 'contract'…)
       *   url        where it can be looked at. ⚠️ Not fetched by us; see below.
       *   ref        the identifier AT that place — a contract number, a symbol, an ERP price-list id
       *   at         ISO datetime the figure was READ. Without this a market price cannot be checked at all.
       *   as_read    what the source actually said, verbatim, before any conversion or markup
       *
       * ⚠️ `as_read` IS NOT `amount`. `amount` is what this catalogue charges; `as_read` is what the source said.
       * They differ by markup, conversion, rounding — and keeping both is what lets someone audit the step
       * between them instead of taking it on trust. Collapsing them would hide exactly the part worth checking.
       */
      if (item.origin === undefined) item.origin = '';
      if (item.url === undefined) item.url = '';
      if (item.ref === undefined) item.ref = '';
      if (item.at === undefined) item.at = '';
      if (item.as_read === undefined) item.as_read = null;
      if (item.amount === undefined) item.amount = null;
      if (item.currency === undefined) item.currency = '';
      if (item.region === undefined) item.region = '';
      if (item.validFrom === undefined) item.validFrom = '';
      if (item.validTo === undefined) item.validTo = '';
    });
    c.fields.forEach(function (item) {
      if (!item.leg) {
        // migrate the old {source} shape
        if (item.source === 'erp') {
          item.leg = 'system';
          item.via = 'ERP';
        } else if (item.source === 'iot') {
          item.leg = 'system';
          item.via = 'IoT';
        } else {
          item.leg = 'cb';
        }
      }
      if ((item.leg === 'system' || item.leg === 'compute') && !item.via) item.via = viaFor(item.leg)[0];
    });
    c.feedback.forEach(function (item) {
      if (item.format === undefined) item.format = '';
      if (item.onRail === undefined) item.onRail = false;
    });
    return c;
  }

  // ---- unit resolution: how many base units is one `unit`? (integer num/den, per Part A) ----
  function toBase(c, unit, qty) {
    qty = qty == null ? 1 : qty;
    if (!unit || unit === c.baseUnit) return qty;
    var u = (c.altUnits || []).filter(function (x) {
      return x.unit === unit;
    })[0];
    if (!u) return null; // unknown unit — caller decides
    return (qty * (u.num || 1)) / (u.den || 1);
  }

  // ---- resolve a price against the catalogue's governance context (currency/region inherited when blank).
  // by 'value' → a frozen amount now; by 'ref' → loose, resolved from `source` at seal (FX freezes then, not here).
  function resolvePrice(c, p) {
    c = ensure(c);
    return {
      label: p.label || p.basis + ' price',
      basis: p.basis,
      by: p.by,
      source: p.source,
      amount: p.by === 'value' ? p.amount : null,
      currency: p.currency || c.context.currency || '',
      region: p.region || c.context.region || '',
      validFrom: p.validFrom,
      validTo: p.validTo,
      state: p.by === 'value' ? 'frozen (by value)' : 'loose (by ref — resolves at seal)',
      /* Where it came from, carried through so the schema and every consumer see it — not just the editor. */
      origin: p.origin || '',
      url: p.url || '',
      ref: p.ref || '',
      at: p.at || '',
      as_read: p.as_read,
      /**
       * ⭐ ONE LINE A HUMAN CAN READ, and it is the whole point of the feature: a price should be able to say
       * where it came from without anyone opening the JSON.
       *
       * ⚠️ IT SAYS "no source stated" RATHER THAN GOING QUIET. A price with no provenance is a legitimate,
       * common thing — most prices are simply set by the seller — but it must LOOK different from one that has
       * provenance, or an unverifiable number and an auditable one are indistinguishable on screen. That
       * difference is the feature.
       */
      provenance: priceProvenance(p)
    };
  }

  /** A short, human sentence for where a price was referred from. Empty inputs are said, not hidden. */
  function priceProvenance(p) {
    if (!p) return 'no source stated';
    var bits = [];
    if (p.origin) bits.push(p.origin);
    if (p.source) bits.push(p.source);
    if (p.ref) bits.push('ref ' + p.ref);
    if (p.url) bits.push(p.url);
    if (p.at) bits.push('read ' + p.at);
    /* ⚠️ `as_read` is shown ALONGSIDE, never instead of, the charged amount — the gap between them is the
       markup, and hiding it would hide the one number a counterparty would want to see. */
    if (p.as_read != null && p.as_read !== '') bits.push('source said ' + p.as_read);
    return bits.length ? bits.join(' · ') : 'no source stated';
  }

  /**
   * ⚠️ THE URL IS RECORDED, NOT FETCHED — and that is a deliberate refusal, not a missing feature.
   *
   * Fetching a price from a supplier's page at seal time would make a chit's terms depend on a third-party
   * server being up, unchanged, and honest at that exact moment. It would also mean the two parties can compute
   * different totals from the same chit, which is the one thing this product cannot allow.
   *
   * So the URL is provenance: it says where a human read the number, so the other party can go and look. If
   * automated resolution is ever wanted it belongs on a scheduled reading that writes an `as_read` with a
   * timestamp — a fact captured once and then frozen — not a live lookup inside a mint.
   */
  function priceIsCheckable(p) {
    return !!(p && (p.url || (p.origin && p.ref)) && p.at);
  }

  // ---- the four-leg chain as DATA (the UI draws it; the harness reasons over it) ----
  function routeChain(c) {
    c = ensure(c);
    var out = { system: [], customer: [], compute: [], cb: [], feedback: [] };
    c.fields.forEach(function (item) {
      (out[item.leg] || out.cb).push({ name: item.name, via: item.via, type: item.type });
    });
    if (c.product) out.cb.unshift({ name: c.product + ' (identity)', identity: true });
    if (c.baseUnit) out.cb.unshift({ name: 'units · ' + c.baseUnit, identity: true });
    out.feedback = (c.feedback || [])
      .filter(function (x) {
        return x.system;
      })
      .map(function (x) {
        return { system: x.system, format: x.format, onRail: !!x.onRail };
      });
    return out;
  }

  // ---- derive the COMPUTE JOB: what a co-assist must compute, what feeds it, where the result goes.
  // This is the bridge from a design draft to a runnable co-assist→seal loop.
  function deriveComputeJob(c) {
    c = ensure(c);
    var feeds = c.fields
      .filter(function (item) {
        return item.leg === 'system';
      })
      .map(function (item) {
        return { name: item.name, via: item.via, type: item.type };
      });
    var computed = c.fields
      .filter(function (item) {
        return item.leg === 'compute';
      })
      .map(function (item) {
        return { name: item.name, via: item.via, type: item.type };
      });
    var fromCustomer = c.fields
      .filter(function (item) {
        return item.leg === 'customer';
      })
      .map(function (item) {
        return item.name;
      });
    var stored = c.fields
      .filter(function (item) {
        return item.leg === 'cb';
      })
      .map(function (item) {
        return item.name;
      });
    return {
      product: c.product,
      context: c.context, // governance: currency + region prices/refs resolve under
      known_as: (c.refs || []).filter(function (item) {
        return item.system && item.code;
      }),
      standards: (c.standards || []).filter(function (item) {
        return item.code || item.label;
      }), // Part C · by reference
      pricing: (c.pricing || []).map(function (item) {
        return resolvePrice(c, item);
      }), // Part D · by ref / by value
      bom: (c.bom || []).filter(function (b) {
        return b.item;
      }),
      feeds: feeds, // inputs to the co-assist (from ERP/IoT)
      computed: computed, // what the co-assist outputs (then sealed)
      fromCustomer: fromCustomer,
      stored: stored,
      triggers: (c.triggers || []).filter(function (item) {
        return item.watch || item.value;
      }),
      feedback: (c.feedback || []).filter(function (x) {
        return x.system;
      }),
      runnable:
        computed.length > 0 &&
        (c.triggers || []).some(function (item) {
          return item.action;
        })
    };
  }

  // ---- what the sealed record's inputs should be: the system-fed values, keyed by field name ----
  function canonicalInputs(c, feedValues) {
    c = ensure(c);
    var inputs = { product: c.product };
    c.fields
      .filter(function (item) {
        return item.leg === 'system';
      })
      .forEach(function (item) {
        inputs[item.name] = feedValues && item.name in feedValues ? feedValues[item.name] : null;
      });
    (c.refs || []).forEach(function (item) {
      if (item.system && item.code) {
        inputs.known_as = inputs.known_as || {};
        inputs.known_as[item.system] = item.code;
      }
    });
    return inputs;
  }

  // ---- ADOPT the standard: emit the catalogue AS JSON Schema (+ our x-cb-* overlay for the four legs / seal).
  // This is what an AI would emit per purpose (LLMs speak JSON Schema); RJSF / JSON Forms / json-editor render it
  // for free. We only add the CB-unique bits as extension keywords. Our model stays a thin PROFILE over the standard.
  function _jkey(n) {
    return (
      (n || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '') || 'field'
    );
  }
  /**
   * ⚠️ AN UNMAPPED TYPE FALLS BACK TO `{type:'string'}` SILENTLY (see toJSONSchema below) — which is fine for the
   * text-ish types and WRONG for any structured one. A `composition` field exported as a string would look valid,
   * validate against nothing useful, and be discovered by whoever consumed the schema rather than by us.
   */
  var TYPE_TO_JSONSCHEMA = {
    text: { type: 'string' },
    number: { type: 'number' },
    date: { type: 'string', format: 'date' },
    choice: { type: 'string' },
    range: { type: 'object', properties: { min: { type: 'number' }, max: { type: 'number' } } },
    /* ⭐ "consists of" — the same `[{item, qty}]` shape the product-level `bom` facet uses. Deliberately identical:
       one idea, one shape, so the traceability walk and mass-balance have a single thing to understand. */
    composition: {
      type: 'array',
      items: { type: 'object', properties: { item: { type: 'string' }, qty: { type: 'number' }, unit: { type: 'string' } }, required: ['item'] }
    }
  };
  function toJSONSchema(c, opts) {
    c = ensure(c);
    opts = opts || {};
    var props = {},
      required = [];
    props.product = { type: 'string', title: 'Product', 'x-cb-role': 'identity', 'x-cb-leg': 'cb' };
    if (c.product) required.push('product');
    if (c.baseUnit) props.unit = { type: 'string', title: 'Unit', default: c.baseUnit, 'x-cb-role': 'unit' };
    (c.fields || []).forEach(function (item) {
      var base = JSON.parse(JSON.stringify(TYPE_TO_JSONSCHEMA[item.type] || { type: 'string' }));
      base.title = item.name;
      base['x-cb-leg'] = item.leg; // <-- the four-leg overlay: where this field comes from
      if (item.via) base['x-cb-via'] = item.via;
      if (item.leg === 'compute') base.readOnly = true; // computed by a co-assist, then sealed
      props[_jkey(item.name)] = base;
    });
    (c.standards || []).forEach(function (item) {
      if (item.code || item.scheme)
        props[_jkey(item.scheme || 'std')] = {
          type: 'string',
          title: (item.scheme || 'Standard') + ' code',
          'x-cb-role': 'standard-ref',
          'x-cb-standard': item.scheme,
          'x-cb-ref': true
        };
    });
    var schema = { '$schema': 'https://json-schema.org/draft/2020-12/schema', title: c.product || 'Catalogue item', type: 'object', properties: props };
    if (required.length) schema.required = required;
    schema['x-cb-method'] = opts.method || 'cart'; // the whole-catalogue overlay
    schema['x-cb-currency'] = opts.currency || '(entity)';
    if (opts.facets)
      schema['x-cb-facets'] = Object.keys(opts.facets).filter(function (item) {
        return opts.facets[item];
      });
    schema['x-cb-seal'] = 'content-hash on the chit';
    return schema;
  }

  // ---- completeness for a build-ready check (used later by the gated Build) ----
  function validate(c) {
    c = ensure(c);
    var issues = [];
    if (!c.product) issues.push('no product name');
    c.fields.forEach(function (item) {
      if (!item.name) issues.push('an unnamed requirement');
    });
    var comp = c.fields.some(function (item) {
      return item.leg === 'compute';
    });
    if (
      comp &&
      !c.fields.some(function (item) {
        return item.leg === 'system';
      })
    )
      issues.push('a computed field but nothing fed in to compute from');
    return { ok: issues.length === 0, issues: issues };
  }

  // ============================================================================
  // ADOPTED INDUSTRY STANDARDS — NAMED BY ID, READ FROM THE REGISTER (STDREG1, 2026-10-14).
  // This used to be a 19-row list of its own (name · body · role · status), and it drifted: it called UN/ECE Rec 20
  // "roadmap" while the register said In force. ONE list now: every standard's words and status live in
  // app/cap-standards.js (STANDARDS, by `id`); this keeps only WHERE in this model each one is implemented.
  // e2e/standards-one-list.cjs fails if an id here is not on the register, or if a second standards list appears.
  // ============================================================================
  var STANDARD_REFS = [
    { id: 'json-schema-2020-12', where: 'toJSONSchema()' },
    { id: 'rfc7386', where: 'mergePatch()' },
    { id: 'mdm-golden-record', where: 'upsertItem() · _lineage' },
    { id: 'gs1-gtin', where: 'itemKey() · upsertItem()' },
    { id: 'pim', where: 'fields · sections · facets' },
    { id: 'gs1-gpc', where: 'standards[]' },
    { id: 'schema-org-product', where: 'standards[]' },
    { id: 'schema-org-availability', where: 'itemstatus.SCHEMA_ORG · item_data.status_schema_org' },
    { id: 'schema-org-offer', where: 'price · currency · min_qty · status' },
    { id: 'wco-hs', where: 'hsn · hs_code · starter-fields' },
    { id: 'unece-rec20', where: 'unit · conversions (our own names today)' },
    { id: 'iso3166', where: 'origin_country' },
    { id: 'iso4217', where: 'money.stampItem() · regional.currencyFor()' },
    { id: 'medusa-model', where: 'FIELD_STANDARDS' },
    { id: 'gs1-ai', where: 'gs1.AI · gs1.lotOf() · gs1.lotKey() · line.lot' },
    { id: 'gs1-epcis', where: 'trace walk · by-batch · mass-balance' },
    { id: 'odoo-tracking', where: 'starter-fields pharma `tracking` · gs1.expiryState()' },
    { id: 'rfc6902', where: '—' },
    { id: 'gs1-gdsn', where: '—' }
  ];
  /** standards(register?) → [{ id, where, n, w, s, m, limit }] — the register's own row for each id (the global STANDARDS once
      cap-standards.js has loaded, or the array passed in); an id the register lacks comes back { id, where, missing: true }, never guessed. */
  function standards(register) {
    var reg = register || (typeof STANDARDS !== 'undefined' ? STANDARDS : null) || [];
    return STANDARD_REFS.map(function (ref) {
      var r = null;
      for (var index = 0; index < reg.length; index++)
        if (reg[index] && reg[index].id === ref.id) {
          r = reg[index];
          break;
        }
      return r ? { id: ref.id, where: ref.where, n: r.n, w: r.w, s: r.s, m: r.m, limit: r.limit } : { id: ref.id, where: ref.where, missing: true };
    });
  }

  /* ============================================================================================================
   * FIELD-LEVEL STANDARD MAP — our key → what the rest of the world calls it.
   *
   * Athi, 2026-08-13: *"adopt all the standards in one pass so we can reference quickly … check medusa and org
   * standards."*
   *
   * The STANDARD_REFS above name the standards we build ON (their words: the register, app/cap-standards.js). This names them FIELD BY FIELD, because that is the
   * question anyone actually has: "we call it `hsn` — what does an integrator call it?" Without this the alignment
   * is a claim in a comment; with it, it is a lookup.
   *
   *   s — schema.org (Product properties, or Offer.* where the standard puts it on the offer, not the product)
   *   m — Medusa (MIT). Field names read from the Product / ProductVariant model references, 2026-08-13.
   *   o — the other governing standard, where one owns the field outright (WCO HS, ISO, UN/CEFACT, GS1)
   *   n — a note, and always the reason when we differ
   *
   * ⚠️ VOCABULARY ONLY — NO MEDUSA CODE IS EMBEDDED, exactly as the PIM entry above already states. Reading a
   * model to name our own fields well is not vendoring it.
   *
   * ⚠️ TWO THINGS THIS MAP MADE VISIBLE, both recorded in FIELD_GAPS/CONFLICTS below rather than silently fixed:
   * our `code` field is labelled "Code / HSN" and conflates a merchant SKU with a customs classification, and
   * Medusa's `status` is the same WORD as ours for a different QUESTION.
   * ========================================================================================================== */
  var FIELD_STANDARDS = {
    // ── identity ──────────────────────────────────────────────────────────────────────────────────────────────
    name: { s: 'name', m: 'Product.title', n: '' },
    variant: {
      s: '—',
      m: 'ProductVariant.title',
      n: 'Medusa makes a variant its OWN record keyed by option values; we keep it a field on the item. Ours is flatter and matches how a trader writes a price list.'
    },
    grade: { s: '—', m: 'ProductOptionValue', n: 'a variant axis — same idea, named for the trade' },
    desc: { s: 'description', m: 'Product.description', n: '' },
    description: { s: 'description', m: 'Product.description', n: 'alias of desc — both appear in real imports' },
    synonyms: {
      s: 'alternateName',
      m: '—',
      n: '⭐ carries far more weight here than anywhere else: multilingual trade names are the MATCHER INPUT, not decoration. Medusa has no equivalent.'
    },
    local_name: { s: 'alternateName', m: '—', n: '' },
    botanical: { s: 'alternateName', m: '—', n: 'the species name — an alternateName with a scheme' },
    brand: { s: 'brand', m: 'ProductCollection', n: '' },
    category: { s: 'category', m: 'ProductCategory', o: 'GS1 GPC · UNSPSC', n: 'classification held BY REFERENCE' },
    // ── canonical codes ───────────────────────────────────────────────────────────────────────────────────────
    sku: { s: 'sku', m: 'ProductVariant.sku', n: 'merchant identifier — ours, not the world’s' },
    gtin: {
      s: 'gtin',
      m: 'ProductVariant.barcode',
      o: 'GS1 GTIN-8/12/13/14',
      n: 'the world’s identifier. Medusa splits ean/upc/barcode; GS1 subsumes all three under GTIN.'
    },
    ean: { s: 'gtin13', m: 'ProductVariant.ean', o: 'GS1', n: '' },
    barcode: { s: 'gtin', m: 'ProductVariant.barcode', o: 'GS1', n: '' },
    mpn: { s: 'mpn', m: '—', n: 'manufacturer part number — spares and machinery' },
    code: {
      s: 'sku | —',
      m: 'sku | hs_code',
      n: '⚠️ AMBIGUOUS IN OUR OWN STARTER SET, labelled "Code / HSN". A merchant SKU and a WCO customs classification are different standards with different owners; both schema.org and Medusa keep them apart. See CONFLICTS.'
    },
    // ── customs & trade — the fields that make this a TRADE catalogue rather than a shop one ───────────────────
    hsn: {
      s: '—',
      m: 'hs_code',
      o: 'WCO Harmonized System',
      n: '⭐ schema.org has NO customs classification. Medusa carries hs_code on both product and variant — worth knowing that a serious commerce model treats this as first-class.'
    },
    hs_code: { s: '—', m: 'hs_code', o: 'WCO Harmonized System', n: 'same field, the international spelling' },
    origin_country: { s: '—', m: 'origin_country', o: 'ISO 3166-1 alpha-2', n: 'country of origin — drives duty and preference' },
    material: { s: 'material', m: 'material', n: '' },
    weight: { s: 'weight', m: 'weight', o: 'UN/CEFACT Rec 20 (unit code)', n: '' },
    // ── quantity & units ──────────────────────────────────────────────────────────────────────────────────────
    unit: {
      s: '—',
      m: '—',
      o: 'UN/CEFACT Rec 20',
      n: '⭐ THE code list for units in international trade (KGM · LTR · TNE · MTQ · PCE). Neither schema.org nor Medusa models a unit of sale properly — for a bulk-commodity rail this is a real gap in BOTH, and the reason we keep our own unit + conversions.'
    },
    unit_size: { s: 'size', m: '—', n: '' },
    conversions: { s: '—', m: '—', o: 'UN/CEFACT Rec 20', n: 'integer factors between units — CB-specific, because a sack is 50 kg only in this catalogue' },
    min_qty: { s: 'Offer.eligibleQuantity', m: '—', n: '' },
    // ── price ─────────────────────────────────────────────────────────────────────────────────────────────────
    price: {
      s: 'Offer.price',
      m: 'Price.amount',
      n: '⚠️ schema.org puts price on the OFFER, not the product — the same thing sells at different prices to different people. Our per-copy model already agrees with that; the field placement does not yet.'
    },
    currency: { s: 'Offer.priceCurrency', m: 'Price.currency_code', o: 'ISO 4217', n: 'stamped from the ENTITY, never from the request' },
    mrp: { s: 'Offer.priceSpecification', m: '—', n: 'list price — a second price with a different role' },
    // ── lifecycle & stock ─────────────────────────────────────────────────────────────────────────────────────
    status: {
      s: 'Offer.availability',
      m: '✗ NOT ProductStatus',
      n: '⚠️ SAME WORD, DIFFERENT QUESTION. Medusa’s status (draft/proposed/published/rejected) is a PUBLICATION workflow — is this listing ready to show. Ours is schema.org ItemAvailability — can this be ordered at all. Mapping one to the other would be wrong in both directions.'
    },
    status_until: { s: '—', m: '—', n: 'CB-specific: what makes "temporarily" mean anything' },
    status_replaced_by: { s: 'isSimilarTo', m: '—', n: 'the successor that makes redundant ≠ retired' },
    avail: { s: 'Offer.inventoryLevel', m: 'InventoryLevel', n: 'the QUANTITY feed — how many are on the shelf. Not the lifecycle.' },
    // ── tax — jurisdictional, and deliberately not pretended to be universal ───────────────────────────────────
    gst_rate: { s: '—', m: 'TaxRate (Tax Module)', n: 'no cross-border standard exists — the HS code drives the rate, and the rate is the jurisdiction’s' },
    gst: { s: '—', m: 'TaxRate (Tax Module)', n: 'alias' },
    sac: { s: '—', m: '—', o: 'India SAC', n: 'services counterpart of HSN' },
    cess: { s: '—', m: '—', n: 'India-specific levy' },
    // ── media ─────────────────────────────────────────────────────────────────────────────────────────────────
    image: { s: 'image', m: 'Product.thumbnail/images', n: '' },
    // ── ⭐ THE INSTANCE — these are NOT catalogue fields, and that is the point ────────────────────────────────
    tracking: {
      s: '—',
      m: 'Product.tracking',
      o: 'Odoo model',
      n: '⭐ ON THE PRODUCT: whether movements must carry a lot at all (none · lot · serial). True of every unit ever made, which is the test for belonging on the item.'
    },
    shelf_life_days: {
      s: '—',
      m: '—',
      n: 'ON THE PRODUCT: how long it lasts. The expiry DATE this implies belongs to the LOT — confusing the two is how a batch ends up in a catalogue.'
    },
    'lot.batch': {
      s: '—',
      m: 'stock.lot.name',
      o: 'GS1 AI (10)',
      n: '⚠️ ON THE LINE, NEVER THE ITEM. `batch_no` used to sit on the pharma catalogue item, and the CSV importer allows it as the identity key — one declaration away from a new catalogue row per consignment, i.e. a lot ledger wearing a catalogue’s name.'
    },
    'lot.expiry': {
      s: 'Offer.priceValidUntil ✗',
      m: 'lot expiration_date',
      o: 'GS1 AI (17)',
      n: '⚠️ NOT priceValidUntil — that is when an OFFER stops being valid. This is when the GOODS stop being safe. Two unrelated clocks that both look like "a date on a line".'
    },
    'lot.serial': { s: '—', m: 'stock.lot (serial)', o: 'GS1 AI (21)', n: 'one individual unit rather than one consignment' }
  };

  /* Standard fields we do NOT carry. Named so the absence is a DECISION with a trigger, not an oversight — the
     list is as much a part of "we follow the standards" as the map above. */
  var FIELD_GAPS = [
    {
      key: 'priceValidUntil',
      from: 'schema.org Offer',
      why: '⭐ THE TIME ANGLE, and the standard answers it: price validity belongs on the OFFER, not the product. Our design model already has pricing[].validFrom/validTo — items do not. This is the gap to close first.'
    },
    {
      key: 'itemCondition',
      from: 'schema.org Offer',
      why: 'new · used · refurbished · damaged. Matters the moment anyone trades machinery, scrap or seconds.'
    },
    {
      key: 'mid_code',
      from: 'Medusa',
      why: 'Manufacturer ID code — US customs. Needed only when a lane runs to the US; the trade-lane layer should ask for it, not the catalogue.'
    },
    {
      key: 'length/height/width',
      from: 'both',
      why: 'dimensions — freight cost and container fill. We carry weight and not volume, which is half a shipping answer.'
    },
    {
      key: 'manage_inventory / allow_backorder',
      from: 'Medusa',
      why: 'whether stock is tracked at all, and whether you may oversell. We have an availability feed but nothing that says "this item is not stock-tracked", so an empty feed and an untracked item look identical.'
    },
    { key: 'handle', from: 'Medusa', why: 'URL slug. Only meaningful once a storefront is public.' },
    { key: 'variant_rank', from: 'Medusa', why: 'display order of variants. Cosmetic until a catalogue is large.' },
    { key: 'is_giftcard · discountable', from: 'Medusa', why: 'NOT adopted — checkout concerns for a B2C shop, not properties of a traded good.' }
  ];

  /* Where our model and a standard genuinely disagree. Recorded, not silently "fixed" — renaming a live field is a
     migration, and the decision is Athi's. */
  var FIELD_CONFLICTS = [
    {
      ours: 'code',
      issue: 'labelled "Code / HSN" in the starter set, so one column is asked to hold either a merchant SKU or a WCO customs code.',
      standard: 'schema.org (sku vs no HS at all) and Medusa (sku on the variant, hs_code on both) keep them apart.',
      cost: 'a catalogue exported for customs would carry SKUs in the HS column, and nothing would flag it.',
      fix: 'split into sku + hs_code in starter-fields; existing rows keep `code` until someone chooses.'
    },
    {
      ours: 'price on the item',
      issue: 'a single price lives on the product record.',
      standard: 'schema.org models price on the Offer — the same good sells at different prices to different buyers.',
      cost: 'per-buyer and time-boxed pricing have nowhere to live, which is the same reason validFrom/validTo never reached items.',
      fix: 'an offers[] layer over the item, keyed by counterparty and validity window.'
    },
    {
      ours: 'variant as a field',
      issue: 'name + variant on one flat row.',
      standard: 'Medusa makes the variant the purchasable record and the product a grouping.',
      cost: 'none today — flat matches how a trader writes a price list, and the matcher depends on it. Recorded so the difference is deliberate.',
      fix: 'none proposed.'
    }
  ];

  /* stdFor(key) — the one-line reference a UI can print beside a field. Returns null when nothing maps, so the
     caller can stay silent rather than print "—". */
  function stdFor(key) {
    var f = FIELD_STANDARDS[key];
    if (!f) return null;
    var bits = [];
    if (f.s && f.s !== '—') bits.push('schema.org ' + f.s);
    if (f.m && f.m !== '—') bits.push('Medusa ' + f.m);
    if (f.o) bits.push(f.o);
    return bits.length ? { label: bits.join(' · '), note: f.n || '' } : f.n ? { label: '', note: f.n } : null;
  }

  // RFC 7386 — JSON Merge Patch. Pure, ~10 lines: null deletes a key, object recurses, scalar replaces.
  function mergePatch(target, patch) {
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
    var out = target && typeof target === 'object' && !Array.isArray(target) ? Object.assign({}, target) : {};
    Object.keys(patch).forEach(function (item) {
      if (patch[item] === null) {
        delete out[item];
      } else {
        out[item] = mergePatch(out[item], patch[item]);
      }
    });
    return out;
  }

  // GS1-style stable identity — first present of sku/gtin/code, else the name.
  function itemKey(it) {
    return (it && (it.sku || it.gtin || it.code || it.product || it.name)) || null;
  }

  // MDM source-priority — higher wins a field conflict; a source only overwrites a field a
  // stronger source already set if it is >= that strength (else it only fills empties).
  var SOURCE_PRIORITY = { manual: 5, csv: 4, erp: 3, blueprint: 2, reference: 2, value: 2, capture: 1 };

  // Upsert a source's contribution into the golden record set (MDM + RFC 7386).
  // Records per-field provenance in _lineage {field: {source, prio}} — that IS the four-leg made concrete.
  function upsertItem(items, incoming, opts) {
    opts = opts || {};
    items = items || [];
    var source = opts.source || 'manual';
    var prio = opts.priority != null ? opts.priority : SOURCE_PRIORITY[source] || 1;
    var key = itemKey(incoming);
    var existing = null;
    for (var index = 0; index < items.length; index++) {
      if (key && itemKey(items[index]) === key) {
        existing = items[index];
        break;
      }
    }
    if (!existing) {
      var created = mergePatch({}, incoming);
      created._src = source;
      created._lineage = {};
      Object.keys(incoming).forEach(function (item) {
        if (item.charAt(0) !== '_') created._lineage[item] = { source: source, prio: prio };
      });
      items.push(created);
      return { items: items, item: created, created: true };
    }
    var lin = existing._lineage || (existing._lineage = {});
    Object.keys(incoming).forEach(function (item) {
      if (item.charAt(0) === '_') return;
      var cur = lin[item];
      var empty = existing[item] == null || existing[item] === '';
      if (empty || !cur || prio >= cur.prio) {
        existing[item] = mergePatch(existing[item], incoming[item]);
        lin[item] = { source: source, prio: prio };
      }
    });
    // Carry display-only meta (e.g. _photo, _media) onto an existing record when it lacks it. These are not tracked in
    // _lineage (they are not four-leg fields), so the field loop above skips them — without this a second source hitting
    // the same SKU would silently lose the image.
    Object.keys(incoming).forEach(function (item) {
      if (item.charAt(0) === '_' && item !== '_lineage' && item !== '_src' && (existing[item] == null || existing[item] === ''))
        existing[item] = incoming[item];
    });
    return { items: items, item: existing, created: false, updated: true };
  }

  return {
    LEGS: LEGS,
    TYPES: TYPES,
    viaFor: viaFor,
    leg: leg,
    STD_SCHEMES: STD_SCHEMES,
    PRICE_BASIS: PRICE_BASIS,
    PRICE_BY: PRICE_BY,
    PRICE_ORIGIN: PRICE_ORIGIN,
    priceProvenance: priceProvenance,
    priceIsCheckable: priceIsCheckable,
    DATATYPES: DATATYPES,
    METHODS: METHODS,
    FACETS: FACETS,
    PRICING_MODELS: PRICING_MODELS,
    UNITS: UNITS,
    UNIT_ALIASES: UNIT_ALIASES,
    UNIT_LANGS: UNIT_LANGS,
    UNIT_NAMES: UNIT_NAMES,
    UNIT_KINDS: UNIT_KINDS,
    unitKind: unitKind,
    METHOD_MODELS: METHOD_MODELS,
    modelsForMethod: modelsForMethod,
    orphanModels: orphanModels,
    PALETTE: PALETTE,
    ensure: ensure,
    toBase: toBase,
    resolvePrice: resolvePrice,
    routeChain: routeChain,
    deriveComputeJob: deriveComputeJob,
    canonicalInputs: canonicalInputs,
    validate: validate,
    toJSONSchema: toJSONSchema,
    STANDARD_REFS: STANDARD_REFS,
    standards: standards,
    mergePatch: mergePatch,
    itemKey: itemKey,
    upsertItem: upsertItem,
    SOURCE_PRIORITY: SOURCE_PRIORITY,
    FIELD_STANDARDS: FIELD_STANDARDS,
    FIELD_GAPS: FIELD_GAPS,
    FIELD_CONFLICTS: FIELD_CONFLICTS,
    stdFor: stdFor
  };
});
