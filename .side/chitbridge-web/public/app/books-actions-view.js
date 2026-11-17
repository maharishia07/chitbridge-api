/**
 * books-actions-view.js — ACC-176b: THE THREE QUEUES of an adviser firm's work in a store's books (the firm prepares, a colleague reviews, the OWNER accepts and it posts).
 *
 * OWNS      the queues "Prepared by my team" · "To review" · "To accept" as CBLists; per row: Details, Mark reviewed (the firm), Accept (the owner), Send back with a reason; the owner's bulk accept with its confirm that names the reach (store, count, total with currency)
 * CALLED BY books-grant-view.js (the firm's workspace, "Actions" tab) · books-grant-member.js (the owner's "To accept" view)
 * FLOW      mount(host, { call, mode }) → GET /api/books-actions?state=… (headers + store from CBBooksActing) → rows → a row action → confirm (CBAction) → POST …/review | …/return | …/accept with { store_id, body_hash (, total_minor, currency) } → the queue is read again
 * CARD      04-network/ACC-176B-ADVISER-REQUIREMENT
 *
 * Decides nothing: who may review, accept or return, and why not, are the server's answers; a refusal code is said in a plain sentence (CBBooksGrantApi.refusalWords). The only rule kept here is which buttons each role is offered
 * (the firm reviews, the owner accepts, both send back). Every figure is the server's total_minor in the action's own currency; totals are never added across currencies. The state is read again after every write, never guessed.
 *   CBBooksActionsView.mount(host, { call, mode: 'firm' | 'owner', mountList, sheet, closeSheet }) → { destroy }
 *
 * REUSE (named in the PR): CBList (via mountList, bulk select) · CBAction.run (confirm, busy, outcome) · CBBooksActing (headers, store_id, figure, the clear on a store change) · CBBooksGrantApi (endpoints, refusal words)
 */
(function (root) {
  'use strict';
  var LIMIT = 100;
  var QUEUES = [
    { k: 'team', label: 'Prepared by my team', query: { state: 'all' } },
    { k: 'review', label: 'To review', query: { state: 'waiting_review' } },
    { k: 'accept', label: 'To accept', query: { state: 'waiting_accept' } }
  ];
  var KIND = { journal: 'Journal', reverse: 'Reversal', lock: 'Lock a month', unlock: 'Open a month', year_close: 'Close the year' };
  var STATE = { waiting_review: 'Waiting for review', waiting_accept: 'Waiting for the owner', open: 'Open', returned: 'Sent back', accepted: 'Posted', withdrawn: 'Withdrawn: access ended' };
  var OPEN = { waiting_review: 1, waiting_accept: 1, open: 1 };
  var view = { host: null, o: {}, queue: 'team', rows: [], total: 0, why: null, unclear: null };

  function words(s) {
    return typeof root.tx === 'function' ? root.tx(s) : s;
  }
  function $(id) {
    return root.document.getElementById(id);
  }
  function api(key, o) {
    return root.CBBooksGrantApi.run(view.o.call, key, Object.assign({ headers: root.CBBooksActing.headers() }, o));
  }
  function queueOf(k) {
    return QUEUES.filter(function (q) {
      return q.k === k;
    })[0];
  }
  function storeName() {
    return root.CBBooksActing.current().store.name;
  }
  function figure(row) {
    return row.total_minor == null ? '—' : root.CBBooksActing.figure(row.total_minor, row.currency);
  }
  /** R19: a row is named by what a person would call it (the narration or reason it carries), never by the client's own reference */
  function nameOf(row) {
    var body = row.body || {};
    return String(body.narration || body.reason || body.note || '').trim();
  }
  function kindWords(row) {
    return words(KIND[row.kind] || row.kind) + (nameOf(row) ? ' · ' + nameOf(row) : '');
  }
  function stateWords(row) {
    return words(STATE[row.state] || row.state) + (row.access_ended && OPEN[row.state] ? ' (' + words('access ended') + ')' : '');
  }
  /** where the action stands and who prepared it, in one cell (the row says both without a fourth column) */
  function standsWords(row) {
    return stateWords(row) + ' · ' + (row.prepared ? row.prepared.name : '—');
  }
  function byWords(stamp) {
    return stamp ? stamp.name + (stamp.firm ? ', ' + stamp.firm : '') : '—';
  }
  function dayWords(value) {
    return root.shopStamp(value);
  }
  /** the reach of a write in words: how many actions, in which store, and the total of each currency (never one sum across currencies) */
  function reachWords(rows) {
    var sums = {};
    rows.forEach(function (row) {
      if (row.total_minor != null) sums[row.currency] = (sums[row.currency] || 0) + Number(row.total_minor);
    });
    var totals = Object.keys(sums).map(function (code) {
      return root.CBBooksActing.figure(sums[code], code);
    });
    return rows.length + ' ' + words(rows.length === 1 ? 'action' : 'actions') + ' ' + words('in') + ' <b>' + esc(storeName()) + '</b>' + (totals.length ? ', ' + words('total') + ' <b>' + esc(totals.join(' · ')) + '</b>' : '');
  }

  /* ── the read ── */
  /** read the queue on show; an answer that arrives after the store changed is dropped, so one store's rows never land on another's screen */
  function readQueue() {
    var asked = root.CBBooksActing.current().store.id;
    return api('actionsList', { query: Object.assign({ limit: LIMIT, page: 1 }, queueOf(view.queue).query) }).then(
      function (answer) {
        if (root.CBBooksActing.current().store.id !== asked) return false;
        view.rows = (answer && answer.actions) || [];
        view.total = (answer && answer.total) || view.rows.length;
        view.why = null;
        if (view.rows[0]) root.CBBooksActing.setCurrency(view.rows[0].currency);
      },
      function (failure) {
        if (failure.status === 401) throw failure;
        view.rows = [];
        view.why = failure.message || words("Couldn't read the actions. Nothing was changed.");
      }
    );
  }
  function reload() {
    return readQueue().then(function (kept) {
      if (kept !== false) paint();
    });
  }
  /** everything of the previous store goes: its rows, its open sheet (a draft reason), its screen */
  function forget() {
    view.rows = [];
    view.total = 0;
    if (view.o.closeSheet) view.o.closeSheet();
    if (view.host) view.host.innerHTML = '';
  }

  /* ── the screen ── */
  function tabs() {
    return QUEUES.map(function (q) {
      return (
        '<button data-cbsid="NET007-B01" type="button" id="ba_q_' + q.k + '" class="act' + (view.queue === q.k ? '' : ' quiet') + '" data-queue="' + q.k + '" data-testid="ba-q-' + q.k + '" aria-pressed="' + (view.queue === q.k) + '">' + esc(words(q.label)) + '</button>'
      );
    }).join('');
  }
  /** one sentence under the tabs: whose move it is in this queue (the server still decides) */
  function noteWords() {
    if (view.queue === 'accept' && view.o.mode !== 'owner') return words('The owner accepts these. You can see them here.');
    if (view.queue === 'review' && view.o.mode === 'owner') return words('The accountant\'s firm reviews these. You can send one back.');
    if (view.total > view.rows.length) return words('Showing the first') + ' ' + view.rows.length + ' ' + words('of') + ' ' + view.total + '.';
    return '';
  }
  function paint() {
    view.host.innerHTML =
      '<div class="nw-acts" data-testid="ba-tabs" role="group" aria-label="' + esc(words('Actions')) + '">' + tabs() + '</div>' +
      (view.why ? '<div class="nw-why" id="ba_why" role="status" data-testid="ba-why">' + esc(view.why) + '</div>' : '<div class="sub" data-testid="ba-note">' + esc(noteWords()) + '</div>') +
      '<div class="nw-out" id="ba_out" data-testid="ba-out" role="status"></div><div class="nw-list" id="ba_list" data-testid="ba-list"></div>';
    Array.prototype.forEach.call(view.host.querySelectorAll('[data-queue]'), function (button) {
      button.onclick = function () {
        view.queue = button.getAttribute('data-queue');
        reload().then(function () {
          $('ba_q_' + view.queue).focus();
        });
      };
    });
    if (!view.why) paintRows($('ba_list'));
  }
  function col(key, label, prio, w, text, sortValue) {
    return { key: key, label: label, prio: prio, w: w, cell: text, value: sortValue || text };
  }
  function columns() {
    return [
      col('what', words('What'), 1, 200, kindWords),
      col('total', words('Total'), 1, 140, figure, function (row) { return row.total_minor == null ? 0 : Number(row.total_minor); }),
      col('at', words('When'), 2, 150, function (row) { return dayWords(row.prepared && row.prepared.at); }, function (row) { return (row.prepared && row.prepared.at) || ''; }),
      col('state', words('Step and who'), 1, 300, standsWords)
    ];
  }
  /** which row buttons a role is offered in a queue: the firm reviews, the owner accepts, both send back; the server still decides */
  function actionsFor() {
    var owner = view.o.mode === 'owner';
    return [
      { id: 'details', tid: 'ba-details', label: words('Details'), run: openDetails },
      { id: 'review', tid: 'ba-review', label: words('Mark reviewed'), when: function (r) { return !owner && r.state === 'waiting_review'; }, run: askReview },
      { id: 'accept', tid: 'ba-accept', label: words('Accept'), when: function (r) { return owner && r.state === 'waiting_accept'; }, run: function (r) { askAccept([r]); } },
      { id: 'back', tid: 'ba-back-row', label: words('Send back'), when: function (r) { return !!OPEN[r.state]; }, run: openSendBack }
    ];
  }
  function paintRows(host) {
    view.o.mountList(host, {
      key: 'books-actions-' + view.queue,
      rows: function () {
        return view.rows;
      },
      id: function (row) {
        return row.action_id;
      },
      rowTid: function (row) {
        return 'ba-row-' + row.action_id;
      },
      columns: columns(),
      actions: actionsFor(),
      bulk: view.o.mode === 'owner' && view.queue === 'accept' ? [{ id: 'accept', label: words('Accept'), run: function (picked) { askAccept(picked.filter(function (r) { return r.state === 'waiting_accept'; })); } }] : undefined,
      search: function (row) {
        return [kindWords(row), byWords(row.prepared), stateWords(row)].join(' ');
      },
      empty: { title: words('Nothing waiting here'), body: words('When an action reaches this step, it is listed here.') }
    });
  }

  /* ── Details: the steps, who and when, and why it was sent back ── */
  function stepWords(step) {
    var who = step.actor_name ? step.actor_name + (step.firm_name ? ', ' + step.firm_name : '') : '—';
    return '<li data-testid="ba-step-' + esc(step.step) + '"><b>' + esc(words(STATE[step.step] || step.step)) + '</b> · ' + esc(who) + ' · ' + esc(dayWords(step.at)) + (step.reason ? ' — ' + esc(step.reason) : '') + '</li>';
  }
  function openDetails(row) {
    api('actionsGet', { params: { id: row.action_id } }).then(
      function (one) {
        view.o.sheet(
          '<h2>' + esc(kindWords(one)) + '</h2><div class="bg-form" data-testid="ba-detail"><div class="sub">' + esc(figure(one)) + ' · ' + esc(stateWords(one)) + '</div><ol class="ba-steps">' + (one.steps || []).map(stepWords).join('') + '</ol>' +
            '<pre class="ba-body" data-testid="ba-body">' + esc(JSON.stringify(one.body || {}, null, 2)) + '</pre>' +
            '<div class="nw-acts"><button data-cbsid="NET007-B02" type="button" class="act quiet" id="ba_close" data-testid="ba-close">' + esc(words('Close')) + '</button></div></div>'
        );
        $('ba_close').onclick = view.o.closeSheet;
      },
      function (failure) {
        showOutcome(failure.message || words("Couldn't open this action."), 'error');
      }
    );
  }
  function showOutcome(text, tone) {
    var el = $('ba_out');
    if (!el) return;
    el.textContent = text;
    el.setAttribute('data-tone', tone || 'ok');
  }

  /* ── the writes: each asks, each carries the store and the body it was shown, each reads the queue again ── */
  function askReview(row) {
    root.CBAction.run(
      null,
      function () {
        return api('actionsReview', { params: { id: row.action_id }, body: root.CBBooksActing.body({ body_hash: row.body_hash }) });
      },
      {
        key: 'ba-review-' + row.action_id,
        confirm: { title: words('Mark this reviewed?'), body: reachWords([row]) + '. ' + esc(words('The owner accepts it next. Nothing is posted yet.')), yes: words('Mark reviewed'), danger: false },
        failed: words("Couldn't mark it reviewed"),
        out: 'ba_out',
        outcome: reload
      }
    );
  }
  /** Send back opens a sheet for the reason; the draft is forgotten with the store */
  function openSendBack(row) {
    view.o.sheet(
      '<h2>' + esc(words('Send this back?')) + '</h2><div class="bg-form" data-testid="ba-back-form"><div class="sub">' + esc(kindWords(row)) + ' · ' + esc(figure(row)) + '</div>' +
        '<label class="sub" for="ba_reason">' + esc(words('Why (3 to 300 characters)')) + '</label><textarea data-cbsid="NET007-I01" id="ba_reason" class="inp" rows="3" maxlength="300" data-testid="ba-reason"></textarea>' +
        '<div class="nw-out" id="ba_out2" data-testid="ba-out2" role="status"></div>' +
        '<div class="nw-acts"><button data-cbsid="NET007-B03" type="button" class="act" id="ba_send" data-testid="ba-send">' + esc(words('Send back')) + '</button>' +
        '<button data-cbsid="NET007-B04" type="button" class="act quiet" id="ba_cancel" data-testid="ba-cancel">' + esc(words('Cancel')) + '</button></div></div>'
    );
    $('ba_cancel').onclick = view.o.closeSheet;
    $('ba_send').onclick = function () {
      sendBack(row);
    };
    $('ba_reason').focus();
  }
  function sendBack(row) {
    var reason = $('ba_reason').value.trim();
    root.CBAction.run(
      $('ba_send'),
      function () {
        return api('actionsReturn', { params: { id: row.action_id }, body: root.CBBooksActing.body({ body_hash: row.body_hash, reason: reason }) });
      },
      {
        key: 'ba-return-' + row.action_id,
        failed: words("Couldn't send it back"),
        out: 'ba_out2',
        outcome: function () {
          view.o.closeSheet();
          reload().then(function () {
            showOutcome(words('Sent back. Nothing was posted.'));
          });
        }
      }
    );
  }
  /** ONE KEY PER ATTEMPT (not per action: the api records a 409 under its key and would replay it for ever): minted at the press, kept on the row only until an answer under 500 settles it */
  function attemptKey(row) {
    return row.accept_key || (row.accept_key = 'accept-' + row.action_id + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  }
  /** one write per action, in turn, each with the total and currency its own row carries; a refusal on one never stops the rest being tried */
  function acceptEach(rows) {
    var done = { ok: 0, failed: [] };
    return rows.reduce(function (chain, row) {
      return chain.then(function () {
        return api('actionsAccept', { params: { id: row.action_id }, headers: Object.assign({ 'Idempotency-Key': attemptKey(row) }, root.CBBooksActing.headers()), body: root.CBBooksActing.body({ body_hash: row.body_hash, total_minor: row.total_minor, currency: row.currency }) }).then(
          function () {
            delete row.accept_key;
            done.ok++;
          },
          function (failure) {
            if (failure.status && failure.status < 500) delete row.accept_key; /* an answer ends the attempt; a lost answer or a 5xx keeps the key for the retry of THIS press */
            if (failure.status === 401) throw failure;
            done.failed.push(kindWords(row) + ': ' + failure.message);
          }
        );
      });
    }, Promise.resolve()).then(function () {
      return done;
    });
  }
  function outcomeWords(done) {
    var text = done.ok + ' ' + words(done.ok === 1 ? 'action accepted and posted.' : 'actions accepted and posted.');
    return done.failed.length ? text + ' ' + done.failed.length + ' ' + words('not posted') + ': ' + done.failed.join(' ') : text;
  }
  /** Accept (one row, or the rows picked): the confirm names the store, the count and the total with its currency, then each action is accepted with its own total_minor and currency */
  function askAccept(rows) {
    if (!rows.length) return;
    root.CBAction.run(
      null,
      function () {
        return acceptEach(rows);
      },
      {
        key: 'ba-accept-' + rows.map(function (r) { return r.action_id; }).join(','),
        confirm: { title: words('Accept and post?'), body: reachWords(rows) + '. ' + esc(words('They are posted to your books now.')), yes: words('Accept and post'), danger: true },
        failed: words("Couldn't accept"),
        out: 'ba_out',
        outcome: function (done) {
          reload().then(function () {
            showOutcome(outcomeWords(done), done.failed.length ? 'error' : 'ok');
          });
        }
      }
    );
  }

  function mount(host, options) {
    if (view.unclear) view.unclear();
    view = { host: host, o: options, queue: options.mode === 'owner' ? 'accept' : 'review', rows: [], total: 0, why: null, unclear: null };
    view.unclear = root.CBBooksActing.onClear(forget);
    reload();
    return {
      destroy: function () {
        if (view.unclear) view.unclear();
        host.innerHTML = '';
      }
    };
  }
  root.CBBooksActionsView = { mount: mount };
})(typeof window !== 'undefined' ? window : globalThis);
