/**
 * ui-field.js — THE FIELD (CMP055, UX-137, docs WEB-FIELD-PART rev 2). One part for a text-like, date, time, checkbox, file and long-text field: a screen never hand-writes
 * a label, a hint, an error or a 44 px input, it MOUNTS one. It widens the Books field (CMP040) and the List field (CMP045), which stay valid as aliases until their pages convert.
 *
 * OWNS       ui.field(options) -> one HTML string (label, control, hint, error) · ui.field.read / set / error / focusFirstError (repaint locally, never rebuild the form) ·
 *            ui.field.parse (the one number reader: typed text + shop locale -> canonical ASCII decimal) · the one delegated input / change / focusout listener.
 *            density:'compact' (a VARIANT of this part, not a new one): the control alone in a one-line list row, named by aria-label, a hint as a hidden description; the page class gives the look. `of` appends the row's own name to that label (data, never translated).
 * PLUGS      kind 'money' is drawn, read and settled by app/ui-money.js (CMP055-I05) through field.plug; without that file loaded it is refused, never faked.
 * CALLED BY  a page that draws a field: shop.html first. Loaded AFTER app/ui.js (it reads ui.words, ui.escape, ui.style and ui.components from it).
 * KEYBOARD   a native control: Tab reaches it, the ring is 2 px --accent; a checkbox is a 44 px row; Enter in a text field commits nothing (a commit is a Save, which confirms).
 * REGISTER   CMP055; elements I01 text-like · I02 date and time · I03 checkbox · I04 file · T01 long text. The element carries data-cbsid, data-cbname="field", data-cbmount.
 * CARD       29-qa-test-tooling-ux-locale-and-design-system/design-system
 * FLOW       none (a drawing library). Spec: docs/critique/WEB-FIELD-PART-2026-11-13.md.
 *
 * THE RULES IT ENFORCES (it throws, because silence is the bug): an unknown property, a missing mount or label, a kind it does not draw, a per-row field without a key,
 * a handler given as a string. The value is CANONICAL (ASCII digits, "." decimal mark, ISO dates); the locale touches only what the person sees and types.
 */
var CBUiField = (function () {
  var MOUNT_CODE = /^[A-Z]{3}\d{3}(?:-D\d{2})?-U\d{2,3}$/;
  var ALLOWED = ['mount', 'kind', 'label', 'id', 'name', 'key', 'value', 'hint', 'error', 'required', 'readonly', 'role', 'min', 'max', 'step', 'maxlength', 'accept', 'rows',
    'autocomplete', 'inputmode', 'placeholder', 'testid', 'cls', 'data', 'attrs', 'onInput', 'onChange', 'density', 'of', 'currency', 'minor'];
  /* the long tail a page may still pass: a closed name list, never free HTML (no on*, style, id, type, value, data-cbsid) */
  var ATTRS = ['list', 'pattern', 'spellcheck', 'autocapitalize', 'enterkeyhint', 'size', 'multiple', 'capture'];
  var KINDS = {
    text: { type: 'text', el: 'I01', auto: 'off' }, search: { type: 'search', el: 'I01', auto: 'off' }, password: { type: 'password', el: 'I01' },
    email: { type: 'email', el: 'I01', dir: 'ltr', auto: 'email' }, phone: { type: 'tel', el: 'I01', dir: 'ltr', auto: 'tel' },
    number: { type: 'text', el: 'I01', dir: 'ltr', mode: 'decimal', auto: 'off', decimal: true },
    percent: { type: 'text', el: 'I01', dir: 'ltr', mode: 'decimal', auto: 'off', decimal: true, suffix: '%' },
    date: { type: 'date', el: 'I02' }, time: { type: 'time', el: 'I02' }, checkbox: { type: 'checkbox', el: 'I03' },
    file: { type: 'file', el: 'I04' }, long: { tag: 'textarea', el: 'T01', auto: 'off' },
    money: { type: 'text', el: 'I05', dir: 'ltr', mode: 'decimal', auto: 'off', plug: true }
  };
  /* a kind drawn by another file (money: app/ui-money.js): { draw, read, settle, input } */
  var PLUGS = {};
  var DIGITS = [['٠', '٩'], ['۰', '۹'], ['०', '९']]; /* Arabic-Indic, Extended Arabic-Indic, Devanagari: each ten code points in a row */
  var HANDLERS = {};
  var ID_OWNER = {};
  /* the error colour: the theme has no danger TEXT token (the page's own #b4453f is 2.98:1 on Dark), so it is the red pulled 30% toward the theme's --ink: dark red on Cream, light red on Dark, AA on both (the walk measures it) */
  var FIELD_STYLE =
    '@supports (color:color-mix(in srgb,currentcolor,currentcolor)){:root{--field-bad:color-mix(in srgb,var(--bad-source,#b4453f) 65%,var(--ink,#1d1b16))}}' +
    '.cbf{margin:3px 0 11px;max-width:100%;box-sizing:border-box;min-width:0}' +
    '.cbf-row{display:flex;gap:8px;align-items:baseline;justify-content:space-between}' +
    '.cbf-l{font-size:12px;color:var(--grey-3,var(--dim,#5e594d))}.cbf-req{font-size:11px;color:var(--grey-3,var(--dim,#5e594d))}' +
    '.cbf .cbf-in{display:block;width:100%;max-width:100%;box-sizing:border-box;min-height:max(44px,var(--act-h,44px));margin:3px 0 0;padding:9px;border:1px solid var(--field-edge,#85807C);' +
    'border-radius:8px;font:inherit;font-size:14px;color:var(--ink,#2a2418);background:var(--card,#fff)}' +
    '.cbf textarea.cbf-in{min-height:0;resize:vertical}.cbf .cbf-in[readonly]{background:var(--paper,#f4f0e6)}' +
    '.cbf .cbf-in:focus-visible,.cbf .cbf-fb:focus-within{outline:2px solid var(--accent,#1f5f5b);outline-offset:2px}' +
    '.cbf .cbf-in[aria-invalid="true"]{border-color:var(--field-bad,#b4453f)}' +
    '.cbf-h{font-size:11.5px;color:var(--grey-3,var(--dim,#5e594d));margin-top:3px;overflow-wrap:anywhere}' +
    '.cbf-e{font-size:12.5px;color:var(--field-bad,#b4453f);margin-top:3px;overflow-wrap:anywhere}' +
    '.cbf-c{display:flex;align-items:center;gap:10px;min-height:max(44px,var(--act-h,44px));cursor:pointer;font-size:13px;color:var(--ink,#2a2418)}' +
    '.cbf .cbf-c .cbf-in{display:inline-block;width:24px;min-width:24px;min-height:24px;height:24px;margin:0;padding:0}' +
    '.cbf-fb{position:relative;display:flex;align-items:center;justify-content:center;gap:8px;box-sizing:border-box;min-height:max(44px,var(--act-h,44px));padding:10px 12px;' +
    'border:1.5px dashed var(--field-edge,#85807C);border-radius:10px;cursor:pointer;font-weight:600;font-size:12.5px;color:var(--ink,#2a2418);background:var(--card,#fff);text-align:center}' +
    '.cbf .cbf-fb .cbf-in{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;margin:0;min-height:0}' +
    '.cbf-fn{font-weight:400;color:var(--grey-3,var(--dim,#5e594d));overflow-wrap:anywhere}' +
    /* density:'compact': the control stands alone in a one-line row (no wrapper, no label row); the page's own class gives its look, this adds only the state rules and the tap floor */
    '.cbf-in.cbf-dn:focus-visible{outline:2px solid var(--accent,#1f5f5b);outline-offset:1px}.cbf-in.cbf-dn[aria-invalid="true"]{border-color:var(--field-bad,#b4453f)}' +
    'input.cbf-in.cbf-dn{min-height:32px;box-sizing:border-box}input[type="checkbox"].cbf-dn{min-height:0;width:20px;height:20px;margin:2px}.cbf-vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}' +
    '@media(max-width:700px){input.cbf-in.cbf-dn:not([type="checkbox"]){min-height:max(44px,var(--act-h,44px))}input[type="checkbox"].cbf-dn{-webkit-appearance:none;appearance:none;width:max(44px,var(--act-h,44px));height:max(44px,var(--act-h,44px));margin:0;border:0;background:none;display:inline-grid;place-content:center;cursor:pointer}' +
    '.cbf-in.cbf-dn[type="checkbox"]::before{content:"";box-sizing:border-box;width:22px;height:22px;border:2px solid var(--field-edge,#85807C);border-radius:5px;background:var(--card,#fff)}' +
    '.cbf-in.cbf-dn[type="checkbox"]:checked::before{background:var(--accent,#1f5f5b);border-color:var(--accent,#1f5f5b);box-shadow:inset 0 0 0 3px var(--card,#fff)}.cbf-in.cbf-dn[type="checkbox"]:disabled{opacity:.5}}' +
    '.cbf-suf{position:relative}.cbf .cbf-suf .cbf-in{padding-inline-end:30px}.cbf-suf b{position:absolute;inset-inline-end:10px;top:50%;margin-top:-4px;font-weight:400;color:var(--grey-3,var(--dim,#5e594d))}';

  function refuse(reason) {
    throw new Error('ui.field: ' + reason);
  }
  function library() {
    var lib = typeof window !== 'undefined' ? window.ui : null;
    if (!lib || !lib.words || !lib.escape) refuse('app/ui.js must be loaded before app/ui-field.js');
    return lib;
  }
  function words(english, key, values) {
    var text = library().words(english, 'CMP055.' + key);
    return values ? text.replace(/\{(\w+)\}/g, function (whole, name) { return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : whole; }) : text;
  }
  function ensureStyle() {
    library().style();
    if (typeof document === 'undefined' || !document.head || document.getElementById('cbui-field-css')) return;
    var node = document.createElement('style');
    node.id = 'cbui-field-css';
    node.textContent = FIELD_STYLE;
    document.head.appendChild(node);
  }
  function pairs(list) {
    var esc = library().escape;
    return list.filter(function (pair) { return pair[1] !== null && pair[1] !== undefined && pair[1] !== false; })
      .map(function (pair) { return pair[1] === true ? pair[0] : pair[0] + '="' + esc(pair[1]) + '"'; }).join(' ');
  }

  /* ---------- the number reader: one function of (typed text, shop locale) ---------- */
  /** the shop locale's marks, read from CBLocale (never the browser): { mark, group, lakh } ("." and "," for India, Australia and the UAE) */
  function marksOf() {
    var sample = '';
    if (typeof CBLocale !== 'undefined' && CBLocale.number) sample = String(CBLocale.number(1234567.5, { minimumFractionDigits: 1, maximumFractionDigits: 1 })).replace(/[‎‏؜]/g, '');
    var marks = sample.replace(/\d/g, '');
    if (!marks) return { mark: '.', group: ',', lakh: false };
    var parts = sample.split(marks.charAt(0));
    return { mark: marks.charAt(marks.length - 1), group: marks.length > 1 ? marks.charAt(0) : '', lakh: parts.length > 2 && parts[1].length === 2 };
  }
  /** digit sets of other scripts become ASCII; U+066B (Arabic decimal) and U+066C (Arabic grouping) become the shop's marks */
  function asciiDigits(text, marks) {
    return String(text == null ? '' : text).replace(/[٠-٩۰-۹०-९٫٬]/g, function (ch) {
      if (ch === '٫') return marks.mark;
      if (ch === '٬') return marks.group || ',';
      var code = ch.charCodeAt(0);
      for (var at = 0; at < DIGITS.length; at += 1) if (code >= DIGITS[at][0].charCodeAt(0) && code <= DIGITS[at][1].charCodeAt(0)) return String(code - DIGITS[at][0].charCodeAt(0));
      return ch;
    });
  }
  /** is the grouped whole part written in a place this locale groups (thousands, or lakhs where the locale does)? */
  function groupedRight(whole, marks) {
    var group = marks.group.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var western = new RegExp('^\\d{1,3}(' + group + '\\d{3})+$');
    var lakh = new RegExp('^\\d{1,2}(' + group + '\\d{2})*' + group + '\\d{3}$');
    return western.test(whole) || (marks.lakh && lakh.test(whole));
  }
  function badNumber() {
    return { ok: false, error: words('That is not a number. Type digits only, like 1234.5', 'badnumber') };
  }
  /** a lone wrong mark with 1 or 2 digits after it ("1,50" in a "." locale): the silent 100x, refused */
  function isWrongMark(whole, marks) {
    var parts = whole.split(marks.mark === '.' ? ',' : '.');
    return parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d{1,2}$/.test(parts[1]);
  }
  /** the whole part without its grouping marks, or null when the grouping sits in a place this locale does not group */
  function ungrouped(whole, marks) {
    if (!marks.group || whole.indexOf(marks.group) < 0) return whole;
    return groupedRight(whole, marks) ? whole.split(marks.group).join('') : null;
  }
  /** the unsigned text cut at the shop's decimal mark: { halves } or null when it is not even shaped like a number */
  function splitNumber(unsigned, marks) {
    var halves = unsigned.split(marks.mark);
    var digitsOnly = unsigned.replace(marks.mark, '');
    return digitsOnly && halves.length <= 2 && /^\d[\d.,]*$/.test(digitsOnly) ? { halves: halves } : null;
  }
  /** ui.field.parse(text, marks?) -> { ok:true, value:'1234.5' } or { ok:false, error:'sentence' }. "1,50" in a "." locale is an ERROR, never 150 and never 1.5. */
  function parse(text, given) {
    var marks = given || marksOf();
    var typed = asciiDigits(text, marks).replace(/[\s  ]/g, '');
    var sign = /^[+-]/.test(typed) ? typed.charAt(0) : '';
    var shape = splitNumber(typed.slice(sign.length), marks);
    return shape ? readShape(sign, shape.halves, marks) : badNumber();
  }
  /** the signed, cut number: the wrong-mark and grouping refusals, then the canonical value */
  function readShape(sign, halves, marks) {
    if (halves.length === 1 && isWrongMark(halves[0], marks)) return { ok: false, error: words('Use a {mark} before the decimals, like 1{mark}5', 'wrongmark', { mark: marks.mark }) };
    var whole = ungrouped(halves[0], marks);
    if (whole === null) return { ok: false, error: words('Check the commas in that number', 'badgroup') };
    return digitsValue(sign, whole, halves[1] || '');
  }
  /** the canonical value from the whole and fraction digits; leading zeros dropped, ".5" is 0.5, anything else is not a number */
  function digitsValue(sign, whole, fraction) {
    if (!/^\d*$/.test(whole + fraction) || (whole === '' && !fraction)) return badNumber();
    return { ok: true, value: sign + (whole === '' ? '0' : whole.replace(/^0+(?=\d)/, '')) + (fraction ? '.' + fraction : '') };
  }

  /* ---------- the mark-up ---------- */
  function checkOptions(options) {
    if (!options || typeof options !== 'object') refuse('options are required');
    checkPlugged(options);
    Object.keys(options).forEach(function (name) { if (ALLOWED.indexOf(name) < 0) refuse('"' + name + '" is not a property of the field'); });
    if (!MOUNT_CODE.test(options.mount || '')) refuse('mount must be a screen mount code like SHP001-U03');
    if (!KINDS[options.kind]) refuse('kind must be ' + Object.keys(KINDS).join(', '));
    if (!options.label || !String(options.label).trim()) refuse('label is required (the accessible name; a placeholder is never the name)');
    checkDensity(options);
    checkHandlers(options);
  }
  /** density is compact or regular; compact is one line, so a file or a long text is refused */
  function checkDensity(options) {
    if (options.density !== undefined && options.density !== 'compact' && options.density !== 'regular') refuse('density is "compact" or "regular"');
    if (options.density === 'compact' && (options.kind === 'file' || options.kind === 'long')) refuse('density "compact" is one line: text, number, date, time or checkbox, not ' + options.kind);
  }
  /** a handler is a function, never inline JavaScript; attrs is the closed name list */
  function checkHandlers(options) {
    ['onInput', 'onChange'].forEach(function (name) { if (options[name] !== undefined && typeof options[name] !== 'function') refuse(name + ' must be a function, never inline JavaScript'); });
    var names = options.attrs ? (typeof options.attrs === 'object' ? Object.keys(options.attrs) : [null]) : [];
    if (names.some(function (name) { return ATTRS.indexOf(name) < 0; })) refuse('attrs is an object of ' + ATTRS.join(', ') + ' only');
  }
  /** a plugged kind (money) needs its file loaded; its own properties (currency, minor) belong to it alone */
  function checkPlugged(options) {
    if (options.kind === 'money' && !PLUGS.money) refuse('kind "money" is drawn by app/ui-money.js; load it after this file');
    if ((options.currency !== undefined || options.minor !== undefined) && options.kind !== 'money') refuse('currency and minor belong to kind "money" only');
  }
  /** the part another file plugged in for this field's kind (money), or null for a kind drawn here */
  function plugOf(el) {
    var kind = el.getAttribute('data-cbkind');
    return KINDS[kind] && KINDS[kind].plug ? PLUGS[kind] : null;
  }
  function idOf(options) {
    if (options.id) return String(options.id);
    var tail = options.key === undefined || options.key === null ? '' : '-' + String(options.key).toLowerCase().replace(/[^a-z0-9_-]/g, '');
    return uniqueId(options.mount.toLowerCase() + tail, options.mount + '|' + String(options.key));
  }
  /** the id a key-made field gets: the first writer keeps it, a different key that sanitises to the same id gets a short hash of its own key, so two rows never share an id (and a redraw of the same key keeps its id) */
  function uniqueId(id, owner) {
    if (ID_OWNER[id] === undefined || ID_OWNER[id] === owner) { ID_OWNER[id] = owner; return id; }
    var hashed = id + '-' + hashOf(owner);
    if (ID_OWNER[hashed] !== undefined && ID_OWNER[hashed] !== owner) refuse('two keys make the same id (' + hashed + '); give one of them an id');
    ID_OWNER[hashed] = owner;
    return hashed;
  }
  function hashOf(text) {
    var sum = 7;
    for (var at = 0; at < text.length; at += 1) sum = (sum * 31 + text.charCodeAt(at)) % 1679616;
    return sum.toString(36);
  }
  /** the reason a field is read-only: role {ok:false, why} (permission) outranks readonly:'sentence' (state); null when it can be typed in */
  function readonlyReason(options) {
    if (options.role && options.role.ok === false) return String(options.role.why || '');
    if (!options.readonly) return null;
    if (typeof options.readonly !== 'string' || !options.readonly.trim()) refuse('readonly: give the reason as a sentence; a locked field always says why');
    return options.readonly;
  }
  /** density:'compact' (the one-line row variant of this same part; Material dense, Fluent small) */
  function isCompact(options) {
    return options.density === 'compact';
  }
  /** the hint and the locked reason as one sentence, through the catalogue */
  function noteText(options, reason) {
    return [options.hint, reason].filter(Boolean).map(function (text) { return library().words(String(text)); }).join(' · ');
  }
  function describedBy(id, hasHint, hasError, hasName) {
    return [hasHint ? id + '-h' : '', hasError ? id + '-e' : '', hasName ? id + '-n' : ''].filter(Boolean).join(' ') || null;
  }
  /** the register and page-owned attributes: id, name, testid, class, data-* and the closed attrs list, all as the page wrote them */
  function ownedPairs(options, shape, id) {
    var own = [['data-cbsid', 'CMP055-' + shape.el], ['data-cbname', 'field'], ['data-cbmount', options.mount], ['data-cbkind', options.kind], ['id', id], ['name', options.name],
      ['data-testid', options.testid], ['class', 'cbf-in' + (isCompact(options) ? ' cbf-dn' : '') + (options.cls ? ' ' + options.cls : '')]];
    var data = Object.keys(options.data || {}).map(function (suffix) { return ['data-' + suffix, String(options.data[suffix])]; });
    var extra = Object.keys(options.attrs || {}).map(function (name) { return [name, options.attrs[name]]; });
    var dense = isCompact(options) ? [['aria-label', library().words(String(options.label)) + (options.of ? ' ' + options.of : '')], ['title', noteText(options, null) || null]] : [];
    return own.concat(data, extra, dense);
  }
  /** what the browser needs to type into it: keypad, direction, limits */
  function typingPairs(options, shape) {
    return shapePairs(options, shape).concat([['placeholder', options.placeholder ? library().words(String(options.placeholder)) : null], ['autocomplete', options.autocomplete || shape.auto], ['inputmode', options.inputmode || shape.mode || null],
      ['min', options.min], ['max', options.max], ['step', options.step], ['maxlength', options.maxlength], ['accept', options.accept]]);
  }
  /** the element's own type, rows and text direction (numbers, email and phone stay left-to-right on an Arabic page) */
  function shapePairs(options, shape) {
    var autoDirection = shape.tag || shape.type === 'text' || shape.type === 'search' ? 'auto' : null;
    return [['type', shape.tag ? null : shape.type], ['rows', shape.tag ? options.rows || 4 : null], ['dir', shape.dir || autoDirection]];
  }
  /** required, locked, invalid and described-by: the state of the field */
  function statePairs(options, shape, id, reason) {
    var hasNote = !!(options.hint || reason || (!isCompact(options) && (shape.decimal || shape.type === 'date')));
    return [['required', !!options.required], ['readonly', reason !== null], ['aria-invalid', options.error ? 'true' : null],
      ['aria-describedby', describedBy(id, hasNote, !!options.error, options.kind === 'file')]];
  }
  function controlAttributes(options, id, reason) {
    var shape = KINDS[options.kind];
    return pairs(ownedPairs(options, shape, id).concat(typingPairs(options, shape), statePairs(options, shape, id, reason)));
  }
  function controlHtml(options, id, reason) {
    var shape = KINDS[options.kind], esc = library().escape;
    var attributes = controlAttributes(options, id, reason);
    if (shape.tag) return '<textarea ' + attributes + '>' + esc(options.value == null ? '' : options.value) + '</textarea>';
    var input = '<input ' + attributes + inputValue(options, shape) + '>';
    return shape.suffix ? '<span class="cbf-suf">' + input + '<b aria-hidden="true">' + shape.suffix + '</b></span>' : input;
  }
  /** the value attribute of an input: a checkbox is checked, a file has none, the rest are escaped text */
  function inputValue(options, shape) {
    if (shape.type === 'checkbox') return options.value ? ' checked' : '';
    if (shape.type === 'file') return '';
    return ' value="' + library().escape(options.value == null ? '' : options.value) + '"';
  }
  function noteHtml(options, id, reason) {
    var shape = KINDS[options.kind], esc = library().escape;
    var hintText = esc(noteText(options, reason));
    if (isCompact(options)) return hintText ? '<span class="cbf-vh" id="' + id + '-h">' + hintText + '</span>' : '';
    var echoes = shape.decimal || shape.type === 'date';
    if (!hintText && !echoes) return '';
    return '<div class="cbf-h" id="' + id + '-h"><span>' + hintText + '</span>' + (echoes ? ' <span id="' + id + '-x" aria-live="polite"></span>' : '') + '</div>';
  }
  function errorHtml(options, id) {
    if (!options.error) return '';
    return '<div class="cbf-e" id="' + id + '-e"><span aria-hidden="true">⚠ </span>' + library().escape(options.error) + '</div>';
  }
  /** the caller's English label through the catalogue (tx), so a visible label is a counted, translatable word and not hard-wired */
  function labelText(options) {
    return library().escape(library().words(String(options.label)));
  }
  function labelHtml(options, id) {
    var esc = library().escape;
    var required = options.required ? '<span class="cbf-req">' + esc(words('Required', 'required')) + '</span>' : '';
    return '<div class="cbf-row"><label class="cbf-l" for="' + id + '">' + labelText(options) + '</label>' + required + '</div>';
  }
  /** a page handler (onInput, onChange) is kept under the field's id for the one delegated listener */
  function keepHandlers(options, id) {
    if (options.onInput || options.onChange) HANDLERS[id] = { input: options.onInput, change: options.onChange };
  }
  /** the part: ui.field({ mount, kind, label, ... }) -> HTML */
  function field(options) {
    checkOptions(options);
    var shape = KINDS[options.kind], id = idOf(options), reason = readonlyReason(options);
    ensureStyle();
    keepHandlers(options, id);
    if (shape.plug) return PLUGS[options.kind].draw(options, id, reason, { label: labelHtml, note: noteHtml, error: errorHtml, pairs: pairs, describedBy: describedBy });
    var tail = noteHtml(options, id, reason) + errorHtml(options, id);
    var control = controlHtml(options, id, reason);
    if (isCompact(options)) return control + tail;
    if (shape.type === 'checkbox') return '<div class="cbf"><label class="cbf-c" for="' + id + '">' + control + '<span>' + labelText(options) + '</span></label>' + tail + '</div>';
    if (shape.type === 'file') return '<div class="cbf"><label class="cbf-fb" for="' + id + '"><span>' + labelText(options) + '</span>' + control + '</label><div class="cbf-fn" id="' + id + '-n"></div>' + tail + '</div>';
    return '<div class="cbf">' + labelHtml(options, id) + control + tail + '</div>';
  }

  /* ---------- reading and repainting one field ---------- */
  function elementOf(target) {
    if (target && typeof target === 'object') return target;
    return typeof document !== 'undefined' ? document.getElementById(String(target)) : null;
  }
  /** the canonical value of one field: ASCII decimal for a number, ISO for a date, true/false for a checkbox, the file name for a file; { value: NaN, error } for a number it cannot read */
  function read(target) {
    var el = elementOf(target);
    if (!el) return { value: undefined };
    var kind = el.getAttribute('data-cbkind');
    if (kind === 'checkbox') return { value: !!el.checked };
    if (kind === 'file') return { value: el.files && el.files[0] ? el.files[0].name : '' };
    if (plugOf(el)) return plugOf(el).read(el);
    return KINDS[kind].decimal ? readNumber(el) : { value: el.value };
  }
  /** a number field: '' when empty, the canonical ASCII decimal, or NaN and the sentence to show */
  function readNumber(el) {
    if (!String(el.value).trim()) return { value: '' };
    var parsed = parse(el.value);
    return parsed.ok ? { value: parsed.value } : { value: NaN, error: parsed.error };
  }
  function noteOf(el, suffix) {
    return typeof document !== 'undefined' ? document.getElementById(el.id + '-' + suffix) : null;
  }
  /** show an error under one field (or clear it): the ONE place role="alert" is added, so a first render never announces every row at once */
  function showError(target, sentence) {
    var el = elementOf(target);
    if (!el) return;
    paintErrorLine(el, sentence);
    setAttributeIf(el, 'aria-invalid', sentence ? 'true' : null);
    var described = [noteOf(el, 'h') ? el.id + '-h' : '', sentence ? el.id + '-e' : '', noteOf(el, 'n') ? el.id + '-n' : ''].filter(Boolean).join(' ');
    setAttributeIf(el, 'aria-describedby', described || null);
  }
  /** write the sentence in the field's error line (made when the field was drawn without one), or take the line away */
  function paintErrorLine(el, sentence) {
    var box = noteOf(el, 'e') || (sentence ? makeErrorBox(el) : null);
    if (!box) return;
    if (!sentence) { box.remove(); return; }
    box.textContent = '⚠ ' + sentence;
    box.setAttribute('role', 'alert');
  }
  /** set an attribute, or remove it when there is no value */
  function setAttributeIf(el, name, value) {
    if (value === null) el.removeAttribute(name); else el.setAttribute(name, value);
  }
  /** the error line a repaint adds under a field that was drawn without one */
  function makeErrorBox(el) {
    var box = document.createElement('div');
    box.id = el.id + '-e';
    box.className = 'cbf-e';
    (noteOf(el, 'h') || (el.closest('.cbf-suf, .mi') || el).parentNode).insertAdjacentElement('afterend', box);
    return box;
  }
  /** the locale echo: a date as words ("13 Nov 2026"), a number grouped the shop's way, so a mismatched browser still shows what the app understood */
  function echoOf(el) {
    if (typeof CBLocale === 'undefined') return '';
    var kind = el.getAttribute('data-cbkind'), have = String(el.value || '');
    if (kind === 'date') return dateWords(have);
    var parsed = KINDS[kind] && KINDS[kind].decimal && have.trim() ? parse(have) : null;
    return parsed && parsed.ok ? String(CBLocale.number(Number(parsed.value), { maximumFractionDigits: 20 })) : '';
  }
  /** an ISO date as words in the shop's locale, read at noon UTC in UTC so the day never moves */
  function dateWords(iso) {
    var part = /^(\d{4})-(\d\d)-(\d\d)$/.exec(iso);
    return part ? CBLocale.date(Date.UTC(+part[1], +part[2] - 1, +part[3], 12), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';
  }
  /** when the person leaves a number field: read it, say what was understood, or say what to fix; a good number is written back canonical so a page's own .value reader agrees */
  function settleOwn(el) {
    var echo = noteOf(el, 'x');
    var decimal = !!KINDS[el.getAttribute('data-cbkind')].decimal;
    if (decimal && String(el.value).trim()) {
      var result = read(el);
      showError(el, result.error || null);
      if (!result.error) el.value = result.value;
    } else if (decimal && el.getAttribute('aria-invalid') === 'true') showError(el, null);
    /* written only when it changed: a rewrite of the same words is still a DOM mutation, and the sheet-keys observer reads it while focus is mid-move and pulls focus back, so Tab never left the box */
    var echoWords = echo ? echoOf(el) : '';
    if (echo && echo.textContent !== echoWords) echo.textContent = echoWords;
  }
  /** leaving a field: a plugged kind (money) settles itself, the rest are settled here */
  function settle(el) {
    return plugOf(el) ? plugOf(el).settle(el) : settleOwn(el);
  }
  function set(target, value) {
    var el = elementOf(target);
    if (!el) return;
    if (el.getAttribute('data-cbkind') === 'checkbox') el.checked = !!value; else el.value = value == null ? '' : value;
    settle(el);
  }
  /** move focus to the first field with an error inside a form (the invalid-submit helper); returns the field or null */
  function focusFirstError(form) {
    var first = form && form.querySelector ? form.querySelector('[data-cbname="field"][aria-invalid="true"]') : null;
    if (first) first.focus();
    return first;
  }

  /* ---------- one delegated listener for every field on the page ---------- */
  function fieldOf(event) {
    var el = event && event.target;
    return el && el.getAttribute && el.getAttribute('data-cbname') === 'field' ? el : null;
  }
  function onInput(event) {
    var el = fieldOf(event);
    if (!el) return;
    if (plugOf(el)) plugOf(el).input(el);
    else if (KINDS[el.getAttribute('data-cbkind')].decimal) {
      var mapped = asciiDigits(el.value, marksOf());
      if (mapped !== el.value) el.value = mapped;
    }
    var handler = HANDLERS[el.id];
    if (handler && handler.input) handler.input(valueForPage(el), el, event);
  }
  /** what the page's handler gets: the canonical value, or the raw text while a number is not readable yet */
  function valueForPage(el) {
    var answer = read(el);
    return answer.value !== answer.value ? el.value : answer.value;
  }
  function onChange(event) {
    var el = fieldOf(event);
    if (!el) return;
    var kind = el.getAttribute('data-cbkind');
    if (kind === 'file') { var named = noteOf(el, 'n'); if (named) named.textContent = read(el).value; }
    if (kind === 'date') settle(el);
    var handler = HANDLERS[el.id];
    if (handler && handler.change) handler.change(read(el).value, el, event);
  }
  function onFocusOut(event) {
    var el = fieldOf(event);
    if (el) settle(el);
  }
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    document.addEventListener('focusout', onFocusOut);
  }
  field.read = read;
  field.set = set;
  field.error = showError;
  field.focusFirstError = focusFirstError;
  field.parse = parse;
  field.marks = marksOf;
  field.ascii = asciiDigits;
  field.plug = function (kind, part) { PLUGS[kind] = part; };
  field.kinds = KINDS;
  if (typeof window !== 'undefined' && window.ui) window.ui.field = field;
  return field;
})();
