/**
 * public/app/shortcuts-register.js: THE SHORTCUT REGISTER (MNT-63). One row per element code that has a keyboard shortcut: code -> key.
 * ID        HOM001 (rail and cards) · POP028, POP065, POP089-POP092, POP095-POP106, POP108 (popup main actions) · POP144 (the shortcut sheet)
 * OWNER     cb-ux-locale
 * OWNS      the key of every nav entry and popup main action; nothing else holds a key (the guard e2e/shortcuts-guard.cjs refuses a literal key anywhere else).
 * CALLED BY public/app/shell.js (loads it beside the frame, then shortcuts.js); e2e/shortcuts-guard.cjs and tools/shortcuts-count.cjs read it by name.
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/shortcuts
 * RISK      plain
 * FLOW      row -> shortcuts.js (stamps aria-keyshortcuts, one listener, the ? sheet) -> ui.js (stamps a popup's main action (Alt+Shift+D; Chrome owns Alt+Shift+A))
 *
 * THE ROW  'HOM001-K01#selling'  the rail's area button (data-cbsid HOM001-K01, data-go) · 'HOM001-B01#finance'  the Home card (data-cbsid HOM001-B01, data-id = the
 *          manifest entry id) · 'POP096'  the popup with that code: one key presses its main action, whichever popup is open (one scope each, so one key serves all).
 * THE KEYS (WCAG 2.2 SC 2.1.4, WAI-ARIA aria-keyshortcuts):
 *          'g x'  press g, then the letter (a card: it opens that page) · 'Alt+Shift+X'  a modifier chord (an area, a card past the 26 letters, a popup's main action (Alt+Shift+D; Chrome owns Alt+Shift+A)).
 *          Never a bare letter on its own, never Ctrl+letter (the browser and screen readers own those). The avatar menu's "Keyboard shortcuts" turns every one off.
 *          'sheet' is the one bare key, "?", and it obeys the same switch.
 */
(function (root) {
  root.CB_SHORTCUT_REGISTER = {
    setting: 'keys',
    sheet: { code: 'POP144', key: '?' },
    rows: {
      /* the rail: seven areas, Alt+Shift+letter */
      'HOM001-K01#home': 'Alt+Shift+H',
      'HOM001-K01#selling': 'Alt+Shift+S',
      'HOM001-K01#money': 'Alt+Shift+M',
      'HOM001-K01#running': 'Alt+Shift+R',
      'HOM001-K01#trade': 'Alt+Shift+E',
      'HOM001-K01#labs': 'Alt+Shift+L',
      'HOM001-K01#setup': 'Alt+Shift+U',
      /* the cards of the 19 customer pages: g then a letter */
      'HOM001-B01#accounts': 'g a',
      'HOM001-B01#standards': 'g b',
      'HOM001-B01#counters': 'g c',
      'HOM001-B01#documents': 'g d',
      'HOM001-B01#employees': 'g e',
      'HOM001-B01#finance': 'g f',
      'HOM001-B01#catalogue': 'g g',
      'HOM001-B01#shop': 'g h',
      'HOM001-B01#till': 'g i',
      'HOM001-B01#reports': 'g j',
      'HOM001-B01#stock': 'g k',
      'HOM001-B01#trend': 'g l',
      'HOM001-B01#marketing': 'g m',
      'HOM001-B01#network': 'g n',
      'HOM001-B01#operations': 'g o',
      'HOM001-B01#compare': 'g p',
      'HOM001-B01#plan': 'g q',
      'HOM001-B01#crm': 'g r',
      'HOM001-B01#suppliers': 'g s',
      'HOM001-B01#tasks': 'g t',
      'HOM001-B01#disputes': 'g u',
      'HOM001-B01#privacy': 'g v',
      'HOM001-B01#storefront': 'g w',
      'HOM001-B01#coassist': 'g x',
      'HOM001-B01#kyb': 'g y',
      'HOM001-B01#account': 'g z',
      /* the cards past the 26 letters */
      'HOM001-B01#product-lab': 'Alt+Shift+P',
      'HOM001-B01#offer-lab': 'Alt+Shift+O',
      'HOM001-B01#combo-lab': 'Alt+Shift+C',
      'HOM001-B01#network-lab': 'Alt+Shift+W',
      'HOM001-B01#country-lab': 'Alt+Shift+Y',
      'HOM001-B01#conversion-lab': 'Alt+Shift+V',
      'HOM001-B01#compatibility': 'Alt+Shift+Q',
      'HOM001-B01#connectors': 'Alt+Shift+K',
      'HOM001-B01#governance': 'Alt+Shift+G',
      'HOM001-B01#bank': 'Alt+Shift+B',
      /* a popup's main action (Alt+Shift+D; Chrome owns Alt+Shift+A) (the popups that open through ui.dialog with their code) */
      POP065: 'Alt+Shift+D',
      POP091: 'Alt+Shift+D',
      POP092: 'Alt+Shift+D',
      POP095: 'Alt+Shift+D',
      POP096: 'Alt+Shift+D',
      POP097: 'Alt+Shift+D',
      POP098: 'Alt+Shift+D',
      POP099: 'Alt+Shift+D',
      POP100: 'Alt+Shift+D',
      POP101: 'Alt+Shift+D',
      POP102: 'Alt+Shift+D',
      POP103: 'Alt+Shift+D',
      POP104: 'Alt+Shift+D',
      POP105: 'Alt+Shift+D',
      POP106: 'Alt+Shift+D',
      POP108: 'Alt+Shift+D',
      POP028: 'Alt+Shift+D',
      POP089: 'Alt+Shift+D',
      POP090: 'Alt+Shift+D',
      POP144: 'Alt+Shift+D'
    }
  };
})(typeof window !== 'undefined' ? window : this);
