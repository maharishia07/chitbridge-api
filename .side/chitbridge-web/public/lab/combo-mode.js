/* public/lab/combo-mode.js — THE COMBO LAB, AS A MODE OF THE OFFER LAB (T2-LABS · LABS-1, 2026-10-14).
 *
 * Athi: "our labs should not use a separate piece of code". combo-lab.html was a 3,100-line COPY of offer-lab-next.html
 * (an older one, kept inert under a permanently open modal — its own words) plus this block. The copy is gone: the Offer
 * Lab loads this file, and offer-lab-next.html?mode=combo boots straight into the builder below (combo-lab.html now only
 * forwards there, so every old link — the till's hub, Catalogue setup, the other labs — still lands here).
 *
 * ⭐ MOVED AS IT WAS, function for function, from combo-lab.html — nothing here is new behaviour. It reads the Offer Lab's
 * own state and helpers (S · P · byId · esc · M0 · apiFetch · setCost · openPickOverlay · labUseMine …) and CBVariant,
 * exactly as it did when it sat in the same script. Styles: lab/combo-mode.css. Markup: #modLabOverlay and
 * #comboTillPreviewOverlay in offer-lab-next.html.
 * Flow: catalogue · Definitions shelf — combo / modifier templates (07-offers-pricing-and-combos, Combo Lab).
 * CALLED BY offer-lab-next.html (loaded by it; ?mode=combo boots the builder) and combo-lab.html (forwards there).
 * FLOW  offer-lab-next boots → comboBoot reads the Offer Lab state → builder paints → save a template      CARD 29-qa-test-tooling-ux-locale-and-design-system/offer-lab
 */
/**
 * ── ⭐⭐⭐ THE MODIFIER LAB — TRY IT, THEN APPLY IT (Athi: "so people can try how the modifiers can be
 * created and once if they are happy, we would be able to save that modifier and apply it to the real
 * product. which is apply button so it will be part of the product catalogue") ─────────────────────────────
 *
 * ⚠️ EVERY ACTION HERE EDITS A LOCAL DRAFT ONLY (held right on the in-memory product, p.modifiers) — unlike
 * app.html's Modifiers tab, which saves each action at once because it IS the authoritative place to edit a
 * real product. Here the whole point is trying something before committing to it, so nothing reaches the
 * real catalogue until "Apply" is pressed — the same merge:true PATCH setCost() already uses, and, like
 * setCost(), only when a real signed-in catalogue is loaded (S.biz==='mine' && savedLive()). On the sample
 * books "Apply" still works, just locally — there is nothing real to write to.
 * ⚠️ THE PREVIEW IS THE SAME CAPABILITY app.html's tab USES — CBVariant.groupsOf()/toggle()/missing()/words(),
 * not a second implementation of "what does trying this feel like".
 */
var MODLAB = { pid: null, q: '', building: false, draft: [], name: '', price: '', templateId: null, libraryOpen: false, savingAs: false },
  MODLABPREV = [];
/** ⭐ the saved-combo library (b266) — loaded once per open, refreshed after a save or a delete */
var COMBO_LIB = { items: null, loaded: false };
/**
 * ⚠️⚠️⚠️ [OFFR-03→OFFR-06] "CREATE NEW COMBO" — from a static example to a real builder + saved library.
 *
 * [OFFR-03] (2026-09-25, earlier the same day) taught the per-product model with one hardcoded, read-only
 * CBVariant.exampleGroup() text box: "Extra toppings / Extra cheese +₹20", never interactive, the same for
 * every merchant. Athi, testing it: "the example shown is very pathetic... what i want is something similar
 * to the combo offer in a popup window with possibly combination, and also with save as option, if we are
 * doing save as feature then we should be having a mechanism of open the same again."
 *
 * That static box is gone. In its place:
 *   - modLabBuildFresh() opens a REAL builder — the exact group-editor and live "what a customer sees"
 *     preview the per-product screen already had, now usable BEFORE picking a product (comboGroupsEditorHTML/
 *     comboPreviewHTML below, extracted so there is one implementation, not two that can drift).
 *   - "💾 Save as…" (modLabSaveAsOpen/Confirm) — POSTs to /api/combo-templates (b266, [OFFR-06]).
 *   - "📂 My saved combos" (modLabOpenLibrary/UseTemplate/DeleteTemplate) — the "mechanism to open the same
 *     again": a named, reusable library, independent of any one product. Athi: "can we do one and we can
 *     translate later as a standalone example?" — this is that standalone record, the data-model decision
 *     BACKLOG.md had logged as deferred under [OFFR-03].
 * ⭐ Every editing verb (modLabSetGroup/AddOption/…) already reads/writes through modLabGroups()/
 *   modLabSetGroups() below — making THOSE TWO draft-aware (a product's own modifiers, or a not-yet-attached
 *   draft) is the only change the existing editing code needed; nothing else duplicated.
 */
function modLabOpen() {
  return !!(document.getElementById('modLabOverlay') || {}).classList.contains('on');
}
function openModLab() {
  MODLAB = { pid: null, q: '', building: false, draft: [], name: '', price: '', templateId: null, libraryOpen: false, savingAs: false, tab: 'mods' };
  MODLABPREV = [];
  var el = document.getElementById('modLabOverlay');
  if (!el) return;
  el.classList.add('on');
  var node = document.getElementById('modLabSearch');
  if (node) {
    node.value = '';
  }
  paintModLab();
  if (node) node.focus({ preventScroll: true });
  comboLibLoad(false).then(paintModLab); /* background — so the Combos tab's own count is right by the time it's looked at */
}
/** ⭐ [2026-09-27] tab switch: MODLAB.tab decides which top-level list paintModLab() shows (see its own
 *  header comment) — distinct from MODLAB.libraryOpen, which stays the existing "pull a saved combo's
 *  groups into what I'm building right now" picker, reachable from inside the builder/editor regardless of
 *  which tab this is. #modLabSearch's value is cleared here directly rather than through a repaint, so a
 *  stale query from the OTHER tab never silently keeps filtering this one. */
function modLabTab(t) {
  MODLAB.tab = t;
  MODLAB.q = '';
  var node = document.getElementById('modLabSearch');
  if (node) node.value = '';
  if (t === 'combos') comboLibLoad(false).then(paintModLab);
  paintModLab();
}
/** ⭐ the worst a customer could add across every group at once — each group's own priciest option, summed;
 *  a product with only free options (or none) reads as "no price change", never a misleading ₹0. */
function modLabMaxUp(product) {
  var sum = 0;
  CBVariant.groupsOf({ modifiers: product.modifiers }).forEach(function (item) {
    var count = 0;
    (item.options || []).forEach(function (entry) {
      var v = Number(entry.price) || 0;
      if (v > count) count = v;
    });
    sum += count;
  });
  return sum;
}
/** ⭐ the Modifiers tab's own split — products that carry at least one group, and the rest ("Athi's own doc:
 *  '31 rows, every one showing —' ... The list now shows only what HAS something, and names it"). */
function modLabModsSplit() {
  var q = (MODLAB.q || '').trim().toLowerCase(),
    withMods = [],
    bare = [];
  P.forEach(function (item) {
    if (q && item.name.toLowerCase().indexOf(q) < 0) return;
    (CBVariant.groupsOf({ modifiers: item.modifiers }).length ? withMods : bare).push(item);
  });
  return { withMods: withMods, bare: bare };
}
/**
 * ⭐⭐⭐ [Labs split, 2026-09-26] Athi: "bring offer lab and combo lab as a separate item rather than in one
 * place. I guess combo lab earned its place now." This file is the STANDALONE Combo Lab — a copy of
 * offer-lab-next.html's own shared machinery (catalogue loading, apiFetch, money/esc helpers — nothing here
 * duplicates logic, it duplicates the FILE, the same way till.html/app.html each already carry their own copy
 * of these small helpers rather than sharing one) with Offer Lab's percent/amount/qty screens left inert
 * underneath a permanently-open modal: this page boots straight into the modifier/combo builder and there is
 * nothing behind it a person could reach.
 * ⚠️ SO CLOSING IT MEANS CLOSING THE TAB, not revealing an Offer Lab screen nobody asked for — the one real
 * behaviour change from offer-lab-next.html's own closeModLab(), which reveals the picker it was opened from.
 * window.close() only succeeds on a tab this page (or a script) opened — true for every real entry point
 * (till.html's hub, the catalogue-setup card), so the fallback line is for the rare case it does not.
 */
function closeModLab() {
  var el = document.getElementById('modLabOverlay');
  if (el) el.classList.remove('on');
  try {
    window.close();
  } catch (e) {
    console.warn('Combo Lab: this tab could not close itself; going Home instead', e);
  }
  /* ⭐⭐⭐ [found live, 2026-10-01] "if i open the combo lab, something else is happening and then the current
     offer lab is opening" — real cause: window.close() is refused on a tab the person opened themselves (true
     for every normal entry point, not only this harness), and removing the modal class above then reveals the
     INERT copy of Offer Lab's own screens this page carries under its builder modal (see this file's own
     header comment on why they exist and are never meant to be reached). "Closed" still has to mean something:
     Home, the one place with nothing inert behind it. Runs the same tick window.close() returns on, so nothing
     renders in between. */
  location.href = '/';
}
function modLabSearch(v) {
  MODLAB.q = v;
  paintModLab();
}
function modLabPick(id) {
  MODLAB.pid = id;
  MODLAB.savingAs = false;
  MODLAB.templateId = null;
  MODLABPREV = [];
  paintModLab();
}
function modLabBack() {
  MODLAB.pid = null;
  MODLAB.savingAs = false;
  paintModLab();
}
/** ⭐⭐ [OFFR-06] DRAFT-AWARE: a product's own item_data.modifiers when one is picked, otherwise the
 *  not-yet-attached MODLAB.draft — every other editing verb calls this and modLabSetGroups() below, so
 *  making these two aware of the draft is the whole reason the builder needed no second set of verbs. */
function modLabGroups() {
  if (MODLAB.pid) {
    var node = byId(MODLAB.pid);
    if (!node) return [];
    return typeof CBVariant !== 'undefined' && CBVariant.groupsRaw
      ? CBVariant.groupsRaw({ modifiers: node.modifiers })
      : Array.isArray(node.modifiers)
        ? node.modifiers
        : [];
  }
  return typeof CBVariant !== 'undefined' && CBVariant.groupsRaw
    ? CBVariant.groupsRaw({ modifiers: MODLAB.draft })
    : Array.isArray(MODLAB.draft)
      ? MODLAB.draft
      : [];
}
/** ⭐ every editing verb funnels through here — one place that writes the draft and clears stale preview picks */
function modLabSetGroups(newGroups) {
  if (MODLAB.pid) {
    var node = byId(MODLAB.pid);
    if (!node) return;
    node.modifiers = newGroups;
  } else {
    MODLAB.draft = newGroups;
  }
  MODLABPREV = []; /* an edited group can invalidate an old pick (a removed option, a group gone) — simplest to restart */
  paintModLab();
}
/**
 * ── ⭐⭐⭐ [OFFR-06→OFFR-07] THE BUILDER — a combo before it is tied to any product ────────────────────────
 *
 * ⚠️⚠️⚠️ [OFFR-07] "the modifier example has only extra cheese only, but we need to have the entire stuff,
 * say provide the combo name, add the price, then what each section is" — Athi, pointing at the real till
 * combo chooser (a named product, a price, several clearly-purposed sections) beside this builder's one
 * lone "Extra toppings" group. Two gaps, both closed here:
 *   - comboExampleFresh() replaces the single-group CBVariant.exampleGroup() start with a worked, THREE-
 *     SECTION combo (a required "choose the main," a required "choose a drink," an optional "add extras") —
 *     the actual shape a combo needs, not one afterthought add-on.
 *   - MODLAB.name/MODLAB.price are new: the combo now has a name and a price WHILE it is being built, not
 *     only after it is attached to something that already had them. modLabCreateNew() (below) turns that
 *     into a genuinely NEW product — the standalone-combo path "Apply to a product ▸" was never able to
 *     offer, because that path only ever edits a product that already exists.
 */
function comboExampleFresh() {
  return {
    name: 'Tiffin Combo',
    price: 110,
    groups: [
      {
        name: 'Choose the main',
        required: true,
        max: 1,
        options: [
          { name: 'Masala Dosa', price: 0 },
          { name: 'Idli (2 pc)', price: 0 },
          { name: 'Ven Pongal', price: 0 }
        ]
      },
      {
        name: 'Choose a drink',
        required: true,
        max: 1,
        options: [
          { name: 'Filter Coffee', price: 0 },
          { name: 'Tea', price: 0 },
          { name: 'Buttermilk', price: 0 }
        ]
      },
      {
        name: 'Add extras',
        required: false,
        max: 2,
        options: [
          { name: 'Extra sambar', price: 20 },
          { name: 'Extra chutney', price: 15 }
        ]
      }
    ]
  };
}
function modLabBuildFresh() {
  MODLAB.building = true;
  MODLAB.savingAs = false;
  if (!MODLAB.draft.length) {
    var example = comboExampleFresh();
    MODLAB.draft = example.groups;
    MODLAB.name = example.name;
    MODLAB.price = example.price;
  }
  MODLABPREV = [];
  paintModLab();
}
function modLabResumeBuild() {
  MODLAB.building = true;
  MODLAB.savingAs = false;
  paintModLab();
}
function modLabCancelBuild(discard) {
  MODLAB.building = false;
  if (discard) {
    MODLAB.draft = [];
    MODLAB.name = '';
    MODLAB.price = '';
    MODLAB.templateId = null;
  }
  MODLAB.savingAs = false;
  MODLABPREV = [];
  paintModLab();
}
function modLabSetName(v) {
  MODLAB.name = String(v || '');
}
function modLabSetPrice(v) {
  MODLAB.price = v;
}
/**
 * ⭐⭐⭐ [OFFR-07] "CREATE AS A NEW PRODUCT" — the path Athi asked for: the combo he is naming and pricing
 * right here becomes a real, sellable product, with these groups already on it, in one step. Distinct from
 * "Apply to a product ▸" (modLabAttachDraftTo), which only ever edits a product that already exists —
 * neither replaces the other, because "I'm inventing a new combo meal" and "I'm adding a choice to
 * something I already sell" are different jobs.
 */
async function modLabCreateNew() {
  var name = String(MODLAB.name || '').trim();
  if (!name) {
    toastSay('Give this combo a name first.');
    return;
  }
  var priceNum = Number(MODLAB.price);
  if (!(priceNum > 0)) {
    toastSay('Give this combo a price first.');
    return;
  }
  var verdict = CBVariant.validate(modLabGroups());
  if (!verdict.ok) {
    toastSay('Fix this first: ' + verdict.errors[0].message);
    return;
  }
  if (!(S.biz === 'mine' && savedLive())) {
    toastSay('Sign in and use your own catalogue to create a real product.');
    return;
  }
  var item_data = { name: name, price: priceNum, modifiers: verdict.groups };
  var response = await apiFetch('POST', API + '/api/products', { item_data: item_data });
  if (!response.ok) {
    toastSay('Could not create "' + name + '": ' + ((response.body && response.body.message) || 'try again.'));
    return;
  }
  toastSay('Created "' + name + '" — ' + M0(priceNum) + ', with its combo groups already on it.');
  MODLAB.building = false;
  MODLAB.draft = [];
  MODLAB.name = '';
  MODLAB.price = '';
  MODLAB.templateId = null;
  MODLABPREV = [];
  await labUseMine(true); /* the new product needs to be in P before anything can open or show it */
  paintModLab();
  render();
}
/** ⭐ "pick a product to apply this to" — the picker's own row click, redirected while a draft is pending
 *  (see paintModLab()'s picker branch): ADDS the draft's groups to whatever that product already has,
 *  never replaces — the same "add, don't overwrite" rule modLabAddGroup() already follows. */
function modLabAttachDraftTo(id) {
  var draftGroups = CBVariant.normalize(MODLAB.draft);
  MODLAB.building = false;
  MODLAB.savingAs = false;
  MODLAB.pid = id;
  var existing = modLabGroups();
  MODLAB.draft = [];
  modLabSetGroups(existing.concat(draftGroups));
}

/**
 * ── ⭐⭐⭐ [OFFR-06] "SAVE AS" AND THE LIBRARY — the mechanism to open the same again ────────────────────────
 * Works from EITHER screen: a not-yet-attached draft, or a real product's own modifiers — either can be
 * named and saved, and either can later pull a saved combo back in.
 */
function modLabSaveAsOpen() {
  MODLAB.savingAs = true;
  paintModLab();
  var node = document.getElementById('modLabSaveName');
  if (node) node.focus();
}
function modLabSaveAsCancel() {
  MODLAB.savingAs = false;
  paintModLab();
}
async function modLabSaveAsConfirm() {
  var el = document.getElementById('modLabSaveName');
  var name = String((el && el.value) || '').trim();
  if (!name) {
    toastSay('Type a name for this combo first — that is what you’ll look for to reopen it.');
    return;
  }
  var verdict = CBVariant.validate(modLabGroups());
  if (!verdict.ok) {
    toastSay('Fix this first: ' + verdict.errors[0].message);
    return;
  }
  if (!(S.biz === 'mine' && savedLive())) {
    toastSay('Sign in and use your own catalogue to save a combo for real.');
    return;
  }
  /* ⭐ [OFFR-08] a price travels with the save too, when one is known — the combo's own (building fresh) or
   * the product's it already belongs to (editing an existing one's modifiers) — so it can be pushed/previewed
   * with a real price later without retyping it. */
  var price = MODLAB.pid ? (byId(MODLAB.pid) || {}).price : MODLAB.price !== '' ? Number(MODLAB.price) : null;
  toastSay('Saving “' + name + '” to your combos…');
  var response = await apiFetch('POST', API + '/api/combo-templates', { name: name, definition: verdict.groups, price: price });
  if (response.ok) {
    toastSay('Saved “' + name + '” — in your combo library (back office). Not on your product list yet — “Push to products” below puts it there.');
    MODLAB.savingAs = false;
    /* ⭐ [OFFR-08] "if we save or save as, we have to explicitly show preview and push" — a fresh save/save-as
     * always leaves behind a real template id, which is what makes "👁 Preview" and "✚ Push to products"
     * appear in the footer right below, instead of the person having to go find them separately. */
    MODLAB.templateId = response.body.template.id;
    await comboLibLoad(true);
  } else toastSay('NOT saved — “' + name + '” did not reach your combo library: ' + ((response.body && response.body.message) || 'try again.'));
  paintModLab();
}
/**
 * ⭐⭐⭐ [OFFR-08] "you have save as option, but no Save option, if i edit the existing combo, we have to
 * save as well" — the plain "Save," update-in-place, the way a normal document editor works: a template
 * opened for editing (MODLAB.templateId set — see modLabUseTemplate()) can be saved back onto ITSELF; "Save
 * as…" beside it still forks a new, separate copy, exactly like "Save" vs "Save as" anywhere else.
 */
async function modLabSaveConfirm() {
  if (!MODLAB.templateId) return; /* the button that calls this is only ever shown when one exists */
  var verdict = CBVariant.validate(modLabGroups());
  if (!verdict.ok) {
    toastSay('Fix this first: ' + verdict.errors[0].message);
    return;
  }
  if (!(S.biz === 'mine' && savedLive())) {
    toastSay('Sign in and use your own catalogue to save for real.');
    return;
  }
  var name = String(MODLAB.name || '').trim() || 'Untitled combo';
  var price = MODLAB.pid ? (byId(MODLAB.pid) || {}).price : MODLAB.price !== '' ? Number(MODLAB.price) : null;
  toastSay('Saving changes to “' + name + '”…');
  var response = await apiFetch('PATCH', API + '/api/combo-templates/' + MODLAB.templateId, { name: name, definition: verdict.groups, price: price });
  /* ⭐ Athi: "save, commit, update message is a must without which not able to understand the change" — a bare
   * "Saved." said nothing. This names what changed and where it landed (combo library = back office), and — if
   * this template is already live as a product — that the product itself is now out of date until pushed again. */
  if (response.ok) {
    toastSay(
      'Saved “' +
        name +
        '” — updated in your combo library (back office).' +
        (modLabTemplateLinked() ? ' The live product still has the OLD version until you push this update.' : '')
    );
    await comboLibLoad(true);
  } else toastSay('NOT saved — the update to “' + name + '” did not reach your combo library: ' + ((response.body && response.body.message) || 'try again.'));
  paintModLab();
}
/** ⭐ loaded once per Lab session (cached on COMBO_LIB), forced fresh right after a save or a delete */
async function comboLibLoad(force) {
  if (COMBO_LIB.loaded && !force) return COMBO_LIB.items || [];
  if (!(S.biz === 'mine' && savedLive())) {
    COMBO_LIB.items = [];
    COMBO_LIB.loaded = true;
    return [];
  }
  var response = await apiFetch('GET', API + '/api/combo-templates');
  if (response.ok && response.body && Array.isArray(response.body.templates)) COMBO_LIB.items = response.body.templates;
  COMBO_LIB.loaded = true;
  return COMBO_LIB.items || [];
}
async function modLabOpenLibrary() {
  MODLAB.libraryOpen = true;
  paintModLab();
  await comboLibLoad(!COMBO_LIB.loaded ? false : true);
  paintModLab();
}
function modLabCloseLibrary() {
  MODLAB.libraryOpen = false;
  paintModLab();
}
/**
 * ⭐⭐⭐ REOPENING A SAVED COMBO — two different jobs, told apart by whether anything is being built yet.
 * ⚠️ [OFFR-08] "you have save as option, but no Save option, if i edit the existing combo, we have to save
 * as well." A blank builder means this IS the thing being opened — its groups REPLACE the (empty) draft, its
 * name/price load too, and MODLAB.templateId remembers which template this is, so "💾 Save" (below) can
 * update it directly. Anything already being built means this is being COMBINED with something else — its
 * groups are ADDED, never a silent replace, and templateId stays null: a combination is not "that one
 * template" any more, only "Save as" (a new one) makes sense for it.
 */
function modLabUseTemplate(id) {
  var template = (COMBO_LIB.items || []).filter(function (x) {
    return x.id === id;
  })[0];
  if (!template) return;
  var groups = CBVariant.normalize(template.definition);
  var editing = !MODLAB.pid && !modLabGroups().length;
  if (editing) {
    modLabSetGroups(groups);
    MODLAB.name = template.name || '';
    MODLAB.price = template.price == null ? '' : template.price;
    MODLAB.templateId = template.id;
  } else {
    modLabSetGroups(modLabGroups().concat(groups));
    MODLAB.templateId = null;
  }
  MODLAB.libraryOpen = false;
  if (!MODLAB.pid) MODLAB.building = true;
  toastSay(editing ? 'Opened “' + template.name + '” to edit.' : 'Added “' + template.name + '” — ' + groups.length + ' group' + (groups.length === 1 ? '' : 's') + '.');
  paintModLab();
}
/** ⚠️ no confirm() dialog — matches this Lab's own style (✕ on a group/option removes immediately too), and
 *  deleting a SAVED combo touches nothing already applied to a product; the toast says so. */
async function modLabDeleteTemplate(id, name) {
  var r = await apiFetch('DELETE', API + '/api/combo-templates/' + id);
  if (r.ok) {
    toastSay('Deleted “' + name + '”.');
    await comboLibLoad(true);
  } else toastSay('Could not delete “' + name + '” — try again.');
  paintModLab();
}
/* ⭐ exampleGroup(), not addGroup() — see app.html's own comment on the same call; the answer to "I don't
 * know what to provide" is a worked example already on screen, not a blank field. */
function modLabAddGroup() {
  modLabSetGroups(CBVariant.exampleGroup(modLabGroups()));
}
function modLabRemoveGroup(gi) {
  modLabSetGroups(CBVariant.removeGroup(modLabGroups(), gi));
}
function modLabMoveGroup(gi, by) {
  modLabSetGroups(CBVariant.moveGroup(modLabGroups(), gi, gi + by));
}
function modLabSetGroup(gi, patch) {
  modLabSetGroups(CBVariant.setGroup(modLabGroups(), gi, patch));
}
function modLabAddOption(gi) {
  modLabSetGroups(CBVariant.addOption(modLabGroups(), gi, 'New option', 0));
}
function modLabRemoveOption(gi, oi) {
  modLabSetGroups(CBVariant.removeOption(modLabGroups(), gi, oi));
}
function modLabSetOption(gi, oi, patch) {
  modLabSetGroups(CBVariant.setOption(modLabGroups(), gi, oi, patch));
}
async function modLabApply() {
  var node = byId(MODLAB.pid);
  if (!node) return;
  var clean = CBVariant.normalize(modLabGroups());
  node.modifiers = clean; /* the Lab's own copy — true immediately, whatever the save below does */
  if (S.biz === 'mine' && savedLive()) {
    toastSay('Saving “' + node.name + '”…');
    /**
     * ⚠️⚠️ [found live-testing, 2026-09-26] Athi: "not sure whether it reflected in the back office or only
     * in the front end." The bug: apiFetch() never THROWS on a real server refusal (4xx/5xx) — it resolves
     * normally with {ok:false}. This try/catch's `catch` was therefore dead code, and EVERY refusal still
     * printed "saved to your catalogue" because nothing ever reached it. Checking r.ok/r.queued directly is
     * the fix — and it is also the honest three-way answer: saved for real, only queued (offline), or refused.
     */
    var response = await apiFetch('PATCH', API + '/api/products/' + node.id, { item_data: { modifiers: clean }, merge: true }, 'modifiers');
    if (response.queued)
      toastSay(
        'Saved here in the Lab. Offline right now — this reaches your catalogue (and then the till, on its next price refresh) once you’re back online.'
      );
    else if (response.ok) toastSay('Saved — in the Lab and in your catalogue. The till will show it next time it refreshes prices.');
    else
      toastSay(
        'Saved here in the Lab only — NOT in your catalogue: ' + ((response.body && response.body.message) || 'the save was refused') + '. The till will not see this.'
      );
  } else {
    toastSay(
      'Saved here in the Lab only — this is a sample catalogue, not yours. Sign in and use your own catalogue for this to reach your products or the till.'
    );
  }
  paintModLab();
  /* ⭐⭐⭐ THE SETTINGS SCREEN'S OWN "MODIFIERS" CARD IS render()'s JOB, NOT paintModLab()'s — its count of how
   * many items already carry one goes stale (still "No product has a modifier yet") the moment Apply actually
   * changes that count, exactly the way setCost() already avoids by calling render() on every edit. Found by
   * using the real, deployed page, not by reading the code. */
  render();
}
/**
 * ── ⭐⭐⭐ [OFFR-06] THE SHARED EDITOR — one implementation, used by the builder AND the per-product screen ──
 * Unchanged from the original per-product code except reading `groups` as an argument instead of closing
 * over `p` — same markup, same verbs (modLabSetGroup/AddOption/…, already draft-aware).
 */
function comboGroupsEditorHTML(groups) {
  var err = CBVariant.validate(groups).errors;
  var errFor = function (gi) {
    return err
      .filter(function (e) {
        return e.at === gi;
      })
      .map(function (e) {
        return e.message;
      });
  };
  return groups
    .map(function (item, index) {
      var gerr = errFor(index);
      return (
        '<div class="kv" style="padding:10px 12px;border:1px solid var(--line);border-radius:9px;margin-bottom:8px">' +
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
        '<input class="inp" style="flex:1;min-width:140px;height:38px" value="' +
        esc(item.name) +
        '" placeholder="Group name" onchange="modLabSetGroup(' +
        index +
        ',{name:this.value})">' +
        '<label style="display:flex;gap:4px;align-items:center;font-size:13px"><input type="checkbox" ' +
        (item.required ? 'checked' : '') +
        ' onchange="modLabSetGroup(' +
        index +
        ',{required:this.checked})"> Required</label>' +
        '<label style="display:flex;gap:4px;align-items:center;font-size:13px">Pick up to <input type="number" min="1" value="' +
        item.max +
        '" style="width:52px;height:32px" onchange="modLabSetGroup(' +
        index +
        ',{max:this.value})"></label>' +
        '<button class="btn sm" onclick="modLabMoveGroup(' +
        index +
        ',-1)" ' +
        (index === 0 ? 'disabled' : '') +
        '>↑</button>' +
        '<button class="btn sm" onclick="modLabMoveGroup(' +
        index +
        ',1)" ' +
        (index === groups.length - 1 ? 'disabled' : '') +
        '>↓</button>' +
        '<button class="btn sm" onclick="modLabRemoveGroup(' +
        index +
        ')">✕ Remove</button>' +
        '</div>' +
        (gerr.length
          ? '<div style="color:var(--red);font-size:12px;margin-top:4px">' +
            gerr
              .map(function (entry) {
                return esc(entry);
              })
              .join(' · ') +
            '</div>'
          : '') +
        '<div style="margin-top:8px;display:flex;flex-direction:column;gap:6px">' +
        item.options
          .map(function (entry, optionIndex) {
            return (
              '<div style="display:flex;gap:6px;align-items:center">' +
              '<input class="inp" style="flex:1;height:36px" value="' +
              esc(entry.name) +
              '" placeholder="Option" onchange="modLabSetOption(' +
              index +
              ',' +
              optionIndex +
              ',{name:this.value})">' +
              '<div class="inp" style="width:100px;height:36px"><span>₹</span><input type="number" step="0.01" value="' +
              entry.price +
              '" onchange="modLabSetOption(' +
              index +
              ',' +
              optionIndex +
              ',{price:this.value})"></div>' +
              '<button class="btn sm" onclick="modLabRemoveOption(' +
              index +
              ',' +
              optionIndex +
              ')">✕</button></div>'
            );
          })
          .join('') +
        '<button class="btn sm" style="align-self:flex-start" onclick="modLabAddOption(' +
        index +
        ')">+ Add an option</button>' +
        '</div></div>'
      );
    })
    .join('');
}
/**
 * ⚠️ [TILL/OFFR-08] THE INLINE "what a customer sees" PREVIEW USED TO LIVE HERE — a hand-rolled row of plain
 * buttons that only APPROXIMATED the real till dialog. Athi: "if it reuses what is being used in cart, then
 * there should not be any difference at all." Replaced by "👁 Preview like the till" (openComboTillPreview(),
 * above), which calls the SAME CBVariant.chooserHTML() till.html's own modPaint() calls — not a second,
 * similar-looking rendering that this file owns and could drift from the real one. Nothing here needed the
 * helper (modLabPreviewGroups()) that only this dead code called — deleted with it.
 */
/**
 * ⭐⭐⭐ Athi, live-testing: "not showing updating panel... not sure whether it reflected in the back office or
 * only in the front end... when it is pushed to product status has to change where applied. no information at
 * all." A toast fades and is easy to miss mid-edit; this is the answer that STAYS on screen — where the combo
 * actually stands right now, read fresh off MODLAB.templateId + the library's own copy, never a guess.
 */
function modLabStatusLineHTML() {
  if (!MODLAB.templateId) return '';
  var linked = modLabTemplateLinked();
  var msg = linked
    ? '✓ Saved to your combos, and live in your products — the till picks it up on its next price refresh.'
    : '✓ Saved to your combos. Not on your product list yet — "Push to products" below puts it there.';
  return '<div style="font-size:12px;color:var(--green-d);margin:-2px 0 10px;font-weight:600">' + msg + '</div>';
}
/** ⭐ the inline "Save as" row — a text input beside the page's own edits, never a native prompt() */
function comboSaveAsRowHTML() {
  if (!MODLAB.savingAs) return '';
  /* ⭐ pre-filled from the combo's own name when building fresh (it already has one to type) — never guessed
   * when editing an existing product's own modifiers, where MODLAB.name is not that product's identity. */
  var prefill = !MODLAB.pid && MODLAB.name ? esc(MODLAB.name) : '';
  return (
    '<div class="kv" style="padding:10px 12px;border:1px dashed var(--line);border-radius:9px;margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
    '<input id="modLabSaveName" class="inp" style="flex:1;min-width:180px;height:38px" value="' +
    prefill +
    '" placeholder="Name this combo — e.g. \u2018Weekday tiffin combo\u2019" onkeydown="if(event.key===\'Enter\')modLabSaveAsConfirm()">' +
    '<button class="btn sm pri" onclick="modLabSaveAsConfirm()">Save</button>' +
    '<button class="btn sm" onclick="modLabSaveAsCancel()">Cancel</button></div>'
  );
}
/** ⭐⭐⭐ "a mechanism of open the same again" — the saved-combo library, reachable from every screen */
/**
 * ── ⭐⭐⭐ [TILL/OFFR-08] THE PREVIEW POPUP — "how it appears in the counter app," literally ──────────────────
 * Athi: "the combo preview if it reuses what is being used in cart, then there should not be any difference
 * at all." COMBO_TILL_PREVIEW holds only what a chooser needs (name, price, groups) — MODLABPREV (the SAME
 * picks array the inline per-product preview already used) is reused here too, so there is exactly one
 * "what has been tapped so far" anywhere in this Lab, not a second one for this popup alone.
 */
var COMBO_TILL_PREVIEW = null; // {name, price, groups} or null when the popup is closed
/** ⭐ "👁 Preview like the till" on the builder AND the per-product screen — whichever one is open decides
 * what name/price/groups mean; the popup itself never needs to know which screen sent it. */
function modLabPreviewLikeTill() {
  if (MODLAB.pid) {
    var node = byId(MODLAB.pid);
    if (!node) return;
    openComboTillPreview(node.name, node.price, modLabGroups());
  } else openComboTillPreview(MODLAB.name || 'This combo', MODLAB.price === '' ? null : Number(MODLAB.price), modLabGroups());
}
function openComboTillPreview(name, price, groups) {
  COMBO_TILL_PREVIEW = { name: name, price: price, groups: CBVariant.groupsOf({ modifiers: groups }) };
  MODLABPREV = [];
  var el = document.getElementById('comboTillPreviewOverlay');
  if (!el) return;
  el.classList.add('on');
  paintComboTillPreview();
}
function closeComboTillPreview() {
  var el = document.getElementById('comboTillPreviewOverlay');
  if (el) el.classList.remove('on');
  COMBO_TILL_PREVIEW = null;
}
function comboTillPreviewPick(gi, oi) {
  if (!COMBO_TILL_PREVIEW) return;
  var g = COMBO_TILL_PREVIEW.groups[gi];
  if (!g || !g.options[oi]) return;
  MODLABPREV = CBVariant.toggle(MODLABPREV, g, g.options[oi].name);
  paintComboTillPreview();
}
function paintComboTillPreview() {
  var body = document.getElementById('comboTillPreviewBody'),
    foot = document.getElementById('comboTillPreviewFoot');
  var node = document.getElementById('comboTillPreviewTitle');
  if (!body || !COMBO_TILL_PREVIEW) return;
  var preview = COMBO_TILL_PREVIEW;
  if (node) node.textContent = preview.name || 'Preview';
  /* ⭐ the same "Separately ₹X" banner spot the till's #combohead sits in — here it just names the combo's
   * own price, since a draft has no "separate items" to compare against yet (see PATCHNOTE below). */
  var head = '<div class="combohead">' + esc(preview.name || 'This combo') + (preview.price != null ? '<b>' + M0(Number(preview.price)) + '</b>' : '') + '</div>';
  body.innerHTML =
    head +
    CBVariant.chooserHTML(preview.groups, MODLABPREV, {
      money: M0,
      onClick: function (gi, oi) {
        return 'comboTillPreviewPick(' + gi + ',' + oi + ')';
      },
      testIdGroup: function (gi) {
        return 'preview-modg-' + gi;
      },
      testIdOption: function (gi, oi) {
        return 'preview-modopt-' + gi + '-' + oi;
      }
    });
  if (foot) {
    var missing = CBVariant.missing(preview.groups, MODLABPREV);
    var words = CBVariant.words(MODLABPREV, M0);
    foot.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">' +
      '<span>' +
      (missing.length
        ? '<span style="color:var(--amber-i)">● Still needs: ' + esc(missing.join(', ')) + '</span>'
        : '<b>Ready' + (words ? ' — ' : '') + '</b>' + esc(words)) +
      '</span><button class="btn sm" onclick="closeComboTillPreview()">Close</button></div>';
  }
}
/**
 * ⭐⭐ [OFFR-08] "all the existing combo should appear, so it can be modified and updated in the product
 * list" — every real product that already carries modifier groups but has never been through Save As shows
 * up here too, so nothing already live is invisible to this screen. Read-only until "Use" or "Push" is
 * pressed on one — nothing is written just by opening the library.
 */
function comboLibraryUnsavedProducts() {
  if (!(S.biz === 'mine')) return [];
  var linked = {};
  (COMBO_LIB.items || []).forEach(function (item) {
    if (item.product_item_id) linked[item.product_item_id] = true;
  });
  return P.filter(function (item) {
    return !linked[item.id] && CBVariant.groupsOf({ modifiers: item.modifiers }).length > 0;
  });
}
/**
 * ⭐ [2026-09-27] SPLIT OUT OF comboLibraryHTML() so the top-level Combos TAB (comboTabHTML(), per Athi's own
 * combo-modifier-lab.html doc) and the mid-build "📂 Use a saved combo" picker (comboLibraryHTML(), unchanged
 * below) share the exact same rows/actions instead of two copies drifting apart. `filterQ` is optional and
 * used ONLY by the tab (it has a real search box); the mid-build picker has none, so it calls this with no
 * argument and stays exactly as unfiltered as it always was.
 */
function comboLibraryRowsHTML(filterQ) {
  var query = (filterQ || '').trim().toLowerCase();
  var items = (COMBO_LIB.items || []).filter(function (item) {
    return !query || (item.name || '').toLowerCase().indexOf(query) >= 0;
  });
  var live = comboLibraryUnsavedProducts().filter(function (item) {
    return !query || item.name.toLowerCase().indexOf(query) >= 0;
  });
  var rowHTML = function (template) {
    var groupCount = (template.definition || []).length,
      opts = (template.definition || []).reduce(function (total, item) {
        return total + ((item && item.options) || []).length;
      }, 0);
    var linkedProduct = template.product_item_id && S.biz === 'mine' ? byId(template.product_item_id) : null;
    return (
      '<div class="kv" style="padding:10px 12px;border:1px solid var(--line);border-radius:9px;margin-bottom:8px;display:flex;align-items:center;gap:10px;justify-content:space-between;flex-wrap:wrap">' +
      '<div><div style="font-weight:700">' +
      esc(template.name) +
      (template.price != null ? ' · ' + M0(Number(template.price)) : '') +
      '</div>' +
      '<div style="font-size:12px;color:var(--muted)">' +
      groupCount +
      ' group' +
      (groupCount === 1 ? '' : 's') +
      ' · ' +
      opts +
      ' option' +
      (opts === 1 ? '' : 's') +
      (template.product_item_id
        ? linkedProduct
          ? ' · live as "' + esc(linkedProduct.name) + '"'
          : ' · was pushed, product no longer found'
        : ' · not on your product list yet') +
      '</div></div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
      '<button class="btn sm" onclick="openComboTillPreview(\'' +
      esc(String(template.name).replace(/\\/g, '\\\\').replace(/'/g, "\\'")) +
      "'," +
      (template.price == null ? 'null' : Number(template.price)) +
      ",comboLibDef('" +
      template.id +
      '\'))">👁 Preview</button>' +
      '<button class="btn sm" onclick="modLabUseTemplate(\'' +
      template.id +
      '\')">Use</button>' +
      '<button class="btn sm pri" onclick="modLabPushTemplate(\'' +
      template.id +
      '\')">' +
      (template.product_item_id ? '⟳ Update product' : '✚ Push to products') +
      '</button>' +
      '<button class="btn sm" onclick="modLabDeleteTemplate(\'' +
      template.id +
      "','" +
      esc(String(template.name).replace(/\\/g, '\\\\').replace(/'/g, "\\'")) +
      '\')">✕</button></div></div>'
    );
  };
  /** ⭐⭐ [OFFR-08→simplified] Athi: "we don't need a permanent copy in the library, whatever exists we can
   * showcase... preview and edit option should be there." No auto-save just to be listed — this row reads
   * straight off the real product, and "✏️ Edit" opens the SAME per-product screen every product already
   * opens through, where Save as / Apply already exist. Nothing is written just by seeing this row. */
  var liveRowHTML = function (product) {
    var groupCount = CBVariant.groupsOf({ modifiers: product.modifiers }).length;
    return (
      '<div class="kv" style="padding:10px 12px;border:1px dashed var(--line);border-radius:9px;margin-bottom:8px;display:flex;align-items:center;gap:10px;justify-content:space-between;flex-wrap:wrap">' +
      '<div><div style="font-weight:700">' +
      esc(product.name) +
      ' · ' +
      M0(product.price) +
      '</div>' +
      '<div style="font-size:12px;color:var(--muted)">' +
      groupCount +
      ' group' +
      (groupCount === 1 ? '' : 's') +
      ' · already on your product list</div></div>' +
      '<div style="display:flex;gap:6px"><button class="btn sm" onclick="openComboTillPreview(\'' +
      esc(String(product.name).replace(/\\/g, '\\\\').replace(/'/g, "\\'")) +
      "'," +
      product.price +
      ',JSON.parse(this.dataset.g))" data-g=\'' +
      esc(JSON.stringify(product.modifiers || [])) +
      "'>👁 Preview</button>" +
      '<button class="btn sm pri" onclick="modLabCloseLibrary();modLabPick(\'' +
      product.id +
      '\')">✏️ Edit</button></div></div>'
    );
  };
  if (!COMBO_LIB.loaded) return '<div class="hs" style="padding:24px">Loading…</div>';
  if (!items.length && !live.length) return null;
  return items.map(rowHTML).join('') + live.map(liveRowHTML).join('');
}
function comboLibraryHTML() {
  var rows = comboLibraryRowsHTML();
  return (
    '<div style="padding:0 20px 20px">' +
    '<button class="btn sm" onclick="modLabCloseLibrary()">← Back</button>' +
    '<h3 style="margin:12px 0 10px">My saved combos</h3>' +
    (rows == null ? '<div class="hs" style="padding:24px">Nothing saved yet. Build a combo, then "💾 Save as…" to see it here.</div>' : rows) +
    '</div>'
  );
}
/**
 * ── ⭐⭐⭐ [2026-09-27, per Athi's own combo-modifier-lab.html] THE COMBOS TAB — the top-level list, not the
 * mid-build picker above. Reuses comboLibraryRowsHTML() for the SAME rows/actions; the only thing this adds
 * is the tab's own chrome — a real "Nothing matches" for a search miss vs. "No combos yet" for a genuinely
 * empty shelf, and the "+ Build a combo" entry point the doc puts in the tab's own bar. */
function comboTabHTML() {
  var rows = comboLibraryRowsHTML(MODLAB.q);
  if (rows == null) {
    return (MODLAB.q || '').trim()
      ? '<div class="empty"><b>Nothing matches</b><span>Try another word.</span></div>'
      : '<div class="empty"><b>No combos yet</b><span>Two or more products sold at one price.</span>' +
          '<button class="btn pri" onclick="modLabBuildFresh()">+ Build a combo</button></div>';
  }
  return '<div style="padding:14px 20px 20px">' + rows + '</div>';
}
function comboTabFootHTML() {
  if (!COMBO_LIB.loaded) return '';
  var n = (COMBO_LIB.items || []).length + comboLibraryUnsavedProducts().length;
  return n ? n + ' combo' + (n === 1 ? '' : 's') + ' saved.' : '';
}
/** ⭐ the Modifiers tab's own footer fact — UNFILTERED by search, a catalogue-wide count ("10 carry
 *  modifiers, 12 do not") that stays put while typing, same as Athi's own doc. */
function modLabModsTotals() {
  var withMods = 0,
    bare = 0;
  P.forEach(function (item) {
    CBVariant.groupsOf({ modifiers: item.modifiers }).length ? withMods++ : bare++;
  });
  return { withMods: withMods, bare: bare };
}
/**
 * ⭐ [found live, 2026-09-27] "Add should be in the top as a chip, not at the bottom, no one will notice" then
 * "and the item should appear as a pop up" — the old row sat at the BOTTOM of a list that, with a real
 * catalogue's worth of modifiers on it, could run to 19+ rows before it — exactly the kind of control this
 * page's own doc already warned about ("the layout did not say what the screen was for"). A chip in the bar
 * (same spot the Combos tab's own "+ Build a combo" already lives) is never scrolled past; the existing
 * 'item' picker overlay (openPickOverlay(), already proven on this page for "The item"/"They buy" elsewhere)
 * is the pop up, so nothing new had to be built to answer "which product" — modLabPickForModifiers() is just
 * that overlay's own onclick, routed the same way every other product-row click on this tab already is
 * (pendingDraft → attach the combo being built; otherwise → open that product's own editor).
 */
function modLabAddToProduct() {
  openPickOverlay('item', 'modLabPickForModifiers');
}
function modLabPickForModifiers(id) {
  if (MODLAB.draft.length > 0) modLabAttachDraftTo(id);
  else modLabPick(id);
}
function modsTabFootHTML() {
  var t = modLabModsTotals();
  return '<span><b>' + t.withMods + '</b> product' + (t.withMods === 1 ? '' : 's') + ' carry modifiers · ' + t.bare + ' do not.</span>';
}
/**
 * ── ⭐⭐⭐ [2026-09-27, per Athi's own combo-modifier-lab.html] THE MODIFIERS TAB — grouped by category (a
 * group heading, never a repeated column — the doc's own complaint: "The Category column was 'Tiffin' twelve
 * times"), showing only products that HAVE something, named ("Spice · Size", not "—"). Products with none sit
 * collapsed behind "Add modifiers to another product · N have none" until asked for — the doc's own fix for
 * "31 rows, every one showing —": 12 useful facts no longer hide among 19 blanks.
 */
function modsTabHTML(pendingDraft) {
  var totals = modLabModsTotals(),
    query = (MODLAB.q || '').trim();
  if (totals.withMods === 0 && totals.bare === 0) {
    return '<div class="empty"><b>Nothing here yet</b><span>Add products to your catalogue first.</span></div>';
  }
  if (totals.withMods === 0 && !query) {
    return (
      '<div class="empty"><b>No modifiers yet</b><span>A choice before something goes on the bill — spice level, size, an extra.</span>' +
      '<button class="btn pri" onclick="modLabAddToProduct()">Add one to a product</button></div>'
    );
  }
  var withMods = modLabModsSplit().withMods;
  var clickFn = pendingDraft ? 'modLabAttachDraftTo' : 'modLabPick';
  var listHtml = '<div class="modlist">';
  if (!withMods.length) {
    listHtml += '<div class="empty"><b>Nothing matches</b><span>Try another word.</span></div>';
  } else {
    var byCat = {},
      order = [];
    withMods.forEach(function (item) {
      var c = catName(item.cat) || '—';
      if (!byCat[c]) {
        byCat[c] = [];
        order.push(c);
      }
      byCat[c].push(item);
    });
    order.forEach(function (item) {
      listHtml += '<div class="grp">' + esc(item) + '</div>';
      byCat[item].forEach(function (entry) {
        var groups = CBVariant.groupsOf({ modifiers: entry.modifiers });
        var chips = groups
          .map(function (element) {
            return '<span class="modchip">' + esc(element.title || element.name || '') + '</span>';
          })
          .join('');
        var maxUp = modLabMaxUp(entry);
        listHtml +=
          '<button class="it" onclick="' +
          clickFn +
          "('" +
          entry.id +
          '\')"><span class="nm"><b>' +
          esc(entry.name) +
          '</b><span>' +
          chips +
          '</span></span>' +
          '<span class="rt">' +
          (maxUp ? 'up to +' + M0(maxUp) : 'no price change') +
          '</span><span class="go">›</span></button>';
      });
    });
  }
  return listHtml + '</div>';
}
/** ⭐ a saved template's own groups, for the "Preview" onclick above — kept as a tiny lookup rather than
 *  inlining the whole (possibly large) definition array into an attribute string. */
function comboLibDef(id) {
  var t = (COMBO_LIB.items || []).filter(function (x) {
    return x.id === id;
  })[0];
  return t ? t.definition : [];
}
/** ⭐ whether the CURRENT builder's saved template (MODLAB.templateId) already has a live product behind
 *  it — just the push button's own label ("Push" vs "Update"), decided here so the footer never guesses. */
function modLabTemplateLinked() {
  var t = (COMBO_LIB.items || []).filter(function (x) {
    return x.id === MODLAB.templateId;
  })[0];
  return !!(t && t.product_item_id);
}
/**
 * ⭐⭐⭐ [OFFR-08] "the saved combo should be able to push to product list as a new product... if it is an
 * existing combo... it has to update only" — POSTs to the real /:id/push, which decides create vs. update on
 * its own (never guessed here).
 */
async function modLabPushTemplate(id) {
  if (!(S.biz === 'mine' && savedLive())) {
    toastSay('Sign in and use your own catalogue to push a real product.');
    return;
  }
  toastSay('Pushing to your products…');
  var response = await apiFetch('POST', API + '/api/combo-templates/' + id + '/push');
  if (response.ok) {
    /* ⭐ Athi: "when it is pushed to product status has to change where applied. no information at all" — this
     * names BOTH halves: what happened to the PRODUCT (created vs updated, in your catalogue = back office)
     * and that the TILL only sees it on its own next price refresh, never instantly. modLabStatusLineHTML()
     * (right above the buttons, once comboLibLoad(true) below refreshes) is the part that STAYS on screen. */
    toastSay(
      (response.body.verb === 'created' ? 'Created "' : 'Updated "') +
        response.body.item.item_data.name +
        '" in your products (back office). The till will show it next time it refreshes prices.'
    );
    await labUseMine(true); /* the pushed/updated product needs to be in P before the library can show it as linked */
    await comboLibLoad(true);
  } else toastSay('NOT pushed — this combo did not reach your products: ' + ((response.body && response.body.message) || 'try again.'));
  paintModLab();
}
function paintModLab() {
  var body = document.getElementById('modLabBody'),
    foot = document.getElementById('modLabFoot');
  var tools = document.querySelector('#modLabOverlay .ovltools');
  if (!body) return;
  if (MODLAB.libraryOpen) {
    if (tools) tools.style.display = 'none';
    var tabsElLib = document.getElementById('modLabTabs');
    if (tabsElLib) tabsElLib.style.display = 'none';
    body.innerHTML = comboLibraryHTML();
    if (foot)
      foot.textContent =
        (COMBO_LIB.items || []).length +
        ' saved combo' +
        ((COMBO_LIB.items || []).length === 1 ? '' : 's') +
        ' — "Use" adds its groups to what you\u2019re building now';
    return;
  }
  if (!MODLAB.pid && !MODLAB.building) {
    if (tools) tools.style.display = '';
    var tabsEl = document.getElementById('modLabTabs');
    if (tabsEl) tabsEl.style.display = '';
    var pendingDraft = MODLAB.draft.length > 0;
    var nmods = modLabModsTotals().withMods;
    var ncombos = COMBO_LIB.loaded ? (COMBO_LIB.items || []).length + comboLibraryUnsavedProducts().length : null;
    if (tabsEl)
      tabsEl.innerHTML =
        '<button class="' +
        (MODLAB.tab !== 'combos' ? 'on' : '') +
        '" onclick="modLabTab(\'mods\')">Modifiers <span class="c">' +
        nmods +
        '</span></button>' +
        '<button class="' +
        (MODLAB.tab === 'combos' ? 'on' : '') +
        '" onclick="modLabTab(\'combos\')">Combos <span class="c">' +
        (ncombos == null ? '…' : ncombos) +
        '</span></button>' +
        '<span class="say">' +
        (MODLAB.tab === 'combos' ? 'Two or more products, one price' : 'A choice before it goes on the bill') +
        '</span>';
    var srch = document.getElementById('modLabSearch'),
      extra = document.getElementById('modLabBarExtra');
    if (srch) srch.placeholder = MODLAB.tab === 'combos' ? 'Find a combo' : 'Find a product';
    if (extra)
      extra.innerHTML =
        MODLAB.tab === 'combos'
          ? '<button class="btn pri" onclick="modLabBuildFresh()">+ Build a combo</button>'
          : '<button class="btn" onclick="modLabAddToProduct()">+ Add to another product</button>';

    var banner = pendingDraft
      ? '<div class="kv" style="margin:14px 20px 0;padding:10px 12px;border:1px solid var(--amber-i);border-radius:9px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">' +
        '<span>🔧 You have an unsaved combo ready — pick a product below to apply it.</span>' +
        '<span style="display:flex;gap:6px"><button class="btn sm" onclick="modLabResumeBuild()">Resume building</button>' +
        '<button class="btn sm" onclick="modLabCancelBuild(true)">Discard</button></span></div>'
      : '';
    body.innerHTML = banner + (MODLAB.tab === 'combos' ? comboTabHTML() : modsTabHTML(pendingDraft));
    if (foot) foot.innerHTML = MODLAB.tab === 'combos' ? comboTabFootHTML() : modsTabFootHTML();
    return;
  }
  if (tools) tools.style.display = 'none';
  var tabsElSub = document.getElementById('modLabTabs');
  if (tabsElSub) tabsElSub.style.display = 'none';
  if (MODLAB.building) {
    var dgroups = modLabGroups();
    /** ⭐⭐⭐ [OFFR-07] name + price — the combo as a whole, not just its sections. Athi: "provide the combo
     * name, add the price, then what each section is." Both are plain fields on MODLAB, read at "Create as a
     * new product" time; they mean nothing to "Apply to a product ▸" (attaching to something that already
     * has its own name and price), which is the whole reason there are now two different buttons below. */
    var nameprice =
      '<div class="kv" style="padding:10px 12px;border:1px solid var(--line);border-radius:9px;margin-bottom:10px;display:flex;gap:8px;flex-wrap:wrap">' +
      '<input class="inp" style="flex:2;min-width:180px;height:40px;font-weight:700" value="' +
      esc(MODLAB.name) +
      '" placeholder="Combo name — e.g. ‘Tiffin Combo’" onchange="modLabSetName(this.value)">' +
      '<div class="inp" style="flex:1;min-width:120px;height:40px"><span>₹</span><input type="number" step="0.01" value="' +
      esc(MODLAB.price) +
      '" placeholder="Price" onchange="modLabSetPrice(this.value)"></div>' +
      '</div>';
    body.innerHTML =
      '<div style="padding:0 20px 20px">' +
      '<button class="btn sm" onclick="modLabCancelBuild(true)">← Cancel</button>' +
      '<h3 style="margin:12px 0 2px">Build a combo</h3>' +
      '<div style="font-size:13px;color:var(--muted);margin-bottom:12px">Name it, price it, then build what each section offers.</div>' +
      nameprice +
      modLabStatusLineHTML() +
      comboGroupsEditorHTML(dgroups) +
      '<button class="btn sm" onclick="modLabAddGroup()">+ Add a group</button>' +
      ' <button class="btn sm" onclick="modLabOpenLibrary()">📂 Use a saved combo</button>' +
      ' <button class="btn sm" onclick="modLabPreviewLikeTill()">👁 Preview like the till</button>' +
      comboSaveAsRowHTML() +
      '</div>';
    if (foot) {
      foot.innerHTML =
        '<div style="display:flex;align-items:center;gap:12px;justify-content:space-between;flex-wrap:wrap">' +
        '<span>Create it as a new product, attach it to one you already sell, or just save it for later.</span>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        (MODLAB.savingAs
          ? ''
          : (MODLAB.templateId ? '<button class="btn sm" onclick="modLabSaveConfirm()">💾 Save</button> ' : '') +
            '<button class="btn sm" onclick="modLabSaveAsOpen()">💾 Save as…</button>' +
            (MODLAB.templateId
              ? ' <button class="btn sm" onclick="modLabPushTemplate(\'' +
                MODLAB.templateId +
                '\')">' +
                (modLabTemplateLinked() ? '⟳ Update product' : '✚ Push to products') +
                '</button>'
              : '')) +
        '<button class="btn sm" onclick="modLabCancelBuild(false)">Attach to a product ▸</button>' +
        '<button class="btn pri sm" onclick="modLabCreateNew()">✚ Create as a new product</button></div></div>';
    }
    return;
  }
  var node = byId(MODLAB.pid);
  if (!node) {
    modLabBack();
    return;
  }
  var groups = modLabGroups();
  body.innerHTML =
    '<div style="padding:0 20px 20px">' +
    '<button class="btn sm" onclick="modLabBack()">← All products</button>' +
    '<h3 style="margin:12px 0 2px">' +
    esc(node.name) +
    '</h3>' +
    '<div style="font-size:13px;color:var(--muted);margin-bottom:12px">' +
    esc(catName(node.cat) || '—') +
    ' · sells at ' +
    M0(node.price) +
    '</div>' +
    comboGroupsEditorHTML(groups) +
    '<button class="btn sm" onclick="modLabAddGroup()">+ Add a group</button>' +
    ' <button class="btn sm" onclick="modLabOpenLibrary()">📂 Use a saved combo</button>' +
    ' <button class="btn sm" onclick="modLabPreviewLikeTill()">👁 Preview like the till</button>' +
    comboSaveAsRowHTML() +
    '</div>';
  if (foot) {
    var canApply = S.biz === 'mine' && savedLive();
    foot.innerHTML =
      '<div style="display:flex;align-items:center;gap:12px;justify-content:space-between;flex-wrap:wrap">' +
      '<span>' +
      (canApply ? 'Applying writes to your real catalogue.' : 'Using a sample catalogue — Apply tries it here, not on a real product.') +
      '</span>' +
      '<div style="display:flex;gap:8px">' +
      (MODLAB.savingAs ? '' : '<button class="btn sm" onclick="modLabSaveAsOpen()">💾 Save as…</button>') +
      '<button class="btn pri sm" onclick="modLabApply()">Apply to ' +
      esc(node.name) +
      '</button></div></div>';
  }
}
