/**
 * public/app/offer-add-confirm.js — add products to an offer: the question before a change that widens what the offer prices, and the one merged write
 *
 * OWNS      prodOfferAskWords · prodOfferNextIds · prodOfferToAll · prodOfferMoved · prodOfferConfirm · prodOfferAllWords · prodOfferApply (moved out of app.html, 2026-11-17, size ratchet; behaviour unchanged)
 * CALLED BY public/app.html (script tag before the page script; the Catalogue offers screen calls prodOfferApply); lifted by e2e/l15-confirm-money-actions.test.cjs
 * FLOW      prodOfferApply → defGet (the current version's rules) → prodOfferConfirm (CBAction.ask when the change widens the reach) → defSave as a new version
 * CARD      06-catalogue-pim/definitions-shelf
 *
 * Plain script: top-level functions are globals, like the page script they came from; they read the page's api · tx · esc · UI · toast · showBusy · hideBusy at call time.
 */
/** what the add-to-offer confirm shows: the offer (terms and window) and which products it will price */
function prodOfferAskWords(offerDef, rules, ids) {
  const names = ids.map((id) => ((UI.prods || []).find((x) => x.id === id) || {}).name || id);
  const shown = names.slice(0, 3).map(esc).join(', ') + (names.length > 3 ? ' ' + esc(txn('and {count} more', 'and {count} more', names.length - 3)) : '');
  return (
    '<div data-testid="po-ask-reach"><b>' + esc(txn('{count} product', '{count} products', ids.length)) + '</b> ' + esc(tx('will be priced by this offer')) + ': ' + shown + '</div>' +
    '<div style="margin-top:8px"><b>' + esc((offerDef && offerDef.name) || tx('This offer')) + '</b> · ' + esc(prodOfferTerms(rules)) + ' · ' + esc(prodOfferWindow(rules)) + '</div>'
  );
}
/** the item ids after the change: the picked ones unioned in (add) or differenced out */
function prodOfferNextIds(current, ids, adding) {
  const list = Array.isArray(current) ? current.slice() : [];
  if (!adding) return list.filter((item) => ids.indexOf(item) < 0);
  ids.forEach((item) => {
    if (list.indexOf(item) < 0) list.push(item);
  });
  return list;
}
/** removing the LAST product leaves an empty list, and an empty list means EVERY product */
function prodOfferToAll(change) {
  return !change.add && !change.next.length && Array.isArray(change.was) && change.was.length > 0;
}
/** the offer moved while the question was up: the answer was to the old terms, so nothing is saved */
async function prodOfferMoved(change) {
  const again = await api('defGet', { params: { id: change.id } });
  if (((again && again.definition) || {}).current_version === (change.def || {}).current_version) return false;
  toast(tx('This offer changed while you were confirming; check and try again'), true);
  return true;
}
/** ask before a change that WIDENS what the offer prices: adding products, or removing the LAST one (an empty list means EVERY product). The busy cover is lifted while the question is up; false = Cancel, nothing is written; narrowing, or an unreadable offer, asks nothing */
async function prodOfferConfirm(change) {
  const toAll = prodOfferToAll(change);
  if (!(change.add || toAll) || !change.rules.kind) return true;
  hideBusy();
  const body = toAll ? prodOfferAllWords(change.def, change.rules) : prodOfferAskWords(change.def, change.rules, change.ids);
  const title = toAll ? tx('This offer will apply to ALL products') : tx('Add to this offer?');
  if (!(await CBAction.ask({ title: title, body: body, yes: toAll ? tx('Apply to all') : tx('Add') }))) return false;
  showBusy(change.add ? txn('Adding {count} product…', 'Adding {count} products…', change.ids.length) : txn('Removing {count} product…', 'Removing {count} products…', change.ids.length));
  return !(await prodOfferMoved(change));
}

/** the words for the last-product removal: nothing narrows the offer any more, so it reaches the whole catalogue */
function prodOfferAllWords(offerDef, rules) {
  return (
    '<div data-testid="po-ask-all"><b>' + esc(tx('Removing the last product leaves nothing to narrow this offer, so it will apply to ALL products.')) + '</b></div>' +
    '<div style="margin-top:8px"><b>' + esc((offerDef && offerDef.name) || tx('This offer')) + '</b> · ' + esc(prodOfferTerms(rules)) + ' · ' + esc(prodOfferWindow(rules)) + '</div>'
  );
}
/**
 * ⚠️⚠️ THE RULES ARE ON THE VERSION, NOT ON THE DEFINITION — and reading the wrong one DESTROYS THE OFFER.
 *
 * `defList` JOINs definition_version and returns `rules`; `defGet` returns `{definition, versions}` and
 * leaves `definition.rules` NULL. My first version read `d.rules || {}` from defGet, merged the product ids
 * into an empty object, and saved that — so applying products to an offer silently erased its TERMS. The
 * kind, the tiers, the percentage: gone. The offer still existed, still looked live on every screen, and did
 * nothing at all. It happened to the test offer before this comment was written.
 *
 * ⭐ So the current version's rules are what we merge into, and the guard in prodOfferApply makes the loss impossible
 * rather than merely unlikely.
 */
async function prodOfferRead(offerId) {
  const reply = await api('defGet', { params: { id: offerId } });
  const definition = (reply && reply.definition) || {};
  const versions = (reply && reply.versions) || [];
  const current =
    versions.filter(function (item) {
      return item.version === definition.current_version;
    })[0] ||
    versions[0] ||
    {};
  /* The kind is on the DEFINITION; joining it here is what lets the guard below pass for a form-authored offer. */
  return { def: definition, rules: Object.assign({ kind: definition.sub_kind }, current.rules || definition.rules || {}) };
}
/**
 * ⚠️⚠️ AN EMPTY item_ids LIST MEANS "EVERY PRODUCT", NOT "NONE" — see CBOffers.eligibleFor, where a missing
 * selector matches every line. So removing the last product must DELETE the key, not leave it empty: an empty
 * array would silently turn a targeted discount into a shop-wide one, which is the most expensive possible
 * direction for that mistake.
 */
function prodOfferSetReach(rules, appliesTo, next) {
  if (next.length) appliesTo.item_ids = next;
  else delete appliesTo.item_ids;
  if (Object.keys(appliesTo).length) rules.applies_to = appliesTo;
  else delete rules.applies_to;
}
/** what the brand's stores had BEFORE this save — a released offer is now "changed", an unreleased one still is not out */
function prodOfferNetworkWas(offerId) {
  return (
    (
      ((typeof _DEFS !== 'undefined' && _DEFS.offer) || []).filter(function (item) {
        return item.definition_id === offerId;
      })[0] || {}
    ).network || null
  );
}
/** the toast after the save: the count, and (said at the moment it matters) that the stores do not have it yet (see netRelChip) */
function prodOfferDoneWords(adding, count, networkWas) {
  return (
    (adding
      ? txn('{count} product added to the offer ✓', '{count} products added to the offer ✓', count)
      : txn('{count} product taken off ✓', '{count} products taken off ✓', count)) +
    (networkWas && networkWas.stores > 0
      ? ' · ' +
        txn(
          'your {count} store gets it when you release it (Settings › Integrations › Network offers)',
          'your {count} stores get it when you release it (Settings › Integrations › Network offers)',
          networkWas.stores
        )
      : '')
  );
}
/** after the save: the shelf and the edit form forget their copies, the picker closes, the catalogue is read fresh */
async function prodOfferAfterSave() {
  /* ⚠️ AND core.js's live shelf, which ctOffersEnsure re-reads from. It was dropped only when the bell's "shop changed"
     arrived — a race the re-read usually won, so the tick showed the pre-attach offer ([OFF-01] / [OFF-02], 2026-09-17). */
  if (typeof _DEFS !== 'undefined') delete _DEFS.offer;
  /* The Definitions/Setup edit form saves whole rules from ITS copy — it must not keep the pre-attach one. */
  if (typeof CBDEF !== 'undefined' && CBDEF) CBDEF.mine = null;
  closeModal();
  UI.prodPicked.clear();
  UI.prodPick = false;
  await loadCatalogue('fresh');
}
/**
 * ⚠️ ONE WRITE, AND IT MERGES. The offer's reach is read, unioned (or differenced) with the selection, and saved
 * back as a new definition_version — so the change is versioned like any other change to a term of trade, and a
 * concurrent edit elsewhere cannot be silently flattened by a stale list held on this screen.
 */
async function prodOfferApply(offerId, adding) {
  const ids = Array.from(UI.prodPicked || []);
  if (!ids.length) return;
  showBusy(
    adding ? txn('Adding {count} product…', 'Adding {count} products…', ids.length) : txn('Removing {count} product…', 'Removing {count} products…', ids.length)
  );
  try {
    const { def: offerDef, rules } = await prodOfferRead(offerId);
    /**
     * ⚠️⚠️ AN OFFER WITHOUT A KIND IS NOT AN OFFER. If the read came back without terms — a shape change, a failed
     * join, anything — saving would replace a working offer with an empty one, and nothing downstream would
     * complain: CBOffers skips a kind it does not know, so the discount would simply stop applying, silently, on
     * every surface at once. Refusing costs one toast; the alternative costs a live commercial term.
     */
    if (!rules.kind) {
      hideBusy();
      toast(tx("Could not read that offer's terms, so nothing was changed. Open it in Catalogue setup first."), true);
      return;
    }
    /* ⭐ ADDING products widens what the offer prices: ask first, showing the reach. Reads above change nothing; the first write is the defSave below. */
    const appliesTo = Object.assign({}, rules.applies_to || {});
    const next = prodOfferNextIds(appliesTo.item_ids, ids, adding);
    if (!(await prodOfferConfirm({ id: offerId, add: adding, def: offerDef, rules: rules, ids: ids, was: appliesTo.item_ids, next: next }))) return;
    prodOfferSetReach(rules, appliesTo, next);
    const networkWas = prodOfferNetworkWas(offerId);
    await api('defSave', { params: { id: offerId }, body: { rules: rules } });
    await prodOfferAfterSave();
    toast(prodOfferDoneWords(adding, ids.length, networkWas));
  } catch (failure) {
    toast(MSG.fail(adding ? 'add to the offer' : 'remove from the offer', failure));
  } finally {
    /**
     * ⚠️ hideBusy IN A finally, NOT ONLY IN THE CATCH. My first version hid the overlay when the save FAILED and
     * left it up when it SUCCEEDED — the exact inversion, and the kind that reads as "the app froze after it
     * worked". Every other bulk action here (prodAvailApply) already pairs them in a finally; this one now does
     * too, which is also why it is a finally rather than a third call at the end of the try.
     */
    hideBusy();
  }
}
