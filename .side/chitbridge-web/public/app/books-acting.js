/**
 * books-acting.js — ACC-176b: THE ONE PLACE THAT KNOWS WHICH STORE'S BOOKS THIS SCREEN IS WORKING IN.
 *
 * OWNS      the acting context (store, currency, role) · the headers and the `store_id` every request of that store carries · the frozen "Acting for <store>, <currency>" banner with its store switch · the clearing of drafts and cached data when the store changes · the one minor-units-in-words helper of the books screens · this business's own entity
 * CALLED BY books-grant-view.js (the firm's workspace) · books-actions-view.js (the queues) · network-app.js (opens and switches the store) · accounts.html + core.js (the books page opened to act for a store: banner, headers)
 * FLOW      enter(store, role) → headers() / body() are built from THIS context only → a different store runs every registered clear (drafts, caches, open sheets) before the new one is set → leave() clears and forgets
 * CARD      04-network/ACC-176B-ADVISER-REQUIREMENT
 *
 * Why one object: data must never mix between clients. A request is never built from two places (a header from one, a body from another); both come from the same context, and the server refuses a mismatch with STORE_MISMATCH.
 * The owner works in his own books: role 'owner', no header, his own entity as the store. The server decides who may; nothing here grants anything.
 *   CBBooksActing.confirmGrant · .openPage · .firstTab · .posts · .keepTabs · .mayCall · .guard · .enter · .leave · .current · .headers · .body · .onClear · .setCurrency · .banner · .wireBanner · .figure · .postAsk · .ownStore · .isAdviser · .prepare · .paintPrepared · .startPage · .roleOf · .clientStores · .refusals · .hides · .refusedFor
 */
(function (root) {
  'use strict';
  var context = null;
  var clears = [];

  function words(s) {
    return typeof root.tx === 'function' ? root.tx(s) : s;
  }
  /** register what must be forgotten when the store changes (a draft, a cached answer, an open sheet); returns the way to take it off */
  function onClear(fn) {
    clears.push(fn);
    return function () {
      clears = clears.filter(function (item) {
        return item !== fn;
      });
    };
  }
  function clearAll() {
    clears.slice().forEach(function (fn) {
      fn();
    });
  }
  /** work in this store's books as this role ('adviser' · 'auditor' · 'owner'); another store than the one in hand clears everything of the first, first */
  /** the header names the client being worked on (shell.js setWorking); nothing for the owner's own books */
  function showWorking() {
    if (root.CBShell && root.CBShell.setWorking) root.CBShell.setWorking(context && context.role !== 'owner' && context.store.name ? context.store.name : null);
  }
  function enter(store, role, posting) {
    if (context && String(context.store.id) !== String(store.id)) clearAll();
    try { root.sessionStorage.setItem('cb_last_client', String(store.id)); } catch (failure) { if (root.cbQuiet) root.cbQuiet('acting:last', failure); }
    context = { store: { id: String(store.id), name: store.name }, role: role, posting: posting || '', currency: context && context.store.id === String(store.id) ? context.currency : '' };
    showWorking();
    return context;
  }
  function leave() {
    clearAll();
    context = null;
    showWorking();
  }
  function current() {
    return context;
  }
  /** the headers of a request into the store's books: the firm names the store and the role; the owner and nobody else sends none */
  function headers() {
    var out = {};
    if (!context || context.role === 'owner') return out;
    out[root.CBBooksGrantApi.HEADER] = context.store.id;
    if (context.role === 'adviser') out[root.CBBooksGrantApi.ROLE_HEADER] = 'adviser';
    return out;
  }
  /** the seat's own token, and nothing else (a private call, a file read that carries no store): the ONE place a books screen reads the session's token */
  function tokenHeader() {
    var token = typeof SESSION !== 'undefined' && SESSION ? SESSION.token : '';
    return token ? { Authorization: 'Bearer ' + token } : {};
  }
  /** the token plus the acting headers: every read and write into a store's books goes out with exactly these */
  function authHeaders() {
    return Object.assign(tokenHeader(), headers());
  }
  /** a write's body: `store_id` is the store this screen is open on, so a stale tab is refused by the server instead of saved */
  function body(fields) {
    return Object.assign({ store_id: context && context.store.id }, fields);
  }
  function setCurrency(code) {
    if (context && code) context.currency = code;
  }

  /** a figure the way the books screens paint it: the server's minor units as a money value that carries its OWN currency (fmtMoney reads the exponent from the code; never a guessed symbol) */
  function figure(minor, code) {
    if (minor == null || minor === '') return '—';
    return typeof root.fmtMoney === 'function' ? root.fmtMoney({ amount_minor: String(minor), currency: code }) : String(minor) + (code ? ' ' + code : '');
  }
  /** the question before an adviser POSTS straight into a client's books (adviser_posts): the amount from the preview (the server's total, in its currency), the client, "straight into", and a danger yes; owner_approves asks nothing */
  function postAsk(preview) {
    var actingTag = context ? context.store.name : '';
    var amount = preview && preview.total_dr_minor != null ? figure(preview.total_dr_minor, preview.currency) : '';
    return {
      title: words('Post') + (amount ? ' ' + amount : ' ' + words('this entry')) + ' ' + words('for') + ' ' + actingTag + '?',
      body: '<b>' + esc(words('This goes straight into')) + ' ' + esc(actingTag) + esc("'s books.") + '</b> ' + esc(words('Nobody approves it first. Every action is recorded.')),
      yes: words('Post'),
      danger: true
    };
  }
  /** this business's own entity, read from the sign-in token: the owner's own books are the store of his queue */
  function ownStore(token, name) {
    var claims = (typeof root.jwtPayload === 'function' && root.jwtPayload(token)) || {};
    return { id: claims.parent_entity_id || claims.identity_id, name: name };
  }

  /* ── acting on another page: the address carries the store, the server checks the grant on every request ── */
  /** the books page of the firm's workspace for one store (optionally straight into preparing a journal) */
  function addressOf(store, doing) {
    return '/accounts.html?acting=' + encodeURIComponent(store.id) + (doing ? '&prepare=' + doing : '') + '#/daybook';
  }
  /** W15-71: the auditor's way to the client's Bank (and Month lock) on the books page: the same page, the auditor's seat, read only */
  function auditAddressOf(store, tab, carry) {
    return '/accounts.html?acting=' + encodeURIComponent(store.id) + '&role=auditor' + (carry || '') + '#/' + (tab || 'bank');
  }
  /** E10: the screen and the period the firm was reading ride the address to Bank and back (&view= and &fy= or &from=&to=), so the way back returns to the same year, not the year under review */
  function carriedOf(search) {
    var query = new root.URLSearchParams(search || ''), out = '';
    ['view', 'fy', 'from', 'to'].forEach(function (key) { if (query.get(key)) out += '&' + key + '=' + encodeURIComponent(query.get(key)); });
    return out;
  }
  /** read the store from the page address: a page opened with ?acting=<store> works in that store's books; null when it carries none.
   * &role=auditor|adviser names the seat; with no &role (a typed, pasted or deep-linked address) the seat is the one the grant gives (confirmGrant). The address never grants anything. */
  function fromAddress(search) {
    var query = new URLSearchParams(search || '');
    var id = query.get('acting'), named = query.get('role');
    var entered = id ? enter({ id: id, name: '' }, named === 'auditor' ? 'auditor' : 'adviser') : null;
    if (entered) entered.seatNamed = named === 'auditor' || named === 'adviser';
    return entered;
  }
  /** a page call(method, path, body, headers) of its own (token + base): no acting header, the grant list is the firm's own */
  function grantCall(base, token) {
    return function (method, path, payload, extra) {
      return root.fetch(base + path, { method: method, cache: 'no-store', headers: Object.assign({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, extra || {}), body: payload ? JSON.stringify(payload) : undefined }).then(function (reply) {
        return reply.json().catch(function (e) { return { message: String(e && e.message) }; }).then(function (j) {
          if (!reply.ok) throw Object.assign(new Error(j.message || 'API ' + reply.status), { status: reply.status, code: j.code });
          return j;
        });
      });
    };
  }
  /** the page opened with ?acting=<id> enters only when the firm holds a LIVE ADVISER grant on that id; the banner's name and the grant's posting come from the grant row, never from the address. false: not entered (context dropped) */
  function confirmGrant(base, token) {
    if (!context) return Promise.resolve(false);
    return root.CBBooksGrantApi.heldSplit(grantCall(base, token)).then(enterSeat);
  }
  /** the grants list answered: enter the seat this login's door gives (or the one the address names), or not at all */
  function enterSeat(split) {
    if (split.unread) throw Object.assign(new Error('the grant list could not be read'), { unread: true });
    var id = context.store.id, heldBy = split.live || {}, seats = (split.seats || {})[id] || {};
    var door = root.CBBooksGrantApi.doorsFor(split, id, ''), role = seatRole(door); /* the ONE seat rule: only a door this login may use (the server's may_use) */
    var grant = door.doors.indexOf(role) >= 0 ? seats[role] : null; /* a seat the address names must be a door this login may use */
    if (!grant) {
      context = null;
      return false;
    }
    context.role = role;
    context.store.name = grant.grantor_name || root.CBBooksGrantApi.withHeld([], heldBy, words)[0].name;
    context.posting = grant.posting || '';
    showWorking();
    return true;
  }
  /** the seat: the address's own when it names one, else the seat this login's door gives (the adviser's, when both are open) */
  function seatRole(door) {
    if (context.seatNamed) return context.role === 'auditor' ? 'auditor' : 'adviser';
    return door.open || (door.doors.indexOf('adviser') >= 0 ? 'adviser' : 'auditor'); /* no &role on the address: the seat this login's door gives */
  }
  /** this store's grant lets the adviser POST (the owner chose adviser_posts); anything else prepares */
  function posts() {
    return !!context && context.role === 'adviser' && context.posting === 'adviser_posts';
  }
  /** the acting page shows only what is read and written through /api/books*: the tabs that call anything else are taken out of the menu, so no request outside it carries the store's header */
  var OWNER_SENTENCE = 'Only the owner may record this.';
  var TABS = ['daybook', 'ledgers', 'tb', 'pl', 'bs', 'dues', 'lock'];
  /** the Bank tab opens for an acting ADVISER (reads and posts through /api/books/bank/*, /events and /payments) and for an AUDITOR (reads only: bank/log and the kept statements; W15-71, every write control is left out) */
  function tabOpen(tab) {
    if (context && context.role === 'auditor') return tab === 'bank' || tab === 'lock'; /* the auditor's other reads are the network's own books view; here only what needs the books page: the Bank and the Month lock, read only */
    return TABS.indexOf(tab) >= 0 || (tab === 'bank' && !!context && context.role === 'adviser');
  }
  function mayCall(path) {
    return !context || context.role === 'owner' || path.indexOf('/api/books') === 0;
  }
  /** no live grant for the store the address names: one sentence where the page is, the way back, nothing read */
  function refuseInPlace(unread) {
    var host = root.document.getElementById('content');
    if (!host) return root.location.replace('/network.html');
    host.innerHTML = '<div class="en-why" data-testid="' + (unread ? 'acting-unread' : 'acting-refused') + '"></div>';
    root.CBShell.readFailed(host.firstChild, { what: words('Your client list'), status: unread ? 0 : 403, retry: unread ? function () { root.location.reload(); } : null, back: { href: '/network.html', label: words('Back to My network') } });
  }
  /** the menu entry the address names (an auditor with none lands on Bank) */
  function openingScreen(menu) {
    var asked = String(root.location.hash || '').replace(/^#\/?/, '').split(/[/?]/)[0], hit = null;
    for (var i = 0; i < menu.length; i++) if (menu[i][0] === asked) hit = menu[i];
    if (!hit && context && context.role === 'auditor') hit = ['bank', 'Bank'];
    return hit;
  }
  /** the first second of a client's books, before the grant read answers: the screen's own word as the title and the page's skeleton rows, never the bare "Accounts" frame (first-impression W8; the grant read is untouched) */
  function paintOpening(menu) {
    var doc = root.document, title = doc && doc.getElementById('title'), host = doc && doc.getElementById('content');
    if (!title || !host) return;
    var hit = openingScreen(menu);
    if (hit) title.textContent = words(hit[1]);
    host.innerHTML = '<div class="bk-skel" aria-busy="true" data-testid="acc-opening"><i></i><i></i><i></i><i></i><i></i><i></i></div>';
  }
  /** the page's way in: only on a live adviser grant, then the menu is cut to the books tabs; false = not entered */
  function openPage(base, token, menu, groups) {
    if (!context) return Promise.resolve(true);
    paintOpening(menu);
    var unread = false;
    return confirmGrant(base, token).catch(function (e) {
      unread = !!(e && e.unread);
      if (typeof root.cblog === 'function') root.cblog('error', 'acting: the grant could not be read: ' + ((e && e.message) || e));
      return false;
    }).then(function (entered) {
      if (entered) {
        keepTabs(menu, groups);
        return true;
      }
      refuseInPlace(unread);
      return new Promise(function () {}); /* the page stops here: nothing of the client's books is read or drawn */
    });
  }
  /** a call outside /api/books* is refused here, before it is sent, while the page acts for a store */
  function guard(endpoint) {
    if (!mayCall(endpoint.p)) throw new Error(words('This screen shows one client books only. Nothing was sent.'));
    return endpoint;
  }
  function firstTab() {
    return context && context.role === 'auditor' ? 'bank' : context && context.role !== 'owner' ? TABS[0] : 'todo';
  }
  function keepTabs(menu, groups) {
    if (!context || context.role === 'owner') return;
    for (var i = menu.length - 1; i >= 0; i--) if (!tabOpen(menu[i][0])) menu.splice(i, 1);
    for (var g = groups.length - 1; g >= 0; g--) {
      groups[g][1] = groups[g][1].filter(tabOpen);
      if (!groups[g][1].length) groups.splice(g, 1);
    }
  }

  /* ── the banner: frozen at the top of every screen that acts for a store ── */
  function roleWord(role) {
    return words(role === 'adviser' ? 'accountant' : 'auditor');
  }
  function switchBox(stores) {
    if (!stores || stores.length < 2) return '';
    return (
      '<label class="ba-sr" for="ba_switch">' + esc(words('Switch client')) + '</label><select data-cbsid="NET006-S01" id="ba_switch" class="inp" data-testid="ba-switch" title="' + esc(words('Switch client')) + '">' +
      stores.map(function (item) {
        return '<option value="' + esc(item.id) + '"' + (String(item.id) === context.store.id ? ' selected' : '') + '>' + esc(item.name) + (item.role ? ' (' + esc(roleWord(item.role)) + ')' : '') + '</option>';
      }).join('') + '</select>'
    );
  }
  /** l16 R4-2b: the client's books page (one level above a screen of the client's books): the network page opened on that client; the practice list is Home */
  function clientAddress(store, carry) {
    return '/network.html?open=' + encodeURIComponent(store.id) + (carry || '');
  }
  /** the breadcrumb on every client screen: Clients › <client> › <screen>. Clients leaves the client (to the practice list, Home); the client name is a link on a screen of the books, plain on the client's own page */
  function crumbs(screen, onScreen) {
    var actingTag = esc(context.store.name || '');
    return (
      '<nav class="ba-crumbs" data-testid="ba-crumbs" aria-label="' + esc(words('Clients')) + '" title="' + actingTag + (screen ? ' › ' + esc(screen) : '') + '"><a href="/" data-testid="crumb-clients">' + esc(words('Clients')) + '</a> <span aria-hidden="true">›</span> ' +
      (onScreen ? '<a href="' + esc(clientAddress(context.store, carriedOf(root.location.search))) + '" data-testid="crumb-client">' + actingTag + '</a>' : '<span data-testid="crumb-client">' + actingTag + '</span>') +
      (screen ? ' <span aria-hidden="true">›</span> <span id="ba_screen" aria-current="page" data-testid="crumb-screen">' + esc(screen) + '</span>' : '') + '</nav>'
    );
  }
  /** W19: the header line's empty, named slot for the period control (W14/W8 fill it); it takes the free room and pushes the way back to the right */
  function periodSlot() {
    return '<span class="bv-slot" id="bv_period_slot" data-testid="bv-period-slot"></span>';
  }
  /** the screen's name in the breadcrumb, when the screen changes without a repaint of the band */
  function setScreen(label) {
    var node = root.document.getElementById('ba_screen');
    if (node && label) node.textContent = label;
  }
  /** the band's one way back goes up ONE level: from a screen of the books to the client's page, from the client's page to the practice list */
  function backLabel(onScreen) {
    return onScreen ? (context.store.name || words('Clients')) : words('Clients');
  }
  /** the banner's markup: who this is for, in which currency, a way to another store (when the firm holds more than one), the breadcrumb and the way back one level (screen: the screen's name; onScreen: this is a screen of the books page, not the client's own page) */
  function banner(stores, screen, onScreen, extra) {
    if (!context) return '';
    headerCss();
    var actingTag = context.role === 'auditor'
      ? '<span class="tag bv-ro" data-testid="bv-readonly">' + esc(words('read only')) + '</span>'
      : '<b class="bv-ro ba-acting" data-testid="ba-acting" title="' + esc(words('Acting for') + ' ' + context.store.name + (context.currency ? ', ' + context.currency : '')) + '"><span class="ba-sr">' + esc(words('Acting for')) + ' ' + esc(context.store.name) + (context.currency ? ', ' + esc(context.currency) : '') + '</span><span aria-hidden="true">' + esc(roleWord(context.role)) + (context.currency ? ' · ' + esc(context.currency) : '') + '</span></b>';
    return (
      '<div class="bv-band ba-band" id="ba_band" role="status" data-testid="ba-band">' + crumbs(screen, onScreen) + actingTag + (extra || '') + periodSlot() +
      '<span class="ba-tools">' + switchBox(stores) + '<button data-cbsid="NET006-B01" type="button" class="act quiet" id="ba_back" data-testid="ba-back">← ' + esc(backLabel(onScreen)) + '</button></span></div>'
    );
  }
  /** ONE header line for a firm in a client's books (T6, first data by 20% / 30%): who and where, the date, the period and the way back on a single 28 px line; a phone's second line holds the screen pick and the period. Drawn once for both pages (network.html, accounts.html). */
  function headerCss() {
    var doc = root.document;
    if (!doc || doc.getElementById('ba-hdr-css')) return;
    var style = doc.createElement('style');
    style.id = 'ba-hdr-css';
    style.textContent =
      '.ba-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}' +
      '.bv-band.bv-band{flex-wrap:nowrap;gap:0 8px;min-height:28px}.bv-band .ba-crumbs{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.bv-band .ba-crumbs,.ba-acting .ba-crumbs{display:flex;align-items:baseline;gap:0 4px}.ba-crumbs>*{flex:none}.ba-crumbs>[data-testid=crumb-client]{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}.ba-crumbs #ba_screen{min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis}' +
      '.bv-band .ba-acting{font-size:13px;white-space:nowrap}.bv-band .bv-ctx{flex:none;flex-wrap:nowrap;white-space:nowrap}.bv-band .bv-slot{flex:1 1 0;min-width:120px}.bv-band .ba-tools{flex:0 1 auto;min-width:0;max-width:100%;flex-wrap:wrap;gap:6px}' +
      '@media (min-width:701px){.bv-band .ba-tools{flex-wrap:nowrap}.bv-band .ba-tools .act{flex:none;white-space:nowrap}}.bv-band #ba_switch{max-width:min(170px,100%);min-width:0;min-height:28px}.bv-band .bv-tabsel{display:none}.bv-band .bv-lock{flex:0 1 auto;min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.bv-marks{min-height:28px}.bv-marks .mk-bar{margin:0}.bv-dues-side{margin:0}.bv-dues-side>h3.sub{margin:8px 0 4px}.bv-dues-nil{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}.bv-dues-nil>h3.sub{margin:8px 0 4px}' +
      '@media (max-width:700px){.bv-band.bv-band{flex-wrap:wrap;gap:4px 8px}.bv-band .ba-crumbs{flex:1 1 calc(100% - 210px);order:1}.bv-band .bv-ro,.bv-band .ba-acting{order:2}.bv-band .ba-tools{order:3}' +
      '.bv-band .bv-ctx{display:none}.bv-band #ba_switch{display:none}.bv-band .bv-lock{order:6;flex:1 1 100%}.bv-band .bv-tabsel{display:block;order:4;flex:1 1 45%;min-width:0}.bv-band .bv-slot{order:5;flex:1 1 45%;min-width:0}.bv-band .bv-tabsel .cbs,.bv-band .bv-slot .cbs{margin:0}.bv-band .bv-tabsel select,.bv-band .bv-slot select{width:100%;max-width:none}}';
    doc.head.appendChild(style);
  }
  /** wire the banner just drawn in `host`: Back, and the switch (a different store is entered, which clears the first one's drafts and caches, then the page repaints) */
  function wireBanner(host, o) {
    var back = host.querySelector('#ba_back');
    var box = host.querySelector('#ba_switch');
    if (back) back.onclick = o.onBack;
    if (box)
      box.onchange = function () {
        o.onSwitch(box.value, box.options[box.selectedIndex].text.replace(/ \([^)]*\)$/, ''));
      };
  }

  /** this page acts for a store as the adviser */
  function isAdviser() {
    return !!context && context.role === 'adviser';
  }
  /** an adviser's Save: POST /api/books-actions { store_id, kind: 'journal', body, client_ref, working_month } through the screen's own api; the journal's date is required; under the grant's adviser_posts the server posts it at once (state accepted, with its entry), otherwise it waits for review and the owner's accept */
  async function prepare(api, tx, entry, month) {
    if (entry.event !== 'journal') throw new Error(tx('An accountant prepares journals. Pick Journal.'));
    if (!entry.date) throw new Error(tx('Give the journal its date.'));
    var journal = Object.assign({}, entry);
    delete journal.event;
    delete journal.client_ref;
    var made = await api('booksActionPrepare', { body: body({ kind: 'journal', body: journal, client_ref: entry.client_ref, working_month: month }) });
    return Object.assign({ prepared: true, posted: made.state === 'accepted' && !!(made.entry || made.entry_no) }, made);
  }
  /** the screen after an adviser's Save: posted (adviser_posts: the answer carries its entry) or prepared and waiting */
  function paintPrepared(host, acts, saved, tell, esc2) {
    var done = '<button data-cbsid="CMP004" class="en-btn pri" data-testid="en-done" onclick="enClose()">' + esc2(tell('Done')) + '</button>';
    if (saved.posted) {
      var no = saved.entry_no || (saved.entry && (saved.entry.entry_no || saved.entry.no)) || '';
      host.innerHTML = '<h3 data-testid="en-posted"><span class="en-ok">✓</span> ' + esc2(tell('Posted')) + ' ' + esc2(no) + '</h3><div class="en-why" style="border:0;margin-top:10px">' + esc2(tell('It is now in the books of')) + ' ' + esc2(context ? context.store.name : '') + '.</div>';
      acts.innerHTML = done;
      return;
    }
    host.innerHTML =
      '<h3 data-testid="en-prepared"><span class="en-ok">✓</span> ' + esc2(tell('Prepared, waiting for review')) + '</h3><div data-testid="en-prepared-ref" class="en-chip">' + esc2(saved.client_ref || '') + '</div>' +
      '<div class="en-why" style="border:0;margin-top:10px">' + esc2(tell('A colleague reviews it, then the owner accepts. It is not posted until then.')) + '</div>';
    acts.innerHTML = done;
  }
  /** a page opened to act for a store (accounts.html): the frozen banner under the header, the way back, and, when asked (?prepare=journal), the journal sheet that PREPARES; byId is the page's element finder, openSheet its entry opener, currency the shop's */
  function startPage(byId, openSheet, currency, labelOf) {
    if (!context) return;
    setCurrency(currency);
    var shell = byId('shell');
    var band = root.document.createElement('div');
    band.id = 'acting-band';
    band.setAttribute('data-testid', 'acting-band');
    band.innerHTML = banner(undefined, labelOf ? labelOf((root.location.hash || '').replace(/^#[/]?/, '').split('/')[0]) : '', true);
    if (context.role === 'auditor') band.setAttribute('data-readonly', 'true');
    shell.parentNode.insertBefore(band, shell.nextSibling);
    wireBanner(band, { onBack: function () { root.location.assign(clientAddress(context.store, carriedOf(root.location.search))); } });
    if (/[?&]prepare=journal/.test(root.location.search)) openSheet({ kind: 'journal' });
  }
  /** the role a held grant gives on one store: an adviser grant acts, anything else reads */
  function roleOf(held, id) {
    return (held[String(id)] || {}).preset === 'adviser' ? 'adviser' : 'auditor';
  }
  /** EVERY client a firm holds a live grant on, with its role, for the banner's switch (one client: no switch is drawn) */
  function clientStores(stores, held) {
    return stores.filter(function (s) { return held[String(s.entity_id)]; }).map(function (s) { return { id: s.entity_id, name: (held[String(s.entity_id)].grantor_name) || s.name, role: roleOf(held, s.entity_id) }; });
  }
  /** the preview's "Only the owner may record this." does not stop an acting ADVISER: Save prepares (or posts under adviser_posts) through the actions door, not through POST /events */
  function refusals(list) {
    if (!isAdviser()) return list;
    return (list || []).filter(function (item) { return String(item && item.message ? item.message : item) !== OWNER_SENTENCE; });
  }
  /** one sentence out of the catalogue with its {holes} filled */
  function fill(sentence, holes) {
    var text = words(sentence);
    Object.keys(holes).forEach(function (key) { text = text.split('{' + key + '}').join(holes[key]); });
    return text;
  }
  /** who an adviser posted an entry for, as the api stamps it (posted_by { name, firm } | null): the adviser sees "by Pat Lee for <client>", the owner "Posted by Pat Lee, <firm>"; '' for an entry nobody posted for the client */
  function postedByWords(entry, short) {
    var actingTag = entry && entry.posted_by;
    if (!actingTag || !actingTag.name) return '';
    if (context && context.role === 'adviser') return short ? fill('by {name}', { name: actingTag.name }) : fill('by {name} for {client}', { name: actingTag.name, client: context.store.name });
    return actingTag.firm && actingTag.firm !== actingTag.name ? fill('Posted by {name}, {firm}', { name: actingTag.name, firm: actingTag.firm }) : fill('Posted by {name}', { name: actingTag.name });
  }
  /** a tab this page does not offer while acting for a client (the bank for neither role now; the books-only pages for both) */
  function hides(tab) {
    return !!context && context.role !== 'owner' && !tabOpen(tab);
  }
  /** what a hidden tab shows if it is reached by an address anyway: one sentence, nothing is read or sent */
  function hiddenView(host) {
    host.innerHTML = '<div class="en-why" data-testid="acting-hidden">' + esc(words('This page is not part of the client books you work in. Nothing was sent.')) + '</div>';
  }
  /** the refusal sentence names the real role */
  function refusedFor() {
    return words(context && context.role === 'adviser' ? 'This part of the books is not open to an accountant.' : 'This part of the books is not open to an auditor.');
  }

  root.CBBooksActing = { carriedOf: carriedOf, clientAddress: clientAddress, setScreen: setScreen, crumbs: crumbs, periodSlot: periodSlot, css: headerCss, isAdviser: isAdviser, posts: posts, confirmGrant: confirmGrant, openPage: openPage, guard: guard, firstTab: firstTab, keepTabs: keepTabs, mayCall: mayCall, prepare: prepare, paintPrepared: paintPrepared, startPage: startPage, roleOf: roleOf, clientStores: clientStores, refusals: refusals, hides: hides, postedByWords: postedByWords, hiddenView: hiddenView, refusedFor: refusedFor, enter: enter, leave: leave, current: current, headers: headers, tokenHeader: tokenHeader, authHeaders: authHeaders, body: body, onClear: onClear, setCurrency: setCurrency, addressOf: addressOf, auditAddressOf: auditAddressOf, fromAddress: fromAddress, banner: banner, wireBanner: wireBanner, figure: figure, postAsk: postAsk, ownStore: ownStore };
})(typeof window !== 'undefined' ? window : globalThis);
