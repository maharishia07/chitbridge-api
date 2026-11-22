#!/usr/bin/env node
// @type: contract
'use strict';
/**
 * till-never-ok-hold-1128.test.cjs - lane tillHold1128: A REFUSAL THAT CANNOT CHANGE IS HELD FOR A PERSON, NEVER RETRIED.
 * OWNS      proof, over the counter's own drain (lifted from tools/tally-connector/till.html), that a sale answered 422 with a NEVER_OK code
 *           (BILL_NO_BAD, TAX_NOT_CHARGEABLE ...) is held (_hold.never, no retry time, Send now skips it), says plain words, still counts as
 *           outstanding (the row stays in the queue, so the day close sees it), and that every other 422 / a change row keeps its old behaviour.
 * CALLED BY scripts/guards.cjs . CI. No database, no network, no browser.
 * CARD      09-counter/offline-queue-and-replay
 * Run: node tests/till-never-ok-hold-1128.test.cjs
 */
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const PAGE = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8').replace(/\r\n/g, '\n');
function lift(name) {
  let i = PAGE.indexOf('\nfunction ' + name + '('); if (i < 0) i = PAGE.indexOf('\nasync function ' + name + '(');
  assert.ok(i >= 0, name + ' is not in the page');
  let d = 0; for (let k = PAGE.indexOf('{', i); k < PAGE.length; k++) { if (PAGE[k] === '{') d++; else if (PAGE[k] === '}') { d--; if (!d) return PAGE.slice(i, k + 1) + '\n'; } }
  throw new Error('unbalanced ' + name);
}
const liftVar = (name) => (PAGE.match(new RegExp('\\nvar ' + name + ' = [^\\n]*;')) || [''])[0] + '\n';
const liftCloudHost = () => { const a = PAGE.indexOf('\nvar CloudHost = {'); return PAGE.slice(a, PAGE.indexOf('\n};\n', a) + 4); };
const clone = (v) => JSON.parse(JSON.stringify(v));
const SALE = (no) => ({ no, at: '2026-11-21T09:00:00Z', lines: [{ name: 'Tea', qty: 1 }], total: 10 });
const SAID = 'The bill number is empty, too long or has a character the country does not allow.';
function fakeDB() {
  const stores = { bills: {}, queue: {} };
  return { stores, put: async (s, r) => { stores[s][r.no] = clone(r); }, del: async (s, k) => { delete stores[s][k]; },
    all: async (s) => Object.keys(stores[s]).sort().map((k) => clone(stores[s][k])), allRaw: async (s) => Object.keys(stores[s]).sort().map((k) => clone(stores[s][k])) };
}
const FNS = ['neverOk', 'qBackoff', 'qDue', 'qSoonest', 'isParkedRow', 'parksOn', 'sendableRows', 'refusedRow', 'frozenDrain', 'heldWaitWords', 'staleHasItem', 'staleSaleRow', 'staleCandidate', 'staleGateSafe', 'staleGate', 'drainRecordSent', 'drainAnswerProof'];
function counter(answer) {
  const DB = fakeDB(), calls = [];
  const ctx = { console, setTimeout, clearTimeout, JSON, Object, Math, Date, String, Number, Array, Promise, Error, DB, OWNER: null, FOREIGN: 0, STATE: { queued: 1 }, DEADLINE: 20000, dbFrozen: () => false, FROZEN_LINE: 'frozen',
    lineUp: () => true, cbQuiet: () => {}, queueTally: async () => {}, paintStatus: () => {}, personOn: () => false, drainSoon: () => {}, ls: { set() {}, get: (k, d) => d },
    stampDeliveryRefs: (n, r) => r, chitOf: (b) => b, qWaitWords: () => '', renumberBill: async () => null,
    fetchBy: async (url) => { calls.push(url); const [status, body] = answer(calls.length); return { ok: status < 300, status, json: async () => body, clone() { return this; } }; } };
  vm.createContext(ctx);
  vm.runInContext(liftVar('Q_FLOOR') + liftVar('WAITS_FOR_BILL') + liftVar('FINAL_REFUSALS') + liftVar('NEVER_OK') + liftVar('NEVER_OK_WORDS') + FNS.map(lift).join('') + lift('isSaleRow') + liftCloudHost(), ctx);
  const host = vm.runInContext('CloudHost', ctx);
  host.key = 'k'; host.api = 'http://shop'; host.cred = () => 'k'; host.auth = (x) => Object.assign({}, x || {}); host.idemHeaders = (p, b, x) => x;
  return { host, DB, calls, ctx };
}
let n = 0, failed = 0;
const it = async (name, fn) => { n++; try { await fn(); console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n         ' + e.message); } };

(async () => {
  await it('a refusal that cannot change is held for a person, never retried (BILL_NO_BAD and TAX_NOT_CHARGEABLE: held once, no retry time, Send now skips it, still queued for the close)', async () => {
    for (const code of ['BILL_NO_BAD', 'TAX_NOT_CHARGEABLE']) {
      const { host, DB, calls, ctx } = counter(() => [422, { code, message: SAID }]);
      DB.stores.queue['C1/1'] = SALE('C1/1');
      await host.drain({ force: true }); await host.drain({ force: true }); await host.drain();
      assert.strictEqual(calls.length, 1, code + ': the wire was asked ' + calls.length + ' times');
      const row = DB.stores.queue['C1/1'];
      assert.ok(row && row._hold && row._hold.never === true, code + ' not held: ' + JSON.stringify(row));
      assert.strictEqual(row._nextAt, undefined); assert.ok(!row._parked);
      assert.ok(row._hold.why.indexOf('number or tax is not accepted for this shop') > 0 && row._hold.said === SAID);
      assert.ok(host.last.why.indexOf('held, not sent') > 0, 'later drain says: ' + host.last.why);
      assert.strictEqual(Object.keys(DB.stores.queue).length, 1, 'the bill left the queue, so the day close would not count it');
      assert.strictEqual(ctx.sendableRows([row]).length, 1, 'a held row stays among the rows still outstanding');
    }
  });
  await it('a 422 with another code, a change row, and a 400 with a NEVER_OK code keep their old way', async () => {
    const a = counter(() => [422, { code: 'NO_PRICE', message: 'x' }]); a.DB.stores.queue['C1/2'] = SALE('C1/2');
    await a.host.drain({ force: true });
    assert.ok(!a.DB.stores.queue['C1/2']._hold && a.DB.stores.queue['C1/2']._nextAt > Date.now());
    const b = counter(() => [422, { code: 'BILL_NO_BAD', message: 'x' }]); b.DB.stores.queue['OP/1'] = { no: 'OP/1', at: 'x', tillPost: { path: '/api/till/price', body: {} } };
    await b.host.drain({ force: true });
    assert.ok(b.DB.stores.queue['OP/1']._parked && !b.DB.stores.queue['OP/1']._hold);
    const c = counter(() => [400, { code: 'BILL_NO_BAD', message: 'x' }]); c.DB.stores.queue['C1/3'] = SALE('C1/3');
    await c.host.drain({ force: true }); assert.ok(!c.DB.stores.queue['C1/3']._hold, 'only a 422 is held');
  });
  await it('the stuck panel says it in plain words with one Set aside button (own code CTR008-B49), and an alert chip is drawn', async () => {
    const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const cards = [], ctx = { esc, QUEUED: { never: 1, parked: 0 }, dbFrozen: () => false, BLOCKED_WORDS: '' };
    vm.createContext(ctx);
    vm.runInContext(liftVar('NEVER_OK_WORDS') + lift('heldSectionHTML') + lift('parkedAlert'), ctx);
    const row = Object.assign(SALE('C1/1'), { _hold: { at: 1, why: vm.runInContext('NEVER_OK_WORDS', ctx), said: SAID, never: true } });
    const html = ctx.heldSectionHTML([row]);
    assert.ok(html.indexOf('Fix it and send again, or set it aside.') > 0 && /data-cbsid="CTR008-B49"[^>]*data-testid="till-held-aside-C1\/1"/.test(html) && !/held-renumber/.test(html), html);
    ctx.parkedAlert((id, ic, title, body, btn) => cards.push([id, title, btn]));
    assert.ok(cards.length === 1 && cards[0][0] === 'held' && /1 bill is held/.test(cards[0][1]) && /data-cbsid="CMP010"[^>]*data-testid="till-alert-held"/.test(cards[0][2]), JSON.stringify(cards));
  });
  console.log('\ntill-never-ok-hold-1128: ' + (n - failed) + '/' + n + ' passed'); process.exit(failed ? 1 : 0);
})();
