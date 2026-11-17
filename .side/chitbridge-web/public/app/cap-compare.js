/* cap-compare.js — PARALLEL RUN (PR1, 2026-10-13): CB Accounts › Books › Parallel run. An auditor keeps the shop's books in Tally (IN) or Xero / QuickBooks (AU)
 * for a while beside ours; their period is loaded as a SNAPSHOT (their trial balance · P&L · balance sheet · return, from export files — never posted) and laid
 * beside ours line by line: the differences first, each with WHY in plain words and the entries behind our figure (the chit that brought each, openable).
 *
 * ── WHAT IS REUSED (CLAUDE.md rule 1) ────────────────────────────────────────────────────────────────────────────────────────────
 *   · loading a file IS CBSteps (app/step-flow.js) as Move in composes it: File → Columns, the guard-with-a-reason, the footer; `miRow` (cap-move-in.js) lays a field out
 *   · the lines ARE CBList (app/list-ctl.js): search, the status filter, cards at 390 px, only the rows scroll; a line's next level lists our entries behind it
 *   · the one write (keep a snapshot) goes through CBAction.run (M64, accounts-shell.js); the server's `may.load` greys "Load their figures" WITH its sentence
 *   · every amount is bkMoney / bkDrCr (M36 / M25, cap-books.js); every figure, difference and sentence is the server's (lib/parallel-run) — nothing is computed here
 *   · an entry opens the Ledgers view on its ledger for the period (cap-books bkLtOpen through BK.lt.sel); a chit opens the chit sheet (openChitSheet)
 *   · the .csv is the server's own (GET /compare/:id/csv, fetched as Packs fetch their file); the PDF is the browser's print of this page
 * ── WHAT IS NEW, AND WHY ──────────────────────────────────────────────────────────────────────────────────────────────────────────
 *   cmpView · cmpPaint · cmpRead · cmpPaintList · cmpNext · cmpOpenLedger · cmpCsv · cmpLoad* — nothing existing laid two sets of books side by side.
 *   Flow: PRN (Parallel run) steps 1–3, docs/process/flows.json.
 * Better than a Xero / QuickBooks / Tally tie-out (the accountant's spreadsheet VLOOKUP) because each difference says WHY and opens the entries — and a bill that
 * came on the rail is named as such.
 
 * OWNS      the Parallel run screen: loading an outside snapshot and laying it beside our books
 * CARD      16-finance/cb-finance
 * CALLED BY public/accounts.html   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
 */
'use strict';
if (typeof EP !== 'undefined') {
  Object.assign(EP, {
    booksCompare: { m: 'GET', p: '/api/books/compare', ok: 'y' } /* owner · auditor: the snapshots, ready, may.load */,
    booksCompareRead: { m: 'GET', p: '/api/books/compare/:id', ok: 'y' } /* owner · auditor: the compare, differences first */,
    booksCompareCsv: { m: 'GET', p: '/api/books/compare/:id/csv', ok: 'y' } /* owner · auditor: the auditor's .csv (fetched as a file) */,
    booksComparePreflight: {
      m: 'POST',
      p: '/api/books/compare/preflight',
      ok: 'y'
    } /* owner · auditor: the file read, the columns guessed — nothing written */,
    booksCompareKeep: { m: 'POST', p: '/api/books/compare/snapshots', ok: 'y' } /* owner · auditor: keep one part of a snapshot (insert-only) */
  });
}

var CMP = { list: null, id: null, r: null, part: null, err: '', ld: null, st: null, gen: 0 };
var CMP_STATUS = {
  different: ['Different', 'amber'],
  gap: ['Not mapped', 'amber'],
  only_ours: ['Only ours', 'blue'],
  equal: ['Same ✓', '']
}; /* a line that is fine is structural grey (design rule: everything fine collapses); amber asks to be checked */
var CMP_ORDER = ['tb', 'pl', 'bs', 'ret'];

/* ── the view (BK.views.compare) ── */
function cmpView(body) {
  CMP.ld = null;
  CMP.err = '';
  body.innerHTML = '<div data-testid="cmp" class="cmp"><div id="cmp_bar"></div><div id="cmp_main"></div></div>';
  cmpLoadList(CMP.id);
}
function cmpLoadList(pick) {
  var g = ++CMP.gen;
  return api('booksCompare').then(
    function (reply) {
      if (g !== CMP.gen) return;
      CMP.list = reply || {};
      var s = CMP.list.snapshots || [];
      CMP.id =
        pick &&
        s.some(function (x) {
          return x.snapshot_id === pick;
        })
          ? pick
          : s[0]
            ? s[0].snapshot_id
            : null;
      cmpPaint();
      if (CMP.id) cmpRead(CMP.id);
    },
    function (e) {
      if (g !== CMP.gen) return;
      CMP.list = null;
      CMP.err = bkWhy(e, tx('Could not be read'));
      cmpPaint();
    }
  );
}
function cmpMay() {
  var m = CMP.list && CMP.list.may && CMP.list.may.load;
  return m || { may: false, why: CMP.err || null };
}
function cmpSnap() {
  return (
    ((CMP.list && CMP.list.snapshots) || []).filter(function (item) {
      return item.snapshot_id === CMP.id;
    })[0] || null
  );
}
function cmpPaint() {
  var bar = document.getElementById('cmp_bar'),
    main = document.getElementById('cmp_main');
  if (!bar || !main) return;
  var snaps = (CMP.list && CMP.list.snapshots) || [],
    may = cmpMay();
  var pick = snaps.length
    ? '<select data-cbsid="BKS007-S01" class="inp" data-testid="cmp-pick" aria-label="' +
      esc(tx('Snapshot')) +
      '" onchange="cmpPick(this.value)" style="min-width:0;max-width:100%">' +
      snaps
        .map(function (item) {
          return (
            '<option value="' +
            esc(item.snapshot_id) +
            '"' +
            (item.snapshot_id === CMP.id ? ' selected' : '') +
            '>' +
            esc(item.label + ' · ' + item.period_to) +
            '</option>'
          );
        })
        .join('') +
      '</select>'
    : '';
  bar.innerHTML =
    '<div class="supacts" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">' +
    pick +
    '<button data-cbsid="BKS007-B01" type="button" data-testid="cmp-load" onclick="cmpLoadOpen()"' +
    (may.may ? '' : ' disabled title="' + esc(may.why || '') + '"') +
    '>' +
    esc(tx('Load their figures')) +
    '</button>' +
    (CMP.id
      ? '<button data-cbsid="BKS007-B02" type="button" data-testid="cmp-csv" onclick="cmpCsv(this)">' +
        esc(tx('Download CSV')) +
        '</button><button data-cbsid="BKS007-B03" type="button" data-testid="cmp-print" onclick="window.print()">' +
        esc(tx('Print')) +
        '</button>'
      : '') +
    '</div>' +
    (!may.may && may.why ? '<div data-testid="cmp-why" style="color:var(--grey);font-size:var(--fs-1);margin-bottom:8px">' + esc(may.why) + '</div>' : '');
  if (CMP.ld) return;
  if (CMP.err && !CMP.list) {
    main.innerHTML = '<div class="err" data-testid="cmp-err" style="color:var(--warn-2)">' + esc(CMP.err) + '</div>';
    return;
  }
  if (!snaps.length) {
    main.innerHTML =
      '<div data-testid="cmp-empty" style="color:var(--grey);padding:12px 0">' + esc(tx('No snapshot yet. Load their trial balance first.')) + '</div>';
    return;
  }
  main.innerHTML = '<div data-testid="cmp-loading" style="color:var(--grey)">' + esc(tx('Reading…')) + '</div>';
}
function cmpPick(id) {
  CMP.id = id;
  CMP.r = null;
  CMP.part = null;
  cmpPaint();
  cmpRead(id);
}
function cmpRead(id) {
  var g = ++CMP.gen;
  api('booksCompareRead', { params: { id: id } }).then(
    function (reply) {
      if (g !== CMP.gen) return;
      CMP.r = reply || {};
      var have = CMP_ORDER.filter(function (item) {
        return CMP.r.parts && CMP.r.parts[item];
      });
      if (!CMP.part || have.indexOf(CMP.part) < 0) CMP.part = have[0] || null;
      cmpPaintCompare();
    },
    function (e) {
      if (g !== CMP.gen) return;
      var node = document.getElementById('cmp_main');
      if (node) node.innerHTML = '<div class="err" data-testid="cmp-err" style="color:var(--warn-2)">' + esc(bkWhy(e, tx('Could not be read'))) + '</div>';
    }
  );
}
/* the big numbers say how many lines differ, are not mapped, are only ours, are the same — over every part (the server's counts) */
function cmpBig(n, w, tid) {
  return (
    '<div style="min-width:96px"><div class="mono" data-testid="' +
    tid +
    '" style="font-size:var(--fs-5,28px);font-weight:800;line-height:1.3">' +
    esc(String(n || 0)) +
    '</div><div style="color:var(--grey);font-size:var(--fs-1)">' +
    esc(w) +
    '</div></div>'
  );
}
function cmpPaintCompare() {
  var main = document.getElementById('cmp_main'),
    r = CMP.r;
  if (!main || !r || CMP.ld) return;
  var c = r.counts || {},
    snap = r.snapshot || {},
    ef = r.effort || null;
  var tabs = CMP_ORDER.filter(function (item) {
    return r.parts && r.parts[item];
  })
    .map(function (item) {
      var nestedP = r.parts[item],
        n = nestedP.counts ? nestedP.counts.different + nestedP.counts.gap + nestedP.counts.only_ours : null;
      return (
        '<button data-cbsid="BKS007-B04" type="button" class="optchip" data-testid="cmp-part-' +
        item +
        '" aria-pressed="' +
        (item === CMP.part) +
        '" onclick="cmpPart(\'' +
        item +
        '\')" style="cursor:pointer' +
        (item === CMP.part ? ';border-color:var(--blue-b);background:var(--blue-t);color:var(--blue-i)' : '') +
        '">' +
        esc(tx(nestedP.title)) +
        (n ? ' · ' + esc(txf('{n} to check', { n: n })) : nestedP.error ? ' · ⚠' : ' ✓') +
        '</button>'
      );
    })
    .join('');
  var P = r.parts[CMP.part] || {};
  main.innerHTML =
    '<div data-testid="cmp-compare">' +
    '<div data-testid="cmp-sub" style="color:var(--grey);font-size:var(--fs-1);margin-bottom:6px">' +
    esc(txf('{who} beside ours, {from} to {to}', { who: snap.source_word || '', from: snap.period_from, to: snap.period_to })) +
    '</div>' +
    '<div style="display:flex;gap:22px;flex-wrap:wrap;margin:4px 0 10px">' +
    cmpBig(c.different, tx('different'), 'cmp-n-diff') +
    cmpBig(c.gap, tx('not mapped'), 'cmp-n-gap') +
    cmpBig(c.only_ours, tx('only ours'), 'cmp-n-ours') +
    cmpBig(c.equal, tx('the same'), 'cmp-n-same') +
    '</div>' +
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px" role="group" aria-label="' +
    esc(tx('Statement')) +
    '">' +
    tabs +
    '</div>' +
    (P.error ? '<div data-testid="cmp-part-err" style="color:var(--warn-2);margin-bottom:6px">' + esc(P.error) + '</div>' : '') +
    (P.note ? '<div data-testid="cmp-note" style="color:var(--grey);font-size:var(--fs-1);margin-bottom:6px">' + esc(P.note) + '</div>' : '') +
    '<div id="cmp_rows" data-testid="cmp-rows" style="min-height:260px"></div>' +
    (ef
      ? '<div data-testid="cmp-effort" style="color:var(--grey);font-size:var(--fs-1);margin-top:8px">' +
        esc(txf('{n} entries this period: {s} came on the rail, {k} typed here.', { n: ef.entries, s: ef.structured, k: ef.keyed })) +
        '</div>'
      : '') +
    '</div>';
  cmpPaintList();
}
function cmpPart(k) {
  CMP.part = k;
  cmpPaintCompare();
}
function cmpFig(v, P) {
  if (v == null) return '—';
  var c = CMP.r && CMP.r.currency;
  return P === 'tb' ? bkDrCr(v, c) : bkMoney(v, c);
}
function cmpDiff(v) {
  if (v == null) return '—';
  var c = CMP.r && CMP.r.currency;
  return v ? (v > 0 ? '+' : '−') + bkMoney(Math.abs(v), c) : '0';
}
/* the lines: CBList — what · theirs · ours · difference · status · why; the server's order is differences first, the total line on top */
function cmpPaintList() {
  var el = document.getElementById('cmp_rows'),
    P = CMP.r && CMP.r.parts && CMP.r.parts[CMP.part];
  if (!el || !P) return;
  var rows = P.lines || [],
    k = CMP.part;
  var opts = Object.keys(CMP_STATUS).map(function (item) {
    return { v: item, label: tx(CMP_STATUS[item][0]) };
  });
  CBList.reset('compare-' + k);
  CBList.mount(el, {
    key: 'compare-' + k,
    t: tx,
    rows: function () {
      return rows;
    },
    id: function (r) {
      return r.key;
    },
    rowTid: function (r) {
      return 'cmp-row-' + r.key.replace(/[^a-z0-9]+/gi, '-');
    },
    columns: [
      {
        key: 'name',
        label: tx('Line'),
        prio: 1,
        sort: 'name',
        w: 190,
        cell: function (r) {
          return (r.name || r.their_name || '') + (r.their_name && r.their_name !== r.name ? ' (' + tx('theirs') + ': ' + r.their_name + ')' : '');
        }
      },
      {
        key: 'theirs',
        label: tx('Theirs'),
        prio: 3,
        num: true,
        w: 120,
        cell: function (r) {
          return cmpFig(r.theirs_minor, k);
        }
      },
      {
        key: 'ours',
        label: tx('Ours'),
        prio: 3,
        num: true,
        w: 120,
        cell: function (r) {
          return cmpFig(r.ours_minor, k);
        }
      },
      {
        key: 'diff',
        label: tx('Difference'),
        prio: 2,
        num: true,
        w: 120,
        cell: function (r) {
          return r.status === 'equal' ? '' : k === 'tb' && !r.total ? cmpFig(r.diff_minor, k) : cmpDiff(r.diff_minor);
        }
      },
      {
        key: 'status',
        label: tx('Status'),
        prio: 2,
        w: 130,
        html: true,
        hfilter: 'status',
        cell: function (r) {
          var s = CMP_STATUS[r.status] || [r.status, ''];
          return '<span class="step ' + s[1] + '" data-status="' + esc(r.status) + '" style="white-space:nowrap">' + esc(tx(s[0])) + '</span>';
        }
      },
      {
        key: 'why',
        label: tx('Why'),
        prio: 2,
        w: 320,
        cell: function (r) {
          return r.why || '';
        }
      }
    ],
    defaultCols: ['name', 'theirs', 'ours', 'diff', 'status', 'why'],
    filters: [
      {
        key: 'status',
        label: tx('Status'),
        all: tx('Every line'),
        options: opts,
        match: function (r, v) {
          return r.status === v;
        }
      }
    ],
    sorts: [
      {
        key: 'first',
        label: tx('Differences first'),
        cmp: function () {
          return 0;
        }
      },
      {
        key: 'name',
        label: tx('Line'),
        cmp: function (a, b) {
          return String(a.name).localeCompare(String(b.name));
        }
      }
    ],
    search: function (r) {
      return [r.name, r.their_name, r.their_code, r.why].join(' ');
    },
    next: function (r) {
      return cmpNext(r);
    },
    empty: { title: tx('No lines in this part') }
  });
}
/* a line's next level: OUR entries behind it (the server's, matched ones first), each chit openable; the ledger for the period opens in Ledgers */
function cmpNext(r) {
  var c = CMP.r && CMP.r.currency,
    list = r.entries || [];
  var rows = list
    .map(function (e) {
      return (
        '<div data-testid="cmp-entry-' +
        esc(e.entry_no) +
        '" style="display:flex;gap:10px;flex-wrap:wrap;align-items:baseline;padding:3px 0">' +
        '<span class="mono">' +
        esc(e.entry_no) +
        '</span><span>' +
        esc(bkDate(e.date)) +
        '</span><span class="mono">' +
        esc(bkDrCr(e.amount_minor, c)) +
        '</span>' +
        (e.chit_id
          ? '<button data-cbsid="BKS007-B05" type="button" data-testid="cmp-chit-' +
            esc(e.entry_no) +
            '" onclick="openChitSheet(\'' +
            esc(e.chit_id) +
            '\')">' +
            esc(e.ref ? txf('bill {ref}', { ref: e.ref }) : tx('the chit')) +
            (e.rail ? ' · ' + esc(tx('on the rail')) : '') +
            '</button>'
          : '<span style="color:var(--grey)">' + esc(tx('typed here')) + '</span>') +
        '</div>'
      );
    })
    .join('');
  var more =
    r.entries_n > list.length
      ? '<div style="color:var(--grey);font-size:var(--fs-1)">' + esc(txf('{n} more in the ledger', { n: r.entries_n - list.length })) + '</div>'
      : '';
  var open = r.open
    ? '<button data-cbsid="BKS007-B06" type="button" data-testid="cmp-open-' +
      esc(r.open.code) +
      '" onclick="cmpOpenLedger(\'' +
      esc(r.open.code) +
      "','" +
      esc(r.open.from) +
      "','" +
      esc(r.open.to) +
      '\')">' +
      esc(tx('Open the ledger')) +
      '</button>'
    : '';
  if (!rows && !open)
    return (
      '<div style="color:var(--grey);font-size:var(--fs-1)">' +
      esc(r.status === 'gap' ? tx('No ledger of ours to open yet.') : tx('No entries of ours in this period.')) +
      '</div>'
    );
  return '<div data-testid="cmp-entries">' + rows + more + (open ? '<div style="margin-top:6px">' + open + '</div>' : '') + '</div>';
}
function cmpOpenLedger(code, from, to) {
  BK.lgp = bkDbPeriod('custom', { from: from, to: to });
  BK.lt.sel = { code: code };
  BK.lt.last = { code: code };
  show('ledgers');
}
/* the auditor's file: the server's .csv, fetched with the session as Packs fetch theirs */
function cmpCsv(btn) {
  if (!CMP.id) return;
  CBAction.run(
    btn,
    function () {
      var base = (typeof CFG !== 'undefined' && CFG.API_BASE) || '';
      return fetch(base + EP.booksCompareCsv.p.replace(':id', encodeURIComponent(CMP.id)), {
        cache: 'no-store',
        headers: SESSION.token ? { Authorization: 'Bearer ' + SESSION.token } : {}
      })
        .then(function (res) {
          if (!res.ok) throw new Error(tx('Could not download it'));
          return res.blob();
        })
        .then(function (blob) {
          var node = document.createElement('a');
          node.href = URL.createObjectURL(blob);
          node.download = 'parallel-run-' + ((cmpSnap() || {}).period_to || 'period') + '.csv';
          node.setAttribute('data-testid', 'cmp-csv-link');
          document.body.appendChild(node);
          node.click();
          setTimeout(function () {
            try {
              URL.revokeObjectURL(node.href);
              node.remove();
            } catch (_) { /* best effort: failing here changes nothing the user sees */ }
          }, 1500);
          return true;
        });
    },
    {
      key: 'cmp-csv',
      busy: tx('Preparing…'),
      outcome: function () {
        toast(tx('Downloaded.'));
      },
      onFail: function (w) {
        toast(w);
      }
    }
  );
}

/* ── loading their figures: CBSteps File → Columns, then Keep (the one write) ── */
function cmpLoadOpen() {
  var snap = cmpSnap(),
    have = snap ? snap.parts || [] : [];
  var add = snap && have.length < CMP_ORDER.length;
  CMP.ld = {
    add: !!add,
    source: snap ? snap.source : 'tally',
    part: add
      ? CMP_ORDER.filter(function (item) {
          return have.indexOf(item) < 0;
        })[0]
      : 'tb',
    label: '',
    from: '',
    to: '',
    header_row: '1',
    name: '',
    csv: null,
    xlsx: null,
    xml: null,
    pre: null,
    dec: {},
    err: ''
  };
  var main = document.getElementById('cmp_main');
  if (!main) return;
  main.innerHTML =
    '<div data-testid="cmp-load-steps"><div id="cmp_rail"></div><div id="cmp_lsub" style="color:var(--grey);font-size:var(--fs-1);margin-bottom:8px"></div><div id="cmp_lbody"></div><div id="cmp_lfoot" style="margin-top:12px"></div>' +
    '<div style="margin-top:8px"><button data-cbsid="BKS007-B07" type="button" data-testid="cmp-load-cancel" onclick="cmpLoadCancel()">' +
    esc(tx('Cancel')) +
    '</button></div></div>';
  if (CMP.st) CMP.st.destroy();
  CMP.st = CBSteps.create({
    steps: [
      { k: 'file', n: tx('File'), t: tx('Export their period, then pick the file') },
      { k: 'columns', n: tx('Columns'), t: tx('Check which column is which') }
    ],
    railEl: 'cmp_rail',
    bodyEl: 'cmp_lbody',
    footEl: 'cmp_lfoot',
    subEl: 'cmp_lsub',
    render: cmpLoadRender,
    guard: cmpLoadGuard,
    onStep: cmpLoadOnStep,
    onSend: cmpKeep,
    sendLabel: tx('Keep'),
    nextLabel: function (k) {
      return k === 'file' ? tx('Read the file') + ' →' : null;
    },
    sendTestid: 'cmp-keep',
    nextTestid: 'cmp-next',
    backTestid: 'cmp-back'
  });
  CMP.st.paint();
  cmpPaint();
}
function cmpLoadCancel() {
  CMP.ld = null;
  if (CMP.st) {
    CMP.st.destroy();
    CMP.st = null;
  }
  cmpPaint();
  if (CMP.r) cmpPaintCompare();
  else if (CMP.id) cmpRead(CMP.id);
}
function cmpLoadSel(id, k, list, cur) {
  return (
    '<select data-cbsid="BKS007-S02" class="inp" id="' +
    id +
    '" data-testid="' +
    id +
    '" onchange="cmpLoadSet(\'' +
    k +
    '\', this.value)" style="min-width:0;max-width:100%">' +
    list
      .map(function (item) {
        return '<option value="' + esc(item.v) + '"' + (item.v === cur ? ' selected' : '') + '>' + esc(tx(item.label)) + '</option>';
      })
      .join('') +
    '</select>'
  );
}
function cmpLoadRender(k) {
  var L = CMP.ld,
    list = CMP.list || {};
  if (!L) return '';
  if (k === 'file') {
    var have = L.add ? (cmpSnap() || {}).parts || [] : [];
    var parts = (list.parts || [])
      .filter(function (item) {
        return have.indexOf(item.part) < 0;
      })
      .map(function (item) {
        return { v: item.part, label: item.label };
      });
    var srcs = (list.sources || []).map(function (item) {
      return { v: item.source, label: item.label };
    });
    var date = function (id, key) {
      return (
        '<input data-cbsid="BKS007-I01" class="inp" type="date" id="' +
        id +
        '" data-testid="' +
        id +
        '" value="' +
        esc(L[key]) +
        '" onchange="cmpLoadSet(\'' +
        key +
        '\', this.value)" style="width:auto;max-width:100%">'
      );
    };
    return (
      '<div data-testid="cmp-file-step" style="max-width:640px">' +
      (L.add
        ? miRow(
            tx('Adding to'),
            '<b data-testid="cmp-adding">' +
              esc((cmpSnap() || {}).label || '') +
              '</b> <button data-cbsid="BKS007-B08" type="button" data-testid="cmp-new" onclick="cmpLoadSet(\'add\', \'\')">' +
              esc(tx('Start a new one')) +
              '</button>'
          )
        : miRow(
            tx('Name'),
            '<input data-cbsid="BKS007-I02" class="inp" id="cmp-label" data-testid="cmp-label" maxlength="80" value="' +
              esc(L.label) +
              '" oninput="cmpLoadSet(\'label\', this.value, true)" style="max-width:100%">'
          ) +
          miRow(tx('Whose figures'), cmpLoadSel('cmp-source', 'source', srcs, L.source)) +
          miRow(tx('From'), date('cmp-from', 'from')) +
          miRow(tx('To'), date('cmp-to', 'to'))) +
      miRow(tx('Which statement'), cmpLoadSel('cmp-part', 'part', parts, L.part)) +
      miRow(
        tx('Headings on row'),
        '<input data-cbsid="BKS007-I03" class="inp" type="number" min="1" max="40" id="cmp-hrow" data-testid="cmp-hrow" value="' +
          esc(L.header_row) +
          '" onchange="cmpLoadSet(\'header_row\', this.value)" style="width:80px">'
      ) +
      miRow(
        tx('File'),
        '<input data-cbsid="BKS007-I04" type="file" id="cmp-file" data-testid="cmp-file" accept=".csv,.xlsx,.xml,text/csv,text/xml" onchange="cmpLoadFile(this)" style="max-width:100%;min-width:0;font-size:var(--fs-1)">' +
          (L.name ? '<div data-testid="cmp-file-name" style="font-size:var(--fs-1);margin-top:4px">' + esc(L.name) + '</div>' : '')
      ) +
      (L.err ? '<div class="err" data-testid="cmp-load-err" style="color:var(--warn-2);margin-top:8px">' + esc(L.err) + '</div>' : '') +
      '</div>'
    );
  }
  if (!L.pre) return '<div style="color:var(--grey)">' + esc(L.err || tx('Reading…')) + '</div>';
  if (L.pre.format === 'tally_xml')
    return (
      '<div data-testid="cmp-xml-read">' +
      esc(txf('Read as a Tally export: {n} ledgers.', { n: L.pre.rows_total })) +
      '</div>' +
      (L.err ? '<div class="err" data-testid="cmp-load-err" style="color:var(--warn-2);margin-top:8px">' + esc(L.err) + '</div>' : '')
    );
  var opts = [['', tx('not read')]].concat(
    (L.pre.fields || []).map(function (x) {
      return [x.key, x.label + (x.required ? ' *' : '')];
    })
  );
  return (
    '<div data-testid="cmp-columns-step"><div style="font-size:var(--fs-1);color:var(--grey);margin-bottom:6px">' +
    esc(txf('{n} rows in {f}', { n: L.pre.rows_total, f: L.name })) +
    '</div>' +
    (L.pre.guess || [])
      .map(function (item) {
        return miRow(
          item.incoming,
          '<select data-cbsid="BKS007-S03" class="inp" style="width:100%;max-width:100%" data-testid="cmp-pick-' +
            esc(item.incoming) +
            '" onchange="cmpLoadPick(' +
            JSON.stringify(item.incoming).replace(/"/g, '&quot;') +
            ', this.value)">' +
            opts
              .map(function (o) {
                return '<option value="' + esc(o[0]) + '"' + (o[0] === (L.dec[item.incoming] || '') ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
              })
              .join('') +
            '</select>'
        );
      })
      .join('') +
    (L.err ? '<div class="err" data-testid="cmp-load-err" style="color:var(--warn-2);margin-top:8px">' + esc(L.err) + '</div>' : '') +
    '</div>'
  );
}
function cmpLoadGuard(k) {
  var L = CMP.ld;
  if (!L) return null;
  if (k === 'file') {
    if (!L.add && !String(L.label).trim()) return tx('Give the snapshot a name');
    if (!L.add && !L.to) return tx('Pick the last day of their period');
    if (!L.csv && !L.xlsx && !L.xml) return tx('Pick the file first');
    return null;
  }
  if (!L.pre) return L.err || tx('Read the file first');
  if (L.pre.format === 'tally_xml') return null;
  var picked = cmpLoadDecisions().map(function (item) {
    return item.field;
  });
  var miss = (L.pre.fields || []).filter(function (x) {
    return x.required && picked.indexOf(x.key) < 0;
  });
  return miss.length
    ? txf('Pick the column for {f}', {
        f: miss
          .map(function (x) {
            return x.label;
          })
          .join(', ')
      })
    : null;
}
function cmpLoadDecisions() {
  var d = CMP.ld.dec;
  return Object.keys(d)
    .filter(function (item) {
      return d[item];
    })
    .map(function (item) {
      return { incoming: item, field: d[item] };
    });
}
function cmpLoadRefresh() {
  if (CMP.st) {
    CMP.st.paintBody();
    CMP.st.paintFoot();
  }
}
function cmpLoadSet(k, v, quiet) {
  var L = CMP.ld;
  if (!L) return;
  if (k === 'add') L.add = false;
  else L[k] = String(v == null ? '' : v);
  if (k === 'part' || k === 'source' || k === 'header_row') {
    L.pre = null;
    L.dec = {};
  }
  L.err = '';
  /* a typed field (name · dates · headings row) changes no part of the form: only the footer's guard is painted, so a change fired on blur never repaints under the cursor */
  if (quiet || k === 'label' || k === 'from' || k === 'to' || k === 'header_row') {
    if (CMP.st) CMP.st.paintFoot();
  } else cmpLoadRefresh();
}
function cmpLoadPick(h, v) {
  CMP.ld.dec[h] = v || '';
  if (CMP.st) CMP.st.paintFoot();
}
/* the one reader of the file: text for .csv / .xml, base64 for .xlsx — nothing leaves the browser until the Columns step asks the server */
function cmpLoadFile(input) {
  var file = input && input.files && input.files[0],
    L = CMP.ld;
  if (!file || !L) return;
  L.name = file.name;
  L.csv = null;
  L.xlsx = null;
  L.xml = null;
  L.pre = null;
  L.dec = {};
  L.err = '';
  var rd = new FileReader();
  if (/\.xlsx$/i.test(file.name)) {
    rd.onload = function () {
      var b = new Uint8Array(rd.result),
        s = '';
      for (var index = 0; index < b.length; index++) s += String.fromCharCode(b[index]);
      L.xlsx = btoa(s);
      cmpLoadRefresh();
    };
    rd.readAsArrayBuffer(file);
  } else {
    rd.onload = function () {
      var t = String(rd.result || '');
      if (/\.xml$/i.test(file.name) || /^\s*<(\?xml|ENVELOPE)/i.test(t)) L.xml = t;
      else L.csv = t;
      cmpLoadRefresh();
    };
    rd.readAsText(file);
  }
}
function cmpLoadBody() {
  var L = CMP.ld,
    snap = cmpSnap(),
    b = { part: L.part, source: L.add && snap ? snap.source : L.source, file_name: L.name };
  if (L.xml) b.xml = L.xml;
  else if (L.xlsx) b.xlsx = L.xlsx;
  else b.csv = L.csv || '';
  if (Number(L.header_row) > 1) b.header_row = Number(L.header_row);
  return b;
}
function cmpLoadOnStep(k) {
  var L = CMP.ld;
  if (k !== 'columns' || !L || L.pre) return;
  api('booksComparePreflight', { body: cmpLoadBody() }).then(
    function (reply) {
      if (CMP.ld !== L) return;
      L.pre = reply || {};
      L.dec = {};
      (L.pre.guess || []).forEach(function (item) {
        if (item.field) L.dec[item.incoming] = item.field;
      });
      cmpLoadRefresh();
    },
    function (e) {
      if (CMP.ld !== L) return;
      L.err = bkWhy(e, tx('Could not read the file'));
      cmpLoadRefresh();
    }
  );
}
/* ⭐ the one write (M64): keep this part of the snapshot; the compare is read again with it */
function cmpKeep() {
  var btn = document.querySelector('[data-testid="cmp-keep"]'),
    L = CMP.ld,
    snap = cmpSnap();
  if (!btn || !L) return;
  var body = Object.assign(cmpLoadBody(), L.pre && L.pre.format !== 'tally_xml' ? { decisions: cmpLoadDecisions() } : {});
  if (L.add && snap) body.snapshot_id = snap.snapshot_id;
  else {
    body.label = L.label;
    if (L.from) body.period_from = L.from;
    body.period_to = L.to;
  }
  CBAction.run(
    btn,
    function () {
      return api('booksCompareKeep', { body: body });
    },
    {
      key: 'cmp-keep',
      busy: tx('Keeping…'),
      outcome: function (r) {
        toast(txf('{n} lines kept.', { n: (r && r.rows) || 0 }));
        CMP.ld = null;
        if (CMP.st) {
          CMP.st.destroy();
          CMP.st = null;
        }
        CMP.r = null;
        cmpLoadList(r && r.snapshot_id);
      },
      onFail: function (words) {
        L.err = words;
        cmpLoadRefresh();
      }
    }
  );
}
