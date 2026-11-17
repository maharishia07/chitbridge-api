/**
 * OWNS      window.CBList: mount (a list: toolbar · header · rows · columns chooser · paging) · nextRow · get · reset · every (reads every page of a server-paged list) · pager (the Previous / Next pair, CMP037 B06 and B07), and the Task table drawing (tbl*).
 * CALLED BY every page that loads it with <script src>: accounts.html · app.html (the Task table) · catalogue.html · crm.html · employees.html · finance.html · list-lab.html · network.html · offer-lab-next.html · operations.html · settings.html · standards.html · tasks.html · testing.html; cap-attach.js loads it with loadScript when CBList is not there yet (CBList.mount · CBList.every · CBList.pager).
 * FLOW      a page loads the script → CBList.mount(el, opts) draws the toolbar, header and rows from the rows the page hands it (nothing is read from the page) → a press on search, sort, filter or ⚙ columns repaints the list in place → a server-paged page asks CBList.every or draws CBList.pager and keeps what each press does.
 * CARD 29-qa-test-tooling-ux-locale-and-design-system/list-control
 * ── ⭐⭐⭐ CBList — THE LIST CONTROL, AS A SELF-SUSTAINING UNIT ───────────────────────────────────────────────────────
 *
 * Athi, 2026-10-02: *"can we keep it as a control so it can be used anywhere … with its own ui/ux and as a self
 * sustaining unit"* · *"whenever such type of control established anywhere, it is a must that column adjustable should
 * be there, and also, the scrolling should be allowed only below the column header … create a control in place so i
 * don't need to repeat."*   docs/design/list-control/PLAN.md is the contract; docs/design/list-standard/index.html is the
 * FROZEN look (the pass mark); public/list-lab.html is this file on a bare page.
 *
 * ONE FILE, ONE GLOBAL: `window.CBList`. Nothing else is exported and NOTHING IS READ FROM THE PAGE: not its escaping, its
 * translator, its toast, its storage prefix, its stylesheet. A page that lacks every global it used to supply still gets a
 * working list (e2e/list-unit.cjs); a page that makes this file reach for one fails e2e/list-unit-breaks.cjs.
 *
 *   CBList.mount(el, { key, rows, columns, view, group, filters, sorts, search, next, actions, bulk, onOpen,
 *                      head:{ title, period, notices, slot(el) }, t, store, ... }) → { refresh, destroy, state, open(id, on) }
 *
 * THE AVATAR SLOT: `head.slot(el)` is called with an empty span at the END of the title row (pushed to the far edge) every time the
 * title row is drawn — a page with no chrome of its own mounts CBAvatar there, and the head stays three rows. The unit draws the span
 * and reads nothing from the page: what goes in it is the page's business.
 *
 * WHAT A PAGE DECLARES: its columns (key · label · prio · w · num · keep · sort · cell(row)); keep:true = never left out for width (a status, a code, the row's action), its grouping, filters, sorts, notices,
 * period, what a row opens to (`next`), row actions and bulk operations. WHAT THE UNIT OWNS, FOR EVERY LIST, AND NO LIST
 * CAN OPT OUT OF: the three-row head, ADJUSTABLE COLUMNS (drag, touch, ← → in 8 px, double-click resets, never narrower than
 * the label, remembered), ONLY THE ROWS SCROLL (the head is fixed, the rows fill the rest of the window, the column header
 * is sticky inside the one scroller), the ⚙ chooser (Shown / Available / Reset), ▤ grid / ☰ lines, ⇣ / ⇡ expand all (when
 * the list has a next level), phone cards (a container query, not the page width), lazy rows (50 at a time, the count is the
 * true one), the four states (loading under a kept header · empty · no match + Clear · could not load + Try again),
 * keyboard (↑ ↓ Enter · Esc · ← → on a column edge) and ARIA.
 *
 * ESCAPING IS ITS OWN JOB: every value painted here goes through this file's `esc`. A column renders trusted markup only if it
 * says so (`html: true`), and `next(row)` is trusted markup by contract: the page that builds it escapes its own data.
 *
 * SAVED VIEWS (T3-COMPAT): `views:{ items:[{ key, label, filt, tip, rows? }], tid, inTitle }` — a tab sets the list's own filters. STD-COMPARE
 * (2026-10-15): a view may carry its OWN rows (`rows: () => [...]`, a second data file mapped onto its own columns): while that tab is lit — its
 * `filt` in force, other filters may be added — the unit draws those rows instead of the mount's, and the tab counts them. A view without `rows`
 * is unchanged: a filter over the mount's rows, lit only when the filters are exactly its own.
 *
 * SERVER-PAGED LISTS (Platform): pass `remote:{ total, onQuery(q), foot() }`. The unit then neither filters nor sorts: it draws
 * the page it was given in its own look, asks the page's pager for the next one through `onQuery`, and paints `foot()` below.
 *   `remote.filters: true` (T3) also draws the Filters control: each choice is handed to `onQuery` ({ filt, sort }), never applied here.
 */
(function (root) {
  'use strict';
  var wire; /* wire: set from app/list-ctl-wire.js at the end of this file */
  var colByKey, cssId, onClick, refocusRz, resize; /* click: set from app/list-ctl-click.js at the end of this file */
  if (root.CBList) return;

  /* ── its own words: every string is written here in English and goes through the host's translator (opts.t) when one is given (see T) ── */
  /* ── its own escaping ── the ONE esc's twin, kept on purpose: CBList is a self-contained unit (e2e/list-unit.cjs proves it reads nothing from its page);
     e2e/prim-homes.cjs allows exactly this copy, and it escapes what app/helpers.js esc does (& < > " ') */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var PHONE_MAX = 700; /* px: the standard's phone width (ui.js SIZE_CSS); the 44 px tap rule and the View popover both start here */
  /* ── UX-137 IDENTITY ── every control below carries data-cbsid, the code of its component element in the one register (CMP045-CMP039 are this
     unit's own; CMP009 Try again and CMP014 Clear are reused). The mount (data-cbmount) is the screen's code from the screen chip + U1nn; a
     page without the chip has no mount, the element keeps its code. Nothing is read from a page global: this is a DOM attribute, read at paint. */
  function mountAttribute(code) {
    var chip = root.document && root.document.querySelector && root.document.querySelector('[data-testid="screen-id"][data-cbsid]');
    var screen = chip ? chip.getAttribute('data-cbsid') : '';
    return /^[A-Z]{3}\d{3}$/.test(screen || '') ? ' data-cbmount="' + screen + '-U1' + String(code).slice(-2) + '"' : '';
  }
  function plain(h) {
    return String(h == null ? '' : h)
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* ── its own memory: browser storage under its own prefix, an in-memory fallback when storage throws ── */
  var MEM = {};
  function lsGet(k) {
    try {
      var v = root.localStorage.getItem(k);
      return v == null ? null : JSON.parse(v);
    } catch (_) {
      return MEM[k] === undefined ? null : MEM[k];
    }
  }
  function lsSet(k, v) {
    MEM[k] = v;
    try {
      root.localStorage.setItem(k, JSON.stringify(v));
    } catch (_) { /* storage blocked or full: the page works without it */ }
  }

  /* ── the look: injected ONCE (#cblist_css), design tokens only, a fallback for every one, so a bare page renders right ── */
  if (!root.CBListParts || !root.CBListParts.css) throw new Error('app/list-ctl-css.js must load before app/list-ctl.js');
  var CSS = root.CBListParts.css(PHONE_MAX); /* the stylesheet text lives in app/list-ctl-css.js (shrink W2, 2026-11-17) */
  function injectCss() {
    var d = root.document;
    if (!d || !d.head || d.getElementById('cblist_css')) return;
    var node = d.createElement('style');
    node.id = 'cblist_css';
    node.textContent = CSS.replace(/\.cbl(?![\w-])/g, '.cbl:not(#_)');
    d.head.appendChild(node);
  }

  /* ── small helpers ── */
  function px(w, dflt) {
    if (typeof w === 'number') return w;
    var m = /(\d+(?:\.\d+)?)\s*px/.exec(String(w || ''));
    return m ? parseFloat(m[1]) : dflt || 140;
  }
  function val(x) {
    return typeof x === 'function' ? safe(x, undefined) : x;
  }
  function safe(fn, dflt) {
    try {
      var v = fn();
      return v === undefined ? dflt : v;
    } catch (_) {
      return dflt;
    }
  }
  function cmpVals(a, b) {
    var na = typeof a === 'number' ? a : parseFloat(String(a).replace(/[^\d.-]/g, '')),
      nb = typeof b === 'number' ? b : parseFloat(String(b).replace(/[^\d.-]/g, ''));
    if (typeof a === 'number' || (isFinite(na) && isFinite(nb) && /^[\s\d.,\-−₹$€£]+$/.test(String(a)) && /^[\s\d.,\-−₹$€£]+$/.test(String(b)))) {
      return (na || 0) - (nb || 0);
    }
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  }

  var INST = []; /* every live mount; pruned when its element leaves the document */
  var STATE = {}; /* key → the choices that must survive a repaint (search, filters, open rows) */

  function prune() {
    INST = INST.filter(function (item) {
      if (item.dead) return false;
      if (!root.document.documentElement.contains(item.el)) {
        teardown(item);
        return false;
      }
      return true;
    });
  }
  function teardown(I) {
    I.dead = true;
    try {
      if (I.io) I.io.disconnect();
    } catch (_) { /* best effort: failing here changes nothing the user sees */ }
    clearTimeout(I.qt);
    try {
      var node = I.el.querySelector(':scope > .cbl-list');
      if (node && node.__cblRO) node.__cblRO.disconnect();
    } catch (_) { /* best effort: failing here changes nothing the user sees */ }
    (I.off || []).forEach(function (x) {
      try {
        I.el.removeEventListener(x[0], x[1]);
      } catch (_) { /* best effort: failing here changes nothing the user sees */ }
    });
    I.off = [];
  }

  /** the object mount gives back: refresh · destroy · el · filter · state · mark · open — what a page does with a mounted list */
  function apiOf(inst, rstate, el) {
    return {
      refresh: function (x) {
        return refresh(inst, x);
      },
      destroy: function () {
        teardown(inst);
        INST = INST.filter(function (y) {
          return y !== inst;
        });
        if (el.__cbl === inst) {
          el.__cbl = null;
          el.innerHTML = '';
          el.classList.remove('cbl');
        }
      },
      el: el,
      /* filter(key, value) — a page sets (or, with '' , clears) one of its own filters: the header line of Receivables presses "no tax invoice" */
      filter: function (name, value) {
        if (value) rstate.filt[name] = value;
        else delete rstate.filt[name];
        resetLimit(inst);
        paintAll(inst);
      },
      state: function () {
        return {
          cols: inst.s.cols.slice(),
          widths: JSON.parse(JSON.stringify(inst.s.widths)),
          view: inst.s.view,
          group: inst.s.group,
          sort: inst.s.sort,
          q: rstate.q,
          filt: JSON.parse(JSON.stringify(rstate.filt))
        };
      },
      /* mark(id) — l16 R4-2b: the row the person last worked on is highlighted, brought into view (the page of rows is widened if it lies past it) and takes keyboard focus; false when no such row */
      mark: function (id) {
        var rowId = String(id),
          at = '[data-row="' + cssId(rowId) + '"]';
        rstate.hl = rowId;
        paintAll(inst);
        if (!el.querySelector(at)) {
          inst.limit = Math.max(inst.limit || 50, allRows(inst).length);
          paintAll(inst);
        }
        var node = el.querySelector(at);
        if (!node) return false;
        if (node.scrollIntoView) node.scrollIntoView({ block: 'center' });
        node.focus();
        return true;
      },
      /* open(id, on) — a page opens (or closes, on === false) one row's next level itself: the call desk's Next moves to the row that follows (W1-CRM) */
      open: function (id, on) {
        var rowId = String(id);
        if (isOpen(inst, rowId) !== (on !== false)) toggleRow(inst, rowId, true);
        else {
          rstate.hl = rowId;
          refocusRow(inst, rowId);
        }
      }
    };
  }
  /* ═════ MOUNT ═════ */
  function mount(el, o) {
    if (!el || !o) return null;
    injectCss();
    prune();
    var key = String(o.key || el.id || 'list');
    el.innerHTML = '';
    if (el.__cbl) {
      teardown(el.__cbl);
      INST = INST.filter(function (x) {
        return x !== el.__cbl;
      });
    }
    var inst = { el: el, o: o, key: key, pop: null, limit: 50, nextCache: {}, dead: false };
    var R = STATE[key] || (STATE[key] = { q: '', filt: {}, open: {}, allOpen: false, sel: {}, selMode: false, gcol: {}, hl: null });
    inst.r = R;
    /* a host may open the list already narrowed (a link from another page: Home's Suppliers -> the CRM list of suppliers): opts.preset = { filt:{ key: value } } replaces the remembered filters */
    if (o.preset && o.preset.filt) {
      R.filt = {};
      Object.keys(o.preset.filt).forEach(function (item) {
        R.filt[item] = o.preset.filt[item];
      });
    }
    inst.s = loadChoices(inst);
    el.__cbl = inst;
    el.classList.add('cbl');
    el.setAttribute('data-cbl', key);
    wire(inst);
    INST.push(inst);
    paintAll(inst);
    var api = apiOf(inst, R, el);
    inst.api = api;
    return api;
  }

  /* the choices a person made, remembered per list key: through opts.store when the host gives one, else under our own prefix */
  function skey(I) {
    return 'cblist.' + (I.o.scope ? I.o.scope + '.' : '') + I.key;
  }
  /** the page's own first order (opts.sortDefault: { key, dir }) when the person has not chosen one; null when it names none */
  function sortDefaultOf(o) {
    return o.sortDefault && o.sortDefault.key ? { key: o.sortDefault.key, dir: o.sortDefault.dir === -1 ? -1 : 1 } : null;
  }
  /** the view a person chose (lines or grid), else the page's, else grid */
  function savedView(saved, o) {
    if (saved.view === 'lines' || saved.view === 'grid') return saved.view;
    return o.view === 'lines' ? 'lines' : 'grid';
  }
  /** the choices a person made on this list, read from the page's store or from this unit's own memory; the page's defaults for what was never chosen */
  function loadChoices(I) {
    var o = I.o,
      saved = null;
    if (o.store && typeof o.store.get === 'function')
      saved = safe(function () {
        return o.store.get(I.key);
      }, null);
    else saved = lsGet(skey(I));
    saved = saved && typeof saved === 'object' ? saved : {};
    var s = {
      cols: Array.isArray(saved.cols) && saved.cols.length ? saved.cols.slice() : null,
      widths: saved.widths && typeof saved.widths === 'object' ? saved.widths : {},
      view: savedView(saved, o),
      group: saved.group || (o.group && o.group.default) || null,
      sort: saved.sort && saved.sort.key ? saved.sort : sortDefaultOf(o) /* sortDefault: the page's own first order, until the reader picks one */
    };
    return s;
  }
  function saveChoices(I) {
    var list = I.s,
      v = { cols: list.cols, widths: list.widths, view: list.view, group: list.group, sort: list.sort };
    if (I.o.store && typeof I.o.store.set === 'function')
      safe(function () {
        I.o.store.set(I.key, v);
      });
    else lsSet(skey(I), v);
  }

  /* the host's words, else ours; never a raw key */
  function T(I, s, vars) {
    var text = s;
    if (I.o.t) {
      text = safe(function () {
        return I.o.t(s);
      }, s);
      if (typeof text !== 'string' || !text) text = s;
    }
    if (vars)
      Object.keys(vars).forEach(function (item) {
        text = text.split('{' + item + '}').join(vars[item]);
      });
    return text;
  }

  /* ═════ the data: rows → matched → ordered → grouped items ═════ */
  /* the mount's own rows; allRows = the lit view's own rows when it has them (STD-COMPARE), else these */
  function baseRows(inst) {
    var rows =
      typeof inst.o.rows === 'function'
        ? safe(function () {
            return inst.o.rows();
          }, [])
        : inst.o.rows;
    return Array.isArray(rows) ? rows : [];
  }
  function viewRows(inst) {
    var view = litOwnView(inst);
    if (!view) return null;
    var rows = safe(function () {
      return view.rows();
    }, []);
    return Array.isArray(rows) ? rows : [];
  }
  function allRows(inst) {
    return viewRows(inst) || baseRows(inst);
  }
  function rowIdOf(I, row, i) {
    var v = I.o.id ? I.o.id(row) : row && row.id;
    return String(v == null ? 'r' + i : v);
  }
  function columns(I) {
    return (typeof I.o.columns === 'function' ? I.o.columns() : I.o.columns) || [];
  }
  function pinned(I) {
    return columns(I).filter(function (item) {
      return item.pin === 'end';
    });
  }
  function choosable(I) {
    return columns(I).filter(function (item) {
      return item.pin !== 'end';
    });
  }
  function topKey(I) {
    var list = choosable(I),
      best = null;
    list.forEach(function (item) {
      if (best == null || (item.prio || 99) < (best.prio || 99)) best = item;
    });
    return best ? best.key : null;
  }
  function defaultCols(I) {
    var list = choosable(I),
      keys = list.map(function (item) {
        return item.key;
      }),
      want = val(I.o.defaultCols); /* a function when a view has columns of its own (STD-COMPARE) */
    if (Array.isArray(want) && want.length)
      return want.filter(function (item) {
        return keys.indexOf(item) >= 0;
      });
    var byPrio = list
      .slice()
      .sort(function (first, second) {
        return (first.prio || 99) - (second.prio || 99);
      })
      .slice(0, 3)
      .map(function (item) {
        return item.key;
      });
    return keys.filter(function (item) {
      return byPrio.indexOf(item) >= 0;
    });
  }
  /* the shown columns, in the person's order: stale keys dropped, the top column always present, then any pinned (the amount) at the end */
  function shownKeys(I) {
    var keys = choosable(I).map(function (item) {
        return item.key;
      }),
      set = (I.s.cols || defaultCols(I)).filter(function (item) {
        return keys.indexOf(item) >= 0;
      });
    if (!set.length) set = defaultCols(I);
    var top = topKey(I);
    if (top && set.indexOf(top) < 0) set = [top].concat(set);
    return set;
  }
  /* in card mode (a narrow container) a page may cap the fields a card carries: the highest-priority ones stay, the rest are NAMED in the chooser */
  function noRoomKeys(I) {
    var keys = shownKeys(I),
      max = I.o.cardMax;
    if (!I.card || !max || keys.length <= max) return [];
    var by = {};
    columns(I).forEach(function (item) {
      by[item.key] = item;
    });
    var act = keys.filter(function (item) {
      return (by[item] || {}).cardAct;
    }); /* a column that is the card's action line (a link to what changed) is not counted against cardMax: drawn under the fields, hidden when empty */
    var keep = keys
      .filter(function (item) {
        return act.indexOf(item) < 0;
      })
      .sort(function (first, second) {
        return ((by[first] || {}).prio || 99) - ((by[second] || {}).prio || 99);
      })
      .slice(0, max)
      .concat(act);
    return keys.filter(function (item) {
      return keep.indexOf(item) < 0;
    });
  }
  function shownCols(I) {
    var by = {},
      out = noRoomKeys(I);
    columns(I).forEach(function (item) {
      by[item.key] = item;
    });
    return shownKeys(I)
      .filter(function (item) {
        return out.indexOf(item) < 0;
      })
      .map(function (item) {
        return by[item];
      })
      .filter(Boolean)
      .concat(pinned(I));
  }
  function minW(I, c) {
    return Math.max(64, c.minw || 0 /* a column that declares its floor keeps it (REP-73: the Status heading wrapped) */, String(c.label || c.key).length * 9 + 40);
  }
  /* L16-M7 (Athi, walk 15 Nov): a column is sized from what it holds, between its minimum and a maximum, and ONE column (the name / description) takes the rest of the row.
     A width the person dragged always wins; a column that has not been measured yet (no rows) keeps its declared width. */
  var AUTO_CHAR = 8.4, AUTO_PAD = 32, AUTO_FIRST = 24 /* the first cell also holds the expand caret */, AUTO_MAX = 260, STRETCH_MAX = 420, STRETCH_FLOOR = 28, STRETCH_FLOOR_PX = 240 /* a longer name wraps to a second line rather than hide a column */, AUTO_SAMPLE = 200;
  function plainText(html) {
    return String(html).replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, 'x');
  }
  /** a column that may take the free width: text that reads on, never a number, money, code, status, date or id */
  function stretchable(c) {
    return !c.num && !c.money && !c.mono && c.pin !== 'end' && c.type !== 'num' && c.type !== 'money' && !/^(code|status|state|date|id|no|ref|type)$/i.test(String(c.label || c.key).trim());
  }
  /** what a short column really needs: its three longest cells set on one line in the list's own font (the character estimate runs wide, Age took 242 px for a date and a few words). Returns { key: px }. */
  function inkWidths(list, cols, sample) {
    var host = list.el.querySelector(".cbl-list") || list.el,
      probe = document.createElement('div'),
      out = {};
    probe.className = 'cbl-row';
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:absolute;visibility:hidden;display:block;width:4000px;white-space:nowrap;left:0;top:0';
    host.appendChild(probe);
    cols.forEach(function (c) {
      var longest = sample
        .map(function (row) { return cellOf(list, c, row); })
        .sort(function (first, second) { return plainText(second).length - plainText(first).length; })
        .slice(0, 3);
      out[c.key] = longest.reduce(function (widest, html) {
        probe.innerHTML = '<div class="cbl-cell" style="display:inline-block;width:auto">' + html + '</div>';
        return Math.max(widest, Math.ceil(probe.firstChild.getBoundingClientRect().width) + 2);
      }, 0);
    });
    host.removeChild(probe);
    return out;
  }
  /** the R47 half of autoFit: squeeze `auto` (width per key) into `avail`; returns the keys left out. */
  function fitWidths(list, cols, auto, chars, avail) {
    /* R47: a list always fits its box, and the stretch column (the name) is the LAST to give way, never the first (l16: Collections wrapped the party name at 86 px while Age kept 225).
       Order: 1 the stretch column goes down to its floor (its longest value, at most STRETCH_FLOOR characters); 2 the lowest-priority column is left out and 1 runs again;
       3 only when nothing is left to leave out do the short columns shrink (never the pinned action column), and last the stretch column goes below its floor. A width the person dragged is theirs and is not touched. */
    var fixed = 0, free = [], natural = {}, stretchCol = null;
    cols.forEach(function (c) {
      if (typeof list.s.widths[c.key] === 'number') fixed += widthOf(list, c);
      else { free.push(c); natural[c.key] = auto[c.key]; }
      if (c.key === auto.stretch) stretchCol = c;
    });
    var floor = stretchCol && natural[stretchCol.key] != null ? Math.min(natural[stretchCol.key], STRETCH_FLOOR_PX, Math.round(Math.min(chars[stretchCol.key], STRETCH_FLOOR) * AUTO_CHAR + AUTO_PAD + (stretchCol === cols[0] ? AUTO_FIRST : 0))) : 0;
    var live = free.slice(), hide = [];
    var need = function () { return Math.round(live.reduce(function (t, c) { return t + auto[c.key]; }, fixed)); }; /* whole pixels: 1324.0000000000002 against 1324 left a column out for float noise (Day book Risk) */
    var squeeze = function (shrink) {
      live.forEach(function (c) { auto[c.key] = natural[c.key]; });
      var over = avail > 0 ? need() - avail : 0, others = live.filter(function (c) { return c !== stretchCol && c.pin !== 'end'; });
      if (stretchCol && auto[stretchCol.key] != null && over > 0) {
        auto[stretchCol.key] = Math.max(floor, auto[stretchCol.key] - over);
        over = need() - avail;
      }
      for (var pass = 0; shrink && over > 0 && pass < 4; pass++) {
        var room = others.reduce(function (t, c) { return t + Math.max(0, auto[c.key] - minW(list, c)); }, 0);
        if (room <= 0) break;
        var reduction = Math.min(over, room);
        others.forEach(function (c) {
          var share = Math.max(0, auto[c.key] - minW(list, c));
          auto[c.key] = Math.round(auto[c.key] - (reduction * share) / room);
        });
        over = need() - avail;
      }
      return over;
    };
    var over = squeeze(false);
    while (over > 0 && !list.card && !list.s.cols) { /* a card never leaves a field out for width, and a column the person ticked in the chooser stays (it is squeezed instead) */
      var leave = null;
      live.forEach(function (c) {
        if (c !== stretchCol && c.pin !== 'end' && !c.keep && (!leave || (c.prio || 99) >= (leave.prio || 99))) leave = c;
      });
      if (!leave) break;
      hide.push(leave.key);
      live = live.filter(function (c) { return c !== leave; });
      over = squeeze(false);
    }
    if (over > 0) over = squeeze(true);
    if (over > 0 && stretchCol && auto[stretchCol.key] != null) auto[stretchCol.key] = Math.max(minW(list, stretchCol), auto[stretchCol.key] - over); /* last resort: below its floor */
    return hide;
  }
  /** measure the rows once per paint: I.auto = { width per column key, stretch: key }; returns the columns that fit.
   *  The column that stretches is the one the page names (stretch: true), else the text column that holds the most (the name or description: the data decides). */
  function autoFit(inst, cols, rows, avail) {
    var auto = {},
      sample = rows.slice(0, AUTO_SAMPLE),
      chars = {},
      named = cols.filter(function (item) { return item.stretch; })[0],
      best = null;
    cols.forEach(function (c) {
      var n = String(c.label || c.key).length + 3; /* the header also carries its sort and filter marks */
      sample.forEach(function (row) {
        var cell = cellOf(inst, c, row),
          len = plainText(cell).trim().length + (c.html ? (String(cell).match(/<(?:button|a)[\s>]/g) || []).length * 7 : 0); /* a button in the cell is wider than its words: its padding counts */
        if (len > n) n = len;
      });
      chars[c.key] = n;
      if (!named && stretchable(c) && (!best || n > chars[best.key])) best = c;
    });
    if (!named && !best)
      cols.forEach(function (c) {
        if (!c.num && !c.money && c.pin !== 'end' && (!best || chars[c.key] > chars[best.key])) best = c; /* no text column at all: the widest that is not a number */
      });
    auto.stretch = named ? named.key : best ? best.key : null;
    var shortPx = inkWidths(inst, cols.filter(function (c) { return c.key !== auto.stretch && c.pin !== 'end'; }), sample);
    cols.forEach(function (c) {
      if (typeof inst.s.widths[c.key] === 'number') return;
      var cap = c.key === auto.stretch ? STRETCH_MAX : Math.max(AUTO_MAX, px(c.w, 0));
      auto[c.key] = Math.round(Math.min(cap, Math.max(minW(inst, c), chars[c.key] * AUTO_CHAR + AUTO_PAD + (c === cols[0] ? AUTO_FIRST : 0))));
      if (c.key !== auto.stretch && c.pin !== 'end' && shortPx[c.key]) auto[c.key] = Math.min(auto[c.key], Math.max(minW(inst, c), (String(c.label || c.key).length + 3) * AUTO_CHAR + AUTO_PAD /* the heading with its sort and filter marks stays on one line */, shortPx[c.key] + (c === cols[0] ? AUTO_FIRST : 0))); /* a short column takes its content */
    });
    var hide = fitWidths(inst, cols, auto, chars, avail);
    inst.auto = sample.length ? auto : null;
    inst.leftOut = hide;
    return cols.filter(function (item) { return hide.indexOf(item.key) < 0; });
  }
  /** autoFit, then the toolbar says so when the number of columns left out changed (the "+2" cue) */
  function fitCols(list, cols, rows, box) {
    var before = leftOutKeys(list).length,
      shown = autoFit(list, cols, rows, box.clientWidth - (leadOn(list) ? 34 : 0) - 2);
    if (before !== leftOutKeys(list).length) paintTools(list);
    return shown;
  }
  function widthOf(I, c) {
    var w = I.s.widths[c.key];
    if (typeof w !== 'number' && I.auto && typeof I.auto[c.key] === 'number') w = I.auto[c.key];
    if (typeof w !== 'number') w = Math.max(px(c.w, 140), minW(I, c));
    return Math.max(minW(I, c), w);
  }
  function leadOn(I) {
    return (
      !!(
        I.o.lead &&
        safe(function () {
          return I.o.lead.on();
        }, false)
      ) ||
      (I.o.bulk && I.o.bulk.length && I.r.selMode)
    );
  }
  function template(I, cols) {
    return (
      (leadOn(I) ? '34px ' : '') +
      cols
        .map(function (item) {
          var free = I.auto && I.auto.stretch === item.key && typeof I.s.widths[item.key] !== 'number';
          return free ? 'minmax(' + widthOf(I, item) + 'px,1fr)' : widthOf(I, item) + 'px';
        })
        .join(' ')
    );
  }
  function remote(I) {
    return !!I.o.remote;
  }

  function sortOf(I, cols) {
    var st = I.s.sort,
      sorts = I.o.sorts || [],
      e = null,
      dir = 1,
      cmp = null;
    if (st) {
      dir = st.dir === -1 ? -1 : 1;
      for (var index = 0; index < sorts.length; index++)
        if (sorts[index].key === st.key) {
          e = sorts[index];
          break;
        }
      if (e) cmp = e.cmp;
      else {
        var col = null;
        columns(I).forEach(function (item) {
          if (!col && sortId(item) === st.key) col = item;
        });
        if (col)
          cmp = function (a, b) {
            return cmpVals(sortVal(col, a), sortVal(col, b));
          };
      }
    } else if (sorts[0] && sorts[0].cmp) cmp = sorts[0].cmp;
    return cmp ? { cmp: cmp, dir: dir } : null;
  }
  /* the sort in force: the page's own (a server-sorted list), else the person's, else the first declared */
  function curSort(I) {
    if (I.o.sortNow)
      return safe(function () {
        return I.o.sortNow();
      }, null);
    return I.s.sort || (sortOf(I) && (I.o.sorts || [])[0] ? { key: I.o.sorts[0].key, dir: 1 } : null);
  }
  function sortId(list) {
    return list.sort === true ? list.key : list.sort ? String(list.sort) : null;
  }
  function sortVal(c, row) {
    if (c.value)
      return safe(function () {
        return c.value(row);
      }, '');
    var v = safe(function () {
      return c.cell(row);
    }, '');
    return c.html ? plain(v) : v;
  }

  /* a filter choice the data no longer offers (a new date range) is dropped, never left hiding everything */
  function cleanFilters(I) {
    (I.o.filters || []).forEach(function (item) {
      var v = I.r.filt[item.key],
        opts = fopts(item);
      if (
        v &&
        opts.length &&
        !opts.some(function (x) {
          return x.v === v;
        })
      )
        delete I.r.filt[item.key];
    });
  }
  function matched(I) {
    var rows = allRows(I),
      R = I.r;
    if (remote(I)) return { all: rows, rows: rows };
    var q = String(R.q || '')
        .trim()
        .toLowerCase(),
      fl = I.o.filters || [];
    var out = rows.filter(function (row) {
      if (needsOn(I) && !safe(function () { return I.o.needs.match(row); }, false)) return false;
      if (q) {
        var text = I.o.search
          ? safe(function () {
              return I.o.search(row);
            }, '')
          : columns(I)
              .map(function (item) {
                return sortVal(item, row);
              })
              .join(' ');
        if (
          String(text || '')
            .toLowerCase()
            .indexOf(q) < 0
        )
          return false;
      }
      for (var index = 0; index < fl.length; index++) {
        var v = R.filt[fl[index].key];
        if (
          v &&
          !safe(function () {
            return fl[index].match ? fl[index].match(row, v) : row[fl[index].key] === v;
          }, true)
        )
          return false;
      }
      return true;
    });
    var srt = sortOf(I);
    if (srt) {
      var d = srt.dir;
      out = out.slice().sort(function (first, second) {
        return srt.cmp(first, second) * d;
      });
    } else if (needsOn(I) && typeof I.o.needs.rank === 'function')
      out = out.slice().sort(function (first, second) {
        return (Number(I.o.needs.rank(second)) || 0) - (Number(I.o.needs.rank(first)) || 0); /* the most urgent first, until the person picks a sort */
      });
    return { all: rows, rows: out };
  }
  function groupMode(I) {
    var g = I.o.group;
    if (!g) return null;
    var opts = g.options || [];
    var m = I.s.group;
    if (
      m &&
      opts.length &&
      !opts.some(function (x) {
        return x[0] === m;
      })
    )
      m = null;
    return m || g.default || (opts[0] && opts[0][0]) || 'on';
  }
  /* the rows (and, with a grouping, their group lines) in order: a group is ONE head and all its rows, groups in order of first appearance */
  function itemsOf(I, rows) {
    var g = I.o.group,
      mode = groupMode(I);
    if (!g || !g.by || mode === 'none')
      return rows.map(function (item, index) {
        return { row: item, id: rowIdOf(I, item, index) };
      });
    var buckets = {},
      order = [],
      loose = [];
    rows.forEach(function (item, index) {
      var k = safe(function () {
          return g.by(item, mode);
        }, null),
        it = { row: item, id: rowIdOf(I, item, index), g: k ? String(k[1]) : null };
      if (!k) {
        loose.push(it);
        return;
      }
      var key = String(k[1]);
      if (!buckets[key]) {
        buckets[key] = { label: k[0], rows: [], items: [] };
        order.push(key);
      }
      buckets[key].rows.push(item);
      buckets[key].items.push(it);
    });
    if (g.order)
      order.sort(function (x, y) {
        return g.order.indexOf(x) - g.order.indexOf(y);
      });
    var items = [];
    order.forEach(function (key) {
      var bk = buckets[key],
        fig = g.fig
          ? safe(function () {
              return g.fig(bk.rows, mode, key);
            }, '')
          : T(I, '{n} shown', { n: bk.rows.length });
      items.push({ group: bk.label, gkey: key, fig: fig });
      bk.items.forEach(function (item) {
        items.push(item);
      });
    });
    return items.concat(loose);
  }
  function isOpen(I, id) {
    var R = I.r;
    return R.allOpen ? !R.open[id + '#closed'] : !!R.open[id];
  }
  function hasNext(I) {
    return !!(I.o.next || (I.o.actions && I.o.actions.length));
  }

  /* ═════ painting ═════ */
  function paintAll(I) {
    cleanFilters(I);
    paintTitle(I);
    paintTools(I);
    paintList(I);
    fit(I);
  }
  function $(I, sel) {
    return I.el.querySelector(sel);
  }

  function head(I) {
    return typeof I.o.head === 'function'
      ? safe(function () {
          return I.o.head();
        }, null)
      : I.o.head;
  }
  /** a phone folds the head's chips and notices into ONE chip when there are two or more, or when the one notice is a sentence (it would wrap to many lines inside the title: crm Chits, 34% of the window) */
  var LONG_NOTICE_CHARS = 24;
  function foldsToOneChip(chips, notes) {
    if (chips.length + notes.length > 1) return true;
    return notes.length === 1 && String(notes[0].text || '').length > LONG_NOTICE_CHARS;
  }
  /** the folded chip's words: a count for several, the plain word for a single notice */
  function foldedCount(list, chips, notes, plural) {
    /* the count names what the chip is painted for: notices when there are any (the figures chip is not a notice), else the details */
    var n = notes.length || chips.length;
    if (n === 1 && !plural) return T(list, notes.length ? 'Notices' : 'Details');
    return T(list, notes.length ? '{n} notices' : '{n} details', { n: n });
  }
  function foldedLabel(list, chips, notes) {
    return foldedCount(list, chips, notes, false);
  }
  /** below this width (a 390 or 375 px phone) the period chip joins the ONE folded chip: a long title, period or count would make a third row, and the head stays within its 30% */
  var TINY_MAX = 400;
  function isTiny() {
    return root.matchMedia ? root.matchMedia('(max-width: ' + TINY_MAX + 'px)').matches : root.innerWidth <= TINY_MAX;
  }
  /** the period chip, and its popover while open */
  function periodChipHTML(list, p) {
    return (
      '<span class="cbl-anchor"><button type="button" data-cbsid="CMP033-B01"' + mountAttribute('CMP033') + ' class="cbl-chip period" data-cbl-pop="period" aria-haspopup="dialog" aria-expanded="' +
      (list.pop === 'period') +
      '" data-testid="cbl-period-' +
      esc(list.key) +
      '">' +
      esc(p.label || '') +
      ' ▾</button>' +
      (list.pop === 'period' ? periodPop(list, p) : '') +
      '</span>'
    );
  }
  function chipHTML(c) {
    return '<span class="cbl-chip"' + (c.tid ? ' data-testid="' + esc(c.tid) + '"' : '') + '>' + esc(c.text) + '</span>';
  }
  function noteHTML(n, i) {
    return (
      '<button type="button" data-cbsid="CMP033-B01"' + mountAttribute('CMP033') + ' class="cbl-chip ' +
      esc(n.cls === 'bad' ? 'bad' : n.cls === 'ask' ? 'ask' : 'warn') +
      '"' + (n.cls === 'ask' ? ' aria-pressed="' + (n.pressed ? 'true' : 'false') + '"' : '') + ' data-notice="' +
      i +
      '"' +
      (n.tid ? ' data-testid="' + esc(n.tid) + '"' : '') +
      '>' +
      esc(n.text) +
      '</button>'
    );
  }
  /** the ONE chip a phone folds the strip, the notices and (on a tiny phone) the period into, and its popover while open */
  function foldedChipHTML(list, headSpec, foldPeriod) {
    var chips = headSpec.chips || [],
      notes = headSpec.notices || [],
      bad = notes.some(function (item) {
        return item.cls === 'bad';
      });
    return (
      '<span class="cbl-anchor"><button type="button" data-cbsid="CMP033-B01"' + mountAttribute('CMP033') + ' class="cbl-chip ' +
      (notes.length ? (bad ? 'bad' : 'warn') : '') +
      '" data-cbl-pop="notes" aria-haspopup="dialog" aria-expanded="' +
      (list.pop === 'notes') +
      '" data-testid="cbl-notes-' +
      esc(list.key) +
      '">' +
      esc(foldPeriod ? (headSpec.period.label || '') + ' · ' + foldedCount(list, chips, notes, true) : foldedLabel(list, chips, notes)) +
      ' ▾</button>' +
      (list.pop === 'notes'
        ? '<div data-cbsid="CMP033-D01"' + mountAttribute('CMP033') + ' class="cbl-pop left" role="dialog" data-pop="POP133" aria-label="' +
          esc(T(list, foldPeriod ? 'Period and notices' : 'Notices')) +
          '" data-testid="cbl-notes-pop-' +
          esc(list.key) +
          '"><div class="cbl-notes">' +
          chips.map(chipHTML).join('') +
          notes.map(noteHTML).join('') +
          '</div>' +
          (foldPeriod ? periodInner(list, headSpec.period) : '') +
          '</div>'
        : '') +
      '</span>'
    );
  }
  /** the head's chips and notices: a narrow container folds them into ONE chip that opens them (a phone's head stays within its 30%); a laptop that asked for foldHead keeps the figures inline (the Closing figure, "Dr with no party" stay visible without a tap) and folds only the notices */
  function titleChipsHTML(list, h, foldPeriod) {
    var chips = h.chips || [],
      notes = h.notices || [],
      inline = chips.map(chipHTML).join('') + notes.map(noteHTML).join('');
    list.narrow = foldsHead(list);
    if (!list.narrow) return inline;
    if (isPhone() || foldPeriod) return foldPeriod || foldsToOneChip(chips, notes) ? foldedChipHTML(list, h, foldPeriod) : inline;
    return foldsToOneChip([], notes) ? chips.map(chipHTML).join('') + foldedChipHTML(list, { chips: [], notices: notes, period: h.period }, false) : inline;
  }
  /** paintTitle, step 1 of 5 (part 1, lines 1097-1098 of the one function): runs on, nothing here ends the call */
  function paintTitleStep1(list, ctx) {
ctx.h = head(list);
ctx.box = $(list, ':scope > .cbl-title');
  }
  /** paintTitle, step 2 of 5 (part 2, lines 1099-1102 of the one function): true when it handled the call and nothing else should run */
  function paintTitleStep2(list, ctx) {
    if (!ctx.h || !(ctx.h.title || ctx.h.period || ctx.h.slot || (ctx.h.notices && ctx.h.notices.length) || (ctx.h.chips && ctx.h.chips.length))) {
      if (ctx.box) ctx.box.remove();
      return true;
    }
    return false;
  }
  /** paintTitle, step 3 of 5 (the data-cbl-part part, lines 1103-1113 of the one function): runs on, nothing here ends the call */
  function paintTitleCblPart(list, ctx) {
    if (!ctx.box) {
      ctx.box = root.document.createElement('div');
      ctx.box.className = 'cbl-title';
      ctx.box.setAttribute('data-cbl-part', 'title');
      list.el.insertBefore(ctx.box, list.el.firstChild);
    }
    ctx.out = '';
    if (ctx.h.title) ctx.out += '<h1>' + esc(ctx.h.title) + '</h1>';
    var chips = ctx.h.chips || [];
var notes = ctx.h.notices || [];
ctx.foldPeriod = !!ctx.h.period && isPhone() && isTiny() && chips.length + notes.length > 0;
  }
  /** paintTitle, step 4 of 5 (part 4, lines 1114-1123 of the one function): runs on, nothing here ends the call */
  function paintTitleStep4(list, ctx) {
    if (ctx.h.period && !ctx.foldPeriod) ctx.out += periodChipHTML(list, ctx.h.period);
    ctx.out += titleChipsHTML(list, ctx.h, ctx.foldPeriod);
    /* T3-COMPAT: views.inTitle — the saved-view tabs sit in the title row, after the chips, instead of a row of their own (a head that must stay short) */
    if (list.o.views && list.o.views.inTitle)
      ctx.out += '<span class="cbl-views in-title" data-cbl-part="views" role="tablist" aria-label="' + esc(T(list, 'Views')) + '"></span>';
    if (typeof ctx.h.slot === 'function')
      ctx.out += '<span class="cbl-slot" data-cbl-part="slot" style="margin-inline-start:auto;display:flex;align-items:center;gap:8px"></span>';
    ctx.box.classList.toggle('reserve', !!ctx.h.reserve);
    ctx.box.innerHTML = ctx.out;
    if (list.o.views && list.o.views.inTitle) paintViews(list);
  }
  /** paintTitle, step 5 of 5 (part 5, lines 1124-1130 of the one function): runs on, nothing here ends the call */
  function paintTitleStep5(list, ctx) {
    if (typeof ctx.h.slot === 'function') {
      var node = ctx.box.querySelector(':scope > .cbl-slot');
      if (node)
        safe(function () {
          ctx.h.slot(node);
        });
    }
  }
  function paintTitle(list) {
  var ctx = {},
    steps = [paintTitleStep1, paintTitleStep2, paintTitleCblPart, paintTitleStep4, paintTitleStep5];
  for (var at = 0; at < steps.length; at++) {
    if (steps[at](list, ctx)) return;
  }
  }
  /** the period's own popover; its words and controls (periodInner) also sit in the folded chip's popover on a tiny phone */
  function periodPop(I, p) {
    return (
      '<div data-cbsid="CMP033-D01"' + mountAttribute('CMP033') + ' class="cbl-pop left" role="dialog" data-pop="POP134" aria-label="' +
      esc(T(I, 'Period')) +
      '">' +
      periodInner(I, p) +
      '</div>'
    );
  }
  function periodInner(I, p) {
    var presets = p.presets || [],
      nestedVal = I.pv || p.value;
    return (
      '<h4>' +
      esc(T(I, 'Period')) +
      '</h4><div class="cbl-preset">' +
      presets
        .map(function (x) {
          return '<button type="button" data-cbsid="CMP034-B01"' + mountAttribute('CMP034') + ' data-period="' + esc(x[0]) + '" aria-pressed="' + (nestedVal === x[0]) + '">' + esc(x[1]) + '</button>';
        })
        .join('') +
      '</div>' +
      (nestedVal === 'custom'
        ? '<div class="cbl-custom"><input data-cbsid="CMP045-I02"' + mountAttribute('CMP045') + ' data-cbl-from type="date" value="' +
          esc((p.custom && p.custom.from) || '') +
          '" aria-label="' +
          esc(T(I, 'From')) +
          '"> → <input data-cbsid="CMP045-I02"' + mountAttribute('CMP045') + ' data-cbl-to type="date" value="' +
          esc((p.custom && p.custom.to) || '') +
          '" aria-label="' +
          esc(T(I, 'To')) +
          '"></div>'
        : '')
    );
  }

  /** did the person narrow the list (a search, or a filter beyond the page's own starting view)? UX-94: a page whose starting filter IS its normal view
   *  (Disputes opens on "Still open", opts.presetIsDefault) says it is empty, not "Nothing matches" */
  function isNarrowed(list) {
    var starting = (list.o.presetIsDefault && list.o.preset && list.o.preset.filt) || {};
    var beyondStart = activeFilters(list).filter(function (filter) {
      return list.r.filt[filter.key] !== starting[filter.key];
    });
    return (list.r.q && String(list.r.q).trim()) || beyondStart.length;
  }
  function activeFilters(I) {
    return (I.o.filters || []).filter(function (item) {
      return I.r.filt[item.key];
    });
  }
  /* E15: a row flagged _total is a total line the page appends (Who owes whom, the trial balance), not an item: "n shown" never counts it */
  function itemCount(rows) {
    return (rows || []).filter(function (row) { return !(row && row._total); }).length;
  }
  function countText(I, m) {
    var shown = itemCount(m.rows);
    var t = T(I, '{n} shown', { n: shown });
    if (remote(I)) {
      var tot = val(I.o.remote.total);
      if (tot != null && tot !== shown) t += ' ' + T(I, 'of') + ' ' + tot;
    } else if (shown !== itemCount(m.all)) t += ' ' + T(I, 'of') + ' ' + itemCount(m.all);
    return t;
  }
  /* ── ⚑ NEEDS YOU (W15-116 / W15-117) — ONE toggle for every list, FIRST in the toolbar (left of the search), and the stepper that walks what it holds ──
     A page that has something to ask of the person says so with `needs: { count, match(row), rank?(row), onToggle?(on), onNext?(row), unit? }`:
       count   the SERVER's number of rows that need the person (a number or a function): what the button says, and what the filtered list must hold
       match   the row's own answer, from the figures the server sent with it (never counted here)
       rank    higher = more urgent: with the toggle on the list shows the most urgent first (a sort the person chose is kept)
       onNext  a list whose rows are not a next level (the Day book) opens the row itself; else Next opens the next row's next level
     With it on the list shows only what matches; "Next ›" steps through them with "3 of 12 done"; a row that is cleared drops off the next time the rows are read. */
  function needsOf(I) {
    return I.o.needs && typeof I.o.needs === 'object' ? I.o.needs : null;
  }
  function needsOn(I) {
    return !!(needsOf(I) && I.r.needsOn);
  }
  function needsCount(I) {
    var n = needsOf(I) && needsOf(I).count;
    n = typeof n === 'function' ? safe(n, 0) : n;
    return Number(n) > 0 ? Number(n) : 0;
  }
  /** the rows that need the person, most urgent first (the page's own match and rank; no search, no filter) */
  function needsRows(inst) {
    var spec = needsOf(inst);
    if (!spec) return [];
    var rows = allRows(inst).filter(function (row) {
      return safe(function () {
        return spec.match(row);
      }, false);
    });
    if (typeof spec.rank === 'function')
      rows = rows.slice().sort(function (first, second) {
        return (Number(spec.rank(second)) || 0) - (Number(spec.rank(first)) || 0);
      });
    return rows;
  }
  function needsHTML(I) {
    var spec = needsOf(I);
    if (!spec) return '';
    var n = needsCount(I),
      on = needsOn(I),
      k = esc(I.key),
      clear = n === 0 && !on;
    var html =
      '<button type="button" data-cbsid="CMP034-B01"' + mountAttribute('CMP034') + ' class="cbl-tbtn cbl-needs' + (clear ? ' clear' : '') + (on ? ' on' : '') + '" data-cbl-needs aria-pressed="' + on + '"' + (clear ? ' aria-disabled="true"' : '') +
      ' data-testid="cbl-needs-' + k + '" title="' + esc(T(I, 'Show only what needs you')) + '">' +
      (clear ? '✓ ' + esc(T(I, 'All clear')) : '⚑ ' + esc(T(I, 'Needs you')) + ' · ' + n) +
      '</button>';
    if (on) {
      var left = needsRows(I).length,
        total = Math.max(I.r.needsTotal || 0, left),
        done = total - left;
      html +=
        '<button type="button" data-cbsid="CMP037-B07"' + mountAttribute('CMP037') + ' class="cbl-tbtn cbl-needs-next" data-cbl-needs-next data-testid="cbl-needs-next-' + k + '"' + (left ? '' : ' disabled') + '>' + esc(T(I, 'Next')) + ' ›</button>' +
        '<span class="cbl-needs-prog" data-testid="cbl-needs-prog-' + k + '" aria-live="polite">' + esc(T(I, '{n} of {m} done', { n: done, m: total })) + '</span>';
    }
    return html;
  }
  /** the toggle: on narrows the list to what needs the person and starts the count "0 of n"; off puts the list back */
  function needsToggle(I) {
    if (!needsOf(I) || (needsCount(I) === 0 && !needsOn(I))) return;
    var R = I.r;
    R.needsOn = !R.needsOn;
    R.open = {};
    R.allOpen = false;
    R.needsAt = 0;
    R.hl = null;
    if (R.needsOn) R.needsTotal = needsRows(I).length;
    resetLimit(I);
    safe(function () {
      if (needsOf(I).onToggle) needsOf(I).onToggle(R.needsOn);
    });
    paintAll(I);
  }
  /** Next ›: the row after the one in hand (or, when that one was cleared and dropped off, the one that took its place) opens, the one before closes */
  function needsNext(I) {
    var spec = needsOf(I),
      R = I.r;
    var rows = needsRows(I);
    if (!spec || !rows.length) return;
    var ids = rows.map(function (row, index) {
        return rowIdOf(I, row, index);
      }),
      at = ids.indexOf(String(R.hl)),
      pos = at >= 0 ? at + 1 : Math.min(R.needsAt || 0, ids.length - 1);
    if (pos >= ids.length) pos = ids.length - 1 === at ? at : 0;
    R.needsAt = pos;
    var id = ids[pos];
    R.hl = id;
    if (spec.onNext) {
      safe(function () {
        spec.onNext(rows[pos]);
      });
      paintTools(I);
      return;
    }
    R.allOpen = false;
    R.open = {};
    R.open[id] = true;
    paintTools(I);
    paintList(I);
    refocusRow(I, id);
  }
  function fopts(f) {
    return (typeof f.options === 'function' ? f.options() || [] : f.options || []).map(function (x) {
      return typeof x === 'object' ? x : { v: x, label: x };
    });
  }
  /** the Expand all / Collapse all toggle of a list that has a next level (a pressed toggle, CMP034) */
  function expandAllHTML(list, keyText, testIds) {
    var runState = list.r;
    return (
    '<button type="button" data-cbsid="CMP034-B01"' + mountAttribute('CMP034') + ' class="cbl-tbtn cbl-ico" data-cbl-exp data-testid="' +
    esc(runState.allOpen ? testIds.collapse || 'cbl-expand-' + keyText : testIds.expand || 'cbl-expand-' + keyText) +
    '" title="' +
    esc(T(list, runState.allOpen ? 'Collapse all' : 'Expand all')) +
    '" aria-label="' +
    esc(T(list, runState.allOpen ? 'Collapse all' : 'Expand all')) +
    '" aria-pressed="' +
    !!runState.allOpen +
    '">' +
    (runState.allOpen ? '⇡' : '⇣') +
    '<span class="cbl-w"> ' +
    esc(T(list, runState.allOpen ? 'Collapse all' : 'Expand all')) +
    '</span>' +
    '</button>'
    );
  }
  /** the Grid / Lines choice (two pressed toggles, CMP034): each draws its word beside the glyph, a phone keeps only the glyph and the aria-label */
  function viewChoiceHTML(list, keyText) {
    var viewState = list.s;
    return (
    '<span class="cbl-seg" role="group" aria-label="' +
    esc(T(list, 'View')) +
    '"><button type="button" data-cbsid="CMP034-B01"' + mountAttribute('CMP034') + ' data-view="grid" data-testid="view-grid-' +
    keyText +
    '" title="' +
    esc(T(list, 'Grid: columns')) +
    '" aria-label="' +
    esc(T(list, 'Grid: columns')) +
    '" aria-pressed="' +
    (viewState.view === 'grid') +
    '">▤' +
    '<span class="cbl-w"> ' + esc(T(list, 'Grid')) + '</span></button><button type="button" data-cbsid="CMP034-B01"' + mountAttribute('CMP034') + ' data-view="lines" data-testid="view-lines-' +
    keyText +
    '" title="' +
    esc(T(list, 'Lines: one line per record')) +
    '" aria-label="' +
    esc(T(list, 'Lines: one line per record')) +
    '" aria-pressed="' +
    (viewState.view === 'lines') +
    '">☰' +
    '<span class="cbl-w"> ' + esc(T(list, 'Lines')) + '</span></button></span>'
    );
  }
  /** the right-hand tools of the second row: expand all, grid / lines, columns, CSV, select mode (each a list component: CMP033 to CMP037) */
  /** a phone: the standard's one breakpoint (ui.js SIZE_CSS, 700 px), the same number the CSS below is written with */
  function isPhone() {
    return root.matchMedia ? root.matchMedia('(max-width: ' + PHONE_MAX + 'px)').matches : root.innerWidth <= PHONE_MAX;
  }
  /** a phone folds the head (one View chip, one notices chip); a page may ask for the same fold at any width (foldHead: true: the Ledgers head, which must stay within 20% of a laptop) */
  function foldsHead(list) {
    return isPhone() || !!list.o.foldHead;
  }
  function isNarrowList(list) {
    list.narrow = foldsHead(list);
    return list.narrow;
  }
  /** the one View button of a phone and its popover: Group by, Grid / Lines, Columns and CSV inside it (a list opener and its popover, CMP033); Columns opens its own sheet in its place */
  function viewMenuHTML(list, keyText, inner) {
    var open = list.pop === 'view' || list.pop === 'cols';
    return (
      '<span class="cbl-anchor"><button type="button" data-cbsid="CMP033-B01"' + mountAttribute('CMP033') + ' class="cbl-tbtn" data-cbl-pop="view" id="cbl-view-' +
      keyText +
      '" data-testid="cbl-view-menu-' +
      keyText +
      '" aria-haspopup="dialog" aria-expanded="' +
      open +
      '">' +
      esc(T(list, 'View')) +
      ' ▾</button>' +
      (list.pop === 'view'
        ? '<div data-cbsid="CMP033-D01"' + mountAttribute('CMP033') + ' class="cbl-pop left" role="dialog" data-pop="POP135" aria-label="' + esc(T(list, 'View')) + '" data-testid="cbl-view-pop-' + keyText + '"><div class="cbl-viewpop">' + inner + '</div></div>'
        : '') +
      (list.pop === 'cols' ? colsPop(list) : '') +
      '</span>'
    );
  }
  /** viewToolsHTML, step 1 of 2 (part 1, lines 1403-1434 of the one function): runs on, nothing here ends the call */
  function viewToolsHTMLStep1(list, keyText, testIds, toolOptions, groupHtml, ctx) {
ctx.listOptions = list.o;
ctx.runState = list.r;
var viewState = list.s;
ctx.toolsHtml = '';
    var expand = hasNext(list) ? expandAllHTML(list, keyText, testIds) : '';
    ctx.toolsHtml = viewChoiceHTML(list, keyText);
    ctx.toolsHtml +=
      '<span class="cbl-anchor"><button type="button" data-cbsid="CMP033-B01"' + mountAttribute('CMP033') + ' class="cbl-tbtn cbl-ico" data-cbl-pop="cols" id="cbl-cols-' +
      keyText +
      '" data-testid="cols-btn-' +
      keyText +
      '" title="' +
      esc(T(list, 'Choose columns')) +
      '" aria-label="' +
      esc(T(list, 'Choose columns')) +
      '" aria-haspopup="dialog" aria-expanded="' +
      (list.pop === 'cols') +
      '">⚙' +
      '<span class="cbl-w"> ' + esc(T(list, 'Columns')) + '</span>' + leftOutCue(list, keyText) + '</button>' +
      (list.pop === 'cols' ? colsPop(list) : '') +
      '</span>';
    if (ctx.listOptions.csv !== false && toolOptions.csv !== false)
      ctx.toolsHtml +=
        '<button type="button" data-cbsid="CMP037-B01"' + mountAttribute('CMP037') + ' class="cbl-tbtn cbl-ico" data-cbl-csv data-testid="' +
        esc(testIds.csv || 'cbl-csv-' + keyText) +
        '" title="' +
        esc(T(list, 'Download CSV')) +
        '" aria-label="' +
        esc(T(list, 'Download CSV')) +
        '">⬇' +
        '<span class="cbl-w"> ' + esc(T(list, 'CSV')) + '</span></button>';
    ctx.toolsHtml = groupHtml == null ? expand + ctx.toolsHtml : viewMenuHTML(list, keyText, groupHtml + expand + ctx.toolsHtml);
  }
  /** viewToolsHTML, step 2 of 2 (part 2, lines 1435-1445 of the one function): runs on, nothing here ends the call */
  function viewToolsHTMLStep2(list, keyText, testIds, toolOptions, groupHtml, ctx) {
    if (ctx.listOptions.bulk && ctx.listOptions.bulk.length)
      ctx.toolsHtml +=
        '<button type="button" data-cbsid="CMP034-B01"' + mountAttribute('CMP034') + ' class="cbl-tbtn' +
        (ctx.runState.selMode ? ' on' : '') +
        '" data-cbl-selmode data-testid="cbl-select-' +
        keyText +
        '" aria-pressed="' +
        !!ctx.runState.selMode +
        '">☑ ' +
        esc(T(list, 'Select')) +
        '</button>';
  }
  function viewToolsHTML(list, keyText, testIds, toolOptions, groupHtml) {
  var ctx = {},
    steps = [viewToolsHTMLStep1, viewToolsHTMLStep2];
  for (var at = 0; at < steps.length; at++) {
    if (steps[at](list, keyText, testIds, toolOptions, groupHtml, ctx)) return;
  }
  return ctx.toolsHtml;
  }
  /** the Group by choice (a select or a row of pressed toggles, CMP035 / CMP034); on a phone it goes into the View popover */
  function groupToolsHTML(list, keyText) {
    var listOptions = list.o,
      groupHtml = '';
    var groupOptions = listOptions.group,
      groupNow = groupMode(list);
    if (groupOptions && groupOptions.as === 'select' && (groupOptions.options || []).length > 1) {
      groupHtml +=
        '<label class="cbl-gsel" data-testid="cbl-group-' +
        keyText +
        '"' +
        (groupOptions.tips && groupOptions.tips[groupNow] ? ' title="' + esc(T(list, groupOptions.tips[groupNow])) + '"' : '') +
        '><span class="cbl-glab" data-testid="cbl-glab-' +
        keyText +
        '">' +
        esc(T(list, 'Group')) +
        '</span><select data-cbsid="CMP035-S01"' + mountAttribute('CMP035') + ' data-gsel id="cbl-gsel-' +
        keyText +
        '" data-testid="' +
        esc(groupOptions.tid ? groupOptions.tid + '-group' : 'cbl-gsel-' + keyText) +
        '" aria-label="' +
        esc(T(list, 'Group by')) +
        '">' +
        groupOptions.options
          .map(function (x) {
            return (
              '<option value="' +
              esc(x[0]) +
              '"' +
              (groupNow === x[0] ? ' selected' : '') +
              (groupOptions.tips && groupOptions.tips[x[0]] ? ' title="' + esc(T(list, groupOptions.tips[x[0]])) + '"' : '') +
              '>' +
              esc(T(list, x[1])) +
              '</option>'
            );
          })
          .join('') +
        '</select></label>';
    } else if (groupOptions && (groupOptions.options || []).length > 1)
      groupHtml +=
        '<span class="cbl-glab" data-testid="cbl-glab-' +
        keyText +
        '">' +
        esc(T(list, 'Group by')) +
        '</span><span class="cbl-seg" role="group" aria-label="' +
        esc(T(list, 'Group by')) +
        '" data-testid="cbl-group-' +
        keyText +
        '">' +
        groupOptions.options
          .map(function (x) {
            return (
              '<button type="button" data-cbsid="CMP034-B01"' + mountAttribute('CMP034') + ' data-group="' +
              esc(x[0]) +
              '"' +
              (groupOptions.tid ? ' data-testid="' + esc(groupOptions.tid) + '-group-' + esc(x[0]) + '"' : '') +
              ' aria-pressed="' +
              (groupNow === x[0]) +
              '">' +
              esc(T(list, x[1])) +
              '</button>'
            );
          })
          .join('') +
        '</span>';
    return groupHtml;
  }
  /** tools.bar:false — a short list read at a glance draws no tools bar (it stays in the page, hidden, so every part that looks for it still finds it); backwards compatible: absent = drawn */
  function paintTools(list) {
    paintToolsBar(list);
    var bar = $(list, ':scope > .cbl-tools');
    if (bar) bar.hidden = !!(list.o.tools && list.o.tools.bar === false);
  }
  /** paintToolsBar, step 1 of 7 (the data-cbl-part part, lines 1501-1518 of the one function): runs on, nothing here ends the call */
  function paintToolsBarCblPart(list, ctx) {
paintViews(list);
    ctx.box = $(list, ':scope > .cbl-tools');
    if (!ctx.box) {
      ctx.box = root.document.createElement('div');
      ctx.box.className = 'cbl-tools';
      ctx.box.setAttribute('data-cbl-part', 'tools');
      ctx.box.setAttribute('role', 'toolbar');
      ctx.box.setAttribute('aria-label', T(list, 'View'));
      var node = $(list, ':scope > .cbl-list');
      list.el.insertBefore(ctx.box, node);
    }
    ctx.o = list.o;
ctx.R = list.r;
var s = list.s;
ctx.m = matched(list);
ctx.fn = activeFilters(list).length;
ctx.k = esc(list.key);
ctx.sorts = sortChoices(list);
  }
  /** paintToolsBar, step 2 of 7 (part 2, lines 1519-1535 of the one function): runs on, nothing here ends the call */
  function paintToolsBarStep2(list, ctx) {
    ctx.tids = ctx.o.tids || {};
ctx.tl = ctx.o.tools || {};
ctx.h = needsHTML(list) +
        (ctx.tl.search === false
          ? ''
          : '<div class="cbl-search"><span aria-hidden="true">🔍</span><input type="search" data-cbsid="CMP045-I01"' + mountAttribute('CMP045') + ' data-cbl-q id="cbl-q-' +
            ctx.k +
            '" data-testid="listctl-search-' +
            ctx.k +
            '" placeholder="' +
            esc(ctx.o.searchHint || T(list, 'Search')) +
            '" value="' +
            esc(ctx.R.q) +
            '" aria-label="' +
            esc(T(list, 'Search')) +
            '"></div>');
  }
  /** paintToolsBar, step 3 of 7 (part 3, lines 1539-1558 of the one function): runs on, nothing here ends the call */
  function paintToolsBarStep3(list, ctx) {
    /* T3-DISPUTES-ASSIST: a server-paged list that ALSO filters on the server says so (remote.filters: true) — the same Filters control, and every choice
       goes to its onQuery (q.filt · q.sort) instead of narrowing the page in hand. T3-CATALOGUE (widened, additively): a server-paged list that DECLARES
       filters gets the Filters ▾ too (a change goes to its pager, the unit still filters nothing itself); sorts alone show it only when the unit sorts (not remote) or the list opted in */
    if ((ctx.o.filters && ctx.o.filters.length) || ((!remote(list) || ctx.o.remote.filters === true) && ctx.sorts.length > 1)) {
      ctx.h +=
        '<span class="cbl-anchor"><button type="button" data-cbsid="CMP033-B01"' + mountAttribute('CMP033') + ' class="cbl-tbtn' +
        (ctx.fn ? ' on' : '') +
        '" data-cbl-pop="filt" id="cbl-filt-' +
        ctx.k +
        '" data-testid="cbl-filters-' +
        ctx.k +
        '" aria-haspopup="dialog" aria-expanded="' +
        (list.pop === 'filt') +
        '">' +
        esc(T(list, 'Filters')) +
        ' ▾' +
        (ctx.fn ? ' <span class="badge">' + ctx.fn + '</span>' : '') +
        '</button>' +
        (list.pop === 'filt' ? filtPop(list, ctx.sorts) : '') +
        '</span>';
    }
    ctx.narrow = isNarrowList(list);
ctx.groupHtml = groupToolsHTML(list, ctx.k);
  }
  /** paintToolsBar, step 4 of 7 (part 4, lines 1559-1569 of the one function): runs on, nothing here ends the call */
  function paintToolsBarStep4(list, ctx) {
    if (!ctx.narrow) ctx.h += ctx.groupHtml;
    ctx.h += viewToolsHTML(list, ctx.k, ctx.tids, ctx.tl, ctx.narrow ? ctx.groupHtml : null);
    if (ctx.tl.count !== false)
      ctx.h +=
        '<span class="cbl-count" id="cbl-count-' +
        ctx.k +
        '" data-testid="' +
        esc(ctx.tids.count || list.key + '-count') +
        '" aria-live="polite">' +
        esc(countText(list, ctx.m)) +
        '</span>';
  }
  /** paintToolsBar, step 5 of 7 (part 5, lines 1570-1594 of the one function): runs on, nothing here ends the call */
  function paintToolsBarStep5(list, ctx) {
    /* tools.count:false — a host that already says the count (one count on a screen) */
    if (ctx.o.bulk && ctx.o.bulk.length && ctx.R.selMode) {
      var n = selectedRows(list).length;
      ctx.h +=
        '<span class="cbl-acts" style="margin:0" data-testid="cbl-bulk-' +
        ctx.k +
        '"><button type="button" data-cbsid="CMP037-B03"' + mountAttribute('CMP037') + ' class="cbl-btn" data-cbl-selall>' +
        esc(T(list, 'Select all shown')) +
        '</button>' +
        ctx.o.bulk
          .map(function (item) {
            return (
              '<button type="button" data-cbsid="CMP037-B04"' + mountAttribute('CMP037') + ' class="cbl-btn" data-bulk="' +
              esc(item.id) +
              '"' +
              (n ? '' : ' disabled') +
              '>' +
              esc(T(list, item.label)) +
              ' (' +
              n +
              ')</button>'
            );
          })
          .join('') +
        '</span>';
    }
  }
  /** paintToolsBar, step 6 of 7 (part 6, lines 1595-1626 of the one function): runs on, nothing here ends the call */
  function paintToolsBarStep6(list, ctx) {
    ctx.h +=
      '<div class="cbl-fchips">' +
      activeFilters(list)
        .map(function (item) {
          var ov = fopts(item).filter(function (x) {
            return x.v === ctx.R.filt[item.key];
          })[0];
          return (
            '<span class="cbl-fchip">' +
            esc(item.label || item.key) +
            ': ' +
            esc(ov ? ov.label : ctx.R.filt[item.key]) +
            '<button type="button" data-cbsid="CMP014-B01"' + mountAttribute('CMP014') + ' data-unfilt="' +
            esc(item.key) +
            '" aria-label="' +
            esc(T(list, 'Remove {x} filter', { x: item.label || item.key })) +
            '">×</button></span>'
          );
        })
        .join('') +
      '</div>';
    if (list.pop && String(list.pop).indexOf('hf:') === 0) ctx.h += hfPop(list);
    var ae = root.document.activeElement;
ctx.keepId = ae && ctx.box.contains(ae) ? ae.id : '';
ctx.ss = null;
ctx.se = null;
    if (ctx.keepId && ae.setSelectionRange) {
      try {
        ctx.ss = ae.selectionStart;
        ctx.se = ae.selectionEnd;
      } catch (_) { /* best effort: failing here changes nothing the user sees */ }
    }
  }
  /** paintToolsBar, step 7 of 7 (part 7, lines 1627-1638 of the one function): runs on, nothing here ends the call */
  function paintToolsBarStep7(list, ctx) {
    ctx.box.innerHTML = ctx.h;
    if (ctx.keepId) {
      var back = ctx.box.querySelector('#' + cssId(ctx.keepId));
      if (back) {
        back.focus();
        if (ctx.ss != null) {
          try {
            back.setSelectionRange(ctx.ss, ctx.se);
          } catch (_) { /* best effort: failing here changes nothing the user sees */ }
        }
      }
    }
  }
  function paintToolsBar(list) {
  var ctx = {},
    steps = [paintToolsBarCblPart, paintToolsBarStep2, paintToolsBarStep3, paintToolsBarStep4, paintToolsBarStep5, paintToolsBarStep6, paintToolsBarStep7];
  for (var at = 0; at < steps.length; at++) {
    if (steps[at](list, ctx)) return;
  }
  }
  /* the saved views: tabs that set the list's own filters. A tab is lit when the filters in force are exactly its own. */
  function viewMatches(I, v, row) {
    var list = I.o.filters || [],
      ok = true;
    Object.keys(v.filt || {}).forEach(function (item) {
      var text = list.filter(function (x) {
        return x.key === item;
      })[0];
      if (
        text &&
        ok &&
        !safe(function () {
          return text.match ? text.match(row, v.filt[item]) : row[item] === v.filt[item];
        }, true)
      )
        ok = false;
    });
    return ok;
  }
  /** every filter key some view of the list sets */
  function viewKeys(inst) {
    var keys = [];
    ((inst.o.views && inst.o.views.items) || []).forEach(function (view) {
      Object.keys(view.filt || {}).forEach(function (item) {
        if (keys.indexOf(item) < 0) keys.push(item);
      });
    });
    return keys;
  }
  function viewOn(inst, view) {
    var a = inst.r.filt,
      b = view.filt || {},
      ka = Object.keys(a).filter(function (item) {
        return a[item];
      }),
      list = Object.keys(b);
    var sameOwn = list.every(function (item) {
      return a[item] === b[item];
    });
    if (inst.o.views && inst.o.views.merge)
      /* views.merge: the tabs are one more filter, not a replacement of them all: a tab is lit when ITS keys hold (the tab with none is lit when no tab's key is set) */
      return list.length
        ? sameOwn
        : !viewKeys(inst).some(function (item) {
            return a[item];
          });
    return view.rows
      ? list.length > 0 && sameOwn
      : ka.length === list.length && sameOwn; /* a view with its own rows stays lit while its filters are in force (its country filter may change) */
  }
  function litOwnView(inst) {
    var views = (inst.o.views && inst.o.views.items) || [],
      out = null;
    views.forEach(function (view) {
      if (!out && typeof view.rows === 'function' && viewOn(inst, view)) out = view;
    });
    return out;
  }
  /** paintViews, step 1 of 3 (part 1, lines 1746-1752 of the one function): true when it handled the call and nothing else should run */
  function paintViewsStep1(inst, ctx) {
ctx.list = inst.o.views && inst.o.views.items;
ctx.inT = !!(inst.o.views && inst.o.views.inTitle);
ctx.box = $(inst, ctx.inT ? ':scope > .cbl-title > .cbl-views' : ':scope > .cbl-views');
    if (!ctx.list || !ctx.list.length || remote(inst)) {
      if (ctx.box) ctx.box.remove();
      return true;
    }
    return false;
  }
  /** paintViews, step 2 of 3 (the data-cbl-part part, lines 1753-1765 of the one function): true when it handled the call and nothing else should run */
  function paintViewsCblPart(inst, ctx) {
    if (!ctx.box && ctx.inT) return true; /* no title row painted (yet): paintTitle paints the tabs with it */
    if (!ctx.box) {
      ctx.box = root.document.createElement('div');
      ctx.box.className = 'cbl-views';
      ctx.box.setAttribute('data-cbl-part', 'views');
      ctx.box.setAttribute('role', 'tablist');
      ctx.box.setAttribute('aria-label', T(inst, 'Views'));
      var node = $(inst, ':scope > .cbl-tools'),
        l = $(inst, ':scope > .cbl-list');
      inst.el.insertBefore(ctx.box, node || l);
    }
    ctx.rows = baseRows(inst);
ctx.vt = inst.o.views.tid || 'views';
    return false;
  }
  /** paintViews, step 3 of 3 (part 3, lines 1766-1797 of the one function): runs on, nothing here ends the call */
  function paintViewsStep3(inst, ctx) {
    ctx.box.innerHTML = ctx.list
      .map(function (item) {
        var n = (
            typeof item.rows === 'function'
              ? safe(function () {
                  return item.rows();
                }, [])
              : ctx.rows.filter(function (row) {
                  return viewMatches(inst, item, row);
                })
          ).length,
          on = viewOn(inst, item);
        return (
          '<button type="button" data-cbsid="CMP036-K01"' + mountAttribute('CMP036') + ' role="tab" class="cbl-vtab" data-view-tab="' +
          esc(item.key) +
          '" aria-selected="' +
          on +
          '" data-testid="' +
          esc(ctx.vt) +
          '-' +
          esc(item.key) +
          '"' +
          (item.tip ? ' title="' + esc(T(inst, item.tip)) + '"' : '') +
          '>' +
          (item.iconHtml || '') +
          (item.labelHtml || esc(T(inst, item.label))) +
          ' <span class="n">' +
          n +
          '</span></button>'
        );
      })
      .join('');
  }
  function paintViews(I) {
  var ctx = {},
    steps = [paintViewsStep1, paintViewsCblPart, paintViewsStep3];
  for (var at = 0; at < steps.length; at++) {
    if (steps[at](I, ctx)) return;
  }
  }
  /* the filter behind a column heading: a small menu of that filter's own choices (the same state as Filters ▾) */
  function hfPop(list) {
    var fk = String(list.pop).slice(3),
      f = (list.o.filters || []).filter(function (x) {
        return x.key === fk;
      })[0];
    if (!f) return '';
    var at = list.hfAt || { l: 8, t: 100 },
      cur = list.r.filt[fk] || '';
    return (
      '<div data-cbsid="CMP033-D01"' + mountAttribute('CMP033') + ' class="cbl-pop hf" role="menu" aria-label="' +
      esc(f.label || fk) +
      '" data-testid="cbl-hf-pop-' +
      esc(fk) +
      '" style="left:' +
      Math.round(at.l) +
      'px;top:' +
      Math.round(at.t) +
      'px">' +
      '<button type="button" data-cbsid="CMP033-M01"' + mountAttribute('CMP033') + ' role="menuitemradio" aria-checked="' +
      !cur +
      '" data-hfv="" data-hfk="' +
      esc(fk) +
      '">' +
      esc(f.all || T(list, 'Any')) +
      '</button>' +
      fopts(f)
        .map(function (x) {
          return (
            '<button type="button" data-cbsid="CMP033-M01"' + mountAttribute('CMP033') + ' role="menuitemradio" aria-checked="' +
            (cur === x.v) +
            '" data-hfv="' +
            esc(x.v) +
            '" data-hfk="' +
            esc(fk) +
            '" data-testid="cbl-hf-' +
            esc(fk) +
            '-' +
            esc(x.v) +
            '">' +
            esc(x.label) +
            '</button>'
          );
        })
        .join('') +
      '</div>'
    );
  }
  function sortChoices(I) {
    var out = [],
      seen = {};
    (I.o.sorts || []).forEach(function (x) {
      out.push({ id: x.key, label: x.label || x.key });
      seen[x.key] = 1;
    });
    columns(I).forEach(function (item) {
      var id = sortId(item);
      if (id && !seen[id]) {
        out.push({ id: id, label: item.label || item.key });
        seen[id] = 1;
      }
    });
    return out;
  }
  function filtPop(I, sorts) {
    var R = I.r,
      st = I.s.sort,
      cur = st ? st.key : (I.o.sorts || [])[0] && I.o.sorts[0].key;
    return (
      '<div data-cbsid="CMP033-D01"' + mountAttribute('CMP033') + ' class="cbl-pop left" role="dialog" data-pop="POP136" aria-label="' +
      esc(T(I, 'Filters')) +
      '" data-testid="cbl-filters-pop-' +
      esc(I.key) +
      '"><h4>' +
      esc(T(I, 'Filters')) +
      '</h4>' +
      (I.o.filters || [])
        .filter(function (item) {
          return !(typeof item.hide === 'function' && item.hide()); /* a filter with nothing to choose among (no line has the fact) is not offered */
        })
        .map(function (item) {
          return (
            '<div class="f"><span id="cbl-fl-' +
            esc(I.key) +
            '-' +
            esc(item.key) +
            '">' +
            esc(item.label || item.key) +
            '</span><select data-cbsid="CMP035-S01"' + mountAttribute('CMP035') + ' aria-labelledby="cbl-fl-' +
            esc(I.key) +
            '-' +
            esc(item.key) +
            '" data-filt="' +
            esc(item.key) +
            '" id="cbl-f-' +
            esc(I.key) +
            '-' +
            esc(item.key) +
            '" data-testid="listctl-filter-' +
            esc(item.key) +
            '"><option value="">' +
            esc(item.all || T(I, 'Any')) +
            '</option>' +
            fopts(item)
              .map(function (x) {
                return '<option value="' + esc(x.v) + '"' + (R.filt[item.key] === x.v ? ' selected' : '') + '>' + esc(x.label) + '</option>';
              })
              .join('') +
            '</select></div>'
          );
        })
        .join('') +
      (sorts.length > 1
        ? '<div class="f"><span id="cbl-sl-' +
          esc(I.key) +
          '">' +
          esc(T(I, 'Sort by')) +
          '</span><select data-cbsid="CMP035-S01"' + mountAttribute('CMP035') + ' aria-labelledby="cbl-sl-' +
          esc(I.key) +
          '" data-cbl-sort id="cbl-sort-' +
          esc(I.key) +
          '" data-testid="listctl-sort-' +
          esc(I.key) +
          '">' +
          sorts
            .map(function (x) {
              return '<option value="' + esc(x.id) + '"' + (cur === x.id ? ' selected' : '') + '>' + esc(x.label) + '</option>';
            })
            .join('') +
          '</select></div>'
        : '') +
      '<div class="cbl-acts"><button type="button" data-cbsid="CMP014-B01"' + mountAttribute('CMP014') + ' class="cbl-btn" data-cbl-clearf>' +
      esc(T(I, 'Clear all')) +
      '</button></div></div>'
    );
  }
  /** the small "+2 columns" cue on the Columns button: columns the row had no room for are named, never dropped silently (the chooser tags each one) */
  function leftOutKeys(I) {
    return I.card ? [] : I.leftOut || [];
  }
  function leftOutCue(list, keyText) {
    var left = leftOutKeys(list).length;
    if (!left) return '';
    var words = T(list, '+{n} columns hidden — no room', { n: left });
    return ' <span class="cbl-noroom" data-testid="cols-more-' + keyText + '" title="' + esc(words) + '" aria-label="' + esc(words) + '">+' + left + '</span>';
  }
  /** the ← or → button that moves a shown column one place (disabled at the edge); a spacer when the column is not shown */
  function colMoveHTML(I, item, on, dir, edge) {
    if (!on) return '<span class="cbl-mvsp"></span>';
    var word = dir === '-1' ? 'Move {x} left' : 'Move {x} right';
    return (
      '<button type="button" data-cbsid="CMP039-B03"' + mountAttribute('CMP039') + ' class="cbl-mv" data-mv="' +
      esc(item.key) +
      '" data-d="' + dir + '"' +
      (edge ? ' disabled' : '') +
      ' aria-label="' +
      esc(T(I, word, { x: item.label })) +
      '" title="' +
      esc(T(I, word, { x: item.label })) +
      '">' + (dir === '-1' ? '←' : '→') + '</button>'
    );
  }
  /** L16 F29: the drag handles are out of the Tab order, so the keyboard resizes here: narrower / wider, one step each */
  function colWidthButtonsHTML(I, item, on) {
    if (!on) return '';
    return ['-1', '1']
      .map(function (dir) {
        var word = dir === '1' ? 'Wider {x}' : 'Narrower {x}';
        return (
          '<button type="button" data-cbsid="CMP039-B03"' + mountAttribute('CMP039') + ' class="cbl-mv" data-wd="' +
          esc(item.key) +
          '" data-d="' + dir + '" data-testid="cols-wd-' + esc(item.key) + (dir === '1' ? '-more' : '-less') + '" aria-label="' +
          esc(T(I, word, { x: item.label })) +
          '" title="' +
          esc(T(I, word, { x: item.label })) +
          '">' + (dir === '1' ? '+' : '−') + '</button>'
        );
      })
      .join('');
  }
  /** the tick box and name of one column in the chooser: the name column is always on, a shown column with no room says so */
  function colTickHTML(I, item, on, view) {
    return (
      '<label' +
      (item.key === view.top ? ' title="' + esc(T(I, 'Always shown — it names the row')) + '"' : '') +
      '><input data-cbsid="CMP045-I03"' + mountAttribute('CMP045') + ' type="checkbox" data-col="' +
      esc(item.key) +
      '" data-testid="cols-' +
      view.key +
      '-' +
      esc(item.key) +
      '"' +
      (on ? ' checked' : '') +
      (item.key === view.top ? ' disabled' : '') +
      '> ' +
      esc(item.label || item.key) +
      (on && view.noRoom.indexOf(item.key) >= 0
        ? ' <span class="cbl-noroom" data-testid="cols-noroom-' + esc(item.key) + '">' + esc(T(I, 'hidden — no room')) + '</span>'
        : '') +
      '</label>'
    );
  }
  /** one row of the columns chooser: move left, tick box and name, move right, narrower and wider (view: the name column, the list key, the columns with no room, how many are shown) */
  function colRowHTML(I, item, index, on, view) {
    return (
      '<div class="cbl-colrow">' +
      colMoveHTML(I, item, on, '-1', index === 0) +
      colTickHTML(I, item, on, view) +
      colMoveHTML(I, item, on, '1', index === view.count - 1) +
      colWidthButtonsHTML(I, item, on) +
      '</div>'
    );
  }
  function colsPop(I) {
    var all = choosable(I),
      shown = shownKeys(I),
      by = {},
      top = topKey(I);
    all.forEach(function (item) {
      by[item.key] = item;
    });
    var rest = all.filter(function (item) {
        return shown.indexOf(item.key) < 0;
      }),
      k = esc(I.key),
      nr = noRoomKeys(I).concat(leftOutKeys(I)); /* no room: a card's extra fields, and the columns the last paint left out (autoFit) */
    var view = { top: top, key: k, noRoom: nr, count: shown.length };
    function row(item, index, on) {
      return colRowHTML(I, item, index, on, view);
    }
    return (
      '<div data-cbsid="CMP033-D01"' + mountAttribute('CMP033') + ' class="cbl-pop" role="dialog" data-pop="POP137" aria-label="' +
      esc(T(I, 'Choose columns')) +
      '" data-testid="cols-menu-' +
      k +
      '"><h4>' +
      esc(T(I, 'Shown — in this order')) +
      '</h4>' +
      shown
        .map(function (item, index) {
          return by[item] ? row(by[item], index, true) : '';
        })
        .join('') +
      (rest.length
        ? '<h4>' +
          esc(T(I, 'Available')) +
          '</h4>' +
          rest
            .map(function (item) {
              return row(item, 0, false);
            })
            .join('')
        : '') +
      '<div class="cbl-acts"><button type="button" data-cbsid="CMP037-B02"' + mountAttribute('CMP037') + ' class="cbl-btn" data-cbl-resetcols data-testid="cols-reset-' +
      k +
      '">' +
      esc(T(I, 'Reset to the standard columns')) +
      '</button></div></div>'
    );
  }

  /** paintList, step 1 of 10 (the data-cbl-part part, lines 2006-2028 of the one function): runs on, nothing here ends the call */
  function paintListCblPart(inst, ctx) {
ctx.box = $(inst, ':scope > .cbl-list');
    if (!ctx.box) {
      ctx.box = root.document.createElement('div');
      ctx.box.className = 'cbl-list';
      ctx.box.setAttribute('tabindex', '0');
      ctx.box.setAttribute('data-cbl-part', 'list');
      inst.el.appendChild(ctx.box);
    }
    ctx.box.setAttribute('aria-label', T(inst, 'Rows'));
    if (!ctx.box.__cblScroll) {
      ctx.box.__cblScroll = true;
      ctx.box.addEventListener(
        'scroll',
        function () {
          if (inst.o.onScroll)
            safe(function () {
              inst.o.onScroll(ctx.box);
            });
        },
        { passive: true }
      );
    }
    inst.card = ctx.box.clientWidth > 0 && ctx.box.clientWidth <= 620;
  }
  /** paintList, step 2 of 10 (part 2, lines 2029-2056 of the one function): runs on, nothing here ends the call */
  function paintListStep2(inst, ctx) {
    if (!ctx.box.__cblRO && root.ResizeObserver) {
      ctx.box.__cblRO = new root.ResizeObserver(function () {
        if (inst.dead) return;
        var c = ctx.box.clientWidth > 0 && ctx.box.clientWidth <= 620;
        if (c !== inst.card || (inst.auto && Math.abs(ctx.box.clientWidth - (inst.fitW || 0)) > 8)) {
          paintTools(inst);
          paintList(inst);
        }
      });
      try {
        ctx.box.__cblRO.observe(ctx.box);
      } catch (_) { /* best effort: failing here changes nothing the user sees */ }
    }
    ctx.keepTop = ctx.box.scrollTop;
ctx.o = inst.o;
ctx.R = inst.r;
ctx.s = inst.s;
ctx.cols = shownCols(inst);
ctx.tpl = template(inst, ctx.cols);
    if (inst.io) {
      try {
        inst.io.disconnect();
      } catch (_) { /* best effort: failing here changes nothing the user sees */ }
      inst.io = null;
    }
    inst.el.classList.toggle('tbllines', ctx.s.view === 'lines');
    ctx.state = typeof ctx.o.state === 'function' ? ctx.o.state() : ctx.o.state;
    ctx.hdr = headerHTML(inst, ctx.cols, ctx.tpl, ctx.state === 'loading');
  }
  /** paintList, step 3 of 10 (part 3, lines 2057-2081 of the one function): true when it handled the call and nothing else should run */
  function paintListStep3(inst, ctx) {
    if (ctx.state === 'loading') {
      ctx.box.innerHTML =
        '<div class="cbl-grid" role="grid" aria-busy="true">' + (ctx.s.view === 'grid' ? ctx.hdr : '') + '</div>' + new Array(7).join('<div class="cbl-skel"></div>');
      setHdrH(inst, ctx.box);
      return true;
    }
    if (ctx.state === 'error') {
      /* ⚠️ a caller may hand a plain SENTENCE (cap-finance did). A string has a native .sub() method (String.prototype.sub),
         so er.sub printed "function sub() { [native code] }" on screen. A string is the title; only an object has parts. */
      var er = val(ctx.o.error);
      er = typeof er === 'string' ? { title: er } : er || {};
      ctx.box.innerHTML =
        '<div class="cbl-state" role="alert" data-testid="cbl-error-' +
        esc(inst.key) +
        '"><div class="big">' +
        esc(er.title || T(inst, 'The list could not load.')) +
        '</div>' +
        esc(er.sub || T(inst, 'Nothing was lost. Try again in a moment.')) +
        '<br><button type="button" data-cbsid="CMP009-B01"' + mountAttribute('CMP009') + ' class="cbl-btn" data-cbl-retry>' +
        esc(T(inst, 'Try again')) +
        '</button></div>';
      return true;
    }
    ctx.m = matched(inst);
ctx.items = itemsOf(inst, ctx.m.rows);
    return false;
  }
  /** paintList, step 4 of 10 (part 4, lines 2082-2087 of the one function): runs on, nothing here ends the call */
  function paintListStep4(inst, ctx) {
    if (ctx.m.rows.length && ctx.s.view === 'grid') {
      ctx.cols = fitCols(inst, ctx.cols, ctx.m.rows, ctx.box); /* R47: too narrow for every column: the lowest-priority ones are left out of THIS paint */
      inst.fitW = ctx.box.clientWidth;
      ctx.tpl = template(inst, ctx.cols);
      ctx.hdr = headerHTML(inst, ctx.cols, ctx.tpl, false);
    }
  }
  /** paintList, step 5 of 10 (part 5, lines 2088-2127 of the one function): true when it handled the call and nothing else should run */
  function paintListStep5(inst, ctx) {
    if (!ctx.m.rows.length) {
      var narrowed = isNarrowed(inst);
      if (ctx.m.all.length && narrowed && !remote(inst)) {
        ctx.box.innerHTML =
          '<div class="cbl-state" data-testid="cbl-nomatch-' +
          esc(inst.key) +
          '"><div class="big">' +
          esc(T(inst, 'Nothing matches.')) +
          '</div>' +
          esc(ctx.R.q ? '“' + ctx.R.q + '” ' + T(inst, 'matches nothing here.') : T(inst, 'These filters match nothing here.')) +
          '<br><button type="button" data-cbsid="CMP014-B01"' + mountAttribute('CMP014') + ' class="cbl-btn" data-cbl-clear>' +
          esc(T(inst, 'Clear search and filters')) +
          '</button></div>';
      } else if (remote(inst) && narrowed) {
        ctx.box.innerHTML =
          '<div class="cbl-state" data-testid="cbl-nomatch-' +
          esc(inst.key) +
          '"><div class="big">' +
          esc(T(inst, 'Nothing matches.')) +
          '</div>' +
          esc(ctx.R.q ? '“' + ctx.R.q + '” ' + T(inst, 'matches nothing here.') : T(inst, 'These filters match nothing here.')) +
          '<br><button type="button" data-cbsid="CMP014-B01"' + mountAttribute('CMP014') + ' class="cbl-btn" data-cbl-clear>' +
          esc(T(inst, 'Clear search and filters')) +
          '</button></div>' +
          footHTML(inst);
      } else {
        var em = val(ctx.o.empty);
        em = typeof em === 'string' ? { title: em } : em || {}; /* same trap as er above */
        ctx.box.innerHTML =
          '<div class="cbl-state" data-testid="cbl-empty-' +
          esc(inst.key) +
          '"><div class="big">' +
          esc(em.title || T(inst, 'Nothing recorded yet.')) +
          '</div>' +
          esc(em.sub || '') +
          '</div>' +
          footHTML(inst);
      }
      return true;
    }
    return false;
  }
  /** paintList, step 6 of 10 (part 6, lines 2129-2139 of the one function): runs on, nothing here ends the call */
  function paintListStep6(inst, ctx) {
    /* the rows that can be drawn: a collapsed group's rows are not among them (so a collapsed group never leaves a "show more" behind) */
    ctx.items = ctx.items.filter(function (x) {
      return x.group != null || !(x.g != null && ctx.R.gcol[x.g]);
    });
    ctx.drawn = 0;
ctx.count = 0;
ctx.total = ctx.items.filter(function (x) {
        return x.group == null;
      }).length;
ctx.limit = inst.limit;
    if (ctx.limit > ctx.total) ctx.limit = inst.limit = Math.max(50, Math.min(ctx.limit, ctx.total));
    ctx.body = '';
  }
  /** paintList, step 7 of 10 (part 7, lines 2140-2168 of the one function): runs on, nothing here ends the call */
  function paintListStep7(inst, ctx) {
    for (var index = 0; index < ctx.items.length; index++) {
      var it = ctx.items[index];
      if (it.group != null) {
        ctx.count = 0; /* the stripe starts again under each group head */
        var shut = !!ctx.R.gcol[it.gkey],
          gt = ctx.o.group && ctx.o.group.tid;
        ctx.body +=
          '<div class="cbl-group" role="row" tabindex="0" aria-expanded="' +
          !shut +
          '" data-g="' +
          esc(it.gkey) +
          '"' +
          (gt || ctx.o.group.headTid ? ' data-testid="' + esc(ctx.o.group.headTid ? ctx.o.group.headTid(it.gkey) : gt + '-ghead-' + esc(it.gkey)) + '"' : '') +
          ' style="cursor:pointer"><span class="cbl-tw" aria-hidden="true">' +
          (shut ? '▸' : '▾') +
          '</span><b role="gridcell">' +
          esc(it.group) +
          '</b> <span class="fig" role="gridcell"' +
          (gt ? ' data-testid="' + esc(gt) + '-gsum-' + esc(it.gkey) + '"' : '') +
          '>' +
          esc(it.fig) +
          '</span></div>';
        continue;
      }
      if (!remote(inst) && ctx.drawn >= ctx.limit) break;
      ctx.drawn++;
      var zb = ctx.count++ % 2 === 1; /* ZEBRA: the 2nd, 4th … data row of the list (or of its group) */
      ctx.body += ctx.s.view === 'grid' ? rowHTML(inst, it, ctx.cols, ctx.tpl, zb) : lineHTML(inst, it, ctx.cols, zb);
    }
  }
  /** paintList, step 8 of 10 (part 8, lines 2169-2190 of the one function): runs on, nothing here ends the call */
  function paintListStep8(inst, ctx) {
    /* ctx.end starts undefined */
    if (!remote(inst) && ctx.drawn < ctx.total)
      ctx.end =
        '<div class="cbl-end" data-cbl-sentinel data-testid="cbl-more-' +
        esc(inst.key) +
        '"><button type="button" data-cbsid="CMP037-B05"' + mountAttribute('CMP037') + ' data-cbl-more>' +
        esc(T(inst, '↓ Show {n} more', { n: Math.min(50, ctx.total - ctx.drawn) })) +
        '</button> <span>' +
        ctx.drawn +
        ' ' +
        esc(T(inst, 'of')) +
        ' ' +
        ctx.total +
        '</span></div>';
    else
      ctx.end = remote(inst)
        ? ''
        : '<div class="cbl-end" data-testid="cbl-end-' +
          esc(inst.key) +
          '">' +
          esc(T(inst, 'end of list')) +
          '</div>';
  }
  /** paintList, step 9 of 10 (part 9, lines 2191-2204 of the one function): runs on, nothing here ends the call */
  function paintListStep9(inst, ctx) {
    /* the count is said once, in the tools — not again here (ai-eye E-3/E-13) */
    ctx.box.innerHTML =
      '<div class="cbl-grid' +
      (ctx.s.view === 'lines' ? ' cbl-lines' : '') +
      (inst.auto ? ' cbl-fit' : '') +
      '" role="' + gridRole(inst, ctx.items) + '" aria-rowcount="' +
      ctx.total +
      '">' +
      (ctx.s.view === 'grid' ? ctx.hdr : '') +
      ctx.body +
      '</div>' +
      ctx.end +
      footHTML(inst);
    setHdrH(inst, ctx.box);
    ctx.box.scrollTop = ctx.keepTop;
  }
  /** paintList, step 10 of 10 (the data-cbl-sentinel part, lines 2205-2228 of the one function): runs on, nothing here ends the call */
  function paintListCblSentinel(inst, ctx) {
    if (!remote(inst) && ctx.drawn < ctx.total) {
      var sent = ctx.box.querySelector('[data-cbl-sentinel]');
      if (sent && root.IntersectionObserver) {
        try {
          inst.io = new root.IntersectionObserver(
            function (list) {
              if (
                list.some(function (e) {
                  return e.isIntersecting;
                })
              ) {
                inst.limit += 50;
                paintList(inst);
              }
            },
            { root: ctx.box, rootMargin: '0px' }
          );
          inst.io.observe(sent);
        } catch (_) { /* best effort: failing here changes nothing the user sees */ }
      }
    }
    var node = $(inst, '.cbl-count');
    if (node) node.textContent = countText(inst, ctx.m);
    resolveNext(inst);
  }
  /* the rows area: header (sticky) + rows, or one of the four states */
  function paintList(I) {
  var ctx = {},
    steps = [paintListCblPart, paintListStep2, paintListStep3, paintListStep4, paintListStep5, paintListStep6, paintListStep7, paintListStep8, paintListStep9, paintListCblSentinel];
  for (var at = 0; at < steps.length; at++) {
    if (steps[at](I, ctx)) return;
  }
  }
  function footHTML(I) {
    var f = I.o.remote && I.o.remote.foot;
    var v = f
      ? safe(function () {
          return f();
        }, '')
      : '';
    return v ? '<div class="cbl-foot" data-testid="cbl-foot-' + esc(I.key) + '">' + v + '</div>' : '';
  }
  /* a row that opens (aria-expanded) and a group head that folds are only valid inside a treegrid (axe aria-conditional-attr, aria-required-children) */
  function gridRole(unit, items) {
    return hasNext(unit) ||
      items.some(function (entry) {
        return entry.group != null;
      })
      ? 'treegrid'
      : 'grid';
  }
  function setHdrH(I, box) {
    var node = box.querySelector('.cbl-hdr');
    box.style.setProperty('--cl-hdr-h', (node ? node.offsetHeight : 0) + 'px');
  }

  /** the small filter menu button behind a column heading (a list opener, CMP033); none when the column has no filter or the list is server-paged */
  function headerFilterHTML(list, item, plainHead) {
    if (!item.hfilter || remote(list)) return '';
    return (
      '<button type="button" data-cbsid="CMP033-B01"' + mountAttribute('CMP033') + ' class="cbl-hf' +
      (list.r.filt[item.hfilter] ? ' on' : '') +
      '"' +
      (plainHead ? ' disabled tabindex="-1"' : ' data-hf="' + esc(item.hfilter) + '"') +
      ' data-testid="cbl-hf-' +
      esc(item.hfilter) +
      '" aria-haspopup="menu" aria-expanded="' +
      (list.pop === 'hf:' + item.hfilter) +
      '" aria-label="' +
      esc(T(list, 'Filter {x}', { x: item.label || item.key })) +
      '" title="' +
      esc(T(list, 'Filter {x}', { x: item.label || item.key })) +
      '">' +
      (list.r.filt[item.hfilter] ? '●' : '▾') +
      '</button>'
    );
  }
  /** the column resize handle (CMP039-B02); the loading header has none */
  function headerResizeHTML(list, item, plainHead) {
    if (plainHead) return '';
    return (
      '<button type="button" data-cbsid="CMP039-B02"' + mountAttribute('CMP039') + ' class="cbl-rz colrz" data-rz="' +
      esc(item.key) +
      '" tabindex="-1" data-testid="cbl-rz-' + esc(item.key) + '" aria-label="' +
      esc(T(list, 'Resize {x} column (arrow keys)', { x: item.label || item.key })) +
      '" title="' +
      esc(T(list, 'Drag to resize · double-click resets')) +
      '"></button>'
    );
  }
  /** a column whose cells sit at the right: a number, money, or the pinned action column */
  function rightAligned(item) {
    return !!(item.num || item.money || item.type === 'num' || item.type === 'money' || item.pin === 'end');
  }
  /** the sort arrow of a heading: ▼ when sorted descending, ▲ ascending, ⇅ when it is not the sort */
  function sortArrow(sorted, st) {
    return sorted ? (st.dir === -1 ? '▼' : '▲') : '⇅';
  }
  /** one column heading cell: its label, its sort button (inert while loading) and its filter and resize handles */
  function headerCellHTML(item, sortState, plainHead, list) {
          var id = sortId(item),
            sorted = !!(sortState && id && sortState.key === id),
            r = rightAligned(item),
            label = esc(item.label || item.key);
          return (
            '<div class="cbl-hc lhcell' +
            (r ? ' r' : '') +
            (id ? ' sortable' : '') +
            '" role="columnheader" aria-sort="' +
            (sorted ? (sortState.dir === -1 ? 'descending' : 'ascending') : 'none') +
            '">' +
            (id
              ? '<button type="button" data-cbsid="CMP039-B01"' + mountAttribute('CMP039') + ' class="sort" title="' + label + '"' +
                (plainHead ? ' disabled tabindex="-1"' : ' data-sort="' + esc(id) + '"') +
                '>' +
                '<span class="cbl-hl">' + label + '</span> <span class="arrow">' +
                sortArrow(sorted, sortState) +
                '</span></button>'
              : label) /* the loading header keeps the SAME boxes (its buttons are just inert), so it does not change height when the rows arrive */ +
            headerFilterHTML(list, item, plainHead) +
            headerResizeHTML(list, item, plainHead) +
            '</div>'
          );
        }
  function headerHTML(list, cols, tpl, plainHead) {
    var sortState = curSort(list);
    var lead = leadOn(list) ? '<div class="cbl-hc" role="columnheader" aria-label="' + esc(T(list, 'Select')) + '"></div>' : '';
    return (
      '<div class="cbl-hdr lhead" role="row" style="grid-template-columns:' +
      tpl +
      '">' +
      lead +
      cols
        .map(function (item) {
          return headerCellHTML(item, sortState, plainHead, list);
        })
        .join('') +
      '</div>'
    );
  }
  function cellOf(I, c, row) {
    var v = safe(function () {
      return c.cell ? c.cell(row) : row[c.key];
    }, '');
    if (v == null) v = '';
    return c.html ? String(v) : esc(v);
  }
  function rowAttrs(I, row, id) {
    var a = '',
      o = I.o,
      at = o.rowAttrs
        ? safe(function () {
            return o.rowAttrs(row);
          }, null)
        : null;
    if (at)
      Object.keys(at).forEach(function (item) {
        if (/^[a-z][a-z0-9-]*$/i.test(item) && !/^on/i.test(item)) a += ' ' + item + '="' + esc(at[item]) + '"';
      });
    var tid = o.rowTid
      ? safe(function () {
          return o.rowTid(row);
        }, '')
      : '';
    return (tid ? ' data-testid="' + esc(tid) + '"' : '') + a;
  }
  /** rowHTML, step 1 of 3 (part 1, lines 2416-2430 of the one function): runs on, nothing here ends the call */
  function rowHTMLStep1(inst, entry, cols, tpl, zebra, ctx) {
ctx.row = entry.row;
ctx.id = entry.id;
var R = inst.r;
ctx.nx = hasNext(inst);
ctx.open = ctx.nx && isOpen(inst, ctx.id);
var o = inst.o;
    ctx.cls = (o.rowClass
        ? safe(function () {
            return o.rowClass(ctx.row);
          }, '')
        : '') +
      (R.hl === ctx.id && o.hl !== false ? ' sel' : '') +
      (zebra ? ' z' : '') +
      (entry.g != null ? ' ing' : '');
  }
  /** the extra classes of a body cell: the first one, the pinned action column strong and right, numbers and money right in mono, mono, the line a card gives an action */
  function cellClasses(item, index) {
    var amt = item.pin === 'end';
    return (
      (index === 0 ? ' first' : '') +
      (amt ? ' r mono strong amt' : '') +
      ((item.num || item.money || item.type === 'num' || item.type === 'money') && !amt ? ' r mono' : '') +
      (item.mono ? ' mono' : '') +
      (item.cardAct ? ' cbl-actline' : '')
    );
  }
  /** one body cell of a row: its classes (money and numbers right-aligned in mono, the pinned action column strong), its phone label, its test id and the expand caret on the first cell */
  function rowCellHTML(item, index, ctx, inst) {
        return (
          '<div class="cbl-cell lcell' +
          cellClasses(item, index) +
          '" data-l="' +
          esc(index === 0 || item.cardAct ? '' : item.label || '') +
          '" role="gridcell"' +
          (item.tid
            ? ' data-testid="' +
              esc(
                safe(function () {
                  return item.tid(ctx.row);
                }, '')
              ) +
              '"'
            : '') +
          '>' +
          (index === 0 && ctx.nx
            ? '<span class="cbl-tw" data-cbsid="CMP034-B01"' + mountAttribute('CMP034') + ' data-caret role="button" aria-label="' +
              esc(T(inst, ctx.open ? 'Collapse' : 'Expand')) +
              '" aria-expanded="' +
              !!ctx.open +
              '">▸</span>'
            : '') +
          cellOf(inst, item, ctx.row) +
          '</div>'
        );
      }
  /** rowHTML, step 2 of 3 (part 2, lines 2431-2465 of the one function): runs on, nothing here ends the call */
  function rowHTMLStep2(inst, it, cols, tpl, zb, ctx) {
    ctx.cells = cols
      .map(function (item, index) {
          return rowCellHTML(item, index, ctx, inst);
        })
      .join('');
  }
  /** rowHTML, step 3 of 3 (part 3, lines 2466-2483 of the one function): runs on, nothing here ends the call */
  function rowHTMLStep3(inst, entry, cols, tpl, zebra, ctx) {
    var lead = leadOn(inst) ? '<div class="cbl-lead" role="gridcell">' + leadCell(inst, ctx.row, ctx.id) + '</div>' : '';
    ctx.out = '<div class="cbl-row lrow grow' +
      (ctx.open ? ' cbl-open open' : '') +
      (ctx.cls ? ' ' + esc(ctx.cls) : '') +
      '" role="row" data-row="' +
      esc(ctx.id) +
      '" tabindex="0"' +
      (ctx.nx ? ' aria-expanded="' + !!ctx.open + '"' : '') +
      ' style="grid-template-columns:' +
      tpl +
      '"' +
      rowAttrs(inst, ctx.row, ctx.id) +
      '>' +
      lead +
      ctx.cells +
      '</div>';
    if (ctx.open) ctx.out += nextHTML(inst, ctx.row, ctx.id);
  }
  function rowHTML(I, it, cols, tpl, zb) {
  var ctx = {},
    steps = [rowHTMLStep1, rowHTMLStep2, rowHTMLStep3];
  for (var at = 0; at < steps.length; at++) {
    if (steps[at](I, it, cols, tpl, zb, ctx)) return;
  }
  return ctx.out;
  }
  function leadCell(I, row, id) {
    if (
      I.o.lead &&
      safe(function () {
        return I.o.lead.on();
      }, false)
    )
      return safe(function () {
        return I.o.lead.cell(row);
      }, '');
    return '<input data-cbsid="CMP045-I03"' + mountAttribute('CMP045') + ' type="checkbox" data-selrow="' + esc(id) + '"' + (I.r.sel[id] ? ' checked' : '') + ' aria-label="' + esc(T(I, 'Select')) + '">';
  }
  /** lineHTML, step 1 of 5 (part 1, lines 2499-2515 of the one function): runs on, nothing here ends the call */
  function lineHTMLStep1(inst, entry, cols, zebra, ctx) {
ctx.row = entry.row;
ctx.id = entry.id;
ctx.nx = hasNext(inst);
ctx.open = ctx.nx && isOpen(inst, ctx.id);
ctx.o = inst.o;
ctx.pin = cols.filter(function (item) {
        return item.pin === 'end';
      })[0];
    ctx.cls = (ctx.o.rowClass
        ? safe(function () {
            return ctx.o.rowClass(ctx.row);
          }, '')
        : '') +
      (inst.r.hl === ctx.id && ctx.o.hl !== false ? ' sel' : '') +
      (zebra ? ' z' : '') +
      (entry.g != null ? ' ing' : '');
  }
  /** lineHTML, step 2 of 5 (part 2, lines 2516-2544 of the one function): runs on, nothing here ends the call */
  function lineHTMLStep2(inst, entry, cols, zebra, ctx) {
    ctx.flow = cols
      .filter(function (item) {
        return item.pin !== 'end';
      })
      .map(function (item) {
        var v = cellOf(inst, item, ctx.row),
          t = plain(v);
        if (!t || t === '—') return '';
        return (
          '<span class="cbl-fl lcell' +
          (item.mono ? ' cbl-num' : '') +
          '" data-l="' +
          esc(item.label || '') +
          '"' +
          (item.tid
            ? ' data-testid="' +
              esc(
                safe(function () {
                  return item.tid(ctx.row);
                }, '')
              ) +
              '"'
            : '') +
          '>' +
          v +
          '</span>'
        );
      })
      .join('');
  }
  /** lineHTML, step 3 of 5 (part 3, lines 2545-2550 of the one function): runs on, nothing here ends the call */
  function lineHTMLStep3(inst, it, cols, zb, ctx) {
    ctx.gist = ctx.o.gist
      ? safe(function () {
          return ctx.o.gist(ctx.row);
        }, '')
      : '';
    ctx.lead = leadOn(inst) ? '<span class="cbl-lead" style="padding:0 8px 0 0">' + leadCell(inst, ctx.row, ctx.id) + '</span>' : '';
  }
  /** lineHTML, step 4 of 5 (part 4, lines 2551-2571 of the one function): runs on, nothing here ends the call */
  function lineHTMLStep4(inst, entry, cols, zebra, ctx) {
    ctx.out = '<div class="cbl-lrec lrow' +
      (ctx.open ? ' cbl-open open' : '') +
      (ctx.cls ? ' ' + esc(ctx.cls) : '') +
      '" role="row" data-row="' +
      esc(ctx.id) +
      '" tabindex="0"' +
      (ctx.nx ? ' aria-expanded="' + !!ctx.open + '"' : '') +
      rowAttrs(inst, ctx.row, ctx.id) +
      '><div class="cbl-lline" role="gridcell">' +
      ctx.lead +
      (ctx.nx
        ? '<span class="cbl-tw" data-cbsid="CMP034-B01"' + mountAttribute('CMP034') + ' data-caret role="button" aria-label="' + esc(T(inst, ctx.open ? 'Collapse' : 'Expand')) + '" aria-expanded="' + !!ctx.open + '">▸</span>'
        : '') +
      '<span class="cbl-lflow">' +
      ctx.flow +
      '</span>' +
      (ctx.pin ? '<span class="cbl-lamt">' + cellOf(inst, ctx.pin, ctx.row) + '</span>' : '') +
      '</div>' +
      (ctx.gist ? '<div class="cbl-lgist" role="gridcell"' + (ctx.o.gistTid ? ' data-testid="' + esc(ctx.o.gistTid(ctx.row)) + '"' : '') + '>' + esc(ctx.gist) + '</div>' : '') +
      '</div>';
  }
  /** lineHTML, step 5 of 5 (part 5, lines 2572-2572 of the one function): runs on, nothing here ends the call */
  function lineHTMLStep5(inst, it, cols, zb, ctx) {
    if (ctx.open) ctx.out += nextHTML(inst, ctx.row, ctx.id);
  }
  function lineHTML(I, it, cols, zb) {
  var ctx = {},
    steps = [lineHTMLStep1, lineHTMLStep2, lineHTMLStep3, lineHTMLStep4, lineHTMLStep5];
  for (var at = 0; at < steps.length; at++) {
    if (steps[at](I, it, cols, zb, ctx)) return;
  }
  return ctx.out;
  }
  /* what a row opens to: the page's markup (trusted by contract), then the row actions the unit draws itself */
  function nextHTML(I, row, id) {
    var o = I.o,
      inner = '';
    if (o.next) {
      if (I.nextCache[id] !== undefined) inner = I.nextCache[id];
      else {
        var v = safe(function () {
          return o.next(row, { view: I.s.view, id: id });
        }, '');
        if (v && typeof v.then === 'function') {
          inner = o.nextPending
            ? safe(function () {
                return o.nextPending(row);
              }, '')
            : '<span class="cbl-dim">' +
              esc(T(I, 'Reading…')) +
              '</span>'; /* nextPending: the card's own shape while its answer is on the way, so it does not change height */
          I.pending = I.pending || {};
          I.pending[id] = v;
        } else {
          inner = v == null ? '' : String(v);
        }
      }
    }
    var acts = (o.actions || []).filter(function (item) {
      return (
        !item.when ||
        safe(function () {
          return item.when(row);
        }, true)
      );
    });
    return (
      '<div class="cbl-next" role="row" data-next="' +
      esc(id) +
      '"><div role="cell">' +
      inner +
      '</div>' +
      (acts.length
        ? '<div class="cbl-acts" role="cell">' +
          (function () {
            var whys = acts.map(function (item) {
              return item.why
                ? safe(function () {
                    return item.why(row);
                  }, '')
                : '';
            }); /* the page asks the server's answer for this login; a sentence = refused, shown greyed with it */
            /* every action refused for the same reason (a view-only login): the sentence ONCE after the row's buttons, not six times (ai-eye E-1) */
            var one =
              acts.length > 1 &&
              whys[0] &&
              whys.every(function (item) {
                return item === whys[0];
              })
                ? whys[0]
                : '';
            return (
              acts
                .map(function (item, index) {
                  var why = whys[index];
                  var btn =
                    '<button type="button" data-cbsid="CMP038-B01"' + mountAttribute('CMP038') + ' class="cbl-btn" data-act="' +
                    esc(item.id) +
                    '" data-actrow="' +
                    esc(id) +
                    '"' +
                    (item.tid ? ' data-testid="' + esc(item.tid) + '"' : '') +
                    (why ? ' disabled aria-disabled="true" title="' + esc(why) + '"' : '') +
                    '>' +
                    (item.icon ? esc(item.icon) + ' ' : '') +
                    esc(T(I, item.label)) +
                    '</button>';
                  return why && !one
                    ? '<span class="cbl-act">' +
                        btn +
                        '<span class="cbl-why"' +
                        (item.tid ? ' data-testid="' + esc(item.tid) + '-why"' : '') +
                        '>' +
                        esc(why) +
                        '</span></span>'
                    : btn;
                })
                .join('') + (one ? '<span class="cbl-why" data-testid="cbl-why-' + esc(id) + '">' + esc(one) + '</span>' : '')
            );
          })() +
          '</div>'
        : '') +
      '</div>'
    );
  }
  function resolveNext(I) {
    var p = I.pending;
    if (!p) return;
    I.pending = null;
    Object.keys(p).forEach(function (id) {
      p[id].then(
        function (html) {
          I.nextCache[id] = html == null ? '' : String(html);
          if (I.dead) return;
          var node = I.el.querySelector('.cbl-next[data-next="' + (root.CSS && root.CSS.escape ? root.CSS.escape(id) : id) + '"] > div');
          if (node) node.innerHTML = I.nextCache[id];
        },
        function () {
          I.nextCache[id] = '<span class="cbl-dim">' + esc(T(I, 'The list could not load.')) + '</span>';
          if (!I.dead) paintList(I);
        }
      );
    });
  }
  function selectedRows(I) {
    var ids = I.r.sel;
    return allRows(I).filter(function (item, index) {
      return ids[rowIdOf(I, item, index)];
    });
  }

  /* the rows area fills the rest of the window: from its top edge to the bottom of the viewport, recalculated on resize.
     ⭐ SET-WALK1 · W21 (15 Oct): an EMPTY or SHORT list is as tall as its content — the "only rows scroll" height applies only when the rows
     overflow it. Before: every list took the window's rest (an empty sessions list painted 2,400 px of nothing), and a list scrolled up out of
     a scrolling pane (its top NEGATIVE) grew by the scrolled distance. Now: the top is clamped at the window's edge, the natural height is
     measured with the inline height off, and the window height is set only when the content would overflow it. */
  function fit(I) {
    if (I.o.fill === false || !I.el.getBoundingClientRect) return;
    var top = Math.max(0, I.el.getBoundingClientRect().top),
      avail = Math.max(300, Math.floor(root.innerHeight - top - (I.o.bottom == null ? 8 : I.o.bottom)));
    I.el.style.height = '';
    var natural = I.el.scrollHeight;
    I.el.style.height = natural > avail ? avail + 'px' : '';
    I.el.setAttribute('data-cbl-fit', natural > avail ? 'window' : 'content');
  }

  /* ═════ actions ═════ */
  function resetLimit(I) {
    I.limit = 50;
  }
  function query(I, why, sort, now) {
    if (!remote(I)) return false;
    clearTimeout(I.qt);
    var go = function () {
      safe(function () {
        I.o.remote.onQuery({ why: why || 'search', q: I.r.q, filt: JSON.parse(JSON.stringify(I.r.filt)), sort: sort || curSort(I), group: I.s.group });
      });
    };
    if (now) go();
    else I.qt = setTimeout(go, 250);
    return true;
  }
  function refresh(I, x) {
    if (I.dead) return;
    if (Array.isArray(x)) I.o.rows = x;
    else if (x && typeof x === 'object') {
      Object.keys(x).forEach(function (item) {
        if (item === 'remote' && I.o.remote) Object.assign(I.o.remote, x.remote);
        else I.o[item] = x[item];
      });
    }
    I.nextCache = {};
    paintAll(I);
  }
  function setQ(I, v) {
    I.r.q = v;
    resetLimit(I);
    if (query(I)) {
      var node = $(I, '.cbl-count');
      return;
    }
    paintList(I);
  }
  function toggleRow(I, id, focus) {
    var R = I.r;
    R.hl = id;
    if (R.allOpen) R.open[id + '#closed'] = !R.open[id + '#closed'];
    else {
      var wasOpen = !!R.open[id];
      if (I.o.oneOpen) R.open = {}; /* oneOpen: a list whose next level is a working panel (an answer to give) keeps ONE row open; opening another closes the first */
      R.open[id] = !wasOpen;
    }
    var keep = I.el.querySelector('.cbl-list'),
      top = keep ? keep.scrollTop : 0;
    paintList(I);
    if (keep) {
      var node = $(I, ':scope > .cbl-list');
      if (node) node.scrollTop = top;
    }
    if (focus) refocusRow(I, id);
  }
  function refocusRow(I, id) {
    var node = I.el.querySelector('[data-row="' + (root.CSS && root.CSS.escape ? root.CSS.escape(id) : id) + '"]');
    if (node) node.focus();
  }
  function rowById(I, id) {
    var all = allRows(I),
      r = null;
    all.forEach(function (x, index) {
      if (r == null && rowIdOf(I, x, index) === id) r = x;
    });
    return r;
  }
  function openRow(I, id, ev) {
    var row = rowById(I, id);
    if (!row) return;
    I.r.hl = id;
    if (I.o.onOpen) {
      safe(function () {
        I.o.onOpen(row, ev);
      });
      return;
    }
    if (hasNext(I)) {
      toggleRow(I, id, ev && ev.type === 'keydown');
      return;
    }
    /* L16 F29: Enter on a row with no open handler runs the row's main action: its first link or button (a mouse click on the row never reaches here) */
    var rowNode = ev && ev.type === 'keydown' ? I.el.querySelector('[data-row="' + cssId(id) + '"]') : null;
    var main = rowNode && rowNode.querySelector('a[href],button:not([disabled]):not([data-caret]),[data-act]');
    if (main) main.click();
  }
  function closePop(list, refocus) {
    if (!list.pop) return;
    var was = list.pop;
    list.pop = null;
    list.pv = null;
    paintTitle(list);
    paintTools(list);
    if (refocus) {
      var node = list.el.querySelector('[data-cbl-pop="' + was + '"]') || list.el.querySelector('[data-cbl-pop="view"]');
      if (node) node.focus();
    }
  }
  function togglePop(list, name) {
    list.pop = list.pop === name ? null : name;
    paintTitle(list);
    paintTools(list);
    var node = list.el.querySelector('.cbl-pop');
    if (node) {
      var f = node.querySelector('select,input:not([disabled]),button:not([disabled])');
      if (f && name !== 'period') f.focus();
    }
  }

  function csv(I) {
    var m = matched(I),
      cols = shownCols(I);
    var q = function (text) {
      text = String(text == null ? '' : text);
      return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
    };
    var lines = [
      cols
        .map(function (item) {
          return q(item.label || item.key);
        })
        .join(',')
    ];
    m.rows.forEach(function (item) {
      lines.push(
        cols
          .map(function (c) {
            var v = safe(function () {
              return c.cell ? c.cell(item) : item[c.key];
            }, '');
            return q(c.html ? plain(v) : v);
          })
          .join(',')
      );
    });
    return lines.join('\r\n');
  }
  function download(I) {
    if (typeof I.o.csv === 'function') {
      safe(function () {
        I.o.csv(matched(I).rows, shownCols(I), csv(I));
      });
      return;
    }
    try {
      var b = new root.Blob(['﻿' + csv(I)], { type: 'text/csv;charset=utf-8' }),
        u = root.URL.createObjectURL(b),
        node = root.document.createElement('a');
      node.href = u;
      node.download = I.key + '.csv';
      root.document.body.appendChild(node);
      node.click();
      node.remove();
      setTimeout(function () {
        root.URL.revokeObjectURL(u);
      }, 2000);
    } catch (_) { /* best effort: failing here changes nothing the user sees */ }
  }


  /* one document-level listener each: a click anywhere outside a mounted list closes its popover; a resize refits every list to its window */
  if (root.document && root.document.addEventListener) {
    root.document.addEventListener('click', function (ev) {
      if (ev.target && ev.target.isConnected === false) return; /* the click repainted its own button away: that was a click INSIDE the list */
      INST.forEach(function (item) {
        if (item.pop && !item.dead && !item.el.contains(ev.target)) closePop(item);
      });
    });
    /* ↑ ↓ move the highlighted row and Enter opens it, wherever the focus is not (a page with a list on it, nothing focused): the page does not wire this */
    root.document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        var open = INST.filter(function (item) {
          return !item.dead && item.pop;
        });
        if (open.length) {
          event.preventDefault();
          closePop(open[open.length - 1], true);
          return;
        }
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') return;
      if (event.defaultPrevented) return; /* a list's own handler already took it (and may have repainted its target away) */
      var node = event.target;
      if (node && node.isConnected === false) return;
      if (node && node.tagName && /^(INPUT|SELECT|TEXTAREA|BUTTON|A|SUMMARY)$/.test(node.tagName)) return;
      if (node && node.closest && (node.closest('[data-cbl] [data-row]') || node.closest('dialog[open],[role=dialog],[aria-modal=true]'))) return;
      var live = INST.filter(function (item) {
          return !item.dead && item.o.hl !== false && item.el.getClientRects().length;
        }),
        I = live[live.length - 1];
      if (!I) return;
      var rows = [].slice.call(I.el.querySelectorAll('[data-row]'));
      if (!rows.length) return;
      if (event.key === 'Enter') {
        if (I.r.hl) {
          event.preventDefault();
          openRow(I, I.r.hl, event);
        }
        return;
      }
      var at = rows
        .map(function (item) {
          return item.getAttribute('data-row');
        })
        .indexOf(I.r.hl);
      at = event.key === 'ArrowDown' ? Math.min(rows.length - 1, at + 1) : Math.max(0, at < 0 ? 0 : at - 1);
      event.preventDefault();
      I.r.hl = rows[at].getAttribute('data-row');
      rows.forEach(function (item, index) {
        item.classList.toggle('sel', index === at);
      });
      if (rows[at].scrollIntoView) rows[at].scrollIntoView({ block: 'nearest' });
    });
    root.addEventListener('resize', function () {
      prune();
      INST.forEach(function (item) {
        fit(item);
        setHdrH(item, item.el.querySelector('.cbl-list') || item.el);
        var n = isPhone();
        if (n !== item.narrow) {
          paintTitle(item);
          paintTools(item);
        }
      });
    });
  }

  /* the rows a next level is made of: the first cell takes the room, the others are fixed-width and right-aligned (cells are the page's own trusted markup) */
  function nextRow(cells, widths) {
    return (
      '<div class="cbl-nrow" style="display:flex;align-items:center;font-size:calc(13.5px * var(--k,1));padding:3px 0">' +
      cells
        .map(function (item, index) {
          return index === 0
            ? '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + item + '</span>'
            : '<span style="width:' + ((widths && widths[index - 1]) || 110) + 'px;text-align:end">' + item + '</span>';
        })
        .join('') +
      '</div>'
    );
  }
  function get(key) {
    prune();
    var f = null;
    INST.forEach(function (item) {
      if (item.key === String(key) && !item.dead) f = item.api;
    });
    return f;
  }

  /* forget what a person typed, chose and opened in list `key` (a different record is on screen under the same list: a new ledger, the other tab) */
  function reset(key) {
    delete STATE[String(key)];
  }

  /**
   * EVERY PAGE of a server-paged list (DISCIPLINES §2: top-level total · page · limit), for a screen that sums the WHOLE set
   * rather than drawing it (the test board's coverage and verdicts — T2-PAGING). `fetchPage(n)` answers page n: an array, or
   * an object holding the rows under `key`. Pages are read until the rows reach the answer's `total` (an answer with no
   * total is one page). Resolves to every row; a failed page rejects, so the caller says it could not read.
   */
  function every(fetchPage, key) {
    var all = [];
    function step(page) {
      return Promise.resolve(fetchPage(page)).then(function (reply) {
        var rows = Array.isArray(reply) ? reply : (reply && reply[key]) || [];
        all = all.concat(rows);
        var more = rows.length && reply.total != null && all.length < reply.total && !(reply.limit && rows.length < reply.limit) && page < 200;
        return more ? step(page + 1) : all;
      });
    }
    return step(1);
  }

  /** one button of the pager pair: Previous (glyph first) or Next (glyph last) with its register code */
  function pagerButton(side, code, spec) {
    var text = esc(spec.label);
    var sid = 'CMP037-' + code; /* B06 or B07: held in a name so the census reads the code on the element */
    return (
      '<button type="button" data-cbsid="' + sid + '"' + mountAttribute('CMP037') + ' class="act quiet cbl-pgbtn" data-testid="' + esc(spec.tid) + '" onclick="' + esc(spec.act) + '"' +
      (spec.off ? ' disabled' : '') + '>' + (side === 'prev' ? '‹ ' + text : text + ' ›') + '</button>'
    );
  }
  /**
   * The Previous / Next pair of a server-paged page (list command CMP037 B06 and B07): one drawing, so every pager gets the same tap box and codes.
   * pair: { prev, next } each { label, tid, act (the click handler text), off (true greys it) }; the page keeps what each press does.
   */
  function pager(pair) {
    return pagerButton('prev', 'B06', pair.prev) + pagerButton('next', 'B07', pair.next);
  }

  /**
   * W15-108 · THE SUB-TABLE a row opens to: its own grey header row, then plain rows — nothing here is drawn like a button except a header you can sort by.
   * o = { id, cols: [{ k, label, w (px; none = the one wide column), r (right-aligned), sort (true = a header button) }], rows: [[html per column]], sort: { k, dir }, act (the handler text of a sort press, called with the key) , empty (words) }
   * Pure drawing: the page keeps what a sort does (a server read for a server-paged list).
   */
  function nextTable(o) {
    var cols = o.cols || [];
    var cards = cols.some(function (col) {
      return col.ln != null;
    }); /* a table that says which line each column takes on a phone draws a 2-line card there (ln 1 · 2 · 0 = left off) */
    var cell = function (col, html, index) {
      return '<div class="cbl-ntc' + (index === 0 ? ' first' : '') + (col.r ? ' r' : '') + (col.end ? ' end' : '') + '"' + (cards ? ' data-ln="' + (col.ln || 0) + '"' : '') + (col.w ? ' style="width:' + col.w + 'px"' : '') + '>' + html + '</div>';
    };
    var head = cols
      .map(function (col, index) {
        var on = o.sort && o.sort.k === col.k,
          arrow = on ? (o.sort.dir === 'asc' ? '▲' : '▼') : '';
        var inner = col.sort
          ? '<button type="button" class="cbl-nsort" data-cbsid="CMP039-B01"' + mountAttribute('CMP039') + ' data-nt-sort="' + esc(col.k) + '" onclick="' + esc(o.act) + '(this.dataset.ntSort)" aria-label="' + esc(col.label) + '">' + esc(col.label) + (arrow ? ' <span aria-hidden="true">' + arrow + '</span>' : '') + '</button>'
          : esc(col.label);
        return cell(col, inner, index).replace('class="cbl-ntc', 'role="columnheader" class="cbl-ntc');
      })
      .join('');
    var body = (o.rows || []).length
      ? o.rows
          .map(function (row) {
            return '<div class="cbl-ntrow" role="row">' + cols.map(function (col, index) { return cell(col, row[index] == null ? '' : row[index], index); }).join('') + '</div>';
          })
          .join('')
      : '<div class="cbl-nempty">' + esc(o.empty || '') + '</div>';
    return '<div class="cbl-ntab' + (cards ? ' cards' : '') + '" role="table" data-nt="' + esc(o.id || '') + '"><div class="cbl-nthead" role="row">' + head + '</div>' + body + '</div>';
  }

  /* click: 20 statements live in app/list-ctl-click.js (shrink W2, 2026-11-17); the page loads that file before this one */
  if (!root.CBListParts || !root.CBListParts.click) throw new Error('app/list-ctl-click.js must load before app/list-ctl.js');
  root.CBListParts.click.bind({ closePop: closePop, columns: columns, curSort: curSort, download: download, head: head, matched: matched, minW: minW, needsNext: needsNext, needsToggle: needsToggle, openRow: openRow, paintAll: paintAll, paintList: paintList, paintTitle: paintTitle, paintTools: paintTools, query: query, remote: remote, resetLimit: resetLimit, rowById: rowById, rowIdOf: rowIdOf, safe: safe, saveChoices: saveChoices, selectedRows: selectedRows, shownKeys: shownKeys, sortId: sortId, togglePop: togglePop, toggleRow: toggleRow, viewKeys: viewKeys, viewOn: viewOn, widthOf: widthOf });
  colByKey = root.CBListParts.click.colByKey;
  cssId = root.CBListParts.click.cssId;
  onClick = root.CBListParts.click.onClick;
  refocusRz = root.CBListParts.click.refocusRz;
  resize = root.CBListParts.click.resize;

  /* wire: 16 statements live in app/list-ctl-wire.js (shrink W2, 2026-11-17); the page loads that file before this one */
  if (!root.CBListParts || !root.CBListParts.wire) throw new Error('app/list-ctl-wire.js must load before app/list-ctl.js');
  root.CBListParts.wire.bind({ closePop: closePop, colByKey: colByKey, cssId: cssId, hasNext: hasNext, head: head, isOpen: isOpen, minW: minW, onClick: onClick, openRow: openRow, paintList: paintList, paintTools: paintTools, query: query, refocusRz: refocusRz, resetLimit: resetLimit, resize: resize, safe: safe, saveChoices: saveChoices, setQ: setQ, shownCols: shownCols, shownKeys: shownKeys, template: template, toggleRow: toggleRow, topKey: topKey, widthOf: widthOf });
  wire = root.CBListParts.wire.wire;

  root.CBList = { mount: mount, nextRow: nextRow, nextTable: nextTable, get: get, reset: reset, every: every, pager: pager };
})(typeof window !== 'undefined' ? window : this);
