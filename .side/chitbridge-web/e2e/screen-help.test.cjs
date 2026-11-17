'use strict';
// @type: unit
/**
 * screen-help.test.cjs — CMP019, the screen's "?": dormant until a note exists for the screen's code (by design, Athi 10 Nov).
 *
 * Cases: with no note for the screen code no button is drawn; the moment a note exists for that code the "?" is drawn through the
 * standard action set (screenhelp) and shown; pressing it opens the note for that code; a screen without a note keeps it hidden.
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/screen-id
 * Run: node e2e/screen-help.test.cjs
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
let failures = 0;
const check = (condition, message) => { console.log((condition ? '  ok ' : '  FAIL ') + message); if (!condition) failures++; };

const notes = {}, shown = [], drawn = [];
const makeNode = () => {
  const node = { style: {}, attrs: {}, children: [], setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; }, querySelector: () => null, addEventListener() {} };
  let html = '';
  Object.defineProperty(node, 'innerHTML', { get: () => html, set(value) { html = value; node.firstChild = { style: {}, markup: value, parentNode: node }; } });
  return node;
};
const documentStub = { documentElement: makeNode(), head: makeNode(), getElementById: () => null, createElement: makeNode, addEventListener() {} };
const sandbox = {
  console, document: documentStub, location: { search: '', hash: '' }, navigator: {}, localStorage: { getItem: () => null, setItem() {} },
  esc: (text) => String(text), tx: (text) => text, addEventListener() {},
  hasHelp: (code) => !!notes[code], showHelp: (code) => shown.push(code),
  ui: { action: (name, options) => { drawn.push({ name, options }); return '<button data-cbname="' + name + '"></button>'; } }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'screen-id.js'), 'utf8'), sandbox);
const id = sandbox.CBScreenId;
const chip = id.chip();
const page = makeNode();
page.appendChild(chip);

id.here('accounts', 'todo');
const code = id.current();
check(code === 'BKS001', 'the To do screen of Accounts has the code BKS001');
check(drawn.length === 0 && page.children.length === 1, 'no note for BKS001: no "?" is drawn (dormant by design)');

notes[code] = { title: 'To do', body: 'a note' };
id.here('accounts', 'todo');
check(drawn.length === 1 && drawn[0].name === 'screenhelp', 'a note keyed by the screen code exists: the "?" is drawn through the standard action set (screenhelp)');
const button = page.children[1];
check(!!button && button.style.display === '', 'the "?" sits beside the chip and is shown');
drawn[0].options.onPress();
check(shown.length === 1 && shown[0] === code, 'pressing it opens the note of that code');

id.here('accounts', 'daybook');
check(button.style.display === 'none', 'another screen with no note hides the "?" again');

console.log(failures ? failures + ' FAILED' : 'all ok');
process.exit(failures ? 1 : 0);
