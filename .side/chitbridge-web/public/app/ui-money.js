/**
 * ui-money.js — THE MONEY FIELD (CMP055-I05, UX-137, M36 · R16 · T16 · CUR-1). Lifted out of cap-books.js (bkMoneyInput and its readers), docs critique UI-MONEY-FIELD-PLAN section 8.
 * OWNS       CBUiMoney.input (the field's HTML: symbol, amount text, the currency kept on the field) · clamp (per keystroke: digits of other scripts become ASCII, NOTHING is deleted) ·
 *            minor (the ONE money reader: typed text -> minor units, or NaN) · refusal (the sentence a refused text earns) · read (an element -> { value, currency } | { value: NaN, error }) ·
 *            minorText (minor units -> plain decimal text, string arithmetic) · currency / decimals / symbol · the ui.field kind 'money' (plugged into app/ui-field.js).
 * DOES NOT   no money arithmetic, no rounding, no operator of its own: the page hands { minor, currency } to CBMoney, which refuses a mismatch or a null currency.
 * MARKS      the decimal mark, grouping and lakh rule come from CBUiField.marks() and the number reader CBUiField.parse, the same ones every number field uses (one source).
 * OWNER      cb-finance with cb-accounting (the M36 money unit) · RISK money (Tier 1) · ID CMP055-I05
 * CALLED BY  cap-books.js (its bkMoneyInput / bkMoneyMinor / bkMoneyRead names are one-line wrappers) · any page that mounts ui.field({ kind: 'money' }). Loaded AFTER app/ui.js and app/ui-field.js.
 * KEYBOARD   a native text input: Tab reaches it, the decimal keypad opens on a phone; a refused amount is said under the field when focus leaves it (role="alert").
 * REGISTER   CMP055 element I05 (data-cbsid on the input, data-cbname="field" and data-cbkind="money" when drawn by ui.field).
 * CARD       29-qa-test-tooling-ux-locale-and-design-system/design-system
 * FLOW       none (a drawing and reading library).
 *
 * THE RULES (silence is the bug): the field keeps EXACTLY what was typed; a wrong mark ("1,50" in a "." locale), a digit of another script, an extra place, a sign, a letter or an amount
 * past 2^53 is REFUSED at read with a sentence, never stripped, truncated or read as a different number. Only a space and the field's own currency symbol or code are ignored.
 */
var CBUiMoney = (function () {
  var UNKNOWN = 'unknown';
  var MAX_MINOR = 9007199254740991; /* Number.MAX_SAFE_INTEGER: beyond it a minor-unit integer is no longer exact */

  /* ---------- currency, decimals, symbol (moved unchanged from cap-books.js) ---------- */
  /** the currency a money field uses: the one given, else the ledger's own (BK.cur, GET /health), else the pack's; none known -> undefined, never INR (N1) */
  function currency(code) {
    return (
      code ||
      (typeof SESSION !== 'undefined' && SESSION.currency) ||
      (typeof BK !== 'undefined' && BK.cur) ||
      ((typeof shopReg === 'function' && shopReg()) || {}).currency
    );
  }
  /** the decimals of a currency code (INR 2, JPY 0, OMR 3); a code the engine cannot read says 2 and is counted by the page's quiet log */
  function decimalsOf(code) {
    try {
      return CBMoney.decimals(code);
    } catch (failure) {
      return typeof bkQuiet === 'function' ? bkQuiet('decimals', failure, 2) : 2;
    }
  }
  function decimals(code) {
    return decimalsOf(currency(code));
  }
  /** the currency's symbol for an input; none stated -> no symbol (N1) */
  function symbol(code) {
    try {
      return code ? CBLocale.symbol(code) : '';
    } catch (_) {
      return code || '';
    }
  }

  /* ---------- the shop's number marks: the field library's, never a copy ---------- */
  function fieldLibrary() {
    if (typeof CBUiField === 'undefined' || !CBUiField.marks) throw new Error('CBUiMoney needs app/ui-field.js loaded before it');
    return CBUiField;
  }
  function words(english, key, values) {
    var text = typeof ui !== 'undefined' && ui && ui.words ? ui.words(english, 'CMP055.' + key) : english;
    return values ? text.replace(/\{(\w+)\}/g, function (whole, name) { return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : whole; }) : text;
  }

  /* ---------- minor units to text, and back ---------- */
  /** minor units -> plain decimal text in the shop's decimal mark (string arithmetic, no float): 12345 INR -> "123.45" */
  function minorText(minorUnits, code, marks) {
    var places = decimals(code),
      whole = Math.trunc(Number(minorUnits || 0)),
      mark = (marks || fieldLibrary().marks()).mark,
      sign = whole < 0 ? '-' : '',
      text = String(Math.abs(whole));
    if (!places) return sign + text;
    text = text.padStart(places + 1, '0');
    return sign + text.slice(0, -places) + mark + text.slice(-places);
  }
  /** keep what was typed; only a digit of another script (and the Arabic decimal mark) becomes its ASCII / shop-mark twin, so the box never empties and never changes the number */
  function clamp(el) {
    var mapped = fieldLibrary().ascii(String(el.value || ''), fieldLibrary().marks());
    if (mapped !== el.value) el.value = mapped;
  }

  /* ---------- the one reader ---------- */
  function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  /** the typed text without what is harmless: spaces, direction marks, and the field's OWN symbol or code (a different currency's symbol stays and is refused) */
  function bareText(text, code) {
    var bare = String(text == null ? '' : text).replace(/[\s\u200e\u200f\u061c]/g, '');
    [symbol(code), code].forEach(function (own) {
      if (own) bare = bare.replace(new RegExp('^' + escapeRegExp(own) + '|' + escapeRegExp(own) + '$', 'i'), '');
    });
    return bare;
  }
  /** the sentence for a number with more places than its currency has */
  function placesWords(places) {
    if (!places) return words('This currency has no decimals. Type a whole amount, like 150', 'moneywhole');
    var example = '1' + fieldLibrary().marks().mark + '50'.padEnd(places, '0').slice(0, places);
    return words('This currency has {n} decimals at most, for example {example}', 'moneyplaces', { n: places, example: example });
  }
  function refused(sentence) {
    return { value: NaN, error: sentence };
  }
  /** the sentence for a leading sign (a minus used to be dropped and a plus too), or '' when the text has none */
  function signWords(shown) {
    if (/^-/.test(shown)) return words('Type the amount without a minus sign', 'moneyminus');
    return /^\+/.test(shown) ? words('That is not a number. Type digits only, like 1234.5', 'badnumber') : '';
  }
  /** a canonical decimal ("1234.50") -> minor units by joining digits as text (never multiplied), or the refusal: too many places, or above 2^53 */
  function minorFromCanonical(canonical, places) {
    var halves = canonical.split('.'),
      fraction = halves[1] || '';
    if (fraction.length > places) return refused(placesWords(places));
    var joined = (halves[0] === '' ? '0' : halves[0]) + fraction.padEnd(places, '0'),
      minorUnits = Number(joined);
    if (joined.replace(/^0+/, '').length > 16 || minorUnits > MAX_MINOR) return refused(words('That amount is too large to read exactly. Check the digits', 'moneybig'));
    return { value: minorUnits };
  }
  /** one read of typed text: { value: <integer minor units> } | { value: NaN, empty: true } | { value: NaN, error: <sentence> }. Never a number beside an error. */
  function readText(text, code, marks) {
    var typed = bareText(text, code);
    if (!typed) return { value: NaN, empty: true };
    var shown = fieldLibrary().ascii(typed, marks || fieldLibrary().marks()),
      signed = signWords(shown);
    if (signed) return refused(signed);
    var parsed = fieldLibrary().parse(shown, marks);
    return parsed.ok ? minorFromCanonical(parsed.value, decimalsOf(code)) : refused(parsed.error);
  }
  /** the text a money field holds -> minor units: an integer, or NaN (empty, or refused: ask refusal for the sentence) */
  function minor(text, code, marks) {
    return readText(text, currency(code), marks).value;
  }
  /** the sentence a refused text earns, or '' when it reads (or is empty) */
  function refusal(text, code, marks) {
    return readText(text, currency(code), marks).error || '';
  }
  /** the currency stamped on a field: the code, or null for 'unknown' (a field drawn by ui.field never falls back to the ledger's; an old call site's empty stamp reads the ledger's, as it always did) */
  function fieldCurrency(el) {
    var stamped = el.getAttribute('data-cur') || '';
    if (stamped) return stamped;
    return el.getAttribute('data-cbkind') === 'money' ? null : currency() || null;
  }
  /** an element -> { value: minor units, currency } | { value: NaN, currency } (empty) | { value: NaN, currency, error } */
  function read(target) {
    var el = typeof target === 'string' ? document.getElementById(target) : target;
    if (!el) return { value: NaN, currency: null };
    var code = fieldCurrency(el),
      answer = readText(el.value, code);
    answer.currency = code;
    return answer;
  }

  /* ---------- saying a refusal under the field ---------- */
  /** the line under an old-style field (one drawn by bkMoneyInput, with no label block of its own), made when first needed */
  function errorLineOf(el) {
    var line = document.getElementById(el.id + '-e'),
      box = el.closest ? el.closest('.mi') : null;
    if (line || !box) return line;
    line = document.createElement('div');
    line.id = el.id + '-e';
    line.className = 'mi-err';
    line.setAttribute('role', 'alert');
    line.style.cssText = 'color:var(--red,#b3261e);font-size:.85em;margin-top:4px';
    box.insertAdjacentElement('afterend', line);
    return line;
  }
  function clearLine(el) {
    var line = document.getElementById(el.id + '-e');
    if (line) line.remove();
    el.removeAttribute('aria-invalid');
    el.removeAttribute('aria-describedby');
  }
  /** show the sentence under the field, or take the line away (null) */
  function showRefusal(el, sentence) {
    if (el.getAttribute('data-cbname') === 'field') return fieldLibrary().error(el, sentence);
    if (!sentence) return clearLine(el);
    var line = errorLineOf(el);
    if (line) line.textContent = '⚠ ' + sentence;
    el.setAttribute('aria-invalid', 'true');
    return el.setAttribute('aria-describedby', el.id + '-e');
  }
  /** read a field and say what is wrong with it, or clear the line: what a focus-out and a Save of ui.field make */
  function settle(el) {
    var answer = read(el);
    showRefusal(el, answer.error || null);
    return answer;
  }

  /* ---------- the HTML: one builder for the old call sites and for ui.field ---------- */
  function escapeText(text) {
    return typeof window.esc === 'function' ? window.esc(text) : ui.escape(text);
  }
  /** the register mount of the input: the field's own (ui.field passes ''), else the screen's, none where the books script is not loaded */
  function mountOf(options) {
    if (options.mountAttr !== undefined) return options.mountAttr;
    return typeof bkMountAttribute === 'function' ? bkMountAttribute('CMP055') : '';
  }
  /** the text a new field starts with: the typed text, or minor units drawn as decimal text */
  function startText(options, code) {
    if (options.text != null) return options.text;
    return options.minor != null && options.minor !== '' ? minorText(options.minor, code) : '';
  }
  /** the input's tag. A field drawn by ui.field leaves the oninput off (the library's own listener clamps). */
  function inputTag(options, code) {
    var clampCall = options.delegated ? '' : ' oninput="bkMoneyClamp(this);' + (options.on || '') + '"';
    return (
      '<input data-cbsid="CMP055-I05"' + mountOf(options) + ' class="mi-in" id="' + options.id + '" data-testid="' + escapeText(options.tid || options.id) +
      '" data-money="1" data-cur="' + escapeText(code || '') + '" inputmode="decimal" autocomplete="off" placeholder="' +
      escapeText(options.ph != null ? options.ph : minorText(0, code)) + '" value="' + escapeText(startText(options, code)) + '"' + clampCall + (options.extra ? ' ' + options.extra : '') + '>'
    );
  }
  /**
   * the field's HTML. options: { id, tid?, minor? | text?, cur?, ph?, on? (inline js run on input), extra? (raw attrs on the input), w? (css width of the whole field) } — the old bkMoneyInput options.
   * stamped (ui.field only): the currency code, or '' for 'unknown'; left out, the ledger's currency is used as before.
   */
  function inputHtml(options, stamped) {
    var code = stamped === undefined ? currency(options.cur) : stamped;
    return '<span class="mi"' + (options.w ? ' style="width:' + options.w + '"' : '') + '><span class="mi-sym" aria-hidden="true">' + escapeText(symbol(code)) + '</span>' + inputTag(options, code) + '</span>';
  }

  /* ---------- ui.field({ kind: 'money', mount, label, currency, value | minor }) ---------- */
  /** currency is a code or the word 'unknown': never defaulted, never INR (CUR-1). Throws, because silence is the bug. */
  function checkField(options) {
    var code = options.currency;
    if (typeof code !== 'string' || !(code === UNKNOWN || /^[A-Z]{3}$/.test(code))) throw new Error('ui.field money: currency is required, a three-letter code or the word "unknown"');
    if (options.minor !== undefined && options.value !== undefined) throw new Error('ui.field money: give minor (integer minor units) or value (text), not both');
    if (options.minor !== undefined && options.minor !== null && !Number.isSafeInteger(options.minor)) throw new Error('ui.field money: minor must be a safe integer of minor units');
  }
  function fieldInput(options, id, reason, parts) {
    var code = options.currency === UNKNOWN ? '' : options.currency,
      attrs = parts.pairs([['data-cbname', 'field'], ['data-cbkind', 'money'], ['data-cbmount', options.mount], ['name', options.name], ['required', !!options.required], ['readonly', reason !== null],
        ['aria-invalid', options.error ? 'true' : null], ['aria-describedby', parts.describedBy(id, !!(options.hint || reason), !!options.error, false)]]);
    var drawn = { id: id, tid: options.testid, ph: options.placeholder, extra: attrs, mountAttr: '', delegated: true };
    if (options.minor !== undefined && options.minor !== null) drawn.minor = options.minor;
    else if (options.value !== undefined && options.value !== null) drawn.text = options.value;
    return inputHtml(drawn, code);
  }
  function draw(options, id, reason, parts) {
    checkField(options);
    return '<div class="cbf">' + parts.label(options, id) + fieldInput(options, id, reason, parts) + parts.note(options, id, reason) + parts.error(options, id) + '</div>';
  }

  /* ---------- leaving a money field says what is wrong; typing it right clears the line ---------- */
  function moneyTarget(event) {
    var el = event && event.target;
    return el && el.getAttribute && el.getAttribute('data-money') === '1' ? el : null;
  }
  function onFocusOut(event) {
    var el = moneyTarget(event);
    if (el) settle(el);
  }
  function onInput(event) {
    var el = moneyTarget(event);
    if (el && el.getAttribute('aria-invalid') === 'true' && !read(el).error) showRefusal(el, null);
  }
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('input', onInput);
  }
  if (typeof CBUiField !== 'undefined' && CBUiField.plug) CBUiField.plug('money', { draw: draw, read: read, settle: settle, input: clamp });

  return {
    UNKNOWN: UNKNOWN, MAX_MINOR: MAX_MINOR, currency: currency, decimals: decimals, symbol: symbol, minorText: minorText, clamp: clamp, minor: minor, refusal: refusal, read: read, settle: settle,
    input: inputHtml, draw: draw
  };
})();
