'use strict';
// @type: unit
/**
 * group-actions.test.cjs — the group actions of app.html go through the one batch progress (ui.progress.batch.run), in steps of their speed class (Athi 11 Nov).
 *
 * Cases (a stand-in api, the real ui.js and the real app.html functions cut out by name): the three speed classes (step quick 10 / slow 5 / tray 5; the tray class starts in the tray, the others in the panel and move to it after 2 s);
 * 25 ids on quick → 3 calls of at most 10 and the corner tray, with the done / left / failed counts; one failing step counted failed while the rest still go;
 * Cancel stops after the step and says how many were done; 8 ids → one call and the centre panel (prodAvailApply); 12 ids slow (assignBulkChits) → 3 calls of at most 5 and the tray;
 * bulkRestore (one call per record) counts a failed record and keeps it ticked; no screen lock (showBusy is never called).
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/ui-action-set
 * Run: node e2e/group-actions.test.cjs
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
let failures = 0;
const check = (condition, message) => { console.log((condition ? '  ok ' : '  FAIL ') + message); if (!condition) failures++; };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let CALL_MS = 180; /* each stand-in call takes long enough for the 400 ms delay to pass on a long batch (the quick 8-id case sets it higher: one call must outlast the delay for the panel to open) */

let lastRoot = null, tray = null, panelHtml = [], busyCalls = 0, toasts = [], lastUndo = null;
function fakeRoot(html) {
  const nodes = {};
  const part = (name) => nodes[name] || (nodes[name] = { attrs: {}, innerHTML: '', textContent: '', setAttribute(k, v) { this.attrs[k] = v; }, closest: () => null });
  return { part, focus() {}, querySelector: (selector) => (/progressbar/.test(selector) ? part('bar') : /cbp-count/.test(selector) ? part('count') : /cbp-failwrap/.test(selector) ? part('fails') : /cbp-tfoot/.test(selector) ? part('foot') : null), closest: () => null };
}
let root = null;
const calls = [];
let failOn = null; /* (name, body, params) => throws or answers */
const state = { rows: [], selected: new Set(), sel: null, detail: null, mdetail: false, prods: [], prodPicked: new Set() };
let barText = ''; /* what the selection bar would read: updateSelBar draws it from UI.selected and the loaded rows */
const sandbox = {
  console, tx: (t) => t, txn: (one, other, n) => (n === 1 ? one : other).replace('{count}', n), txf: (t, v) => String(t).replace(/\{(\w+)\}/g, (m, k) => (v && k in v ? v[k] : m)), esc: (t) => String(t),
  CBAction: { run: (b, fn) => Promise.resolve(fn()) },
  document: {
    addEventListener() {}, body: { appendChild: (el) => { if (el.className === 'cbp-tray') { tray = el; root = fakeRoot(el.innerHTML); } } },
    createElement: () => ({ attrs: {}, innerHTML: '', className: '', setAttribute(k, v) { this.attrs[k] = v; }, remove() { if (tray === this) { tray = null; root = null; } } }),
    querySelector: (selector) => (/data-cbprogress/.test(selector) ? root : null), getElementById: () => null
  },
  setTimeout, clearTimeout,
  modal: (html) => { panelHtml.push(html); root = fakeRoot(html); lastRoot = root; }, closeModal: () => { root = null; },
  addEventListener() {}, removeEventListener() {},
  MSG: { fail: (verb, e) => 'Could not ' + verb + ': ' + ((e && e.message) || e), bulkAssigned: (n, who, sk) => n + ' assigned' + (sk ? ' · ' + sk + ' skipped' : ''), restored: (n) => 'Restored ' + n },
  STORE: { actors: [] }, UI: state, toast: (message, undo) => { toasts.push(message); lastUndo = undo || null; }, announce() {}, showBusy: () => { busyCalls += 1; }, hideBusy() {},
  MODALS: { stat: null, del: null }, statusWordFor: (to) => to, chitPos: () => null, cap: (t) => t, afterChitAction() {}, loadList: async () => {}, updateSelBar: () => { const ticked = state.rows.filter((r) => state.selected.has(r.id)); barText = state.selected.size + ' selected · A$' + (ticked.reduce((sum, r) => sum + (r.amt || 0), 0) / 100).toFixed(2); }, loadCatalogue: async () => {}, renderApp() {}, actionTargets: () => state.targets,
  prodId: (p) => p.id, pData: (p) => p, UIprod: null,
  api: async (name, options) => {
    calls.push({ name, params: options && options.params, body: options && options.body });
    await wait(CALL_MS);
    if (failOn) return failOn(name, options);
    return name === 'assignBulk' ? { assigned: options.body.chit_ids.length, skipped: [] } : name === 'prodStatusBulk' ? { updated: options.body.ids.length, missed: [] } : {};
  }
};
vm.createContext(sandbox);
sandbox.window = sandbox;
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'ui.js'), 'utf8'), sandbox);
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.html'), 'utf8');
/* a top-level function of app.html, cut out by its name (it ends at the first closing brace in column 0) */
function sourceOf(name) {
  const start = Math.max(html.indexOf('\nasync function ' + name + '('), html.indexOf('\nfunction ' + name + '('));
  if (start < 0) throw new Error('no function ' + name);
  return html.slice(start, html.indexOf('\n}\n', start) + 3);
}
['chitNameOf', 'groupRun', 'tickUndone', 'afterGroup', 'groupToast', 'bulkRestore', 'restoreChits', 'confirmDelete', 'statusStepBody', 'bulkJobIdOf', 'markStatusMoved', 'confirmStatus', 'assignBulkChits', 'prodAvailApply'].forEach((name) => vm.runInContext(sourceOf(name), sandbox));
/* the saved-job block (BULK_ACTIONS … bulkResume) is one run of consts and functions: cut from its marker to the end of bulkResume */
const jobStart = html.indexOf('/* ⭐ SAVE AND RESUME');
const jobEnd = html.indexOf('\n}\n', html.indexOf('async function bulkResume(')) + 3;
vm.runInContext(html.slice(jobStart, jobEnd), sandbox);
const ui = sandbox.ui, batch = ui.progress.batch;
const ids = (n) => Array.from({ length: n }, (_, i) => 'c' + (i + 1));
const reset = () => { lastUndo = null; calls.length = 0; tray = null; root = null; panelHtml = []; toasts = []; failOn = null; state.selected = new Set(); state.rows = []; };
const sizes = (name) => calls.filter((c) => c.name === name).map((c) => (c.body ? (c.body.chit_ids || c.body.ids).length : 1));

(async () => {
  console.log('presets');
  check(JSON.stringify(batch.speeds) === '{"quick":{"step":10,"alwaysTray":false},"slow":{"step":5,"alwaysTray":false},"tray":{"step":5,"alwaysTray":true}}', 'three named classes, the numbers live once in ui.js');
  check(JSON.stringify(batch.steps(ids(12), 'slow').map((c) => c.length)) === '[5,5,2]' && JSON.stringify(batch.steps(ids(25)).map((c) => c.length)) === '[10,10,5]', 'slow 12 → 5, 5, 2; quick 25 → 10, 10, 5');
  try { batch.steps(ids(3), 'fast'); check(false, 'an unknown class is refused'); } catch (error) { check(/quick, slow or tray/.test(error.message), 'an unknown class is refused'); }
  const where = (total, speed) => { const job = batch({ mount: 'TST004-D01-U01', total, speed, delay: 0 }); job.cancel(); job.finish(); return job.tray; };
  check(where(40, 'quick') === false && where(40, 'slow') === false && where(1, 'tray') === true, 'the count no longer decides: quick and slow start in the panel, the tray class in the tray');

  console.log('the runner: 25 ids on quick');
  reset();
  CALL_MS = 800; /* 3 steps take 2.4 s, so the panel moves to the tray on its own */
  const sent = [];
  const run = (n, options, send) => batch.run(ids(n), Object.assign({ mount: 'WRK001-U51', label: 'Working', unit: 'done' }, options), send);
  let result = await run(25, {}, async (chunk) => { sent.push(chunk.length); await wait(CALL_MS); return { done: chunk, failed: [] }; });
  check(JSON.stringify(sent) === '[10,10,5]' && result.done.length === 25 && result.failed.length === 0 && result.left === 0 && !result.cancelled, '25 ids → 3 calls of at most 10, all done');
  check(panelHtml.length > 0 && tray !== null && /cbp-tray/.test(tray.className) && /role="region"/.test(tray.innerHTML), 'it started in the panel and moved to the corner tray after 2 s (a region, not a locked dialog)');
  CALL_MS = 180;
  check(root && /All 25 done/.test(root.part('count').textContent), 'the end reads "All 25 done"');

  console.log('one failing step');
  reset();
  let step = 0;
  result = await run(25, {}, async (chunk) => { step += 1; await wait(CALL_MS); if (step === 2) throw new Error('No reply'); return { done: chunk, failed: [] }; });
  check(result.done.length === 15 && result.failed.length === 10 && result.left === 0 && step === 3, 'the failing step counts 10 failed, the other two still go (15 done)');
  check(/15 of 25 done · 10 failed/.test(root.part('count').textContent) && /No reply/.test(root.part('fails').innerHTML), 'the words say 15 done · 10 failed and the list names why');

  console.log('cancel');
  reset();
  let job = null, steps = 0;
  result = await run(25, { onStart: (j) => { job = j; } }, async (chunk) => { steps += 1; await wait(CALL_MS); if (steps === 1) job.cancel(); return { done: chunk, failed: [] }; });
  check(steps === 1 && result.cancelled && result.done.length === 10 && result.left === 15, 'Cancel stops after the current step: 10 done, 15 not done');
  console.log('stop on failure');
  reset();
  result = await run(25, {}, async (chunk) => ({ done: [], failed: [{ item: chunk[0], reason: 'refused' }], stop: true }));
  check(result.stopped && result.failed.length === 1 && result.left === 24, 'a step that says stop ends the run; the rest stay not done');

  console.log('slow and tray classes through the runner');
  reset(); sent.length = 0;
  result = await run(12, { speed: 'slow' }, async (chunk) => { sent.push(chunk.length); await wait(CALL_MS); return { done: chunk, failed: [] }; });
  check(JSON.stringify(sent) === '[5,5,2]', 'slow: 12 ids → 3 calls of at most 5');
  reset(); sent.length = 0;
  result = await run(3, { speed: 'tray' }, async (chunk) => { sent.push(chunk.length); await wait(CALL_MS * 3); return { done: chunk, failed: [] }; });
  check(sent.length === 1 && tray !== null && panelHtml.length === 0, 'tray: 3 ids → the tray, not the panel');

  console.log('app.html: prodAvailApply, 8 ids (quick), one call, the panel');
  reset();
  CALL_MS = 450;
  state.prods = ids(8).map((id) => ({ id, name: 'P' + id })); state.prodPicked = new Set(ids(8));
  await sandbox.prodAvailApply('unavailable');
  check(calls.length === 1 && sizes('prodStatusBulk')[0] === 8 && panelHtml.length > 0 && tray === null, '8 ids → 1 call of 8, the centre panel, no tray');
  CALL_MS = 180;
  check(/8 set to unavailable/.test(toasts[toasts.length - 1]) && busyCalls === 0, 'the toast counts 8; the screen is never locked (showBusy not called)');
  console.log('app.html: prodAvailApply, 25 ids, one id missed');
  reset();
  state.prods = ids(25).map((id) => ({ id })); state.prodPicked = new Set(ids(25));
  failOn = async (name, options) => ({ updated: options.body.ids.length - (options.body.ids.includes('c13') ? 1 : 0), missed: options.body.ids.includes('c13') ? ['c13'] : [] });
  await sandbox.prodAvailApply('unavailable');
  check(JSON.stringify(sizes('prodStatusBulk')) === '[10,10,5]', '25 ids → 3 calls of at most 10');
  check(/24 set to unavailable · 1 could not be saved/.test(toasts[toasts.length - 1]) && state.prodPicked.has('c13') && state.prodPicked.size === 1, '24 done, 1 failed and left ticked, said in the toast');

  console.log('app.html: assignBulkChits, 12 ids (slow)');
  reset();
  failOn = async (name, options) => ({ assigned: options.body.chit_ids.length - (options.body.chit_ids.includes('c7') ? 1 : 0), skipped: options.body.chit_ids.includes('c7') ? [{ chit_id: 'c7', reason: 'at capacity (10)' }] : [] });
  await sandbox.assignBulkChits(ids(12), 'a1');
  check(JSON.stringify(sizes('assignBulk')) === '[5,5,2]' && calls.every((c) => c.body.target_actor_id === 'a1'), '12 ids → 3 calls of at most 5, same body shape');
  check(/11 assigned · 1 skipped/.test(toasts[toasts.length - 1]) && state.selected.has('c7'), '11 assigned, the skipped one counted and left ticked');

  console.log('app.html: bulkRestore, one call per record');
  reset();
  state.targets = ids(25);
  state.rows = ids(25).map((id) => ({ id, amt: 500 }));
  barText = '25 selected · A$125.00'; /* what the bar read before the run */
  failOn = async (name, options) => { if (options.params.id === 'c4') throw new Error('gone'); return {}; };
  await sandbox.bulkRestore();
  check(calls.length === 25 && calls.every((c) => c.name === 'restore') && tray !== null, '25 ids → 25 restore calls (the same endpoint per record), and the panel moved to the tray after 2 s');
  check(/24 restored · 1 failed/.test(toasts[toasts.length - 1]) && state.selected.has('c4') && state.selected.size === 1, '24 restored, c4 counted failed and still ticked');
  check(barText === '1 selected · A$5.00', 'the selection bar is repainted after the run: 1 selected and its amount, not the 25 tried (' + barText + ')');

  console.log('app.html: assignBulkChits, a step that throws stops the run');
  reset(); state.selectMode = false;
  let assignCalls = 0;
  failOn = async (name, options) => { assignCalls += 1; if (assignCalls === 2) throw new Error('Target co-assist not found'); return { assigned: options.body.chit_ids.length, skipped: [] }; };
  await sandbox.assignBulkChits(ids(12), 'a1');
  check(sizes('assignBulk').length === 2 && /5 assigned · 5 skipped/.test(toasts[toasts.length - 1]) && /2 not done/.test(toasts[toasts.length - 1]), 'step 2 throws: the run stops (2 calls, not 3), 5 assigned, 5 failed, 2 not done');
  check(state.selectMode === true && state.selected.size === 7 && state.selected.has('c6') && state.selected.has('c12'), 'the select mode stays on; the five failed and the two not done stay ticked');

  console.log('app.html: confirmStatus stops on the first failure');
  reset();
  sandbox.MODALS.stat = { ids: ids(12), to: 'act', use: null }; state.selectMode = true;
  failOn = async (name, options) => { if (options.params.id === 'c3') throw new Error('refused'); return {}; };
  await sandbox.confirmStatus();
  check(calls.length === 3, 'ids c1..c3 are tried, then it stops (3 calls of 12)');
  check(/Moved 2 of 12, then: Could not change status: refused/.test(toasts[toasts.length - 1]), 'the sentence says how far it got and why it stopped');
  check(state.selectMode !== false && state.selected.size === 10 && state.selected.has('c3') && state.selected.has('c12') && !state.selected.has('c1'), 'the failed c3 and the nine not reached (c3..c12) stay ticked, the select mode is not cleared');

  console.log('app.html: confirmDelete, a partial run');
  reset();
  state.rows = ids(5).map((id) => ({ id }));
  sandbox.MODALS.del = { ids: ids(5) };
  failOn = async (name, options) => { if (options.params.id === 'c2') throw new Error('locked'); return {}; };
  await sandbox.confirmDelete();
  check(state.rows.map((r) => r.id).join() === 'c2' && state.selected.has('c2') && state.selected.size === 1, 'the rows that moved leave the list; the failed one stays and stays ticked');
  check(/4 moved to Trash · 1 failed/.test(toasts[toasts.length - 1]) && typeof lastUndo === 'function', 'the toast counts 4 moved, 1 failed, and offers Undo');
  calls.length = 0;
  await lastUndo();
  check(calls.filter((c) => c.name === 'restore').map((c) => c.params.id).join() === 'c1,c3,c4,c5', 'Undo restores the four that moved and not the failed one');

  if (failures) { console.log(failures + ' FAILED'); process.exit(1); }
  console.log('all passed');
})();
