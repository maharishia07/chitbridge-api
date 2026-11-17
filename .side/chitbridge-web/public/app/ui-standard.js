/**
 * ui-standard.js — THE UI STANDARD PAGE (UX-137): every component of the standard action set, drawn by the real ui.js factories,
 * with the popups, the icons, the tokens and the language switch. Nothing here is a picture of a component.
 *
 * OWNS       the page's model (what rows exist, the size presets, the census of old spellings, the translation coverage),
 *            the page chrome (tabs, switches) and the repaint when a switch changes. It owns no component: it calls ui.action / ui.dialog.
 * CALLED BY  public/ui-standard.html (screen UIS001). Loaded AFTER helpers.js, accounts-shell.js (tx, CBAction, CBConfirm, toast),
 *            the string packs and ui.js.
 * READS      public/app/ui-waves.json (the Waves section: one row per wave, the numbers updated in that one file), ui.components (CMP codes, labels, verbs), CBSTR (the packs), the CSS custom properties of the page (live), getComputedStyle.
 * WRITES     only this page's own DOM. It calls no api, reads no session or token, and stores nothing (no localStorage, no cookie).
 * CARD       29-qa-test-tooling-ux-locale-and-design-system/ui-action-set
 * FLOW       load -> paint() -> a switch sets state -> paint() again (the same strings run through tx() again: no reload).
 *
 * NOTE       ui.dialog needs modal() and closeModal(), which only app.html defines. This page defines the same small host (modal below);
 *            moving it to a shared file is a ui.js / accounts-shell change and is listed in the PR, not made here.
 */
var CBUiStandard = (function () {
  var SCREEN = 'UIS001';
  var LANGS = [['en', 'English', 'ltr'], ['ta', 'தமிழ்', 'ltr'], ['hi', 'हिन्दी', 'ltr'], ['ar', 'العربية', 'rtl'], ['fr', 'Français', 'ltr']];
  var PACK_LANGS = ['ta', 'hi', 'ar', 'fr'];
  /** the size presets: the four tokens the action set draws from (px). 'small' is below the 24 px floor on purpose. */
  var PRESETS = {
    standard: { h: 44, pad: 20, radius: 9, font: 14, label: 'Standard' },
    compact: { h: 32, pad: 12, radius: 6, font: 13, label: 'Compact' },
    large: { h: 56, pad: 28, radius: 16, font: 17, label: 'Large' },
    small: { h: 20, pad: 6, radius: 3, font: 11, label: 'Too small' }
  };
  var SCREENS = { this: { label: 'This screen' }, desktop: { label: 'Desktop', w: 1366, h: 768 }, mobile: { label: 'Mobile', w: 390, h: 844 } };
  var TABS = ['components', 'popups', 'icons', 'tokens', 'themes', 'meets', 'before', 'waves'];
  var TAB_LABEL = { components: 'Components', popups: 'Popups', icons: 'Icons', tokens: 'Tokens', themes: 'Across themes', meets: 'Meets the standard', before: 'Before and after', waves: 'Waves' };
  /** the plain line each section opens with: what the standard is and why, in shopkeeper words */
  var TAB_LINE = {
    components: 'Every Save, Cancel or Done in the product is one and the same button, so it looks and works the same on every screen. The code beside it (like CMP001) is its name on a register, the way a bank screen has a code.',
    popups: 'Before anything is posted, sent or paid, the screen asks first and shows how far it reaches: how much, to whom, how many. Cancel sends nothing.',
    icons: 'One sign for one meaning. Today there is no icon font: the signs on buttons are typed characters, and the drawings are a separate set with no codes yet.',
    tokens: 'Colours, corners and sizes live in one place. Change a value and every button follows. The values below are read from this page as it is drawn, not typed in.',
    themes: 'The avatar offers 16 colour themes. Each row is a real theme applied through the avatar code, measured on the real buttons: a red figure is a pair below the accessibility minimum.',
    meets: 'Each rule of the standard in plain words, where it comes from, how this page proves it, and the live result in every one of the 16 themes.',
    waves: 'The work comes in waves, each one making the next smaller. For each wave: what it gives you, how far it has got, and the number before and after. A number not measured yet says measuring.',
    before: 'Counted in our own screens: the same action was written many different ways. Now each one is a single component. Numbers are the count of places that spelled it that way.'
  };
  /** old hand-made spellings found in the census (PM/UX-137-ROLLOUT.md section 3a): [label, sites] */
  var CENSUS = [
    { name: 'close', before: [['Close', 72], ['x', 16], ['X', 14], ['Dismiss', 2], ['close', 2]] },
    { name: 'cancel', before: [['Cancel', 89]] },
    { name: 'save', before: [['Save', 31], ['Save and continue', 1], ['Save & continue', 1]] },
    { name: 'done', before: [['Done', 15], ['Got it', 6], ['OK', 5]] },
    { name: 'back', before: [['‹ Back', 8], ['Back', 7], ['‹', 1], ['arrow', 1], ['arrow back', 1]] },
    { name: 'reload', before: [['Try again', 18], ['Retry', 3], ['Reload', 1]] },
    { name: 'add', before: [['Add', 12], ['+ New', 2], ['+ Add', 2], ['New', 1], ['+ Add a rule', 1], ['+ add section', 1], ['+ add detail', 1], ['add', 1]] },
    { name: 'delete', before: [['Delete', 4]] },
    { name: 'edit', before: [['Edit', 10], ['Change', 10], ['pencil Edit', 3], ['Edit arrow', 1]] },
    { name: 'search', before: [['Search', 2]] },
    { name: 'clear', before: [['clear', 9]] },
    { name: 'notnow', before: [['Not now', 6]] },
    { name: 'help', before: [['?', 3]] },
    { name: 'info', before: [['info glyph', 1]] },
    { name: 'more', before: [['more', 2], ['More', 1], ['ellipsis', 1]] },
    { name: 'screenhelp', before: [['"?" beside a section title (helpQ, app.html), 18 px, no fixed place', 2]] },
    { name: 'home', before: [['⌂ Home link drawn by hand in the shared shell, 26 px wide on a phone', 1]] },
    { name: 'assistant', before: [['💬 Assistant pill drawn by hand with inline style, app.html', 1]] },
    { name: 'menu', before: [['☰ drawer button in the main top bar, 32 x 29 px, no component code', 1]] },
    { name: 'legend', before: [['key button in the main top bar, 34 px, no component code', 1]] },
    { name: 'activity', before: [['bell button in the main top bar, 34 px, no component code', 1]] },
    { name: 'choice', before: [['Open · Away · Closed as a plain select, 30 px high, app.html', 1]] }
  ];
  /** the component rows: which factory, the object the accessible name carries, and the options a real mount would give it */
  /* a mock record states its own currency (N1: no page guesses India's): USD, a code no shop here is assumed to hold */
  var MOCK = { amount: 1180, currency: 'USD', recipients: ['Asha Traders', 'Mohan Stores', 'Kavya Foods'], lines: 2 };
  var ROWS = [
    { name: 'save', variant: 'preference', object: 'settings', opts: { effect: 'preference' } },
    { name: 'save', variant: 'commit', object: 'bill', opts: { effect: 'commit' }, confirmKind: 'post' },
    { name: 'cancel', object: 'edit', opts: {} },
    { name: 'done', object: 'step', opts: {} },
    { name: 'close', object: '', opts: {} },
    { name: 'back', object: '', opts: {} },
    { name: 'add', object: 'row', opts: {} },
    { name: 'remove', object: 'row', opts: {}, confirmKind: 'remove' },
    { name: 'reload', object: 'list', opts: {} },
    { name: 'open', object: 'guide', opts: {} },
    { name: 'delete', object: 'supplier', opts: {}, confirmKind: 'delete' },
    { name: 'edit', object: 'supplier', opts: {} },
    { name: 'search', object: 'list', opts: {} },
    { name: 'clear', object: 'search', opts: {} },
    { name: 'notnow', object: 'tip', opts: {} },
    { name: 'help', object: 'page', opts: {} },
    { name: 'info', object: 'field', opts: {} },
    { name: 'more', object: 'row', opts: {} },
    { name: 'screenhelp', object: '', opts: {} }
  ];
  /* the components added after the dialog row's literal mount (U115) was fixed: drawn after it, from U120, so no mount is used twice */
  var SHELL_ROWS = [
    { name: 'home', object: '', opts: { href: '#', display: 'icon+label', size: 'compact', surface: 'shell' } },
    { name: 'assistant', object: '', opts: { surface: 'float' } },
    { name: 'menu', object: '', opts: { display: 'icon', surface: 'topbar' } },
    { name: 'legend', object: '', opts: { display: 'icon+label', size: 'compact', surface: 'topbar' } },
    { name: 'activity', object: '', opts: { display: 'icon+label', size: 'compact', surface: 'topbar' } },
    { name: 'background', object: '', opts: {} },
    { name: 'command', object: '', opts: { label: 'Tick all shown', verb: 'TICK', effect: 'none', size: 'compact' } }
  ];
  var SHELL_ROWS_FIRST_MOUNT = 125;
  var TOKENS = [
    ['--act-h', 'Button height'], ['--act-pad', 'Side padding'], ['--act-radius', 'Corner radius'], ['--act-font', 'Text size'],
    ['--act-weight', 'Text weight'], ['--accent', 'Fill of the main button'], ['--accent-ink', 'Text on that fill'],
    ['--accent-text', 'Text of the quiet button'], ['--line', 'Border of the quiet button'], ['--focus-ring', 'Focus ring (the theme\'s body ink)'], ['--focus-halo', 'Gap around the ring (the surface)'], ['--card', 'Surface']
  ];
  var ILLUSTRATIONS = [
    ['compose-author.svg', 'Compose / author'], ['draft.svg', 'Draft'], ['chit-bridged.svg', 'Chit bridged'], ['status-update.svg', 'Status update'],
    ['archive-sunset.svg', 'Archive (sunset)'], ['message-update.svg', 'Message update'], ['forward.svg', 'Forward'], ['attachment.svg', 'Attachment'],
    ['priority-sla.svg', 'Priority / SLA'], ['dispute-flag.svg', 'Dispute flag'], ['empty-inbox.svg', 'Empty list'], ['no-results.svg', 'No results']
  ];
  var state = { lang: 'en', screen: 'this', size: 'standard', overlay: false, tab: 'components' };
  /** the page's switches that simply set one state key; the 24 px overlay is the only one with its own rule */
  var STATE_KEYS = ['screen', 'size', 'tab'];
  /** the button codes of the page (Option B): tools B01-B08, View B09, Section select B10, section list B11-B17, links B18-B19, View sheet B20-B27 */
  var CODE = { screen: 1, size: 4, overlay: 8, view: 9, section: 10, item: 11, standards: 18, home: 19, sheet: 20 };
  function codeOf(number) {
    return SCREEN + '-B' + String(number).padStart(2, '0');
  }
  var pageFrame = null;
  /** one drawing per section for the frame's sidebar (svg path data, 24 px box) */
  var SECTION_ICON = {
    components: 'M4 6h16v5H4zM4 14h10v4H4z',
    popups: 'M5 5h14v10H9l-4 4z',
    icons: 'M12 4l2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8z',
    tokens: 'M12 3a9 9 0 1 0 0 18c1.5 0 2-1 1.5-2s0-2 1.5-2h2a3 3 0 0 0 3-3c0-5-4-11-8-11z',
    themes: 'M12 3v18M3 12h18M5 5l14 14M19 5L5 19',
    meets: 'M5 12l4 4 10-10',
    before: 'M4 5h7v14H4zM13 5h7v14h-7z',
    waves: 'M3 18c3 0 3-12 6-12s3 12 6 12 3-12 6-12'
  };
  var counters = { mount: 0, control: 0 };
  /** the waves data (public/app/ui-waves.json), read once by loadWaves(); null until it arrives */
  var wavesData = null;
  /* ── words: the page's own strings through tx(), the language held in the page (never in storage) ── */
  function words(text) {
    return tx(text);
  }
  function formatWords(text, values) {
    return txf(text, values);
  }
  function mountCode() {
    counters.mount += 1;
    return SCREEN + '-U' + String(counters.mount).padStart(2, '0');
  }
  /** which of the four packs hold this exact text (the English is the key); a glyph-only name needs none */
  function translatedIn(text) {
    return PACK_LANGS.filter(function (lang) {
      return !!(window.CBSTR[lang] && window.CBSTR[lang][text]);
    });
  }
  /** one component's translation coverage: its label (the accessible name) and its visible text, per pack */
  function coverageOf(component) {
    var label = translatedIn(component.label);
    var shown = component.nameOnly ? PACK_LANGS : translatedIn(component.shown);
    return { label: label, shown: shown, missing: PACK_LANGS.filter(function (lang) { return label.indexOf(lang) < 0 || shown.indexOf(lang) < 0; }) };
  }
  /** WCAG contrast ratio of two css rgb() strings */
  function channels(colourText) {
    if (/^#/.test(String(colourText).trim())) colourText = hexToRgb(String(colourText).trim());
    var found = String(colourText).match(/[\d.]+/g) || [0, 0, 0];
    return found.slice(0, 3).map(Number);
  }
  function luminance(colourText) {
    var parts = channels(colourText).map(function (value) {
      var unit = value / 255;
      return unit <= 0.03928 ? unit / 12.92 : Math.pow((unit + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
  }
  function contrastRatio(first, second) {
    var lighter = Math.max(luminance(first), luminance(second)), darker = Math.min(luminance(first), luminance(second));
    return (lighter + 0.05) / (darker + 0.05);
  }
  /* ── the dialog host ui.dialog needs (same classes as app.html's modal) ── */
  function closeModal() {
    var host = document.getElementById('modalhost');
    if (host) host.innerHTML = '';
  }
  function modal(html, wide) {
    var host = document.getElementById('modalhost');
    host.innerHTML =
      '<div class="mover" data-testid="gal-mover"><div class="modal' + (wide ? ' wide' : '') + '" role="dialog" data-pop="POP142" aria-modal="true">' +
      '<div class="mxrow">' + ui.action('close', { mount: SCREEN + '-D01-U01', onPress: closeModal, testid: 'gal-dialog-x' }) + '</div>' + html + '</div></div>';
    host.querySelector('.mover').addEventListener('click', function (event) {
      if (event.target.classList.contains('mover')) closeModal();
    });
  }
  function openExampleDialog() {
    ui.dialog({
      pop: 'POP151',
      mount: SCREEN + '-D01-U02',
      title: 'Example dialog',
      body: '<p>' + esc(words('This is the one dialog shell. Its buttons are the standard set.')) + '</p>',
      actions: [
        { name: 'cancel', options: { mount: SCREEN + '-D01-U03', testid: 'gal-dialog-cancel' } },
        { name: 'done', options: { mount: SCREEN + '-D01-U04', onPress: closeModal, testid: 'gal-dialog-done' } }
      ]
    });
  }
  /** the reach of a commit: amount with its currency, who, and how many; shown before anything is sent */
  function reachConfirm(kind) {
    if (kind === 'remove') {
      return { title: words('Remove this supplier?'), body: '<p>' + esc(formatWords('Remove {name} from this list?', { name: MOCK.recipients[0] })) + '</p>', yes: words('Remove') };
    }
    if (kind === 'delete') {
      return { title: words('Delete this supplier?'), body: '<p>' + esc(formatWords('Delete {name} for good? This cannot be undone.', { name: MOCK.recipients[0] })) + '</p>', yes: words('Delete'), danger: true };
    }
    var amount = fmtMoney(MOCK.amount, MOCK.currency) + ' (' + MOCK.currency + ')';
    return {
      title: words('Post this bill?'),
      body: '<p>' + esc(formatWords('Post this bill for {amount} to {count} recipients?', { amount: amount, count: MOCK.recipients.length })) +
        '</p><p>' + esc(MOCK.recipients.join(' · ')) + '</p>',
      yes: words('Post bill'),
      danger: false
    };
  }
  /** what the toast says for each press: the result in words, in the chosen language; a remove also offers Undo in the same bar */
  var RESULTS = { post: 'Bill posted', remove: 'Supplier removed', delete: 'Supplier deleted', save: 'Settings saved' };
  /**
   * CBAction.run says a bare "Done" when the press returns (ui.js passes it no sentence), so the result is said one tick later and replaces it.
   * ui.js should pass done / outcome through to CBAction.run; until then this is the page's own way to show the standard.
   */
  function resultToast(kind) {
    setTimeout(function () {
      var undo = kind === 'remove' ? function () { toast(words('Supplier restored')); } : null;
      toast(words(RESULTS[kind]), undo);
    }, 0);
  }
  function pressFor(kind) {
    return function () {
      resultToast(kind);
    };
  }

  /* ── the component rows ── */
  /** what each non-default state adds to the options: a role gate, busy, or the static hover / focus / pressed look */
  function stateExtras(which) {
    var extras = {
      disabled: { role: { ok: false, why: words('Disabled') } },
      busy: { busy: true },
      hover: { data: { demo: 'hover' } },
      focus: { data: { demo: 'focus' } },
      pressed: { data: { demo: 'pressed' } }
    };
    return extras[which] || {};
  }
  function stateOptions(row, which) {
    var base = Object.assign({ mount: mountCode(), testid: 'gal-' + ui.components[row.name].code + '-' + (row.variant || 'std') + '-' + which }, row.opts, stateExtras(which));
    if (row.object) base.object = row.object;
    if (row.confirmKind) base.confirm = reachConfirm(row.confirmKind);
    if (which === 'default' && (row.confirmKind || row.opts.effect)) base.onPress = pressFor(row.confirmKind || 'save');
    return base;
  }
  var STATES = ['default', 'hover', 'focus', 'pressed', 'disabled', 'busy'];
  function stateCell(row, which) {
    /* where-used: out-of-scope loop: one call site, many instances; the mount comes from the counter */
    return '<figure class="st"><div class="slot">' + ui.action(row.name, stateOptions(row, which)) + '</div><figcaption>' + esc(words(which.charAt(0).toUpperCase() + which.slice(1))) + '</figcaption></figure>';
  }
  function coverageHTML(component) {
    var coverage = coverageOf(component);
    var ok = coverage.missing.length === 0;
    var bits = PACK_LANGS.map(function (lang) {
      return '<span class="' + (coverage.missing.indexOf(lang) < 0 ? 'yes' : 'no') + '">' + lang + (coverage.missing.indexOf(lang) < 0 ? ' ✓' : ' ✗') + '</span>';
    }).join(' ');
    return '<span class="cov' + (ok ? '' : ' gap') + '" data-testid="gal-cov-' + component.code + '" title="keyed: no (tx English text today; CMPnnn.label keys wait for ux137-i18n-keys)">' + bits + '</span>';
  }
  function componentRow(row) {
    var component = ui.components[row.name];
    var fcode = component.verb + ' ' + (row.object || 'dialog');
    return '<section class="crow" data-testid="gal-row-' + component.code + (row.variant ? '-' + row.variant : '') + '">' +
      '<div class="cid"><span class="chip" data-cbsid="' + SCREEN + '" data-testid="gal-code">' + component.code + '</span>' +
      '<b>' + esc(words(component.label)) + (row.variant ? ' · ' + esc(row.variant) : '') + '</b>' +
      '<span class="meta" data-testid="gal-fcode"><span class="mono">' + component.element + '</span> · fcode <span class="mono">' + esc(fcode) + '</span> · ' + esc(component.tone) + '</span>' +
      coverageHTML(component) + '</div><div class="states">' + STATES.map(function (which) { return stateCell(row, which); }).join('') + '</div></section>';
  }
  function dialogRow() {
    var component = ui.components.dialog;
    return '<section class="crow" data-testid="gal-row-CMP002"><div class="cid"><span class="chip" data-testid="gal-code">CMP002</span><b>' + esc(words('Example dialog')) + '</b>' +
      '<span class="meta" data-testid="gal-fcode"><span class="mono">' + component.element + '</span> · fcode <span class="mono">' + esc(component.verb) + ' dialog</span></span></div>' +
      '<div class="states"><figure class="st"><div class="slot">' + ui.action('open', { mount: SCREEN + '-U115', object: 'dialog', onPress: openExampleDialog, testid: 'gal-open-dialog' }) +
      '</div><figcaption>ui.dialog()</figcaption></figure></div></section>';
  }
  /* CMP020 progress: the three levels, each a real button running a fake wait (no api). The times are short so the demo is quick to try. */
  var DEMO_QUICK_MS = 150, DEMO_SLOW_MS = 2500, DEMO_STEP_MS = 800;
  var DEMO_STEP_LINES = ['Reading the file', 'Checking each row', 'Saving the rows', 'Almost done'];
  function wait(milliseconds) {
    return new Promise(function (resolve) { setTimeout(resolve, milliseconds); });
  }
  /** levels 1 and 2: the press already runs through CBAction (busy, one press); the progress component adds the spinner and words after its delay */
  function demoInline(milliseconds) {
    return function (button) {
      var busy = ui.progress.inline(button, words('Saving…'));
      return wait(milliseconds).then(busy.stop);
    };
  }
  /** level 3: a panel with "Step n of m" and a plain line; Cancel stops the fake import (safe: nothing was written) */
  function demoPanel() {
    var cancelled = false;
    var importProgress = ui.progress.start({ mount: SCREEN + '-D02-U01', label: 'Importing your file', steps: DEMO_STEP_LINES.length, line: words(DEMO_STEP_LINES[0]), delay: 0, cancel: function () { cancelled = true; } });
    DEMO_STEP_LINES.reduce(function (chain, line, index) {
      return chain.then(function () { return wait(DEMO_STEP_MS); }).then(function () {
        if (cancelled) return;
        if (index === DEMO_STEP_LINES.length - 1) importProgress.done();
        else importProgress.step(words(DEMO_STEP_LINES[index + 1]));
      });
    }, Promise.resolve());
  }
  /* CMP026 batch progress: forty mock chits on a timer (no api), the 17th fails, so the failed count and the list show */
  var DEMO_BATCH_TICK_MS = 120, DEMO_BATCH_FAIL_AT = 5;
  /** one demo run: eight items open the centre panel, forty the corner tray (every batch starts in the panel and moves to the tray after ui.progress.batch.trayAfterMs, or at once with Run in background; the tray class starts in the tray); the 5th item fails so the count and the list show */
  function demoBatch(total, mount, speed) {
    return function () {
      var batch = ui.progress.batch({ mount: mount, label: 'Assigning chits', total: total, unit: 'assigned', speed: speed, delay: 0, cancel: function () {} });
      function next(index) {
        if (batch.cancelled()) return;
        if (index > total) { batch.finish(); return; }
        if (index === DEMO_BATCH_FAIL_AT) batch.failed([formatWords('Chit {n}', { n: index })], words('No reply from the demo'));
        else batch.done();
        setTimeout(function () { next(index + 1); }, DEMO_BATCH_TICK_MS);
      }
      next(1);
    };
  }
  function progressCell(caption, button) {
    return '<figure class="st"><div class="slot">' + button + '</div><figcaption>' + esc(words(caption)) + '</figcaption></figure>';
  }
  function progressRow() {
    var component = ui.components.progress;
    return '<section class="crow" data-testid="gal-row-CMP020"><div class="cid"><span class="chip" data-testid="gal-code">CMP020</span><b>' + esc(words('Progress')) + '</b>' +
      '<span class="meta" data-testid="gal-fcode"><span class="mono">' + component.element + '</span> · fcode <span class="mono">OPEN progress</span> · parts <span class="mono">CMP021 ' +
      esc(ui.components.progressbar.label) + '</span> <span class="mono">CMP022 ' + esc(ui.components.spinner.label) + '</span></span></div><div class="states">' +
      progressCell('Quick: nothing shows', ui.action('save', { mount: SCREEN + '-U116', object: 'reply', effect: 'preference', testid: 'gal-progress-quick', onPress: demoInline(DEMO_QUICK_MS) })) +
      progressCell('Slow: the button goes busy', ui.action('save', { mount: SCREEN + '-U117', object: 'settings', effect: 'preference', testid: 'gal-progress-slow', onPress: demoInline(DEMO_SLOW_MS) })) +
      progressCell('Long: a panel with steps', ui.action('open', { mount: SCREEN + '-U118', object: 'import', testid: 'gal-progress-long', onPress: demoPanel })) +
      '</div></section>';
  }
  /** CMP025 Choice: the segmented choice in its three values; a press moves the selection (no api, nothing is saved) */
  function choiceRow() {
    var component = ui.components.choice;
    var group = ui.choice({ mount: SCREEN + '-U140', label: 'Shop status', value: 'open', size: 'compact', testid: 'gal-choice', items: [{ value: 'open', label: 'Open' }, { value: 'away', label: 'Away' }, { value: 'closed', label: 'Closed' }], onChange: function () {} });
    return '<section class="crow" data-testid="gal-row-CMP025"><div class="cid"><span class="chip" data-testid="gal-code">CMP025</span><b>' + esc(words('Choice')) + '</b>' +
      '<span class="meta" data-testid="gal-fcode"><span class="mono">' + component.element + '</span> · fcode <span class="mono">' + esc(component.verb) + ' choice</span></span></div>' +
      '<div class="states"><figure class="st"><div class="slot">' + group + '</div><figcaption>ui.choice()</figcaption></figure></div></section>';
  }
  function batchRow() {
    var component = ui.components.batch;
    return '<section class="crow" data-testid="gal-row-CMP026"><div class="cid"><span class="chip" data-testid="gal-code">CMP026</span><b>' + esc(words('Batch progress')) + '</b>' +
      '<span class="meta" data-testid="gal-fcode"><span class="mono">' + component.element + '</span> · fcode <span class="mono">OPEN batch progress</span> · parts <span class="mono">CMP021 ' + esc(ui.components.progressbar.label) + '</span> <span class="mono">CMP027 ' + esc(ui.components.batchtray.label) + '</span></span></div><div class="states">' +
      progressCell('Try 8 items', ui.action('open', { mount: SCREEN + '-U119', object: 'batch', testid: 'gal-progress-batch-panel', onPress: demoBatch(8, SCREEN + '-D03-U01') })) +
      progressCell('Try 40 items', ui.action('open', { mount: SCREEN + '-U120', object: 'batch tray', testid: 'gal-progress-batch-tray', onPress: demoBatch(40, SCREEN + '-D04-U01') })) +
      progressCell('Tray class: 3 items, always the tray', ui.action('open', { mount: SCREEN + '-U176', object: 'tray batch', testid: 'gal-progress-batch-always-tray', onPress: demoBatch(3, SCREEN + '-D06-U01', 'tray') })) +
      '</div></section>';
  }
  /** CMP045, CMP033..CMP039 the list control's own components: a row each, listing the element codes it writes (the unit draws them itself, so no live control here) */
  var LIST_ROWS = [
    ['listfield', 'CMP045-I01 search, I02 date, I03 tick'], ['listopener', 'CMP033-B01 opener, D01 popover, M01 menu choice'], ['listtoggle', 'CMP034-B01 pressed toggle'],
    ['listselect', 'CMP035-S01 select'], ['listtab', 'CMP036-K01 saved-view tab'], ['listcommand', 'CMP037-B01 CSV, B02 reset columns, B03 select all, B04 bulk action, B05 show more'],
    ['listrowaction', 'CMP038-B01 row action'], ['listcolumn', 'CMP039-B01 sort, B02 resize, B03 move column'],
    ['bookfield', 'CMP040-I01 text, I02 date, I03 tick, T01 free text'], ['bookselect', 'CMP041-S01 select'], ['bookaction', 'CMP042-B01..B23 the books commands, P01 row tools'],
    ['booktab', 'CMP043-K01 tab, K02 ledger tree item'], ['booklink', 'CMP044-C01 day bills, C02 chit, C03 reversal'],
    ['field', 'CMP055-I01 text-like, I02 date and time, I03 checkbox, I04 file, T01 long text (ui.field; CMP040 and CMP045 are aliases)'],
    ['select', 'CMP056-S01 select (ui.select; CMP035 and CMP041 are aliases)'], ['figure', 'CMP060-D01 figure card: a label, one figure with its currency, an optional progress line', 'CBLabKit.figure (lab-kit.js)'], ['badge', 'CMP061-D01 initials badge: a named payee\'s initials on one of six tints, or a category icon', 'CBLabKit.badge (lab-kit.js)'], ['statusicon', 'CMP064-D01 status icon: the state of a list row as one shape (tick, dot, ring), its word always there for a screen reader', 'CBLabKit.statusIcon (lab-kit.js)'], ['bankband', 'CMP065-D01 bank statement band: the account, the period, the currency said once, the right-account line, three slim tiles, the lines to go and a progress bar', 'CBBankBand.html (bank-band.js)']
  ];
  function listRows() {
    return LIST_ROWS.map(function (entry) {
      var component = ui.components[entry[0]];
      return '<section class="crow" data-testid="gal-row-' + component.code + '"><div class="cid"><span class="chip" data-testid="gal-code">' + component.code + '</span><b>' + esc(words(component.label)) + '</b>' +
        '<span class="meta" data-testid="gal-fcode"><span class="mono">' + component.element + '</span> · fcode <span class="mono">' + esc(component.verb) + '</span></span></div>' +
        '<div class="states"><figure class="st"><div class="slot"><span class="mono">' + esc(entry[1]) + '</span></div><figcaption>' + esc(entry[2] || 'CBList (list-ctl.js)') + '</figcaption></figure></div></section>';
    }).join('');
  }
  /** CMP032 Batch job note: every state of a saved job in words, each its own standard text key (the batch bar itself is CMP026, the corner tray CMP027) */
  function batchNoteRow() {
    var component = ui.components.batchnote, batch = ui.progress.batch;
    var sample = { done: 12, total: 40, left: 28, failed: 0, seconds: 15 };
    var cells = batch.noteKinds.map(function (kind) {
      var values = kind === 'doneAll' ? { done: 40 } : kind === 'doneFailed' ? { done: 38, failed: 2 } : kind === 'stopped' ? { done: 20, left: 20 } : sample;
      return '<figure class="st"><div class="slot"><p class="note" data-testid="gal-note-' + kind + '">' + esc(batch.noteWords(kind, values)) + '</p></div><figcaption><span class="mono">' + component.code + '.' + kind + '</span></figcaption></figure>';
    }).join('');
    return '<section class="crow" data-testid="gal-row-CMP032"><div class="cid"><span class="chip" data-testid="gal-code">CMP032</span><b>' + esc(words('Batch job note')) + '</b>' +
      '<span class="meta" data-testid="gal-fcode"><span class="mono">' + component.element + '</span> · fcode <span class="mono">OPEN batch job note</span> · under <span class="mono">CMP026 ' + esc(ui.components.batch.label) + '</span> and <span class="mono">CMP027 ' + esc(ui.components.batchtray.label) + '</span></span></div><div class="states">' + cells + '</div></section>';
  }
  function componentsPanel() {
    var rows = ROWS.map(componentRow);
    var dialog = dialogRow();
    counters.mount = SHELL_ROWS_FIRST_MOUNT;
    rows.splice(1, 0, dialog);
    rows = rows.concat(SHELL_ROWS.map(componentRow));
    rows.push(choiceRow());
    rows.push(progressRow());
    rows.push(batchRow());
    rows.push(listRows());
    rows.push(batchNoteRow());
    return rows.join('');
  }

  /* ── popups ── */
  function popupRow(title, note, button) {
    return '<section class="crow"><div class="cid"><b>' + esc(words(title)) + '</b><span class="meta">' + esc(note) + '</span></div><div class="states"><figure class="st"><div class="slot">' + button + '</div></figure></div></section>';
  }
  function popupsPanel() {
    return popupRow('Example dialog', 'ui.dialog() · CMP002 · modal shell, X, Cancel and Done',
      /* where-used: out-of-scope counter mount: restarts at U01 on every tab, so the code repeats across tabs */
      ui.action('open', { mount: mountCode(), object: 'dialog', onPress: openExampleDialog, testid: 'gal-open-dialog-2' })) +
      popupRow('Post this bill?', 'CMP001 commit · CBConfirm · amount + currency, recipients, count',
        /* where-used: out-of-scope counter mount: restarts at U01 on every tab, so the code repeats across tabs */
        ui.action('save', { mount: mountCode(), object: 'bill', effect: 'commit', confirm: reachConfirm('post'), onPress: pressFor('post'), testid: 'gal-open-commit' })) +
      popupRow('Remove this supplier?', 'CMP008 commit · CBConfirm · always asks',
        /* where-used: out-of-scope counter mount: restarts at U01 on every tab, so the code repeats across tabs */
        ui.action('remove', { mount: mountCode(), object: 'supplier', confirm: reachConfirm('remove'), onPress: pressFor('remove'), testid: 'gal-open-remove' })) +
      '<p class="note">CBConfirm still draws its own Cancel and OK buttons (accounts-shell.js), not CMP003 and CMP004: found, listed for its owner.</p>';
  }

  /* ── icons ── */
  function iconsPanel() {
    var glyphs = Object.keys(ui.components).filter(function (name) {
      var component = ui.components[name];
      return component.shown && /^[^A-Za-z]/.test(component.shown);
    }).map(function (name) {
      var component = ui.components[name];
      return '<figure class="ic" data-testid="gal-icon-' + component.code + '"><div class="glyph" aria-hidden="true">' + esc(component.shown) + '</div><figcaption><b>' + esc(words(component.label)) +
        '</b><span class="mono">' + component.element + '</span></figcaption></figure>';
    }).join('');
    var drawings = ILLUSTRATIONS.map(function (item) {
      return '<figure class="ic" data-testid="gal-art"><img src="/illustrations/' + item[0] + '" alt="" loading="lazy" width="96" height="64"><figcaption><b>' + esc(item[1]) +
        '</b><span class="mono">' + item[0] + '</span></figcaption></figure>';
    }).join('');
    return '<p class="note" data-testid="gal-icon-rule">Rule for the icon set (UX-140): draw every icon in currentColor, so it follows each theme, the quiet and busy states and Dark. The typed signs below do (they are text); the drawings keep their own fixed palette and do not.</p><h3>' + esc(words('Icons')) + ' · typed signs (ui.js ACTION_SET)</h3><div class="icgrid">' + glyphs + '</div>' +
      '<h3>Drawings · public/illustrations (no code yet)</h3><div class="icgrid">' + drawings + '</div>';
  }

  /* ── tokens: read live ── */
  function tokenRow(token) {
    var value = getComputedStyle(document.documentElement).getPropertyValue(token[0]).trim();
    var isColour = /^#|^rgb/.test(value);
    return '<tr data-testid="gal-token"><td class="mono">' + token[0] + '</td><td>' + esc(words(token[1])) + '</td><td class="mono">' +
      (isColour ? '<span class="sw" style="background:' + esc(value) + '"></span>' : '') + esc(value) + '</td></tr>';
  }
  function tokensPanel() {
    return '<table class="tok"><thead><tr><th>Token</th><th>' + esc(words('What it sets')) + '</th><th>' + esc(words('Value')) + '</th></tr></thead><tbody>' + TOKENS.map(tokenRow).join('') + '</tbody></table>' +
      '<h3>Focus ring across the 16 themes</h3><div id="focusbox" data-testid="gal-focus"></div>' +
      '<h3>' + esc(words('Type')) + '</h3><div id="typebox" data-testid="gal-type"></div>' +
      '<h3>' + esc(words('Measured')) + '</h3><div class="meas">' +
      /* where-used: out-of-scope counter mount: restarts at U01 on every tab, so the code repeats across tabs */
      ui.action('done', { mount: mountCode(), object: 'step', testid: 'gal-measure-primary' }) + ' ' +
      /* where-used: out-of-scope counter mount: restarts at U01 on every tab, so the code repeats across tabs */
      ui.action('cancel', { mount: mountCode(), object: 'edit', testid: 'gal-measure-quiet' }) + '</div><div id="measure" data-testid="gal-measure"></div>';
  }
  function paintMeasure() {
    var host = document.getElementById('measure');
    if (!host) return;
    var scale = currentScale();
    var lines = [['gal-measure-primary', 'Done'], ['gal-measure-quiet', 'Cancel']].map(function (pair) {
      var button = document.querySelector('[data-testid="' + pair[0] + '"]');
      var style = getComputedStyle(button), box = button.getBoundingClientRect();
      var fill = style.backgroundColor.slice(-4) === ', 0)' ? getComputedStyle(document.documentElement).getPropertyValue('--card') : style.backgroundColor;
      var ratio = contrastRatio(style.color, /^#/.test(fill.trim()) ? hexToRgb(fill.trim()) : fill);
      return '<div class="mline"><b>' + esc(words(pair[1])) + '</b> ' + Math.round(box.width / scale) + '×' + Math.round(box.height / scale) + ' px · radius ' + style.borderRadius + ' · padding ' + style.paddingLeft +
        ' · font ' + style.fontSize + ' · ' + esc(words('Contrast')) + ' ' + ratio.toFixed(1) + ':1 ' + (ratio >= 4.5 ? 'AA ✓' : 'AA ✗') + '</div>';
    });
    host.innerHTML = lines.join('');
  }
  function hexToRgb(hexText) {
    var value = hexText.replace('#', '');
    if (value.length === 3) value = value.split('').map(function (digit) { return digit + digit; }).join('');
    return 'rgb(' + [0, 2, 4].map(function (start) { return parseInt(value.substr(start, 2), 16); }).join(',') + ')';
  }

  /* ── type: what is actually drawn, measured on real buttons (never declared) ── */
  var SCRIPT_FACES = {
    en: ['Inter', 'Segoe UI', 'Arial'],
    fr: ['Inter', 'Segoe UI', 'Arial'],
    ta: ['Inter', 'Nirmala UI', 'Latha', 'Vijaya', 'Noto Sans Tamil', 'Segoe UI', 'Arial Unicode MS'],
    hi: ['Inter', 'Nirmala UI', 'Mangal', 'Kokila', 'Noto Sans Devanagari', 'Segoe UI', 'Arial Unicode MS'],
    ar: ['Inter', 'Segoe UI', 'Tahoma', 'Arial', 'Noto Naskh Arabic', 'Noto Sans Arabic', 'Times New Roman']
  };
  var MIN_LABEL_PX = 14;
  function probeBox() {
    return document.getElementById('probe');
  }
  function widthOf(sample, stack) {
    var node = document.createElement('span');
    node.style.cssText = 'font:48px/1 ' + stack + ';white-space:nowrap';
    node.textContent = sample;
    probeBox().appendChild(node);
    var width = node.getBoundingClientRect().width;
    node.remove();
    return width;
  }
  /** a face draws the sample only if naming it changes the width against both generic fallbacks (a width probe: document.fonts.check cannot see system faces) */
  function drawsSample(sample, face) {
    var named = '"' + face + '"';
    return widthOf(sample, named + ',monospace') !== widthOf(sample, 'monospace') && widthOf(sample, named + ',serif') !== widthOf(sample, 'serif');
  }
  /** the first face of this page's own stack, then the usual system faces of the script, that has glyphs for the sample */
  function faceThatDraws(lang) {
    var sample = (lang === 'en' ? 'SaveCancelDone' : (window.CBSTR[lang].Save || '') + (window.CBSTR[lang].Cancel || '')).replace(/\s/g, ''); /* no space: a space exists in every face and would pass the probe */
    var ownFaces = getComputedStyle(document.body).fontFamily.split(',').map(function (name) { return name.trim().replace(/^["']|["']$/g, ''); });
    var names = ownFaces.filter(function (name) { return !/^(system-ui|-apple-system|sans-serif|serif|monospace)$/.test(name); }).concat(SCRIPT_FACES[lang]);
    var found = names.filter(function (name, index) { return names.indexOf(name) === index && drawsSample(sample, name); })[0];
    return { sample: sample, face: found || 'a system fallback the page does not name' };
  }
  function faceRowHTML(lang) {
    var drawn = faceThatDraws(lang);
    return '<tr data-testid="gal-face-' + lang + '"><th scope="row">' + lang + '</th><td lang="' + lang + '">' + esc(drawn.sample) + '</td><td class="mono">' + esc(drawn.face) +
      (drawn.face === 'Inter' || /Grotesk|Mono/.test(drawn.face) ? '' : ' ◂ ' + esc(words('not the product face'))) + '</td></tr>';
  }
  /** the real size, weight, line height and face of a rendered button's text (the line box from a Range, so 'normal' is a number) */
  function typeOf(button) {
    var style = getComputedStyle(button), range = document.createRange();
    range.selectNodeContents(button);
    return { face: style.fontFamily.split(',')[0].replace(/["']/g, '').trim(), size: parseFloat(style.fontSize), weight: style.fontWeight, line: range.getBoundingClientRect().height };
  }
  function typeRowHTML(entry) {
    var measured = typeOf(entry.node), small = measured.size < MIN_LABEL_PX;
    return '<tr data-testid="gal-type-row"><th scope="row">' + esc(entry.label) + '</th><td class="mono">' + esc(measured.face) + '</td><td class="' + (small ? 'fail' : '') + '" data-testid="' +
      (small ? 'gal-type-small' : 'gal-type-ok') + '">' + measured.size.toFixed(1) + ' px' + (small ? ' ✗ under ' + MIN_LABEL_PX : '') + '</td><td>' + measured.weight + '</td><td>' + measured.line.toFixed(1) + ' px</td></tr>';
  }
  /** every component's button, then this page's own switches (12 px: a finding, they are not components) */
  function typeEntries() {
    var entries = [];
    document.querySelectorAll('#probe [data-testid^="gal-type-probe-"]').forEach(function (node) {
      var component = ui.components[node.getAttribute('data-testid').split('-')[3]];
      entries.push({ label: component.code + ' ' + words(component.label), node: node });
    });
    var chrome = document.querySelector('#hdr .seg button');
    if (chrome) entries.push({ label: 'UIS001 page switches (not a component)', node: chrome });
    return entries;
  }
  function typeProbesHTML() {
    return ROWS.map(function (row, index) {
      var options = Object.assign({ mount: SCREEN + '-U' + (80 + index), testid: 'gal-type-probe-' + row.name + '-' + index, object: row.object || undefined }, row.opts);
      if (row.confirmKind) options.confirm = reachConfirm(row.confirmKind);
      /* where-used: out-of-scope loop: one call site, many instances; the mount comes from the counter */
      return ui.action(row.name, options);
    }).join('');
  }
  /** the focus ring, which no theme defines: the failing themes per pair, listed here and in the PR (the colour is an engines decision, not picked here) */
  function paintFocus() {
    var host = document.getElementById('focusbox');
    if (!host) return;
    var rows = auditAll(), lines = [];
    rows[0].pairs.forEach(function (pair, index) {
      if (pair.name.indexOf('Ring') !== 0 && pair.name !== 'Quiet edge') return;
      var failing = rows.filter(function (row) { return !row.pairs[index].ok; }).map(function (row) { return row.name + ' ' + row.pairs[index].ratio.toFixed(1); });
      lines.push('<li data-testid="gal-focus-line"><b>' + esc(pair.name) + '</b> (' + pair.rule + '): ' + failing.length + ' of ' + rows.length + ' fail' + (failing.length ? ' — ' + esc(failing.join(', ')) : '') + '</li>');
    });
    host.innerHTML = '<p class="note">The ring is the theme\'s own body ink (--focus-ring) with a gap in the surface colour (--focus-halo): both come from tokens every theme already sets, so no colour is picked.</p><ul>' + lines.join('') + '</ul>';
  }
  function paintType() {
    var host = document.getElementById('typebox');
    if (!host) return;
    var probes = document.createElement('div');
    probes.innerHTML = typeProbesHTML();
    probeBox().appendChild(probes);
    var rows = typeEntries().map(typeRowHTML).join('');
    probes.remove();
    var faces = LANGS.map(function (lang) { return faceRowHTML(lang[0]); }).join('');
    host.innerHTML = '<table class="tok"><thead><tr><th>' + esc(words('Code')) + '</th><th>Face</th><th>Size</th><th>' + esc(words('Weight')) + '</th><th>Line</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<h4>Which face drew each language</h4><table class="tok"><tbody>' + faces + '</tbody></table>';
  }
  /** the product's faces come from Google Fonts like app.html loads them; repaint once they have arrived */
  function whenFacesLoad() {
    if (!document.fonts || !document.fonts.load) return;
    Promise.all(['14px Inter', '14px "Space Grotesk"', '14px "Space Mono"'].map(function (face) { return document.fonts.load(face); }))
      .then(paint)
      .catch(function (error) {
        console.warn('ui-standard: the product faces did not load, the page shows its fallback', (error && error.message) || error);
      });
  }

  /* ── waves: one row per wave from public/app/ui-waves.json, a progress bar (CMP021) and a before to after pair each ── */
  var STATUS_WORDS = { done: 'Done', 'in progress': 'In progress', next: 'Next', 'landed, measuring': 'Landed, measuring' };
  /** a whole number with thousands separators, the same in every language so the figures line up with the register */
  function figure(value) {
    return Number(value).toLocaleString('en-US');
  }
  /** a number not measured yet is null: say measuring, never a guess */
  function figureOrMeasuring(value) {
    return value === null || value === undefined ? words('measuring') : figure(value);
  }
  /** one wave's progress: the bar (value of total) and the line under it; a null value draws an empty bar and says measuring */
  function waveProgress(progress) {
    var known = progress.value !== null && progress.value !== undefined;
    var bar = ui.progress.bar({ label: words(progress.label), now: known ? progress.value : 0, max: progress.total });
    var line = known ? formatWords('{n} of {total}', { n: figure(progress.value), total: figure(progress.total) }) : words('measuring');
    return '<div class="wv-prog" data-testid="gal-wave-progress"><span class="wv-lab">' + esc(words(progress.label)) + '</span>' + bar + '<span class="wv-num">' + esc(line) + '</span></div>';
  }
  /** a before to after pair: the label, then 67 → measuring; the optional total says out of how many */
  function wavePair(pair) {
    var total = pair.of ? ' <small>' + esc(formatWords('of {total}', { total: figure(pair.of) })) + '</small>' : '';
    return '<p class="wv-pair" data-testid="gal-wave-pair"><span class="wv-lab">' + esc(words(pair.label)) + '</span><b>' + esc(figure(pair.before)) + '</b> → <b>' +
      esc(figureOrMeasuring(pair.after)) + '</b>' + total + '</p>';
  }
  function waveRow(wave) {
    var status = wave.status;
    return '<section class="crow" data-testid="gal-wave-' + esc(wave.id) + '"><div class="cid"><span class="chip" data-testid="gal-code">' + esc(formatWords('Wave {id}', { id: wave.id })) + '</span>' +
      '<b>' + esc(words(wave.title)) + '</b><span class="wv-status" data-status="' + esc(status) + '" data-testid="gal-wave-status">' + esc(words(STATUS_WORDS[status] || status)) + '</span>' +
      '<span class="meta">' + esc(words(wave.offers)) + '</span></div><div class="wv-body">' + waveProgress(wave.progress) + wave.pairs.map(wavePair).join('') + '</div></section>';
  }
  /** the Waves section: one row per wave, in the order of the file */
  function wavesHTML(data) {
    if (!data || !data.waves) return '<p class="note" data-testid="gal-waves-wait">' + esc(words('measuring')) + '</p>';
    return data.waves.map(waveRow).join('') + '<p class="note" data-testid="gal-waves-asof">' + esc(formatWords('Measured {date}', { date: data.measured })) + '</p>';
  }
  function wavesPanel() {
    return wavesHTML(wavesData);
  }
  /** read the one data file the section draws from (a static file of this site), then draw again; a failed read leaves the section saying measuring */
  function loadWaves() {
    /* a static data file of this site: no api, no session; the page's CSP allows connect-src 'self' only */
    window.fetch('/app/ui-waves.json').then(function (answer) { return answer.json(); }).then(function (data) {
      wavesData = data;
      paint();
    }).catch(function (problem) {
      if (typeof cblog === 'function') cblog('warn', 'ui-waves.json did not load: ' + problem);
    });
  }

  /* ── before and after ── */
  /** the "after" of one census entry: its one component, drawn by its own factory (a link needs an address; the choice is not a button) */
  function afterOf(entry, component) {
    if (entry.name === 'choice') return ui.choice({ mount: mountCode(), key: 'before', label: 'Shop status', value: 'open', size: 'compact', items: [{ value: 'open', label: 'Open' }, { value: 'away', label: 'Away' }, { value: 'closed', label: 'Closed' }] });
    /* where-used: out-of-scope loop: one call site, many instances; the mount comes from the counter */
    return ui.action(entry.name, { mount: mountCode(), href: component.link ? '#' : undefined, object: entry.name === 'save' ? 'settings' : '', effect: entry.name === 'save' ? 'preference' : undefined, confirm: component.effect === 'commit' ? reachConfirm(entry.name) : undefined });
  }
  function beforePanel() {
    return CENSUS.map(function (entry) {
      var component = ui.components[entry.name];
      var old = entry.before.map(function (pair) {
        return '<span class="old" data-testid="gal-old">' + esc(pair[0]) + ' <small>×' + pair[1] + '</small></span>';
      }).join('');
      return '<section class="crow" data-testid="gal-before-' + entry.name + '"><div class="cid"><span class="chip">' + component.code + '</span><b>' + esc(words(component.label)) + '</b><span class="meta">' +
        entry.before.length + ' → 1</span></div><div class="ba"><div class="bcol"><h4>' + esc(words('Before')) + '</h4>' + old + '</div><div class="bcol"><h4>' + esc(words('After')) + '</h4>' +
        /* where-used: out-of-scope loop: one call site, many instances; the mount comes from the counter */
        afterOf(entry, component) + '</div></div></section>';
    }).join('');
  }

  /* ── chrome: header controls ── */
  /** a segmented control of two-line buttons (title over value); 'bad' marks the value in red (below the floor) */
  function twoLine(group, items, current, firstCode, label) {
    return '<div class="seg" role="group" aria-label="' + esc(words(label)) + '">' + items.map(function (item, index) {
      return '<button type="button" data-cbsid="' + codeOf(firstCode + index) + '" data-g="' + group + '" data-v="' + item[0] + '" aria-pressed="' + (item[0] === current) + '" data-testid="gal-' + group + '-' + item[0] + '"><span class="t">' + esc(item[1]) +
        '</span><span class="n' + (item[3] ? ' bad' : '') + '">' + esc(item[2]) + '</span></button>';
    }).join('') + '</div>';
  }
  function screenItems() {
    return [['this', words('This screen'), words('as it is')], ['desktop', words('Desktop'), '1366×768'], ['mobile', words('Mobile'), '390×844']];
  }
  function sizeItems() {
    return Object.keys(PRESETS).map(function (key) { return [key, key === 'small' ? words('Below the floor') : words(PRESETS[key].label), PRESETS[key].h + ' px', key === 'small']; });
  }
  function overlaySwitch(code) {
    return '<button type="button" class="tgl" role="switch" aria-checked="' + state.overlay + '" data-cbsid="' + codeOf(code) + '" data-g="overlay" data-v="' + (state.overlay ? 'off' : 'on') + '" data-testid="gal-overlay-switch"><span class="tr"></span>' + esc(words('24 px targets')) + '</button>';
  }
  /** the tools strip above the main pane: Screen, Size (two-line segments), the 24 px switch */
  function headerHTML() {
    return '<div class="tools"><div class="grp"><span class="lab">' + esc(words('Screen')) + '</span>' + twoLine('screen', screenItems(), state.screen, CODE.screen, 'Screen') + '</div>' +
      '<div class="grp"><span class="lab">' + esc(words('Size')) + '</span>' + twoLine('size', sizeItems(), state.size, CODE.size, 'Size') + '</div>' + overlaySwitch(CODE.overlay) + '</div>';
  }
  /** the strip above the tools: the lead line, the way back to the Standards page, and (390 only) the View button that opens the sheet */
  function topHTML() {
    return '<p class="lead" data-testid="gal-lead">' + esc(words('Every button, popup and sign in ChitBridge, drawn by the real code so it looks and works the same on every screen.')) + ' <b>' + esc(words('Start with Components.')) + '</b><span class="x"> ' + esc(words('Theme and language sit in the avatar, top right.')) + '</span></p>' +
      '<a class="tohome" href="/standards.html" data-cbsid="' + codeOf(CODE.standards) + '" data-testid="gal-to-standards">‹ ' + esc(words('Standards')) + '</a>' +
      '<div class="pick"><button type="button" class="viewbtn" data-cbsid="' + codeOf(CODE.view) + '" data-g="sheet" data-v="open" data-testid="gal-view" aria-haspopup="dialog">' + esc(words('View')) + '</button></div>';
  }
  /** the View sheet (390): the same Screen and Size choices, and the 24 px switch, as radio rows */
  function sheetOptions(group, items, current, firstCode) {
    return items.map(function (item, index) {
      return '<button type="button" class="opt" role="radio" aria-checked="' + (item[0] === current) + '" data-cbsid="' + codeOf(firstCode + index) + '" data-g="' + group + '" data-v="' + item[0] + '" data-testid="gal-sheet-' + group + '-' + item[0] + '"><i></i><span class="l">' + esc(item[1]) + '</span><span class="n' + (item[3] ? ' bad' : '') + '">' + esc(item[2]) + '</span></button>';
    }).join('');
  }
  function sheetHTML() {
    return '<div class="g"><h4>' + esc(words('Screen')) + '</h4>' + sheetOptions('screen', screenItems(), state.screen, CODE.sheet) + '</div><div class="g"><h4>' + esc(words('Size')) + '</h4>' + sheetOptions('size', sizeItems(), state.size, CODE.sheet + 3) +
      '</div><div class="g">' + overlaySwitch(CODE.sheet + 7).replace('gal-overlay-switch', 'gal-sheet-overlay-switch') + '</div>';
  }

  /* ── the 24 px target overlay: a dashed 24 by 24 box centred on every control, red when the control is smaller ── */
  function currentScale() {
    var frame = document.getElementById('frame');
    return frame && frame.offsetWidth ? frame.getBoundingClientRect().width / frame.offsetWidth : 1;
  }
  function paintOverlay() {
    var content = document.getElementById('content');
    var old = content.querySelector('.ovl');
    if (old) old.remove();
    if (!state.overlay) return;
    var layer = document.createElement('div');
    layer.className = 'ovl';
    layer.setAttribute('aria-hidden', 'true');
    var scale = currentScale(), origin = content.getBoundingClientRect();
    content.querySelectorAll('button').forEach(function (button) {
      var box = button.getBoundingClientRect();
      if (!box.width) return;
      var width = box.width / scale, height = box.height / scale;
      var tag = document.createElement('i');
      tag.className = width >= 24 && height >= 24 ? 'ok' : 'bad';
      tag.setAttribute('data-testid', 'gal-target-' + tag.className);
      tag.style.cssText = 'left:' + ((box.left - origin.left) / scale + (width - 24) / 2) + 'px;top:' + ((box.top - origin.top) / scale + (height - 24) / 2) + 'px';
      tag.title = Math.round(width) + '×' + Math.round(height) + ' px';
      layer.appendChild(tag);
    });
    content.appendChild(layer);
  }

  /* ── fit: the frame for the chosen screen, scaled to the room there is; no page scroll ── */
  function fitFrame() {
    var stage = document.getElementById('stage'), frame = document.getElementById('frame'), box = SCREENS[state.screen];
    var shellHeader = document.getElementById('shell');
    document.documentElement.style.setProperty('--hdr-h', (shellHeader ? shellHeader.offsetHeight : 0) + 'px');
    stage.classList.toggle('framed', !!box.w);
    if (!box.w) {
      frame.style.cssText = '';
      stage.style.cssText = '';
      return;
    }
    stage.classList.toggle('framed', true);
    var room = stage.getBoundingClientRect();
    var scale = Math.min((room.width - 16) / box.w, (room.height - 16) / box.h, 1);
    frame.style.cssText = 'width:' + box.w + 'px;height:' + box.h + 'px;transform:scale(' + scale + ');transform-origin:top left;flex:none';
    stage.style.cssText = 'display:block;padding:8px;overflow:hidden';
    frame.parentNode.style.cssText = '';
    frame.style.marginRight = -(box.w * (1 - scale)) + 'px';
    frame.style.marginBottom = -(box.h * (1 - scale)) + 'px';
  }

  /* ── the themes: each one applied through the avatar's own code and measured on the real buttons ── */
  function probeHTML() {
    return ui.action('done', { mount: SCREEN + '-U90', object: 'step', testid: 'gal-probe-primary' }) + ui.action('cancel', { mount: SCREEN + '-U91', object: 'edit', testid: 'gal-probe-quiet' });
  }
  function probeNode(name) {
    return document.querySelector('[data-testid="gal-probe-' + name + '"]');
  }
  /** the ring as drawn: the focus rule applied to a probe button (data-demo=focus carries the same declarations as :focus-visible), measured, never declared */
  function ringNow() {
    var probe = probeNode('primary');
    probe.setAttribute('data-demo', 'focus');
    var style = getComputedStyle(probe);
    var ring = { colour: style.outlineColor, width: parseFloat(style.outlineWidth), offset: parseFloat(style.outlineOffset), halo: (style.boxShadow.match(/rgba?\([^)]*\)/) || [''])[0] };
    probe.removeAttribute('data-demo');
    return ring;
  }
  /** the pairs of the standard in the theme now on the page: [name, foreground, background, minimum, criterion, fixed figure (a measure, not a ratio)] */
  function pairsNow() {
    var page = getComputedStyle(document.body).backgroundColor, card = getComputedStyle(document.documentElement).getPropertyValue('--card').trim();
    var done = getComputedStyle(probeNode('primary')), quiet = getComputedStyle(probeNode('quiet')), ring = ringNow();
    return [
      ['Done label', done.color, done.backgroundColor, 4.5, '1.4.3'],
      ['Quiet label', quiet.color, page, 4.5, '1.4.3'],
      ['Page text', getComputedStyle(document.body).color, page, 4.5, '1.4.3'],
      ['Done fill', done.backgroundColor, page, 3, '1.4.11'],
      ['Quiet edge', quiet.borderTopColor, page, 3, '1.4.11'],
      ['Ring on page', ring.colour, page, 3, '2.4.7 · 1.4.11 · 2.4.13'],
      ['Ring on card', ring.colour, card, 3, '2.4.7 · 1.4.11 · 2.4.13'],
      ['Ring width', null, null, 2, '2.4.13', ring.width],
      ['Ring gap', null, null, 0, '2.4.13', ring.offset]
    ];
  }
  function swatchesNow() {
    var style = getComputedStyle(document.documentElement);
    return ['--page', '--card', '--ink', '--accent'].map(function (token) { return style.getPropertyValue(token).trim(); });
  }
  /** every theme, one after the other: the figures per pair, then the page's own theme is put back */
  function auditAll() {
    var table = window.CBScreen.APP_THEMES, rows = [], saved = window.CBAvatar.get().theme;
    document.getElementById('probe').innerHTML = probeHTML();
    Object.keys(table).forEach(function (key) {
      window.CBAvatar.applyWith({ theme: key });
      rows.push({
        key: key,
        name: table[key].name,
        swatches: swatchesNow(),
        pairs: pairsNow().map(function (pair) {
          var ratio = pair[5] === undefined ? contrastRatio(pair[1], pair[2]) : pair[5];
          return { name: pair[0], ratio: ratio, min: pair[3], rule: pair[4], ok: ratio >= pair[3] };
        })
      });
    });
    window.CBAvatar.applyWith({ theme: saved });
    return rows;
  }
  function themeRowHTML(row) {
    var swatches = row.swatches.map(function (colour) { return '<span class="sw" style="background:' + esc(colour) + '"></span>'; }).join('');
    var cells = row.pairs.map(function (pair) {
      return '<td class="' + (pair.ok ? 'pass' : 'fail') + '" data-testid="gal-pair-' + (pair.ok ? 'ok' : 'fail') + '" title="' + pair.rule + ' ≥ ' + pair.min + '">' + pair.ratio.toFixed(1) + (pair.ok ? '' : ' ✗') + '</td>';
    }).join('');
    return '<tr data-testid="gal-theme-row"><th scope="row">' + swatches + esc(row.name) + '</th>' + cells + '</tr>';
  }
  function themesPanel() {
    var rows = auditAll();
    var heads = rows[0].pairs.map(function (pair) { return '<th title="' + pair.rule + '">' + esc(pair.name) + '<br><small>≥ ' + pair.min + '</small></th>'; }).join('');
    return '<table class="tok themes"><thead><tr><th>' + esc(words('Theme')) + '</th>' + heads + '</tr></thead><tbody>' + rows.map(themeRowHTML).join('') + '</tbody></table>';
  }

  /* ── the 'Meets the standard' tab: each rule, its source, how the page proves it, the live result per theme ── */
  var WCAG_UNDERSTANDING = 'https://www.w3.org/WAI/WCAG22/Understanding/';
  var MEETS = [
    { rule: 'Every control shows where the keyboard is, with a ring you can see.', pairs: ['Ring on page', 'Ring on card'], proof: 'The ring is drawn on a real button and its colour measured against the page and the card, in each theme (3:1 needed).',
      sources: [['WCAG 2.4.7 Focus Visible', WCAG_UNDERSTANDING + 'focus-visible.html'], ['WCAG 1.4.11 Non-text Contrast', WCAG_UNDERSTANDING + 'non-text-contrast.html'], ['GOV.UK focus states', 'https://design-system.service.gov.uk/get-started/focus-states/'], ['Fluent 2 accessibility', 'https://fluent2.microsoft.design/accessibility']] },
    { rule: 'The ring is thick enough and sits clear of the button.', pairs: ['Ring width', 'Ring gap'], proof: 'The drawn outline width (3 px, 2 px or more needed) and its gap are read from the browser.',
      sources: [['WCAG 2.4.13 Focus Appearance (AAA)', WCAG_UNDERSTANDING + 'focus-appearance.html']] },
    { rule: 'A quiet button still shows its edge: the edge is the same colour as its label.', pairs: ['Quiet edge'], proof: 'The edge colour the browser draws is measured against the page (3:1 needed).',
      sources: [['WCAG 1.4.11 Non-text Contrast', WCAG_UNDERSTANDING + 'non-text-contrast.html'], ['IBM Carbon button style', 'https://carbondesignsystem.com/components/button/style/']] },
    { rule: 'Words on buttons and on the page are easy to read.', pairs: ['Done label', 'Quiet label', 'Page text'], proof: 'Label and page text colour against what is behind them (4.5:1 needed).',
      sources: [['WCAG 1.4.3 Contrast (Minimum)', WCAG_UNDERSTANDING + 'contrast-minimum.html']] },
    { rule: 'The main button stands out from the page.', pairs: ['Done fill'], proof: 'The fill of the Done button against the page (3:1 needed).',
      sources: [['WCAG 1.4.11 Non-text Contrast', WCAG_UNDERSTANDING + 'non-text-contrast.html']] }
  ];
  /** the figure a chip shows: a contrast ratio for a colour pair, but the measured px for the ring's width and gap (never a ratio-looking number) */
  function figureOf(found) {
    var width = found.filter(function (pair) { return pair.name === 'Ring width'; })[0], ringGap = found.filter(function (pair) { return pair.name === 'Ring gap'; })[0];
    if (width && ringGap) return width.ratio + ' px · gap ' + ringGap.ratio + ' px';
    return Math.min.apply(null, found.map(function (pair) { return pair.ratio; })).toFixed(1) + ':1';
  }
  function resultChips(rows, names) {
    return rows.map(function (row) {
      var found = row.pairs.filter(function (pair) { return names.indexOf(pair.name) >= 0; });
      var ok = found.every(function (pair) { return pair.ok; });
      return '<span class="' + (ok ? 'pass' : 'fail') + '" data-testid="gal-meet-' + (ok ? 'pass' : 'fail') + '">' + esc(row.name) + ' ' + (ok ? 'PASS' : 'FAIL') + ' ' + figureOf(found) + '</span>';
    }).join('');
  }
  function targetResult() {
    var buttons = [].slice.call(document.querySelectorAll('#probe [data-testid^="gal-probe-"]')), scale = currentScale();
    var smallest = Math.min.apply(null, buttons.map(function (node) { var box = node.getBoundingClientRect(); return Math.min(box.width, box.height) / scale; }));
    return '<span class="' + (smallest >= 24 ? 'pass' : 'fail') + '" data-testid="gal-meet-' + (smallest >= 24 ? 'pass' : 'fail') + '">' + Math.round(smallest) + ' px ' + (smallest >= 24 ? 'PASS' : 'FAIL') + ' (' + esc(words(PRESETS[state.size].label)) + ')</span>';
  }
  function meetsRowHTML(item, rows) {
    var links = item.sources.map(function (source) { return '<a href="' + source[1] + '" target="_blank" rel="noopener noreferrer">' + esc(source[0]) + '</a>'; }).join(' · ');
    return '<section class="meets-row" data-testid="gal-meets-row"><h3>' + esc(words(item.rule)) + '</h3><p class="src">' + links + '</p><p>' + esc(item.proof) + '</p><div class="res">' + (item.custom ? item.custom() : resultChips(rows, item.pairs)) + '</div></section>';
  }
  function meetsPanel() {
    var rows = auditAll();
    var target = { rule: 'Buttons are big enough to hit with a thumb.', proof: 'The smallest real button on the page, measured now at the chosen size (24 px needed). Try Too small 20 in Size.', sources: [['WCAG 2.2 · SC 2.5.8 Target Size (Minimum)', WCAG_UNDERSTANDING + 'target-size-minimum.html']], custom: targetResult };
    var obscured = { rule: 'Nothing slides over the focused button.', proof: 'The result bar is a row below the page, never an overlay: the walk checks that it covers no button at 1366 and 390.', sources: [['WCAG 2.4.11 Focus Not Obscured (Minimum)', WCAG_UNDERSTANDING + 'focus-not-obscured-minimum.html']], custom: function () { return '<span class="pass">proved by the walk</span>'; } };
    return MEETS.concat([target, obscured], KEY_ROWS).map(function (item) { return meetsRowHTML(item, rows); }).join('') +
      '<section class="country" data-testid="gal-country"><h3>Country rules (UK, EU, US, India, Australia, UAE)</h3><p class="note">Empty on purpose. A country research file will fill this section later; nothing about any country is stated here.</p></section>';
  }

  /* ── keyboard and focus rows: measured in the browser after the page is drawn (paintLive), never written as a result ── */
  var NATIVE_FOCUS = 'button, a[href], input, select, textarea, summary';
  /** a result placeholder; paintLive replaces it with the measured chip */
  function liveHolder(key) {
    return function () { return '<span data-live="' + key + '" data-testid="gal-meetlive-wait">' + esc(words('measuring')) + '</span>'; };
  }
  /** the controls on show: real buttons, links and boxes that are drawn, enabled, and not the dialog itself */
  function liveControls() {
    var found = [].slice.call(document.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, [role="button"]'));
    return found.filter(function (node) {
      return !node.closest('#modalhost') && !node.disabled && node.getAttribute('aria-disabled') !== 'true' && node.getClientRects().length > 0;
    });
  }
  /** the words of the label tied to a control: aria-labelledby first, then a label element; empty when it has none */
  function labelText(node) {
    var ids = (node.getAttribute('aria-labelledby') || '').split(/s+/).filter(Boolean);
    var spoken = ids.map(function (id) { var target = document.getElementById(id); return target ? target.textContent : ''; }).join(' ').trim();
    if (spoken || !node.labels) return spoken;
    return [].map.call(node.labels, function (label) { return label.textContent; }).join(' ').trim();
  }
  /** the words a control carries itself: aria-label, a button's value, its text, or the alt of a picture inside it */
  function ownWords(node) {
    var picture = node.querySelector('img[alt]');
    var typed = /^(button|submit|reset)$/.test(node.type || '') ? String(node.value || '').trim() : '';
    return (node.getAttribute('aria-label') || '').trim() || typed || (node.textContent || '').trim() || (picture ? picture.getAttribute('alt').trim() : '');
  }
  /** the name a screen reader says for a control: its label, else its own words; a title alone is not a name */
  function nameOf(node) {
    return labelText(node) || ownWords(node);
  }
  function keyboardFacts(nodes) {
    return { total: nodes.length, out: nodes.filter(function (node) { return node.tabIndex < 0; }).length };
  }
  function nameFacts(nodes) {
    var unnamed = nodes.filter(function (node) { return !nameOf(node); });
    return { total: nodes.length, unnamed: unnamed.length, titleOnly: unnamed.filter(function (node) { return node.getAttribute('title'); }).length };
  }
  /** true when the box has more content than it shows and its overflow lets it scroll, down or sideways */
  function rolls(node) {
    var style = getComputedStyle(node), scrolls = /auto|scroll/;
    if (scrolls.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1) return true;
    return scrolls.test(style.overflowX) && node.scrollWidth > node.clientWidth + 1;
  }
  /** a box that scrolls: reachable when it takes focus itself or holds something that does; named when it says what it is */
  function scrollFacts() {
    var areas = [].slice.call(document.querySelectorAll('body *')).filter(function (node) { return node.getClientRects().length > 0 && rolls(node); });
    var cannotReach = areas.filter(function (node) { return !(node.tabIndex >= 0 || node.querySelector(NATIVE_FOCUS)); });
    var unnamed = areas.filter(function (node) { return !(node.getAttribute('aria-label') || node.getAttribute('aria-labelledby')); });
    return { total: areas.length, cannotReach: cannotReach.length, unnamed: unnamed.length };
  }
  function pressKey(target, key, shift) {
    var event = new KeyboardEvent('keydown', { key: key, shiftKey: !!shift, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  }
  /** Tab at the last button and Shift+Tab at the first must both be taken by the dialog and keep focus inside it */
  function tabStays(box) {
    var inside = [].slice.call(box.querySelectorAll(NATIVE_FOCUS)).filter(function (node) { return !node.disabled && node.tabIndex >= 0; });
    if (!inside.length) return false;
    inside[inside.length - 1].focus();
    var forward = pressKey(inside[inside.length - 1], 'Tab', false).defaultPrevented && box.contains(document.activeElement);
    inside[0].focus();
    return !!(forward && pressKey(inside[0], 'Tab', true).defaultPrevented && box.contains(document.activeElement));
  }
  /** opens the example dialog from a real button of this page and reads where focus goes, whether Tab stays, whether Esc closes, where focus lands; the host is put back as it was */
  function dialogFacts() {
    var host = document.getElementById('modalhost'), before = host.innerHTML, opener = probeNode('primary');
    if (opener) opener.focus();
    openExampleDialog();
    var box = host.querySelector('.modal'), facts = { focusIn: !!box && box.contains(document.activeElement) };
    facts.tabStays = !!box && tabStays(box);
    pressKey(document.activeElement || document.body, 'Escape', false);
    facts.escCloses = !host.querySelector('.mover');
    facts.focusBack = backOnOpener(facts, opener);
    host.innerHTML = before;
    if (opener) opener.focus();
    return facts;
  }
  /** true only when focus went in, Esc closed the popup, and focus is now on the button that opened it */
  function backOnOpener(facts, opener) {
    return !!opener && facts.focusIn && facts.escCloses && document.activeElement === opener;
  }
  function yesNo(flag) {
    return flag ? 'yes' : 'no';
  }
  function keyVerdict(ok, detail) {
    return { ok: ok, text: (ok ? 'PASS' : 'FAIL') + ' · ' + detail };
  }
  function judgeFocusIn(facts) {
    return keyVerdict(facts.focusIn, 'focus ' + (facts.focusIn ? 'moved into the popup' : 'stayed on the page'));
  }
  function judgeTrap(facts) {
    return keyVerdict(facts.tabStays && facts.escCloses && facts.focusBack, 'Tab stays ' + yesNo(facts.tabStays) + ' · Esc closes ' + yesNo(facts.escCloses) + ' · focus back ' + yesNo(facts.focusBack));
  }
  function judgeKeys(facts) {
    return keyVerdict(facts.out === 0, facts.out + ' of ' + facts.total + ' cannot be reached by Tab');
  }
  function judgeNames(facts) {
    return keyVerdict(facts.unnamed === 0, facts.unnamed + ' of ' + facts.total + ' have no name (' + facts.titleOnly + ' only a title)');
  }
  function judgeScroll(facts) {
    return keyVerdict(facts.cannotReach === 0 && facts.unnamed === 0, facts.total + ' scrolling here · ' + facts.cannotReach + ' cannot be reached · ' + facts.unnamed + ' without a name');
  }
  /** the six keyboard rules of the Meets tab: the rule, what the page measures, where the standard says it, and the key paintLive fills */
  var KEY_ROWS = [
    { rule: 'A popup puts the cursor on its first field, or on the safe button when it asks you to confirm.', proof: 'The Example dialog is opened from a real button here and the page reads where the focus went.', live: 'dialog-focus',
      sources: [['WAI-ARIA APG Dialog (Modal)', 'https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/'], ['WCAG 2.4.3 Focus Order', WCAG_UNDERSTANDING + 'focus-order.html']] },
    { rule: 'Tab stays inside a popup, Esc closes it, and you land back on the button you pressed.', proof: 'The same dialog is sent Tab at its last button, Shift+Tab at its first, then Esc; the page reads where the focus is.', live: 'dialog-trap',
      sources: [['WAI-ARIA APG Dialog (Modal)', 'https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/'], ['WCAG 2.1.2 No Keyboard Trap', WCAG_UNDERSTANDING + 'no-keyboard-trap.html']] },
    { rule: 'Every button and box works from the keyboard alone.', proof: 'Every drawn, enabled control on this page is checked: Tab must reach it.', live: 'keys',
      sources: [['WCAG 2.1.1 Keyboard', WCAG_UNDERSTANDING + 'keyboard.html']] },
    { rule: 'Every button and box has a name, not only a hover tip.', proof: 'Every drawn control on this page is read for its name: a label, its words or aria-label. A title alone does not count.', live: 'names',
      sources: [['WCAG 4.1.2 Name, Role, Value', WCAG_UNDERSTANDING + 'name-role-value.html'], ['WCAG 1.1.1 Non-text Content', WCAG_UNDERSTANDING + 'non-text-content.html']] },
    { rule: 'A state is said in words or shown by a shape, never by fading alone.', proof: 'A rule, not a measure here: the walk looks for a state carried only by opacity on each screen.', live: null,
      sources: [['WCAG 1.4.1 Use of Color', WCAG_UNDERSTANDING + 'use-of-color.html'], ['WCAG 1.4.11 Non-text Contrast', WCAG_UNDERSTANDING + 'non-text-contrast.html']] },
    { rule: 'A list that scrolls can be reached with Tab and has a name.', proof: 'Every box on this page that scrolls is checked for Tab focus (itself or something inside) and a name.', live: 'scroll',
      sources: [['WCAG 2.1.1 Keyboard', WCAG_UNDERSTANDING + 'keyboard.html'], ['axe scrollable-region-focusable', 'https://dequeuniversity.com/rules/axe/4.10/scrollable-region-focusable']] }
  ].map(function (item) {
    item.custom = item.live ? liveHolder(item.live) : function () { return '<span data-testid="gal-meetlive-walk">' + esc(words('checked by the walk, not on this page')) + '</span>'; };
    return item;
  });
  /** fills each placeholder with its measured chip; only the Meets tab holds any, and no result is written before it is read */
  function paintLive() {
    var holders = [].slice.call(document.querySelectorAll('#content [data-live]'));
    if (!holders.length) return;
    var dialog = dialogFacts(), controls = liveControls();
    var results = { 'dialog-focus': judgeFocusIn(dialog), 'dialog-trap': judgeTrap(dialog), keys: judgeKeys(keyboardFacts(controls)), names: judgeNames(nameFacts(controls)), scroll: judgeScroll(scrollFacts()) };
    holders.forEach(function (node) {
      var result = results[node.getAttribute('data-live')];
      node.className = result.ok ? 'pass' : 'fail';
      node.setAttribute('data-testid', 'gal-meetlive-' + (result.ok ? 'pass' : 'fail'));
      node.textContent = result.text;
    });
  }

  /* ── paint: the whole page again, from state ── */
  /** the frame's sidebar and phone switch light the section on show (a hash change or a pick moves it) */
  function syncFrame() {
    if (!pageFrame || !pageFrame.skeleton) return;
    pageFrame.skeleton.setActive(state.tab);
    if (pageFrame.skeleton.setPhone) pageFrame.skeleton.setPhone(state.tab);
  }
  function applyState() {
    var root = document.documentElement, preset = PRESETS[state.size];
    window.cbLang = function () { return state.lang; };
    root.setAttribute('lang', state.lang);
    root.setAttribute('dir', LANGS.filter(function (lang) { return lang[0] === state.lang; })[0][2]);
    root.style.setProperty('--act-h', preset.h + 'px');
    root.style.setProperty('--act-pad', preset.pad + 'px');
    root.style.setProperty('--act-radius', preset.radius + 'px');
    root.style.setProperty('--act-font', preset.font + 'px');
  }
  function panelHTML() {
    var panels = { components: componentsPanel, popups: popupsPanel, icons: iconsPanel, tokens: tokensPanel, themes: themesPanel, meets: meetsPanel, before: beforePanel, waves: wavesPanel };
    return '<p class="line" data-testid="gal-line">' + esc(words(TAB_LINE[state.tab])) + '</p>' + panels[state.tab]();
  }
  function paint() {
    counters.mount = 0;
    applyState();
    document.getElementById('probe').innerHTML = probeHTML();
    document.getElementById('topline').innerHTML = topHTML();
    document.getElementById('hdr').innerHTML = headerHTML();
    document.getElementById('sheet').innerHTML = sheetHTML();
    document.getElementById('content').innerHTML = panelHTML();
    syncFrame();
    fitFrame();
    paintMeasure();
    paintFocus();
    paintType();
    paintOverlay();
    paintLive();
    if (document.querySelector('#modalhost .mover')) openExampleDialog();
  }
  function onSwitch(event) {
    var button = event.target.closest && event.target.closest('[data-g]');
    if (event.target.id === 'scrim') return document.documentElement.removeAttribute('data-open');
    if (!button || button.tagName === 'SELECT' || button.tagName === 'OPTION') return;
    if (button.getAttribute('data-g') === 'sheet') return document.documentElement.setAttribute('data-open', '');
    chooseValue(button.getAttribute('data-g'), button.getAttribute('data-v'));
  }
  function onChange(event) {
    if (event.target.tagName === 'SELECT' && event.target.getAttribute('data-g')) chooseValue(event.target.getAttribute('data-g'), event.target.value);
  }
  function chooseValue(group, value) {
    if (STATE_KEYS.indexOf(group) >= 0) state[group] = value;
    else if (group === 'overlay') state.overlay = value === 'on';
    if (group === 'tab' && window.history && window.history.replaceState) window.history.replaceState(null, '', '#' + value);
    paint();
  }
  /** the options the frame hands the REAL avatar (CBAvatar.mount via CBFrame.lab) on this fixed-look page: every pick is applied and reported here, none is saved; it also owns the language here.
   *  The person is a preview and there is no token or api address, so the avatar reads and sends nothing. 'current' is read when the menu draws, so it always names the language on show. */
  function avatarOptions() {
    var names = {};
    LANGS.forEach(function (lang) { names[lang[0]] = lang[1]; });
    var languages = { list: names, onPick: pickLanguage };
    Object.defineProperty(languages, 'current', { enumerable: true, get: function () { return state.lang; } });
    return {
      person: { name: 'Preview', role: 'nothing is saved', owner: false },
      items: [],
      sync: false,
      pull: false,
      token: null,
      apiBase: '',
      testid: 'avatar',
      languages: languages,
      onLook: paint
    };
  }
  function pickLanguage(code) {
    state.lang = code;
    paint();
  }
  /** the sections the frame's sidebar and phone switch list, in order: { k, label, icon } */
  function sections() {
    return TABS.map(function (key) { return { k: key, label: TAB_LABEL[key], icon: SECTION_ICON[key] }; });
  }
  /** a pick in the frame's sidebar or phone switch */
  function chooseSection(key) {
    chooseValue('tab', key);
  }
  /** the section the address asks for (#meets ...), else the first: the frame opens on it */
  function firstSection() {
    state.tab = tabFromHash() || state.tab;
    return state.tab;
  }
  /** #meets, #icons ...: a section has its own address, so the Standards page can link straight to it */
  function tabFromHash() {
    var name = String(window.location.hash || '').replace('#', '');
    return TABS.indexOf(name) >= 0 ? name : null;
  }
  /** start the page inside the frame the HTML mounted (CBFrame.lab, an inline call the guards read there) */
  function start(framed) {
    pageFrame = framed;
    document.addEventListener('click', onSwitch);
    document.addEventListener('change', onChange);
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        closeModal();
        document.documentElement.removeAttribute('data-open');
      }
    });
    window.addEventListener('resize', function () {
      fitFrame();
      paintOverlay();
    });
    window.addEventListener('hashchange', function () {
      state.tab = tabFromHash() || state.tab;
      paint();
    });
    window.modal = modal;
    window.closeModal = closeModal;
    paint();
    loadWaves();
    whenFacesLoad();
  }
  return { wavesHTML: wavesHTML, start: start, sections: sections, chooseSection: chooseSection, firstSection: firstSection, avatarOptions: avatarOptions, state: state, ROWS: ROWS, SHELL_ROWS: SHELL_ROWS, CENSUS: CENSUS, PRESETS: PRESETS, TOKENS: TOKENS, LANGS: LANGS, coverageOf: coverageOf, translatedIn: translatedIn, contrastRatio: contrastRatio, paint: paint, audit: auditAll, KEY_ROWS: KEY_ROWS, meetsRowHTML: meetsRowHTML, judge: { focusIn: judgeFocusIn, trap: judgeTrap, keys: judgeKeys, names: judgeNames, scroll: judgeScroll } };
})();
