'use strict';
// @type: unit
/**
 * ui-batch-clock.test.cjs — the batch progress against a FAKE CLOCK (public/app/ui.js, ui.progress.batch): time rules without waiting.
 *
 * Cases: a batch that finishes at 1.9 s never shows the tray (no flash); a clean finish closes itself one second later; a failure keeps Done and stays;
 * a long job moves from the panel to the tray at 2 s and the panel (a modal) is closed by then; a page change that closes the modal leaves the tray alone and the
 * tray is not a dialog (the screen is never locked); the spoken progress is the start, the quarters and the end once (the moving count is not a live region).
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/ui-action-set
 * Run: node e2e/ui-batch-clock.test.cjs
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
let failures = 0;
const check = (condition, message) => { console.log((condition ? '  ok ' : '  FAIL ') + message); if (!condition) failures++; };

/* the fake clock: timers run in order of time when advance() is called */
const clock = { now: 1000000, timers: [], next: 1 };
function setTimer(fn, ms) { const id = clock.next++; clock.timers.push({ id, at: clock.now + (ms || 0), fn }); return id; }
function clearTimer(id) { clock.timers = clock.timers.filter((timer) => timer.id !== id); }
function advance(ms) {
  const end = clock.now + ms;
  for (;;) {
    const due = clock.timers.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at)[0];
    if (!due) break;
    clock.timers = clock.timers.filter((timer) => timer !== due);
    clock.now = due.at;
    due.fn();
  }
  clock.now = end;
}

let tray = null, root = null, modalOpened = 0, modalClosed = 0, trayShown = 0;
const spoken = [];
function fakeRoot() {
  const nodes = {};
  const part = (name) => nodes[name] || (nodes[name] = { attrs: {}, innerHTML: '', textContent: '', setAttribute(k, v) { this.attrs[k] = v; }, closest: () => null });
  return { part, focus() {}, querySelector: (selector) => (/progressbar/.test(selector) ? part('bar') : /cbp-count/.test(selector) ? part('count') : /cbp-failwrap/.test(selector) ? part('fails') : /cbp-tfoot/.test(selector) ? part('foot') : null), closest: () => null };
}
const live = { attrs: {}, setAttribute() {}, set textContent(value) { spoken.push(value); } };
const sandbox = {
  console, tx: (t) => t, esc: (t) => String(t), Date: { now: () => clock.now },
  CBAction: { run: (b, fn) => Promise.resolve(fn()) },
  document: {
    addEventListener() {},
    body: { appendChild: (el) => { if (el.className === 'cbp-tray') { tray = el; trayShown += 1; root = fakeRoot(); } } },
    createElement: () => ({ attrs: {}, innerHTML: '', className: '', setAttribute(k, v) { this.attrs[k] = v; }, remove() { if (tray === this) { tray = null; root = null; } } }),
    querySelector: (selector) => (/data-cbprogress/.test(selector) ? root : null), getElementById: (id) => (id === 'cbp-live' ? live : null)
  },
  setTimeout: setTimer, clearTimeout: clearTimer,
  modal: () => { modalOpened += 1; root = fakeRoot(); }, closeModal: () => { modalClosed += 1; if (!tray) root = null; },
  addEventListener() {}, removeEventListener() {}
};
vm.createContext(sandbox);
sandbox.window = sandbox;
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'ui.js'), 'utf8'), sandbox);
const batch = sandbox.ui.progress.batch;
const start = (total, extra) => batch(Object.assign({ mount: 'TST004-D01-U01', label: 'Working', total, unit: 'done', delay: 0 }, extra || {}));
const reset = () => { tray = null; root = null; modalOpened = 0; modalClosed = 0; trayShown = 0; spoken.length = 0; clock.timers = []; };

console.log('a quick job: no tray flash, closes itself');
reset();
let job = start(3);
advance(10);
check(modalOpened === 1 && tray === null, 'it starts in the panel');
advance(1890);
job.done(3); job.finish();
advance(5000);
check(trayShown === 0, 'finishing at 1.9 s never shows the tray');
check(modalClosed === 1, 'a clean finish closes the panel by itself a second later (nothing to dismiss)');

console.log('a failure keeps Done');
reset();
job = start(3, { speed: 'tray' });
advance(10);
job.done(2); job.failed(['Chit 3'], 'No reply'); job.finish();
advance(5000);
check(tray !== null && /Done/.test(root.part('foot').innerHTML) && /Chit 3/.test(root.part('fails').innerHTML), 'a failed item: the tray stays with Done and the failed list');
console.log('a cancel keeps the summary');
reset();
let cancelled = 0;
job = start(3, { speed: 'tray', cancel: () => { cancelled += 1; } });
advance(10);
job.cancel();
advance(5000);
check(cancelled === 1 && job.cancelled(), 'Cancel tells the caller once and the batch does not close itself as if it were clean');

console.log('a long job: panel, then the tray at 2 s');
reset();
job = start(40);
advance(10);
check(modalOpened === 1 && tray === null, '40 items start in the panel');
advance(2100);
check(job.tray === true && tray !== null && modalClosed === 1, 'at 2 s it is the tray and the panel (a modal) is closed: never modal past the move');
check(!/aria-modal|class="modal/.test(tray.innerHTML) && /role="region"/.test(tray.innerHTML), 'the tray is a region, not a dialog: the page stays usable');
sandbox.closeModal(); /* a page change (navTo) closes any modal */
check(tray !== null && job.tray === true, 'a page change closes modals and leaves the tray running');
job.done(40); job.finish();
check(tray !== null && trayShown === 1, 'the end shows in the same tray');
advance(1000);
check(tray === null, 'a clean end closes the tray a second later');

console.log('spoken progress');
reset();
job = start(40, { speed: 'tray' });
advance(10);
for (let i = 0; i < 40; i += 1) { job.done(1); advance(600); }
job.finish();
const endings = spoken.filter((text) => /All 40/.test(text)).length;
check(spoken.length <= 7 && endings === 1, 'start, at most each quarter, and the end once (' + spoken.length + ' spoken, ' + endings + ' ending)');

if (failures) { console.log(failures + ' FAILED'); process.exit(1); }
console.log('all passed');
