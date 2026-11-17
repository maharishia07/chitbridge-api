/**
 * OWNS  CBScreenId: the declared screen and sheet rows of the small apps, merged into the one register, and the one chip that shows a screen's code
 * CALLED BY  27 pages by <script src> (grep -lE 'src="/?app/screen-id.js' public/*.html index.html); CBScreenId.here / chip / popupChip / mountAttr are called by the shell,
 *            the page frame, the avatar, the bell, the chit sheet and the action-set library (grep -ln CBScreenId public/app), and by accounts, crm, finance and offer-lab-next pages
 * FLOW  page loads → DECLARED rows merge into the register → a screen or sheet calls here() → the chip draws "Name · CODE"; a tap copies the code
 * CARD  29-qa-test-tooling-ux-locale-and-design-system/screen-id
 * screen-id.js — CBScreenId: EVERY SMALL-APP SCREEN AND SHEET NUMBERED, AND THE ONE CHIP THAT SHOWS IT (round SCREEN-ID, 2026-10-14).
 *
 * Athi, 2026-10-14: *"if we have not numbered each screen it has to be numbered … if we are calling the task details from accounts, task
 * screen name should be visible in the task screen. so we know that we are calling the same function."*
 *
 * ── ONE REGISTER ── the workshop's screens are `public/app/screens.js` (CBSCREENS, generated from C:/dev/SCREENS.json by screens.cjs).
 * The small apps and the sheets were never in it. Their rows are DECLARED here (as screens.cjs declares the `_fineScreen` sub-views) and
 * MERGED into window.CBSCREENS (rows · byApp · bySheet) wherever a page loaded it, so the browser holds ONE register; screens.cjs should read DECLARED
 * below as an input; until it does, e2e/screen-id-guard.cjs keeps the two apart (no shared code, no shared prefix).
 * Codes are AAA### like every other (screens-register.cjs): assigned once, never reused. A new section or sheet kind = a new row here.
 *
 * ── ONE CHIP ── "Ledgers · BKS003": the screen's name and code, quiet, in the header; on a sheet, in the sheet's own title row — the code of
 * the screen ITSELF, never of the page that opened it: Task details shows TSK005 from CB Accounts, CB Finance and CB CRM alike. A tap copies
 * the code (for a bug report). On a phone the code alone: the name is the screen's own heading there (and the chip's aria-label).
 *
 *   CBScreenId.here(app, key)   the screen now on show (key: a section; absent → read from location.hash, else the app's first screen)
 *   CBScreenId.chip()           THE page chip — one element, moved into each repaint of a header (the bell's pattern)
 *   CBScreenId.sheetHTML(kind)  the chip for a sheet's title row (kind: task · bill · supplierbill)
 *   CBScreenId.row(app, key) · .sheet(kind) · .current() · .DECLARED · .rows · .byApp · .bySheet
 * Read by: app/shell.js (the CBShell bar) · app/page-frame.js (the skeleton's section) · app/chit-sheet.js (the sheet) ·
 * accounts.html · finance.html · crm.html (their own headers) · tools/screen-list.cjs (docs/SCREEN-LIST.md) · tools/graph (KG1 `opens`).
 */
(function (root) {
  'use strict';
  /* page: where the screen lives · key: its section (null = the page has one screen) · reach: how a person gets there */
  var DECLARED = {
    edition: 1,
    since: '2026-10-14',
    apps: [
      { app: 'home', name: 'Home', page: '/', rows: [['HOM001', null, 'Home', 'the address bar: /']] },
      {
        app: 'accounts',
        name: 'Accounts',
        page: '/accounts.html',
        hash: true,
        rows: [
          ['BKS001', 'todo', 'To do'],
          ['BKS002', 'daybook', 'Day book'],
          ['BKS003', 'ledgers', 'Ledgers'],
          ['BKS004', 'tb', 'Trial balance'],
          ['BKS005', 'pl', 'P&L'],
          ['BKS006', 'bs', 'Balance sheet'],
          ['BKS007', 'compare', 'Parallel run'],
          ['BKS008', 'receivables', 'Receivables'],
          ['BKS009', 'payables', 'Payables'],
          ['BKS010', 'dues', 'Dues', 'To do › a dues item'],
          ['BKS011', 'bills', 'Unpaid bills'],
          ['BKS012', 'cheques', 'Cheques'],
          ['BKS014', 'bank', 'Bank'],
          ['BKS015', 'lock', 'Month lock'],
          ['BKS016', 'closingstock', 'Closing stock'],
          ['BKS017', 'assets', 'Assets & depreciation'],
          ['BKS018', 'accruals', 'Accruals & recurring'],
          ['BKS019', 'gstclose', 'Tax close & pay'],
          ['BKS020', 'yearclose', 'Year close'],
          ['BKS021', 'packs', 'Packs'],
          ['BKS022', 'opening', 'Opening balances'],
          ['BKS023', 'accounts', 'Shop ledgers'],
          ['BKS024', 'movein', 'Move in'],
          ['BKS025', 'rates', 'Rates'], ['BKS026', 'overview', 'How we are doing'], ['BKS027', 'access', 'Who can see my books']
        ]
      },
      {
        app: 'finance',
        name: 'Finance',
        page: '/finance.html',
        hash: true,
        rows: [
          ['FIN001', 'collections', 'Collections'],
          ['FIN002', 'payables', 'Payables'],
          ['FIN003', 'cash', 'Cash'],
          ['FIN004', 'terms', 'Terms'],
          ['FIN005', 'repeat', 'Repeat supply'],
          ['FIN006', 'cheques', 'Cheques'],
          ['FIN007', 'returns', 'Returns'],
          ['FIN008', 'reports', 'Reports']
        ]
      } /* FIN006–007: T3-P1-MONEY · FIN008: T3-P4-ACCOUNT */,
      {
        app: 'crm',
        name: 'CRM',
        page: '/crm.html',
        hash: true,
        rows: [
          ['CRM001', 'parties', 'Parties'],
          ['CRM002', 'chits', 'Chits'],
          ['CRM003', 'followups', 'Follow-ups'],
          ['CRM004', 'leads', 'Leads', 'Parties › Leads'],
          ['CRM005', 'calls', 'Calls', 'Parties › Calls'],
          ['CRM006', 'party', 'Party', 'Parties › a party'],
          ['CRM007', 'chit', 'Chit page', 'a sheet › Open page'],
          ['CRM008', 'groups', 'Groups & segments'],
          ['CRM009', 'showcase', 'Shop window'],
          ['CRM010', 'privacy', 'Privacy']
        ]
      } /* CRM008–009: T3-P2-CRM · CRM010: T3-P3-CONSENT */,
      {
        app: 'marketing',
        name: 'Marketing',
        page: '/crm.html?app=marketing',
        hash: true,
        rows: [
          ['MKT001', 'leads', 'Leads'],
          ['MKT002', 'groups', 'Groups & segments'],
          ['MKT003', 'sent', 'Offers sent'],
          ['MKT004', 'results', 'Who came back'],
          ['MKT005', 'showcase', 'Shop window'],
          ['MKT006', 'party', 'Party', 'Leads › a party']
        ]
      } /* MKT001–006: the Marketing face of the CRM page (cap-marketing.js) - same screens, its own names and codes */,
      {
        app: 'tasks',
        name: 'Tasks & Orders',
        page: '/tasks.html',
        rows: [
          ['TSK001', 'orders_in', 'Orders in'],
          ['TSK002', 'orders_out', 'Orders out'],
          ['TSK003', 'tasks', 'Tasks'],
          ['TSK004', 'done', 'Done'],
          ['TSK006', 'disputes', 'Disputes'],
          ['TSK007', 'assist', 'Assist']
        ]
      } /* UX-93: the two sections beside the folders had no row, so the chip fell back to "Orders in" */,
      {
        app: 'settings',
        name: 'Settings',
        page: '/settings.html',
        hash: true,
        rows: [
          ['SET001', 'shop', 'Your business'],
          ['SET002', 'country', 'Country'],
          ['SET003', 'new', 'New shop', 'the sign-in window › New shop? Register'],
          /* T3-SETTINGS (INT6c): the four CB Settings sections */
          ['SET004', 'counters', 'Counters'],
          ['SET005', 'connectors', 'Connectors'],
          ['SET006', 'policy', 'Policy'],
          ['SET007', 'plan', 'Plan & usage'],
          ['SET008', 'account', 'Account'] /* SET008: T3-P4-ACCOUNT */,
          ['SET009', 'print', 'Print setup', "what prints on the bill — the bill's signature, previewed live (SET-WALK1 W27)"]
        ]
      },
      /* T3-OPS (INT6c): CB Operations — Stock + Suppliers */
      {
        app: 'operations',
        name: 'Operations',
        page: '/operations.html',
        hash: true,
        rows: [
          ['OPS001', 'stock', 'Stock'],
          ['OPS002', 'suppliers', 'Suppliers']
        ]
      },
      { app: 'employees', name: 'Employees', page: '/employees.html', rows: [['EMP001', 'people', 'People']] },
      {
        app: 'catalogue',
        name: 'Catalogue',
        page: '/catalogue.html',
        hash: true,
        rows: [
          ['CTG001', 'items', 'Items'],
          ['CTG002', 'categories', 'Categories'],
          ['CTG003', 'import', 'Import']
        ]
      },
      {
        app: 'network',
        name: 'Network',
        page: '/network.html',
        rows: [
          ['NET001', 'mine', 'My network'],
          ['NET002', 'offers', 'Offers'],
          ['NET003', 'design', 'Design']
        ]
      },
      {
        app: 'country-lab',
        name: 'Country Lab',
        page: '/country-lab.html',
        rows: [
          ['CLB001', 'compare', 'Side by side'],
          ['CLB002', 'ready', 'Where we are'],
          ['CLB003', 'countries', 'Countries'],
          ['CLB004', 'all', 'All countries']
        ]
      },
      { app: 'kyb', name: 'Know your business', page: '/know-your-business.html', rows: [['KYB001', null, 'Know your business']] },
      { app: 'documents', name: 'Documents', page: '/authority-forms.html', rows: [['DOC001', null, 'Documents']] },
      /* SHELL-ONE (2026-10-15): every page wears the frame, so every page has its code — the standards page, the storefront, the shop screen, the labs */
      {
        app: 'standards',
        name: 'Standards',
        page: '/standards.html',
        rows: [
          ['STD001', 'list', 'Standards'],
          ['STD002', 'works-with', 'Works with', '/standards.html#works-with · Home › Compatibility']
        ]
      },
      {
        app: 'storefront',
        name: 'Shop',
        page: '/shop.html',
        rows: [['SHP001', null, 'Shop', "/shop.html?s=<shop> · Home › Your online shop, or a customer's link"]]
      },
      {
        app: 'network-shop',
        name: 'Network shop',
        page: '/network-shop.html',
        rows: [['NSH001', null, 'Network shop', '/network-shop.html?bridge=<network>']]
      },
      { app: 'store', name: 'Store', page: '/store.html', rows: [['STR001', null, 'Store', '/store.html?net=<network>']] },
      {
        app: 'embed',
        name: 'Catalogue embed',
        page: '/embed.html',
        rows: [['EMB001', null, 'Catalogue embed', '/embed.html?bridge=<shop> · inside another site']]
      },
      { app: 'promo', name: 'Shop screen', page: '/promo.html', rows: [['PRM001', null, 'Shop screen', '/promo.html#key=… · the till › Shop screen']] },
      { app: 'product-lab', name: 'Product Lab', page: '/product-lab.html', rows: [['PLB001', null, 'Product Lab', '/product-lab.html · Home › Labs · its controls: pl-unit-line, pl-unit-tick, pl-uqc, pl-review-uqc, pl-next-why']] },
      {
        app: 'offer-lab',
        name: 'Offer Lab',
        page: '/offer-lab-next.html',
        rows: [
          ['OLB001', 'offer', 'Offer Lab', '/offer-lab-next.html · Home › Labs'],
          ['OLB002', 'combo', 'Combo Lab', '/offer-lab-next.html?mode=combo · Home › Labs']
        ]
      },
      {
        app: 'conversion-lab',
        name: 'Conversion Lab',
        page: '/conversion-lab.html',
        rows: [['CVL001', null, 'Conversion Lab', '/conversion-lab.html · the Country Lab']]
      },
      { app: 'network-lab', name: 'Network Lab', page: '/network-design.html', rows: [['NLB001', null, 'Network Lab', '/network-design.html · Home › Labs']] },
      { app: 'list-lab', name: 'List Lab', page: '/list-lab.html', rows: [['LLB001', null, 'List Lab', "/list-lab.html · app/list-ctl.js on a bare page, the list standard's pass mark"]] },
      { app: 'chart-sample', name: 'Chart sample', page: '/chart-sample.html', rows: [['CHS001', null, 'Chart helper sample', '/chart-sample.html · the shared chart helper in the 16 themes (REP-36)']] },
      { app: 'signin-lab', name: 'Sign-in Lab', page: '/signin-lab.html', rows: [['SLB001', null, 'Sign-in Lab', '/signin-lab.html · the one sign-in window on a bare page']] },
      { app: 'shell-lab', name: 'Shell Lab', page: '/shell-lab.html', rows: [['SHL001', null, 'Shell Lab', '/shell-lab.html · the shell on a bare page']] },
      {
        app: 'ui-standard',
        name: 'UI standard',
        page: '/ui-standard.html',
        hash: true,
        rows: [
          ['UIS001', 'components', 'Components', '/ui-standard.html · Standards › Web design'],
          ['UIS002', 'popups', 'Popups'],
          ['UIS003', 'icons', 'Icons'],
          ['UIS004', 'tokens', 'Tokens'],
          ['UIS005', 'themes', 'Across themes'],
          ['UIS006', 'meets', 'Meets the standard'],
          ['UIS007', 'before', 'Before and after']
        ]
      }
    ],
    /* SHELL-ONE: DESIGN REFERENCES — pages kept as the drawing a build was checked against, or a tool's own board. NOT customer navigation: no
       Home card, no link from a framed page; they wear no frame and carry no code. A page here that gains a customer door moves UP into apps. */
    references: [
      ['/design-mock.html', 'Design mock', 'the catalogue/row drawing the workshop was built against'],
      ['/cart-design.html', 'Cart design', "the shared cart's drawing (app/cart.js is the build)"],
      ['/storefront-design.html', 'Storefront design', "the storefront's paper prototype (shop.html is the build)"],
      ['/supplier-design.html', 'Supplier design', "the suppliers screen's paper prototype (operations.html is the build)"],
      ['/screen-gallery.html', 'Screen library', 'the gallery of screen drawings'],
      ['/lifecycle-test.html', 'Lifecycle test', "the rail's lifecycle board (a tool)"],
      ['/testing.html', 'Test board', 'the test board and its printable report (a tool)'],
      ['/intake.html', 'Intake inbox', 'the intake inbox prototype'],
      ['/iot-howitworks.html', 'IoT — how it works', 'a showcase page opened in an overlay by the workshop'],
      ['/bill-print.html', 'Bill print', 'the printed bill (a print surface, single-theme by decision)'],
      ['/offer-lab.html', 'Offer Lab (old address)', 'forwards to offer-lab-next.html'],
      ['/combo-lab.html', 'Combo Lab (old address)', 'forwards to offer-lab-next.html?mode=combo']
    ],
    /* the chit sheet (app/chit-sheet.js CBSheet) — one painter, three kinds (its sheetKind()); opened from every page that loads it */
    sheets: [
      ['TSK005', 'task', 'Task details', 'app/chit-sheet.js', 'a task, order or invoice row'],
      ['BIL001', 'bill', 'Bill', 'app/chit-sheet.js', 'a counter bill row'],
      ['BIL002', 'supplierbill', 'Supplier bill', 'app/chit-sheet.js', 'a bill received']
    ]
  };
  /* ── the merge: one register in the browser ── */
  var ROWS = [],
    BYAPP = {},
    BYSHEET = {},
    BYCODE = {};
  DECLARED.apps.forEach(function (item) {
    BYAPP[item.app] = {};
    item.rows.forEach(function (r) {
      var line = {
        code: r[0],
        key: r[1],
        screen: r[2],
        app: item.app,
        appName: item.name,
        page: item.page,
        kind: r[1] ? 'tab' : 'page',
        group: item.name,
        path: item.name + ' › ' + r[2],
        reach: r[3] || (r[1] ? item.page + (item.hash ? '#' + (item.app === 'accounts' ? '' : '/') + r[1] : '') + ' · ' + item.name + ' › ' + r[2] : item.page),
        nav: null,
        since: DECLARED.since,
        declared: true
      };
      ROWS.push(line);
      BYCODE[line.code] = line;
      BYAPP[item.app][r[1] || ''] = line.code;
    });
  });
  DECLARED.sheets.forEach(function (item) {
    var line = {
      code: item[0],
      key: item[1],
      screen: item[2],
      app: null,
      page: null,
      kind: 'sheet',
      file: item[3],
      group: 'Sheet',
      path: 'Sheet › ' + item[2],
      reach: item[4] + ' › its sheet',
      nav: null,
      since: DECLARED.since,
      declared: true
    };
    ROWS.push(line);
    BYCODE[line.code] = line;
    BYSHEET[item[1]] = line.code;
  });
  /* the workshop's register (screens.js) is its own file's global: where a page loaded it, these rows join it; this file never creates it */
  var WS = root.CBSCREENS;
  if (WS && !WS.byApp) {
    WS.rows = (WS.rows || []).concat(ROWS);
    WS.byApp = BYAPP;
    WS.bySheet = BYSHEET;
  }

  function T(s) {
    return typeof root.tx === 'function' ? root.tx(s) : s;
  }
  /* escaping: the ONE esc (app/helpers.js, loaded first by every page) */
  function hashKey() {
    try {
      return (root.location.hash || '').replace(/^#\/?/, '').split(/[/?&]/)[0];
    } catch (_) {
      return '';
    }
  }
  function row(app, key) {
    var m = BYAPP[app];
    if (!m) return null;
    var c = (key != null && m[key]) || m[hashKey()] || m[''] || null;
    if (!c) {
      var first = DECLARED.apps.filter(function (item) {
        return item.app === app;
      })[0];
      c = first && first.rows[0][0];
    }
    return c ? BYCODE[c] : null;
  }
  function sheet(kind) {
    var c = BYSHEET[kind];
    return c ? BYCODE[c] : null;
  }

  /* ── the chip: tokens only (var(--token,#fallback)); the page's own ink, so it reads at AA in every theme the page reads in ── */
  var CSS =
    '.cbsid{display:inline-flex;align-items:center;gap:5px;flex:0 0 auto;min-height:24px;padding:2px 8px;border:1px solid var(--line,#d8ccb0);border-radius:999px;' +
    'background:transparent;color:var(--ink,#2a2418);font:600 var(--fs-1,11px)/1.2 var(--sans,system-ui,sans-serif);white-space:nowrap;cursor:pointer}' +
    '.cbsid:hover{background:var(--hover,var(--panel,#f3ead7))}.cbsid:focus-visible{outline:2px solid var(--accent,#1f5f5b);outline-offset:2px}' +
    '.cbsid .cbsid-c{font-family:var(--mono,ui-monospace,monospace);letter-spacing:.02em}.cbsid:empty{display:none}' +
    '@media(max-width:700px){.cbsid .cbsid-n,.cbsid .cbsid-d{display:none}}' +
    /* CMP019 the screen's "?": a 44 px target (WCAG 2.2 2.5.8 asks 24), the glyph small inside it, at the chip's place on every screen */
    '.cbsid-help{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;min-width:44px;min-height:44px;padding:0;border:0;border-radius:999px;' +
    'background:transparent;color:var(--ink,#2a2418);font:700 calc(16px*var(--k,1))/1 var(--sans,system-ui,sans-serif);cursor:pointer}' +
    '.cbsid-help:hover{background:var(--hover,var(--panel,#f3ead7))}.cbsid-help:focus-visible{outline:2px solid var(--accent,#1f5f5b);outline-offset:-2px}' +
    'html:not([data-ids]) .cbsid,html:not([data-ids]) [data-testid="popup-code"]{display:none}' /* UX-1: a shop never sees the codes; a tester switches them on */;
  var IDS_KEY = 'cb_ids';
  /** UX-1: are screen codes shown? Only for a tester: ?ids=1 switches them on in this browser, ?ids=0 off (nothing else reads the codes but a bug report) */
  function codesOn() {
    try {
      var asked = /[?&]ids=([01])(?:&|$)/.exec(root.location.search || '');
      if (asked) root.localStorage.setItem(IDS_KEY, asked[1]);
      return root.localStorage.getItem(IDS_KEY) === '1';
    } catch (err) {
      console.warn('screen id: codes stay hidden, the browser keeps no setting', (err && err.message) || err);
      return false;
    }
  }
  function ensureCss() {
    var d = root.document;
    if (!d) return;
    if (codesOn()) d.documentElement.setAttribute('data-ids', '1');
    if (d.getElementById('cbsid-css')) return;
    var node = d.createElement('style');
    node.id = 'cbsid-css';
    node.textContent = CSS;
    (d.head || d.documentElement).appendChild(node);
  }
  function inner(r) {
    if (!r) return '';
    return (
      '<span class="cbsid-n">' +
      root.esc(T(r.screen)) +
      '</span><span class="cbsid-d" aria-hidden="true">·</span><code class="cbsid-c" translate="no">' +
      root.esc(r.code) +
      '</code>'
    );
  }
  function label(r) {
    return T(r.screen) + ' · ' + r.code + ' — ' + T('Tap to copy the screen code');
  }
  function sheetHTML(kind) {
    var r = sheet(kind);
    if (!r) return '';
    ensureCss();
    return (
      '<button type="button" class="cbsid" data-cbsid="' +
      root.esc(r.code) +
      '" data-testid="screen-id-sheet" aria-label="' +
      root.esc(label(r)) +
      '" title="' +
      root.esc(label(r)) +
      '">' +
      inner(r) +
      '</button>'
    );
  }

  var S = { app: null, key: null, el: null };
  function chip() {
    if (S.el) return S.el;
    ensureCss();
    var node = root.document.createElement('button');
    node.type = 'button';
    node.className = 'cbsid';
    node.setAttribute('data-testid', 'screen-id');
    S.el = node;
    paint();
    return node;
  }
  /* ── CMP019, the screen's "?" ── one button, in the chip's container, so it sits in the same place on every screen. It is drawn by the standard action
     set (ui.js) and shown only while HELP_TEXT (app.html, hasHelp) holds a note for this screen's code; with none it stays display:none, so adding
     help later is adding a note and nothing else. A page that does not load ui.js has no notes and no button. */
  var helpButton = { el: null };
  function pressHelp() {
    var code = current();
    if (code && typeof root.showHelp === 'function') root.showHelp(code);
  }
  function paintHelp() {
    var code = current();
    var known = !!code && typeof root.hasHelp === 'function' && root.hasHelp(code);
    if (!helpButton.el && known && root.ui && S.el && S.el.parentNode) {
      var wrap = root.document.createElement('span');
      wrap.innerHTML = root.ui.action('screenhelp', { mount: 'SHL001-U01', testid: 'screen-help', hidden: true, onPress: pressHelp });
      helpButton.el = wrap.firstChild;
      S.el.parentNode.appendChild(helpButton.el);
    }
    if (helpButton.el) helpButton.el.style.display = known ? '' : 'none';
  }
  function paint() {
    paintHelp();
    if (!S.el) return;
    var r = S.app ? row(S.app, S.key) : null;
    S.el.innerHTML = inner(r);
    if (r) {
      S.el.setAttribute('data-cbsid', r.code);
      S.el.setAttribute('aria-label', label(r));
      S.el.title = label(r);
    } else S.el.removeAttribute('data-cbsid');
  }
  if (root.addEventListener) root.addEventListener('load', paintHelp);
  function here(app, key) {
    S.app = app;
    S.key = key == null ? null : String(key);
    paint();
  }
  function current() {
    var r = S.app ? row(S.app, S.key) : null;
    return r ? r.code : null;
  }

  /** the popup-code chip (the app.html dialog chip's markup): a popover names itself with its POP code, a literal from the register; `place` is extra style */
  function popupChip(code, place) {
    return (
      '<span data-testid="popup-code" style="font-family:ui-monospace,monospace;font-size:var(--fs-1,12px);background:var(--neutral-tint,rgba(128,128,128,.16));border-radius:5px;padding:1px 6px;user-select:all;white-space:nowrap;' +
      (place || '') +
      '">' +
      root.esc(code) +
      '</span>'
    );
  }

  /** the data-cbmount attribute of a coded control in the shell, the bell or a menu: this screen's code + U1nn (nn = the component number, as the list control writes it); none until a screen is named */
  function mountAttr(component) {
    var code = current();
    return /^[A-Z]{3}[0-9]{3}$/.test(code || '') ? ' data-cbmount="' + code + '-U1' + String(component).slice(-2) + '"' : '';
  }

  /* a tap copies the code; the chip says so for a moment. A browser that refuses the clipboard: the code stays on screen to read. */
  function copied(node, ok) {
    var n = node.querySelector('.cbsid-c');
    if (!n) return; /* said on the CODE: it is the part every width shows (a phone and a list's title row hide the name) */
    /* W9: the chip says WHAT was copied and what to do with it, not a bare "Copied" — on the chip for a moment, and as a toast where the page has one */
    var was = n.textContent;
    n.textContent = T(ok ? 'Copied' : 'Not copied');
    node.setAttribute('data-copied', ok ? '1' : '0');
    var said = T(
      ok ? 'Screen code copied — paste it when you report a problem' : 'Not copied — read the code off the chip and type it when you report a problem'
    );
    node.setAttribute('data-copied-says', said);
    if (typeof root.toast === 'function') {
      try {
        root.toast(said);
      } catch (e) {
        console.warn('screen id: the toast failed', (e && e.message) || e);
      }
    }
    setTimeout(function () {
      n.textContent = was;
      node.removeAttribute('data-copied');
      node.removeAttribute('data-copied-says');
    }, 1400);
  }
  function onTap(e) {
    var node = e.target && e.target.closest ? e.target.closest('.cbsid[data-cbsid]') : null;
    if (!node) return;
    e.preventDefault();
    e.stopPropagation();
    var code = node.getAttribute('data-cbsid');
    var nav = root.navigator;
    if (!nav || !nav.clipboard || !nav.clipboard.writeText) {
      console.warn('screen id: no clipboard in this browser - the code ' + code + ' stays on the chip to read');
      copied(node, false);
      return;
    }
    nav.clipboard.writeText(code).then(
      function () {
        copied(node, true);
      },
      function (err) {
        console.warn('screen id: the browser refused the clipboard - the code ' + code + ' stays on the chip to read', (err && err.message) || err);
        copied(node, false);
      }
    );
  }
  if (root.document && root.addEventListener) {
    root.document.addEventListener('click', onTap, true);
    /* a language pack lands after the chip was painted (app/locale.js pack(): a script, no event of its own): its load repaints the name */
    root.document.addEventListener(
      'load',
      function (e) {
        var t = e.target;
        if (t && t.id && String(t.id).indexOf('cb-strings-') === 0) paint();
      },
      true
    );
    /* a hash-routed page (Finance, CRM, Settings, Accounts) moves between sections by its address: the chip follows it */
    root.addEventListener('hashchange', function () {
      if (S.app && BYAPP[S.app] && BYAPP[S.app][hashKey()]) {
        S.key = hashKey();
        paint();
      }
    });
  }

  root.CBScreenId = {
    here: here,
    chip: chip,
    sheetHTML: sheetHTML,
    row: row,
    sheet: sheet,
    current: current,
    mountAttr: mountAttr,
    popupChip: popupChip,
    DECLARED: DECLARED,
    rows: ROWS,
    byApp: BYAPP,
    bySheet: BYSHEET
  };
})(typeof window !== 'undefined' ? window : globalThis);
