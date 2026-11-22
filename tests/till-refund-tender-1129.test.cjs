#!/usr/bin/env node
// @type: contract
'use strict';
/**
 * till-refund-tender-1129.test.cjs - AF-F-01 (walk AF, 1129), the TILL half. The api refuses a refund by a tender the bill did not use (409 REFUND_TENDER_MISMATCH) unless
 * refund.override.reason is sent by an owner/manager seat. Here, over the counter's OWN page code (lifted from tools/tally-connector/till.html, no browser):
 *   (1) the refund sheet starts on the bill's own tender; another tender is greyed (with a sentence) for a seat that may not approve it, open for owner/manager;
 *   (2) another tender without a reason is refused in words and nothing is issued; with a reason the credit note carries business_json.refund.override.reason;
 *   (3) the same tender sends no override at all;
 *   (4) the offline drain PARKS a credit note answered 409/422 ("Refused: <sentence>"), asks the wire once, never again; 5xx keeps the ladder (never parked).
 * CALLED BY scripts/guards.cjs . No database, no network, no browser.
 * CARD      09-counter/returns
 * Run: node tests/till-refund-tender-1129.test.cjs
 */
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const PAGE = (fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till-slip.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till-dayrep.js'), 'utf8')) /* the part files the till loads beside till.html (1128-1129 split) */.replace(/\r\n/g, '\n');
function lift(name) {
  let i = PAGE.indexOf('\nfunction ' + name + '(');
  if (i < 0) i = PAGE.indexOf('\nasync function ' + name + '(');
  assert.ok(i >= 0, name + ' is not in the page');
  let depth = 0;
  for (let k = PAGE.indexOf('{', i); k < PAGE.length; k++) {
    if (PAGE[k] === '{') depth++;
    else if (PAGE[k] === '}') { depth--; if (depth === 0) return PAGE.slice(i, k + 1) + '\n'; }
  }
  throw new Error('unbalanced ' + name);
}
const liftVar = (name) => (PAGE.match(new RegExp('\\nvar ' + name + ' = [^\\n]*;')) || [''])[0] + '\n';
const clone = (v) => JSON.parse(JSON.stringify(v));
let n = 0, failed = 0;
const it = async (name, fn) => { n++; try { await fn(); console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n         ' + e.message); } };

const CARD_BILL = { no: 'C1/1', at: '2026-11-21T09:00:00Z', total: 44, payments: [{ how: 'Card', amount: 44 }], lines: [{ name: 'Mug', qty: 1, net: 22 }] };

/** the sheet's own functions, with a seat that may (or may not) approve another tender */
function sheet(may) {
  const toasts = [], issued = [];
  const ctx = { console, JSON, String, Number, Array, Object, Math, toasts, issued, RET_FOR: CARD_BILL, RET_HOW: 'Card', RET_REASON: '', RET_OWED: 'owed', RET_WHY: 'returned', RET_WHYS: [['returned', 'Returned']],
    esc: (x) => String(x), rateMay: () => (may ? { ok: true } : { ok: false, why: 'no' }), money: (x) => String(x), rmoney: (x) => x, toastLine: (t) => toasts.push(t), tillStopped: async () => false, dayReopenAsk: async () => true /* Q-F-03: retIssue asks first */, retCanIssue: () => true,
    retMoney: () => ({ total: 22, taxable: 20, tax: 2, saved: 0, byRate: {}, lines: [] }), retPlan: (a, t, how) => ({ refunds: [{ how, amount: t }], ask: 'sure', yes: 'y', done: 'd', refusal: '' }),
    retConfirm: async () => true, negatedTax: (x) => x, WHO: null, HOST: { creditNote: async (body) => { issued.push(body); return { ok: true, bill: body }; } }, retClose() {}, retSlipHTML: () => '', slipDocButtons() {}, autoPrint() {}, menuFresh() {}, paintStatus() {}, cbQuiet() {},
    document: { getElementById: () => null }, creditNoteTitle: () => '' };
  vm.createContext(ctx);
  vm.runInContext(['retOriginalOf', 'retPaidSet', 'retIsOther', 'retOtherSaid', 'retOtherMay', 'retReasonSet', 'retHowOptions', 'retIssue'].map(lift).join(''), ctx);
  return ctx;
}
const run = (ctx, code) => vm.runInContext(code, ctx);

(async () => {
  await it('the sheet starts on the bill\'s own tender; a cashier seat sees another tender greyed, with the sentence', async () => {
    const c = sheet(false);
    const html = run(c, 'retHowOptions({ Card: true, Cash: true }, { offered: false })');
    assert.ok(/<option value="Card" selected>/.test(html) && !/value="Card"[^>]*disabled/.test(html), html);
    assert.ok(/<option value="Cash" disabled>/.test(html), 'Cash is not greyed: ' + html);
    assert.ok(/paid by Card, so the refund goes back by Card/.test(run(c, 'retOtherSaid(RET_FOR)')));
  });
  await it('an owner/manager seat may pick another tender (not greyed)', async () => {
    const html = run(sheet(true), 'retHowOptions({ Card: true, Cash: true }, { offered: false })');
    assert.ok(!/disabled/.test(html), html);
  });
  await it('same tender: issued, no override on the note', async () => {
    const c = sheet(false); await run(c, 'retIssue()');
    assert.strictEqual(c.issued.length, 1); assert.strictEqual(c.issued[0].override_reason, null); assert.strictEqual(c.issued[0].refunds[0].how, 'Card');
  });
  await it('another tender without a reason: refused in words, nothing issued', async () => {
    const c = sheet(true); c.RET_HOW = 'Cash'; await run(c, 'retIssue()');
    assert.strictEqual(c.issued.length, 0); assert.ok(/Say why it goes back by Cash and not by Card/.test(c.toasts[0]), c.toasts.join('|'));
  });
  await it('a cashier seat cannot send another tender even with a reason (said, nothing issued)', async () => {
    const c = sheet(false); c.RET_HOW = 'Cash'; c.RET_REASON = 'machine down'; await run(c, 'retIssue()');
    assert.strictEqual(c.issued.length, 0); assert.ok(/A manager or the owner can send it another way/.test(c.toasts[0]));
  });
  await it('a manager with a reason: the credit note carries it, and chitOfCN puts it at refund.override.reason', async () => {
    const c = sheet(true); c.RET_HOW = 'Cash'; c.RET_REASON = ' card machine down '; await run(c, 'retIssue()');
    assert.strictEqual(c.issued.length, 1); assert.strictEqual(c.issued[0].override_reason, 'card machine down');
    assert.ok(/refund: Object\.assign\(\{ parts: cn\.refunds \|\| \[\][^\n]*override: \{ reason: cn\.override_reason \}/.test(PAGE), 'chitOfCN does not send refund.override.reason');
  });

  const park = (answer) => {
    const stores = { bills: {}, queue: {} }, calls = [];
    const DB = { put: async (s, r) => { stores[s][r.no] = clone(r); }, del: async (s, k) => { delete stores[s][k]; }, all: async (s) => Object.keys(stores[s]).map((k) => clone(stores[s][k])), allRaw: async (s) => Object.keys(stores[s]).map((k) => clone(stores[s][k])) };
    const ctx = { console, setTimeout, clearTimeout, JSON, Object, Math, Date, String, Number, Array, Promise, Error, DB, OWNER: null, FOREIGN: 0, STATE: { queued: 0 }, DEADLINE: 20000, dbFrozen: () => false, FROZEN_LINE: 'f', lineUp: () => true, cbQuiet: () => {}, queueTally: async () => {}, paintStatus: () => {},
      personOn: () => false, drainSoon: () => {}, ls: { set() {}, get: (k, d) => d }, isSaleRow: (b) => !!(b && !b.tillPost && b.kind !== 'credit_note' && Array.isArray(b.lines)), renumberBill: async () => null, stampDeliveryRefs: (n2, r) => r, chitOf: (b) => b, qWaitWords: () => '',
      fetchBy: async (url) => { calls.push(url); const [status, body] = answer(); return { ok: status >= 200 && status < 300, status, json: async () => body, clone() { return this; } }; } };
    vm.createContext(ctx);
    const fns = ['neverOk', 'qBackoff', 'qDue', 'qSoonest', 'isParkedRow', 'parksOn', 'sendableRows', 'refusedRow', 'frozenDrain', 'staleHasItem', 'staleSaleRow', 'staleCandidate', 'staleGateSafe', 'staleGate', 'drainRecordSent', 'drainAnswerProof'];
    const a = PAGE.indexOf('\nvar CloudHost = {');
    vm.runInContext(liftVar('Q_FLOOR') + liftVar('WAITS_FOR_BILL') + liftVar('FINAL_REFUSALS') + liftVar('NEVER_OK') + liftVar('NEVER_OK_WORDS') + liftVar('ONE_ROW_REFUSALS') + fns.map(lift).join('') + PAGE.slice(a, PAGE.indexOf('\n};\n', a) + 4), ctx);
    const host = vm.runInContext('CloudHost', ctx);
    host.key = 'k'; host.api = 'http://shop'; host.cred = () => 'k'; host.auth = (x) => Object.assign({}, x || {}); host.idemHeaders = (p, b, x) => x;
    return { host, stores, calls, ctx };
  };
  const SAID = 'This bill was paid by Card, so the refund goes back by Card, not Cash. A manager can approve a different way, with a reason.';
  const note = (no) => ({ no: no || 'CN/1', kind: 'credit_note', at: '2026-11-21T09:00:00Z', total: -22, lines: [{ name: 'Mug', qty: -1 }], refunds: [{ how: 'Cash', amount: 22 }], against: { bill_no: 'C1/1' } });
  for (const status of [409, 422]) await it('an offline replay answered ' + status + ' parks the credit note ("Refused: <sentence>") and is never sent again', async () => {
    const { host, stores, calls, ctx } = park(() => [status, { code: 'REFUND_TENDER_MISMATCH', message: SAID }]);
    stores.queue['CN/1'] = note();
    await host.drain({ force: true }); await host.drain({ force: true }); await host.drain();
    assert.strictEqual(calls.length, 1, 'the wire was asked ' + calls.length + ' times');
    const row = stores.queue['CN/1'];
    assert.ok(row && row._parked && row._parked.status === status && row._why === SAID && row._nextAt === undefined, JSON.stringify(row));
    assert.ok(/^Refused: This bill was paid by Card/.test(await vm.runInContext("refusedRow", ctx)(note("CN/9"), status, SAID, "REFUND_TENDER_MISMATCH")));
  });
  await it('a 500 on a credit note still climbs the ladder (not parked, not lost)', async () => {
    const { host, stores } = park(() => [500, { code: 'X', message: 'no' }]);
    stores.queue['CN/2'] = note('CN/2');
    await host.drain({ force: true });
    const row = stores.queue['CN/2'];
    assert.ok(row && !row._parked && row._nextAt > Date.now(), JSON.stringify(row));
  });
  await it('a refused credit note reads "Refund CN/1 against C1/1" on the Needs-fixing list', async () => {
    const ctx = { esc: (x) => String(x), S: { items: [] }, isRewardRow: () => false, rewardBillNo: () => '' };
    vm.createContext(ctx); vm.runInContext(lift('parkedItem') + lift('parkedName'), ctx);
    assert.strictEqual(vm.runInContext('parkedName', ctx)(note()), 'Refund CN/1 against C1/1');
  });
  console.log(failed ? failed + ' FAILED of ' + n : 'all ' + n + ' ok'); process.exit(failed ? 1 : 0);
})();
