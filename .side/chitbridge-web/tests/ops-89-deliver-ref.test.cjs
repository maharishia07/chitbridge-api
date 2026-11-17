/**
 * tests/ops-89-deliver-ref.test.cjs - OPS-89: the deliver-lines write carries ONE client_ref per user action, from every caller.
 *
 * OWNS      the proof that core.js postDeliverLines (the one deliver-lines write: cap-chit2.js deliver + take material, cap-tasks.js tkDeliver)
 *           stamps client_ref on every row (lib/deliverline.js replays only when one is named), that after a FAILED send the retry of the same
 *           action re-sends the SAME ref, that another quantity, line or chit is another action, that an answer ends the action, and that
 *           the callers reach the route only through it.
 * CALLED BY .github/workflows/ci.yml (web job). Real core.js pieces (cbIdemKey, attemptOf, postDeliverLines) and the real tkDeliver in node, api stubbed.
 * FLOW      c2Deliver / c2TakeMaterial / tkDeliver -> postDeliverLines -> api -> POST /api/chits/:id/deliver-lines
 * CARD      01-rail-core-the-chit/chit-design-2
 * UNIT      01/Chit design 2 (deliver lines)
 * MUTATION  checked: key ignores the quantity (attemptOf rows -> []) -> "another quantity" red; key ignores the chit id -> "another chit" red;
 *           stamped rows dropped -> "every row carries a client_ref" red; the ref minted per send -> "a retry reuses the ref" red.
 * Run: node tests/ops-89-deliver-ref.test.cjs        (CORE_FILE=<path> aims it at another copy of core.js: the mutation check)
 */
'use strict';
const path = require('path'),
  fs = require('fs'),
  assert = require('assert');
const pub = (...p) => path.join(__dirname, '..', 'public', ...p);
const core = fs.readFileSync(process.env.CORE_FILE || pub('app', 'core.js'), 'utf8');
const pick = (src, re, what) => {
  const m = src.match(re);
  assert(m, what + ' is in the file');
  return m[0];
};

globalThis.window = globalThis;
const sent = [];
let failWith = null;
globalThis.api = async (name, req) => {
  sent.push({ name, params: req.params, body: req.body });
  if (failWith) {
    const e = failWith;
    failWith = null;
    throw e;
  }
  return { progress: {} };
};
(0, eval)(
  pick(core, /function cbIdemKey\([\s\S]*?\n\}\n/, 'cbIdemKey') + pick(core, /const _attempts = \{\};/, '_attempts') + pick(core, /function attemptOf\([\s\S]*?\n\}\n/, 'attemptOf') +
    pick(core, /async function postDeliverLines\([\s\S]*?\n\}\n/, 'postDeliverLines') + ';globalThis.postDeliverLines = postDeliverLines;'
);

const rows = (qty, line) => [{ line_id: line || 'l1', quantity: qty, unit: 'kg' }];
const refOf = (call) => call.body.rows[0].client_ref;
const lost = () => Object.assign(new Error('connection lost'), {}); /* no status: no answer came */

(async () => {
  await postDeliverLines('c2DeliverLines', 'chit-1', rows(2));
  assert(sent[0].body.rows.every((r) => typeof r.client_ref === 'string' && r.client_ref.length > 8), 'every row carries a client_ref');
  assert.strictEqual(sent[0].params.id, 'chit-1');

  /* the first send is LOST; each question below is asked while its ref is still held */
  failWith = lost();
  await postDeliverLines('c2DeliverLines', 'chit-1', rows(2)).catch(() => {});
  const held = refOf(sent[1]);
  assert.notStrictEqual(held, refOf(sent[0]), 'a delivered action drops its ref: the next press is a new delivery');
  await postDeliverLines('c2DeliverLines', 'chit-1', rows(5)); /* another quantity */
  await postDeliverLines('c2DeliverLines', 'chit-1', rows(2, 'l2')); /* another line */
  await postDeliverLines('c2DeliverLines', 'chit-2', rows(2)); /* another chit */
  assert.notStrictEqual(refOf(sent[2]), held, 'another quantity is another action');
  assert.notStrictEqual(refOf(sent[3]), held, 'another line is another action');
  assert.notStrictEqual(refOf(sent[4]), held, 'another chit is another action');
  /* ...and the retry of the lost action, after the others ran, still finds its ref */
  await postDeliverLines('c2DeliverLines', 'chit-1', rows(2));
  assert.strictEqual(refOf(sent[5]), held, 'a retry reuses the ref of the failed send');

  /* an answered refusal ends the action; a 409 in progress keeps it */
  failWith = Object.assign(new Error('no'), { status: 400 });
  await postDeliverLines('wlDeliver', 'chit-3', rows(1)).catch(() => {});
  await postDeliverLines('wlDeliver', 'chit-3', rows(1));
  assert.notStrictEqual(refOf(sent[7]), refOf(sent[6]), 'a refusal ends the action');
  failWith = Object.assign(new Error('busy'), { status: 409 });
  await postDeliverLines('wlDeliver', 'chit-4', rows(1)).catch(() => {});
  await postDeliverLines('wlDeliver', 'chit-4', rows(1));
  assert.strictEqual(refOf(sent[9]), refOf(sent[8]), 'a 409 in progress keeps the ref');
  failWith = Object.assign(new Error('gateway timeout'), { status: 504 });
  await postDeliverLines('wlDeliver', 'chit-6', rows(1)).catch(() => {});
  await postDeliverLines('wlDeliver', 'chit-6', rows(1));
  assert.strictEqual(refOf(sent[11]), refOf(sent[10]), 'a 504 keeps the ref: the write may have committed');

  await postDeliverLines('c2DeliverLines', 'chit-5', [{ line_id: 'a', quantity: 1 }, { line_id: 'b', quantity: 1 }]);
  const [ra, rb] = sent[12].body.rows.map((r) => r.client_ref);
  assert(ra.endsWith(':0') && rb.endsWith(':1') && ra.slice(0, -2) === rb.slice(0, -2), 'rows of one action share the ref, suffixed by position');

  /* tkDeliver (cap-tasks.js), the real function, goes through it */
  const tasks = fs.readFileSync(pub('app', 'cap-tasks.js'), 'utf8');
  const tk = pick(tasks, /function tkDeliver\(chit, line, amount, btn\) \{[\s\S]*?\n  \}\n/, 'tkDeliver');
  const out = { textContent: '' };
  const env = { root: globalThis, ensureEP() {}, T: (s) => s, $: () => out, changed() {}, CBActionRun: (_b, fn) => fn() };
  env.root.CBAction = { run: env.CBActionRun };
  const tkDeliver = new Function('root', 'ensureEP', 'T', '$', 'changed', tk + '; return tkDeliver;')(env.root, env.ensureEP, env.T, env.$, env.changed);
  const before = sent.length;
  failWith = lost();
  await tkDeliver({ chit_id: 'chit-9' }, { line_id: 'l9', unit: 'kg' }, 3, null).catch(() => {});
  await tkDeliver({ chit_id: 'chit-9' }, { line_id: 'l9', unit: 'kg' }, 3, null);
  assert.strictEqual(sent[before].name, 'wlDeliver');
  assert(refOf(sent[before]), 'tkDeliver sends a client_ref');
  assert.strictEqual(refOf(sent[before + 1]), refOf(sent[before]), 'tkDeliver: a retry reuses the ref');

  /* nothing else posts the route */
  for (const f of ['cap-chit2.js', 'cap-tasks.js']) {
    assert(!/(api|call)\('(c2DeliverLines|wlDeliver)'/.test(fs.readFileSync(pub('app', f), 'utf8')), f + ' reaches deliver-lines only through postDeliverLines');
  }
  console.log('ops-89-deliver-ref: ok');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
