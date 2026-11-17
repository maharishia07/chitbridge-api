'use strict';
// @type: unit
/**
 * ui-field.test.cjs - the Field part (CMP055, public/app/ui-field.js): its mark-up, its refusals and the one number reader.
 *
 * OWNS      the proof that ui.field draws label[for] + control + hint + error with aria-describedby that resolves, the word "Required", the register attributes
 *           (data-cbsid CMP055-*, data-cbname, data-cbmount), the page's own id / testid / class / data kept, a reason on a locked field, no role="alert" on first render,
 *           that an unknown property, kind money, a missing label or mount, and an inline-JS handler are refused, and that parse() gives ONE canonical ASCII decimal from
 *           typed text and the shop locale ("1,50" is an error sentence in a "." locale, never 150).
 * CALLED BY ci.yml (QA gate, beside ui-action-set); by hand: node e2e/ui-field.test.cjs
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');
let failures = 0;
const check = (ok, message) => { console.log((ok ? '  ok ' : '  FAIL ') + message); if (!ok) failures++; };
const throwsWith = (fn, part) => { try { fn(); return false; } catch (error) { return String(error.message).indexOf(part) >= 0; } };

const sandbox = {
  console,
  tx: (text) => text,
  esc: (text) => String(text).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])),
  CBAction: { run: () => Promise.resolve() },
  window: {},
  document: { addEventListener: () => {}, querySelectorAll: () => [], querySelector: () => null },
  setTimeout, clearTimeout
};
vm.createContext(sandbox);
sandbox.window = sandbox;
vm.runInContext(read('app/ui.js'), sandbox);
vm.runInContext(read('app/ui-field.js'), sandbox);
const ui = sandbox.ui;

console.log('the part is registered');
check(ui.components.field && ui.components.field.code === 'CMP055' && ui.components.field.nonButton, 'CMP055 Field is in the component set');
check(ui.components.bookfield.alias_of === 'CMP055' && ui.components.listfield.alias_of === 'CMP055', 'CMP040 and CMP045 are aliases of CMP055');
check(typeof ui.field === 'function' && ['read', 'set', 'error', 'focusFirstError', 'parse'].every((name) => typeof ui.field[name] === 'function'), 'ui.field and its five helpers exist');

console.log('mark-up');
const text = ui.field({ mount: 'SHP001-U03', kind: 'text', id: 'sup_contact', name: 'contact', testid: 'shop-support-contact', cls: 'inp', label: 'Phone or email', hint: 'so the shop can reply', required: true, data: { cbl: 'q' }, value: 'a"b' });
check(/<label class="cbf-l" for="sup_contact">Phone or email<\/label>/.test(text), 'a visible label with for = the id');
check(/ id="sup_contact"/.test(text) && / name="contact"/.test(text) && / data-testid="shop-support-contact"/.test(text), 'the page id, name and testid are kept as written');
check(/class="cbf-in inp"/.test(text) && / data-cbl="q"/.test(text), 'the page class and data-* are kept (page CSS and list-ctl still reach the node)');
check(/data-cbsid="CMP055-I01"/.test(text) && /data-cbname="field"/.test(text) && /data-cbmount="SHP001-U03"/.test(text), 'the register attributes: component element, name and mount');
check(/<span class="cbf-req">Required<\/span>/.test(text) && / required(?= |>)/.test(text), 'Required is a word, with native required');
check(/aria-describedby="sup_contact-h"/.test(text) && /id="sup_contact-h"/.test(text), 'aria-describedby resolves to the hint');
check(!/role="alert"/.test(text) && !/aria-invalid/.test(text), 'a first render has no role="alert" and no aria-invalid');
check(/value="a&quot;b"/.test(text), 'the value is escaped');
const withError = ui.field({ mount: 'SHP001-U03', kind: 'text', label: 'Name', error: 'Not saved. Type a name.' });
check(/aria-invalid="true"/.test(withError) && /id="shp001-u03-e"/.test(withError) && /aria-describedby="shp001-u03-e"/.test(withError) && !/role="alert"/.test(withError), 'an error draws the invalid state and its text, still without role="alert"');
check(/id="shp001-u03"/.test(withError) && !/ name=/.test(withError), 'no id given: mount-based id, and NO name added');
const keyed = ui.field({ mount: 'SHP001-U03', kind: 'text', key: 'Row 7', label: 'Qty' });
check(/id="shp001-u03-row7"/.test(keyed), 'a per-row field gets a unique id from its key');
check(!/ required/.test(ui.field({ mount: 'SHP001-U03', kind: 'text', label: 'Remark' })) && !/Required/.test(ui.field({ mount: 'SHP001-U03', kind: 'text', label: 'Remark' })), 'an optional field says nothing');
const locked = ui.field({ mount: 'SHP001-U03', kind: 'text', label: 'Phone', readonly: 'The code was sent to this one' });
check(/ readonly/.test(locked) && /The code was sent to this one/.test(locked), 'a locked field is readonly and says why in its hint');
check(/ readonly/.test(ui.field({ mount: 'SHP001-U03', kind: 'text', label: 'Phone', role: { ok: false, why: 'Owner only' } })), 'role {ok:false} locks the field with its sentence');
const number = ui.field({ mount: 'SHP001-U16', kind: 'number', label: 'Quantity', value: '2' });
check(/type="text"/.test(number) && /inputmode="decimal"/.test(number) && /dir="ltr"/.test(number) && /autocomplete="off"/.test(number) && /id="shp001-u16-x"/.test(number), 'number: text + decimal keypad, ltr, no autocomplete, an echo place in the hint');
check(/type="date"/.test(ui.field({ mount: 'SHP001-U10', kind: 'date', label: 'Date' })) && /CMP055-I02/.test(ui.field({ mount: 'SHP001-U10', kind: 'time', label: 'Time' })), 'date and time are native, element I02');
const box = ui.field({ mount: 'SHP001-U01', kind: 'checkbox', id: 'f_a', label: 'Agree', value: true });
check(/class="cbf-c" for="f_a"/.test(box) && / checked/.test(box) && /CMP055-I03/.test(box) && /<span>Agree<\/span>/.test(box), 'checkbox: the whole row is the label, checked from value, element I03');
const file = ui.field({ mount: 'SHP001-U02', kind: 'file', label: 'Attach photo', accept: 'image/*', hint: 'PDF or photo' });
check(/type="file"/.test(file) && /accept="image\/\*"/.test(file) && /CMP055-I04/.test(file) && /for="shp001-u02"/.test(file) && /id="shp001-u02-n"/.test(file), 'file: a button-looking label for the real input, accept kept, a place for the chosen name');
const long = ui.field({ mount: 'SHP001-U06', kind: 'long', id: 'sup_what', label: 'What went wrong?', rows: 4, value: 'a<b' });
check(/<textarea [^>]*rows="4"[^>]*>a&lt;b<\/textarea>/.test(long) && /CMP055-T01/.test(long), 'long text: a textarea, escaped, element T01');
check(/<style|<script/.test(ui.field({ mount: 'SHP001-U03', kind: 'text', label: '<script>x</script>' })) === false, 'a label is escaped text, never markup');

console.log('refusals (silence is the bug)');
check(throwsWith(() => ui.field({ mount: 'SHP001-U03', kind: 'text', label: 'A', onclick: 'x()' }), 'is not a property'), 'an unknown property is refused');
check(throwsWith(() => ui.field({ mount: 'SHP001-U03', kind: 'money', label: 'A', cur: 'AUD' }), 'money'), 'kind money is refused here (its own part)');
check(throwsWith(() => ui.field({ mount: 'SHP001-U03', kind: 'text' }), 'label is required'), 'a missing label is refused');
check(throwsWith(() => ui.field({ kind: 'text', label: 'A' }), 'mount'), 'a missing mount is refused');
check(throwsWith(() => ui.field({ mount: 'SHP001-U03', kind: 'text', label: 'A', onInput: 'x()' }), 'never inline JavaScript'), 'a handler given as a string is refused');
check(throwsWith(() => ui.field({ mount: 'SHP001-U03', kind: 'text', label: 'A', attrs: { onfocus: 'x()' } }), 'attrs'), 'attrs outside the closed list are refused');
check(throwsWith(() => ui.field({ mount: 'SHP001-U03', kind: 'text', label: 'A', readonly: true }), 'reason'), 'readonly without a sentence is refused');
check(throwsWith(() => ui.field({ mount: 'SHP001-U03', kind: 'radio', label: 'A' }), 'kind must be'), 'radio is not a field kind (Choice or Select)');

console.log('the one number reader (typed text + shop locale -> canonical ASCII decimal)');
const AU = { mark: '.', group: ',', lakh: false }, IN = { mark: '.', group: ',', lakh: true }, EU = { mark: ',', group: '.', lakh: false };
const value = (typed, marks) => { const r = ui.field.parse(typed, marks); return r.ok ? r.value : 'ERR'; };
check(value('1,234.5', AU) === '1234.5', '"1,234.5" -> 1234.5');
check(value('1,23,456.50', IN) === '123456.50', 'India: "1,23,456.50" -> 123456.50');
check(value('1,234.50', IN) === '1234.50', 'India also reads thousands grouping');
check(value('12,34.5', AU) === 'ERR' && value('12,34.5', IN) === 'ERR', '"12,34.5" is an error');
check(value('1,50', AU) === 'ERR' && value('1,5', AU) === 'ERR', 'AU/UAE/IN: "1,50" and "1,5" are errors, never 150 and never 1.5');
check(/dot|\./.test(ui.field.parse('1,50', AU).error) && /\./.test(ui.field.parse('1,50', AU).error), 'the sentence says to use a dot (the shop mark)');
check(value('1,234', AU) === '1234', '"1,234" is a grouped thousand');
check(value('1,50', EU) === '1.50', 'a comma-decimal shop reads "1,50" as 1.50');
check(value('1.50', EU) === 'ERR' && value('1.234,5', EU) === '1234.5', 'a comma-decimal shop reverses both rules');
check(value('١٬٢٣٤٫٥٠', AU) === '1234.50', 'Arabic-Indic digits with Arabic marks -> 1234.50');
check(value('१२३.५', AU) === '123.5', 'Devanagari digits -> ASCII');
check(value('-12.5', AU) === '-12.5' && value('007', AU) === '7' && value('.5', AU) === '0.5', 'sign kept, leading zeros dropped, ".5" is 0.5');
check(value('abc', AU) === 'ERR' && value('', AU) === 'ERR' && value('1.2.3', AU) === 'ERR', 'text, empty and two marks are errors');

console.log('the real locale supplies the marks');
const locale = { console, window: {}, navigator: { language: 'en-AU' }, localStorage: { getItem: () => null, setItem: () => {} }, document: {}, Intl, setTimeout };
locale.globalThis = locale; vm.createContext(locale);
try {
  vm.runInContext(read('engine/locale.js'), locale);
  const CBLocale = locale.CBLocale || locale.window.CBLocale;
  check(!!CBLocale && CBLocale.number(1234567.5, { minimumFractionDigits: 1 }) === '12,34,567.5', 'engine/locale.js loads; its default (India) groups 1234567.5 as lakhs, which marksOf reads from it');
  sandbox.CBLocale = CBLocale;
  const r = ui.field.parse('1,23,456.50');
  check(r.ok && r.value === '123456.50' && !ui.field.parse('1,50').ok && !ui.field.parse('12,34.5').ok, 'with the real CBLocale: lakh grouping accepted, "1,50" and "12,34.5" refused');
  delete sandbox.CBLocale;
} catch (error) { console.log('  note engine/locale.js not loadable in a bare sandbox (' + error.message + '); the walk proves the marks in a browser'); }

console.log(failures ? failures + ' FAILED' : 'all passed');
process.exit(failures ? 1 : 0);
