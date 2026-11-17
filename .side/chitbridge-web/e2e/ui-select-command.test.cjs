'use strict';
// @type: unit
/**
 * ui-select-command.test.cjs — UX-137 plan 6.2: CMP056 Select (public/app/ui-select.js) and CMP057 Command (ui.action('command'), public/app/ui.js).
 *
 * Cases: both are in the register set with their element codes and the alias links; ui.select draws one native select carrying its code, mount and testid, marks the
 * chosen value, shows a data name as written and a words:true option through the catalogue, escapes, refuses an unknown property / bad mount / no label / no options /
 * a string handler, greys WITH a visible sentence (role gate and disabled), and hands the value to onChange through the one delegated listener; ui.action('command') takes
 * its own label and a verb from the closed list, carries data-cbverb, refuses a missing label, a bad verb, an icon and the same label on any other component, a commit with
 * no confirm, and presses through CBAction only for a write; the two converted product-lab controls are the library's. Bare-page safe (no CBAction, no tx, no toast).
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 * Run: node e2e/ui-select-command.test.cjs
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');
let failures = 0;
const check = (condition, message) => { console.log((condition ? '  ok ' : '  FAIL ') + message); if (!condition) failures++; };
const refused = (call, word) => { try { call(); return false; } catch (error) { return error.message.indexOf(word) >= 0; } };

const listeners = {}, runs = [], pressed = [], translated = [];
function load(extra) {
  const sandbox = Object.assign({ console, window: {}, document: { addEventListener: (name, fn) => { listeners[name] = fn; }, getElementById: () => null, querySelectorAll: () => [] } }, extra);
  vm.createContext(sandbox);
  sandbox.window = sandbox;
  vm.runInContext(read('app/ui.js'), sandbox);
  vm.runInContext(read('app/ui-select.js'), sandbox);
  return sandbox;
}
const bare = load({}).ui; /* a bare page: no tx, no CBAction, no toast */
const ui = load({ tx: (text) => { translated.push(text); return text; }, CBAction: { run: (button, fn, options) => { runs.push(options); return Promise.resolve(fn()); } } }).ui;

console.log('the register');
check(ui.components.select.code === 'CMP056' && ui.components.select.element === 'CMP056-S01', 'CMP056 Select, element S01');
check(ui.components.command.code === 'CMP057' && ui.components.command.element === 'CMP057-B01', 'CMP057 Command, element B01');
check(ui.components.bookselect.alias_of === 'CMP056' && ui.components.bookaction.alias_of === 'CMP057', 'CMP041 and CMP042 are aliases of the new rows');
check(typeof ui.select === 'function' && typeof ui.select.read === 'function' && typeof ui.select.set === 'function', 'ui.select with read and set');

console.log('CMP056 Select: mark-up');
const html = ui.select({ mount: 'TST001-U02', id: 'shelf', label: 'Shelf', value: 'b', testid: 'tst-shelf', options: [{ value: '', label: 'Every shelf', words: true }, { value: 'a', label: 'Greens & <b>' }, { value: 'b', label: 'Spices' }] });
check(/^<div class="cbs"><label class="cbs-l" for="shelf">Shelf<\/label><select /.test(html), 'a label tied to the select by for/id');
check(html.includes('data-cbsid="CMP056-S01"') && html.includes('data-cbname="select"') && html.includes('data-cbmount="TST001-U02"') && html.includes('data-testid="tst-shelf"'), 'carries its code, name, mount and testid');
check(/<option value="b" selected>Spices<\/option>/.test(html) && (html.match(/ selected/g) || []).length === 1, 'the chosen value is the one selected option');
check(html.includes('Greens &amp; &lt;b&gt;') && !html.includes('<b>'), 'a data name is escaped');
check(translated.indexOf('Every shelf') >= 0 && translated.indexOf('Greens & <b>') < 0 && translated.indexOf('Spices') < 0, 'a words:true option goes through tx; a data name never does');
const plain = ui.select({ mount: 'TST001-U02', label: 'Unit', options: ['kg', 'litre'] });
check(/<option value="kg">kg<\/option><option value="litre">litre<\/option>/.test(plain) && /id="tst001-u02"/.test(plain), 'plain strings are value and label; the id comes from the mount');
const inline = ui.select({ mount: 'TST001-U02', label: 'Shelf', bare: true, options: ['a'] });
check(/^<span class="cbs cbs-bare"><select [^>]*aria-label="Shelf"/.test(inline) && inline.indexOf('<label') < 0, 'bare draws the select alone, named by aria-label');
const keyed = ui.select({ mount: 'TST001-U02', key: 'Row 7', label: 'Unit', options: ['kg'] });
check(/id="tst001-u02-row7"/.test(keyed), 'a per-row select takes a key into its id');
check(bare.select({ mount: 'TST001-U02', label: 'Unit', options: ['kg'] }).indexOf('<select') > 0, 'works on a bare page (no tx)');

console.log('CMP056 Select: refusals (silence is the bug)');
check(refused(() => ui.select({ mount: 'TST001-U02', label: 'X', options: ['a'], style: 'color:red' }), 'not a property'), 'an unknown property is refused');
check(refused(() => ui.select({ mount: 'nope', label: 'X', options: ['a'] }), 'mount'), 'a bad mount is refused');
check(refused(() => ui.select({ mount: 'TST001-U02', label: ' ', options: ['a'] }), 'label'), 'no label is refused');
check(refused(() => ui.select({ mount: 'TST001-U02', label: 'X', options: [] }), 'options'), 'no options is refused');
check(refused(() => ui.select({ mount: 'TST001-U02', label: 'X', options: [{ value: 1 }] }), 'each option'), 'a malformed option is refused');
check(refused(() => ui.select({ mount: 'TST001-U02', label: 'X', options: ['a'], onChange: 'paint()' }), 'onChange'), 'a handler given as a string is refused');
check(refused(() => ui.select({ mount: 'TST001-U02', label: 'X', options: ['a'], disabled: true }), 'sentence'), 'disabled with no sentence is refused (a greyed select says why)');

console.log('CMP056 Select: show-action (greyed with its sentence, never hidden)');
const gated = ui.select({ mount: 'TST001-U02', id: 'g', label: 'Shelf', options: ['a'], role: { ok: false, why: 'Needs the owner' } });
check(/<select [^>]*disabled/.test(gated) && gated.includes('>Needs the owner<') && /aria-describedby="g-h"/.test(gated), 'a role refusal: the select is there, disabled, with the sentence as visible text');
check(/<select [^>]*disabled/.test(ui.select({ mount: 'TST001-U02', label: 'Shelf', options: ['a'], disabled: 'Locked while the day is closed' })), 'a state refusal greys it too');
check(!/disabled/.test(ui.select({ mount: 'TST001-U02', label: 'Shelf', options: ['a'], role: { ok: true } })), 'an allowed role leaves it enabled');

console.log('CMP056 Select: the change reaches the page (one delegated listener)');
const seen = [];
ui.select({ mount: 'TST001-U03', id: 'pick', label: 'Shelf', options: ['a', 'b'], onChange: (value, el) => seen.push([value, el.id]) });
const fake = { id: 'pick', value: 'b', getAttribute: (name) => (name === 'data-cbname' ? 'select' : null) };
listeners.change({ target: fake });
listeners.change({ target: { id: 'other', value: 'x', getAttribute: () => 'field' } });
check(seen.length === 1 && seen[0][0] === 'b' && seen[0][1] === 'pick', 'onChange gets the value and the element; another control\'s change is ignored');
check(ui.select.read(fake) === 'b' && (ui.select.set(fake, 'a'), fake.value === 'a'), 'read and set work on the element');

console.log('CMP057 Command: own label, closed verb');
const command = ui.action('command', { mount: 'TST001-U04', label: 'Tick all shown', verb: 'TICK', effect: 'none', testid: 'tst-all', size: 'compact', onPress: () => pressed.push('all') });
check(/^<button /.test(command) && command.includes('type="button"') && command.includes('data-cbsid="CMP057-B01"') && command.includes('data-cbname="command"') && command.includes('data-cbmount="TST001-U04"'), 'one native button carrying its code, name and mount');
check(command.includes('data-cbverb="TICK"') && /data-testid="tst-all"/.test(command) && /data-size="compact"/.test(command) && />Tick all shown<\/button>/.test(command), 'the verb, testid, size and the caller\'s own label');
check(translated.indexOf('Tick all shown') >= 0, 'the own label goes through the catalogue (tx)');
check(!/data-effect/.test(command), 'effect none writes no data-effect');
check(/aria-label="Tick all shown pill"/.test(ui.action('command', { mount: 'TST001-U04', label: 'Tick all shown', verb: 'TICK', effect: 'none', object: 'pill' })), 'an object joins the accessible name');
check(/class="pill"/.test(ui.action('command', { mount: 'TST001-U04', label: 'Go', verb: 'OPEN', effect: 'none', surface: 'pill' })), 'the pill surface keeps a lab page\'s own look');
check(bare.action('command', { mount: 'TST001-U04', label: 'Go', verb: 'OPEN', effect: 'none' }).indexOf('>Go<') > 0, 'works on a bare page');

console.log('CMP057 Command: refusals');
const base = { mount: 'TST001-U04', label: 'Go', verb: 'OPEN', effect: 'none' };
check(refused(() => ui.action('command', Object.assign({}, base, { label: '' })), 'label'), 'no label is refused');
check(refused(() => ui.action('command', Object.assign({}, base, { verb: 'EXPLODE' })), 'verb'), 'a verb outside the closed list is refused');
check(refused(() => ui.action('command', Object.assign({}, base, { verb: undefined })), 'verb'), 'no verb is refused');
check(refused(() => ui.action('command', { mount: 'TST001-U04', label: 'Go', verb: 'OPEN' }), 'effect'), 'no declared effect is refused');
check(refused(() => ui.action('command', Object.assign({}, base, { display: 'icon' })), 'icon'), 'an icon is refused (a command shows its label)');
check(refused(() => ui.action('done', { mount: 'TST001-U04', label: 'Finish' }), 'fixed by the component'), 'a label on any other component is refused');
check(refused(() => ui.action('done', { mount: 'TST001-U04', verb: 'OPEN' }), 'fixed by the component'), 'a verb on any other component is refused');
check(refused(() => ui.action('command', Object.assign({}, base, { effect: 'commit' })), 'confirm'), 'a commit with no confirm is refused');

console.log('CMP057 Command: show-action and the press');
const greyed = ui.action('command', Object.assign({}, base, { role: { ok: false, why: 'Needs the owner' } }));
check(/aria-disabled="true"/.test(greyed) && greyed.includes('>Needs the owner<') && !/ disabled[ >]/.test(greyed), 'a refused command stays visible, aria-disabled, with its sentence');
ui.action('command', Object.assign({}, base, { onPress: () => pressed.push('plain') }));
listeners.click({ target: { closest: () => ({ getAttribute: (name) => ({ 'data-cbmount': 'TST001-U04', 'data-key': null, 'data-effect': null })[name] || null }) } });
check(pressed.indexOf('plain') >= 0 && runs.length === 0, 'a plain press runs the handler and does not go through CBAction');
ui.action('command', Object.assign({}, base, { key: 'w', effect: 'preference', onPress: () => pressed.push('write') }));
listeners.click({ target: { closest: () => ({ getAttribute: (name) => ({ 'data-cbmount': 'TST001-U04', 'data-key': 'w', 'data-effect': 'preference' })[name] || null }) } });
check(pressed.indexOf('write') >= 0 && runs.length === 1, 'a write goes through CBAction.run (busy, one press one write: M64)');

console.log('the converted usage');
const lab = read('product-lab.html');
check(/ui\.action\('command', \{ mount: 'PLB001-U01', label: 'Tick all shown', verb: 'TICK'/.test(lab) && !/<button[^>]*PLB001-B04/.test(lab), 'product-lab: Tick all shown is the library\'s command, not a hand-written button');
check(/ui\.select\(\{ mount: 'PLB001-U02', id: 'cat'/.test(lab) && !/<select[^>]*PLB001-S01/.test(lab), 'product-lab: the shelf filter is the library\'s select, not a hand-written <select>');
check(lab.indexOf('src="/app/ui-select.js"') > lab.indexOf('src="/app/ui.js"') && lab.indexOf('src="/app/ui-select.js"') > 0, 'ui-select.js is loaded after ui.js');

console.log(failures ? failures + ' FAILED' : 'all passed');
process.exit(failures ? 1 : 0);
