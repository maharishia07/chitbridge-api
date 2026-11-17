/* app/cap-definitions.js — DEFINITIONS · the shelf a catalogue takes things off.  (lazy capability)
 *
 * Athi, 2026-08-15: *"create another menu type next to catalogue, where we can showcase what are all can be added
 * as part of catalogue … and its rules can be set and then, the same can be called against catalogue."*
 * Then, on the plan: *"go ahead as per your suggestion"* — which was the READ-ONLY SHOWCASE first.
 *
 * ── ⭐ WHAT THIS SCREEN IS ───────────────────────────────────────────────────────────────────────────────────────
 * The DDL half, finally given a door. Catalogue is DML — mint products and sell them. This is the layer that has
 * been written down for months and never had a screen: the reusable things a catalogue ADOPTS.
 *
 * ── ⭐⭐ THE DISTINCTION THE WHOLE DESIGN TURNS ON ────────────────────────────────────────────────────────────────
 *   KIND        "a pack model exists"        CODE — a registry — changes in a release
 *   DEFINITION  "Carton of 6" / "Diwali 10%" DATA — the entity's shelf — changes any time
 *   ADOPTION    "this catalogue uses that"   a REFERENCE on the catalogue
 *
 * THIS FILE SHOWS KINDS ONLY. No definitions, no adoption, no authoring, no writes. That is deliberate: it is the
 * part that cannot break anything, it ships today, and it answers the question that actually blocks people —
 * *what can a catalogue even have?*
 *
 * ── ⚠️⚠️ IT NEVER KEEPS ITS OWN LIST ────────────────────────────────────────────────────────────────────────────
 * Every kind on this screen is read from the registry the code already publishes — CBCart.models, CBOffers.KINDS,
 * CBCatalogueModel's palette. Typing the lists here would create a second source of truth that drifts within one
 * release and then LIES on screen, which is the exact divergence cart-ui.js exists to end. A kind added to
 * offers.js next month appears here with no edit; a kind removed stops being shown. That is the whole trick.
 *
 * ⚠️ AND WHERE A REGISTRY IS ABSENT, SAY SO. If offers.js has not loaded, the row reads "not loaded" rather than
 * rendering an empty section that looks like "there are none" — an empty list and a missing source look identical
 * on screen and mean opposite things.
 * OWNS      the Definitions workshop: offers, tax slabs, categories and their editors, with the test panel (cbDefLoad is the shelf read, cbDefNew / cbDefEdit the editors).
 * CALLED BY app.html: CAP_OF definitions + the '+ New requirement' button (ensureCap('definitions')) · cap-catsetup.js (ensureCap('definitions'), cbDefNew / cbDefEdit) · cap-categories.js (cbDefRegistries · cbDefLabelOnce; its ensureCap('definitions') is a dead path on catalogue.html, which does not define ensureCap). No <script src> on any page: SUPPORT.
 * FLOW      ensureCap('definitions') → cbDefLoad → editor rows (cbDefFormHTML) → test panel (cbDefPaintPreview) evaluates through CBOffers with fmtMoney(moneyCode())
 * CARD      06-catalogue-pim/definitions-shelf
 */

var CBDEF = { open: {}, mine: null, loading: false, err: '' };

/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 *  AUTHORING — your own named things, on top of the kinds the system knows.
 * ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Athi decided the rule this is built on, 2026-08-16: **"frozen by value when stamped."** Loose while a catalogue
 * merely references a definition — edit it and every adopter sees the new terms. Frozen the moment a chit is
 * minted, because a chit whose terms change after they were agreed is not evidence of anything.
 *
 * ⭐ WHICH KINDS ARE AUTHORABLE, AND WHY NOT ALL OF THEM. A definition is only meaningful where its RULES have a
 * shape someone can fill in. `category` (a named list) and `ordermodel` ("Carton of 6" = pack/step 6) and `offer`
 * (a kind plus its conditions) all do. `facet` and `datatype` do not — they are vocabulary the system uses to
 * describe a catalogue, not things you name instances of. Offering a Create button against those would invite
 * someone to author a thing that can never be adopted.
 *
 * ⚠️ THE FORM IS DRIVEN BY THE REGISTRY, NOT BY A LIST HERE. `ordermodel` offers exactly the models cart-ui
 * publishes; `offer` offers exactly the kinds offers.js publishes. Add a model next month and it is offerable
 * with no edit to this file — the same discipline as the showcase above it.
 */
var CBDEF_AUTHORABLE = {
  /**
   * ⚠️ AUTHORING MOVED OUT — Athi, 2026-08-16: *"bring the category as a panel next to catalogue. keep creation
   * and updation in that panel"*. Categories are still LISTED here, because this screen is the map of every
   * definition you hold and omitting one kind would make the map lie. But the Create button is gone: two places
   * to author one thing is exactly the duplication this screen was reconciled to remove.
   *
   * `home` sends the section's action to the screen that owns it — declare once, refer everywhere.
   */
  category: {
    icon: '🗃️',
    title: 'Categories',
    one: 'category',
    home: { nav: 'categories', label: 'Open Categories →' },
    blurb:
      'A named list of products, and the one definition with no freeze semantics to worry ' +
      'about — a category has no terms that could change under a chit. ⚠️ A product can sit in ' +
      'several. Created and renamed under <b>' +
      tx('Categories') +
      '</b>, beside the Catalogue.'
  },
  ordermodel: {
    icon: '🔢',
    title: 'Order models',
    one: 'order model',
    home: { nav: 'catsetup', sec: 'ordermodels', label: 'Open Catalogue setup →' },
    blurb:
      'A quantity rule with a NAME, so a product adopts “Carton of 6” rather than repeating ' +
      'pack/step 6. ⚠️ Change it to 12 and every product that adopted it moves — which is either ' +
      'exactly what you want or a catastrophe, and is why adoption freezes at the mint. ' +
      'Authored under <b>' +
      tx('Catalogue setup') +
      '</b>.'
  },
  /* ⚠️ This blurb said "nothing evaluates these at order time yet" — true when written, false since offers were
     wired into compose. Stale copy is the same failure as the "read-only showcase" banner: someone reads it,
     believes the feature is inert, and never tries it. */
  offer: {
    icon: '🏷️',
    title: 'Offers',
    one: 'offer',
    home: { nav: 'catsetup', sec: 'offers', label: 'Open Catalogue setup →' },
    blurb:
      'An offer kind plus its conditions. Publish one and it applies to orders in compose — the ' +
      'breakdown shows what came off and, when it does not fire, how far short the order is. ' +
      'Authored under <b>' +
      tx('Catalogue setup') +
      '</b>.'
  },
  /**
   * ⭐⭐ BACKLOG 7 — THE BUYER'S OWN FLOOR. Athi, 2026-08-16: *"the entity should declare what minimum
   * certification he needs to have business and it has to check only those available, eventhough the supplier
   * may have n certificates"*.
   *
   * A paint supplier was being told it lacked a pharmaceutical manufacturing licence, because the supplier card
   * asked `readinessOf` with no vertical and hit the FLOOR in lib/readiness.js, which returns every active
   * standard in the system. Forty unheld certificates is not forty gaps.
   *
   * ⚠️ THIS DOES NOT NARROW THE ENGINE, AND MUST NOT. The floor is a deliberate guard and narrowing it would be
   * relaxing it. This is a SECOND, buyer-owned list that scopes what the SUPPLIER CARD reports — the two coexist,
   * and the one you cannot waive stays where it is. ⚠️ Destination and product regulatory requirements are NOT
   * this: a buyer does not get to declare away a customs rule.
   */
  /**
   * ⭐⭐ TAX SLABS — Athi, 2026-09-03: *"in india tax is not simple, each product has different tax criteria, so it
   * has to be product specific, but there are slabs, so define slab and attach the slab to the product, check how
   * other products are doing"*.
   *
   * What the other products do is the same thing three times over: Tally sets GST rate details on the item, the
   * stock GROUP and the company and takes the most specific; Zoho keeps a named tax record an item selects; Odoo
   * defaults `account.tax` per product category. So a slab is a DEFINITION like any other — named, versioned,
   * frozen onto a chit at the mint — and a product cites one.
   *
   * ⚠️ WE SHIP NO RATES. The kinds list offers the rates the SCHEME defines (0 · 5 · 12 · 18 · 28 + cess) as a
   * menu; which one a product attracts is per-HSN, changes at every Council meeting, and is the merchant's answer.
   * A rate table in our repository would be wrong silently and discovered at filing time — see lib/tax.js.
   */
  tax: {
    icon: '🧾',
    title: 'Tax slabs',
    one: 'tax slab',
    home: { nav: 'catsetup', sec: 'tax', label: 'Open Catalogue setup →' },
    blurb:
      'A named rate — “GST 18%” — that a product cites instead of repeating the number. ⚠️ A ' +
      'product with no slab inherits: first from its category, then from the catalogue default. ' +
      'Blank means INHERIT, never nil-rated. Authored under <b>' +
      tx('Catalogue setup') +
      '</b>.'
  },
  pricing: {
    icon: '💱',
    title: 'Pricing structures',
    one: 'pricing structure',
    home: { nav: 'catsetup', sec: 'pricing', label: 'Open Catalogue setup →' },
    blurb:
      'How a price is arrived at, with a NAME a product cites: fixed, tiered by quantity, or a band. ' +
      'A tier RE-PRICES the line (an offer discounts it, afterwards); a band constrains and never clamps. ' +
      'The product carries a copy of what the structure means, so a line stays explainable after the ' +
      'structure changes. Authored under <b>' +
      tx('Catalogue setup') +
      '</b>.'
  },
  requirement: {
    icon: '📋',
    title: 'Required certificates',
    one: 'requirement',
    blurb:
      'What YOU require of a supplier before you will trade with them — ISO 9001, FSSAI, a GST ' +
      'registration. Declare it once and every supplier is measured against your list instead of ' +
      'against every standard in the system. ⚠️ It scopes what you are shown; it cannot waive a ' +
      'rule the destination or the product imposes.'
  }
};
/**
 * ⭐ WORKED EXAMPLES — Athi: *"a link to its webpage, for example hs code, how it is used etc, some kind of
 * usage so the users can connect the context"*.
 *
 * ⚠️ THIS IS THE ONE PLACE THIS SCREEN HOLDS CONTENT OF ITS OWN, and it is deliberate: an example is
 * EXPLANATION, not data. The kinds themselves still come from the registries — nothing here invents a scheme,
 * adds one, or changes what the system supports. If a scheme is removed from STD_SCHEMES its example simply
 * stops being reachable, because the row it hangs on is gone.
 *
 * ⚠️ LINKS POINT AT THE ISSUING AUTHORITY. Not a lookup site, not a blog: only the defining body will still be
 * correct next year, and only it can settle an argument about what a code means.
 */
var CBDEF_EG = {
  'HS': {
    label: 'HS — Harmonized System',
    who: 'World Customs Organization',
    note:
      'The customs code for a physical good. Every cross-border shipment is classified with one, and the ' +
      'duty rate, the paperwork and often the licence all follow from it. India extends it to 8 digits (HSN) ' +
      'and GST rates are set against those.',
    eg: '0902.30 — black tea, in packets of 3 kg or less',
    url: 'https://www.wcotradetools.org/en/harmonized-system'
  },
  'GS1 GPC': {
    label: 'GS1 GPC — Global Product Classification',
    who: 'GS1',
    note:
      'What a retailer\'s systems use to group products — the "brick" a product belongs to. Different job ' +
      'from HS: GPC is for trade and shelf, HS is for customs.',
    eg: '10000025 — Tea (ready to drink)',
    url: 'https://www.gs1.org/standards/gpc'
  },
  'Schema.org': {
    label: 'Schema.org — web vocabulary',
    who: 'Schema.org (Google, Microsoft, Yahoo, Yandex)',
    note:
      'How a product is described so machines reading a web page understand it. ⚠️ Worth knowing that it ' +
      'models price on the OFFER, not on the product — the same good sells at different prices to different ' +
      'buyers. Our own model notes that as a gap.',
    eg: 'Product / Offer / priceSpecification',
    url: 'https://schema.org/Product'
  },
  'UNSPSC': {
    label: 'UNSPSC — UN Standard Products & Services Code',
    who: 'GS1 US, for the United Nations',
    note: 'The classification most procurement departments and tenders ask for. If a buyer says "give me your ' + 'UNSPSC", this is it.',
    eg: '50201706 — Tea',
    url: 'https://www.unspsc.org/'
  },
  'custom': {
    label: 'custom — your own scheme',
    who: 'you',
    note:
      'Your internal grouping, or one a particular buyer imposes. ⚠️ It travels with the catalogue but no ' +
      'outside party can resolve it — so it is a label, not a standard, and should not be used where a real ' +
      'scheme exists.',
    eg: 'GRADE-A / GRADE-B'
  }
};
/* ── the registries, read live ───────────────────────────────────────────────────────────────────────────────── */
function cbDefRegistries() {
  var out = [];

  /* Order models — the quantity rule a catalogue declares per item. cart-ui owns them. */
  out.push({
    key: 'ordermodel',
    icon: '🔢',
    title: 'Order model kinds',
    blurb: 'How a line is quantified. The catalogue declares it per item; every screen obeys.',
    source: 'app/cart.js · MODELS',
    rows:
      typeof CBCart !== 'undefined' && CBCart.models
        ? Object.keys(CBCart.models).map(function (item) {
            var m = CBCart.models[item];
            return { code: item, label: m.label || item, note: cbDefModelNote(item) };
          })
        : null
  });

  /* Offer kinds — offers.js. */
  out.push({
    key: 'offer',
    icon: '🏷️',
    title: 'Offer kinds',
    blurb: 'The shapes an offer can take. A definition picks a kind and sets its rules.',
    source: 'engine/offers.js · KINDS',
    rows:
      typeof CBOffers !== 'undefined' && CBOffers.KINDS
        ? Object.keys(CBOffers.KINDS).map(function (item) {
            return { code: item, label: cbDefOfferLabel(item), note: 'scope: ' + (CBOffers.KINDS[item].scope || '—') };
          })
        : null
  });

  /**
   * ⭐⭐ REWARD EARNING KINDS — read from CBRewards.EARN_KINDS, the same trick every section here uses.
   *
   * Athi, 2026-09-10: *"we don't need to specify the value conversion etc. We build the reward mechanism and allow
   * the business to decide... we only build the mechanism of accumulating and distributing the points, and how the
   * point has to be converted should depend on the parameter."*
   *
   * ⭐ THIS SCREEN IS WHERE THAT SENTENCE BECOMES VISIBLE. It publishes the SHAPES a shop may declare and the
   * parameters each one needs — and says nothing whatever about which one a business ought to pick, or what a
   * point should be worth. Add a kind to lib/rewards.js next month and it appears here with no edit; remove one
   * and it stops being shown.
   */
  out.push({
    key: 'reward',
    icon: '🎁',
    title: 'Reward earning kinds',
    blurb:
      'How points can be earned. A programme picks a kind and sets its parameters — the shop decides the rate, ' +
      'what a point converts into, and whether points expire. We only carry the mechanism.',
    source: 'lib/rewards.js · EARN_KINDS',
    rows:
      typeof CBRewards !== 'undefined' && CBRewards.EARN_KINDS
        ? Object.keys(CBRewards.EARN_KINDS).map(function (item) {
            var kind = CBRewards.EARN_KINDS[item];
            return {
              code: item,
              label: cbDefRewardLabel(item),
              /* ⚠️ THE PARAMETERS IT CANNOT WORK WITHOUT — a rule missing one earns nothing rather than
                      guessing, and a screen that hid that would make the refusal look like a fault. */
              note: 'needs: ' + (kind.needs || []).join(' · ')
            };
          })
        : null
  });

  /**
   * ⭐ THE GST SLAB RATES — read from the SAME module that resolves them (engine/tax.js's tax-slab part, the adopted mirror of
   * the API's lib/tax-slab.js). A second list here would be a second statement of what the scheme allows, and the
   * second one always goes stale.
   *
   * ⚠️ A MENU, NOT A MAPPING. These are the rates the scheme defines, which is a different statement from "this
   * product attracts this rate" — that one is per-HSN and the merchant's to make. Same rule tax.js states at
   * length: we carry the determination, never the rate table.
   */
  /* CX0: the rate menu and the scheme's word are the shop's PACK's (pack.tax.rates · pack.tax.scheme — GST 10 % in Australia, VAT 5 % in the UAE);
     India's GST_SLAB_RATES only under India's pack or none known */
  var tp = (typeof shopReg === 'function' && shopReg()) || null,
    tsch = (tp && tp.tax && tp.tax.scheme) || 'GST';
  var trates = (tp && tp.tax && tp.tax.rates) || (typeof CBTaxSlab !== 'undefined' && CBTaxSlab.GST_SLAB_RATES) || null;
  out.push({
    key: 'tax',
    icon: '🧾',
    title: tsch + ' slab rates',
    blurb:
      'The rates the scheme itself defines. Name one as a slab, then a product cites it. Cess rides on top ' +
      'of the slab and is declared per slab, because it varies by product within one rate.',
    source: tp ? 'engines reg-' + String(tp.id || '').toLowerCase() + ' · tax.rates' : 'engine/tax.js · GST_SLAB_RATES',
    rows: trates
      ? trates.map(function (item) {
          return { code: String(item) + '%', label: tsch + ' ' + item + '%', note: tsch === 'GST' && tp && tp.id === 'IN' ? cbDefSlabNote(item) : '' };
        })
      : null
  });

  /* The catalogue's own grammar — datatypes, selling methods, facets, pricing models, standards. */
  /**
   * ⚠️ `CBCatalogue`, NOT `CBCatalogueModel` — I invented the second name and five of the seven sections read
   * "not loaded" while the data was sitting right there. The registry's real global is CBCatalogue (see
   * catalogue-model.js line 18, `root.CBCatalogue = M`), which is precisely the name catalogue-ui.js was
   * clobbering an hour ago; renaming that one to CBCatUI is what freed it.
   *
   * ⭐ Worth noting the honest-empty-state rule earned its keep twice in one evening: "not loaded" is what
   * surfaced BOTH the missing offers.js script tag and this wrong name. Had the section rendered as an empty
   * list, both would have read as "there are none" and neither would have been found.
   */
  var P = typeof CBCatalogue !== 'undefined' && CBCatalogue.PALETTE ? CBCatalogue.PALETTE() : null;
  /**
   * ⚠️ THE BLURB USED TO SAY "not yet evaluated at order time" AND THAT IS NO LONGER TRUE — `price-resolve.js`
   * evaluates them (28/0). A screen that keeps describing a gap after the gap is filled is the same failure as
   * the "read-only showcase" banner that outlived read-only by an hour: someone reads it and stops looking.
   */
  out.push({
    key: 'pricing',
    icon: '💱',
    title: 'Pricing models',
    blurb:
      'How a price is arrived at. A catalogue can declare several — a list price, a bulk tier, a regional ' +
      'or time-boxed one — and the resolver picks the MOST SPECIFIC that applies, never the cheapest.',
    source: 'app/catalogue-model.js · PRICING_MODELS',
    rows:
      P && P.pricingModels
        ? P.pricingModels.map(function (item) {
            return { code: item, label: cbDefPricingLabel(item), note: cbDefPricingNote(item) };
          })
        : null
  });
  /**
   * ⭐ WHERE A PRICE IS REFERRED FROM — Athi, 2026-08-16: *"can we say where prices are refered from, or accessed
   * from, example, url, website"*. `basis` said what KIND of source; this says WHERE, and that is the half that
   * makes a price checkable by the other party rather than merely asserted.
   */
  out.push({
    key: 'priceorigin',
    icon: '🔗',
    title: 'Price sources',
    blurb:
      'Where a price was referred from — and when it was read. A price with a named source, a link and a ' +
      'reading date is evidence; one without is an assertion. Both are allowed; they must not look alike.',
    source: 'app/catalogue-model.js · PRICE_ORIGIN',
    rows:
      P && P.priceOrigin
        ? P.priceOrigin.map(function (item) {
            return { code: item, label: cbDefOriginLabel(item), note: cbDefOriginNote(item) };
          })
        : null
  });
  out.push({
    key: 'method',
    icon: '🧾',
    title: 'Selling methods',
    blurb: 'How a whole catalogue sells. One per catalogue.',
    source: 'app/catalogue-model.js · METHODS',
    rows:
      P && P.methods
        ? P.methods.map(function (item) {
            return { code: item.k, label: item.label };
          })
        : null
  });
  out.push({
    /**
     * ⭐ UNITS OF MEASURE — a declared kind as of 2026-08-16. The list used to live inside the catalogue wizard as
     * `CW_UNITS`, so the one attribute every line item carries could not be declared or referred to anywhere. It
     * is in the model now, which means this screen can publish it and Governance can point at it.
     */
    key: 'unit',
    icon: '⚖️',
    title: 'Units of measure',
    blurb: 'What a quantity is counted in — the same list the catalogue wizard offers on every item.',
    source: 'app/catalogue-model.js · UNITS',
    rows:
      typeof CBCatalogue !== 'undefined' && CBCatalogue.UNITS
        ? CBCatalogue.UNITS.map(function (item) {
            return { code: item, label: item };
          })
        : null
  });
  out.push({
    key: 'datatype',
    icon: '🔤',
    title: 'Field datatypes',
    blurb: 'What a catalogue field can hold — the palette a field set is built from.',
    source: 'app/catalogue-model.js · DATATYPES',
    /* ⚠️ The palette carries a `note` per datatype and this screen was dropping it — the note is the half that
       says what the type is FOR ("expiry, harvest", "value + unit"), which is exactly what someone reading this
       list needs. Showing the code and the label alone made the list look like jargon. */
    rows:
      P && P.datatypes
        ? P.datatypes.map(function (item) {
            return { code: item.k || item, label: item.label || item.k || item, note: item.note || '' };
          })
        : null
  });
  /**
   * ⭐ EXAMPLES AND LINKS — Athi, 2026-08-16: *"what we may need is an example where possible, a link to its
   * webpage, for example hs code, how it is used etc, some kind of usage so the users can connect the context"*.
   *
   * A list of scheme names teaches nobody what to do. "HS" means nothing until you see `0902.30` next to
   * "black tea, packets under 3kg" and the sentence explaining that customs reads it and duty follows from it.
   *
   * ⚠️ THE LINKS GO TO THE ISSUING AUTHORITY, not to a blog or a lookup service. A standard is only useful if
   * you can reach the body that defines it — and that is also the only source that will still be right next
   * year. Same rule the price provenance work applied to money.
   */
  out.push({
    key: 'standard',
    icon: '📐',
    title: 'Standards',
    blurb: 'Classification schemes a product can cite. You cite the code; the issuing body owns the scheme ' + 'and keeps it current.',
    source: 'app/catalogue-model.js · STD_SCHEMES',
    rows:
      P && P.standards
        ? P.standards.map(function (item) {
            var e = CBDEF_EG[item] || {};
            return { code: item, label: e.label || item, note: e.note, eg: e.eg, url: e.url, who: e.who };
          })
        : null
  });
  /**
   * ⭐ FACETS GET THEIR MEANING SPELLED OUT — Athi, 2026-08-16: *"under field data type, consists of, means, this
   * item consists of the following item"*.
   *
   * He was reading `bom` and asking what it means. It IS "consists of" — a bill of materials,
   * `bom:[{item, qty}]`, already in the model (catalogue-model.js line 10 and FACETS). But a screen that prints
   * the bare code `bom` is a screen only its author can read, and the question proved it: the concept was
   * present and unfindable.
   *
   * ⚠️ THE CODE STILL SHOWS. `bom` is what the data says and what anyone integrating will see; renaming it here
   * would make this screen disagree with the payload. Code AND plain words, not one or the other.
   */
  out.push({
    key: 'facet',
    icon: '🧩',
    title: 'Catalogue facets',
    blurb: 'The parts a catalogue definition is made of. A catalogue declares which of these it uses.',
    source: 'app/catalogue-model.js · FACETS',
    rows:
      P && P.facets
        ? P.facets.map(function (item) {
            return { code: item, label: cbDefFacetLabel(item), note: cbDefFacetNote(item) };
          })
        : null
  });

  return out;
}
/* The one-line reason each order model exists. ⚠️ Kept as PROSE about a rule that lives in cart-ui — not a second
   copy of the rule. If these ever disagree, cart-ui is right and this text is stale. */
function cbDefModelNote(k) {
  return (
    {
      count: 'Whole units. A tin, a bag, a licence.',
      measure: 'A decimal amount — 2.5 kg is a real order, 2.5 tins is not.',
      pack: 'Sold in multiples. The multiple IS the unit of sale, so 13 rounds to a legal pack.',
      range: '⚠️ A declared min/max. Below the minimum is REFUSED, never rounded up — ordering more than someone asked for costs them money.',
      pick: 'One or none. No quantity control at all; a second press must not make it two.',
      offer: 'A quantity AND your price, inside the seller’s band. Two facts about one line.'
    }[k] || ''
  );
}
/**
 * What each GST rate is FOR, in the words a merchant uses. ⚠️ PROSE about the scheme, not a rate table — no
 * product is named and nothing here resolves one. If these examples and the Council ever disagree, the Council is
 * right and this is stale, which is exactly why no product may inherit a rate from this text.
 */
function cbDefSlabNote(r) {
  return (
    {
      0: 'Nil-rated and exempt — fresh produce, unbranded staples. ⚠️ 0% is an ANSWER; “no slab” is not.',
      0.25: 'Rough diamonds and a few precious stones.',
      3: 'Gold, silver and jewellery.',
      5: 'Essentials — packaged food, tea, edible oil, most transport.',
      12: 'Processed food, some machinery.',
      18: 'The standard rate. Most manufactured goods and services sit here.',
      28: 'Luxury and demerit goods — ⚠️ usually with CESS on top, which is why cess is per slab.'
    }[r] || ''
  );
}
/**
 * What each facet MEANS, in the words a person would use. ⚠️ Prose about the model, not a second copy of it —
 * `catalogue-model.js` owns what a facet does; if these ever disagree, it is right and this is stale.
 */
function cbDefFacetLabel(f) {
  return (
    {
      identity: 'Identity — what it is',
      variants: 'Variants — sizes, grades, finishes',
      units: 'Units — base unit and conversions',
      standards: 'Standards — HS, GS1, cited by reference',
      media: 'Media — images and video',
      bom: 'Consists of — what it is made from',
      pricing: 'Pricing — how the price is arrived at',
      loop: 'Loop — what comes back (returns, empties)',
      feedback: 'Feedback — what buyers said'
    }[f] || f
  );
}
function cbDefFacetNote(f) {
  return (
    {
      /* ⭐ Athi's own words for it: "this item consists of the following item". */
      bom: 'A bill of materials — this item consists of these items, each with a quantity. It is what makes a finished good traceable back to what went into it, and what mass-balance reconciles across parties.',
      variants: 'One product, several purchasable lines. The variant is what distinguishes them — 1L / 4L / 10L.',
      units:
        'The base unit and the factors to convert into it. ⚠️ This is what delivery matching compares; a line with no unit cannot be matched against a delivery.',
      loop: 'The returnable half of a trade — crates, drums, pallets that come back.',
      pricing: 'Declared today; ⚠️ not yet evaluated at order time.'
    }[f] || ''
  );
}
function cbDefPricingLabel(k) {
  return (
    {
      fixed: 'Fixed — one declared amount',
      range: 'Range — a band, not a number',
      tiered: 'Tiered — the price changes with quantity',
      'market-ref': 'Market reference — read from a published source',
      negotiated: 'Negotiated — agreed per counterparty'
    }[k] || k
  );
}
function cbDefPricingNote(k) {
  return (
    {
      fixed: 'What you charge, full stop. Most prices are this, and that is fine.',
      range: '⚠️ A band is a CONSTRAINT, not a discount — a price outside it is reported as a violation, never quietly clamped to fit.',
      tiered:
        'A qualifying tier RE-PRICES the line; it is not a discount off the list price. ⚠️ Tiers are per line — 30 of one product does not earn the 30-tier on another.',
      'market-ref':
        "A published figure, with WHERE it was read and WHEN. ⚠️ Recorded, never fetched live at seal — a chit whose total depends on someone else's page being up is a chit two parties can compute differently.",
      negotiated: 'What you and one counterparty agreed. ⚠️ Frozen onto the chit at the mint, so it survives the shelf changing afterwards.'
    }[k] || ''
  );
}
function cbDefOriginLabel(o) {
  return (
    {
      url: 'A web page',
      publisher: 'A named publisher',
      exchange: 'An exchange or index',
      system: 'An ERP or price list',
      contract: 'A signed contract',
      manual: 'Set by hand'
    }[o] || o
  );
}
function cbDefOriginNote(o) {
  return (
    {
      url: 'A link anyone can open. ⚠️ Recorded, never fetched at seal — a chit whose total depends on a third-party page being up is a chit two parties can compute differently.',
      publisher: 'A mandi board, a trade journal, an association circular. Carries the publisher and the date read.',
      exchange: 'A traded reference — a symbol and a reading date. Without the date a market price cannot be checked against anything.',
      system: 'Your own ERP or a price-list id. The ref is the identifier there.',
      contract: 'A number you agreed. The ref is the contract number, which is what makes it findable later.',
      manual: 'You set it. Honest and unverifiable — which is fine, as long as it does not look like the others.'
    }[o] || ''
  );
}
function cbDefOfferLabel(k) {
  return (
    {
      percent_off: 'Percentage off',
      amount_off: 'Flat amount off',
      tier_price: 'Quantity tier — a RE-PRICE, not a discount',
      threshold: 'Spend or quantity threshold — reports the shortfall when it does not fire',
      /* ⚠️ THIS LABEL WAS DESCRIBING THE OTHER KIND. It read 'cheapest qualifying units are the free ones',
       which is mix_and_match — and the shop that read it while creating a buy_x_get_y was told the wrong rule at
       the exact moment it was choosing. Athi, 2026-09-10: 'we cannot offer for different product.' */
      buy_x_get_y: 'Buy X get Y of the SAME product — 3 of a thing earns one of that thing',
      mix_and_match: 'Mix and match — any X across the category, and the CHEAPEST one is free',
      bundle_price: 'Bundle — named items together for one price; complete sets only',
      shipping: 'Shipping — free, flat or a percentage',
      price_range: '⚠️ A declared band — reports a violation, never clamps a negotiated price'
    }[k] || k
  );
}
/* ── my definitions: load, author, edit, retire ──────────────────────────────────────────────────────────────── */

/**
 * ⚠️ ONE LOAD, NOT ONE PER SECTION. Three authorable kinds could mean three round trips on every paint; the
 * route already filters by kind, but the SHELF is one thing and reads as one thing. `?all=1` so retired
 * definitions are in hand — they are hidden by default in the UI, but a retired item you cannot see is how
 * someone re-creates a definition they already retired.
 */
async function cbDefLoad(force) {
  if (CBDEF.mine && !force) return;
  if (CBDEF.loading) return;
  CBDEF.loading = true;
  CBDEF.err = '';
  try {
    /* ⚠️ `defListAll`, not defList with params — api() substitutes PATH tokens and silently drops leftover
       params, so `{all:1}` never reached the server. The shelf was therefore hiding retired definitions by
       accident rather than by request, which happened to look right. */
    var reply = await api('defListAll');
    CBDEF.mine = (reply && reply.definitions) || [];
  } catch (e) {
    /* ⚠️ A LOAD FAILURE IS SAID, NOT SWALLOWED INTO AN EMPTY SHELF. "you have none" and "we could not ask" look
       identical as an empty list and mean opposite things — the same rule the "not loaded" registry rows follow.
       503 is the honest, expected case before b160 has run anywhere. */
    CBDEF.mine = [];
    CBDEF.err = (e && e.message) || 'Could not read your definitions.';
  }
  CBDEF.loading = false;
  /* Same reason as cbDefToggle — this lands AFTER the screen is up, so a full render would yank a reader who has
     already scrolled back to the top. cbDefRepaint falls back to renderApp when the wrap is not present. */
  cbDefRepaint();
}

/** ⚠️ WORDS A SHOPKEEPER USES, not the code. The registry key is the contract; this is only how it reads. */
function cbDefRewardLabel(k) {
  return (
    {
      per_amount: 'Points for every amount spent',
      value_as_points: 'The bill value itself becomes points',
      per_visit: 'Points for each visit, whatever it is worth',
      per_item: 'Points for every item bought',
      on_items: 'Points on chosen products — a reward instead of a discount'
    }[k] || k
  );
}
function cbDefMineOf(kind) {
  return (CBDEF.mine || []).filter(function (item) {
    return item.kind === kind && item.status !== 'retired';
  });
}
function cbDefRetiredOf(kind) {
  return (CBDEF.mine || []).filter(function (item) {
    return item.kind === kind && item.status === 'retired';
  });
}

/** The rule fields a kind offers — read from the registries, never listed here. */
function cbDefRuleFields(kind, sub) {
  /**
   * ⚠️ `category` HAS NO RULE FIELDS, AND THAT IS THE FIX (Athi's call, 2026-08-16).
   *
   * It used to offer `members` — "products in this category, one name per line". That was the old way of saying
   * the relationship, by TYPED NAME, and it now competes with products that cite the category by definition_id.
   * Two ways to say one thing, and the typed one matched nothing: nobody reads `members`, so a name typed there
   * classified no product at all. A field that looks like it works and does nothing is worse than no field.
   *
   * Membership is set from the Catalogue — tick products, press Categorise — and is stored on the PRODUCT, which
   * is the only side that can carry it across an entity boundary (catgSetOn in core.js).
   */
  if (kind === 'category') return [];
  if (kind === 'requirement') {
    /* ⚠️ STANDARD KEYS, NOT FREE TEXT — the whole point is that these match what a supplier's readiness record
       is keyed by, so "ISO 9001" typed by hand would match nothing. The form renders the real, available keys as
       chips to tap (cbDefStdChips), so the list is authored from the system's own vocabulary. */
    return [{ k: 'standards', label: 'Certificates you require', ph: 'one standard key per line', area: true }];
  }
  /**
   * ⭐⭐ A SLAB IS A RATE WITH A NAME. Athi, 2026-09-03: *"there are slabs, so define slab and attach the slab to
   * the product"*. Four fields, and every one of them earns its place:
   *
   *   rate            the number. ⚠️ BLANK IS NOT ZERO — 0% is nil-rated, which is a real answer; an unanswered
   *                   slab resolves to `rate: null` so a screen can say "not stated" instead of charging nothing.
   *   cess            per SLAB, not per catalogue: 28% goods carry wildly different cess, so it cannot live one
   *                   level up. Rides on top of the rate; lib/tax.js already emits CesRt/CesAmt per line.
   *   hsn             the codes this slab covers, one per line. ⚠️ RECORDED, NEVER RESOLVED — nothing in CB looks
   *                   a product's HSN up in this list to pick a slab for it. It is the merchant's own note of WHY
   *                   this slab exists, and the thing their CA checks. Auto-picking from it would be shipping a
   *                   rate table by the back door.
   *   effective_from  when the Council's change starts. ⚠️ A future date is REPORTED, not silently ignored:
   *                   falling through to the catalogue default because a rate starts next month would charge the
   *                   old rate with nothing on screen to say why.
   */
  if (kind === 'tax') {
    return [
      { k: 'rate', label: 'Rate', ph: '18', num: true, pct: true },
      { k: 'cess', label: 'Cess on top (blank = none)', ph: '0', num: true, pct: true },
      { k: 'hsn', label: 'HSN codes this covers (your note — nothing resolves from it)', ph: 'one code per line', area: true },
      { k: 'effective_from', label: 'In force from', ph: 'YYYY-MM-DD', date: true } /* a real date control (Athi, 2026-09-05: "date picker is not there") */
    ];
  }
  if (kind === 'pricing') {
    /* the names the engine reads (pricing.js copyOf): amount · tiers · min · max */
    var list = [];
    if (sub === 'fixed') list.push({ k: 'amount', label: "Amount (blank = the product's list price)", ph: '1000', num: true, money: true });
    if (sub === 'tiered')
      list.push({
        k: 'tiers',
        label: 'Price breaks',
        tiers: true,
        area: true,
        ph: '10 = 950\n50 = 900',
        hint: 'One per line: from this quantity = price each. Below the first break the list price applies.'
      });
    if (sub === 'range') {
      list.push({ k: 'min', label: 'Lowest', ph: '900', num: true, money: true, half: true });
      list.push({ k: 'max', label: 'Highest', ph: '1100', num: true, money: true, half: true });
    }
    return list;
  }
  if (kind === 'ordermodel') {
    /* The shape each model actually uses. ⚠️ cart-ui's MODELS decide behaviour; these are the inputs those
       models read (`o.step`, `o.min`, `o.max`), so the names must match what coerce/next look for. */
    var f = [];
    if (sub === 'pack' || sub === 'measure' || sub === 'range') f.push({ k: 'step', label: 'Step', ph: '6', num: true });
    if (sub === 'range') {
      f.push({ k: 'min', label: 'Minimum', ph: '5', num: true });
      f.push({ k: 'max', label: 'Maximum', ph: '500', num: true });
    }
    if (sub === 'offer') {
      f.push({ k: 'price_min', label: 'Lowest price you will accept', num: true, money: true });
      f.push({ k: 'price_max', label: 'Highest', num: true, money: true });
    }
    return f;
  }
  if (kind === 'offer') {
    var g = [];
    if (sub === 'percent_off' || sub === 'threshold') g.push({ k: 'percent', label: 'Percent off', ph: '10', num: true, pct: true, half: true });
    if (sub === 'amount_off' || sub === 'threshold') g.push({ k: 'amount', label: 'Amount off', num: true, money: true, half: true });
    /**
     * ⚠️⚠️ THE FORM NEVER ASKED, AND THAT WAS THE BUG. Athi wrote "Rs 20 off cooking oil" meaning twenty off
     * EACH tin; the engine took twenty off the LINE. Neither was wrong — the question had not been put. It is
     * put now, and the badge says the answer ("₹20 off each" vs "₹20 off") so the shelf cannot mislead either.
     * ⚠️ Default 'line', because that is what every offer already written means, and repricing them silently
     * would be discovered at somebody's counter.
     */
    if (sub === 'amount_off')
      g.push({
        k: 'per',
        label: 'Taken off',
        half: true,
        pick: [
          ['line', 'the line once — ₹20 off however many'],
          ['item', 'each item — 3 × ₹20 = ₹60']
        ]
      });
    if (sub === 'threshold') {
      g.push({ k: 'min_amount', label: 'Spend at least', num: true, money: true, half: true });
      g.push({ k: 'min_qty', label: '…or this many items', num: true, half: true });
    }
    /**
     * ⚠️⚠️ tier_price HAD NO FIELDS AT ALL. The registry advertises it — "Quantity tier — a RE-PRICE, not a
     * discount" — the kind picker offers it, and choosing it produced an offer with no `tiers`: the engine read
     * an empty list and returned nothing, forever. The one kind a B2B seller reaches for first was authorable
     * only in the sense that it could be saved.
     */
    if (sub === 'threshold') {
      g.push({ k: 'get_item_id', label: 'Reward item (product id — blank = a discount instead)', half: true });
      g.push({ k: 'get_item_name', label: 'Reward item, as shown', ph: '1 kg sugar', half: true });
      g.push({ k: 'get_qty', label: 'Reward quantity', ph: '1', num: true, half: true });
      g.push({ k: 'get_percent', label: 'Reward discount (100 = free)', ph: '100', num: true, half: true });
    }
    if (sub === 'bundle_price') {
      g.push({ k: 'bundle_items', label: 'Items in the bundle (product ids, one per line)', area: true, ph: 'one product id per line' });
      g.push({ k: 'bundle_price', label: 'Bundle price', ph: '1999', num: true, money: true, half: true });
      g.push({ k: 'max_sets', label: 'Max sets per order (blank = no cap)', num: true, half: true });
    }
    if (sub === 'tier_price')
      g.push({ k: 'tiers', label: 'Price breaks', tiers: true, area: true, ph: '10 = 170\n50 = 160', hint: 'One per line: quantity = price each.' });
    /* ⭐ mix and match asks for the same three numbers and NOT get_item_id: its reward is always drawn from
       what already qualified, so naming another product would be a field the kind cannot honour. */
    if (sub === 'mix_and_match') {
      g.push({ k: 'buy', label: 'Buy any', ph: '2', num: true, half: true });
      g.push({ k: 'get', label: 'Get', ph: '1', num: true, half: true });
      g.push({
        k: 'get_percent',
        label: 'Reward discount',
        num: true,
        half: true,
        ph: '100',
        hint: '100 = free. The cheapest qualifying unit is the one it comes off.'
      });
      g.push({ k: 'max_sets', label: 'Max sets per order (blank = no cap)', num: true, half: true });
    }
    if (sub === 'buy_x_get_y') {
      g.push({ k: 'buy', label: 'Buy', ph: '1', num: true, half: true });
      g.push({ k: 'get', label: 'Get', ph: '1', num: true, half: true });
      g.push({ k: 'get_percent', label: 'Reward discount', num: true, half: true, ph: '100', hint: '100 = free.' });
      /**
       * ⭐⭐ THE REWARD MAY BE A DIFFERENT PRODUCT — Athi, 2026-09-03: *"include
       * another item from the catalogue as an offer"*. Blank keeps the original
       * behaviour (the cheapest QUALIFYING unit goes free); naming a product makes
       * it "buy rice, get oil free", which this kind could not say at all.
       */
      g.push({ k: 'get_item_id', label: 'Reward — a different product (blank = one of these)', pick: 'product' });
    }
    if (sub === 'price_range') {
      g.push({ k: 'min', label: 'Band minimum', num: true, money: true, half: true, hint: 'Warns when a price falls outside. Never changes it.' });
      g.push({ k: 'max', label: 'Band maximum', num: true, money: true, half: true });
    }
    /**
     * ⚠️ "blank = free" WAS A PROMISE THE ENGINE DID NOT KEEP. The only shipping field was the percentage, and
     * blank produced an offer with no term at all — offers.js requires `free`, so it moved nothing and said
     * nothing. Free shipping is now a thing you tick, which is also the only way to author the commonest
     * shipping offer there is.
     */
    if (sub === 'shipping') {
      g.push({ k: 'free', label: 'Free shipping', check: true, half: true });
      g.push({ k: 'flat', label: 'or a flat rate', num: true, money: true, half: true });
      g.push({ k: 'percent', label: 'or off shipping', num: true, pct: true, half: true });
    }
    /**
     * ⭐ WHAT IT COMES OFF — the two kinds offers.js declares as `scope:'either'`. Nothing ever set `scope`, so
     * every percentage anyone authored was a PER-LINE discount and "10% off the whole order" could not be said.
     */
    if (typeof CBOffers !== 'undefined' && CBOffers.KINDS && CBOffers.KINDS[sub] && CBOffers.KINDS[sub].scope === 'either') {
      g.push({
        k: 'scope',
        label: 'Comes off',
        half: true,
        sel: [
          { v: '', label: 'Each line it applies to' },
          { v: 'cart', label: 'The order total' }
        ]
      });
    }
    /* ⭐ TARGETING — "10% off Paints" (backlog 20). The engine has read `applies_to.category` all along; nothing
       ever SET it, and no cart line carried a category to match against, so the field was dead on both sides. */
    g.push({ k: 'applies_to.category', label: 'Only this category', pick: 'category', half: true });
    /* ⭐ A MINIMUM ORDER SIZE (Athi, 2026-09-06): "10% off when you take 5 or more" — the badge says "10% off 5+" */
    g.push({
      k: 'applies_to.min_qty',
      label: 'From this many units',
      ph: '5',
      num: true,
      half: true,
      hint: 'Blank = any quantity. The badge says the condition.'
    });
    /* ⭐ CUSTOMER-ONLY (Athi, 2026-09-06: "each customer gets a personalised discount… through the Suppliers menu"): a group from the
       Customers list (new · regular · high value · inactive) or one customer by name. Never on the public storefront; a signed-in buyer
       the seller's list names sees it on Suppliers, in the cart, on the order — the engine's customer_group condition, fail-closed. */
    g.push({ k: 'customer_group', label: 'Only for', pick: 'customer', half: true });
    /* ⭐ THE ALIAS (Athi, 2026-09-06 19:2x): the name customers see. Inside, tier1 · tier2 · tier3; outside, everyone sees "Tier1 customer". Blank = the offer's name. */
    g.push({
      k: 'alias',
      label: 'Shown to customers as',
      ph: 'e.g. Tier1 customer · Special discount',
      half: true,
      hint: 'Leave blank to show the name above. Customers never see the name when this is set.'
    });
    /* Conditions every offer kind shares — the ones offers.js evaluates in within(). */
    g.push({ k: 'valid_from', label: 'Valid from', date: true, half: true });
    g.push({ k: 'valid_to', label: 'Valid to', date: true, half: true, hint: 'Runs to the end of that day.' });
    /**
     * ── ⚠️⚠️ REGION IS WITHHELD, AND IT IS NOT AN OVERSIGHT ────────────────────────────────────────────────
     *
     * Athi, 2026-09-03: *"i am not sure what region means"*. Neither is the app. `within()` compares `o.region`
     * to `ctx.region` — and NOTHING SUPPLIES ctx.region. Every caller of evaluate() (the cart's offer pass, its
     * second pass, the compose SEND, catalogue-ui's breakdown) and every caller of promise()/forLine() (the
     * product page, the storefront in shop.html) passes lines, offers and a money formatter, and no buyer
     * region at all. So `o.region && ctx.region` is false on every path: typing "Tamil Nadu" here narrowed
     * nothing, and the offer applied to every buyer everywhere.
     *
     * ⚠️ AN OPTION THAT DOES NOTHING IS A LIE, and this one is the expensive kind — the author believes they
     * have restricted an offer and has no way to find out they have not until a buyer somewhere else claims it.
     *
     * ⭐ WHAT WOULD HAVE TO EXIST FIRST: an order that knows WHERE IT IS BEING SUPPLIED — the buyer's
     * state/place of supply carried on the cart context, which is the same two-address context lib/tax.js needs
     * to decide intra- vs inter-state. When that exists, this returns as "Only for buyers in …", naming where
     * the value comes from. Offers already saved with a region keep it; it is still inert, as it always was.
     */
    /**
     * ⭐ STACKING, WHICH THE ENGINE HAS ALWAYS READ AND THE FORM NEVER WROTE. evaluate() sorts by `priority` and
     * an `exclusive` offer that fires stops the ones after it — so two offers on one product were stacking in an
     * order nobody had chosen, and "this one instead of the others" was not expressible at all.
     */
    g.push({ k: 'priority', label: 'Stacking order', ph: '1', num: true, half: true, hint: 'Lower runs first.' });
    g.push({
      k: 'exclusive',
      label: 'Exclusive',
      check: true,
      half: true,
      hint: 'Once this applies, no other offer does — it runs before every non-exclusive offer, whatever the stacking numbers say.'
    });
    return g;
  }
  return [];
}

/** The sub-kinds a kind offers — READ FROM THE REGISTRY, so this file never holds the list. */
function cbDefSubKinds(kind) {
  if (kind === 'ordermodel') {
    var all = typeof CBCart !== 'undefined' && CBCart.models ? Object.keys(CBCart.models) : [];
    /**
     * ⭐ NARROWED BY WHAT THE CATALOGUE CAN ACTUALLY SELL (backlog 18). Athi: *"so a catalogue choose what it
     * wants to display, if you have not chosen range, your catalogue will not work for range?"* — it did not
     * refuse, it did not warn, and the two disagreed at ORDER TIME, which is to say the customer found out.
     * A `text` catalogue is a payload catalogue: it sells no quantities, so it offers no order models.
     *
     * ⚠️ FAILS OPEN, DELIBERATELY. If the catalogue's method is not loaded here we offer EVERYTHING, because the
     * damage is asymmetric: hiding a model the catalogue genuinely supports silently removes a capability the
     * owner already relies on and gives them no way to ask for it back, while offering one it does not support
     * is caught downstream by the orphan check. Never narrow on a guess.
     */
    var method = (typeof UI !== 'undefined' && UI.catf && UI.catf.method) || null;
    if (!method || typeof CBCatalogue === 'undefined' || !CBCatalogue.modelsForMethod) return all;
    var ok = CBCatalogue.modelsForMethod(method);
    var narrowed = all.filter(function (item) {
      return ok.indexOf(item) >= 0;
    });
    /* ⚠️ A method that supports NOTHING still returns nothing — that is the point for `text`/`form`, and the
       caller shows why rather than rendering an empty picker with no explanation. */
    return narrowed;
  }
  if (kind === 'offer') return typeof CBOffers !== 'undefined' && CBOffers.kinds ? CBOffers.kinds : [];
  /* ⚠️ ONE SUB-KIND TODAY, AND IT IS STILL DECLARED. `gst_slab` says WHICH tax scheme this rate belongs to, and a
     VAT or a state-cess slab would be a sibling — a definition whose sub_kind is null cannot be told apart from
     one authored before the scheme existed, which is the ambiguity every other kind here avoids. */
  if (kind === 'tax') return ['gst_slab'];
  /* ⭐ the three a product can cite today; market-ref and negotiated wait on a source / a counterparty (price-resolve.js) */
  if (kind === 'pricing') return typeof CBPricing !== 'undefined' && CBPricing.kinds ? CBPricing.kinds : ['fixed', 'tiered', 'range'];
  return [];
}

var CBDEF_FORM = null; // { kind, sub, name, note, rules, id, version }

function cbDefNew(kind) {
  var subs = cbDefSubKinds(kind);
  /* ⚠️ AN EMPTY PICKER MUST EXPLAIN ITSELF. A `text`/`form` catalogue supports no order models at all, and a
     form offering nothing with no reason reads as broken rather than as correct. Say which setting caused it
     and where to change it — the alternative is the owner concluding the feature is missing. */
  if (kind === 'ordermodel' && !subs.length) {
    var meth = (typeof UI !== 'undefined' && UI.catf && UI.catf.method) || 'this';
    toast('A ' + meth + ' catalogue does not sell quantities, so it has no order models. Change the selling method in Catalogue setup first.');
    return;
  }
  CBDEF_FORM = { kind: kind, sub: subs[0] || '', name: '', note: '', rules: {}, id: null };
  cbDefPaintForm();
}
async function cbDefEdit(id) {
  /* ⚠️⚠️ EDIT DID NOTHING FROM CATALOGUE SETUP. Athi, 2026-09-03: *"i created one, couldn't edit."* This looked the
     definition up in CBDEF.mine — the Definitions screen's OWN list, loaded only when THAT screen opens. From
     Catalogue setup › Offers the capability is loaded but the list is not, so the lookup missed and the function
     returned without a word. New worked because it needs no lookup. Load first, and say so if it is still missing. */
  /* ⚠️⚠️ ALWAYS FRESH, NEVER THE CACHED COPY. The form saves the WHOLE rules object, so a stale copy is not a stale
     screen — it is a write that erases whatever changed since the list was read. [OFF-02] EXCLUSIVE: products were
     attached on the product page (rules.applies_to.item_ids), then Edit here ticked Exclusive and saved the copy
     loaded before the attach — the offer silently left the product. One read per edit is the price of not doing
     that. */
  await cbDefLoad(true);
  var d = (CBDEF.mine || []).filter(function (x) {
    return x.definition_id === id;
  })[0];
  if (!d) {
    if (typeof toast === 'function') toast(tx('Could not find that definition — reload and try again.'), true);
    return;
  }
  CBDEF_FORM = {
    kind: d.kind,
    sub: d.sub_kind || '',
    name: d.name || '',
    note: d.note || '',
    rules: JSON.parse(JSON.stringify(d.rules || {})),
    id: id,
    version: d.current_version
  };
  cbDefPaintForm();
}
function cbDefSetSub(v) {
  CBDEF_FORM.sub = v;
  cbDefPaintForm();
}
function cbDefSetField(k, v) {
  CBDEF_FORM[k] = v;
}
/**
 * ⚠️ DOTTED KEYS WRITE NESTED, so a field can address `applies_to.category` without this form growing a
 * translation layer between what it shows and what it stores. The alternative — a flat `applies_to_category` key
 * remapped at save time — puts the offer's real shape in two places, and the engine only ever reads one of them.
 * Clearing the last key of a branch removes the empty parent too: `applies_to:{}` is not the same as no
 * `applies_to`, and offers.js treats a present-but-empty scope as a filter that matches nothing.
 */
/* ⚠️ "18%" IS A NUMBER TO A TRADER AND NaN TO Number(). A slab typed as "18%" (or "1,000") saved rules.rate as null
   — silently: the definition existed, the select offered it, and the product pane said "No rate to show" (Athi,
   2026-09-04). Read the digits a person meant; if there are none, store nothing rather than NaN. */
function cbDefNum(v) {
  var s = String(v == null ? '' : v).replace(/[%,\s₹$]/g, '');
  if (s === '') return null;
  var n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function cbDefSetRule(k, v, num) {
  var R = CBDEF_FORM.rules,
    parts = String(k).split('.');
  if (num) {
    var nv = cbDefNum(v);
    v = nv === null ? '' : nv;
  }
  if (parts.length === 1) {
    if (v === '' || v == null) delete R[k];
    else R[k] = v;
    return;
  }
  var head = parts[0],
    tail = parts.slice(1).join('.');
  if (v === '' || v == null) {
    if (R[head]) {
      delete R[head][tail];
      if (!Object.keys(R[head]).length) delete R[head];
    }
    return;
  }
  if (!R[head] || typeof R[head] !== 'object') R[head] = {};
  R[head][tail] = v;
}
function cbDefGetRule(k) {
  var R = CBDEF_FORM.rules,
    parts = String(k).split('.');
  if (parts.length === 1) return R[k];
  var head = R[parts[0]];
  return head && typeof head === 'object' ? head[parts.slice(1).join('.')] : undefined;
}

/**
 * ⭐ A PICKER FIELD — currently only categories, which is what makes "10% off Grains" expressible at all.
 *
 * ⚠️ IT STORES THE definition_id, NOT THE NAME. An offer that said `applies_to.category = "Grains"` would stop
 * matching the moment the category was renamed — and renaming is the one thing categories are designed to make
 * safe. Same rule as a product's membership.
 *
 * ⚠️ IF THE SHELF IS EMPTY THE FIELD SAYS SO rather than rendering an empty select. A dropdown with one blank
 * option reads as "this offer cannot be targeted", when the truth is "you have no categories yet".
 */
function cbDefPickHTML(x, v) {
  /**
   * ⚠️ THIS USED TO BE CATEGORIES AND NOTHING ELSE. A second kind of pick arrived (the reward product), and the
   * honest fix is a branch here rather than a second picker beside it — two selectors that both mean "choose
   * from your catalogue" would drift the day one learns to search and the other does not.
   */
  if (x.pick === 'product') return cbDefPickProductHTML(x, v);
  if (x.pick === 'customer') return cbDefPickCustomerHTML(x, v);
  /**
   * ⭐ A FIXED LIST OF ANSWERS, written on the field itself as [value, what it means]. The first kinds of pick
   * all read something from the shop; this one is a plain choice between two meanings ("off the line once" vs
   * "off each item"), and inventing a lookup for it would be a third picker that means nothing.
   * ⚠️ The FIRST pair is the default, and it is preselected when the rule has no value — so a form that has
   * never been touched shows the behaviour the engine will actually use.
   */
  if (Array.isArray(x.pick)) {
    var cur = v === undefined || v === null || v === '' ? String(x.pick[0][0]) : String(v);
    return (
      '<select data-cbsid="SCR003-S01" class="inp" data-testid="cbdef-pick-' +
      esc(x.k) +
      '"' +
      ' onchange="cbDefSetRule(\'' +
      x.k +
      '\',this.value)">' +
      x.pick
        .map(function (item) {
          return '<option value="' + esc(item[0]) + '"' + (cur === String(item[0]) ? ' selected' : '') + '>' + esc(item[1]) + '</option>';
        })
        .join('') +
      '</select>'
    );
  }
  var list = typeof _CATG !== 'undefined' && _CATG ? _CATG : null;
  if (list === null) {
    if (typeof cbCatgLive === 'function')
      cbCatgLive().then(function () {
        if (CBDEF_FORM) cbDefPaintForm();
      });
    return '<div class="cbdef-hint">reading your categories…</div>';
  }
  if (!list.length) {
    return (
      '<div class="cbdef-hint">No categories yet, so this offer applies to <b>everything</b>. ' +
      'Make one under <b>' +
      tx('Categories') +
      '</b> to target it.</div>'
    );
  }
  return (
    '<select data-cbsid="SCR003-S02" class="inp" data-testid="cbdef-pick-' +
    esc(x.k) +
    '"' +
    ' onchange="cbDefSetRule(\'' +
    x.k +
    '\',this.value)">' +
    '<option value="">— everything —</option>' +
    list
      .map(function (item) {
        return '<option value="' + esc(item.id) + '"' + (String(v) === String(item.id) ? ' selected' : '') + '>' + esc(item.name) + '</option>';
      })
      .join('') +
    '</select>'
  );
}
/**
 * The reward picker. ⚠️ It stores the product's NAME beside its id.
 *
 * ⭐⭐ THE TRAVELLING COPY IS DELIBERATE, and it is the same pattern a product already uses for its categories
 * (`category_names` beside `categories`). The badge on a storefront row has to say "Buy 3 get 1 Sunflower Oil
 * free" to a reader who cannot resolve our product ids — an anonymous shopper, a B2B buyer on another entity,
 * a network peer. Without the name the promise reads "Buy 3 get 1 free", which beside a bag of rice means a
 * fourth bag of rice: a different offer from the one that was authored.
 *
 * ⚠️ The id stays authoritative. A rename in the catalogue leaves the copy stale, which is the accepted cost of
 * the pattern — the same trade the category names already make — and re-picking refreshes it.
 */
var _CBDEF_PRODS, _CBDEF_PRODS_P;
function cbDefProdsLive() {
  if (_CBDEF_PRODS !== undefined && _CBDEF_PRODS !== null) return Promise.resolve(_CBDEF_PRODS);
  if (_CBDEF_PRODS_P) return _CBDEF_PRODS_P; /* the same one-read rule as the customers (see cbDefCustsLive) */
  _CBDEF_PRODS = null;
  _CBDEF_PRODS_P = api('prodList')
    .then(function (reply) {
      var arr = Array.isArray(reply) ? reply : (reply && (reply.items || reply.products)) || [];
      _CBDEF_PRODS = arr
        .map(function (item) {
          var d = item.item_data || item;
          return { id: item.item_id || item.id, name: d.name || d.particulars || 'item' };
        })
        .filter(function (item) {
          return item.id;
        });
      return _CBDEF_PRODS;
    })
    .catch(function () {
      _CBDEF_PRODS = [];
      return _CBDEF_PRODS;
    });
  return _CBDEF_PRODS_P;
}

function cbDefPickProductHTML(x, v) {
  if (_CBDEF_PRODS === undefined)
    cbDefProdsLive().then(function () {
      if (CBDEF_FORM) cbDefPaintForm();
    });
  if (_CBDEF_PRODS === undefined || _CBDEF_PRODS === null) return '<div class="cbdef-hint">reading your catalogue…</div>';
  if (!_CBDEF_PRODS.length) {
    return '<div class="cbdef-hint">Your catalogue is empty, so there is nothing to give away yet.</div>';
  }
  return (
    '<select data-cbsid="SCR003-S03" class="inp" data-testid="cbdef-pick-' +
    esc(x.k) +
    '"' +
    ' onchange="cbDefSetReward(this.value)">' +
    '<option value="">— one of the qualifying items —</option>' +
    _CBDEF_PRODS
      .map(function (item) {
        return '<option value="' + esc(item.id) + '"' + (String(v) === String(item.id) ? ' selected' : '') + '>' + esc(item.name) + '</option>';
      })
      .join('') +
    '</select>' +
    /* ⚠️ ONE LINE. This was three sentences of engine reasoning; the outcome strip below now SHOWS the same
       thing ("earned 1 × Sunflower Oil free — added to your order"), so the paragraph was explaining a
       demonstration. The rule it protects lives in offers.js, where it belongs. */
    '<div class="cbdef-hint">' +
    tx('If it is not in their order, the basket offers to add it.') +
    '</div>'
  );
}

/** the bench's "as a … customer" box — only when the offer is scoped to a group or a customer */
function cbDefTestAsHTML() {
  var f = CBDEF_FORM,
    r = (f && f.rules) || {};
  if (!r.customer_group) return '';
  var who = r.customer_name || String(r.customer_group).replace(/^customer:/, '');
  return (
    '<label style="display:flex;align-items:center;gap:6px;margin-top:6px;font-size:var(--fs-2)"><input data-cbsid="SCR003-I01" type="checkbox" data-testid="cbdef-test-as"' +
    (CBDEF_TEST.asCustomer !== false ? ' checked' : '') +
    ' onchange="CBDEF_TEST.asCustomer=this.checked;cbDefTestRun()"> ' +
    tx('test as') +
    ' <b>' +
    esc(who) +
    '</b> <span style="color:var(--grey)">— ' +
    tx('untick to see what everyone else gets') +
    '</span></label>'
  );
}

/* ── "Only for": the Customers list's own groups, then each customer by name (value 'customer:<identity_id>') ── */
var _CBDEF_CUSTS,
  _CBDEF_CUSTS_P,
  _CBDEF_GNAMES = []; /* _CBDEF_GNAMES: the seller's NAMED groups (decision 2) */
var CBDEF_GROUPS = [
  ['new', 'New customers'],
  ['regular', 'Regular (3+ orders)'],
  ['high_value', 'High value'],
  ['inactive', 'Inactive (90 days)']
];
/* ⚠️ ONE READ, ONE REPAINT. The first version resolved immediately with null while the read was in flight, the picker repainted on
   that, the repaint asked again… an endless microtask loop that froze the offer form ([OFF-01]/[OFF-02] red, run 27). The in-flight
   promise is kept and handed back; the picker schedules a repaint only on the very first ask. */
function cbDefCustsLive() {
  if (_CBDEF_CUSTS !== undefined && _CBDEF_CUSTS !== null) return Promise.resolve(_CBDEF_CUSTS);
  if (_CBDEF_CUSTS_P) return _CBDEF_CUSTS_P;
  _CBDEF_CUSTS = null;
  _CBDEF_CUSTS_P = Promise.all([
    api('custList'),
    api('custGroupNames').catch(function () {
      return { names: [] };
    })
  ])
    .then(function (reply) {
      var r = reply[0];
      _CBDEF_GNAMES = (reply[1] && reply[1].names) || [];
      _CBDEF_CUSTS = ((r && r.customers) || []).map(function (item) {
        return { id: item.customer_identity_id, name: item.display_name || item.user_id || item.bridge_id || 'customer', segment: item.segment };
      });
      return _CBDEF_CUSTS;
    })
    .catch(function () {
      _CBDEF_CUSTS = [];
      return _CBDEF_CUSTS;
    });
  return _CBDEF_CUSTS_P;
}
function cbDefPickCustomerHTML(x, v) {
  if (_CBDEF_CUSTS === undefined)
    cbDefCustsLive().then(function () {
      if (CBDEF_FORM) cbDefPaintForm();
    });
  if (_CBDEF_CUSTS === undefined || _CBDEF_CUSTS === null) return '<div class="cbdef-hint">' + tx('reading your customers…') + '</div>';
  var cur = String(v || '');
  return (
    '<select data-cbsid="SCR003-S04" class="inp" data-testid="cbdef-pick-' +
    esc(x.k) +
    '" onchange="cbDefSetCustomer(this.value)">' +
    '<option value="">' +
    tx('— everyone —') +
    '</option>' +
    '<optgroup label="' +
    tx('A group of customers') +
    '">' +
    CBDEF_GROUPS.map(function (item) {
      return '<option value="' + item[0] + '"' + (cur === item[0] ? ' selected' : '') + '>' + tx(item[1]) + '</option>';
    }).join('') +
    '</optgroup>' +
    (_CBDEF_GNAMES.length
      ? '<optgroup label="' +
        tx('Your named groups') +
        '">' +
        _CBDEF_GNAMES
          .map(function (item) {
            var val = 'group:' + item;
            return '<option value="' + esc(val) + '"' + (cur === val ? ' selected' : '') + '>' + esc(item) + '</option>';
          })
          .join('') +
        '</optgroup>'
      : '') +
    (_CBDEF_CUSTS.length
      ? '<optgroup label="' +
        tx('One customer') +
        '">' +
        _CBDEF_CUSTS
          .map(function (item) {
            var val = 'customer:' + item.id;
            return '<option value="' + esc(val) + '"' + (cur === val ? ' selected' : '') + '>' + esc(item.name) + '</option>';
          })
          .join('') +
        '</optgroup>'
      : '') +
    '</select>' +
    '<div class="cbdef-hint">' +
    tx('Never on the public storefront. Reaches them on Suppliers, in the cart and on the order.') +
    '</div>'
  );
}
/** the value AND its name travel together, like the reward's — the badge and the order must say "only for Chola Auto Care", not an id */
function cbDefSetCustomer(val) {
  var name = '';
  if (val) {
    var g = CBDEF_GROUPS.filter(function (x) {
      return x[0] === val;
    })[0];
    if (g) name = g[1];
    else if (/^group:/.test(val)) name = val.slice(6);
    else {
      var c = (_CBDEF_CUSTS || []).filter(function (item) {
        return 'customer:' + item.id === val;
      })[0];
      name = c ? c.name : '';
    }
  }
  cbDefSetRule('customer_group', val || '');
  cbDefSetRule('customer_name', name);
}

/** Sets the id AND the name in one act, so the two can never be written apart. */
function cbDefSetReward(id) {
  var p = (_CBDEF_PRODS || []).filter(function (item) {
    return String(item.id) === String(id);
  })[0];
  cbDefSetRule('get_item_id', id || '');
  cbDefSetRule('get_item_name', p ? p.name : '');
}

/**
 * The human name of a sub-kind, READ FROM THE SAME PLACE THE REGISTRY READS IT — cbDefOfferLabel for offers,
 * CBCart.models for order models.
 *
 * ⚠️ THE PICKER USED TO SHOW THE RAW KEY. "percent_off", "buy_x_get_y", "tier_price" in a dropdown, on a form
 * headed "KIND", above a field headed "PERCENT OFF" — the screen was reading its own source code out loud. The
 * labels already existed one function away and were already published on the Registries screen.
 */
function cbDefSubLabel(kind, sub) {
  if (kind === 'offer') return cbDefOfferLabel(sub);
  if (kind === 'pricing') return cbDefPricingLabel(sub);
  if (kind === 'ordermodel' && typeof CBCart !== 'undefined' && CBCart.models && CBCart.models[sub]) return CBCart.models[sub].label || sub;
  return sub;
}
/* A label like "Quantity tier — a RE-PRICE, not a discount" is two things: the NAME, and the warning that goes
   under it. The picker gets the name; the line beneath gets the rest, where it can be read rather than truncated. */
function cbDefSubHead(kind, sub) {
  return String(cbDefSubLabel(kind, sub)).split(' — ')[0];
}
function cbDefSubTail(kind, sub) {
  var text = String(cbDefSubLabel(kind, sub)).split(' — ');
  return text.length > 1 ? text.slice(1).join(' — ') : '';
}

/**
 * ⭐⭐ PRICE BREAKS AS TEXT — "10 = 170" per line, because a tier table is a LIST and a list of paired numbers
 * has no honest single-input form. Written back through the same two functions so the box always shows what was
 * stored, never a re-typing of it.
 *
 * ⚠️ A LINE THAT IS NOT A PAIR IS DROPPED, not guessed at. A half-typed "10 =" must not become a price of zero:
 * the tier table sets the price of record, and a zero in it is a free product nobody agreed to.
 */
function cbDefTiersText(v) {
  return (Array.isArray(v) ? v : [])
    .map(function (item) {
      return (item && item.qty != null ? item.qty : '') + ' = ' + (item && item.price != null ? item.price : '');
    })
    .join('\n');
}
function cbDefSetTiers(text) {
  var rows = String(text || '')
    .split('\n')
    .map(function (item) {
      var m = /^\s*([0-9.]+)\s*[=:x×]\s*([0-9.]+)\s*$/.exec(item);
      return m ? { qty: Number(m[1]), price: Number(m[2]) } : null;
    })
    .filter(Boolean)
    .sort(function (first, second) {
      return first.qty - second.qty;
    });
  cbDefSetRule('tiers', rows.length ? rows : '');
  cbDefPaintPreview();
}
/* ⚠️ FALSE IS ABSENT, not `exclusive:false`. offers.js treats a missing condition as "no restriction", and a
   stored false is one more key every reader has to know means the same thing as nothing. */
function cbDefSetCheck(k, on) {
  cbDefSetRule(k, on ? true : '');
  cbDefPaintPreview();
}

/** the "Note to yourself" box: one text field (CMP055, mount SCR003-U01) that writes the offer's note; the hint says who sees it */
function cbDefNoteFieldHTML(form) {
  var hint =
    form.kind === 'tax'
      ? tx('On your tax slabs list. Buyers never see it.')
      : form.kind === 'pricing'
        ? tx('On your pricing list. Buyers never see it.')
        : tx('On your offers list. Buyers never see it.');
  return ui.field({
    mount: 'SCR003-U01',
    kind: 'text',
    id: 'cbdef-note',
    label: 'Note to yourself',
    placeholder: tx('optional'),
    hint: hint,
    value: form.note || '',
    onInput: function (value) {
      cbDefSetField('note', value);
    }
  });
}

/** ONE field, whatever its shape. Every branch keeps the `cbdef-rule-<key>` test id a spec drives. */
function cbDefFieldHTML(x, v) {
  var id = 'cbdef-rule-' + esc(String(x.k).replace(/\./g, '-'));
  var set = function (expr) {
    return ' oninput="cbDefSetRule(\'' + x.k + "'," + expr + ');cbDefPaintPreview()"';
  };
  if (x.check) {
    return (
      '<label class="cbdef-check"><input data-cbsid="SCR003-I02" type="checkbox" data-testid="' +
      id +
      '"' +
      (v ? ' checked' : '') +
      ' onchange="cbDefSetCheck(\'' +
      x.k +
      '\',this.checked)"><span>' +
      esc(x.label) +
      '</span></label>'
    );
  }
  if (x.sel) {
    return (
      '<select data-cbsid="SCR003-S05" class="inp" data-testid="' +
      id +
      '" onchange="cbDefSetRule(\'' +
      x.k +
      '\',this.value);cbDefPaintPreview()">' +
      x.sel
        .map(function (item) {
          return '<option value="' + esc(item.v) + '"' + (String(v) === String(item.v) ? ' selected' : '') + '>' + esc(tx(item.label)) + '</option>';
        })
        .join('') +
      '</select>'
    );
  }
  if (x.tiers) {
    return (
      '<textarea data-cbsid="SCR003-T01" class="inp" rows="3" data-testid="' +
      id +
      '" placeholder="' +
      esc(x.ph || '') +
      '"' +
      ' oninput="cbDefSetTiers(this.value)">' +
      esc(cbDefTiersText(v)) +
      '</textarea>'
    );
  }
  if (x.area) {
    return (
      '<textarea data-cbsid="SCR003-T02" class="inp" rows="4" data-testid="' +
      id +
      '" placeholder="' +
      esc(x.ph || '') +
      '"' +
      set("this.value.split('\\n').filter(Boolean)") +
      '>' +
      esc(Array.isArray(v) ? v.join('\n') : v) +
      '</textarea>'
    );
  }
  /* ⚠️ A REAL DATE CONTROL. valid_from/valid_to were text boxes captioned "YYYY-MM-DD" — a format instruction is
     what you write when the field cannot check itself, and offers.js compares these as dates. */
  var type = x.date ? ' type="date"' : x.num ? ' inputmode="decimal"' : '';
  var val = x.date ? String(v || '').slice(0, 10) : v;
  var box =
    '<input data-cbsid="SCR003-I03" class="inp"' +
    type +
    ' data-testid="' +
    id +
    '" value="' +
    esc(val) +
    '"' +
    ' placeholder="' +
    esc(x.ph || '') +
    '"' +
    set('this.value,' + (x.num ? 'true' : 'false')) +
    '>';
  /* ⭐ MONEY SAYS ITS CURRENCY, A RATE SAYS % (Athi, 2026-09-06 10:35: "in front of amount put a currency symbol") — a bare box is a number, not money */
  if (x.money) {
    var sym = typeof CBLocale !== 'undefined' && CBLocale.symbol ? (moneyCode() ? CBLocale.symbol(moneyCode()) : '') : '₹';
    return '<span class="cbdef-adorn"><b>' + esc(sym) + '</b>' + box + '</span>';
  }
  if (x.pct) return '<span class="cbdef-adorn cbdef-adorn-after">' + box + '<b>%</b></span>';
  return box;
}

function cbDefFormHTML() {
  var f = CBDEF_FORM;
  if (!f) return '';
  var A = CBDEF_AUTHORABLE[f.kind] || {};
  var subs = cbDefSubKinds(f.kind);
  var fields = cbDefRuleFields(f.kind, f.sub);
  var editing = !!f.id;
  var tail = subs.length ? cbDefSubTail(f.kind, f.sub) : '';

  /**
   * ⚠️⚠️ .mhd / .mbody / .mfoot — THE APP'S OWN MODAL FRAME, WHICH THIS FORM WAS NOT USING.
   *
   * Athi, 2026-09-03: *"there is no space between text box and the border"*. modal() drops the html straight
   * into `.modal`, which has `overflow:hidden` and NO padding of its own — the padding lives on `.mhd`,
   * `.mbody` and `.mfoot` (13px 16px / 12px 16px), and a form that supplies none of the three renders edge to
   * edge. Every other dialog in the app uses these three; this one hand-rolled a header and a footer and got
   * neither the padding nor the scrolling body nor the equal-width buttons. Adopting them also fixes the
   * rhythm, because `label.fl` already carries the product form's 12px/5px spacing and my grid was overriding
   * it tighter.
   */
  return (
    '<div class="mhd cbdef-formhd"><div class="t">' +
    esc((editing ? tx('Edit') : tx('New')) + ' ' + (A.one || f.kind)) +
    '</div>' +
    /**
     * ⭐ THE FREEZE RULE IS SAID ON THE EDIT FORM, WHERE IT MATTERS. Someone changing "Carton of 6" to 12 needs
     * to know, at that moment, that chits already stamped keep the 6 — otherwise the safe behaviour reads as a
     * bug ("I changed it and the old order still says 6") and someone 'fixes' it.
     *
     * ⚠️ ONE LINE, NOT A PARAGRAPH. It was three sentences at the top of the form, which is where a reader
     * stops reading; the rule is the same and it now sits beside the version it is talking about.
     */
    (editing
      ? '<span class="cbdef-vpill" title="' +
        esc(tx('Saving the rules makes a new version. Chits already stamped keep the one they froze.')) +
        '">v' +
        esc(f.version || 1) +
        ' · ' +
        tx('saving makes v') +
        (Number(f.version || 1) + 1) +
        '</span>'
      : '') +
    '</div>' +
    '<div class="mbody cbdef-body" data-mv-fit>' +
    '<div class="cbdef-grid">' +
    (subs.length
      ? '<label class="fl cbdef-w2">' +
        tx('Kind') +
        '</label>' +
        '<select data-cbsid="SCR003-S06" class="inp cbdef-w2" data-testid="cbdef-sub" onchange="cbDefSetSub(this.value)">' +
        subs
          .map(function (item) {
            return '<option value="' + esc(item) + '"' + (item === f.sub ? ' selected' : '') + '>' + esc(cbDefSubHead(f.kind, item)) + '</option>';
          })
          .join('') +
        '</select>' +
        /* ⚠️ THE KEY IS STILL SHOWN, small. It is what the rules are stored under and what a spec drives; a
             screen that hides its own identifiers costs the next person an hour finding them. */
        '<div class="cbdef-hint cbdef-w2"><code>' +
        esc(f.sub) +
        '</code>' +
        (tail ? ' · ' + esc(tail) : '') +
        '</div>'
      : '') +
    '<label class="fl cbdef-w2">' +
    tx('Name') +
    '</label>' +
    '<div class="cbdef-f cbdef-w2">' +
    '<input data-cbsid="SCR003-I04" class="inp" data-testid="cbdef-name" value="' +
    esc(f.name) +
    '"' +
    /* ⚠️ Per KIND. The fallthrough used to hand `requirement` the category placeholder — a form headed "New
       requirement" asking for a name and suggesting "Spices". A placeholder is an instruction; a wrong one
       teaches the wrong thing. */
    ' placeholder="' +
    (f.kind === 'ordermodel'
      ? 'Carton of 6'
      : f.kind === 'offer'
        ? 'Diwali 10%'
        : f.kind === 'requirement'
          ? 'Minimum for food suppliers'
          : /* ⚠️ The NAME is what a product cites and what a chit freezes, so it must read as a rate
                           to someone who never opens this form. "GST 18%", not "standard". */
            f.kind === 'tax'
            ? 'GST 18%'
            : 'Spices') +
    '"' +
    ' oninput="cbDefSetField(\'name\',this.value)">' +
    /* ⚠️ THE NAME IS NOT PRIVATE. defToOffer carries it as the offer's `label`, and every adjustment the engine
       makes prints it — in the cart breakdown and again on the chit line's `offer.label`. Say so, because the
       Note beneath it is the opposite and the two look identical. */
    (f.kind === 'offer' ? '<div class="cbdef-hint">' + tx('Buyers see this in the cart and on the chit.') + '</div>' : '') +
    '</div>' +
    /**
     * ⚠️ TWO COLUMNS, AND THE PAIRING IS THE POINT. Percent beside Applies to, Valid from beside Valid to,
     * Region beside Runs at — each pair is one question. Full-width stacking made eight short fields read as
     * eight unrelated demands and pushed everything below the fold, which is where the outcome strip lives.
     */
    fields
      .map(function (x) {
        var v = cbDefGetRule(x.k);
        v = v == null ? '' : v;
        var w = x.half ? '' : ' cbdef-w2';
        return (
          (x.check ? '' : '<label class="fl' + w + '">' + esc(x.label) + '</label>') +
          '<div class="cbdef-f' +
          w +
          '">' +
          (x.pick ? cbDefPickHTML(x, v) : cbDefFieldHTML(x, v)) +
          (x.hint ? '<div class="cbdef-hint">' + esc(tx(x.hint)) + '</div>' : '') +
          '</div>'
        );
      })
      .join('') +
    (f.kind === 'requirement' ? '<div class="cbdef-w2">' + cbDefStdChipsHTML() + '</div>' : '') +
    /**
     * ⚠️⚠️ "NOTE — WHERE WILL IT REFLECT?" (Athi, 2026-09-03). Nowhere, was the answer. It was saved on every
     * definition and read back by exactly one thing: this form. Neither the Catalogue setup row nor the
     * Definitions row rendered it, so a note written here vanished the moment the modal closed.
     *
     * ⭐ MADE TRUE RATHER THAN DELETED. Dropping the field would strand every note already written — still in
     * the record, invisible and uneditable — so both lists print it under the offer's name, and the label now
     * says exactly who sees it. A field whose audience is not stated is a field somebody will type a price into.
     */
    '<div class="cbdef-f cbdef-w2">' +
    cbDefNoteFieldHTML(f) +
    '</div>' +
    '<div id="cbdef_prev">' +
    cbDefPreviewHTML() +
    '</div>' +
    (f.kind === 'offer' ? cbDefTestHTML(f) : '') +
    '<div class="err" id="cbdef_err"></div>' +
    '</div>' +
    '<div class="mfoot">' +
    '<button data-cbsid="CMP003" onclick="closeModal()">' +
    tx('Cancel') +
    '</button>' +
    '<button data-cbsid="CMP001" class="pri" data-testid="cbdef-save" onclick="cbDefSave()">' +
    (editing ? tx('Save') : tx('Create')) +
    '</button>' +
    '</div>'
  );
}
/**
 * ⭐ THE STANDARDS A BUYER CAN REQUIRE — read from the system, never typed.
 *
 * ⚠️ SOURCED FROM YOUR OWN readiness call, and that is not a workaround. `/api/governance/readiness` with no
 * vertical returns THE FLOOR — every active standard, with titles. That unscoped list is the exact complaint
 * behind backlog 7 when it is used to judge a supplier, and it is exactly the right thing to use as a MENU: the
 * full vocabulary is what you want to choose from, and precisely not what you want to be measured against.
 *
 * Cached, and failure is silent: the textarea still works, you just have to know the keys.
 */
var _CBDEF_STDS = null,
  _cbdefStdReq = null;
function cbDefStdsLoad() {
  if (_CBDEF_STDS) return Promise.resolve(_CBDEF_STDS);
  if (_cbdefStdReq) return _cbdefStdReq;
  /* ⚠️ ensureCap FIRST. `readinessOwn` is registered by cap-readiness.js, which is LAZY — calling api() without
     it throws "no endpoint readinessOwn". Registering a second copy of the alias here would satisfy the call and
     break the guard's one-global-one-owner rule, which is the wrong trade. */
  _cbdefStdReq = ensureCap('readiness')
    .then(function () {
      return api('readinessOwn');
    })
    .then(function (reply) {
      var seen = {},
        out = [];
      ((reply && reply.clearances) || []).forEach(function (item) {
        if (!item.standard || seen[item.standard]) return;
        seen[item.standard] = 1;
        out.push({ key: item.standard, title: item.title || item.standard });
      });
      out.sort(function (first, second) {
        return first.key.localeCompare(second.key);
      });
      _CBDEF_STDS = out;
      _cbdefStdReq = null;
      return out;
    })
    .catch(function () {
      _cbdefStdReq = null;
      return (_CBDEF_STDS = []);
    });
  return _cbdefStdReq;
}
function cbDefStdChipsHTML() {
  var f = CBDEF_FORM;
  if (!f || f.kind !== 'requirement') return '';
  var list = _CBDEF_STDS;
  if (list === null) return '<div class="cbdef-stdhint">' + tx('Reading the standards list…') + '</div>';
  if (!list.length) return '<div class="cbdef-stdhint">Could not read the standards list — type the keys directly, ' + 'one per line.</div>';
  var chosen = {};
  (f.rules.standards || []).forEach(function (item) {
    chosen[String(item).trim()] = 1;
  });
  return (
    '<div class="cbdef-stdhint">Tap to add or remove. ' +
    list.length +
    ' available.</div>' +
    '<div class="cbdef-stds">' +
    list
      .map(function (item) {
        var on = !!chosen[item.key];
        return (
          '<button data-cbsid="SCR003-B01" type="button" class="cbdef-stdchip' +
          (on ? ' on' : '') +
          '"' +
          ' title="' +
          esc(item.title) +
          '"' +
          ' onclick="cbDefToggleStd(\'' +
          esc(item.key) +
          '\')">' +
          (on ? '✓ ' : '') +
          esc(item.key) +
          '</button>'
        );
      })
      .join('') +
    '</div>'
  );
}
function cbDefToggleStd(key) {
  var f = CBDEF_FORM;
  if (!f) return;
  var list = (f.rules.standards || [])
    .map(function (item) {
      return String(item).trim();
    })
    .filter(Boolean);
  var i = list.indexOf(key);
  if (i >= 0) list.splice(i, 1);
  else list.push(key);
  f.rules.standards = list;
  cbDefPaintForm();
}
/**
 * ── ⭐⭐ WHAT A BUYER SEES, WHILE THE OFFER IS BEING WRITTEN ────────────────────────────────────────────────────
 *
 * Athi, 2026-09-03: *"each screen should showcase the outcome"*.
 *
 * ⚠️⚠️ NOTHING ON THIS FORM EVER SAID WHAT IT WOULD DO. An author filled in "percent 10", saved, made it live,
 * attached it to a product, opened a cart — and only then found out whether the rules they wrote produce the
 * offer they meant. Every mismatch in the commit before this one (a threshold advertising nothing, a shipping
 * offer moving no money, a tier with no tiers) survived precisely because the authoring screen was silent.
 *
 * ⭐ IT IS THE SAME ENGINE, NOT A DESCRIPTION OF IT. CBOffers.promise() for the badge and CBOffers.evaluate()
 * for the money — the two functions the row and the basket call. A preview computed any other way is a fourth
 * opinion about the price, and the one that is wrong is always the one nobody runs.
 */
var CBDEF_SAMPLE = 1000;
function cbDefPreviewHTML() {
  var f = CBDEF_FORM;
  if (!f || f.kind !== 'offer' || typeof CBOffers === 'undefined') return '';
  /* T2-WEBPRIMS: amounts through the shop's one formatter (inr = fmtMoney · myCur), never `symbol + n` — the engines take it as their ctx.money */
  var o = Object.assign({ id: 'preview', kind: f.sub, label: f.name || tx('This offer') }, f.rules);
  var cat = (f.rules.applies_to || {}).category || null;
  var qty2 = CBOffers.sampleQty([o], CBDEF_SAMPLE);
  var promise = null;
  /* ⭐ PREVIEWED AS THE CUSTOMER IT IS FOR (Athi, 2026-09-06 19:27: "the offer computation not works properly during test?") — a customer-only offer fails closed for a stranger, so the seller's own preview must stand in that customer's shoes */
  try {
    promise = CBOffers.promise(o, { now: new Date(), money: inr, customer_groups: o.customer_group ? [o.customer_group] : [] });
  } catch (e) { /* best effort: failing here changes nothing the user sees */ }
  var one = cbDefPreviewRow(o, 1, cat, money),
    many = cbDefPreviewRow(o, qty2, cat, money);
  /* ⚠️ The window is the FIRST thing said when it is closed, because every row under it would otherwise show a
     discount the basket will refuse. within() is what returns this, through evaluate's `skipped`. */
  var gate = one.skipped && /^(not started|expired|other )/.test(one.skipped) ? one.skipped : '';

  return (
    '<div class="cbdef-prev" data-testid="cbdef-preview">' +
    '<div class="cbdef-prevhd">' +
    tx('What a buyer sees') +
    '</div>' +
    (gate
      ? '<div class="cbdef-prevgate" data-testid="cbdef-preview-gate">' + esc(gate) + '</div>'
      : '<div class="cbdef-prevbadge" data-testid="cbdef-preview-badge">' +
        (promise
          ? esc(promise)
          : /* ⚠️ "INCOMPLETE" WOULD BE A LIE FOR TWO KINDS. Shipping and price_range return null from promise()
                BY DESIGN — one line cannot promise an order-level delivery term, and a band is the price rather
                than a discount off one. Telling their author to finish a finished offer is worse than silence. */
            '<span class="off">' +
            (one.moved || many.moved ? tx('no badge on a product row — this applies in the basket') : tx('no badge yet — the terms are incomplete')) +
            '</span>') +
        '</div>') +
    [one, many]
      .map(function (item) {
        return (
          '<div class="cbdef-prevrow"><span class="q">' +
          item.qty +
          ' × ' +
          esc(inr(CBDEF_SAMPLE)) +
          '</span>' +
          '<span class="m">' +
          esc(inr(item.was)) +
          ' → <b>' +
          esc(inr(item.now)) +
          '</b></span>' +
          '<span class="w">' +
          esc(item.why) +
          '</span></div>'
        );
      })
      .join('') +
    '<div class="cbdef-hint">' +
    tx('A sample product at ') +
    esc(inr(CBDEF_SAMPLE)) +
    (cat ? tx(', in the category this offer targets') : '') +
    (f.sub === 'shipping' ? tx(', with ') + esc(inr(200)) + tx(' delivery') : '') +
    '.</div>' +
    '</div>'
  );
}
/** One worked line, run through evaluate() exactly as the cart runs it. */
function cbDefPreviewRow(o, qty, cat, money) {
  var ship = o.kind === 'shipping' ? 200 : 0;
  var out = { qty: qty, was: CBDEF_SAMPLE * qty + ship, now: CBDEF_SAMPLE * qty + ship, why: tx('nothing changes'), skipped: '', moved: false };
  try {
    var ev = CBOffers.evaluate({
      lines: [{ key: '0', item_id: 'sample', categories: cat ? [String(cat)] : [], qty: qty, unitPrice: CBDEF_SAMPLE }],
      offers: [o],
      money: money,
      shipping: ship,
      customer_groups: o.customer_group ? [o.customer_group] : [] /* as the customer it is for */
    });
    out.was = ev.subtotal + ship;
    out.now = ev.total;
    var a = ev.adjustments[0],
      n = ev.notes[0],
      s = ev.skipped[0];
    out.skipped = s ? s.why || '' : '';
    out.moved = !!(a || n);
    out.why = a ? a.why : n ? n.why : s ? s.why : out.why;
  } catch (e) {
    /* an engine failure must not take the form down — the fields still save */
  }
  return out;
}
/**
 * ⚠️⚠️ THE STRIP REPAINTS, THE FORM DOES NOT. Calling cbDefPaintForm() on every keystroke rebuilds the modal,
 * which destroys the input being typed into and puts the caret back at the start — the reason cbDefSetRule has
 * never repainted anything. Only the outcome block is replaced.
 */
function cbDefPaintPreview() {
  var node = document.getElementById('cbdef_prev');
  if (node) node.innerHTML = cbDefPreviewHTML();
}
function cbDefPaintForm() {
  /**
   * ⚠️⚠️ ITS OWN REMEMBERED GEOMETRY. mvModal derives the key from `.mhd .t`, which this form has never had, so
   * every untitled standard modal in the app shared one entry — `cb_mv_std`. Resize any of them once and this
   * form opens at that height forever after, with a band of empty card under the buttons, which is exactly what
   * the screenshot showed. `fit` names the scrolling body so dragging the corner grows the FIELDS.
   */
  modal(cbDefFormHTML(), true, { key: 'cb_mv_def_' + (CBDEF_FORM ? CBDEF_FORM.kind : 'x'), minW: 460, minH: 320, fit: '.cbdef-body' });
  /* Load once, then repaint — the chips cannot render before the list exists, and the form must not wait for it. */
  if (CBDEF_FORM && CBDEF_FORM.kind === 'requirement' && _CBDEF_STDS === null) {
    cbDefStdsLoad().then(function () {
      if (CBDEF_FORM && CBDEF_FORM.kind === 'requirement') cbDefPaintForm();
    });
  }
}

/** the value a kind cannot do without — null when complete, else the sentence to show */
function cbDefMissingValue(kind, sub, r) {
  var n = function (v) {
    var x = Number(v);
    return isFinite(x) ? x : NaN;
  };
  if (kind === 'offer') {
    if (sub === 'percent_off' && !(n(r.percent) > 0)) return 'Percent off is needed — the name is not the rule. Type the percentage (e.g. 10).';
    if (sub === 'amount_off' && !(n(r.amount) > 0)) return 'Amount off is needed — how much comes off.';
    if (sub === 'threshold' && !(n(r.percent) > 0) && !(n(r.amount) > 0) && !r.get_item_id)
      return 'A threshold offer needs a percent, an amount, or a reward item.';
    if (sub === 'tier_price' && !(Array.isArray(r.tiers) && r.tiers.length)) return 'At least one tier (quantity = price) is needed.';
    if (sub === 'buy_x_get_y' && !(n(r.buy) > 0 && n(r.get) > 0)) return 'Buy X get Y needs both numbers.';
    if (sub === 'mix_and_match' && !(n(r.buy) > 0 && n(r.get) > 0)) return 'Mix and match needs both numbers.';
    if (sub === 'bundle_price' && !(n(r.bundle_price) > 0)) return 'A bundle needs its price.';
  }
  if (kind === 'tax' && !(n(r.rate) >= 0)) return 'The rate is needed (0 for a zero-rated slab).';
  if (kind === 'pricing' && sub === 'tiered' && !(Array.isArray(r.tiers) && r.tiers.length)) return 'At least one tier is needed.';
  return null;
}
async function cbDefSave() {
  var f = CBDEF_FORM;
  if (!f) return;
  var err = document.getElementById('cbdef_err');
  if (!f.name || !f.name.trim()) {
    if (err) err.textContent = 'A name is needed — it is how this gets cited.';
    return;
  }
  /* ⚠️ A RULE WITHOUT ITS VALUE IS NOT A RULE (Athi, 2026-09-05: "Flat 10%" saved with the Percent box empty — the name said 10,
     the engine saw nothing, the product page said "After offers ₹200" and he asked "offer not applied?"). What each kind
     needs, checked here before the save and again on the server. */
  var missing = cbDefMissingValue(f.kind, f.sub, f.rules || {});
  if (missing) {
    if (err) err.textContent = missing;
    return;
  }
  try {
    if (f.id) {
      /**
       * ⚠️ THE RULES ARE ALWAYS SENT ON AN EDIT, and the server decides whether that is a new version. Deciding
       * "did the rules change" here would mean the client owns the versioning rule — and two clients would
       * eventually disagree about whether something was a change.
       */
      await api('defSave', { params: { id: f.id }, body: { name: f.name.trim(), note: f.note, rules: f.rules } });
      toast('Saved — a new version if the rules changed.');
    } else {
      await api('defAdd', { body: { kind: f.kind, sub_kind: f.sub || null, name: f.name.trim(), note: f.note, rules: f.rules } });
      toast('Created as a draft.');
    }
    var savedKind = CBDEF_FORM && CBDEF_FORM.kind;
    closeModal();
    CBDEF_FORM = null;
    await cbDefAfterChange(savedKind);
  } catch (e) {
    if (err) err.textContent = (e && e.message) || 'Could not save that.';
  }
}
/**
 * ⭐ ONE PLACE TO REFRESH AFTER A DEFINITION CHANGES — both lists. The Definitions screen keeps CBDEF.mine; Catalogue
 * setup keeps its own per-kind list (CATSET_DEFS). A save or a status change made from Setup used to refresh only the
 * first, so the row a person was looking at kept its old name and status until they left and came back.
 */
async function cbDefAfterChange(kind, id) {
  /* ⚠️⚠️ THE PRODUCT PAGE CACHES THE LIVE OFFERS ONCE PER SESSION (UI._ctOffers, see ctOffersEnsure). Filled while
     an offer was still a draft, it kept saying "None live" after the offer went live — [OFF-01] ATTACH found it:
     author → make live → open the product → nothing to tick, until a reload. Any change to a definition drops it. */
  if (typeof UI !== 'undefined') UI._ctOffers = undefined;
  /* ⚠️⚠️ BOTH CACHES DROP BEFORE ANYTHING IS AWAITED (2026-09-17). The live shelf used to be dropped only after the reload below —
     about three seconds here — and a screen that repainted in between refilled UI._ctOffers from the OLD shelf: [OFF-02] saw an
     offer just made exclusive previewed as not exclusive. The kind comes from the list already in hand when it was not passed. */
  var _pre =
    !kind && id
      ? (CBDEF.mine || []).filter(function (x) {
          return x.definition_id === id;
        })[0]
      : null;
  if (_pre && _pre.kind) kind = _pre.kind;
  if (kind && typeof _DEFS !== 'undefined') delete _DEFS[kind];
  await cbDefLoad(true);
  if (!kind && id) {
    var d = (CBDEF.mine || []).filter(function (x) {
      return x.definition_id === id;
    })[0];
    kind = d && d.kind;
  }
  /* core.js's per-kind live-definition cache (cbDefsLive → _DEFS) feeds the slab pickers and the tax resolver;
     a slab made live here must be offered on the next paint, not after a reload. */
  if (kind && typeof _DEFS !== 'undefined') delete _DEFS[kind];
  /**
   * ⚠️⚠️ AND core.js's LIVE SHELF, which is a THIRD reader — the exact bug UI._ctOffers had, one cache along.
   * `cbDefsLive` caches per kind for the session, so a product's Pricing & tax pane that painted before the first
   * slab existed kept offering nothing until a reload: author a slab → make it live → open the product → the
   * dropdown says "No live slab yet". Works when you test it in the other order, which is the worst kind.
   */
  if (kind && typeof cbDefsLive === 'function') await cbDefsLive(kind, true);
  /* ⚠️ AND AGAIN, NOW THE SHELF IS FRESH. While the reads above were awaited, a repaint refilled UI._ctOffers from the OLD
     shelf (deleted only after cbDefLoad) — [OFF-02] found an offer made exclusive still previewed as not exclusive. */
  if (typeof UI !== 'undefined') UI._ctOffers = undefined;
  if (kind && typeof UI !== 'undefined' && UI.nav === 'catsetup' && typeof catsetDefsLoad === 'function') {
    await catsetDefsLoad(kind, true);
    if (typeof catsetPaintDetail === 'function') catsetPaintDetail();
  }
}

/* ═══ UX-110 · AN OFFER GOES LIVE ONLY AFTER THE CONFIRM ═══════════════════════════════════════════════════════════════════════════
 * The api refuses an offer made live without `confirmed: true` (428 OFFER_LIVE_UNCONFIRMED). This page sends it only after the lab kit's ONE promise
 * sentence (CBLabKit.promise / .confirm, the one the Offer Lab asks) has been shown and accepted. A category, a slab or a draft is never asked. */
var _labKitReq = null;
/** lab-kit.js and its css, loaded once on demand (app.html does not carry them); resolves when CBLabKit is there */
function cbLabKitLoad() {
  if (window.CBLabKit) return Promise.resolve();
  return (_labKitReq =
    _labKitReq ||
    new Promise(function (resolve, reject) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/app/lab-kit.css?v=' + CB_BUILD;
      document.head.appendChild(link);
      var node = document.createElement('script');
      node.src = '/app/lab-kit.js?v=' + CB_BUILD;
      node.onload = resolve;
      node.onerror = function () {
        _labKitReq = null;
        reject(new Error('Could not open the confirm. Nothing was changed.'));
      };
      document.head.appendChild(node);
    }));
}
/** how many items and categories an offer's applies_to names */
function cbOfferNamedCounts(at) {
  return { items: (at.item_ids || []).length + (at.skus || []).length, cats: (at.category_ids || []).length + (at.category ? 1 : 0) };
}
/** what an offer reaches, in words, from its rules; an offer that names no item or category reaches the WHOLE catalogue and says so */
function cbOfferReachWords(rules) {
  var named = cbOfferNamedCounts((rules && rules.applies_to) || {});
  if (named.items) return named.items + (named.items === 1 ? ' item' : ' items');
  if (named.cats) return named.cats === 1 ? 'one category' : named.cats + ' categories';
  return 'the whole catalogue (it names no item or category)';
}
/** asks first with the Offer Lab's sentence, then runs onYes; parts: { name, detail, rules } */
function cbOfferAskLive(parts, onYes) {
  return cbLabKitLoad().then(function () {
    var said = CBLabKit.promise({ act: 'live', thing: 'offer', name: parts.name, detail: parts.detail || '', on: cbOfferReachWords(parts.rules), group: '', margin: '' });
    CBLabKit.confirm(said.title, said.html, onYes, { okLabel: said.ok, danger: said.danger });
  });
}
/** Catalogue setup's own lists (CATSET_DEFS, when that screen is loaded) in the shelf's row shape */
function cbSetupShelf() {
  var lists = typeof CATSET_DEFS === 'undefined' ? {} : CATSET_DEFS;
  return Object.keys(lists).reduce(function (all, kind) {
    return all.concat((lists[kind] || []).map(function (row) { return { definition_id: row.id, kind: kind, name: row.name, rules: row.rules }; }));
  }, []);
}
/** the offer behind a Publish click, from the lists this page keeps (Definitions screen, then Catalogue setup); null when it is not an offer */
function cbOfferNamed(id) {
  var found = (CBDEF.mine || []).concat(cbSetupShelf()).filter(function (row) { return row.definition_id === id; })[0];
  return found && found.kind === 'offer' ? found : null;
}
async function cbDefSetStatus(id, status) {
  var offer = status === 'live' ? cbOfferNamed(id) : null;
  if (offer) return cbOfferAskLive(offer, function () { return cbDefWriteStatus(id, status, true); }).catch(function (e) { toast((e && e.message) || 'Could not change that.'); });
  return cbDefWriteStatus(id, status, false);
}
async function cbDefWriteStatus(id, status, confirmed) {
  try {
    await api('defSave', { params: { id: id }, body: confirmed ? { status: status, confirmed: true } : { status: status } });
    toast(status === 'live' ? 'Live — it can be adopted now.' : 'Back to draft.');
    await cbDefAfterChange(null, id);
  } catch (e) {
    toast((e && e.message) || 'Could not change that.');
  }
}
/* ⚠️ In-app dialog, not `confirm()` — Athi, on the supplier panel: *"the message appears from the browser it has
   to be system message"*. `confirmAsk` (app.html) is the one replacement; this was one of the 8 stragglers.
   ⚠️ The wording says what actually happens. "Delete?" would be a lie — the row survives so that chits which
   cited it stay explainable, and someone who believes they erased something is owed the truth. */
/**
 * Go to the screen that OWNS a kind, and land on the right section of it.
 * ⚠️ The section is set BEFORE navigating AND again after the capability loads — the target screen reads
 * `CATSET.sec` as it renders, and on a cold load it renders before this file's `then` would have run.
 */
function cbDefGoHome(nav, sec) {
  if (sec && nav === 'catsetup') {
    if (typeof CATSET === 'undefined') window.CATSET = { sec: sec };
    else CATSET.sec = sec;
  }
  navTo(nav);
  if (sec && nav === 'catsetup')
    ensureCap('catsetup').then(function () {
      CATSET.sec = sec;
      if (typeof catsetPaint === 'function') catsetPaint();
    });
}
/** The takeover ask: every LIVE slab but the one retiring (governance first), then retry the retire with it. */
async function cbDefTakeoverAsk(id, why) {
  var slabs = [];
  try {
    slabs = (await cbDefsLive('tax', true)).filter(function (x) {
      return String(x.definition_id || x.id) !== String(id) && (!x.status || x.status === 'live');
    });
  } catch (_) { /* best effort: failing here changes nothing the user sees */ }
  var opts =
    typeof cbSlabOptionsHTML === 'function'
      ? cbSlabOptionsHTML(slabs, '')
      : slabs
          .map(function (x) {
            return '<option value="' + esc(x.definition_id || x.id) + '">' + esc(x.name) + '</option>';
          })
          .join('');
  /* the app's own modal frame — .mhd / .mbody / .mfoot, as the definition form uses it */
  modal(
    '<div class="mhd"><div class="t">' +
      tx('Pick the slab that takes over') +
      '</div></div>' +
      '<div class="mbody"><div style="margin-bottom:8px">' +
      esc(why) +
      '</div>' +
      '<select data-cbsid="SCR003-S07" class="inp" id="cbdef_takeover" data-testid="cbdef-takeover" style="width:100%">' +
      opts +
      '</select>' +
      '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:6px">' +
      tx('Every product and category that cites the retiring slab is re-pointed first, with the new rate travelling onto each product.') +
      '</div></div>' +
      '<div class="mfoot"><button data-cbsid="SCR003-B02" class="pri" data-testid="cbdef-takeover-go" onclick="cbDefTakeoverGo(\'' +
      esc(id) +
      '\')">' +
      tx('Retire and hand over') +
      '</button>' +
      '<button data-cbsid="CMP003" onclick="closeModal()">' +
      tx('Cancel') +
      '</button></div>',
    false
  );
}
function cbDefTakeoverGo(id) {
  var el = document.getElementById('cbdef_takeover');
  var v = el ? el.value : '';
  if (!v) {
    toast(tx('Pick a slab first.'));
    return;
  }
  closeModal();
  _cbDefRetire(id, v);
}
function cbDefRetire(id, name) {
  confirmAsk(
    'Retire “' + esc(name) + '”?',
    'It leaves the shelf and <b>cannot be used again</b>.' +
      '<div style="margin-top:7px">' +
      txf('It is {notdeleted} — chits that already cite it stay explainable.', { notdeleted: '<b>' + tx('not deleted') + '</b>' }) +
      '</div>',
    'Retire',
    function () {
      _cbDefRetire(id);
    },
    true
  );
}
async function _cbDefRetire(id, takeover) {
  /* Same after-change path as save and status: refresh both lists AND drop the product page's live-offers cache —
     [OFF-01] RETIRE found the retired offer still listed on the product until a reload. */
  try {
    var reply = await api('defRetire', { params: { id: id }, query: takeover ? { takeover: takeover } : undefined });
    toast(
      reply && reply.moved && (reply.moved.products || reply.moved.categories)
        ? txf('Retired — {p} product(s) and {c} category(ies) now cite the takeover slab.', {
            p: String(reply.moved.products),
            c: String(reply.moved.categories)
          })
        : 'Retired.'
    );
    await cbDefAfterChange(null, id);
  } catch (e) {
    /* ⭐ A SLAB DOES NOT GO DARK UNDER ITS PRODUCTS. The API refuses (409 "cited") until a takeover slab is named —
       Athi, 2026-09-05: "the system should reject and ask another slab to take over". Ask, then retry with it. */
    var msg = (e && e.message) || '';
    if (/cite this slab/i.test(msg) || (e && e.status === 409)) return cbDefTakeoverAsk(id, msg);
    toast(msg || 'Could not retire that.');
  }
}

/* ── render ──────────────────────────────────────────────────────────────────────────────────────────────────── */

/* ⚠️ renderApp(), not a local paint — this screen returns HTML to the router like every other
   capability, so the router is the only thing that owns the frame. */
/**
 * ⚠️ REPAINT IN PLACE, KEEPING THE SCROLL (Athi, 2026-08-16: *"when I click the below items in defn screen, it
 * jumps to the top"*).
 *
 * It called renderApp(), which rebuilds the whole screen — and a fresh DOM starts at scrollTop 0. So opening the
 * ninth section threw you back to the first, and you had to scroll down again to see what you had just opened.
 * The further down the page a section is, the worse it gets, which is exactly backwards.
 *
 * Swapping only the definitions block and restoring the offset keeps the section you clicked under your cursor.
 * ⚠️ Read scrollTop BEFORE the innerHTML swap — after it the element has been rebuilt and reports 0.
 */
function cbDefScroller() {
  var node = document.querySelector('.cbdef-wrap');
  /* The scroller may be the wrap or an ancestor, depending on the shell — walk up to whichever actually scrolls. */
  var n = node;
  while (n && n !== document.body) {
    if (n.scrollHeight > n.clientHeight + 1) return n;
    n = n.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}
function cbDefRepaint() {
  var host = document.querySelector('.cbdef-wrap');
  if (!host) {
    renderApp();
    return;
  } // not on the screen — fall back
  var y = (cbDefScroller() || {}).scrollTop || 0;
  host.outerHTML = cbDefHTML();
  /**
   * ⚠️ RE-QUERY THE SCROLLER AFTER THE SWAP. My first version held a REFERENCE across `outerHTML =`, which
   * destroys the element — so it dutifully restored the offset onto a node no longer in the document, and the
   * page still jumped to the top. Measured: 574 → 0. The scroller here IS `.cbdef-wrap` (or an ancestor of it),
   * which is precisely the node being replaced, so the reference can never survive.
   */
  var sc = cbDefScroller();
  if (sc) sc.scrollTop = y;
}
function cbDefToggle(k) {
  CBDEF.open[k] = !CBDEF.open[k];
  cbDefRepaint();
}

/**
 * ⚠️⚠️ THE LABEL NEVER REPEATS THE CODE. Athi, 2026-09-01: *"HS and HS-Harmonized system, do we need two HS?"*
 * We did not: the chip says `HS` and the label is written `HS — Harmonized System`, so every row said the name
 * twice. The registry entries are written with the prefix because the label also stands ALONE elsewhere (a
 * dropdown of schemes with no chip beside it), so the fix trims at RENDER rather than editing the data — and any
 * future entry written the same way renders once too, without anyone having to remember a convention.
 *
 * ⭐ IT LIVES HERE BECAUSE TWO SCREENS DRAW THESE ROWS. The registry showcase in this file, and the Classification
 * schemes block on the Categories screen — which is the one Athi was actually looking at. Writing the trim into
 * whichever screen was in front of me would have fixed one of them and left the other saying HS twice.
 */
function cbDefLabelOnce(r) {
  var text = String((r && r.label) == null ? '' : r.label);
  var code = String((r && r.code) == null ? '' : r.code);
  if (!code) return text;
  if (text === code) return '';
  return text.replace(new RegExp('^' + code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[—–:-]\\s*'), '');
}

function cbDefSectionHTML(s) {
  var open = !!CBDEF.open[s.key];
  var count = s.rows ? s.rows.length : 0;
  var head =
    '<div data-cbsid="SCR003-C01" class="cbdef-head" data-testid="cbdef-' +
    esc(s.key) +
    '"' +
    ' onclick="cbDefToggle(\'' +
    esc(s.key) +
    '\')">' +
    '<span class="cbdef-ico">' +
    s.icon +
    '</span>' +
    '<span class="cbdef-t">' +
    esc(s.title) +
    '</span>' +
    /* ⚠️ "not loaded" is NOT "0". An empty list and a missing source look identical on screen and mean opposite
       things — one says the catalogue may have none of these, the other says this screen cannot tell you. */
    '<span class="cbdef-n">' +
    (s.rows ? count + ' kind' + (count === 1 ? '' : 's') : 'not loaded') +
    '</span>' +
    '<span class="cbdef-caret">' +
    (open ? '▾' : '<span class=arw>▸</span>') +
    '</span></div>';
  if (!open) return '<div class="cbdef-sec">' + head + '</div>';

  var body = '<div class="cbdef-blurb">' + esc(s.blurb) + '</div>';
  if (!s.rows) {
    body += '<div class="cbdef-empty">This registry has not loaded on this page, so its kinds cannot be listed. ' + 'It is not that there are none.</div>';
  } else {
    body += s.rows
      .map(function (item) {
        var lab = cbDefLabelOnce(item);
        var code = String(item.code == null ? '' : item.code);
        return (
          '<div class="cbdef-row">' +
          /* ⭐ THE NAME IS ITS OWN LINE and everything that explains it sits underneath — Athi: *"bring the
           explanation below the HS-, this will give a better look… your own scheme in one line and the
           explanation can be given below."* The issuing body moved down with the rest: it is an explanation of
           the scheme, not part of its name, and inline it made the one line people scan the crowded one. */
          '<div class="cbdef-name">' +
          '<code class="cbdef-code">' +
          esc(code) +
          '</code>' +
          (lab ? '<span class="cbdef-lab">' + esc(lab) + '</span>' : '') +
          '</div>' +
          (item.who ? '<div class="cbdef-who">' + esc(item.who) + '</div>' : '') +
          (item.note ? '<div class="cbdef-note">' + esc(item.note) + '</div>' : '') +
          /* ⭐ A worked example is what turns a scheme name into something someone can act on. */
          (item.eg ? '<div class="cbdef-eg"><span class="cbdef-eglab">e.g.</span> ' + esc(item.eg) + '</div>' : '') +
          /* ⚠️ rel="noopener" — a target=_blank link without it hands the opened page a handle on ours. */
          (item.url
            ? '<div class="cbdef-link"><a href="' +
              esc(item.url) +
              '" target="_blank" rel="noopener noreferrer">' +
              esc(item.url.replace(/^https?:\/\//, '')) +
              ' ↗</a></div>'
            : '') +
          '</div>'
        );
      })
      .join('');
  }
  /**
   * ⭐ THE SOURCE IS ON SCREEN — BUT ONLY UNDER 🧾 Spec. Athi, 2026-09-01: *"read from app/catalogue-model.js ·
   * STD_SCHEMES, is it necessary?"* For the person choosing a scheme, no: it is a file path, and a file path
   * cannot help anyone decide anything.
   *
   * ⚠️ It is not deleted either. This screen's whole claim is that it keeps no list of its own, and naming WHERE
   * each list comes from is what makes that checkable rather than a promise in a comment. Spec mode already
   * exists for exactly this reader — *"standards, mechanisms, and the API calls it makes"* — so the claim stays
   * verifiable by whoever wants to verify it, and stops being a footnote on everybody else's screen.
   */
  if (typeof specOn === 'function' && specOn()) {
    body += '<div class="cbdef-src">read from <code>' + esc(s.source) + '</code></div>';
  }
  return '<div class="cbdef-sec">' + head + '<div class="cbdef-body">' + body + '</div></div>';
}

/**
 * ⭐ YOUR OWN DEFINITIONS — rendered ABOVE the registry showcase, because what you made matters more to you
 * than what the system knows. The showcase becomes reference material once you have your own shelf.
 */
/**
 * The registry rows for one authorable kind, rendered INSIDE that kind's section. Reads `cbDefRegistries()` — the
 * same source the standalone sections used — so merging the two sections did not create a second list.
 *
 * ⚠️ Returns nothing when the registry has not loaded, rather than an empty "kinds" heading with nothing under it.
 * An empty list and a missing source look identical and mean opposite things; the standalone section says "not
 * loaded" in its count, and here the honest move is to show no heading at all.
 */
function cbDefKindsInline(kind) {
  var s = cbDefRegistries().filter(function (x) {
    return x.key === kind;
  })[0];
  if (!s || !s.rows || !s.rows.length) return '';
  return (
    '<div class="cbdef-kindsin">' +
    '<div class="cbdef-kindshd">Built from — ' +
    s.rows.length +
    ' kind' +
    (s.rows.length === 1 ? '' : 's') +
    '</div>' +
    s.rows
      .map(function (item) {
        return (
          '<div class="cbdef-kindrow"><code class="cbdef-code">' +
          esc(item.code) +
          '</code>' +
          '<span class="cbdef-kindlbl">' +
          esc(item.label) +
          '</span>' +
          (item.note ? '<span class="cbdef-kindnote">' + esc(item.note) + '</span>' : '') +
          '</div>'
        );
      })
      .join('') +
    '</div>'
  );
}
function cbDefMineHTML() {
  if (CBDEF.mine === null) {
    cbDefLoad();
    return '<div class="cbdef-loading">' + tx('Reading your shelf…') + '</div>';
  }

  var out = Object.keys(CBDEF_AUTHORABLE)
    .map(function (kind) {
      var A = CBDEF_AUTHORABLE[kind];
      var mine = cbDefMineOf(kind),
        retired = cbDefRetiredOf(kind);
      var rows = mine
        .map(function (item) {
          var live = item.status === 'live';
          /**
           * ⚠️ THREE STATES, NOT TWO (backlog 19; Athi: *"if the offer are retired then that has to be shown as
           * retired as well"*). This was `live ? 'live' : 'draft'` — a boolean for a column with THREE values, so a
           * RETIRED definition rendered as **draft**. Worse than hiding it: "draft" reads as *not finished, you might
           * publish it*, when the truth is *withdrawn, and it can never be adopted again* — so someone reads the badge
           * and tries to publish it.
           */
          var st = item.status === 'live' ? 'live' : item.status === 'retired' ? 'retired' : 'draft';
          return (
            '<div class="cbdef-mine-row' +
            (st === 'retired' ? ' is-retired' : '') +
            '" data-testid="cbdef-mine-' +
            esc(item.definition_id) +
            '">' +
            '<span class="cbdef-mine-n">' +
            esc(item.name) +
            '</span>' +
            (item.sub_kind ? '<code class="cbdef-code">' + esc(item.sub_kind) + '</code>' : '') +
            '<span class="cbdef-badge ' +
            st +
            '">' +
            st +
            '</span>' +
            /* ⭐ THE VERSION IS ON SCREEN. It is the thing a stamped chit points at, so hiding it would make the
           freeze rule invisible in the one place someone might need to check it. */
            '<span class="cbdef-ver">v' +
            esc(item.current_version) +
            '</span>' +
            '<span class="cbdef-acts">' +
            '<span data-cbsid="CMP012" onclick="cbDefEdit(\'' +
            esc(item.definition_id) +
            '\')">' +
            tx('Edit') +
            '</span>' +
            '<span data-cbsid="SCR003-C02" onclick="cbDefSetStatus(\'' +
            esc(item.definition_id) +
            "','" +
            (live ? 'draft' : 'live') +
            '\')">' +
            (live ? 'Unpublish' : 'Publish') +
            '</span>' +
            '<span data-cbsid="SCR003-C03" onclick="cbDefRetire(\'' +
            esc(item.definition_id) +
            "','" +
            esc(item.name) +
            '\')">' +
            tx('Retire') +
            '</span>' +
            '</span>' +
            /* ⚠️ The author's note, same as the Catalogue setup row — it was saved by the form and displayed by
           nothing, on either list. See cbDefFormHTML's Note field. */
            (item.note ? '<div class="cbdef-mine-note">' + esc(item.note) + '</div>' : '') +
            '</div>'
          );
        })
        .join('');

      /**
       * ⭐ THE SAME SHELL AS THE REGISTRY SECTIONS (Athi, 2026-08-16: *"also the categories, order models and offers
       * also the same way if it look and feel it will be good … otherwise they look different"*).
       *
       * They already shared `cbdef-sec` and `cbdef-head`, but had NO CARET and NO TOGGLE — always open, while every
       * other section on the page collapsed. One page, two behaviours for the same-looking row, which is exactly
       * what made them read as a different kind of thing.
       *
       * ⚠️ They DEFAULT OPEN, unlike the registries. That is a difference in default, not in form — these are your
       * own definitions and there are few of them, so hiding them behind a click on arrival would be worse. The
       * affordance is identical either way.
       */
      var mkey = 'mine:' + kind;
      if (CBDEF.open[mkey] === undefined) CBDEF.open[mkey] = true;
      var mopen = !!CBDEF.open[mkey];
      return (
        '<div class="cbdef-sec">' +
        '<div data-cbsid="SCR003-C04" class="cbdef-head cbdef-head-mine" data-testid="cbdef-mine-head-' +
        kind +
        '"' +
        ' onclick="cbDefToggle(\'' +
        mkey +
        '\')">' +
        '<span class="cbdef-ico">' +
        A.icon +
        '</span>' +
        '<span class="cbdef-t">' +
        esc(A.title) +
        '</span>' +
        '<span class="cbdef-n">' +
        mine.length +
        (retired.length ? ' · ' + retired.length + ' retired' : '') +
        '</span>' +
        /* stopPropagation — otherwise the button also collapses the section it is about to act on.
         ⚠️ A kind with a `home` is authored on ITS OWN SCREEN, so this offers the door rather than a second
         Create form. Two places to author one thing is the duplication this screen exists to have removed. */
        (A.home
          ? '<button data-cbsid="SCR003-B03" class="cbdef-new" data-testid="cbdef-home-' +
            kind +
            '" onclick="event.stopPropagation();cbDefGoHome(\'' +
            A.home.nav +
            "','" +
            (A.home.sec || '') +
            '\')">' +
            esc(A.home.label) +
            '</button>'
          : '<button data-cbsid="SCR003-B04" class="cbdef-new" data-testid="cbdef-new-' + kind + '" onclick="event.stopPropagation();cbDefNew(\'' + kind + '\')">+ New</button>') +
        '<span class="cbdef-caret">' +
        (mopen ? '▾' : '<span class=arw>▸</span>') +
        '</span>' +
        '</div>' +
        (mopen
          ? '<div class="cbdef-body">' +
            '<div class="cbdef-blurb">' +
            esc(A.blurb) +
            '</div>' +
            /* ⚠️ An empty shelf says what to do, not "0 results". Nobody arrives here knowing what a definition is for. */
            (rows ||
              '<div class="cbdef-none">' +
                txf('None yet. {new} to name one — then a catalogue can use it.', { new: '<b>+ ' + tx('New') + '</b>' }) +
                '</div>') +
            /* The vocabulary this kind is built from, in the same section rather than a second one further down. Still
         read STRAIGHT from the registry — folding the sections together must not fold in a copy of the list. */
            cbDefKindsInline(kind) +
            '</div>'
          : '') +
        '</div>'
      );
    })
    .join('');

  return '<div class="cbdef-mine">' + (CBDEF.err ? '<div class="cbdef-err">' + esc(CBDEF.err) + '</div>' : '') + out + '</div>';
}

function cbDefHTML() {
  var secs = cbDefRegistries();
  return (
    '<div class="cbdef-wrap" data-testid="definitions">' +
    '<div class="cbdef-hd">' +
    '<span style="font-family:\'Space Grotesk\';font-weight:700;font-size:var(--fs-3)">' +
    tx('🧱 Definitions') +
    '</span>' +
    '<button data-cbsid="CMP016" onclick="openAssist(\'definitions\')" title="Ask the assistant about this screen"' +
    ' style="border:1px solid var(--line);background:var(--card);color:var(--blue);border-radius:50%;width:20px;' +
    'height:20px;font-weight:800;cursor:pointer;font-size:12px;line-height:1;flex:none">?</button>' +
    '</div>' +
    '<div class="cbdef-lede">' +
    txf(
      'Everything a catalogue can be built from — the {kinds} available to you. Naming your own (a category list, an offer, “Carton of 6”) and attaching them to a catalogue comes next.',
      {
        kinds: '<b>' + tx('kinds') + '</b>'
      }
    ) +
    '</div>' +
    /**
     * ⚠️ SAYING WHAT IS NOT HERE, IN THE PRODUCT, NOT ONLY IN A SPEC. A showcase that looks like a finished
     * feature invites someone to hunt for the Create button and conclude the screen is broken. The honest
     * version of "read-only first" says so out loud.
     */
    /**
     * ⚠️ THIS BANNER SAID "read-only showcase" FOR ABOUT AN HOUR AFTER IT STOPPED BEING TRUE. A screen that
     * describes itself wrongly is worse than one that says nothing: someone reads it, believes the Create button
     * is decorative, and stops looking. Copy is part of the build, not a label applied afterwards.
     */
    '<div class="cbdef-note-box">Name your own below — a category, an order model, an offer. ' +
    'A definition stays <b>loose while a catalogue references it</b>: edit it and every catalogue that adopted ' +
    'it sees the new terms. It is <b>fixed the moment a chit is sent</b>, so a chit keeps the ' +
    'version it agreed even after you change the shelf. ' +
    '<span style="opacity:.8">Adoption — attaching one to a catalogue — comes next.</span></div>' +
    /**
     * ⭐ ONE SECTION PER SUBJECT (Athi, 2026-08-16: *"order model and order model kinds looks similar if so, one
     * has to be removed. and should bring it together"*).
     *
     * "Order models" (yours) and "Order model kinds" (the vocabulary) were two sections with the SAME key and the
     * SAME icon, one above the other — so the page asked you to hold a distinction it never explained. Same for
     * Offers / Offer kinds. They are now folded into one section each: your named ones, then the kinds they are
     * built from. The registry list still comes from the registry — nothing is copied.
     *
     * ⚠️ Renaming one of them would not have fixed it. Two rows about one subject is the problem; a better label
     * only makes the split easier to describe.
     */
    cbDefMineHTML() +
    (function () {
      var rest = secs.filter(function (item) {
        return !CBDEF_AUTHORABLE[item.key];
      });
      if (!rest.length) return '';
      return '<div class="cbdef-shelfhd">' + tx('What the system knows — the shapes available to you') + '</div>' + rest.map(cbDefSectionHTML).join('');
    })() +
    '</div>'
  );
}

/**
 * definitionsScreen — the entry point the router calls. RETURNS HTML; it does not paint. Every other
 * capability in this app works that way (traceabilityScreen, readinessScreen, disputesScreen) and a screen that
 * painted itself would be the one that behaves differently for no reason.
 */
function definitionsScreen() {
  cbDefCss();
  return cbDefHTML();
}

function cbDefCss() {
  if (document.getElementById('cbdef_css')) return;
  var node = document.createElement('style');
  node.id = 'cbdef_css';
  node.textContent = [
    /**
     * ⚠️⚠️ THE SCREEN MUST OWN ITS OWN SCROLLING. `#mainbody` is `flex:1; display:flex; flex-direction:column;
     * min-height:0` — a flex COLUMN that does not scroll. A screen that just returns tall HTML gets clipped in
     * silence: measured here at 2,071px of content in a 799px viewport with `overflow-y: visible`, so 1,272px —
     * every section below Offer kinds — was simply unreachable. Nothing errors, the page just ends.
     *
     * Peer screens (cap-readiness and friends) each wrap their body in an `overflow:auto` pane for exactly this
     * reason. `flex:1` so it takes the remaining height rather than its content's height, and `min-height:0`
     * because a flex item's default `min-height:auto` refuses to shrink below its content and would put the
     * overflow back where it started.
     */
    '.cbdef-wrap{flex:1;min-height:0;overflow-y:auto;padding-bottom:var(--scroll-tail);padding:14px 16px 40px;max-width:820px}',
    '.cbdef-hd{display:flex;align-items:center;gap:8px;margin-bottom:6px}',
    '.cbdef-lede{font-size:var(--fs-2);color:var(--grey);line-height:1.55;margin-bottom:10px;max-width:66ch}',
    '.cbdef-note-box{font-size:var(--fs-2);line-height:1.55;color:var(--warn-3);background:var(--gold-soft);',
    'border:1px solid var(--gold-line);border-radius:9px;padding:10px 12px;margin-bottom:14px;max-width:66ch}',
    '.cbdef-sec{border:1px solid var(--line);border-radius:12px;margin-bottom:9px;background:var(--card);overflow:hidden}',
    '.cbdef-head{display:flex;align-items:center;gap:9px;padding:11px 13px;cursor:pointer;user-select:none}',
    '.cbdef-head:hover{background:var(--card)}',
    '.cbdef-ico{font-size:var(--fs-4);line-height:1}',
    '.cbdef-t{font-weight:700;font-size:13.5px}',
    '.cbdef-n{margin-inline-start:auto;font-size:var(--fs-1);color:var(--grey);font-variant-numeric:tabular-nums}',
    '.cbdef-caret{color:var(--grey);font-size:var(--fs-2);width:12px;text-align:center}',
    '.cbdef-body{padding:0 13px 12px;border-top:1px solid var(--line)}',
    '.cbdef-blurb{font-size:var(--fs-2);color:var(--grey);line-height:1.5;margin:10px 0 8px;max-width:66ch}',
    '.cbdef-row{padding:7px 0;border-bottom:1px dashed #eee9e0}',
    '.cbdef-row:last-of-type{border-bottom:0}',
    '.cbdef-code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:var(--fs-1);',
    'background:var(--warn-tint);border-radius:5px;padding:1px 6px;margin-inline-end:8px;color:var(--warn-3)}',
    '.cbdef-lab{font-size:var(--fs-2);font-weight:600}',
    '.cbdef-note{font-size:var(--fs-2);color:var(--grey);margin-top:3px;line-height:1.5;max-width:66ch}',
    /* The name line: the code chip and its words, together, with nothing else competing on it. */
    '.cbdef-name{display:flex;align-items:baseline;gap:7px;flex-wrap:wrap}',
    '.cbdef-who{font-size:var(--fs-1);color:var(--grey-4);margin-top:3px}',
    '.cbdef-eg{font-size:var(--fs-2);margin-top:4px;background:var(--gold-soft,var(--gold-soft));border:1px solid var(--gold-line,var(--gold-line));',
    'border-radius:6px;padding:4px 9px;display:inline-block;max-width:66ch;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}',
    '.cbdef-eglab{font-weight:700;color:var(--warn-2);font-family:inherit}',
    '.cbdef-link{margin-top:4px}',
    '.cbdef-link a{font-size:var(--fs-1);color:var(--blue,var(--blue));text-decoration:none}',
    '.cbdef-link a:hover{text-decoration:underline}',
    '.cbdef-empty{font-size:var(--fs-2);color:var(--disp);padding:6px 0 2px;max-width:66ch}',
    '.cbdef-src{margin-top:10px;font-size:var(--fs-1);color:var(--grey-4)}',
    '.cbdef-src code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:var(--fs-1)}',
    '.cbdef-mine{margin-bottom:22px}',
    '.cbdef-shelfhd{font-size:var(--fs-1);text-transform:uppercase;letter-spacing:.06em;color:var(--grey);margin:18px 0 8px;font-weight:700}',
    '.cbdef-head-mine{cursor:default}',
    '.cbdef-head-mine:hover{background:transparent}',
    '.cbdef-new{margin-inline-start:10px;border:1px solid var(--blue,var(--blue));background:var(--blue,var(--blue));color:#fff;border-radius:9px;padding:4px 11px;font-size:var(--fs-2);font-weight:700;cursor:pointer;font-family:inherit;flex:none}',
    '.cbdef-mine-row{display:flex;align-items:center;gap:9px;padding:8px 0;border-bottom:1px dashed #eee9e0;flex-wrap:wrap}',
    '.cbdef-mine-row:last-child{border-bottom:0}',
    '.cbdef-mine-n{font-size:var(--fs-3);font-weight:700}',
    '.cbdef-mine-note{flex-basis:100%;font-size:var(--fs-1);color:var(--grey);line-height:1.4;margin:-3px 0 1px}',
    '.cbdef-badge{font-size:var(--fs-1);font-weight:700;border-radius:6px;padding:1px 7px;text-transform:uppercase;letter-spacing:.04em}',
    '.cbdef-badge.live{background:var(--ok-tint);color:var(--ok-2)}',
    '.cbdef-badge.draft{background:var(--warn-tint);color:var(--warn-2)}',
    /* Retired is visually SPENT — struck name, grey badge — so it can never be mistaken for a draft awaiting publish. */
    '.cbdef-badge.retired{background:var(--neutral-tint);color:var(--ink-2)}',
    '.cbdef-kindsin{margin-top:12px;border-top:1px dashed var(--line);padding-top:9px}',
    '.cbdef-kindshd{font-size:var(--fs-1);font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--grey);margin-bottom:5px}',
    '.cbdef-kindrow{display:flex;gap:9px;align-items:baseline;padding:3px 0;font-size:var(--fs-2);flex-wrap:wrap}',
    '.cbdef-kindlbl{color:var(--ink)}',
    '.cbdef-kindnote{color:var(--grey);font-size:var(--fs-1);flex:1;min-width:0}',
    '.cbdef-mine-row.is-retired .cbdef-mine-n{text-decoration:line-through;color:var(--grey)}',
    '.cbdef-mine-row.is-retired{opacity:.82}',
    '.cbdef-ver{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:var(--fs-1);color:var(--grey-4)}',
    '.cbdef-acts{margin-inline-start:auto;display:flex;gap:12px}',
    '.cbdef-acts span{font-size:var(--fs-1);color:var(--blue,var(--blue));cursor:pointer;font-weight:600}',
    '.cbdef-acts span:hover{text-decoration:underline}',
    '.cbdef-none{font-size:var(--fs-2);color:var(--grey);padding:4px 0}',
    '.cbdef-loading{padding:14px 0;font-size:var(--fs-2);color:var(--grey)}',
    '.cbdef-err{font-size:var(--fs-2);color:var(--disp);background:var(--danger-tint);border:1px solid #f0c9c6;border-radius:9px;padding:8px 11px;margin-bottom:10px}',
    /* ⚠️ .cbdef-freeze and .cbdef-rules went with the paragraph and the gold rail they styled — the freeze rule
       is a pill beside the version it names now, and the rule fields sit in the two-column grid. Dead CSS is a
       rule the next person restores markup to match. */
    /* ── the authoring form ────────────────────────────────────────────────────────────────────────────────
       ⚠️ THE BODY SCROLLS AND THE FOOTER DOES NOT. The buttons were at the end of the flow, so a long form put
       Save below the fold while leaving empty card under it once a remembered height was restored. */
    /* ⚠️ The frame is .mhd/.mbody/.mfoot — the app's own, which carry the padding modal() does not. These only
       add what is specific to this form. */
    '.cbdef-formhd{display:flex;align-items:baseline;gap:9px}',
    '.cbdef-vpill{margin-inline-start:auto;font-size:var(--fs-1);font-weight:700;color:var(--warn-3);' +
      'background:var(--gold-soft,var(--gold-soft));border:1px solid var(--gold-line,var(--gold-line));border-radius:20px;padding:1px 9px;white-space:nowrap}',
    /**
     * ⚠️⚠️ THE ROW RHYTHM IS label.fl's OWN (12px above, 5px below) — the same one every field on the product
     * Edit form uses, so the two screens read as one product. My first grid overrode it to 7px/1px "to fit more
     * in", which is precisely the complaint: the labels sat on top of the boxes and nothing had room to breathe.
     * Fields keep 12px between the input and the next label via .cbdef-f's bottom margin.
     */
    '.cbdef-grid{display:grid;grid-template-columns:1fr 1fr;column-gap:14px;row-gap:0;align-items:end}',
    '.cbdef-grid>.cbdef-w2{grid-column:1/-1}',
    '.cbdef-grid>.fl:first-child{margin-top:2px}',
    '.cbdef-grid>.cbdef-f{min-width:0;margin-bottom:7px}',
    '.cbdef-grid>.inp,.cbdef-grid>select.inp{margin:0 0 7px}',
    '.cbdef-grid .cbdef-f .inp{margin:0}',
    /* ⚠️ .cbdef-hint had NO RULE AT ALL — every one-line explanation rendered at body size in body colour,
       indistinguishable from a label. A hint that looks like content is content. */
    '.cbdef-hint{font-size:var(--fs-1);line-height:1.45;color:var(--grey);margin:4px 0 0}',
    '.cbdef-grid .cbdef-hint{margin:4px 0 0}',
    '.cbdef-grid>.cbdef-hint{margin:4px 0 7px}',
    '.cbdef-check{display:flex;align-items:center;gap:8px;font-size:var(--fs-2);font-weight:700;color:var(--ink);' +
      'margin:12px 0 0;padding:10px 13px;border:1px solid var(--line);border-radius:9px;background:var(--paper);cursor:pointer}',
    '.cbdef-check input{width:16px;height:16px;margin:0;flex:none}',
    '.cbdef-adorn{display:flex;align-items:center;gap:0;border:1px solid var(--line);border-radius:9px;background:var(--card);overflow:hidden}.cbdef-adorn>b{padding:0 10px;font-weight:700;color:var(--grey-2);font-size:var(--fs-2);flex:none}.cbdef-adorn>input.inp{border:0;border-radius:0;margin:0;flex:1;min-width:0;background:transparent}.cbdef-adorn-after>b{border-inline-start:1px solid var(--line)}',
    '@media (max-width:680px){ .cbdef-grid{grid-template-columns:1fr} .cbdef-grid>.cbdef-w2{grid-column:1} }',
    /* ── the outcome strip ─────────────────────────────────────────────────────────────────────────────── */
    '.cbdef-prev{margin-top:13px;border:1px solid var(--line);border-radius:10px;padding:9px 11px;background:var(--neutral-tint,var(--card))}',
    '.cbdef-prevhd{font-size:var(--fs-1);font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--grey);margin-bottom:6px}',
    '.cbdef-prevbadge{display:inline-block;font-size:var(--fs-2);font-weight:800;color:var(--ok-2);' +
      'background:var(--ok-tint);border-radius:20px;padding:2px 11px;margin-bottom:6px}',
    '.cbdef-prevbadge .off{font-weight:600;color:var(--grey)}',
    '.cbdef-prevbadge:has(.off){background:transparent;padding:2px 0}',
    '.cbdef-prevgate{font-size:var(--fs-2);font-weight:700;color:var(--warn-2);margin-bottom:6px}',
    '.cbdef-prevrow{display:flex;gap:9px;align-items:baseline;font-size:var(--fs-2);padding:2px 0;border-top:1px dashed var(--line)}',
    '.cbdef-prevrow .q{flex:none;color:var(--grey);min-width:96px}',
    '.cbdef-prevrow .m{flex:none;font-variant-numeric:tabular-nums;min-width:132px}',
    '.cbdef-prevrow .w{flex:1;min-width:0;font-size:var(--fs-1);color:var(--grey)}',
    /* The standards menu. Scrolls rather than wraps to twelve rows — the textarea above it is the record; this is
       a way of filling it without knowing the keys by heart. */
    '.cbdef-stdhint{font-size:var(--fs-1);color:var(--grey);margin:8px 0 5px}',
    '.cbdef-stds{display:flex;flex-wrap:wrap;gap:5px;max-height:132px;overflow-y:auto;padding:2px 1px}',
    '.cbdef-stdchip{border:1px solid var(--line);background:var(--card);border-radius:20px;height:26px;padding:0 10px;' +
      'font:inherit;font-size:var(--fs-1);color:var(--ink);cursor:pointer;white-space:nowrap}',
    '.cbdef-stdchip:hover{border-color:#c6ccd4}',
    '.cbdef-stdchip.on{background:var(--blue-tint-bg);border-color:var(--blue,var(--blue));color:var(--blue,var(--blue));font-weight:700}'
  ].join('');
  (document.head || document.documentElement).appendChild(node);
}

/* ══ TEST THIS OFFER (Athi, 2026-09-05: "shall we create a test here itself using one of the products to find issues with the
   engine?") — pick one of YOUR products and a quantity; the SAME engine that prices the cart (prodOfferCartHTML → CBOffers)
   shows listed → after offers → GST → after tax for the rule AS IT STANDS ON THE FORM, saved or not, and says why it did
   not apply when it did not. An offer that says nothing shows nothing off — here, before it is saved. ═══════════════ */
var CBDEF_TEST = {
  prods: null,
  pid: '',
  qty: 2,
  asCustomer: true
}; /* asCustomer: the bench stands in the offer's customer's shoes; untick to see a stranger (Athi, 2026-09-06 19:54) */
function cbDefTestHTML(f) {
  return (
    '<div class="cbdef-test" data-testid="cbdef-test" style="margin-top:12px;padding:10px 12px;border:1px dashed var(--line);border-radius:10px">' +
    '<div style="font-weight:800;font-size:var(--fs-1);letter-spacing:.04em;text-transform:uppercase;color:var(--grey-2);margin-bottom:6px">' +
    tx('Test this offer') +
    '</div>' +
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
    '<select data-cbsid="SCR003-S08" class="inp" data-testid="cbdef-test-product" style="flex:1 1 180px;margin:0" onfocus="cbDefTestLoad()" onchange="CBDEF_TEST.pid=this.value;cbDefTestRun()">' +
    cbDefTestOptions() +
    '</select>' +
    '<input data-cbsid="SCR003-I06" class="inp" data-testid="cbdef-test-qty" type="number" min="1" step="1" value="' +
    CBDEF_TEST.qty +
    '" style="width:76px;margin:0" oninput="CBDEF_TEST.qty=Math.max(1,parseInt(this.value)||1);cbDefTestRun()">' +
    '<button data-cbsid="SCR003-B05" type="button" data-testid="cbdef-test-run" onclick="cbDefTestRun()" style="border:1px solid var(--line);background:var(--card);color:var(--on-card);border-radius:8px;padding:6px 12px;cursor:pointer">' +
    tx('Test') +
    '</button>' +
    '</div>' +
    cbDefTestAsHTML() +
    '<div id="cbdef_test_out" data-testid="cbdef-test-out" style="margin-top:8px"></div></div>'
  );
}
function cbDefTestOptions() {
  var list = CBDEF_TEST.prods;
  if (!list) return '<option value="">' + esc(tx('Pick a product…')) + '</option>';
  return (
    '<option value="">' +
    esc(tx('Pick a product…')) +
    '</option>' +
    list
      .map(function (item) {
        var d = item.item_data || {};
        var id = item.item_id || item.id;
        return '<option value="' + esc(id) + '"' + (id === CBDEF_TEST.pid ? ' selected' : '') + '>' + esc(d.name || id) + '</option>';
      })
      .join('')
  );
}
async function cbDefTestLoad() {
  if (CBDEF_TEST.prods) return;
  try {
    var reply = await api('prodList', { query: { limit: 200 } });
    CBDEF_TEST.prods = (reply && (reply.items || reply.products || reply.rows)) || (Array.isArray(reply) ? reply : []);
  } catch (_) {
    CBDEF_TEST.prods = [];
  }
  var node = document.querySelector('[data-testid="cbdef-test-product"]');
  if (node) node.innerHTML = cbDefTestOptions();
}
function cbDefTestRun() {
  var f = CBDEF_FORM,
    out = document.getElementById('cbdef_test_out');
  if (!f || !out) return;
  /* ⭐ TESTED AS THE CUSTOMER — OR NOT (Athi, 2026-09-06 19:54: "consider it as a high value customer; a checkbox to see the difference,
     otherwise you are not testing the offer"). The bench evaluates with the offer's own group when the box is ticked, with none when not. */
  var _grp = f.rules && f.rules.customer_group ? String(f.rules.customer_group) : '';
  var _groups = _grp && CBDEF_TEST.asCustomer !== false ? [_grp] : [];
  var p = (CBDEF_TEST.prods || []).find(function (x) {
    return (x.item_id || x.id) === CBDEF_TEST.pid;
  });
  if (!p) {
    out.innerHTML = '<div style="font-size:var(--fs-1);color:var(--grey)">' + esc(tx('Pick a product to test against.')) + '</div>';
    return;
  }
  var d = Object.assign({}, p.item_data || {}, { item_id: p.item_id || p.id });
  /* the rule as it stands on the form — the engine reads the rules object with kind and id on it */
  var offer = Object.assign({ id: f.id || 'test', label: f.name || 'this offer', kind: f.sub }, f.rules || {});
  var missing = cbDefMissingValue(f.kind, f.sub, f.rules || {});
  var keep = typeof UI !== 'undefined' ? UI.prodSel : undefined;
  try {
    if (typeof UI !== 'undefined') UI.prodSel = d.item_id;
  } catch (_) { /* best effort: failing here changes nothing the user sees */ }
  var html = '';
  try {
    html = typeof prodOfferCartHTML === 'function' ? prodOfferCartHTML(d, [offer], CBDEF_TEST.qty, 'cbdef-test-total', { customer_groups: _groups }) : '';
  } catch (e) {
    html = '';
  } finally {
    try {
      if (typeof UI !== 'undefined') UI.prodSel = keep;
    } catch (_) { /* best effort: failing here changes nothing the user sees */ }
  }
  var why = '';
  try {
    var lines = [cbOfferLine(0, d, CBDEF_TEST.qty)];
    var ev = CBOffers.evaluate({
      lines: lines,
      offers: [offer],
      money: function (n) {
        return fmtMoney(n, moneyCode());
      },
      customer_groups: _groups
    });
    var per = (CBOffers.perLine(ev, lines) || {})['0'] || { off: 0 };
    var skipped = (ev && ev.skipped) || [];
    if (!(per.off > 0) && !(ev && ev.claims && ev.claims.length)) {
      why =
        '<div data-testid="cbdef-test-why" style="margin-top:6px;padding:8px 10px;border-radius:8px;background:var(--warn-tint);color:var(--warn-2);font-size:var(--fs-2)">' +
        esc(
          missing ||
            (skipped.length
              ? skipped
                  .map(function (item) {
                    return item.why || item.reason || '';
                  })
                  .filter(Boolean)
                  .join(' · ')
              : tx('Nothing comes off this product at this quantity — the rule does not reach it (scope, dates, minimum, or an empty value).'))
        ) +
        '</div>';
    } else {
      why =
        '<div data-testid="cbdef-test-why" style="margin-top:6px;font-size:var(--fs-2);color:var(--ok-2);font-weight:700">' +
        esc(
          (per.off > 0 ? fmtMoney(per.off, moneyCode()) + ' ' + tx('off') : '') +
            (ev.claims && ev.claims.length ? ' · ' + ev.claims.length + ' ' + tx('free item(s)') : '')
        ) +
        '</div>';
    }
  } catch (e) {
    why = '<div style="font-size:var(--fs-1);color:var(--grey)">' + esc(String((e && e.message) || e)) + '</div>';
  }
  out.innerHTML = html + why;
}
