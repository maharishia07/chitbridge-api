/* app/cap-books-waiting-view.js — CB ACCOUNTS: the Waiting tab and the Accounts tab. Split out of cap-books.js, code moved verbatim; nothing is added up here — every figure is the server's.
 * OWNS      the Waiting tab (bkWaitingView · bkWaitReads · bkWaitingRetry) and the Accounts tab (bkAccounts · bkAccountAdd)
 * CALLED BY public/accounts.html (script tag, after cap-books.js) · app.html CAP_WITH books; its functions are global and are called by cap-books.js at run time
 * FLOW      Waiting tab → bkWaitingView → bkWaitReads (one chit read per row) → bkWaitingRetry · Accounts tab → bkAccounts → bkAccountAdd
 * CARD      16-finance/cb-finance
 */
'use strict';
/* the Waiting tab: bills and payments the server could not post yet */
async function bkWaitingView(body) {
  try {
    await bkHealthLoad();
    var list = BK.waiting || [],
      failed = list.some(bkWaitFailed);
    body.innerHTML =
      '<div class="sec">' +
      tx('Waiting to be recorded') +
      '</div>' +
      (list.length && failed
        ? '<div class="supacts" style="display:flex;gap:7px;margin-bottom:9px"><button data-cbsid="CMP009-B01"' + bkMountAttribute('CMP009') + ' class="supact-pri" data-testid="wait-retry" onclick="bkWaitingRetry()">' +
          tx('Try again') +
          '</button></div>'
        : '') +
      '<div id="wait_out" data-testid="wait_out" style="font-size:var(--fs-1);margin-bottom:6px"></div>' +
      (list.length ? '<div id="bkl_waiting" data-testid="waiting-list"></div>' : emptyState('✓', tx('Nothing is waiting'), ''));
    if (!list.length) return;
    CBList.mount(document.getElementById('bkl_waiting'), {
      key: 'waiting',
      t: tx,
      rows: function () {
        return BK.waiting || [];
      },
      id: bkWaitId,
      columns: bkWaitCols(),
      /* FX-F10W2: the four a person needs, in the prio order (Party · Bill no · Amount · Step) — the top-three default left Bill no out */
      defaultCols: ['who', 'no', 'amount', 'step'],
      rowTid: function (w) {
        return 'wait-' + (BK.waiting || []).indexOf(w);
      },
      /* a row opens the bill's sheet; its caret opens the lines */
      onOpen: function (w) {
        if (w.chit_id) openChitSheet(w.chit_id);
      },
      search: function (waitingRow) {
        var billModel = bkWaitModel(waitingRow);
        return [billModel && billModel.who, billModel && billModel.no, billModel && billModel.money && billModel.money.total, waitingRow.reason, waitingRow.why].join(' ');
      },
      sorts: [
        {
          key: 'date',
          label: tx('Oldest first'),
          cmp: function (left, right) {
            return bkWaitDate(left) < bkWaitDate(right) ? -1 : bkWaitDate(left) > bkWaitDate(right) ? 1 : 0;
          }
        },
        {
          key: 'who',
          label: tx('Party'),
          cmp: function (left, right) {
            return String((bkWaitModel(left) || {}).who || '').localeCompare(String((bkWaitModel(right) || {}).who || ''));
          }
        },
        {
          key: 'no',
          label: tx('Bill no'),
          cmp: function (left, right) {
            return String((bkWaitModel(left) || {}).no || '').localeCompare(String((bkWaitModel(right) || {}).no || ''), undefined, { numeric: true });
          }
        },
        {
          key: 'amount',
          label: tx('Amount'),
          cmp: function (left, right) {
            var g = function (waitingRow) {
              var billModel = bkWaitModel(waitingRow);
              return Number(billModel && billModel.money && billModel.money.total) || 0;
            };
            return g(left) - g(right);
          }
        },
        {
          key: 'step',
          label: tx('Step'),
          cmp: function (left, right) {
            return Number(bkWaitFailed(right)) - Number(bkWaitFailed(left));
          }
        }
      ],
      filters: [
        {
          key: 'what',
          label: tx('Step'),
          all: tx('Every step'),
          options: [
            { v: 'confirm', label: tx('To accept') },
            { v: 'failed', label: tx('Could not be recorded') }
          ],
          match: function (waitingRow, filterValue) {
            return filterValue === 'failed' ? bkWaitFailed(waitingRow) : !bkWaitFailed(waitingRow);
          }
        }
      ],
      next: bkWaitNext,
      empty: { title: tx('Nothing is waiting') }
    });
    bkWaitReads();
  } catch (e) {
    body.innerHTML = bkErr(e);
  }
}
/* ask the server to retry every waiting item, then report how many cleared */
async function bkWaitingRetry() {
  await bkOnce('retry', document.querySelector('[data-testid="wait-retry"]'), async function () {
    var before = (BK.waiting || []).length;
    try {
      await api('booksRetry', { body: {} });
      var body = document.getElementById('bk_body');
      if (body && BK.tab === 'waiting') await bkWaitingView(body);
      var left = (BK.waiting || []).length,
        out = document.getElementById('wait_out');
      if (out) out.textContent = left ? txf('{n} recorded · {m} still waiting', { n: Math.max(0, before - left), m: left }) : tx('All recorded');
    } catch (e) {
      var node = document.getElementById('wait_out');
      if (node) node.textContent = bkWhy(e, tx('Could not try again'));
    }
  });
}
/* the Accounts tab: the chart of accounts by group, with the add-account form */
async function bkAccounts(body) {
  try {
    var reply = await api('booksAccounts');
    var list = (reply && reply.accounts) || [];
    var groups = list.filter(function (item) {
      return item.is_group;
    });
    body.innerHTML =
      '<div class="supacts" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:9px"><input data-cbsid="CMP040-I01"' + bkMountAttribute('CMP040') + ' class="inp" id="ac_name" data-testid="ac_name" placeholder="' +
      esc(tx('New ledger name')) +
      '"><select data-cbsid="CMP041-S01"' + bkMountAttribute('CMP041') + ' class="inp" id="ac_parent" data-testid="ac_parent" aria-label="' + esc(tx('Parent group')) + '">' +
      groups
        .map(function (item) {
          return '<option value="' + esc(item.code) + '">' + esc(item.code + ' · ' + item.name) + '</option>';
        })
        .join('') +
      '</select><button data-cbsid="CMP007-B01"' + bkMountAttribute('CMP007') + ' class="supact-pri" data-testid="ac_add" onclick="bkAccountAdd()">' +
      tx('Add') +
      '</button></div><div id="ac_out" style="font-size:var(--fs-1)"></div>' +
      bkTable(
        [{ t: tx('Code') }, { t: tx('Ledger') }, { t: tx('Group') }],
        list
          .map(function (item) {
            return (
              '<tr' +
              (item.is_group ? ' style="font-weight:700"' : '') +
              '><td class="mono">' +
              esc(item.code) +
              '</td><td>' +
              esc(item.name) +
              '</td><td>' +
              esc(item.tally_group || '') +
              '</td></tr>'
            );
          })
          .join('')
      );
  } catch (e) {
    body.innerHTML = bkErr(e);
  }
}
/* add one account under a parent group */
async function bkAccountAdd() {
  var node = String((document.getElementById('ac_name') || {}).value || '').trim(),
    p = (document.getElementById('ac_parent') || {}).value;
  var out = document.getElementById('ac_out');
  if (!node) {
    if (out) out.textContent = tx('Type a name');
    return;
  }
  try {
    var reply = await api('booksAccountAdd', { body: { name: node, parent_code: p } });
    toast(txf('Added as {code}', { code: (reply && reply.account && reply.account.code) || '' }));
    bkTab('accounts');
  } catch (e) {
    if (out) out.textContent = bkWhy(e, tx('Could not add it'));
  }
}
