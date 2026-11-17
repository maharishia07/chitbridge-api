/* tests/qa-131-bulk-status.test.cjs — QA-131: confirmStatus is ONE call per record, names the status it saw, stops at the first refusal,
 * leaves the rest ticked "not done", and sends the same step key again on a resume. confirmStatus is taken from public/app.html itself
 * (no copy), run against a stub api. No browser, no server. Run: node tests/qa-131-bulk-status.test.cjs */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.html'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'accounts-shell.js'), 'utf8');
function fnSource(name) {
  const at = src.indexOf('async function ' + name + '(') >= 0 ? src.indexOf('async function ' + name + '(') : src.indexOf('function ' + name + '(');
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) { const ch = src[i]; if (ch === '{') depth++; else if (ch === '}') { depth--; if (!depth) return src.slice(at, i + 1); } }
}
let pass = 0, fail = 0;
const t = async (n, fn) => { try { await fn(); pass++; console.log('  ok   ' + n); } catch (e) { fail++; console.log('  FAIL ' + n + '\n       ' + e.message); } };
function world(rows, apiImpl) {
  const calls = [], toasts = [];
  const ctx = {
    MODALS: { stat: { ids: rows.map((r) => r.id), to: 'act', use: 'resale' } }, closeModal() {}, chitPos: () => 0, showBusy() {}, hideBusy() {}, announce() {},
    tx: (s) => s, txn: (a) => a, txf: (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && k in v ? v[k] : m)), cap: (s) => s, toast: (m) => toasts.push(m),
    MSG: { fail: (w, e) => e.message, statusSet: () => 'set' }, groupToast: () => 'group', chitNameOf: (x) => x,
    /* the runner of app.html in miniature: one record at a time, a failure ends the run when stopOnFailure, the ones never reached are leftItems */
    groupRun: async (items, kind, perId) => { const r = { done: [], failed: [], leftItems: [], cancelled: false }; for (let i = 0; i < items.length; i++) { try { await perId(items[i]); r.done.push(items[i]); } catch (e) { r.failed.push({ item: items[i], reason: e.message }); if (kind.stopOnFailure) { r.leftItems = items.slice(i + 1); break; } } } return r; }, renderApp() {}, afterChitAction() {}, statusWordFor: (to, r) => ({ open: 'pending', act: r && r.billRx ? 'accepted' : 'in_progress', close: 'completed' }[to] || to),
    UI: { rows, detail: null, selectMode: true, selected: new Set(rows.map((r) => r.id)) },
    api: async (key, o) => { calls.push({ key, id: o.params.id, body: o.body, idemKey: o.idemKey }); return apiImpl(o); }
  };
  vm.createContext(ctx);
  for (const n of ['statusStepBody', 'bulkJobIdOf', 'markStatusMoved', 'tickUndone', 'confirmStatus']) vm.runInContext(fnSource(n), ctx);
  return { ctx, calls, toasts };
}
const mk = (id, st) => ({ id, state: 'open', _status: st, billRx: true });
(async () => {
  console.log('\nQA-131 · confirmStatus');
  await t('one call per record (no billUse), carrying from, use and a step key', async () => {
    const w = world([mk('a', 'pending'), mk('b', 'read')], async () => ({}));
    await w.ctx.confirmStatus();
    assert.strictEqual(w.calls.map((c) => c.key).join(), 'status,status');
    assert.strictEqual(JSON.stringify(w.calls.map((c) => c.body)), JSON.stringify([{ status: 'accepted', from: 'pending', use: 'resale' }, { status: 'accepted', from: 'read', use: 'resale' }]));
    assert.ok(w.calls[0].idemKey && w.calls[0].idemKey !== w.calls[1].idemKey, 'one key per record step');
    assert.ok(/^stat-.+-a-accepted$/.test(w.calls[0].idemKey));
  });
  await t('stops at the first refusal; the rest are not called and stay ticked, the moved one is unticked', async () => {
    let n = 0;
    const w = world([mk('a', 'pending'), mk('b', 'pending'), mk('c', 'pending')], async () => { if (++n === 2) { const e = new Error('This chit is accepted now, not pending'); e.status = 409; throw e; } return {}; });
    await w.ctx.confirmStatus();
    assert.strictEqual(w.calls.length, 2, 'c was never tried');
    assert.strictEqual([...w.ctx.UI.selected].sort().join(), 'b,c');
    assert.strictEqual(w.ctx.UI.rows[0]._status, 'accepted');
    assert.strictEqual(w.ctx.UI.rows[1]._status, 'pending', 'the refused record is not shown as moved');
    assert.ok(/^Moved 1 of 3, then: This chit is accepted now/.test(w.toasts[0]), w.toasts[0]);
  });
  await t('a resume of the same job sends the SAME step key for the same record', async () => {
    let n = 0;
    const rows = [mk('a', 'pending'), mk('b', 'pending')];
    const w = world(rows, async () => { if (++n === 2) throw new Error('down'); return {}; });
    await w.ctx.confirmStatus();
    const first = w.calls[1].idemKey;
    w.ctx.MODALS.stat.ids = ['b'];
    await w.ctx.confirmStatus();
    assert.strictEqual(w.calls[2].idemKey, first);
  });
  await t('a single move is the move it always was: no from, no step key', async () => {
    const w = world([mk('a', 'pending')], async () => ({}));
    await w.ctx.confirmStatus();
    assert.strictEqual(JSON.stringify(w.calls[0].body), JSON.stringify({ status: 'accepted', use: 'resale' }));
    assert.strictEqual(w.calls[0].idemKey, undefined);
  });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
