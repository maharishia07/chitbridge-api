/* cap-crm-privacy-register.js — CB CRM: the shop's PRIVACY REQUESTS register (#/privacy): the list, Log a request, Answer a request.
 * OWNS      the register (crmPrivacy, a CBList) · its footer and load (crmPrivFoot, crmPrivLoad, crmPrivRefresh) · Log a request (crmPrivReqOpen, crmPrivReqSave) · Answer a request (crmPrivAnswerOpen, crmPrivAnswerSave) · the register's error words (crmPrivWhy); moved out of cap-crm-privacy.js (2026-11-17, size ratchet; behaviour unchanged)
 * CALLED BY crm.html (<script src>, after cap-crm-privacy.js: it reads PRV and the CRM_REQ_* words declared there) · cap-crm.js (crmRoute → crmPrivacy on #/privacy) · cap-crm-privacy.js (crmPrivacyClick hands the register's clicks here)
 * FLOW      #/privacy → crmPrivacy draws the CBList → crmPrivLoad reads the register → a row opens Answer (crmPrivAnswerOpen → crmPrivAnswerSave), Log a request opens crmPrivReqOpen → crmPrivReqSave → crmPrivRefresh
 * CARD      11-crm-and-marketing/crm-privacy
 * The server decides: nothing is computed here; the due date, the late flag and the law's words are the server's.
 */
'use strict';
/* ═══ 2 · THE REGISTER — #/privacy: every request to see, correct, erase, withdraw, nominate or complain, on the law's clock ═══ */
function crmPrivacy(frame, params) {
  PRV.params = params || {};
  crmBar(
    '<a href="#/parties" data-testid="crm-back">‹ ' + esc(tx('Parties')) + '</a>',
    crmEdit()
      ? '<button data-cbsid="CRM010-B03" type="button" class="act sm" data-crm="prvadd" data-testid="crm-prv-add">+ ' + esc(tx('Log a request')) + '</button>'
      : crmViewOnlyBtn('crm-prv-add', '+ ' + tx('Log a request'), crmViewWhy()),
    true
  );
  var node = document.getElementById('screen');
  node.className = 'screen flush';
  node.innerHTML = '<div id="crm_prv" data-testid="crm-prv-list"></div>';
  if (PRV.api && PRV.api.destroy) {
    try {
      PRV.api.destroy();
    } catch (_) { /* best effort: failing here changes nothing the user sees */ }
  }
  var el = document.getElementById('crm_prv');
  var due = function (r) {
    if (r.answered_at)
      return (
        '<span class="tag' +
        (r.answered_late ? ' amber' : ' green') +
        '">' +
        esc(tx(CRM_REQ_OUT[r.outcome] || 'Answered')) +
        (r.answered_late ? ' · ' + esc(tx('late')) : '') +
        '</span>'
      );
    return (
      '<span class="tag' +
      (r.late ? ' amber' : '') +
      '" data-testid="crm-prv-due-' +
      r.request_id +
      '">' +
      (r.late ? esc(tx('Late')) + ' · ' : '') +
      esc(bkDate(r.due_at)) +
      '</span>'
    ); /* amber: AA in both themes (rule 13); the word says late */
  };
  PRV.api = CBList.mount(el, {
    key: 'crm-privacy',
    t: tx,
    rows: function () {
      return PRV.state === 'ready' ? PRV.rows : [];
    },
    id: function (r) {
      return r.request_id;
    },
    rowTid: function (r) {
      return 'crm-prv-' + r.request_id;
    },
    columns: [
      {
        key: 'who',
        label: 'Who',
        prio: 1,
        w: 220,
        cell: function (r) {
          return r.who;
        }
      },
      {
        key: 'kind',
        label: 'Asked for',
        prio: 2,
        w: 160,
        cell: function (r) {
          return tx(CRM_REQ_KIND[r.kind] || r.kind);
        }
      },
      { key: 'due', label: 'Due', prio: 3, w: 170, html: true, cell: due },
      {
        key: 'received',
        label: 'Received',
        prio: 4,
        w: 130,
        cell: function (r) {
          return bkDate(r.received_at);
        }
      },
      {
        key: 'country',
        label: 'Law of',
        prio: 5,
        w: 90,
        cell: function (r) {
          return r.country || '—';
        }
      },
      {
        key: 'answer',
        label: 'Answer',
        prio: 6,
        w: 300,
        cell: function (r) {
          return r.answer || '—';
        }
      }
    ],
    defaultCols: ['who', 'kind', 'due'],
    cardMax: 3,
    fill: true,
    head: function () {
      var chips = [];
      if (PRV.state === 'ready' && PRV.late) chips.push({ text: crmPlural(PRV.late, 'late', 'late'), tid: 'crm-prv-late' });
      if (PRV.state === 'ready' && !PRV.open && PRV.total) chips.push({ text: tx('All answered'), tid: 'crm-prv-allanswered' });
      return { title: tx('Privacy requests'), chips: chips };
    },
    state: function () {
      return PRV.state === 'loading' ? 'loading' : PRV.state === 'error' ? 'error' : null;
    },
    error: function () {
      return crmErrWords(PRV.err, 'privacy requests');
    },
    onRetry: function () {
      crmPrivLoad();
    },
    empty: function () {
      return PRV.state === 'notyet'
        ? { title: tx('Privacy requests start after an update.'), sub: tx('Nothing is lost.') }
        : { title: tx('No privacy requests.'), sub: tx('Log one when a person asks to see, correct or erase their data.') };
    },
    filters: [
      {
        key: 'open',
        label: tx('State'),
        all: tx('All'),
        options: [{ v: '1', label: tx('Open') }],
        match: function () {
          return true;
        }
      }
    ],
    remote: {
      total: function () {
        return PRV.total;
      },
      onQuery: function (q) {
        PRV.openOnly = q.filt.open === '1';
        PRV.page = 1;
        crmPrivLoad();
      },
      foot: crmPrivFoot
    },
    actions: [
      {
        id: 'answer',
        label: tx('Answer'),
        icon: '✓',
        tid: 'crm-prv-answer',
        why: function (r) {
          return r.answered_at ? tx('Answered once') : PRV.mayAnswer ? '' : PRV.why || tx('Only the owner answers');
        },
        run: function (r) {
          crmPrivAnswerOpen(r.request_id);
        }
      }
    ]
  });
  if (!frame) {
    crmPrivLoad();
    if (PRV.params.add === '1' && crmEdit()) crmPrivReqOpen(PRV.params);
  }
}
/** the page's own pager under the rows (the unit's `foot`): the server's total · page · limit, two buttons */
function crmPrivFoot() {
  if (PRV.state !== 'ready' || !PRV.total) return '';
  var pages = Math.max(1, Math.ceil(PRV.total / PRV.limit));
  if (pages <= 1) return '';
  return (
    '<span data-testid="crm-prv-page">' +
    esc(txf('Page {p} of {n}', { p: PRV.page, n: pages })) +
    '</span> ' +
    '<button data-cbsid="CRM010-B04" type="button" class="crm-mini" data-crm="prvpage" data-v="' +
    (PRV.page - 1) +
    '"' +
    (PRV.page <= 1 ? ' disabled' : '') +
    ' data-testid="crm-prv-prev">‹ ' +
    esc(tx('Previous')) +
    '</button> ' +
    '<button data-cbsid="CRM010-B05" type="button" class="crm-mini" data-crm="prvpage" data-v="' +
    (PRV.page + 1) +
    '"' +
    (PRV.page >= pages ? ' disabled' : '') +
    ' data-testid="crm-prv-next">' +
    esc(tx('Next')) +
    ' ›</button>'
  );
}
async function crmPrivLoad() {
  PRV.state = 'loading';
  crmPrivRefresh();
  try {
    var q = { page: PRV.page, limit: PRV.limit };
    if (PRV.openOnly) q.open = '1';
    var reply = await api('crmPrivReqs', { query: q });
    /* core.js api() collapses { requests[], … } to the array and carries total · page · limit · open · late · may_answer · why on it (SIBS) */
    PRV.rows = Array.isArray(reply) ? reply : reply.requests || [];
    PRV.total = Number(reply.total) || PRV.rows.length;
    PRV.open = Number(reply.open) || 0;
    PRV.late = Number(reply.late) || 0;
    PRV.mayAnswer = !!reply.may_answer;
    PRV.why = reply.why || null;
    PRV.limit = Number(reply.limit) || PRV.limit;
    PRV.state = 'ready';
    PRV.err = null;
  } catch (e) {
    PRV.state = e && e.status === 503 ? 'notyet' : 'error';
    PRV.err = e;
  }
  crmPrivRefresh();
}
function crmPrivRefresh() {
  var a = PRV.api;
  if (a && document.getElementById('crm_prv')) a.refresh();
  if (CRM.route && CRM.route.view === 'privacy') crmNav('privacy');
} /* the nav's late count follows the load */

/* ── Log a request (who · what · when · which law) — the owner or staff; the date the law sets is the SERVER's ── */
function crmPrivReqOpen(pre) {
  pre = pre || {};
  var kinds = Object.keys(CRM_REQ_KIND)
    .map(function (item) {
      return '<option value="' + item + '">' + esc(tx(CRM_REQ_KIND[item])) + '</option>';
    })
    .join('');
  ui.dialog({
    mount: 'CRM010-U201',
    pop: 'POP103',
    title: 'Log a privacy request',
    testid: 'crm-prv-sheet',
    body:
      '<label>' +
      esc(tx('Who asked?')) +
      '<input data-cbsid="CRM010-I01" class="inp" id="crm_prv_who" data-testid="crm-prv-who" value="' +
      esc(pre.who || '') +
      '" placeholder="' +
      esc(tx('Name, phone or e-mail')) +
      '"></label>' +
      '<label>' +
      esc(tx('Asked for')) +
      '<select data-cbsid="CRM010-S01" class="inp" id="crm_prv_kind" data-testid="crm-prv-kind">' +
      kinds +
      '</select></label>' +
      '<label>' +
      esc(tx('Received on')) +
      '<input data-cbsid="CRM010-I02" class="inp" id="crm_prv_when" data-testid="crm-prv-when" type="date" value="' +
      esc(crmLocalISO(new Date())) +
      '" style="width:auto"></label>' +
      '<input type="hidden" id="crm_prv_party" value="' +
      esc(pre.party || '') +
      '">' +
      '<div class="hint">' +
      esc(tx('The answer date follows the shop’s country’s law.')) +
      '</div>' +
      '<div id="crm_prv_msg" class="hint" role="status" data-testid="crm-prv-msg"></div>',
    footerHtml:
      ui.footerAction({ name: 'cancel', options: { mount: 'CRM010-U201' } }) +
      '<button data-cbsid="CRM010-B06" type="button" class="pri" data-crm="prvsave" data-testid="crm-prv-save">' +
      esc(tx('Log')) +
      '</button>'
  });
  document.getElementById('crm_prv_who').focus();
}
async function crmPrivReqSave() {
  if (PRV.busy) return;
  var node = function (id) {
      return String((document.getElementById(id) || {}).value || '').trim();
    },
    msg = document.getElementById('crm_prv_msg');
  if (!node('crm_prv_who')) {
    msg.textContent = tx('Who asked? A name, phone or e-mail.');
    return;
  }
  PRV.busy = true;
  try {
    var body = { who: node('crm_prv_who'), kind: node('crm_prv_kind'), received_at: new Date(node('crm_prv_when') + 'T09:00:00').toISOString() };
    if (node('crm_prv_party')) body.party_id = node('crm_prv_party');
    await api('crmPrivReqAdd', { body: body });
    closeModal();
    toast(tx('Logged'));
    PRV.page = 1;
    crmPrivLoad();
  } catch (e) {
    msg.textContent = crmPrivWhy(e);
  } finally {
    PRV.busy = false;
  }
}
/* ── Answer: once, by the owner; what was done or why not ── */
function crmPrivAnswerOpen(id) {
  var r = PRV.rows.filter(function (x) {
    return x.request_id === id;
  })[0];
  if (!r) return;
  if (!PRV.mayAnswer) {
    toast(PRV.why || tx('Only the owner answers'));
    return;
  }
  ui.dialog({
    mount: 'CRM010-U202',
    pop: 'POP102',
    titleText: tx('Answer') + ' · ' + r.who,
    testid: 'crm-prv-answer-sheet',
    body:
      '<div class="kv"><b>' +
      esc(tx('Asked for')) +
      '</b><span>' +
      esc(tx(CRM_REQ_KIND[r.kind] || r.kind)) +
      ' · ' +
      esc(tx('due')) +
      ' ' +
      esc(bkDate(r.due_at)) +
      '</span></div>' +
      (r.kind === 'erase'
        ? '<div class="hint" data-testid="crm-prv-erase-note">' +
          esc(tx('Erasure runs through the platform’s lifecycle path. Record the outcome here.')) +
          '</div>'
        : '') +
      '<label>' +
      esc(tx('Outcome')) +
      '<select data-cbsid="CRM010-S02" class="inp" id="crm_prv_out" data-testid="crm-prv-out">' +
      Object.keys(CRM_REQ_OUT)
        .map(function (item) {
          return '<option value="' + item + '">' + esc(tx(CRM_REQ_OUT[item])) + '</option>';
        })
        .join('') +
      '</select></label>' +
      '<label>' +
      esc(tx('What was done, or why not')) +
      '<textarea data-cbsid="CRM010-T01" class="inp" id="crm_prv_ans" data-testid="crm-prv-ans" rows="3"></textarea></label>' +
      '<div id="crm_prv_amsg" class="hint" role="status" data-testid="crm-prv-amsg"></div>',
    footerHtml:
      ui.footerAction({ name: 'cancel', options: { mount: 'CRM010-U202' } }) +
      '<button data-cbsid="CRM010-B07" type="button" class="pri" data-crm="prvanswersave" data-id="' +
      esc(id) +
      '" data-testid="crm-prv-answer-save">' +
      esc(tx('Answer')) +
      '</button>'
  });
  document.getElementById('crm_prv_ans').focus();
}
async function crmPrivAnswerSave(id) {
  if (PRV.busy) return;
  var node = function (k) {
      return String((document.getElementById(k) || {}).value || '').trim();
    },
    msg = document.getElementById('crm_prv_amsg');
  if (!node('crm_prv_ans')) {
    msg.textContent = tx('Write what was done, or why not.');
    return;
  }
  PRV.busy = true;
  try {
    await api('crmPrivReqAnswer', { params: { id: id }, body: { outcome: node('crm_prv_out'), answer: node('crm_prv_ans') } });
    closeModal();
    toast(tx('Answered'));
    crmPrivLoad();
  } catch (e) {
    msg.textContent = crmPrivWhy(e);
  } finally {
    PRV.busy = false;
  }
}
/** the server's refusal in the shop's words (its `why` or `message` when it is a sentence; never a raw error) */
function crmPrivWhy(e) {
  if (e && e.status === 503) return tx('Privacy requests start after an update. Nothing is lost.');
  var m = e && e.data && (e.data.why || e.data.message); /* core.js api(): e.status + e.data = the answer's own body */
  return m && e.status < 500 ? String(m) : tx("Couldn't save that. Try again.");
}
