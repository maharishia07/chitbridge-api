'use strict';
/**
 * tests/till-pay-qr-link.test.cjs — the till's payment loop: the way to be paid, the link the QR carries, and what is drawn when it cannot be built.
 *
 * OWNS     the behaviour the payment-loop card named untested ("the till's Pay button / QR"): payWays (engine/jurisdiction.js) offers UPI only for a shop
 *          with a valid payee in an eligible country, and payLink (public/till.html, lifted whole from the page source, no browser) builds NPCI's
 *          upi://pay link from it: payee, shop name (60 max), amount in the shop's own currency grain, cu only when stated, tn = "CB-" + the bill number
 *          (12 max); an unknown scheme or a missing payee draws NOTHING (a wrong QR takes money somewhere else).
 * FLOW     page source → payLink extracted → run in a vm with the page's globals (S, shopCur, rmoney through the REAL engine/money.js) → asserts on the link.
 * CARD     16-finance/payment-loop
 * Run: node tests/till-pay-qr-link.test.cjs
 */
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const PUB = path.join(__dirname, '..', 'public');
const J = require(path.join(PUB, 'engine', 'jurisdiction.js')), M = require(path.join(PUB, 'engine', 'money.js'));
const html = fs.readFileSync(path.join(PUB, 'till.html'), 'utf8');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };

const start = html.indexOf('function payLink(way, amount, ref){');
ok(start > 0, 'payLink is in the till page');
const end = html.indexOf('\n}\n', start);
const src = html.slice(start, end + 2);
function linkFor(shop, way, amount, ref) {
  const sandbox = { S: { shop }, window: { CBMoney: M } };
  vm.createContext(sandbox);
  vm.runInContext('function shopCur(){ return (typeof S !== "undefined" && S && S.shop && S.shop.currency) || null; }'
    + 'var rmoney = function(n){ return window.CBMoney.round(Number(n) || 0, shopCur() || undefined); };' + src, sandbox);
  return vm.runInContext('payLink', sandbox)(way, amount, ref);
}
const q = (link) => { const u = new URL(link); return { proto: u.protocol, host: u.hostname, p: Object.fromEntries(u.searchParams) }; };

/* the ways offered */
const inWays = J.payWays({ country: 'IN', payees: { upi: ' shop@okbank ' } });
const upi = inWays.find((w) => w.id === 'upi');
ok(upi && upi.qr === 'upi-deeplink' && upi.payee === 'shop@okbank', 'an IN shop with a UPI id (stray space trimmed) is offered UPI, with the trimmed payee');
ok(inWays[0].id === 'cash' && inWays[inWays.length - 1].id === 'card', 'cash and card are always offered, as recorded-only ways (no qr)');
ok(!J.payWays({ country: 'AU', payees: { upi: 'shop@okbank' } }).some((w) => w.id === 'upi'), 'an AU shop is not offered UPI, even with a handle written down');
ok(!J.payWays({ country: 'IN', payees: {} }).some((w) => w.id === 'upi'), 'no payee, no UPI way: a QR with no address is not offered');
ok(!J.payWays({ country: 'IN', payees: { upi: 'not a handle' } }).some((w) => w.id === 'upi'), 'a payee that is not handle@provider is not offered');

/* the link */
const link = linkFor({ name: 'Ravi Stores & Co', currency: 'INR' }, upi, 250.5, 'B-1042');
const L = q(link);
ok(L.proto === 'upi:' && L.host === 'pay', 'the link is NPCI upi://pay');
ok(L.p.pa === 'shop@okbank' && L.p.pn === 'Ravi Stores & Co', 'payee and shop name ride (the name round-trips through encoding)');
ok(L.p.am === '250.5' && L.p.cu === 'INR', 'the amount is the bill\'s due, with the stated currency');
ok(L.p.tn === 'CB-B-1042', 'the transaction note is CB- plus the bill number');
ok(q(linkFor({ name: 'x'.repeat(100), currency: 'INR' }, upi, 10, 'A')).p.pn.length === 60, 'the shop name is cut at 60');
ok(q(linkFor({ name: 'Shop', currency: 'INR' }, upi, 10, 'ABCDEFGHIJKLMNOP')).p.tn === 'CB-ABCDEFGHIJKL', 'the bill number is cut at 12');
ok(!('am' in q(linkFor({ name: 'Shop', currency: 'INR' }, upi, 0, 'A')).p), 'no amount due: no am parameter (the customer types it)');
ok(!('cu' in q(linkFor({ name: 'Shop' }, upi, 10, 'A')).p), 'currency not stated: no cu (UPI reads a missing cu as its own, never a guess)');
ok(q(linkFor({ name: 'Shop', currency: 'INR' }, upi, 10.005, 'A')).p.am === '10.01' || q(linkFor({ name: 'Shop', currency: 'INR' }, upi, 10.005, 'A')).p.am === '10', 'the amount is rounded by the one engine rule, never printed with float noise');
ok(q(linkFor({ name: 'Shop', currency: 'INR' }, upi, 0.1 + 0.2, 'A')).p.am === '0.3', '0.1 + 0.2 is 0.3 on the code, not 0.30000000000000004');

/* nothing is drawn when it cannot be right */
ok(linkFor({ name: 'Shop' }, null, 10, 'A') === '', 'no way: no link');
ok(linkFor({ name: 'Shop' }, { id: 'cash', label: 'Cash', qr: null }, 10, 'A') === '', 'a recorded-only way (cash): no link');
ok(linkFor({ name: 'Shop' }, { id: 'upi', qr: 'upi-deeplink', payee: '' }, 10, 'A') === '', 'a way with no payee: no link');
ok(linkFor({ name: 'Shop' }, { id: 'x', qr: 'emvco-tlv', payee: 'abc' }, 10, 'A') === '', 'an unknown scheme draws nothing rather than guessing an encoding');
console.log(n + ' checks passed');
