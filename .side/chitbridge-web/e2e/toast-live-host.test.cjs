'use strict';
// @type: unit
/**
 * toast-live-host.test.cjs — a page with no #toast (shop, know-your-business, authority-forms) still shows and announces a failure.
 *
 * Cases: toast() with an error on an empty page makes #toast at the end of the body; it carries role=alert / aria-live=assertive
 * and the words; an info message is role=status / aria-live=polite; a page's own #toast is reused, not doubled.
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/accounts-shell
 * Run: node e2e/toast-live-host.test.cjs
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const shell = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'accounts-shell.js'), 'utf8');
/** the source from startText to the first closing at column 0 (a function's brace, or a constant's semicolon) */
function topLevel(startText, closing) {
  const start = shell.indexOf(startText);
  return shell.slice(start, shell.indexOf(closing, start) + closing.length);
}
/** a minimal DOM: elements with attributes and innerHTML, and a body that keeps its children in order */
function makeElement(tag) {
  return { tag, attrs: {}, innerHTML: '', textContent: '', setAttribute(key, value) { this.attrs[key] = value; } };
}
function makeDocument() {
  const body = { children: [], appendChild(node) { this.children.push(node); } };
  return { body, createElement: makeElement, getElementById: (id) => body.children.find((node) => node.id === id) || null };
}
function load(documentStub) {
  const sandbox = { document: documentStub, esc: String, tx: String, setTimeout: () => 0, clearTimeout: () => {} };
  vm.createContext(sandbox);
  const source = topLevel('const TOAST_HOST_CSS', ";\n") + topLevel('function toastHost(', '\n}\n') +
    topLevel('function toast(', '\n}\n') + topLevel('function toastLevel(', '\n}\n');
  vm.runInContext(source + '\nthis.toast = toast;', sandbox);
  return sandbox;
}
let failed = 0;
const ok = (what, condition) => { console.log((condition ? '  ok   ' : '  FAIL ') + what); if (!condition) failed++; };

const page = makeDocument();
const { toast } = load(page);
toast("Couldn't save the form");
const host = page.body.children.find((node) => node.id === 'toast');
ok('a page with no #toast gets one', !!host);
ok('the host is at the end of the body', page.body.children[page.body.children.length - 1] === host);
ok('an error is a live alert (role=alert, aria-live=assertive)', host && host.attrs.role === 'alert' && host.attrs['aria-live'] === 'assertive');
ok('the words are inside it', host && host.innerHTML.includes("Couldn't save the form") && host.innerHTML.includes('class="toast err"'));
toast('Saved');
ok('an info message is a polite status (role=status, aria-live=polite)', host.attrs.role === 'status' && host.attrs['aria-live'] === 'polite');
ok('the second toast reuses the host (one #toast only)', page.body.children.filter((node) => node.id === 'toast').length === 1);

const own = makeDocument();
own.body.children.push(Object.assign(makeElement('div'), { id: 'toast' }));
load(own).toast('Done');
ok("a page's own #toast is used, not doubled, and made live", own.body.children.length === 1 && own.body.children[0].attrs['aria-live'] === 'polite');
process.exit(failed ? 1 : 0);
