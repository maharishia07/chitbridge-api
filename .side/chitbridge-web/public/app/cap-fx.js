/* cap-fx.js — FOREIGN CURRENCY (FX1, 2026-10-14): CB Accounts › Setup › Rates, and Month lock's "Foreign balances" line.
 * A foreign bill posts at the rate of ITS day; a rate is evidence the owner types or imports (CSV) — the server never fetches one and never assumes one.
 * A bill with no rate waits on Waiting, named ("No USD rate for 14 Oct — add it in Accounts › Rates"); it posts once the rate is here.
 *
 * ── WHAT IS REUSED (CLAUDE.md rule 1) ────────────────────────────────────────────────────────────────────────────────────────────
 *   · the rates ARE CBList (app/list-ctl.js): search, the source filter, sort, cards at 390 px, only the rows scroll
 *   · each write (add · import · revalue) goes through CBAction.run (M64, accounts-shell.js); the server's `may` greys the button WITH its sentence
 *   · a field row is Move in's miRow (cap-move-in.js); every amount is bkMoney / bkDrCr (M36 / M25, cap-books.js); dates bkDate
 *   · every figure — the rate, the revaluation, the gain or loss — is the server's (lib/fx-rates over CBPosting fxRevaluation); nothing is computed here
 * ── WHAT IS NEW, AND WHY ──────────────────────────────────────────────────────────────────────────────────────────────────────────
 *   fxView · fxPaint · fxList · fxAdd* · fxImport · fxLockLine · fxRevalue — nothing kept exchange rates or revalued a foreign balance before.
 *   Flow: FX (Foreign currency) steps 1–3, docs/process/flows.json.
 * Better than Xero / QuickBooks (a rate feed you cannot see the source of, revaluation as a report you re-run) because every entry NAMES the rate it used
 * (typed, imported or official, and its day), a missing rate is a named wait — never a silent guess — and the revaluation is two sealed entries that come back.
 
 * OWNS      foreign-currency rates: the Rates screen (typed or imported day rates, the revaluation button) and Month lock's foreign-balances line
 * CARD      16-finance/cb-finance
 * CALLED BY public/accounts.html, public/app/cap-books.js   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
 */
'use strict';
if (typeof EP !== 'undefined') {
  Object.assign(EP, {
    booksFxRates: { m: 'GET', p: '/api/books/fx-rates', ok: 'y' } /* anyone who reads the books: the rates, ready, may.add, the pack's rule */,
    booksFxRateAdd: { m: 'POST', p: '/api/books/fx-rates', ok: 'y' } /* owner: one rate (insert-only; a newer row for the day corrects it) */,
    booksFxImport: { m: 'POST', p: '/api/books/fx-rates/import', ok: 'y' } /* owner: a CSV of rates — good rows in, bad rows named */,
    booksFxRevalue: { m: 'GET', p: '/api/books/fx-revalue', ok: 'y' } /* owner: the open foreign balances at the closing rate (Month lock) */,
    booksFxRevaluePost: { m: 'POST', p: '/api/books/fx-revalue', ok: 'y' } /* owner: post the revaluation and its reversal */
  });
}

var FXV = { r: null, err: '', add: null, gen: 0, lk: null };
var FX_SOURCE = { manual: 'Typed', import: 'Imported', official: 'Official' };

/* ── the view (BK.views.rates) ── */
function fxView(body) {
  FXV.add = null;
  FXV.err = '';
  body.innerHTML =
    '<div data-testid="fx" class="fx"><div id="fx_bar"></div><div id="fx_form"></div><div id="fx_rows" data-testid="fx-rows" style="min-height:240px"></div></div>';
  fxLoad();
}
/** read the rate list from the server and repaint, ignoring an answer that a newer read has overtaken */
function fxLoad() {
  var generation = ++FXV.gen;
  return api('booksFxRates').then(
    function (reply) {
      if (generation !== FXV.gen) return;
      FXV.r = reply || {};
      FXV.err = '';
      fxPaint();
    },
    function (e) {
      if (generation !== FXV.gen) return;
      FXV.r = null;
      FXV.err = bkWhy(e, tx('Could not be read'));
      fxPaint();
    }
  );
}
function fxMay() {
  return (FXV.r && FXV.r.may && FXV.r.may.add) || { may: false, why: FXV.err || null };
}
/** paint the toolbar (add-rate form, disabled with the reason when the viewer may not add rates) */
function fxPaint() {
  var bar = document.getElementById('fx_bar');
  if (!bar) return;
  var permission = fxMay(),
    reply = FXV.r || {},
    rule = reply.rule || {};
  var disabledAttr = permission.may ? '' : ' disabled title="' + esc(permission.why || '') + '"';
  bar.innerHTML =
    '<div class="supacts" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">' +
    '<button data-cbsid="BKS025-B01" type="button" data-testid="fx-add" onclick="fxAddOpen()"' +
    disabledAttr +
    '>' +
    esc(tx('Add rate')) +
    '</button>' +
    '<label class="act" data-testid="fx-import-label" style="cursor:pointer' +
    (permission.may ? '' : ';opacity:.6;pointer-events:none') +
    '">' +
    esc(tx('Import CSV')) +
    '<input data-cbsid="BKS025-I01" type="file" accept=".csv,text/csv" data-testid="fx-import" onchange="fxImport(this)" style="display:none"' +
    (permission.may ? '' : ' disabled') +
    '></label></div>' +
    (!permission.may && permission.why ? '<div data-testid="fx-why" style="color:var(--grey);font-size:var(--fs-1);margin-bottom:8px">' + esc(permission.why) + '</div>' : '') +
    (rule.official_name
      ? '<div data-testid="fx-rule" title="' +
        esc(rule.tax_rate_rule || '') +
        '" style="color:var(--grey);font-size:var(--fs-1);margin-bottom:8px">' +
        esc(txf('Tax value uses the {name}.', { name: rule.official_name })) +
        '</div>'
      : '');
  if (FXV.err && !FXV.r) {
    document.getElementById('fx_rows').innerHTML = '<div class="err" data-testid="fx-err" style="color:var(--warn-2)">' + esc(FXV.err) + '</div>';
    return;
  }
  fxList();
}
/* the rates: CBList — day · currency · rate · source · reference; newest first (the server's order) */
function fxList() {
  var el = document.getElementById('fx_rows');
  if (!el) return;
  var reply = FXV.r || {},
    rows = reply.rates || [],
    currency = reply.currency || '';
  CBList.reset('fx-rates');
  CBList.mount(el, {
    key: 'fx-rates',
    t: tx,
    rows: function () {
      return rows;
    },
    id: function (x) {
      return x.rate_id;
    },
    rowTid: function (x) {
      return 'fx-row-' + x.from + '-' + x.date;
    },
    columns: [
      {
        key: 'date',
        label: tx('Day'),
        prio: 1,
        sort: 'date',
        w: 120,
        cell: function (x) {
          return bkDate(x.date);
        }
      },
      {
        key: 'from',
        label: tx('Currency'),
        prio: 1,
        sort: 'from',
        w: 100,
        cell: function (x) {
          return x.from;
        }
      },
      {
        key: 'rate',
        label: tx('Rate'),
        prio: 1,
        num: true,
        w: 170,
        cell: function (x) {
          return '1 ' + x.from + ' = ' + x.rate + ' ' + (x.to || currency);
        }
      },
      {
        key: 'source',
        label: tx('Source'),
        prio: 2,
        w: 110,
        hfilter: 'source',
        cell: function (x) {
          return tx(FX_SOURCE[x.source] || x.source);
        }
      },
      {
        key: 'ref',
        label: tx('Reference'),
        prio: 3,
        w: 220,
        cell: function (x) {
          return x.source_ref || '';
        }
      }
    ],
    defaultCols: ['date', 'from', 'rate', 'source', 'ref'],
    filters: [
      {
        key: 'source',
        label: tx('Source'),
        all: tx('Every source'),
        options: Object.keys(FX_SOURCE).map(function (item) {
          return { v: item, label: tx(FX_SOURCE[item]) };
        }),
        match: function (x, v) {
          return x.source === v;
        }
      }
    ],
    sorts: [
      {
        key: 'date',
        label: tx('Newest first'),
        cmp: function () {
          return 0;
        }
      },
      {
        key: 'from',
        label: tx('Currency'),
        cmp: function (a, b) {
          return String(a.from).localeCompare(String(b.from)) || String(b.date).localeCompare(String(a.date));
        }
      }
    ],
    search: function (x) {
      return [x.date, x.from, x.rate, x.source, x.source_ref].join(' ');
    },
    empty: { title: tx("No rates yet. Add the day's rate.") }
  });
}

/* ── add one rate (the one write, M64) ── */
function fxAddOpen() {
  var node = document.getElementById('fx_form');
  if (!node) return;
  FXV.add = { err: '' };
  var today = bkToday();
  node.innerHTML =
    '<div data-testid="fx-form" style="max-width:420px;margin-bottom:10px">' +
    miRow(tx('Day'), '<input data-cbsid="BKS025-I02" class="inp" type="date" id="fx_date" data-testid="fx-date" value="' + esc(today) + '" style="width:auto;max-width:100%">') +
    miRow(tx('Currency'), '<input data-cbsid="BKS025-I03" class="inp" id="fx_cur" data-testid="fx-cur" maxlength="3" placeholder="USD" style="width:6em;text-transform:uppercase">') +
    miRow(
      txf('Rate in {c}', { c: (FXV.r && FXV.r.currency) || '' }),
      '<input data-cbsid="BKS025-I04" class="inp" id="fx_rate" data-testid="fx-rate" inputmode="decimal" placeholder="83.25" style="width:9em">'
    ) +
    miRow(
      tx('Source'),
      '<select data-cbsid="BKS025-S01" class="inp" id="fx_src" data-testid="fx-src" style="min-width:0;max-width:100%"><option value="manual">' +
        esc(tx('Typed')) +
        '</option><option value="official">' +
        esc(tx('Official')) +
        '</option></select>'
    ) +
    miRow(
      tx('Reference'),
      '<input data-cbsid="BKS025-I05" class="inp" id="fx_ref" data-testid="fx-ref" maxlength="120" placeholder="' + esc(tx('Where it came from')) + '" style="width:100%">'
    ) +
    '<div id="fx_ferr" data-testid="fx-form-err" style="color:var(--warn-2);font-size:var(--fs-1)"></div>' +
    '<div style="display:flex;gap:8px;margin-top:6px"><button data-cbsid="BKS025-B02" type="button" class="supact-pri" data-testid="fx-save" onclick="fxAddSave(this)">' +
    esc(tx('Save rate')) +
    '</button>' +
    '<button data-cbsid="BKS025-B03" type="button" data-testid="fx-cancel" onclick="fxAddCancel()">' +
    esc(tx('Cancel')) +
    '</button></div></div>';
}
function fxAddCancel() {
  FXV.add = null;
  var node = document.getElementById('fx_form');
  if (node) node.innerHTML = '';
}
function fxVal(id) {
  var el = document.getElementById(id);
  return el ? String(el.value || '').trim() : '';
}
/** send the typed rate to the server through the one action runner */
function fxAddSave(btn) {
  var body = { date: fxVal('fx_date'), currency: fxVal('fx_cur').toUpperCase(), rate: fxVal('fx_rate'), source: fxVal('fx_src') || 'manual' };
  if (fxVal('fx_ref')) body.source_ref = fxVal('fx_ref');
  CBAction.run(
    btn,
    function () {
      return api('booksFxRateAdd', { body: body });
    },
    {
      key: 'fx-add',
      busy: tx('Saving…'),
      outcome: function (r) {
        var x = (r && r.rate) || {};
        toast(txf('{c} rate for {d} saved.', { c: x.from || body.currency, d: bkDate(x.date || body.date) }));
        fxAddCancel();
        fxLoad();
      },
      onFail: function (words) {
        var e = document.getElementById('fx_ferr');
        if (e) e.textContent = words;
      }
    }
  );
}
/* ── import a CSV: date · currency · rate (· source · source_ref) — the server checks each row and names the bad ones ── */
function fxImport(input) {
  var file = input && input.files && input.files[0];
  if (!file) return;
  var label = document.querySelector('[data-testid="fx-import-label"]');
  file.text().then(function (text) {
    CBAction.run(
      label,
      function () {
        return api('booksFxImport', { body: { csv: text, file_name: file.name } });
      },
      {
        key: 'fx-import',
        busy: tx('Importing…'),
        outcome: function (r) {
          var bad = (r && r.refused) || [];
          toast(txf('{n} rates added.', { n: (r && r.added) || 0 }) + (bad.length ? ' ' + txf('Line {l}: {w}', { l: bad[0].line, w: bad[0].why }) : ''));
          input.value = '';
          fxLoad();
        },
        onFail: function (words) {
          toast(words);
          input.value = '';
        }
      }
    );
  });
}

/* ── Month lock: the foreign balances of the month to lock next — revalue first, then lock (cap-books bkLockRowsPaint calls this) ── */
function fxLockMonth() {
  var L = (typeof BK !== 'undefined' && BK.lk) || {},
    info = L.info || {};
  for (var count = 1; count <= 12; count++) {
    var x = info[L.fy + '|' + count];
    if (x && x.lock && x.lock.may && (L.rows || {})[L.fy + '|' + count] !== 'soft_locked' && (L.rows || {})[L.fy + '|' + count] !== 'hard_locked')
      return { fy: L.fy, p: count };
  }
  return null;
}
/** the foreign-balance line for the current month: ask the server, then fxLockPaint draws what it said */
function fxLockLine() {
  var host = document.getElementById('lk_fx'),
    month = fxLockMonth();
  if (!host) return;
  if (!month || !bkIsOwner() || (typeof CBBooksActing !== 'undefined' && CBBooksActing.current())) { /* l16 fable2 R2-3: the FX preview is the owner's own door (held back from every grant, the api's GRANT_HELD_BACK): in any acting seat the page does not ask and says nothing */
    host.innerHTML = '';
    return;
  }
  var k = month.fy + '|' + month.p;
  if (FXV.lk && FXV.lk.k === k && FXV.lk.r) return fxLockPaint(host, FXV.lk.r);
  FXV.lk = { k: k, r: null };
  api('booksFxRevalue', { query: { fiscal_year: month.fy, period: month.p } }).then(
    function (reply) {
      if (FXV.lk && FXV.lk.k === k) {
        FXV.lk.r = reply || {};
        fxLockPaint(host, FXV.lk.r);
      }
    },
    function () {
      host.innerHTML = '';
    }
  );
}
/** draw the foreign-balance revaluation line from the server answer (gain or loss, what is missing, who may post) */
function fxLockPaint(host, lock) {
  var rows = lock.rows || [];
  if (!lock.ready || (!rows.length && !(lock.missing || []).length)) {
    host.innerHTML = '';
    return;
  } /* no foreign balance: nothing to say (fine collapses) */
  var functionalCurrency = lock.functional,
    permission = (lock.may && lock.may.post) || { may: false, why: lock.why };
  var gain = Number(lock.gain_minor || 0),
    word = lock.posted
      ? txf('Revalued — {no}', { no: lock.posted.entry_no })
      : gain
        ? txf(gain > 0 ? 'Gain {a} at the closing rate' : 'Loss {a} at the closing rate', { a: bkMoney(Math.abs(gain), functionalCurrency) })
        : tx('At the closing rate already');
  host.innerHTML =
    '<div data-testid="lk-fx" style="border:1px solid var(--line,#ddd);border-radius:8px;padding:8px 10px">' +
    '<div style="font-weight:700">' +
    esc(tx('Foreign balances')) +
    '</div>' +
    '<div data-testid="lk-fx-words" style="font-size:var(--fs-1)">' +
    esc(word) +
    '</div>' +
    rows
      .map(function (x) {
        return CBList.nextRow(
          [esc(x.party || x.code || '') + ' · ' + esc(bkMoney(Math.abs(x.balance_txn_minor), x.txn_currency)), esc(bkDrCr(x.diff_minor, functionalCurrency))],
          [120]
        );
      })
      .join('') +
    (!permission.may && permission.why && !lock.posted ? '<div data-testid="lk-fx-why" style="color:var(--grey);font-size:var(--fs-1)">' + esc(permission.why) + '</div>' : '') +
    (lock.posted
      ? ''
      : '<button data-cbsid="BKS025-B04" type="button" data-testid="lk-fx-revalue" style="margin-top:6px"' +
        (permission.may ? ' onclick="fxRevalue(this)"' : ' disabled title="' + esc(permission.why || '') + '"') +
        '>' +
        esc(tx('Revalue')) +
        '</button>') +
    '</div>';
}
/** post the revaluation for the current month through the one action runner */
function fxRevalue(btn) {
  var month = fxLockMonth();
  if (!month) return;
  CBAction.run(
    btn,
    function () {
      return api('booksFxRevaluePost', { body: { fiscal_year: month.fy, period: Number(month.p) } });
    },
    {
      key: 'fx-revalue',
      busy: tx('Revaluing…'),
      outcome: function (r) {
        toast(txf('Revalued — {no}. It comes back on {d}.', { no: (r && r.entry_no) || '', d: bkDate((r && r.reverses_on) || '') }));
        FXV.lk = null;
        fxLockLine();
      },
      onFail: function (words) {
        toast(words);
      }
    }
  );
}
