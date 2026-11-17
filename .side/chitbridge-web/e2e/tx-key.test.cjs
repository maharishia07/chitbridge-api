'use strict';
// @type: unit
/**
 * tx-key.test.cjs — UX-137: tx(english, { key }) finds a translation by its STABLE KEY; English is the default and the fallback.
 *
 * Cases: the keyed entry wins; a missing key falls back to the English entry (no translation lost); rewording the English leaves the
 * keyed translation alone; a gettext context string still works; the pseudo-locale (which answers every name) is not fooled into
 * returning a pseudo-key; txf puts values into the keyed pattern.
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/strings-and-translations
 * Run: node e2e/tx-key.test.cjs
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const shell = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'accounts-shell.js'), 'utf8');
/** one top-level function's source: from its `function name(` line to the first closing brace at column 0 */
function functionSource(name) {
  const start = shell.indexOf('\nfunction ' + name + '(') + 1;
  return shell.slice(start, shell.indexOf('\n}\n', start) + 3);
}
let language = 'hi';
const sandbox = {
  CBSTR: {
    hi: { Save: 'पुराना', 'CMP001.label': 'सहेजें', 'CMP001.aria': 'सहेजें {object}', 'status\u0004Open': 'खुला' },
    qps: new Proxy({}, { get: (target, key) => (typeof key === 'string' ? '[!! ' + key + ' !!]' : undefined), has: () => true })
  },
  cbLang: () => language,
  bidiWrap: (value) => String(value)
};
vm.createContext(sandbox);
vm.runInContext(functionSource('tx') + functionSource('txf'), sandbox);
const { tx, txf } = sandbox;
let failed = 0;
const ok = (what, condition) => { console.log((condition ? '  ok   ' : '  FAIL ') + what); if (!condition) failed++; };

ok('the keyed entry wins over the English entry', tx('Save', { key: 'CMP001.label' }) === 'सहेजें');
ok('rewording the English leaves the keyed translation alone', tx('Save changes', { key: 'CMP001.label' }) === 'सहेजें');
ok('a key with no entry falls back to the English entry (no translation lost)', tx('Save', { key: 'CMP999.label' }) === 'पुराना');
ok('a key and a word with no entry anywhere shows the English', tx('Hello', { key: 'CMP999.label' }) === 'Hello');
ok('a gettext context string still works', tx('Open', 'status') === 'खुला');
ok('a key and a gettext context together', tx('Open', { key: 'CMP999.label', context: 'status' }) === 'खुला');
ok('txf puts the value into the keyed pattern', txf('Save {object}', { object: 'policy' }, { key: 'CMP001.aria' }) === 'सहेजें policy');
language = 'qps';
ok('the pseudo-locale returns the pseudo of the ENGLISH, never of the key', tx('Save', { key: 'CMP001.label' }) === '[!! Save !!]');
language = 'en';
ok('English (no pack) returns the English default', tx('Save', { key: 'CMP001.label' }) === 'Save');
console.log(failed ? failed + ' failed' : 'all passed');
process.exit(failed ? 1 : 0);
