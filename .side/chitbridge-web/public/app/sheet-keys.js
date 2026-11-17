/**
 * sheet-keys.js - THE KEYBOARD OF A SHEET. A page that draws its sheets into a host element (shop.html: #ohost for the order, "My orders",
 * Privacy; #suphost for "Report a problem") gets, from one call per host, what a native <dialog> gives for free: Escape closes it, Tab stays
 * inside it, focus moves into it when it opens and goes back to the control that opened it when it closes.
 *
 * OWNS      CBSheetKeys.watch(host, { close, label }) -> { stop } - the host's open/close is read from its content (empty = closed), so the
 *           page's own draw functions (host.innerHTML = ...) need no change; the panel gets role=dialog, aria-modal and a name.
 *           Pairs with CBSteps.backdropTap (step-flow.js): the backdrop is the pointer's way out, this is the keyboard's.
 * CALLED BY shop.html (ohost, supHost); any page with a host-drawn sheet
 * FLOW      UX-6 (12 Nov 2026): the shop's sheets were div+onclick, so a keyboard could not leave them. CBConfirm (accounts-shell) is a
 *           native <dialog> with its own Escape and focus handling: while it is open this module stands aside.
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 */
(function (root) {
  'use strict';
  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

  /** the control that last had the focus on this page, tracked from load so a sheet opened by the very first key still knows its opener */
  var lastFocus = null;
  if (typeof document !== 'undefined')
    document.addEventListener(
      'focusin',
      function (event) {
        if (event.target !== document.body) lastFocus = event.target;
      },
      true
    );

  /** the panel inside the host's backdrop (the backdrop is the host's first child, the panel its first child) */
  function panelOf(host) {
    var backdrop = host.firstElementChild;
    return backdrop ? backdrop.firstElementChild || backdrop : null;
  }
  /** the controls a Tab can reach inside the panel, in page order */
  function reachable(panel) {
    return Array.prototype.filter.call(panel.querySelectorAll(FOCUSABLE), function (node) {
      return node.getClientRects().length > 0;
    });
  }
  /** the panel is a dialog for a screen reader: named from its first bold line, or the page's label */
  function describe(panel, label) {
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    var title = panel.querySelector('b');
    panel.setAttribute('aria-label', (title && title.textContent.trim()) || label || 'Dialog');
    if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1');
  }
  /** a native confirm (CBConfirm) on top has its own Escape and focus: stand aside */
  function confirmIsOpen() {
    return !!document.getElementById('cb_confirm');
  }
  /** Tab and Shift+Tab wrap inside the panel; a Tab from outside lands on its first (or last) control */
  function trapTab(event, panel) {
    var items = reachable(panel);
    if (!items.length) {
      event.preventDefault();
      panel.focus();
      return;
    }
    var first = items[0],
      last = items[items.length - 1],
      active = document.activeElement,
      inside = panel.contains(active);
    if (!inside) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && (active === first || active === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }
  /** Escape closes, Tab is trapped; a native confirm on top answers its own keys */
  function answerKey(event, panel, close) {
    if (confirmIsOpen()) return;
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') trapTab(event, panel);
  }
  /** the sheets that are open, bottom to top: a key belongs to the top one only (Escape closes one sheet, not two) */
  var openSheets = [];
  /** a draw replaced the box the person was typing in: put the focus back on the box with the same id (caret at its end) */
  function sameBox(panel) {
    var id = lastFocus && lastFocus.id;
    var box = id ? panel.querySelector('[id="' + String(id).replace(/"/g, '') + '"]') : null;
    if (!box) return null;
    box.focus();
    if (typeof box.selectionStart === 'number') box.setSelectionRange(box.value.length, box.value.length);
    return box;
  }
  /** focus has LEFT the panel (a draw replaced what had it, or it sits behind): bring it back; focus still inside is never touched, so typing is not interrupted */
  function keepFocusInside(panel) {
    if (panel.contains(document.activeElement) || confirmIsOpen()) return;
    if (!sameBox(panel)) (reachable(panel)[0] || panel).focus();
  }
  /** the control that had the focus is still in the panel: the focus is only MID-MOVE (during focusout activeElement is briefly body), not lost */
  function focusIsMoving(panel) {
    return !!lastFocus && lastFocus.isConnected && panel.contains(lastFocus);
  }
  /** a change in the sheet: when the focus is mid-move, look again next task, once the move has landed (a Tab out of a box whose focusout writes an echo or an error is a change too); a draw that REMOVED the focused control is answered at once */
  function checkFocus(panel) {
    if (!focusIsMoving(panel)) return keepFocusInside(panel);
    setTimeout(function () {
      if (panel.isConnected) keepFocusInside(panel);
    }, 0);
  }
  /** watch one host: see the file header */
  function watch(host, options) {
    var state = { open: false, opener: null };
    /** the host's content went from empty to a sheet: remember who opened it */
    function opened() {
      state.open = true;
      openSheets.push(state);
      state.opener = lastFocus && !host.contains(lastFocus) ? lastFocus : null;
    }
    /** the sheet went away: the focus goes back to its opener, when that control is still on the page */
    function closed() {
      state.open = false;
      openSheets.splice(openSheets.indexOf(state), 1);
      if (state.opener && state.opener.isConnected && state.opener.focus) state.opener.focus();
      state.opener = null;
    }
    function onChange() {
      var panel = panelOf(host);
      if (!panel) return state.open ? closed() : undefined;
      if (!state.open) opened();
      describe(panel, options.label);
      if (openSheets[openSheets.length - 1] === state) checkFocus(panel);
    }
    function onKey(event) {
      var panel = state.open && openSheets[openSheets.length - 1] === state ? panelOf(host) : null;
      if (panel) answerKey(event, panel, options.close);
    }
    var observer = new MutationObserver(onChange);
    observer.observe(host, { childList: true, subtree: true });
    document.addEventListener('keydown', onKey);
    return {
      stop: function () {
        observer.disconnect();
        document.removeEventListener('keydown', onKey);
      }
    };
  }
  root.CBSheetKeys = { watch: watch };
})(typeof window !== 'undefined' ? window : this);
