'use strict';
// @type: unit
/**
 * ui-component-keys.cjs — UX-137: the visible text of a standard component is a KEY, English is only the default.
 *
 * RULE (Athi 8 Nov: "can the component text be a variable rather than a value, so a language change can adopt quickly?"):
 * every text a component draws (label, shown, aria) reaches tx()/txf() with its stable key CMP###.label / .shown / .aria, tied to
 * the register's component code, never to the English words. Rewording English then never breaks a translation.
 * The guard fails when (1) a component's text is drawn without its key (a raw value), (2) a key is missing from a language pack,
 * (3) an aria pattern lost its {object} placeholder, or (4) a ui.action / ui.dialog call passes a text of its own instead of a mount.
 * It proves itself: a copy of ui.js with one key removed must FAIL.
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/ui-action-set
 * Run: node e2e/ui-component-keys.cjs
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const publicDir = path.join(__dirname, '..', 'public');
const LANGS = ['ar', 'fr', 'hi', 'ta'];
const KEY_MARK = (key) => '«' + key + '»';

/** the catalogue stand-in: a keyed text comes back as its key in guillemets, so a text that did NOT go through its key stays plain English */
function loadLibrary(source) {
  const sandbox = {
    console,
    tx: (english, context) => (context && context.key ? KEY_MARK(context.key) : english),
    txf: (english, values, context) => (context && context.key ? KEY_MARK(context.key) : english),
    esc: (text) => String(text),
    CBAction: { run: () => Promise.resolve() },
    document: { addEventListener: () => {} },
    window: {}
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.window.ui;
}
const textOf = (html) => html.slice(html.indexOf('>') + 1, html.lastIndexOf('</'));
const ariaOf = (html) => (html.match(/aria-label="([^"]*)"/) || [])[1] || null;
const OPTIONS_FOR = { home: { href: '/' }, save: { effect: 'preference' }, remove: { confirmedBy: 'page' }, delete: { confirmedBy: 'page' } };

/** every failure of one copy of ui.js, as sentences */
function keyFailures(source) {
  const failures = [];
  const library = loadLibrary(source);
  Object.keys(library.components).filter((name) => name !== 'dialog' && !library.components[name].nonButton && !library.components[name].own).forEach((name) => {
    const component = library.components[name];
    const plain = library.action(name, Object.assign({ mount: 'TST001-U01' }, OPTIONS_FOR[name] || {}));
    const named = library.action(name, Object.assign({ mount: 'TST001-U01', object: 'thing' }, OPTIONS_FOR[name] || {}));
    if (/\w/.test(component.shown) && textOf(plain) !== KEY_MARK(component.code + '.shown')) failures.push(name + ': the visible text is a raw value, not the key ' + component.code + '.shown');
    if (!/\w/.test(component.shown) && ariaOf(plain) !== KEY_MARK(component.code + '.label')) failures.push(name + ': the icon-only name is a raw value, not the key ' + component.code + '.label');
    if (ariaOf(named) !== KEY_MARK(component.code + '.aria')) failures.push(name + ': the accessible name is a raw value, not the key ' + component.code + '.aria');
  });
  return failures;
}
/** every key of the library in every language pack, with the {object} placeholder on the aria patterns */
function packFailures(library) {
  const failures = [];
  const keys = [];
  Object.keys(library.components).forEach((name) => {
    const component = library.components[name];
    keys.push(component.code + '.label');
    if (component.shown && /\w/.test(component.shown)) keys.push(component.code + '.shown');
    if (name !== 'dialog' && !component.nonButton && !component.own) keys.push(component.code + '.aria'); /* CMP057 names itself from its own label */
    if (name === 'progress') ['working', 'step', 'count', 'finished', 'failed'].forEach((part) => keys.push(component.code + '.' + part));
  });
  LANGS.forEach((lang) => {
    const maps = { [lang]: {} };
    new Function('CBSTR', 'renderApp', fs.readFileSync(path.join(publicDir, 'app', 'strings-' + lang + '.js'), 'utf8'))(maps, () => {});
    keys.forEach((key) => {
      const value = maps[lang][key];
      if (!value) failures.push(lang + ' has no entry for ' + key);
      else if (/\.aria$/.test(key) && value.indexOf('{object}') < 0) failures.push(lang + ' ' + key + ' lost its {object} placeholder');
    });
  });
  return failures;
}
/** a call site that hands the factory a text of its own (label, text, title as an option) instead of a mount */
function callSiteFailures() {
  const failures = [];
  const files = fs.readdirSync(path.join(publicDir, 'app')).filter((file) => /\.js$/.test(file) && file !== 'ui.js').map((file) => 'app/' + file)
    .concat(fs.readdirSync(publicDir).filter((file) => /\.html$/.test(file)));
  const rawTextOption = /\bui\.action\(\s*'(?!command')[a-z]+'\s*,\s*\{[^}]*\b(?:label|text|title|shown)\s*:/;
  files.forEach((file) => {
    if (rawTextOption.test(fs.readFileSync(path.join(publicDir, file), 'utf8'))) failures.push(file + ': ui.action is given a text of its own; a component draws its keyed text');
  });
  return failures;
}

const source = fs.readFileSync(path.join(publicDir, 'app', 'ui.js'), 'utf8');
let failed = 0;
const ok = (what, condition) => { console.log((condition ? '  ok   ' : '  FAIL ') + what); if (!condition) failed++; };
const real = keyFailures(source).concat(packFailures(loadLibrary(source))).concat(callSiteFailures());
real.forEach((line) => console.log('       ' + line));
ok('every component text is keyed, every key is in ar fr hi ta, no call site brings its own text', real.length === 0);
const unkeyed = source.replace("words(component.shown, textKey(component, 'shown'))", 'words(component.shown)');
ok('self-test: a ui.js whose visible text lost its key FAILS the guard', unkeyed !== source && keyFailures(unkeyed).length > 0);
const unaria = source.replace("textKey(component, 'aria')", "'raw'");
ok('self-test: a ui.js whose accessible name lost its key FAILS the guard', unaria !== source && keyFailures(unaria).length > 0);
console.log(failed ? failed + ' failed' : 'all passed');
process.exit(failed ? 1 : 0);
