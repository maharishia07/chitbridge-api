/* cap-finance.js — CB Finance · Collections (round F1): who owes you, how old, the limit, the interest it has earned, Remind, Receive.
 * Loaded by finance.html only (after cap-books.js, list-ctl.js, rail-thread.js). docs: C:/dev/CB-FINANCE-PLAN.md §4 F1.
 *
 * ⭐ REUSE (CLAUDE.md rule 1, named in the PR): CBList.mount (the one list) · bkDuesStore / bkDuesSide / bkDuesAge / bkMoney / bkOwes /
 * bkDate / bkPartyLabel (cap-books.js — the Dues words) · payOpen (THE one payment path: Receive) · bkRemind (M28, through CBThread) ·
 * CBAction (M64) · api('booksDues') — the existing EP row, asked with finance=1.
 * ⭐ ONE CALCULATION (rule 2): this file computes NO money. Balance, oldest due, the limit, over_limit and the interest are the server's
 * (/api/books/dues?finance=1); a row paints them. Interest is SHOWN, never posted (decision). Over a limit the till still lets the owner's
 * PIN through (PIN-allow) — this tab only says it.
 * ⭐ NEW PATHS (rule 4): FIN (the page's state), the batch-Remind sheet (the list's bulk action has no composer of its own: each party's
 * Remind is bkRemind, one after another), the denied card (the server said "owner only" — the sentence, greyed).
 * ⚠️ Never error.message on a screen: a failure says what happened and offers Try again.
 */
/* OWNS CB Finance, Collections: who owes the shop, how old, the limit, Remind, Receive
 * CALLED BY finance.html (after cap-books.js, list-ctl.js, rail-thread.js)
 * FLOW GET dues -> FIN.cur from the reply, else the books money -> CBList rows -> bkMoney / bkOwes
 * CARD 16-finance/cb-finance */
'use strict';

var FIN = { gen: 0, rows: [], cur: null, state: 'loading', err: null, api: null, queue: null, back: null, unbilled: null, fu: null };
/* WALK2 W36 (FIN-2): the open orders no bill names yet — GET /api/work/facts?unbilled=1 (lib/work-rows unbilledOf, open-orders' ONE billed test).
   An order is a promise and never posts, so the ledger's "Nobody owes you" was true and still misled: the promise is said BESIDE the dues, never in them. */
var FIN_EP = { workFacts: { m: 'GET', p: '/api/work/facts', ok: 'y' } }; /* the Home box's read (manifest rail.facts), with ?unbilled=1 */
Object.assign(EP, FIN_EP);
var FIN_OWNER_ONLY = 'Only the owner may see collections.';

function finOwes(p) {
  return Number(p.balance_minor) > 0;
}
/** the unbilled orders in words: "1 order unpaid, not yet billed ₹420" (no figure when the orders are in two currencies — the server says null) — '' when none */
function finUnbilledWords(unbilled) {
  if (!unbilled || !Number(unbilled.n)) return '';
  return (
    txn('{count} order unpaid, not yet billed', '{count} orders unpaid, not yet billed', Number(unbilled.n)) +
    (unbilled.minor == null ? '' : ' ' + bkMoney(Number(unbilled.minor), unbilled.currency || FIN.cur))
  );
}
/** the dues (the server's, finance=1) and, beside them in parallel, the unbilled orders into FIN.unbilled — a failure there leaves the line out, never a guessed 0 */
async function finDuesRead() {
  var unbilledAsk = api('workFacts', { query: { unbilled: '1' } }).then(
    function (facts) {
      return (facts && facts.figures && facts.figures.unbilled) || null;
    },
    function () {
      return null;
    }
  );
  var dues = await api('booksDues', { query: { finance: '1' } });
  FIN.unbilled = await unbilledAsk;
  FIN.fu = (dues && dues.follow_up_total) || null; /* FIN-72: the server's follow-up total; absent = the old look */
  return dues;
}

async function finLoad(quiet) {
  if (finTab() === 'terms') return ftLoad(quiet); /* the Terms tab (cap-finance-terms.js) */
  if (finTab() === 'cash') return fcLoad(quiet); /* the Cash tab (cap-finance-cash.js, F3) */
  if (finTab() === 'repeat') return rpLoad(quiet); /* the Repeat supply tab (cap-repeat.js, RI1) */
  if (finTab() === 'pay') return fpLoad(quiet); /* the Payables tab (cap-finance-pay.js, F4) */
  if (finTab() === 'cheques') return fqLoad(quiet); /* the Cheques tab (cap-finance-cheques.js, T3-P1-MONEY) */
  if (finTab() === 'returns') return frLoad(quiet); /* the Returns tab (cap-finance-returns.js, T3-P1-MONEY) */
  if (finTab() === 'reports') return fmLoad(quiet); /* the Reports tab (cap-mis.js, T3-P4-ACCOUNT) */
  var generation = ++FIN.gen;
  if (!quiet) {
    FIN.state = 'loading';
    if (FIN.api) FIN.api.refresh();
  }
  try {
    var dues = await finDuesRead();
    if (generation !== FIN.gen) return;
    bkDuesStore(dues);
    FIN.cur = (dues && dues.currency) || bkCur();
    if (dues && dues.currency && typeof SESSION !== 'undefined' && SESSION)
      SESSION.currency = dues.currency; /* CX0: the ledger's currency reaches Receive / Pay (finance.html sets none) */
    FIN.rows = ((dues && dues.parties) || []).filter(function (item) {
      return bkDuesSide(item) === 'rcv' && finOwes(item);
    });
    FIN.state = 'ready';
    FIN.err = null;
    ftNav(); /* the tabs' words again, now the language pack has had the boot to land */
  } catch (e) {
    if (generation !== FIN.gen) return;
    if (e && e.status === 404) {
      finOff();
      return;
    } /* the Ledger is off for this shop (M212) */
    FIN.state = e && e.status === 403 ? 'denied' : 'error';
    FIN.err = e;
    if (FIN.state === 'denied') {
      finDenied();
      return;
    }
  }
  if (FIN.api) FIN.api.refresh();
}
function finRetry() {
  finLoad();
}

/** M212 - the Ledger is off (books answer 404): one sentence and the owner's switch (CBLedger, the same words, confirm and call as CB Accounts and Settings);
 *  anyone else sees it greyed with whom to ask - the server refuses a non-owner anyway. Both tabs (Collections, Terms) land here. */
function finOff() {
  var node = document.getElementById('screen');
  if (!node) return;
  var owner = typeof SESSION !== 'undefined' && SESSION && SESSION.role === 'entity';
  node.className = 'screen';
  node.innerHTML =
    '<div class="card" data-testid="fin-off"><h2>' +
    esc(tx('Your ledger is off')) +
    '</h2>' +
    '<button data-cbsid="FIN001-B03" type="button" class="act" id="fin_on" data-testid="fin-turn-on"' +
    (owner ? '' : ' disabled aria-disabled="true"') +
    '>' +
    esc(tx('Turn on')) +
    '</button>' +
    (owner ? '' : '<p data-testid="fin-off-why">' + esc(tx('Ask the owner to switch it on')) + '</p>') +
    '</div>';
  var switchOn = document.getElementById('fin_on');
  if (owner)
    switchOn.onclick = function () {
      CBLedger.run(true, {
        ask: confirmAsk,
        working: function () {
          switchOn.disabled = true;
          switchOn.textContent = tx('Working…');
        },
        call: function (on) {
          return CBLedger.call({ api: api }, on);
        },
        done: function () {
          start();
        },
        failed: function (e) {
          switchOn.disabled = false;
          switchOn.textContent = tx('Turn on');
          toast(tx('Could not switch it on.') + ' ' + (e && e.status === 403 ? tx('Only the owner may do this.') : tx('Try again.')));
        }
      });
    };
}

/** the server said who may see it: the sentence, greyed, and no list — the server refuses anyway. `why`: another tab's sentence (Cash, F3); Collections' by default. `title`: that tab's name (Payables, F4) */
function finDenied(reason, title) {
  var node = document.getElementById('screen');
  if (!node) return;
  node.className = 'screen';
  node.innerHTML =
    '<div class="card" data-testid="fin-denied" style="opacity:.75"><h2>' +
    esc(tx(title || (reason ? 'Cash position' : 'Collections'))) +
    '</h2><p data-testid="fin-denied-why">' +
    esc(tx(reason || FIN_OWNER_ONLY)) +
    '</p></div>';
}

/** "Not set" for a term no one has set (FIN-R1) — the hint says where it is set: CB Finance › Terms, the one place */
function finNotSet(what) {
  return '<span data-b="' + what + '-unset" style="color:var(--grey)" title="' + esc(tx('Set it in Terms')) + '">' + esc(tx('Not set')) + '</span>';
}

/** R76: the early-pay offer the customer's Terms make, in rupees, under the due figure — the server's figures and words (books-engines.earlyOffer); '' when none holds */
function finEarlyHTML(party) {
  return party.early && party.early.valid ? '<div data-b="early" style="font-size:var(--fs-1);color:var(--grey)">' + esc(party.early.words || '') + '</div>' : '';
}
/* ── FIN-72 · the follow-up view: days past the due date. Every figure and every code is the server's (follow_up, follow_up_total); this file only paints them ── */
/** the server's four late buckets (follow_up keys) in order, with the words the chips, the filter and the Age column share — cap-books.js BK_FOLLOW, the one list Receivables, Payables and the Day book chip read too (W15-94) */
var FIN_AGES = BK_FOLLOW.slice(1);
/** the words of one follow-up code, or '' for a code this screen does not know */
function finAgeWord(code) {
  return bkFollowWord(code);
}
/** the Age column's tail for a row: the oldest late bucket, else "Current" when it holds money, else '' — bkDuesAge, the one reader */
function finAgeTail(party) {
  return bkDuesAge(party);
}
/** the head's chips: each late bucket's money, then "Current" apart (the server's follow_up_total, in the books' money unit) — none when the server sent none */
function finAgeChips() {
  var total = FIN.fu;
  if (!total) return [];
  var chips = FIN_AGES.map(function (item) {
    return { tid: 'fin-age-' + item[0], text: tx(item[1]) + ' ' + bkMoney(Number(total[item[0]] || 0), FIN.cur) };
  });
  chips.push({ tid: 'fin-age-not_due', text: bkFollowWord('not_due') + ' ' + bkMoney(Number(total.not_due || 0), FIN.cur) });
  return chips;
}
/** the note when a bill had no due date and the shop has no credit days (the server's terms code 'not_set'): it opens Terms, where days are set */
function finTermsNotice() {
  if (!FIN.fu || FIN.fu.terms !== 'not_set') return [];
  return [
    {
      cls: 'warn',
      tid: 'fin-set-terms',
      text: tx('Set your credit days'),
      onOpen: function () {
        location.hash = '#terms';
      }
    }
  ];
}
/** the "Show" filter: over limit, overdue, then each late bucket (a row's worst, the server's code) */
function finFilterOptions() {
  return [
    { v: 'over', label: tx('Over limit') },
    { v: 'late', label: tx('Overdue') }
  ].concat(
    FIN_AGES.map(function (item) {
      return { v: item[0], label: tx(item[1]) };
    })
  );
}
function finFilterMatch(party, value) {
  if (value === 'over') return !!party.over_limit;
  if (finAgeWord(value)) return !!party.follow_up && party.follow_up.worst === value;
  if (party.follow_up) return !!party.follow_up.worst; /* W15-94: overdue is the one ageing's word, the same as the Day book chip */
  return Number(party.interest_minor) > 0 || (party.oldest_due && party.oldest_due < bkToday());
}
/* ── the columns: every figure is the server's ── */
function finCols() {
  var currencyOf = function () {
    return FIN.cur;
  };
  var dash = '<span style="color:var(--grey)">—</span>';
  return [
    {
      key: 'party',
      label: tx('Party'),
      prio: 1,
      sort: 'name',
      w: 220,
      html: true, stretch: true /* l16: the party name takes the free width (it wrapped to 6 lines at 62 px while Age took it) */,
      cell: function (p) {
        return esc(bkPartyLabel(p.party_id, p.name));
      }
    },
    {
      key: 'due',
      label: tx('To collect'),
      prio: 2, keep: true,
      sort: 'due',
      num: true,
      w: 140,
      html: true,
      cell: function (p) {
        return '<b data-b="balance">' + esc(bkMoney(Number(p.balance_minor), currencyOf())) + '</b>' + finEarlyHTML(p);
      }
    },
    {
      key: 'age',
      label: tx('Age'),
      prio: 3, keep: true,
      sort: 'oldest',
      w: 150,
      html: true,
      cell: function (p) {
        var ag = finAgeTail(p);
        var ageSpan = ag ? '<span data-b="age" title="' + esc(tx('Days past the due date')) + '" style="color:var(--grey);white-space:nowrap">' + (p.oldest_due ? '· ' : '') + esc(ag) + '</span>' : '';
        // no overdue bill but money owed later still says so ("Current"), never a bare dash (FIN-72, walk F15)
        if (!p.oldest_due) return ageSpan || dash;
        return '<span data-b="due">' + esc(bkDate(p.oldest_due)) + '</span> ' + ageSpan;
      }
    },
    {
      key: 'limit',
      label: tx('Limit'),
      prio: 4, keep: true /* 17 Nov: a money column is never left out for width (the list squeezes the others); the Limit and the Interest are why the page exists */,
      sort: 'limit',
      num: true,
      w: 140,
      html: true,
      cell: function (p) {
        /* FIN-R1: the server's code says where the limit came from (party · shop) — null = no limit set anywhere, said in words */
        if (p.credit_limit_minor == null) return p.credit_limit_from === null ? finNotSet('limit') : dash;
        return (
          '<span data-b="limit">' +
          esc(bkMoney(Number(p.credit_limit_minor), currencyOf())) +
          '</span>' +
          (p.over_limit ? ' <span class="tag red" data-b="over">⚠ ' + esc(tx('Over limit')) + '</span>' : '')
        );
      }
    },
    {
      key: 'interest',
      label: tx('Interest due'),
      prio: 5, keep: true,
      sort: 'interest',
      num: true,
      w: 140,
      html: true,
      cell: function (p) {
        /* FIN-R1: interest follows the customer's Terms; interest_state (on · off · not_set) is the server's code — never a guessed rate */
        if (p.interest_state === 'not_set') return finNotSet('interest');
        if (p.interest_state === 'off') return '<span data-b="interest-off" style="color:var(--grey)">' + esc(tx('Off')) + '</span>';
        return Number(p.interest_minor) > 0
          ? '<span data-b="interest" title="' + esc(tx('Shown, never charged')) + '">' + esc(bkMoney(Number(p.interest_minor), currencyOf())) + '</span>'
          : dash;
      }
    },
    {
      key: 'last',
      label: tx('Last reminded'),
      prio: 6,
      w: 120,
      html: true,
      cell: function (p) {
        return p.last_remind ? esc(bkDate(p.last_remind)) : dash;
      }
    },
    {
      key: 'act',
      label: ' ',
      prio: 1,
      pin: 'end',
      w: 130,
      html: true,
      cell: function (p) {
        var id = esc(p.party_id);
        return (
          '<span data-cbsid="FIN001-C01" style="display:inline-flex;gap:6px" onclick="event.stopPropagation()">' +
          '<button type="button" data-cbsid="CMP042-B01"' + bkMountAttribute('CMP042') + ' class="cbl-tbtn" data-testid="fin-receive-' +
          id +
          "\" onclick=\"event.stopPropagation();payOpen('customer','" +
          id +
          "'," +
          esc(JSON.stringify(String(p.name || ''))) +
          ')">' +
          esc(tx('Receive')) +
          '</button>' +
          '<button type="button" data-cbsid="CMP042-B03"' + bkMountAttribute('CMP042') + ' class="cbl-tbtn" data-testid="fin-remind-' +
          id +
          '" onclick="event.stopPropagation();bkRemind(\'' +
          id +
          '\',this)">' +
          esc(tx('Remind')) +
          '</button></span>'
        );
      }
    }
  ];
}

function finMount(frame) {
  var node = document.getElementById('screen');
  if (!node) return;
  if (finTab() === 'terms') return ftMount(frame); /* the Terms tab (cap-finance-terms.js) */
  if (finTab() === 'cash') return fcMount(frame); /* the Cash tab (cap-finance-cash.js, F3) */
  if (finTab() === 'repeat') return rpMount(frame); /* the Repeat supply tab (cap-repeat.js, RI1) */
  if (finTab() === 'pay') return fpMount(frame); /* the Payables tab (cap-finance-pay.js, F4) */
  if (finTab() === 'cheques') return fqMount(frame); /* the Cheques tab (cap-finance-cheques.js, T3-P1-MONEY) */
  if (finTab() === 'returns') return frMount(frame); /* the Returns tab (cap-finance-returns.js, T3-P1-MONEY) */
  if (finTab() === 'reports') return fmMount(frame); /* the Reports tab (cap-mis.js, T3-P4-ACCOUNT) */
  ftNav();
  node.className = 'screen flush';
  node.innerHTML = '<div id="fin_list" data-testid="fin-list" style="flex:1 1 auto;min-height:0"></div>';
  var num = function (g) {
    return function (a, b) {
      return Number(g(a) || 0) - Number(g(b) || 0);
    };
  };
  FIN.api = CBList.mount(document.getElementById('fin_list'), {
    key: 'fin-collect',
    t: tx,
    rows: function () {
      return FIN.rows;
    },
    id: function (p) {
      return p.party_id;
    },
    rowTid: function (p) {
      return 'fin-row-' + p.party_id;
    },
    columns: finCols(),
    defaultCols: ['party', 'due', 'age', 'limit', 'interest', 'last'],
    cardMax: 4,
    fill: false,
    head: function () {
      var said = finUnbilledWords(FIN.unbilled);
      return {
        title: tx('Collections'),
        chips: finAgeChips(),
        notices: finTermsNotice().concat(
          said
            ? [
                {
                  cls: 'warn',
                  tid: 'fin-unbilled',
                  text: said,
                  onOpen: function () {
                    location.href = '/tasks.html';
                  }
                }
              ]
            : []
        )
      };
    },
    state: function () {
      return FIN.state;
    },
    error: function () {
      return { title: tx('Could not read who owes you.'), sub: tx('Nothing was lost. Try again.') };
    },
    onRetry: finRetry,
    empty: function () {
      var said = finUnbilledWords(FIN.unbilled);
      return { title: tx('Nobody owes you money'), sub: said ? said + ' — ' + tx('bill it to collect') : '' };
    },
    group: {
      default: 'over',
      order: ['over', 'coll'],
      by: function (p) {
        return p.over_limit ? [tx('Over limit'), 'over'] : [tx('To collect'), 'coll'];
      },
      fig: function (rows) {
        return (
          txn('{count} party', '{count} parties', rows.length) +
          ' · ' +
          bkOwes(
            rows.reduce(function (total, item) {
              return total + Number(item.balance_minor || 0);
            }, 0),
            FIN.cur
          )
        );
      },
      headTid: function (k) {
        return 'fin-group-' + k;
      }
    },
    search: function (p) {
      return [p.party_no, p.name, bkPartyLabel(p.party_id, p.name)].join(' ');
    },
    sorts: [
      {
        key: 'name',
        label: tx('Name'),
        cmp: function (a, b) {
          return String(a.name || '').localeCompare(String(b.name || ''));
        }
      },
      {
        key: 'due',
        label: tx('To collect'),
        cmp: num(function (p) {
          return p.balance_minor;
        })
      },
      {
        key: 'oldest',
        label: tx('Oldest due'),
        cmp: function (a, b) {
          return String(a.oldest_due || '9999').localeCompare(String(b.oldest_due || '9999'));
        }
      },
      {
        key: 'limit',
        label: tx('Limit'),
        cmp: num(function (p) {
          return p.credit_limit_minor;
        })
      },
      {
        key: 'interest',
        label: tx('Interest due'),
        cmp: num(function (p) {
          return p.interest_minor;
        })
      }
    ],
    filters: [
      {
        key: 'flag',
        label: tx('Show'),
        all: tx('Everyone'),
        options: finFilterOptions(),
        match: finFilterMatch
      }
    ],
    next: function (p) {
      return bkDuesNext(p, FIN.cur, 'fin-collect'); /* R76: the statement read repaints THIS list */
    },
    bulk: [{ id: 'remind', label: tx('Remind'), run: finRemindQueue }]
  });
  if (!frame) finLoad(FIN.rows.length > 0);
}

/* ── batch Remind: the chosen parties, each one's Remind (bkRemind, M28) in turn; the sheet comes back after each ── */
function finRemindQueue(rows) {
  FIN.queue = (rows || []).map(function (item) {
    return { id: item.party_id, name: bkPartyLabel(item.party_id, item.name), minor: Number(item.balance_minor), done: false };
  });
  if (FIN.queue.length) finQueueSheet();
}
function finQueueSheet() {
  var list = FIN.queue || [],
    left = list.filter(function (x) {
      return !x.done;
    }).length;
  ui.dialog({
    mount: 'FIN001-U01',
    pop: 'POP107',
    titleText: tx('Remind') + ' · ' + txn('{count} party', '{count} parties', list.length),
    titleTestid: 'fin-queue-title',
    body:
      list
        .map(function (x, index) {
          return (
            '<div class="result" data-testid="fin-queue-' +
            esc(x.id) +
            '"><span><b>' +
            esc(x.name) +
            '</b><span class="k">' +
            esc(bkMoney(x.minor, FIN.cur)) +
            '</span></span>' +
            (x.done
              ? '<span class="tag green">✓ ' + esc(tx('Asked')) + '</span>'
              : '<button data-cbsid="FIN001-B04" type="button" class="act sm" data-testid="fin-queue-go-' +
                esc(x.id) +
                '" onclick="finRemindOne(' +
                index +
                ',this)">' +
                esc(tx('Remind')) +
                '</button>') +
            '</div>'
          );
        })
        .join(''),
    footerHtml: '<button data-cbsid="FIN001-B05" type="button" onclick="closeModal()">' + esc(left ? tx('Close') : tx('Done')) + '</button>'
  });
}
function finRemindOne(i, btn) {
  var x = (FIN.queue || [])[i];
  if (!x) return;
  x.done = true;
  FIN.back = finQueueSheet; /* the sheet returns when this party's message is closed */
  return bkRemind(x.id, btn);
}
