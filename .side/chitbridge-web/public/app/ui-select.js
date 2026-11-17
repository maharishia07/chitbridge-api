/**
 * ui-select.js — THE SELECT (CMP056, UX-137, docs PM/UX137-REDUCTION-PLAN-2026-11-15 section 6.2). One part for a pick-one list: a screen never hand-writes a <select>,
 * its label, its hint or its 44 px size, it MOUNTS one. It takes over the List select (CMP035) and the Books select (CMP041) as aliases until their pages convert.
 *
 * OWNS       ui.select(options) -> one HTML string (label, native select, hint, error) · ui.select.read / set (repaint locally, never rebuild the form) · the one delegated change listener.
 * CALLED BY  a page that draws a pick-one list: product-lab.html first (the shelf filter). Loaded AFTER app/ui.js (it reads ui.words, ui.escape, ui.style from it).
 * KEYBOARD   a native <select>: Tab reaches it, arrows and type-ahead choose, the ring is 2 px --accent; a change hands the value to the page, it never commits by itself.
 * REGISTER   CMP056, element S01. The element carries data-cbsid, data-cbname="select", data-cbmount (a screen mount code like PLB001-U02).
 * CARD       29-qa-test-tooling-ux-locale-and-design-system/design-system
 * FLOW       none (a drawing library).
 * OWNER      cb-ux-locale
 * RISK       Tier 2: draws a control, writes nothing
 * ID         CMP056
 *
 * THE RULES IT ENFORCES (it throws, because silence is the bug): an unknown property, a missing mount or label, an empty or malformed option list, a handler given as a string.
 * A select never writes: onChange gets the value, and a change that writes goes through CBAction.run in the page's handler (M64: one press, one write, a confirm for a commit).
 * SHOW-ACTION: a refused select (role {ok:false, why} or disabled:"sentence") stays on the screen, greyed, WITH its sentence as visible text; it is never hidden.
 * Option labels are shown as written (a name from the data is never translated); an option with words:true is a fixed English word and goes through the catalogue.
 */
var CBUiSelect = (function () {
  var MOUNT_CODE = /^[A-Z]{3}\d{3}(?:-D\d{2})?-U\d{2,3}$/;
  var ALLOWED = ['mount', 'key', 'label', 'value', 'options', 'hint', 'error', 'required', 'role', 'disabled', 'id', 'testid', 'cls', 'data', 'bare', 'onChange'];
  var HANDLERS = {};
  var SELECT_STYLE =
    '.cbs{margin:3px 0 11px;max-width:100%;box-sizing:border-box;min-width:0}' +
    '.cbs-l{display:block;font-size:12px;color:var(--grey-3,var(--dim,#5e594d))}' +
    '.cbs .cbs-in,select.cbs-in{max-width:100%;box-sizing:border-box;min-height:max(44px,var(--act-h,44px));padding:8px;border:1px solid var(--field-edge,#85807C);' +
    'border-radius:8px;font:inherit;font-size:14px;color:var(--ink,#2a2418);background:var(--card,#fff)}' +
    '.cbs:not(.cbs-bare) .cbs-in{display:block;width:100%;margin-top:3px}' +
    '.cbs-in:focus-visible{outline:2px solid var(--accent,#1f5f5b);outline-offset:2px}' +
    '.cbs-in[disabled]{color:var(--dim,#5e594d);cursor:not-allowed}.cbs-in[aria-invalid="true"]{border-color:var(--field-bad,#b4453f)}' +
    '.cbs-h{font-size:11.5px;color:var(--grey-3,var(--dim,#5e594d));margin-top:3px;overflow-wrap:anywhere}' +
    '.cbs-e{font-size:12.5px;color:var(--field-bad,#b4453f);margin-top:3px;overflow-wrap:anywhere}' +
    '.cbs-bare{display:inline-block;margin:0}';

  function refuse(reason) {
    throw new Error('ui.select: ' + reason);
  }
  function library() {
    var lib = typeof window !== 'undefined' ? window.ui : null;
    if (!lib || !lib.words || !lib.escape) refuse('app/ui.js must be loaded before app/ui-select.js');
    return lib;
  }
  function ensureStyle() {
    library().style();
    if (typeof document === 'undefined' || !document.head || document.getElementById('cbui-select-css')) return;
    var node = document.createElement('style');
    node.id = 'cbui-select-css';
    node.textContent = SELECT_STYLE;
    document.head.appendChild(node);
  }
  function pairs(list) {
    var esc = library().escape;
    return list.filter(function (pair) { return pair[1] !== null && pair[1] !== undefined && pair[1] !== false; })
      .map(function (pair) { return pair[1] === true ? pair[0] : pair[0] + '="' + esc(pair[1]) + '"'; }).join(' ');
  }
  /** an option is a plain string (value and label alike) or { value, label, words? } */
  function normalOption(item) {
    if (typeof item === 'string' || typeof item === 'number') return { value: String(item), label: String(item) };
    if (!item || typeof item !== 'object' || item.value === undefined || item.label === undefined) refuse('each option is a string or { value, label }');
    return { value: String(item.value), label: String(item.label), words: !!item.words };
  }
  function checkOptions(options) {
    if (!options || typeof options !== 'object') refuse('options are required');
    Object.keys(options).forEach(function (name) { if (ALLOWED.indexOf(name) < 0) refuse('"' + name + '" is not a property of the select'); });
    if (!MOUNT_CODE.test(options.mount || '')) refuse('mount must be a screen mount code like PLB001-U02');
    if (!options.label || !String(options.label).trim()) refuse('label is required (the accessible name)');
    checkList(options);
  }
  function checkList(options) {
    if (!Array.isArray(options.options) || !options.options.length) refuse('options: give a list of at least one option');
    options.options.forEach(normalOption);
    if (options.onChange !== undefined && typeof options.onChange !== 'function') refuse('onChange must be a function, never inline JavaScript');
  }
  function idOf(options) {
    if (options.id) return String(options.id);
    var tail = options.key === undefined || options.key === null ? '' : '-' + String(options.key).toLowerCase().replace(/[^a-z0-9_-]/g, '');
    return options.mount.toLowerCase() + tail;
  }
  /** why a select is greyed: role {ok:false, why} (permission) outranks disabled:'sentence' (state); null when it can be used */
  function disabledReason(options) {
    if (options.role && options.role.ok === false) return String(options.role.why || '');
    if (!options.disabled) return null;
    if (typeof options.disabled !== 'string' || !options.disabled.trim()) refuse('disabled: give the reason as a sentence; a greyed select always says why');
    return options.disabled;
  }
  function optionHtml(item, chosen) {
    var lib = library(), shown = item.words ? lib.words(item.label) : item.label;
    return '<option value="' + lib.escape(item.value) + '"' + (item.value === chosen ? ' selected' : '') + '>' + lib.escape(shown) + '</option>';
  }
  /** the data-* bag and the aria-describedby of one select */
  function describedPairs(options, id, reason) {
    var data = Object.keys(options.data || {}).map(function (suffix) { return ['data-' + suffix, String(options.data[suffix])]; });
    var describedBy = [options.hint || reason ? id + '-h' : '', options.error ? id + '-e' : ''].filter(Boolean).join(' ') || null;
    return data.concat([['aria-describedby', describedBy]]);
  }
  function controlHtml(options, id, reason) {
    var attributes = pairs([['data-cbsid', 'CMP056-S01'], ['data-cbname', 'select'], ['data-cbmount', options.mount], ['id', id], ['class', 'cbs-in' + (options.cls ? ' ' + options.cls : '')],
      ['data-testid', options.testid], ['aria-label', options.bare ? library().words(String(options.label)) : null], ['required', !!options.required], ['disabled', reason !== null],
      ['aria-invalid', options.error ? 'true' : null]].concat(describedPairs(options, id, reason)));
    var chosen = options.value === undefined || options.value === null ? null : String(options.value);
    return '<select ' + attributes + '>' + options.options.map(function (item) { return optionHtml(normalOption(item), chosen); }).join('') + '</select>';
  }
  function noteHtml(options, id, reason) {
    var esc = library().escape, text = [options.hint, reason].filter(Boolean).map(function (part) { return esc(part); }).join(' · ');
    var hint = text ? '<div class="cbs-h" id="' + id + '-h">' + text + '</div>' : '';
    return hint + (options.error ? '<div class="cbs-e" id="' + id + '-e"><span aria-hidden="true">⚠ </span>' + esc(options.error) + '</div>' : '');
  }
  /** the part: ui.select({ mount, label, value, options, ... }) -> HTML */
  function select(options) {
    checkOptions(options);
    var id = idOf(options), reason = disabledReason(options);
    ensureStyle();
    if (options.onChange) HANDLERS[id] = options.onChange;
    var control = controlHtml(options, id, reason);
    if (options.bare) return '<span class="cbs cbs-bare">' + control + '</span>';
    return '<div class="cbs"><label class="cbs-l" for="' + id + '">' + library().escape(library().words(String(options.label))) + '</label>' + control + noteHtml(options, id, reason) + '</div>';
  }
  function elementOf(target) {
    if (target && typeof target === 'object') return target;
    return typeof document !== 'undefined' ? document.getElementById(String(target)) : null;
  }
  /** the chosen value as a string, or undefined when the select is not on the page */
  function read(target) {
    var el = elementOf(target);
    return el ? el.value : undefined;
  }
  /** choose a value from outside (a refused change, a reset): repaint this select only */
  function set(target, value) {
    var el = elementOf(target);
    if (el) el.value = String(value);
  }
  function onChange(event) {
    var el = event && event.target;
    if (!el || !el.getAttribute || el.getAttribute('data-cbname') !== 'select') return;
    var handler = HANDLERS[el.id];
    if (handler) handler(el.value, el, event);
  }
  if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('change', onChange);
  select.read = read;
  select.set = set;
  if (typeof window !== 'undefined' && window.ui) window.ui.select = select;
  return select;
})();
