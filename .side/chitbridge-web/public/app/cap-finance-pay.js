/* cap-finance-pay.js — CB Finance · Payables (round F4): what WE owe each supplier, aged, MSME day 45 and its risk (India), the supplier's early-pay offer,
 * and Pay through the ONE payment path. Loaded by finance.html after cap-finance.js. docs: C:/dev/CB-FINANCE-PLAN.md §4 F4.
 *
 * ⭐ REUSE (CLAUDE.md rule 1, named in the PR): Collections' own shape — the same read (api('booksDues'), asked side=supplier&finance=1), CBList.mount
 * (the one list: grouped, sorted, searched) · CBList.nextRow (a row's bills, the Task table's next level) · payOpen (THE one payment path — widened with the
 * server's offer, never a second pay form) · bkDuesStore / bkPartyLabel / bkMoney / bkOwes / bkDate / bkToday (cap-books.js) · finOff / finDenied (the
 * ledger-off card and the owner-only sentence) · ftNav (the tab switch).
 * ⭐ ONE CALCULATION (rule 2): this file computes NO money and no date. The bills, the ageing buckets, day 45, the risk, the group, pay_by, the offer and its
 * words are the server's (lib/books-payables.view — F3's own outgoing dues, so this tab and Cash agree). A group head adds its rows, as Collections' does.
 * ⭐ NEW PATHS (rule 4): FP (this tab's state) · fpCols / fpNext (what a supplier row shows and opens to) · fpPay (Pay with the row's offer) ·
 *   R106 (OPS-60, 2026-10-24): fpHold / fpRelease (the books' own hold, POST /parties/:id/dispute — party_status disputed / undisputed, the server's
 *   `words` painted) · fpHeld (a held bill leaves payable.bills[], so it is read from the pay sheet's one open-bills reader, POST /payments/preview,
 *   when the row opens) · fpNoteDiff (a rate difference = a DEBIT NOTE through the ＋ Entry door, cap-entry.js enOpen kind debit_note). Each is a
 *   money promise: CBAction asks first, naming the supplier and the ₹. The bill's own word (`note`, "₹250 short against their ₹2,940") is the server's.
 * ⚠️ Never error.message on a screen. Finance SUGGESTS: the only writes are the pay sheet's own (Record, Record discount), the hold and the debit
 *   note — each pressed and confirmed by the owner; the server decides and posts.
 */
/* OWNS CB Finance, Pay: what the shop owes its suppliers
 * CALLED BY finance.html (after cap-finance.js)
 * FLOW GET the payables -> FP.cur from the reply, else the books money -> bkMoney for every figure; a row opens -> its bills (+ the held ones, read once) -> Hold · Release · Note a difference ask first
 * CARD 16-finance/payables */
'use strict';
if (typeof EP !== 'undefined') {
  Object.assign(EP, {
    booksDispute: { m: 'POST', p: '/api/books/parties/:id/dispute', ok: '✓' } /* R106: "Hold this bill" / "Release" — the books' one hold (party_status), any supplier */
  });
}

var FP = { gen: 0, rows: [], cur: null, total: null, state: 'loading', api: null, held: {}, note: '' };
var FP_HELD_WORD = 'Held — in dispute with you'; /* the books' word for a held bill (api routes/books.js STATUS_WORDS) — the dispute answer says it; the held list paints the same */
var FP_OWNER_ONLY = 'Only the owner may see what you owe.';
var FP_BUCKETS = [
  ['0_30', '0–30 days'],
  ['31_45', '31–45 days'],
  ['46_60', '46–60 days'],
  ['60_plus', 'Over 60 days']
];
var FP_GROUPS = { overdue: 'Overdue', msme: 'MSME at risk', week: 'Due this week', later: 'Later' };

async function fpLoad(quiet) {
  var generation = ++FP.gen;
  if (!quiet) {
    FP.state = 'loading';
    if (FP.api) FP.api.refresh();
  }
  try {
    var reply = await api('booksDues', { query: { asOf: bkToday(), side: 'supplier', finance: '1' } });
    if (generation !== FP.gen) return;
    bkDuesStore(reply);
    FP.cur = (reply && reply.currency) || bkCur();
    if (reply && reply.currency && typeof SESSION !== 'undefined' && SESSION)
      SESSION.currency = reply.currency; /* the ledger's currency reaches Pay (finance.html sets none) */
    FP.rows = ((reply && reply.parties) || []).filter(fpKeeps);
    FP.held = {}; /* the held bills are read again when a row opens: the hold may have moved */
    FP.total = reply && reply.payables ? reply.payables.total_minor : null;
    FP.state = 'ready';
  } catch (e) {
    if (generation !== FP.gen) return;
    if (e && e.status === 404) {
      finOff();
      return;
    } /* the Ledger is off for this shop (M212) */
    if (e && e.status === 403) {
      finDenied(FP_OWNER_ONLY, 'Payables');
      return;
    } /* the server said who may see it */
    FP.state = 'error';
  }
  if (FP.api) FP.api.refresh();
}
function fpRetry() {
  fpLoad();
}
/** a supplier row stays when it has a payable bill or (R106) a HELD one (the server's disputed_minor) — the hold must be releasable from here */
function fpKeeps(party) {
  return !!((party.payable && party.payable.bills && party.payable.bills.length) || Number(party.disputed_minor));
}
/** the supplier's name, its MSME tag and (R106) the held figure the server carries on the row */
function fpPartyCell(party) {
  return (
    esc(bkPartyLabel(party.party_id, party.name)) +
    (party.payable.msme ? ' <span class="tag" data-b="msme">' + esc(tx('MSME')) + '</span>' : '') +
    (Number(party.disputed_minor) ? ' <span class="tag amber" data-b="held">' + esc(tx('Held')) + ' ' + esc(bkMoney(Math.abs(Number(party.disputed_minor)), FP.cur)) + '</span>' : '')
  );
}
/** the tab's frame: the outcome line (R106: the hold's and the release's word) over the one list */
function fpFrameHTML() {
  return (
    '<div id="fp_out" data-testid="fp-out" aria-live="polite" style="font-size:var(--fs-1);padding:0 0 4px"></div>' +
    '<div id="fp_list" data-testid="fp-list" style="flex:1 1 auto;min-height:0"></div>'
  );
}
function fpRow(pid) {
  return (
    FP.rows.filter(function (item) {
      return item.party_id === pid;
    })[0] || null
  );
}
/** Pay: the one payment path, with the row's best offer (the server's) — the list re-reads after anything is written */
function fpPay(pid) {
  var p = fpRow(pid);
  payOpen('supplier', pid, {
    offer: p && p.payable ? p.payable.early : null,
    after: function () {
      fpLoad(true);
    }
  });
}

/* ── the columns: every figure is the server's ── */
function fpCols() {
  var currencyOf = function () {
      return FP.cur;
    },
    dash = '<span style="color:var(--grey)">—</span>';
  var bucket = function (k, label, prio) {
    return {
      key: 'b' + k,
      label: tx(label),
      prio: prio,
      num: true,
      w: 120,
      html: true,
      cell: function (p) {
        var v = Number(p.payable.buckets[k] || 0);
        return v ? '<span data-b="' + k + '">' + esc(bkMoney(v, currencyOf())) + '</span>' : dash;
      }
    };
  };
  return [
    {
      key: 'party',
      label: tx('Supplier'),
      prio: 1,
      sort: 'name',
      w: 220,
      html: true,
      cell: fpPartyCell
    },
    {
      key: 'due',
      label: tx('To pay'),
      prio: 2,
      sort: 'due',
      num: true,
      w: 140,
      html: true,
      cell: function (p) {
        return '<b data-b="topay">' + esc(bkMoney(Number(p.payable.total_minor), currencyOf())) + '</b>';
      }
    },
    {
      key: 'payby',
      label: tx('Pay by'),
      prio: 3,
      sort: 'risk',
      w: 150,
      html: true,
      cell: function (p) {
        var x = p.payable;
        return x.pay_by
          ? '<span data-b="payby">' +
              esc(bkDate(x.pay_by)) +
              '</span>' +
              (x.msme_risk ? ' <span class="tag amber" data-b="risk">⚠ ' + esc(tx('Day 45')) + '</span>' : '')
          : dash;
      }
    },
    {
      key: 'offer',
      label: tx('Early pay'),
      prio: 4,
      w: 230,
      html: true,
      cell: function (p) {
        var f = p.payable.early;
        return f ? '<span data-b="offer">' + esc(f.words) + '</span>' : dash;
      }
    },
    bucket('0_30', '0–30 days', 5),
    bucket('31_45', '31–45 days', 6),
    bucket('46_60', '46–60 days', 7),
    bucket('60_plus', 'Over 60 days', 8),
    {
      key: 'act',
      label: ' ',
      prio: 1,
      pin: 'end',
      w: 100,
      html: true,
      cell: function (party) {
        return (
          '<button type="button" data-cbsid="CMP042-B01"' + bkMountAttribute('CMP042') + ' class="cbl-tbtn" data-testid="fp-pay-' +
          esc(party.party_id) +
          '" onclick="event.stopPropagation();fpPay(\'' +
          esc(party.party_id) +
          '\')">' +
          esc(tx('Pay')) +
          '</button>'
        );
      }
    }
  ];
}
/** what a supplier row opens to: its ages (the server's buckets), then its bills as the server listed them — the MSME sentence and the offer under the bill they belong to */
function fpNext(party) {
  var currency = FP.cur,
    bills = (party.payable && party.payable.bills) || [],
    buckets = (party.payable && party.payable.buckets) || {};
  var ages = FP_BUCKETS.filter(function (item) {
    return Number(buckets[item[0]]) > 0;
  })
    .map(function (item) {
      return CBList.nextRow(['<span data-b="age-' + item[0] + '">' + esc(tx(item[1])) + '</span>', esc(bkMoney(Number(buckets[item[0]]), currency))]);
    })
    .join('');
  /* the bill's line is a nextRow (its date | amount — short, so a phone card stays inside the screen); its age, due day and sentences sit UNDER it on their own
     lines — a nextRow cell is one line, and a sentence must wrap, never clip */
  var line = function (tid, t, red) {
    return (
      '<div data-b="' + tid + '" style="font-size:var(--fs-1);padding:0 0 2px;color:' + (red ? 'var(--ink,#2a2418)' : 'var(--grey)') + '">' + esc(t) + '</div>'
    );
  };
  var rows = bills
    .map(function (item) {
      var label = (FP_BUCKETS.filter(function (k) {
        return k[0] === item.bucket;
      })[0] || [0, ''])[1];
      return (
        CBList.nextRow([
          '<span data-b="bill">' + esc(bkDate(item.date)) + '</span>',
          '<span class="due give">' + esc(bkMoney(item.open_minor, currency)) + '</span>'
        ]) +
        line('due', tx(label) + ' · ' + (item.overdue ? tx('overdue since') : tx('due')) + ' ' + bkDate(item.due_date)) +
        (item.note ? line('note', item.note, true) : '') /* R106: the bill's own word — "₹250 short against their ₹2,940" */ +
        (item.msme_words ? line('msme', item.msme_words, item.msme_risk) : '') +
        (item.early ? line('early', item.early.words) : '') +
        fpBillActs(party, item)
      );
    })
    .join('');
  var section = function (t) {
    return '<div style="color:var(--grey);font-size:var(--fs-1);padding:4px 0 2px">' + esc(tx(t)) + '</div>';
  };
  return (
    '<div data-testid="fp-next-' +
    esc(party.party_id) +
    '">' +
    (ages ? section('Age') + '<div data-testid="fp-ages-' + esc(party.party_id) + '">' + ages + '</div>' + section('Bills') : '') +
    (rows || '<div style="color:var(--grey);font-size:var(--fs-1)">' + esc(tx('Nothing to pay')) + '</div>') +
    fpHeldHTML(party, section, line) +
    '</div>'
  );
}
/** one bill's two doors (R106): Hold this bill · Note a difference (a rate difference, goods sent back) — each asks first (fpHold, fpNoteDiff) */
function fpBillActs(party, item) {
  var pid = esc(party.party_id),
    ref = esc(item.ref);
  return (
    '<div class="fp-acts" data-b="acts" style="display:flex;gap:6px;flex-wrap:wrap;padding:2px 0 6px">' +
    '<button data-cbsid="FIN002-B01" type="button" class="cbl-tbtn" data-testid="fp-hold-' + ref + '" onclick="event.stopPropagation();fpHold(\'' + pid + "','" + ref + '\',this)">' +
    esc(tx('Hold this bill')) +
    '</button>' +
    '<button data-cbsid="FIN002-B02" type="button" class="cbl-tbtn" data-testid="fp-note-' + ref + '" onclick="event.stopPropagation();fpNoteDiff(\'' + pid + "','" + ref + '\')">' +
    esc(tx('Note a difference')) +
    '</button></div>'
  );
}
/**
 * R106: the HELD bills of a supplier (the server leaves them out of payable.bills and the total; the party row carries disputed_minor). Read once per
 * opened row from the pay sheet's own open-bills reader (POST /payments/preview lists every open bill, `disputed` on each — FIELDS 419), never kept
 * from an earlier answer. Each shows the books' word and Release.
 */
function fpHeldHTML(party, sectionHTML, lineHTML) {
  if (!Number(party.disputed_minor)) return '';
  var pid = esc(party.party_id),
    held = FP.held[party.party_id],
    grey = 'color:var(--grey);font-size:var(--fs-1)';
  if (!held) {
    fpHeldRead(party.party_id);
    return sectionHTML('Held') + '<div data-testid="fp-held-' + pid + '" style="' + grey + '">' + esc(tx('Reading the held bills…')) + '</div>';
  }
  if (held.error) return sectionHTML('Held') + '<div data-testid="fp-held-' + pid + '" style="' + grey + '">' + esc(held.error) + '</div>';
  var rows = held.bills
    .map(function (item) {
      return fpHeldRow(pid, item, lineHTML);
    })
    .join('');
  return sectionHTML('Held') + '<div data-testid="fp-held-' + pid + '">' + (rows || '<div style="' + grey + '">' + esc(tx('Nothing is held')) + '</div>') + '</div>';
}
/** one held bill: its number (else its due day), the open figure, the books' word, Release */
function fpHeldRow(pid, item, lineHTML) {
  var ref = esc(item.against_ref);
  return (
    CBList.nextRow([
      '<span data-b="held-bill">' + esc(item.bill_no || bkDate(item.due_date)) + '</span>',
      '<span class="due give">' + esc(bkMoney(item.open_minor, FP.cur)) + '</span>'
    ]) +
    lineHTML('held', tx(FP_HELD_WORD)) +
    '<div class="fp-acts" data-b="acts" style="padding:2px 0 6px"><button data-cbsid="FIN002-B03" type="button" class="cbl-tbtn" data-testid="fp-release-' + ref + '" onclick="event.stopPropagation();fpRelease(\'' + pid + "','" + ref + '\',this)">' +
    esc(tx('Release')) +
    '</button></div>'
  );
}
/** the one read behind fpHeldHTML; the list paints again when it lands (or says why it could not) */
async function fpHeldRead(pid) {
  FP.held[pid] = { bills: [], reading: true };
  try {
    var reply = await api('booksPayPreview', { body: { party_id: pid, direction: 'out', amount_minor: 1, currency: FP.cur || bkCur(), allocate: 'none' } });
    FP.held[pid] = {
      bills: ((reply && reply.proposal) || []).filter(function (item) {
        return item.disputed && Number(item.open_minor) > 0;
      })
    };
  } catch (e) {
    FP.held[pid] = { bills: [], error: bkWhy(e, tx('Could not read the held bills')) };
  }
  if (FP.api) FP.api.refresh();
}
/** the supplier's name as the row shows it, for a question */
function fpWho(pid) {
  var party = fpRow(pid);
  return bkPartyLabel(pid, party && party.name);
}
/** the bill a ref names on a supplier's row (payable.bills) — its figure for the question; null when the server does not list it */
function fpBill(pid, ref) {
  var party = fpRow(pid);
  return (
    ((party && party.payable && party.payable.bills) || []).filter(function (item) {
      return String(item.ref) === String(ref);
    })[0] || null
  );
}
/** after a hold or a release: the server's own word under the row, then the list reads again (the bill moves between the two lists) */
function fpHoldDone(pid, reply) {
  var out = document.getElementById('fp_out');
  if (out) out.textContent = (reply && reply.words) || tx('Done');
  FP.held = {};
  fpLoad(true);
}
/**
 * ⭐ R106 "Hold this bill": a money promise — ask first (supplier · the bill's ₹), then the books' one hold (POST /parties/:id/dispute, side supplier,
 * with the typed note). Payables and the cash view leave it out until Release; the answer's `words` is what the row says.
 */
function fpHold(pid, ref, btn) {
  var bill = fpBill(pid, ref);
  if (!bill) return;
  FP.note = '';
  return CBAction.run(
    btn,
    function () {
      var body = { against_ref: ref, side: 'supplier', disputed: true };
      if (FP.note) body.note = FP.note.slice(0, 300);
      return api('booksDispute', { params: { id: pid }, body: body });
    },
    {
      key: 'fp-hold-' + ref,
      confirm: {
        title: txf('Hold {amt} from {who}?', { who: fpWho(pid), amt: bkMoney(bill.open_minor, FP.cur) }),
        body:
          esc(tx('It leaves what you owe and the cash view until you release it.')) +
          '<label class="fl" for="fp_hold_note" style="display:block;margin-top:8px">' +
          esc(tx('Why? (optional)')) +
          '</label><input data-cbsid="FIN002-I01" class="inp" id="fp_hold_note" data-testid="fp-hold-note" maxlength="300" autocomplete="off" oninput="FP.note=this.value">',
        yes: tx('Hold this bill'),
        danger: false
      },
      out: 'fp_out',
      busy: tx('Holding…'),
      failed: tx('Could not hold the bill'),
      outcome: function (reply) {
        fpHoldDone(pid, reply);
      }
    }
  );
}
/** "Release": the same door with disputed false — asked first; the bill is payable again (the answer's word) */
function fpRelease(pid, ref, btn) {
  var held = FP.held[pid],
    bill = ((held && held.bills) || []).filter(function (item) {
      return String(item.against_ref) === String(ref);
    })[0];
  if (!bill) return;
  return CBAction.run(
    btn,
    function () {
      return api('booksDispute', { params: { id: pid }, body: { against_ref: ref, side: 'supplier', disputed: false } });
    },
    {
      key: 'fp-release-' + ref,
      confirm: {
        title: txf('Release {amt} from {who}?', { who: fpWho(pid), amt: bkMoney(bill.open_minor, FP.cur) }),
        body: esc(tx('It is payable again.')),
        yes: tx('Release'),
        danger: false
      },
      out: 'fp_out',
      busy: tx('Releasing…'),
      failed: tx('Could not release the bill'),
      outcome: function (reply) {
        fpHoldDone(pid, reply);
      }
    }
  );
}
/** "Note a difference" (the api event's own words; a rate difference by default): a DEBIT NOTE against the bill through the one ＋ Entry door (kind debit_note; its Save asks first, naming the supplier and the ₹) */
function fpNoteDiff(pid, ref) {
  if (typeof enOpen !== 'function') {
    toast(tx('Open Accounts › Day book › ＋ Entry › Note a difference'));
    return;
  }
  enOpen({ kind: 'debit_note', v: { supplier: pid, against_ref: ref, reason: 'rate' }, ref: bkRef(), after: fpAfterNote });
}
/** a debit note saved: the Payables list reads again (what you owe them fell) */
function fpAfterNote() {
  fpLoad(true);
}
function fpHead() {
  var chips = [];
  if (FP.state === 'ready' && FP.total != null) chips.push({ tid: 'fp-total', text: tx('To pay') + ' ' + bkMoney(FP.total, FP.cur) });
  return { title: tx('Payables'), chips: chips };
}
function fpMount(frame) {
  var node = document.getElementById('screen');
  if (!node) return;
  ftNav();
  node.className = 'screen flush';
  node.innerHTML = fpFrameHTML();
  var num = function (g) {
    return function (a, b) {
      return Number(g(a) || 0) - Number(g(b) || 0);
    };
  };
  FP.api = CBList.mount(document.getElementById('fp_list'), {
    key: 'fin-pay',
    t: tx,
    rows: function () {
      return FP.rows;
    },
    id: function (p) {
      return p.party_id;
    },
    rowTid: function (p) {
      return 'fp-row-' + p.party_id;
    },
    columns: fpCols(),
    defaultCols: ['party', 'due', 'payby', 'offer'],
    cardMax: 4,
    fill: false /* the four age columns are in the ⚙ chooser; a row opens to its ages and bills */,
    head: fpHead,
    state: function () {
      return FP.state;
    },
    error: function () {
      return { title: tx('Could not read what you owe.'), sub: tx('Nothing was lost. Try again.') };
    },
    onRetry: fpRetry,
    empty: { title: tx('You owe no supplier') },
    group: {
      default: 'risk',
      order: ['overdue', 'msme', 'week', 'later'],
      by: function (p) {
        return [tx(FP_GROUPS[p.payable.group] || 'Later'), p.payable.group];
      },
      fig: function (rows) {
        return (
          txn('{count} supplier', '{count} suppliers', rows.length) +
          ' · ' +
          bkMoney(
            rows.reduce(function (total, item) {
              return total + Number(item.payable.total_minor || 0);
            }, 0),
            FP.cur
          )
        );
      },
      headTid: function (k) {
        return 'fp-group-' + k;
      }
    },
    search: function (p) {
      return [p.party_no, p.name, bkPartyLabel(p.party_id, p.name)].join(' ');
    },
    sorts: [
      {
        key: 'risk',
        label: tx('Pay by'),
        cmp: function (a, b) {
          return String(a.payable.pay_by || '9999').localeCompare(String(b.payable.pay_by || '9999'));
        }
      },
      {
        key: 'name',
        label: tx('Name'),
        cmp: function (a, b) {
          return String(a.name || '').localeCompare(String(b.name || ''));
        }
      },
      {
        key: 'due',
        label: tx('To pay'),
        cmp: num(function (p) {
          return p.payable.total_minor;
        })
      }
    ],
    filters: [
      {
        key: 'flag',
        label: tx('Show'),
        all: tx('Every supplier'),
        options: [
          { v: 'msme', label: tx('MSME') },
          { v: 'early', label: tx('Early pay') }
        ],
        match: function (p, v) {
          return v === 'msme' ? !!p.payable.msme : !!p.payable.early;
        }
      }
    ],
    next: fpNext
  });
  if (!frame) fpLoad(FP.rows.length > 0);
}
