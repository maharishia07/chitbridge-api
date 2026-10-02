/**
 * ⭐⭐ ONE BAD BILL MUST NOT TAKE THE COUNTER OFFLINE (Athi, 2026-10-02).
 *
 * *"since two bills are waiting in the queue, the billing becomes offline … only the bill in issue should be waiting
 * rest all should go on its own. otherwise, you cannot continue work for ever"*
 *
 * Two bills to customers the shop could not send a copy to were REFUSED (403). fetchBy() recorded each refusal as a dead
 * line; three in a row and lineState() said 'none', so drain() stopped and every later bill queued behind a line that was
 * fine. This holds the three parts of the fix:
 *   1. an ANSWER is a working line, even a refusal — only no answer, or 502/503/504, is a dead one
 *   2. drain() stops for a KEY refusal only; a bill refused with code TILL_SEND_REFUSED waits alone
 *   3. a bill recorded ONE-SIDED (no copy to the customer) says so on its row, with the reason
 * Run: node tests/till-line-answer.test.cjs
 */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');

const API = path.join(__dirname, '..');
const PAGE = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8').replace(/\r\n/g, '\n');

let pass = 0;
const checks = [];
const it = (what, fn) => checks.push([what, fn]);

/** a top-level function's whole text, from its signature to the first line that is a bare `}` */
function body(sig) {
  const at = PAGE.indexOf(sig);
  assert.ok(at >= 0, sig + ' is gone — this test is measuring nothing');
  return PAGE.slice(at, PAGE.indexOf('\n}\n', at) + 3);
}

/** the counter's own line functions, run against a stubbed network that answers whatever `next` says */
function counter() {
  const ctx = { navigator: { onLine: true }, Date, Number, Math, devTimed() {}, next: null };
  ctx.fetchBy_ = async () => { const n = ctx.next; if (n === 'down') throw new Error('Failed to fetch'); return { status: n, ok: n >= 200 && n < 300 }; };
  vm.createContext(ctx);
  vm.runInContext('var LINE_TRIES = [], LINE_WAS = null, LINE_SINCE = null;\n'
    + body('function lineNote(') + body('function lineState(') + body('function lineUp(') + body('async function fetchBy('), ctx);
  return ctx;
}
async function hit(c, status, n) { for (let i = 0; i < n; i++) { c.next = status; try { await c.fetchBy('https://x/api/chits/send', {}); } catch (_) {} } }

it('five REFUSED bills in a row (403) leave the line up — the shop answered every time', async () => {
  const c = counter(); await hit(c, 403, 5);
  assert.strictEqual(c.lineUp(), true, 'a refusal was counted as a dead line: ' + JSON.stringify(c.lineState().state));
});
it('…and so do 409s and a 500 (the shop answered; the bill waits, not the counter)', async () => {
  const c = counter(); await hit(c, 409, 3); await hit(c, 500, 1);
  assert.strictEqual(c.lineUp(), true);
});
it('three answers of 503 (the gateway could not reach the shop — a deploy restarting) DO take the line down', async () => {
  const c = counter(); await hit(c, 503, 3);
  assert.strictEqual(c.lineUp(), false);
});
it('three sends with no answer at all DO take the line down', async () => {
  const c = counter(); await hit(c, 'down', 3);
  assert.strictEqual(c.lineUp(), false);
});
it('a refused bill between good ones does not move the line off "good"', async () => {
  const c = counter(); await hit(c, 200, 4); await hit(c, 403, 1); await hit(c, 200, 4);
  assert.strictEqual(c.lineState().state, 'good');
});
it('drain(): only a KEY refusal stops the queue — a bill refused with TILL_SEND_REFUSED keeps its reason and the rest go', () => {
  const at = PAGE.indexOf("why = 'The shop refused this counter");
  assert.ok(at > 0, 'the key-refused branch is gone');
  const guard = PAGE.slice(PAGE.lastIndexOf('else if', at), at);
  assert.ok(/TILL_SEND_REFUSED/.test(guard), 'the key-refused branch no longer tells a bill refusal from a key refusal');
});
it('a bill recorded one-sided carries the reason (_sent.one_sided) and its row says "no copy to customer"', () => {
  assert.ok(/ans\.one_sided/.test(PAGE), 'drain() no longer reads one_sided from the answer');
  assert.ok(/kept\._sent = \{[^}]*one_sided: oneSided/.test(PAGE), 'the reason is not kept on the bill');
  assert.ok(/till-bill-onesided-/.test(PAGE) && /no copy to customer/.test(PAGE), 'the bill row no longer shows it');
});

(async () => {
  console.log('\n══ ONE BAD BILL MUST NOT TAKE THE COUNTER OFFLINE ══\n');
  for (const [what, fn] of checks) {
    try { await fn(); pass++; console.log('  ok   ' + what); }
    catch (e) { console.log('  FAIL ' + what + '\n       ' + e.message); process.exitCode = 1; }
  }
  console.log('\n  ' + (process.exitCode ? '✗' : '✓') + ' ' + pass + ' passed · ' + checks.length + ' checks\n');
})();
