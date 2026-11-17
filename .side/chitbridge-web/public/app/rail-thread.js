/* rail-thread.js — CBThread.mount: ONE composer + ONE list for a chit's messages, threaded by line (R02, 2026-10-09).
 * OWNS      CBThread: the one composer and the one list for a chit's messages (channel, kind, line, send), and the one POST /api/chits/:id/messages path
 * CALLED BY app.html (CBThread.mountAll, CBThread.send), app/cap-books.js, app/cap-dispute.js, app/cap-messages.js, app/cap-tasks.js, app/cap-worklist.js, app/chit-sheet.js (CBThread.mount); loaded by script tag on accounts, crm, finance, tasks and app.html
 * FLOW      mount(el, opts) ──▶ read GET /chits/:id/messages and chit.actions ──▶ paint the channels (greyed with the server's sentence) ──▶ send ──▶ CBAction ──▶ POST ──▶ repaint and emit cb:rail
 * CARD      01-rail-core-the-chit/thread-messages-on-a-chit
 *
 *
 * DESIGN-rail-modules-2026-10-05 §2.1 (CBThread): *"one composer + one list, threaded by line; replaces the 4 composers."*
 * Before this file the web repo posted to POST /chits/:id/messages from FOUR places — app.html `doSendMessage`, cap-messages
 * `msgSend`, cap-dispute `sendDisputeMsg`, cap-worklist `wlMsgSave` — four places for the audience line, the line_id, the
 * dispute scoping and the busy state to drift. Now there is one: `e2e/rail-thread-guard.cjs` fails the build on a second.
 *
 * ⚠️ THE API IS CORRECT AND IS NOT REIMPLEMENTED HERE (routes/chits.js :3661 POST · :3821 GET):
 *   POST /api/chits/:id/messages { thread_type: external|internal, message_text, msg_type?, line_id?, is_dispute?, dispute_id? }
 *        → { message_id, thread_type, message_text, sender_display_name, created_at }
 *        refusals: 403 { error, message, why } — `why` is the rail engine's word (read_only · comment_only · not_participant)
 *   GET  /api/chits/:id/messages ?thread_type=all|external|internal &line_id= &dispute=1   → { messages[], count }
 *        the SERVER decides the audience (per-copy rows under RLS): this list paints what it was handed, never more.
 *
 * ⭐ WHO MAY POST is the engine's answer, not this file's: `chit.actions.message_external / message_internal` from
 *   GET /chits/:id (R01). A refused channel is shown greyed WITH its sentence (CBRail.WHY, /engine/rail.js); a viewer
 *   (auditor) reads the thread and sees the sentence instead of a box. The server refuses the same way, so a ✓ here is
 *   never a 403 there — and a 403 is still said in the server's words, never a thrown error's text.
 *
 *   CBThread.mount(el, {
 *     chit_id,                       // the subject (required)
 *     line_id?,                      // one line's thread: every send carries it, the list is that line's
 *     dispute_id?,                   // one dispute's room: sends carry is_dispute + dispute_id; external only; the list is that dispute's
 *     actions?,                      // chit.actions (the host has the chit) — absent: read GET /chits/:id when EP.chit exists
 *     channel?: 'both'|'external'|'internal',   // which channels the composer offers (default both); the list follows
 *     thread_type?,                  // the channel selected first (default external when allowed, else internal)
 *     text?,                         // prefilled composer text (M28 Remind mounts with one)
 *     kinds?: ['info','query',…],    // msg_type choices; one or none → no chooser, 'info'
 *     lines?: [{ line_id, label }],  // the chit's lines: an "About" chooser on the composer and a tag on each row
 *     party?, me?,                   // the other party's name (the audience line) · my display name (my rows read "You")
 *     signature?,                    // appended to a dispute message ("— name@shop", the acting co-assist's provenance)
 *     decorate?(row) → { by, body, kind },   // a host's byline/prefix reader (cap-dispute's disputeByline)
 *     subject?: { type: 'mark', id },  // CAP-25: a mark's thread instead of a chit (chit_id then not needed); transport?(method, path, body): a host with its own headers (the auditor grant)
 *     readOnly?,                     // list only (a resolved dispute's room)
 *     ids?: { text, send },          // test ids for the box and the button when a host's spec drives them by other names
 *     context: { host, source? },    // who mounted it (rides on cb:rail)
 *     onList(rows, opts), onDone(result, opts), onCancel()
 *   }) → { refresh(), destroy(), send(text, extra), state(), el }
 *
 *   CBThread.send({ chit_id, text, thread_type, line_id?, dispute_id?, msg_type?, key? }) → Promise<result>   (no screen: a host's own
 *     button — Remind, Answer & publish). Goes through CBAction like every press. CBThread.last = the last send's result.
 *   CBThread.mountAll(scope, base) — every `[data-rt='{json}']` under scope not yet mounted → mount(el, Object.assign({}, base, json)).
 *
 *   Every send: CBAction.run (M64) — busy · one press one write · the outcome said under the button. Emits `cb:rail`
 *   { module:'thread', chit_id, result } on the host element (bubbles) so a row repaints locally.
 *
 * Reuse: CBAction (accounts-shell.js) · api/EP (core.js) · CBRail.WHY (/engine/rail.js, the sentences) · cbAttachList /
 * cbAttachButton (attach-ui.js: an attachment is pinned to a sent message, after the send, exactly as before) · CBLocale ·
 * CBOffline.saveDraft (the typed text survives a repaint). ZERO app.html globals: no UI, SESSION, paintDetail, modal, toast.
 */
(function (root) {
  'use strict';
  var threadKit = root.CBThreadKit; /* created by rail-thread-words.js, which loads first */
  threadKit.doc = root.document;

  /* ── the two routes, ONE name each (e2e/ep-aliases.cjs). app.html adds this to its EP beside CB_BOOKS_EP; a page without that
   line gets them at mount (ensureEP) — the attach-ui.js pattern. ── */
  var CB_THREAD_EP = {
    messages: { m: 'GET', p: '/api/chits/:id/messages', ok: 'y' }, // ?thread_type= &line_id= &dispute=1
    sendMsg: { m: 'POST', p: '/api/chits/:id/messages', ok: 'y' }, // the ONE composer's route
    marksMessages: { m: 'GET', p: '/api/marks/:id/messages', ok: 'y' }, // CAP-25: the same list, for a mark's thread (mount option `subject`)
    marksSend: { m: 'POST', p: '/api/marks/:id/messages', ok: 'y', idem: true } // the same composer, the mark's reply door
  };
  root.CB_THREAD_EP = CB_THREAD_EP;
  function ensureEP() {
    if (typeof EP === 'undefined' || !EP) return false;
    for (var k in CB_THREAD_EP) if (!EP[k]) EP[k] = CB_THREAD_EP[k];
    return true;
  }

  /** CAP-25: the ONE transport. A mount with `subject` reads and sends through the mark pair; a host with its own headers (the auditor's books grant) hands `transport(method, path, body)`; else the page's api() */
  function viaApi(o, key, opts) {
    if (o.subject) key = key === 'messages' ? 'marksMessages' : key === 'sendMsg' ? 'marksSend' : key;
    if (!o.transport) return api(key, opts);
    var ep = CB_THREAD_EP[key],
      path = ep.p.replace(':id', encodeURIComponent(opts.params.id)),
      q = Object.keys(opts.query || {}).map(function (n) { return encodeURIComponent(n) + '=' + encodeURIComponent(opts.query[n]); }).join('&');
    return o.transport(ep.m, path + (q ? '?' + q : ''), opts.body);
  }

  /* ── eligibility: the engine's verdict per channel ── */
  function verdict(m, ch) {
    var a = m.actions || null,
      k = ch === 'external' ? 'message_external' : 'message_internal';
    if (!a || !a[k]) return { ok: true, unknown: !a }; /* no answer yet: offer it; the server is the backstop */
    return a[k];
  }
  function allowed(m, ch) {
    return verdict(m, ch).ok !== false;
  }
  function channels(m) {
    var c = m.o.channel || 'both';
    return c === 'both' ? ['internal', 'external'] : [c];
  }

  /* ── the list: what the server handed this copy, filtered to the subject (line · dispute) ── */
  async function load(m) {
    if (!ensureEP() && !m.o.transport) {
      m.err = 'no EP';
      paint(m);
      return;
    }
    var options = m.o, ch = options.channel || 'both', q = listQuery(options);
    m.err = null;
    try {
      var reply = await viaApi(options, 'messages', { params: { id: options.chit_id }, query: q });
      var list = (reply && (reply.messages || reply.items || (Array.isArray(reply) ? reply : []))) || [];
      /* ⚠️ FILTERED AGAIN CLIENT-SIDE, the subject's rows only: a line's thread never absorbs the chit's (pre-b155 servers ignore
       line_id); a dispute room shows ITS dispute's rows; the general thread shows NO dispute row — those live in the room, for
       the roster, and a row a non-member was never handed cannot appear here because this list is only what came back. */
      list = list.filter(function (x) { return rowKept(options, ch, x); });
      list.sort(function (first, second) {
        return String(first.created_at || '').localeCompare(String(second.created_at || ''));
      }); /* a chat: oldest first, the newest at the BOTTOM next to the reply box (Athi, 15 Nov walk W15-26/W15-28; it was newest first since 2026-08-15) */
      m.rows = list;
    } catch (e) {
      m.err = (e && e.message) || 'fail';
    }
    paint(m);
    if (typeof options.onList === 'function' && m.rows) tellList(options, m.rows);
  }
  /** the host is told the rows it now holds; its own fault never stops the thread */
  function tellList(o, rows) {
    try {
      o.onList(rows.slice(), o);
    } catch (failure) { threadKit.quietly('thread:onList', failure); }
  }
  /** the question the list read asks: which threads, which line, which dispute (a mark's list takes no filter) */
  function listQuery(o) {
    if (o.subject) return {};
    var ch = o.channel || 'both', q = { thread_type: ch === 'both' || o.dispute_id ? 'all' : ch };
    if (o.line_id) q.line_id = o.line_id;
    if (o.dispute_id) q.dispute = '1';
    return q;
  }
  /** does this row belong to the subject on show (a dispute room's, a line's, or the general thread's channel) */
  function rowKept(o, ch, x) {
    if (o.dispute_id) return x.is_dispute && String(x.dispute_id) === String(o.dispute_id);
    if (x.is_dispute) return false;
    if (o.line_id && x.line_id && String(x.line_id) !== String(o.line_id)) return false;
    return !(!o.subject && ch !== 'both' && x.thread_type !== ch); /* a mark's thread has one channel and its rows carry no thread_type */
  }
  /** the chit's actions when the host did not hand them over — one GET through the page's `chit` row, deduped by core */
  async function readActions(m) {
    if (m.actions || m.o.subject || typeof EP === 'undefined' || !EP || !EP.chit) return;
    try {
      var reply = await api('chit', { params: { id: m.o.chit_id } });
      if (reply && reply.actions) {
        m.actions = reply.actions;
        paint(m);
      }
    } catch (_) { /* best effort: failing here changes nothing the user sees */ }
  }

  /* ── paint ── */
  /** a bubble that is not a posted message: the question a thread opens with (o.lead = { who, at, text, mine, tid }) */
  function leadHTML(L) {
    return (
      '<div class="rt-m lead' + (L.mine ? ' mine' : '') + '" data-testid="rt-lead" data-side="' + (L.mine ? 'mine' : 'theirs') + '">' +
      '<div class="rt-h"><b>' + esc(L.mine ? threadKit.threadText(threadKit.THREAD_WORDS.you) : L.who || '—') + '</b><span class="rt-t">' + esc(threadKit.when(L.at)) + '</span></div>' +
      '<div class="rt-b"' + (L.tid ? ' data-testid="' + esc(L.tid) + '"' : '') + '>' + esc(L.text || '') + '</div></div>'
    );
  }
  /** a dispute row's text goes through the page's decorator (who raised it); a fault in it changes nothing the person sees */
  function decorated(o, x) {
    if (!x.is_dispute || typeof o.decorate !== 'function') return null;
    try {
      return o.decorate(x.message_text || '');
    } catch (failure) {
      threadKit.quietly('thread:decorate', failure);
      return null;
    }
  }
  /** the row's tag: Dispute, or the channel (Internal / External) when the thread shows more than one */
  function rowTag(m, x, cls) {
    if (x.is_dispute) return '<span class="rt-tag disp">' + threadKit.threadText('⚑ Dispute') + '</span>';
    if (channels(m).length <= 1 && !m.o.dispute_id) return '';
    return '<span class="rt-tag ' + cls + '">' + threadKit.threadText(x.thread_type === 'external' ? threadKit.THREAD_WORDS.external : threadKit.THREAD_WORDS.internal) + '</span>';
  }
  /** the line a row is about, when the thread is not already one line's */
  function rowLineTag(o, x) {
    if (o.line_id || !x.line_id) return '';
    var line = (o.lines || []).filter(function (item) {
      return String(item.line_id) === String(x.line_id);
    })[0];
    return '<span class="rt-tag ln">' + esc(line ? line.label : threadKit.threadText(threadKit.THREAD_WORDS.line)) + '</span>';
  }
  /** the files attached to a row */
  function rowAttachments(x) {
    return x.attachments && x.attachments.length && typeof cbAttachList === 'function' ? '<div class="rt-att">' + cbAttachList(x.attachments) + '</div>' : '';
  }
  /** the Attach button under the message just sent (until the thread repaints) */
  function rowAttachButton(m, x) {
    var justSent = m.sent && String(m.sent.message_id) === String(x.message_id);
    return justSent && typeof cbAttachButton === 'function' && !m.o.readOnly ? '<div class="rt-att">' + cbAttachButton({ chit_id: m.o.chit_id, message_id: x.message_id }) + '</div>' : '';
  }
  /** my row: sent under my name, or just sent from this copy, or marked mine by the host */
  function rowIsMine(m, x) {
    var o = m.o;
    return !!(o.me && x.sender_display_name && String(x.sender_display_name) === String(o.me)) || !!(m.sent && String(m.sent.message_id) === String(x.message_id)) || x.mine === true;
  }
  /** the row's colour class: dispute, external or internal */
  function rowClass(x) {
    if (x.is_dispute) return 'disp';
    return x.thread_type === 'external' ? 'ext' : 'int';
  }
  function rowHTML(thread, x) {
    var options = thread.o, dec = decorated(options, x);
    var body = dec && dec.body != null ? dec.body : x.message_text || '';
    var mine = rowIsMine(thread, x), cls = rowClass(x);
    var tag = rowTag(thread, x, cls), ln = rowLineTag(options, x);
    var atts = rowAttachments(x), attBtn = rowAttachButton(thread, x);
    return (
      '<div class="rt-m ' +
      cls +
      (mine ? ' mine' : '') +
      '" data-testid="rt-row" data-side="' + (mine ? 'mine' : 'theirs') + '" data-id="' +
      esc(x.message_id) +
      '" data-thread="' +
      esc(x.thread_type) +
      '"' +
      (x.is_dispute ? ' data-dispute="' + esc(x.dispute_id) + '"' : '') +
      '>' +
      '<div class="rt-h">' +
      tag +
      ln +
      '<b>' +
      esc(mine ? threadKit.threadText(threadKit.THREAD_WORDS.you) : x.sender_display_name || '—') +
      '</b>' +
      (dec && dec.by ? '<span class="rt-why">· ' + esc(dec.by) + '</span>' : '') +
      '<span class="rt-t">' +
      esc(threadKit.when(x.created_at)) +
      '</span></div>' +
      '<div class="rt-b">' +
      esc(body) +
      '</div>' + threadKit.unconfirmedMark(x) +
      atts +
      attBtn +
      '</div>'
    );
  }
  /** the channel toggle (Internal / External), when the thread has more than one */
  function composerChannels(thread, list) {
    return (
      list.length > 1
        ? '<div class="rt-ch">' +
          list
            .map(function (item) {
              var ok = allowed(thread, item),
                nestedV = verdict(thread, item),
                on = thread.channel === item;
              return (
                '<button data-cbsid="SCR051-B01" type="button" class="' +
                (item === 'external' ? 'ext' : 'int') +
                (on ? ' on' : '') +
                (ok ? '' : ' off') +
                '" data-rt-act="ch" data-ch="' +
                item +
                '" data-testid="msg-channel-' +
                item +
                '"' +
                (ok ? '' : ' aria-disabled="true" title="' + esc(threadKit.reasonWords(nestedV.why)) + '"') +
                '>' +
                esc(threadKit.threadText(item === 'external' ? threadKit.THREAD_WORDS.external : threadKit.THREAD_WORDS.internal)) +
                '</button>'
              );
            })
            .join('') +
          '</div>'
        : ''
    );
  }
  /** why each channel that is off is off */
  function composerOffWhy(m, list) {
    return list
      .filter(function (item) {
        return !allowed(m, item);
      })
      .map(function (item) {
        return '<span class="rt-why" data-testid="rt-why-' + item + '">' + esc(threadKit.reasonWords(verdict(m, item).why)) + '</span>';
      })
      .join('');
  }
  /** the message kinds the host offers, when more than one */
  function composerKinds(thread, options) {
    return (
      options.kinds && options.kinds.length > 1
        ? '<span class="rt-row" data-testid="rt-kinds">' +
          options.kinds
            .map(function (item) {
              return (
                '<button data-cbsid="SCR051-B02" type="button" class="rt-k' +
                (thread.kind === item ? ' on' : '') +
                '" data-rt-act="kind" data-k="' +
                esc(item) +
                '">' +
                esc(threadKit.threadText(item.charAt(0).toUpperCase() + item.slice(1))) +
                '</button>'
              );
            })
            .join('') +
          '</span>'
        : ''
    );
  }
  /** the line a message is about, when the thread is not one line's */
  function composerLines(thread, options, disp) {
    return (
      !options.line_id && !disp && options.lines && options.lines.length
        ? '<label class="rt-row">' +
          esc(threadKit.threadText(threadKit.THREAD_WORDS.about)) +
          ' <select data-cbsid="SCR051-S01" class="rt-sel" data-rt-act="line" data-testid="rt-line"><option value="">' +
          esc(threadKit.threadText(threadKit.THREAD_WORDS.whole)) +
          '</option>' +
          options.lines
            .map(function (item) {
              return '<option value="' + esc(item.line_id) + '"' + (thread.line === String(item.line_id) ? ' selected' : '') + '>' + esc(item.label) + '</option>';
            })
            .join('') +
          '</select></label>'
        : ''
    );
  }
  function composerHTML(thread) {
    var o = thread.o,
      ids = o.ids || {};
    var list = channels(thread),
      can = list.filter(function (item) {
        return allowed(thread, item);
      });
    if (!can.length) {
      var v = verdict(thread, list[0]);
      return '<div class="rt-no" data-testid="rt-no">' + esc(threadKit.reasonWords(v.why, threadKit.threadText(threadKit.THREAD_WORDS.viewOnly))) + '</div>';
    }
    if (can.indexOf(thread.channel) < 0) thread.channel = can[0];
    var disp = !!o.dispute_id,
      ext = thread.channel === 'external';
    var toggle = composerChannels(thread, list);
    var offWhy = composerOffWhy(thread, list);
    var kinds = composerKinds(thread, o);
    var lines = composerLines(thread, o, disp);
    var aud = disp ? threadKit.threadText(threadKit.THREAD_WORDS.audDispute) : ext ? threadKit.fill(threadKit.threadText(o.no_channel ? threadKit.THREAD_WORDS.audNoChannel : threadKit.THREAD_WORDS.audExternal), { party: o.party || threadKit.threadText('the other party') }) : threadKit.threadText(threadKit.THREAD_WORDS.audInternal);
    var tone = disp ? 'disp' : ext ? 'ext' : 'int';
    return (
      '<div class="rt-comp ' +
      tone +
      '" data-testid="rt-composer">' +
      (toggle || kinds ? '<div class="rt-row">' + toggle + kinds + '</div>' : '') +
      offWhy +
      lines +
      '<div class="rt-aud ' +
      tone +
      '" data-testid="rt-aud">' +
      esc(aud) +
      '</div>' +
      '<div class="rt-box"><textarea data-cbsid="SCR051-T01" data-rt-act="text" data-testid="' +
      esc(ids.text || 'msg-body') +
      '" aria-label="' +
      esc(threadKit.threadText(threadKit.THREAD_WORDS.write)) +
      '" rows="1" placeholder="' +
      esc(o.reason ? threadKit.threadText(o.reason) : o.no_channel && ext ? aud : threadKit.threadText(threadKit.THREAD_WORDS.write)) + /* a thread that cannot send says WHY in the box (the caller's own reason, else the no-channel sentence), never the generic prompt */
      '">' +
      esc(thread.text) +
      '</textarea>' +
      '<button data-cbsid="SCR051-B03" type="button" class="rt-send ' +
      tone +
      '" data-rt-act="send" data-testid="' +
      esc(ids.send || 'msg-send') +
      '">' +
      esc(threadKit.threadText(threadKit.THREAD_WORDS.send)) +
      '</button></div>' +
      '<div class="rt-foot"><span class="rt-out" role="status" data-testid="rt-out" data-tone=""></span></div></div>'
    );
  }
  function listHTML(m) {
    var o = m.o;
    if (m.err) return '<div class="rt-empty" data-testid="rt-err">' + esc(threadKit.threadText(threadKit.THREAD_WORDS.readFail)) + '</div>';
    if (!m.rows) return '<div class="rt-empty">' + esc(threadKit.threadText(threadKit.THREAD_WORDS.reading)) + '</div>';
    var lead = o.lead ? leadHTML(o.lead) : '';
    if (!m.rows.length) return lead + (o.lead ? '' : '<div class="rt-empty" data-testid="rt-empty">' + esc(threadKit.threadText(o.line_id ? threadKit.THREAD_WORDS.noneLine : threadKit.THREAD_WORDS.none)) + '</div>');
    return (
      '<div class="rt-n" data-testid="rt-count">' +
      esc(threadKit.fill(threadKit.threadText(m.rows.length === 1 ? threadKit.THREAD_WORDS.count1 : threadKit.THREAD_WORDS.countN), { n: m.rows.length })) +
      '</div>' +
      lead +
      m.rows
        .map(function (x) {
          return rowHTML(m, x);
        })
        .join('')
    );
  }
  /** a host's node outlives the repaint: detach before the innerHTML wipe, put back after */
  function detachAbove(m) {
    var above = m.o.above && m.o.above.nodeType ? m.o.above : null;
    if (above && above.parentNode) above.parentNode.removeChild(above);
    return above;
  }
  /** the thread's frame: the list, the slot a host's node goes back into, and the composer */
  function frameHTML(thread, composer) {
    return (
      '<div class="rt' + (thread.o.fill ? ' fill' : '') + '" data-testid="rt" data-chit="' +
      esc(thread.o.chit_id) +
      '">' +
      '<div class="rt-list" data-testid="rt-list" tabindex="-1" role="log" aria-live="polite">' +
      listHTML(thread) +
      '</div>' +
      '<div class="rt-above" data-testid="rt-above"></div>' +
      composer +
      '</div>'
    );
  }
  function paint(m) {
    if (!m.el || !m.el.isConnected) return;
    var keep = m.el.querySelector('[data-rt-act="text"]');
    if (keep) m.text = keep.value;
    var hadFocus = !!keep && threadKit.doc.activeElement === keep;
    var above = detachAbove(m);
    var composer = m.o.readOnly ? '' : composerHTML(m);
    m.el.innerHTML = frameHTML(m, composer);
    var slot = m.el.querySelector('[data-testid="rt-above"]');
    if (above && slot) slot.appendChild(above);
    var list = m.el.querySelector('.rt-list');
    if (list) list.scrollTop = list.scrollHeight; /* opens on the newest */
    if (hadFocus || (m.o.focus && !m.focused && m.rows)) focusComposer(m);
  }
  /** the reply box takes the keyboard (once for an opened thread, again when it held it before the repaint) */
  function focusComposer(m) {
    var box = m.el.querySelector('[data-rt-act="text"]');
    if (!box) return;
    m.focused = true;
    try {
      box.focus({ preventScroll: true });
    } catch (failure) { threadKit.quietly('thread:focus', failure); }
  }

  /* ── the one send ── */
  function bodyFor(o, text, ch, extra) {
    extra = extra || {};
    if (o.subject) return { message_text: text, msg_type: extra.msg_type || 'info' }; /* the mark's reply door takes these two and nothing else */
    var b = { thread_type: o.dispute_id ? 'external' : ch, message_text: text, msg_type: extra.msg_type || 'info' };
    var line = extra.line_id !== undefined ? extra.line_id : o.line_id;
    if (line) b.line_id = line;
    if (o.dispute_id) {
      b.is_dispute = true;
      b.dispute_id = o.dispute_id;
      if (o.signature) b.message_text = text + '  ' + o.signature;
    }
    return b;
  }
  function emit(el, chit_id, result) {
    try {
      (el || threadKit.doc).dispatchEvent(new CustomEvent('cb:rail', { bubbles: true, detail: { module: 'thread', chit_id: chit_id, result: result } }));
    } catch (_) { /* best effort: failing here changes nothing the user sees */ }
  }
  /** post ONE message through CBAction (busy · one press one write · outcome). btn may be null (a host's own control, or none). */
  function post(btn, o, body, say) {
    if (typeof CBAction === 'undefined' || !CBAction || typeof CBAction.run !== 'function') {
      throw new Error('CBThread needs CBAction (app/accounts-shell.js) on the page — every send goes through the action-state helper');
    }
    ensureEP();
    return CBAction.run(
      btn,
      function () {
        return viaApi(o, 'sendMsg', { params: { id: o.chit_id }, body: body });
      },
      {
        key: 'rt:' + o.chit_id + ':' + (o.line_id || '') + ':' + (o.dispute_id || ''),
        busy: threadKit.threadText(threadKit.THREAD_WORDS.sending),
        out: say.out,
        failed: threadKit.threadText(threadKit.THREAD_WORDS.failed),
        outcome: say.outcome,
        onFail: say.onFail
      }
    ).then(function (res) {
      if (res.ok) {
        var v = Object.assign({}, res.value || {}, {
          chit_id: o.chit_id,
          thread_type: body.thread_type,
          line_id: body.line_id || null,
          dispute_id: body.dispute_id || null
        });
        CBThread.last = v;
        emit(btn, o.chit_id, v);
        return v;
      }
      /* a refusal is the server's own sentence, already said by CBAction; the caller reads res.error.data.why */
      CBThread.last = { ok: false, error: res.error || null, cancelled: !!res.cancelled, skipped: !!res.skipped };
      return CBThread.last;
    });
  }

  /* ── mount ── */
  /** the state of one mounted thread: its rows, the actions, the text typed so far and the first channel (the one asked for when allowed, else external when allowed, else internal) */
  function threadState(el, o) {
    var m = {
      el: el,
      o: o,
      rows: null,
      err: null,
      actions: o.actions || (o.chit && o.chit.actions) || null,
      sent: null,
      kind: (o.kinds && o.kinds[0]) || 'info',
      line: '',
      text: o.text != null ? String(o.text) : threadKit.draftGet(o)
    };
    /* first channel: the one asked for when allowed, else external when allowed, else internal */
    var want = o.dispute_id ? 'external' : o.thread_type || (o.channel && o.channel !== 'both' ? o.channel : 'external');
    m.channel = allowed(m, want)
      ? want
      : channels(m).filter(function (item) {
          return allowed(m, item);
        })[0] || want;
    return m;
  }
  function mount(el, o) {
    el = typeof el === 'string' ? threadKit.doc.getElementById(el) : el;
    if (o && o.subject && o.subject.id && !o.chit_id) o = Object.assign({}, o, { chit_id: o.subject.id, channel: 'external' }); /* CAP-25: a mark's thread: one channel, the subject id keys the drafts */
    if (!el || !o || !o.chit_id) return null;
    threadKit.addCss();
    ensureEP();
    if (el.__cbthread) el.__cbthread.api.destroy();
    var thread = threadState(el, o);

    function onClick(event) {
      var node = event.target.closest ? event.target.closest('[data-rt-act]') : null;
      if (!node || !el.contains(node)) return;
      var act = node.getAttribute('data-rt-act');
      if (act === 'ch') {
        if (node.classList.contains('off')) return;
        thread.channel = node.getAttribute('data-ch');
        paint(thread);
        return;
      }
      if (act === 'kind') {
        thread.kind = node.getAttribute('data-k');
        paint(thread);
        return;
      }
      if (act === 'send') {
        event.preventDefault();
        sendPress(node);
      }
    }
    function onInput(ev) {
      var node = ev.target;
      if (node.getAttribute('data-rt-act') === 'text') {
        thread.text = node.value;
        threadKit.draftSet(o, node.value);
        node.style.height = 'auto';
        node.style.height = Math.min(node.scrollHeight + 2, 140) + 'px'; /* grows with Shift+Enter lines, then scrolls inside */
      }
      if (node.getAttribute('data-rt-act') === 'line') thread.line = node.value;
    }
    function out() {
      return el.querySelector('[data-testid="rt-out"]');
    }
    function sendPress(btn) {
      var box = el.querySelector('[data-rt-act="text"]');
      var text = String((box ? box.value : thread.text) || '').trim();
      var node = out();
      if (!text) {
        if (node) {
          node.textContent = threadKit.threadText(threadKit.THREAD_WORDS.empty);
          node.setAttribute('data-tone', 'error');
        }
        return;
      }
      if (!allowed(thread, thread.channel)) {
        if (node) {
          node.textContent = threadKit.reasonWords(verdict(thread, thread.channel).why);
          node.setAttribute('data-tone', 'error');
        }
        return;
      }
      var body = bodyFor(o, text, thread.channel, { msg_type: thread.kind, line_id: thread.line || undefined });
      return post(btn, o, body, {
        out: node,
        outcome: function (v) {
          thread.sent = Object.assign({}, v || {}, { message_id: (v && v.message_id) || null });
          threadKit.draftClear(o);
          thread.text = '';
          var element = el.querySelector('[data-rt-act="text"]');
          if (element) element.value = ''; /* paint re-reads the box, so it is emptied in the DOM too */
          var s = threadKit.sentWords(o, body, v);
          var nestedNode = out();
          if (nestedNode) {
            nestedNode.textContent = s;
            nestedNode.setAttribute('data-tone', 'ok');
          }
          if (typeof o.onDone === 'function') {
            try {
              o.onDone(thread.sent, o);
            } catch (_) { /* best effort: failing here changes nothing the user sees */ }
          }
          load(thread).then(function () {
            var target = out();
            if (target) {
              target.textContent = s;
              target.setAttribute('data-tone', 'ok');
            }
          });
        },
        onFail: function (words, e) {
          /* the server's refusal in the server's words (a 403 carries `why`: the engine's word, its sentence preferred) */
          var w = words,
            d = e && e.data;
          if (d && d.why) w = threadKit.reasonWords(d.why, d.message || words);
          var element = out();
          if (element) {
            element.textContent = w;
            element.setAttribute('data-tone', 'error');
          }
          if (d && d.why && thread.actions) {
            var k = body.thread_type === 'external' ? 'message_external' : 'message_internal';
            thread.actions[k] = { ok: false, why: d.why };
          }
        }
      });
    }
    function onKey(ev) {
      var node = ev.target;
      if (!node || !node.getAttribute || node.getAttribute('data-rt-act') !== 'text') return;
      if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing && !ev.ctrlKey && !ev.altKey) {
        ev.preventDefault(); /* Enter sends, Shift+Enter is a new line */
        var send = el.querySelector('[data-rt-act="send"]');
        if (send) sendPress(send);
      }
    }
    el.addEventListener('keydown', onKey);
    el.addEventListener('click', onClick);
    el.addEventListener('input', onInput);
    el.addEventListener('change', onInput);
    var api_ = {
      el: el,
      refresh: function () {
        return load(thread);
      },
      destroy: function () {
        el.removeEventListener('keydown', onKey);
        el.removeEventListener('click', onClick);
        el.removeEventListener('input', onInput);
        el.removeEventListener('change', onInput);
        el.__cbthread = null;
      },
      state: function () {
        return { channel: thread.channel, rows: thread.rows ? thread.rows.slice() : null, actions: thread.actions, sent: thread.sent, text: thread.text };
      },
      /** a host's own send on this mount: text → the mounted subject's thread (M28 Remind mounts with a prefilled text and may press this) */
      send: function (text, extra) {
        extra = extra || {};
        var ch = extra.thread_type || thread.channel;
        return post(el.querySelector('[data-rt-act="send"]'), o, bodyFor(o, String(text || thread.text || '').trim(), ch, extra), {
          out: out(),
          outcome: function (v) {
            thread.sent = v;
            threadKit.draftClear(o);
            thread.text = '';
            var node = el.querySelector('[data-rt-act="text"]');
            if (node) node.value = '';
            load(thread);
            if (typeof o.onDone === 'function') {
              try {
                o.onDone(v, o);
              } catch (_) { /* best effort: failing here changes nothing the user sees */ }
            }
          },
          onFail: function (words, e) {
            var d = e && e.data,
              node = out();
            if (node) {
              node.textContent = d && d.why ? threadKit.reasonWords(d.why, d.message || words) : words;
              node.setAttribute('data-tone', 'error');
            }
          }
        });
      }
    };
    thread.api = api_;
    el.__cbthread = thread;
    paint(thread);
    load(thread);
    readActions(thread);
    return api_;
  }

  /** a send with no screen of its own (Answer & publish · Remind): the same route, the same helper, the same event */
  function send(a) {
    a = a || {};
    var o = { chit_id: a.chit_id, line_id: a.line_id || null, dispute_id: a.dispute_id || null, signature: a.signature || '' };
    if (!o.chit_id || !a.text) return Promise.reject(new Error('CBThread.send: chit_id and text are needed'));
    var body = bodyFor(o, String(a.text).trim(), a.thread_type || 'external', { msg_type: a.msg_type, line_id: a.line_id });
    return post(a.button || null, o, body, { out: a.out || null, outcome: a.outcome || function () {}, onFail: a.onFail || null });
  }
  function mountAll(scope, base) {
    scope = scope || threadKit.doc;
    if (!scope || !scope.querySelectorAll) return [];
    var out = [];
    Array.prototype.forEach.call(scope.querySelectorAll('[data-rt]'), function (el) {
      if (el.__cbthread) return;
      var j = {};
      try {
        j = JSON.parse(el.getAttribute('data-rt') || '{}');
      } catch (_) {
        return;
      }
      var r = mount(el, Object.assign({}, base || {}, j));
      if (r) out.push(r);
    });
    return out;
  }

  var CBThread = { when: threadKit.when, /* the one date-time stamp (cap-mark.js reads it here, no copy) */ mount: mount, mountAll: mountAll, send: send, lead: function (L) { threadKit.addCss(); return '<div class="rt"><div class="rt-list">' + leadHTML(L) + '</div></div>'; }, last: null, EP: CB_THREAD_EP, WORDS: threadKit.THREAD_WORDS };
  root.CBThread = CBThread;
})(typeof globalThis !== 'undefined' ? globalThis : this);
