/* cap-opening-bills.js — the BILL ROWS under a Customers or Suppliers ledger on the Opening balances grid (party · bill no · bill date · due · amount) and the ROW'S AMOUNT CELLS (the bills' total read-only, the money fields, the phone's Dr/Cr switch).
 * ⭐ The bills' total is the server's (the preview's bills[]); this file only collects the rows and hands them to cap-opening.js, which sends them. Nothing is added up here.
 * OWNS      the amount cells (obSideCell · obSideOf · obSwitchHtml · obSwitch) and the bill rows' markup and edits (obBillsHtml · obBillAdd · obBillDel · obBillIn · obPartyOptions · obBillsTotalOf) and the party list read (obEnsureParties)
 * CALLED BY public/app/cap-opening.js (obRowHtml · obToggle); loaded with it (accounts.html script tag · app.html CAP_WITH books)
 * FLOW      a ledger row's Bills button → obToggle → obEnsureParties (crmParties) → obBillsHtml → each edit → obBillIn → obPreviewSoon (cap-opening.js)
 * CARD      14-accounting/README
 */
'use strict';
function obBillsTotalOf(code) {
  var pair = ((OPENING.pv && OPENING.pv.bills) || []).filter(function (item) {
    return String(item.code) === String(code);
  })[0];
  return pair ? pair.bills_minor : null;
}
/** the party <option>s of a bills row: customers under Debtors, suppliers under Creditors (the party already chosen stays listed) */
function obPartyOptions(row, chosen) {
  var want = row.role === 'creditors' ? 'supplier' : 'customer';
  return (
    '<option value="">' +
    esc(tx('Choose')) +
    '</option>' +
    (OPENING.parties || [])
      .filter(function (item) {
        return item[want] || item.party_id === chosen;
      })
      .map(function (item) {
        return '<option value="' + esc(item.party_id) + '"' + (item.party_id === chosen ? ' selected' : '') + '>' + esc((item.party_no ? item.party_no + ' · ' : '') + (item.name || item.display_name || '')) + '</option>';
      })
      .join('')
  );
}
/** the bill rows under a ledger: party · bill no · date · due · amount, each edit going to obBillIn, and the bills' total (the server's, from the preview) */
function obBillsHtml(row, i, total) {
  var rows = row.bills
    .map(function (bill, j) {
      return (
        '<div class="ob-bill" data-testid="ob-bill-' + i + '-' + j + '">' +
        '<select class="inp" data-cbsid="CMP041-S01"' + obMount('CMP041') + ' data-testid="ob_bp_' + i + '_' + j + '" aria-label="' + esc(tx('Party')) + '" onchange="obBillIn(' + i + ',' + j + ",'party_id',this.value)\">" + obPartyOptions(row, bill.party_id) + '</select>' +
        '<input class="inp" data-cbsid="CMP040-I01"' + obMount('CMP040') + ' data-testid="ob_bn_' + i + '_' + j + '" aria-label="' + esc(tx('Bill no')) + '" placeholder="' + esc(tx('Bill no')) + '" value="' + esc(bill.ref) + '" onchange="obBillIn(' + i + ',' + j + ",'ref',this.value)\">" +
        '<input class="inp" type="date" data-cbsid="CMP040-I02"' + obMount('CMP040') + ' data-testid="ob_bt_' + i + '_' + j + '" aria-label="' + esc(tx('Bill date')) + '" value="' + esc(bill.date || '') + '" onchange="obBillIn(' + i + ',' + j + ",'date',this.value)\">" +
        '<input class="inp" type="date" data-cbsid="CMP040-I02"' + obMount('CMP040') + ' data-testid="ob_bd_' + i + '_' + j + '" aria-label="' + esc(tx('Due')) + '" value="' + esc(bill.due) + '" onchange="obBillIn(' + i + ',' + j + ",'due',this.value)\">" +
        obField('ob_ba_' + i + '_' + j, bill.minor, 'obBillIn(' + i + ',' + j + ",'minor')", tx('Amount')) +
        '<button type="button" class="supact ob-del" data-cbsid="CMP014-B01"' + obMount('CMP014') + ' data-testid="ob_bx_' + i + '_' + j + '" aria-label="' + esc(tx('Remove')) + '" onclick="obBillDel(' + i + ',' + j + ')">×</button></div>'
      );
    })
    .join('');
  return (
    '<div class="ob-bills" data-testid="ob-bills-box-' + esc(row.code) + '">' +
    rows +
    '<div><button type="button" class="supact" data-cbsid="CMP007-B01"' + obMount('CMP007') + ' data-testid="ob_badd_' + i + '" onclick="obBillAdd(' + i + ')">' + tx('+ Add a bill') + '</button>' +
    (total != null ? ' <span style="color:var(--grey);font-size:var(--fs-1)">' + esc(txf('Bills add to {amt}', { amt: bkMoney(total, OPENING.pv && OPENING.pv.currency) })) + '</span>' : '') +
    '</div></div>'
  );
}
async function obEnsureParties() {
  if (OPENING.parties) return;
  try {
    var reply = await api('crmParties');
    OPENING.parties = (reply && reply.parties) || [];
  } catch (failure) {
    if (typeof cbQuiet === 'function') cbQuiet('opening:parties', failure);
    OPENING.parties = [];
  }
}
function obBillAdd(i) {
  OPENING.rows[i].bills.push({ party_id: '', ref: '', date: '', due: '', minor: null });
  obRender();
}
function obBillDel(i, j) {
  OPENING.rows[i].bills.splice(j, 1);
  obRender();
  obPreviewSoon();
}
function obBillIn(i, j, field, value) {
  var bill = OPENING.rows[i].bills[j];
  if (field === 'minor') {
    var minor = bkMoneyRead('ob_ba_' + i + '_' + j);
    bill.minor = isFinite(minor) && minor > 0 ? minor : null;
  } else bill[field] = value;
  obPreviewSoon();
}
/** a ledger with bills shows the bills' total on its own side, read-only and greyed, "from n bills": the server's figure (the preview's pair), never a sum made here; every other cell is a money field */
function obSideCell(row, i, side, total) {
  var billCount = row.bills.filter(function (bill) {
    return bill.party_id && bill.minor;
  }).length;
  if (obHasBills(row) && billCount && obSide(row) === side)
    return (
      '<div class="ob-num" data-testid="ob-from-bills-' + esc(row.code) + '" style="color:var(--grey)" title="' + esc(tx('Filled from its bills')) + '">' +
      (total != null ? esc(bkMoney(total, OPENING.pv && OPENING.pv.currency)) : '…') +
      '<br><small>' + esc(billCount === 1 ? tx('from 1 bill') : txf('from {n} bills', { n: billCount })) + '</small></div>'
    );
  return obField('ob_' + side + '_' + i, row[side], 'obCell(' + i + ",'" + side + "')", row.name + ' ' + tx(side === 'dr' ? 'Debit' : 'Credit'));
}
/** the side a row shows on a phone: the ledger's own side when it holds bills, else the side that holds a figure, else the one it was last switched to */
function obSideOf(row) {
  if (obHasBills(row)) return obSide(row);
  return row.dr ? 'dr' : row.cr ? 'cr' : row.view || (row.role === 'capital' || row.role === 'creditors' ? 'cr' : 'dr');
}
/** a phone shows ONE amount field per ledger and a Dr/Cr switch beside it (the books select); wide screens hide the switch and show both columns */
function obSwitchHtml(row, i) {
  var side = obSideOf(row);
  return (
    '<select class="inp ob-sw" data-cbsid="CMP041-S01"' + obMount('CMP041') + ' data-testid="ob-sw-' + esc(row.code) + '" aria-label="' + esc(row.name + ' ' + tx('Debit or credit')) + '"' + (obHasBills(row) ? ' disabled' : '') + ' onchange="obSwitch(' + i + ',this.value)">' +
    '<option value="dr"' + (side === 'dr' ? ' selected' : '') + '>' + esc(tx('Dr')) + '</option><option value="cr"' + (side === 'cr' ? ' selected' : '') + '>' + esc(tx('Cr')) + '</option></select>'
  );
}
/** the phone's Dr/Cr switch on a row: the figure moves to the other side and the preview reads again */
function obSwitch(i, side) {
  var row = OPENING.rows[i],
    other = side === 'dr' ? 'cr' : 'dr';
  row.view = side;
  if (row[other]) {
    row[side] = row[other];
    row[other] = null;
  }
  obRender();
  obPreviewSoon();
}
