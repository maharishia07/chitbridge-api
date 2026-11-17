/**
 * public/app/shell.js — CBShell: the one frame every page lives in (header, shop sheet, five areas, kural)
 * ID        HOM001 (Home's own controls); the header's popups are POP113-POP116 and its controls wear CMP codes with a mount
 * OWNER     cb-ux-locale
 * OWNS      the header and the shop sheet, the area switcher, Home's rail and tiles, the licence and edition chips
 * CALLED BY index.html (Home: CBShell.mount), shell-lab.html (the bare page) and app/page-frame.js (every other page's header, SHELL-ONE; grep -ln 'CBShell.mount' index.html public/*.html public/app/*.js); 26 pages load the script by <script src>; the avatar, the bell and the screen chip mount into its slots.
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/shell
 * RISK      personal-data
 * FLOW      mount(el, opts) → headerHTML → workHTML → slots (bell · avatar · screen chip · kural) → work into the slot
 * ── ⭐ CBShell — THE FRAME EVERY UTILITY APP LIVES IN: HEADER · SHEET · FIVE AREAS · KURAL ──────────────────────────────────────
 *
 * Plan row N17 (C:\dev\FIT-shell-enterprise-2026-10-07.md row 93, decisions §D Q1–Q10). The design is
 * C:\dev\designs-inbox\cb-shell-2026-10-07\cb-shell.html (the prototype wins over its spec); the manifest shape is
 * docs/DESIGN-NOTES-2026-10.md Part 2.4. public/shell-lab.html is this file on a bare page (the pass mark); e2e/shell.cjs proves it.
 *
 *   CBShell.mount(el, { manifest, area, host, person, apiBase, token, avatar, kural, homeHref }) → shell
 *     manifest  an object { entries:[…] } or its URL (default /app/manifest.json)
 *     area      home · selling · running · labs · setup — the area shown first (Home: also read from location.hash)
 *     host      null            → HOME: the five areas, a side rail (a phone: bottom tabs, one area at a time)
 *               { app: 'id' }   → INSIDE AN APP: the rail collapses to a switcher in the bar; the app draws in shell.slots.work
 *               { bar: true }   → THE BAR ONLY (the counter, the vendor page): mark · shop · licence · bell · avatar, nothing else
 *     person    { name, role, entity, owner, level? } (default: CBAvatar.sessionPerson()); null = signed out; level = the server's word for a
 *               login that is not the owner (editor · view-only, lib/access) — said after the shop's name (CB CRM, SHELL-ONE)
 *     apiBase · token   where /api lives, and the bearer (default: CBShell.apiBase() and the saved session's token)
 *     avatar    extra options passed straight to CBAvatar.mount (items, onSignOut, …)
 *     kural     the CBKural route (default 'planning'); false = no kural
 *     homeHref  where the switcher's areas and the ⌂ Home control point (default '/'; an area is homeHref + '#' + area).
 *               SHELL-ONE: a storefront passes the SHOP's front — "Home" there is the shop, never ChitBridge's index
 *     title     { icon, name } — the app's name in the bar for a page with no manifest entry (a lab; the storefront: the shop's name);
 *               with a manifest entry the switcher names the app itself (SHELL-ONE)
 *     fit       'pane' — the shell is a block INSIDE a page's own pane (an app with its own sidebar), not the full-window frame (SHELL-ONE)
 *   THE ONE HEADER (SHELL-ONE, 2026-10-15 — Athi: "lot of in-consistencies in each page before sign-in itself"): mark · the app's name ·
 *   the screen chip · ⌂ Home · the bell · the avatar (or "Sign in") — on EVERY page, in every mode. Nothing of it is drawn by a page.
 *   shell.slots { bell, alerts, home, work } · shell.open() · .close() · .isOpen() · .go(area) · .area() · .header() · .manifest() · .ready (Promise)
 *
 * EDITIONS (AX1): if the page loaded /app/edition.js, CBEdition decides which entries this showing draws — only those cards, their pillar boxes and
 * their areas (an area with none is not in the menu), a header chip naming the view and one line on Home saying what it is for. Without it: every entry.
 * WHAT IT READS: the manifest, GET /api/entities/header (N19: { business, licences[], trade_ready }) and each built entry's `facts`
 * URL. Nothing else. A 404 or a failure is an EMPTY STATE that says so — never a made-up number.
 * WHAT IT NEVER DOES: load an application's script (only the units CBAvatar · CBKural · CBSignin · CBBell · CBScreenId, each IF the page loaded
 * it); link into the workshop (a card with no utility page is a dashed chip, I12); decide a licence band or a penalty (the server's
 * `band` and `note` say it — a scheme rule in data, Q8); add a packaging word the plan dropped (FIT Q5).
 *
 * ONE FILE, ONE GLOBAL, its own CSS (tokens with fallbacks, so it reads in all 16 themes), words and escaping — like CBList / CBAvatar.
 * THE AVATAR IS CBAvatar, mounted, never rebuilt (DECISIONS.md "The avatar is ONE control").
 */
(function (root) {
  'use strict';
  if (root.CBShell) return;
  var doc = root.document;

  /* a page that did not load shell-facts.js (promo.html is a till copy, bar mode): no cards to read, nothing to lead */
  var NO_FACTS = {
    create: function (ctx) { return { isFirm: function () { return false; }, read: function () {}, once: ctx.get }; },
    painters: function () { var none = function () { return ''; }; return { cardState: none, factsHTML: none, trendHTML: none, lineHTML: none }; }
  };
  var W = {
    areas: { home: 'Home', selling: 'Selling', money: 'Money', running: 'Running', trade: 'Trade', labs: 'Labs', setup: 'Setup', more: 'More' },
    caption: { selling: 'Selling', money: 'Money', running: 'Running it', trade: 'Trade', labs: 'Labs', setup: 'What it all stands on' },
    sub: {
      selling: 'Sell at the counter and online, and bring customers back.',
      money: 'Who owes you, who you owe, and what the shop made.',
      running: 'Stock, suppliers, tasks and the people who do them.',
      trade: 'Check a business, file a form, grow your network.',
      labs: 'Work the number out first. Nothing changes until you say so.',
      setup: 'Set once, rarely touched.'
    },
    tag: { coming: 'later', workshop: 'workshop', works: 'works today' },
    yourShop: 'Your business',
    business: 'The business',
    licences: 'Licences',
    trade: 'Trade ready',
    finish: 'Finish the checks',
    renew: 'Renew',
    again: 'Apply again',
    notAdded: 'not added',
    registered: 'registered',
    notRegistered: 'not registered',
    days: ' days',
    years: ' years',
    expired: function (d) {
      return 'expired ' + d + 'd ago';
    },
    lapsed: 'lapsed',
    notYet: 'Licences and trade checks are not available yet.',
    loading: '…',
    noApps: 'The list of apps could not be read.',
    needsHand: 'need you',
    moreWord: 'more',
    moreTitle: function (total) {
      return 'All ' + total + ' lines of this tile'; /* UX-3: what the +n badge counts */
    },
    noShop: 'No shop yet. Add your business first.',
    signInShop: 'Sign in to open your shop.',
    factsFailed: 'Could not read',
    backToClients: 'Back to Clients',
    skip: 'Skip to content',
    state: { needs_you: 'Needs you', in_use: 'In use', not_started: 'Not started' },
    setUp: 'Set up',
    needsYou: 'Needs you',
    today: 'today',
    switcher: 'Go to',
    close: 'Close',
    vsLastYear: 'vs last year',
    salesWeeks: 'Sales, last 8 weeks' /* RPT2: the Till card's teaser */
  };
  /* one box per pillar inside a section; a manifest entry's `pillar` decides its box and so its section (none: its area's default). Walk 17 Oct (Athi): money is not
     selling — Selling · Money · Running it are pillar sections; Trade, Labs and Setup are a pillar of their own, drawn as one grid. Daily first, set-up last. */
  var PILLARS = { selling: ['marketing', 'sales'], money: ['finance', 'accounting'] };
  /* NAMES-1 (Athi, 17 Oct): "Running it" is ONE flat group of tiles, like Trade — its pillars stay on the manifest rows (so People can stand apart
     again) but draw no sub-panels. A pillar here names its section and nothing else. */
  var FLAT_PILLARS = { running: ['operations', 'people'] };
  var PNAME = {
    marketing: 'Marketing',
    sales: 'Sales',
    finance: 'Finance',
    accounting: 'Accounts',
    operations: 'Operations',
    people: 'People',
    trade: 'Trade'
  };
  var PDEFAULT = { selling: 'sales', running: 'operations', labs: 'labs', setup: 'setup' };
  var AREAS = ['home', 'selling', 'money', 'running', 'trade', 'labs', 'setup'];
  /* HOME-PHONE-BAR (19 Oct): a phone shows FIVE tabs - Home, Selling, Money, Running, More. More is a page of three rows (these areas); a laptop keeps the seven-button rail. */
  var PHONE_MORE = ['trade', 'labs', 'setup'];
  var PHONE_TABS = AREAS.filter(function (area) {
    return PHONE_MORE.indexOf(area) < 0;
  }).concat(['more']); /* the five, in order */
  function tabOf(area, onPhone) {
    return onPhone && PHONE_MORE.indexOf(area) >= 0 ? 'more' : area;
  }
  /* AU-WORDS (15 Oct): a MONEY icon is the SHOP's currency symbol — CBLocale.symbol of the header's business.currency (the pack's money) — never ₹
     for every shop (Athi on live austore1: "CB Accounts ₹"). The manifest and ICON write the neutral currency sign ¤; glyph() swaps it on paint and
     paintMoneyGlyphs() re-swaps what was painted before the header arrived. No currency known → ¤ stays. */
  var MONEY_GLYPH = '¤';
  var ICON = { home: '⌂', selling: '▤', money: MONEY_GLYPH, running: '▣', trade: '⇆', labs: '◈', setup: '⚙', more: '⋯' };

  /* a manifest entry's name and line go through the catalogue (tx, accounts-shell.js — English is the key); a page without it shows the English */
  function T(s) {
    return typeof root.tx === 'function' ? root.tx(s) : s;
  }
  /* the Home cards' read (queue · retry · one ask per URL · lead by the data · firm lazy read) and painters: shell-facts.js */
  var factsLib = root.CBShellFacts || NO_FACTS,
    cards = factsLib.painters(W, T); /* a Home card's state · facts line · trend teaser (shell-facts.js) */
  /* ⭐ the frame's words are said AGAIN when a language pack lands: every pack calls renderApp() on its way out (strings-*.js), and a page
     defines its own renderApp AFTER the frame is drawn — so the global is held behind a setter: the page's function runs, then the frame's
     resay (⌂ Home · the title · the switcher · the areas). One place; no page copies it (walk-locale: "Home" was plain English on every page). */
  var pageRender = typeof root.renderApp === 'function' ? root.renderApp : null,
    frameResay = null;
  try {
    Object.defineProperty(root, 'renderApp', {
      configurable: true,
      get: function () {
        return function () {
          if (pageRender) pageRender();
          if (frameResay) frameResay();
        };
      },
      set: function (fn) {
        pageRender = typeof fn === 'function' ? fn : null;
      }
    });
  } catch (e) {
    if (root.cbQuiet) root.cbQuiet('shell:renderApp', e);
  }
  function lsGet(k) {
    try {
      return root.localStorage.getItem(k);
    } catch (_) {
      return null;
    }
  }

  /** the API base, decided the way the pages decide it (CFG.API_BASE) — here once, so a page that mounts the shell need not copy it.
      HX1: the deploy's address is window.CB_API (/config.js, loaded first by every page) — never a host in code */
  function apiBase() {
    var f = lsGet('cb_api_base');
    if (f) return f === 'stage' ? root.CB_API || '' : f;
    var h = root.location && root.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:3000';
    return root.CB_API || '';
  }
  function session(anonymous) {
    try {
      var parsed = anonymous ? null : JSON.parse(lsGet('cb_sess') || 'null'); /* anonymous: a page that reads no stored session */
      return parsed && parsed.token ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  /* ── CSS: the prototype's, prefixed, on private tokens that fall back list names → theme names → the design's values ── */
  var CSS = [
    '.cbsh{--sh-page:var(--page,var(--paper,#FCFAF5));--sh-card:var(--card,#FFFFFF);--sh-panel:var(--panel,var(--gold-soft,#F3EFE6));',
    '--sh-line:var(--line,#DDD6C6);--sh-soft:var(--line-soft,var(--line,#E6E0D2));--sh-hair:var(--hair,var(--gold-soft,#F0ECE2));',
    '--sh-ink:var(--ink,#1D1B16);--sh-muted:var(--muted,var(--grey,#5E594D));--sh-ghost:var(--ghost,var(--grey-4,#A8A295));',
    '--sh-green:var(--green,var(--ok,#16693F));--sh-green-d:var(--green-d,var(--ok-2,#0D4A2B));--sh-green-t:var(--green-t,var(--ok-tint,#E8F4ED));--sh-green-b:var(--green-b,var(--ok-3,#A9D3BC));',
    '--sh-amber-t:var(--amber-t,var(--warn-tint,#FDF3DC));--sh-amber-b:var(--amber-b,var(--warn-3,#EFD39A));--sh-amber-i:var(--amber-i,var(--warn-2,#7A5205));',
    '--sh-red-t:var(--red-t,var(--danger-tint,#FBEAE3));--sh-red-b:var(--red-b,var(--disp-2,#E7B9A8));--sh-red-i:var(--red-i,var(--disp-2,#8E3517));',
    '--sh-blue-t:var(--blue-t,var(--blue-tint-bg,#E4EEFA));--sh-blue-b:var(--blue-b,var(--blue-tint-line,#B9D2EF));--sh-blue-i:var(--blue-i,var(--blue-d,#174A87));',
    '--sh-on:var(--on-ok,var(--on-accent,#FFFFFF));--sh-scrim:rgba(29,27,22,.32);--sh-shadow:rgba(29,27,22,.18);--sh-hover:rgba(0,0,0,.04);',
    '--sh-bar:44px;--sh-navw:58px;',
    'box-sizing:border-box;color:var(--sh-ink);font-family:var(--f-ui,"IBM Plex Sans",system-ui,sans-serif);font-size:calc(14.5px * var(--k,1));line-height:1.42;text-align:start}',
    ':root[data-themed] .cbsh{--sh-green-d:color-mix(in srgb,var(--ok-2,#0D4A2B) 80%,var(--ink,#1D1B16))}',
    '.cbsh *,.cbsh *::before,.cbsh *::after{box-sizing:border-box}',
    ':where(.cbsh) :where(button,a){font:inherit;color:inherit}:where(.cbsh) :where(button){cursor:pointer}:where(.cbsh) :where(a){text-decoration:none}',
    '.cbsh.full{position:fixed;inset:0;display:flex;flex-direction:column;background:var(--sh-page);z-index:1}',
    /* SHELL-ONE fit:"pane": the shell sits in a page's own main pane (an app with its own sidebar, a CBFrame skeleton) — a block, not the window */
    '.cbsh.pane{position:static;display:block;background:transparent;--sh-bar:55px;overflow:visible}' /* overflow: a host page's own .pane rule (Country Lab: overflow:auto) clipped the Labs menu at the header's edge (17 Oct) */ /* + its 1px line = 56: the sidebar brand row's height (page-skeleton.css .brand), so the two header lines meet (Round U rule f) */,
    '.cbsh.pane .cbsh-work:not(:has(.cbsh-signin:not(:empty))):not(:has(.cbsh-slotwork:not(:empty))){display:none}',
    /* ⌂ Home — the one way home on every page (app + bar modes); the switcher's look, so the bar has one kind of button */
    '.cbsh-tohome{display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 10px;border:1px solid var(--sh-line);border-radius:8px;background:var(--sh-card);font-size:13px;font-weight:600;white-space:nowrap}',
    '.cbsh-tohome:hover{background:var(--sh-panel)}',
    '.cbsh-title{display:inline-flex;align-items:center;gap:7px;min-width:0;font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    /* header */
    '.cbsh-hdr{flex:0 0 auto;position:relative;z-index:20;background:var(--sh-card);border-bottom:1px solid var(--sh-line)}',
    '.cbsh-bar{height:var(--sh-bar);display:flex;align-items:center;gap:10px;padding:0 14px}',
    '.cbsh-mark{width:28px;height:28px;border-radius:8px;background:var(--sh-green);color:var(--sh-on);display:grid;place-items:center;font-size:13px;font-weight:700;flex:0 0 auto}',
    '.cbsh-who{display:flex;align-items:center;gap:8px;border:0;background:none;padding:4px 9px;border-radius:8px;min-width:0}',
    '.cbsh-who:hover,.cbsh-hdr.open .cbsh-who{background:var(--sh-panel)}',
    '.cbsh-working{display:inline-flex;align-items:center;flex:0 1 auto;min-width:96px;max-width:44%;min-height:44px;padding:0 10px;border-radius:999px;border:1px solid var(--amber-b,#EFD39A);background:var(--amber-t,#FDF3DC);color:var(--amber-i,#7A5205);font-size:13px;text-decoration:none;white-space:nowrap}.cbsh-working b{overflow:hidden;text-overflow:ellipsis;font-weight:700}@media(max-width:700px){.cbsh-working{min-width:0;max-width:none;flex:1 1 0}.cbsh-working b{min-width:0}.cbsh-bar:has(.cbsh-working) .cbsh-sw{display:none}}' /* l16 R5-1: at phone width the chip replaces the area switcher and its name is cut with an ellipsis (title carries the full name): the bar held 384 px in a 326 px pane */ + '',
    '.cbsh-who b{font-family:"Bricolage Grotesque",sans-serif;font-size:16px;font-weight:800;letter-spacing:-.015em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.cbsh-who .chev{color:var(--sh-muted);font-size:10px;transition:transform .14s}',
    '.cbsh-hdr.open .cbsh-who .chev{transform:rotate(180deg)}',
    '.cbsh-grow{flex:1}',
    '.cbsh-lic:empty,.cbsh-bell:empty,.cbsh-ed:empty,.cbsh-sid:empty{display:none}.cbsh-sid{display:flex;--ink:var(--sh-ink,#14201a);--line:var(--sh-line,#d8ccb0)}',
    '.cbsh-chip{display:inline-flex;align-items:center;gap:7px;height:28px;padding:0 11px;border-radius:8px;font-size:12.5px;font-weight:600;white-space:nowrap;border:1px solid}',
    '.cbsh-chip .d{font-family:var(--f-num,"IBM Plex Mono",monospace);font-weight:700}.cbsh-chip .sm{display:none}',
    '.cbsh-chip.due{background:var(--sh-blue-t);border-color:var(--sh-blue-b);color:var(--sh-blue-i)}',
    '.cbsh-chip.soon{background:var(--sh-amber-t);border-color:var(--sh-amber-b);color:var(--sh-amber-i)}',
    '.cbsh-chip.gone{background:var(--sh-red-t);border-color:var(--sh-red-b);color:var(--sh-red-i)}',
    '.cbsh-av{flex:0 0 auto;display:flex;align-items:center}',
    /* switcher (inside an app) */
    '.cbsh-sw{position:relative}',
    '.cbsh-swb{display:flex;align-items:center;gap:7px;height:30px;padding:0 10px;border:1px solid var(--sh-line);border-radius:8px;background:var(--sh-card);font-size:13px;font-weight:600}',
    '.cbsh-swb .chev{font-size:10px;color:var(--sh-muted)}',
    '.cbsh-swpop{position:absolute;top:36px;left:0;z-index:30;min-width:180px;background:var(--sh-card);border:1px solid var(--sh-line);border-radius:11px;padding:5px;box-shadow:0 14px 28px var(--sh-shadow);display:flex;flex-direction:column;gap:2px}',
    '.cbsh-swpop[hidden]{display:none}',
    '.cbsh-swpop a{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;font-size:13.5px;font-weight:600}',
    '.cbsh-swpop a:hover{background:var(--sh-panel)}.cbsh-swpop a[aria-current]{background:var(--sh-green-t);color:var(--sh-green-d)}',
    '.cbsh-swpop .i{width:18px;text-align:center}',
    /* sheet */
    '.cbsh-sheet{position:relative;border-top:1px solid var(--sh-hair);background:var(--sh-page);max-height:max(136px,calc(20vh - var(--sh-bar)));overflow:auto}',
    '.cbsh-sheet[hidden]{display:none}',
    '.cbsh-sin{display:grid;grid-template-columns:1fr 1.55fr 1fr;gap:26px;padding:8px 18px 9px;max-width:1240px;margin:0 auto}',
    '.cbsh-col h5{margin:0 0 3px;display:flex;align-items:baseline;gap:10px;font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--sh-muted);font-weight:700}',
    '.cbsh-col h5 .why{margin-left:auto;font-size:12px;letter-spacing:0;text-transform:none;font-weight:600}',
    '.cbsh-col h5 .why.soon{color:var(--sh-amber-i)}.cbsh-col h5 .why.gone{color:var(--sh-red-i)}.cbsh-col h5 .why.due{color:var(--sh-blue-i)}',
    '.cbsh-ln{font-size:13px;line-height:1.38;color:var(--sh-muted)}.cbsh-ln.nm{font-size:14px;font-weight:700;color:var(--sh-ink)}',
    '.cbsh-ln.mono{font-family:var(--f-num,"IBM Plex Mono",monospace);color:var(--sh-ink)}',
    '.cbsh-ln.none{grid-column:2 / -1;align-self:center}',
    /* a licence row: three columns (name with its number · time left · the one button) */
    '.cbsh-lrow{display:grid;grid-template-columns:1fr 108px 92px;gap:12px;align-items:center;min-height:23px;border-bottom:1px solid var(--sh-hair);font-size:13px}',
    '.cbsh-lrow:last-child{border-bottom:0}',
    '.cbsh-lrow .nm{font-weight:600}.cbsh-lrow .no{font-family:var(--f-num,"IBM Plex Mono",monospace);font-size:11.5px;color:var(--sh-muted);margin-left:8px;font-weight:400}',
    '.cbsh-lrow .st{font-family:var(--f-num,"IBM Plex Mono",monospace);font-weight:700;font-size:12.5px;text-align:right;color:var(--sh-muted)}',
    '.cbsh-lrow .st.soon{color:var(--sh-amber-i)}.cbsh-lrow .st.gone{color:var(--sh-red-i)}.cbsh-lrow .st.due{color:var(--sh-blue-i)}.cbsh-lrow .st.ok{color:var(--sh-green-d)}',
    '.cbsh-rn{display:inline-flex;align-items:center;justify-content:center;height:32px;padding:0 10px;border-radius:7px;border:1px solid var(--sh-line);background:var(--sh-card);font-size:12px;font-weight:700}',
    '.cbsh-rn.soon{background:var(--sh-amber-t);border-color:var(--sh-amber-b);color:var(--sh-amber-i)}',
    '.cbsh-rn.due{background:var(--sh-green);border-color:var(--sh-green);color:var(--sh-on)}',
    '.cbsh-rn.gone{background:var(--sh-red-t);border-color:var(--sh-red-b);color:var(--sh-red-i)}',
    '.cbsh-checks{display:grid;grid-template-columns:1fr 1fr;gap:3px 12px}',
    '.cbsh-chk{display:flex;align-items:center;gap:7px;font-size:13px;min-height:22px}',
    '.cbsh-chk .m{width:15px;height:15px;border-radius:5px;display:grid;place-items:center;font-size:10px;font-weight:800;flex:0 0 auto}',
    '.cbsh-chk.y .m{background:var(--sh-green);color:var(--sh-on)}.cbsh-chk.n .m{background:var(--sh-panel);border:1px solid var(--sh-line)}.cbsh-chk.n{color:var(--sh-muted)}',
    '.cbsh-btn{display:inline-flex;align-items:center;height:32px;padding:0 12px;border-radius:8px;border:1px solid var(--sh-green);background:var(--sh-green);color:var(--sh-on);font-size:12.5px;font-weight:700;margin-top:7px}',
    '.cbsh-scrim{display:none}',
    /* working area */
    '.cbsh-work{flex:1 1 auto;min-height:0;display:flex}',
    '.cbsh-nav{flex:0 0 var(--sh-navw);border-right:1px solid var(--sh-line);background:var(--sh-panel);display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 0}',
    '.cbsh-nv{width:46px;border:0;background:none;border-radius:10px;padding:7px 0 5px;display:flex;flex-direction:column;align-items:center;gap:2px;color:var(--sh-muted)}',
    '.cbsh-nv .i{font-size:17px;line-height:1}.cbsh-nv .t{font-size:10px;font-weight:600;letter-spacing:.01em}',
    '.cbsh-nv:hover{background:var(--sh-hover)}.cbsh-nv[hidden]{display:none}',
    '.cbsh-nv[aria-current]{background:var(--sh-card);color:var(--sh-green-d);box-shadow:0 0 0 1px var(--sh-line)}.cbsh-nv[aria-current] .i{color:var(--sh-green)}',
    '.cbsh-skip{position:absolute;inset-inline-start:8px;top:-60px;z-index:2000;padding:10px 16px;border-radius:8px;background:var(--ink,#1D1B16);color:var(--card,#fff);font-weight:700;text-decoration:none}.cbsh-skip:focus{top:8px}',
    '.cbsh-main{flex:1 1 auto;min-width:0;overflow-y:auto;overflow-x:hidden;scroll-behavior:smooth;scrollbar-width:thin;scrollbar-color:var(--sh-line) transparent}',
    '.cbsh-inner{max-width:1240px;margin:0 auto;padding:16px 24px 28px}',
    '.cbsh-sec{margin-bottom:22px;scroll-margin-top:4px}',
    '.cbsh-cap{display:flex;align-items:center;gap:11px;margin:0 0 10px;position:sticky;top:-1px;z-index:3;background:var(--sh-page);padding:6px 0 5px}',
    '.cbsh-cap b{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--sh-muted);font-weight:700}',
    '.cbsh-cap i{flex:1;height:1px;background:var(--sh-soft);font-style:normal}.cbsh-cap span{font-size:12.5px;color:var(--sh-muted)}',
    '.cbsh-ph{display:none}',
    /* the phone bar's fifth tab (More) exists only on a phone; a tab's badge counts the tiles that Need you */
    '.cbsh-nv{position:relative}.cbsh-nv[data-go=more]{display:none}',
    '.cbsh-nv .bd{position:absolute;top:1px;left:calc(50% + 6px);min-width:16px;height:16px;padding:0 4px;box-sizing:border-box;border-radius:8px;background:var(--sh-amber-t);border:1px solid var(--sh-amber-b);color:var(--sh-amber-i);font-size:10px;font-weight:700;line-height:14px;text-align:center}',
    '.cbsh-nv .bd.dot{min-width:10px;width:10px;height:10px;padding:0;top:3px}',
    '.cbsh-box.off{border-style:dashed;background:var(--sh-panel);color:var(--sh-muted);cursor:default}.cbsh-box.off:hover{border-color:var(--sh-line)}.cbsh-box.off .no{display:block;clear:left;font-size:13px;margin-top:9px;padding-top:7px;border-top:1px solid var(--sh-hair)}',
    '.cbsh-note{font-size:13px;color:var(--sh-muted);padding:6px 0}',
    /* cards (max three columns, DECISIONS.md) */
    '.cbsh-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}',
    '.cbsh-box{display:block;width:100%;text-align:left;background:var(--sh-card);border:1px solid var(--sh-line);border-radius:13px;padding:14px 16px;position:relative;transition:border-color .12s}',
    '.cbsh-box:hover{border-color:var(--sh-green)}',
    '.cbsh-box .g{width:32px;height:32px;border-radius:9px;background:var(--sh-panel);display:grid;place-items:center;font-size:15px;color:var(--sh-muted);margin-bottom:9px}',
    '.cbsh-box h4{font-family:"Bricolage Grotesque",sans-serif;font-size:16.5px;font-weight:800;letter-spacing:-.015em;margin:0}',
    '.cbsh-box .what{font-size:12.5px;color:var(--sh-muted);margin:2px 0 0;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:14px}',
    '.cbsh-box .facts{display:flex;flex-direction:column;gap:2px;margin-top:11px;padding-top:9px;border-top:1px solid var(--sh-hair)}',
    /* walk 17 Oct (Athi: "too much information, the screen will expand"): EVERY TILE IS ONE HEIGHT — one line of purpose, two fact lines reserved
       whether or not they arrive, each line cut with … and said in full on hover (title). A tile never grows; more to say is the app's job. */
    '.cbsh-box{height:148px;overflow:visible}.cbsh-sec.labs .cbsh-box,.cbsh-sec.setup .cbsh-box{height:148px}',
    /* walk 17 Oct (Athi: "text bigger, the name next to the icon"): the icon floats beside the name; purpose and facts read one size up */
    '.cbsh-box .g,.cbsh-sec.labs .cbsh-box .g,.cbsh-sec.setup .cbsh-box .g{float:left;width:32px;height:32px;display:grid;margin:0 10px 6px 0;background:var(--sh-panel);font-size:16px}',
    '.cbsh-box h4,.cbsh-sec.labs .cbsh-box h4,.cbsh-sec.setup .cbsh-box h4{font-size:18px;line-height:32px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:16px}',
    '.cbsh-box .what{clear:left;font-size:14px;white-space:normal;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2}.cbsh-box .f{font-size:13.5px}.cbsh-box .facts{margin-top:9px;padding-top:7px}',
    '.cbsh-box .facts{flex-direction:row;align-items:center;gap:6px;height:calc(1.35em + 10px)}.cbsh-box .facts:empty{border-top-color:transparent}',
    '.cbsh-box .f{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.35;min-width:0}.cbsh-box .facts>.f{flex:1}',
    /* the rest DROPS DOWN over the page on hover or keyboard focus — the tile keeps its size and nothing below it moves (Athi: "show as a dropdown") */
    /* walk 17 Oct (Athi: "represent the status, active / not active"): THE SERVER SAYS which of three a card is (facts `state`) — the dot is never colour alone */
    '.cbsh-box .st{flex:none;font-size:11.5px;font-weight:700;white-space:nowrap}.cbsh-box .st.needs_you{color:var(--sh-amber-i)}.cbsh-box .st.in_use{color:var(--sh-green-d)}.cbsh-box .st.not_started{color:var(--sh-muted)}',
    '.cbsh-needs{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;margin:0 0 12px;font-size:13.5px}.cbsh-needs[hidden]{display:none}.cbsh-needs b{color:var(--sh-amber-i)}',
    '.cbsh-needs a{border:1px solid var(--sh-line);border-radius:999px;padding:3px 10px;background:var(--sh-card);text-decoration:none;color:inherit}.cbsh-needs a:hover{border-color:var(--sh-green)}',
    '.cbsh-box .more-n{flex:none;font-size:11px;font-weight:700;color:var(--sh-green-d);background:var(--sh-green-t);border-radius:8px;padding:1px 6px}',
    '.cbsh-box .more{display:none;position:absolute;z-index:6;left:-1px;right:-1px;top:calc(100% - 8px);flex-direction:column;gap:3px;padding:9px 16px 11px;background:var(--sh-card);border:1px solid var(--sh-green);border-top:0;border-radius:0 0 13px 13px;box-shadow:0 10px 22px var(--sh-shadow)}',
    '.cbsh-box .more .f{white-space:normal}.cbsh-box:hover .more,.cbsh-box:focus-visible .more{display:flex}',
    '.cbsh-box .f{font-size:12.5px;color:var(--sh-muted);font-family:var(--f-num,"IBM Plex Mono",monospace)}.cbsh-box .f.dn{color:var(--sh-amber-i)}',
    '.cbsh-box .f .act{text-decoration:underline;cursor:pointer;font-weight:600}',
    /* RPT2: the teaser (a sparkline + "↑ +12% vs last year") is a door to Reports › Trend, drawn as a figure, not a link word; it keeps its width beside the line */
    '.cbsh-box .f .act.trend{text-decoration:none;font-weight:500;display:inline-flex;align-items:center;gap:6px}.cbsh-box .facts>.f.trendf{flex:none}',
    '.cbsh-box .arw{position:absolute;top:14px;right:15px;color:var(--sh-ghost);font-size:16px}.cbsh-box:hover .arw{color:var(--sh-green)}',
    '.cbsh-sec.labs .cbsh-box,.cbsh-sec.setup .cbsh-box{padding:12px 14px;border-radius:11px}',
    '.cbsh-sec.labs .cbsh-box h4,.cbsh-sec.setup .cbsh-box h4{font-family:inherit;font-size:14px;font-weight:700;letter-spacing:0}',
    '.cbsh-sec.labs .cbsh-box .g,.cbsh-sec.setup .cbsh-box .g{width:auto;height:auto;background:none;font-size:15px;margin-bottom:6px;display:block}',
    '.cbsh-labs{background:var(--sh-panel);border:1px solid var(--sh-soft);border-radius:14px;padding:4px 16px 15px}.cbsh-labs .cbsh-cap{background:var(--sh-panel)}',
    '.cbsh-base{border:1px dashed var(--sh-line);border-radius:14px;padding:4px 16px 15px}',
    /* CB Commerce pillar boxes: 4 across (the main row), 3 across (the supporting row), cards stacked inside */
    '.cbsh-pils{display:grid;gap:12px;align-items:start}.cbsh-pils.n4{grid-template-columns:repeat(4,minmax(0,1fr))}.cbsh-pils.n3{grid-template-columns:repeat(3,minmax(0,1fr))}.cbsh-pils.n2{grid-template-columns:repeat(2,minmax(0,1fr))}',
    '.cbsh-pil{background:var(--sh-panel);border:1px solid var(--sh-soft);border-radius:14px;padding:10px 10px 12px;min-width:0}',
    '.cbsh-pil h3{margin:0 2px 8px;font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--sh-muted);font-weight:700}',
    '.cbsh-pil .cbsh-grid{grid-template-columns:1fr;gap:8px}.cbsh-pil .cbsh-chips{margin-top:8px}.cbsh-pil .cbsh-grid:empty{display:none}',
    '.cbsh-pil .cbsh-box{padding:12px 14px}',
    '@media(max-width:1000px){.cbsh-pils.n4{grid-template-columns:repeat(2,minmax(0,1fr))}.cbsh-pils.n3{grid-template-columns:repeat(2,minmax(0,1fr))}}',
    /* dashed chips: coming · workshop (no link — I12) */
    '.cbsh-chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.cbsh-chips:empty{display:none}',
    '.cbsh-sc{display:inline-flex;align-items:center;gap:9px;background:var(--sh-card);border:1px dashed var(--sh-line);border-radius:10px;padding:6px 12px;color:var(--sh-muted)}',
    '.cbsh-sc .g{font-size:13px;color:var(--sh-ghost)}.cbsh-sc b{font-size:13px;font-weight:600}',
    '.cbsh-sc .tag{font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--sh-muted);background:var(--sh-panel);border-radius:5px;padding:1px 6px}',
    '.cbsh-alerts:empty,.cbsh-home:empty,.cbsh-signin:empty{display:none}.cbsh-alerts{display:flex;flex-direction:column;gap:7px;margin-bottom:16px}',
    '.cbsh-foot{flex:0 0 auto}.cbsh-foot:empty{display:none}.cbsh-pfoot{display:none}',
    '.cbsh-slotwork{min-height:100%}',
    /* TOUR-FIX1: the drawer buttons sit at the top of the work and scroll WITH it — a sticky row covered the cards scrolled under it (shell-card-documents) */
    /* CB SIDES (public/app/sides.js): two reference panels, closed until asked for — two drawers behind two small icon buttons at EVERY width, one open at a time; a phone drawer is full width (walk 2026-10-17, Athi: "can be just an icon … if someone clicks we can show") */
    '.cbsh-work{position:relative}.cbsh-side,.cbsh-tools{display:none}',
    '.cbsh.has-sides .cbsh-tools{display:flex;justify-content:flex-end;gap:6px;padding:4px 0;margin-bottom:4px}.cbsh.has-sides .cbsh-tools .cbsd-btn{display:inline-block}',
    '.cbsh.has-sides .cbsh-side.drawer{display:block;position:absolute;top:48px;bottom:0;width:min(330px,92vw);z-index:40;margin:0;border-radius:0;overflow:auto;box-shadow:0 0 30px var(--sh-shadow)}',
    '.cbsh.has-sides .cbsh-side.l.drawer{left:var(--sh-navw)}.cbsh.has-sides .cbsh-side.r.drawer{right:0}.cbsh .cbsd-x{display:inline-block}',
    '@media(max-width:700px){.cbsh.has-sides .cbsh-side.drawer{left:0!important;right:0!important;width:100%}}',
    '@media(max-width:1100px){.cbsh-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.cbsh-sin{grid-template-columns:1fr 1.4fr}.cbsh-sin .cbsh-col:nth-child(3){grid-column:1/-1}}',
    /* PHONE — a different layout: bottom tabs, one area at a time, rows, the sheet drops over the page, the kural once on Home */
    '@media(max-width:700px){',
    /* 390: the app switcher opens inside the screen (e2e/shell.cjs: its right edge was at 440 of 390) */
    '.cbsh-swpop{position:fixed;left:16px;right:16px;top:52px;min-width:0}',
    /* the tile's own line is hidden where .more lists every line: the status badge is the first child now, so :has(+.more-n) finds it */
    '.cbsh-box,.cbsh-sec.labs .cbsh-box,.cbsh-sec.setup .cbsh-box{height:auto}.cbsh-box .facts{height:auto}.cbsh-box .more{position:static;display:flex;border:0;box-shadow:none;padding:0;background:none}.cbsh-box .more-n,.cbsh-box .facts>.f:first-child:not(:only-child),.cbsh-box .facts>.f:has(+.more-n){display:none}',
    '.cbsh{--sh-bar:52px}.cbsh-bar{padding:0 13px;gap:4px;container-type:inline-size}.cbsh-who{padding:4px 4px;margin-left:-4px;flex:1 1 auto}.cbsh-who b{font-size:14px}' /* a pane keeps its 55px on a phone too: its line meets the sidebar's brand row (frame-every-width rule f) */,
    /* INT7b-GREEN: a 390 px bar held 405 px (mark · shop · switcher · chip · bell · ⌂ · avatar, 9 px gaps) and cut the shop's name to 55 px. The name takes the slack
       (the spacer gives way to it) at 14 px; a bar narrower than its need (a pane beside the sidebar, ~326 px) shows the whole name or none — never "F…" (the button's aria-label still says it) */
    '.cbsh-bar:has(.cbsh-who) .cbsh-grow{display:none}',
    '@container (max-width:359px){.cbsh-who b{display:none}}',
    /* the name has no room beside the controls, so a keyboard user who lands on the shop button is told it in a caption under the bar (the same words the aria-label says); it is the button's own name, drawn only while the ring is on it */
    '@container (max-width:359px){.cbsh-who{position:relative}.cbsh-who:focus-visible b{display:block;position:absolute;top:calc(100% + 4px);left:0;z-index:40;width:max-content;max-width:calc(100cqw - 16px);white-space:normal;overflow:visible;padding:6px 10px;border:1px solid var(--sh-line);border-radius:8px;background:var(--sh-card);color:var(--sh-ink);box-shadow:0 8px 18px var(--sh-shadow)}}',
    '.cbsh-tohome .hw{display:none}.cbsh-tohome{padding:0 8px}.cbsh-title{font-size:13px}' /* TAP RULE (Athi 10 Nov): every control of the header is 44 px on a phone */,
    '.cbsh-hdr .cbsh-who,.cbsh-hdr .cbsh-swb,.cbsh-hdr .cbsid,.cbsh-hdr .cbb-btn,.cbsh-hdr .cbav-btn,.cbsh-hdr .cbav-signin{min-height:44px;min-width:44px}' /* one level more specific: the bell's and the chip's own stylesheets load after this one */ /* a phone: ⌂ alone (aria-label keeps the word) */,
    '.cbsh-swb .sn{display:none}' /* a phone: the switcher is its icon — the screen chip names the screen; with ⌂ Home beside it the app's name no longer fits a 390 px pane (INT7b, walk-returns R6) */,
    /* a phone, signed in: the shop's name is the bar's name — the page's title would cut it (area pitfall: "the shared top bar cuts the shop name at 390 px"); signed out the title shows */
    '.cbsh-bar:has(.cbsh-who) .cbsh-title{display:none}',
    '.cbsh-chip .lbl,.cbsh-chip .lg{display:none}.cbsh-chip .sm{display:inline}.cbsh-chip{padding:0 8px;gap:6px}',
    '.cbsh-sheet{position:absolute;left:0;right:0;top:var(--sh-bar);max-height:calc(100dvh - var(--sh-bar) - 70px);box-shadow:0 14px 28px var(--sh-shadow);border-bottom:1px solid var(--sh-line)}',
    '.cbsh-hdr.open .cbsh-scrim{display:block;position:fixed;inset:var(--sh-bar) 0 0 0;background:var(--sh-scrim);z-index:-1}',
    '.cbsh-sin{grid-template-columns:1fr;gap:16px;padding:14px 14px 16px}.cbsh-sin .cbsh-col:nth-child(3){grid-column:auto}.cbsh-ln.none{grid-column:auto}',
    '.cbsh-lrow{grid-template-columns:1fr auto auto;gap:8px;min-height:36px}.cbsh-lrow .no{display:none}.cbsh-rn{height:44px;padding:0 12px}.cbsh-btn{height:44px}',
    '.cbsh-work{flex-direction:column-reverse}',
    '.cbsh-nav{flex:0 0 auto;flex-direction:row;justify-content:space-around;gap:0;border-right:0;border-top:1px solid var(--sh-line);padding:5px 4px calc(5px + env(safe-area-inset-bottom,0px));background:var(--sh-card)}',
    '.cbsh-nv{flex:1;width:auto;padding:6px 0 4px;border-radius:9px}.cbsh-nv .i{font-size:19px}.cbsh-nv .t{font-size:10.5px}',
    '.cbsh-nv[aria-current]{background:var(--sh-green-t);box-shadow:inset 0 3px 0 var(--sh-green)}',
    /* five tabs: Trade, Labs and Setup live behind More; 44 px to hit, 11 px words */
    '.cbsh-nv[data-go=trade],.cbsh-nv[data-go=labs],.cbsh-nv[data-go=setup]{display:none}.cbsh-nv[data-go=more]{display:flex}.cbsh-nv[data-go=more][hidden]{display:none}',
    '.cbsh-nv{min-height:44px;justify-content:center}.cbsh-nv .t{font-size:11px}.cbsh-nv .bd{left:calc(50% + 4px)}',
    '.cbsh-main[data-tab=more] .cbsh-sec.trade,.cbsh-main[data-tab=more] .cbsh-sec.labs,.cbsh-main[data-tab=more] .cbsh-sec.setup{display:block;margin-bottom:10px}',
    '.cbsh-sec.trade .cbsh-ph,.cbsh-sec.labs .cbsh-ph,.cbsh-sec.setup .cbsh-ph{margin:0 0 8px}',
    '.cbsh-row{display:flex;align-items:center;gap:10px;width:100%;min-height:56px;padding:8px 14px;border:1px solid var(--sh-line);border-radius:13px;background:var(--sh-card);color:inherit;font:inherit;text-align:left}',
    '.cbsh-row .rt{flex:1;min-width:0;display:flex;flex-direction:column}.cbsh-row .rn{font-size:17px;font-weight:800}.cbsh-row .rs{font-size:12.5px;font-weight:400;color:var(--sh-muted)}',
    '.cbsh-row .chev{transition:transform .12s}.cbsh-row[aria-expanded=true] .chev{transform:rotate(90deg)}',
    '.cbsh-sec.trade:not(.open)>*:not(.cbsh-ph),.cbsh-sec.labs:not(.open)>*:not(.cbsh-ph),.cbsh-sec.setup:not(.open)>*:not(.cbsh-ph){display:none}',
    '.cbsh-inner{padding:12px 13px 20px}.cbsh-main{scroll-behavior:auto}',
    '.cbsh-sec{display:none;margin-bottom:0}',
    '.cbsh-main[data-tab=home] .cbsh-sec.home,.cbsh-main[data-tab=selling] .cbsh-sec.selling,.cbsh-main[data-tab=money] .cbsh-sec.money,.cbsh-main[data-tab=running] .cbsh-sec.running,.cbsh-main[data-tab=trade] .cbsh-sec.trade,',
    '.cbsh-main[data-tab=labs] .cbsh-sec.labs,.cbsh-main[data-tab=setup] .cbsh-sec.setup{display:block}',
    '.cbsh-cap{display:none}',
    '.cbsh-pils.n4,.cbsh-pils.n3,.cbsh-pils.n2{grid-template-columns:1fr;gap:10px}.cbsh-pil{padding:8px 0 0;background:none;border:0}.cbsh-pil h3{margin-left:2px}.cbsh-pil .cbsh-grid{gap:0}',
    '.cbsh-ph{display:block;font-family:"Bricolage Grotesque",sans-serif;font-size:21px;font-weight:800;letter-spacing:-.02em;margin:2px 2px 10px}',
    '.cbsh-grid{grid-template-columns:1fr;gap:0;border:1px solid var(--sh-line);border-radius:13px;background:var(--sh-card);overflow:hidden}',
    '.cbsh-box,.cbsh-sec.labs .cbsh-box,.cbsh-sec.setup .cbsh-box{border:0;border-radius:0;border-bottom:1px solid var(--sh-hair);padding:13px 38px 13px 14px}',
    '.cbsh-box:last-child{border-bottom:0}',
    '.cbsh-box .g,.cbsh-sec.labs .cbsh-box .g,.cbsh-sec.setup .cbsh-box .g{display:none}.cbsh-box .arw{top:50%;transform:translateY(-50%);right:14px}',
    '.cbsh-box .facts{flex-direction:row;flex-wrap:wrap;gap:2px 12px;margin-top:6px;padding-top:0;border-top:0}',
    '.cbsh-labs,.cbsh-base{padding:0;background:none;border:0}',
    '.cbsh-chips{gap:7px;margin-top:12px}.cbsh-sc{padding:6px 10px}',
    /* P2-2 (Athi: "kural should be in the footer"): on a phone Home the band sits in the footer ABOVE the tab bar (the work area is column-reverse, so the DOM order nav · pfoot · main reads main · pfoot · nav) */
    '.cbsh-pfoot{display:block;flex:0 0 auto;order:0}.cbsh-pfoot:empty{display:none}',
    '}'
  ].join('');

  function addCss() {
    if (!doc || doc.getElementById('cbsh-css')) return;
    var node = doc.createElement('style');
    node.id = 'cbsh-css';
    node.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(node);
  }
  /* SHELL-ONE: the type SYSTEM.md §2 names (Bricolage Grotesque · IBM Plex Sans · IBM Plex Mono · Source Serif 4) is SELF-HOSTED: ONE sheet, /fonts/cb-fonts.css (OFL), no third-party call.
     A page links it in its head (so the first paint has it); the frame adds it only when the page forgot (guard: tests/font-faces-guard.test.cjs). */
  var FONTS_HREF = '/fonts/cb-fonts.css';
  function addFonts(options) {
    if (!doc || !doc.head || (options && options.fonts === false)) return;
    var hasFontLink = [].some.call(doc.querySelectorAll('link[rel="stylesheet"]'), function (nestedLink) {
      return /[/]fonts[/]cb-fonts[.]css/.test(nestedLink.getAttribute('href') || '');
    });
    if (hasFontLink) return;
    var link = doc.createElement('link');
    link.id = 'cbsh-fonts';
    link.rel = 'stylesheet';
    link.href = FONTS_HREF;
    doc.head.appendChild(link);
  }

  /* ── licences: the server says the band (ok · due · soon · gone) and any penalty words; the shell only words the days ── */
  function daysWord(l) {
    var d = l.days_left;
    if (d == null) return l.core ? W.notAdded : l.registered ? W.registered : W.notRegistered;
    if (d < 0) return W.expired(-d);
    if (d < 400) return d + W.days;
    return Math.round((d / 365) * 10) / 10 + W.years;
  }
  var WARN = { due: 1, soon: 1, gone: 1 };
  function worstOf(lics) {
    var list = (lics || []).filter(function (item) {
      return item && item.core && item.days_left != null && WARN[item.band];
    });
    list.sort(function (first, second) {
      return first.days_left - second.days_left;
    });
    return list[0] || null;
  }

  /* THE FRAME's markup, one template (SHELL-ONE): the header (mark · shop · switcher or title · chip · edition · licence · bell · ⌂ Home · avatar),
     then — not in bar mode — the work area (Home: the rail and the areas; an app: the sign-in slot and the work slot) and the foot.
     frame = { mode, person, sheetId, title, appId, homeHref, sides } */
  /* a money icon before the header names the currency: the marked neutral sign; paintMoneyGlyphs() swaps it for the shop's symbol */
  function neutralGlyph(icon) {
    return icon === MONEY_GLYPH ? '<span data-glyph="money">' + MONEY_GLYPH + '</span>' : esc(icon);
  }
  function frameHTML(frame) {
    return headerHTML(frame) + workHTML(frame);
  }
  /** SHELL-ONE: in bar mode the bar names its page (the shop, the lab) — { icon, name }; nothing otherwise */
  function titleHTML(frame) {
    if (frame.mode !== 'bar' || !frame.title) return '';
    return (
      '<span class="cbsh-title" data-testid="shell-title"><span aria-hidden="true">' +
      esc(frame.title.icon || '') +
      '</span><span class="tw">' +
      esc(T(frame.title.name || '')) +
      '</span></span>'
    );
  }
  /** the identity mount of a bar control (this screen's code + U1nn, the list control's rule); none until the page names its screen */
  function shellMount(component) {
    return root.CBScreenId && root.CBScreenId.mountAttr ? root.CBScreenId.mountAttr(component) : '';
  }
  /** the popup-code chip of this popover (a literal POP code, the one the register holds for it); nothing on a page without screen-id.js */
  function shellChip(code, place) {
    return root.CBScreenId && root.CBScreenId.popupChip ? root.CBScreenId.popupChip(code, place) : '';
  }
  var CHIP_CORNER = 'position:absolute;inset-inline-end:10px;top:2px'; /* the sheet's chip sits in its corner: no row of its own, no scroll gained */
  /** the bar's own buttons are drawn before the screen is named: once it is, each coded one gets its mount */
  function stampMounts(node) {
    [].forEach.call(node.querySelectorAll('[data-cbsid]:not([data-cbmount])'), function (item) {
      var mount = shellMount(item.getAttribute('data-cbsid').slice(0, 6)).match(/"([^"]+)"/);
      if (mount) item.setAttribute('data-cbmount', mount[1]);
    });
  }
  /** ⌂ Home: the standard component CMP023 (ui.js), a real link; its size comes from the one tap rule (32 compact, 44 on a phone) */
  function homeLink(frame) {
    var screen = (root.CBScreenId && root.CBScreenId.current && root.CBScreenId.current()) || 'HOM001';
    /* where-used: out-of-scope the shell is drawn on every screen, so its mount takes the screen's own code */
    return root.ui.action('home', { mount: screen + '-U90', href: frame.homeHref, display: 'icon+label', size: 'compact', surface: 'shell', testid: 'shell-home' });
  }
  /** the header: the bar (mark · shop · switcher or title · chip · edition · licence · bell · ⌂ Home · avatar) and the shop's sheet */
  function headerHTML(frame) {
    return (
      '<header class="cbsh-hdr" data-testid="shell-header">' +
      '<div class="cbsh-bar" data-testid="shell-bar">' +
      '<span class="cbsh-mark" aria-hidden="true" data-testid="shell-mark">▣</span>' +
      (frame.person
        ? '<button type="button" class="cbsh-who" data-cbsid="CMP033-B01" data-testid="shell-shop" aria-expanded="false" aria-controls="' +
          frame.sheetId +
          '"><b data-testid="shop-name"></b><span class="chev" aria-hidden="true">▼</span></button>'
        : '') +
      (frame.mode === 'app'
        ? '<div class="cbsh-sw"><button type="button" class="cbsh-swb" data-cbsid="CMP033-B01" data-testid="shell-switcher" aria-haspopup="true" aria-expanded="false"></button><div class="cbsh-swpop" data-testid="shell-switcher-menu" data-pop="POP116" hidden></div></div>'
        : '') +
      titleHTML(frame) +
      '<span class="cbsh-grow"></span>' +
      (frame.mode !== 'bar' || frame.appId
        ? '<span class="cbsh-sid" data-testid="shell-screen-id"></span>'
        : '') /* SCREEN-ID: this screen's name · code (app/screen-id.js, if the page loaded it) */ +
      '<span class="cbsh-ed" data-testid="shell-edition"></span>' +
      '<span class="cbsh-lic" data-testid="shell-licence"></span>' +
      '<span class="cbsh-bell" data-testid="shell-bell" data-slot="bell"></span>' +
      /* SHELL-ONE: ⌂ Home on every page but Home itself — the storefront's frame.homeHref is the shop's front */
      (frame.mode !== 'home'
        ? homeLink(frame)
        : '') /* .cbsh-tohome, never .cbsh-home: that is Home's own slot (INT7b: the link's rule had laid Home's sections in a row) */ +
      '<span class="cbsh-av" data-testid="shell-avatar"></span>' +
      '</div>' +
      (frame.person
        ? '<div class="cbsh-sheet" id="' +
          frame.sheetId +
          '" role="region" data-testid="shell-sheet" data-pop="POP115" hidden></div><div class="cbsh-scrim" data-testid="shell-scrim"></div>'
        : '') +
      '</header>'
    );
  }
  /** the work area under the header — nothing in bar mode; Home: the rail and the areas; an app: the sign-in slot and the work slot; then the foot */
  function workHTML(frame) {
    if (frame.mode === 'bar') return '';
    return (
      '<div class="cbsh-work">' +
      (frame.mode === 'home'
        ? '<nav class="cbsh-nav" data-testid="shell-nav" aria-label="Areas">' +
          AREAS.map(function (item) {
            return (
              '<button type="button" class="cbsh-nv" data-cbsid="HOM001-K01" data-go="' +
              item +
              '" data-testid="shell-nav-' +
              item +
              '"><span class="i" aria-hidden="true">' +
              neutralGlyph(ICON[item]) +
              '</span><span class="t">' +
              esc(W.areas[item]) +
              '</span></button>'
            );
          }).join('') +
          '<button type="button" class="cbsh-nv" data-cbsid="HOM001-K01" data-go="more" data-testid="shell-nav-more"><span class="i" aria-hidden="true">' +
          ICON.more +
          '</span><span class="t">' +
          esc(W.areas.more) +
          '</span></button></nav>'
        : '') +
      (frame.mode === 'home' ? '<div class="cbsh-pfoot" data-testid="shell-pfoot"></div>' : '') +
      (frame.sides ? '<aside class="cbsh-side l" data-slot="sideL"></aside>' : '') +
      '<main class="cbsh-main" data-testid="shell-main" data-tab="home" tabindex="0"><div class="cbsh-inner">' +
      (frame.sides
        ? '<div class="cbsh-tools" data-testid="shell-sidetools"><button type="button" data-cbsid="HOM001-B03" data-slot="btnL"></button><button type="button" data-cbsid="HOM001-B04" data-slot="btnR"></button></div>'
        : '') +
      '<div class="cbsh-signin" data-testid="shell-signin"></div>' +
      (frame.mode === 'home' ? '<div class="cbsh-areas" data-testid="shell-areas"></div>' : '<div class="cbsh-slotwork" data-slot="work"></div>') +
      '</div></main>' +
      (frame.sides ? '<aside class="cbsh-side r" data-slot="sideR"></aside>' : '') +
      '</div>' +
      '<div class="cbsh-foot" data-testid="shell-foot"></div>'
    );
  }

  /* SET-WALK1 · W8: the edition chip looked like a button and was a label. It IS a button now: a press opens the avatar menu on its Edition group
     (the one switch, CBAvatar.set('edition')); the ✕ beside it goes straight back to Everything (the full showing). */
  function editionChipsHTML(edition) {
    if (!edition) return '';
    return (
      '<button type="button" class="cbsh-chip due" data-cbsid="CMP033-B01"' + shellMount('CMP033') + ' data-testid="shell-edition-chip" data-edition="' +
      esc(edition.key) +
      '" title="' +
      esc(W.editionOpen || 'Change what this shows') +
      '">' +
      esc(edition.chip) +
      '</button>' +
      '<button type="button" class="cbsh-chip due" data-cbsid="CMP014-B01"' + shellMount('CMP014') + ' data-testid="shell-edition-off" aria-label="' +
      esc(W.editionOff || 'Show everything') +
      '" title="' +
      esc(W.editionOff || 'Show everything') +
      '" style="padding:0 8px;margin-inline-start:4px">✕</button>'
    );
  }
  /** wire the two chips editionChipsHTML drew: the chip opens the choice, the ✕ returns to the full showing */
  function wireEditionChips(spot) {
    var openChip = spot.querySelector('[data-testid="shell-edition-chip"]'),
      offChip = spot.querySelector('[data-testid="shell-edition-off"]');
    if (openChip)
      openChip.onclick = function () {
        openEditionChoice();
      };
    if (offChip)
      offChip.onclick = function () {
        if (root.CBAvatar && root.CBAvatar.set) root.CBAvatar.set('edition', 'full');
      };
  }
  /** W8: open the avatar menu and put the Edition group in view — the choice lives in ONE place (avatar.js editionsHtml), the chip is its door */
  function openEditionChoice() {
    var avatarButton = root.document.querySelector('[data-testid="avatar"]');
    if (!avatarButton) return;
    if (!(root.CBAvatar && root.CBAvatar.isOpen && root.CBAvatar.isOpen())) avatarButton.click();
    var group = root.document.querySelector('[data-testid="edition-group"]');
    if (!group) return;
    try {
      group.scrollIntoView({ block: 'nearest' });
    } catch (err) {
      if (root.cbQuiet) root.cbQuiet('shell:openEditionChoice', err);
    }
    var first = group.querySelector('button');
    if (first) first.focus();
  }
  /* ── the money glyph: the shop's own currency symbol once the header names its currency; ¤ before that or with none ── */
  function moneySymbol(header) {
    var currency = header && header.business && header.business.currency,
      locale = root.CBLocale;
    if (!currency || !locale || typeof locale.symbol !== 'function') return MONEY_GLYPH;
    try {
      return locale.symbol(currency) || MONEY_GLYPH;
    } catch (err) {
      if (root.console) root.console.warn('shell moneySymbol: the locale could not name ' + currency, err);
      return MONEY_GLYPH;
    }
  }
  /** an entry's icon as painted: a money icon becomes the shop's symbol and is marked, so a later header read can re-swap it */
  function moneyGlyph(icon, header) {
    return icon === MONEY_GLYPH ? '<span data-glyph="money">' + esc(moneySymbol(header)) + '</span>' : esc(icon);
  }
  function paintMoneyGlyphs(pageDoc, header) {
    var symbol = moneySymbol(header);
    Array.prototype.forEach.call(pageDoc.querySelectorAll('[data-glyph="money"]'), function (node) {
      node.textContent = symbol;
    });
  }
  /* ── NAMES-1: a name that is the shop's COUNTRY word (manifest `word`: Stock · Inventory) — the one per-country words reader, helpers.js packWord,
     with the country of the one /me read (CBAvatar.shopCountry); '' = no such word on this page, so the manifest's own name stands ── */
  function countryWord(kind) {
    if (!kind || typeof root.packWord !== 'function') return '';
    var avatar = root.CBAvatar,
      countryCode = (avatar && typeof avatar.shopCountry === 'function' && avatar.shopCountry()) || '';
    return root.packWord(kind, countryCode) || '';
  }
  /* an entry's pillar (a missing one falls back to its area) and the Home section it stands in: a boxed area, a flat one, or its own */
  function pillarOf(entry) {
    return entry.pillar || PDEFAULT[entry.area] || entry.area;
  }
  function sectionOf(entry) {
    var pillar = pillarOf(entry),
      area;
    for (area in PILLARS) if (PILLARS[area].indexOf(pillar) >= 0) return area;
    for (area in FLAT_PILLARS) if (FLAT_PILLARS[area].indexOf(pillar) >= 0) return area;
    return pillar;
  }
  /** an entry's name as painted: a country word is marked, so the /me answer (cb:me) can re-say it */
  function entryName(e) {
    var word = countryWord(e.word);
    return word ? '<span data-word="' + esc(e.word) + '">' + esc(T(word)) + '</span>' : esc(T(e.name));
  }
  /* Home's tiles and chips, said again IN PLACE when a pack lands after the manifest painted them (walk-locale L-home: 26 vs 100 by who won
     the race). In place, not a repaint: that would wipe the facts and states readFacts already wrote. */
  function resayTiles(pageEl, manifest) {
    if (!manifest) return;
    var entryById = {};
    (manifest.entries || []).forEach(function (entry) {
      if (entry && entry.id) entryById[entry.id] = entry;
    });
    [].forEach.call(pageEl.querySelectorAll('.cbsh-box[data-id]'), function (tile) {
      var entry = entryById[tile.getAttribute('data-id')];
      if (!entry) return;
      var title = tile.querySelector('h4');
      if (title) title.innerHTML = entryName(entry);
      var purpose = tile.querySelector('.what');
      if (purpose && entry.what) {
        purpose.textContent = T(entry.what);
        purpose.setAttribute('title', T(entry.what));
      }
    });
    [].forEach.call(pageEl.querySelectorAll('.cbsh-sc[data-testid^="shell-chip-"]'), function (chip) {
      var entry = entryById[chip.getAttribute('data-testid').slice('shell-chip-'.length)];
      if (!entry) return;
      var label = chip.querySelector('b');
      if (label) label.innerHTML = entryName(entry);
      var tag = chip.querySelector('.tag'),
        chipState = chip.getAttribute('data-state');
      if (tag && W.tag[chipState]) tag.textContent = T(W.tag[chipState]);
    });
  }
  function paintCountryWords(pageDoc) {
    Array.prototype.forEach.call(pageDoc.querySelectorAll('[data-word]'), function (node) {
      var word = countryWord(node.getAttribute('data-word'));
      if (word) node.textContent = T(word);
    });
  }

  /* Home's "Needs you" strip: only the cards whose state is needs_you, each a door; hidden when none (every tile stays below it). Returns the state. */
  var needsByCard = {};
  function noteNeeds(card, state, routeOf) {
    if (state === 'needs_you') needsByCard[card.id] = card;
    else delete needsByCard[card.id];
    var strip = doc.querySelector('[data-testid="shell-needs"]');
    if (!strip) return state;
    var list = Object.keys(needsByCard).map(function (id) {
      return needsByCard[id];
    });
    strip.hidden = !list.length;
    strip.innerHTML =
      '<b>● ' +
      esc(T(W.needsYou)) +
      '</b>' +
      list
        .map(function (entry) {
          return '<a href="' + esc(routeOf(entry)) + '" data-testid="shell-needs-' + esc(entry.id) + '">' + esc(T(entry.name)) + '</a>';
        })
        .join('');
    return state;
  }
  /* each tab's badge = how many of its tiles Need you; More shows a dot when any tile behind it does (tabOf maps a tile's section to the phone's tab) */
  function paintBadges(shellEl) {
    var countByTab = {};
    Object.keys(needsByCard).forEach(function (cardId) {
      var section = sectionOf(needsByCard[cardId]);
      countByTab[section] = (countByTab[section] || 0) + 1;
      if (tabOf(section, true) === 'more') countByTab.more = (countByTab.more || 0) + 1;
    });
    [].forEach.call(shellEl.querySelectorAll('.cbsh-nv'), function (button) {
      var oldBadge = button.querySelector('.bd');
      if (oldBadge) button.removeChild(oldBadge);
      var tabId = button.getAttribute('data-go'),
        count = countByTab[tabId];
      if (!count) return;
      var isDot = tabId === 'more';
      button.insertAdjacentHTML(
        'beforeend',
        '<b class="bd' + (isDot ? ' dot' : '') + '" role="img" aria-label="' + count + ' ' + esc(T(W.needsHand)) + '">' + (isDot ? '' : count) + '</b>'
      );
    });
  }
  /* More's rows: one open at a time; force = open it (a tap on an open row closes it) */
  function openRow(shellEl, area, force) {
    [].forEach.call(shellEl.querySelectorAll('.cbsh-sec.trade,.cbsh-sec.labs,.cbsh-sec.setup'), function (section) {
      var isOpen = section.getAttribute('data-area') === area && (force || !section.classList.contains('open'));
      section.classList.toggle('open', isOpen);
      var rowButton = section.querySelector('.cbsh-row');
      if (rowButton) rowButton.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
  }
  /* a section's phone heading: Selling and Money are a title; Trade, Labs and Setup are the three ROWS of the More page (a tap opens the row's tiles) */
  function sectionHeadingHTML(area) {
    var name = esc(T(W.caption[area]));
    if (PHONE_MORE.indexOf(area) < 0) return '<h2 class="cbsh-ph">' + name + '</h2>';
    return (
      '<h2 class="cbsh-ph"><button type="button" class="cbsh-row" data-cbsid="HOM001-B02" data-row="' +
      area +
      '" aria-expanded="false" data-testid="shell-row-' +
      area +
      '"><span class="rt"><span class="rn">' +
      name +
      '</span><span class="rs">' +
      esc(T(W.sub[area] || '')) +
      '</span></span><span class="chev" aria-hidden="true">›</span></button></h2>'
    );
  }
  /* NAV-MAP 8: a tile that needs THIS shop's id and has none is greyed with its sentence (show the action, say why) - never a link to a blank page */
  function greyedTileHTML(entry, iconHTML, signedIn) {
    return (
      '<div class="cbsh-box off" aria-disabled="true" data-testid="shell-card-' +
      esc(entry.id) +
      '" data-id="' +
      esc(entry.id) +
      '"><span class="g" aria-hidden="true">' +
      iconHTML +
      '</span><h4>' +
      entryName(entry) +
      '</h4>' +
      (entry.what ? '<p class="what">' + esc(T(entry.what)) + '</p>' : '') +
      '<span class="no" data-testid="shell-off-' +
      esc(entry.id) +
      '">' +
      esc(T(signedIn ? W.noShop : W.signInShop)) +
      '</span></div>'
    );
  }
  /* the area a go() asks for, made real: More is the phone's tab (a laptop shows the three areas themselves); an area this showing does not draw is Home */
  function resolveArea(areaId, onPhone, drawn) {
    if (areaId === 'more') return onPhone ? 'more' : 'trade';
    return drawn.indexOf(areaId) < 0 ? 'home' : areaId;
  }
  /* the area Home opens on: the page's choice, else the address's #area (More only on a phone), else Home */
  function startArea(wanted, hashArea, onPhone) {
    var area = wanted || (AREAS.indexOf(hashArea) >= 0 || hashArea === 'more' ? hashArea : 'home');
    return area === 'more' && !onPhone ? 'trade' : area;
  }
  /* the greyed shop tiles whose entry the manifest can now open */
  function greyedEntries(shellEl, manifest) {
    var wanted = [].map.call(shellEl.querySelectorAll('.cbsh-box.off[data-id]'), function (tile) {
      return tile.getAttribute('data-id');
    });
    return ((manifest && manifest.entries) || []).filter(function (entry) {
      return entry && wanted.indexOf(entry.id) >= 0;
    });
  }
  /* the nav buttons an edition leaves out: an area it does not draw; More only when none of its three areas is drawn */
  function navHidden(navId, drawn) {
    return navId === 'more'
      ? !PHONE_MORE.some(function (area) {
          return drawn.indexOf(area) >= 0;
        })
      : drawn.indexOf(navId) < 0;
  }
  /** L16 F29: the first Tab stop on every page — a link that jumps over the header and the side menu to the page's main region (shown only while it has focus) */
  function addSkipLink() {
    if (!doc || !doc.body || doc.querySelector('[data-testid="skip-link"]')) return;
    var link = doc.createElement('a');
    link.className = 'cbsh-skip';
    link.href = '#cb-main';
    link.setAttribute('data-testid', 'skip-link');
    link.textContent = T(W.skip); /* the catalogue says it (walk-locale: new words go through tx) */
    link.addEventListener('click', function (event) {
      var target = doc.querySelector('main') || doc.querySelector('[role="main"]');
      if (!target) return;
      event.preventDefault();
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus();
    });
    doc.body.insertBefore(link, doc.body.firstChild);
  }
  function mount(el, o) {
    if (!el) return null;
    o = o || {};
    addCss();
    addFonts(o);
    addSkipLink();
    var host = o.host || null,
      mode = host && host.bar ? 'bar' : host ? 'app' : 'home';
    var appId = host && host.app ? String(host.app) : ''; /* bar mode too (SHELL-ONE): the storefront and the labs name their app for the chip */
    var sess = session(o.anonymous);
    var person = o.person !== undefined ? o.person : root.CBAvatar && root.CBAvatar.sessionPerson ? root.CBAvatar.sessionPerson() : null;
    var token = o.token || (sess && sess.token) || '';
    var base = o.apiBase != null ? o.apiBase : apiBase();
    var homeHref = o.homeHref || '/';
    var phone = root.matchMedia ? root.matchMedia('(max-width:700px)') : { matches: false };
    var S = { manifest: null, loadingApps: true, header: null, headerState: person ? 'loading' : 'out', area: 'home', open: false };
    var sheetId = 'cbsh-sheet-' + Math.random().toString(36).slice(2, 8);

    el.innerHTML = '';
    el.classList.add('cbsh');
    el.classList.remove('full', 'pane');
    if (mode !== 'bar') el.classList.add(o.fit === 'pane' ? 'pane' : 'full');
    el.setAttribute('data-testid', 'cbshell');
    el.setAttribute('data-mode', mode);

    var shopName = function () {
      var b = S.header && S.header.business;
      return (b && b.name) || (person && person.entity) || (sess && sess.entity) || W.yourShop;
    };

    /* CB Sides: only on Home, only signed in, only if the page loaded sides.js (the same rule as the avatar, bell and kural) */
    var sides = mode === 'home' && !!person && !!(root.CBSides && root.CBSides.mount);
    if (sides) el.classList.add('has-sides');

    el.innerHTML = frameHTML({ mode: mode, person: person, sheetId: sheetId, title: o.title, appId: appId, homeHref: homeHref, sides: sides });

    var $ = function (s) {
      return el.querySelector(s);
    };
    var facts = factsLib.create({ el: el, person: person, S: S, $: $, get: get, shown: shown, routeOf: routeOf, W: W, noteNeeds: noteNeeds, cardState: cards.cardState, paintBadges: paintBadges, factsHTML: cards.factsHTML, lineHTML: cards.lineHTML, trendHTML: cards.trendHTML });
    var node = $('.cbsh-hdr'),
      sheet = $('.cbsh-sheet'),
      who = $('.cbsh-who'),
      main = $('.cbsh-main');
    var slots = { bell: $('.cbsh-bell'), alerts: null, home: null, work: $('[data-slot="work"]') };
    /* SCREEN-ID: the app's screen code in the bar — the one chip (CBScreenId); a frame with sections names the section (page-frame.js setActive) */
    if ((mode !== 'bar' || appId) && root.CBScreenId) {
      root.CBScreenId.here(appId || 'home');
      $('.cbsh-sid').appendChild(root.CBScreenId.chip()), stampMounts(node); /* the chip names the screen: now the bar's coded buttons get their mount */
    }

    /* ── the bar ── */
    function paintBar() {
      if (who) {
        var levelWord = person && person.level ? ' · ' + person.level : '';
        who.querySelector('b').textContent = shopName() + levelWord;
        who.setAttribute('aria-label', shopName() + levelWord);
      }
      if (sheet) sheet.setAttribute('aria-label', shopName());
      var element = $('.cbsh-lic'),
        w = S.header ? worstOf(S.header.licences) : null;
      element.innerHTML = w
        ? '<button type="button" class="cbsh-chip ' +
          w.band +
          '" data-cbsid="CMP033-B01"' + shellMount('CMP033') + ' data-testid="shell-licence-chip" data-band="' +
          w.band +
          '">' +
          (w.band === 'due' ? '●' : '⚠') +
          ' <span class="lbl">' +
          esc(w.label) +
          '</span> <span class="d">' +
          (w.days_left < 0 ? '<span class="lg">' + esc(W.expired(-w.days_left)) + '</span><span class="sm">' + esc(W.lapsed) + '</span>' : esc(daysWord(w))) +
          '</span></button>'
        : '';
    }

    /* ── the edition: a chip in the bar naming the view (absent on the full app) — the chip look the licence uses, never a new one ── */
    function edition() {
      return root.CBEdition && S.manifest ? root.CBEdition.info(S.manifest) : null;
    }
    function paintEdition() {
      var ed = edition(),
        spot = $('.cbsh-ed');
      spot.innerHTML = editionChipsHTML(ed);
      wireEditionChips(spot);
      var line = $('[data-testid="shell-edition-line"]');
      if (line) {
        line.textContent = ed ? ed.line : '';
        line.hidden = !(ed && ed.line);
      }
    }

    function glyph(icon) {
      return moneyGlyph(icon, S.header);
    } /* the module-level moneyGlyph, with this shell's header */
    /* ── the sheet: the business · licences · trade ready — or the empty state that says they are not available yet ── */
    function paintSheet() {
      if (!sheet) return;
      var h = S.header,
        col = function (title, body, nestedWhy) {
          return '<div class="cbsh-col"><h5>' + esc(title) + (nestedWhy || '') + '</h5>' + body + '</div>';
        };
      if (S.headerState === 'loading') {
        sheet.innerHTML = shellChip('POP115', CHIP_CORNER) + '<div class="cbsh-sin"><div class="cbsh-ln">' + W.loading + '</div></div>';
        return;
      }
      if (!h) {
        sheet.innerHTML =
          shellChip('POP115', CHIP_CORNER) + '<div class="cbsh-sin" data-testid="shell-sheet-empty">' +
          col(W.business, '<div class="cbsh-ln nm">' + esc(shopName()) + '</div>') +
          '<div class="cbsh-ln none">' +
          esc(W.notYet) +
          '</div></div>';
        return;
      }
      var b = h.business || {},
        lics = h.licences || [],
        w = worstOf(lics),
        tr = h.trade_ready || {},
        checks = tr.checks || [];
      var biz =
        '<div class="cbsh-ln nm">' +
        esc(b.name || shopName()) +
        '</div>' +
        (b.legal_name ? '<div class="cbsh-ln">' + esc(b.legal_name) + '</div>' : '') +
        (b.address ? '<div class="cbsh-ln">' + esc(b.address) + '</div>' : '') +
        (b.phone ? '<div class="cbsh-ln mono">' + esc(b.phone) + '</div>' : '');
      var rows = lics
        .map(function (item) {
          var isW = w && item === w,
            btn = '';
          if (isW && item.renew_url)
            btn =
              '<a class="cbsh-rn ' +
              item.band +
              '" data-cbsid="CMP010-B01"' + shellMount('CMP010') + ' data-testid="shell-renew" href="' +
              esc(item.renew_url) +
              '">' +
              esc(item.band === 'gone' ? W.again : W.renew) +
              '</a>';
          var tone = item.days_left == null ? (item.registered ? 'ok' : '') : WARN[item.band] ? item.band : '';
          return (
            '<div class="cbsh-lrow" data-testid="shell-licence-row"><span class="nm">' +
            esc(item.label) +
            (item.number_masked ? '<span class="no">' + esc(item.number_masked) + '</span>' : '') +
            '</span>' +
            '<span class="st ' +
            tone +
            '">' +
            esc(daysWord(item)) +
            '</span><span>' +
            btn +
            '</span></div>'
          );
        })
        .join('');
      var why = w && w.note ? '<span class="why ' + w.band + '">' + esc(w.note) + '</span>' : '';
      var got = checks.filter(function (item) {
        return item && item.done;
      }).length;
      var chk =
        '<div class="cbsh-checks">' +
        checks
          .map(function (item) {
            return (
              '<div class="cbsh-chk ' +
              (item.done ? 'y' : 'n') +
              '" data-testid="shell-check"><span class="m" aria-hidden="true">' +
              (item.done ? '✓' : '') +
              '</span>' +
              esc(item.label) +
              '</div>'
            );
          })
          .join('') +
        '</div>' +
        (checks.length && got < checks.length
          ? '<a class="cbsh-btn" data-cbsid="CMP010-B01"' + shellMount('CMP010') + ' data-testid="shell-finish" href="' + esc(tr.fix_url || '/know-your-business.html') + '">' + esc(W.finish) + '</a>'
          : '');
      sheet.innerHTML =
        shellChip('POP115', CHIP_CORNER) + '<div class="cbsh-sin" data-testid="shell-sheet-full">' + col(W.business, biz) + col(W.licences, rows, why) + col(W.trade, chk) + '</div>';
    }

    function setOpen(v) {
      if (!sheet) return;
      S.open = !!v;
      node.classList.toggle('open', S.open);
      sheet.hidden = !S.open;
      if (who) who.setAttribute('aria-expanded', S.open ? 'true' : 'false');
    }

    /* ── the five areas (Home) ── */
    function shown() {
      var m = root.CBEdition && S.manifest ? root.CBEdition.view(S.manifest) : S.manifest;
      /* l16 firm-dash: a firm (clients by live grants, no trade of its own, the server's own_trade) is not shown the shop cards: the data decides, not a trade switch */
      return ((m && m.entries) || []).filter(function (e) {
        return !(root.CBPractice && root.CBPractice.hidesShopCards(e && e.id));
      });
    }
    function entriesOf(area) {
      return shown().filter(function (e) {
        return e && sectionOf(e) === area;
      });
    }
    /* the areas this showing has: Home always; another area only if the edition draws something in it (the full app: all five); a firm: only an area that still holds a card it keeps (l16 n12: no Selling/Money/Running/Trade/Labs rail) */
    function areasShown() {
      return !S.manifest || !(edition() || facts.isFirm())
        ? AREAS
        : AREAS.filter(function (item) {
            return item === 'home' || entriesOf(item).length;
          });
    }
    /* a pillar box: its title, then the cards that have a page, then the dashed chips (coming · workshop) */
    function pillarBox(p, list) {
      var built = list.filter(function (e) {
          return e.state === 'built' && e.route;
        }),
        rest = list.filter(function (e) {
          return !(e.state === 'built' && e.route);
        });
      return (
        '<div class="cbsh-pil" data-pillar="' +
        p +
        '" data-testid="shell-pillar-' +
        p +
        '"><h3>' +
        esc(PNAME[p]) +
        '</h3><div class="cbsh-grid">' +
        built.map(card).join('') +
        '</div><div class="cbsh-chips">' +
        rest.map(chip).join('') +
        '</div></div>'
      );
    }
    /* H22/S1: a route may name the shop it opens for ({bridge_id}: the Storefront is THIS shop's page, /shop.html?s=<id>); unresolved, the bare page */
    function shopIdOf() {
      return (person && person.bridgeId) || (sess && sess.bridgeId) || (S.header && S.header.business && S.header.business.bridge_id) || '';
    }
    function routeOf(e) {
      var text = String(e.route || '');
      if (text.indexOf('{bridge_id}') < 0) return text;
      var bid = shopIdOf();
      return bid ? text.replace('{bridge_id}', encodeURIComponent(bid)) : text.split('?')[0];
    }
    function card(e) {
      if (String(e.route || '').indexOf('{bridge_id}') >= 0 && !shopIdOf()) return greyedTileHTML(e, glyph(e.icon), !!person);
      return (
        '<a class="cbsh-box" data-cbsid="HOM001-B01" href="' +
        esc(routeOf(e)) +
        '" data-testid="shell-card-' +
        esc(e.id) +
        '" data-id="' +
        esc(e.id) +
        '">' +
        '<span class="arw" aria-hidden="true">›</span><span class="g" aria-hidden="true">' +
        glyph(e.icon) +
        '</span><h4>' +
        entryName(e) +
        '</h4>' +
        (e.what ? '<p class="what" title="' + esc(T(e.what)) + '">' + esc(T(e.what)) + '</p>' : '') +
        '<span class="facts" data-testid="shell-facts-' +
        esc(e.id) +
        '"></span></a>'
      );
    }
    function chip(e) {
      /* H14/P2-5: a workshop row whose function WORKS today (manifest `works`, the roadmap's rule) says so - never the word workshop */
      var st = e.state === 'workshop' ? (e.works ? 'works' : 'workshop') : 'coming';
      /* H36: a workshop item with no page of its own may name the closest built page (`via`): the chip becomes a link there, still marked workshop */
      if (e.via)
        return (
          '<a class="cbsh-sc" href="' +
          esc(e.via) +
          '" data-testid="shell-chip-' +
          esc(e.id) +
          '" data-state="' +
          st +
          '" data-via="1"' +
          (e.via_note ? ' title="' + esc(e.via_note) + '"' : '') +
          '><span class="g" aria-hidden="true">' +
          glyph(e.icon) +
          '</span><b>' +
          entryName(e) +
          '</b><span class="tag">' +
          esc(T(W.tag[st])) +
          '</span></a>'
        );
      return (
        '<span class="cbsh-sc" data-testid="shell-chip-' +
        esc(e.id) +
        '" data-state="' +
        st +
        '"><span class="g" aria-hidden="true">' +
        glyph(e.icon) +
        '</span><b>' +
        entryName(e) +
        '</b><span class="tag">' +
        esc(T(W.tag[st])) +
        '</span></span>'
      );
    }
    function paintAreas() {
      var box = $('.cbsh-areas');
      if (!box) return;
      /* Home is drawn ONCE (the page may already have put its alerts and content in the slots); the four areas are redrawn from the manifest */
      if (!$('.cbsh-sec.home')) {
        box.innerHTML =
          '<section class="cbsh-sec home" data-area="home" data-testid="shell-area-home"><h2 class="cbsh-ph">' +
          esc(W.areas.home) +
          '</h2>' +
          '<div class="cbsh-needs" data-testid="shell-needs" hidden></div><div class="cbsh-note" data-testid="shell-edition-line" hidden></div><div class="cbsh-alerts" data-slot="alerts"></div><div class="cbsh-home" data-slot="home"></div><div class="cbsh-note" data-testid="shell-noapps" hidden>' +
          esc(W.noApps) +
          '</div>' +
          '</section><div class="cbsh-more"></div>';
        slots.alerts = $('[data-slot="alerts"]');
        slots.home = $('[data-slot="home"]');
      }
      $('[data-testid="shell-noapps"]').hidden = !!S.manifest || S.loadingApps;
      var has = areasShown();
      [].forEach.call(el.querySelectorAll('.cbsh-nv'), function (element) {
        element.hidden = navHidden(element.getAttribute('data-go'), has);
      });
      $('.cbsh-more').innerHTML = has
        .slice(1)
        .map(function (item) {
          var list = entriesOf(item),
            built = list.filter(function (e) {
              return e.state === 'built' && e.route;
            }),
            rest = list.filter(function (e) {
              return !(e.state === 'built' && e.route);
            });
          var cap =
            '<div class="cbsh-cap"><b>' + esc(T(W.caption[item])) + '</b>' + (W.sub[item] ? '<span>' + esc(T(W.sub[item])) + '</span>' : '') + '<i></i></div>';
          if (PILLARS[item]) {
            var boxes = PILLARS[item]
              .map(function (entry) {
                var l = list.filter(function (e) {
                  return pillarOf(e) === entry;
                });
                return l.length ? pillarBox(entry, l) : '';
              })
              .join('');
            return (
              '<section class="cbsh-sec ' +
              item +
              '" data-area="' +
              item +
              '" data-testid="shell-area-' +
              item +
              '">' +
              sectionHeadingHTML(item) +
              cap +
              '<div class="cbsh-pils n' +
              PILLARS[item].length +
              '">' +
              boxes +
              '</div></section>'
            );
          }
          var inner = cap + '<div class="cbsh-grid">' + built.map(card).join('') + '</div><div class="cbsh-chips">' + rest.map(chip).join('') + '</div>';
          var wrap = item === 'labs' ? '<div class="cbsh-labs">' + inner + '</div>' : item === 'setup' ? '<div class="cbsh-base">' + inner + '</div>' : inner;
          return (
            '<section class="cbsh-sec ' +
            item +
            '" data-area="' +
            item +
            '" data-testid="shell-area-' +
            item +
            '">' +
            sectionHeadingHTML(item) +
            wrap +
            '</section>'
          );
        })
        .join('');
      placeKural();
    }

    /* l16 firm-dash: the practice answered and says this login is a firm: draw the areas again without the shop cards and read the facts of the cards that remain */
    root.addEventListener('cb-practice', function () {
      if (mode !== 'home' || !S.manifest) return;
      paintAreas();
      facts.read();
    });
    /* the header lands after the tiles: a shop tile that was greyed for want of an id opens now */
    function reopenShopTile() {
      if (mode !== 'home' || !S.manifest || !shopIdOf()) return;
      greyedEntries(el, S.manifest).forEach(function (entry) {
        el.querySelector('.cbsh-box.off[data-id="' + entry.id + '"]').outerHTML = card(entry);
        facts.read(entry.id);
      });
    }
    function mark(id) {
      S.area = id;
      [].forEach.call(el.querySelectorAll('.cbsh-nv'), function (element) {
        if (element.getAttribute('data-go') === id) element.setAttribute('aria-current', 'true');
        else element.removeAttribute('aria-current');
      });
    }
    function go(id) {
      id = resolveArea(id, phone.matches, areasShown());
      if (mode !== 'home') {
        root.location.href = homeHref + (id === 'home' ? '' : '#' + id);
        return;
      }
      if (phone.matches) {
        var phoneTab = tabOf(id, true);
        if (phoneTab === 'more' && id !== 'more') openRow(el, id, true);
        main.setAttribute('data-tab', phoneTab);
        main.scrollTop = 0;
        mark(phoneTab);
        placeKural();
        return;
      }
      /* W9: a firm's Home does not draw the Setup section (books-practice.js); asking for Setup shows it, any other area hides it again */
      root.document.documentElement.classList.toggle('bp-setup', id === 'setup');
      var element = $('.cbsh-sec.' + id);
      /* the chosen area stays lit while the scroll it started runs, and at the end of the page (where Labs cannot reach the top) */
      S.pin = id;
      S.pinUntil = Date.now() + 1200;
      if (element) main.scrollTo({ top: id === 'home' ? 0 : element.offsetTop - 6 });
      mark(id);
    }
    function spy() {
      if (phone.matches || mode !== 'home') return;
      if (S.pin && Date.now() < S.pinUntil) return;
      var bottom = main.scrollTop > 0 && main.scrollTop + main.clientHeight >= main.scrollHeight - 4;
      if (S.pin && bottom && S.pin !== 'home') return;
      S.pin = null;
      var y = main.scrollTop + 40,
        cur = 'home';
      areasShown().forEach(function (id) {
        var element = $('.cbsh-sec.' + id);
        if (element && element.offsetParent && element.offsetTop <= y) cur = id; /* W9: a section not drawn (a firm's Setup) is never the one in view */
      });
      if (bottom) cur = areasShown().filter(function (id) { var e = $('.cbsh-sec.' + id); return e && e.offsetParent; }).slice(-1)[0] || cur;
      mark(cur);
    }

    /* ── the switcher (inside an app): the five areas as links to Home, the app's own menu stays the app's ── */
    function paintSwitcher() {
      var element = $('.cbsh-swb'),
        target = $('.cbsh-swpop');
      if (!element) return;
      var me = ((S.manifest && S.manifest.entries) || []).filter(function (e) {
        return e && e.id === host.app;
      })[0];
      var cur = (me && me.area) || o.area || 'home';
      /* the app's name: its manifest entry; else the page's own title (SHELL-ONE: a lab, a page with no card); else the area */
      var icon = (me && me.icon) || (o.title && o.title.icon) || ICON[cur],
        name = (me && me.name) || (o.title && o.title.name) || W.areas[cur];
      element.innerHTML =
        '<span aria-hidden="true">' +
        glyph(icon) +
        '</span><span class="sn">' +
        esc(T(name)) +
        '</span><span class="chev" aria-hidden="true">▼</span>'; /* through the catalogue: an area is a word (walk-locale) */
      element.setAttribute('title', T(name));
      element.setAttribute('aria-label', W.switcher);
      target.innerHTML = shellChip('POP116', 'align-self:flex-end;margin:2px 4px') + areasShown()
        .map(function (item) {
          return (
            '<a href="' +
            esc(homeHref + (item === 'home' ? '' : '#' + item)) +
            '" data-cbsid="CMP033-M01"' + shellMount('CMP033') + ' data-testid="shell-switch-' +
            item +
            '"' +
            (item === cur ? ' aria-current="true"' : '') +
            '><span class="i" aria-hidden="true">' +
            glyph(ICON[item]) +
            '</span>' +
            esc(W.areas[item]) +
            '</a>'
          );
        })
        .join('');
    }
    function swOpen(v) {
      var element = $('.cbsh-swb'),
        target = $('.cbsh-swpop');
      if (!element) return;
      target.hidden = !v;
      element.setAttribute('aria-expanded', v ? 'true' : 'false');
    }
    /* the frame's words through the catalogue again (a pack landed after the first paint): ⌂ Home, the bar's title, the switcher, the areas */
    frameResay = function () {
      var homeWord = $('.cbsh-tohome .hw'),
        homeLink = $('.cbsh-tohome'),
        titleWord = $('.cbsh-title .tw');
      if (homeWord) homeWord.textContent = T(W.areas.home);
      if (homeLink) homeLink.setAttribute('aria-label', T(W.areas.home));
      var skipLink = doc && doc.querySelector('[data-testid="skip-link"]'); /* added before any pack can land: said again with the rest of the frame */
      if (skipLink) skipLink.textContent = T(W.skip);
      if (titleWord && o.title) titleWord.textContent = T(o.title.name || '');
      paintSwitcher();
      AREAS.concat(['more']).forEach(function (area) {
        var label = $('.cbsh-nv[data-go="' + area + '"] .t');
        if (label) label.textContent = T(W.areas[area]);
      });
      if (mode === 'home') resayTiles(el, S.manifest);
    };

    /* ── the kural: the footer band on a laptop; once, at the foot of Home, on a phone ── */
    function placeKural() {
      /* CL3: kural:false = the PAGE owns the band (CBFrame's skeleton pages put it at the body's foot) — a resize must never pull it up into the header */
      if (o.kural === false) return;
      var K = root.CBKural,
        element = K && K.el && K.el();
      if (!element) return;
      var spot =
        phone.matches && mode === 'home' ? $('.cbsh-pfoot') : $('.cbsh-foot'); /* always the footer: above the tab bar on a phone, under the page elsewhere */
      if (spot && element.parentNode !== spot) {
        spot.appendChild(element);
        if (K.refresh) K.refresh();
      }
    }

    function get(url) {
      var full = /^https?:/.test(url) ? url : base + url;
      return root.fetch(full, { headers: token ? { Authorization: 'Bearer ' + token } : {} }).then(function (reply) {
        if (!reply.ok) {
          var e = new Error('HTTP ' + reply.status);
          e.status = reply.status;
          e.retryAfter = Math.min(10, Number(reply.headers && reply.headers.get && reply.headers.get('Retry-After')) || 0);
          throw e;
        }
        return reply.json();
      });
    }
    function loadManifest() {
      var m = o.manifest || '/app/manifest.json';
      if (typeof m === 'object') return Promise.resolve(m);
      return root.fetch(m).then(function (reply) {
        if (!reply.ok) throw new Error('HTTP ' + reply.status);
        return reply.json();
      });
    }

    /* ── events ── */
    if (who)
      who.addEventListener('click', function () {
        setOpen(!S.open);
      });
    /* a fact line's own button sits inside the card's link: it goes where it says, the card does not */
    el.addEventListener('click', function (e) {
      var element = e.target.closest && e.target.closest('.cbsh-box .f .act');
      if (!element) return;
      e.preventDefault();
      e.stopPropagation();
      root.location.href = element.getAttribute('data-href');
    });
    var scrim = $('.cbsh-scrim');
    if (scrim)
      scrim.addEventListener('click', function () {
        setOpen(false);
      });
    $('.cbsh-lic').addEventListener('click', function (e) {
      if (e.target.closest('.cbsh-chip')) setOpen(true);
    });
    var onKey = function (e) {
      if (e.key === 'Escape') {
        if (S.open) setOpen(false);
        swOpen(false);
      }
    };
    doc.addEventListener('keydown', onKey);
    var nav = $('.cbsh-nav');
    if (nav)
      nav.addEventListener('click', function (e) {
        var element = e.target.closest('.cbsh-nv');
        if (element) go(element.getAttribute('data-go'));
      });
    el.addEventListener('click', function (e) {
      var rowButton = e.target.closest && e.target.closest('.cbsh-row');
      if (rowButton) openRow(el, rowButton.getAttribute('data-row'));
    });
    if (main && mode === 'home') {
      main.addEventListener('scroll', spy, { passive: true });
      ['wheel', 'touchstart'].forEach(function (item) {
        main.addEventListener(
          item,
          function () {
            S.pin = null;
            S.pinUntil = 0;
          },
          { passive: true }
        );
      });
    }
    var swb = $('.cbsh-swb');
    if (swb)
      swb.addEventListener('click', function () {
        swOpen($('.cbsh-swpop').hidden);
      });
    doc.addEventListener('click', function (e) {
      if (swb && !e.target.closest('.cbsh-sw')) swOpen(false);
    });
    var onMedia = function () {
      if (mode === 'home') {
        var shownTab = tabOf(S.area, phone.matches);
        main.setAttribute('data-tab', shownTab);
        mark(shownTab);
        if (!phone.matches) go(S.area);
      }
      placeKural();
      setOpen(false);
    };
    if (phone.addEventListener) phone.addEventListener('change', onMedia);

    /* ── units the page loaded: the avatar (always), the bell, the sign-in window, the kural ── */
    if (root.CBAvatar && root.CBAvatar.mount) {
      var ao = { person: person, items: ['profile', 'settings', 'support', 'signout'], apiBase: base, token: token };
      Object.keys(o.avatar || {}).forEach(function (item) {
        ao[item] = o.avatar[item];
      });
      root.CBAvatar.mount($('.cbsh-av'), ao);
    } else if (root.console) root.console.error('CBShell: load /app/avatar.js before the shell — the avatar is CBAvatar, never drawn here');
    if (root.CBBell && root.CBBell.mount)
      root.CBBell.mount(slots.bell, { apiBase: base, token: token, person: person }); /* person null = signed out: no bell, even with a token still saved */
    /* ⭐ M14: signed out, the shell's own slot holds THE ONE SIGN-IN WINDOW (CBSignin.mount) — the page hands its contract through
       o.signin (surface · need · onIn · deviceId …); the avatar's Sign in door only brings the person to it. */
    /* signin:false (FX-UX2) — a public section that loads the sign-in unit for its own use (CB Settings › New shop reads CBSignin.sessionOf): no window over it */
    if (!person && mode !== 'bar' && o.signin !== false && root.CBSignin && typeof root.CBSignin.mount === 'function') {
      var so = { apiBase: base, surface: 'index', need: 'person' };
      Object.keys(o.signin || {}).forEach(function (item) {
        so[item] = o.signin[item];
      });
      root.CBSignin.mount($('.cbsh-signin'), so);
    }

    var sidesApi = sides
      ? root.CBSides.mount(
          { left: $('[data-slot="sideL"]'), right: $('[data-slot="sideR"]'), btnL: $('[data-slot="btnL"]'), btnR: $('[data-slot="btnR"]') },
          { apiBase: base, token: token }
        )
      : null;

    paintBar();
    paintSheet();
    if (mode === 'home') paintAreas();
    var hashArea = (root.location && (root.location.hash || '').replace('#', '')) || '';
    var first = startArea(o.area, hashArea, phone.matches);
    if (mode === 'home') {
      var firstTab = tabOf(first, phone.matches);
      main.setAttribute('data-tab', firstTab);
      mark(firstTab);
    }

    var kuralP =
      mode !== 'bar' && o.kural !== false && root.CBKural && root.CBKural.mount
        ? root.CBKural.mount({ route: o.kural || 'planning', host: phone.matches && mode === 'home' ? $('.cbsh-pfoot') : $('.cbsh-foot') })
            .then(placeKural)
            .catch(function () {})
        : Promise.resolve();

    var manP = loadManifest()
      .then(
        function (reply) {
          S.manifest = reply && reply.entries ? reply : { entries: [] };
          if (root.CBEdition) root.CBEdition.use(S.manifest);
        },
        function () {
          S.manifest = null;
        }
      )
      .then(function () {
        S.loadingApps = false;
      })
      .then(function () {
        paintEdition();
        if (mode === 'home') {
          paintAreas();
          if (first !== 'home') go(first);
          facts.read();
        }
        if (mode === 'app') paintSwitcher();
      });

    var hdrP = person
      ? get('/api/entities/header')
          .then(
            function (reply) {
              S.header = reply || null;
              S.headerState = reply ? 'ok' : 'none';
            },
            function () {
              S.header = null;
              S.headerState = 'none';
            }
          )
          .then(function () {
            paintBar();
            paintSheet();
            paintMoneyGlyphs(doc, S.header);
            reopenShopTile();
          })
      : Promise.resolve();
    doc.addEventListener('cb:me', function () {
      paintCountryWords(doc);
    }); /* NAMES-1: the shop's country landed — Stock becomes Inventory for a US shop */

    var api = {
      el: el,
      slots: slots,
      mode: mode,
      open: function () {
        setOpen(true);
      },
      close: function () {
        setOpen(false);
      },
      isOpen: function () {
        return S.open;
      },
      go: go,
      route: routeOf,
      area: function () { return S.area; },
      header: function () {
        return S.header;
      },
      headerState: function () {
        return S.headerState;
      },
      manifest: function () {
        return root.CBEdition && S.manifest ? root.CBEdition.view(S.manifest) : S.manifest;
      } /* N18: the Home page reads the manifest's top-level `rail` from the one copy the shell fetched — never a second fetch; AX1: the edition's entries only */,
      edition: edition,
      facts: function (url) { return facts.once(url); } /* l16 firmhome: the Home page's Your work read shares the card's one ask (and its retry on SERVER_BUSY) */,
      sides: sidesApi,
      ready: Promise.all([manP, hdrP, kuralP, sidesApi ? sidesApi.ready : null]).then(function () {
        return api;
      })
    };
    return loadShortcuts(api);
  }

  /** MNT-63: the keyboard-shortcut unit rides with the frame, so every page has it: the register first, then the unit, which mounts on this shell */
  function loadShortcuts(shell) {
    var appendScript = function (src, next) {
      var tag = doc.createElement('script');
      tag.src = src;
      tag.onload = next;
      doc.head.appendChild(tag);
    };
    if (root.CBShortcuts) root.CBShortcuts.mount(shell);
    else
      appendScript('/app/shortcuts-register.js', function () {
        appendScript('/app/shortcuts.js', function () {
          root.CBShortcuts.mount(shell);
        });
      });
    paintWorking();
    return shell;
  }

  /* l16 R4-2b: the client being worked on is in the header, marked, with one press back to Clients (the practice list on Home). The books-acting unit names it (enter / leave); the bar is the shell's own, so no second header is built. */
  var working = null;
  function paintWorking() {
    var bar = doc.querySelector('.cbsh-bar'),
      old = doc.querySelector('[data-testid="shell-working"]');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    if (!bar || !working) return;
    var link = doc.createElement('a');
    link.className = 'cbsh-working';
    link.href = '/';
    link.setAttribute('data-cbsid', 'CMP033-B01');
    link.setAttribute('data-testid', 'shell-working');
    link.setAttribute('aria-label', working + '. ' + W.backToClients);
    link.title = working + '. ' + W.backToClients;
    link.innerHTML = '<b>' + esc(working) + '</b><span aria-hidden="true">&nbsp;✕</span>';
    var grow = bar.querySelector('.cbsh-grow');
    bar.insertBefore(link, grow || null);
    if (typeof stampMounts === 'function') stampMounts(link.parentNode);
  }
  function setWorking(name) {
    working = name || null;
    paintWorking();
  }
  /* ⭐ THE ONE FAILED-READ FRAME (firm frame P0, T2): every page that cannot read something draws THIS, never its own wording and never the server's raw word.
     readFailed(host, { what, status, detail, retry, back })
       what    the thing that could not be read, already in the person's words ("Your practice", "Your client list")
       status  the HTTP status (0 / absent = no answer): 403 says access and uses the server's own sentence (detail); 429, 5xx and no answer say "could not be read, nothing was changed"
       detail  the server's sentence for a 403 (never invented here); anything else is not printed
       retry   a function: draws Try again (CMP009-B01), never on a 403 refusal (asking again does nothing), only 429/5xx/offline; back  { href, label }: the way out
     A 401 is not a failed read: the caller sends the person to the signed-out window. An empty list is not a failed read: it draws its own empty state. */
  /** the sentence a failed read says: a 403 uses the server's own words (detail), anything else says it could not be read and nothing was changed */
  function readFailedSentence(options, refused) {
    if (refused) return String(options.detail || '').trim() || T('You do not have access to this. Nothing was opened.');
    return T('{what} could not be read. Nothing was changed.').replace('{what}', options.what || T('This page'));
  }
  /** the way out of a failed read: a link, only when the page gave one */
  function readFailedBack(options) {
    return options.back && options.back.href ? '<a class="cbsh-rf-back" href="' + esc(options.back.href) + '" data-testid="read-failed-back" style="margin-inline-start:12px">' + esc(options.back.label || T('Back')) + '</a>' : '';
  }
  function readFailed(host, options) {
    if (!host) return null;
    options = options || {};
    var status = Number(options.status) || 0,
      refused = status === 403,
      sentence = readFailedSentence(options, refused),
      back = readFailedBack(options);
    host.innerHTML =
      '<div class="cbsh-readfail" data-testid="read-failed" data-status="' + (refused ? '403' : status >= 500 ? '5xx' : status === 429 ? '429' : 'none') + '" role="alert" style="padding:12px 0">' +
      '<p style="margin:0 0 10px">' + esc(sentence) + '</p>' +
      (typeof options.retry === 'function' && !refused ? '<button type="button" class="btn" data-cbsid="CMP009-B01" data-testid="read-failed-retry">' + esc(T('Try again')) + '</button>' : '') + back + '</div>';
    var again = host.querySelector('[data-testid="read-failed-retry"]');
    if (again) again.onclick = options.retry;
    return host.firstChild;
  }
  root.CBShell = {
    setWorking: setWorking,
    readFailed: readFailed,
    mount: mount,
    apiBase: apiBase,
    WORDS: W,
    AREAS: AREAS.slice(),
    PHONE_TABS: PHONE_TABS.slice(),
    PHONE_MORE: PHONE_MORE.slice(),
    sectionOf: sectionOf
  };
})(typeof window !== 'undefined' ? window : this);
