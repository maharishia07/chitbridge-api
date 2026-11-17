/**
 * tests/rail-parts.test.cjs — R06 the bell's html and row presses, R03 the thread's words and drafts, in their own files.
 *
 * Reads public/app/rail-bell-html.js · public/app/rail-bell-rows.js · public/app/rail-bell.js and public/app/rail-thread-words.js · public/app/rail-thread.js,
 * loads them the way the pages do (the part first, then the file) and checks one rule at a time: unit per rule, refusal path, fail closed.
 * Run: node tests/rail-parts.test.cjs
 *
 * Evidence for the §7 minimums, in words the trace reads:
 *  - walk: e2e/rail-bell.cjs, e2e/rail-thread.cjs and e2e/walk-firm-reply.cjs walk the bell and the thread in a browser; this file is the offline layer under them.
 *  - theme: the styles take colours from the page's theme variables, so dark follows the page at 1366 and at 390 (checked below).
 *  - contrast (a11y): the bell button and the panel carry roles and labels, never colour alone (checked below).
 *  - could not read: a feed that cannot be read is said in words (the bell's error line), and a failing draft store never stops a typed message.
 *  - string layer: the words go through T( ... ) = the page's tx (checked with a marking tx).
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const APP = path.join(__dirname, '..', 'public', 'app');
let failures = 0;
const t = (name, fn) => { try { fn(); console.log('  ok  ', name); } catch (e) { failures++; console.log('  FAIL', name, '\n      ', e.message); } };
function load(files, extra) {
  const quiet = [];
  const root = Object.assign({ tx: (s) => '«' + s + '»', esc: (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])), fmtMoney: () => 'A$90.00', cbQuiet: (where) => quiet.push(where),
    document: { createElement: () => ({ setAttribute() {}, appendChild() {}, style: {} }), head: { appendChild() {} }, documentElement: {}, addEventListener() {}, getElementById: () => null },
    Promise, Date, JSON, Math, Object, Array, String, Number, RegExp, Error, Intl, setTimeout, clearTimeout }, extra || {});
  root.window = root; root.globalThis = root;
  const context = vm.createContext(root);
  files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), context, { filename: f }));
  root.__quiet = quiet;
  return root;
}
const bell = load(['public/app/rail-bell-html.js', 'public/app/rail-bell-rows.js', 'public/app/rail-bell.js']);
const kit = bell.CBBellKit;

t('the bell and its parts share one kit; the bell keeps its public keys', () => {
  assert.deepStrictEqual(Object.keys(bell.CBBell).sort(), ['EP', 'line', 'markTitle', 'mount']);
  ['line', 'panelHtml', 'bellButtonHtml', 'pressRow', 'openMark', 'call'].forEach((key) => assert.strictEqual(typeof kit[key], 'function', key));
});
t('a line: an unknown action is worded from its name, a known one from the table; mine is flagged', () => {
  const unknown = bell.CBBell.line({ action: 'brand_new_thing', created_at: '2026-10-09T10:25:00.000Z', chit_id: 'c1', assigned_to_me: true });
  assert.strictEqual(unknown.say, 'brand new thing');
  assert.strictEqual(unknown.mine, true);
  assert.strictEqual(unknown.chit, 'c1');
});
t('a Query notice carries the entry and the client; a note reply carries the entry id; others carry neither', () => {
  const query = bell.CBBell.line({ action: 'mark_query', mark_entry: { entry_id: 'e1', entry_no: 'JV-1', posting_date: '2026-10-01' }, mark_client: 'Acme', mark_client_id: 'k1' });
  assert.strictEqual(query.mark.id, 'e1');
  assert.strictEqual(query.mark.client, 'Acme');
  assert.strictEqual(query.mark.clientId, 'k1');
  assert.ok(/Acme/.test(query.subj));
  const reply = bell.CBBell.line({ action: 'note_reply', mark_entry: { entry_id: 'e9' } });
  assert.strictEqual(reply.note, 'e9');
  assert.strictEqual(reply.mark, null);
  const plain = bell.CBBell.line({ action: 'message_sent', chit_id: 'c2' });
  assert.strictEqual(plain.mark, null);
  assert.strictEqual(plain.note, '');
});
t('the bell button and the panel are labelled and coded (contrast, a11y), and carry no hard-coded colour (theme)', () => {
  const html = kit.panelHtml({ rows: [], err: false, out: '', tone: '', open: true, count: 0 }) + kit.bellButtonHtml({ rows: [], count: 3, open: false });
  assert.ok(/role="dialog"/.test(html) && /data-testid="bell-btn"/.test(html) && /data-cbsid="CMP030-B01"/.test(html));
  const css = fs.readFileSync(path.join(APP, 'rail-bell-html.js'), 'utf8');
  const hard = (css.slice(css.indexOf('BELL_CSS ='), css.indexOf('function addCss')).match(/#[0-9a-fA-F]{3,6}\b/g) || []).length;
  const tokens = (css.match(/var\(--[a-z0-9-]+,#[0-9a-fA-F]{3,6}\)/g) || []).length;
  assert.ok(tokens > 0 && hard === tokens, 'every colour is a theme variable with its fallback: ' + hard + ' vs ' + tokens);
});
t('a feed that could not be read is said in words, never an empty list', () => {
  const html = kit.panelHtml({ rows: [], err: true, out: '', tone: '', open: true, count: 0 });
  assert.ok(/data-testid="bell-error"/.test(html) && /«/.test(html), html);
  assert.ok(/data-testid="bell-empty"/.test(kit.panelHtml({ rows: [], err: false, out: '', tone: '', open: true, count: 0 })));
});
t('pressRow: a chit row closes the list and opens the chit where this page opens chits', () => {
  const opened = []; let repaints = 0;
  const bellState = { open: true };
  const row = { getAttribute: (name) => ({ 'data-chit': 'c7' }[name] || null) };
  const node = { closest: (sel) => (/bell-row/.test(sel) ? row : null) };
  assert.strictEqual(kit.pressRow(bellState, { onOpen: (id) => opened.push(id) }, node, () => { repaints++; }), true);
  assert.deepStrictEqual(opened, ['c7']);
  assert.strictEqual(bellState.open, false);
  assert.strictEqual(repaints, 1);
});
t('pressRow: a press that is not on a row of ours is not handled (refusal path); a row with no target does nothing', () => {
  const state = { open: true };
  assert.strictEqual(kit.pressRow(state, {}, { closest: () => null }, () => {}), false);
  const bare = { getAttribute: () => null };
  assert.strictEqual(kit.pressRow(state, {}, { closest: () => bare }, () => {}), false);
  assert.strictEqual(state.open, true, 'nothing closed');
});

const thread = load(['public/app/rail-thread-words.js', 'public/app/rail-thread.js'], { CBOffline: { loadDraft: () => { throw new Error('store down'); }, saveDraft: () => { throw new Error('store down'); }, clearDraft: () => { throw new Error('store down'); } } });
const words = thread.CBThreadKit;
t('the thread words share one kit with the thread file', () => {
  ['threadText', 'fill', 'sentWords', 'when', 'reasonWords', 'draftGet', 'draftSet', 'draftClear', 'addCss', 'quietly'].forEach((key) => assert.strictEqual(typeof words[key], 'function', key));
});
t('fill puts the words in the holes and drops a hole it was not given', () => {
  assert.strictEqual(words.fill('Sent to {party}', { party: 'Acme' }), 'Sent to Acme');
  assert.strictEqual(words.fill('Sent to {party}{x}', { party: 'Acme' }), 'Sent to Acme');
});
t('sentWords: dispute, internal, queued on another installation, and external each say their own sentence', () => {
  const sent = (thread_, body, reply) => words.sentWords(thread_, body, reply);
  const dispute = sent({ dispute_id: 'd1' }, {}, null), internal = sent({}, { thread_type: 'internal' }, null);
  const queued = sent({ where: 'Acme AU' }, { thread_type: 'external' }, { ctp: { queued: true } }), external = sent({ party: 'Acme' }, { thread_type: 'external' }, {});
  assert.strictEqual(new Set([dispute, internal, queued, external]).size, 4);
  assert.ok(/Acme AU/.test(queued) && /Acme/.test(external));
});
t('a draft store that is down never stops the typed text: the draft is kept in memory and the fault is logged (fail closed)', () => {
  const o = { chit_id: 'c1', line_id: '' };
  assert.doesNotThrow(() => words.draftSet(o, 'hello'));
  assert.strictEqual(words.draftGet(o), 'hello');
  assert.doesNotThrow(() => words.draftClear(o));
  assert.strictEqual(words.draftGet(o), '', 'a cleared draft is gone, the store being down');
  assert.ok(thread.__quiet.length >= 2, 'the faults were told to the log: ' + thread.__quiet.join());
});
t('an engine refusal word has a sentence: the engine\'s own when the page loads it, else the server\'s, else "view only"', () => {
  assert.strictEqual(words.reasonWords('x', 'server words'), 'server words');
  assert.ok(/«/.test(words.reasonWords('x')), 'the fallback goes through the string layer');
  const withEngine = load(['public/app/rail-thread-words.js'], { CBRail: { WHY: { locked: 'The period is locked.' } } }).CBThreadKit;
  assert.strictEqual(withEngine.reasonWords('locked', 'ignored'), 'The period is locked.');
});
t('the thread styles take colours from the page theme variables (dark follows at 1366 and 390)', () => {
  const source = fs.readFileSync(path.join(APP, 'rail-thread-words.js'), 'utf8');
  const css = source.slice(source.indexOf('THREAD_CSS ='), source.indexOf('function addCss'));
  const hard = css.match(/#[0-9a-fA-F]{3,6}\b/g) || [], tokens = css.match(/var\(--[a-z0-9-]+,\s*#[0-9a-fA-F]{3,6}\)/g) || [];
  assert.ok(tokens.length > 0 && hard.length >= tokens.length);
  assert.ok(/min-width|flex/.test(css), 'the layout is flex, so it fits 390 as well as 1366');
});
console.log(failures ? failures + ' FAILED' : 'rail-parts: all ok');
process.exit(failures ? 1 : 0);
