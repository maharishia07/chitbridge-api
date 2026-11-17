'use strict';
// @type: unit
/**
 * ui-batch-progress.test.cjs — CMP026 batch progress and CMP027 batch tray (public/app/ui.js, ui.progress.batch).
 *
 * Cases: up to the named limit (10) the batch is the centre panel, above it the corner tray (a region, not a dialog); the bar is a role=progressbar with
 * valuenow = done + failed and valuemax = total; at most 20 blocks, each block total/blocks items, blue for done, red for failed, pale for left; the text line reads
 * "12 of 40 assigned · 28 left · 1 failed"; the live status is repainted at most every 500 ms; finish gives a summary and the failed list; leaving the page asks
 * first while it runs; Cancel works only when the caller gave a safe cancel; the work goes in steps of 10.
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/ui-action-set
 * Run: node e2e/ui-batch-progress.test.cjs
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
let failures = 0;
const check = (condition, message) => { console.log((condition ? '  ok ' : '  FAIL ') + message); if (!condition) failures++; };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* a very small page: elements keep their html, queries find the batch root and its parts by the same attributes the code writes */
const opened = [], guards = [], keyHandlers = {};
let tray = null, textWrites = 0;
function fakeRoot(html, onText) {
  const nodes = {};
  const part = (name) => nodes[name] || (nodes[name] = { attrs: {}, innerHTML: '', _text: '', setAttribute(k, v) { this.attrs[k] = v; }, get textContent() { return this._text; }, set textContent(v) { this._text = v; if (onText) onText(name); }, closest: () => null });
  return { html, part, focus() {}, querySelector: (selector) => (/progressbar/.test(selector) ? part('bar') : /cbp-count/.test(selector) ? part('count') : /cbp-failwrap/.test(selector) ? part('fails') : /cbp-tfoot/.test(selector) ? part('foot') : null), closest: () => null };
}
let root = null;
const sandbox = {
  console, tx: (t) => t, esc: (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  CBAction: { run: (b, fn) => Promise.resolve(fn()) },
  document: {
    addEventListener(name, handler) { (keyHandlers[name] = keyHandlers[name] || []).push(handler); }, body: { appendChild: (el) => { if (el.className !== 'cbp-tray') return; tray = el; root = fakeRoot(el.innerHTML, (n) => { if (n === 'count') textWrites++; }); } },
    createElement: () => ({ attrs: {}, innerHTML: '', className: '', setAttribute(k, v) { this.attrs[k] = v; }, remove() { if (tray === this) { tray = null; root = null; } } }),
    querySelector: (selector) => (/data-cbprogress/.test(selector) ? root : null), getElementById: () => null
  },
  setTimeout, clearTimeout,
  modal: (html) => { opened.push(html); root = fakeRoot(html, (n) => { if (n === 'count') textWrites++; }); }, closeModal: () => { opened.push('closed'); root = null; },
  addEventListener: (name) => guards.push('+' + name), removeEventListener: (name) => guards.push('-' + name)
};
vm.createContext(sandbox);
sandbox.window = sandbox;
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'ui.js'), 'utf8'), sandbox);
const ui = sandbox.ui, batch = ui.progress.batch;
const refuses = (fn, re) => { try { fn(); return false; } catch (error) { return re.test(error.message); } };

(async () => {
  console.log('registered');
  check(ui.components.batch.code === 'CMP026' && ui.components.batchtray.code === 'CMP027' && ui.components.batch.nonButton && ui.components.batchtray.nonButton && ui.components.batch.verb === 'OPEN' && ui.components.batchtray.verb === 'OPEN', 'CMP026 batch progress and CMP027 batch tray are registered, not buttons, verb OPEN');
  check(batch.trayAfterMs === 2000 && batch.step === 10, 'one named time (2 s) for the panel to become the tray, steps of ten');
  check(JSON.stringify(batch.steps(Array.from({ length: 25 }, (_, i) => i)).map((c) => c.length)) === '[10,10,5]', 'the items go in steps of ten (25 -> 10, 10, 5)');
  check(refuses(() => batch({ mount: 'bad', total: 5 }), /mount/) && refuses(() => batch({ mount: 'TST004-D01-U01', total: 0 }), /total/), 'a batch needs a mount code and a whole total above 0');

  console.log('panel (8 items)');
  let job = batch({ mount: 'TST004-D01-U01', label: 'Assigning', total: 8, unit: 'assigned', delay: 0 });
  await wait(20);
  let html = opened.join('');
  check(job.tray === false && /role="progressbar"/.test(html) && /aria-valuemax="8"/.test(html) && /aria-valuenow="0"/.test(html), 'a quick batch: the centre panel, the bar has valuemax = total');
  check((html.match(/class="cbp-blk"/g) || []).length === 8 && /0 of 8 assigned · 8 left/.test(html), 'one block per item when there are fewer than twenty, and the words');
  check(!/role="status"/.test(html) && /beforeunload/.test(guards.join()) && guards[0] === '+beforeunload', 'the moving count is not a live region (it is spoken at the start, each quarter and the end only); leaving the page asks first while it runs');
  job.done(3); job.failed(['Chit 4'], 'No reply');
  await wait(560);
  check(root.part('bar').attrs['aria-valuenow'] === '4' && root.part('count').textContent === '3 of 8 assigned · 4 left · 1 failed', 'valuenow = done + failed, and the words read "3 of 8 assigned · 4 left · 1 failed"');
  check((root.part('bar').innerHTML.match(/data-s="done"/g) || []).length === 3 && (root.part('bar').innerHTML.match(/data-s="failed"/g) || []).length === 1 && (root.part('bar').innerHTML.match(/data-s="left"/g) || []).length === 4, 'blocks: 3 blue, 1 red, 4 pale');
  job.done(4);
  const summary = job.finish();
  check(summary.done === 7 && summary.failed === 1 && summary.left === 0 && /7 of 8 assigned · 1 failed/.test(summary.text), 'finish returns and shows a short summary');
  check(/Chit 4 — No reply/.test(root.part('fails').innerHTML) && guards[guards.length - 1] === '-beforeunload', 'the failed list names the item and why; the leave guard is released');

  console.log('blocks for a long batch');
  const big = batch({ mount: 'TST004-D01-U02', label: 'Assigning', total: 40, speed: 'tray', unit: 'assigned', delay: 0 });
  await wait(20);
  check(big.tray === true && tray && /cbp-tray/.test(tray.className) && /role="region"/.test(tray.innerHTML) && !/aria-modal|class="modal/.test(tray.innerHTML), 'tray class: the corner tray, a region of the page, not a dialog');
  check((tray.innerHTML.match(/class="cbp-blk"/g) || []).length === 20 && /aria-valuemax="40"/.test(tray.innerHTML), 'at most twenty blocks (each is two items); valuemax is the real total');
  big.done(12); big.failed(1, 'Rejected');
  await wait(560);
  check(root.part('count').textContent === '12 of 40 assigned · 27 left · 1 failed', 'the words: 12 of 40 assigned · 27 left · 1 failed');
  const states = root.part('bar').innerHTML;
  check((states.match(/data-s="done"/g) || []).length === 6 && (states.match(/data-s="failed"/g) || []).length === 1, 'failed share: 12 of 40 is six blue blocks, the one failure shows one red block');
  big.done(27);
  big.finish();
  check((root.part('bar').innerHTML.match(/data-s="done"/g) || []).length + (root.part('bar').innerHTML.match(/data-s="failed"/g) || []).length === 20 && !/data-s="left"/.test(root.part('bar').innerHTML), 'at the end every block is blue or red');
  check(/<details>/.test(root.part('fails').innerHTML) && /Failed items \(1\)/.test(root.part('fails').innerHTML) && /Rejected/.test(root.part('fails').innerHTML), 'the tray folds the failed list under its count: one tap away');
  check(/Done/.test(root.part('foot').innerHTML), 'the tray ends with Done');

  console.log('time, not count (Athi 11 Nov)');
  tray = null; root = null; opened.length = 0;
  let short = batch({ mount: 'TST004-D01-U08', label: 'Assigning', total: 3, unit: 'assigned', delay: 0 });
  await wait(30);
  check(short.tray === false && tray === null && /data-cbname="background"/.test(opened.join('')), '3 items: the panel with a Run in background button, no tray');
  check(opened.join('').includes('aria-keyshortcuts="Control+B"') && opened.join('').includes('title="Run in background (Ctrl+B)"'), 'the button names its shortcut (aria-keyshortcuts) and says it in its title');
  short.done(3); short.finish();
  await wait(60);
  check(tray === null, '3 items finishing inside 2 s never show the tray');
  tray = null; root = null; opened.length = 0;
  const longer = batch({ mount: 'TST004-D01-U09', label: 'Assigning', total: 40, unit: 'assigned', delay: 0 });
  await wait(30);
  check(longer.tray === false && tray === null && opened.length > 0, '40 items start in the panel too (no count rule)');
  await wait(2050);
  check(longer.tray === true && tray !== null && /cbp-tray/.test(tray.className), 'still running after 2 s: it moves to the corner tray by itself');
  longer.done(40); longer.finish();
  tray = null; root = null; opened.length = 0;
  const pressed = batch({ mount: 'TST004-D01-U10', label: 'Assigning', total: 10, unit: 'assigned', delay: 0 });
  await wait(30);
  check(pressed.toTray() === true && pressed.tray === true && tray !== null, 'Run in background moves it to the tray at once');
  pressed.done(10); pressed.finish();
  tray = null; root = null; opened.length = 0;
  const keyed = batch({ mount: 'TST004-D01-U11', label: 'Assigning', total: 10, unit: 'assigned', delay: 0 });
  await wait(30);
  let prevented = 0;
  (keyHandlers.keydown || []).forEach((handler) => handler({ ctrlKey: true, key: 'b', target: null, preventDefault: () => { prevented += 1; } }));
  check(keyed.tray === true && prevented === 1 && tray !== null, 'Ctrl+B does the same while a panel is open');
  keyed.done(10); keyed.finish();
  tray = null; root = null; opened.length = 0;
  const mac = batch({ mount: 'TST004-D01-U13', label: 'Assigning', total: 10, unit: 'assigned', delay: 0 });
  await wait(30);
  (keyHandlers.keydown || []).forEach((handler) => handler({ metaKey: true, key: 'b', target: null, preventDefault() {} }));
  check(mac.tray === true, 'Cmd+B (metaKey) does the same on a Mac');
  mac.done(10); mac.finish();
  let idle = 0;
  (keyHandlers.keydown || []).forEach((handler) => handler({ ctrlKey: true, key: 'b', target: null, preventDefault: () => { idle += 1; } }));
  check(idle === 0, 'with no panel open the key is left alone (no preventDefault)');
  tray = null; root = null; opened.length = 0;
  const always = batch({ mount: 'TST004-D01-U12', label: 'Deleting', total: 3, speed: 'tray', unit: 'deleted', delay: 0 });
  await wait(30);
  check(always.tray === true && tray !== null && opened.length === 0, 'the tray class starts in the tray, no panel (an irreversible job keeps its record)');
  always.done(3); always.finish();
  tray = null; root = null;

  console.log('throttling');
  const quiet = batch({ mount: 'TST004-D01-U03', label: 'Assigning', total: 40, speed: 'tray', unit: 'assigned', delay: 0 });
  await wait(20);
  textWrites = 0;
  for (let i = 0; i < 30; i += 1) { quiet.done(1); await wait(10); }
  await wait(40);
  check(textWrites <= 2, 'thirty updates in 300 ms repaint the live status at most twice (' + textWrites + '), not thirty');
  await wait(600);
  check(root.part('count').textContent === '30 of 40 assigned · 10 left', 'the last state always lands after the pause');
  quiet.finish();

  console.log('cancel');
  const guarded = batch({ mount: 'TST004-D01-U04', label: 'Assigning', total: 40, speed: 'tray', unit: 'assigned', delay: 0 });
  check(guarded.cancel() === false && !guarded.cancelled(), 'no Cancel unless the caller gave a safe cancel');
  guarded.finish();
  let called = 0;
  const safe = batch({ mount: 'TST004-D01-U05', label: 'Assigning', total: 40, speed: 'tray', unit: 'assigned', delay: 0, cancel: () => { called += 1; } });
  await wait(20);
  check(/data-cbname="cancel"/.test(root.part('foot').innerHTML), 'the tray offers Cancel when the caller allows it');
  check(safe.cancel() === true && called === 1 && safe.cancelled() && tray === null && guards[guards.length - 1] === '-beforeunload', 'Cancel stops, tells the caller once, removes the tray and releases the leave guard');

  console.log('quiet and failures');
  const fast = batch({ mount: 'TST004-D01-U06', label: 'Assigning', total: 5, unit: 'assigned', delay: 200 });
  fast.done(5);
  opened.length = 0;
  fast.finish();
  check(opened.length === 0, 'a batch that ends inside the delay shows nothing');
  const bad = batch({ mount: 'TST004-D01-U07', label: 'Assigning', total: 5, unit: 'assigned', delay: 200 });
  bad.done(4); bad.failed(1, 'No reply');
  bad.finish();
  check(/1 failed/.test(opened.join('')), 'but a failure is always shown, even when it ended inside the delay');
  if (failures) { console.log(failures + ' FAILED'); process.exit(1); }
  console.log('all passed');
})();
