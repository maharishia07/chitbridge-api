'use strict';
// @type: unit
/**
 * ui-action-set.test.cjs — UX-137 lever 0: the standard action set (public/app/ui.js, CMP001..CMP010).
 *
 * Cases: every component draws one native button carrying its element code and its mount; a refused property, an unknown
 * component, a bad mount, a Save with no declared effect, and a commit with no confirm are refused (thrown); a role gate greys
 * WITH its sentence; the two mounted policy buttons and the print Save draw the same classes, id, testid and data-pol-act the
 * hand-written strings drew; a registered commit press goes through CBAction.run with its confirm and a plain press does not.
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 * Run: node e2e/ui-action-set.test.cjs
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');
let failures = 0;
const check = (condition, message) => { console.log((condition ? '  ok ' : '  FAIL ') + message); if (!condition) failures++; };
const refused = (call) => { try { call(); return false; } catch (error) { return /ui\.action|ui\.dialog/.test(error.message); } };

const pressed = [], runs = [], opened = [];
const listeners = {};
let panelOnScreen = true; /* the progress panel is in the page while true */
const panelRoot = { focus() {}, querySelector: () => ({ hidden: false, style: {}, firstChild: { style: {} } }), closest: () => null, innerHTML: '' };
const sandbox = {
  console,
  tx: (text) => text,
  esc: (text) => String(text).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])),
  CBAction: { run: (button, fn, options) => { runs.push(options); return Promise.resolve(fn()); } },
  window: {},
  document: { addEventListener: (name, fn) => { listeners[name] = fn; }, querySelectorAll: () => [], querySelector: (selector) => (panelOnScreen && /data-cbprogress/.test(selector) ? panelRoot : null) },
  setTimeout, clearTimeout,
  modal: (html) => { opened.push(html); }, closeModal: () => { opened.push('closed'); },
};
vm.createContext(sandbox);
sandbox.window = sandbox;
vm.runInContext(read('app/ui.js'), sandbox);
const ui = sandbox.ui;

console.log('the set');
const names = Object.keys(ui.components).filter((name) => name !== 'dialog' && !ui.components[name].nonButton && !ui.components[name].own); /* CMP057 takes its own label and verb: e2e/ui-select-command.test.cjs */
check(names.length === 24, 'twenty-four actions: ' + names.join(' '));
const codes = Object.values(ui.components).map((component) => component.code);
check(new Set(codes).size === codes.length && codes.every((code) => /^CMP\d{3}$/.test(code)), 'twenty-four distinct CMP codes (twenty-four actions and the dialog)');
const forced = { home: { href: '/' }, save: { effect: 'preference' }, remove: { confirmedBy: 'page' }, delete: { confirmedBy: 'page' } };
const unmatched = ui.choice({ mount: 'TST001-U01', label: 'Status', value: 'none', items: [{ value: 'a', label: 'Open' }, { value: 'b', label: 'Away' }] });
check((unmatched.match(/tabindex="0"/g) || []).length === 1, 'a choice with no matching value still has one tab stop (the first segment)');
const phone = ui.choice({ mount: 'TST001-U01', label: 'Status', value: 'b', items: [{ value: 'a', label: '🟢 Open' }, { value: 'b', label: '🌙 Away' }] });
check(/data-choice-trigger[^>]*aria-haspopup="listbox"/.test(phone) && phone.includes('class="cbui-cur">🌙 Away</span>') && /role="listbox"[^>]*hidden/.test(phone), 'the phone mode is one button showing the current value as icon and word, opening a listbox');
check(!/aria-label="Open"/.test(phone), 'no value is drawn as a glyph alone');
check(/title="Explain"/.test(ui.action('help', { mount: 'TST001-U01', hint: 'Explain' })), 'a hint is the hover text of a component');
names.forEach((name) => {
  const html = ui.action(name, Object.assign({ mount: 'TST001-U01' }, forced[name] || {}));
  check(/^<(button|a) /.test(html) && (ui.components[name].link || html.includes('type="button"')) && html.includes('data-cbsid="' + ui.components[name].code + '-B01"') && html.includes('data-cbmount="TST001-U01"'), name + ': one native button (a link for Home) with element code and mount');
});

console.log('born accessible (axe label-title-only / button-name cannot return through a component)');
names.forEach((name) => {
  const html = ui.action(name, Object.assign({ mount: 'TST001-U01' }, forced[name] || {}));
  const text = html.replace(/<[^>]*>/g, '').trim();
  const named = ui.components[name].nameOnly ? /aria-label="[^"]+"/.test(html) : text.length > 0;
  check(text.length > 0 && named, name + ': a visible text and an accessible name, no title-only');
});
check(/aria-haspopup="menu"/.test(ui.action('more', { mount: 'TST001-U01' })) && /aria-expanded="false"/.test(ui.action('more', { mount: 'TST001-U01' })), 'More says it opens a menu and whether it is open');
check(refused(() => ui.action('delete', { mount: 'TST001-U01' })), 'Delete with no confirm refused (it is always a commit)');
check(refused(() => ui.action('delete', { mount: 'TST001-U01', effect: 'preference', confirmedBy: 'page' })), 'the fixed effect of Delete cannot be overridden');
check(refused(() => ui.action('done', { mount: 'TST001-U01', surface: 'nope' })), 'an unknown surface refused');
console.log('icons and tap size are properties of the component (Athi 10 Nov)');
['close', 'search', 'add', 'more', 'back', 'edit', 'help'].forEach((name) => {
  const html = ui.action(name, { mount: 'TST001-U01', display: 'icon' });
  check(/aria-label="[^"]+"/.test(html) && / title="[^"]+"/.test(html), name + ': icon alone is allowed, with an aria-label and a tooltip');
});
['save', 'cancel', 'done', 'remove', 'delete', 'reload', 'open', 'clear', 'notnow', 'info'].forEach((name) => {
  check(refused(() => ui.action(name, { mount: 'TST001-U01', display: 'icon', effect: name === 'save' ? 'preference' : undefined, confirmedBy: 'page' })), name + ': icon alone refused (icon and label)');
});
check(/><span aria-hidden="true">✓<[/]span> Done</.test(ui.action('done', { mount: 'TST001-U01', display: 'icon+label' })), 'icon+label draws the one icon (hidden from screen readers) and the label');
['search', 'delete', 'notnow'].forEach((name) => {
  const html = ui.action(name, Object.assign({ mount: 'TST001-U01', display: 'icon+label' }, name === 'delete' ? { effect: 'commit', confirmedBy: 'page' } : {}));
  check(/<span aria-hidden="true"><svg [^>]*width="1em" height="1em"[^>]*stroke="currentColor"/.test(html) && !/[⌕⏳🗑]/.test(html), name + ': drawn as inline SVG in currentColor, sized in em, no font glyph');
});
check(/data-size="compact"/.test(ui.action('edit', { mount: 'TST001-U01', size: 'compact' })) && !/data-size/.test(ui.action('edit', { mount: 'TST001-U01' })), 'compact is a property; standard is the default and writes nothing');
check(refused(() => ui.action('edit', { mount: 'TST001-U01', size: 'tiny' })), 'a size outside standard and compact refused');
console.log('refusals (silence is the bug)');
check(refused(() => ui.action('nope', { mount: 'TST001-U01' })), 'unknown component refused');
check(refused(() => ui.action('done', { mount: 'TST001-U01', colour: 'red' })), 'a property outside the schema refused');
check(refused(() => ui.action('done', { mount: 'tst-1' })), 'a bad mount code refused');
check(refused(() => ui.action('save', { mount: 'TST001-U01' })), 'Save with no declared effect refused');
check(refused(() => ui.action('save', { mount: 'TST001-U01', effect: 'commit' })), 'a commit with no confirm refused');
check(refused(() => ui.action('remove', { mount: 'TST001-U01' })), 'Remove with no confirm refused (it is always a commit)');
check(refused(() => ui.action('remove', { mount: 'TST001-U01', effect: 'preference', confirmedBy: 'page' })), 'the fixed effect of Remove cannot be overridden');
check(!refused(() => ui.action('save', { mount: 'TST001-U01', effect: 'commit', confirm: { title: 'Pay', body: 'A$ 10', yes: 'Pay' } })), 'a commit with its confirm is accepted');

console.log('the markup of the mounted pages is unchanged');
const policySave = ui.action('save', { mount: 'ACC002-U01', object: 'policy value', hidden: true, effect: 'commit', confirmedBy: 'page', id: 'sx_pol_save_k', testid: 'sx-pol-save-k', data: { 'pol-act': 'save' } });
check(policySave.includes('class="act"') && policySave.includes('style="display:none"') && policySave.includes('id="sx_pol_save_k"') && policySave.includes('data-testid="sx-pol-save-k"') && policySave.includes('data-pol-act="save"') && policySave.endsWith('>Save</button>'), 'policy Save: class act, hidden, id, testid, data-pol-act, visible text Save');
const policyCancel = ui.action('cancel', { mount: 'ACC002-U02', object: 'policy edit', hidden: true, id: 'c', testid: 'c', data: { 'pol-act': 'cancel' } });
check(policyCancel.includes('class="act ghost"') && policyCancel.endsWith('>Cancel</button>'), 'policy Cancel: class act ghost, visible text Cancel');
const printSave = ui.action('save', { mount: 'ACC002-U03', object: 'print layout', effect: 'preference', id: 'pr-save', testid: 'pr-save' });
check(printSave.includes('class="act"') && !printSave.includes('display:none') && printSave.includes('aria-label="Save print layout"'), 'print Save: class act, shown, named "Save print layout"');
check(ui.action('close', { mount: 'TST001-U01' }).includes('aria-label="Close"'), 'the icon-only Close always has its accessible name');

console.log('role gate and busy');
const gated = ui.action('add', { mount: 'TST001-U01', object: 'counter', role: { ok: false, why: 'Only the owner may add counters' } });
check(!/ disabled[ >=]/.test(gated) && gated.includes('aria-disabled="true"') && gated.includes('title="Only the owner may add counters"'), 'a refused action stays visible, greyed, with its sentence (aria-disabled, no native disabled: it stays in the Tab order)');
const whyOf = (html) => { const id = (html.match(/aria-describedby="([^"]+)"/) || [])[1]; return id && new RegExp('<span id="' + id + '" class="cbui-sr">([^<]*)</span>').exec(html); };
check(whyOf(gated) && whyOf(gated)[1] === 'Only the owner may add counters', 'role {ok:false}: aria-describedby resolves to a hidden element holding the reason');
const stateOff = ui.action('save', { mount: 'TST001-U02', effect: 'preference', disabled: 'Needs the owner' });
check(!/ disabled[ >=]/.test(stateOff) && stateOff.includes('aria-disabled="true"') && stateOff.includes('data-disabled="1"') && whyOf(stateOff) && whyOf(stateOff)[1] === 'Needs the owner', "disabled: 'Needs the owner' draws aria-disabled, data-disabled and a describedby that resolves, and no native disabled");
check(!/tabindex="-1"/.test(stateOff), 'a disabled action has no tabindex -1: it stays in the Tab order');
check(refused(() => ui.action('save', { mount: 'TST001-U02', effect: 'preference', disabled: true })) && refused(() => ui.action('save', { mount: 'TST001-U02', effect: 'preference', disabled: ' ' })), 'disabled: true (or an empty sentence) is refused: a greyed action says why');
check(ui.action('save', { mount: 'TST001-U02', effect: 'preference', disabled: false }).indexOf('aria-disabled') < 0, 'disabled: false draws an ordinary enabled button');
const hinted = ui.action('save', { mount: 'TST001-U03', effect: 'preference', hint: 'Saves the policy', disabled: 'Needs the owner' });
check((hinted.match(/ title=/g) || []).length === 1 && hinted.includes('title="Needs the owner"') && !hinted.includes('Saves the policy') && whyOf(hinted)[1] === 'Needs the owner', 'hint + disabled: ONE title attribute and it is the reason; the hidden text is the reason');
const rowA = ui.action('save', { mount: 'TST001-U04', effect: 'preference', disabled: 'Needs the owner' }), rowB = ui.action('save', { mount: 'TST001-U04', effect: 'preference', disabled: 'Needs the owner' });
check(rowA.match(/aria-describedby="([^"]+)"/)[1] !== rowB.match(/aria-describedby="([^"]+)"/)[1], 'two disabled rows on one mount without a key get different reason ids');
const both = ui.action('save', { mount: 'TST001-U02', effect: 'preference', disabled: 'Busy now', role: { ok: false, why: 'Only the owner may save' } });
check(whyOf(both)[1] === 'Only the owner may save', 'role and disabled together: the permission sentence wins');
check(/class="cbui-sr"/.test(read('app/ui.js')) && /\[data-cbname\]\[aria-disabled="true"\]\{[^}]*cursor:not-allowed/.test(read('app/ui.js')), 'the stylesheet mutes [aria-disabled] and hides the reason visually only');
{
  const calls = [];
  ui.action('save', { mount: 'TST004-U01', effect: 'preference', disabled: 'Needs the owner', onPress: () => pressed.push('disabled-ran') });
  const attrs = { 'data-cbmount': 'TST004-U01', 'aria-disabled': 'true', title: 'Needs the owner' };
  const btn = { disabled: false, getAttribute: (n) => attrs[n] || null, closest: () => btn };
  const before = pressed.length;
  listeners.click({ target: btn, preventDefault: () => calls.push('prevent'), stopPropagation: () => calls.push('stop') });
  check(pressed.length === before && calls.join() === 'prevent,stop', 'a press on a disabled action does not call onPress, and stops the default and the bubble');
  const sub = [];
  listeners.submit({ submitter: btn, preventDefault: () => sub.push('prevent') });
  listeners.submit({ submitter: { getAttribute: () => null }, preventDefault: () => sub.push('wrong') });
  check(sub.join() === 'prevent', 'a form submit by a disabled submitter is cancelled; an enabled submitter is left alone');
}
check(ui.action('done', { mount: 'TST001-U01', busy: true }).includes('aria-busy="true"'), 'busy is aria-busy');

console.log('the one press path');
function click(code, effect) {
  const attributes = { 'data-cbmount': code, 'data-effect': effect || null };
  const button = { disabled: false, getAttribute: (name) => attributes[name] || null, closest: () => button };
  return () => listeners.click({ target: button });
}
ui.action('save', { mount: 'TST002-U01', effect: 'commit', confirm: { title: 'Post', body: 'x', yes: 'Post' }, onPress: () => pressed.push('commit') });
click('TST002-U01', 'commit')();
check(pressed.length === 1 && runs.length === 1 && runs[0].confirm && runs[0].confirm.title === 'Post', 'a commit press runs through CBAction.run with its confirm');
ui.action('open', { mount: 'TST002-U02', onPress: () => pressed.push('plain') });
runs.length = 0;
click('TST002-U02')();
check(pressed.length === 2 && runs.length === 0, 'a plain press does not go through CBAction (no Done toast)');

console.log('CMP020 progress (three levels), CMP021 bar, CMP022 spinner');
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
check(['progress', 'progressbar', 'spinner'].every((name) => ui.components[name] && ui.components[name].nonButton && ui.components[name].verb === 'OPEN') && ui.components.progress.code === 'CMP020' && ui.components.progressbar.code === 'CMP021' && ui.components.spinner.code === 'CMP022', 'CMP020, CMP021, CMP022 are registered, none is a button, the verb is OPEN');
check(refused(() => ui.action('progress', { mount: 'TST003-U01' })), 'ui.action refuses the progress parts (they are not buttons)');
const bar = ui.progress.bar({ max: 4, now: 1, label: 'Import' });
check(/role="progressbar"/.test(bar) && /aria-valuemin="0"/.test(bar) && /aria-valuemax="4"/.test(bar) && /aria-valuenow="1"/.test(bar) && /width:25%/.test(bar), 'the bar is a role=progressbar with aria-valuenow, min and max');
check(!/aria-valuenow/.test(ui.progress.bar({ max: 0, now: 0, label: 'Import' })) && /data-indeterminate/.test(ui.progress.bar({ max: 0, now: 0, label: 'Import' })), 'an unknown length is indeterminate, with no false value');
check(/aria-hidden="true"/.test(ui.progress.spinner()), 'the spinner is decorative (the words carry the meaning)');
check(refused(() => ui.progress.start({ mount: 'bad' })) || (() => { try { ui.progress.start({ mount: 'bad' }); return false; } catch (error) { return /progress: mount/.test(error.message); } })(), 'a progress panel needs a mount code');
check((() => { try { ui.progress.start({ mount: 'TST003-D01-U01', steps: 2, total: 5 }); return false; } catch (error) { return /steps or total/.test(error.message); } })(), 'steps and total together are refused');
(async () => {
  const quick = ui.progress.start({ mount: 'TST003-D01-U01', steps: 4, line: 'Reading', delay: 50 });
  quick.done();
  await wait(90);
  check(opened.length === 0, 'level 1: finished inside the delay, nothing was ever shown');
  const job = ui.progress.start({ mount: 'TST003-D01-U02', steps: 4, line: 'Reading the file', delay: 0 });
  await wait(20);
  const html = opened.join('');
  check(/role="status" aria-live="polite"/.test(html) && /role="progressbar"/.test(html) && />Step 0 of 4</.test(html) && /Reading the file/.test(html), 'level 3: the panel has a polite status region, the bar, "Step n of m" and one plain line');
  check(!/data-cbname="cancel"/.test(html), 'no Cancel unless the caller gives a safe cancel');
  job.done();
  check(opened[opened.length - 1] === 'closed', 'done() closes the panel');
  opened.length = 0;
  const gone = ui.progress.start({ mount: 'TST003-D01-U04', steps: 2, delay: 0 });
  await wait(20);
  opened.length = 0;
  panelOnScreen = false; /* the person already closed it, another modal may be open */
  gone.done();
  check(opened.indexOf('closed') < 0, 'done() after the panel is gone closes no other modal');
  panelOnScreen = true;
  opened.length = 0;
  const cancellable = ui.progress.start({ mount: 'TST003-D01-U03', total: 100, delay: 0, cancel: () => {} });
  await wait(20);
  check(/data-cbname="cancel"/.test(opened.join('')) && />0 of 100</.test(opened.join('')), 'Cancel appears when a cancel is given; a total reads "n of total"');
  cancellable.done();
  const button = { attrs: {}, disabled: false, innerHTML: 'Save', getAttribute(name) { return this.attrs[name] || null; }, setAttribute(name, value) { this.attrs[name] = value; }, removeAttribute(name) { delete this.attrs[name]; } };
  const busy = ui.progress.inline(button, 'Saving…', 30);
  check(button.disabled && button.attrs['aria-busy'] === 'true' && button.innerHTML === 'Save', 'level 2: disabled and aria-busy at once (no second press), look unchanged inside the delay');
  await wait(60);
  check(/cbp-spin/.test(button.innerHTML) && /Saving…/.test(button.innerHTML), 'level 2: after the delay the button shows the spinner and its words');
  busy.stop();
  check(button.innerHTML === 'Save' && !button.disabled && !button.attrs['aria-busy'], 'level 2: stop() restores the button');
  let focused = 0;
  button.focus = () => { focused++; };
  sandbox.document.activeElement = button;
  const busy2 = ui.progress.inline(button, 'Saving…', 30);
  busy2.stop();
  check(focused === 1, 'level 2: focus is given back to the button after a busy stop (native disabled had dropped it)');
  sandbox.document.activeElement = null;
  const busy3 = ui.progress.inline(button, 'Saving…', 30);
  busy3.stop();
  check(focused === 1, 'level 2: a button that did not hold focus is not pulled into focus');
  if (failures) { console.log(failures + ' FAILED'); process.exit(1); }
  console.log('all passed');
})();
