/**
 * app/cap-catsetup.js — CATALOGUE SETUP: how the catalogue is SHAPED (lazy; ensureCap('catsetup')).
 *
 * Athi, 2026-08-16: *"i think we are clubbing product management and catalogue management in one roof, so it is
 * confusing… another tab called catalogue mgmt … so it is a clear segregation."* He was right, and the standard
 * agrees with him.
 *
 * ── WHAT THE STANDARD SEPARATES (Akeneo / PIM, the exemplar this catalogue already adopted) ────────────────────
 * A PIM keeps four jobs apart, and we had merged all four into one toolbar:
 *   · PRODUCTS      — the records you edit daily                       → stays on Catalogue
 *   · CATEGORIES    — classification. MANY per product                 → its own screen (cap-categories)
 *   · FAMILIES /
 *     ATTRIBUTES    — the template describing a product. ZERO OR ONE   → here, as "Columns"
 *   · PRODUCT MODEL — variant axes, common vs variant attributes       → here, as "Variants"
 *   · IMPORT/EXPORT — job profiles, not toolbar buttons                → here
 *
 * ⭐ THE DISTINCTION THAT MATTERS: **categories classify, families describe.** Many categories per product, one
 * family. Treating them as one undifferentiated notion of "catalogue structure" is exactly what made the screen
 * confusing — and it is why Categories is a sibling of Catalogue rather than a section of this screen.
 *
 * ⚠️ THIS SCREEN OWNS NO LOGIC. Every action here already existed on the Catalogue toolbar and is called
 * unchanged (declareVariants · startFromStandardSet · checkCatalogueFile · downloadCatalogueTemplate ·
 * exportCatalogueCSV · the face wizard). Moving a control must not become rewriting it — the point of the change
 * is WHERE things live, and a re-implementation would smuggle behaviour changes in under a re-organisation.
 * OWNS      the Catalogue setup screen: how the catalogue is SHAPED (definitions list, columns/fields, variants, units of measure, language, adopted lists, the face wizard); catalogueSetupHubScreen is its entry.
 * CALLED BY app.html (the workshop): CAP_OF catsetup + ensureCap('catsetup') in the nav, catalogueSetupHubScreen() in its screen switch · cap-definitions.js (ensureCap('catsetup')). No page carries a <script src> for it and no customer page defines ensureCap, so it is SUPPORT (reached only through app.html).
 * FLOW      ensureCap('catsetup') → catalogueSetupHubScreen → catsetBody (one section, chosen by catsetSec) → the section's load (catsetDefsLoad · catsetUnitsLoad · catsetFieldsLoad …) → catsetPaint
 * CARD      06-catalogue-pim/categories-and-fields
 */
/* ⭐ OPENS ON BLUEPRINT, not Columns — the fastest way in is the one a reader should meet first. Someone with
   no blueprint for their trade reads one card and moves down the rail; someone with one is already there. */
var CATSET = { sec: 'blueprint' };

var CATSET_SECS = [
  /* ⭐⭐ FIRST, because adopting a published catalogue sets the columns, the units and the shape in ONE act.
     Athi: 'if the user can use the prototype ie blueprint, that sets everything… if not then go step by step.'
     Everything below this line IS the step-by-step, and the order says so. */
  /* ⚠️ THE KEY STAYS 'blueprint' — it is a deep-link target (UI.catsetWant) and a data-testid, and
     renaming it would break links for a word nobody sees. Athi named the SCREENS, 2026-09-27:
     "product list and reference catalogue". */
  { key: 'blueprint', icon: '📋', name: 'Reference catalogue', q: 'Follow another shop’s catalogue' },
  { key: 'columns', icon: '📐', name: 'Columns', q: 'What every product records' },
  { key: 'variants', icon: '🔗', name: 'Variants', q: 'One product, several sizes' },
  /**
   * ⭐ OFFERS LIVE HERE TOO (Athi, 2026-08-16: *"offers can also bring it here"*).
   *
   * ⚠️ AND THEY ARE NOT A PIM CONCEPT — worth saying so rather than quietly filing them under "catalogue". A PIM
   * describes what a product IS; an offer is a TERM OF TRADE about an order, evaluated at checkout, with a
   * validity window and a jurisdiction (see SPEC-offers-tax.md). Akeneo would not carry this at all.
   *
   * It belongs here anyway, for the reason that decides every one of these placements: this is the screen you
   * are on when you are setting up how you SELL, and an offer is authored once and then left alone — exactly the
   * rhythm of the other sections, and nothing like the rhythm of the product list.
   */
  { key: 'offers', icon: '🏷️', name: 'Offers', q: 'Discounts, tiers and deals' },
  /* ⭐ PRICING IS ITS OWN SECTION (Athi's call). Pricing models and price SOURCES belong together and are
     neither a column nor a storefront setting: one says how a price is arrived at, the other where it was read
     from and when. Price provenance is close to the traceability story, so it is named rather than buried. */
  { key: 'pricing', icon: '💱', name: 'Pricing', q: 'How a price is arrived at' },
  /* ⭐ ORDER MODELS BELONG HERE FOR THE SAME REASON VARIANTS DO — "Carton of 6" is a quantity RULE a product
     adopts, i.e. part of how the catalogue is shaped, not a product record. It was in Definitions only because
     everything definition-backed was. */
  { key: 'ordermodels', icon: '🔢', name: 'Order models', q: 'Carton of 6, sold by the metre' },
  { key: 'data', icon: '⇅', name: 'Import & export', q: 'Spreadsheets in and out' },
  /* ⭐ Beside Import & export, because all three answer the same question — how does this catalogue meet
     another system — and a reader who wants one usually wants the next. */
  { key: 'erp', icon: '🔌', name: 'Other systems', q: 'ERP · Tally · SAP field names' },
  { key: 'tax', icon: '🧾', name: 'Tax', q: 'Slabs your products cite' },
  { key: 'face', icon: '🛍️', name: 'Storefront', q: 'How customers order from you' }
];
/**
 * ⚠️ ONE LOADER FOR EVERY DEFINITION KIND THIS SCREEN HOSTS, keyed by kind. Offers and order models are the same
 * shape of thing — a named, versioned rule a product or an order adopts — so they get one reader, not two that
 * drift. `all=1` because this is the MANAGEMENT view: retired ones must be visible, or someone re-creates
 * something they already withdrew. Compose asks for live only; that difference is the point of having a screen.
 */
var CATSET_DEFS = {},
  _catsetDefReq = {};
function catsetDefsLoad(kind, force) {
  if (!force && CATSET_DEFS[kind]) return Promise.resolve(CATSET_DEFS[kind]);
  if (!force && _catsetDefReq[kind]) return _catsetDefReq[kind];
  _catsetDefReq[kind] = api('defList', { query: { kind: kind, all: 1 } })
    .then(function (reply) {
      CATSET_DEFS[kind] = ((reply && reply.definitions) || []).map(function (item) {
        return {
          id: item.definition_id,
          name: item.name,
          sub: item.sub_kind || '',
          status: item.status || 'draft',
          note: item.note || '',
          rules: item.rules || {},
          governance: item.governance || null, // the jurisdiction's, not this entity's — shown, never edited
          network: item.network || null
        }; // a brand's offer: do its stores have it (app.html netRelChip)
      });
      _catsetDefReq[kind] = null;
      return CATSET_DEFS[kind];
    })
    .catch(function () {
      _catsetDefReq[kind] = null;
      return (CATSET_DEFS[kind] = []);
    });
  return _catsetDefReq[kind];
}
/* ⚠️ REUSES THE DEFINITIONS FORM. cbDefNew/cbDefEdit already know every kind and its conditions, read straight
   from the registries (offers.js KINDS, cart-ui MODELS). A second form here would drift from the engine within a
   release — the same reason catalogue-ui delegates its category chips instead of copying them. */
function catsetDefNew(kind) {
  ensureCap('definitions').then(function () {
    cbDefNew(kind);
  });
}
function catsetDefEdit(kind, id) {
  ensureCap('definitions').then(function () {
    cbDefEdit(id);
  });
}
/* Live ⇄ draft from here; the definitions capability owns the write and refreshes both lists. */
function catsetDefStatus(id, status) {
  ensureCap('definitions').then(function () {
    cbDefSetStatus(id, status);
  });
}
function catsetDefRetire(kind, id, name) {
  /* cbDefAfterChange (in the definitions capability) refreshes this list too once the retire lands — no timer. */
  ensureCap('definitions').then(function () {
    cbDefRetire(id, name);
  });
}
/** The shared list body for a definition-backed section. */
function catsetDefListHTML(kind, one) {
  var rows = CATSET_DEFS[kind];
  if (rows === undefined) {
    catsetDefsLoad(kind).then(catsetPaintDetail);
    return '<div class="catset-load">reading…</div>';
  }
  if (!rows.length) return '<div class="catset-none">None yet.</div>';
  /* ⭐ THE JURISDICTION'S ROWS ARE LISTED FIRST AND NEVER EDITED. Athi, 2026-09-04: "why each entity should create one
     for them … it has to come from governance layer." A governed slab shows where it comes from and offers no
     Edit / Retire / Make live — to differ from it, a person declares a slab of their own below. */
  var list = rows.filter(function (item) {
    return item.governance;
  });
  var live = rows.filter(function (item) {
    return !item.governance && item.status !== 'retired';
  });
  var ret = rows.filter(function (item) {
    return !item.governance && item.status === 'retired';
  });
  var row = function (d) {
    if (d.governance) {
      var g = d.governance;
      return (
        '<div class="catset-drow gov" data-testid="catset-' +
        kind +
        '-' +
        esc(d.id) +
        '" style="opacity:.85">' +
        '<span class="dn">' +
        esc(d.name) +
        '</span>' +
        '<span class="dst live" title="' +
        esc(tx('Declared by the jurisdiction — inherited, not editable here')) +
        '">' +
        esc(((g.jurisdiction || '') + ' ' + (g.scheme || '')).trim()) +
        ' · ' +
        esc(tx('governance')) +
        '</span>' +
        '</div>'
      );
    }
    return (
      '<div class="catset-drow' +
      (d.status === 'retired' ? ' ret' : '') +
      '" data-testid="catset-' +
      kind +
      '-' +
      esc(d.id) +
      '">' +
      '<span class="dn">' +
      esc(d.name) +
      '</span>' +
      catsetDefRowDetail(kind, d) +
      (d.sub ? '<code class="dk">' + esc(d.sub) + '</code>' : '') +
      '<span class="dst ' +
      esc(d.status) +
      '">' +
      esc(d.status) +
      '</span>' +
      (kind === 'offer' && d.status === 'live' && typeof netRelChip === 'function' ? netRelChip(d.network, d.id) : '') +
      /* ⭐ REINSTATE. Athi, 2026-09-05: "only option to retire is there, but there is no way to reinstate" — a retired
         row goes back to live from here; products that still cite it resolve again on the next paint. */
      (d.status === 'retired'
        ? '<span data-cbsid="CAT004-C01" class="da" data-testid="catset-' +
          kind +
          '-reinstate-' +
          esc(d.id) +
          '" onclick="catsetDefStatus(\'' +
          esc(d.id) +
          "','live')\">" +
          tx('Reinstate') +
          '</span>'
        : /* ⭐ THE STATUS SWITCH, HERE TOO. Athi, 2026-09-03: *"how will you attach to a product?"* — a product's
             Offers tab lists LIVE offers only, and this list had Edit and Retire but no way to go live, so a
             draft authored here could never reach a product without a detour through Definitions. */
          '<span data-cbsid="CAT004-C02" class="da" data-testid="catset-' +
          kind +
          '-live-' +
          esc(d.id) +
          '" onclick="catsetDefStatus(\'' +
          esc(d.id) +
          "','" +
          (d.status === 'live' ? 'draft' : 'live') +
          '\')">' +
          (d.status === 'live' ? tx('Back to draft') : tx('Make live')) +
          '</span>' +
          '<span data-cbsid="CMP012" class="da" onclick="catsetDefEdit(\'' +
          kind +
          "','" +
          esc(d.id) +
          '\')">' +
          tx('Edit') +
          '</span>' +
          '<span data-cbsid="CAT004-C03" class="da" onclick="catsetDefRetire(\'' +
          kind +
          "','" +
          esc(d.id) +
          "','" +
          esc(String(d.name).replace(/'/g, '')) +
          '\')">' +
          tx('Retire') +
          '</span>') +
      /**
       * ⚠️⚠️ THE AUTHOR'S NOTE, WHICH NOTHING HAS EVER SHOWN. Athi, 2026-09-03: *"note — where will it
       * reflect?"* — nowhere. It was written on the form, saved on the definition, and read back only by the
       * form itself, so it was a field that swallowed what you typed. This is the list it belongs on: the
       * author's own, beside the offer it is about, and never anywhere a buyer looks.
       */
      (d.note ? '<div class="dnote">' + esc(d.note) + '</div>' : '') +
      '</div>'
    );
  };
  /**
   * ⚠️⚠️ ORPHANS ARE SURFACED, NEVER SILENTLY BROKEN (backlog 18). Narrowing a catalogue's selling method
   * strands any order model already using a kind the new method cannot sell. Those definitions still exist and
   * still work on lines that reference them — so the honest move is to SAY SO, not to hide them from the list
   * (which would read as "deleted") and not to rewrite them (which would change what a product means without
   * anyone asking).
   * ⚠️ This REPORTS. It does not enforce, and deciding what should happen to an orphan is a product call that
   * has deliberately not been made here.
   */
  var orphanNote = '';
  if (kind === 'ordermodel' && typeof CBCatalogue !== 'undefined' && CBCatalogue.orphanModels) {
    var meth = (typeof UI !== 'undefined' && UI.catf && UI.catf.method) || null;
    var used = live
      .map(function (item) {
        return item.sub;
      })
      .filter(Boolean);
    var orph = meth ? CBCatalogue.orphanModels(meth, used) : [];
    if (orph.length) {
      var uniq = orph.filter(function (item, index) {
        return orph.indexOf(item) === index;
      });
      orphanNote =
        '<div style="background:var(--gold-soft);border:1px solid var(--gold-line);border-radius:9px;padding:9px 11px;font-size:var(--fs-1);color:var(--warn-3);margin-bottom:9px">' +
        '⚠️ <b>' +
        uniq.length +
        ' order model' +
        (uniq.length === 1 ? '' : 's') +
        ' this catalogue can no longer sell</b> — ' +
        uniq
          .map(function (x) {
            return '<code>' + esc(x) + '</code>';
          })
          .join(' · ') +
        '. A <b>' +
        esc(meth) +
        '</b> catalogue does not support ' +
        (uniq.length === 1 ? 'it' : 'them') +
        '. ' +
        'They still work on products that already use them; nothing has been changed or removed. ' +
        'Either change the selling method back, or move those products onto a supported model.</div>';
    }
  }
  return orphanNote + '<div class="catset-dlist">' + list.map(row).join('') + live.map(row).join('') + ret.map(row).join('') + '</div>';
}

function catsetSec() {
  if (!CATSET.sec && typeof UI !== 'undefined' && UI.catsetWant) {
    CATSET.sec = UI.catsetWant;
  }
  if (typeof UI !== 'undefined') UI.catsetWant = null;
  return CATSET.sec || 'blueprint';
}
function catsetSetSec(k) {
  CATSET.sec = k;
  if (UI.vp === 'mob') {
    UI.mdetail = true;
    var node = document.getElementById('panel');
    if (node) node.classList.add('showdetail');
  }
  catsetPaint();
}
function catsetBack() {
  UI.mdetail = false;
  var node = document.getElementById('panel');
  if (node) node.classList.remove('showdetail');
}

/** a ui.field handler for a compact row control: calls fn(...args, value) with the value the field read */
function catsetOn(fn) {
  var args = Array.prototype.slice.call(arguments, 1);
  return function (value) {
    return fn.apply(null, args.concat([value]));
  };
}
/** the name a column row shows (its label, else its key) */
function catsetColName(c) {
  return String(c.field_name || c.field_key);
}
/** the rename box of a column row saves the new label */
function catsetRename(key, value) {
  return catsetFieldPatch(key, { field_name: value });
}
/** the name of a plan row for a screen reader: its number and its product (or every product), so each From and To is its own */
function catsetPlanLabel(item, prods, index) {
  var made = (prods || []).filter(function (p) {
    return (p.item_id || p.id) === item.product;
  })[0];
  return '#' + (index + 1) + ' ' + (made ? (made.item_data || made).name || '' : tx('every product'));
}
/** a plan row's From / To date */
function catsetPlanDate(index, prop, value) {
  CATSET_PLAN[index][prop] = value;
}
/**
 * ⭐ THE VOCABULARY BLOCKS — rehomed from Definitions, NOT copied out of it.
 *
 * Athi, 2026-08-16: *"before dropping find home for all the items we have got it here, once it gets the home,
 * then we can drop it."* So each of the nine read-only registry sections now renders under the control it
 * describes, and Definitions can go.
 *
 * ⚠️ THE ROWS STILL COME FROM `cbDefRegistries()`, which still reads the live registries (cart-ui MODELS,
 * offers.js KINDS, catalogue-model UNITS/DATATYPES/METHODS/FACETS/PRICING_MODELS/PRICE_ORIGIN). Re-listing any of
 * them here would create a second statement of what the system supports, and the second one is always the one
 * that goes stale. Add a unit to catalogue-model tomorrow and it appears here with no edit to this file — the
 * same discipline Definitions itself was built on.
 *
 * ⚠️ VISIBLE, NOT FOLDED — Athi asked for that explicitly. Someone meeting "tiered pricing" for the first time
 * should not have to know to expand something to find out what the options are.
 */
function catsetRegistry(keys) {
  if (typeof cbDefRegistries !== 'function') {
    ensureCap('definitions').then(function () {
      catsetPaintDetail();
    });
    return '<div class="catset-load">reading the registry…</div>';
  }
  var all = cbDefRegistries(),
    want = {};
  keys.forEach(function (item) {
    want[item] = 1;
  });
  var secs = all.filter(function (item) {
    return want[item.key];
  });
  if (!secs.length) return '';
  return secs
    .map(function (item) {
      var rows = item.rows || [];
      /**
       * ⭐ TICK WHAT THIS ENTITY ACTUALLY USES (Athi, 2026-08-17: *"also the check box wherever required, so those
       * only can be used in the catalogue"*). The registry in code is the MAXIMUM; the ticks are this entity's
       * slice, and every picker downstream offers only the slice.
       *
       * ⚠️ ONLY WHERE A CHOICE CAN MEAN SOMETHING — see CATSET_SELECTABLE. `method` is ONE per catalogue, so a set
       * would imply you can have several; `ordermodel` is already narrowed by the selling method (backlog 18) and a
       * second, independent narrowing could disagree with the first with nothing on screen to say which won. A
       * checkbox that cannot mean anything is worse than no checkbox.
       */
      var flag = CATSET_SELECTABLE[item.key];
      var sel = flag ? _CATSEL[flag] : null;
      if (flag && sel === undefined) {
        catsetSelLoad();
      }
      var picked = Array.isArray(sel) ? sel : null;
      var n = picked ? picked.length : rows.length;
      return (
        '<div class="catset-reg">' +
        '<div class="catset-regh">' +
        item.icon +
        ' ' +
        esc(item.title) +
        '<span class="catset-regn">' +
        (picked ? n + ' / ' + rows.length : rows.length) +
        '</span></div>' +
        '<div class="catset-regb">' +
        esc(item.blurb) +
        (flag ? ' <b>' + tx('Tick the ones you use') + '</b> — only those are offered when you build a catalogue.' : '') +
        '</div>' +
        (rows.length
          ? /* ⚠️ DO NOT PRINT THE CODE TWICE. Some registries have no separate code — `UNITS` maps to
             `{code:u, label:u}` because a unit IS its own name — so every row rendered "kg kg", "gram gram",
             "litre litre". Fifteen of those reads as a rendering fault, and it makes the reader look for a
             distinction that does not exist. Show the code only where it actually differs from the label. */
            /* Bare words → chips; anything with a code or a note keeps its rows. See the `.chips` rule. */
            /**
             * ⭐ TWO LINES, NOT THREE COLUMNS (Athi, 2026-08-17: *"align properly and any information regarding the
             * particular field can be mentioned below, so it is easier to read"*).
             *
             * ⚠️ The note was a third column competing for the same row, so a long one squeezed the label and a
             * short one left a gap — nothing lined up down the page. Line 1 is the identity (code + name) on a
             * fixed grid so every code and every name align; line 2 is the explanation, indented under the name
             * and in its own colour so the eye can skip it or read it, but never confuse it with a name.
             */
            '<div class="catset-regrows' +
            (rows.every(function (entry) {
              return !entry.note && String(entry.code || '') === String(entry.label || '');
            })
              ? ' chips'
              : '') +
            '">' +
            rows
              .map(function (entry) {
                var same = String(entry.code || '') === String(entry.label || '');
                var on = picked ? picked.indexOf(String(entry.code)) >= 0 : true;
                var tag = flag ? 'label' : 'div';
                return (
                  '<' +
                  tag +
                  ' class="catset-regrow' +
                  (same ? ' nocode' : '') +
                  (flag ? ' pick' : '') +
                  (on ? '' : ' off') +
                  '">' +
                  '<div class="rr1">' +
                  (flag
                    ? ui.field({ mount: 'CAT004-U01', kind: 'checkbox', density: 'compact', key: flag + '-' + entry.code, label: 'Pick', of: entry.label || entry.code, value: on,
                        onChange: catsetOn(catsetSelToggle, flag, entry.code) })
                    : '') +
                  (same ? '' : '<code>' + esc(entry.code) + '</code>') +
                  '<span class="rl">' +
                  esc(entry.label || entry.code || '') +
                  '</span>' +
                  '</div>' +
                  (entry.note ? '<div class="rn">' + esc(entry.note) + '</div>' : '') +
                  '</' +
                  tag +
                  '>'
                );
              })
              .join('') +
            '</div>'
          : '<div class="catset-none">not loaded</div>') +
        /* Naming the source file is the honest half: it says this list is READ, not authored here, so nobody goes
         looking for an edit button that should not exist. */
        '<div class="catset-regsrc">read from <code>' +
        esc(item.source) +
        '</code></div>' +
        '</div>'
      );
    })
    .join('');
}

/* ── the sections ────────────────────────────────────────────────────────────────────────────────────────────── */
/**
 * ⚠️ NEVER PRINT THE SECTION'S OWN SUBTITLE TWICE. The detail header already shows the section's `q`, and three
 * cards opened by repeating it verbatim one line below — "One product, several sizes" under "One product,
 * several sizes" (variants, offers, storefront). Two identical sentences a line apart read as a rendering fault,
 * and they cost the reader a beat working out whether the second one says something new.
 *
 * ⚠️ Suppressed rather than rewritten: the card titles that DO differ (pricing, order models, import) are
 * carrying real information and are left exactly as they are. Inventing new copy for the other three would be a
 * content change wearing a layout change's clothes.
 */
/* ═══ UNITS OF MEASURE — grouped, aligned, and SELECTABLE ═══════════════════════════════════════════════════
 * Athi, 2026-08-17: *"what left kg is and what right kg is, your just repeated, i am not sure of the meaning.
 * so declaration and presentation?"* → *"can be segregated based on weight, liquid, count"* → *"here we have to
 * give selection as well, so what has been selected will be used in the catalogue."*
 *
 * ⚠️ HE WAS RIGHT THAT IT MEANT NOTHING. A unit was a bare string and this rendered `{code:u, label:u}` — the
 * SAME value in two columns. There was no declaration/presentation split to explain; there was one value shown
 * twice. Now the columns are genuinely different things:
 *     CODE   `kg`         stored on the line, travels on the chit, never shown to a customer
 *     UNIT   `Kilogram`   what a person reads
 *     ALSO   `கிலோ · kilo` spellings that fold onto this unit when a message arrives (lib/units.js)
 *
 * ⚠️ GROUPED BY WHAT THEY MEASURE, and the last group is the point: within Weight or Volume the ratios are
 * universal, within Pack they are not — a box is only so many kg because THIS seller says so. That is the same
 * line consolidate.js draws when it refuses to invent a conversion.
 */
/**
 * ⚠️ WHICH REGISTRIES CAN BE NARROWED, and why the two absentees are absent.
 *   `method`     — ONE selling method per catalogue. A set implies several; you cannot have several.
 *   `ordermodel` — already narrowed by the selling method (METHOD_MODELS, backlog 18). A second, independent
 *                  narrowing could disagree with the first, and nothing on screen would say which one won.
 * registry key → the policy flag that holds this entity's slice.
 */
var CATSET_SELECTABLE = {
  datatype: 'datatypes',
  pricing: 'pricing_models',
  priceorigin: 'price_origins',
  offer: 'offer_kinds',
  facet: 'facets'
};
var _CATSEL = {}; // flag → chosen codes, as last read (undefined = not read yet)
var _catselReq = null;
/* ⚠️ ONE READ FOR EVERY REGISTRY ON THE SCREEN. Five registries asking for the same policy document five times
   would be five round trips for one answer, and they would arrive out of order. */
async function catsetSelLoad(force) {
  if (_catselReq && !force) return _catselReq;
  _catselReq = api('policyGet')
    .then(function (reply) {
      var flags = (reply && reply.flags) || {};
      Object.keys(CATSET_SELECTABLE).forEach(function (item) {
        var fl = CATSET_SELECTABLE[item];
        _CATSEL[fl] = Array.isArray(flags[fl]) ? flags[fl] : [];
      });
      _catselReq = null;
      catsetPaintDetail();
    })
    .catch(function () {
      _catselReq = null;
    });
  return _catselReq;
}
async function catsetSelToggle(flag, code, on) {
  var list = _CATSEL[flag] || [];
  var next = list.filter(function (x) {
    return x !== code;
  });
  if (on) next.push(code);
  /* ⚠️ Same refusal as units, and for the same reason: an empty set is what an accidental clear-all looks like,
     and honouring it would empty a picker in the product form with nothing on screen to explain why. */
  if (!next.length) {
    if (typeof toast === 'function') toast('Keep at least one — the catalogue needs something to offer.');
    catsetPaintDetail();
    return;
  }
  _CATSEL[flag] = next;
  catsetPaintDetail();
  var body = {};
  body[flag] = next;
  try {
    await api('policySet', { body: body });
  } catch (e) {
    if (typeof toast === 'function') toast('Could not save that — ' + ((e && e.message) || 'try again'));
    catsetSelLoad(true);
  }
}

var _UNITSEL = null; // the entity's chosen units, as last read
/**
 * ⭐⭐ WHAT EACH CHOSEN UNIT ALLOWS — { kg: { decimals, tol, min_qty } } — as last read.
 * Athi, 2026-09-12: *"for each entity we can set decimal allowed, if so tollerance and min qty... and each
 * product obeys that."* ⚠️ Kept beside `_UNITSEL` because they are one screen and one save; two states that
 * can disagree about the same unit is how a switch stops matching what the cart does.
 */
var _UNITRULES = null;
/**
 * ⚠️⚠️ A COUNT CANNOT BE HALF — Athi: *"no, the count cannot be half"*. So the three questions are asked ONLY
 * for units that can be halved, and the row for a countable unit says so instead of offering a switch nobody
 * should be able to flip. The kinds come from the catalogue model, not a second list here.
 */
var _MEASURED_KINDS = ['Weight', 'Volume', 'Length', 'Area'];
function catsetUnitMeasured(u) {
  var M = typeof CBCatalogue !== 'undefined' ? CBCatalogue : null;
  if (!M || typeof M.unitKind !== 'function') return false;
  var k = M.unitKind(u);
  return !!k && _MEASURED_KINDS.indexOf(k.label || k.key) >= 0;
}
/** the effective answer for a unit: what is declared, else what its kind implies — the cart's own fallback */
function catsetUnitRule(u) {
  var r = (_UNITRULES && _UNITRULES[u]) || null;
  return {
    decimals: r && r.decimals != null ? !!r.decimals : catsetUnitMeasured(u),
    tol: r && r.tol != null ? Number(r.tol) : 0.01,
    min_qty: r && r.min_qty != null ? Number(r.min_qty) : 0,
    declared: !!r
  };
}
var _LANGSEL = ['en']; // the entity's languages — a READING preference, never a parsing rule

/**
 * ⭐ THE LANGUAGE BAR (Athi, 2026-08-17: *"language picker comes from the entity settings, the same can be shown
 * here and modify as well"*). Reads the entity's `languages` policy flag and lets it be changed in place, so the
 * setting has one home and two doors.
 *
 * ⚠️⚠️ IT CHANGES WHAT IS LISTED, NOT WHAT IS UNDERSTOOD — said on screen, because the opposite is exactly what
 * a reasonable person would assume. Every spelling in every language still folds; a Tamil message resolves
 * whether or not Tamil is ticked here.
 * ⚠️ English is not removable. It is the fallback every list falls back to, and a units screen with no readable
 * column at all is not a state worth being able to reach.
 */
function catsetLangBar() {
  var M = typeof CBCatalogue !== 'undefined' ? CBCatalogue : null;
  var langs = (M && M.UNIT_LANGS) || [];
  if (!langs.length) return '';
  var have = {};
  /* Mark the languages we actually hold spellings for, so an empty pick is explained rather than puzzling. */
  Object.keys((M && M.UNIT_ALIASES) || {}).forEach(function (item) {
    Object.keys(M.UNIT_ALIASES[item] || {}).forEach(function (lg) {
      if ((M.UNIT_ALIASES[item][lg] || []).length) have[lg] = 1;
    });
  });
  var chip = function (l) {
    var on = _LANGSEL.indexOf(l.code) >= 0,
      fixed = l.code === 'en';
    return (
      '<span data-cbsid="CAT004-C04" class="lang-chip' +
      (on ? ' on' : '') +
      (fixed ? ' fixed' : '') +
      '"' +
      (fixed ? ' title="English always shows — it is what every list falls back to"' : ' onclick="catsetLangToggle(\'' + esc(l.code) + '\')"') +
      '>' +
      (on ? '✓ ' : '') +
      esc(l.label) +
      (have[l.code] ? '' : '<span class="lang-none">no words yet</span>') +
      '</span>'
    );
  };
  var groups = ['Common', 'Indian', 'Foreign']
    .map(function (item) {
      var list = langs.filter(function (l) {
        return l.group === item;
      });
      if (!list.length) return '';
      return '<div class="lang-g"><span class="lang-gh">' + esc(item) + '</span>' + list.map(chip).join('') + '</div>';
    })
    .join('');
  return (
    '<div class="lang-bar">' +
    groups +
    '<div class="lang-note">⚠️ This changes what is <b>listed</b>, not what is <b>understood</b> — every ' +
    'spelling in every language still folds onto its unit when a message arrives. ' +
    '<b>no words yet</b> means nobody has sent one in that language; the list grows from real messages, ' +
    'not from a dictionary.</div></div>'
  );
}
async function catsetLangToggle(code) {
  if (code === 'en') return; // the fallback is not removable — see above
  var next = _LANGSEL.filter(function (x) {
    return x !== code;
  });
  if (next.length === _LANGSEL.length) next.push(code);
  if (next.indexOf('en') < 0) next.unshift('en');
  _LANGSEL = next;
  catsetPaintDetail();
  try {
    await api('policySet', { body: { languages: next } });
  } catch (e) {
    if (typeof toast === 'function') toast('Could not save the language choice — ' + ((e && e.message) || 'try again'));
  }
}

/**
 * ── ⭐⭐⭐ WHAT THIS UNIT ALLOWS ──────────────────────────────────────────────────────
 *
 * Athi, 2026-09-12: *"catalogue set-up, units of measure, each unit, we can ask those parameter"* ·
 * *"decimal allowed, default yes"* · *"no, the count cannot be half"* · *"round is good, basically floor"*.
 *
 * ⚠️⚠️ THIS IS NOT THE TOLERANCE ON THE COUNTER, and the words have to keep them apart. That one asks
 * *"ordered 1000 kg, 998 arrived — is that a dispute?"* and is a percentage. This one asks *"the scale reads
 * 1.010 — what goes on the bill?"* and is flat. Calling both "tolerance" would cost somebody an afternoon.
 *
 * ⭐ ROUNDING IS DOWNWARD ONLY, and the sentence says so: the excess above a whole number is dropped, the
 * shortfall below one is kept, so a customer is never billed for grams the scale did not weigh.
 */
function catsetUomRuleHTML(u) {
  if (!catsetUnitMeasured(u)) {
    /* ⚠️ Said, not hidden. A row that simply lacks the controls reads as an oversight; this reads as a rule. */
    return '<div class="uom-rule flat"><span class="urn">Whole numbers — a count cannot be half.</span></div>';
  }
  var r = catsetUnitRule(u),
    id = 'uomr_' + u;
  return (
    '<div class="uom-rule">' +
    '<label class="urk">' +
    ui.field({ mount: 'CAT004-U02', kind: 'checkbox', density: 'compact', key: u, label: 'Decimal allowed', of: u, value: r.decimals, onChange: catsetOn(catsetUomRuleSet, u, 'decimals') }) +
    ' ' +
    tx('Decimal allowed') +
    '</label>' +
    (r.decimals
      ? '<span class="urf"><label for="' +
        id +
        '_t">' +
        tx('Round down within') +
        '</label>' +
        ui.field({ mount: 'CAT004-U03', kind: 'number', density: 'compact', id: id + '_t', min: '0', step: '0.001', label: 'Round down within', of: u, value: String(r.tol), testid: 'uom-tol-' + u,
        onChange: catsetOn(catsetUomRuleSet, u, 'tol') }) +
        '<span class="uru">' +
        esc(u) +
        '</span></span>' +
        '<span class="urf"><label for="' +
        id +
        '_m">' +
        tx('from') +
        '</label>' +
        ui.field({ mount: 'CAT004-U04', kind: 'number', density: 'compact', id: id + '_m', min: '0', step: '0.001', label: 'from', of: u, value: String(r.min_qty), testid: 'uom-min-' + u,
        onChange: catsetOn(catsetUomRuleSet, u, 'min_qty') }) +
        '<span class="uru">' +
        esc(u) +
        '</span></span>' +
        '<span class="urn">' +
        txf('{ex} becomes {r} — downward only, so {lo} stays {lo}.', {
          ex: '<b>' + esc(String(1 + (Number(r.tol) || 0))) + '</b>',
          r: '<b>1</b>',
          lo: '<b>0.995</b>'
        }) +
        '</span>'
      : '<span class="urn">' + tx('Whole numbers only for this unit.') + '</span>') +
    '</div>'
  );
}

/**
 * ⚠️ ONE FIELD AT A TIME, MERGED — never a whole-object PUT. Sending the map back wholesale would carry every
 * other unit's row with it, and a second tab's edit would be overwritten by whatever this tab last read.
 * [[feedback-partial-writes-merge-patch]]
 */
async function catsetUomRuleSet(u, field, value) {
  _UNITRULES = _UNITRULES || {};
  var row = _UNITRULES[u] || {};
  if (field === 'decimals') row.decimals = !!value;
  else {
    var n = Number(value);
    if (!isFinite(n) || n < 0) {
      if (typeof toast === 'function') toast('That needs to be a number, zero or more.');
      return;
    }
    row[field] = n;
  }
  /* ⭐ a row that has been touched declares all three, so what the cart reads is what the screen showed */
  var eff = catsetUnitRule(u);
  if (row.decimals == null) row.decimals = eff.decimals;
  if (row.tol == null) row.tol = eff.tol;
  if (row.min_qty == null) row.min_qty = eff.min_qty;
  _UNITRULES[u] = row;
  /* ⚠️ the SWITCH repaints the row (its two boxes appear or go); a number does not — repainting under a
     cursor is how a half-typed value is lost. [[feedback-repaint-locally]] */
  if (field === 'decimals') catsetPaintDetail();
  try {
    await api('policySet', { body: { unit_rules: _UNITRULES } });
  } catch (e) {
    if (typeof toast === 'function') toast('Could not save that — ' + ((e && e.message) || 'try again'));
    catsetUnitsLoad();
  }
}

function catsetUnitsHTML() {
  var M = typeof CBCatalogue !== 'undefined' ? CBCatalogue : null;
  if (!M || !M.UNIT_KINDS) return catsetCard('⚖️ Units of measure', '<div class="catset-none">not loaded</div>');
  if (_UNITSEL === null) {
    catsetUnitsLoad();
    return catsetCard('⚖️ Units of measure', '<div class="catset-load">reading…</div>');
  }

  var sel = _UNITSEL,
    aliases = M.UNIT_ALIASES || {},
    names = M.UNIT_NAMES || {};
  var groups = M.UNIT_KINDS.map(function (item) {
    var rows = item.units
      .map(function (entry) {
        var on = sel.indexOf(entry) >= 0;
        /* ⭐ THE SPELLINGS GO ON THEIR OWN LINE (Athi: *"each line item below show what the enumerations are"*).
         Squeezed into a right-hand column they were truncated at four and ellipsed — which hid the very thing
         worth seeing, that கிலோ and kilo and kgs all mean this row. On its own line the whole set fits. */
        /* ⚠️ ONLY THE LANGUAGES THIS ENTITY WORKS IN ARE LISTED — but every language is still UNDERSTOOD. The
         picker is a reading aid; lib/units.js folds all of them regardless. A screen set to Hindi that stopped
         `கிலோ` resolving would be a parsing rule wearing a preference's clothes. */
        var by = aliases[entry] || {};
        var shown = _LANGSEL.reduce(function (sum, element) {
          return sum.concat(
            (by[element] || []).map(function (record) {
              return { w: record, lg: element };
            })
          );
        }, []);
        return (
          '<label class="uom-row' +
          (on ? '' : ' off') +
          '">' +
          '<div class="ur1">' +
          ui.field({ mount: 'CAT004-U05', kind: 'checkbox', density: 'compact', key: entry, label: 'Use', of: entry, value: on, onChange: catsetOn(catsetUnitToggle, entry) }) +
          '<code>' +
          esc(entry) +
          '</code>' +
          '<span class="un">' +
          esc(names[entry] || entry) +
          '</span>' +
          '</div>' +
          /* ⚠️ THE SEPARATOR IS DECORATION, AND MUST SAY SO. It is a faint `·` between spellings — deliberately
           low-contrast, because it divides rather than informs. Unmarked it is counted as unreadable TEXT by any
           contrast audit (63 false positives on this screen alone) and, worse, a screen reader announces
           "middle dot" between every word. aria-hidden states what it already is. */
          (shown.length
            ? '<div class="ua">' +
              shown
                .map(function (x) {
                  return esc(x.w);
                })
                .join('<span class="sep" aria-hidden="true">·</span>') +
              '</div>'
            : '') +
          '</label>' +
          /**
           * ⭐⭐ THE THREE ANSWERS, ONLY WHERE THEY MEAN SOMETHING, and only for a unit actually in use.
           * ⚠️ OUTSIDE the <label>: a number box inside a label toggles the checkbox on every click.
           */
          (on ? catsetUomRuleHTML(entry) : '')
        );
      })
      .join('');
    return '<div class="uom-g"><div class="uom-gh">' + esc(item.label) + '</div>' + rows + '</div>';
  }).join('');

  var n = sel.length,
    total = M.UNIT_KINDS.reduce(function (sum, item) {
      return sum + item.units.length;
    }, 0);
  return catsetCard(
    '⚖️ Units of measure',
    '<div class="catset-regb">What a quantity is counted in. <b>' +
      tx('Tick the ones you trade in') +
      '</b> — the product form ' +
      'and the catalogue wizard offer only those. <b>' +
      n +
      ' of ' +
      total +
      '</b> selected.</div>' +
      catsetLangBar() +
      '<div class="uom-hd"><span></span><code>code</code><span class="un">unit</span></div>' +
      groups +
      /* ⚠️ Say what deselecting does NOT do. Someone reasonably fears that unticking `barrel` breaks the products
       already priced in barrels; saying so up front is cheaper than them not daring to touch it. */
      '<div class="catset-src">' +
      txf(
        'Unticking stops a unit being {offered}. Products already saved in it keep it — nothing is rewritten. Spellings under {also} fold onto the unit when a message arrives.',
        {
          offered: '<b>' + tx('offered') + '</b>',
          also: '<i>' + tx('also accepted') + '</i>'
        }
      ) +
      '</div>'
  );
}
async function catsetUnitsLoad() {
  try {
    var reply = await api('policyGet');
    var fl = (reply && reply.flags) || {};
    _UNITSEL = fl.units || [];
    _UNITRULES = fl.unit_rules && typeof fl.unit_rules === 'object' ? fl.unit_rules : {};
    /* ⚠️ English is forced in even if the stored set somehow lacks it — see catsetLangBar(). */
    var list = Array.isArray(fl.languages) && fl.languages.length ? fl.languages.slice() : ['en'];
    if (list.indexOf('en') < 0) list.unshift('en');
    _LANGSEL = list;
  } catch (e) {
    _UNITSEL = [];
  }
  catsetPaintDetail();
}
/**
 * ⭐ CTR-212 S0 · "CHECK PRICES AGAIN BEFORE EVERY BILL" — ASKED, NOT ASSUMED. policy_flags.recheck_prices through the ONE settings write (PATCH /entities/policy, policySet);
 * the server says whether it was ANSWERED (GET /entities/policy `asked`), so an owner who never answered sees "Not answered yet", never "Off", and no button is pre-selected.
 * Same setting as Settings › Policy (one flag, two doors). UI ids: catset-recheck (card) · catset-recheck-yes · catset-recheck-no · catset-recheck-state; mount path
 * cap-catsetup › Pricing › catsetRecheckCard (the register rows go to SCREENS.json with the docs PR).
 * CATSET_RECHECK: undefined = not read yet · null = not answered · 'on' | 'off'.
 */
var CATSET_RECHECK;
async function catsetRecheckLoad() {
  try {
    var reply = await api('policyGet');
    var answered = ((reply && reply.asked) || {}).recheck_prices === true;
    CATSET_RECHECK = answered ? ((reply && reply.flags) || {}).recheck_prices : null;
  } catch (e) {
    if (typeof toast === 'function') toast('Could not read this rule — ' + ((e && e.message) || 'try again'));
    CATSET_RECHECK = undefined;
    return;
  }
  catsetPaintDetail();
}
/** the question card: two buttons, none chosen until the owner answers; what is saved is said beside them */
function catsetRecheckCard() {
  if (CATSET_RECHECK === undefined) catsetRecheckLoad();
  var state = CATSET_RECHECK === 'on' ? tx('Yes, every bill') : CATSET_RECHECK === 'off' ? tx('No, only old parked bills') : tx('Not answered yet');
  var pick = function (value, label) {
    return '<button data-cbsid="CAT004-B01" class="composebtn' + (CATSET_RECHECK === value ? ' pri' : '') + '" data-testid="catset-recheck-' + (value === 'on' ? 'yes' : 'no') + '" data-ui-id="catset-recheck-' + (value === 'on' ? 'yes' : 'no') + '" aria-pressed="' + (CATSET_RECHECK === value) + '" onclick="catsetRecheckSet(this,\'' + value + '\')">' + tx(label) + '</button>';
  };
  return catsetCard(
    tx('Check prices before each bill'),
    tx('Do your prices change often? Check them again before each bill.') + '<div class="sub" id="catset_recheck_out" data-testid="catset-recheck-state" data-ui-id="catset-recheck-state">' + state + '</div>',
    pick('on', 'Yes') + pick('off', 'No')
  );
}
function catsetRecheckSet(button, value) {
  return CBAction.run(
    button,
    function () {
      return api('policySet', { body: { recheck_prices: value } });
    },
    {
      key: 'catset-recheck-save',
      confirm: { title: value === 'on' ? tx('Check every bill?') : tx('Check old parked bills only?'), body: '', yes: tx('Save'), danger: false },
      out: 'catset_recheck_out',
      busy: tx('Saving…'),
      outcome: function () {
        CATSET_RECHECK = value;
        catsetPaintDetail();
      }
    }
  );
}
async function catsetUnitToggle(u, on) {
  var next = (_UNITSEL || []).filter(function (x) {
    return x !== u;
  });
  if (on) next.push(u);
  /* ⚠️ REFUSE THE EMPTY SET HERE TOO, not only on the server. The server already rejects it, but a silent
     server-side rejection would leave the box unticked on screen and the value unchanged underneath — the two
     would disagree and only one of them is real. */
  if (!next.length) {
    if (typeof toast === 'function') toast('Keep at least one unit — the product form needs something to offer.');
    catsetPaintDetail();
    return;
  }
  _UNITSEL = next;
  /* ⭐ OPERATE LOCALLY UNTIL A REPAINT IS ABSOLUTELY REQUIRED (Athi, 2026-09-04). The box the person clicked has
     already flipped; the set is written; the pane is NOT rebuilt — a rebuild is what threw the page to the top.
     Only a refusal (above) or a failed write (below) repaints, to put the screen back to what is real. */
  try {
    await api('policySet', { body: { units: next } });
  } catch (e) {
    if (typeof toast === 'function') toast('Could not save that — ' + ((e && e.message) || 'try again'));
    catsetUnitsLoad();
  }
}
/**
 * ⚠️ THIS SCREEN NEVER SHOWED WHAT IT HAD DONE. Its two siblings — offers and order models — each list what you
 * created underneath the button. Variants declared a grouping into thin air: no list, no current state, nothing
 * to look at afterwards. Athi opened it and could not tell what the screen was for, which is a fair reading of
 * a page that takes a decision and then shows you nothing.
 *
 * ⚠️ SAME LAZY-LOAD IDIOM as catsetDefListHTML — cache, kick off the read, repaint when it lands. Deliberately
 * not a second pattern: `undefined` means not read yet, `null` means the read failed.
 */
var CATSET_FACE;
/**
 * ⚠️⚠️ A STALE READ MUST NOT CLOBBER A NEWER WRITE — and this one did, visibly.
 *
 * Found 2026-09-03 driving the new Storefront panel: tick `kg`, tick `litre`, and the server ended up holding
 * only `litre`. The read fired when the section opened was still in flight; it landed AFTER both saves and
 * overwrote CATSET_FACE with the face as it had been before either of them. The next save then merged onto
 * that stale object and posted it — so a unit the user had ticked was silently dropped, by the network, with
 * no error anywhere.
 *
 * ⭐ THE GUARD IS A GENERATION, NOT A BUSY FLAG. A flag would only stop a SECOND read starting; the damage is
 * done by a read that started legitimately and finished late. Every local write bumps the generation, and a
 * response from an older generation is discarded — it cannot be newer than what we already hold.
 */
var _catsetFaceGen = 0;
function catsetFaceLoad() {
  var gen = _catsetFaceGen;
  return api('catFaceGet')
    .then(function (reply) {
      if (gen === _catsetFaceGen) CATSET_FACE = (reply && reply.face) || null;
    })
    .catch(function () {
      if (gen === _catsetFaceGen) CATSET_FACE = null;
    });
}
/**
 * Called by _vSave so the card reflects a save without a round trip.
 * ⚠️ It also INVALIDATES any read in flight — see above. Setting the face locally is a statement that what we
 * hold is newer than anything the server was asked for before now.
 */
function catsetFaceSet(f) {
  _catsetFaceGen++;
  CATSET_FACE = f || null;
}
function catsetVariantStateHTML() {
  if (CATSET_FACE === undefined) {
    catsetFaceLoad().then(catsetPaintDetail);
    return '<div class="catset-load">reading…</div>';
  }
  var id = (CATSET_FACE && CATSET_FACE.identity) || {};
  var opts = id.options || [];
  if (!id.group) return '<div class="catset-none">Not grouped yet — every line stands as its own product.</div>';
  return (
    '<div class="catset-drow" data-testid="catset-variant-state">' +
    '<span class="dn">Grouped by <b>' +
    esc(id.group) +
    '</b></span>' +
    (opts.length ? '<code class="dk">told apart by ' + esc(opts.join(', ')) + '</code>' : '<code class="dk">no distinguishing column yet</code>') +
    '<span data-cbsid="CAT004-C05" class="da" onclick="declareVariants()">' +
    tx('Change') +
    '</span></div>'
  );
}
function catsetCard(title, body, actions) {
  var sec = CATSET_SECS.filter(function (x) {
    return x.key === catsetSec();
  })[0];
  var dupe = sec && String(sec.q || '').trim() === String(title || '').trim();
  return (
    '<div class="catset-card">' +
    (dupe ? '' : '<div class="catset-ct">' + title + '</div>') +
    '<div class="catset-cb">' +
    body +
    '</div>' +
    (actions ? '<div class="catset-ca">' + actions + '</div>' : '') +
    '</div>'
  );
}
function catsetBody(k) {
  if (k === 'blueprint') {
    /**
     * ⭐⭐ THE FASTEST WAY IN, SO IT IS THE FIRST THING OFFERED — Athi, 2026-09-02: *"if the user can use the
     * prototype ie blueprint, that sets everything, so possibly we have to showcase prototype to copy if not then
     * go step by step."*
     *
     * ⚠️ COLUMNS USED TO BE THE FIRST PANEL, and that is the wrong order for the commonest case. Adopting a
     * published catalogue sets the columns, the units and the shape in one act — so a merchant who has one
     * available should never be walked through declaring them by hand first. The step-by-step panels below are
     * the FALLBACK, and saying so is the whole point of putting this at the top.
     *
     * ⚠️ IT OPENS THE ADOPTION SCREEN RATHER THAN REBUILDING IT. Adopting takes a source AND a commercials
     * overlay — your own prices over their shared design — and that is a real piece of working UI. Copying it
     * into this panel would be a second implementation of the one thing on this screen that must not disagree
     * with itself. The hub is the entry point; the screen it opens is the detail.
     */
    return (
      catsetCard(
        'Follow another shop’s catalogue',
        'Someone in your trade has published theirs as a <b>reference catalogue</b>. Follow it and your columns, units and ' +
          'shape are set in one act — you put your own prices over their design, and a correction they publish ' +
          'reaches you.' +
          '<div class="catset-std">⭐ <b>Following is not copying.</b> You cite it rather ' +
          'than copy it, so it stays THEIRS to correct. ⚠️ Adopting <b>by reference</b> shares the design and keeps ' +
          'your prices your own; adopting <b>by value</b> takes a copy that stops following them. The screen below ' +
          'asks which.</div>' +
          '<div class="catset-std">⭐ <b>Nobody publishing for your trade?</b> Then start from a <b>product list</b> in the ' +
          'counter’s Product Lab — that one is a COPY that becomes yours — or use the panels below, which are the step-by-step ' +
          'way — columns first, then how a price is arrived at, then how customers order from you.</div>',
        '<button data-cbsid="CAT004-B02" class="composebtn pri" data-testid="catset-blueprint" onclick="catsetBlueprint()">' + tx('📋 See the catalogues you can follow') + '</button>'
      ) + catsetCard('What you have adopted', catsetAdoptedHTML(), '')
    );
  }
  if (k === 'columns') {
    return (
      catsetCard(
        'What every product records',
        'A catalogue starts with three columns — <b>name</b>, <b>unit</b> and <b>price</b>. A trade usually expects ' +
          'more: a grade, an HSN code, a botanical name, a finish. Pick your trade and the columns it expects are ' +
          'added; you can still bring your own from a spreadsheet afterwards.' +
          '<div class="catset-std">In PIM terms this is the <b>family</b> — the template that describes a product. ' +
          '⚠️ A product has <b>one</b> template but can sit in <b>many</b> categories. They are different ' +
          'mechanisms, which is why categories live on their own screen.</div>',
        '<button data-cbsid="CAT004-B03" class="composebtn pri" data-testid="catset-columns" onclick="catcolPick()">' + tx('📐 See the columns your trade expects') + '</button>'
      ) +
      /* Units and datatypes describe what a column can BE — so they sit under the control that adds columns. */
      /* ⭐ WHAT IT RECORDS TODAY, before what it could record — the question a reader arrives with. */
      catsetCard('What your catalogue records today', catsetColsHTML(), '') +
      catsetUnitsHTML() +
      catsetRegistry(['datatype'])
    );
  }
  if (k === 'pricing') {
    return (
      catsetRecheckCard() + catsetCard(
        'How a price is arrived at, and where it came from',
        'A catalogue can declare more than one — a list price, a bulk tier, a regional price, a negotiated one. ' +
          'And a price that was read from somewhere carries <b>where</b> and <b>when</b>.' +
          '<div class="catset-std">⚠️ A price with no source is not wrong, it is just unattributable — and a ' +
          'market-referenced price without a reading date is a rumour. That is the same rule the availability ' +
          'engine applies to a stock figure: a number without a timestamp is not an answer.</div>',
        /* ⭐ THE SAME RULE, MADE PLAYABLE. The lab is the conversion engine as a page — a rate carries its source
         and its date, a quantity is valued at a market price, and the weakest link in the chain is named above
         the total. It belongs HERE because "where and when a price came from" is this card's subject. */
        '<a class="composebtn" data-testid="catset-conversion-lab" href="conversion-lab.html" target="_blank" rel="noopener" title="Value a quantity or convert a basket — same engine as the server, steps shown" style="text-decoration:none">💱 ' +
          tx('Conversion lab') +
          '</a>'
      ) +
      catsetRegistry(['pricing', 'priceorigin']) +
      catsetCard('Your pricing structures', catsetDefListHTML('pricing', 'pricing structure'), '')
    );
  }
  if (k === 'variants') {
    return (
      catsetCard(
        'One product, several sizes',
        'Say which lines belong together — a 1L, 4L and 10L of the same paint, or a saree in three borders. The ' +
          'shop then shows one product with its options instead of three unrelated rows.' +
          '<div class="catset-std">In PIM terms this is the <b>product model</b> and its <b>variant axis</b>: which ' +
          'attribute varies, and which stay common across the group.</div>',
        '<button data-cbsid="CAT004-B04" class="composebtn pri" data-testid="catset-variants" onclick="declareVariants()">' + tx('🔗 Declare variants') + '</button>'
      ) + catsetCard('What you have declared', catsetVariantStateHTML(), '')
    );
  }
  if (k === 'offers') {
    return (
      catsetCard(
        'Discounts, tiers and deals',
        'A percentage, a flat amount, a quantity break, buy-one-get-one, free shipping, or a spend threshold. ' +
          'Publish one and it becomes VISIBLE — on the product row, on your storefront, to a B2B buyer browsing ' +
          'you, and in the basket, where the breakdown shows what came off and, when it does not fire, how far ' +
          'short the order is.' +
          '<div class="catset-std">⚠️ A row states the CONDITION, never a bare discount — <b>"₹170 each from 10"</b>, ' +
          'not "₹170 each" beside a product priced ₹180. A badge is a promise, and one the basket then declines is ' +
          'worse than no badge at all, so an offer that cannot fire today shows nothing anywhere.</div>' +
          '<div class="catset-std">⚠️ An offer is a <b>term of trade</b>, not a product fact — it has an author, a ' +
          'validity window and a jurisdiction, and it has to survive into a dispute intact. That is why it is ' +
          'authored once here rather than edited on a product. <b>' +
          tx('Live') +
          '</b> offers apply; a draft is one you are ' +
          'still writing.</div>',
        /* ⭐⭐⭐ POINTS AT THE REAL LAB NOW (Athi: "we already have an offer lab in catalogue set-up opening the
         existing one, possibly, retire that page and attach the current one"). offer-lab.html is the retired
         tool — offer-lab-next.html is the one actually built against the real offers engine, with your own
         catalogue, saved-offer lifecycle and the price list. The old file is untouched on disk (still linked
         from Conversion lab's own nav and covered by e2e/tests/offer-lab.spec.js) but nothing in the app
         points a shopkeeper at it any more. */
        '<a class="composebtn" data-testid="catset-offer-lab" href="offer-lab-next.html" target="_blank" rel="noopener" title="Design an offer and see what a customer sees — the same engine as the shop" style="text-decoration:none;margin-right:6px">🧪 ' +
          tx('Offer lab') +
          '</a>' +
          /* ⭐ [Labs split, 2026-09-26] its own link beside Offer lab's, straight to the Combo Lab mode (UX-97: no redirect hop) — see combo-lab.html's
         own header comment for why. */
          '<a class="composebtn" data-testid="catset-combo-lab" href="offer-lab-next.html?mode=combo" target="_blank" rel="noopener" title="Build a modifier/combo and preview it exactly as the till will show it" style="text-decoration:none;margin-right:6px">🧩 ' +
          tx('Combo lab') +
          '</a>' +
          '<button data-cbsid="CAT004-B05" class="composebtn pri" data-testid="catset-offer-new" onclick="catsetDefNew(\'offer\')">+ New offer</button>'
      ) +
      catsetCard(
        'The next six months',
        catsetOfferPlanHTML(),
        '<button data-cbsid="CAT004-B06" class="composebtn" data-testid="catset-offer-plan-new" onclick="catsetPlanOpen()">📅 ' + tx('Plan several') + '</button>'
      ) +
      catsetCard('Your offers', catsetDefListHTML('offer', 'offer'), '') +
      catsetRegistry(['offer'])
    );
  }
  if (k === 'ordermodels') {
    return (
      catsetCard(
        'How a quantity is counted',
        'Give a quantity rule a name, and a product adopts “Carton of 6” instead of repeating pack/step 6. The ' +
          'kinds come from the cart itself — whole units, a decimal amount, a pack multiple, a range, a metre, or ' +
          'an offer line where the buyer names their price.' +
          '<div class="catset-std">⚠️ Change “Carton of 6” to 12 and <b>every product using it moves</b> — ' +
          'which is either exactly what you want or a catastrophe. Chits already stamped keep the version they ' +
          'froze, which is why adoption freezes at the mint.</div>',
        '<button data-cbsid="CAT004-B07" class="composebtn pri" data-testid="catset-om-new" onclick="catsetDefNew(\'ordermodel\')">+ New order model</button>'
      ) +
      catsetCard('Your order models', catsetDefListHTML('ordermodel', 'order model'), '') +
      catsetRegistry(['ordermodel'])
    );
  }
  if (k === 'data') {
    return (
      catsetCard(
        'Bring a spreadsheet in',
        'Read a file, see what each column would become, and decide before anything is written. Products are added ' +
          'or updated by their code — re-importing the same sheet updates rather than duplicates.' +
          '<div class="catset-std">⚠️ Nothing is imported until you confirm the column mapping. The check step is ' +
          'not a formality: it is the only place a wrong column is cheap to fix.</div>',
        '<button data-cbsid="CAT004-B08" class="composebtn pri" data-testid="catset-import" onclick="checkCatalogueFile()">🔍 Check &amp; import</button>' +
          '<button data-cbsid="CAT004-B09" class="composebtn" data-testid="catset-template" onclick="downloadCatalogueTemplate(this)">' +
          tx('📄 Blank template') +
          '</button>'
      ) +
      catsetCard(
        'Take it back out',
        'Every product as a spreadsheet, in your catalogue’s own columns — for a backup, an accountant, or another ' + 'system.',
        '<button data-cbsid="CAT004-B10" class="composebtn" data-testid="catset-export" onclick="exportCatalogueCSV(this)">⬇ Export CSV</button>'
      )
    );
  }
  if (k === 'erp') {
    /**
     * ⭐⭐ THE FIELD MAP, AGAINST THE REAL COLUMNS — Athi, 2026-09-02: *"can we get their system catalogue to
     * adjust ours to make it same as theirs so the data can be mapped"* and *"tally compatible, SAP compatible"*.
     *
     * ⚠️ THE WIZARD'S VERSION MAPPED WIZARD STATE — the fields ticked in step 1, which is a list that only exists
     * while the walk is open. This maps what the catalogue ACTUALLY DECLARES, so the map keeps meaning after the
     * setup is over, which is the point of putting it on a panel you return to.
     *
     * ⭐ AND ONE MAP READS BOTH WAYS. Outbound it says "our `code` is their `ITEM_CODE`" so an export lands in
     * their shape; inbound it is the same statement, which is what `csv-preflight.matchHeader` proposes when
     * their spreadsheet arrives. Two mechanisms for one relationship was the finding in the research note above;
     * this is the half that declares it.
     */
    return (
      catsetCard(
        'Where each column lives in your other system',
        'If an ERP, Tally or SAP already holds this, say what it is called there. A connector then knows which of ' +
          'their fields fills which of yours — and an export can leave in their shape rather than ours.' +
          '<div class="catset-std">⭐ <b>One map, read both ways.</b> Outbound it shapes an export for them; ' +
          'inbound it is the same statement a spreadsheet import needs. ⚠️ Declaring a mapping does not move any ' +
          'data — a connector does that, and it is told what to do by this.</div>' +
          '<div class="catset-std">⚠️ <b>Tally and SAP are not the same kind of connection.</b> Tally exchanges ' +
          'masters as a file somebody exports; SAP is a live service an IT department connects. This declares the ' +
          'field names either way; what carries them differs.</div>',
        ''
      ) + catsetCard('Your columns', catsetErpHTML(), '')
    );
  }
  if (k === 'tax') {
    /**
     * ⭐⭐ Athi, 2026-09-03: *"in india tax is not simple, each product has different tax criteria, so it has to be
     * product specific, but there are slabs, so define slab and attach the slab to the product, check how other
     * products are doing"*. Tally, Zoho and Odoo all reached the same shape independently — a named rate is its
     * own record, the product points at it, and an unset product inherits — so that is what this is.
     */
    /* ⭐⭐ REDESIGNED 2026-09-05 — Athi: "this should be bringing all the details like tax applied currently, offers
       attached and any other information related to the product … helps to see the individual breakdown". The
       screen used to explain the rules and list the slabs; it never showed the OUTCOME. Now: what every product
       carries (tax as RESOLVED, from where; offers; HSN; categories) comes first, each row opening the product; the
       slabs carry their counts; the two explanations fold away. */
    return (
      catsetCard(
        'What your products carry',
        catsetTaxRegisterHTML(),
        /* ⭐ CL1 (2026-10-12): the Country lab beside the slabs — what a change of country does to the tax, the year, the chart and the
         return, every row read from the regulation packs; the same Labs rule as Offer / Combo / Conversion (one tab per lab). */
        '<a class="composebtn" data-testid="catset-country-lab" href="country-lab.html" target="cb_country_lab" rel="noopener" title="What changes when the shop\'s country changes — every row read from the regulation packs, the cart billed under both" style="text-decoration:none;margin-right:6px">🌍 ' +
          tx('Country lab') +
          '</a>' +
          '<button data-cbsid="CAT004-B11" class="composebtn pri" data-testid="catset-tax-new" onclick="catsetDefNew(\'tax\')">+ New slab</button>'
      ) +
      catsetCard('Your slabs', catsetTaxCountsHTML() + catsetDefListHTML('tax', 'tax slab'), '') +
      catsetCard('Falls back to', catsetTaxHTML(), '') +
      '<details class="catset-fold"><summary style="cursor:pointer;font-weight:700;padding:8px 0">' +
      tx('How slabs work') +
      '</summary>' +
      catsetCard(
        'Name a rate, then a product cites it',
        'A slab is “GST 18%” with a name. Attach it on a product’s Pricing &amp; tax pane; a product that names ' +
          'none inherits — first from its category, then from the catalogue default.' +
          '<div class="catset-std">⚠️ <b>Blank means INHERIT, never nil-rated.</b> 0% is a real answer (exempt and ' +
          'nil-rated goods) and “nobody has said” is a different one. Nothing here guesses between them.</div>' +
          '<div class="catset-std">⚠️ <b>A rate is not a decision, and we ship none.</b> Which slab a product ' +
          'attracts is per-HSN, changes at every Council meeting, and is yours to state. CB carries what you ' +
          'declared, who declared it and when — and freezes it onto a chit at the mint.</div>',
        ''
      ) +
      '</details>' +
      '<details class="catset-fold"><summary style="cursor:pointer;font-weight:700;padding:8px 0">' +
      tx('GST slab rates (reference)') +
      '</summary>' +
      catsetRegistry(['tax']) +
      '</details>'
    );
  }
  /* ⭐ The storefront controls are REAL here now — see catsetSfHTML. This used to be a paragraph and a button
     that opened the six-step wizard, so the hub owned nine of its ten sections and handed the tenth back. */
  if (k === 'face') return catsetSfHTML();
  return '';
}

/**
 * ── ⭐⭐ THE COLUMNS PICKER — see the set, take part of it, add your own ───────────────────────────────────────
 *
 * Athi, 2026-09-02: *"how we showcased category, similarly is there any chance of showcasing the current standard
 * catalogue here and explain what datatype it is? and add more column if you want."*
 *
 * ⚠️ WHAT WAS HERE WAS A DROPDOWN READING "Trade — 11 columns" AND AN ADD-ALL BUTTON. You could not see which
 * eleven, or what type any of them was, and adopting to get eight left the other three on the template for ever
 * — because a column with data in it must never be removed. A blind all-or-nothing choice is worse for a column
 * than for a category, and the categories screen had already stopped making it.
 *
 * ⭐ SAME SHAPE AS `cbcatSeedPick`, DELIBERATELY. Athi: *"the current catalogue setup panel is good, it is as per
 * our standard design principle."* Two pickers that answer the same question — *what is in this set and which of
 * it do I want* — should be operated the same way, so learning one teaches the other.
 *
 * ⚠️ AND THE DATATYPE IS SHOWN, NOT GUESSED. Nothing infers a type from a field NAME anywhere in this codebase:
 * the starter sets declare it, and a CSV import reads it from the VALUES (`csv-preflight.inferType`) and asks for
 * confirmation. So the type beside each column is a fact being reported, not a suggestion being made.
 */
var CATCOL = { v: null, sel: null, starter: null };

async function catcolPick() {
  var r;
  try {
    r = await api('prodStarters');
  } catch (e) {
    if (typeof toast === 'function') toast((e && e.message) || 'Could not load the standard sets.');
    return;
  }
  var verts = (r && r.verticals) || [];
  if (!verts.length) {
    if (typeof toast === 'function') toast('No standard sets are available.');
    return;
  }
  CATCOL = { v: verts[0].key, sel: null, starter: null };
  modal(
    '<div class="mhd"><div class="t">' +
      tx('📐 Columns your trade expects') +
      '</div>' +
      '<div class="s">' +
      tx('pick the ones you want — you can add more later, but a column with data cannot be removed') +
      '</div></div>' +
      '<div class="mbody">' +
      '<label class="fl">' +
      tx('Trade') +
      '</label>' +
      '<select data-cbsid="CAT004-S01" class="inp" id="catcol_v" data-testid="catcol-trade" onchange="catcolLoad(this.value)">' +
      verts
        .map(function (item) {
          return '<option value="' + esc(item.key) + '">' + esc(item.title) + ' — ' + item.field_count + ' ' + tx('columns') + '</option>';
        })
        .join('') +
      '</select>' +
      '<div id="catcol_body" style="margin-top:10px">' +
      tx('loading…') +
      '</div>' +
      '<div style="margin-top:11px"><label class="fl">' +
      tx('Add your own as well') +
      '</label>' +
      '<div style="display:flex;gap:6px">' +
      ui.field({ mount: 'CAT004-U06', kind: 'text', density: 'compact', id: 'catcol_own', testid: 'catcol-own', cls: 'inp catset-grow', label: 'Add your own as well', placeholder: 'column name' }) +
      '<select data-cbsid="CAT004-S02" class="inp" id="catcol_owntype" data-testid="catcol-own-type" style="width:120px">' +
      ['text', 'number', 'boolean', 'date', 'choice']
        .map(function (item) {
          return '<option>' + item + '</option>';
        })
        .join('') +
      '</select></div>' +
      '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:4px">' +
      tx('One per line or separated by commas — they all take the type on the right. Nothing guesses it from the name.') +
      '</div></div>' +
      '</div>' +
      '<div class="mfoot"><button data-cbsid="CMP003" onclick="closeModal()">' +
      tx('Cancel') +
      '</button>' +
      '<button data-cbsid="CAT004-B12" class="pri" id="catcol_go" data-testid="catcol-go" onclick="catcolGo()">' +
      tx('Add columns') +
      '</button></div>',
    true
  );
  catcolLoad(CATCOL.v);
}

/** One trade's columns, with what this catalogue already has marked — so nothing looks like a fresh choice twice. */
async function catcolLoad(v) {
  CATCOL.v = v;
  CATCOL.sel = null;
  var body = document.getElementById('catcol_body');
  if (body) body.innerHTML = tx('loading…');
  var r;
  try {
    r = await api('prodStarters', { query: { vertical: v } });
  } catch (e) {
    if (body) body.innerHTML = '<div style="color:var(--disp)">' + esc((e && e.message) || 'Could not read that set.') + '</div>';
    return;
  }
  var set = (r && r.starter) || {};
  var fields = set.fields || [];
  CATCOL.starter = fields;
  /* Everything ticked, which is what "Add these columns" always did — the old behaviour is one press away. */
  CATCOL.sel = {};
  fields.forEach(function (item) {
    CATCOL.sel[item.field_key] = 1;
  });

  var have = {};
  ((CATSET && CATSET.fields) || []).forEach(function (item) {
    have[item.field_key] = 1;
  });

  if (body) {
    body.innerHTML =
      '<div style="display:flex;gap:7px;align-items:center;margin-bottom:7px">' +
      '<button data-cbsid="CAT004-B13" type="button" data-testid="catcol-all" onclick="catcolAll(true)" style="border:1px solid var(--line);background:var(--card);color:var(--on-card);border-radius:20px;padding:3px 12px;font-size:var(--fs-1);cursor:pointer">' +
      tx('All') +
      '</button>' +
      '<button data-cbsid="CAT004-B14" type="button" data-testid="catcol-none" onclick="catcolAll(false)" style="border:1px solid var(--line);background:var(--card);color:var(--on-card);border-radius:20px;padding:3px 12px;font-size:var(--fs-1);cursor:pointer">' +
      tx('None') +
      '</button>' +
      '<span id="catcol_n" style="margin-inline-start:auto;font-size:var(--fs-1);color:var(--grey);white-space:nowrap"></span></div>' +
      '<div class="bulklist">' +
      fields
        .map(function (item) {
          var already = !!have[item.field_key];
          return (
            '<label class="bulkrow" style="cursor:' +
            (already ? 'default' : 'pointer') +
            (already ? ';opacity:.6' : '') +
            '">' +
            '<input data-cbsid="CAT004-I07" type="checkbox" ' +
            (already ? 'checked disabled' : 'checked') +
            ' data-colkey="' +
            esc(item.field_key) +
            '" data-testid="catcol-f-' +
            esc(item.field_key) +
            '"' +
            ' onchange="catcolTick(\'' +
            esc(item.field_key) +
            '\', this.checked)">' +
            '<span class="bn">' +
            esc(item.field_name || item.field_key) +
            '</span>' +
            /* ⭐ The datatype, named — the question Athi asked of this screen. */
            '<span class="bh">' +
            esc(item.field_type || 'text') +
            (already ? ' · ' + tx('already there') : '') +
            '</span>' +
            '</label>'
          );
        })
        .join('') +
      '</div>';
    catcolCount();
  }
}

function catcolCount() {
  var n = Object.keys(CATCOL.sel || {}).length,
    tot = (CATCOL.starter || []).length;
  var el = document.getElementById('catcol_n');
  if (el) el.textContent = txf('{n} of {tot} selected', { n: n, tot: tot });
}
function catcolTick(k, on) {
  if (on) CATCOL.sel[k] = 1;
  else delete CATCOL.sel[k];
  catcolCount();
}
function catcolAll(on) {
  CATCOL.sel = {};
  (CATCOL.starter || []).forEach(function (item) {
    if (on) CATCOL.sel[item.field_key] = 1;
  });
  document.querySelectorAll('[data-colkey]').forEach(function (item) {
    if (!item.disabled) item.checked = !!on;
  });
  catcolCount();
}

async function catcolGo() {
  var ownEl = document.getElementById('catcol_own');
  var typeEl = document.getElementById('catcol_owntype');
  var type = (typeEl && typeEl.value) || 'text';
  var own = ((ownEl && ownEl.value) || '')
    .split(/[\n,]/)
    .map(function (item) {
      return item.trim();
    })
    .filter(Boolean)
    .map(function (item) {
      return { field_name: item, field_type: type };
    });
  var fields = Object.keys(CATCOL.sel || {});
  if (!fields.length && !own.length) {
    if (typeof toast === 'function') toast(tx('Nothing selected.'), true);
    return;
  }
  var btn = document.getElementById('catcol_go');
  if (btn) {
    btn.disabled = true;
    btn.textContent = tx('Adding…');
  }
  try {
    var reply = await api('prodStarterAdopt', { body: { vertical: CATCOL.v, fields: fields, custom: own } });
    UI._catFields = null; // the product form renders declared columns from this; it must not keep the old list
    closeModal();
    if (typeof toast === 'function') {
      toast((reply && reply.message) || 'Columns added' + (reply && reply.rejected && reply.rejected.length ? ' · ' + reply.rejected.length + ' refused' : ''));
    }
    if (typeof catsetLoad === 'function') await catsetLoad(true);
    else renderApp();
  } catch (e) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = tx('Add columns');
    }
    if (typeof toast === 'function') toast((e && e.message) || 'Could not add the columns.', true);
  }
}

/**
 * ⭐ WHAT THIS CATALOGUE HAS ALREADY ADOPTED. A panel offering blueprints that cannot say which one you already
 * took is a panel that invites adopting the same thing twice.
 */
function catsetAdoptedHTML() {
  var list = (CATSET && CATSET.adopted) || null;
  if (list === null) {
    catsetAdoptedLoad();
    return '<div style="font-size:var(--fs-2);color:var(--grey)">' + tx('reading…') + '</div>';
  }
  if (!list.length) {
    return '<div style="font-size:var(--fs-2);color:var(--grey)">' + tx('Nothing adopted yet — your catalogue is entirely your own.') + '</div>';
  }
  return (
    '<div class="bulklist">' +
    list
      .map(function (item) {
        return (
          '<div class="bulkrow"><span class="bn">' +
          esc(item.title || item.source_key || '—') +
          '</span>' +
          '<span class="bh">' +
          ((item.items && item.items.length) || item.item_count || 0) +
          ' ' +
          tx('items') +
          ' · ' +
          esc(item.visible === false ? tx('hidden') : tx('showing')) +
          '</span></div>'
        );
      })
      .join('') +
    '</div>'
  );
}
async function catsetAdoptedLoad() {
  if (CATSET._adoptedBusy) return;
  CATSET._adoptedBusy = true;
  try {
    var reply = await api('catalogueSources');
    /* ⚠️ Only what THIS catalogue has taken — the endpoint also answers with what is available to take, and
       showing those here would read as "you have adopted nine things" on a fresh account. */
    CATSET.adopted = (reply && (reply.adopted || reply.mine)) || [];
  } catch (e) {
    CATSET.adopted = [];
  }
  CATSET._adoptedBusy = false;
  catsetPaintDetail();
}

/**
 * ⚠️ IT HANDS OFF, IT DOES NOT REBUILD. Adoption takes a source AND a commercials overlay — your prices over
 * their shared design — and that screen exists and works. A second implementation here would be the one thing on
 * this hub that could disagree with itself about what "adopted" means.
 */
function catsetBlueprint() {
  navTo('catsetup');
  /* Land on the blueprint step rather than the top of the walk: the reader pressed a button that named it. */
  try {
    UI.cw = UI.cw || {};
    UI.cw.step = 1;
  } catch (_) { /* best effort: failing here changes nothing the user sees */ }
  renderApp();
}

/**
 * ── ⭐⭐ THE COLUMNS THIS CATALOGUE ACTUALLY HAS ───────────────────────────────────────────────────────────────
 *
 * Athi, 2026-09-02: *"can they move the column up or down, depends on their own catalogue"* and *"if the data
 * already there, then we should not allow to remove but column can be added."*
 *
 * ⚠️ THE PANEL COULD ONLY ADD. It offered a standard set and said nothing about what was already declared — so
 * the one question a reader arrives with, *what does my catalogue record today*, had no answer on the screen
 * whose title is exactly that.
 *
 * ⭐ REMOVABILITY IS THE SERVER'S ANSWER, NOT THIS SCREEN'S. Each row carries `removable` and `locked_because`
 * computed by `lib/column-rules.js`, and the DELETE enforces the same function. A screen that decided for itself
 * would eventually enable a control the server refuses, which is worse than not offering it.
 *
 * ⚠️ AND THE REASON IS ON THE ROW, not behind a failed press. "12 products record a value in Grade" is what
 * tells someone what to do next; discovering it only by pressing Remove and being refused teaches the same fact
 * at a worse moment.
 */
/**
 * ── ⭐ THE COLUMNS PANEL IS THREE TABS, ONE QUESTION EACH ────────────────────────────────────────────────────
 * Athi, 2026-09-03 (observation 4): *"Under columns panel … you have 3 different information, like column name for
 * the catalogue and then unit of measure and field datatype, can you bring it in 3 different tabs, each one for
 * one purpose, so it is easier to distinguish and need to establish relationship."*
 *
 *   Columns — what does a product record, in what order        (name · order · lock)
 *   Types   — what kind of value, in what unit                  (datatype · unit · required)
 *   Usage   — who depends on it                                 (products · template · ERP map · remove)
 *
 * ⚠️ THE UNIT USED TO LIVE INSIDE THE LABEL — "Coverage (sq ft/L)" — because schema_fields had nowhere else to
 * put it, so a counterparty importing that sheet got a number with a unit only a person could read. `unit` is now
 * its own attribute, a UN/ECE Recommendation 20 code (the list GS1, Peppol and INV-01 use), behind migration b200.
 * Until b200 has run the Types tab says so rather than pretending.
 *
 * ⚠️ TIGHTENS PER COLUMN, LIKE REMOVAL. Label and unit are always free (they change no stored value); the TYPE is
 * fixed the moment a product records a value, and the control says why. Same rule, same source (column-rules).
 */
var CATSET_REC20 = [
  ['H87', 'piece'],
  ['KGM', 'kilogram'],
  ['GRM', 'gram'],
  ['TNE', 'tonne'],
  ['LTR', 'litre'],
  ['MLT', 'millilitre'],
  ['MTR', 'metre'],
  ['CMT', 'centimetre'],
  ['MMT', 'millimetre'],
  ['MTK', 'square metre'],
  ['MTQ', 'cubic metre'],
  ['BG', 'bag'],
  ['BX', 'box'],
  ['PK', 'pack'],
  ['CT', 'carton'],
  ['DZN', 'dozen'],
  ['SET', 'set'],
  ['PR', 'pair'],
  ['RO', 'roll'],
  ['BO', 'bottle'],
  ['HUR', 'hour'],
  ['DAY', 'day'],
  ['MON', 'month']
];
function catsetColTab() {
  return (CATSET && CATSET.colTab) || 'columns';
}
function catsetSetColTab(k) {
  CATSET.colTab = k;
  catsetPaintDetail();
}
function catsetColTabsHTML() {
  var tabs = [
    ['columns', tx('Columns')],
    ['types', tx('Types')],
    ['usage', tx('Usage')]
  ];
  return (
    '<div class="dtabs" data-testid="catset-col-tabs" style="padding:0;margin-bottom:8px">' +
    tabs
      .map(function (item) {
        return (
          '<button data-cbsid="CAT004-B15" type="button" data-testid="catset-coltab-' +
          item[0] +
          '" class="' +
          (catsetColTab() === item[0] ? 'on' : '') +
          '"' +
          ' onclick="catsetSetColTab(\'' +
          item[0] +
          '\')">' +
          item[1] +
          '</button>'
        );
      })
      .join('') +
    '</div>'
  );
}
/* One write for every attribute a tab can change; the server answers with the count a person needs next. */
async function catsetFieldPatch(key, patch) {
  try {
    var reply = await api('schemaFieldPatch', { params: { key: key }, body: patch });
    UI._catFields = null;
    var msg = (reply && reply.message) || tx('Saved');
    if (reply && reply.missing_required)
      msg += ' — ' + txn('{count} product has no value in it yet', '{count} products have no value in it yet', reply.missing_required);
    if (typeof toast === 'function') toast(msg);
  } catch (e) {
    if (typeof toast === 'function') toast((e && e.message) || tx('Could not update the column.'), true);
  }
  await catsetFieldsLoad(true);
}
function catsetColRow(c, i, n) {
  var key = esc(c.field_key),
    used = Number(c.used_by || 0),
    can = !!c.removable,
    t = catsetColTab();
  var name = esc(c.field_name || c.field_key);
  if (t === 'types') {
    var types = ['text', 'number', 'choice', 'date'];
    var lockedType = !c.retypable;
    var lockedReq = c.field_key === 'name' || c.field_key === 'price';
    var ready = !!CATSET.attrsReady;
    return (
      '<div class="bulkrow" data-testid="catset-col-' +
      key +
      '">' +
      '<span class="bn">' +
      name +
      '</span>' +
      '<select data-cbsid="CAT004-S03" data-testid="catset-type-' +
      key +
      '"' +
      (lockedType ? ' disabled' : '') +
      ' title="' +
      esc(lockedType ? c.retype_because || '' : tx('What kind of value this column holds')) +
      '"' +
      ' onchange="catsetFieldPatch(\'' +
      key +
      '\',{field_type:this.value})" style="font-size:var(--fs-1);padding:3px 6px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--on-card)">' +
      types
        .map(function (x) {
          return '<option value="' + x + '"' + ((c.field_type || 'text') === x ? ' selected' : '') + '>' + x + '</option>';
        })
        .join('') +
      (types.indexOf(c.field_type) < 0 && c.field_type ? '<option value="' + esc(c.field_type) + '" selected>' + esc(c.field_type) + '</option>' : '') +
      '</select>' +
      '<input data-cbsid="CAT004-I08" list="cb-rec20" data-testid="catset-unit-' +
      key +
      '" value="' +
      esc(c.unit || '') +
      '" placeholder="' +
      esc(tx('unit · KGM')) +
      '"' +
      (ready ? '' : ' disabled title="' + esc(tx('Not switched on for your shop yet')) + '"') +
      ' onchange="catsetFieldPatch(\'' +
      key +
      '\',{unit:this.value})" style="width:96px;font-size:var(--fs-1);padding:3px 6px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--on-card);text-transform:uppercase">' +
      '<label style="font-size:var(--fs-1);color:var(--grey);display:inline-flex;align-items:center;gap:4px;white-space:nowrap" title="' +
      esc(lockedReq ? tx('Every catalogue requires this') : tx('Refuse a product that leaves this empty')) +
      '">' +
      '<input data-cbsid="CAT004-I09" type="checkbox" data-testid="catset-req-' +
      key +
      '"' +
      (c.required ? ' checked' : '') +
      (lockedReq ? ' disabled' : '') +
      ' onchange="catsetFieldPatch(\'' +
      key +
      '\',{required:this.checked})">' +
      tx('required') +
      '</label>' +
      '</div>'
    );
  }
  if (t === 'usage') {
    var erp = (typeof CATSET_FACE !== 'undefined' && CATSET_FACE && CATSET_FACE.erp && CATSET_FACE.erp[c.field_key]) || '';
    return (
      '<div class="bulkrow" data-testid="catset-col-' +
      key +
      '">' +
      '<span class="bn">' +
      name +
      '</span>' +
      '<span class="bh">' +
      (used ? txn('used by {count} product', 'used by {count} products', used) : tx('unused')) +
      ' · ' +
      tx('in the upload template') +
      (erp ? ' · ERP: <span class="mono">' + esc(erp) + '</span>' : '') +
      '</span>' +
      '<button data-cbsid="CAT004-B16" type="button" class="badd" data-testid="catset-rm-' +
      key +
      '"' +
      (can ? '' : ' disabled') +
      ' title="' +
      esc(can ? tx('Remove this column') : c.locked_because || tx('This column cannot be removed.')) +
      '"' +
      ' onclick="catsetDrop(\'' +
      key +
      '\')">' +
      (can ? '✕' : '🔒') +
      '</button>' +
      '</div>'
    );
  }
  /* columns — the label is editable in place; order is always live (presentation, never a fact about a product). */
  return (
    '<div class="bulkrow" data-testid="catset-col-' +
    key +
    '">' +
    ui.field({ mount: 'CAT004-U07', kind: 'text', density: 'compact', key: key, label: 'Column name', of: key, hint: 'Rename — every screen and sheet follows; the key stays', cls: 'bn catset-rename',
      value: catsetColName(c), testid: 'catset-name-' + key, onChange: catsetOn(catsetRename, key) }) +
    '<span class="bh">' +
    (c.required ? tx('required') : '') +
    '</span>' +
    '<button data-cbsid="CAT004-B17" type="button" title="' +
    esc(tx('Move up')) +
    '" data-testid="catset-up-' +
    key +
    '"' +
    (i === 0 ? ' disabled' : '') +
    ' onclick="catsetMove(\'' +
    key +
    '\',-1)">↑</button>' +
    '<button data-cbsid="CAT004-B18" type="button" title="' +
    esc(tx('Move down')) +
    '" data-testid="catset-dn-' +
    key +
    '"' +
    (i === n - 1 ? ' disabled' : '') +
    ' onclick="catsetMove(\'' +
    key +
    '\',1)">↓</button>' +
    (can ? '' : '<button data-cbsid="CAT004-B19" type="button" class="badd" disabled title="' + esc(c.locked_because || '') + '">🔒</button>') +
    '</div>'
  );
}
function catsetColsHTML() {
  var list = (CATSET && CATSET.fields) || null;
  if (list === null) {
    catsetFieldsLoad();
    return '<div style="font-size:var(--fs-2);color:var(--grey)">' + tx('reading…') + '</div>';
  }
  if (!list.length) return '<div style="font-size:var(--fs-2);color:var(--grey)">' + tx('No columns declared yet.') + '</div>';

  var t = catsetColTab();
  var rows = list
    .map(function (item, index) {
      return catsetColRow(item, index, list.length);
    })
    .join('');
  var tabNote =
    t === 'types'
      ? '<div style="font-size:var(--fs-1);color:var(--grey);margin:0 0 6px">' +
        esc(
          tx('Type is fixed once a product records a value. Unit is a UN/ECE Rec 20 code (KGM · LTR · MTK · H87 = piece) so a sheet stays machine-readable.')
        ) +
        (CATSET.attrsReady ? '' : ' <b style="color:var(--warn-3)">' + esc(tx('Units are not switched on for your shop yet.')) + '</b>') +
        '</div>' +
        '<datalist id="cb-rec20">' +
        CATSET_REC20.map(function (item) {
          return '<option value="' + item[0] + '">' + esc(item[1]) + '</option>';
        }).join('') +
        '</datalist>'
      : t === 'usage'
        ? '<div style="font-size:var(--fs-1);color:var(--grey);margin:0 0 6px">' +
          esc(tx('A column can be removed only while no product records a value in it. Nothing stored is deleted either way.')) +
          '</div>'
        : '<div style="font-size:var(--fs-1);color:var(--grey);margin:0 0 6px">' +
          esc(tx('The order here is the order on the product form, the template and the export.')) +
          '</div>';

  /* ⭐ AND THE ONES THE SYSTEM KEEPS, beside them — a product records these too, so a list headed "what every
     product records" that omits them is short by three. Locked, and each says where it IS set. */
  var sys = ((CATSET && CATSET.system) || [])
    .map(function (item) {
      return (
        '<div class="bulkrow" style="opacity:.72" data-testid="catset-sys-' +
        esc(item.field_key) +
        '">' +
        '<span class="bn">' +
        esc(item.field_name) +
        ' <span style="font-weight:400;color:var(--grey)">· ' +
        esc(tx('kept by the system')) +
        '</span></span>' +
        '<span class="bh">' +
        esc(item.field_type) +
        '</span>' +
        '<button data-cbsid="CAT004-B20" type="button" class="badd" disabled title="' +
        esc(tx('Set in ') + (item.managed_by || '')) +
        '">🔒</button>' +
        '</div>'
      );
    })
    .join('');

  /**
   * ⚠️⚠️ COLUMNS THAT ARE IN THE DATA AND IN NO DECLARATION — and this panel used to be silent about them.
   *
   * They are real: they appear in the export and in the template. A merchant reading a panel headed "what every
   * product records" was shown a SHORTER list than their own spreadsheet, with nothing to explain the
   * difference. That silence is what let three surfaces disagree without anyone being able to see it.
   *
   * ⭐ THIS BLOCK SHOULD BE EMPTY, ALWAYS. Every write path now declares what it stores, so the only way to get
   * one is data written before that. If it appears, the backfill (migration b198) has not been run — and saying
   * so is far better than a panel that quietly disagrees with the download.
   */
  var undec = ((CATSET && CATSET.undeclared) || [])
    .map(function (item) {
      return (
        '<div class="bulkrow" style="opacity:.8" data-testid="catset-undeclared-' +
        esc(item.field_key) +
        '">' +
        '<span class="bn">' +
        esc(item.field_key) +
        '</span>' +
        '<span class="bh">' +
        esc(String(item.used_by || 0)) +
        ' ' +
        esc(tx('product(s)')) +
        '</span>' +
        '</div>'
      );
    })
    .join('');

  return (
    catsetColTabsHTML() +
    tabNote +
    '<div class="bulklist">' +
    rows +
    '</div>' +
    (sys
      ? '<div style="font-size:var(--fs-1);font-weight:700;color:var(--grey-2);text-transform:uppercase;' +
        'letter-spacing:.04em;margin:12px 0 5px">' +
        tx('Kept by the system') +
        '</div>' +
        '<div class="bulklist">' +
        sys +
        '</div>'
      : '') +
    (undec
      ? '<div style="font-size:var(--fs-1);font-weight:700;color:var(--warn-3);text-transform:uppercase;' +
        'letter-spacing:.04em;margin:12px 0 5px">' +
        tx('In your data, not yet declared') +
        '</div>' +
        '<div class="bulklist">' +
        undec +
        '</div>' +
        '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:5px">' +
        esc(tx('These are in your export and your template but are not columns yet, so they cannot be renamed, reordered or removed.')) +
        '</div>'
      : '')
  );
}

async function catsetFieldsLoad(force) {
  if (CATSET._fieldsBusy) return;
  if (CATSET.fields && !force) return;
  CATSET._fieldsBusy = true;
  try {
    var reply = await api('schemaFields');
    CATSET.fields = (reply && reply.fields) || [];
    CATSET.system = (reply && reply.system) || [];
    CATSET.attrsReady = !!(reply && reply.attrs_ready); // unit · source exist only once migration b200 has run
    /* Empty on any catalogue written since the declare-first writer; non-empty means b198 has not been run. */
    CATSET.undeclared = (reply && reply.undeclared) || [];
  } catch (e) {
    CATSET.fields = [];
    CATSET.system = [];
    CATSET.undeclared = [];
  }
  CATSET._fieldsBusy = false;
  catsetPaintDetail();
}

/**
 * ⚠️ THE WHOLE ORDER IS SENT, not "move this one". The endpoint takes a list and writes positions from it, so a
 * screen that sent a single move would be asking the server to reconstruct an order it can already see. Sending
 * the list means what is on screen and what is stored cannot drift apart by one press.
 */
async function catsetMove(key, dir) {
  var list = (CATSET.fields || []).slice();
  var i = list.findIndex(function (x) {
    return x.field_key === key;
  });
  var j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  var t = list[i];
  list[i] = list[j];
  list[j] = t;
  CATSET.fields = list;
  catsetPaintDetail(); // move first, so the screen answers the press at once
  try {
    await api('schemaFieldOrder', {
      body: {
        order: list.map(function (x) {
          return x.field_key;
        })
      }
    });
    UI._catFields = null;
  } catch (e) {
    if (typeof toast === 'function') toast((e && e.message) || 'Could not save the order.', true);
    await catsetFieldsLoad(true); // and put it back if the server disagreed
  }
}

function catsetDrop(key) {
  var c =
    (CATSET.fields || []).find(function (x) {
      return x.field_key === key;
    }) || {};
  confirmAsk(
    txf('Remove the {name} column?', { name: '"' + esc(c.field_name || key) + '"' }),
    tx('Nothing recorded in it is deleted — the column stops being part of your catalogue, and re-adding it ' + 'brings back anything products still hold.'),
    tx('Remove'),
    function () {
      _catsetDrop(key);
    },
    true
  );
}
async function _catsetDrop(key) {
  try {
    var reply = await api('schemaFieldDrop', { params: { key: key } });
    UI._catFields = null;
    if (typeof toast === 'function') toast((reply && reply.message) || 'Column removed');
    await catsetFieldsLoad(true);
  } catch (e) {
    /* ⚠️ The server's refusal carries the COUNT — pass it through rather than replacing it with a generic
       failure, because the number is the whole usefulness of the message. */
    if (typeof toast === 'function') toast((e && e.message) || 'Could not remove the column.', true);
    await catsetFieldsLoad(true);
  }
}

/**
 * ── ⭐ THE FIELD MAP AND THE TAX TREATMENT — both live on the catalogue FACE (b112) ────────────────────────────
 *
 * ⚠️ THE FACE IS READ ONCE AND WRITTEN WHOLE. `PUT /api/catalogue-face` upserts the config, so a panel that
 * saved only its own key would drop everything else the face holds. Every write here merges onto what was read.
 */
var CATSET_SYS = ['—', 'ERP', 'Tally', 'SAP', 'Other'];

/**
 * ⚠️⚠️ THERE IS ONE FACE, ONE LOADER AND ONE VARIABLE — AND FOR A FEW HOURS THERE WERE TWO OF EACH.
 *
 * The ERP and Tax panels arrived with their own `catsetFaceLoad` storing the face on `CATSET.face`, while the
 * Variants panel had used `CATSET_FACE` since long before. Function declarations HOIST, so the second definition
 * won silently: `CATSET_FACE` was never assigned, stayed `undefined` for ever, and `catsetVariantStateHTML`'s
 * `if (CATSET_FACE === undefined) { catsetFaceLoad().then(catsetPaintDetail); … }` re-entered on every paint —
 * load → repaint → still undefined → load. **An infinite repaint loop, which is a frozen tab.**
 *
 * ⚠️ NOTHING THREW AND NOTHING LOGGED. A duplicate top-level function is legal JavaScript; the loser simply
 * disappears. `node --check` passes, every guard passes, and the only symptom is a screen that stops answering —
 * which is why `e2e/dup-functions.cjs` now fails the build on the CLASS rather than trusting anyone to notice.
 *
 * ⭐ Collapsed onto the OLDER pair (`CATSET_FACE` / `catsetFaceSet`) because they had the callers — `_vSave`
 * calls `catsetFaceSet` from the catalogue screen, which knows nothing about this file's newer state object.
 */

/** ⚠️ Merged, never replaced: the face is upserted WHOLE, so a panel saving only its own key would drop
    everything else it holds. THE ONE face writer; it THROWS when the server refuses, so a caller under CBAction says why (F5 W1b). */
async function catsetFacePut(patch) {
  var face = Object.assign({}, CATSET_FACE || {}, patch || {});
  catsetFaceSet(face);
  await api('catFacePut', { body: { face: face } });
  /* ⚠️ THE PRODUCT PAGE KEEPS ITS OWN COPY OF THE FACE (UI._face, read once per session for the Pricing & tax
     pane). [TAX-01] INHERIT found it: set the catalogue-default slab here, open a product, and it still said
     "Not set" until a reload. The write is the one place that knows the face changed. */
  if (typeof UI !== 'undefined') UI._face = undefined;
}
/** the same write for the panels that say their failure as a toast (columns · units · order model · facets) */
async function catsetFaceSave(patch) {
  try {
    await catsetFacePut(patch);
  } catch (e) {
    if (typeof toast === 'function') toast((e && e.message) || 'Could not save that.', true);
  }
}

function catsetErpHTML() {
  if (CATSET_FACE === undefined) {
    catsetFaceLoad().then(catsetPaintDetail);
    return '<div style="font-size:var(--fs-2);color:var(--grey)">' + tx('reading…') + '</div>';
  }
  var cols = (CATSET && CATSET.fields) || null;
  if (cols === null) {
    catsetFieldsLoad();
    return '<div style="font-size:var(--fs-2);color:var(--grey)">' + tx('reading…') + '</div>';
  }
  if (!cols.length) return '<div style="font-size:var(--fs-2);color:var(--grey)">' + tx('Declare some columns first.') + '</div>';

  var map = (CATSET_FACE && CATSET_FACE.erpMap) || {};
  var mapped = Object.keys(map).filter(function (item) {
    var m = map[item];
    return m && m.system && m.system !== '—';
  }).length;

  return (
    '<div class="bulklist">' +
    cols
      .map(function (item) {
        var m = map[item.field_key] || {};
        var sys = m.system || '—';
        return (
          '<div class="bulkrow" data-testid="catset-erp-' +
          esc(item.field_key) +
          '">' +
          '<span class="bn">' +
          esc(item.field_name || item.field_key) +
          '</span>' +
          '<select data-cbsid="CAT004-S04" data-testid="catset-erpsys-' +
          esc(item.field_key) +
          '"' +
          ' onchange="catsetErpSet(\'' +
          esc(item.field_key) +
          "','system',this.value)\"" +
          ' style="font-size:var(--fs-1);padding:3px 6px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--on-card)">' +
          CATSET_SYS.map(function (entry) {
            return '<option' + (entry === sys ? ' selected' : '') + '>' + esc(entry) + '</option>';
          }).join('') +
          '</select>' +
          /* ⚠️ The name box only appears once a system is named: asking "what is it called there" before "where" is
         a question with no context, and an answer typed against "—" would be stored against nothing. */
          (sys !== '—'
            ? ui.field({ mount: 'CAT004-U08', kind: 'text', density: 'compact', key: item.field_key, label: 'Their field name', of: item.field_key, placeholder: 'their field name', cls: 'inp catset-erp',
                value: m.ref || '', testid: 'catset-erpref-' + item.field_key, onChange: catsetOn(catsetErpSet, item.field_key, 'ref') })
            : '<span class="bh">' + tx('not mapped') + '</span>') +
          '</div>'
        );
      })
      .join('') +
    '</div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:6px">' +
    (mapped ? txn('{count} column mapped', '{count} columns mapped', mapped) : tx('Nothing mapped — this catalogue stands on its own.')) +
    '</div>'
  );
}

function catsetErpSet(key, prop, val) {
  var face = CATSET_FACE || {};
  var map = Object.assign({}, face.erpMap || {});
  var m = Object.assign({}, map[key] || {});
  m[prop] = val;
  /* A column set back to "—" is UNMAPPED, not mapped to a dash — otherwise the count and any exporter reading
     this would treat the placeholder as a destination. */
  if (prop === 'system' && val === '—') delete map[key];
  else map[key] = m;
  catsetFaceSave({ erpMap: map });
  catsetPaintDetail();
}

/**
 * ⭐⭐ THE CATALOGUE DEFAULT SLAB — the last rung of the inheritance, and the one most catalogues will use alone.
 *
 * Athi, 2026-09-03: *"each product has different tax criteria, so it has to be product specific, but there are
 * slabs"*. Both halves are true at once, and Tally resolves them the same way: the product answers if it has an
 * answer, else its group, else the company. This picker is the company rung.
 *
 * ⚠️⚠️ THIS REPLACED A FREE-TEXT "Treatment" BOX, and the box was the problem it looks like it solved. Someone
 * typed "GST 18%" into it and nothing could read that: not the order path, not a chit line, not a counterparty.
 * A declaration nothing consumes is worse than a blank field, because it looks answered. A slab is cited by id,
 * so every one of those readers resolves it.
 *
 * ⚠️ ONLY LIVE SLABS ARE OFFERED. A draft is one you are still writing, and a catalogue-wide default that is
 * still being written would apply to every product that inherits — which is most of them.
 */
/**
 * ── ⭐⭐ THE TAX REGISTER — what every product carries, as the engine resolves it ────────────────────────────────
 * One row per product: tax RESOLVED (rate · slab · from where: product / category / catalogue / none, and a dead
 * citation named), the offers attached, HSN, categories, price. The same resolver and the same offer filter the
 * product page uses — a register that computed its own answer would be a second opinion. Rows open the product.
 * Reads: the product list once (cached on UI.prods, as the catalogue keeps it); slabs/categories/face are already here.
 */
/**
 * ── ⭐ THE OFFER ROW SAYS WHAT IT IS — Athi, 2026-09-05: "view screen behind the popup should show the details of
 * the offer, it just shows the name alone … status: futuristic, current, expired … where is it applied?"
 * Terms = the engine's own sentence (CBOffers.terms — promise() without the window gate); the window with its TIME
 * status (Scheduled · Active · Expired, the words Shopify/WooCommerce/Google Merchant use — a second axis beside
 * draft · live · retired); where it applies = the products or category it targets, else every product.
 */
function catsetOfferShape(d) {
  return Object.assign({ id: d.id, kind: d.sub, label: d.name }, d.rules || {});
}
function catsetOfferAppliesHTML(rules) {
  var at = (rules && rules.applies_to) || {};
  var bits = [];
  if (Array.isArray(at.item_ids) && at.item_ids.length) {
    catsetProdsEnsure();
    bits.push(
      at.item_ids
        .map(function (id) {
          return '<span class="pill" style="font-size:var(--fs-1)">' + esc(catsetProdName(id)) + '</span>';
        })
        .join(' ')
    );
  }
  var catIds = [].concat(at.category ? [String(at.category)] : [], Array.isArray(at.category_ids) ? at.category_ids.map(String) : []);
  catIds.forEach(function (catId) {
    var c = ((typeof cbDefsCached === 'function' && cbDefsCached('category')) || []).filter(function (x) {
      return String(x.definition_id || x.id) === catId;
    })[0];
    at = Object.assign({}, at, { category: catId });
    /* the products this category offer reaches — one list, so its applicability is confirmed by looking (Athi, 2026-09-05) */
    var prods = catsetProdsEnsure() || [];
    var inCat = prods.filter(function (item) {
      var d = item.item_data || item;
      return (typeof catgIdsOf === 'function' ? catgIdsOf(d) : []).indexOf(String(at.category)) >= 0;
    });
    bits.push(
      '<span class="pill" style="font-size:var(--fs-1)">' +
        esc(tx('category') + ': ' + (c ? c.name : at.category)) +
        ' · ' +
        esc(txf('{n} product(s)', { n: String(inCat.length) })) +
        '</span>' +
        (inCat.length
          ? '<details style="display:inline-block;margin-inline-start:6px"><summary style="cursor:pointer;color:var(--blue);font-size:var(--fs-1)">' +
            tx('which') +
            '</summary><div data-testid="catset-offer-reach" style="font-size:var(--fs-1);padding:4px 0 0 8px">' +
            inCat
              .map(function (item) {
                var d = item.item_data || item;
                return '<div>' + esc(d.name || '') + ' <span style="color:var(--grey)">' + esc(typeof inr === 'function' ? inr(d.price) : '') + '</span></div>';
              })
              .join('') +
            '</div></details>'
          : '')
    );
  });
  return bits.length ? bits.join(' ') : '<span style="color:var(--grey)">' + tx('every product') + '</span>';
}
function catsetOfferWindowHTML(rules, status) {
  var r = rules || {};
  if (typeof CBOffers === 'undefined') return '';
  var t = CBOffers.timeStatus(r);
  var word = { scheduled: tx('Scheduled'), active: tx('Active'), expired: tx('Expired') }[t] || t;
  var col = { scheduled: 'var(--blue)', active: 'var(--ok, #2e7d32)', expired: 'var(--grey)' }[t] || 'var(--grey)';
  var win = r.valid_from || r.valid_to ? esc((r.valid_from || '…') + ' → ' + (r.valid_to || '…')) : esc(tx('no dates — always'));
  /* a draft or retired offer has a window but does not APPLY; say the time word only for live ones */
  return (
    '<span data-testid="catset-offer-time" data-time="' +
    esc(t) +
    '" style="color:' +
    col +
    ';font-weight:700">' +
    (status === 'live' ? esc(word) : esc(win)) +
    '</span>' +
    (status === 'live' ? ' <span style="color:var(--grey)">' + win + '</span>' : '')
  );
}
function catsetDefRowDetail(kind, d) {
  if (kind !== 'offer') return '';
  var o = catsetOfferShape(d);
  var terms =
    typeof CBOffers !== 'undefined' && CBOffers.terms
      ? CBOffers.terms(o, {
          money: function (n) {
            return typeof inr === 'function' ? inr(n) : String(n);
          }
        })
      : null;
  return (
    '<div class="dn-detail" data-testid="catset-offer-detail-' +
    esc(d.id) +
    '" style="flex-basis:100%;font-size:var(--fs-1);display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:2px 0 0">' +
    '<span data-testid="catset-offer-terms">' +
    (terms
      ? esc(terms) + ' <span style="color:var(--grey)">' + esc(tx(CBOffers.scopeLabel(o))) + '</span>'
      : '<span style="color:var(--warn-3)">' + tx('no terms yet') + '</span>') +
    '</span>' +
    '<span>' +
    catsetOfferWindowHTML(d.rules, d.status) +
    '</span>' +
    '<span data-testid="catset-offer-applies"><span style="color:var(--grey)">' +
    tx('on') +
    '</span> ' +
    catsetOfferAppliesHTML(d.rules) +
    '</span>' +
    '</div>'
  );
}

/**
 * ── ⭐⭐ THE OFFER PLAN — Athi, 2026-09-05: "a proposal screen, kind of designing an offer … create multiple offers
 * at once, this month this offer, next month another … set the dates and it should be applied as per time period".
 * The engine already applies each offer in its own window (valid_from · valid_to); what was missing was seeing the
 * months side by side and authoring several at once. The strip: six months, each with the live offers that touch
 * it. "Plan several": rows of name · kind · value · product · from · to, created LIVE in one pass.
 */
function catsetOfferPlanHTML() {
  var rows = CATSET_DEFS.offer;
  if (rows === undefined) return '<div class="catset-load">' + tx('reading…') + '</div>';
  var live = rows.filter(function (item) {
    return item.status === 'live';
  });
  var now = new Date(),
    months = [];
  for (var index = 0; index < 6; index++) {
    var date = new Date(now.getFullYear(), now.getMonth() + index, 1),
      m1 = new Date(now.getFullYear(), now.getMonth() + index + 1, 0, 23, 59, 59);
    months.push({ from: date, to: m1, label: date.toLocaleString(undefined, { month: 'short', year: 'numeric' }) });
  }
  var touches = function (d, m) {
    var r = d.rules || {};
    var f = r.valid_from ? new Date(r.valid_from) : null,
      t = r.valid_to ? new Date(r.valid_to + 'T23:59:59') : null;
    if (f && f > m.to) return false;
    if (t && t < m.from) return false;
    return true;
  };
  var cells = months
    .map(function (item, position) {
      var on = live.filter(function (d) {
        return touches(d, item);
      });
      return (
        '<div data-testid="catset-plan-month-' +
        position +
        '" style="flex:1 1 130px;border:1px solid var(--line);border-radius:9px;padding:8px 10px;min-height:70px' +
        (position === 0 ? ';background:var(--paper);color:var(--on-bg)' : '') +
        '">' +
        '<div style="font-weight:700;margin-bottom:4px">' +
        esc(item.label) +
        (position === 0 ? ' <span style="color:var(--grey);font-weight:400">' + tx('now') + '</span>' : '') +
        '</div>' +
        (on.length
          ? on
              .map(function (entry) {
                return (
                  '<div data-cbsid="CAT004-C06" style="font-size:var(--fs-1);cursor:pointer;color:var(--blue)" onclick="catsetDefEdit(\'offer\',\'' +
                  esc(entry.id) +
                  '\')">' +
                  esc(entry.name) +
                  '</div>'
                );
              })
              .join('')
          : '<div style="font-size:var(--fs-1);color:var(--grey)">—</div>') +
        '</div>'
      );
    })
    .join('');
  return (
    '<div data-testid="catset-offer-plan" style="display:flex;gap:8px;flex-wrap:wrap">' +
    cells +
    '</div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:6px">' +
    tx('An offer applies only inside its own dates; two offers on the same product in the same month stack by their order.') +
    '</div>'
  );
}
var CATSET_PLAN = null;
function catsetPlanOpen() {
  CATSET_PLAN = [catsetPlanRow(0), catsetPlanRow(1)];
  catsetProdsEnsure();
  catsetPlanPaint();
}
function catsetPlanRow(i) {
  var date = new Date();
  var f = new Date(date.getFullYear(), date.getMonth() + i, 1),
    t = new Date(date.getFullYear(), date.getMonth() + i + 1, 0);
  var iso = function (x) {
    return x.toISOString().slice(0, 10);
  };
  return { name: '', kind: 'percent_off', value: '', product: '', from: iso(f), to: iso(t) };
}
function catsetPlanPaint() {
  var kinds = [
    ['percent_off', tx('Percent off')],
    ['amount_off', tx('Amount off')]
  ];
  var prods = UI.prods || [];
  var rowsHtml = CATSET_PLAN.map(function (item, index) {
    return (
      '<div data-testid="catset-plan-row" style="display:grid;grid-template-columns:2fr 1.2fr .8fr 1.6fr 1.1fr 1.1fr auto;gap:6px;align-items:center;margin-bottom:6px">' +
      '<input data-cbsid="CAT004-I12" class="inp" data-testid="plan-name-' +
      index +
      '" placeholder="' +
      esc(tx('Name buyers see')) +
      '" value="' +
      esc(item.name) +
      '" oninput="CATSET_PLAN[' +
      index +
      '].name=this.value">' +
      '<select data-cbsid="CAT004-S05" class="inp" data-testid="plan-kind-' +
      index +
      '" onchange="CATSET_PLAN[' +
      index +
      '].kind=this.value">' +
      kinds
        .map(function (k) {
          return '<option value="' + k[0] + '"' + (item.kind === k[0] ? ' selected' : '') + '>' + esc(k[1]) + '</option>';
        })
        .join('') +
      '</select>' +
      '<input data-cbsid="CAT004-I13" class="inp" data-testid="plan-value-' +
      index +
      '" inputmode="decimal" placeholder="10" value="' +
      esc(item.value) +
      '" oninput="CATSET_PLAN[' +
      index +
      '].value=this.value">' +
      '<select data-cbsid="CAT004-S06" class="inp" data-testid="plan-product-' +
      index +
      '" onchange="CATSET_PLAN[' +
      index +
      '].product=this.value"><option value="">' +
      esc(tx('every product')) +
      '</option>' +
      prods
        .map(function (p) {
          var id = p.item_id || p.id;
          return '<option value="' + esc(id) + '"' + (item.product === id ? ' selected' : '') + '>' + esc((p.item_data || p).name || '') + '</option>';
        })
        .join('') +
      '</select>' +
      ui.field({ mount: 'CAT004-U09', kind: 'date', density: 'compact', key: index, label: 'From', of: catsetPlanLabel(item, prods, index), cls: 'inp', value: item.from, testid: 'plan-from-' + index, onChange: catsetOn(catsetPlanDate, index, 'from') }) +
      ui.field({ mount: 'CAT004-U10', kind: 'date', density: 'compact', key: index, label: 'To', of: catsetPlanLabel(item, prods, index), cls: 'inp', value: item.to, testid: 'plan-to-' + index, onChange: catsetOn(catsetPlanDate, index, 'to') }) +
      '<button data-cbsid="CMP008" class="composebtn" title="' +
      esc(tx('Remove')) +
      '" onclick="CATSET_PLAN.splice(' +
      index +
      ',1);catsetPlanPaint()">✕</button>' +
      '</div>'
    );
  }).join('');
  modal(
    '<div class="mhd"><div class="t">' +
      tx('Plan several offers') +
      '</div><div class="s">' +
      tx('Each applies only inside its dates — this month one, next month another.') +
      '</div></div>' +
      '<div class="mbody">' +
      '<div style="display:grid;grid-template-columns:2fr 1.2fr .8fr 1.6fr 1.1fr 1.1fr auto;gap:6px;font-size:var(--fs-1);color:var(--grey);margin-bottom:4px"><span>' +
      tx('Name') +
      '</span><span>' +
      tx('Kind') +
      '</span><span>' +
      tx('Value') +
      '</span><span>' +
      tx('Applies to') +
      '</span><span>' +
      tx('From') +
      '</span><span>' +
      tx('To') +
      '</span><span></span></div>' +
      rowsHtml +
      '<button data-cbsid="CAT004-B21" class="composebtn" data-testid="plan-add" onclick="CATSET_PLAN.push(catsetPlanRow(CATSET_PLAN.length));catsetPlanPaint()">+ ' +
      tx('Another month') +
      '</button>' +
      '<div id="plan_err" class="err" style="margin-top:6px"></div></div>' +
      '<div class="mfoot"><button data-cbsid="CAT004-B22" class="pri" data-testid="plan-go" onclick="catsetPlanGo()">' +
      tx('Create all as live') +
      '</button><button data-cbsid="CMP003" onclick="closeModal()">' +
      tx('Cancel') +
      '</button></div>',
    true
  );
}
async function catsetPlanGo() {
  var err = document.getElementById('plan_err');
  if (err) err.textContent = '';
  var rows = (CATSET_PLAN || []).filter(function (item) {
    return item.name.trim() || item.value;
  });
  if (!rows.length) {
    if (err) err.textContent = tx('Nothing to create.');
    return;
  }
  for (var index = 0; index < rows.length; index++) {
    var r = rows[index];
    if (!r.name.trim()) {
      if (err) err.textContent = tx('Row {n}: a name buyers will see.').replace('{n}', String(index + 1));
      return;
    }
    if (!(Number(r.value) > 0)) {
      if (err) err.textContent = tx('Row {n}: a value above 0.').replace('{n}', String(index + 1));
      return;
    }
    if (r.from && r.to && r.to < r.from) {
      if (err) err.textContent = tx('Row {n}: “to” is before “from”.').replace('{n}', String(index + 1));
      return;
    }
  }
  /* UX-110: "Create all as live" is a money promise: the Offer Lab's one sentence first (it names the whole catalogue when a row names no product), then the write with the yes */
  var allNamed = rows.every(function (item) { return item.product; });
  ensureCap('definitions')
    .then(function () {
      return cbOfferAskLive(
        { name: rows.length === 1 ? rows[0].name.trim() : rows.length + ' offers', detail: rows.length === 1 ? '' : rows.map(function (item) { return item.name.trim(); }).join(', '), rules: allNamed ? { applies_to: { item_ids: rows.map(function (item) { return item.product; }) } } : {} },
        function () { return catsetPlanCreate(rows, err); }
      );
    })
    .catch(function (e) {
      if (err) err.textContent = (e && e.message) || tx('Could not create.');
    });
}
/** the writes of "Create all as live", after the shopkeeper has said yes: each offer goes with confirmed: true */
async function catsetPlanCreate(rows, err) {
  var made = 0;
  try {
    for (var j = 0; j < rows.length; j++) {
      var x = rows[j];
      var rules = { scope: 'line', priority: j + 1 };
      if (x.kind === 'percent_off') rules.percent = Number(x.value);
      else rules.amount = Number(x.value);
      if (x.from) rules.valid_from = x.from;
      if (x.to) rules.valid_to = x.to;
      if (x.product) rules.applies_to = { item_ids: [x.product] };
      await api('defAdd', { body: { kind: 'offer', sub_kind: x.kind, name: x.name.trim(), rules: rules, status: 'live', confirmed: true } });
      made++;
    }
    closeModal();
    toast(txf('{n} offer(s) created, live in their own dates.', { n: String(made) }));
    if (typeof cbDefAfterChange === 'function') {
      try {
        await cbDefAfterChange('offer');
      } catch (_) { /* best effort: failing here changes nothing the user sees */ }
    }
    await catsetDefsLoad('offer', true);
    catsetPaintDetail();
  } catch (e) {
    if (err) err.textContent = (made ? txf('{n} created, then: ', { n: String(made) }) : '') + ((e && e.message) || tx('Could not create.'));
  }
}

/** The product list this screen's registers read — once, cached where the catalogue keeps it (UI.prods); null while reading. */
function catsetProdsEnsure() {
  if (Array.isArray(UI.prods)) return UI.prods;
  if (!UI._catsetProdReq) {
    UI._catsetProdReq = api('prodList')
      .then(function (reply) {
        UI.prods = reply || [];
        UI._catsetProdReq = null;
        catsetPaintDetail();
      })
      .catch(function () {
        UI.prods = [];
        UI._catsetProdReq = null;
        catsetPaintDetail();
      });
  }
  return null;
}
function catsetProdName(id) {
  var p = (UI.prods || []).filter(function (x) {
    return String(x.item_id || x.id) === String(id);
  })[0];
  return p ? (p.item_data || p).name || id : id;
}
function catsetTaxRows() {
  var prods = catsetProdsEnsure();
  if (prods === null) return null;
  var slabs = (CATSET_DEFS.tax || [])
    .filter(function (item) {
      return item.status === 'live';
    })
    .map(function (item) {
      return { definition_id: item.id, name: item.name, status: item.status, rules: item.rules || {} };
    });
  var cats = (typeof cbDefsCached === 'function' && cbDefsCached('category')) || null;
  if (cats === null && typeof cbDefsLive === 'function') {
    cbDefsLive('category')
      .then(catsetPaintDetail)
      .catch(function () {});
    cats = [];
  }
  var offers = (typeof UI._ctOffers !== 'undefined' && UI._ctOffers) || null;
  if (offers === null && typeof ctOffersEnsure === 'function') {
    ctOffersEnsure(function () {
      catsetPaintDetail();
    });
    offers = [];
  }
  var face = CATSET_FACE || {};
  return prods.map(function (item) {
    var d = item.item_data || item,
      id = item.item_id || item.id;
    var r =
      typeof CBTaxSlab !== 'undefined' ? CBTaxSlab.resolve({ item_data: d, face: face, slabs: slabs, categories: cats || [] }) : { rate: null, source: 'none' };
    var on = (offers || []).filter(function (entry) {
      var at = (entry.rules && entry.rules.applies_to) || {};
      return Array.isArray(at.item_ids) && at.item_ids.indexOf(id) >= 0;
    });
    return {
      id: id,
      name: typeof pName === 'function' ? pName(d) : d.name || '',
      code: d.hsn || d.code || d.sku || '',
      cats: typeof catgNamesOf === 'function' ? catgNamesOf(d) : [],
      catIds: typeof catgIdsOf === 'function' ? catgIdsOf(d) : [],
      price: d.price,
      r: r,
      offers: on.map(function (entry) {
        return entry.name;
      })
    };
  });
}
var CATSET_TAX_CATG = ''; /* the category chip picked on the Tax register ('' = all) */
function catsetTaxCatg(id) {
  CATSET_TAX_CATG = CATSET_TAX_CATG === id ? '' : id;
  catsetPaintDetail();
}
/**
 * ⭐ ONE LIST PER CATEGORY — Athi, 2026-09-05: "is there any way we can look at the entire product under the category
 * in one single list in the offer and tax panel so things can be seen in one go and confirm its applicability".
 * The chips above the register filter it to a category; every row still shows the tax AS RESOLVED and its source,
 * so "does this category's slab actually reach its products?" is answered by looking. A product whose categories
 * disagree (two slabs) is flagged on its row and counted at the top.
 */
function catsetTaxCatgChipsHTML(rows) {
  var cats = (typeof cbDefsCached === 'function' && cbDefsCached('category')) || [];
  if (!cats.length) return '';
  var count = {};
  rows.forEach(function (x) {
    (x.catIds || []).forEach(function (id) {
      count[id] = (count[id] || 0) + 1;
    });
  });
  var chip = function (id, name, n) {
    var on = CATSET_TAX_CATG === id;
    return (
      '<span data-cbsid="CAT004-C07" class="pill" data-testid="catset-tax-catg-' +
      esc(id || 'all') +
      '" onclick="catsetTaxCatg(\'' +
      esc(id) +
      '\')" style="cursor:pointer;' +
      (on ? 'background:var(--accent);color:#fff;' : 'color:var(--on-bg);') +
      '">' +
      esc(name) +
      (n != null ? ' · ' + n : '') +
      '</span>'
    );
  };
  return (
    '<div data-testid="catset-tax-catgs" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;font-size:var(--fs-1)">' +
    chip('', tx('All products'), rows.length) +
    cats
      .filter(function (item) {
        return item.status !== 'retired';
      })
      .map(function (item) {
        var id = String(item.definition_id || item.id);
        var slab = item.rules && item.rules.default_slab;
        return chip(id, item.name + (slab ? ' · ' + tx('slab set') : ''), count[id] || 0);
      })
      .join('') +
    '</div>'
  );
}
function catsetTaxRegisterHTML() {
  var all = catsetTaxRows();
  if (all === null) return '<div class="catset-load">' + tx('reading…') + '</div>';
  if (!all.length) return '<div class="catset-none">' + tx('No products yet.') + '</div>';
  var rows = CATSET_TAX_CATG
    ? all.filter(function (x) {
        return (x.catIds || []).indexOf(CATSET_TAX_CATG) >= 0;
      })
    : all;
  var chips = catsetTaxCatgChipsHTML(all);
  if (!rows.length) return chips + '<div class="catset-none">' + tx('No product in this category.') + '</div>';
  var src = { product: tx('on the product'), category: tx('from category'), catalogue: tx('catalogue default'), none: tx('not set') };
  var cell = function (h, extra) {
    return '<td style="padding:6px 8px;border-top:1px solid var(--line);vertical-align:top' + (extra || '') + '">' + h + '</td>';
  };
  var dead = 0,
    clash = 0;
  var body = rows
    .map(function (x) {
      var r = x.r || {};
      var isDead = r.unresolved && r.cited;
      if (isDead) dead++;
      var tax =
        r.rate === null || r.rate === undefined
          ? '<span style="color:var(--warn-3)">' + tx('no rate') + '</span>'
          : '<b><bdi>' + esc(String(r.rate)) + '%</bdi></b> <span style="color:var(--grey)">' + esc(r.name || '') + '</span>';
      var from =
        '<span class="pill" style="font-size:var(--fs-1)">' +
        esc(src[r.source] || r.source || '') +
        (r.source === 'category' && r.via_category_name ? ' · ' + esc(r.via_category_name) : '') +
        '</span>';
      var warn = isDead ? '<div style="color:var(--warn-3);font-size:var(--fs-1)">⚠️ ' + esc(txf('cites “{s}”, not active', { s: r.cited })) + '</div>' : '';
      if (Array.isArray(r.conflict) && r.conflict.length > 1) {
        clash++;
        warn +=
          '<div data-testid="catset-tax-conflict" style="color:var(--warn-3);font-size:var(--fs-1)">⚠️ ' +
          esc(
            tx('categories disagree: ') +
              r.conflict
                .map(function (item) {
                  return (item.category_name || item.category_id) + ' ' + (item.rate == null ? '?' : item.rate + '%');
                })
                .join(' vs ')
          ) +
          '</div>';
      }
      return (
        '<tr data-testid="catset-tax-row-' +
        esc(id(x)) +
        '" style="cursor:pointer" onclick="catsetOpenProduct(\'' +
        esc(id(x)) +
        '\')">' +
        cell('<b>' + esc(x.name) + '</b>' + (x.code ? '<div style="color:var(--grey);font-size:var(--fs-1)"><code>' + esc(x.code) + '</code></div>' : '')) +
        cell(tax + ' ' + from + warn) +
        cell(
          x.offers.length
            ? x.offers
                .map(function (item) {
                  return '<span class="pill" style="font-size:var(--fs-1)">' + esc(item) + '</span>';
                })
                .join(' ')
            : '<span style="color:var(--grey)">—</span>'
        ) +
        cell(x.cats.length ? esc(x.cats.join(' · ')) : '<span style="color:var(--grey)">—</span>') +
        cell(
          '<bdi>' + (typeof inr === 'function' ? inr(typeof cbAmount === 'function' ? cbAmount(x.price) : x.price) : esc(String(x.price || ''))) + '</bdi>',
          ';text-align:end;white-space:nowrap'
        ) +
        '</tr>'
      );
    })
    .join('');
  function id(x) {
    return String(x.id || '');
  }
  return (
    chips +
    (dead
      ? '<div data-testid="catset-tax-dead" style="color:var(--warn-3);margin-bottom:6px">⚠️ ' +
        esc(txf('{n} product(s) cite a slab that is not active — open the row and attach another.', { n: String(dead) })) +
        '</div>'
      : '') +
    (clash
      ? '<div data-testid="catset-tax-clash" style="color:var(--warn-3);margin-bottom:6px">⚠️ ' +
        esc(
          txf('{n} product(s) sit in categories that name different slabs — the first applies; cite a slab on the product to settle it.', { n: String(clash) })
        ) +
        '</div>'
      : '') +
    '<div style="overflow-x:auto"><table data-testid="catset-tax-register" style="width:100%;border-collapse:collapse;font-size:var(--fs-2)">' +
    '<thead><tr style="color:var(--grey);text-align:start"><th style="text-align:start;padding:4px 8px">' +
    tx('Product') +
    '</th><th style="text-align:start;padding:4px 8px">' +
    tx('Tax applied') +
    '</th><th style="text-align:start;padding:4px 8px">' +
    tx('Offers') +
    '</th><th style="text-align:start;padding:4px 8px">' +
    tx('Categories') +
    '</th><th style="text-align:end;padding:4px 8px">' +
    tx('Price') +
    '</th></tr></thead>' +
    '<tbody>' +
    body +
    '</tbody></table></div>'
  );
}
/** Under "Your slabs": how many products each slab reaches, by the resolver's answer — so a retire knows its cost. */
function catsetTaxCountsHTML() {
  var rows = catsetTaxRows();
  if (!rows || !rows.length) return '';
  var by = {};
  rows.forEach(function (x) {
    var k = (x.r && x.r.slab_id) || '';
    if (k) by[k] = (by[k] || 0) + 1;
  });
  var keys = Object.keys(by);
  if (!keys.length) return '';
  var name = function (k) {
    var d = (CATSET_DEFS.tax || []).filter(function (item) {
      return item.id === k;
    })[0];
    return d ? d.name : k;
  };
  return (
    '<div data-testid="catset-tax-counts" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;font-size:var(--fs-1)">' +
    keys
      .map(function (item) {
        return '<span class="pill">' + esc(name(item)) + ' · ' + esc(txf('{n} product(s)', { n: String(by[item]) })) + '</span>';
      })
      .join('') +
    '</div>'
  );
}
/** A register row opens its product on the Pricing & tax tab — the place the row's answer is changed. */
function catsetOpenProduct(id) {
  UI.prodSel = id;
  UI.prodMode = 'view';
  UI.mdetail = true;
  UI.prodTab = 'pricing';
  UI.nav = 'catalogue';
  if (typeof renderApp === 'function') renderApp();
}
function catsetTaxHTML() {
  if (CATSET_FACE === undefined) {
    catsetFaceLoad().then(catsetPaintDetail);
    return '<div style="font-size:var(--fs-2);color:var(--grey)">' + tx('reading…') + '</div>';
  }
  var rows = CATSET_DEFS.tax;
  if (rows === undefined) {
    catsetDefsLoad('tax').then(catsetPaintDetail);
    return '<div class="catset-load">' + tx('reading…') + '</div>';
  }
  /* who may set a rate (CATSET_MAY) is read on the FIRST PICK, not here: the card costs the two reads it always did (the face, the slabs) and the
     gate is on the write — until the server has answered, Save stays greyed and nothing can be sent */
  var t = catsetTaxFace_(),
    stored = t.default_slab || '',
    picked = CATSET_TAX_PICK === undefined ? stored : CATSET_TAX_PICK,
    verdict = cbRateMay(CATSET_MAY);
  var live = rows.filter(function (item) {
    return item.status === 'live';
  });

  /* ⚠️ An empty picker EXPLAINS ITSELF rather than rendering one blank option — the same rule the order-model
     form follows. "You have no live slabs" and "this catalogue cannot have a default" look identical otherwise. */
  var body = !live.length
    ? '<div style="font-size:var(--fs-2);color:var(--grey)">' + tx('No live slab yet — author one above and make it live.') + '</div>'
    : '<select data-cbsid="CAT004-S07" class="inp" data-testid="catset-tax-default" onchange="catsetTaxPick(this.value)"' +
      (verdict.ok ? '' : ' disabled title="' + esc(verdict.why) + '"') +
      '>' +
      '<option value="">— ' +
      esc(tx('none')) +
      ' —</option>' +
      cbSlabOptionsHTML(live, picked) /* governed first, own after — the same builder the product and category use */ +
      '</select>' +
      catsetTaxActsHTML_(verdict, picked !== stored);

  return (
    '<label class="fl">' +
    tx('Catalogue default') +
    '</label>' +
    body +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:4px">' +
    tx('Applies to every product that names no slab and sits in no category that names one.') +
    '</div>' +
    /* ⚠️ SAID ONCE, ONLY WHERE IT HAPPENED. The old free-text treatment is kept in the face rather than deleted —
       it is the owner's words — but nothing reads it any more, and a value nobody reads must not sit on a screen
       looking authoritative. */
    (t.treatment
      ? '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:8px">⚠️ ' +
        txf('Your old typed treatment ({t}) is kept but no longer read — cite a slab instead.', { t: esc(t.treatment) }) +
        '</div>'
      : '')
  );
}
/* ── the catalogue default's draft and write (F5 W1b: Save + confirm, never a write on change) ─────────────────────────────────────────── */
/**
 * the Save under the picker: the picker is a DRAFT, Save asks first (a default is a rate on every item with none of its own) and the outcome is said
 * in the card. Shown to everyone and enabled by role (owner or manager — cbRateMay, the api's rule), greyed WITH the sentence for the rest; greyed too
 * while nothing changed. `verdict` is cbRateMay's; `changed` whether the pick differs from the stored default.
 */
function catsetTaxActsHTML_(verdict, changed) {
  var sentence = !verdict.ok && CATSET_MAY !== null ? '<div data-testid="catset-tax-why" style="font-size:var(--fs-1);color:var(--grey);margin-top:4px">' + esc(verdict.why) + '</div>' : '';
  return (
    '<div class="catset-ca" style="padding:8px 0 0"><button data-cbsid="CMP001" class="composebtn pri" data-testid="catset-tax-save" onclick="catsetTaxSave(this)"' +
    (verdict.ok && changed ? '' : ' disabled') +
    '>' +
    tx('Save') +
    '</button></div>' +
    sentence +
    '<div id="catset_tax_out" data-testid="catset-tax-out" style="font-size:var(--fs-2);font-weight:600;color:var(--ok-2);min-height:20px;margin-top:4px"></div>'
  );
}
var CATSET_TAX_PICK; /* the slab picked but not yet saved: undefined = nothing picked (the stored one stands), '' = cleared, else a slab id */
var CATSET_MAY = null; /* GET /entities/me/can-see-costs as read: is_owner · may_set_rate (api #429) — who may set a rate here; null = not read yet */
/** the face's tax object as an object (an old face kept a free-text treatment string there) */
function catsetTaxFace_() {
  var t = (CATSET_FACE && CATSET_FACE.tax) || {};
  return typeof t === 'string' ? { treatment: t } : t;
}
/** the server's answer to "may this login set a rate", read once (the same field catalogue.html reads); a failed read leaves it unknown, and Save stays greyed */
function catsetMayLoad() {
  if (CATSET_MAY !== null) return Promise.resolve(CATSET_MAY);
  return api('canSeeCosts')
    .then(function (reply) {
      CATSET_MAY = reply || {};
    })
    .catch(function (e) {
      CATSET_MAY = {};
      if (typeof cblog === 'function') cblog('warn', 'catsetup: can-see-costs could not be read — the catalogue default stays read-only: ' + ((e && e.message) || e));
    });
}
/**
 * a slab picked: the draft changes and only the Save button flips (nothing is written, nothing else repaints). The first pick also asks the server who
 * may set a rate (one read, once) and repaints the card with its answer: Save enabled for an owner or a manager, the picker greyed WITH the sentence
 * for anyone else — the pick is kept either way.
 */
function catsetTaxPick(id) {
  CATSET_TAX_PICK = String(id || '');
  if (CATSET_MAY === null) {
    catsetMayLoad().then(catsetPaintDetail);
    return;
  }
  var stored = catsetTaxFace_().default_slab || '';
  var button = document.querySelector('[data-testid="catset-tax-save"]');
  if (button) button.disabled = !(cbRateMay(CATSET_MAY).ok && CATSET_TAX_PICK !== stored);
}
/** the slab as the shop reads it, through the engine's one phrasing ("GST 5%"); '' → "no default" */
function catsetTaxWords_(id) {
  var row = (CATSET_DEFS.tax || []).filter(function (item) {
    return item.id === id;
  })[0];
  var slab = row ? CBTaxSlab.slabOf({ definition_id: row.id, name: row.name, rules: row.rules || {} }) : null;
  if (!slab) return tx('no default');
  return CBTaxSlab.describe({ source: 'catalogue', rate: slab.rate, nil_kind: slab.nil_kind }, { short: true, country: (typeof SESSION !== 'undefined' && SESSION && SESSION.country) || '' });
}
/** how many products a changed default reaches: those resolving to nothing or to the catalogue today (null when the products are not read yet) */
function catsetTaxFollowers_() {
  var rows = catsetTaxRows();
  if (rows === null) return null;
  return rows.filter(function (x) {
    return !x.r || x.r.source === 'none' || x.r.source === 'catalogue';
  }).length;
}
/**
 * Save → ASK FIRST (naming the rate and how many items follow) → ONE PUT of the face through catsetFacePut → the outcome in the card.
 * ⚠️ MERGED ONTO face.tax, NOT ASSIGNED OVER IT. The face writer merges one level only, so writing `{ tax: {default_slab} }` would drop
 * `tax.treatment` — the exact class of loss the face's own header warns about, one level deeper. Cleared means INHERIT NOTHING, not "nil-rated":
 * the key is removed rather than set to ''.
 */
function catsetTaxSave(button) {
  var current = catsetTaxFace_(),
    next = Object.assign({}, current),
    id = CATSET_TAX_PICK === undefined ? current.default_slab || '' : CATSET_TAX_PICK,
    verdict = cbRateMay(CATSET_MAY);
  if (!verdict.ok) {
    if (typeof toast === 'function') toast(verdict.why, true); /* the button is greyed above; this is the belt to that brace */
    return;
  }
  if (id) next.default_slab = String(id);
  else delete next.default_slab;
  var words = catsetTaxWords_(id),
    follow = catsetTaxFollowers_();
  return CBAction.run(
    button,
    function () {
      return catsetFacePut({ tax: next });
    },
    {
      key: 'catset-tax-save',
      confirm: { title: txf('Every item with no rate of its own: {w}?', { w: words }), body: follow === null ? '' : esc(txf('{n} item(s) follow.', { n: String(follow) })), yes: tx('Set rate'), danger: false },
      out: 'catset_tax_out',
      busy: tx('Saving…'),
      outcome: function () {
        CATSET_TAX_PICK = undefined;
        catsetPaintDetail();
        var out = document.getElementById('catset_tax_out');
        if (out) out.textContent = txf('Catalogue default: {w}', { w: words }) + (follow ? ' · ' + txf('{n} item(s) follow', { n: String(follow) }) : '');
      }
    }
  );
}

/* ── render ──────────────────────────────────────────────────────────────────────────────────────────────────── */
function catsetDetailHTML() {
  var k = catsetSec();
  var s =
    CATSET_SECS.filter(function (x) {
      return x.key === k;
    })[0] || CATSET_SECS[0];
  return (
    '<div class="dh"><button data-cbsid="CAT004-B23" class="dback" onclick="catsetBack()">‹ Catalogue setup</button>' +
    '<div class="dt">' +
    s.icon +
    ' ' +
    esc(s.name) +
    '</div><div class="ds">' +
    esc(s.q) +
    '</div></div>' +
    '<div class="db" tabindex="0" role="region" aria-label="' + esc(tx('Category setup details')) + '" id="catsetbody">' +
    catsetBody(k) +
    '</div>'
  );
}
/* ⚠️ ONLY WHILE THIS SCREEN IS UP. The section's loaders (slabs, products, the face) call this when they land — and they
   land after a person has moved on: the Catalogue's pane was overwritten with Setup › Tax ([TAX-02], the tour, 2026-09-05). */
function catsetPaintDetail() {
  if (typeof UI !== 'undefined' && UI.nav !== 'catsetup') return;
  var node = document.getElementById('detailpane');
  if (node) {
    var k = scrollKeep();
    node.className = 'detail';
    node.innerHTML = catsetDetailHTML();
    k();
  }
}
function catsetPaintList() {
  if (typeof UI !== 'undefined' && UI.nav !== 'catsetup') return;
  var node = document.getElementById('catset_rows');
  if (node) {
    var k = scrollKeep();
    node.innerHTML = catsetRowsHTML();
    k();
  }
}
function catsetPaint() {
  catsetPaintList();
  catsetPaintDetail();
}
function catsetRowsHTML() {
  var cur = catsetSec();
  return CATSET_SECS.map(function (item) {
    return (
      '<div data-cbsid="CAT004-C08" class="row' +
      (item.key === cur ? ' sel' : '') +
      '" data-testid="catset-sec-' +
      item.key +
      '"' +
      ' onclick="catsetSetSec(\'' +
      item.key +
      '\')">' +
      '<div style="flex:1;min-width:0"><div style="display:flex;align-items:center;gap:8px">' +
      '<span style="font-size:var(--fs-3)">' +
      item.icon +
      '</span>' +
      '<b style="font-size:var(--fs-3)">' +
      esc(item.name) +
      '</b></div>' +
      '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:1px;padding-inline-start:22px">' +
      esc(item.q) +
      '</div></div>' +
      '<div class="rowgo" aria-hidden="true">›</div></div>'
    );
  }).join('');
}
function catalogueSetupHubScreen() {
  catsetCss();
  var list =
    '<div class="list"><div class="lh">' +
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">' +
    '<span style="font-family:\'Space Grotesk\';font-weight:700;font-size:var(--fs-3)">' +
    tx('⚙️ Catalogue setup') +
    '</span></div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);line-height:1.5">How your catalogue is <b>shaped</b>. ' +
    'The products themselves live in <span data-cbsid="CAT004-C09" onclick="navTo(\'catalogue\')" style="color:var(--blue);font-weight:600;cursor:pointer">' +
    tx('Catalogue') +
    '</span>, ' +
    'and how they are sorted in <span data-cbsid="CAT004-C10" onclick="navTo(\'categories\')" style="color:var(--blue);font-weight:600;cursor:pointer">' +
    tx('Categories') +
    '</span>.</div>' +
    /* ⭐ WHERE AND HOW THE CATALOGUE STANDARDS ARE IMPLEMENTED — read from the STANDARDS register, so this
       screen states nothing of its own and cannot fall out of step with Settings › Standards. Renders only in
       🧾 Spec, so an ordinary setup screen is unchanged. */
    '</div>' +
    specStandards('catalogue') +
    '<div class="rows" id="catset_rows" tabindex="0" role="region" aria-label="' + esc(tx('Catalogue setup')) + '">' +
    catsetRowsHTML() +
    '</div></div>';
  var detail = '<div class="detail" id="detailpane">' + catsetDetailHTML() + '</div>';
  var divider =
    '<div class="divider" id="divider" onmousedown="startDrag(event)" ontouchstart="startDrag(event)" role="separator" aria-label="Resize panes"><span class="grip"></span></div>';
  var showDetail = UI.vp === 'mob' && UI.mdetail;
  /**
   * ⚠️ ITS OWN WIDTH, NOT THE CHIT LIST'S. This read `UI.lw` — the width of the Task/Order chit list, persisted
   * as `cb_lw`. Drag that list wider to read long subjects and this menu grows with it: measured at **1031px**
   * for seven fixed rows, while the detail pane — which holds everything you actually came to read — was left
   * 439px and wrapped the units into a narrow column.
   *
   * ⚠️ The two panes are not the same kind of thing. A chit list is DATA and earns width; this is a fixed menu
   * of seven and never needs more. MIS and Profile already keep their own `misLw` for exactly this reason —
   * this is that established pattern, not a new one.
   *
   * Still draggable, and still clamped to 42% of the window so it can never swallow the detail again.
   */
  if (UI.catsetLw == null) UI.catsetLw = 320;
  var lw = Math.min(UI.catsetLw, Math.max(260, Math.round((window.innerWidth || 1200) * 0.42)));
  return (
    '<div class="panel ' +
    (showDetail ? 'showdetail' : '') +
    '" id="panel" style="--lw:' +
    lw +
    'px;--lh:' +
    UI.lh +
    'px">' +
    list +
    divider +
    detail +
    '</div>'
  );
}
function catsetCss() {
  if (document.getElementById('catset_css')) return;
  var node = document.createElement('style');
  node.id = 'catset_css';
  node.textContent = [
    '.catset-card{border:1px solid var(--line);border-radius:12px;background:var(--card);margin-bottom:12px;overflow:hidden}',
    '.catset-ct{font-size:var(--fs-3);font-weight:700;padding:11px 14px 0}',
    '.catset-cb{font-size:var(--fs-2);line-height:1.6;color:var(--ink);padding:6px 14px 12px}',
    /* The standards note is set apart because it explains the WHY, which a person reads once and then never
       again — it must be skippable without losing the instruction above it. */
    '.catset-std{font-size:var(--fs-2);line-height:1.6;color:var(--grey);background:var(--paper);border:1px solid var(--line);',
    'border-radius:9px;padding:9px 11px;margin-top:10px}',
    '.catset-ca{display:flex;flex-wrap:wrap;gap:8px;padding:0 14px 13px}',
    '.catset-ca .composebtn{width:auto;padding:8px 14px}',
    '.catset-load,.catset-none{font-size:var(--fs-2);color:var(--grey);padding:2px 0 4px}',
    '.catset-dlist{border:1px solid var(--line);border-radius:9px;overflow:hidden}',
    '.catset-drow{display:flex;align-items:center;gap:9px;padding:8px 11px;font-size:var(--fs-2);',
    'border-bottom:1px dashed var(--line);flex-wrap:wrap}',
    '.catset-drow:last-child{border-bottom:0}',
    '.catset-drow.ret{opacity:.72}',
    '.catset-drow.ret .dn{text-decoration:line-through;color:var(--grey)}',
    '.catset-drow .dn{font-weight:600;flex:1;min-width:0}',
    /* The author's own note — its own line under the name, so it never crowds the row a person scans. */
    '.catset-drow .dnote{flex-basis:100%;font-size:var(--fs-1);color:var(--grey);line-height:1.4;margin:-2px 0 1px}',
    '.catset-drow .dk{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:var(--fs-1);',
    'background:var(--paper);border:1px solid var(--line);border-radius:5px;padding:1px 6px;color:var(--grey)}',
    '.catset-drow .dst{font-size:var(--fs-1);font-weight:700;border-radius:6px;padding:1px 7px;text-transform:uppercase;letter-spacing:.04em}',
    '.catset-drow .dst.live{background:var(--ok-tint);color:var(--ok-2)}',
    '.catset-drow .dst.draft{background:var(--warn-tint);color:var(--warn-2)}',
    '.catset-drow .dst.retired{background:var(--neutral-tint);color:var(--ink-2)}',
    '.catset-drow .da{font-size:var(--fs-1);color:var(--blue);cursor:pointer;font-weight:600}',
    '.catset-drow .da:hover{text-decoration:underline}',
    /* The vocabulary blocks. Quieter than the controls above them — this is reference, not something to act on. */
    '.catset-reg{border:1px solid var(--line);border-radius:12px;background:var(--paper);margin-bottom:12px;overflow:hidden}',
    '.catset-regh{display:flex;align-items:center;gap:8px;padding:10px 13px 0;font-size:var(--fs-2);font-weight:700}',
    '.catset-regn{margin-inline-start:auto;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:var(--fs-1);',
    'color:var(--grey);background:var(--card);border:1px solid var(--line);border-radius:20px;padding:1px 8px}',
    '.catset-regb{font-size:var(--fs-2);line-height:1.55;color:var(--grey);padding:4px 13px 9px}',
    '.catset-regrows{display:flex;flex-direction:column;gap:1px;background:var(--line);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}',
    /* Two lines: identity, then explanation. See the note where the markup is built. */
    '.catset-regrow{display:block;background:var(--card);padding:7px 13px;font-size:var(--fs-2)}',
    '.catset-regrow .rr1{display:grid;grid-template-columns:112px minmax(0,1fr);align-items:baseline;gap:10px}',
    '.catset-regrow.nocode .rr1{grid-template-columns:minmax(0,1fr)}',
    /* A tickable registry gains a checkbox column; the note indents past it so both lines share one left edge. */
    '.catset-regrow.pick{display:block;cursor:pointer}',
    '.catset-regrow.pick .rr1{grid-template-columns:22px 112px minmax(0,1fr);align-items:center}',
    '.catset-regrow.pick.nocode .rr1{grid-template-columns:22px minmax(0,1fr)}',
    /* ⚠️ The note no longer indents — see the .rn rule. These two overrides existed only to keep the indent
       lined up with the checkbox column, and there is no indent left to line up. */
    '.catset-regrow.pick:hover{background:var(--paper)}',
    /* ⚠️ Unticked stays READABLE — you have to be able to read a thing to decide you want it back. */
    '.catset-regrow.off code,.catset-regrow.off .rl{color:var(--grey)}',
    '.catset-regrow code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:var(--fs-1);color:var(--ink)}',
    '.catset-regrow .rl{color:var(--ink)}',
    /**
     * ⭐⭐ THE NOTE TAKES THE FULL STRETCH, IN A BOX (Athi, 2026-08-17: *"under pricing, fixed, range underneath
     * lot of space but the notes in the right hand occupies lot of space, so if the notes can be placed in the
     * entire stretch within a box… it will look good and also reduce space"*).
     *
     * ⚠️ THE INDENT WAS COSTING HEIGHT, NOT BUYING ALIGNMENT. `padding-inline-start:122px` pushed every note into a
     * narrow right-hand column so it could line up under the name. In this pane — which defaults to 320px — that
     * left the note about 172px of the 294px available, so a two-line explanation wrapped to four or five, the
     * row grew tall, and the space beside the short label ("fixed", "range") sat empty. The alignment it bought
     * was real and it was worth far less than the height it cost.
     *
     * Full width gives the note ~70% more room per line, which is roughly 40% fewer lines. The BOX is what
     * keeps it from reading as a second name now that it no longer sits in its own column: a tinted ground and
     * a rule down the left say "this belongs to the row above" without spending any horizontal space to say it.
     */
    '.catset-regrow .rn{margin-top:5px;padding:5px 9px;background:var(--neutral-tint);color:var(--note);' +
      'border-inline-start:2px solid var(--line);border-radius:0 6px 6px 0;font-size:var(--fs-1);line-height:1.45}',
    '.catset-regrow.nocode .rn{padding-inline-start:0}',
    /* ⚠️ A LIST OF BARE WORDS IS NOT A TABLE. When a registry's rows carry no code and no note — units are the
       case: fifteen entries, one short word each — stacking them full-width spends fifteen rows and most of the
       pane's width on nothing, and the eye has to travel a screen to read what fits on two lines. Chips give the
       same information at a glance. ⚠️ Applied only when there IS nothing else to show: the moment a row has a
       note (datatypes: "expiry, harvest") the rows are right, because then the label needs something aligned
       beside it. */
    /* ⚠️ ONE GRID TEMPLATE FOR THE HEADER AND EVERY ROW — that is what makes the columns actually line up.
       Aligning them by padding inside separate flex rows is what produced the ragged "kg   KG" look. */
    /* ⚠️ ONE COLOUR FOR EVERY SECOND LINE, defined once. The second line is always the same KIND of thing — an
       explanation or a set of spellings — so it must look the same everywhere it appears, or the reader has to
       re-learn the page in each section. Slate-blue rather than plain grey: visibly a different hue from the
       near-black name, so the two never blur, while still clearly secondary. */
    ':root{--note:#5a7290}',
    '.uom-hd{display:grid;grid-template-columns:22px 76px minmax(0,1fr);align-items:center;gap:10px;padding:5px 13px;font-size:11px;color:var(--grey);text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--line)}',
    '.uom-hd code,.uom-hd .un{font-size:var(--fs-1);color:var(--grey)}',
    '.uom-row{display:block;border-bottom:1px solid var(--line);cursor:pointer;font-size:var(--fs-2);padding:6px 13px}',
    '.uom-row .ur1{display:grid;grid-template-columns:22px 76px minmax(0,1fr);align-items:center;gap:10px}',
    '.uom-row:hover{background:var(--paper)}',
    '.uom-row code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:var(--fs-1);color:var(--ink)}',
    '.uom-row .un{color:var(--ink)}',
    /* The spellings, indented to sit under the NAME so the eye reads down one edge. */
    '.uom-row .ua{margin-top:3px;padding-inline-start:108px;color:var(--note);font-size:var(--fs-1);line-height:1.5}',
    '.uom-row .ua .sep{color:var(--line);padding:0 5px}',
    /* the three answers sit under the unit, indented to the same edge as its spellings */
    '.uom-rule{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;padding:4px 13px 8px 121px;' +
      'border-bottom:1px solid var(--line);font-size:var(--fs-1);background:var(--paper)}',
    '.uom-rule.flat{color:var(--note)}',
    '.uom-rule .urk{display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-weight:600;color:var(--ink)}',
    '.uom-rule .urf{display:inline-flex;align-items:center;gap:5px;color:var(--grey-2)}',
    '.uom-rule .urf input{width:74px;font-size:var(--fs-1);padding:2px 6px;border:1px solid var(--line);' +
      'border-radius:6px;background:var(--card);color:var(--ink)}',
    '.uom-rule .uru{color:var(--note)}',
    '.uom-rule .urn{color:var(--note);flex:1 1 100%}',
    /* ⚠️ at phone width the two boxes stack rather than squeezing the labels to nothing */
    '@media(max-width:520px){.uom-rule{padding-inline-start:13px}}',
    '.lang-bar{border:1px solid var(--line);border-radius:9px;padding:8px 10px;margin:2px 0 10px;background:var(--paper)}',
    '.lang-g{display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin-bottom:5px}',
    '.lang-gh{font-size:10.5px;font-weight:800;color:var(--grey);text-transform:uppercase;letter-spacing:.05em;min-width:62px}',
    '.lang-chip{font-size:var(--fs-1);border:1px solid var(--line);border-radius:999px;padding:2px 10px;background:var(--card);cursor:pointer;white-space:nowrap}',
    '.lang-chip:hover{border-color:var(--blue)}',
    '.lang-chip.on{background:var(--blue-tint-bg);border-color:var(--blue);color:var(--blue);font-weight:700}',
    /* ⚠️ English reads as fixed, not disabled — a greyed chip invites clicking to find out why. */
    '.lang-chip.fixed{cursor:default;opacity:.9}',
    '.lang-chip .lang-none{color:var(--grey);font-size:10px;margin-inline-start:5px;font-weight:400}',
    '.lang-note{font-size:var(--fs-1);color:var(--note);line-height:1.5;margin-top:4px}',
    /* ⚠️ Unticked stays READABLE, not greyed to the floor — you have to be able to read a unit to decide you
       want it back, and a list where half the rows are illegible is a list you cannot choose from. */
    '.uom-row.off code,.uom-row.off .un{color:var(--grey)}',
    '.uom-g{margin-top:9px}',
    '.uom-gh{font-size:var(--fs-1);font-weight:800;color:var(--grey);text-transform:uppercase;letter-spacing:.05em;padding:4px 13px 3px;background:var(--paper);border-bottom:1px solid var(--line)}',
    '.catset-regrows.chips{display:flex;flex-direction:row;flex-wrap:wrap;gap:6px;background:none;border:0;padding:2px 13px 4px}',
    '.catset-regrows.chips .catset-regrow{background:var(--paper);border:1px solid var(--line);border-radius:999px;padding:3px 11px;font-size:var(--fs-1)}',
    '.catset-regsrc{font-size:var(--fs-1);color:var(--grey);padding:7px 13px}',
    '.catset-regsrc code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:var(--fs-1)}'
  ].join('');
  (document.head || document.documentElement).appendChild(node);
}

/**
 * ── ⭐⭐ THE STOREFRONT CONTROLS, IN THE HUB ────────────────────────────────────────────────────────────────────
 *
 * Athi, 2026-09-03: *"delete the old wizard."*
 *
 * ⚠️ IT COULD NOT SIMPLY BE DELETED. This section used to be a paragraph and a button that opened the six-step
 * wizard — so the hub owned nine of its ten sections and handed the tenth back to the screen it replaced. Deleting
 * the wizard first would have left storefront setup with no editor at all, which is not a migration, it is a
 * removal. The controls had to exist here before the other screen could go.
 *
 * ⭐ EVERY OPTION IS READ FROM THE REGISTRY THE CODE ALREADY PUBLISHES — CBCatalogue.METHODS · UNITS · FACETS.
 * Re-listing them here is how two lists of "the methods we support" drift apart, and this screen has already made
 * that argument twice (offers.js KINDS, cart-ui MODELS).
 */
function catsetSfHTML() {
  /**
   * ⚠️ THE CARD SURVIVES THE LOADING STATE. My first version returned a bare "reading…" while the face was in
   * flight, so the whole section — heading, explanation, everything — vanished for a beat and came back. The
   * catsetup-panels guard caught it as a THIN panel, which is exactly the shape it was built to catch: a screen
   * that shows nothing is indistinguishable from a screen that is broken. Every sibling section here keeps its
   * explanatory text outside the loading branch; this one now does too.
   */
  var _loading = CATSET_FACE === undefined;
  if (_loading) catsetFaceLoad().then(catsetPaintDetail);
  var f = CATSET_FACE || {};
  var P = typeof CBCatalogue !== 'undefined' ? CBCatalogue : null;
  if (!P) return '<div class="catset-none">' + tx('The catalogue model is not loaded.') + '</div>';

  var method = f.method || (f.order_input && f.order_input.preset) || '';
  var units = Array.isArray(f.units) ? f.units : [];
  var facets = f.facets && typeof f.facets === 'object' ? f.facets : {};
  var defUnit = (f.defaults && f.defaults.unit) || '';

  var methods = (P.METHODS || [])
    .map(function (item) {
      return (
        '<div data-cbsid="CAT004-C11" class="bulkrow' +
        (method === item.k ? ' on' : '') +
        '" data-testid="catset-sf-method-' +
        esc(item.k) +
        '"' +
        ' onclick="catsetSfMethod(\'' +
        esc(item.k) +
        '\')" style="cursor:pointer">' +
        '<span class="bn">' +
        esc(item.label) +
        '</span>' +
        '<span class="bh">' +
        (method === item.k ? esc(tx('in use')) : '') +
        '</span></div>'
      );
    })
    .join('');

  /* The catalogue's ALLOWED SET. An item picks from it; with exactly one, nobody is asked per product. */
  var known = (P.UNITS || []).slice();
  units.forEach(function (item) {
    if (known.indexOf(item) < 0) known.push(item);
  });
  var unitChips = known
    .map(function (item) {
      var on = units.indexOf(item) >= 0;
      return (
        '<button data-cbsid="CAT004-B24" type="button" class="cbpick-chip' +
        (on ? ' on' : '') +
        '"' +
        ' data-testid="catset-sf-unit-' +
        esc(item) +
        '" onclick="catsetSfUnit(\'' +
        esc(item) +
        '\')">' +
        esc(item) +
        '</button>'
      );
    })
    .join(' ');

  /**
   * ⭐ THE DEFAULT UNIT LIVES HERE, and only appears once there is a choice to make. One allowed unit IS the
   * default — asking then would be a question with one answer. See lib/defaults.js: a row that says nothing
   * inherits this, and changing it moves every row that never overrode.
   */
  var defRow = '';
  if (units.length > 1) {
    defRow =
      '<div class="catset-drow" style="margin-top:9px"><span class="dn">' +
      esc(tx('Default unit')) +
      '</span><span class="bh">' +
      units
        .map(function (item) {
          return (
            '<button data-cbsid="CAT004-B25" type="button" class="cbpick-chip' +
            (defUnit === item ? ' on' : '') +
            '"' +
            ' data-testid="catset-sf-def-' +
            esc(item) +
            '" onclick="catsetSfDefUnit(\'' +
            esc(item) +
            '\')">' +
            esc(item) +
            '</button>'
          );
        })
        .join(' ') +
      '</span></div>' +
      '<div class="catset-std">' +
      esc(tx('A product that names no unit uses this one. Change it and every ' + 'product that never set its own follows.')) +
      '</div>';
  } else if (units.length === 1) {
    defRow = '<div class="catset-std">' + esc(tx('One unit, so every product uses it — nothing to choose.')) + '</div>';
  }

  var facetRows = (P.FACETS || [])
    .map(function (item) {
      var on = !!facets[item];
      return (
        '<button data-cbsid="CAT004-B26" type="button" class="cbpick-chip' +
        (on ? ' on' : '') +
        '"' +
        ' data-testid="catset-sf-facet-' +
        esc(item) +
        '" onclick="catsetSfFacet(\'' +
        esc(item) +
        '\')">' +
        esc(item) +
        '</button>'
      );
    })
    .join(' ');

  return (
    catsetCard(
      tx('How customers order from you'),
      '<div class="catset-std">' +
        esc(tx('In PIM terms this is the channel — the same products, presented for a ' + 'particular audience. It changes what buyers see.')) +
        '</div>' +
        (_loading ? '<div class="catset-load">' + tx('reading…') + '</div>' : '') +
        '<div class="catset-sub">' +
        esc(tx('Order method')) +
        '</div>' +
        '<div class="bulklist" data-testid="catset-sf-methods">' +
        methods +
        '</div>' +
        '<div class="catset-sub" style="margin-top:12px">' +
        esc(tx('Units you trade in')) +
        '</div>' +
        '<div data-testid="catset-sf-units">' +
        unitChips +
        '</div>' +
        defRow +
        '<div class="catset-sub" style="margin-top:12px">' +
        esc(tx('What a buyer can filter by')) +
        '</div>' +
        '<div data-testid="catset-sf-facets">' +
        facetRows +
        '</div>',
      ''
    ) + catsetRegistry(['method', 'facet'])
  );
}

/** ⚠️ order_input is written BESIDE method, because the server resolves the contract from it — see order-input.js. */
function catsetSfMethod(k) {
  var f = CATSET_FACE || {};
  var oi = Object.assign({}, f.order_input || {}, { preset: k });
  catsetFaceSave({ method: k, order_input: oi }).then(catsetPaintDetail);
}

function catsetSfUnit(u) {
  var f = CATSET_FACE || {};
  var units = (Array.isArray(f.units) ? f.units : []).slice();
  var i = units.indexOf(u);
  if (i >= 0) units.splice(i, 1);
  else units.push(u);
  /**
   * ⚠️ A DEFAULT THAT IS NO LONGER ALLOWED IS NOT A DEFAULT. Removing the unit that products inherit would leave
   * every silent row pointing at something this catalogue no longer trades in — so it is cleared here rather than
   * left dangling, and with one unit remaining that unit becomes the answer on its own.
   */
  var d = Object.assign({}, f.defaults || {});
  if (d.unit && units.indexOf(d.unit) < 0) delete d.unit;
  catsetFaceSave({ units: units, defaults: d }).then(catsetPaintDetail);
}

function catsetSfDefUnit(u) {
  var f = CATSET_FACE || {};
  var d = Object.assign({}, f.defaults || {});
  d.unit = d.unit === u ? '' : u; /* pressing the current one clears it — a default is optional */
  if (!d.unit) delete d.unit;
  catsetFaceSave({ defaults: d }).then(catsetPaintDetail);
}

function catsetSfFacet(k) {
  var f = CATSET_FACE || {};
  var fa = Object.assign({}, f.facets || {});
  fa[k] = !fa[k];
  catsetFaceSave({ facets: fa }).then(catsetPaintDetail);
}
