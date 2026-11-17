/* app/cap-books-waiting-cells.js — CB ACCOUNTS: the cells of the Waiting grid (what is stuck, why, and the one fix per row). Split out of cap-books.js, code moved verbatim; nothing is added up here — every figure is the server's.
 * OWNS      the Waiting grid columns and each row's fix: bkWaitCols · bkWaitModel · bkWaitSupplierHTML · bkAddSupplier · bkWaitLink · bkWaitAcceptShort · bkWaitNext and their helpers
 * CALLED BY public/accounts.html (script tag, after cap-books.js) · app.html CAP_WITH books; its functions are global and are called by cap-books.js at run time
 * FLOW      bkWaitingView (cap-books-waiting-view.js) → bkWaitCols → one cell per row → a fix button → the API → bkHealthAgain → the Waiting tab paints again
 * CARD      16-finance/cb-finance
 */
'use strict';
/**
 * ⚠️⚠️ A SALE THE LEDGER COULD NOT RECORD WAS VISIBLE ONLY TO SOMEONE CALLING THE API BY HAND. /health has always
 * named them (`waiting[]`, each with the reason). Athi, 2026-10-02: the list is the Task table — Supplier · Bill no · Amount ·
 * Date · Step — no chit id, no "tries". A supplier bill waits on a person: its row opens the bill in the popup, where Accept asks
 * what the goods are for (resale · own use · asset). A posting that genuinely FAILED shows its reason in the Step column, and
 * the one control that helps — Try again. Supplier, bill number and step are the chit's own (CBSheet.model); the amount is
 * `summary_json.money.total`, READ from the chit, never summed here.
 */
function bkWaitId(w) {
  return String(w.chit_id || w.id || w.ref || '');
}
/** a row that is not simply waiting for acceptance — something failed or needs a fix (the row's todo, STD1) */
function bkWaitFailed(w) {
  return bkWaitTodo(w) !== 'accept';
}
function bkWaitModel(w) {
  var r = w && w.chit_id && BK.wchit && BK.wchit[w.chit_id];
  try {
    return r && window.CBSheet ? CBSheet.model(r) : null;
  } catch (failure) {
    return bkQuiet('bill-sheet', failure, null);
  }
}
/** a walk-in DAY waiting (job 'day': no bill of its own) — its counter and day, read from the server's own source ref "walkin:<counter>:<day>" (WX-R2R:
    those rows said "— · —", so the owner could not tell which day of which counter was stuck) */
function bkWaitDay(w) {
  var m = w && w.job === 'day' ? /^walkin:([^:]+):(\d{4}-\d{2}-\d{2})$/.exec(String(w.ref || '')) : null;
  return m ? { counter: (w.source && w.source.counter) || m[1], day: m[2] } : null;
}
/* the column list of the Waiting grid (what is stuck and why) */
function bkWaitCols() {
  var dash = '<span style="color:var(--grey)">—</span>';
  return [
    {
      key: 'who',
      label: tx('Party'),
      prio: 1,
      sort: 'who',
      w: 240,
      html: true,
      cell: function (waitingRow) {
        var billModel = bkWaitModel(waitingRow),
          waitDay = bkWaitDay(waitingRow);
        return billModel && billModel.who ? esc(billModel.who) : waitDay ? esc(tx('Walk-in day') + ' · ' + tx('Counter') + ' ' + waitDay.counter) : dash;
      }
    },
    /* FX-F10W2: Party · Bill no · Amount · Step keep their place at ≥ 1024 px — the bill number was the first to go at 1366 */
    {
      key: 'no',
      label: tx('Bill no'),
      prio: 2,
      sort: 'no',
      w: 170,
      html: true,
      cell: function (waitingRow) {
        var billModel = bkWaitModel(waitingRow);
        return billModel && billModel.no ? '<span class="mono">' + esc(billModel.no) + '</span>' : dash;
      }
    },
    {
      key: 'amount',
      label: tx('Amount'),
      prio: 3,
      sort: 'amount',
      num: true,
      w: 140,
      html: true,
      cell: function (waitingRow) {
        var billModel = bkWaitModel(waitingRow),
          billTotal = billModel && billModel.money && billModel.money.total;
        return billTotal != null ? esc(bkMajor(billTotal, billModel.cur)) : dash;
      }
    },
    {
      key: 'date',
      label: tx('Date'),
      prio: 5,
      sort: 'date',
      w: 120,
      html: true,
      cell: function (waitingRow) {
        var billModel = bkWaitModel(waitingRow),
          waitDay = bkWaitDay(waitingRow);
        return esc(bkDate((billModel && billModel.at) || (waitDay && waitDay.day) || waitingRow.since));
      }
    },
    {
      key: 'step',
      label: tx('Step'),
      prio: 4,
      sort: 'step',
      w: 300,
      html: true,
      cell: bkWaitStepCell
    }
  ];
}
/**
 * the Step cell of a Waiting row: a posting that failed says why, in the server's words; a bill naming a supplier the books do not know carries the fix
 * (F10/F11: the near matches first, then the add-party door); R106: their bill above the count offers the accept AT the count, or Reject; else the step word.
 */
function bkWaitStepCell(row) {
  var rowIndex = (BK.waiting || []).indexOf(row),
    model = bkWaitModel(row);
  if (bkWaitWho(row)) return bkWaitSupplierHTML(row, rowIndex);
  if (bkWaitFailed(row))
    return '<span data-testid="wait-why-' + rowIndex + '" style="color:var(--warn-2)">' + esc(row.reason || row.why || tx('No reason given')) + '</span>';
  if (bkWaitShort(row.chit_id)) return bkWaitShortHTML(row, rowIndex, model);
  return model ? esc(CBSheet.stepWord(model)) : '<span style="color:var(--grey)">—</span>';
}
/** FX-F10W: the shop's near matches come FIRST ("Is this Sri Ganesh Provisions (P-00001)?" — the server's candidates); adding a new party is the second choice */
function bkWaitSupplierHTML(row, rowIndex) {
  return (
    '<span data-testid="wait-why-' +
    rowIndex +
    '" style="color:var(--warn-2)">' +
    esc(row.reason || row.why) +
    '</span> ' +
    bkWaitCands(row)
      .map(function (item, index) {
        return (
          '<button data-cbsid="CMP042-B16"' + bkMountAttribute('CMP042') + ' type="button" class="supact-pri" data-testid="wait-link-' +
          rowIndex +
          '-' +
          index +
          '" onclick="event.stopPropagation(); bkWaitLink(' +
          rowIndex +
          ', ' +
          index +
          ', this)">' +
          esc(CBSheet.isThis(item)) +
          '</button> '
        );
      })
      .join('') +
    '<button data-cbsid="CMP042-B17"' + bkMountAttribute('CMP042') + ' type="button"' +
    (bkWaitCands(row).length ? '' : ' class="supact-pri"') +
    ' data-testid="wait-addsup-' +
    rowIndex +
    '" onclick="event.stopPropagation(); bkWaitAddSupplier(' +
    rowIndex +
    ', this)">' +
    esc(tx('Add supplier')) +
    '</button>'
  );
}
/** the supplier name a row asks to add — the row's `name` (STD1: data the books parked, never parsed from the sentence) */
function bkWaitWho(w) {
  return bkWaitTodo(w) === 'add_supplier' && w.name ? String(w.name) : null;
}
/**
 * F11: add <name> as a supplier through the EXISTING door (POST /relationships/suppliers { name } — a local party, as the Suppliers screen adds
 * one), then ask the books to try again: the bill now names a supplier the books know and waits for acceptance. → the sentence to show, or null.
 * "Already on your list" is not a failure here — the retry is what was wanted.
 */
/** a To do notice's door: the host page (CB Accounts) names where "bills to accept" and "suppliers to add" open (BK.noticeTarget); the workshop's Waiting list otherwise */
function bkNoticeGo(kind) {
  if (BK.noticeTarget && BK.noticeTarget[kind]) return BK.noticeTarget[kind]();
  bkTab('waiting');
}
/* add a supplier by name; one that already exists counts as added */
async function bkAddSupplier(name) {
  try {
    await api('supAdd', { body: { name: name, supply_kind: 'resale' } });
  } catch (e) {
    if (!(e && (e.status === 409 || /already/i.test(String(e.message || ''))))) return bkWhy(e, tx('Could not add the supplier'));
  }
  try {
    await api('booksRetry', { body: {} });
  } catch (e) {
    return bkWhy(e, tx('Added — try again from Waiting'));
  }
  return bkHealthAgain(tx('Added — open Waiting again to see the bill'));
}
/* add the supplier a waiting row names, then refresh the waiting list */
async function bkWaitAddSupplier(rowIndex, btn) {
  var waitingRow = (BK.waiting || [])[rowIndex],
    name = bkWaitWho(waitingRow);
  if (!name) return;
  await bkOnce('addsup-' + rowIndex, btn, async function () {
    var said = await bkAddSupplier(name);
    /* STD1: the ROW flips (the list repaints its rows from the new /health read) — the view, its search and scroll stay */
    var wl = CBList.get('waiting');
    if (wl && BK.tab === 'waiting') wl.refresh();
    var out = document.getElementById('wait_out');
    if (out) out.textContent = said || txf('{name} added as a supplier', { name: name });
  });
}
/** FX-F10W: the server's near matches on an add_supplier row (≤ 3, names + party_no) */
function bkWaitCands(w) {
  return bkWaitTodo(w) === 'add_supplier' && Array.isArray(w && w.candidates) ? w.candidates.slice(0, 3) : [];
}
/**
 * FX-F10W: "it is this one" — MY receipt names that supplier through the existing writer of a buyer's fact on a bill before acceptance
 * (PUT /chits/:id/use { party }: the SERVER resolves the number in my list and writes party.party_id), then the books try again: the bill
 * now names a supplier they know and waits for acceptance. → the sentence to show, or null. One party, never a second one beside it.
 */
async function bkLinkSupplier(chitId, c) {
  try {
    await api('billUse', { params: { id: chitId }, body: { party: c.party_no ? { party_no: c.party_no } : { name: c.name } } });
  } catch (e) {
    return bkWhy(e, tx('Could not link the supplier'));
  }
  try {
    await api('booksRetry', { body: {} });
  } catch (e) {
    return bkWhy(e, tx('Linked — try again from Waiting'));
  }
  return bkHealthAgain(tx('Linked — open Waiting again to see the bill'));
}
/** STD1: read /health again after a fix; a read that fails is logged and SAID (the fix itself is done) → the sentence, or null */
async function bkHealthAgain(said) {
  try {
    await bkHealthLoad();
    return null;
  } catch (e) {
    console.error('Books: the Waiting list could not be read again —', (e && e.message) || e);
    return said;
  }
}
/* link a waiting row to one of its candidate suppliers */
async function bkWaitLink(rowIndex, candidateIndex, btn) {
  var waitingRow = (BK.waiting || [])[rowIndex],
    candidate = bkWaitCands(waitingRow)[candidateIndex];
  if (!waitingRow || !candidate || !waitingRow.chit_id) return;
  await bkOnce('link-' + rowIndex, btn, async function () {
    var said = await bkLinkSupplier(waitingRow.chit_id, candidate);
    var wl = CBList.get('waiting');
    if (wl && BK.tab === 'waiting') wl.refresh();
    var out = document.getElementById('wait_out');
    if (out) out.textContent = said || txf('Linked to {name} — the bill waits for you to accept it', { name: candidate.name });
  });
}
/**
 * FX-F10W ([[feedback-repaint-locally]]): a bill the popup just accepted leaves the Waiting list at once — the row is flipped out of BK.waiting
 * and the list and its count repaint; no reload. The books post it a moment later, so a /health read in that moment may still
 * list it as "to confirm": BK.gone keeps it out until the server says something else about it.
 */
function bkWaitGone(chitId) {
  if (!chitId) return;
  BK.gone = BK.gone || {};
  BK.gone[chitId] = true;
  var left = (BK.waiting || []).filter(function (item) {
    return item.chit_id === chitId && bkWaitTodo(item) === 'accept';
  }).length;
  BK.waiting = (BK.waiting || []).filter(function (item) {
    return item.chit_id !== chitId;
  });
  if (BK.waitN && left) {
    BK.waitN.accept = Math.max(0, BK.waitN.accept - left);
    BK.waitN.total = Math.max(0, BK.waitN.total - left);
  }
  bkWaitingCount();
  var wl = CBList.get('waiting');
  if (wl && BK.tab === 'waiting') wl.refresh();
}
function bkWaitDate(waitingRow) {
  var billModel = bkWaitModel(waitingRow),
    waitDay = bkWaitDay(waitingRow);
  return String((billModel && billModel.at) || (waitDay && waitDay.day) || waitingRow.since || '');
}
/**
 * ⭐ R106 (OPS-60): THE SHORTFALL IS DATA ON THE ROW — `waiting[].short` { theirs_minor, ours_minor, short_minor } (api books-hooks shortOf,
 * FIELDS waiting[].short) when their bill is ABOVE what the counter counted. The row offers the accept AT THE COUNT and Reject; the sheet's
 * Accept asks the same question through this reader (the chit read carries no `short` yet). Integers only — never the sentence.
 */
function bkWaitShort(chitId) {
  var row = (BK.waiting || []).filter(function (item) {
    return chitId && item.chit_id === chitId && bkWaitTodo(item) === 'accept' && item.short && Number(item.short.short_minor) > 0;
  })[0];
  return row ? { theirs_minor: Number(row.short.theirs_minor), ours_minor: Number(row.short.ours_minor), short_minor: Number(row.short.short_minor) } : null;
}
/** the Step cell of a shortfall row: the server's sentence (it names the gap), then "Accept at ₹2,690" and "Reject" — both ask first */
function bkWaitShortHTML(row, index, model) {
  var short = bkWaitShort(row.chit_id),
    currency = (model && model.cur) || bkCur();
  var said = '<span data-testid="wait-why-' + index + '" style="color:var(--warn-2)">' + esc(row.reason || row.why || '') + '</span> ';
  if (!model) return said + '<span style="color:var(--grey)">' + esc(tx('Reading the bill…')) + '</span>';
  return (
    said +
    '<button data-cbsid="CMP042-B18"' + bkMountAttribute('CMP042') + ' type="button" class="supact-pri" data-testid="wait-accept-short-' +
    index +
    '" onclick="event.stopPropagation(); bkWaitAcceptShort(' +
    index +
    ', this)">' +
    esc(txf('Accept at {ours}', { ours: bkMoney(short.ours_minor, currency) })) +
    '</button> <button data-cbsid="CMP042-B19"' + bkMountAttribute('CMP042') + ' type="button" data-testid="wait-reject-short-' +
    index +
    '" onclick="event.stopPropagation(); bkWaitRejectShort(' +
    index +
    ')">' +
    esc(tx('Reject')) +
    '</button>'
  );
}
/** what the outcome line says once the count is accepted: the counted figure, the gap and their figure (all the server's integers) */
function bkWaitShortDone(short, currency) {
  return txf('Accepted at {ours} — {short} short against their {theirs}, noted on the bill', {
    ours: bkMoney(short.ours_minor, currency),
    short: bkMoney(short.short_minor, currency),
    theirs: bkMoney(short.theirs_minor, currency)
  });
}
/**
 * Accept at the count: a money promise — CBAction asks first (the sheet's own question, CBSheet.shortAsk: supplier · bill · the counted ₹), then the
 * chit's own step (PUT /status accepted — the same move the sheet makes; the server posts ONE entry at the count and notes the gap). The row leaves at once.
 */
function bkWaitAcceptShort(index, button) {
  var row = (BK.waiting || [])[index],
    model = bkWaitModel(row),
    short = row && bkWaitShort(row.chit_id);
  if (!row || !model || !short) return;
  return CBAction.run(
    button,
    function () {
      return api('status', { params: { id: row.chit_id }, body: { status: 'accepted' } });
    },
    {
      key: 'wait-accept-' + row.chit_id,
      confirm: CBSheet.shortAsk(model, short),
      out: 'wait_out',
      busy: tx('Accepting…'),
      failed: tx('Could not accept the bill'),
      outcome: function () {
        bkWaitGone(row.chit_id);
        bkHealthAgain(null);
        var out = document.getElementById('wait_out');
        if (out) out.textContent = bkWaitShortDone(short, model.cur);
      }
    }
  );
}
/** Reject: the sheet's one Reject door (it asks the reason, which goes on the bill) — opened at that question */
function bkWaitRejectShort(index) {
  var row = (BK.waiting || [])[index];
  if (row && row.chit_id) openChitSheet(row.chit_id, { act: 'reject' });
}
/* the bill lines under one waiting row, or the reason there are none yet */
function bkWaitNext(waitingRow) {
  var billModel = bkWaitModel(waitingRow),
    testId = 'wait-lines-' + (BK.waiting || []).indexOf(waitingRow);
  if (!billModel)
    return (
      '<div data-testid="' +
      testId +
      '" style="color:var(--grey);font-size:var(--fs-1)">' +
      esc(tx(waitingRow.chit_id ? 'Reading the bill…' : 'No bill attached')) +
      '</div>'
    );
  var moneyLines = (billModel.money && billModel.money.lines) || [];
  var lines = (billModel.lines || [])
    .map(function (item, index) {
      var moneyLine = moneyLines[index],
        lineTotal = moneyLine ? moneyLine.total : item.total != null ? item.total : item.net,
        quantity = item.quantity != null ? item.quantity : item.qty != null ? item.qty : '';
      return CBList.nextRow(
        [esc(item.particulars || item.name || ''), esc(String(quantity) + (item.unit && item.unit !== 'piece' ? ' ' + item.unit : '')), esc(bkMajor(lineTotal, billModel.cur))],
        [90, 110]
      );
    })
    .join('');
  return (
    '<div data-testid="' +
    testId +
    '">' +
    (lines || '<div style="color:var(--grey);font-size:var(--fs-1)">' + esc(tx('No lines on this bill')) + '</div>') +
    '</div>'
  );
}
/** one chit read per waiting row (four at a time); each row paints again when its bill arrives — the list never waits for them */
async function bkWaitReads() {
  BK.wchit = BK.wchit || {};
  var todo = (BK.waiting || []).filter(function (item) {
    return item.chit_id && !(item.chit_id in BK.wchit);
  });
  todo.forEach(function (item) {
    BK.wchit[item.chit_id] = null;
  });
  var next = 0;
  async function worker() {
    while (next < todo.length) {
      var w = todo[next++];
      try {
        BK.wchit[w.chit_id] = await api('chit', { params: { id: w.chit_id } });
      } catch (failure) {
        BK.wchit[w.chit_id] = bkQuiet('waiting-bill', failure, false);
      }
      if (BK.tab === 'waiting') {
        var wl = CBList.get('waiting');
        if (wl) wl.refresh();
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
}
