/**
 * cap-mark-sheet.js — CMP058/CMP059 part of cap-mark.js: the chip and the Query sheet.
 *
 * OWNS      the marker chip's html (state, age, who) and the Query sheet (CMP059): the record's thread, the composer and the set / clear / reply acts
 * CALLED BY cap-mark.js (through root.CBMarkKit); loaded before it on accounts.html and network.html
 * FLOW      markKit.chipHTML(state, id) → the chip; markKit.openSheet(state, control, options) → the sheet's dialog
 * CARD      14-accounting/ACC-358-AUDIT-MARKERS-REQUIREMENT · capability/MARK-AND-QUERY-CAPABILITY §5.3
 *
 * Paints the server's marks and sends the person's own acts through the page's call; decides nothing.
 */
(function (root) {
  'use strict';
  var markKit = (root.CBMarkKit = root.CBMarkKit || {});
  /** a fault that changes nothing the person sees is still told to the log */
  function quietly(where, failure) {
    if (root.cbQuiet) root.cbQuiet(where, failure);
  }
  markKit.recordName = recordName;
  markKit.chipHTML = chipHTML;
  markKit.openSheet = openSheet;
  /** the record's name for a sheet title: its number, its day (the shop's way) and its amount in its own currency; whatever the row does not carry is left out (never the record id) */
  function recordName(e, answer) {
    var no = e.entry_no || e.subject_label;
    if (!no) return '';
    var minor = recordMinor(e), currencyCode = e.currency || (answer && answer.currency) || '';
    var amount = minor != null && currencyCode ? moneyText(minor, currencyCode) : '';
    return [no, dayText(e.posting_date || e.date), amount].filter(Boolean).join(' · ');
  }
  /** the record's amount in minor units: the row's own total, else the debit side of its lines (the Day book's own amount), else its one side */
  function recordMinor(e) {
    var minor = e.total_minor != null ? e.total_minor : e.amount_minor;
    if (minor == null && Array.isArray(e.lines)) minor = e.lines.reduce(function (sum, l) { return sum + Number(l.dr_minor || 0); }, 0); /* the Day book's own amount: the debit side of its lines */
    if (minor == null) minor = Number(e.dr_minor) > 0 ? e.dr_minor : Number(e.cr_minor) > 0 ? e.cr_minor : null;
    return minor;
  }
  /** an amount in its own currency (the page's money painter when it has one) */
  function moneyText(minor, currencyCode) {
    return typeof root.fmtMoney === 'function' ? root.fmtMoney({ amount_minor: String(minor), currency: currencyCode }) : String(minor) + ' ' + currencyCode;
  }
  /** the record's day the shop's way ('' when the row carries none) */
  function dayText(postingDay) {
    if (!postingDay) return '';
    return typeof root.shopDay === 'function' ? root.shopDay(String(postingDay).slice(0, 10)) : String(postingDay).slice(0, 10);
  }
  function chipHTML(state, id) {
    var record = state.rows[id];
    if (!state.on && !record) return '';
    if (record === undefined) return '<span class="mk-none" aria-hidden="true">…</span>';
    if (state.failed && !record) return '<span class="mk-none" role="img" aria-label="' + esc(markKit.markText(markKit.MARK_WORDS.readFail)) + '" title="' + esc(markKit.markText(markKit.MARK_WORDS.readFail)) + '">!</span>';
    var markClass = markKit.classOf(record);
    if (!record || !markClass) return emptyChip(state, id);
    return markedChip(state, id, record, markClass);
  }
  /** no mark yet: a quiet dash for a reader who may not mark, else the ghost buttons (check · ask) */
  function emptyChip(state, id) {
    if (!state.ctl.mayCheck(id)) return '<span class="mk-none" title="' + esc(markKit.markText(markKit.MARK_WORDS.notChecked)) + '">—</span>';
    return '<button type="button" class="mk mk-ghost" data-cbsid="CMP058-B01" data-mk="check" data-id="' + esc(id) + '" aria-label="' + esc(markKit.markText(markKit.MARK_WORDS.markChecked)) + '" title="' + esc(markKit.markText(markKit.MARK_WORDS.markChecked)) + '"><span class="mk-s" aria-hidden="true">○</span><span class="mk-w">' + esc(markKit.markText(markKit.MARK_WORDS.check)) + '</span><span class="mk-n">' + esc(markKit.markText(markKit.MARK_WORDS.notChecked)) + '</span></button>' +
      ' <button type="button" class="mk mk-ghost" data-cbsid="CMP058-B05" data-mk="ask" data-id="' + esc(id) + '" aria-label="' + esc(markKit.markText(markKit.MARK_WORDS.askQuestion)) + '" title="' + esc(markKit.markText(markKit.MARK_WORDS.askQuestion)) + '"><span class="mk-s" aria-hidden="true">?</span><span class="mk-n">' + esc(markKit.markText(markKit.MARK_WORDS.queryWord)) + '</span></button>';
  }
  /** a mark: its word, its age and who set it, as one button that opens the sheet */
  function markedChip(state, id, record, markClass) {
    var altered = record && (record.altered || record.recheck_needed);
    var look = chipLook(state, id, record, markClass, altered), word = look.word, tone = look.tone, symbol = look.symbol;
    var ageText = (markClass === 'open' || markClass === 'hold') && record.age_days != null ? ' <span class="mk-age">· ' + esc(markKit.ageWords(record.age_days)) + '</span>' : '';
    return '<button type="button" class="mk ' + tone + '" data-cbsid="CMP058-B02" data-mk="open" data-id="' + esc(id) + '" data-class="' + esc(markClass) + '"' + (altered ? ' data-altered="1"' : '') +
      ' aria-label="' + esc(word + (record.by_name ? ' ' + markKit.fill(markKit.MARK_WORDS.by, { who: record.by_name }) : '')) + '" title="' + esc(word + (record.by_name ? ' ' + markKit.fill(markKit.MARK_WORDS.by, { who: record.by_name }) : '')) + '"><span class="mk-s" aria-hidden="true">' + symbol + '</span><span class="mk-w">' + esc(word) + ageText + '</span></button>';
  }
  /** the chip's word, tone and symbol: the mark's own, or whose turn it is, or "altered" when the entry changed after it was checked */
  function chipLook(state, id, record, markClass, altered) {
    var k = markKit.CLASS[markClass], word = (record.label && !altered) ? record.label : markKit.markText(k.word), tone = 'mk-' + k.tone, symbol = k.sym;
    word = turnWord(state, id, record, word);
    if (altered) { word = record.recheck_needed && !record.altered ? markKit.markText(markKit.MARK_WORDS.recheck) : markKit.markText(markKit.MARK_WORDS.altered); tone = 'mk-alt'; symbol = '⚠'; }
    return { word: word, tone: tone, symbol: symbol };
  }
  /** a Query waiting on someone else is worded as that side's question or as answered; otherwise the mark's own word stands */
  function turnWord(state, id, record, word) {
    var turn = state.ctl.turn(id);
    if (turn && !state.ctl.mayCheck(id)) return turn === 'waiting' ? markKit.fill(markKit.MARK_WORDS.questionFrom, { who: record.by_firm || record.by_name || markKit.markText(markKit.MARK_WORDS.theOther) }) : markKit.markText(markKit.MARK_WORDS.youAnswered); /* the owner's words: who asked, and whose turn it is (Athi, W15-25) */
    return word;
  }

  /** what the sheet shows about one record: its mark, what this seat may do, the open thread, and which box asks (reply in the thread, or the one note box) */
  /** the state word: the mark's own, "altered" when the entry changed after it was checked, "Not checked" with none */
  function sheetWord(record, markClass, altered) {
    if (!markClass) return markKit.markText(markKit.MARK_WORDS.notChecked);
    if (altered) return markKit.markText(markKit.MARK_WORDS.altered);
    return record.label || markKit.markText(markKit.CLASS[markClass].word);
  }
  /** the sheet's title: the record in words as the page last showed it, else the host's title, else a plain fallback */
  function sheetTitle(state, id, options) {
    return state.names[id] || options.title || (state.cfg.title && state.cfg.title(id)) || markKit.markText(markKit.MARK_WORDS.entryFallback);
  }
  /** the thread's reply box is the composer when there is a thread, the seat may reply and the Query is still open */
  function replyAllowed(thread, actions, markClass) {
    var open = markClass === 'open' || markClass === 'hold' || !markClass;
    return !!thread && !(actions.reply && actions.reply.ok === false) && open;
  }
  /** the question as the thread's first line: who asked, when, and whether it is mine */
  function leadOf(record, maySet) {
    return record && record.note ? { who: record.by_name || '', at: record.at, text: record.note, mine: maySet, tid: 'mk-question' } : null;
  }
  function sheetModel(state, id, options) {
    var record = state.rows[id] || null, markClass = markKit.classOf(record);
    var actions = (record && record.actions) || state.may || {}, maySet = !!(actions.set && actions.set.ok !== false);
    var altered = record && (record.altered || record.recheck_needed);
    var word = sheetWord(record, markClass, altered);
    var thread = record && record.thread_id;
    var title = sheetTitle(state, id, options);
    /* the open query with its thread: the reply box IS the composer (no second box); else the one note box asks the question */
    var replyOk = replyAllowed(thread, actions, markClass);
    var noteMode = maySet && !replyOk;
    var lead = leadOf(record, maySet);
    return { record: record, markClass: markClass, actions: actions, maySet: maySet, altered: altered, word: word, thread: thread, title: title, replyOk: replyOk, noteMode: noteMode, lead: lead };
  }
  /** the dialog itself, named for a reader and coded (CMP059) */
  function sheetDialog() {
    var dialog = markKit.doc.createElement('dialog');
    dialog.className = 'mk-sheet';
    dialog.setAttribute('data-cbsid', 'CMP059-D01');
    dialog.setAttribute('data-pop', 'CMP059');
    dialog.setAttribute('data-testid', 'mk-sheet');
    dialog.setAttribute('aria-label', markKit.markText(markKit.MARK_WORDS.questionHead));
    return dialog;
  }
  /** the sheet's body: the title and the mark, the reason it was altered, the thread slot, the action bar and the one note box */
  /** the action bar: Checked · On hold · Take off for a seat that may set, the reason it may not otherwise, and the line the outcome is said on */
  function sheetActBar(model) {
    var markClass = model.markClass, actions = model.actions, maySet = model.maySet;
    return (
      '<div class="mk-actbar" data-testid="mk-actbar">' +
      (maySet
        ? '<div class="mk-acts"><button type="button" class="mk-act ok" data-cbsid="CMP059-B02" data-mk-act="clear" data-testid="mk-set-clear">✓ ' + esc(markKit.markText(markKit.MARK_WORDS.markChecked)) + '</button>' +
          '<button type="button" class="mk-act" data-cbsid="CMP059-B04" data-mk-act="hold" data-testid="mk-set-hold">‖ ' + esc(markKit.markText(markKit.MARK_WORDS.putOnHold)) + '</button>' +
          (markClass ? '<button type="button" class="mk-act" data-cbsid="CMP059-B05" data-mk-act="removed" data-testid="mk-set-removed">' + esc(markKit.markText(markKit.MARK_WORDS.takeOff)) + '</button>' : '') + '</div>'
        : (actions.set && actions.set.why ? '<div class="mk-why" data-testid="mk-why">' + esc(actions.set.why) + '</div>' : '')) +
      '<div class="mk-out" role="status" data-testid="mk-out" data-tone=""></div></div>'
    );
  }
  /** the one note box that asks the question (when the thread is not the composer) */
  function sheetNoteBox(model) {
    return (
      (model.noteMode
        ? '<label class="mk-sub" for="mk_note">' + esc(markKit.markText(markKit.MARK_WORDS.reasonLabel)) + ' · ' + esc(markKit.markText(markKit.MARK_WORDS.seenBy)) + '</label>' +
          '<div class="mk-box"><textarea id="mk_note" rows="1" data-cbsid="CMP059-T01" data-testid="mk-note" maxlength="1000"></textarea>' +
          '<button type="button" class="mk-act ask" data-cbsid="CMP059-B03" data-mk-act="open" data-testid="mk-set-open" aria-disabled="true">? ' + esc(markKit.markText(markKit.MARK_WORDS.askQuestion)) + '</button></div>'
        : '')
    );
  }
  function sheetHTML(model) {
    var record = model.record, markClass = model.markClass, actions = model.actions, maySet = model.maySet, altered = model.altered, word = model.word, thread = model.thread, title = model.title, replyOk = model.replyOk, noteMode = model.noteMode, lead = model.lead;
    return (
      '<div class="mk-in"><div class="mk-hd"><div><h2 data-testid="mk-title">' + esc(title) + '</h2>' +
      '<div class="mk-sub" data-testid="mk-state">' + (markClass ? '<span class="mk mk-' + (altered ? 'alt' : markKit.CLASS[markClass].tone) + '" style="cursor:default"><span class="mk-s" aria-hidden="true">' + (altered ? '⚠' : markKit.CLASS[markClass].sym) + '</span> ' + esc(word) + '</span> ' + (record.by_name ? esc(markKit.fill(markKit.MARK_WORDS.by, { who: record.by_name })) : '') + ' ' + esc(markKit.when(record.at)) : esc(word)) + '</div></div>' +
      '<button type="button" class="mk-x" data-cbsid="CMP059-B01" data-mk-act="close" aria-label="' + esc(markKit.markText(markKit.MARK_WORDS.close)) + '">✕</button></div>' +
      (altered ? '<div class="mk-warn" data-testid="mk-altered">' + esc(markKit.markText(markKit.MARK_WORDS.changedNote)) + '</div>' : '') +
      '<div class="mk-body">' + (thread ? '<div id="mk_thread" data-testid="mk-thread"></div>' : '<div class="mk-spacer" data-testid="mk-thread">' + (lead && root.CBThread && root.CBThread.lead ? root.CBThread.lead(lead) : '') + '</div>') + '</div>' +
      sheetActBar(model) +
      sheetNoteBox(model) +
      '</div>'
    );
  }
  /** the sheet is wired: close, the note box that enables Ask, a press on an act, Escape; returns close */
  /** the note box: it grows with its lines, Enter asks (Shift+Enter is a new line), and Ask is enabled only with words in it */
  function wireNote(dialog, note) {
    var askBtn = dialog.querySelector('[data-mk-act="open"]');
    function syncAsk() {
      if (askBtn) askBtn.setAttribute('aria-disabled', note && note.value.trim() ? 'false' : 'true');
    }
    if (note) {
      note.addEventListener('input', function () {
        syncAsk();
        note.style.height = 'auto';
        note.style.height = Math.min(note.scrollHeight + 2, 140) + 'px';
      });
      note.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && askBtn) { event.preventDefault(); askBtn.click(); } /* Enter asks, Shift+Enter is a new line */
      });
    }
  }
  /** a press on the sheet: the backdrop or Close closes it; an act sends the one write (a Query needs its words first) */
  function onSheetPress(event, run) {
    var button = event.target.closest ? event.target.closest('[data-mk-act]') : null;
    if (event.target === run.dialog) return run.close();
    if (!button) return;
    var action = button.getAttribute('data-mk-act');
    if (action === 'close') return run.close();
    var text = run.note ? run.note.value.trim() : '';
    if (action === 'open' && !text) return askForWords(run);
    run.control.set(run.id, action, action === 'clear' ? '' : text, button).then(function (v) { if (v && v.ok) run.close(); });
  }
  /** a Query with no words is not sent: the sheet says so and keeps the focus in the box */
  function askForWords(run) {
    run.outEl.textContent = markKit.markText(markKit.MARK_WORDS.needWords);
    run.outEl.setAttribute('data-tone', 'error');
    if (run.note) run.note.focus();
  }
  /** the dialog's closer: the dialog goes, the focus goes back to the chip that opened it */
  function sheetCloser(state, dialog, options) {
    return function () {
      state.outEl = null;
      try { dialog.close(); } catch (failure) { quietly('mark:close', failure); }
      if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
      if (options.opener && options.opener.isConnected) { try { options.opener.focus(); } catch (failure) { quietly('mark:opener-focus', failure); } }
    };
  }
  function wireSheet(state, control, id, options, dialog) {
    var outEl = dialog.querySelector('[data-testid="mk-out"]'), note = dialog.querySelector('#mk_note');
    state.outEl = outEl;
    var close = sheetCloser(state, dialog, options), run = { dialog: dialog, close: close, note: note, outEl: outEl, control: control, id: id };
    if (note) wireNote(dialog, note);
    dialog.addEventListener('click', function (event) { onSheetPress(event, run); });
    dialog.addEventListener('cancel', function (event) { event.preventDefault(); close(); });
    return close;
  }
  /** the open query's thread inside the sheet; the action bar is its "above" so the reply box stays last */
  function mountThread(state, dialog, model) {
    var thread = model.thread, lead = model.lead, replyOk = model.replyOk, actions = model.actions;
    if (thread && root.CBThread) {
      root.CBThread.mount(dialog.querySelector('#mk_thread'), {
        subject: { type: 'mark', id: thread },
        transport: state.cfg.transport || null,
        lead: lead,
        fill: true,
        focus: true,
        above: dialog.querySelector('[data-testid="mk-actbar"]'),
        actions: { message_external: replyOk ? { ok: true } : { ok: false, why: (actions.reply && actions.reply.why) || markKit.markText(markKit.MARK_WORDS.replyOff) } },
        party: markKit.markText(markKit.MARK_WORDS.everyone),
        readOnly: !replyOk && !(actions.reply && actions.reply.why),
        context: { host: 'cap-mark', source: 'CMP059' }
      });
    }
  }
  /* ── CMP059 the Query sheet ── */
  function openSheet(state, control, id, options) {
    markKit.addCss();
    var model = sheetModel(state, id, options), dialog = sheetDialog();
    dialog.innerHTML = sheetHTML(model);
    markKit.doc.body.appendChild(dialog);
    var close = wireSheet(state, control, id, options, dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    mountThread(state, dialog, model);
    (dialog.querySelector('#mk_note') || dialog.querySelector('[data-mk-act="close"]')).focus();
    return { close: close, el: dialog };
  }
})(typeof window !== 'undefined' ? window : globalThis);
