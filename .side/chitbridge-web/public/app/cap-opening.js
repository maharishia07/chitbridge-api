/* cap-opening.js — OPENING BALANCES on CB Accounts (Setup › Opening balances): a start date, a Debit · Credit grid of the shop's ledgers, the bills behind Customers and Suppliers,
 * a live Difference, and after Save the same page shows what is kept (who, when, where it came from) with an Edit that asks why.
 * ⭐ THE PAGE ADDS NOTHING UP. The Difference, the Debit and Credit totals, the bills-against-ledger gap and every year's carry are the SERVER's (POST /api/books/opening/preview,
 *   GET /api/books/opening, GET /api/books/opening/years): this file sends the rows, waits for the answer and paints it ("Checking…" while it is out, never a number of its own).
 *   Save turns on only when the server says the opening balances are balanced; a change to what is saved goes through /opening/replace (the old entries reversed, the new posted, one transaction).
 * ⭐ COUNTRY NEUTRAL. No country, tax or system name is typed here: the ledgers, the tax ledgers to pin, the money and the year come from the shop's pack (via the server).
 * OWNS      the Opening balances view (obView), its grid and bill rows (obCell · obBill*), the live check (obPreviewSoon · obPreview), Save and Edit-with-a-reason (obSave · obEdit),
 *           the saved view (obSavedHtml) and the year strip (obYearsHtml)
 * CALLED BY public/accounts.html (script tag; BK.views opening: obView) · public/app/cap-books.js (the stub in its tab table) · app.html (CAP_WITH: books loads opening first)
 * FLOW      obView → GET /opening (pinned ledgers, what is saved) + GET /accounts + GET /opening/years → grid (new) or saved view → every change → obPreviewSoon → POST /opening/preview
 *           → Difference + Save state → Save: POST /opening { require_balanced } (new) or POST /opening/replace { reason } (a change) → the saved view
 * CARD      14-accounting/README
 */
'use strict';
if (typeof EP !== 'undefined') {
  Object.assign(EP, {
    booksOpeningPreview: { m: 'POST', p: '/api/books/opening/preview' },
    booksOpeningReplace: { m: 'POST', p: '/api/books/opening/replace' },
    booksOpeningSaved: { m: 'GET', p: '/api/books/opening' },
    booksOpeningYears: { m: 'GET', p: '/api/books/opening/years' }
  });
}
var OPENING = { mode: 'new', date: '', rows: [], chart: [], parties: null, pv: null, checking: false, again: false, timer: null, ref: null, saved: null, years: null, reason: '', body: null };
var OB_SOURCE = { typed: 'Typed', moved_in: 'Moved in', posted: 'Entered' }; /* a source KIND the server keeps → the words the page says (no system is named in code) */

/* ── words and small helpers ── */
function obMount(component) {
  return typeof bkMountAttribute === 'function' ? bkMountAttribute(component) : '';
}
function obSide(row) {
  return row.role === 'creditors' ? 'cr' : row.role === 'debtors' ? 'dr' : null;
} /* a bill sits on its ledger's own side */
function obHasBills(row) {
  return row.role === 'debtors' || row.role === 'creditors';
}
/** the page's own styles, added once (tokens only, no colour of its own) */
function obCss() {
  if (document.getElementById('ob-css')) return;
  var node = document.createElement('style');
  node.id = 'ob-css';
  node.textContent =
    '.ob{display:flex;flex-direction:column;gap:8px;max-height:calc(100dvh - 150px);min-height:0}' +
    '.ob-head{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;position:sticky;top:0;z-index:2;background:var(--card,var(--bg));padding:6px 0;border-bottom:1px solid var(--line)}' +
    '.ob-diff{flex:1 1 220px;min-width:0;font-size:var(--fs-1)}.ob-diff b{font-variant-numeric:tabular-nums}' +
    '.ob-rows{overflow:auto;min-height:0;flex:1 1 auto;border:1px solid var(--line);border-radius:8px}' +
    '.ob-row{display:grid;grid-template-columns:minmax(0,1fr) 130px 130px;gap:6px 8px;align-items:center;padding:5px 8px;border-bottom:1px solid var(--line)}' +
    '.ob-row.ob-pin{background:var(--soft,transparent)}.ob-hd{position:sticky;top:0;z-index:1;font-weight:700;background:var(--card,var(--bg));color:var(--grey)}' +
    '.ob-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ob-name small{color:var(--grey);margin-inline-start:6px}' +
    '.ob-bills{grid-column:1/-1;padding:4px 0 6px 14px;display:flex;flex-direction:column;gap:5px}' +
    '.ob-bill{display:grid;grid-template-columns:minmax(110px,1.4fr) minmax(70px,1fr) 128px 128px minmax(100px,1fr) 28px;gap:6px;align-items:center}' +
    '.ob-foot{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;font-size:var(--fs-1)}.ob-num{text-align:end;font-variant-numeric:tabular-nums}' +
    '.ob-years{display:flex;flex-wrap:wrap;gap:6px}.ob-year{border:1px solid var(--line);border-radius:8px;padding:6px 9px;font-size:var(--fs-1)}.ob-ok{color:var(--ok-2,var(--ok,green))}.ob-bad{color:var(--warn-2,var(--bad,#b42318))}' +
    '.ob-sw{display:none}.ob-foot select{min-width:0;max-width:100%}' +
    '@media (max-width:520px){.ob-hd{display:none}.ob-row{grid-template-columns:76px minmax(0,1fr);align-items:center}.ob-row .ob-name{grid-column:1/-1;white-space:normal}.ob-row .ob-sw{display:block;grid-column:1;grid-row:2;min-width:0}.ob-row[data-side="dr"]>:nth-child(3),.ob-row[data-side="cr"]>:nth-child(2){display:none}.ob-row[data-side="dr"]>:nth-child(2),.ob-row[data-side="cr"]>:nth-child(3){grid-column:2;grid-row:2;min-width:0}.ob-foot select{flex:1 1 150px}.ob-bills{padding-inline-start:0}.ob-bill{grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.ob-bill>*{min-width:0;max-width:100%;box-sizing:border-box;font-size:12px}.ob-bill>:nth-child(1){grid-column:1/-1}.ob-bill>:nth-child(5){grid-column:1/3}.ob-bill>:nth-child(6){grid-column:3;justify-self:end}.ob-bill{border:1px solid var(--line);border-radius:8px;padding:6px}.ob-head{gap:6px 8px}}';
  document.head.appendChild(node);
}
function obErr(e, fallback) {
  return typeof bkWhy === 'function' ? bkWhy(e, fallback) : fallback;
}
function obToday() {
  return typeof bkToday === 'function' ? bkToday() : new Date().toISOString().slice(0, 10);
}

/* ── load ── */
async function obView(body) {
  obCss();
  OPENING.body = body;
  body.innerHTML = '<div class="loadwrap"><span class="spin"></span> ' + tx('Reading…') + '</div>';
  try {
    var loaded = await Promise.all([api('booksOpeningSaved', { fresh: true }), api('booksAccounts'), api('booksOpeningYears', { fresh: true })]);
    OPENING.saved = loaded[0];
    OPENING.chart = ((loaded[1] && loaded[1].accounts) || []).filter(function (item) {
      return !item.is_group && item.active !== false && item.role !== 'suspense';
    });
    OPENING.years = loaded[2];
    OPENING.ref = null;
    if (OPENING.saved && OPENING.saved.lines && OPENING.saved.lines.length) obShowSaved();
    else obNew();
  } catch (e) {
    body.innerHTML = '<div data-testid="ob-err" style="color:var(--warn-2)">' + esc(obErr(e, tx('Could not be read'))) + '</div>';
  }
}
/** a new opening: the ledgers the pack pins, empty, the shop's first day of the year */
function obNew() {
  OPENING.mode = 'new';
  OPENING.reason = '';
  OPENING.ref = 'grid:' + (typeof bkRef === 'function' ? bkRef() : String(Date.now()));
  OPENING.date = (OPENING.saved && OPENING.saved.default_date) || obToday(); /* the ledger's first day, from the server */
  OPENING.rows = ((OPENING.saved && OPENING.saved.pinned) || []).map(function (item) {
    return obRowOf(item.code, true);
  });
  OPENING.pv = null;
  obRender();
}
function obRowOf(code, pinned) {
  var account =
    OPENING.chart.filter(function (item) {
      return String(item.code) === String(code);
    })[0] || {};
  return { code: String(code), name: account.name || String(code), role: account.role || null, dr: null, cr: null, bills: [], open: false, pinned: !!pinned };
}
/** the saved lines → grid rows for a change: a party line is a bill under its ledger, the rest are the ledger's own figure */
function obEdit() {
  OPENING.mode = 'replace';
  OPENING.reason = '';
  OPENING.ref = 'grid:' + (typeof bkRef === 'function' ? bkRef() : String(Date.now()));
  OPENING.date = OPENING.saved.date;
  var rows = [];
  var pinnedCodes = ((OPENING.saved && OPENING.saved.pinned) || []).map(function (item) {
    return String(item.code);
  });
  function rowFor(code) {
    var found = rows.filter(function (item) {
      return item.code === String(code);
    })[0];
    if (!found) {
      found = obRowOf(code, pinnedCodes.indexOf(String(code)) >= 0);
      rows.push(found);
    }
    return found;
  }
  pinnedCodes.forEach(rowFor);
  OPENING.saved.lines.forEach(function (line) {
    if (line.role === 'suspense') return;
    var row = rowFor(line.code);
    if (line.party_id) {
      row.bills.push({ party_id: line.party_id, ref: line.bill_ref || '', date: line.bill_date || '', due: line.due_date || '', minor: line.dr_minor || line.cr_minor });
      row.open = true;
    } else if (line.dr_minor) row.dr = (row.dr || 0) + line.dr_minor;
    else row.cr = (row.cr || 0) + line.cr_minor;
  });
  OPENING.rows = rows;
  OPENING.pv = null;
  obRender();
  obPreviewNow();
}

/* ── the grid ── */
function obField(id, minor, on, label) {
  return typeof bkMoneyInput === 'function'
    ? bkMoneyInput({ id: id, tid: id, minor: minor, on: on, extra: 'aria-label="' + esc(label) + '" data-cbsid="CMP040-I01"' + obMount('CMP040') })
    : '<input class="inp" id="' + id + '" data-testid="' + id + '" aria-label="' + esc(label) + '" inputmode="decimal">';
}
/** one ledger's row in the grid: name, Debit and Credit fields, and its Bills button for Customers and Suppliers */
function obRowHtml(row, i) {
  var hint = obHasBills(row) && OPENING.pv ? obBillsTotalOf(row.code) : null; /* the server's bills total for this ledger, as a placeholder: the page sums nothing */
  var html =
    '<div class="ob-row' +
    (row.pinned ? ' ob-pin' : '') +
    '" data-side="' + obSideOf(row) + '" data-testid="ob-row-' +
    esc(row.code) +
    '"><div class="ob-name" title="' +
    esc(row.name) +
    '"><span class="mono">' +
    esc(row.code) +
    '</span> ' +
    esc(row.name) +
    (obHasBills(row)
      ? '<button type="button" class="supact" data-cbsid="CMP042-B06"' + obMount('CMP042') + ' data-testid="ob-bills-' + esc(row.code) + '" aria-expanded="' + (row.open ? 'true' : 'false') + '" onclick="obToggle(' + i + ')" style="margin-inline-start:8px">' +
        (row.bills.length ? txf('Bills ({n})', { n: row.bills.length }) : tx('Bills')) +
        '</button>'
      : '') +
    '</div>' +
    obSideCell(row, i, 'dr', hint) +
    obSideCell(row, i, 'cr', hint) +
    obSwitchHtml(row, i) +
    '</div>';
  if (row.open && obHasBills(row)) html += obBillsHtml(row, i, hint);
  return html;
}
/** the grid's header: the start date, the Difference slot and the Save button */
function obHeadHtml() {
  var fixed = OPENING.mode === 'replace';
  return (
    '<div class="ob-head" data-testid="ob-head"><label style="display:flex;gap:6px;align-items:center">' +
    tx('Start date') +
    '<input class="inp" type="date" data-cbsid="CMP040-I02"' + obMount('CMP040') + ' id="ob_date" data-testid="ob_date" value="' + esc(OPENING.date) + '"' + (fixed ? ' disabled' : '') + ' onchange="obDate(this.value)"></label>' +
    '<div class="ob-diff" id="ob_diff" data-testid="ob-diff" role="status" aria-live="polite"></div>' +
    '<span id="ob_balance"></span>' +
    '<button type="button" class="supact-pri" data-cbsid="CMP042-B14"' + obMount('CMP042') + ' id="ob_save" data-testid="ob-save" onclick="obSave()" disabled>' + (fixed ? tx('Save change') : tx('Save')) + '</button>' +
    (fixed ? '<button type="button" class="supact" data-cbsid="CMP003-B01"' + obMount('CMP003') + ' data-testid="ob-cancel" onclick="obCancel()">' + tx('Cancel') + '</button>' : '') +
    '</div>'
  );
}
/** paint the whole page from the rows held, then ask the server for its check */
function obRender() {
  if (!OPENING.body) return;
  var picked = OPENING.rows.map(function (row) {
    return row.code;
  });
  var more = OPENING.chart.filter(function (item) {
    return picked.indexOf(String(item.code)) < 0;
  });
  OPENING.body.innerHTML =
    '<div class="ob" data-testid="ob-root">' +
    obHeadHtml() +
    '<div class="ob-rows" data-testid="ob-rows"><div class="ob-row ob-hd"><div class="ob-name">' + tx('Ledger') + '</div><div class="ob-num">' + tx('Debit') + '</div><div class="ob-num">' + tx('Credit') + '</div></div>' +
    OPENING.rows.map(obRowHtml).join('') +
    '</div>' +
    '<div class="ob-foot"><select class="inp" data-cbsid="CMP041-S01"' + obMount('CMP041') + ' id="ob_more" data-testid="ob-more" aria-label="' + esc(tx('Add a ledger')) + '"><option value="">' + esc(tx('Add a ledger')) + '</option>' +
    more
      .map(function (item) {
        return '<option value="' + esc(item.code) + '">' + esc(item.code + ' · ' + item.name) + '</option>';
      })
      .join('') +
    '</select><button type="button" class="supact" data-cbsid="CMP007-B01"' + obMount('CMP007') + ' data-testid="ob-more-go" onclick="obAddLedger()">' + tx('Add') + '</button>' +
    '<span id="ob_tot" data-testid="ob-tot" style="margin-inline-start:auto"></span></div>' +
    '<div id="ob_years" data-testid="ob-years">' + obYearsHtml() + '</div></div>';
  obStatePaint();
}
function obAddLedger() {
  var pick = document.getElementById('ob_more');
  if (!pick || !pick.value) return;
  OPENING.rows.push(obRowOf(pick.value, false));
  obRender();
  var last = document.getElementById('ob_dr_' + (OPENING.rows.length - 1));
  if (last) last.focus();
}
function obDate(value) {
  OPENING.date = value;
  obPreviewSoon();
}
/** a typed Debit or Credit: keep it as minor units on its row and ask the server for the check again */
function obCell(i, side) {
  var row = OPENING.rows[i];
  var value = bkMoneyRead('ob_' + side + '_' + i);
  row[side] = isFinite(value) && value > 0 ? value : null;
  if (row[side]) {
    var other = side === 'dr' ? 'cr' : 'dr'; /* a ledger has one side: typing one empties the other */
    row[other] = null;
    var box = document.getElementById('ob_' + other + '_' + i);
    if (box) box.value = '';
  }
  obPreviewSoon();
}
function obToggle(i) {
  OPENING.rows[i].open = !OPENING.rows[i].open;
  if (OPENING.rows[i].open && !OPENING.rows[i].bills.length) OPENING.rows[i].bills.push({ party_id: '', ref: '', date: '', due: '', minor: null });
  obEnsureParties().then(obRender);
}

/* ── the rows the server is asked about ── */
function obRowsOut() {
  var out = [];
  OPENING.rows.forEach(function (row) {
    var side = obSide(row);
    var bills = row.bills.filter(function (bill) {
      return bill.party_id && bill.minor;
    });
    bills.forEach(function (bill) {
      var one = { code: row.code, party_id: bill.party_id, bill_ref: bill.ref || null, bill_date: bill.date || null, due_date: bill.due || null };
      one[side === 'cr' ? 'cr_minor' : 'dr_minor'] = bill.minor;
      out.push(one);
    });
    if ((row.dr || row.cr) && !bills.length) {
      var ownLine = { code: row.code };
      if (row.dr) ownLine.dr_minor = row.dr;
      else ownLine.cr_minor = row.cr;
      out.push(ownLine);
    }
  });
  return out;
}

/* ── the live check: the server's Difference ── */
function obPreviewSoon() {
  OPENING.pv = null;
  OPENING.checking = true;
  obStatePaint();
  clearTimeout(OPENING.timer);
  OPENING.timer = setTimeout(obPreviewNow, 350);
}
/** ask the server for the Difference of the rows held; a newer answer wins and one still out asks again when it lands */
async function obPreviewNow() {
  clearTimeout(OPENING.timer);
  if (OPENING.sending) {
    OPENING.again = true;
    return;
  } /* the app sends one preview at a time; the newest rows go next */
  var rows = obRowsOut();
  if (!rows.length) {
    OPENING.pv = { debit_minor: 0, credit_minor: 0, difference_minor: 0, side: null, bills: [], refusals: [], can_save: false, empty: true };
    OPENING.checking = false;
    obStatePaint();
    return;
  }
  OPENING.sending = true;
  OPENING.checking = true;
  try {
    var reply = await api('booksOpeningPreview', { body: { rows: rows, date: OPENING.date, replace: OPENING.mode === 'replace' } });
    if (!OPENING.again) OPENING.pv = reply;
  } catch (e) {
    OPENING.pv = { refusals: [{ name: 'ERR', why: obErr(e, tx('Could not check')) }], can_save: false, bills: [] };
  }
  OPENING.sending = false;
  if (OPENING.again) {
    OPENING.again = false;
    return obPreviewNow();
  }
  OPENING.checking = false;
  obStatePaint();
}
function obSideWord(side) {
  return side === 'dr' ? tx('Dr') : tx('Cr');
}
/** a ledger's bills-total cell follows its bills without a repaint of the grid (a repaint would drop the caret): read-only with bills, a money field without */
function obBillCellsPaint() {
  OPENING.rows.forEach(function (row, i) {
    if (obHasBills(row)) obBillCellPaint(row, i);
  });
}
/** one bills ledger's total cell: read-only "from n bills" once a bill has a party and an amount, a money field again when the last bill goes */
function obBillCellPaint(row, i) {
  var host = document.querySelector('[data-testid="ob-row-' + row.code + '"]');
  var side = obSide(row);
  var cell = host && host.children[side === 'dr' ? 1 : 2];
  if (!cell) return;
  var hasBills = row.bills.some(function (bill) {
    return bill.party_id && bill.minor;
  });
  var isReadOnly = cell.getAttribute('data-testid') === 'ob-from-bills-' + row.code;
  if (hasBills) {
    if (OPENING.pv && !OPENING.checking) cell.outerHTML = obSideCell(row, i, side, obBillsTotalOf(row.code));
    else if (!isReadOnly) cell.outerHTML = obSideCell(row, i, side, null);
  } else if (isReadOnly) {
    cell.outerHTML = obSideCell(row, i, side, null);
    row[side] = null;
  }
}
/** paints the Difference sentence, the totals, the balance button and the Save state from the server's last answer — and nothing of its own */
function obStatePaint() {
  obBillCellsPaint();
  var diff = document.getElementById('ob_diff'),
    save = document.getElementById('ob_save'),
    totals = document.getElementById('ob_tot'),
    balanceHost = document.getElementById('ob_balance');
  if (!diff || !save) return;
  var preview = OPENING.pv;
  if (OPENING.checking || !preview) {
    obStateWaiting(diff, save, [totals, balanceHost], preview);
    return;
  }
  diff.innerHTML = obDifferenceHtml(preview);
  save.disabled = !preview.can_save;
  if (totals) totals.textContent = obTotalsWords(preview);
  if (balanceHost) balanceHost.innerHTML = obBalanceButtonHtml(preview);
}
/** while the server's answer is out (or before there is one): "Checking…" or the prompt, Save off, totals and balance button cleared */
function obStateWaiting(diff, save, cleared, preview) {
  diff.innerHTML = '<span style="color:var(--grey)">' + (preview || OPENING.checking ? tx('Checking…') : tx('Type the opening balances')) + '</span>';
  save.disabled = true;
  cleared.forEach(function (node) {
    if (node) node.textContent = '';
  });
}
/** "Debit x · Credit y" from the server's totals; nothing when nothing is typed */
function obTotalsWords(preview) {
  return preview.empty ? '' : tx('Debit') + ' ' + bkMoney(preview.debit_minor, preview.currency) + ' · ' + tx('Credit') + ' ' + bkMoney(preview.credit_minor, preview.currency);
}
/** the sentence in the Difference slot, all from the server's answer: empty · the refusals · how far apart the sides are · balanced */
function obDifferenceHtml(preview) {
  var currency = preview.currency;
  if (preview.empty) return '<span style="color:var(--grey)">' + esc(tx('Type the opening balances')) + '</span>';
  if (preview.refusals && preview.refusals.length)
    return (
      '<span class="ob-bad" data-testid="ob-refusal">' +
      preview.refusals
        .map(function (item) {
          return esc(item.why);
        })
        .join(' ') +
      '</span>'
    );
  if (preview.difference_minor)
    return '<span class="ob-bad">' + esc(txf("Difference {amt}. Add owner's equity or fix a line.", { amt: bkMoney(preview.difference_minor, currency) + ' ' + obSideWord(preview.side) })) + '</span>';
  return '<span class="ob-ok">' + esc(tx('Difference')) + ' <b>' + esc(bkMoney(0, currency)) + '</b> · ' + esc(tx('Balanced')) + '</span>';
}
/** the balancing figure is the engine's Difference: offered once, when the owner's equity ledger is still empty */
function obBalanceButtonHtml(preview) {
  var equity = OPENING.rows.filter(function (row) {
    return row.role === 'capital';
  })[0];
  var idx = equity ? OPENING.rows.indexOf(equity) : -1;
  return idx >= 0 && preview.difference_minor && !equity.dr && !equity.cr && (!preview.refusals || !preview.refusals.length)
    ? '<button type="button" class="supact" data-cbsid="CMP042-B14"' + obMount('CMP042') + ' data-testid="ob-balance" onclick="obBalance(' + idx + ')">' + esc(txf('Balance with {name}', { name: equity.name })) + '</button>'
    : '';
}
function obBalance(i) {
  var pv = OPENING.pv;
  if (!pv || !pv.difference_minor) return;
  OPENING.rows[i][pv.side] = pv.difference_minor; /* the server's figure, put in the ledger that balances it */
  OPENING.rows[i][pv.side === 'dr' ? 'cr' : 'dr'] = null;
  obRender();
  obPreviewNow();
}

/* ── save ── */
/** a change to what is saved asks why first, in the popup the bank page's Reopen and Month lock's Open again use (POP092, this screen's mount); the reason is kept with the change */
function obSave() {
  if (OPENING.mode !== 'replace') return obSaveGo();
  OPENING.reason = '';
  /* where-used: out-of-scope the mount is bkDialogMount(5): the host screen's own code plus -U25, so it cannot be one literal */
  ui.dialog({
    mount: bkDialogMount(5),
    pop: 'POP092',
    titleText: tx('Change the opening balances?'),
    bodyStyle: 'display:flex;flex-direction:column;gap:8px',
    body:
      '<label>' + tx('Why are you changing it?') + '<input class="inp" data-cbsid="CMP040-I01"' + obMount('CMP040') + ' id="ob_why" data-testid="ob-why" maxlength="200" autocomplete="off" placeholder="' + esc(tx('For example: typing slip')) + '"></label>' +
      '<div id="ob_whyout" data-testid="ob-whyout" role="alert" style="color:var(--warn-2)"></div>',
    footerHtml:
      '<button type="button" data-cbsid="CMP003-B01"' + obMount('CMP003') + ' onclick="closeModal()">' + tx('Cancel') + '</button>' +
      '<button type="button" class="supact-pri" data-cbsid="CMP042-B14"' + obMount('CMP042') + ' data-testid="ob-why-go" onclick="obReasonGo()">' + tx('Save change') + '</button>'
  });
}
/** Edit asks WHY first: the reason is kept and the page opens the grid for the change */
function obReasonGo() {
  var box = document.getElementById('ob_why'),
    out = document.getElementById('ob_whyout');
  OPENING.reason = String((box && box.value) || '').trim();
  if (!OPENING.reason) {
    if (out) out.textContent = tx('Say why — the reason is kept');
    return;
  }
  closeModal();
  obSaveGo();
}
/** press Save: send the rows (with the reason when it is a change) and show what the server kept */
async function obSaveGo() {
  var btn = document.getElementById('ob_save');
  await bkOnce('opening-save', btn, async function () {
    try {
      var rows = obRowsOut();
      var reply;
      if (OPENING.mode === 'replace') reply = await api('booksOpeningReplace', { body: { rows: rows, date: OPENING.date, reason: OPENING.reason, client_ref: OPENING.ref } });
      else reply = await api('booksOpening', { body: { rows: rows, date: OPENING.date, client_ref: OPENING.ref, require_balanced: true } });
      toast(txf('Saved as {no}.', { no: (reply && reply.entry_no) || '' }));
      OPENING.ref = null;
      await obView(OPENING.body);
    } catch (e) {
      toast(obErr(e, tx('Could not save')));
      if (btn) btn.disabled = false;
      obPreviewNow();
    }
  });
}
function obCancel() {
  obShowSaved();
}

/* ── what is saved ── */
function obSourceWord(kind) {
  return tx(OB_SOURCE[kind] || OB_SOURCE.posted);
}
function obPartyName(id) {
  var hit = (OPENING.parties || []).filter(function (item) {
    return item.party_id === id;
  })[0];
  return hit ? (hit.party_no ? hit.party_no + ' · ' : '') + (hit.name || hit.display_name || '') : '';
}
/** the saved view: who entered it, when and from where, every line the server kept, and the year strip */
async function obShowSaved() {
  OPENING.mode = 'saved';
  await obEnsureParties();
  var saved = OPENING.saved,
    currency = saved.currency;
  var savedBy = (saved.entries || [])
    .map(function (entry) {
      return (
        '<div data-testid="ob-source" style="font-size:var(--fs-1);color:var(--grey)"><b>' +
        esc(obSourceWord(entry.source && entry.source.kind)) +
        '</b> · ' +
        esc(entry.entry_no || '') +
        (entry.by_name ? ' · ' + esc(entry.by_name) : '') +
        (entry.at ? ' · ' + esc(bkDate ? bkDate(String(entry.at).slice(0, 10)) : String(entry.at).slice(0, 10)) : '') +
        '</div>'
      );
    })
    .join('');
  var rows = (saved.lines || [])
    .map(function (line) {
      return (
        '<div class="ob-row" data-testid="ob-saved-row"><div class="ob-name"><span class="mono">' + esc(line.code) + '</span> ' + esc(line.name || '') +
        (line.party_id ? '<small>' + esc(obPartyName(line.party_id) + (line.bill_ref ? ' · ' + line.bill_ref : '') + (line.due_date ? ' · ' + tx('due') + ' ' + line.due_date : '')) + '</small>' : '') +
        '</div><div class="ob-num">' + (line.dr_minor ? esc(bkMoney(line.dr_minor, currency)) : '') + '</div><div class="ob-num">' + (line.cr_minor ? esc(bkMoney(line.cr_minor, currency)) : '') + '</div></div>'
      );
    })
    .join('');
  OPENING.body.innerHTML =
    '<div class="ob" data-testid="ob-root"><div class="ob-head"><b>' + tx('Opening balances') + '</b><span>' + esc(tx('from') + ' ' + (bkDate ? bkDate(saved.date) : saved.date)) + '</span><span style="flex:1"></span>' +
    '<button type="button" class="supact-pri" data-cbsid="CMP012-B01"' + obMount('CMP012') + ' data-testid="ob-edit" onclick="obEdit()">' + tx('Edit') + '</button></div>' +
    savedBy +
    '<div class="ob-rows" data-testid="ob-rows"><div class="ob-row ob-hd"><div class="ob-name">' + tx('Ledger') + '</div><div class="ob-num">' + tx('Debit') + '</div><div class="ob-num">' + tx('Credit') + '</div></div>' + rows + '</div>' +
    '<div id="ob_years" data-testid="ob-years">' + obYearsHtml() + '</div></div>';
}
