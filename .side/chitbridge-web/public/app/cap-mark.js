/**
 * cap-mark.js — CAP-25 / ACC-358: the MARK & QUERY capability's two library components. A reviewer puts a mark on a record somebody else owns;
 * the owner and the adviser see it at once; a Query is a conversation in the one message thread.
 *
 * OWNS      CMP058 the marker chip (Checked ✓ · Query ? · On hold ‖ · Changed after review ⚠) mounted on a row by `data-mark` · CMP059 the Query sheet (the question, the note box, the set buttons, the thread) ·
 *           the checked-n-of-m bar and the open-queries list with ageing · the one door to GET/POST /api/marks
 * CALLED BY books-grant-view.js (the auditor's and the adviser's books) · books-grant-drill.js (the entry sheet) · cap-books.js (the owner's Day book and ledger)
 * FLOW      use({ adopter, call }) → load(ids) ONE read for the page → chip(id) in each row → a press on a chip: Check = one write; a marked chip opens the sheet → set / reply → repaint every chip of that record
 * CARD      14-accounting/ACC-358-AUDIT-MARKERS-REQUIREMENT · capability/MARK-AND-QUERY-CAPABILITY §5.3
 *
 * ⭐ The server decides. Which marks exist, whether a record changed after its mark (`altered`), who may set (`actions.set`) and who may reply (`actions.reply`) with the sentence for a refusal
 * (`why`) all arrive in the answer; this file paints them and computes nothing. A Query is the question text in the mark's note; replies are CBThread (rail-thread.js, `subject` option): there is NO second composer here.
 * The core has no domain word: the adopter names the vocabulary, the host row names the record.
 *
 *   CBMark.use({ adopter, call?, transport?, title? }) → control
 *     call(key, { query, body })    the page's own api() (EP keys marksRead · marksSet), or
 *     transport(method, path, body) a host with its own headers (the auditor's books grant): the path is this file's own
 *   control.load(ids) → Promise · .chip(id) → html · .row(id) · .set(id, kind, note, button) · .sheet(id, { title }) · .summary() · .bar(host, { onFilter }) · .queries() · .onChange(fn)
 *   CBMark.paint(scope) repaints every `[data-mark]` host under scope from the control's rows.
 */
(function (root) {
  'use strict';
  var markKit = root.CBMarkKit; /* created by cap-mark-sheet.js, which loads first */
  markKit.markText = markText;
  markKit.fill = fill;
  markKit.when = when;
  markKit.addCss = addCss;
  markKit.classOf = classOf;
  markKit.ageWords = ageWords;
  markKit.doc = root.document;
  var CHUNK = 200; /* the server's cap on ids in one read */

  /* the marks' own two routes + the thread pair (rail-thread.js declares those): ONE name each (e2e/ep-aliases.cjs) */
  var MARK_ENDPOINTS = {
    marksRead: { m: 'GET', p: '/api/marks' }, /* ?adopter= &ids=a,b  (a page) or ?adopter= &open=1 (the open list, with ageing and checked n of m) */
    marksSet: { m: 'POST', p: '/api/marks', idem: true } /* { adopter, subject_id, kind: checked|query|on_hold|removed, note } */
  };
  root.CB_MARK_EP = MARK_ENDPOINTS;

  markKit.CLASS = {
    clear: { sym: '✓', word: 'Checked', tone: 'ok' },
    open: { sym: '?', word: 'Query', tone: 'ask' },
    hold: { sym: '‖', word: 'On hold', tone: 'hold' },
    reject: { sym: '✕', word: 'Not accepted', tone: 'bad' }
  };
  var SEND = { clear: 'checked', open: 'query', hold: 'on_hold', removed: 'removed' }; /* the neutral class → the kind the server takes */
  markKit.MARK_WORDS = {
    check: 'Check',
    notChecked: 'Not checked',
    altered: 'Changed after review',
    recheck: 'Re-check needed',
    gone: 'Record not found',
    markChecked: 'Mark checked',
    askQuestion: 'Ask a question',
    putOnHold: 'Put on hold',
    takeOff: 'Take mark off',
    reasonLabel: 'Your question or reason',
    seenBy: 'The owner sees this.',
    needWords: 'Write your question first.',
    close: 'Close',
    saved: 'Saved.',
    failed: 'Not saved. Nothing was changed.',
    readFail: 'Could not read the marks. This does not mean there are none.',
    waiting: 'Waiting {n}',
    day1: '1 day',
    days: '{n} days',
    today: 'today',
    by: 'by {who}',
    changedNote: 'This entry changed after it was checked. Check it again.',
    questionHead: 'Question',
    threadHead: 'Replies',
    replyOff: 'Replies are closed.',
    checkedOf: 'Checked {n} of {m} entries this period',
    allQueries: 'All queries',
    allEntries: 'All entries',
    queryWord: 'Query',
    questionFrom: 'Question from {who}',
    youAnswered: 'You answered',
    theOther: 'the reviewer',
    entryFallback: 'This entry',
    noQueries: 'No open queries.',
    openQueries: 'Open queries',
    everyone: 'Everyone who can see this record'
  };
  function markText(s) {
    return typeof root.tx === 'function' ? root.tx(s) : s;
  }
  function fill(s, v) {
    return String(markText(s)).replace(/\{(\w+)\}/g, function (_, k) { return v[k] == null ? '' : v[k]; });
  }
  /* the one date-time stamp is CBThread.when (rail-thread.js loads first on both pages that load this file) */
  function when(ts) {
    return root.CBThread && root.CBThread.when ? root.CBThread.when(ts) : String(ts || '').replace('T', ' ').slice(0, 16);
  }

  /* ── look: theme tokens only, AA in light and dark (the same tokens rail-thread.js uses) ── */
  var MARK_CSS =
    '.mk{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line,#DDD6C6);border-radius:999px;background:var(--card,#fff);color:var(--ink,#1D1B16);font:inherit;font-size:var(--fs-1,12px);font-weight:700;padding:3px 10px;min-height:28px;cursor:pointer;white-space:nowrap;max-width:100%}' +
    '.mk:focus-visible{outline:2px solid var(--blue,#1f5fa8);outline-offset:2px}' +
    '.mk-s{font-size:var(--fs-2,14px);line-height:1}' +
    '.mk-ok{background:var(--ok-tint,#E6F3EA);border-color:var(--ok,#2E8B57);color:var(--ok-3,#0F5132)}' +
    '.mk-ask{background:var(--blue-tint-bg,#eef4fb);border-color:var(--blue,#1f5fa8);color:var(--blue,#1f5fa8)}' +
    '.mk-hold{background:var(--warn-tint,#FFF4D6);border-color:var(--warn,#B7791F);color:var(--warn-3,#7A4B00)}' +
    '.mk-bad{background:var(--danger-tint,#fbeeec);border-color:var(--disp,#8E3517);color:var(--disp,#8E3517)}' +
    '.mk-alt{background:var(--warn-tint,#FFF4D6);border-color:var(--warn,#B7791F);color:var(--warn-3,#7A4B00);border-style:dashed}' +
    '.mk-ghost{border-style:dashed;color:var(--grey,#5E594D);font-weight:600;background:transparent}' +
    '.mk-ghost:hover{border-color:var(--ok,#2E8B57);color:var(--ok-3,#0F5132)}' +
    '.mk-none{color:var(--grey,#5E594D)}' +
    '.mk-age{font-weight:600;opacity:.85}' +
    '.mk-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0}' +
    '.mk-count{font-size:var(--fs-2,14px);font-weight:700;color:var(--ink,#1D1B16)}' +
    '.mk-meter{display:inline-block;width:90px;height:8px;border-radius:99px;background:var(--line,#DDD6C6);overflow:hidden;vertical-align:middle}' +
    '.mk-meter i{display:block;height:100%;background:var(--ok,#2E8B57)}' +
    '.mk-q{display:flex;flex-direction:column;gap:6px;margin:6px 0}' +
    '.mk-qi{display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;border:1px solid var(--line,#DDD6C6);border-radius:10px;background:var(--card,#fff);padding:8px 10px;font:inherit;text-align:start;cursor:pointer;color:inherit;width:100%}' +
    '.mk-qi:focus-visible{outline:2px solid var(--blue,#1f5fa8)}' +
    '.mk-qi b{display:block;font-size:var(--fs-2,14px)}.mk-qi span.t{display:block;font-size:var(--fs-1,12px);color:var(--grey,#5E594D);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    'dialog.mk-sheet{border:1px solid var(--line,#DDD6C6);border-radius:14px;padding:0;width:min(520px,calc(100vw - 24px));max-height:calc(100vh - 24px);background:var(--card,#fff);color:var(--ink,#1D1B16);overflow:hidden}' +
    'dialog.mk-sheet[open]{display:flex;flex-direction:column;height:min(680px,calc(100dvh - 24px))}' +
    '.mk-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow:hidden}.mk-body>#mk_thread{flex:1 1 auto;min-height:0}.mk-spacer{flex:1 1 auto;display:flex;flex-direction:column;justify-content:flex-end;gap:8px;overflow-y:auto}' +
    '.mk-actbar{display:flex;flex-direction:column;gap:6px}.mk-box{display:flex;gap:8px;align-items:flex-end}.mk-box textarea{flex:1 1 auto;min-width:0;min-height:44px;max-height:140px;resize:none}' +
    'dialog.mk-sheet::backdrop{background:var(--scrim,rgba(0,0,0,.4))}' +
    '.mk-in{padding:14px 16px;display:flex;flex-direction:column;gap:9px;flex:1 1 auto;min-height:0}' +
    '.mk-hd{display:flex;gap:8px;align-items:flex-start;justify-content:space-between}.mk-hd h2{margin:0;font-size:var(--fs-3,17px)}' +
    '.mk-x{border:0;background:transparent;font:inherit;font-size:20px;line-height:1;min-width:44px;min-height:44px;cursor:pointer;color:var(--grey,#5E594D)}' +
    '.mk-sub{font-size:var(--fs-1,12px);color:var(--grey,#5E594D)}' +
    '.mk-quote{border-inline-start:3px solid var(--blue,#1f5fa8);padding:6px 10px;background:var(--blue-tint-bg,#eef4fb);border-radius:0 8px 8px 0;white-space:pre-wrap;font-size:var(--fs-2,14px)}' +
    '.mk-warn{border:1px solid var(--warn,#B7791F);background:var(--warn-tint,#FFF4D6);color:var(--warn-3,#7A4B00);border-radius:8px;padding:7px 10px;font-size:var(--fs-2,14px);font-weight:700}' +
    '.mk-in textarea{width:100%;box-sizing:border-box;border:1px solid var(--line,#DDD6C6);border-radius:9px;padding:9px;font:inherit;font-size:var(--fs-2,14px);min-height:52px;resize:vertical;background:var(--card,#fff);color:inherit}' +
    '.mk-acts{display:flex;gap:8px;flex-wrap:wrap}' +
    '.mk-act{border:1px solid var(--line,#DDD6C6);border-radius:9px;background:var(--card,#fff);color:inherit;font:inherit;font-size:var(--fs-2,14px);font-weight:700;padding:8px 14px;min-height:44px;cursor:pointer}' +
    '.mk-act.ok{background:var(--ok-2,#16693F);border-color:var(--ok-2,#16693F);color:var(--on-accent,#fff)}.mk-act.ask{background:var(--blue,#1f5fa8);border-color:var(--blue,#1f5fa8);color:var(--on-accent,#fff)}' +
    '.mk-act[disabled],.mk-act[aria-disabled=true]{opacity:.55;cursor:not-allowed}' +
    '.mk-out{font-size:var(--fs-1,12px);min-height:1em}.mk-out[data-tone=error]{color:var(--disp,#8E3517);font-weight:700}.mk-out[data-tone=ok]{color:var(--ok-2,#16693F);font-weight:700}' +
    '.mk-why{font-size:var(--fs-1,12px);color:var(--grey,#5E594D)}' +
    '.mk-n{display:none}' +
    '.cbl .cbl-row.mk-wait,.cbl .cbl-lrec.mk-wait{box-shadow:inset 5px 0 0 var(--blue,#1f5fa8)}.cbl .cbl-row.mk-answered,.cbl .cbl-lrec.mk-answered{box-shadow:inset 5px 0 0 var(--line,#DDD6C6)}' +
    '@media (max-width:700px){.mk-ghost .mk-w{display:none}.mk-ghost .mk-n{display:inline}.mk{min-width:44px;min-height:44px;justify-content:center;padding:3px 8px}.mk-act{flex:1 1 40%}dialog.mk-sheet{margin:0;width:100vw;max-width:100vw;max-height:100dvh;border-radius:0}dialog.mk-sheet[open]{height:100dvh}}';
  var cssDone = false;
  function addCss() {
    if (cssDone || !markKit.doc) return;
    cssDone = true;
    var node = markKit.doc.createElement('style');
    node.setAttribute('data-cbmark', '1');
    node.textContent = MARK_CSS;
    (markKit.doc.head || markKit.doc.documentElement).appendChild(node);
  }

  var controls = []; /* every live control, so one repaint reaches every chip on the page */

  /* ── the one door to the server ── */
  function ensureEP() {
    if (typeof root.EP === 'undefined' || !root.EP) return false;
    for (var k in MARK_ENDPOINTS) if (!root.EP[k]) root.EP[k] = MARK_ENDPOINTS[k];
    return true;
  }
  function queryString(query) {
    return Object.keys(query || {}).filter(function (n) { return query[n] !== '' && query[n] != null; }).map(function (n) { return encodeURIComponent(n) + '=' + encodeURIComponent(query[n]); }).join('&');
  }
  function askMark(c, key, o) {
    o = o || {};
    if (c.cfg.transport) {
      var ep = MARK_ENDPOINTS[key], q = queryString(o.query);
      return c.cfg.transport(ep.m, ep.p + (q ? '?' + q : ''), o.body);
    }
    ensureEP();
    return (c.cfg.call || root.api)(key, o);
  }

  /** the row's class: the server's neutral class, else its kind word */
  function classOf(row) {
    var k = row && (row.class || row.kind || row.state);
    return markKit.CLASS[k] ? k : null;
  }
  function listOf(answer) {
    var l = answer && (answer.marks || answer.rows || answer.items || (Array.isArray(answer) ? answer : []));
    if (l && !Array.isArray(l)) l = Object.keys(l).map(function (id) { return Object.assign({ subject_id: id }, l[id]); });
    return l || [];
  }
  function idOf(row) {
    return String(row.subject_id != null ? row.subject_id : row.id);
  }

  /** ONE read for the whole page's ids (200 a call); then every chip repaints */
  function loadMarks(state, ids) {
      var want = (ids || []).map(String).filter(function (id, n, all) { return id && all.indexOf(id) === n; }), parts = [];
      for (var i = 0; i < want.length; i += CHUNK) parts.push(want.slice(i, i + CHUNK));
      return Promise.all(parts.map(function (part) {
        return askMark(state, 'marksRead', { query: { adopter: state.cfg.adopter, ids: part.join(',') } }).then(function (a) {
          state.failed = false;
          listOf(a).forEach(function (row) { state.rows[idOf(row)] = row; });
          if (a && a.actions) { state.may = a.actions; state.on = true; }
          part.forEach(function (id) { if (!state.rows[id]) state.rows[id] = null; }); /* null: read, and no mark */
        });
      })).then(function () { paint(root.document); }, function () { state.failed = true; paint(root.document); });
  }
  /** the books lists carry the mark on each row (no extra trip): take them in, with the root's `mark_actions` (absent = marking is not switched on: no chip is drawn) */
  function ingestMarks(state, list, answer, key) {
      if (!answer || !answer.mark_actions) { state.on = false; return; }
      state.on = true;
      state.may = answer.mark_actions;
      (list || []).forEach(function (e) {
        if (!e || e.entry_id == null) return;
        state.rows[String(e.entry_id)] = e.mark || null;
        var name = markKit.recordName(e, answer);
        if (name) state.names[String(e.entry_id)] = name;
      });
      paint(root.document);
  }
  /** whose turn a Query is, for THIS seat: 'waiting' (it waits for you) · 'answered' (it waits for the other side) · '' (no open Query) */
  function turnOf(state, control, id) {
      var r = state.rows[String(id)];
      if (!r || classOf(r) !== 'open' || r.altered) return '';
      var on = r.waiting_on || (Number(r.message_count) > 0 ? 'auditor' : 'owner');
      return (on === 'owner') === !control.mayCheck(id) ? 'waiting' : 'answered';
  }
  /** the one write: Checked is one press; a Query needs its words, On hold takes a reason (the server says so too) */
  function setMark(state, id, kind, note, button) {
      var body = { adopter: state.cfg.adopter, subject_id: String(id), kind: SEND[kind] || kind };
      if (note) body.note = note;
      var out = state.outEl || null;
      var run = root.CBAction && root.CBAction.run;
      var go = function () { return askMark(state, 'marksSet', { body: body }); };
      var done = function (v) { merge(state, v, String(id)); paint(root.document); fire(state); return v; };
      if (!run) return go().then(done);
      return run(button || null, go, { key: 'mk:' + state.cfg.adopter + ':' + id, busy: markText('Saving…'), out: out, done: markText(markKit.MARK_WORDS.saved), failed: markText(markKit.MARK_WORDS.failed), outcome: done });
  }
  /** the open list + checked n of m, ONE read */
  function summaryOf(state) {
      var span = typeof state.cfg.period === 'function' ? state.cfg.period() : null; /* the period the screen shows: the count is of THAT period (the server's default is the current month) */
      return askMark(state, 'marksRead', { query: Object.assign({ adopter: state.cfg.adopter, open: 1 }, span && span.from && span.to ? { from: span.from, to: span.to } : {}) }).then(function (a) {
        var list = (a && a.open) || [];
        state.sum = { open: list, checked: num(a && a.checked), total: num(a && a.of), why: null };
        if (a && a.actions) state.may = a.actions;
        return state.sum;
      }, function () { state.sum = null; return null; });
  }
  function useMark(cfg) {
    addCss();
    var state = { cfg: cfg || {}, rows: {}, names: {}, may: null, on: false, sum: null, subs: [], failed: false };
    ensureEP();
    controls.push(state);
    var control = {
      load: function (ids) { return loadMarks(state, ids); },
      ingest: function (list, answer, key) { return ingestMarks(state, list, answer, key); },
      row: function (id) { return state.rows[String(id)] || null; },
      /** the record in words ("JV-0002 · 12 Oct 2026 · A$880.00"), as the page last showed it; '' when the page never showed it */
      nameOf: function (id) { return state.names[String(id)] || ''; },
      turn: function (id) { return turnOf(state, control, id); },
      /** the row's left bar: waiting for you = the full bar, answered = the quiet one */
      rowClass: function (id) {
        var t = control.turn(id);
        return t === 'waiting' ? 'mk-wait' : t === 'answered' ? 'mk-answered' : '';
      },
      /** the mark's neutral class for one record, for a filter or a count by the page: { state: 'none'|'clear'|'open'|'hold'|'reject', altered } — the server's words, nothing decided here (A3C) */
      markOf: function (id) {
        var r = state.rows[String(id)];
        return { state: classOf(r) || 'none', altered: !!(r && (r.altered || r.recheck_needed)) };
      },
      mayCheck: function (id) {
        var r = state.rows[String(id)], a = (r && r.actions) || state.may || {};
        return !!(a.set && a.set.ok !== false && a.set.ok != null) || (a.set === true);
      },
      chip: function (id) {
        return '<span class="mk-host" data-mark=\'' + esc(JSON.stringify({ adopter: state.cfg.adopter, id: String(id) })) + '\'>' + markKit.chipHTML(state, String(id)) + '</span>';
      },
      set: function (id, kind, note, button) { return setMark(state, id, kind, note, button); },
      /** the Query sheet for one record (CMP059) */
      sheet: function (id, o) { return markKit.openSheet(state, control, String(id), o || {}); },
      summary: function () { return summaryOf(state); },
      onChange: function (fn) { state.subs.push(fn); },
      state: function () { return { rows: state.rows, sum: state.sum, may: state.may, failed: state.failed }; },
      destroy: function () { controls = controls.filter(function (x) { return x !== state; }); }
    };
    state.ctl = control;
    return control;
  }
  function num(n) { return n == null ? null : Number(n); }
  function fire(c) {
    c.subs.forEach(function (fn) { try { fn(); } catch (failure) { if (root.cbQuiet) root.cbQuiet('mark:subscriber', failure); /* best effort: a listener's fault changes nothing the user sees */ } });
  }
  /** what a write answered becomes the row (the server's answer is the row; nothing is computed) */
  function merge(c, answer, id) {
    var list = listOf(answer && (answer.marks || answer.mark) ? { marks: [].concat(answer.marks || answer.mark) } : answer);
    if (!list.length && answer && classOf(answer)) list = [Object.assign({ subject_id: id }, answer)];
    if (!list.length) { c.rows[id] = undefined; return; }
    list.forEach(function (row) { c.rows[idOf(row)] = classOf(row) === 'removed' ? null : row; });
  }

  /* ── CMP058 the marker chip ── */
  function ageWords(n) {
    n = Number(n);
    if (!(n >= 0)) return '';
    return n < 1 ? markText(markKit.MARK_WORDS.today) : n === 1 ? markText(markKit.MARK_WORDS.day1) : fill(markKit.MARK_WORDS.days, { n: n });
  }
  /** repaint every host: a mark set in the sheet shows in the row behind it, in the drill and in the list, at once */
  function paint(scope) {
    var nodes = (scope || markKit.doc).querySelectorAll ? (scope || markKit.doc).querySelectorAll('[data-mark]') : [];
    Array.prototype.forEach.call(nodes, function (host) {
      var spec;
      try { spec = JSON.parse(host.getAttribute('data-mark')); } catch (failure) { if (root.cbQuiet) root.cbQuiet('mark:spec', failure); return; }
      for (var i = 0; i < controls.length; i++) {
        if (controls[i].cfg.adopter === spec.adopter) { host.innerHTML = markKit.chipHTML(controls[i], String(spec.id)); return; }
      }
    });
  }
  function controlOf(host) {
    var spec;
    try { spec = JSON.parse(host.getAttribute('data-mark')); } catch (failure) { if (root.cbQuiet) root.cbQuiet('mark:spec', failure); return null; }
    for (var i = 0; i < controls.length; i++) if (controls[i].cfg.adopter === spec.adopter) return controls[i];
    return null;
  }
  /** A3C (auditor paper rank 8): a Check repaints the chip, so the button the person pressed is gone and the focus fell to the page top; it goes to the row's new chip instead (the paper's 477-click job keeps its place) */
  function keepFocus(host, pressed, done) {
    if (!done || typeof done.then !== 'function') return;
    done.then(function () {
      if (pressed.isConnected === false || !markKit.doc.activeElement || markKit.doc.activeElement === markKit.doc.body) {
        var next = host.querySelector('button[data-mk]');
        if (next && next.focus) next.focus();
      }
    }, function () { /* a refused write keeps the old chip: nothing to move */ });
  }
  /* one delegated press for every chip (captured: a row's own open handler never sees it) */
  var wired = false;
  function wire() {
    if (wired || !markKit.doc) return;
    wired = true;
    /** a press on a marker button: the Query sheet or the one write for that record */
    function onPress(event) {
      var button = event.target.closest ? event.target.closest('button[data-mk]') : null;
      if (!button) return;
      var host = button.closest('[data-mark]'), hostControl = host && controlOf(host);
      if (!hostControl) return;
      event.stopPropagation();
      event.preventDefault();
      var id = button.getAttribute('data-id');
      if (button.getAttribute('data-mk') === 'check') keepFocus(host, button, hostControl.ctl.set(id, 'clear', '', button));
      else hostControl.ctl.sheet(id, { opener: button });
    }
    markKit.doc.addEventListener('click', onPress, true);
    markKit.doc.addEventListener('keydown', function (event) {
      if ((event.key === 'Enter' || event.key === ' ') && event.target.closest && event.target.closest('button[data-mk]')) event.stopPropagation(); /* a chip's key is the chip's, not the row's */
    }, true);
  }

  /* ── the checked-n-of-m bar and the open-queries list ── */
  function barHTML(c, o) {
    var s = c.sum;
    if (!s) return '';
    var pct = s.total ? Math.round((100 * s.checked) / s.total) : 0;
    var n = (s.open || []).length;
    return '<div class="mk-bar" data-testid="mk-bar" role="group" aria-label="' + esc(markText(markKit.MARK_WORDS.openQueries)) + '">' +
      '<span class="mk-count" data-testid="mk-count">' + esc(fill(markKit.MARK_WORDS.checkedOf, { n: s.checked, m: s.total })) + '</span>' +
      (s.total ? '<span class="mk-meter" aria-hidden="true"><i style="width:' + pct + '%"></i></span>' : '') +
      '<button type="button" class="mk mk-ask" data-cbsid="CMP058-B03" data-mk-filter="1" aria-pressed="' + (o.on ? 'true' : 'false') + '" data-testid="mk-filter"><span class="mk-s" aria-hidden="true">?</span><span class="mk-w">' + esc(markText(o.on ? markKit.MARK_WORDS.allEntries : markKit.MARK_WORDS.allQueries)) + ' · ' + n + '</span></button></div>';
  }
  function queryRows(c, titleOf) {
    var list = (c.sum && c.sum.open) || [];
    if (!list.length) return '<div class="mk-why" data-testid="mk-empty">' + esc(markText(markKit.MARK_WORDS.noQueries)) + '</div>';
    return '<div class="mk-q" data-testid="mk-queries">' + list.map(function (r) {
      var id = idOf(r), cls = classOf(r) || 'open', k = markKit.CLASS[cls];
      return '<button type="button" class="mk-qi" data-cbsid="CMP058-B04" data-mk-q="' + esc(id) + '" data-testid="mk-q-' + esc(id) + '"><span class="mk mk-' + k.tone + '" aria-hidden="true"><span class="mk-s">' + k.sym + '</span></span>' +
        '<span><b>' + esc((titleOf && titleOf(id, r)) || r.subject_label || id) + '</b><span class="t">' + esc(r.note || '') + '</span></span>' +
        '<span class="mk-age mk">' + esc(ageWords(r.age_days)) + '</span></button>';
    }).join('') + '</div>';
  }

  /** mount the bar for a host: [bar][the host's own list]; onFilter(on) flips the host's list to the open ones */
  function bar(markState, host, options) {
    options = options || {};
    var state = { on: false };
    function show() {
      host.innerHTML = barHTML(markState, state);
      var f = host.querySelector('[data-mk-filter]');
      if (f) f.onclick = function () { state.on = !state.on; show(); if (options.onFilter) options.onFilter(state.on); };
    }
    var handle = { repaint: show, on: function () { return state.on; }, refresh: function () { return markState.ctl.summary().then(show); } };
    return handle.refresh().then(function () { return handle; });
  }

  wire();
  root.CBMark = {
    use: function (cfg) {
      var ctl = useMark(cfg), c = controls[controls.length - 1];
      ctl.bar = function (host, o) { return bar(c, host, o); };
      ctl.queries = function (titleOf) { return queryRows(c, titleOf); };
      return ctl;
    },
    paint: paint,
    ageWords: ageWords,
    CLASS: markKit.CLASS
  };
})(typeof window !== 'undefined' ? window : globalThis);
