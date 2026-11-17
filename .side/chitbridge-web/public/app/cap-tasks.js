/**
 * cap-tasks.js — TO1-UI: TASKS & ORDERS AS A STANDALONE APP (tasks.html; tasks.html?embed=1 is the same screen as a frame).
 * Owner decision 2026-10-10: Tasks & Orders is its own app, the API fully apart from the screen. Every request kind is a chit with lines;
 * the workflow (states, transitions), task-level and LINE-level assignment and per-line settings are the SERVER's answers — this file paints them.
 *
 * ONE list (CBList) — one line per order or task: what · where it stands · who has it · amount · age · lines; filters by kind · state · who;
 * the folders (Orders in · Orders out · Tasks · Done) are the engine's tabs (CBWorkflow.tabs, engines `workflow`) and the page's sidebar sections.
 * ONE sheet per row — the header, the next steps, the lines with their own state and assignee, the thread. Which steps are open is the SERVER's
 * answer (GET /api/work/:id → actions.<step> { ok, why, say }, per this login): a refused step is drawn greyed WITH its sentence; the writing
 * route refuses the same way (lib/workflow over lib/rail, both sides). This file decides nothing about who may do what.
 *
 * REUSE (named in the PR): CBList (list-ctl.js) · CBAction (accounts-shell.js, M64: one press one write · ask before an irreversible one · say
 * the outcome) · CBThread (rail-thread.js: the ONE composer + list for a chit's messages) · bkMoney (cap-books.js, M36: minor units → the
 * shop's figure, never arithmetic here) · api()/EP (core.js: the endpoint registry the round-trip budget reads) · CBWorkflow (app/workflow.js,
 * adopted: tabs · stages words) · CBEmbed's handshake (embed-host.js) · the routes that already do the work, none new:
 *   PUT  /api/chits/:id/status        (CB_SHEET_EP.status)  — moveStatus, the ONE status writer; a step = CBWorkflow.STEP_TO[action]
 *   POST /api/chits/:id/assign-lines  (CB_SHEET_EP.wlAssign)  — who holds a LINE and its state open · done (lib/assign, b143 + b153)
 *   POST /api/chits/:id/deliver-lines (CB_SHEET_EP.wlDeliver) — what has gone out on a line (lib/deliverline, b144); ONE name per endpoint
 *                                                               (e2e/ep-aliases.cjs): the worklist's rows, read here, never a third name
 *   PUT  /api/actors/assign/:id       (assign, as app.html) — who holds the whole task: push <person> · return
 *   GET  /api/work/list · /api/work/:id · GET /api/people  — the rows, the sheet, the people to pick from
 *   GET  /api/facts/rail/chits        (CB_SHEET_EP.railChits, the CRM's name) — stuck + why: the SERVER's overdue test, the same rows and clock as Home's rail chips
 * Flow steps (docs/process/flows.json): O2C step 3 · order (tkList, tkOpen) · O2C step 4 · delivery (tkMove, tkAssignLine, tkDeliver) ·
 *   O2C step 5 · invoice (tkBill: hands the order to the till's ONE bill path, orderToBill — never a second bill here).
 *
 * NEW PATHS (rule 4): CBTasks (this screen: nothing drew the work rows, the lines' state + assignee and the server's verdicts together) ·
 *   ageWord (age_days → "Today" / "3 d": cap-crm-chits.js chitsAge reads the same field but lives inside the CRM's screen file and its globals) ·
 *   markStuck (TO1b: the rail's stuck + why joined onto the work rows — cap-crm-chits reads the same route for its own rows, inside the CRM's screen).
 *
 * TO1b (the designer brief, docs/design/tasks-orders/REQUIREMENT.md): a row says 🌐 Online · Delivery / Pick up · customer · ₹ · asked-for · address ·
 * remark · age; Stuck / Billed / Sent out are marks beside the stage word; Accept → Bill it → Delivered / Handed over; ＋ New is app.html's Compose.
 *
 * EMBED (?embed=1[&view=orders_in|orders_out|tasks|done]): the same screen with no frame, for a host page to open in a dialog (embed-host.js).
 * The page tells its host what happened — docs/design/tasks-orders/EMBED.md:
 *   window.parent.postMessage({ cb: 'tasks', event: 'open' | 'moved' | 'assigned' | 'bill' | 'close', chit_id, ... }, location.origin)
 *
 *   CBTasks.mount(el, { token, base, embed, view, onEnded }) → { reload, show(view) }
 *
 * OWNS      CBTasks: mount · VIEWS · EP · actRow (a step button greyed with the server's why) — Tasks and Orders as a standalone app
 * CALLED BY tasks.html (<script src>; CBTasks.mount and VIEWS, also as tasks.html?embed=1 in a frame) · app/cap-dispute.js and app/cap-assist.js (CBTasks.actRow)
 * FLOW      CBList rows from the work API → the sheet → amounts through bkMoney in the chit's own currency
 * CARD      05-orders-and-workflow/tasks-and-orders
 */
(function (root) {
  'use strict';
  /* the registry rows this screen adds (the scanner tools/endpoint-usage.cjs reads this shape); status · chit · wlAssign · wlDeliver · railChits come from CB_SHEET_EP, messages · sendMsg from CB_THREAD_EP */
  var CB_WORK_EP = {
    workList: { m: 'GET', p: '/api/work/list', ok: 'y' }, // ?view=&limit=
    workOne: { m: 'GET', p: '/api/work/:id', ok: 'y' },
    assign: { m: 'PUT', p: '/api/actors/assign/:id', ok: 'y' }, // { action: 'push', target_actor_id } · { action: 'return' }
    people: { m: 'GET', p: '/api/people', ok: 'y' }
    /* railChits (GET /api/facts/rail/chits: stuck + why, the server's overdue test) comes from CB_SHEET_EP — one name, registered once (TO1b) */
  };
  root.CB_WORK_EP = CB_WORK_EP;

  var VIEWS = ['orders_in', 'orders_out', 'tasks', 'done']; /* the views GET /api/work/list answers (drafts wait for the compose route) */
  var LIMIT = 100; /* one read takes the first hundred rows of a folder (PAGE_MAX) */
  var board = { el: null, o: {}, view: 'orders_in', rows: [], counts: null, total: 0, truncated: false, list: null, people: null, open: null, thread: null };

  function T(words) {
    return typeof root.tx === 'function' ? root.tx(words) : words;
  }
  /** an amount as the page says it: the figure; "hidden" when the server took the money off this read for a cost-blind co-assist (RAIL-146b, cost_hidden); '' when the row has none */
  function moneyWord(minor, currency, hidden) {
    if (minor != null) return root.bkMoney(minor, currency);
    return hidden ? T('hidden') : '';
  }
  function $(id) {
    return root.document.getElementById(id);
  }
  function WF() {
    return root.CBWorkflow;
  }

  function ensureEP() {
    if (typeof EP === 'undefined' || !EP) return false;
    [root.CB_SHEET_EP, root.CB_THREAD_EP, CB_WORK_EP].forEach(function (set) {
      if (set) for (var name in set) if (!EP[name]) EP[name] = set[name];
    });
    /* ＋ New task sends through the chit send, under app.html's name for it (one name per endpoint — as rail-advice.js registers it) */
    if (!EP.createChit) EP.createChit = { m: 'POST', p: '/api/chits/send', ok: '✓' };
    return true;
  }
  /** the one call: core.js api() (auth · the registry · a server refusal keeps its words and its status for CBAction.words) */
  function call(key, opts) {
    ensureEP();
    return root.api(key, opts);
  }

  /** a failure this screen survives, said in words in the page log (cblog) instead of swallowed */
  function logFailure(what, failure) {
    if (typeof root.cblog === 'function') root.cblog('warn', 'tasks: ' + what + ' — ' + ((failure && failure.message) || 'no answer'));
  }
  /** what a host page hears (embed only) */
  function tell(event, more) {
    if (!board.o.embed || !root.parent || root.parent === root) return;
    try {
      root.parent.postMessage(Object.assign({ cb: 'tasks', event: event }, more || {}), root.location.origin);
    } catch (failure) {
      logFailure('the host page was not told ' + event, failure); // the screen works on without the host; only its badge stays stale
    }
  }

  /* ── words ── */
  var KIND_WORD = { order_in: 'Order in', order_out: 'Order out', task: 'Task' };
  /* the brief's words (REQUIREMENT §4): an order in is Delivered / Handed over, never "Complete"; an order out is Received; a task is Done */
  var STEP_LABEL = {
    accept: { order: 'Accept', task: 'Start' },
    reject: { order: 'Reject', task: 'Reject' },
    complete: { order: 'Delivered', task: 'Done' },
    cancel: { order: 'Cancel', task: 'Cancel' },
    reopen: { order: 'Reopen', task: 'Reopen' }
  };
  var STEP_SAID = { accept: 'Accepted.', reject: 'Rejected.', complete: 'Done.', cancel: 'Cancelled.', reopen: 'Reopened.' };
  var STEPS = ['accept', 'reject', 'complete', 'cancel', 'reopen'];
  function stepLabel(step, row) {
    if (step === 'complete' && row.kind === 'order_in') return T(row.fulfilment === 'pickup' ? 'Handed over' : 'Delivered');
    if (step === 'complete' && row.kind === 'order_out') return T('Received');
    return T(STEP_LABEL[step][row.kind === 'task' ? 'task' : 'order']);
  }
  function stepSaid(step, row) {
    return step === 'complete' && row.kind !== 'task' ? stepLabel(step, row) + '.' : T(STEP_SAID[step]);
  }
  function ageWord(stamp) {
    stamp = Math.floor(Number(stamp) || 0);
    return stamp <= 0 ? T('Today') : stamp + ' ' + T('d');
  }
  /* the symbols the bell already uses for an order (rail-bell.js O3): 🌐 Online · Delivery / Pick up — a symbol beats a sentence (SYSTEM §1) */
  var CHANNEL_WORD = { online: '🌐 Online', rail: '⇄ Rail', counter: '▤ Counter' };
  var FULFIL_WORD = { delivery: 'Delivery', pickup: 'Pick up' };
  function channelWord(row) {
    return row.channel ? T(CHANNEL_WORD[row.channel] || row.channel) : '';
  }
  function fulfilWord(row) {
    return row.fulfilment ? T(FULFIL_WORD[row.fulfilment] || row.fulfilment) : '';
  }
  function howWord(row) {
    return [channelWord(row), fulfilWord(row)].filter(Boolean).join(' · ');
  }
  /** the asked-for time, in the shop's own date words (CBLocale.date; the raw ISO day when the locale unit is not on the page) */
  function forWord(row) {
    if (!row.requested_for) return '';
    try {
      return (root.CBLocale && root.CBLocale.date(row.requested_for, { day: 'numeric', month: 'short' })) || String(row.requested_for).slice(0, 10);
    } catch (_) {
      return String(row.requested_for).slice(0, 10);
    }
  }
  /** the marks the server keeps beside the stage word: billed (the counter bill exists) · sent out (despatched) · stuck (the rail's overdue test, with its why) */
  function marksHTML(row) {
    var list = [];
    if (row.stuck)
      list.push('<span class="tag red" data-testid="tk-stuck-' + esc(row.chit_id) + '" title="' + esc(row.stuck_why || '') + '">' + esc(T('Stuck')) + '</span>');
    if (row.billed) list.push('<span class="tag" data-testid="tk-billed-' + esc(row.chit_id) + '">' + esc(T('Billed')) + '</span>');
    if (row.despatched && row.stage !== 'delivered' && row.stage !== 'closed') list.push('<span class="tag">' + esc(T('Sent out')) + '</span>');
    return list.join(' ');
  }
  function toneOf(row) {
    return row.stage === 'new' ? 'amber' : row.stage === 'closed' ? '' : 'green';
  }
  function wordTag(row) {
    return '<span class="tag ' + toneOf(row) + '" data-testid="tk-word-' + esc(row.chit_id) + '">' + esc(T(row.word || '')) + '</span>';
  }
  function wordCell(row) {
    var marks = marksHTML(row);
    return wordTag(row) + (marks ? ' ' + marks : '');
  }
  function whoWord(row) {
    if (row.lines_assigned_n) return row.lines_assigned_n + ' ' + T(row.lines_assigned_n === 1 ? 'line held' : 'lines held');
    return row.assignee && row.assignee.name ? row.assignee.name : T('No one');
  }
  function linesWord(row) {
    if (row.lines_n == null) return '';
    if (!row.lines_n) return T('No lines');
    return row.lines_open_n ? row.lines_open_n + ' ' + T('of') + ' ' + row.lines_n + ' ' + T('open') : row.lines_n + ' ' + T('delivered');
  }
  function sayOf(value) {
    return value ? value.say || value.why || '' : '';
  }
  function byId(id) {
    return (
      board.rows.filter(function (item) {
        return item.chit_id === id;
      })[0] || null
    );
  }

  /* ── the read ── */
  function load() {
    return call('workList', { query: { view: board.view, limit: LIMIT } }).then(function (reply) {
      reply = reply || {};
      board.rows = Array.isArray(reply.rows) ? reply.rows : [];
      board.counts = reply.counts || null;
      board.total = reply.total == null ? board.rows.length : reply.total;
      board.truncated = !!reply.truncated;
      return markStuck().then(function () {
        return reply;
      });
    });
  }
  /**
   * stuck = the SERVER's overdue test (GET /api/facts/rail/chits: lib/home-facts railChits, the same rows and clock as Home's rail chips) with its
   * `why` in a shopkeeper's words — this page compares no dates (SYSTEM §3 rule 12). Orders only (a task is the shop's own note, never stuck);
   * a truncated shop or a failed read marks nothing, never a wrong row.
   */
  function markStuck() {
    if (board.view !== 'orders_in' && board.view !== 'orders_out') return Promise.resolve();
    return call('railChits').then(
      function (reply) {
        var by = {},
          items = Array.isArray(reply)
            ? reply
            : (reply && reply.items) || []; /* core.js unwrap() collapses the reply to its array, as cap-crm-chits reads it */
        items.forEach(function (x) {
          if (x && x.stuck) by[x.chit_id] = x.why || T('Waiting too long');
        });
        board.rows.forEach(function (item) {
          item.stuck = !!by[item.chit_id];
          item.stuck_why = by[item.chit_id] || null;
        });
      },
      function () {}
    );
  }
  function reload() {
    return load().then(
      function () {
        paintBar();
        mountList($('tk_list'));
      },
      function (e) {
        paintFail(e);
      }
    );
  }
  function paintFail(e) {
    if (!board.el) return;
    var refused = e && e.status === 403;
    board.el.innerHTML =
      '<div class="empty" data-testid="tk-fail"><div class="t">' +
      esc(T(refused ? 'This sign-in cannot open this' : "Couldn't read your orders")) +
      '</div>' +
      '<button data-cbsid="TSK003-B01" type="button" class="act" id="tk_retry" data-testid="tk-retry">' +
      esc(T('Try again')) +
      '</button></div>';
    $('tk_retry').onclick = function () {
      start();
    };
  }

  /* ── an action drawn the one way: shown always; greyed with the server's sentence when it may not (as cap-employees) ── */
  function actRow(id, label, verdict, extra, className, stampCode) {
    var ok = !verdict || verdict.ok !== false;
    return (
      '<div class="tk-act' +
      (ok ? '' : ' no') +
      '">' +
      '<button data-cbsid="' +
      stampCode +
      '" type="button" class="act ' +
      (className || 'quiet') +
      '" id="' +
      id +
      '" data-testid="' +
      id +
      '"' +
      (ok ? '' : ' aria-disabled="true" disabled') +
      ' title="' +
      esc(ok ? label : sayOf(verdict)) +
      '">' +
      esc(label) +
      '</button>' +
      (ok ? extra || '' : '<span class="why" data-testid="' + id + '-why">' + esc(sayOf(verdict)) + '</span>') +
      '</div>'
    );
  }

  /* ── the list (O2C step 3 · order: the rows the seller works) ── */
  function tkList() {
    return board.rows;
  }
  function cols() {
    return [
      /* the row the brief asks for (§4): 🌐 Online · Delivery / Pick up · customer · ₹ total · asked-for time · address · remark · age · items */
      {
        key: 'what',
        label: T('What'),
        prio: 1,
        w: 260,
        sort: 'what',
        html: true,
        value: function (row) {
          return row.subject || '';
        },
        cell: function (row) {
          var howText = howWord(row);
          return (
            '<b>' +
            esc(row.subject || T('Untitled')) +
            '</b>' +
            (row.party ? ' <span class="sub">' + esc(row.party) + '</span>' : '') +
            (howText ? ' <span class="sub" data-testid="tk-how-' + esc(row.chit_id) + '">' + esc(howText) + '</span>' : '')
          );
        }
      },
      {
        key: 'word',
        label: T('Where it is'),
        prio: 2,
        w: 150,
        sort: 'word',
        hfilter: 'state',
        html: true,
        cell: wordCell,
        value: function (row) {
          return row.word || '';
        }
      },
      {
        key: 'amount',
        label: T('Amount'),
        prio: 3,
        w: 130,
        num: true,
        sort: 'amount',
        cell: function (row) {
          return moneyWord(row.total_minor, row.currency, row.cost_hidden);
        },
        value: function (row) {
          return Number(row.total_minor) || 0;
        }
      },
      { key: 'who', label: T('Who has it'), prio: 4, w: 150, sort: 'who', hfilter: 'assignee', cell: whoWord, value: whoWord },
      {
        key: 'for',
        label: T('Asked for'),
        prio: 5,
        w: 110,
        sort: 'for',
        cell: forWord,
        value: function (row) {
          return row.requested_for || '';
        }
      },
      {
        key: 'age',
        label: T('Age'),
        prio: 6,
        w: 90,
        sort: 'age',
        cell: function (row) {
          return ageWord(row.age_days);
        },
        value: function (row) {
          return Number(row.age_days) || 0;
        }
      },
      { key: 'lines', label: T('Items'), prio: 7, w: 130, cell: linesWord },
      {
        key: 'address',
        label: T('Address'),
        prio: 8,
        w: 200,
        cell: function (row) {
          return row.address || '';
        }
      },
      {
        key: 'remark',
        label: T('Remark'),
        prio: 9,
        w: 200,
        cell: function (row) {
          return row.remark || '';
        }
      },
      {
        key: 'kind',
        label: T('Kind'),
        prio: 10,
        w: 110,
        hfilter: 'kind',
        cell: function (row) {
          return T(KIND_WORD[row.kind] || row.kind);
        }
      }
    ];
  }
  /** the three columns a folder shows first (SYSTEM §3 rule 7; the rest sit under ⚙): an order's money before its holder; a task's holder before money */
  function defaultCols() {
    return board.view === 'tasks' ? ['what', 'word', 'who'] : ['what', 'word', 'amount'];
  }
  /** the list orders: newest first, asked-for date, and the others the board offers */
  function listSorts() {
    return [
      {
        key: 'age',
        label: T('Newest first'),
        cmp: function (left, right) {
          return (Number(left.age_days) || 0) - (Number(right.age_days) || 0);
        }
      },
      {
        key: 'for',
        label: T('Asked for'),
        cmp: function (left, right) {
          return String(left.requested_for || '9').localeCompare(String(right.requested_for || '9'));
        }
      },
      {
        key: 'amount',
        label: T('Amount'),
        cmp: function (left, right) {
          return (Number(right.total_minor) || 0) - (Number(left.total_minor) || 0);
        }
      },
      {
        key: 'what',
        label: T('Name'),
        cmp: function (left, right) {
          return String(left.subject || '').localeCompare(String(right.subject || ''));
        }
      }
    ];
  }
  function mountList(host) {
    if (!host) return;
    if (board.list) {
      try {
        board.list.destroy();
      } catch (failure) {
        logFailure('the old list could not be torn down', failure); // it is replaced right below
      }
    }
    var names = [];
    board.rows.forEach(function (item) {
      var name = item.assignee && item.assignee.name;
      if (name && names.indexOf(name) < 0) names.push(name);
    });
    var stages = (WF() ? WF().STAGES : ['new', 'accepted', 'delivered', 'closed']).filter(function (item) {
      return board.rows.some(function (row) {
        return row.stage === item;
      });
    });
    var stageLabel = { new: 'New', accepted: 'Accepted', delivered: 'Delivered', closed: 'Closed' };
    var kinds = Object.keys(KIND_WORD).filter(function (item) {
      return board.rows.some(function (row) {
        return row.kind === item;
      });
    });
    var stateOpts = stages.map(function (item) {
      return { v: item, label: T(stageLabel[item] || item) };
    });
    if (
      board.rows.some(function (item) {
        return item.stuck;
      })
    )
      stateOpts.push({ v: 'stuck', label: T('Stuck') });
    board.list = root.CBList.mount(host, {
      key: 'tasks-' + board.view,
      t: T,
      rows: tkList,
      id: function (row) {
        return row.chit_id;
      },
      rowTid: function (row) {
        return 'tk-row-' + row.chit_id;
      },
      columns: cols(),
      defaultCols: defaultCols(),
      filters: [
        {
          key: 'kind',
          label: T('Kind'),
          all: T('Any kind'),
          options: kinds.map(function (item) {
            return { v: item, label: T(KIND_WORD[item]) };
          }),
          match: function (row, value) {
            return row.kind === value;
          }
        },
        {
          key: 'state',
          label: T('Where it is'),
          all: T('Anywhere'),
          options: stateOpts,
          match: function (row, value) {
            return value === 'stuck' ? !!row.stuck : row.stage === value;
          }
        },
        {
          key: 'assignee',
          label: T('Who has it'),
          all: T('Anyone'),
          options: [{ v: 'none', label: T('No one') }].concat(
            names.map(function (item) {
              return { v: item, label: item };
            })
          ),
          match: function (row, value) {
            return value === 'none' ? !(row.assignee && row.assignee.name) && !row.lines_assigned_n : !!(row.assignee && row.assignee.name === value);
          }
        }
      ],
      search: function (row) {
        return [row.subject, row.party, row.ref, row.word, row.assignee && row.assignee.name, row.remark, row.address, howWord(row)].join(' ');
      },
      sorts: listSorts(),
      onOpen: function (row) {
        tkOpen(row.chit_id);
      },
      empty: { title: T(board.view === 'done' ? 'Nothing closed yet' : board.view === 'tasks' ? 'No tasks waiting' : 'No orders here') }
    });
  }

  function viewLabel(value) {
    var tabRow = WF()
      ? WF()
          .tabs()
          .filter(function (x) {
            return x.id === value;
          })[0]
      : null;
    return T(tabRow ? tabRow.label : value);
  }
  function paintBar() {
    var node = $('tk_bar');
    if (!node) return;
    var total = board.total,
      more = board.rows.length < total ? ' · ' + T('first') + ' ' + board.rows.length + ' ' + T('shown') : '';
    var count = board.truncated ? T('Too many to count') : '<b>' + total + '</b> ' + esc(T(total === 1 ? 'row' : 'rows')) + esc(more);
    var pick = '';
    if (board.o.embed) {
      pick =
        '<select data-cbsid="TSK003-S01" class="inp tk-pick" id="tk_view" data-testid="tk-view" aria-label="' +
        esc(T('Folder')) +
        '">' +
        VIEWS.map(function (item) {
          var chit = board.counts && board.counts[item] != null ? ' (' + board.counts[item] + ')' : '';
          return '<option value="' + item + '"' + (item === board.view ? ' selected' : '') + '>' + esc(viewLabel(item) + chit) + '</option>';
        }).join('') +
        '</select>';
    }
    /* ＋ New (TOUR-FIX1): a task, started HERE in this page's own sheet — never the workshop (index-not-app). An order to a supplier waits for the
       compose route outside app.html (docs/design/tasks-orders/REQUIREMENT.md §＋ New). */
    var fresh = board.o.embed ? '' : '<button data-cbsid="TSK003-B02" type="button" class="act quiet" id="tk_new" data-testid="tk-new">' + esc(T('＋ New')) + '</button>';
    node.innerHTML = '<span class="tk-count" data-testid="tk-count">' + count + '</span>' + pick + fresh;
    var viewSelect = $('tk_view');
    if (viewSelect)
      viewSelect.onchange = function () {
        show(viewSelect.value);
      };
    var newButton = $('tk_new');
    if (newButton) newButton.onclick = tkNew;
    if (typeof board.o.onCounts === 'function') {
      try {
        board.o.onCounts(board.counts);
      } catch (failure) {
        logFailure('the counts callback of the host page failed', failure); // the host page own code; this screen is unaffected
      }
    }
  }

  /* ── the sheet: header · next steps · who has it · the lines · the thread ── */
  function sheet(html) {
    var node = $('tk_sheet');
    if (!node) return;
    node.innerHTML = '<button data-cbsid="TSK003-B03" type="button" class="mx" id="tk_x" aria-label="' + esc(T('Close')) + '" title="' + esc(T('Close')) + '">✕</button>' + html;
    if (!node.open) {
      try {
        node.showModal();
      } catch (_) {
        node.setAttribute('open', '');
      }
    }
    $('tk_x').onclick = closeSheet;
  }
  function closeSheet() {
    var node = $('tk_sheet');
    if (!node) return;
    if (board.thread) {
      try {
        board.thread.destroy();
      } catch (failure) {
        logFailure('the old thread could not be torn down', failure); // it is dropped on the next line
      }
      board.thread = null;
    }
    try {
      node.close();
    } catch (_) {
      node.removeAttribute('open');
    }
    node.innerHTML = '';
    board.open = null;
  }
  /** a row → its sheet, read fresh (the lines, the verdicts); the list row stays the row */
  function tkOpen(id) {
    var node = byId(id);
    sheet(
      '<h2 data-testid="tk-subject">' +
        esc((node && node.subject) || T('Order')) +
        '</h2><div class="loadwrap"><span class="spin"></span> ' +
        esc(T('Loading')) +
        '</div>'
    );
    return call('workOne', { params: { id: id } }).then(
      function (reply) {
        board.open = reply;
        paintSheet(reply);
        tell('open', { chit_id: reply.chit_id, kind: reply.kind, stage: reply.stage, word: reply.word });
      },
      function (e) {
        sheet(
          '<h2>' +
            esc((node && node.subject) || T('Order')) +
            '</h2><div class="empty" data-testid="tk-sheet-fail"><div class="t">' +
            esc(T("Couldn't read this one")) +
            '</div>' +
            '<button data-cbsid="TSK003-B04" type="button" class="act" id="tk_sheet_retry">' +
            esc(T('Try again')) +
            '</button></div>'
        );
        $('tk_sheet_retry').onclick = function () {
          tkOpen(id);
        };
      }
    );
  }
  function headLine(chit) {
    var bits = [];
    if (chit.party) bits.push(esc(chit.party));
    var total = moneyWord(chit.total_minor, chit.currency, chit.cost_hidden);
    if (total) bits.push('<span class="mono">' + esc(total) + '</span>');
    bits.push(esc(ageWord(chit.age_days)));
    var howText = howWord(chit);
    if (howText) bits.push(esc(howText));
    if (chit.requested_for) bits.push(esc(T('for')) + ' ' + esc(forWord(chit)));
    return bits.join(' · ');
  }
  /** under the header: the delivery address, the remark, and — when the rail says it is stuck — why (the button that clears it is the next step below) */
  function headMore(chit) {
    var html = '';
    if (chit.address) html += '<div class="sub" data-testid="tk-address">📍 ' + esc(chit.address) + '</div>';
    if (chit.remark) html += '<div class="sub" data-testid="tk-remark">' + esc(chit.remark) + '</div>';
    if (chit.stuck)
      html += '<div class="tk-stuck" data-testid="tk-stuck-why"><span class="tag red">' + esc(T('Stuck')) + '</span> ' + esc(chit.stuck_why || '') + '</div>';
    return html;
  }
  /**
   * Bill it (O2C step 5 · invoice): an order in becomes the counter bill on the TILL — invoice number and tax frozen by the till's one bill path
   * (orderToBill), never a second bill path here. In a frame on the till: the host hears { event: 'bill', chit_id } and bills it. Standalone: the
   * till opens, where its 🛒 pill holds the same order (one queue, two places). Greyed with its sentence once the server says it is billed.
   */
  function billRow(chit) {
    if (chit.kind !== 'order_in') return '';
    var verdict = chit.billed ? { ok: false, say: T('Already billed') } : chit.stage === 'closed' ? { ok: false, say: T('This order is closed') } : { ok: true };
    return actRow('tk_do_bill', T('Bill it'), verdict, board.o.embed ? '' : '<span class="why">' + esc(T('on the till')) + '</span>', verdict.ok ? '' : 'quiet', 'TSK003-B05');
  }
  function tkBill(chit) {
    if (board.o.embed) {
      tell('bill', { chit_id: chit.chit_id, kind: chit.kind, stage: chit.stage, word: chit.word, party: chit.party || null });
      return;
    }
    root.location.href = '/till.html';
  }
  function lineHTML(line, chit) {
    var assignment = line.assignment || {},
      lineState = (line.settings && line.settings.state) || 'open',
      done = lineState === 'done';
    var assigneeName = assignment.assignee_name || T('No one');
    var lineId = esc(line.line_id), price = moneyWord(line.price_minor, chit.currency, chit.cost_hidden);
    return (
      '<div class="tk-line' +
      (done ? ' done' : '') +
      '" data-testid="tk-line-' +
      lineId +
      '">' +
      '<div class="tk-line-top"><b>' +
      esc(line.particulars || T('Line')) +
      '</b> <span class="mono">' +
      esc(line.qty) +
      ' ' +
      esc(line.unit || '') +
      '</span>' +
      '<span class="tag ' +
      (done ? '' : line.remaining > 0 ? 'amber' : 'green') +
      '" data-testid="tk-line-state-' +
      lineId +
      '">' +
      esc(T(done ? 'Done' : line.remaining > 0 ? 'Open' : 'Delivered')) +
      '</span>' +
      '<span class="sub" data-testid="tk-line-who-' +
      lineId +
      '">' +
      esc(assigneeName) +
      '</span>' +
      (price ? '<span class="sub mono">' + esc(price) + '</span>' : '') +
      '</div>' +
      '<div class="tk-line-sub sub">' +
      esc(T('Delivered')) +
      ' ' +
      esc(line.delivered) +
      ' · ' +
      esc(T('left')) +
      ' ' +
      esc(line.remaining) +
      (line.settings && line.settings.due ? ' · ' + esc(T('due')) + ' ' + esc(line.settings.due) : '') +
      (line.settings && line.settings.task ? ' · ' + esc(line.settings.task) : '') +
      '</div>' +
      '<div class="tk-line-acts">' +
      actRow('tk_la_' + lineId, T('Assign'), line.actions && line.actions.assign_line, '', '', 'TSK003-B06') +
      actRow('tk_ld_' + lineId, T(done ? 'Reopen' : 'Done'), line.actions && line.actions.assign_line, '', '', 'TSK003-B07') +
      actRow('tk_lv_' + lineId, T('Deliver'), line.remaining > 0 ? line.actions && line.actions.deliver_line : { ok: false, say: T('Nothing left to deliver') }, '', '', 'TSK003-B08') +
      '</div><div id="tk_lmore_' +
      lineId +
      '"></div></div>'
    );
  }
  function paintSheet(chit) {
    var acts = chit.actions || {};
    var keep = $('tk_out') ? $('tk_out').textContent : '';
    var node = byId(chit.chit_id);
    if (node) {
      chit.stuck = !!node.stuck;
      chit.stuck_why = node.stuck_why || null;
    } /* the rail's stuck mark rides the list row; the sheet paints it */
    var steps = STEPS.map(function (item) {
      return actRow('tk_do_' + item, stepLabel(item, chit), acts[item], '', item === 'accept' || item === 'complete' ? '' : 'quiet', 'TSK003-B09');
    });
    steps.splice(1, 0, billRow(chit)); /* Accept → Bill it → Delivered, the brief's order */
    steps = steps.join('');
    /* the whole task's holder (the list column prefers the lines' summary, b143's rule; the sheet shows both: the task's, then the lines held) */
    var assigneeName =
      ((chit.assignee && chit.assignee.name) || T('No one')) +
      (chit.lines_assigned_n ? ' · ' + chit.lines_assigned_n + ' ' + T(chit.lines_assigned_n === 1 ? 'line held' : 'lines held') : '');
    sheet(
      '<h2 data-testid="tk-subject">' +
        esc(chit.subject || T('Order')) +
        '</h2>' +
        '<div class="tk-sub">' +
        wordCell(chit) +
        ' <span class="sub" data-testid="tk-head">' +
        headLine(chit) +
        '</span></div>' +
        headMore(chit) +
        '<div id="tk_out" class="tk-out" role="status" data-testid="tk-out">' +
        esc(keep) +
        '</div>' +
        '<div class="tk-block"><div class="tk-h">' +
        esc(T('Next step')) +
        '</div><div class="tk-steps" data-testid="tk-steps">' +
        steps +
        '</div><div id="tk_more"></div></div>' +
        '<div class="tk-block"><div class="tk-h">' +
        esc(T('Who has it')) +
        '</div>' +
        actRow('tk_assign', T('Assign'), acts.assign_task, '<span class="sub" data-testid="tk-who">' + esc(assigneeName) + '</span>', '', 'TSK003-B10') +
        '<div id="tk_amore"></div></div>' +
        '<div class="tk-block"><div class="tk-h">' +
        esc(T('Lines')) +
        '</div><div class="tk-lines" data-testid="tk-lines">' +
        ((chit.lines || []).length
          ? chit.lines
              .map(function (item) {
                return lineHTML(item, chit);
              })
              .join('')
          : '<div class="sub">' + esc(T('No lines on this one')) + '</div>') +
        '</div></div>' +
        '<div class="tk-block"><div class="tk-h">' +
        esc(T('Messages')) +
        '</div><div id="tk_thread" data-testid="tk-thread"></div></div>'
    );
    STEPS.forEach(function (item) {
      var element = $('tk_do_' + item);
      if (element && acts[item] && acts[item].ok !== false)
        element.onclick = function () {
          tkMove(chit, item, element);
        };
    });
    var bill = $('tk_do_bill');
    if (bill && !bill.disabled)
      bill.onclick = function () {
        tkBill(chit);
      };
    if (acts.assign_task && acts.assign_task.ok !== false)
      $('tk_assign').onclick = function () {
        assignPanel(chit, null);
      };
    (chit.lines || []).forEach(function (item) {
      var lineId = item.line_id,
        element = $('tk_la_' + lineId),
        target = $('tk_ld_' + lineId),
        nestedNode = $('tk_lv_' + lineId);
      if (element && !element.disabled)
        element.onclick = function () {
          assignPanel(chit, item);
        };
      if (target && !target.disabled)
        target.onclick = function () {
          tkAssignLine(chit, item, { state: (item.settings && item.settings.state) === 'done' ? 'open' : 'done' }, target);
        };
      if (nestedNode && !nestedNode.disabled)
        nestedNode.onclick = function () {
          deliverPanel(chit, item);
        };
    });
    mountThread(chit);
  }
  function mountThread(chit) {
    var el = $('tk_thread');
    if (!el || !root.CBThread) return;
    if (board.thread) {
      try {
        board.thread.destroy();
      } catch (failure) {
        logFailure('the old thread could not be torn down', failure); // it is replaced right below
      }
    }
    board.thread = root.CBThread.mount(el, {
      chit_id: chit.chit_id,
      party: chit.party || undefined,
      kinds: ['info'],
      context: { host: 'tasks' },
      lines: (chit.lines || []).map(function (item) {
        return { line_id: item.line_id, label: item.particulars };
      })
    });
  }

  /** after a write: re-read the one row's sheet and the folder (a step may move it to Done), repaint, tell the host */
  function changed(id, event, more) {
    return call('workOne', { params: { id: id } }).then(
      function (reply) {
        board.open = reply;
        if ($('tk_sheet') && $('tk_sheet').open) paintSheet(reply);
        tell(event, Object.assign({ chit_id: reply.chit_id, kind: reply.kind, stage: reply.stage, word: reply.word, status: reply.status }, more || {}));
        return load().then(function () {
          paintBar();
          mountList($('tk_list'));
        });
      },
      function () {
        return load().then(function () {
          paintBar();
          mountList($('tk_list'));
        });
      }
    );
  }

  /* ── the writes (O2C step 4 · delivery: the seller's staff move the order and its lines) ── */
  /** a status step through the ONE status writer (PUT /chits/:id/status = moveStatus); the status is the engine's STEP_TO */
  function tkMove(chit, action, btn) {
    var to =
      (WF() && WF().STEP_TO[action]) || { accept: 'accepted', reject: 'rejected', complete: 'completed', cancel: 'cancelled', reopen: 'in_progress' }[action];
    var needs = (chit.actions && chit.actions[action] && chit.actions[action].needs) || [];
    var runMove = function (note) {
      return call('status', { params: { id: chit.chit_id }, body: Object.assign({ status: to }, note ? { note: note } : {}) });
    };
    var opts = {
      key: 'tk-' + action + '-' + chit.chit_id,
      failed: T("That step didn't go through"),
      out: 'tk_out',
      outcome: function () {
        $('tk_out').textContent = stepSaid(action, chit);
        changed(chit.chit_id, 'moved', { action: action });
      }
    };
    if (needs.indexOf('reason') >= 0) {
      $('tk_more').innerHTML =
        '<div class="tk-panel"><label class="sub" for="tk_reason">' +
        esc(T(action === 'reject' ? 'Why is it refused?' : 'Lines are still open — why close it?')) +
        '</label>' +
        '<input data-cbsid="TSK003-I01" class="inp" id="tk_reason" data-testid="tk-reason" maxlength="500" autocomplete="off">' +
        '<button data-cbsid="TSK003-B11" type="button" class="act" id="tk_reason_go" data-testid="tk-reason-go">' +
        esc(stepLabel(action, chit)) +
        '</button></div>';
      $('tk_reason').focus();
      $('tk_reason_go').onclick = function () {
        var node = $('tk_reason').value.trim();
        if (!node) {
          $('tk_out').textContent = T('Type the reason first.');
          return;
        }
        root.CBAction.run(
          $('tk_reason_go'),
          function () {
            return runMove(node);
          },
          opts
        );
      };
      return;
    }
    if (action === 'cancel') {
      return root.CBAction.run(
        btn,
        function () {
          return runMove('');
        },
        Object.assign(
          {
            confirm: {
              title: T('Cancel this?'),
              body: esc(chit.subject || '') + ' ' + esc(T('stops here. The other party is told.')),
              yes: T('Cancel it'),
              danger: true
            }
          },
          opts
        )
      );
    }
    return root.CBAction.run(
      btn,
      function () {
        return runMove('');
      },
      opts
    );
  }

  function loadPeople() {
    if (board.people) return Promise.resolve(board.people);
    return call('people').then(
      function (reply) {
        board.people = ((reply && reply.people) || []).filter(function (item) {
          return item.state !== 'off';
        });
        return board.people;
      },
      function () {
        board.people = [];
        return board.people;
      }
    );
  }
  /** the picker, for the whole task (line null) or one line: the shop's people, "No one" to take it off someone */
  function assignPanel(chit, line) {
    var host = line ? $('tk_lmore_' + line.line_id) : $('tk_amore');
    if (!host) return;
    host.innerHTML = '<div class="tk-panel"><span class="sub">' + esc(T('Loading')) + '</span></div>';
    loadPeople().then(function (people) {
      var current = line ? line.assignment && line.assignment.assignee_actor_id : chit.assignee && chit.assignee.id;
      var opts =
        '<option value="">' +
        esc(T('No one')) +
        '</option>' +
        people
          .map(function (item) {
            return '<option value="' + esc(item.id) + '"' + (item.id === current ? ' selected' : '') + '>' + esc(item.name) + '</option>';
          })
          .join('');
      var testId = line ? 'tk-line-pick' : 'tk-pick';
      host.innerHTML =
        '<div class="tk-panel"><label class="sub" for="tk_who_sel">' +
        esc(T('Who does this?')) +
        '</label>' +
        '<select data-cbsid="TSK003-S02" id="tk_who_sel" class="inp" data-testid="' +
        testId +
        '">' +
        opts +
        '</select>' +
        '<button data-cbsid="TSK003-B12" type="button" class="act" id="tk_who_go" data-testid="' +
        testId +
        '-go">' +
        esc(T('Save')) +
        '</button></div>';
      $('tk_who_go').onclick = function () {
        var node = $('tk_who_sel').value || null,
          panel =
            people.filter(function (x) {
              return x.id === node;
            })[0] || null;
        if (line) return tkAssignLine(chit, line, { who: node, name: panel ? panel.name : null }, $('tk_who_go'));
        return tkAssignTask(chit, node, panel ? panel.name : null, $('tk_who_go'));
      };
    });
  }
  /** who holds the whole task: PUT /actors/assign/:id push · return (the route app.html's Assign uses) */
  function tkAssignTask(chit, assigneeId, name, btn) {
    return root.CBAction.run(
      btn,
      function () {
        return call('assign', { params: { id: chit.chit_id }, body: assigneeId ? { action: 'push', target_actor_id: assigneeId } : { action: 'return' } });
      },
      {
        key: 'tk-assign-' + chit.chit_id,
        failed: T("Couldn't assign it"),
        out: 'tk_out',
        outcome: function () {
          $('tk_out').textContent = assigneeId ? T('Assigned to') + ' ' + (name || '') + '.' : T('Taken off.');
          changed(chit.chit_id, 'assigned', { line_id: null, assignee: assigneeId ? { id: assigneeId, name: name } : null });
        }
      }
    );
  }
  /** a LINE's holder or state: ONE append on chit_line_assignment (lib/assign — reassign, re-date and mark done ride the same row) */
  function tkAssignLine(chit, line, x, btn) {
    var assignment = line.assignment || {},
      lineState = (line.settings && line.settings.state) || 'open';
    var assigneeId = 'who' in x ? x.who : assignment.assignee_actor_id || null,
      name = 'who' in x ? x.name : assignment.assignee_name || null,
      state = x.state || lineState;
    var edit = { line_id: line.line_id, assignee_actor_id: assigneeId, assignee_name: name, assignee_type: assigneeId ? 'human' : null, state: state };
    var said = x.state ? T(x.state === 'done' ? 'Line done.' : 'Line reopened.') : assigneeId ? T('Line given to') + ' ' + (name || '') + '.' : T('Line taken off.');
    return root.CBAction.run(
      btn,
      function () {
        return call('wlAssign', { params: { id: chit.chit_id }, body: { edits: [edit] } });
      },
      {
        key: 'tk-line-' + line.line_id + '-' + (x.state || 'who'),
        failed: T("Couldn't save the line"),
        out: 'tk_out',
        outcome: function () {
          $('tk_out').textContent = said;
          changed(chit.chit_id, x.state ? 'moved' : 'assigned', { line_id: line.line_id, state: state, assignee: assigneeId ? { id: assigneeId, name: name } : null });
        }
      }
    );
  }
  function deliverPanel(chit, line) {
    var host = $('tk_lmore_' + line.line_id);
    if (!host) return;
    host.innerHTML =
      '<div class="tk-panel"><label class="sub" for="tk_dq">' +
      esc(T('How much went out?')) +
      ' <span class="mono">' +
      esc(line.unit || '') +
      '</span></label>' +
      '<input data-cbsid="TSK003-I02" class="inp mono" id="tk_dq" data-testid="tk-deliver-qty" inputmode="decimal" value="' +
      esc(line.remaining) +
      '" autocomplete="off">' +
      '<button data-cbsid="TSK003-B13" type="button" class="act" id="tk_dq_go" data-testid="tk-deliver-go">' +
      esc(T('Record')) +
      '</button></div>';
    $('tk_dq').focus();
    $('tk_dq_go').onclick = function () {
      var typed = parseFloat(String($('tk_dq').value).replace(/[^0-9.-]/g, ''));
      if (!isFinite(typed) || typed === 0) {
        $('tk_out').textContent = T('Type a quantity first.');
        return;
      }
      tkDeliver(chit, line, typed, $('tk_dq_go'));
    };
  }
  /** what went out on a line: POST /chits/:id/deliver-lines (lib/deliverline — events, never a stored total) */
  function tkDeliver(chit, line, amount, btn) {
    return root.CBAction.run(
      btn,
      function () {
        ensureEP();
        return root.postDeliverLines('wlDeliver', chit.chit_id, [{ line_id: line.line_id, quantity: amount, unit: line.unit || undefined }]);
      },
      {
        key: 'tk-deliver-' + line.line_id,
        failed: T("Couldn't record it"),
        out: 'tk_out',
        outcome: function () {
          $('tk_out').textContent = T('Recorded') + ' ' + amount + ' ' + (line.unit || '') + '.';
          changed(chit.chit_id, 'moved', { line_id: line.line_id, delivered: amount });
        }
      }
    );
  }

  /**
   * ＋ New task (TOUR-FIX1): one line — what needs doing — sent as a chit to the shop itself (POST /api/chits/send, the body cap-readiness already
   * sends for a note to self). It lands in Tasks (a chit that came to me and is not an order); the server decides who may send. No flow step: a
   * shop's own to-do is not an O2C / P2P step (module TasksOrders).
   */
  function tkNew() {
    sheet(
      '<h2 data-testid="tk-new-title">' +
        esc(T('New task')) +
        '</h2>' +
        '<div class="tk-panel"><label class="sub" for="tk_new_what">' +
        esc(T('What needs doing?')) +
        '</label>' +
        '<input data-cbsid="TSK003-I03" class="inp" id="tk_new_what" data-testid="tk-new-what" maxlength="200" autocomplete="off" required data-required-msg="' + esc(T('Type what needs doing first.')) + '">' +
        '<button data-cbsid="TSK003-B14" type="button" class="act" id="tk_new_go" data-testid="tk-new-go" data-sheet-save>' +
        esc(T('Add task')) +
        '</button></div>' +
        '<div id="tk_out" class="tk-out" role="status" data-testid="tk-out"></div>'
    );
    var node = $('tk_new_what');
    node.focus();
    node.onkeydown = function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        $('tk_new_go').click();
      }
    };
    $('tk_new_go').onclick = function () {
      var what = String($('tk_new_what').value || '').trim();
      if (!what) {
        $('tk_out').textContent = T('Type what needs doing first.');
        return;
      }
      return root.CBAction.run(
        $('tk_new_go'),
        function () {
          return call('createChit', {
            body: { recipients: [{ name: 'self', role: 'to' }], manual_subject: what, subject: what, purpose: 'general', line_items: [] }
          });
        },
        {
          key: 'tk-new',
          failed: T("Couldn't add the task"),
          out: 'tk_out',
          outcome: function () {
            closeSheet();
            if (typeof root.toast === 'function') root.toast(T('Task added.'));
            show('tasks');
          }
        }
      );
    };
  }

  /* ── the screen ── */
  function show(view) {
    if (VIEWS.indexOf(view) < 0) view = 'orders_in';
    board.view = view;
    closeSheet();
    if (typeof board.o.onView === 'function') {
      try {
        board.o.onView(view);
      } catch (failure) {
        logFailure('the view callback of the host page failed', failure); // the host page own code; the view still changes
      }
    }
    return reload();
  }
  function start() {
    board.el.innerHTML = '<div class="loadwrap"><span class="spin"></span> ' + esc(T('Loading')) + '</div>';
    return load().then(
      function () {
        board.el.innerHTML =
          '<div class="tk-top" id="tk_bar" data-testid="tk-bar"></div><div class="tk-list" id="tk_list" data-testid="tk-list"></div><dialog class="sheet tk-sheet" id="tk_sheet" data-pop="POP130" data-testid="tk-sheet"></dialog>';
        var node = $('tk_sheet');
        node.addEventListener('cancel', function (e) {
          e.preventDefault();
          closeSheet();
        });
        node.addEventListener('click', function (e) {
          if (e.target === node) closeSheet();
        });
        paintBar();
        mountList($('tk_list'));
        /* a host may name the row to open (?open=<chit_id>): the sheet, over the list */
        if (board.o.open) {
          var id = board.o.open;
          board.o.open = null;
          tkOpen(id);
        }
      },
      function (e) {
        paintFail(e);
      }
    );
  }
  function mount(el, options) {
    board.el = el;
    board.o = options || {};
    if (VIEWS.indexOf(board.o.view) >= 0) board.view = board.o.view;
    ensureEP();
    start();
    return { reload: reload, show: show, open: tkOpen, close: closeSheet };
  }
  /* actRow is shared (T3-DISPUTES-ASSIST): CBDispute (cap-dispute.js) draws Raise / Resolve the same way — shown always, greyed WITH the server's sentence */
  root.CBTasks = { mount: mount, VIEWS: VIEWS, EP: CB_WORK_EP, actRow: actRow };
})(typeof window !== 'undefined' ? window : globalThis);
