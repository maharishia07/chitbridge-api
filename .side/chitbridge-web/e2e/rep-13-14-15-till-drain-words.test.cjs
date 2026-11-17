/**
 * e2e/rep-13-14-15-till-drain-words.test.cjs — REP-13 · REP-14 · REP-15 (proof 2026-11-14): the counter's send loop SAYS why it did not send.
 * @type regression
 * OWNS      the proof that the REAL HOST.drain (public/till.html, lifted whole into a vm sandbox with the real queue ladder and refusedRow) records, in HOST.last.why:
 *   REP-13  a row stamped for a different shop (five keys, re-paired mid-day): 'Some queued rows were written by a different shop on this device and are not sent.',
 *           and nothing is posted for it;
 *   REP-14  rows exist but not one was tried: 'Nothing was even attempted — tell us this, it is not normal.' — and a row merely WAITING gets its own sentence instead;
 *   REP-15  a refusal (403 on the key / the server's own words on one bill / a 400), a deadline (the fetch aborts after the deadline) and no key: each its own sentence.
 *   Cites drifted: till.html:4768 / :5637 are now HOST.drain (the foreign-row gate in the loop, the "nothing attempted" line in its finally, no key at its top).
 * CALLED BY .github/workflows/ci.yml (Offline guards). No browser, no network.
 * FLOW      till.html text → lifted functions → vm sandbox with stand-in DB / fetch → HOST.drain() → HOST.last
 *   node e2e/rep-13-14-15-till-drain-words.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'till.html'), 'utf8');

function between(startMark, endMark, from) {
  const a = src.indexOf(startMark, from || 0);
  if (a < 0) throw new Error('till.html: not found: ' + startMark);
  const b = src.indexOf(endMark, a);
  if (b < 0) throw new Error('till.html: end not found: ' + endMark);
  return src.slice(a, b + endMark.length);
}
const queueFrom = src.indexOf('var Q_FLOOR = 2000');
const refusedStart = src.indexOf('async function refusedRow(');
if (queueFrom < 0 || refusedStart < 0) throw new Error('queue ladder or refusedRow not found');
const queueBlock = src.slice(queueFrom, src.indexOf('\n}\n', refusedStart) + 3); /* qBackoff … refusedRow */
const fetchByUnder = between('async function fetchBy_(url, opts, ms){', '\n}\n');
/* the stale-price gate, the held-wait words and the sent-proof the drain calls (the base batch added them): the REAL functions, lifted whole, never stand-ins */
const liftTop = (name) => {
  const start = src.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'));
  if (start < 0) throw new Error('till.html: function ' + name + ' not found');
  const first = src.slice(start, src.indexOf('\n', start));
  return /\}\s*$/.test(first) && !/\{\s*$/.test(first) ? first : src.slice(start, src.indexOf('\n}\n', start) + 3);
};
const gateBlock = ['throwIfFrozen', 'staleSaleRow', 'staleCandidate', 'staleGate', 'staleGateSafe', 'heldWaitWords', 'drainAnswerProof', 'drainRecordSent'].map(liftTop).join('\n');
const drainStart = src.indexOf('  async drain(opts){');
const drainText = drainStart < 0 ? '' : src.slice(drainStart, src.indexOf('\n  },\n};', drainStart) + 4);
if (!drainText.includes('this.last = {')) throw new Error('HOST.drain not found whole');

let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (info ? '\n          ' + String(info).slice(0, 300) : '')); } };

/** one world: a queue, a key or not, a line, what the shop answers; returns { last, posts, db } after one drain */
async function run(world) {
  const posts = [], db = { queue: (world.queue || []).map((r) => Object.assign({}, r)) };
  const sb = {
    console, Date, Math, JSON, Promise, Object, Number, String, Array, setTimeout, clearTimeout, AbortController, posts,
    DEADLINE: world.deadline || 30000, OWNER: world.owner || null, FOREIGN: 0, WAITS_FOR_BILL: 'WAITS_FOR_BILL',
    STATE: { queued: world.queued === undefined ? db.queue.length : world.queued },
    cbQuiet() {}, toastLine() {}, frozenDrain: () => false, lineUp: () => world.line !== false, queueTally: async () => {}, paintStatus() {}, drainSoon() {},
    personOn: () => false, isSaleRow: () => false, renumberBill: async () => null, stampDeliveryRefs: (n, rows) => rows, chitOf: (b) => ({ no: b.no }),
    deviceId: () => 'dev', netGate: async () => {}, lineNote() {}, devTimed() {}, ls: { set() {} },
    DB: { all: async (t) => db[t] || [], put: async (t, row) => { const l = db[t] || (db[t] = []); const i = l.findIndex((x) => x.no === row.no); if (i >= 0) l[i] = row; else l.push(row); }, del: async (t, no) => { db[t] = (db[t] || []).filter((x) => x.no !== no); } },
    fetch: world.fetch || (async () => { throw new Error('no fetch expected'); })
  };
  sb.window = sb; vm.createContext(sb);
  vm.runInContext(queueBlock + '\n' + gateBlock + '\n' + fetchByUnder + '\nasync function fetchBy(url, opts, ms){ posts.push(url); return fetchBy_(url, opts, ms); }\n', sb);
  vm.runInContext('var HOST = {\n  api: "https://api.test", _busy: false, _busyAt: 0, cred: function(){ return ' + (world.noKey ? 'null' : '"key-1"') + '; },\n  auth: function(h){ return h; }, idemHeaders: function(p, b, h){ return h; },\n  last: null,\n' + drainText + '}; ', sb);
  await vm.runInContext('HOST.drain(' + (world.force ? '{ force: true }' : '') + ')', sb);
  return { last: vm.runInContext('HOST.last', sb), posts, db, foreign: sb.FOREIGN };
}
const reply = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body, clone() { return this; } });

(async () => {
  /* REP-13 — hand-computed: the one row is stamped shop-B, this counter is shop-A → skipped, said, never posted; tried 0, sent 0, FOREIGN 1 */
  let r = await run({ owner: 'shop-A', queue: [{ no: 'B-1', _shop: 'shop-B' }], fetch: reply(200, { chit_id: 'c1' }) });
  ok('REP-13: a row stamped for a different shop is SAID: "Some queued rows were written by a different shop on this device and are not sent."', r.last && r.last.why === 'Some queued rows were written by a different shop on this device and are not sent.', JSON.stringify(r.last));
  ok('REP-13: …nothing was posted for it, and it stays in the queue', r.posts.length === 0 && r.db.queue.length === 1 && r.last.tried === 0 && r.last.sent === 0, r.posts.length + ' posts ' + r.db.queue.length + ' rows');
  ok('REP-13: …and it is counted (FOREIGN = 1)', r.foreign === 1, String(r.foreign));
  r = await run({ owner: 'shop-A', queue: [{ no: 'A-1', _shop: 'shop-A' }, { no: 'B-1', _shop: 'shop-B' }], fetch: reply(200, { chit_id: 'c1' }) });
  ok('REP-13: the shop\'s own row still goes (1 sent) while the foreign one is said', r.last.sent === 1 && r.posts.length === 1 && /different shop/.test(r.last.why || ''), JSON.stringify(r.last));

  /* REP-14 — rows are owed (STATE.queued 2) but the drain finds none to try: the wedge alarm, in those words */
  r = await run({ queue: [], queued: 2 });
  ok('REP-14: rows owed and not one tried → "Nothing was even attempted — tell us this, it is not normal."', r.last.why === 'Nothing was even attempted — tell us this, it is not normal.' && r.last.tried === 0, JSON.stringify(r.last));
  /* a row WAITING (backoff) must not cry wolf: it gets its own sentence */
  const later = Date.now() + 90 * 1000;
  r = await run({ queue: [{ no: 'W-1', _nextAt: later }], fetch: reply(200, {}) });
  ok('REP-14: a row merely waiting says so — "1 waiting a moment before the next try" — never the wedge alarm', /^1 waiting a moment before the next try/.test(r.last.why || '') && !/Nothing was even attempted/.test(r.last.why) && /Press Send now/.test(r.last.why), JSON.stringify(r.last));
  r = await run({ queue: [{ no: 'W-1', _nextAt: later }], force: true, fetch: reply(200, { chit_id: 'cW' }) });
  ok('REP-14: Send now (force) beats the wait — the row is tried and sent', r.last.tried === 1 && r.last.sent === 1 && r.posts.length === 1, JSON.stringify(r.last));
  r = await run({ queue: [], queued: 0 });
  ok('REP-14: an empty queue is a clean run — no reason at all', r.last.why === null && r.last.tried === 0, JSON.stringify(r.last));

  /* REP-15 — no key */
  r = await run({ noKey: true, queue: [{ no: 'K-1' }] });
  ok('REP-15 no key: "This counter has no key yet — pair it from the shop, then the bills will go."', r.last.why === 'This counter has no key yet — pair it from the shop, then the bills will go.' && r.posts.length === 0, JSON.stringify(r.last));
  /* REP-15 — a refusal: the key refused (403 with another code) */
  r = await run({ queue: [{ no: 'R-1' }], fetch: reply(403, { code: 'KEY_REVOKED' }) });
  ok('REP-15 refusal (403): "The shop refused this counter\'s key (403). It may have been changed or removed — pair this counter again and the bills will go."', r.last.why === 'The shop refused this counter\'s key (403). It may have been changed or removed — pair this counter again and the bills will go.', JSON.stringify(r.last));
  ok('REP-15 …the bill is NOT deleted on a 403', r.db.queue.length === 1 && r.last.sent === 0);
  /* a refusal of ONE bill (TILL_SEND_REFUSED) is not "the key": the server's words reach the screen, on the row */
  r = await run({ queue: [{ no: 'R-2' }], fetch: reply(403, { code: 'TILL_SEND_REFUSED', message: 'This customer is not on the shop\'s list.' }) });
  ok('REP-15 refusal of one bill keeps the server\'s own words: "Bill R-2: This customer is not on the shop\'s list."', r.last.why === 'Bill R-2: This customer is not on the shop\'s list.' && r.db.queue[0]._why === 'This customer is not on the shop\'s list.' && r.db.queue[0]._tries === 1, JSON.stringify(r.last));
  /* REP-15 — a 400 is a refusal too: its words, retried on the ladder (first wait 2 s: _tries 1 → qBackoff(1) = 2000 ms) */
  r = await run({ queue: [{ no: 'R-3' }], fetch: reply(400, { message: 'Bad total' }) });
  ok('REP-15 refusal (400): "Bill R-3: Bad total", the row kept, next try 2000 ms after it', r.last.why === 'Bill R-3: Bad total' && r.db.queue.length === 1 && (r.db.queue[0]._nextAt - r.db.queue[0]._at) === 2000, JSON.stringify(r.last));
  /* REP-15 — a deadline: the request never answers; fetchBy_ aborts it after `deadline` ms and the drain says the line dropped */
  const hang = (url, o) => new Promise((resolve, reject) => { o.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); });
  const t0 = Date.now();
  r = await Promise.race([run({ queue: [{ no: 'D-1' }], deadline: 40, fetch: hang }), new Promise((res) => setTimeout(() => res({ last: { why: 'HUNG: the deadline never fired' }, db: { queue: [] } }), 1500))]);
  ok('REP-15 deadline: a request that never answers is cut off at the deadline (40 ms here, not hung)', Date.now() - t0 < 3000 && r.last.why === 'The line dropped while sending bill D-1.', (Date.now() - t0) + ' ms ' + JSON.stringify(r.last));
  ok('REP-15 deadline: …the bill is kept, the failed attempt counted, and the reason travels on the row', r.db.queue.length === 1 && r.db.queue[0]._tries === 1 && r.db.queue[0]._why === 'the line dropped while sending', JSON.stringify(r.db.queue[0]));

  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
