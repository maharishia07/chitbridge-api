/* cap-crm-chits.js — THE CHITS BEHIND THE HOME RAIL: In · Out · Stuck, stuck first (black-box H1 · H4 · H10).
 * Home's "24 in · 0 out · 21 stuck" must open the chits it counts. This is the smallest honest list of them: ONE read,
 * GET /api/facts/rail/chits — the SAME rows and the SAME overdue test the Home figures are counted from (lib/home-facts railScope),
 * so the stuck rows here number the stuck chip on Home. Only chits THIS shop holds a copy of are in it; a chit between two other
 * businesses cannot appear. It draws with CBList (the CRM's own list unit) and a row opens the chit sheet in place (openChitSheet);
 * the sheet's "Open page" lands on the chit PAGE below (#/chit/<id>) — the same painters, full-page (CRM2).
 * Nothing is computed here: the reason a chit is stuck is the server's sentence. A stuck row names its fix by opening the sheet,
 * whose action row offers only what this chit allows (accept · answer · close · cancel).
 * Route: CB CRM  #/chits?tab=stuck|in|out. Needs from cap-crm.js: CRM · crmNav · crmBar · crmGo · esc · tx · api · crmErrWords.
 *
 * OWNS      the chits behind the Home rail: In, Out, Stuck (chitsHome, chitPage, chitsLoad, chitsStuckCount, the CHITS state)
 * CALLED BY crm.html (<script src>, line 396) · cap-crm.js (crmRoute: chitsHome on #/chits, chitPage on #/chit/<id>; the nav badge reads CHITS and chitsStuckCount) · the doors that open the route: cap-mis.js (the Open and Stuck rows of its door table link to /crm.html#/chits and ?tab=in|out|stuck) and rail-bell.js (a bell chit opens /crm.html#/chits?open=<id>)
 * FLOW      GET /api/facts/rail/chits -> the list -> each value through fmtMoney in the row's own currency
 * CARD      03-crm-and-parties/home-rail-chits */
'use strict';

var CHITS = { items: [], state: 'loading', err: null, truncated: false, days: 7, api: null, gen: 0 };

function chitsWhen(iso) {
  try {
    return (CBLocale.date(iso, { day: '2-digit', month: 'short' }) || '').trim();
  } catch (_) {
    return String(iso || '').slice(0, 10);
  }
}
/** the age on ONE line: "Today" / "1 d" / "12 d" (the column used to wrap "12 days old" over two lines) */
function chitsAge(c) {
  var d = Math.floor(Number(c.age_days) || 0);
  return d <= 0 ? tx('Today') : d + ' ' + tx('d');
}
function chitsMoney(c) {
  if (c.value == null) return '';
  try {
    return esc(fmtMoney(Number(c.value), c.currency));
  } catch (_) {
    return esc(String(c.value));
  }
}
function chitsWho(c) {
  return (c.tab === 'in' ? tx('From') : tx('To')) + ' ' + (c.self ? tx('your own shop') : c.who || tx('a business'));
}
/** the chit's mini-card (same shape as a party's): the chit · the amount · why it is stuck and what to do; then Open chit */
function chitsMini(c) {
  var key = esc(c.chit_id);
  return (
    '<div class="mc" data-testid="chits-mini-' +
    key +
    '">' +
    crmMiniBox(
      'mc-what',
      'Chit',
      [
        crmMiniRow('chit', '<b>' + esc(c.subject || tx('A chit')) + '</b>'),
        crmMiniKV('Who', esc(chitsWho(c))),
        crmMiniKV('Filed', esc(chitsWhen(c.created_at)) + ' · ' + esc(chitsAge(c)))
      ],
      'chits-mini-chit-' + key
    ) +
    crmMiniBox(
      'mc-money',
      'Amount',
      ['<div class="mc-big">' + (chitsMoney(c) || '<span class="sub">—</span>') + '</div>', crmMiniKV('Direction', esc(c.tab === 'in' ? tx('In') : tx('Out')))],
      'chits-mini-amount-' + key
    ) +
    crmMiniBox(
      'mc-last',
      c.stuck ? 'Why it is stuck' : 'Where it stands',
      [
        c.stuck && c.why
          ? '<div class="mc-r" data-testid="chits-why" style="align-items:flex-start;min-height:0"><span class="v" style="white-space:normal;color:var(--red-text,#8E3517)">' +
            esc(tx(c.why)) +
            '</span></div><div class="mc-r sub" style="white-space:normal;min-height:0;margin-top:6px">' +
            esc(tx('Open it to answer, close or cancel it.')) +
            '</div>'
          : '<div class="mc-r sub" style="white-space:normal">' + esc(tx('Nothing is waiting on you here.')) + '</div>'
      ],
      'chits-mini-why-' + key
    ) +
    '</div>'
  );
}
function chitsStuckCount() {
  return CHITS.items.filter(function (item) {
    return item.stuck;
  }).length;
}

async function chitsLoad() {
  var g = ++CHITS.gen;
  CHITS.state = 'loading';
  chitsRefresh();
  try {
    var reply = await api('railChits');
    if (g !== CHITS.gen) return;
    CHITS.items = Array.isArray(reply) ? reply : (reply && reply.items) || [];
    CHITS.truncated = !!(reply && reply.truncated);
    CHITS.days = (reply && reply.overdue_days) || 7; /* core.js unwrap() collapses a reply to its array when it carries no 'truncated' key */
    CHITS.state = 'ready';
    CHITS.err = null;
  } catch (e) {
    if (g !== CHITS.gen) return;
    CHITS.state = 'error';
    CHITS.err = e;
  }
  crmNav('chits');
  chitsRefresh();
}
function chitsRefresh() {
  var a = CHITS.api;
  if (a && a.el && document.body.contains(a.el)) a.refresh();
}

function chitsCols() {
  return [
    {
      key: 'chit',
      label: 'Chit',
      prio: 1,
      w: 420,
      html: true,
      value: function (c) {
        return c.subject || c.who || '';
      },
      cell: function (c) {
        return (
          '<span class="pcell"><span class="nm">' +
          esc(c.subject || tx('A chit')) +
          '</span>' +
          (c.stuck ? ' <span class="tag late red" data-testid="chits-stuck-tag"><span aria-hidden="true">⚠</span> ' + esc(tx('Stuck')) + '</span>' : '') +
          '</span>'
        );
      }
    },
    {
      key: 'who',
      label: 'From · To',
      prio: 2,
      w: 260,
      value: function (c) {
        return chitsWho(c);
      },
      cell: function (c) {
        return chitsWho(c);
      }
    },
    {
      key: 'dir',
      label: 'In · Out',
      prio: 6,
      w: 90,
      value: function (c) {
        return c.tab === 'in' ? tx('In') : tx('Out');
      },
      cell: function (c) {
        return c.tab === 'in' ? tx('In') : tx('Out');
      }
    },
    {
      key: 'age',
      label: 'Age',
      prio: 3,
      w: 90,
      value: function (c) {
        return c.age_days;
      },
      html: true,
      cell: function (c) {
        return '<span style="white-space:nowrap" data-testid="chits-age">' + esc(chitsAge(c)) + '</span>';
      }
    },
    {
      key: 'when',
      label: 'Filed',
      prio: 4,
      w: 110,
      value: function (c) {
        return c.created_at || '';
      },
      cell: function (c) {
        return chitsWhen(c.created_at);
      }
    },
    {
      key: 'val',
      label: 'Amount',
      prio: 5,
      w: 130,
      html: true,
      value: function (c) {
        return c.value == null ? '' : c.value;
      },
      cell: function (c) {
        return chitsMoney(c) || '<span class="sub">—</span>';
      }
    }
  ];
}
function chitsFilters() {
  /* CRM is about parties: the shop's own counter sales, expenses and credit notes are off by default (a stuck one is never hidden) */
  return [
    {
      key: 'tab',
      label: tx('Show'),
      all: tx('Stuck, in and out'),
      options: [
        { v: 'stuck', label: tx('Stuck') },
        { v: 'in', label: tx('In') },
        { v: 'out', label: tx('Out') },
        { v: 'orders', label: tx('Orders') }
      ],
      match: function (c, v) {
        return v === 'stuck' ? !!c.stuck : v === 'orders' ? !!c.open_order : c.tab === v;
      }
    } /* orders = the ones Home's Orders card counts (the server flags them: the till's own list) */,
    {
      key: 'own',
      label: tx('Whose'),
      all: tx("Include your own shop's chits"),
      options: [{ v: 'party', label: tx('Only chits with another party') }],
      match: function (c) {
        return !c.own || !!c.stuck;
      }
    }
  ];
}
function chitsNotices() {
  var n = chitsStuckCount(),
    out = [];
  if (CHITS.truncated) {
    out.push({ text: tx('This shop holds too many chits to list them here yet.'), cls: 'warn', tid: 'chits-truncated' });
    return out;
  }
  out.push({
    text: n
      ? n +
        ' ' +
        tx(n === 1 ? 'chit is stuck: open for more than' : 'chits are stuck: open for more than') +
        ' ' +
        CHITS.days +
        ' ' +
        tx('days. A chit is not a bill until it is accepted, so Dues, Waiting and Bills do not show it yet. Open one to answer, close or cancel it.')
      : tx('Nothing is stuck.'),
    cls: n ? 'warn' : '',
    tid: 'chits-note'
  });
  return out;
}

function chitsHome(params, frame) {
  crmBar('<strong>' + esc(tx('Chits')) + '</strong>', '', true);
  var node = document.getElementById('screen');
  node.className = 'screen flush';
  node.innerHTML = '<div id="chits_list" data-testid="chits-list"></div>';
  if (CHITS.api && CHITS.api.destroy) {
    try {
      CHITS.api.destroy();
    } catch (_) { /* best effort: failing here changes nothing the user sees */ }
  }
  var tab = params && /^(stuck|in|out|orders)$/.test(params.tab || '') ? params.tab : null;
  CHITS.api = CBList.mount(document.getElementById('chits_list'), {
    key: 'rail-chits',
    t: tx,
    rows: function () {
      return CHITS.items;
    },
    id: function (c) {
      return c.chit_id;
    },
    rowTid: function (c) {
      return 'chits-row-' + c.chit_id;
    },
    columns: chitsCols,
    defaultCols: ['chit', 'who', 'age', 'val'],
    cardMax: 3,
    fill: false,
    head: function () {
      return { title: tx('Chits'), notices: CHITS.state === 'ready' ? chitsNotices() : [] };
    },
    state: function () {
      return CHITS.state;
    },
    error: function () {
      return crmErrWords(CHITS.err, 'your chits');
    },
    onRetry: function () {
      chitsLoad();
    },
    empty: { title: tx('Nothing open'), sub: tx('Every chit you hold has been answered or closed.') },
    search: function (c) {
      return [c.subject, c.who].join(' ');
    },
    searchHint: tx('Subject or business'),
    filters: chitsFilters(),
    preset: { filt: tab ? { tab: tab, own: 'party' } : { own: 'party' } },
    onOpen: function (c) {
      if (typeof openChitSheet === 'function') openChitSheet(c.chit_id);
    },
    next: chitsMini,
    nextPending: chitsMini,
    actions: [
      {
        id: 'open',
        label: tx('Open chit'),
        icon: '↗',
        tid: 'chits-open',
        run: function (c) {
          if (typeof openChitSheet === 'function') openChitSheet(c.chit_id);
        }
      }
    ]
  });
  if (frame) return;
  chitsLoad();
  /* O4: the Home bell sends a pressed row here (crm.html#/chits?open=<chit>) - the order opens to act on, over the list */
  if (params && /^[0-9a-f-]{36}$/i.test(params.open || '') && typeof openChitSheet === 'function') openChitSheet(params.open);
}

/* ═══ THE CHIT PAGE (CRM2, 2026-10-13) — crm.html#/chit/<id>: where the sheet's "Open page" lands, never the workshop (docs/design/INDEX-NOT-APP.md).
   It is the chit sheet's own painters mounted full-page (CBSheet.mount, app/chit-sheet.js): header · lines · GST · total · tender · messages and
   files · history — no second painter, no money worked out here. The crumb leads back to Chits. O2C step 5 · invoice. */
function chitPage(id, frame) {
  crmBar('<a href="#/chits" data-testid="chit-page-back">' + esc(tx('Chits')) + '</a> › <strong>' + esc(tx('Chit')) + '</strong>', '', false);
  var node = document.getElementById('screen');
  node.className = 'screen';
  node.innerHTML = '<div class="content"><div id="chit_page"></div></div>';
  if (frame || !window.CBSheet) return;
  CBSheet.mount(document.getElementById('chit_page'), id);
}
