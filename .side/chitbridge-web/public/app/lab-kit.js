/**
 * OWNS  the labs' shared rules (UX-90, walk 21 Oct W9 / W10 / W15 / W1): the list of labs (the Labs switcher), plain words for a code, "Not set up
 *       for <country> yet", at most three items + "and N more" (the popup is a CBList), progress as a bar + "x of y ready · next: …", the
 *       Ready / Nearly / Not started grouping, and the layout classes (lab-cols, lab-cards) in /app/lab-kit.css.
 * CONFIRM  confirm(title, bodyHtml, onOk, opts): the one popup that asks before a money promise is made (the Offer Lab shelf buttons, UX-109).
 * PROMISE  promise(parts) -> {title, ok, danger, html, text}: the ONE sentence (what, on what, for whom, from when) that the confirm body, the draft line
 *          and any pane show; a lab supplies the parts (its name, reach and group label), never its own wording (Offer Lab v2 PR-a0).
 * CALLED BY 9 pages by <script src> (grep -lE 'src="/?app/lab-kit.js' public/*.html): the Conversion, Country, Network, Offer and Product labs, List Lab, Shell Lab, Sign-in Lab and the
 *           UI standard page; CBLabKit is called by the page frame (the switcher), the Definitions screen, country-lab.html and offer-lab-next.html (grep -n 'CBLabKit\.' public)
 * CARD 29-qa-test-tooling-ux-locale-and-design-system/lab-kit
 * CONTROLS  SCR042-B01 (the confirm popup's Confirm) and SCR042-B02 (and N more); the Cancel beside Confirm is CMP003
 * FLOW  page loads → CBLabKit.LABS feeds the switcher → a lab paints rows through plain · notSetUp · reason · more · progress · groups
 *
 * NOT a second frame (the frame is CBFrame + page-skeleton.css) and NOT a second list (the popup mounts CBList, app/list-ctl.js).
 * Escaping is app/helpers.js esc, the one copy. Colour is theme tokens only: red is for a blocker, nothing else.
 */
(function (root) {
  'use strict';
  /* the labs, in menu order. Same routes as app/manifest.json's built labs (e2e/lab-frame.cjs checks they agree). */
  var LABS = [
    { id: 'product-lab', name: 'Product Lab', route: '/product-lab.html', icon: '◈' },
    { id: 'offer-lab', name: 'Offer Lab', route: '/offer-lab-next.html', icon: '%' },
    { id: 'combo-lab', name: 'Combo Lab', route: '/offer-lab-next.html?mode=combo', icon: '▣' },
    { id: 'conversion-lab', name: 'Conversion Lab', route: '/conversion-lab.html', icon: '⇅' },
    { id: 'country-lab', name: 'Country Lab', route: '/country-lab.html', icon: '§' },
    { id: 'compatibility', name: 'Compatibility Lab', route: '/standards.html#compared-with', icon: '⇋' },
    { id: 'network-lab', name: 'Network Lab', route: '/network-design.html', icon: '⌾' },
    { id: 'list-lab', name: 'List Lab', route: '/list-lab.html', icon: '☰' },
    { id: 'signin-lab', name: 'Sign-in Lab', route: '/signin-lab.html', icon: '⏎' },
    { id: 'shell-lab', name: 'Shell Lab', route: '/shell-lab.html', icon: '▭' }
  ];
  var MORE_AT = 3; /* W15: at most three inline, the rest in the popup */

  var escapeText = root.esc; /* the one escaper (app/helpers.js) */

  /* ── W4: a code is shown as plain words, the code itself only in the tooltip (for the accountant). Seed words; a lab adds its own with addWords. ── */
  var WORDS = {
    div40: 'Capital allowances (Division 40)',
    schedule_ii: 'Companies Act schedule rates',
    it_act_wdv: 'Income-tax Act written-down value',
    ias16: 'International standard rates (IAS 16)',
    straight_line: 'Same amount every year',
    '{series}/{fy}/{n:6}': 'Series / year / number, like INV/2026-27/000001'
  };
  function addWords(map) {
    Object.keys(map || {}).forEach(function (key) {
      WORDS[key] = map[key];
    });
  }
  /** a code as people read it: the plain words if known, else the code spelled out; the code stays in the tooltip */
  function plain(code) {
    var codeText = String(code == null ? '' : code);
    var words = WORDS[codeText] || codeText.replace(/[_-]+/g, ' ').replace(/^./, function (letter) { return letter.toUpperCase(); });
    return '<span class="lk-plain" title="' + escapeText(codeText) + '">' + escapeText(words) + '</span>';
  }
  /** W2: a fact we have not filled in says so in words, never "not in the pack"; willBe says what it will be, when known */
  function notSetUp(country, willBe) {
    return '<span class="lk-notset">Not set up for ' + escapeText(country) + ' yet' + (willBe ? ' · ' + escapeText(willBe) : '') + '</span>';
  }
  /** W9: no blank without a reason: a value, or the sentence saying why there is none */
  function reason(value, reasonText) {
    return value == null || value === '' ? '<span class="lk-why">' + escapeText(reasonText) + '</span>' : escapeText(value);
  }

  /* ── W10: tags. Red ONLY for a blocker; a difference between countries is neutral grey. ── */
  var TAGS = { blocker: 'lk-tag blocker', diff: 'lk-tag diff', ok: 'lk-tag ok', near: 'lk-tag near' };
  function tag(kind, text) {
    return '<span class="' + (TAGS[kind] || TAGS.diff) + '">' + escapeText(text) + '</span>';
  }
  /** a bar and "x of y ready · next: …" (next only when something is left) */
  function progress(done, total, next) {
    var percent = total ? Math.round((done / total) * 100) : 0;
    var line = done + ' of ' + total + ' ready' + (next && done < total ? ' · next: ' + next : '');
    return (
      '<div class="lk-progress" data-testid="lk-progress"><div class="lk-bar" role="img" aria-label="' + escapeText(line) + '"><i style="width:' + percent + '%"></i></div>' +
      '<div class="lk-progress-line">' + escapeText(line) + '</div></div>'
    );
  }
  /** which group an area falls in: Ready (all done) · Not started (none) · Nearly (between) */
  function groupOf(item) {
    if (item.total && item.done >= item.total) return 'Ready';
    return item.done > 0 ? 'Nearly' : 'Not started';
  }
  /**
   * groupBy(items, keyFn, order) -> { <key>: [items…] }: every key of `order` is present (empty if nothing falls in it), in that order, then any other
   * key keyFn returned. One grouping for every lab: readiness (Ready · Nearly · Not started) and the Offer Lab's status shelf (live · paused · approved · draft).
   */
  function groupBy(items, keyFn, order) {
    var out = {};
    (order || []).forEach(function (name) {
      out[name] = [];
    });
    (items || []).forEach(function (item) {
      var name = keyFn(item);
      (out[name] = out[name] || []).push(item);
    });
    return out;
  }
  /** items [{ name, done, total, next, blocker }] → { Ready:[…], Nearly:[…], 'Not started':[…] } */
  function groups(items) {
    return groupBy(items, groupOf, ['Ready', 'Nearly', 'Not started']);
  }
  /** the grouped readiness block: each group heading, then each area with its bar; a blocker is the only red */
  function readiness(items) {
    var by = groups(items);
    return Object.keys(by)
      .filter(function (name) {
        return by[name].length;
      })
      .map(function (name) {
        return (
          '<section class="lk-group" data-group="' + escapeText(name) + '"><h3>' + escapeText(name) + ' <span class="lk-count">' + by[name].length + '</span></h3>' +
          by[name]
            .map(function (item) {
              return (
                '<div class="lk-area"><div class="lk-area-name">' + escapeText(item.name) + (item.blocker ? ' ' + tag('blocker', item.blocker) : '') + '</div>' +
                progress(item.done, item.total, item.next) + '</div>'
              );
            })
            .join('') +
          '</section>'
        );
      })
      .join('');
  }

  /* ── W15: at most three inline + "and N more" opening the one list control in a popup ── */
  /** the controls a Tab can reach inside a node (visible, enabled): the popup's focus trap walks this list */
  function tabbables(node) {
    var query = 'a[href],button,input,select,textarea,[tabindex]';
    return Array.prototype.filter.call(node.querySelectorAll(query), function (item) {
      return !item.disabled && item.getAttribute('tabindex') !== '-1' && !item.hidden && item.offsetParent !== null;
    });
  }
  /** the keys of an open popup: Esc closes only this one (a sheet or confirm under it stays until the next Esc); Tab and Shift+Tab stay inside the dialog */
  function popupKey(event, back, close) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      return void close();
    }
    if (event.key !== 'Tab') return;
    var items = tabbables(back.querySelector('.lk-pop'));
    if (!items.length) return void event.preventDefault();
    var first = items[0],
      last = items[items.length - 1],
      inside = back.contains(root.document.activeElement);
    if (!inside || (event.shiftKey && root.document.activeElement === first)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (!event.shiftKey && root.document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  /**
   * popup(title, build, extraClass, onClose): the ONE modal of the labs and of every page that loads this file (CMP002 dialog).
   * Focus: it starts on the close button (confirm() moves it to the safe button), Tab and Shift+Tab stay INSIDE the dialog, Esc, the x and a click outside close it,
   * and focus goes back to the control that opened it (or, when the page repainted that control, to onClose's answer: a node to focus).
   * extraClass 'lk-side' is the placement variant: a panel at the side on a wide screen, a sheet at the bottom on a phone.
   */
  function popup(title, build, extraClass, onClose) {
    var opener = root.document.activeElement;
    var back = root.document.createElement('div');
    back.className = 'lk-pop-back' + (extraClass && extraClass.indexOf('lk-side') >= 0 ? ' lk-side-back' : '');
    back.innerHTML =
      '<div class="lk-pop' + (extraClass ? ' ' + extraClass : '') + '" role="dialog" data-pop="POP141" aria-modal="true" aria-label="' + escapeText(title) + '" data-testid="lk-pop"><header><b>' + escapeText(title) +
      '</b><button data-cbsid="CMP005" type="button" class="lk-pop-x" aria-label="Close" data-testid="lk-pop-close">×</button></header><div class="lk-pop-body"></div></div>';
    function close() {
      root.document.removeEventListener('keydown', onKey, true);
      back.remove();
      var target = (onClose && onClose()) || opener;
      if (target && target.isConnected && target.focus) target.focus();
    }
    function onKey(event) {
      popupKey(event, back, close);
    }
    back.addEventListener('click', function (event) {
      if (event.target === back || event.target.closest('.lk-pop-x')) close();
    });
    root.document.addEventListener('keydown', onKey, true);
    root.document.body.appendChild(back);
    build(back.querySelector('.lk-pop-body'));
    var closeBtn = back.querySelector('.lk-pop-x');
    if (closeBtn.focus) closeBtn.focus();
    return { close: close, node: back };
  }
  /**
   * UX-109 (Athi 22 Oct): an action that commits a money promise asks first, in words. `bodyHtml` is raw HTML (the caller escapes what it
   * puts in); `onOk` runs only on Confirm. Cancel, the x, Esc and a click outside change nothing. Focus starts on Cancel, never on the promise.
   * opts: { okLabel, cancelLabel, danger, className (added to lk-confirm), onClose (→ the node to focus after it closes) }
   */
  function confirm(title, bodyHtml, onOk, opts) {
    opts = opts || {};
    var shown = popup(
      title,
      function (body) {
        body.innerHTML =
          '<div class="lk-confirm-text" data-testid="lk-confirm-text">' + bodyHtml + '</div>' +
          '<div class="lk-confirm-acts"><button data-cbsid="CMP003" type="button" class="lk-btn" data-testid="lk-confirm-cancel">' + escapeText(opts.cancelLabel || 'Cancel') + '</button>' +
          '<button data-cbsid="SCR042-B01" type="button" class="lk-btn lk-btn-go' + (opts.danger ? ' lk-btn-danger' : '') + '" data-testid="lk-confirm-ok">' + escapeText(opts.okLabel || 'Confirm') + '</button></div>';
        body.querySelector('[data-testid="lk-confirm-cancel"]').onclick = function () { shown.close(); };
        body.querySelector('[data-testid="lk-confirm-ok"]').onclick = function () { shown.close(); onOk(); };
      },
      'lk-confirm' + (opts.className ? ' ' + opts.className : ''),
      opts.onClose
    );
    var cancelButton = shown.node.querySelector('[data-testid="lk-confirm-cancel"]');
    if (cancelButton && cancelButton.focus) cancelButton.focus();
    return shown;
  }
  /* ── UX-109 / Offer Lab v2: ONE promise sentence. The popup, the pane and the sheet's draft line all read it from here, never word it themselves. ── */
  var EVERYONE_NOW = { who: 'every customer', from: 'now, on the very next bill', end: 'Every bill from now on gets it.' };
  /** the acts a lab can commit: the button, the sentence's "for whom" (from `group`, the label the lab gives), "from when" and the closing line */
  var PROMISE_ACTS = {
    live: { title: 'Make this {thing} live?', ok: 'Make live', who: function (parts) { return parts.group ? 'every customer (it was only for ' + parts.group + ')' : EVERYONE_NOW.who; }, from: EVERYONE_NOW.from, end: EVERYONE_NOW.end },
    resume: { title: 'Resume this {thing}?', ok: 'Resume', who: function (parts) { return parts.group ? parts.group + ' only' : EVERYONE_NOW.who; }, from: EVERYONE_NOW.from, end: EVERYONE_NOW.end },
    group: { title: 'Make this {thing} live for a group?', ok: 'Make live for them', who: function (parts) { return parts.group + ' only'; }, from: EVERYONE_NOW.from, end: 'Only they get it. Nobody else does.' },
    golive: { title: 'Go live with this {thing}?', ok: 'Go live', who: function (parts) { return parts.group ? parts.group + ' only' : EVERYONE_NOW.who; }, from: EVERYONE_NOW.from, end: function (parts) { return parts.group ? 'Only they get it. Nobody else does.' : EVERYONE_NOW.end; } },
    approve: { title: 'Approve this {thing}?', ok: 'Approve', who: function (parts) { return parts.group ? 'nobody yet (it is for ' + parts.group + ' only)' : 'nobody yet'; }, from: 'not live. Going live is the next step', end: 'Approving does not start it.' },
    pause: { title: 'Pause this {thing}?', ok: 'Pause', who: function (parts) { return 'nobody while it is paused' + (parts.group ? ' (it is for ' + parts.group + ' only)' : ''); }, from: 'now', end: 'Resume brings it back.' },
    retire: { title: 'Retire this {thing}?', ok: 'Retire', danger: true, who: function () { return 'nobody from now on'; }, from: 'now', end: 'It leaves your shelf. Bills already made keep what they got.' },
    delete: { title: 'Delete this {thing}?', ok: 'Delete', danger: true, who: function () { return 'nobody'; }, from: 'now', end: 'It is gone from this tab. This cannot be undone.' },
    draft: { title: 'Save this {thing} as a draft?', ok: 'Save draft', who: function () { return 'nobody yet'; }, from: 'not live. Nothing is live until you make it live', end: 'Saving does not start it.',
      /* the sheet shows the draft as one line, before the save */
      line: function (parts, head) { return 'Saves a draft: ' + head + ', on ' + parts.on + '. Nothing is live until you make it live.'; } }
  };
  /**
   * promise(parts) -> { title, ok, danger, html, text }: the one sentence a commit control shows before it saves.
   * parts: { act (a PROMISE_ACTS key), thing ('offer'), name, detail, on (what it reaches, with the count), group (a label), margin (the lab's one margin sentence, or ''), note (a closing extra) }.
   * `html` is the confirm popup's body; `text` is the same words as plain text (the pane and the draft line show it; the equality test reads it).
   */
  /** the lab's margin sentence as a space-led fragment, or '' when it has none */
  function marginPart(parts) {
    return parts.margin ? ' ' + parts.margin : '';
  }
  function promise(parts) {
    var step = PROMISE_ACTS[parts.act],
      audience = step.who(parts),
      head = parts.name + (parts.detail ? ' · ' + parts.detail : ''),
      note = parts.note ? ' ' + parts.note : '',
      margin = marginPart(parts),
      closing = typeof step.end === 'function' ? step.end(parts) : step.end;
    return {
      title: step.title.replace('{thing}', parts.thing || 'offer'),
      ok: step.ok,
      danger: !!step.danger,
      html:
        '<p><b>' + escapeText(parts.name) + '</b>' + (parts.detail ? ' · ' + escapeText(parts.detail) : '') + '</p>' +
        '<span class="lk-reach" data-testid="promise-on">On: ' + escapeText(parts.on) + '</span>' +
        (margin ? '<p class="lk-margin" data-testid="promise-margin">' + escapeText(margin.trim()) + '</p>' : '') +
        '<p>For: <b>' + escapeText(audience) + '</b></p><p>From: <b>' + escapeText(step.from) + '</b></p><p>' + escapeText(closing + note) + '</p>',
      text: step.line ? step.line(parts, head) + margin + note : head + ' On: ' + parts.on + margin + ' For: ' + audience + ' From: ' + step.from + ' ' + closing + note
    };
  }
  function listOptions(opts, items, shown) {
    return {
      onOpen: opts.open
        ? function (item) {
            shown.close();
            opts.open(item);
          }
        : undefined,
      key: 'lab-more-' + opts.id,
      rows: function () {
        return items;
      },
      id: function (item) {
        return item[opts.idKey || opts.columns[0].key];
      },
      search: function (item) {
        return opts.columns.map(function (column) { return item[column.key]; }).join(' ');
      },
      head: function () {
        return { title: opts.title };
      },
      columns: opts.columns.map(function (column, index) {
        return {
          key: column.key,
          label: column.label,
          prio: index + 1,
          w: index ? 180 : 260,
          sort: true,
          cell: function (item) {
            return item[column.key];
          }
        };
      })
    };
  }
  /**
   * more(host, { id, title, items, columns:[{ key, label }], line(item) → html, max, idKey, open(item) })
   * paints up to `max` (3) lines; beyond that a button "and N more" whose popup is a CBList (sort · search · resize) over the same items.
   * idKey: the column that is unique per item (default the first column). open(item): a row of the popup was tapped; the popup closes first.
   */
  function more(host, opts) {
    var items = opts.items || [],
      max = opts.max || MORE_AT,
      line = opts.line || function (item) { return escapeText(item[opts.columns[0].key]); };
    var html = '<ul class="lk-lines">' + items.slice(0, max).map(function (item) { return '<li>' + line(item) + '</li>'; }).join('') + '</ul>';
    if (items.length > max) {
      html += '<button data-cbsid="SCR042-B02" type="button" class="lk-more" data-testid="lk-more-' + escapeText(opts.id) + '">and ' + (items.length - max) + ' more</button>';
    }
    host.innerHTML = html;
    var button = host.querySelector('.lk-more');
    if (button)
      button.onclick = function () {
        var shown = popup(opts.title, function (body) {
          if (!root.CBList) {
            body.textContent = 'The list could not open. Reload the page and try again.';
            return;
          }
          root.CBList.mount(body, listOptions(opts, items, shown));
        });
      };
  }

  /* ── CMP061 INITIALS BADGE: a round badge for a named payee (initials on one of six tints, picked from the name) or, for a category (a tax office, a power bill, a bank), a plain line icon.
        No logos, never a person's photo; CBAvatar (CMP048) stays the account menu. The six tints are the classes lk-bd-0..5 in lab-kit.css: no style=. ── */
  var BADGE_ICONS = {
    bolt: 'M13 2 4 14h6l-1 8 9-12h-6z',
    phone: 'M7 2h10v20H7zM11 18h2',
    gov: 'M3 10 12 4l9 6M5 10v8M10 10v8M14 10v8M19 10v8M3 20h18',
    bank: 'M3 10 12 4l9 6M5 20h14M6 10v7M12 10v7M18 10v7',
    cash: 'M3 7h18v10H3zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
    card: 'M3 6h18v12H3zM3 10h18',
    home: 'M4 11 12 4l8 7v9H4z',
    who: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21c1-5 15-5 16 0'
  };
  /** the tint (0..5) of a name: the same name is always the same colour, on every page */
  function tintOf(name) {
    var sum = 7;
    String(name || '').split('').forEach(function (letter) {
      sum = (sum * 31 + letter.charCodeAt(0)) >>> 0;
    });
    return sum % 6;
  }
  /** badge({ name, icon }) → html: initials of the name (first letters of up to two words) unless an icon is asked for */
  function badge(opts) {
    var icon = opts.icon && BADGE_ICONS[opts.icon];
    if (icon)
      return '<span class="lk-bd lk-bd-ic" data-cbsid="CMP061-D01" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="' + icon + '"/></svg></span>';
    var letters = String(opts.name || '?').trim().split(/s+/).slice(0, 2).map(function (word) { return word.charAt(0); }).join('').toUpperCase();
    return '<span class="lk-bd lk-bd-' + tintOf(opts.name) + '" data-cbsid="CMP061-D01" aria-hidden="true">' + escapeText(letters) + '</span>';
  }
  /* ── CMP060 FIGURE CARD: a label, one big figure and (optional) a progress line. The figure arrives as text the caller made with the ONE money formatter (its currency in it, CUR-1);
        the bar is the existing .lk-bar (CMP021 family), never a second one. opts: { label, value (text), note, done, total, good, line (label and figure on ONE line: the slim tile of the Bank band), loud (the one figure that asks for attention: amber) } ── */
  function figure(opts) {
    var bar = '';
    if (opts.total) {
      var percent = Math.round((opts.done / opts.total) * 100);
      bar = '<div class="lk-bar" role="progressbar" aria-valuemin="0" aria-valuemax="' + opts.total + '" aria-valuenow="' + opts.done + '" aria-label="' + escapeText(opts.note || '') + '"><i style="width:' + percent + '%"></i></div>';
    }
    return (
      '<div class="lk-fig' + (opts.good ? ' lk-fig-good' : '') + (opts.line ? ' lk-fig-line' : '') + (opts.loud ? ' lk-fig-loud' : '') + '" data-cbsid="CMP060-D01"><span class="lk-fig-l">' + escapeText(opts.label) + '</span><b class="lk-fig-v">' + escapeText(opts.value) + '</b>' +
      bar + (opts.note ? '<span class="lk-progress-line">' + escapeText(opts.note) + '</span>' : '') + '</div>'
    );
  }

  /* ── CMP064 STATUS ICON: the state of a list row as ONE small icon, never a word on every row (Athi 15 Nov, W15-13). The shape says it without colour: a tick = settled, a filled dot = ready,
        a ring = needs you, a tick in a ring = just answered. The word is always there as the icon's accessible name (role img, aria-label) and as the tooltip, so the icon is never the only carrier of the meaning.
        statusIcon({ status: 'in'|'ready'|'need'|'done'|'books'|'lock', name }) → html ── */
  var STATUS_ICONS = {
    in: '<path d="M5 12.5 10 17.5 19 7"/>',
    ready: '<circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/>',
    need: '<circle cx="12" cy="12" r="6"/>',
    done: '<circle cx="12" cy="12" r="8"/><path d="M8.5 12.5 11 15l4.5-5.5"/>',
    books: '<path d="M6 7h12M6 12h12M6 17h8"/>',
    lock: '<rect x="6" y="11" width="12" height="8" rx="2"/><path d="M9 11V8a3 3 0 0 1 6 0v3"/>' /* a month that is locked: the line cannot be added until it is reopened (W15-85) */
  };
  function statusIcon(opts) {
    var shape = STATUS_ICONS[opts.status] || STATUS_ICONS.need,
      name = escapeText(opts.name || '');
    return (
      '<span class="lk-st lk-st-' + escapeText(STATUS_ICONS[opts.status] ? opts.status : 'need') + '" data-cbsid="CMP064-D01" data-state="' + escapeText(opts.status || '') + '" role="img" aria-label="' + name + '" title="' + name + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      shape + '</svg></span>'
    );
  }

  root.CBLabKit = { badge: badge, figure: figure, statusIcon: statusIcon, tintOf: tintOf, LABS: LABS, MORE_AT: MORE_AT, plain: plain, addWords: addWords, notSetUp: notSetUp, reason: reason, tag: tag, progress: progress, groups: groups, readiness: readiness, groupBy: groupBy, more: more, popup: popup, confirm: confirm, promise: promise };
})(typeof window !== 'undefined' ? window : globalThis);
