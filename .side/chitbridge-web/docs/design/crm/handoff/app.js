/* CB CRM — designer handoff. Paints CRM (data.js); computes nothing a server or another page computes.
   Every block below names the app function it stands in for, so the build wires the real one, not this one:
     list rows / header / peek  → listHeader · rowGrid · colTemplate · rowPeekShow (app.html:16775-16805)
     search · filters · sort · count · lazy rows → list-ctl.js (listCtl, listCtlToolbarHTML, listCtlRowsHTML) + lazyWrap
     group rows / record sections / note expand → gsToggle (cap-folders.js:333)
     dues chip / ledger block    → partyDueChipHTML · partyBooksHTML · partyStatementLoad (cap-books.js:144/157/181)
     edit sheet                  → partyEditOpen (cap-books.js:263), widened to a tax-id list
     mail                        → compose(prefill) kind 'mail' + CBSteps rail + compose pill + attach-ui
     a chit / bill entry         → openChitSheet(id) (chit-sheet.js)
   Routes (hash):  #/parties · #/parties/add?q= · #/party/<no> · #/party/<no>/timeline · #/party/<no>/mail?step=
                   #/party/<no>/log · #/party/<no>/edit · #/followups · #/followups/add
   Handoff toggles (query): state= · role=owner|editor|viewer · ledger=off · group= · select=1 · mstate= · menu=more
   · shot=1 (hides the state switcher for screenshots). README.md lists every one. */
(function () {
  'use strict';
  var D = window.CRM;
  var NOW = new Date(D.now);
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var plural = function (n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); };

  /* ── icons (paths only; the stroke style is styles.css svg{}) ── */
  var I = {
    parties: 'M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM22 19v-1a4 4 0 0 0-3-3.9M16 5.1a3 3 0 0 1 0 5.8',
    clock: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 7v5l3 2',
    segments: 'M12 3v9h9A9 9 0 1 1 12 3zM15 3.5A9 9 0 0 1 20.5 9H15z',
    dup: 'M8 8h12v12H8zM4 16V4h12',
    imp: 'M12 3v12M7 10l5 5 5-5M4 21h16',
    gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13a7.5 7.5 0 0 0 0-2l2-1.5-2-3.5-2.4 1a7 7 0 0 0-1.7-1L15 3h-4l-.4 2.5a7 7 0 0 0-1.7 1l-2.4-1-2 3.5 2 1.5a7.5 7.5 0 0 0 0 2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 1.7 1L11 21h4l.4-2.5a7 7 0 0 0 1.7-1l2.4 1 2-3.5z',
    link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
    house: 'M3 11l9-7 9 7M5 10v10h14V10',
    walk: 'M12 7a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM12 9v6M9 22l3-7 3 7M8 12h8',
    check: 'M5 12l5 5L20 7',
    msg: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z',
    mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
    phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
    note: 'M5 3h10l4 4v14H5zM9 9h6M9 13h6M9 17h4',
    bill: 'M6 3h9l3 3v15H6zM9 9h6M9 13h6M9 17h4',
    pay: 'M7 4h10M7 8h10M7 4c6 0 6 8 0 8l7 8',
    flag: 'M5 21V4h11l-2 4 2 4H5',
    chit: 'M4 4h16v16H4zM8 9h8M8 13h8M8 17h5',
    pin: 'M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
    wa: 'M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 20 12zM9 9.5c.5 2.5 2.5 4.5 5 5',
    pencil: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
    plus: 'M12 5v14M5 12h14',
    dots: 'M5 12h.01M12 12h.01M19 12h.01',
    back: 'M15 6l-6 6 6 6',
    chev: 'M9 6l6 6-6 6',
    x: 'M6 6l12 12M18 6L6 18',
    warn: 'M12 3l10 18H2zM12 10v5M12 18h.01',
    inArrow: 'M17 7L7 17M7 9v8h8',
    outArrow: 'M7 17L17 7M9 7h8v8',
    star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
    clip: 'M21 11l-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7',
    search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5',
    snooze: 'M12 9v4l2 2M5 3L2 6M19 3l3 3M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16z',
    min: 'M5 19h14',
    user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
    wifi: 'M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M12 20h.01'
  };
  var svg = function (k) { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + I[k] + '"/></svg>'; };

  /* ── formatters: PAINT only. money() stands in for CBMoney.format; dates use the sample "now". ── */
  function money(minor, cur) {
    if (minor == null) return '—';
    var v = Math.abs(minor) / 100;
    return (cur === 'INR' || !cur ? '₹' : cur + ' ') + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  /* dates are painted in the SHOP's time zone (IST in the sample), never the viewer's machine — the server sends it */
  var TZ_MIN = 330;
  function W(x) { return new Date(new Date(x).getTime() + TZ_MIN * 60000); }   // read with getUTC*
  function d0(x) { var d = W(x); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }
  function dayDiff(x) { return Math.round((d0(x) - d0(NOW)) / 86400000); }
  function dShort(x) { var d = W(x); return d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + (d.getUTCFullYear() !== W(NOW).getUTCFullYear() ? ' ' + d.getUTCFullYear() : ''); }
  function tShort(x) { var d = W(x); var h = d.getUTCHours(), m = d.getUTCMinutes(); return (h % 12 || 12) + ':' + String(m).padStart(2, '0') + (h < 12 ? ' am' : ' pm'); }
  function dayWord(x) { var n = dayDiff(x); return n === 0 ? 'Today' : n === -1 ? 'Yesterday' : n === 1 ? 'Tomorrow' : (n > 1 && n < 7 ? WD[W(x).getUTCDay()] + ' ' + dShort(x) : dShort(x)); }
  function when(x) { var n = dayDiff(x); return (n === 0 || n === -1 || n === 1) ? dayWord(x) + ' ' + tShort(x) : dShort(x); }

  /* ── route ── */
  var R = { parts: [], q: {} };
  function parse() {
    var h = (location.hash || '#/parties').slice(1), qi = h.indexOf('?');
    var path = qi < 0 ? h : h.slice(0, qi), qs = qi < 0 ? '' : h.slice(qi + 1);
    R.parts = path.split('/').filter(Boolean);
    R.q = {};
    qs.split('&').filter(Boolean).forEach(function (kv) { var p = kv.split('='); R.q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); });
    if (!R.parts.length) R.parts = ['parties'];
  }
  function keep() { var k = ['role', 'ledger', 'shot']; var out = k.filter(function (x) { return R.q[x]; }).map(function (x) { return x + '=' + encodeURIComponent(R.q[x]); }); return out.length ? '?' + out.join('&') : ''; }
  function href(path, extra) { var base = keep(); if (extra) base = base ? base + '&' + extra : '?' + extra; return '#' + path + base; }
  var role = function () { return R.q.role || D.me.role; };
  var isOwner = function () { return role() === 'owner'; };
  var canEdit = function () { return role() !== 'viewer'; };
  var ledgerOn = function () { return R.q.ledger !== 'off' && D.shop.ledger_on; };

  /* ── per-session UI state (list-ctl keeps the same: q, sort, f) ── */
  var UI = { q: '', sort: 'name', f: { rail: '', role: '', seg: '', dues: '', fu: '' }, cols: ['party', 'dues', 'next'], colMenu: false, gsOpen: {},
    selected: {}, showFilters: false, tlFilter: 'all', tlQ: '', tlOpen: {}, recOpen: {}, menu: null,
    fuScope: null, fuSource: '', fuDone: false, fuQ: '', fuSort: 'due', fuOpen: { late: true, today: true, week: true, later: false },
    ccOpen: true, pickOpen: true, sigOpen: false, sched: '', tpl: '' };

  /* ═════ data access — the build replaces these four with api() calls ═════ */
  var parties = function () { return D.list.parties; };
  function partyBy(key) {
    var k = D.merged[key] || key;
    return parties().filter(function (p) { return p.party_no === k || p.party_id === k; })[0] || null;
  }
  var routeKey = function (p) { return p.party_no || p.party_id; };
  function recordOf(p) {
    var r = D.records[p.party_id];
    if (r) return r;
    /* mock-only fallback for rows the sample did not detail: the same shape, empty where nothing is known */
    var isC = p.roles.indexOf('customer') >= 0, isS = p.roles.indexOf('supplier') >= 0;
    return { customer: isC ? { txn_count: p.txn_count, last_bill_at: p.last_at, since: '2026-02-11', added_via: 'counter', segment: p.segment, groups: p.groups, credit_days: 7, credit_limit_minor: null } : null,
      supplier: isS ? { category: 'General', preferred: false, supply_kind: 'resale', notes: null, added_via: p.on_chitbridge ? 'handle' : 'name', credit_days: 30, credit_limit_minor: null, catalogue: p.on_chitbridge } : null,
      contacts: { phones: p.phone ? [p.phone] : [], emails: p.email ? [p.email] : [], address: null },
      prefs: [], gstn_profile: null, scorecard: null, points: null, followups: [], mail_bounced: null, changes: [] };
  }
  function timelineOf(p) { return D.timelines[p.party_id] || { counts: { all: 0, messages: 0, bills: 0, notes: 0, mail: 0, followups: 0 }, next_before: null, entries: [] }; }

  /* ═════ chips — status is an icon AND a word (cb-design §3) ═════ */
  function railChip(p) {
    if (p.kind === 'walk-in') return '<span class="tag walk" title="Phone only — points at the counter">' + svg('walk') + 'Walk-in</span>';
    if (p.on_chitbridge) return '<span class="tag on" title="Bills and messages reach them in their app">' + svg('link') + 'On ChitBridge</span>';
    if (p.why_not === 'inactive') return '<span class="tag local" title="Their ChitBridge account is inactive">' + svg('house') + 'Account inactive</span>';
    if (p.why_not === 'shopper') return '<span class="tag local">' + svg('house') + 'Shopper account</span>';
    if (p.why_not === 'other_population') return '<span class="tag local">' + svg('house') + 'Test space</span>';
    return '<span class="tag local" title="Not on ChitBridge — bills are yours only">' + svg('house') + 'Local</span>';
  }
  var ROLE = { customer: 'Customer', supplier: 'Supplier' };
  function roleChips(p) { return p.roles.map(function (r) { return '<span class="tag role">' + ROLE[r] + '</span>'; }).join(''); }
  var SEG = { new: 'New', regular: 'Regular', inactive: 'Inactive', high_value: 'High value' };
  function segChip(p) { return p.segment ? '<span class="tag seg">' + esc(SEG[p.segment] || p.segment) + '</span>' : ''; }
  /* partyDueChipHTML(partyId) — party_no · ↓ they owe you (amber) / ↑ you owe them (blue); the number is the server's */
  function dueChip(p, withNo) {
    if (!ledgerOn() || p.balance_minor == null) return '';
    var b = p.balance_minor;
    if (!b) return '<span class="due nil">' + (withNo && p.party_no ? esc(p.party_no) + ' · ' : '') + 'settled</span>';
    var owes = b > 0;
    return '<span class="due ' + (owes ? 'owe-me' : 'owe-them') + '" title="' + (owes ? 'They owe you' : 'You owe them') + (p.oldest_due ? ' · oldest due ' + dShort(p.oldest_due) : '') + '">'
      + (withNo && p.party_no ? esc(p.party_no) + ' · ' : '') + (owes ? '↓ ' : '↑ ') + money(b, p.currency) + (p.dues_overdue ? ' <span class="od">· late</span>' : '') + '</span>';
  }
  function fuCell(p) {
    if (!p.next_followup_at) return '<span class="sub">—</span>';
    return '<span class="fu' + (p.next_followup_late ? ' late' : '') + '">' + (p.next_followup_late ? svg('clock').replace('<svg', '<svg style="width:13px;height:13px;vertical-align:-2px"') + ' Late · ' : '') + esc(when(p.next_followup_at)) + '</span>';
  }

  /* ═════ shell: sidebar + header ═════ */
  function nav(active) {
    var late = D.list.alerts.followups_overdue;   // the server's number — the same one the alert line shows
    var items = [
      ['parties', 'Parties', 'parties', '<span class="n quiet">' + parties().length + '</span>', true],
      ['followups', 'Follow-ups', 'clock', late ? '<span class="n" title="' + plural(late, 'late follow-up') + '">' + late + '</span>' : '', true],
      ['segments', 'Segments & groups', 'segments', '', true],
      ['duplicates', 'Duplicates', 'dup', D.list.alerts.duplicates ? '<span class="n">' + D.list.alerts.duplicates + '</span>' : '', isOwner()],
      ['import', 'Import / export', 'imp', '', isOwner()],
      ['settings', 'Settings', 'gear', '', isOwner()]
    ];
    $('nav').innerHTML = items.filter(function (x) { return x[4]; }).map(function (x) {
      return '<a class="nav-btn' + (x[0] === active ? ' active' : '') + '" href="' + href('/' + x[0]) + '" aria-label="' + esc(x[1]) + '"' + (x[0] === active ? ' aria-current="page"' : '') + '>'
        + svg(x[2]) + '<span class="label">' + esc(x[1]) + '</span>' + x[3] + '</a>';
    }).join('');
  }
  function head(title, sub, tools) {
    $('title').innerHTML = esc(title) + '<span class="sample" title="Every name and figure on this page is made up for the design">Sample data</span>';
    $('summary').innerHTML = sub || '';
    $('who').innerHTML = '<span class="shop">' + esc(D.shop.name) + (role() !== 'owner' ? ' · ' + (role() === 'editor' ? 'co-assist' : 'viewer') : '') + '</span>'
      + '<a class="home" href="#" onclick="return false">‹ App</a><button type="button" class="avatar" aria-label="Profile">' + (role() === 'owner' ? 'AT' : 'DV') + '</button>';
    $('tools').innerHTML = tools || '';
    $('tools').hidden = !tools;
  }

  /* ═════ 1 · CRM HOME — the parties list ═════ */
  var COLS = {
    party: { label: 'Party', w: 'minmax(220px,1fr)', sort: 'name', cell: partyCell },
    dues: { label: 'Dues', w: 'minmax(150px,190px)', sort: 'dues', align: 'right', cell: function (p) { return dueChip(p) || '<span class="sub">—</span>'; }, ledger: true },
    next: { label: 'Next follow-up', w: 'minmax(130px,160px)', cell: fuCell },
    last: { label: 'Last activity', w: 'minmax(110px,140px)', sort: 'last', cell: function (p) { return '<span class="when">' + esc(when(p.last_at)) + '</span>'; } },
    seg: { label: 'Segment · groups', w: 'minmax(130px,180px)', cell: function (p) { return (segChip(p) + p.groups.map(function (g) { return '<span class="tag">' + esc(g) + '</span>'; }).join(' ')) || '<span class="sub">—</span>'; } },
    contact: { label: 'Phone · e-mail', w: 'minmax(160px,220px)', cell: function (p) { return [p.phone, p.email].filter(Boolean).map(esc).join('<br>') || '<span class="sub">—</span>'; } },
    tax: { label: 'GSTIN · state', w: 'minmax(170px,200px)', cell: function (p) { var g = (p.tax_ids || []).filter(function (t) { return t.scheme === 'GSTIN'; })[0]; return g ? '<span class="mono">' + esc(g.value) + '</span>' : '<span class="sub">—</span>'; } },
    city: { label: 'City', w: 'minmax(100px,140px)', cell: function (p) { return esc(p.city || '—'); } }
  };
  function visibleCols() { return UI.cols.filter(function (k) { return !(COLS[k].ledger && !ledgerOn()); }); }
  function colTemplate() { var s = R.q.select ? '26px ' : ''; return s + visibleCols().map(function (k) { return COLS[k].w; }).join(' '); }

  /* the one most useful fact for a card: overdue dues › next follow-up › last activity (REQUIREMENT-home §7) */
  function cardFact(p) {
    if (ledgerOn() && p.dues_overdue) return dueChip(p);
    if (p.next_followup_at) return '<span class="sub">Next</span> ' + fuCell(p);
    if (p.kind === 'walk-in' && p.points) return '<span class="sub">Points</span> <b class="mono">' + p.points.balance + '</b>';
    return '<span class="sub">Last</span> <span class="when">' + esc(when(p.last_at)) + '</span>';
  }
  function partyCell(p) {
    return '<div class="l1">' + (p.unread ? '<span class="udot" title="' + plural(p.unread, 'unread message') + '"></span>' : '')
      + '<span class="nm">' + esc(p.display_name) + '</span>' + (p.party_no ? '<span class="pno">' + esc(p.party_no) + '</span>' : '') + '</div>'
      + '<div class="l2">' + roleChips(p) + railChip(p) + '</div>'
      + '<div class="card-fact">' + cardFact(p) + '</div>';
  }

  var FILTERS = [
    { key: 'role', all: 'All roles', options: [['customer', 'Customers'], ['supplier', 'Suppliers'], ['both', 'Both']], match: function (p, v) { return v === 'both' ? p.roles.length === 2 : p.roles.indexOf(v) >= 0; } },
    { key: 'seg', all: 'Any segment', options: [['new', 'New'], ['regular', 'Regular'], ['high_value', 'High value'], ['inactive', 'Inactive']], match: function (p, v) { return p.segment === v; } },
    { key: 'dues', all: 'Dues: any', ledger: true, options: [['has', 'Has dues'], ['late', 'Dues late']], match: function (p, v) { return v === 'late' ? p.dues_overdue : !!p.balance_minor; } },
    { key: 'fu', all: 'Follow-up: any', options: [['due', 'Follow-up due'], ['late', 'Follow-up late']], match: function (p, v) { return v === 'late' ? p.next_followup_late : !!p.next_followup_at && dayDiff(p.next_followup_at) <= 0; } }
  ];
  var RAILS = [['', 'All'], ['on', 'On ChitBridge'], ['local', 'Local'], ['walk', 'Walk-in']];
  var railMatch = function (p, v) { return !v || (v === 'on' ? p.on_chitbridge : v === 'walk' ? p.kind === 'walk-in' : (!p.on_chitbridge && p.kind !== 'walk-in')); };
  var SORTS = { name: ['Name', function (a, b) { return a.display_name.localeCompare(b.display_name); }],
    last: ['Last activity', function (a, b) { return new Date(b.last_at) - new Date(a.last_at); }],
    dues: ['Dues', function (a, b) { return Math.abs(b.balance_minor || 0) - Math.abs(a.balance_minor || 0); }],
    newest: ['Newest', function (a, b) { return String(b.party_no || '').localeCompare(String(a.party_no || '')); }] };
  function matched() {
    var q = UI.q.trim().toLowerCase();
    return parties().filter(function (p) {
      if (q) { var hay = [p.display_name, p.nickname, p.legal_name, p.party_no, p.on_chitbridge ? p.user_id : '', p.phone, p.email, (p.tax_ids || []).map(function (t) { return t.value; }).join(' '), p.groups.join(' ')].join(' ').toLowerCase(); if (hay.indexOf(q) < 0) return false; }
      if (!railMatch(p, UI.f.rail)) return false;
      for (var i = 0; i < FILTERS.length; i++) { var f = FILTERS[i], v = UI.f[f.key]; if (v && !(f.ledger && !ledgerOn()) && !f.match(p, v)) return false; }
      return true;
    }).slice().sort(SORTS[UI.sort][1]);
  }

  function homeTools() {
    if (R.q.state === 'error' || R.q.state === 'migration') return '';
    var all = parties();
    var chips = RAILS.map(function (r) { var n = all.filter(function (p) { return railMatch(p, r[0]); }).length;
      return '<button type="button" class="chip" data-rail="' + r[0] + '" aria-pressed="' + (UI.f.rail === r[0]) + '">' + r[1] + '<span class="n">' + n + '</span></button>'; }).join('');
    var sels = FILTERS.filter(function (f) { return !(f.ledger && !ledgerOn()); }).map(function (f) {
      return '<select class="fsel" data-f="' + f.key + '" aria-label="' + esc(f.all) + '"><option value="">' + esc(f.all) + '</option>' + f.options.map(function (o) { return '<option value="' + o[0] + '"' + (UI.f[f.key] === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
    }).join('');
    var sort = '<select class="fsel" id="sort" aria-label="Sort">' + Object.keys(SORTS).filter(function (k) { return k !== 'dues' || ledgerOn(); }).map(function (k) { return '<option value="' + k + '"' + (UI.sort === k ? ' selected' : '') + '>Sort: ' + SORTS[k][0] + '</option>'; }).join('') + '</select>';
    var grp = '<select class="fsel" id="group" aria-label="Group rows"><option value="">No groups</option>' + [['rail', 'Group: ChitBridge'], ['role', 'Group: role'], ['seg', 'Group: segment']].map(function (o) { return '<option value="' + o[0] + '"' + (R.q.group === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>';
    var nf = Object.keys(UI.f).filter(function (k) { return k !== 'rail' && UI.f[k]; }).length;
    return '<label class="search">' + svg('search') + '<span class="sr-only">Search parties</span><input type="search" id="q" placeholder="Name, User ID, phone or e-mail" value="' + esc(UI.q) + '"></label>'
      + (canEdit() ? '<a class="act" href="' + href('/parties/add') + '">' + svg('plus') + 'Add party</a>' : '')
      + '<div class="push"><span class="count" id="count"></span>'
      + '<span class="colsbtn" style="position:relative"><button type="button" class="link-btn" data-menu="cols" aria-haspopup="true">Columns ▾</button>' + (UI.menu === 'cols' ? colMenu() : '') + '</span>'
      + (canEdit() ? '<a class="link-btn" href="' + href('/parties', R.q.select ? '' : 'select=1') + '">' + (R.q.select ? 'Done selecting' : 'Select') + '</a>' : '')
      + (isOwner() ? '<span class="more" style="position:relative"><button type="button" class="link-btn" data-menu="homemore" aria-haspopup="true">More ▾</button>' + (UI.menu === 'homemore' ? '<div class="menu"><button type="button">' + svg('dup') + 'Find duplicates</button><button type="button">' + svg('imp') + 'Import</button><button type="button">' + svg('imp').replace('M12 3v12M7 10l5 5 5-5', 'M12 15V3M7 8l5-5 5 5') + 'Export</button></div>' : '') + '</span>' : '')
      + '</div>'
      + '<button type="button" class="act quiet sm ftoggle" id="ftoggle" aria-expanded="' + UI.showFilters + '">Filters' + (nf ? ' · ' + nf : '') + '</button>'
      + '<div class="chips filters' + (UI.showFilters ? ' open' : '') + '">' + chips + sels + sort + grp + '</div>';
  }

  function alertsHTML() {
    if (R.q.state === 'loading' || R.q.state === 'error' || R.q.state === 'migration' || R.q.state === 'empty') return '';
    var a = D.list.alerts, out = [];
    var late = a.followups_overdue;   // the SAME number as the Follow-ups badge (SYSTEM rule 11)
    if (late) out.push('<div class="alert">' + svg('clock') + '<span><span class="num">' + late + '</span> follow-up' + (late === 1 ? '' : 's') + ' late</span><a class="act" href="' + href('/followups') + '">Open follow-ups</a></div>');
    if (ledgerOn() && a.dues_overdue) out.push('<div class="alert">' + svg('pay') + '<span><span class="num">' + a.dues_overdue + '</span> ' + (a.dues_overdue === 1 ? 'party' : 'parties') + ' with late dues</span><button type="button" class="act">See dues</button></div>');
    if (isOwner() && a.duplicates) out.push('<div class="alert blue">' + svg('dup') + '<span><span class="num">' + a.duplicates + '</span> possible duplicate · Ravi Traders / Ravi Trdrs</span><button type="button" class="act">Review</button></div>');
    return out.length ? '<div class="alerts" data-testid="crm-alerts">' + out.join('') + '</div>' : '';
  }

  function rowHTML(p, selKey) {
    var sel = R.q.select ? '<span class="cbx' + (UI.selected[p.party_id] ? ' on' : '') + '" data-sel="' + esc(p.party_id) + '">' + (UI.selected[p.party_id] ? '✓' : '') + '</span>' : '';
    var acc = (ledgerOn() && p.dues_overdue) || p.next_followup_late ? ' acc-late' : '';
    return '<div class="lrow' + (routeKey(p) === selKey ? ' sel' : '') + acc + '" style="grid-template-columns:' + colTemplate() + '" data-open="' + esc(routeKey(p)) + '" data-peek="' + esc(p.party_id) + '" tabindex="0" role="link" aria-label="' + esc(p.display_name) + '">'
      + sel + visibleCols().map(function (k) { var c = COLS[k]; return '<span class="lcell' + (c.align === 'right' ? ' ra' : '') + (k !== 'party' ? ' extra' : '') + '">' + c.cell(p) + '</span>'; }).join('') + '</div>';
  }
  function listHeader() {
    var sel = R.q.select ? '<span></span>' : '';
    return '<div class="lhead" style="grid-template-columns:' + colTemplate() + '">' + sel + visibleCols().map(function (k, i, arr) {
      var c = COLS[k], on = c.sort && UI.sort === c.sort;
      return '<span class="lhcell' + (c.sort ? ' sortable' : '') + (c.align === 'right' ? ' ra' : '') + '"' + (c.sort ? ' data-sort="' + c.sort + '"' : '') + '>' + esc(c.label) + (c.sort ? '<span class="sarr">' + (on ? ' ▲' : ' ⇅') + '</span>' : '')
        + '</span>';
    }).join('') + '</div>';
  }
  /* Task's column chooser — choose AND order; a fourth is refused, not scrolled (SYSTEM rule 7) */
  function colMenu() {
    var keys = UI.cols.concat(Object.keys(COLS).filter(function (k) { return UI.cols.indexOf(k) < 0; })).filter(function (k) { return !(COLS[k].ledger && !ledgerOn()); });
    return '<div class="menu"><div class="why-line" style="padding:6px 12px">Three at most on screen — untick one to add another.</div>' + keys.map(function (k) {
      var on = UI.cols.indexOf(k) >= 0, full = !on && UI.cols.length >= 3, must = k === 'party';
      return '<button type="button" data-col="' + k + '"' + ((full || must) ? ' disabled' : '') + '><span class="cbx' + (on ? ' on' : '') + '">' + (on ? '✓' : '') + '</span>' + esc(COLS[k].label) + (must ? '<span class="why">always</span>' : full ? '<span class="why">3 shown</span>' : '') + '</button>';
    }).join('') + '</div>';
  }
  function groupsOf(rows) {
    var g = R.q.group;
    if (!g) return null;
    var fn = g === 'rail' ? function (p) { return p.kind === 'walk-in' ? 'Walk-ins' : p.on_chitbridge ? 'On ChitBridge' : 'Not on ChitBridge'; }
      : g === 'role' ? function (p) { return p.roles.length === 2 ? 'Customer and supplier' : ROLE[p.roles[0]] + 's'; }
      : function (p) { return p.segment ? SEG[p.segment] : 'No segment'; };
    var order = [], map = {};
    rows.forEach(function (p) { var k = fn(p); if (!map[k]) { map[k] = []; order.push(k); } map[k].push(p); });
    return order.map(function (k) { return { k: k, rows: map[k] }; });
  }
  function listBody(rows, selKey) {
    if (R.q.state === 'loading') return '<div class="loadwrap"><span class="spin"></span>Reading your parties…</div>';
    if (R.q.state === 'empty') return '<div class="empty"><div class="t">No parties yet</div><p>Customers appear when you bill them; suppliers when you add them.</p>' + (canEdit() ? '<a class="act" href="' + href('/parties/add') + '">' + svg('plus') + 'Add party</a>' : '') + '</div>';
    if (!rows.length) return '<div class="empty"><div class="t">Nothing matches “' + esc(UI.q || 'these filters') + '”</div><button type="button" class="act ghost" id="clearq">Clear search and filters</button></div>';
    var groups = groupsOf(rows), chunk = rows.length;   // lazyWrap draws 50 at a time; the sample holds fewer
    var end = '<div class="listend">' + plural(rows.length, 'party', 'parties') + ' · end of list</div>';
    if (!groups) return rows.slice(0, chunk).map(function (p) { return rowHTML(p, selKey); }).join('') + end;
    return groups.map(function (g) {
      var open = UI.gsOpen[g.k] !== false;
      return '<button type="button" class="gsh" data-gs="' + esc(g.k) + '" aria-expanded="' + open + '"><svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="' + I.chev + '"/></svg>' + esc(g.k) + '<span class="n">' + g.rows.length + '</span></button>'
        + (open ? g.rows.map(function (p) { return rowHTML(p, selKey); }).join('') : '');
    }).join('') + end;
  }
  function bulkBar() {
    if (!R.q.select) return '';
    var n = Object.keys(UI.selected).filter(function (k) { return UI.selected[k]; }).length;
    return '<div class="banner blue" style="margin:0"><b>' + n + ' selected</b><span class="tx"></span><button type="button" class="act sm"' + (n ? '' : ' disabled') + '>Add to group</button>' + (isOwner() ? '<button type="button" class="act sm ghost"' + (n ? '' : ' disabled') + '>Export</button>' : '') + '<button type="button" class="act sm ghost" disabled title="Phase 5 — mail">Mail</button></div>';
  }

  function screenHome(selKey, detailHTML) {
    nav('parties');
    head('Parties', R.q.state === 'testshop' ? '<span class="tag blue">' + svg('warn') + 'Test space</span> You see test parties only.' : '', homeTools());
    var c = $('content');
    if (R.q.state === 'error') { c.innerHTML = '<div class="card bad" role="alert"><h2>Couldn’t load your parties.</h2><p>Check the connection and try again.</p><button type="button" class="act">Try again</button></div>'; return; }
    if (R.q.state === 'migration') {
      c.innerHTML = isOwner()
        ? '<div class="card"><h2>CB CRM needs one database step (b276).</h2><p>Until it runs, parties stay where they are in the app. Nothing is lost.</p><button type="button" class="act" id="showsql">Show the step’s file name</button><p id="sqlname" hidden class="mono">migrations/b276_party_interaction_followup.sql</p></div>'
        : '<div class="card"><h2>CB CRM isn’t ready yet.</h2><p>Ask the owner to finish setting up CB CRM.</p></div>';
      return;
    }
    var rows = matched();
    var cnt = $('count'); if (cnt) cnt.innerHTML = R.q.state === 'loading' ? '' : '<b>' + rows.length + '</b> ' + (rows.length === 1 ? 'party' : 'parties') + ' of <b>' + parties().length + '</b>';
    c.innerHTML = alertsHTML() + bulkBar()
      + '<div class="panel' + (detailHTML ? ' has-detail' : '') + '" style="--lw:380px">'
      + '<div class="list" style="position:relative">' + (R.q.state === 'empty' ? '' : listHeader()) + listBody(rows, selKey) + '</div>'
      + '<div class="divider" title="Drag to resize"></div>'
      + '<div class="detail">' + (detailHTML || '') + '</div></div>';
  }

  /* Add party — one field, three result kinds (F1) */
  function sheetAdd() {
    var q = (R.q.q != null ? R.q.q : 'ravi'), ql = q.trim().toLowerCase();
    var mine = ql ? parties().filter(function (p) { return (p.display_name + ' ' + (p.phone || '') + ' ' + (p.email || '')).toLowerCase().indexOf(ql) >= 0; }) : [];
    var cb = (D.search[ql] || []);
    var at = q.indexOf('@') >= 0 && !/\S+@\S+\.\S+/.test(q);
    var roles = function (id) { return '<div class="roles"><span class="hint">As</span><div class="seg2" role="group" aria-label="Role"><button type="button" aria-pressed="true">Customer</button><button type="button" aria-pressed="false">Supplier</button><button type="button" aria-pressed="false">Both</button></div></div>'; };
    var body = '<div class="fld"><label class="lb" for="addq">Who?</label><input class="inp" id="addq" value="' + esc(q) + '" placeholder="Name, User ID, phone or e-mail" autofocus></div>';
    if (!ql) body += '<p class="hint" style="margin:0">Type a name to add a local party, or a User ID / e-mail to find them on ChitBridge.</p>';
    else {
      if (mine.length) body += mine.map(function (p) { return '<div class="result"><span class="k">Already your party</span><span><span class="nm">' + esc(p.display_name) + '</span> <span class="pno mono">' + esc(p.party_no || '') + '</span><br><span class="s">' + roleChips(p) + ' ' + railChip(p) + '</span></span><a class="act sm ghost" href="' + href('/party/' + routeKey(p)) + '">Open</a></div>'; }).join('');
      if (R.q.state === 'testspace') body += '<div class="banner amber">' + svg('warn') + '<span class="tx">That shop is in a test space — it can’t be your party here.</span></div>';
      body += cb.map(function (e) { return '<div class="result"><span class="k">On ChitBridge — is this them?</span><span><span class="nm">' + esc(e.display_name) + '</span><br><span class="s mono">' + esc(e.user_id) + '</span><span class="s"> · ' + esc(e.city) + '</span></span><button type="button" class="act sm">Add</button>' + roles() + '</div>'; }).join('');
      if (at) body += '<div class="banner amber">' + svg('warn') + '<span class="tx">Use their User ID or e-mail to find them on ChitBridge.</span></div>';
      else body += '<div class="result"><span class="k">Not on ChitBridge</span><span><span class="nm">Add “' + esc(q) + '” as a local party</span><br><span class="s">Bills are yours only until they join.</span></span><button type="button" class="act sm ghost">Add as local</button>' + roles() + '</div>';
    }
    return modal('Add party', 'One field — we look on ChitBridge and in your parties first.', body, '<span class="grow"></span><a class="act quiet" href="' + href('/parties') + '">Cancel</a>', 'narrow', href('/parties'));
  }

  /* ═════ 2 · THE PARTY RECORD ═════ */
  function idBlock(p) {
    var cell = function (k, v, none) { return '<div class="c"><div class="k">' + k + '</div><div class="v' + (v ? '' : ' none') + '">' + (v ? esc(v) : esc(none)) + '</div></div>'; };
    if (p.kind === 'walk-in') return '<div class="idblk local"><div class="verdict off" style="border-top:0">' + svg('walk') + '<span>Walk-in — known by phone at the counter. A party number comes when you add them.</span></div></div>';
    var on = p.on_chitbridge;
    var why = p.why_not === 'inactive' ? 'Account inactive — bills are yours only.' : p.why_not === 'other_population' ? 'Test space — bills are yours only.' : 'Not on ChitBridge — bills are yours only.';
    return '<div class="idblk' + (on ? '' : ' local') + '">' + cell('Party no', p.party_no, '—') + cell('User ID', on || p.why_not === 'inactive' ? p.user_id : null, 'none — kept by you') + cell('ChitBridge ID', on || p.why_not === 'inactive' ? p.bridge_id : null, '—')
      + (on ? '<div class="verdict on">' + svg('link') + '<span><b>On ChitBridge</b> — bills, orders and messages reach them in their app.</span></div>'
        : '<div class="verdict off">' + svg('house') + '<span>' + why + '</span>' + (canEdit() ? (isOwner() ? '<button type="button" class="act sm ghost">' + svg('link') + 'Link to ChitBridge</button>' : '') + '<button type="button" class="act sm ghost">Invite</button>' : '') + '</div>')
      + '</div>';
  }
  function nextBlock(p, rec) {
    var items = [], ed = canEdit();
    var btn = function (t, pri) { return ed ? '<button type="button" class="act sm' + (pri ? '' : ' ghost') + '">' + t + '</button>' : ''; };
    (rec.followups || []).forEach(function (f) {
      if (!f.late && dayDiff(f.due_at) > 0) return;
      items.push('<div class="nx"><span class="ic">' + svg('clock') + '</span><span class="tx"><b>' + (f.late ? 'Late since ' + dShort(f.due_at) : 'Today ' + tShort(f.due_at)) + '</b> · ' + esc(f.what) + '<span class="s">' + esc(f.assignee_name || 'Unassigned') + '</span></span><span class="btns">' + btn(svg('check') + 'Done', true) + btn('Snooze') + '</span></div>');
    });
    if (p.unread) items.push('<div class="nx"><span class="ic blue">' + svg('msg') + '</span><span class="tx"><b>' + plural(p.unread, 'unread message') + '</b> from ' + esc(p.display_name) + '</span><span class="btns"><a class="act sm" href="' + href('/party/' + routeKey(p) + '/timeline', 'f=messages') + '">Open</a></span></div>');
    if (ledgerOn() && p.dues_overdue) {
      var owes = p.balance_minor > 0;
      items.push('<div class="nx"><span class="ic">' + svg('pay') + '</span><span class="tx"><b>' + (owes ? 'Late dues' : 'You are late paying') + '</b> · oldest since ' + dShort(p.oldest_due) + '</span><span class="btns">' + (owes ? btn('Remind') + btn('Receive payment', true) : btn('Pay', true)) + '</span></div>');
    }
    var mine = (p.tax_ids || []).filter(function (t) { return t.scheme === 'GSTIN'; })[0];
    if (rec.gstn_profile && mine && rec.gstn_profile !== mine.value) items.push('<div class="nx"><span class="ic">' + svg('warn') + '</span><span class="tx"><b>GSTIN differs from their profile</b><span class="s mono">Yours ' + esc(mine.value) + ' · theirs ' + esc(rec.gstn_profile) + '</span></span><span class="btns">' + btn('Use theirs') + btn('Keep mine') + '</span></div>');
    if (rec.mail_bounced) items.push('<div class="nx"><span class="ic red">' + svg('mail') + '</span><span class="tx"><b>Mail bounced</b> · ' + esc(rec.mail_bounced.to) + '<span class="s">' + esc(when(rec.mail_bounced.at)) + ' — check the address</span></span><span class="btns">' + btn('Fix address', true) + '</span></div>');
    if (p.kind !== 'walk-in' && !(rec.contacts.phones.length || rec.contacts.emails.length)) items.push('<div class="nx"><span class="ic">' + svg('phone') + '</span><span class="tx"><b>No phone or e-mail yet</b></span><span class="btns">' + btn('Add', true) + '</span></div>');
    if (!items.length) return '';
    return '<section class="next" aria-label="Next"><div class="nh">Next</div>' + items.join('') + '</section>';
  }
  function mailBlocked(p, rec) {
    var e = (rec.prefs || []).filter(function (x) { return x.channel === 'email'; })[0];
    if (e && e.allowed === false) return 'They asked not to be mailed';
    if (!rec.contacts.emails.length) return 'No e-mail yet';
    return '';
  }
  function actionBar(p, rec) {
    if (!canEdit()) return '';
    var k = routeKey(p), mb = mailBlocked(p, rec), hasPhone = rec.contacts.phones.length;
    var primary, inline = [], moreItems = [];
    var mailBtn = '<a class="act ghost" href="' + href('/party/' + k + '/mail') + '">' + svg('mail') + 'Mail</a>';
    if (p.kind === 'walk-in') primary = '<button type="button" class="act">' + svg('plus') + 'Add to my parties</button>';
    else if (p.on_chitbridge) { primary = '<button type="button" class="act">' + svg('msg') + 'Message</button>'; if (!mb) inline.push(mailBtn); if (hasPhone) inline.push('<a class="act ghost" href="#" onclick="return false">' + svg('phone') + 'Call</a>'); }
    else if (hasPhone) { primary = '<a class="act" href="#" onclick="return false">' + svg('phone') + 'Call</a>'; if (!mb) inline.push(mailBtn); }
    else if (!mb) primary = '<a class="act" href="' + href('/party/' + k + '/mail') + '">' + svg('mail') + 'Mail</a>';
    else primary = '<a class="act" href="' + href('/party/' + k + '/edit') + '">' + svg('plus') + 'Add phone or e-mail</a>';
    var log = '<a class="act quiet" href="' + href('/party/' + k + '/log') + '">' + svg('note') + 'Log</a>';
    var wide = inline.concat(p.kind === 'walk-in' ? [] : ['<a class="act quiet" href="' + href('/followups/add', 'party=' + k) + '">' + svg('clock') + 'Follow-up</a>', '<a class="act quiet" href="' + href('/party/' + k + '/edit') + '">' + svg('pencil') + 'Edit</a>']);
    moreItems.push('<button type="button" class="narrow-only">' + svg('clock') + 'Follow-up</button>', '<button type="button" class="narrow-only">' + svg('pencil') + 'Edit</button>');
    if (mb) moreItems.push('<button type="button" disabled title="' + esc(mb) + '">' + svg('mail') + 'Mail<span class="why">' + esc(mb) + '</span></button>');
    else if (inline.indexOf(mailBtn) >= 0) moreItems.push('<button type="button" class="narrow-only">' + svg('mail') + 'Mail</button>');
    if (p.kind !== 'walk-in') moreItems.push('<button type="button">' + svg('bill') + 'Send statement</button>');
    if (p.roles.length === 1 && p.kind !== 'walk-in') moreItems.push('<button type="button">' + svg('plus') + (p.roles[0] === 'customer' ? 'Also a supplier' : 'Also a customer') + '</button>');
    if (isOwner() && p.kind !== 'walk-in') {
      moreItems.push('<hr>', '<button type="button">' + svg('dup') + 'Merge…</button>');
      if (!p.on_chitbridge) moreItems.push('<button type="button">' + svg('link') + 'Link to ChitBridge</button>');
      moreItems.push('<button type="button">' + svg('user') + 'Export vCard</button>');
      var open = ledgerOn() && p.balance_minor;
      moreItems.push('<button type="button" class="danger"' + (open ? ' disabled' : '') + '>' + svg('x') + 'Remove from my parties' + (open ? '<span class="why">dues open</span>' : '') + '</button>');
    }
    return '<div class="actbar pin" role="toolbar" aria-label="Actions">' + primary + wide.map(function (h) { return h.replace('class="act', 'class="wide-only act'); }).join('') + log
      + '<span class="more"><button type="button" class="act quiet" data-menu="more" aria-haspopup="true" style="width:100%">' + svg('dots') + 'More</button>' + (UI.menu === 'more' ? '<div class="menu">' + moreItems.join('') + '</div>' : '') + '</span></div>';
  }

  /* one timeline entry — mark · line · by · when · chip (REQUIREMENT-timeline §4) */
  var KIND = {
    chit: ['chit', 'chit', 'Chit'], message: ['msg', 'chit', 'Message'], message_internal: ['msg', '', 'Internal'], bill: ['bill', 'bill', 'Bill'], payment: ['pay', 'bill', 'Payment'],
    dispute: ['flag', 'dispute', 'Dispute'], call: ['phone', '', 'Call'], visit: ['pin', '', 'Visit'], whatsapp: ['wa', '', 'WhatsApp'], note: ['note', '', 'Note'],
    mail: ['mail', 'mail', 'Mail'], followup: ['clock', 'followup', 'Follow-up'], change: ['pencil', '', 'Change'], link: ['link', 'link', 'Linked']
  };
  var LONG = 110;
  function entryHTML(e, opts) {
    var k = KIND[e.kind] || KIND.note, open = UI.tlOpen[e.id], long = e.line.length > LONG && /call|visit|whatsapp|note/.test(e.kind);
    var line = long && !open ? e.line.slice(0, e.line.lastIndexOf(' ', LONG)) + '…' : e.line;
    var unread = e.thread && e.thread.unread;
    var dir = e.direction === 'in' ? '<span class="them">' + svg('inArrow') + 'they called</span>' : e.direction === 'out' ? '' : '';
    var meta = (e.theirs ? '<span class="them">' + svg('inArrow') + esc(e.by) + '</span>' : '<span>' + esc(e.by) + '</span>')
      + dir + '<span>· ' + esc(tShort(e.at)) + '</span>'
      + (e.kind === 'message_internal' ? '<span class="int">internal</span>' : '')
      + (e.thread && e.thread.count > 1 ? '<span class="more-lines">+' + (e.thread.count - 1) + ' more</span>' : '')
      + (e.is_new ? '<span class="tag blue">New</span>' : '');
    var side = (e.amount_minor != null ? '<span class="amt">' + money(e.amount_minor, e.currency) + '</span>' : '')
      + (e.state ? '<span class="tag ' + (e.state.tone || '') + '">' + (e.state.tone === 'red' ? svg('flag') : e.state.tone === 'amber' ? svg('clock') : e.state.tone === 'green' ? svg('check') : '') + esc(e.state.word) + '</span>' : '')
      + (e.fix && canEdit() && !(opts && opts.head) ? '<span class="act sm ghost" role="button">' + esc(e.fix) + '</span>' : '');
    return '<button type="button" class="ev' + (unread ? ' unread' : '') + (e.theirs ? ' theirs' : '') + (e.kind === 'change' ? ' changed' : '') + '" data-ev="' + esc(e.id) + '" data-kind="' + esc(e.kind) + '">'
      + '<span class="mk ' + k[1] + '" title="' + esc(k[2]) + '">' + svg(k[0]) + '</span>'
      + '<span class="body"><span class="ln">' + (unread ? '<span class="udot" title="Unread"></span>' : '') + '<span class="sr-only">' + esc(k[2]) + ': </span><span class="txt">' + esc(line) + '</span>'
      + (long ? ' <span class="link-btn" style="min-height:0;padding:0">' + (open ? 'Show less' : 'Show all') + '</span>' : '') + '</span>'
      + '<span class="meta">' + meta + '</span></span>'
      + '<span class="evside">' + side + '</span></button>';
  }
  function entriesHTML(list, opts) {
    var out = [], last = null;
    list.forEach(function (e) {
      if (e.kind === 'link') { out.push('<div class="tl-day link">' + svg('link') + 'Linked to ChitBridge · ' + esc(dShort(e.at)) + '</div>'); last = 'link'; return; }
      var d = dayWord(e.at); if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) /.test(d)) d = dShort(e.at);
      if (d !== last && last !== 'link') out.push('<div class="tl-day">' + esc(d) + '</div>');
      else if (last === 'link') out.push('<div class="tl-day">' + esc(d) + '</div>');
      last = d; out.push(entryHTML(e, opts));
    });
    return out.join('');
  }
  var TLF = [['all', 'All', null], ['messages', 'Messages', ['message', 'message_internal', 'chit', 'dispute']], ['bills', 'Bills', ['bill', 'payment']], ['notes', 'Notes & calls', ['call', 'visit', 'whatsapp', 'note']], ['mail', 'Mail', ['mail']], ['followups', 'Follow-ups', ['followup']]];
  function tlEntries(p) {
    var t = timelineOf(p), f = TLF.filter(function (x) { return x[0] === UI.tlFilter; })[0], q = UI.tlQ.trim().toLowerCase();
    var list = t.entries.filter(function (e) { return (!f || !f[2] || f[2].indexOf(e.kind) >= 0 || (e.kind === 'link')) && (!q || e.line.toLowerCase().indexOf(q) >= 0) && (e.kind !== 'change' || isOwner()); });
    if (R.q.state === 'arrive' && p.on_chitbridge) list = [{ id: 'new1', kind: 'message', at: D.now, by: 'Ravi K (Chola)', theirs: true, line: 'Sent the NEFT reference — UTR 2610 0233 9917.', thread: { unread: true, count: 4 }, is_new: true }].concat(list);
    return list;
  }

  function recSection(key, title, fact, body, defOpen) {
    var open = UI.recOpen[key] != null ? UI.recOpen[key] : defOpen;
    return '<div class="rs"><button type="button" class="rs-h" data-rs="' + key + '" aria-expanded="' + open + '"><svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="' + I.chev + '"/></svg><span class="t">' + esc(title) + '</span><span class="fact">' + (fact || '') + '</span></button>'
      + (open ? '<div class="rs-b">' + body + '</div>' : '') + '</div>';
  }
  var PREF = { chitbridge: 'ChitBridge', email: 'E-mail', whatsapp: 'WhatsApp', phone: 'Phone', sms: 'SMS' };
  function prefRow(x) {
    var ans = x.allowed === true ? '<span class="tag green">' + svg('check') + 'Allowed</span>' : x.allowed === false ? '<span class="tag red">' + svg('x') + 'Not allowed</span>' : '<span class="tag">Not recorded</span>';
    return '<div class="pref"><b style="min-width:84px">' + PREF[x.channel] + '</b>' + ans + (x.allowed != null ? '<span class="hint">' + (x.purpose === 'marketing' ? 'service + offers' : 'service only') + ' · ' + (x.basis === 'consent' ? 'they agreed' : 'they buy/sell with you') + ' · since ' + dShort(x.noted_at) + '</span>' : '') + (isOwner() && x.allowed === false ? '<button type="button" class="act sm ghost">Change preference</button>' : '') + '</div>';
  }
  function recordHTML(p, opts) {
    var rec = recordOf(p), k = routeKey(p), st = R.q.state;
    var hdr = '<div class="rec-head">'
      + '<div class="row1"><a class="dback" href="' + href('/parties') + '">' + svg('back') + 'Parties</a></div>'
      + '<div class="row1"><div style="min-width:0"><h2>' + esc(p.display_name) + '</h2>' + (p.legal_name && p.legal_name !== p.display_name ? '<div class="legal">' + esc(p.legal_name) + '</div>' : '') + '</div>'
      + '<a class="closex" href="' + href('/parties') + '" aria-label="Close">' + svg('x') + '</a></div>'
      + '<div class="chips">' + roleChips(p) + railChip(p) + dueChip(p) + segChip(p) + '</div></div>';
    var merged = opts && opts.mergedFrom ? '<div class="banner blue">' + svg('dup') + '<span class="tx">Merged from ' + esc(opts.mergedFrom) + '</span></div>' : '';
    if (st === 'error') return '<div class="rec">' + hdr + '<div class="card bad" role="alert"><h2>Couldn’t open this party.</h2><p>Try again.</p><button type="button" class="act">Try again</button></div></div>';
    if (st === 'loading') return '<div class="rec">' + hdr + '<div class="loadwrap"><span class="spin"></span>Reading data…</div>' + [80, 60, 70, 45].map(function (w) { return '<span class="skel" style="width:' + w + '%"></span>'; }).join('') + '</div>';

    var t = timelineOf(p), head5 = tlEntries(p).slice(0, 5);
    var tlBody = st === 'tlerror' ? '<div class="banner red">' + svg('warn') + '<span class="tx">Couldn’t load the history. Try again.</span><button type="button" class="act sm ghost">Try again</button></div>'
      : head5.length ? '<div class="tl">' + entriesHTML(head5, { head: true }) + '</div><div class="listend" style="justify-content:flex-start;padding-left:0"><a class="act sm ghost" href="' + href('/party/' + k + '/timeline') + '">See all ' + t.counts.all + '</a>' + (canEdit() ? '<a class="act sm quiet" href="' + href('/party/' + k + '/log') + '">' + svg('note') + 'Log a call or note</a>' : '') + '</div>'
      : '<div class="empty" style="padding:18px 0"><p>Nothing yet with this party.</p>' + (canEdit() ? '<a class="act sm ghost" href="' + href('/party/' + k + '/log') + '">Log a call or note</a>' : '') + '</div>';

    var c = rec.contacts;
    var who = '<dl class="kv">'
      + '<dt>Phone</dt><dd>' + (c.phones.length ? c.phones.map(function (x) { return '<a href="#" onclick="return false" class="mono">' + esc(x) + '</a>'; }).join('<br>') : '<span class="s">none</span>') + '</dd>'
      + '<dt>E-mail</dt><dd>' + (c.emails.length ? c.emails.map(function (x) { var b = rec.mail_bounced && rec.mail_bounced.to === x; return esc(x) + (b ? ' <span class="tag amber">' + svg('warn') + 'bounced</span>' : ''); }).join('<br>') : '<span class="s">none</span>') + '</dd>'
      + '<dt>Address</dt><dd>' + (c.address ? esc(c.address) : '<span class="s">not given</span>') + '</dd>'
      + '</dl>' + (rec.prefs.length ? '<div class="subhead">May we contact them?</div><div class="prefs">' + rec.prefs.map(prefRow).join('') + '</div>' : '');
    var g = (p.tax_ids || []).filter(function (x) { return x.scheme === 'GSTIN'; })[0];
    var STATE = { '33': 'Tamil Nadu', '29': 'Karnataka' };
    var terms = function (role, r) { return r ? '<dt>As ' + role + '</dt><dd>' + (r.credit_days == null ? '<span class="s">no terms set</span>' : r.credit_days === 0 ? 'Cash — no credit' : r.credit_days + ' days' + (r.credit_limit_minor ? ' · limit ' + money(r.credit_limit_minor, 'INR') : '')) + '</dd>' : ''; };
    var tax = '<dl class="kv">'
      + '<dt>Tax IDs</dt><dd>' + ((p.tax_ids || []).length ? p.tax_ids.map(function (x) { return '<span class="hint">' + esc(x.scheme) + '</span> <span class="mono">' + esc(x.value) + '</span>'; }).join('<br>') : '<span class="s">none</span>') + (rec.gstn_profile && !g ? '<br><span class="mono">' + esc(rec.gstn_profile) + '</span> <span class="s">from their profile</span>' : '') + '</dd>'
      + '<dt>State</dt><dd>' + (p.state_code ? esc(STATE[p.state_code] || p.state_code) + ' (' + esc(p.state_code) + ')<br><span class="s">' + (p.supply_type === 'intra' ? 'Same state as you — CGST + SGST' : p.supply_type === 'inter' ? 'Another state — IGST' : '') + '</span>' : '<span class="s">not set</span>') + '</dd>'
      + terms('customer', rec.customer) + terms('supplier', rec.supplier) + '</dl>'
      + (canEdit() ? '<a class="act sm ghost" style="margin-top:10px" href="' + href('/party/' + k + '/edit') + '">' + svg('pencil') + 'Edit tax & terms</a>' : '');
    var cu = rec.customer, cust = cu ? '<dl class="kv">'
      + '<dt>Bills</dt><dd><span class="mono">' + cu.txn_count + '</span> · last ' + esc(when(cu.last_bill_at)) + '</dd>'
      + '<dt>Customer since</dt><dd>' + esc(dShort(cu.since)) + ' · added ' + esc({ counter: 'at the counter', storefront: 'from your shop page', handle: 'by User ID', name: 'by name' }[cu.added_via] || cu.added_via) + '</dd>'
      + (p.kind !== 'walk-in' ? '<dt>Segment</dt><dd>' + (segChip(p) || '<span class="s">none</span>') + (canEdit() ? ' <button type="button" class="link-btn">Change</button>' : '') + '</dd>'
        + '<dt>Groups</dt><dd>' + ((cu.groups || []).map(function (x) { return '<span class="tag">' + esc(x) + '</span>'; }).join(' ') || '<span class="s">none</span>') + (canEdit() ? ' <button type="button" class="link-btn">Add to group</button>' : '') + '</dd>' : '')
      + '<dt>Points</dt><dd>' + (rec.points ? '<span class="mono">' + rec.points.balance + '</span> · ' + esc(rec.points.programme) : '<span class="s">none</span>') + '</dd></dl>' : '';
    var su = rec.supplier, sup = su ? '<dl class="kv">'
      + '<dt>Category</dt><dd>' + esc(su.category) + (su.preferred ? ' <span class="tag green">' + svg('star') + 'Preferred</span>' : '') + '</dd>'
      + '<dt>You buy</dt><dd>' + (su.supply_kind === 'own_use' ? 'For your own use' : 'To resell') + '</dd>'
      + '<dt>Catalogue</dt><dd>' + (su.catalogue ? '<button type="button" class="link-btn" style="padding:0">Open their catalogue</button>' : '<span class="s">only on ChitBridge</span>') + '</dd>'
      + '<dt>Availability</dt><dd><span class="s">can’t tell — not built yet</span></dd></dl>'
      + (su.notes ? '<div class="subhead">Note (pinned)</div><div class="note-pin">' + esc(su.notes) + '</div>' : '') : '';
    var ledger = ledgerOn()
      ? (p.balance_minor == null ? '<p class="hint">No dues — a walk-in pays at the counter.</p>' : '<table class="mini"><tbody>'
        + (t.entries.filter(function (e) { return e.kind === 'bill' || e.kind === 'payment'; }).slice(0, 4).map(function (e) { return '<tr><td class="d">' + esc(dShort(e.at)) + '</td><td>' + esc(e.line) + '</td><td class="r">' + money(e.amount_minor, e.currency) + '</td></tr>'; }).join('') || '<tr><td>No bills yet.</td></tr>')
        + '</tbody></table><div class="actbar" style="margin-top:10px"><button type="button" class="act sm ghost">Open statement</button>' + (canEdit() && p.balance_minor ? '<button type="button" class="act sm">' + (p.balance_minor > 0 ? 'Receive payment' : 'Pay') + '</button>' : '') + '</div>')
      : '<div class="offline-line">Dues show when CB Accounts is on.' + (isOwner() ? '<button type="button" class="act sm ghost">Switch on</button>' : '') + '</div>';
    var changes = (rec.changes || []).length ? '<table class="mini"><tbody>' + rec.changes.map(function (x) { return '<tr><td class="d">' + esc(dShort(x.at)) + '</td><td>' + esc(x.line) + '<br><span class="hint">' + esc(x.by) + '</span></td><td class="r">' + (x.undo ? '<button type="button" class="act sm ghost">Undo</button>' : '') + '</td></tr>'; }).join('') + '</tbody></table>' : '<p class="hint">No changes yet.</p>';

    var g1 = g ? '<span class="mono">' + esc(g.value) + '</span>' : (p.state_code ? esc(STATE[p.state_code]) : '');
    var secs = recSection('tl', 'Timeline', t.counts.all ? plural(t.counts.all, 'entry', 'entries') : '', tlBody, true)
      + recSection('who', 'Who & contact', '', who, true)
      + (p.kind === 'walk-in' ? '' : recSection('tax', 'Tax & terms', g1, tax, false))
      + (cu ? recSection('cus', 'Customer', plural(cu.txn_count, 'bill') + (rec.points ? ' · ' + rec.points.balance + ' points' : ''), cust, p.roles.length === 1) : '')
      + (su ? recSection('sup', 'Supplier', esc(su.category) + (su.preferred ? ' · preferred' : ''), sup, p.roles.length === 1) : '')
      + recSection('led', 'Ledger', ledgerOn() ? 'statement' : 'off', ledger, false)
      + (isOwner() && p.kind !== 'walk-in' ? recSection('chg', 'History of changes', (rec.changes || []).length ? plural(rec.changes.length, 'change') : '', changes, false) : '');
    return '<div class="rec">' + hdr + merged + idBlock(p) + nextBlock(p, rec) + actionBar(p, rec) + '<div class="secs">' + secs + '</div></div>';
  }

  /* ═════ 3 · THE TIMELINE (full view of the record) ═════ */
  function timelineHTML(p) {
    var t = timelineOf(p), k = routeKey(p), st = R.q.state, list = tlEntries(p);
    var chips = TLF.filter(function (f) { return f[0] === 'all' || t.counts[f[0]] > 0; }).map(function (f) {
      return '<button type="button" class="chip" data-tlf="' + f[0] + '" aria-pressed="' + (UI.tlFilter === f[0]) + '">' + f[1] + '<span class="n">' + t.counts[f[0]] + '</span></button>';
    }).join('');
    var body;
    if (st === 'loading') body = '<div class="loadwrap"><span class="spin"></span>Reading the history…</div>';
    else if (st === 'error' || st === 'tlerror') body = '<div class="card bad" role="alert"><h2>Couldn’t load the history.</h2><p>Try again — the rest of the record is fine.</p><button type="button" class="act">Try again</button></div>';
    else if (!t.counts.all) body = '<div class="empty"><div class="t">Nothing yet with this party.</div>' + (canEdit() ? '<a class="act" href="' + href('/party/' + k + '/log') + '">' + svg('note') + 'Log a call or note</a>' : '') + '</div>';
    else if (!list.length) body = '<div class="empty"><div class="t">Nothing matches “' + esc(UI.tlQ) + '”</div><button type="button" class="act ghost" id="tlclear">Clear search</button></div>';
    else {
      var shown = list.length, total = UI.tlFilter === 'all' && !UI.tlQ ? t.counts.all : list.length;
      body = '<div class="tl">' + entriesHTML(list) + '</div>'
        + (t.next_before && total > shown ? '<div class="listend"><button type="button" class="act sm quiet">↓ Show 50 more</button><span>' + shown + ' of ' + total + '</span></div>' : '<div class="listend">' + plural(total, 'entry', 'entries') + ' · end of history</div>');
    }
    return '<div class="rec">'
      + '<div class="rec-head"><div class="row1"><a class="link-btn" style="padding:0" href="' + href('/party/' + k) + '">' + svg('back').replace('<svg', '<svg style="width:15px;height:15px;vertical-align:-3px"') + ' ' + esc(p.display_name) + ' · ' + esc(p.party_no || '') + '</a>'
      + '<a class="closex" href="' + href('/parties') + '" aria-label="Close">' + svg('x') + '</a></div>'
      + '<div class="row1"><h2>Timeline</h2>' + (canEdit() ? '<a class="act" href="' + href('/party/' + k + '/log') + '">' + svg('note') + 'Log</a>' : '') + '</div>'
      + (p.on_chitbridge ? '' : '<div class="hint">' + railChip(p) + ' Bills, notes, calls and mail only — no chits or messages with a local party.</div>') + '</div>'
      + (t.counts.all ? '<div class="tl-tools"><label class="search" style="flex:1 1 200px">' + svg('search') + '<span class="sr-only">Search this history</span><input type="search" id="tlq" placeholder="Search this history" value="' + esc(UI.tlQ) + '"></label></div><div class="chips">' + chips + '</div>' : '')
      + body + '</div>';
  }

  /* ═════ sheets: Log · Edit — the app's modal frame ═════ */
  function modal(title, sub, body, foot, size, closeHref, extraHead) {
    return '<div class="scrim" role="presentation"><div class="modal ' + (size || '') + '" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">'
      + '<div class="mhd"><div class="t">' + title + '</div>' + (sub ? '<div class="s">' + sub + '</div>' : '') + (extraHead || '') + '<a class="x" href="' + closeHref + '" aria-label="Close">' + svg('x') + '</a></div>'
      + '<div class="mbody">' + body + '</div><div class="mfoot">' + foot + '</div></div></div>';
  }
  function sheetLog(p) {
    var kinds = ['Call', 'Visit', 'WhatsApp', 'Note'], kk = R.q.kind || 'Call';
    var body = '<div class="fld"><span class="lb">What happened?</span><div class="seg2" role="group" aria-label="Kind">' + kinds.map(function (x) { return '<button type="button" aria-pressed="' + (x === kk) + '">' + x + '</button>'; }).join('') + '</div></div>'
      + (kk !== 'Note' ? '<div class="fld"><span class="lb">Who started it?</span><div class="seg2" role="group" aria-label="Direction"><button type="button" aria-pressed="true">I did</button><button type="button" aria-pressed="false">They did</button></div></div>' : '')
      + '<div class="fld"><label class="lb" for="lgt">One line</label><textarea class="inp" id="lgt" style="min-height:90px" placeholder="What was said or agreed"></textarea></div>'
      + '<div class="fld"><label class="lb" for="lgw">When</label><input class="inp" id="lgw" type="datetime-local" value="2026-10-02T10:30" style="max-width:260px"></div>'
      + '<label class="chk inline" style="font-size:14px"><input type="checkbox"> Add a follow-up</label>';
    return modal('Log — ' + esc(p.display_name), 'It goes to the top of the timeline.', body, '<span class="grow"></span><a class="act quiet" href="' + href('/party/' + routeKey(p)) + '">Cancel</a><button type="button" class="act">Save</button>', 'narrow', href('/party/' + routeKey(p)));
  }
  var SCHEMES = ['GSTIN', 'PAN', 'TAN', 'TRN', 'VAT', 'TIN', 'CIN', 'UDYAM'];   // party-fields.js:26 — the server's list
  function sheetEdit(p) {
    var rec = recordOf(p), ids = (p.tax_ids || []).length ? p.tax_ids : [{ scheme: 'GSTIN', value: '' }];
    var row = function (t, i) { return '<div class="inline" style="flex-wrap:nowrap"><select class="fsel" aria-label="Scheme" style="flex:0 0 auto;border-radius:9px;height:42px">' + SCHEMES.map(function (s) { return '<option' + (s === t.scheme ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select><input class="inp mono" value="' + esc(t.value) + '" aria-label="' + esc(t.scheme) + ' value" style="flex:1 1 auto"><button type="button" class="closex" style="display:inline-flex;flex:0 0 auto" aria-label="Remove">' + svg('x') + '</button></div>'; };
    var dup = R.q.estate === 'dup' ? '<div class="banner red">' + svg('warn') + '<span class="tx">This GSTIN is already on P-0003 Ravi Traders.</span><a class="act sm ghost" href="' + href('/party/P-0003') + '">Open it</a>' + (isOwner() ? '<button type="button" class="act sm ghost">Merge</button>' : '') + '</div>' : '';
    var terms = function (role, r) { return r ? '<div class="fld"><span class="lb">As ' + role + ' <span class="s">credit days · limit</span></span><div class="inline" style="flex-wrap:nowrap"><input class="inp mono" value="' + (r.credit_days == null ? '' : r.credit_days) + '" style="max-width:110px" aria-label="Credit days"><input class="inp mono" value="' + (r.credit_limit_minor ? (r.credit_limit_minor / 100) : '') + '" placeholder="no limit" aria-label="Credit limit"></div></div>' : ''; };
    var body = '<div class="fld"><span class="lb">Party no</span><div class="mono" style="font-weight:600">' + esc(p.party_no || 'given when saved') + '</div></div>'
      + '<div class="fld"><label class="lb" for="ed1">Legal name</label><input class="inp" id="ed1" value="' + esc(p.legal_name || '') + '"></div>'
      + '<div class="fld"><label class="lb" for="ed2">Short name <span class="s">shown in your lists</span></label><input class="inp" id="ed2" value="' + esc(p.nickname || '') + '"></div>'
      + '<div class="fld"><span class="lb">Tax IDs</span>' + ids.map(row).join('') + '<button type="button" class="link-btn" style="align-self:flex-start">+ Add a tax ID</button></div>' + dup
      + '<div class="fld"><label class="lb" for="ed3">State</label><select class="inp" id="ed3"><option>Tamil Nadu (33)</option><option' + (p.state_code === '29' ? ' selected' : '') + '>Karnataka (29)</option><option>Kerala (32)</option></select></div>'
      + terms('customer', rec.customer) + terms('supplier', rec.supplier)
      + '<div class="fld"><label class="lb" for="ed4">Phone</label><input class="inp mono" id="ed4" value="' + esc(rec.contacts.phones[0] || '') + '"></div>'
      + '<div class="fld"><label class="lb" for="ed5">E-mail</label><input class="inp" id="ed5" value="' + esc(rec.contacts.emails[0] || '') + '"></div>';
    return modal('Edit — ' + esc(p.display_name), 'Changes are kept in the history.', body, '<span class="grow"></span><a class="act quiet" href="' + href('/party/' + routeKey(p)) + '">Cancel</a><button type="button" class="act">Save</button>', 'narrow', href('/party/' + routeKey(p)));
  }

  /* ═════ 4 · COMPOSE MAIL — the one compose, kind 'mail': To · Write · Review ═════ */
  function sheetMail(p) {
    var rec = recordOf(p), S = D.settings.mail, ms = R.q.mstate || '', k = routeKey(p);
    var step = R.q.step || 'write', steps = [['to', 'To'], ['write', 'Write'], ['review', 'Review']], si = steps.map(function (s) { return s[0]; }).indexOf(step);
    var close = href('/party/' + k);
    var rail = '<div class="cbst-rail">' + steps.map(function (s, i) { return '<a class="cbst' + (i === si ? ' now' : i < si ? ' done' : '') + '" href="' + href('/party/' + k + '/mail', 'step=' + s[0] + (ms ? '&mstate=' + ms : '')) + '" style="text-decoration:none"><span class="n">' + (i < si ? '✓' : i + 1) + '</span>' + s[1] + '</a>'; }).join('') + '</div>';
    var title = '✉️ Mail — ' + esc(p.display_name);
    var headBtn = '<button type="button" class="pill-min" title="Keep as a draft (the compose pill)" aria-label="Minimise">' + svg('min') + '</button>';
    if (ms === 'notsetup' || !S.set_up) {
      return modal(title, '', rail + '<div class="card" style="max-width:none"><h2>Mail isn’t set up yet.</h2>' + (isOwner() ? '<p>Give mail a sender name and a reply address once — then any party with an e-mail can be mailed.</p><button type="button" class="act">Set up</button>' : '<p>Ask the owner to set up mail.</p>') + '</div>', '<span class="grow"></span><a class="act quiet" href="' + close + '">Close</a>', '', close, headBtn);
    }
    var pref = (rec.prefs || []).filter(function (x) { return x.channel === 'email'; })[0];
    var prefOff = pref && pref.allowed === false;
    var marketingOk = pref && pref.allowed && pref.purpose === 'marketing';
    var tplId = ms === 'marketing' ? 'tp-4' : (UI.tpl || (p.roles.indexOf('supplier') >= 0 && p.roles.length === 1 ? 'tp-3' : 'tp-1'));
    var tpl = S.templates.filter(function (t) { return t.template_id === tplId; })[0];
    var marketingBlocked = tpl.purpose === 'marketing' && !marketingOk;
    var toAddr = ms === 'noemail' ? [] : rec.contacts.emails.filter(function (e) { return !(rec.mail_bounced && rec.mail_bounced.to === e); }).slice(0, 1);
    var ccAddr = rec.contacts.emails[1] && !(rec.mail_bounced && rec.mail_bounced.to === rec.contacts.emails[1]) ? rec.contacts.emails[1] : '';
    var from = '<div class="fromline">' + svg('mail') + '<span>Sent as <b>' + esc(S.from_name) + '</b> · replies come back here</span></div>';
    var hints = '';
    if (p.on_chitbridge) hints += '<div class="banner blue">' + svg('link') + '<span class="tx">' + esc(p.nickname || p.display_name) + ' is on ChitBridge — a message reaches them in the app.</span><button type="button" class="act sm ghost">Message instead</button></div>';
    if (ms === 'offline') hints += '<div class="banner">' + svg('wifi') + '<span class="tx">You’re offline. The draft is kept; send when you’re back.</span></div>';
    var chipFor = function (addr, off) { return '<span class="rcpt' + (off ? ' off' : '') + '"><span class="addr">' + esc(addr) + '</span><button type="button" aria-label="Remove">×</button></span>'; };
    var toField = '<div class="fld"><span class="lb">To</span><div class="rcpts">'
      + (prefOff ? chipFor(rec.contacts.emails[0], true) : toAddr.map(function (a) { return chipFor(a); }).join(''))
      + '<input aria-label="Add a recipient" placeholder="' + (toAddr.length || prefOff ? '' : 'Name or e-mail') + '"></div>'
      + (prefOff ? '<div class="rcpt-why">' + svg('x') + 'They asked not to be mailed (since ' + dShort(pref.noted_at) + ')' + (isOwner() ? '<button type="button" class="act sm ghost">Change preference</button>' : '') + '</div>' : '')
      + (ms === 'noemail' ? '<div class="banner amber">' + svg('warn') + '<span class="tx">Add an e-mail for ' + esc(p.display_name) + '</span>' + (canEdit() ? '<button type="button" class="act sm">Add e-mail</button>' : '') + '</div>' : '')
      + (rec.mail_bounced ? '<div class="hint">' + esc(rec.mail_bounced.to) + ' bounced on ' + dShort(rec.mail_bounced.at) + ' — left out.</div>' : '')
      + '</div>';
    var ccFields = '<div class="fld"><button type="button" class="link-btn" id="cctoggle" style="align-self:flex-start;padding:0" aria-expanded="' + UI.ccOpen + '">Cc, Bcc ' + (UI.ccOpen ? '▴' : '▾') + '</button></div>'
      + (UI.ccOpen ? '<div class="fld"><span class="lb">Cc <span class="s">up to 5</span></span><div class="rcpts">' + (ccAddr ? chipFor(ccAddr) : '') + '<input aria-label="Add Cc"></div></div><div class="fld"><span class="lb">Bcc <span class="s">up to 5</span></span><div class="rcpts">' + chipFor(S.reply_to) + '<input aria-label="Add Bcc"></div></div>' : '');
    var phs = ['{party.name}', '{party.no}', '{dues.total}', '{shop.name}'];
    var paint = function (s) { return esc(s).replace(/\{[a-z.]+\}/g, function (m) { return '<span class="ph">' + m + '</span>'; }); };
    var docs = (D.docs[p.party_id] || []);
    var picked = { 0: true, 1: true };
    var atts = '<div class="attl">' + (docs.length ? docs.filter(function (d, i) { return picked[i]; }).map(function (d) { return '<span class="att">' + svg(d.kind === 'statement' ? 'bill' : 'clip') + esc(d.name) + ' <span class="sz">' + esc(d.size || (d.kind === 'statement' ? 'PDF' : 'bill')) + '</span><button type="button" aria-label="Remove">×</button></span>'; }).join('') : '') + '</div>';
    var pick = '<div class="pick" role="group" aria-label="From this party">' + docs.map(function (d, i) { return '<label><input type="checkbox"' + (picked[i] ? ' checked' : '') + '><span>' + esc(d.name) + '<span class="s">' + esc(d.note || ({ bill: 'Bill', payment: 'Payment', attachment: 'From a chit' }[d.kind] || '')) + '</span></span><span class="r">' + (d.amount_minor ? money(d.amount_minor, d.currency) : esc(d.size || '')) + '</span></label>'; }).join('') + '</div>';
    var writeStep = from
      + '<div class="fld"><label class="lb" for="tpl">Template</label><select class="inp" id="tpl">' + S.templates.map(function (t) { return '<option value="' + t.template_id + '"' + (t.template_id === tplId ? ' selected' : '') + '>' + esc(t.name) + (t.purpose === 'marketing' ? ' — offers (needs their yes)' : '') + '</option>'; }).join('') + '<option value="">No template</option></select>'
      + '<div class="inline hint">Filled in when sent: ' + phs.map(function (x) { return '<span class="ph">' + x + '</span>'; }).join(' ') + '</div></div>'
      + (marketingBlocked ? '<div class="banner red">' + svg('warn') + '<span class="tx">This template is marketing — ' + esc(p.display_name) + ' hasn’t agreed to marketing mail.</span><button type="button" class="act sm ghost" data-tpl="tp-1">Use a service template</button></div>' : '')
      + '<div class="fld"><label class="lb" for="subj">Subject</label><input class="inp" id="subj" value="' + esc(tpl.subject) + '"></div>'
      + '<div class="fld"><span class="lb">Message</span><div class="fmtbar" role="toolbar" aria-label="Formatting"><button type="button" aria-label="Bold"><b>B</b></button><button type="button" aria-label="List">• —</button><button type="button" aria-label="Link">' + svg('link').replace('<svg', '<svg style="width:15px;height:15px"') + '</button></div><textarea class="inp" id="body" aria-label="Message">' + esc(tpl.body) + '</textarea></div>'
      + '<div class="fld"><button type="button" class="link-btn" id="sigtoggle" style="align-self:flex-start;padding:0" aria-expanded="' + UI.sigOpen + '">Signature ' + (UI.sigOpen ? '▴' : '▾') + '</button>' + (UI.sigOpen ? '<textarea class="inp" style="min-height:80px" aria-label="Signature">' + esc(S.signature) + '</textarea><span class="hint">Changes here are for this mail only.</span>' : '<div class="hint" style="white-space:pre-line">' + esc(S.signature.split('\n')[0]) + ' · ' + esc(S.signature.split('\n')[1].split(' · ')[0]) + '</div>') + '</div>'
      + '<div class="fld"><span class="lb">Attachments <span class="s">10 files · 6 MB each</span></span>' + atts
      + '<div class="inline"><button type="button" class="act sm quiet">' + svg('clip') + 'Attach</button>' + (docs.length ? '<button type="button" class="act sm quiet" id="picktoggle" aria-expanded="' + UI.pickOpen + '">' + svg('bill') + 'From this party</button>' : '') + '</div>'
      + (docs.length && UI.pickOpen ? pick : '') + '</div>';
    var schedVal = UI.sched || (ms === 'cap' ? '2026-10-03T09:00' : '');
    var presets = [['', 'Now'], ['2026-10-03T09:00', 'Tomorrow 9am'], ['2026-10-05T09:00', 'Monday 9am']];
    var whenField = '<div class="fld"><span class="lb">When</span><div class="presets">' + presets.map(function (x) { return '<button type="button" class="chip" data-sched="' + x[0] + '" aria-pressed="' + (schedVal === x[0]) + '">' + x[1] + '</button>'; }).join('')
      + '</div><input class="inp mono" type="datetime-local" id="schedat" value="' + esc(schedVal) + '" style="max-width:260px" aria-label="Send at"><span class="hint">' + (schedVal ? 'It waits in the queue and goes at that time.' : 'Goes as soon as you press Send.') + '</span></div>';
    var reviewStep = from + '<dl class="kv review">'
      + '<dt>To</dt><dd>' + (toAddr.map(esc).join(', ') || '<span class="s">nobody yet</span>') + '</dd>'
      + (ccAddr ? '<dt>Cc</dt><dd>' + esc(ccAddr) + '</dd>' : '')
      + '<dt>Bcc</dt><dd>' + esc(S.reply_to) + '</dd>'
      + '<dt>Subject</dt><dd>' + paint(tpl.subject) + '</dd>'
      + '<dt>Message</dt><dd style="white-space:pre-wrap">' + paint(tpl.body) + '\n\n' + esc(S.signature) + '</dd>'
      + '<dt>Attached</dt><dd>' + (docs.length ? docs.filter(function (d, i) { return picked[i]; }).map(function (d) { return esc(d.name); }).join('<br>') : '<span class="s">nothing</span>') + '</dd></dl>'
      + whenField
      + (ms === 'failed' ? '<div class="banner red">' + svg('warn') + '<span class="tx">Mail couldn’t be sent. It’s saved — try again.</span><button type="button" class="act sm">Try again</button></div>' : '')
      + (ms === 'cap' ? '<div class="banner amber">' + svg('clock') + '<span class="tx">Today’s mail limit is reached (' + S.daily_cap + '). It will go tomorrow at 9am.</span><button type="button" class="act sm">Schedule</button><a class="act sm ghost" href="' + close + '">Cancel</a></div>' : '');
    var toStep = from + toField + ccFields;
    var body = rail + hints + (step === 'to' ? toStep : step === 'review' ? reviewStep : writeStep);
    var blocked = prefOff || marketingBlocked || ms === 'offline' || ms === 'noemail' || (step !== 'to' && !toAddr.length);
    var nextS = steps[si + 1];
    var foot = '<button type="button" class="link-btn" style="color:var(--red-i)">Discard</button><span class="grow"></span>'
      + (blocked ? '<span class="msg">' + esc(prefOff ? 'They asked not to be mailed' : marketingBlocked ? 'Marketing needs their yes' : ms === 'offline' ? 'You’re offline' : 'Add a recipient') + '</span>' : '')
      + (si > 0 ? '<a class="act quiet" href="' + href('/party/' + k + '/mail', 'step=' + steps[si - 1][0] + (ms ? '&mstate=' + ms : '')) + '">‹ Back</a>' : '')
      + (nextS ? '<a class="act' + (blocked ? '" aria-disabled="true" style="opacity:.55;pointer-events:none' : '') + '" href="' + href('/party/' + k + '/mail', 'step=' + nextS[0] + (ms ? '&mstate=' + ms : '')) + '">Next: ' + nextS[1] + ' →</a>'
        : (ms === 'sending' ? '<button type="button" class="act" disabled><span class="spin" style="border-top-color:#fff"></span>Sending…</button>'
          : '<button type="button" class="act"' + (blocked || ms === 'cap' ? ' disabled' : '') + '>' + svg('mail') + (schedVal ? 'Schedule for ' + dayWord(schedVal) + ' 9:00 am' : 'Send') + '</button>'));
    return modal(title, '', body, foot, '', close, headBtn);
  }

  /* ═════ 5 · FOLLOW-UPS ═════ */
  var BUCKETS = [['late', 'Late'], ['today', 'Today'], ['week', 'This week'], ['later', 'Later']];
  var SRC = { manual: 'Manual', dues: 'Dues', interaction: 'From a call' };
  function fuScope() { return UI.fuScope || (isOwner() ? 'all' : 'mine'); }
  function fuRows() {
    var q = UI.fuQ.trim().toLowerCase(), me = role() === 'owner' ? 'athi' : 'divya';
    var rows = (R.q.state === 'empty') ? [] : D.followups.followups.slice();
    if (R.q.state === 'alldone') rows = rows.filter(function (f) { return f.bucket !== 'late' && f.bucket !== 'today'; });
    return rows.filter(function (f) {
      if (fuScope() === 'mine' && f.assignee_user_id !== me) return false;
      if (UI.fuSource && f.source !== UI.fuSource) return false;
      if (q && (f.what + ' ' + f.party_name + ' ' + f.party_no).toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(UI.fuSort === 'party' ? function (a, b) { return a.party_name.localeCompare(b.party_name); } : UI.fuSort === 'created' ? function (a, b) { return new Date(b.created_at) - new Date(a.created_at); } : function (a, b) { return new Date(a.due_at) - new Date(b.due_at); });
  }
  var FCOLS = [['Due', 'minmax(120px,150px)'], ['What', 'minmax(220px,1fr)'], ['Party', 'minmax(170px,240px)']];
  function fuRow(f) {
    var tpl = FCOLS.map(function (c) { return c[1]; }).join(' ');
    var due = f.late ? '<span class="fu late">' + svg('clock').replace('<svg', '<svg style="width:13px;height:13px;vertical-align:-2px"') + ' Late · ' + esc(dShort(f.due_at)) + '</span>'
      : '<span class="fu">' + esc(when(f.due_at)) + '</span>';
    var who = f.assignee_left ? '<span class="tag amber">' + svg('user') + 'Unassigned</span>' + (canEdit() ? ' <button type="button" class="link-btn" style="min-height:28px">Assign</button>' : '') : '<span class="sub">' + esc(f.assignee_name) + '</span>';
    var acts = canEdit() ? (f.party_removed ? '<button type="button" class="act sm ghost">Delete</button>' : '<button type="button" class="act sm ghost" data-done="' + f.followup_id + '">' + svg('check') + 'Done</button><button type="button" class="act sm quiet" data-menu="snooze-' + f.followup_id + '" aria-haspopup="true">' + svg('snooze') + 'Snooze</button>'
      + (UI.menu === 'snooze-' + f.followup_id ? '<div class="menu" style="right:0;top:auto"><button type="button">Tomorrow</button><button type="button">Next week</button><button type="button">Pick a date…</button></div>' : '')) : '';
    var party = '<div class="l1"><span class="nm">' + esc(f.party_name) + '</span><span class="pno">' + esc(f.party_no) + '</span></div>' + (f.party_removed ? '<div class="sub">No longer your party</div>' : '<div class="l2">' + (f.on_chitbridge ? '' : '<span class="tag local">' + svg('house') + 'Local</span>') + '</div>');
    return '<div class="lrow furow' + (f.late ? ' acc-late' : '') + (f.party_removed ? ' dim' : '') + '" style="grid-template-columns:' + tpl + '" data-peekfu="' + f.followup_id + '"' + (f.party_removed ? '' : ' data-open="' + esc(f.party_no) + '"') + ' tabindex="0">'
      + '<span class="lcell">' + due + '</span>'
      + '<span class="lcell"><div class="nm" style="font-weight:600">' + esc(f.what) + '</div><div class="l2" style="align-items:center">' + who + '<span class="sub">· ' + esc(SRC[f.source]) + '</span></div>'
      + '</span>'
      + '<span class="lcell">' + party + '</span>'
      + (acts ? '<span class="lcell fuacts inline" style="position:relative" data-stop="1">' + acts + '</span>' : '') + '</div>';
  }
  function screenFollowups(sheet) {
    nav('followups');
    var tools = '<label class="search">' + svg('search') + '<span class="sr-only">Search follow-ups</span><input type="search" id="fuq" placeholder="What or party" value="' + esc(UI.fuQ) + '"></label>'
      + (canEdit() ? '<a class="act" href="' + href('/followups/add') + '">' + svg('plus') + 'Add follow-up</a>' : '')
      + '<div class="chips"><div class="seg2" role="group" aria-label="Whose"><button type="button" data-scope="mine" aria-pressed="' + (fuScope() === 'mine') + '">Mine</button><button type="button" data-scope="all" aria-pressed="' + (fuScope() === 'all') + '">Everyone</button></div>'
      + '<select class="fsel" id="fusrc" aria-label="Source"><option value="">Any source</option>' + Object.keys(SRC).map(function (k) { return '<option value="' + k + '"' + (UI.fuSource === k ? ' selected' : '') + '>' + SRC[k] + '</option>'; }).join('') + '</select>'
      + '<button type="button" class="chip" id="fudone" aria-pressed="' + UI.fuDone + '">Done</button>'
      + '<select class="fsel" id="fusort" aria-label="Sort">' + [['due', 'Due'], ['party', 'Party'], ['created', 'Created']].map(function (o) { return '<option value="' + o[0] + '"' + (UI.fuSort === o[0] ? ' selected' : '') + '>Sort: ' + o[1] + '</option>'; }).join('') + '</select></div>'
      + '<div class="push"><span class="count" id="fucount"></span></div>';
    head('Follow-ups', '', R.q.state === 'error' ? '' : tools);
    var c = $('content');
    if (R.q.state === 'error') { c.innerHTML = '<div class="card bad" role="alert"><h2>Couldn’t load follow-ups.</h2><p>Try again.</p><button type="button" class="act">Try again</button></div>' + (sheet || ''); return; }
    var rows = fuRows(), body;
    var total = D.followups.followups.length;
    if ($('fucount') && R.q.state !== 'loading') $('fucount').innerHTML = '<b>' + rows.length + '</b> of <b>' + (R.q.state === 'empty' ? 0 : total) + '</b> open';
    if (R.q.state === 'loading') body = '<div class="loadwrap"><span class="spin"></span>Reading follow-ups…</div>';
    else if (R.q.state === 'empty') body = '<div class="empty"><div class="t">No follow-ups.</div><p>Add one from a party, or when you log a call.</p></div>';
    else if (UI.fuDone) body = '<div class="gsh" aria-expanded="true">Done this week<span class="n">1</span></div><div class="lrow dim" style="grid-template-columns:' + FCOLS.map(function (x) { return x[1]; }).join(' ') + '"><span class="lcell"><span class="fu">30 Sep</span></span><span class="lcell"><div class="nm">Confirm cement delivery slot</div><div class="sub">Athi · done 30 Sep</div></span><span class="lcell"><div class="l1"><span class="nm">Kaveri Cements</span><span class="pno">P-0015</span></div></span></div>';
    else {
      var head2 = '<div class="lhead" style="grid-template-columns:' + FCOLS.map(function (x) { return x[1]; }).join(' ') + '">' + FCOLS.map(function (x, i) { return '<span class="lhcell' + (i !== 1 ? ' sortable' : '') + '">' + x[0] + (i === 0 ? '<span class="sarr"> ▲</span>' : '') + '</span>'; }).join('') + '</div>';
      var nothingToday = !rows.some(function (f) { return f.bucket === 'late' || f.bucket === 'today'; });
      body = head2 + (nothingToday ? '<div class="gsh" style="cursor:default;color:var(--green-d)">' + svg('check').replace('<svg', '<svg style="width:15px;height:15px"') + 'Nothing due today</div>' : '')
        + BUCKETS.map(function (b) {
          var g = rows.filter(function (f) { return f.bucket === b[0]; }); if (!g.length) return '';
          var open = UI.fuOpen[b[0]];
          return '<button type="button" class="gsh' + (b[0] === 'late' ? ' late' : '') + '" data-fugs="' + b[0] + '" aria-expanded="' + open + '"><svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="' + I.chev + '"/></svg>' + b[1] + '<span class="n">' + g.length + '</span>' + (open ? '' : '<span class="gx">' + esc(g.map(function (f) { return f.party_name; }).join(', ')) + '</span>') + '</button>'
            + (open ? g.map(fuRow).join('') : '');
        }).join('') + '<div class="listend">' + plural(rows.length, 'follow-up') + ' · end of list</div>';
    }
    c.innerHTML = '<div class="panel solo"><div class="list">' + body + '</div></div>' + (sheet || '');
  }
  function sheetFuAdd() {
    var p = R.q.party ? partyBy(R.q.party) : partyBy('P-0003');
    var w = R.q.when || '2026-10-03';
    var presets = [['2026-10-02', 'Today'], ['2026-10-03', 'Tomorrow'], ['2026-10-09', 'Next week']];
    var body = '<div class="fld"><span class="lb">Party</span><div class="rcpts"><span class="rcpt"><span class="addr">' + esc(p.display_name) + ' · <span class="mono">' + esc(p.party_no) + '</span></span><button type="button" aria-label="Change party">×</button></span><input aria-label="Find a party" placeholder=""></div></div>'
      + '<div class="fld"><label class="lb" for="fuw">What</label><input class="inp" id="fuw" placeholder="Call back, collect, remind…" value="Confirm the October rate"></div>'
      + '<div class="fld"><span class="lb">When</span><div class="presets">' + presets.map(function (x) { return '<a class="chip" style="text-decoration:none" href="' + href('/followups/add', 'party=' + routeKey(p) + '&when=' + x[0]) + '" aria-pressed="' + (w === x[0]) + '">' + x[1] + '</a>'; }).join('') + '</div><div class="inline"><input class="inp mono" type="date" value="' + esc(w) + '" style="max-width:190px" aria-label="Date"><input class="inp mono" type="time" value="10:00" style="max-width:130px" aria-label="Time"></div></div>'
      + '<div class="fld"><label class="lb" for="fuwho">Who</label><select class="inp" id="fuwho">' + D.co_assists.map(function (u) { return '<option>' + esc(u.name) + (u.me ? ' (me)' : '') + '</option>'; }).join('') + '</select></div>';
    return modal('Add follow-up', 'A reminder for you — the party never sees it.', body, '<span class="grow"></span><a class="act quiet" href="' + href('/followups') + '">Cancel</a><button type="button" class="act">Save</button>', 'narrow', href('/followups'));
  }

  /* ═════ not in this handoff ═════ */
  function screenLater(key) {
    var names = { segments: 'Segments & groups', duplicates: 'Duplicates', import: 'Import / export', settings: 'Settings' };
    nav(key); head(names[key], '', '');
    $('content').innerHTML = '<div class="card"><h2>' + esc(names[key]) + '</h2><p>Designed in the next round (PLAN.md Phase 2 order: segments, merge, import/export, settings).</p><a class="act ghost" href="' + href('/parties') + '">Back to parties</a></div>';
  }

  /* ═════ the handoff's state switcher — not part of the product ═════ */
  var STATES = [
    ['CRM home', [['#/parties', 'Default'], ['#/parties?group=rail', 'Group rows: ChitBridge'], ['#/parties?select=1', 'Select mode'], ['#/parties?state=empty', 'Empty'], ['#/parties?state=loading', 'Loading'], ['#/parties?state=error', 'Error'], ['#/parties?state=migration', 'Migration not run (owner)'], ['#/parties?state=migration&role=editor', 'Migration not run (co-assist)'], ['#/parties?ledger=off', 'Ledger off'], ['#/parties?state=testshop', 'Test shop'], ['#/parties?role=viewer', 'Viewer'], ['#/parties/add?q=ravi', 'Add party — three result kinds'], ['#/parties/add?q=', 'Add party — empty']]],
    ['Party record', [['#/party/P-0002', 'On ChitBridge, both roles'], ['#/party/P-0003', 'Local supplier (one-sided)'], ['#/party/P-0001', 'GSTIN differs · late follow-up'], ['#/party/P-0011', 'Account inactive'], ['#/party/P-0005', 'Mail preference off'], ['#/party/walkin-9876500021', 'Walk-in'], ['#/party/P-0013', 'No contact · no history'], ['#/party/P-0008', 'Merged (opens keeper)'], ['#/party/P-0002?menu=more', 'More menu'], ['#/party/P-0002?state=loading', 'Loading'], ['#/party/P-0002?state=error', 'Error'], ['#/party/P-0002?role=viewer', 'Viewer'], ['#/party/P-0002?ledger=off', 'Ledger off'], ['#/party/P-0003/edit', 'Edit — tax IDs list'], ['#/party/P-0004/edit?estate=dup', 'Edit — duplicate GSTIN'], ['#/party/P-0003/log', 'Log a call']]],
    ['Timeline', [['#/party/P-0002/timeline', 'On ChitBridge'], ['#/party/P-0003/timeline', 'Local — empty kinds hidden'], ['#/party/P-0001/timeline', 'Linked divider'], ['#/party/P-0002/timeline?state=arrive', 'A message arrives'], ['#/party/P-0013/timeline', 'Empty'], ['#/party/P-0002/timeline?state=loading', 'Loading'], ['#/party/P-0002/timeline?state=error', 'Error']]],
    ['Compose mail', [['#/party/P-0003/mail?step=to', 'To'], ['#/party/P-0003/mail', 'Write'], ['#/party/P-0003/mail?step=review', 'Review'], ['#/party/P-0002/mail', 'On ChitBridge hint'], ['#/party/P-0003/mail?mstate=notsetup', 'Not set up (owner)'], ['#/party/P-0003/mail?mstate=notsetup&role=editor', 'Not set up (co-assist)'], ['#/party/P-0013/mail?step=to&mstate=noemail', 'No e-mail'], ['#/party/P-0005/mail?step=to', 'Preference off'], ['#/party/P-0003/mail?mstate=marketing', 'Marketing without consent'], ['#/party/P-0003/mail?step=review&mstate=sending', 'Sending'], ['#/party/P-0003/mail?step=review&mstate=failed', 'Failed'], ['#/party/P-0003/mail?step=review&mstate=cap', 'Daily cap reached'], ['#/party/P-0003/mail?mstate=offline', 'Offline']]],
    ['Follow-ups', [['#/followups', 'Default (owner: Everyone)'], ['#/followups?role=editor', 'Co-assist (Mine)'], ['#/followups/add', 'Add sheet'], ['#/followups?state=alldone', 'Nothing due today'], ['#/followups?state=empty', 'Empty'], ['#/followups?state=loading', 'Loading'], ['#/followups?state=error', 'Error']]]
  ];
  function switcher() {
    var cur = location.hash;
    $('hof').innerHTML = '<button type="button" id="hofbtn" aria-haspopup="true">Handoff · states ▾</button>' + (UI.menu === 'hof' ? '<div class="menu">' + STATES.map(function (g) { return '<div class="grp">' + g[0] + '</div>' + g[1].map(function (s) { return '<a href="' + s[0] + '"' + (s[0] === cur ? ' class="on"' : '') + '>' + esc(s[1]) + '</a>'; }).join(''); }).join('') + '</div>' : '');
  }

  /* ═════ render ═════ */
  function render() {
    parse();
    document.body.classList.toggle('shot', !!R.q.shot);
    document.body.classList.toggle('detail-open', R.parts[0] === 'party');
    if (R.q.menu && UI.menu == null) UI.menu = R.q.menu;
    if (R.q.f && UI.tlFilter === 'all') UI.tlFilter = R.q.f;
    var a = R.parts[0], sheet = '';
    $('netpill').hidden = R.q.state !== 'loading';
    if (a === 'parties') { if (R.parts[1] === 'add') sheet = sheetAdd(); screenHome(null, null); }
    else if (a === 'party') {
      var key = R.parts[1], p = partyBy(key), sub = R.parts[2];
      if (!p) { screenHome(null, '<div class="rec"><div class="card"><h2>No party ' + esc(key) + '</h2><p>It may have been removed.</p><a class="act ghost" href="' + href('/parties') + '">Back to parties</a></div></div>'); }
      else {
        var mergedFrom = D.merged[key] ? key : null;
        var detail = sub === 'timeline' ? timelineHTML(p) : recordHTML(p, { mergedFrom: mergedFrom });
        screenHome(routeKey(p), detail);
        if (sub === 'mail') sheet = sheetMail(p);
        if (sub === 'log') sheet = sheetLog(p);
        if (sub === 'edit') sheet = sheetEdit(p);
      }
    }
    else if (a === 'followups') { screenFollowups(R.parts[1] === 'add' ? sheetFuAdd() : ''); }
    else screenLater(a);
    if (sheet) $('content').insertAdjacentHTML('beforeend', sheet);
    switcher();
    document.title = 'CB CRM — ' + ($('title').textContent.replace('Sample data', '') || 'Parties');
  }

  /* ═════ events (one delegate; the real page wires the named functions instead) ═════ */
  document.addEventListener('click', function (e) {
    var t = e.target;
    var m = t.closest('[data-menu]');
    if (m) { var id = m.getAttribute('data-menu'); UI.menu = UI.menu === id ? null : id; e.stopPropagation(); return render(); }
    if (t.closest('#hofbtn')) { UI.menu = UI.menu === 'hof' ? null : 'hof'; return render(); }
    if (t.closest('.menu')) { if (t.closest('[data-col]')) { var k = t.closest('[data-col]').getAttribute('data-col'); var i = UI.cols.indexOf(k); if (i >= 0) UI.cols.splice(i, 1); else if (UI.cols.length < 3) UI.cols.push(k); render(); } return; }
    if (UI.menu && UI.menu !== 'hof') { UI.menu = null; if (R.q.menu) { location.hash = location.hash.replace(/[?&]menu=[^&]*/, ''); return; } render(); }
    var c;
    if ((c = t.closest('[data-rail]'))) { UI.f.rail = c.getAttribute('data-rail'); return render(); }
    if ((c = t.closest('[data-gs]'))) { var g = c.getAttribute('data-gs'); UI.gsOpen[g] = UI.gsOpen[g] === false; return render(); }
    if ((c = t.closest('[data-fugs]'))) { var b = c.getAttribute('data-fugs'); UI.fuOpen[b] = !UI.fuOpen[b]; return render(); }
    if ((c = t.closest('[data-rs]'))) { var r = c.getAttribute('data-rs'), was = c.getAttribute('aria-expanded') === 'true'; UI.recOpen[r] = !was; return render(); }
    if ((c = t.closest('[data-sort]'))) { UI.sort = c.getAttribute('data-sort'); return render(); }
    if ((c = t.closest('[data-sel]'))) { var s = c.getAttribute('data-sel'); UI.selected[s] = !UI.selected[s]; e.stopPropagation(); return render(); }
    if ((c = t.closest('[data-tlf]'))) { UI.tlFilter = c.getAttribute('data-tlf'); return render(); }
    if ((c = t.closest('[data-scope]'))) { UI.fuScope = c.getAttribute('data-scope'); return render(); }
    if ((c = t.closest('[data-sched]'))) { UI.sched = c.getAttribute('data-sched'); return render(); }
    if ((c = t.closest('[data-tpl]'))) { UI.tpl = c.getAttribute('data-tpl'); location.hash = location.hash.replace(/[?&]mstate=marketing/, ''); return render(); }
    if (t.closest('#fudone')) { UI.fuDone = !UI.fuDone; return render(); }
    if (t.closest('#ftoggle')) { UI.showFilters = !UI.showFilters; return render(); }
    if (t.closest('#cctoggle')) { UI.ccOpen = !UI.ccOpen; return render(); }
    if (t.closest('#sigtoggle')) { UI.sigOpen = !UI.sigOpen; return render(); }
    if (t.closest('#picktoggle')) { UI.pickOpen = !UI.pickOpen; return render(); }
    if (t.closest('#clearq')) { UI.q = ''; Object.keys(UI.f).forEach(function (k) { UI.f[k] = ''; }); return render(); }
    if (t.closest('#tlclear')) { UI.tlQ = ''; return render(); }
    if (t.closest('#showsql')) { $('sqlname').hidden = false; return; }
    if (t.closest('[data-stop]')) return;
    if ((c = t.closest('.ev'))) {
      var ev = c.getAttribute('data-ev'), kind = c.getAttribute('data-kind');
      if (/call|visit|whatsapp|note/.test(kind)) { UI.tlOpen[ev] = !UI.tlOpen[ev]; return render(); }   // gsToggle: expand in place
      if (kind === 'change') return;
      return toast(kind === 'mail' ? 'Opens the mail, read-only, with Reply' : kind === 'followup' ? 'Opens it in Follow-ups' : kind === 'dispute' ? 'Opens the dispute thread' : 'Opens the chit sheet — openChitSheet(id)');
    }
    if ((c = t.closest('[data-open]'))) { location.hash = href('/party/' + c.getAttribute('data-open')).slice(1); return; }
    if (t.closest('.scrim') && !t.closest('.modal')) { var x = document.querySelector('.mhd .x'); if (x) location.hash = x.getAttribute('href').slice(1); }
  });
  document.addEventListener('input', function (e) {
    var id = e.target.id;
    if (id === 'q') { UI.q = e.target.value; refocus('q'); }
    if (id === 'tlq') { UI.tlQ = e.target.value; refocus('tlq'); }
    if (id === 'fuq') { UI.fuQ = e.target.value; refocus('fuq'); }
    if (id === 'addq') { var v = e.target.value; history.replaceState(null, '', href('/parties/add', 'q=' + encodeURIComponent(v))); refocus('addq'); }
  });
  function refocus(id) { var pos = $(id).selectionStart; render(); var el = $(id); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (_) {} } }
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.getAttribute('data-f')) { UI.f[t.getAttribute('data-f')] = t.value; return render(); }
    if (t.id === 'sort') { UI.sort = t.value; return render(); }
    if (t.id === 'group') { location.hash = href('/parties', t.value ? 'group=' + t.value : '').slice(1); return; }
    if (t.id === 'fusrc') { UI.fuSource = t.value; return render(); }
    if (t.id === 'fusort') { UI.fuSort = t.value; return render(); }
    if (t.id === 'tpl') { UI.tpl = t.value || 'tp-1'; return render(); }
    if (t.id === 'schedat') { UI.sched = t.value; return render(); }
  });
  /* rowPeek — hover a row, see every field the fold dropped (app.html rowPeekShow) */
  document.addEventListener('mouseover', function (e) {
    var row = e.target.closest && e.target.closest('[data-peek],[data-peekfu]'), pk = $('rowpeek');
    if (!row) { pk.style.display = 'none'; return; }
    if (window.matchMedia('(hover:none)').matches) return;
    var rows;
    if (row.hasAttribute('data-peek')) {
      var p = parties().filter(function (x) { return x.party_id === row.getAttribute('data-peek'); })[0]; if (!p) return;
      var g = (p.tax_ids || []).filter(function (x) { return x.scheme === 'GSTIN'; })[0];
      rows = [['Party', esc(p.display_name) + (p.party_no ? ' · ' + esc(p.party_no) : '')], ['Roles', p.roles.map(function (r) { return ROLE[r]; }).join(' · ')], ['ChitBridge', railChip(p)], ['Last activity', esc(when(p.last_at))], ['Dues', dueChip(p)], ['Next', p.next_followup_at ? fuCell(p) : ''], ['Segment', segChip(p) + ' ' + esc(p.groups.join(', '))], ['Phone', esc(p.phone || '')], ['E-mail', esc(p.email || '')], ['GSTIN', g ? '<span class="mono">' + esc(g.value) + '</span>' : ''], ['City', esc(p.city || '')]];
    } else {
      var f = D.followups.followups.filter(function (x) { return x.followup_id === row.getAttribute('data-peekfu'); })[0]; if (!f) return;
      rows = [['Due', esc(when(f.due_at))], ['What', esc(f.what)], ['Party', esc(f.party_name) + ' · ' + esc(f.party_no)], ['Who', esc(f.assignee_name || 'Unassigned')], ['Source', SRC[f.source]], ['Created', esc(dShort(f.created_at))]];
    }
    pk.innerHTML = rows.filter(function (r) { return r[1] && String(r[1]).replace(/<[^>]*>/g, '').trim(); }).map(function (r) { return '<div class="pkr"><span class="pkk">' + r[0] + '</span><span class="pkv">' + r[1] + '</span></div>'; }).join('');
    pk.style.display = 'block';
    var b = row.getBoundingClientRect(), pb = pk.getBoundingClientRect();
    pk.style.top = Math.max(8, Math.min(b.top, innerHeight - pb.height - 12)) + 'px';
    pk.style.left = Math.max(8, Math.min(b.right + 10, innerWidth - pb.width - 12)) + 'px';
    if (b.right + 10 + pb.width > innerWidth) pk.style.left = Math.max(8, b.left + 40) + 'px', pk.style.top = Math.min(b.bottom + 4, innerHeight - pb.height - 12) + 'px';
  });
  function toast(msg) { var el = $('toast'); el.innerHTML = '<div class="toast">' + esc(msg) + '</div>'; clearTimeout(toast._t); toast._t = setTimeout(function () { el.innerHTML = ''; }, 2600); }
  $('toggleNav').addEventListener('click', function () { var s = $('side'); s.classList.toggle('collapsed'); this.setAttribute('aria-expanded', String(!s.classList.contains('collapsed'))); });
  window.addEventListener('hashchange', function () { UI.menu = null; render(); });
  render();
})();
