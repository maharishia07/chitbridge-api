/**
 * cap-flag.js — CMP066 the Saved chip and CMP067 the Saved sheet: a PRIVATE bookmark and note on a record (a Day book entry, a client), kept in the writer's OWN organisation.
 * A firm's bookmark is never in the client's books and the client never sees it; "My firm" is read by the colleagues of the person's organisation, "Only me" by the person alone. A flag is not a mark:
 * it never changes "Checked n of m" (cap-mark.js owns that) and never reaches the client.
 *
 * OWNS      the chip (star + open-note count) · the sheet (who sees it · Bookmark · Add note · each note: Resolve / Reopen / Share with my firm / Remove) · the one door to /api/flags (read: query · list · counts; write: add · resolve · reopen · share · remove)
 * CALLED BY books-grant-view.js (the auditor's and the adviser's Day book) · books-practice.js (the firm's client list and its Home count)
 * FLOW      use({ call, kind, entity }) → load(ids) ONE read per 200 records → chip(id, label) in each row → a press → sheet(id, { label }) → one write → every chip of that record repaints
 * CARD      PM/REQ-PRIVATE-NOTES-BOOKMARKS-2026-11-17.md (W0-W3)
 *
 * ⭐ NEVER X-Books-For. Under a grant the books are read with the client's header; a flag written under it would land in the client's organisation. Every call here goes through the page's own `call(method, path, body)` with NO headers:
 *   the caller's own binding. The server decides who may flag what and answers a refusal in words, which the sheet shows; this file decides nothing.
 * ⭐ A read that failed never says "none": the chips say nothing and the sheet says the read failed. A server that has not switched flags on (503) or does not give this person the right (404) draws no chips (off()).
 *
 *   CBFlag.use({ call, kind: 'posting' | 'client' | 'account', entity?: () => subject client id }) → { load(ids) · ingest(flags) · chip(id, label) · repaint(scope) · bookmarked(id) · noted(id) · any(id) · sheet(id, { label, opener }) · onChange(fn) · off() · destroy() }
 *   CBFlag.list(call, { page, limit }) → { flags, total } · CBFlag.counts(call) → { open, bookmarks, notes } · CBFlag.listAll(call) → every open flag, up to 3 pages · CBFlag.workList({ call, nameOf, onOpen, mountList }) → a sheet of every open flag
 */
(function (root) {
  'use strict';
  var doc = root.document;
  var CHUNK = 200; /* the server's cap on records in one read */
  var NOTE_MAX = 1000; /* one number with the server (lib/review-mark.js NOTE_MAX) */

  var FLAG_ENDPOINTS = {
    flagsQuery: { m: 'POST', p: '/api/flags/query' } /* { subject_kind, subject_entity, ids } → { flags: { id: [flag] } } */,
    flagsList: { m: 'GET', p: '/api/flags' } /* ?page= &limit= &kind= &subject_entity= → { flags, total, page, limit } */,
    flagsCounts: { m: 'GET', p: '/api/flags/counts' } /* → { open, bookmarks, notes } */,
    flagsAdd: { m: 'POST', p: '/api/flags' } /* { kind, visibility, subject_kind, subject_entity, items: [{ id, label }], note? } */,
    flagsResolve: { m: 'POST', p: '/api/flags/:id/resolve' },
    flagsReopen: { m: 'POST', p: '/api/flags/:id/reopen' },
    flagsShare: { m: 'POST', p: '/api/flags/:id/share' },
    flagsRemove: { m: 'POST', p: '/api/flags/:id/remove' },
    flagsThread: { m: 'GET', p: '/api/flags/:id/messages' } /* → { flag, messages: [{ by_name, text, mine, at }], may: { reply: { ok, why } } } */,
    flagsReply: { m: 'POST', p: '/api/flags/:id/messages' } /* { message_text } → the thread as it reads now */
  };
  root.CB_FLAG_EP = FLAG_ENDPOINTS;

  var FLAG_WORDS = {
    saved: 'Saved',
    bookmark: 'Bookmark',
    bookmarked: 'Bookmarked',
    removeBookmark: 'Remove bookmark',
    notes: 'Notes',
    addNote: 'Add note',
    noteLabel: 'Your note',
    noteNeeded: 'Write the note first.',
    who: 'Who sees it',
    firm: 'My firm',
    me: 'Only me',
    shareFirm: 'Share with my firm',
    resolve: 'Resolve',
    reopen: 'Reopen',
    remove: 'Remove',
    sure: 'Remove? Press again',
    done: 'Done',
    close: 'Close',
    by: 'by',
    resolvedBy: 'Resolved by',
    failed: 'Not saved. Nothing was changed.',
    readFail: 'Could not read your bookmarks. This does not mean there are none.',
    none: 'Nothing saved on this yet.',
    privateNote: 'Your own bookmarks and notes. The client never sees them.',
    replies: 'Replies from your firm',
    replyLabel: 'Your reply',
    reply: 'Reply',
    replyNeeded: 'Write your reply first.',
    threadFail: 'Could not read the replies. This does not mean there are none.',
    me2: 'You',
    explain: 'Explain',
    explained: 'Explained',
    explainHelp: 'Your own note on why this account moved. The client never sees it.',
    saveExplain: 'Save explanation',
    workHead: 'Bookmarks and notes',
    workNone: 'You have no open bookmarks or notes.',
    colRecord: 'Record',
    colKind: 'Kind',
    colClient: 'Client',
    colBy: 'By',
    kindBookmark: 'Bookmark',
    kindNote: 'Note',
    open: 'Open',
    more: 'Showing the newest {n}.'
  };
  function flagText(s) {
    return typeof root.tx === 'function' ? root.tx(s) : s;
  }
  var FLAG_CSS =
    '.fl{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--line,#DDD6C6);border-radius:99px;background:var(--card,#fff);color:var(--grey,#5E594D);font:inherit;font-size:var(--fs-1,12px);font-weight:700;padding:3px 9px;min-height:28px;cursor:pointer}' +
    '.fl-on{border-color:var(--ok,#2E8B57);color:var(--ok-3,#0F5132)}.fl-note{border-color:var(--warn,#B7791F);color:var(--warn-3,#7A4B00)}' +
    '.fl-thread{display:flex;flex-direction:column;gap:6px;border-inline-start:3px solid var(--line,#DDD6C6);padding-inline-start:10px}.fl-msg{display:flex;flex-direction:column;gap:2px}.fl-msg.mine .fl-sub{font-weight:700}.fl-reply{min-height:56px;width:100%;box-sizing:border-box}' +
    '.fl:focus-visible{outline:2px solid var(--blue,#1f5fa8);outline-offset:2px}' +
    'dialog.fl-sheet{border:1px solid var(--line,#DDD6C6);border-radius:14px;padding:0;width:min(520px,calc(100vw - 24px));max-height:calc(100vh - 24px);background:var(--card,#fff);color:var(--ink,#1D1B16)}dialog.fl-sheet::backdrop{background:color-mix(in srgb,var(--ink,#1D1B16) 40%,transparent)}' +
    '.fl-in{padding:14px 16px;display:flex;flex-direction:column;gap:10px;max-height:calc(100vh - 48px);overflow:auto;box-sizing:border-box}' +
    '.fl-hd{display:flex;gap:8px;align-items:flex-start;justify-content:space-between}.fl-hd h2{margin:0;font-size:var(--fs-3,17px)}' +
    '.fl-x{border:0;background:transparent;font:inherit;font-size:20px;line-height:1;min-width:44px;min-height:44px;cursor:pointer;color:var(--grey,#5E594D)}' +
    '.fl-sub{font-size:var(--fs-1,12px);color:var(--grey,#5E594D)}' +
    '.fl-who{display:flex;gap:14px;flex-wrap:wrap;border:0;margin:0;padding:0}.fl-who label{display:inline-flex;align-items:center;gap:6px;min-height:44px;font-size:var(--fs-2,14px)}' +
    '.fl-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}' +
    '.fl-btn{border:1px solid var(--line,#DDD6C6);border-radius:10px;background:var(--card,#fff);color:inherit;font:inherit;font-size:var(--fs-2,14px);padding:6px 12px;min-height:44px;cursor:pointer}.fl-btn.pri{background:var(--ink,#1D1B16);color:var(--on-accent,#fff);border-color:var(--ink,#1D1B16)}' +
    '.fl-box{width:100%;box-sizing:border-box;font:inherit;border:1px solid var(--line,#DDD6C6);border-radius:8px;padding:8px;min-height:64px;background:var(--card,#fff);color:inherit}' +
    '.fl-list{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}.fl-item{border:1px solid var(--line,#DDD6C6);border-radius:10px;padding:8px 10px;display:flex;flex-direction:column;gap:6px}' +
    '.fl-item.gone{opacity:.8}.fl-text{white-space:pre-wrap;overflow-wrap:anywhere;font-size:var(--fs-2,14px)}' +
    '.fl-out{font-size:var(--fs-1,12px);min-height:1em}.fl-out[data-tone=error]{color:var(--disp,#8E3517);font-weight:700}' +
    '@media (max-width:700px){.fl{min-height:44px;padding:3px 12px}}';
  var cssDone = false;
  function addCss() {
    if (cssDone || !doc) return;
    cssDone = true;
    var node = doc.createElement('style');
    node.setAttribute('data-cbflag', '1');
    node.textContent = FLAG_CSS;
    (doc.head || doc.documentElement).appendChild(node);
  }

  /** ONE door: the page's own call with NO headers (never X-Books-For) */
  function askFlag(call, key, o) {
    o = o || {};
    var path = FLAG_ENDPOINTS[key].p.replace(':id', encodeURIComponent(o.id == null ? '' : o.id));
    var q = Object.keys(o.query || {}).filter(function (k) { return o.query[k] !== '' && o.query[k] != null; }).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(o.query[k]); }).join('&');
    return call(FLAG_ENDPOINTS[key].m, path + (q ? '?' + q : ''), o.body);
  }
  var gone = function (failure) { return !!failure && (failure.status === 503 || failure.status === 404 || failure.status === 403); };

  /** a flag counts when it is still open or resolved (the server never sends a removed one); bookmark and note are its two kinds */
  function open(f) { return f.state === 'open'; }

  /** the flags of these records (ONE read per 200); a refusal that means "not for you / not switched on" switches the chips off, any other failure keeps what was known and says so */
  function loadFlags(cfg, state, kind, ids) {
    var entity = typeof cfg.entity === 'function' ? cfg.entity() : null;
    var list = (ids || []).map(String), jobs = [];
    for (var i = 0; i < list.length; i += CHUNK) jobs.push(list.slice(i, i + CHUNK));
    state.failed = false;
    return Promise.all(jobs.map(function (part) {
      return askFlag(cfg.call, 'flagsQuery', { body: { subject_kind: kind, subject_entity: entity, ids: part } }).then(function (a) {
        part.forEach(function (id) { delete state.by[id]; });
        var flags = (a && a.flags) || {};
        Object.keys(flags).forEach(function (id) { state.by[id] = flags[id]; });
      });
    })).then(function () { state.off = false; state.ready = true; }, function (failure) {
      state.ready = true;
      if (gone(failure)) state.off = true; else state.failed = true;
    });
  }
  /** the client list: flags from one GET /api/flags, grouped by record (a client's own id) */
  function ingestFlags(state, kind, flags) {
    state.by = {};
    (flags || []).forEach(function (f) {
      if (f.subject_kind !== kind) return;
      (state.by[f.subject_id] = state.by[f.subject_id] || []).push(f);
    });
    state.off = false;
    state.ready = true;
  }
  /** the chip (html); nothing when the server does not offer flags to this person */
  /** the chip's word: Saved when bookmarked, Notes when only noted, Bookmark when nothing is kept */
  function chipWord(star, n) {
    if (star) return FLAG_WORDS.bookmarked;
    return n ? FLAG_WORDS.notes : FLAG_WORDS.bookmark;
  }
  /** the chip's class: on when bookmarked, note when only noted */
  function chipTone(star, n) {
    if (star) return ' fl-on';
    return n ? ' fl-note' : '';
  }
  function chipOf(state, kind, control, id, label) {
    if (state.off || !state.ready || id == null || id === '') return '';
    id = String(id);
    if (label) state.label[id] = String(label);
    if (kind === 'account') return explainChip(id, control.noted(id));
    var star = control.bookmarked(id), n = control.noted(id), word = chipWord(star, n);
    return '<button type="button" class="fl' + chipTone(star, n) + '" data-cbsid="CMP066-B01" data-fl="' + esc(id) + '" data-fl-k="' + kind + '" aria-haspopup="dialog" aria-label="' + esc(flagText(FLAG_WORDS.saved) + ': ' + flagText(word)) + '" title="' + esc(flagText(word)) + '" data-testid="fl-chip-' + esc(id) + '">' +
      '<span aria-hidden="true">' + (star ? '★' : '☆') + '</span>' + (n ? '<span>' + n + '</span>' : '') + '</button>';
  }
  /** put every chip of this record (or every chip) under scope back as the control now says it */
  function repaintChips(control, scope, id) {
    if (!doc) return;
    [].forEach.call((scope || doc).querySelectorAll(id == null ? '[data-fl]' : '[data-fl="' + String(id).replace(/"/g, '') + '"]'), function (node) {
      var key = node.getAttribute('data-fl'), html = control.chip(key), holder = doc.createElement('span');
      holder.innerHTML = html;
      if (holder.firstChild) node.parentNode.replaceChild(holder.firstChild, node); else if (node.parentNode) node.parentNode.removeChild(node);
    });
  }
  function useFlag(cfg) {
    addCss();
    cfg = cfg || {};
    var kind = cfg.kind === 'client' ? 'client' : cfg.kind === 'account' ? 'account' : 'posting';
    var state = { by: {}, subs: [], off: false, failed: false, ready: false, label: {} };
    var control = {
      kind: kind,
      load: function (ids) { return loadFlags(cfg, state, kind, ids); },
      ingest: function (flags) { return ingestFlags(state, kind, flags); },
      ready: function () { return state.ready; },
      off: function () { return state.off; },
      failed: function () { return state.failed; },
      flags: function (id) { return state.by[String(id)] || []; },
      bookmarked: function (id) { return control.flags(id).some(function (f) { return f.kind === 'bookmark' && open(f); }); },
      noted: function (id) { return control.flags(id).filter(function (f) { return f.kind === 'note' && open(f); }).length; },
      any: function (id) { return control.bookmarked(id) || control.noted(id) > 0; },
      chip: function (id, label) { return chipOf(state, kind, control, id, label); },
      repaint: function (scope, id) { return repaintChips(control, scope, id); },
      sheet: function (id, o) { return openSheet(cfg, state, control, String(id), o || {}, kind); },
      onChange: function (fn) { state.subs.push(fn); },
      changed: function (id) { state.subs.forEach(function (fn) { fn(id); }); control.repaint(doc, id); },
      destroy: function () { state.subs = []; state.by = {}; }
    };
    live[kind] = control; /* the press below finds the control that painted the chip */
    return control;
  }
  /** the P&L's Explain (kind 'account'): one button, "Explain" until a note is written, then "Explained"; it opens the same sheet, a note only (no bookmark) */
  function explainChip(id, n) {
    var word = n ? FLAG_WORDS.explained : FLAG_WORDS.explain;
    return '<button type="button" class="fl' + (n ? ' fl-note' : '') + '" data-cbsid="CMP066-B02" data-fl="' + esc(id) + '" data-fl-k="account" aria-haspopup="dialog" aria-label="' + esc(flagText(word)) + '" title="' + esc(flagText(word)) + '" data-testid="fl-explain-' + esc(id) + '"><span>' + esc(flagText(word)) + '</span></button>';
  }
  var live = {}; /* kind → the newest control of that kind on this page */
  /* a press on a chip, anywhere on the page: captured, so the row behind it does not also open (as cap-mark.js and cap-evidence.js do) */
  if (doc && !root.__cbFlagWired) {
    root.__cbFlagWired = true;
    doc.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('[data-fl]') : null, ctl = b && live[b.getAttribute('data-fl-k')];
      if (!b || !ctl) return;
      e.preventDefault();
      e.stopPropagation();
      ctl.sheet(b.getAttribute('data-fl'), { opener: b });
    }, true);
    doc.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('button[data-fl]')) e.stopPropagation(); /* the chip's key is the chip's, not the row's */
    }, true);
  }

  /* ── CMP067 the Saved sheet ── */
  function sayInSheet(sheet, text, error) {
    var out = sheet.dialog.querySelector('.fl-out');
    if (out) { out.textContent = text || ''; if (error) out.setAttribute('data-tone', 'error'); else out.removeAttribute('data-tone'); }
  }
  function sheetWho(sheet) {
    var chosen = sheet.dialog.querySelector('input[name="fl_who"]:checked');
    return chosen && chosen.value === 'me' ? 'me' : 'org';
  }
  /** the first line of a saved item: its kind, who it is for, who wrote it, and that it is resolved */
  function flagHead(flag) {
    var shared = flag.visibility === 'org', noteKind = flag.kind === 'note', done = flag.state === 'resolved';
    return '<div class="fl-sub">' + esc(flagText(noteKind ? FLAG_WORDS.kindNote : FLAG_WORDS.kindBookmark)) + ' · ' + esc(flagText(shared ? FLAG_WORDS.firm : FLAG_WORDS.me)) + (flag.by_name ? ' · ' + esc(flagText(FLAG_WORDS.by)) + ' ' + esc(flag.by_name) : '') + (done ? ' · ' + esc(flagText(FLAG_WORDS.resolvedBy)) + ' ' + esc(flag.resolved_by || '') : '') + '</div>';
  }
  /** the item's buttons: Resolve or Reopen (a note), Share with the firm (mine, still private), Remove (twice: the second press commits) */
  function flagButtons(sheet, flag) {
    var shared = flag.visibility === 'org', mine = flag.mine === true, noteKind = flag.kind === 'note', done = flag.state === 'resolved';
    return (
(noteKind ? '<button type="button" class="fl-btn" data-cbsid="CMP067-B03" data-act="' + (done ? 'reopen' : 'resolve') + '" data-id="' + esc(flag.flag_id) + '">' + esc((done ? flagText('Reopen') : flagText('Resolve'))) + '</button>' : '') +
(!shared && mine ? '<button type="button" class="fl-btn" data-cbsid="CMP067-B04" data-act="share" data-id="' + esc(flag.flag_id) + '">' + esc(flagText('Share with my firm')) + '</button>' : '') +
'<button type="button" class="fl-btn" data-cbsid="CMP067-B05" data-act="remove" data-id="' + esc(flag.flag_id) + '">' + esc((sheet.armed === flag.flag_id ? flagText('Remove? Press again') : flagText('Remove'))) + '</button>'
    );
  }
  function flagLine(sheet, flag) {
    var shared = flag.visibility === 'org', noteKind = flag.kind === 'note', done = flag.state === 'resolved';
    return '<li class="fl-item' + (done ? ' gone' : '') + '" data-flag="' + esc(flag.flag_id) + '">' +
      flagHead(flag) +
      (noteKind ? '<div class="fl-text">' + esc(flag.note) + '</div>' : '') +
      (noteKind && shared ? '<div class="fl-thread" data-thread="' + esc(flag.flag_id) + '" data-testid="fl-thread"></div>' : '') +
      '<div class="fl-row">' +
      flagButtons(sheet, flag) + '</div></li>';
  }
  function threadHtml(sheet, flagId, a) {
    if (a === false) return '<div class="fl-sub" data-tone="error">' + esc(flagText(FLAG_WORDS.threadFail)) + '</div>';
    var msgs = (a.messages || []).map(function (m) {
      return '<div class="fl-msg' + (m.mine ? ' mine' : '') + '"><div class="fl-sub">' + esc(m.mine ? flagText(FLAG_WORDS.me2) : m.by_name || '') + '</div><div class="fl-text">' + esc(m.text) + '</div></div>';
    }).join('');
    var may = (a.may && a.may.reply) || { ok: false, why: '' };
    return (msgs ? '<div class="fl-sub">' + esc(flagText(FLAG_WORDS.replies)) + '</div>' + msgs : '') +
      (may.ok ? '<textarea class="fl-reply" maxlength="' + NOTE_MAX + '" data-reply="' + esc(flagId) + '" aria-label="' + esc(flagText('Your reply')) + '" data-cbsid="CMP067-T02" data-testid="fl-reply"></textarea><div class="fl-row"><button type="button" class="fl-btn" data-cbsid="CMP067-B09" data-act="reply" data-id="' + esc(flagId) + '" data-testid="fl-send-reply">' + esc(flagText('Reply')) + '</button></div>' : may.why && msgs ? '<div class="fl-sub">' + esc(may.why) + '</div>' : '');
  }
  function fillThread(sheet, flagId) {
    var node = sheet.dialog.querySelector('.fl-thread[data-thread="' + String(flagId).replace(/"/g, '') + '"]');
    if (node && sheet.threads[flagId] !== undefined) node.innerHTML = threadHtml(sheet, flagId, sheet.threads[flagId]);
  }
  function loadThreads(sheet) {
    [].forEach.call(sheet.dialog.querySelectorAll('.fl-thread[data-thread]'), function (node) {
      var flagId = node.getAttribute('data-thread');
      if (sheet.threads[flagId] !== undefined) return fillThread(sheet, flagId);
      askFlag(sheet.cfg.call, 'flagsThread', { id: flagId }).then(function (a) { sheet.threads[flagId] = a || false; fillThread(sheet, flagId); }, function () { sheet.threads[flagId] = false; fillThread(sheet, flagId); });
    });
  }
  /** the sheet's html: the title, who the item is for, the bookmark and note boxes, and the saved items */
  function sheetBody(sheet, flags, mineBookmark) {
    return (
      '<div class="fl-in"><div class="fl-hd"><h2>' + esc(sheet.title) + '</h2><button type="button" class="fl-x" data-cbsid="CMP067-B01" data-act="close" aria-label="' + esc(flagText('Close')) + '">✕</button></div>' +
      '<div class="fl-sub">' + esc(flagText(sheet.kind === 'account' ? FLAG_WORDS.explainHelp : FLAG_WORDS.privateNote)) + '</div>' +
      '<fieldset class="fl-who"><legend class="fl-sub">' + esc(flagText(FLAG_WORDS.who)) + '</legend>' +
      '<label><input type="radio" name="fl_who" value="org" checked data-cbsid="CMP067-R01"> ' + esc(flagText('My firm')) + '</label><label><input type="radio" name="fl_who" value="me" data-cbsid="CMP067-R02"> ' + esc(flagText('Only me')) + '</label></fieldset>' +
      (mineBookmark || sheet.kind === 'account' ? '' : '<div class="fl-row"><button type="button" class="fl-btn pri" data-cbsid="CMP067-B02" data-act="bookmark" data-testid="fl-bookmark">☆ ' + esc(flagText('Bookmark')) + '</button></div>') +
      '<textarea class="fl-box" maxlength="' + NOTE_MAX + '" aria-label="' + esc(flagText('Your note')) + '" data-cbsid="CMP067-T01" data-testid="fl-note"></textarea><div class="fl-row"><button type="button" class="fl-btn" data-cbsid="CMP067-B06" data-act="note" data-testid="fl-add-note">' + esc((sheet.kind === 'account' ? flagText('Save explanation') : flagText('Add note'))) + '</button></div>' +
      '<div class="fl-out" role="status" aria-live="polite"></div>' +
      flagListHTML(sheet, flags) +
      '</div>'
    );
  }
  /** the saved items of this record, or why there are none to show */
  function flagListHTML(sheet, flags) {
    if (sheet.state.failed) return '<div class="fl-out" data-tone="error">' + esc(flagText(FLAG_WORDS.readFail)) + '</div>';
    if (!flags.length) return '<div class="fl-sub">' + esc(flagText(FLAG_WORDS.none)) + '</div>';
    return '<ul class="fl-list" data-testid="fl-list">' + flags.map(function (item) { return flagLine(sheet, item); }).join('') + '</ul>';
  }
  function paintSheet(sheet, keepNote) {
    var note = keepNote ? (sheet.dialog.querySelector('.fl-box') || {}).value || '' : '', flags = sheet.control.flags(sheet.id), mineBookmark = flags.filter(function (f) { return f.kind === 'bookmark' && open(f); })[0];
    sheet.dialog.innerHTML = sheetBody(sheet, flags, mineBookmark);
    if (mineBookmark) { var who0 = sheet.dialog.querySelector('input[name="fl_who"][value="' + (mineBookmark.visibility === 'me' ? 'me' : 'org') + '"]'); if (who0) who0.checked = true; }
    var box = sheet.dialog.querySelector('.fl-box');
    if (box && note) box.value = note;
    loadThreads(sheet);
  }
  /** write one change; on an answer re-read this record (the server's own view, including what a colleague did) and repaint */
  function writeFlag(sheet, key, body, flagId) {
    if (sheet.busy) return;
    sheet.busy = true;
    return askFlag(sheet.cfg.call, key, { id: flagId, body: body }).then(function () {
      return sheet.kind === 'client' ? refreshClient(sheet) : sheet.control.load([sheet.id]);
    }).then(function () {
      sheet.threads = {}; sheet.busy = false; sheet.armed = null; paintSheet(sheet, false); sayInSheet(sheet, flagText(FLAG_WORDS.done)); sheet.control.changed(sheet.id);
    }, function (failure) {
      sheet.busy = false; sheet.armed = null; sayInSheet(sheet, (failure && failure.message) || flagText(FLAG_WORDS.failed), true);
    });
  }
  function refreshClient(sheet) {
    return askFlag(sheet.cfg.call, 'flagsList', { query: { subject_entity: sheet.id, limit: CHUNK } }).then(function (a) {
      sheet.state.by[sheet.id] = ((a && a.flags) || []).filter(function (f) { return f.subject_kind === 'client' && f.subject_id === sheet.id; });
    });
  }
  function addFlagLine(sheet, flagKind, noteText) {
    var body = { kind: flagKind, visibility: sheetWho(sheet), subject_kind: sheet.kind, subject_entity: sheet.entity, items: [{ id: sheet.id, label: String(sheet.title).slice(0, 80) }] };
    if (flagKind === 'note') body.note = noteText;
    return writeFlag(sheet, 'flagsAdd', body);
  }
  /** a press in the sheet: close, bookmark, note, reply, or the change of one flag (Remove asks twice) */
  /** Resolve · Reopen · Share · Remove on one saved item; Remove asks twice (the second press commits: removing a note cannot be undone) */
  function changeFlag(sheet, button, action, flagId) {
    if (action === 'remove' && sheet.armed !== flagId) { sheet.armed = flagId; button.textContent = flagText(FLAG_WORDS.sure); return; } /* the second press commits: removing a note drops its words */
    return writeFlag(sheet, { resolve: 'flagsResolve', reopen: 'flagsReopen', share: 'flagsShare', remove: 'flagsRemove' }[action], null, flagId);
  }
  function onSheetClick(sheet, event) {
    var button = event.target.closest && event.target.closest('[data-act]');
    if (!button) return;
    var action = button.getAttribute('data-act');
    if (action === 'close') return sheet.dialog.close();
    if (action === 'bookmark') return addFlagLine(sheet, 'bookmark');
    if (action === 'note') {
      var text = (sheet.dialog.querySelector('.fl-box').value || '').trim();
      if (!text) return sayInSheet(sheet, flagText(FLAG_WORDS.noteNeeded), true);
      return addFlagLine(sheet, 'note', text);
    }
    var flagId = button.getAttribute('data-id');
    if (action === 'reply') return sendReply(sheet, flagId);
      return changeFlag(sheet, button, action, flagId);
  }
  /** send the reply typed under a shared note; the thread repaints with the answer */
  function sendReply(sheet, flagId) {
    var box = sheet.dialog.querySelector('textarea[data-reply="' + String(flagId).replace(/"/g, '') + '"]'), words = box ? (box.value || '').trim() : '';
    if (!words) return sayInSheet(sheet, flagText(FLAG_WORDS.replyNeeded), true);
    if (sheet.busy) return;
    sheet.busy = true;
    return askFlag(sheet.cfg.call, 'flagsReply', { id: flagId, body: { message_text: words } }).then(function (a) {
      sheet.busy = false; sheet.threads[flagId] = a || false; fillThread(sheet, flagId); sayInSheet(sheet, flagText(FLAG_WORDS.done));
    }, function (failure) {
      sheet.busy = false; sayInSheet(sheet, (failure && failure.message) || flagText(FLAG_WORDS.failed), true);
    });
  }
  function openSheet(cfg, state, control, id, options, kind) {
    var sheet = { cfg: cfg, state: state, control: control, id: id, options: options, kind: kind };
    addCss();
    sheet.title = sheet.options.label || sheet.state.label[sheet.id] || sheet.id; sheet.dialog = doc.createElement('dialog'); sheet.entity = sheet.kind === 'client' ? sheet.id : typeof sheet.cfg.entity === 'function' ? sheet.cfg.entity() : null;
    sheet.armed = null; sheet.busy = false;
    sheet.dialog.className = 'fl-sheet';
    sheet.dialog.setAttribute('data-cbsid', 'CMP067-D01');
    sheet.dialog.setAttribute('data-testid', 'fl-sheet');
    sheet.dialog.setAttribute('aria-label', flagText(FLAG_WORDS.saved) + ': ' + sheet.title);
    /** the replies of one shared note (the firm's own thread, never the client's): what the server says, its reply right with its sentence, and a reply box when it may */
    sheet.threads = {};
    sheet.dialog.addEventListener('click', function (event) { onSheetClick(sheet, event); });
    sheet.dialog.addEventListener('close', function () {
      if (sheet.dialog.parentNode) sheet.dialog.parentNode.removeChild(sheet.dialog);
      if (sheet.options.opener && sheet.options.opener.focus && sheet.options.opener.isConnected) sheet.options.opener.focus();
    });
    paintSheet(sheet, false);
    doc.body.appendChild(sheet.dialog);
    if (sheet.dialog.showModal) sheet.dialog.showModal(); else sheet.dialog.setAttribute('open', '');
    sheet.first = sheet.dialog.querySelector('[data-act="bookmark"]') || sheet.dialog.querySelector('.fl-box');
    if (sheet.first && sheet.first.focus) sheet.first.focus();
    return sheet.dialog;
  }

  /* ── the lists: for a firm's Home count and the client list ── */
  function list(call, o) { return askFlag(call, 'flagsList', { query: { page: (o && o.page) || 1, limit: (o && o.limit) || CHUNK, kind: o && o.kind } }); }
  function counts(call) { return askFlag(call, 'flagsCounts'); }
  /** every open flag, newest first, up to three pages of 200 (more says so: total is returned as it is) */
  function listAll(call) {
    return list(call, { page: 1 }).then(function (first) {
      var out = { flags: (first && first.flags) || [], total: (first && first.total) || 0 }, pages = Math.min(3, Math.ceil(out.total / CHUNK));
      if (pages < 2) return out;
      var more = [];
      for (var p = 2; p <= pages; p++) more.push(list(call, { page: p }));
      return Promise.all(more).then(function (rest) {
        rest.forEach(function (a) { out.flags = out.flags.concat((a && a.flags) || []); });
        return out;
      });
    });
  }

  /** the work list (CMP067): every open bookmark and note of this person's organisation they may read, on the one list control; a row opens the record's client */
  function workList(options) {
    addCss();
    var dialog = doc.createElement('dialog');
    dialog.className = 'fl-sheet';
    dialog.setAttribute('data-cbsid', 'CMP067-D02');
    dialog.setAttribute('data-testid', 'fl-worklist');
    dialog.setAttribute('aria-label', flagText(FLAG_WORDS.workHead));
    dialog.innerHTML = '<div class="fl-in" style="min-height:240px"><div class="fl-hd"><h2>' + esc(flagText(FLAG_WORDS.workHead)) + '</h2><button type="button" class="fl-x" data-cbsid="CMP067-B07" data-close="1" aria-label="' + esc(flagText('Close')) + '">✕</button></div><div class="fl-out" role="status"></div><div class="fl-wl" data-testid="fl-wl" style="height:min(60vh,420px)"></div></div>';
    dialog.addEventListener('click', function (ev) { if (ev.target.closest && ev.target.closest('[data-close]')) dialog.close(); });
    dialog.addEventListener('close', function () { if (dialog.parentNode) dialog.parentNode.removeChild(dialog); if (options.opener && options.opener.isConnected && options.opener.focus) options.opener.focus(); });
    doc.body.appendChild(dialog);
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
    var out = dialog.querySelector('.fl-out'), host = dialog.querySelector('.fl-wl');
    listAll(options.call).then(function (answer) {
      if (!answer.flags.length) { host.innerHTML = '<div class="fl-sub">' + esc(flagText(FLAG_WORDS.workNone)) + '</div>'; return; }
      if (answer.total > answer.flags.length) out.textContent = flagText(FLAG_WORDS.more).replace('{n}', answer.flags.length);
      var rows = answer.flags.map(function (f) { return Object.assign({ client: (options.nameOf && options.nameOf(f.subject_entity)) || '' }, f); });
      var clientCell = function (r) { return esc(r.client || String(r.subject_entity).slice(0, 8)); };
      if (!root.CBList) { host.innerHTML = '<ul class="fl-list">' + rows.map(function (r) { return '<li class="fl-item"><b>' + esc(r.label) + '</b> ' + clientCell(r) + '</li>'; }).join('') + '</ul>'; return; }
      root.CBList.mount(host, {
        key: 'flags-worklist', t: flagText, rows: function () { return rows; }, id: function (r) { return r.flag_id; }, rowTid: function (r) { return 'fl-row-' + r.flag_id; },
        defaultCols: ['label', 'client', 'kind', 'by'],
        columns: [
          { key: 'label', label: flagText(FLAG_WORDS.colRecord), prio: 1, w: 200, keep: true, stretch: true, html: true, cell: function (r) { return esc(r.label) + (r.note ? '<div class="fl-sub">' + esc(r.note) + '</div>' : ''); }, value: function (r) { return r.label; } },
          { key: 'client', label: flagText(FLAG_WORDS.colClient), prio: 1, w: 150, html: true, cell: clientCell, value: function (r) { return r.client; } },
          { key: 'kind', label: flagText(FLAG_WORDS.colKind), prio: 2, w: 110, cell: function (r) { return flagText(r.kind === 'note' ? FLAG_WORDS.kindNote : FLAG_WORDS.kindBookmark) + (r.visibility === 'me' ? ' · ' + flagText(FLAG_WORDS.me) : ''); }, value: function (r) { return r.kind; } },
          { key: 'by', label: flagText(FLAG_WORDS.colBy), prio: 3, w: 120, cell: function (r) { return r.by_name || ''; }, value: function (r) { return r.by_name || ''; } }
        ],
        search: function (r) { return [r.label, r.client, r.note].join(' '); },
        onOpen: function (r) { if (options.onOpen) options.onOpen(r); },
        empty: { title: flagText(FLAG_WORDS.workNone) }
      });
    }, function (failure) { out.setAttribute('data-tone', 'error'); out.textContent = gone(failure) ? flagText(FLAG_WORDS.workNone) : flagText(FLAG_WORDS.readFail); });
    return dialog;
  }

  root.CBFlag = { use: useFlag, list: list, counts: counts, listAll: listAll, workList: workList, words: FLAG_WORDS, gone: gone };
})(typeof window !== 'undefined' ? window : globalThis);
