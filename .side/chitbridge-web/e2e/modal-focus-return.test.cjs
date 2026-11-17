'use strict';
// @type: unit
/**
 * modal-focus-return.test.cjs - closing a dialog gives the keyboard back to the control that opened it (UX keyboard fixes, from stamps 6-12).
 *
 * OWNS      the proof that the real modal() and closeModal() of public/app.html (cut out by name, run against a fake page) remember the focused
 *           control when a dialog opens and focus it again when the dialog closes by the close button, by Escape (cbKeysEscape calls closeModal) or by the backdrop
 *           (modalBackdrop calls closeModal); that a dialog opened over another keeps the first opener; and that an opener the page has since
 *           repainted away is not focused (nothing to return to, no error). On origin/main nothing is remembered, so every focus-return case fails there.
 * CALLED BY by hand and the QA gate: node e2e/modal-focus-return.test.cjs
 * FLOW      cut the functions -> fake document -> open from a focused opener -> close three ways -> compare document.activeElement
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.html'), 'utf8').split('\r\n').join('\n');
let failures = 0;
const check = (ok, msg) => { console.log((ok ? '  ok ' : '  FAIL ') + msg); if (!ok) failures++; };

/** the source of one top-level function, from its `function name(` to the line before the next top-level function */
function cut(name) {
  const at = src.indexOf('\nfunction ' + name + '(');
  if (at < 0) return '';
  const next = src.indexOf('\nfunction ', at + 10);
  return src.slice(at, next < 0 ? undefined : next);
}
const code = ['rememberModalOpener', 'restoreModalOpener', 'modal', 'modalBackdrop', 'closeModal'].map(cut).join('\n');

/** a fake page: elements that can hold focus, a host whose innerHTML is the open dialog, and document.activeElement */
function page() {
  const doc = { activeElement: null, nodes: new Set() };
  const el = (name) => ({ name, focus() { doc.activeElement = this; }, contains(x) { return x === this || (this.inner && x && x.inDialog); } });
  const body = el('body'); doc.body = body;
  const host = { style: {}, _html: '', get innerHTML() { return this._html; }, set innerHTML(v) { this._html = v; if (v) doc.activeElement = Object.assign(el('close-in-dialog'), { inDialog: true }); else if (doc.activeElement && doc.activeElement.inDialog) doc.activeElement = body; }, contains(x) { return !!(x && x.inDialog); } };
  body.contains = (x) => doc.nodes.has(x) || x === body;
  doc.getElementById = (id) => (id === 'modalhost' ? host : null);
  doc.activeElement = body;
  const make = (name) => { const e = el(name); doc.nodes.add(e); return e; };
  return { doc, host, make, body };
}
function run(p, steps) {
  const ctx = { document: p.doc, UI: {}, mvModal() {}, modalStamp() {}, ccCartRelease() {}, minimiseCompose() {}, console };
  vm.createContext(ctx);
  vm.runInContext(code + '\n;this.modal = modal; this.closeModal = closeModal; this.modalBackdrop = modalBackdrop;', ctx);
  steps(ctx);
}

/* 1 · close button and Escape both land in closeModal: focus returns to the opener */
let p = page(); let opener = p.make('Open button'); opener.focus();
run(p, (c) => { c.modal('<p>x</p>'); check(p.doc.activeElement !== opener, 'while the dialog is open the keyboard is in the dialog'); c.closeModal(); });
check(p.doc.activeElement === opener, 'closing returns focus to the control that opened the dialog');

/* 2 · the backdrop */
p = page(); opener = p.make('Row action'); opener.focus();
run(p, (c) => { c.modal('<p>x</p>'); c.modalBackdrop(); });
check(p.doc.activeElement === opener, 'a backdrop click returns focus to the opener too');

/* 3 · a second dialog over the first keeps the FIRST opener */
p = page(); opener = p.make('Start button'); opener.focus();
run(p, (c) => { c.modal('<p>one</p>'); c.modal('<p>two, a confirm over it</p>'); c.closeModal(); });
check(p.doc.activeElement === opener, 'a dialog opened over a dialog still returns to the first opener');

/* 4 · an opener the page repainted away: no error, nothing focused */
p = page(); opener = p.make('Repainted'); opener.focus();
run(p, (c) => { c.modal('<p>x</p>'); p.doc.nodes.delete(opener); c.closeModal(); });
check(p.doc.activeElement !== opener, 'an opener that left the page is not focused');

/* 5 · nothing focused when it opened (body): close leaves focus alone */
p = page();
run(p, (c) => { c.modal('<p>x</p>'); c.closeModal(); });
check(p.doc.activeElement === p.body, 'opened with nothing focused: nothing is forced on close');

/* 6 · the real Escape path still ends in closeModal */
check(/function cbKeysEscape[\s\S]*?closeModal\(\)/.test(src), 'cbKeysEscape closes through closeModal (so Escape returns focus too)');
/* 7 · renderApp rebuilds the shell with an empty #modalhost: the remembered opener is stale and must go with the dialog */
const at = src.indexOf('\nfunction _renderApp() {');
const renderBody = at < 0 ? '' : src.slice(at, src.indexOf('\nfunction ', at + 10));
const resetsOpener = renderBody.indexOf('UI._modalOpener = null') > 0;
check(resetsOpener, '_renderApp (the shell rebuild that every renderApp ends in) clears the remembered opener when it rebuilds #modalhost');
p = page(); opener = p.make('Old opener'); const later = p.make('Where focus is now'); opener.focus();
run(p, (c) => {
  c.modal('<p>x</p>');
  p.host.innerHTML = ''; /* renderApp wipes the dialog without closeModal */
  if (resetsOpener) c.UI._modalOpener = null; /* and, in the real code, forgets the opener on the same line */
  later.focus(); c.closeModal();
});
check(p.doc.activeElement === later, 'a later closeModal does not pull focus back to a stale opener');
console.log(failures ? failures + ' FAILED' : 'ALL PASS');
process.exit(failures ? 1 : 0);
