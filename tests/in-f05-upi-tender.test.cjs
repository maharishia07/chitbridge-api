// tests/in-f05-upi-tender.test.cjs — IN-F-05: UPI is a way to pay at an India counter even with no payee (CTR-141); not under another country's pack.  node tests/in-f05-upi-tender.test.cjs
// Hand figures: an India shop with no payee: pay row = Cash · UPI · Card; picking UPI on a Rs 632.33 bill says there is no QR to draw; with a payee the shop's own UPI row (id upi, QR) stays and is not doubled; an AE pack: no UPI.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8').replace(/\r\n/g, '\n');
const grab = (name) => { const at = HTML.indexOf('\nfunction ' + name + '('); const end = HTML.indexOf('\n}\n', at); return HTML.slice(at, end + 3); };
let n = 0;
const ok = (what, fn) => { fn(); n++; };
function run(country, pay, picked) {
  const out = { innerHTML: '' };
  const ctx = {
    window: { CBRegulation: require('../lib/regulation') }, CBRegulation: require('../lib/regulation'),
    document: { getElementById: () => out },
    S: { shop: { country, pay } }, PARTS: [], CART: [{ name: 'x' }], PICKED: picked, LASTNO: '', CREDIT_SINCE: {}, PAY_ASKED: false,
    docCountry: () => country, cbQuiet: () => {}, billMoney: () => ({ net: 632.33 }), rmoney: (v) => Math.round(v * 100) / 100, money: (v) => '₹' + Number(v).toFixed(2),
    tillOpt: () => ({}), upiShapeOk: () => true, creditCust: () => null, esc: String, payLink: () => '', payQr: () => '', cashSaysHTML: () => '', cashRoundWords: () => '', Math, Number, String, Object, Array
  };
  vm.createContext(ctx);
  vm.runInContext(['shopPack', 'packHasUpi', 'paintPays', 'payWaysOf', 'addOwnUpiWay', 'addIndiaUpiWay', 'paySinceBackground', 'payButtonsHTML', 'payQrHTML', 'paySaysHTML'].map(grab).join('\n') + '\nthis.__p = paintPays;', ctx);
  ctx.__p();
  return out.innerHTML;
}
const ways = (html) => (html.match(/data-testid="till-pay-([a-z-]+)"/g) || []).map((m) => m.replace(/.*till-pay-|"/g, '')).filter((x) => ['cash', 'upi', 'card', 'upi-local', 'credit'].indexOf(x) >= 0);
ok('India, no payee: the pay row is Cash · UPI · Card', () => assert.deepStrictEqual(ways(run('IN', [{ id: 'cash', label: 'Cash' }, { id: 'card', label: 'Card' }], 'Cash')), ['cash', 'upi', 'card']));
ok('India, no payee, no shop pay list at all: still Cash · UPI · Card', () => assert.deepStrictEqual(ways(run('IN', null, 'Cash')), ['cash', 'upi', 'card']));
ok('UPI picked on Rs 632.33: it says there is no QR and where to add the address', () => {
  const html = run('IN', [{ id: 'cash', label: 'Cash' }, { id: 'card', label: 'Card' }], 'UPI');
  assert.match(html, /data-testid="till-pay-noqr"/); assert.match(html, /No QR to show/); assert.match(html, /632\.33/); assert.match(html, /Settings › This counter/);
});
ok('Cash picked: no no-QR note', () => assert.ok(!/till-pay-noqr/.test(run('IN', [{ id: 'cash', label: 'Cash' }, { id: 'card', label: 'Card' }], 'Cash'))));
ok('a shop that published a payee keeps its own UPI row (with the QR hint) and is not doubled', () => {
  const html = run('IN', [{ id: 'cash', label: 'Cash' }, { id: 'upi', label: 'UPI', qr: 'upi-deeplink', payee: 'shop@upi' }, { id: 'card', label: 'Card' }], 'Cash');
  assert.deepStrictEqual(ways(html), ['cash', 'upi', 'card']); assert.match(html, /qrhint/);
});
ok('Emirates pack: no UPI row, ever', () => assert.deepStrictEqual(ways(run('AE', [{ id: 'cash', label: 'Cash' }, { id: 'card', label: 'Card' }], 'Cash')), ['cash', 'card']));
console.log('in-f05-upi-tender: ' + n + ' checks');
