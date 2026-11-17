/**
 * rail-thread-words.js — R03 part of rail-thread.js: the thread's words, styles and drafts.
 *
 * OWNS      the thread's wording table, the small word helpers (translate, fill, when, why, the unconfirmed mark, the sent line), its styles (once) and the unsent drafts a person keeps per thread
 * CALLED BY rail-thread.js (through root.CBThreadKit); loaded before it on every page that loads rail-thread.js
 * FLOW      threadKit.T(words) → the reader's words; threadKit.draftGet(o) / draftSet(o, text) / draftClear(o) → the unsent text kept for this thread
 * CARD      01-rail-core-the-chit/rail-thread
 *
 * Decides nothing: a draft is the person's own unsent text, kept in this browser only.
 */
(function (root) {
  'use strict';
  var threadKit = (root.CBThreadKit = root.CBThreadKit || {});
  threadKit.quietly = quietly;
  threadKit.threadText = threadText;
  threadKit.fill = fill;
  threadKit.unconfirmedMark = unconfirmedMark;
  threadKit.sentWords = sentWords;
  threadKit.when = when;
  threadKit.reasonWords = reasonWords;
  threadKit.addCss = addCss;
  threadKit.draftGet = draftGet;
  threadKit.draftSet = draftSet;
  threadKit.draftClear = draftClear;

  /* ── the words, one place (copy budget: a label, a verb, a sentence) ── */
  threadKit.THREAD_WORDS = {
    internal: '🔒 Internal',
    external: '↔ External',
    audInternal: '🔒 Team only — the other party never sees this',
    audExternal: '↔ {party} sees this. It cannot be unsent',
    audNoChannel: '{party} has no phone or e-mail on record and is not on the network; add one to send this',
    audDispute: '⚑ Dispute — only its members see this',
    send: 'Send',
    write: 'Write a reply',
    count1: '1 message',
    countN: '{n} messages',
    sending: 'Sending…',
    sentInt: '🔒 Note added — team only',
    sentExt: '↔ Sent — {party} notified',
    sentWait: '⏳ Waiting for {where} — not delivered yet',
    sentDisp: '⚑ Sent to the dispute',
    empty: 'Type a message first',
    none: 'No messages yet',
    noneLine: 'Nothing on this line yet',
    reading: 'Reading…',
    readFail: 'Could not read the messages — this does not mean there are none',
    failed: 'Not sent — try again',
    you: 'You',
    whole: 'Whole order',
    about: 'About',
    attach: '📎 Attach',
    line: 'Line',
    viewOnly: 'View only — you can read, not reply'
  };
  function threadText(s) {
    return typeof tx === 'function' ? tx(s) : s;
  }
  function fill(s, v) {
    return String(s).replace(/\{(\w+)\}/g, function (_, k) {
      return v[k] == null ? '' : v[k];
    });
  }
  /** a failure that changes nothing the person sees is still told to the log */
  function quietly(where, failure) {
    if (root.cbQuiet) root.cbQuiet(where, failure);
  }
  /** RAIL-118: my message the other installation has not confirmed carries the mark until it does */
  function unconfirmedMark(x) {
    return x.ctp_unconfirmed ? '<div class="rt-why" data-testid="rt-unconfirmed" data-tone="warn">⏳ ' + esc(x.ctp_unconfirmed) + '</div>' : '';
  }
  /** RAIL-118: what a send says once it is made. A message to a business on another installation that is only QUEUED is not "notified" — say it is waiting (silence is the bug) */
  function isHeld(reply) {
    return reply && reply.ctp && (reply.ctp.queued || reply.ctp.why);
  }
  function sentWords(thread, body, reply) {
    var held = isHeld(reply);
    if (thread.dispute_id) return threadText(threadKit.THREAD_WORDS.sentDisp);
    if (body.thread_type && body.thread_type !== 'external') return threadText(threadKit.THREAD_WORDS.sentInt);
    if (held) return reply.ctp.why || fill(threadText(threadKit.THREAD_WORDS.sentWait), { where: thread.where || thread.party || threadText('the other side') });
    return fill(threadText(threadKit.THREAD_WORDS.sentExt), { party: thread.party || threadText('the other party') });
  }
  function when(ts) {
    if (!ts) return '';
    try {
      if (typeof root.shopDateTime === 'function') return root.shopDateTime(ts); /* UX-123: the shop's zone */
      if (root.CBLocale) return root.CBLocale.datetime(ts);
    } catch (failure) { quietly('thread:when', failure); } /* CU4: the one date-time stamp */ /* best effort: failing here changes nothing the user sees */
    return String(ts).replace('T', ' ').slice(0, 16);
  }
  /** the sentence for an engine refusal word — the engine's own (CBRail.WHY) when the page loads /engine/rail.js, else the server's words */
  function reasonWords(word, fallback) {
    try {
      var R = root.CBRail;
      if (R && R.WHY && Object.prototype.hasOwnProperty.call(R.WHY, word)) return R.WHY[word];
    } catch (failure) { quietly('thread:reason', failure); } /* best effort: failing here changes nothing the user sees */
    return fallback || threadText(threadKit.THREAD_WORDS.viewOnly);
  }

  /* ── CSS, once, prefixed rt- ── */
  var THREAD_CSS =
    '.rt{display:flex;flex-direction:column;gap:8px;font-size:var(--fs-2,14px);color:var(--on-card,inherit)}' +
    '.rt-comp{border:1px solid var(--line,#DDD6C6);border-radius:12px;padding:10px;background:var(--card,#fff)}' +
    '.rt-comp.ext{background:var(--blue-tint-bg,#eef4fb)}.rt-comp.disp{border-color:var(--disp,#8E3517)}' +
    '.rt-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:7px}' +
    '.rt-ch{display:inline-flex;border:1px solid var(--line,#DDD6C6);border-radius:9px;overflow:hidden}' +
    '.rt-ch button{border:0;background:var(--card,#fff);font:inherit;font-size:var(--fs-1,12px);font-weight:700;padding:6px 11px;color:var(--grey,#5E594D);cursor:pointer;min-height:32px}' +
    '.rt-ch button.on.int{background:var(--slate,#45596a);color:var(--on-slate,#fff)}.rt-ch button.on.ext{background:var(--blue,#1f5fa8);color:var(--on-accent,#fff)}' +
    '.rt-ch button.off{opacity:.45;cursor:not-allowed;text-decoration:line-through}' +
    '.rt-k{border:1px solid var(--line,#DDD6C6);background:var(--card,#fff);border-radius:9px;font:inherit;font-size:var(--fs-1,12px);padding:4px 9px;cursor:pointer;color:var(--grey,#5E594D)}.rt-k.on{border-color:var(--blue,#1f5fa8);color:var(--blue,#1f5fa8);font-weight:700}' +
    '.rt-sel{font:inherit;font-size:var(--fs-1,12px);border:1px solid var(--line,#DDD6C6);border-radius:9px;padding:5px 8px;background:var(--card,#fff);color:inherit;max-width:100%}' +
    '.rt textarea{width:100%;box-sizing:border-box;border:1px solid var(--line,#DDD6C6);border-radius:9px;padding:9px;font:inherit;font-size:var(--fs-2,14px);min-height:56px;resize:vertical;background:var(--card,#fff);color:inherit}' +
    '.rt-aud{font-size:var(--fs-1,12px);margin:6px 0;color:var(--grey,#5E594D)}.rt-aud.ext{color:var(--blue,#1f5fa8);font-weight:700}.rt-aud.disp{color:var(--disp,#8E3517);font-weight:700}' +
    '.rt-foot{display:flex;gap:8px;align-items:center;flex-wrap:wrap}' +
    '.rt-send{border:0;color:var(--on-accent,#fff);border-radius:9px;font:inherit;font-size:var(--fs-2,14px);font-weight:700;padding:9px 16px;cursor:pointer;min-height:40px;background:var(--slate,#5f7682)}.rt-send.int{background:var(--slate,#45596a);color:var(--on-slate,#fff)}' +
    '.rt-send.ext{background:var(--blue,#1f5fa8)}.rt-send.disp{background:var(--disp,#8E3517)}.rt-send[disabled]{opacity:.55;cursor:not-allowed}' +
    '.rt-out{font-size:var(--fs-1,12px);min-height:1em}.rt-out[data-tone=error]{color:var(--disp,#8E3517);font-weight:700}.rt-out[data-tone=ok]{color:var(--ok-2,#16693F);font-weight:700}' +
    '.rt-no{border:1px dashed var(--line,#DDD6C6);border-radius:9px;padding:9px 11px;color:var(--grey,#5E594D);font-size:var(--fs-2,14px)}' +
    '.rt-why{font-size:var(--fs-1,12px);color:var(--grey,#5E594D)}' +
    '.rt-list{display:flex;flex-direction:column;gap:8px;overflow-y:auto;overflow-x:hidden;max-height:var(--rt-max,min(46vh,380px));min-height:64px;padding:4px 2px;overscroll-behavior:contain}' +
    '.rt.fill{height:100%;min-height:0}.rt.fill .rt-list{flex:1 1 auto;max-height:none}.rt-n{font-size:var(--fs-1,12px);color:var(--grey,#5E594D);align-self:center}' +
    '.rt-above{display:flex;flex-direction:column;gap:6px}.rt-above:empty{display:none}' +
    '.rt-box{display:flex;gap:8px;align-items:flex-end}.rt-box textarea{flex:1 1 auto;min-width:0;min-height:44px;max-height:140px;resize:none}.rt-box .rt-send{flex:0 0 auto;min-height:44px}' +
    '.rt-m{border:1px solid var(--line,#DDD6C6);border-radius:14px 14px 14px 4px;padding:8px 12px;background:var(--card,#fff);max-width:86%;align-self:flex-start;box-sizing:border-box;overflow-wrap:anywhere}' +
    '.rt-m.ext{border-inline-start:3px solid var(--blue,#1f5fa8)}.rt-m.disp{background:var(--danger-tint,#fbeeec);border-inline-start:3px solid var(--disp,#8E3517)}' +
    '.rt-m.mine{align-self:flex-end;border-radius:14px 14px 4px 14px;background:var(--blue-tint-bg,#eef4fb);border-color:var(--blue-line,#B9D2EF)}' +
    '.rt-h{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;font-size:var(--fs-1,12px);margin-bottom:3px}.rt-h b{color:var(--ink,#1D1B16)}.rt-h .rt-t{margin-inline-start:auto;color:var(--grey,#5E594D)}' +
    '.rt-tag{border-radius:6px;padding:1px 7px;font-weight:700;font-size:var(--fs-1,12px)}.rt-tag.int{background:var(--blue-tint-bg,#eef4fb);color:var(--grey,#5f7682)}.rt-tag.ext{background:var(--blue-tint-bg,#eef4fb);color:var(--blue,#1f5fa8)}.rt-tag.disp{background:var(--danger-tint,#fbeeec);color:var(--disp,#8E3517)}.rt-tag.ln{background:var(--paper,#f4f1ea);color:var(--grey,#5E594D)}' +
    '.rt-b{white-space:pre-wrap;line-height:1.45}.rt-att{margin-top:6px}.rt-empty{color:var(--grey,#5E594D);padding:8px 2px}';
  var cssDone = false;
  function addCss() {
    if (cssDone || !threadKit.doc) return;
    cssDone = true;
    var node = threadKit.doc.createElement('style');
    node.setAttribute('data-cbrt', '1');
    node.textContent = THREAD_CSS;
    (threadKit.doc.head || threadKit.doc.documentElement).appendChild(node);
  }

  /* ── drafts: the typed text survives a repaint (and a reload when CBOffline is on the page) ── */
  var DRAFTS = {};
  function dkey(o) {
    return 'rt.' + (o.subject ? o.subject.type + '.' : '') + o.chit_id + '.' + (o.line_id || '') + '.' + (o.dispute_id || '');
  }
  function draftGet(o) {
    var k = dkey(o);
    if (DRAFTS[k] != null) return DRAFTS[k];
    try {
      var C = root.CBOffline;
      if (C && C.loadDraft) return C.loadDraft(k) || '';
    } catch (failure) { quietly('thread:draft-load', failure); } /* best effort: failing here changes nothing the user sees */
    return '';
  }
  function draftSet(o, v) {
    var k = dkey(o);
    DRAFTS[k] = v;
    try {
      var C = root.CBOffline;
      if (C && C.saveDraft) C.saveDraft(k, v);
    } catch (failure) { quietly('thread:draft-save', failure); } /* best effort: failing here changes nothing the user sees */
  }
  function draftClear(o) {
    var k = dkey(o);
    delete DRAFTS[k];
    try {
      var C = root.CBOffline;
      if (C && C.clearDraft) C.clearDraft(k);
    } catch (failure) { quietly('thread:draft-clear', failure); } /* best effort: failing here changes nothing the user sees */
  }
})(typeof window !== 'undefined' ? window : globalThis);
