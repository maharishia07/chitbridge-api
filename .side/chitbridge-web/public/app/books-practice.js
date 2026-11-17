/**
 * books-practice.js — THE FIRM'S FIRST SCREEN (l16/firm-dash): a Practice band of counts across ALL clients and the client list under it, on Home.
 *
 * OWNS      one section on Home for a login that holds live received books grants: the band (each count a filter), the rule in words, the client list (CBList), the "Open books" per row; and the flag that hides the shop cards on a firm Home.
 * CALLED BY public/app.html (script tag, after books-grant-api.js and list-ctl.js) · public/app/shell.js (CBPractice.hidesShopCards)
 * FLOW      every second: a token not yet read → GET /api/books-grants/practice (one read for every client) → answer → draw the section before the areas; a login that may not read it (403) or holds no client draws nothing.
 * CARD      04-network/ACC-176-AUDITOR-GRANT
 *
 * Decides nothing and computes nothing: every count, status, reason and date is the server's (lib/books-practice.js); the band's counts equal the filters under them because the server counts them from the same rows.
 */
(function (root) {
  'use strict';
  var practiceKit = (root.CBPracticeKit = root.CBPracticeKit || {});
  practiceKit.translate = translate;
  var escapeHtml = (practiceKit.escapeHtml = function (s) { return esc(s); }); /* the one esc (helpers.js) */
  practiceKit.money = minorText;
  practiceKit.dayWords = dayWords;
  practiceKit.practiceState = { token: null, data: null, drawn: false, filter: null, list: null, band: null, fl: null, flOff: false, flReady: false, flTotal: 0 };
  /* l16 n12: what a firm with no trade of its own KEEPS of the shop's Home, by id: its own Setup (the business, account, plan, policy, privacy, standards, connectors). Everything else is shop: every other card, so
     every area that would hold only those cards (the left rail), and the two shop panels named by id here: 'sides' (We lean on / Leans on us) and 'rail' (Your work). ONE list, ONE test (hidesShopCards). */
  var FIRM_KEEPS = { shop: 1, account: 1, plan: 1, governance: 1, privacy: 1, standards: 1, connectors: 1 };
  var PRACTICE_ENDPOINT = { practice: { m: 'GET', p: '/api/books-grants/practice' } };
  function translate(s) {
    return typeof root.tx === 'function' ? root.tx(s) : s;
  }
  function base() {
    try {
      var f = root.localStorage.getItem('cb_api_base');
      if (f) return f === 'stage' ? root.CB_API || '' : f;
    } catch (failure) {
      if (root.cbQuiet) root.cbQuiet('practice:base', failure);
    }
    return /^(localhost|127\.0\.0\.1)$/.test(root.location.hostname) ? 'http://localhost:3000' : root.CB_API || '';
  }
  function token() {
    try {
      return (JSON.parse(root.localStorage.getItem('cb_sess') || 'null') || {}).token || null;
    } catch (failure) {
      if (root.cbQuiet) root.cbQuiet('practice:token', failure);
      return null;
    }
  }
  function read(left) {
    left = left === undefined ? 3 : left;
    return root.fetch(base() + PRACTICE_ENDPOINT.practice.p, { method: PRACTICE_ENDPOINT.practice.m, headers: { Authorization: 'Bearer ' + token() } }).then(function (r) {
      if (r.status === 503 && left > 0) {
        return new Promise(function (go) { root.setTimeout(go, Math.min(10, Number(r.headers.get('Retry-After')) || 2) * 1000); }).then(function () { return read(left - 1); });
      }
      if (r.status === 429 || r.status >= 500) return { failed: true, status: r.status }; /* l16 W5: rate-limited or failing is NOT "no practice": the caller must not decide "a shop" from it */
      if (!r.ok) return null; /* a login that may not read the practice (403) or a server without it: nothing is drawn */
      return r.json();
    });
  }
  /* W2/W3 (private bookmarks, cap-flag.js): the firm's OWN bookmarks and notes. The call carries the token and NOTHING else: never X-Books-For, so a flag is kept in the firm's organisation, never a client's. */
  function flagCall(method, path, body) {
    return root.fetch(base() + path, { method: method, cache: 'no-store', headers: { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(function (r) {
      return r.json().catch(function (failure) { if (root.cbQuiet) root.cbQuiet('practice:flag-json', failure); return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.detail || j.message || j.error || 'API ' + r.status); e.status = r.status; e.code = j.code; throw e; }
        return j;
      });
    });
  }
  function withFlag(then) {
    if (root.CBFlag) return then();
    var tag = root.document.createElement('script');
    tag.src = '/app/cap-flag.js';
    tag.onload = then;
    root.document.head.appendChild(tag);
  }
  function flagsOn() {
    return !!practiceKit.practiceState.fl && practiceKit.practiceState.flReady && !practiceKit.practiceState.flOff;
  }
  /** the Home count: every open bookmark and note of this firm that this person may read; a press opens the work list */
  function flagButton() {
    return flagsOn() && practiceKit.practiceState.flTotal > 0 ? '<button type="button" class="bp-bandtab" data-cbsid="CMP067-B08" data-bp-flags="1" data-testid="practice-flags">' + escapeHtml(translate('Bookmarks and notes')) + ' · ' + escapeHtml(practiceKit.practiceState.flTotal) + '</button>' : '';
  }
  function clientName(id) {
    var row = ((practiceKit.practiceState.data && practiceKit.practiceState.data.clients) || []).filter(function (r) { return String(r.entity_id) === String(id); })[0];
    return row ? row.name : '';
  }
  function openFlagList(opener) {
    root.CBFlag.workList({ call: flagCall, nameOf: clientName, opener: opener, onOpen: function (f) {
      var A = root.CBBooksActing, to = A && A.clientAddress ? A.clientAddress({ id: f.subject_entity }, f.subject_kind === 'posting' ? '&view=daybook' : '') : '';
      root.location.href = to || '/network.html?open=' + encodeURIComponent(f.subject_entity);
    } });
  }
  function wireFlagButton(scope) {
    var b = scope.querySelector('[data-bp-flags]');
    if (b) b.onclick = function () { openFlagList(b); };
  }
  /** the flags answered (or the server does not offer them): the count and the Saved column and filter appear; the list is given its new columns, never rebuilt */
  function flagsPaint() {
    var slot = root.document.querySelector('[data-bp-flagslot]');
    if (slot) { slot.innerHTML = flagButton(); wireFlagButton(slot); }
    if (practiceKit.practiceState.list && practiceKit.practiceState.list.refresh) practiceKit.practiceState.list.refresh({ columns: columns(), filters: filters(), defaultCols: colsOf((practiceKit.bandShown(practiceKit.practiceState.data) || {}).key || 'pipeline') });
  }
  function flagsStart() {
    if (practiceKit.practiceState.flStarted === practiceKit.practiceState.token) return;
    practiceKit.practiceState.flStarted = practiceKit.practiceState.token;
    withFlag(function () {
      practiceKit.practiceState.fl = root.CBFlag.use({ call: flagCall, kind: 'client' });
      practiceKit.practiceState.fl.onChange(function () {
        root.CBFlag.counts(flagCall).then(function (a) { practiceKit.practiceState.flTotal = (a && a.open) || 0; flagsPaint(); }, function (failure) { if (root.cbQuiet) root.cbQuiet('practice:flag-counts', failure); });
      });
      root.CBFlag.listAll(flagCall).then(function (a) { practiceKit.practiceState.fl.ingest(a.flags); practiceKit.practiceState.flTotal = a.total; practiceKit.practiceState.flReady = true; flagsPaint(); }, function (failure) {
        practiceKit.practiceState.flOff = root.CBFlag.gone(failure); /* not switched on, or not for this person: no chip, no count; any other failure says nothing rather than "none" */
        practiceKit.practiceState.flReady = true;
        flagsPaint();
      });
    });
  }
  /** a firm: it holds clients by live grants and has no trade of its own: the DATA says so (the server's own_trade), never a trade switch */
  function isFirm() {
    return !!(practiceKit.practiceState.data && practiceKit.practiceState.data.clients && practiceKit.practiceState.data.clients.length && practiceKit.practiceState.data.own_trade === false);
  }
  function hidesShopCards(id) {
    return isFirm() && !FIRM_KEEPS[id];
  }
  /* minor units in, the one formatter (helpers.js fmtMoney) out; a missing figure is a dash */
  function minorText(minor, currency) {
    return minor == null ? '—' : fmtMoney({ amount_minor: minor, currency: currency }, currency);
  }
  function dayWords(value) {
    return value ? (typeof root.shopDay === 'function' ? root.shopDay(value) : String(value).slice(0, 10)) : '—';
  }
  var ROLE = { adviser: 'Accountant', auditor: 'Auditor' };
  /** l16 R4-2b: the client this person worked on last (set when a client's books are entered, books-acting.js): its row is marked, in view and focused when the list comes back */
  function lastClient() {
    try { return root.sessionStorage.getItem('cb_last_client') || ''; } catch (failure) { if (root.cbQuiet) root.cbQuiet('practice:last', failure); return ''; }
  }
  function isLast(r) {
    var last = lastClient();
    return !!last && String(r.entity_id) === last;
  }
  /* REP-73 B2: the columns follow the open band, so a tile counts something its rows show: Year end shows the stage and the year's figures; On us today shows the bank, the queries, the entries to check and the months to lock
     (the four tiles); Advice shows the figures its rules read. The page knows which columns a band opens with; the server decides which band exists and what each tile counts. */
  var BAND_COLS = {
    pipeline: ['name', 'status', 'yend', 'checked', 'queries', 'bas'],
    on_us: ['name', 'status', 'bank', 'queries', 'changed', 'tocheck', 'unlocked'],
    advisory: ['name', 'status', 'sales', 'margin', 'cash', 'profit']
  };
  function columns() {
    var num = function (key, label, w, cell, value, extra) {
      return Object.assign({ key: key, label: translate(label), prio: 2, w: w, sort: key, html: true, cell: cell, value: value }, extra || {});
    };
    return [
      { key: 'name', label: translate('Client'), prio: 1, w: 150, minw: 110, keep: true, stretch: true, sort: 'name', html: true, cell: function (r) { return '<a class="bp-link" href="/network.html?open=' + escapeHtml(encodeURIComponent(r.entity_id)) + '" data-cbsid="NET001-B04" data-bp-open="' + escapeHtml(r.entity_id) + '" data-testid="practice-open-' + escapeHtml(r.entity_id) + '">' + escapeHtml(r.name || r.entity_id.slice(0, 8)) + '</a>' + (isLast(r) ? ' <span class="bp-chip" data-cbsid="CMP033-B01" data-testid="practice-last-chip">' + escapeHtml(translate('Last opened')) + '</span>' : ''); }, value: function (r) { return r.name || ''; } },
      num('status', 'Status', practiceKit.bandNow() === 'pipeline' ? 150 : 260, practiceKit.statusCell, function (r) { return r.health.words; }, { prio: 1, keep: true, minw: 130, hfilter: 'status', sort: 'urgency' }),
      num('role', 'Role', 90, function (r) { return escapeHtml(translate(ROLE[r.role] || r.role)); }, function (r) { return r.role; }, {}),
      num('bank', 'Bank', 150, practiceKit.bankCell, function (r) { return r.bank.state; }, { hfilter: 'bank' }),
      num('queries', 'Queries', 120, practiceKit.queriesCell, function (r) { return r.queries.open; }),
      num('changed', 'Changed', 130, practiceKit.changedCell, function (r) { return r.changed ? r.changed.n : 0; }, { hfilter: 'changed', cardAct: true /* on a phone card the link is the action line under the fields (the auditor's next step), not one of the capped fields */ }),
      num('bas', 'Due', 120, practiceKit.basCell, function (r) { return r.bas.due_date || ''; }, { hfilter: 'bas' }),
      num('yend', 'Year end', 230, practiceKit.yendCell, function (r) { return r.year_end ? r.year_end.locked : -1; }, { prio: 1 }),
      num('checked', 'Checked ' + practiceKit.yearLabel(), 110, practiceKit.checkedCell, practiceKit.checkedLeft, { prio: 1, dir0: -1 }),
      num('tocheck', 'To check (qtr)', 100, function (r) { return escapeHtml(r.to_check == null ? r.checked.of - r.checked.n : r.to_check); }, function (r) { return r.to_check == null ? r.checked.of - r.checked.n : r.to_check; }, { hfilter: 'checked', prio: 2 }),
      num('unlocked', 'Months not locked', 90, function (r) { return escapeHtml(r.months_unlocked); }, function (r) { return r.months_unlocked; }, { hfilter: 'unlocked', prio: 3 }),
      num('sales', 'Sales trend', 90, function (r) { return escapeHtml(practiceKit.trend(r)); }, function (r) { return practiceKit.trend(r); }),
      num('margin', 'Margin', 80, function (r) { return practiceKit.figureOrWhy(r, r.health.gross_margin_pct, escapeHtml(r.health.gross_margin_pct) + '%'); }, function (r) { return r.health.gross_margin_pct == null ? '' : r.health.gross_margin_pct; }, { prio: 3 }),
      num('cash', 'Cash', 110, function (r) { return practiceKit.figureOrWhy(r, r.health.cash_minor, escapeHtml(minorText(r.health.cash_minor, r.currency)), true); }, function (r) { return r.health.cash_minor == null ? '' : r.health.cash_minor; }, { prio: 3 }),
      num('profit', 'Profit (qtr)', 110, function (r) { return practiceKit.figureOrWhy(r, r.health.profit_quarter_minor, escapeHtml(minorText(r.health.profit_quarter_minor, r.currency))); }, function (r) { return r.health.profit_quarter_minor == null ? '' : r.health.profit_quarter_minor; }, { prio: 3 }),
      num('ending', 'Ends', 100, function (r) { return escapeHtml(dayWords(r.grant.expires_at)); }, function (r) { return r.grant.expires_at || ''; }, { hfilter: 'ending', prio: 3 }),
      num('look', 'My last look', 100, function (r) { return escapeHtml(dayWords(r.last_look)); }, function (r) { return r.last_look || ''; }),
      num('saved', 'Saved', 80, function (r) { return flagsOn() ? practiceKit.practiceState.fl.chip(r.entity_id, r.name) : ''; }, function (r) { return flagsOn() && practiceKit.practiceState.fl.any(r.entity_id) ? 1 : 0; }, { prio: 1, keep: true }) /* CMP066: my own bookmark of this client */
    ];
  }
  /** A3P rank 1: the Year end band's work order: stage in the server's pipeline order (Books in first, Lodged last; a stage the list does not know, last), then the blocker, then the return due date, then the server's own order. */
  var BLOCKERS = ['months', 'bank', 'checked', 'queries'];
  function workOrder(a, b) {
    var stages = (((practiceKit.practiceState.data && practiceKit.practiceState.data.band) || {}).pipeline || []).map(function (x) { return x.key; });
    var at = function (list, key) { var i = list.indexOf(key); return i < 0 ? list.length : i; };
    var due = function (r) { return (r.bas && r.bas.due_date) || '9999'; };
    return at(stages, a.stage) - at(stages, b.stage) || at(BLOCKERS, a.stage_blocker) - at(BLOCKERS, b.stage_blocker) || (due(a) < due(b) ? -1 : due(a) > due(b) ? 1 : 0) || a._n - b._n;
  }
  function sorts(band) {
    var by = function (k, get, text) { return { key: k, label: translate(text), cmp: function (a, b) { var x = get(a), y = get(b); return typeof x === 'string' || typeof y === 'string' ? String(x).localeCompare(String(y)) : (x == null ? -1e18 : x) - (y == null ? -1e18 : y); } }; };
    return (band === 'pipeline' ? [{ key: 'pipeline', label: translate('Work order'), cmp: workOrder }] : []).concat([
      by('urgency', function (r) { return r._n; }, 'Most urgent first'),
      by('name', function (r) { return r.name || ''; }, 'Client'),
      by('bank', function (r) { return r.bank.unexplained_minor || 0; }, 'Bank unexplained'),
      by('queries', function (r) { return r.queries.open; }, 'Queries open'),
      by('bas', function (r) { return r.bas.due_date || '9999'; }, 'Return due'),
      by('checked', practiceKit.checkedLeft, 'Entries left to check (year end)'),
      by('yend', function (r) { return r.year_end ? r.year_end.locked : -1; }, 'Months locked (year end)'),
      by('unlocked', function (r) { return r.months_unlocked; }, 'Months not locked'),
      by('sales', function (r) { return r.health.sales_trend_pct; }, 'Sales vs 3-month average'),
      by('margin', function (r) { return r.health.gross_margin_pct; }, 'Gross margin'),
      by('cash', function (r) { return r.health.cash_minor; }, 'Cash and bank'),
      by('profit', function (r) { return r.health.profit_quarter_minor; }, 'Profit this quarter'),
      by('ending', function (r) { return r.grant.expires_at || ''; }, 'Access ends'),
      by('changed', function (r) { return r.changed ? r.changed.n : 0; }, 'Changes since I checked'),
      by('look', function (r) { return r.last_look || ''; }, 'My last look')
    ]);
  }
  function filters() {
    var filterOf = function (key, label, options, match) { return { key: key, label: translate(label), all: translate('All'), options: options.map(function (o) { return { v: o[0], label: translate(o[1]) }; }), match: match }; };
    return [
      filterOf('status', 'Status', [['good', 'Doing well'], ['watch', 'Watch'], ['help', 'Needs help'], ['none', 'Not enough books yet']], function (r, v) { return r.health.status === v; }),
      filterOf('stage', 'Year end', ['books_in', 'complete', 'checked', 'ready', 'lodged'].map(function (k) { return [k, practiceKit.stageWord(k)]; }), function (r, v) { return r.stage === v; }),
      filterOf('advice', 'Advice', [['cash_low', 'Cash running low'], ['sales_down', 'Sales down'], ['loss', 'Making a loss'], ['late_debtors', 'Late debtors']], function (r, v) { return !!(r.grant && r.grant.can_see_costs) && ((r.health && r.health.codes) || []).indexOf(v) >= 0; }),
      filterOf('role', 'Role', [['adviser', 'Accountant'], ['auditor', 'Auditor']], function (r, v) { return r.role === v; }),
      filterOf('bank', 'Bank', [['unexplained', 'Not reconciled'], ['reconciled', 'Reconciled'], ['none', 'No statement']], function (r, v) { return r.bank.state === v; }),
      filterOf('queries', 'Queries', [['open', 'Open'], ['us', 'Waiting on us'], ['over14', 'Waiting over 14 days'], ['client', 'Waiting on the client'], ['none', 'None']], function (r, v) { return v === 'open' ? r.queries.open > 0 : v === 'us' ? r.queries.on_us > 0 : v === 'over14' ? r.queries.waiting_over_14 === true : v === 'client' ? r.queries.on_client > 0 : r.queries.open === 0; }),
      filterOf('bas', 'Return due', [['soon', 'Within 30 days'], ['later', 'Later'], ['none', 'No date']], function (r, v) { return v === 'soon' ? r.bas.due_in_days != null && r.bas.due_in_days <= 30 : v === 'later' ? r.bas.due_in_days != null && r.bas.due_in_days > 30 : r.bas.due_in_days == null; }),
      filterOf('checked', 'Checked', [['behind', 'Some not checked'], ['done', 'All checked']], function (r, v) { return v === 'behind' ? r.checked.of > r.checked.n : r.checked.of <= r.checked.n; }),
      filterOf('changed', 'Changes', [['yes', 'Changed since I checked']], function (r) { return !!r.changed && r.changed.n > 0; }),
      filterOf('unlocked', 'Months not locked', [['yes', 'Some'], ['no', 'None']], function (r, v) { return v === 'yes' ? r.months_unlocked > 0 : r.months_unlocked === 0; }),
      filterOf('ending', 'Access ends', [['soon', 'Within 30 days'], ['later', 'Later']], function (r, v) { return v === 'soon' ? r.grant.ends_in_days <= 30 : r.grant.ends_in_days > 30; })
    ].concat(flagsOn() ? [filterOf('saved', 'Saved', [['bookmarked', 'Bookmarked'], ['noted', 'With a note']], function (r, v) { return v === 'noted' ? practiceKit.practiceState.fl.noted(r.entity_id) > 0 : practiceKit.practiceState.fl.bookmarked(r.entity_id); })] : []);
  }
  /* A3P rank 5: on Year end a client opens where its blocker is (the server's stage_blocker): months → Months · bank → Bank · not checked or a query → Day book, the year picked; no blocker or no year → the client as before */
  var BLOCKER_VIEW = { months: 'periods', bank: 'bank', checked: 'daybook', queries: 'daybook' };
  /* F3: a client whose blocker is entries opens the Day book already narrowed to them (the Day book's own Mark filter words, read from the address by books-grant-filters.js): not checked · queried */
  var BLOCKER_MARK = { checked: 'notchecked', queries: 'query' };
  function openBooks(id, band) {
    var r = band === 'pipeline' ? (practiceKit.practiceState.data.clients || []).filter(function (x) { return String(x.entity_id) === String(id); })[0] : null;
    var to = r && r.stage_blocker && BLOCKER_VIEW[r.stage_blocker] ? practiceKit.sheetAddress(r, BLOCKER_VIEW[r.stage_blocker]) + (BLOCKER_MARK[r.stage_blocker] ? '&dbf_mark=' + BLOCKER_MARK[r.stage_blocker] : '') : '';
    root.location.href = to || '/network.html?open=' + encodeURIComponent(id);
  }
  /** the list unit is loaded when the practice has answered (Home carries no list otherwise) */
  function withList(then) {
    if (root.CBList) return then();
    var queue = ['list-ctl-css', 'list-ctl-click', 'list-ctl-wire', 'list-ctl'];
    (function next() {
      if (!queue.length) return then();
      var tag = root.document.createElement('script');
      tag.src = '/app/' + queue.shift() + '.js';
      tag.async = false;
      tag.onload = next;
      root.document.head.appendChild(tag);
    })();
  }
  /** the columns a band opens with, and the Saved column once the firm's flags have answered and are on */
  function colsOf(bandKey) {
    return (BAND_COLS[bandKey] || BAND_COLS.pipeline).concat(flagsOn() ? ['saved'] : []);
  }
  function mountList() {
    var host = root.document.getElementById('bp_list');
    if (!host) return;
    if (!root.CBList) return withList(mountList);
    dropOldList();
    var bandKey = (practiceKit.bandShown(practiceKit.practiceState.data) || {}).key || 'pipeline';
    if (root.CBList.reset) root.CBList.reset('practice-clients-' + bandKey);
    var rows = practiceKit.practiceState.data.clients.map(function (r, n) { r._n = n; return r; });
    practiceKit.practiceState.list = root.CBList.mount(host, listOptions(rows, bandKey));
    markLastClient();
    host.onclick = function (ev) {
      var button = ev.target.closest && ev.target.closest('[data-bp-open]');
      if (button) { ev.preventDefault(); openBooks(button.getAttribute('data-bp-open'), bandKey); }
    };
  }
  /** the list left from the last paint is destroyed first */
  function dropOldList() {
    if (practiceKit.practiceState.list) {
      try { practiceKit.practiceState.list.destroy(); } catch (failure) { if (root.cbQuiet) root.cbQuiet('practice:destroy', failure); }
    }
  }
  /** the first paint marks the last client the person worked on (the row to come back to) */
  function markLastClient() {
    if (!practiceKit.practiceState.marked && lastClient()) {
      practiceKit.practiceState.marked = true;
      root.setTimeout(function () { if (practiceKit.practiceState.list && practiceKit.practiceState.list.mark) practiceKit.practiceState.list.mark(lastClient()); }, 0);
    }
  }
  /** the client list: its key, rows, columns, sorts, filters, search and empty state */
  function listOptions(rows, bandKey) {
    return {
      key: 'practice-clients-' + bandKey, t: translate, rows: function () { return rows; }, id: function (r) { return r.entity_id; }, rowTid: function (r) { return 'practice-row-' + r.entity_id; },
      columns: columns(), defaultCols: colsOf(bandKey), next: function (r) { return practiceKit.detailHTML(r, bandKey); }, sorts: sorts(bandKey), filters: filters(), preset: practiceKit.practiceState.filter ? { filt: practiceKit.practiceState.filter } : { filt: {} },
      search: function (r) { return [r.name, r.country, r.health.words, r.health.reasons.join(' ')].join(' '); },
      empty: { title: translate('No clients match') },
      cardMax: 3 /* first-impression W9: a phone card carries the client, the status and the stage with its blocker (Year end); the rest are in the View chooser, not dropped (list-ctl noRoomKeys) */,
      rowClass: function (r) { return isLast(r) ? 'bp-last' : ''; }
    };
  }
  function practiceCss() {
    if (root.document.getElementById('bp_css')) return;
    var styleNode = root.document.createElement('style');
    styleNode.id = 'bp_css';
    styleNode.textContent =
      '#bp_practice{margin:0 0 16px}#bp_practice h2{margin:0 0 6px;font-size:18px}.bp-band{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin:8px 0}' +
      '.bp-tile{display:flex;flex-direction:column;gap:2px;text-align:left;padding:8px 10px;border:1px solid var(--line,#DDD6C6);border-radius:10px;background:var(--card,#fff);color:inherit;font:inherit;cursor:pointer;min-height:44px}' +
      '.bp-tile b{font-size:20px;line-height:1.1}@media(max-width:700px){.bp-band{grid-template-columns:repeat(3,1fr);gap:6px}.bp-tile{padding:6px 8px;min-height:44px}.bp-tile b{font-size:18px}.bp-tile span{font-size:12px;line-height:1.15}}.bp-bands{display:flex;gap:6px;margin:4px 0}.bp-bandtab{border:1px solid var(--line,#DDD6C6);border-radius:999px;padding:4px 12px;background:var(--card,#fff);color:inherit;font:inherit;font-size:13px;cursor:pointer;min-height:32px}.bp-bandtab.on{background:var(--accent,#1b4d3e);color:var(--on-accent,#fff);border-color:var(--accent,#1b4d3e)}.bp-note{margin:2px 0}.bp-link{color:inherit;font-weight:600;text-decoration:underline}.bp-tile span{font-size:13px}.bp-tile i{font-style:normal;font-size:12px;color:var(--muted,#5a5646)}' +
      '.bp-yend{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bp-last{background:var(--amber-t,#FDF3DC)}.bp-chip{display:inline-block;margin-inline-start:6px;padding:1px 8px;border-radius:999px;border:1px solid var(--amber-b,#EFD39A);background:var(--amber-t,#FDF3DC);color:var(--amber-i,#7A5205);font-size:12px;font-weight:600;white-space:nowrap}' +
      '.bp-pic{display:flex;align-items:center;gap:8px;margin-inline-start:auto;flex:none;height:30px}.bp-pic svg{width:calc(var(--pw) * 1px)!important;height:30px!important;max-width:none;flex:none}.bp-pic .sub{font-size:12px;white-space:nowrap}.bp-strip{grid-column:1/-1;display:flex;flex-direction:column;gap:2px;padding:2px 0 6px}.bp-strip svg{max-width:340px}.bp-pair{grid-column:1/-1;display:flex;flex-direction:column;gap:2px;padding:2px 0 6px}.bp-pair svg{max-width:340px}.bp-cmp{grid-column:span 3;display:flex;flex-direction:column;gap:0;min-width:0;overflow:hidden}.bp-cmp .sub{font-size:11px;line-height:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bp-cmp-row{display:flex;gap:12px}.bp-cmp svg{flex:none;max-width:none}@media(max-width:700px){.bp-cmp{grid-column:span 2}}@media(max-width:700px){.bp-pic .sub{display:none}}.bp-tile.on{outline:2px solid var(--accent,#1b4d3e)}.bp-tile.help b{color:var(--red,#9b1c1c)}.bp-tile.watch b{color:var(--amber,#8a5a00)}.bp-tile.good b{color:var(--green,#1b5e20)}.bp-tile.held{cursor:default;opacity:.85;border-style:dashed}' +
      '.bp-detail{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:6px 16px;padding:8px 4px}.bp-fig{display:flex;justify-content:space-between;flex-wrap:wrap;gap:2px 8px;min-width:0}.bp-fig>b,.bp-fig>a{min-width:0;overflow-wrap:anywhere}#bp_list{height:min(70vh,640px);min-height:320px}@media(max-width:700px){#bp_list{height:80vh}}.bp-rule{margin:4px 0 8px}.bp-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-height:32px;margin:0 0 6px}.bp-head h2{margin:0}';
    root.document.head.appendChild(styleNode);
  }
  function draw() {
    var areas = root.document.querySelector('[data-testid="shell-areas"]');
    if (!areas || !practiceKit.practiceState.data) return false;
    var section = sectionIn(areas);
    dropWaiting();
    var held = root.document.activeElement, heldId = held && section.contains(held) && held.getAttribute ? held.getAttribute('data-testid') : null; /* B3: where the keyboard was, put back after the redraw */
    var door = root.document.getElementById('bcd_card');
    if (door && door.parentNode) door.parentNode.removeChild(door);
    section.innerHTML = sectionHTML();
    wireSection(section);
    mountList();
    wireFlagButton(section);
    restoreFocus(section, heldId);
    practiceKit.practiceState.drawn = true;
    return true;
  }
  /** the practice section above the areas (made once, with its styles) */
  function sectionIn(areas) {
    var section = root.document.getElementById('bp_practice');
    if (!section) {
      practiceCss();
      section = root.document.createElement('section');
      section.id = 'bp_practice';
      section.setAttribute('data-testid', 'practice');
      areas.parentNode.insertBefore(section, areas);
    }
    return section;
  }
  /** the section's head, band and the slot for the list, from the server's counts */
  function sectionHTML() {
    return (
   '<div class="bp-head"><h2>' + escapeHtml(translate('Your practice')) + ' · ' + escapeHtml(practiceKit.practiceState.data.clients.length) + ' ' + escapeHtml(translate('clients')) + '</h2>' + (practiceKit.bandShown(practiceKit.practiceState.data) ? practiceKit.pictureHTML(practiceKit.bandShown(practiceKit.practiceState.data)) : '') +
   (practiceKit.practiceState.filter ? '<button type="button" class="bp-bandtab bp-clear" data-cbsid="CMP014-B01" data-bp-clear="1" data-testid="practice-clear">' + escapeHtml(translate('Show all clients')) + '</button>' : '') + '<span data-bp-flagslot="1">' + flagButton() + '</span></div>' + (practiceKit.bandShown(practiceKit.practiceState.data) && practiceKit.bandShown(practiceKit.practiceState.data).key === 'advisory' ? practiceKit.ruleHTML(practiceKit.practiceState.data.rule) : '') + practiceKit.bandHTML(practiceKit.practiceState.data) +
   (practiceKit.practiceState.data.truncated ? '<p class="sub">' + escapeHtml(translate('Some clients are not shown.')) + '</p>' : '') +
   '<div id="bp_list" data-testid="practice-list"></div>'
    );
  }
  /** the band tiles filter, the tabs switch the band, Show all clears */
  function wireSection(section) {
    [].forEach.call(section.querySelectorAll('[data-bp-filter]'), function (b) {
      b.onclick = function () {
        var f = JSON.parse(b.getAttribute('data-bp-filter'));
        practiceKit.practiceState.filter = practiceKit.practiceState.filter && JSON.stringify(practiceKit.practiceState.filter) === JSON.stringify(f) ? null : f;
        draw();
    };
    });
    [].forEach.call(section.querySelectorAll('[data-bp-band]'), function (b) {
      b.onclick = function () { practiceKit.practiceState.band = b.getAttribute('data-bp-band'); practiceKit.practiceState.filter = null; draw(); };
    });
    var clear = section.querySelector('[data-bp-clear]');
    if (clear) clear.onclick = function () { practiceKit.practiceState.filter = null; draw(); };
  }
  /** where the keyboard was is put back (B3), else on the first tile */
  function restoreFocus(section, heldId) {
    if (!heldId) return;
    var back = section.querySelector('[data-testid="' + heldId + '"]') || section.querySelector('.bp-tile.on') || section.querySelector('.bp-tile');
    if (back && back.focus) back.focus();
  }
  /* l16 firmhome: Home's card facts and the "Your clients" card ask THIS first: a firm (clients, no trade of its own) hides the shop cards and asks for only what it draws, so
     they wait for the one practice read (at most `ms`) and then know which Home they are on. Never rejects. */
  var settleNow = null,
    settledOnce = new root.Promise(function (go) { settleNow = go; });
  function settle() { practiceKit.practiceState.pending = false; release(); dropWaiting(); if (settleNow) settleNow(true); }
  /* l16 R4-2: the wait is for the ANSWER, not for 3 s. A practice answer held past 3 s used to let Home decide "not a firm": the auditor saw the shop Home and the page asked 31 calls against a budget of 8. The ceiling is
     only a hang-guard (a read that never returns); a slow answer shows the loading frame (drawWaiting) and Home waits for it. */
  var SETTLE_CEILING = 25000;
  function settled(ms) {
    /* l16 W5: while a known firm's practice read has failed, nothing decides "a shop": the cards keep waiting for the retry */
    if (practiceKit.practiceState.failedFirm) return settledOnce;
    return root.Promise.race([settledOnce, new root.Promise(function (go) { root.setTimeout(function () { if (hintRaw() !== "0" && !practiceKit.practiceState.data) return; go(false); /* a firm or a login not yet known keeps waiting on the frame and its retry */ }, ms || SETTLE_CEILING + 50); })]);
  }
  /** what the last answer said (a firm or not) for THIS login, kept per browser only to word the loading frame and to decide whether Home holds its paint; the page never decides from it.
      Stored as "1:<token tail>" / "0:<token tail>" so another login in the same browser reads as unknown. */
  function hintRaw() {
    try {
      var v = root.localStorage.getItem('cb_practice_hint') || '', t = token() || '';
      return v.slice(1, 2) === ':' && v.slice(2) === t.slice(-12) ? v.slice(0, 1) : '';
    } catch (failure) {
      if (root.cbQuiet) root.cbQuiet('practice:hint', failure);
      return '';
    }
  }
  function hint(set) {
    try {
      if (set !== undefined) root.localStorage.setItem('cb_practice_hint', (set ? '1' : '0') + ':' + (token() || '').slice(-12));
    } catch (failure) {
      if (root.cbQuiet) root.cbQuiet('practice:hint', failure);
    }
    return hintRaw() === '1';
  }
  /** l16 R5-2: Home paints ONLY the loading frame while this login may be a firm (signed in, and the last answer for this login was not "a shop"): no shop card, no card facts, until settled() answers.
      A login known to be a shop (hint 0) paints at once as before, so an owner is never slower. */
  var holding = !!token() && hintRaw() !== '0';
  function release() {
    if (!holding) return;
    holding = false;
    root.document.documentElement.classList.remove('bp-hold');
  }
  if (holding) {
    root.document.documentElement.classList.add('bp-hold');
    var hideStyle = root.document.createElement('style');
    hideStyle.textContent = 'html.bp-hold [data-testid="shell-areas"],html.bp-hold [data-testid="shell-sidetools"],html.bp-hold #railbox{display:none!important}html.bp-hold .cbsh-nv:not([data-go="home"]){visibility:hidden}';
    (root.document.head || root.document.documentElement).appendChild(hideStyle);
    root.setTimeout(function () { if (!practiceKit.practiceState.failedFirm) release(); }, SETTLE_CEILING + 500);
  }
  /* l16 n12: a firm's Home draws neither the two side buttons (We lean on / Leans on us) nor the Your work strip: one class, set from the one rule, hides them with no flash (the hold above covers the wait) */
  function markFirm() {
    root.document.documentElement.classList.toggle('bp-firm', hidesShopCards('sides'));
  }
  var fs = root.document.createElement('style');
  fs.textContent = 'html.bp-firm [data-testid="shell-sidetools"],html.bp-firm .cbsh-side,html.bp-firm #railbox{display:none!important}html.bp-firm:not(.bp-setup) .cbsh-main[data-tab=home] .cbsh-sec.setup{display:none!important}'; /* W9: a firm's Home is its practice only: the folded "What it all stands on" holds only the cards FIRM_KEEPS names (its own Setup), so it is not drawn on Home; the Setup button reveals it (shell go) */
  (root.document.head || root.document.documentElement).appendChild(fs);
  function dropWaiting() {
    var w = root.document.getElementById('bp_wait');
    if (w && w.parentNode) w.parentNode.removeChild(w);
  }
  /** the practice frame while the one practice read is still out (after 0.8 s): a heading and a loading line, replaced by the practice when it answers, removed when it says there is none */
  function drawWaiting() {
    var areas = root.document.querySelector('[data-testid="shell-areas"]');
    if (!areas || root.document.getElementById('bp_wait') || root.document.getElementById('bp_practice')) return;
    var waitingBox = root.document.createElement('section');
    waitingBox.id = 'bp_wait';
    waitingBox.setAttribute('data-testid', 'practice-loading');
    waitingBox.setAttribute('role', 'status');
    waitingBox.setAttribute('aria-live', 'polite');
    waitingBox.style.margin = '0 0 16px';
    waitingBox.innerHTML = (hint() ? '<h2 style="margin:0 0 6px;font-size:18px">' + escapeHtml(translate('Your practice')) + '</h2>' : '') + '<p class="sub">' + escapeHtml(translate('Loading')) + '</p>';
    areas.parentNode.insertBefore(waitingBox, areas);
  }
  /** l16 W5: a login known to be a firm (hint 1) whose practice read failed (429 / 5xx / no answer): a calm frame with a retry, never the shop Home. An unknown login keeps hold-then-decide. */
  function drawFailed() {
    dropWaiting();
    var areas = root.document.querySelector('[data-testid="shell-areas"]');
    if (!areas || root.document.getElementById('bp_failed')) return;
    var failedBox = root.document.createElement('section');
    failedBox.id = 'bp_failed';
    failedBox.setAttribute('data-testid', 'practice-failed');
    failedBox.setAttribute('role', 'alert');
    failedBox.style.margin = '0 0 16px';
    /* a login known to be a firm is titled "Your practice"; a login the page does not know yet (a fresh browser) is titled "Home": the frame never claims what it has not been told */
    var title = hintRaw() === '1' ? translate('Your practice') : translate('Home');
    failedBox.innerHTML = '<h2 style="margin:0 0 6px;font-size:18px">' + escapeHtml(title) + '</h2><div data-testid="practice-failed-frame"></div>';
    areas.parentNode.insertBefore(failedBox, areas);
    root.CBShell.readFailed(failedBox.lastChild, { what: translate('Your practice'), status: practiceKit.practiceState.failStatus, retry: function () {
      practiceKit.practiceState.failedFirm = false;
      practiceKit.practiceState.token = null; /* the next tick reads again */
      var f = root.document.getElementById('bp_failed');
      if (f && f.parentNode) f.parentNode.removeChild(f);
      tick();
    } });
  }
  /** firm frame P0 (T1): only a login KNOWN to be a shop (hint 0) may paint shop cards when the practice read fails; a firm (hint 1) or a login not yet known (a fresh browser, no hint) stays held with the frame and its retry */
  function failedRead(status) {
    practiceKit.practiceState.pending = false;
    practiceKit.practiceState.failStatus = status || 0;
    if (hintRaw() !== '0') { practiceKit.practiceState.failedFirm = true; drawFailed(); return; }
    settle(); /* a known shop: the shop Home, as before */
  }
  function tick() {
    var tokenNow = token();
    if (!tokenNow) return;
    if (practiceKit.practiceState.token !== tokenNow) {
      practiceKit.practiceState.token = tokenNow;
      practiceKit.practiceState.data = null;
      practiceKit.practiceState.drawn = false;
      practiceKit.practiceState.fl = null; practiceKit.practiceState.flReady = false; practiceKit.practiceState.flOff = false; practiceKit.practiceState.flTotal = 0; /* another login: its own flags */
      practiceKit.practiceState.pending = true;
      practiceKit.practiceState.since = Date.now();
      read().then(function (answer) {
        if (answer && answer.failed === true) return failedRead(answer.status);
        if (!answer || !answer.clients || !answer.clients.length) { hint(false); return settle(); }
        practiceKit.practiceState.data = answer;
        hint(answer.own_trade === false);
        markFirm();
        root.dispatchEvent(new root.Event('cb-practice'));
        flagsStart(); /* a firm's own bookmarks: one more read, after the practice drew */
        settle();
        tick();
      }, function (failure) { if (root.cbQuiet) root.cbQuiet('practice:read', failure); failedRead(0); });
      /* a read that never answers is a failed read too (the 25 s hang): the frame, not the shop Home */
      root.setTimeout(function () { if (practiceKit.practiceState.token === tokenNow && practiceKit.practiceState.pending && !practiceKit.practiceState.data && !practiceKit.practiceState.failedFirm) failedRead(0); }, SETTLE_CEILING);
    } else if (practiceKit.practiceState.data && !root.document.getElementById('bp_practice')) draw();
    else if (practiceKit.practiceState.pending && !practiceKit.practiceState.data && (holding || Date.now() - practiceKit.practiceState.since > 800)) drawWaiting();
  }
  function start() {
    tick();
    if (!practiceKit.practiceState.timer) practiceKit.practiceState.timer = root.setInterval(tick, 1000);
    if (holding) { var quick = root.setInterval(function () { if (!holding || practiceKit.practiceState.data) return root.clearInterval(quick); drawWaiting(); }, 60); }
  }
  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start);
  else start();
  root.CBPractice = { settled: settled, hasData: function () { return !!practiceKit.practiceState.data; }, holding: function () { return holding; }, isFirm: isFirm, hidesShopCards: hidesShopCards, start: start, checkedWords: practiceKit.checkedWords, checkedLeft: practiceKit.checkedLeft,
    /* the pure pieces, for e2e/practice-rep73-fable.cjs (no browser): feed an answer, read the words */
    parts: { bankWords: practiceKit.bankWords, openBooks: openBooks, use: function (d) { practiceKit.practiceState.data = d; practiceKit.practiceState.band = null; practiceKit.practiceState.filter = null; }, compareHTML: practiceKit.compareHTML, pairHTML: practiceKit.pairHTML, yendCell: practiceKit.yendCell, detailHTML: practiceKit.detailHTML, sorts: sorts, statusCell: practiceKit.statusCell, workOrder: workOrder, sheetHTML: practiceKit.sheetHTML, pictureHTML: practiceKit.pictureHTML, stripHTML: practiceKit.stripHTML, columns: columns, filters: filters, bandHTML: practiceKit.bandHTML, stageWord: practiceKit.stageWord, BAND_COLS: BAND_COLS } };
})(typeof window !== 'undefined' ? window : globalThis);
