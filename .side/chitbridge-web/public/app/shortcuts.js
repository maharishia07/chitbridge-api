/**
 * public/app/shortcuts.js: CBShortcuts, the keyboard shortcuts of the customer pages (MNT-63).
 * ID        POP144 (the shortcut sheet, the ? key)
 * OWNER     cb-ux-locale
 * OWNS      the ONE keydown listener for shortcuts · aria-keyshortcuts on the rail and the Home cards · the popup main-action finder · the ? sheet
 * NEEDS     esc from helpers.js (every page that wears the frame loads it)
 * CALLED BY public/app/shell.js (loadShortcuts: loads shortcuts-register.js, then this file, then calls CBShortcuts.mount(shell)); public/app/ui.js (keyOf and mainOf, to stamp a popup's main action).
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/shortcuts
 * RISK      plain
 * FLOW      keydown -> setting on? -> a popup open? (its main action) : a chord / "g then letter" -> go(area) | location = the card's route ; "?" -> the sheet
 *
 * Decided 14 Nov (DECISIONS: Keyboard shortcuts become a measure): a modifier chord or g-then-letter, never an always-on bare letter, a setting turns every
 * key off (avatar menu, kind 'keys', device-held until ui.keys lands in the api), the register is public/app/shortcuts-register.js and nothing else holds a key.
 * A chord is matched by the physical key (event.code), because Alt on a Mac types another character. Typing in a field is never taken: g and ? wait outside fields,
 * and a chord still works there. While a popup is open only its own main action, the sheet and Esc answer; the page behind it does not move.
 */
(function (root) {
  if (root.CBShortcuts) return;
  var doc = root.document;
  var REGISTER = root.CB_SHORTCUT_REGISTER || { rows: {}, sheet: {} };
  var SEQUENCE_MS = 1500;
  var POPUP_HOSTS = 'dialog[open], #modalhost';
  var shellRef = null;
  var pending = null;
  var sheetNode = null;

  /** the key of a register row, or null: ui.js and the sheet ask here, nothing else holds a key */
  function keyOf(code) {
    return Object.prototype.hasOwnProperty.call(REGISTER.rows, code) ? REGISTER.rows[code] : null;
  }
  /** the person's switch: the avatar's 'keys' kind (device-held), on unless it says off */
  function enabled() {
    try {
      if (root.CBAvatar && root.CBAvatar.get) return root.CBAvatar.get().keys !== 'off';
      return root.localStorage.getItem('cb_keys') !== 'off';
    } catch (failure) {
      if (root.cbQuiet) root.cbQuiet('shortcuts:enabled', failure);
      return true;
    }
  }
  /** a row's key in words for the sheet: "g then m" or "Alt+Shift+H" */
  function keyWords(key) {
    return key.indexOf('g ') === 0 ? 'g, ' + key.slice(2) : key;
  }
  /** a word through the catalogue (English is the key) */
  function tr(text) {
    return typeof root.tx === 'function' ? root.tx(text) : text;
  }

  /* ── the keys: a row's key as the event tells it ── */
  function chordOf(event) {
    var onlyAltShift = event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey;
    return onlyAltShift && /^Key[A-Z]$/.test(event.code || '') ? 'Alt+Shift+' + event.code.slice(3) : '';
  }
  /** the register row whose key is this one, within one kind of row (a card or an area for a nav key); '' = none */
  function codeForKey(key, wanted) {
    var rows = REGISTER.rows;
    return Object.keys(rows).filter(function (code) {
      return rows[code] === key && (!wanted || code.indexOf(wanted) === 0);
    })[0] || '';
  }
  /** true when the key went to a place the person types in */
  function editable(node) {
    if (!node || !node.tagName) return false;
    return /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName) || node.isContentEditable === true;
  }

  /* ── the open popup and its main action ── */
  function openPopup() {
    var heads = doc.querySelectorAll('.mhd[data-pop]');
    var head = heads.length ? heads[heads.length - 1] : null;
    var host = head && head.closest(POPUP_HOSTS);
    return head && host ? { code: head.getAttribute('data-pop'), host: host } : null;
  }
  /** true while any popup is open, ours or the page own */
  function anyPopupOpen() {
    return !!doc.querySelector('dialog[open], #modalhost .mbody');
  }
  /** a popup's main action: the last enabled primary (.pri) button of its footer and nothing else; a popup with none has no key (a danger or quiet button is never pressed by a key) */
  function mainOf(host) {
    var foot = host && host.querySelector('.mfoot');
    var primary = foot ? [].slice.call(foot.querySelectorAll('button.pri:not(.danger)')) : [];
    return primary.filter(function (button) {
      return !button.disabled;
    }).pop() || null;
  }
  /** press the open popup main action when it is the popup with this code */
  function pressMain(code) {
    var popup = openPopup();
    if (!popup || popup.code !== code) return false;
    var button = mainOf(popup.host);
    if (button) button.click();
    return !!button;
  }

  /* ── going somewhere ── */
  function goArea(id) {
    if (shellRef && shellRef.go) shellRef.go(id);
  }
  /** open the page of a built Home card, by its manifest id */
  function goCard(id) {
    var entries = (shellRef && shellRef.manifest() && shellRef.manifest().entries) || [];
    var entry = entries.filter(function (item) {
      return item.id === id && item.state === 'built';
    })[0];
    if (entry && shellRef.route) root.location.href = shellRef.route(entry);
  }
  /** go to a nav row: 'HOM001-K01#selling' goes to that area, 'HOM001-B01#finance' opens that card's page; true if it went */
  function goTo(code) {
    var parts = code.split('#');
    if (parts[0] === 'HOM001-K01') goArea(parts[1]);
    else if (parts[0] === 'HOM001-B01') goCard(parts[1]);
    else return false;
    return true;
  }

  /* ── the one listener ── */
  /** true when a modifier is down, so the key belongs to the browser or the page */
  function isModified(event) {
    return event.altKey || event.ctrlKey || event.metaKey;
  }
  function onKey(event) {
    if (!enabled() || event.defaultPrevented || event.isComposing) return;
    var chord = chordOf(event);
    if (chord) return onChord(event, chord);
    if (isModified(event) || editable(event.target)) return;
    if (event.key === REGISTER.sheet.key) {
      event.preventDefault();
      return toggleSheet();
    }
    if (!anyPopupOpen()) onPlainKey(event);
  }
  /** a plain key outside popups: the letter after g, or g itself starting the wait */
  function onPlainKey(event) {
    if (pending) return onSecond(event);
    if (event.key !== 'g' || event.repeat) return;
    pending = root.setTimeout(function () {
      pending = null;
    }, SEQUENCE_MS);
  }
  /** a chord: the open popup's main action when the chord is that popup's key, otherwise (no popup open) a nav row */
  function onChord(event, chord) {
    if (event.repeat) return; /* a held key must never press the confirm popup the first press opened */
    var popup = openPopup();
    var code = popup || anyPopupOpen() ? '' : codeForKey(chord, 'HOM001');
    var did = popup ? keyOf(popup.code) === chord && pressMain(popup.code) : code && goTo(code);
    if (did) event.preventDefault();
  }
  /** the letter after g: a card, or nothing (any other key just ends the wait) */
  function onSecond(event) {
    root.clearTimeout(pending);
    pending = null;
    var code = codeForKey('g ' + event.key, 'HOM001-B01');
    if (code && goTo(code)) event.preventDefault();
  }

  /* ── aria-keyshortcuts on the rail and the cards (a card is drawn by the shell, not by ui.js) ── */
  function stamp() {
    if (!shellRef || !shellRef.el) return;
    var on = enabled();
    [].forEach.call(shellRef.el.querySelectorAll('.cbsh-nv[data-go], .cbsh-box[data-id]'), function (node) {
      var code = node.hasAttribute('data-go') ? 'HOM001-K01#' + node.getAttribute('data-go') : 'HOM001-B01#' + node.getAttribute('data-id');
      var key = on ? keyOf(code) : null;
      /* aria-keyshortcuts has no sequence (a space means 'or'), so g-then-letter is named in data-shortcut and in the sheet; a chord is announced */
      if (key) node.setAttribute(key.indexOf('g ') === 0 ? 'data-shortcut' : 'aria-keyshortcuts', key);
      else {
        node.removeAttribute('aria-keyshortcuts');
        node.removeAttribute('data-shortcut');
      }
    });
  }
  /** stamp again whenever the shell redraws its rail or cards */
  function watchShell() {
    if (!root.MutationObserver) return;
    var queued = false;
    new root.MutationObserver(function () {
      if (queued) return;
      queued = true;
      root.setTimeout(function () {
        queued = false;
        stamp();
      }, 0);
    }).observe(shellRef.el, { childList: true, subtree: true });
  }

  /* ── the ? sheet: every row of the register, grouped; a library popup (ui.dialog) where the page has modal(), else a native dialog with the same head ── */
  function names(entries) {
    var out = {};
    entries.forEach(function (entry) {
      out[entry.id] = entry.name;
    });
    return out;
  }
  /** the sheet rows as { group: [[name, key]] }, names from the manifest and the shell */
  function sheetRows(entries) {
    var cards = names(entries);
    var areas = (root.CBShell && root.CBShell.WORDS && root.CBShell.WORDS.areas) || {};
    var groups = { Areas: [], Pages: [], Popups: [] };
    Object.keys(REGISTER.rows).forEach(function (code) {
      var key = REGISTER.rows[code];
      var id = code.split('#')[1];
      if (code.indexOf('HOM001-K01') === 0) groups.Areas.push([areas[id] || id, key]);
      else if (code.indexOf('HOM001-B01') === 0 && cards[id]) groups.Pages.push([cards[id], key]);
    });
    groups.Popups.push([tr('The main action of the open popup'), 'Alt+Shift+D']);
    groups.Popups.push([tr('This list'), REGISTER.sheet.key]);
    return groups;
  }
  /** the sheet body: a note, then one list per group */
  function sheetHtml(groups) {
    var html = '<p class="cbsc-note">' + esc(tr('Keys work outside a text box. Turn them off in the avatar menu, Keyboard shortcuts.')) + '</p>';
    Object.keys(groups).forEach(function (title) {
      if (!groups[title].length) return;
      html += '<h3 class="cbsc-h">' + esc(tr(title)) + '</h3><dl class="cbsc-l">';
      groups[title].forEach(function (row) {
        html += '<div><dt>' + esc(tr(row[0])) + '</dt><dd><kbd>' + esc(keyWords(row[1])) + '</kbd></dd></div>';
      });
      html += '</dl>';
    });
    return '<div class="cbsc" data-testid="shortcut-sheet">' + html + '</div>';
  }
  var SHEET_CSS =
    '.cbsc{font-size:14px}.cbsc-note{margin:0 0 8px;color:var(--muted,#6b6557)}.cbsc-h{font-size:13px;margin:12px 0 4px}' +
    '.cbsc-l{margin:0}.cbsc-l div{display:flex;justify-content:space-between;gap:12px;padding:4px 0;border-bottom:1px solid var(--line,#e4dcc6)}' +
    '.cbsc-l dt{margin:0}.cbsc-l dd{margin:0}.cbsc kbd{font-family:ui-monospace,monospace;background:var(--neutral-tint,rgba(128,128,128,.16));border-radius:5px;padding:1px 6px}' +
    'dialog.cbsc-d{border:1px solid var(--line,#d8ccb0);border-radius:14px;padding:0;width:min(440px,94vw);max-height:80vh;overflow:auto;color:var(--ink,#1d1b16);background:var(--card,#fff)}' +
    'dialog.cbsc-d .mhd{padding:14px 18px 4px;display:flex;align-items:center;gap:10px}dialog.cbsc-d .t{font-weight:700;font-size:18px;flex:1}' +
    'dialog.cbsc-d .mbody{padding:6px 18px}dialog.cbsc-d .mfoot{padding:10px 18px 14px;display:flex;justify-content:flex-end}';
  /** the sheet head with its popup-code chip */
  function sheetHead(title) {
    var chip = root.CBScreenId && root.CBScreenId.popupChip ? root.CBScreenId.popupChip(REGISTER.sheet.code, 'margin-inline-start:auto') : '';
    return '<div class="mhd" data-pop="' + REGISTER.sheet.code + '"><div class="t">' + esc(title) + '</div>' + chip + '</div>';
  }
  /** the library way: a page with modal() opens it through ui.dialog; the footer is its own Close (also the main action) */
  function openLibrary(title, body) {
    root.CBUi.dialog({
      mount: 'HOM001-U01',
      title: title,
      pop: REGISTER.sheet.code,
      body: body,
      actions: [{ name: 'close', options: { mount: 'HOM001-U01', tone: 'primary' } }]
    });
  }
  /** a page with no modal(): the same head, body and footer in a native dialog, closed by Esc or its Close */
  function openNative(title, body) {
    var style = doc.getElementById('cbsc-css') || doc.head.appendChild(doc.createElement('style'));
    style.id = 'cbsc-css';
    style.textContent = SHEET_CSS;
    var opener = doc.activeElement; /* the sheet gives focus back to where the person was */
    sheetNode = doc.createElement('dialog');
    sheetNode.className = 'cbsc-d';
    sheetNode.setAttribute('data-pop', 'POP144');
    sheetNode.setAttribute('aria-label', title);
    var close = root.CBUi ? root.CBUi.action('close', { mount: 'HOM001-U01', surface: 'dialog', tone: 'primary' }) : '<button data-cbsid="CMP005" type="button" class="pri">' + esc(tr('Close')) + '</button>';
    sheetNode.innerHTML = sheetHead(title) + '<div class="mbody">' + body + '</div><div class="mfoot">' + close + '</div>';
    sheetNode.addEventListener('click', function (event) {
      if (event.target.closest && event.target.closest('.mfoot button')) sheetNode.close();
    });
    sheetNode.addEventListener('close', function () {
      if (opener && opener.focus) opener.focus();
      sheetNode.remove();
      sheetNode = null;
    });
    doc.body.appendChild(sheetNode);
    sheetNode.showModal();
  }
  /** open the sheet, or close it when it is open */
  function toggleSheet() {
    if (sheetNode) return sheetNode.close();
    var done = function (entries) {
      var title = tr('Keyboard shortcuts');
      var body = sheetHtml(sheetRows(entries));
      if (root.CBUi && typeof root.modal === 'function') openLibrary(title, body);
      else openNative(title, body);
    };
    var manifest = shellRef && shellRef.manifest();
    done((manifest && manifest.entries) || []);
  }

  /** bind the unit to the shell that framed the page, stamp its keys and keep them stamped */
  function mount(shell) {
    shellRef = shell;
    if (!shell || !shell.el) return;
    stamp();
    watchShell();
  }
  doc.addEventListener('keydown', onKey);
  root.CBShortcuts = { mount: mount, keyOf: keyOf, mainOf: mainOf, enabled: enabled, stamp: stamp, REGISTER: REGISTER };
})(typeof window !== 'undefined' ? window : this);
