/* cap-crm-timeline.js — CB CRM: a party's whole history, answered 50 at a time by the server (the record's Timeline tab).
 * OWNS      the When cell (crmWhenCell, crmDocDay, crmDocWord) · the ledger entry's line (crmLedgerLine) · the failed-read state (crmTimelineFailure) · the timeline's kind filter (CRM_TAB_KINDS, crmTlWant) · the paged read (crmTlLoad) · its Filters (crmTlFilters) · the CBList mount (crmTimelineView); moved out of cap-crm-record.js (2026-11-17, size ratchet; behaviour unchanged)
 * CALLED BY crm.html (<script src>, after cap-crm-record.js) · cap-crm-record.js (crmRecordPaint → crmTimelineView; the click door → crmTlLoad)
 * FLOW      crmTimelineView(p, tok) → CBList mount → crmTlLoad(more) reads the next page (crmTimeline) → rows are drawn by crmEntryFrom / crmTlCols (cap-crm-record.js)
 * CARD      11-crm-and-marketing/crm-record
 * The server decides what a tab holds; nothing is added up here.
 */
'use strict';
/* the timeline's cells and lines (moved here with the list: the When cell, a document's day and name, the ledger line, the failed-read state) */
/** the timeline as the API sends it ({ entries: [{ kind, at, … }] }, kinds chit · message · dispute · ledger · interaction · followup · followup_done · change) → the page's entry grammar */
/** a sale to a customer is an Invoice, a supplier's is a Bill (the pack's words); a party that is both reads as a Bill */
function crmDocWord() {
  var roles = (CRMR.p && CRMR.p.roles) || [];
  return roles.indexOf('customer') >= 0 && roles.indexOf('supplier') < 0 ? 'Invoice' : 'Bill';
}
/** a document's own day (YYYY-MM-DD) as a label: Today / Yesterday by the SHOP's day (the server's shop_day), else the date */
function crmDocDay(day) {
  var shop = crmShopDay();
  return day === shop ? tx('Today') : day === crmDayPlus(shop, -1) ? tx('Yesterday') : bkDate(day);
}
/** the When cell: a document shows ITS date, with the day it was entered smaller beneath when that differs */
function crmWhenCell(e) {
  if (!e.doc_date) return esc(crmWhen(e.at));
  var entered = e.at ? crmLocalISO(new Date(e.at)) : '';
  return (
    '<span data-testid="crm-docdate-' + esc(e.id) + '">' + esc(crmDocDay(e.doc_date)) + '</span>' +
    (entered && entered !== e.doc_date ? '<br><span class="sub" data-testid="crm-entered-' + esc(e.id) + '">' + esc(tx('entered')) + ' ' + esc(crmDocDay(entered)) + '</span>' : '')
  );
}
/** the document in its own words: kind (an Invoice to a customer, a Bill from a supplier) + its print number; the date is the document's, in the When column */
function crmLedgerLine(e, kind) {
  var word = tx(e.ledger_kind === 'bill' ? crmDocWord() : 'Payment'),
    number = cbIsRawId(e.ref) || !e.ref ? '' : e.ref;
  if (kind !== 'payment') return word + (number ? ' ' + number : '');
  return word + (number ? ' · ' + number : e.amount_minor != null ? ' ' + bkMoney(e.amount_minor, e.currency) : '');
}
/** R70: a history that could not be read is NOT an empty history: the list says so (the record's other sections still show) and offers Try again */
function crmTimelineFailure(rec) {
  return {
    state: function () {
      return rec.timeline_failed ? 'error' : null;
    },
    error: function () {
      return { title: tx("Couldn't load the history."), sub: tx('The record’s other sections still show.') };
    },
    onRetry: function () {
      crmRecordOpen(CRM.route);
    }
  };
}

/* ═══ THE TIMELINE — the whole history, answered 50 at a time by the server (never read all at once) ════════════════════
   A CBList mount like every list: the kind filter and the search sit in the unit's own Filters and search box (the head stays three rows);
   the page asks the server again when either changes (crmWatch), and asks for the next 50 when the rows are scrolled to the end. */
/** which entry kinds each tab of the timeline shows */
var CRM_TAB_KINDS = {
  messages: ['message', 'message_internal'],
  bills: ['bill', 'payment', 'chit', 'dispute'],
  notes: ['call', 'visit', 'whatsapp', 'note'],
  mail: ['mail'],
  followups: ['followup']
};
function crmTlWant(T, e) {
  if (T.kind && T.kind !== 'all' && (CRM_TAB_KINDS[T.kind] || []).indexOf(e.kind) < 0) return false;
  return (
    !T.q ||
    String(e.line || '')
      .toLowerCase()
      .indexOf(String(T.q).toLowerCase()) >= 0
  );
}
async function crmTlLoad(more) {
  var T = CRMR.tl;
  if (!T || (more && (T.busy || !T.next))) return;
  var g = ++T.gen;
  T.busy = !!more;
  if (!more) {
    T.state = 'loading';
    T.entries = [];
    if (CRMR.tlApi) CRMR.tlApi.refresh();
  }
  try {
    /* the API pages by time only (?before=<iso>&limit=<n>): it has no kind or text filter and sends no per-kind counts. The page keeps the entries that fit
       the tab and the search, and asks for the next page until it has a screenful or the history ends. */
    var list = [],
      next = more ? T.next : '',
      pages = 0,
      r;
    do {
      r = await api('crmTimeline', { params: { id: T.p.party_id }, query: { before: next || '', limit: 50 } });
      if (g !== T.gen) return;
      list = list.concat(
        crmEntriesFrom(r).filter(function (e) {
          return crmTlWant(T, e);
        })
      );
      next = (r && r.next_before) || null;
      pages++;
    } while (next && list.length < 30 && pages < 8);
    T.entries = (more ? T.entries : []).concat(list);
    T.next = next;
    T.counts = (r && r.counts) || T.counts || {};
    T.state = 'ready';
  } catch (e) {
    if (g !== T.gen) return;
    T.state = 'error';
    T.err = e;
  }
  T.busy = false;
  if (CRMR.tlApi) CRMR.tlApi.refresh({ filters: crmTlFilters(T) });
}
function crmTlFilters(T) {
  return [
    {
      key: 'kind',
      label: tx('Show'),
      all: tx('All') + (T.counts.all != null ? ' (' + T.counts.all + ')' : ''),
      match: function () {
        return true;
      },
      options: CRM_TABS.filter(function (item) {
        return item[0] !== 'all' && (T.counts[item[0]] == null || T.counts[item[0]] > 0);
      }).map(function (item) {
        return { v: item[0], label: tx(item[1]) + (T.counts[item[0]] != null ? ' (' + T.counts[item[0]] + ')' : '') };
      })
    }
  ];
}
function crmTimelineView(p, tok) {
  var node = document.getElementById('screen'),
    f = (CRM.route.params || {}).f;
  var T = (CRMR.tl = { p: p, kind: 'all', q: '', entries: [], next: null, counts: {}, state: 'loading', gen: 0, err: null, busy: false });
  crmBar(
    '<a href="#/party/' + esc(crmKey(p)) + '" data-testid="crm-back">‹ ' + esc(p.display_name) + '</a>',
    crmEdit()
      ? '<button data-cbsid="CRM006-B19" type="button" class="act sm" data-crm="rlog" data-testid="crm-act-log">+ ' + esc(tx('Log a call or note')) + '</button>'
      : crmViewOnlyBtn('crm-act-log', '+ ' + tx('Log a call or note'), crmViewWhy()),
    true
  );
  node.className = 'screen flush';
  node.innerHTML = '<div id="crm_tl" data-testid="crm-timeline"></div>';
  if (CRMR.tlApi) {
    try {
      CRMR.tlApi.destroy();
    } catch (_) { /* best effort: failing here changes nothing the user sees */ }
  }
  var el = document.getElementById('crm_tl');
  CRMR.tlApi = CBList.mount(el, {
    key: 'crm-timeline',
    t: tx,
    rows: function () {
      return T.state === 'ready' ? T.entries : [];
    },
    id: function (e) {
      return e.id;
    },
    rowTid: function (e) {
      return 'crm-tl-' + e.id;
    },
    columns: crmTlCols,
    defaultCols: ['what', 'when', 'state', 'amount'],
    view: 'grid',
    head: function () {
      return {
        title: tx('Timeline') + ' · ' + p.display_name,
        chips: T.state === 'ready' && T.counts[T.kind] != null ? [{ text: T.entries.length + ' ' + tx('of') + ' ' + T.counts[T.kind], tid: 'crm-tl-of' }] : []
      };
    },
    state: function () {
      return T.state === 'loading' ? 'loading' : T.state === 'error' ? 'error' : null;
    },
    error: function () {
      return { title: tx("Couldn't load the history."), sub: tx('The record’s other sections still show.') };
    },
    onRetry: function () {
      crmTlLoad(false);
    },
    empty: { title: tx('Nothing yet with this party.'), sub: tx('Use Log a call or note.') },
    filters: crmTlFilters(T),
    search: function () {
      var element = el.querySelector('[data-cbl-q]');
      return element ? element.value : '';
    },
    searchHint: tx('Search this history'),
    group: { default: 'on', tid: 'crm-tl', by: crmDayGroup },
    onScroll: function (box) {
      if (T.next && box.scrollTop + box.clientHeight >= box.scrollHeight - 160) crmTlLoad(true);
    },
    onOpen: crmEntryOpen,
    next: crmEntryNext
  });
  crmWatch(el, function (c) {
    T.kind = c.filt.kind || 'all';
    T.q = c.q;
    crmTlLoad(false);
  });
  crmTlLoad(false);
}
