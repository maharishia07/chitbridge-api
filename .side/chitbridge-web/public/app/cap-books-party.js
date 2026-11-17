/* app/cap-books-party.js — CB ACCOUNTS: the party's own fields, edited where the party is shown (name, phone, tax ids, terms). Split out of cap-books.js, code moved verbatim.
 * OWNS      the party editor: bkTaxSchemes · partyRowOf · partyTaxRowHTML · partyTaxAdd · partyEditOpen · partyTaxRows · partyDupCheck · partyEditSave and the TAX_SCHEMES list
 * CALLED BY public/accounts.html, crm.html (script tag, after cap-books.js) · app.html CAP_WITH books; app.html's party rows call partyEditOpen at run time
 * FLOW      a party row's Edit → partyEditOpen → partyTaxRows (one row per tax id) → partyDupCheck (the server says if the id is taken) → partyEditSave
 * CARD      16-finance/cb-finance
 */
'use strict';
/* ── the party's own fields, edited where the party is shown ── */
/* the schemes the server accepts (lib/party-fields.js): a party can carry several tax ids, so the sheet edits a LIST of them */
var TAX_SCHEMES = ['GSTIN', 'PAN', 'TAN', 'TRN', 'ABN', 'VAT', 'TIN', 'CIN', 'UDYAM'];
/** CX0: the schemes offered are the shop's PACK's — an Australian shop's parties carry an ABN, a UAE shop's a TRN; India's own (GSTIN · PAN · TAN · UDYAM · CIN)
    under India's pack or none known. STD2: the pack's word is helpers.js taxIdWord (the one reader), not a second `p.abn ?` here */
function bkTaxSchemes(t) {
  var p = (typeof shopReg === 'function' && shopReg()) || null,
    w = p ? taxIdWord() : '',
    list = w && TAX_SCHEMES.indexOf(w) >= 0 && w !== TAX_SCHEMES[0] ? [w, 'TIN', 'VAT'] : TAX_SCHEMES;
  return t && t.scheme && list.indexOf(t.scheme) < 0 ? [t.scheme].concat(list) : list;
}
function partyRowOf(kind, partyId) {
  if (kind === 'supplier')
    return (UI.sups || []).find(function (item) {
      return item.supplier_entity_id === partyId;
    });
  return (UI.custs || []).find(function (item) {
    return item.customer_identity_id === partyId;
  });
}
/** one tax-id row of the edit sheet; the first keeps the ids the Ledger's own tests read (pe_scheme / pe_taxid) */
function partyTaxRowHTML(kind, partyId, t, i) {
  var sid = i === 0 ? 'pe_scheme' : 'pe_scheme' + i,
    vid = i === 0 ? 'pe_taxid' : 'pe_taxid' + i;
  return (
    '<div class="supacts pe_taxrow" style="display:flex;gap:6px"><select data-cbsid="CMP041-S01"' + bkMountAttribute('CMP041') + ' class="inp" id="' +
    sid +
    '" data-testid="' +
    sid +
    '" style="width:auto" aria-label="' +
    esc(tx('Scheme')) +
    '">' +
    bkTaxSchemes(t)
      .map(function (item) {
        return '<option' + (t.scheme === item ? ' selected' : '') + '>' + item + '</option>';
      })
      .join('') +
    '</select>' +
    '<input data-cbsid="CMP040-I01"' + bkMountAttribute('CMP040') + ' class="inp" id="' +
    vid +
    '" data-testid="' +
    vid +
    '" value="' +
    esc(t.value == null ? '' : t.value) +
    '" aria-label="' +
    esc(tx('Tax id')) +
    '" style="width:100%" oninput="partyDupCheck(\'' +
    kind +
    "','" +
    esc(partyId) +
    '\')"></div>'
  );
}
function partyTaxAdd(kind, partyId) {
  var box = document.getElementById('pe_taxes');
  if (!box) return;
  var n = box.querySelectorAll('.pe_taxrow').length,
    node = document.createElement('div');
  node.innerHTML = partyTaxRowHTML(kind, partyId, {}, n);
  box.appendChild(node.firstChild);
}
/* open the party edit form (name, contact, tax ids) for a customer or supplier */
function partyEditOpen(kind, partyId) {
  var r = partyRowOf(kind, partyId) || {};
  var taxes = r.tax_ids && r.tax_ids.length ? r.tax_ids : [{}];
  var inp = function (id, v, ph, extra) {
    return (
      '<input data-cbsid="CMP040-I01"' + bkMountAttribute('CMP040') + ' class="inp" id="' +
      id +
      '" data-testid="' +
      id +
      '" value="' +
      esc(v == null ? '' : v) +
      '" placeholder="' +
      esc(ph || '') +
      '" style="width:100%" ' +
      (extra || '') +
      '>'
    );
  };
  /* a minted (local) party has no profile of its own: the shop holds its phone and e-mail, so the sheet edits them (a party on ChitBridge keeps its own) */
  var contact = r.contacts
    ? '<div style="display:flex;gap:8px"><label style="flex:1">' +
      tx('Phone') +
      inp('pe_phone', r.contacts.phone, '', 'inputmode="tel"') +
      '</label><label style="flex:1">' +
      tx('E-mail') +
      inp('pe_email', r.contacts.email, '', 'inputmode="email"') +
      '</label></div>'
    : '';  /* where-used: out-of-scope the mount is bkDialogMount(n): the host screen's own code plus -U2n, so it cannot be one literal */
  ui.dialog({
    mount: bkDialogMount(2), pop: 'POP089', bodyStyle: 'display:flex;flex-direction:column;gap:8px',
    titleText: tx('Party') + ' · ' + (r.display_name || r.nickname || ''),
    body:
      '<label>' +
      tx('Legal name') +
      inp('pe_legal', r.legal_name, tx('as on their tax registration')) +
      '</label>' +
      '<label>' +
      tx('Nickname') +
      inp('pe_nick', r.nickname, tx('what you call them')) +
      '</label>' +
      contact +
      '<div><div style="font-weight:600;margin-bottom:4px">' +
      tx('Tax ids') +
      '</div><div id="pe_taxes" style="display:flex;flex-direction:column;gap:6px">' +
      taxes
        .map(function (item, index) {
          return partyTaxRowHTML(kind, partyId, item, index);
        })
        .join('') +
      '</div>' +
      '<button data-cbsid="CMP007-B01"' + bkMountAttribute('CMP007') + ' type="button" data-testid="pe_taxadd" style="margin-top:6px" onclick="partyTaxAdd(\'' +
      kind +
      "','" +
      esc(partyId) +
      '\')">+ ' +
      tx('Add a tax id') +
      '</button></div>' +
      '<div id="pe_dup" data-testid="pe_dup" style="font-size:var(--fs-1);color:var(--warn-2)"></div>' +
      '<div style="display:flex;gap:8px"><label style="flex:1">' +
      tx('Credit days') +
      inp('pe_days', r.credit_days, '30', 'inputmode="numeric"') +
      '</label>' +
      '<label style="flex:1">' +
      tx('Credit limit') +
      bkMoneyInput({ id: 'pe_limit', minor: r.credit_limit_minor != null ? r.credit_limit_minor : null, ph: '' }) +
      '</label></div>' +
      (typeof packSplitsByState !== 'function' || packSplitsByState()
        ? '<label>' + tx('State code') + inp('pe_state', r.state_code, '33') + '</label>'
        : '') /* CX0: a state only where the tax turns on it (India) */ +
      '',
    footerHtml:
      '<button data-cbsid="CMP003-B01"' + bkMountAttribute('CMP003') + ' onclick="closeModal()">' +
      tx('Cancel') +
      '</button><button data-cbsid="CMP001-B01"' + bkMountAttribute('CMP001') + ' class="pri" data-testid="pe_save" onclick="partyEditSave(\'' +
      kind +
      "','" +
      esc(partyId) +
      '\')">' +
      tx('Save') +
      '</button>'
  });
  partyDupCheck(kind, partyId);
}
/** the sheet's tax-id rows → [{scheme, value}], blanks dropped */
function partyTaxRows() {
  return Array.prototype.slice
    .call(document.querySelectorAll('#pe_taxes .pe_taxrow'))
    .map(function (row) {
      return {
        scheme: (row.querySelector('select') || {}).value,
        value: String((row.querySelector('input') || {}).value || '')
          .trim()
          .toUpperCase()
      };
    })
    .filter(function (item) {
      return item.value;
    });
}
/** ⚠️ duplicate parties come from free text with no tax-id check — warn before saving (the research's failure 5) */
function partyDupCheck(kind, partyId) {
  var box = document.getElementById('pe_dup');
  if (!box) return;
  var mine = partyTaxRows();
  if (!mine.length) {
    box.textContent = '';
    return;
  }
  var all = (UI.custs || [])
    .map(function (item) {
      return { id: item.customer_identity_id, name: item.display_name, tax: item.tax_ids };
    })
    .concat(
      (UI.sups || []).map(function (item) {
        return { id: item.supplier_entity_id, name: item.display_name || item.nickname, tax: item.tax_ids };
      })
    );
  var hit = null,
    hs = null;
  mine.forEach(function (item) {
    if (hit) return;
    hit =
      all.filter(function (p) {
        return (
          p.id !== partyId &&
          (p.tax || []).some(function (t) {
            return t.scheme === item.scheme && String(t.value).toUpperCase() === item.value;
          })
        );
      })[0] || null;
    hs = hit ? item.scheme : hs;
  });
  box.textContent = hit ? txf('{name} already has this {scheme}', { name: hit.name || '', scheme: hs }) : '';
}
/* save the party edit form: send only what changed, then repaint the party record */
async function partyEditSave(kind, partyId) {
  var node = function (id) {
    return String((document.getElementById(id) || {}).value || '').trim();
  };
  var r = partyRowOf(kind, partyId) || {};
  var listId = kind === 'supplier' ? r.supplier_list_id : r.customer_list_id;
  var lim = node('pe_limit'),
    days = node('pe_days');
  var body = {
    legal_name: node('pe_legal') || null,
    nickname: node('pe_nick') || null,
    state_code: node('pe_state') || null,
    credit_days: days === '' ? null : parseInt(days, 10),
    credit_limit_minor: lim === '' ? null : bkMoneyMinor(lim),
    tax_ids: partyTaxRows()
  };
  if (document.getElementById('pe_phone')) {
    body.phone = node('pe_phone') || null;
    body.email = node('pe_email') || null;
  }
  if (body.credit_days != null && !(body.credit_days >= 0)) {
    toast(tx('Credit days: a whole number'));
    return;
  }
  if (body.credit_limit_minor != null && !(body.credit_limit_minor >= 0)) {
    toast(tx('Credit limit: an amount'));
    return;
  }
  try {
    await api(kind === 'supplier' ? 'supPatch' : 'custGroup', { params: { id: listId }, body: body });
    /* a party on both lists is one party: the words and tax ids it carries are written to the other list too (its credit terms are its own) */
    if (r.also && r.also.id)
      await api(r.also.kind === 'supplier' ? 'supPatch' : 'custGroup', {
        params: { id: r.also.id },
        body: { legal_name: body.legal_name, nickname: body.nickname, state_code: body.state_code, tax_ids: body.tax_ids }
      });
    Object.assign(r, body);
    closeModal();
    toast(tx('Saved'));
    if (kind === 'supplier') {
      if (typeof paintSupSlide === 'function') paintSupSlide();
    } else if (typeof paintCustDetail === 'function') paintCustDetail();
    if (typeof crmAfterEdit === 'function') crmAfterEdit(kind, partyId); /* CB CRM re-reads its list and the record */
  } catch (e) {
    /* the server's own duplicate check (409 DUPLICATE_PARTY) says the same as the warning, with authority */
    var box = document.getElementById('pe_dup');
    if (box) box.textContent = bkWhy(e, tx('Could not save'));
  }
}
