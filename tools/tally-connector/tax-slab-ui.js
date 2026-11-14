/* app/tax-slab-ui.js — THE SLAB PICKERS AND THE RATE CHIP, ONE COPY (F5 W1a, 2026-10-24; critic 3: "the slab UI already exists. Move it, do not build it").
 * Classic script, shared global scope. Loaded by app.html, catalogue.html and till.html AFTER engine/tax.js (CBTaxSlab · CBTaxPacks) and helpers.js (esc).
 *
 * OWNS      cbRateColumnKeys (the rate columns setOn owns: no form paints them as a free box, CAT-212) · cbSlabOptionsHTML (MOVED from app.html: the <option>s, governed first, own after) · cbcatSlabPickHTML (MOVED from cap-categories.js: the
 *           category form's picker; W1b: the host's onReady repaint and the role verdict that greys it) · cbTaxCharges (does this shop charge its tax:
 *           the twin of the api's tax-shelf.chargesTax) · cbRateMay and cbRateButtonHTML (who may set a rate — the server's may_set_rate, else owner or
 *           manager; the api's rule and sentence — and the one action, enabled by role) · cbSlabSourceWords and cbSlabChipHTML (the item row: "GST 5%" +
 *           four words of source, or the amber "No GST rate" + the host's one action) · cbSlabMenu and cbSlabMenuHTML (the ask-once menu: the shop's
 *           live slabs whose rate is on the pack's menu TODAY, the pack's suggestion for the item's code first with "Use", its citation behind ⓘ; the
 *           shop's 0% exempt slab reads "No GST (exempt)").
 * CALLED BY app.html (prodTaxHTML · prodTaxAttachHTML), cap-categories.js (cbcatPaint), cap-catsetup.js (the catalogue default), cap-definitions.js
 *           (the takeover picker), cap-catalogue.js (the item sheet's rate row), till.html (the bill's "No tax rate · Fix" ask-once sheet).
 * FLOW      resolve() → cbSlabChipHTML → Set rate → cbSlabMenu(slabs, pack, code) → cbSlabMenuHTML → the HOST confirms and writes (PATCH /products/:id
 *           on the catalogue, POST /api/till/rate at the counter) → the host repaints the row in place
 * CARD      15-tax-and-country-packs/tax-compute-rate-invoice-tax
 *
 * ⚠️ NOTHING HERE DECIDES A RATE. The engine resolves (CBTaxSlab.resolve), the pack suggests (CBTaxPacks.suggestFor) and the shop taps; a rate is
 * written only by the host through the engine's one writer (CBTaxSlab.setOn, on the server too). The words are the pack's (describe({short}) says
 * "VAT" for an AE shop); "GST" is never typed here.
 * ⚠️ tx/txf are OPTIONAL: the till has none (its `tx` is a private IndexedDB helper), so every sentence goes through slabT_.
 */

/** the engine's fifth rate key (tax.js inputOf reads it with the three CBTaxSlab exports); the only name typed here */
var CB_CESS_KEY = 'cess_rate';
/** CAT-212: the columns CBTaxSlab.setOn owns (tax_slab · tax_slab_name · gst_rate · cess_rate). A rate has ONE door (the chip and its confirm, role-gated), so a form never paints these as a free "More about" box. Import keeps the column. */
function cbRateColumnKeys() {
  var slab = typeof CBTaxSlab === 'object' && CBTaxSlab ? CBTaxSlab : {};
  return [slab.SLAB_KEY, slab.SLAB_NAME_KEY, slab.RATE_KEY, CB_CESS_KEY].filter(Boolean);
}

/** the page's translator when it has one, else the words as written (the till has no tx); {name} slots are filled either way */
function slabT_(sentence, vars) {
  if (vars && typeof txf === 'function') return txf(sentence, vars);
  if (!vars && typeof tx === 'function') return tx(sentence);
  if (!vars) return sentence;
  return String(sentence).replace(/\{(\w+)\}/g, (slot, name) => (vars[name] == null ? slot : String(vars[name])));
}

/** the id a slab row is cited by — a definition row (definition_id) or the flattened shape (id) */
function slabRowId_(slab) {
  return String(slab.definition_id || slab.id || '');
}
/** one <optgroup> of slab <option>s, the chosen one selected; the rate rides on the label when the slab has one */
function slabOptGroup_(label, slabs, selected) {
  const options = slabs.map((slab) => {
    const rate = slab.rules && slab.rules.rate != null ? ' · ' + esc(slab.rules.rate) + '%' : '';
    const chosen = String(selected || '') === slabRowId_(slab) ? ' selected' : '';
    return `<option value="${esc(slabRowId_(slab))}"${chosen}>${esc(slab.name)}${rate}</option>`;
  });
  return `<optgroup label="${esc(label)}">${options.join('')}</optgroup>`;
}
/**
 * ⭐ SLAB <option>s — THE JURISDICTION'S FIRST, THE ENTITY'S OWN AFTER. One builder for the three pickers (product ·
 * category · catalogue default). Athi, 2026-09-04: *"it has to come from governance layer and across the country"* —
 * a governed slab (`governance` set, id like IN-GST-18, served by the API from region_layer) is offered exactly like
 * an authored one; the group label says which is which. Accepts either row shape (definition_id or id).
 * MOVED from app.html (F5 W1a) so catalogue.html and the counter read the same builder; the same markup, byte for byte.
 */
function cbSlabOptionsHTML(slabs, selected) {
  const governed = (slabs || []).filter((slab) => slab.governance),
    authored = (slabs || []).filter((slab) => !slab.governance);
  let html = '';
  if (governed.length) {
    const governance = governed[0].governance || {};
    html += slabOptGroup_(((governance.jurisdiction || '') + ' ' + (governance.scheme || '')).trim() + ' · ' + slabT_('governance'), governed, selected);
  }
  if (authored.length) html += slabOptGroup_(slabT_('Your slabs'), authored, selected);
  return html;
}

/**
 * ⭐⭐ THE MIDDLE RUNG OF THE TAX INHERITANCE — Athi, 2026-09-03: *"each product has different tax criteria, so it
 * has to be product specific, but there are slabs"*.
 *
 * Tally sets a GST rate on the stock item, the stock GROUP and the company, and takes the most specific that
 * answers. This is the group rung: rice does not need its own slab if everything in Grains is 5%.
 *
 * ⚠️ IT RIDES IN `rules`, like `parent` — free-form jsonb, so a second attribute on a category costs no migration.
 * ⚠️ LIVE SLABS ONLY, and read through `cbDefsLive` — core.js's one live-definition loader, cached per kind. A
 * fourth private fetch here is how four screens come to disagree about what is on the shelf.
 * ⚠️ A category in a product's list that names no slab is SKIPPED, not treated as "no tax" — see lib/tax-slab.js.
 * MOVED from cap-categories.js (F5 W1a); it repaints that file's form (cbcatPaint) once the slabs arrive.
 * W1b (R85): `opts.onReady` is the HOST's repaint once the slabs arrive (catalogue.html's sheet; the workshop's cbcatPaint stays the default), and
 * `opts.may` (cbRateMay's verdict) greys the picker WITH the sentence for anyone but an owner or a manager — a category's slab is a rate on every item in it.
 */
function cbcatSlabPickHTML(form, opts) {
  opts = opts || {};
  var slabs = typeof cbDefsCached === 'function' ? cbDefsCached('tax') : null;
  if (slabs === null) {
    if (typeof cbDefsLive === 'function') cbDefsLive('tax').then(opts.onReady || slabPickRepaint_);
    return '<div style="font-size:var(--fs-1);color:var(--grey);margin-bottom:8px">' + slabT_('reading your slabs…') + '</div>';
  }
  /* ⚠️ An empty picker says WHY and where to go. A lone blank option reads as "this category cannot have one". */
  if (!slabs.length)
    return (
      '<div style="font-size:var(--fs-1);color:var(--grey);margin-bottom:8px">' +
      slabT_('No live slab yet — name one under {where}.', { where: '<b>' + slabT_('Catalogue setup') + ' › ' + slabT_('Tax') + '</b>' }) +
      '</div>'
    );
  return slabPickSelect_(slabs, form.default_slab || '', opts.may && !opts.may.ok ? opts.may.why : '');
}
/** the picker itself: the <select> (greyed with the reason in its title when `greyedWhy` is given) and the one line under it — the reason, or what the picker does */
function slabPickSelect_(slabs, chosen, greyedWhy) {
  return (
    '<select class="inp" data-testid="catg-slab" data-cbsid="SCR046-S01" onchange="cbcatField(\'default_slab\',this.value)"' +
    (greyedWhy ? ' disabled title="' + esc(greyedWhy) + '"' : '') +
    '>' +
    '<option value="">— ' +
    esc(slabT_('inherit the catalogue default')) +
    ' —</option>' +
    cbSlabOptionsHTML(slabs, chosen) /* the jurisdiction's slabs first, then this entity's own — one builder, three pickers */ +
    '</select>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin:-4px 0 8px"' + (greyedWhy ? ' data-testid="catg-slab-why"' : '') + '>' +
    esc(greyedWhy || slabT_('Products here that name no slab of their own use this.')) +
    '</div>'
  );
}
/** the workshop's repaint once the slabs arrive (cap-categories.js's own form) — the default onReady */
function slabPickRepaint_() {
  if (typeof CBCAT_UI !== 'undefined' && CBCAT_UI.form && typeof cbcatPaint === 'function') cbcatPaint();
}

/**
 * cbTaxCharges({ gstin, reg_type }, taxPack) → does a sale of this shop carry its tax? The twin of the api's lib/tax-shelf.chargesTax and the
 * counter's shopTax().charges: a REGULAR registration with a tax id, or a pack that collects without one (US sales tax). Never "has a GSTIN"
 * alone — a composition dealer has one and charges nothing (critic 11). `reg_type` blank = regular (the server's default).
 */
function cbTaxCharges(shop, taxPack) {
  var facts = shop || {};
  var registration = String(facts.reg_type || 'regular');
  var hasTaxId = !!String(facts.gstin || facts.gstn || '').trim();
  return registration === 'regular' && (hasTaxId || !!(taxPack && taxPack.collect_without_tax_id));
}

/** the tax pack from whatever the host holds: a regulation pack (shopPack(), shopReg(): its `.tax`) or the tax pack itself */
function slabTaxPack_(pack) {
  return pack && pack.tax && !pack.rates ? pack.tax : pack || null;
}
/** did resolve() answer a rate at all ('none' is a real answer, and it is not 0%) */
function slabHasRate_(resolved) {
  return !!resolved && resolved.source !== 'none' && resolved.rate != null;
}

/** four words of where the answer came from — for the chip beside "GST 5%" (nothing when nobody answered) */
function cbSlabSourceWords(resolved) {
  if (!slabHasRate_(resolved)) return '';
  if (resolved.source === 'product') return slabT_('on this item');
  if (resolved.source === 'category') return slabT_('from category {n}', { n: resolved.via_category_name || '' }).trim();
  if (resolved.source === 'catalogue') return slabT_('from shop default');
  return '';
}

/**
 * ⭐ WHO MAY SET A RATE — the api's own rule (lib/rate-door.js setsRate; DECISIONS 2026-10-24 14:20: owner or manager ONLY, on every door) and its own
 * sentence, said BEFORE the server has to. cbRateMay(facts) → { ok, why }. The facts are whatever the HOST holds, never a guess from a name:
 *   · the server's VERDICT `may_set_rate` (GET /entities/me/can-see-costs, api #429) — when it is there it decides, whatever else is said;
 *   · else `owner` / `is_owner` (the business itself) or `hat` === manager (a co-assist). A key, a cashier (hat act), a viewer, nobody → not ok.
 * The counter passes its person session and the staff list's hat; the catalogue and the setup pass the can-see-costs reply itself (W1b: a manager there
 * is enabled the day the api sends may_set_rate, greyed until then).
 */
var CB_RATE_ASK_OWNER = 'Ask the owner or a manager to set the tax rate.';
function cbRateMay(facts) {
  var said = facts && typeof facts.may_set_rate === 'boolean' ? facts.may_set_rate : null;
  var ok = said !== null ? said : !!facts && (facts.owner === true || facts.is_owner === true || String(facts.hat || '').toLowerCase() === 'manager');
  return { ok: ok, why: ok ? '' : CB_RATE_ASK_OWNER };
}
/**
 * cbRateButtonHTML(may, { word, onclick, cls, tid }) → the row's ONE action, shown to everyone and ENABLED by role: enabled for an owner or a manager;
 * for anyone else the same button greyed (disabled, the reason in its title) WITH the sentence beside it — never hidden
 * ([[feedback-show-action-enable-by-role]]). `word` is "Set rate" with no rate yet, "Change" when one is set.
 */
function cbRateButtonHTML(verdict, opts) {
  opts = opts || {};
  var allowed = !!(verdict && verdict.ok);
  var testId = opts.tid ? ' data-testid="' + esc(opts.tid) + '"' : '';
  var button =
    ' <button type="button" class="' + esc(opts.cls || 'act quiet') + '"' + testId + (allowed ? '' : ' disabled title="' + esc(verdict.why) + '"') +
    ' onclick="' + esc(opts.onclick || '') + '" data-cbsid="SCR046-B01">' + esc(opts.word || slabT_('Set rate')) + '</button>';
  return allowed ? button : button + ' <span class="sub" data-testid="' + esc((opts.tid || 'rate') + '-why') + '">' + esc(verdict.why) + '</span>';
}

/**
 * cbSlabChipHTML(resolved, { country, action, tid }) → the item row's chip.
 * A rate: a green chip with describe({short}) ("GST 5%") plus the source words. No rate: an amber "No GST rate yet". Either way the host's ONE
 * action follows (`action`, HTML — cbRateButtonHTML: "Set rate" / "Change", enabled by role). The chip is CBTaxSlab.describe's words, so the
 * counter, the pane and the chit never phrase one answer two ways (critic 3).
 */
function cbSlabChipHTML(resolved, opts) {
  opts = opts || {};
  var engine = window.CBTaxSlab;
  var words = engine && engine.describe ? engine.describe(resolved || {}, { short: true, country: opts.country }) : '';
  var testId = opts.tid ? ' data-testid="' + esc(opts.tid) + '"' : '';
  if (!slabHasRate_(resolved)) return '<span class="tag amber" data-tone="none"' + testId + '>' + esc(words) + '</span>' + (opts.action || '');
  var from = cbSlabSourceWords(resolved);
  return '<span class="tag green" data-tone="rate"' + testId + '>' + esc(words) + '</span>' + (from ? ' <span class="sub">' + esc(from) + '</span>' : '') + (opts.action || '');
}

/** a live slab row (a definition row carries `status`; a shelf row has none and is live) normalised by the engine, else null */
function slabLive_(rawSlab) {
  var engine = window.CBTaxSlab;
  if (!rawSlab || (rawSlab.status && rawSlab.status !== 'live')) return null;
  return engine && engine.slabOf ? engine.slabOf(rawSlab) : null;
}
/** one slab as a menu row, or null when it cannot be cited today (no rate · not live · a rate off the menu in force) */
function slabMenuRow_(rawSlab, allowedRates) {
  var slab = slabLive_(rawSlab);
  if (!slab || slab.rate == null) return null;
  var rate = Number(slab.rate);
  if (allowedRates && allowedRates.indexOf(rate) < 0) return null;
  return { id: slab.id, name: slab.name || '', rate: rate, nil_kind: slab.nil_kind || null, suggested: false };
}
/** the live slabs that CAN be cited today, by rate: when the pack dates its menu (menuAsOf), a dead 12% is never offered */
function slabMenuRows_(slabs, taxPack) {
  var packs = window.CBTaxPacks;
  var menu = packs && packs.menuAsOf ? packs.menuAsOf(taxPack) : null;
  var allowedRates = menu && Array.isArray(menu.rates) ? menu.rates : null;
  var rows = (slabs || []).map((rawSlab) => slabMenuRow_(rawSlab, allowedRates)).filter(Boolean);
  rows.sort((left, right) => left.rate - right.rate);
  return { rows: rows, cite: menu && menu.cite ? menu.cite : null };
}
/** the pack's suggestion row as the screen offers it: "996331 · restaurant · 5%", the name, the one-line note and the citation behind ⓘ */
function slabSuggestionWords_(suggested, code, slabId) {
  var cleanCode = String(code || '').replace(/\s+/g, '');
  return {
    code: cleanCode,
    slab_id: slabId,
    rate: Number(suggested.rate),
    words: cleanCode + ' · ' + String(suggested.id || '').replace(/_/g, ' ') + ' · ' + suggested.rate + '%',
    name: suggested.name || '',
    note: suggested.note || '',
    cite: suggested.cite || ''
  };
}
/** the pack's suggestion for this code, pointed at the shop's slab of that rate (null when the pack has none for it) */
function slabSuggestion_(rows, pack, code) {
  var packs = window.CBTaxPacks;
  var suggested = packs && packs.suggestFor && pack ? packs.suggestFor(pack, code) : null;
  if (!suggested) return null;
  var matching = rows.filter((row) => row.rate === Number(suggested.rate))[0] || null;
  if (matching) matching.suggested = true;
  return slabSuggestionWords_(suggested, code, matching ? matching.id : null);
}

/**
 * a menu button's face: "GST 5%"; the shop's 0% slab whose nil_kind is exempt reads "No GST (exempt)" — the one button the critic's copy asks for.
 * ⚠️ It EXISTS only when the shop authored such a slab AND 0 is on today's menu (slabMenuRow_): no slab, no button, never an invented one.
 */
function slabRowWords_(row, scheme) {
  if (row.nil_kind === 'exempt') return slabT_('No {t} (exempt)', { t: scheme });
  return scheme + ' ' + row.rate + '%';
}

/**
 * ⭐ cbSlabMenu(slabs, pack, code) → { scheme, rows:[{ id, name, rate, words, suggested }], suggestion, cite }
 * The ask-once menu, as DATA: the shop's live slabs on today's menu (3 to 5 big buttons), and the pack's SUGGESTION for the item's SAC / HSN
 * (tax-packs.suggestFor: "996331 · restaurant · 5%") pointing at the slab of that rate, first. A pack without `suggest` (AU · AE) answers none.
 * ⚠️ `code` is a shop code or an HSN — it is only ever used to SUGGEST (critic 12), never to stamp. The rows are slab ids, because the api's
 * rate door takes a slab_id, never a bare rate: a shop with no 5% slab is told so (rows empty), not handed an invented one.
 */
function cbSlabMenu(slabs, pack, code) {
  var taxPack = slabTaxPack_(pack);
  var scheme = (taxPack && taxPack.scheme) || slabT_('Tax');
  var built = slabMenuRows_(slabs, taxPack);
  var rows = built.rows.map(function (row) {
    row.words = slabRowWords_(row, scheme);
    return row;
  });
  var suggestion = slabSuggestion_(rows, taxPack, code);
  if (suggestion && suggestion.slab_id) rows = rows.filter((row) => row.suggested).concat(rows.filter((row) => !row.suggested));
  return { scheme: scheme, rows: rows, suggestion: suggestion, cite: built.cite };
}

/** the citation behind ⓘ — a <details>, so it costs no script and never a paragraph on the face of the sheet */
function slabCiteHTML_(suggestion) {
  if (!suggestion || (!suggestion.note && !suggestion.cite)) return '';
  var whyWord = esc(slabT_('Why'));
  return (
    '<details class="slab-cite" data-testid="rate-cite"><summary aria-label="' + whyWord + '" title="' + whyWord + '">ⓘ</summary><div class="sub">' +
    (suggestion.name ? '<b>' + esc(suggestion.name) + '</b><br>' : '') +
    (suggestion.note ? esc(suggestion.note) + '<br>' : '') +
    esc(suggestion.cite) +
    '</div></details>'
  );
}
/** what a button says: the suggested row "996331 · restaurant · 5%" with Use under it, any other its words with the slab's name under */
function slabMenuFace_(row, menu, opts) {
  if (row.suggested && menu.suggestion) return esc(menu.suggestion.words) + '<span class="u">' + esc(opts.useWord || slabT_('Use')) + ' · ' + esc(row.name) + '</span>';
  var nameLine = row.name && row.name !== row.words ? '<span class="u">' + esc(row.name) + '</span>' : '';
  return esc(row.words) + nameLine;
}
/** one big button, with the host's own onclick; the suggested one carries its citation behind ⓘ */
function slabMenuButton_(row, menu, opts) {
  var isSuggested = !!(row.suggested && menu.suggestion);
  var onclick = opts.pick ? opts.pick(row.id) : '';
  return (
    '<button type="button" class="' + esc(opts.cls || 'choice') + (isSuggested ? ' suggested' : '') + '" data-testid="rate-pick-' + esc(row.id) + '" data-rate="' + esc(row.rate) + '" onclick="' + esc(onclick) + '" data-cbsid="SCR046-B02">' +
    slabMenuFace_(row, menu, opts) +
    '</button>' +
    (isSuggested ? slabCiteHTML_(menu.suggestion) : '')
  );
}
/**
 * cbSlabMenuHTML(menu, { pick, cls, useWord }) → the big buttons. `pick(slab_id)` returns the host's onclick (a string); `cls` the host's button
 * class ('choice' at the counter, 'act quiet' on the catalogue). The suggestion is the first button, marked "Use", its citation behind ⓘ.
 * No rows: the one sentence that says where a slab is made (never a lone blank).
 */
function cbSlabMenuHTML(menu, opts) {
  opts = opts || {};
  menu = menu || { rows: [] };
  if (!menu.rows.length)
    return '<div class="sub" data-testid="rate-none">' + esc(slabT_('No {t} slab yet — Catalogue setup › Tax', { t: menu.scheme || slabT_('tax') })) + '</div>';
  return '<div class="slab-menu" data-testid="rate-menu">' + menu.rows.map((row) => slabMenuButton_(row, menu, opts)).join('') + '</div>';
}
