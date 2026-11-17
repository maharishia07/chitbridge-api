/* rail-advice.js — CBAdvice.mount: the payment ADVICE, OUT — send it to a party on the rail, share it with one who is not (M30, 2026-10-09).
 *
 * OWNS      the payment-advice panel only: paint the Send / Share buttons from the server's `may`, press them through CBAction, repaint locally.
 * CALLED BY app/cap-books.js (CBAdvice.mount, the payment outcome and the statement row) and app/cap-bank.js (CBAdvice.sendBody); loaded by script tag on accounts, crm, finance and app.html
 * FLOW      mount ──▶ load (GET advice) ──▶ paint ──▶ sendPress | sharePress ──▶ settle ──▶ cb:rail event on the host
 * CARD 16-finance/cb-finance
 *
 * SPEC-payments-2026-10-05 §3 · §4.3 · §5; DESIGN-rail-modules §2.1 (CBAdvice); FIT-shell Supplier line: *the payer settles its own books
 * and informs; the payer never sees the payee's books.* M31 (the payee's Accept / Dispute) is the next row — this unit only SENDS.
 *
 * ⚠️ THE API DECIDES, THIS FILE PAINTS (routes/books.js M30):
 *   GET   /api/books/payments/:id/advice → { party: { party_id, name, on_rail }, advice: { chit_id, state, shared_at },
 *                                             may: { send_advice, share_advice }, words, body, share: { text, wa, mailto } }
 *   POST  /api/chits/send   with `body`  → { chit_id }           (client_ref 'advice:pay:<id>' — a retry answers the first chit)
 *   PATCH /api/books/payments/:id { advice_chit_id } | { advice_shared_at: true } → { ok, advice: { chit_id, state, shared_at } }
 *   The same block rides on POST /api/books/payments as `advice`, so the outcome panel mounts without a second read.
 *
 * ⭐ SHOW EVERY ACTION, ENABLE BY ROLE (owner, 2026-10-09): "Send advice" and "Share" are ALWAYS painted; whether THIS login may press
 *   each is the server's `may.*` answer — a refused one is greyed WITH its sentence (`say`), never hidden, never decided here. The
 *   server refuses the same way (403 / 409 with `why`), and a refusal is said in the server's words, never a thrown error's text.
 * ⭐ Every press goes through CBAction (M64): busy · one press one write · the outcome said under the buttons. Amounts never appear
 *   here except inside the server's `words` (the M36 money unit composed them server-side: bill-privacy.money).
 * ⭐ One DOM event `cb:rail` { module: 'advice', payment_id, result: { chit_id, state, shared_at } } on the host, so the statement row
 *   repaints its chip locally (feedback-repaint-locally).
 *
 *   CBAdvice.mount(el, {
 *     payment_id,                    // the subject (required)
 *     advice?,                       // the block POST /payments answered (no read then); absent → GET /payments/:id/advice
 *     party?,                        // the other party's name for the outcome line (the block's party.name wins)
 *     context: { host, source? },    // who mounted it (rides on cb:rail)
 *     onDone(result, opts), onCancel()
 *   }) → { refresh(), destroy(), state(), el }
 *   CBAdvice.STATE_WORDS — the chip words per state (a host paints the same words on its row)
 *
 * Reuse: CBAction (accounts-shell.js) · api/EP (core.js) · tx (accounts-shell.js) · CBLocale (the shared-at moment). ZERO app.html globals.
 
 */
(function (root) {
  'use strict';
  var doc = root.document;

  /* ── the routes, ONE name each (e2e/ep-aliases.cjs). The chit send keeps app.html's name `createChit`; a page without that row gets it
   at mount, by assignment (not a second registration) — the attach-ui.js / rail-thread.js pattern. ── */
  var CB_ADVICE_EP = {
    booksPayAdvice: { m: 'GET', p: '/api/books/payments/:id/advice' }, // the read: party · may · words · body · share
    booksPayPatch: { m: 'PATCH', p: '/api/books/payments/:id', idem: 'attempt' } // the merge-patch: advice_chit_id | advice_shared_at
  };
  root.CB_ADVICE_EP = CB_ADVICE_EP;
  function ensureEP() {
    if (typeof EP === 'undefined' || !EP) return false;
    for (var k in CB_ADVICE_EP) if (!EP[k]) EP[k] = CB_ADVICE_EP[k];
    if (!EP.createChit) EP.createChit = { m: 'POST', p: '/api/chits/send', ok: '✓' };
    return true;
  }

  /* ── the words, one place (copy budget: a label, a verb, a sentence) ── */
  var W = {
    send: 'Send advice',
    again: 'Send again',
    recordAgain: 'Save again',
    sending: 'Sending…',
    share: 'Share',
    copy: 'Copy',
    wa: 'WhatsApp',
    mail: 'E-mail',
    sent: 'Advice sent to {party} ✓',
    notSent: 'Advice not sent — Send again',
    notRecorded: 'Advice sent to {party}, but not saved here yet — Save again',
    shared: 'Advice shared ✓',
    copied: 'Copied — paste it to {party}',
    reading: 'Reading…',
    readFail: 'Could not read the advice — try again'
  };
  var STATE_WORDS = { none: '', sent: '✉ advice sent', delivered: '✉ advice sent · delivered', shared: '↗ advice shared', disputed: '⚑ advice disputed' };
  function T(s) {
    return typeof tx === 'function' ? tx(s) : s;
  }
  function fill(s, v) {
    return String(s).replace(/\{(\w+)\}/g, function (_, k) {
      return v[k] == null ? '' : v[k];
    });
  }
  function when(ts) {
    if (!ts) return '';
    try {
      if (root.CBLocale) return root.CBLocale.datetime(ts);
    } catch (_) {
      /* CU4: the one date-time stamp; a locale fault falls through to the plain stamp below */
    }
    return String(ts).replace('T', ' ').slice(0, 16);
  }
  /** the chip a row paints for a state: "✉ advice sent · delivered" · "↗ advice shared · 04 Oct, 17:11" — '' when none */
  function stateWords(block) {
    if (!block || !block.state || !STATE_WORDS[block.state]) return '';
    var w = T(STATE_WORDS[block.state]);
    return block.state === 'shared' && block.shared_at ? w + ' · ' + when(block.shared_at) : w;
  }

  /* ── CSS, once, prefixed ra- (tokens with the page's fallbacks — e2e/token-guard) ── */
  var CSS =
    '.ra{display:flex;flex-direction:column;gap:6px;font-size:var(--fs-1,12px);color:var(--on-card,inherit)}' +
    '.ra-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}' +
    '.ra-b{border:1px solid var(--line,#DDD6C6);background:var(--card,#fff);border-radius:9px;font:inherit;font-size:var(--fs-1,12px);font-weight:700;padding:5px 10px;cursor:pointer;color:var(--blue,#1f5fa8);min-height:32px;text-decoration:none;display:inline-flex;align-items:center;gap:4px}' +
    '.ra-b.pri{background:var(--blue,#1f5fa8);color:var(--on-accent,#fff);border-color:var(--blue,#1f5fa8)}' +
    '.ra-b.off{opacity:.45;cursor:not-allowed;text-decoration:line-through}.ra-b[disabled]{opacity:.55;cursor:not-allowed}' +
    '.ra-why{color:var(--grey,#5E594D)}.ra-st{color:var(--grey,#5E594D);font-weight:700}' +
    '.ra-out{min-height:1em}.ra-out[data-tone=error]{color:var(--disp,#8E3517);font-weight:700}.ra-out[data-tone=ok]{color:var(--ok-2,#16693F);font-weight:700}';
  var cssDone = false;
  function addCss() {
    if (cssDone || !doc) return;
    cssDone = true;
    var node = doc.createElement('style');
    node.setAttribute('data-cbra', '1');
    node.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(node);
  }

  /* ── eligibility: the server's verdict, as handed ── */
  function may(panel, k) {
    var a = panel.a && panel.a.may;
    return (a && a[k]) || { ok: false, why: 'unknown', say: T(W.reading) };
  }

  /* ── the read ── */
  async function load(panel) {
    if (!ensureEP()) {
      panel.err = 'no EP';
      paint(panel);
      return;
    }
    panel.err = null;
    try {
      panel.a = await api('booksPayAdvice', { params: { id: panel.o.payment_id } });
    } catch (e) {
      panel.err = (e && e.message) || 'fail';
    }
    paint(panel);
  }

  /* ── paint ── */
  /** the Send button: always painted; greyed with the server's sentence when this login may not press it */
  function sendButtonHtml(panel, send) {
    return (
      '<button data-cbsid="SCR052-B01" type="button" class="ra-b pri' +
      (send.ok ? '' : ' off') +
      '" data-ra-act="send" data-testid="adv-send"' +
      (panel.failed ? ' data-action-state="failed"' : '') +
      (send.ok ? '' : ' aria-disabled="true" title="' + esc(send.say || '') + '"') +
      '>' +
      '✉ ' +
      esc(T(panel.failed ? (panel.sentChit ? W.recordAgain : W.again) : W.send)) +
      '</button>'
    );
  }
  /** the Share controls (copy · WhatsApp · e-mail), or one greyed Share button carrying the server's sentence */
  function shareLinksHtml(block, share) {
    if (share.ok && block.share)
      return (
        '<button data-cbsid="SCR052-B02" type="button" class="ra-b" data-ra-act="copy" data-testid="adv-copy">' +
        esc(T(W.copy)) +
        '</button>' +
        '<a class="ra-b" href="' +
        esc(block.share.wa) +
        '" target="_blank" rel="noopener" data-ra-act="shared" data-testid="adv-wa">' +
        esc(T(W.wa)) +
        '</a>' +
        '<a class="ra-b" href="' +
        esc(block.share.mailto) +
        '" data-ra-act="shared" data-testid="adv-mail">' +
        esc(T(W.mail)) +
        '</a>'
      );
    return (
      '<button data-cbsid="SCR052-B03" type="button" class="ra-b off" aria-disabled="true" data-testid="adv-share" title="' +
      esc(share.say || '') +
      '">↗ ' +
      esc(T(W.share)) +
      '</button>'
    );
  }
  /** paint the panel (or its reading / could-not-read line) into the host element */
  function paint(panel) {
    if (!panel.el || !panel.el.isConnected) return;
    var block = panel.a,
      opts = panel.o,
      id = esc(opts.payment_id);
    if (!block) {
      panel.el.innerHTML =
        '<div class="ra" data-testid="adv" data-payment="' +
        id +
        '"><span class="ra-why" data-testid="adv-' +
        (panel.err ? 'err' : 'reading') +
        '">' +
        esc(T(panel.err ? W.readFail : W.reading)) +
        '</span></div>';
      return;
    }
    var send = may(panel, 'send_advice'),
      share = may(panel, 'share_advice'),
      st = stateWords(block.advice);
    var sendBtn = sendButtonHtml(panel, send);
    var links = shareLinksHtml(block, share);
    /* ONE sentence on screen: the send refusal (off rail says "share the advice instead"; sent already; view-only…). A greyed Share carries its own sentence as its title. */
    var whys = !send.ok ? '<span class="ra-why" data-testid="adv-why-send">' + esc(send.say || '') + '</span>' : '';
    if (block.cost_hidden) whys += '<span class="ra-why" data-testid="adv-hidden">' + esc(T('Amounts hidden')) + '</span>'; /* ⭐ RAIL-146n: the advice names what the bills cost — the server hides it (may.*: cost_blind) and says so */
    panel.el.innerHTML =
      '<div class="ra" data-testid="adv" data-payment="' +
      id +
      '" data-state="' +
      esc((block.advice && block.advice.state) || 'none') +
      '">' +
      (st ? '<span class="ra-st" data-testid="adv-state">' + esc(st) + '</span>' : '') +
      '<div class="ra-row">' +
      sendBtn +
      '<span class="ra-row" data-testid="adv-share-row">' +
      links +
      '</span></div>' +
      whys +
      '<span class="ra-out" data-testid="adv-out" data-tone="' +
      esc(panel.tone || '') +
      '">' +
      esc(panel.outWords || '') +
      '</span></div>';
  }

  /* ── the writes ── */
  function emit(el, payment_id, result) {
    try {
      (el || doc).dispatchEvent(new CustomEvent('cb:rail', { bubbles: true, detail: { module: 'advice', payment_id: payment_id, result: result } }));
    } catch (_) {
      /* the repaint event is a courtesy to the host; a host that throws must not break the press */
    }
  }
  function needAction() {
    if (typeof CBAction === 'undefined' || !CBAction || typeof CBAction.run !== 'function')
      throw new Error('CBAdvice needs CBAction (app/accounts-shell.js) on the page — every press goes through the action-state helper');
  }
  function out(panel) {
    return panel.el.querySelector('[data-testid="adv-out"]');
  }
  function say(panel, words, tone) {
    panel.outWords = words;
    panel.tone = tone;
    var node = out(panel);
    if (node) {
      node.textContent = words;
      node.setAttribute('data-tone', tone);
    }
  }
  function settle(panel, result, words, tone) {
    panel.a = Object.assign({}, panel.a, {
      advice: Object.assign({}, panel.a && panel.a.advice, result),
      body: null,
      may: Object.assign({}, panel.a && panel.a.may, { send_advice: { ok: false, why: 'already_sent', say: T('An advice is already sent for this payment.') } })
    });
    if (result.state === 'shared') panel.a.may = Object.assign({}, panel.a.may, { send_advice: (panel.a.may && panel.a.may.send_advice) || { ok: false } });
    panel.outWords = words;
    panel.tone = tone;
    paint(panel);
    emit(panel.el, panel.o.payment_id, result);
    if (typeof panel.o.onDone === 'function') {
      try {
        panel.o.onDone(result, panel.o);
      } catch (_) {
        /* the host's onDone is its own business; the advice is already settled */
      }
    }
  }
  /** the ONE send of a rail body this page did not compose (the server's advice; the bank-recon engine's question, BR1) — POST /api/chits/send,
    the server's sendChit mints it. → the chit id, or null. The chit sheet's own sends stay in app.html sendChit. */
  async function sendBody(body) {
    ensureEP();
    var sent = await api('createChit', { body: body });
    return (sent && (sent.chit_id || (sent.chit && sent.chit.chit_id))) || null;
  }
  /** a failed send: say why under the buttons and keep Send as "Send again" (or "Save again" once the chit itself went) */
  function sendFailed(panel, party, words, fault) {
    panel.failed = true;
    if (panel.sentChit) words = fill(T(W.notRecorded), { party: party }); /* the advice WENT; only the record failed */
    /* a 4xx carries the server's own refusal (its words are for people); a 5xx / a network fault keeps the unit's sentence — never a server message */
    var data = fault && fault.data,
      shown = fault && fault.status >= 400 && fault.status < 500 && data && data.message ? data.message : words;
    if (data && data.why && panel.a && panel.a.may) panel.a.may.send_advice = { ok: false, why: data.why, say: shown };
    panel.outWords = shown;
    panel.tone = 'error';
    paint(panel);
  }
  /** Send: the chit (the server's ready body) then the merge-patch — one press, one outcome; a failed send keeps the button as "Send again" */
  function sendPress(panel, btn) {
    needAction();
    ensureEP();
    var block = panel.a,
      verdict = may(panel, 'send_advice');
    if (!verdict.ok) {
      say(panel, verdict.say || '', 'error');
      return Promise.resolve({ ok: false });
    }
    var party = (block.party && block.party.name) || panel.o.party || T('the other party');
    return CBAction.run(
      btn,
      async function () {
        /* M30-2: once the chit is SENT, a failed RECORD is retried with the SAME chit - never a second advice to the party */
        var chit_id = panel.sentChit;
        if (!chit_id) {
          chit_id = await sendBody(block.body);
          if (!chit_id) throw new Error('no chit id');
          panel.sentChit = chit_id;
        }
        var reply = await api('booksPayPatch', { params: { id: panel.o.payment_id }, body: { advice_chit_id: chit_id } });
        return Object.assign({ chit_id: chit_id }, (reply && reply.advice) || { state: 'sent', shared_at: null });
      },
      {
        key: 'adv:' + panel.o.payment_id,
        busy: T(W.sending),
        out: out(panel),
        failed: T(W.notSent),
        outcome: function (res) {
          panel.failed = false;
          settle(panel, { chit_id: res.chit_id, state: res.state || 'sent', shared_at: res.shared_at || null }, fill(T(W.sent), { party: party }), 'ok');
        },
        onFail: function (words, e) {
          sendFailed(panel, party, words, e);
        }
      }
    );
  }
  /** put the advice words on the clipboard; best effort, the share record goes ahead either way */
  function copyText(text) {
    try {
      if (root.navigator && root.navigator.clipboard)
        root.navigator.clipboard.writeText(text).catch(function () {
          /* copy is best effort: the share link and the record still go ahead */
        });
    } catch (_) {
      /* no clipboard on this page: the same best-effort rule */
    }
  }
  /** Share: the words left this page (copy · WhatsApp · e-mail) → the payment remembers when */
  function sharePress(panel, btn, how) {
    needAction();
    ensureEP();
    var block = panel.a,
      verdict = may(panel, 'share_advice');
    if (!verdict.ok) {
      say(panel, verdict.say || '', 'error');
      return Promise.resolve({ ok: false });
    }
    var party = (block.party && block.party.name) || panel.o.party || T('the other party');
    if (how === 'copy') copyText(block.share.text);
    return CBAction.run(
      how === 'copy' ? btn : null,
      async function () {
        var reply = await api('booksPayPatch', { params: { id: panel.o.payment_id }, body: { advice_shared_at: true } });
        return (reply && reply.advice) || { chit_id: null, state: 'shared', shared_at: new Date().toISOString() };
      },
      {
        key: 'adv-share:' + panel.o.payment_id,
        out: out(panel),
        failed: T(W.notSent),
        outcome: function (res) {
          settle(
            panel,
            { chit_id: res.chit_id || null, state: res.state || 'shared', shared_at: res.shared_at || null },
            how === 'copy' ? fill(T(W.copied), { party: party }) : T(W.shared),
            'ok'
          );
        },
        onFail: function (words, e) {
          var d = e && e.data;
          say(panel, e && e.status >= 400 && e.status < 500 && d && d.message ? d.message : words, 'error');
        }
      }
    );
  }

  /* ── mount ── */
  /** the one click listener of a mounted panel: Send, Copy, or a WhatsApp / e-mail link (the link opens; the patch rides beside it) */
  function clickHandler(panel) {
    return function onClick(event) {
      var node = event.target.closest ? event.target.closest('[data-ra-act]') : null;
      if (!node || !panel.el.contains(node)) return;
      var act = node.getAttribute('data-ra-act');
      if (act === 'send') {
        event.preventDefault();
        if (node.classList.contains('off')) {
          say(panel, may(panel, 'send_advice').say || '', 'error');
          return;
        }
        sendPress(panel, node);
        return;
      }
      if (act === 'copy') {
        event.preventDefault();
        sharePress(panel, node, 'copy');
        return;
      }
      if (act === 'shared') sharePress(panel, node, node.getAttribute('data-testid') === 'adv-wa' ? 'wa' : 'mail');
    };
  }
  /** mount the advice panel into `el` (an element or id); returns { refresh, destroy, state, el }, or null without a payment_id */
  function mount(el, opts) {
    el = typeof el === 'string' ? doc.getElementById(el) : el;
    if (!el || !opts || !opts.payment_id) return null;
    addCss();
    ensureEP();
    if (el.__cbadvice) el.__cbadvice.api.destroy();
    var panel = { el: el, o: opts, a: opts.advice || null, err: null, failed: false, outWords: '', tone: '' };
    var onClick = clickHandler(panel);
    el.addEventListener('click', onClick);
    var api_ = {
      el: el,
      refresh: function () {
        return load(panel);
      },
      destroy: function () {
        el.removeEventListener('click', onClick);
        el.__cbadvice = null;
      },
      state: function () {
        return { advice: panel.a && panel.a.advice, may: panel.a && panel.a.may, words: panel.a && panel.a.words, failed: panel.failed };
      }
    };
    panel.api = api_;
    el.__cbadvice = panel;
    if (panel.a) paint(panel);
    else {
      paint(panel);
      load(panel);
    }
    return api_;
  }

  var CBAdvice = { mount: mount, sendBody: sendBody, stateWords: stateWords, STATE_WORDS: STATE_WORDS, EP: CB_ADVICE_EP, WORDS: W };
  root.CBAdvice = CBAdvice;
})(typeof globalThis !== 'undefined' ? globalThis : this);
