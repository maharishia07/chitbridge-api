/**
 * rail-bell-html.js — R06 part of rail-bell.js: how the bell and its list are written.
 *
 * OWNS      the bell's words (W, KIND), the line of one notification (money, mark subject, moment), the styles, and the html of the button, one record and the open panel
 * CALLED BY rail-bell.js (through root.CBBellKit); loaded before it on every page that loads rail-bell.js
 * FLOW      bellKit.line(item) → the words of one row; bellKit.panelHtml(bell) → the open list; bellKit.bellButtonHtml(bell) → the dot and count
 * CARD      rail/R06-BELL
 *
 * Paints what the feed says and decides nothing.
 */
(function (root) {
  'use strict';
  var bellKit = (root.CBBellKit = root.CBBellKit || {});
  bellKit.bellText = bellText;
  bellKit.markTitle = markTitle;
  bellKit.line = line;
  bellKit.addCss = addCss;
  bellKit.bellButtonHtml = bellButtonHtml;
  bellKit.panelHtml = panelHtml;
  function bellText(words) {
    return typeof tx === 'function' ? tx(words) : words;
  }

  bellKit.BELL_WORDS = {
    title: 'Activity',
    none: 'No activity yet',
    clear: 'Clear all',
    cleared: 'Activity cleared',
    forYou: 'For you',
    rest: 'Everything else',
    ask: 'Clear all activity?',
    askBody: 'This clears your Activity list. The events are kept — chits, statuses and disputes are unchanged.',
    readFail: 'Could not read your activity — try again',
    markFail: 'That question could not be opened — try again',
    markGone: 'This entry was reversed or removed, so its question cannot be opened',
    aria: 'Activity',
    chit: 'a chit',
    needs: 'Clearing needs the latest update on this system',
    noteGone: 'This note was removed, so its client cannot be opened',
    clientGone: 'This client is no longer in your practice, so the record cannot be opened'
  };
  var KIND = {
    message_sent: ['💬', 'wrote about'],
    delivered_line: ['📦', 'recorded a delivery on'],
    assigned_line: ['👤', 'assigned a line on'],
    status_completed: ['✅', 'completed'],
    status_cancelled: ['🚫', 'cancelled'],
    accepted: ['✍️', 'accepted'],
    dispute_raised: ['⚑', 'raised a dispute on'],
    dispute_resolved: ['✅', 'resolved a dispute on'],
    voided: ['🚫', 'voided'],
    mark_query: ['?', 'raised a Query on'],
    mark_reply: ['💬', 'replied to the Query on'],
    note_reply: ['💬', 'replied on your firm note on']
  };
  /** the ONE wording of a mark's subject (the bell and the Messages inbox both call it): a Query is on an ENTRY, never on a chit */
  function markSubject(entryNo) {
    return entryNo ? String(entryNo) : 'an entry';
  }
  function markTitle(entryNo) {
    return 'Query on ' + markSubject(entryNo);
  }
  /** a mark notice names its entry the way the books do: number · day (the shop's way) · amount in its own currency */
  function entryName(entry) {
    if (!entry) return '';
    if (!entry.entry_no && entry.label) return String(entry.label); /* a firm note names its record the way its writer's page did (b877) */
    var day = entry.posting_date ? (typeof root.shopDay === 'function' ? root.shopDay(entry.posting_date) : entry.posting_date) : '',
      amount = entry.total_minor != null && entry.currency && typeof root.fmtMoney === 'function' ? root.fmtMoney({ amount_minor: String(entry.total_minor), currency: entry.currency }) : '';
    return [entry.entry_no, day, amount].filter(Boolean).join(' · ');
  }
  /** the moment a feed row happened, as the reader's LOCAL time: CBLocale first, then the browser's own format, then the raw text */
  function localMoment(createdAt) {
    var shape = { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' };
    try {
      return root.CBLocale.datetime(createdAt, shape);
    } catch (_) {
      try {
        var date = new Date(createdAt);
        return isNaN(date) ? String(createdAt).replace('T', ' ').slice(0, 16) : date.toLocaleString(undefined, shape);
      } catch (_2) {
        return String(createdAt).slice(0, 16);
      }
    }
  }
  /** one row of the feed -> { i, mine, chit, who, say, subj, d, s, id } — plain text (painted through esc) */
  function line(item) {
    var kind = KIND[item.action], subj = lineSubject(item);
    /* b877: a notice about a client's record names the CLIENT first (a firm with 150 clients knows where to go); the business's own notices carry no client */
    var client = item.mark_client ? String(item.mark_client) : '';
    /* O3: the time is the reader's LOCAL time (the feed's created_at is UTC) - never the raw string */
    var moment = item.created_at ? localMoment(item.created_at) : '';
    if (item.purpose === 'order' && item.action === 'delivered' && item.direction === 'received') return orderLine(item, moment);
    var mark = markOf(item, client);
    return Object.assign({
      note: noteIdOf(item),
      mark: mark && (mark.id || mark.no) ? mark : null,
      i: kind ? kind[0] : '•',
      say: sayOf(item, kind),
      subj: clientFirst(client, item, subj) /* a note on the CLIENT is titled with the client's name: said once */,
      s: moment
    }, plainFields(item));
  }
  /** the fields every row has, whatever the action: whose, which chit, who did it, the detail, the log id */
  function plainFields(item) {
    return {
      mine: !!(item.assigned_to_me || item.dispute_for_me),
      chit: item.chit_id || null,
      who: item.action_by_display_name || '',
      d: item.detail ? String(item.detail).slice(0, 90) : item.new_status || '',
      id: item.log_id || null
    };
  }
  /** the id of the record a note reply is about (a colleague's reply on my note) */
  function noteIdOf(item) {
    return item.action === 'note_reply' && item.mark_entry && item.mark_entry.entry_id ? String(item.mark_entry.entry_id) : '';
  }
  /** what happened, in words: the table's, else the action's own name */
  function sayOf(item, kind) {
    return kind ? kind[1] : String(item.action || 'updated').replace(/_/g, ' ');
  }
  /** a note on a client is titled with the client first, said once */
  function clientFirst(client, item, subj) {
    return client && item.action !== 'message_sent' && subj.indexOf(client) !== 0 ? client + ' · ' + subj : subj;
  }
  /** the line's subject: the entry a mark notice is about, else the chit's own subject */
  function lineSubject(item) {
    if (item.mark_entry) return entryName(item.mark_entry) || markSubject();
    if (item.action === 'mark_query' || item.action === 'mark_reply') return markSubject();
    return item.manual_subject || item.auto_subject || bellText(bellKit.BELL_WORDS.chit);
  }
  /** O3: a NEW incoming order is not a "delivered" - it says what it is, who sent it and what it is worth */
  function orderLine(item, moment) {
    var amount = fmtMoney(item.total_value, item.currency_code, ''),
      list = [item.order_channel === 'online' ? '🌐 ' + bellText('Online') : '', item.order_fulfilment === 'delivery' ? bellText('Delivery') : ''].filter(Boolean).join(' · ');
    return {
      i: '🛍️',
      mine: !!(item.assigned_to_me || item.dispute_for_me),
      chit: item.chit_id || null,
      order: true,
      who: item.action_by_display_name || '',
      say: bellText('sent a new order'),
      subj: '',
      d: [amount, list].filter(Boolean).join(' · '),
      s: moment,
      id: item.log_id || null
    };
  }
  /** W15-54: a mark notice (a Query asked, a reply) opens that record's thread: the entry id when the feed carries it, else its number (the open list names it) */
  function markOf(item, client) {
    if (item.action !== 'mark_query' && item.action !== 'mark_reply') return null;
    var entry = item.mark_entry || {}, mark = { id: entry.entry_id || item.subject_id || '', no: entry.entry_no || '', day: entry.posting_date || '', title: lineSubject(item) };
    mark.client = client; /* a firm's notice: the client it is about (the owner's own notices carry none); its id when the feed carries it */
    mark.clientId = item.mark_client_id ? String(item.mark_client_id) : '';
    return mark;
  }

  var BELL_CSS =
    '.cbb{position:relative;display:inline-block}' +
    '.cbb-btn{position:relative;border:1px solid var(--line,#DDD6C6);background:var(--card,#fff);color:var(--ink,#1D1B16);border-radius:9px;font:inherit;font-size:var(--fs-2,14px);min-width:36px;min-height:32px;padding:3px 9px;cursor:pointer}' +
    '@media (max-width:620px){.cbb-btn{min-width:28px;padding:2px 4px}}' /* a phone header holds the page action, the bell, Home and the avatar on one line */ +
    '.cbb-dot{position:absolute;top:-6px;inset-inline-end:-6px;min-width:18px;height:18px;border-radius:9px;background:var(--disp,#8E3517);color:var(--on-accent,#fff);font-size:var(--fs-1,12px);font-weight:800;line-height:18px;text-align:center;padding:0 4px;box-sizing:border-box}' +
    '.cbb-panel{position:absolute;inset-inline-end:0;top:calc(100% + 6px);z-index:60;width:min(360px,92vw);max-height:70vh;overflow:auto;border:1px solid var(--line,#DDD6C6);border-radius:12px;background:var(--card,#fff);color:var(--ink,#1D1B16);box-shadow:0 8px 24px var(--shadow,rgba(0,0,0,.14));font-size:var(--fs-2,14px);text-align:start}' +
    '.cbb-hd{padding:10px 12px;font-weight:800;border-bottom:1px solid var(--line,#DDD6C6)}' +
    '.cbb-sec{padding:8px 12px 3px;font-size:var(--fs-1,12px);font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--grey,#5E594D)}' +
    '.cbb-row{display:flex;gap:9px;padding:8px 12px;border:0;border-bottom:1px solid var(--line,#DDD6C6);cursor:pointer;background:none;width:100%;text-align:start;font:inherit;color:inherit}' +
    '.cbb-row:hover{background:var(--paper,#f4f1ea)}.cbb-row[disabled]{cursor:default}' +
    '.cbb-t{line-height:1.35}.cbb-d{font-size:var(--fs-1,12px);color:var(--grey,#5E594D);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cbb-s{font-size:var(--fs-1,12px);color:var(--grey,#5E594D)}' +
    '.cbb-none{padding:14px 12px;color:var(--grey,#5E594D)}.cbb-ft{display:flex;gap:8px;align-items:center;padding:8px 12px}' +
    '.cbb-clear{margin-inline-start:auto;border:1px solid var(--line,#DDD6C6);background:var(--card,#fff);color:inherit;border-radius:9px;font:inherit;font-size:var(--fs-1,12px);font-weight:700;padding:6px 12px;cursor:pointer;min-height:32px}' +
    '.cbb-clear[disabled]{opacity:.55;cursor:not-allowed}.cbb-out{font-size:var(--fs-1,12px)}.cbb-out[data-tone=error]{color:var(--disp,#8E3517);font-weight:700}';
  var cssDone = false;
  function addCss() {
    if (cssDone || !bellKit.doc) return;
    cssDone = true;
    var node = bellKit.doc.createElement('style');
    node.setAttribute('data-cbbell', '1');
    node.textContent = BELL_CSS;
    (bellKit.doc.head || bellKit.doc.documentElement).appendChild(node);
  }

  /** the identity mount of a bell control (this screen's code + U1nn, the list control's rule); none until the page names its screen */
  function bellMount(component) {
    return root.CBScreenId && root.CBScreenId.mountAttr ? root.CBScreenId.mountAttr(component) : '';
  }

  /** the popup-code chip of this popover (a literal POP code, the one the register holds for it); nothing on a page without screen-id.js */
  function bellChip(code, place) {
    return root.CBScreenId && root.CBScreenId.popupChip ? root.CBScreenId.popupChip(code, place) : '';
  }

  /** the bell button with its count dot, as markup */
  function bellButtonHtml(bell) {
    var countDot = bell.count > 0 ? '<span class="cbb-dot" data-testid="bell-dot" aria-hidden="true">' + (bell.count > 99 ? '99+' : bell.count) + '</span>' : '';
    return (
      '<button type="button" class="cbb-btn" data-cbsid="CMP030-B01"' + bellMount('CMP030') + ' data-testid="bell-btn" aria-haspopup="true" aria-expanded="' +
      (bell.open ? 'true' : 'false') +
      '" aria-label="' +
      esc(bellText(bellKit.BELL_WORDS.aria)) +
      (bell.count ? ' (' + bell.count + ')' : '') +
      '">🔔' +
      countDot +
      '</button>'
    );
  }

  /** one notification row, as markup */
  function recordHtml(x) {
    return (
      '<button type="button" class="cbb-row" data-cbsid="CMP038-B01"' + bellMount('CMP038') + ' data-testid="bell-row"' +
      (x.chit ? ' data-chit="' + esc(x.chit) + '"' : x.mark ? ' data-mark-id="' + esc(x.mark.id) + '" data-mark-no="' + esc(x.mark.no) + '" data-mark-day="' + esc(x.mark.day) + '" data-mark-title="' + esc(x.mark.title) + '" data-mark-client="' + esc(x.mark.client) + '" data-mark-client-id="' + esc(x.mark.clientId) + '"' : x.note ? '' : ' disabled') + /* a colleague's reply on my firm note carries its entry below (data-note-id): pressable */
      (x.order ? ' data-order="1"' : '') +
      (x.note ? ' data-note-id="' + esc(x.note) + '"' : '') +
      '><span aria-hidden="true">' +
      x.i +
      '</span><span style="min-width:0">' +
      '<div class="cbb-t">' +
      (x.who ? '<b>' + esc(x.who) + '</b> ' : '') +
      esc(x.say) +
      ' <b>' +
      esc(x.subj) +
      '</b></div>' +
      (x.d ? '<div class="cbb-d">' + esc(x.d) + '</div>' : '') +
      '<div class="cbb-s">' +
      esc(x.s) +
      '</div></span></button>'
    );
  }

  /** the open panel: title, the rows (yours first) or the error / empty line, and the footer with Clear all */
  function panelHtml(bell) {
    var items = bell.rows.map(line),
      mine = items.filter(function (x) {
        return x.mine;
      }),
      rest = items.filter(function (x) {
        return !x.mine;
      });
    var body = bell.err
      ? '<div class="cbb-none" data-testid="bell-error">' + esc(bellText(bellKit.BELL_WORDS.readFail)) + '</div>'
      : items.length
        ? (mine.length ? '<div class="cbb-sec">' + esc(bellText(bellKit.BELL_WORDS.forYou)) + '</div>' + mine.map(recordHtml).join('') : '') +
          (rest.length ? (mine.length ? '<div class="cbb-sec">' + esc(bellText(bellKit.BELL_WORDS.rest)) + '</div>' : '') + rest.map(recordHtml).join('') : '')
        : '<div class="cbb-none" data-testid="bell-empty">' + esc(bellText(bellKit.BELL_WORDS.none)) + '</div>';
    return (
      '<div class="cbb-panel" data-testid="bell-panel" role="dialog" data-pop="POP113" aria-label="' +
      esc(bellText(bellKit.BELL_WORDS.title)) +
      '"><div class="cbb-hd">' + bellChip('POP113', 'margin-inline-end:8px') +
      esc(bellText(bellKit.BELL_WORDS.title)) +
      '</div>' +
      body +
      '<div class="cbb-ft"><span class="cbb-out" data-testid="bell-out" data-tone="' +
      esc(bell.tone) +
      '">' +
      esc(bell.out) +
      '</span>' +
      '<button type="button" class="cbb-clear" data-cbsid="CMP014-B01"' + bellMount('CMP014') + ' data-testid="bell-clear"' +
      (items.length ? '' : ' disabled') +
      '>' +
      esc(bellText(bellKit.BELL_WORDS.clear)) +
      '</button></div></div>'
    );
  }
})(typeof window !== 'undefined' ? window : globalThis);
