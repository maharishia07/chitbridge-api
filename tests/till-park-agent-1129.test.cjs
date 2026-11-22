#!/usr/bin/env node
// @type: contract
'use strict';
/**
 * till-park-agent-1129.test.cjs - THE SHOP PC'S QUEUE PARKS A REFUSAL OF THE CONTENT ONCE, WITH THE SERVER'S WORDS (batch 1129, tillPark4xx).
 *
 * OWNS      the proof, over the counter program's OWN drain() (lifted out of tools/tally-connector/till.js, real queue file in a temp folder, counting stub for the wire), that:
 *             (1) a 422 parks the entry ONCE with the problem's title and detail, and a second and third drain never send it again;
 *             (2) a 503, a 429 and a 408 keep the entry and retry it on the next drain; (3) a 409 that says "already received" counts as sent (the entry leaves the queue);
 *             (4) a 401 stays the re-sign-in path (fatal queue_why, the entry kept, NOT parked); (5) NO_PRICE (the shelf can change) is not parked;
 *             (6) the entries behind a parked one still go; (7) Retry takes the stamp off and the next drain sends it; Discard keeps a copy in discarded.jsonl and only then removes it.
 * CALLED BY scripts/guards.cjs . CI. No database, no network, no browser.
 * FLOW      queue.jsonl -> lifted drain (stub cb.call) -> queue.jsonl after
 * CARD      09-counter/offline-queue-and-replay
 * Run: node tests/till-park-agent-1129.test.cjs
 */
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.js'), 'utf8').replace(/\r\n/g, '\n');

function lift(name) {
  let i = SRC.indexOf('\nfunction ' + name + '(');
  if (i < 0) i = SRC.indexOf('\nasync function ' + name + '(');
  assert.ok(i >= 0, name + ' is not in till.js');
  let depth = 0;
  for (let k = SRC.indexOf('{', i); k < SRC.length; k++) {
    if (SRC[k] === '{') depth++;
    else if (SRC[k] === '}') { depth--; if (depth === 0) return SRC.slice(i, k + 1) + '\n'; }
  }
  throw new Error('unbalanced ' + name);
}
const liftLine = (re) => { const m = SRC.match(re); assert.ok(m, 'missing ' + re); return m[0] + '\n'; };
const BODY = ['readQueueEntries', 'parseQueueLine', 'removeSentFromQueue', 'replaceQueueLine', 'parkEntry', 'parkedList', 'parkedAnswer', 'receivedAlready',
  'refusalParks', 'refusalWords', 'titleAndDetail', 'settleRefusal', 'noteWhyNot', 'whyNot', 'pointsBody', 'logPointsAnswer', 'postPointsFor', 'drain'].map(lift).join('')
  + liftLine(/\nconst readLines = [^\n]*;/) + liftLine(/\nconst appendLine = [^\n]*;/) + liftLine(/\nconst RETRY_CODES = [^\n]*;/) + liftLine(/\nconst DUPLICATE_CODES = [^\n]*;/) + liftLine(/\nconst TORN_SAID = [^\n]*;/);

function counter(answer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'park-'));
  const sent = [];
  const cb = { call: async (m, p, body) => {
    sent.push(body && body.client_ref);
    const a = answer(body.client_ref, sent.filter((x) => x === body.client_ref).length);
    if (a.status >= 400) { const e = new Error(m + ' ' + p + ' -> ' + a.status + ' ' + (a.body.detail || a.body.message || '')); e.status = a.status; e.body = a.body; throw e; }
    return a.body || { ok: true, chit_id: 'c-' + body.client_ref };
  } };
  const ctx = { fs, path, DIR: dir, F: { queue: path.join(dir, 'queue.jsonl') }, cb, log: () => {}, Date, JSON, Set, Math, console,
    chitOf: (b) => ({ client_ref: b.no }), chitOfDoc: (d) => ({ client_ref: d.no }), movesOfDoc: () => null, rollup: {}, readSummary: () => null, writeSummary: () => {},
    healthNote: () => {} };
  vm.createContext(ctx);
  vm.runInContext('let online = false, QUEUE_WHY = null, QUEUE_SAID = false, draining = false, drainAt = 0;\n' + BODY
    + '\nthis.api = { drain, parkedList, parkedAnswer, readLines, why: () => QUEUE_WHY };', ctx);
  const put = (rows) => fs.writeFileSync(ctx.F.queue, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return { api: ctx.api, put, sent, dir, ctx };
}
let n = 0, failed = 0;
const it = async (what, fn) => { n++; try { await fn(); console.log('  ok  ' + what); } catch (e) { failed++; console.log('  FAIL ' + what + '\n      ' + (e && e.stack || e)); } };
const SALE = (no) => ({ no, at: '2026-11-22T10:00:00Z', total: 10, lines: [] });
const P422 = { status: 422, body: { type: 'about:blank', title: 'Quantity refused', detail: 'Line 2 has a quantity below zero.', code: 'BAD_QTY' } };

(async () => {
  await it('a 422 parks the entry ONCE with the title and detail, and is never sent again', async () => {
    const t = counter((no) => (no === 'C1/1' ? P422 : { status: 200, body: { ok: true } }));
    t.put([SALE('C1/1'), SALE('C1/2')]);
    await t.api.drain(); await t.api.drain(); await t.api.drain();
    assert.strictEqual(t.sent.filter((x) => x === 'C1/1').length, 1, 'sent once, not retried: ' + t.sent);
    const left = t.api.readLines(t.ctx.F.queue);
    assert.strictEqual(left.length, 1); assert.strictEqual(left[0].no, 'C1/1');
    assert.strictEqual(left[0]._parked.status, 422); assert.strictEqual(left[0]._parked.code, 'BAD_QTY');
    assert.ok(/Quantity refused/.test(left[0]._parked.why) && /below zero/.test(left[0]._parked.why), left[0]._parked.why);
    assert.strictEqual(t.api.parkedList().length, 1);
    assert.ok(t.sent.indexOf('C1/2') >= 0, 'the entry behind it still went');
  });
  await it('a 503, a 429 and a 408 keep the entry and are tried again', async () => {
    for (const st of [503, 429, 408]) {
      const t = counter(() => ({ status: st, body: { title: 'later' } })); t.put([SALE('C1/1')]);
      await t.api.drain(); await t.api.drain();
      assert.strictEqual(t.sent.length, 2, st + ' retried: ' + t.sent);
      const row = t.api.readLines(t.ctx.F.queue)[0]; assert.ok(row && !row._parked, st + ' must not park');
    }
  });
  await it('a 409 duplicate (already received) counts as sent; another 409 parks', async () => {
    const t = counter((no) => (no === 'C1/1' ? { status: 409, body: { duplicate: true, code: 'DUPLICATE' } } : { status: 409, body: { code: 'CHIT_REPLAY_DIFFERS', detail: 'a different sale has this number' } }));
    t.put([SALE('C1/1'), SALE('C1/2')]);
    await t.api.drain();
    const left = t.api.readLines(t.ctx.F.queue);
    assert.strictEqual(JSON.stringify(left.map((r) => r.no)), '["C1/2"]'); assert.ok(left[0]._parked && left[0]._parked.status === 409);
  });
  await it('a 401 is the re-sign-in path: kept, fatal reason, not parked', async () => {
    const t = counter(() => ({ status: 401, body: { code: 'KEY_REJECTED', message: 'sign this counter in again' } })); t.put([SALE('C1/1')]);
    await t.api.drain();
    const row = t.api.readLines(t.ctx.F.queue)[0];
    assert.ok(row && !row._parked); assert.ok(t.api.why() && t.api.why().fatal === true && /sign this counter in again/.test(t.api.why().say));
  });
  await it('NO_PRICE (the shelf can change) is retried, not parked', async () => {
    const t = counter(() => ({ status: 422, body: { code: 'NO_PRICE', detail: 'no price yet' } })); t.put([SALE('C1/1')]);
    await t.api.drain(); await t.api.drain();
    assert.strictEqual(t.sent.length, 2); assert.ok(!t.api.readLines(t.ctx.F.queue)[0]._parked);
  });
  await it('Retry takes the stamp off and the next drain sends it; Discard keeps a copy first', async () => {
    let ok = false;
    const t = counter(() => (ok ? { status: 200, body: { ok: true } } : P422));
    t.put([SALE('C1/1'), SALE('C1/2')]); await t.api.drain();
    assert.strictEqual(t.api.parkedList().length, 2);
    ok = true;
    assert.strictEqual(t.api.parkedAnswer('C1/1', 'retry'), true); await t.api.drain();
    assert.strictEqual(JSON.stringify(t.api.readLines(t.ctx.F.queue).map((r) => r.no)), '["C1/2"]');
    assert.strictEqual(t.api.parkedAnswer('C1/2', 'discard'), true);
    assert.strictEqual(t.api.readLines(t.ctx.F.queue).length, 0);
    const kept = fs.readFileSync(path.join(t.dir, 'discarded.jsonl'), 'utf8');
    assert.ok(/C1\/2/.test(kept) && /Quantity refused/.test(kept), 'the discarded entry is kept on disk: ' + kept);
    assert.strictEqual(t.api.parkedAnswer('nope', 'discard'), false);
  });
  console.log('\ntill-park-agent-1129: ' + (n - failed) + '/' + n + ' passed'); process.exit(failed ? 1 : 0);
})();
