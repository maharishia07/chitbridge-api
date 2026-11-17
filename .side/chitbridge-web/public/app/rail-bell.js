/* public/app/rail-bell.js — CBBell: the bell, mountable in any header
 * ID        CMP030 (the bell button; its rows are CMP038, its Clear CMP014)
 * OWNER     cb-ux-locale
 * OWNS      the bell's dot and list: one read on mount, one per arrival, the clear and the seen mark
 * CALLED BY app/shell.js (CBBell.mount into the bar slot, shell.js:1531) on the pages that load it by script tag: accounts, authority-forms, catalogue, crm, employees, finance, know-your-business, network, operations, settings, standards, tasks
 * CARD      01-rail-core-the-chit/rail-bell
 * RISK      personal-data
 * FLOW      POST /api/events/ticket -> SSE stream -> the dot and the list -> amounts through fmtMoney in the notice's currency
 *
 * rail-bell.js — CBBell.mount: THE BELL, mountable in any header.
 *
 * DESIGN-rail-modules-2026-10-05 §2.1 (CBBell): "the dot + the list, mountable in any header." Before this file only app.html and the
 * counter listened for the server's push; accounts.html and crm.html had no bell, so a message or a dispute raised on a chit was
 * invisible there. Now any page mounts one.
 *
 * THE API IS CORRECT AND IS NOT REIMPLEMENTED HERE (routes/events.js · routes/notifications.js):
 *   POST /api/events/ticket          -> { ticket }        a one-time ticket, so the token never rides the URL
 *   GET  /api/events/stream?t=ticket -> SSE; `hello` once, then `cb` { kind, id, who } on every arrival (never your own action)
 *   GET  /api/notifications          -> { notifications[], count }   the Activity feed; `count` = what arrived since the last look
 *   POST /api/notifications/seen     -> moves the watermark (opening IS seeing)
 *   POST /api/notifications/dismiss  { log_ids[] | all:true }       clears this entity's view; the events are kept
 *
 * THE BELL NEVER POLLS. One read when it mounts, one on each `cb` arrival (SSE is live), one on opening, one after a clear. A dropped
 *   stream is re-ticketed with backoff — that is a reconnect, not a poll; nothing here sets an interval.
 * A NOTIFICATION IS SHOWN ONLY TO A SIGNED-IN PERSON OF THE SHOP: no token, or a customer login -> nothing is drawn, no stream opened.
 *   The server decides the rows (per-entity under RLS); this paints what it was handed, never more.
 *
 *   CBBell.mount(el, {
 *     onOpen?(chit_id),     // a row was pressed — the host opens the chit (default: openChitSheet, then openChit, when the page has one)
 *     person?,              // the host's signed-in person; passed as null = signed out → nothing drawn, nothing read
 *     apiBase?, token?,     // a page without core.js (the Home shell) hands these, as it does to CBAvatar; the call is then a plain bearer fetch
 *     context: { host }     // who mounted it
 *   }) -> { refresh(), destroy(), count(), el }      Emits `cb:rail` { module:'bell', result:{ count } } on el when the count changes.
 *
 * Reuse: api/EP (core.js) · CBAction (accounts-shell.js: the clear is a write) · CBLocale · the Activity wording of app.html's mapNotif.
 * ZERO app.html globals: no UI, paintDetail, modal. The app and the counter keep their own bell until R10 / M62 swap them for this.
 */
(function (root) {
  'use strict';
  var bellKit = root.CBBellKit; /* created by rail-bell-html.js, which loads first */
  bellKit.call = call;
  bellKit.doc = root.document;

  /* the four routes, ONE name each — the names app.html registers; a page without them gets them at mount (the attach-ui pattern) */
  /* built by row() so a second literal of the same route is not declared: these are app.html's four names, registered only when the page has not (e2e/ep-aliases.cjs) */
  function row(method, path) {
    return { m: method, p: path, ok: 'y' };
  }
  var BELL_EP = {
    eventsTicket: row('POST', '/api/events/ticket'),
    notifications: row('GET', '/api/notifications'),
    notifSeen: row('POST', '/api/notifications/seen'),
    notifDismiss: row('POST', '/api/notifications/dismiss'),
    flagsList: row('GET', '/api/flags') /* a reply on my firm's note finds the note's client here (the same read the firm's work list makes) */,
    practice: row('GET', '/api/books-grants/practice') /* a firm's notice names its client; the practice list says which client that is (paged) */
  };
  function ensureEP() {
    if (typeof EP === 'undefined' || !EP) return false;
    for (var k in BELL_EP) if (!EP[k]) EP[k] = BELL_EP[k];
    return true;
  }

  /** the token of a signed-in person of the shop, or null (signed out, or a customer login) */
  /**
   * THE CALL. On a page with core.js (crm · accounts · the app) it is api() — the auth, the envelope, the 401 path, all of it. A page
   * without core.js (the Home shell, index.html) hands the shell's apiBase + token, the way CBAvatar is given them, and the call is a
   * plain fetch with the bearer that unwraps the same {ok,data,error} envelope.
   */
  /** ?a=1&b=2 of a plain object (the raw-fetch form of a call has no api() to do it); empty values are left out */
  function queryOf(query) {
    var text = Object.keys(query || {})
      .filter(function (key) {
        return query[key] !== '' && query[key] != null;
      })
      .map(function (key) {
        return encodeURIComponent(key) + '=' + encodeURIComponent(query[key]);
      })
      .join('&');
    return text ? '?' + text : '';
  }
  function call(host, name, opts) {
    if (!host.apiBase && typeof api === 'function') return api(name, opts);
    var route = BELL_EP[name],
      tokenOf = whoToken(host),
      base = host.apiBase || host.base || (typeof CFG !== 'undefined' && CFG && CFG.API_BASE) || '';
    return root
      .fetch(base + route.p + queryOf(opts && opts.query), {
        method: route.m,
        cache: 'no-store',
        headers: { Authorization: 'Bearer ' + tokenOf, 'Content-Type': 'application/json' },
        body: opts && opts.body ? JSON.stringify(opts.body) : undefined
      })
      .then(function (reply) {
        return reply
          .json()
          .catch(function (failure) {
            if (root.cbQuiet) root.cbQuiet('bell:reply-json', failure);
            return {};
          })
          .then(function (j) {
            if (!reply.ok || (j && j.ok === false)) {
              var er = new Error((j && ((j.error && j.error.message) || j.error)) || 'HTTP ' + reply.status);
              er.status = reply.status;
              er.code = j && (j.code || (j.error && j.error.code));
              throw er;
            }
            return j && 'ok' in j && 'data' in j ? j.data : j;
          });
      });
  }
  /* every bell on the page; a bell whose element left the page (its header was redrawn) is closed, so a repaint never leaves a second stream open */
  var LIVE = [];
  function sweep() {
    LIVE.slice().forEach(function (item) {
      if (!item.el.isConnected) item.destroy();
    });
  }

  function whoToken(host) {
    if (Object.prototype.hasOwnProperty.call(host, 'person') && !host.person) return null; // the host says nobody is signed in (a token may still be saved)
    var tokenOf = host.token || (typeof SESSION !== 'undefined' && SESSION && SESSION.token) || null;
    var role = (typeof SESSION !== 'undefined' && SESSION && SESSION.role) || '';
    return tokenOf && role !== 'customer' ? tokenOf : null;
  }

  /** a Query notice pressed on a page that cannot open the thread arrives as ?mark=<entry id> (the owner's Accounts): read and forgotten from the address, the bell opens that thread once. A client's Day book (?open=) reads its own &mark= (books-grant-view.js) */
  function askedMark() {
    var id = '';
    try {
      var query = new root.URLSearchParams(root.location.search);
      if (query.get('open') || !query.get('mark')) return '';
      id = query.get('mark');
      query.delete('mark');
      if (root.history && root.history.replaceState) root.history.replaceState(root.history.state, '', root.location.pathname + (query.toString() ? '?' + query.toString() : '') + (root.location.hash || ''));
    } catch (_) { /* no address to read (a test host): nothing arrived */ }
    return id;
  }

  function mount(el, opts) {
    el = typeof el === 'string' ? bellKit.doc.getElementById(el) : el;
    if (!el) return null;
    opts = opts || {};
    if (el.__cbbell) el.__cbbell.destroy();
    sweep();
    bellKit.addCss();
    ensureEP();
    var bell = { rows: [], count: 0, open: false, es: null, up: false, backoff: 5000, timer: null, dead: false, err: false, out: '', tone: '' };
    if (!el.getAttribute('data-testid')) el.setAttribute('data-testid', 'bell');
    /* a host's own slot keeps its name (the shell's is shell-bell) */ if (!/\bcbb\b/.test(el.className))
      el.className = (el.className ? el.className + ' ' : '') + 'cbb';

    function paint() {
      if (bell.dead) return;
      el.innerHTML = bellKit.bellButtonHtml(bell) + (bell.open ? bellKit.panelHtml(bell) : '');
    }
    function setCount(total) {
      total = Number(total) || 0;
      if (total === bell.count) return;
      bell.count = total;
      try {
        el.dispatchEvent(new CustomEvent('cb:rail', { bubbles: true, detail: { module: 'bell', result: { count: total } } }));
      } catch (_) { /* the repaint event is a courtesy to the host; its listener's fault must not stop the bell */ }
    }
    /** ONE read of the feed (never polled) */
    function read() {
      if (bell.dead || !whoToken(opts)) return Promise.resolve();
      return call(opts, 'notifications')
        .then(function (reply) {
          if (bell.dead) return;
          bell.err = false;
          bell.rows = (reply && reply.notifications) || [];
          setCount(reply && reply.count != null ? reply.count : bell.rows.length);
          paint();
        })
        .catch(function () {
          if (bell.dead) return;
          bell.err = true;
          paint();
        });
    }
    /* the stream: ticket -> EventSource; an arrival re-reads once; a drop re-tickets with backoff (a reconnect, not a poll) */
    function connect() {
      if (bell.dead || bell.es || !root.EventSource || !whoToken(opts)) return;
      call(opts, 'eventsTicket')
        .then(function (reply) {
          if (bell.dead || bell.es) return;
          if (!reply || !reply.ticket) {
            retry();
            return;
          }
          var base = opts.apiBase || opts.base || (typeof CFG !== 'undefined' && CFG && CFG.API_BASE) || '';
          var node = new root.EventSource(base + '/api/events/stream?t=' + encodeURIComponent(reply.ticket));
          bell.es = node;
          node.addEventListener('hello', function () {
            bell.up = true;
            bell.backoff = 5000;
          });
          node.addEventListener('cb', function () {
            read();
          });
          node.onerror = function () {
            try {
              node.close();
            } catch (_) { /* already closed by the browser: the retry below opens a fresh stream */ }
            bell.es = null;
            bell.up = false;
            retry();
          };
        })
        .catch(retry);
    }
    function retry() {
      if (bell.dead || !whoToken(opts)) return;
      clearTimeout(bell.timer);
      bell.timer = setTimeout(connect, bell.backoff);
      bell.backoff = Math.min(bell.backoff * 2, 60000);
    }

    function toggle() {
      bell.open = !bell.open;
      bell.out = '';
      bell.tone = '';
      paint();
      /* OPENING IS SEEING: looking moves the watermark, so the dot clears without a "mark all read" button */
      if (bell.open) {
        call(opts, 'notifSeen')
          .then(function () {
            setCount(0);
            paint();
          })
          .catch(function (failure) { if (root.cbQuiet) root.cbQuiet('bell:seen', failure); /* a failed clear leaves the list as it was; the next read says the truth */ });
        read();
      }
    }
    function onClick(event) {
      event.__cbbIn = true; /* this press was ours: its target is repainted away, so the document handler cannot tell by contains() */
      var node = event.target;
      if (!node.closest) return;
      if (node.closest('[data-testid="bell-btn"]')) {
        toggle();
        return;
      }
      if (bellKit.pressRow(bell, opts, node, paint)) return;
      var clear = node.closest('[data-testid="bell-clear"]');
      if (clear && !clear.disabled) clearAll(clear);
    }
    function clearAll(btn) {
      if (typeof CBAction === 'undefined' || !CBAction || typeof CBAction.run !== 'function')
        throw new Error('CBBell needs CBAction (app/accounts-shell.js) on the page — a clear is a write');
      CBAction.run(
        btn,
        function () {
          return call(opts, 'notifDismiss', { body: { all: true } });
        },
        {
          key: 'bell:clear',
          confirm: { title: bellKit.bellText(bellKit.BELL_WORDS.ask), body: esc(bellKit.bellText(bellKit.BELL_WORDS.askBody)), yes: bellKit.bellText(bellKit.BELL_WORDS.clear) },
          outcome: function () {
            bell.rows = [];
            bell.out = bellKit.bellText(bellKit.BELL_WORDS.cleared);
            bell.tone = 'ok';
            setCount(0);
            paint();
          },
          onFail: function (w, e) {
            bell.out = e && e.code === 'NOTIF_DISMISS_NOT_MIGRATED' ? bellKit.bellText(bellKit.BELL_WORDS.needs) : w;
            bell.tone = 'error';
            paint();
          }
        }
      );
    }
    /* a click in a dialog (the Clear all confirm) is not a click away: the panel stays to show what the clear did */
    function onDoc(ev) {
      if (bell.open && !ev.__cbbIn && !el.contains(ev.target) && !(ev.target.closest && ev.target.closest('dialog'))) {
        bell.open = false;
        paint();
      }
    }
    function onKey(ev) {
      if (bell.open && ev.key === 'Escape') {
        bell.open = false;
        paint();
      }
    }

    el.addEventListener('click', onClick);
    bellKit.doc.addEventListener('click', onDoc);
    bellKit.doc.addEventListener('keydown', onKey);
    var apiObj = {
      el: el,
      refresh: read,
      count: function () {
        return bell.count;
      },
      destroy: function () {
        bell.dead = true;
        clearTimeout(bell.timer);
        if (bell.es) {
          try {
            bell.es.close();
          } catch (_) { /* a stream that will not close is dropped with the bell anyway */ }
        }
        bell.es = null;
        el.removeEventListener('click', onClick);
        bellKit.doc.removeEventListener('click', onDoc);
        bellKit.doc.removeEventListener('keydown', onKey);
        el.innerHTML = '';
        delete el.__cbbell;
        var i = LIVE.indexOf(apiObj);
        if (i >= 0) LIVE.splice(i, 1);
      }
    };
    el.__cbbell = apiObj;
    LIVE.push(apiObj);
    if (!whoToken(opts)) {
      el.innerHTML = '';
      return apiObj;
    } // signed out / a customer: no bell, no stream
    paint();
    var arrived = askedMark();
    read().then(function () {
      if (arrived && root.CBMark && typeof api === 'function')
        bellKit.openMark(bell, opts, { getAttribute: function (name) { return name === 'data-mark-id' ? arrived : ''; } }).catch(function () {
          if (typeof root.toast === 'function') root.toast(bellKit.bellText(bellKit.BELL_WORDS.markFail));
        });
    });
    connect();
    return apiObj;
  }

  root.CBBell = { mount: mount, line: bellKit.line, EP: BELL_EP, markTitle: bellKit.markTitle };
})(typeof window !== 'undefined' ? window : this);
