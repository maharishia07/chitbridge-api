/* cap-crm-groups-sheet.js — PART of cap-crm-groups.js (MNT-59): the New group / Members sheet, ticking the customers of a named group, saving it and deleting it.
 * OWNS      GSHEET (the sheet's state) · crmGroupOpen · crmGroupCands · crmGroupPick · crmGroupTick · crmGroupCodeWords · crmGroupWords · crmGroupSave (a name is required) · crmGroupDelete (asks first).
 * CALLED BY cap-crm-groups.js (the base: the list's New group button, the row actions Members and Delete group, and crmGroupsClick for the sheet's ticks and Save; crm.html loads this file right after it).
 * FLOW      New group or Members → crmGroupOpen paints the sheet from the Parties list in memory → crmGroupPick filters, crmGroupTick keeps the set → crmGroupSave writes it through CBAction → the groups reload.
 * CARD      11-crm-and-marketing/marketing-app
 * Moved byte for byte out of cap-crm-groups.js; no behaviour changed. Needs the base's GROUPS and crmGroupsLoad and the host globals of cap-crm.js (CRM · modal · closeModal · CBAction · CBConfirm · tx/txf · esc · api · toast). */
'use strict';
/* ═══ NEW GROUP · MEMBERS — one sheet: a name, then who is in it (the customers of the Parties list, ticked) ═══════ */
var GSHEET = { name: '', fixed: false, orig: {}, on: {}, q: '' };
/** open the New group / Edit members sheet; an existing name starts with its current members ticked */
function crmGroupOpen(name) {
  GSHEET = { name: name || '', fixed: !!name, orig: {}, on: {}, q: '' };
  if (name)
    CRM.rows.forEach(function (item) {
      if ((item.groups || []).indexOf(name) >= 0) {
        GSHEET.orig[item.party_id] = 1;
        GSHEET.on[item.party_id] = 1;
      }
    });
  ui.dialog({
    mount: 'CRM008-U201',
    pop: 'POP098',
    titleText: name ? txf('Members of {name}', { name: name }) : tx('New group'),
    testid: 'crm-grp-sheet',
    body:
      '<label>' +
      esc(tx('Name')) +
      '<input data-cbsid="CRM008-I01" class="inp" id="crm_grp_name" data-testid="crm-grp-name" maxlength="40" autocomplete="off" value="' +
      esc(name || '') +
      '"' +
      (name ? ' readonly' : '') +
      '></label>' +
      '<label>' +
      esc(tx('Find a customer')) +
      '<input data-cbsid="CRM008-I02" class="inp" id="crm_grp_q" data-testid="crm-grp-q" placeholder="' +
      esc(tx('Name, ID, phone')) +
      '" autocomplete="off" oninput="crmGroupPick(this.value)"></label>' +
      '<div id="crm_grp_list" class="grp-list" data-testid="crm-grp-list"></div>' +
      '<div id="crm_grp_msg" class="hint" role="status" data-testid="crm-grp-msg"></div>',
    footerHtml:
      '<span class="sub" id="crm_grp_n" data-testid="crm-grp-n" style="margin-right:auto;align-self:center"></span>' +
      ui.footerAction({ name: 'cancel', options: { mount: 'CRM008-U201' } }) +
      ui.footerAction({ name: 'save', options: { mount: 'CRM008-U201', key: 'save', effect: 'preference', testid: 'crm-grp-save', data: { crm: 'grpsave' } } })
  });
  crmGroupPick('');
  var node = document.getElementById(name ? 'crm_grp_q' : 'crm_grp_name');
  if (node) node.focus();
}
function crmGroupCands() {
  return CRM.rows.filter(function (item) {
    return item.kind !== 'walk-in' && (item.roles || []).indexOf('customer') >= 0 && !crmIsLead(item);
  });
}
/** filter the member picker of the group sheet by the typed text and repaint the list */
function crmGroupPick(query) {
  GSHEET.q = String(query || '')
    .trim()
    .toLowerCase();
  var box = document.getElementById('crm_grp_list');
  if (!box) return;
  var all = crmGroupCands(),
    matches = all.filter(function (item) {
      return !GSHEET.q || [item.display_name, item.nickname, item.party_no, item.phone, item.user_id].join(' ').toLowerCase().indexOf(GSHEET.q) >= 0;
    });
  var ticked = all.filter(function (item) {
    return GSHEET.on[item.party_id];
  });
  box.innerHTML = matches.length
    ? matches
        .slice(0, 60)
        .map(function (item) {
          return (
            '<label class="grp-row" data-testid="crm-grp-cand-' +
            esc(crmKey(item)) +
            '"><input data-cbsid="CRM008-I03" type="checkbox" data-crm="grptick" data-k="' +
            esc(item.party_id) +
            '"' +
            (GSHEET.on[item.party_id] ? ' checked' : '') +
            '><span class="nm">' +
            esc(item.display_name) +
            '</span><span class="sub">' +
            esc(item.party_no || item.phone || '') +
            '</span></label>'
          );
        })
        .join('') + (matches.length > 60 ? '<div class="hint">' + esc(txf('{n} more — type to narrow', { n: matches.length - 60 })) + '</div>' : '')
    : '<div class="hint">' + esc(all.length ? tx('Nobody matches.') : tx('No customers yet. They appear when you bill them.')) + '</div>';
  var node = document.getElementById('crm_grp_n');
  if (node) node.textContent = crmPlural(ticked.length, 'member', 'members');
}
function crmGroupTick(key, on) {
  if (on) GSHEET.on[key] = 1;
  else delete GSHEET.on[key];
  var node = document.getElementById('crm_grp_n');
  if (node) node.textContent = crmPlural(Object.keys(GSHEET.on).length, 'member', 'members');
}
/** the shop's sentence for each refusal code of the group routes; empty for a code it does not know */
function crmGroupCodeWords(code) {
  if (code === 'GROUPS_NOT_MIGRATED') return tx('Groups are not switched on for your shop yet.');
  if (code === 'BAD_NAME') return tx('Name the group: up to 40 letters, digits, spaces, - & /.');
  if (code === 'TOO_MANY_GROUPS') return tx('A customer can be in at most 20 groups.');
  if (code === 'TOO_MANY') return tx('At most 500 at a time.');
  if (code === 'NOTHING_TO_DO') return tx('Tick at least one customer.');
  return '';
}
/** what a refused group save says: a view-only login, the code's sentence, else try again */
function crmGroupWords(e) {
  var code = e && e.data && e.data.code;
  if (e && e.status === 403) return (e.data && (e.data.why || e.data.message)) || tx('Your login can only view.');
  return crmGroupCodeWords(code) || tx("Couldn't save the group. Try again.");
}
/** save the group sheet (a name is required) through CBAction, then reload the groups */
function crmGroupSave(btn) {
  var name = String((document.getElementById('crm_grp_name') || {}).value || '')
      .replace(/\s+/g, ' ')
      .trim(),
    msg = document.getElementById('crm_grp_msg');
  if (!name) {
    msg.textContent = tx('Name the group.');
    return;
  }
  var toAdd = Object.keys(GSHEET.on).filter(function (item) {
      return !GSHEET.orig[item];
    }),
    remove = Object.keys(GSHEET.orig).filter(function (item) {
      return !GSHEET.on[item];
    });
  if (!toAdd.length && !remove.length) {
    msg.textContent = tx('Tick at least one customer.');
    return;
  }
  return CBAction.run(
    btn,
    async function () {
      return api('crmGroupSet', { body: { name: name, add: toAdd, remove: remove } });
    },
    {
      key: 'group-save',
      busy: tx('Saving…'),
      onFail: function (words, e) {
        msg.textContent = crmGroupWords(e);
      },
      outcome: async function (reply) {
        closeModal();
        toast(txf('{name}: {n}', { name: (reply && reply.name) || name, n: crmPlural((reply && reply.count) || 0, 'member', 'members') }));
        await crmLoad(true);
        crmGroupsLoad(true);
      }
    }
  );
}
/** a delete asks first — with the offers that name it (the server's count): they would reach no one */
function crmGroupDelete(group) {
  var body = group.offers
    ? txf('{n} only for this group. They will reach no one.', { n: crmPlural(group.offers, 'offer is', 'offers are') })
    : tx('Its members stay your customers; only the name goes.');
  CBAction.run(
    null,
    async function () {
      return api('crmGroupDel', { params: { name: group.name } });
    },
    {
      key: 'group-del',
      confirm: { title: txf('Delete group {name}?', { name: group.name }), body: esc(body), yes: group.offers ? tx('Delete anyway') : tx('Delete') },
      onFail: function (words, e) {
        toast(crmGroupWords(e));
      },
      outcome: async function () {
        toast(txf('{name} deleted', { name: group.name }));
        await crmLoad(true);
        crmGroupsLoad(true);
      }
    }
  );
}
