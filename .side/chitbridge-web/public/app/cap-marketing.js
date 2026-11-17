/* cap-marketing.js - THE MARKETING FACE of the CRM small app (MKT first slice, 22 Oct 2026; critic MKT-critic-2026-10-22 change 1).
 * Marketing is not a second page and not a second list: it is crm.html opened as `?app=marketing`. The face sets the brand, the title, the screen id, the kural
 * and the five tabs - Leads, Groups, Offers sent, Who came back, Shop window - and mounts the screens CRM already has (cap-crm-leads.js, cap-crm-groups.js)
 * with no copy. It adds the two screens Marketing needs: Offers sent (the receipts of every offer, sent or not, each with the reason) and Who came back
 * (the customers who were SENT an offer and then bought, read from real bills by the server). The default face - no `app` in the address - is CRM exactly as before.
 * ⭐ REUSE: CBList (both lists - remote-paged like the privacy register) · crmBar/crmNav/crmRoute/crmGo (the shell) · crmGroupsLoad + crmSendOpen + crmGroupsWhyNot
 *   (the win-back card opens the SAME Send sheet; the server says may/why) · crmMiniBox/crmMiniRow (the bills behind a customer) · openChitSheet (a bill opens the chit) ·
 *   crmErrWords · bkDate/crmWhen · fmtMoney (amounts per currency, never added across them).
 * ⭐ NO CALCULATION HERE: who came back, the days, the money per currency and the reason for a 0 are the server's (GET /api/marketing/came-back, lib/marketing-results);
 *   the reason of a not-sent offer is the server's `reason_code`, worded below - the screen never branches on a sentence.
 * ⭐ NEW PATHS (rule 4): this module (the two screens did not exist) and MKT_EP (no reader of those two routes existed).
 * OWNS      the Marketing face (crmFace · crmFaceNav · crmFaceRoute · crmFaceKural) · Offers sent (#/sent) · Who came back (#/results) · the win-back card · MKT_EP.
 * CALLED BY crm.html (<script src>; its `const FACE = crmFace()` and MKT_EP) · cap-crm.js (crmNav asks crmFaceNav; crmRoute asks crmFaceRoute; crmFaceKural; the click listener asks crmMarketingClick).
 * FLOW      crm.html?app=marketing → crmFace() → crmRoute → #/sent → mktSent() [GET /api/channels/outbound?purpose=marketing] · #/results → mktResults() [GET /api/marketing/came-back]
 * CARD      12-marketing/README
 * Needs cap-crm.js, cap-crm-groups.js (CRM · GROUPS · crmBar · crmNav · crmGo · crmSendOpen · crmGroupsLoad · tx/txf · esc · api). */
'use strict';

var MKT_EP = {
  mktCameBack: { m: 'GET', p: '/api/marketing/came-back', ok: 'y' }, // ?page=&limit= → { customers[], sent_n, came_back_n, days, counts, why, money, total, page, limit }
  mktSent: { m: 'GET', p: '/api/channels/outbound', ok: 'y' } // ?purpose=marketing&status=&page=&limit= → { outbound[], total, page, limit, migrated }
};

/* ═══ THE FACE - which screens, which words ═════════════════════════════════════════════════════════════════════════ */
var CRM_FACES = {
  marketing: {
    app: 'marketing',
    brand: 'Marketing',
    title: 'Marketing',
    kural: 'crm-leads',
    home: 'results',
    tabs: ['leads', 'groups', 'sent', 'results', 'showcase']
  }
};
var MKT_FACE = null,
  MKT_FACE_READ = false;
/** the face this page was opened as ({ brand, title, tabs … }) - null for CRM itself. Read once from `?app=`. */
function crmFace() {
  if (!MKT_FACE_READ) {
    MKT_FACE_READ = true;
    var asked = typeof URLSearchParams === 'function' ? new URLSearchParams(location.search).get('app') : '';
    MKT_FACE = CRM_FACES[asked || ''] || null;
  }
  return MKT_FACE;
}
function crmFaceKural() {
  var face = crmFace();
  return face ? face.kural : null;
}
var MKT_NAV_EXTRA = {
  sent: ['sent', 'Offers sent', 'M3 11l18-8-8 18-2-8z', ''],
  results: ['results', 'Who came back', 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3', '']
};
/** the sidebar for this face: the CRM items it keeps, in its order, plus its own two - null when this is CRM itself (crmNav keeps its full list) */
function crmFaceNav(items) {
  var face = crmFace();
  if (!face) return null;
  var byKey = {};
  items.forEach(function (item) {
    byKey[item[0]] = item;
  });
  Object.keys(MKT_NAV_EXTRA).forEach(function (key) {
    byKey[key] = MKT_NAV_EXTRA[key].slice();
  });
  if (CAME.state === 'ready' && CAME.data && CAME.data.came_back_n) byKey.results[3] = '<span class="n quiet" data-testid="mkt-nav-n-results">' + CAME.data.came_back_n + '</span>';
  return face.tabs
    .map(function (key) {
      return byKey[key];
    })
    .filter(Boolean);
}
/** the face's own routes (#/sent · #/results) and its home (an empty address goes to the face's first screen); true when handled */
function crmFaceRoute(segments, params, frame) {
  var face = crmFace();
  if (!face) return false;
  if (!segments[0]) {
    history.replaceState(null, '', '#/' + face.home);
    return crmFaceRoute([face.home], params, frame);
  }
  if (segments[0] !== 'sent' && segments[0] !== 'results') return false;
  window.CRM.route = { nav: segments[0], view: segments[0], sub: '', params: params };
  crmNav(segments[0]);
  if (segments[0] === 'sent') mktSent(frame);
  else mktResults(frame);
  return true;
}

/* ═══ THE WORDS - a code from the server, a short line here ═════════════════════════════════════════════════════════ */
var MKT_WHY = {
  NO_CONSENT: 'No consent yet',
  SAID_NO: 'Said no',
  CONSENT_WITHDRAWN: 'Withdrew consent',
  OPTED_OUT: 'Asked not to be messaged',
  CONSENT_UNREADABLE: 'Consent could not be read',
  NO_PHONE: 'No phone number',
  NO_TEMPLATE: 'No approved offers template',
  NO_TOKEN: 'WhatsApp is not connected',
  FAILED: 'WhatsApp did not take it',
  NOT_SENT: 'Not sent'
};
/** why a result list is empty, by the server's `why.code` - the line, and the one action that fixes it ([label, href]; a null href is Channels in Settings) */
var MKT_EMPTY = {
  NO_SENDS: ['No offer sent yet. Send one from Groups.', ['Open Groups', '#/groups']],
  NO_TEMPLATE: ['Offers need an approved WhatsApp template first.', ['Open Channels', null]],
  NO_TOKEN: ['WhatsApp is not connected, so nothing went out.', ['Open Channels', null]],
  NO_CONSENT: ['Nobody has agreed to offers yet.', ['Open Groups', '#/groups']],
  ALL_REFUSED: ['Every send was refused. See why in Offers sent.', ['Open Offers sent', '#/sent']],
  MKT_NOT_MIGRATED: ['Who came back arrives after the next update.', null]
};
/** an amount in its own currency (fmtMoney), never added across currencies */
function mktMoney(total, currency) {
  try {
    return fmtMoney(Number(total || 0), bkCur(currency));
  } catch (error) {
    console.warn('Marketing: an amount was shown plain —', (error && error.message) || error);
    return String(currency || '') + ' ' + String(total || 0);
  }
}
/** "₹180 · 3 bills" per currency - never one total across two currencies */
function mktMoneyWords(money) {
  return ((money && money.by_currency) || [])
    .map(function (entry) {
      return mktMoney(entry.total, entry.currency) + ' · ' + crmPlural(entry.chits, 'bill', 'bills');
    })
    .join('  ');
}
/** a CBList column in one line: key · label · priority · width · the cell's text (or markup with more.html) */
function mktCol(key, label, prio, width, cell, more) {
  return Object.assign({ key: key, label: label, prio: prio, w: width, cell: cell }, more || {});
}
/** destroy the list a screen mounted last time; a list whose page is already gone says so in the console and is dropped */
function mktDrop(holder) {
  if (!holder.api || !holder.api.destroy) return;
  try {
    holder.api.destroy();
  } catch (error) {
    console.warn('Marketing: the old list was already gone —', (error && error.message) || error);
    holder.api = null;
  }
}

/* ═══ OFFERS SENT - the receipts of every offer, sent or not ═══════════════════════════════════════════════════════ */
var MKT_UNLOGGED = false; /* the last send's refusals were not recorded (the server's refusals_unlogged): Offers sent says so */
/** the Send sheet hands over each send's answer - the one fact Offers sent needs from it */
function mktNoteSend(event) {
  MKT_UNLOGGED = !!(event.detail && event.detail.refusals_unlogged);
}
document.addEventListener('crm-send-done', mktNoteSend);
var SENT = { rows: [], total: 0, page: 1, limit: 50, status: '', state: 'loading', err: null, migrated: true, api: null };
/** the Result tag: Sent (green) or Not sent (amber - advisory, never red) */
function mktResultTag(row) {
  var sent = row.status === 'sent';
  return '<span class="tag' + (sent ? ' on' : ' amber') + '" data-testid="mkt-sent-result-' + esc(row.id) + '">' + esc(tx(sent ? 'Sent' : 'Not sent')) + '</span>';
}
/** the columns of Offers sent: who · result · why not · when · consent · number */
function mktSentCols() {
  return [
    mktCol('who', 'Customer', 1, 230, function (row) {
      return row.party_name || row.to_ref || '—';
    }),
    mktCol('result', 'Result', 2, 120, mktResultTag, { html: true }),
    mktCol('why', 'Why not', 3, 260, function (row) {
      return row.status === 'sent' ? '—' : tx(MKT_WHY[row.reason_code] || MKT_WHY.NOT_SENT);
    }),
    mktCol('when', 'When', 4, 150, function (row) {
      return crmWhen(row.created_at);
    }),
    mktCol('consent', 'Consent', 5, 170, function (row) {
      var basis = row.basis || {};
      return basis.code === 'CONSENT' && basis.at ? tx('Agreed') + ' ' + bkDate(basis.at) : '—';
    }),
    mktCol('to', 'Number', 6, 150, function (row) {
      return row.to_ref || '—';
    })
  ];
}
function mktSentRefresh() {
  if (SENT.api && document.getElementById('mkt_sent')) SENT.api.refresh();
}
/** read one page of the offers' receipts (the server pages and filters: total · page · limit) */
async function mktSentLoad() {
  SENT.state = 'loading';
  mktSentRefresh();
  try {
    var query = { purpose: 'marketing', page: SENT.page, limit: SENT.limit };
    if (SENT.status) query.status = SENT.status;
    var reply = await api('mktSent', { query: query });
    SENT.rows = reply.outbound || [];
    SENT.total = Number(reply.total) || SENT.rows.length;
    SENT.limit = Number(reply.limit) || SENT.limit;
    SENT.migrated = reply.migrated !== false;
    SENT.state = 'ready';
    SENT.err = null;
  } catch (error) {
    SENT.state = 'error';
    SENT.err = error;
  }
  mktSentRefresh();
}
/** one pager button (the unit's `foot`): the page it goes to, disabled at the ends */
function mktPageBtn(label, to, disabled, testId) {
  return '<button data-cbsid="MKT003-B01" type="button" class="crm-mini" data-crm="mktpage" data-v="' + to + '"' + (disabled ? ' disabled' : '') + ' data-testid="' + testId + '">' + esc(label) + '</button> ';
}
/** the pager under the rows: the server's total · page · limit, two buttons */
function mktSentFoot() {
  var pages = Math.max(1, Math.ceil(SENT.total / SENT.limit));
  if (SENT.state !== 'ready' || pages <= 1) return '';
  return (
    '<span data-testid="mkt-sent-page">' + esc(txf('Page {p} of {n}', { p: SENT.page, n: pages })) + '</span> ' +
    mktPageBtn('‹ ' + tx('Previous'), SENT.page - 1, SENT.page <= 1, 'mkt-sent-prev') +
    mktPageBtn(tx('Next') + ' ›', SENT.page + 1, SENT.page >= pages, 'mkt-sent-next')
  );
}
/** the Result filter: the choice goes to the server (?status=), the list filters nothing itself */
function mktSentFilters() {
  return [
    {
      key: 'status',
      label: tx('Result'),
      all: tx('All'),
      options: [
        { v: 'sent', label: tx('Sent') },
        { v: 'refused', label: tx('Not sent') }
      ],
      match: function () {
        return true;
      }
    }
  ];
}
/** the list's head: its title, and a warning while b776 has not run */
function mktSentHead() {
  var warn = SENT.state === 'ready' && !SENT.migrated ? [{ text: tx('Offers sent arrives after the next update.'), cls: 'warn', tid: 'mkt-sent-nomig' }] : [];
  if (MKT_UNLOGGED) warn.push({ text: tx('Some refusals were not recorded. They show after the next update.'), cls: 'warn', tid: 'mkt-sent-unlogged' });
  return { title: tx('Offers sent'), notices: warn };
}
function mktSentEmpty() {
  return SENT.migrated ? { title: tx('No offers sent yet.'), sub: tx('Send one from Groups.') } : { title: tx('Offers sent starts after an update.'), sub: tx('Nothing is lost.') };
}
/** the whole CBList mount for Offers sent: remote-paged, the Result filter on the server */
function mktSentOptions() {
  return {
    key: 'mkt-sent',
    t: tx,
    rows: function () {
      return SENT.rows;
    },
    id: function (row) {
      return row.id;
    },
    rowTid: function (row) {
      return 'mkt-sent-' + row.id;
    },
    columns: mktSentCols,
    defaultCols: ['who', 'result', 'why', 'when'],
    cardMax: 3,
    fill: true,
    head: mktSentHead,
    state: function () {
      return SENT.state === 'loading' ? 'loading' : SENT.state === 'error' ? 'error' : null;
    },
    error: function () {
      return crmErrWords(SENT.err, 'offers sent');
    },
    onRetry: mktSentLoad,
    empty: mktSentEmpty,
    filters: mktSentFilters(),
    remote: {
      total: function () {
        return SENT.total;
      },
      onQuery: function (query) {
        SENT.status = (query.filt && query.filt.status) || '';
        SENT.page = 1;
        mktSentLoad();
      },
      foot: mktSentFoot
    }
  };
}
/** #/sent - Offers sent (?status=sent|refused opens it already narrowed) */
function mktSent(frame) {
  crmBar('<strong>' + esc(crmAppName()) + '</strong>', '', true);
  var node = document.getElementById('screen');
  node.className = 'screen flush';
  node.innerHTML = '<div id="mkt_sent" data-testid="mkt-sent"></div>';
  mktDrop(SENT);
  var wanted = window.CRM.route && window.CRM.route.params && window.CRM.route.params.status;
  SENT.status = wanted === 'sent' || wanted === 'refused' ? wanted : '';
  SENT.page = 1;
  SENT.api = CBList.mount(document.getElementById('mkt_sent'), mktSentOptions());
  if (!frame) mktSentLoad();
}

/* ═══ WHO CAME BACK - the customers who were SENT an offer and then bought ═══════════════════════════════════════ */
var CAME = { data: null, state: 'loading', err: null, page: 1, limit: 50, api: null };
/** read the server's answer (one GET) and repaint the figures and the list */
async function mktResultsLoad() {
  CAME.state = CAME.data ? 'ready' : 'loading';
  mktResultsRefresh();
  try {
    CAME.data = await api('mktCameBack', { query: { page: CAME.page, limit: CAME.limit } });
    CAME.state = 'ready';
    CAME.err = null;
  } catch (error) {
    CAME.state = CAME.data ? 'ready' : 'error';
    CAME.err = error;
  }
  mktResultsRefresh();
  if (window.CRM.route && window.CRM.route.view === 'results') crmNav('results');
}
function mktResultsRefresh() {
  if (CAME.api && document.getElementById('mkt_came')) CAME.api.refresh();
  mktTopPaint();
}
/** the columns of Who came back: who · what they bought (per currency) · first bill · when the offer went */
function mktCameCols() {
  return [
    mktCol(
      'who',
      'Customer',
      1,
      240,
      function (row) {
        return row.name || '—';
      },
      {
        tid: function (row) {
          return 'mkt-came-name-' + row.party_id;
        }
      }
    ),
    mktCol('bought', 'Bought', 2, 170, function (row) {
      return mktMoneyWords(row.money);
    }, { num: true }),
    mktCol('first', 'First bill', 3, 140, function (row) {
      return bkDate(row.first_bill_at);
    }),
    mktCol('sent', 'Offer sent', 4, 140, function (row) {
      return bkDate(row.sent_at);
    })
  ];
}
/** one bill behind a customer's line - its number opens the chit (every number opens what it counts) */
function mktBillRow(bill) {
  var link = '<a href="#" data-crm="minichit" data-id="' + esc(bill.chit_id) + '" data-testid="mkt-came-bill-' + esc(bill.chit_id) + '">' + esc(bill.bill_no || tx('Bill')) + '</a>';
  return crmMiniRow('bill', link + ' · ' + esc(bkDate(bill.at)) + ' · ' + esc(mktMoney(bill.value, bill.currency)));
}
/** ▸ the bills behind a customer's line */
function mktCameMini(row) {
  var bills = (row.bills || []).map(mktBillRow).join('');
  return '<div class="mc">' + crmMiniBox('mc-money', 'Bills after the offer', [bills], 'mkt-came-mini-' + row.party_id) + '</div>';
}
/** one figure above the list - a link to what it counts when there is somewhere to go */
function mktFigure(count, label, href, testId) {
  var inner = '<b>' + esc(String(count)) + '</b> <span>' + esc(label) + '</span>';
  return href ? '<a class="mkt-fig" href="' + href + '" data-testid="' + testId + '">' + inner + '</a>' : '<span class="mkt-fig" data-testid="' + testId + '">' + inner + '</span>';
}
/** the reason a result is 0, in the shop's words, with the one button that fixes it */
function mktWhyHTML(reason, days) {
  var known = MKT_EMPTY[reason.code],
    line = known ? tx(known[0]) : reason.code === 'NO_BUYERS' ? txf('Nobody has bought within {n} days yet.', { n: days }) : tx(reason.say || 'Nothing to show yet.'),
    action = known && known[1],
    href = action && (action[1] || (typeof CB_HOMES !== 'undefined' ? CB_HOMES.integrations : '/settings.html#/connectors'));
  return (
    '<div class="mkt-card" role="status" data-testid="mkt-why-' + esc(reason.code) + '"><span>' + esc(line) + '</span>' +
    (action ? ' <a class="act sm ghost" href="' + esc(href) + '" data-testid="mkt-why-go">' + esc(tx(action[0])) + '</a>' : '') +
    '</div>'
  );
}
/** the figures above the list: sent · came back · money (each a link to what it counts) and, when it is 0, the reason */
function mktTopHTML() {
  var data = CAME.data;
  if (!data || CAME.state === 'error') return '';
  var money = data.money && data.money.by_currency && data.money.by_currency.length ? '<span class="mkt-fig" data-testid="mkt-fig-money">' + esc(mktMoneyWords(data.money)) + '</span>' : '';
  var figures =
    '<div class="mkt-figs" data-testid="mkt-figs">' +
    mktFigure(data.sent_n, tx('sent an offer'), '#/sent?status=sent', 'mkt-fig-sent') +
    mktFigure(data.came_back_n, txf('came back in {n} days', { n: data.days }), '', 'mkt-fig-came') +
    money +
    '</div>';
  return figures + (data.why ? mktWhyHTML(data.why, data.days) : '');
}
/** the "inactive" segment row the win-back card is about (the Groups screen's own data) */
function mktInactiveRow() {
  return (window.GROUPS.rows || []).filter(function (row) {
    return row.key === 'inactive';
  })[0];
}
/** the win-back card: the existing "inactive" segment in the server's rule words; the button is the existing Send sheet, greyed with the server's reason */
function mktWinbackHTML() {
  var row = mktInactiveRow();
  if (!row || window.GROUPS.state !== 'ready') return '';
  var reason = crmGroupsWhyNot(row, 'send'),
    button = reason
      ? crmViewOnlyBtn('mkt-winback-send', tx('Send offer'), reason)
      : '<button data-cbsid="MKT003-B02" type="button" class="act sm" data-crm="mktwinback" data-testid="mkt-winback-send">' + esc(tx('Send offer')) + '</button>';
  return (
    '<div class="mkt-card" data-testid="mkt-winback"><span><b data-testid="mkt-winback-n">' + esc(crmPlural(row.count, 'customer', 'customers')) + '</b> ' +
    esc(tx(row.count === 1 ? 'has' : 'have') + ' ' + (row.rule || '')) + '</span> ' + button + '</div>'
  );
}
function mktTopPaint() {
  var host = document.getElementById('mkt_top');
  if (host) host.innerHTML = mktTopHTML() + mktWinbackHTML();
}
/** the whole CBList mount for Who came back: the server's customers, one GET */
function mktCameOptions() {
  return {
    key: 'mkt-came',
    t: tx,
    rows: function () {
      return (CAME.data && CAME.data.customers) || [];
    },
    id: function (row) {
      return row.party_id;
    },
    rowTid: function (row) {
      return 'mkt-came-' + row.party_id;
    },
    columns: mktCameCols,
    defaultCols: ['who', 'bought', 'first'],
    cardMax: 3,
    fill: false,
    head: function () {
      return { title: tx('Who came back') };
    },
    state: function () {
      return CAME.state === 'loading' ? 'loading' : CAME.state === 'error' ? 'error' : null;
    },
    error: function () {
      return crmErrWords(CAME.err, 'who came back');
    },
    onRetry: mktResultsLoad,
    empty: function () {
      return { title: tx('Nobody has come back yet.'), sub: tx('Buyers after an offer show here.') };
    },
    next: mktCameMini,
    remote: {
      total: function () {
        return (CAME.data && CAME.data.total) || 0;
      },
      onQuery: mktResultsLoad
    }
  };
}
/** #/results - Who came back, with the win-back card above the list */
function mktResults(frame) {
  crmBar('<strong>' + esc(crmAppName()) + '</strong>', '', true);
  var node = document.getElementById('screen');
  node.className = 'screen flush';
  node.innerHTML = '<div id="mkt_top" class="mkt-top" data-testid="mkt-top"></div><div id="mkt_came" data-testid="mkt-came"></div>';
  mktDrop(CAME);
  CAME.page = 1;
  CAME.api = CBList.mount(document.getElementById('mkt_came'), mktCameOptions());
  mktTopPaint();
  if (frame) return;
  if (!window.GROUPS.loaded) crmGroupsLoad(false).then(mktTopPaint, mktTopPaint);
  mktResultsLoad();
}

/* ═══ the clicks this module answers (cap-crm.js's one listener asks) ═════════════════════════════════════════════════ */
function crmMarketingClick(action, node) {
  if (action === 'mktpage') {
    SENT.page = Math.max(1, Number(node.getAttribute('data-v')) || 1);
    mktSentLoad();
    return true;
  }
  if (action === 'mktwinback') {
    var row = mktInactiveRow();
    if (row) crmSendOpen(row);
    return true;
  }
  return false;
}
