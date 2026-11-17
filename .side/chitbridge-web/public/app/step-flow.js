/**
 * step-flow.js — THE step flow. One implementation, used by every screen that composes an order in steps.
 * OWNS      CBSteps: the one step flow (rail, guard-with-a-reason, footer Back / Save draft / Next or Send, focus), its three footer buttons SCR039-B01..B03
 * CALLED BY  5 pages by <script src> (grep -lE 'src="/?app/step-flow.js' public/*.html): accounts, app, crm, finance, shop. CBSteps.create is called in app.html (3 sites),
 *            shop.html (1) and five screens' own scripts: Compare, CRM leads import, Move in, Network member, Repeat (grep -n 'CBSteps\.create' public)
 * FLOW       a screen supplies its steps, what each renders, what blocks each and what send means → create() → paint rail + body + foot → back / next / send / draft
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/step-flow
 *
 * Athi, 2026-08-08: *"we do not want the left half, we are going to show just the product list and the cart, nothing
 * else, once all the selection is over, then we show the rest in order one by one."*
 *
 * The four design mocks — cart-design, supplier-design, network-design, storefront-design — each drew their own
 * rail, their own go(), their own blockedBecause() and their own paintFoot(). They were drawn on different days and
 * they had already drifted: three render a chip as "✓ Items", the fourth renders a numbered badge; two label the
 * primary button "Check out →", one "Next: To →". None of that is a decision anybody made.
 *
 * That is the same shape as the divergence cart-ui.js exists to end — *the walk was shared and the render was
 * copied*. So the wizard is shared too, and a screen supplies only what is genuinely its own:
 *
 *     the STEPS it has · what each step RENDERS · what BLOCKS each step · what SEND means
 *
 * ── WHAT THIS OWNS ───────────────────────────────────────────────────────────────────────────────────────────────
 * The rail, navigation, the guard, and the footer. Nothing else. It does not know about carts, catalogues,
 * recipients or OTPs — a screen renders its own step bodies and hands back HTML.
 *
 * ── ⚠️ THE GUARD IS A REASON, NEVER A BOOLEAN ────────────────────────────────────────────────────────────────────
 * `guard(stepKey)` returns a STRING saying what is missing, or null. A disabled button with no explanation is the
 * commonest way a form becomes unusable: the customer can see it is dead and cannot see why. The reason goes on the
 * button's title and is available to the screen, so it can also be said in place.
 *
 * ── ⚠️ THE STEPS ARE NOT ALL THE SAME EVERYWHERE, AND THAT IS THE POINT ──────────────────────────────────────────
 *   Suppliers · Network   Items → Details → Review              (3 — the counterparty IS the recipient)
 *   Compose               Items → To → Details → Review         (4 — the recipient is genuinely unknown)
 *   Storefront            Items → Delivery → Review → Who you are  (4 — identity is established LAST, on purpose)
 * A screen declares its own list. This file never hardcodes one.
 */
(function (root) {
  'use strict';

  var F = {}; // ns -> flow state
  var count = 0;

  function doc(id) {
    return typeof document !== 'undefined' && id ? document.getElementById(id) : null;
  }
  function opt(s, k, dflt) {
    var v = s && s.o && s.o[k];
    return v === undefined ? dflt : v;
  }
  function call(s, k, arg, dflt) {
    var f = s && s.o && s.o[k];
    if (typeof f === 'function') {
      try {
        return f(arg);
      } catch (e) {
        return dflt;
      }
    }
    return f === undefined ? dflt : f;
  }

  function stepAt(s, i) {
    return (s.steps && s.steps[i]) || {};
  }
  function keyAt(s, i) {
    return stepAt(s, i).k || String(i);
  }

  /**
   * The guard for a step. The LAST step re-asks every earlier one, because Review is where a person commits and
   * "you cannot send" must name the first thing actually missing — not merely the thing missing here.
   */
  function why(s, i) {
    if (i == null) i = s.i;
    var r = call(s, 'guard', keyAt(s, i), null);
    if (r) return r;
    if (i === s.steps.length - 1) {
      for (var index = 0; index < s.steps.length - 1; index++) {
        var e = call(s, 'guard', keyAt(s, index), null);
        if (e) return e;
      }
    }
    return null;
  }

  /**
   * ⚠️ YOU CANNOT SKIP FORWARD PAST SOMETHING UNANSWERED. Clicking a done chip goes back freely — that is how you
   * correct a mistake — but every step between here and a forward target must be satisfied, or the rail becomes a
   * way of walking around the guard the footer enforces.
   */
  function canReach(s, i) {
    if (i <= s.i) return true;
    for (var j = s.i; j < i; j++) if (call(s, 'guard', keyAt(s, j), null)) return false;
    return true;
  }

  /**
   * ⚠️ FOCUS FOLLOWS THE STEP. Pressing Next re-renders the footer, which destroys the button that had focus — so
   * the browser drops focus back to <body> and a keyboard user is returned to the TOP OF THE DOCUMENT. They then
   * have to Tab through the entire app shell to reach the first field of the step they just asked for. Caught by
   * KBD-01, which could not reach `chit-add-self` in forty presses.
   *
   * A wizard that costs a keyboard user forty keystrokes per step is worse than the single screen it replaced.
   * Athi's rule stands: a mouse-only control is a broken control.
   *
   * Called AFTER onStep, because a screen's onStep may rebuild the body (Suppliers and Network both repaint the
   * whole pane) and would otherwise undo this.
   */
  function focusFirst(ns) {
    var s = F[ns];
    if (!s || typeof document === 'undefined') return;
    var node = doc(opt(s, 'bodyEl'));
    if (!node) return;
    var el = node.querySelector(
      'input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]),[tabindex]:not([tabindex="-1"])'
    );
    if (el && typeof el.focus === 'function') {
      try {
        el.focus({ preventScroll: false });
      } catch (e) {}
    }
  }
  function go(ns, i) {
    var s = F[ns];
    if (!s) return;
    if (i < 0 || i >= s.steps.length) return;
    if (!canReach(s, i)) return;
    /**
     * ⭐⭐ onLeave(stepKey) — THE STEP GETS TO KEEP WHAT THE READER DID BEFORE THE SCREEN CHANGES.
     *
     * Athi, 2026-09-02: *"i clicked two items, but the chit came out with zero item, i understood, it asks add
     * these items again."*
     *
     * ⚠️ A CART ACCUMULATES AND A CHECKOUT COMMITS, and on a step you can simply walk away from, that second
     * press is a trap: the reader has said what they want by ticking it, and the only thing standing between
     * their intent and the record is a button they had no reason to expect. Ticking IS the answer to "what are
     * you sending?" — so the step commits its own selection on the way out.
     *
     * ⚠️ ON A DELIBERATE MOVE ONLY, and never when the index has not changed: paint() and paintFoot() run
     * constantly, and committing on every repaint would double lines as fast as the screen redraws.
     */
    if (s.i !== i) call(s, 'onLeave', keyAt(s, s.i));
    s.i = i;
    s.tried = false;
    var b = doc(opt(s, 'bodyEl'));
    if (b) b.scrollTop = 0; // a new step starts at its own top, never mid-scroll of the last one
    paint(ns);
    call(s, 'onStep', keyAt(s, i));
    // ⚠️ Only on a deliberate MOVE, never on the initial paint or a footer refresh — stealing focus from someone
    // mid-sentence is its own bug.
    focusFirst(ns);
  }
  /**
   * ⭐ `quiet` (opt-in, 2026-10-10 — the online shop, M70): a screen that asks a stranger for things must not say "needed" before they have
   * typed or pressed anything. With `quiet: true` the button is live and the reason stays unsaid until the first press that finds the step
   * unanswered; from then on it shows (and clears itself as the field is filled). Moving to another step starts quiet again.
   */
  function refuse(s, ns, w) {
    if (w && opt(s, 'quiet', false) && !s.tried) {
      s.tried = true;
      paintFoot(ns);
    }
    return !!w;
  }
  function next(ns) {
    var s = F[ns];
    if (s && !refuse(s, ns, why(s, s.i))) go(ns, s.i + 1);
  }
  function back(ns) {
    var s = F[ns];
    if (s) {
      if (s.i > 0) go(ns, s.i - 1);
      else call(s, 'onCancel');
    }
  }
  function send(ns) {
    var s = F[ns];
    if (s && !refuse(s, ns, why(s, s.i))) call(s, 'onSend');
  }
  function draft(ns) {
    var s = F[ns];
    if (s) call(s, 'onDraft');
  }

  /* the attributes of a rail step a person may go back to: the click, and a button role with a tab stop; Enter and Space are pressed by app/kbd-press.js (every page that loads this file loads that one first) */
  function stepPress(flowKey, index) {
    return ' onclick="CBSteps.go(\'' + esc(flowKey) + "'," + index + ')" style="cursor:pointer" role="button" tabindex="0"';
  }

  /* ── the rail ────────────────────────────────────────────────────────────────────────────────────────────── */
  /**
   * ONE rail shape, with the numbered badge the compose mock drew. The other three mocks showed a bare "✓ Items";
   * the number is a superset — it says how far along you are and how far is left, which a tick alone cannot — so
   * standardising on it loses nothing and ends a difference nobody chose.
   */
  function railHTML(ns) {
    var s = F[ns];
    if (!s) return '';
    return (
      '<div class="cbst-rail" data-testid="steps-' +
      esc(ns) +
      '">' +
      s.steps
        .map(function (item, index) {
          var done = index < s.i,
            now = index === s.i;
          var cls = 'cbst' + (now ? ' now' : done ? ' done' : '');
          var clickable = index !== s.i && canReach(s, index);
          return (
            '<div class="' +
            cls +
            '" data-testid="step-' +
            esc(item.k || index) +
            '"' +
            (clickable ? stepPress(ns, index) : '') +
            '><span class="n">' +
            (done ? '✓' : index + 1) +
            '</span>' +
            esc(item.n || item.k || '') +
            '</div>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  /* ── the footer ──────────────────────────────────────────────────────────────────────────────────────────── */
  /**
   * ⚠️ THE PRIMARY BUTTON SAYS WHAT IT WILL DO NEXT, by name. "Next" alone makes someone click to find out where
   * they are going; "Next: Details →" is the same click with the answer already given.
   */
  function nextLabel(s) {
    var last = s.i === s.steps.length - 1;
    if (last) return call(s, 'sendLabel', null, 'Send');
    var custom = call(s, 'nextLabel', keyAt(s, s.i), null);
    return custom || 'Next: ' + (stepAt(s, s.i + 1).n || '') + ' →';
  }
  /**
   * ⚠️ A SCREEN MAY OWN ITS BUTTON'S TEST ID, and Compose does. `chit-send` is addressed by four specs and by the
   * shared composeSelfChit fixture; renaming it to `step-next-cbsteps-2` because the wizard now draws the button
   * would remove a published hook and leave every one of them hunting for an element that no longer exists. That
   * is defect 3 of 2026-08-09, repeated. So the generated ids are DEFAULTS, not decisions.
   */
  function footHTML(ns) {
    var s = F[ns];
    if (!s) return '';
    var last = s.i === s.steps.length - 1,
      blocked = why(s, s.i);
    if (blocked && opt(s, 'quiet', false) && !s.tried) blocked = null; // quiet until the first try — the guard still refuses on press
    var iconBack = opt(s, 'iconBack', false); // I1: opt-in — ← alone, the word rides on aria-label + title
    var backLbl = s.i ? (iconBack ? '←' : '← Back') : opt(s, 'cancelLabel', '');
    var tidBack = opt(s, 'backTestid', 'step-back-' + ns);
    var tidDraft = opt(s, 'draftTestid', 'step-draft-' + ns);
    // The primary changes JOB on the last step, so it may change NAME too: "next" and "send" are different actions.
    var tidPri = last ? opt(s, 'sendTestid', 'step-next-' + ns) : opt(s, 'nextTestid', 'step-next-' + ns);
    var out = '<div class="cbst-foot" data-testid="stepfoot-' + esc(ns) + '">';
    if (backLbl) {
      out +=
        '<button data-cbsid="SCR039-B01" type="button" data-testid="' +
        esc(tidBack) +
        '"' +
        (iconBack && s.i ? ' data-ic="back" aria-label="Back" title="Back"' : '') +
        ' onclick="CBSteps.back(\'' +
        esc(ns) +
        '\')">' +
        esc(backLbl) +
        '</button>';
    }
    if (opt(s, 'draftLabel')) {
      out +=
        '<button data-cbsid="SCR039-B02" type="button" data-testid="' +
        esc(tidDraft) +
        '"' +
        ' onclick="CBSteps.draft(\'' +
        esc(ns) +
        '\')">' +
        esc(opt(s, 'draftLabel')) +
        '</button>';
    }
    // ⚠️ The reason rides on `title`. A dead button that will not say why is the thing this guard exists to avoid.
    out +=
      '<button data-cbsid="SCR039-B03" type="button" class="pri" data-testid="' +
      esc(tidPri) +
      '"' +
      (blocked ? ' disabled title="' + esc(blocked) + '"' : '') +
      ' onclick="CBSteps.' +
      (last ? 'send' : 'next') +
      "('" +
      esc(ns) +
      '\')">' +
      esc(nextLabel(s)) +
      '</button>';
    // …and it is said in words too, because a title only appears if you hover, and nobody hovers on a phone.
    if (blocked) out += '<span class="cbst-why" data-testid="step-why-' + esc(ns) + '">' + esc(blocked) + '</span>';
    return out + '</div>';
  }

  function bodyHTML(ns) {
    var s = F[ns];
    if (!s) return '';
    return call(s, 'render', keyAt(s, s.i), '') || '';
  }

  /* ── painting. Each piece paints on its own, so a footer refresh cannot disturb the step body. ───────────── */
  function paintRail(ns) {
    var el = doc(opt(F[ns], 'railEl'));
    if (el) el.innerHTML = railHTML(ns);
  }
  function paintFoot(ns) {
    var el = doc(opt(F[ns], 'footEl'));
    if (el) el.innerHTML = footHTML(ns);
  }
  function paintBody(ns) {
    var el = doc(opt(F[ns], 'bodyEl'));
    if (el) el.innerHTML = bodyHTML(ns);
  }
  /**
   * ⚠️ paintFoot IS THE ONE TO CALL WHEN THE CART CHANGES, not paint(). Adding a line unblocks "Next", and that is
   * the whole of what changed — repainting the body would rebuild the catalogue list under the cursor and throw
   * away the search someone had typed. The cart paints its own list and bar; the flow paints its own footer.
   */
  function paint(ns) {
    var s = F[ns];
    if (!s) return;
    paintRail(ns);
    paintBody(ns);
    paintFoot(ns);
    var node = doc(opt(s, 'subEl'));
    if (node) node.textContent = stepAt(s, s.i).t || '';
  }

  function create(cfg) {
    var ns = 'cbsteps-' + ++count;
    var o = cfg || {};
    F[ns] = { o: o, steps: (o.steps || []).slice(), i: 0 };
    var h = {
      ns: ns,
      /* reading */
      index: function () {
        return F[ns] ? F[ns].i : 0;
      },
      step: function () {
        return F[ns] ? keyAt(F[ns], F[ns].i) : null;
      },
      steps: function () {
        return F[ns] ? F[ns].steps.slice() : [];
      },
      isLast: function () {
        return F[ns] ? F[ns].i === F[ns].steps.length - 1 : false;
      },
      /** Why the current step (or a named one) cannot be left — a sentence, or null. */
      blockedBecause: function (i) {
        return F[ns] ? why(F[ns], i) : null;
      },
      canReach: function (i) {
        return F[ns] ? canReach(F[ns], i) : false;
      },
      /* moving */
      go: function (i) {
        go(ns, i);
        return h;
      },
      next: function () {
        next(ns);
        return h;
      },
      back: function () {
        back(ns);
        return h;
      },
      /** Back to step one with nothing answered — a new supplier, a new chit, a fresh start. */
      reset: function () {
        if (F[ns]) F[ns].i = 0;
        return h;
      },
      /* rendering */
      railHTML: function () {
        return railHTML(ns);
      },
      footHTML: function () {
        return footHTML(ns);
      },
      bodyHTML: function () {
        return bodyHTML(ns);
      },
      paint: function () {
        paint(ns);
        return h;
      },
      paintFoot: function () {
        paintFoot(ns);
        return h;
      },
      paintBody: function () {
        paintBody(ns);
        return h;
      },
      destroy: function () {
        delete F[ns];
      }
    };
    return h;
  }

  /* The CSS the rail and footer need. Injected once, so no screen has to carry a copy — the same reasoning as the
     cart's popup host: a shared component that makes each caller supply its own styling is not shared. */
  function ensureCSS() {
    if (typeof document === 'undefined' || document.getElementById('cbst_css')) return;
    var node = document.createElement('style');
    node.id = 'cbst_css';
    /* ⚠️ THE ACCENT IS A TOKEN, not a constant. The storefront is a PUBLIC page in the shop's own colours — a blue
       rail on a red shop is the same mistake as sharing a stylesheet instead of the rules. Any host can set
       `--cbst-accent` (and `--cbst-soft`) on a container; everything else stays shared. */
    node.textContent =
      '.cbst-rail{display:flex;gap:6px;padding:11px 0 10px;flex-wrap:wrap}' +
      '.cbst{display:flex;align-items:center;gap:7px;padding:5px 11px;border-radius:20px;font-size:var(--fs-2);' +
      'white-space:nowrap;border:1px solid #e3e6ea;background:var(--card);color:var(--grey-2)}' +
      '.cbst .n{width:18px;height:18px;border-radius:50%;background:rgba(0,0,0,.08);display:inline-flex;' +
      'align-items:center;justify-content:center;font-size:var(--fs-1);font-weight:800;flex:none}' +
      '.cbst.done{border-color:#cfe0d6;background:var(--cbst-soft,var(--ok-tint));color:var(--cbst-accent,var(--ok-2))}' +
      '.cbst.now{border-color:var(--cbst-accent,var(--blue));background:var(--cbst-accent,var(--blue));color:var(--on-accent,#fff);font-weight:700}' +
      '.cbst.now .n{background:rgba(255,255,255,.24)}' +
      /**
       * ⚠️ `width:100%` — WITHOUT IT THE FOOTER COLLAPSES AND THE LABELS WRAP. This div is itself a flex ITEM of
       * the modal's `.mfoot`, and a flex item defaults to `flex:0 1 auto` — so it shrank to its content, 254px
       * inside an 820px footer. The buttons then inherited `flex:1 1 0` from `.modal .mfoot button` and split
       * THAT, giving three 78px buttons whose labels broke onto two lines: a 35px "Cancel" beside a 52px
       * "Next: To →". Measured on 2026-08-15, not guessed.
       *
       * `nowrap` on the buttons is the second half: a footer button's label is the name of an action, and an
       * action whose name breaks mid-phrase reads as a rendering fault even when the layout is otherwise fine.
       */
      '.cbst-foot{display:flex;gap:10px;align-items:center;flex-wrap:wrap;width:100%}' +
      '.cbst-foot button{white-space:nowrap}' +
      '.cbst-foot button{border-radius:9px;padding:11px 16px;font-size:var(--fs-3);font-weight:700;cursor:pointer;' +
      'border:1px solid #e3e6ea;background:var(--card)}' +
      '.cbst-foot button.pri{flex:1;background:var(--cbst-accent,var(--blue));color:#fff;border-color:var(--cbst-accent,var(--blue))}' +
      '.cbst-foot button:disabled{opacity:.45;cursor:not-allowed}' +
      '.cbst-why{flex-basis:100%;font-size:var(--fs-1);color:var(--warn-2)}';
    (document.head || document.documentElement).appendChild(node);
  }
  var _create = create;
  create = function (cfg) {
    ensureCSS();
    return _create(cfg);
  };

  /**
   * ⭐ backdropTap(ev, backdrop) — a backdrop closes its panel ONLY for a tap that STARTED on the backdrop (M184).
   * A repaint can replace the node under the finger between press and release, and the browser then reports the click on an
   * ancestor — or the panel resizes and the next tap lands outside it. Neither is the reader asking to leave.
   */
  var _down = null;
  if (typeof document !== 'undefined' && document.addEventListener) {
    ['pointerdown', 'mousedown', 'touchstart'].forEach(function (item) {
      document.addEventListener(
        item,
        function (e) {
          _down = e.target;
        },
        true
      );
    });
  }
  function backdropTap(ev, backdrop) {
    return !!ev && ev.target === backdrop && _down === backdrop;
  }
  function _setDown(t) {
    _down = t;
  }

  root.CBSteps = {
    create: create,
    backdropTap: backdropTap,
    _setDown: _setDown,
    go: go,
    next: next,
    back: back,
    send: send,
    draft: draft,
    railHTML: railHTML,
    footHTML: footHTML,
    bodyHTML: bodyHTML,
    paint: paint,
    paintFoot: paintFoot,
    paintBody: paintBody
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.CBSteps;
})(typeof window !== 'undefined' ? window : globalThis);
