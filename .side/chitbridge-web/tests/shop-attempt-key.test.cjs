'use strict';
/* API-3 S36 (laptop1, 23 Oct): shop.html sends ONE Idempotency-Key per order attempt and the SAME key when that attempt is sent
   again, so a double tap or a retry after a lost answer makes one order. The two helpers run in node; the three money fetches
   (sign-in code, order code, place order) are checked by source. Run: node tests/shop-attempt-key.test.cjs */
const fs = require('fs'), vm = require('vm'), assert = require('assert');
let n = 0;
const ok = (cond, what) => { assert(cond, what); n++; console.log('  ok  ' + what); };
const shop = fs.readFileSync(__dirname + '/../public/shop.html', 'utf8');
const from = shop.indexOf('var _ATTEMPTS = {};'), to = shop.indexOf('function sfLoginStart()');
ok(from > 0 && to > from, 'shop.html holds the attempt helpers before the first money fetch');
let minted = 0;
const cx = vm.createContext({ window: {}, CBOffline: { _uuid: () => 'key-' + ++minted }, Date, Math });
cx.window.CBOffline = cx.CBOffline;
vm.runInContext(shop.slice(from, to), cx);

const first = cx.attemptKey('confirm', '{"otp":"K4X9QZ"}');
ok(cx.attemptKey('confirm', '{"otp":"K4X9QZ"}') === first, 'the same body sent again (a second tap, a lost answer) carries the same key');
ok(cx.attemptKey('confirm', '{"otp":"K4X9QZ","remark":"x"}') !== first, 'a changed body is a new attempt with a new key');
ok(cx.attemptKey('order-start', '{"otp":"K4X9QZ","remark":"x"}') !== cx.attemptKey('confirm', '{"otp":"K4X9QZ","remark":"x"}'), 'each door holds its own attempt');

const held = cx.attemptKey('confirm', 'B');
ok(cx.attemptAnswered('confirm', { status: 502, j: null }) === null && cx.attemptKey('confirm', 'B') === held, 'a 5xx keeps the key: the retry is the same attempt');
const still = cx.attemptAnswered('confirm', { status: 409, j: { code: 'IDEMPOTENCY_IN_PROGRESS' } });
ok(/Still sending/.test(still) && !/Idempotency/.test(still), '409 IDEMPOTENCY_IN_PROGRESS shows plain words, never the header name');
ok(cx.attemptKey('confirm', 'B') === held, '…and keeps the key, so the next press asks after the same attempt');
ok(cx.attemptAnswered('confirm', { status: 200, j: {} }) === null && cx.attemptKey('confirm', 'B') !== held, 'a settled answer ends the attempt: the next press (Resend code) is new');
const refused = cx.attemptKey('confirm', 'C');
cx.attemptAnswered('confirm', { status: 409, j: { code: 'ORDER_REJECTED' } });
ok(cx.attemptKey('confirm', 'C') !== refused, 'a deliberate 409 (mixed currencies) is settled too');

/* moneyPost: the one way to a money door — the key rides the header, a lost answer's retry reuses it, "still running" reads plainly */
(async () => {
  const sentKeys = [];
  let answer = null;
  cx.API = 'http://api';
  cx.BRIDGE = 'shop-s';
  cx.fetch = (url, init) => {
    sentKeys.push([url, init.headers['Idempotency-Key']]);
    if (!answer) return Promise.reject(new Error('the answer was lost'));
    return Promise.resolve({ status: answer.status, json: () => Promise.resolve(answer.j) });
  };
  const lost = await cx.moneyPost('confirm', '/order/confirm', { otp: 'Z' }).catch((e) => e);
  answer = { status: 200, j: { chit_id: 'c1' } };
  const retry = await cx.moneyPost('confirm', '/order/confirm', { otp: 'Z' });
  ok(lost instanceof Error && retry.j.chit_id === 'c1', 'moneyPost: a lost answer, then the retry is answered');
  ok(sentKeys[0][0] === 'http://api/api/catalogue/shop-s/order/confirm' && sentKeys[0][1] && sentKeys[1][1] === sentKeys[0][1], 'moneyPost: the retry after a lost answer sends the SAME key');
  answer = { status: 409, j: { code: 'IDEMPOTENCY_IN_PROGRESS', message: 'A request with this Idempotency-Key is still being processed.' } };
  const busy = await cx.moneyPost('order-start', '/order/start', { identifier: 'a@b.co' });
  ok(busy.status === 409 && /Still sending/.test(busy.j.message) && busy.j.code === 'IDEMPOTENCY_IN_PROGRESS', 'moneyPost: "still running" reaches the screen as plain words');

  /* the three money calls in the page go through moneyPost, and no raw fetch to a money door is left */
  for (const [door, url] of [['login-start', '/order/start'], ['order-start', '/order/start'], ['confirm', '/order/confirm']]) {
    ok(shop.includes("moneyPost('" + door + "', '" + url + "', "), door + ': posts to ' + url + ' through moneyPost');
  }
  ok(!/encodeURIComponent\(BRIDGE\) \+ '\/order\/(start|confirm)'/.test(shop), 'no money fetch is left outside moneyPost (none without a key)');
  console.log(n + ' passed');
})().catch((e) => {
  console.log('  FAIL ' + e.message);
  process.exitCode = 1;
});
