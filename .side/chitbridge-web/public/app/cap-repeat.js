/* cap-repeat.js — REPEAT SUPPLY as an AGREEMENT both parties hold (round RI1, 2026-10-12): CB Finance › Repeat supply (the seller's list),
 * "Repeat this…" on a sent invoice (CBSteps), and the agreement's own panel in the chit sheet — Accept · Counter · Decline · Skip on the
 * customer's side, Run now · Pause · Resume · Agree · Skip · End on the seller's. Loaded by finance.html (after cap-finance-terms.js) and
 * lazily by app.html (ensureCap('repeat')) when the chit sheet meets a sent invoice or an agreement chit.
 *
 * ⭐ REUSE (CLAUDE.md rule 1, named in the PR): CBList.mount (the one list — the Finance tabs' own mount) · CBSteps (step-flow.js, the one
 * step flow) · openChitSheet (a row's details ARE the agreement chit; the panel sits inside the sheet) · CBAction (M64: one press one write,
 * End and Decline ask first, the outcome said beside the control) · bkDate / bkMoney / fmtMoney (M36) · finTab / ftNav (the Finance tabs) ·
 * modal / closeModal (the page's own sheet) · api() and EP (one name per endpoint, e2e/ep-aliases).
 * ⭐ ONE CALCULATION (rule 2): nothing here works out a date, a quantity or a rupee. The next date, the last run, the agreement's state and
 * EVERY verb's may/why come from /api/repeat (lib/repeat-supply may()); the per-run money is the agreement chit's own frozen summary.
 * A button the server refuses is greyed WITH its sentence (the server's `say`).
 * ⭐ NEW PATHS (rule 4): RP (the tab's state) · CB_REPEAT_EP (the 14 /api/repeat rows, declared once here) · the tab (#/repeat — a third
 * place on the Finance nav) · rpStart (the composer: Finance had no step flow and the sheet no "repeat" verb) · rpPanel (the agreement's
 * panel in the sheet: the sheet's status verbs are the rail's; the agreement's verbs are its own table).
 * ⚠️ Never error.message on a screen: a failure says what happened (CBAction.words) and the button stays.
 */
/* OWNS Repeat supply as an agreement both parties hold
 * CALLED BY finance.html and app.html (ensureCap('repeat'))
 * FLOW agreement chit -> rpMoney paints its total in the agreement's own currency -> actions per side
 * CARD 16-finance/repeat-supply */
'use strict';

var RP = { gen: 0, rows: [], state: 'loading', err: null, api: null, migrated: true, msg: null, flow: null, draft: null, panel: null };
var CB_REPEAT_EP = {
  repeatList: { m: 'GET', p: '/api/repeat', ok: 'y' }, // the seller's agreements: next date · last run · the other side's state · actions (may/why)
  repeatCreate: { m: 'POST', p: '/api/repeat', ok: '✓' }, // { chit_id, every, unit, start_on, until: { runs | on }, mode } — the agreement chit is SENT
  repeatSweep: { m: 'POST', p: '/api/repeat/sweep', ok: '✓' }, // run everything due (what the nightly does)
  repeatGet: { m: 'GET', p: '/api/repeat/:id', ok: 'y' }, // ?chit= — either side (the customer names the chit they hold)
  repeatAccept: { m: 'POST', p: '/api/repeat/:id/accept', ok: '✓' }, // customer
  repeatCounter: { m: 'POST', p: '/api/repeat/:id/counter', ok: '✓' }, // customer: { chit_id, lines?, every?, unit?, start_on?, note }
  repeatDecline: { m: 'POST', p: '/api/repeat/:id/decline', ok: '✓' }, // customer: { chit_id, reason? }
  repeatSkip: { m: 'POST', p: '/api/repeat/:id/skip', ok: '✓' }, // either side: { chit_id?, reason } (the customer must say why)
  repeatAgree: { m: 'POST', p: '/api/repeat/:id/agree', ok: '✓' }, // seller: the counter becomes the terms
  repeatRefuse: { m: 'POST', p: '/api/repeat/:id/refuse', ok: '✓' }, // seller: { reason? }
  repeatPause: { m: 'POST', p: '/api/repeat/:id/pause', ok: '✓' }, // seller: { reason? }
  repeatResume: { m: 'POST', p: '/api/repeat/:id/resume', ok: '✓' }, // seller
  repeatEnd: { m: 'POST', p: '/api/repeat/:id/end', ok: '✓' }, // seller: { reason? } — asks first
  repeatRun: { m: 'POST', p: '/api/repeat/:id/run', ok: '✓' } // seller: run what is due now
};
Object.assign(EP, CB_REPEAT_EP);

var RP_UNIT = { daily: ['day', 'days'], weekly: ['week', 'weeks'], monthly: ['month', 'months'] };
var RP_VERB = {
  accept: 'Accept',
  counter: 'Counter',
  decline: 'Decline',
  skip: 'Skip next',
  run: 'Run now',
  pause: 'Pause',
  resume: 'Resume',
  agree: 'Agree',
  refuse: "Don't agree",
  end: 'End'
};
var RP_TONE = { proposed: 'amber', agreed: 'green', countered: 'amber', paused: '', declined: '', ended: '' };

function rpT(words) {
  return typeof tx === 'function' ? tx(words) : words;
}
/** "every 2 weeks" · "every day" — the schedule in words, from the server's fields */
function rpEvery(list) {
  var unitWords = RP_UNIT[list.unit] || [list.unit, list.unit];
  var interval = Number(list.every) || 1;
  return rpT('every') + ' ' + (interval > 1 ? interval + ' ' + rpT(unitWords[1]) : rpT(unitWords[0]));
}
/** the per-run money as the agreement chit was frozen with — a mapping, never a sum */
function rpMoney(agreement) {
  var money = agreement && agreement.money;
  if (!money || money.total == null) return '—';
  return typeof fmtMoney === 'function' ? fmtMoney(money.total, agreement.currency || money.currency_code) : String(money.total);
}
function rpDate(date) {
  return typeof bkDate === 'function' ? bkDate(date) : date || '—';
}
function rpSession() {
  return (typeof SESS !== 'undefined' && SESS) || (typeof SESSION !== 'undefined' && SESSION) || {};
}
/** a verb button: enabled when the server says ok; otherwise greyed, its sentence on the control and said on a tap */
function rpBtn(agreement, verb, testId, className, sayInline) {
  var verbState = (agreement.actions || {})[verb];
  if (!verbState) return '';
  var ok = !!verbState.ok,
    sentence = verbState.say || '';
  return (
    '<button data-cbsid="FIN005-B01" type="button" class="' +
    (className || 'act sm') +
    '" data-testid="' +
    esc(testId) +
    '" data-verb="' +
    verb +
    '"' +
    (ok ? '' : ' disabled aria-disabled="true" title="' + esc(sentence) + '" data-why="' + esc(sentence) + '"') +
    ' onclick="CBRepeat.act(\'' +
    esc(agreement.agreement_id) +
    "','" +
    verb +
    '\',this)">' +
    esc(rpT(RP_VERB[verb] || verb)) +
    '</button>' +
    /* greyed WITH its sentence: a disabled button never answers a tap, so the sentence stands beside it */
    (!ok && sayInline ? '<div class="hint" data-testid="' + esc(testId) + '-say">' + esc(sentence) + '</div>' : '')
  );
}
/** the greyed verbs' sentences, once each, with the verbs they refuse — under the panel's buttons */
function rpSaysHTML(agreement, verbs) {
  var by = {};
  verbs.forEach(function (item) {
    var x = (agreement.actions || {})[item];
    if (x && !x.ok && x.say) (by[x.say] = by[x.say] || []).push(rpT(RP_VERB[item] || item));
  });
  return Object.keys(by)
    .map(function (item) {
      return '<div class="hint" data-testid="rp-says">' + esc(by[item].join(' · ') + ': ' + item) + '</div>';
    })
    .join('');
}

/* ── the Finance tab: the seller's agreements ─────────────────────────────────────────────────────────────── */

/** fetch the agreements into RP.rows (denied on a 403, error otherwise); quiet = no loading state, a stale reply is dropped */
async function rpLoad(quiet) {
  var generation = ++RP.gen;
  if (!quiet) {
    RP.state = 'loading';
    if (RP.api) RP.api.refresh();
  }
  try {
    var reply = await api('repeatList');
    if (generation !== RP.gen) return;
    RP.rows = (reply && reply.agreements) || [];
    RP.migrated = !(reply && reply.migrated === false);
    RP.msg = (reply && reply.message) || null;
    RP.state = 'ready';
    RP.err = null;
  } catch (e) {
    if (generation !== RP.gen) return;
    RP.state = e && e.status === 403 ? 'denied' : 'error';
    RP.err = e;
  }
  rpHead();
  if (RP.api) RP.api.refresh();
}
function rpRetry() {
  rpLoad();
}
/** the one line above the list: what is due (the server's rows) and the button that runs it — or the migration sentence, greyed */
function rpHead() {
  var node = document.getElementById('rp_head');
  if (!node) return;
  if (RP.state === 'denied') {
    node.innerHTML = '<p data-testid="rp-denied" style="opacity:.75">' + esc(rpT('Only the owner or a sales person may see agreements.')) + '</p>';
    return;
  }
  if (!RP.migrated) {
    node.innerHTML = '<p data-testid="rp-not-yet" style="opacity:.75">' + esc(rpT(RP.msg || 'Repeat supply arrives after the next update.')) + '</p>';
    return;
  }
  var dueCount = RP.rows.filter(function (item) {
    return item.due;
  }).length;
  node.innerHTML =
    '<div class="kv"><b data-testid="rp-due">' +
    esc(dueCount ? (typeof txn === 'function' ? txn('{count} run due', '{count} runs due', dueCount) : dueCount + ' due') : rpT('Nothing due today')) +
    '</b>' +
    '<span><button data-cbsid="FIN005-B02" type="button" class="act sm" data-testid="rp-run-due"' +
    (dueCount ? '' : ' disabled aria-disabled="true" title="' + esc(rpT('Nothing is due.')) + '"') +
    ' onclick="rpSweep(this)">' +
    esc(rpT('Run what is due')) +
    '</button>' +
    ' <span id="rp_why" data-testid="rp-why" class="hint"' +
    (RP.said ? ' data-tone="' + esc(RP.said.tone) + '"' : '') +
    '>' +
    esc(RP.said ? RP.said.text : '') +
    '</span></span></div>';
}
/** the runs-due button: one sweep POST through CBAction; the outcome sentence (how many ran, how many had a problem) rides on RP.said */
function rpSweep(btn) {
  return CBAction.run(
    btn,
    function () {
      return api('repeatSweep', { body: {} });
    },
    {
      key: 'rp-sweep',
      out: 'rp_why',
      failed: rpT('Could not run them'),
      outcome: function (reply) {
        var ranCount = ((reply && reply.ran) || []).length,
          problemCount = ((reply && reply.problems) || []).length;
        RP.said = {
          text:
            (ranCount ? (typeof txn === 'function' ? txn('{count} run made', '{count} runs made', ranCount) : ranCount + ' made') : rpT('Nothing to run')) +
            (problemCount ? ' · ' + rpT('some could not: see the row') : ''),
          tone: problemCount ? 'warn' : 'ok'
        };
        rpHead();
        rpLoad(true);
      }
    }
  );
}
/** the columns of the seller's Repeat supply list (customer, money, next, last, state, actions); a blank cell shows a grey dash */
function rpCols() {
  var dash = '<span style="color:var(--grey)">—</span>';
  return [
    {
      key: 'customer',
      label: rpT('Customer'),
      prio: 1,
      sort: 'name',
      w: 220,
      html: true,
      cell: function (agreement) {
        return (
          '<b>' +
          esc((agreement.customer && agreement.customer.name) || rpT('Customer')) +
          '</b><div class="hint" data-b="each">' +
          esc(rpEvery(agreement)) +
          (agreement.mode === 'send' ? ' · ' + esc(rpT('sent')) : ' · ' + esc(rpT('drafted'))) +
          '</div>'
        );
      }
    },
    {
      key: 'money',
      label: rpT('Each run'),
      prio: 3,
      num: true,
      w: 130,
      html: true,
      cell: function (agreement) {
        return '<span data-b="money">' + esc(rpMoney(agreement)) + '</span>';
      }
    },
    {
      key: 'next',
      label: rpT('Next run'),
      prio: 2,
      sort: 'next',
      w: 150,
      html: true,
      cell: function (agreement) {
        return agreement.state === 'agreed' || agreement.state === 'paused'
          ? '<span data-b="next">' + esc(rpDate(agreement.next_on)) + '</span>' + (agreement.due ? ' <span class="tag amber">' + esc(rpT('Due')) + '</span>' : '')
          : dash;
      }
    },
    {
      key: 'last',
      label: rpT('Last run'),
      prio: 4,
      w: 130,
      html: true,
      cell: function (agreement) {
        return agreement.last_run_on
          ? '<span data-b="last">' +
              esc(rpDate(agreement.last_run_on)) +
              '</span> <span class="hint">' +
              esc(String(agreement.runs_done)) +
              (agreement.runs_max ? '/' + esc(String(agreement.runs_max)) : '') +
              '</span>'
          : dash;
      }
    },
    {
      key: 'state',
      label: rpT('Their side'),
      prio: 1,
      sort: 'state',
      w: 200,
      html: true,
      cell: function (agreement) {
        return (
          '<span class="tag ' +
          (RP_TONE[agreement.state] || '') +
          '" data-b="state">' +
          esc(rpT(agreement.words || agreement.state)) +
          '</span>' +
          (agreement.state_note ? '<div class="hint" data-b="note">' + esc(agreement.state_note) + '</div>' : '')
        );
      }
    },
    {
      key: 'act',
      label: ' ',
      prio: 1,
      pin: 'end',
      w: 170,
      html: true,
      cell: function (agreement) {
        var verb = agreement.state === 'countered' ? 'agree' : agreement.state === 'paused' ? 'resume' : 'run';
        return (
          '<span data-cbsid="FIN005-C01" style="display:inline-flex;gap:6px;flex-direction:column;align-items:flex-start" onclick="event.stopPropagation()">' +
          rpBtn(agreement, verb, 'rp-' + verb + '-' + agreement.agreement_id, 'cbl-tbtn', true) +
          '</span>'
        );
      }
    }
  ];
}
/** the list's three orders: next run, customer name, their side */
function rpSorts() {
  return [
    {
      key: 'next',
      label: rpT('Next run'),
      cmp: function (left, right) {
        return String(left.next_on || '9999').localeCompare(String(right.next_on || '9999'));
      }
    },
    {
      key: 'name',
      label: rpT('Customer'),
      cmp: function (left, right) {
        return String((left.customer && left.customer.name) || '').localeCompare(String((right.customer && right.customer.name) || ''));
      }
    },
    {
      key: 'state',
      label: rpT('Their side'),
      cmp: function (left, right) {
        return String(left.state).localeCompare(String(right.state));
      }
    }
  ];
}
/** the list's one filter: running · waiting on them · ended */
function rpFilters() {
  return [
    {
      key: 'state',
      label: rpT('Show'),
      all: rpT('All'),
      options: [
        { v: 'live', label: rpT('Running') },
        { v: 'waiting', label: rpT('Waiting on them') },
        { v: 'over', label: rpT('Ended') }
      ],
      match: function (agreement, value) {
        return value === 'live'
          ? /^(agreed|paused)$/.test(agreement.state)
          : value === 'waiting'
            ? /^(proposed|countered)$/.test(agreement.state)
            : /^(ended|declined)$/.test(agreement.state);
      }
    }
  ];
}
/** paint the Repeat supply tab into #screen: the Finance tabs, the head, then a CBList mount of RP.rows */
function rpMount(frame) {
  var node = document.getElementById('screen');
  if (!node) return;
  if (typeof ftNav === 'function') ftNav();
  node.className = 'screen flush';
  node.innerHTML =
    '<div class="card" id="rp_head" data-testid="rp-head"></div><div id="rp_list" data-testid="rp-list" style="flex:1 1 auto;min-height:0"></div>';
  rpHead();
  RP.api = CBList.mount(document.getElementById('rp_list'), {
    key: 'fin-repeat',
    t: rpT,
    rows: function () {
      return RP.rows;
    },
    id: function (agreement) {
      return agreement.agreement_id;
    },
    rowTid: function (agreement) {
      return 'rp-row-' + agreement.agreement_id;
    },
    columns: rpCols(),
    defaultCols: ['customer', 'next', 'state', 'money', 'last'],
    cardMax: 4,
    fill: false,
    head: function () {
      return { title: rpT('Repeat supply') };
    },
    state: function () {
      return RP.state === 'denied' ? 'ready' : RP.state;
    },
    error: function () {
      return { title: rpT('Could not read your agreements.'), sub: rpT('Nothing was lost. Try again.') };
    },
    onRetry: rpRetry,
    empty: { title: rpT('No repeat supply yet'), sub: rpT('Open a sent bill and press Repeat this…') },
    onOpen: function (agreement) {
      if (typeof openChitSheet === 'function') openChitSheet(agreement.chit_id);
    },
    search: function (agreement) {
      return [agreement.customer && agreement.customer.name, agreement.subject, agreement.words].join(' ');
    },
    sorts: rpSorts(),
    filters: rpFilters()
  });
  if (!frame) rpLoad(RP.rows.length > 0);
}

/* ── "Repeat this…" on a sent invoice: the composer (CBSteps) ─────────────────────────────────────────────── */

function rpDraftOf(model) {
  var today = typeof bkToday === 'function' ? bkToday() : new Date().toISOString().slice(0, 10);
  return { chit_id: model.id, lines: model.lines || [], who: model.who || '', every: 1, unit: 'weekly', start_on: today, until: 'none', runs: 12, on: '', mode: 'draft' };
}
function rpField(label, input) {
  return '<div class="kv"><b style="flex:1 1 140px">' + esc(label) + '</b><span style="flex:1 1 160px">' + input + '</span></div>';
}
/** step 1 of Repeat this…: every how many days, weeks or months, from when, until when */
function rpStepSchedule() {
  var list = RP.draft,
    selectedIf = function (unit) {
      return list.unit === unit ? ' selected' : '';
    },
    checkedIf = function (field, value) {
      return list[field] === value ? ' checked' : '';
    };
  return (
    rpField(
      rpT('Every'),
      '<input data-cbsid="FIN005-I01" class="inp" id="rp_every" data-testid="rp-every" inputmode="numeric" value="' +
        esc(String(list.every)) +
        '" style="width:70px" oninput="CBRepeat.read()"> ' +
        '<select data-cbsid="FIN005-S01" class="inp" id="rp_unit" data-testid="rp-unit" onchange="CBRepeat.read()"><option value="daily"' +
        selectedIf('daily') +
        '>' +
        esc(rpT('day(s)')) +
        '</option><option value="weekly"' +
        selectedIf('weekly') +
        '>' +
        esc(rpT('week(s)')) +
        '</option><option value="monthly"' +
        selectedIf('monthly') +
        '>' +
        esc(rpT('month(s)')) +
        '</option></select>'
    ) +
    rpField(rpT('From'), '<input data-cbsid="FIN005-I02" class="inp" type="date" id="rp_start" data-testid="rp-start" value="' + esc(list.start_on) + '" onchange="CBRepeat.read()">') +
    rpField(
      rpT('Until'),
      '<label><input data-cbsid="FIN005-I03" type="radio" name="rp_until" value="none" data-testid="rp-until-none"' +
        checkedIf('until', 'none') +
        ' onchange="CBRepeat.read()"> ' +
        esc(rpT('You end it')) +
        '</label> ' +
        '<label><input data-cbsid="FIN005-I04" type="radio" name="rp_until" value="runs" data-testid="rp-until-runs"' +
        checkedIf('until', 'runs') +
        ' onchange="CBRepeat.read()"> <input data-cbsid="FIN005-I05" class="inp" id="rp_runs" data-testid="rp-runs" inputmode="numeric" value="' +
        esc(String(list.runs)) +
        '" style="width:60px" oninput="CBRepeat.read()"> ' +
        esc(rpT('runs')) +
        '</label> ' +
        '<label><input data-cbsid="FIN005-I06" type="radio" name="rp_until" value="on" data-testid="rp-until-on"' +
        checkedIf('until', 'on') +
        ' onchange="CBRepeat.read()"> <input data-cbsid="FIN005-I07" class="inp" type="date" id="rp_on" data-testid="rp-on" value="' +
        esc(list.on) +
        '" onchange="CBRepeat.read()"></label>'
    ) +
    rpField(
      rpT('Each run'),
      '<label><input data-cbsid="FIN005-I08" type="radio" name="rp_mode" value="draft" data-testid="rp-mode-draft"' +
        checkedIf('mode', 'draft') +
        ' onchange="CBRepeat.read()"> ' +
        esc(rpT('Draft for me to send')) +
        '</label> ' +
        '<label><input data-cbsid="FIN005-I09" type="radio" name="rp_mode" value="send" data-testid="rp-mode-send"' +
        checkedIf('mode', 'send') +
        ' onchange="CBRepeat.read()"> ' +
        esc(rpT('Send it')) +
        '</label>'
    )
  );
}
/** step 2 of Repeat this…: the schedule in words, read back before Send */
function rpStepReview() {
  var list = RP.draft,
    unitWords = RP_UNIT[list.unit] || [list.unit, list.unit],
    interval = Number(list.every) || 1;
  var until =
    list.until === 'runs'
      ? typeof txn === 'function'
        ? txn('{count} run', '{count} runs', Number(list.runs))
        : list.runs + ' runs'
      : list.until === 'on'
        ? rpT('until') + ' ' + rpDate(list.on)
        : rpT('until you end it');
  return (
    '<div class="kv"><b>' +
    esc(list.who) +
    '</b><span data-testid="rp-review">' +
    esc(
      rpT('every') +
        ' ' +
        (interval > 1 ? interval + ' ' + rpT(unitWords[1]) : rpT(unitWords[0])) +
        ' · ' +
        rpT('from') +
        ' ' +
        rpDate(list.start_on) +
        ' · ' +
        until +
        ' · ' +
        (list.mode === 'send' ? rpT('each run is sent') : rpT('each run is drafted for you'))
    ) +
    '</span></div>' +
    '<p class="hint" data-testid="rp-review-lines">' +
    esc(
      (typeof txn === 'function' ? txn('{count} line', '{count} lines', list.lines.length) : list.lines.length + ' lines') +
        ' · ' +
        rpT('the customer accepts, counters or declines before anything is billed')
    ) +
    '</p>' +
    '<p class="hint" id="rp_send_why" data-testid="rp-send-why"></p>'
  );
}
/** copy the schedule inputs back into RP.draft before a step changes */
function rpRead() {
  var list = RP.draft;
  if (!list) return;
  var node = function (id) {
    var el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  };
  var radioValue = function (groupName) {
    var el = document.querySelector('input[name="' + groupName + '"]:checked');
    return el ? el.value : '';
  };
  if (document.getElementById('rp_every')) {
    list.every = node('rp_every');
    list.unit = node('rp_unit') || list.unit;
    list.start_on = node('rp_start');
    list.until = radioValue('rp_until') || list.until;
    list.runs = node('rp_runs');
    list.on = node('rp_on');
    list.mode = radioValue('rp_mode') || list.mode;
  }
  if (RP.flow) RP.flow.paintFoot();
}
/** what stops the schedule step going on, as a sentence (null = nothing); only the schedule step is checked here */
function rpGuard(stepKey) {
  var list = RP.draft;
  if (!list) return null;
  if (stepKey !== 'schedule') return null;
  var every = Number(list.every);
  if (!(every >= 1 && every <= 365) || every !== Math.floor(every)) return rpT('Every how many? 1 to 365.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(list.start_on)) return rpT('From when?');
  if (list.until === 'runs' && !(Number(list.runs) >= 1)) return rpT('How many runs?');
  if (list.until === 'on' && !/^\d{4}-\d{2}-\d{2}$/.test(list.on)) return rpT('Until when?');
  return null;
}
function rpBody() {
  return {
    chit_id: RP.draft.chit_id,
    every: Number(RP.draft.every),
    unit: RP.draft.unit,
    start_on: RP.draft.start_on,
    until: RP.draft.until === 'runs' ? { runs: Number(RP.draft.runs) } : RP.draft.until === 'on' ? { on: RP.draft.on } : {},
    mode: RP.draft.mode
  };
}
/** the composer over the page's own sheet: Schedule → Review → Send agreement */
function rpStart(chitId, model) {
  if (typeof modal !== 'function' || typeof CBSteps === 'undefined') {
    if (typeof toast === 'function') toast(rpT('Open this bill on the app to repeat it'));
    return;
  }
  if (typeof CBSheet !== 'undefined' && CBSheet.close) CBSheet.close();
  RP.draft = rpDraftOf(model || { id: chitId });
  modal(
    '<div class="mhd"><div class="t" data-testid="rp-title">' +
      esc(rpT('Repeat this bill')) +
      '</div><div class="sub" id="rp_sub"></div></div><div id="rp_rail"></div><div class="mbody" id="rp_body"></div><div class="mfoot" id="rp_foot"></div>'
  );
  if (RP.flow) RP.flow.destroy();
  RP.flow = CBSteps.create({
    steps: [
      { k: 'schedule', n: rpT('Schedule'), t: rpT('How often, from when, until when') },
      { k: 'review', n: rpT('Review'), t: rpT('The customer agrees before anything is billed') }
    ],
    railEl: 'rp_rail',
    bodyEl: 'rp_body',
    footEl: 'rp_foot',
    subEl: 'rp_sub',
    render: function (stepKey) {
      return stepKey === 'schedule' ? rpStepSchedule() : rpStepReview();
    },
    guard: rpGuard,
    sendLabel: rpT('Send agreement'),
    sendTestid: 'rp-send',
    cancelLabel: rpT('Cancel'),
    onCancel: function () {
      closeModal();
    },
    onSend: function () {
      var btn = document.querySelector('[data-testid="rp-send"]');
      return CBAction.run(
        btn,
        function () {
          return api('repeatCreate', { body: rpBody() });
        },
        {
          key: 'rp-send',
          out: 'rp_send_why',
          busy: rpT('Sending…'),
          failed: rpT('Could not send the agreement'),
          outcome: function () {
            closeModal();
            if (typeof toast === 'function') toast(rpT('Agreement sent — waiting for the customer'));
            if (document.getElementById('rp_list')) rpLoad(true);
          }
        }
      );
    }
  });
  RP.flow.paint();
}

/* ── the agreement's panel in the chit sheet (either side) ────────────────────────────────────────────────── */

/** the sheet's model → is this chit an agreement? (business_json.repeat is stamped at send on both copies) */
function rpIsAgreement(model) {
  return !!(model && model.bj && model.bj.repeat && model.bj.repeat.agreement_id);
}
function rpPanelHTML() {
  return (
    '<div class="cs-sec">' +
    esc(rpT('Repeat supply')) +
    '</div><div data-testid="rp-panel" id="rp_panel"><div class="cs-mute">' +
    esc(rpT('Reading…')) +
    '</div></div>'
  );
}
/** mount after the sheet has painted: read the agreement as THIS side sees it and paint the verbs the server allows */
async function rpPanel(model) {
  var el = document.getElementById('rp_panel');
  if (!el || !rpIsAgreement(model)) return;
  var id = model.bj.repeat.agreement_id;
  try {
    var reply = await api('repeatGet', { params: { id: id }, query: { chit: model.id } });
    RP.panel = { id: id, chit: model.id, a: reply.agreement, lines: model.lines || [] };
    rpPanelPaint();
  } catch (e) {
    var words = typeof CBAction !== 'undefined' ? CBAction.words(e, rpT('Could not read the agreement')) : rpT('Could not read the agreement');
    el.innerHTML = '<div class="cs-mute" data-testid="rp-panel-err">' + esc(words) + '</div>';
  }
}
/** paint the agreement's panel in the chit sheet: its state, then the verbs this side may use, greyed with the server's why */
function rpPanelPaint() {
  var el = document.getElementById('rp_panel'),
    agreementPanel = RP.panel;
  if (!el || !agreementPanel) return;
  var agreement = agreementPanel.a,
    seller = agreement.side === 'seller';
  var until = agreement.runs_max
    ? typeof txn === 'function'
      ? txn('{count} run', '{count} runs', agreement.runs_max)
      : agreement.runs_max + ' runs'
    : agreement.end_on
      ? rpT('until') + ' ' + rpDate(agreement.end_on)
      : rpT('until ended');
  var line = rpEvery(agreement) + ' · ' + until + ' · ' + (agreement.mode === 'send' ? rpT('each run is sent') : rpT('each run is drafted'));
  var verbs = seller ? ['run', 'pause', 'resume', 'agree', 'refuse', 'skip', 'end'] : ['accept', 'counter', 'decline', 'skip'];
  var counterOffer = agreement.counter;
  el.innerHTML =
    '<div class="cs-row"><span data-testid="rp-schedule">' +
    esc(line) +
    '</span><span class="tag ' +
    (RP_TONE[agreement.state] || '') +
    '" data-testid="rp-state">' +
    esc(rpT(agreement.words || agreement.state)) +
    '</span></div>' +
    '<div class="cs-row cs-mute"><span>' +
    esc(rpT('Next run')) +
    '</span><span data-testid="rp-next">' +
    esc(/^(agreed|paused)$/.test(agreement.state) ? rpDate(agreement.next_on) : '—') +
    '</span></div>' +
    '<div class="cs-row cs-mute"><span>' +
    esc(rpT('Last run')) +
    '</span><span data-testid="rp-last">' +
    esc(agreement.last_run_on ? rpDate(agreement.last_run_on) + ' · ' + agreement.runs_done : '—') +
    '</span></div>' +
    (agreement.state_note
      ? '<div class="cs-row cs-mute"><span>' + esc(rpT('Note')) + '</span><span data-testid="rp-note">' + esc(agreement.state_note) + '</span></div>'
      : '') +
    (counterOffer ? '<div class="cs-note" data-testid="rp-counter">' + esc(rpT('Proposed change') + ': ' + rpCounterWords(counterOffer, agreementPanel.lines)) + '</div>' : '') +
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 4px" data-testid="rp-verbs">' +
    verbs
      .map(function (item) {
        return rpBtn(agreement, item, 'rp-act-' + item);
      })
      .join('') +
    '</div>' +
    rpSaysHTML(agreement, verbs) +
    '<div id="rp_form" data-testid="rp-form"></div><div class="cs-mute" id="rp_panel_why" data-testid="rp-panel-why"></div>';
}
/** the counter-offer in words: each line's asked quantity against the agreed one */
function rpCounterWords(list, lines) {
  var byId = {};
  (lines || []).forEach(function (item) {
    byId[item.line_id] = item;
  });
  return [
    list.lines
      ? list.lines
          .map(function (x) {
            var line = byId[x.line_id];
            return (line ? line.particulars || line.name || x.line_id : x.line_id) + ' × ' + x.quantity;
          })
          .join(', ')
      : null,
    list.every != null ? rpEvery(list) + ' ' + rpT('from') + ' ' + rpDate(list.start_on) : null,
    list.note || null
  ]
    .filter(Boolean)
    .join(' · ');
}
/** the Counter form: a quantity per line, how often, from when, a note */
function rpCounterForm(panel) {
  var list = panel.a;
  return (
    '<div class="cs-sec">' +
    esc(rpT('Your counter')) +
    '</div>' +
    (panel.lines || [])
      .map(function (item, index) {
        return (
          '<div class="cs-row"><span>' +
          esc(item.particulars || item.name || '') +
          '</span><input data-cbsid="FIN005-I10" class="inp" data-testid="rp-cq-' +
          index +
          '" data-line="' +
          esc(item.line_id || '') +
          '" inputmode="numeric" style="width:70px" value="' +
          esc(String(item.quantity != null ? item.quantity : item.qty || '')) +
          '"></div>'
        );
      })
      .join('') +
    '<div class="cs-row"><span>' +
    esc(rpT('Every')) +
    '</span><span><input data-cbsid="FIN005-I11" class="inp" id="rp_c_every" data-testid="rp-c-every" inputmode="numeric" style="width:60px" value="' +
    esc(String(list.every)) +
    '"> <select data-cbsid="FIN005-S02" class="inp" id="rp_c_unit" data-testid="rp-c-unit">' +
    ['daily', 'weekly', 'monthly']
      .map(function (item) {
        return '<option value="' + item + '"' + (list.unit === item ? ' selected' : '') + '>' + esc(rpT(RP_UNIT[item][0])) + '</option>';
      })
      .join('') +
    '</select></span></div>' +
    '<div class="cs-row"><span>' +
    esc(rpT('From')) +
    '</span><input data-cbsid="FIN005-I12" class="inp" type="date" id="rp_c_start" data-testid="rp-c-start" value="' +
    esc(list.next_on || '') +
    '"></div>' +
    '<input data-cbsid="FIN005-I13" class="inp" id="rp_c_note" data-testid="rp-c-note" placeholder="' +
    esc(rpT('Why (they will read it)')) +
    '" style="width:100%;margin:6px 0">' +
    '<button data-cbsid="FIN005-B03" type="button" class="act sm" data-testid="rp-c-send" onclick="CBRepeat.sendCounter(this)">' +
    esc(rpT('Send counter')) +
    '</button>'
  );
}
/** the reason input and its one button, for the verbs that take a why (skip, decline, end, pause, refuse) */
function rpReasonForm(verb, label, placeholder) {
  return (
    '<div class="cs-row"><input data-cbsid="FIN005-I14" class="inp" id="rp_reason" data-testid="rp-reason" placeholder="' +
    esc(placeholder) +
    '" style="flex:1">' +
    '<button data-cbsid="FIN005-B04" type="button" class="act sm" data-testid="rp-' +
    verb +
    '-go" onclick="CBRepeat.go(\'' +
    verb +
    '\',this)">' +
    esc(label) +
    '</button></div>'
  );
}
/** a verb pressed: the forms that need words first (counter · skip · decline · end · pause · refuse); the rest go straight to the server */
function rpAct(id, verb, btn) {
  var panel = RP.panel;
  var form = document.getElementById('rp_form');
  if (!panel || panel.id !== id) {
    return rpRowAct(id, verb, btn);
  }
  if (verb === 'counter') {
    form.innerHTML = rpCounterForm(panel);
    return;
  }
  if (verb === 'skip') {
    form.innerHTML = rpReasonForm('skip', rpT('Skip it'), panel.a.side === 'customer' ? rpT('Why — they will read it') : rpT('Why (optional)'));
    return;
  }
  if (verb === 'decline' || verb === 'end' || verb === 'pause' || verb === 'refuse') {
    form.innerHTML = rpReasonForm(verb, rpT(RP_VERB[verb]), rpT('Why (optional)'));
    return;
  }
  return rpGo(verb, btn);
}
/** a verb from the LIST row (no panel open): run · agree · resume straight to the server, the row re-read */
function rpRowAct(id, verb, btn) {
  var agreement = RP.rows.filter(function (x) {
    return x.agreement_id === id;
  })[0];
  if (!agreement) return;
  return CBAction.run(
    btn,
    function () {
      return api(rpEpOf(verb), { params: { id: id }, body: {} });
    },
    {
      key: 'rp-' + verb + '-' + id,
      out: 'rp_why',
      failed: rpT('That did not go through'),
      done: rpT(RP_VERB[verb]) + ' ✓',
      outcome: function (reply) {
        rpSaid(verb, reply);
        rpLoad(true);
      }
    }
  );
}
function rpEpOf(verb) {
  return 'repeat' + verb.charAt(0).toUpperCase() + verb.slice(1);
}
/** the sentence said beside the control after a verb: how many ran for run, otherwise what was done */
function rpSaid(verb, reply) {
  var ranCount = verb === 'run' ? ((reply && reply.ran) || []).length : 0;
  var text =
    verb === 'run'
      ? ranCount
        ? typeof txn === 'function'
          ? txn('{count} run made', '{count} runs made', ranCount)
          : ranCount + ' made'
        : rpT('Nothing to run')
      : rpT(RP_VERB[verb]) + ' ✓';
  var panel = document.getElementById('rp_panel_why');
  if (panel) {
    panel.textContent = text;
    panel.setAttribute('data-tone', 'ok');
    return;
  }
  RP.said = { text: text, tone: 'ok' };
  rpHead(); /* the head is repainted on every load: the outcome rides on RP.said */
}
/** run one agreement verb (with the typed reason, if any) through CBAction; End and Decline ask first */
function rpGo(verb, btn) {
  var panel = RP.panel;
  if (!panel) return;
  var reason = (document.getElementById('rp_reason') || {}).value || '';
  var body = Object.assign({ chit_id: panel.chit }, reason ? { reason: String(reason).trim() } : {});
  var confirmation =
    verb === 'end'
      ? { title: rpT('End this agreement?'), body: rpT('No more runs. What was billed stays.'), yes: rpT('End it') }
      : verb === 'decline'
        ? { title: rpT('Decline this agreement?'), body: rpT('The shop is told. Nothing is billed.'), yes: rpT('Decline') }
        : null;
  return CBAction.run(
    btn,
    function () {
      return api(rpEpOf(verb), { params: { id: panel.id }, body: body });
    },
    {
      key: 'rp-' + verb + '-' + panel.id,
      out: 'rp_panel_why',
      confirm: confirmation,
      busy: rpT('Working…'),
      failed: rpT('That did not go through'),
      outcome: function (reply) {
        if (reply && reply.agreement) panel.a = reply.agreement;
        rpPanelPaint();
        rpSaid(verb, reply);
        if (document.getElementById('rp_list')) rpLoad(true);
        /* the sheet's step word (accepted · rejected) is the rail's: read the chit again */
        if ((verb === 'accept' || verb === 'decline') && typeof CBSheet !== 'undefined' && CBSheet.open) CBSheet.open(panel.chit);
      }
    }
  );
}
/** send the customer's counter-offer: one changed quantity per line, through CBAction */
function rpSendCounter(btn) {
  var panel = RP.panel;
  if (!panel) return;
  var lines = [];
  document.querySelectorAll('[data-testid^="rp-cq-"]').forEach(function (item) {
    var typedQuantity = Number(item.value);
    if (item.getAttribute('data-line') && isFinite(typedQuantity)) lines.push({ line_id: item.getAttribute('data-line'), quantity: typedQuantity });
  });
  var node = function (id) {
    var el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  };
  var body = { chit_id: panel.chit, note: node('rp_c_note') };
  var changed = lines.filter(function (x) {
    var line = (panel.lines || []).filter(function (y) {
      return y.line_id === x.line_id;
    })[0];
    return line && Number(line.quantity != null ? line.quantity : line.qty) !== x.quantity;
  });
  if (changed.length) body.lines = changed;
  if (Number(node('rp_c_every')) !== Number(panel.a.every) || node('rp_c_unit') !== panel.a.unit || (node('rp_c_start') && node('rp_c_start') !== panel.a.next_on)) {
    body.every = Number(node('rp_c_every'));
    body.unit = node('rp_c_unit');
    body.start_on = node('rp_c_start');
  }
  return CBAction.run(
    btn,
    function () {
      return api('repeatCounter', { params: { id: panel.id }, body: body });
    },
    {
      key: 'rp-counter-' + panel.id,
      out: 'rp_panel_why',
      busy: rpT('Sending…'),
      failed: rpT('Could not send the counter'),
      outcome: function (reply) {
        if (reply && reply.agreement) panel.a = reply.agreement;
        rpPanelPaint();
        rpSaid('counter', reply);
      }
    }
  );
}

var CBRepeat = {
  start: rpStart,
  read: rpRead,
  isAgreement: rpIsAgreement,
  panelHTML: rpPanelHTML,
  panel: rpPanel,
  act: rpAct,
  go: rpGo,
  sendCounter: rpSendCounter,
  mount: rpMount,
  load: rpLoad
};
