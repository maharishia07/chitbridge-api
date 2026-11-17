/* app/cap-shop.js — YOUR SHOP: the shop's own particulars, ONE implementation painted in two places (SET1, 2026-10-13).
 *
 * Owner, 2026-10-13: "in the index still lot of function goes to backend app, we have to ensure that all works from here." The till's
 * "GSTIN state ≠ address" and "set up GST" doors opened the workshop (app.html). What they wanted is HERE now, as a small-app screen:
 *   · the BUSINESS section of the profile — licence number (GSTIN in India) · address · supplies → PATCH /entities/profile
 *   · the vault's BUSINESS IDENTITY rows — legal name · address · city · state · PIN · phone · email → PUT /governance/profile/vault
 * Both are what api lib/profile.js `invoiceParty` reads for every invoice and what the till's shopStateClash checks. Nothing here is a
 * third writer: the two shapes that existed are the two shapes kept.
 *
 * ── WHAT IS MOVED (CLAUDE.md rule 1 — moved, never copied; cap-admin.js calls these same names) ───────────────────────────────────
 *   INCOTERMS · SHIP_MODES · VAULT_* · vaultCardHTML … saveVaultUI   — the trade documents vault (was cap-admin.js:47-243)
 *   shopLicLabel · shopFieldsHTML                                     — the Business section's label and inputs (was inline in iamHTML)
 *   SHOP_FIELDS · profFieldsBody                                      — what the section sends (was PROF_FIELDS.profile + saveProfile's loop)
 * ── WHAT IS NEW, AND WHY ───────────────────────────────────────────────────────────────────────────────────────────────────────────
 *   CBShop.mount(host, { me })  — CB Settings › Your shop: paints the two cards in a host element; nothing existing painted them outside
 *                                 the workshop's Profile pane (which needs renderApp · _capShowDetail · UI.nav).
 *   shopSave                    — the card's one Save through CBAction (M64); the workshop's saveProfile(sec) keeps its own, both send
 *                                 profFieldsBody(SHOP_FIELDS).
 *   UI._vaultOnly               — the vault card limited to one section type (identity): Your shop shows the identity rows, not the banks.
 * Host globals (as every cap-*.js): api · EP · UI · SESSION · esc · tx · txf · toast · val · _CARD · CBAction · CBLocale (optional) · CBOffline (optional).
 * Loaded by app.html through CAP_WITH.admin (before cap-admin.js) and by settings.html directly.
 * Flow step: Onboarding · country (docs/process/flows.json) and O2C · invoice — the invoice party these rows feed.
 *
 * OWNS       the Your shop card (CBShop.mount · shopSave · shopFieldsHTML · profFieldsBody) and the trade documents vault card (vaultCardHTML … saveVaultUI),
 *             with the vault's own PUT route row (vaultSave).
 * CALLED BY  public/settings.html (a <script> tag; CBShop.mount paints Your shop) · public/app.html (CAP_WITH.admin loads it before cap-admin.js, which calls the moved names).
 * FLOW       settings.html → CBShop.mount(host, { me }) → shopFieldsHTML + vaultCardHTML → a person types → shopSave (CBAction) → PATCH /entities/profile
 *             and saveVaultUI → PUT /governance/profile/vault → the card repaints from the saved answer.
 * IDS        every control carries its register code (data-cbsid, UX-137): ACC002, the Settings screen.
 * CARD 28-platform-and-operations/know-your-business
 */
'use strict';
if (typeof EP !== 'undefined') {
  Object.assign(EP, {
    vaultSave: { m: 'PUT', p: '/api/governance/profile/vault', ok: 'y' }
  });
}
// ── TRADE DOCUMENTS VAULT — the recurring inputs a business provides ONCE that pre-fill every authority form. Grouped;
// matches the backend whitelist (lib/profile.js VAULT_SCHEMA). Gather here → forms are ~70% pre-filled thereafter. ──
/* ⚠️ INCOTERMS® 2020 — THE ELEVEN RULES, IN THE ICC'S OWN TWO GROUPS. This was a free-text box with an "e.g. CIF"
   placeholder, in the one field a customs form quotes verbatim; free text there guarantees CIF / c.i.f. / "CIF
   Chennai" all meaning the same thing and none of them matching. The split is not cosmetic: FAS/FOB/CFR/CIF are
   defined ONLY for sea and inland waterway, so a business shipping by air that picks FOB has written a term that
   does not apply to its shipment. Grouping them the way the ICC does makes that visible at the moment of choosing.
   ⚠️ Adopted, not invented — this list is the standard's, and it is versioned (2020). It is the same set the
   commerce layer treats as source-entities; when that lands, this list is what it must agree with. */
var INCOTERMS = [
  [
    'Any mode of transport',
    [
      ['EXW', 'EXW — Ex Works'],
      ['FCA', 'FCA — Free Carrier'],
      ['CPT', 'CPT — Carriage Paid To'],
      ['CIP', 'CIP — Carriage and Insurance Paid To'],
      ['DAP', 'DAP — Delivered at Place'],
      ['DPU', 'DPU — Delivered at Place Unloaded'],
      ['DDP', 'DDP — Delivered Duty Paid']
    ]
  ],
  [
    'Sea and inland waterway only',
    [
      ['FAS', 'FAS — Free Alongside Ship'],
      ['FOB', 'FOB — Free on Board'],
      ['CFR', 'CFR — Cost and Freight'],
      ['CIF', 'CIF — Cost, Insurance and Freight']
    ]
  ]
];
/* Same grouped shape as INCOTERMS so one renderer serves both; an empty group name emits no <optgroup>.
   ⚠️ Value === label here on purpose: an authority form PRINTS the mode, so what is stored is what is printed. */
var SHIP_MODES = [
  [
    '',
    [
      ['Sea', 'Sea'],
      ['Air', 'Air'],
      ['Road', 'Road'],
      ['Rail', 'Rail'],
      ['Courier', 'Courier'],
      ['Multimodal', 'Multimodal']
    ]
  ]
];
/* ⭐⭐ THE VAULT IS REPEATABLE SECTIONS OF ROWS THE USER NAMES (Athi, 2026-08-16: *"add the name of the details and
   then the value as well, so we don't need to look at the entire world... we give option like bank, licence
   details and so on, let them add more rows if they want to"*).
   ⚠️ The fixed field list it replaces was entirely INDIAN — gstin·pan·iec·ad_code·lut·ifsc·pincode. A German
   supplier had nowhere to put a USt-IdNr, and every new country was a code change. Naming your own rows is
   universal by construction.
   ⚠️ SECTIONS REPEAT because one business has two banks — export receipts and domestic — each with its own
   name/IFSC/account set, which a single fixed "Banking" group could not hold at all. */
var VAULT_SECTION_TYPES = {
  identity: '🏢 Business identity',
  signatory: '✍️ Authorised signatory',
  bank: '🏦 Bank',
  licence: '🪪 Licence & registration',
  logistics: '🚢 Logistics defaults',
  other: '📋 Other details',
  signature: '🧾 Bill signature'
};
/* W27: the bill's signature is edited in Print setup (cap-print.js), never as free rows — the vault card leaves it out of its list and picker */
var VAULT_HIDDEN_TYPES = { signature: true };
/* SUGGESTED names per section — [label, tag]. ⚠️ SUGGESTIONS, NEVER RESTRICTIONS: typing anything else is
   accepted and stored as-is. Picking a suggestion sets the row's TAG, which is what lets a form pre-fill find it
   and what lets the verify layer check it. A row with no tag is a perfectly good row that simply cannot do those
   two things. This list starts at what we already had and grows when a real trade needs a name — the alternative
   was encoding every jurisdiction's registrations up front, which never converges. */
var VAULT_SUGGEST = {
  identity: [
    ['Legal name', 'legal_name'],
    ['Trade / brand name', 'trade_name'],
    ['Address', 'address'],
    ['City', 'city'],
    ['State', 'state'],
    ['PIN / ZIP', 'pincode'],
    ['Country', 'country'],
    ['Email', 'email'],
    ['Phone', 'phone']
  ],
  signatory: [
    ['Name', 'name'],
    ['Designation', 'designation']
  ],
  bank: [
    ['Bank name', 'bank_name'],
    ['Account no.', 'account_no'],
    ['IFSC code', 'ifsc'],
    ['IBAN', 'iban'],
    ['SWIFT / BIC', 'swift'],
    ['AD branch', 'ad_branch'],
    ['Branch', 'branch']
  ],
  licence: [
    ['GSTIN', 'gstin'],
    ['PAN', 'pan'],
    ['IEC', 'iec'],
    ['LUT', 'lut'],
    ['AD code', 'ad_code'],
    ['LEI', 'lei'],
    ['VAT number', 'vat'],
    ['EIN', 'ein'],
    ['CIN', 'cin']
  ],
  logistics: [
    ['Port of loading', 'port_loading'],
    ['Preferred Incoterm', 'incoterm'],
    ['Mode', 'mode']
  ],
  other: []
};
/** a section's suggestions in the shop's own words (FX-QA1 · W19): the identity's tax id, region and postal code from the pack (packWord, helpers.js),
    the bank's code word per pack, the licence's first rows per pack (ABN/ACN · TRN · GSTIN/PAN) — the TAG stays, so a form's pre-fill finds
    `state` / `pincode` / `gstin` whatever the row is called (an AU shop's "Postcode" and "ABN", a UAE shop's "Emirate" and "TRN") */
function vaultSuggest(type) {
  var countryCode = shopCc(),
    words = { state: packWord('region', countryCode), pincode: packWord('postcode', countryCode), gstin: taxIdWord(countryCode) };
  var list = (VAULT_SUGGEST[type] || []).map(function (x) {
    return words[x[1]] ? [words[x[1]], x[1]] : x;
  });
  var adjust = SUGGEST_BY_TYPE[type];
  return adjust ? adjust(list, countryCode, words) : list;
}
/** identity: the tax id (the pack's word) comes second, after the legal name */
function identitySuggest(list, countryCode, words) {
  return [list[0], [words.gstin, 'gstin']].concat(list.slice(1));
}
/** bank: the pack's own code word (BSB · IBAN · IFSC) replaces India's IFSC row, third in the list */
function bankSuggest(list, countryCode) {
  var codeWord = bankCodeWord(countryCode),
    others = list.filter(function (x) {
      return x[1] !== 'ifsc';
    });
  others.splice(2, 0, codeWord);
  return others;
}
/** licence: the tax id, India's PAN / AU's ACN, the standard licence rows, then the rest (India-only ids dropped elsewhere) */
function licenceSuggest(list, countryCode, words) {
  var isIndia = countryCode === 'IN',
    panRows = list.filter(function (x) {
      return x[1] === 'pan';
    }); /* India's second id comes from the one list above, never a second literal */
  var secondId = isIndia ? panRows : countryCode === 'AU' ? [['ACN', 'acn']] : [];
  var rest = list.filter(function (x) {
    return ['gstin', 'pan'].indexOf(x[1]) < 0 && (isIndia || ['iec', 'lut', 'ad_code'].indexOf(x[1]) < 0);
  });
  return [[words.gstin, 'gstin']].concat(secondId, LICENCE_ROWS, rest);
}
var SUGGEST_BY_TYPE = { identity: identitySuggest, bank: bankSuggest, licence: licenceSuggest };
/** W23: a licence's standard rows — name · number · issuer · valid until — offered first in every country */
var LICENCE_ROWS = [
  ['Licence name', 'licence_name'],
  ['Licence number', 'licence_no'],
  ['Issued by', 'issuer'],
  ['Valid until', 'valid_until']
];
/** W19/W23: the tags a new section of each type opens with */
var STARTER_TAGS = {
  identity: ['legal_name', 'gstin', 'address', 'state', 'pincode'],
  licence: ['licence_name', 'licence_no', 'issuer', 'valid_until'],
  bank: ['bank_name', 'account_no'],
  signatory: ['name', 'designation']
};
/** W19/W23: the rows a new section opens with — the standard fields first (country-aware), free rows still allowed after */
function vaultStarterRows(type, fill) {
  var filled = fill || {},
    suggestions = vaultSuggest(type);
  var rows = (STARTER_TAGS[type] || []).map(function (tag) {
    var suggestion = suggestions.filter(function (x) {
      return x[1] === tag;
    })[0];
    return { name: suggestion ? suggestion[0] : tag, tag: tag, value: filled[tag] || '' };
  });
  return rows.length ? rows : [{ name: '', value: '' }];
}
/* Hints only where the format cannot be guessed, keyed by TAG rather than position — a row keeps its hint
   wherever the user puts it. ⚠️ These are India-shaped on purpose (GSTIN/PAN/IFSC) but they are now attached to
   OPTIONAL tags, so a business that never uses them never sees them. */
var VAULT_HINT = {
  gstin: '15 characters',
  pan: '10 characters',
  ifsc: '11 characters',
  swift: '8 or 11 characters',
  iban: 'up to 34 characters',
  lei: '20 characters',
  iec: 'Import-Export Code',
  ad_code: 'bank AD code',
  lut: 'export LUT no.',
  port_loading: 'e.g. Nhava Sheva',
  legal_name: 'as registered',
  designation: 'e.g. Director'
};
/* ⚠️ A CLOSED SET SURVIVES INSIDE THE FREE-FORM MODEL, and the tag is what carries it: a row tagged `incoterm`
   renders the eleven ICC rules, one tagged `mode` renders the transport modes. Free-naming did not cost us the
   controlled vocabulary where a controlled vocabulary is right — it just stopped being mandatory everywhere. */
var VAULT_ENUM = { incoterm: INCOTERMS, mode: SHIP_MODES };
/** R21 (walk 2026-10-16): the identity as a LOCAL shop sees it — its rows and Save only; no section label, no + add detail, no ×, no section
    title. The export / authority controls return when the shop opts into export (no such flag exists yet, so Your shop is always plain). */
function vaultPlain() {
  return !!UI._vaultOnly;
}
function vaultCardHTML(vault, encrypted) {
  vault = vault || {};
  // F1 — honest at-rest signal. Encrypted (AES-256-GCM, key never in DB) → safe for real data; not configured → dummy only.
  var encBanner = encrypted
    ? '<div style="font-size:var(--fs-1);color:var(--ok-2);background:var(--ok-tint);border:1px solid var(--ok-3,#bfe3cb);border-radius:9px;padding:7px 10px;margin:6px 0 2px">🔒 <b>' +
      tx('Encrypted at rest') +
      '</b> <span title="' +
      esc(tx('Only ciphertext is stored. Safe for real bank and tax details.')) +
      '" style="cursor:help">ⓘ</span></div>'
    : '<div style="font-size:var(--fs-1);color:var(--warn-2);background:var(--warn-tint);border:1px solid var(--gold-line,#f0dcae);border-radius:9px;padding:7px 10px;margin:6px 0 2px">⚠ <b>' +
      tx('Encryption not configured') +
      '</b> — ' +
      esc(tx('the vault does not save yet.')) +
      ' <span title="' +
      esc(tx('The platform must set its encryption key first. Use dummy data only.')) +
      '" style="cursor:help">ⓘ</span></div>';
  var only = UI._vaultOnly || ''; /* SET1: a small app asks for ONE section type (identity); the workshop's Documents shows them all */
  var secs = (UI._vault && UI._vault.sections) || [];
  var shown = secs
    .map(function (item, index) {
      return [item, index];
    })
    .filter(function (item) {
      return (!only || item[0].type === only) && !VAULT_HIDDEN_TYPES[item[0].type];
    });
  var body = shown.length
    ? shown
        .map(function (item) {
          return vaultSectionHTML(item[0], item[1]);
        })
        .join('')
    : '<div style="color:var(--grey);font-size:var(--fs-2);padding:9px 0" data-testid="vault-empty">' + esc(tx('Nothing here yet.')) + '</div>';
  var addOpts = Object.keys(VAULT_SECTION_TYPES)
    .filter(function (item) {
      return (!only || item === only) && !VAULT_HIDDEN_TYPES[item];
    })
    .map(function (item) {
      return '<option value="' + item + '">' + esc(VAULT_SECTION_TYPES[item]) + '</option>';
    })
    .join('');
  if (only)
    return (
      '<div style="' +
      _CARD +
      ';margin-top:10px" data-testid="vault-only-' +
      esc(only) +
      '">' +
      (vaultPlain() ? '' : '<div class="sec" style="margin:0">' + esc(VAULT_SECTION_TYPES[only] || only) + '</div>') +
      encBanner +
      body +
      '<div style="display:flex;gap:7px;align-items:center;margin-top:13px;flex-wrap:wrap"><select data-cbsid="ACC002-S01" class="inp" id="v_addtype" hidden>' +
      addOpts +
      '</select>' +
      (shown.length
        ? ''
        : '<button data-cbsid="ACC002-B01" type="button" class="composebtn ghost" data-testid="vault-add-section" onclick="vaultAddSection()">+ ' +
          esc(tx('add the business identity')) +
          '</button>') +
      '</div>' +
      '<div class="err" id="vault_err" style="margin-top:8px"></div>' +
      '<button data-cbsid="ACC002-B02" type="button" class="composebtn" style="margin-top:11px;display:none" data-testid="vault-save" onclick="saveVaultUI()">' +
      esc(tx('Save')) +
      '</button></div>'
    ); /* WALK-REG 2026-10-16 R19: the rows save themselves (CBShop autosave); style display:none, a .composebtn class overrides [hidden] */
  return (
    '<div style="' +
    _CARD +
    ';margin-top:10px"><div class="sec" style="margin:0">🗂 ' +
    esc(tx('Trade documents vault')) +
    ' <span title="' +
    esc(
      tx(
        'Fill once. It pre-fills your Commercial Invoice, Packing List and other authority forms; at form time you are asked only the shipment details. Name each detail the way you know it.'
      )
    ) +
    '" style="cursor:help;font-weight:400;color:var(--grey)">ⓘ</span></div>' +
    encBanner +
    body +
    '<div style="display:flex;gap:7px;align-items:center;margin-top:13px;flex-wrap:wrap">' +
    '<select data-cbsid="ACC002-S02" class="inp" id="v_addtype" data-testid="vault-add-type" style="max-width:210px;margin:0" onchange="vaultPickType(this.value)">' +
    addOpts +
    '</select>' +
    '<button data-cbsid="ACC002-B03" class="composebtn ghost" data-testid="vault-add-section" onclick="vaultAddSection()">+ add section</button></div>' +
    '<div class="err" id="vault_err" style="margin-top:8px"></div>' +
    '<button data-cbsid="ACC002-B04" class="composebtn" style="margin-top:11px" data-testid="vault-save" onclick="saveVaultUI()">' +
    tx('Save vault') +
    '</button></div>'
  );
}
/* One section — its type, an optional label that tells two of the same kind apart, and its rows. */
function vaultSectionHTML(sec, i) {
  var rows = (sec.rows || [])
    .map(function (item, index) {
      return vaultRowHTML(item, i, index, sec.type);
    })
    .join('');
  if (vaultPlain()) return '<div style="margin-top:11px" data-testid="vault-plain">' + rows + '</div>'; /* R21 */
  return (
    '<div style="border:1px solid var(--line);border-radius:11px;padding:11px 12px;margin-top:11px;background:var(--paper);color:var(--on-bg)">' +
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">' +
    '<span style="font-size:var(--fs-2);font-weight:700;color:var(--ink)">' +
    esc(VAULT_SECTION_TYPES[sec.type] || sec.type) +
    '</span>' +
    /* ⚠️ THE LABEL IS WHAT MAKES REPEATS USABLE. Two sections both reading "Bank" are indistinguishable at a
         glance and unusable at form time — "which account do I invoice against?" has no answer. */
    '<input data-cbsid="ACC002-I01" class="inp" style="flex:1;min-width:120px;max-width:230px;margin:0;font-size:var(--fs-2)" placeholder="label it — e.g. Export receipts" value="' +
    esc(sec.label || '') +
    '" oninput="vaultSetSection(' +
    i +
    ',this.value)">' +
    '<button data-cbsid="ACC002-B05" type="button" title="Remove this section" onclick="vaultDelSection(' +
    i +
    ')" style="margin-inline-start:auto;border:1px solid var(--line);background:var(--card);color:var(--disp);border-radius:8px;min-width:28px;min-height:28px;cursor:pointer">×</button>' +
    '</div>' +
    rows +
    '<button data-cbsid="ACC002-B06" class="composebtn ghost" style="margin-top:8px" onclick="vaultAddRow(' +
    i +
    ')">+ add detail</button></div>'
  );
}
/** W19: a row's value hint by tag — India's 15-character GSTIN hint only on an Indian shop */
function vaultRowHint(tag) {
  return tag === 'gstin' && shopCc() !== 'IN' ? '' : VAULT_HINT[tag] || '';
}
/** the name box's placeholder: "detail name — e.g." the section's first suggestion in the shop's own words */
function vaultNamePlaceholder(type) {
  return txf('detail name — e.g. {x}', { x: (vaultSuggest(type)[0] || ['Name'])[0] });
}
/** the × that removes a row — none on a local shop's plain identity (R21) */
function vaultRemoveButton(sectionIndex, rowIndex) {
  return vaultPlain()
    ? ''
    : '<button data-cbsid="ACC002-B07" type="button" title="Remove this detail" onclick="vaultDelRow(' +
        sectionIndex +
        ',' +
        rowIndex +
        ')" style="border:1px solid var(--line);background:var(--card);color:var(--grey);border-radius:8px;min-width:28px;min-height:28px;cursor:pointer">×</button>';
}
/** SET-34: a Copy button beside a row's value (a bank number, a tax id) — it copies what is in the box now, and says so on the button */
function vaultCopyButton(sectionIndex, rowIndex) {
  return (
    '<button data-cbsid="ACC002-B25" type="button" data-testid="vault-copy" title="' +
    esc(tx('Copy this detail')) +
    '" onclick="vaultCopyRow(' +
    sectionIndex +
    ',' +
    rowIndex +
    ',this)" style="border:1px solid var(--line);background:var(--card);color:var(--grey);border-radius:8px;min-height:28px;padding:0 8px;cursor:pointer">' +
    esc(tx('Copy')) +
    '</button>'
  );
}
/** the buttons at the end of a row: Copy, then Remove */
function vaultRowButtons(sectionIndex, rowIndex) {
  return vaultCopyButton(sectionIndex, rowIndex) + vaultRemoveButton(sectionIndex, rowIndex);
}
/** copy a row's value to the clipboard and say so on its button (SET-34) */
function vaultCopyRow(sectionIndex, rowIndex, node) {
  var section = _vaultSecs()[sectionIndex],
    row = section && section.rows && section.rows[rowIndex],
    done = tx('Copied'),
    keep = tx('Select it and copy');
  if (!row || !row.value) return;
  var said = function (words) {
    node.textContent = words;
  };
  if (!(navigator.clipboard && navigator.clipboard.writeText)) return said(keep);
  navigator.clipboard.writeText(String(row.value)).then(
    function () {
      said(done);
    },
    function () {
      said(keep);
    }
  );
}
/* One row: the name the USER gives it, and the value. The tag rides along invisibly when the name is one we know. */
function vaultRowHTML(r, i, j, type) {
  var tag = r.tag || '',
    hint = vaultRowHint(tag),
    enums = VAULT_ENUM[tag];
  var val;
  if (enums) {
    /* ⚠️ Blank stays FIRST and selectable — these are defaults, not answers. An unrecognised stored value is kept
       as its own option and MARKED, never silently dropped: free text saved before this was a list must survive. */
    var known = false;
    var opts = enums
      .map(function (item) {
        var o = item[1]
          .map(function (x) {
            if (x[0] === r.value) known = true;
            return '<option value="' + esc(x[0]) + '"' + (x[0] === r.value ? ' selected' : '') + '>' + esc(x[1]) + '</option>';
          })
          .join('');
        return item[0] ? '<optgroup label="' + esc(item[0]) + '">' + o + '</optgroup>' : o;
      })
      .join('');
    var keep = r.value && !known ? '<option value="' + esc(r.value) + '" selected>' + esc(r.value) + ' — not a standard code</option>' : '';
    val =
      '<select data-cbsid="ACC002-S03" class="inp" aria-label="' + esc(tx('Value')) + '" style="flex:1 1 120px;min-width:105px;margin:0" onchange="vaultSetRow(' +
      i +
      ',' +
      j +
      ",'value',this.value)\">" +
      '<option value=""' +
      (r.value ? '' : ' selected') +
      '>— none —</option>' +
      keep +
      opts +
      '</select>';
  } else {
    val =
      '<input data-cbsid="ACC002-I02" class="inp" aria-label="' + esc(tx('Value')) + '" style="flex:1 1 120px;min-width:105px;margin:0" value="' +
      esc(r.value || '') +
      '" placeholder="' +
      esc(hint) +
      '" oninput="vaultSetRow(' +
      i +
      ',' +
      j +
      ",'value',this.value)\">";
  }
  return (
    '<div style="display:flex;gap:7px;align-items:center;margin-bottom:6px;flex-wrap:wrap">' +
    /* ⚠️ BOTH FIELDS FLEX, AND NEITHER HAS A FIXED BASIS. The detail pane is ~350px at its narrowest and that is
       also the phone width; a 190px fixed name column pushed the remove button onto its own line, which reads as
       a stray control belonging to nothing. Let them shrink together and the row stays one row. */
    '<input data-cbsid="ACC002-I03" class="inp" list="vsug_' +
    esc(type) +
    '" style="flex:1 1 130px;min-width:110px;margin:0" placeholder="' +
    esc(vaultNamePlaceholder(type)) +
    '" value="' +
    esc(r.name || '') +
    '" oninput="vaultSetRow(' +
    i +
    ',' +
    j +
    ",'name',this.value)\">" +
    val +
    /* the trust rung the profile map gave this row (declared → copied → checked → verified) and where it came from —
       a row a connector copied says so; a row you typed says nothing (declared is the floor, not a badge) */
    ((r.rung && r.rung !== 'declared') || (r.source && r.source !== 'profile')
      ? '<span data-testid="vault-rung" title="' +
        esc((r.source ? 'from ' + r.source : '') + (r.as_of ? ' · as of ' + String(r.as_of).slice(0, 10) : '')) +
        '" style="font-size:var(--fs-1);font-weight:800;padding:1px 6px;border-radius:9px;white-space:nowrap;color:' +
        (r.rung === 'verified' ? 'var(--ok-2)' : r.rung === 'checked' ? 'var(--blue-2)' : 'var(--grey-2)') +
        ';background:' +
        (r.rung === 'verified' ? 'var(--ok-tint)' : r.rung === 'checked' ? 'var(--blue-tint-bg)' : 'var(--neutral-tint)') +
        '">' +
        esc(String(r.rung || 'copied').toUpperCase()) +
        (r.source && r.source !== 'profile' ? ' · ' + esc(r.source) : '') +
        '</span>'
      : '') +
    vaultRowButtons(i, j) +
    '</div>'
  );
}
/* The suggestion lists — one <datalist> per section type, emitted once. A datalist SUGGESTS and never restricts,
   which is exactly the contract we want: type "IFSC code" and get the tag, type anything else and keep it. */
function vaultDatalists() {
  return Object.keys(VAULT_SUGGEST)
    .map(function (item) {
      return (
        '<datalist id="vsug_' +
        item +
        '">' +
        vaultSuggest(item)
          .map(function (entry) {
            return '<option value="' + esc(entry[0]) + '">';
          })
          .join('') +
        '</datalist>'
      );
    })
    .join('');
}
function _vaultSecs() {
  UI._vault = UI._vault || { sections: [] };
  UI._vault.sections = UI._vault.sections || [];
  return UI._vault.sections;
}
function _vaultPaint() {
  var node = document.getElementById('vaulthost');
  if (node) node.innerHTML = vaultCardHTML(null, UI._vaultEnc) + vaultDatalists() + vaultEnd();
}
/** W22: the section the picker holds — remembered as it is chosen (UI._vaultAddType), so a repaint between the choice and the press cannot reset it */
function vaultPickType(value) {
  UI._vaultAddType = String(value || '');
}
function vaultAddSection() {
  var node = document.getElementById('v_addtype'),
    type = UI._vaultAddType || (node && node.value) || UI._vaultOnly || 'other';
  _vaultSecs().push({ type: VAULT_SECTION_TYPES[type] ? type : 'other', label: '', rows: vaultStarterRows(type) });
  _vaultPaint();
}
function vaultDelSection(i) {
  _vaultSecs().splice(i, 1);
  _vaultPaint();
}
function vaultSetSection(i, v) {
  var s = _vaultSecs()[i];
  if (s) s.label = v;
} // no repaint — would drop focus mid-word
function vaultAddRow(i) {
  var s = _vaultSecs()[i];
  if (s) {
    (s.rows = s.rows || []).push({ name: '', value: '' });
    _vaultPaint();
  }
}
function vaultDelRow(i, j) {
  var s = _vaultSecs()[i];
  if (s && s.rows) {
    s.rows.splice(j, 1);
    _vaultPaint();
  }
}
/**
 * ⚠️ THE TAG IS SET FROM THE NAME, AND ONLY WHEN THE NAME MATCHES A SUGGESTION. Typing a name we know silently
 * tags the row so forms can pre-fill it and verify can check it; typing anything else clears the tag and the row
 * is stored exactly as written. The user is never told about tags and never has to care — which is the point.
 * ⚠️ NO REPAINT ON TYPING. Rebuilding the host mid-keystroke drops focus and the caret, so the model is updated
 * in place; only structural changes (add/remove) repaint. The one exception is a name that gains or loses an
 * ENUM tag, where the value control itself has to change shape.
 */
function vaultSetRow(i, j, field, v) {
  var s = _vaultSecs()[i];
  if (!s || !s.rows || !s.rows[j]) return;
  var r = s.rows[j];
  if (field !== 'name') {
    r[field] = v;
    return;
  }
  r.name = v;
  var before = r.tag || '';
  var hit = vaultSuggest(s.type)
    .concat(VAULT_SUGGEST[s.type] || [])
    .filter(function (x) {
      return x[0].toLowerCase() === String(v).trim().toLowerCase();
    })[0];
  r.tag = hit ? hit[1] : '';
  if (!!VAULT_ENUM[before] !== !!VAULT_ENUM[r.tag]) _vaultPaint();
}
/** read the vault from the server and hold it as the base for the next patch; a failed read holds an empty vault and is logged */
async function readVault() {
  /* ⭐ profileGet, core's one name for this GET — `vaultGet` was a third alias for it (see e2e/ep-aliases.cjs) */
  try {
    var profile = (await api('profileGet')) || {};
    /* The server normalises legacy group-shaped vaults to {sections} on read, so there is exactly one shape here. */
    vaultHold({ sections: (profile.vault || {}).sections || [] }, profile.vault_version);
    UI._vaultEnc = !!profile.vault_encrypted;
  } catch (failure) {
    vaultHold({ sections: [] }, null);
    UI._vaultEnc = false;
    if (typeof cblog === 'function') cblog('error', 'vault read: ' + ((failure && failure.message) || failure));
  }
}
async function loadVault() {
  var host = document.getElementById('vaulthost');
  if (!host) return;
  /* ⚠️ THE END MARKER IS PAINTED HERE, NOT BY profSecHTML — it is a claim that you have seen everything, so it
     must not appear beside a spinner. Appended synchronously with the content it terminates, on both paths. */
  /* ⭐ ALREADY IN HAND — /entities/me?include=vault brought it with the profile, so the vault section paints
     without a second round trip. The fetch below still runs on every other path: a direct open, a refresh after
     a save, an actor profile. See _profSeedIncluded. */
  if (UI._vaultSeeded) UI._vaultSeeded = false;
  else await readVault();
  var node = document.getElementById('vaulthost');
  if (!node) return; // ⚠️ re-query: a repaint may have landed mid-fetch
  node.innerHTML = vaultCardHTML(null, UI._vaultEnc) + vaultDatalists() + vaultEnd();
  if (window.CBOffline) CBOffline.autodraft(node, 'app.vault', { overwrite: true }); // restore unsaved edits over the server copy
}
/* ── ⭐ SET-WALK1 · W25 — THE VAULT IS SAVED AS A MERGE-PATCH WITH A VERSION, NEVER AS A WHOLE ─────────────────────────────────────
 * Athi's walk (15 Oct): a screen opened earlier overwrote a newer legal name because every Save sent { sections: ALL }. Now the model keeps
 * the copy it READ (UI._vaultBase) and its version (UI._vaultVersion, GET /profile vault_version); Save sends only what moved, as RFC 7386
 * over the KEYED view the api builds the same way (lib/vault-patch — the key rule below is its twin, pinned by e2e/vault-keys.cjs), and the
 * server refuses a stale version with 409 "Changed since you opened it — reload?" — painted with a Reload button. */
/** the server's copy, held as the base every patch is measured from */
function vaultHold(vault, version) {
  UI._vault = { sections: (vault && vault.sections) || [] };
  UI._vaultBase = JSON.parse(JSON.stringify(UI._vault.sections));
  UI._vaultVersion = version == null ? null : String(version);
}
/** a unique key: the base, then #2, #3 … on a repeat (the api's vault-patch.uniqueKey) */
function vaultUniqueKey(base, seen) {
  var key = base,
    copy = 1;
  while (seen[key]) {
    copy += 1;
    key = base + '#' + copy;
  }
  seen[key] = true;
  return key;
}
/** sections keyed `type|label`, rows keyed `t:<tag>` else `n:<name>` — the api's vault-patch.keyed, one rule on both sides */
function vaultKeys(sections) {
  var keyed = {},
    seenSections = {};
  (sections || []).forEach(function (section) {
    var rows = {},
      seenRows = {};
    (section.rows || []).forEach(function (row) {
      rows[vaultUniqueKey(row.tag ? 't:' + String(row.tag).toLowerCase() : 'n:' + String(row.name || ''), seenRows)] = row;
    });
    keyed[vaultUniqueKey(String(section.type || 'other') + '|' + String(section.label || ''), seenSections)] = {
      type: section.type,
      label: section.label || '',
      rows: rows
    };
  });
  return keyed;
}
/** a row as the server stores it: name · value · tag (the provenance rides back untouched) */
function vaultRowBody(row) {
  var body = { name: row.name || '', value: row.value || '', tag: row.tag || '' };
  if (row.source) body.source = row.source;
  if (row.as_of) body.as_of = row.as_of;
  if (row.rung) body.rung = row.rung;
  return body;
}
/** do two rows carry the same name · value · tag? (an empty field equals a missing one) */
function vaultRowSame(before, after) {
  return (
    !!before &&
    !!after &&
    ['name', 'value', 'tag'].every(function (field) {
      return (before[field] || '') === (after[field] || '');
    })
  );
}
/** a section that is NEW: all its rows, as the server stores them */
function vaultNewSectionPatch(section) {
  var rows = {};
  Object.keys(section.rows).forEach(function (rowKey) {
    rows[rowKey] = vaultRowBody(section.rows[rowKey]);
  });
  return { type: section.type, label: section.label, rows: rows };
}
/** a section that exists on both sides: only the rows that were removed (null) or changed; null when no row moved */
function vaultRowsPatch(before, after) {
  var rows = {},
    moved = false;
  Object.keys(before.rows).forEach(function (rowKey) {
    if (!after.rows[rowKey]) {
      rows[rowKey] = null;
      moved = true;
    }
  });
  Object.keys(after.rows).forEach(function (rowKey) {
    if (!vaultRowSame(before.rows[rowKey], after.rows[rowKey])) {
      rows[rowKey] = vaultRowBody(after.rows[rowKey]);
      moved = true;
    }
  });
  return moved ? { rows: rows } : null;
}
/** the merge-patch from the copy read to the model now: only sections and rows that moved; null = removed; empty when nothing moved */
function vaultPatch(base, now) {
  var before = vaultKeys(base),
    is = vaultKeys(now),
    sections = {},
    any = false;
  Object.keys(before).forEach(function (key) {
    if (!is[key]) {
      sections[key] = null;
      any = true;
    }
  });
  Object.keys(is).forEach(function (key) {
    var section = before[key] ? vaultRowsPatch(before[key], is[key]) : vaultNewSectionPatch(is[key]);
    if (section) {
      sections[key] = section;
      any = true;
    }
  });
  return any ? { sections: sections } : null;
}
/** W25: the server's "changed since you opened it" — the sentence and the one button that fixes it */
function vaultConflictHTML(words) {
  return (
    '<span data-testid="vault-conflict">' +
    esc(words) +
    '</span> <button data-cbsid="ACC002-B08" type="button" class="composebtn ghost" data-testid="vault-reload" onclick="loadVault()" style="margin-inline-start:8px;min-height:30px">' +
    esc(tx('Reload')) +
    '</button>'
  );
}
/** a one-line toast, where the page has one */
function vaultSay(words) {
  if (typeof toast === 'function') toast(words);
}
/** show why a save failed: a stale version (409) gets the sentence and a Reload button, anything else its own words */
function vaultSaveFailed(failure, errorBox) {
  if (!errorBox) return;
  if (failure && failure.status === 409)
    errorBox.innerHTML = vaultConflictHTML((failure.data && failure.data.message) || failure.message || tx('Changed since you opened it — reload?'));
  else errorBox.textContent = (failure && failure.message) || tx('Could not save the vault');
}
/** WALK-REG 2026-10-16 R19: the autosave's vault write — the same merge-patch as saveVaultUI, but NOTHING repaints (the person is mid-form) and no toast;
    the base and version move to what was just saved so the next change patches from here. → true saved · false nothing moved; a refusal throws */
async function vaultSaveQuiet() {
  var patch = vaultPatch(UI._vaultBase || [], _vaultSecs());
  if (!patch) return false;
  UI._party = undefined;
  var answer = await api('vaultSave', { body: { version: UI._vaultVersion, patch: patch } });
  UI._vaultBase = JSON.parse(JSON.stringify(_vaultSecs()));
  UI._vaultVersion = (answer && answer.version) == null ? UI._vaultVersion : String(answer.version);
  if (window.CBOffline) CBOffline.clearDraft('app.vault');
  return true;
}
/** Save the vault: the merge-patch of what moved, with the version read; the answer becomes the new base */
async function saveVaultUI() {
  var err = document.getElementById('vault_err');
  if (err) err.textContent = '';
  /* ⚠️ THE MODEL IS THE TRUTH, not the DOM — every control writes straight into UI._vault as it is typed, so the
     save reads one object rather than scraping ids. That is what makes repeatable sections possible at all: there
     is no stable id to scrape when the same section can exist twice. The server drops empty rows; we send as-is. */
  var patch = vaultPatch(UI._vaultBase || [], _vaultSecs());
  if (!patch) return vaultSay(tx('Nothing to save.'));
  UI._party = undefined; /* the Invoice row's supplier block re-reads after a vault save */
  try {
    var answer = await api('vaultSave', { body: { version: UI._vaultVersion, patch: patch } });
    vaultHold((answer && answer.vault) || { sections: _vaultSecs() }, answer && answer.version);
    if (window.CBOffline) CBOffline.clearDraft('app.vault');
    vaultSay(tx('Vault saved ✓'));
    _vaultPaint();
  } catch (failure) {
    vaultSaveFailed(failure, err);
  }
}

/* ── YOUR SHOP — the Business section of the profile (MOVED from iamHTML, cap-admin.js): the licence number · address · supplies the
 * invoice party reads (api lib/profile.js invoiceParty). Painted by the workshop's Profile AND by CB Settings › Your shop; saved by PATCH /entities/profile. ── */
/* ── 2 · BUSINESS PROFILE ──────────────────────────────────────────────────────────────────────────────
 * ⚠️ GSTIN IS INDIA-ONLY AND THIS IS THE HALF-STEP. Athi, 2026-08-19: *"GSTIN is for India — if it is for
 * any other country, how do they do? We may have to ask licence name and licence number… possibly we
 * provide suggestion based on country."* The full (scheme, value) pair needs a column and a country
 * catalogue; until then the label says what it is and where the name comes from, so the field stops
 * asserting that every business on earth is Indian. */
function shopLicLabel() {
  return taxIdWord(shopCc());
} /* STD2: the pack's word (helpers.js, the one reader); no pack → "Tax number" — the CBLocale region table is gone */
/** the shop's country as THIS card knows it (CB Settings › Your shop reads /me), else the page's — never written to the global SESSION.country (STD2) */
function shopCc() {
  return (typeof CBShop !== 'undefined' && CBShop.country && CBShop.country()) || '';
}
/** the three inputs (ids pf_gstn · pf_addr · pf_sup — saveProfile and SHOP_FIELDS read them by id) */
function shopFieldsHTML(e, licLabel) {
  return (
    '<label class="fl" for="pf_gstn">' +
    esc(licLabel) +
    ' <span title="' +
    esc(tx('Your business registration')) +
    '" style="color:var(--grey);font-weight:400;cursor:help">ⓘ</span></label>' +
    '<input data-cbsid="ACC002-I04" class="inp" id="pf_gstn" value="' +
    esc(e.gstn || '') +
    '">' +
    '<label class="fl" for="pf_addr">' +
    tx('Address') +
    '</label>' +
    '<input data-cbsid="ACC002-I05" class="inp" id="pf_addr" value="' +
    esc(e.address || '') +
    '">'
  );
  /* ⭐ SET-WALK1 · W27(a): GOODS · SERVICES · BOTH is a tax attribute of the business, not a bill line — it moved to Country setup, beside
       the tax registration (cap-country.js csuSuppliesRow); the one writer stays PATCH /entities/profile `supplies` (SHOP_SUPPLIES). */
  /**
   * ⚠️⚠️ COUNTRY · TIME ZONE · NUMBER FORMAT MOVED HERE, AND I ALMOST LOST THEM. They sat under "Presence &
   * governance"; rewriting that section as Storefront dropped the iamGovernedRows() call and nothing on
   * screen said so — e2e/dead-surface.cjs caught it by reporting the function newly orphaned. Athi's line
   * was *"information should not be missed"*, and this is exactly how it goes missing: not deleted on
   * purpose, but left behind by a regroup.
   *
   * ⭐ AND BUSINESS IS WHERE THEY BELONG. They are facts about the business — where it trades, in what
   * currency, how it writes numbers — not about its presence. The sentence that used to introduce them
   * ("From your installation. Your own reading language and formats are separate…") is gone: the rows are
   * read-only, which says the same thing by being true.
   */
}
/** the fields PATCH /entities/profile takes from this card — cap-admin's PROF_FIELDS.profile IS this list */
var SHOP_FIELDS = [
  ['pf_gstn', 'gstn'],
  ['pf_addr', 'address']
];
/** W27(a): the supplies choice — the GST/WTO vocabulary (goods · services · both; "both" is the common case: a garage sells a part and fits it) */
var SHOP_SUPPLIES = [
  ['goods', 'Goods'],
  ['services', 'Services'],
  ['both', 'Both']
];
/** what a section sends: only inputs on screen and not capped — the rule saveProfile (cap-admin.js) has always applied, in one place */
function profFieldsBody(pairs) {
  var b = {};
  (pairs || []).forEach(function (pair) {
    var el = document.getElementById(pair[0]);
    if (!el || el.disabled) return; // not rendered, or capped → not this person's to send
    var v = val(pair[0]);
    if (v !== '') b[pair[1]] = v;
  });
  return b;
}

/** the workshop's pane ends with its marker (cap-admin.js _capEnd); a small app has no pane to end */
function vaultEnd() {
  return typeof _capEnd === 'function' ? _capEnd() : '';
}

/* ── CB SETTINGS › YOUR SHOP — the page's host mounts the two cards here ───────────────────────────────────────────────────────── */
var CBShop = (function () {
  var H = { host: null, me: null, loading: false, cc: '' };
  function esc0(v) {
    return esc(v);
  }
  function card(title, body, tid) {
    return '<section class="shop-card" data-testid="' + tid + '" style="' + _CARD + '"><h2 class="shop-h">' + esc0(title) + '</h2>' + body + '</section>';
  }
  /** the Business section: the same inputs the workshop's Profile paints (shopFieldsHTML), one Save (M64) */
  function shopCardHTML(e) {
    var who = SESSION && SESSION.actorId;
    return (
      shopFieldsHTML(e || {}, shopLicLabel()) +
      '<div class="err" id="pf_err_profile" data-testid="shop-err" style="margin-top:8px"></div>' +
      (who
        ? '<p class="sub" data-testid="shop-ask-owner">' + esc0(tx('Only the owner can change these.')) + '</p>'
        : '<button data-cbsid="ACC002-B09" type="button" class="act" id="shop-save" data-testid="shop-save" style="margin-top:8px;display:none">' + esc0(tx('Save')) + '</button>')
    );
  }
  function paint() {
    var node = H.host;
    if (!node) return;
    UI._vaultOnly = 'identity';
    /* walk 2026-10-16 (R19): "Your business"; the identity heading is "Your identity"; no explanation lines, no doors under the boxes */
    node.innerHTML =
      card(tx('Your business'), shopCardHTML(H.me), 'shop-card') +
      '<h2 class="shop-h" style="margin-top:14px" data-testid="shop-forms-title">' +
      esc0(tx('Your identity')) +
      '</h2>' +
      '<div id="vaulthost" data-testid="shop-identity"></div>';
    var b = document.getElementById('shop-save');
    if (b)
      b.onclick = function () {
        shopSave(b);
      };
    if (!node._autosave) {
      node._autosave = true;
      node.addEventListener('change', onChange);
    }
    loadVault().then(prefillIdentity);
  }
  /* ── WALK-REG 2026-10-16 R19: the fields save themselves (the pattern of Print setup, cap-print.js saveSoon): a changed field saves after a short pause,
     saves never overlap (one waits for the one in flight), and "✓ Saved" stands beside the field that was saved. The two Save buttons stay in the page,
     hidden, for the walks and the keyboard-less tests that press them. A person who may not write (an actor) has no Save and no autosave. ── */
  var autosave = { timer: null, saving: false, again: false, dirty: [] };
  function onChange(event) {
    var target = event.target;
    if (!target || !target.closest || (SESSION && SESSION.actorId)) return;
    var shopField = SHOP_FIELDS.some(function (pair) {
      return pair[0] === target.id;
    });
    if (!shopField && !target.closest('#vaulthost')) return;
    var old = target.nextElementSibling;
    if (old && old.getAttribute('data-saved')) old.remove();
    if (autosave.dirty.indexOf(target) < 0) autosave.dirty.push(target);
    saveSoon();
  }
  function saveSoon() {
    clearTimeout(autosave.timer);
    autosave.timer = setTimeout(function () {
      if (autosave.saving) {
        autosave.again = true;
        return;
      }
      autosave.saving = true;
      var moved = autosave.dirty.splice(0);
      saveNow(moved).then(function () {
        autosave.saving = false;
        if (autosave.again || autosave.dirty.length) {
          autosave.again = false;
          saveSoon();
        }
      });
    }, 500);
  }
  function said(el) {
    if (!el || !el.parentNode) return;
    var badge = document.createElement('span');
    badge.setAttribute('data-saved', '1');
    badge.setAttribute('data-testid', 'saved-' + (el.id || 'field'));
    badge.setAttribute('role', 'status');
    badge.style.cssText = 'margin-inline-start:8px;font-size:var(--fs-1);color:var(--ok-2)';
    badge.textContent = '✓ ' + tx('Saved');
    el.parentNode.insertBefore(badge, el.nextSibling);
  }
  /** one pass: the shop fields that moved (one PATCH of just those), then the vault if any row moved; each outcome said beside its field */
  async function saveNow(moved) {
    var shopEls = moved.filter(function (el) {
        return SHOP_FIELDS.some(function (pair) {
          return pair[0] === el.id;
        });
      }),
      vaultEls = moved.filter(function (el) {
        return shopEls.indexOf(el) < 0;
      });
    var profileErr = document.getElementById('pf_err_profile'),
      vaultErr = document.getElementById('vault_err');
    if (shopEls.length) {
      var body = {};
      shopEls.forEach(function (el) {
        var pair = SHOP_FIELDS.filter(function (candidate) {
            return candidate[0] === el.id;
          })[0],
          value = val(el.id);
        if (value !== '') body[pair[1]] = value;
      });
      if (Object.keys(body).length) {
        if (profileErr) profileErr.textContent = '';
        try {
          await api('saveProfile', { body: body });
          if (typeof UI !== 'undefined') {
            UI._me = null;
            UI._party = undefined;
          }
          shopEls.forEach(said);
        } catch (failure) {
          if (profileErr) profileErr.textContent = CBAction.words(failure, tx('Could not save'));
        }
      }
    }
    if (vaultEls.length) {
      if (vaultErr) vaultErr.textContent = '';
      try {
        if (await vaultSaveQuiet()) vaultEls.forEach(said);
      } catch (failure) {
        vaultSaveFailed(failure, vaultErr);
      }
    }
  }
  /** W14b: one place for the address — an EMPTY Business identity opens with the shop's own details already in its rows (nothing is saved until Save) */
  function prefillIdentity() {
    var secs = _vaultSecs();
    if (
      secs.some(function (x) {
        return x.type === 'identity';
      })
    )
      return;
    var shop = H.me || {};
    if (!shop.address && !shop.gstn && !shop.display_name) return;
    secs.push({
      type: 'identity',
      label: '',
      rows: vaultStarterRows('identity', { legal_name: shop.legal_name || '', gstin: shop.gstn || '', address: shop.address || '' })
    });
    _vaultPaint();
  }
  function read() {
    if (H.loading) return;
    H.loading = true;
    api('me')
      .then(
        function (reply) {
          H.me = (reply && (reply.entity || reply)) || {};
        },
        function (e) {
          H.me = {};
          if (e && e.status === 401 && typeof CBFrame !== 'undefined') CBFrame.ended();
        }
      )
      .then(function () {
        H.loading = false;
        shopCountry(H.me);
        paint();
      });
  }
  /** the shop's country from /me, kept on THIS card (STD2: never written to the global SESSION.country) — the words above pass it to helpers.js shopReg(cc) */
  function shopCountry(me) {
    var c = me && (me.country || me.country_code);
    H.cc = c ? String(c).toUpperCase() : '';
  }
  function mount(host, o) {
    H.host = host;
    H.me = (o && o.me) || null;
    if (H.me) {
      shopCountry(H.me);
      paint();
    } else read();
  }
  return {
    mount: mount,
    refresh: read,
    paint: paint,
    country: function () {
      return H.cc;
    }
  };
})();
/** Your shop › Save: one press, one PATCH, the outcome said where it happened (M64); the server's refusal in its own words */
function shopSave(btn) {
  var x = document.getElementById('pf_err_profile');
  if (x) x.textContent = '';
  var body = profFieldsBody(SHOP_FIELDS);
  if (!Object.keys(body).length) {
    if (x) x.textContent = tx('Nothing to save.');
    return;
  }
  CBAction.run(
    btn,
    function () {
      return api('saveProfile', { body: body });
    },
    {
      key: 'shop-save',
      busy: tx('Saving…'),
      outcome: function () {
        toast(tx('Shop details saved.'));
        if (typeof UI !== 'undefined') UI._me = null;
        UI._party = undefined;
        CBShop.refresh();
      },
      onFail: function (words) {
        if (x) x.textContent = words;
      }
    }
  );
}
