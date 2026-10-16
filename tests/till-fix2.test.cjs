'use strict';
/**
 * till-fix2.test.cjs — ROUND TILL-FIX2: the Claude review's H5 · M6 · L4 (REVIEW-CLAUDE-2026-10-15), reproduced against the
 * page's OWN text. No DB, no network, no browser: the counter's functions are lifted out of till.html and run against stubbed
 * globals, so a rewrite cannot drift from the test.
 *   H5  a reward the server answers 409 BILL_NOT_RECORDED to is QUEUED behind its bill (never final), and a renumbered bill
 *       carries its reward row along under the new number
 *   M6  two number-takers in flight never print the same bill number (one series lock)
 *   L4  the close's "last bill" is the sale with the highest series number — never a text sort
 * Run: node tests/till-fix2.test.cjs
 */
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const API = path.join(__dirname, '..');
const PAGE = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8').replace(/\r\n/g, '\n');
const CBDoc = require(path.join(API, 'lib', 'docnumber.js'));

/** lift one top-level function (plain or async) out of the page, by name; '' when the page has no such function */
function liftIf(name) {
  let i = PAGE.indexOf('\nfunction ' + name + '(');
  if (i < 0) i = PAGE.indexOf('\nasync function ' + name + '(');
  if (i < 0) return '';
  let depth = 0;
  for (let k = PAGE.indexOf('{', i); k < PAGE.length; k++) {
    if (PAGE[k] === '{') depth++;
    else if (PAGE[k] === '}') { depth--; if (depth === 0) return PAGE.slice(i, k + 1) + '\n'; }
  }
  throw new Error('unbalanced ' + name);
}
function lift(name) { const src = liftIf(name); assert.ok(src, name + ' is not in the page'); return src; }
/** a top-level `var NAME = …;` line of the page, '' when absent */
function liftVar(name) { const m = PAGE.match(new RegExp('\\nvar ' + name + ' = [^\\n]*;')); return m ? m[0] + '\n' : ''; }
/** the whole CloudHost object literal — its methods are the thing under test — with the page's own code for "no such bill yet" */
function liftCloudHost() {
  const a = PAGE.indexOf('\nvar CloudHost = {');
  assert.ok(a >= 0, 'CloudHost is gone');
  const code = PAGE.match(/\nvar WAITS_FOR_BILL = '[A-Z_]+';/);
  return (code ? code[0] : '') + PAGE.slice(a, PAGE.indexOf('\n};\n', a) + 4);
}
/** an in-memory stand-in for the page's DB: a kv box plus the two row stores, each call waiting a tick like IndexedDB does */
function fakeDB() {
  const kv = {}, stores = { bills: {}, queue: {} };
  const tick = () => new Promise((res) => setTimeout(res, 1));
  return {
    kv, stores,
    get: async (k) => { await tick(); return kv[k] === undefined ? undefined : JSON.parse(JSON.stringify(kv[k])); },
    set: async (k, v) => { await tick(); kv[k] = JSON.parse(JSON.stringify(v)); },
    put: async (store, row) => { await tick(); stores[store][row.no] = JSON.parse(JSON.stringify(row)); },
    del: async (store, key) => { await tick(); delete stores[store][key]; },
    all: async (store) => { await tick(); return Object.keys(stores[store]).sort().map((k) => stores[store][k]); },
    allRaw: async (store) => { await tick(); return Object.keys(stores[store]).sort().map((k) => stores[store][k]); },
  };
}
const quiet = () => {};
const JOBS = [];
const it = (what, fn) => JOBS.push([what, fn]);
const say = (line) => JOBS.push([null, () => console.log(line)]);

/* ───────────────────────────────────────────── H5 ───────────────────────────────────────────── */
say('— H5 · the points survive until the bill reaches the server —');

/** the browser host with the line up, a key, and a server that answers `status` + `answer` to every POST */
function hostThatAnswers(status, answer) {
  const DB = fakeDB();
  const posted = [];
  const ctx = { console, setTimeout, JSON, Object, Math, Date, String, Number, Array, Promise, Error,
    DB, lineUp: () => true, cbQuiet: quiet, queueTally: async () => {}, paintStatus: quiet,
    fetchBy: async (url, init) => { posted.push({ url, body: JSON.parse(init.body) });
      return { ok: status < 300, status, json: async () => answer }; } };
  vm.createContext(ctx);
  const host = vm.runInContext(liftCloudHost() + '; CloudHost', ctx);
  host.key = 'till-key'; host.api = 'http://shop';
  return { host, DB, posted };
}
const BILL = 'C1/26-27/0005';
const REWARD = { ref: BILL, holder: 'ph:9876543210', spend: 20, at: '2026-10-15T10:00:00.000Z' };
const NOT_RECORDED = { error: 'conflict', code: 'BILL_NOT_RECORDED',
  message: 'Bill ' + BILL + ' has not reached ChitBridge yet, so its points are not recorded. Send the bill first.' };

it('409 BILL_NOT_RECORDED on the reward post is NOT final: the reward is queued behind its bill (<bill no>/reward)', async () => {
  const { host, DB } = hostThatAnswers(409, NOT_RECORDED);
  const out = await host.tillPost('/api/till/reward', REWARD, { queueAs: BILL + '/reward' });
  assert.ok(out && out.ok && out.queued, 'the counter called it final and dropped the points: ' + JSON.stringify(out));
  const row = DB.stores.queue[BILL + '/reward'];
  assert.ok(row, 'no queue row behind the bill; queue holds ' + JSON.stringify(Object.keys(DB.stores.queue)));
  assert.strictEqual(row.tillPost.path, '/api/till/reward');
  assert.deepStrictEqual(row.tillPost.body, REWARD);
});
it('queued twice for the same bill is ONE row (the key is the bill\'s), so a retry can never award twice', async () => {
  const { host, DB } = hostThatAnswers(409, NOT_RECORDED);
  await host.tillPost('/api/till/reward', REWARD, { queueAs: BILL + '/reward' });
  await host.tillPost('/api/till/reward', REWARD, { queueAs: BILL + '/reward' });
  assert.deepStrictEqual(Object.keys(DB.stores.queue), [BILL + '/reward']);
});
it('a real refusal stays final: a 400, and a 409 with another code, queue nothing', async () => {
  for (const [status, answer] of [[400, { error: 'validation', message: 'holder is required' }],
                                  [409, { error: 'conflict', code: 'TILL_SERIES_COLLISION', message: 'taken' }]]) {
    const { host, DB } = hostThatAnswers(status, answer);
    const out = await host.tillPost('/api/till/reward', REWARD, { queueAs: BILL + '/reward' });
    assert.ok(out && !out.ok && out.final, status + ' should be final: ' + JSON.stringify(out));
    assert.deepStrictEqual(Object.keys(DB.stores.queue), [], status + ' must not queue');
  }
});
it('the sale flow asks for exactly that: the sale posts (postRewardBehindBill) the reward with queueAs <bill no>/reward', () => {
  const finish = PAGE.slice(PAGE.indexOf("HOST.tillPost('/api/till/reward'"), PAGE.indexOf("HOST.tillPost('/api/till/reward'") + 300);
  assert.ok(/queueAs:\s*bill\.no \+ '\/reward'/.test(finish), 'finish() does not queue the reward behind its bill');
});
it('the queue counts that row as POINTS waiting (queueTally reads the path, not the key)', () => {
  assert.ok(/tillPost\.path\)\.indexOf\('\/api\/till\/reward'\) === 0\) t\.points\+\+/.test(PAGE));
});

/** renumberBill with its globals stubbed: the next number is fixed, the DB holds what the test puts in it */
function renumberWith(DB, nextNo) {
  const ctx = { console, setTimeout, JSON, Object, Math, Date, String, Number, Array, Promise, Error,
    DB, cbQuiet: quiet, tillId: () => 'C1', LAST_SERIES: null, nextNumber: async () => nextNo };
  vm.createContext(ctx);
  return vm.runInContext(liftVar('BILL_COMPANIONS') + liftIf('rekeyCompanions') + lift('renumberBill') + '; renumberBill', ctx);
}
it('a renumbered bill (409 TILL_SERIES_COLLISION) carries its reward row along: <new no>/reward with ref = the new number', async () => {
  const DB = fakeDB();
  const bill = { no: BILL, at: REWARD.at, lines: [], kind: 'cash', total: 100 };
  DB.stores.bills[BILL] = bill; DB.stores.queue[BILL] = bill;
  DB.stores.queue[BILL + '/reward'] = { no: BILL + '/reward', at: REWARD.at, tillPost: { path: '/api/till/reward', body: REWARD } };
  const renumberBill = renumberWith(DB, 'C1/26-27/0009');
  const moved = await renumberBill(bill, 'taken');
  assert.deepStrictEqual({ from: moved.from, to: moved.to }, { from: BILL, to: 'C1/26-27/0009' });
  const keys = Object.keys(DB.stores.queue).sort();
  assert.deepStrictEqual(keys, ['C1/26-27/0009', 'C1/26-27/0009/reward'], 'queue after the renumber: ' + JSON.stringify(keys));
  assert.strictEqual(DB.stores.queue['C1/26-27/0009/reward'].tillPost.body.ref, 'C1/26-27/0009', 'the reward still names the old number');
  /* Array.from: the page's array was made in the vm's realm, and deepStrictEqual compares prototypes too */
  assert.deepStrictEqual(Array.from(moved.companions || []), [BILL + '/reward'], 'the drain is not told which old rows retired');
});

/* ───────────────────────────────────────────── M6 ───────────────────────────────────────────── */
say('— M6 · one device never hands out the same bill number twice —');

/** nextNumber with the page's own helpers, a real docnumber engine, and a DB that yields between read and write */
function numberingOn(DB, extra) {
  const ctx = Object.assign({ console, setTimeout, JSON, Object, Math, Date, String, Number, Array, Promise, Error,
    DB, cbQuiet: quiet, tillId: () => 'C1', tillScheme: () => undefined, tillStore: () => 'cb-till',
    docCountry: () => 'IN', DOCNUM: () => CBDoc, ls: { get: (k, d) => d }, shopLs: (k) => k,
    DOC_TAGS: { GRN: 'receipt', DC: 'despatch', CN: 'credit', EXP: 'expense', SUB: 'subscription', R: 'payment' },
    LAST_SERIES: null }, extra || {});
  vm.createContext(ctx);
  const src = liftVar('SERIES_TURN') + ['docKindOf', 'seriesLockName', 'underSeriesLock', 'seriesFor', 'resumeFromCloud', 'numberText', 'takeNumber']
    .map(liftIf).join('') + lift('nextNumber');
  vm.runInContext(src, ctx);
  return ctx;
}
it('a sale and a background renumber take numbers at the same moment → two DIFFERENT numbers, and the series moved on by two', async () => {
  const DB = fakeDB();
  const ctx = numberingOn(DB);
  const [sale, renumber] = await Promise.all([ctx.nextNumber(), ctx.nextNumber()]);
  assert.notStrictEqual(sale, renumber, 'both printed ' + sale);
  assert.deepStrictEqual([sale, renumber].sort(), ['C1/26-27/0001', 'C1/26-27/0002']);
  assert.strictEqual(DB.kv.series.next, 3, 'the series after two numbers: ' + JSON.stringify(DB.kv.series));
});
it('ten at once are ten distinct numbers, 0001..0010, in some order', async () => {
  const ctx = numberingOn(fakeDB());
  const got = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(() => ctx.nextNumber()));
  assert.deepStrictEqual(got.slice().sort(), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => 'C1/26-27/' + String(n).padStart(4, '0')));
});
it('where the browser has Web Locks, the number is taken under a lock named for THIS counter\'s store (a second tab waits)', async () => {
  const asked = [];
  let chain = Promise.resolve();
  const navigator = { locks: { request: (name, job) => { asked.push(name); chain = chain.then(job); return chain; } } };
  const DB = fakeDB();
  const ctx = numberingOn(DB, { navigator });
  const got = await Promise.all([ctx.nextNumber(), ctx.nextNumber()]);
  assert.deepStrictEqual(got.sort(), ['C1/26-27/0001', 'C1/26-27/0002']);
  assert.deepStrictEqual(asked, ['cb-till-series:cb-till', 'cb-till-series:cb-till'], 'the lock was not asked for');
});
it('a peek (Settings › Bills "next bill") writes nothing and never waits for the lock', async () => {
  const DB = fakeDB();
  const ctx = numberingOn(DB);
  assert.strictEqual(await ctx.nextNumber(undefined, true), 'C1/26-27/0001');
  assert.strictEqual(DB.kv.series, undefined, 'a peek wrote the series');
  assert.strictEqual(await ctx.nextNumber(), 'C1/26-27/0001');
});
it('a tagged series (CN · GRN) is its own run and never touches the sales series', async () => {
  const DB = fakeDB();
  const ctx = numberingOn(DB);
  const [sale, cn, grn] = await Promise.all([ctx.nextNumber(), ctx.nextNumber('CN'), ctx.nextNumber('GRN')]);
  assert.strictEqual(sale, 'C1/26-27/0001');
  assert.ok(/^C\/?C1\/26-27\/0001$|^CN\/C1\/26-27\/0001$|^CC1\/26-27\/0001$/.test(cn) || cn.endsWith('/0001'), 'credit note ' + cn);
  assert.ok(grn.endsWith('/0001') && grn !== sale && grn !== cn, 'receipt ' + grn);
  assert.strictEqual(DB.kv.series.next, 2);
});

/* ───────────────────────────────────────────── L4 ───────────────────────────────────────────── */
say('— L4 · the close names the last SALE by its series number —');
function lastSaleNoFn() {
  const ctx = { console, JSON, Object, Math, Date, String, Number, Array, isSaleRow: new Function(lift('isSaleRow') + '; return isSaleRow;')() };
  vm.createContext(ctx);
  return vm.runInContext(liftIf('seqOfBill') + lift('lastSaleNo') + '; lastSaleNo', ctx);
}
const sale = (no, seq, period, at) => ({ no, kind: 'cash', lines: [], at: at || '2026-10-15T10:00:00.000Z',
  series: seq == null ? undefined : { prefix: 'C1', period: period || '26-27', seq } });
it('the close no longer sorts the number TEXT of every row (.sort().pop())', () => {
  const close = lift('closeCounter');
  assert.ok(!/\.sort\(\)\.pop\(\)/.test(close), 'closeCounter still pops a text sort');
  assert.ok(/lastSaleNo\(bills, series\)/.test(close), 'closeCounter does not ask lastSaleNo');
});
it('a GRN, a despatch note and a credit note sit beside the sales and are never "the last bill"', () => {
  const lastSaleNo = lastSaleNoFn();
  const rows = [sale('C1/26-27/0009', 9), sale('C1/26-27/0010', 10),
    { no: 'GRN/C1/26-27/0001', kind: 'receipt', doc: true, lines: [] }, { no: 'D/C1/26-27/0002', kind: 'despatch', doc: true, lines: [] },
    { no: 'CN/C1/26-27/0001', kind: 'credit_note', lines: [], total: -50 }];
  assert.strictEqual(lastSaleNo(rows, { prefix: 'C1', fy: '26-27', next: 11 }), 'C1/26-27/0010');
});
it('bill 10000 comes after 9999 (a text sort put 9999 last)', () => {
  const lastSaleNo = lastSaleNoFn();
  assert.strictEqual(lastSaleNo([sale('C1/26-27/9999', 9999), sale('C1/26-27/10000', 10000)], { fy: '26-27' }), 'C1/26-27/10000');
  assert.strictEqual(lastSaleNo([sale('C1/26-27/10000', 10000), sale('C1/26-27/9999', 9999)], { fy: '26-27' }), 'C1/26-27/10000');
});
it('an old row with no series slot is read by its trailing digits', () => {
  const lastSaleNo = lastSaleNoFn();
  assert.strictEqual(lastSaleNo([sale('C1/26-27/0003'), sale('C1/26-27/0012'), sale('C1/26-27/0007')], null), 'C1/26-27/0012');
});
it('after a period roll the current period wins: 0001 of October over 0150 of September (monthly reset)', () => {
  const lastSaleNo = lastSaleNoFn();
  const rows = [sale('C1/2609/0150', 150, '2609', '2026-09-30T18:00:00.000Z'), sale('C1/2610/0001', 1, '2610', '2026-10-01T09:00:00.000Z')];
  assert.strictEqual(lastSaleNo(rows, { prefix: 'C1', fy: '2610', next: 2 }), 'C1/2610/0001');
});
it('no sale at all → null (the close says nothing rather than a GRN number)', () => {
  const lastSaleNo = lastSaleNoFn();
  assert.strictEqual(lastSaleNo([{ no: 'GRN/C1/26-27/0001', kind: 'receipt', doc: true, lines: [] }], { fy: '26-27' }), null);
  assert.strictEqual(lastSaleNo([], null), null);
});

(async () => {
  let pass = 0, fail = 0;
  for (const [what, fn] of JOBS) {
    if (!what) { fn(); continue; }
    try { await fn(); pass++; console.log('  ok  ' + what); }
    catch (e) { fail++; console.log('  FAIL ' + what + '\n      ' + (e && e.message)); }
  }
  console.log('\ntill-fix2: ' + pass + ' passed, ' + fail + ' failed\n\n' + pass + ' checks');
  if (fail) process.exitCode = 1;
})();
