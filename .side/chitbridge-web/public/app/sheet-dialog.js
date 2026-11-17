/**
 * sheet-dialog.js - THE KEYBOARD CONTRACT OF A NATIVE <dialog class="sheet"> (WAI-ARIA APG modal dialog + our keyboard rules 1b 2c 4 5 8).
 * The small apps (Catalogue, CRM, Employees, Finance, Tasks) each draw their sheet into a native <dialog class="sheet"> and open it with showModal(). The browser already
 * gives Escape, a Tab that stays inside and a focus return; this adds what it does not: a first focus on a field, a focus return that survives a repaint, Enter that saves,
 * a save with a missing field that says which one, and Esc that asks before it throws away what was typed. One document-level listener set, so a page needs no code of its own.
 *
 * OWNER     cb-ux-locale
 * RISK      plain
 * OWNS      1b  a sheet opens with the focus on [autofocus], else its first field, else its first action - never the corner Close (X).
 *           2c  a sheet closes with the focus back on the control that opened it (looked up again by id or code when a repaint replaced it).
 *           4   Enter in a one-line field presses the sheet's save button: the button marked data-sheet-save (a textarea keeps its Enter; a <form> keeps its own).
 *           5   the save button (data-sheet-save) with a [required] field empty does not run: the focus goes to the first empty field, marked aria-invalid, with its sentence
 *               in the line under it (aria-describedby) through ui.field.error; the sentence is the field's data-required-msg, else "Required".
 *           8   Escape on a sheet whose fields moved from what was painted asks "Unsaved changes ... Discard / Stay" (CBConfirm; CBUnsaved.domDirty is the test); no moved field, no question.
 * CALLED BY catalogue.html, crm.html, employees.html, finance.html, tasks.html (one script tag, after accounts-shell.js and ui-field.js). A sheet with no data-sheet-save and no [required] gets 1b 2c 8 only.
 * FLOW      UX-6 (14 Nov 2026), docs PM/PROOF-RUNS/sit-grund-2026-11-14/FAILS.md. Pairs with sheet-keys.js (the same contract for a sheet drawn into a host div, shop.html).
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;
  var SHEET = 'dialog.sheet';
  var FIELD = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=file]):not([type=range]):not([type=color]),textarea,select';
  var ACTION = 'button:not([disabled]),a[href],input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  var CLOSE_WORDS = /close|✕|×/i;
  var ONE_LINE = /^(text|search|email|tel|url|number|password)$/i;
  var opener = null;
  var repaintWatch = null;
  var confirmed = false;

  /** the words the page gave for this control, so it can be found again after a repaint */
  function describe(node) {
    return { node: node, id: node.id || '', code: node.getAttribute('data-cbsid') || '' };
  }
  /** is this node really on screen (a hidden or collapsed control is no target) */
  function shown(node) {
    return !!node && node.isConnected && node.getClientRects().length > 0;
  }
  /** the opener, or what replaced it: the same id, else the first control with the same register code */
  function findOpener(saved) {
    if (!saved) return null;
    if (shown(saved.node)) return saved.node;
    var byId = saved.id ? document.getElementById(saved.id) : null;
    if (shown(byId)) return byId;
    var byCode = saved.code ? document.querySelector('[data-cbsid="' + saved.code + '"]') : null;
    return shown(byCode) ? byCode : null;
  }
  /** remember the last control outside every dialog that took the focus or a click: that is who opens the next sheet */
  function trackOpener(event) {
    var node = event.target;
    if (!node || node.nodeType !== 1 || node === document.body || node.closest('dialog')) return;
    opener = describe(node.closest('button,a,[role=button],[tabindex]') || node);
  }
  /** a control that only closes the sheet (the corner X) */
  function isCloser(node) {
    return node.classList.contains('mx') || CLOSE_WORDS.test(String(node.getAttribute('aria-label') || node.textContent || ''));
  }
  /** 1b: where a new sheet puts the focus - [autofocus], else the first field, else the first action that is not the X */
  function firstTarget(dialog) {
    var mark = dialog.querySelector('[autofocus]');
    if (shown(mark)) return mark;
    var fields = Array.prototype.filter.call(dialog.querySelectorAll(FIELD), function (node) {
      return shown(node) && !node.readOnly && !node.disabled;
    });
    if (fields.length) return fields[0];
    var actions = Array.prototype.filter.call(dialog.querySelectorAll(ACTION), function (node) {
      return shown(node) && !isCloser(node);
    });
    return actions[0] || null;
  }
  /** 1b: move the focus unless the page already put it on a field of this sheet */
  function placeFocus(dialog) {
    var active = document.activeElement;
    var onField = active && dialog.contains(active) && active.matches(FIELD);
    if (onField) return;
    var target = firstTarget(dialog);
    if (target) target.focus();
  }
  /** a sheet drawn again while open loses its focus to the page: bring it back to the first target; focus still inside is never touched */
  function watchRepaint(dialog) {
    if (repaintWatch) repaintWatch.disconnect();
    repaintWatch = new MutationObserver(function () {
      var active = document.activeElement;
      if (!active || active === document.body || active === dialog) placeFocus(dialog);
    });
    repaintWatch.observe(dialog, { childList: true });
  }
  /** a sheet went from closed to open */
  function onOpened(dialog) {
    dialog.__opener = opener;
    placeFocus(dialog);
    watchRepaint(dialog);
  }
  /** 2c: put the focus back on the opener when the browser's own return found nothing (the page repainted the opener, or closed through a handler) */
  function giveBack(dialog) {
    var active = document.activeElement;
    if (active && active !== document.body && !dialog.contains(active)) return;
    var back = findOpener(dialog.__opener);
    if (back) back.focus();
  }
  /** a sheet went from open to closed */
  function onClosed(dialog) {
    if (repaintWatch) repaintWatch.disconnect();
    repaintWatch = null;
    giveBack(dialog);
    setTimeout(function () {
      giveBack(dialog);
    }, 0);
  }
  /** the open attribute of any sheet changed */
  function onOpenChange(records) {
    records.forEach(function (record) {
      var dialog = record.target;
      if (!dialog.matches || !dialog.matches(SHEET)) return;
      if (dialog.hasAttribute('open') && record.oldValue === null) onOpened(dialog);
      else if (!dialog.hasAttribute('open') && record.oldValue !== null) onClosed(dialog);
    });
  }

  /** the sentence for a missing field: the page's own (data-required-msg), else the catalogue's "Required" */
  function missingWords(field) {
    var own = field.getAttribute('data-required-msg');
    if (own) return own;
    return typeof tx === 'function' ? tx('Required') : 'Required';
  }
  /** has the person left this required field empty (a tick box that must be ticked counts) */
  function isEmpty(field) {
    if (field.type === 'checkbox' || field.type === 'radio') return !field.checked;
    return !String(field.value || '').trim();
  }
  /** the first required, visible, enabled field of the sheet that is still empty */
  function firstMissing(dialog) {
    var required = Array.prototype.slice.call(dialog.querySelectorAll('[required]'));
    return required.filter(function (field) {
      return shown(field) && !field.disabled && isEmpty(field);
    })[0] || null;
  }
  /** 5: say which field is missing in the library's way (aria-invalid, the line under it, aria-describedby) and put the focus there */
  function refuse(field) {
    if (root.ui && root.ui.field && root.ui.field.error) root.ui.field.error(field, missingWords(field));
    field.setAttribute('aria-invalid', 'true');
    field.focus();
  }
  /** 5: the save button pressed with a required field empty does not run */
  function onSavePress(event) {
    var button = event.target.closest ? event.target.closest('[data-sheet-save]') : null;
    var dialog = button && button.closest(SHEET);
    if (!dialog) return;
    var missing = firstMissing(dialog);
    if (!missing) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    refuse(missing);
  }
  /** a field marked invalid is typed in: the mark and its line go away */
  function onType(event) {
    var field = event.target;
    if (!field.matches || field.getAttribute('aria-invalid') !== 'true' || !field.closest(SHEET)) return;
    if (root.ui && root.ui.field && root.ui.field.error) root.ui.field.error(field, null);
    field.removeAttribute('aria-invalid');
  }

  /** 4: a bare Enter key (no Shift, Ctrl, Alt or Meta, not part of an input-method composition, nobody has handled it yet) */
  function isPlainEnter(event) {
    var plain = !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;
    return event.key === 'Enter' && plain && !event.isComposing && !event.defaultPrevented;
  }
  /** 4: a one-line field whose Enter is ours: not a textarea, select or button, and not a <form> that has its own submit button */
  function isOneLineField(field) {
    if (field.tagName !== 'INPUT' || !ONE_LINE.test(field.type)) return false;
    return !(field.form && field.form.querySelector('[type=submit]'));
  }
  /** 4: Enter in a one-line field of a sheet presses its save button */
  function onEnter(event) {
    var field = event.target;
    var dialog = isPlainEnter(event) && field.closest ? field.closest(SHEET) : null;
    if (!dialog || !isOneLineField(field)) return;
    var save = dialog.querySelector('[data-sheet-save]:not([disabled])');
    if (!save || !shown(save)) return;
    event.preventDefault();
    save.click();
  }

  /** 8: leave the sheet after the person agreed to throw away what was typed (the page's own cancel handler runs, so its clean-up runs too) */
  function discard(dialog) {
    confirmed = true;
    var cancel = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(cancel);
    confirmed = false;
    if (!cancel.defaultPrevented && dialog.open) dialog.close();
  }
  /** 8: the question, in the words CBUnsaved already uses; its Cancel button reads Stay */
  function askDiscard(dialog) {
    CBConfirm(
      tx('Unsaved changes'),
      '<p style="margin:0">' + (typeof esc === 'function' ? esc(tx('What you typed here is not saved. Discard it?')) : tx('What you typed here is not saved. Discard it?')) + '</p>',
      tx('Discard'),
      function () {
        discard(dialog);
      },
      true
    );
    var stay = document.querySelector('#cb_confirm [data-testid="confirm-cancel"]');
    if (stay) stay.textContent = tx('Stay');
  }
  /** 8: has a field of this sheet moved from what was painted (the same test CBUnsaved gives every small app) */
  function hasMoved(dialog) {
    return !!root.CBUnsaved && root.CBUnsaved.domDirty(dialog);
  }
  /** 8: Escape on a sheet - ask first when something was typed, otherwise let the page close it as before */
  function onCancel(event) {
    var dialog = event.target;
    if (confirmed || !dialog.matches || !dialog.matches(SHEET) || typeof CBConfirm !== 'function') return;
    if (!hasMoved(dialog)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    askDiscard(dialog);
  }

  document.addEventListener('focusin', trackOpener, true);
  document.addEventListener('click', trackOpener, true);
  document.addEventListener('click', onSavePress, true);
  document.addEventListener('input', onType);
  document.addEventListener('keydown', onEnter);
  document.addEventListener('cancel', onCancel, true);
  new MutationObserver(onOpenChange).observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['open'], attributeOldValue: true });
  root.CBSheetDialog = { firstTarget: firstTarget, refuse: refuse };
})(typeof window !== 'undefined' ? window : this);
