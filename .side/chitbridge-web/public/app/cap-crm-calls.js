/* cap-crm-calls.js — CB CRM L2: THE CALL DESK. The Calls tab (a CBList mount, the Follow-ups list's own look): today's queue, one-tap outcome buttons.
 * OWNS      the Calls tab (#/calls, crmCalls) · the call script and the outcome buttons (crmCallScriptHTML, crmCallActions, crmCallPick, crmCallSend) · Next (crmCallNext)
 * CALLED BY crm.html (<script src>, after cap-crm-privacy.js) · cap-crm.js (crmRoute → crmCalls on #/calls; the click listener → crmCallClick)
 * FLOW      #/calls → crmCalls() → crmCallsLoad() → CBList rows · caret → crmCallScriptHTML() → an outcome → crmCallSend() → the following row opens · Next → crmCallNext()
 * CARD      11-crm-and-marketing/crm-calls
 * ⭐ THE SERVER DECIDES: GET /api/crm/calls sends the queue AND the list of outcomes; the next-follow-up days and the stage moves live in the API's
 *   lib/crm-calls.js (OUTCOMES). This page only gives each outcome its word and its picture (CALL_WORD · CALL_ICO) and sends { outcome, after? | due_at? }.
 * ⚠️ BEFORE the API's b297 runs an outcome that moves a stage answers 503 LEADS_NOT_MIGRATED: the button is greyed WITH its sentence, and the server still refuses.
 *   Every write goes through CBAction (M64). Never the server's message. Needs cap-crm.js (CRM · crmEdit · crmGo · crmBar · crmNav · crmErrWords) and cap-crm-leads.js (CRM_STAGE · crmStageChip).
 * ⭐ NEW PATHS (rule 4): the Calls list is not a second follow-up list — it paints GET /api/crm/calls (follow-ups due + untouched leads) with the Follow-ups list's own unit; nothing here decides a day or a stage.
 * ⭐ THE CALL SCREEN IS THE ROW'S NEXT LEVEL (W1-CRM, L2C step 2): the caret opens the script for this call's STAGE (CALL_SCRIPT — three lines, this page's copy
 *   keyed by the server's stage, as CALL_WORD is keyed by its outcomes) and a Next button; under it CBList draws the server's outcome buttons. Next writes nothing:
 *   the row that follows opens (CBList open). An outcome saved opens the following row by itself. No new style: the record's `.next` block (crm.html) and `.act`.
 */
'use strict';
var CALLS = { rows: [], outcomes: [], may: { ok: true }, state: 'loading', err: null, loaded: false, gen: 0, api: null, scope: null, late: 0 };
/* the outcome keys are the server's; the words and pictures are this page's (docs/design/ICON-MAP.md rows "Call: …") */
var CALL_WORD = {
  no_answer: 'No answer',
  call_back: 'Call back',
  interested: 'Interested',
  demo_booked: 'Demo booked',
  not_now: 'Not now',
  wrong_number: 'Wrong number'
};
var CALL_ICO = { no_answer: '📵', call_back: '↩', interested: '👍', demo_booked: '📅', not_now: '⏳', wrong_number: '🚫' };
var CALL_PRESET = { today: 'Today', tomorrow: 'Tomorrow', '3days': 'In 3 days' };
var CALL_LAST = 'That was the last call on the list.';
/* the script for each stage the server names (api lib/memberships KINDS.lead_stage): open · ask · close, one line each. A shop's own script,
   when the server sends one on the call (call.script, a later widening), is painted in place of these. */
var CALL_SCRIPT = {
  lead: [
    'Say who you are and where you got their number.',
    'Ask what they are looking for and by when.',
    'Offer a visit or a demo. Agree the next call before you hang up.'
  ],
  demo: [
    'Confirm the demo day and time. Ask who else should see it.',
    'Ask what they want the demo to prove.',
    'After the demo, ask for a trial or the first order.'
  ],
  trial: ['Ask how the trial is going and what got in the way.', 'Fix the one thing that is stopping them.', 'Ask for the first order. Agree the date.'],
  parked: [
    'Ask if anything has changed since you last spoke.',
    'Keep it short. Give one reason to look again.',
    'If it is still not now, agree when to ring again.'
  ],
  lost: ['Thank them. Ask what made them choose otherwise.', 'Note the reason for next time.', 'Leave the door open with one line, no pitch.'],
  customer: ['Ask how the last order went.', 'Ask what they need next.', 'Thank them. Agree the next call.']
};

/** what a call write's failure says, in the shop's words (the server's message is never shown) */
function crmCallWords(e) {
  var code = e && e.data && e.data.code;
  if (code === 'LEADS_NOT_MIGRATED') return tx(CRM_LEADS_WAIT);
  if (code === 'CRM_NOT_MIGRATED') return tx('Calls and follow-ups start after an update. Nothing is lost.');
  if (e && e.status === 403) return crmViewWhy(); /* the server's level gate — the same sentence the greyed button carries (WX-L2C) */
  if (code === 'NEED_DAY') return tx('Pick a day.');
  if (code === 'BAD_DUE' || code === 'BAD_AFTER') return tx('Pick a day from today.');
  if (code === 'NOT_FOUND') return tx('Not your party.');
  return tx("Couldn't save that. Try again.");
}

/* ═══ THE READ ═══════════════════════════════════════════════════════════════════════════════════════════════════ */
/* every page of the queue, to the server's total (W2-CRM: the one pager — never a silent cut at 300); the first page carries the outcomes, may and shop_day */
async function crmCallsRead(scope) {
  var head = null;
  var rows = await CBList.every(function (page) {
    return api('crmCalls', { query: { scope: scope, page: page, limit: CRM_PAGE } }).then(function (answer) {
      if (!head) head = answer || {};
      return answer;
    });
  }, 'calls');
  return { rows: rows, head: head || {} };
}
/* what the first page said, kept once: the rows, the outcome table, the server's may, the late count and the shop's day */
function crmCallsApply(read) {
  var head = read.head;
  CALLS.rows = read.rows.map(function (item) {
    return Object.assign({ id: item.followup_id || 'new-' + item.party_id }, item);
  });
  CALLS.outcomes = head.outcomes || [];
  CALLS.may = head.may || { ok: true };
  CALLS.late = Number(head.late) || 0;
  crmMaySet(head.may);
  if (head.shop_day) CRM.shopDay = head.shop_day; /* the server's may.write and its day, kept once for every CRM screen */
}
async function crmCallsLoad(quiet) {
  var g = ++CALLS.gen;
  if (!quiet || !CALLS.loaded) {
    CALLS.state = 'loading';
    crmCallsRefresh();
  }
  try {
    var read = await crmCallsRead(CALLS.scope || (crmOwner() ? 'all' : 'mine'));
    if (g !== CALLS.gen) return;
    crmCallsApply(read);
    CALLS.state = 'ready';
    CALLS.loaded = true;
    CALLS.err = null;
  } catch (e) {
    if (g !== CALLS.gen) return;
    if (CALLS.loaded) CALLS.state = 'ready';
    else {
      CALLS.state = e && e.status === 503 ? 'notyet' : 'error';
      CALLS.err = e;
    }
  }
  crmNav(CRM.route && CRM.route.nav);
  crmCallsRefresh();
}
/* the outcome buttons are the SERVER's table, read with the queue: the list is mounted before the read answers, so every refresh hands it the
   current table (WX-L2C, real stack 2026-10-13: the first open of Calls had no caret and no outcome — the mount's actions were the empty list) */
function crmCallsRefresh() {
  var a = CALLS.api;
  if (a && a.el && document.body.contains(a.el)) a.refresh({ actions: crmCallActions() });
}

/* ═══ THE ROW ════════════════════════════════════════════════════════════════════════════════════════════════════ */
function crmCallPhone(c) {
  /* R4: a "do not call" party — the server says may_call:false with the sentence (call_why); the number is shown, the tap-to-call is not */
  if (c.phone && c.may_call === false)
    return (
      '<span data-testid="crm-call-nocall-' +
      esc(c.party_id) +
      '">' +
      esc(c.phone) +
      '</span> <span class="sub">' +
      esc(c.call_why || tx('Do not call')) +
      '</span>'
    );
  return c.phone
    ? '<a href="tel:' + esc(String(c.phone).replace(/\s+/g, '')) + '" data-testid="crm-call-tel-' + esc(c.party_id) + '">' + esc(c.phone) + '</a>'
    : '<span class="sub">' + esc(tx('no phone')) + '</span>';
}
function crmCallDue(c) {
  if (c.new) return '<span class="tag on" data-testid="crm-call-new">' + esc(tx('New')) + '</span>';
  if (c.late) return '<span class="late red">⚠ ' + esc(tx('Late')) + ' · ' + esc(bkDate(c.due_day)) + '</span>';
  return esc(tx('Today'));
}
function crmCallLast(c) {
  return c.last_outcome
    ? esc(tx(c.last_outcome)) + (c.last_at ? ' <span class="sub">' + esc(bkDate(c.last_at)) + '</span>' : '')
    : '<span class="sub">—</span>';
}
/** why this outcome is greyed for this login — the sentence; '' = allowed (the server still refuses) */
function crmCallWhy(o) {
  return function () {
    if (!crmEdit()) return crmViewWhy();
    if (o.moves && CALLS.may && CALLS.may.ok === false) return tx(CRM_LEADS_WAIT);
    return '';
  };
}
function crmCallActions() {
  return (CALLS.outcomes || []).map(function (item) {
    return {
      id: item.key,
      label: tx(CALL_WORD[item.key] || item.key),
      icon: CALL_ICO[item.key] || '•',
      tid: 'crm-call-' + item.key,
      why: crmCallWhy(item),
      run: function (c) {
        crmCallPick(c, item);
      }
    };
  });
}

/* ═══ THE CALL SCREEN: the row's next level ══════════════════════════════════════════════════════════════════════ */
/** what to say on THIS call: the script for its stage (the server's lines when it sends them, else this page's), then Next; CBList draws the outcomes under it */
function crmCallScriptHTML(call) {
  var stage = call.stage || 'lead';
  var lines = (call.script && call.script.length ? call.script : CALL_SCRIPT[stage]) || CALL_SCRIPT.lead;
  var scriptRows = lines
    .map(function (line, index) {
      return '<div class="nx"><span class="tx" data-testid="crm-call-line-' + (index + 1) + '">' + (index + 1) + ' · ' + esc(tx(line)) + '</span></div>';
    })
    .join('');
  var about = call.what ? esc(tx('Follow-up')) + ': ' + esc(tx(call.what)) : esc(tx('First call'));
  return (
    '<section class="next" aria-label="' +
    esc(tx('Script')) +
    '" data-testid="crm-call-script" data-stage="' +
    esc(stage) +
    '">' +
    '<div class="nh">' +
    esc(tx('Script')) +
    ' · ' +
    esc(tx(CRM_STAGE[stage] || stage)) +
    '</div>' +
    scriptRows +
    '<div class="nx"><span class="tx"><span class="s">' +
    about +
    '</span></span><span class="btns">' +
    '<button data-cbsid="CRM005-B01" type="button" class="act sm ghost" data-crm="callnext" data-id="' +
    esc(call.id) +
    '" data-testid="crm-call-next">' +
    esc(tx('Next')) +
    ' ▸</button></span></div></section>'
  );
}
/** the id of the row painted after `rowId` in the Calls list (the order the person sees), or null when it is the last one shown */
function crmCallFollowing(rowId) {
  var host = CALLS.api && CALLS.api.el;
  if (!host) return null;
  var rowEls = [].slice.call(host.querySelectorAll('[data-row]')),
    at = -1;
  rowEls.forEach(function (rowEl, index) {
    if (rowEl.getAttribute('data-row') === String(rowId)) at = index;
  });
  var following = at >= 0 ? rowEls[at + 1] : null;
  return following ? following.getAttribute('data-row') : null;
}
/** Next: nothing is written — this row closes and the one that follows opens with its own script; the last row says so */
function crmCallNext(rowId) {
  var following = crmCallFollowing(rowId),
    listApi = CALLS.api;
  if (!listApi) return;
  listApi.open(rowId, false);
  if (!following) {
    toast(tx(CALL_LAST));
    return;
  }
  listApi.open(following, true);
}

/* ═══ THE ONE TAP ════════════════════════════════════════════════════════════════════════════════════════════════ */
function crmCallPick(c, o) {
  if (!o.ask) {
    crmCallSend(c, o, {}, null);
    return;
  }
  CALLS.pick = { c: c, o: o };
  ui.dialog({
    mount: 'CRM005-U201',
    pop: 'POP096',
    titleText: tx(CALL_WORD[o.key] || o.key) + ' · ' + (c.party_name || ''),
    testid: 'crm-call-ask',
    body:
      '<div class="supacts">' +
      (o.presets || [])
        .map(function (item) {
          return (
            '<button data-cbsid="CRM005-B02" type="button" class="act ghost" data-crm="callafter" data-v="' +
            esc(item) +
            '" data-testid="crm-call-after-' +
            esc(item) +
            '">' +
            esc(tx(CALL_PRESET[item] || item)) +
            '</button>'
          );
        })
        .join('') +
      '</div>' +
      '<label>' +
      esc(tx('Pick a day')) +
      '<input data-cbsid="CRM005-I01" class="inp" type="date" id="crm_call_day" data-testid="crm-call-day"></label>' +
      '<div id="crm_call_msg" class="hint" role="status" data-testid="crm-call-msg"></div>',
    actions: [
      { name: 'cancel', options: { mount: 'CRM005-U201' } },
      { name: 'save', options: { mount: 'CRM005-U201', key: 'save', effect: 'preference', testid: 'crm-call-day-save', data: { crm: 'callday' } } }
    ]
  });
}
/** the one write (M64): the outcome goes to the server; saved → this call leaves the queue and the row that followed it opens, so the next call is on screen */
function crmCallSend(call, chosen, extra, btn) {
  var msg = document.getElementById('crm_call_msg');
  return CBAction.run(
    btn,
    async function () {
      return api('crmOutcome', {
        params: { id: call.party_id },
        body: Object.assign({ outcome: chosen.key, followup_id: call.followup_id || undefined }, extra)
      });
    } /* R5: the call answers the follow-up its row came from, nobody else's */,
    {
      key: 'call-outcome:' + call.party_id,
      busy: btn ? tx('Saving…') : undefined,
      onFail: function (words, e) {
        if (msg) msg.textContent = crmCallWords(e);
        else toast(crmCallWords(e));
      },
      outcome: async function (r) {
        var following = crmCallFollowing(call.id); /* read before the row leaves the list */
        closeModal();
        toast(r && r.suggest ? tx('Saved. Try Not now?') : tx('Saved'));
        CALLS.rows = CALLS.rows.filter(function (x) {
          return x.party_id !== call.party_id;
        });
        crmCallsRefresh();
        if (following && CALLS.api) CALLS.api.open(following, true);
        await crmCallsLoad(true);
        crmLoad(true);
        if (typeof LEADS !== 'undefined' && LEADS.loaded) crmLeadsLoad(true);
      }
    }
  );
}
/** the page's delegated click (cap-crm.js crmClick) hands the call desk's own buttons here: the "when?" picks and Next */
function crmCallClick(action, target) {
  if (action === 'callnext') {
    crmCallNext(target.getAttribute('data-id'));
    return true;
  }
  if (action === 'callafter' || action === 'callday') {
    var picked = CALLS.pick;
    if (!picked) return true;
    var extra = {};
    if (action === 'callafter') extra.after = target.getAttribute('data-v');
    else {
      var node = String((document.getElementById('crm_call_day') || {}).value || ''),
        msg = document.getElementById('crm_call_msg');
      if (!node) {
        if (msg) msg.textContent = tx('Pick a day.');
        return true;
      }
      extra.due_at = node;
    }
    crmCallSend(picked.c, picked.o, extra, target);
    return true;
  }
  return false;
}

/* ═══ THE CALLS TAB ═════════════════════════════════════════════════════════════════════════════════════════════ */
function crmCalls(frame) {
  crmBar('<strong>' + esc(crmAppName()) + '</strong>', '', true);
  var node = document.getElementById('screen');
  node.className = 'screen flush';
  node.innerHTML = '<div id="crm_calls" data-testid="crm-calls"></div>';
  /* no destroy() here: the old #crm_calls left the page with the innerHTML above, and CBList.mount prunes every instance whose element is gone (list-ctl.js prune) — the old try/catch was an empty catch */
  var def = crmOwner() ? 'all' : 'mine',
    el = document.getElementById('crm_calls');
  CALLS.api = CBList.mount(el, {
    key: 'crm-calls',
    t: tx,
    rows: function () {
      return CALLS.state === 'ready' ? CALLS.rows : [];
    },
    id: function (c) {
      return c.id;
    },
    rowTid: function (c) {
      return 'crm-call-row-' + c.party_id;
    },
    columns: [
      {
        key: 'party',
        label: 'Lead',
        prio: 1,
        w: 260,
        html: true,
        cell: function (c) {
          return '<span class="nm">' + esc(c.party_name || '—') + '</span>';
        },
        value: function (c) {
          return c.party_name;
        }
      },
      {
        key: 'phone',
        label: 'Phone',
        prio: 2,
        w: 170,
        html: true,
        cell: crmCallPhone,
        value: function (c) {
          return c.phone || '';
        }
      },
      {
        key: 'stage',
        label: 'Stage',
        prio: 3,
        w: 130,
        html: true,
        cell: function (c) {
          return crmStageChip({ stage: c.stage });
        },
        value: function (c) {
          return c.stage;
        }
      },
      {
        key: 'due',
        label: 'Due',
        prio: 4,
        w: 170,
        html: true,
        cell: crmCallDue,
        value: function (c) {
          return c.due_day || '0000';
        }
      },
      {
        key: 'last',
        label: 'Last call',
        prio: 5,
        w: 200,
        html: true,
        cell: crmCallLast,
        value: function (c) {
          return c.last_at || '';
        }
      }
    ],
    defaultCols: ['party', 'phone', 'due'],
    cardMax: 3,
    fill: false,
    head: function () {
      return { title: tx('Calls'), chips: CALLS.state === 'ready' && !CALLS.rows.length ? [{ text: tx('No calls today'), tid: 'crm-calls-none' }] : [] };
    },
    state: function () {
      return CALLS.state === 'loading' ? 'loading' : CALLS.state === 'error' ? 'error' : null;
    },
    error: function () {
      return crmErrWords(CALLS.err, 'your calls');
    },
    onRetry: function () {
      crmCallsLoad();
    },
    empty: function () {
      return CALLS.state === 'notyet'
        ? { title: tx('Calls and follow-ups start after an update.'), sub: tx('Nothing is lost.') }
        : { title: tx('No calls today.'), sub: tx('Add leads, or log a call with a follow-up.') };
    },
    search: function (c) {
      return [c.party_name, c.phone].join(' ');
    },
    searchHint: tx('Name or phone'),
    filters: [
      {
        key: 'scope',
        label: tx('Show'),
        all: tx(def === 'all' ? 'Everyone' : 'Mine'),
        options: [{ v: def === 'all' ? 'mine' : 'all', label: tx(def === 'all' ? 'Mine' : 'Everyone') }],
        match: function () {
          return true;
        }
      }
    ],
    onOpen: function (c) {
      crmGo('#/party/' + encodeURIComponent(c.party_id));
    },
    next: crmCallScriptHTML /* the caret opens the call screen: the stage's script + Next, then the server's outcomes (CBList draws `actions` under `next`) */,
    actions: crmCallActions()
  });
  crmWatch(el, function (c) {
    CALLS.scope = c.filt.scope || def;
    crmCallsLoad();
  });
  if (!frame) crmCallsLoad(CALLS.loaded);
}
