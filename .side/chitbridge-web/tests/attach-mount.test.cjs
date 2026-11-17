/**
 * tests/attach-mount.test.cjs — R07: CBAttach.mount (public/app/attach-ui.js), driven with no browser.
 * Proves: the mount draws ONE button, presses go through CBAction, the upload carries chit/message/line, an oversize file is
 * refused by the one gate (no POST), a cancel is silent, cb:rail fires once, and no <a href> reaches a Bearer attachments route.
 * Run: node tests/attach-mount.test.cjs
 */
'use strict';
const path = require('path'), fs = require('fs'), assert = require('assert');
const ROOT = path.join(__dirname, '..');
globalThis.window = globalThis;
const toasts = [], posts = [];
function mkEl() {
  const el = { _h: '', attrs: {}, listeners: {}, isConnected: true, children: [],
    set innerHTML(v) { this._h = v; this.btn = /data-testid="cb-attach-btn"/.test(v) ? mkBtn() : null; }, get innerHTML() { return this._h; },
    querySelector(s) { return /cb-attach-btn/.test(s) ? this.btn : null; },
    dispatchEvent(ev) { (this.listeners[ev.type] || []).forEach((f) => f(ev)); return true; },
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); } };
  return el;
}
function mkBtn() {
  const b = { attrs: { onclick: 'x' }, listeners: {}, isConnected: true, disabled: false,
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; },
    removeAttribute(k) { delete this.attrs[k]; }, addEventListener(t, f) { this.listeners[t] = f; }, set textContent(v) {}, get innerHTML() { return 'b'; }, set innerHTML(v) {} };
  return b;
}
let chosen = null;
globalThis.document = { getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {}, addEventListener() {}, remove() {}, click() {} }),
  head: { appendChild() {} }, documentElement: { appendChild() {} }, body: { appendChild() {} }, dispatchEvent() {} };
globalThis.CustomEvent = function (type, init) { this.type = type; this.detail = init && init.detail; };
globalThis.toast = (m) => toasts.push(m);
globalThis.esc = (v) => String(v == null ? '' : v).replace(/[<>"&]/g, '');
globalThis.EP = { attUpload: { m: 'POST', p: '/api/attachments' } };
globalThis.api = async (k, o) => { posts.push(o.body); return { id: 'a1', name: o.body.name, mime: o.body.mime, size: 3 }; };
globalThis.CBAction = { run: async (btn, fn, o) => { const res = { ok: false }; try { res.value = await fn(); res.ok = true; o.outcome && o.outcome(res.value); } catch (e) { res.error = e; } return res; } };
globalThis.FileReader = function () { this.readAsDataURL = () => { this.result = 'data:;base64,QUJD'; setTimeout(() => this.onload(), 0); }; };
// attach-ui's chooser makes an <input>; replace it by wrapping after load
const src = fs.readFileSync(path.join(ROOT, 'public', 'app', 'attach-ui.js'), 'utf8');
(0, eval)(src + '\n;globalThis.cbAttachChoose = function(){ return Promise.resolve(globalThis.__chosen); };globalThis.__att = { CBATT: CBATT };');
// eval'd function declarations land on globalThis in sloppy indirect eval, but cbAttachChoose is reassigned above
assert.strictEqual(typeof CBAttach.mount, 'function', 'attach-ui.js gives CBAttach.mount');
let pass = 0, fail = 0;
const it = async (w, fn) => { try { await fn(); pass++; console.log('  ok  ' + w); } catch (e) { fail++; console.log('  FAIL ' + w + '\n       ' + (e && e.message || e)); } };
const file = (name, size) => ({ name, size, type: 'application/pdf' });
(async () => {
  const el = mkEl(); const rail = []; el.addEventListener('cb:rail', (e) => rail.push(e.detail));
  const m = CBAttach.mount(el, { chit_id: 'c1', message_id: 'm9', line_index: 2 });
  await it('mount draws one attach button, no inline onclick left', () => { assert(m && el.btn); assert.strictEqual((el.innerHTML.match(/cb-attach-btn/g) || []).length, 1); assert.strictEqual(el.btn.getAttribute('onclick'), null); });
  await it('mount without a chit draws nothing', () => assert.strictEqual(CBAttach.mount(mkEl(), {}), null));
  await it('a press uploads once with chit · message · line', async () => {
    globalThis.__chosen = file('bill.pdf', 1000);
    await el.btn.listeners.click({ currentTarget: el.btn });
    assert.strictEqual(posts.length, 1); assert.deepStrictEqual([posts[0].chit_id, posts[0].message_id, posts[0].line_index, posts[0].name], ['c1', 'm9', 2, 'bill.pdf']);
    assert.strictEqual(rail.length, 1); assert.strictEqual(rail[0].module, 'attach'); assert.strictEqual(rail[0].result.id, 'a1');
  });
  await it('over 6 MB is refused by the one gate — no POST, no event', async () => {
    globalThis.__chosen = file('big.pdf', 6 * 1024 * 1024 + 1);
    await el.btn.listeners.click({ currentTarget: el.btn });
    assert.strictEqual(posts.length, 1); assert.strictEqual(rail.length, 1); assert(toasts.some((t) => /limit/.test(t)));
  });
  await it('an empty file is refused', async () => { globalThis.__chosen = file('e.pdf', 0); await el.btn.listeners.click({ currentTarget: el.btn }); assert.strictEqual(posts.length, 1); });
  await it('cancel is silent', async () => { const n = toasts.length; globalThis.__chosen = null; await el.btn.listeners.click({ currentTarget: el.btn }); assert.strictEqual(toasts.length, n); assert.strictEqual(posts.length, 1); });
  await it('atts are listed, opened by click handler (no href)', () => { const e2 = mkEl(); CBAttach.mount(e2, { chit_id: 'c1', atts: [{ id: 'z1', name: 'a.pdf', mime: 'application/pdf', size: 10 }] }); assert(/cb-attach-item/.test(e2.innerHTML)); assert(!/href=/.test(e2.innerHTML)); });
  await it('no <a href> to /api/attachments anywhere in public/', () => {
    const bad = []; const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((f) => { const p = path.join(d, f.name); if (f.isDirectory()) { if (f.name !== 'node_modules') walk(p); } else if (/\.(html|js)$/.test(f.name) && f.name !== 'till.html') { if (/href\s*=\s*["'`][^"'`]*\/api\/attachments/.test(fs.readFileSync(p, 'utf8'))) bad.push(f.name); } });
    walk(path.join(ROOT, 'public')); assert.deepStrictEqual(bad, []);
  });
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
