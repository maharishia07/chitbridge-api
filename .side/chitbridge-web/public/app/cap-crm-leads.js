/* cap-crm-leads.js — CB CRM L1: LEADS AS PARTIES (+ L3: Import from a CSV, at the foot of this file).
 * OWNS      the Leads tab (crmLeads, a CBList mount in the Parties list's own look) · Add lead (crmLeadAddOpen) · the stage chip and "Move to…" (crmStageChip, crmStageBtn, crmStageOpen)
 *           · Import from a CSV (crmImportOpen and its steps, crmImport*) · the stage words (CRM_STAGE)
 * CALLED BY crm.html (<script src>, after cap-crm.js) · cap-crm.js (crmLeads on #/leads, crmLeadsIndex, crmLeadClick) · cap-crm-record.js and cap-crm-calls.js (crmStageChip, crmStageBtn, CRM_STAGE)
 * FLOW      crmLeadsEnsure → GET /api/crm/parties?view=leads → the CBList mount paints → a stage move → CBAction → the server's answer repainted
 * CARD      11-crm-and-marketing/crm-leads
 * A lead IS a party (the API's added_via 'lead'); its stage is the server's (memberships, b297) — this page only labels it.
 * ⚠️ BEFORE the API's b297 runs the writes answer 503 LEADS_NOT_MIGRATED: the page says "Lead stages arrive after the next update." — never silence,
 *   never the server's message. Every write goes through CBAction (M64). Needs cap-crm.js (CRM · crmLoad · crmNormalize · crmFuJoin · cells).
 * ⭐ NEW PATHS (rule 4): the Leads list is not a second contact list — it reads GET /api/crm/parties?view=leads (the same rows, leads only) and paints them
 *   with cap-crm.js's own cells; the sheets reuse modal() · CBAction. Nothing here decides a stage or a rule.
 */
'use strict';
var LEADS = { rows: [], state: 'loading', err: null, ready: true, loaded: false, gen: 0, api: null, busy: 0 };
var CRM_STAGE = { lead: 'New lead', demo: 'Demo', trial: 'Trial', parked: 'Not now', lost: 'Lost', customer: 'Customer' };
var CRM_LEADS_WAIT = 'Lead stages arrive after the next update.';

/** the stage, as a chip (the server's word, labelled here) */
function crmStageChip(lead) {
  if (!lead || !lead.stage) return '';
  return (
    '<span class="tag' +
    (lead.stage === 'lost' ? '' : lead.stage === 'parked' ? ' local' : ' on') +
    '" data-testid="crm-stage-chip" data-stage="' +
    esc(lead.stage) +
    '">' +
    esc(tx(CRM_STAGE[lead.stage] || lead.stage)) +
    '</span>'
  );
}
/** what a lead write's failure says, in the shop's words (the server's message is never shown) */
function crmLeadWords(e) {
  var code = e && e.data && e.data.code;
  if (e && e.status === 503) return tx(CRM_LEADS_WAIT);
  if (e && e.status === 403) return crmViewWhy(); /* the server's level gate (lib/access) — the sentence, never "Try again" (WX-L2C) */
  if (code === 'EXISTS') return tx('That name is already on your list.');
  if (code === 'BAD_PHONE') return tx('That phone number does not look right.');
  if (code === 'BAD_NAME') return tx('Give the lead a name.');
  if (code === 'IS_CUSTOMER') return tx('They are a customer now.');
  return tx("Couldn't save that. Try again.");
}

/* ═══ THE READ — leads only; kept beside CRM.rows, never inside it (the Parties list stays clean) ═══════════════════ */
async function crmLeadsLoad(quiet) {
  var generation = ++LEADS.gen;
  if (!quiet || !LEADS.loaded) {
    LEADS.state = 'loading';
    crmLeadsRefresh();
  }
  try {
    var reply = await api('crmParties', { query: { view: 'leads' } });
    if (generation !== LEADS.gen) return;
    LEADS.ready = !(reply && reply.leads_migrated === false);
    LEADS.rows = crmNormalize((reply && reply.parties) || []);
    await crmFuJoin(LEADS.rows, reply);
    if (generation !== LEADS.gen) return;
    crmLeadsIndex();
    LEADS.state = 'ready';
    LEADS.loaded = true;
    LEADS.err = null;
  } catch (e) {
    if (generation !== LEADS.gen) return;
    if (LEADS.loaded) LEADS.state = 'ready';
    else {
      LEADS.state = 'error';
      LEADS.err = e;
    }
  }
  crmNav(CRM.route && CRM.route.nav);
  crmLeadsRefresh();
  if (CRM.route && CRM.route.view === 'leads') crmLeadsBar(); /* Add lead · Import grey WITH the sentence once the read says b297 has not run */
}
function crmLeadsBar() {
  crmBar('<strong>' + esc(crmAppName()) + '</strong>', crmLeadAddBtn() + crmLeadImportBtn(), true);
}
function crmLeadsRefresh() {
  var listApi = LEADS.api;
  if (listApi && listApi.el && document.body.contains(listApi.el)) listApi.refresh();
}
/** a lead opens on the same record as any party: its key must resolve (crmIndex calls this after every Parties read too) */
function crmLeadsIndex() {
  LEADS.rows.forEach(function (item) {
    CRM.byKey[item.party_id] = item;
    if (item.party_no) CRM.byKey[item.party_no] = item;
  });
}
/** the record asks for this when a key is no row: a lead opened from a link before the Leads tab was read */
async function crmLeadsEnsure() {
  if (!LEADS.loaded) await crmLeadsLoad(true);
}

/* ═══ THE LEADS TAB ═════════════════════════════════════════════════════════════════════════════════════════════ */
function crmLeadCols() {
  return [
    {
      key: 'party',
      label: 'Lead',
      prio: 1,
      w: 270,
      sort: 'name',
      html: true,
      cell: crmPartyCell,
      value: function (party) {
        return party.display_name;
      }
    },
    {
      key: 'stage',
      label: 'Stage',
      prio: 2,
      w: 150,
      sort: 'stage',
      hfilter: 'stage',
      html: true,
      cell: function (party) {
        return crmStageChip(party.lead) || '<span class="sub">—</span>';
      },
      tid: function (party) {
        return 'crm-lead-stage-' + crmKey(party);
      },
      value: function (party) {
        return party.lead ? party.lead.stage : '';
      }
    },
    {
      key: 'phone',
      label: 'Phone',
      prio: 3,
      w: 170,
      cell: function (party) {
        return party.phone || party.otp_contact || '—';
      }
    },
    {
      key: 'next',
      label: 'Next follow-up',
      prio: 4,
      w: 170,
      sort: 'next',
      html: true,
      cell: crmFuCell,
      value: function (party) {
        return party.next_followup_at || '9999';
      }
    },
    {
      key: 'last',
      label: 'Last activity',
      prio: 5,
      w: 190,
      html: true,
      cell: crmLastCell,
      value: function (party) {
        return party.last_at || '';
      }
    }
  ];
}
/** the "+ Add lead" button: greyed with the server's sentence when view-only, disabled until the lead stages are migrated */
function crmLeadAddBtn() {
  if (!crmEdit()) return crmViewOnlyBtn('crm-lead-add', '+ ' + tx('Add lead'), crmViewWhy()); /* shown, greyed, with the server's sentence (FX-L2C) */
  var blocked = LEADS.loaded && !LEADS.ready;
  return (
    '<button data-cbsid="CRM004-B01" type="button" class="act sm' +
    (blocked ? ' ghost' : '') +
    '" data-testid="crm-lead-add" data-crm="leadadd"' +
    (blocked ? ' disabled title="' + esc(tx(CRM_LEADS_WAIT)) + '"' : '') +
    '>+ ' +
    esc(tx('Add lead')) +
    '</button>'
  );
}
/** the lead list's filter: by stage */
function crmLeadFilters() {
  return [
    {
      key: 'stage',
      label: tx('Stage'),
      all: tx('All stages'),
      options: ['lead', 'demo', 'trial', 'parked', 'lost'].map(function (item) {
        return { v: item, label: tx(CRM_STAGE[item]) };
      }),
      match: function (party, value) {
        return !!party.lead && party.lead.stage === value;
      }
    }
  ];
}
/** the lead list's orders */
function crmLeadSorts() {
  return [
    {
      key: 'name',
      label: tx('Name'),
      cmp: function (left, right) {
        return String(left.display_name).localeCompare(String(right.display_name), undefined, { sensitivity: 'base' });
      }
    },
    {
      key: 'next',
      label: tx('Next follow-up'),
      cmp: function (left, right) {
        return String(left.next_followup_at || '9999').localeCompare(String(right.next_followup_at || '9999'));
      }
    }
  ];
}
/** paint the Leads tab: the bar, then a CBList mount of the lead rows (loaded once, repainted on a stage move) */
function crmLeads(frame) {
  crmLeadsBar();
  var node = document.getElementById('screen');
  node.className = 'screen flush';
  node.innerHTML = '<div id="crm_leads" data-testid="crm-leads"></div>';
  if (LEADS.api && LEADS.api.destroy) {
    try {
      LEADS.api.destroy();
    } catch (failure) {
      // the old list is replaced right below, so a failed tear-down only leaves stale listeners; say so and carry on
      if (typeof cblog === 'function') cblog('warn', 'crm leads: the old list could not be torn down — ' + ((failure && failure.message) || 'no answer'));
    }
  }
  LEADS.api = CBList.mount(document.getElementById('crm_leads'), {
    key: 'crm-leads',
    t: tx,
    rows: function () {
      return LEADS.rows;
    },
    id: function (party) {
      return party.party_id;
    },
    rowTid: function (party) {
      return 'crm-lead-' + crmKey(party);
    },
    columns: crmLeadCols,
    defaultCols: ['party', 'stage', 'phone', 'next'],
    cardMax: 3,
    fill: false,
    head: function () {
      return { title: tx('Leads'), notices: LEADS.state === 'ready' && !LEADS.ready ? [{ text: tx(CRM_LEADS_WAIT), cls: 'warn', tid: 'crm-leads-wait' }] : [] };
    },
    state: function () {
      return LEADS.state;
    },
    error: function () {
      return crmErrWords(LEADS.err, 'your leads');
    },
    onRetry: function () {
      crmLeadsLoad();
    },
    empty: {
      title: tx(LEADS.ready ? 'No leads yet' : CRM_LEADS_WAIT),
      sub: tx(LEADS.ready ? 'People you have not traded with yet. Use + Add lead.' : 'Nothing is lost.')
    },
    search: function (party) {
      return [party.display_name, party.party_no, party.phone, party.otp_contact].join(' ');
    },
    searchHint: tx('Name or phone'),
    filters: crmLeadFilters(),
    sorts: crmLeadSorts(),
    onOpen: function (party) {
      crmGo('#/party/' + encodeURIComponent(crmKey(party)));
    }
  });
  if (frame) return;
  crmLeadsLoad(LEADS.loaded);
}

/* ═══ ADD LEAD — a name, a phone, a stage ═══════════════════════════════════════════════════════════════════════ */
function crmLeadAddOpen() {
  if (LEADS.loaded && !LEADS.ready) {
    toast(tx(CRM_LEADS_WAIT));
    return;
  }
  ui.dialog({
    mount: 'CRM004-U201',
    pop: 'POP100',
    title: 'Add lead',
    testid: 'crm-lead-sheet',
    body:
      '<label>' +
      esc(tx('Name')) +
      '<input data-cbsid="CRM004-I01" class="inp" id="crm_lead_name" data-testid="crm-lead-name" autocomplete="off"></label>' +
      '<label>' +
      esc(tx('Phone')) +
      '<input data-cbsid="CRM004-I02" class="inp" id="crm_lead_phone" data-testid="crm-lead-phone" type="tel" autocomplete="off"></label>' +
      '<label>' +
      esc(tx('Stage')) +
      '<select data-cbsid="CRM004-S01" class="inp" id="crm_lead_stage" data-testid="crm-lead-stage">' +
      ['lead', 'demo', 'trial']
        .map(function (item) {
          return '<option value="' + item + '">' + esc(tx(CRM_STAGE[item])) + '</option>';
        })
        .join('') +
      '</select></label>' +
      '<div id="crm_lead_msg" class="hint" role="status" data-testid="crm-lead-msg"></div>',
    actions: [
      { name: 'cancel', options: { mount: 'CRM004-U201' } },
      { name: 'save', options: { mount: 'CRM004-U201', key: 'save', effect: 'preference', testid: 'crm-lead-save', data: { crm: 'leadsave' } } }
    ]
  });
  var node = document.getElementById('crm_lead_name');
  if (node) node.focus();
}
/** save the Add-lead sheet: needs a name, then POSTs through CBAction and refreshes the list */
function crmLeadSave(btn) {
  var node = function (id) {
      return String((document.getElementById(id) || {}).value || '').trim();
    },
    msg = document.getElementById('crm_lead_msg');
  if (!node('crm_lead_name')) {
    msg.textContent = tx('Give the lead a name.');
    return;
  }
  var body = { name: node('crm_lead_name'), stage: node('crm_lead_stage') || 'lead' };
  if (node('crm_lead_phone')) body.phone = node('crm_lead_phone');
  return CBAction.run(
    btn,
    async function () {
      return api('crmLeadAdd', { body: body });
    },
    {
      key: 'lead-add',
      busy: tx('Saving…'),
      onFail: function (words, e) {
        msg.textContent = crmLeadWords(e);
      },
      outcome: async function (reply) {
        closeModal();
        toast(tx('Lead added'));
        await crmLeadsLoad(true);
        var id = reply && reply.party && reply.party.party_id;
        if (id && CRM.byKey[id] && CRM.route && CRM.route.view === 'leads') crmLeadsRefresh();
      }
    }
  );
}

/* ═══ THE RECORD — "Move to…" (the server says which moves, and may/why) ════════════════════════════════════════ */
function crmStageBtn(party) {
  if (!crmEdit() || !party.lead || party.lead.stage === 'customer') return '';
  var verdict = party.lead.may || { ok: true },
    refused = verdict.ok === false;
  return (
    '<button data-cbsid="CRM004-B02" type="button" class="act quiet' +
    (refused ? ' ghost' : '') +
    '" data-crm="rstage" data-testid="crm-act-stage"' +
    (refused ? ' disabled title="' + esc(tx(CRM_LEADS_WAIT)) + '"' : '') +
    '>' +
    esc(tx('Move to…')) +
    (refused ? '<span class="why wide-only">' + esc(tx(CRM_LEADS_WAIT)) + '</span>' : '') +
    '</button>'
  );
}
/** the "Move to…" sheet: one button per stage the server allows this lead to move to */
function crmStageOpen(party, rec) {
  var lead = (rec && rec.lead) || party.lead;
  if (!lead) return;
  ui.dialog({
    mount: 'CRM004-U202',
    pop: 'POP106',
    title: 'Move to…',
    testid: 'crm-stage-sheet',
    body:
      '<div class="supacts">' +
      (lead.moves || [])
        .map(function (item) {
          return (
            '<button data-cbsid="CRM004-B03" type="button" class="act ghost" data-crm="stagego" data-v="' +
            esc(item) +
            '" data-testid="crm-stage-' +
            esc(item) +
            '">' +
            esc(tx(CRM_STAGE[item] || item)) +
            '</button>'
          );
        })
        .join('') +
      '</div>' +
      '<div id="crm_stage_msg" class="hint" role="status" data-testid="crm-stage-msg"></div>',
    actions: [
      { name: 'cancel', options: { mount: 'CRM004-U202' } }
    ]
  });
}
/** move the open party to a stage through CBAction, then repaint the record */
function crmStageGo(stage, btn) {
  var openParty = CRMR.p,
    msg = document.getElementById('crm_stage_msg');
  return CBAction.run(
    btn,
    async function () {
      return api('crmStage', { params: { id: openParty.party_id }, body: { stage: stage } });
    },
    {
      key: 'lead-stage:' + openParty.party_id,
      onFail: function (words, e) {
        if (msg) msg.textContent = crmLeadWords(e);
      },
      outcome: async function () {
        closeModal();
        toast(tx('Moved'));
        if (LEADS.loaded) await crmLeadsLoad(true);
        await crmLoad(true);
        if (CRM.route && CRM.route.view === 'party') crmRecordOpen(CRM.route);
      }
    }
  );
}
/** route a data-crm click (leadadd · leadsave · leadimport · rstage · stagego) to its handler; true when it was ours */
function crmLeadClick(action, node) {
  if (action === 'leadadd') {
    crmLeadAddOpen();
    return true;
  }
  if (action === 'leadsave') {
    crmLeadSave(node);
    return true;
  }
  if (action === 'leadimport') {
    crmImportOpen();
    return true;
  }
  if (action === 'rstage') {
    crmStageOpen(CRMR.p, CRMR.rec);
    return true;
  }
  if (action === 'stagego') {
    crmStageGo(node.getAttribute('data-v'), node);
    return true;
  }
  return false;
}

/* ═══ IMPORT (L3) — the call desk's first list, from a CSV: File → Columns → Check → Import; the outcome shown where it happened ═══════════
 * ⭐ REUSE: the steps are CBSteps (step-flow.js); the preview and the skipped list are CBList mounts (its own ⬇ Download CSV IS "the skipped rows
 *   as CSV"); the write goes through CBAction (M64). ⭐ ONE CALCULATION: the SERVER plans (POST /api/crm/leads/import { dry: true }) and the Check
 *   step PAINTS that plan — this page normalises no phone and dedupes nothing; the only arithmetic here is reading a CSV into cells.
 * ⭐ NEW PATHS (rule 4): crmCsvRows — the api's lib/csv.js is server-side and the bank engine's splitter is private to its vendored copy;
 *   LIMP_GUESS — the catalogue preflight's synonyms name catalogue fields; these name a lead's seven, and the person confirms every guess on Columns.
 * ⚠️ Before the api's b297 runs the Import button is greyed with CRM_LEADS_WAIT (like Add lead); the server still refuses (503 → the same sentence). */
var LIMP = { name: '', rows: [], head: [], map: {}, plan: null, planErr: null, flow: null, prev: null, gen: 0 };
var LIMP_FIELDS = [
  ['name', 'Name'],
  ['phone', 'Phone'],
  ['email', 'Email'],
  ['business', 'Business'],
  ['city', 'City'],
  ['source', 'Source'],
  ['note', 'Note']
];
var LIMP_GUESS = {
  name: ['name', 'lead', 'contact', 'person', 'customer', 'full name', 'contact name', 'lead name', 'customer name'],
  phone: ['phone', 'mobile', 'cell', 'whatsapp', 'tel', 'telephone', 'number', 'phone number', 'mobile number', 'contact number'],
  email: ['email', 'e mail', 'mail', 'email id', 'email address'],
  business: ['business', 'company', 'shop', 'firm', 'organisation', 'organization', 'org', 'store', 'business name', 'company name'],
  city: ['city', 'town', 'place', 'location', 'area'],
  source: ['source', 'from', 'campaign', 'channel', 'origin', 'lead source'],
  note: ['note', 'notes', 'remark', 'remarks', 'comment', 'comments']
};
var LIMP_WILL = { add: 'Will add', merge: 'Will merge', skip: 'Will skip' };
var LIMP_CAP = 'Import up to 500 leads at a time. Split the file.';

/** a CSV's cells (RFC 4180: quotes, doubled quotes, commas and newlines inside quotes, CRLF, a BOM) → rows of strings; blank lines dropped */
function crmCsvRows(text) {
  var rows = [],
    row = [],
    cell = '',
    inQuotes = false,
    source = String(text || '').replace(/^﻿/, '');
  var end = function () {
    row.push(cell);
    if (
      row.some(function (x) {
        return String(x).trim();
      })
    )
      rows.push(row);
    row = [];
    cell = '';
  };
  for (var index = 0; index < source.length; index++) {
    var char = source.charAt(index);
    if (inQuotes) {
      if (char === '"') {
        if (source.charAt(index + 1) === '"') {
          cell += '"';
          index++;
        } else inQuotes = false;
      } else cell += char;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ',') {
      row.push(cell);
      cell = '';
      continue;
    }
    if (char === '\r') continue;
    if (char === '\n') {
      end();
      continue;
    }
    cell += char;
  }
  end();
  return rows;
}
/** the header each field is most likely under — a guess the person confirms on Columns */
function crmImportGuess(head) {
  var map = {},
    used = {},
    norm = function (header) {
      return String(header || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    };
  LIMP_FIELDS.forEach(function (item) {
    var field = item[0],
      words = LIMP_GUESS[field];
    for (var index = 0; index < head.length && map[field] == null; index++) {
      if (used[index]) continue;
      var headerText = norm(head[index]);
      if (
        words.indexOf(headerText) >= 0 ||
        words.some(function (entry) {
          return entry.length > 3 && headerText.indexOf(entry) >= 0;
        })
      ) {
        map[field] = index;
        used[index] = true;
      }
    }
  });
  return map;
}
/** the rows as the api takes them: only the mapped columns, trimmed, empty cells left out */
function crmImportBody() {
  var columnOf = LIMP.map;
  return LIMP.rows.map(function (item) {
    var record = {};
    LIMP_FIELDS.forEach(function (field) {
      var column = columnOf[field[0]];
      if (column != null && item[column] != null && String(item[column]).trim()) record[field[0]] = String(item[column]).trim();
    });
    return record;
  });
}
/** what an import failure says, in the shop's words (the server's message is never shown) */
function crmImportWords(e) {
  var code = e && e.data && e.data.code;
  if (e && e.status === 503) return tx(CRM_LEADS_WAIT);
  if (code === 'TOO_MANY') return tx(LIMP_CAP);
  if (code === 'NO_ROWS') return tx('Nothing to import.');
  if (code === 'VIEW_ONLY' || (e && e.status === 403)) return tx('Your login can only view.');
  if (e && e.status === 409) return tx('Could not add them. Try once more.');
  return tx("Couldn't import. Try again.");
}
function crmImportCounts(plan) {
  return crmPlural(plan.added, 'lead to add', 'leads to add') + ' · ' + plan.merged + ' ' + tx('to merge') + ' · ' + plan.skipped.length + ' ' + tx('to skip');
}

/** the "Import" button: greyed with the server's sentence when view-only, disabled until the lead stages are migrated */
function crmLeadImportBtn() {
  if (!crmEdit())
    return crmViewOnlyBtn(
      'crm-lead-import',
      tx('Import'),
      crmViewWhy()
    ); /* shown, greyed, with the server's sentence — never hidden (the show-action rule, FX-L2C) */
  var blocked = LEADS.loaded && !LEADS.ready;
  return (
    '<button data-cbsid="CRM004-B04" type="button" class="act sm' +
    (blocked ? ' ghost' : '') +
    '" data-testid="crm-lead-import" data-crm="leadimport"' +
    (blocked ? ' disabled title="' + esc(tx(CRM_LEADS_WAIT)) + '"' : '') +
    '>' +
    esc(tx('Import')) +
    '</button>'
  );
}
/** open the Import-from-CSV flow (file → columns → check, then Import) as a stepped sheet */
function crmImportOpen() {
  if (LEADS.loaded && !LEADS.ready) {
    toast(tx(CRM_LEADS_WAIT));
    return;
  }
  LIMP = { name: '', rows: [], head: [], map: {}, plan: null, planErr: null, flow: null, prev: null, gen: 0 };
  ui.dialog({
    mount: 'CRM004-U203',
    pop: 'POP099',
    title: 'Import leads',
    subId: 'crm_imp_sub',
    footId: 'crm_imp_foot',
    testid: 'crm-import-sheet',
    body: '<div id="crm_imp_rail"></div><div id="crm_imp_body"></div>',
    footerHtml: ''
  });
  LIMP.flow = CBSteps.create({
    steps: [
      { k: 'file', n: tx('File'), t: tx('A .csv with a header row') },
      { k: 'map', n: tx('Columns'), t: tx('Which column is which') },
      { k: 'check', n: tx('Check'), t: tx('What will happen') }
    ],
    railEl: 'crm_imp_rail',
    bodyEl: 'crm_imp_body',
    footEl: 'crm_imp_foot',
    subEl: 'crm_imp_sub',
    render: crmImportStep,
    guard: crmImportGuard,
    nextLabel: function (stepKey) {
      return stepKey === 'map' ? tx('Check →') : null;
    },
    sendLabel: function () {
      return tx('Import');
    },
    cancelLabel: tx('Cancel'),
    onCancel: closeModal,
    onSend: crmImportSend,
    onStep: function (stepKey) {
      if (stepKey === 'check') crmImportPlan();
    },
    nextTestid: 'crm-import-next',
    sendTestid: 'crm-import-go',
    backTestid: 'crm-import-back'
  });
  LIMP.flow.paint();
}
/** the HTML of one import step: file, map or check */
function crmImportStep(stepKey) {
  if (stepKey === 'file') {
    var rowCount = LIMP.rows.length;
    return (
      '<label>' +
      esc(tx('CSV file')) +
      '<input data-cbsid="CRM004-I03" class="inp" type="file" accept=".csv,text/csv" data-testid="crm-import-file" onchange="crmImportPick(this)"></label>' +
      '<div class="hint" role="status" data-testid="crm-import-filemsg">' +
      (LIMP.name
        ? esc(LIMP.name) + ' · ' + esc(crmPlural(rowCount, 'row', 'rows')) + (rowCount > 500 ? ' · ' + esc(tx(LIMP_CAP)) : '')
        : esc(tx('Name and phone columns, one lead per row.'))) +
      '</div>'
    );
  }
  if (stepKey === 'map') {
    return LIMP_FIELDS.map(function (item) {
      var key = item[0],
        chosen = LIMP.map[key];
      return (
        '<label>' +
        esc(tx(item[1])) +
        (key === 'name' ? ' *' : '') +
        '<select data-cbsid="CRM004-S02" class="inp" data-testid="crm-import-map-' +
        key +
        '" onchange="crmImportMap(\'' +
        key +
        '\', this.value)"><option value="">' +
        esc(tx('Not in the file')) +
        '</option>' +
        LIMP.head
          .map(function (entry, index) {
            return '<option value="' + index + '"' + (chosen === index ? ' selected' : '') + '>' + esc(entry || tx('Column') + ' ' + (index + 1)) + '</option>';
          })
          .join('') +
        '</select></label>'
      );
    }).join('');
  }
  if (stepKey === 'check') return '<div id="crm_imp_prev" data-testid="crm-import-preview"></div>';
  return '';
}
/** why a step cannot be left — a sentence, or null (the server's refusal rides here too, so Import is greyed WITH its reason) */
function crmImportGuard(stepKey) {
  if (stepKey === 'file') {
    if (!LIMP.rows.length) return tx('Pick a CSV file first.');
    if (LIMP.rows.length > 500) return tx(LIMP_CAP);
    return null;
  }
  if (stepKey === 'map') return LIMP.map.name == null ? tx('Say which column holds the name.') : null;
  if (stepKey === 'check') {
    if (LIMP.planErr) return LIMP.planErr;
    if (!LIMP.plan) return tx('Checking…');
    return LIMP.plan.added + LIMP.plan.merged ? null : tx('Every row would be skipped.');
  }
  return null;
}
/** read the chosen CSV file into LIMP (head, rows, a guessed column map) and repaint; an unreadable file says so in words */
async function crmImportPick(input) {
  var file = input.files && input.files[0];
  if (!file) return;
  var text;
  try {
    text = await file.text();
  } catch (_) {
    LIMP.rows = [];
    LIMP.name = '';
    var node = document.querySelector('[data-testid="crm-import-filemsg"]');
    if (node) node.textContent = tx('That file could not be read.');
    return;
  }
  var all = crmCsvRows(text);
  LIMP.name = file.name;
  LIMP.head = all.length
    ? all[0].map(function (item) {
        return String(item || '').trim();
      })
    : [];
  LIMP.rows = all.slice(1);
  LIMP.map = crmImportGuess(LIMP.head);
  LIMP.plan = null;
  LIMP.planErr = null;
  if (LIMP.flow) {
    LIMP.flow.paintBody();
    LIMP.flow.paintFoot();
  }
}
function crmImportMap(field, value) {
  if (value === '') delete LIMP.map[field];
  else LIMP.map[field] = Number(value);
  LIMP.plan = null;
  LIMP.planErr = null;
  if (LIMP.flow) LIMP.flow.paintFoot();
}
/** the Check step: the server's plan (a dry run), painted — never a second answer */
async function crmImportPlan() {
  var generation = ++LIMP.gen,
    el = document.getElementById('crm_imp_prev');
  if (!el) return;
  LIMP.plan = null;
  LIMP.planErr = null;
  LIMP.flow.paintFoot();
  el.innerHTML = '<div class="loadwrap" role="status"><span class="spin"></span>' + esc(tx('Checking…')) + '</div>';
  try {
    var reply = await api('crmLeadImport', { body: { rows: crmImportBody(), dry: true } });
    if (generation !== LIMP.gen) return;
    LIMP.plan = reply;
  } catch (e) {
    if (generation !== LIMP.gen) return;
    LIMP.planErr = crmImportWords(e);
    el.innerHTML = '<div class="hint" role="alert" data-testid="crm-import-planerr">' + esc(LIMP.planErr) + '</div>';
    LIMP.flow.paintFoot();
    return;
  }
  crmImportList(el, 'crm-import-preview', LIMP.plan.rows || [], true);
  LIMP.flow.paintFoot();
}
/** the import list's columns: name · (will, in the preview only) · why · row · phone — a narrow card keeps the name, the verdict and its reason */
function crmImportColumns(preview) {
  /* in the sheet the list is a narrow card: the name, the verdict and its reason stay; the row number and the phone are named in the chooser */
  var cols = [
    {
      key: 'name',
      label: 'Name',
      prio: 1,
      w: 180,
      cell: function (row) {
        return row.name || '—';
      },
      value: function (row) {
        return row.name || '';
      }
    }
  ];
  if (preview)
    cols.push({
      key: 'will',
      label: 'Will',
      prio: 1,
      w: 110,
      html: true,
      hfilter: 'will',
      cell: function (row) {
        return (
          '<span class="tag' +
          (row.outcome === 'add' ? ' on' : row.outcome === 'merge' ? ' local' : '') +
          '" data-will="' +
          esc(row.outcome) +
          '">' +
          esc(tx(LIMP_WILL[row.outcome] || row.outcome)) +
          '</span>'
        );
      },
      value: function (row) {
        return row.outcome;
      }
    });
  cols.push({
    key: 'why',
    label: 'Why',
    prio: 1,
    w: 200,
    cell: function (row) {
      return row.why || '';
    }
  });
  cols.push({
    key: 'row',
    label: 'Row',
    prio: 3,
    w: 64,
    sort: 'row',
    cell: function (row) {
      return String(row.row);
    },
    value: function (row) {
      return row.row;
    }
  });
  cols.push({
    key: 'phone',
    label: 'Phone',
    prio: 4,
    w: 140,
    cell: function (row) {
      return row.phone || '—';
    }
  });
  return cols;
}
/** the preview (will add · will merge · will skip + why) and the skipped list after the import: ONE list unit, CBList — its ⬇ is the CSV download */
function crmImportList(el, key, rows, preview) {
  if (LIMP.prev && LIMP.prev.destroy) {
    try {
      LIMP.prev.destroy();
    } catch (failure) {
      // the old import list is replaced right below, so a failed tear-down only leaves stale listeners; say so and carry on
      if (typeof cblog === 'function') cblog('warn', 'crm import: the old list could not be torn down — ' + ((failure && failure.message) || 'no answer'));
    }
  }
  var cols = crmImportColumns(preview);
  var plan = LIMP.plan,
    testIdPrefix = preview ? 'crm-imp-prev-' : 'crm-imp-skip-';
  LIMP.prev = CBList.mount(el, {
    key: key,
    t: tx,
    rows: function () {
      return rows;
    },
    id: function (row) {
      return row.row;
    },
    rowTid: function (row) {
      return testIdPrefix + row.row;
    },
    columns: function () {
      return cols;
    },
    defaultCols: cols.map(function (item) {
      return item.key;
    }),
    cardMax: preview ? 4 : 3,
    fill: false,
    /* the counts are a plain chip (a notice is amber — advisory — and these are facts); the step's own line already says "What will happen" */
    head: function () {
      return { title: preview ? '' : tx('Skipped rows'), chips: preview && plan ? [{ text: crmImportCounts(plan), tid: 'crm-import-counts' }] : [] };
    },
    state: function () {
      return 'ready';
    },
    empty: { title: preview ? tx('Nothing to check') : tx('Nothing skipped'), sub: '' },
    search: function (row) {
      return [row.name, row.phone, row.why].join(' ');
    },
    searchHint: tx('Name or phone'),
    filters: preview
      ? [
          {
            key: 'will',
            label: tx('Will'),
            all: tx('All rows'),
            options: ['add', 'merge', 'skip'].map(function (item) {
              return { v: item, label: tx(LIMP_WILL[item]) };
            }),
            match: function (row, value) {
              return row.outcome === value;
            }
          }
        ]
      : [],
    sorts: [
      {
        key: 'row',
        label: tx('Row'),
        cmp: function (left, right) {
          return left.row - right.row;
        }
      }
    ]
  });
}
/** send the mapped rows to the server in one CBAction and show the outcome */
function crmImportSend() {
  var btn = document.querySelector('[data-testid="crm-import-go"]');
  return CBAction.run(
    btn,
    async function () {
      return api('crmLeadImport', { body: { rows: crmImportBody() } });
    },
    {
      key: 'lead-import',
      busy: tx('Importing…'),
      onFail: function (words, e) {
        LIMP.planErr = crmImportWords(e);
        if (LIMP.flow) LIMP.flow.paintFoot();
      },
      outcome: async function (reply) {
        crmImportDone(reply || { added: 0, merged: 0, skipped: [] });
        await crmLeadsLoad(true);
      }
    }
  );
}
/** the outcome, where the action happened: the three numbers large, the skipped rows as a list (downloadable), Done */
function crmImportDone(result) {
  var node = document.getElementById('crm_imp_sub');
  if (node) node.textContent = tx('Imported');
  var rail = document.getElementById('crm_imp_rail');
  if (rail) rail.innerHTML = '';
  var body = document.getElementById('crm_imp_body');
  if (!body) return;
  var skipped = result.skipped || [];
  var bigNumber = function (count, caption, testId) {
    return '<div data-testid="' + testId + '"><strong style="font-size:var(--fs-4,24px)">' + Number(count) + '</strong> <span class="sub">' + esc(caption) + '</span></div>';
  };
  body.innerHTML =
    '<div data-testid="crm-import-outcome" style="display:flex;gap:22px;flex-wrap:wrap;padding:6px 0">' +
    bigNumber(result.added, tx('added'), 'crm-import-added') +
    bigNumber(result.merged, tx('merged'), 'crm-import-merged') +
    bigNumber(skipped.length, tx('skipped'), 'crm-import-skipped') +
    '</div>' +
    '<div id="crm_imp_skipped"></div>';
  if (skipped.length) crmImportList(document.getElementById('crm_imp_skipped'), 'crm-import-skipped', skipped, false);
  var foot = document.getElementById('crm_imp_foot');
  if (foot) foot.innerHTML = '<button data-cbsid="CMP004" type="button" class="pri" data-testid="crm-import-done" onclick="closeModal()">' + esc(tx('Done')) + '</button>';
  toast(crmPlural(Number(result.added) + Number(result.merged), 'lead imported', 'leads imported'));
}
