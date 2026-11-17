/**
 * tests/advice-retry.test.cjs — M30-2: the advice chit WENT, only recording it failed. Pressing again must retry the RECORD with the same chit
 * (one POST /chits/send in all), and the words must say the advice was sent. Run: node tests/advice-retry.test.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
globalThis.window = globalThis;
const calls = [];
let patchFails = 1;
globalThis.document = { createElement: () => ({ setAttribute() {}, appendChild() {} }), head: { appendChild() {} }, documentElement: { appendChild() {} } };
globalThis.EP = {};
globalThis.api = async (name, o) => {
  calls.push(name);
  if (name === 'createChit') return { chit_id: 'chit-1' };
  if (name === 'booksPayPatch') { if (patchFails-- > 0) { const e = new Error('Failed'); e.status = 500; throw e; } return { advice: { chit_id: o.body.advice_chit_id, state: 'sent', shared_at: null } }; }
  return {};
};
globalThis.CBAction = { run: async (btn, fn, o) => { try { const r = await fn(); o.outcome && o.outcome(r); return r; } catch (e) { o.onFail && o.onFail(o.failed, e); } } };
eval(fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'rail-advice.js'), 'utf8'));
const el = { addEventListener() {}, removeEventListener() {}, querySelector: () => null, set innerHTML(v) { this.h = v; }, get innerHTML() { return this.h || ''; }, contains: () => true };
const adv = { party: { name: 'cbincroot' }, may: { send_advice: { ok: true }, share_advice: { ok: false } }, body: { recipients: [] }, advice: { chit_id: null, state: 'none' }, words: 'x', share: null };
const h = globalThis.CBAdvice.mount(el, { payment_id: 'p1', advice: adv });
(async () => {
  const m = el.__cbadvice;
  await h.press ? 0 : 0;
  // drive the click path
  const click = () => new Promise((res) => { const orig = globalThis.CBAction.run; globalThis.CBAction.run = (b, f, o) => orig(b, f, o).then(res); });
  let p = click();
  const target = { closest: () => ({ getAttribute: () => 'send', classList: { contains: () => false } }) };
  const handlers = []; el.addEventListener = (t, f) => handlers.push(f);
  h.destroy(); const h2 = globalThis.CBAdvice.mount(el, { payment_id: 'p1', advice: adv });
  handlers[0]({ target: { closest: () => ({ getAttribute: () => 'send', classList: { contains: () => false } }) }, preventDefault() {} });
  await p;
  assert.strictEqual(calls.filter((c) => c === 'createChit').length, 1);
  assert(el.__cbadvice.failed && el.__cbadvice.sentChit === 'chit-1', 'failed, chit remembered');
  assert(/sent to cbincroot, but not saved/.test(el.__cbadvice.outWords), 'words: ' + el.__cbadvice.outWords);
  p = click(); handlers[0]({ target, preventDefault() {} }); await p;
  assert.strictEqual(calls.filter((c) => c === 'createChit').length, 1, 'no second advice chit');
  assert.strictEqual(calls.filter((c) => c === 'booksPayPatch').length, 2, 'the record was retried');
  assert(!el.__cbadvice.failed);
  console.log('advice-retry: all ok');
})().catch((e) => { console.error(e); process.exit(1); });
