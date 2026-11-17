/* app/cap-books-cheques.js — CB ACCOUNTS: the Cheques tab (the cheques still held, grouped by what happens next). Split out of cap-books.js, code moved verbatim; nothing is added up here — every figure is the server's.
 * OWNS      the cheque row repaint, the /health and cheques reads, the Cheques grid columns and the Cheques tab (bkChequeRepaint · bkHealthLoad · bkChequesLoad · bkChequeCols · bkChequesView)
 * CALLED BY public/accounts.html (script tag, after cap-books.js) · app.html CAP_WITH books; its functions are global and are called by cap-books.js at run time
 * FLOW      Cheques tab → bkChequesView → bkChequesLoad (GET /api/books/cheques) → bkChequeCols → a step button → bkChequeStep (cap-books.js) → bkChequeRepaint
 * CARD      16-finance/cb-finance
 */
'use strict';
/** flip the ROW (and the Receive form's line) — never the whole view */
function bkChequeRepaint(id) {
  var c = BK.cheques[id];
  if (!c) return;
  var cell = document.querySelector('[data-testid="chq-steps-' + id + '"]');
  if (cell) cell.innerHTML = bkChequeStepsHTML(c);
  var inForm = document.getElementById('pay_chq_steps');
  if (inForm && PAY && PAY.id === id) inForm.innerHTML = bkChequeStepsHTML(c);
}
/** ONE read of /health: what is waiting (each row's `reason` is the server's sentence) */
async function bkHealthLoad() {
  var reply = await api('booksHealth');
  BK.waiting = ((reply && reply.waiting) || []).filter(function (item) {
    return !(BK.gone && BK.gone[item.chit_id] && bkWaitTodo(item) === 'accept');
  }); /* FX-F10W: an accepted bill stays gone (bkWaitGone) */
  BK.waitN = bkWaitN(reply); /* STD1: the one count, not this page's length */
  if (reply && reply.year) BK.year = reply.year; /* the shop's year (bkFyNow) */
  if (reply && reply.currency) BK.cur = reply.currency;
  bkWaitingCount();
  return reply;
}
/** the cheques still held, from any session or the counter — the server's row wins over what this session remembers */
async function bkChequesLoad() {
  var reply = await api('booksCheques');
  ((reply && reply.cheques) || []).forEach(bkChequeKeep);
  return reply;
}
function bkWaitingCount() {
  var el = document.querySelector('[data-testid="bk-tab-waiting"] .code');
  if (!el) return;
  var n = BK.waitN ? BK.waitN.total : (BK.waiting || []).length;
  el.textContent = '🕗 ' + tx('Waiting') + (n ? ' · ' + n : '');
}
/**
 * the cheques held — the Task table too (Athi, 2026-10-02): Party · Cheque (number · bank) · Dated · Amount · Status, whose cell carries
 * the steps the SERVER offers next (Deposited · Cleared · Bounced) as buttons; bkChequeRepaint flips that cell, never the view.
 * Its next level is the party's bills (the statement route, read once on the first open).
 */
function bkChequeList() {
  return Object.keys(BK.cheques).map(function (item) {
    return BK.cheques[item];
  });
}
/* the column list of the cheques grid */
function bkChequeCols() {
  var dash = '<span style="color:var(--grey)">—</span>';
  return [
    {
      key: 'party',
      label: tx('Party'),
      prio: 1,
      sort: 'party',
      w: 220,
      html: true,
      cell: function (c) {
        return esc(c.name || '') || dash;
      }
    },
    {
      key: 'cheque',
      label: tx('Cheque'),
      prio: 4,
      sort: 'cheque',
      w: 200,
      html: true,
      cell: function (c) {
        return '<span class="mono">' + esc(c.cheque_no || '') + '</span>' + (c.cheque_bank ? ' · ' + esc(c.cheque_bank) : '');
      }
    },
    {
      key: 'dated',
      label: tx('Dated'),
      prio: 5,
      sort: 'dated',
      w: 120,
      html: true,
      cell: function (c) {
        return c.cheque_date ? esc(bkDate(c.cheque_date)) : dash;
      }
    },
    {
      key: 'amount',
      label: tx('Amount'),
      prio: 3,
      sort: 'amount',
      num: true,
      w: 130,
      html: true,
      cell: function (c) {
        return esc(bkMoney(c.amount_minor, c.currency));
      }
    },
    {
      key: 'status',
      label: tx('Status'),
      prio: 2,
      sort: 'status',
      w: 320,
      html: true,
      tid: function (c) {
        return 'chq-steps-' + c.payment_id;
      },
      cell: function (c) {
        return bkChequeStepsHTML(c);
      }
    }
  ];
}
/* the Cheques tab: held cheques grouped by what happens next */
async function bkChequesView(body) {
  try {
    await bkChequesLoad();
    var list = bkChequeList(),
      by = function (g) {
        return function (a, b) {
          return String(g(a)).localeCompare(String(g(b)), undefined, { numeric: true });
        };
      };
    body.innerHTML =
      '<div id="chq_out" data-testid="chq_out" style="color:var(--warn-2);font-size:var(--fs-1);margin-bottom:6px"></div><div id="bkl_cheques" data-testid="cheques-list"></div>';
    CBList.mount(document.getElementById('bkl_cheques'), {
      key: 'cheques',
      t: tx,
      rows: bkChequeList,
      id: function (c) {
        return c.payment_id;
      },
      columns: bkChequeCols(),
      rowTid: function (c) {
        return 'chq-' + c.payment_id;
      },
      search: function (c) {
        return [c.name, c.cheque_no, c.cheque_bank, c.status, (Number(c.amount_minor || 0) / Math.pow(10, bkDec(c.currency))).toFixed(bkDec(c.currency))].join(
          ' '
        );
      },
      sorts: [
        {
          key: 'dated',
          label: tx('Dated'),
          cmp: by(function (c) {
            return c.cheque_date || '';
          })
        },
        {
          key: 'party',
          label: tx('Party'),
          cmp: by(function (c) {
            return c.name;
          })
        },
        {
          key: 'cheque',
          label: tx('Cheque'),
          cmp: by(function (c) {
            return c.cheque_no;
          })
        },
        {
          key: 'amount',
          label: tx('Amount'),
          cmp: function (a, b) {
            return Number(a.amount_minor || 0) - Number(b.amount_minor || 0);
          }
        },
        {
          key: 'status',
          label: tx('Status'),
          cmp: by(function (c) {
            return c.status;
          })
        }
      ],
      filters: [
        {
          key: 'status',
          label: tx('Status'),
          all: tx('Every status'),
          options: Object.keys(BK_CHQ_WORD).map(function (item) {
            return { v: item, label: tx(BK_CHQ_WORD[item]) };
          }),
          match: function (c, v) {
            return c.status === v;
          }
        }
      ],
      /* its next level is the party's bills (the statement route, read once on the first open) */
      next: function (c) {
        return (
          '<div data-testid="chq-next-' +
          esc(c.payment_id) +
          '"><div style="color:var(--grey);font-size:var(--fs-1);text-transform:uppercase;padding:2px 0">' +
          esc(tx('Bills')) +
          '</div>' +
          (c.party_id ? bkPartyBillsHTML(c.party_id, 'cheques', c.currency || BK.duesCur) : '') +
          '</div>'
        );
      },
      empty: { title: tx('No cheques held') }
    });
  } catch (e) {
    body.innerHTML = bkErr(e);
  }
}
