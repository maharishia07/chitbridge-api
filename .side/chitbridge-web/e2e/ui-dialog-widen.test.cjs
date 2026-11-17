'use strict';
// @type: unit
/**
 * ui-dialog-widen.test.cjs - the library popup (ui.dialog, CMP002) carries what the CRM popups need (UX-137 popups, web-popups-1).
 *
 * OWNS      the proof that ui.dialog writes the popup's register code on the header (data-pop) and as the quote-me chip, refuses a code that is not POP and
 *           three digits, draws the second line (subText, subId) and the footer id (footId), keeps a caller footer (footerHtml) and refuses actions and footerHtml
 *           together, puts the test id on the body, takes an already-translated title (titleText, escaped), and moves focus to the first field.
 * CALLED BY by hand and the QA gate: node e2e/ui-dialog-widen.test.cjs
 * FLOW      load public/app/ui.js into a fake page -> call ui.dialog -> read the HTML handed to modal() and the element that took focus
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
let failures = 0;
const check = (ok, msg) => { console.log((ok ? '  ok ' : '  FAIL ') + msg); if (!ok) failures++; };
const opened = []; let focused = null;
const field = { focus() { focused = 'first-field'; } };
const sandbox = {
  console, tx: (t) => t, esc: (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])), window: {}, setTimeout, clearTimeout,
  CBScreenId: { popupChip: (code) => '<span data-testid="popup-code">' + code + '</span>' },
  document: { addEventListener() {}, querySelectorAll: () => [], getElementById: () => null, querySelector: (s) => (/\.mbody/.test(s) ? { querySelector: () => field } : null), head: null },
  modal: (html, wide) => { opened.push({ html, wide }); }, closeModal() {}
};
vm.createContext(sandbox); sandbox.window = sandbox;
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'ui.js'), 'utf8'), sandbox);
const ui = sandbox.ui;
const refused = (fn) => { try { fn(); return false; } catch (e) { return /ui\.action: dialog/.test(e.message); } };

ui.dialog({ mount: 'CRM004-U201', pop: 'POP100', title: 'Add lead', subText: '3 members', subId: 'sub_x', footId: 'foot_x', testid: 'lead-sheet', body: '<p>hi</p>',
  actions: [{ name: 'cancel', options: { mount: 'CRM004-U201' } }, { name: 'save', options: { mount: 'CRM004-U201', key: 'save', effect: 'preference', testid: 'lead-save', data: { crm: 'leadsave' } } }] });
const html = opened[0].html;
check(/class="mhd" data-cbsid="CMP002-D01" data-cbmount="CRM004-U201" data-pop="POP100"/.test(html), 'the header is the library one and wears its register code');
check(/data-testid="popup-code">POP100</.test(html), 'the quote-me chip shows the code');
check(/<span class="sub" id="sub_x">3 members<\/span>/.test(html), 'the second line has its text and id');
check(/<div class="mbody" data-testid="lead-sheet"><p>hi<\/p><\/div>/.test(html), 'the body carries the test id');
check(/<div class="mfoot" id="foot_x">/.test(html) && /data-testid="lead-save"[^>]*|data-crm="leadsave"/.test(html), 'the footer has its id and the save keeps its test id and data-crm');
check(/data-cbsid="CMP003-B01"/.test(html) && /data-cbsid="CMP001-B01"/.test(html), 'Cancel and Save are the standard components');
check(focused === 'first-field', 'focus moves to the first field');

ui.dialog({ mount: 'CRM008-U201', titleText: 'Send to <Regulars>', footerHtml: '<button>Own</button>', body: '' });
check(/<div class="t">Send to &lt;Regulars&gt;<\/div>/.test(opened[1].html) && /<div class="mfoot"><button>Own<\/button><\/div>/.test(opened[1].html), 'titleText is escaped, footerHtml is kept as given');
check(!/data-pop/.test(opened[1].html), 'no code named: nothing is written');
check(refused(() => ui.dialog({ mount: 'CRM008-U201', pop: 'POP98', title: 'x' })), 'a code that is not POP and three digits is refused');
check(refused(() => ui.dialog({ mount: 'CRM008-U201', title: 'x', footerHtml: '', actions: [{ name: 'cancel', options: { mount: 'CRM008-U201' } }] })), 'actions and footerHtml together are refused');
console.log(failures ? 'FAILED ' + failures : 'all passed');
process.exit(failures ? 1 : 0);
