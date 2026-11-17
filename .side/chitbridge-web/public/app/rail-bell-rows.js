/**
 * rail-bell-rows.js — R06 part of rail-bell.js: what a press on a notice row does.
 *
 * OWNS      the row presses of the bell: a chit opens, a colleague's note reply opens the client's Day book, a Query notice opens its thread in place or goes to the record
 * CALLED BY rail-bell.js (through root.CBBellKit); loaded before it on every page that loads rail-bell.js
 * FLOW      bellKit.pressRow(bell, opts, node, repaint) → true when the press was on a row of ours (the list is closed first, then the row's own act)
 * CARD      rail/R06-BELL
 *
 * One behaviour per notice, on every page; the thread is opened by the Day book's own opener (CBMark), never re-implemented here.
 */
(function (root) {
  'use strict';
  var bellKit = root.CBBellKit; /* created by rail-bell-html.js, which loads first */
  /** W15-54: the owner's bell row for a Query opens the Query thread sheet through the Day book's own opener (CBMark's sheet: one thread, one composer) */
  /** the page's endpoint table is a lexical const (not window.EP), so cap-mark cannot fill it: the two mark reads are added here, from cap-mark's own list */
  function markEndpoints() {
    if (typeof EP !== 'undefined' && root.CB_MARK_EP)
      Object.keys(root.CB_MARK_EP).forEach(function (key) {
        if (!EP[key]) EP[key] = root.CB_MARK_EP[key];
      });
  }
  function openMark(bell, opts, row) {
    var markHelper = bell.mk || (bell.mk = root.CBMark.use({
        adopter: 'acc.audit',
        period: function () {
          return bell.mkDay ? { from: bell.mkDay, to: bell.mkDay } : null; /* the open list answers for the CURRENT month unless asked: an older entry's Query is found by its own day */
        },
        call: function (key, o) {
          markEndpoints();
          return api(key, o); /* the page's own api(): the seat's token and acting headers ride on it, as on the Day book */
        }
      })),
      title = row.getAttribute('data-mark-title') || '',
      id = row.getAttribute('data-mark-id'),
      no = row.getAttribute('data-mark-no');
    bell.mkDay = String(row.getAttribute('data-mark-day') || '').slice(0, 10);
    var show = function (subject) {
      if (subject) markHelper.sheet(subject, { title: title });
      else if (typeof root.toast === 'function') root.toast(bellKit.bellText(bellKit.BELL_WORDS.markGone)); /* no id and no open question by that number: say why, not "try again" */
    };
    if (id) return markHelper.load([id]).then(function () { show(id); });
    return markHelper.summary().then(function (sum) {
      var hit = ((sum && sum.open) || []).filter(function (m) {
        return no && String(m.subject_label || '').indexOf(no) === 0;
      })[0];
      return markHelper.load(hit ? [String(hit.subject_id)] : []).then(function () { show(hit ? String(hit.subject_id) : ''); });
    });
  }
  /** a colleague's reply on my firm's note: the feed names the entry, not the client, so the firm's own list of notes (the work list's read) says whose it is; the client's Day book opens with that entry's note sheet (books-grant-view.js reads &note=) */
  function openNote(bell, opts, entryId) {
    return bellKit.call(opts, 'flagsList', { query: { kind: 'note', limit: 200 } })
      .then(function (reply) {
        var hit = ((reply && reply.flags) || []).filter(function (flag) {
          return flag.kind === 'note' && String(flag.subject_id) === entryId && flag.subject_entity;
        })[0];
        if (!hit) throw new Error('note not found');
        /* a note on the CLIENT carries the client's own id as its subject: the same address, the Day book then opens the client's sheet (books-grant-view.js) */
        root.location.assign('/network.html?open=' + encodeURIComponent(hit.subject_entity) + '&view=daybook&note=' + encodeURIComponent(entryId) + '&nl=' + encodeURIComponent(String(hit.label || '').slice(0, 80)));
      })
      .catch(function () {
        if (typeof root.toast === 'function') root.toast(bellKit.bellText(bellKit.BELL_WORDS.noteGone));
      });
  }
  /** the client a firm's notice is about: the id the feed carries, else the practice list's client of that NAME (paged; the exact name, first page that has it) */
  function clientIdOf(opts, row) {
    var given = row.getAttribute('data-mark-client-id'),
      name = row.getAttribute('data-mark-client');
    if (given) return Promise.resolve(given);
    var askPage = function (page) {
      return bellKit.call(opts, 'practice', { query: { page: page, limit: 100 } }).then(function (reply) {
        var hit = ((reply && reply.clients) || []).filter(function (c) {
          return c.name === name;
        })[0];
        if (hit) return String(hit.entity_id);
        return reply && reply.has_more && page < 8 ? askPage(page + 1) : '';
      });
    };
    return askPage(1);
  }
  /**
   * ONE behaviour per Query notice, on every page. Where the thread can open in place (the owner's own books, CBMark on the page) it opens; anywhere else the row is a LINK to the record:
   * the owner's Accounts Day book (?mark=<entry>, opened on arrival below) or the client's Day book (&view=daybook&mark=<entry>, books-grant-view.js). A firm's row always goes to the client's Day book,
   * for the thread is in the CLIENT's books and only that page speaks for them.
   */
  function goToMark(opts, row) {
    var id = row.getAttribute('data-mark-id') || '',
      fail = function () {
        if (typeof root.toast === 'function') root.toast(bellKit.bellText(bellKit.BELL_WORDS.markFail));
      };
    if (!row.getAttribute('data-mark-client')) {
      root.location.assign('/accounts.html' + (id ? '?mark=' + encodeURIComponent(id) : '') + '#/daybook');
      return Promise.resolve();
    }
    return clientIdOf(opts, row).then(function (cid) {
      if (!cid) {
        if (typeof root.toast === 'function') root.toast(bellKit.bellText(bellKit.BELL_WORDS.clientGone));
        return;
      }
      root.location.assign('/network.html?open=' + encodeURIComponent(cid) + '&view=daybook' + (id ? '&mark=' + encodeURIComponent(id) + '&mday=' + encodeURIComponent(String(row.getAttribute('data-mark-day') || '').slice(0, 10)) + '&nl=' + encodeURIComponent(String(row.getAttribute('data-mark-title') || '').slice(0, 80)) : '')); /* nl: the entry's own label (number · day · amount), so the thread is titled by it, never "This entry" */
    }, fail);
  }
  /** a press on a chit row: the list closes and the chit opens where this page opens chits */
  function openChitRow(bell, opts, row, repaint) {
    var id = row.getAttribute('data-chit');
    bell.open = false;
    repaint();
    if (typeof opts.onOpen === 'function') opts.onOpen(id);
    else if (typeof root.openChitSheet === 'function') root.openChitSheet(id);
    else if (typeof root.openChit === 'function') root.openChit(id);
    /* O4: a page with no chit sheet (Home) sends the press to where the chit opens - never closes the list and does nothing.
     TO1b (REQUIREMENT §6): a NEW ORDER opens in Tasks & Orders — the shop's task — not the CRM's list; AX1: unless this edition leaves Tasks out (the CRM's chit, then) */
    else if (row.getAttribute('data-order') && !(root.CBEdition && root.CBEdition.hidesHref('/tasks.html')))
      root.location.href = '/tasks.html?open=' + encodeURIComponent(id);
    else root.location.href = '/crm.html#/chits?open=' + encodeURIComponent(id);
  }
  /** a Query notice: in place when CBMark is on the page and the notice is the owner's own, else a link to the record */
  function openMarkRow(bell, opts, row, repaint) {
    bell.open = false;
    repaint();
    var inPlace = root.CBMark && typeof api === 'function' && !row.getAttribute('data-mark-client');
    new Promise(function (done) {
      done(inPlace ? openMark(bell, opts, row) : goToMark(opts, row));
    }).catch(function () {
      if (typeof root.toast === 'function') root.toast(bellKit.bellText(bellKit.BELL_WORDS.markFail));
    });
  }
  /** a press on a row of the list: which kind of notice it is decides what opens; false when it was not on a row of ours */
  function pressRow(bell, opts, node, repaint) {
    var row = node.closest('[data-testid="bell-row"]');
    if (!row) return false;
    if (row.getAttribute('data-chit')) {
      openChitRow(bell, opts, row, repaint);
      return true;
    }
    if (row.getAttribute('data-note-id')) {
      bell.open = false;
      repaint();
      openNote(bell, opts, row.getAttribute('data-note-id'));
      return true;
    }
    if (row.getAttribute('data-mark-id') === null && row.getAttribute('data-mark-no') === null) return false;
    openMarkRow(bell, opts, row, repaint);
    return true;
  }
  bellKit.pressRow = pressRow;
  bellKit.openMark = openMark;
})(typeof window !== 'undefined' ? window : globalThis);
