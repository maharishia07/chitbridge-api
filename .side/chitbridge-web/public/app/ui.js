/**
 * ui.js — THE STANDARD ACTION SET AND ITS FACTORIES (UX-137, DISCIPLINES §3a). One component per everyday action
 * (Save, Done, Cancel, Close, Back, Add, Remove, Reload, Open); a screen never hand-writes the markup, it MOUNTS one.
 * Improve a component here and every mount on every screen improves.
 * OWNS       ui.progress (CMP020 progress, CMP021 bar, CMP022 spinner: three levels, see PROGRESS; CMP026 batch progress: ui.progress.batch, a block bar with done, left and failed counts; CMP027 batch tray: its corner placement for a long batch; CMP032 batch job note: the state of a saved job in words, and how it ended) · ui.action(name, options) -> the button's HTML string · ui.dialog(options) -> opens through modal() ·
 *            ACTION_SET (the components: code, label key, verb, effect, tones) · the one delegated press listener.
 * CALLED BY  28 pages by <script src> (grep -lE 'src="/?app/ui.js' public/*.html; 14 Nov 2026): the small apps, the labs, the shop pages, app.html, standards.html (not index.html, not till.html).
 *            Callers of ui.action / ui.dialog / ui.progress: grep -lE 'ui.(action|dialog|progress)\b' public/*.html public/app/*.js (pages, the CRM screens, cap-books, chit-sheet, shell and more).
 * WIDENS     CBAction.run (accounts-shell.js: busy, one press one write, confirm:) for the press, and modal()/closeModal() (app.html) for the dialog. It adds no second confirm dialog and no second dialog path.
 * KEYBOARD   a native <button>: Tab reaches it, Enter and Space press it, the focus ring is the theme's; Esc closes a dialog (modal()) and so leaves Cancel/Close/Not now unpressed; Enter on a form commits through its Save only; a disabled action stays focusable-visible with its reason.
 * REGISTER   each component is CMP### in SCREENS.json with its own element CMP###-B01; each use is a mount <screen>-U## written as data-cbmount; the element carries data-cbsid = the component element code.
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/ui-action-set
 * FLOW       none (a drawing library). Spec: PM/UX-137-ROLLOUT.md sections 3a, 8 and C (factories).
 * THE RULES IT ENFORCES (it throws, because silence is the bug): an unknown component, a property outside the schema or an override of a fixed one is refused;
 * a SAVE says its effect ('preference': no confirm · 'commit': confirms first, with its reach; REMOVE is always a commit); a commit with its own onPress needs a
 * confirm {title, body, yes}, or confirmedBy: 'page' when the page handler already confirms (legacy handlers move to onPress, one at a time).
 */
var CBUi = (function () {
  var MOUNT_CODE = /^[A-Z]{3}\d{3}(?:-D\d{2})?-U\d{2,3}$/; /* two digits at least: the UI standard page alone mounts more than 99 (19 components x 6 states) */
  var TONES = ['primary', 'quiet'];
  var EFFECTS = ['none', 'preference', 'commit'];
  var ALLOWED_OPTIONS = [
    'mount', 'object', 'tone', 'hidden', 'disabled', 'busy', 'role', 'key', 'effect', 'confirm',
    'confirmedBy', 'onPress', 'id', 'testid', 'data', 'surface', 'expanded', 'display', 'size', 'href', 'hint', 'label', 'verb'
  ];
  /* CMP057 Command: the closed verb list of the register (docs toolset/ui-identity/ui-stamp.cjs VERBS); the caller picks one, the component never invents a verb */
  var COMMAND_VERBS = ['SAVE', 'CANCEL', 'CONFIRM', 'OPEN', 'CLOSE', 'ADD', 'REMOVE', 'CHANGE', 'CHOOSE', 'ENTER', 'TICK', 'MOVE', 'RELOAD', 'PREVIEW', 'PRINT', 'INSTALL', 'RENAME', 'CONNECT', 'POST', 'DOWNLOAD'];
  /* ICONS (Athi 10 Nov): one icon per component; a mount's look is 'icon' or 'icon+label'. Icon alone only for close, search, add, menu, back, edit, help and never for a commit; it sits in a 44 px target with an aria-label and a tooltip. */
  /* the three glyphs that failed (tofu on minimal Android fonts; emoji ignore the theme colour) are drawn as inline SVG: currentColor, sized in em, decorative */
  var SVG_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true">';
  var ICON_SVG_SEARCH = SVG_OPEN + '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg>';
  var ICON_SVG_NOTNOW = SVG_OPEN + '<path d="M6 3h12M6 21h12M7 3v3.5L12 12l-5 5.5V21M17 3v3.5L12 12l5 5.5V21"/></svg>';
  var ICON_SVG_DELETE = SVG_OPEN + '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/></svg>';
  var ICON = {
    save: '✓', cancel: '✕', done: '✓', close: '✕', back: '‹', add: '+', remove: '−', reload: '↻', open: '↗', delete: ICON_SVG_DELETE, edit: '✎',
    search: ICON_SVG_SEARCH, clear: '✕', notnow: ICON_SVG_NOTNOW, help: '?', info: 'ⓘ', more: '⋯', screenhelp: '?', home: '⌂', assistant: '💬', menu: '☰', legend: '🔑', activity: '🔔', background: '↘'
  };
  var ICON_ONLY = ['close', 'search', 'add', 'more', 'back', 'edit', 'help', 'screenhelp', 'menu'];
  var DISPLAYS = ['icon', 'icon+label'];
  /* TAP SIZE (Athi 10 Nov): a target under 24 px is never drawn. Standard is 44 px and is the default; compact is 32 px, for dense lists on a wide screen only;
     on a phone width a compact mount is lifted to 44 px; the 44 is a MINIMUM (a page that sets --act-h larger keeps it, and the UI standard page's deliberately small preset is still drawn small). One stylesheet, written here, so the size is changed in one place. */
  var SIZES = ['standard', 'compact'];
  /* FIELD EDGE (docs WEB-FIELD-PART section 6): the border of an input must reach 3:1 (WCAG 1.4.11) on card, paper AND panel in every theme. The engines theme's own --edge
     (public/engine/screen.js, vendored: never forked here) is #918B87 on Cream, 2.93:1 on --panel; so the token is the theme's --edge pulled 10% toward the theme's --ink,
     which measures 3.40:1 or more on every background of the four themes (e2e/field-edge.test.cjs fails the build under 3:1). Browsers without color-mix get the Cream
     value already mixed. Dividers keep --line and --line-3, where 3:1 is not required. */
  var FIELD_EDGE_CSS =
    ':root{--field-edge:#85807C}' +
    '@supports (color:color-mix(in srgb,currentcolor,currentcolor)){:root{--field-edge:color-mix(in srgb,var(--edge,#918B87) 90%,var(--ink,#1D1B16))}}';
  /* a disabled action is aria-disabled, never native disabled: it stays in the Tab order and its reason is real text (APG "Focusability of disabled controls") */
  var DISABLED_CSS =
    '.cbui-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}' +
    '[data-cbname][aria-disabled="true"]{color:var(--dim,#5e594d);cursor:not-allowed}';
  var SIZE_CSS = FIELD_EDGE_CSS + DISABLED_CSS +
    '[data-cbname]{min-height:var(--act-h,44px);min-width:var(--act-h,44px)}' +
    '[data-cbname][data-size="compact"]{min-height:32px;min-width:32px}' +
    /* CMP024 the Assistant pill and CMP025 the segmented choice: theme tokens only */
    '.cbui-fab{border:0;border-radius:24px;padding:10px 16px;background:var(--blue,#1f5f5b);color:var(--on-accent,#fff);font-weight:700;cursor:pointer;box-shadow:0 4px 14px var(--sh-shadow,rgba(0,0,0,.18));font-size:var(--fs-3,15px)}' +
    '.cbui-choice{display:inline-flex;border:1px solid var(--line,#d8ccb0);border-radius:9px;overflow:hidden;background:var(--card,#fff)}' +
    '.cbui-choice button{border:0;background:transparent;color:var(--ink,#2a2418);font-family:inherit;font-weight:600;font-size:var(--fs-1,12px);padding:0 12px;cursor:pointer;white-space:nowrap}' +
    '.cbui-choice button[aria-checked="true"]{background:var(--blue,#1f5f5b);color:var(--on-accent,#fff)}' +
    '.cbui-choice{position:relative}.cbui-choice-btn,.cbui-choice-menu{display:none}' +
    '.cbui-choice button[aria-selected="true"]{background:var(--blue,#1f5f5b);color:var(--on-accent,#fff)}' +
    '@media(max-width:700px){.cbui-choice{overflow:visible}.cbui-choice [role="radio"]{display:none}.cbui-choice .cbui-choice-btn{display:inline-flex;align-items:center;gap:6px;padding:0 12px}' +
    '.cbui-choice .cbui-choice-menu:not([hidden]){display:flex;flex-direction:column;position:absolute;inset-inline-end:0;top:calc(100% + 4px);min-width:100%;background:var(--card,#fff);border:1px solid var(--line,#d8ccb0);border-radius:9px;z-index:1000;box-shadow:0 6px 18px var(--sh-shadow,rgba(0,0,0,.18))}' +
    '.cbui-choice-menu button{display:flex;align-items:center;justify-content:flex-start;text-align:start;padding:0 14px}}' +
    '.cbui-choice button:focus-visible{outline:2px solid var(--accent,#1f5f5b);outline-offset:-2px}' +
    '@media(max-width:700px){dialog.sheet .mfoot button[data-cbname][data-size="compact"],.mfoot button[data-cbname][data-size="compact"]{min-height:max(44px,var(--act-h,44px))}}' +
    '@media(max-width:700px){[data-cbname][data-size="compact"],.cbav-btn{min-height:max(44px,var(--act-h,44px));min-width:max(44px,var(--act-h,44px))}' + /* the avatar (avatar.js) is a 34 px round button that is not a ui.action mount: it is lifted here, in the one rule */
    /* a phone: the status word gives way (ellipsis) before the bar scrolls, the group keeps its 44 px */
    '.cbui-choice{max-width:100%}.cbui-choice .cbui-choice-btn{min-width:44px;max-width:100%;padding:0 8px}.cbui-choice .cbui-cur{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}}';
  function ensureStyle() {
    if (typeof document === 'undefined' || !document.head || !document.createElement || document.getElementById('cbui-css')) return;
    var node = document.createElement('style');
    node.id = 'cbui-css';
    node.textContent = SIZE_CSS;
    document.head.appendChild(node);
  }
  /* CSS class per tone and surface: a page uses the small apps' .act family, a dialog footer uses the modal's own .pri / .danger */
  var TONE_CLASS = {
    page: { primary: 'act', quiet: 'act ghost' },
    dialog: { primary: 'pri', quiet: '', danger: 'danger' },
    /* a host that already styles its own button family keeps that look: the surface names the family, the component stays one */
    chip: { primary: 'optchip', quiet: 'optchip' },
    list: { primary: 'cbl-btn', quiet: 'cbl-btn' },
    /* a lab page's own pill (product-lab .pill) */
    pill: { primary: 'pill', quiet: 'pill' },
    bar: { primary: 'cbsid-help', quiet: 'cbsid-help' },
    /* the shell header's own look (shell.js .cbsh-tohome) and the floating Assistant pill (.cbui-fab, above) */
    shell: { primary: 'cbsh-tohome', quiet: 'cbsh-tohome' },
    float: { primary: 'cbui-fab', quiet: 'cbui-fab' },
    /* the main app's dark top bar (app.html .topbar): its own look is drawn there, the size is the one tap rule */
    topbar: { primary: 'cbtb', quiet: 'cbtb' }
  };
  /** The components. label is the English tx() key; shown is the visible text (icon or glyph where the width is tight); verb is the fcode verb (closed list in docs toolset/ui-identity/ui-stamp.cjs VERBS); effect null = the mount must declare it. */
  var ACTION_SET = {
    save: { code: 'CMP001', element: 'CMP001-B01', label: 'Save', shown: 'Save', verb: 'SAVE', effect: null, effectFixed: false, tone: 'primary' },
    dialog: { code: 'CMP002', element: 'CMP002-D01', label: 'Dialog', verb: 'OPEN', effect: 'none', effectFixed: true, tone: 'primary' },
    cancel: { code: 'CMP003', element: 'CMP003-B01', label: 'Cancel', shown: 'Cancel', verb: 'CANCEL', effect: 'none', effectFixed: true, tone: 'quiet' },
    done: { code: 'CMP004', element: 'CMP004-B01', label: 'Done', shown: 'Done', verb: 'CLOSE', effect: 'none', effectFixed: true, tone: 'primary' },
    close: { code: 'CMP005', element: 'CMP005-B01', label: 'Close', shown: '✕', verb: 'CLOSE', effect: 'none', effectFixed: true, tone: 'quiet', nameOnly: true },
    back: { code: 'CMP006', element: 'CMP006-B01', label: 'Back', shown: '‹ Back', verb: 'CLOSE', effect: 'none', effectFixed: true, tone: 'quiet' },
    add: { code: 'CMP007', element: 'CMP007-B01', label: 'Add', shown: '+ Add', verb: 'ADD', effect: 'none', effectFixed: false, tone: 'quiet', nameOnly: false },
    remove: { code: 'CMP008', element: 'CMP008-B01', label: 'Remove', shown: 'Remove', verb: 'REMOVE', effect: 'commit', effectFixed: true, tone: 'quiet' },
    reload: { code: 'CMP009', element: 'CMP009-B01', label: 'Try again', shown: 'Try again', verb: 'RELOAD', effect: 'none', effectFixed: true, tone: 'quiet' },
    open: { code: 'CMP010', element: 'CMP010-B01', label: 'Open', shown: 'Open', verb: 'OPEN', effect: 'none', effectFixed: true, tone: 'quiet' },
    /* the eight of section 3a that CMP001..CMP018 did not yet carry. Delete destroys the record (always a commit, always asks, in the danger style);
       Change is Edit unless it picks a value from a list (Athi 10 Nov); Not now DEFERS and is not Close (Athi 10 Nov); Search/Clear are the list toolbar's two plain actions. */
    delete: { code: 'CMP011', element: 'CMP011-B01', label: 'Delete', shown: 'Delete', verb: 'REMOVE', effect: 'commit', effectFixed: true, tone: 'quiet', danger: true },
    edit: { code: 'CMP012', element: 'CMP012-B01', label: 'Edit', shown: '✎ Edit', verb: 'CHANGE', effect: 'none', effectFixed: true, tone: 'quiet' },
    search: { code: 'CMP013', element: 'CMP013-B01', label: 'Search', shown: 'Search', verb: 'ENTER', effect: 'none', effectFixed: true, tone: 'quiet' },
    clear: { code: 'CMP014', element: 'CMP014-B01', label: 'Clear', shown: '✕ Clear', verb: 'REMOVE', effect: 'none', effectFixed: true, tone: 'quiet' },
    notnow: { code: 'CMP015', element: 'CMP015-B01', label: 'Not now', shown: 'Not now', verb: 'CLOSE', effect: 'none', effectFixed: true, tone: 'quiet' },
    help: { code: 'CMP016', element: 'CMP016-B01', label: 'Help', shown: '?', verb: 'OPEN', effect: 'none', effectFixed: true, tone: 'quiet', nameOnly: true },
    info: { code: 'CMP017', element: 'CMP017-B01', label: 'Info', shown: 'ⓘ Info', verb: 'OPEN', effect: 'none', effectFixed: true, tone: 'quiet' },
    /* Athi 10 Nov: ONE "?" at a FIXED place on every screen (WCAG 2.2 3.2.6 Consistent Help), 44 px target, shown only when HELP_TEXT holds a note for the screen */
    screenhelp: { code: 'CMP019', element: 'CMP019-B01', label: 'Help for this screen', shown: '?', verb: 'OPEN', effect: 'none', effectFixed: true, tone: 'quiet', nameOnly: true, tooltip: true },
    /* Athi 10 Nov: ONE progress component, three levels (see PROGRESS below). Its two parts are components too: the bar (CMP021) and the spinner (CMP022). None is a button. */
    progress: { code: 'CMP020', element: 'CMP020-D01', label: 'Progress', verb: 'OPEN', effect: 'none', effectFixed: true, tone: 'primary', nonButton: true },
    progressbar: { code: 'CMP021', element: 'CMP021-D01', label: 'Progress bar', verb: 'OPEN', effect: 'none', effectFixed: true, tone: 'primary', nonButton: true },
    batch: { code: 'CMP026', element: 'CMP026-D01', label: 'Batch progress', verb: 'OPEN', effect: 'none', effectFixed: true, tone: 'primary', nonButton: true },
    /* CMP032: the line under the batch bar that says in words where a saved job stands (saving, saved, server busy, offline, continuing, keep this tab open) and how it ended (Athi 11 Nov); not a button */
    batchnote: { code: 'CMP032', element: 'CMP032-D01', label: 'Batch job note', verb: 'OPEN', effect: 'none', effectFixed: true, tone: 'quiet', nonButton: true },
    batchtray: { code: 'CMP027', element: 'CMP027-D01', label: 'Batch tray', verb: 'OPEN', effect: 'none', effectFixed: true, tone: 'quiet', nonButton: true },
    spinner: { code: 'CMP022', element: 'CMP022-D01', label: 'Spinner', verb: 'OPEN', effect: 'none', effectFixed: true, tone: 'quiet', nonButton: true },
    /* Athi 10 Nov (wave 2): the three controls the shared shell and the workshop drew by hand. Home is a link (a real address, so it works in a new tab); the label sits in .hw so a phone can show the glyph alone while the aria-label keeps the word. */
    home: { code: 'CMP023', element: 'CMP023-B01', label: 'Home', shown: 'Home', verb: 'OPEN', effect: 'none', effectFixed: true, tone: 'quiet', link: true, labelClass: 'hw' },
    assistant: { code: 'CMP024', element: 'CMP024-B01', label: 'Assistant', shown: '💬 Assistant', verb: 'OPEN', effect: 'none', effectFixed: true, tone: 'primary' },
    /* CMP025: a segmented choice of 2 to 4 values, one selected (a radio group; a presence switch Open, Away, Closed). It is not a button: ui.choice draws it. */
    choice: { code: 'CMP025', element: 'CMP025-D01', label: 'Choice', verb: 'CHANGE', effect: 'none', effectFixed: true, tone: 'quiet', nonButton: true },
    /* Athi 10 Nov (wave 2 step 1b): the three controls of the main app's top bar. Menu is the one icon-alone of the three (menu is in the closed icon-alone set);
       Capabilities and Activity show icon and word, the word (.hw) leaves a phone and the aria-label keeps it. */
    menu: { code: 'CMP028', element: 'CMP028-B01', label: 'Menu', shown: '☰', verb: 'OPEN', effect: 'none', effectFixed: true, tone: 'quiet', nameOnly: true },
    legend: { code: 'CMP029', element: 'CMP029-B01', label: 'Capabilities', shown: 'Capabilities', verb: 'OPEN', effect: 'none', effectFixed: true, tone: 'quiet', labelClass: 'hw' },
    /* CMP031: moves a running batch from the centre panel to the corner tray, so the screen is free (Athi 11 Nov); Ctrl+B does the same */
    background: { code: 'CMP031', element: 'CMP031-B01', label: 'Run in background', shown: 'Run in background', verb: 'MOVE', effect: 'none', effectFixed: true, tone: 'quiet', labelClass: 'hw', shortcut: 'Control+B' },
    activity: { code: 'CMP030', element: 'CMP030-B01', label: 'Activity', shown: 'Activity', verb: 'OPEN', effect: 'none', effectFixed: true, tone: 'quiet', labelClass: 'hw' },
    more: { code: 'CMP018', element: 'CMP018-B01', label: 'More', shown: '⋯', verb: 'OPEN', effect: 'none', effectFixed: true, tone: 'quiet', nameOnly: true, popup: 'menu' },
    /* Athi 11 Nov (wave 2, customer side, step 1): the list control's own components. list-ctl.js (CBList) reads nothing from its page, so it cannot call
       ui.action: it writes these elements itself with their register codes (data-cbsid), and CMP009 Try again / CMP014 Clear are its reused mounts. Registered here so the
       code, the verb and the element kinds have ONE home; none is drawn by ui.action (nonButton). Elements: CMP045 I01 search, I02 date, I03 tick; CMP033 B01 opener
       (period, notices, Filters, Columns, header filter), D01 popover, M01 menu choice; CMP034 B01 pressed toggle; CMP035 S01 select; CMP036 K01 saved-view tab;
       CMP037 B01 CSV, B02 reset columns, B03 select all shown, B04 bulk action, B05 show more, B06 pager Previous, B07 pager Next; CMP038 B01 row action; CMP039 B01 sort, B02 resize, B03 move column. */
    listfield: { code: 'CMP045', element: 'CMP045-I01', elements: ['I01', 'I02', 'I03'], label: 'List field', alias_of: 'CMP055', verb: 'ENTER', effect: 'none', effectFixed: true, tone: 'quiet', nonButton: true },
    listopener: { code: 'CMP033', element: 'CMP033-B01', elements: ['B01', 'D01', 'M01'], label: 'List opener', verb: 'OPEN', effect: 'none', effectFixed: true, tone: 'quiet', nonButton: true },
    listtoggle: { code: 'CMP034', element: 'CMP034-B01', elements: ['B01'], label: 'List toggle', verb: 'CHANGE', effect: 'none', effectFixed: true, tone: 'quiet', nonButton: true },
    listselect: { code: 'CMP035', element: 'CMP035-S01', elements: ['S01'], label: 'List select', verb: 'CHOOSE', effect: 'none', effectFixed: true, tone: 'quiet', nonButton: true },
    listtab: { code: 'CMP036', element: 'CMP036-K01', elements: ['K01'], label: 'List tab', verb: 'CHOOSE', effect: 'none', effectFixed: true, tone: 'quiet', nonButton: true },
    listcommand: { code: 'CMP037', element: 'CMP037-B01', elements: ['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07'], label: 'List command', verb: 'DOWNLOAD', effect: 'none', effectFixed: true, tone: 'quiet', nonButton: true },
    listrowaction: { code: 'CMP038', element: 'CMP038-B01', elements: ['B01'], label: 'List row action', verb: 'OPEN', effect: 'none', effectFixed: true, tone: 'quiet', nonButton: true },
    listcolumn: { code: 'CMP039', element: 'CMP039-B01', elements: ['B01', 'B02', 'B03'], label: 'List column header', verb: 'MOVE', effect: 'none', effectFixed: true, tone: 'quiet', nonButton: true },
    /* Athi 11 Nov (wave 2, customer side, step 2): the Books screens' own components (cap-books.js: accounts, crm, finance, tasks). It reuses CMP001 Save, CMP003 Cancel, CMP004 Done,
       CMP005 Close, CMP006 Back, CMP007 Add, CMP009 Try again, CMP010 Open, CMP012 Edit, CMP014 Clear; these five are what had no component. Elements: CMP040 I01 text/number/money/search,
       I02 date, I03 tick, T01 free text; CMP041 S01 select; CMP042 B01..B25 the books' commands (pay, record, remind, show, statement, fold list, lock, unlock, close for good, pack, opening
       balances, cheque step, waiting-bill link, add supplier, accept / reject short, advance, reverse, GST note, resize pane, record discount, pay anyway), P01 row tools; CMP043 K01 tab, K02 ledger tree item;
       CMP044 C01 day bills link, C02 chit link, C03 reversal link. cap-books.js writes them with their codes (data-cbsid); none is drawn by ui.action (nonButton). */
    bookfield: { code: 'CMP040', element: 'CMP040-I01', elements: ['I01', 'I02', 'I03', 'T01'], label: 'Books field', alias_of: 'CMP055', verb: 'ENTER', effect: 'none', effectFixed: true, tone: 'quiet', nonButton: true },
    bookselect: { code: 'CMP041', element: 'CMP041-S01', elements: ['S01'], label: 'Books select', alias_of: 'CMP056', verb: 'CHOOSE', effect: 'none', effectFixed: true, tone: 'quiet', nonButton: true },
    bookaction: { code: 'CMP042', element: 'CMP042-B01', alias_of: 'CMP057', elements: ['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B09', 'B10', 'B11', 'B12', 'B13', 'B14', 'B15', 'B16', 'B17', 'B18', 'B19', 'B20', 'B21', 'B22', 'B23', 'B24', 'B25', 'P01'], label: 'Books action', verb: 'OPEN', effect: 'none', effectFixed: true, tone: 'quiet', nonButton: true },
    booktab: { code: 'CMP043', element: 'CMP043-K01', elements: ['K01', 'K02'], label: 'Books tab', verb: 'CHOOSE', effect: 'none', effectFixed: true, tone: 'quiet', nonButton: true },
    booklink: { code: 'CMP044', element: 'CMP044-C01', elements: ['C01', 'C02', 'C03'], label: 'Books link', verb: 'OPEN', effect: 'none', effectFixed: true, tone: 'quiet', nonButton: true },
    /* CMP055 FIELD (UX-137, docs WEB-FIELD-PART): one part for text-like, date, time, checkbox, file and long text, drawn by ui.field (app/ui-field.js). It WIDENS CMP040 and CMP045, which stay valid aliases until their pages convert. Elements: I01 text-like, I02 date and time, I03 checkbox, I04 file, T01 long text. A field never confirms. */
    field: { code: 'CMP055', element: 'CMP055-I01', elements: ['I01', 'I02', 'I03', 'I04', 'T01'], label: 'Field', verb: 'ENTER', effect: 'none', effectFixed: true, tone: 'quiet', nonButton: true },
    /* CMP056 SELECT (UX-137, plan 6.2): one pick-one list, drawn by ui.select (app/ui-select.js). It takes over CMP035 List select and CMP041 Books select as aliases. A select never confirms. */
    select: { code: 'CMP056', element: 'CMP056-S01', elements: ['S01'], label: 'Select', verb: 'CHOOSE', effect: 'none', effectFixed: true, tone: 'quiet', nonButton: true },
    /* CMP057 COMMAND (UX-137, plan 6.2): a button with its OWN label and its own verb from the closed list, for the commands the fixed set has no word for (Tick all shown). The mount declares label, verb and effect;
       a commit confirms first like every other commit. It takes over CMP042 Books action as an alias. */
    command: { code: 'CMP057', element: 'CMP057-B01', label: 'Command', verb: 'OPEN', effect: null, effectFixed: false, tone: 'quiet', own: true },
    figure: { code: 'CMP060', element: 'CMP060-D01', label: 'Figure card', verb: 'OPEN', effect: 'none', effectFixed: true, tone: 'quiet', nonButton: true }, badge: { code: 'CMP061', element: 'CMP061-D01', label: 'Initials badge', verb: 'OPEN', effect: 'none', effectFixed: true, tone: 'quiet', nonButton: true },
    statusicon: { code: 'CMP064', element: 'CMP064-D01', label: 'Status icon', verb: 'OPEN', effect: 'none', effectFixed: true, tone: 'quiet', nonButton: true },
    bankband: { code: 'CMP065', element: 'CMP065-D01', elements: ['D01', 'D02', 'D03'], label: 'Bank statement band', verb: 'OPEN', effect: 'none', effectFixed: true, tone: 'quiet', nonButton: true }
  };
  Object.keys(ACTION_SET).forEach(function (key) {
    ACTION_SET[key].name = key;
  });
  var HANDLERS = {};
  /** English through the catalogue; with a key (CMP001.label) the translation is found by the key and English is only the default */
  function words(text, key) {
    if (typeof tx !== 'function') return text;
    return key ? tx(text, { key: key }) : tx(text);
  }
  /** a sentence with {placeholders} (ICU style): translated by its key, the values put in after */
  function phrase(english, key, values) {
    if (typeof txf === 'function') return txf(english, values, { key: key });
    return english.replace(/\{(\w+)\}/g, function (whole, name) {
      return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : whole;
    });
  }
  /** the stable key of one text of a component: CMP001.label, CMP001.shown, CMP001.aria (the register's code, never the English words) */
  function textKey(component, part) {
    return component.code + '.' + part;
  }
  function escapeText(text) {
    if (typeof esc === 'function') return esc(text);
    return String(text == null ? '' : text).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }
  function refuse(reason) {
    throw new Error('ui.action: ' + reason);
  }
  /** the look properties: surface, size and display (icon alone only where the rule allows it) */
  function checkLook(name, component, options) {
    if (options.surface && !TONE_CLASS[options.surface]) refuse(name + ': surface must be page, dialog, chip, list, pill, bar, shell, float or topbar');
    if (options.size && SIZES.indexOf(options.size) < 0) refuse(name + ': size must be standard or compact');
    if (options.display && DISPLAYS.indexOf(options.display) < 0) refuse(name + ': display must be icon or icon+label');
    var iconAlone = options.display === 'icon';
    if (iconAlone && (ICON_ONLY.indexOf(name) < 0 || component.effect === 'commit')) {
      refuse(name + ': icon alone is for close, search, add, menu, back, edit and help only; this action shows icon and label');
    }
  }
  /** a property outside the schema, or one that only the component fixes, is refused (never silently dropped) */
  function checkOptions(name, component, options) {
    Object.keys(options).forEach(function (property) {
      if (ALLOWED_OPTIONS.indexOf(property) < 0) refuse(name + ': "' + property + '" is not a property of the component');
    });
    if (!MOUNT_CODE.test(options.mount || '')) refuse(name + ': mount must be a screen mount code like ACC002-U01');
    checkOwnWords(name, component, options);
    checkLook(name, component, options);
    if (options.tone && TONES.indexOf(options.tone) < 0) refuse(name + ': tone must be primary or quiet');
    if (options.effect && EFFECTS.indexOf(options.effect) < 0) refuse(name + ': effect must be none, preference or commit');
    if (options.effect && component.effectFixed && options.effect !== component.effect) refuse(name + ': effect is fixed at ' + component.effect);
  }
  /** CMP057 only: its own label and a verb from the closed list; every other component has its label fixed (never silently dropped) */
  function checkOwnWords(name, component, options) {
    if (component.own) return checkCommandWords(name, options);
    if (options.label !== undefined || options.verb !== undefined) refuse(name + ': label and verb are fixed by the component (only command takes its own)');
  }
  function checkCommandWords(name, options) {
    if (!options.label || !String(options.label).trim()) refuse(name + ': give the label the person reads (it names the button)');
    if (options.display) refuse(name + ': a command shows its label (no icon alone, no icon of its own)');
    if (COMMAND_VERBS.indexOf(options.verb) < 0) refuse(name + ': verb must be one of ' + COMMAND_VERBS.join(', '));
  }
  /** what the press does for the person: none, a plain preference save, or a commit that asks first */
  function effectOf(name, component, options) {
    var effect = options.effect || component.effect;
    if (!effect) refuse(name + ': say effect "preference" or "commit" (a Save is one or the other)');
    if (effect === 'commit' && !options.confirm && options.confirmedBy !== 'page') {
      refuse(name + ': a commit confirms first: give confirm {title, body, yes} (the reach), or confirmedBy "page" while its handler asks');
    }
    return effect;
  }
  function attributeList(pairs) {
    return pairs
      .filter(function (pair) {
        return pair[1] !== null && pair[1] !== undefined && pair[1] !== false;
      })
      .map(function (pair) {
        return pair[1] === true ? pair[0] : pair[0] + '="' + escapeText(pair[1]) + '"';
      })
      .join(' ');
  }
  /** the data-* bag of one mount, e.g. { 'pol-act': 'save' } -> data-pol-act="save" */
  function dataAttributes(values) {
    return Object.keys(values || {}).map(function (suffix) {
      return ['data-' + suffix, String(values[suffix])];
    });
  }
  /** the role gate { ok, why }: a refused action stays visible, greyed WITH its sentence (show-action rule) */
  function gateAttributes(options) {
    var reason = disabledReason(options);
    if (reason === null) return [];
    return [['aria-disabled', 'true'], ['data-disabled', '1'], ['aria-describedby', whyId(options)], ['title', reason]];
  }
  /** the reason a mount is disabled: role {ok:false, why} (permission) outranks disabled: 'sentence' (state); null when enabled. A disabled with no sentence is refused (show-action rule: greyed WITH its sentence). */
  function disabledReason(options) {
    var role = options.role;
    if (role && role.ok === false) return String(role.why || '');
    if (options.disabled === undefined || options.disabled === false) return null;
    if (typeof options.disabled !== 'string' || !options.disabled.trim()) refuse('disabled: give the reason as a sentence (disabled: "Needs the owner"); a greyed action always says why');
    return options.disabled;
  }
  var whyCount = 0;
  /** the id of the visually hidden reason element written beside a disabled button */
  function whyId(options) {
    if (options.whyId) return options.whyId;
    return 'cbui-why-' + String(options.mount).toLowerCase() + (options.key ? '-' + String(options.key).toLowerCase().replace(/[^a-z0-9_-]/g, '') : '');
  }
  function toneClass(options, component, surface) {
    var tone = options.tone || component.tone;
    var classes = TONE_CLASS[surface];
    return classes[tone] !== undefined ? classes[tone] : classes.primary;
  }
  /** the accessible name: the label plus the object when one is given ("Save" + "policy" -> "Save policy"); an icon-only action always has one */
  function displayOf(component, options) {
    return options.display || (component.nameOnly ? 'icon' : null);
  }
  function accessibleName(component, options) {
    if (component.own) return options.object ? words(options.label) + ' ' + words(options.object) : null;
    if (options.object) return phrase(component.label + ' {object}', textKey(component, 'aria'), { object: words(options.object) });
    if (component.labelClass) return words(component.label, textKey(component, 'label'));
    return displayOf(component, options) === 'icon' ? words(component.label, textKey(component, 'label')) : null;
  }
  /** one press handler per mount (+ key), found again by the single delegated listener below */
  function registerPress(options) {
    if (typeof options.onPress !== 'function') return;
    HANDLERS[options.mount + '|' + (options.key || '')] = options;
  }
  /** the attributes of one button, in reading order; a null value is left out by attributeList */
  function buttonAttributes(component, options, surface, effect) {
    return [
      ['data-cbsid', component.element],
      ['data-cbname', component.name],
      ['data-cbmount', options.mount],
      ['data-effect', effect === 'none' ? null : effect],
      ['type', component.link ? null : 'button'],
      ['href', component.link ? options.href : null],
      ['class', toneClass(options, component, surface) || null],
      ['style', options.hidden ? 'display:none' : null],
      ['id', options.id || null],
      ['data-testid', options.testid || null],
      ['aria-label', accessibleName(component, options)],
      ['data-key', options.key || null],
      ['aria-busy', options.busy ? 'true' : null]
    ]
      .concat(lookAttributes(component, options))
      .concat(shortcutAttributes(component))
      .concat(verbAttributes(component, options))
      .concat(gateAttributes(options))
      .concat(dataAttributes(options.data));
  }
  /** CMP057 Command carries the verb its mount chose, for the register and the walks */
  function verbAttributes(component, options) {
    return [['data-cbverb', component.own ? options.verb : null]];
  }
  /** a component with a keyboard shortcut says so to assistive technology (Run in background: Control+B) */
  function shortcutAttributes(component) {
    return [['aria-keyshortcuts', component.shortcut || null]];
  }
  /** the tooltip of an icon alone, the compact size, and the menu a More opens */
  function lookAttributes(component, options) {
    var tooltip = component.tooltip || displayOf(component, options) === 'icon';
    return [
      ['title', disabledReason(options) !== null ? null : options.hint ? words(options.hint) : tooltip ? accessibleName(component, options) : null],
      ['data-size', options.size === 'compact' ? 'compact' : null],
      ['aria-haspopup', component.popup || null],
      ['aria-expanded', component.popup ? String(!!options.expanded) : null]
    ];
  }
  /** the visible text: a glyph stays as written, a word goes through tx() */
  function shownText(component, options) {
    var look = displayOf(component, options || {});
    if (look === 'icon') return options && options.display === 'icon' ? iconHtml(component.name) : escapeText(component.shown);
    if (look === 'icon+label') return withIcon(component, labelText(component, options));
    return escapeText(component.nameOnly ? component.shown : labelText(component, options));
  }
  /** the words of a component: a glyph-only one says its label, the others their visible text, both through their keys */
  function labelText(component, options) {
    if (component.own) return words(options.label);
    return component.nameOnly ? words(component.label, textKey(component, 'label')) : words(component.shown, textKey(component, 'shown'));
  }
  /** the icon as markup: an SVG is trusted markup, a glyph is text */
  function iconHtml(name) {
    var icon = ICON[name];
    return icon.charAt(0) === '<' ? icon : escapeText(icon);
  }
  /** icon and label: the one icon in front (hidden from screen readers, which read only the label), unless the text already carries it */
  function withIcon(component, text) {
    if (text.indexOf(ICON[component.name]) >= 0) return escapeText(text);
    var label = component.labelClass ? '<span class="' + component.labelClass + '">' + escapeText(text) + '</span>' : escapeText(text);
    return '<span aria-hidden="true">' + iconHtml(component.name) + '</span>' + (component.labelClass ? '' : ' ') + label;
  }
  /** the button's HTML for a surface ('page' or 'dialog'); the one place the markup of an action is written */
  function render(name, options, surface) {
    var component = ACTION_SET[name];
    if (!component || name === 'dialog' || component.nonButton) refuse('unknown action "' + name + '"');
    options = options || {};
    checkOptions(name, component, options);
    var effect = effectOf(name, component, options);
    registerPress(options);
    ensureStyle();
    return markup(component, options, surface, effect);
  }
  /** the one element of a component: a button, or an a for a link (which must carry its href) */
  function markup(component, options, surface, effect) {
    var name = component.name;
    var tag = component.link ? 'a' : 'button';
    if (component.link && !options.href) refuse(name + ': a link needs href');
    if (disabledReason(options) !== null) options = Object.assign({}, options, { whyId: whyId(options) + '-' + (++whyCount) });
    var html = '<' + tag + ' ' + attributeList(buttonAttributes(component, options, surface, effect)) + '>' + shownText(component, options) + '</' + tag + '>' + reasonNote(options);
    /* born accessible: a visible text and an accessible name, always (the axe rules label-title-only and button-name cannot return through a component) */
    if (!shownText(component, options).trim()) refuse(name + ': no visible text');
    return html;
  }
  /** the reason of a disabled action as real text, beside the button, named by its aria-describedby */
  function reasonNote(options) {
    var reason = disabledReason(options);
    return reason === null ? '' : '<span id="' + whyId(options) + '" class="cbui-sr">' + escapeText(reason) + '</span>';
  }
  /** The tap rule for a control a screen still draws itself (a nonButton component: the books' commands): the attributes that put it under the one size rule (compact: 32 px on a desktop, 44 on a phone) and make sure that rule's stylesheet is in. It changes no look and no press; the screen keeps its own handler. */
  function tapAttributes(name) {
    var component = ACTION_SET[name];
    if (!component || !component.nonButton) refuse('tap: "' + name + '" is not a component a screen draws itself');
    ensureStyle();
    return ' data-cbname="' + component.name + '" data-size="compact"';
  }
  function action(name, options) {
    return render(name, options, (options && options.surface) || 'page');
  }
  /** a footer button: the same component, drawn in the modal's own button classes */
  function dialogAction(name, options) {
    return render(name, options, 'dialog');
  }

  /* ── CMP025 CHOICE: a choice of 2 to 4 values, one selected; ONE component in two modes (Athi 10 Nov: icon and word always, no glyph alone).
     Wide screen: segments (a radio group; 32 px compact, the one size rule). Phone width (700 px and under): ONE 44 px button showing the current value as
     icon and word ("🟢 Open ▾") that opens the values as a listbox menu (arrows, Home, End, Enter, Esc; focus returns to the button).
     A press calls onChange(value); choiceSet(group, value) repaints from outside (a refused change, a confirm that said no). ── */
  var CHOICES = {};
  var CHEVRON = '▾';
  /** the attributes a segment and a menu option share */
  function choiceAttrs(options, item, role, size) {
    return [
      ['type', 'button'], ['role', role], ['data-cbname', 'choice'], ['data-cbmount', options.mount], ['data-choice-value', item.value],
      ['data-size', size === 'compact' ? 'compact' : null], ['data-testid', options.testid ? options.testid + '-' + item.value + (role === 'option' ? '-option' : '') : null]
    ];
  }
  function choiceItem(options, item, selected, size, tabbable) {
    var attrs = choiceAttrs(options, item, 'radio', size).concat([['aria-checked', String(selected)], ['tabindex', tabbable ? '0' : '-1']]);
    return '<button data-cbsid="CMP025-B01" ' + attributeList(attrs) + '>' + escapeText(words(item.label)) + '</button>';
  }
  function choiceOption(options, item, selected) {
    var attrs = choiceAttrs(options, item, 'option', 'standard').concat([['aria-selected', String(selected)], ['tabindex', '-1']]);
    return '<button data-cbsid="CMP025-B01" ' + attributeList(attrs) + '>' + escapeText(words(item.label)) + '</button>';
  }
  /** the phone mode's one button: the current value, icon and word, and a chevron */
  function choiceTrigger(options) {
    var current = options.items.filter(function (item) { return item.value === options.value; })[0] || options.items[0];
    var attrs = [
      ['type', 'button'], ['class', 'cbui-choice-btn'], ['data-choice-trigger', true], ['aria-haspopup', 'listbox'], ['aria-expanded', 'false'],
      ['data-cbname', 'choice'], ['data-cbmount', options.mount], ['data-size', 'compact']
    ];
    return '<button data-cbsid="CMP025-B01" ' + attributeList(attrs) + '><span class="cbui-cur">' + escapeText(words(current.label)) + '</span> <span aria-hidden="true">' + CHEVRON + '</span></button>';
  }
  function choiceMenu(options) {
    var items = options.items.map(function (item) { return choiceOption(options, item, item.value === options.value); }).join('');
    return '<div class="cbui-choice-menu" role="listbox" aria-label="' + escapeText(words(options.label)) + '" hidden>' + items + '</div>';
  }
  /** the one segment Tab reaches: the selected one, or the first when no value matches (the group must stay reachable) */
  function tabbableItem(options, item) {
    var matched = options.items.some(function (other) { return other.value === options.value; });
    return matched ? item.value === options.value : item === options.items[0];
  }
  function checkChoice(options) {
    if (!MOUNT_CODE.test(options.mount || '')) refuse('choice: mount must be a screen mount code like ACC002-U01');
    if (!options.items || options.items.length < 2 || options.items.length > 4) refuse('choice: 2 to 4 values');
    if (!options.label) refuse('choice: a label (the group\'s accessible name)');
    if (options.size && SIZES.indexOf(options.size) < 0) refuse('choice: size must be standard or compact');
  }
  /** the attributes of the group element */
  function choiceHead(options) {
    return attributeList([
      ['role', 'radiogroup'], ['class', 'cbui-choice' + (options.cls ? ' ' + options.cls : '')], ['data-cbsid', ACTION_SET.choice.element],
      ['data-cbmount', options.mount], ['data-key', options.key || null], ['aria-label', words(options.label)], ['title', options.hint ? words(options.hint) : null],
      ['data-value', options.value], ['id', options.id || null], ['data-testid', options.testid || null]
    ]);
  }
  /** ui.choice({ mount, key, label, value, items: [{ value, label }], onChange, size, id, testid, cls, hint }) -> the group's HTML */
  function choice(options) {
    options = options || {};
    checkChoice(options);
    CHOICES[options.mount + '|' + (options.key || '')] = options;
    ensureStyle();
    var segments = options.items.map(function (item) { return choiceItem(options, item, item.value === options.value, options.size, tabbableItem(options, item)); }).join('');
    return '<div ' + choiceHead(options) + '>' + segments + choiceTrigger(options) + choiceMenu(options) + '</div>';
  }
  /** repaint the group to a value (no onChange): used when a change was refused or confirmed away */
  function choiceSet(group, value) {
    if (!group || !group.querySelectorAll) return;
    group.setAttribute('data-value', String(value));
    Array.prototype.forEach.call(group.querySelectorAll('[role="radio"]'), function (segment) {
      var on = segment.getAttribute('data-choice-value') === String(value);
      segment.setAttribute('aria-checked', String(on));
      segment.setAttribute('tabindex', on ? '0' : '-1');
      if (on) group.querySelector('.cbui-cur').textContent = segment.textContent;
    });
    Array.prototype.forEach.call(group.querySelectorAll('[role="option"]'), function (option) {
      option.setAttribute('aria-selected', String(option.getAttribute('data-choice-value') === String(value)));
    });
    if (!group.querySelector('[aria-checked="true"]')) group.querySelector('[role="radio"]').setAttribute('tabindex', '0');
  }
  /** open or close the phone menu; opening puts focus on the chosen value, closing gives it back to the button */
  function setChoiceMenu(group, open) {
    var menu = group.querySelector('.cbui-choice-menu');
    var trigger = group.querySelector('[data-choice-trigger]');
    menu.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    if (open) (menu.querySelector('[aria-selected="true"]') || menu.querySelector('[role="option"]')).focus();
    else if (group.contains(document.activeElement) || document.activeElement === document.body) trigger.focus();
  }
  function choiceOf(segment) {
    var group = segment.closest('[data-choice-root]') || segment.closest('.cbui-choice');
    return { group: group, options: group && CHOICES[group.getAttribute('data-cbmount') + '|' + (group.getAttribute('data-key') || '')] };
  }
  /** a press on a segment or a menu option: repaint, tell the page, close the menu */
  function onChoiceClick(segment) {
    var found = choiceOf(segment);
    if (!found.options) return;
    var value = segment.getAttribute('data-choice-value');
    var changed = value !== found.group.getAttribute('data-value');
    if (changed) choiceSet(found.group, value);
    if (segment.getAttribute('role') === 'option') setChoiceMenu(found.group, false);
    if (changed && typeof found.options.onChange === 'function') found.options.onChange(value);
  }
  /** a press on the phone button opens or closes its menu; a press anywhere else closes every open menu */
  function onChoiceTrigger(event) {
    var trigger = closestOf(event, '[data-choice-trigger]');
    if (trigger && trigger.getAttribute('data-choice-trigger') === null) trigger = null;
    Array.prototype.forEach.call(document.querySelectorAll('.cbui-choice-menu:not([hidden])'), function (menu) {
      var group = menu.closest('.cbui-choice');
      if (!trigger || group !== trigger.closest('.cbui-choice')) setChoiceMenu(group, false);
    });
    if (!trigger) return false;
    var group = trigger.closest('.cbui-choice');
    setChoiceMenu(group, group.querySelector('.cbui-choice-menu').hidden);
    return true;
  }
  function isRtl(group) {
    var view = group.ownerDocument && group.ownerDocument.defaultView;
    return !!view && view.getComputedStyle(group).direction === 'rtl';
  }
  /** where a key moves the selection: arrows step (left and right swap in a right-to-left page), Home and End jump; -1 is no move */
  function targetIndex(key, index, count, rightToLeft) {
    if (key === 'Home') return 0;
    if (key === 'End') return count - 1;
    var sideways = rightToLeft ? { ArrowRight: -1, ArrowLeft: 1 } : { ArrowRight: 1, ArrowLeft: -1 };
    var step = sideways[key] || { ArrowDown: 1, ArrowUp: -1 }[key];
    return step ? (index + step + count) % count : -1;
  }
  /** keys on a segment: the selection follows the focus (radio-group keyboard, WAI-ARIA APG) */
  function onSegmentKey(event, segment) {
    var group = segment.closest('[role="radiogroup"]');
    var all = Array.prototype.slice.call(group.querySelectorAll('[role="radio"]'));
    var next = all[targetIndex(event.key, all.indexOf(segment), all.length, isRtl(group))];
    if (!next) return;
    event.preventDefault();
    next.focus();
    onChoiceClick(next);
  }
  /** keys in the phone menu: arrows, Home and End move the focus, Esc and Tab close it (Enter and Space press the option itself) */
  function onMenuKey(event, option) {
    var group = option.closest('.cbui-choice');
    var all = Array.prototype.slice.call(group.querySelectorAll('[role="option"]'));
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      return setChoiceMenu(group, false);
    }
    var next = all[targetIndex(event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? '' : event.key, all.indexOf(option), all.length, false)];
    if (!next) return;
    event.preventDefault();
    next.focus();
  }
  /** ArrowDown or ArrowUp on the phone button opens its menu */
  function onTriggerKey(event, trigger) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    setChoiceMenu(trigger.closest('.cbui-choice'), true);
  }
  function onChoiceKey(event) {
    var target = event.target && event.target.closest ? event.target : null;
    if (!target) return;
    var segment = target.closest('[role="radio"][data-choice-value]');
    var option = target.closest('[role="option"][data-choice-value]');
    var trigger = target.closest('[data-choice-trigger]');
    if (segment) onSegmentKey(event, segment);
    else if (option) onMenuKey(event, option);
    else if (trigger) onTriggerKey(event, trigger);
  }
  /** Ctrl+B (Cmd+B on a Mac) moves the open batch panel to the corner tray; it is taken only while a panel is open (the app's own key handler ignores every Ctrl key, so nothing clashes) */
  function onBatchKey(event) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || String(event.key).toLowerCase() !== 'b') return;
    if (!runningPanel || runningPanel.tray || runningPanel.ended) return;
    if (event.preventDefault) event.preventDefault();
    runningPanel.toTray();
  }
  /** runs the registered press through CBAction (busy, one press one write, and the confirm for a commit) */
  function press(button, options) {
    var pressHandler = function () {
      return options.onPress(button);
    };
    var key = options.mount + (options.key ? '-' + options.key : '');
    var effect = button.getAttribute('data-effect');
    /* a plain press (Cancel, Back, Open) has no busy state and no outcome sentence: only a write goes through CBAction */
    if (!effect || typeof CBAction === 'undefined' || !CBAction || typeof CBAction.run !== 'function') return pressHandler();
    return CBAction.run(button, pressHandler, effect === 'commit' ? { key: key, confirm: confirmOf(button, options) } : { key: key });
  }
  /** a Delete always asks in the danger style, whatever the mount wrote */
  function confirmOf(button, options) {
    var confirmation = options.confirm;
    var component = ACTION_SET[button.getAttribute('data-cbname')];
    return confirmation && component && component.danger ? Object.assign({}, confirmation, { danger: true }) : confirmation;
  }
  /** the nearest element of the click that matches a selector, or null */
  function closestOf(event, selector) {
    return event.target && event.target.closest ? event.target.closest(selector) : null;
  }
  function onDocumentClick(event) {
    var segment = closestOf(event, '[data-choice-value]');
    if (segment && segment.getAttribute('data-choice-value') !== null) return onChoiceClick(segment);
    if (onChoiceTrigger(event)) return;
    var button = closestOf(event, '[data-cbmount]');
    if (!button || button.disabled) return;
    if (button.getAttribute('aria-disabled') === 'true') return refusePress(event, button);
    var options = HANDLERS[button.getAttribute('data-cbmount') + '|' + (button.getAttribute('data-key') || '')];
    if (options) press(button, options);
  }
  /** aria-disabled does not block events, so the script does: no handler, no submit, no link; the reason is shown once (the page's toast, else the polite live region) */
  function refusePress(event, button) {
    if (event.preventDefault) event.preventDefault();
    if (event.stopPropagation) event.stopPropagation();
    var note = button.getAttribute('aria-describedby') && typeof document.getElementById === 'function' && document.getElementById(button.getAttribute('aria-describedby'));
    var reason = (note && note.textContent) || button.getAttribute('title') || '';
    if (!reason) return;
    if (typeof toast === 'function') toast(reason);
    else announce(reason);
  }
  /** a form whose submitter is aria-disabled does not submit (Enter in a field, a script's requestSubmit) */
  function onDocumentSubmit(event) {
    var submitter = event.submitter;
    if (submitter && submitter.getAttribute && submitter.getAttribute('aria-disabled') === 'true' && event.preventDefault) event.preventDefault();
  }
  /** a footer entry { name, options }: Cancel and Close close the dialog unless the mount gave its own press */
  function footerAction(item) {
    var options = Object.assign({}, item.options);
    var closes = item.name === 'cancel' || item.name === 'close';
    if (closes && typeof options.onPress !== 'function' && typeof closeModal === 'function') options.onPress = closeModal;
    return dialogAction(item.name, options);
  }
  /** the popup code a caller names must be the register's own shape, POP and three digits (POPUP-FAMILIES G9) */
  function checkPop(code) {
    if (code && !/^POP\d{3}$/.test(code)) refuse('dialog: pop must be a register code like POP098');
  }
  /** the optional id, data-testid and style of a dialog part, as attribute text (empty when none is given) */
  function ownAttrs(id, testid, style) {
    return (id ? ' id="' + escapeText(id) + '"' : '') + (testid ? ' data-testid="' + escapeText(testid) + '"' : '') + (style ? ' style="' + escapeText(style) + '"' : '');
  }
  /** the dialog's second line: a span.sub, or (subClass given, for a page whose own css styles another class) a div of that class */
  function subLine(options) {
    var tag = options.subClass ? 'div' : 'span';
    return '<' + tag + ' class="' + escapeText(options.subClass || 'sub') + '"' + (options.subId ? ' id="' + escapeText(options.subId) + '"' : '') + '>' + escapeText(options.subText || '') + '</' + tag + '>';
  }
  /** the header's own line: the title (a literal the catalogue translates, or titleText already resolved), the optional second line, the popup-code chip */
  function dialogHeadText(options) {
    var title = options.titleText !== undefined ? options.titleText : words(options.title);
    var sub = options.subText || options.subId ? subLine(options) : '';
    var chip = options.pop && typeof CBScreenId !== 'undefined' && CBScreenId.popupChip ? CBScreenId.popupChip(options.pop, 'margin-inline-start:auto') : '';
    return '<div class="t"' + ownAttrs(options.titleId, options.titleTestid) + '>' + escapeText(title) + '</div>' + sub + chip;
  }
  function dialogHead(options) {
    var pop = options.pop ? ' data-pop="' + escapeText(options.pop) + '"' : '';
    return '<div class="mhd" data-cbsid="' + ACTION_SET.dialog.element + '" data-cbmount="' + escapeText(options.mount) + '"' + pop + '>' + dialogHeadText(options) + '</div>';
  }
  /** MNT-63: the popup's main action wears the register's key for assistive technology; the one shared listener (shortcuts.js) presses it */
  function markMainAction(pop) {
    var keys = typeof CBShortcuts !== 'undefined' && pop ? CBShortcuts : null;
    var host = keys && keys.keyOf(pop) ? document.querySelector('dialog[open], #modalhost') : null;
    var button = host ? keys.mainOf(host) : null;
    if (button) button.setAttribute('aria-keyshortcuts', keys.keyOf(pop));
  }
  /** the first field of a form takes the keyboard when the popup opens (WCAG 2.4.3); a popup with none leaves the host's own first stop */
  function focusFirstField() {
    var host = typeof document !== 'undefined' && document.querySelector ? document.querySelector('dialog[open] .mbody, #modalhost .mbody') : null;
    var field = host ? host.querySelector('input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea:not([disabled])') : null;
    if (field && field.focus) field.focus();
  }
  /** the refusals of a dialog call, then its footer actions */
  function checkDialog(options) {
    if (typeof modal !== 'function') refuse('dialog: no modal() on this page');
    if (!MOUNT_CODE.test(options.mount || '')) refuse('dialog: mount must be a screen mount code like ACC002-U01');
    checkPop(options.pop);
    var list = options.actions || [];
    if (list.length > 4) refuse('dialog: at most 4 actions');
    if (options.footerHtml !== undefined && list.length) refuse('dialog: give actions or footerHtml, not both');
    return list;
  }
  /** the footer: the caller's own HTML, or the standard actions; the id is for a footer a step wizard repaints */
  function dialogFoot(options, list) {
    var inner = options.footerHtml !== undefined ? options.footerHtml : list.map(footerAction).join('');
    return '<div class="mfoot"' + (options.footId ? ' id="' + escapeText(options.footId) + '"' : '') + '>' + inner + '</div>';
  }
  function dialogBody(options) {
    return '<div class="mbody"' + ownAttrs(options.bodyId, options.testid, options.bodyStyle) + '>' + (options.body || '') + '</div>';
  }
  /** ui.dialog({ mount, title | titleText, titleId, titleTestid, subText, subClass, subId, footId, pop, testid, bodyId, bodyStyle, body, actions: [{ name, options }] | footerHtml, wide }) — opens through the app's modal(); the corner X is modal()'s own .mx. Actions are standard components only, Cancel/Close first, the primary last. pop is the popup's register code (POP###), written on the header (data-pop). footerHtml is for a footer the caller keeps drawing itself (a step wizard); its buttons carry their own codes. Not wired yet: onClose. */
  function dialog(options) {
    options = options || {};
    var list = checkDialog(options);
    modal(dialogHead(options) + dialogBody(options) + dialogFoot(options, list), !!options.wide, options.opt);
    markMainAction(options.pop);
    focusFirstField();
  }
  /* ── CMP020 PROGRESS (Athi 10 Nov): one component, three levels (Nielsen response-time limits, Apple HIG, Material).
     under ~1 s nothing shows (PROGRESS_DELAY_MS) · 1 to 10 s inline: the pressed button goes busy (CMP022 + words), no second press · over 10 s a ui.dialog panel: a bar (CMP021) or "Step n of m", Cancel only when the caller gives a safe cancel.
     The words sit in a role=status aria-live=polite region (WCAG 4.1.3); the panel takes focus and gives it back. Colours are theme tokens only. */
  var PROGRESS_DELAY_MS = 400;
  var PROGRESS_CSS =
    '.cbp-spin{display:inline-block;width:1em;height:1em;margin-inline-end:.5em;vertical-align:-.15em;border:2px solid var(--line);border-top-color:var(--accent);border-radius:50%;animation:cbp-turn .8s linear infinite}' +
    '@keyframes cbp-turn{to{transform:rotate(360deg)}}' +
    '.cbp-bar{height:10px;border-radius:5px;background:var(--line);overflow:hidden;margin:12px 0}' +
    '.cbp-fill{display:block;height:100%;background:var(--accent);transition:width .2s}' +
    '.cbp-bar[data-indeterminate] .cbp-fill{width:40%;animation:cbp-slide 1.2s ease-in-out infinite alternate}' +
    '@keyframes cbp-slide{to{transform:translateX(150%)}}' +
    '.cbp-blocks{display:flex;gap:3px;margin:12px 0}.cbp-blk{flex:1;height:12px;border-radius:2px;background:var(--blue-tint,var(--line));border:1px solid var(--blue-tint-line,var(--line))}' +
    '.cbp-blk[data-s="done"]{background:var(--blue,var(--accent));border-color:var(--blue,var(--accent))}.cbp-blk[data-s="failed"]{background:var(--bad);border-color:var(--bad)}' +
    '.cbp-note{margin:4px 0 0;font-size:.9em;color:var(--ink-2,#4b5563)}.cbp-note:empty{display:none}' +
    '.cbp-fails{margin:8px 0 0;padding-inline-start:1.2em;font-size:.9em;color:var(--bad)}' +
    '.cbp-tray{position:fixed;inset-block-end:calc(72px + var(--fab-lift,0px) + env(safe-area-inset-bottom,0px));inset-inline-end:16px;z-index:60;width:min(340px,calc(100vw - 32px));padding:12px 14px;border:1px solid var(--blue-tint-line,var(--line));border-radius:12px;background:var(--card);color:var(--ink);box-shadow:0 6px 24px var(--scrim)}' +
    '.cbp-tray .cbp-title{margin:0;font-weight:700}.cbp-tray .cbp-tfoot{display:flex;gap:8px;justify-content:flex-end;margin-top:8px}.cbp-tray summary{cursor:pointer}' +
    '.cbp-live{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}' +
    '@media (prefers-reduced-motion:reduce){.cbp-spin,.cbp-fill{animation:none;transition:none}}';
  var panelCount = 0;
  function ensureProgressStyle() {
    if (typeof document === 'undefined' || !document.head || !document.createElement || document.getElementById('cbp-css')) return;
    var node = document.createElement('style');
    node.id = 'cbp-css';
    node.textContent = PROGRESS_CSS;
    document.head.appendChild(node);
  }
  /** CMP022: the spinner, decorative (the words beside it carry the meaning) */
  function spinnerHtml() {
    ensureProgressStyle();
    return '<span class="cbp-spin" data-cbsid="' + ACTION_SET.spinner.element + '" aria-hidden="true"></span>';
  }
  /** CMP021: the bar; a number of steps or a total makes it determinate (aria-valuenow/min/max), otherwise it slides */
  function barHtml(model) {
    ensureProgressStyle();
    var known = model.max > 0;
    var percent = known ? Math.round((100 * model.now) / model.max) : 0;
    var values = known ? ' aria-valuemin="0" aria-valuemax="' + model.max + '" aria-valuenow="' + model.now + '"' : ' data-indeterminate="true"';
    return '<div class="cbp-bar" role="progressbar" data-cbsid="' + ACTION_SET.progressbar.element + '" aria-label="' + escapeText(model.label) + '"' + values + '><span class="cbp-fill" style="width:' + percent + '%"></span></div>';
  }
  /** the one polite live region of the page: what a screen reader hears when a button goes busy or a panel ends */
  function announce(text) {
    if (typeof document === 'undefined' || !document.body || !document.createElement) return;
    var region = document.getElementById('cbp-live');
    if (!region) {
      region = document.createElement('div');
      region.id = 'cbp-live';
      region.className = 'cbp-live';
      region.setAttribute('role', 'status');
      region.setAttribute('aria-live', 'polite');
      document.body.appendChild(region);
    }
    region.textContent = text;
  }
  /** LEVEL 2: the button goes busy after the delay (spinner and words), and comes back on stop(). One press: it is disabled at once. */
  function inline(button, label, delay) {
    var saved = null;
    var ownedBusy = button.getAttribute('aria-busy') !== 'true';
    /* native disabled drops focus to the body (WCAG 2.4.3): remember it and give it back on stop() */
    var hadFocus = typeof document !== 'undefined' && document.activeElement === button;
    if (ownedBusy) {
      button.setAttribute('aria-busy', 'true');
      button.disabled = true;
    }
    var timer = setTimeout(function () {
      saved = button.innerHTML;
      button.innerHTML = spinnerHtml() + escapeText(label);
      announce(label);
    }, delayOf(delay));
    return {
      stop: function () {
        clearTimeout(timer);
        if (saved !== null) button.innerHTML = saved;
        if (ownedBusy) {
          button.removeAttribute('aria-busy');
          button.disabled = false;
          if (hadFocus && typeof button.focus === 'function') button.focus();
        }
      }
    };
  }
  /** LEVEL 1 + 2 through CBAction.run: the write runs once, the busy look starts after the delay, a confirm (if any) is asked first */
  function runInline(button, work, options) {
    options = options || {};
    var label = words(options.label || 'Working…', textKey(ACTION_SET.progress, 'working'));
    var wrapped = function () {
      var busy = inline(button, label, options.delay);
      return Promise.resolve().then(work).then(
        function (value) { busy.stop(); return value; },
        function (error) { busy.stop(); throw error; }
      );
    };
    if (typeof CBAction === 'undefined' || !CBAction || typeof CBAction.run !== 'function') return wrapped();
    return CBAction.run(button, wrapped, Object.assign({}, options.run));
  }
  /** the words under the bar: "Step 2 of 4" for steps, "30 of 120" for a total, nothing when the length is unknown */
  function countText(model) {
    if (!(model.max > 0)) return '';
    if (model.steps) return phrase('Step {n} of {m}', textKey(ACTION_SET.progress, 'step'), { n: model.now, m: model.max });
    return phrase('{n} of {total}', textKey(ACTION_SET.progress, 'count'), { n: model.now, total: model.max });
  }
  function panelBody(model) {
    if (model.batch) return batchBody(model);
    return '<div data-cbprogress="' + model.id + '" tabindex="-1"><div role="status" aria-live="polite"><p class="cbp-line">' + escapeText(model.line) + '</p><p class="cbp-count">' + escapeText(countText(model)) + '</p></div>' + barHtml(model) + '</div>';
  }
  function panelRoot(model) {
    return typeof document === 'undefined' ? null : document.querySelector('[data-cbprogress="' + model.id + '"]');
  }
  /** repaint the open panel in place (focus stays); a panel the person closed is simply not there */
  function paintPanel(model) {
    var root = panelRoot(model);
    if (!root) return;
    if (model.batch) return paintBatch(model, root);
    root.querySelector('.cbp-line').textContent = model.line;
    root.querySelector('.cbp-count').textContent = countText(model);
    var bar = root.querySelector('[role="progressbar"]');
    if (bar && model.max > 0) {
      bar.setAttribute('aria-valuenow', String(model.now));
      bar.firstChild.style.width = Math.round((100 * model.now) / model.max) + '%';
    }
  }
  function openPanel(model, options) {
    if (model.batch) announceQuarter(model);
    if (model.tray) return openTray(model, options);
    ensureProgressStyle();
    model.opener = typeof document !== 'undefined' ? document.activeElement : null;
    var cancelAction = typeof options.cancel === 'function' ? [{ name: 'cancel', options: { mount: options.mount, key: 'cancel', onPress: function () { model.finished = true; closeModal(); options.cancel(); } } }] : [];
    if (model.batch) cancelAction.unshift({ name: 'background', options: { mount: options.mount, key: 'background-' + model.id, hint: 'Run in background (Ctrl+B)', onPress: function () { model.toTray(); } } });
    if (model.batch) runningPanel = model;
    dialog({ mount: options.mount, title: model.label, body: panelBody(model), actions: cancelAction });
    var root = panelRoot(model);
    if (root && root.focus) root.focus();
    model.opened = true;
  }
  function closePanel(model) {
    if (runningPanel === model) runningPanel = null;
    if (model.tray) return closeTray(model);
    if (model.opened && panelRoot(model) && typeof closeModal === 'function') closeModal();
    if (model.opener && model.opener.isConnected && model.opener.focus) model.opener.focus();
  }
  /** a failure stays on the panel in words, with Done to close it (opened first if the delay had not passed) */
  function failPanel(model, options, message) {
    if (!model.opened) openPanel(model, options);
    model.line = message || words('That did not finish', textKey(ACTION_SET.progress, 'failed'));
    paintPanel(model);
    var root = panelRoot(model);
    if (!root) return;
    root.querySelector('[role="progressbar"]').hidden = true;
    var foot = root.closest('.modal').querySelector('.mfoot');
    if (foot) foot.innerHTML = dialogAction('done', { mount: options.mount, key: 'fail', onPress: function () { closePanel(model); } });
  }
  /** the state of one panel: its words, its length (steps or total, 0 = unknown) and where it is */
  function progressModel(options) {
    var label = words(options.label || 'Working…', textKey(ACTION_SET.progress, 'working'));
    return { id: 'p' + panelCount, label: label, line: options.line || '', max: options.steps || options.total || 0, now: 0, steps: !!options.steps, opened: false, finished: false };
  }
  /** the wait before anything shows: the default unless the caller (a test, a demo) says 0 */
  function delayOf(delay) {
    return delay == null ? PROGRESS_DELAY_MS : delay;
  }
  /** LEVEL 3: ui.progress.start({ mount, label, steps | total, line, cancel, delay }) -> { step(line), set(n, line), done(), fail(message) }. Nothing shows for the first delay (400 ms); then a panel with the bar or "Step n of m". Cancel appears only when the caller passes a safe cancel(). */
  function startProgress(options) {
    options = options || {};
    if (!MOUNT_CODE.test(options.mount || '')) refuse('progress: mount must be a screen mount code like ACC002-U01');
    if (options.steps && options.total) refuse('progress: give steps or total, not both');
    panelCount += 1;
    var model = progressModel(options);
    var timer = setTimeout(function () { if (!model.finished) openPanel(model, options); }, delayOf(options.delay));
    function move(now, line) {
      model.now = model.max > 0 ? Math.min(model.max, now) : now;
      if (line) model.line = line;
      paintPanel(model);
    }
    return {
      set: function (now, line) { move(now, line); },
      step: function (line) { move(model.now + 1, line); },
      done: function () {
        clearTimeout(timer);
        model.finished = true;
        if (model.opened) announce(words('Finished', textKey(ACTION_SET.progress, 'finished')));
        closePanel(model);
      },
      fail: function (message) {
        clearTimeout(timer);
        model.finished = true;
        failPanel(model, options, message);
      }
    };
  }
  /* ── CMP026 BATCH PROGRESS (Athi 10 Nov): a group action that takes long (assign forty chits). The CMP020 panel with a block bar: each block is total/blocks items,
     blue = done, red = failed, pale = left; the words read "12 of 40 assigned · 28 left · 1 failed". The bar is a role=progressbar (valuenow = done + failed, valuemax = total)
     and its words are the polite status line, repainted at most every BATCH_PAINT_MS so a screen reader is not flooded. */
  var BATCH_BLOCKS = 20, BATCH_PAINT_MS = 500;
  /* Athi 10 Nov: nobody waits on a locked screen. Athi 11 Nov: the panel-or-tray choice is TIME, not count. Every batch of 2 or more items starts in the centre panel (CMP026); still running after
     BATCH_TRAY_AFTER_MS it moves to the corner tray (CMP027) by itself, and the panel's Run in background button (CMP031, Ctrl+B) moves it at once. The speed class sets the STEP (items per call):
     quick (archive, restore, status) 10; slow (assigns, sends, product updates) 5; tray (deletes, anything that posts to the books) 5 and alwaysTray: an irreversible job keeps its visible record
     from the start. A call site names its class (speed: 'quick' | 'slow' | 'tray'); no page holds a number. BATCH_STEP stays the quick step. */
  var BATCH_TRAY_AFTER_MS = 2000, BATCH_AUTOCLOSE_MS = 1000; /* a clean finish closes itself a second later; a failure or a cancel keeps Done */
  var BATCH_SPEED = { quick: { step: 10, alwaysTray: false }, slow: { step: 5, alwaysTray: false }, tray: { step: 5, alwaysTray: true } };
  var BATCH_STEP = BATCH_SPEED.quick.step;
  var runningPanel = null; /* the batch whose centre panel is open now, for Ctrl+B */
  function speedOf(options) {
    var name = options && options.speed;
    if (name != null && !Object.prototype.hasOwnProperty.call(BATCH_SPEED, name)) refuse('progress: speed is quick, slow or tray');
    return BATCH_SPEED[name || 'quick'];
  }
  /** how many of the blocks are blue, how many red (a failure always shows at least one block); the rest stay pale */
  function blockCounts(model) {
    var blocks = Math.min(BATCH_BLOCKS, model.max);
    var failedBlocks = model.failed > 0 ? Math.max(1, Math.round((blocks * model.failed) / model.max)) : 0;
    var doneBlocks = Math.round((blocks * model.done) / model.max);
    if (model.done + model.failed >= model.max) doneBlocks = blocks - failedBlocks;
    return { blocks: blocks, blue: Math.min(doneBlocks, blocks - failedBlocks), red: Math.min(failedBlocks, blocks) };
  }
  function blocksHtml(model) {
    var counts = blockCounts(model), html = '';
    for (var i = 0; i < counts.blocks; i += 1) html += '<span class="cbp-blk" data-s="' + (i < counts.blue ? 'done' : i < counts.blue + counts.red ? 'failed' : 'left') + '"></span>';
    return html;
  }
  /** CMP032: every state of a saved job in words (Athi 11 Nov); each a standard text key CMP032.<state>, all shown on the UI standard page */
  var NOTE_WORDS = {
    saving: 'Saving the job on this device…',
    saved: 'Saved on this device. Safe to keep working or close.',
    busy: 'Server busy, trying again in {seconds} s',
    offline: 'Offline. Will continue when back online',
    resumed: 'Continuing your job: {done} of {total} done',
    keepopen: "Keep this tab open. This action can't continue after a restart.",
    private: "This browser can't keep the job. Closing this tab loses it.",
    doneAll: '{done} done',
    doneFailed: '{done} done · {failed} failed',
    stopped: 'Stopped: {done} done · {left} not done (still ticked)',
    seeWhich: 'See which'
  };
  function noteWords(kind, values) {
    if (!Object.prototype.hasOwnProperty.call(NOTE_WORDS, kind)) refuse('progress: no job state "' + kind + '"');
    return phrase(NOTE_WORDS[kind], textKey(ACTION_SET.batchnote, kind), values || {});
  }
  /** a saved job reads "12 of 40 done · 28 left · 0 failed" while it runs, then "40 done", "38 done · 2 failed" or "Stopped: 20 done · 20 not done (still ticked)" */
  function jobWords(model, values) {
    if (model.ended) {
      if (model.cancelled || values.left > 0) return noteWords('stopped', values);
      return noteWords(model.failed ? 'doneFailed' : 'doneAll', values);
    }
    return phrase('{done} of {total} {unit} · {left} left · {failed} failed', textKey(ACTION_SET.batch, 'countFailed'), Object.assign({}, values, { unit: words('done') }));
  }
  function batchWords(model) {
    var values = { done: model.done, total: model.max, left: Math.max(0, model.max - model.done - model.failed), failed: model.failed, unit: model.unit };
    if (model.job) return jobWords(model, values);
    if (model.ended) return model.failed ? phrase('{done} of {total} {unit} · {failed} failed', textKey(ACTION_SET.batch, 'summaryFailed'), values) : phrase('All {total} {unit}', textKey(ACTION_SET.batch, 'summary'), values);
    return model.failed ? phrase('{done} of {total} {unit} · {left} left · {failed} failed', textKey(ACTION_SET.batch, 'countFailed'), values) : phrase('{done} of {total} {unit} · {left} left', textKey(ACTION_SET.batch, 'count'), values);
  }
  function batchBar(model) {
    ensureProgressStyle();
    return '<div class="cbp-blocks" role="progressbar" data-cbsid="' + ACTION_SET.batch.element + '" aria-label="' + escapeText(model.label) + '" aria-valuemin="0" aria-valuemax="' + model.max + '" aria-valuenow="' + (model.done + model.failed) + '" aria-valuetext="' + escapeText(batchWords(model)) + '">' + blocksHtml(model) + '</div>';
  }
  function failListHtml(model) {
    if (!model.failList.length) return '';
    var list = '<ul class="cbp-fails">' + model.failList.map(function (entry) { return '<li>' + escapeText(entry) + '</li>'; }).join('') + '</ul>';
    /* in the tray the list is one tap away, folded under its count */
    if (model.job) return '<details><summary>' + escapeText(noteWords('seeWhich')) + '</summary>' + list + '</details>';
    return model.tray ? '<details><summary>' + escapeText(phrase('Failed items ({failed})', textKey(ACTION_SET.batchtray, 'failedList'), { failed: model.failed })) + '</summary>' + list + '</details>' : list;
  }
  /** CMP027: the corner tray, the same blocks and words as the panel, a region of the page (not a dialog): the page stays usable underneath */
  function trayBody(model) {
    return '<div data-cbprogress="' + model.id + '" data-cbsid="' + ACTION_SET.batchtray.element + '" role="region" aria-label="' + escapeText(model.label) + '"><p class="cbp-title">' + escapeText(model.label) + '</p>' +
      batchBar(model) + '<div><p class="cbp-count">' + escapeText(batchWords(model)) + '</p>' + noteHtml(model) + '</div><div class="cbp-failwrap">' + failListHtml(model) + '</div><div class="cbp-tfoot"></div></div>';
  }
  function trayFoot(root, html) {
    var foot = root && root.querySelector('.cbp-tfoot');
    if (foot) foot.innerHTML = html;
  }
  function openTray(model, options) {
    ensureProgressStyle();
    if (typeof document === 'undefined' || !document.body || !document.createElement) return;
    var holder = document.createElement('div');
    holder.className = 'cbp-tray';
    holder.setAttribute('data-cbtray', model.id);
    holder.innerHTML = trayBody(model);
    document.body.appendChild(holder);
    model.holder = holder;
    model.opened = true;
    if (typeof options.cancel === 'function') trayFoot(panelRoot(model), dialogAction('cancel', { mount: options.mount, key: 'cancel-' + model.id, onPress: function () { model.cancelNow(); } }));
  }
  function closeTray(model) {
    if (model.holder && model.holder.remove) model.holder.remove();
    model.holder = null;
  }
  function batchBody(model) {
    if (model.tray) return trayBody(model);
    return '<div data-cbprogress="' + model.id + '" tabindex="-1">' + batchBar(model) + '<div><p class="cbp-count">' + escapeText(batchWords(model)) + '</p>' + noteHtml(model) + '</div><div class="cbp-failwrap">' + failListHtml(model) + '</div></div>';
  }
  /** CMP032 in place: empty (and hidden) until the job has a state to say */
  function noteText(model) {
    return model.note ? noteWords(model.note.kind, model.note.values) : '';
  }
  function noteHtml(model) {
    return '<p class="cbp-note" data-cbsid="' + ACTION_SET.batchnote.element + '">' + escapeText(noteText(model)) + '</p>';
  }
  /** say one state of the job now (outside the paint throttle); the screen reader hears it once */
  function setNote(model, kind, values) {
    if (model.ended) return;
    model.note = { kind: kind, values: values };
    var root = panelRoot(model), line = root && root.querySelector('.cbp-note');
    if (line) line.textContent = noteText(model);
    announce(noteText(model));
  }
  /** repaint the open batch panel: the words (the live region) at most every BATCH_PAINT_MS, the last state always lands (a trailing repaint); the end paints at once */
  function paintBatch(model, root) {
    var now = Date.now();
    if (!model.ended && now - model.lastPaint < BATCH_PAINT_MS) {
      if (!model.paintTimer) model.paintTimer = setTimeout(function () { model.paintTimer = null; model.lastPaint = 0; paintPanel(model); }, BATCH_PAINT_MS - (now - model.lastPaint));
      return;
    }
    model.lastPaint = now;
    announceQuarter(model);
    var bar = root.querySelector('[role="progressbar"]');
    if (bar) {
      bar.innerHTML = blocksHtml(model);
      bar.setAttribute('aria-valuenow', String(model.done + model.failed));
      bar.setAttribute('aria-valuetext', batchWords(model));
    }
    root.querySelector('.cbp-count').textContent = batchWords(model);
    var noteLine = root.querySelector('.cbp-note');
    if (noteLine) noteLine.textContent = noteText(model);
    var wrap = root.querySelector('.cbp-failwrap');
    if (wrap && model.shownFails !== model.failList.length) { model.shownFails = model.failList.length; wrap.innerHTML = failListHtml(model); }
  }
  /** the spoken progress: once at the start, at each quarter, and (in finishBatch) once at the end; the count on the screen moves silently */
  function announceQuarter(model) {
    var quarter = Math.floor((4 * (model.done + model.failed)) / model.max);
    if (model.spoken && quarter <= model.quarter) return;
    model.spoken = true; model.quarter = quarter;
    announce(batchWords(model));
  }
  /**
   * ui.progress.batch({ mount, total, label, unit, cancel, delay }) -> { done(n), failed(n | [names], reason), finish(), cancel() }.
   * done(n) adds n finished items; failed adds n failed ones (a list of names gives the summary its list). finish() ends it: a short summary stays (with Done) when anything failed or the panel was open;
   * a quiet batch that ended inside the delay shows nothing. cancel() works only with a safe cancel(). Wrap the work in try { ... } finally { batch.finish(); } so the leave-the-page guard never sticks.
   */
  function batchProgress(options) {
    options = options || {};
    if (!MOUNT_CODE.test(options.mount || '')) refuse('progress: mount must be a screen mount code like ACC002-U01');
    if (!(options.total > 0) || options.total % 1) refuse('progress: a batch needs a whole total above 0');
    panelCount += 1;
    var model = newBatchModel(options);
    startCounts(model, options);
    var openOptions = Object.assign({}, options, { cancel: typeof options.cancel === 'function' ? function () { model.cancelNow(); } : undefined });
    var timer = setTimeout(function () { if (!model.finished) openPanel(model, openOptions); }, delayOf(options.delay));
    /* a job the device keeps is safe to close (that is its point), so no leave-the-page question; a job that lives in this tab only keeps the question */
    var guard = leaveGuard(!options.durable);
    var trayTimer = setTimeout(function () { model.toTray(); }, BATCH_TRAY_AFTER_MS);
    model.stopTimers = function () { clearTimeout(timer); clearTimeout(trayTimer); clearTimeout(model.paintTimer); model.paintTimer = null; if (runningPanel === model) runningPanel = null; };
    model.toTray = function () { return moveToTray(model, openOptions); };
    model.cancelNow = function () {
      if (typeof options.cancel !== 'function' || model.ended) return false;
      model.finished = true; model.ended = true; model.cancelled = true;
      model.stopTimers(); guard.release(); closePanel(model); options.cancel();
      return true;
    };
    return {
      done: function (count) { model.done += Math.max(0, Math.min(batchRoom(model), count == null ? 1 : count)); paintPanel(model); },
      failed: function (items, reason) { recordFailed(model, items, reason); paintPanel(model); },
      cancel: function () { return model.cancelNow(); },
      toTray: function () { return model.toTray(); },
      cancelled: function () { return !!model.cancelled; },
      note: function (kind, values) { setNote(model, kind, values); },
      /* the device turned out not to keep the job after all: the leave-the-page question comes back */
      keepOpen: function () { if (!model.ended) guard.hold(); },
      get tray() { return model.tray; },
      finish: function () { model.stopTimers(); guard.release(); return finishBatch(model, options, openOptions); }
    };
  }
  /** the state of one batch: the progress model plus the counts, the failed lines and where it is shown (always in the tray for the tray class, else the panel until it moves) */
  function newBatchModel(options) {
    var model = progressModel({ label: options.label, total: options.total });
    model.tray = speedOf(options).alwaysTray;
    model.job = !!options.job; model.note = null;
    model.batch = true; model.done = 0; model.failed = 0; model.failList = []; model.lastPaint = 0; model.paintTimer = null; model.ended = false;
    model.unit = words(options.unit || 'done');
    return model;
  }
  /** a job continued after a restart starts with what the last run already did: options.doneAtStart (a number) and options.priorFailed ([{ name, reason }]) */
  function startCounts(model, options) {
    model.done = Math.min(model.max, Math.max(0, options.doneAtStart || 0));
    (options.priorFailed || []).forEach(function (entry) { recordFailed(model, [entry.name], entry.reason); });
  }
  function batchRoom(model) {
    return model.max - model.done - model.failed;
  }
  /** the panel becomes the tray (the work goes on, the screen is free); before the panel has opened it only decides where it will open */
  function moveToTray(model, openOptions) {
    if (model.tray || model.ended) return false;
    var wasOpen = model.opened;
    if (wasOpen) closePanel(model);
    model.tray = true;
    if (wasOpen) { model.opened = false; openPanel(model, openOptions); }
    return true;
  }
  /** the leave-the-page question of one batch: held from the start (a job that lives in this tab only) or later (hold, when the device turns out not to keep it); release ends it */
  function leaveGuard(heldAtStart) {
    var release = heldAtStart ? guardLeaving() : null;
    return {
      hold: function () { if (!release) release = guardLeaving(); },
      release: function () { if (release) release(); release = null; }
    };
  }
  /** leaving the page while a batch runs asks first; the returned function takes the guard off (once) */
  function guardLeaving() {
    var live = typeof window !== 'undefined' && typeof window.addEventListener === 'function';
    var guard = function (event) { event.preventDefault(); event.returnValue = ''; return ''; };
    if (live) window.addEventListener('beforeunload', guard);
    return function () { if (live) { live = false; window.removeEventListener('beforeunload', guard); } };
  }
  /** failed(3, 'why') counts three; failed(['Chit 4'], 'why') counts one and names it for the summary list */
  function recordFailed(model, items, reason) {
    var names = Array.isArray(items) ? items : null;
    var count = Math.max(0, Math.min(batchRoom(model), names ? names.length : (items == null ? 1 : items)));
    model.failed += count;
    if (names) names.slice(0, count).forEach(function (name) { model.failList.push(reason ? name + ' — ' + reason : String(name)); });
    else if (reason && count) model.failList.push(reason + (count > 1 ? ' (×' + count + ')' : ''));
  }
  /** a clean end: nothing failed, nothing left, not cancelled; it closes itself (a failure or a cancel keeps Done) */
  function endedClean(model) {
    return !model.failed && !batchRoom(model) && !model.cancelled;
  }
  /** the end: a summary stays on the panel or tray with Done; a quiet batch that ended inside the delay shows nothing, unless something failed */
  function finishBatch(model, options, openOptions) {
    model.finished = true; model.ended = true; model.note = null;
    var summary = { done: model.done, failed: model.failed, left: batchRoom(model), total: model.max, text: batchWords(model) };
    if (!model.opened && model.failed) openPanel(model, openOptions);
    if (!model.opened) return summary;
    var root = panelRoot(model);
    if (root) paintBatch(model, root);
    announce(summary.text);
    if (endedClean(model)) { model.closeTimer = setTimeout(function () { closePanel(model); }, BATCH_AUTOCLOSE_MS); return summary; }
    showDone(model, options, root);
    return summary;
  }
  /** the Done button, in the tray's foot or the panel's */
  function showDone(model, options, root) {
    var doneButton = dialogAction('done', { mount: options.mount, key: 'done-' + model.id, onPress: function () { closePanel(model); } });
    if (model.tray) return trayFoot(root, doneButton);
    var modal = root && root.closest('.modal'), foot = modal && modal.querySelector('.mfoot');
    if (foot) foot.innerHTML = doneButton;
  }
  /* which group actions can continue after a restart (Athi 11 Nov): they store every step on the device and send each with its own key. Status change stays bulk but runs in the open tab only,
     until its api lands (QA-131: one call per record with the from-status); categorise (QA-130) continues now: add or remove a category per product, repeat-safe. The box then says "Keep this tab open". Keyed by the endpoint's name (core.js EP). */
  var BATCH_RESUMABLE = { archive: true, restore: true, unarchive: true, purgeChit: true, delChit: true, assignBulk: true, prodStatusBulk: true, prodBulkCategories: true, status: false, prodBulkUpdate: false };
  batchProgress.resumable = function (action) {
    if (!Object.prototype.hasOwnProperty.call(BATCH_RESUMABLE, action)) refuse('progress: ' + action + ' has no resume setting (BATCH_RESUMABLE)');
    return BATCH_RESUMABLE[action];
  };
  batchProgress.noteWords = noteWords;
  batchProgress.noteKinds = Object.keys(NOTE_WORDS);
  batchProgress.trayAfterMs = BATCH_TRAY_AFTER_MS;
  batchProgress.autoCloseMs = BATCH_AUTOCLOSE_MS;
  batchProgress.step = BATCH_STEP;
  /** the items in steps of BATCH_STEP, for the caller to send one step at a time (a step is one call; Cancel is honoured between steps) */
  batchProgress.speeds = BATCH_SPEED;
  batchProgress.steps = function (items, speed) {
    var out = [], size = speedOf({ speed: speed }).step;
    for (var i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
  };
  /**
   * ui.progress.batch.run(items, options, sendStep) -> Promise of { done: [items], failed: [{ item, reason }], leftItems: [items not tried], cancelled, stopped, left }.
   * The one runner for a group action (Athi 11 Nov): the items go in steps of the speed class (quick 10, slow 5, tray 5), one sendStep(chunk) per step, the screen never locks, and Cancel is honoured between steps.
   * sendStep resolves { done: [items], failed: [{ item, reason }], stop } (an item in neither list counts as failed, so nothing goes silent, unless stop is true: then the rest stay 'left'
   * and the run ends, for an action that must not carry on after a failure); a throw fails the whole step and names its reason.
   * options are the batch options (mount, label, unit, speed, delay) plus name(item) for the failed list and onStart(batchJob), which hands the caller the running batch (its cancel()). The caller confirms BEFORE calling this and repaints from the result.
   */
  batchProgress.run = async function (items, options, sendStep) {
    var stopped = false;
    var carried = (options.doneAtStart || 0) + (options.priorFailed || []).length;
    var batchJob = batchProgress(Object.assign({}, options, { total: items.length + carried, cancel: function () { stopped = true; } }));
    var result = { done: [], failed: [], leftItems: [], cancelled: false, stopped: false, left: 0 };
    if (typeof options.onStart === 'function') options.onStart(batchJob);
    try {
      /* a saved job is stored on the device BEFORE its first step: prepare(batchJob) does it and says so on the note */
      if (typeof options.prepare === 'function') await options.prepare(batchJob);
      var steps = batchProgress.steps(items, options.speed);
      for (var index = 0; index < steps.length && !stopped && !result.stopped; index += 1) await runStep(batchJob, steps[index], options, sendStep, result);
    } finally {
      result.cancelled = stopped;
      result.leftItems = items.filter(function (item) { return result.done.indexOf(item) < 0 && !result.failed.some(function (entry) { return entry.item === item; }); });
      result.left = result.leftItems.length;
      batchJob.finish();
    }
    return result;
  };
  /** what one step answered; a throw fails the whole step and names its reason */
  async function answerOf(chunk, sendStep) {
    try {
      return (await sendStep(chunk)) || {};
    } catch (error) {
      return { done: [], failed: chunk.map(function (item) { return { item: item, reason: (error && error.message) || 'failed' }; }) };
    }
  }
  /** the items a step neither finished nor failed: failed as "no answer", so nothing goes silent */
  function unansweredOf(chunk, done, failed) {
    return chunk.filter(function (item) { return done.indexOf(item) < 0 && !failed.some(function (entry) { return entry.item === item; }); })
      .map(function (item) { return { item: item, reason: 'no answer' }; });
  }
  /** one step of the runner: send it, then count what the step answered */
  async function runStep(batchJob, chunk, options, sendStep, result) {
    var answer = await answerOf(chunk, sendStep);
    var done = answer.done || [], failed = (answer.failed || []).slice();
    result.stopped = !!answer.stop;
    if (!answer.stop) failed = failed.concat(unansweredOf(chunk, done, failed));
    result.done.push.apply(result.done, done);
    result.failed.push.apply(result.failed, failed);
    if (done.length) batchJob.done(done.length);
    failed.forEach(function (entry) { batchJob.failed([(options.name ? options.name(entry.item) : String(entry.item))], entry.reason); });
  }
  var progress = { start: startProgress, batch: batchProgress, run: runInline, inline: inline, spinner: spinnerHtml, bar: barHtml, delay: PROGRESS_DELAY_MS };
  if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('click', onDocumentClick);
  if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('submit', onDocumentSubmit);
  if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('keydown', onChoiceKey);
  if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('keydown', onBatchKey);
  var library = { action: action, tap: tapAttributes, dialog: dialog, footerAction: footerAction, choice: choice, choiceSet: choiceSet, progress: progress, components: ACTION_SET, textKey: textKey, words: words, escape: escapeText, style: ensureStyle };
  /* screens write the short name: ui.action(...) */
  if (typeof window !== 'undefined') window.ui = library;
  return library;
})();
