/**
 * cap-employees-copy.js — Employees: the sign-in name, whole, with its Copy control.
 *
 * OWNS      signInName (the name AS TYPED at the sign-in screen, never cut) · nameWithCopy (the name and its Copy control, code EMP001-B14) · wireCopy (Copy: the whole name to the clipboard, said on the button); moved out of cap-employees.js (2026-11-17, size ratchet; behaviour unchanged)
 * CALLED BY public/employees.html (<script src>, before cap-employees.js) · app/cap-employees.js (the list's sign-in column, the person's sheet, the added-person note)
 * FLOW      nameWithCopy(userId, testid, cls) draws the name and the button → the host calls wireCopy() once the HTML is in the page → a press copies and says Copied on the button itself
 * CARD      17-people-employees-hr-and-payroll/pin-otp-first-sign-in
 */
(function (root) {
  'use strict';
  function words(text) {
    return typeof root.tx === 'function' ? root.tx(text) : text;
  }
  /** one element by id */
  function $(id) {
    return root.document.getElementById(id);
  }
  /** the sign-in name AS TYPED at the sign-in screen, whole (asha01@mayur-restaurant.br): W15-59 - the short form failed when typed as shown, so it is never cut. */
  function signInName(u) {
    return String(u == null ? '' : u);
  }
  /** the sign-in name and its Copy control (library button, code EMP001-B14); the name's own element keeps its test id so it reads as the plain name */
  function nameWithCopy(u, idTid, cls) {
    var name = signInName(u);
    return (
      '<span class="' + cls + '" data-testid="' + idTid + '">' + esc(name) + '</span> ' +
      (name ? '<button data-cbsid="EMP001-B14" type="button" class="act emp-copy" id="emp_copy" data-testid="emp-copy" data-copy="' + esc(name) + '">' + esc(words('Copy')) + '</button>' : '')
    );
  }
  /** Copy: the whole sign-in name to the clipboard, said on the button itself (no toast to miss) */
  function wireCopy() {
    var copyButton = $('emp_copy');
    if (!copyButton) return;
    /* a press: the whole name to the clipboard, said on the button itself */
    copyButton.onclick = function () {
      var text = copyButton.getAttribute('data-copy') || '',
        showResult = function (ok) {
          copyButton.textContent = words(ok ? 'Copied' : 'Select the name and copy it');
        };
      try {
        root.navigator.clipboard.writeText(text).then(
          function () {
            showResult(true);
          },
          function () {
            showResult(false);
          }
        );
      } catch (_) {
        showResult(false);
      }
    };
  }
  root.CBEmployeesCopy = { signInName: signInName, nameWithCopy: nameWithCopy, wireCopy: wireCopy };
})(typeof window !== 'undefined' ? window : this);
