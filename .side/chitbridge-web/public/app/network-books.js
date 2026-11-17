/**
 * network-books.js — My network: Open books on a store that holds a live grant, the seat choice, and the client's address in history.
 *
 * OWNS      the Open books cell and click (booksCell, openBooksClick) · which seat a firm opens a client as, remembered per client (openSeat, keepSeat) · the client and screen in the address, one history entry each (record, onPop) · the opened client's books view (paintOpened); moved out of network-app.js (2026-11-17, size ratchet; behaviour unchanged)
 * CALLED BY public/network.html (<script src>, before network-app.js) · app/network-app.js (CBNetworkBooks.create(ctx) once; ctx = N, T, $, call, sheet, closeSheet, mountList, paint)
 * FLOW      a store row → booksCell → openBooksClick → openSeat (asks only when the firm holds both an auditor and an adviser grant) → sitAs → record + paint → paintOpened mounts CBBooksGrantView; Back/Forward → onPop
 * CARD      04-network/network-app-member-view
 *
 * Decides nothing: the grants, seats and posting rights are the server's (CBBooksGrantApi.doorsFor); this file only chooses which door the person pressed.
 */
(function (root) {
  'use strict';
  /* the network page's shared state and helpers, handed over once by create() */
  var page, words, byId, call, sheet, closeSheet, mountList, paintPage;
  function paint() {
    paintPage();
  }
  /* ── ACC-176: a store that holds a live grant for this business gets "Open books"; a store without one shows nothing extra ── */
  function booksCell(s) {
    var id = esc(s.entity_id);
    return page.held[String(s.entity_id)]
      ? '<button data-cbsid="NET001-B04" type="button" class="act quiet" id="nw_books_' + id + '" data-open-books="' + id + '" data-testid="nw-books-' + id + '">' + esc(words('Open books')) + '</button>'
      : '<span class="sub" data-testid="nw-ended-' + id + '">' + esc(root.CBBooksGrantApi.endedWords(page.ended[String(s.entity_id)])) + '</span>';
  }
  function openBooksClick(ev) {
    var button = ev.target.closest && ev.target.closest('[data-open-books]');
    if (!button) return;
    var id = button.getAttribute('data-open-books');
    var store = page.stores.filter(function (s) { return String(s.entity_id) === id; })[0];
    openSeat(id, (page.held[id] && page.held[id].grantor_name) || (store && store.name) || words('this store'));
  }
  /** a firm that holds BOTH an auditor and an adviser grant on one client never gets one picked silently: it chooses the seat once, and the choice is remembered per client */
  var SEAT_KEY = 'cb_seat:';
  function quietSeat(failure) {
    if (root.cbQuiet) root.cbQuiet('network:seat', failure); /* storage blocked: the person is asked again next time */
  }
  function rememberedSeat(id) {
    try { return root.localStorage.getItem(SEAT_KEY + id); } catch (failure) { quietSeat(failure); return null; } /* no storage: ask each time */
  }
  function forgetSeat(id) {
    try { root.localStorage.removeItem(SEAT_KEY + id); } catch (failure) { quietSeat(failure); }
  }
  /** the seat is remembered only after the first books read of the client answered 200 (books-grant-view calls onRead): a refused choice is never stored. `at` = the screen and period the address named (a deep link, Back): kept, never cleared by the seat choice */
  function sitAs(id, name, preset, at) {
    page.held[id] = page.seats[id][preset];
    page.seatToKeep = { id: id, preset: preset };
    page.opened = { id: id, name: name, role: root.CBBooksActing.roleOf(page.held, id), posting: page.held[id].posting };
    if (at) { page.view = at.view || ''; page.period = at.period || null; } else { page.view = ''; page.period = null; }
    record(!!at);
    paint();
  }
  function keepSeat() {
    var keep = page.seatToKeep;
    if (!keep) return;
    page.seatToKeep = null;
    try { root.localStorage.setItem(SEAT_KEY + keep.id, keep.preset); } catch (failure) { quietSeat(failure); } /* a seat not remembered is asked again */
  }
  function openSeat(id, name, at) {
    var door = root.CBBooksGrantApi.doorsFor({ seats: page.seats, mine: page.mine }, id, rememberedSeat(id));
    if (door.stale) forgetSeat(id); /* a stored seat the server no longer lets this login use is dropped */
    if (door.refused) {
      page.opened = null;
      page.el.innerHTML = '<div data-testid="nw-refused"></div>';
      root.CBShell.readFailed(page.el.firstChild, { what: name, status: 403, back: { href: '/network.html', label: words('Back to My network') } });
      return;
    }
    if (door.open) return sitAs(id, name, door.open, at);
    sheet('<h2 data-testid="nw-seat-title">' + esc(words('How do you want to open')) + ' ' + esc(name) + '?</h2>' +
      '<p class="sub">' + esc(words('Your firm holds two kinds of access. Pick the one you are acting as now; it is remembered for this client.')) + '</p>' +
      '<div class="nw-acts"><button data-cbsid="NET001-B07" type="button" class="act" data-seat="auditor" data-testid="nw-seat-auditor">' + esc(words('Open as auditor')) + '</button>' +
      '<button data-cbsid="NET001-B08" type="button" class="act quiet" data-seat="adviser" data-testid="nw-seat-adviser">' + esc(words('Open as accountant')) + '</button></div>');
    Array.prototype.forEach.call(byId('nw_sheet').querySelectorAll('[data-seat]'), function (b) {
      b.onclick = function () { closeSheet(); sitAs(id, name, b.getAttribute('data-seat'), at); };
    });
  }
  /* ── l16 R4-2b: the client is in the address (?open=<client>&view=<screen>): every open client and every screen of its books is a history entry (pushState), Back and Forward restore it, and the page never falls back to the network list ── */
  function addressOfClient(id, view, period) {
    return '/network.html?open=' + encodeURIComponent(id) + (view ? '&view=' + encodeURIComponent(view) : '') + (view && period ? root.CBPeriodPick.toAddress(period) : '') + (view === 'daybook' && root.CBBooksGrantFilters ? root.CBBooksGrantFilters.carry(root.location.search, id) : '') + (view === 'daybook' && new root.URLSearchParams(root.location.search).get('open') === id && new root.URLSearchParams(root.location.search).get('since') === 'mine' ? '&since=mine' : ''); /* the period rides the address (&fy= or &from=&to=): Back and a shared link keep it; so do the Day book's filters (A3C, &dbf_*) */
  }
  /** record the client now open (or the list, id null) in history: push a new entry (replace: the one the address already names, on a deep link or a restore) */
  function record(replace, view, period) {
    if (!root.history || !root.history.pushState) return;
    var url = historyUrl(view, period);
    if (root.location.pathname + root.location.search === url) return;
    try {
      root.history[replace ? 'replaceState' : 'pushState']({ cbClient: page.opened ? page.opened.id : null }, '', url);
      if (!replace) page.pushed = (page.pushed || 0) + 1;
    } catch (failure) { if (root.cbQuiet) root.cbQuiet('network:history', failure); }
  }
  /** the address of the client now open on the screen asked (the page's own when none is named), or the list's */
  function historyUrl(view, period) {
    if (!page.opened) return '/network.html';
    return addressOfClient(page.opened.id, view != null ? view : page.view, period !== undefined ? period : page.period);
  }
  /** the list again (Back past the first client): the open client is dropped */
  function closeOpened() {
    if (!page.opened) return;
    page.opened = null;
    page.view = '';
    page.period = null;
    paint();
  }
  /** the client asked for is the one already open on screen: only its screen changes */
  function isOpenClient(id) {
    return !!(page.opened && page.opened.id === id && page.handle);
  }
  /** Back or Forward: the address names the client and the screen; restore them (the seat chosen for that client is remembered), re-reading nothing the page already holds */
  function onPop() {
    var query = new root.URLSearchParams(root.location.search),
      id = query.get('open'),
      view = query.get('view') || '';
    page.period = root.CBPeriodPick.fromAddress(root.location.search);
    if (!page.el || !page.held) return;
    if (!id || !page.held[id]) return closeOpened();
    page.view = view;
    if (isOpenClient(id)) return page.handle.setView(view || page.homeView || '', page.period);
    openSeat(id, page.held[id].grantor_name || words('this store'), { view: view, period: page.period });
  }
  function paintOpened(host) {
    page.handle = root.CBBooksGrantView.mount(host, {
      view: page.view || undefined,
      period: page.period || null,
      onRead: keepSeat,
      onView: function (report, period) { page.view = report; page.period = period || null; record(false, report, page.period); },
      call: call,
      raw: function (path, headers) { return root.fetch((page.o.base || '') + path, { cache: 'no-store', headers: Object.assign({ Authorization: 'Bearer ' + page.o.token }, headers || {}) }); } /* a file: the same token and base as call, the answer left as bytes (cap-evidence.js) */,
      member: page.opened,
      stores: root.CBBooksActing.clientStores(page.stores, page.held),
      mountList: mountList, sheet: sheet, closeSheet: closeSheet,
      onEnded: page.o.onEnded,
      onSwitch: function (id, name) { openSeat(id, (page.held[id] && page.held[id].grantor_name) || name); },
      onBack: function () {
        /* E2 (Fable walk 17 Nov): "← Clients" goes to the practice list BY ADDRESS. history.back() stepped one TAB back (every screen of the books is a history entry), so the address and the screen disagreed and the list was never reached. The list is a new entry; Back from it returns to the client. */
        if (page.cameFromHome) { root.location.assign('/'); return; } /* fix1117 F1 (walk 17 Nov): a client opened from the practice Home goes back to that Home (the practice list), never to the network page's old client list (acc17 E2 sent it there) */
        var was = page.opened && page.opened.id;
        page.opened = null; page.view = ''; page.period = null;
        record(false);
        paint();
        var door = was && page.el && page.el.querySelector('[data-open-books="' + was + '"]'); /* focus lands on the "Open books" that opened it */
        if (door) door.focus();
      }
    });
  }
  /** the one entry: the network page hands over its shared state and helpers and gets back the handlers it wires */
  function create(ctx) {
    page = ctx.N;
    words = ctx.T;
    byId = ctx.$;
    call = ctx.call;
    sheet = ctx.sheet;
    closeSheet = ctx.closeSheet;
    mountList = ctx.mountList;
    paintPage = ctx.paint;
    return { booksCell: booksCell, openBooksClick: openBooksClick, openSeat: openSeat, onPop: onPop, paintOpened: paintOpened };
  }
  root.CBNetworkBooks = { create: create };
})(typeof window !== 'undefined' ? window : this);
