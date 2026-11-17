'use strict';
// @type: unit
/**
 * ui-field-w3.test.cjs - UX-137 wave 3, group G4: the register form's four hand inputs are ui.field mounts (CMP055).
 *
 * OWNS      the proof that app/register-form.js draws the User ID (SCR053-U02), e-mail (U03), code (U04) and the terms tick (U01) with ui.field, keeping each id, data-testid,
 *           placeholder, value and autocomplete; that no hand-written SCR053-I0x data-cbsid is left; that the tick reaches REG.agreed through the real delegated change
 *           handler and repaints; that settings.html loads ui-field.js after ui.js; and the mutation (W3_MUTATE=revert puts a hand input back and must fail it).
 * CALLED BY ci.yml (QA gate, beside ui-field-dense); by hand: node e2e/ui-field-w3.test.cjs
 * FLOW      run ui.js + ui-field.js + register-form.js in a vm with a fake document, paint the two steps, fire the page's own change event on the drawn controls
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');
let failures = 0;
const check = (ok, message) => { console.log((ok ? '  ok ' : '  FAIL ') + message); if (!ok) failures++; };
const mutate = process.env.W3_MUTATE || '';

const heard = {};
const painted = [];
const host = { set innerHTML(html) { painted.push(html); }, get innerHTML() { return painted[painted.length - 1] || ''; } };
const sandbox = {
  console,
  tx: (text) => text,
  txf: (text, values) => String(text).replace(/\{(\w+)\}/g, (whole, name) => (values && name in values ? values[name] : whole)),
  esc: (text) => String(text).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])),
  CBAction: { run: () => Promise.resolve() },
  CBGov: { read: () => ({}), rows: () => [{ key: 'currency', what: 'Currency', value: 'AUD', from: 'the shop', known: true }] },
  document: { addEventListener: (name, fn) => { heard[name] = fn; }, querySelectorAll: () => [], querySelector: () => null, getElementById: () => null },
  setTimeout, clearTimeout
};
vm.createContext(sandbox);
sandbox.window = sandbox;
vm.runInContext(read('app/ui.js'), sandbox);
vm.runInContext(read('app/ui-field.js'), sandbox);
let source = read('app/register-form.js');
if (mutate === 'autofill') source = source.replace("kind: 'email', id: 'r_email'", "kind: 'text', id: 'r_email'");
if (mutate === 'revert') source = source.replace("ui.field({ mount: 'SCR053-U04'", "String({ mount: 'SCR053-U04'");
vm.runInContext(source, sandbox);

const tagOf = (html, id) => (html.match(new RegExp('<input[^>]* id="' + id + '"[^>]*>')) || [''])[0];
const asEvent = (id, kind, extra) => ({ target: Object.assign({ id, getAttribute: (name) => ({ 'data-cbname': 'field', 'data-cbkind': kind }[name]), value: '' }, extra) });

console.log('the form step: User ID and e-mail');
sandbox.REG = { step: 'form', name: 'acme"s', email: 'a@b.example', busy: false, err: '' };
sandbox.CBRegistration.mount(host, () => {});
let html = host.innerHTML;
const name = tagOf(html, 'r_name'), email = tagOf(html, 'r_email');
check(/data-cbmount="SCR053-U02"/.test(name) && /data-cbsid="CMP055-I01"/.test(name) && /data-testid="reg-name"/.test(name) && /placeholder="acmetraders"/.test(name) && /value="acme&quot;s"/.test(name), 'User ID: a CMP055 text field, id, testid, placeholder kept, value escaped');
check(/autocapitalize="off"/.test(name) && /spellcheck="false"/.test(name), 'User ID keeps autocapitalize off and spellcheck off');
check(/type="email"/.test(email) && /autocomplete="email"/.test(email) && /autocomplete="username"/.test(name), 'e-mail is type email with autocomplete email, User ID is autocomplete username (browser autofill works)');
check(/data-cbmount="SCR053-U03"/.test(email) && /data-testid="reg-email"/.test(email) && /value="a@b.example"/.test(email) && /for="r_email"/.test(html), 'e-mail: a CMP055 field, testid and value kept, its label is tied to it (for=)');

console.log('the code step: the code box and the terms tick');
sandbox.REG = { step: 'otp', name: 'acme', email: 'a@b.example', busy: false, err: '', agreed: false, country: '', spin: null };
sandbox.CBRegistration.mount(host, () => {});
html = host.innerHTML;
const otp = tagOf(html, 'r_otp'), agree = tagOf(html, 'r_agree');
check(/data-cbmount="SCR053-U04"/.test(otp) && /data-testid="reg-otp"/.test(otp) && /autocomplete="one-time-code"/.test(otp) && /inputmode="numeric"/.test(otp) && /maxlength="6"/.test(otp) && /placeholder="6-digit code"/.test(otp), 'code: a CMP055 field with one-time-code, numeric keypad, placeholder and testid kept');
check(/Code sent to a@b.example/.test(html), 'the code label still names the address');
check(/type="checkbox"/.test(agree) && /data-cbmount="SCR053-U01"/.test(agree) && /data-testid="reg-agree"/.test(agree) && agree.indexOf(' checked') < 0, 'terms tick: a CMP055 checkbox, testid kept, unticked');
check(!/data-cbsid="SCR053-I0[1-4]"/.test(html) && !/data-cbsid="SCR053-I0[1-4]"/.test(source), 'no hand-written SCR053-I01..I04 is left in the page or its output');

console.log('the tick reaches REG.agreed through the real change handler');
const before = painted.length;
heard.change(asEvent('r_agree', 'checkbox', { checked: true }));
check(sandbox.REG.agreed === true, 'ticking sets REG.agreed');
check(painted.length === before + 1 && / checked/.test(tagOf(host.innerHTML, 'r_agree')), 'the form repaints once and the tick stays ticked');
heard.change(asEvent('r_agree', 'checkbox', { checked: false }));
check(sandbox.REG.agreed === false, 'unticking clears REG.agreed');

console.log('the error line is announced');
const errored = source.match(/<div class="err"[^>]*>/g) || [];
check(errored.length === 2 && errored.every((tag) => /role="alert"/.test(tag)), 'both error lines carry role=alert');

console.log('settings.html loads the part');
const settings = read('settings.html');
const at = (file) => settings.indexOf('src="/app/' + file + '"');
check(at('ui.js') > 0 && at('ui-field.js') > at('ui.js') && at('ui-field.js') < at('register-form.js'), 'ui-field.js is loaded after ui.js and before register-form.js');
console.log(failures ? failures + ' FAILED' : 'ALL PASS');
process.exit(failures ? 1 : 0);
