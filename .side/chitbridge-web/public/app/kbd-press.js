/* app/kbd-press.js - ONE keyboard rule for a control that is not a native button: Enter or Space presses it. Register code CMP053.
 *
 * OWNS      the delegated keydown that turns Enter and Space on an element marked role="button" tabindex="0" into the click its page already handles.
 *           It draws nothing and owns no state; the page marks the element (role, tabindex, an aria-label when the text is not a name).
 *           Guards: a key the page already handled (defaultPrevented) is not pressed twice, a held key (repeat) presses once, and Ctrl, Alt or Meta chords are left alone.
 * CALLED BY every page that draws a span or div with a click handler: the real step rail (step-flow.js, so accounts.html, crm.html, finance.html, shop.html and
 *           app.html load this before it), the test board's state chips (testing.html), and the four step-flow design labs (cart-design, network-design, supplier-design, storefront-design).
 *           Not loaded by kural.js (its own swap key on 19 pages) or standards.html (its glossary words open a popover, not a click).
 * FLOW      load -> one keydown listener on document -> Enter or Space, not repeat, not defaultPrevented, no chord, target is a role=button tabindex non-native element -> preventDefault (Space must not scroll, and a second listener sees it handled) -> el.click()
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 */
(function (root) {
  'use strict';
  var PRESS_KEYS = { Enter: true, ' ': true };
  /* a native button, link or field already answers these keys itself; only a marked span or div needs help */
  function pressable(el) {
    return !!el && el.getAttribute && el.getAttribute('role') === 'button' && el.hasAttribute('tabindex') && !/^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
  }
  /* the keydown handler: presses at most once per physical key press, however many listeners see the event */
  function onKey(event) {
    if (!PRESS_KEYS[event.key] || event.repeat || event.defaultPrevented) return;
    if (event.ctrlKey || event.altKey || event.metaKey || !pressable(event.target)) return;
    event.preventDefault();
    event.target.click();
  }
  if (root.document) root.document.addEventListener('keydown', onKey);
  root.CBKbdPress = { pressable: pressable, onKey: onKey };
})(typeof window !== 'undefined' ? window : this);
