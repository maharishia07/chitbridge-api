/* app/cap-stock.js — STOCK: what is on the shelf, per product, from the ONE stock reader (T3-OPS, 2026-10-14; CB Operations › Stock).
 *
 * ── WHY A NEW FILE (CLAUDE.md rule 4, the search shown in docs/critique/T3-OPS.md) ──────────────────────────────────────────────────
 *   No stock screen existed anywhere on the web: app.html has a product's Availability tab (one product's stamp), CB Accounts the closing
 *   stock VALUE (cap-period.js), and Supplies (cap-supplies.js) the things bought to USE. The quantity per product had one reader on the
 *   server (api lib/stock-store.onHand) and one caller, the counter's Receive screen. This paints that same read — GET /api/till/stock
 *   ?detail=1 (name · unit · batches with expiry, widened additively for this screen) — and computes nothing: the quantities are the server's.
 *
 * ── WHAT IT SHOWS ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 *   One CBList (app/list-ctl.js): search · filters · sort · paging · count are the unit's. LEAST ON HAND FIRST by default — below zero, then
 *   none left, then the rest. ⚠️ NOT "low stock": no reorder level is kept for a product (nothing in the api stores one), so "low" would be
 *   a number invented here. A row's next level lists its batches, earliest expiry first, with expired / expiring said in words.
 *   ⚠️ A product the ledger never moved is ABSENT, never 0 (stock-store.onHand): the empty state says so, not "you have no stock".
 *
 *   CBStock.mount(host) → { refresh } · CBStock.resay() repaints the words (the title is the shop's country word: helpers.js stockWord, NAMES-1)
 * Host globals (as every cap-*.js): api · EP · esc · tx · txf · CBList · CBLocale (optional) · cblog (optional).
 * Loaded by operations.html. Flow step: INV step 2 · stock (docs/process/flows.json).
 * OWNS the Stock screen of Operations: on hand per product, batches and expiry, painted from the one stock reader
 * // CARD 13-inventory-stock-and-traceability/on-hand-and-movements
 * CALLED BY public/operations.html; tests/stock-pane.test.cjs
 * FLOW      operations.html Stock tab -> CBStock.mount(host) -> GET /api/till/stock?detail=1 -> CBList rows (least on hand first)
 */
'use strict';
var CBStock = (function () {
  var S = { rows: null, err: null, notReady: null, busy: false, list: null };
  var DAY = 86400000,
    SOON_DAYS = 30;

  function translate(s) {
    return typeof tx === 'function' ? tx(s) : s;
  }
  function translateWith(s, v) {
    return typeof txf === 'function'
      ? txf(s, v)
      : String(s).replace(/\{(\w+)\}/g, function (_, k) {
          return v[k];
        });
  }
  function qtyOf(n) {
    try {
      return window.CBLocale ? CBLocale.number(n) : String(n);
    } catch (e) {
      if (typeof cblog === 'function') cblog('error', 'stock: number format ' + e.message);
      return String(n);
    }
  }
  function dateOf(d) {
    try {
      return window.CBLocale ? CBLocale.date(d) : String(d);
    } catch (e) {
      if (typeof cblog === 'function') cblog('error', 'stock: date format ' + e.message);
      return String(d);
    }
  }
  /** a batch's expiry in words: expired · expires within 30 days · its date — the date is the server's, only the reading is here */
  function expiryWord(d) {
    if (!d) return { text: translate('no expiry kept'), tone: '' };
    var left = Math.floor((new Date(d + 'T00:00:00').getTime() - Date.now()) / DAY);
    if (left < 0) return { text: translateWith('expired {date}', { date: dateOf(d) }), tone: 'bad' };
    if (left <= SOON_DAYS) return { text: translateWith('expires {date}', { date: dateOf(d) }), tone: 'warn' };
    return { text: translateWith('expires {date}', { date: dateOf(d) }), tone: '' };
  }
  function stateOf(r) {
    return r.qty < 0 ? 'below' : r.qty === 0 ? 'none' : 'on';
  }
  function nameOf(r) {
    return r.name || translateWith('Item {id}', { id: String(r.id).slice(0, 8) });
  }

  /** read the stock list from the one stock reader and refresh the list */
  function load() {
    if (S.busy) return;
    S.busy = true;
    S.err = null;
    if (S.list) S.list.refresh();
    return api('stockOnHand', { query: { detail: '1' } })
      .then(function (reply) {
        var b = (reply && reply.balances) || {};
        S.notReady = reply && reply.not_ready ? reply.says || translate('Stock is not switched on for this shop yet.') : null;
        S.rows = Object.keys(b).map(function (id) {
          var x = b[id] || {};
          return { id: id, name: x.name || null, unit: x.unit || null, qty: Number(x.qty) || 0, lots: Array.isArray(x.lots) ? x.lots : [] };
        });
      })
      .catch(function (e) {
        S.err = e;
        if (typeof cblog === 'function') cblog('error', 'stock: GET /api/till/stock failed — ' + ((e && e.message) || e));
      })
      .then(function () {
        S.busy = false;
        if (S.list) S.list.refresh();
      });
  }

  /** the stock list columns */
  function cols() {
    return [
      {
        key: 'name',
        label: translate('Item'),
        prio: 1,
        w: 280,
        sort: 'az',
        html: true,
        cell: function (r) {
          return esc(nameOf(r));
        }
      },
      {
        key: 'qty',
        label: translate('On hand'),
        prio: 2,
        w: 230,
        num: true,
        sort: 'least',
        html: true,
        tid: function (r) {
          return 'stock-qty-' + r.id;
        },
        cell: function (r) {
          var q = esc(qtyOf(r.qty)) + (r.unit ? ' <span class="sub">' + esc(r.unit) + '</span>' : '');
          if (r.qty < 0) return '<span class="tag red" data-testid="stock-below-' + esc(r.id) + '">⚠ ' + q + ' · ' + esc(translate('below zero')) + '</span>';
          if (r.qty === 0) return '<span class="tag amber">' + q + ' · ' + esc(translate('none left')) + '</span>';
          return q;
        }
      },
      {
        key: 'lots',
        label: translate('Batches'),
        prio: 3,
        w: 220,
        sort: 'expiry',
        html: true,
        cell: function (stock) {
          if (!stock.lots.length) return '<span class="sub">' + esc(translate('not kept by batch')) + '</span>';
          var e = expiryWord(stock.lots[0].expires_at);
          return (
            esc(translateWith(stock.lots.length === 1 ? '{n} batch' : '{n} batches', { n: stock.lots.length })) +
            ' · <span class="' +
            (e.tone ? 'tag ' + (e.tone === 'bad' ? 'red' : 'amber') : 'sub') +
            '">' +
            esc(e.text) +
            '</span>'
          );
        }
      }
    ];
  }
  /** the next level: every batch, earliest expiry first (the server's order) */
  function next(stock) {
    if (!stock.lots.length)
      return '<div class="sub" data-testid="stock-next-' + esc(stock.id) + '">' + esc(translate('This product is not kept by batch — one count for all of it.')) + '</div>';
    return (
      '<div data-testid="stock-next-' +
      esc(stock.id) +
      '">' +
      stock.lots
        .map(function (item) {
          var e = expiryWord(item.expires_at);
          return (
            '<div class="op-lot"><b class="mono">' +
            esc(item.lot) +
            '</b> · ' +
            esc(qtyOf(item.qty)) +
            (stock.unit ? ' ' + esc(stock.unit) : '') +
            ' · <span class="' +
            (e.tone ? 'tag ' + (e.tone === 'bad' ? 'red' : 'amber') : 'sub') +
            '">' +
            esc(e.text) +
            '</span></div>'
          );
        })
        .join('') +
      '</div>'
    );
  }
  function soonest(r) {
    return r.lots.length && r.lots[0].expires_at ? r.lots[0].expires_at : '9999-12-31';
  }

  /** the options the stock list is mounted with */
  function opts() {
    return {
      key: 'ops-stock',
      t: translate,
      hl: false,
      id: function (r) {
        return r.id;
      },
      rowTid: function (r) {
        return 'stock-row-' + r.id;
      },
      columns: cols,
      rows: function () {
        return S.rows || [];
      },
      next: next,
      state: function () {
        return S.err ? 'error' : S.rows === null ? 'loading' : null;
      },
      error: function () {
        return { title: translate('Could not read your stock.'), sub: translate('Nothing was changed. Try again in a moment.') };
      },
      onRetry: load,
      empty: function () {
        return S.notReady
          ? { title: S.notReady }
          : { title: translate('No stock moved yet.'), sub: translate('A product shows here once a delivery is received or a sale is made.') };
      },
      head: function () {
        var rows = S.rows || [],
          below = rows.filter(function (item) {
            return item.qty < 0;
          }).length;
        return {
          title: translate(typeof stockWord === 'function' ? stockWord() : 'Stock'),
          chips: rows.length ? [{ text: translateWith(rows.length === 1 ? '{n} item' : '{n} items', { n: rows.length }), tid: 'stock-count' }] : [],
          notices: below
            ? [{ text: translateWith(below === 1 ? '{n} below zero — count it' : '{n} below zero — count them', { n: below }), cls: 'bad', tid: 'stock-below-notice' }]
            : []
        };
      },
      search: function (r) {
        return [nameOf(r), r.unit]
          .concat(
            r.lots.map(function (item) {
              return item.lot;
            })
          )
          .filter(Boolean)
          .join(' ');
      },
      filters: [
        {
          key: 'state',
          label: translate('How much'),
          all: translate('Any amount'),
          options: [
            { v: 'below', label: translate('Below zero') },
            { v: 'none', label: translate('None left') },
            { v: 'on', label: translate('On the shelf') }
          ],
          match: function (r, v) {
            return stateOf(r) === v;
          }
        },
        {
          key: 'exp',
          label: translate('Expiry'),
          all: translate('Any expiry'),
          options: [
            { v: 'gone', label: translate('Expired') },
            { v: 'soon', label: translate('Expires within 30 days') }
          ],
          match: function (r, v) {
            var e = r.lots.length ? expiryWord(r.lots[0].expires_at).tone : '';
            return v === 'gone' ? e === 'bad' : e === 'warn';
          }
        }
      ],
      /* ⭐ least on hand first is the default — the brief's "low stock first", said honestly (no reorder level exists) */
      sorts: [
        {
          key: 'least',
          label: translate('Least on hand first'),
          cmp: function (a, b) {
            return a.qty - b.qty || nameOf(a).localeCompare(nameOf(b));
          }
        },
        {
          key: 'most',
          label: translate('Most on hand first'),
          cmp: function (a, b) {
            return b.qty - a.qty || nameOf(a).localeCompare(nameOf(b));
          }
        },
        {
          key: 'expiry',
          label: translate('Expiring first'),
          cmp: function (a, b) {
            return soonest(a).localeCompare(soonest(b)) || a.qty - b.qty;
          }
        },
        {
          key: 'az',
          label: translate('A–Z'),
          cmp: function (a, b) {
            return nameOf(a).localeCompare(nameOf(b));
          }
        }
      ]
    };
  }

  function mount(host) {
    if (typeof EP !== 'undefined' && !EP.stockOnHand) EP.stockOnHand = { m: 'GET', p: '/api/till/stock', ok: 'y' }; /* the counter's read, ?detail=1 */
    host.innerHTML = '<div id="ops_stock" class="op-list" data-testid="ops-stock"></div>';
    if (S.list && S.list.destroy) S.list.destroy();
    S.list = CBList.mount(host.querySelector('#ops_stock'), opts());
    if (S.rows === null || S.err) load();
    return { refresh: load };
  }
  /** the words again, from the rows already held (no read): the shop's country landed after the first paint — NAMES-1, Stock · Inventory */
  function resay() {
    if (S.list) S.list.refresh();
  }
  return { mount: mount, load: load, resay: resay };
})();
